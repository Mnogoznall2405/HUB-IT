using System.Collections;
using System.Windows;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Адресная книга»: поиск + фильтры, список слева, карточка справа.</summary>
public partial class AddressBookView : UserControl
{
    public AddressBookView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Кнопка «Подразделение: … ▾» — меню справочника подразделений.</summary>
    private void DepartmentFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFilterMenu(sender, (DataContext as AddressBookViewModel)?.DepartmentFilterOptions);
    }

    /// <summary>Кнопка «Город: … ▾» — меню справочника городов (department_location).</summary>
    private void CityFilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        OpenFilterMenu(sender, (DataContext as AddressBookViewModel)?.CityFilterOptions);
    }

    private static void OpenFilterMenu(object sender, IEnumerable? itemsSource)
    {
        if (sender is not Button { ContextMenu: { } menu } button || itemsSource is null)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.ItemsSource = itemsSource;
        menu.IsOpen = true;
    }
}
