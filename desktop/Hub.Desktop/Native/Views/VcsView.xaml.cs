using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «VCS»: список терминалов ВКС с кнопкой «Подключиться»
/// (запуск внешнего VNC-клиента через системный обработчик vnc://).
/// Только чтение — без добавления и редактирования терминалов.
/// </summary>
public partial class VcsView : UserControl
{
    public VcsView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
