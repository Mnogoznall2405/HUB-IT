# ADR-0006: Keep WiX MSI/Burn for HUB Desktop 1.0

## Status

Accepted (2026-08-11)

## Context

HUB Desktop is an unpackaged WPF/.NET 8 + WebView2 application installed per machine. The current WiX MSI and Burn Setup already provide offline prerequisites, upgrade by stable UpgradeCode, UAC flow, enterprise silent install, a fixed Program Files location, preserved per-user WebView2 data, GPO templates and the signed application update-manifest flow.

MSIX offers package identity, clean deployment and App Installer update/repair capabilities. It also introduces a different identity, signing, install/update and per-user registration model. A migration would have to preserve existing installations, WebView2 profile/session, autostart, notifications, update rollback and support for the actual Windows 10/11 fleet. MSIX packages must be signed with a certificate trusted on target machines; the current production TLS certificate is intentionally not treated as a Code Signing certificate.

The present roadmap has no requirement that is blocked by absence of MSIX package identity. Replacing a proven deployment pipeline immediately before 1.0 would increase migration and rollback risk without a measured user benefit.

## Decision

1. HUB Desktop 1.0 remains unpackaged and uses the existing per-machine WiX MSI plus offline Burn Setup.
2. The application updater remains the strict HTTPS feed with size/SHA-256/RSA-PSS manifest verification and separate elevated Update Runner.
3. MSIX artifacts, App Installer feed, sparse/external-location identity and automatic migration are not added in parallel.
4. MSI Product/UpgradeCode, install path, autostart, WebView2 profile path and updater contracts remain regression gates.
5. The decision is revisited only when a feature requiring package identity or a measured deployment/support benefit justifies a migration project.

## Reconsideration gates

A future MSIX proposal must include all of the following:

- a trusted Code Signing certificate and documented certificate rollout/rotation;
- an inventory proving App Installer/MSIX support on every target Windows edition/build;
- a tested MSI → MSIX migration that preserves or deliberately transfers WebView2 profile/session and settings;
- equivalent offline prerequisites, enterprise silent deployment and recovery/rollback;
- equivalent autostart, toast activation, VNC/custom protocol, local Office/PDF opening and update UX;
- uninstall/coexistence rules that cannot leave duplicate tray clients or two update mechanisms;
- Win10/Win11/RDP pilot evidence and a support runbook;
- a quantified benefit such as materially higher install success, simpler management or a required package-identity capability.

## Consequences

- 1.0 has one installation and update path rather than two competing paths.
- Existing manual bootstrap and future automatic upgrades remain compatible.
- MSIX-specific automatic repair and package-identity features are intentionally unavailable for 1.0.
- Authenticode remains a separate open improvement; the application manifest signature does not make manual Setup/MSI a Windows-trusted publisher.

## References

- [Microsoft: Package and deploy Windows apps](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/)
- [Microsoft: MSIX auto-update and repair](https://learn.microsoft.com/en-us/windows/msix/app-installer/auto-update-and-repair--overview)
- [Microsoft: MSIX supported platforms](https://learn.microsoft.com/en-us/windows/msix/supported-platforms)
- [Microsoft: Windows Installer installation context](https://learn.microsoft.com/en-us/windows/win32/msi/installation-context)

