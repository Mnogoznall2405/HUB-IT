using System.Text.Json;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeChatViewModelTests
{
    // ---- Загрузка и сортировка ----

    [Fact]
    public async Task LoadSortsPinnedFirstThenByDateDescAndStartsRealtime()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1", lastAt: now),
                    Conv("c2", lastAt: now.AddDays(-5), pinned: true),
                    Conv("c3", lastAt: now.AddHours(-1)),
                ],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);

        await model.LoadAsync();

        Assert.Equal(["c2", "c1", "c3"], model.Conversations.Select(c => c.Id).ToArray());
        Assert.Equal(1, realtime.StartCalls);
        Assert.Equal("офлайн", model.ConnectionStatusText);
    }

    [Fact]
    public async Task EmptyConversationListShowsEmptyState()
    {
        var model = new ChatViewModel(new FakeHubApiClient(), new FakeChatRealtime());

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Empty(model.Conversations);
    }

    [Fact]
    public async Task LoadErrorPropagatesAndSetLoadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConversationsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());

        await Assert.ThrowsAsync<HubApiException>(() => model.LoadAsync());
        model.SetLoadError(TasksViewModel.DescribeError(
            new HubApiException(HubApiErrorKind.Transport, "down")));

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ConversationItemFormatsTitleBadgeAndKind()
    {
        var direct = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "d1",
            Kind = "direct",
            Title = "Ignored title",
            UnreadCount = 150,
            DirectPeer = new HubChatUser { Id = 5, Username = "petrov", FullName = "Пётр Петров" },
        });
        Assert.Equal("Пётр Петров", direct.Title);
        Assert.Equal("П", direct.AvatarInitial);
        Assert.Equal("99+", direct.UnreadBadgeText);
        Assert.True(direct.HasUnread);

        var group = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "g1",
            Kind = "group",
            Title = "Команда",
            MemberCount = 3,
            UnreadCount = 3,
        });
        Assert.Equal("3", group.UnreadBadgeText);
        Assert.Contains("3 участника", group.KindText);

        var read = new ConversationItemViewModel(new HubChatConversation { Id = "n1", Kind = "direct" });
        Assert.Equal(string.Empty, read.UnreadBadgeText);
        Assert.False(read.HasUnread);
    }

    [Fact]
    public async Task SearchFiltersConversationsLocally()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1", kind: "group", title: "Бухгалтерия"),
                    Conv("c2", kind: "group", title: "Поддержка"),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;

        model.SearchText = "бухг";

        var item = Assert.Single(model.Conversations);
        Assert.Equal("Бухгалтерия", item.Title);
    }

    // ---- Пагинация списка диалогов ----

    [Fact]
    public async Task LoadMoreConversationsAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            ChatConversationsFactory = cursor => cursor is null
                ? new HubChatConversationList
                {
                    Items = [Conv("c1"), Conv("c2")],
                    HasMore = true,
                    NextCursor = "cur1",
                }
                : new HubChatConversationList
                {
                    Items = [Conv("c3")],
                    HasMore = false,
                },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        Assert.Equal(2, model.Conversations.Count);
        Assert.True(model.HasMoreConversations);
        Assert.True(model.LoadMoreConversationsCommand.CanExecute(null));

        await ((NativeAsyncCommand)model.LoadMoreConversationsCommand).ExecuteAsync(null);

        Assert.Equal("cur1", api.LastConversationsCursor);
        Assert.Equal(3, model.Conversations.Count);
        Assert.False(model.HasMoreConversations);
        Assert.False(model.LoadMoreConversationsCommand.CanExecute(null));
    }

    [Fact]
    public async Task ConversationsRefreshRefetchesAllLoadedPages()
    {
        var api = new FakeHubApiClient
        {
            ChatConversationsFactory = cursor => cursor is null
                ? new HubChatConversationList
                {
                    Items = [Conv("c1"), Conv("c2")],
                    HasMore = true,
                    NextCursor = "cur1",
                }
                : new HubChatConversationList
                {
                    Items = [Conv("c3")],
                    HasMore = false,
                },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.LoadMoreConversationsCommand).ExecuteAsync(null);
        Assert.Equal(3, model.Conversations.Count);
        var callsBefore = api.ConversationsCallCount;

        await ((NativeAsyncCommand)model.RetryCommand).ExecuteAsync(null);

        // Refresh перечитывает все загруженные страницы — список не схлопывается до первой.
        Assert.Equal(callsBefore + 2, api.ConversationsCallCount);
        Assert.Equal(3, model.Conversations.Count);
    }

    [Fact]
    public async Task ConversationsRefreshRemovesItemsVanishedFromLaterPages()
    {
        var page2Items = new List<HubChatConversation> { Conv("c3") };
        var api = new FakeHubApiClient
        {
            ChatConversationsFactory = cursor => cursor is null
                ? new HubChatConversationList
                {
                    Items = [Conv("c1"), Conv("c2")],
                    HasMore = true,
                    NextCursor = "cur1",
                }
                : new HubChatConversationList
                {
                    Items = page2Items.ToList(),
                    HasMore = false,
                },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.LoadMoreConversationsCommand).ExecuteAsync(null);
        Assert.Equal(3, model.Conversations.Count);

        // На сервере «c3» пропал — refresh перечитывает обе страницы и удаляет его.
        page2Items.Clear();
        await ((NativeAsyncCommand)model.RetryCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Conversations.Count);
        Assert.DoesNotContain(model.Conversations, c => c.Id == "c3");
        Assert.False(model.HasMoreConversations);
    }

    // ---- Новый диалог ----

    [Fact]
    public async Task OpenNewConversationPanelLoadsUsers()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatUsers = new HubChatUserList
            {
                Items =
                [
                    new HubChatUser { Id = 42, Username = "ivan", FullName = "Иван Иванов", Department = "ИТ" },
                    new HubChatUser { Id = 43, Username = "anna", FullName = "Анна Петрова" },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => api.ChatUsersQueries.Count > 0);

        Assert.True(model.IsNewConversationOpen);
        Assert.Equal(2, model.FoundUsers.Count);
        Assert.Equal("Иван Иванов", model.FoundUsers[0].DisplayName);
        Assert.Equal("ИТ", model.FoundUsers[0].Subtitle);
        Assert.Equal("@anna", model.FoundUsers[1].Subtitle);
        // Первый запрос — сразу при открытии, без debounce.
        _ = Assert.Single(api.ChatUsersQueries);
    }

    [Fact]
    public async Task UserSearchDebouncesAndSendsQuery()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatUsers = new HubChatUserList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => api.ChatUsersQueries.Count == 1);

        model.NewConversationSearchText = "  иван  ";
        await WaitFor(() => api.ChatUsersQueries.Count > 1);

        Assert.Equal(("иван", 20), api.ChatUsersQueries[^1]);
    }

    [Fact]
    public async Task PickUserCreatesDirectConversationAndSelectsIt()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван Иванов" }],
            },
            DirectConversationResult = new HubChatConversation
            {
                Id = "direct-42",
                Kind = "direct",
                DirectPeer = new HubChatUser { Id = 42, FullName = "Иван Иванов" },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);

        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);

        Assert.Equal(42, Assert.Single(api.CreatedDirectConversations));
        Assert.False(model.IsNewConversationOpen);
        var created = model.Conversations.FirstOrDefault(c => c.Id == "direct-42");
        Assert.NotNull(created);
        Assert.Equal("Иван Иванов", created.Title);
        Assert.Same(created, model.SelectedConversation);
        Assert.Empty(model.FoundUsers);
    }

    [Fact]
    public async Task PickUserForExistingConversationSelectsWithoutDuplicate()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван" }],
            },
            DirectConversationResult = new HubChatConversation
            {
                Id = "c2",
                Kind = "direct",
                DirectPeer = new HubChatUser { Id = 42, FullName = "Иван" },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);

        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);

        Assert.Equal(2, model.Conversations.Count);
        Assert.Equal("c2", model.SelectedConversation?.Id);
    }

    [Fact]
    public async Task CreateDirectFailureShowsBannerAndKeepsPanel()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван" }],
            },
            CreateDirectException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);

        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);

        Assert.True(model.HasBannerError);
        Assert.Null(model.SelectedConversation);
    }

    // ---- Групповые диалоги ----

    [Fact]
    public async Task CreateGroupSendsTitleAndMembersAndSelectsConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatUsers = new HubChatUserList
            {
                Items =
                [
                    new HubChatUser { Id = 42, FullName = "Иван Иванов" },
                    new HubChatUser { Id = 43, FullName = "Анна Петрова" },
                ],
            },
            GroupConversationResult = new HubChatConversation
            {
                Id = "g-new",
                Kind = "group",
                Title = "Команда",
                MemberCount = 3,
                ViewerMemberRole = "owner",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        // Новая группа видна только на вкладке «Беседы».
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 2);

        model.IsNewGroupMode = true;
        model.NewGroupTitle = "Команда";
        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);
        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[1]);

        Assert.Equal(2, model.SelectedGroupMembers.Count);
        Assert.True(model.FoundUsers[0].IsSelected);
        Assert.True(model.CanCreateGroup);

        await ((NativeAsyncCommand)model.CreateGroupCommand).ExecuteAsync(null);

        var (title, memberIds) = Assert.Single(api.CreatedGroups);
        Assert.Equal("Команда", title);
        Assert.Equal(new[] { 42, 43 }, memberIds);
        Assert.False(model.IsNewConversationOpen);
        Assert.False(model.IsNewGroupMode);
        Assert.Empty(model.SelectedGroupMembers);
        Assert.Equal("g-new", model.SelectedConversation?.Id);
        Assert.Contains(model.Conversations, c => c.Id == "g-new");
    }

    [Fact]
    public async Task CreateGroupRequiresTitleAndMembers()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван" }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);

        Assert.False(model.CanCreateGroup);
        model.IsNewGroupMode = true;
        Assert.False(model.CanCreateGroup);
        model.NewGroupTitle = "К";
        Assert.False(model.CanCreateGroup);
        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);
        Assert.True(model.CanCreateGroup);

        // Повторный клик по тому же пользователю снимает выбор.
        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);
        Assert.Empty(model.SelectedGroupMembers);
        Assert.False(model.CanCreateGroup);
        Assert.Empty(api.CreatedGroups);
    }

    [Fact]
    public async Task CreateGroupFailureShowsBannerAndKeepsPanel()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван" }],
            },
            CreateGroupException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);
        model.IsNewGroupMode = true;
        model.NewGroupTitle = "Команда";
        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);

        await ((NativeAsyncCommand)model.CreateGroupCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.True(model.IsNewConversationOpen);
        Assert.Null(model.SelectedConversation);
    }

    [Fact]
    public async Task MembersPanelListsMembersAndManagerSeesRemove()
    {
        var api = MembersApiFixture("owner");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsMembersPanelOpen);
        Assert.Equal("Участники: 3", model.MembersTitleText);
        Assert.True(model.CanManageGroupMembers);
        var me = Assert.Single(model.GroupMembers, m => m.UserId == 7);
        var member = Assert.Single(model.GroupMembers, m => m.UserId == 42);
        var moderator = Assert.Single(model.GroupMembers, m => m.UserId == 43);
        // Себя-владельца исключить нельзя; member и moderator — можно (viewer owner).
        Assert.False(me.CanRemove);
        Assert.True(member.CanRemove);
        Assert.True(moderator.CanRemove);
        Assert.Equal("Владелец", me.RoleText);
        Assert.Null(member.RoleText);
        Assert.Equal("Модератор", moderator.RoleText);
    }

    [Fact]
    public async Task MembersPanelForMemberHidesManagement()
    {
        var api = MembersApiFixture("member");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        Assert.False(model.CanManageGroupMembers);
        Assert.DoesNotContain(model.GroupMembers, m => m.CanRemove);
    }

    [Fact]
    public async Task RemoveMemberCallsApiAndRefreshesPanel()
    {
        var api = MembersApiFixture("owner");
        api.RemoveMemberResult = api.ConversationDetailResult! with
        {
            MemberCount = 2,
            Members =
            [
                new HubChatMember
                {
                    User = new HubChatUser { Id = 7, FullName = "Я" },
                    MemberRole = "owner",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 43, FullName = "Анна Петрова" },
                    MemberRole = "moderator",
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);
        var ivan = Assert.Single(model.GroupMembers, m => m.UserId == 42);

        ivan.RemoveCommand.Execute(null);
        await WaitFor(() => api.RemovedMembers.Count == 1);

        Assert.Equal(("g1", 42), api.RemovedMembers[0]);
        Assert.DoesNotContain(model.GroupMembers, m => m.UserId == 42);
        Assert.Equal("Участники: 2", model.MembersTitleText);
        Assert.Contains("2 участника", model.Conversations[0].KindText);
    }

    [Fact]
    public async Task MemberSearchAddsCandidateToGroup()
    {
        var api = MembersApiFixture("owner");
        api.ChatUsers = new HubChatUserList
        {
            Items = [new HubChatUser { Id = 55, FullName = "Новый Сотрудник" }],
        };
        api.AddMemberResult = api.ConversationDetailResult! with
        {
            MemberCount = 4,
            Members =
            [
                .. api.ConversationDetailResult!.Members!,
                new HubChatMember
                {
                    User = new HubChatUser { Id = 55, FullName = "Новый Сотрудник" },
                    MemberRole = "member",
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        model.MemberSearchText = "новый";
        await WaitFor(() => model.MemberCandidateResults.Count == 1);

        await ((NativeAsyncCommand)model.PickMemberCandidateCommand)
            .ExecuteAsync(model.MemberCandidateResults[0]);

        Assert.Equal(("g1", 55), Assert.Single(api.AddedMembers));
        Assert.Contains(model.GroupMembers, m => m.UserId == 55);
        Assert.Equal("Участники: 4", model.MembersTitleText);
        Assert.Equal(string.Empty, model.MemberSearchText);
    }

    [Fact]
    public async Task LeaveGroupRemovesConversationAndClearsSelection()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1"),
                    Conv("g1", kind: "group", title: "Команда") with { ViewerMemberRole = "member" },
                ],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        var group = model.Conversations.First(c => c.Id == "g1");
        Assert.True(group.CanLeaveGroup);
        model.SelectedConversation = group;
        await WaitFor(() => !model.IsLoadingMessages);

        group.LeaveGroupCommand.Execute(null);
        await WaitFor(() => api.LeftConversations.Count == 1);

        Assert.Equal("g1", api.LeftConversations[0]);
        Assert.DoesNotContain(model.Conversations, c => c.Id == "g1");
        Assert.Null(model.SelectedConversation);
    }

    [Fact]
    public async Task LeaveGroupFailureShowsBannerAndKeepsConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("g1", kind: "group", title: "Команда") with { ViewerMemberRole = "member" }],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
            LeaveException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        var group = model.Conversations[0];
        model.SelectedConversation = group;
        await WaitFor(() => !model.IsLoadingMessages);

        group.LeaveGroupCommand.Execute(null);
        await WaitFor(() => model.HasBannerError);

        Assert.Contains(model.Conversations, c => c.Id == "g1");
    }

    [Fact]
    public void LeaveMenuShownOnlyForNonOwnerGroup()
    {
        var member = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "g1",
            Kind = "group",
            Title = "Команда",
            ViewerMemberRole = "member",
        });
        Assert.True(member.CanLeaveGroup);

        // Владельцу пункт скрыт: сервер требует successor_user_id при выходе.
        var owner = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "g2",
            Kind = "group",
            Title = "Команда",
            ViewerMemberRole = "owner",
        });
        Assert.False(owner.CanLeaveGroup);

        var direct = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "d1",
            Kind = "direct",
        });
        Assert.False(direct.CanLeaveGroup);

        // kind="task" — IsGroupLike, но group-API его отвергает: скрываем тоже.
        var task = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "t1",
            Kind = "task",
            Title = "Задача",
            ViewerMemberRole = "member",
        });
        Assert.False(task.CanLeaveGroup);
    }

    /// <summary>Fake с группой g1 и detail-ответом на 3 участника (viewer — role).</summary>
    private static FakeHubApiClient MembersApiFixture(string viewerRole)
    {
        var api = new FakeHubApiClient
        {
            StoredSession = new NativeSession(
                AccessToken: "t",
                RefreshToken: "r",
                ClientDeviceId: "d",
                AccessTokenExpiresAtUtc: DateTimeOffset.UtcNow.AddHours(1),
                UserId: 7,
                UserName: "me",
                FullName: "Я"),
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("g1", kind: "group", title: "Команда") with { ViewerMemberRole = viewerRole },
                ],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationDetailResult = new HubChatConversationDetail
            {
                Id = "g1",
                Kind = "group",
                Title = "Команда",
                MemberCount = 3,
                ViewerMemberRole = viewerRole,
                Members =
                [
                    new HubChatMember
                    {
                        User = new HubChatUser { Id = 7, FullName = "Я" },
                        MemberRole = viewerRole == "owner" ? "owner" : "member",
                    },
                    new HubChatMember
                    {
                        User = new HubChatUser { Id = 42, FullName = "Иван Иванов" },
                        MemberRole = "member",
                    },
                    new HubChatMember
                    {
                        User = new HubChatUser { Id = 43, FullName = "Анна Петрова" },
                        MemberRole = "moderator",
                    },
                ],
            },
        };
        return api;
    }

    // ---- Выбор диалога и сообщения ----

    [Fact]
    public async Task SelectingConversationLoadsMessagesAndMarksRead()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1", unread: 4)],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m2", "c1", "второе", DateTimeOffset.UtcNow),
                    Msg("m1", "c1", "первое", DateTimeOffset.UtcNow.AddMinutes(-3)),
                ],
                HasOlder = true,
                OlderCursorMessageId = "m1",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 2);

        Assert.Equal(["m1", "m2"], model.Messages.Select(m => m.Id).ToArray());
        Assert.True(model.HasOlder);
        await WaitFor(() => api.ReadMarkedMessages.Count == 1);
        Assert.Equal(("c1", "m2"), api.ReadMarkedMessages[0]);
        Assert.Equal(0, model.Conversations[0].UnreadCount);
        Assert.False(model.Conversations[0].HasUnread);
    }

    [Fact]
    public async Task LoadOlderPrependsMessages()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m5", "c1", "новое", DateTimeOffset.UtcNow)],
                HasOlder = true,
                OlderCursorMessageId = "m5",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        api.ChatMessages = new HubChatMessageList
        {
            Items = [Msg("m2", "c1", "старое", DateTimeOffset.UtcNow.AddHours(-2))],
            HasOlder = false,
        };
        await ((NativeAsyncCommand)model.LoadOlderCommand).ExecuteAsync(null);

        Assert.Equal(["m2", "m5"], model.Messages.Select(m => m.Id).ToArray());
        Assert.Equal("m5", api.LastBeforeMessageId);
        Assert.False(model.HasOlder);
    }

    // ---- Отправка ----

    [Fact]
    public async Task SendAppendsMessageAndClearsComposer()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "  привет  ";

        Assert.True(model.SendCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        Assert.Equal(("c1", "привет"), Assert.Single(api.SentMessages));
        var message = Assert.Single(model.Messages);
        Assert.Equal("привет", message.BodyText);
        Assert.True(message.IsOwn);
        Assert.Equal(string.Empty, model.ComposerText);
    }

    [Fact]
    public async Task SendFailureKeepsTextAndShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatSendException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "важное сообщение";

        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Equal("важное сообщение", model.ComposerText);
        Assert.Empty(model.Messages);
    }

    [Fact]
    public void SendDisabledWithoutText()
    {
        var model = new ChatViewModel(new FakeHubApiClient(), new FakeChatRealtime());

        Assert.False(model.SendCommand.CanExecute(null));

        model.ComposerText = "   ";
        Assert.False(model.SendCommand.CanExecute(null));
    }

    // ---- Realtime-события ----

    [Fact]
    public async Task IncomingMessageForSelectedConversationAppendsAndMarksRead()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "старое", DateTimeOffset.UtcNow.AddMinutes(-1))],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        realtime.RaiseEvent(
            "chat.message_received",
            "{\"message\":{\"id\":\"m9\",\"conversation_id\":\"c1\",\"kind\":\"text\"," +
            "\"body\":\"новое\",\"created_at\":\""
            + DateTimeOffset.UtcNow.ToString("o") + "\"}}");

        Assert.Equal(2, model.Messages.Count);
        Assert.Equal("m9", model.Messages[1].Id);
        await WaitFor(() => api.ReadMarkedMessages.Any(r => r.MessageId == "m9"));
        Assert.Equal("новое", model.Conversations[0].Preview);
    }

    [Fact]
    public async Task IncomingMessageForOtherConversationIncrementsUnread()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2", unread: 1)],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);
        var other = model.Conversations.First(c => c.Id == "c2");

        realtime.RaiseEvent(
            "chat.message_received",
            "{\"id\":\"m9\",\"conversation_id\":\"c2\",\"kind\":\"text\",\"body\":\"туда\"}");

        Assert.Equal(2, other.UnreadCount);
        Assert.Equal("2", other.UnreadBadgeText);
        Assert.Empty(model.Messages);
        Assert.Equal("туда", other.Preview);
    }

    [Fact]
    public async Task MessageUpdatedEditsBody()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "было", DateTimeOffset.UtcNow)],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        realtime.RaiseEvent(
            "chat.message.updated",
            "{\"message\":{\"id\":\"m1\",\"body\":\"стало\"," +
            "\"edited_at\":\"" + DateTimeOffset.UtcNow.ToString("o") + "\"}}");

        Assert.Equal("стало", model.Messages[0].BodyText);
        Assert.Equal("изм.", model.Messages[0].EditedText);
    }

    [Fact]
    public async Task MessageDeletedMarksBubble()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "удалят", DateTimeOffset.UtcNow)],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        realtime.RaiseEvent("chat.message.deleted", "{\"message_id\":\"m1\"}");

        Assert.True(model.Messages[0].IsDeleted);
        Assert.Equal("Сообщение удалено", model.Messages[0].BodyText);
    }

    [Fact]
    public async Task ConnectionStateMapsToStatusPill()
    {
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(new FakeHubApiClient(), realtime);
        await model.LoadAsync();

        realtime.RaiseState(HubChatRealtimeState.Connected);
        Assert.Equal("в сети", model.ConnectionStatusText);

        realtime.RaiseState(HubChatRealtimeState.Reconnecting);
        Assert.Equal("переподключение…", model.ConnectionStatusText);

        realtime.RaiseState(HubChatRealtimeState.Disconnected);
        Assert.Equal("офлайн", model.ConnectionStatusText);
    }

    [Fact]
    public async Task ConversationEventReloadsListAfterDebounce()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        Assert.Single(model.Conversations);

        api.ChatConversations = new HubChatConversationList
        {
            Items = [Conv("c1"), Conv("c2", title: "Новый чат")],
        };
        realtime.RaiseEvent("chat.conversation.updated", "{}");

        await WaitFor(() => model.Conversations.Count == 2, TimeSpan.FromSeconds(5));
        Assert.Contains(model.Conversations, c => c.Id == "c2");
    }

    [Fact]
    public async Task ResetStopsRealtimeAndClearsState()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1", unread: 2)] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();

        model.Reset();
        await WaitFor(() => realtime.StopCalls == 1);

        Assert.Empty(model.Conversations);
        Assert.Empty(model.Messages);
        Assert.Null(model.SelectedConversation);
        Assert.Equal("офлайн", model.ConnectionStatusText);
        Assert.Equal(0, realtime.DisposeCalls); // инжектированный realtime не dispose'им
    }

    // ---- Composer: Enter отправляет ----

    /// <summary>
    /// Регрессия: Enter в composer должен вызывать SendCommand. Обработчик
    /// висит на PreviewKeyDown — при AcceptsReturn=True классовый
    /// TextBoxBase.OnKeyDown помечает bubbling KeyDown handled раньше
    /// instance-обработчиков, поэтому событие поднято именно на preview-стадии.
    /// </summary>
    [Fact]
    public void ComposerEnterRaisesSendCommand()
    {
        RunOnSta(() =>
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            Pump(model.LoadAsync());
            model.SelectedConversation = model.Conversations[0];
            PumpUntil(() => !model.IsLoadingMessages, TimeSpan.FromSeconds(5));
            model.ComposerText = "enter отправляет";

            var view = new Native.Views.ChatView { DataContext = model };
            var window = new System.Windows.Window
            {
                Content = view,
                ShowInTaskbar = false,
                WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                Left = -30000,
                Top = -30000,
            };
            window.Show();
            window.UpdateLayout();
            try
            {
                var composer = (System.Windows.Controls.TextBox)view.FindName("ComposerInput");
                var source = System.Windows.PresentationSource.FromVisual(view);
                composer.RaiseEvent(new System.Windows.Input.KeyEventArgs(
                    System.Windows.Input.Keyboard.PrimaryDevice,
                    source,
                    0,
                    System.Windows.Input.Key.Enter)
                {
                    RoutedEvent = System.Windows.UIElement.PreviewKeyDownEvent,
                });

                PumpUntil(() => api.SentMessages.Count == 1, TimeSpan.FromSeconds(5));
            }
            finally
            {
                window.Close();
            }

            Assert.Equal(("c1", "enter отправляет"), Assert.Single(api.SentMessages));
            Assert.Equal(string.Empty, model.ComposerText);
        });
    }

    private static void RunOnSta(Action action)
    {
        Exception? captured = null;
        var thread = new Thread(() =>
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                captured = exception;
            }
            finally
            {
                // Живой диспетчер на уходящем потоке держит message-only HWND
                // (HwndWrapper): посты на мёртвый диспетчер материализуют его
                // заново, а WndProc на выгруженном потоке валит процесс
                // (SubclassWndProc NRE) — диспетчер гасим корректно, но только
                // если он был создан (FromThread не создаёт новый).
                System.Windows.Threading.Dispatcher
                    .FromThread(Thread.CurrentThread)?.InvokeShutdown();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromSeconds(60)), "STA-сценарий не завершился за 60 секунд.");
        Assert.Null(captured);
    }

    private static void Pump(Task task)
    {
        var frame = new System.Windows.Threading.DispatcherFrame();
        _ = task.ContinueWith(
            _ => frame.Continue = false,
            CancellationToken.None,
            TaskContinuationOptions.None,
            TaskScheduler.Default);
        System.Windows.Threading.Dispatcher.PushFrame(frame);
        if (task.IsFaulted)
        {
            throw task.Exception!;
        }
    }

    private static void PumpUntil(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!condition() && DateTime.UtcNow < deadline)
        {
            System.Windows.Threading.Dispatcher.CurrentDispatcher.Invoke(
                System.Windows.Threading.DispatcherPriority.Background,
                new Action(() => { }));
            Thread.Sleep(15);
        }
    }

    // ---- Уведомления о входящих сообщениях ----

    [Fact]
    public async Task IncomingMessageRaisesNotificationRequest()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        var raised = new List<ChatMessageNotification>();
        model.NotificationRequested += (_, notification) => raised.Add(notification);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent(
            "chat.message_received",
            "{\"id\":\"m9\",\"conversation_id\":\"c2\",\"kind\":\"text\",\"body\":\"привет\"}");

        var notification = Assert.Single(raised);
        Assert.Equal("c2", notification.ConversationId);
        Assert.Equal("m9", notification.MessageId);
        Assert.False(notification.IsSelectedConversation);
        Assert.Equal("Пользователь c2", notification.Title);
        Assert.Equal("привет", notification.Body);
    }

    [Fact]
    public async Task MessageOnSelectedConversationRaisesFlaggedNotification()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        var raised = new List<ChatMessageNotification>();
        model.NotificationRequested += (_, notification) => raised.Add(notification);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent(
            "chat.message_received",
            "{\"id\":\"m8\",\"conversation_id\":\"c1\",\"kind\":\"text\",\"body\":\"смотришь?\"}");

        // Флаг — не подавление: окно решает, показывать ли toast по IsActive.
        var notification = Assert.Single(raised);
        Assert.True(notification.IsSelectedConversation);
    }

    [Fact]
    public async Task OwnOrDeletedMessageDoesNotNotify()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        var raised = new List<ChatMessageNotification>();
        model.NotificationRequested += (_, notification) => raised.Add(notification);
        await model.LoadAsync();

        realtime.RaiseEvent(
            "chat.message_received",
            "{\"id\":\"m1\",\"conversation_id\":\"c2\",\"kind\":\"text\",\"body\":\"сам\",\"is_own\":true}");
        realtime.RaiseEvent(
            "chat.message_received",
            "{\"id\":\"m2\",\"conversation_id\":\"c2\",\"kind\":\"text\",\"is_deleted\":true}");

        Assert.Empty(raised);
    }

    // ---- Deep link на конкретный диалог ----

    [Fact]
    public async Task SelectConversationByIdSelectsLoadedConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        await model.SelectConversationByIdAsync("c2");

        Assert.Equal("c2", model.SelectedConversation?.Id);
    }

    [Fact]
    public async Task PendingConversationAppliesWhenArrivesOnReload()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();

        // Диалог появился на сервере позже — следующая перезагрузка списка его подберёт.
        var later = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] };
        api.ChatConversations = later;

        await model.SelectConversationByIdAsync("c2");
        Assert.Null(model.SelectedConversation);

        realtime.RaiseEvent("chat.conversation.updated", "{}");

        await WaitFor(() => model.SelectedConversation?.Id == "c2");
    }

    [Fact]
    public async Task ManualSelectionClearsPendingConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();

        var later = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] };
        api.ChatConversations = later;

        await model.SelectConversationByIdAsync("c2");
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent("chat.conversation.updated", "{}");
        await Task.Delay(700);

        Assert.Equal("c1", model.SelectedConversation?.Id);
    }

    // ---- Серверный поиск диалогов ----

    [Fact]
    public async Task ServerSearchQueriesApiAndShowsMatches()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("g1", kind: "group", title: "Бухгалтерия"),
                    Conv("g2", kind: "group", title: "ИТ-отдел"),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        model.SearchText = "бухг";

        await WaitFor(() => api.LastConversationsQuery == "бухг");
        await WaitFor(() => model.Conversations.Count == 1);
        Assert.Equal("g1", model.Conversations[0].Id);
    }

    [Fact]
    public async Task ServerSearchErrorFallsBackToLocalFilter()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("g1", kind: "group", title: "Бухгалтерия"),
                    Conv("g2", kind: "group", title: "ИТ-отдел"),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        api.ChatConversationsException = new HubApiException(HubApiErrorKind.Transport, "down");

        model.SearchText = "ит-";

        await WaitFor(() => api.LastConversationsQuery == "ит-");
        await Task.Delay(500);
        Assert.Equal(["g2"], model.Conversations.Select(c => c.Id).ToArray());
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ClearingSearchRestoresLocalList()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("g1", kind: "group", title: "Бухгалтерия"),
                    Conv("g2", kind: "group", title: "ИТ-отдел"),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;

        model.SearchText = "бухг";
        await WaitFor(() => model.Conversations.Count == 1);

        model.SearchText = string.Empty;

        await WaitFor(() => model.Conversations.Count == 2);
    }

    // ---- Действия с сообщениями: ответ / правка / удаление / реакции ----

    [Fact]
    public async Task SendReplyPassesReplyToMessageId()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "исходное", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        model.BeginReplyCommand.Execute(model.Messages[0]);
        Assert.True(model.HasComposerContext);
        Assert.Equal("Ответ", model.ComposerContextTitle);

        model.ComposerText = "ответ";
        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        var sent = Assert.Single(api.SentMessageDetails);
        Assert.Equal("c1", sent.ConversationId);
        Assert.Equal("ответ", sent.Body);
        Assert.Equal("m1", sent.ReplyToMessageId);
        Assert.False(model.HasComposerContext);
    }

    [Fact]
    public async Task SendWhileEditingCallsPatchAndUpdatesBubble()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "старый текст", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        model.BeginEditCommand.Execute(model.Messages[0]);
        Assert.Equal("Изменение сообщения", model.ComposerContextTitle);
        Assert.Equal("Сохранить", model.SendButtonText);
        Assert.Equal("старый текст", model.ComposerText);

        model.ComposerText = "новый текст";
        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        var edit = Assert.Single(api.EditedMessages);
        Assert.Equal(("c1", "m1", "новый текст"), edit);
        Assert.Empty(api.SentMessages);
        Assert.Equal("новый текст", model.Messages[0].BodyText);
        Assert.False(model.HasComposerContext);
        Assert.Equal("Отправить", model.SendButtonText);
    }

    [Fact]
    public async Task DeleteCommandMarksMessageDeleted()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "удаляемое", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var message = model.Messages[0];
        Assert.True(message.CanEditOrDelete);
        // «Удалить» открывает модал подтверждения — API ещё не вызван.
        await ((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(message);
        Assert.True(model.IsDeleteConfirmOpen);
        Assert.Equal("Удалить сообщение", model.DeleteConfirmTitle);
        Assert.Empty(api.DeletedMessages);

        await ((NativeAsyncCommand)model.ConfirmDeleteCommand).ExecuteAsync(null);

        Assert.False(model.IsDeleteConfirmOpen);
        Assert.Equal(("c1", "m1"), Assert.Single(api.DeletedMessages));
        Assert.True(message.IsDeleted);
        Assert.False(message.CanReply);
        Assert.False(message.CanEditOrDelete);
    }

    [Fact]
    public async Task DeleteCancelLeavesMessageAndClosesConfirm()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "оставить", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var message = model.Messages[0];
        await ((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(message);
        Assert.True(model.IsDeleteConfirmOpen);

        model.CancelDeleteCommand.Execute(null);

        Assert.False(model.IsDeleteConfirmOpen);
        Assert.Empty(api.DeletedMessages);
        Assert.False(message.IsDeleted);
    }

    [Fact]
    public async Task DeleteFailureLeavesMessageIntact()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "не удалить", DateTimeOffset.UtcNow, own: true)],
            },
            ChatDeleteException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var message = model.Messages[0];
        await ((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(message);
        await ((NativeAsyncCommand)model.ConfirmDeleteCommand).ExecuteAsync(null);

        Assert.False(message.IsDeleted);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task ReactionToggleAppliesReturnedReactions()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "лайкни", DateTimeOffset.UtcNow)],
            },
            ReactionToggleResult = new HubChatReactionToggle
            {
                MessageId = "m1",
                ConversationId = "c1",
                Action = "added",
                Emoji = "👍",
                Reactions = [new HubChatReaction { Emoji = "👍", Count = 2, UserIds = [7, 9] }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var message = model.Messages[0];
        message.ReactionCommand.Execute("👍");
        await WaitFor(() => api.ToggledReactions.Count == 1);
        await WaitFor(() => message.ReactionsText == "👍 2");

        Assert.Equal(("c1", "m1", "👍"), api.ToggledReactions[0]);
    }

    [Fact]
    public async Task CancelComposerContextRestoresComposer()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        model.BeginEditCommand.Execute(model.Messages[0]);
        Assert.Equal("текст", model.ComposerText);

        model.CancelComposerContextCommand.Execute(null);

        Assert.False(model.HasComposerContext);
        Assert.Equal(string.Empty, model.ComposerText);
        Assert.Equal("Отправить", model.SendButtonText);
    }

    [Fact]
    public async Task RealtimeReactionEventUpdatesBubble()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "сообщение", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        realtime.RaiseEvent("chat.message.reaction", """
            {"message_id":"m1","conversation_id":"c1",
             "reactions":[{"emoji":"❤️","count":3,"user_ids":[1,2,3]}]}
            """);

        await WaitFor(() => model.Messages[0].ReactionsText == "❤️ 3");
    }

    [Fact]
    public async Task ComposerContextClearedOnConversationSwitch()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.Messages.Count == 1);

        model.BeginReplyCommand.Execute(model.Messages[0]);
        Assert.True(model.HasComposerContext);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        Assert.False(model.HasComposerContext);
    }

    // ---- Pin/mute диалога и поиск по сообщениям ----

    [Fact]
    public async Task TogglePinCallsPatchAndResorts()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1", lastAt: DateTimeOffset.UtcNow.AddMinutes(-10)),
                    Conv("c2", lastAt: DateTimeOffset.UtcNow),
                ],
            },
            ConversationSettingsResult = new HubChatConversation
            {
                Id = "c1",
                Kind = "direct",
                Title = "Диалог c1",
                IsPinned = true,
                LastMessageAt = DateTimeOffset.UtcNow.AddMinutes(-10),
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        var item = model.Conversations.First(c => c.Id == "c1");
        Assert.False(item.IsPinned);
        item.TogglePinCommand.Execute(null);
        await WaitFor(() => api.UpdatedConversationSettings.Count == 1);

        Assert.Equal(("c1", (bool?)true, (bool?)null, (bool?)null, (DateTimeOffset?)null), api.UpdatedConversationSettings[0]);
        Assert.True(item.IsPinned);
        Assert.Equal("c1", model.Conversations[0].Id);
    }

    [Fact]
    public async Task MutedConversationSkipsNotification()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1", kind: "direct"),
                    new HubChatConversation
                    {
                        Id = "c2",
                        Kind = "direct",
                        Title = "Тихий",
                        IsMuted = true,
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, realtime);
        var notifications = new List<ChatMessageNotification>();
        model.NotificationRequested += (_, n) => notifications.Add(n);
        await model.LoadAsync();

        realtime.RaiseEvent("chat.message_received",
            "{\"id\":\"m1\",\"conversation_id\":\"c2\",\"kind\":\"text\",\"body\":\"тихо\"}");
        await Task.Delay(100);
        Assert.Empty(notifications);

        realtime.RaiseEvent("chat.message_received",
            "{\"id\":\"m2\",\"conversation_id\":\"c1\",\"kind\":\"text\",\"body\":\"громко\"}");
        await WaitFor(() => notifications.Count == 1);
    }

    [Fact]
    public async Task MessageSearchQueriesServerAfterDebounce()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            MessageSearchResult = new HubChatMessageSearchResult
            {
                Items = [Msg("m9", "c1", "найдено", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.ToggleMessageSearchCommand.Execute(null);
        Assert.True(model.IsMessageSearchOpen);
        model.MessageSearchText = "привет";

        await WaitFor(() => api.MessageSearchQueries.Count == 1);
        Assert.Equal(("c1", "привет", 20), api.MessageSearchQueries[0]);
        await WaitFor(() => model.SearchResults.Count == 1);
        Assert.Equal("найдено", model.SearchResults[0].BodyText);
    }

    [Fact]
    public async Task JumpToSearchResultLoadsAnchorPage()
    {
        var anchor = Msg("m-anchor", "c1", "якорь", DateTimeOffset.UtcNow.AddMinutes(-5));
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ThreadBootstrapResult = new HubChatThreadBootstrap
            {
                Items =
                [
                    anchor,
                    Msg("m-newer", "c1", "новее", DateTimeOffset.UtcNow),
                ],
                HasOlder = true,
                OlderCursorMessageId = "m-anchor",
                InitialAnchorMessageId = "m-anchor",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        var hit = new ChatMessageViewModel(anchor, isGroupConversation: false);
        await ((NativeAsyncCommand)model.PickSearchResultCommand).ExecuteAsync(hit);

        Assert.Equal(("c1", (string?)"m-anchor", 40), Assert.Single(api.ThreadBootstrapCalls));
        Assert.Equal(2, model.Messages.Count);
        Assert.True(model.HasOlder);
        Assert.Equal("m-anchor", model.SelectedMessage?.Id);
        Assert.False(model.IsMessageSearchOpen);
    }

    [Fact]
    public async Task MessageSearchClosesOnConversationSwitch()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        model.ToggleMessageSearchCommand.Execute(null);
        model.MessageSearchText = "текст";
        Assert.True(model.IsMessageSearchOpen);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        Assert.False(model.IsMessageSearchOpen);
        Assert.Equal(string.Empty, model.MessageSearchText);
    }

    [Fact]
    public async Task ArchivedConversationHiddenUntilArchiveView()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1"),
                    new HubChatConversation
                    {
                        Id = "c2",
                        Kind = "direct",
                        Title = "Старый",
                        IsArchived = true,
                    },
                ],
            },
            ConversationSettingsResult = new HubChatConversation
            {
                Id = "c1",
                Kind = "direct",
                Title = "Диалог c1",
                IsArchived = true,
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        Assert.Single(model.Conversations);
        Assert.Equal("c1", model.Conversations[0].Id);

        // Архив c1 через меню — строка пропадает из обычного вида.
        model.Conversations[0].ToggleArchiveCommand.Execute(null);
        await WaitFor(() => api.UpdatedConversationSettings.Count == 1);
        Assert.Equal(("c1", (bool?)null, (bool?)null, (bool?)true, (DateTimeOffset?)null), api.UpdatedConversationSettings[0]);
        Assert.Empty(model.Conversations);

        // Вид «Архив» показывает оба архивных.
        model.ToggleArchivedViewCommand.Execute(null);
        Assert.Equal(2, model.Conversations.Count);
        Assert.Equal("В архиве пусто", model.EmptyTitle);

        // Возврат из архива — диалог снова в обычном списке после выхода из вида.
        var archived = model.Conversations.First(c => c.Id == "c1");
        api.ConversationSettingsResult = new HubChatConversation
        {
            Id = "c1",
            Kind = "direct",
            Title = "Диалог c1",
            IsArchived = false,
        };
        archived.ToggleArchiveCommand.Execute(null);
        await WaitFor(() => api.UpdatedConversationSettings.Count == 2);
        Assert.Equal(("c1", (bool?)null, (bool?)null, (bool?)false, (DateTimeOffset?)null), api.UpdatedConversationSettings[1]);
        Assert.Single(model.Conversations);
        Assert.Equal("c2", model.Conversations[0].Id);
    }

    [Fact]
    public async Task PinnedMessageBarJumpAndToggle()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "первое", DateTimeOffset.UtcNow.AddMinutes(-2))],
            },
            PinnedMessages =
            {
                new HubChatPinnedMessage
                {
                    Id = "m1",
                    SenderName = "Devin",
                    Preview = "первое",
                },
            },
            ThreadBootstrapResult = new HubChatThreadBootstrap
            {
                Items = [Msg("m1", "c1", "первое", DateTimeOffset.UtcNow.AddMinutes(-2))],
                InitialAnchorMessageId = "m1",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await WaitFor(() => model.HasPinnedMessages);

        Assert.Equal("📌 Devin: первое", model.PinnedBarText);
        Assert.True(model.Messages[0].IsPinned);

        // Клик по плашке — bootstrap к якорю.
        await ((NativeAsyncCommand)model.JumpToPinnedCommand).ExecuteAsync(null);
        Assert.Equal(("c1", (string?)"m1", 40), Assert.Single(api.ThreadBootstrapCalls));
        Assert.Equal("m1", model.SelectedMessage?.Id);

        // Открепление через меню — плашка исчезает.
        model.Messages[0].TogglePinCommand.Execute(null);
        await WaitFor(() => api.PinnedCalls.Count == 1);
        Assert.Equal(("c1", "m1", true), api.PinnedCalls[0]);
        await WaitFor(() => !model.HasPinnedMessages);
        Assert.False(model.Messages[0].IsPinned);

        // Повторный закреп — PUT.
        model.Messages[0].TogglePinCommand.Execute(null);
        await WaitFor(() => api.PinnedCalls.Count == 2);
        Assert.Equal(("c1", "m1", false), api.PinnedCalls[1]);
        await WaitFor(() => model.HasPinnedMessages);
    }

    [Fact]
    public async Task AttachDroppedFilesCommandUploadsDroppedPaths()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.png");
        await File.WriteAllBytesAsync(filePath, [137, 80, 78]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
                UploadCompletedMessage = Msg("m-drop", "c1", "файл", DateTimeOffset.UtcNow),
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => !model.IsLoadingMessages);

            // Тот же путь, что у драга на ленту и вставки файла в composer —
            // одна upload-сессия, без второго пайплайна.
            await ((NativeAsyncCommand)model.AttachDroppedFilesCommand).ExecuteAsync(
                new[] { filePath });

            Assert.Single(api.UploadSessionRequests);
            Assert.Equal(["upload-1"], api.CompletedSessions);
            Assert.Equal("m-drop", Assert.Single(model.Messages).Id);
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task FileDropOverlayFollowsViewFlagAndResetsOnSwitch()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.False(model.IsFileDropOverlayOpen);
        model.SetFileDropOverlay(true);
        Assert.True(model.IsFileDropOverlayOpen);
        Assert.Contains(model.SelectedConversation.Title, model.FileDropTargetText);

        // Смена диалога гасит оверлей — view мог потерять DragLeave.
        model.SelectedConversation = model.Conversations[1];
        Assert.False(model.IsFileDropOverlayOpen);
        Assert.Contains(model.SelectedConversation.Title, model.FileDropTargetText);
    }

    [Fact]
    public async Task ReplyQuoteClickSelectsLoadedOriginalAndFlashes()
    {
        var original = Msg("m-orig", "c1", "оригинал", DateTimeOffset.UtcNow.AddMinutes(-3));
        var reply = new HubChatMessage
        {
            Id = "m-reply",
            ConversationId = "c1",
            Kind = "text",
            Body = "ответ",
            CreatedAt = DateTimeOffset.UtcNow,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
            ReplyPreview = new HubChatReplyPreview
            {
                Id = "m-orig",
                SenderName = "Пётр",
                Body = "оригинал",
                Kind = "text",
            },
        };
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [original, reply] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        var replyItem = model.Messages.Single(m => m.Id == "m-reply");
        Assert.True(replyItem.HasReplyTarget);
        replyItem.OpenReplyTargetCommand.Execute(null);

        var target = model.Messages.Single(m => m.Id == "m-orig");
        Assert.Same(target, model.SelectedMessage);
        Assert.True(target.IsHighlighted);
        // Цель уже в ленте — ни старших страниц, ни bootstrap не нужно.
        Assert.Empty(api.ThreadBootstrapCalls);
        Assert.Null(api.LastBeforeMessageId);

        // Вспышка сама гаснет примерно через секунду.
        await WaitFor(() => !target.IsHighlighted);
    }

    [Fact]
    public async Task ReplyQuoteClickLoadsOlderPageToFindOriginal()
    {
        var original = Msg("m-orig", "c1", "давнее", DateTimeOffset.UtcNow.AddHours(-1));
        var reply = new HubChatMessage
        {
            Id = "m-reply",
            ConversationId = "c1",
            Kind = "text",
            Body = "ответ",
            CreatedAt = DateTimeOffset.UtcNow,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
            ReplyPreview = new HubChatReplyPreview { Id = "m-orig", SenderName = "Пётр" },
        };
        var olderPageCalls = 0;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [reply],
                HasOlder = true,
                OlderCursorMessageId = "m-reply",
            },
        };
        api.ChatMessagesFactory = before =>
        {
            if (before is null)
            {
                return api.ChatMessages;
            }

            olderPageCalls++;
            return new HubChatMessageList { Items = [original], HasOlder = false };
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        var replyItem = model.Messages.Single(m => m.Id == "m-reply");
        replyItem.OpenReplyTargetCommand.Execute(null);

        // Цель за пределами первой страницы → догрузка «ранее», выбор и вспышка.
        await WaitFor(() => model.SelectedMessage?.Id == "m-orig");
        Assert.Equal(1, olderPageCalls);
        Assert.Equal("m-reply", api.LastBeforeMessageId);
        Assert.True(model.Messages.Single(m => m.Id == "m-orig").IsHighlighted);
        Assert.Empty(api.ThreadBootstrapCalls);
    }

    [Fact]
    public async Task ReplyQuoteClickBoundsOlderLoadsThenBootstraps()
    {
        var original = Msg("m-orig", "c1", "далёкое", DateTimeOffset.UtcNow.AddDays(-3));
        var reply = new HubChatMessage
        {
            Id = "m-reply",
            ConversationId = "c1",
            Kind = "text",
            Body = "ответ",
            CreatedAt = DateTimeOffset.UtcNow,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
            ReplyPreview = new HubChatReplyPreview { Id = "m-orig", SenderName = "Пётр" },
        };
        var olderPageCalls = 0;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [reply],
                HasOlder = true,
                OlderCursorMessageId = "m-reply",
            },
            ThreadBootstrapResult = new HubChatThreadBootstrap
            {
                Items = [original],
                InitialAnchorMessageId = "m-orig",
            },
        };
        // Старшие страницы цель не содержат и не заканчиваются: лимит — пять.
        api.ChatMessagesFactory = before =>
        {
            if (before is null)
            {
                return api.ChatMessages;
            }

            olderPageCalls++;
            return new HubChatMessageList
            {
                Items = [Msg($"m-x{olderPageCalls}", "c1", "старое", DateTimeOffset.UtcNow.AddMinutes(-10 - olderPageCalls))],
                HasOlder = true,
                OlderCursorMessageId = "m-reply",
            };
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.Messages.Single(m => m.Id == "m-reply").OpenReplyTargetCommand.Execute(null);

        // Лимит подгрузок исчерпан → якорный thread-bootstrap, как у pinned/search.
        await WaitFor(() => api.ThreadBootstrapCalls.Count == 1);
        Assert.Equal(5, olderPageCalls);
        Assert.Equal(("c1", (string?)"m-orig", 40), api.ThreadBootstrapCalls[0]);
        await WaitFor(() => model.SelectedMessage?.Id == "m-orig");
        Assert.True(model.Messages.Single(m => m.Id == "m-orig").IsHighlighted);
    }

    [Fact]
    public async Task ArrowUpEditsLastOwnMessage()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m-own-old", "c1", "старое своё", DateTimeOffset.UtcNow.AddMinutes(-3), own: true),
                    Msg("m-peer", "c1", "чужое", DateTimeOffset.UtcNow.AddMinutes(-2)),
                    Msg("m-own", "c1", "последнее своё", DateTimeOffset.UtcNow.AddMinutes(-1), own: true),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        // tdesktop ↑ в пустом composer: правка ближайшего собственного —
        // чужое сообщение ниже по ленте пропускается.
        model.ComposerText = "черновик";
        model.BeginEditLastOwnMessage();

        Assert.Equal("m-own", model.EditingMessage?.Id);
        Assert.Equal("последнее своё", model.ComposerText);

        // Отмена правки возвращает снапшот черновика (tdesktop draft restore).
        model.CancelComposerContextCommand.Execute(null);
        Assert.Null(model.EditingMessage);
        Assert.Equal("черновик", model.ComposerText);
    }

    [Fact]
    public async Task ArrowUpEditDoesNothingWithoutOwnMessages()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m-peer", "c1", "чужое", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.BeginEditLastOwnMessage();

        Assert.Null(model.EditingMessage);
        Assert.False(model.HasComposerContext);
    }

    [Fact]
    public async Task ComposerWrapTogglesMarkersAroundSelection()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        var capturedStart = -1;
        var capturedLength = -1;
        model.RequestComposerSelection = (start, length) =>
        {
            capturedStart = start;
            capturedLength = length;
        };

        // Ctrl+B на «hello»: обёртка, выделение остаётся на внутреннем тексте.
        model.ComposerText = "hello world";
        model.ToggleComposerWrap("**", 0, 5);
        Assert.Equal("**hello** world", model.ComposerText);
        Assert.Equal((2, 5), (capturedStart, capturedLength));

        // Повтор на том же выделении — маркеры снаружи снимаются.
        model.ToggleComposerWrap("**", 2, 5);
        Assert.Equal("hello world", model.ComposerText);
        Assert.Equal((0, 5), (capturedStart, capturedLength));

        // Выделение включает сами маркеры — тоже снятие (Ctrl+K code).
        model.ComposerText = "a `code` b";
        model.ToggleComposerWrap("`", 2, 6);
        Assert.Equal("a code b", model.ComposerText);
        Assert.Equal((2, 4), (capturedStart, capturedLength));
    }

    [Fact]
    public async Task ComposerWrapEmptyCaretInsertsPair()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        var capturedStart = -1;
        var capturedLength = -1;
        model.RequestComposerSelection = (start, length) =>
        {
            capturedStart = start;
            capturedLength = length;
        };

        model.ToggleComposerWrap("**", 0, 0);

        Assert.Equal("****", model.ComposerText);
        Assert.Equal((2, 0), (capturedStart, capturedLength));
    }

    [Fact]
    public async Task AdjacentConversationNavigationMovesSelection()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                // Список сортируется по LastMessageAt desc → порядок c3,c2,c1.
                Items =
                [
                    Conv("c1", lastAt: now),
                    Conv("c2", lastAt: now.AddMinutes(1)),
                    Conv("c3", lastAt: now.AddMinutes(2)),
                ],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        Assert.Equal(["c3", "c2", "c1"], model.Conversations.Select(c => c.Id));

        model.SelectedConversation = model.Conversations[1];
        // Alt+↓ — к следующему в списке, Alt+↑ — к предыдущему (tdesktop).
        model.SelectAdjacentConversation(1);
        Assert.Equal("c1", model.SelectedConversation?.Id);
        model.SelectAdjacentConversation(-1);
        Assert.Equal("c2", model.SelectedConversation?.Id);
        // За край не выходим: на последнем +1 держит позицию.
        model.SelectAdjacentConversation(1);
        model.SelectAdjacentConversation(1);
        Assert.Equal("c1", model.SelectedConversation?.Id);

        // Без выбора -1 — к последнему, +1 — к первому.
        model.SelectedConversation = null;
        model.SelectAdjacentConversation(-1);
        Assert.Equal("c1", model.SelectedConversation?.Id);
        model.SelectedConversation = null;
        model.SelectAdjacentConversation(1);
        Assert.Equal("c3", model.SelectedConversation?.Id);
    }

    [Fact]
    public async Task MutedWithExpiredUntilStillNotifies()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation
                    {
                        Id = "c1",
                        Kind = "direct",
                        Title = "Был тихий",
                        IsMuted = true,
                        MutedUntil = DateTimeOffset.UtcNow.AddMinutes(-5),
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, realtime);
        var notifications = new List<ChatMessageNotification>();
        model.NotificationRequested += (_, n) => notifications.Add(n);
        await model.LoadAsync();

        Assert.False(model.Conversations[0].IsEffectivelyMuted);
        Assert.Equal(string.Empty, model.Conversations[0].MuteBadgeText);

        realtime.RaiseEvent("chat.message_received",
            "{\"id\":\"m1\",\"conversation_id\":\"c1\",\"kind\":\"text\",\"body\":\"снова слышно\"}");
        await WaitFor(() => notifications.Count == 1);
    }

    // ---- Вложения ----

    [Fact]
    public async Task AttachFilesUploadsChunksAndCompletesMessage()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllBytesAsync(filePath, [1, 2, 3, 4, 5, 6, 7]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
                UploadChunkSize = 4,
                UploadCompletedMessage = Msg("m-up", "c1", "с файлом", DateTimeOffset.UtcNow),
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => !model.IsLoadingMessages);
            model.ComposerText = "подпись к файлу";

            await model.AttachFilesAsync([filePath], CancellationToken.None);

            // Сессия: body и метаданные файла.
            var request = Assert.Single(api.UploadSessionRequests);
            Assert.Equal("c1", request.ConversationId);
            Assert.Equal("подпись к файлу", request.Body);
            var fileMeta = Assert.Single(request.Files);
            Assert.Equal(7, fileMeta.Size);
            Assert.Equal(7, fileMeta.OriginalSize);
            Assert.Equal("text/plain", fileMeta.MimeType);

            // Чанки: 7 байт по 4 → два чанка с офсетами 0 и 4.
            Assert.Equal(2, api.UploadedChunks.Count);
            Assert.Equal(0, api.UploadedChunks[0].Offset);
            Assert.Equal(4, api.UploadedChunks[1].Offset);
            Assert.Equal([1, 2, 3, 4], api.UploadedChunks[0].Data);
            Assert.Equal([5, 6, 7], api.UploadedChunks[1].Data);
            Assert.All(api.UploadedChunks, c => Assert.Equal("upload-1", c.SessionId));

            // Complete → сообщение в ленте, composer очищен.
            Assert.Equal(["upload-1"], api.CompletedSessions);
            Assert.Equal("m-up", Assert.Single(model.Messages).Id);
            Assert.Equal(string.Empty, model.ComposerText);
            Assert.False(model.IsUploading);
            Assert.False(model.HasUploadStatus);
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task AttachFilesWithoutSelectionDoesNothing()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await model.AttachFilesAsync([], CancellationToken.None);

        Assert.Empty(api.UploadSessionRequests);
        Assert.Empty(api.CompletedSessions);
        Assert.False(model.IsUploading);
    }

    [Fact]
    public async Task AttachFilesMissingFileShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await model.AttachFilesAsync(
            [Path.Combine(Path.GetTempPath(), $"hub-test-missing-{Guid.NewGuid():N}.bin")],
            CancellationToken.None);

        Assert.Empty(api.UploadSessionRequests);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task AttachFilesChunkFailureDoesNotComplete()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.bin");
        await File.WriteAllBytesAsync(filePath, [9, 8, 7]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
                UploadChunkException = new InvalidOperationException("chunk lost"),
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => !model.IsLoadingMessages);

            await model.AttachFilesAsync([filePath], CancellationToken.None);

            Assert.Single(api.UploadSessionRequests);
            Assert.Empty(api.CompletedSessions);
            Assert.True(model.HasBannerError);
            Assert.False(model.IsUploading);
            Assert.False(model.HasUploadStatus);
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task AttachFilesCarriesReplyContext()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllBytesAsync(filePath, [1]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList
                {
                    Items = [Msg("m1", "c1", "оригинал", DateTimeOffset.UtcNow)],
                },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => model.Messages.Count == 1);

            model.BeginReplyCommand.Execute(model.Messages[0]);
            await model.AttachFilesAsync([filePath], CancellationToken.None);

            Assert.Equal("m1", Assert.Single(api.UploadSessionRequests).ReplyId);
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task MessageAttachmentsRenderChipsAndOpenHandler()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    new HubChatMessage
                    {
                        Id = "m1",
                        ConversationId = "c1",
                        Kind = "text",
                        CreatedAt = DateTimeOffset.UtcNow,
                        Attachments =
                        [
                            new HubChatAttachment
                            {
                                Id = "a1",
                                FileName = "отчёт.pdf",
                                MimeType = "application/pdf",
                                FileSize = 1536,
                            },
                            new HubChatAttachment
                            {
                                Id = "a2",
                                FileName = "фото.png",
                                MimeType = "image/png",
                                MediaKind = "image",
                                FileSize = 2 * 1024 * 1024,
                            },
                        ],
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var bubble = model.Messages[0];
        Assert.True(bubble.HasAttachmentItems);
        Assert.Equal(2, bubble.AttachmentItems.Count);
        Assert.Equal("отчёт.pdf", bubble.AttachmentItems[0].FileName);
        Assert.Equal($"{1536 / 1024.0:0.#} КБ", bubble.AttachmentItems[0].SizeText);
        Assert.Equal("🖼", bubble.AttachmentItems[1].Icon);
        Assert.Equal($"{2.0:0.#} МБ", bubble.AttachmentItems[1].SizeText);

        // Открытие идёт через AttachmentSaver — в тестах без Process.Start.
        (HubChatAttachment Attachment, string? MessageId)? saved = null;
        model.AttachmentSaver = (attachment, messageId) =>
        {
            saved = (attachment, messageId);
            return Task.CompletedTask;
        };
        bubble.AttachmentItems[0].OpenCommand.Execute(null);
        await WaitFor(() => saved is not null);
        Assert.Equal("a1", saved!.Value.Attachment.Id);
        Assert.Equal("m1", saved.Value.MessageId);
    }

    // ---- Realtime: read-галочки, удаление диалога, room-подписка ----

    [Fact]
    public async Task MessageReadEventShowsDoubleCheckmark()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "моё", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        Assert.Equal("✓", model.Messages[0].StatusText);

        realtime.RaiseEvent("chat.message.read",
            "{\"message_id\":\"m1\",\"conversation_id\":\"c1\",\"read_by_count\":1,\"delivery_status\":\"read\",\"reader_user_id\":9}");
        await WaitFor(() => model.Messages[0].StatusText == "✓✓");
    }

    [Fact]
    public async Task ConversationRemovedEventDropsDialogAndClearsSelection()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent("chat.conversation.removed", "{\"conversation_id\":\"c1\"}");
        await WaitFor(() => model.Conversations.Count == 1);

        Assert.Equal("c2", Assert.Single(model.Conversations).Id);
        Assert.Null(model.SelectedConversation);
    }

    [Fact]
    public async Task SelectingConversationSubscribesRoom()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        await WaitFor(() => realtime.StartCalls > 0);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => realtime.WatchedConversationId == "c1");
        Assert.Equal("c1", realtime.WatchedConversationId);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        await WaitFor(() => realtime.WatchedConversationId == "c2");
        Assert.Equal("c2", realtime.WatchedConversationId);
    }

    // ---- Realtime: индикатор «печатает…» ----

    [Fact]
    public async Task TypingStartedShowsIndicatorAndStoppedHides()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        Assert.Null(model.TypingText);

        // conversation_id приезжает на уровне конверта — в payload его нет.
        realtime.RaiseEvent(
            "chat.typing.started",
            "{\"user_id\":9,\"sender_name\":\"Пётр\",\"is_typing\":true,\"expires_in_ms\":5000}",
            conversationId: "c1");
        Assert.Equal("Пётр печатает…", model.TypingText);
        Assert.True(model.HasTypingText);

        realtime.RaiseEvent(
            "chat.typing.stopped",
            "{\"user_id\":9,\"sender_name\":\"Пётр\",\"is_typing\":false,\"expires_in_ms\":0}",
            conversationId: "c1");
        Assert.Null(model.TypingText);
        Assert.False(model.HasTypingText);
    }

    [Fact]
    public async Task TypingStartedForOtherConversationIsIgnored()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent(
            "chat.typing.started",
            "{\"user_id\":9,\"sender_name\":\"Пётр\",\"is_typing\":true,\"expires_in_ms\":5000}",
            conversationId: "c2");

        Assert.Null(model.TypingText);
        Assert.False(model.HasTypingText);
    }

    [Fact]
    public async Task TypingStartedExpiresAfterTimeout()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        realtime.RaiseEvent(
            "chat.typing.started",
            "{\"user_id\":9,\"sender_name\":\"Пётр\",\"is_typing\":true,\"expires_in_ms\":80}",
            conversationId: "c1");
        Assert.Equal("Пётр печатает…", model.TypingText);

        await WaitFor(() => model.TypingText is null);
        Assert.False(model.HasTypingText);
    }

    [Fact]
    public async Task ComposerTextSendsTypingStartedThrottledAndStoppedOnClear()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.ComposerText = "т";
        Assert.Contains(("c1", true), realtime.TypingCalls);
        Assert.True(realtime.LastTypingState);

        // Троттлинг: правки в пределах 3 секунд новый started не шлют.
        var sentCount = realtime.TypingCalls.Count;
        model.ComposerText = "текст";
        Assert.Equal(sentCount, realtime.TypingCalls.Count);

        model.ComposerText = string.Empty;
        Assert.Contains(("c1", false), realtime.TypingCalls);
        Assert.False(realtime.LastTypingState);
    }

    [Fact]
    public async Task ConversationSwitchSendsTypingStoppedToPrevious()
    {
        var realtime = new FakeChatRealtime();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        model.ComposerText = "черновик";
        Assert.Contains(("c1", true), realtime.TypingCalls);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        Assert.Contains(("c1", false), realtime.TypingCalls);
        Assert.False(realtime.LastTypingState);
    }

    [Fact]
    public async Task AttachFilesUploadMismatchedSessionFilesAborts()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.bin");
        await File.WriteAllBytesAsync(filePath, [1, 2, 3]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
                // Сервер вернул меньше file_id, чем заявлено — сломанный ответ.
                UploadSession = new HubChatUploadSession
                {
                    SessionId = "broken-1",
                    ChunkSizeBytes = 4,
                    Files = [],
                },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => !model.IsLoadingMessages);

            await model.AttachFilesAsync([filePath], CancellationToken.None);

            Assert.Empty(api.UploadedChunks);
            Assert.Empty(api.CompletedSessions);
            Assert.True(model.HasBannerError);
            Assert.False(model.IsUploading);
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    [Fact]
    public async Task AttachFilesPassesClientMessageId()
    {
        var filePath = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllBytesAsync(filePath, [1]);
        try
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList { Items = [] },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            await model.LoadAsync();
            model.SelectedConversation = model.Conversations[0];
            await WaitFor(() => !model.IsLoadingMessages);

            await model.AttachFilesAsync([filePath], CancellationToken.None);

            Assert.False(string.IsNullOrEmpty(Assert.Single(api.UploadSessionRequests).ClientMessageId));
        }
        finally
        {
            File.Delete(filePath);
        }
    }

    // ---- Опросы: голос / закрытие ----

    [Fact]
    public async Task PollVoteCallsApiAndAppliesAggregatedPoll()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [PollMsg("m1", "c1")],
            },
            PollResult = new HubChatPollVoteResult
            {
                MessageId = "m1",
                Action = "voted",
                Poll = new HubChatPoll
                {
                    Question = "Куда идём?",
                    Options =
                    [
                        new HubChatPollOption { Text = "Кино", Votes = 1 },
                        new HubChatPollOption { Text = "Кафе", Votes = 2 },
                    ],
                    TotalVoters = 3,
                    MyOptionIndex = 1,
                },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var bubble = model.Messages[0];
        // JSON-тело опроса текстом не показываем — вопрос из poll-payload.
        Assert.True(bubble.HasPoll);
        Assert.Equal("Куда идём?", bubble.BodyText);
        Assert.Equal(2, bubble.PollOptions.Count);
        Assert.False(bubble.PollOptions[1].IsMine);

        bubble.PollOptions[1].VoteCommand.Execute(null);

        await WaitFor(() => api.PollVoteCalls.Count == 1);
        Assert.Equal(("c1", "m1", 1), api.PollVoteCalls[0]);
        await WaitFor(() => bubble.PollOptions[1].IsMine);
        Assert.Equal("Кафе", bubble.PollOptions[1].Text);
        Assert.Equal(2, bubble.PollOptions[1].Votes);
        Assert.Contains("3", bubble.PollSummaryText);
    }

    [Fact]
    public async Task ClosePollMarksClosedAndHidesCloseAction()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [PollMsg("m1", "c1", own: true)],
            },
            PollResult = new HubChatPollVoteResult
            {
                MessageId = "m1",
                Action = "closed",
                Poll = new HubChatPoll
                {
                    Question = "Куда идём?",
                    Options =
                    [
                        new HubChatPollOption { Text = "Кино", Votes = 1 },
                        new HubChatPollOption { Text = "Кафе", Votes = 2 },
                    ],
                    TotalVoters = 3,
                    Closed = true,
                },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var bubble = model.Messages[0];
        Assert.True(bubble.CanClosePoll);

        bubble.ClosePollCommand.Execute(null);

        await WaitFor(() => api.PollCloseCalls.Count == 1);
        Assert.Equal(("c1", "m1"), api.PollCloseCalls[0]);
        await WaitFor(() => bubble.IsPollClosed);
        Assert.False(bubble.CanClosePoll);
        Assert.True(bubble.PollOptions.All(option => option.IsClosed));
    }

    // ---- Пересылка ----

    [Fact]
    public async Task ForwardSendsRequestAndClosesPanel()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "перешли меня", DateTimeOffset.UtcNow)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.Messages.Count == 1);

        model.BeginForwardCommand.Execute(model.Messages[0]);
        Assert.True(model.IsForwardPanelOpen);
        Assert.Same(model.Messages[0], model.ForwardingMessage);

        var target = model.Conversations.First(c => c.Id == "c2");
        Assert.True(model.PickForwardTargetCommand.CanExecute(target));
        await ((NativeAsyncCommand)model.PickForwardTargetCommand).ExecuteAsync(target);

        var call = Assert.Single(api.ForwardCalls);
        Assert.Equal("c2", call.ConversationId);
        Assert.Equal("m1", call.SourceMessageId);
        Assert.False(string.IsNullOrEmpty(call.ClientMessageId));
        Assert.False(model.IsForwardPanelOpen);
        Assert.Null(model.ForwardingMessage);
        // Как в web — после пересылки переходим в целевой диалог.
        Assert.Equal("c2", model.SelectedConversation?.Id);
    }

    // ---- Глобальный поиск по сообщениям ----

    [Fact]
    public async Task GlobalSearchShowsHitsAndPickJumpsToAnchor()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
            GlobalSearchResult = new HubChatGlobalSearchResult
            {
                Items =
                [
                    new HubChatGlobalSearchHit
                    {
                        ConversationId = "c2",
                        ConversationTitle = "Диалог c2",
                        MessageId = "m-9",
                        SenderName = "Пётр",
                        Preview = "найденное сообщение",
                        CreatedAt = now,
                    },
                ],
            },
            ThreadBootstrapResult = new HubChatThreadBootstrap
            {
                Items = [Msg("m-9", "c2", "найденное сообщение", now)],
                InitialAnchorMessageId = "m-9",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        model.ToggleGlobalSearchCommand.Execute(null);
        Assert.True(model.IsGlobalSearchOpen);

        model.GlobalSearchText = "найденное";
        await WaitFor(() => api.GlobalSearchQueries.Count == 1);
        Assert.Equal(("найденное", 20), api.GlobalSearchQueries[0]);
        await WaitFor(() => model.GlobalSearchResults.Count == 1);

        var hit = model.GlobalSearchResults[0];
        Assert.Equal("Диалог c2", hit.ConversationTitle);
        Assert.Equal("Пётр", hit.SenderName);

        await ((NativeAsyncCommand)model.PickGlobalSearchResultCommand).ExecuteAsync(hit);

        Assert.Equal("c2", model.SelectedConversation?.Id);
        Assert.Equal(("c2", (string?)"m-9", 40), Assert.Single(api.ThreadBootstrapCalls));
        await WaitFor(() => model.Messages.Count == 1 && model.SelectedMessage?.Id == "m-9");
        Assert.Equal("m-9", model.SelectedMessage?.Id);
    }

    [Fact]
    public async Task ManualSelectionClearsOrphanedGlobalSearchAnchor()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            GlobalSearchResult = new HubChatGlobalSearchResult
            {
                Items =
                [
                    new HubChatGlobalSearchHit
                    {
                        ConversationId = "c9",
                        ConversationTitle = "Незагруженный",
                        MessageId = "m-x",
                        Preview = "hit",
                        CreatedAt = now,
                    },
                ],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();

        model.ToggleGlobalSearchCommand.Execute(null);
        model.GlobalSearchText = "hit";
        await WaitFor(() => model.GlobalSearchResults.Count == 1);
        await ((NativeAsyncCommand)model.PickGlobalSearchResultCommand).ExecuteAsync(model.GlobalSearchResults[0]);
        Assert.Null(model.SelectedConversation);

        // Ручной выбор отменяет и pending-диалог, и его якорь.
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);

        // Поздний deep link в другой незагруженный диалог не должен унаследовать чужой якорь.
        api.ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c3")] };
        await model.SelectConversationByIdAsync("c3");
        realtime.RaiseEvent("chat.conversation.updated", "{}");
        await WaitFor(() => model.SelectedConversation?.Id == "c3");

        Assert.Empty(api.ThreadBootstrapCalls);
    }

    // ---- «Кто прочитал» ----

    [Fact]
    public async Task ShowReadersListsNamesFromApi()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "моё", DateTimeOffset.UtcNow, own: true)],
            },
            MessageReads = new HubChatMessageReads
            {
                Items =
                [
                    new HubChatReadReceipt
                    {
                        User = new HubChatUser { Id = 9, FullName = "Иван Иванов" },
                        ReadAt = DateTimeOffset.UtcNow,
                    },
                    new HubChatReadReceipt
                    {
                        User = new HubChatUser { Id = 10, Username = "anna" },
                        ReadAt = DateTimeOffset.UtcNow,
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        await ((NativeAsyncCommand)model.ShowMessageReadersCommand).ExecuteAsync(model.Messages[0]);

        Assert.Equal("m1", Assert.Single(api.ReadsCalls));
        Assert.True(model.IsReadersPanelOpen);
        Assert.Equal("Прочитали: 2", model.ReadersTitleText);
        Assert.Equal(
            ["Иван Иванов", "anna"],
            model.MessageReaders.Select(r => r.DisplayName).ToArray());
    }

    // ---- «Заметки себе» ----

    [Fact]
    public async Task OpenNotesCreatesAndSelectsNotesConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            NotesConversation = new HubChatConversation
            {
                Id = "notes-1",
                Kind = "notes",
                Title = "Заметки",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        Assert.Single(model.Conversations);

        await ((NativeAsyncCommand)model.OpenNotesCommand).ExecuteAsync(null);

        Assert.Equal(1, api.NotesCalls);
        var notes = model.Conversations.FirstOrDefault(c => c.Id == "notes-1");
        Assert.NotNull(notes);
        Assert.Same(notes, model.SelectedConversation);
    }

    // ---- Presence (онлайн-статусы собеседников) ----

    [Fact]
    public async Task LoadWatchesPresenceForDirectPeers()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1"), // direct, peer 9
                    new HubChatConversation
                    {
                        Id = "c2",
                        Kind = "direct",
                        DirectPeer = new HubChatUser { Id = 11, FullName = "Анна" },
                    },
                    Conv("g1", kind: "group", title: "Группа"), // без peer — не watch'им
                ],
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);

        await model.LoadAsync();

        Assert.NotEmpty(realtime.WatchPresenceCalls);
        Assert.Equal(
            [9L, 11L],
            realtime.WatchedPresenceUserIds!.OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task PresenceUpdatedSetsOnlineOnItemAndHeader()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        var item = model.SelectedConversation;
        Assert.False(item!.IsOnline);

        realtime.RaiseEvent(
            "chat.presence.updated",
            "{\"user_id\":9,\"presence\":{\"is_online\":true," +
            "\"last_seen_at\":\"2025-01-05T12:00:00+00:00\",\"status_text\":\"В сети\"}}");

        // Точка в списке и строка в шапке — одно свойство item-VM.
        Assert.True(item.IsOnline);
        Assert.Equal("В сети", item.PresenceText);
        Assert.Equal("В сети", model.SelectedConversation!.PresenceText);
    }

    [Fact]
    public async Task PresenceOfflineShowsLastSeenTextAndFallsBackToSeenTime()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        var item = model.SelectedConversation;

        realtime.RaiseEvent(
            "chat.presence.updated",
            "{\"user_id\":9,\"presence\":{\"is_online\":false," +
            "\"last_seen_at\":\"2025-01-04T10:15:00+00:00\",\"status_text\":\"Вчера в 10:15\"}}");

        Assert.False(item!.IsOnline);
        Assert.Equal("Вчера в 10:15", item.PresenceText);

        // Без status_text — локальный fallback «Был(а) HH:mm» по last_seen_at.
        var seen = DateTimeOffset.UtcNow.AddHours(-1);
        realtime.RaiseEvent(
            "chat.presence.updated",
            "{\"user_id\":9,\"presence\":{\"is_online\":false," +
            "\"last_seen_at\":\"" + seen.ToString("o") + "\"}}");

        Assert.Equal($"Был(а) {seen.LocalDateTime:HH:mm}", item.PresenceText);
    }

    [Fact]
    public async Task DirectPeerPresenceFromDtoAppliesOnLoad()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    new HubChatConversation
                    {
                        Id = "c1",
                        Kind = "direct",
                        DirectPeer = new HubChatUser
                        {
                            Id = 9,
                            FullName = "Пётр",
                            Presence = new HubChatPresence
                            {
                                IsOnline = true,
                                StatusText = "В сети",
                            },
                        },
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        Assert.True(model.Conversations[0].IsOnline);
        Assert.Equal("В сети", model.Conversations[0].PresenceText);
    }

    [Fact]
    public async Task ConversationListChangeRewatchesPresence()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        Assert.Equal([9L], realtime.WatchedPresenceUserIds!.OrderBy(id => id).ToArray());

        // На сервере появился ещё один direct-диалог — набор watch обновляется.
        api.ChatConversations = new HubChatConversationList
        {
            Items =
            [
                Conv("c1"),
                new HubChatConversation
                {
                    Id = "c3",
                    Kind = "direct",
                    DirectPeer = new HubChatUser { Id = 12, FullName = "Новый" },
                },
            ],
        };
        realtime.RaiseEvent("chat.conversation.updated", "{}");

        await WaitFor(
            () => realtime.WatchedPresenceUserIds?.Contains(12L) == true,
            TimeSpan.FromSeconds(5));
        Assert.Equal(
            [9L, 12L],
            realtime.WatchedPresenceUserIds!.OrderBy(id => id).ToArray());
    }

    [Fact]
    public async Task NewDirectConversationAddsPeerToPresenceWatch()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatUsers = new HubChatUserList
            {
                Items = [new HubChatUser { Id = 42, FullName = "Иван" }],
            },
            DirectConversationResult = new HubChatConversation
            {
                Id = "direct-42",
                Kind = "direct",
                DirectPeer = new HubChatUser { Id = 42, FullName = "Иван" },
            },
        };
        var realtime = new FakeChatRealtime();
        var model = new ChatViewModel(api, realtime);
        await model.LoadAsync();
        model.ToggleNewConversationCommand.Execute(null);
        await WaitFor(() => model.FoundUsers.Count == 1);

        await ((NativeAsyncCommand)model.PickUserCommand).ExecuteAsync(model.FoundUsers[0]);

        Assert.Equal(
            [9L, 42L],
            realtime.WatchedPresenceUserIds!.OrderBy(id => id).ToArray());
    }

    // ---- Превью ссылок в сообщениях ----

    [Fact]
    public async Task LinkPreviewRendersCardForFirstUrlInMessage()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "смотри https://example.com/page и ещё текст", DateTimeOffset.UtcNow)],
            },
            LinkPreviewResult = new HubChatLinkPreview
            {
                Url = "https://example.com/page",
                Title = "Заголовок страницы",
                Description = "Описание страницы",
                SiteName = "Example",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);
        var bubble = model.Messages[0];

        await WaitFor(() =>
            bubble.LinkPreviewItems.Count == 1 && !bubble.LinkPreviewItems[0].IsLoading);

        var card = bubble.LinkPreviewItems[0];
        Assert.True(bubble.HasLinkPreviews);
        // Вырезана первая ссылка из текста; запрос ушёл ровно на неё.
        Assert.Equal("https://example.com/page", Assert.Single(api.LinkPreviewRequests));
        Assert.Equal("Example", card.HeaderText); // site_name предпочтительнее хоста
        Assert.Equal("Заголовок страницы", card.Title);
        Assert.Equal("Описание страницы", card.Description);
    }

    [Fact]
    public async Task LinkPreviewShowsCompactCardWhileLoading()
    {
        var gate = new TaskCompletionSource<HubChatLinkPreview>();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "линк https://www.example.org/a", DateTimeOffset.UtcNow)],
            },
            LinkPreviewFactory = _ => gate.Task,
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1 && model.Messages[0].LinkPreviewItems.Count == 1);

        // Пока ответ в пути — компактная карточка с хостом без «www.».
        var loading = model.Messages[0].LinkPreviewItems[0];
        Assert.True(loading.IsLoading);
        Assert.Equal("example.org", loading.HostText);
        Assert.Equal("example.org", loading.HeaderText);
        Assert.Null(loading.Title);

        gate.SetResult(new HubChatLinkPreview { Title = "Поздний заголовок" });
        await WaitFor(() => !model.Messages[0].LinkPreviewItems[0].IsLoading);
        Assert.Equal("Поздний заголовок", model.Messages[0].LinkPreviewItems[0].Title);
    }

    [Fact]
    public async Task LinkPreviewDeduplicatesRequestsForSameUrl()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "c1", "раз https://dup.test/x", DateTimeOffset.UtcNow.AddMinutes(-1)),
                    Msg("m2", "c1", "два https://dup.test/x", DateTimeOffset.UtcNow),
                ],
            },
            LinkPreviewResult = new HubChatLinkPreview { Title = "Общее превью" },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 2);

        await WaitFor(() =>
            model.Messages.All(m => m.LinkPreviewItems.Count == 1 && !m.LinkPreviewItems[0].IsLoading));

        // Кэш на уровне ленты: один url — один запрос (как _inflight в web).
        Assert.Equal("https://dup.test/x", Assert.Single(api.LinkPreviewRequests));
        Assert.All(model.Messages, m => Assert.Equal("Общее превью", m.LinkPreviewItems[0].Title));
    }

    [Fact]
    public async Task LinkPreviewFailureLeavesCompactCardWithoutBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "https://dead-site.test/x", DateTimeOffset.UtcNow)],
            },
            LinkPreviewException = new InvalidOperationException("fetch failed"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);
        var bubble = model.Messages[0];

        await WaitFor(() => api.LinkPreviewRequests.Count > 0);
        await WaitFor(() =>
            bubble.LinkPreviewItems.Count == 1 && !bubble.LinkPreviewItems[0].IsLoading);

        // Превью необязательно: карточка остаётся компактной, баннер не поднимаем.
        var card = bubble.LinkPreviewItems[0];
        Assert.True(bubble.HasLinkPreviews);
        Assert.Null(card.Title);
        Assert.Equal("dead-site.test", card.HeaderText);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task MessageWithoutHttpUrlHasNoLinkPreview()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "c1", "просто текст", DateTimeOffset.UtcNow.AddMinutes(-2)),
                    Msg("m2", "c1", "ftp://files.local/x", DateTimeOffset.UtcNow.AddMinutes(-1)),
                    Msg("m3", "c1", "www.no-scheme.ru", DateTimeOffset.UtcNow),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 3);
        await Task.Delay(200);

        // Только http/https — превью для других схем и голых хостов не строим.
        Assert.All(model.Messages, m => Assert.False(m.HasLinkPreviews));
        Assert.Empty(api.LinkPreviewRequests);
        Assert.Null(ChatMessageViewModel.ExtractFirstChatUrl("javascript:alert(1)"));
        Assert.Equal("https://a.ru/", ChatMessageViewModel.ExtractFirstChatUrl("см. https://a.ru/"));
    }

    [Fact]
    public async Task LinkPreviewCardOpensUrlThroughLinkOpener()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "https://example.com/page", DateTimeOffset.UtcNow)],
            },
            LinkPreviewResult = new HubChatLinkPreview { Title = "T" },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        string? opened = null;
        model.LinkOpener = url =>
        {
            opened = url;
            return Task.CompletedTask;
        };
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() =>
            model.Messages.Count == 1 && model.Messages[0].LinkPreviewItems.Count == 1);

        model.Messages[0].LinkPreviewItems[0].OpenCommand.Execute(null);

        await WaitFor(() => opened is not null);
        Assert.Equal("https://example.com/page", opened);
    }

    // ---- Медиагалерея диалога ----

    [Fact]
    public async Task MediaPanelMergesImageAndVideoStreamsNewestFirst()
    {
        var newer = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachmentsFactory = (_, kind, _) => kind == "image"
                ? new HubChatConversationAttachmentPage
                {
                    Items =
                    [
                        new HubChatConversationAttachmentItem
                        {
                            Id = "a1",
                            MessageId = "m1",
                            Kind = "image",
                            FileName = "фото.png",
                            FileSize = 2048,
                            CreatedAt = newer.AddMinutes(-5),
                        },
                    ],
                }
                : new HubChatConversationAttachmentPage
                {
                    Items =
                    [
                        new HubChatConversationAttachmentItem
                        {
                            Id = "v1",
                            MessageId = "m2",
                            Kind = "video",
                            FileName = "клип.mp4",
                            DurationSeconds = 65,
                            CreatedAt = newer,
                        },
                    ],
                },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsMediaPanelOpen);
        Assert.False(model.IsLoadingMedia);
        Assert.Equal(2, model.MediaItems.Count);
        // Потоки слились по created_at desc — видео новее.
        Assert.Equal("v1", model.MediaItems[0].Id);
        Assert.Equal("🎬", model.MediaItems[0].Icon);
        Assert.Equal("1:05", model.MediaItems[0].DurationText);
        Assert.Equal("a1", model.MediaItems[1].Id);
        Assert.Equal("🖼", model.MediaItems[1].Icon);
        Assert.Equal($"{2048 / 1024.0:0.#} КБ", model.MediaItems[1].SizeText);
        // Первая загрузка тянет оба вида без курсора.
        Assert.Equal(
            [("c1", "image", (string?)null), ("c1", "video", (string?)null)],
            api.ConversationAttachmentCalls
                .Select(c => (c.ConversationId, c.Kind, c.BeforeAttachmentId)).ToArray());
        Assert.False(model.HasMoreMedia);
        Assert.Null(model.MediaEmptyText);
    }

    [Fact]
    public async Task MediaTileOpenDownloadsAttachmentThroughSaver()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachments = new HubChatConversationAttachmentPage
            {
                Items =
                [
                    new HubChatConversationAttachmentItem
                    {
                        Id = "a9",
                        MessageId = "m9",
                        Kind = "image",
                        FileName = "pic.png",
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);
        Assert.Single(model.MediaItems);

        // Тот же путь, что у чипа вложения: AttachmentSaver вместо Process.Start.
        (HubChatAttachment Attachment, string? MessageId)? saved = null;
        model.AttachmentSaver = (attachment, messageId) =>
        {
            saved = (attachment, messageId);
            return Task.CompletedTask;
        };
        model.MediaItems[0].OpenCommand.Execute(null);

        await WaitFor(() => saved is not null);
        Assert.Equal("a9", saved!.Value.Attachment.Id);
        Assert.Equal("m9", saved.Value.MessageId);
    }

    [Fact]
    public async Task MediaImageTileLoadsThumbnailThroughDownloadPath()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachmentsFactory = (_, kind, _) => kind == "image"
                ? new HubChatConversationAttachmentPage
                {
                    Items =
                    [
                        new HubChatConversationAttachmentItem
                        {
                            Id = "a1",
                            MessageId = "m1",
                            Kind = "image",
                            FileName = "фото.png",
                        },
                    ],
                }
                : new HubChatConversationAttachmentPage
                {
                    Items =
                    [
                        new HubChatConversationAttachmentItem
                        {
                            Id = "v1",
                            MessageId = "m2",
                            Kind = "video",
                            FileName = "клип.mp4",
                        },
                    ],
                },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        var image = model.MediaItems.Single(i => i.Id == "a1");
        await WaitFor(() => image.HasThumbnail);

        Assert.NotNull(image.Thumbnail);
        // Превью — тот же авторизованный файл, что качает OpenCommand.
        Assert.Equal("chat/messages/m1/attachments/a1/file", Assert.Single(api.ImageDownloadCalls));
        // Видео остаётся на иконке — превью не грузится.
        var video = model.MediaItems.Single(i => i.Id == "v1");
        Assert.False(video.HasThumbnail);
        Assert.Equal("🎬", video.Icon);
    }

    [Fact]
    public async Task MediaThumbnailErrorKeepsIconTile()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachments = new HubChatConversationAttachmentPage
            {
                Items =
                [
                    new HubChatConversationAttachmentItem
                    {
                        Id = "a1",
                        MessageId = "m1",
                        Kind = "image",
                        FileName = "фото.png",
                    },
                ],
            },
            ImageDownloadException = new HubApiException(HubApiErrorKind.Http, "404"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        var image = Assert.Single(model.MediaItems);
        await WaitFor(() => api.ImageDownloadCalls.Count == 1);
        await Task.Delay(60); // даём конвейеру загрузки завершиться

        Assert.False(image.HasThumbnail);
        Assert.Null(image.Thumbnail);
        Assert.Equal("🖼", image.Icon); // фолбэк на иконку, плитка цела
        Assert.False(model.HasBannerError); // превью — best-effort
    }

    [Fact]
    public async Task MediaPanelLoadMoreAppendsNextPageByKindCursor()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachmentsFactory = (_, kind, cursor) =>
            {
                if (kind == "image")
                {
                    return cursor is null
                        ? new HubChatConversationAttachmentPage
                        {
                            Items =
                            [
                                new HubChatConversationAttachmentItem
                                {
                                    Id = "a2",
                                    MessageId = "m2",
                                    Kind = "image",
                                    FileName = "новое.png",
                                    CreatedAt = DateTimeOffset.UtcNow,
                                },
                            ],
                            HasMore = true,
                            NextBeforeAttachmentId = "cur-img",
                        }
                        : new HubChatConversationAttachmentPage
                        {
                            Items =
                            [
                                new HubChatConversationAttachmentItem
                                {
                                    Id = "a1",
                                    MessageId = "m1",
                                    Kind = "image",
                                    FileName = "старое.png",
                                    CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
                                },
                            ],
                        };
                }

                // Видео сразу кончается — догружать нечего.
                return new HubChatConversationAttachmentPage { Items = [] };
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        Assert.Single(model.MediaItems);
        Assert.True(model.HasMoreMedia);
        Assert.True(model.LoadMoreMediaCommand.CanExecute(null));

        await ((NativeAsyncCommand)model.LoadMoreMediaCommand).ExecuteAsync(null);

        Assert.Equal(2, model.MediaItems.Count);
        Assert.Equal(["a2", "a1"], model.MediaItems.Select(i => i.Id).ToArray());
        Assert.False(model.HasMoreMedia);
        // Третий вызов — догрузка image по курсору; видео-поток закрыт и не повторяется.
        Assert.Equal(
            [("c1", "image", (string?)null), ("c1", "video", (string?)null), ("c1", "image", (string?)"cur-img")],
            api.ConversationAttachmentCalls
                .Select(c => (c.ConversationId, c.Kind, c.BeforeAttachmentId)).ToArray());
    }

    [Fact]
    public async Task MediaPanelErrorShowsBannerAndStopsLoading()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachmentsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.True(model.IsMediaPanelOpen); // панель не падает — повторный вход перезапросит
        Assert.False(model.IsLoadingMedia);
        Assert.Equal("Нет медиа", model.MediaEmptyText);
    }

    [Fact]
    public async Task MediaPanelMutuallyExcludesOverlaysAndClearsOnSwitchAndReset()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachments = new HubChatConversationAttachmentPage
            {
                Items =
                [
                    new HubChatConversationAttachmentItem
                    {
                        Id = "a1",
                        MessageId = "m1",
                        Kind = "image",
                        FileName = "pic.png",
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);
        Assert.True(model.IsMediaPanelOpen);
        Assert.Single(model.MediaItems);

        // Открытие поиска по сообщениям закрывает галерею (и наоборот).
        model.ToggleMessageSearchCommand.Execute(null);
        Assert.False(model.IsMediaPanelOpen);
        Assert.True(model.IsMessageSearchOpen);
        model.ToggleMessageSearchCommand.Execute(null);

        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);
        Assert.True(model.IsMediaPanelOpen);

        // Смена диалога — панель закрыта, элементы и курсоры очищены.
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        Assert.False(model.IsMediaPanelOpen);
        Assert.Empty(model.MediaItems);

        // Reset — то же самое.
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);
        Assert.True(model.IsMediaPanelOpen);
        model.Reset();
        Assert.False(model.IsMediaPanelOpen);
        Assert.Empty(model.MediaItems);
    }

    [Fact]
    public async Task MediaPanelTabsLoadOwnKindsWithIndependentCursors()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ConversationAttachmentsFactory = (_, kind, cursor) =>
            {
                if (kind == "file")
                {
                    return cursor is null
                        ? new HubChatConversationAttachmentPage
                        {
                            Items =
                            [
                                new HubChatConversationAttachmentItem
                                {
                                    Id = "f1",
                                    MessageId = "m1",
                                    MediaKind = "file",
                                    FileName = "отчёт.pdf",
                                    FileSize = 4096,
                                    CreatedAt = DateTimeOffset.UtcNow,
                                },
                            ],
                            HasMore = true,
                            NextBeforeAttachmentId = "cur-file",
                        }
                        : new HubChatConversationAttachmentPage
                        {
                            Items =
                            [
                                new HubChatConversationAttachmentItem
                                {
                                    Id = "f0",
                                    MessageId = "m0",
                                    MediaKind = "file",
                                    FileName = "старый.pdf",
                                    CreatedAt = DateTimeOffset.UtcNow.AddDays(-1),
                                },
                            ],
                        };
                }

                if (kind == "audio")
                {
                    return new HubChatConversationAttachmentPage
                    {
                        Items =
                        [
                            new HubChatConversationAttachmentItem
                            {
                                Id = "au1",
                                MessageId = "m3",
                                MediaKind = "audio",
                                FileName = "голос.ogg",
                                DurationSeconds = 65,
                            },
                        ],
                    };
                }

                // image/video — пусто: вкладка «Медиа» в фикстуре без элементов.
                return new HubChatConversationAttachmentPage { Items = [] };
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMediaPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsMediaTabSelected);
        Assert.Empty(model.MediaItems);
        Assert.Equal("Нет медиа", model.MediaEmptyText);

        // «Файлы»: запрос с kind=file, плитка с именем/размером.
        await ((NativeAsyncCommand)model.SelectMediaTabCommand).ExecuteAsync("file");

        Assert.True(model.IsFilesTabSelected);
        var file = Assert.Single(model.MediaItems);
        Assert.Equal("f1", file.Id);
        Assert.Equal("отчёт.pdf", file.FileName);
        Assert.Equal("📎", file.Icon);
        Assert.Equal($"{4096 / 1024.0:0.#} КБ", file.SizeText);
        Assert.True(model.HasMoreMedia);

        // «Показать ещё» на вкладке «Файлы» догружает именно file-поток по его курсору.
        await ((NativeAsyncCommand)model.LoadMoreMediaCommand).ExecuteAsync(null);

        Assert.Equal(["f1", "f0"], model.MediaItems.Select(i => i.Id).ToArray());
        Assert.False(model.HasMoreMedia);

        // «Аудио»: kind=audio, у потока свой (отсутствующий) курсор — догрузки нет.
        await ((NativeAsyncCommand)model.SelectMediaTabCommand).ExecuteAsync("audio");

        Assert.True(model.IsAudioTabSelected);
        var audio = Assert.Single(model.MediaItems);
        Assert.Equal("au1", audio.Id);
        Assert.Equal("🎵", audio.Icon);
        Assert.Equal("1:05", audio.DurationText);
        Assert.False(model.HasMoreMedia);
        Assert.Null(model.MediaEmptyText);

        // Возврат на «Файлы» — из кэша, без новых запросов; курсор исчерпан.
        var callsBefore = api.ConversationAttachmentCalls.Count;
        await ((NativeAsyncCommand)model.SelectMediaTabCommand).ExecuteAsync("file");

        Assert.Equal(2, model.MediaItems.Count);
        Assert.Equal(callsBefore, api.ConversationAttachmentCalls.Count);
        Assert.False(model.HasMoreMedia);

        // Порядок запросов: media-вкладка (image+video), file первой страницей,
        // file по курсору, audio первой страницей.
        Assert.Equal(
            [
                ("c1", "image", (string?)null),
                ("c1", "video", (string?)null),
                ("c1", "file", (string?)null),
                ("c1", "file", (string?)"cur-file"),
                ("c1", "audio", (string?)null),
            ],
            api.ConversationAttachmentCalls
                .Select(c => (c.ConversationId, c.Kind, c.BeforeAttachmentId)).ToArray());
    }

    // ---- Экспорт истории диалога ----

    [Fact]
    public async Task ExportConversationStreamsBodyToPickedFile()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ExportBytes = "История диалога"u8.ToArray(),
            ExportResult = new HubChatExportResult { FileName = "chat.json", MessagesCount = 3 },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        var path = Path.Combine(
            Path.GetTempPath(), "hub-export-" + Guid.NewGuid().ToString("N") + ".json");
        model.ExportTargetPicker = _ => new ChatExportTarget(path, "json");
        try
        {
            var item = model.Conversations[0];
            Assert.True(item.CanExportHistory);

            item.ExportHistoryCommand.Execute(null);
            await WaitFor(() => api.ExportCalls.Count == 1);
            await WaitFor(() => model.UploadStatusText == "Экспортировано 3 сообщений.");

            Assert.Equal(("c1", "json"), api.ExportCalls[0]);
            Assert.Equal("История диалога"u8.ToArray(), await File.ReadAllBytesAsync(path));
            Assert.Null(model.BannerErrorText);
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
    }

    [Fact]
    public async Task ExportCancelledPickerDoesNotCallApi()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.ExportTargetPicker = _ => null; // Отмена SaveFileDialog.

        model.Conversations[0].ExportHistoryCommand.Execute(null);
        await Task.Delay(100);

        Assert.Empty(api.ExportCalls);
        Assert.Null(model.UploadStatusText);
    }

    [Fact]
    public async Task ExportMenuRespectsGroupRole()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1"), // direct — экспорт доступен любому участнику
                    Conv("g1", kind: "group") with { ViewerMemberRole = "member" },
                    Conv("g2", kind: "group") with { ViewerMemberRole = "moderator" },
                ],
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        // Группы живут на вкладке «Беседы», direct — в «Личные».
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        Assert.False(model.Conversations.First(c => c.Id == "g1").CanExportHistory);
        Assert.True(model.Conversations.First(c => c.Id == "g2").CanExportHistory);

        model.ActiveFolderKey = ChatViewModel.PersonalFolderKey;
        Assert.True(model.Conversations.First(c => c.Id == "c1").CanExportHistory);
    }

    // ---- Передача владения группой ----

    [Fact]
    public async Task TransferOwnershipCallsApiAndUnlocksLeaveForFormerOwner()
    {
        var api = MembersApiFixture("owner");
        // Ответ ownership: viewer перестал быть владельцем, Иван — новый owner.
        api.TransferOwnershipResult = api.ConversationDetailResult! with
        {
            ViewerMemberRole = "moderator",
            Members =
            [
                new HubChatMember
                {
                    User = new HubChatUser { Id = 7, FullName = "Я" },
                    MemberRole = "moderator",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 42, FullName = "Иван Иванов" },
                    MemberRole = "owner",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 43, FullName = "Анна Петрова" },
                    MemberRole = "moderator",
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        var group = model.Conversations[0];
        Assert.False(group.CanLeaveGroup); // владельцу сначала нужен приёмник
        var ivan = Assert.Single(model.GroupMembers, m => m.UserId == 42);
        var anna = Assert.Single(model.GroupMembers, m => m.UserId == 43);
        var me = Assert.Single(model.GroupMembers, m => m.UserId == 7);
        Assert.True(ivan.CanTransferOwnership);
        Assert.True(anna.CanTransferOwnership); // moderator — тоже приёмник
        Assert.False(me.CanTransferOwnership); // себе передать нельзя

        ivan.TransferOwnershipCommand.Execute(null);
        await WaitFor(() => api.TransferOwnershipCalls.Count == 1);
        await WaitFor(() => group.CanLeaveGroup);

        // POST /conversations/g1/ownership {owner_user_id: 42}.
        Assert.Equal(("g1", 42), api.TransferOwnershipCalls[0]);
        // Свежий detail применён к строке списка: роль viewer сменилась → «Покинуть» открыт.
        Assert.Equal("moderator", group.ViewerMemberRole);
        Assert.True(group.CanLeaveGroup);
        // Панель перерисована из ответа: Иван — владелец, передача закрыта для всех.
        Assert.Equal("Владелец", Assert.Single(model.GroupMembers, m => m.UserId == 42).RoleText);
        Assert.DoesNotContain(model.GroupMembers, m => m.CanTransferOwnership);
    }

    [Fact]
    public async Task TransferOwnershipForMemberViewerIsHidden()
    {
        var api = MembersApiFixture("member");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        Assert.DoesNotContain(model.GroupMembers, m => m.CanTransferOwnership);
        Assert.Empty(api.TransferOwnershipCalls);
    }

    // ---- Роли и ограничения участников ----

    [Fact]
    public async Task PromoteMemberCallsApiAndRefreshesRow()
    {
        var api = MembersApiFixture("owner");
        api.MemberRoleResult = api.ConversationDetailResult! with
        {
            Members =
            [
                new HubChatMember
                {
                    User = new HubChatUser { Id = 7, FullName = "Я" },
                    MemberRole = "owner",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 42, FullName = "Иван Иванов" },
                    MemberRole = "moderator",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 43, FullName = "Анна Петрова" },
                    MemberRole = "moderator",
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        var ivan = Assert.Single(model.GroupMembers, m => m.UserId == 42);
        var anna = Assert.Single(model.GroupMembers, m => m.UserId == 43);
        var me = Assert.Single(model.GroupMembers, m => m.UserId == 7);
        Assert.True(ivan.CanPromote);
        Assert.False(ivan.CanDemote);
        Assert.True(anna.CanDemote);   // owner может снять moderator'а
        Assert.False(anna.CanPromote);
        Assert.False(me.CanPromote); // себя менять нельзя

        ivan.PromoteCommand.Execute(null);
        await WaitFor(() => api.MemberRoleCalls.Count == 1);

        // PATCH members/42/role {member_role: "moderator"} → свежий detail в панель.
        Assert.Equal(("g1", 42, "moderator"), api.MemberRoleCalls[0]);
        Assert.Equal("Модератор", Assert.Single(model.GroupMembers, m => m.UserId == 42).RoleText);
    }

    [Fact]
    public async Task RoleCommandsHiddenForModeratorViewer()
    {
        var api = MembersApiFixture("moderator");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        Assert.True(model.CanManageGroupMembers);
        Assert.False(model.CanManageGroupOwners); // роли — привилегия владельца
        Assert.DoesNotContain(model.GroupMembers, m => m.CanPromote || m.CanDemote);
        Assert.Empty(api.MemberRoleCalls);
    }

    [Fact]
    public async Task RestrictMemberCallsApiWithDuration()
    {
        var api = MembersApiFixture("owner");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        var ivan = Assert.Single(model.GroupMembers, m => m.UserId == 42);
        Assert.True(ivan.CanRestrict);

        ivan.RestrictCommand.Execute("3600");
        await WaitFor(() => api.RestrictMemberCalls.Count == 1);

        Assert.Equal(("g1", 42, (int?)3600), api.RestrictMemberCalls[0]);
    }

    [Fact]
    public async Task LiftRestrictionCallsDeleteEndpoint()
    {
        var api = MembersApiFixture("owner");
        api.ConversationDetailResult = api.ConversationDetailResult! with
        {
            Members =
            [
                new HubChatMember
                {
                    User = new HubChatUser { Id = 7, FullName = "Я" },
                    MemberRole = "owner",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 42, FullName = "Иван Иванов" },
                    MemberRole = "member",
                    IsRestricted = true,
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        var ivan = Assert.Single(model.GroupMembers, m => m.UserId == 42);
        Assert.True(ivan.IsRestricted);
        Assert.Equal("ограничен", ivan.RestrictedText);

        ivan.LiftRestrictionCommand.Execute(null);
        await WaitFor(() => api.LiftRestrictionCalls.Count == 1);

        Assert.Equal(("g1", 42), api.LiftRestrictionCalls[0]);
    }

    [Fact]
    public async Task MemberViewerHasNoModerationActions()
    {
        var api = MembersApiFixture("member");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        // Fail-closed: у обычного участника нет ни одного действия модерации.
        Assert.DoesNotContain(model.GroupMembers, m => m.HasModerationActions);
        Assert.Empty(api.MemberRoleCalls);
        Assert.Empty(api.RestrictMemberCalls);
        Assert.Empty(api.LiftRestrictionCalls);
    }

    [Fact]
    public async Task MemberRoleFailureShowsBanner()
    {
        var api = MembersApiFixture("owner");
        api.MemberRoleException = new HubApiException(HubApiErrorKind.Transport, "down");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleMembersPanelCommand).ExecuteAsync(null);

        model.GroupMembers.Single(m => m.UserId == 42).PromoteCommand.Execute(null);
        await WaitFor(() => model.HasBannerError);
    }

    // ---- Заявки на вступление ----

    /// <summary>Открывает настройки группы (owner) — там живут заявки/жалобы/ссылка.</summary>
    private static async Task<ChatViewModel> OpenGroupSettingsAsync(FakeHubApiClient api)
    {
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleGroupSettingsCommand).ExecuteAsync(null);
        Assert.True(model.IsGroupSettingsOpen);
        Assert.True(model.CanManageGroupMembers);
        return model;
    }

    [Fact]
    public async Task JoinRequestsPanelListsAndApproveRemovesRow()
    {
        var api = MembersApiFixture("owner");
        api.JoinRequestsResult = new HubChatJoinRequestList
        {
            Items =
            [
                new HubChatJoinRequestItem
                {
                    Id = 11,
                    UserId = 55,
                    UserName = "Пётр Заявителев",
                    CreatedAt = DateTimeOffset.UtcNow,
                },
                new HubChatJoinRequestItem
                {
                    Id = 12,
                    UserId = 56,
                    UserName = "Анна Просителева",
                },
            ],
            OpenCount = 2,
            ApprovalRequired = true,
        };
        var model = await OpenGroupSettingsAsync(api);
        await ((NativeAsyncCommand)model.ToggleJoinRequestsPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsJoinRequestsPanelOpen);
        Assert.Equal(2, model.JoinRequests.Count);
        Assert.True(model.IsJoinApprovalRequired); // режим пришёл из списка, без записи
        Assert.Empty(api.JoinApprovalCalls);
        Assert.Equal("2", model.JoinRequestsBadgeText);

        model.JoinRequests[0].ApproveCommand.Execute(null);
        await WaitFor(() => api.JoinRequestDecisionCalls.Count == 1);

        Assert.Equal(("g1", 11L, "approve"), api.JoinRequestDecisionCalls[0]);
        Assert.Single(model.JoinRequests); // решённая строка убрана
        Assert.Equal(56, model.JoinRequests[0].UserId);
    }

    [Fact]
    public async Task JoinApprovalToggleWritesModeAndRollbackOnError()
    {
        var api = MembersApiFixture("owner");
        var model = await OpenGroupSettingsAsync(api);
        await ((NativeAsyncCommand)model.ToggleJoinRequestsPanelCommand).ExecuteAsync(null);

        model.IsJoinApprovalRequired = true;
        await WaitFor(() => api.JoinApprovalCalls.Count == 1);
        Assert.Equal(("g1", true), api.JoinApprovalCalls[0]);
        Assert.True(model.IsJoinApprovalRequired);

        // Сбой записи — свитч откатывается к факту.
        api.JoinApprovalException = new HubApiException(HubApiErrorKind.Transport, "down");
        model.IsJoinApprovalRequired = false;
        await WaitFor(() => api.JoinApprovalCalls.Count == 2);
        await WaitFor(() => model.IsJoinApprovalRequired);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task JoinRequestsClosedForMemberViewer()
    {
        var api = MembersApiFixture("member");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleGroupSettingsCommand).ExecuteAsync(null);
        Assert.False(model.CanManageGroupMembers);

        Assert.False(model.ToggleJoinRequestsPanelCommand.CanExecute(null));
        Assert.False(model.ToggleReportsPanelCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.ToggleJoinRequestsPanelCommand).ExecuteAsync(null);
        Assert.False(model.IsJoinRequestsPanelOpen);
        Assert.Empty(api.JoinRequestsCalls);
        Assert.Empty(api.ReportsCalls);
    }

    // ---- Жалобы на сообщения ----

    [Fact]
    public async Task ReportDialogSubmitsReasonAndCloses()
    {
        var api = MembersApiFixture("owner");
        api.ChatMessages = new HubChatMessageList
        {
            Items = [Msg("m9", "g1", "спамное", DateTimeOffset.UtcNow)],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var message = model.Messages[0];
        Assert.True(message.CanReport); // чужое сообщение в группе

        model.BeginReportCommand.Execute(message);
        Assert.True(model.IsReportDialogOpen);
        model.IsReportReasonOther = true;
        model.ReportComment = "подозрительно";

        await ((NativeAsyncCommand)model.SubmitReportCommand).ExecuteAsync(null);

        var call = Assert.Single(api.ReportCalls);
        Assert.Equal(("g1", "m9", "other", "подозрительно"), call);
        Assert.False(model.IsReportDialogOpen);
        Assert.Equal("Жалоба отправлена владельцу группы.", model.UploadStatusText);
    }

    [Fact]
    public async Task ReportHiddenForOwnMessagesAndDirectChats()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "c1", "свое", DateTimeOffset.UtcNow, own: true),
                    Msg("m2", "c1", "чужое", DateTimeOffset.UtcNow),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 2);

        // Прямой диалог: жалоб нет вовсе (пункт есть только в группах, как в web).
        Assert.False(model.Messages[0].CanReport);
        Assert.False(model.Messages[1].CanReport);
        Assert.Empty(api.ReportCalls);
    }

    [Fact]
    public async Task ReportsPanelListsAndResolveRemovesRow()
    {
        var api = MembersApiFixture("owner");
        api.ReportsResult = new HubChatMessageReportList
        {
            Items =
            [
                new HubChatMessageReport
                {
                    Id = 21,
                    MessageId = "m1",
                    Reason = "spam",
                    ReporterName = "Иван",
                    SenderName = "Пётр",
                    MessagePreview = "купи слона",
                },
                new HubChatMessageReport
                {
                    Id = 22,
                    MessageId = "m2",
                    Reason = "other",
                    Comment = "странное",
                },
            ],
            OpenCount = 2,
        };
        var model = await OpenGroupSettingsAsync(api);
        await ((NativeAsyncCommand)model.ToggleReportsPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsReportsPanelOpen);
        Assert.Equal(2, model.MessageReports.Count);
        Assert.Equal("Спам", model.MessageReports[0].ReasonText);
        Assert.Equal("от Иван", model.MessageReports[0].ReporterText);
        Assert.Equal("2", model.ReportsBadgeText);

        model.MessageReports[0].ResolveCommand.Execute(null);
        await WaitFor(() => api.ReportResolveCalls.Count == 1);

        Assert.Equal(("g1", 21L, "resolved"), api.ReportResolveCalls[0]);
        Assert.Single(model.MessageReports);
        Assert.Equal(22, model.MessageReports[0].Id);
    }

    // ---- Ссылка-приглашение и профиль группы ----

    [Fact]
    public async Task InviteLinkCreateShowsUrlAndRevokeIsArmed()
    {
        var api = MembersApiFixture("owner");
        var model = await OpenGroupSettingsAsync(api);

        await ((NativeAsyncCommand)model.CreateInviteLinkCommand).ExecuteAsync(null);

        Assert.Equal("g1", Assert.Single(api.InviteLinkCalls));
        Assert.True(model.HasGroupInviteLink);
        Assert.EndsWith("chat?join=invite-token", model.GroupInviteLink);

        // «Отозвать» — armed: первый клик меняет подпись, второй вызывает DELETE.
        await ((NativeAsyncCommand)model.RevokeInviteLinkCommand).ExecuteAsync(null);
        Assert.Empty(api.InviteRevokeCalls);
        Assert.Equal("Точно отозвать?", model.InviteRevokeText);

        await ((NativeAsyncCommand)model.RevokeInviteLinkCommand).ExecuteAsync(null);
        Assert.Equal("g1", Assert.Single(api.InviteRevokeCalls));
        Assert.False(model.HasGroupInviteLink);
        Assert.Equal("Отозвать ссылку", model.InviteRevokeText);
    }

    [Fact]
    public async Task GroupProfileSavePatchesTitleForOwner()
    {
        var api = MembersApiFixture("owner");
        api.ConversationDetailResult = api.ConversationDetailResult! with
        {
            Description = "старое описание",
        };
        api.GroupProfileResult = api.ConversationDetailResult with
        {
            Title = "Новое имя",
            Description = "старое описание",
        };
        var model = await OpenGroupSettingsAsync(api);

        Assert.True(model.CanManageGroupOwners);
        Assert.Equal("старое описание", model.GroupDescriptionDraft);
        model.GroupTitleDraft = "Новое имя";
        Assert.True(model.CanSaveGroupProfile);

        await ((NativeAsyncCommand)model.SaveGroupProfileCommand).ExecuteAsync(null);

        var call = Assert.Single(api.GroupProfileCalls);
        Assert.Equal(("g1", "Новое имя", null, null, null, null), call);
        Assert.Equal("Новое имя", model.Conversations[0].Title);
    }

    [Fact]
    public async Task GroupProfileForModeratorPatchesDescriptionOnly()
    {
        var api = MembersApiFixture("moderator");
        api.ConversationDetailResult = api.ConversationDetailResult! with
        {
            Description = "старое",
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        // Диалог-фикстура — группа: по умолчанию вкладка «Личные» её скрывает.
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.ToggleGroupSettingsCommand).ExecuteAsync(null);
        Assert.False(model.CanManageGroupOwners);

        // Модератору название недоступно — уходит только описание.
        model.GroupTitleDraft = "Подсунутое имя";
        model.GroupDescriptionDraft = "новое описание";
        Assert.True(model.CanSaveGroupProfile);

        await ((NativeAsyncCommand)model.SaveGroupProfileCommand).ExecuteAsync(null);

        var call = Assert.Single(api.GroupProfileCalls);
        Assert.Equal(("g1", null, "новое описание", null, null, null), call);
    }

    [Fact]
    public async Task DeleteGroupIsArmedAndRemovesConversation()
    {
        var api = MembersApiFixture("owner");
        api.ConversationDetailResult = api.ConversationDetailResult!;
        var model = await OpenGroupSettingsAsync(api);
        Assert.True(model.CanManageGroupOwners);

        await ((NativeAsyncCommand)model.DeleteGroupCommand).ExecuteAsync(null);
        Assert.Empty(api.DeletedConversations);
        Assert.Equal("Точно удалить группу?", model.DeleteGroupText);

        await ((NativeAsyncCommand)model.DeleteGroupCommand).ExecuteAsync(null);
        Assert.Equal("g1", Assert.Single(api.DeletedConversations));
        Assert.DoesNotContain(model.Conversations, c => c.Id == "g1");
        Assert.Null(model.SelectedConversation);
        Assert.False(model.IsGroupSettingsOpen);
    }

    [Fact]
    public async Task GroupAvatarUploadReadsFileAndMarksHasAvatar()
    {
        var api = MembersApiFixture("owner");
        api.GroupAvatarResult = api.ConversationDetailResult! with
        {
            AvatarUrl = "https://hubit.zsgp.ru/avatars/g1.png",
        };
        var model = await OpenGroupSettingsAsync(api);
        Assert.False(model.HasGroupAvatar);

        var path = Path.Combine(Path.GetTempPath(), "hub-avatar-" + Guid.NewGuid().ToString("N") + ".png");
        await File.WriteAllBytesAsync(path, TestImageBytes.Png1X1);
        try
        {
            model.GroupAvatarPicker = () => path;
            await ((NativeAsyncCommand)model.UploadGroupAvatarCommand).ExecuteAsync(null);
        }
        finally
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }

        var call = Assert.Single(api.GroupAvatarCalls);
        Assert.Equal("g1", call.ConversationId);
        Assert.Equal("image/png", call.MimeType);
        Assert.True(model.HasGroupAvatar);

        api.GroupAvatarResult = api.ConversationDetailResult! with { AvatarUrl = null };
        await ((NativeAsyncCommand)model.RemoveGroupAvatarCommand).ExecuteAsync(null);
        Assert.Equal("g1", Assert.Single(api.GroupAvatarDeleteCalls));
        Assert.False(model.HasGroupAvatar);
    }

    // ---- «Поделиться задачей» и поддержка ----

    [Fact]
    public async Task TaskShareSendsMessageAndShowsTaskCard()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ShareableTasksResult = new HubChatShareableTaskList
            {
                Items =
                [
                    new HubChatTaskPreview
                    {
                        Id = "42",
                        Title = "Починить принтер",
                        Status = "in_progress",
                    },
                ],
            },
            TaskShareFactory = () => new HubChatMessage
            {
                Id = "msg-task1",
                ConversationId = "c1",
                Kind = "task_share",
                CreatedAt = DateTimeOffset.UtcNow,
                IsOwn = true,
                TaskPreview = new HubChatTaskPreview
                {
                    Id = "42",
                    Title = "Починить принтер",
                    Status = "in_progress",
                },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.OpenTaskShareCommand).ExecuteAsync(null);
        Assert.True(model.IsTaskShareOpen);
        var task = Assert.Single(model.ShareableTasks);
        Assert.Equal("Починить принтер", task.Title);

        task.ShareCommand.Execute(null);
        await WaitFor(() => api.TaskShareCalls.Count == 1);
        await WaitFor(() => model.Messages.Count == 1);

        Assert.Equal(("c1", "42"), api.TaskShareCalls[0]);
        var message = model.Messages[0];
        Assert.True(message.HasTaskCard);
        Assert.Equal("Починить принтер", message.TaskCardTitle);
        Assert.False(model.IsTaskShareOpen); // панель закрыта после отправки
    }

    [Fact]
    public async Task TaskShareSearchDebouncesQuery()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        await ((NativeAsyncCommand)model.OpenTaskShareCommand).ExecuteAsync(null);
        await WaitFor(() => api.ShareableTasksCalls.Count == 1);

        model.TaskShareSearchText = "принтер";
        await WaitFor(() => api.ShareableTasksCalls.Count == 2);

        Assert.Equal("принтер", api.ShareableTasksCalls[1].Query);
    }

    [Fact]
    public async Task OpenSupportCreatesAndSelectsConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            SupportConversationResult = new HubChatConversation
            {
                Id = "sup-1",
                Kind = "direct",
                Title = "Поддержка",
                IsSupport = true,
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.OpenSupportCommand).ExecuteAsync(null);

        Assert.Equal(1, api.SupportCalls);
        var item = Assert.Single(model.Conversations, c => c.Id == "sup-1");
        Assert.Same(item, model.SelectedConversation);
        Assert.Equal("Поддержка", item.Title);
    }

    // ---- Deep link «/chat?join=TOKEN» ----

    [Fact]
    public async Task InviteJoinUpsertsAndSelectsConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            InviteJoinResult = new HubChatInviteJoinResult
            {
                Joined = true,
                Conversation = new HubChatConversation
                {
                    Id = "g-joined",
                    Kind = "group",
                    Title = "Новая группа",
                    MemberCount = 10,
                    ViewerMemberRole = "member",
                },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        // Присоединённая группа видна на вкладке «Беседы».
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;

        await model.JoinConversationByInviteTokenAsync("tok-1");

        Assert.Equal("tok-1", Assert.Single(api.InviteJoinCalls));
        var item = Assert.Single(model.Conversations, c => c.Id == "g-joined");
        Assert.Same(item, model.SelectedConversation);
    }

    [Fact]
    public async Task InviteJoinRequestedShowsInfoBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            InviteJoinResult = new HubChatInviteJoinResult { Requested = true },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        await model.JoinConversationByInviteTokenAsync("tok-2");

        Assert.True(model.HasBannerError);
        Assert.Contains("Заявка", model.BannerErrorText);
        Assert.Null(model.SelectedConversation);
    }

    // ---- Гидратация статусов загруженных сообщений ----

    [Fact]
    public async Task HydrateAppliesDeliveryStatusToLoadedMessages()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "моё", DateTimeOffset.UtcNow, own: true)],
            },
            HydrateResult = new HubChatThreadHydrateResult
            {
                Items =
                [
                    new HubChatThreadHydrateItem
                    {
                        MessageId = "m1",
                        ReadByCount = 3,
                        DeliveryStatus = "read",
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        // Гидратация стартует сразу после загрузки и догоняет статус ✓✓.
        await WaitFor(() => api.HydrateCalls.Count == 1);
        await WaitFor(() => model.Messages[0].StatusText == "✓✓");

        var (conversationId, ids) = api.HydrateCalls[0];
        Assert.Equal("c1", conversationId);
        Assert.Equal(["m1"], ids);
    }

    // ---- Отложенные сообщения («Отправить позже») ----

    [Fact]
    public async Task ScheduledFeatureFollowsConfigFlag()
    {
        // Флаг выключен — «Отправить позже» недоступно.
        var offModel = new ChatViewModel(new FakeHubApiClient(), new FakeChatRealtime());
        await offModel.LoadAsync();
        Assert.False(offModel.IsScheduledMessagesEnabled);

        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.True(model.CanScheduleMessage);
        Assert.True(model.OpenScheduleEditorCommand.CanExecute(null));
        // Список отложенных подгружается вместе с диалогом.
        Assert.Equal(1, api.ScheduledListCallCount);
        Assert.Equal("c1", api.LastScheduledListConversationId);
    }

    [Fact]
    public async Task ScheduledEditorPrefillsComposerAndPostsIsoTime()
    {
        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "  напомнить коллеге  ";

        model.OpenScheduleEditorCommand.Execute(null);

        Assert.True(model.IsScheduleEditorOpen);
        Assert.Equal("Отправить позже", model.ScheduleEditorTitle);
        Assert.Equal("  напомнить коллеге  ", model.ScheduleDraftBody);
        Assert.NotNull(model.ScheduleDraftDate);
        Assert.False(string.IsNullOrEmpty(model.ScheduleDraftTime));
        Assert.Null(model.ScheduleDraftErrorText);
        Assert.StartsWith("Будет отправлено", model.ScheduleDraftHint);

        model.ScheduleDraftDate = DateTime.Today.AddDays(2);
        model.ScheduleDraftTime = "15:30";
        Assert.True(model.ConfirmScheduleCommand.CanExecute(null));

        await ((NativeAsyncCommand)model.ConfirmScheduleCommand).ExecuteAsync(null);
        await WaitFor(() => api.ScheduledCreateCalls.Count == 1);

        var (conversationId, body, scheduledFor, replyTo) = api.ScheduledCreateCalls[0];
        Assert.Equal("c1", conversationId);
        Assert.Equal("напомнить коллеге", body);
        Assert.Null(replyTo);
        // Локальные 15:30 по третьему дню — клиент отдаёт момент как есть.
        Assert.Equal(DateTime.Today.AddDays(2) + TimeSpan.FromHours(15.5),
            scheduledFor.LocalDateTime);
        // Успешное планирование чистит composer, редактор закрыт, список пополнен.
        Assert.Equal(string.Empty, model.ComposerText);
        Assert.False(model.IsScheduleEditorOpen);
        Assert.Single(model.ScheduledMessages);
        Assert.True(model.HasScheduledBar);
        Assert.Contains("Запланировано: 1", model.ScheduledBarText);
    }

    [Fact]
    public async Task ScheduledEditorRejectsPastFarFutureAndBadTime()
    {
        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.OpenScheduleEditorCommand.Execute(null);

        // Прошлое — «Время должно быть в будущем».
        model.ScheduleDraftDate = DateTime.Today.AddDays(-1);
        model.ScheduleDraftTime = "12:00";
        Assert.Equal("Время должно быть в будущем", model.ScheduleDraftErrorText);
        Assert.False(model.ConfirmScheduleCommand.CanExecute(null));

        // Больше года — «Не дальше, чем на год».
        model.ScheduleDraftDate = DateTime.Today.AddDays(400);
        Assert.Equal("Не дальше, чем на год", model.ScheduleDraftErrorText);
        Assert.False(model.ConfirmScheduleCommand.CanExecute(null));

        // Неразборчивое время — «Укажите дату и время».
        model.ScheduleDraftDate = DateTime.Today.AddDays(2);
        model.ScheduleDraftTime = "полдень";
        Assert.Equal("Укажите дату и время", model.ScheduleDraftErrorText);
        Assert.False(model.ConfirmScheduleCommand.CanExecute(null));

        // Пустой текст — подтвердить нельзя.
        model.ScheduleDraftTime = "15:00";
        model.ScheduleDraftBody = "   ";
        Assert.False(model.ConfirmScheduleCommand.CanExecute(null));

        Assert.Empty(api.ScheduledCreateCalls);
    }

    [Fact]
    public async Task ScheduledEditPatchesAndCancelIsArmed()
    {
        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        api.ScheduledItems["c1"] =
        [
            new HubChatScheduledMessage
            {
                Id = "s1",
                ConversationId = "c1",
                Body = "Старый текст",
                Status = "scheduled",
                ScheduledFor = DateTimeOffset.Now.AddHours(3),
            },
        ];
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.ScheduledMessages.Count == 1);
        var item = model.ScheduledMessages[0];

        // Правка: подставляем текст и время существующего, PATCH по id.
        item.EditCommand.Execute(null);
        Assert.True(model.IsScheduleEditorOpen);
        Assert.Equal("Изменить запланированное", model.ScheduleEditorTitle);
        Assert.Equal("Сохранить", model.ScheduleEditorConfirmText);
        Assert.Equal("Старый текст", model.ScheduleDraftBody);

        model.ScheduleDraftBody = "Новый текст";
        model.ScheduleDraftDate = DateTime.Today.AddDays(1);
        model.ScheduleDraftTime = "09:00";
        await ((NativeAsyncCommand)model.ConfirmScheduleCommand).ExecuteAsync(null);
        await WaitFor(() => api.ScheduledUpdateCalls.Count == 1);

        var (editId, editBody, editWhen) = api.ScheduledUpdateCalls[0];
        Assert.Equal("s1", editId);
        Assert.Equal("Новый текст", editBody);
        Assert.Equal(DateTime.Today.AddDays(1).AddHours(9), editWhen?.LocalDateTime);
        Assert.False(model.IsScheduleEditorOpen);
        Assert.Empty(api.ScheduledCreateCalls);

        // Отмена — armed: первый клик просит повтор, DELETE идёт со второго.
        item = model.ScheduledMessages[0];
        item.CancelCommand.Execute(null);
        Assert.True(item.CancelArmed);
        Assert.Equal("Точно?", item.CancelText);
        Assert.Empty(api.ScheduledCancelCalls);

        item.CancelCommand.Execute(null);
        await WaitFor(() => api.ScheduledCancelCalls.Count == 1);
        Assert.Equal("s1", Assert.Single(api.ScheduledCancelCalls));
        await WaitFor(() => model.ScheduledMessages.Count == 0);
        Assert.False(model.HasScheduledBar);
    }

    [Fact]
    public async Task ScheduledErrorsAreIsolatedFromChatBanner()
    {
        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ScheduledListException = new HubApiException(HubApiErrorKind.Http, "boom"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => api.ScheduledListCallCount > 0);
        await WaitFor(() => model.HasScheduledError);

        Assert.False(model.HasBannerError);
        Assert.True(model.HasScheduledBar);
        Assert.True(model.ScheduledBarIsError);

        // Ошибка записи — в изолированный текст, лента не краснеет.
        api.ScheduledListException = null;
        api.ScheduledCreateException = new HubApiException(HubApiErrorKind.Http, "refused");
        model.OpenScheduleEditorCommand.Execute(null);
        model.ScheduleDraftBody = "текст";
        model.ScheduleDraftDate = DateTime.Today.AddDays(1);
        model.ScheduleDraftTime = "10:00";
        await ((NativeAsyncCommand)model.ConfirmScheduleCommand).ExecuteAsync(null);
        await WaitFor(() => api.ScheduledCreateCalls.Count == 1);
        await WaitFor(() => model.HasScheduledError);

        Assert.True(model.IsScheduleEditorOpen);
        Assert.False(model.HasBannerError);
        Assert.Equal("текст", model.ScheduleDraftBody);
    }

    [Fact]
    public async Task ScheduledStateResetsOnConversationSwitch()
    {
        var api = new FakeHubApiClient
        {
            ChatConfig = new HubChatConfig { ScheduledMessagesEnabled = true },
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
        };
        api.ScheduledItems["c1"] =
        [
            new HubChatScheduledMessage
            {
                Id = "s1",
                ConversationId = "c1",
                Body = "Отложенное c1",
                Status = "scheduled",
                ScheduledFor = DateTimeOffset.Now.AddHours(2),
            },
        ];
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.IsScheduledMessagesEnabled);
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.ScheduledMessages.Count == 1);

        model.OpenScheduleEditorCommand.Execute(null);
        Assert.True(model.IsScheduleEditorOpen);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        await WaitFor(() => api.ScheduledListCallCount >= 2);

        Assert.False(model.IsScheduleEditorOpen);
        Assert.Empty(model.ScheduledMessages);
        Assert.False(model.HasScheduledBar);
        Assert.Equal("c2", api.LastScheduledListConversationId);

        // Обратно — список c1 подгружается заново.
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.ScheduledMessages.Count == 1);
        Assert.Equal("s1", model.ScheduledMessages[0].Id);
    }

    [Fact]
    public void ScheduledTimeFormatsAndPresetsMatchWeb()
    {
        var now = new DateTime(2026, 11, 19, 10, 0, 0, DateTimeKind.Local);

        Assert.Equal("сегодня в 18:30",
            ChatScheduleTime.Format(new DateTimeOffset(now.Date.AddHours(18).AddMinutes(30)), now));
        Assert.Equal("завтра в 09:00",
            ChatScheduleTime.Format(new DateTimeOffset(now.Date.AddDays(1).AddHours(9)), now));

        var presets = ChatScheduleTime.Presets(new DateTimeOffset(now));
        Assert.Equal(["hour", "tomorrow", "monday"], presets.Select(p => p.Key).ToArray());
        Assert.Equal(now.AddHours(1), presets[0].When.LocalDateTime);
        Assert.Equal(now.Date.AddDays(1).AddHours(9), presets[1].When.LocalDateTime);
        Assert.Equal(DayOfWeek.Monday, presets[2].When.DayOfWeek);

        Assert.Equal("Укажите дату и время", ChatScheduleTime.Validate(null, new DateTimeOffset(now)));
        Assert.Equal("Время должно быть в будущем",
            ChatScheduleTime.Validate(new DateTimeOffset(now.AddSeconds(30)), new DateTimeOffset(now)));
        Assert.Equal("Не дальше, чем на год",
            ChatScheduleTime.Validate(new DateTimeOffset(now.AddDays(366)), new DateTimeOffset(now)));
        Assert.Equal(string.Empty,
            ChatScheduleTime.Validate(new DateTimeOffset(now.AddHours(2)), new DateTimeOffset(now)));
    }

    // ---- Хелперы ----

    // ---- Папки диалогов (вкладки + CRUD + членство) ----

    [Fact]
    public async Task FolderTabsStartWithSystemTabsAndLoadAppendsCustom()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatFolders = new HubChatFolderList
            {
                Items = [new HubChatFolder { Id = "f1", Name = "Работа", SortOrder = 0 }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        // «Все» — виртуальная вкладка tg-main — всегда первая; за ней системные.
        Assert.Equal(["all", "personal", "groups", "tasks"], model.FolderTabs.Select(t => t.Key).ToArray());
        Assert.True(model.FolderTabs[0].IsSystem);
        Assert.Equal("💬", model.FolderTabs[0].IconText);

        await model.LoadAsync();
        await WaitFor(() => api.ChatFoldersCallCount > 0);
        await WaitFor(() => model.FolderTabs.Count == 5);

        Assert.Equal("f1", model.FolderTabs[4].Key);
        Assert.Equal("Работа", model.FolderTabs[4].Title);
        Assert.True(model.FolderTabs[4].FolderId is not null);
    }

    [Fact]
    public async Task SystemFolderTabsFilterConversationsByKind()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("d1", lastAt: now, kind: "direct"),
                    Conv("g1", lastAt: now.AddSeconds(-1), kind: "group"),
                    Conv("t1", lastAt: now.AddSeconds(-2), kind: "task"),
                    Conv("a1", lastAt: now.AddSeconds(-3), kind: "ai"),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        // Вкладка по умолчанию — «Все»: все не-архивные диалоги без фильтра kind.
        Assert.Equal(["d1", "g1", "t1", "a1"], model.Conversations.Select(c => c.Id).ToArray());

        model.ActiveFolderKey = "personal";
        Assert.Equal(["d1", "a1"], model.Conversations.Select(c => c.Id).ToArray());

        model.ActiveFolderKey = "groups";
        Assert.Equal(["g1"], model.Conversations.Select(c => c.Id).ToArray());

        model.ActiveFolderKey = "tasks";
        Assert.Equal(["t1"], model.Conversations.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task AllFolderTabShowsEveryKindAndSkipsArchived()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("d1", lastAt: now, kind: "direct", unread: 2),
                    Conv("g1", lastAt: now.AddSeconds(-1), kind: "group", unread: 3),
                    Conv("t1", lastAt: now.AddSeconds(-2), kind: "task", unread: 5),
                    Conv("x1", lastAt: now.AddSeconds(-3), kind: "direct", unread: 7)
                        with { IsArchived = true },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        // «Все»: direct+group+task видны вместе, архивный исключён из вида и бейджа.
        Assert.Equal("all", model.ActiveFolderKey);
        Assert.Equal(["d1", "g1", "t1"], model.Conversations.Select(c => c.Id).ToArray());
        var allTab = model.FolderTabs[0];
        Assert.Equal("all", allTab.Key);
        Assert.Equal("Все", allTab.Title);
        Assert.Equal(10, allTab.UnreadCount);

        // Архив — отдельный вид: там только x1, «Все» после возврата его не ловит.
        model.ToggleArchivedViewCommand.Execute(null);
        Assert.True(model.ShowArchived);
        Assert.Equal(["x1"], model.Conversations.Select(c => c.Id).ToArray());
        model.ToggleArchivedViewCommand.Execute(null);
        Assert.Equal(["d1", "g1", "t1"], model.Conversations.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task CustomFolderTabFiltersByMembership()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatFolders = new HubChatFolderList
            {
                Items =
                [
                    new HubChatFolder
                    {
                        Id = "f1",
                        Name = "Работа",
                        ConversationIds = ["c1"],
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.FolderTabs.Count == 5);

        model.ActiveFolderKey = "f1";

        Assert.Equal(["c1"], model.Conversations.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task FolderUnreadBadgePrefersServerCounts()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1", unread: 5), Conv("c2", unread: 3)],
            },
            ChatFolders = new HubChatFolderList
            {
                Items = [new HubChatFolder { Id = "f1", Name = "Работа", ConversationIds = ["c1", "c2"] }],
                FolderUnreadCounts = new Dictionary<string, int> { ["f1"] = 9 },
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.FolderTabs.Count == 5);

        Assert.Equal(9, model.FolderTabs[4].UnreadCount);
        Assert.Equal("9", model.FolderTabs[4].UnreadBadgeText);
    }

    [Fact]
    public async Task FolderManagerCreatesRenamesAndDeletesFolder()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        model.ToggleFolderManagerCommand.Execute(null);
        Assert.True(model.IsFolderManagerOpen);

        model.NewFolderName = "Проекты";
        await ((NativeAsyncCommand)model.CreateFolderCommand).ExecuteAsync(null);
        Assert.Equal(["Проекты"], api.ChatFolderCreateNames);
        var tab = Assert.Single(model.CustomFolderTabs);
        Assert.Equal("Проекты", tab.Title);
        Assert.Equal(string.Empty, model.NewFolderName);

        model.BeginFolderRenameCommand.Execute(tab);
        Assert.Same(tab, model.RenamingFolder);
        model.RenamingFolderName = "Проекты 2026";
        await ((NativeAsyncCommand)model.SaveFolderRenameCommand).ExecuteAsync(null);
        Assert.Equal((tab.FolderId, "Проекты 2026", (int?)null), api.ChatFolderUpdateCalls.Single());
        Assert.Equal("Проекты 2026", tab.Title);
        Assert.Null(model.RenamingFolder);

        await ((NativeAsyncCommand)model.DeleteFolderCommand).ExecuteAsync(tab);
        Assert.Equal([tab.FolderId], api.ChatFolderDeleteCalls);
        Assert.Empty(model.CustomFolderTabs);
        // Остаются только системные вкладки («Все» + Личные/Беседы/Задачи).
        Assert.Equal(4, model.FolderTabs.Count);
    }

    [Fact]
    public async Task DeletingActiveFolderFallsBackToPersonalTab()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatFolders = new HubChatFolderList
            {
                Items = [new HubChatFolder { Id = "f1", Name = "Работа" }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.FolderTabs.Count == 5);
        model.ActiveFolderKey = "f1";
        model.ToggleFolderManagerCommand.Execute(null);

        await ((NativeAsyncCommand)model.DeleteFolderCommand)
            .ExecuteAsync(model.CustomFolderTabs[0]);

        Assert.Equal("personal", model.ActiveFolderKey);
        Assert.Equal(["c1"], model.Conversations.Select(c => c.Id).ToArray());
    }

    [Fact]
    public async Task ConversationFolderMenuTogglesMembership()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatFolders = new HubChatFolderList
            {
                Items = [new HubChatFolder { Id = "f1", Name = "Работа" }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        // Фоновый GET папок обгоняет список диалогов: подменю «В папку»
        // собирается повторной загрузкой, когда диалоги уже в _allConversations.
        await model.LoadAsync();
        await WaitFor(() => model.FolderTabs.Count == 5);

        var conversation = model.Conversations[0];
        var menuItem = Assert.Single(conversation.FolderMenuItems);
        Assert.False(menuItem.IsIncluded);

        await ((NativeAsyncCommand)menuItem.ToggleCommand).ExecuteAsync(null);
        Assert.Equal(("f1", "c1"), api.ChatFolderAddCalls.Single());
        // Ответ мутации — свежая карта членства: подменю пересобрано, галочка встала.
        await WaitFor(() => conversation.FolderMenuItems.Single().IsIncluded);

        await ((NativeAsyncCommand)conversation.FolderMenuItems.Single().ToggleCommand)
            .ExecuteAsync(null);
        Assert.Equal(("f1", "c1"), api.ChatFolderRemoveCalls.Single());
    }

    [Fact]
    public async Task FolderMembershipPanelReplacesConversationIds()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatFolders = new HubChatFolderList
            {
                Items = [new HubChatFolder { Id = "f1", Name = "Работа" }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        await WaitFor(() => model.FolderTabs.Count == 5);

        var tab = model.CustomFolderTabs[0];
        model.OpenFolderMembershipCommand.Execute(tab);
        Assert.True(model.IsFolderMembershipOpen);
        Assert.Equal(2, model.FolderMembershipItems.Count);
        Assert.DoesNotContain(model.FolderMembershipItems, item => item.IsIncluded);

        model.FolderMembershipItems[0].IsIncluded = true;
        await ((NativeAsyncCommand)model.SaveFolderMembershipCommand).ExecuteAsync(null);

        var (folderId, ids) = Assert.Single(api.ChatFolderReplaceCalls);
        Assert.Equal("f1", folderId);
        Assert.Equal([model.FolderMembershipItems[0].ConversationId], ids);
        Assert.False(model.IsFolderMembershipOpen);
    }

    // ---- Стикеры ----

    [Fact]
    public async Task StickerPanelLoadsPacksAndSendsSticker()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatStickerPacks = new HubChatStickerPackList
            {
                Items =
                [
                    new HubChatStickerPack
                    {
                        Id = "pack1",
                        Title = "Базовый",
                        Stickers = [new HubChatSticker { Id = "s1", Emoji = "😺" }],
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        await ((NativeAsyncCommand)model.ToggleStickerPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsStickerPanelOpen);
        var pack = Assert.Single(model.StickerPacks);
        Assert.Same(pack, model.SelectedStickerPack);
        var sticker = Assert.Single(pack.Stickers);

        await ((NativeAsyncCommand)sticker.SendCommand).ExecuteAsync(null);

        var (conversationId, stickerId, clientMessageId, replyTo) =
            Assert.Single(api.ChatStickerSendCalls);
        Assert.Equal("c1", conversationId);
        Assert.Equal("s1", stickerId);
        Assert.False(string.IsNullOrEmpty(clientMessageId));
        Assert.Null(replyTo);
        // Возвращённое сервером сообщение-стикер вставлено в ленту.
        Assert.Contains(model.Messages, m => m.Id == "sticker-msg-1");
    }

    [Fact]
    public async Task StickerSendWhileConversationChangesDoesNotTouchOtherThread()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("c1"), Conv("c2")],
            },
            ChatStickerPacks = new HubChatStickerPackList
            {
                Items =
                [
                    new HubChatStickerPack
                    {
                        Id = "pack1",
                        Stickers = [new HubChatSticker { Id = "s1" }],
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => !model.IsLoadingMessages);
        var c2 = model.Conversations.First(c => c.Id == "c2");

        await ((NativeAsyncCommand)model.ToggleStickerPanelCommand).ExecuteAsync(null);
        var sticker = model.SelectedStickerPack!.Stickers[0];

        // Переключаемся ДО ответа сервера: сообщение не должно вставиться в чужую ленту.
        var sendTask = ((NativeAsyncCommand)sticker.SendCommand).ExecuteAsync(null);
        model.SelectedConversation = c2;
        await sendTask;
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.DoesNotContain(model.Messages, m => m.Id == "sticker-msg-1");
    }

    // ---- ИИ-ассистент и action_card ----

    [Fact]
    public async Task AiPanelLoadsBotsAndOpensConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatAiBots = new HubChatAiBotList
            {
                Items = [new HubChatAiBot { Id = "bot1", Title = "Аналитик" }],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ToggleAiPanelCommand).ExecuteAsync(null);

        Assert.True(model.IsAiPanelOpen);
        var bot = Assert.Single(model.AiBots);
        Assert.Equal("Аналитик", bot.Title);
        Assert.Equal("Начать чат", bot.OpenText);

        await ((NativeAsyncCommand)bot.OpenCommand).ExecuteAsync(null);

        Assert.Equal(["bot1"], api.ChatAiOpenCalls);
        Assert.False(model.IsAiPanelOpen);
        var selected = model.SelectedConversation;
        Assert.NotNull(selected);
        Assert.Equal("ai", selected!.Kind);
        Assert.True(model.IsAiConversation);
        // AI-диалог виден и во «Все» — вкладка не сбрасывается на «Личные».
        Assert.Equal("all", model.ActiveFolderKey);
    }

    [Fact]
    public async Task AiStatusBarStopsAndRetriesRun()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("ai1", kind: "ai", title: "Ассистент")],
            },
            ChatAiStatus = new HubChatAiStatus { ConversationId = "ai1", Status = "running" },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];

        await WaitFor(() => api.ChatAiStatusCalls.Count > 0);
        await WaitFor(() => model.CanStopAiRun);
        Assert.True(model.HasAiStatus);
        Assert.Contains("отвечает", model.AiStatusText);

        // stop → cancelled: кнопка меняется на «Повторить».
        api.ChatAiStatus = new HubChatAiStatus { ConversationId = "ai1", Status = "cancelled" };
        await ((NativeAsyncCommand)model.StopAiRunCommand).ExecuteAsync(null);
        Assert.Equal(["ai1"], api.ChatAiStopCalls);
        Assert.True(model.CanRetryAiRun);
        Assert.False(model.CanStopAiRun);

        // retry → queued: возобновляется поллинг статуса.
        api.ChatAiStatus = new HubChatAiStatus { ConversationId = "ai1", Status = "queued" };
        await ((NativeAsyncCommand)model.RetryAiRunCommand).ExecuteAsync(null);
        Assert.Equal(["ai1"], api.ChatAiRetryCalls);
        await WaitFor(() => model.CanStopAiRun);
    }

    [Fact]
    public async Task AiResetContextPostsToApi()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [Conv("ai1", kind: "ai", title: "Ассистент")],
            },
            ChatAiStatus = new HubChatAiStatus { ConversationId = "ai1", Status = "completed" },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => api.ChatAiStatusCalls.Count > 0);

        await ((NativeAsyncCommand)model.ResetAiContextCommand).ExecuteAsync(null);

        Assert.Equal(["ai1"], api.ChatAiResetCalls);
    }

    [Fact]
    public async Task ActionCardHydratesIntoMessageAndConfirmCallsApi()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("ai1", kind: "ai")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "ai1", "Подтвердите импорт", DateTimeOffset.UtcNow) with
                    {
                        ActionCard = new HubChatActionCard
                        {
                            Id = "act1",
                            ActionType = "import_equipment",
                            Status = "pending",
                            Preview = JsonSerializer.Deserialize<JsonElement>(
                                "{\"title\":\"Импорт оборудования\",\"choices\":[{\"id\":\"ch1\",\"label\":\"Все\"}],\"formats\":[{\"id\":\"csv\",\"label\":\"CSV\"}]}"),
                            DatabaseId = "db-1",
                        },
                    },
                ],
            },
            ChatAiConfirmResult = new HubChatActionCard
            {
                Id = "act1",
                Status = "confirmed",
                ResultUrl = "https://hub.local/import/result",
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        var card = model.Messages[0].ActionCard;
        Assert.NotNull(card);
        Assert.True(card!.IsActionable);
        Assert.Equal("Импорт оборудования", card.Title);
        Assert.Equal("ch1", card.SelectedChoice?.Id);
        Assert.Equal("csv", card.SelectedFormat?.Id);

        card.ConfirmCommand.Execute(null);
        await WaitFor(() => api.ChatAiConfirmCalls.Count == 1);

        var (actionId, choice, format, scope) = api.ChatAiConfirmCalls[0];
        Assert.Equal("act1", actionId);
        Assert.Equal("ch1", choice);
        Assert.Equal("csv", format);
        Assert.Equal("db-1", scope);
        // Ответ API — терминальный статус карточки + ссылка на результат.
        await WaitFor(() => card.StatusText == "Подтверждено");
        Assert.False(card.IsActionable);
        Assert.True(card.HasResultUrl);
    }

    [Fact]
    public async Task ActionCardCancelCallsApiAndMarksCancelled()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("ai1", kind: "ai")] },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Msg("m1", "ai1", "Подтвердите", DateTimeOffset.UtcNow) with
                    {
                        ActionCard = new HubChatActionCard { Id = "act9", Status = "pending" },
                    },
                ],
            },
            ChatAiCancelResult = new HubChatActionCard { Id = "act9", Status = "cancelled" },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);
        var card = model.Messages[0].ActionCard!;

        card.CancelCommand.Execute(null);

        await WaitFor(() => api.ChatAiCancelCalls.Count == 1);
        Assert.Equal("act9", api.ChatAiCancelCalls[0]);
        await WaitFor(() => card.StatusText == "Отменено");
        Assert.False(card.IsActionable);
    }

    [Fact]
    public async Task ActionCardArrivesViaHydratePatch()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("ai1", kind: "ai")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "ai1", "ожидает карточку", DateTimeOffset.UtcNow)],
            },
            HydrateResult = new HubChatThreadHydrateResult
            {
                Items =
                [
                    new HubChatThreadHydrateItem
                    {
                        MessageId = "m1",
                        ActionCard = new HubChatActionCard
                        {
                            Id = "act2",
                            Status = "pending",
                        },
                    },
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1);

        await WaitFor(() => api.HydrateCalls.Count == 1);
        await WaitFor(() => model.Messages[0].HasActionCard);

        Assert.Equal("act2", model.Messages[0].ActionCard!.Id);
    }

    // ---- @mention-автокомплит (parity web ChatComposer getComposerMentionTrigger) ----

    [Fact]
    public void ParseMentionTriggerMatchesWebRules()
    {
        // '@' в начале строки или после пробела; запрос — непробельный до каретки.
        Assert.Equal((0, 1, ""), ChatViewModel.ParseMentionTrigger("@", 1)!.Value);
        Assert.Equal((7, 10, "ив"), ChatViewModel.ParseMentionTrigger("привет @ив", 10)!.Value);
        Assert.Equal((0, 3, "ив"), ChatViewModel.ParseMentionTrigger("@ив", 3)!.Value);

        // @ после непробела, пробел внутри запроса, отсутствие @, каретка до @.
        Assert.Null(ChatViewModel.ParseMentionTrigger("mail@x.ru", 9));
        Assert.Null(ChatViewModel.ParseMentionTrigger("@ив ан", 6));
        Assert.Null(ChatViewModel.ParseMentionTrigger("без меншна", 5));
        Assert.Null(ChatViewModel.ParseMentionTrigger("@ив", 0));
        Assert.Null(ChatViewModel.ParseMentionTrigger(null, 0));
    }

    [Fact]
    public void MentionHandlePrefersUsernameAndDerivesFromName()
    {
        Assert.Equal("ivan", ChatViewModel.MentionHandle("ivan", "Иван Иванов"));
        Assert.Equal("ivan", ChatViewModel.MentionHandle("@ivan", null));
        Assert.Equal("Иван_Иванов", ChatViewModel.MentionHandle(null, "Иван Иванов"));
        Assert.Equal("Anna_Maria", ChatViewModel.MentionHandle(null, "  Anna   Maria "));
        Assert.Equal(string.Empty, ChatViewModel.MentionHandle(null, null));
        Assert.Equal(string.Empty, ChatViewModel.MentionHandle(null, "  "));
    }

    [Fact]
    public void MentionMatchesUsesHandleAndDisplayNameLikeWeb()
    {
        Assert.True(ChatViewModel.MentionMatches("", "ivan", "Иван Иванов"));
        Assert.True(ChatViewModel.MentionMatches("iva", "ivan", "Иван Иванов"));
        Assert.True(ChatViewModel.MentionMatches("ИВАН", "ivan", "Иван Иванов"));
        Assert.True(ChatViewModel.MentionMatches("@pet", "petrov", "Пётр"));
        Assert.False(ChatViewModel.MentionMatches("пётр", "ivan", "Иван Иванов"));
    }

    [Fact]
    public async Task MentionPopupOpensInGroupFiltersAndInserts()
    {
        var api = MembersApiFixture("member");
        api.ConversationDetailResult = api.ConversationDetailResult! with
        {
            Members =
            [
                new HubChatMember
                {
                    User = new HubChatUser { Id = 7, FullName = "Я" },
                    MemberRole = "member",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 42, Username = "ivan", FullName = "Иван Иванов" },
                    MemberRole = "member",
                },
                new HubChatMember
                {
                    User = new HubChatUser { Id = 43, Username = "anna", FullName = "Анна Петрова" },
                    MemberRole = "moderator",
                },
            ],
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.ComposerText = "@";
        model.UpdateMentionTrigger(model.ComposerText, model.ComposerText.Length);

        await WaitFor(() => model.MentionSuggestions.Count == 2);
        Assert.True(model.IsMentionPopupOpen);
        // Себя нет в кандидатах — как currentUserId в web mentionCandidates.
        Assert.DoesNotContain(model.MentionSuggestions, m => m.UserId == 7);
        Assert.Equal("ivan", model.MentionSuggestions[0].Username);
        Assert.Equal("anna", model.MentionSuggestions[1].Username);
        Assert.Same(model.MentionSuggestions[0], model.SelectedMentionSuggestion);

        // ↓ — циклический выбор кандидата (web activeMentionIndex).
        model.MoveMentionSelection(1);
        Assert.Equal("anna", model.SelectedMentionSuggestion?.Username);
        model.MoveMentionSelection(1);
        Assert.Equal("ivan", model.SelectedMentionSuggestion?.Username);

        // Фильтр по запросу: haystack «handle имя» без учёта регистра.
        model.ComposerText = "@анн";
        model.UpdateMentionTrigger(model.ComposerText, model.ComposerText.Length);
        Assert.Equal("anna", Assert.Single(model.MentionSuggestions).Username);

        // Вставка «@handle » вместо триггера; каретка за вставкой.
        var caret = -1;
        model.RequestComposerCaret = index => caret = index;
        model.InsertMention(model.MentionSuggestions[0]);
        Assert.Equal("@anna ", model.ComposerText);
        Assert.Equal(6, caret);
        Assert.False(model.IsMentionPopupOpen);
        Assert.Empty(model.MentionSuggestions);
    }

    [Fact]
    public async Task MentionPopupIgnoresDirectChatAndClosesOnSwitch()
    {
        var api = MembersApiFixture("member");
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await api.RestoreSessionAsync(CancellationToken.None);
        await model.LoadAsync();
        model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        var group = model.Conversations[0];

        model.SelectedConversation = null;
        model.SelectedConversation = group;
        await WaitFor(() => !model.IsLoadingMessages);

        model.ComposerText = "@";
        model.UpdateMentionTrigger(model.ComposerText, model.ComposerText.Length);
        await WaitFor(() => model.MentionSuggestions.Count == 2);
        Assert.True(model.IsMentionPopupOpen);
        var detailCalls = api.ConversationDetailCalls.Count;

        // Снятие выбора — диалог закрыт, попап гаснет.
        model.SelectedConversation = null;
        Assert.False(model.IsMentionPopupOpen);

        // Direct-диалог: меншн выключен, запрос участников не уходит (web тоже
        // не открывает список — кандидатов нет).
        var direct = new ConversationItemViewModel(new HubChatConversation
        {
            Id = "d1",
            Kind = "direct",
            Title = "Direct",
        });
        Assert.False(direct.IsGroupLike);
        model.ComposerText = "@ivan";
        model.SelectedConversation = direct;
        model.UpdateMentionTrigger(model.ComposerText, model.ComposerText.Length);
        Assert.False(model.IsMentionPopupOpen);
        Assert.Equal(detailCalls, api.ConversationDetailCalls.Count);
    }

    // ---- Порядок диалогов: закреплённые первыми ----

    [Fact]
    public async Task PinnedConversationsStayFirstAmongThemselvesByDate()
    {
        var now = DateTimeOffset.UtcNow;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conv("c1", lastAt: now),
                    Conv("p2", lastAt: now.AddDays(-10), pinned: true),
                    Conv("c2", lastAt: now.AddHours(-2)),
                    Conv("p1", lastAt: now.AddDays(-3), pinned: true),
                ],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();

        // Закреплённые — строго раньше обычных и между собой по дате.
        Assert.Equal(["p1", "p2", "c1", "c2"],
            model.Conversations.Select(c => c.Id).ToArray());
    }

    // ---- UI-003: ошибка загрузки истории и повтор ----

    [Fact]
    public async Task HistoryTransportErrorShowsErrorStateNotEmptyClaim()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessagesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages && model.HasHistoryError);

        Assert.True(model.HasHistoryError);
        Assert.False(model.IsMessagesEmpty);
        Assert.NotNull(model.HistoryErrorText);
        Assert.True(model.HasBannerError);
        Assert.Empty(model.Messages);
    }

    [Fact]
    public async Task BannerRetryReloadsHistoryOfCurrentConversation()
    {
        var calls = 0;
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessagesFactory = before =>
            {
                calls++;
                return new HubChatMessageList
                {
                    Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow)],
                };
            },
            ChatMessagesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.HasHistoryError);

        api.ChatMessagesException = null;
        model.RetryCommand.Execute(null);
        await WaitFor(() => !model.HasHistoryError && model.Messages.Count == 1);

        // Фабрика вызывается только успешными запросами: 1 — повтор истории.
        Assert.Equal(1, calls);
        Assert.Equal("c1", api.LastMessagesConversationId);
        Assert.False(model.IsMessagesEmpty);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task RetryHistoryCommandReloadsAndClearsError()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow)],
            },
            ChatMessagesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.HasHistoryError);

        api.ChatMessagesException = null;
        model.RetryHistoryCommand.Execute(null);
        await WaitFor(() => !model.HasHistoryError && model.Messages.Count == 1);

        Assert.Single(model.Messages);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task SecondHistoryFailureKeepsErrorAndRetryAvailable()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessagesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.HasHistoryError);

        model.RetryHistoryCommand.Execute(null);
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.True(model.HasHistoryError);
        Assert.False(model.IsMessagesEmpty);
        Assert.True(model.RetryHistoryCommand.CanExecute(null));
    }

    [Fact]
    public async Task SwitchingConversationClearsStaleHistoryError()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
        };
        api.ChatMessagesFactory = before =>
            api.LastMessagesConversationId == "c1"
                ? throw new HubApiException(HubApiErrorKind.Transport, "down")
                : new HubChatMessageList
                {
                    Items = [Msg("m2", "c2", "есть", DateTimeOffset.UtcNow)],
                };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.HasHistoryError);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.False(model.HasHistoryError);
        Assert.Single(model.Messages);
        Assert.Equal("c2", model.SelectedConversation.Id);
    }

    [Fact]
    public async Task LateRetryResponseDoesNotOverwriteNewConversation()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1"), Conv("c2")] },
            ChatMessagesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var c1Gate = new TaskCompletionSource<HubChatMessageList>(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations.First(c => c.Id == "c1");
        await WaitFor(() => model.HasHistoryError);

        // Повтор истории завис в полёте; пользователь в это время ушёл в c2.
        api.ChatMessagesException = null;
        api.ChatMessagesAsyncFactory = (id, _) =>
            id == "c1"
                ? c1Gate.Task
                : Task.FromResult(new HubChatMessageList
                {
                    Items = [Msg("m2", "c2", "есть", DateTimeOffset.UtcNow)],
                });
        model.RetryHistoryCommand.Execute(null);
        await WaitFor(() => api.LastMessagesConversationId == "c1" && model.IsLoadingMessages);

        model.SelectedConversation = model.Conversations.First(c => c.Id == "c2");
        await WaitFor(() => !model.IsLoadingMessages && model.Messages.Count == 1);

        c1Gate.SetResult(new HubChatMessageList
        {
            Items = [Msg("m1", "c1", "запоздалое", DateTimeOffset.UtcNow.AddMinutes(-1))],
        });
        await Task.Delay(100);

        Assert.Equal("c2", model.SelectedConversation.Id);
        Assert.Single(model.Messages);
        Assert.Equal("m2", model.Messages[0].Id);
        Assert.False(model.HasHistoryError);
    }

    // ---- UI-004: фокус и Esc в оверлеях чата ----

    private static System.Windows.Window ShowOffscreenView(System.Windows.FrameworkElement view)
    {
        var window = new System.Windows.Window
        {
            Content = view,
            ShowInTaskbar = false,
            WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
            Left = -30000,
            Top = -30000,
        };
        window.Show();
        window.UpdateLayout();
        return window;
    }

    private static void RaiseKey(System.Windows.UIElement target, System.Windows.Input.Key key)
    {
        var source = System.Windows.PresentationSource.FromVisual(target);
        target.RaiseEvent(new System.Windows.Input.KeyEventArgs(
            System.Windows.Input.Keyboard.PrimaryDevice,
            source,
            0,
            key)
        {
            RoutedEvent = System.Windows.UIElement.PreviewKeyDownEvent,
        });
    }

    [Fact]
    public void DeleteConfirmFocusesCancelAndTrapsTabInsideDialog()
    {
        RunOnSta(() =>
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList
                {
                    Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow, own: true)],
                },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            Pump(model.LoadAsync());
            model.SelectedConversation = model.Conversations[0];
            PumpUntil(() => model.Messages.Count == 1, TimeSpan.FromSeconds(5));

            var view = new Native.Views.ChatView { DataContext = model };
            var window = ShowOffscreenView(view);
            try
            {
                Pump(((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(model.Messages[0]));
                Assert.True(model.IsDeleteConfirmOpen);

                var cancel = (System.Windows.Controls.Button)view.FindName("DeleteCancelButton");
                PumpUntil(
                    () => ReferenceEquals(System.Windows.Input.Keyboard.FocusedElement, cancel),
                    TimeSpan.FromSeconds(5));
                Assert.True(ReferenceEquals(System.Windows.Input.Keyboard.FocusedElement, cancel));

                // Ловушка фокуса: у диалога TabNavigation=Cycle — Tab/Shift+Tab
                // не выводят фокус в фон под модалом.
                var trapFound = false;
                for (var parent = System.Windows.Media.VisualTreeHelper.GetParent(cancel);
                     parent is not null;
                     parent = System.Windows.Media.VisualTreeHelper.GetParent(parent))
                {
                    if (parent is System.Windows.Controls.Border border
                        && System.Windows.Input.KeyboardNavigation.GetTabNavigation(border)
                            == System.Windows.Input.KeyboardNavigationMode.Cycle)
                    {
                        trapFound = true;
                        break;
                    }
                }

                Assert.True(trapFound);

                // Enter в начальном состоянии (фокус на «Отмена») не удаляет.
                RaiseKey(cancel, System.Windows.Input.Key.Enter);
                Assert.Empty(api.DeletedMessages);
            }
            finally
            {
                window.Close();
            }
        });
    }

    [Fact]
    public void DeleteConfirmEscapeCancelsAndRestoresComposerFocus()
    {
        RunOnSta(() =>
        {
            var api = new FakeHubApiClient
            {
                ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
                ChatMessages = new HubChatMessageList
                {
                    Items = [Msg("m1", "c1", "текст", DateTimeOffset.UtcNow, own: true)],
                },
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            Pump(model.LoadAsync());
            model.SelectedConversation = model.Conversations[0];
            PumpUntil(() => model.Messages.Count == 1, TimeSpan.FromSeconds(5));

            var view = new Native.Views.ChatView { DataContext = model };
            var window = ShowOffscreenView(view);
            try
            {
                var composer = (System.Windows.Controls.TextBox)view.FindName("ComposerInput");
                Assert.True(composer.Focus());

                Pump(((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(model.Messages[0]));
                var cancel = (System.Windows.Controls.Button)view.FindName("DeleteCancelButton");
                PumpUntil(
                    () => ReferenceEquals(System.Windows.Input.Keyboard.FocusedElement, cancel),
                    TimeSpan.FromSeconds(5));

                RaiseKey(cancel, System.Windows.Input.Key.Escape);

                Assert.False(model.IsDeleteConfirmOpen);
                Assert.Empty(api.DeletedMessages);
                Assert.True(ReferenceEquals(System.Windows.Input.Keyboard.FocusedElement, composer));
            }
            finally
            {
                window.Close();
            }
        });
    }

    [Fact]
    public void EscapeClosesOnlyTopmostOverlay_GroupSettingsUnderDeleteConfirm()
    {
        RunOnSta(() =>
        {
            var api = MembersApiFixture("owner");
            api.ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "g1", "моё", DateTimeOffset.UtcNow, own: true)],
            };
            var model = new ChatViewModel(api, new FakeChatRealtime());
            Pump(api.RestoreSessionAsync(CancellationToken.None));
            Pump(model.LoadAsync());
            model.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
            model.SelectedConversation = model.Conversations[0];
            PumpUntil(() => !model.IsLoadingMessages && model.Messages.Count == 1, TimeSpan.FromSeconds(5));

            var view = new Native.Views.ChatView { DataContext = model };
            var window = ShowOffscreenView(view);
            try
            {
                var composer = (System.Windows.Controls.TextBox)view.FindName("ComposerInput");

                Pump(((NativeAsyncCommand)model.ToggleGroupSettingsCommand).ExecuteAsync(null));
                Assert.True(model.IsGroupSettingsOpen);

                // Модал поверх настроек: Esc обязан гасить верхний элемент.
                Pump(((NativeAsyncCommand)model.DeleteMessageCommand).ExecuteAsync(model.Messages[0]));
                Assert.True(model.IsDeleteConfirmOpen);
                Assert.True(model.IsGroupSettingsOpen);

                var cancel = (System.Windows.Controls.Button)view.FindName("DeleteCancelButton");
                RaiseKey(cancel, System.Windows.Input.Key.Escape);
                Assert.False(model.IsDeleteConfirmOpen);
                Assert.True(model.IsGroupSettingsOpen);

                RaiseKey(composer, System.Windows.Input.Key.Escape);
                Assert.False(model.IsGroupSettingsOpen);
            }
            finally
            {
                window.Close();
            }
        });
    }

    [Fact]
    public async Task RealEmptyHistoryShowsEmptyStateWithoutError()
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime());
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        Assert.True(model.IsMessagesEmpty);
        Assert.False(model.HasHistoryError);
        Assert.Null(model.HistoryErrorText);
    }

    private static HubChatMessage PollMsg(string id, string conversationId, bool own = false) =>
        new()
        {
            Id = id,
            ConversationId = conversationId,
            Kind = "poll",
            // Каноническое тело опроса — JSON; текстом показывать нельзя.
            Body = "{\"question\":\"Куда идём?\",\"options\":[\"Кино\",\"Кафе\"]}",
            CreatedAt = DateTimeOffset.UtcNow,
            IsOwn = own,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
            Poll = new HubChatPoll
            {
                Question = "Куда идём?",
                Options =
                [
                    new HubChatPollOption { Text = "Кино", Votes = 0 },
                    new HubChatPollOption { Text = "Кафе", Votes = 0 },
                ],
                TotalVoters = 0,
            },
        };

    private static HubChatConversation Conv(
        string id,
        DateTimeOffset? lastAt = null,
        bool pinned = false,
        int unread = 0,
        string kind = "direct",
        string? title = null) =>
        new()
        {
            Id = id,
            Kind = kind,
            Title = title ?? "Диалог " + id,
            LastMessageAt = lastAt ?? DateTimeOffset.UtcNow,
            LastMessagePreview = "preview-" + id,
            IsPinned = pinned,
            UnreadCount = unread,
            DirectPeer = kind == "direct"
                ? new HubChatUser { Id = 9, Username = "peer-" + id, FullName = "Пользователь " + id }
                : null,
        };

    private static HubChatMessage Msg(
        string id,
        string conversationId,
        string body,
        DateTimeOffset createdAt,
        bool own = false) =>
        new()
        {
            Id = id,
            ConversationId = conversationId,
            Kind = "text",
            Body = body,
            CreatedAt = createdAt,
            IsOwn = own,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
        };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(3);
        var elapsed = TimeSpan.Zero;
        var step = TimeSpan.FromMilliseconds(20);
        while (elapsed < limit)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(step);
            elapsed += step;
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }
}
