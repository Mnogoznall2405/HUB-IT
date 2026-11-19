using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Отсутствия»: кто отсутствует на день или за неделю (HUB + ЗУП).</summary>
public partial class AbsencesView : UserControl
{
    public AbsencesView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
