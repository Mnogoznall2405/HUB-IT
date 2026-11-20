using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Раздел «Строительство»: master-detail портфель объектов и карточка —
/// разметка декларативная, логики в code-behind нет.
/// </summary>
public partial class ConstructionView : UserControl
{
    public ConstructionView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
