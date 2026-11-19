import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  optimizeDeps: { entries: ['e2e/fixtures/my-files-row-harness.html'] },
  server: { host: '127.0.0.1', port: 5223, strictPort: true },
});
