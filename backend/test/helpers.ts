import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/app.js';
import { DRIVERS_GEO_KEY } from '../src/lib/redis.js';

export async function setupApp() {
  const { app, ctx } = await buildApp({ logger: false });
  await ctx.redis.flushdb();
  await ctx.db.query(
    `TRUNCATE analytics_events, ratings, referrals, booking_events, bookings, slots, drivers, feature_flags, experiments, users RESTART IDENTITY CASCADE`,
  );
  await ctx.db.query(`INSERT INTO feature_flags (key, enabled, rollout_percent, respect_holdout) VALUES
    ('surge_pricing', true, 100, false), ('referral_rewards', true, 100, false)`);
  ctx.flags.invalidate();
  return { app, ctx };
}

type App = Awaited<ReturnType<typeof setupApp>>['app'];
type Ctx = Awaited<ReturnType<typeof setupApp>>['ctx'];

let n = 0;
export async function login(app: App, extra: Record<string, unknown> = {}) {
  const phone = `+2547${String(Date.now()).slice(-6)}${String(n++).padStart(3, '0')}`;
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { phone, name: `User ${n}`, ...extra } });
  if (res.statusCode !== 200) throw new Error(res.body);
  return res.json() as { token: string; user: { id: string; inviteCode: string } };
}

export async function addDriver(ctx: Ctx, lat: number, lng: number, service: 'water' | 'sewage' = 'water') {
  const u = await ctx.db.query(
    `INSERT INTO users (phone, name, role, invite_code) VALUES ($1, 'Driver', 'driver', $2) RETURNING id`,
    [`+2549${randomUUID().slice(0, 8)}`, `D${randomUUID().slice(0, 8)}`],
  );
  const id = u.rows[0].id as string;
  await ctx.db.query(
    `INSERT INTO drivers (user_id, service_type, plate, capacity_litres, status, location)
     VALUES ($1, $2, 'KXX 000X', 20000, 'available', ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography)`,
    [id, service, lat, lng],
  );
  await ctx.redis.geoadd(DRIVERS_GEO_KEY(service), lng, lat, id);
  return id;
}

export function bookingPayload(lat = -1.36, lng = 36.75) {
  return { service: 'water', quantityLitres: 5000, lat, lng, address: 'Langata Rd' };
}
