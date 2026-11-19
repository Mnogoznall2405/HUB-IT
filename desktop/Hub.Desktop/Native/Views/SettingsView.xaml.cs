using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Настройки»: внешний вид, каналы уведомлений, безопасность.
/// PasswordBox не поддерживает привязку — значения передаются в VM через
/// HubPasswordChangeInput из code-behind, поля очищаются после успешной смены.
/// </summary>
public partial class SettingsView : UserControl
{
    public SettingsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    private void PasswordBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            SubmitPasswordChange();
            e.Handled = true;
        }
    }

    private void SavePasswordButton_Click(object sender, RoutedEventArgs e) => SubmitPasswordChange();

    private async void SubmitPasswordChange()
    {
        if (DataContext is not SettingsViewModel viewModel || viewModel.IsPasswordBusy)
        {
            return;
        }

        var succeeded = await viewModel.SubmitPasswordChangeAsync(new HubPasswordChangeInput(
            OldPasswordBox.Password,
            NewPasswordBox.Password,
            ConfirmPasswordBox.Password));
        if (!succeeded)
        {
            return;
        }

        OldPasswordBox.Clear();
        NewPasswordBox.Clear();
        ConfirmPasswordBox.Clear();
        OldPasswordBox.Focus();
    }
}
