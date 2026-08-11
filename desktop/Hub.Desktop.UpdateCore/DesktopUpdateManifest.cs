namespace Hub.Desktop.UpdateCore;

public sealed record DesktopUpdateSignature(
    string Algorithm,
    string KeyId,
    string Value);

public sealed record DesktopUpdateManifest(
    int SchemaVersion,
    string Channel,
    Version Version,
    DateTimeOffset PublishedAt,
    string RelativePath,
    Uri DownloadUri,
    long SizeBytes,
    string Sha256,
    IReadOnlyList<string> ReleaseNotes,
    DesktopUpdateSignature Signature);
