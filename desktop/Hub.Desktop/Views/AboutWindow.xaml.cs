using System.Windows;
using System.Windows.Input;
using Hub.Desktop.Autostart;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Updates;
using Hub.Desktop.ViewModels;

namespace Hub.Desktop.Views;

public partial class AboutWindow : Window
{
    private readonly DesktopUpdateCoordinator _updates;
    private readonly DesktopRuntimeSnapshot _runtime;
    private readonly IAutostartService _autostart;
    private readonly Func<bool>? _tryInstallUpdate;
    private readonly Func<Task<bool>>? _deferUpdate;
    private readonly bool _canDeferUpdate;

    public AboutWindow(
        DesktopUpdateCoordinator updates,
        DesktopRuntimeSnapshot runtime,
        IAutostartService autostart,
        Func<bool>? tryInstallUpdate = null,
        Func<Task<bool>>? deferUpdate = null,
        bool canDeferUpdate = true)
    {
        _updates = updates;
        _runtime = runtime;
        _autostart = autostart;
        _tryInstallUpdate = tryInstallUpdate;
        _deferUpdate = deferUpdate;
        _canDeferUpdate = canDeferUpdate;
        InitializeComponent();
        _updates.StateChanged += Updates_StateChanged;
        Render(_updates.Current);
        Loaded += (_, _) =>
        {
            if (CheckForUpdatesButton.IsEnabled)
            {
                CheckForUpdatesButton.Focus();
            }
            else
            {
                CloseWindowButton.Focus();
            }
        };
    }

    protected override void OnClosed(EventArgs e)
    {
        _updates.StateChanged -= Updates_StateChanged;
        base.OnClosed(e);
    }

    public void RefreshState() => Render(_updates.Current);

    private async void CheckForUpdatesButton_Click(object sender, RoutedEventArgs e)
    {
        DesktopLog.Info("Manual desktop update check requested");
        var started = await _updates.CheckNowAsync();
        DesktopLog.Info(started
            ? "Manual desktop update check completed"
            : "Manual desktop update check already in progress or disabled");
    }

    private void InstallUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        InstallUpdateButton.IsEnabled = false;
        DeferUpdateButton.IsEnabled = false;
        InstallUpdateButton.Content = "Запускаем установку…";
        if (_tryInstallUpdate?.Invoke() == true)
        {
            return;
        }

        InstallUpdateButton.Content = "Перезапустить и обновить";
        InstallUpdateButton.IsEnabled = true;
        DeferUpdateButton.IsEnabled = true;
    }

    private async void DeferUpdateButton_Click(object sender, RoutedEventArgs e)
    {
        DeferUpdateButton.IsEnabled = false;
        if (_deferUpdate is not null && await _deferUpdate())
        {
            Close();
            return;
        }

        DeferUpdateButton.IsEnabled = true;
    }

    private void CloseButton_Click(object sender, RoutedEventArgs e) => Close();

    private void Window_PreviewKeyDown(
        object sender,
        System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != Key.Escape)
        {
            return;
        }

        e.Handled = true;
        Close();
    }

    private void Updates_StateChanged(object? sender, DesktopUpdateState state)
    {
        if (!Dispatcher.CheckAccess())
        {
            Dispatcher.BeginInvoke(() => Render(state));
            return;
        }

        Render(state);
    }

    private void Render(DesktopUpdateState state)
    {
        var model = new AboutViewModel(_runtime, _autostart, state);
        DataContext = model;
        EmptyReleaseNotesText.Visibility = model.HasReleaseNotes
            ? Visibility.Collapsed
            : Visibility.Visible;
        ReleaseNotesList.Visibility = model.HasReleaseNotes
            ? Visibility.Visible
            : Visibility.Collapsed;
        CheckForUpdatesButton.Visibility = model.CanInstallUpdate
            ? Visibility.Collapsed
            : Visibility.Visible;
        InstallUpdateButton.Visibility = model.CanInstallUpdate
            ? Visibility.Visible
            : Visibility.Collapsed;
        DeferUpdateButton.Visibility = model.CanDeferUpdate && _canDeferUpdate
            ? Visibility.Visible
            : Visibility.Collapsed;
        InstallUpdateButton.Content = "Перезапустить и обновить";
        InstallUpdateButton.IsEnabled = model.CanInstallUpdate;
        DeferUpdateButton.IsEnabled = true;
    }
}
