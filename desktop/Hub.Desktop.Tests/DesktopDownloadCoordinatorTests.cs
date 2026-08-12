using System.Diagnostics;
using Hub.Desktop.Downloads;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopDownloadCoordinatorTests
{
    [Fact]
    public void AllowsExactlyOneOpenIntentUntilItsDownloadFinishes()
    {
        var now = new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero);
        var coordinator = CreateCoordinator(() => now);

        Assert.Equal(DesktopOpenIntentRequestResult.Accepted, coordinator.RequestOpenNextDownload());
        Assert.Equal(DesktopOpenIntentRequestResult.Busy, coordinator.RequestOpenNextDownload());

        var item = coordinator.BeginDownload("report.docx");
        Assert.True(item.OpenWhenCompleted);
        Assert.Equal(DesktopOpenIntentRequestResult.Busy, coordinator.RequestOpenNextDownload());

        coordinator.CancelDownload(item.Id);
        Assert.Equal(DesktopOpenIntentRequestResult.Accepted, coordinator.RequestOpenNextDownload());
    }

    [Fact]
    public void ExpiresAnUnclaimedIntentAfterItsShortTtl()
    {
        var now = new DateTimeOffset(2026, 8, 11, 12, 0, 0, TimeSpan.Zero);
        var coordinator = CreateCoordinator(() => now);
        Assert.Equal(DesktopOpenIntentRequestResult.Accepted, coordinator.RequestOpenNextDownload());

        now = now.AddSeconds(16);

        Assert.Equal(DesktopOpenIntentRequestResult.Accepted, coordinator.RequestOpenNextDownload());
    }

    [Fact]
    public void UnsupportedDownloadCannotConsumeOrExecuteTheOpenIntent()
    {
        var launches = new List<string>();
        var coordinator = CreateCoordinator(launches: launches);
        coordinator.RequestOpenNextDownload();

        var executable = coordinator.BeginDownload("installer.exe");
        coordinator.CompleteDownload(executable.Id, "C:\\Downloads\\installer.exe");
        var document = coordinator.BeginDownload("report.pdf");
        coordinator.CompleteDownload(document.Id, "C:\\Downloads\\report.pdf");

        Assert.False(executable.OpenWhenCompleted);
        Assert.True(document.OpenWhenCompleted);
        Assert.Equal([Path.GetFullPath("C:\\Downloads\\report.pdf")], launches);
    }

    [Fact]
    public void OrdinaryParallelDownloadsNeverOpenWithoutAnIntent()
    {
        var launches = new List<string>();
        var coordinator = CreateCoordinator(launches: launches);

        var first = coordinator.BeginDownload("first.pdf");
        var second = coordinator.BeginDownload("second.docx");
        coordinator.CompleteDownload(second.Id, "C:\\Downloads\\second.docx");
        coordinator.CompleteDownload(first.Id, "C:\\Downloads\\first.pdf");

        Assert.False(first.OpenWhenCompleted);
        Assert.False(second.OpenWhenCompleted);
        Assert.Empty(launches);
    }

    [Fact]
    public void CancelAndFailureNeverLaunchAndClearTheActiveIntent()
    {
        var launches = new List<string>();
        var coordinator = CreateCoordinator(launches: launches);
        coordinator.RequestOpenNextDownload();
        var cancelled = coordinator.BeginDownload("cancelled.pdf");

        coordinator.CancelDownload(cancelled.Id);
        Assert.Equal(DesktopDownloadState.Canceled, cancelled.State);
        Assert.Empty(launches);

        Assert.Equal(DesktopOpenIntentRequestResult.Accepted, coordinator.RequestOpenNextDownload());
        var failed = coordinator.BeginDownload("failed.docx");
        coordinator.FailDownload(failed.Id);
        Assert.Equal(DesktopDownloadState.Failed, failed.State);
        Assert.Empty(launches);
    }

    [Fact]
    public void OpensOnlyAfterCompletedAndTracksProgressForTheSessionPanel()
    {
        var launches = new List<string>();
        var coordinator = CreateCoordinator(launches: launches);
        coordinator.RequestOpenNextDownload();
        var item = coordinator.BeginDownload("report.pdf");

        coordinator.ReportProgress(item.Id, bytesReceived: 25, totalBytes: 100);
        Assert.Equal(25, item.ProgressPercent);
        Assert.Equal(DesktopDownloadState.InProgress, item.State);
        Assert.Empty(launches);

        var result = coordinator.CompleteDownload(item.Id, "C:\\Downloads\\report.pdf");

        Assert.Equal(DesktopFileActionResult.Succeeded, result);
        Assert.Equal(DesktopDownloadState.Completed, item.State);
        Assert.Equal(100, item.ProgressPercent);
        Assert.Single(launches);
    }

    [Theory]
    [InlineData(DesktopDownloadedFileAction.Open, "")]
    [InlineData(DesktopDownloadedFileAction.Print, "print")]
    public void ExecutesTheRequestedWindowsActionOnlyAfterDownloadCompletes(
        DesktopDownloadedFileAction action,
        string expectedVerb)
    {
        ProcessStartInfo? captured = null;
        var launcher = new DesktopFileLauncher(
            _ => true,
            startInfo =>
            {
                captured = startInfo;
                return null;
            });
        var coordinator = new DesktopDownloadCoordinator(() => DateTimeOffset.UtcNow, launcher);

        Assert.Equal(
            DesktopOpenIntentRequestResult.Accepted,
            coordinator.RequestNextDownloadAction(action));
        var item = coordinator.BeginDownload("report.pdf");
        Assert.Equal(action, item.CompletionAction);
        Assert.Null(captured);

        coordinator.CompleteDownload(item.Id, "C:\\Downloads\\report.pdf");

        Assert.NotNull(captured);
        Assert.Equal(expectedVerb, captured.Verb);
    }

    [Fact]
    public void SaveAsConsumesOneDownloadWithoutOpeningOrPrintingIt()
    {
        var launches = new List<string>();
        var coordinator = CreateCoordinator(launches: launches);
        coordinator.RequestNextDownloadAction(DesktopDownloadedFileAction.SaveAs);

        var item = coordinator.BeginDownload("archive.zip");
        var result = coordinator.CompleteDownload(item.Id, "C:\\Downloads\\archive.zip");

        Assert.Equal(DesktopDownloadedFileAction.SaveAs, item.CompletionAction);
        Assert.Null(result);
        Assert.Empty(launches);
    }

    [Fact]
    public void RequestsWebViewCancellationWithoutMarkingSuccessOrDeletingAnything()
    {
        var cancelRequests = 0;
        var coordinator = CreateCoordinator();
        var item = coordinator.BeginDownload(
            "report.pdf",
            () => cancelRequests++);

        Assert.True(coordinator.TryRequestCancel(item.Id));
        Assert.Equal(1, cancelRequests);
        Assert.Equal(DesktopDownloadState.InProgress, item.State);

        coordinator.CancelDownload(item.Id);

        Assert.Equal(DesktopDownloadState.Canceled, item.State);
        Assert.False(coordinator.TryRequestCancel(item.Id));
    }

    [Fact]
    public void ClearFinishedKeepsActiveItemsAndDoesNotDeleteCompletedFiles()
    {
        var root = Path.Combine(Path.GetTempPath(), $"hub-download-clear-{Guid.NewGuid():N}");
        Directory.CreateDirectory(root);
        var completedPath = Path.Combine(root, "report.pdf");
        File.WriteAllText(completedPath, "content");
        try
        {
            var coordinator = CreateCoordinator();
            var active = coordinator.BeginDownload("active.pdf");
            var completed = coordinator.BeginDownload("report.pdf");
            coordinator.CompleteDownload(completed.Id, completedPath);

            Assert.Equal(1, coordinator.ClearFinished());

            Assert.Single(coordinator.Items);
            Assert.Same(active, coordinator.Items[0]);
            Assert.True(File.Exists(completedPath));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void SortsActiveThenFailedThenCanceledThenCompleted()
    {
        var coordinator = CreateCoordinator();
        var completed = coordinator.BeginDownload("completed.pdf");
        var failed = coordinator.BeginDownload("failed.pdf");
        var canceled = coordinator.BeginDownload("canceled.pdf");
        var active = coordinator.BeginDownload("active.pdf");

        coordinator.CompleteDownload(completed.Id, "C:\\Downloads\\completed.pdf");
        coordinator.FailDownload(failed.Id);
        coordinator.CancelDownload(canceled.Id);

        Assert.Equal(
            [active.Id, failed.Id, canceled.Id, completed.Id],
            coordinator.Items.Select(item => item.Id));
    }

    private static DesktopDownloadCoordinator CreateCoordinator(
        Func<DateTimeOffset>? utcNow = null,
        List<string>? launches = null)
    {
        var recordedLaunches = launches ?? [];
        var launcher = new DesktopFileLauncher(
            _ => true,
            startInfo =>
            {
                recordedLaunches.Add(startInfo.FileName);
                return null;
            });
        return new DesktopDownloadCoordinator(
            utcNow ?? (() => DateTimeOffset.UtcNow),
            launcher);
    }
}
