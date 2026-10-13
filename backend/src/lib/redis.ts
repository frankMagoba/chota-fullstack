import { Redis } from 'ioredis';
import { config } from '../config.js';

export const DRIVERS_GEO_KEY = (service: string) => `chota:drivers:geo:${service}`;
export const DRIVER_SEEN_KEY = 'chota:drivers:last_seen';

// Pub/sub channels. Every API instance subscribes to these and forwards to
// its own WebSocket clients, so we can run more than one instance.
export const CH_DRIVER_LOCATION = 'chota:driver_location';
export const CH_BOOKING = 'chota:booking';
export const CH_AVAILABILITY = 'chota:availability';

export function createRedis(url = config.redisUrl) {
  return new Redis(url, { maxRetriesPerRequest: 3 });
}
export type RedisClient = Redis;
