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
