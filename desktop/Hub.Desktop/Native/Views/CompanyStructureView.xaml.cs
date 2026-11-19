using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Структура компании»: дерево подразделений слева, сотрудники узла
/// и карточка справа. TreeView.SelectedItem не биндится — выбор идёт через событие.
/// </summary>
public partial class CompanyStructureView : UserControl
{
    public CompanyStructureView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Выбор узла в TreeView → SelectedNode модели (загрузка сотрудников).</summary>
    private void StructureTree_SelectedItemChanged(
        object sender,
        RoutedPropertyChangedEventArgs<object> e)
    {
        if (DataContext is CompanyStructureViewModel model)
        {
            model.SelectedNode = e.NewValue as CompanyStructureNodeViewModel;
        }
    }

    /// <summary>Escape закрывает подсказки поиска; клик вне — StaysOpen=False у Popup.</summary>
    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape
            && DataContext is CompanyStructureViewModel { IsSearchPopupOpen: true } model)
        {
            model.IsSearchPopupOpen = false;
            e.Handled = true;
        }
    }
}
