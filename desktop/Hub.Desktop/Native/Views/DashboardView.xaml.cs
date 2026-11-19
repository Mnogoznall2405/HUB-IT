using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Главная страница шелла: сводка, ближайшие задачи, новости, отсутствующие.</summary>
public partial class DashboardView : UserControl
{
    public DashboardView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
