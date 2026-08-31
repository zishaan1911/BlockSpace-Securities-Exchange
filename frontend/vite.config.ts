import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
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
