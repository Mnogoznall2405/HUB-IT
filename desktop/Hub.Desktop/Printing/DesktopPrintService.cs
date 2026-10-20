using Hub.Desktop.Diagnostics;
using Hub.Desktop.Workspace;
using Microsoft.Web.WebView2.Core;
using System.Text.Json;
using System.Drawing.Printing;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using Forms = System.Windows.Forms;

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

    public static bool TryGetEquipmentQrPageSize(
        string json,
        out double widthInInches,
        out double heightInInches)
    {
        widthInInches = 0;
        heightInInches = 0;
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object
                || !root.TryGetProperty("widthMm", out var widthValue)
                || !root.TryGetProperty("heightMm", out var heightValue)
                || widthValue.ValueKind != JsonValueKind.Number
                || heightValue.ValueKind != JsonValueKind.Number
                || !widthValue.TryGetDouble(out var widthMm)
                || !heightValue.TryGetDouble(out var heightMm)
                || !double.IsFinite(widthMm) || !double.IsFinite(heightMm)
                || widthMm <= 0 || widthMm > 210
                || heightMm <= 0 || heightMm > 297)
            {
                return false;
            }
            widthInInches = widthMm / 25.4d;
            heightInInches = heightMm / 25.4d;
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }

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

        var isLabelJob = false;
        try
        {
            var pageSizeJson = await core.ExecuteScriptAsync("""
                (() => {
                    const root = document.getElementById('equipment-qr-print-root');
                    if (!root || !root.querySelector('img')) return null;
                    return {
                        widthMm: Number(root.dataset.pageWidthMm ?? 210),
                        heightMm: Number(root.dataset.pageHeightMm ?? 297),
                        labels: Array.from(root.querySelectorAll('img'), image => image.src)
                    };
                })()
                """);
            if (!TryGetEquipmentQrPageSize(pageSizeJson, out var pageWidth, out var pageHeight))
            {
                DesktopLog.Warning("Equipment QR print page is missing or has an invalid size");
                return DesktopEquipmentQrPrintStatus.Failed;
            }
            if (pageWidth != A4WidthInInches || pageHeight != A4HeightInInches)
            {
                isLabelJob = true;
                using var job = JsonDocument.Parse(pageSizeJson);
                var images = DesktopQrLabelPrinter.ReadImages(job.RootElement);
                var printer = new PrinterSettings { Copies = 1 };
                byte[]? selectedDevmode = null;
                if (mode == DesktopEquipmentQrPrintMode.Dialog || !printer.IsValid)
                {
                    using var dialog = new Forms.PrintDialog
                    {
                        PrinterSettings = printer,
                        UseEXDialog = true,
                        AllowPrintToFile = false,
                        AllowSomePages = false,
                        AllowSelection = false,
                    };
                    var owner = System.Windows.Application.Current?.Windows
                        .OfType<System.Windows.Window>().FirstOrDefault(window => window.IsActive);
                    var result = owner is null
                        ? dialog.ShowDialog()
                        : dialog.ShowDialog(new PrintDialogOwner(new WindowInteropHelper(owner).Handle));
                    if (result != Forms.DialogResult.OK)
                    {
                        await core.ExecuteScriptAsync("window.dispatchEvent(new Event('afterprint'));");
                        return DesktopEquipmentQrPrintStatus.DialogOpened;
                    }
                    printer = dialog.PrinterSettings;
                    var modeHandle = printer.GetHdevmode();
                    var pointer = GlobalLock(modeHandle);
                    try
                    {
                        if (pointer == IntPtr.Zero) throw new InvalidOperationException("Cannot read selected printer settings.");
                        var length = (ushort)Marshal.ReadInt16(pointer, 68) + (ushort)Marshal.ReadInt16(pointer, 70);
                        if (length < 220 || length > 65536) throw new InvalidOperationException("Invalid selected printer settings size.");
                        selectedDevmode = new byte[length];
                        Marshal.Copy(pointer, selectedDevmode, 0, length);
                    }
                    finally
                    {
                        if (pointer != IntPtr.Zero) GlobalUnlock(modeHandle);
                        GlobalFree(modeHandle);
                    }
                }
                await Task.Run(() => DesktopQrLabelPrinter.Print(
                    printer.PrinterName, images, pageWidth * 25.4, pageHeight * 25.4,
                    printer.Copies, selectedDevmode));
                DesktopLog.Info($"Equipment QR labels sent through the printer driver; count={images.Length}; sizeMm={pageWidth * 25.4}x{pageHeight * 25.4}");
                return DesktopEquipmentQrPrintStatus.Succeeded;
            }
            if (mode == DesktopEquipmentQrPrintMode.Dialog)
            {
                return TryPrintCurrent(core, trustedBaseUri)
                    ? DesktopEquipmentQrPrintStatus.DialogOpened
                    : DesktopEquipmentQrPrintStatus.Failed;
            }
            var settings = core.Environment.CreatePrintSettings();
            settings.PrinterName = string.Empty;
            settings.MediaSize = CoreWebView2PrintMediaSize.Custom;
            settings.PageWidth = pageWidth;
            settings.PageHeight = pageHeight;
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
            DesktopLog.Error("Equipment QR printing failed", exception);
            if (isLabelJob) return DesktopEquipmentQrPrintStatus.Failed;
        }

        return TryPrintCurrent(core, trustedBaseUri)
            ? DesktopEquipmentQrPrintStatus.DialogOpened
            : DesktopEquipmentQrPrintStatus.Failed;
    }

    private sealed record PrintDialogOwner(IntPtr Handle) : Forms.IWin32Window;

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll")] private static extern IntPtr GlobalFree(IntPtr handle);
}
