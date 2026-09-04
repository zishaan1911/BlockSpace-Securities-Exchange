import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Vite rejects requests whose Host header it does not recognise, so
    // reaching the dev server from another device on the wifi fails with
    // "Blocked request" until its address is allowed. The LAN addresses
    // are private ranges and this is a dev server on a local network, so
    // allowing them costs nothing real.
    allowedHosts: true,
    // The gateway runs separately (see api/README.md). Proxying keeps the
    // browser same-origin, so no CORS config is needed on the gateway.
    proxy: {
      '/api': {
        target: process.env.GASX_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
