using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using System.Windows.Threading;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.DeepLinks;
using Hub.Desktop.Downloads;
using Hub.Desktop.Interop;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Printing;
using Hub.Desktop.Remote;
using Hub.Desktop.Security;
using Hub.Desktop.Shell;
using Hub.Desktop.Transfers;
using Hub.Desktop.UI;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Hub.Desktop.ViewModels;
using Hub.Desktop.Views;
using Hub.Desktop.WebView;
using Hub.Desktop.Workspace;
using Application = System.Windows.Application;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace Hub.Desktop;

public partial class MainWindow : Window, IDesktopHubWindow, IDesktopGlobalActions
{
    private readonly DesktopOptions _options;
    private readonly IDesktopNotificationService _notifications;
    private readonly IAutostartService _autostart;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly ExternalUriLauncher _externalUriLauncher;
    private readonly bool _startHidden;
    private readonly Forms.ToolStripMenuItem _autostartItem;
    private readonly HubTrayContextMenu _trayMenu;
    private readonly Forms.NotifyIcon _trayIcon;
    private readonly Drawing.Icon _applicationIcon;
    private readonly DesktopNotificationWindow _desktopNotificationWindow;
    private readonly DesktopUpdateCoordinator _updates;
    private readonly DesktopRuntimeSnapshot _runtime;
    private readonly DesktopPolicy _policy;
    private readonly DesktopDownloadCoordinator _downloads;
    private readonly WebViewRecoveryPolicy _webViewRecovery = new();
    private readonly CancellationTokenSource _recoveryShutdown = new();
    private readonly Forms.ToolStripMenuItem _updateItem;
    private readonly Forms.ToolStripMenuItem _checkUpdatesItem;
    private readonly Forms.ToolStripMenuItem _settingsItem;
    private readonly Forms.ToolStripMenuItem _aboutItem;
    private readonly Forms.ToolStripMenuItem _diagnosticsItem;
    private readonly Forms.ToolStripMenuItem _downloadsItem;
    private readonly Forms.ToolStripMenuItem _openInBrowserItem;
    private readonly Forms.ToolStripMenuItem _printItem;
    private readonly Forms.ToolStripMenuItem _hardReloadItem;
    private readonly Forms.ToolStripMenuItem _commandPaletteItem;
    private readonly Forms.ToolStripMenuItem _quietModeItem;
    private readonly Forms.ToolStripMenuItem _privacyNotificationItem;
    private readonly Forms.ToolStripMenuItem _sectionsItem;
    private readonly Forms.ToolStripMenuItem _desktopToolsItem;
    private readonly Forms.ToolStripMenuItem _notificationsQuickRouteItem;
    private readonly Forms.ToolStripMenuItem _tasksQuickRouteItem;
    private readonly Forms.ToolStripMenuItem _chatQuickRouteItem;
    private readonly Forms.ToolStripMenuItem _mailQuickRouteItem;
    private readonly Forms.ToolStripMenuItem _moreQuickRoutesItem;
    private readonly DesktopDiagnosticsCollector _diagnostics = new();
    private readonly DesktopPerformanceMetrics _performance;
    private readonly DesktopMemoryMetrics _memoryMetrics = new();
    private readonly DesktopMemorySampler _memorySampler = new();
    private readonly DispatcherTimer _performanceTimer;
    private readonly DispatcherTimer _downloadFailureTimer;
    private readonly DesktopWebViewHost _webViewHost;
    private readonly DesktopWebViewEnvironmentProvider _webViewEnvironmentProvider;
    private readonly DesktopWindowManager _windowManager;
    private readonly DesktopWindowController _windowController;
    private readonly DesktopApplicationController _applicationController;
    private readonly DesktopSettingsStore _settingsStore = new(DesktopPaths.SettingsFile);
    private readonly DesktopWindowPlacementService _windowPlacement = new();
    private readonly DesktopPrintService _printing = new();
    private readonly DesktopTaskbarProgress _downloadTaskbarProgress = new();
    private readonly DesktopTaskbarPinningService _taskbarPinning = new();
    private readonly DesktopGlobalHotkey _globalHotkey = new();
    private readonly DesktopSettings _startupSettings;
    private DesktopSettings _notificationSettings;
    private DesktopBridgeHost? _desktopBridge;
    private WebView2? _webView;
    private CoreWebView2MemoryUsageTargetLevel? _webViewMemoryUsageTargetLevel;
    private HwndSource? _windowSource;
    private string? _pendingInternalRoute;
    private bool _initializing;
    private bool _requiresReset;
    private bool _recoveryInProgress;
    private bool _hardReloadInProgress;
    private bool _trayHintShown;
    private DesktopUpdatePackage? _readyUpdate;
    private AboutWindow? _aboutWindow;
    private DiagnosticsWindow? _diagnosticsWindow;
    private DownloadsWindow? _downloadsWindow;
    private CancellationTokenSource? _navigationTimeout;
    private string _lastNavigationStatus = "NotStarted";
    private DateTimeOffset? _lastNavigationAtUtc;
    private DateTimeOffset? _lastBridgeHandshakeUtc;
    private bool _diagnosticsOpening;
    private DesktopThemeMode _currentThemeMode = DesktopThemeMode.Dark;
    private DesktopShellStatus _shellStatus = DesktopShellStatus.Empty;
    private bool _sessionLocked;
    private bool _sessionNotificationsRegistered;
    private string _presentedTaskbarBadgeText = string.Empty;
    private string? _lastPersistedSafeRoute;
    private bool _restoreMaximizedWhenShown;
    private bool _pendingCommandPalette;
    private DateTimeOffset _nextMemorySampleAtUtc;
    private bool _memorySampleInFlight;
    private bool _taskbarPinSuggestionChecked;
    private bool _taskbarPinManualOnly;
    private bool _taskbarPinBusy;
    private bool _benchFrontendProbeStarted;

