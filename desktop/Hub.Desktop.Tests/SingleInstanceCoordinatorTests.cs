using Hub.Desktop.Lifecycle;
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
}
