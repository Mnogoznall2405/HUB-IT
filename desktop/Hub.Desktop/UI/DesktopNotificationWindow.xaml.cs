using System.Windows;
using System.Windows.Automation;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Interop;
using Hub.Desktop.Notifications;

namespace Hub.Desktop.UI;

public partial class DesktopNotificationWindow : Window
{
    private string? _route;

    public event EventHandler<string>? OpenRequested;

    public DesktopNotificationWindow()
    {
        InitializeComponent();
    }

    public void ShowNotification(DesktopNotificationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        _route = request.Route;
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
    }

    public void ApplyTheme(DesktopThemeMode mode)
    {
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
        _route = null;
        Hide();
        e.Handled = true;
    }

    private void OpenCurrentRoute()
    {
        var route = _route;
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
