using Hub.Desktop.Native.ViewModels;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Мои задачи»: список, фильтры, детали и переходы.</summary>
public partial class TasksView : UserControl
{
    public TasksView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as TasksViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }
}
