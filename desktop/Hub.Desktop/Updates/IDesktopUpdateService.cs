namespace Hub.Desktop.Updates;

public interface IDesktopUpdateService
{
    IReadOnlyList<string> InstalledReleaseNotes { get; }

    event EventHandler<DesktopUpdateDownloadProgress>? DownloadProgress;

    Task<DesktopUpdatePackage?> CheckOnceAsync(CancellationToken cancellationToken = default);

    Task DeferAsync(
        DesktopUpdatePackage package,
        DateTimeOffset deferredUntil,
        CancellationToken cancellationToken = default);

    bool TryLaunchInstaller(DesktopUpdatePackage package, string applicationPath);
}
