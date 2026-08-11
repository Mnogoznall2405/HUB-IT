using System.Windows;
using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;
using Hub.Desktop.Updates;
using Application = System.Windows.Application;
using MessageBox = System.Windows.MessageBox;

namespace Hub.Desktop;

public partial class App : Application
{
    private SingleInstanceCoordinator? _singleInstance;
    private FallbackDesktopNotificationService? _notifications;
    private WindowsAppNotificationService? _windowsNotifications;
    private bool _windowsAppRuntimeInitialized;
    private DesktopUpdateService? _updates;

    protected override async void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        DesktopLog.Initialize();

        try
        {
            _singleInstance = new SingleInstanceCoordinator();

            if (!_singleInstance.IsPrimary)
            {
                var activated = await _singleInstance.SignalPrimaryAsync();

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

            if (!ProcessElevation.TryGetIsElevated(out var isElevated, out var elevationError))
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
                DesktopLog.Info("Initializing Windows App SDK Runtime");
                _windowsAppRuntimeInitialized = WindowsAppRuntime.TryInitialize(out var runtimeError);
                if (_windowsAppRuntimeInitialized)
                {
                    DesktopLog.Info("Registering Windows app notifications");
                    _windowsNotifications = new WindowsAppNotificationService();
                    _windowsNotifications.Activated += Notifications_Activated;
                    _windowsNotifications.TryRegister();
                    primaryNotifications = _windowsNotifications;
                }
                else
                {
                    DesktopLog.Warning($"Windows App SDK Runtime is unavailable; hresult=0x{runtimeError:X8}");
                }
            }

            _notifications = new FallbackDesktopNotificationService(primaryNotifications);

            var options = DesktopOptions.Load();
            var executablePath = Environment.ProcessPath
                ?? throw new InvalidOperationException("Desktop executable path is unavailable.");
            var autostart = new WindowsAutostartService(executablePath);
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

            var startInBackground = WindowsAutostartService.IsBackgroundLaunch(e.Args);
            _updates = new DesktopUpdateService(options.Updates);
            var window = new MainWindow(
                options,
                _notifications,
                autostart,
                _updates,
                startInBackground);
            MainWindow = window;

            _singleInstance.ActivationRequested += (_, _) =>
                Dispatcher.BeginInvoke(new Action(window.ShowAndActivate));
            _singleInstance.StartListening();

            window.Show();
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

        if (_windowsAppRuntimeInitialized)
        {
            WindowsAppRuntime.Shutdown();
        }

        _singleInstance?.Dispose();
        _updates?.Dispose();
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
}
