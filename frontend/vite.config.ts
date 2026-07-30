/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://api:5000',
        changeOrigin: true,
        // Forward the real client address. Without it the API sees only this dev
        // server's address, so every browser session shares one rate-limit
        // bucket and a few page reloads can throttle the whole team. Pair with
        // TRUST_PROXY_HOPS=1 on the API, which is set in docker-compose.dev.yml.
        xfwd: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
    globals: true,
  },
});
