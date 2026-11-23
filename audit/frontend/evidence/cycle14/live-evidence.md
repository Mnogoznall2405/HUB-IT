# Cycle 14 live evidence (isolated test stack only)

Environment:
- normal backend: e2e/stack/local_backend.py, SQLite `.state-cycle14`, 127.0.0.1:18002
- 2FA backend: wrapper over local_backend with AUTH_2FA_ENFORCED=1, AUTH_2FA_POLICY=all,
  AUTH_2FA_INTERNAL_CIDRS=10.0.0.0/8, SQLite `.state-cycle14-2fa`, 127.0.0.1:18004
- frontends: vite 5219 (normal), vite 5222 (2FA), production build proxy 5223
- test users: e2e_admin / e2e-local-admin-pass (throwaway seed)

## FE-0197 — real 2FA setup flow (confirmed)

Playwright on 5222, no route mocks:
- login e2e_admin -> `2fa_setup_required`;
- POST /auth/enable-2fa returned real otpauth URI/manual key;
- TOTP computed from the returned base32 secret;
- POST /auth/verify-2fa -> authenticated.
Result: URL `/dashboard` immediately; "Сохраните backup-коды" absent; backup code text absent.

## FE-0198 — real second login with mandatory trusted device (confirmed)

After enabling 2FA, logout via /auth/logout, login again:
- `2fa_required` -> real TOTP -> verify-2fa-login;
- network zone external, discoverable_trusted_devices_count=0.
Result: URL `/dashboard`; `[data-testid="login-remember-device-dialog"]` absent; no device text.

## FE-0083 — two tabs + new refresh token validity (confirmed)

Two pages in one browser context (shared cookies), 18002/5219:
- three concurrent POST /auth/refresh: `[200, 401, 200]`;
- GET /auth/me -> 401 "Could not validate credentials";
- NEW refresh cookie after the race -> 401 "Refresh token has been revoked";
- both tabs reloaded -> `/login`.
This proves whole-family revocation, not merely old-cookie rejection.

## FE-0023 — 10k ports on mobile (confirmed)

Mobile 390x844, route-mocked 10000 ports in Networks/EquipmentTab:
- after switching to «Оборудование» the main thread blocked ~30.45 s;
- 10000 MUI Cards rendered;
- 181642 DOM nodes; body height 1321340 px; JS heap 930 MB.
No virtualization in the mobile branch.

## FE-0098 — 2000-file public folder (confirmed)

Route-mocked 2000 files, isolated stand:
- first render 8.38 s; 20180 DOM nodes; body 98184 px; heap 186 MB.
Screenshot: live-large-sharedfolder.png (cycle 13 evidence).

## FE-0253 — 12-round forced-GC heap test (refuted)

Playwright + CDP HeapProfiler.collectGarbage before each reading:
37.1, 47.7, 49.0, 49.5, 50.3, 50.6, 50.7, 50.9, 23.3, 44.6, 48.3, 49.2 MB.
Plateau ~49-51 MB, full GC drops to 23 MB; no monotonic growth. Original 85->143 MB was GC/lazy-chunk noise. Status Rejected.

## FE-0325 — PWA/offline deep check (confirmed, refined)

Built app on :5223, real SW:
- fresh offline cold reload: loader >50 s; only 2 refresh attempts in 50 s (no request storm);
- reconnect: recovered to /login in ~2 s;
- existing session offline reload: `/dashboard` + «Нет подключения · Показываем сохранённые данные»;
- two tabs: both show the loader;
- SW active/controller=true, caches: app-shell/assets/push-runtime.
So the hang is fresh-session auth recovery, not SW navigation, and it is not an infinite fast request loop.

## Functional routes (12)

Actions on the built app/real backend:
/about (Перейти в HUB), /profile (Служебные данные), /address-book (refresh + empty),
/company-structure (Обзор + Обновить), /docflow (Подключить -> dialog),
/tickets (Создать заявку -> dialog), /scan-center (Открыть очередь),
/passwords (Новая запись -> dialog), /vcs (Добавить терминал -> dialog),
/construction (Создать объект -> dialog), /warehouse-1c (Остатки),
/mfu (error/empty state). Back navigation and mobile overflow checks passed for samples.

## Blocked live checks

FE-0215 — mail disabled in local stack; no mailbox/provider.
FE-0230 — need real WebView2 with late bridge handshake.
FE-0232/FE-0239 — need prepared users/departments fixtures and approved mutations.
FE-0259 — construction workspace requires configured object/direction and 1C/SQL data.
FE-0022 — Warehouse1C balances/movements require 1C/SQL data.
