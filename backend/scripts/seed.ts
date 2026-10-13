/**
 * Demo data: an ops user, a demo customer, 12 trucks around Nairobi, flags and
 * one experiment. Safe to re-run.
 */
import { fileURLToPath } from 'node:url';
import { createPool } from '../src/lib/db.js';
import { createRedis, DRIVERS_GEO_KEY } from '../src/lib/redis.js';

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

export function driverPhone(i: number) {
  return `+2547220000${String(i + 1).padStart(2, '0')}`;
}

export async function seed() {
  const db = createPool();
  const redis = createRedis();
  try {
    await db.query(
      `INSERT INTO users (phone, name, role, invite_code) VALUES ($1, $2, 'ops', 'CHOPS001') ON CONFLICT (phone) DO NOTHING`,
      [DEMO.ops.phone, DEMO.ops.name],
    );
    await db.query(`INSERT INTO users (phone, name, invite_code) VALUES ($1, $2, $3) ON CONFLICT (phone) DO NOTHING`, [
      DEMO.customer.phone,
      DEMO.customer.name,
      DEMO.customer.inviteCode,
    ]);
    for (const [i, [name, plate, service, capacity, lat, lng]] of TRUCKS.entries()) {
      const u = await db.query(
        `INSERT INTO users (phone, name, role, invite_code, rating_sum, rating_count, completed_jobs, trust_score)
         VALUES ($1, $2, 'driver', $3, $4, $5, $6, $7)
         ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [driverPhone(i), name, `CHDRV${String(i).padStart(3, '0')}`, 40 + i, 9 + (i % 3), 20 + i * 7, 70 + (i % 5) * 4],
      );
      const id = u.rows[0].id;
      await db.query(
        `INSERT INTO drivers (user_id, service_type, plate, capacity_litres, status, location, location_at)
         VALUES ($1, $2, $3, $4, 'available', ST_SetSRID(ST_MakePoint($6, $5), 4326)::geography, now())
         ON CONFLICT (user_id) DO NOTHING`,
        [id, service, plate, capacity, lat, lng],
      );
      const d = await db.query(
        `SELECT status, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM drivers WHERE user_id = $1`,
        [id],
      );
      if (d.rows[0].status === 'available') await redis.geoadd(DRIVERS_GEO_KEY(service), d.rows[0].lng, d.rows[0].lat, id);
    }

    const flags: [string, string, boolean, number, boolean][] = [
      ['surge_pricing', 'Up to 1.5x price when a zone/hour slot is over 80% booked', true, 100, true],
      ['referral_rewards', "KES 200 credit to both sides on the invitee's first completed order", true, 100, true],
      ['trust_badge', 'Show the driver trust score on the booking screen', true, 50, true],
      ['llm_status_copy', 'LLM-written booking status line (falls back to templates)', false, 10, true],
    ];
    for (const [key, description, enabled, pct, holdout] of flags) {
      await db.query(
        `INSERT INTO feature_flags (key, description, enabled, rollout_percent, respect_holdout)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING`,
        [key, description, enabled, pct, holdout],
      );
    }
    await db.query(
      `INSERT INTO experiments (key, description, variants, metric) VALUES ($1, $2, $3, $4) ON CONFLICT (key) DO NOTHING`,
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
    console.log(
      `seeded: ops ${DEMO.ops.phone}, customer ${DEMO.customer.phone} (invite ${DEMO.customer.inviteCode}), ${TRUCKS.length} trucks`,
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
