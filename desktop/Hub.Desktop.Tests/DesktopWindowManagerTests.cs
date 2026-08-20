using Hub.Desktop.Lifecycle;
using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopWindowManagerTests
{
    private static readonly Uri BaseUri = new("https://hubit.zsgp.ru/");

    [Fact]
    public void OpensOnlyOneSecondaryWindowWithTheCurrentSafeRoute()
    {
        var primary = new FakeHubWindow
        {
            CurrentSource = "https://hubit.zsgp.ru/tasks?filter=mine",
        };
        var secondary = new FakeHubWindow();
        string? requestedRoute = null;
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(route =>
        {
            requestedRoute = route;
            return secondary;
        });

        Assert.Equal(
            DesktopSecondaryWindowOpenResult.Opened,
            manager.OpenSecondaryFrom(primary));
        Assert.Equal("/tasks?filter=mine", requestedRoute);
        Assert.Equal(2, manager.WindowCount);
        Assert.False(manager.CanOpenSecondary);

        Assert.Equal(
            DesktopSecondaryWindowOpenResult.ActivatedExisting,
            manager.OpenSecondaryFrom(primary));
        Assert.Equal(2, secondary.ActivationCount);
    }

    [Fact]
    public void DoesNotCopySensitiveRoutesIntoTheSecondaryWindow()
    {
        var primary = new FakeHubWindow
        {
            CurrentSource = "https://hubit.zsgp.ru/shared-files/example?token=secret",
        };
        string? requestedRoute = "not-set";
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(route =>
        {
            requestedRoute = route;
            return new FakeHubWindow();
        });

        manager.OpenSecondaryFrom(primary);

        Assert.Null(requestedRoute);
    }

    [Fact]
    public void ReenablesSecondaryCreationAfterTheWindowCloses()
    {
        var primary = new FakeHubWindow();
        var secondary = new FakeHubWindow();
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);

        secondary.RaiseClosed();

        Assert.True(manager.CanOpenSecondary);
        Assert.Equal(1, manager.WindowCount);
    }

    [Fact]
    public void RoutesActivationToTheLastVisibleWindow()
    {
        var primary = new FakeHubWindow();
        var secondary = new FakeHubWindow();
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);
        secondary.RaiseActivated();

        manager.ActivateLastOrPrimary("/chat?conversation=7");

        Assert.Equal("/chat?conversation=7", secondary.LastRoute);
        Assert.Null(primary.LastRoute);
    }

    [Fact]
    public void ReloadsTheLastVisibleWindowWithoutCache()
    {
        var primary = new FakeHubWindow();
        var secondary = new FakeHubWindow();
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);
        secondary.RaiseActivated();

        manager.ReloadLastOrPrimaryWithoutCache();

        Assert.Equal(1, secondary.ReloadWithoutCacheCount);
        Assert.Equal(0, primary.ReloadWithoutCacheCount);
    }

    [Fact]
    public void ReloadsThePrimaryWindowWhenItIsTheOnlyTarget()
    {
        var primary = new FakeHubWindow();
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);

        manager.ReloadLastOrPrimaryWithoutCache();

        Assert.Equal(1, primary.ReloadWithoutCacheCount);
    }

    [Fact]
    public void AggregatesSharedShellCountersWithoutAddingDuplicates()
    {
        var primary = new FakeHubWindow();
        var secondary = new FakeHubWindow();
        var manager = new DesktopWindowManager(BaseUri);
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);
        DesktopShellStatus? aggregate = null;
        manager.ShellStatusChanged += (_, eventArgs) => aggregate = eventArgs.Status;

        manager.UpdateShellStatus(primary, new DesktopShellStatus(true, true, 5, 3, 1, 1));
        manager.UpdateShellStatus(secondary, new DesktopShellStatus(true, true, 5, 3, 1, 1));

        Assert.NotNull(aggregate);
        Assert.Equal(5, aggregate.UnreadTotal);
        Assert.Equal(3, aggregate.ChatUnread);
    }

    private sealed class FakeHubWindow : IDesktopHubWindow
    {
        public bool IsVisible { get; private set; } = true;

        public bool IsActive { get; private set; }

        public string? CurrentSource { get; set; }

        public string? LastRoute { get; private set; }

        public int ActivationCount { get; private set; }

        public int ReloadWithoutCacheCount { get; private set; }

        public event EventHandler? Activated;

        public event EventHandler? Closed;

        public void ShowAndActivate()
        {
            IsVisible = true;
            IsActive = true;
            ActivationCount++;
        }

        public void ShowAndNavigate(string? route)
        {
            LastRoute = route;
            ShowAndActivate();
        }

        public void ReloadWithoutCache() => ReloadWithoutCacheCount++;

        public bool BridgeReady { get; set; }

        public List<DesktopSystemLifecycleMessage> LifecycleMessages { get; } = [];

        public bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message)
        {
            ArgumentNullException.ThrowIfNull(message);
            if (!BridgeReady)
            {
                return false;
            }

            LifecycleMessages.Add(message);
            return true;
        }

        public void RaiseActivated()
        {
            IsActive = true;
            Activated?.Invoke(this, EventArgs.Empty);
        }

        public void RaiseClosed()
        {
            IsVisible = false;
            IsActive = false;
            Closed?.Invoke(this, EventArgs.Empty);
        }
    }
}
