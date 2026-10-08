import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Same-origin API in development so session cookies just work.
      '/api': { target: process.env.API_URL ?? 'http://localhost:4000', changeOrigin: false },
    },
  },
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 800,
  },
});
