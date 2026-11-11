namespace Hub.Desktop.Updates;

public sealed record DesktopUpdateDownloadProgress(
    Version Version,
    long DownloadedBytes,
    long TotalBytes);
