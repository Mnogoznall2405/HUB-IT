using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Страница «Профиль»: пользователь, сессия, сведения о приложении, выход.</summary>
public partial class ProfileView : UserControl
{
    public ProfileView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
