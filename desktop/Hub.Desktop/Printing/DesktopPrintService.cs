using Hub.Desktop.Diagnostics;
using Hub.Desktop.Workspace;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Printing;

public sealed class DesktopPrintService
{
    public static bool CanPrintCurrent(Uri trustedBaseUri, string? source) =>
        DesktopWorkspaceRoutePolicy.TryGetSafeRoute(trustedBaseUri, source, out _);

    public bool TryPrintCurrent(CoreWebView2? core, Uri trustedBaseUri)
    {
        if (core is null || !CanPrintCurrent(trustedBaseUri, core.Source))
        {
            return false;
        }

        try
        {
            core.ShowPrintUI(CoreWebView2PrintDialogKind.System);
            DesktopLog.Info("System print dialog opened for the current trusted HUB page");
            return true;
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException)
        {
            DesktopLog.Error("System print dialog could not be opened", exception);
            return false;
        }
    }
}
