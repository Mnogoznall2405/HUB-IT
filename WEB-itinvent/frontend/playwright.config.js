import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

// E2E smoke. Two modes:
//
// Deployed build (E2E_BASE_URL) — read-only checks against a real deployment:
//   E2E_BASE_URL=<host>                  (required; no default, so production is never hit by accident)
//   E2E_USERNAME / E2E_PASSWORD          — required, no creds are stored in the repo
//   E2E_SEND=1                           — enable the message-send step (writes real data)
//
// Local stack — E2E_LOCAL=1 boots a throwaway backend on SQLite
// (e2e/stack/local_backend.py, port 18001) plus `vite dev` (port 5174),
// seeded with test-only users. Write flows run freely; nothing external
// is touched. Credentials are auto-filled from the seed below.

const LOCAL = process.env.E2E_LOCAL === '1';
const BUILT = LOCAL && process.env.E2E_BUILD === '1';

// Never fall back to production silently: without E2E_LOCAL=1 the target must be named explicitly.
if (!LOCAL && !process.env.E2E_BASE_URL) {
  throw new Error(
    'Playwright: set E2E_LOCAL=1 (throwaway local stack) or E2E_BASE_URL=<host> explicitly; ' +
      'there is no default target so a run can never hit production by accident.',
  );
}

if (LOCAL) {
  process.env.E2E_USERNAME ||= 'e2e_admin';
  process.env.E2E_PASSWORD ||= 'e2e-local-admin-pass';
  process.env.E2E_USERNAME2 ||= 'e2e_user';
  process.env.E2E_PASSWORD2 ||= 'e2e-local-user-pass';
  process.env.E2E_USERNAME3 ||= 'e2e_fresh';
  process.env.E2E_PASSWORD3 ||= 'e2e-local-fresh-pass';
  process.env.E2E_SEND ||= '1';
  process.env.E2E_FILES_WORKER ||= '1';
}

const BACKEND_PORT = process.env.E2E_BACKEND_PORT || '18001';
const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT || '5174';
const frontendBuildDir = fileURLToPath(new URL('../../output/e2e-frontend-built', import.meta.url));

const localWebServers = [
  {
    // Python entrypoint seeds the DB and runs uvicorn itself; `python`
    // resolves to the project interpreter on dev hosts and CI alike.
    command: `${process.env.E2E_PYTHON || 'python'} e2e/stack/local_backend.py`,
    url: `http://127.0.0.1:${BACKEND_PORT}/health`,
    timeout: 180_000,
    reuseExistingServer: false,
  },
  {
    command: BUILT
      ? `npm run build -- --outDir "${frontendBuildDir}" && npx vite preview --outDir "${frontendBuildDir}" --port ${FRONTEND_PORT} --strictPort --host 127.0.0.1`
      : `npx vite --port ${FRONTEND_PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${FRONTEND_PORT}`,
    timeout: BUILT ? 300_000 : 120_000,
    reuseExistingServer: false,
    env: {
      VITE_BACKEND_HOST: '127.0.0.1',
      VITE_BACKEND_PORT: BACKEND_PORT,
      VITE_CHAT_ENABLED: '1',
      VITE_CHAT_WS_ENABLED: '1',
      VITE_API_URL: '/api',
      VITE_BASE_PATH: '/',
      VITE_SCAN_BACKEND_TARGET: `http://127.0.0.1:${BACKEND_PORT}`,
      VITE_VOICE_BACKEND_TARGET: `http://127.0.0.1:${BACKEND_PORT}`,
    },
  },
];

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: LOCAL
      ? `http://127.0.0.1:${FRONTEND_PORT}`
      : process.env.E2E_BASE_URL,
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // The bundled chromium-1243 renderer crashes on this host; installed
    // Chrome works. Override with PW_CHANNEL=chromium to use the bundled build.
    channel: process.env.PW_CHANNEL || 'chrome',
    // Renderer OOM-crashes on constrained hosts without these flags.
    launchOptions: {
      args: ['--disable-dev-shm-usage', '--disable-gpu'],
    },
  },
  webServer: LOCAL ? localWebServers : undefined,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
