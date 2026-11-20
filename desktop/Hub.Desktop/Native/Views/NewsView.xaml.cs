using Hub.Desktop.Native.ViewModels;
using KeyEventArgs = System.Windows.Input.KeyEventArgs;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Новости»: список объявлений, фильтры, чтение и подтверждение.</summary>
public partial class NewsView : UserControl
{
    public NewsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    private void SearchInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == System.Windows.Input.Key.Enter)
        {
            (DataContext as NewsViewModel)?.RefreshCommand.Execute(null);
            e.Handled = true;
        }
    }

    /// <summary>Кнопка «＋» у реакций: открывает её ContextMenu (аналог ContextMenu у сообщения чата).</summary>
    private void ReactionMenu_Click(object sender, System.Windows.RoutedEventArgs e)
    {
        if (sender is System.Windows.Controls.Button { ContextMenu: { } menu })
        {
            menu.PlacementTarget = (System.Windows.Controls.Button)sender;
            menu.IsOpen = true;
            e.Handled = true;
        }
    }
}
