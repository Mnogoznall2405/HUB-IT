using System.IO;
using Microsoft.Win32;
using Windows.UI.Shell;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Shell;

internal enum DesktopTaskbarPinAvailability
{
    Unavailable,
    ManualOnly,
    Available,
    AlreadyPinned,
}

internal enum DesktopTaskbarPinResult
{
    Pinned,
    NotPinned,
    Failed,
}

internal sealed class DesktopTaskbarPinningService
{
    private const string LimitedAccessFeatureRegistryKey =
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\AppModel\LimitedAccessFeatures\com.microsoft.windows.taskbar.pin";
    private const string LimitedAccessFeatureSeed =
        "4096B239A7295B635C090E647E867B5707DA6AB6CB78340B01FE4E0C8F4953D4";

    public async Task<DesktopTaskbarPinAvailability> GetAvailabilityAsync()
    {
        if (RequiresLimitedAccessToken())
        {
            return DesktopTaskbarPinAvailability.ManualOnly;
        }

        try
        {
            var manager = TaskbarManager.GetDefault();
            if (!manager.IsSupported)
            {
                return DesktopTaskbarPinAvailability.Unavailable;
            }

            if (await manager.IsCurrentAppPinnedAsync())
            {
                return DesktopTaskbarPinAvailability.AlreadyPinned;
            }

            return manager.IsPinningAllowed
                ? DesktopTaskbarPinAvailability.Available
                : DesktopTaskbarPinAvailability.Unavailable;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Taskbar pinning API is unavailable; error={exception.GetType().Name}");
            return DesktopTaskbarPinAvailability.ManualOnly;
        }
    }

    public async Task<DesktopTaskbarPinResult> RequestPinAsync()
    {
        try
        {
            var manager = TaskbarManager.GetDefault();
            if (!manager.IsSupported || !manager.IsPinningAllowed)
            {
                return DesktopTaskbarPinResult.NotPinned;
            }

            return await manager.RequestPinCurrentAppAsync()
                ? DesktopTaskbarPinResult.Pinned
                : DesktopTaskbarPinResult.NotPinned;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Taskbar pinning request failed", exception);
            return DesktopTaskbarPinResult.Failed;
        }
    }

    private static bool RequiresLimitedAccessToken()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                LimitedAccessFeatureRegistryKey,
                writable: false);
            var value = key?.GetValue(LimitedAccessFeatureSeed);
            return value switch
            {
                int number => number != 0,
                long number => number != 0,
                _ => false,
            };
        }
        catch (Exception exception) when (
            exception is UnauthorizedAccessException
            or IOException
            or System.Security.SecurityException)
        {
            DesktopLog.Warning(
                "Taskbar pinning limited-access state could not be read");
            return true;
        }
    }
}
