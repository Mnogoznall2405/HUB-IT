import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import base from '../playwright.config.js';

// Remediation P0 gate E2E: 2FA challenge / trusted-device / refresh rotation
// against a dedicated local stack (e2e/stack/local_backend_p0.py, port 18002)
// with AUTH_2FA_POLICY=all so the challenge paths fire on loopback.
// Requires E2E_LOCAL=1 — never targets an external deployment.

if (process.env.E2E_LOCAL !== '1') throw new Error('P0 remediation E2E requires E2E_LOCAL=1');

const BACKEND_PORT = '18002';
const FRONTEND_PORT = '5199';
// webServer commands resolve against the config dir (e2e/) — pin cwd to the
// frontend root so `e2e/stack/...` and `npx vite` resolve like the base config.
const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: ['remediation-p0.spec.js', 'remediation-multitab.spec.js'],
  outputDir: fileURLToPath(new URL('../../../output/remediation-p0', import.meta.url)),
  workers: 1,
  use: {
    ...base.use,
    // localhost (not 127.0.0.1): Chrome rejects IP-literal WebAuthn RP IDs,
    // and trusted-device registration is exercised via a CDP virtual
    // authenticator (WEBAUTHN_RP_ID=localhost on the p0 backend).
    baseURL: `http://localhost:${FRONTEND_PORT}`,
  },
  webServer: [
    {
      command: `${process.env.E2E_PYTHON || 'python'} e2e/stack/local_backend_p0.py`,
      cwd: FRONTEND_ROOT,
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      timeout: 180_000,
      reuseExistingServer: false,
    },
    {
      // --host binds IPv4+IPv6 so `localhost` resolves whichever stack wins.
      command: `npx vite --port ${FRONTEND_PORT} --strictPort --host`,
      cwd: FRONTEND_ROOT,
      url: `http://localhost:${FRONTEND_PORT}`,
      timeout: 120_000,
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
  ],
});