    public MainWindow(
        DesktopOptions options,
        IDesktopNotificationService notifications,
        IAutostartService autostart,
        DesktopUpdateCoordinator updates,
        DesktopRuntimeSnapshot runtime,
        DesktopPolicy policy,
        DesktopWindowManager windowManager,
        DesktopWebViewEnvironmentProvider webViewEnvironmentProvider,
        DesktopDownloadCoordinator downloads,
        bool startHidden = false)
    {
        _options = options;
        _notifications = notifications;
        _autostart = autostart;
        _updates = updates;
        _runtime = runtime;
        _policy = policy ?? throw new ArgumentNullException(nameof(policy));
        _windowManager = windowManager ?? throw new ArgumentNullException(nameof(windowManager));
        _webViewEnvironmentProvider = webViewEnvironmentProvider
            ?? throw new ArgumentNullException(nameof(webViewEnvironmentProvider));
        _downloads = downloads ?? throw new ArgumentNullException(nameof(downloads));
        _startHidden = startHidden;
        _startupSettings = _settingsStore.Load();
        _notificationSettings = _startupSettings;
        _lastPersistedSafeRoute = _startupSettings.LastSafeRoute;
        _pendingInternalRoute = _startupSettings.StartupPage == DesktopStartupPage.LastSafePage
            ? _startupSettings.LastSafeRoute
            : null;
        _navigationPolicy = new NavigationPolicy(options.BaseUri);
        _externalUriLauncher = new ExternalUriLauncher(_navigationPolicy);
        _performance = new DesktopPerformanceMetrics(GetProcessStartedAt());
        _nextMemorySampleAtUtc = DateTimeOffset.UtcNow.AddSeconds(10);
        _performanceTimer = new DispatcherTimer(
            DispatcherPriority.Background,
            Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(1),
        };
        _performanceTimer.Tick += PerformanceTimer_Tick;
        _performanceTimer.Start();
        _downloadFailureTimer = new DispatcherTimer(
            DispatcherPriority.Background,
            Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(3),
        };
        _downloadFailureTimer.Tick += DownloadFailureTimer_Tick;
        InitializeComponent();
        ContentRendered += MainWindow_ContentRendered;
        if (_startupSettings.WindowPlacement is not null)
        {
            WindowStartupLocation = WindowStartupLocation.Manual;
        }
        TaskbarItemInfo = new TaskbarItemInfo();
        if (_policy.ResolveUpdateDeferralHours(defaultHours: 24) == 0)
        {
            DeferUpdateButton.Visibility = Visibility.Collapsed;
        }
        _webViewHost = new DesktopWebViewHost(BrowserHost, _webViewEnvironmentProvider);
        _windowController = new DesktopWindowController(this);
        UpdateMaximizeRestoreButton();
        UpdateNewWindowButtonState();

        _applicationIcon = LoadApplicationIcon();
        _desktopNotificationWindow = new DesktopNotificationWindow();
        _desktopNotificationWindow.OpenRequested += DesktopNotificationWindow_OpenRequested;
        _autostartItem = new Forms.ToolStripMenuItem("Запускать вместе с Windows")
        {
            CheckOnClick = false,
            AccessibleName = "Запускать HUB Desktop вместе с Windows",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _autostartItem.Click += (_, _) => ToggleAutostart();
        _updateItem = new Forms.ToolStripMenuItem("Обновление HUB Desktop готово")
        {
            AccessibleName = "Открыть готовое обновление HUB Desktop",
            Font = HubTrayContextMenu.CreateEmphasizedFont(),
            Padding = new Forms.Padding(2, 4, 8, 4),
            Visible = false,
        };
        _updateItem.Click += (_, _) => ShowReadyUpdate();
        _checkUpdatesItem = new Forms.ToolStripMenuItem("Проверить обновления")
        {
            AccessibleName = "Проверить обновления HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _checkUpdatesItem.Click += async (_, _) => await CheckForUpdatesFromTrayAsync();
        _settingsItem = new Forms.ToolStripMenuItem("Открыть настройки")
        {
            AccessibleName = "Открыть настройки HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _settingsItem.Click += (_, _) => ShowDesktopSettingsWindow();
        _aboutItem = new Forms.ToolStripMenuItem("О программе и обновления")
        {
            AccessibleName = "Открыть сведения о HUB Desktop и обновлениях",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _aboutItem.Click += (_, _) => ShowAboutWindow();
        _diagnosticsItem = new Forms.ToolStripMenuItem("Диагностика")
        {
            AccessibleName = "Открыть диагностику HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _diagnosticsItem.Click += async (_, _) => await ShowDiagnosticsWindowAsync();
        _downloadsItem = new Forms.ToolStripMenuItem("Загрузки")
        {
            AccessibleName = "Открыть загрузки HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _downloadsItem.Click += (_, _) => ShowDownloadsWindow();
        _openInBrowserItem = new Forms.ToolStripMenuItem("Открыть текущую страницу в браузере")
        {
            AccessibleName = "Открыть текущую безопасную страницу HUB в браузере",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _openInBrowserItem.Click += (_, _) => OpenCurrentPageInBrowser();
        _printItem = new Forms.ToolStripMenuItem("Печать текущей страницы…")
        {
            AccessibleName = "Открыть системный диалог печати текущей страницы HUB",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _printItem.Click += (_, _) => PrintCurrentPage();
        _hardReloadItem = new Forms.ToolStripMenuItem("Обновить портал без кэша    Ctrl+F5")
        {
            AccessibleName = "Обновить текущее окно HUB без кэша",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _hardReloadItem.Click += (_, _) => _windowManager.ReloadLastOrPrimaryWithoutCache();
        _commandPaletteItem = new Forms.ToolStripMenuItem("Быстрый переход…    Ctrl+K")
        {
            AccessibleName = "Открыть быстрый переход по разделам и командам HUB",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _commandPaletteItem.Click += (_, _) => ShowCommandPalette();
        _quietModeItem = new Forms.ToolStripMenuItem("Не беспокоить")
        {
            AccessibleName = "Настроить режим Не беспокоить HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _quietModeItem.DropDownItems.Add(
            "На 1 час",
            null,
            (_, _) => UpdateNotificationSettings(settings =>
                DesktopQuietMode.MuteForOneHour(settings, DateTimeOffset.UtcNow)));
        _quietModeItem.DropDownItems.Add(
            "До конца рабочего дня",
            null,
            (_, _) => UpdateNotificationSettings(settings =>
                DesktopQuietMode.MuteUntilWorkdayEnd(settings, DateTimeOffset.Now)));
        _quietModeItem.DropDownItems.Add(
            "Пока не включу",
            null,
            (_, _) => UpdateNotificationSettings(DesktopQuietMode.MuteIndefinitely));
        _quietModeItem.DropDownItems.Add(HubTrayContextMenu.CreateSeparator());
        _quietModeItem.DropDownItems.Add(
            "Включить уведомления",
            null,
            (_, _) => UpdateNotificationSettings(DesktopQuietMode.Unmute));
        _privacyNotificationItem = new Forms.ToolStripMenuItem(
            "Скрывать текст при блокировке Windows")
        {
            AccessibleName = "Скрывать личный текст уведомлений при блокировке Windows",
            CheckOnClick = false,
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _privacyNotificationItem.Click += (_, _) => UpdateNotificationSettings(settings =>
            settings with
            {
                HideNotificationContentWhenLocked =
                    !settings.HideNotificationContentWhenLocked,
            });
        _sectionsItem = new Forms.ToolStripMenuItem("Разделы HUB")
        {
            AccessibleName = "Открыть список разделов HUB",
            Padding = new Forms.Padding(2, 4, 8, 4),
            Visible = false,
        };
        _desktopToolsItem = new Forms.ToolStripMenuItem("Настройки Desktop")
        {
            AccessibleName = "Открыть настройки и инструменты HUB Desktop",
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        _notificationsQuickRouteItem = CreateQuickRouteMenuItem();
        _tasksQuickRouteItem = CreateQuickRouteMenuItem();
        _chatQuickRouteItem = CreateQuickRouteMenuItem();
        _mailQuickRouteItem = CreateQuickRouteMenuItem();
        _moreQuickRoutesItem = new Forms.ToolStripMenuItem("Ещё")
        {
            AccessibleName = "Открыть дополнительные разделы HUB",
            Padding = new Forms.Padding(2, 4, 8, 4),
            Visible = false,
        };
        ((System.Collections.Specialized.INotifyCollectionChanged)_downloads.Items)
            .CollectionChanged += (_, _) => RefreshDownloadsMenuItem();
        _downloads.Changed += Downloads_Changed;
        _updates.StateChanged += Updates_StateChanged;
        _windowManager.WindowAvailabilityChanged += WindowManager_WindowAvailabilityChanged;
        _windowManager.ShellStatusChanged += WindowManager_ShellStatusChanged;
        _windowManager.QuickRoutesChanged += WindowManager_QuickRoutesChanged;
        RefreshAutostartMenuItem();
        _trayMenu = CreateTrayMenu();
        _trayMenu.ApplyTheme(_currentThemeMode);
        _trayMenu.Opening += (_, _) =>
        {
            _trayMenu.ApplyTheme(_currentThemeMode);
            RefreshAutostartMenuItem();
            PresentUpdateState(_updates.Current);
            _openInBrowserItem.Enabled = TryGetCurrentBrowserUri(out _);
            _printItem.Enabled = DesktopPrintService.CanPrintCurrent(
                _options.BaseUri,
                _webView?.CoreWebView2?.Source);
            RefreshNotificationPolicyMenu();
        };
        _trayIcon = new Forms.NotifyIcon
        {
            ContextMenuStrip = _trayMenu,
            Icon = _applicationIcon,
            Text = "HUB Desktop",
            Visible = true,
        };
        _applicationController = new DesktopApplicationController(
            () => _trayIcon.Visible = false);
        _trayIcon.MouseClick += (_, eventArgs) =>
        {
            if (eventArgs.Button == Forms.MouseButtons.Left)
            {
                _windowManager.ActivateLastOrPrimary();
            }
        };
        if (_notifications is FallbackDesktopNotificationService fallbackNotifications)
        {
            fallbackNotifications.SetRequestPolicy(ApplyNotificationPolicy);
            fallbackNotifications.SetFallback(ShowPersistentNotification, preferFallback: true);
            DesktopLog.Info("Persistent desktop notification presenter registered");
        }

        if (_startHidden)
        {
            WindowState = WindowState.Minimized;
            ShowInTaskbar = false;
        }

        PresentUpdateState(_updates.Current);
    }

    public void ShowAndActivate()
    {
        _windowController.ShowAndActivate();
        if (_restoreMaximizedWhenShown)
        {
            _restoreMaximizedWhenShown = false;
            WindowState = WindowState.Maximized;
        }
        SendDesktopWindowForegroundState();
        _ = PresentTaskbarPinSuggestionAsync();
        DesktopLog.Info("Main window activated");
    }

    public string? CurrentSource => _webView?.CoreWebView2?.Source;

    public void ShowAndNavigate(string? route)
    {
        ShowAndActivate();

        if (!DesktopBridgeProtocol.IsValidInternalRoute(route))
        {
            return;
        }

        if (_desktopBridge?.TryOpenInternalRoute(route) == true)
        {
            _pendingInternalRoute = null;
            return;
        }

        _pendingInternalRoute = route;
    }

    public void ReloadWithoutCache()
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(ReloadWithoutCache);
            return;
        }

        _ = ReloadWithoutCacheAsync();
    }

    public bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (!Dispatcher.CheckAccess())
        {
            return Dispatcher.Invoke(() => TryDeliverSystemLifecycle(message));
        }

        return _desktopBridge?.TryPostSystemLifecycle(message) == true;
    }

    public void HandleLaunchRequest(DesktopLaunchRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.OpenDownloads)
        {
            ShowDownloadsWindow();
            return;
        }

        if (request.Route is not null)
        {
            ShowAndNavigate(request.Route);
            return;
        }

        ShowAndActivate();
    }

    public void PrepareForShutdown()
    {
        _applicationController.PrepareForShutdown();
    }

    public void ShowDownloads() => ShowDownloadsWindow();

    public Task ShowDiagnosticsAsync() => ShowDiagnosticsWindowAsync();

    public Task CheckForUpdatesAsync() => CheckForUpdatesFromTrayAsync();

    internal DesktopWindowPlacement CreateSecondaryWindowPlacement()
    {
        var captured = _windowPlacement.TryCapture(
            new WindowInteropHelper(this).Handle,
            maximized: false);
        var width = Math.Max((int)MinWidth, captured?.Width ?? (int)Math.Round(ActualWidth));
        var height = Math.Max((int)MinHeight, captured?.Height ?? (int)Math.Round(ActualHeight));
        var x = captured?.X ?? (int)Math.Round(Left);
        var y = captured?.Y ?? (int)Math.Round(Top);
        return new DesktopWindowPlacement(
            X: x + 32,
            Y: y + 32,
            Width: width,
            Height: height,
            Maximized: false);
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _windowSource = (HwndSource?)PresentationSource.FromVisual(this);
        _windowSource?.AddHook(WindowMessageHook);
        var windowHandle = new WindowInteropHelper(this).Handle;
        _restoreMaximizedWhenShown = _startHidden
            && _startupSettings.WindowPlacement?.Maximized == true;
        if (!_windowPlacement.TryApply(
                windowHandle,
                _startupSettings.WindowPlacement,
                restoreMaximized: !_startHidden)
            && _startupSettings.WindowPlacement is not null)
        {
            DesktopLog.Warning("Saved desktop window placement could not be restored");
        }
        _sessionNotificationsRegistered = WindowsSessionStateMonitor.TryRegister(windowHandle);
        if (!_sessionNotificationsRegistered)
        {
            DesktopLog.Warning("Windows session lock notifications are unavailable");
        }

        if (_startupSettings.GlobalHotkeyEnabled && !_globalHotkey.TryRegister(windowHandle))
        {
            DesktopLog.Warning("Ctrl+Shift+H global hotkey is already in use");
            try
            {
                _notificationSettings = _settingsStore.Update(settings =>
                    settings with { GlobalHotkeyEnabled = false });
            }
            catch (Exception exception) when (
                exception is IOException
                or UnauthorizedAccessException
                or ArgumentException)
            {
                DesktopLog.Error("Conflicting desktop hotkey preference could not be cleared", exception);
            }
        }
    }

    private async void PerformanceTimer_Tick(object? sender, EventArgs e)
    {
        var now = DateTimeOffset.UtcNow;
        _performance.RecordUiPulse(now);
        if (_memorySampleInFlight || now < _nextMemorySampleAtUtc)
        {
            return;
        }

        _nextMemorySampleAtUtc = now.AddSeconds(10);
        var core = _webView?.CoreWebView2;
        if (core is null)
        {
            return;
        }

        DesktopMemoryProcessDescriptor[] descriptors;
        string route;
        try
        {
            descriptors =
            [
                new DesktopMemoryProcessDescriptor(
                    Environment.ProcessId,
                    DesktopMemoryProcessKind.Host),
                .. core.Environment.GetProcessInfos().Select(process =>
                    new DesktopMemoryProcessDescriptor(
                        process.ProcessId,
                        MapMemoryProcessKind(process.Kind))),
            ];
            route = core.Source;
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException)
        {
            return;
        }

        var background = !IsVisible || WindowState == WindowState.Minimized || !IsActive;
        _memorySampleInFlight = true;
        try
        {
            var sample = await Task.Run(() => _memorySampler.Capture(
                now,
                route,
                background,
                descriptors));
            if (sample is not null)
            {
                _memoryMetrics.Record(sample);
            }
        }
        finally
        {
            _memorySampleInFlight = false;
        }
    }

    private static DesktopMemoryProcessKind MapMemoryProcessKind(
        CoreWebView2ProcessKind kind) => kind switch
    {
        CoreWebView2ProcessKind.Browser => DesktopMemoryProcessKind.Browser,
        CoreWebView2ProcessKind.Renderer => DesktopMemoryProcessKind.Renderer,
        CoreWebView2ProcessKind.Gpu => DesktopMemoryProcessKind.Gpu,
        CoreWebView2ProcessKind.Utility or CoreWebView2ProcessKind.SandboxHelper =>
            DesktopMemoryProcessKind.Utility,
        _ => DesktopMemoryProcessKind.Other,
    };

    private static DateTimeOffset GetProcessStartedAt()
    {
        try
        {
            return new DateTimeOffset(Process.GetCurrentProcess().StartTime).ToUniversalTime();
        }
        catch
        {
            return DateTimeOffset.UtcNow;
        }
    }

    private nint WindowMessageHook(
        nint windowHandle,
        int message,
        nint wordParameter,
        nint longParameter,
        ref bool handled)
    {
        if (DesktopGlobalHotkey.IsActivationMessage(message, wordParameter))
        {
            handled = true;
            if (IsVisible && WindowState != WindowState.Minimized && IsActive)
            {
                Hide();
                SendDesktopWindowForegroundState();
            }
            else
            {
                ShowAndActivate();
            }

            return nint.Zero;
        }

        if (DesktopWindowController.TryHandleWindowMessage(
                windowHandle,
                message,
                longParameter))
        {
            handled = true;
        }

        if (WindowsSessionStateMonitor.TryResolveLockState(
                message,
                wordParameter,
                out var sessionLocked))
        {
            _sessionLocked = sessionLocked;
            PresentShellStatus();
            DesktopLog.Info(sessionLocked
                ? "Windows session locked; shell counters hidden"
                : "Windows session unlocked; shell counters restored");
        }

        return nint.Zero;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        Loaded -= Window_Loaded;
        DesktopPerfBench.MarkOnce("window_loaded");

        if (_startHidden)
        {
            Hide();
            WindowState = WindowState.Normal;
            ShowInTaskbar = true;
            DesktopLog.Info("Main window started hidden by autostart");
        }

        await CreateWebViewAsync();
        if (!_startHidden && !DesktopPerfBench.IsEnabled)
        {
            await PresentTaskbarPinSuggestionAsync();
        }
    }

    private void MainWindow_ContentRendered(object? sender, EventArgs e)
    {
        ContentRendered -= MainWindow_ContentRendered;
        DesktopPerfBench.MarkOnce("window_shown");
    }

    private void MaybeStartBenchFrontendProbe()
    {
        if (!DesktopPerfBench.IsEnabled || _benchFrontendProbeStarted)
        {
            return;
        }

        _benchFrontendProbeStarted = true;
        _ = ProbeBenchFrontendAsync();
    }

    private async Task ProbeBenchFrontendAsync()
    {
        try
        {
            for (var attempt = 0; attempt < 6; attempt++)
            {
                await Task.Delay(500);
                var core = _webView?.CoreWebView2;
                if (core is null)
                {
                    continue;
                }

                string encoded;
                try
                {
                    encoded = await core.ExecuteScriptAsync(DesktopPerfBench.CreateFrontendProbeScript());
                }
                catch (Exception exception) when (
                    exception is InvalidOperationException
                    or System.Runtime.InteropServices.COMException)
                {
                    continue;
                }

                if (!TryReadBenchFrontendProbe(encoded, out var fields))
                {
                    continue;
                }

                DesktopPerfBench.RecordFields("frontend_probe", fields);
                if (fields.TryGetValue("fcp", out var firstContentful)
                    && firstContentful is > 0)
                {
                    var navigationStartedAt = ReadBenchMarkMilliseconds("navigation_starting");
                    if (navigationStartedAt is long navigationMs)
                    {
                        var paintOffset = fields.TryGetValue("fp", out var firstPaint)
                            && firstPaint is > 0
                            ? firstPaint.Value
                            : firstContentful.Value;
                        DesktopPerfBench.RecordFields(
                            "first_paint",
                            new Dictionary<string, long?>
                            {
                                ["first_paint_ms"] = navigationMs + paintOffset,
                            });
                    }

                    break;
                }
            }

            var coreForLogin = _webView?.CoreWebView2;
            if (coreForLogin is not null)
            {
                await MaybeAutoLoginAsync(coreForLogin);
                await ProbeBenchAuthenticatedFrontendAsync(coreForLogin);
            }
        }
        finally
        {
            RecordBenchProcessSnapshot("frontend_probe_processes");
            DesktopPerfBench.MarkOnce("bench_ready");
            DesktopPerfBench.WriteReadySentinel();
            MaybeQuitAfterBench();
        }
    }

    private async Task NavigateBenchRouteAsync(CoreWebView2 core)
    {
        var script = DesktopPerfBench.CreateNavigateScript();
        if (script is null)
        {
            return;
        }

        _ = await core.ExecuteScriptAsync(script);
        DesktopPerfBench.MarkOnce("route_navigate");
        await Task.Delay(2500);
        try
        {
            var encodedPath = await core.ExecuteScriptAsync("window.location.pathname");
            var currentPath = System.Text.Json.JsonSerializer.Deserialize<string>(encodedPath);
            DesktopPerfBench.MarkOnce(
                string.Equals(
                    currentPath,
                    DesktopPerfBench.GetNavigatePath(),
                    StringComparison.OrdinalIgnoreCase)
                    ? "route_ready"
                    : "route_failed");
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException
            or System.Text.Json.JsonException)
        {
            DesktopPerfBench.MarkOnce("route_failed");
        }

        var smoke = DesktopPerfBench.CreatePostNavigateSmokeScript();
        if (smoke is not null)
        {
            try
            {
                var encoded = await core.ExecuteScriptAsync(smoke);
                var json = System.Text.Json.JsonSerializer.Deserialize<string>(encoded);
                if (!string.IsNullOrWhiteSpace(json))
                {
                    using var document = System.Text.Json.JsonDocument.Parse(json);
                    var loaded = document.RootElement.TryGetProperty("loaded", out var loadedEl)
                        && loadedEl.ValueKind == System.Text.Json.JsonValueKind.True;
                    var visible = document.RootElement.TryGetProperty("visible", out var visibleEl)
                        && visibleEl.ValueKind == System.Text.Json.JsonValueKind.True;
                    DesktopPerfBench.MarkOnce(loaded || visible
                        ? "functional_smoke_ok"
                        : "functional_smoke_failed");
                }
            }
            catch (Exception exception) when (
                exception is InvalidOperationException
                or System.Runtime.InteropServices.COMException
                or System.Text.Json.JsonException)
            {
                DesktopPerfBench.MarkOnce("functional_smoke_failed");
            }
        }
    }

    private async Task ProbeBenchAuthenticatedFrontendAsync(CoreWebView2 core)
    {
        if (!DesktopPerfBench.HasAutoLogin)
        {
            return;
        }

        await Task.Delay(800);
        try
        {
            var encoded = await core.ExecuteScriptAsync(DesktopPerfBench.CreateFrontendProbeScript());
            if (TryReadBenchFrontendProbe(encoded, out var fields))
            {
                DesktopPerfBench.RecordFields("frontend_probe_authenticated", fields);
            }
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException)
        {
            DesktopPerfBench.MarkOnce("authenticated_probe_failed");
        }

        RecordBenchProcessSnapshot("authenticated_processes");
    }

    private static bool TryReadBenchFrontendProbe(
        string encoded,
        out Dictionary<string, long?> fields)
    {
        fields = [];
        if (string.IsNullOrWhiteSpace(encoded) || encoded == "null")
        {
            return false;
        }

        try
        {
            var json = System.Text.Json.JsonSerializer.Deserialize<string>(encoded);
            if (string.IsNullOrWhiteSpace(json))
            {
                return false;
            }

            using var document = System.Text.Json.JsonDocument.Parse(json);
            DesktopPerfBench.RecordProbeJson("resource_timing", json);
            foreach (var property in document.RootElement.EnumerateObject())
            {
                fields[property.Name] = property.Value.ValueKind switch
                {
                    System.Text.Json.JsonValueKind.Number => property.Value.TryGetInt64(out var number)
                        ? number
                        : null,
                    System.Text.Json.JsonValueKind.Null => null,
                    _ => null,
                };
            }

            return fields.Count > 0;
        }
        catch (System.Text.Json.JsonException)
        {
            return false;
        }
    }

    private void RecordBenchProcessSnapshot(string mark)
    {
        if (!DesktopPerfBench.IsEnabled)
        {
            return;
        }

        var host = Process.GetCurrentProcess();
        long? rendererCount = null;
        long? gpuCount = null;
        long? utilityCount = null;
        long? rendererPrivateBytes = null;
        try
        {
            var infos = _webView?.CoreWebView2?.Environment.GetProcessInfos();
            if (infos is not null)
            {
                rendererCount = infos.Count(info => info.Kind == CoreWebView2ProcessKind.Renderer);
                gpuCount = infos.Count(info => info.Kind == CoreWebView2ProcessKind.Gpu);
                utilityCount = infos.Count(info =>
                    info.Kind is CoreWebView2ProcessKind.Utility
                        or CoreWebView2ProcessKind.SandboxHelper);
                var renderer = infos.FirstOrDefault(info => info.Kind == CoreWebView2ProcessKind.Renderer);
                if (renderer is not null)
                {
                    try
                    {
                        using var rendererProcess = Process.GetProcessById((int)renderer.ProcessId);
                        rendererPrivateBytes = rendererProcess.PrivateMemorySize64;
                    }
                    catch (Exception exception) when (
                        exception is ArgumentException
                        or InvalidOperationException
                        or System.ComponentModel.Win32Exception)
                    {
                        rendererPrivateBytes = null;
                    }
                }
            }
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException)
        {
            // Process enumeration is best-effort during a benchmark run.
        }

        DesktopPerfBench.RecordFields(
            mark,
            new Dictionary<string, long?>
            {
                ["private_bytes"] = host.PrivateMemorySize64,
                ["working_set"] = host.WorkingSet64,
                ["cpu_ms"] = (long)host.TotalProcessorTime.TotalMilliseconds,
                ["renderer_count"] = rendererCount,
                ["gpu_count"] = gpuCount,
                ["utility_count"] = utilityCount,
                ["renderer_private_bytes"] = rendererPrivateBytes,
            });
    }

    private static long? ReadBenchMarkMilliseconds(string mark)
    {
        if (!DesktopPerfBench.TryGetOutputPath(out var outputPath) || !File.Exists(outputPath))
        {
            return null;
        }

        try
        {
            foreach (var line in File.ReadLines(outputPath).Reverse())
            {
                using var document = System.Text.Json.JsonDocument.Parse(line);
                if (document.RootElement.TryGetProperty("mark", out var name)
                    && name.GetString() == mark
                    && document.RootElement.TryGetProperty("t_ms", out var elapsed)
                    && elapsed.TryGetInt64(out var milliseconds))
                {
                    return milliseconds;
                }
            }
        }
        catch (Exception exception) when (
            exception is IOException
            or System.Text.Json.JsonException)
        {
            return null;
        }

        return null;
    }

    private void MaybeQuitAfterBench()
    {
        if (!DesktopPerfBench.TryGetQuitAfter(out var milliseconds))
        {
            return;
        }

        var timer = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
        {
            Interval = TimeSpan.FromMilliseconds(milliseconds),
        };
        timer.Tick += (_, _) =>
        {
            timer.Stop();
            DesktopPerfBench.MarkOnce("bench_quit");
            Application.Current?.Shutdown(0);
        };
        timer.Start();
    }

    private async Task MaybeAutoLoginAsync(CoreWebView2 core)
    {
        var passwordScript = DesktopPerfBench.CreatePasswordLoginScript();
        if (passwordScript is null)
        {
            return;
        }

        try
        {
            await Task.Delay(800);
            DesktopPerfBench.MarkOnce("login_password_submit");
            _ = await core.ExecuteScriptAsync(passwordScript);
            await Task.Delay(2500);
            var totpScript = DesktopPerfBench.CreateTotpLoginScript();
            if (totpScript is not null)
            {
                DesktopPerfBench.MarkOnce("login_totp_submit");
                _ = await core.ExecuteScriptAsync(totpScript);
                await Task.Delay(4500);
            }

            var encoded = await core.ExecuteScriptAsync(DesktopPerfBench.CreateAuthStateScript());
            var state = System.Text.Json.JsonSerializer.Deserialize<string>(encoded);
            if (string.Equals(state, "app", StringComparison.Ordinal))
            {
                DesktopPerfBench.MarkOnce("authenticated_ready");
                await NavigateBenchRouteAsync(core);
            }
            else
            {
                DesktopPerfBench.MarkOnce("login_still_visible");
            }
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException
            or System.Text.Json.JsonException)
        {
            DesktopPerfBench.MarkOnce("login_inject_failed");
        }
    }

    private async Task PresentTaskbarPinSuggestionAsync()
    {
        if (_taskbarPinSuggestionChecked
            || _notificationSettings.TaskbarPinPromptHandled)
        {
            return;
        }

        _taskbarPinSuggestionChecked = true;
        var availability = await _taskbarPinning.GetAvailabilityAsync();
        switch (availability)
        {
            case DesktopTaskbarPinAvailability.AlreadyPinned:
                CompleteTaskbarPinPrompt();
                return;
            case DesktopTaskbarPinAvailability.Available:
                _taskbarPinManualOnly = false;
                TaskbarPinTitle.Text = "HUB всегда под рукой";
                TaskbarPinDetails.Text =
                    "Закрепите приложение на панели задач для быстрого запуска.";
                PinTaskbarButton.Content = "Закрепить";
                DismissTaskbarPinButton.Visibility = Visibility.Visible;
                break;
            case DesktopTaskbarPinAvailability.ManualOnly:
                _taskbarPinManualOnly = true;
                TaskbarPinTitle.Text = "Закрепите HUB на панели задач";
                TaskbarPinDetails.Text =
                    "Нажмите правой кнопкой на значок HUB в панели задач и выберите «Закрепить на панели задач».";
                PinTaskbarButton.Content = "Понятно";
                DismissTaskbarPinButton.Visibility = Visibility.Collapsed;
                break;
            default:
                return;
        }

        TaskbarPinBanner.Visibility = Visibility.Visible;
    }

    private async void PinTaskbarButton_Click(object sender, RoutedEventArgs e)
    {
        if (_taskbarPinBusy)
        {
            return;
        }

        if (_taskbarPinManualOnly)
        {
            CompleteTaskbarPinPrompt();
            return;
        }

        _taskbarPinBusy = true;
        PinTaskbarButton.IsEnabled = false;
        DismissTaskbarPinButton.IsEnabled = false;
        try
        {
            var result = await _taskbarPinning.RequestPinAsync();
            if (result is DesktopTaskbarPinResult.Pinned
                or DesktopTaskbarPinResult.NotPinned)
            {
                CompleteTaskbarPinPrompt();
                return;
            }

            _taskbarPinManualOnly = true;
            TaskbarPinTitle.Text = "Закрепите HUB на панели задач";
            TaskbarPinDetails.Text =
                "Windows не смогла закрепить приложение автоматически. Нажмите правой кнопкой на значок HUB в панели задач и выберите «Закрепить на панели задач».";
            PinTaskbarButton.Content = "Понятно";
            DismissTaskbarPinButton.Visibility = Visibility.Collapsed;
        }
        finally
        {
            _taskbarPinBusy = false;
            PinTaskbarButton.IsEnabled = true;
            DismissTaskbarPinButton.IsEnabled = true;
        }
    }

    private void DismissTaskbarPinButton_Click(object sender, RoutedEventArgs e) =>
        CompleteTaskbarPinPrompt();

    private void CompleteTaskbarPinPrompt()
    {
        TaskbarPinBanner.Visibility = Visibility.Collapsed;
        try
        {
            _notificationSettings = _settingsStore.Update(settings =>
                settings with { TaskbarPinPromptHandled = true });
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException)
        {
            DesktopLog.Error("Taskbar pinning prompt state could not be saved", exception);
        }
    }

    private async Task CreateWebViewAsync()
    {
        var failure = await TryCreateWebViewAsync();
        if (failure is not null)
        {
            await RecoverWebViewAsync(failure.Value);
        }
    }

    private async Task<WebViewFailureKind?> TryCreateWebViewAsync()
    {
        if (_initializing)
        {
            return null;
        }

        _initializing = true;
        _lastNavigationStatus = "Initializing";
        ShowLoading();

        try
        {
            DisposeDesktopBridge();
            var core = await _webViewHost.RecreateAsync(_recoveryShutdown.Token);
            _webView = _webViewHost.View;
            _webViewMemoryUsageTargetLevel = null;
            ConfigureWebView(core);

            _requiresReset = false;
            _performance.RecordWebViewInitialized(DateTimeOffset.UtcNow);
            DesktopPerfBench.MarkOnce("webview_ready");
            DesktopLog.Info($"WebView2 initialized for {_navigationPolicy.TrustedOriginForLog}");
            core.Navigate(_options.BaseUri.AbsoluteUri);
            return null;
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            _lastNavigationStatus = "RuntimeUnavailable";
            DesktopLog.Error("WebView2 Runtime is unavailable", exception);
            ShowError(
                "Не установлен WebView2 Runtime",
                "Установите Microsoft Edge WebView2 Runtime и повторите попытку.");
            return WebViewFailureKind.RuntimeUnavailable;
        }
        catch (Exception exception)
        {
            _lastNavigationStatus = "InitializationFailed";
            DesktopLog.Error("WebView2 initialization failed", exception);
            return WebViewFailureKind.Initialization;
        }
        finally
        {
            _initializing = false;
        }
    }

    private void ConfigureWebView(CoreWebView2 core)
    {
        core.Settings.IsPasswordAutosaveEnabled = true;
        core.Settings.IsGeneralAutofillEnabled = true;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsWebMessageEnabled = true;

#if DEBUG
        core.Settings.AreDevToolsEnabled = true;
        core.Settings.AreBrowserAcceleratorKeysEnabled = true;
#else
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
#endif

        core.NavigationStarting += Core_NavigationStarting;
        core.NavigationCompleted += Core_NavigationCompleted;
        core.HistoryChanged += Core_HistoryChanged;
        core.NewWindowRequested += Core_NewWindowRequested;
        core.LaunchingExternalUriScheme += Core_LaunchingExternalUriScheme;
        core.ServerCertificateErrorDetected += Core_ServerCertificateErrorDetected;
        core.ProcessFailed += Core_ProcessFailed;
        core.DownloadStarting += Core_DownloadStarting;
        _desktopBridge = new DesktopBridgeHost(
            core,
            _navigationPolicy,
            _notifications,
            Environment.UserName,
            new DesktopVncHandlerProbe());
        _desktopBridge.Ready += DesktopBridge_Ready;
        _desktopBridge.ThemeChanged += DesktopBridge_ThemeChanged;
        _desktopBridge.OpenDownloadedFileRequested += DesktopBridge_OpenDownloadedFileRequested;
        _desktopBridge.PrepareDownloadedFileRequested += DesktopBridge_PrepareDownloadedFileRequested;
        _desktopBridge.ShellStatusChanged += DesktopBridge_ShellStatusChanged;
        _desktopBridge.QuickRoutesChanged += DesktopBridge_QuickRoutesChanged;
        _desktopBridge.PrintCurrentDocumentRequested += DesktopBridge_PrintCurrentDocumentRequested;
        _desktopBridge.EquipmentQrPrintRequested += DesktopBridge_EquipmentQrPrintRequested;
        _desktopBridge.OpenDownloadsRequested += DesktopBridge_OpenDownloadsRequested;
        _desktopBridge.OpenDiagnosticsRequested += DesktopBridge_OpenDiagnosticsRequested;
        _desktopBridge.CheckForUpdatesRequested += DesktopBridge_CheckForUpdatesRequested;
        _desktopBridge.OpenCurrentInBrowserRequested += DesktopBridge_OpenCurrentInBrowserRequested;
        _desktopBridge.MailComposeWindowRequested += DesktopBridge_MailComposeWindowRequested;
        _windowManager.MailComposeSent += WindowManager_MailComposeSent;
        ApplyWebViewMemoryUsageTarget(core);
        if (DesktopPerfBench.IsEnabled)
        {
            _ = core.AddScriptToExecuteOnDocumentCreatedAsync(
                DesktopPerfBench.CreateDocumentCreatedScript());
        }
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var decision = _navigationPolicy.Evaluate(e.Uri);

        if (decision == NavigationDisposition.TrustedOrigin)
        {
            _lastNavigationStatus = "InProgress";
            _lastNavigationAtUtc = DateTimeOffset.UtcNow;
            DesktopPerfBench.MarkOnce("navigation_starting");
            _desktopBridge?.ResetDocumentReady();
            HideError();
            ShowLoading();
            StartNavigationTimeout();
            return;
        }

        e.Cancel = true;

        if (decision == NavigationDisposition.ExternalBrowser)
        {
            OpenExternalUri(e.Uri);
            return;
        }

        DesktopLog.Warning($"Blocked top-level navigation with scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
    }

    private async void Core_NavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        CancelNavigationTimeout();
        LoadingIndicator.Visibility = Visibility.Collapsed;

        if (e.IsSuccess)
        {
            _lastNavigationStatus = "Success";
            _lastNavigationAtUtc = DateTimeOffset.UtcNow;
            DesktopPerfBench.MarkOnce("navigation_completed");
            RecordBenchProcessSnapshot("navigation_completed_processes");
            HideError();
            SaveLastSafeRoute(_webView?.CoreWebView2?.Source);
            MaybeStartBenchFrontendProbe();
            return;
        }

        DesktopLog.Warning($"Navigation failed with status '{e.WebErrorStatus}'");
        var status = e.WebErrorStatus.ToString();
        _lastNavigationStatus = $"Failed:{status}";
        _lastNavigationAtUtc = DateTimeOffset.UtcNow;
        var failure = status.Contains("Certificate", StringComparison.OrdinalIgnoreCase)
            ? WebViewFailureKind.Certificate
            : status.Equals("Timeout", StringComparison.OrdinalIgnoreCase)
                ? WebViewFailureKind.NavigationTimeout
                : WebViewFailureKind.Network;
        await RecoverWebViewAsync(failure);
    }

    private void Core_HistoryChanged(object? sender, object e)
    {
        SaveLastSafeRoute((sender as CoreWebView2)?.Source);
    }

    private void Core_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        var decision = _navigationPolicy.Evaluate(e.Uri);

        if (decision == NavigationDisposition.TrustedOrigin)
        {
            _webView?.CoreWebView2.Navigate(e.Uri);
            return;
        }

        if (decision == NavigationDisposition.ExternalBrowser)
        {
            OpenExternalUri(e.Uri);
            return;
        }

        DesktopLog.Warning($"Blocked new window with scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
    }

    private void Core_LaunchingExternalUriScheme(object? sender, CoreWebView2LaunchingExternalUriSchemeEventArgs e)
    {
        e.Cancel = !_navigationPolicy.IsAllowedExternalScheme(e.Uri);

        if (e.Cancel)
        {
            DesktopLog.Warning($"Blocked external URI scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
        }
    }

    private void Core_ServerCertificateErrorDetected(object? sender, CoreWebView2ServerCertificateErrorDetectedEventArgs e)
    {
        e.Action = CoreWebView2ServerCertificateErrorAction.Cancel;
        _lastNavigationStatus = "CertificateError";
        _lastNavigationAtUtc = DateTimeOffset.UtcNow;
        CancelNavigationTimeout();
        _requiresReset = false;
        DesktopLog.Warning("TLS certificate validation failed");
        ShowError(
            "Не удалось проверить сертификат HUB",
            "Подключение остановлено. Обратитесь в IT-службу, если ошибка повторяется.");
    }

    private async void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        CancelNavigationTimeout();
        _performance.RecordWebViewProcessFailure();
        _lastNavigationStatus = $"ProcessFailed:{e.ProcessFailedKind}";
        _lastNavigationAtUtc = DateTimeOffset.UtcNow;
        DesktopLog.Warning($"WebView2 process failed: {e.ProcessFailedKind}");
        var failure = e.ProcessFailedKind switch
        {
            CoreWebView2ProcessFailedKind.RenderProcessExited
                or CoreWebView2ProcessFailedKind.RenderProcessUnresponsive =>
                WebViewFailureKind.RendererProcessExited,
            CoreWebView2ProcessFailedKind.FrameRenderProcessExited =>
                WebViewFailureKind.FrameProcessExited,
            _ => WebViewFailureKind.BrowserProcessExited,
        };
        await RecoverWebViewAsync(failure);
    }

    private void OpenExternalUri(string rawUri)
    {
        var result = _externalUriLauncher.Open(rawUri);
        if (result.Status == ExternalUriLaunchStatus.Opened)
        {
            DesktopLog.Info($"Opened external URI scheme '{result.Scheme}' in the system handler");
            return;
        }

        if (result.Status == ExternalUriLaunchStatus.Blocked)
        {
            DesktopLog.Warning($"Rejected external URI scheme '{result.Scheme}' after policy evaluation");
        }
        else
        {
            DesktopLog.Error(
                "System handler failed to open an external URI",
                result.Error ?? new InvalidOperationException("System handler rejected the URI."));
        }

        System.Windows.MessageBox.Show(
            this,
            result.Status == ExternalUriLaunchStatus.Blocked
                ? "Эта ссылка заблокирована политикой безопасности HUB Desktop."
                : "Не удалось открыть ссылку. Проверьте системный браузер или приложение для этого типа ссылок.",
            "HUB Desktop",
            MessageBoxButton.OK,
            MessageBoxImage.Warning);
    }

    private void DesktopBridge_Ready(object? sender, EventArgs e)
    {
        _lastBridgeHandshakeUtc = DateTimeOffset.UtcNow;
        _performance.RecordBridgeReady(_lastBridgeHandshakeUtc.Value);
        DesktopPerfBench.MarkOnce("bridge_ready");
        SendDesktopWindowForegroundState();
        _windowManager.NotifyBridgeReady(this);

        if (_pendingCommandPalette && _desktopBridge?.TryOpenCommandPalette() == true)
        {
            _pendingCommandPalette = false;
        }

        if (!DesktopBridgeProtocol.IsValidInternalRoute(_pendingInternalRoute)
            || _desktopBridge?.TryOpenInternalRoute(_pendingInternalRoute) != true)
        {
            return;
        }

        _pendingInternalRoute = null;
    }

    private void DesktopBridge_ThemeChanged(object? sender, DesktopThemeChangedEventArgs e)
    {
        ApplyChromeTheme(e.Mode);
        _desktopNotificationWindow.ApplyTheme(e.Mode);
    }

    private void DesktopBridge_OpenDownloadedFileRequested(
        object? sender,
        DesktopOpenDownloadedFileRequestedEventArgs e)
    {
        e.Accepted = _downloads.RequestOpenNextDownload() == DesktopOpenIntentRequestResult.Accepted;
    }

    private void DesktopBridge_PrepareDownloadedFileRequested(
        object? sender,
        DesktopPrepareDownloadedFileRequestedEventArgs e)
    {
        e.Accepted = _downloads.RequestNextDownloadAction(e.Action)
            == DesktopOpenIntentRequestResult.Accepted;
    }

    private void DesktopBridge_ShellStatusChanged(
        object? sender,
        DesktopShellStatusChangedEventArgs e)
    {
        _windowManager.UpdateShellStatus(this, e.Status);
    }

    private void DesktopBridge_QuickRoutesChanged(
        object? sender,
        DesktopQuickRoutesChangedEventArgs e)
    {
        _windowManager.UpdateQuickRoutes(this, e.Routes);
    }

    private void DesktopBridge_PrintCurrentDocumentRequested(object? sender, EventArgs e) =>
        PrintCurrentPage();

    private void DesktopBridge_EquipmentQrPrintRequested(
        object? sender,
        DesktopEquipmentQrPrintRequestedEventArgs e) =>
        e.Completion = _printing.PrintEquipmentQrBatchAsync(
            _webView?.CoreWebView2,
            _options.BaseUri,
            e.Mode);

    private void DesktopBridge_OpenDownloadsRequested(object? sender, EventArgs e) =>
        ShowDownloadsWindow();

    private async void DesktopBridge_OpenDiagnosticsRequested(object? sender, EventArgs e) =>
        await ShowDiagnosticsWindowAsync();

    private async void DesktopBridge_CheckForUpdatesRequested(object? sender, EventArgs e) =>
        await CheckForUpdatesFromTrayAsync();

    private void DesktopBridge_OpenCurrentInBrowserRequested(object? sender, EventArgs e) =>
        OpenCurrentPageInBrowser();

    private void DesktopBridge_MailComposeWindowRequested(
        object? sender,
        DesktopMailComposeWindowRequestedEventArgs e)
    {
        e.Status = _windowManager.OpenMailComposeWindow(e.Route) switch
        {
            DesktopMailComposeWindowOpenResult.Opened => "opened",
            DesktopMailComposeWindowOpenResult.ActivatedExisting => "activated",
            DesktopMailComposeWindowOpenResult.Busy => "busy",
            _ => "failed",
        };
    }

    private void WindowManager_MailComposeSent(object? sender, EventArgs e)
    {
        _desktopBridge?.TryPostMailComposeWindowCompleted();
    }

    private void Core_DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var operation = e.DownloadOperation;
        var item = _downloads.BeginDownload(
            operation.ResultFilePath,
            operation.Cancel,
            sourceWindowLabel: "Основное окно");
        if (item.CompletionAction == DesktopDownloadedFileAction.SaveAs)
        {
            var dialog = new Microsoft.Win32.SaveFileDialog
            {
                FileName = item.FileName,
                AddExtension = true,
                OverwritePrompt = true,
                Title = "Сохранить файл из HUB",
            };
            if (dialog.ShowDialog(this) != true)
            {
                operation.Cancel();
                _downloads.CancelDownload(item.Id);
                return;
            }

            e.ResultFilePath = dialog.FileName;
        }

        if (item.CompletionAction != DesktopDownloadedFileAction.None)
        {
            e.Handled = true;
        }

        EventHandler<object>? stateChanged = null;
        EventHandler<object>? bytesReceivedChanged = null;
        bytesReceivedChanged = (_, _) =>
        {
            Dispatcher.BeginInvoke(() =>
                _downloads.ReportProgress(
                    item.Id,
                    operation.BytesReceived,
                    operation.TotalBytesToReceive is ulong totalBytes
                        ? (long)Math.Min(totalBytes, (ulong)long.MaxValue)
                        : 0));
        };
        stateChanged = (_, _) =>
        {
            if (operation.State == CoreWebView2DownloadState.InProgress)
            {
                Dispatcher.BeginInvoke(() => _downloads.ResumeDownload(item.Id));
                return;
            }

            if (operation.State == CoreWebView2DownloadState.Interrupted
                && DesktopDownloadInterruption.ShouldWaitForResume(operation.InterruptReason))
            {
                Dispatcher.BeginInvoke(() => _downloads.PauseDownload(item.Id));
                return;
            }

            operation.StateChanged -= stateChanged;
            operation.BytesReceivedChanged -= bytesReceivedChanged;
            if (operation.State == CoreWebView2DownloadState.Completed)
            {
                Dispatcher.BeginInvoke(() =>
                    _downloads.CompleteDownload(item.Id, operation.ResultFilePath));
                return;
            }

            if (operation.State == CoreWebView2DownloadState.Interrupted
                && DesktopDownloadInterruption.IsCanceled(operation.InterruptReason))
            {
                Dispatcher.BeginInvoke(() => _downloads.CancelDownload(item.Id));
            }
            else
            {
                Dispatcher.BeginInvoke(() =>
                {
                    _downloads.FailDownload(item.Id);
                    ShowDownloadFailureTaskbarState();
                });
            }
            DesktopLog.Warning($"Desktop document download did not complete: {operation.State}");
        };
        operation.BytesReceivedChanged += bytesReceivedChanged;
        operation.StateChanged += stateChanged;
    }

    private void ApplyChromeTheme(DesktopThemeMode mode)
    {
        _currentThemeMode = mode;
        _trayMenu.ApplyTheme(mode);
        _downloadsWindow?.ApplyTheme(mode);
        var isDark = mode == DesktopThemeMode.Dark;
        SetColorResource("AppBackgroundBrush", isDark ? "#0F1115" : "#F3F2F1");
        SetColorResource("TitleBarBackgroundBrush", isDark ? "#11151B" : "#FAF9F8");
        SetColorResource("TitleBarForegroundBrush", isDark ? "#F3F2F1" : "#201F1E");
        SetColorResource("TitleBarBorderBrush", isDark ? "#292D34" : "#E1DFDD");
        SetColorResource("SecondaryTextBrush", isDark ? "#A19F9D" : "#605E5C");
        SetColorResource("TitleButtonHoverBrush", isDark ? "#252A31" : "#EDEBE9");
        SetColorResource("TitleButtonPressedBrush", isDark ? "#303640" : "#E1DFDD");
        SetColorResource("UpdateBannerBackgroundBrush", isDark ? "#18212C" : "#EFF8FF");
        SetColorResource("UpdateBannerBorderBrush", isDark ? "#334155" : "#BAE6FD");
        SetColorResource("UpdateBannerAccentBrush", isDark ? "#38BDF8" : "#0369A1");
        SetColorResource("UpdateButtonBackgroundBrush", isDark ? "#0EA5E9" : "#0284C7");
        SetColorResource("UpdateButtonHoverBrush", isDark ? "#0284C7" : "#0369A1");
        SetColorResource("UpdateButtonPressedBrush", isDark ? "#0369A1" : "#075985");
    }

    private void SetColorResource(string key, string color)
    {
        Resources[key] = new SolidColorBrush(
            (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(color));
    }

    private void MinimizeButton_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }

    private void NewWindowButton_Click(object sender, RoutedEventArgs e) =>
        OpenSecondaryWindow();

    private void MaximizeRestoreButton_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e)
    {
        Close();
    }

    private void Window_StateChanged(object? sender, EventArgs e)
    {
        UpdateMaximizeRestoreButton();
        SendDesktopWindowForegroundState();
    }

    private void Window_Activated(object? sender, EventArgs e)
    {
        SendDesktopWindowForegroundState();
    }

    private void Window_Deactivated(object? sender, EventArgs e)
    {
        SendDesktopWindowForegroundState();
    }

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.N
            && Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        {
            e.Handled = OpenSecondaryWindow();
            return;
        }

        if (e.Key == Key.F5 && Keyboard.Modifiers == ModifierKeys.Control)
        {
            e.Handled = true;
            ReloadWithoutCache();
            return;
        }

        if (e.Key == Key.P && Keyboard.Modifiers == ModifierKeys.Control)
        {
            e.Handled = PrintCurrentPage();
        }
    }

    private bool OpenSecondaryWindow()
    {
        var result = _windowManager.OpenSecondaryFrom(this);
        return result is not DesktopSecondaryWindowOpenResult.Unavailable;
    }

    private void WindowManager_WindowAvailabilityChanged(object? sender, EventArgs e)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(UpdateNewWindowButtonState);
            return;
        }

        UpdateNewWindowButtonState();
    }

    private void UpdateNewWindowButtonState()
    {
        NewWindowButton.IsEnabled = true;
        NewWindowButton.ToolTip = _windowManager.CanOpenSecondary
            ? "Открыть второе окно (Ctrl+Shift+N)"
            : "Перейти во второе окно (Ctrl+Shift+N)";
    }

    private void WindowManager_ShellStatusChanged(
        object? sender,
        DesktopShellStatusChangedEventArgs e)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => WindowManager_ShellStatusChanged(sender, e));
            return;
        }

        var wasAuthenticated = _shellStatus.Authenticated;
        _shellStatus = e.Status.Authenticated
            ? e.Status
            : DesktopShellStatus.Empty;
        if (wasAuthenticated && !_shellStatus.Authenticated)
        {
            ClearLastSafeRoute();
        }

        PresentShellStatus();
    }

