import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addDriver, bookingPayload, login, setupApp } from './helpers.js';

let env: Awaited<ReturnType<typeof setupApp>>;
beforeEach(async () => {
  if (env) await env.app.close();
  env = await setupApp();
});
afterAll(async () => env?.app.close());

const book = (token: string, key = randomUUID(), payload = bookingPayload()) =>
  env.app.inject({
    method: 'POST',
    url: '/bookings',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    payload,
  });

describe('dispatch under concurrency', () => {
  it('30 customers racing for 1 truck: exactly one gets it, nobody is double-booked', async () => {
    const driverId = await addDriver(env.ctx, -1.3601, 36.748);
    const customers = await Promise.all(Array.from({ length: 30 }, () => login(env.app)));
    const results = await Promise.all(customers.map((c) => book(c.token)));

    const bodies = results.map((r) => r.json().booking);
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect(bodies.filter((b) => b.status === 'assigned')).toHaveLength(1);
    expect(bodies.filter((b) => b.status === 'no_driver')).toHaveLength(29);

    const active = await env.ctx.db.query(
      `SELECT count(*)::int AS n FROM bookings WHERE driver_id = $1 AND status IN ('assigned','en_route','arrived')`,
      [driverId],
    );
    expect(active.rows[0].n).toBe(1);
    const d = await env.ctx.db.query('SELECT status FROM drivers WHERE user_id = $1', [driverId]);
    expect(d.rows[0].status).toBe('busy');
  });

  it('10 customers racing for 10 trucks: every booking gets its own truck', async () => {
    for (let i = 0; i < 10; i++) await addDriver(env.ctx, -1.36 + i * 0.001, 36.75);
    const customers = await Promise.all(Array.from({ length: 10 }, () => login(env.app)));
    const bodies = (await Promise.all(customers.map((c) => book(c.token)))).map((r) => r.json().booking);
    const drivers = bodies.map((b) => b.driverId);
    expect(drivers.every(Boolean)).toBe(true);
    expect(new Set(drivers).size).toBe(10);
  });

  it('the same Idempotency-Key sent 15 times at once creates one booking', async () => {
    for (let i = 0; i < 5; i++) await addDriver(env.ctx, -1.36, 36.75 + i * 0.001);
    const c = await login(env.app);
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 15 }, () => book(c.token, key)));
    const ids = new Set(results.map((r) => r.json().booking.id));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
    const n = await env.ctx.db.query('SELECT count(*)::int AS n FROM bookings WHERE customer_id = $1', [c.user.id]);
    expect(n.rows[0].n).toBe(1);
    const busy = await env.ctx.db.query(`SELECT count(*)::int AS n FROM drivers WHERE status = 'busy'`);
    expect(busy.rows[0].n).toBe(1);
  });

  it('surge: slot capacity is never oversold even with more trucks than capacity', async () => {
    await env.ctx.db.query(
      `INSERT INTO slots (zone, service_type, starts_at, capacity) VALUES ('-1.40:36.75', 'water', date_trunc('hour', now()), 4)`,
    );
    for (let i = 0; i < 12; i++) await addDriver(env.ctx, -1.36 + i * 0.0005, 36.75);
    const customers = await Promise.all(Array.from({ length: 12 }, () => login(env.app)));
    const results = await Promise.all(customers.map((c) => book(c.token)));
    const ok = results.filter((r) => r.statusCode === 201);
    const full = results.filter((r) => r.statusCode === 409 && r.json().error === 'SLOT_FULL');
    expect(ok).toHaveLength(4);
    expect(full).toHaveLength(8);
    const slot = await env.ctx.db.query(`SELECT booked, capacity FROM slots WHERE zone = '-1.40:36.75'`);
    expect(slot.rows[0]).toEqual({ booked: 4, capacity: 4 });
    // Surge multiplier kicks in for the last bookings into the slot.
    const surges = ok.map((r) => r.json().booking.surge).sort();
    expect(surges.at(-1)).toBe(1.5);
    // Trucks that were not booked are still available.
    const avail = await env.ctx.db.query(`SELECT count(*)::int AS n FROM drivers WHERE status = 'available'`);
    expect(avail.rows[0].n).toBe(8);
  });

  it('stale version: a driver update after the customer cancelled is rejected', async () => {
    const driverId = await addDriver(env.ctx, -1.36, 36.75);
    const c = await login(env.app);
    const b = (await book(c.token)).json().booking;
    const driverToken = env.app.jwt.sign({ sub: driverId, role: 'driver' });
    await env.app.inject({ method: 'POST', url: `/bookings/${b.id}/cancel`, headers: { authorization: `Bearer ${c.token}` } });
    const res = await env.app.inject({
      method: 'POST',
      url: `/bookings/${b.id}/status`,
      headers: { authorization: `Bearer ${driverToken}` },
      payload: { status: 'en_route', version: b.version },
    });
    expect(res.statusCode).toBe(409);
    const d = await env.ctx.db.query('SELECT status FROM drivers WHERE user_id = $1', [driverId]);
    expect(d.rows[0].status).toBe('available');
  });
});

