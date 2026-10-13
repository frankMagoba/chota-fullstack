import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://chota:chota@localhost:5432/chota_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      JWT_SECRET: 'test-secret',
      SLOT_CAPACITY: '20',
    },
    fileParallelism: false,
    testTimeout: 20000,
  },
});
