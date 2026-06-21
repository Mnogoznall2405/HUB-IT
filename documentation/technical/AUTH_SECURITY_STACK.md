# Auth Security Stack

## Scope
- Windows Server deployment with IIS/HTTPS in front of FastAPI.
- Backend listens on `127.0.0.1:8001`; public traffic must enter through IIS.
- Access token lifetime: `JWT_ACCESS_EXPIRE_MINUTES=15`.
- Refresh token lifetime: `JWT_REFRESH_EXPIRE_DAYS=7`.
- 2FA challenge lifetime: `AUTH_2FA_CHALLENGE_TTL_SEC=300`.
- Session idle timeout: `SESSION_IDLE_TIMEOUT_MINUTES=30`.
- Session history retention: `SESSION_HISTORY_RETENTION_DAYS=14`.
- Trusted device/passkey lifetime: `AUTH_TRUSTED_DEVICE_TTL_DAYS=90`.

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
- `TOTP_ISSUER=HUB-IT`
- `AUTH_2FA_CHALLENGE_TTL_SEC=300`
- `AUTH_BACKUP_CODES_COUNT=10`
- `WEBAUTHN_RP_ID`
- `WEBAUTHN_RP_NAME`
- `WEBAUTHN_ORIGIN`
- `AUTH_PASSKEY_ALLOW_INTERNAL=0` (keep `0` so passkey stays external-only; corp `10.x` stays password-only)
- `AUTH_TRUSTED_DEVICE_TTL_DAYS=90`

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

## Mobile client (Expo / React Native)

Native clients do not use httpOnly cookies. Send `X-Auth-Client: mobile` on auth routes that complete a session.

- `POST /api/v1/auth/login`, `verify-2fa`, `verify-2fa-login`, `refresh`, `passkey-login/verify`, `trusted-devices/auth/verify` — JSON body includes `access_token` and `refresh_token` when `status=authenticated` (web keeps `access_token: null` and cookies).
- `POST /api/v1/auth/refresh` — body `{ "refresh_token": "..." }` (cookie optional for web only).
- `POST /api/v1/auth/logout` — `Authorization: Bearer` + optional body `{ "refresh_token": "..." }` to revoke refresh without cookies.
- Store tokens in platform secure storage (Android Keystore), not plain AsyncStorage.

## IIS Boundary
Recommended baseline:
- FastAPI/PM2 bind: `BACKEND_HOST=127.0.0.1`, `BACKEND_PORT=8001`.
- IIS terminates HTTPS for `https://hubit.zsgp.ru`.
- Keep `AUTH_TRUSTED_PROXY_CIDRS` to loopback when IIS and backend are on the same host.
- Add another proxy CIDR only if a separate trusted reverse proxy is introduced.

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
