using Hub.Desktop.Downloads;
using Hub.Desktop.Transfers;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopTaskbarProgressTests
{
    [Fact]
    public void AggregatesParallelKnownDownloadsAndNeverMovesBackward()
    {
        var downloads = new DesktopDownloadCoordinator();
        var progress = new DesktopTaskbarProgress();
        var first = downloads.BeginDownload("first.pdf");
        var second = downloads.BeginDownload("second.pdf");
        downloads.ReportProgress(first.Id, 50, 100);
        downloads.ReportProgress(second.Id, 25, 100);

        var initial = progress.Calculate(downloads.Items);
        downloads.ReportProgress(first.Id, 40, 100);
        var staleUpdate = progress.Calculate(downloads.Items);

        Assert.Equal(DesktopTaskbarProgressMode.Normal, initial.Mode);
        Assert.Equal(0.375, initial.Value, precision: 3);
        Assert.Equal(initial.Value, staleUpdate.Value);
    }

    [Fact]
    public void ShowsPausedOnlyWhenEveryActiveDownloadIsPaused()
    {
        var downloads = new DesktopDownloadCoordinator();
        var progress = new DesktopTaskbarProgress();
        var first = downloads.BeginDownload("first.pdf");
        var second = downloads.BeginDownload("second.pdf");
        downloads.ReportProgress(first.Id, 20, 100);
        downloads.ReportProgress(second.Id, 30, 100);
        downloads.PauseDownload(first.Id);

        Assert.Equal(
            DesktopTaskbarProgressMode.Normal,
            progress.Calculate(downloads.Items).Mode);

        downloads.PauseDownload(second.Id);

        Assert.Equal(
            DesktopTaskbarProgressMode.Paused,
            progress.Calculate(downloads.Items).Mode);
    }

    [Fact]
    public void UsesIndeterminateForUnknownLengthAndResetsAfterCompletion()
    {
        var downloads = new DesktopDownloadCoordinator();
        var progress = new DesktopTaskbarProgress();
        var item = downloads.BeginDownload("report.pdf");

        Assert.Equal(
            DesktopTaskbarProgressMode.Indeterminate,
            progress.Calculate(downloads.Items).Mode);

        downloads.CompleteDownload(item.Id, "C:\\Downloads\\report.pdf");

        Assert.Equal(DesktopTaskbarProgressState.None, progress.Calculate(downloads.Items));
    }
}
