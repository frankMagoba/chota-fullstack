import { withTx, type Tx } from '../lib/db.js';
import { AppError } from '../lib/errors.js';
import { CH_BOOKING } from '../lib/redis.js';
import { zoneFor, distanceKm, etaMinutes } from '../lib/geo.js';
import { bookingsCreated, dispatchDuration } from '../lib/metrics.js';
import { config } from '../config.js';
import type { Ctx } from './context.js';
import { nearbyDrivers, syncGeo } from './drivers.js';
import { priceKes, surgeMultiplier, type Service } from './pricing.js';
import { trustScore } from './trust.js';
import { track } from './analytics.js';

export const DEFAULT_SLOT_CAPACITY = Number(process.env.SLOT_CAPACITY ?? 20);

export interface CreateBookingInput {
  service: Service;
  quantityLitres: number;
  lat: number;
  lng: number;
  address: string;
}

const BOOKING_COLUMNS = `
  b.id, b.customer_id AS "customerId", b.driver_id AS "driverId", b.service_type AS service,
  b.quantity_litres AS "quantityLitres", ST_Y(b.pickup::geometry) AS lat, ST_X(b.pickup::geometry) AS lng,
  b.address, b.status, b.price_kes AS "priceKes", b.surge_multiplier AS surge, b.version,
  b.created_at AS "createdAt", b.updated_at AS "updatedAt"`;

export async function getBooking(db: Ctx['db'] | Tx, id: string) {
  const { rows } = await db.query(
    `SELECT ${BOOKING_COLUMNS},
       u.name AS "driverName", u.phone AS "driverPhone", u.trust_score AS "driverTrust", d.plate AS "driverPlate",
       ST_Y(d.location::geometry) AS "driverLat", ST_X(d.location::geometry) AS "driverLng"
     FROM bookings b
     LEFT JOIN users u ON u.id = b.driver_id
     LEFT JOIN drivers d ON d.user_id = b.driver_id
     WHERE b.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Create a booking and assign the nearest free driver in one transaction.
 *
 * Race conditions this handles:
 *  1. Same customer double-taps "Request" (or the app retries on a flaky
 *     network): the Idempotency-Key is UNIQUE per customer, so the second
 *     insert hits ON CONFLICT and we return the first booking.
 *  2. Two customers ask for the same nearest driver at the same moment:
 *     the driver row is taken with SELECT ... FOR UPDATE SKIP LOCKED, so the
 *     second transaction skips that driver and takes the next one instead of
 *     waiting or double-assigning. A partial unique index on active bookings
 *     per driver is the last line of defence.
 *  3. A surge where demand > trucks: slot capacity is decremented with a
 *     conditional UPDATE (booked < capacity), so we never accept more jobs
 *     for a zone/hour than the capacity ops configured.
 */
export async function createBooking(ctx: Ctx, customerId: string, idemKey: string, input: CreateBookingInput) {
  const existing = await ctx.db.query('SELECT id FROM bookings WHERE customer_id = $1 AND idempotency_key = $2', [
    customerId,
    idemKey,
  ]);
  if (existing.rows[0]) return { booking: await getBooking(ctx.db, existing.rows[0].id), replayed: true };

  // Candidate list from Redis GEO, nearest first. Read outside the transaction:
  // it's only a hint, the row lock below is what decides.
  const candidates = await nearbyDrivers(ctx, input.service, input.lat, input.lng, config.dispatchRadiusKm, 25);
  const surgeOn = await ctx.flags.isOn('surge_pricing', customerId);

  const end = dispatchDuration.startTimer();
  let outcome = 'no_driver' as 'assigned' | 'no_driver' | 'replayed';
  let bookingId: string;
  let driver: { user_id: string; service_type: Service; lat: number; lng: number } | undefined;
  try {
    bookingId = await withTx(ctx.db, async (tx) => {
      const ins = await tx.query(
        `INSERT INTO bookings (customer_id, service_type, quantity_litres, pickup, address, price_kes, idempotency_key)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8)
         ON CONFLICT (customer_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          customerId,
          input.service,
          input.quantityLitres,
          input.lat,
          input.lng,
          input.address,
          priceKes(input.service, input.quantityLitres),
          idemKey,
        ],
      );
      if (!ins.rows[0]) {
        // A concurrent request with the same key committed first.
        outcome = 'replayed';
        const again = await tx.query('SELECT id FROM bookings WHERE customer_id = $1 AND idempotency_key = $2', [
          customerId,
          idemKey,
        ]);
        return again.rows[0].id as string;
      }
      const id = ins.rows[0].id as string;

      driver = await lockDriver(
        tx,
        candidates.map((c) => c.driverId),
        input,
      );
      if (!driver) {
        await tx.query(`UPDATE bookings SET status = 'no_driver' WHERE id = $1`, [id]);
        await tx.query(`INSERT INTO booking_events (booking_id, status, actor_id) VALUES ($1, 'no_driver', NULL)`, [id]);
        return id;
      }

      const slot = await reserveSlot(tx, input);
      const surge = surgeOn ? surgeMultiplier(slot.booked, slot.capacity) : 1;

      await tx.query(`UPDATE drivers SET status = 'busy', version = version + 1 WHERE user_id = $1`, [driver.user_id]);
      await tx.query(
        `UPDATE bookings SET driver_id = $2, slot_id = $3, status = 'assigned', surge_multiplier = $4, price_kes = $5,
           version = version + 1, updated_at = now()
         WHERE id = $1`,
        [id, driver.user_id, slot.id, surge, priceKes(input.service, input.quantityLitres, surge)],
      );
      await tx.query(`INSERT INTO booking_events (booking_id, status, actor_id) VALUES ($1, 'assigned', NULL)`, [id]);
      outcome = 'assigned';
      return id;
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'SLOT_FULL') {
      bookingsCreated.inc({ service: input.service, outcome: 'slot_full' });
      await track(ctx.db, ctx.flags, customerId, 'booking_slot_full', { service: input.service });
    }
    throw err;
  } finally {
    end();
  }

  const booking = await getBooking(ctx.db, bookingId);
  if (outcome === 'replayed') return { booking, replayed: true };

  bookingsCreated.inc({ service: input.service, outcome });
  if (driver) await syncGeo(ctx, driver.user_id, driver.service_type, 'busy', null, null);
  await publishBooking(ctx, booking);
  await track(ctx.db, ctx.flags, customerId, outcome === 'assigned' ? 'booking_created' : 'booking_no_driver', {
    bookingId,
    service: input.service,
    litres: input.quantityLitres,
    surge: booking.surge,
  });
  return { booking, replayed: false };
}

