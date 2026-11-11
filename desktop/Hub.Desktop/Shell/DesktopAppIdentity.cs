using System.Runtime.InteropServices;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Shell;

internal static class DesktopAppIdentity
{
    internal const string AppUserModelId = "HUB-IT.HUBDesktop";

    public static void TryApplyToCurrentProcess()
    {
        try
        {
            var result = SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
            if (result < 0)
            {
                Marshal.ThrowExceptionForHR(result);
            }
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Desktop AppUserModelID registration failed", exception);
        }
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string appId);
}