describe('invites, trust and referral rewards', () => {
  it('pays the referral once, on first completed job, and updates trust from ratings', async () => {
    const driverId = await addDriver(env.ctx, -1.36, 36.75);
    const inviter = await login(env.app);
    const invitee = await login(env.app, { inviteCode: inviter.user.inviteCode });
    const driverToken = env.app.jwt.sign({ sub: driverId, role: 'driver' });
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });

    let b = (await book(invitee.token)).json().booking;
    for (const status of ['en_route', 'arrived', 'completed']) {
      const r = await env.app.inject({
        method: 'POST',
        url: `/bookings/${b.id}/status`,
        headers: auth(driverToken),
        payload: { status, version: b.version },
      });
      expect(r.statusCode).toBe(200);
      b = r.json().booking;
    }
    const me = (await env.app.inject({ method: 'GET', url: '/me', headers: auth(inviter.token) })).json();
    expect(me.user.creditKes).toBe(200);
    expect(me.user.invitesRewarded).toBe(1);

    // Second completed job does not pay again.
    let b2 = (await book(invitee.token)).json().booking;
    for (const status of ['en_route', 'arrived', 'completed']) {
      b2 = (
        await env.app.inject({
          method: 'POST',
          url: `/bookings/${b2.id}/status`,
          headers: auth(driverToken),
          payload: { status, version: b2.version },
        })
      ).json().booking;
    }
    const me2 = (await env.app.inject({ method: 'GET', url: '/me', headers: auth(inviter.token) })).json();
    expect(me2.user.creditKes).toBe(200);

    const before = (await env.ctx.db.query('SELECT trust_score FROM users WHERE id = $1', [driverId])).rows[0].trust_score;
    const rate = await env.app.inject({
      method: 'POST',
      url: `/bookings/${b.id}/rating`,
      headers: auth(invitee.token),
      payload: { stars: 5 },
    });
    expect(rate.statusCode).toBe(200);
    const again = await env.app.inject({
      method: 'POST',
      url: `/bookings/${b.id}/rating`,
      headers: auth(invitee.token),
      payload: { stars: 5 },
    });
    expect(again.statusCode).toBe(409);
    const after = (await env.ctx.db.query('SELECT trust_score FROM users WHERE id = $1', [driverId])).rows[0].trust_score;
    expect(after).toBeGreaterThan(before);
  });

  it('rejects unknown and self invite codes', async () => {
    const bad = await env.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { phone: '+254799999999', inviteCode: 'NOPE1234' },
    });
    expect(bad.statusCode).toBe(400);
    const u = await login(env.app);
    const self = await env.app.inject({
      method: 'POST',
      url: '/me/invite',
      headers: { authorization: `Bearer ${u.token}` },
      payload: { code: u.user.inviteCode },
    });
    expect(self.statusCode).toBe(400);
  });
});

describe('ops surface', () => {
  it('exposes health, readiness and Prometheus metrics', async () => {
    expect((await env.app.inject('/health')).statusCode).toBe(200);
    expect((await env.app.inject('/ready')).json().ok).toBe(true);
    const m = await env.app.inject('/metrics');
    expect(m.body).toContain('chota_http_request_duration_seconds');
    expect(m.body).toContain('chota_uptime_seconds');
  });
  it('requires an idempotency key on bookings', async () => {
    const c = await login(env.app);
    const r = await env.app.inject({
      method: 'POST',
      url: '/bookings',
      headers: { authorization: `Bearer ${c.token}` },
      payload: bookingPayload(),
    });
    expect(r.statusCode).toBe(400);
  });
});
