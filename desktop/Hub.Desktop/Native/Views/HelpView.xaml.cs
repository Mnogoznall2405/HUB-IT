using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Key = System.Windows.Input.Key;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Помощь»: слева дерево раздел→статьи или выдача поиска,
/// справа карточка статьи (markdown через MarkdownTextBlock).
/// TreeView.SelectedItem не биндится — выбор идёт через событие.
/// </summary>
public partial class HelpView : UserControl
{
    public HelpView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Выбор узла в TreeView → SelectedNode модели (догрузка детали статьи).</summary>
    private void HelpTree_SelectedItemChanged(
        object sender,
        RoutedPropertyChangedEventArgs<object> e)
    {
        if (DataContext is HelpViewModel model)
        {
            model.SelectedNode = e.NewValue as HelpNavNodeViewModel;
        }
    }

    /// <summary>Escape очищает поиск и возвращает дерево разделов.</summary>
    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape
            && DataContext is HelpViewModel { SearchText.Length: > 0 } model)
        {
            model.SearchText = string.Empty;
            e.Handled = true;
        }
    }
}
