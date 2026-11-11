using System.Runtime.InteropServices;

namespace Hub.Desktop.Shell;

internal static class WindowsSessionStateMonitor
{
    internal const int SessionChangeMessage = 0x02B1;
    internal const int SessionLock = 0x7;
    internal const int SessionUnlock = 0x8;
    private const int NotifyForThisSession = 0;

    public static bool TryRegister(nint windowHandle) =>
        windowHandle != nint.Zero
        && WTSRegisterSessionNotification(windowHandle, NotifyForThisSession);

    public static void Unregister(nint windowHandle)
    {
        if (windowHandle != nint.Zero)
        {
            WTSUnRegisterSessionNotification(windowHandle);
        }
    }

    public static bool TryResolveLockState(
        int message,
        nint wordParameter,
        out bool locked)
    {
        locked = false;
        if (message != SessionChangeMessage)
        {
            return false;
        }

        if (wordParameter == SessionLock)
        {
            locked = true;
            return true;
        }

        return wordParameter == SessionUnlock;
    }

    [DllImport("Wtsapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSRegisterSessionNotification(
        nint windowHandle,
        int flags);

    [DllImport("Wtsapi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool WTSUnRegisterSessionNotification(nint windowHandle);
}
