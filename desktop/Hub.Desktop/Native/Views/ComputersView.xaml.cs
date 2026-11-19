using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Компьютеры»: поиск + фильтры, список слева, карточка справа.</summary>
public partial class ComputersView : UserControl
{
    public ComputersView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Кнопка «Статус: … ▾» — меню статусов серверного поиска.</summary>
    private void StatusFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button
            || DataContext is not ComputersViewModel model)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = model.StatusFilterOptions;
        menu.IsOpen = true;
    }
}
