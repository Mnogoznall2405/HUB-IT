using System.Drawing;
using System.Windows.Forms;
using Hub.Desktop.Interop;
using Hub.Desktop.UI;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class HubTrayContextMenuTests
{
    [Fact]
    public void AppliesDarkThemeToRootSubmenusAndDestructiveAction()
    {
        using var menu = new HubTrayContextMenu();
        var submenu = new ToolStripMenuItem("Настройки Desktop");
        var child = new ToolStripMenuItem("Проверить обновления");
        var exit = new ToolStripMenuItem("Выйти");
        submenu.DropDownItems.Add(child);
        menu.Items.Add(submenu);
        menu.Items.Add(exit);
        menu.RegisterDestructiveItem(exit);

        menu.ApplyTheme(DesktopThemeMode.Dark);

        Assert.Equal(DesktopThemeMode.Dark, menu.ThemeMode);
        Assert.Equal(Color.FromArgb(22, 27, 34), menu.BackColor);
        Assert.Equal(menu.Palette.Foreground, submenu.ForeColor);
        Assert.Equal(menu.Palette.Surface, submenu.DropDown.BackColor);
        Assert.Equal(menu.Palette.Foreground, child.ForeColor);
        Assert.Equal(menu.Palette.Destructive, exit.ForeColor);
    }

    [Fact]
    public void SwitchesExistingItemsToLightTheme()
    {
        using var menu = new HubTrayContextMenu();
        var item = new ToolStripMenuItem("Открыть HUB");
        menu.Items.Add(item);
        menu.ApplyTheme(DesktopThemeMode.Dark);

        menu.ApplyTheme(DesktopThemeMode.Light);

        Assert.Equal(DesktopThemeMode.Light, menu.ThemeMode);
        Assert.Equal(Color.White.ToArgb(), menu.BackColor.ToArgb());
        Assert.Equal(Color.FromArgb(20, 35, 48), item.ForeColor);
        Assert.Equal(Color.FromArgb(232, 247, 253), menu.Palette.Hover);
    }

    [Fact]
    public void AlignsMenuIconsOnePixelAboveTheGeometricCenter()
    {
        var bounds = HubTrayContextMenu.GetAlignedImageBounds(
            new Rectangle(7, 4, 18, 24),
            new Size(18, 18));

        Assert.Equal(new Rectangle(7, 6, 18, 18), bounds);
    }
}
