using System.Windows;
using System.Windows.Controls;
using Hub.Desktop.Native.ViewModels;
using Button = System.Windows.Controls.Button;
using Style = System.Windows.Style;
using StyleSelector = System.Windows.Controls.StyleSelector;
using UserControl = System.Windows.Controls.UserControl;

namespace Hub.Desktop.Native.Views;

/// <summary>Карточки устройств — HubTaskCardStyle, заголовки групп — плоские строки.</summary>
public sealed class MfuRowStyleSelector : StyleSelector
{
    public Style? DeviceStyle { get; set; }
    public Style? HeaderStyle { get; set; }

    public override Style SelectStyle(object item, DependencyObject container) =>
        (item is MfuDeviceItemViewModel ? DeviceStyle : HeaderStyle)!;
}

/// <summary>Страница «МФУ»: фильтры+поиск, сгруппированный список слева, карточка справа.</summary>
public partial class MfuView : UserControl
{
    public MfuView()
    {
        InitializeComponent();
        NativeThemeManager.EnsureFallbackPalette(this);
    }

    /// <summary>Кнопки «Филиал/Сеть/SNMP: … ▾» — меню опций фильтра.</summary>
    private void FilterMenuButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { ContextMenu: { } menu } button)
        {
            return;
        }

        menu.PlacementTarget = button;
        menu.IsOpen = true;
    }
}
