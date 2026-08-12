namespace Hub.Desktop.Updates;

public enum DesktopUpdateStatus
{
    Disabled,
    Idle,
    Checking,
    Downloading,
    Ready,
    Deferred,
    Installing,
    Error,
}

public sealed record DesktopUpdateState(
    DesktopUpdateStatus Status,
    Version? Version = null,
    long DownloadedBytes = 0,
    long TotalBytes = 0,
    DateTimeOffset? LastSuccessfulCheckUtc = null,
    DateTimeOffset? DeferredUntil = null,
    IReadOnlyList<string>? ReleaseNotes = null,
    string? ErrorCode = null)
{
    public int DownloadPercent => TotalBytes <= 0
        ? 0
        : (int)Math.Clamp((DownloadedBytes * 100L) / TotalBytes, 0L, 100L);
}
