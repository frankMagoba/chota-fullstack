/**
 * Moves the seeded trucks around so the map has something live to show.
 * Each simulated driver logs in through the public API (same path a real
 * driver app would use), wanders near its start point, and when it gets a
 * job it drives to the pickup and walks the booking through
 * en_route -> arrived -> completed.
 *
 *   API_URL=http://localhost:4000 npm run simulate
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const COUNT = Number(process.env.SIM_DRIVERS ?? 6);
const TICK_MS = Number(process.env.SIM_TICK_MS ?? 3000);
const STEP_KM = 0.1; // ~180 km/h at a 2s tick. Fast on purpose so a demo doesn't drag.

function phone(i: number) {
  return `+2547220000${String(i + 1).padStart(2, '0')}`;
}

async function call(token: string | null, method: string, path: string, body?: unknown) {
  const res = await fetch(API + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify(data)}`);
  return data as any;
}

function stepToward(from: { lat: number; lng: number }, to: { lat: number; lng: number }, km: number) {
  const dLat = to.lat - from.lat;
  const dLng = to.lng - from.lng;
  const distKm = Math.sqrt(dLat ** 2 + dLng ** 2) * 111;
  if (distKm <= km) return { pos: { ...to }, arrived: true };
  const f = km / distKm;
  return { pos: { lat: from.lat + dLat * f, lng: from.lng + dLng * f }, arrived: false };
}

interface Sim {
  token: string;
  name: string;
  home: { lat: number; lng: number };
  pos: { lat: number; lng: number };
  target: { lat: number; lng: number };
  wait: number;
}

async function main() {
  const sims: Sim[] = [];
  for (let i = 0; i < COUNT; i++) {
    const { token, user } = await call(null, 'POST', '/auth/login', { phone: phone(i) });
    if (user.role !== 'driver') throw new Error(`${phone(i)} is not a seeded driver. Run npm run seed first.`);
    const job = await call(token, 'GET', '/drivers/me/job');
    // Scatter around Lang'ata/Karen, where the app's default map centre is.
    const start = { lat: -1.355 + (Math.random() - 0.5) * 0.06, lng: 36.755 + (Math.random() - 0.5) * 0.07 };
    sims.push({ token, name: user.name, home: start, pos: start, target: start, wait: 0 });
    await call(token, 'POST', '/drivers/me/location', start);
    if (!job.booking) await call(token, 'POST', '/drivers/me/status', { status: 'available' }).catch(() => {});
  }
  console.log(`simulating ${sims.length} drivers against ${API}`);

  setInterval(() => {
    for (const s of sims) tick(s).catch((e) => console.error(s.name, e.message));
  }, TICK_MS);
}

async function tick(s: Sim) {
  const { booking } = await call(s.token, 'GET', '/drivers/me/job');
  if (booking) {
    if (s.wait > 0) {
      s.wait--;
      return;
    }
    if (booking.status === 'assigned') {
      await call(s.token, 'POST', `/bookings/${booking.id}/status`, { status: 'en_route', version: booking.version });
      console.log(`${s.name}: en route to ${booking.address}`);
      return;
    }
    if (booking.status === 'en_route') {
      const { pos, arrived } = stepToward(s.pos, { lat: booking.lat, lng: booking.lng }, STEP_KM);
      s.pos = pos;
      await call(s.token, 'POST', '/drivers/me/location', pos);
      if (arrived) {
        await call(s.token, 'POST', `/bookings/${booking.id}/status`, { status: 'arrived', version: booking.version });
        console.log(`${s.name}: arrived`);
        s.wait = 5; // "pumping" for ~10s
      }
      return;
    }
    if (booking.status === 'arrived') {
      await call(s.token, 'POST', `/bookings/${booking.id}/status`, { status: 'completed', version: booking.version });
      console.log(`${s.name}: completed`);
      s.home = s.pos;
      return;
    }
    return;
  }
  // Idle: wander around home.
  const { pos, arrived } = stepToward(s.pos, s.target, STEP_KM / 3);
  s.pos = pos;
  if (arrived) s.target = { lat: s.home.lat + (Math.random() - 0.5) * 0.02, lng: s.home.lng + (Math.random() - 0.5) * 0.02 };
  await call(s.token, 'POST', '/drivers/me/location', pos);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
