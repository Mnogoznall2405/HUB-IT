using System.Windows;
using System.Windows.Controls;
using Button = System.Windows.Controls.Button;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Статистика»: вкладки-разделы, период, карточки и таблицы.</summary>
public partial class StatisticsView : UserControl
{
    public StatisticsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Кнопка «Период: … ▾» — меню опций периода.</summary>
    private void PeriodMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.IsOpen = true;
    }
}
