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
  -RunFrontendTests `
  -Destination '\\PROD-APP\HUB-IT-Releases\incoming'
```

The script copies the archive as `.uploading`, validates its SHA-256, renames
it to `.zip`, then writes `.ready.json` last. A production receiver must ignore
archives without the ready marker.

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
