using System.ComponentModel;
using System.Diagnostics;
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
    private readonly DesktopWebViewHost _webViewHost;
    private readonly DesktopWindowPlacementService _placement = new();
    private readonly CancellationTokenSource _shutdown = new();
    private readonly string _route;
    private DesktopBridgeHost? _bridge;
    private bool _allowClose;
    private bool _closeRequestPending;
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

    public bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message) =>
        _bridge?.TryPostSystemLifecycle(message) == true;

    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        if (_sessionPlacement is not null)
        {
            _placement.TryApply(new WindowInteropHelper(this).Handle, _sessionPlacement, restoreMaximized: true);
        }
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var core = await _webViewHost.RecreateAsync(_shutdown.Token);
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
            _bridge = new DesktopBridgeHost(
                core,
                _navigationPolicy,
                _notifications,
                Environment.UserName,
                new DesktopVncHandlerProbe());
            _bridge.MailComposeWindowCloseResult += Bridge_MailComposeWindowCloseResult;
            _bridge.MailComposeWindowSent += Bridge_MailComposeWindowSent;
            core.Navigate(new Uri(_options.BaseUri, _route).AbsoluteUri);
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Mail compose WebView2 initialization failed", exception);
            LoadingText.Text = "Редактор недоступен. Закройте окно и повторите попытку.";
        }
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        if (_navigationPolicy.Evaluate(e.Uri) != NavigationDisposition.TrustedOrigin
            || !Uri.TryCreate(e.Uri, UriKind.Absolute, out var target)
            || !string.IsNullOrEmpty(target.Fragment)
            || !DesktopBridgeProtocol.IsValidMailComposeRoute(target.PathAndQuery))
        {
            e.Cancel = true;
        }
        _bridge?.ResetDocumentReady();
    }

    private void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        LoadingText.Visibility = e.IsSuccess ? Visibility.Collapsed : Visibility.Visible;
        if (!e.IsSuccess) LoadingText.Text = "Не удалось открыть редактор письма.";
    }

    private static void Core_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
        if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
            && uri.Scheme is "http" or "https")
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
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

    private void Bridge_MailComposeWindowSent(object? sender, EventArgs e)
    {
        _windowManager.NotifyMailComposeSent();
        _allowClose = true;
        Close();
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

    protected override void OnClosed(EventArgs e)
    {
        CapturePlacement();
        _shutdown.Cancel();
        if (_bridge is not null)
        {
            _bridge.MailComposeWindowCloseResult -= Bridge_MailComposeWindowCloseResult;
            _bridge.MailComposeWindowSent -= Bridge_MailComposeWindowSent;
            _bridge.Dispose();
            _bridge = null;
        }
        _webViewHost.Dispose();
        _shutdown.Dispose();
        base.OnClosed(e);
    }
}
