import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'chota_' });

export const httpDuration = new client.Histogram({
  name: 'chota_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});
export const httpErrors = new client.Counter({
  name: 'chota_http_errors_total',
  help: 'HTTP responses with status >= 500, and 4xx separately by class',
  labelNames: ['route', 'class'],
  registers: [registry],
});
export const bookingsCreated = new client.Counter({
  name: 'chota_bookings_created_total',
  help: 'Bookings created by outcome',
  labelNames: ['service', 'outcome'],
  registers: [registry],
});
export const dispatchDuration = new client.Histogram({
  name: 'chota_dispatch_duration_seconds',
  help: 'Time spent inside the booking/dispatch transaction',
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});
export const wsConnections = new client.Gauge({
  name: 'chota_ws_connections',
  help: 'Open WebSocket connections on this instance',
  registers: [registry],
});
const startedAt = Date.now();
new client.Gauge({
  name: 'chota_uptime_seconds',
  help: 'Seconds since this instance started',
  registers: [registry],
  collect() {
    this.set((Date.now() - startedAt) / 1000);
  },
});
