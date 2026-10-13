import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { CH_AVAILABILITY, CH_BOOKING, CH_DRIVER_LOCATION, createRedis } from './lib/redis.js';
import { distanceKm } from './lib/geo.js';
import { wsConnections } from './lib/metrics.js';
import type { Ctx } from './services/context.js';
import { config } from './config.js';

interface Client {
  socket: WebSocket;
  userId: string;
  role: string;
  nearby?: { lat: number; lng: number; service: string; radiusKm: number };
  bookings: Set<string>;
  ops: boolean;
}

/**
 * WebSocket fan-out. Writes never go to sockets directly: services publish to
 * Redis, and every instance's subscriber forwards to the sockets it holds.
 * That keeps instances stateless apart from their open sockets, so we can
 * scale horizontally behind a load balancer with sticky-free routing.
 */
export async function registerRealtime(app: FastifyInstance, ctx: Ctx) {
  const clients = new Set<Client>();
  const sub = createRedis();
  await sub.subscribe(CH_DRIVER_LOCATION, CH_BOOKING, CH_AVAILABILITY);

  sub.on('message', (channel, raw) => {
    const msg = JSON.parse(raw);
    for (const c of clients) {
      if (c.socket.readyState !== 1) continue;
      if (channel === CH_BOOKING) {
        if (c.ops || c.bookings.has(msg.bookingId) || c.userId === msg.customerId || c.userId === msg.driverId) {
          c.socket.send(JSON.stringify(msg));
        }
      } else if (c.ops) {
        c.socket.send(JSON.stringify({ type: channel === CH_DRIVER_LOCATION ? 'driver_location' : 'availability', ...msg }));
      } else if (c.nearby && msg.service === c.nearby.service) {
        // Customers only get trucks inside their radius. Busy/offline updates go out too
        // so the app can remove the marker.
        const inRange = msg.lat == null || distanceKm(c.nearby, { lat: msg.lat, lng: msg.lng }) <= c.nearby.radiusKm;
        if (inRange) {
          c.socket.send(JSON.stringify({ type: channel === CH_DRIVER_LOCATION ? 'driver_location' : 'availability', ...msg }));
        }
      }
    }
  });

  app.addHook('onClose', async () => {
    await sub.quit();
  });

  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as Record<string, string>).token;
    let user: { sub: string; role: string };
    try {
      user = app.jwt.verify(token);
    } catch {
      socket.close(4401, 'unauthorized');
      return;
    }
    const client: Client = { socket, userId: user.sub, role: user.role, bookings: new Set(), ops: false };
    clients.add(client);
    wsConnections.inc();
    socket.send(JSON.stringify({ type: 'hello', userId: user.sub }));

    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'subscribe_nearby' && Number.isFinite(msg.lat) && Number.isFinite(msg.lng)) {
        client.nearby = {
          lat: msg.lat,
          lng: msg.lng,
          service: msg.service === 'sewage' ? 'sewage' : 'water',
          radiusKm: config.dispatchRadiusKm,
        };
      } else if (msg.type === 'subscribe_booking' && typeof msg.bookingId === 'string') {
        const { rows } = await ctx.db
          .query('SELECT customer_id, driver_id FROM bookings WHERE id = $1', [msg.bookingId])
          .catch(() => ({ rows: [] as any[] }));
        if (rows[0] && (rows[0].customer_id === user.sub || rows[0].driver_id === user.sub)) client.bookings.add(msg.bookingId);
      } else if (msg.type === 'subscribe_ops' && user.role === 'ops') {
        client.ops = true;
      } else if (msg.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      }
    });
    socket.on('close', () => {
      clients.delete(client);
      wsConnections.dec();
    });
  });
}
