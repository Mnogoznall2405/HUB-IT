# Auth Security Stack

## Scope
- Windows Server deployment with IIS/HTTPS in front of FastAPI.
- Backend listens on `127.0.0.1:8001`; public traffic must enter through IIS.
- Access token lifetime: `JWT_ACCESS_EXPIRE_MINUTES=15`.
- Refresh token lifetime: `JWT_REFRESH_EXPIRE_DAYS=7`.
- 2FA challenge lifetime: `AUTH_2FA_CHALLENGE_TTL_SEC=300`.
- Session idle timeout: `SESSION_IDLE_TIMEOUT_MINUTES=30` (external password/TOTP sessions without passkey).
- Trusted-device session idle timeout: `SESSION_IDLE_TIMEOUT_TRUSTED_DAYS=7` (passkey / WebAuthn login).
- Internal-network session idle timeout: `SESSION_IDLE_TIMEOUT_INTERNAL_DAYS=7` (login from `AUTH_2FA_INTERNAL_CIDRS`, stored as `login_network_zone=internal`).
- Session history retention: `SESSION_HISTORY_RETENTION_DAYS=14`.
- Active session limit: `SESSION_MAX_ACTIVE_PER_USER=3`; a successful login closes the least recently used excess session.
- Browser/app identity uses a stable client-device ID, not the IP address. Changing networks updates session metadata without creating a new session.
- Trusted device/passkey lifetime: `AUTH_TRUSTED_DEVICE_TTL_DAYS=90`.
- Auth/session drop counters: in-process metrics under `auth_session` in `GET /api/v1/system/request-metrics` (admin). Client beacons: `POST /api/v1/auth/session-telemetry` (`client_auth_required`, `client_refresh_failed`).
- Internal idle is clamped to **≥7 days** (`SESSION_IDLE_TIMEOUT_INTERNAL_DAYS`); refresh/absolute TTL clamped to **≥7 days** (`JWT_REFRESH_EXPIRE_DAYS`).
- Parallel refresh race: `REFRESH_ROTATION_GRACE_SECONDS` reuses the newly issued token pair for a short window (`refresh_grace_hit`).
- Diagnostics: `GET /api/v1/auth/session-status` (session_id, last_seen_at, idle_expires_at, absolute_expires_at, refresh_expires_at, closed_reason) and `GET /api/v1/auth/session-policy`.
- On api/chat startup: recompute `idle_expires_at` for active sessions (`reapply_idle_policy_for_active_sessions`).
- Web UI: proactive silent `/auth/refresh` ~every 12 minutes while logged in (and on tab focus).

## Required Env
- `APP_DATABASE_URL` is required for production auth runtime state.
- `AUTH_COOKIE_NAME`
- `AUTH_REFRESH_COOKIE_NAME`
- `AUTH_COOKIE_SECURE=true` for HTTPS
- `AUTH_COOKIE_SAMESITE=Strict`
- `JWT_SECRET_KEYS` or `JWT_SECRET_KEY`
- `JWT_ACCESS_EXPIRE_MINUTES=15`
- `JWT_REFRESH_EXPIRE_DAYS=7`
- `AUTH_2FA_ENFORCED=1`
- `AUTH_2FA_POLICY=external_only`
- `AUTH_2FA_INTERNAL_CIDRS=10.0.0.0/8`
- `AUTH_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128` for same-host IIS
- `AUTH_CLOUDFLARE_PROXY_CIDRS=` stays empty until Cloudflare and the origin firewall are enabled; then use only official Cloudflare CIDRs
- `TOTP_ISSUER=HUB-IT`
- `AUTH_2FA_CHALLENGE_TTL_SEC=300`
- `AUTH_BACKUP_CODES_COUNT=10`
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_ORIGIN`
- `AUTH_PASSKEY_ALLOW_INTERNAL=0` (keep `0` so passkey stays external-only; corp `10.x` stays password-only)
- `AUTH_TRUSTED_DEVICE_TTL_DAYS=90`
- `SESSION_IDLE_TIMEOUT_TRUSTED_DAYS=7`
- `SESSION_IDLE_TIMEOUT_INTERNAL_DAYS=7`
- `SESSION_MAX_ACTIVE_PER_USER=3`

## Runtime Storage
Auth does not require Redis.

`system.auth_runtime_items` in `APP_DATABASE_URL` stores short-lived state:
- revoked access/refresh token JTI values until token expiry;
- refresh token rotation records;
- one-time login and WebAuthn challenges;
- auth route rate-limit counters.

The in-memory fallback is for dev/test only. It is not safe for multi-process production because token revocation and challenge state would be process-local.

## Backend Flow
1. `POST /api/v1/auth/login`
   - Validates password.
   - Uses `AUTH_2FA_POLICY=external_only`: external network requires 2FA, internal network does not.
   - Returns `authenticated`, `2fa_required`, or `2fa_setup_required`.
2. `POST /api/v1/auth/enable-2fa`
   - Starts TOTP enrollment for a login challenge.
   - `otpauth_uri` uses `TOTP_ISSUER` as the display label in the path and `WEBAUTHN_RP_ID` as the `issuer` query parameter (Apple Passwords matches saved logins by domain).
   - On iOS/macOS Safari the login UI links with `apple-otpauth://` so «Пароли» can attach the code to an existing Keychain entry; the user must save the site password first or pick the account when prompted.
