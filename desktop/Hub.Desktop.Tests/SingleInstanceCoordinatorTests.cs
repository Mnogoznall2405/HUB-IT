using Hub.Desktop.Lifecycle;
using Hub.Desktop.DeepLinks;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class SingleInstanceCoordinatorTests
{
    [Fact]
    public void OnlyFirstCoordinatorOwnsInstanceMutex()
    {
        var applicationId = $"HUBIT.Desktop.Tests.{Guid.NewGuid():N}";
        using var primary = new SingleInstanceCoordinator(applicationId);
        using var secondary = new SingleInstanceCoordinator(applicationId);

        Assert.True(primary.IsPrimary);
        Assert.False(secondary.IsPrimary);
    }

    [Fact]
    public async Task SecondaryInstanceSignalsPrimaryActivation()
    {
        var applicationId = $"HUBIT.Desktop.Tests.{Guid.NewGuid():N}";
        using var primary = new SingleInstanceCoordinator(applicationId);
        using var secondary = new SingleInstanceCoordinator(applicationId);
        var activationReceived = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);

        primary.ActivationRequested += (_, _) => activationReceived.TrySetResult();
        primary.StartListening();

        Assert.True(await secondary.SignalPrimaryAsync());
        await activationReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
    }

    [Fact]
    public async Task SecondaryInstanceForwardsOnlyValidatedRoute()
    {
        var applicationId = $"HUBIT.Desktop.Tests.{Guid.NewGuid():N}";
        using var primary = new SingleInstanceCoordinator(applicationId);
        using var secondary = new SingleInstanceCoordinator(applicationId);
        var activationReceived = new TaskCompletionSource<DesktopLaunchRequest>(
            TaskCreationOptions.RunContinuationsAsynchronously);

        primary.ActivationRequested += (_, e) => activationReceived.TrySetResult(e.Request);
        primary.StartListening();
        var request = DesktopLaunchRequest.Default with { Route = "/chat?conversation=conv-7" };

        Assert.True(await secondary.SignalPrimaryAsync(request));
        var received = await activationReceived.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(request.Route, received.Route);
        Assert.False(received.OpenDownloads);
    }

    [Theory]
    [InlineData("ROUTE:https://evil.example")]
    [InlineData("ROUTE:/login")]
    [InlineData("ROUTE:/tasks\nACTIVATE")]
    [InlineData("UNKNOWN")]
    public void RejectsUnsafePipeCommands(string command)
    {
        Assert.False(SingleInstanceCoordinator.TryParseActivationCommand(command, out _));
    }
}