async function lockDriver(tx: Tx, candidateIds: string[], input: CreateBookingInput) {
  const sql = candidateIds.length
    ? `SELECT user_id, service_type, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM drivers
       WHERE user_id = ANY($1::uuid[]) AND status = 'available' AND service_type = $2 AND capacity_litres >= $3
       ORDER BY array_position($1::uuid[], user_id)
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    : // Fallback when Redis has nothing (cold start, Redis flushed): PostGIS nearest-neighbour.
      `SELECT user_id, service_type, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng
       FROM drivers
       WHERE cardinality($1::uuid[]) = 0 AND status = 'available' AND service_type = $2 AND capacity_litres >= $3
         AND location IS NOT NULL
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6)
       ORDER BY location <-> ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography
       LIMIT 1
       FOR UPDATE SKIP LOCKED`;
  const params = candidateIds.length
    ? [candidateIds, input.service, input.quantityLitres]
    : [candidateIds, input.service, input.quantityLitres, input.lat, input.lng, config.dispatchRadiusKm * 1000];
  const { rows } = await tx.query(sql, params);
  return rows[0];
}

async function reserveSlot(tx: Tx, input: CreateBookingInput) {
  const zone = zoneFor(input.lat, input.lng);
  await tx.query(
    `INSERT INTO slots (zone, service_type, starts_at, capacity)
     VALUES ($1, $2, date_trunc('hour', now()), $3)
     ON CONFLICT (zone, service_type, starts_at) DO NOTHING`,
    [zone, input.service, DEFAULT_SLOT_CAPACITY],
  );
  const { rows } = await tx.query(
    `UPDATE slots SET booked = booked + 1
     WHERE zone = $1 AND service_type = $2 AND starts_at = date_trunc('hour', now()) AND booked < capacity
     RETURNING id, booked, capacity`,
    [zone, input.service],
  );
  if (!rows[0]) throw new AppError(409, 'SLOT_FULL', 'All trucks in your area are booked for this hour. Try again shortly.');
  return rows[0] as { id: number; booked: number; capacity: number };
}

const DRIVER_TRANSITIONS: Record<string, string> = { assigned: 'en_route', en_route: 'arrived', arrived: 'completed' };

/**
 * Driver advances a job. Optimistic concurrency: the client sends the version
 * it last saw. If something else changed the booking in between (say the
 * customer cancelled), the UPDATE matches 0 rows and we return 409 with the
 * current state instead of silently overwriting it.
 */
export async function advanceBooking(ctx: Ctx, driverId: string, bookingId: string, next: string, version: number) {
  const result = await withTx(ctx.db, async (tx) => {
    const cur = await tx.query('SELECT status, driver_id, customer_id FROM bookings WHERE id = $1', [bookingId]);
    const b = cur.rows[0];
    if (!b) throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    if (b.driver_id !== driverId) throw new AppError(403, 'FORBIDDEN', 'Not your booking');
    if (DRIVER_TRANSITIONS[b.status] !== next) throw new AppError(409, 'BAD_TRANSITION', `Cannot go from ${b.status} to ${next}`);

    const upd = await tx.query(
      `UPDATE bookings SET status = $3, version = version + 1, updated_at = now()
       WHERE id = $1 AND version = $2 RETURNING customer_id`,
      [bookingId, version, next],
    );
    if (!upd.rows[0]) throw new AppError(409, 'STALE_VERSION', 'Booking changed, refresh and retry');
    await tx.query('INSERT INTO booking_events (booking_id, status, actor_id) VALUES ($1, $2, $3)', [bookingId, next, driverId]);

    if (next === 'completed') {
      await tx.query(`UPDATE drivers SET status = 'available', version = version + 1 WHERE user_id = $1`, [driverId]);
      await bumpCounts(tx, driverId, 'completed_jobs');
      await bumpCounts(tx, b.customer_id, 'completed_jobs');
      await maybeRewardReferral(ctx, tx, b.customer_id);
    }
    return b.customer_id as string;
  });

  const booking = await getBooking(ctx.db, bookingId);
  if (next === 'completed') {
    await syncGeo(ctx, driverId, booking.service, 'available', booking.driverLat, booking.driverLng);
    await track(ctx.db, ctx.flags, result, 'booking_completed', { bookingId });
  }
  await publishBooking(ctx, booking);
  return booking;
}

export async function cancelBooking(ctx: Ctx, customerId: string, bookingId: string) {
  const driverId = await withTx(ctx.db, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE bookings SET status = 'cancelled', version = version + 1, updated_at = now()
       WHERE id = $1 AND customer_id = $2 AND status IN ('requested', 'assigned', 'en_route', 'no_driver')
       RETURNING driver_id, slot_id`,
      [bookingId, customerId],
    );
    if (!rows[0]) throw new AppError(409, 'CANNOT_CANCEL', 'This booking can no longer be cancelled');
    await tx.query(`INSERT INTO booking_events (booking_id, status, actor_id) VALUES ($1, 'cancelled', $2)`, [
      bookingId,
      customerId,
    ]);
    if (rows[0].slot_id) await tx.query('UPDATE slots SET booked = booked - 1 WHERE id = $1 AND booked > 0', [rows[0].slot_id]);
    if (rows[0].driver_id) {
      await tx.query(`UPDATE drivers SET status = 'available', version = version + 1 WHERE user_id = $1`, [rows[0].driver_id]);
      await bumpCounts(tx, customerId, 'cancelled_jobs');
    }
    return rows[0].driver_id as string | null;
  });
  const booking = await getBooking(ctx.db, bookingId);
  if (driverId) await syncGeo(ctx, driverId, booking.service, 'available', booking.driverLat, booking.driverLng);
  await publishBooking(ctx, booking);
  await track(ctx.db, ctx.flags, customerId, 'booking_cancelled', { bookingId });
  return booking;
}

