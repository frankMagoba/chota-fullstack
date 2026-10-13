import { CH_AVAILABILITY, CH_BOOKING, CH_DRIVER_LOCATION, DRIVERS_GEO_KEY, DRIVER_SEEN_KEY } from '../lib/redis.js';
import type { Ctx } from './context.js';
import type { Service } from './pricing.js';
import { AppError } from '../lib/errors.js';

export interface NearbyDriver {
  driverId: string;
  lat: number;
  lng: number;
  distanceKm: number;
}

/**
 * Live positions live in Redis GEO (one sorted set per service type) because
 * they change every few seconds. Postgres gets the latest position too, but
 * that's for the fallback query and history, not the hot path.
 * Only *available* drivers are in the GEO set, so "nearby" == "bookable".
 */
export async function nearbyDrivers(ctx: Ctx, service: Service, lat: number, lng: number, radiusKm: number, count = 20) {
  const raw = (await ctx.redis.geosearch(
    DRIVERS_GEO_KEY(service),
    'FROMLONLAT',
    lng,
    lat,
    'BYRADIUS',
    radiusKm,
    'km',
    'ASC',
    'COUNT',
    count,
    'WITHCOORD',
    'WITHDIST',
  )) as [string, string, [string, string]][];
  return raw.map(([driverId, dist, [lon, la]]) => ({
    driverId,
    distanceKm: Number(dist),
    lat: Number(la),
    lng: Number(lon),
  })) as NearbyDriver[];
}

export async function updateLocation(ctx: Ctx, driverId: string, lat: number, lng: number) {
  const { rows } = await ctx.db.query(
    `UPDATE drivers SET location = ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, location_at = now()
     WHERE user_id = $1 RETURNING service_type, status`,
    [driverId, lng, lat],
  );
  if (!rows[0]) throw new AppError(404, 'NOT_A_DRIVER', 'Driver profile not found');
  const { service_type: service, status } = rows[0];
  const multi = ctx.redis.multi().zadd(DRIVER_SEEN_KEY, Date.now(), driverId);
  if (status === 'available') multi.geoadd(DRIVERS_GEO_KEY(service), lng, lat, driverId);
  await multi.exec();
  await ctx.redis.publish(CH_DRIVER_LOCATION, JSON.stringify({ driverId, service, status, lat, lng }));

  // If the driver is on a job, the customer tracking that booking gets the position too.
  const active = await ctx.db.query(
    `SELECT id, customer_id FROM bookings WHERE driver_id = $1 AND status IN ('assigned','en_route','arrived')`,
    [driverId],
  );
  if (active.rows[0]) {
    await ctx.redis.publish(
      CH_BOOKING,
      JSON.stringify({
        type: 'driver_location',
        bookingId: active.rows[0].id,
        customerId: active.rows[0].customer_id,
        driverId,
        lat,
        lng,
      }),
    );
  }
  return { service, status };
}

export async function setStatus(ctx: Ctx, driverId: string, status: 'available' | 'offline') {
  const { rows } = await ctx.db.query(
    `UPDATE drivers SET status = $2, version = version + 1
     WHERE user_id = $1 AND status <> 'busy'
     RETURNING service_type, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`,
    [driverId, status],
  );
  if (!rows[0]) throw new AppError(409, 'DRIVER_BUSY', 'Finish the current job before changing status');
  await syncGeo(ctx, driverId, rows[0].service_type, status, rows[0].lat, rows[0].lng);
}

/** Keep the Redis GEO set in line with the driver's DB status. */
export async function syncGeo(
  ctx: Ctx,
  driverId: string,
  service: Service,
  status: string,
  lat: number | null,
  lng: number | null,
) {
  if (status === 'available' && lat != null && lng != null) {
    await ctx.redis.geoadd(DRIVERS_GEO_KEY(service), lng, lat, driverId);
  } else {
    await ctx.redis.zrem(DRIVERS_GEO_KEY(service), driverId);
  }
  await ctx.redis.publish(CH_AVAILABILITY, JSON.stringify({ driverId, service, status, lat, lng }));
}
