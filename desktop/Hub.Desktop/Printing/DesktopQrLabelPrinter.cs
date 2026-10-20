using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Printing;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace Hub.Desktop.Printing;

internal static class DesktopQrLabelPrinter
{
    private const string PngPrefix = "data:image/png;base64,";

    internal static byte[][] ReadImages(JsonElement job)
    {
        if (!job.TryGetProperty("labels", out var values)
            || values.ValueKind != JsonValueKind.Array || values.GetArrayLength() == 0)
        {
            throw new ArgumentException("The QR print job has no labels.");
        }

        var images = new List<byte[]>();
        foreach (var value in values.EnumerateArray())
        {
            var dataUrl = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
            if (dataUrl is null || !dataUrl.StartsWith(PngPrefix, StringComparison.Ordinal))
            {
                throw new ArgumentException("QR labels must contain embedded PNG images.");
            }
            var bytes = Convert.FromBase64String(dataUrl[PngPrefix.Length..]);
            using var stream = new MemoryStream(bytes, writable: false);
            using var image = Image.FromStream(stream, useEmbeddedColorManagement: false, validateImageData: true);
            if (image.RawFormat.Guid != System.Drawing.Imaging.ImageFormat.Png.Guid
                || image.Width > 8192 || image.Height > 8192)
            {
                throw new ArgumentException("Invalid QR label image.");
            }
            images.Add(bytes);
        }
        return images.ToArray();
    }

