using Hub.Desktop.Native.ViewModels;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Документооборот 1С»: scope-табы, список заданий, карточка и действия.
/// PasswordBox не поддерживает привязку — пароль передаётся в VM аргументом
/// метода (как в SettingsView) и после вызова стирается из контрола.
/// </summary>
public partial class DocflowView : UserControl
{
    public DocflowView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
        DataContextChanged += DocflowView_DataContextChanged;
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as DocflowViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Фокус в поле исполнителя — показать справочник, если варианты уже загружены.</summary>
    private void AssigneeInput_GotFocus(object sender, System.Windows.RoutedEventArgs e)
    {
        (DataContext as DocflowViewModel)?.AssignmentForm?.ReopenAssigneePopup();
    }

    /// <summary>Фокус в поле контролёра — показать справочник, если варианты уже загружены.</summary>
    private void ControllerInput_GotFocus(object sender, System.Windows.RoutedEventArgs e)
    {
        (DataContext as DocflowViewModel)?.AssignmentForm?.ReopenControllerPopup();
    }

    /// <summary>«Проверить подключение» — POST /profile/test, пароль не сохраняется.</summary>
    private async void CredentialTest_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is not DocflowViewModel { CredentialForm: { } form })
        {
            return;
        }

        var ok = await form.TestAsync(CredentialPasswordInput.Password);
        if (ok)
        {
            CredentialPasswordInput.Clear();
        }
    }

    /// <summary>«Подключить и сохранить» — PUT /profile/credentials.</summary>
    private async void CredentialSave_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is not DocflowViewModel { CredentialForm: { } form })
        {
            return;
        }

        var ok = await form.SaveAsync(CredentialPasswordInput.Password);
        CredentialPasswordInput.Clear();
    }

    /// <summary>Подтверждённое «Отключить 1С» — DELETE /profile/credentials.</summary>
    private async void CredentialDisconnect_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (DataContext is not DocflowViewModel { CredentialForm: { } form })
        {
            return;
        }

        await form.DisconnectAsync();
        CredentialPasswordInput.Clear();
    }

    /// <summary>
    /// Панель кредов закрылась (любым способом) — стереть пароль из контрола,
    /// чтобы секрет не оставался в визуальном дереве.
    /// </summary>
    private void DocflowView_DataContextChanged(object sender, System.Windows.DependencyPropertyChangedEventArgs e)
    {
        if (e.OldValue is DocflowViewModel oldModel)
        {
            oldModel.PropertyChanged -= DocflowViewModel_PropertyChanged;
        }

        if (e.NewValue is DocflowViewModel newModel)
        {
            newModel.PropertyChanged += DocflowViewModel_PropertyChanged;
        }
    }

    private void DocflowViewModel_PropertyChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(DocflowViewModel.IsCredentialFormOpen)
            && DataContext is DocflowViewModel { IsCredentialFormOpen: false })
        {
            CredentialPasswordInput.Clear();
        }
    }
}
