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
}
