using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «База»: поиск + фильтры, список слева, карточка справа.</summary>
public partial class DatabaseView : UserControl
{
    public DatabaseView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Кнопка «Поле: … ▾» — меню полей серверного поиска.</summary>
    private void FieldFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not DatabaseViewModel model)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = model.FieldFilterOptions;
        menu.IsOpen = true;
    }

    /// <summary>Кнопка «Тип: … ▾» — меню типов оборудования из справочника.</summary>
    private void TypeFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not DatabaseViewModel model)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = model.TypeFilterOptions;
        menu.IsOpen = true;
    }

    /// <summary>Esc в оверлее передачи — закрытие диалога (как ✕/Отмена).</summary>
    private void TransferOverlay_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not DatabaseViewModel model
            || model.Transfer is null)
        {
            return;
        }

        model.Transfer.CloseCommand.Execute(null);
        e.Handled = true;
    }
}
