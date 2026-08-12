using System.Windows;
using System.Windows.Input;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Views;

public partial class DesktopSettingsWindow : Window
{
    private readonly DesktopSettings _original;
    private readonly Func<DesktopSettings, string?> _trySave;

    public DesktopSettingsWindow(
        DesktopSettings settings,
        Func<DesktopSettings, string?> trySave)
    {
        _original = settings ?? throw new ArgumentNullException(nameof(settings));
        _trySave = trySave ?? throw new ArgumentNullException(nameof(trySave));
        InitializeComponent();
        LaunchHiddenRadio.IsChecked = settings.LaunchVisibility == DesktopLaunchVisibility.Hidden;
        LaunchOpenRadio.IsChecked = settings.LaunchVisibility == DesktopLaunchVisibility.OpenWindow;
        StartHomeRadio.IsChecked = settings.StartupPage == DesktopStartupPage.Home;
        StartLastRadio.IsChecked = settings.StartupPage == DesktopStartupPage.LastSafePage;
        AskOnCloseCheck.IsChecked = settings.CloseBehavior == DesktopCloseBehavior.AskOnce;
        GlobalHotkeyCheck.IsChecked = settings.GlobalHotkeyEnabled;
        Loaded += (_, _) => LaunchHiddenRadio.Focus();
    }

    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        var candidate = _original with
        {
            LaunchVisibility = LaunchOpenRadio.IsChecked == true
                ? DesktopLaunchVisibility.OpenWindow
                : DesktopLaunchVisibility.Hidden,
            StartupPage = StartLastRadio.IsChecked == true
                ? DesktopStartupPage.LastSafePage
                : DesktopStartupPage.Home,
            CloseBehavior = AskOnCloseCheck.IsChecked == true
                ? DesktopCloseBehavior.AskOnce
                : DesktopCloseBehavior.AlwaysHide,
            GlobalHotkeyEnabled = GlobalHotkeyCheck.IsChecked == true,
        };
        var error = _trySave(candidate);
        if (!string.IsNullOrWhiteSpace(error))
        {
            ValidationText.Text = error;
            ValidationText.Visibility = Visibility.Visible;
            ValidationText.Focus();
            return;
        }

        DialogResult = true;
        Close();
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        e.Handled = true;
        Close();
    }
}
