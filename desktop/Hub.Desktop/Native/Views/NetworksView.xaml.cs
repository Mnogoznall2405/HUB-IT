using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Сети»: список филиалов слева, карточка филиала справа
/// (метрики, площадки, оборудование, файлы-схемы). Только чтение.
/// </summary>
public partial class NetworksView : UserControl
{
    public NetworksView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
