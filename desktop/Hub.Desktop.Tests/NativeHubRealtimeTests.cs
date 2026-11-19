using System.Text.Json;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Нативный hub realtime: разбор конвертов по контракту hubRealtimeSocket.js
/// (служебные кадры не доходят до подписчиков, dedup по payload.event_id,
/// ws_ticket на auth.required) и маршрутизация доменных событий шеллом
/// в тихие REST-рефреши страниц.
/// </summary>
[Collection("NativeTheme")]
public sealed class NativeHubRealtimeTests
{
    private static readonly NativeSession Session = new(
        AccessToken: "access",
        RefreshToken: "refresh",
        ClientDeviceId: "desktop-test",
        AccessTokenExpiresAtUtc: DateTimeOffset.UtcNow.AddMinutes(15),
        UserId: 7,
        UserName: "ivanov",
        FullName: "Иван Иванов");

    // ---- Разбор конвертов ----

    [Fact]
    public void DomainEventIsDispatchedWithTypeAndPayload()
    {
        var (client, events) = ClientWithCollector();

        client.HandleEnvelopeForTest(
            "{\"type\":\"mail.message.received\",\"payload\":{\"event_id\":\"e-1\",\"message_id\":\"m-9\"}}");

        var item = Assert.Single(events);
        Assert.Equal("mail.message.received", item.Type);
        Assert.Equal("e-1", item.Payload.GetProperty("event_id").GetString());
        Assert.Equal("m-9", item.Payload.GetProperty("message_id").GetString());
    }

    [Fact]
    public void MalformedAndIncompleteFramesAreIgnored()
    {
        var (client, events) = ClientWithCollector();

        client.HandleEnvelopeForTest("не json");
        client.HandleEnvelopeForTest("[1,2]");
        client.HandleEnvelopeForTest("{\"payload\":{\"event_id\":\"e-2\"}}");
        client.HandleEnvelopeForTest("{\"type\":42,\"payload\":{}}");
        client.HandleEnvelopeForTest("{\"type\":\"  \",\"payload\":{}}");

        Assert.Empty(events);
    }

