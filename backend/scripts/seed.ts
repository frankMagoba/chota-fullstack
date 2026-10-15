/**
 * Demo data: ops user, Franklin (demo customer), invitees with referrals,
 * 12 trucks, flags, one A/B experiment with conversion history, completed
 * bookings + ratings, and current-hour slot pressure. Safe to re-run.
 */
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createPool } from '../src/lib/db.js';
import { createRedis, DRIVERS_GEO_KEY } from '../src/lib/redis.js';
import { FlagService } from '../src/services/flags.js';
import { trustScore } from '../src/services/trust.js';
import { zoneFor } from '../src/lib/geo.js';

export const DEMO = {
  ops: { phone: '+254700000001', name: 'Chota Ops' },
  customer: { phone: '+254711000001', name: 'Franklin (demo)', inviteCode: 'CHDEMO21' },
};

// Spread around Lang'ata / Karen / South C / CBD. The 2021 app centred its map on -1.3634, 36.7450.
const TRUCKS: [string, string, 'water' | 'sewage', number, number, number][] = [
  ['Juma Otieno', 'KCA 112W', 'water', 10000, -1.3601, 36.748],
  ['Grace Wanjiru', 'KCB 340W', 'water', 5000, -1.355, 36.76],
  ['Peter Kamau', 'KCC 781W', 'water', 10000, -1.342, 36.765],
  ['Amina Hassan', 'KCD 205W', 'water', 18000, -1.32, 36.78],
  ['Brian Mutua', 'KCE 663W', 'water', 5000, -1.3, 36.8],
  ['Faith Achieng', 'KCF 090W', 'water', 10000, -1.2864, 36.8172],
  ['Kevin Njoroge', 'KCG 418W', 'water', 10000, -1.315, 36.83],
  ['Mercy Chebet', 'KCH 527W', 'water', 5000, -1.37, 36.73],
  ['Samuel Kiprop', 'KDA 301S', 'sewage', 10000, -1.365, 36.755],
  ['Lucy Mwende', 'KDB 744S', 'sewage', 10000, -1.33, 36.77],
  ['Daniel Omondi', 'KDC 158S', 'sewage', 18000, -1.305, 36.81],
  ['Esther Wairimu', 'KDD 932S', 'sewage', 10000, -1.375, 36.74],
];

/** Friends Franklin invited — used for the invite / trust walkthrough. */
const INVITEES: { phone: string; name: string; inviteCode: string; rewarded: boolean; credit?: number }[] = [
  { phone: '+254711000002', name: 'Wanjiku Muthoni', inviteCode: 'CHWANJ01', rewarded: true, credit: 200 },
  { phone: '+254711000003', name: 'Otieno Okoth', inviteCode: 'CHOTIE02', rewarded: true, credit: 200 },
  { phone: '+254711000004', name: 'Njeri Kamau', inviteCode: 'CHNJER03', rewarded: true, credit: 200 },
  { phone: '+254711000005', name: 'Hassan Ali', inviteCode: 'CHHASS04', rewarded: false },
  { phone: '+254711000006', name: 'Achieng Otieno', inviteCode: 'CHACHI05', rewarded: false },
];

/** Past jobs for the demo customer — addresses tagged so re-seed can replace them. */
const DEMO_JOBS: {
  service: 'water' | 'sewage';
  litres: number;
  address: string;
  lat: number;
  lng: number;
  price: number;
  surge: number;
  driverIndex: number;
  stars: number;
  hoursAgo: number;
}[] = [
  {
    service: 'water',
    litres: 10000,
    address: 'Demo: Langata Rd gate B',
    lat: -1.3634,
    lng: 36.745,
    price: 4500,
    surge: 1,
    driverIndex: 0,
    stars: 5,
    hoursAgo: 26,
  },
  {
    service: 'water',
    litres: 5000,
    address: 'Demo: Karen Hardy estate',
    lat: -1.33,
    lng: 36.71,
    price: 2800,
    surge: 1.2,
    driverIndex: 1,
    stars: 5,
    hoursAgo: 50,
  },
  {
    service: 'sewage',
    litres: 10000,
    address: 'Demo: South C flats block 4',
    lat: -1.318,
    lng: 36.835,
    price: 6500,
    surge: 1,
    driverIndex: 8,
    stars: 4,
    hoursAgo: 80,
  },
];

