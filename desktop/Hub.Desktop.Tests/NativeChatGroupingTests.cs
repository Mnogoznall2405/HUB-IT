using Hub.Desktop.Native;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Визуальная группировка сообщений (Telegram-стиль): пилюля-разделитель дня,
/// серии одного отправителя (IsGroupStart/IsGroupEnd), аватар у крайнего
/// входящего сообщения серии в группах, системные плашки без аватара.
/// </summary>
public sealed class NativeChatGroupingTests
{
    [Fact]
    public async Task GroupConversationGroupingFlags()
    {
        // Полдень локального дня: «сегодня»/«завтра» не переворачиваются
        // на границе полуночи при любом часовом поясе CI-машины.
        var now = DateTimeOffset.Now.Date.AddHours(12);
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [new HubChatConversation { Id = "g1", Kind = "group", Title = "Группа" }],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "g1", "ира 1", now.AddMinutes(-10), sender: "Ирина Петрова"),
                    Msg("m2", "g1", "ира 2", now.AddMinutes(-9), sender: "Ирина Петрова"),
                    Msg("m3", "g1", "своё 1", now.AddMinutes(-8), own: true),
                    Msg("m4", "g1", "своё 2", now.AddMinutes(-7), own: true),
                    Msg("m5", "g1", "пётр", now.AddMinutes(-6), sender: "Пётр Петров"),
                    Msg("m6", "g1", "системное", now.AddMinutes(-5), kind: "system"),
                    Msg("m7", "g1", "ира 3", now.AddMinutes(-4), sender: "Ирина Петрова"),
                    Msg("m8", "g1", "завтра", now.AddDays(1), own: true),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 8 && !model.IsLoadingMessages);
        await Task.Delay(150);

        Assert.True(
            model.Messages.Count == 8,
            $"count={model.Messages.Count} loading={model.IsLoadingMessages} banner={model.BannerErrorText}");

        var m1 = model.Messages[0];
        var m2 = model.Messages[1];
        var m3 = model.Messages[2];
        var m4 = model.Messages[3];
        var m5 = model.Messages[4];
        var m6 = model.Messages[5];
        var m7 = model.Messages[6];
        var m8 = model.Messages[7];

        // Разделитель дня: только у первого сообщения и у m8 (другой день).
        Assert.True(m1.ShowDaySeparator);
        Assert.Equal("Сегодня", m1.DaySeparatorText);
        Assert.False(m2.ShowDaySeparator);
        Assert.False(m7.ShowDaySeparator);
        Assert.True(m8.ShowDaySeparator);

        // Серии: [ира,ира][своё,своё][пётр][system][ира][своё/завтра].
        Assert.True(m1.IsGroupStart);
        Assert.False(m1.IsGroupEnd);
        Assert.False(m2.IsGroupStart);
        Assert.True(m2.IsGroupEnd);

        Assert.True(m3.IsGroupStart);
        Assert.False(m3.IsGroupEnd);
        Assert.False(m4.IsGroupStart);
        Assert.True(m4.IsGroupEnd);

        Assert.True(m5.IsGroupStart);
        Assert.True(m5.IsGroupEnd);

        Assert.True(m6.IsSystem);
        Assert.True(m6.IsGroupStart);
        Assert.True(m6.IsGroupEnd);

        Assert.True(m7.IsGroupStart);
        Assert.True(m7.IsGroupEnd);
        Assert.True(m8.IsGroupStart);
        Assert.True(m8.IsGroupEnd);

        // Аватар: входящие в группе, только у крайнего сообщения серии.
        Assert.True(m2.ShowSenderAvatar);
        Assert.False(m1.ShowSenderAvatar);
        Assert.True(m5.ShowSenderAvatar);
        Assert.True(m7.ShowSenderAvatar);
        Assert.False(m3.ShowSenderAvatar); // своё
        Assert.False(m6.ShowSenderAvatar); // system
        Assert.Equal("И", m2.SenderAvatarInitial);
        Assert.Equal("П", m5.SenderAvatarInitial);

        // Карточки действия из фейковых данных не сидят — HasActionCard=false.
        Assert.All(model.Messages, m => Assert.False(m.HasActionCard));
    }

    [Fact]
    public async Task DirectConversationHasNoAvatarAndRealtimeAppendRegroups()
    {
        var now = DateTimeOffset.Now.Date.AddHours(12);
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [new HubChatConversation { Id = "d1", Kind = "direct", Title = "Личка" }],
            },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "d1", "первое", now.AddMinutes(-2), sender: "Ирина")],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        // В личке аватар/имя отправителя не показываются.
        Assert.False(model.Messages[0].ShowSender);
        Assert.False(model.Messages[0].ShowSenderAvatar);
        Assert.True(model.Messages[0].IsGroupEnd);

        // Realtime-доставка сообщения того же отправителя:
        // старое перестаёт быть концом серии, новое становится концом.
        realtime.RaiseEvent(
            "chat.message_received",
            "{\"message\":{\"id\":\"m2\",\"conversation_id\":\"d1\",\"kind\":\"text\"," +
            "\"body\":\"второе\",\"created_at\":\"" + now.ToString("o") + "\"," +
            "\"sender\":{\"id\":7,\"full_name\":\"Ирина\"}}}");

        Assert.Equal(2, model.Messages.Count);
        Assert.False(model.Messages[0].IsGroupEnd);
        Assert.True(model.Messages[1].IsGroupEnd);
        Assert.False(model.Messages[1].ShowDaySeparator);
    }

    [Fact]
    public async Task UnreadDividerAnchorsOnViewerLastReadAndDoesNotDuplicate()
    {
        var now = DateTimeOffset.Now.Date.AddHours(12);
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation
                    {
                        Id = "g1", Kind = "group", Title = "Группа", UnreadCount = 2,
                    },
                ],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "g1", "раз", now.AddMinutes(-4)),
                    Msg("m2", "g1", "два", now.AddMinutes(-3)),
                    Msg("m3", "g1", "своё", now.AddMinutes(-2), own: true),
                    Msg("m4", "g1", "четыре", now.AddMinutes(-1)),
                ],
                // Прочитано до m2 — полоса над первым входящим после m2.
                ViewerLastReadMessageId = "m2",
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 4);

        // m3 — своё (полосой не становится), первый входящий после m2 — m4.
        Assert.Single(model.Messages, m => m.ShowUnreadDivider);
        Assert.True(model.Messages[3].ShowUnreadDivider);
        Assert.False(model.Messages[2].ShowUnreadDivider);

        // Realtime-вставка не дублирует полосу.
        realtime.RaiseEvent(
            "chat.message_received",
            "{\"message\":{\"id\":\"m5\",\"conversation_id\":\"g1\",\"kind\":\"text\"," +
            "\"body\":\"пять\",\"created_at\":\"" + now.ToString("o") + "\"," +
            "\"sender\":{\"id\":7,\"full_name\":\"Ирина\"}}}");
        Assert.Equal(5, model.Messages.Count);
        Assert.Single(model.Messages, m => m.ShowUnreadDivider);

        // Переоткрытие после прочтения — полоса исчезает (one-shot). Фейк
        // отдаёт исходные 4 сообщения: realtime m5 в списке API нет.
        model.SelectedConversation = null;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 4 && !model.IsLoadingMessages);
        Assert.DoesNotContain(model.Messages, m => m.ShowUnreadDivider);
    }

    [Fact]
    public async Task UnreadDividerFallsBackToUnreadCountAndSkipsRead()
    {
        var now = DateTimeOffset.Now.Date.AddHours(12);
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation
                    {
                        Id = "d1", Kind = "direct", Title = "Личка", UnreadCount = 2,
                    },
                ],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "d1", "раз", now.AddMinutes(-4)),
                    Msg("m2", "d1", "два", now.AddMinutes(-3)),
                    Msg("m3", "d1", "своё", now.AddMinutes(-2), own: true),
                    Msg("m4", "d1", "четыре", now.AddMinutes(-1)),
                ],
                // viewer_last_read_message_id не приходит — запасной путь:
                // UnreadCount-е входящее с конца (m4 → m2).
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 4);

        Assert.Single(model.Messages, m => m.ShowUnreadDivider);
        Assert.True(model.Messages[1].ShowUnreadDivider);

        // Диалог без непрочитанных — полосы нет.
        var readApi = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation
                    {
                        Id = "d2", Kind = "direct", Title = "Личка 2", UnreadCount = 0,
                    },
                ],
            },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "d2", "раз", now.AddMinutes(-1))],
            },
        };
        var readModel = new ChatViewModel(readApi, new FakeChatRealtime());
        await readModel.LoadAsync();
        readModel.SelectedConversation = readModel.Conversations[0];
        await WaitFor(() => readModel.Messages.Count == 1);
        Assert.DoesNotContain(readModel.Messages, m => m.ShowUnreadDivider);
    }

    [Fact]
    public async Task ConversationAvatarLoadsPhotoOverInitials()
    {
        // Фото-аватар диалога: avatar_url пира → AuthImageLoader → ImageBrush
        // поверх градиента (HasAvatarImage); без loader остаются инициалы.
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);
        var item = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "d1",
            Kind = "direct",
            Title = "Ирина Петрова",
            DirectPeer = new HubChatUser
            {
                Id = 11, Username = "petrova", FullName = "Ирина Петрова",
                AvatarUrl = "avatars/u11.png",
            },
        });

        Assert.False(item.HasAvatarImage);
        Assert.Equal("ИП", item.AvatarInitials);

        item.AvatarLoader = loader;
        await WaitFor(() => item.HasAvatarImage);

        Assert.NotNull(item.AvatarImage);
        Assert.Equal("avatars/u11.png", Assert.Single(api.ImageDownloadCalls));
    }

    [Fact]
    public async Task ConversationAvatarStaysOnInitialsWhenNoUrlOrNoLoader()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);

        // Без avatar_url — фото не запрашивается, сеть не дергается.
        var noUrl = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "g1", Kind = "group", Title = "Группа",
        })
        {
            AvatarLoader = loader,
        };
        await Task.Delay(120);
        Assert.False(noUrl.HasAvatarImage);
        Assert.Empty(api.ImageDownloadCalls);

        // С avatar_url, но без loader — тоже без сети (loader подставит ChatViewModel).
        var noLoader = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "g2", Kind = "group", Title = "Группа", AvatarUrl = "avatars/g2.png",
        });
        await Task.Delay(120);
        Assert.False(noLoader.HasAvatarImage);
        Assert.Empty(api.ImageDownloadCalls);
    }

    private static HubChatMessage Msg(
        string id,
        string conversationId,
        string body,
        DateTimeOffset createdAt,
        bool own = false,
        string sender = "Пётр Петров",
        string kind = "text") =>
        new()
        {
            Id = id,
            ConversationId = conversationId,
            Kind = kind,
            Body = body,
            CreatedAt = createdAt,
            IsOwn = own,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = sender },
        };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(3);
        var elapsed = TimeSpan.Zero;
        var step = TimeSpan.FromMilliseconds(20);
        while (!condition())
        {
            if (elapsed > limit)
            {
                throw new TimeoutException("Condition was not met in time.");
            }

            await Task.Delay(step);
            elapsed += step;
        }
    }
}
