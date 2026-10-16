import { serve } from '@hono/node-server';
import { createApp } from './app';
import { closeProductDatabase } from './infrastructure/db/client';

const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');

const server = serve({ fetch: createApp().fetch, port, hostname: '0.0.0.0' });
const shutdown = () => {
  server.close(() => {
    void closeProductDatabase().catch((error: unknown) => {
      console.error('Failed to close Product database', error);
      process.exitCode = 1;
    });
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
