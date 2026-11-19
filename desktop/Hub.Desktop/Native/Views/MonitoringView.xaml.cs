using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Страница «Мониторинг»: список устройств со статусами слева, карточка
/// устройства справа (связь ICMP/SNMP, текущие метрики, интерфейсы, события).
/// Только чтение: управление целями и графики истории в срез не входят.
/// </summary>
public partial class MonitoringView : UserControl
{
    public MonitoringView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }
}
