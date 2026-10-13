import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import { config } from './config.js';
import { createPool, type Db } from './lib/db.js';
import { createRedis, type RedisClient } from './lib/redis.js';
import { AppError } from './lib/errors.js';
import { httpDuration, httpErrors } from './lib/metrics.js';
import { FlagService } from './services/flags.js';
import { registerRoutes } from './routes/index.js';
import { registerRealtime } from './realtime.js';
import type { Ctx } from './services/context.js';

export async function buildApp(opts: { db?: Db; redis?: RedisClient; logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  const db = opts.db ?? createPool();
  const redis = opts.redis ?? createRedis();
  const ctx: Ctx = { db, redis, flags: new FlagService(db) };

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(websocket);

  app.addHook('onResponse', async (req, reply) => {
    const route = req.routeOptions.url ?? 'unknown';
    if (route === '/metrics') return;
    httpDuration.observe({ method: req.method, route, status: reply.statusCode }, reply.elapsedTime / 1000);
    if (reply.statusCode >= 400) httpErrors.inc({ route, class: reply.statusCode >= 500 ? '5xx' : '4xx' });
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: err.code, message: err.message });
    if (err instanceof ZodError)
      return reply
        .code(400)
        .send({ error: 'VALIDATION', message: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    // Unique-violation from the one-active-booking-per-driver index: a race we lost.
    if (err?.code === '23505') return reply.code(409).send({ error: 'CONFLICT', message: 'Conflicting update, please retry' });
    if (err?.statusCode && err.statusCode < 500)
      return reply.code(err.statusCode).send({ error: 'BAD_REQUEST', message: err.message });
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL', message: 'Something went wrong' });
  });

  await registerRoutes(app, ctx);
  await registerRealtime(app, ctx);

  app.addHook('onClose', async () => {
    if (!opts.db) await db.end();
    if (!opts.redis) await redis.quit();
  });
  return { app, ctx };
}
