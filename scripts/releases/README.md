# Local Release Packaging

`New-HubItRelease.ps1` runs on the development server. It packages one exact
Git commit as a ZIP archive and includes the built frontend output.

The archive intentionally excludes local secrets and mutable runtime state:

- `.env`;
- untracked files;
- `data/` runtime files;
- Python environments and `node_modules`.

## Build a release

The working tree must be clean. Use an explicit version that will also become
the production release directory name.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\releases\New-HubItRelease.ps1 `
  -Version v2026.07.29.1 `
  -ReleaseEnvironment Production `
  -RunFrontendTests
```

By default, output is written outside the repository:

```text
C:\Backups\hub-it\releases\HUB-IT-v2026.07.29.1.zip
```

Three files form one release:

- `HUB-IT-<version>.zip` - source plus `WEB-itinvent/frontend/dist`;
- `HUB-IT-<version>.manifest.json` - commit and build metadata;
- `HUB-IT-<version>.sha256` - archive checksum.

## Publish to the production SMB share

The production server must expose an `incoming` directory writable by the
development release account, for example `\\PROD-APP\HUB-IT-Releases\incoming`.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\releases\New-HubItRelease.ps1 `
  -Version v2026.07.29.1 `
  -ReleaseEnvironment Production `
  -RunFrontendTests `
  -Destination '\\PROD-APP\HUB-IT-Releases\incoming'
```

The script copies the archive as `.uploading`, validates its SHA-256, renames
it to `.zip`, then writes `.ready.json` last. A production receiver must ignore
archives without the ready marker.

For a development build, use the explicit profile:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\releases\New-HubItRelease.ps1 `
  -Version v2026.07.29.1-dev.1 `
  -ReleaseEnvironment Development
```

Profiles set both the frontend `VITE_CANONICAL_HOST` and the IIS redirect:

- `Development` -> `hubitdev.zsgp.ru`;
- `Production` -> `hubit.zsgp.ru`.

## Per-server configuration

The release archive does not contain `.env`. Before the first deployment,
create a separate root `.env` on each host. Development and production must
use different PostgreSQL databases, WebAuthn origins, and agent URLs.

```env
# Development host
VITE_CANONICAL_HOST=hubitdev.zsgp.ru
WEBAUTHN_RP_ID=hubitdev.zsgp.ru
WEBAUTHN_ORIGIN=https://hubitdev.zsgp.ru
CORS_ORIGINS=https://hubitdev.zsgp.ru,http://localhost:5173
```

```env
# Production host
VITE_CANONICAL_HOST=hubit.zsgp.ru
WEBAUTHN_RP_ID=hubit.zsgp.ru
WEBAUTHN_ORIGIN=https://hubit.zsgp.ru
CORS_ORIGINS=https://hubit.zsgp.ru
```

The release profile overrides `VITE_CANONICAL_HOST` during frontend build and
records the selected host in the release manifest. The deploy script rejects a
release whose profile and host do not match its command-line target.

## Deploy on a Windows IIS/PM2 host

Copy the published archive and all three sidecars (`.sha256`, `.manifest.json`,
`.ready.json`) to the production `incoming` directory. Verify first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\releases\Deploy-HubItRelease.ps1 `
  -ReleaseArchivePath 'C:\HUB-IT-Releases\incoming\HUB-IT-v2026.07.29.1.zip' `
  -ReleaseEnvironment Production
```

After a verified PostgreSQL backup and a maintenance window, apply it:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\releases\Deploy-HubItRelease.ps1 `
  -ReleaseArchivePath 'C:\HUB-IT-Releases\incoming\HUB-IT-v2026.07.29.1.zip' `
  -ReleaseEnvironment Production `
  -Apply
```

The receiver is intentionally limited to the established
`C:\Project\Image_scan` runtime path. It preserves `.env`, `data`, uploads,
logs, Python environments, Node modules, tools, and Git metadata.

## Production receiver contract

The production deployment script must:

1. process only a release with a matching `.ready.json` marker;
2. verify SHA-256 before extraction;
3. preserve production `.env`, runtime `data/`, logs, uploads, and database;
4. create a PostgreSQL backup before database migrations;
5. unpack to a new release directory, run migrations, restart services, and
   health-check before switching traffic;
6. retain at least three previous release directories for rollback.

Do not copy the saved PostgreSQL configuration files to a new Linux server
unchanged. Apply its network and storage settings deliberately.
