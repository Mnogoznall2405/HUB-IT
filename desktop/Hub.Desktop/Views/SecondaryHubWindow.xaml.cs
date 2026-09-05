using System.Diagnostics;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shell;
using System.Windows.Threading;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Downloads;
using Hub.Desktop.Interop;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Printing;
using Hub.Desktop.Remote;
using Hub.Desktop.Security;
using Hub.Desktop.Transfers;
using Hub.Desktop.WebView;
using Hub.Desktop.Workspace;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace Hub.Desktop.Views;

public partial class SecondaryHubWindow : Window, IDesktopHubWindow
{
    private readonly DesktopOptions _options;
    private readonly IDesktopNotificationService _notifications;
    private readonly DesktopWindowManager _windowManager;
    private readonly IDesktopGlobalActions _globalActions;
    private readonly DesktopDownloadCoordinator _downloads;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly ExternalUriLauncher _externalUriLauncher;
    private readonly DesktopWebViewHost _webViewHost;
    private readonly DesktopWindowController _windowController;
    private readonly DesktopWindowPlacementService _windowPlacement = new();
    private readonly DesktopWindowPlacement _initialPlacement;
    private readonly DesktopPrintService _printing = new();
    private readonly DesktopTaskbarProgress _downloadTaskbarProgress = new();
    private readonly WebViewRecoveryPolicy _webViewRecovery = new();
    private readonly CancellationTokenSource _shutdown = new();
    private readonly DispatcherTimer _downloadFailureTimer;
    private WebView2? _webView;
    private DesktopBridgeHost? _desktopBridge;
    private CoreWebView2MemoryUsageTargetLevel? _memoryUsageTargetLevel;
    private HwndSource? _windowSource;
    private CancellationTokenSource? _navigationTimeout;
    private string? _lastSafeRoute;
    private string? _pendingInternalRoute;
    private bool _initializing;
    private bool _requiresReset;
    private bool _recoveryInProgress;
    private bool _hardReloadInProgress;

    public SecondaryHubWindow(
        DesktopOptions options,
        IDesktopNotificationService notifications,
        DesktopWindowManager windowManager,
        IDesktopGlobalActions globalActions,
        DesktopDownloadCoordinator downloads,
        DesktopWebViewEnvironmentProvider environmentProvider,
        DesktopWindowPlacement initialPlacement,
        string? initialRoute)
    {
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _notifications = notifications ?? throw new ArgumentNullException(nameof(notifications));
        _windowManager = windowManager ?? throw new ArgumentNullException(nameof(windowManager));
        _globalActions = globalActions ?? throw new ArgumentNullException(nameof(globalActions));
        _downloads = downloads ?? throw new ArgumentNullException(nameof(downloads));
        _initialPlacement = initialPlacement
            ?? throw new ArgumentNullException(nameof(initialPlacement));
        _lastSafeRoute = DesktopBridgeProtocol.IsValidInternalRoute(initialRoute)
            ? initialRoute
            : null;
        _navigationPolicy = new NavigationPolicy(options.BaseUri);
        _externalUriLauncher = new ExternalUriLauncher(_navigationPolicy);

        InitializeComponent();
        _webViewHost = new DesktopWebViewHost(
            BrowserHost,
            environmentProvider ?? throw new ArgumentNullException(nameof(environmentProvider)));
        _windowController = new DesktopWindowController(this);
        TaskbarItemInfo = new TaskbarItemInfo();
        _downloadFailureTimer = new DispatcherTimer(
            DispatcherPriority.Background,
            Dispatcher)
        {
            Interval = TimeSpan.FromSeconds(3),
        };
        _downloadFailureTimer.Tick += DownloadFailureTimer_Tick;
        _downloads.Changed += Downloads_Changed;
        _windowManager.WindowAvailabilityChanged += WindowManager_WindowAvailabilityChanged;
        UpdateNewWindowButtonState();
        UpdateMaximizeRestoreButton();
    }

    public string? CurrentSource => _webView?.CoreWebView2?.Source;

    public void ShowAndActivate()
    {
        _windowController.ShowAndActivate();
        SendDesktopWindowForegroundState();
        DesktopLog.Info("Secondary HUB window activated");
    }

    public void ShowAndNavigate(string? route)
    {
        ShowAndActivate();
        if (!DesktopBridgeProtocol.IsValidInternalRoute(route))
        {
            return;
        }

        _lastSafeRoute = route;
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

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        _windowSource = (HwndSource?)PresentationSource.FromVisual(this);
        _windowSource?.AddHook(WindowMessageHook);
        if (!_windowPlacement.TryApply(
                new WindowInteropHelper(this).Handle,
                _initialPlacement,
                restoreMaximized: false))
        {
            DesktopLog.Warning("Secondary HUB window placement could not be applied");
        }
    }

