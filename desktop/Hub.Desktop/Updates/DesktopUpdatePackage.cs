using Hub.Desktop.UpdateCore;

namespace Hub.Desktop.Updates;

public sealed record DesktopUpdatePackage(
    DesktopUpdateManifest Manifest,
    string SetupPath,
    string ManifestPath,
    DateTimeOffset? DeferredUntil);
