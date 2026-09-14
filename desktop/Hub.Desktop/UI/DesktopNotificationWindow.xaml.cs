using System.Windows;
using System.Windows.Automation;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using Hub.Desktop.Interop;
using Hub.Desktop.Notifications;

namespace Hub.Desktop.UI;

public partial class DesktopNotificationWindow : Window
{
    private static readonly TimeSpan AutoDismissDelay = TimeSpan.FromSeconds(7);
    private static readonly TimeSpan EnterAnimationDuration = TimeSpan.FromMilliseconds(180);
    private static readonly TimeSpan ExitAnimationDuration = TimeSpan.FromMilliseconds(120);

    private readonly DispatcherTimer _autoDismissTimer;
    private string? _route;
    private bool _reducedMotion;
    private bool _closing;

    public event EventHandler<string>? OpenRequested;

    public DesktopNotificationWindow()
    {
        InitializeComponent();
        _autoDismissTimer = new DispatcherTimer(DispatcherPriority.Background, Dispatcher)
        {
            Interval = AutoDismissDelay,
        };
        _autoDismissTimer.Tick += (_, _) => DismissWithAnimation();
    }

    public void ShowNotification(DesktopNotificationRequest request, bool reducedMotion = false)
    {
        ArgumentNullException.ThrowIfNull(request);
        _route = request.Route;
        _reducedMotion = reducedMotion;
        _closing = false;
        NotificationTitle.Text = request.Title;
        NotificationBody.Text = request.Body;
        var actionLabel = DesktopNotificationPresentation.GetPrimaryActionLabel(request.Route);
        PrimaryActionButton.Content = actionLabel;
        AutomationProperties.SetName(
            PrimaryActionButton,
            $"{actionLabel}: {request.Title}");
        AutomationProperties.SetName(
            NotificationSurface,
            $"HUB Desktop. {request.Title}. {request.Body}. Действие: {actionLabel}");

        if (!IsVisible)
        {
            Show();
        }

        UpdateLayout();
        PositionAtWorkAreaBottomRight();
        Topmost = false;
        Topmost = true;
        _autoDismissTimer.Stop();
        _autoDismissTimer.Start();
        PlayEnterAnimation();
    }

    public void ApplyTheme(DesktopThemeMode mode)
    {
        if (mode == DesktopThemeMode.HighContrast)
        {
            SetColorResource("NotificationSurfaceBrush", System.Windows.SystemColors.WindowColor.ToString());
            SetColorResource("NotificationBorderBrush", System.Windows.SystemColors.ActiveBorderColor.ToString());
            SetColorResource("NotificationTitleBrush", System.Windows.SystemColors.WindowTextColor.ToString());
            SetColorResource("NotificationBodyBrush", System.Windows.SystemColors.GrayTextColor.ToString());
            SetColorResource("NotificationMutedBrush", System.Windows.SystemColors.GrayTextColor.ToString());
            SetColorResource("NotificationHoverBrush", System.Windows.SystemColors.HighlightColor.ToString());
            SetColorResource("NotificationAccentBrush", System.Windows.SystemColors.HighlightColor.ToString());
            SetColorResource("NotificationActionHoverBrush", System.Windows.SystemColors.HighlightColor.ToString());
            return;
        }

        var isDark = mode == DesktopThemeMode.Dark;
        SetColorResource("NotificationSurfaceBrush", isDark ? "#171B22" : "#FFFFFF");
        SetColorResource("NotificationBorderBrush", isDark ? "#303640" : "#E1DFDD");
        SetColorResource("NotificationTitleBrush", isDark ? "#F3F2F1" : "#201F1E");
        SetColorResource("NotificationBodyBrush", isDark ? "#C8C6C4" : "#3B3A39");
        SetColorResource("NotificationMutedBrush", isDark ? "#A19F9D" : "#605E5C");
        SetColorResource("NotificationHoverBrush", isDark ? "#252A31" : "#F3F2F1");
        SetColorResource("NotificationAccentBrush", isDark ? "#4CC2FF" : "#0067C0");
        SetColorResource("NotificationActionHoverBrush", isDark ? "#1C3444" : "#E5F3FF");
    }

    private void PositionAtWorkAreaBottomRight()
    {
        var workArea = SystemParameters.WorkArea;
        Left = Math.Max(workArea.Left + 12, workArea.Right - ActualWidth - 16);
        Top = Math.Max(workArea.Top + 12, workArea.Bottom - ActualHeight - 16);
    }

    private void NotificationSurface_MouseEnter(object sender, System.Windows.Input.MouseEventArgs e) =>
        _autoDismissTimer.Stop();

    private void NotificationSurface_MouseLeave(object sender, System.Windows.Input.MouseEventArgs e)
    {
        if (IsVisible && !_closing)
        {
            _autoDismissTimer.Stop();
            _autoDismissTimer.Start();
        }
    }

    private void NotificationSurface_MouseRightButtonUp(object sender, MouseButtonEventArgs e)
    {
        DismissWithAnimation();
        e.Handled = true;
    }

    private void NotificationSurface_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        OpenCurrentRoute();
        e.Handled = true;
    }

    private void PrimaryActionButton_Click(object sender, RoutedEventArgs e)
    {
        OpenCurrentRoute();
        e.Handled = true;
    }

    private void DismissButton_Click(object sender, RoutedEventArgs e)
    {
        DismissWithAnimation();
        e.Handled = true;
    }

    private void DismissWithAnimation()
    {
        _route = null;
        _autoDismissTimer.Stop();
        if (_closing)
        {
            return;
        }

        if (_reducedMotion || !IsVisible)
        {
            Hide();
            return;
        }

        _closing = true;
        var fadeOut = new DoubleAnimation(Opacity, 0, ExitAnimationDuration)
        {
            EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
        };
        fadeOut.Completed += (_, _) =>
        {
            _closing = false;
            Hide();
            Opacity = 1;
        };
        BeginAnimation(OpacityProperty, fadeOut);
    }

    private void PlayEnterAnimation()
    {
        if (_reducedMotion)
        {
            Opacity = 1;
            NotificationSurfaceTranslate.X = 0;
            return;
        }

        var fadeIn = new DoubleAnimation(0, 1, EnterAnimationDuration)
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        var slideIn = new DoubleAnimation(24, 0, EnterAnimationDuration)
        {
            EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut },
        };
        BeginAnimation(OpacityProperty, fadeIn);
        NotificationSurfaceTranslate.BeginAnimation(TranslateTransform.XProperty, slideIn);
    }

    private void OpenCurrentRoute()
    {
        var route = _route;
        _route = null;
        _autoDismissTimer.Stop();
        Hide();
        if (DesktopBridgeProtocol.IsValidInternalRoute(route))
        {
            OpenRequested?.Invoke(this, route);
        }
    }

    private void SetColorResource(string key, string color)
    {
        Resources[key] = new SolidColorBrush(
            (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(color));
    }
}