    private nint WindowMessageHook(
        nint windowHandle,
        int message,
        nint wordParameter,
        nint longParameter,
        ref bool handled)
    {
        handled = DesktopWindowController.TryHandleWindowMessage(
            windowHandle,
            message,
            longParameter);
        return nint.Zero;
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e) =>
        await CreateWebViewAsync();

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
        ShowLoading();
        try
        {
            DisposeDesktopBridge();
            var core = await _webViewHost.RecreateAsync(_shutdown.Token);
            _webView = _webViewHost.View;
            _memoryUsageTargetLevel = null;
            ConfigureWebView(core);
            _requiresReset = false;
            var target = DesktopBridgeProtocol.IsValidInternalRoute(_lastSafeRoute)
                ? new Uri(_options.BaseUri, _lastSafeRoute)
                : _options.BaseUri;
            DesktopLog.Info("WebView2 initialized for the secondary HUB window");
            core.Navigate(target.AbsoluteUri);
            return null;
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            DesktopLog.Error("WebView2 Runtime is unavailable for the secondary window", exception);
            ShowRecoveryError(WebViewFailureKind.RuntimeUnavailable);
            return WebViewFailureKind.RuntimeUnavailable;
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            return null;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Secondary WebView2 initialization failed", exception);
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
        ApplyWebViewMemoryUsageTarget(core);
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var decision = _navigationPolicy.Evaluate(e.Uri);
        if (decision == NavigationDisposition.TrustedOrigin)
        {
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

        DesktopLog.Warning(
            $"Blocked secondary-window navigation with scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
    }

    private async void Core_NavigationCompleted(
        object? sender,
        CoreWebView2NavigationCompletedEventArgs e)
    {
        CancelNavigationTimeout();
        LoadingIndicator.Visibility = Visibility.Collapsed;
        if (e.IsSuccess)
        {
            HideError();
            SaveLastSafeRoute(_webView?.CoreWebView2?.Source);
            return;
        }

        var status = e.WebErrorStatus.ToString();
        DesktopLog.Warning($"Secondary navigation failed with status '{status}'");
        var failure = status.Contains("Certificate", StringComparison.OrdinalIgnoreCase)
            ? WebViewFailureKind.Certificate
            : status.Equals("Timeout", StringComparison.OrdinalIgnoreCase)
                ? WebViewFailureKind.NavigationTimeout
                : WebViewFailureKind.Network;
        await RecoverWebViewAsync(failure);
    }

    private void Core_HistoryChanged(object? sender, object e) =>
        SaveLastSafeRoute((sender as CoreWebView2)?.Source);

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

        DesktopLog.Warning(
            $"Blocked secondary new-window request with scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
    }

    private void Core_LaunchingExternalUriScheme(
        object? sender,
        CoreWebView2LaunchingExternalUriSchemeEventArgs e)
    {
        e.Cancel = !_navigationPolicy.IsAllowedExternalScheme(e.Uri);
        if (e.Cancel)
        {
            DesktopLog.Warning(
                $"Blocked secondary external URI scheme '{NavigationPolicy.GetSchemeForLog(e.Uri)}'");
        }
    }

    private void Core_ServerCertificateErrorDetected(
        object? sender,
        CoreWebView2ServerCertificateErrorDetectedEventArgs e)
    {
        e.Action = CoreWebView2ServerCertificateErrorAction.Cancel;
        CancelNavigationTimeout();
        _requiresReset = false;
        DesktopLog.Warning("TLS certificate validation failed in the secondary window");
        ShowRecoveryError(WebViewFailureKind.Certificate);
    }

    private async void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        CancelNavigationTimeout();
        DesktopLog.Warning($"Secondary WebView2 process failed: {e.ProcessFailedKind}");
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

    private void DesktopBridge_Ready(object? sender, EventArgs e)
    {
        SendDesktopWindowForegroundState();
        _windowManager.NotifyBridgeReady(this);
        if (!DesktopBridgeProtocol.IsValidInternalRoute(_pendingInternalRoute)
            || _desktopBridge?.TryOpenInternalRoute(_pendingInternalRoute) != true)
        {
            return;
        }

        _pendingInternalRoute = null;
    }

    private void DesktopBridge_ThemeChanged(object? sender, DesktopThemeChangedEventArgs e) =>
        ApplyChromeTheme(e.Mode);

    private void DesktopBridge_OpenDownloadedFileRequested(
        object? sender,
        DesktopOpenDownloadedFileRequestedEventArgs e)
    {
        e.Accepted = _downloads.RequestOpenNextDownload()
            == DesktopOpenIntentRequestResult.Accepted;
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
        DesktopShellStatusChangedEventArgs e) =>
        _windowManager.UpdateShellStatus(this, e.Status);

    private void DesktopBridge_QuickRoutesChanged(
        object? sender,
        DesktopQuickRoutesChangedEventArgs e) =>
        _windowManager.UpdateQuickRoutes(this, e.Routes);

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
        _globalActions.ShowDownloads();

    private async void DesktopBridge_OpenDiagnosticsRequested(object? sender, EventArgs e) =>
        await _globalActions.ShowDiagnosticsAsync();

    private async void DesktopBridge_CheckForUpdatesRequested(object? sender, EventArgs e) =>
        await _globalActions.CheckForUpdatesAsync();

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

    private void Core_DownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        var operation = e.DownloadOperation;
        var item = _downloads.BeginDownload(
            operation.ResultFilePath,
            operation.Cancel,
            sourceWindowLabel: "Окно 2");
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
        bytesReceivedChanged = (_, _) => Dispatcher.BeginInvoke(() =>
            _downloads.ReportProgress(
                item.Id,
                operation.BytesReceived,
                operation.TotalBytesToReceive is ulong totalBytes
                    ? (long)Math.Min(totalBytes, (ulong)long.MaxValue)
                    : 0));
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
        };
        operation.BytesReceivedChanged += bytesReceivedChanged;
        operation.StateChanged += stateChanged;
    }