    internal static void Print(
        string printerName,
        IReadOnlyList<byte[]> images,
        double widthMm,
        double heightMm,
        short copies = 1,
        byte[]? selectedDevmode = null,
        string? outputPath = null)
    {
        if (images.Count == 0 || copies <= 0
            || !double.IsFinite(widthMm) || widthMm <= 0 || widthMm > 210
            || !double.IsFinite(heightMm) || heightMm <= 0 || heightMm > 297)
        {
            throw new ArgumentException("Invalid QR label print job.");
        }

        IntPtr printer = IntPtr.Zero, devmode = IntPtr.Zero, dc = IntPtr.Zero;
        var started = false;
        try
        {
            if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) throw Failure("OpenPrinter");
            var size = DocumentProperties(IntPtr.Zero, printer, printerName, IntPtr.Zero, IntPtr.Zero, 0);
            if (size < 220) throw new InvalidOperationException("Invalid printer DEVMODE size.");
            devmode = Marshal.AllocHGlobal(size);
            if (DocumentProperties(IntPtr.Zero, printer, printerName, devmode, IntPtr.Zero, 2) != 1)
                throw new InvalidOperationException("Cannot read printer settings.");
            if (selectedDevmode is not null)
            {
                if (selectedDevmode.Length != size)
                    throw new InvalidOperationException("Selected printer settings have an invalid size.");
                Marshal.Copy(selectedDevmode, 0, devmode, size);
            }

            // Per-job settings only: retain the driver's private settings, including label top.
            // DEVMODEW paper dimensions use tenths of a millimetre, unlike PaperSize's rounded inches.
            var width = checked((short)Math.Round(widthMm * 10));
            var height = checked((short)Math.Round(heightMm * 10));
            Marshal.WriteInt32(devmode, 72, (Marshal.ReadInt32(devmode, 72) | 0x0F | 0x100) & ~0x10);
            Marshal.WriteInt16(devmode, 76, 1);
            Marshal.WriteInt16(devmode, 78, 0);
            Marshal.WriteInt16(devmode, 80, height);
            Marshal.WriteInt16(devmode, 82, width);
            Marshal.WriteInt16(devmode, 84, 100);
            Marshal.WriteInt16(devmode, 86, copies);
            var maximumResolution = new PrinterSettings { PrinterName = printerName }.PrinterResolutions
                .Cast<PrinterResolution>().Where(resolution => resolution.X > 0 && resolution.Y > 0)
                .OrderByDescending(resolution => (long)resolution.X * resolution.Y).FirstOrDefault();
            if (maximumResolution is not null)
            {
                Marshal.WriteInt32(devmode, 72, Marshal.ReadInt32(devmode, 72) | 0x400 | 0x2000);
                Marshal.WriteInt16(devmode, 90, checked((short)maximumResolution.X));
                Marshal.WriteInt16(devmode, 96, checked((short)maximumResolution.Y));
            }
            if (DocumentProperties(IntPtr.Zero, printer, printerName, devmode, devmode, 10) != 1)
                throw new InvalidOperationException("The printer rejected the label settings.");
            if (Marshal.ReadInt16(devmode, 80) != height || Marshal.ReadInt16(devmode, 82) != width)
                throw new InvalidOperationException("The printer changed the label dimensions.");

            dc = CreateDC("WINSPOOL", printerName, null, devmode);
            if (dc == IntPtr.Zero) throw Failure("CreateDC");
            var dpiX = GetDeviceCaps(dc, 88);
            var dpiY = GetDeviceCaps(dc, 90);
            if (dpiX <= 0 || dpiY <= 0
                || Math.Abs(GetDeviceCaps(dc, 110) * 25.4 / dpiX - widthMm) > 0.25
                || Math.Abs(GetDeviceCaps(dc, 111) * 25.4 / dpiY - heightMm) > 0.25)
            {
                throw new InvalidOperationException("The printer page does not match the QR label size.");
            }

            var info = new DocInfo
            {
                Size = Marshal.SizeOf<DocInfo>(),
                Name = $"HUB-IT QR ({images.Count} labels)",
                Output = outputPath,
            };
            if (StartDoc(dc, ref info) <= 0) throw Failure("StartDoc");
            started = true;
            foreach (var bytes in images)
            {
                using var stream = new MemoryStream(bytes, writable: false);
                using var bitmap = Image.FromStream(stream);
                if (StartPage(dc) <= 0) throw Failure("StartPage");
                using (var graphics = Graphics.FromHdc(dc))
                {
                    graphics.PageUnit = GraphicsUnit.Millimeter;
                    graphics.PageScale = 1;
                    graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
                    graphics.PixelOffsetMode = PixelOffsetMode.Half;
                    graphics.SmoothingMode = SmoothingMode.None;
                    graphics.TranslateTransform(
                        (float)(-GetDeviceCaps(dc, 112) * 25.4 / dpiX),
                        (float)(-GetDeviceCaps(dc, 113) * 25.4 / dpiY));
                    graphics.DrawImage(bitmap,
                        new RectangleF(0, 0, (float)widthMm, (float)heightMm),
                        new RectangleF(0, 0, bitmap.Width, bitmap.Height), GraphicsUnit.Pixel);
                }
                if (EndPage(dc) <= 0) throw Failure("EndPage");
            }
            if (EndDoc(dc) <= 0) throw Failure("EndDoc");
            started = false;
        }
        finally
        {
            if (started && dc != IntPtr.Zero) AbortDoc(dc);
            if (dc != IntPtr.Zero) DeleteDC(dc);
            if (devmode != IntPtr.Zero) Marshal.FreeHGlobal(devmode);
            if (printer != IntPtr.Zero) ClosePrinter(printer);
        }
    }

    private static Win32Exception Failure(string operation) => new(Marshal.GetLastWin32Error(), operation);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct DocInfo
    {
        public int Size;
        [MarshalAs(UnmanagedType.LPWStr)] public string Name;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Output;
        [MarshalAs(UnmanagedType.LPWStr)] public string? DataType;
        public int Type;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv")]
    private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", CharSet = CharSet.Unicode, EntryPoint = "DocumentPropertiesW")]
    private static extern int DocumentProperties(IntPtr window, IntPtr printer, string name, IntPtr output, IntPtr input, int mode);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, EntryPoint = "CreateDCW", SetLastError = true)]
    private static extern IntPtr CreateDC(string driver, string device, string? output, IntPtr devmode);
    [DllImport("gdi32.dll")]
    private static extern int GetDeviceCaps(IntPtr dc, int index);
    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr dc);
    [DllImport("gdi32.dll", CharSet = CharSet.Unicode, EntryPoint = "StartDocW", SetLastError = true)]
    private static extern int StartDoc(IntPtr dc, ref DocInfo info);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int StartPage(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int EndPage(IntPtr dc);
    [DllImport("gdi32.dll", SetLastError = true)] private static extern int EndDoc(IntPtr dc);
    [DllImport("gdi32.dll")] private static extern int AbortDoc(IntPtr dc);
}
