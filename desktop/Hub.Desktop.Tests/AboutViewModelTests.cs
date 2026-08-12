using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Updates;
using Hub.Desktop.ViewModels;
using Hub.Desktop.Views;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class AboutViewModelTests
{
    private static readonly DesktopRuntimeSnapshot Runtime = new(
        InstalledVersion: "0.1.8",
        WebView2Version: "123.0.1",
        WindowsAppSdkStatus: "Доступен",
        NotificationMode: "Закреплённые уведомления HUB");

    [Fact]
    public void AboutWindowRendersReadOnlyViewModelBindings()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                using var coordinator = new DesktopUpdateCoordinator(
                    new FakeUpdateService(),
                    new DesktopUpdateOptions(
                        Enabled: true,
                        ManifestUri: new Uri(
                            "https://hubit.zsgp.ru/desktop-updates/stable/latest.json"),
                        InitialDelayMinimum: TimeSpan.Zero,
                        InitialDelayMaximum: TimeSpan.Zero,
                        CheckInterval: TimeSpan.FromHours(12),
                        RetryDelay: TimeSpan.FromMinutes(15)));
                var window = new AboutWindow(
                    coordinator,
                    Runtime,
                    new FakeAutostartService(true));
                window.Show();
                window.UpdateLayout();
                window.Close();
            }
            catch (Exception exception)
            {
                captured = exception;
            }
            finally
            {
                completed.Set();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(completed.Wait(TimeSpan.FromSeconds(10)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }

    [Fact]
    public void ShowsRuntimeAutostartAndIdleState()
    {
        var checkedAt = new DateTimeOffset(2026, 8, 11, 12, 30, 0, TimeSpan.Zero);
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(true),
            new DesktopUpdateState(
                DesktopUpdateStatus.Idle,
                LastSuccessfulCheckUtc: checkedAt));

        Assert.Equal("0.1.8", model.InstalledVersion);
        Assert.Equal("123.0.1", model.WebView2Version);
        Assert.Equal("Доступен", model.WindowsAppSdkStatus);
        Assert.Equal("Закреплённые уведомления HUB", model.NotificationMode);
        Assert.Equal("Включён", model.AutostartStatus);
        Assert.Equal("Установлена последняя версия HUB Desktop.", model.UpdateStatus);
        Assert.Contains("11.08.2026", model.LastSuccessfulCheck);
        Assert.True(model.CanCheckForUpdates);
        Assert.False(model.CanInstallUpdate);
    }

    [Theory]
    [InlineData(DesktopUpdateStatus.Disabled, "Обновления отключены политикой администратора.", false)]
    [InlineData(DesktopUpdateStatus.Checking, "Проверяем наличие обновлений…", false)]
    [InlineData(DesktopUpdateStatus.Downloading, "Найдена версия 0.1.9. Загружаем обновление — 50%. HUB продолжает работать.", false)]
    [InlineData(DesktopUpdateStatus.Ready, "Обновление 0.1.9 загружено. Установка начнётся только после вашего подтверждения.", false)]
    [InlineData(DesktopUpdateStatus.Installing, "HUB Desktop закроется на время установки версии 0.1.9 и откроется снова.", false)]
    [InlineData(DesktopUpdateStatus.Error, "Не удалось проверить обновления. Проверьте подключение и повторите попытку.", true)]
    public void PresentsSafeActionableUpdateStatus(
        DesktopUpdateStatus status,
        string expected,
        bool canCheck)
    {
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(false),
            new DesktopUpdateState(
                status,
                Version: new Version(0, 1, 9),
                DownloadedBytes: 50,
                TotalBytes: 100,
                ErrorCode: "https://secret.example/?token=secret"));

        Assert.Equal(expected, model.UpdateStatus);
        Assert.Equal(canCheck, model.CanCheckForUpdates);
        Assert.DoesNotContain("secret", model.UpdateStatus, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("http", model.UpdateStatus, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MakesReadyUpdateAnExplicitSeparateAction()
    {
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(true),
            new DesktopUpdateState(
                DesktopUpdateStatus.Ready,
                Version: new Version(0, 1, 9)));

        Assert.False(model.CanCheckForUpdates);
        Assert.True(model.CanInstallUpdate);
        Assert.True(model.CanDeferUpdate);
        Assert.Equal("Проверить обновления", model.CheckActionText);
    }

    [Fact]
    public void KeepsInstallActionAfterRunnerLaunchFailure()
    {
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(true),
            new DesktopUpdateState(
                DesktopUpdateStatus.Error,
                Version: new Version(0, 1, 9),
                ErrorCode: "runner_launch"));

        Assert.True(model.CanInstallUpdate);
        Assert.False(model.CanCheckForUpdates);
        Assert.Equal(
            "Не удалось запустить установку. HUB продолжает работать. Повторите попытку.",
            model.UpdateStatus);
    }

    [Fact]
    public void ShowsReleaseNotesAndDeferredTime()
    {
        var deferredUntil = new DateTimeOffset(2026, 8, 12, 10, 0, 0, TimeSpan.Zero);
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(false),
            new DesktopUpdateState(
                DesktopUpdateStatus.Deferred,
                Version: new Version(0, 1, 9),
                DeferredUntil: deferredUntil,
                ReleaseNotes: ["Новый экран обновлений", "Исправлена загрузка"]));

        Assert.Contains("0.1.9", model.UpdateStatus);
        Assert.Contains("12.08.2026", model.UpdateStatus);
        Assert.Equal(2, model.ReleaseNotes.Count);
        Assert.Equal("Выключен", model.AutostartStatus);
    }

    [Fact]
    public void LabelsAdministratorManagedAutostart()
    {
        var model = new AboutViewModel(
            Runtime,
            new FakeAutostartService(true, canUserChange: false),
            new DesktopUpdateState(DesktopUpdateStatus.Idle));

        Assert.Equal("Включён (политика администратора)", model.AutostartStatus);
    }

    private sealed class FakeAutostartService(
        bool enabled,
        bool canUserChange = true) : IAutostartService
    {
        public bool IsEnabled { get; } = enabled;

        public bool CanUserChange { get; } = canUserChange;

        public void EnsureEnabledByDefault()
        {
        }

        public void SetEnabled(bool enabled)
        {
        }
    }

    private sealed class FakeUpdateService : IDesktopUpdateService
    {
        public IReadOnlyList<string> InstalledReleaseNotes => [];

        public event EventHandler<DesktopUpdateDownloadProgress>? DownloadProgress
        {
            add { }
            remove { }
        }

        public Task<DesktopUpdatePackage?> CheckOnceAsync(
            CancellationToken cancellationToken = default) =>
            Task.FromResult<DesktopUpdatePackage?>(null);

        public Task DeferAsync(
            DesktopUpdatePackage package,
            DateTimeOffset deferredUntil,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public bool TryLaunchInstaller(
            DesktopUpdatePackage package,
            string applicationPath) => false;
    }
}