export async function rateBooking(ctx: Ctx, raterId: string, bookingId: string, stars: number, comment?: string) {
  await withTx(ctx.db, async (tx) => {
    const { rows } = await tx.query('SELECT customer_id, driver_id, status FROM bookings WHERE id = $1', [bookingId]);
    const b = rows[0];
    if (!b) throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    if (b.status !== 'completed') throw new AppError(409, 'NOT_COMPLETED', 'You can rate a job once it is completed');
    const ratee = raterId === b.customer_id ? b.driver_id : raterId === b.driver_id ? b.customer_id : null;
    if (!ratee) throw new AppError(403, 'FORBIDDEN', 'Not your booking');
    const ins = await tx.query(
      `INSERT INTO ratings (booking_id, rater_id, ratee_id, stars, comment) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (booking_id, rater_id) DO NOTHING RETURNING id`,
      [bookingId, raterId, ratee, stars, comment ?? null],
    );
    if (!ins.rows[0]) throw new AppError(409, 'ALREADY_RATED', 'You already rated this job');
    await tx.query('UPDATE users SET rating_sum = rating_sum + $2, rating_count = rating_count + 1 WHERE id = $1', [
      ratee,
      stars,
    ]);
    await recomputeTrust(tx, ratee);
  });
  await track(ctx.db, ctx.flags, raterId, 'rating_submitted', { bookingId, stars });
}

