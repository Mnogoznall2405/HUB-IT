using System.Reflection;
using System.Windows;
using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.DeepLinks;
using Hub.Desktop.Downloads;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;
using Hub.Desktop.Shell;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Hub.Desktop.ViewModels;
using Hub.Desktop.Views;
using Hub.Desktop.WebView;
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
    private DesktopWindowManager? _windowManager;
    private DesktopSystemLifecycleService? _systemLifecycle;

    protected override async void OnStartup(StartupEventArgs e)
    {
        DesktopPerfBench.MarkOnce("app_onstartup");
        base.OnStartup(e);
        DesktopLog.Initialize();
        DesktopAppIdentity.TryApplyToCurrentProcess();

        try
        {
            if (!DesktopLaunchRequest.TryParse(e.Args, out var launchRequest))
            {
                launchRequest = DesktopLaunchRequest.Default;
                DesktopLog.Warning("Ignored invalid desktop launch arguments");
            }

            _singleInstance = new SingleInstanceCoordinator(DesktopPerfBench.ApplicationId);

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
                DesktopPerfBench.MarkOnce("notifications_register_start");
                try
                {
                    _windowsNotifications = new WindowsAppNotificationService();
                    _windowsNotifications.Activated += Notifications_Activated;
                    _windowsAppNotificationsAvailable = _windowsNotifications.TryRegister();
                    DesktopPerfBench.MarkOnce("notifications_register_end");
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
            var notifications = new FallbackDesktopNotificationService(
                primaryNotifications,
                notificationFallbackEnabled);
            _notifications = notifications;

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
                if (DesktopPerfBench.IsEnabled)
                {
                    DesktopPerfBench.MarkOnce("autostart_skipped");
                }
                else
                {
                    autostart.EnsureEnabledByDefault();
                }
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
            var updates = new DesktopUpdateCoordinator(_updateService, updateOptions);
            _updates = updates;
            var downloads = new DesktopDownloadCoordinator();
            var webViewEnvironmentProvider = new DesktopWebViewEnvironmentProvider(
                DesktopPaths.UserDataFolder);
            var windowManager = new DesktopWindowManager(options.BaseUri);
            _windowManager = windowManager;
            var lifecycleBroadcaster = new DesktopSystemLifecycleBroadcaster(windowManager);
            windowManager.AttachLifecycleBroadcaster(lifecycleBroadcaster);
            _systemLifecycle = new DesktopSystemLifecycleService(
                new WindowsDesktopSystemEventSource(),
                new DesktopSystemLifecycleCoalescer(new DispatcherDelayScheduler(Dispatcher)),
                action =>
                {
                    if (Dispatcher.CheckAccess())
                    {
                        action();
                        return;
                    }

                    _ = Dispatcher.BeginInvoke(action);
                });
            _systemLifecycle.Coalesced += SystemLifecycle_Coalesced;
            var runtime = CreateRuntimeSnapshot(notificationFallbackEnabled);
            var window = new MainWindow(
                options,
                notifications,
                autostart,
                updates,
                runtime,
                policy,
                windowManager,
                webViewEnvironmentProvider,
                downloads,
                startInBackground);
            MainWindow = window;

            windowManager.RegisterPrimary(window);
            windowManager.ConfigureSecondaryFactory(route =>
                new SecondaryHubWindow(
                    options,
                    notifications,
                    windowManager,
                    window,
                    downloads,
                    webViewEnvironmentProvider,
                    window.CreateSecondaryWindowPlacement(),
                    route));

            _singleInstance.ActivationRequested += (_, eventArgs) =>
                Dispatcher.BeginInvoke(() => HandleLaunchRequest(window, eventArgs.Request));
            _singleInstance.StartListening();

            window.Show();
            DesktopPerfBench.MarkOnce("window_show_returned");
            if (launchRequest.Route is not null || launchRequest.OpenDownloads)
            {
                HandleLaunchRequest(window, launchRequest);
            }

            if (!DesktopPerfBench.IsEnabled)
            {
                DesktopJumpListService.TryApply(this, executablePath);
                _updates.Start();
            }

            DesktopPerfBench.MarkOnce("app_startup_complete");
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

        if (_systemLifecycle is not null)
        {
            _systemLifecycle.Coalesced -= SystemLifecycle_Coalesced;
            _systemLifecycle.Dispose();
            _systemLifecycle = null;
        }

        _singleInstance?.Dispose();
        _updates?.Dispose();
        _updateService?.Dispose();
        base.OnExit(e);
    }

    private void SystemLifecycle_Coalesced(object? sender, DesktopSystemLifecycleMessage message)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => SystemLifecycle_Coalesced(sender, message));
            return;
        }

        _windowManager?.PublishSystemLifecycle(message);
    }

    private void Notifications_Activated(object? sender, DesktopNotificationActivationEventArgs e)
    {
        Dispatcher.BeginInvoke(() =>
        {
            _windowManager?.ActivateLastOrPrimary(e.Route);
        });
    }

    private void HandleLaunchRequest(MainWindow mainWindow, DesktopLaunchRequest request)
    {
        ArgumentNullException.ThrowIfNull(mainWindow);
        ArgumentNullException.ThrowIfNull(request);
        if (request.OpenDownloads)
        {
            mainWindow.ShowDownloads();
            return;
        }

        _windowManager?.ActivateLastOrPrimary(request.Route);
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
