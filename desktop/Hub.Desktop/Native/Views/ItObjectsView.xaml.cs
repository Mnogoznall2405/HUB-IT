using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «🖥 ИТ-объекты»: реестр объектов с владельцами, доступами и составом.</summary>
public partial class ItObjectsView : UserControl
{
    public ItObjectsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
