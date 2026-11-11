import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Local fixture endpoints only; no production backend or credentials.
function mediaFixture() {
  let authorized = false;
  let hold = false;
  let requests = 0;
  let pending = [];
  return {
    name: 'audit-private-media-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://127.0.0.1:5222');
        if (url.pathname === '/__audit/media-state') {
          if (url.searchParams.has('authorized')) authorized = url.searchParams.get('authorized') === '1';
          if (url.searchParams.has('hold')) hold = url.searchParams.get('hold') === '1';
          if (url.searchParams.has('release')) { const previous = pending; pending = []; previous.forEach((send) => send()); }
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Cache-Control', 'no-store');
          response.end(JSON.stringify({ requests, pending: pending.length }));
          return;
        }
        if (url.pathname !== '/api/v1/chat/messages/audit-a/attachments/1/file') return next();
        requests += 1;
        const accepted = authorized;
        const send = () => {
          if (response.destroyed || response.writableEnded) return;
          response.statusCode = accepted ? 200 : 401;
          response.setHeader('Content-Type', 'text/plain;charset=utf-8');
          // Match the long-lived HTTP cache policy of the current attachment route.
          response.setHeader('Cache-Control', accepted ? 'private,max-age=31536000,immutable' : 'no-store');
          response.end(accepted ? 'PRIVATE_A' : 'unauthorized');
        };
        if (hold) pending.push(send); else send();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mediaFixture()],
  optimizeDeps: { entries: ['e2e/fixtures/private-media-cache-harness.html', 'e2e/fixtures/session-cache-harness.html'] },
  server: { host: '127.0.0.1', port: 5222, strictPort: true },
});
