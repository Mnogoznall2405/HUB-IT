using Hub.Agent.Core.Scan;
using PdfSharp.Pdf;
using Xunit;

namespace Hub.Agent.Tests;

public sealed class PdfWorkerTests
{
    private readonly string _root;

    public PdfWorkerTests()
    {
        _root = Path.Combine(AppContext.BaseDirectory, "pdf-tests", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(_root);
    }

    [Fact]
    public void SliceContainsFirstThreePages()
    {
        var path = Path.Combine(_root, "sample.pdf");
        CreatePdf(path, pages: 5);

        var result = PdfWorker.Analyze(path);

        Assert.Equal(PdfWorker.OcrPageLimit, result.Pages);
        Assert.False(string.IsNullOrEmpty(result.SliceB64));
        Assert.Equal(string.Empty, result.Reason);
        Assert.Equal(64, result.FileHash.Length);

        var slice = Convert.FromBase64String(result.SliceB64);
        Assert.True(slice.Length is > 0 and <= PdfWorker.MaxSliceBytes);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(slice, 0, 4));
    }

    [Fact]
    public void ShortDocumentKeepsAllPages()
    {
        var path = Path.Combine(_root, "short.pdf");
        CreatePdf(path, pages: 2);

        var result = PdfWorker.Analyze(path);

        Assert.Equal(2, result.Pages);
        Assert.False(string.IsNullOrEmpty(result.SliceB64));
    }

    [Fact]
    public void BrokenPdfReportsReasonInsteadOfThrowing()
    {
        var path = Path.Combine(_root, "broken.pdf");
        File.WriteAllText(path, "not a pdf");

        var result = PdfWorker.Analyze(path);

        Assert.Equal(0, result.Pages);
        Assert.NotEqual(string.Empty, result.Reason);
    }

    private static void CreatePdf(string path, int pages)
    {
        using var document = new PdfDocument();
        for (var index = 0; index < pages; index++)
        {
            document.AddPage();
        }

        document.Save(path);
    }
}
