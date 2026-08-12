using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Downloads;
using Hub.Desktop.Interop;

namespace Hub.Desktop.Views;

public partial class DownloadsWindow : Window
{
    public DownloadsWindow(DesktopDownloadCoordinator downloads)
    {
        ArgumentNullException.ThrowIfNull(downloads);
        InitializeComponent();
        DataContext = downloads;
        Loaded += (_, _) => FocusFirstActionOrWindow();
    }

    public event EventHandler<DesktopDownloadActionRequestedEventArgs>? OpenRequested;

    public event EventHandler<DesktopDownloadActionRequestedEventArgs>? RevealRequested;

    public event EventHandler<DesktopDownloadActionRequestedEventArgs>? CancelRequested;

    public event EventHandler? ClearFinishedRequested;

    public event EventHandler? OpenDownloadsFolderRequested;

    public void ApplyTheme(DesktopThemeMode mode)
    {
        var dark = mode == DesktopThemeMode.Dark;
        SetColorResource("WindowBackgroundBrush", dark ? "#0F1115" : "#F3F2F1");
        SetColorResource("TitleBarBrush", dark ? "#11151B" : "#FAF9F8");
        SetColorResource("SurfaceBrush", dark ? "#161B22" : "#FFFFFF");
        SetColorResource("BorderBrush", dark ? "#30363D" : "#D1D5DB");
        SetColorResource("PrimaryTextBrush", dark ? "#F3F2F1" : "#201F1E");
        SetColorResource("MutedTextBrush", dark ? "#A9B1BB" : "#605E5C");
        SetColorResource("AccentBrush", dark ? "#38BDF8" : "#0369A1");
        SetColorResource("FocusBrush", dark ? "#7DD3FC" : "#0369A1");
    }

    public void PresentActionResult(DesktopFileActionResult result)
    {
        var message = DesktopDownloadPresentation.GetActionMessage(result);
        ActionMessageText.Text = message;
        ActionMessagePanel.Visibility = string.IsNullOrEmpty(message)
            ? Visibility.Collapsed
            : Visibility.Visible;
    }

    private void OpenButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button { Tag: string itemId })
        {
            OpenRequested?.Invoke(this, new DesktopDownloadActionRequestedEventArgs(itemId));
        }
    }

    private void RevealButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button { Tag: string itemId })
        {
            RevealRequested?.Invoke(this, new DesktopDownloadActionRequestedEventArgs(itemId));
        }
    }

    private void CancelButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button { Tag: string itemId })
        {
            CancelRequested?.Invoke(this, new DesktopDownloadActionRequestedEventArgs(itemId));
        }
    }

    private void ClearFinishedButton_Click(object sender, RoutedEventArgs e) =>
        ClearFinishedRequested?.Invoke(this, EventArgs.Empty);

    private void OpenDownloadsFolderButton_Click(object sender, RoutedEventArgs e) =>
        OpenDownloadsFolderRequested?.Invoke(this, EventArgs.Empty);

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        e.Handled = true;
        Close();
    }

    private void FocusFirstActionOrWindow()
    {
        if (!MoveFocus(new TraversalRequest(FocusNavigationDirection.First)))
        {
            Focus();
        }
    }

    private void SetColorResource(string key, string color)
    {
        Resources[key] = new SolidColorBrush(
            (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(color));
    }
}

public sealed class DesktopDownloadActionRequestedEventArgs(string itemId) : EventArgs
{
    public string ItemId { get; } = itemId;
}
