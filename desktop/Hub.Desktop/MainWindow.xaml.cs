using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Hub.Desktop.Autostart;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
using Hub.Desktop.Notifications;
using Hub.Desktop.Security;
using Hub.Desktop.UI;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Application = System.Windows.Application;
using Forms = System.Windows.Forms;
using Drawing = System.Drawing;

namespace Hub.Desktop;

public partial class MainWindow : Window
{
    private static readonly HashSet<string> DesktopDocumentExtensions = new(
        [
            ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm",
            ".xls", ".xlsx", ".xlsm", ".xlt", ".xltx", ".xltm",
            ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm",
            ".odt", ".ods", ".odp", ".rtf", ".csv", ".pdf",
        ],
        StringComparer.OrdinalIgnoreCase);

    private readonly DesktopOptions _options;
    private readonly IDesktopNotificationService _notifications;
    private readonly IAutostartService _autostart;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly bool _startHidden;
    private readonly Forms.ToolStripMenuItem _autostartItem;
    private readonly Forms.ContextMenuStrip _trayMenu;
    private readonly Forms.NotifyIcon _trayIcon;
    private readonly Drawing.Icon _applicationIcon;
    private readonly DesktopNotificationWindow _desktopNotificationWindow;
    private readonly DesktopUpdateService _updates;
    private readonly Forms.ToolStripMenuItem _updateItem;
    private DesktopBridgeHost? _desktopBridge;
    private WebView2? _webView;
    private HwndSource? _windowSource;
    private string? _pendingInternalRoute;
    private bool _initializing;
    private bool _requiresReset;
    private bool _exitRequested;
    private bool _trayHintShown;
    private DateTime _openDownloadedFileRequestedUntilUtc = DateTime.MinValue;
    private DesktopUpdatePackage? _readyUpdate;

    public MainWindow(
        DesktopOptions options,
        IDesktopNotificationService notifications,
        IAutostartService autostart,
        DesktopUpdateService updates,
        bool startHidden = false)
    {
        _options = options;
        _notifications = notifications;
        _autostart = autostart;
        _updates = updates;
        _startHidden = startHidden;
        _navigationPolicy = new NavigationPolicy(options.BaseUri);
        InitializeComponent();
        UpdateMaximizeRestoreButton();

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
        _updates.UpdateReady += Updates_UpdateReady;
        RefreshAutostartMenuItem();
        _trayMenu = CreateTrayMenu();
        _trayMenu.Opening += (_, _) => RefreshAutostartMenuItem();
        _trayIcon = new Forms.NotifyIcon
        {
            ContextMenuStrip = _trayMenu,
            Icon = _applicationIcon,
            Text = "HUB Desktop",
            Visible = true,
        };
        _trayIcon.MouseClick += (_, eventArgs) =>
        {
            if (eventArgs.Button == Forms.MouseButtons.Left)
            {
                ShowAndActivate();
            }
        };
        if (_notifications is FallbackDesktopNotificationService fallbackNotifications)
        {
            fallbackNotifications.SetFallback(ShowPersistentNotification, preferFallback: true);
            DesktopLog.Info("Persistent desktop notification presenter registered");
        }

        if (_startHidden)
        {
            WindowState = WindowState.Minimized;
            ShowInTaskbar = false;
        }
    }

    public void ShowAndActivate()
    {
        if (!IsVisible)
        {
            Show();
        }

        if (WindowState == WindowState.Minimized)
        {
            WindowState = WindowState.Normal;
        }

        var handle = new WindowInteropHelper(this).Handle;
        NativeWindowActivation.RestoreAndForeground(handle);
        Activate();
        Focus();
        SendDesktopWindowForegroundState();
        DesktopLog.Info("Main window activated");
    }

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

    public void PrepareForShutdown()
    {
        _exitRequested = true;
        _trayIcon.Visible = false;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _windowSource = (HwndSource?)PresentationSource.FromVisual(this);
        _windowSource?.AddHook(WindowMessageHook);
    }

    private static nint WindowMessageHook(
        nint windowHandle,
        int message,
        nint wordParameter,
        nint longParameter,
        ref bool handled)
    {
        if (message == NativeWindowActivation.GetMinimumMaximumInfoMessage)
        {
            NativeWindowActivation.ConstrainMaximizedBoundsToWorkArea(windowHandle, longParameter);
            handled = true;
        }

        return nint.Zero;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        Loaded -= Window_Loaded;

        if (_startHidden)
        {
            Hide();
            WindowState = WindowState.Normal;
            ShowInTaskbar = true;
            DesktopLog.Info("Main window started hidden by autostart");
        }

        await CreateWebViewAsync();
    }

