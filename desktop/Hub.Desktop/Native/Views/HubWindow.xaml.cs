using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Notifications;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Шелл нативного клиента: bearer-сессия (как у mobile-клиента), левая навигация
/// («Главная», «Мои задачи») и страницы внутри одного окна.
/// </summary>
public partial class HubWindow : Window
{
    private readonly HubShellViewModel _viewModel;
    private readonly IDesktopNotificationService? _notifications;
    private string? _pendingPage;
    private string? _pendingConversationId;

    public HubWindow(IHubApiClient api, IDesktopNotificationService? notifications = null)
    {
        ArgumentNullException.ThrowIfNull(api);
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        _notifications = notifications;
        _viewModel = new HubShellViewModel(api);
        DataContext = _viewModel;
        _viewModel.Chat.NotificationRequested += Chat_NotificationRequested;
        _viewModel.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(HubShellViewModel.IsReady))
            {
                ApplyPendingPage();
            }
        };
    }

    internal HubShellViewModel ViewModel => _viewModel;

    /// <summary>
    /// Windows 11 chrome: округлённые углы + Mica-бэкдроп (DWMWA_*).
    /// На старых ОС или при ошибке DWM остаётся сплошная заливка HubBackgroundBrush.
    /// </summary>
    protected override void OnSourceInitialized(EventArgs e)
    {
        base.OnSourceInitialized(e);
        var handle = new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero || !IsWindows11OrNewer())
        {
            return;
        }

        var corner = 2; // DWMWCP_ROUND
        _ = DwmSetWindowAttribute(handle, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref corner, sizeof(int));

        var backdrop = 2; // DWMSBT_MAINWINDOW (Mica)
        if (DwmSetWindowAttribute(handle, 38 /* DWMWA_SYSTEMBACKDROP_TYPE */, ref backdrop, sizeof(int)) != 0)
        {
            return;
        }

        if (!TryExtendMica(handle))
        {
            return;
        }

        _micaApplied = true;
        _hwnd = handle;
        Background = System.Windows.Media.Brushes.Transparent;
        WindowEdgeBorder.BorderThickness = new Thickness(0);
        NativeThemeManager.EffectiveThemeChanged += NativeThemeManager_EffectiveThemeChanged;
        ApplyImmersiveDarkMode();

        // WindowChrome при WM_DWMCOMPOSITIONCHANGED/DPI переприменяет
        // GlassFrameThickness=0 и стирает margins -1 → окно чернеет.
        // Повторяем расширение кадра после таких событий.
        HwndSource.FromHwnd(handle)?.AddHook(DwmEventHook);
    }

    /// <summary>
    /// Рамка и Mica-бэкдроп в светлой/тёмной вариации по эффективной теме
    /// нативного шелла (DWMWA_USE_IMMERSIVE_DARK_MODE).
    /// </summary>
    private void ApplyImmersiveDarkMode()
    {
        var handle = _hwnd != IntPtr.Zero ? _hwnd : new WindowInteropHelper(this).Handle;
        if (handle == IntPtr.Zero)
        {
            return;
        }

        var dark = NativeThemeManager.EffectiveMode == "dark" ? 1 : 0;
        _ = DwmSetWindowAttribute(handle, 20 /* DWMWA_USE_IMMERSIVE_DARK_MODE */, ref dark, sizeof(int));
    }

    private void NativeThemeManager_EffectiveThemeChanged(object? sender, EventArgs e) =>
        ApplyImmersiveDarkMode();

    private bool _micaApplied;
    private IntPtr _hwnd;

    private static bool TryExtendMica(IntPtr handle)
    {
        var margins = new MARGINS { Left = -1, Right = -1, Top = -1, Bottom = -1 };
        return DwmExtendFrameIntoClientArea(handle, ref margins) == 0;
    }

    private IntPtr DwmEventHook(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        const int WM_DWMCOMPOSITIONCHANGED = 0x031E;
        const int WM_DPICHANGED = 0x02E0;
        if (_micaApplied && (msg == WM_DWMCOMPOSITIONCHANGED || msg == WM_DPICHANGED))
        {
            _ = TryExtendMica(_hwnd);
        }

        return IntPtr.Zero;
    }

    private static bool IsWindows11OrNewer() =>
        Environment.OSVersion.Version >= new Version(10, 0, 22000);

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmSetWindowAttribute(
        IntPtr hwnd,
        int attribute,
        ref int value,
        int valueSize);

    [DllImport("dwmapi.dll", PreserveSig = true)]
    private static extern int DwmExtendFrameIntoClientArea(IntPtr hwnd, ref MARGINS margins);

    [StructLayout(LayoutKind.Sequential)]
    private struct MARGINS
    {
        public int Left;
        public int Right;
        public int Top;
        public int Bottom;
    }

    /// <summary>
    /// Deep link на нативную страницу: маршрут маппится на страницу шелла;
    /// неизвестные разделы (почта и пр.) игнорируются — их открывает web-шелл.
    /// </summary>
    public void NavigateToRoute(string? route)
    {
        _pendingPage = HubShellViewModel.TryMapWebRoute(route);
        _pendingConversationId = _pendingPage == "chat"
            ? TryGetQueryValue(route, "conversation")
            : null;
        ApplyPendingPage();
    }

    private void ApplyPendingPage()
    {
        if (_pendingPage is null || !_viewModel.IsReady)
        {
            return;
        }

        _viewModel.NavigateToPageCommand.Execute(_pendingPage);
        _pendingPage = null;
        if (_pendingConversationId is { } conversationId)
        {
            _pendingConversationId = null;
            _ = _viewModel.Chat.SelectConversationByIdAsync(conversationId);
        }
    }

    /// <summary>Значение query-параметра маршрута вида «/chat?conversation=7&message=1».</summary>
    private static string? TryGetQueryValue(string? route, string name)
    {
        if (string.IsNullOrWhiteSpace(route))
        {
            return null;
        }

        var queryIndex = route.IndexOf('?');
        if (queryIndex < 0)
        {
            return null;
        }

        var query = route[(queryIndex + 1)..];
        var fragmentIndex = query.IndexOf('#');
        if (fragmentIndex >= 0)
        {
            query = query[..fragmentIndex];
        }

        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separator = pair.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = Uri.UnescapeDataString(pair[..separator].Replace('+', ' '));
            if (!key.Equals(name, StringComparison.Ordinal))
            {
                continue;
            }

            var value = Uri.UnescapeDataString(pair[(separator + 1)..].Replace('+', ' ')).Trim();
            return value.Length == 0 || value.Any(char.IsControl) ? null : value;
        }

        return null;
    }

    /// <summary>
    /// Toast о входящем сообщении: подавляем, когда пользователь уже смотрит
    /// на этот диалог в активном окне; остальное решает политика сервиса
    /// (quiet mode, скрытие контента при блокировке).
    /// </summary>
    private void Chat_NotificationRequested(object? sender, ChatMessageNotification notification)
    {
        if (IsActive && notification.IsSelectedConversation)
        {
            return;
        }

        var route = "/chat?conversation=" + Uri.EscapeDataString(notification.ConversationId);
        if (!string.IsNullOrEmpty(notification.MessageId))
        {
            route += "&message=" + Uri.EscapeDataString(notification.MessageId);
        }

        // Дедуп по id сообщения; без id — уникальный, чтобы не схлопнуть разные события.
        var id = !string.IsNullOrEmpty(notification.MessageId)
            ? $"chat-msg:{notification.MessageId}"
            : $"chat-msg:{notification.ConversationId}:{Guid.NewGuid():N}";
        var body = notification.Body.Length > 200 ? notification.Body[..200] : notification.Body;
        try
        {
            _notifications?.TryShow(new DesktopNotificationRequest(
                id,
                notification.Title,
                body,
                route));
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Native chat notification could not be shown", exception);
        }
    }

    private async void Window_Loaded(object sender, RoutedEventArgs e)
    {
        await _viewModel.InitializeAsync();
        ApplyPendingPage();
        if (_viewModel.IsSignedOut)
        {
            UsernameInput.Focus();
        }
    }

    /// <summary>Закрытие окна останавливает realtime-цикл (reconnect живёт до выхода процесса иначе).</summary>
    protected override void OnClosed(EventArgs e)
    {
        NativeThemeManager.EffectiveThemeChanged -= NativeThemeManager_EffectiveThemeChanged;
        _viewModel.Chat.Reset();
        base.OnClosed(e);
    }

    private void MinimizeButton_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState.Minimized;

    private void MaximizeButton_Click(object sender, RoutedEventArgs e) =>
        WindowState = WindowState == WindowState.Maximized
            ? WindowState.Normal
            : WindowState.Maximized;

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void SignInButton_Click(object sender, RoutedEventArgs e) => SubmitSignIn();

    private void UsernameInput_KeyDown(object sender, KeyEventArgs e)
    {
        // Enter из логина переводит на пароль — стандартный сценарий формы входа.
        if (e.Key == Key.Enter)
        {
            PasswordInput.Focus();
            e.Handled = true;
        }
    }

    private void PasswordInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            SubmitSignIn();
            e.Handled = true;
        }
    }

    private void TwoFactorInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            SubmitSignIn();
            e.Handled = true;
        }
    }

    private void SubmitSignIn()
    {
        if (_viewModel.RequiresTwoFactor)
        {
            _viewModel.VerifyTwoFactorCommand.Execute(null);
        }
        else
        {
            _viewModel.SignInCommand.Execute(PasswordInput.Password);
        }
    }
}
