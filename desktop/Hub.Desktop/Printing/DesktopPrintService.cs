using Hub.Desktop.Diagnostics;
using Hub.Desktop.Workspace;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Printing;

public enum DesktopEquipmentQrPrintMode
{
    Quick,
    Dialog,
}

public enum DesktopEquipmentQrPrintStatus
{
    Succeeded,
    DialogOpened,
    Failed,
}

public sealed class DesktopPrintService
{
    public const double A4WidthInInches = 210d / 25.4d;
    public const double A4HeightInInches = 297d / 25.4d;

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

    public async Task<DesktopEquipmentQrPrintStatus> PrintEquipmentQrBatchAsync(
        CoreWebView2? core,
        Uri trustedBaseUri,
        DesktopEquipmentQrPrintMode mode)
    {
        if (core is null || !CanPrintCurrent(trustedBaseUri, core.Source))
        {
            return DesktopEquipmentQrPrintStatus.Failed;
        }

        if (mode == DesktopEquipmentQrPrintMode.Dialog)
        {
            return TryPrintCurrent(core, trustedBaseUri)
                ? DesktopEquipmentQrPrintStatus.DialogOpened
                : DesktopEquipmentQrPrintStatus.Failed;
        }

        try
        {
            var settings = core.Environment.CreatePrintSettings();
            settings.PrinterName = string.Empty;
            settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
            settings.PageWidth = A4WidthInInches;
            settings.PageHeight = A4HeightInInches;
            settings.MarginTop = 0;
            settings.MarginRight = 0;
            settings.MarginBottom = 0;
            settings.MarginLeft = 0;
            settings.ScaleFactor = 1;
            settings.Copies = 1;
            settings.PagesPerSide = 1;
            settings.Duplex = CoreWebView2PrintDuplex.OneSided;
            settings.ShouldPrintBackgrounds = true;
            settings.ShouldPrintHeaderAndFooter = false;

            var status = await core.PrintAsync(settings);
            if (status == CoreWebView2PrintStatus.Succeeded)
            {
                DesktopLog.Info("Equipment QR batch sent to the default printer");
                return DesktopEquipmentQrPrintStatus.Succeeded;
            }

            DesktopLog.Warning($"Default equipment QR printing failed with status {status}; opening the system print dialog");
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Default equipment QR printing failed; opening the system print dialog", exception);
        }

        return TryPrintCurrent(core, trustedBaseUri)
            ? DesktopEquipmentQrPrintStatus.DialogOpened
            : DesktopEquipmentQrPrintStatus.Failed;
    }
}