async function bumpCounts(tx: Tx, userId: string, column: 'completed_jobs' | 'cancelled_jobs') {
  await tx.query(`UPDATE users SET ${column} = ${column} + 1 WHERE id = $1`, [userId]);
  await recomputeTrust(tx, userId);
}

export async function recomputeTrust(tx: Tx, userId: string) {
  // Row lock so two ratings landing together don't compute from stale counts.
  const { rows } = await tx.query(
    'SELECT rating_sum, rating_count, completed_jobs, cancelled_jobs FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const r = rows[0];
  const score = trustScore({
    ratingSum: r.rating_sum,
    ratingCount: r.rating_count,
    completedJobs: r.completed_jobs,
    cancelledJobs: r.cancelled_jobs,
  });
  await tx.query('UPDATE users SET trust_score = $2 WHERE id = $1', [userId, score]);
}

/**
 * Referral reward is paid on the invitee's first *completed* booking, not on
 * signup, so fake accounts earn nothing. The conditional UPDATE on status
 * means it can only be paid once even if two completions race.
 */
async function maybeRewardReferral(ctx: Ctx, tx: Tx, inviteeId: string) {
  const { rows } = await tx.query('SELECT inviter_id FROM referrals WHERE invitee_id = $1 AND status = $2', [
    inviteeId,
    'pending',
  ]);
  if (!rows[0]) return;
  if (!(await ctx.flags.isOn('referral_rewards', rows[0].inviter_id))) return;
  const reward = config.referralRewardKes;
  const upd = await tx.query(
    `UPDATE referrals SET status = 'rewarded', reward_kes = $2, rewarded_at = now()
     WHERE invitee_id = $1 AND status = 'pending' RETURNING inviter_id`,
    [inviteeId, reward],
  );
  if (!upd.rows[0]) return;
  await tx.query('UPDATE users SET credit_kes = credit_kes + $2 WHERE id = ANY($1::uuid[])', [
    [upd.rows[0].inviter_id, inviteeId],
    reward,
  ]);
  await track(tx, ctx.flags, upd.rows[0].inviter_id, 'referral_rewarded', { inviteeId, reward });
}

export async function publishBooking(ctx: Ctx, booking: Record<string, any>) {
  const eta =
    booking.driverLat != null && ['assigned', 'en_route'].includes(booking.status)
      ? etaMinutes(distanceKm({ lat: booking.driverLat, lng: booking.driverLng }, { lat: booking.lat, lng: booking.lng }))
      : null;
  await ctx.redis.publish(
    CH_BOOKING,
    JSON.stringify({
      type: 'booking',
      bookingId: booking.id,
      customerId: booking.customerId,
      driverId: booking.driverId,
      booking: { ...booking, etaMinutes: eta },
    }),
  );
}
