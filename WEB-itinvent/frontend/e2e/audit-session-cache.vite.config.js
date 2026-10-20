import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['e2e/fixtures/session-cache-harness.html'] },
  server: { host: '127.0.0.1', port: 5220, strictPort: true },
});
