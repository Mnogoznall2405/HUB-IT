using System.ComponentModel;
using System.Windows;
using System.Windows.Interop;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
using Hub.Desktop.Lifecycle;
using Hub.Desktop.Notifications;
using Hub.Desktop.Remote;
using Hub.Desktop.Security;
using Hub.Desktop.WebView;
using Hub.Desktop.Workspace;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Views;

public partial class MailComposeWindow : Window, IDesktopHubWindow
{
    private static DesktopWindowPlacement? _sessionPlacement;
    private readonly DesktopOptions _options;
    private readonly DesktopWindowManager _windowManager;
    private readonly IDesktopNotificationService _notifications;
    private readonly NavigationPolicy _navigationPolicy;
    private readonly ExternalUriLauncher _externalUriLauncher;
    private readonly DesktopWebViewHost _webViewHost;
    private readonly DesktopWindowPlacementService _placement = new();
    private readonly WebViewRecoveryPolicy _webViewRecovery = new();
    private readonly CancellationTokenSource _shutdown = new();
    private readonly string _route;
    private DesktopBridgeHost? _bridge;
    private CancellationTokenSource? _navigationTimeout;
    private CoreWebView2MemoryUsageTargetLevel? _memoryUsageTargetLevel;
    private bool _allowClose;
    private bool _closeRequestPending;
    private bool _initializing;
    private bool _recoveryInProgress;
    private string _closeRequestId = string.Empty;

    public MailComposeWindow(
        DesktopOptions options,
        IDesktopNotificationService notifications,
        DesktopWindowManager windowManager,
        DesktopWebViewEnvironmentProvider environmentProvider,
        Window owner,
        string route)
    {
        if (!DesktopBridgeProtocol.IsValidMailComposeRoute(route))
        {
            throw new ArgumentException("A safe mail compose route is required.", nameof(route));
        }
        _options = options ?? throw new ArgumentNullException(nameof(options));
        _notifications = notifications ?? throw new ArgumentNullException(nameof(notifications));
        _windowManager = windowManager ?? throw new ArgumentNullException(nameof(windowManager));
        _route = route;
        _navigationPolicy = new NavigationPolicy(options.BaseUri);
        _externalUriLauncher = new ExternalUriLauncher(_navigationPolicy);
        InitializeComponent();
        Owner = owner ?? throw new ArgumentNullException(nameof(owner));
        _webViewHost = new DesktopWebViewHost(
            BrowserHost,
            environmentProvider ?? throw new ArgumentNullException(nameof(environmentProvider)));
    }

    public string? CurrentSource => _webViewHost.View?.CoreWebView2?.Source;

    public void ShowAndActivate()
    {
        if (!IsVisible) Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
        SendDesktopWindowForegroundState();
    }

    public void ShowAndNavigate(string? route)
    {
        ShowAndActivate();
        if (DesktopBridgeProtocol.IsValidMailComposeRoute(route))
        {
            _webViewHost.View?.CoreWebView2?.Navigate(new Uri(_options.BaseUri, route).AbsoluteUri);
        }
    }

    public void ReloadWithoutCache() => _webViewHost.View?.CoreWebView2?.Reload();

    public bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (!Dispatcher.CheckAccess())
        {
            return Dispatcher.Invoke(() => TryDeliverSystemLifecycle(message));
        }

