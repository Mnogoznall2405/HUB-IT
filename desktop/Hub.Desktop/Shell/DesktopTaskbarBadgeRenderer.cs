using System.Globalization;
using System.Collections.Concurrent;
using System.Windows;
using Media = System.Windows.Media;
using WpfPoint = System.Windows.Point;

namespace Hub.Desktop.Shell;

internal static class DesktopTaskbarBadgeRenderer
{
    private static readonly Media.Brush BackgroundBrush = CreateFrozenBrush(Media.Color.FromRgb(0, 169, 231));
    private static readonly ConcurrentDictionary<string, Media.ImageSource> Cache = new(StringComparer.Ordinal);

    public static Media.ImageSource Create(string text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);

        if (!string.Equals(text, "99+", StringComparison.Ordinal)
            && (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var count)
                || count is < 1 or > 99))
        {
            throw new ArgumentOutOfRangeException(nameof(text), "Badge text must be 1..99 or 99+.");
        }

        return Cache.GetOrAdd(text, CreateImage);
    }

    private static Media.ImageSource CreateImage(string text)
    {
        var drawing = new Media.DrawingGroup();
        using (var context = drawing.Open())
        {
            context.DrawEllipse(
                BackgroundBrush,
                null,
                new WpfPoint(16, 16),
                radiusX: 16,
                radiusY: 16);

            var formattedText = new Media.FormattedText(
                text,
                CultureInfo.InvariantCulture,
                System.Windows.FlowDirection.LeftToRight,
                new Media.Typeface(new Media.FontFamily("Segoe UI"), FontStyles.Normal, FontWeights.Bold, FontStretches.Normal),
                text.Length > 2 ? 10 : 15,
                Media.Brushes.White,
                pixelsPerDip: 1);
            context.DrawText(
                formattedText,
                new WpfPoint(
                    (32 - formattedText.Width) / 2,
                    (32 - formattedText.Height) / 2));
        }

        drawing.Freeze();
        var image = new Media.DrawingImage(drawing);
        image.Freeze();
        return image;
    }

    private static Media.Brush CreateFrozenBrush(Media.Color color)
    {
        var brush = new Media.SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
