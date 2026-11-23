Cycle 13 live evidence (isolated E2E stack; no production calls)

Environment:
- backend: e2e/stack/local_backend.py, SQLite .state-cycle13, port 18002
- frontend: vite dev, port 5219
- users: e2e_admin / e2e-local-admin-pass (test-only seed)

FE-0197 (backup codes after 2FA setup):
- Playwright route-mocked auth flow: login -> 2fa_setup_required -> enable-2fa -> verify-2fa.
- verify-2fa response: authenticated user + backup_codes ['AAAA-BBBB', ...].
- After submit, at 250/800/2000/4000 ms: URL /dashboard; backup screen text absent;
  backup code text absent; localStorage.user present.
- Result: backup-code screen never rendered; LoginRoute unmounted Login before setStep('setup_complete').

FE-0198 (mandatory trusted-device enrollment):
- Playwright route-mocked auth flow: login -> 2fa_required -> verify-2fa-login.
- verify response: user discoverable_trusted_devices_count=0, network_zone=external.
- After submit, at 250/800/2000/4000 ms: URL /dashboard; remember-device dialog absent.
- Result: mandatory enrollment sheet never rendered.

FE-0078 (offline sender message):
- `E2E_LOCAL=1` chat-realtime.spec.js on isolated stack 18003/5220.
- 3 passed (1.9m), including:
  "message sent while the sender is offline goes out on reconnect exactly once" (23.4s)
  with assertions: sender sees token, failed marker disappears, peer sees once,
  sender sees count 1 after 2s, and after reload.
- Result: current HEAD 8462d971 passes the case that failed on 1a94d39a.

FE-0083 (cross-tab refresh race):
- Login via /api/v1/auth/login on 18002, capture access+refresh cookies.
- 3 concurrent POST /api/v1/auth/refresh with the same cookies:
  statuses [401, 200, 200] (order varies; one 401 + two 200).
- GET /api/v1/auth/me with the original cookies: 401 "Could not validate credentials".
- Result: token family revoked; all tabs sharing the cookie jar are logged out.

FE-0253 (heap, 12 rounds x 8 SPA routes):
- Playwright + CDP HeapProfiler.collectGarbage before each reading.
- Heap MB by round: 37.1, 47.7, 49.0, 49.5, 50.3, 50.6, 50.7, 50.9, 23.3, 44.6, 48.3, 49.2.
- After warm-up the value plateaus ~49-51 MB and drops to 23 MB after a full GC.
- Result: no monotonic growth; earlier 85->143 MB reading was GC/lazy-chunk noise, not a proven leak.

HTTP error probes:
- Forced GET /api/v1/hub/tasks -> 401: app redirected to /login (session treated as rejected).
- 403: page rendered raw backend detail "E2E forced 403" in the task area; no logout.
- 429/500 probes were not completed because the isolated login rate limit was hit during the run.

Large-data probe (FE-0098):
- Synthetic public folder: 2000 items, route-mocked payload, isolated stand.
- First render 8.38 s; 20180 DOM nodes; 2001 interactive elements; body 98184 px; JS heap 186 MB.
- Screenshot: live-large-sharedfolder.png.
