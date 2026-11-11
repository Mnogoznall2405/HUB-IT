import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['e2e/fixtures/mail-file-actions-harness.html', 'e2e/fixtures/kb-links-harness.html', 'e2e/fixtures/task-canvas-reconnect-harness.html'] },
  server: { host: '127.0.0.1', port: 5219, strictPort: true },
});
