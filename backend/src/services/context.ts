import type { Db } from '../lib/db.js';
import type { RedisClient } from '../lib/redis.js';
import type { FlagService } from './flags.js';

export interface Ctx {
  db: Db;
  redis: RedisClient;
  flags: FlagService;
}
