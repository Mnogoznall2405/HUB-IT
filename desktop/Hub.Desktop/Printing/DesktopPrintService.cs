using System.Diagnostics;
using System.IO;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
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

    /// <summary>Размер буфера, до которого ещё безопасно тащить PDF через ExecuteScriptAsync base64.</summary>
    public const int MaximumExternalPdfBytes = 64 * 1024 * 1024;
    /// <summary>Размер print-HTML документа сверх этого считается ошибочным.</summary>
    public const int MaximumPrintHtmlLength = 8 * 1024 * 1024;
    private const int PrintNavigationTimeoutMs = 15000;
    private const int PrintReadyDelayMs = 500;
    /// <summary>Сколько print-хостов держать живыми: каждый запрос получает свой, иначе второй
    /// документ увёл бы навигацию из-под ещё открытого системного диалога первого.</summary>
    private const int MaximumRetainedPrintHosts = 3;

    private sealed class PrintHost : IDisposable
    {
        public required System.Windows.Window Window { get; init; }
        public required Microsoft.Web.WebView2.Wpf.WebView2 View { get; init; }

        public void Dispose()
        {
            try { View.Dispose(); } catch (InvalidOperationException) { }
            try { Window.Close(); } catch (InvalidOperationException) { }
        }
    }

    private readonly List<PrintHost> _printHosts = new();
    private readonly System.Threading.SemaphoreSlim _printGate = new(1, 1);

    /// <summary>
    /// Печатает именно документ, а не DOM портала: PDF — через отдельный скрытый
    /// WebView2 с нативным системным диалогом, при недоступности blob-навигации —
    /// во внешнем PDF-просмотрщике; print-HTML — через NavigateToString в том же
    /// хосте. Возвращает статус для document.printResult.
    /// </summary>
    public async Task<string> PrintDocumentAsync(
        CoreWebView2? core,
        Uri trustedBaseUri,
        DesktopDocumentPrintCommand command)
    {
        if (core is null || !CanPrintCurrent(trustedBaseUri, core.Source))
        {
            return "unavailable";
        }

        await _printGate.WaitAsync();
        try
        {
            return command.Kind switch
            {
                "pdf" => await PrintPdfDocumentAsync(core, command),
                "html" => await PrintHtmlDocumentAsync(core, command),
                _ => "failed",
            };
        }
        finally
        {
            _printGate.Release();
        }
    }

    private async Task<string> PrintPdfDocumentAsync(
        CoreWebView2 mainCore,
        DesktopDocumentPrintCommand command)
    {
        try
        {
            var printCore = await CreatePrintHostAsync(mainCore);
            if (await NavigatePrintHostAsync(printCore, command.Url, html: null))
            {
                // Плагин PDF-просмотрщика готов не мгновенно после NavigationCompleted.
                await Task.Delay(PrintReadyDelayMs);
                printCore.ShowPrintUI(CoreWebView2PrintDialogKind.System);
                DesktopLog.Info("System print dialog opened for the document PDF blob");
                return "dialog-opened";
            }

            DesktopLog.Warning("PDF blob could not be navigated in the print host; falling back to the system PDF viewer");
            return await OpenPdfExternallyAsync(mainCore, command.Url, command.Title);
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException
            or IOException)
        {
            DesktopLog.Error("Document PDF printing failed", exception);
            return "failed";
        }
    }

    private async Task<string> PrintHtmlDocumentAsync(
        CoreWebView2 mainCore,
        DesktopDocumentPrintCommand command)
    {
        try
        {
            var json = await mainCore.ExecuteScriptAsync("window.__hubPendingPrintHtml || null");
            var html = ReadScriptString(json);
            if (string.IsNullOrEmpty(html))
            {
                DesktopLog.Warning("Pending print HTML payload is missing");
                return "failed";
            }
            if (html.Length > MaximumPrintHtmlLength)
            {
                DesktopLog.Warning("Pending print HTML payload exceeds the size limit");
                return "too-large";
            }

            var printCore = await CreatePrintHostAsync(mainCore);
            if (!await NavigatePrintHostAsync(printCore, command.Url, html: html))
            {
                return "failed";
            }

            await Task.Delay(PrintReadyDelayMs);
            printCore.ShowPrintUI(CoreWebView2PrintDialogKind.System);
            DesktopLog.Info("System print dialog opened for the print HTML document");
            return "dialog-opened";
        }
        catch (Exception exception) when (
            exception is InvalidOperationException
            or System.Runtime.InteropServices.COMException
            or JsonException)
        {
            DesktopLog.Error("Document HTML printing failed", exception);
            return "failed";
        }
    }

    /// <summary>
    /// Последний рубеж: вытащить байты blob: через fetch в основном webview
    /// и открыть системным PDF-просмотрщиком (печать — из него).
    /// </summary>
    private async Task<string> OpenPdfExternallyAsync(
        CoreWebView2 mainCore,
        string blobUrl,
        string title)
    {
        var script = $$"""
            (async () => {
                try {
                    const response = await fetch({{JsonSerializer.Serialize(blobUrl)}});
                    if (!response.ok) return { status: 'failed', reason: 'fetch-' + response.status };
                    const buffer = await response.arrayBuffer();
                    if (buffer.byteLength > {{MaximumExternalPdfBytes}}) return { status: 'too-large' };
                    const bytes = new Uint8Array(buffer);
                    const header = String.fromCharCode.apply(null, bytes.subarray(0, 5));
                    if (header !== '%PDF-') return { status: 'failed', reason: 'not-pdf' };
                    let binary = '';
                    const chunk = 0x8000;
                    for (let i = 0; i < bytes.length; i += chunk) {
                        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
                    }
                    return { status: 'ok', base64: btoa(binary) };
                } catch (error) {
                    return { status: 'failed', reason: String(error) };
                }
            })()
            """;

        var json = await mainCore.ExecuteScriptAsync(script);
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            var status = root.TryGetProperty("status", out var statusElement)
                ? statusElement.GetString()
                : null;
            if (status == "too-large")
            {
                return "too-large";
            }
            if (status != "ok"
                || !root.TryGetProperty("base64", out var base64Element)
                || base64Element.GetString() is not { Length: > 0 } base64)
            {
                return "failed";
            }

            var bytes = Convert.FromBase64String(base64);
            var directory = Path.Combine(Path.GetTempPath(), "hub-print");
            Directory.CreateDirectory(directory);
            SweepPrintTempDirectory(directory);
            var fileName = SanitizePrintFileName(title) + "-" + Guid.NewGuid().ToString("N") + ".pdf";
            var path = Path.Combine(directory, fileName);
            await File.WriteAllBytesAsync(path, bytes);
            Process.Start(new ProcessStartInfo
            {
                FileName = path,
                UseShellExecute = true,
            });
            DesktopLog.Info($"Document PDF opened in the system viewer; bytes={bytes.Length}");
            return "external-opened";
        }
        catch (Exception exception) when (
            exception is JsonException
            or FormatException
            or IOException
            or UnauthorizedAccessException
            or InvalidOperationException
            or System.ComponentModel.Win32Exception)
        {
            DesktopLog.Error("External PDF hand-off failed", exception);
            return "failed";
        }
    }

    /// <summary>
    /// Свежий скрытый хост WebView2 на каждый запрос печати: системный диалог печати
    /// не блокирует код, поэтому переиспользование хоста позволило бы второму документу
    /// заменить содержимое под ещё открытым диалогом первого. Хосты хранятся пулом и
    /// вытесняются по мере новых запросов; живут до конца процесса.
    /// </summary>
    private async Task<CoreWebView2> CreatePrintHostAsync(CoreWebView2 mainCore)
    {
        var window = new System.Windows.Window
        {
            Width = 1,
            Height = 1,
            Left = -32000,
            Top = -32000,
            Opacity = 0,
            ShowInTaskbar = false,
            ShowActivated = false,
            WindowStyle = System.Windows.WindowStyle.None,
            ResizeMode = System.Windows.ResizeMode.NoResize,
        };
        var view = new Microsoft.Web.WebView2.Wpf.WebView2();
        window.Content = view;
        window.Show();
        _printHosts.Add(new PrintHost { Window = window, View = view });
        while (_printHosts.Count > MaximumRetainedPrintHosts)
        {
            var oldest = _printHosts[0];
            _printHosts.RemoveAt(0);
            oldest.Dispose();
        }

        await view.EnsureCoreWebView2Async(mainCore.Environment);
        return view.CoreWebView2;
    }

    /// <summary>Навигация хоста на URL (PDF blob) или NavigateToString (print HTML) с таймаутом.</summary>
    private static async Task<bool> NavigatePrintHostAsync(
        CoreWebView2 printCore,
        string url,
        string? html)
    {
        var completion = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs args) =>
            completion.TrySetResult(args.IsSuccess);

        printCore.NavigationCompleted += OnNavigationCompleted;
        try
        {
            if (html is not null)
            {
                printCore.NavigateToString(html);
            }
            else
            {
                printCore.Navigate(url);
            }

            var winner = await Task.WhenAny(completion.Task, Task.Delay(PrintNavigationTimeoutMs));
            return winner == completion.Task && await completion.Task;
        }
        finally
        {
            printCore.NavigationCompleted -= OnNavigationCompleted;
        }
    }

    private static string? ReadScriptString(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            return document.RootElement.ValueKind == JsonValueKind.String
                ? document.RootElement.GetString()
                : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string SanitizePrintFileName(string title)
    {
        var builder = new System.Text.StringBuilder(capacity: 48);
        foreach (var character in title.Trim())
        {
            builder.Append(
                char.IsLetterOrDigit(character) || character is '-' or '_' or ' '
                    ? character
                    : '_');
            if (builder.Length >= 48) break;
        }
        return builder.Length > 0 ? builder.ToString() : "document";
    }

    private static void SweepPrintTempDirectory(string directory)
    {
        try
        {
            var threshold = DateTime.UtcNow.AddDays(-1);
            foreach (var file in Directory.EnumerateFiles(directory, "*.pdf"))
            {
                try
                {
                    if (File.GetLastWriteTimeUtc(file) < threshold)
                    {
                        File.Delete(file);
                    }
                }
                catch (IOException)
                {
                    // Файл ещё открыт просмотрщиком — пропускаем.
                }
            }
        }
        catch (IOException)
        {
            // Очередная зачистка не должна ломать печать.
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