    private void WindowManager_QuickRoutesChanged(
        object? sender,
        DesktopQuickRoutesChangedEventArgs e)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => WindowManager_QuickRoutesChanged(sender, e));
            return;
        }

        PresentQuickRoutes(e.Routes);
    }

    private void SendDesktopWindowForegroundState()
    {
        var foreground = IsVisible && WindowState != WindowState.Minimized && IsActive;
        ApplyWebViewMemoryUsageTarget();
        _desktopBridge?.TrySetWindowForeground(foreground);
        PresentShellStatus(foreground);
    }

    private void ApplyWebViewMemoryUsageTarget(CoreWebView2? core = null)
    {
        core ??= _webView?.CoreWebView2;
        if (core is null)
        {
            return;
        }

        var targetLevel = DesktopWebViewMemoryPolicy.ResolveTargetLevel(
            IsVisible,
            WindowState == WindowState.Minimized,
            IsActive);
        if (_webViewMemoryUsageTargetLevel == targetLevel)
        {
            return;
        }

        try
        {
            core.MemoryUsageTargetLevel = targetLevel;
            _webViewMemoryUsageTargetLevel = targetLevel;
            DesktopLog.Info($"WebView2 memory usage target changed to {targetLevel}");
        }
        catch (Exception exception) when (
            exception is NotImplementedException
            or System.Runtime.InteropServices.COMException)
        {
            DesktopLog.Warning(
                $"WebView2 memory usage target is unavailable; " +
                $"exception={exception.GetType().Name}");
        }
    }

    private void PresentShellStatus(bool? windowForeground = null)
    {
        var foreground = windowForeground
            ?? (IsVisible && WindowState != WindowState.Minimized && IsActive);
        var presentedStatus = _sessionLocked ? DesktopShellStatus.Empty : _shellStatus;
        if (!string.Equals(_trayIcon.Text, presentedStatus.TrayToolTip, StringComparison.Ordinal))
        {
            _trayIcon.Text = presentedStatus.TrayToolTip;
        }

        var badgeText = presentedStatus.ShouldShowTaskbarBadge(foreground)
            ? presentedStatus.TaskbarBadgeText
            : string.Empty;
        if (string.Equals(_presentedTaskbarBadgeText, badgeText, StringComparison.Ordinal))
        {
            return;
        }

        _presentedTaskbarBadgeText = badgeText;
        TaskbarItemInfo.Overlay = string.IsNullOrEmpty(badgeText)
            ? null
            : DesktopTaskbarBadgeRenderer.Create(badgeText);
    }

    private void Downloads_Changed(object? sender, EventArgs e)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => Downloads_Changed(sender, e));
            return;
        }

        PresentDownloadTaskbarProgress();
    }

    private void PresentDownloadTaskbarProgress()
    {
        if (_downloadFailureTimer.IsEnabled)
        {
            return;
        }

        var state = _downloadTaskbarProgress.Calculate(_downloads.Items);
        TaskbarItemInfo.ProgressValue = state.Value;
        TaskbarItemInfo.ProgressState = state.Mode switch
        {
            DesktopTaskbarProgressMode.Normal => TaskbarItemProgressState.Normal,
            DesktopTaskbarProgressMode.Paused => TaskbarItemProgressState.Paused,
            DesktopTaskbarProgressMode.Indeterminate => TaskbarItemProgressState.Indeterminate,
            _ => TaskbarItemProgressState.None,
        };
    }

    private void ShowDownloadFailureTaskbarState()
    {
        _downloadFailureTimer.Stop();
        TaskbarItemInfo.ProgressValue = 1;
        TaskbarItemInfo.ProgressState = TaskbarItemProgressState.Error;
        _downloadFailureTimer.Start();
    }

    private void DownloadFailureTimer_Tick(object? sender, EventArgs e)
    {
        _downloadFailureTimer.Stop();
        PresentDownloadTaskbarProgress();
    }

    private void UpdateMaximizeRestoreButton()
    {
        if (MaximizeRestoreButton is null)
        {
            return;
        }

        var isMaximized = WindowState == WindowState.Maximized;
        MaximizeGlyph.Visibility = isMaximized ? Visibility.Collapsed : Visibility.Visible;
        RestoreGlyph.Visibility = isMaximized ? Visibility.Visible : Visibility.Collapsed;
        var label = isMaximized ? "Восстановить окно" : "Развернуть окно";
        MaximizeRestoreButton.ToolTip = isMaximized ? "Восстановить" : "Развернуть";
        AutomationProperties.SetName(MaximizeRestoreButton, label);
    }

    private void DisposeDesktopBridge()
    {
        if (_desktopBridge is null)
        {
            return;
        }

        _desktopBridge.Ready -= DesktopBridge_Ready;
        _desktopBridge.ThemeChanged -= DesktopBridge_ThemeChanged;
        _desktopBridge.OpenDownloadedFileRequested -= DesktopBridge_OpenDownloadedFileRequested;
        _desktopBridge.PrepareDownloadedFileRequested -= DesktopBridge_PrepareDownloadedFileRequested;
        _desktopBridge.ShellStatusChanged -= DesktopBridge_ShellStatusChanged;
        _desktopBridge.QuickRoutesChanged -= DesktopBridge_QuickRoutesChanged;
        _desktopBridge.PrintCurrentDocumentRequested -= DesktopBridge_PrintCurrentDocumentRequested;
        _desktopBridge.EquipmentQrPrintRequested -= DesktopBridge_EquipmentQrPrintRequested;
        _desktopBridge.OpenDownloadsRequested -= DesktopBridge_OpenDownloadsRequested;
        _desktopBridge.OpenDiagnosticsRequested -= DesktopBridge_OpenDiagnosticsRequested;
        _desktopBridge.CheckForUpdatesRequested -= DesktopBridge_CheckForUpdatesRequested;
        _desktopBridge.OpenCurrentInBrowserRequested -= DesktopBridge_OpenCurrentInBrowserRequested;
        _desktopBridge.MailComposeWindowRequested -= DesktopBridge_MailComposeWindowRequested;
        _windowManager.MailComposeSent -= WindowManager_MailComposeSent;
        _desktopBridge.Dispose();
        _desktopBridge = null;
    }

    private void SaveLastSafeRoute(string? candidateUrl)
    {
        if (!DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                _options.BaseUri,
                candidateUrl,
                out var route)
            || string.Equals(_lastPersistedSafeRoute, route, StringComparison.Ordinal))
        {
            return;
        }

        try
        {
            _settingsStore.Update(settings => settings with { LastSafeRoute = route });
            _lastPersistedSafeRoute = route;
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException)
        {
            DesktopLog.Error("Desktop workspace route could not be saved", exception);
        }
    }

    private void ClearLastSafeRoute()
    {
        if (_lastPersistedSafeRoute is null)
        {
            return;
        }

        try
        {
            _settingsStore.Update(settings => settings with { LastSafeRoute = null });
            _lastPersistedSafeRoute = null;
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException)
        {
            DesktopLog.Error("Desktop workspace route could not be cleared", exception);
        }
    }

    private void SaveWindowPlacement()
    {
        try
        {
            var placement = _windowPlacement.TryCapture(
                new WindowInteropHelper(this).Handle,
                WindowState == WindowState.Maximized || _restoreMaximizedWhenShown);
            if (placement is null)
            {
                return;
            }

            _settingsStore.Update(settings => settings with { WindowPlacement = placement });
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException
            or InvalidOperationException)
        {
            DesktopLog.Error("Desktop window placement could not be saved", exception);
        }
    }

    private async Task RecoverWebViewAsync(WebViewFailureKind failure)
    {
        if (_recoveryInProgress
            || _applicationController.ExitRequested
            || _recoveryShutdown.IsCancellationRequested)
        {
            return;
        }

        _recoveryInProgress = true;
        try
        {
            var currentFailure = failure;
            while (!_recoveryShutdown.IsCancellationRequested)
            {
                var decision = _webViewRecovery.Next(currentFailure);
                _requiresReset = currentFailure is not
                    WebViewFailureKind.Network
                    and not WebViewFailureKind.NavigationTimeout
                    and not WebViewFailureKind.Certificate;
                DesktopLog.Warning(
                    $"WebView2 recovery decision; failure={currentFailure}; " +
                    $"action={decision.Action}; attempt={decision.Attempt}; " +
                    $"delay_ms={(long)decision.Delay.TotalMilliseconds}");
                if (decision.Action == WebViewRecoveryAction.ShowManualRetry)
                {
                    RetryButton.IsEnabled = true;
                    ShowRecoveryError(currentFailure);
                    return;
                }

                RetryButton.IsEnabled = false;
                ShowError(
                    "Восстанавливаем HUB",
                    decision.Delay > TimeSpan.Zero
                        ? "Повторная попытка будет выполнена через несколько секунд."
                        : "Выполняется автоматическая попытка восстановления.");
                if (decision.Delay > TimeSpan.Zero)
                {
                    await Task.Delay(decision.Delay, _recoveryShutdown.Token);
                }

                if (decision.Action == WebViewRecoveryAction.Reload)
                {
                    RetryCurrentNavigation();
                    return;
                }

                var nextFailure = await TryCreateWebViewAsync();
                if (nextFailure is null)
                {
                    return;
                }

                currentFailure = nextFailure.Value;
            }
        }
        catch (OperationCanceledException) when (_recoveryShutdown.IsCancellationRequested)
        {
            // Normal shutdown.
        }
        finally
        {
            _recoveryInProgress = false;
            RetryButton.IsEnabled = true;
        }
    }

    private void ShowRecoveryError(WebViewFailureKind failure)
    {
        if (failure == WebViewFailureKind.RuntimeUnavailable)
        {
            ShowError(
                "Не установлен WebView2 Runtime",
                "Установите Microsoft Edge WebView2 Runtime и повторите попытку.");
            return;
        }

        if (failure == WebViewFailureKind.Certificate)
        {
            ShowError(
                "Не удалось проверить сертификат HUB",
                "Подключение остановлено. Обратитесь в IT-службу, если ошибка повторяется.");
            return;
        }

        ShowError(
            failure is WebViewFailureKind.Network or WebViewFailureKind.NavigationTimeout
                ? "HUB временно недоступен"
                : "Веб-компонент HUB остановлен",
            failure is WebViewFailureKind.Network or WebViewFailureKind.NavigationTimeout
                ? "Проверьте подключение к корпоративной сети и повторите попытку."
                : "Автоматическое восстановление остановлено. Нажмите «Повторить».");
    }

    private void RetryCurrentNavigation()
    {
        if (_webView?.CoreWebView2 is null)
        {
            _requiresReset = true;
            ShowRecoveryError(WebViewFailureKind.Initialization);
            return;
        }

        HideError();
        ShowLoading();
        var currentUri = _webView.Source;
        var target = currentUri is not null && _navigationPolicy.IsTrustedOrigin(currentUri)
            ? currentUri
            : _options.BaseUri;
        _webView.CoreWebView2.Navigate(target.AbsoluteUri);
    }

    private void StartNavigationTimeout()
    {
        CancelNavigationTimeout();
        var timeout = CancellationTokenSource.CreateLinkedTokenSource(
            _recoveryShutdown.Token);
        _navigationTimeout = timeout;
        _ = MonitorNavigationTimeoutAsync(timeout);
    }

    private async Task MonitorNavigationTimeoutAsync(CancellationTokenSource timeout)
    {
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(45), timeout.Token);
            if (!ReferenceEquals(_navigationTimeout, timeout))
            {
                return;
            }

            _webView?.CoreWebView2?.Stop();
            DesktopLog.Warning("WebView2 navigation timed out");
            await RecoverWebViewAsync(WebViewFailureKind.NavigationTimeout);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            // Navigation completed or application is shutting down.
        }
    }

    private void CancelNavigationTimeout()
    {
        var timeout = _navigationTimeout;
        _navigationTimeout = null;
        if (timeout is null)
        {
            return;
        }

        timeout.Cancel();
        timeout.Dispose();
    }

    private async Task ReloadWithoutCacheAsync()
    {
        if (_hardReloadInProgress || _recoveryInProgress || _initializing)
        {
            return;
        }

        _hardReloadInProgress = true;
        ReloadButton.IsEnabled = false;
        try
        {
            if (_requiresReset || _webView?.CoreWebView2 is null)
            {
                await CreateWebViewAsync();
                return;
            }

            HideError();
            ShowLoading();
            var reloaded = await DesktopWebViewHardReload.TryReloadIgnoringCacheAsync(
                _webView.CoreWebView2,
                _recoveryShutdown.Token);
            if (!reloaded)
            {
                LoadingIndicator.Visibility = Visibility.Collapsed;
            }
        }
        catch (OperationCanceledException)
        {
            // Window is shutting down.
        }
        finally
        {
            _hardReloadInProgress = false;
            ReloadButton.IsEnabled = true;
        }
    }

    private void ReloadButton_Click(object sender, RoutedEventArgs e) => ReloadWithoutCache();

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        if (_recoveryInProgress)
        {
            return;
        }

        if (_requiresReset || _webView?.CoreWebView2 is null)
        {
            await CreateWebViewAsync();
            return;
        }

        RetryCurrentNavigation();
    }

    private async void ErrorDiagnosticsButton_Click(object sender, RoutedEventArgs e) =>
        await ShowDiagnosticsWindowAsync();

    private void ErrorBrowserButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo(_options.BaseUri.AbsoluteUri)
            {
                UseShellExecute = true,
            });
            DesktopLog.Info("Opened trusted HUB origin in the system browser from error recovery");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("System browser failed to open HUB during error recovery", exception);
            System.Windows.MessageBox.Show(
                "Не удалось открыть HUB в системном браузере.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private void ShowLoading()
    {
        LoadingIndicator.Visibility = Visibility.Visible;
    }

    private void ShowError(string title, string details)
    {
        LoadingIndicator.Visibility = Visibility.Collapsed;
        ErrorTitle.Text = title;
        ErrorDetails.Text = details;
        ErrorOverlay.Visibility = Visibility.Visible;
    }

    private void HideError()
    {
        ErrorOverlay.Visibility = Visibility.Collapsed;
    }

    private HubTrayContextMenu CreateTrayMenu()
    {
        var menu = new HubTrayContextMenu();
        var showItem = new Forms.ToolStripMenuItem("Открыть HUB")
        {
            AccessibleName = "Открыть HUB",
            Font = HubTrayContextMenu.CreateEmphasizedFont(),
            Image = _applicationIcon.ToBitmap(),
            Padding = new Forms.Padding(2, 4, 8, 4),
        };
        var exitItem = new Forms.ToolStripMenuItem("Выйти")
        {
            AccessibleName = "Выйти из HUB Desktop",
            Image = HubTrayContextMenu.CreateExitIcon(menu.Palette.Destructive),
            Padding = new Forms.Padding(2, 4, 8, 4),
        };

        showItem.Click += (_, _) => _windowManager.ActivateLastOrPrimary();
        exitItem.Click += (_, _) => RequestExit();

        _sectionsItem.DropDownItems.Add(_notificationsQuickRouteItem);
        _sectionsItem.DropDownItems.Add(_tasksQuickRouteItem);
        _sectionsItem.DropDownItems.Add(_chatQuickRouteItem);
        _sectionsItem.DropDownItems.Add(_mailQuickRouteItem);
        _sectionsItem.DropDownItems.Add(_moreQuickRoutesItem);

        _desktopToolsItem.DropDownItems.Add(_settingsItem);
        _desktopToolsItem.DropDownItems.Add(_checkUpdatesItem);
        _desktopToolsItem.DropDownItems.Add(_aboutItem);
        _desktopToolsItem.DropDownItems.Add(_downloadsItem);
        _desktopToolsItem.DropDownItems.Add(_diagnosticsItem);
        _desktopToolsItem.DropDownItems.Add(HubTrayContextMenu.CreateSeparator());
        _desktopToolsItem.DropDownItems.Add(_openInBrowserItem);
        _desktopToolsItem.DropDownItems.Add(_printItem);
        _desktopToolsItem.DropDownItems.Add(_hardReloadItem);
        _desktopToolsItem.DropDownItems.Add(HubTrayContextMenu.CreateSeparator());
        _desktopToolsItem.DropDownItems.Add(_privacyNotificationItem);
        _desktopToolsItem.DropDownItems.Add(_autostartItem);

        menu.Items.Add(showItem);
        menu.Items.Add(_commandPaletteItem);
        menu.Items.Add(_sectionsItem);
        menu.Items.Add(HubTrayContextMenu.CreateSeparator());
        menu.Items.Add(_updateItem);
        menu.Items.Add(_quietModeItem);
        menu.Items.Add(_desktopToolsItem);
        menu.Items.Add(HubTrayContextMenu.CreateSeparator());
        menu.Items.Add(exitItem);
        menu.RegisterDestructiveItem(exitItem);
        return menu;
    }

    private Forms.ToolStripMenuItem CreateQuickRouteMenuItem()
    {
        var item = new Forms.ToolStripMenuItem
        {
            Padding = new Forms.Padding(2, 4, 8, 4),
            Visible = false,
        };
        item.Click += (_, _) =>
        {
            if (item.Tag is DesktopQuickRoute route)
            {
                _windowManager.ActivateLastOrPrimary(route.Route);
            }
        };
        return item;
    }

    private void PresentQuickRoutes(IReadOnlyList<DesktopQuickRoute> routes)
    {
        var routesById = routes.ToDictionary(route => route.Id, StringComparer.Ordinal);
        PresentQuickRoute(_notificationsQuickRouteItem, routesById.GetValueOrDefault("notifications"));
        PresentQuickRoute(_tasksQuickRouteItem, routesById.GetValueOrDefault("tasks"));
        PresentQuickRoute(_chatQuickRouteItem, routesById.GetValueOrDefault("chat"));
        PresentQuickRoute(_mailQuickRouteItem, routesById.GetValueOrDefault("mail"));

        while (_moreQuickRoutesItem.DropDownItems.Count > 0)
        {
            var existingItem = _moreQuickRoutesItem.DropDownItems[0];
            _moreQuickRoutesItem.DropDownItems.RemoveAt(0);
            existingItem.Dispose();
        }

        foreach (var route in routes.Where(route =>
                     route.Id is not ("notifications" or "tasks" or "chat" or "mail")))
        {
            var item = CreateQuickRouteMenuItem();
            PresentQuickRoute(item, route);
            _moreQuickRoutesItem.DropDownItems.Add(item);
        }

        _moreQuickRoutesItem.Visible = _moreQuickRoutesItem.DropDownItems.Count > 0;
        _sectionsItem.Visible =
            _notificationsQuickRouteItem.Visible
            || _tasksQuickRouteItem.Visible
            || _chatQuickRouteItem.Visible
            || _mailQuickRouteItem.Visible
            || _moreQuickRoutesItem.Visible;
    }

    private static void PresentQuickRoute(
        Forms.ToolStripMenuItem item,
        DesktopQuickRoute? route)
    {
        item.Tag = route;
        item.Visible = route is not null;
        if (route is null)
        {
            return;
        }

        item.Text = route.MenuText;
        item.AccessibleName = route.AccessibleName;
    }

    private static Drawing.Icon LoadApplicationIcon()
    {
        var executablePath = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(executablePath))
        {
            var extractedIcon = Drawing.Icon.ExtractAssociatedIcon(executablePath);
            if (extractedIcon is not null)
            {
                return extractedIcon;
            }
        }

        return (Drawing.Icon)Drawing.SystemIcons.Application.Clone();
    }

    private bool TryGetCurrentBrowserUri(out Uri uri)
    {
        uri = default!;
        if (!DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                _options.BaseUri,
                _webView?.CoreWebView2?.Source,
                out var route))
        {
            return false;
        }

        uri = new Uri(_options.BaseUri, route);
        return true;
    }

    private void OpenCurrentPageInBrowser()
    {
        if (!TryGetCurrentBrowserUri(out var uri))
        {
            DesktopLog.Warning("Current page is not eligible for browser handoff");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            DesktopLog.Info("Opened current trusted HUB page in the system browser");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("System browser failed to open the current HUB page", exception);
            System.Windows.MessageBox.Show(
                "Не удалось открыть текущую страницу в браузере.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private bool PrintCurrentPage()
    {
        if (_printing.TryPrintCurrent(_webView?.CoreWebView2, _options.BaseUri))
        {
            return true;
        }

        System.Windows.MessageBox.Show(
            "Эту страницу сейчас нельзя безопасно передать в печать.",
            "HUB Desktop",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
        return false;
    }

    private void ShowCommandPalette()
    {
        ShowAndActivate();
        if (_desktopBridge?.TryOpenCommandPalette() == true)
        {
            _pendingCommandPalette = false;
            return;
        }

        _pendingCommandPalette = true;
    }

    private void ToggleAutostart()
    {
        if (!_autostart.CanUserChange)
        {
            return;
        }

        try
        {
            var enable = !_autostart.IsEnabled;
            _autostart.SetEnabled(enable);
            RefreshAutostartMenuItem();
            _aboutWindow?.RefreshState();
            DesktopLog.Info(enable ? "Autostart enabled" : "Autostart disabled");
        }
        catch (Exception exception)
        {
            _autostartItem.Checked = false;
            DesktopLog.Error("Autostart setting failed", exception);
            System.Windows.MessageBox.Show(
                "Не удалось изменить автозапуск HUB для текущего пользователя.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private DesktopNotificationRequest? ApplyNotificationPolicy(
        DesktopNotificationRequest request)
    {
        var settings = _notificationSettings;
        if (DesktopQuietMode.IsMuted(settings, DateTimeOffset.UtcNow))
        {
            return null;
        }

        if (_sessionLocked && settings.HideNotificationContentWhenLocked)
        {
            return request with
            {
                Title = "Новое уведомление HUB",
                Body = "Откройте HUB после разблокировки Windows.",
            };
        }

        return request;
    }

    private void UpdateNotificationSettings(
        Func<DesktopSettings, DesktopSettings> update)
    {
        try
        {
            _notificationSettings = _settingsStore.Update(update);
            RefreshNotificationPolicyMenu();
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException)
        {
            DesktopLog.Error("Desktop notification preference could not be saved", exception);
        }
    }

    private void RefreshNotificationPolicyMenu()
    {
        var settings = _notificationSettings;
        if (!settings.QuietIndefinitely
            && settings.QuietUntilUtc is { } quietUntil
            && quietUntil <= DateTimeOffset.UtcNow)
        {
            try
            {
                settings = _settingsStore.Update(DesktopQuietMode.Unmute);
                _notificationSettings = settings;
            }
            catch (Exception exception) when (
                exception is IOException
                or UnauthorizedAccessException
                or ArgumentException)
            {
                DesktopLog.Error("Expired desktop quiet mode could not be cleared", exception);
            }
        }

        _quietModeItem.Text = DesktopQuietMode.GetTrayLabel(settings, DateTimeOffset.Now);
        _quietModeItem.AccessibleName = DesktopQuietMode.IsMuted(settings, DateTimeOffset.UtcNow)
            ? $"{_quietModeItem.Text}. Изменить режим Не беспокоить"
            : "Настроить режим Не беспокоить HUB Desktop";
        _privacyNotificationItem.Checked = settings.HideNotificationContentWhenLocked;
    }

    private void RefreshAutostartMenuItem()
    {
        try
        {
            _autostartItem.Checked = _autostart.IsEnabled;
            _autostartItem.Enabled = _autostart.CanUserChange;
            _autostartItem.Text = _autostart.CanUserChange
                ? "Запускать вместе с Windows"
                : "Запуск вместе с Windows (управляется администратором)";
        }
        catch (Exception exception)
        {
            _autostartItem.Checked = false;
            DesktopLog.Error("Autostart state read failed", exception);
        }
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        SaveWindowPlacement();
        var closeAction = DesktopClosePolicy.Resolve(
            _applicationController.ExitRequested,
            DesktopPerfBench.IsEnabled);
        if (closeAction == DesktopCloseAction.Exit)
        {
            if (DesktopPerfBench.IsEnabled)
            {
                DesktopPerfBench.MarkOnce("window_closing_shutdown");
                Application.Current?.Shutdown(0);
            }

            return;
        }

        e.Cancel = true;
        if (_notificationSettings.CloseBehavior == DesktopCloseBehavior.AskOnce)
        {
            var confirmation = System.Windows.MessageBox.Show(
                "Свернуть HUB в панель задач? Приложение продолжит получать сообщения.",
                "HUB Desktop",
                MessageBoxButton.YesNo,
                MessageBoxImage.Information,
                MessageBoxResult.Yes);
            if (confirmation != MessageBoxResult.Yes)
            {
                return;
            }

            try
            {
                _notificationSettings = _settingsStore.Update(settings =>
                    settings with { CloseBehavior = DesktopCloseBehavior.AlwaysHide });
            }
            catch (Exception exception) when (
                exception is IOException
                or UnauthorizedAccessException
                or ArgumentException)
            {
                DesktopLog.Error("Close-to-tray confirmation state could not be saved", exception);
            }

            _trayHintShown = true;
        }

        WindowState = WindowState.Minimized;
        SendDesktopWindowForegroundState();
        DesktopLog.Info("Main window minimized to taskbar");

        if (_trayHintShown)
        {
            return;
        }

        _trayHintShown = true;
        _trayIcon.ShowBalloonTip(
            3000,
            "HUB Desktop",
            "HUB продолжает работать и остаётся на панели задач.",
            Forms.ToolTipIcon.Info);
    }

    private bool ShowPersistentNotification(DesktopNotificationRequest request)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => ShowPersistentNotification(request));
            return true;
        }

        try
        {
            _desktopNotificationWindow.ShowNotification(request);
            DesktopLog.Info("Persistent desktop notification shown");
            return true;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Persistent desktop notification display failed", exception);
            return false;
        }
    }

    private void DesktopNotificationWindow_OpenRequested(object? sender, string route)
    {
        _windowManager.ActivateLastOrPrimary(route);
    }

    private void RequestExit()
    {
        PrepareForShutdown();
        Close();
        Application.Current.Shutdown();
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        _performanceTimer.Stop();
        _performanceTimer.Tick -= PerformanceTimer_Tick;
        _downloadFailureTimer.Stop();
        _downloadFailureTimer.Tick -= DownloadFailureTimer_Tick;
        _downloads.Changed -= Downloads_Changed;
        CancelNavigationTimeout();
        _recoveryShutdown.Cancel();
        _windowSource?.RemoveHook(WindowMessageHook);
        _globalHotkey.Dispose();
        if (_sessionNotificationsRegistered)
        {
            WindowsSessionStateMonitor.Unregister(new WindowInteropHelper(this).Handle);
            _sessionNotificationsRegistered = false;
        }
        _windowSource = null;

        if (_notifications is FallbackDesktopNotificationService fallbackNotifications)
        {
            fallbackNotifications.ClearRequestPolicy();
            fallbackNotifications.ClearFallback();
        }

        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _trayMenu.Dispose();
        _applicationIcon.Dispose();
        _desktopNotificationWindow.OpenRequested -= DesktopNotificationWindow_OpenRequested;
        _updates.StateChanged -= Updates_StateChanged;
        _windowManager.WindowAvailabilityChanged -= WindowManager_WindowAvailabilityChanged;
        _windowManager.ShellStatusChanged -= WindowManager_ShellStatusChanged;
        _windowManager.QuickRoutesChanged -= WindowManager_QuickRoutesChanged;
        _aboutWindow?.Close();
        _aboutWindow = null;
        _diagnosticsWindow?.Close();
        _diagnosticsWindow = null;
        _downloadsWindow?.Close();
        _downloadsWindow = null;
        _desktopNotificationWindow.Close();
        DisposeDesktopBridge();
        _webViewHost.Dispose();
        _webView = null;
        _recoveryShutdown.Dispose();
    }

    private void Updates_StateChanged(object? sender, DesktopUpdateState state)
    {
        Dispatcher.BeginInvoke(() => PresentUpdateState(state));
    }

    private void PresentUpdateState(DesktopUpdateState state)
    {
        _checkUpdatesItem.Enabled = _updates.ReadyPackage is null
            && state.Status is DesktopUpdateStatus.Idle or DesktopUpdateStatus.Error;
        _checkUpdatesItem.Text = state.Status switch
        {
            DesktopUpdateStatus.Checking => "Проверяем обновления…",
            DesktopUpdateStatus.Downloading => $"Загружаем обновление — {state.DownloadPercent}%",
            _ => "Проверить обновления",
        };

        var package = _updates.ReadyPackage;
        if (package is null)
        {
            _readyUpdate = null;
            _updateItem.Visible = false;
            UpdateBanner.Visibility = Visibility.Collapsed;
            return;
        }

        _readyUpdate = package;
        var version = DesktopUpdateManifestVerifier.FormatVersion(package.Manifest.Version);
        _updateItem.Text = $"Обновление готово — {version}";
        _updateItem.AccessibleName = $"Открыть обновление HUB Desktop {version}";
        _updateItem.Visible = true;
        UpdateTitle.Text = $"HUB Desktop {version} готов к установке";
        UpdateDetails.Text = state.Status == DesktopUpdateStatus.Error
            && string.Equals(state.ErrorCode, "runner_launch", StringComparison.Ordinal)
                ? "Не удалось запустить установку. HUB продолжает работать. Повторите попытку."
                : package.Manifest.ReleaseNotes.FirstOrDefault()
                    ?? "Обновление загружено. Установка начнётся только после вашего подтверждения.";
        AutomationProperties.SetName(
            UpdateBanner,
            $"Обновление HUB Desktop {version} готово к установке");

        UpdateBanner.Visibility = state.Status == DesktopUpdateStatus.Ready
            || state.Status == DesktopUpdateStatus.Error
            && string.Equals(state.ErrorCode, "runner_launch", StringComparison.Ordinal)
            ? Visibility.Visible
            : Visibility.Collapsed;
    }

    private async Task CheckForUpdatesFromTrayAsync()
    {
        DesktopLog.Info("Manual desktop update check requested from tray");
        ShowAboutWindow();
        if (_updates.ReadyPackage is not null)
        {
            return;
        }

        await _updates.CheckNowAsync();
    }

    private void ShowAboutWindow()
    {
        ShowAndActivate();
        if (_aboutWindow is not null)
        {
            _aboutWindow.Activate();
            _aboutWindow.Focus();
            return;
        }

        var deferralHours = _policy.ResolveUpdateDeferralHours(defaultHours: 24);
        var aboutWindow = new AboutWindow(
            _updates,
            _runtime,
            _autostart,
            TryStartReadyUpdate,
            DeferReadyUpdateFromUiAsync,
            canDeferUpdate: deferralHours > 0)
        {
            Owner = this,
        };
        aboutWindow.Closed += (_, _) => _aboutWindow = null;
        _aboutWindow = aboutWindow;
        aboutWindow.Show();
    }

    private void ShowDesktopSettingsWindow()
    {
        ShowAndActivate();
        var settingsWindow = new DesktopSettingsWindow(
            _settingsStore.Load(),
            TrySaveDesktopSettings)
        {
            Owner = this,
        };
        settingsWindow.ShowDialog();
    }

    private string? TrySaveDesktopSettings(DesktopSettings candidate)
    {
        var previous = _settingsStore.Load();
        var registeredForCandidate = false;
        if (candidate.GlobalHotkeyEnabled && !_globalHotkey.IsRegistered)
        {
            var windowHandle = new WindowInteropHelper(this).Handle;
            if (!_globalHotkey.TryRegister(windowHandle))
            {
                return "Ctrl+Shift+H уже используется другой программой. Выберите другую настройку или освободите сочетание.";
            }

            registeredForCandidate = true;
        }

        try
        {
            _settingsStore.Save(candidate);
            _notificationSettings = candidate;
            if (!candidate.GlobalHotkeyEnabled)
            {
                _globalHotkey.Unregister();
            }

            DesktopLog.Info("Desktop shell preferences saved");
            return null;
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or ArgumentException)
        {
            if (registeredForCandidate && !previous.GlobalHotkeyEnabled)
            {
                _globalHotkey.Unregister();
            }

            DesktopLog.Error("Desktop shell preferences could not be saved", exception);
            return "Не удалось сохранить настройки. Проверьте доступ к профилю пользователя и повторите попытку.";
        }
    }

    private async Task ShowDiagnosticsWindowAsync()
    {
        ShowAndActivate();
        if (_diagnosticsWindow is not null)
        {
            _diagnosticsWindow.Activate();
            _diagnosticsWindow.Focus();
            return;
        }

        if (_diagnosticsOpening)
        {
            return;
        }

        _diagnosticsOpening = true;
        _diagnosticsItem.Enabled = false;
        _diagnosticsItem.Text = "Собираем диагностику…";
        try
        {
            var context = new DesktopDiagnosticsContext(
                _options.BaseUri,
                _runtime.WindowsAppSdkStatus,
                _runtime.NotificationMode,
                ReadAutostartStatus(),
                _lastNavigationStatus,
                _lastNavigationAtUtc,
                _lastBridgeHandshakeUtc,
                _updates.Current,
                _performance.Snapshot(),
                _memoryMetrics.Snapshot());
            var snapshot = await Task.Run(() => _diagnostics.Collect(context));
            if (_applicationController.ExitRequested)
            {
                return;
            }

            var diagnosticsWindow = new DiagnosticsWindow(
                snapshot,
                _policy.ResolveDiagnosticsExportEnabled(defaultEnabled: true))
            {
                Owner = this,
            };
            diagnosticsWindow.Closed += (_, _) => _diagnosticsWindow = null;
            _diagnosticsWindow = diagnosticsWindow;
            diagnosticsWindow.Show();
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop diagnostics collection failed", exception);
            System.Windows.MessageBox.Show(
                "Не удалось собрать диагностику. Повторите попытку.",
                "HUB Desktop",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
        finally
        {
            _diagnosticsOpening = false;
            _diagnosticsItem.Enabled = true;
            _diagnosticsItem.Text = "Диагностика";
        }
    }

    private void ShowDownloadsWindow()
    {
        ShowAndActivate();
        if (_downloadsWindow is not null)
        {
            _downloadsWindow.Activate();
            _downloadsWindow.Focus();
            return;
        }

        var downloadsWindow = new DownloadsWindow(_downloads)
        {
            Owner = this,
        };
        downloadsWindow.ApplyTheme(_currentThemeMode);
        downloadsWindow.OpenRequested += DownloadsWindow_OpenRequested;
        downloadsWindow.RevealRequested += DownloadsWindow_RevealRequested;
        downloadsWindow.CancelRequested += DownloadsWindow_CancelRequested;
        downloadsWindow.ClearFinishedRequested += DownloadsWindow_ClearFinishedRequested;
        downloadsWindow.OpenDownloadsFolderRequested += DownloadsWindow_OpenDownloadsFolderRequested;
        downloadsWindow.Closed += (_, _) =>
        {
            downloadsWindow.OpenRequested -= DownloadsWindow_OpenRequested;
            downloadsWindow.RevealRequested -= DownloadsWindow_RevealRequested;
            downloadsWindow.CancelRequested -= DownloadsWindow_CancelRequested;
            downloadsWindow.ClearFinishedRequested -= DownloadsWindow_ClearFinishedRequested;
            downloadsWindow.OpenDownloadsFolderRequested -= DownloadsWindow_OpenDownloadsFolderRequested;
            _downloadsWindow = null;
        };
        _downloadsWindow = downloadsWindow;
        downloadsWindow.Show();
    }

    private void DownloadsWindow_OpenRequested(
        object? sender,
        DesktopDownloadActionRequestedEventArgs e)
    {
        _downloadsWindow?.PresentActionResult(_downloads.OpenDownload(e.ItemId));
    }

    private void DownloadsWindow_RevealRequested(
        object? sender,
        DesktopDownloadActionRequestedEventArgs e)
    {
        _downloadsWindow?.PresentActionResult(_downloads.RevealDownload(e.ItemId));
    }

    private void DownloadsWindow_CancelRequested(
        object? sender,
        DesktopDownloadActionRequestedEventArgs e)
    {
        _downloadsWindow?.PresentActionResult(
            _downloads.TryRequestCancel(e.ItemId)
                ? DesktopFileActionResult.Succeeded
                : DesktopFileActionResult.Failed);
    }

    private void DownloadsWindow_ClearFinishedRequested(object? sender, EventArgs e)
    {
        _downloads.ClearFinished();
        _downloadsWindow?.PresentActionResult(DesktopFileActionResult.Succeeded);
    }

    private void DownloadsWindow_OpenDownloadsFolderRequested(object? sender, EventArgs e)
    {
        _downloadsWindow?.PresentActionResult(_downloads.OpenDownloadsFolder());
    }

    private void RefreshDownloadsMenuItem()
    {
        var count = _downloads.Items.Count;
        _downloadsItem.Text = count == 0 ? "Загрузки" : $"Загрузки ({count})";
        _downloadsItem.AccessibleName = count == 0
            ? "Открыть загрузки HUB Desktop"
            : $"Открыть загрузки HUB Desktop, файлов: {count}";
    }

    private string ReadAutostartStatus()
    {
        try
        {
            return _autostart.IsEnabled ? "Включён" : "Выключен";
        }
        catch
        {
            return "Не удалось определить";
        }
    }

    private void ShowReadyUpdate()
    {
        if (_readyUpdate is null)
        {
            return;
        }

        ShowAndActivate();
        UpdateBanner.Visibility = Visibility.Visible;
        InstallUpdateButton.Focus();
    }

    private async void DeferUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        if (await DeferReadyUpdateFromUiAsync())
        {
            UpdateBanner.Visibility = Visibility.Collapsed;
            _webView?.Focus();
        }
    }

    private void InstallUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        _ = TryStartReadyUpdate();
    }

    private async Task<bool> DeferReadyUpdateFromUiAsync()
    {
        if (_updates.ReadyPackage is null)
        {
            return false;
        }

        try
        {
            var deferralHours = _policy.ResolveUpdateDeferralHours(defaultHours: 24);
            if (deferralHours == 0)
            {
                return false;
            }

            var deferred = await _updates.DeferReadyUpdateAsync(
                DateTimeOffset.UtcNow.AddHours(deferralHours));
            if (deferred)
            {
                DesktopLog.Info($"Desktop update deferred; hours={deferralHours}");
            }

            return deferred;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop update defer failed", exception);
            return false;
        }
    }

    private bool TryStartReadyUpdate()
    {
        var readyUpdate = _updates.ReadyPackage;
        if (readyUpdate is null)
        {
            return false;
        }

        _readyUpdate = readyUpdate;

        InstallUpdateButton.IsEnabled = false;
        DeferUpdateButton.IsEnabled = false;
        InstallUpdateButton.Content = "Запускаем установку…";
        var applicationPath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(applicationPath)
            || !_updates.TryInstallReadyUpdate(applicationPath))
        {
            InstallUpdateButton.Content = "Перезапустить и обновить";
            InstallUpdateButton.IsEnabled = true;
            DeferUpdateButton.IsEnabled = true;
            UpdateDetails.Text = "Не удалось запустить установку. Попробуйте ещё раз.";
            AutomationProperties.SetName(
                UpdateBanner,
                "Не удалось запустить обновление HUB Desktop");
            return false;
        }

        PrepareForShutdown();
        Application.Current.Shutdown();
        return true;
    }

}