    private async Task CreateWebViewAsync()
    {
        if (_initializing)
        {
            return;
        }

        _initializing = true;
        ShowLoading();

        try
        {
            ReplaceWebView();
            Directory.CreateDirectory(DesktopPaths.UserDataFolder);

            var environment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: DesktopPaths.UserDataFolder);

            await _webView!.EnsureCoreWebView2Async(environment);
            ConfigureWebView(_webView.CoreWebView2);

            _requiresReset = false;
            DesktopLog.Info($"WebView2 initialized for {_navigationPolicy.TrustedOriginForLog}");
            _webView.CoreWebView2.Navigate(_options.BaseUri.AbsoluteUri);
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            DesktopLog.Error("WebView2 Runtime is unavailable", exception);
            ShowError(
                "Не установлен WebView2 Runtime",
                "Установите Microsoft Edge WebView2 Runtime и повторите попытку.");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("WebView2 initialization failed", exception);
            ShowError(
                "Не удалось запустить HUB",
                "Проверьте подключение к сети и повторите попытку.");
        }
        finally
        {
            _initializing = false;
        }
    }

    private void ReplaceWebView()
    {
        DisposeDesktopBridge();

        if (_webView is not null)
        {
            _webView.Dispose();
            BrowserHost.Children.Remove(_webView);
        }

        _webView = new WebView2();
        BrowserHost.Children.Add(_webView);
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
        core.NewWindowRequested += Core_NewWindowRequested;
        core.LaunchingExternalUriScheme += Core_LaunchingExternalUriScheme;
        core.ServerCertificateErrorDetected += Core_ServerCertificateErrorDetected;
        core.ProcessFailed += Core_ProcessFailed;
        core.DownloadStarting += Core_DownloadStarting;
        _desktopBridge = new DesktopBridgeHost(
            core,
            _navigationPolicy,
            _notifications,
            Environment.UserName);
        _desktopBridge.Ready += DesktopBridge_Ready;
        _desktopBridge.ThemeChanged += DesktopBridge_ThemeChanged;
        _desktopBridge.OpenDownloadedFileRequested += DesktopBridge_OpenDownloadedFileRequested;
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var decision = _navigationPolicy.Evaluate(e.Uri);

        if (decision == NavigationDisposition.TrustedOrigin)
        {
            _desktopBridge?.ResetDocumentReady();
            HideError();
            ShowLoading();
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

    private void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingIndicator.Visibility = Visibility.Collapsed;

        if (e.IsSuccess)
        {
            HideError();
            return;
        }

        DesktopLog.Warning($"Navigation failed with status '{e.WebErrorStatus}'");
        ShowError(
            "HUB временно недоступен",
            "Проверьте подключение к корпоративной сети и повторите попытку.");
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
        DesktopLog.Warning("TLS certificate validation failed");
        ShowError(
            "Не удалось проверить сертификат HUB",
            "Подключение остановлено. Обратитесь в IT-службу, если ошибка повторяется.");
    }

    private void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        _requiresReset = e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited;
        DesktopLog.Warning($"WebView2 process failed: {e.ProcessFailedKind}");
        ShowError(
            "Веб-компонент HUB остановлен",
            "Нажмите «Повторить», чтобы восстановить приложение.");
    }

    private void OpenExternalUri(string rawUri)
    {
        if (!_navigationPolicy.TryGetExternalUri(rawUri, out var uri))
        {
            DesktopLog.Warning("Rejected external navigation after policy evaluation");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
            DesktopLog.Info($"Opened external URI scheme '{uri.Scheme}' in the system handler");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("System handler failed to open an external URI", exception);
            ShowError(
                "Не удалось открыть ссылку",
                "Системный обработчик ссылки недоступен.");
        }
    }

    private void DesktopBridge_Ready(object? sender, EventArgs e)
    {
        SendDesktopWindowForegroundState();

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

    private void DesktopBridge_OpenDownloadedFileRequested(object? sender, EventArgs e)
    {
        _openDownloadedFileRequestedUntilUtc = DateTime.UtcNow.AddSeconds(15);
    }

    private void Core_DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        if (DateTime.UtcNow > _openDownloadedFileRequestedUntilUtc)
        {
            return;
        }

        _openDownloadedFileRequestedUntilUtc = DateTime.MinValue;
        var operation = e.DownloadOperation;
        e.Handled = true;

        EventHandler<object>? stateChanged = null;
        stateChanged = (_, _) =>
        {
            if (operation.State == CoreWebView2DownloadState.InProgress)
            {
                return;
            }

            operation.StateChanged -= stateChanged;
            if (operation.State == CoreWebView2DownloadState.Completed)
            {
                Dispatcher.BeginInvoke(() => OpenDownloadedDocument(operation.ResultFilePath));
                return;
            }

            DesktopLog.Warning($"Desktop document download did not complete: {operation.State}");
        };
        operation.StateChanged += stateChanged;
    }

    private static void OpenDownloadedDocument(string? path)
    {
        try
        {
            var normalizedPath = Path.GetFullPath(path ?? string.Empty);
            var extension = Path.GetExtension(normalizedPath);
            if (!File.Exists(normalizedPath) || !DesktopDocumentExtensions.Contains(extension))
            {
                DesktopLog.Warning("Rejected unsupported downloaded document type");
                return;
            }

            Process.Start(new ProcessStartInfo(normalizedPath) { UseShellExecute = true });
            DesktopLog.Info($"Downloaded document opened with the Windows handler; extension={extension}");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Downloaded document could not be opened", exception);
        }
    }

    private void ApplyChromeTheme(DesktopThemeMode mode)
    {
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

    private void SendDesktopWindowForegroundState()
    {
        var foreground = IsVisible && WindowState != WindowState.Minimized && IsActive;
        _desktopBridge?.TrySetWindowForeground(foreground);
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
        _desktopBridge.Dispose();
        _desktopBridge = null;
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        if (_requiresReset || _webView?.CoreWebView2 is null)
        {
            await CreateWebViewAsync();
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

    private Forms.ContextMenuStrip CreateTrayMenu()
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
            ForeColor = HubTrayContextMenu.ExitColor,
            Image = HubTrayContextMenu.CreateExitIcon(),
            Padding = new Forms.Padding(2, 4, 8, 4),
        };

        showItem.Click += (_, _) => ShowAndActivate();
        exitItem.Click += (_, _) => RequestExit();
        menu.Items.Add(showItem);
        menu.Items.Add(HubTrayContextMenu.CreateSeparator());
        menu.Items.Add(_updateItem);
        menu.Items.Add(HubTrayContextMenu.CreateSeparator());
        menu.Items.Add(_autostartItem);
        menu.Items.Add(HubTrayContextMenu.CreateSeparator());
        menu.Items.Add(exitItem);
        return menu;
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

    private void ToggleAutostart()
    {
        try
        {
            var enable = !_autostart.IsEnabled;
            _autostart.SetEnabled(enable);
            RefreshAutostartMenuItem();
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

    private void RefreshAutostartMenuItem()
    {
        try
        {
            _autostartItem.Checked = _autostart.IsEnabled;
        }
        catch (Exception exception)
        {
            _autostartItem.Checked = false;
            DesktopLog.Error("Autostart state read failed", exception);
        }
    }

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_exitRequested)
        {
            return;
        }

        e.Cancel = true;
        Hide();
        SendDesktopWindowForegroundState();
        DesktopLog.Info("Main window hidden to tray");

        if (_trayHintShown)
        {
            return;
        }

        _trayHintShown = true;
        _trayIcon.ShowBalloonTip(
            3000,
            "HUB Desktop",
            "HUB продолжает работать в области уведомлений.",
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
        ShowAndNavigate(route);
    }

    private void RequestExit()
    {
        PrepareForShutdown();
        Close();
        Application.Current.Shutdown();
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        _windowSource?.RemoveHook(WindowMessageHook);
        _windowSource = null;

        if (_notifications is FallbackDesktopNotificationService fallbackNotifications)
        {
            fallbackNotifications.ClearFallback();
        }

        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _trayMenu.Dispose();
        _applicationIcon.Dispose();
        _desktopNotificationWindow.OpenRequested -= DesktopNotificationWindow_OpenRequested;
        _updates.UpdateReady -= Updates_UpdateReady;
        _desktopNotificationWindow.Close();
        DisposeDesktopBridge();
        _webView?.Dispose();
    }

    private void Updates_UpdateReady(object? sender, DesktopUpdatePackage package)
    {
        Dispatcher.BeginInvoke(() => PresentReadyUpdate(package));
    }

    private void PresentReadyUpdate(DesktopUpdatePackage package)
    {
        _readyUpdate = package;
        var version = DesktopUpdateManifestVerifier.FormatVersion(package.Manifest.Version);
        _updateItem.Text = $"Обновление готово — {version}";
        _updateItem.AccessibleName = $"Открыть обновление HUB Desktop {version}";
        _updateItem.Visible = true;
        UpdateTitle.Text = $"HUB Desktop {version} готов к установке";
        UpdateDetails.Text = package.Manifest.ReleaseNotes.FirstOrDefault()
            ?? "Новая версия загружена и будет установлена после перезапуска.";
        AutomationProperties.SetName(
            UpdateBanner,
            $"Обновление HUB Desktop {version} готово к установке");

        if (package.DeferredUntil is null || package.DeferredUntil <= DateTimeOffset.UtcNow)
        {
            UpdateBanner.Visibility = Visibility.Visible;
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
        if (_readyUpdate is null)
        {
            return;
        }

        try
        {
            await _updates.DeferAsync(
                _readyUpdate,
                DateTimeOffset.UtcNow.AddHours(24));
            UpdateBanner.Visibility = Visibility.Collapsed;
            _webView?.Focus();
            DesktopLog.Info("Desktop update deferred for 24 hours");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop update defer failed", exception);
        }
    }

    private void InstallUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        if (_readyUpdate is null)
        {
            return;
        }

        InstallUpdateButton.IsEnabled = false;
        DeferUpdateButton.IsEnabled = false;
        InstallUpdateButton.Content = "Запускаем установку…";
        var applicationPath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(applicationPath)
            || !_updates.TryLaunchInstaller(_readyUpdate, applicationPath))
        {
            InstallUpdateButton.Content = "Перезапустить и обновить";
            InstallUpdateButton.IsEnabled = true;
            DeferUpdateButton.IsEnabled = true;
            UpdateDetails.Text = "Не удалось запустить установку. Попробуйте ещё раз.";
            AutomationProperties.SetName(
                UpdateBanner,
                "Не удалось запустить обновление HUB Desktop");
            return;
        }

        PrepareForShutdown();
        Application.Current.Shutdown();
    }

    private static class NativeWindowActivation
    {
        private const int RestoreWindow = 9;
        private const uint NearestMonitor = 2;
        public const int GetMinimumMaximumInfoMessage = 0x0024;

        public static void RestoreAndForeground(nint windowHandle)
        {
            if (windowHandle == nint.Zero)
            {
                return;
            }

            ShowWindow(windowHandle, RestoreWindow);
            SetForegroundWindow(windowHandle);
        }

        public static void ConstrainMaximizedBoundsToWorkArea(
            nint windowHandle,
            nint minimumMaximumInfoPointer)
        {
            var monitorHandle = MonitorFromWindow(windowHandle, NearestMonitor);
            if (monitorHandle == nint.Zero)
            {
                return;
            }

            var monitorInfo = new MonitorInfo
            {
                Size = Marshal.SizeOf<MonitorInfo>(),
            };
            if (!GetMonitorInfo(monitorHandle, ref monitorInfo))
            {
                return;
            }

            var minimumMaximumInfo = Marshal.PtrToStructure<MinimumMaximumInfo>(
                minimumMaximumInfoPointer);
            minimumMaximumInfo.MaximumPosition.X =
                monitorInfo.WorkArea.Left - monitorInfo.MonitorArea.Left;
            minimumMaximumInfo.MaximumPosition.Y =
                monitorInfo.WorkArea.Top - monitorInfo.MonitorArea.Top;
            minimumMaximumInfo.MaximumSize.X =
                monitorInfo.WorkArea.Right - monitorInfo.WorkArea.Left;
            minimumMaximumInfo.MaximumSize.Y =
                monitorInfo.WorkArea.Bottom - monitorInfo.WorkArea.Top;
            Marshal.StructureToPtr(minimumMaximumInfo, minimumMaximumInfoPointer, false);
        }

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(nint windowHandle, int command);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(nint windowHandle);

        [DllImport("user32.dll")]
        private static extern nint MonitorFromWindow(nint windowHandle, uint flags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(nint monitorHandle, ref MonitorInfo monitorInfo);

        [StructLayout(LayoutKind.Sequential)]
        private struct NativePoint
        {
            public int X;
            public int Y;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NativeRectangle
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MinimumMaximumInfo
        {
            public NativePoint Reserved;
            public NativePoint MaximumSize;
            public NativePoint MaximumPosition;
            public NativePoint MinimumTrackingSize;
            public NativePoint MaximumTrackingSize;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MonitorInfo
        {
            public int Size;
            public NativeRectangle MonitorArea;
            public NativeRectangle WorkArea;
            public uint Flags;
        }
    }
}