    private void MinimizeButton_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void NewWindowButton_Click(object sender, RoutedEventArgs e) =>
        _windowManager.OpenSecondaryFrom(this);

    private void MaximizeRestoreButton_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_StateChanged(object? sender, EventArgs e)
    {
        UpdateMaximizeRestoreButton();
        SendDesktopWindowForegroundState();
    }

    private void Window_Activated(object? sender, EventArgs e) =>
        SendDesktopWindowForegroundState();

    private void Window_Deactivated(object? sender, EventArgs e) =>
        SendDesktopWindowForegroundState();

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.N
            && Keyboard.Modifiers == (ModifierKeys.Control | ModifierKeys.Shift))
        {
            e.Handled = _windowManager.OpenSecondaryFrom(this)
                is not DesktopSecondaryWindowOpenResult.Unavailable;
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

    private void UpdateMaximizeRestoreButton()
    {
        var maximized = WindowState == WindowState.Maximized;
        MaximizeGlyph.Visibility = maximized ? Visibility.Collapsed : Visibility.Visible;
        RestoreGlyph.Visibility = maximized ? Visibility.Visible : Visibility.Collapsed;
        MaximizeRestoreButton.ToolTip = maximized ? "Восстановить" : "Развернуть";
        AutomationProperties.SetName(
            MaximizeRestoreButton,
            maximized ? "Восстановить второе окно HUB" : "Развернуть второе окно HUB");
    }

    private void SendDesktopWindowForegroundState()
    {
        var foreground = IsVisible && WindowState != WindowState.Minimized && IsActive;
        ApplyWebViewMemoryUsageTarget();
        _desktopBridge?.TrySetWindowForeground(foreground);
    }

    private void ApplyWebViewMemoryUsageTarget(CoreWebView2? core = null)
    {
        core ??= _webView?.CoreWebView2;
        if (core is null)
        {
            return;
        }

        var target = DesktopWebViewMemoryPolicy.ResolveTargetLevel(
            IsVisible,
            WindowState == WindowState.Minimized,
            IsActive);
        if (_memoryUsageTargetLevel == target)
        {
            return;
        }

        try
        {
            core.MemoryUsageTargetLevel = target;
            _memoryUsageTargetLevel = target;
        }
        catch (Exception exception) when (
            exception is NotImplementedException
            or System.Runtime.InteropServices.COMException)
        {
            DesktopLog.Warning(
                $"Secondary WebView2 memory target is unavailable; exception={exception.GetType().Name}");
        }
    }

    private void ApplyChromeTheme(DesktopThemeMode mode)
    {
        var dark = mode == DesktopThemeMode.Dark;
        SetColorResource("AppBackgroundBrush", dark ? "#0F1115" : "#F3F2F1");
        SetColorResource("TitleBarBackgroundBrush", dark ? "#11151B" : "#FAF9F8");
        SetColorResource("TitleBarForegroundBrush", dark ? "#F3F2F1" : "#201F1E");
        SetColorResource("TitleBarBorderBrush", dark ? "#292D34" : "#E1DFDD");
        SetColorResource("SecondaryTextBrush", dark ? "#A19F9D" : "#605E5C");
        SetColorResource("TitleButtonHoverBrush", dark ? "#252A31" : "#EDEBE9");
        SetColorResource("TitleButtonPressedBrush", dark ? "#303640" : "#E1DFDD");
    }

    private void SetColorResource(string key, string color)
    {
        Resources[key] = new SolidColorBrush(
            (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(color));
    }

    private bool PrintCurrentPage() =>
        _printing.TryPrintCurrent(_webView?.CoreWebView2, _options.BaseUri);

    private void OpenExternalUri(string rawUri)
    {
        var result = _externalUriLauncher.Open(rawUri);
        if (result.Status == ExternalUriLaunchStatus.Opened)
        {
            return;
        }

        if (result.Status == ExternalUriLaunchStatus.Blocked)
        {
            DesktopLog.Warning(
                $"Rejected secondary external URI scheme '{result.Scheme}' after policy evaluation");
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

    private void OpenCurrentPageInBrowser()
    {
        if (!DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                _options.BaseUri,
                _webView?.CoreWebView2?.Source,
                out var route))
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(new Uri(_options.BaseUri, route).AbsoluteUri)
            {
                UseShellExecute = true,
            });
        }
        catch (Exception exception)
        {
            DesktopLog.Error("System browser failed to open the secondary HUB page", exception);
        }
    }

    private void SaveLastSafeRoute(string? candidateUrl)
    {
        if (DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                _options.BaseUri,
                candidateUrl,
                out var route))
        {
            _lastSafeRoute = route;
        }
    }

    private async Task RecoverWebViewAsync(WebViewFailureKind failure)
    {
        if (_recoveryInProgress || _shutdown.IsCancellationRequested)
        {
            return;
        }

        _recoveryInProgress = true;
        try
        {
            var currentFailure = failure;
            while (!_shutdown.IsCancellationRequested)
            {
                var decision = _webViewRecovery.Next(currentFailure);
                _requiresReset = currentFailure is not
                    WebViewFailureKind.Network
                    and not WebViewFailureKind.NavigationTimeout
                    and not WebViewFailureKind.Certificate;
                if (decision.Action == WebViewRecoveryAction.ShowManualRetry)
                {
                    ShowRecoveryError(currentFailure);
                    return;
                }

                RetryButton.IsEnabled = false;
                ShowError(
                    "Восстанавливаем HUB",
                    "Выполняется автоматическая попытка восстановления.");
                if (decision.Delay > TimeSpan.Zero)
                {
                    await Task.Delay(decision.Delay, _shutdown.Token);
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
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            // Normal secondary-window shutdown.
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
        var core = _webView?.CoreWebView2;
        if (core is null)
        {
            _requiresReset = true;
            ShowRecoveryError(WebViewFailureKind.Initialization);
            return;
        }

        HideError();
        ShowLoading();
        var target = DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
            _options.BaseUri,
            core.Source,
            out var route)
                ? new Uri(_options.BaseUri, route)
                : DesktopBridgeProtocol.IsValidInternalRoute(_lastSafeRoute)
                    ? new Uri(_options.BaseUri, _lastSafeRoute)
                    : _options.BaseUri;
        core.Navigate(target.AbsoluteUri);
    }

    private void StartNavigationTimeout()
    {
        CancelNavigationTimeout();
        var timeout = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token);
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
            await RecoverWebViewAsync(WebViewFailureKind.NavigationTimeout);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested)
        {
            // Navigation completed or the window closed.
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
                _shutdown.Token);
            if (!reloaded)
            {
                LoadingIndicator.Visibility = Visibility.Collapsed;
            }
        }
        catch (OperationCanceledException)
        {
            // Secondary window is shutting down.
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
        await _globalActions.ShowDiagnosticsAsync();

    private void ErrorBrowserButton_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            Process.Start(new ProcessStartInfo(_options.BaseUri.AbsoluteUri)
            {
                UseShellExecute = true,
            });
        }
        catch (Exception exception)
        {
            DesktopLog.Error("System browser failed to open HUB", exception);
        }
    }

    private void ShowLoading() => LoadingIndicator.Visibility = Visibility.Visible;

    private void ShowError(string title, string details)
    {
        LoadingIndicator.Visibility = Visibility.Collapsed;
        ErrorTitle.Text = title;
        ErrorDetails.Text = details;
        ErrorOverlay.Visibility = Visibility.Visible;
    }

    private void HideError() => ErrorOverlay.Visibility = Visibility.Collapsed;

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
        _desktopBridge.Dispose();
        _desktopBridge = null;
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        _windowManager.WindowAvailabilityChanged -= WindowManager_WindowAvailabilityChanged;
        _downloads.Changed -= Downloads_Changed;
        _downloadFailureTimer.Stop();
        _downloadFailureTimer.Tick -= DownloadFailureTimer_Tick;
        CancelNavigationTimeout();
        _shutdown.Cancel();
        _windowSource?.RemoveHook(WindowMessageHook);
        _windowSource = null;
        DisposeDesktopBridge();
        _webViewHost.Dispose();
        _webView = null;
        _shutdown.Dispose();
        DesktopLog.Info("Secondary HUB window closed");
    }
}