    [Fact]
    public void ServiceFramesAreNotDispatchedToSubscribers()
    {
        var (client, events) = ClientWithCollector();

        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.pong\",\"request_id\":\"r1\"}");
        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.auth.ok\",\"payload\":{}}");
        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.auth.rejected\",\"payload\":{}}");
        client.HandleEnvelopeForTest("{\"type\":\"tasks.presence.snapshot\",\"payload\":{}}");
        client.HandleEnvelopeForTest("{\"type\":\"tasks.presence.heartbeat\",\"payload\":{}}");

        Assert.Empty(events);
    }

    [Fact]
    public void ConnectedFrameSetsStateAndReachesSubscribers()
    {
        var (client, events) = ClientWithCollector();
        var states = new List<HubRealtimeState>();
        client.StateChanged += (_, state) => states.Add(state);

        client.HandleEnvelopeForTest(
            "{\"type\":\"hub.realtime.connected\",\"payload\":{\"connection_id\":\"c-1\"}}");

        var item = Assert.Single(events);
        Assert.Equal("hub.realtime.connected", item.Type);
        Assert.Equal("c-1", item.Payload.GetProperty("connection_id").GetString());
        Assert.Equal(HubRealtimeState.Connected, client.State);
        Assert.Equal([HubRealtimeState.Connected], states);
    }

    [Fact]
    public void EventsAreDeduplicatedByPayloadEventId()
    {
        var (client, events) = ClientWithCollector();

        client.HandleEnvelopeForTest("{\"type\":\"mail.message.received\",\"payload\":{\"event_id\":\"e-1\"}}");
        client.HandleEnvelopeForTest("{\"type\":\"mail.message.received\",\"payload\":{\"event_id\":\"e-1\"}}");
        client.HandleEnvelopeForTest("{\"type\":\"mail.message.received\",\"payload\":{\"event_id\":\"e-2\"}}");
        // Кадры без event_id не дедуплицируются (веб claimEvent).
        client.HandleEnvelopeForTest("{\"type\":\"mail.unread.changed\",\"payload\":{\"count\":3}}");
        client.HandleEnvelopeForTest("{\"type\":\"mail.unread.changed\",\"payload\":{\"count\":3}}");

        Assert.Equal(4, events.Count);
        Assert.Equal("e-1", events[0].Payload.GetProperty("event_id").GetString());
        Assert.Equal("e-2", events[1].Payload.GetProperty("event_id").GetString());
    }

    [Fact]
    public void SubscriberExceptionDoesNotBreakDispatch()
    {
        var api = new FakeHubApiClient();
        var client = new HubRealtimeClient(api);
        var seen = 0;
        client.EventReceived += (_, _) => throw new InvalidOperationException("boom");
        client.EventReceived += (_, _) => seen++;

        client.HandleEnvelopeForTest("{\"type\":\"tasks.task.created\",\"payload\":{\"event_id\":\"t-1\"}}");

        Assert.Equal(1, seen);
    }

    [Fact]
    public async Task AuthRequiredRequestsWsTicketOnceWhileInFlight()
    {
        var api = new FakeHubApiClient();
        var gate = new TaskCompletionSource<HubWsTicket>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        api.ChatWsTicketHandler = _ => gate.Task;
        var client = new HubRealtimeClient(api);

        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.auth.required\",\"payload\":{}}");
        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.auth.required\",\"payload\":{}}");

        await WaitFor(() => api.ChatWsTicketCallCount == 1);
        // Пока первый тикет не получен — повторные auth.required склеиваются.
        await Task.Delay(100);
        Assert.Equal(1, api.ChatWsTicketCallCount);

        gate.SetResult(new HubWsTicket { Ticket = "t-1", ExpiresIn = 30 });
        await WaitFor(() => api.ChatWsTicketCallCount == 1);
        await Task.Delay(100);

        // После завершения in-flight новый auth.required берёт новый тикет.
        client.HandleEnvelopeForTest("{\"type\":\"hub.realtime.auth.required\",\"payload\":{}}");
        await WaitFor(() => api.ChatWsTicketCallCount == 2);
    }

    [Fact]
    public void AuthFrameMatchesWebContract()
    {
        using var document = JsonDocument.Parse(HubRealtimeClient.BuildAuthFrame("ticket-42"));
        var root = document.RootElement;

        Assert.Equal("hub.realtime.auth", root.GetProperty("type").GetString());
        Assert.Equal("ticket-42", root.GetProperty("payload").GetProperty("ws_ticket").GetString());
    }

    [Fact]
    public void ReconnectDelayMatchesWebBackoffShape()
    {
        // 4000 (evicted): minDelay 120с доминирует — ровно 120с на любой попытке.
        for (var attempt = 0; attempt < 8; attempt++)
        {
            Assert.Equal(
                TimeSpan.FromSeconds(120),
                HubRealtimeClient.ReconnectDelay(attempt, TimeSpan.FromSeconds(120)));
        }

        // Обычный разрыв: [1,2,5,10,20,30] ±25% (+spread до 5с на первой попытке).
        for (var i = 0; i < 200; i++)
        {
            var first = HubRealtimeClient.ReconnectDelay(0, TimeSpan.Zero);
            Assert.InRange(first, TimeSpan.FromSeconds(0.75), TimeSpan.FromSeconds(6.25));

            var fifth = HubRealtimeClient.ReconnectDelay(5, TimeSpan.Zero);
            Assert.InRange(fifth, TimeSpan.FromSeconds(22.5), TimeSpan.FromSeconds(30));

            var beyond = HubRealtimeClient.ReconnectDelay(100, TimeSpan.Zero);
            Assert.InRange(beyond, TimeSpan.FromSeconds(22.5), TimeSpan.FromSeconds(30));
        }
    }

    // ---- Жизненный цикл и роутинг в шелле ----

    [Fact]
    public async Task InitializeStartsHubRealtimeAfterPages()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.Equal(1, realtime.StartCalls);
    }

    [Fact]
    public async Task RealtimeStartFailureDoesNotBlockShell()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime { StartException = new HttpRequestException("ws down") };
        var model = new HubShellViewModel(api, realtime);

        await model.InitializeAsync();

        Assert.Equal(HubShellState.Ready, model.State);
        Assert.Equal(1, realtime.StartCalls);
    }

    [Fact]
    public async Task MailEventTriggersSilentMailRefresh()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MailUnreadCount = new HubMailUnreadCount { Count = 4 },
        };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var unreadCalls = api.MailUnreadCountCallCount;
        var messageCalls = api.MailMessagesCallCount;

        realtime.RaiseEvent("mail.message.received", "{\"event_id\":\"m-1\"}");

        await WaitFor(() => api.MailUnreadCountCallCount > unreadCalls
            && api.MailMessagesCallCount > messageCalls);
        Assert.Equal(4, model.Mail.TotalUnreadCount);
        Assert.False(model.Mail.IsLoading);
    }

    [Fact]
    public async Task MailRefreshKeepsSelectedMessage()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MailBootstrap = new HubMailBootstrap
            {
                SelectedMailbox = new HubMailMailboxInfo
                {
                    Id = "mb-1",
                    Label = "user@zsgp.ru",
                    MailIsConfigured = true,
                },
                FolderTree = new HubMailFolderTree { Items = [] },
                Messages = new HubMailMessagePage
                {
                    Items = [new HubMailMessagePreview { Id = "msg-7", Subject = "Первое" }],
                },
            },
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [new HubMailMessagePreview { Id = "msg-7", Subject = "Первое" }],
            },
        };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var item = Assert.Single(model.Mail.Items);
        model.Mail.SelectedItem = item;

        realtime.RaiseEvent("mail.message.received", "{\"event_id\":\"m-2\"}");
        await WaitFor(() => api.MailUnreadCountCallCount > 0);
        await Task.Delay(100);

        Assert.NotNull(model.Mail.SelectedItem);
        Assert.Equal("msg-7", model.Mail.SelectedItem!.Id);
    }

    [Fact]
    public async Task TaskEventRefreshesTasksAndDashboardWithoutSelectionLoss()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            TasksPage = new HubTaskListPage
            {
                Items = [new HubTaskItem { Id = 11, Title = "Задача", Status = "new" }],
                Total = 1,
            },
        };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var item = Assert.Single(model.Tasks.Items);
        model.Tasks.SelectedItem = item;
        var taskCalls = api.TasksCallCount;
        var dashboardCalls = api.DashboardCallCount;

        realtime.RaiseEvent("tasks.task.updated", "{\"event_id\":\"t-1\"}");

        await WaitFor(() => api.TasksCallCount > taskCalls
            && api.DashboardCallCount > dashboardCalls);
        Assert.NotNull(model.Tasks.SelectedItem);
        Assert.Equal(11, model.Tasks.SelectedItem!.Id);
    }

    [Fact]
    public async Task DocflowEventRefreshesListAndInboxBadge()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            DocflowInboxSummary = new HubDocflowInboxSummary { Status = "available", Count = 3 },
        };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var taskCalls = api.DocflowTasksCallCount;
        var summaryCalls = api.DocflowInboxSummaryCallCount;

        realtime.RaiseEvent("docflow.task.changed", "{\"event_id\":\"d-1\"}");

        await WaitFor(() => api.DocflowTasksCallCount > taskCalls
            && api.DocflowInboxSummaryCallCount > summaryCalls);
        Assert.Equal(3, model.Docflow.InboxCount);
    }

    [Fact]
    public async Task DashboardInvalidateRefreshesDashboard()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var dashboardCalls = api.DashboardCallCount;

        realtime.RaiseEvent("dashboard.invalidate", "{\"event_id\":\"dash-1\"}");

        await WaitFor(() => api.DashboardCallCount > dashboardCalls);
    }

    [Fact]
    public async Task NotificationEventRefreshesMailBadge()
    {
        var api = new FakeHubApiClient
        {
            StoredSession = Session,
            MailUnreadCount = new HubMailUnreadCount { Count = 2 },
        };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var unreadCalls = api.MailUnreadCountCallCount;

        realtime.RaiseEvent("hub.notification.created", "{\"event_id\":\"n-1\"}");

        await WaitFor(() => api.MailUnreadCountCallCount > unreadCalls);
    }

    [Fact]
    public async Task FirstConnectedFrameSkipsResyncSecondResyncsAll()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var mailCalls = api.MailUnreadCountCallCount;
        var taskCalls = api.TasksCallCount;
        var docflowCalls = api.DocflowTasksCallCount;
        var dashboardCalls = api.DashboardCallCount;

        realtime.RaiseEvent("hub.realtime.connected", "{\"connection_id\":\"c-1\"}");
        await Task.Delay(150);

        // Первый connected — холодный старт сразу после загрузки страниц.
        Assert.Equal(mailCalls, api.MailUnreadCountCallCount);
        Assert.Equal(taskCalls, api.TasksCallCount);
        Assert.Equal(docflowCalls, api.DocflowTasksCallCount);
        Assert.Equal(dashboardCalls, api.DashboardCallCount);

        // Второй — reconnect: за разрыв могли пропустить события, догоняем.
        realtime.RaiseEvent("hub.realtime.connected", "{\"connection_id\":\"c-2\"}");

        await WaitFor(() => api.MailUnreadCountCallCount > mailCalls
            && api.TasksCallCount > taskCalls
            && api.DocflowTasksCallCount > docflowCalls
            && api.DashboardCallCount > dashboardCalls);
    }

    [Fact]
    public async Task UnknownEventTypeIsIgnored()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();
        var mailCalls = api.MailUnreadCountCallCount;
        var taskCalls = api.TasksCallCount;
        var dashboardCalls = api.DashboardCallCount;

        realtime.RaiseEvent("integration.1c.sync.completed", "{\"event_id\":\"i-1\"}");
        realtime.RaiseEvent("tasks.presence.snapshot", "{}");
        await Task.Delay(150);

        Assert.Equal(mailCalls, api.MailUnreadCountCallCount);
        Assert.Equal(taskCalls, api.TasksCallCount);
        Assert.Equal(dashboardCalls, api.DashboardCallCount);
    }

    [Fact]
    public async Task SessionEndedStopsRealtimeAndUnsubscribes()
    {
        var api = new FakeHubApiClient { StoredSession = Session };
        var realtime = new FakeHubRealtime();
        var model = new HubShellViewModel(api, realtime);
        await model.InitializeAsync();

        api.RaiseSessionEnded();

        Assert.Equal(HubShellState.SignedOut, model.State);
        Assert.Equal(1, realtime.StopCalls);
        Assert.Equal(0, realtime.DisposeCalls);

        // Отписка: события после выхода не инициируют REST-рефреши.
        var mailCalls = api.MailUnreadCountCallCount;
        var taskCalls = api.TasksCallCount;
        realtime.RaiseEvent("mail.message.received", "{\"event_id\":\"m-3\"}");
        realtime.RaiseEvent("tasks.task.created", "{\"event_id\":\"t-9\"}");
        await Task.Delay(150);

        Assert.Equal(mailCalls, api.MailUnreadCountCallCount);
        Assert.Equal(taskCalls, api.TasksCallCount);
    }

    // ---- helpers ----

    private static (HubRealtimeClient Client, List<HubRealtimeEvent> Events) ClientWithCollector()
    {
        var client = new HubRealtimeClient(new FakeHubApiClient());
        var events = new List<HubRealtimeEvent>();
        client.EventReceived += (_, item) => events.Add(item);
        return (client, events);
    }

    private static async Task WaitFor(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }
}
