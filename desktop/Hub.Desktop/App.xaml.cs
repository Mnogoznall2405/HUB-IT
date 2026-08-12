using System.Reflection;
using System.Windows;
using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.DeepLinks;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;
using Hub.Desktop.Shell;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Hub.Desktop.ViewModels;
using Microsoft.Web.WebView2.Core;
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;

namespace Hub.Desktop;

public partial class App : Application
{
    private SingleInstanceCoordinator? _singleInstance;
    private FallbackDesktopNotificationService? _notifications;
    private WindowsAppNotificationService? _windowsNotifications;
    private bool _windowsAppNotificationsAvailable;
    private string _windowsAppSdkStatus = "Не проверен";
    private DesktopUpdateService? _updateService;
    private DesktopUpdateCoordinator? _updates;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DesktopLog.Initialize();

        try
        {
            if (!DesktopLaunchRequest.TryParse(e.Args, out var launchRequest))
            {
                launchRequest = DesktopLaunchRequest.Default;
                DesktopLog.Warning("Ignored invalid desktop launch arguments");
            }

            _singleInstance = new SingleInstanceCoordinator();

            if (!_singleInstance.IsPrimary)
            {
                var activated = await _singleInstance.SignalPrimaryAsync(launchRequest);

                if (!activated)
                {
                    MessageBox.Show(
                        "Запущенный HUB Desktop не ответил. Повторите попытку.",
                        "HUB Desktop",
                        MessageBoxButton.OK,
                        MessageBoxImage.Warning);
                }

                Shutdown(activated ? 0 : 2);
                return;
            }

            IDesktopNotificationService primaryNotifications =
                UnavailableDesktopNotificationService.Instance;
            var policy = new RegistryDesktopPolicyProvider().Load();

            var elevationKnown = ProcessElevation.TryGetIsElevated(
                out var isElevated,
                out var elevationError);
            if (!elevationKnown)
            {
                DesktopLog.Warning(
                    $"Process elevation could not be determined; error={elevationError}. " +
                    "Windows app notifications are disabled");
            }
            else if (isElevated)
            {
                DesktopLog.Warning(
                    "Windows app notifications are disabled for an elevated process; " +
                    "run HUB Desktop as the current user to enable them");
            }
            else
            {
                DesktopLog.Info("Registering self-contained Windows app notifications");
                try
                {
                    _windowsNotifications = new WindowsAppNotificationService();
                    _windowsNotifications.Activated += Notifications_Activated;
                    _windowsAppNotificationsAvailable = _windowsNotifications.TryRegister();
                    if (_windowsAppNotificationsAvailable)
                    {
                        primaryNotifications = _windowsNotifications;
                    }
                }
                catch (Exception exception)
                {
                    DesktopLog.Error(
                        "Self-contained Windows app notification initialization failed",
                        exception);
                }
            }

            _windowsAppSdkStatus = WindowsAppRuntime.DescribeStatus(
                elevationKnown,
                isElevated,
                _windowsAppNotificationsAvailable);

            var notificationFallbackEnabled =
                policy.ResolveNotificationFallbackEnabled(defaultEnabled: true);
            _notifications = new FallbackDesktopNotificationService(
                primaryNotifications,
                notificationFallbackEnabled);

            var options = DesktopOptions.Load();
            var updateOptions = options.Updates with
            {
                Enabled = policy.ResolveUpdatesEnabled(options.Updates.Enabled),
            };
            var executablePath = Environment.ProcessPath
                ?? throw new InvalidOperationException("Desktop executable path is unavailable.");
            var autostart = new WindowsAutostartService(
                executablePath,
                policy.AutostartMode);
            try
            {
                autostart.EnsureEnabledByDefault();
                DesktopLog.Info(
                    autostart.IsEnabled
                        ? "Autostart is enabled"
                        : "Autostart remains disabled by user preference");
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Default autostart configuration failed", exception);
            }

            var desktopSettings = new DesktopSettingsStore(DesktopPaths.SettingsFile).Load();
            var startInBackground = launchRequest.StartInBackground
                && desktopSettings.LaunchVisibility == DesktopLaunchVisibility.Hidden;
            _updateService = new DesktopUpdateService(updateOptions);
            _updates = new DesktopUpdateCoordinator(_updateService, updateOptions);
            var runtime = CreateRuntimeSnapshot(notificationFallbackEnabled);
            var window = new MainWindow(
                options,
                _notifications,
                autostart,
                _updates,
                runtime,
                policy,
                startInBackground);
            MainWindow = window;

            _singleInstance.ActivationRequested += (_, eventArgs) =>
                Dispatcher.BeginInvoke(() => window.HandleLaunchRequest(eventArgs.Request));
            _singleInstance.StartListening();

            window.Show();
            if (launchRequest.Route is not null || launchRequest.OpenDownloads)
            {
                window.HandleLaunchRequest(launchRequest);
            }

            DesktopJumpListService.TryApply(this, executablePath);
            _updates.Start();
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop startup failed", exception);
            MessageBox.Show(
                "HUB Desktop не удалось запустить. Проверьте конфигурацию приложения.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(1);
        }
    }

    protected override void OnSessionEnding(SessionEndingCancelEventArgs e)
    {
        if (MainWindow is MainWindow window)
        {
            window.PrepareForShutdown();
        }

        base.OnSessionEnding(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_windowsNotifications is not null)
        {
            _windowsNotifications.Activated -= Notifications_Activated;
            _windowsNotifications.Dispose();
        }

        _singleInstance?.Dispose();
        _updates?.Dispose();
        _updateService?.Dispose();
        base.OnExit(e);
    }

    private void Notifications_Activated(object? sender, DesktopNotificationActivationEventArgs e)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (MainWindow is MainWindow window)
            {
                window.ShowAndNavigate(e.Route);
            }
        });
    }

    private DesktopRuntimeSnapshot CreateRuntimeSnapshot(bool notificationFallbackEnabled)
    {
        var assemblyVersion = Assembly.GetEntryAssembly()?.GetName().Version
            ?? new Version(0, 0, 0);
        string webView2Version;
        try
        {
            webView2Version = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(webView2Version))
            {
                webView2Version = "Недоступен";
            }
        }
        catch
        {
            webView2Version = "Недоступен";
        }

        var notificationMode = _windowsAppNotificationsAvailable
            ? notificationFallbackEnabled
                ? "Windows App SDK + закреплённый fallback HUB"
                : "Только Windows App SDK; fallback отключён политикой"
            : notificationFallbackEnabled
                ? "Закреплённые уведомления HUB; системный канал отключён"
                : "Уведомления недоступны: системный канал и fallback отключены";
        return new DesktopRuntimeSnapshot(
            DesktopUpdateManifestVerifier.FormatVersion(assemblyVersion),
            webView2Version,
            _windowsAppSdkStatus,
            notificationMode);
    }
}
