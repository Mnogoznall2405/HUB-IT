using System.Drawing;
using System.Drawing.Imaging;
using System.Text.Json;
using Hub.Desktop.Printing;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopQrLabelPrinterTests
{
    [Theory]
    [InlineData("https://example.test/label.png")]
    [InlineData("data:image/svg+xml;base64,PHN2Zy8+")]
    [InlineData("data:image/png;base64,invalid")]
    [InlineData("data:image/png;base64,AQID")]
    public void RejectsUnusableLabelsBeforePrinterSubmission(string label)
    {
        using var job = JsonDocument.Parse(JsonSerializer.Serialize(new { labels = new[] { label } }));
        Assert.ThrowsAny<Exception>(() => DesktopQrLabelPrinter.ReadImages(job.RootElement));
    }

    [Fact]
    public void RejectsTheWholeBatchWhenALaterLabelIsBroken()
    {
        var valid = BuildPng(Color.Black);
        using var job = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            labels = new[] { valid, "data:image/png;base64,AQID" },
        }));
        Assert.ThrowsAny<Exception>(() => DesktopQrLabelPrinter.ReadImages(job.RootElement));
    }

    [Fact]
    public void RetainsTheImageContentsAndOrderOfThePreparedBatch()
    {
        using var job = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            labels = new[] { BuildPng(Color.Black), BuildPng(Color.White) },
        }));
        var labels = DesktopQrLabelPrinter.ReadImages(job.RootElement);
        Assert.Equal(2, labels.Length);
        using var firstStream = new MemoryStream(labels[0]);
        using var secondStream = new MemoryStream(labels[1]);
        using var first = new Bitmap(firstStream);
        using var second = new Bitmap(secondStream);
        Assert.Equal(Color.Black.ToArgb(), first.GetPixel(0, 0).ToArgb());
        Assert.Equal(Color.White.ToArgb(), second.GetPixel(0, 0).ToArgb());
    }

    private static string BuildPng(Color color)
    {
        using var image = new Bitmap(2, 2);
        using (var graphics = Graphics.FromImage(image)) graphics.Clear(color);
        using var stream = new MemoryStream();
        image.Save(stream, ImageFormat.Png);
        return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
    }
}
