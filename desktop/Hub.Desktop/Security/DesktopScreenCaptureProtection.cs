using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using Hub.Desktop.Workspace;

namespace Hub.Desktop.Security;

/// <summary>
/// Applies SetWindowDisplayAffinity(WDA_MONITOR) while the WebView shows the
/// password vault page, so screenshots and screen sharing capture a black
/// rectangle. Enabled by default; the ScreenCaptureProtectionEnabled desktop
/// policy (DWORD 0/1) can force it off or on.
/// </summary>
public static class DesktopScreenCaptureProtection
{
    public const string VaultRoutePath = "/passwords";
    private const uint WdaNone = 0x00000000;
    private const uint WdaMonitor = 0x00000001;

    public static bool IsVaultSource(Uri trustedBaseUri, string? source)
    {
        ArgumentNullException.ThrowIfNull(trustedBaseUri);
        return DesktopWorkspaceRoutePolicy.TryGetSafeRoute(trustedBaseUri, source, out var route)
            && (route.Equals(VaultRoutePath, StringComparison.OrdinalIgnoreCase)
                || route.StartsWith(VaultRoutePath + "?", StringComparison.OrdinalIgnoreCase)
                || route.StartsWith(VaultRoutePath + "/", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Returns null when the window handle is not created yet — the caller
    /// retries on the next navigation event without treating it as an error.
    /// </summary>
    public static bool? TryApply(Window window, bool protect)
    {
        ArgumentNullException.ThrowIfNull(window);
        var handle = new WindowInteropHelper(window).Handle;
        if (handle == nint.Zero)
        {
            return null;
        }
        return SetWindowDisplayAffinity(handle, protect ? WdaMonitor : WdaNone);
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowDisplayAffinity(nint windowHandle, uint affinity);
}