export function driverPhone(i: number) {
  return `+2547220000${String(i + 1).padStart(2, '0')}`;
}

function inviteCodeFor(seed: string) {
  const h = createHash('sha256').update(seed).digest();
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'CH' + Array.from(h.subarray(0, 6), (b) => alphabet[b % alphabet.length]).join('');
}

export async function seed() {
  const db = createPool();
  const redis = createRedis();
  const flags = new FlagService(db);
  try {
    await db.query(
      `INSERT INTO users (phone, name, role, invite_code) VALUES ($1, $2, 'ops', 'CHOPS001')
       ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, role = 'ops'`,
      [DEMO.ops.phone, DEMO.ops.name],
    );

    // Demo customer: credits from 3 rewarded invites, light history for trust.
    const demoTrust = trustScore({
      ratingSum: 14,
      ratingCount: 3,
      completedJobs: 3,
      cancelledJobs: 0,
    });
    const demo = await db.query(
      `INSERT INTO users (phone, name, invite_code, rating_sum, rating_count, completed_jobs, cancelled_jobs, trust_score, credit_kes)
       VALUES ($1, $2, $3, 14, 3, 3, 0, $4, 600)
       ON CONFLICT (phone) DO UPDATE SET
         name = EXCLUDED.name,
         invite_code = EXCLUDED.invite_code,
         rating_sum = EXCLUDED.rating_sum,
         rating_count = EXCLUDED.rating_count,
         completed_jobs = EXCLUDED.completed_jobs,
         cancelled_jobs = EXCLUDED.cancelled_jobs,
         trust_score = EXCLUDED.trust_score,
         credit_kes = EXCLUDED.credit_kes
       RETURNING id`,
      [DEMO.customer.phone, DEMO.customer.name, DEMO.customer.inviteCode, demoTrust],
    );
    const demoId: string = demo.rows[0].id;

    const driverIds: string[] = [];
    for (const [i, [name, plate, service, capacity, lat, lng]] of TRUCKS.entries()) {
      const driverTrust = trustScore({
        ratingSum: 40 + i * 3,
        ratingCount: 9 + (i % 3),
        completedJobs: 20 + i * 7,
        cancelledJobs: i % 4,
      });
      const u = await db.query(
        `INSERT INTO users (phone, name, role, invite_code, rating_sum, rating_count, completed_jobs, cancelled_jobs, trust_score)
         VALUES ($1, $2, 'driver', $3, $4, $5, $6, $7, $8)
         ON CONFLICT (phone) DO UPDATE SET
           name = EXCLUDED.name,
           rating_sum = EXCLUDED.rating_sum,
           rating_count = EXCLUDED.rating_count,
           completed_jobs = EXCLUDED.completed_jobs,
           cancelled_jobs = EXCLUDED.cancelled_jobs,
           trust_score = EXCLUDED.trust_score
         RETURNING id`,
        [
          driverPhone(i),
          name,
          `CHDRV${String(i).padStart(3, '0')}`,
          40 + i * 3,
          9 + (i % 3),
          20 + i * 7,
          i % 4,
          driverTrust,
        ],
      );
      const id = u.rows[0].id as string;
      driverIds.push(id);
      await db.query(
        `INSERT INTO drivers (user_id, service_type, plate, capacity_litres, status, location, location_at)
         VALUES ($1, $2, $3, $4, 'available', ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, now())
         ON CONFLICT (user_id) DO UPDATE SET
           service_type = EXCLUDED.service_type,
           plate = EXCLUDED.plate,
           capacity_litres = EXCLUDED.capacity_litres,
           location = EXCLUDED.location,
           location_at = now(),
           status = CASE WHEN drivers.status = 'busy' THEN drivers.status ELSE 'available' END`,
        [id, service, plate, capacity, lat, lng],
      );
      const d = await db.query(
        `SELECT status, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM drivers WHERE user_id = $1`,
        [id],
      );
      if (d.rows[0].status === 'available') {
        await redis.geoadd(DRIVERS_GEO_KEY(service), d.rows[0].lng, d.rows[0].lat, id);
      }
    }

    const flagsRows: [string, string, boolean, number, boolean][] = [
      ['surge_pricing', 'Up to 1.5x price when a zone/hour slot is over 80% booked', true, 100, true],
      ['referral_rewards', "KES 200 credit to both sides on the invitee's first completed order", true, 100, true],
      ['trust_badge', 'Show the driver trust score on the booking screen', true, 50, true],
      ['llm_status_copy', 'LLM-written booking status line (falls back to templates)', false, 10, true],
    ];
    for (const [key, description, enabled, pct, holdout] of flagsRows) {
      await db.query(
        `INSERT INTO feature_flags (key, description, enabled, rollout_percent, respect_holdout)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET
           description = EXCLUDED.description,
           enabled = EXCLUDED.enabled,
           rollout_percent = EXCLUDED.rollout_percent,
           respect_holdout = EXCLUDED.respect_holdout,
           updated_at = now()`,
        [key, description, enabled, pct, holdout],
      );
    }
    await db.query(
      `INSERT INTO experiments (key, description, variants, metric) VALUES ($1, $2, $3, $4)
       ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, variants = EXCLUDED.variants, metric = EXCLUDED.metric, active = true`,
      [
        'request_button_copy',
        'Does "Get water now" convert better than "Request truck" on the quantity screen?',
        JSON.stringify([
          { name: 'control', weight: 50 },
          { name: 'get_water_now', weight: 50 },
        ]),
        'booking_created',
      ],
    );
    await db.query(
      `INSERT INTO schema_settings (key, value) VALUES ('holdout_percent', '5')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    flags.invalidate();

    // --- Invites / referrals -------------------------------------------------
    const inviteeIds: string[] = [];
    for (const inv of INVITEES) {
      const trust = trustScore({
        ratingSum: inv.rewarded ? 9 : 0,
        ratingCount: inv.rewarded ? 2 : 0,
        completedJobs: inv.rewarded ? 1 : 0,
        cancelledJobs: 0,
      });
      const u = await db.query(
        `INSERT INTO users (phone, name, invite_code, invited_by, rating_sum, rating_count, completed_jobs, trust_score, credit_kes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (phone) DO UPDATE SET
           name = EXCLUDED.name,
           invited_by = EXCLUDED.invited_by,
           rating_sum = EXCLUDED.rating_sum,
           rating_count = EXCLUDED.rating_count,
           completed_jobs = EXCLUDED.completed_jobs,
           trust_score = EXCLUDED.trust_score,
           credit_kes = EXCLUDED.credit_kes
         RETURNING id`,
        [
          inv.phone,
          inv.name,
          inv.inviteCode,
          demoId,
          inv.rewarded ? 9 : 0,
          inv.rewarded ? 2 : 0,
          inv.rewarded ? 1 : 0,
          trust,
          inv.credit ?? 0,
        ],
      );
      inviteeIds.push(u.rows[0].id);
      await db.query(
        `INSERT INTO referrals (inviter_id, invitee_id, status, reward_kes, rewarded_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (invitee_id) DO UPDATE SET
           inviter_id = EXCLUDED.inviter_id,
           status = EXCLUDED.status,
           reward_kes = EXCLUDED.reward_kes,
           rewarded_at = EXCLUDED.rewarded_at`,
        [
          demoId,
          u.rows[0].id,
          inv.rewarded ? 'rewarded' : 'pending',
          inv.rewarded ? 200 : 0,
          inv.rewarded ? new Date(Date.now() - 3 * 86400000) : null,
        ],
      );
    }

    // --- Demo customer's completed jobs + ratings ----------------------------
    await db.query(
      `DELETE FROM ratings WHERE booking_id IN (SELECT id FROM bookings WHERE address LIKE 'Demo:%')`,
    );
    await db.query(`DELETE FROM booking_events WHERE booking_id IN (SELECT id FROM bookings WHERE address LIKE 'Demo:%')`);
    await db.query(`DELETE FROM bookings WHERE address LIKE 'Demo:%'`);

    for (const [i, job] of DEMO_JOBS.entries()) {
      const driverId = driverIds[job.driverIndex];
      const created = new Date(Date.now() - job.hoursAgo * 3600000);
      const b = await db.query(
        `INSERT INTO bookings (
           customer_id, driver_id, service_type, quantity_litres, pickup, address,
           status, price_kes, surge_multiplier, idempotency_key, version, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, $7,
           'completed', $8, $9, $10, 4, $11, $11
         ) RETURNING id`,
        [
          demoId,
          driverId,
          job.service,
          job.litres,
          job.lat,
          job.lng,
          job.address,
          job.price,
          job.surge,
          `seed-demo-job-${i}`,
          created,
        ],
      );
      const bookingId = b.rows[0].id;
      for (const [j, status] of ['requested', 'assigned', 'en_route', 'arrived', 'completed'].entries()) {
        await db.query(
          `INSERT INTO booking_events (booking_id, status, actor_id, at)
           VALUES ($1, $2, $3, $4)`,
          [bookingId, status, j === 0 ? demoId : driverId, new Date(created.getTime() + j * 8 * 60000)],
        );
      }
      await db.query(
        `INSERT INTO ratings (booking_id, rater_id, ratee_id, stars, comment, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          bookingId,
          demoId,
          driverId,
          job.stars,
          job.stars === 5 ? 'On time, full tank.' : 'Good, slight delay at the gate.',
          new Date(created.getTime() + 40 * 60000),
        ],
      );
    }

    // One completed job per rewarded invitee (so "first completed order" story is visible).
    for (const [i, inv] of INVITEES.entries()) {
      if (!inv.rewarded) continue;
      const driverId = driverIds[i % 8];
      const created = new Date(Date.now() - (10 + i) * 86400000);
      const address = `Demo: invitee ${inv.name.split(' ')[0]} delivery`;
      await db.query(`DELETE FROM bookings WHERE address = $1`, [address]);
      const b = await db.query(
        `INSERT INTO bookings (
           customer_id, driver_id, service_type, quantity_litres, pickup, address,
           status, price_kes, surge_multiplier, idempotency_key, version, created_at, updated_at
         ) VALUES (
           $1, $2, 'water', 5000, ST_SetSRID(ST_MakePoint(36.75, -1.36), 4326)::geography, $3,
           'completed', 2500, 1.00, $4, 4, $5, $5
         ) RETURNING id`,
        [inviteeIds[i], driverId, address, `seed-invitee-job-${i}`, created],
      );
      await db.query(
        `INSERT INTO ratings (booking_id, rater_id, ratee_id, stars, created_at)
         VALUES ($1, $2, $3, 5, $4) ON CONFLICT DO NOTHING`,
        [b.rows[0].id, inviteeIds[i], driverId, created],
      );
    }

    // --- Slot capacity pressure for the ops dashboard ------------------------
    const hour = new Date();
    hour.setMinutes(0, 0, 0);
    const zones = [
      zoneFor(-1.3634, 36.745),
      zoneFor(-1.33, 36.71),
      zoneFor(-1.318, 36.835),
    ];
    for (const [i, zone] of zones.entries()) {
      await db.query(
        `INSERT INTO slots (zone, service_type, starts_at, capacity, booked)
         VALUES ($1, 'water', $2, 20, $3)
         ON CONFLICT (zone, service_type, starts_at) DO UPDATE SET booked = EXCLUDED.booked, capacity = 20`,
        [zone, hour, 6 + i * 5],
      );
      await db.query(
        `INSERT INTO slots (zone, service_type, starts_at, capacity, booked)
         VALUES ($1, 'sewage', $2, 12, $3)
         ON CONFLICT (zone, service_type, starts_at) DO UPDATE SET booked = EXCLUDED.booked, capacity = 12`,
        [zone, hour, 2 + i * 2],
      );
    }

    // --- A/B experiment history (deterministic cohort) -----------------------
    // Wipe previous seed analytics so conversion rates stay stable across re-seeds.
    await db.query(`DELETE FROM analytics_events WHERE props->>'seeded' = 'true'`);
    // Also drop leftover race-demo noise so the ops experiments table is readable.
    await db.query(
      `DELETE FROM analytics_events WHERE user_id IN (SELECT id FROM users WHERE name LIKE 'Racer %')`,
    );
    await db.query(`DELETE FROM booking_events WHERE booking_id IN (
      SELECT id FROM bookings WHERE customer_id IN (SELECT id FROM users WHERE name LIKE 'Racer %'))`);
    await db.query(
      `DELETE FROM bookings WHERE customer_id IN (SELECT id FROM users WHERE name LIKE 'Racer %')`,
    );
    await db.query(`DELETE FROM users WHERE name LIKE 'Racer %'`);
    // Race leftovers can leave trucks stuck busy with no active booking.
    await db.query(
      `UPDATE drivers SET status = 'available'
       WHERE status = 'busy'
         AND NOT EXISTS (
           SELECT 1 FROM bookings b
           WHERE b.driver_id = drivers.user_id
             AND b.status IN ('assigned', 'en_route', 'arrived')
         )`,
    );

    const cohortSize = 80;
    let convertedControl = 0;
    let convertedTreatment = 0;
    let holdoutUsers = 0;
    for (let i = 0; i < cohortSize; i++) {
      const phone = `+25473300${String(i).padStart(4, '0')}`;
      const name = `Cohort ${String(i).padStart(2, '0')}`;
      const u = await db.query(
        `INSERT INTO users (phone, name, invite_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [phone, name, inviteCodeFor(`cohort-${i}`)],
      );
      const userId = u.rows[0].id as string;
      const assignments = await flags.assignments(userId);
      if (assignments.holdout) holdoutUsers++;
      const variant = assignments.experiments.request_button_copy ?? 'control';
      const openedAt = new Date(Date.now() - (cohortSize - i) * 3600000);

      await db.query(
        `INSERT INTO analytics_events (user_id, name, props, assignments, created_at)
         VALUES ($1, 'app_opened', $2, $3, $4)`,
        [userId, JSON.stringify({ seeded: true }), assignments, openedAt],
      );
      await db.query(
        `INSERT INTO analytics_events (user_id, name, props, assignments, created_at)
         VALUES ($1, 'quantity_selected', $2, $3, $4)`,
        [userId, JSON.stringify({ seeded: true, litres: 10000 }), assignments, new Date(openedAt.getTime() + 60000)],
      );

      // Treatment converts better (~42%) than control (~28%); holdout stays on control.
      const convertBias = variant === 'get_water_now' ? 0.42 : 0.28;
      const roll = (createHash('sha256').update(`convert:${userId}`).digest()[0] as number) / 255;
      if (roll < convertBias) {
        await db.query(
          `INSERT INTO analytics_events (user_id, name, props, assignments, created_at)
           VALUES ($1, 'booking_created', $2, $3, $4)`,
          [
            userId,
            JSON.stringify({ seeded: true, service: 'water' }),
            assignments,
            new Date(openedAt.getTime() + 120000),
          ],
        );
        if (variant === 'get_water_now') convertedTreatment++;
        else convertedControl++;
      }
    }

    // Seed Franklin's invite_shared event for the drawer story.
    const demoAssign = await flags.assignments(demoId);
    await db.query(`DELETE FROM analytics_events WHERE user_id = $1 AND props->>'seeded' = 'true'`, [demoId]);
    await db.query(
      `INSERT INTO analytics_events (user_id, name, props, assignments, created_at)
       VALUES ($1, 'invite_shared', $2, $3, now() - interval '2 days'),
              ($1, 'referral_rewarded', $2, $3, now() - interval '1 day')`,
      [demoId, JSON.stringify({ seeded: true }), demoAssign],
    );

    console.log(
      `seeded: ops ${DEMO.ops.phone}, customer ${DEMO.customer.phone} (invite ${DEMO.customer.inviteCode}, KES ${600} credit), ` +
        `${TRUCKS.length} trucks, ${INVITEES.length} invitees, ${DEMO_JOBS.length} demo jobs, ` +
        `A/B cohort ${cohortSize} (holdout≈${holdoutUsers}, control→${convertedControl}, treatment→${convertedTreatment})`,
    );
  } finally {
    await db.end();
    await redis.quit();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