        return _bridge?.TryPostSystemLifecycle(message) == true;
    }

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        if (_sessionPlacement is not null)
        {
            _placement.TryApply(new WindowInteropHelper(this).Handle, _sessionPlacement, restoreMaximized: true);
        }
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
        if (_initializing || _shutdown.IsCancellationRequested)
        {
            return null;
        }

        _initializing = true;
        ShowEditorStatus("Открываем редактор письма…", canRetry: false);
        try
        {
            CancelNavigationTimeout();
            DisposeBridge();
            var core = await _webViewHost.RecreateAsync(_shutdown.Token);
            _memoryUsageTargetLevel = null;
            ConfigureWebView(core);
            core.Navigate(new Uri(_options.BaseUri, _route).AbsoluteUri);
            return null;
        }
        catch (WebView2RuntimeNotFoundException exception)
        {
            DesktopLog.Error("WebView2 Runtime is unavailable for the mail compose window", exception);
            return WebViewFailureKind.RuntimeUnavailable;
        }
        catch (OperationCanceledException) when (_shutdown.IsCancellationRequested)
        {
            return null;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Mail compose WebView2 initialization failed", exception);
            return WebViewFailureKind.Initialization;
        }
        finally
        {
            _initializing = false;
        }
    }

    private void ConfigureWebView(CoreWebView2 core)
    {
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsWebMessageEnabled = true;
#if DEBUG
        core.Settings.AreDevToolsEnabled = true;
#else
        core.Settings.AreDevToolsEnabled = false;
#endif
        core.NavigationStarting += Core_NavigationStarting;
        core.NavigationCompleted += Core_NavigationCompleted;
        core.NewWindowRequested += Core_NewWindowRequested;
        core.ProcessFailed += Core_ProcessFailed;
        _bridge = new DesktopBridgeHost(
            core,
            _navigationPolicy,
            _notifications,
            Environment.UserName,
            new DesktopVncHandlerProbe());
        _bridge.Ready += Bridge_Ready;
        _bridge.MailComposeWindowCloseResult += Bridge_MailComposeWindowCloseResult;
        _bridge.MailComposeWindowSent += Bridge_MailComposeWindowSent;
        ApplyWebViewMemoryUsageTarget(core);
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var allowed = _navigationPolicy.Evaluate(e.Uri) == NavigationDisposition.TrustedOrigin
            && Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)
            && string.IsNullOrEmpty(target.Fragment)
            && DesktopBridgeProtocol.IsValidMailComposeRoute(target.PathAndQuery);
        if (!allowed)
        {
            e.Cancel = true;
            return;
        }

        ShowEditorStatus("Открываем редактор письма…", canRetry: false);
        _bridge?.ResetDocumentReady();
        StartNavigationTimeout();
    }

    private async void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        CancelNavigationTimeout();
        if (e.IsSuccess)
        {
            LoadingPanel.Visibility = Visibility.Collapsed;
            return;
        }

        var status = e.WebErrorStatus.ToString();
        DesktopLog.Warning($"Mail compose navigation failed with status '{status}'");
        await RecoverWebViewAsync(
            status.Equals("Timeout", StringComparison.OrdinalIgnoreCase)
                ? WebViewFailureKind.NavigationTimeout
                : WebViewFailureKind.Network);
    }

    private async void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        CancelNavigationTimeout();
        DesktopLog.Warning($"Mail compose WebView2 process failed: {e.ProcessFailedKind}");
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
                DesktopLog.Warning(
                    $"Mail compose WebView2 recovery; failure={currentFailure}; " +
                    $"action={decision.Action}; attempt={decision.Attempt}");
                if (decision.Action == WebViewRecoveryAction.ShowManualRetry)
                {
                    ShowRecoveryError(currentFailure);
                    return;
                }

                ShowEditorStatus(
                    decision.Delay > TimeSpan.Zero
                        ? "Редактор письма временно недоступен. Повторяем подключение…"
                        : "Восстанавливаем редактор письма…",
                    canRetry: false);
                if (decision.Delay > TimeSpan.Zero)
                {
                    await Task.Delay(decision.Delay, _shutdown.Token);
                }

                if (decision.Action == WebViewRecoveryAction.Reload
                    && _webViewHost.View?.CoreWebView2 is { } core)
                {
                    core.Reload();
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
            // Normal window shutdown.
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Mail compose WebView2 recovery failed", exception);
            ShowRecoveryError(failure);
        }
        finally
        {
            _recoveryInProgress = false;
        }
    }

    private void ShowRecoveryError(WebViewFailureKind failure)
    {
        var message = failure switch
        {
            WebViewFailureKind.RuntimeUnavailable =>
                "Не установлен Microsoft Edge WebView2 Runtime.",
            WebViewFailureKind.Network or WebViewFailureKind.NavigationTimeout =>
                "Не удалось подключиться к HUB. Проверьте корпоративную сеть и повторите попытку.",
            _ => "Редактор письма остановлен. Повторите открытие, чтобы восстановить черновик.",
        };
        ShowEditorStatus(message, canRetry: true);
    }

    private void ShowEditorStatus(string message, bool canRetry)
    {
        LoadingText.Text = message;
        LoadingPanel.Visibility = Visibility.Visible;
        RetryButton.Visibility = canRetry ? Visibility.Visible : Visibility.Collapsed;
        RetryButton.IsEnabled = canRetry;
        if (canRetry && IsActive)
        {
            RetryButton.Focus();
        }
    }

    private async void RetryButton_Click(object sender, RoutedEventArgs e)
    {
        if (_initializing || _recoveryInProgress)
        {
            return;
        }

        await CreateWebViewAsync();
    }

    private void Core_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (_navigationPolicy.Evaluate(e.Uri) == NavigationDisposition.TrustedOrigin
            && DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
                _options.BaseUri,
                e.Uri,
                out var route))
        {
            _windowManager.ActivateLastOrPrimary(route);
            return;
        }

        var result = _externalUriLauncher.Open(e.Uri);
        if (result.Status == ExternalUriLaunchStatus.Opened)
        {
            DesktopLog.Info($"Opened mail compose external URI scheme '{result.Scheme}' in the system handler");
            return;
        }

        if (result.Status == ExternalUriLaunchStatus.Blocked)
        {
            DesktopLog.Warning($"Blocked mail compose external URI scheme '{result.Scheme}'");
        }
        else
        {
            DesktopLog.Error(
                "Mail compose system handler failed to open an external URI",
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

    private void Window_Closing(object? sender, CancelEventArgs e)
    {
        if (_allowClose)
        {
            CapturePlacement();
            return;
        }
        e.Cancel = true;
        if (_closeRequestPending) return;
        var requestId = Guid.NewGuid().ToString("N");
        if (_bridge?.TryRequestMailComposeWindowClose(requestId) == true)
        {
            _closeRequestId = requestId;
            _closeRequestPending = true;
            return;
        }
        var forceClose = System.Windows.MessageBox.Show(
            this,
            "Не удалось запросить сохранение черновика. Закрыть окно без подтверждения сохранения?",
            "HUB Desktop",
            MessageBoxButton.YesNo,
            MessageBoxImage.Warning) == MessageBoxResult.Yes;
        if (forceClose)
        {
            _allowClose = true;
            Close();
        }
    }

    private void Bridge_MailComposeWindowCloseResult(object? sender, DesktopMailComposeWindowCloseResultEventArgs e)
    {
        if (!_closeRequestPending || !string.Equals(e.RequestId, _closeRequestId, StringComparison.Ordinal)) return;
        _closeRequestPending = false;
        _closeRequestId = string.Empty;
        if (!e.Saved) return;
        _allowClose = true;
        Close();
    }

    private void Bridge_Ready(object? sender, EventArgs e)
    {
        SendDesktopWindowForegroundState();
        _windowManager.NotifyBridgeReady(this);
    }

    private void Bridge_MailComposeWindowSent(object? sender, EventArgs e)
    {
        _windowManager.NotifyMailComposeSent();
        _allowClose = true;
        Close();
    }

    private void Window_StateChanged(object? sender, EventArgs e) =>
        SendDesktopWindowForegroundState();

    private void Window_Activated(object? sender, EventArgs e) =>
        SendDesktopWindowForegroundState();

    private void Window_Deactivated(object? sender, EventArgs e) =>
        SendDesktopWindowForegroundState();

    private void SendDesktopWindowForegroundState()
    {
        var foreground = IsVisible && WindowState != WindowState.Minimized && IsActive;
        ApplyWebViewMemoryUsageTarget();
        _bridge?.TrySetWindowForeground(foreground);
    }

    private void ApplyWebViewMemoryUsageTarget(CoreWebView2? core = null)
    {
        core ??= _webViewHost.View?.CoreWebView2;
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
                $"Mail compose WebView2 memory target is unavailable; exception={exception.GetType().Name}");
        }
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

            _webViewHost.View?.CoreWebView2?.Stop();
            DesktopLog.Warning("Mail compose WebView2 navigation timed out");
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

    private void CapturePlacement()
    {
        var captured = _placement.TryCapture(
            new WindowInteropHelper(this).Handle,
            maximized: WindowState == WindowState.Maximized);
        if (captured is not null)
        {
            _sessionPlacement = captured;
        }
    }

    private void DisposeBridge()
    {
        if (_bridge is null)
        {
            return;
        }

        _bridge.Ready -= Bridge_Ready;
        _bridge.MailComposeWindowCloseResult -= Bridge_MailComposeWindowCloseResult;
        _bridge.MailComposeWindowSent -= Bridge_MailComposeWindowSent;
        _bridge.Dispose();
        _bridge = null;
    }

    protected override void OnClosed(EventArgs e)
    {
        CapturePlacement();
        CancelNavigationTimeout();
        _shutdown.Cancel();
        DisposeBridge();
        _webViewHost.Dispose();
        _shutdown.Dispose();
        base.OnClosed(e);
    }
}
