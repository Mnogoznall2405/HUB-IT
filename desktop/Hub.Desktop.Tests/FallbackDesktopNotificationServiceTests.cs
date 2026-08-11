using Hub.Desktop.Interop;
using Hub.Desktop.Notifications;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class FallbackDesktopNotificationServiceTests
{
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
}
