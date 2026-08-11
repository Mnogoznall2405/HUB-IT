using System.Diagnostics;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Security;

namespace Hub.Desktop;

public partial class MainWindow : Window
{
    private readonly DesktopOptions _options;
    private readonly NavigationPolicy _navigationPolicy;
    private WebView2? _webView;
    private bool _initializing;
    private bool _requiresReset;

    public MainWindow(DesktopOptions options)
    {
        _options = options;
        _navigationPolicy = new NavigationPolicy(options.BaseUri);
        InitializeComponent();
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
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
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.Settings.IsBuiltInErrorPageEnabled = false;
        core.Settings.IsStatusBarEnabled = false;

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
    }

    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        var decision = _navigationPolicy.Evaluate(e.Uri);

        if (decision == NavigationDisposition.TrustedOrigin)
        {
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

    private void Window_Closed(object? sender, EventArgs e)
    {
        _webView?.Dispose();
    }
}
