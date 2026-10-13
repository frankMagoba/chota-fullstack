import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../lib/errors.js';
import { registry } from '../lib/metrics.js';
import { config } from '../config.js';
import type { Ctx } from '../services/context.js';
import * as bookings from '../services/bookings.js';
import * as drivers from '../services/drivers.js';
import * as users from '../services/users.js';
import { EVENT_NAMES, track } from '../services/analytics.js';
import { statusMessage } from '../services/llm.js';
import { distanceKm, etaMinutes } from '../lib/geo.js';

const service = z.enum(['water', 'sewage']);
const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

type Authed = FastifyRequest & { user: { sub: string; role: string } };

export async function registerRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = async (req: FastifyRequest) => {
    try {
      await req.jwtVerify();
    } catch {
      throw new AppError(401, 'UNAUTHORIZED', 'Sign in first');
    }
  };
  const role = (r: string) => async (req: FastifyRequest) => {
    await auth(req);
    if ((req as Authed).user.role !== r) throw new AppError(403, 'FORBIDDEN', `Requires role ${r}`);
  };
  const uid = (req: FastifyRequest) => (req as Authed).user.sub;

  // --- health and metrics -------------------------------------------------
  app.get('/health', async () => ({ ok: true }));
  app.get('/ready', async (_req, reply) => {
    const checks: Record<string, boolean> = {};
    checks.postgres = await ctx.db.query('SELECT 1').then(
      () => true,
      () => false,
    );
    checks.redis = await ctx.redis.ping().then(
      (r) => r === 'PONG',
      () => false,
    );
    const ok = Object.values(checks).every(Boolean);
    return reply.code(ok ? 200 : 503).send({ ok, checks });
  });
  app.get('/metrics', async (_req, reply) => reply.type(registry.contentType).send(await registry.metrics()));

  // --- auth -----------------------------------------------------------------
  // Demo login: phone number only. The 2021 app had SMS OTP screens; the real
  // OTP provider is out of scope for this rebuild (see docs/DESIGN.md).
  app.post('/auth/login', async (req) => {
    const body = z
      .object({
        phone: z.string().min(9).max(16),
        name: z.string().min(1).max(60).optional(),
        inviteCode: z.string().max(12).optional(),
      })
      .parse(req.body);
    const u = await users.loginOrRegister(ctx, body.phone, body.name, body.inviteCode || undefined);
    const token = app.jwt.sign({ sub: u.id, role: u.role }, { expiresIn: '7d' });
    return { token, user: await users.profile(ctx, u.id), created: u.created };
  });

  app.get('/me', { preHandler: auth }, async (req) => ({
    user: await users.profile(ctx, uid(req)),
    assignments: await ctx.flags.assignments(uid(req)),
  }));

  app.post('/me/invite', { preHandler: auth }, async (req) => {
    const { code } = z.object({ code: z.string().min(4).max(12) }).parse(req.body);
    await users.redeemInvite(ctx, uid(req), code);
    return { ok: true };
  });

  // --- drivers --------------------------------------------------------------
  app.get('/drivers/nearby', { preHandler: auth }, async (req) => {
    const q = z.object({ lat, lng, service }).parse(req.query);
    const list = await drivers.nearbyDrivers(ctx, q.service, q.lat, q.lng, config.dispatchRadiusKm);
    return { drivers: list.map((d) => ({ ...d, etaMinutes: etaMinutes(d.distanceKm) })) };
  });

  app.post('/drivers/me/location', { preHandler: role('driver') }, async (req) => {
    const b = z.object({ lat, lng }).parse(req.body);
    return drivers.updateLocation(ctx, uid(req), b.lat, b.lng);
  });

  app.post('/drivers/me/status', { preHandler: role('driver') }, async (req) => {
    const b = z.object({ status: z.enum(['available', 'offline']) }).parse(req.body);
    await drivers.setStatus(ctx, uid(req), b.status);
    return { ok: true };
  });

  app.get('/drivers/me/job', { preHandler: role('driver') }, async (req) => {
    const { rows } = await ctx.db.query(
      `SELECT id FROM bookings WHERE driver_id = $1 AND status IN ('assigned','en_route','arrived') LIMIT 1`,
      [uid(req)],
    );
    return { booking: rows[0] ? await bookings.getBooking(ctx.db, rows[0].id) : null };
  });

  // --- bookings -------------------------------------------------------------
  app.post('/bookings', { preHandler: auth }, async (req, reply) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 64) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header (8-64 chars)');
    }
    const body = z
      .object({
        service,
        quantityLitres: z.number().int().min(1000).max(20000),
        lat,
        lng,
        address: z.string().min(2).max(200),
      })
      .parse(req.body);
    const { booking, replayed } = await bookings.createBooking(ctx, uid(req), key, body);
    return reply
      .code(replayed ? 200 : 201)
      .header('idempotent-replayed', String(replayed))
      .send({ booking });
  });

  app.get('/bookings', { preHandler: auth }, async (req) => {
    const { rows } = await ctx.db.query(
      'SELECT id FROM bookings WHERE customer_id = $1 OR driver_id = $1 ORDER BY created_at DESC LIMIT 30',
      [uid(req)],
    );
    return { bookings: await Promise.all(rows.map((r) => bookings.getBooking(ctx.db, r.id))) };
  });

  app.get('/bookings/:id', { preHandler: auth }, async (req) => {
    const b = await bookings.getBooking(ctx.db, (req.params as { id: string }).id);
    const me = (req as Authed).user;
    if (!b || (b.customerId !== me.sub && b.driverId !== me.sub && me.role !== 'ops'))
      throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    return { booking: b };
  });

  app.post('/bookings/:id/status', { preHandler: role('driver') }, async (req) => {
    const body = z.object({ status: z.enum(['en_route', 'arrived', 'completed']), version: z.number().int() }).parse(req.body);
    return {
      booking: await bookings.advanceBooking(ctx, uid(req), (req.params as { id: string }).id, body.status, body.version),
    };
  });

  app.post('/bookings/:id/cancel', { preHandler: auth }, async (req) => ({
    booking: await bookings.cancelBooking(ctx, uid(req), (req.params as { id: string }).id),
  }));

  app.post('/bookings/:id/rating', { preHandler: auth }, async (req) => {
    const body = z.object({ stars: z.number().int().min(1).max(5), comment: z.string().max(280).optional() }).parse(req.body);
    await bookings.rateBooking(ctx, uid(req), (req.params as { id: string }).id, body.stars, body.comment);
    return { ok: true };
  });

  app.get('/bookings/:id/message', { preHandler: auth }, async (req) => {
    const q = z.object({ lang: z.enum(['en', 'sw']).default('en') }).parse(req.query);
    const b = await bookings.getBooking(ctx.db, (req.params as { id: string }).id);
    if (!b || (b.customerId !== uid(req) && b.driverId !== uid(req))) throw new AppError(404, 'NOT_FOUND', 'Booking not found');
    const eta = b.driverLat != null ? etaMinutes(distanceKm({ lat: b.driverLat, lng: b.driverLng }, b)) : null;
    const useLlm = await ctx.flags.isOn('llm_status_copy', uid(req));
    return statusMessage({ status: b.status, service: b.service, driverName: b.driverName, etaMinutes: eta }, q.lang, useLlm);
  });

  // --- analytics + referrals -------------------------------------------------
  app.post('/events', { preHandler: auth }, async (req, reply) => {
    const body = z.object({ name: z.enum(EVENT_NAMES), props: z.record(z.string(), z.unknown()).default({}) }).parse(req.body);
    await track(ctx.db, ctx.flags, uid(req), body.name, body.props);
    return reply.code(202).send({ ok: true });
  });

  app.get('/referrals/me', { preHandler: auth }, async (req) => {
    const { rows } = await ctx.db.query(
      `SELECT u.name, r.status, r.reward_kes AS "rewardKes", r.created_at AS "createdAt"
       FROM referrals r JOIN users u ON u.id = r.invitee_id WHERE r.inviter_id = $1 ORDER BY r.created_at DESC`,
      [uid(req)],
    );
    return { referrals: rows };
  });

  // --- ops (used by the web dashboard) ------------------------------------------
  const ops = { preHandler: role('ops') };
  app.get('/ops/bookings', ops, async () => {
    const { rows } = await ctx.db.query('SELECT id FROM bookings ORDER BY created_at DESC LIMIT 50');
    return { bookings: await Promise.all(rows.map((r) => bookings.getBooking(ctx.db, r.id))) };
  });
  app.get('/ops/drivers', ops, async () => {
    const { rows } = await ctx.db.query(
      `SELECT d.user_id AS id, u.name, d.plate, d.service_type AS service, d.status, u.trust_score AS "trustScore",
         u.completed_jobs AS "completedJobs", ST_Y(d.location::geometry) AS lat, ST_X(d.location::geometry) AS lng
       FROM drivers d JOIN users u ON u.id = d.user_id ORDER BY u.name`,
    );
    return { drivers: rows };
  });
  app.get('/ops/slots', ops, async () => {
    const { rows } = await ctx.db.query(
      `SELECT zone, service_type AS service, starts_at AS "startsAt", capacity, booked FROM slots
       WHERE starts_at >= date_trunc('hour', now()) - interval '1 hour' ORDER BY booked DESC LIMIT 20`,
    );
    return { slots: rows };
  });
  app.get('/ops/flags', ops, async () => {
    const [flags, exps, holdout] = await Promise.all([
      ctx.db.query('SELECT * FROM feature_flags ORDER BY key'),
      ctx.db.query('SELECT * FROM experiments ORDER BY key'),
      ctx.db.query(`SELECT value FROM schema_settings WHERE key = 'holdout_percent'`),
    ]);
    return { flags: flags.rows, experiments: exps.rows, holdoutPercent: Number(holdout.rows[0]?.value ?? 0) };
  });
  app.put('/ops/flags/:key', ops, async (req) => {
    const body = z.object({ enabled: z.boolean(), rolloutPercent: z.number().min(0).max(100) }).parse(req.body);
    const { rows } = await ctx.db.query(
      'UPDATE feature_flags SET enabled = $2, rollout_percent = $3, updated_at = now() WHERE key = $1 RETURNING *',
      [(req.params as { key: string }).key, body.enabled, body.rolloutPercent],
    );
    if (!rows[0]) throw new AppError(404, 'NOT_FOUND', 'No such flag');
    ctx.flags.invalidate();
    return { flag: rows[0] };
  });
  // Conversion by variant: users who saw the experiment (any event carrying the
  // assignment) vs users who fired the experiment's metric event.
  app.get('/ops/experiments/:key/results', ops, async (req) => {
    const key = (req.params as { key: string }).key;
    const exp = await ctx.db.query('SELECT metric FROM experiments WHERE key = $1', [key]);
    if (!exp.rows[0]) throw new AppError(404, 'NOT_FOUND', 'No such experiment');
    const { rows } = await ctx.db.query(
      `SELECT assignments->'experiments'->>$1 AS variant,
              (assignments->>'holdout')::boolean AS holdout,
              count(DISTINCT user_id)::int AS users,
              count(DISTINCT user_id) FILTER (WHERE name = $2)::int AS converted
       FROM analytics_events
       WHERE assignments->'experiments' ? $1
       GROUP BY 1, 2 ORDER BY 1, 2`,
      [key, exp.rows[0].metric],
    );
    return { metric: exp.rows[0].metric, results: rows };
  });
}
