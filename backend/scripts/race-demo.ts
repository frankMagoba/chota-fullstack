/**
 * Live demo of the double-booking guard against the running API.
 * Signs up N fresh customers and fires their booking requests at the same
 * instant, all at the same spot. Prints who got which truck.
 *
 *   npm run race            # 25 customers
 *   RACE_N=50 npm run race
 */
const API = process.env.API_URL ?? 'http://localhost:4000';
const N = Number(process.env.RACE_N ?? 25);
const AT = { lat: -1.3634, lng: 36.745 };

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const run = Date.now().toString().slice(-6);
const customers = await Promise.all(
  Array.from({ length: N }, (_, i) =>
    post('/auth/login', { phone: `+2547${run}${String(i).padStart(3, '0')}`, name: `Racer ${i}` }),
  ),
);
console.log(`${N} customers requesting water at the same spot, same moment...`);
const t0 = performance.now();
const results = await Promise.all(
  customers.map((c, i) =>
    post(
      '/bookings',
      { service: 'water', quantityLitres: 5000, ...AT, address: `Race ${i}` },
      {
        authorization: `Bearer ${c.body.token}`,
        'idempotency-key': `race-${run}-${i}`,
      },
    ),
  ),
);
const ms = Math.round(performance.now() - t0);
const assigned = results.filter((r) => r.body.booking?.status === 'assigned');
const drivers = assigned.map((r) => r.body.booking.driverId);
console.log(`done in ${ms} ms`);
console.log(`assigned:  ${assigned.length}`);
console.log(`no truck:  ${results.filter((r) => r.body.booking?.status === 'no_driver').length}`);
console.log(`slot full: ${results.filter((r) => r.body.error === 'SLOT_FULL').length}`);
console.log(`distinct trucks among assigned: ${new Set(drivers).size} (must equal assigned)`);
for (const r of assigned) console.log(`  ${r.body.booking.driverName.padEnd(16)} ${r.body.booking.driverPlate}`);
if (new Set(drivers).size !== assigned.length) {
  console.error('DOUBLE BOOKING DETECTED');
  process.exit(1);
}
