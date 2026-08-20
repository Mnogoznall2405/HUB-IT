using System.Text.Json;
using Hub.Desktop.Interop;
using Hub.Desktop.Lifecycle;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopSystemLifecycleTests
{
    private static readonly Uri BaseUri = new("https://hubit.zsgp.ru/");
    private static readonly DateTimeOffset OccurredUtc =
        new(2026, 8, 19, 10, 0, 0, TimeSpan.Zero);

    [Fact]
    public void ResumeCreatesMonotonicRecoveryGeneration()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        DesktopSystemLifecycleMessage? last = null;
        coalescer.Coalesced += (_, message) => last = message;

        coalescer.HandleResume();
        scheduler.RunPending();

        Assert.NotNull(last);
        Assert.Equal(DesktopSystemLifecycleKind.Resume, last!.Kind);
        Assert.Equal(1, last.Generation);
        Assert.True(last.IsRecoveryAttempt);
        Assert.Null(last.NetworkAvailable);
        Assert.Equal(1, coalescer.Generation);
    }

    [Fact]
    public void NetworkAvailableTrueCreatesRecoveryEvent()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        DesktopSystemLifecycleMessage? last = null;
        coalescer.Coalesced += (_, message) => last = message;

        coalescer.HandleNetworkAvailability(true);
        scheduler.RunPending();

        Assert.NotNull(last);
        Assert.Equal(DesktopSystemLifecycleKind.NetworkChanged, last!.Kind);
        Assert.True(last.NetworkAvailable);
        Assert.True(last.IsRecoveryAttempt);
        Assert.Equal(1, last.Generation);
    }

    [Fact]
    public void NetworkAvailableFalseIsNotARecoveryAttempt()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        DesktopSystemLifecycleMessage? last = null;
        coalescer.Coalesced += (_, message) => last = message;

        coalescer.HandleNetworkAvailability(false);
        scheduler.RunPending();

        Assert.NotNull(last);
        Assert.Equal(DesktopSystemLifecycleKind.NetworkChanged, last!.Kind);
        Assert.False(last.NetworkAvailable);
        Assert.False(last.IsRecoveryAttempt);
    }

    [Fact]
    public void EventsInsideDebounceWindowCoalesceToOneMessage()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var count = 0;
        coalescer.Coalesced += (_, _) => count++;

        coalescer.HandleResume();
        coalescer.HandleNetworkAvailability(false);
        coalescer.HandleNetworkAvailability(true);
        coalescer.HandleNetworkAvailability(true);
        scheduler.RunPending();

        Assert.Equal(1, count);
        Assert.Equal(1, coalescer.Generation);
    }

    [Fact]
    public void ResumeAndNetworkAvailableMergeIntoOneRecoveryGeneration()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var messages = new List<DesktopSystemLifecycleMessage>();
        coalescer.Coalesced += (_, message) => messages.Add(message);

        coalescer.HandleResume();
        coalescer.HandleNetworkAvailability(true);
        scheduler.RunPending();

        Assert.Single(messages);
        Assert.Equal(DesktopSystemLifecycleKind.Resume, messages[0].Kind);
        Assert.True(messages[0].IsRecoveryAttempt);
        Assert.Equal(1, messages[0].Generation);
    }

    [Fact]
    public void GenerationIsMonotonicAcrossFlushes()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var generations = new List<int>();
        coalescer.Coalesced += (_, message) => generations.Add(message.Generation);

        coalescer.HandleResume();
        scheduler.RunPending();
        coalescer.HandleNetworkAvailability(true);
        scheduler.RunPending();
        coalescer.HandleNetworkAvailability(false);
        scheduler.RunPending();

        Assert.Equal(new[] { 1, 2, 3 }, generations);
        Assert.Equal(3, coalescer.Generation);
    }

    [Fact]
    public void OneHundredRapidCallbacksProduceOneCoalescedEvent()
    {
        var scheduler = new ManualDelayScheduler();
        using var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var count = 0;
        coalescer.Coalesced += (_, _) => count++;

        for (var index = 0; index < 100; index++)
        {
            if (index % 2 == 0)
            {
                coalescer.HandleResume();
            }
            else
            {
                coalescer.HandleNetworkAvailability(index % 4 == 1);
            }
        }

        scheduler.RunPending();

        Assert.Equal(1, count);
        Assert.Equal(1, coalescer.Generation);
        Assert.Equal(100, scheduler.ScheduleCount);
    }

    private DesktopSystemLifecycleBroadcaster CreateBroadcaster(DesktopWindowManager manager) =>
        new(manager, () => OccurredUtc);

    [Fact]
    public void MaxAgeMatchesTheFrontendTtlOfOneHundredTwentySeconds()
    {
        Assert.Equal(TimeSpan.FromSeconds(120), DesktopSystemLifecycleMessage.MaxAge);
        Assert.Equal(TimeSpan.FromSeconds(5), DesktopSystemLifecycleMessage.MaxFutureSkew);
        Assert.Equal(DesktopSystemLifecycleMessage.MaxAge, DesktopSystemLifecycleBroadcaster.MaxEventAge);
        Assert.Equal(DesktopSystemLifecycleMessage.MaxFutureSkew, DesktopSystemLifecycleBroadcaster.MaxFutureSkew);
    }

    [Fact]
    public void EventFiveSecondsInTheFutureIsAccepted()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);

        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            6,
            OccurredUtc.AddSeconds(5),
            null));

        Assert.Single(primary.LifecycleMessages);
        Assert.Equal(6, primary.LifecycleMessages[0].Generation);
    }

    [Fact]
    public void EventOneMinuteInTheFutureIsRejected()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);

        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            6,
            OccurredUtc.AddMinutes(1),
            null));

        Assert.Empty(primary.LifecycleMessages);
        Assert.Null(broadcaster.CurrentMessage);
    }

    [Fact]
    public void PendingEventIsKeptUntilBridgeReadyThenForwardedOnce()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow();
        manager.RegisterPrimary(primary);
        var message = new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            7,
            OccurredUtc,
            null);

        broadcaster.Publish(message);
        Assert.Empty(primary.LifecycleMessages);

        primary.BridgeReady = true;
        manager.NotifyBridgeReady(primary);
        manager.NotifyBridgeReady(primary);

        Assert.Single(primary.LifecycleMessages);
        Assert.Equal(7, primary.LifecycleMessages[0].Generation);
    }

    [Fact]
    public void ReadyPrimaryAndSecondaryReceiveTheSameEvent()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        var secondary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);

        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.NetworkChanged,
            4,
            OccurredUtc,
            true));

        Assert.Single(primary.LifecycleMessages);
        Assert.Single(secondary.LifecycleMessages);
        Assert.Equal(4, primary.LifecycleMessages[0].Generation);
        Assert.Equal(4, secondary.LifecycleMessages[0].Generation);
    }

    [Fact]
    public void ClosedSecondaryWindowDoesNotReceiveLaterEvents()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        var secondary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);
        secondary.RaiseClosed();

        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            9,
            OccurredUtc,
            null));

        Assert.Single(primary.LifecycleMessages);
        Assert.Empty(secondary.LifecycleMessages);
    }

    [Fact]
    public void DisposeUnsubscribesSystemEvents()
    {
        var source = new FakeDesktopSystemEventSource();
        var scheduler = new ManualDelayScheduler();
        var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var count = 0;
        using (var service = new DesktopSystemLifecycleService(source, coalescer, action => action()))
        {
            service.Coalesced += (_, _) => count++;
            source.RaiseResume();
            scheduler.RunPending();
            Assert.Equal(1, count);
        }

        source.RaiseResume();
        source.RaiseNetwork(true);
        scheduler.RunPending();
        Assert.Equal(1, count);
        Assert.True(source.Disposed);
    }

    [Fact]
    public void ServiceMarshalsCallbacksBeforeCoalescing()
    {
        var source = new FakeDesktopSystemEventSource();
        var scheduler = new ManualDelayScheduler();
        var coalescer = new DesktopSystemLifecycleCoalescer(scheduler, () => OccurredUtc);
        var marshalCount = 0;
        using var service = new DesktopSystemLifecycleService(
            source,
            coalescer,
            action =>
            {
                marshalCount++;
                action();
            });
        DesktopSystemLifecycleMessage? last = null;
        service.Coalesced += (_, message) => last = message;

        source.RaiseNetwork(true);
        scheduler.RunPending();

        Assert.Equal(1, marshalCount);
        Assert.NotNull(last);
        Assert.True(last!.IsRecoveryAttempt);
    }

    [Theory]
    [InlineData(DesktopSystemLifecycleKind.Resume, null)]
    [InlineData(DesktopSystemLifecycleKind.NetworkChanged, true)]
    [InlineData(DesktopSystemLifecycleKind.NetworkChanged, false)]
    public void LifecyclePayloadOmitsAddressesIdentitiesAndSecrets(
        DesktopSystemLifecycleKind kind,
        bool? available)
    {
        var json = DesktopBridgeProtocol.CreateSystemLifecycleMessage(
            new DesktopSystemLifecycleMessage(kind, 12, OccurredUtc, available));
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        var names = root.EnumerateObject().Select(property => property.Name).ToArray();

        Assert.DoesNotContain("ip", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("adapter", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("ssid", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("username", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("windowsUsername", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("cookie", names, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("route", names, StringComparer.OrdinalIgnoreCase);
        Assert.Equal(12, root.GetProperty("generation").GetInt32());
        Assert.Equal("2026-08-19T10:00:00Z", root.GetProperty("occurredUtc").GetString());
        Assert.True(json.Length <= DesktopBridgeProtocol.MaximumSystemLifecycleMessageLength);
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
    }

    [Fact]
    public void ExistingWindowStateMessageContractRemainsUnchanged()
    {
        using var document = JsonDocument.Parse(DesktopBridgeProtocol.CreateWindowStateMessage(true));
        var root = document.RootElement;

        Assert.Equal("desktop.windowState", root.GetProperty("type").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.True(root.GetProperty("foreground").GetBoolean());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Fact]
    public void ResumePayloadUsesAdditiveTypeWithoutRaisingProtocolVersion()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateSystemLifecycleMessage(
                new DesktopSystemLifecycleMessage(
                    DesktopSystemLifecycleKind.Resume,
                    12,
                    OccurredUtc,
                    null)));
        var root = document.RootElement;

        Assert.Equal("desktop.system.resume", root.GetProperty("type").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal(4, root.EnumerateObject().Count());
        Assert.False(root.TryGetProperty("available", out _));
    }

    [Fact]
    public void NetworkPayloadIncludesAvailabilityOnly()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateSystemLifecycleMessage(
                new DesktopSystemLifecycleMessage(
                    DesktopSystemLifecycleKind.NetworkChanged,
                    13,
                    OccurredUtc,
                    true)));
        var root = document.RootElement;

        Assert.Equal("desktop.network.changed", root.GetProperty("type").GetString());
        Assert.True(root.GetProperty("available").GetBoolean());
        Assert.Equal(5, root.EnumerateObject().Count());
    }

    [Fact]
    public void EventBeforePrimaryRegistrationIsDeliveredWhileFresh()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            3,
            OccurredUtc,
            null));

        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.NotifyBridgeReady(primary);

        Assert.Single(primary.LifecycleMessages);
        Assert.Equal(3, primary.LifecycleMessages[0].Generation);
    }

    [Fact]
    public void SecondWindowOpenedAfterTtlDoesNotReceiveStaleEvent()
    {
        var now = OccurredUtc;
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = new DesktopSystemLifecycleBroadcaster(manager, () => now);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        var secondary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            8,
            OccurredUtc,
            null));
        Assert.Single(primary.LifecycleMessages);

        now = OccurredUtc + DesktopSystemLifecycleMessage.MaxAge + TimeSpan.FromSeconds(1);
        manager.OpenSecondaryFrom(primary);
        manager.NotifyBridgeReady(secondary);

        Assert.Empty(secondary.LifecycleMessages);
        Assert.Null(broadcaster.CurrentMessage);
    }

    [Fact]
    public void StaleStartupEventIsNotDeliveredToTheFirstWindow()
    {
        var now = OccurredUtc;
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = new DesktopSystemLifecycleBroadcaster(manager, () => now);
        manager.AttachLifecycleBroadcaster(broadcaster);
        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            2,
            OccurredUtc,
            null));

        now = OccurredUtc + DesktopSystemLifecycleMessage.MaxAge + TimeSpan.FromSeconds(1);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.NotifyBridgeReady(primary);

        Assert.Empty(primary.LifecycleMessages);
    }

    [Fact]
    public void ClosedPendingWindowIsRemovedAndDoesNotReceiveTheEvent()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        var secondary = new DesktopWindowManagerTestsWindow();
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        manager.OpenSecondaryFrom(primary);
        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            11,
            OccurredUtc,
            null));
        Assert.Empty(secondary.LifecycleMessages);

        secondary.RaiseClosed();
        secondary.BridgeReady = true;
        manager.NotifyBridgeReady(secondary);

        Assert.Empty(secondary.LifecycleMessages);
        Assert.Single(primary.LifecycleMessages);
    }

    [Fact]
    public void NewWindowCreatedAfterPublishDoesNotReceiveTheCurrentEvent()
    {
        var manager = new DesktopWindowManager(BaseUri);
        var broadcaster = CreateBroadcaster(manager);
        manager.AttachLifecycleBroadcaster(broadcaster);
        var primary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        var secondary = new DesktopWindowManagerTestsWindow { BridgeReady = true };
        manager.RegisterPrimary(primary);
        manager.ConfigureSecondaryFactory(_ => secondary);
        broadcaster.Publish(new DesktopSystemLifecycleMessage(
            DesktopSystemLifecycleKind.Resume,
            5,
            OccurredUtc,
            null));

        manager.OpenSecondaryFrom(primary);
        manager.NotifyBridgeReady(secondary);

        Assert.Single(primary.LifecycleMessages);
        Assert.Empty(secondary.LifecycleMessages);
    }

    private sealed class ManualDelayScheduler : IDesktopDelayScheduler
    {
        public int ScheduleCount { get; private set; }

        public Action? Pending { get; private set; }

        public IDisposable Schedule(TimeSpan delay, Action callback)
        {
            ArgumentNullException.ThrowIfNull(callback);
            ScheduleCount++;
            Pending = callback;
            return new Cancel(this, callback);
        }

        public void RunPending()
        {
            var callback = Pending;
            Pending = null;
            callback?.Invoke();
        }

        private sealed class Cancel(ManualDelayScheduler owner, Action callback) : IDisposable
        {
            public void Dispose()
            {
                if (ReferenceEquals(owner.Pending, callback))
                {
                    owner.Pending = null;
                }
            }
        }
    }

    private sealed class FakeDesktopSystemEventSource : IDesktopSystemEventSource
    {
        public bool Disposed { get; private set; }

        public event EventHandler? Resumed;

        public event EventHandler<bool>? NetworkAvailabilityChanged;

        public void RaiseResume() => Resumed?.Invoke(this, EventArgs.Empty);

        public void RaiseNetwork(bool available) =>
            NetworkAvailabilityChanged?.Invoke(this, available);

        public void Dispose() => Disposed = true;
    }

    private sealed class DesktopWindowManagerTestsWindow : IDesktopHubWindow
    {
        public bool IsVisible { get; private set; } = true;

        public bool IsActive { get; private set; }

        public string? CurrentSource { get; set; } = "https://hubit.zsgp.ru/chat";

        public bool BridgeReady { get; set; }

        public List<DesktopSystemLifecycleMessage> LifecycleMessages { get; } = [];

        public event EventHandler? Activated;

        public event EventHandler? Closed;

        public void ShowAndActivate()
        {
            IsVisible = true;
            IsActive = true;
            Activated?.Invoke(this, EventArgs.Empty);
        }

        public void ShowAndNavigate(string? route)
        {
            _ = route;
            ShowAndActivate();
        }

        public void ReloadWithoutCache()
        {
        }

        public bool TryDeliverSystemLifecycle(DesktopSystemLifecycleMessage message)
        {
            if (!BridgeReady)
            {
                return false;
            }

            LifecycleMessages.Add(message);
            return true;
        }

        public void RaiseClosed()
        {
            IsVisible = false;
            IsActive = false;
            Closed?.Invoke(this, EventArgs.Empty);
        }
    }
}
