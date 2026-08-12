using Hub.Desktop.Interop;
using Hub.Desktop.Notifications;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class FallbackDesktopNotificationServiceTests
{
    [Fact]
    public void AdministrativePolicyCanDisableOnlyThePersistentFallback()
    {
        var primary = new StubNotificationService(isAvailable: false, showResult: false);
        var fallbackCalls = 0;
        var service = new FallbackDesktopNotificationService(
            primary,
            fallbackEnabled: false);
        service.SetFallback(_ =>
        {
            fallbackCalls++;
            return true;
        });

        Assert.False(service.IsAvailable);
        Assert.False(service.TryShow(Request));
        Assert.Equal(0, fallbackCalls);
    }
    private static readonly DesktopNotificationRequest Request = new(
        "chat:msg:42",
        "Новое сообщение",
        "Проверка уведомления",
        "/chat?conversation=7&message=42");

    [Fact]
    public void UsesPrimaryChannelWhenItSucceeds()
    {
        var primary = new StubNotificationService(isAvailable: true, showResult: true);
        var service = new FallbackDesktopNotificationService(primary);
        var fallbackCalls = 0;
        service.SetFallback(_ =>
        {
            fallbackCalls += 1;
            return true;
        });

        Assert.True(service.IsAvailable);
        Assert.True(service.TryShow(Request));
        Assert.Equal(1, primary.ShowCalls);
        Assert.Equal(0, fallbackCalls);
    }

    [Fact]
    public void UsesTrayFallbackWhenPrimaryChannelIsUnavailable()
    {
        var primary = new StubNotificationService(isAvailable: false, showResult: false);
        var service = new FallbackDesktopNotificationService(primary);
        DesktopNotificationRequest? received = null;
        service.SetFallback(request =>
        {
            received = request;
            return true;
        });

        Assert.True(service.IsAvailable);
        Assert.True(service.TryShow(Request));
        Assert.Equal(Request, received);
    }

    [Fact]
    public void UsesPreferredDesktopPresenterBeforePrimaryChannel()
    {
        var primary = new StubNotificationService(isAvailable: true, showResult: true);
        var service = new FallbackDesktopNotificationService(primary);
        var presenterCalls = 0;
        service.SetFallback(_ =>
        {
            presenterCalls += 1;
            return true;
        }, preferFallback: true);

        Assert.True(service.TryShow(Request));
        Assert.Equal(1, presenterCalls);
        Assert.Equal(0, primary.ShowCalls);
    }

    [Fact]
    public void ReportsUnavailableAfterFallbackIsCleared()
    {
        var service = new FallbackDesktopNotificationService(
            new StubNotificationService(isAvailable: false, showResult: false));
        service.SetFallback(_ => true);

        service.ClearFallback();

        Assert.False(service.IsAvailable);
        Assert.False(service.TryShow(Request));
    }

    [Fact]
    public void ShowsTheSameNotificationIdOnlyOncePerProcess()
    {
        var primary = new StubNotificationService(isAvailable: true, showResult: true);
        var service = new FallbackDesktopNotificationService(primary);

        Assert.True(service.TryShow(Request));
        Assert.True(service.TryShow(Request));
        Assert.Equal(1, primary.ShowCalls);
    }

    [Fact]
    public void FailedDeliveryDoesNotPoisonDeduplication()
    {
        var primary = new SequenceNotificationService(false, true);
        var service = new FallbackDesktopNotificationService(primary);

        Assert.False(service.TryShow(Request));
        Assert.True(service.TryShow(Request));
        Assert.Equal(2, primary.ShowCalls);
    }

    [Fact]
    public void RequestPolicyCanSuppressAPopupWithoutReportingDeliveryFailure()
    {
        var primary = new StubNotificationService(isAvailable: true, showResult: true);
        var service = new FallbackDesktopNotificationService(primary);
        service.SetRequestPolicy(_ => null);

        Assert.True(service.TryShow(Request));
        Assert.True(service.TryShow(Request));
        Assert.Equal(0, primary.ShowCalls);
    }

    [Fact]
    public void RequestPolicyCanRemovePrivateContentBeforeEveryPresenter()
    {
        var primary = new CapturingNotificationService();
        var service = new FallbackDesktopNotificationService(primary);
        service.SetRequestPolicy(request => request with
        {
            Title = "Новое уведомление HUB",
            Body = "Откройте HUB после разблокировки",
        });

        Assert.True(service.TryShow(Request));

        Assert.NotNull(primary.Request);
        Assert.Equal("Новое уведомление HUB", primary.Request.Title);
        Assert.DoesNotContain("Проверка", primary.Request.Body, StringComparison.Ordinal);
        Assert.Equal(Request.Route, primary.Request.Route);
    }

    private sealed class StubNotificationService(bool isAvailable, bool showResult)
        : IDesktopNotificationService
    {
        public bool IsAvailable { get; } = isAvailable;

        public int ShowCalls { get; private set; }

        public bool TryShow(DesktopNotificationRequest request)
        {
            ShowCalls += 1;
            return showResult;
        }
    }

    private sealed class SequenceNotificationService(params bool[] results)
        : IDesktopNotificationService
    {
        private readonly Queue<bool> _results = new(results);

        public bool IsAvailable => true;

        public int ShowCalls { get; private set; }

        public bool TryShow(DesktopNotificationRequest request)
        {
            ShowCalls += 1;
            return _results.Count > 0 && _results.Dequeue();
        }
    }

    private sealed class CapturingNotificationService : IDesktopNotificationService
    {
        public bool IsAvailable => true;

        public DesktopNotificationRequest? Request { get; private set; }

        public bool TryShow(DesktopNotificationRequest request)
        {
            Request = request;
            return true;
        }
    }
}