3. `POST /api/v1/auth/verify-2fa`
   - Consumes the login challenge once, enables TOTP, returns backup codes once, completes login.
4. `POST /api/v1/auth/verify-2fa-login`
   - Consumes the login challenge once and accepts TOTP or backup code.
5. `POST /api/v1/auth/refresh`
   - Consumes the old refresh token once, revokes its JTI, and issues a rotated pair.
6. Trusted devices/passkeys
   - Registration and auth challenges are one-time WebAuthn challenges.
   - Devices expire after `AUTH_TRUSTED_DEVICE_TTL_DAYS`.
   - Successful use extends the device expiry.
   - Password change, 2FA reset, or explicit revoke invalidates trusted devices.
   - **External network only:** 2FA (`AUTH_2FA_POLICY=external_only`) and passkey login/registration apply when `network_zone=external`. Internal `10.x` stays password-only unless `AUTH_PASSKEY_ALLOW_INTERNAL=1`.
   - **Multiple devices:** the backend allows several active trusted devices per user. After the first passkey, add another phone/PC from **Settings → Security → «Привязать это устройство»** (visible only on external network) or accept the optional prompt after password+2FA login.
   - **Revoke vs phone passkey list:** revoking a device in HUB-IT disables the server key only. Old passkeys may remain in Android/Google Password Manager until removed manually (Settings → Passwords / Passkeys → `hubit.zsgp.ru`). Registration sends `excludeCredentials` only for **active** server credentials (duplicate protection in DB). Stale passkeys in the phone OS vault are not removed by revoke; delete them manually if the picker shows obsolete entries.
7. Session identity and limit
   - Web stores an opaque random client-device ID in the HttpOnly `hubit_client_device_id` cookie.
   - Native mobile sends the installation ID in `X-Client-Device-ID`; the backend returns `LoginResponse.client_device_id` only to mobile clients.
   - The database stores only a SHA-256 hash of this identifier. It is scoped by `user_id` and is not an authentication credential.
   - A repeated login for the same user and client-device ID reuses the active `session_id`, updates IP and activity time, and does not treat an IP change as a new device.
   - `POST /api/v1/auth/sessions/normalize-limit` is admin-only and defaults to dry-run. Existing sessions are changed only with `{ "apply": true }`.

## Mobile client (Expo / React Native)

Native clients do not use httpOnly cookies. Send `X-Auth-Client: mobile` on auth routes that complete a session.

- Send the stable installation ID as `X-Client-Device-ID` on password, 2FA, passkey and trusted-device completion routes. Persist the returned `LoginResponse.client_device_id` in SecureStore and reuse it on later logins.
- `POST /api/v1/auth/login`, `verify-2fa`, `verify-2fa-login`, `refresh`, `passkey-login/verify`, `trusted-devices/auth/verify` — JSON body includes `access_token` and `refresh_token` when `status=authenticated` (web keeps `access_token: null` and cookies).
- `POST /api/v1/auth/refresh` — body `{ "refresh_token": "..." }` (cookie optional for web only).
- `POST /api/v1/auth/logout` — `Authorization: Bearer` + optional body `{ "refresh_token": "..." }` to revoke refresh without cookies.
- Store tokens in platform secure storage (Android Keystore), not plain AsyncStorage.
- Full responsive web shell uses a one-time session bridge:
  - native calls `POST /api/v1/auth/mobile-web-session` with Bearer access, `X-Auth-Client: mobile` and the refresh token in the JSON body;
  - the backend verifies that access, refresh, runtime refresh state, user, device and `session_id` match, then stores only a hashed one-time code for 60 seconds;
  - WebView opens the returned bootstrap path with the code in the URL fragment, so it is not sent in the HTTP request or referrer;
  - `POST /api/v1/auth/mobile-web-session/consume` atomically consumes the code and issues separate HttpOnly web cookies bound to the same active session;
  - logout in either native or web closes the shared server session and invalidates both clients.
