using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopGlobalHotkeyTests
{
    [Fact]
    public void RegistersTheClosedShortcutAndUnregistersTheSameIdentifier()
    {
        (nint Handle, int Id, uint Modifiers, uint Key)? registration = null;
        (nint Handle, int Id)? removal = null;
        using var hotkey = new DesktopGlobalHotkey(
            (handle, id, modifiers, key) =>
            {
                registration = (handle, id, modifiers, key);
                return true;
            },
            (handle, id) =>
            {
                removal = (handle, id);
                return true;
            });

        Assert.True(hotkey.TryRegister(42));
        Assert.True(hotkey.IsRegistered);
        Assert.Equal((nint)42, registration?.Handle);
        Assert.Equal(DesktopGlobalHotkey.Identifier, registration?.Id);
        Assert.Equal((uint)0x48, registration?.Key);

        hotkey.Unregister();
        Assert.False(hotkey.IsRegistered);
        Assert.Equal((nint)42, removal?.Handle);
        Assert.Equal(DesktopGlobalHotkey.Identifier, removal?.Id);
    }

    [Fact]
    public void ReportsAConflictWithoutKeepingRegistrationState()
    {
        using var hotkey = new DesktopGlobalHotkey(
            (_, _, _, _) => false,
            (_, _) => true);

        Assert.False(hotkey.TryRegister(42));
        Assert.False(hotkey.IsRegistered);
    }

    [Theory]
    [InlineData(DesktopGlobalHotkey.WindowMessage, DesktopGlobalHotkey.Identifier, true)]
    [InlineData(DesktopGlobalHotkey.WindowMessage, 17, false)]
    [InlineData(0x0201, DesktopGlobalHotkey.Identifier, false)]
    public void RecognizesOnlyItsOwnActivationMessage(int message, int id, bool expected)
    {
        Assert.Equal(expected, DesktopGlobalHotkey.IsActivationMessage(message, id));
    }
}
