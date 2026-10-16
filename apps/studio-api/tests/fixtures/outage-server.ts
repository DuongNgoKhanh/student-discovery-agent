import { serve } from '@hono/node-server';
import { createApp } from '../../src/app';
import { closeProductDatabase } from '../../src/infrastructure/db/client';

const server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 }, (info) => {
  console.log(`LISTENING:${info.port}`);
});
process.once('SIGTERM', () => {
  server.close(() => { void closeProductDatabase(); });
});
