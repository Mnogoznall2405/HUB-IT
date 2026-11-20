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

    /// <summary>Esc в диалоге непочищенных ПК: открыто подтверждение — отмена, иначе закрытие.</summary>
    private void PcRemainingOverlay_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key != System.Windows.Input.Key.Escape
            || DataContext is not ViewModels.StatisticsViewModel model
            || model.PcRemaining is not { } dialog)
        {
            return;
        }

        if (dialog.IsConfirmOpen)
        {
            dialog.CancelConfirmCommand.Execute(null);
        }
        else
        {
            dialog.CloseCommand.Execute(null);
        }

        e.Handled = true;
    }
}
