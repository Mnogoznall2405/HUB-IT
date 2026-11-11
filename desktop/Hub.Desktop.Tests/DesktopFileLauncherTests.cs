using System.ComponentModel;
using System.Diagnostics;
using Hub.Desktop.Downloads;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopFileLauncherTests
{
    [Theory]
    [InlineData("report.doc")]
    [InlineData("report.DOCX")]
    [InlineData("template.dotm")]
    [InlineData("table.xlsm")]
    [InlineData("template.xltx")]
    [InlineData("slides.pptm")]
    [InlineData("show.ppsm")]
    [InlineData("document.odt")]
    [InlineData("table.ods")]
    [InlineData("slides.odp")]
    [InlineData("document.rtf")]
    [InlineData("data.csv")]
    [InlineData("document.pdf")]
    public void OpensEverySupportedOfficeAndPdfFormat(string fileName)
    {
        ProcessStartInfo? captured = null;
        var launcher = new DesktopFileLauncher(
            _ => true,
            startInfo =>
            {
                captured = startInfo;
                return null;
            });
        var path = Path.Combine(Path.GetTempPath(), fileName);

        var result = launcher.TryOpen(path);

        Assert.Equal(DesktopFileActionResult.Succeeded, result);
        Assert.NotNull(captured);
        Assert.Equal(Path.GetFullPath(path), captured.FileName);
        Assert.True(captured.UseShellExecute);
    }

    [Theory]
    [InlineData("program.exe")]
    [InlineData("installer.msi")]
    [InlineData("script.bat")]
    [InlineData("script.cmd")]
    [InlineData("script.ps1")]
    [InlineData("script.js")]
    [InlineData("shortcut.lnk")]
    [InlineData("report.pdf.partial")]
    [InlineData("report.docx.crdownload")]
    [InlineData("")]
    public void RejectsExecutableUnsupportedAndPartialFiles(string fileName)
    {
        var started = false;
        var launcher = new DesktopFileLauncher(
            _ => true,
            _ =>
            {
                started = true;
                return null;
            });

        Assert.Equal(DesktopFileActionResult.Unsupported, launcher.TryOpen(fileName));
        Assert.False(started);
    }

    [Fact]
    public void MissingFileIsLeftInPlaceWithoutStartingAHandler()
    {
        var started = false;
        var launcher = new DesktopFileLauncher(
            _ => false,
            _ =>
            {
                started = true;
                return null;
            });

        Assert.Equal(DesktopFileActionResult.Missing, launcher.TryOpen("report.pdf"));
        Assert.False(started);
    }

    [Fact]
    public void MissingWindowsAssociationReturnsNoHandlerWithoutDeletingTheFile()
    {
        var launcher = new DesktopFileLauncher(
            _ => true,
            _ => throw new Win32Exception(1155));

        Assert.Equal(DesktopFileActionResult.NoHandler, launcher.TryOpen("report.pdf"));
    }

    [Fact]
    public void QuickPrintUsesTheRegisteredWindowsPrintVerb()
    {
        ProcessStartInfo? captured = null;
        var launcher = new DesktopFileLauncher(
            _ => true,
            startInfo =>
            {
                captured = startInfo;
                return null;
            });

        var result = launcher.TryPrint("report.pdf");

        Assert.Equal(DesktopFileActionResult.Succeeded, result);
        Assert.NotNull(captured);
        Assert.Equal("print", captured.Verb);
        Assert.True(captured.UseShellExecute);
    }

    [Fact]
    public void CopiesAnExistingFileToTheClipboardAdapterWithoutExecutingIt()
    {
        string? copiedPath = null;
        var launcher = new DesktopFileLauncher(
            _ => true,
            _ => throw new InvalidOperationException("No process should start"),
            copyFileToClipboard: path => copiedPath = path);

        var result = launcher.TryCopyToClipboard("archive.zip");

        Assert.Equal(DesktopFileActionResult.Succeeded, result);
        Assert.Equal(Path.GetFullPath("archive.zip"), copiedPath);
    }

    [Fact]
    public void RevealsOnlyAnExistingCompletedFileWithExplorer()
    {
        ProcessStartInfo? captured = null;
        var launcher = new DesktopFileLauncher(
            _ => true,
            startInfo =>
            {
                captured = startInfo;
                return null;
            });
        var path = Path.GetFullPath("report.pdf");

        var result = launcher.TryRevealInFolder(path);

        Assert.Equal(DesktopFileActionResult.Succeeded, result);
        Assert.NotNull(captured);
        Assert.EndsWith("explorer.exe", captured.FileName, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(path, captured.ArgumentList);
        Assert.False(captured.UseShellExecute);
    }
}
