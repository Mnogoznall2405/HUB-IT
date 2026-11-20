using System.Text;
using System.Text.Json;
using System.Threading;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Страница «Почта»: bootstrap (папки+входящие), выбор папки, поиск и фильтры,
/// чтение детали с авто-прочтением, пагинация, read/unread, удаление, сброс.
/// </summary>
// Шелл-инициализация в одном из тестов грузит Settings → NativeThemeManager.Apply.
[Collection("NativeTheme")]
public sealed class NativeMailViewModelTests
{
    [Fact]
    public async Task LoadPopulatesFoldersItemsAndUnreadBadges()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие", unread: 2),
                    MakeFolder("sent", "Отправленные"),
                    MakeFolder("custom-1", "Проекты", unread: 1, wellKnown: null),
                ],
                unreadCount: 3,
                items:
                [
                    MakePreview("m1", subject: "Отчёт за неделю", isRead: false),
                    MakePreview("m2", subject: "Договор", isRead: true),
                ]),
        };
        var model = new MailViewModel(api);

        await model.LoadAsync();

        Assert.Equal(3, model.Folders.Count);
        Assert.Equal("inbox", model.Folders[0].Id);
        Assert.Equal("Входящие", model.Folders[0].Label);
        Assert.Equal("📥", model.Folders[0].IconGlyph);
        Assert.True(model.Folders[0].HasUnread);
        Assert.Equal("2", model.Folders[0].UnreadBadgeText);
        Assert.Equal("sent", model.Folders[1].Id);
        Assert.False(model.Folders[1].HasUnread);
        Assert.Equal("custom-1", model.Folders[2].Id);
        Assert.True(model.Folders[2].IsCustom);
        Assert.Equal("1", model.Folders[2].UnreadBadgeText);
        Assert.Equal(model.Folders[0], model.SelectedFolder);
        Assert.Equal("inbox", model.CurrentFolder);
        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Отчёт за неделю", model.Items[0].Subject);
        Assert.True(model.Items[0].IsUnread);
        Assert.False(model.Items[1].IsUnread);
        Assert.Equal(3, model.TotalUnreadCount);
        Assert.Equal("3", model.UnreadText);
        Assert.Equal("user@zsgp.ru", model.MailboxLabel);
        Assert.False(model.ShowSetupHint);
        Assert.False(model.HasBannerError);
        // Голова входящих переиспользуется из bootstrap: отдельного вызова /messages нет.
        Assert.Equal(0, api.MailMessagesCallCount);
    }

    [Fact]
    public async Task NonInboxFolderLoadsViaMessagesApi()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие"), MakeFolder("sent", "Отправленные")],
                items: [MakePreview("m1")]),
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("s1", subject: "Отправленное")],
                Folder = "sent",
                Total = 1,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("sent");

        Assert.Equal("sent", model.CurrentFolder);
        Assert.Equal("sent", api.LastMailQuery?.Folder);
        Assert.Equal("current", api.LastMailQuery?.FolderScope);
        var item = Assert.Single(model.Items);
        Assert.Equal("Отправленное", item.Subject);
    }

    [Fact]
    public async Task SearchTextAndUnreadFilterMapToQuery()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
        };
        var model = new MailViewModel(api) { SearchText = "  отчёт  " };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("unread");

        Assert.Equal("unread", model.Filter);
        Assert.True(model.UnreadOnly);
        Assert.Equal("отчёт", api.LastMailQuery?.Search);
        Assert.True(api.LastMailQuery?.UnreadOnly);
        Assert.Equal(0, api.LastMailQuery?.Offset);
        Assert.Equal(50, api.LastMailQuery?.Limit);
        Assert.Equal("mb-1", api.LastMailQuery?.MailboxId);
    }

    [Fact]
    public async Task SlowFolderResponseCannotReplaceNewerUnreadResults()
    {
        var delayed = new TaskCompletionSource<HubMailMessagePage>(TaskCreationOptions.RunContinuationsAsynchronously);
        var api = new FakeHubApiClient
        {
            MailMessagesPageAsyncFactory = query => query.UnreadOnly
                ? Task.FromResult(new HubMailMessagePage { Items = [MakePreview("unread", isRead: false)] })
                : delayed.Task,
        };
        var model = new MailViewModel(api);
        var loadFolder = ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("sent");

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("unread");
        delayed.SetResult(new HubMailMessagePage { Items = [MakePreview("stale")] });
        await loadFolder;

        Assert.True(model.UnreadOnly);
        Assert.Equal("unread", Assert.Single(model.Items).Id);
    }

    [Fact]
    public async Task SearchAcrossFoldersShowsPartialResultsWarningAndClearsItOnFullResponse()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие"), MakeFolder("trash", "Удалённые")], items: []),
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("old")],
                SearchLimited = true,
                SkippedFolders = 1,
            },
        };
        var model = new MailViewModel(api) { SearchText = "отчёт", SearchAllFolders = true };
        await model.LoadAsync();

        Assert.Equal("all", api.LastMailQuery?.FolderScope);
        Assert.Single(model.Items);
        Assert.Contains("Выдача неполная", model.SearchStatusText);
        Assert.Contains("Недоступные папки: 1", model.SearchStatusText);

        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("trash");
        Assert.Single(model.Items).IsChecked = true;
        Assert.False(model.BulkDeletePermanentCommand.CanExecute(null));
        Assert.False(model.BulkDeleteCommand.CanExecute(null));

        api.MailMessagesPage = new HubMailMessagePage();
        model.SearchAllFolders = false;
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);
        Assert.Equal("current", api.LastMailQuery?.FolderScope);
        Assert.Null(model.SearchStatusText);
    }

    [Fact]
    public async Task SelectingMessageLoadsDetailAndMarksRead()
    {
        var received = new DateTimeOffset(2026, 3, 2, 9, 15, 0, TimeSpan.FromHours(3));
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 2)],
                unreadCount: 2,
                items: [MakePreview("m1", isRead: false), MakePreview("m2", isRead: false)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Отчёт за неделю",
                SenderDisplay = "Иван Иванов",
                SenderEmail = "ivan@zsgp.ru",
                To = ["me@zsgp.ru"],
                Cc = ["boss@zsgp.ru"],
                ReceivedAt = received.ToString("O"),
                IsRead = true,
                BodyText = "Текст письма",
                Attachments = [new HubMailAttachment { Name = "report.pdf", Size = 10 }],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        await WaitFor(() => api.MailReadMarkedIds.Count > 0);

        Assert.Equal("m1", api.LastMailMessageId);
        Assert.Equal("m1", api.MailReadMarkedIds[0]);
        Assert.False(model.Items[0].IsUnread);
        Assert.False(model.Detail!.IsUnread);
        Assert.Equal(1, model.Folders[0].Unread);
        Assert.Equal(1, model.TotalUnreadCount);
        Assert.Equal("Отчёт за неделю", model.Detail.Subject);
        Assert.Equal("Иван Иванов", model.Detail.SenderText);
        Assert.Equal("ivan@zsgp.ru", model.Detail.SenderEmail);
        Assert.Equal("me@zsgp.ru", model.Detail.ToText);
        Assert.Equal("boss@zsgp.ru", model.Detail.CcText);
        Assert.Equal("Текст письма", model.Detail.Body);
        Assert.Equal("📎 1", model.Detail.AttachmentsText);
        Assert.Equal(received.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), model.Detail.DateText);
        Assert.True(model.HasDetail);
    }

    [Fact]
    public async Task DetailWithBodyHtmlExposesHtmlAndPlainFallback()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                BodyHtml = "<p>Привет, <b>коллеги</b>!</p><p>Вторая строка</p>",
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.True(model.Detail!.HasBodyHtml);
        Assert.True(model.Detail.HasAnyBody);
        Assert.Equal(
            "<p>Привет, <b>коллеги</b>!</p><p>Вторая строка</p>",
            model.Detail.BodyHtml);
        // Текстовый fallback — body_html грубо очищен до plain text
        // (показывается, если WebView2-ридер недоступен).
        Assert.Equal("Привет, коллеги !\nВторая строка", model.Detail.Body);
    }

    [Fact]
    public async Task DetailPrefersBodyTextForPlainBody()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                BodyText = "Готовый текст от backend",
                BodyHtml = "<p>Игнорируется в plain-ветке</p>",
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Html-путь всё равно активен: ридер возьмёт body_html,
        // а Body — готовый body_text (как раньше).
        Assert.True(model.Detail!.HasBodyHtml);
        Assert.Equal("Готовый текст от backend", model.Detail.Body);
    }

    [Fact]
    public async Task DetailWithoutBodyHtmlKeepsPlainBody()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                BodyText = "Обычный текст",
                BodyHtml = "   ",
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.False(model.Detail!.HasBodyHtml);
        Assert.True(model.Detail.HasAnyBody);
        Assert.Equal("Обычный текст", model.Detail.Body);
        Assert.Equal(string.Empty, model.Detail.BodyHtml);
    }

    [Fact]
    public async Task DetailWithoutAnyBodyHasNoContent()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.False(model.Detail!.HasBody);
        Assert.False(model.Detail.HasBodyHtml);
        Assert.False(model.Detail.HasAnyBody);
    }

    [Fact]
    public async Task SelectingReadMessageDoesNotCallReadApi()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Empty(api.MailReadMarkedIds);
        Assert.Empty(api.MailUnreadMarkedIds);
    }

    [Fact]
    public async Task LoadMoreAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1"), MakePreview("m2")],
                total: 3,
                hasMore: true,
                nextOffset: 2),
            MailMessagesPageFactory = query => new HubMailMessagePage
            {
                Items = [MakePreview("m3", subject: "Третье")],
                Total = 3,
                Offset = query.Offset,
                HasMore = false,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (1)", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal("m3", model.Items[2].Id);
        Assert.Equal(2, api.LastMailQuery?.Offset);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task LoadMoreSkipsItemsAlreadyShownWhenOffsetsShift()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1"), MakePreview("m2")],
                total: 3,
                hasMore: true,
                nextOffset: 2),
            MailMessagesPageFactory = query => new HubMailMessagePage
            {
                Items = [MakePreview("m2"), MakePreview("m3", subject: "Третье")],
                Total = 3,
                Offset = query.Offset,
                HasMore = false,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal(["m1", "m2", "m3"], model.Items.Select(item => item.Id).ToArray());
    }

    [Fact]
    public async Task ToggleReadMarksUnreadThenReadBack()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 1)],
                unreadCount: 1,
                items: [MakePreview("m1", isRead: false)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && api.MailReadMarkedIds.Count > 0);
        Assert.Equal(0, model.TotalUnreadCount);
        Assert.Equal(0, model.Folders[0].Unread);

        // Прочитанное → непрочитанное.
        await ((NativeAsyncCommand)model.ToggleReadCommand).ExecuteAsync(null);

        Assert.Equal("m1", api.MailUnreadMarkedIds[0]);
        Assert.True(model.Items[0].IsUnread);
        Assert.True(model.Detail!.IsUnread);
        Assert.Equal("Пометить прочитанным", model.Detail.ToggleReadButtonText);
        Assert.Equal(1, model.TotalUnreadCount);
        Assert.Equal(1, model.Folders[0].Unread);

        // Обратно в прочитанное.
        await ((NativeAsyncCommand)model.ToggleReadCommand).ExecuteAsync(null);

        Assert.Equal(2, api.MailReadMarkedIds.Count);
        Assert.False(model.Items[0].IsUnread);
        Assert.False(model.Detail!.IsUnread);
        Assert.Equal(0, model.TotalUnreadCount);
    }

    [Fact]
    public async Task DeleteRemovesItemAndClearsDetail()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 1)],
                unreadCount: 1,
                items: [MakePreview("m1", isRead: false), MakePreview("m2")],
                total: 2),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.DeleteCommand).ExecuteAsync(null);

        // Первый срез — только мягкое удаление (permanent=false).
        Assert.Equal(("m1", false), api.MailDeletedIds[0]);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m2", remaining.Id);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal("1", model.TotalText);
    }

    [Fact]
    public async Task BootstrapFailureSetsBannerError()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrapException = new HubApiException(
                HubApiErrorKind.Transport, "API request failed."),
        };
        var model = new MailViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Equal("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.", model.BannerErrorText);
        Assert.False(model.IsEmpty);
        Assert.Empty(model.Items);
    }

    [Fact]
    public async Task MessagesFailureSetsBannerError()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("sent", "Отправленные")]),
            MailMessagesException = new HubApiException(
                HubApiErrorKind.Http, "Exchange недоступен"),
        };
        var model = new MailViewModel(api);
        // Текущая папка станет sent (inbox в дереве нет) → список идёт через /messages.
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Equal("Exchange недоступен", model.BannerErrorText);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task DetailFailureShowsDetailError()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailMessageDetailException = new HubApiException(
                HubApiErrorKind.Http, "Письмо не найдено"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => !model.IsDetailLoading);

        Assert.True(model.HasDetailError);
        Assert.Equal("Письмо не найдено", model.DetailErrorText);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task MailboxNotConfiguredShowsSetupHint()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(configureMailbox: mailbox =>
            {
                mailbox.MailIsConfigured = false;
            }),
        };
        var model = new MailViewModel(api);

        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.Contains("не настроена", model.SetupHintText);
        Assert.Empty(model.Items);
        Assert.Empty(model.Folders);
        Assert.Equal(0, api.MailMessagesCallCount);
    }

    [Fact]
    public async Task MailboxRequiringPasswordShowsSetupHint()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(configureMailbox: mailbox =>
            {
                mailbox.MailRequiresPassword = true;
            }),
        };
        var model = new MailViewModel(api);

        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.Contains("пароль", model.SetupHintText);
        Assert.Equal(0, api.MailMessagesCallCount);
    }

    [Fact]
    public async Task MailboxRequiringReloginShowsSetupHint()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(configureMailbox: mailbox =>
            {
                mailbox.MailRequiresRelogin = true;
            }),
        };
        var model = new MailViewModel(api);

        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.Contains("войти", model.SetupHintText);
        Assert.Equal(0, api.MailMessagesCallCount);
    }

    [Fact]
    public async Task ResetClearsAllState()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 1)],
                unreadCount: 1,
                items: [MakePreview("m1")]),
            // Активный поиск отключает голову bootstrap: список идёт через /messages.
            MailMessagesPage = new HubMailMessagePage { Items = [MakePreview("m1")], Total = 1 },
            MailMessageDetail = new HubMailMessageDetail { Id = "m1" },
        };
        var model = new MailViewModel(api) { SearchText = "отчёт" };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        model.Reset();

        Assert.Empty(model.Folders);
        Assert.Null(model.SelectedFolder);
        Assert.Empty(model.Items);
        Assert.Null(model.SelectedItem);
        Assert.Null(model.Detail);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal("all", model.Filter);
        Assert.False(model.HasMore);
        Assert.Equal(0, model.TotalUnreadCount);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.False(model.ShowSetupHint);
        Assert.False(model.IsLoading);
        Assert.False(model.IsDetailLoading);
        // После сброса почта грузится заново, без унаследованного mailbox/folder.
        Assert.Equal("inbox", model.CurrentFolder);
    }

    [Fact]
    public async Task MailViewRendersAllStatesOnStaThread()
    {
        // Парсинг XAML, merge HubTheme и шаблоны папок/списка/детали инстанцируются
        // при показе — smoke-тест ловит битые ресурсы и стили.
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие", unread: 1),
                    MakeFolder("custom-1", "Проекты", wellKnown: null),
                ],
                unreadCount: 1,
                items: [MakePreview("m1", isRead: false)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Тема",
                SenderDisplay = "Иван Иванов",
                To = ["me@zsgp.ru"],
                BodyText = "Текст",
                IsRead = true,
                Attachments = [new HubMailAttachment { Name = "f.pdf" }],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var window = new System.Windows.Window
                {
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -10000,
                    Top = -10000,
                    Content = new Native.Views.MailView { DataContext = model },
                };
                window.Show();
                window.UpdateLayout();
                window.Close();
            }
            catch (Exception exception)
            {
                captured = exception;
            }
            finally
            {
                completed.Set();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(completed.Wait(TimeSpan.FromSeconds(15)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }

    [Fact]
    public async Task ShellNavigatesToMailPageAndRefreshesIt()
    {
        // Пункт «Почта» в шелле: NavigateToPageCommand + RefreshCurrentPageCommand.
        var api = new FakeHubApiClient
        {
            StoredSession = Session(),
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 2)],
                unreadCount: 2,
                items: [MakePreview("m1")]),
        };
        var shell = new HubShellViewModel(api);
        await shell.InitializeAsync();

        shell.NavigateToPageCommand.Execute("mail");

        Assert.True(shell.IsMailPage);
        Assert.Same(shell.Mail, shell.CurrentPage);
        Assert.True(shell.HasMailUnread);
        Assert.Equal("2", shell.MailUnreadBadgeText);

        var bootstrapCalls = api.MailBootstrapCallCount;
        shell.RefreshCurrentPageCommand.Execute(null);
        await WaitFor(() => api.MailBootstrapCallCount > bootstrapCalls);
    }

    // ---- Композер: отправка ----

    [Fact]
    public async Task NewMessageSendPassesContractFields()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.NewMessageCommand.Execute(null);
        var composer = Assert.IsType<MailComposeViewModel>(model.Composer);
        Assert.True(model.IsComposeOpen);
        Assert.Equal("Новое письмо", composer.Title);
        Assert.False(composer.CanSend);

        composer.To = "Петр <petr@zsgp.ru>; ivan@zsgp.ru";
        composer.Cc = "boss@zsgp.ru";
        composer.Subject = "Отчёт";
        composer.Body = "Текст письма";
        Assert.True(composer.CanSend);

        await ((NativeAsyncCommand)composer.SendCommand).ExecuteAsync(null);

        var request = Assert.Single(api.MailSentRequests);
        Assert.Equal("mb-1", request.FromMailboxId);
        Assert.Equal(["petr@zsgp.ru", "ivan@zsgp.ru"], request.To);
        Assert.Equal(["boss@zsgp.ru"], request.Cc);
        Assert.Equal("Отчёт", request.Subject);
        Assert.Equal("Текст письма", request.Body);
        Assert.False(request.IsHtml);
        Assert.Null(request.ReplyToMessageId);
        Assert.False(string.IsNullOrWhiteSpace(request.IdempotencyKey));
        // Без файлов — JSON /messages/send (attachments = null).
        Assert.Null(api.MailSentAttachments[0]);
        Assert.False(model.IsComposeOpen);
        Assert.Equal("Отправлено", model.StatusInfoText);
    }

    [Fact]
    public async Task SendWithoutRecipientShowsErrorInsideComposer()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;

        await composer.SendAsync(CancellationToken.None);

        Assert.True(composer.HasError);
        Assert.Contains("Кому", composer.ErrorText);
        Assert.Empty(api.MailSentRequests);
        Assert.True(model.IsComposeOpen);
    }

    [Fact]
    public async Task SendWithInvalidRecipientShowsError()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;
        composer.To = "не-адрес";

        await composer.SendAsync(CancellationToken.None);

        Assert.True(composer.HasError);
        Assert.Contains("не-адрес", composer.ErrorText);
        Assert.Empty(api.MailSentRequests);
    }

    [Fact]
    public async Task SendFailureKeepsDraftFieldsAndShowsError()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailSendException = new HubApiException(HubApiErrorKind.Http, "SMTP недоступен"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;
        composer.To = "petr@zsgp.ru";
        composer.Subject = "Важное";
        composer.Body = "Не потерять";

        await ((NativeAsyncCommand)composer.SendCommand).ExecuteAsync(null);

        Assert.True(model.IsComposeOpen);
        Assert.True(composer.HasError);
        Assert.Equal("SMTP недоступен", composer.ErrorText);
        // Черновик на месте: поля не стёрты, отправка не засчитана.
        Assert.Equal("petr@zsgp.ru", composer.To);
        Assert.Equal("Важное", composer.Subject);
        Assert.Equal("Не потерять", composer.Body);
        Assert.Null(model.StatusInfoText);
    }

    // ---- Композер: reply/forward префилл ----

    [Fact]
    public async Task ReplyPrefillUsesComposeContextAndPassesReplyId()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Отчёт",
                SenderEmail = "ivan@zsgp.ru",
                IsRead = true,
                BodyText = "Исходный текст",
                ComposeContext = new HubMailComposeContext
                {
                    MailboxId = "mb-1",
                    Reply = new HubMailComposeScenario
                    {
                        Subject = "Re: Отчёт",
                        To = ["ivan@zsgp.ru"],
                        QuoteHtml = "<div class=\"quoted-mail\"><br><br>" +
                                    "<div>От: Иван</div><blockquote>Исходный текст</blockquote></div>",
                    },
                },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        model.ReplyCommand.Execute(null);

        var composer = Assert.IsType<MailComposeViewModel>(model.Composer);
        Assert.Equal("Ответ", composer.Title);
        Assert.Equal("Re: Отчёт", composer.Subject);
        Assert.Equal("ivan@zsgp.ru", composer.To);
        // Цитата из quote_html приведена к plain text в теле.
        Assert.Contains("Исходный текст", composer.Body);
        Assert.Contains("От: Иван", composer.Body);

        await composer.SendAsync(CancellationToken.None);

        var request = Assert.Single(api.MailSentRequests);
        Assert.Equal("m1", request.ReplyToMessageId);
        Assert.Null(request.ForwardMessageId);
        Assert.Equal(["ivan@zsgp.ru"], request.To);
    }

    [Fact]
    public async Task ReplyAllPrefillAddsCcFromComposeContext()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Тема",
                IsRead = true,
                ComposeContext = new HubMailComposeContext
                {
                    ReplyAll = new HubMailComposeScenario
                    {
                        Subject = "Re: Тема",
                        To = ["ivan@zsgp.ru"],
                        Cc = ["boss@zsgp.ru", "team@zsgp.ru"],
                    },
                },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        model.ReplyAllCommand.Execute(null);

        var composer = model.Composer!;
        Assert.Equal("Ответ всем", composer.Title);
        Assert.Equal("ivan@zsgp.ru", composer.To);
        Assert.Equal("boss@zsgp.ru; team@zsgp.ru", composer.Cc);
    }

    [Fact]
    public async Task ForwardPrefillSetsForwardIdAndAttachmentsHint()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Договор",
                IsRead = true,
                Attachments =
                [
                    new HubMailAttachment
                    {
                        Id = "a1", Name = "doc.pdf", Size = 10,
                        Downloadable = true, DownloadToken = "tok-1",
                    },
                ],
                ComposeContext = new HubMailComposeContext
                {
                    Forward = new HubMailComposeScenario
                    {
                        Subject = "Fwd: Договор",
                        QuoteHtml = "<blockquote>Текст договора</blockquote>",
                    },
                },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        model.ForwardCommand.Execute(null);

        var composer = model.Composer!;
        Assert.Equal("Пересылка", composer.Title);
        Assert.Equal("Fwd: Договор", composer.Subject);
        Assert.Equal(string.Empty, composer.To);
        Assert.True(composer.HasRetainedAttachments);
        Assert.Contains("1", composer.RetainedAttachmentsText);

        composer.To = "new@zsgp.ru";
        await composer.SendAsync(CancellationToken.None);

        var request = Assert.Single(api.MailSentRequests);
        Assert.Equal("m1", request.ForwardMessageId);
        Assert.Null(request.ReplyToMessageId);
        // forward_attachment_refs не трогаем: сервер приложит все вложения исходного.
        Assert.Null(request.ForwardAttachmentRefs);
    }

    // ---- Композер: черновик ----

    [Fact]
    public async Task SaveDraftCallsUpsertAndShowsStatus()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;
        composer.To = "petr@zsgp.ru";
        composer.Subject = "Черновик";

        await composer.SaveDraftAsync(CancellationToken.None);

        var request = Assert.Single(api.MailDraftRequests);
        Assert.Equal("mb-1", request.FromMailboxId);
        Assert.Equal(["petr@zsgp.ru"], request.To);
        Assert.Equal("Черновик", request.Subject);
        Assert.Equal("new", request.ComposeMode);
        Assert.Equal("Черновик сохранён", model.StatusInfoText);
        // Панель остаётся открытой — можно продолжить редактирование.
        Assert.True(model.IsComposeOpen);
    }

    [Fact]
    public async Task DraftFromDetailPrefillsFieldsAndDraftId()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("d1")]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "d1",
                Subject = "Недописано",
                IsRead = true,
                To = ["petr@zsgp.ru"],
                BodyText = "Черновой текст",
                DraftContext = new HubMailDraftContext
                {
                    ComposeMode = "draft",
                    MailboxId = "mb-1",
                },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.True(model.Detail!.IsDraft);

        model.EditDraftCommand.Execute(null);

        var composer = model.Composer!;
        Assert.Equal("Черновик", composer.Title);
        Assert.Equal("petr@zsgp.ru", composer.To);
        Assert.Equal("Недописано", composer.Subject);
        Assert.Equal("Черновой текст", composer.Body);

        await composer.SendAsync(CancellationToken.None);
        var request = Assert.Single(api.MailSentRequests);
        Assert.Equal("d1", request.DraftId);
    }

    // ---- Композер: подсказки контактов ----

    [Fact]
    public async Task ContactSuggestionsLoadAfterDebounceWithTokenQuery()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailContacts =
            [
                new HubMailContact { Name = "Пётр Петров", Email = "petr@zsgp.ru" },
                new HubMailContact { Email = "team@zsgp.ru" },
                // Контакт без email отфильтровывается на клиенте.
                new HubMailContact { Name = "Без адреса" },
            ],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = Assert.IsType<MailComposeViewModel>(model.Composer);

        // Запрос идёт по последнему токену поля, а не по всей строке.
        composer.To = "seed@zsgp.ru; pet";
        composer.ScheduleContactSuggestions("to");

        await WaitFor(() => api.MailContactsCallCount > 0);

        Assert.Equal("pet", api.LastMailContactQuery);
        Assert.Equal("mb-1", api.LastMailContactMailboxId);
        Assert.Equal(2, composer.ContactSuggestions.Count);
        Assert.Equal("Пётр Петров", composer.ContactSuggestions[0].Name);
        Assert.Equal("petr@zsgp.ru", composer.ContactSuggestions[0].Email);
        Assert.Equal("Пётр Петров — petr@zsgp.ru", composer.ContactSuggestions[0].DisplayText);
        Assert.Equal("Пётр Петров <petr@zsgp.ru>", composer.ContactSuggestions[0].AddressToken);
        Assert.Equal(string.Empty, composer.ContactSuggestions[1].Name);
        Assert.Equal("team@zsgp.ru", composer.ContactSuggestions[1].AddressToken);
        Assert.True(composer.IsContactPopupOpen);
    }

    [Fact]
    public async Task ShortTokenDoesNotTriggerContactSearch()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailContacts = [new HubMailContact { Email = "petr@zsgp.ru" }],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;

        composer.To = "p";
        composer.ScheduleContactSuggestions("to");
        await Task.Delay(600);

        // Меньше 2 символов — как порог backend'а и веб-композера.
        Assert.Equal(0, api.MailContactsCallCount);
        Assert.False(composer.IsContactPopupOpen);
    }

    [Fact]
    public async Task ApplyingContactSuggestionReplacesLastToken()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailContacts = [new HubMailContact { Name = "Пётр Петров", Email = "petr@zsgp.ru" }],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;
        composer.To = "seed@zsgp.ru; pet";
        composer.ScheduleContactSuggestions("to");
        await WaitFor(() => composer.ContactSuggestions.Count > 0);

        composer.ApplyContactSuggestion(composer.ContactSuggestions[0]);

        // Завершённый адрес до «;» не тронут, токен заменён на «Имя <addr>; ».
        Assert.Equal("seed@zsgp.ru; Пётр Петров <petr@zsgp.ru>; ", composer.To);
        Assert.Equal(["seed@zsgp.ru", "petr@zsgp.ru"], MailComposeViewModel.ParseRecipients(composer.To));
        Assert.False(composer.IsContactPopupOpen);
        Assert.Empty(composer.ContactSuggestions);
    }

    [Fact]
    public async Task ApplyingContactSuggestionToCcField()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailContacts = [new HubMailContact { Email = "boss@zsgp.ru" }],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewMessageCommand.Execute(null);
        var composer = model.Composer!;
        composer.Cc = "bo";
        composer.ScheduleContactSuggestions("cc");
        await WaitFor(() => composer.ContactSuggestions.Count > 0);

        composer.ApplyContactSuggestion(composer.ContactSuggestions[0]);

        Assert.Equal("boss@zsgp.ru; ", composer.Cc);
        Assert.Equal(string.Empty, composer.To);
        Assert.Equal("cc", composer.SuggestionField);
    }

    // ---- Черновик: удаление ----

    [Fact]
    public async Task DeleteDraftFromDetailRemovesRowAndClearsDetail()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("drafts", "Черновики"),
                ],
                items: [MakePreview("m1")]),
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("d1"), MakePreview("d2")],
                Folder = "drafts",
                Total = 2,
            },
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "d1",
                IsRead = true,
                DraftContext = new HubMailDraftContext { ComposeMode = "draft" },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("drafts");
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.True(model.Detail!.IsDraft);

        await ((NativeAsyncCommand)model.DeleteDraftCommand).ExecuteAsync(null);

        // DELETE /mail/drafts/{id}: строка исчезает, деталь закрывается.
        Assert.Equal("d1", api.MailDraftDeletedIds[0]);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("d2", remaining.Id);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal("1", model.TotalText);
        Assert.Equal("Черновик удалён", model.StatusInfoText);
    }

    [Fact]
    public async Task DeleteDraftFromComposerRemovesRowAndCloses()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("drafts", "Черновики"),
                ],
                items: [MakePreview("m1")]),
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("d1")],
                Folder = "drafts",
                Total = 1,
            },
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "d1",
                IsRead = true,
                To = ["petr@zsgp.ru"],
                DraftContext = new HubMailDraftContext { ComposeMode = "draft", MailboxId = "mb-1" },
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("drafts");
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.EditDraftCommand.Execute(null);
        var composer = model.Composer!;
        Assert.True(composer.HasDraft);

        await ((NativeAsyncCommand)composer.DeleteDraftCommand).ExecuteAsync(null);

        Assert.Equal("d1", api.MailDraftDeletedIds[0]);
        Assert.False(model.IsComposeOpen);
        Assert.Empty(model.Items);
        Assert.Equal("Черновик удалён", model.StatusInfoText);
    }

    // ---- Вложения письма ----

    [Fact]
    public async Task AttachmentChipDownloadsThroughSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                Attachments =
                [
                    new HubMailAttachment
                    {
                        Id = "a1", Name = "report.pdf", Size = 1024,
                        Downloadable = true, DownloadToken = "tok-1",
                    },
                    new HubMailAttachment
                    {
                        Id = "a2", Name = "inline.png", Size = 5,
                        IsInline = true, DownloadToken = "tok-2",
                    },
                ],
            },
        };
        var model = new MailViewModel(api);
        string? savedRef = null;
        string? savedMessageId = null;
        model.AttachmentSaver = (attachment, messageId) =>
        {
            savedRef = attachment.Ref;
            savedMessageId = messageId;
            return Task.CompletedTask;
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Inline-вложение не становится чипом — только скачиваемые видимые.
        var attachment = Assert.Single(model.Detail!.Attachments);
        Assert.Equal("report.pdf", attachment.Name);
        Assert.Equal("1 КБ", attachment.SizeText);
        Assert.Equal("tok-1", attachment.Ref);

        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(attachment);

        Assert.Equal("tok-1", savedRef);
        Assert.Equal("m1", savedMessageId);
        Assert.False(attachment.IsDownloading);
    }

    // ---- Переместить ----

    [Fact]
    public async Task MoveRemovesItemAndRecalculatesUnread()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие", unread: 1),
                    MakeFolder("archive", "Архив"),
                ],
                unreadCount: 1,
                items: [MakePreview("m1", isRead: false), MakePreview("m2")],
                total: 2),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = false,
                CanMove = true,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        // Папки-цели меню «Переместить» — без текущей.
        var target = Assert.Single(model.MoveTargets);
        Assert.Equal("archive", target.Id);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        // Письмо прочиталось при открытии — сделаем снова непрочитанным для проверки счётчиков.
        await ((NativeAsyncCommand)model.ToggleReadCommand).ExecuteAsync(null);
        Assert.Equal(1, model.TotalUnreadCount);

        await ((NativeAsyncCommand)model.MoveCommand).ExecuteAsync("archive");

        Assert.Equal(("m1", "archive"), api.MailMovedIds[0]);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m2", remaining.Id);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal("1", model.TotalText);
        Assert.Equal(0, model.TotalUnreadCount);
        Assert.Equal(0, model.Folders[0].Unread);
        Assert.Contains("Архив", model.StatusInfoText);
    }

    // ---- Массовые действия ----

    [Fact]
    public async Task BulkMarkReadHitsBatchApiAndFixesUnread()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 2)],
                unreadCount: 2,
                items:
                [
                    MakePreview("m1", isRead: false),
                    MakePreview("m2", isRead: false),
                    MakePreview("m3", isRead: true),
                ]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        Assert.Equal(0, model.SelectedCount);
        Assert.False(model.HasSelection);

        model.Items[0].IsChecked = true;
        model.Items[2].IsChecked = true;

        Assert.Equal(2, model.SelectedCount);
        Assert.True(model.HasSelection);
        Assert.Equal("Выбрано: 2", model.SelectionText);

        await ((NativeAsyncCommand)model.BulkMarkReadCommand).ExecuteAsync(null);

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("mark_read", action);
        Assert.Null(targetFolder);
        Assert.False(permanent);
        Assert.Equal(["m1", "m3"], ids);
        Assert.False(model.Items[0].IsUnread);
        Assert.True(model.Items[1].IsUnread);
        // Папка и агрегат уменьшились только на реально непрочитанное.
        Assert.Equal(1, model.Folders[0].Unread);
        Assert.Equal(1, model.TotalUnreadCount);
        Assert.Contains("Готово", model.StatusInfoText);
    }

    [Fact]
    public async Task BulkMoveRemovesCheckedItemsFromList()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("archive", "Архив"),
                ],
                items:
                [
                    MakePreview("m1"),
                    MakePreview("m2"),
                    MakePreview("m3"),
                ],
                total: 3),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.Items[0].IsChecked = true;
        model.Items[1].IsChecked = true;

        await ((NativeAsyncCommand)model.BulkMoveCommand).ExecuteAsync("archive");

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("move", action);
        Assert.Equal("archive", targetFolder);
        Assert.False(permanent);
        Assert.Equal(["m1", "m2"], ids);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m3", remaining.Id);
        Assert.Equal("1", model.TotalText);
        Assert.False(model.HasSelection);
    }

    [Fact]
    public async Task BulkArchiveRemovesCheckedItemsFromList()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие", unread: 1),
                    MakeFolder("archive", "Архив"),
                ],
                unreadCount: 1,
                items:
                [
                    MakePreview("m1", isRead: false),
                    MakePreview("m2"),
                    MakePreview("m3"),
                ],
                total: 3),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.Items[0].IsChecked = true;
        model.Items[1].IsChecked = true;

        await ((NativeAsyncCommand)model.BulkArchiveCommand).ExecuteAsync(null);

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("archive", action);
        Assert.Null(targetFolder);
        Assert.False(permanent);
        Assert.Equal(["m1", "m2"], ids);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m3", remaining.Id);
        Assert.Equal("1", model.TotalText);
        // Непрочитанный m1 ушёл из папки — счётчики уменьшились.
        Assert.Equal(0, model.Folders[0].Unread);
        Assert.Equal(0, model.TotalUnreadCount);
    }

    [Fact]
    public async Task BulkPermanentDeleteRunsOnlyInTrash()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("trash", "Удалённые"),
                ],
                items: [MakePreview("m1")]),
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("t1"), MakePreview("t2")],
                Folder = "trash",
                Total = 2,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.Items[0].IsChecked = true;
        // Во «Входящих» безвозвратного удаления нет (как в веб-почте).
        Assert.False(model.IsTrashFolder);
        Assert.False(model.BulkDeletePermanentCommand.CanExecute(null));
        model.Items[0].IsChecked = false;

        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("trash");

        Assert.True(model.IsTrashFolder);
        model.Items[0].IsChecked = true;
        model.Items[1].IsChecked = true;
        Assert.True(model.BulkDeletePermanentCommand.CanExecute(null));

        await ((NativeAsyncCommand)model.BulkDeletePermanentCommand).ExecuteAsync(null);

        var (action, ids, _, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("delete", action);
        Assert.True(permanent);
        Assert.Equal(["t1", "t2"], ids);
        Assert.Empty(model.Items);
        Assert.Equal("0", model.TotalText);
    }

    [Fact]
    public async Task SelectAllAndClearSelectionToggleChecked()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1"), MakePreview("m2")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.SelectAllCommand.Execute(null);
        Assert.Equal(2, model.SelectedCount);

        model.ClearSelectionCommand.Execute(null);
        Assert.Equal(0, model.SelectedCount);
        Assert.False(model.Items[0].IsChecked);
    }

    // ---- Папки: создание/переименование/удаление/избранное ----

    [Fact]
    public async Task NewFolderCommandOpensEditorAndConfirmCreatesFolder()
    {
        var created = new HubMailFolder
        {
            Id = "custom-new",
            Label = "Проекты 2026",
            Name = "Проекты 2026",
            Scope = "mailbox",
            IconKey = "folder",
            CanRename = true,
            CanDelete = true,
            CanCreateChildren = true,
        };
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailFolderCreateResult = created,
            // После мутации VM догоняет дерево — backend уже вернул папку в tree.
            MailFolderTree = new HubMailFolderTree
            {
                Items = [MakeFolder("inbox", "Входящие"), created],
            },
            MailMessagesPage = new HubMailMessagePage { Items = [], Folder = "custom-new" },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        model.NewFolderCommand.Execute(null);

        Assert.True(model.IsFolderEditorOpen);
        Assert.Equal("Новая папка", model.FolderEditorTitle);
        Assert.Equal("Создать", model.FolderEditorConfirmText);

        model.FolderEditorName = "  Проекты 2026  ";
        await ((NativeAsyncCommand)model.ConfirmFolderEditorCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MailFolderCreateCalls);
        Assert.Equal("mb-1", call.MailboxId);
        Assert.Equal("Проекты 2026", call.Name);
        Assert.Null(call.ParentFolderId);
        Assert.Equal("mailbox", call.Scope);
        Assert.False(model.IsFolderEditorOpen);
        Assert.Contains(model.Folders, folder => folder.Id == "custom-new");
        Assert.Equal("custom-new", model.CurrentFolder);
        Assert.Equal("custom-new", model.SelectedFolder?.Id);
        Assert.Equal("Папка «Проекты 2026» создана", model.StatusInfoText);
    }

    [Fact]
    public async Task FolderEditorEmptyNameShowsLocalErrorWithoutApiCall()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.NewFolderCommand.Execute(null);

        model.FolderEditorName = "   ";
        await ((NativeAsyncCommand)model.ConfirmFolderEditorCommand).ExecuteAsync(null);

        Assert.True(model.IsFolderEditorOpen);
        Assert.True(model.HasFolderEditorError);
        Assert.Equal("Введите имя папки.", model.FolderEditorErrorText);
        Assert.Empty(api.MailFolderCreateCalls);
    }

    [Fact]
    public async Task NewSubfolderCommandSendsParentIdOfFolder()
    {
        var custom = MakeFolder("custom-1", "Проекты", wellKnown: null) with
        {
            CanCreateChildren = true,
        };
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие"), custom],
                items: [MakePreview("m1")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var parent = model.Folders.Single(f => f.Id == "custom-1");

        model.NewSubfolderCommand.Execute(parent);

        Assert.True(model.IsFolderEditorOpen);
        Assert.Equal("Новая вложенная в «Проекты»", model.FolderEditorTitle);
        model.FolderEditorName = "2027";
        await ((NativeAsyncCommand)model.ConfirmFolderEditorCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MailFolderCreateCalls);
        Assert.Equal("custom-1", call.ParentFolderId);
        Assert.Equal("mailbox", call.Scope);
    }

    [Fact]
    public async Task RenameFolderCommandPrefillsAndConfirmPatchesLabel()
    {
        var custom = MakeFolder("custom-1", "Старое", wellKnown: null) with
        {
            CanRename = true,
            CanDelete = true,
        };
        var renamed = custom with { Label = "Новое", Name = "Новое" };
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие"), custom],
                items: [MakePreview("m1")]),
            MailFolderRenameResult = renamed,
            MailFolderTree = new HubMailFolderTree
            {
                Items = [MakeFolder("inbox", "Входящие"), renamed],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var folder = model.Folders.Single(f => f.Id == "custom-1");
        Assert.True(folder.ShowRename);
        Assert.True(folder.ShowDelete);

        model.RenameFolderCommand.Execute(folder);

        Assert.True(model.IsFolderEditorOpen);
        Assert.Equal("Переименовать папку", model.FolderEditorTitle);
        Assert.Equal("Переименовать", model.FolderEditorConfirmText);
        Assert.Equal("Старое", model.FolderEditorName);

        model.FolderEditorName = "Новое";
        await ((NativeAsyncCommand)model.ConfirmFolderEditorCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MailFolderRenameCalls);
        Assert.Equal("custom-1", call.FolderId);
        Assert.Equal("mb-1", call.MailboxId);
        Assert.Equal("Новое", call.Name);
        Assert.False(model.IsFolderEditorOpen);
        Assert.Equal("Новое", model.Folders.Single(f => f.Id == "custom-1").Label);
        Assert.Equal("Папка переименована в «Новое»", model.StatusInfoText);
    }

    [Fact]
    public async Task StandardFolderDoesNotExposeRenameOrDelete()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var inbox = model.Folders[0];

        Assert.False(inbox.IsCustom);
        Assert.False(inbox.ShowRename);
        Assert.False(inbox.ShowDelete);

        // Страж команды тоже не открывает редактор по системной папке.
        model.RenameFolderCommand.Execute(inbox);
        Assert.False(model.IsFolderEditorOpen);
    }

    [Fact]
    public async Task DeleteFolderRequiresArmedSecondClickAndRemovesIt()
    {
        var custom = MakeFolder("custom-1", "Проекты", wellKnown: null) with
        {
            CanDelete = true,
        };
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие"), custom],
                items: [MakePreview("m1")]),
            MailFolderTree = new HubMailFolderTree
            {
                Items = [MakeFolder("inbox", "Входящие")],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var folder = model.Folders.Single(f => f.Id == "custom-1");

        // Первый клик по «Удалить» в меню только взводит подтверждение.
        await ((NativeAsyncCommand)model.DeleteFolderCommand).ExecuteAsync(folder);

        Assert.True(folder.DeleteArmed);
        Assert.Equal("Точно удалить?", folder.DeleteText);
        Assert.Empty(api.MailFolderDeleteCalls);
        Assert.Equal(2, model.Folders.Count);

        await ((NativeAsyncCommand)model.DeleteFolderCommand).ExecuteAsync(folder);

        var call = Assert.Single(api.MailFolderDeleteCalls);
        Assert.Equal("custom-1", call.FolderId);
        Assert.Equal("mb-1", call.MailboxId);
        var remaining = Assert.Single(model.Folders);
        Assert.Equal("inbox", remaining.Id);
        Assert.Equal("Папка «Проекты» удалена", model.StatusInfoText);
    }

    [Fact]
    public async Task DeleteCurrentFolderFallsBackToInbox()
    {
        var custom = MakeFolder("custom-1", "Проекты", wellKnown: null) with
        {
            CanDelete = true,
        };
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие"), custom],
                items: [MakePreview("m1")]),
            MailFolderTree = new HubMailFolderTree
            {
                Items = [MakeFolder("inbox", "Входящие")],
            },
            MailMessagesPage = new HubMailMessagePage
            {
                Items = [MakePreview("m2")],
                Folder = "inbox",
                Total = 1,
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var folder = model.Folders.Single(f => f.Id == "custom-1");
        await ((NativeAsyncCommand)model.SelectFolderCommand).ExecuteAsync("custom-1");
        Assert.Equal("custom-1", model.CurrentFolder);

        await ((NativeAsyncCommand)model.DeleteFolderCommand).ExecuteAsync(folder);
        await ((NativeAsyncCommand)model.DeleteFolderCommand).ExecuteAsync(folder);

        Assert.Equal("inbox", model.CurrentFolder);
        Assert.Equal("inbox", model.SelectedFolder?.Id);
    }

    [Fact]
    public async Task FolderFavoriteTogglesOptimisticallyWithApiFlag()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var inbox = model.Folders[0];
        Assert.False(inbox.IsFavorite);
        Assert.Equal("☆ В избранное", inbox.FavoriteText);

        await ((NativeAsyncCommand)model.ToggleFolderFavoriteCommand).ExecuteAsync(inbox);

        var call = Assert.Single(api.MailFolderFavoriteCalls);
        Assert.Equal("inbox", call.FolderId);
        Assert.Equal("mb-1", call.MailboxId);
        Assert.True(call.Favorite);
        Assert.True(inbox.IsFavorite);
        Assert.Equal("★ Убрать из избранного", inbox.FavoriteText);
    }

    [Fact]
    public async Task FolderFavoriteFailureRollsBackFlag()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1")]),
            MailFolderMutationException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        var inbox = model.Folders[0];

        await ((NativeAsyncCommand)model.ToggleFolderFavoriteCommand).ExecuteAsync(inbox);

        Assert.False(inbox.IsFavorite);
        Assert.True(model.HasBannerError);
        Assert.False(inbox.IsBusy);
    }

    // ---- Важность письма ----

    [Fact]
    public async Task ToggleImportancePostsHighThenNormalAndSyncsListPill()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Письмо",
                SenderEmail = "sender@zsgp.ru",
                IsRead = true,
                Importance = "normal",
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.False(model.Detail!.IsImportant);
        Assert.False(model.Items[0].IsImportant);
        Assert.Equal("❗ Важное", model.Detail.ImportanceToggleText);

        await ((NativeAsyncCommand)model.ToggleImportanceCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MailImportanceCalls);
        Assert.Equal("m1", call.MessageId);
        Assert.Equal("mb-1", call.MailboxId);
        Assert.Equal("high", call.Importance);
        Assert.True(model.Detail.IsImportant);
        Assert.Equal("Важно", model.Detail.ImportanceText);
        Assert.Equal("Снять важность", model.Detail.ImportanceToggleText);
        Assert.True(model.Items[0].IsImportant);

        await ((NativeAsyncCommand)model.ToggleImportanceCommand).ExecuteAsync(null);

        Assert.Equal(2, api.MailImportanceCalls.Count);
        Assert.Equal("normal", api.MailImportanceCalls[1].Importance);
        Assert.False(model.Detail.IsImportant);
        Assert.False(model.Items[0].IsImportant);
    }

    [Fact]
    public async Task ToggleImportanceFailureRollsBackBothFlags()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                Importance = "normal",
            },
            MailImportanceException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.ToggleImportanceCommand).ExecuteAsync(null);

        Assert.False(model.Detail!.IsImportant);
        Assert.False(model.Items[0].IsImportant);
        Assert.True(model.HasDetailError);
    }

    [Fact]
    public async Task StarToggleUpdatesRowWithoutOpeningAndKeepsDetailInSync()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true), MakePreview("m2", isRead: false)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                Importance = "normal",
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.Equal("☆", model.Items[1].StarText);

        // Звезда строки без открытия письма: деталь другого письма не трогаем.
        await ((NativeAsyncCommand)model.ToggleItemImportanceCommand).ExecuteAsync(model.Items[1]);

        Assert.True(model.Items[1].IsImportant);
        Assert.Equal("★", model.Items[1].StarText);
        Assert.False(model.Items[0].IsImportant);
        Assert.False(model.Detail!.IsImportant);
        var call = Assert.Single(api.MailImportanceCalls);
        Assert.Equal("m2", call.MessageId);
        Assert.Equal("mb-1", call.MailboxId);
        Assert.Equal("high", call.Importance);

        // Звезда строки письма, открытого в панели чтения, — деталь синхронна.
        await ((NativeAsyncCommand)model.ToggleItemImportanceCommand).ExecuteAsync(model.Items[0]);

        Assert.True(model.Items[0].IsImportant);
        Assert.True(model.Detail.IsImportant);
        Assert.Equal(2, api.MailImportanceCalls.Count);
        Assert.Equal("m1", api.MailImportanceCalls[1].MessageId);
        Assert.Equal("high", api.MailImportanceCalls[1].Importance);
    }

    [Fact]
    public async Task StarToggleFailureRollsBackRowAndOpenDetail()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                Importance = "normal",
            },
            MailImportanceException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.ToggleItemImportanceCommand).ExecuteAsync(model.Items[0]);

        Assert.False(model.Items[0].IsImportant);
        Assert.Equal("☆", model.Items[0].StarText);
        Assert.False(model.Detail!.IsImportant);
        Assert.True(model.HasBannerError);
    }

    [Fact]
    public async Task KebabReadToggleMarksOneItemAndAdjustsBadges()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие", unread: 2)],
                items: [MakePreview("m1", isRead: false), MakePreview("m2", isRead: false)],
                unreadCount: 2),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        Assert.Equal("Пометить прочитанным", model.Items[1].ToggleReadItemText);

        await ((NativeAsyncCommand)model.ToggleItemReadCommand).ExecuteAsync(model.Items[1]);

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("mark_read", action);
        Assert.Equal(["m2"], ids);
        Assert.Null(targetFolder);
        Assert.False(permanent);
        Assert.False(model.Items[1].IsUnread);
        Assert.Equal("Пометить непрочитанным", model.Items[1].ToggleReadItemText);
        Assert.True(model.Items[0].IsUnread);
        Assert.Equal(1, model.Folders[0].Unread);
        Assert.Equal(1, model.TotalUnreadCount);
    }

    [Fact]
    public async Task KebabArchiveRemovesRowWithoutTouchingOthers()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие", unread: 1),
                    MakeFolder("archive", "Архив"),
                ],
                items: [MakePreview("m1", isRead: false), MakePreview("m2", isRead: true)],
                unreadCount: 1),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ArchiveItemCommand).ExecuteAsync(model.Items[0]);

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("archive", action);
        Assert.Equal(["m1"], ids);
        Assert.False(permanent);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m2", remaining.Id);
        // Непрочитанное ушло — бейдж папки и агрегат пересчитались.
        Assert.Equal(0, model.Folders[0].Unread);
        Assert.Equal(0, model.TotalUnreadCount);
    }

    [Fact]
    public async Task KebabDeleteRemovesRowAndClosesDetailOfDeletedLetter()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true), MakePreview("m2", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.Equal("Удалить", model.ItemDeleteMenuText);

        // Удаляем другое письмо — открытая деталь не меняется.
        await ((NativeAsyncCommand)model.DeleteItemCommand).ExecuteAsync(model.Items[1]);

        Assert.Single(model.Items);
        Assert.NotNull(model.Detail);
        var calls = api.MailBulkCalls;
        Assert.Single(calls);
        Assert.Equal("delete", calls[0].Action);
        Assert.Equal(["m2"], calls[0].Ids);
        Assert.False(calls[0].Permanent);

        // Удаляем открытый — деталь закрывается.
        await ((NativeAsyncCommand)model.DeleteItemCommand).ExecuteAsync(model.Items[0]);

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal("0", model.TotalText);
    }

    [Fact]
    public async Task MoveItemToFolderMovesSingleItemViaBulkCore()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("archive", "Архив"),
                ],
                items: [MakePreview("m1", isRead: true), MakePreview("m2", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await model.MoveItemToFolderSafelyAsync(model.Items[0], "archive", CancellationToken.None);

        var (action, ids, targetFolder, permanent) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("move", action);
        Assert.Equal(["m1"], ids);
        Assert.Equal("archive", targetFolder);
        Assert.False(permanent);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m2", remaining.Id);
    }

    [Fact]
    public async Task KebabMoveCommandUsesOpenRowAndClearsContext()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("archive", "Архив"),
                ],
                items: [MakePreview("m1", isRead: true), MakePreview("m2", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        // Пункт подменю активен только при открытом контексте строки.
        var moveCommand = (NativeAsyncCommand)model.MoveItemFromKebabCommand;
        Assert.False(moveCommand.CanExecute("archive"));
        model.KebabTargetItem = model.Items[1];
        Assert.True(moveCommand.CanExecute("archive"));

        await moveCommand.ExecuteAsync("archive");

        var (action, ids, targetFolder, _) = Assert.Single(api.MailBulkCalls);
        Assert.Equal("move", action);
        Assert.Equal(["m2"], ids);
        Assert.Equal("archive", targetFolder);
        Assert.Null(model.KebabTargetItem);
        Assert.False(moveCommand.CanExecute("archive"));
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m1", remaining.Id);
    }

    [Fact]
    public async Task MoveItemToFolderFailureSetsBannerWithoutThrow()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("archive", "Архив"),
                ],
                items: [MakePreview("m1", isRead: true)]),
            MailBulkException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        // Drag&drop-путь не бросает исключение наружу: ошибка уходит в баннер.
        await model.MoveItemToFolderSafelyAsync(model.Items[0], "archive", CancellationToken.None);

        Assert.True(model.HasBannerError);
        Assert.Single(model.Items);
    }

    [Fact]
    public async Task ListHeaderShowsFolderNameAndSwitchesToAllFoldersSearch()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        Assert.Equal("Входящие", model.ListHeaderTitle);
        Assert.False(model.SearchAllFolders);

        // Поиск по всем папкам: заголовок честно говорит «Все папки»,
        // а не имя выбранной строки рейки.
        model.SearchAllFolders = true;

        Assert.Equal("Все папки", model.ListHeaderTitle);
        model.SearchAllFolders = false;
        Assert.Equal("Входящие", model.ListHeaderTitle);
    }

    [Fact]
    public async Task ResetListFiltersClearsSearchFilterAndReloadsList()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("unread");
        model.SearchText = "отчёт";
        Assert.True(model.HasActiveListFilters);

        await ((NativeAsyncCommand)model.ResetListFiltersCommand).ExecuteAsync(null);

        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal("all", model.Filter);
        Assert.False(model.HasActiveListFilters);
    }

    [Fact]
    public async Task HasActiveListFiltersReflectsSearchState()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        Assert.False(model.HasActiveListFilters);

        model.SearchText = "abc";
        Assert.True(model.HasActiveListFilters);

        model.SearchText = string.Empty;
        Assert.False(model.HasActiveListFilters);

        model.SearchAllFolders = true;
        Assert.True(model.HasActiveListFilters);
    }

    [Fact]
    public async Task RestoreFromRowCallsEndpointAndRemovesListRow()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("trash", "Удалённые"),
                ],
                items: [MakePreview("m1", isRead: false), MakePreview("m2", isRead: true)],
                unreadCount: 1),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.RestoreItemCommand).ExecuteAsync(model.Items[0]);

        var call = Assert.Single(api.MailRestoreCalls);
        Assert.Equal("m1", call.MessageId);
        Assert.Equal("mb-1", call.MailboxId);
        var remaining = Assert.Single(model.Items);
        Assert.Equal("m2", remaining.Id);
        // Непрочитанное уходит из выдачи — бейдж папки и агрегат пересчитаны.
        Assert.Equal(0, model.Folders[0].Unread);
        Assert.Equal(0, model.TotalUnreadCount);
        Assert.Contains("восстановлено", model.StatusInfoText);
    }

    [Fact]
    public async Task RestoreFromOpenDetailRemovesRowAndClosesDetail()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    MakeFolder("trash", "Удалённые"),
                ],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Из шапки чтения параметр — сама деталь.
        await ((NativeAsyncCommand)model.RestoreItemCommand).ExecuteAsync(model.Detail);

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal("0", model.TotalText);
        Assert.Single(api.MailRestoreCalls);
    }

    [Fact]
    public async Task RestoreFailureKeepsRowAndSetsBanner()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailRestoreException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.RestoreItemCommand).ExecuteAsync(model.Items[0]);

        Assert.Single(model.Items);
        Assert.True(model.HasBannerError);
    }

    private static HubMailFolder NestedFolder(
        string id, string label, string? parentId = null, int unread = 0) =>
        new()
        {
            Id = id,
            Label = label,
            Scope = "mailbox",
            Total = unread + 1,
            Unread = unread,
            ParentId = parentId,
        };

    [Fact]
    public async Task FolderTreeKeepsChildrenUnderParentInDfsOrder()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    NestedFolder("f-projects", "Проекты"),
                    NestedFolder("f-alpha", "Альфа", parentId: "f-projects"),
                    NestedFolder("f-beta", "Бета", parentId: "f-projects"),
                ],
                items: [MakePreview("m1", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        // DFS: дети следуют за родителем; уровень задаёт отступ и chevron.
        Assert.Equal(
            ["inbox", "f-projects", "f-alpha", "f-beta"],
            model.Folders.Select(f => f.Id).ToArray());
        Assert.True(model.Folders[1].HasChildren);
        Assert.False(model.Folders[0].HasChildren);
        Assert.Equal(0, model.Folders[1].Depth);
        Assert.Equal(1, model.Folders[2].Depth);
        Assert.Equal(1, model.Folders[3].Depth);
        Assert.Equal(16, model.Folders[2].IndentWidth);
        Assert.True(model.Folders[2].IsTreeVisible);
    }

    [Fact]
    public async Task CollapsingFolderBranchHidesChildrenUntilExpanded()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders:
                [
                    MakeFolder("inbox", "Входящие"),
                    NestedFolder("f-projects", "Проекты"),
                    NestedFolder("f-alpha", "Альфа", parentId: "f-projects"),
                    NestedFolder("f-beta", "Бета", parentId: "f-projects"),
                ],
                items: [MakePreview("m1", isRead: true)]),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        ((NativeRelayCommand)model.ToggleFolderExpandedCommand).Execute(model.Folders[1]);

        // Ветка свёрнута: сам узел виден, дети скрыты.
        Assert.False(model.Folders[1].IsExpanded);
        Assert.True(model.Folders[1].IsTreeVisible);
        Assert.False(model.Folders[2].IsTreeVisible);
        Assert.False(model.Folders[3].IsTreeVisible);
        Assert.True(model.Folders[0].IsTreeVisible);

        ((NativeRelayCommand)model.ToggleFolderExpandedCommand).Execute(model.Folders[1]);

        Assert.True(model.Folders[1].IsExpanded);
        Assert.True(model.Folders[2].IsTreeVisible);
        Assert.True(model.Folders[3].IsTreeVisible);
    }

    [Fact]
    public async Task DetailHeadersLoadOnceAndToggleOffWithoutRefetch()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.False(model.Detail!.AreHeadersVisible);
        Assert.Equal("Показать заголовки", model.Detail.HeadersToggleText);

        await ((NativeAsyncCommand)model.ToggleDetailHeadersCommand).ExecuteAsync(null);

        Assert.True(model.Detail.AreHeadersVisible);
        Assert.Equal("Скрыть заголовки", model.Detail.HeadersToggleText);
        var call = Assert.Single(api.MailHeadersCalls);
        Assert.Equal("m1", call.MessageId);
        Assert.Equal("mb-1", call.MailboxId);
        // Моноширинный список: элементы payload построчно.
        Assert.Contains("Message-ID: <CALd=eM1@mail.zsgp.ru>", model.Detail.HeadersText);
        Assert.Contains("Received: ", model.Detail.HeadersText);
        Assert.Equal("message.eml", model.Detail.HeadersSourceName);

        // Повторное скрытие/раскрытие не перезагружает — текст кэширован в детали.
        await ((NativeAsyncCommand)model.ToggleDetailHeadersCommand).ExecuteAsync(null);
        Assert.False(model.Detail.AreHeadersVisible);
        await ((NativeAsyncCommand)model.ToggleDetailHeadersCommand).ExecuteAsync(null);
        Assert.True(model.Detail.AreHeadersVisible);
        Assert.Single(api.MailHeadersCalls);
    }

    [Fact]
    public async Task DetailHeadersFailureSetsDetailErrorAndStopsLoading()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
            MailHeadersException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.ToggleDetailHeadersCommand).ExecuteAsync(null);

        Assert.True(model.Detail!.AreHeadersVisible);
        Assert.False(model.Detail.IsHeadersLoading);
        Assert.True(model.HasDetailError);
    }

    [Fact]
    public async Task DownloadMessageSourceFetchesEmlForOpenDetail()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Шов заменяет весь путь сохранения (как AttachmentSaver): команда
        // доходит до сохранения с открытой деталью, без %TEMP% и проводника.
        MailDetailViewModel? savedDetail = null;
        model.MessageSourceSaver = detail =>
        {
            savedDetail = detail;
            return Task.CompletedTask;
        };

        var downloadCommand = (NativeAsyncCommand)model.DownloadMessageSourceCommand;
        Assert.True(downloadCommand.CanExecute(null));
        await downloadCommand.ExecuteAsync(null);

        Assert.Same(model.Detail, savedDetail);

        // Смена фильтра гасит деталь — команда скачивания становится недоступной.
        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("unread");
        Assert.Null(model.Detail);
        Assert.False(downloadCommand.CanExecute(null));
    }

    [Fact]
    public void DateGroupKeysSortChronologicallyAndCoverPeriods()
    {
        var now = DateTimeOffset.Now;
        // Числовые префиксы гарантируют порядок групп при строковой сортировке WPF.
        var today = MailListItemViewModel.ComputeDateGroup(now.ToString("O"));
        var yesterday = MailListItemViewModel.ComputeDateGroup(now.AddDays(-1).ToString("O"));
        var thisWeek = MailListItemViewModel.ComputeDateGroup(now.AddDays(-3).ToString("O"));
        var broken = MailListItemViewModel.ComputeDateGroup("не-дата");

        Assert.Matches("^0\\|Сегодня$", today);
        Assert.Matches("^1\\|Вчера$", yesterday);
        Assert.Matches("^2\\|Ранее на этой неделе$", thisWeek);
        Assert.Matches("^4\\|Ранее$", broken);
        Assert.True(string.CompareOrdinal(today, yesterday) < 0);
        Assert.True(string.CompareOrdinal(yesterday, thisWeek) < 0);
    }

    // ---- AI: пересказ и быстрые ответы ----

    [Fact]
    public async Task SummarizeAsksConsentThenShowsSummaryPanel()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                IsRead = true,
                BodyText = "Длинный текст письма",
            },
            MailSummaryResult = new HubMailSummaryResult { Summary = "Короткое содержание" },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.True(model.ShowAiActions);
        Assert.False(model.IsMailAiEnabled);

        // Без opt-in: кнопка открывает согласие, запроса нет.
        await ((NativeAsyncCommand)model.SummarizeCommand).ExecuteAsync(null);

        Assert.True(model.AiConsentOpen);
        Assert.Equal(0, api.MailSummarizeCallCount);
        Assert.False(model.ShowSummaryPanel);
        Assert.Contains("внешний сервис ИИ", model.MailAiDisclosureText);

        await ((NativeAsyncCommand)model.AcceptAiConsentCommand).ExecuteAsync(null);

        Assert.True(model.IsMailAiEnabled);
        Assert.False(model.AiConsentOpen);
        Assert.Equal(1, api.MailSummarizeCallCount);
        Assert.True(model.ShowSummaryPanel);
        Assert.Equal("Короткое содержание", model.AiSummaryText);
        Assert.False(model.HasAiError);
    }

    [Fact]
    public async Task SummarizeServerDisabledHidesAiButtons()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
            MailAiException = new HubApiException(
                HubApiErrorKind.Http,
                "MAIL_AI_DISABLED",
                System.Net.HttpStatusCode.Forbidden),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.SummarizeCommand).ExecuteAsync(null);
        await ((NativeAsyncCommand)model.AcceptAiConsentCommand).ExecuteAsync(null);

        // «Проба+скрытие»: 403 → кнопки AI исчезают, локальной ошибки нет.
        Assert.True(model.MailAiServerDisabled);
        Assert.False(model.ShowAiActions);
        Assert.False(model.AiConsentOpen);
        Assert.False(model.HasAiError);
        Assert.Equal(1, api.MailSummarizeCallCount);
    }

    [Fact]
    public async Task AiFailureShowsLocalErrorAndKeepsButtons()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail { Id = "m1", IsRead = true },
            MailAiException = new InvalidOperationException("сбой"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.SummarizeCommand).ExecuteAsync(null);
        await ((NativeAsyncCommand)model.AcceptAiConsentCommand).ExecuteAsync(null);

        Assert.True(model.HasAiError);
        Assert.False(model.MailAiServerDisabled);
        Assert.True(model.ShowAiActions);
    }

    [Fact]
    public async Task SmartRepliesShowChipsAndApplyIntoReplyComposer()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Вопрос",
                SenderDisplay = "Иван Иванов",
                SenderEmail = "ivan@zsgp.ru",
                IsRead = true,
                BodyText = "Привет?",
            },
            MailSmartRepliesResult = new HubMailSmartRepliesResult
            {
                Suggestions = ["Да, подтверждаю.", "Нет, спасибо.", "Уточню завтра.", "  "],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.SmartRepliesCommand).ExecuteAsync(null);
        await ((NativeAsyncCommand)model.AcceptAiConsentCommand).ExecuteAsync(null);

        Assert.Equal(1, api.MailSmartRepliesCallCount);
        Assert.Equal(3, model.SmartReplies.Count);
        Assert.Contains("Да, подтверждаю.", model.SmartReplies);
        Assert.Null(model.Composer);

        model.ApplySmartReplyCommand.Execute("Да, подтверждаю.");

        var composer = model.Composer;
        Assert.NotNull(composer);
        Assert.Equal("reply", composer!.Mode);
        Assert.Equal("ivan@zsgp.ru", composer.To);
        Assert.StartsWith("Да, подтверждаю.", composer.Body);
        Assert.Contains("Привет?", composer.Body); // цитата осталась ниже подсказки
    }

    [Fact]
    public async Task SmartReplyAppliesIntoAlreadyOpenReplyComposer()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                folders: [MakeFolder("inbox", "Входящие")],
                items: [MakePreview("m1", isRead: true)]),
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                Subject = "Вопрос",
                SenderEmail = "ivan@zsgp.ru",
                IsRead = true,
                BodyText = "Привет?",
            },
            MailSmartRepliesResult = new HubMailSmartRepliesResult
            {
                Suggestions = ["Спасибо, посмотрю"],
            },
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        await ((NativeAsyncCommand)model.SmartRepliesCommand).ExecuteAsync(null);
        await ((NativeAsyncCommand)model.AcceptAiConsentCommand).ExecuteAsync(null);

        model.ReplyCommand.Execute(null);
        var composer = model.Composer;
        Assert.NotNull(composer);
        Assert.Equal("reply", composer!.Mode);
        composer.Body = "Набранный текст" + composer.Body;

        model.ApplySmartReplyCommand.Execute("Спасибо, посмотрю");

        Assert.StartsWith("Спасибо, посмотрю", composer.Body);
        Assert.Contains("Набранный текст", composer.Body);
        Assert.Equal("reply", composer.Mode);
    }

    // ---- Заявка в IT: открытие, динамическая форма, отправка ----

    [Fact]
    public async Task ItRequestOpensListsTemplatesAndBuildsDynamicFields()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailTemplates = [MakeItTemplate()],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        Assert.True(model.OpenItRequestCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);

        var form = Assert.IsType<MailItRequestViewModel>(model.ItRequest);
        Assert.True(model.IsItRequestOpen);
        Assert.Equal(1, api.MailTemplatesCallCount);
        Assert.False(api.LastMailTemplatesIncludeInactive);
        var option = Assert.Single(form.Templates);
        Assert.Equal("tpl-1", option.Id);
        Assert.Equal("Замена картриджа", option.Title);

        form.SelectedTemplate = option;
        Assert.True(form.HasFields);
        // order backend'а задаёт порядок: model(0) перед comment(1).
        Assert.Equal(8, form.Fields.Count);
        Assert.Equal("model", form.Fields[0].Key);
        Assert.Equal("comment", form.Fields[1].Key);

        var text = form.Fields[0];
        Assert.True(text.IsTextInput);
        Assert.True(text.Required);
        Assert.Equal("Модель *", text.LabelText);
        Assert.Equal("HP M404", text.TextValue); // default_value применился

        var area = form.Fields[1];
        Assert.True(area.IsTextarea);
        Assert.False(area.Required);
        Assert.Equal("Комментарий", area.LabelText);

        var select = form.Fields[2];
        Assert.True(select.IsSelect);
        Assert.Equal(["ч/б", "цвет"], select.OptionValues);
        Assert.Equal("цвет", select.SelectedOption);

        var multi = form.Fields[3];
        Assert.True(multi.IsMultiSelect);
        Assert.Equal(2, multi.OptionItems.Count);
        Assert.True(multi.OptionItems[0].IsSelected);  // default ["барабан"]
        Assert.False(multi.OptionItems[1].IsSelected);

        var date = form.Fields[4];
        Assert.True(date.IsDate);
        Assert.Equal(new DateTime(2026, 5, 4), date.DateValue);

        var flag = form.Fields[5];
        Assert.True(flag.IsCheckbox);
        Assert.False(flag.BoolValue);

        // email/tel — однострочные поля, как text.
        Assert.True(form.Fields[6].IsTextInput);
        Assert.True(form.Fields[7].IsTextInput);
    }

    [Fact]
    public async Task ItRequestRequiredValidationBlocksSendAndKeepsOverlay()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailTemplates =
            [
                new HubMailTemplate
                {
                    Id = "tpl-req",
                    Title = "Согласование",
                    IsActive = true,
                    Fields =
                    [
                        new HubMailTemplateField { Key = "reason", Label = "Причина", Type = "text", Required = true },
                        new HubMailTemplateField { Key = "agree", Label = "Согласен", Type = "checkbox", Required = true },
                    ],
                },
            ],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
        var form = model.ItRequest!;
        form.SelectedTemplate = form.Templates[0];

        await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);

        Assert.True(form.HasError);
        Assert.Contains("Причина", form.ErrorText);
        Assert.Contains("Согласен", form.ErrorText);
        Assert.Empty(api.MailItRequestCalls);
        Assert.Empty(api.MailItRequestMultipartCalls);
        Assert.True(model.IsItRequestOpen);

        // После заполнения required-полей отправка проходит.
        form.Fields[0].TextValue = "сломался принтер";
        form.Fields[1].BoolValue = true;
        await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);
        var call = Assert.Single(api.MailItRequestCalls);
        Assert.Equal("tpl-req", call.TemplateId);
        Assert.Equal("сломался принтер", call.Fields["reason"]);
        Assert.True((bool)call.Fields["agree"]!);
        Assert.False(model.IsItRequestOpen);
    }

    [Fact]
    public async Task ItRequestSendWithoutFilesPostsJsonAndCloses()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailTemplates = [MakeItTemplate()],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
        var form = model.ItRequest!;
        form.SelectedTemplate = form.Templates[0];

        await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MailItRequestCalls);
        Assert.Equal("tpl-1", call.TemplateId);
        Assert.Equal("HP M404", call.Fields["model"]);
        Assert.Equal("цвет", call.Fields["color"]);
        Assert.Equal("2026-05-04", call.Fields["due"]);
        Assert.False((bool)call.Fields["urgent"]!);
        Assert.Equal(["барабан"], Assert.IsType<List<string>>(call.Fields["parts"]));
        Assert.Empty(api.MailItRequestMultipartCalls);
        Assert.False(model.IsItRequestOpen);
        Assert.Equal("Отправлено", model.StatusInfoText);
    }

    [Fact]
    public async Task ItRequestSendWithFilesPostsMultipart()
    {
        var temp = Path.Combine(Path.GetTempPath(), $"it-req-{Guid.NewGuid():N}.txt");
        try
        {
            await File.WriteAllTextAsync(temp, "спецификация");
            var api = new FakeHubApiClient
            {
                MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
                MailTemplates = [MakeItTemplate()],
            };
            var model = new MailViewModel(api) { ComposeFilePicker = () => [temp] };
            await model.LoadAsync();
            await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
            var form = model.ItRequest!;
            form.SelectedTemplate = form.Templates[0];

            await ((NativeAsyncCommand)form.AttachCommand).ExecuteAsync(null);
            var chip = Assert.Single(form.Attachments);
            Assert.Equal(temp, chip.Path);
            Assert.True(form.HasAttachments);

            await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);

            Assert.Empty(api.MailItRequestCalls);
            var call = Assert.Single(api.MailItRequestMultipartCalls);
            Assert.Equal("tpl-1", call.TemplateId);
            Assert.Equal("HP M404", call.Fields["model"]);
            var file = Assert.Single(call.Attachments);
            Assert.Equal(Path.GetFileName(temp), file.FileName);
            Assert.Equal("text/plain", file.ContentType);
            Assert.Equal("спецификация", Encoding.UTF8.GetString(file.Content.ToArray()));
            Assert.False(model.IsItRequestOpen);
            Assert.Equal("Отправлено", model.StatusInfoText);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    [Fact]
    public async Task ItRequestSendErrorKeepsOverlayAndReusesKeyOnRetry()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailTemplates = [MakeItTemplate()],
            MailItRequestException = new InvalidOperationException("smtp down"),
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
        var form = model.ItRequest!;
        form.SelectedTemplate = form.Templates[0];

        await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);

        Assert.True(form.HasError);
        Assert.NotNull(form.ErrorText);
        Assert.True(model.IsItRequestOpen);
        // Значения формы не стираются при ошибке.
        Assert.Equal("HP M404", form.Fields[0].TextValue);

        api.MailItRequestException = null;
        await ((NativeAsyncCommand)form.SendCommand).ExecuteAsync(null);

        Assert.Equal(2, api.MailItRequestSendKeys.Count);
        Assert.False(string.IsNullOrWhiteSpace(api.MailItRequestSendKeys[0]));
        Assert.Equal(api.MailItRequestSendKeys[0], api.MailItRequestSendKeys[1]);
    }

    [Fact]
    public async Task ItRequestCommandBlockedWhenMailNotConfigured()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(
                configureMailbox: mailbox => mailbox.MailIsConfigured = false),
            MailTemplates = [MakeItTemplate()],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.False(model.OpenItRequestCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
        Assert.Equal(0, api.MailTemplatesCallCount);
        Assert.Null(model.ItRequest);
    }

    [Fact]
    public async Task ItRequestCloseCommandHidesOverlay()
    {
        var api = new FakeHubApiClient
        {
            MailBootstrap = Bootstrap(folders: [MakeFolder("inbox", "Входящие")]),
            MailTemplates = [MakeItTemplate()],
        };
        var model = new MailViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenItRequestCommand).ExecuteAsync(null);
        var form = model.ItRequest!;

        form.CloseCommand.Execute(null);

        Assert.False(model.IsItRequestOpen);
        Assert.Null(model.ItRequest);
    }

    private static HubMailTemplate MakeItTemplate() =>
        new()
        {
            Id = "tpl-1",
            Code = "cart",
            Title = "Замена картриджа",
            Category = "Оргтехника",
            IsActive = true,
            Fields =
            [
                new HubMailTemplateField { Key = "comment", Label = "Комментарий", Type = "textarea", Required = false, Order = 1 },
                new HubMailTemplateField { Key = "model", Label = "Модель", Type = "text", Required = true, Order = 0, DefaultValue = JsonDefault("\"HP M404\"") },
                new HubMailTemplateField { Key = "color", Label = "Цвет", Type = "select", Required = true, Order = 2, Options = ["ч/б", "цвет"], DefaultValue = JsonDefault("\"цвет\"") },
                new HubMailTemplateField { Key = "parts", Label = "Узлы", Type = "multiselect", Required = false, Order = 3, Options = ["барабан", "ролик"], DefaultValue = JsonDefault("[\"барабан\"]") },
                new HubMailTemplateField { Key = "due", Label = "Срок", Type = "date", Required = false, Order = 4, DefaultValue = JsonDefault("\"2026-05-04\"") },
                new HubMailTemplateField { Key = "urgent", Label = "Срочно", Type = "checkbox", Required = false, Order = 5 },
                new HubMailTemplateField { Key = "mail", Label = "E-mail", Type = "email", Required = false, Order = 6 },
                new HubMailTemplateField { Key = "phone", Label = "Телефон", Type = "tel", Required = false, Order = 7 },
            ],
        };

    /// <summary>default_value шаблона — сырое JSON; Clone отвязывает от временного документа.</summary>
    private static JsonElement JsonDefault(string json) =>
        JsonDocument.Parse(json).RootElement.Clone();

    private static NativeSession Session() =>
        new(
            "access",
            "refresh",
            "device",
            DateTimeOffset.UtcNow.AddHours(1),
            1,
            "user",
            "Иван Петров");

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

    private static HubMailFolder MakeFolder(
        string id,
        string label,
        int unread = 0,
        string? wellKnown = null)
    {
        // wellKnown по умолчанию совпадает с id для стандартных папок.
        var key = wellKnown ?? (id.StartsWith("custom", StringComparison.Ordinal) ? null : id);
        return new HubMailFolder
        {
            Id = id,
            Label = label,
            Name = label,
            Scope = "mailbox",
            WellKnownKey = key,
            IconKey = key ?? "folder",
            Total = unread + 5,
            Unread = unread,
        };
    }

    private static HubMailMessagePreview MakePreview(
        string id,
        string subject = "Письмо",
        string sender = "sender@zsgp.ru",
        bool isRead = true) =>
        new()
        {
            Id = id,
            MailboxId = "mb-1",
            Folder = "inbox",
            Subject = subject,
            Sender = sender,
            SenderDisplay = "Отправитель",
            ReceivedAt = new DateTimeOffset(2026, 3, 2, 10, 0, 0, TimeSpan.FromHours(3)).ToString("O"),
            IsRead = isRead,
            BodyPreview = "Превью письма",
        };

    private static HubMailBootstrap Bootstrap(
        IReadOnlyList<HubMailFolder>? folders = null,
        IReadOnlyList<HubMailMessagePreview>? items = null,
        int unreadCount = 0,
        int? total = null,
        bool hasMore = false,
        int? nextOffset = null,
        Action<MutableMailbox>? configureMailbox = null)
    {
        var mailbox = new MutableMailbox();
        configureMailbox?.Invoke(mailbox);
        var list = items ?? [];
        return new HubMailBootstrap
        {
            SelectedMailbox = new HubMailMailboxInfo
            {
                Id = "mb-1",
                Label = "user@zsgp.ru",
                MailboxEmail = "user@zsgp.ru",
                IsPrimary = true,
                IsSelected = true,
                IsActive = true,
                MailIsConfigured = mailbox.MailIsConfigured,
                MailRequiresPassword = mailbox.MailRequiresPassword,
                MailRequiresRelogin = mailbox.MailRequiresRelogin,
            },
            UnreadCount = unreadCount,
            FolderTree = new HubMailFolderTree { Items = folders ?? [MakeFolder("inbox", "Входящие")] },
            Messages = new HubMailMessagePage
            {
                Items = list,
                Folder = "inbox",
                Limit = 50,
                Offset = 0,
                Total = total ?? list.Count,
                HasMore = hasMore,
                NextOffset = nextOffset,
            },
            State = "ok",
            Source = "exchange",
        };
    }

    /// <summary>Мутабельные флаги ящика для сценариев «не настроен/ждёт пароль/перелогин».</summary>
    private sealed class MutableMailbox
    {
        public bool MailIsConfigured { get; set; } = true;
        public bool MailRequiresPassword { get; set; }
        public bool MailRequiresRelogin { get; set; }
    }
}