- Optional biometric login is an APK-only Android unlock backed by a revocable server credential:
  - opt-in is offered only after password + successful 2FA;
  - the successful mobile 2FA response includes a one-time five-minute enrollment code. `POST /api/v1/auth/mobile-biometric/enroll` consumes it and returns an opaque renewable device token once;
  - the server stores only SHA-256 hashes of the renewable token and installation ID. The credential itself has no expiry, but it is bound to one user and one APK installation;
  - after every fingerprint unlock, `POST /api/v1/auth/mobile-biometric/session` checks that the user is active and 2FA is still enabled, then issues ordinary finite access/refresh tokens. No JWT becomes infinite;
  - the native password vault reuses that protected device credential only after Android releases it through the biometric prompt. `POST /api/v1/passwords/unlock/mobile-biometric` validates the credential and installation ID, then grants the existing five-minute vault unlock; mobile password updates also require that grant;
  - plaintext vault passwords are requested one entry at a time, never written to the offline cache, hidden after 30 seconds and cleared when the APK leaves the foreground;
  - while an APK installation keeps an active `mobile_biometric_credentials` row for the session's `user_id` + `client_device_key_hash`, that session uses the trusted idle window (`SESSION_IDLE_TIMEOUT_TRUSTED_DAYS`, default 7 days) instead of the 30-minute external password idle; revoke of the credential returns idle to the normal policy;
  - logout, biometric disable, password change, 2FA reset, admin password replacement or user deactivation revoke the durable credential. A definitive `401/403` deletes its local copy;
  - the offline cache encryption key and user snapshot are stored with `SecureStore.requireAuthentication=true` and become unreadable when the enrolled biometric set changes;
  - a transport failure may open only the previously loaded mobile cache in read-only mode. GET responses are partitioned by user/database, encrypted with AES-GCM in IndexedDB, capped at 250 entries / 2 MiB per response and expire after 7 days;
  - offline POST/PUT/PATCH/DELETE requests are rejected locally. Access/refresh tokens are never injected into WebView, and logout deletes the protected offline key;
  - this path is enabled only by the native `__HUBIT_MOBILE_OFFLINE_SESSION__` marker. Browser/Desktop/PWA behavior is unchanged.

## IIS Boundary
Recommended baseline:
- FastAPI/PM2 bind: `BACKEND_HOST=127.0.0.1`, `BACKEND_PORT=8001`.
- IIS terminates HTTPS for `https://hubit.zsgp.ru`.
- Keep `AUTH_TRUSTED_PROXY_CIDRS` to loopback when IIS and backend are on the same host.
- Add another proxy CIDR only if a separate trusted reverse proxy is introduced.
- Trust `CF-Connecting-IP` only through `AUTH_CLOUDFLARE_PROXY_CIDRS`; see [HUB_CLOUDFLARE_EDGE.md](HUB_CLOUDFLARE_EDGE.md).

## IIS Dynamic IP Restrictions
Recommended first-pass values:
- deny by request rate: `120 requests / 10 sec`;
- deny by concurrent requests: `30`;
- deny action: `AbortRequest`.

Use script:
- [`enable-dynamic-ip-restrictions.ps1`](/c:/Project/Image_scan/scripts/iis/enable-dynamic-ip-restrictions.ps1)

## CrowdSec
Expected components on the Windows host:
- CrowdSec agent;
- Windows Firewall bouncer;
- IIS W3C log acquisition enabled.

Use the acquisition sample:
- [`acquis.windows.iis.yaml`](/c:/Project/Image_scan/scripts/crowdsec/acquis.windows.iis.yaml)

## Notes
- WebAuthn is used for trusted-device confirmation and passkey/passwordless login where enabled.
- LDAP mail session bootstrap uses only the encrypted password inside the short-lived login challenge and then the active web session context.
- Auth route rate limits are keyed by route, network zone, client IP, username/challenge, and stored in the app DB.
