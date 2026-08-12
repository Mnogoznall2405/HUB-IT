using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class WindowsSessionStateMonitorTests
{
    [Theory]
    [InlineData(WindowsSessionStateMonitor.SessionLock, true)]
    [InlineData(WindowsSessionStateMonitor.SessionUnlock, false)]
    public void ResolvesOnlyLockAndUnlockSessionMessages(int code, bool expectedLocked)
    {
        var resolved = WindowsSessionStateMonitor.TryResolveLockState(
            WindowsSessionStateMonitor.SessionChangeMessage,
            code,
            out var locked);

        Assert.True(resolved);
        Assert.Equal(expectedLocked, locked);
    }

    [Theory]
    [InlineData(0x0005, WindowsSessionStateMonitor.SessionLock)]
    [InlineData(WindowsSessionStateMonitor.SessionChangeMessage, 0x5)]
    public void RejectsUnrelatedWindowAndSessionMessages(int message, int code)
    {
        Assert.False(WindowsSessionStateMonitor.TryResolveLockState(message, code, out _));
    }
}
