using System.ComponentModel;
using Hub.Desktop.UpdateRunner;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class UpdateRunnerWorkflowTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1641)]
    [InlineData(3010)]
    public async Task RestartsApplicationAfterSuccessfulSetup(int setupExitCode)
    {
        var platform = new FakePlatform { SetupExitCode = setupExitCode };

        var result = await UpdateRunnerWorkflow.ExecuteAsync(
            42,
            "setup.exe",
            "HUB.Desktop.exe",
            platform,
            _ => { });

        Assert.Equal(0, result);
        Assert.True(platform.WaitedForParent);
        Assert.True(platform.ApplicationStarted);
    }

    [Fact]
    public async Task RestartsPreviousVersionAfterSetupFailure()
    {
        var platform = new FakePlatform { SetupExitCode = 1603 };

        var result = await UpdateRunnerWorkflow.ExecuteAsync(
            42,
            "setup.exe",
            "HUB.Desktop.exe",
            platform,
            _ => { });

        Assert.Equal(6, result);
        Assert.True(platform.ApplicationStarted);
    }

    [Fact]
    public async Task RestartsPreviousVersionAfterUacCancellation()
    {
        var platform = new FakePlatform
        {
            SetupException = new Win32Exception(1223),
        };

        var result = await UpdateRunnerWorkflow.ExecuteAsync(
            42,
            "setup.exe",
            "HUB.Desktop.exe",
            platform,
            _ => { });

        Assert.Equal(7, result);
        Assert.True(platform.ApplicationStarted);
    }

    private sealed class FakePlatform : IUpdateRunnerPlatform
    {
        public int SetupExitCode { get; init; }

        public Exception? SetupException { get; init; }

        public bool WaitedForParent { get; private set; }

        public bool ApplicationStarted { get; private set; }

        public Task WaitForParentExitAsync(int processId)
        {
            WaitedForParent = true;
            return Task.CompletedTask;
        }

        public int RunElevatedSetup(string setupPath)
        {
            if (SetupException is not null)
            {
                throw SetupException;
            }

            return SetupExitCode;
        }

        public void StartApplication(string applicationPath)
        {
            ApplicationStarted = true;
        }
    }
}
