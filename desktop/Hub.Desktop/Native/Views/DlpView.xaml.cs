using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «🛡 DLP»: сводка за день и «обратить внимание» слева, список ПК
/// по центру, активность выбранного хоста справа (шкала дня, серии, топ
/// приложений) и вкладки Файлы/Telegram/MAX/Браузер. Режим «Графики работ»
/// редактирует расписания филиалов через /inventory/dlp/work-schedules.
/// Медиа-скриншоты проб не показываются — см. DlpViewModel.
/// </summary>
public partial class DlpView : UserControl
{
    public DlpView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
