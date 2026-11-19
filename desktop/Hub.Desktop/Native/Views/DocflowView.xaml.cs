using Hub.Desktop.Native.ViewModels;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Документооборот 1С»: scope-табы, список заданий, карточка и действия.</summary>
public partial class DocflowView : UserControl
{
    public DocflowView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
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
}
