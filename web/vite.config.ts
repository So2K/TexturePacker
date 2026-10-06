import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/TexturePacker/',
  plugins: [react()],
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 3000, watch: { usePolling: process.platform === 'win32' } },
});
