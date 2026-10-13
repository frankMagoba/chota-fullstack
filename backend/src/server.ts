import { buildApp } from './app.js';
import { config } from './config.js';

const { app } = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, draining`);
    await app.close();
    process.exit(0);
  });
}
