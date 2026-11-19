using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Администрирование»: левое меню секций (как в веб-админке /admin),
/// списки с поиском и деталь отдела. Только чтение — write-операции веб-админки
/// в этот срез не входят.
/// </summary>
public partial class AdminView : UserControl
{
    public AdminView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
