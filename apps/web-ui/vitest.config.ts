import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Shared base. Projects (client/server/integration) are defined in vitest.workspace.ts.
export default defineConfig({
  plugins: [react()],
  test: { globals: true },
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
});
