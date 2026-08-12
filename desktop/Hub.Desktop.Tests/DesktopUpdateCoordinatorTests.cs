using Hub.Desktop.Configuration;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopUpdateCoordinatorTests
{
    [Fact]
    public async Task SuppressesConcurrentManualChecksAndReturnsToIdle()
    {
        var service = new FakeUpdateService();
        using var coordinator = new DesktopUpdateCoordinator(
            service,
            CreateOptions());

        var firstCheck = coordinator.CheckNowAsync();
        await service.CheckStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        var secondCheckStarted = await coordinator.CheckNowAsync();
        Assert.False(secondCheckStarted);
        Assert.Equal(1, service.CheckCount);
        Assert.Equal(DesktopUpdateStatus.Checking, coordinator.Current.Status);

        service.InstalledReleaseNotes = ["Улучшено меню Desktop"];
        service.CompleteCheck(null);

        Assert.True(await firstCheck);
        Assert.Equal(DesktopUpdateStatus.Idle, coordinator.Current.Status);
        Assert.NotNull(coordinator.Current.LastSuccessfulCheckUtc);
        Assert.Equal(["Улучшено меню Desktop"], coordinator.Current.ReleaseNotes);
    }

    [Fact]
    public async Task PublishesReadyStateWithoutExposingDownloadUrl()
    {
        var service = new FakeUpdateService();
        var package = CreatePackage();
        service.CompleteCheck(package);
        using var coordinator = new DesktopUpdateCoordinator(service, CreateOptions());

        Assert.True(await coordinator.CheckNowAsync());

        Assert.Same(package, coordinator.ReadyPackage);
        Assert.Equal(DesktopUpdateStatus.Ready, coordinator.Current.Status);
        Assert.Equal(new Version(0, 1, 8), coordinator.Current.Version);
        Assert.Equal(100, coordinator.Current.DownloadPercent);
        Assert.Equal(["Новый экран обновлений"], coordinator.Current.ReleaseNotes);
        Assert.DoesNotContain(
            "http",
            System.Text.Json.JsonSerializer.Serialize(coordinator.Current),
            StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task DefersReadyUpdateAndKeepsItAvailableForInstallation()
    {
        var service = new FakeUpdateService();
        var package = CreatePackage();
        service.CompleteCheck(package);
        using var coordinator = new DesktopUpdateCoordinator(service, CreateOptions());
        await coordinator.CheckNowAsync();
        var deferredUntil = DateTimeOffset.UtcNow.AddHours(24);

        Assert.True(await coordinator.DeferReadyUpdateAsync(deferredUntil));

        Assert.Same(package, coordinator.ReadyPackage);
        Assert.Equal(package, service.DeferredPackage);
        Assert.Equal(deferredUntil, service.DeferredUntil);
        Assert.Equal(DesktopUpdateStatus.Deferred, coordinator.Current.Status);
        Assert.Equal(deferredUntil, coordinator.Current.DeferredUntil);
    }

    [Fact]
    public async Task StartsBackgroundCheckWithoutBlockingCaller()
    {
        var service = new FakeUpdateService();
        using var coordinator = new DesktopUpdateCoordinator(service, CreateOptions());

        coordinator.Start();
        await service.CheckStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        Assert.Equal(1, service.CheckCount);
        Assert.Equal(DesktopUpdateStatus.Checking, coordinator.Current.Status);
        service.CompleteCheck(null);
    }

    [Fact]
    public async Task ReportsSafeDownloadProgress()
    {
        var service = new FakeUpdateService();
        using var coordinator = new DesktopUpdateCoordinator(service, CreateOptions());
        var check = coordinator.CheckNowAsync();
        await service.CheckStarted.Task.WaitAsync(TimeSpan.FromSeconds(2));

        service.ReportProgress(new Version(0, 1, 8), 50, 100);

        Assert.Equal(DesktopUpdateStatus.Downloading, coordinator.Current.Status);
        Assert.Equal(new Version(0, 1, 8), coordinator.Current.Version);
        Assert.Equal(50, coordinator.Current.DownloadPercent);
        service.CompleteCheck(null);
        await check;
    }

    [Fact]
    public async Task StartsInstallerForReadyPackageAndPublishesInstallingState()
    {
        var service = new FakeUpdateService();
        var package = CreatePackage();
        service.CompleteCheck(package);
        using var coordinator = new DesktopUpdateCoordinator(service, CreateOptions());
        await coordinator.CheckNowAsync();

        Assert.True(coordinator.TryInstallReadyUpdate("HUB.Desktop.exe"));

        Assert.Equal(package, service.InstalledPackage);
        Assert.Equal("HUB.Desktop.exe", service.ApplicationPath);
        Assert.Equal(DesktopUpdateStatus.Installing, coordinator.Current.Status);
    }

    private static DesktopUpdateOptions CreateOptions() => new(
        Enabled: true,
        ManifestUri: new Uri("https://hubit.zsgp.ru/desktop-updates/stable/latest.json"),
        InitialDelayMinimum: TimeSpan.Zero,
        InitialDelayMaximum: TimeSpan.Zero,
        CheckInterval: TimeSpan.FromHours(12),
        RetryDelay: TimeSpan.FromMinutes(15));

    private static DesktopUpdatePackage CreatePackage()
    {
        var manifest = new DesktopUpdateManifest(
            DesktopUpdateManifestVerifier.SchemaVersion,
            DesktopUpdateManifestVerifier.StableChannel,
            new Version(0, 1, 8),
            DateTimeOffset.UtcNow,
            "stable/0.1.8/HUB-Desktop-Setup-0.1.8-win-x64.exe",
            new Uri(
                "https://hubit.zsgp.ru/desktop-updates/stable/0.1.8/" +
                "HUB-Desktop-Setup-0.1.8-win-x64.exe"),
            123,
            new string('a', 64),
            ["Новый экран обновлений"],
            new DesktopUpdateSignature(
                DesktopUpdateManifestVerifier.SignatureAlgorithm,
                DesktopUpdateTrust.KeyId,
                "signature"));
        return new DesktopUpdatePackage(manifest, "setup.exe", "manifest.json", null);
    }

    private sealed class FakeUpdateService : IDesktopUpdateService
    {
        private TaskCompletionSource<DesktopUpdatePackage?> _result =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public int CheckCount { get; private set; }

        public TaskCompletionSource CheckStarted { get; } =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        public DesktopUpdatePackage? DeferredPackage { get; private set; }

        public DateTimeOffset? DeferredUntil { get; private set; }

        public DesktopUpdatePackage? InstalledPackage { get; private set; }

        public string? ApplicationPath { get; private set; }

        public IReadOnlyList<string> InstalledReleaseNotes { get; set; } = [];

        public event EventHandler<DesktopUpdateDownloadProgress>? DownloadProgress;

        public async Task<DesktopUpdatePackage?> CheckOnceAsync(
            CancellationToken cancellationToken = default)
        {
            CheckCount++;
            CheckStarted.TrySetResult();
            return await _result.Task.WaitAsync(cancellationToken);
        }

        public Task DeferAsync(
            DesktopUpdatePackage package,
            DateTimeOffset deferredUntil,
            CancellationToken cancellationToken = default)
        {
            DeferredPackage = package;
            DeferredUntil = deferredUntil;
            return Task.CompletedTask;
        }

        public bool TryLaunchInstaller(DesktopUpdatePackage package, string applicationPath)
        {
            InstalledPackage = package;
            ApplicationPath = applicationPath;
            return true;
        }

        public void CompleteCheck(DesktopUpdatePackage? package) => _result.TrySetResult(package);

        public void ReportProgress(Version version, long downloadedBytes, long totalBytes) =>
            DownloadProgress?.Invoke(
                this,
                new DesktopUpdateDownloadProgress(version, downloadedBytes, totalBytes));
    }
}
