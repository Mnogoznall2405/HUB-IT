using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeTicketsViewModelTests
{
    // ---- Список: загрузка, фильтры, поиск, пагинация ----

    [Fact]
    public async Task LoadPopulatesItemsFiltersAndStatusBar()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 2,
                Page = 1,
                PageSize = 25,
                TotalPages = 1,
                Items = [Request(1, "Иван Петров"), Request(2, "Мария Сидорова")],
            },
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
        };
        var model = new TicketsViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Иван Петров", model.Items[0].Title);
        Assert.Equal("2", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.False(model.HasMore);
        // Запрос как у веб-листы: submitted_at desc, первая страница 25.
        var query = api.LastTicketQuery;
        Assert.NotNull(query);
        Assert.Equal(1, query!.Page);
        Assert.Equal(25, query.PageSize);
        Assert.Equal("submitted_at", query.SortField);
        Assert.Equal("desc", query.SortDir);
        Assert.Null(query.Statuses);
        Assert.Null(query.ObjectIds);
        Assert.Null(query.Search);
        // Справочник объектов приехал в фильтр: «Все объекты» + Логистика.
        Assert.Equal(2, model.ObjectFilterOptions.Count);
        Assert.Equal("Логистика", model.ObjectFilterOptions[1].Name);
        Assert.Equal(7, model.ObjectFilterOptions[1].Id);
    }

    [Fact]
    public async Task StatusFilterSendsStatusesAndReloads()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(1, "Иван Петров", status: "at_cashier")],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        var statusOption = model.StatusFilterOptions.First(o => o.Value == "at_cashier");

        model.SelectedStatusFilter = statusOption;
        await WaitFor(() => api.LastTicketQuery?.Statuses == "at_cashier");

        Assert.Equal("at_cashier", api.LastTicketQuery!.Statuses);
        Assert.Equal(1, api.LastTicketQuery.Page);
        Assert.Equal("В кассах", model.SelectedStatusFilterText);
    }

    [Fact]
    public async Task ObjectFilterSendsObjectIdsAndReloads()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage { Total = 0, Page = 1, TotalPages = 0, Items = [] },
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectedObjectFilter = model.ObjectFilterOptions[1];
        await WaitFor(() => api.LastTicketQuery?.ObjectIds == "7");

        Assert.Equal("7", api.LastTicketQuery!.ObjectIds);
        Assert.Equal("Логистика", model.SelectedObjectFilterText);
    }

    [Fact]
    public async Task SearchGoesToServerFromTwoChars()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(1, "Иван Петров")],
            },
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "касса";
        await WaitFor(() => api.LastTicketQuery?.Search == "касса");

        Assert.Equal("касса", api.LastTicketQuery!.Search);
    }

    [Fact]
    public async Task SearchShorterThanTwoCharsStaysClientSide()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(1, "Иван Петров")],
            },
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        var calls = api.TicketsCallCount;

        model.SearchText = "и";
        await WaitFor(() => api.TicketsCallCount > calls);

        // Список перечитан, но search-параметр на сервер не ушёл (как в вебе).
        Assert.Null(api.LastTicketQuery!.Search);
    }

    [Fact]
    public async Task LoadMoreAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            TicketsPageFactory = query => query.Page == 1
                ? new HubTicketListPage
                {
                    Total = 2,
                    Page = 1,
                    PageSize = 25,
                    TotalPages = 2,
                    Items = [Request(1, "Иван Петров")],
                }
                : new HubTicketListPage
                {
                    Total = 2,
                    Page = 2,
                    PageSize = 25,
                    TotalPages = 2,
                    Items = [Request(2, "Мария Сидорова")],
                },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);
        Assert.Contains("1", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Items.Count);
        Assert.Equal(2, api.LastTicketQuery!.Page);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task ListFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            TicketsListException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new TicketsViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Карточка: деталь, комментарии, вложения ----

    [Fact]
    public async Task SelectingItemLoadsDetailCommentsAndAttachments()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "at_cashier")],
            },
            TicketDetail = Request(11, "Иван Петров", status: "at_cashier", version: 3),
            TicketCommentsPage = new HubTicketCommentPage
            {
                Total = 2,
                Page = 1,
                Items =
                [
                    Comment(1, 11, "Первый комментарий"),
                    Comment(2, 11, "Статус изменён: not_started → at_cashier", type: "system"),
                ],
            },
            TicketAttachments = new HubTicketAttachmentList
            {
                Items =
                [
                    new HubTicketAttachment
                    {
                        Id = "att-1",
                        RequestId = 11,
                        FileName = "ticket.pdf",
                        FileSize = 2048,
                    },
                ],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 2, Attachments.Count: 1 });

        var detail = model.Detail!;
        Assert.Equal("Заявка №11", detail.Title);
        Assert.Equal("В кассах", detail.StatusText);
        Assert.Equal(3, detail.Version);
        Assert.Equal("Иван Петров", detail.EmployeeText);
        // at_cashier → purchased|cancel_purchase (карта переходов backend'а).
        Assert.Equal(2, detail.StatusActions.Count);
        Assert.Equal("purchased", detail.StatusActions[0].Value);
        Assert.Equal("cancel_purchase", detail.StatusActions[1].Value);
        Assert.Equal("Первый комментарий", detail.Comments[0].Text);
        Assert.True(detail.Comments[1].IsSystem);
        Assert.True(detail.HasAttachments);
        Assert.Equal("ticket.pdf", detail.Attachments[0].Name);
        Assert.False(detail.CanSendComment);
        Assert.True(detail.CanChangeStatus);
    }

    [Fact]
    public async Task TerminalStatusHasNoTransitions()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "refund_needed")],
            },
            TicketDetail = Request(11, "Иван Петров", status: "refund_needed"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.False(model.Detail!.HasStatusActions);
        Assert.False(model.Detail.CanChangeStatus);
        Assert.False(model.ChangeStatusCommand.CanExecute(null));
    }

    [Fact]
    public async Task DetailFailureShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetailException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HasDetailError);

        Assert.Contains("соединения", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Комментарии ----

    [Fact]
    public async Task SendCommentPostsTextAndAppendsToFeed()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketCommentsPage = new HubTicketCommentPage
            {
                Total = 1,
                Page = 1,
                Items = [Comment(1, 11, "Старый")],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 1 });

        model.Detail!.CommentText = "  Новый комментарий  ";
        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        var posted = Assert.Single(api.TicketAddedComments);
        Assert.Equal(11, posted.RequestId);
        // Тело запроса — обрезанный текст (comment_type=normal уходит клиентом).
        Assert.Equal("Новый комментарий", posted.Text);
        Assert.Equal(string.Empty, model.Detail.CommentText);
        Assert.Equal(2, model.Detail.Comments.Count);
        Assert.Equal("Новый комментарий", model.Detail.Comments[1].Text);
        Assert.False(model.Detail.Comments[1].IsSystem);
    }

    [Fact]
    public async Task SendCommentFailureShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketCommentAddException = new HubApiException(HubApiErrorKind.Http, "Нельзя"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        model.Detail!.CommentText = "Привет";
        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        Assert.Empty(api.TicketAddedComments);
        Assert.True(model.HasDetailError);
        Assert.Contains("Нельзя", model.DetailErrorText!, StringComparison.Ordinal);
        // Текст в поле не стёрли — пользователь может повторить отправку.
        Assert.Equal("Привет", model.Detail.CommentText);
    }

    // ---- Смена статуса ----

    [Fact]
    public async Task StatusChangeSendsVersionAndRefreshesFeedAndList()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "at_cashier")],
            },
            TicketDetail = Request(11, "Иван Петров", status: "at_cashier", version: 3),
            TicketCommentsPage = new HubTicketCommentPage
            {
                Total = 1,
                Page = 1,
                Items = [Comment(1, 11, "Старый")],
            },
        };
        // Лента после смены статуса: backend дописывает системный комментарий.
        api.TicketCommentsFactory = _ => api.TicketStatusCalls.Count == 0
            ? api.TicketCommentsPage
            : new HubTicketCommentPage
            {
                Total = 2,
                Page = 1,
                Items =
                [
                    Comment(1, 11, "Старый"),
                    Comment(2, 11, "Статус изменён: at_cashier → purchased", type: "system"),
                ],
            };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 1 });
        var commentsCalls = api.TicketCommentsCalls.Count;

        model.Detail!.StatusComment = "Куплен в кассе";
        await ((NativeAsyncCommand)model.ChangeStatusCommand).ExecuteAsync(model.Detail.StatusActions[0]);

        var call = Assert.Single(api.TicketStatusCalls);
        Assert.Equal(11, call.RequestId);
        Assert.Equal("purchased", call.NewStatus);
        Assert.Equal(3, call.ExpectedVersion);
        Assert.Equal("Куплен в кассе", call.Comment);
        // Карточка и строка списка обновлены без перечитывания списка.
        Assert.Equal("Куплен", model.Detail.StatusText);
        Assert.Equal("Куплен", model.Items[0].StatusText);
        // Лента перечитана: появился системный комментарий.
        Assert.True(api.TicketCommentsCalls.Count > commentsCalls);
        Assert.Equal(2, model.Detail.Comments.Count);
        Assert.True(model.Detail.Comments[1].IsSystem);
        // purchased → exchange_needed|refund_needed.
        Assert.Equal(2, model.Detail.StatusActions.Count);
        Assert.True(model.HasStatusInfo);
        Assert.Contains("Куплен", model.StatusInfoText!, StringComparison.Ordinal);
        // Поле комментария к статусу очищено.
        Assert.Null(model.Detail.StatusComment);
    }

    [Fact]
    public async Task StatusConflictShowsCardErrorAndRefreshesDetail()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "at_cashier")],
            },
            TicketDetail = Request(11, "Иван Петров", status: "at_cashier", version: 3),
            TicketStatusException = new HubApiException(
                HubApiErrorKind.Http, "Version conflict", System.Net.HttpStatusCode.Conflict),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);
        var detailCalls = api.TicketDetailCalls.Count;

        await ((NativeAsyncCommand)model.ChangeStatusCommand).ExecuteAsync(model.Detail!.StatusActions[0]);
        await WaitFor(() => api.TicketDetailCalls.Count > detailCalls);

        Assert.True(model.HasDetailError);
        Assert.Contains("Version conflict", model.DetailErrorText!, StringComparison.Ordinal);
        // Карточка перечитана после конфликта версии.
        Assert.Equal(11, api.TicketDetailCalls.Last());
    }

    // ---- Вложения ----

    [Fact]
    public async Task AttachmentChipRoutesThroughSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = new HubTicketAttachmentList
            {
                Items =
                [
                    new HubTicketAttachment
                    {
                        Id = "att-1",
                        RequestId = 11,
                        FileName = "ticket.pdf",
                        FileSize = 2048,
                    },
                ],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });

        var saved = new List<(string AttachmentId, long RequestId)>();
        model.AttachmentSaver = (item, requestId) =>
        {
            saved.Add((item.AttachmentId, requestId));
            return Task.CompletedTask;
        };

        var chip = model.Detail!.Attachments[0];
        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(chip);
        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(chip);

        Assert.Equal(2, saved.Count);
        Assert.All(saved, entry =>
        {
            Assert.Equal("att-1", entry.AttachmentId);
            Assert.Equal(11, entry.RequestId);
        });
        Assert.Empty(api.TicketAttachmentDownloads);
    }

    [Fact]
    public async Task DetailAttachUploadsAndAddsChip()
    {
        var file = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"ticket-detail-{Guid.NewGuid():N}.pdf");
        await File.WriteAllTextAsync(file, "%PDF-1.4 fake");
        try
        {
            var api = new FakeHubApiClient
            {
                CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
                TicketsPage = new HubTicketListPage
                {
                    Total = 1,
                    Page = 1,
                    TotalPages = 1,
                    Items = [Request(11, "Иван Петров")],
                },
                TicketDetail = Request(11, "Иван Петров"),
            };
            var model = new TicketsViewModel(api)
            {
                DetailFilePicker = () => [file],
            };
            await model.LoadAsync();
            model.SelectedItem = model.Items[0];
            await WaitFor(() => model.Detail is not null);
            Assert.True(model.CanWriteTickets);
            Assert.True(model.Detail!.CanWrite);
            Assert.True(model.Detail.CanAttach);
            Assert.Empty(model.Detail.Attachments);

            await ((NativeAsyncCommand)model.AttachDetailFilesCommand).ExecuteAsync(null);

            // POST …/attachments по id заявки — имя файла и file_type как в форме создания.
            var upload = Assert.Single(api.TicketUploads);
            Assert.Equal(11, upload.RequestId);
            Assert.Equal(System.IO.Path.GetFileName(file), upload.FileName);
            Assert.Equal("other", upload.FileType);
            // Чип свежего файла дописан в секцию без перечитывания списка.
            var chip = Assert.Single(model.Detail.Attachments);
            Assert.Equal(System.IO.Path.GetFileName(file), chip.Name);
            Assert.False(model.HasDetailError);
            Assert.False(model.Detail.IsAttachmentBusy);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task DetailAttachFailureShowsCardErrorAndKeepsCard()
    {
        var file = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"ticket-detail-{Guid.NewGuid():N}.pdf");
        await File.WriteAllTextAsync(file, "%PDF-1.4 fake");
        try
        {
            var api = new FakeHubApiClient
            {
                CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
                TicketsPage = new HubTicketListPage
                {
                    Total = 1,
                    Page = 1,
                    TotalPages = 1,
                    Items = [Request(11, "Иван Петров")],
                },
                TicketDetail = Request(11, "Иван Петров"),
                TicketUploadException = new HubApiException(
                    HubApiErrorKind.Http, "Лимит файлов исчерпан"),
            };
            var model = new TicketsViewModel(api)
            {
                DetailFilePicker = () => [file],
            };
            await model.LoadAsync();
            model.SelectedItem = model.Items[0];
            await WaitFor(() => model.Detail is not null);

            await ((NativeAsyncCommand)model.AttachDetailFilesCommand).ExecuteAsync(null);

            // Ошибка — текстом в карточке; карточка и реквизиты живы, чипов не прибавилось.
            Assert.Single(api.TicketUploads);
            Assert.True(model.HasDetailError);
            Assert.Contains("не удалось", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("Лимит файлов", model.DetailErrorText!, StringComparison.Ordinal);
            Assert.NotNull(model.Detail);
            Assert.Empty(model.Detail!.Attachments);
            Assert.False(model.Detail.IsAttachmentBusy);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task DetailAttachSkipsDisallowedExtension()
    {
        var file = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"ticket-detail-{Guid.NewGuid():N}.exe");
        await File.WriteAllTextAsync(file, "MZ fake");
        try
        {
            var api = new FakeHubApiClient
            {
                CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
                TicketsPage = new HubTicketListPage
                {
                    Total = 1,
                    Page = 1,
                    TotalPages = 1,
                    Items = [Request(11, "Иван Петров")],
                },
                TicketDetail = Request(11, "Иван Петров"),
            };
            var model = new TicketsViewModel(api)
            {
                DetailFilePicker = () => [file],
            };
            await model.LoadAsync();
            model.SelectedItem = model.Items[0];
            await WaitFor(() => model.Detail is not null);

            await ((NativeAsyncCommand)model.AttachDetailFilesCommand).ExecuteAsync(null);

            // Формат вне белого списка backend'а на сервер не уходит.
            Assert.Empty(api.TicketUploads);
            Assert.True(model.HasDetailError);
            Assert.Contains("формат", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task DetailDeleteAttachmentArmsThenRemovesChipAndRefreshesHistory()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = ["tickets.write"],
            },
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = new HubTicketAttachmentList
            {
                Items =
                [
                    new HubTicketAttachment { Id = "att-1", RequestId = 11, FileName = "ticket.pdf" },
                    new HubTicketAttachment { Id = "att-2", RequestId = 11, FileName = "check.pdf" },
                ],
            },
            TicketHistory = new HubTicketHistoryPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [HistoryEntry(9, 11, "status", "not_started", "at_cashier")],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 2 });
        var historyCalls = api.TicketHistoryCalls.Count;

        var first = model.Detail!.Attachments[0];
        // Первый клик — только подтверждение, запроса нет.
        await ((NativeAsyncCommand)model.DeleteAttachmentCommand).ExecuteAsync(first);
        Assert.Empty(api.TicketAttachmentDeletes);
        Assert.True(first.DeleteArmed);
        Assert.Equal("Удалить?", first.DeleteText);
        Assert.Equal(2, model.Detail.Attachments.Count);

        // Armed одновременно у одного чипа: новое нажатие снимает предыдущее.
        var second = model.Detail.Attachments[1];
        await ((NativeAsyncCommand)model.DeleteAttachmentCommand).ExecuteAsync(second);
        Assert.False(first.DeleteArmed);
        Assert.True(second.DeleteArmed);
        Assert.Empty(api.TicketAttachmentDeletes);

        // Повторный клик по armed-чипу — DELETE и локальное снятие.
        await ((NativeAsyncCommand)model.DeleteAttachmentCommand).ExecuteAsync(second);
        Assert.Equal((11, "att-2"), Assert.Single(api.TicketAttachmentDeletes));
        var remaining = Assert.Single(model.Detail.Attachments);
        Assert.Equal("att-1", remaining.AttachmentId);
        Assert.False(model.HasDetailError);
        // Backend пишет attachment_deleted — лента истории перечитана.
        Assert.True(api.TicketHistoryCalls.Count > historyCalls);
        Assert.Equal((11, 1), api.TicketHistoryCalls.Last());
    }

    [Fact]
    public async Task DetailDeleteAttachmentFailureKeepsChipAndShowsError()
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = new HubTicketAttachmentList
            {
                Items =
                [
                    new HubTicketAttachment { Id = "att-1", RequestId = 11, FileName = "ticket.pdf" },
                ],
            },
            TicketAttachmentDeleteException = new HubApiException(
                HubApiErrorKind.Http, "Файл недоступен"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });
        var chip = model.Detail!.Attachments[0];

        await ((NativeAsyncCommand)model.DeleteAttachmentCommand).ExecuteAsync(chip);
        await ((NativeAsyncCommand)model.DeleteAttachmentCommand).ExecuteAsync(chip);

        // Сбой DELETE: чип на месте, armed снят, ошибка — в карточке.
        Assert.Single(api.TicketAttachmentDeletes);
        Assert.Single(model.Detail.Attachments);
        Assert.False(chip.DeleteArmed);
        Assert.False(chip.IsDeleteBusy);
        Assert.True(model.HasDetailError);
        Assert.Contains("Файл недоступен", model.DetailErrorText!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task AttachAndDeleteFollowTicketsWritePermission()
    {
        HubTicketListPage ListPage() => new()
        {
            Total = 1,
            Page = 1,
            TotalPages = 1,
            Items = [Request(11, "Иван Петров")],
        };
        HubTicketAttachmentList Attachments() => new()
        {
            Items =
            [
                new HubTicketAttachment { Id = "att-1", RequestId = 11, FileName = "ticket.pdf" },
            ],
        };

        // Без tickets.write и admin — «Прикрепить»/«✕» недоступны (как hasPermission в вебе).
        var readOnly = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "reader",
                Role = "operator",
                Permissions = ["tickets.read"],
            },
            TicketsPage = ListPage(),
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = Attachments(),
        };
        var readModel = new TicketsViewModel(readOnly)
        {
            DetailFilePicker = () => ["x.pdf"],
        };
        await readModel.LoadAsync();
        readModel.SelectedItem = readModel.Items[0];
        await WaitFor(() => readModel.Detail is { Attachments.Count: 1 });

        Assert.False(readModel.CanWriteTickets);
        Assert.False(readModel.Detail!.CanWrite);
        Assert.False(readModel.Detail.CanAttach);
        Assert.False(readModel.AttachDetailFilesCommand.CanExecute(null));
        var readChip = readModel.Detail.Attachments[0];
        Assert.False(readModel.DeleteAttachmentCommand.CanExecute(readChip));

        // Блокированная команда не исполняется: picker и API не вызываются.
        await ((NativeAsyncCommand)readModel.AttachDetailFilesCommand).ExecuteAsync(null);
        Assert.Empty(readOnly.TicketUploads);
        await ((NativeAsyncCommand)readModel.DeleteAttachmentCommand).ExecuteAsync(readChip);
        Assert.Empty(readOnly.TicketAttachmentDeletes);
        Assert.False(readChip.DeleteArmed);

        // Явное право — кнопки доступны.
        var writer = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = ["tickets.write"],
            },
            TicketsPage = ListPage(),
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = Attachments(),
        };
        var writerModel = new TicketsViewModel(writer);
        await writerModel.LoadAsync();
        writerModel.SelectedItem = writerModel.Items[0];
        await WaitFor(() => writerModel.Detail is { Attachments.Count: 1 });

        Assert.True(writerModel.CanWriteTickets);
        Assert.True(writerModel.Detail!.CanWrite);
        Assert.True(writerModel.Detail.CanAttach);
        Assert.True(writerModel.AttachDetailFilesCommand.CanExecute(null));
        Assert.True(writerModel.DeleteAttachmentCommand.CanExecute(writerModel.Detail.Attachments[0]));

        // Admin — без явного права, как в матрице веба.
        var admin = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
            TicketsPage = ListPage(),
            TicketDetail = Request(11, "Иван Петров"),
            TicketAttachments = Attachments(),
        };
        var adminModel = new TicketsViewModel(admin);
        await adminModel.LoadAsync();
        adminModel.SelectedItem = adminModel.Items[0];
        await WaitFor(() => adminModel.Detail is not null);

        Assert.True(adminModel.CanWriteTickets);
        Assert.True(adminModel.Detail!.CanWrite);
    }

    // ---- История изменений ----

    [Fact]
    public async Task SelectingItemLoadsHistoryFeed()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "at_cashier")],
            },
            TicketDetail = Request(11, "Иван Петров", status: "at_cashier"),
            TicketHistory = new HubTicketHistoryPage
            {
                Total = 2,
                Page = 1,
                PageSize = 20,
                TotalPages = 1,
                Items =
                [
                    HistoryEntry(9, 11, "status", "not_started", "at_cashier",
                        comment: "Согласовано", createdAt: "2026-11-11T15:30:00"),
                    HistoryEntry(8, 11, "route", "Сургут", null,
                        createdAt: "2026-11-10T09:00:00"),
                ],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { HistoryEntries.Count: 2 });

        // Первый запрос — первая страница истории именно этой заявки.
        var call = Assert.Single(api.TicketHistoryCalls);
        Assert.Equal((11, 1), call);
        var detail = model.Detail!;
        // Статусы хранятся кодами — подписи, как в пилюле; поле — по-русски.
        Assert.Equal("Статус", detail.HistoryEntries[0].FieldText);
        Assert.Equal("Статус: Не запущен → В кассах", detail.HistoryEntries[0].ChangeText);
        Assert.Equal("Согласовано", detail.HistoryEntries[0].CommentText);
        Assert.Equal("11.11.2026 15:30", detail.HistoryEntries[0].MetaText);
        // Пустое новое значение — «—».
        Assert.Equal("Маршрут: Сургут → —", detail.HistoryEntries[1].ChangeText);
        Assert.Equal(string.Empty, detail.HistoryEntries[1].CommentText);
        Assert.False(detail.HasMoreHistory);
        Assert.False(detail.HistoryFailed);
        Assert.False(detail.ShowHistoryEmpty);
    }

    [Fact]
    public async Task HistoryLoadMoreAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketHistoryFactory = (_, page) => page == 1
                ? new HubTicketHistoryPage
                {
                    Total = 3,
                    Page = 1,
                    PageSize = 20,
                    TotalPages = 2,
                    Items =
                    [
                        HistoryEntry(3, 11, "status", "not_started", "at_cashier"),
                        HistoryEntry(2, 11, "note", null, "Командировка"),
                    ],
                }
                : new HubTicketHistoryPage
                {
                    Total = 3,
                    Page = 2,
                    PageSize = 20,
                    TotalPages = 2,
                    Items = [HistoryEntry(1, 11, "total_cost", "0.00", "15000.00")],
                },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { HistoryEntries.Count: 2 });

        Assert.True(model.Detail!.HasMoreHistory);
        Assert.Equal("Показать ещё", model.Detail.HistoryMoreText);
        Assert.True(model.LoadMoreHistoryCommand.CanExecute(null));

        await ((NativeAsyncCommand)model.LoadMoreHistoryCommand).ExecuteAsync(null);

        // Вторая страница дописана в конец ленты, страниц больше нет.
        Assert.Equal(3, model.Detail.HistoryEntries.Count);
        Assert.Equal((11, 2), api.TicketHistoryCalls.Last());
        Assert.False(model.Detail.HasMoreHistory);
        Assert.False(model.Detail.CanLoadMoreHistory);
        // Суммы форматируются деньгами — как в реквизитах карточки.
        var costEntry = model.Detail.HistoryEntries[2];
        Assert.StartsWith("Стоимость: ", costEntry.ChangeText, StringComparison.Ordinal);
        Assert.EndsWith("₽", costEntry.ChangeText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task HistoryFailureMarksSectionAndKeepsDetailAlive()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketCommentsPage = new HubTicketCommentPage
            {
                Total = 1,
                Page = 1,
                Items = [Comment(1, 11, "Старый")],
            },
            TicketHistoryException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { HistoryFailed: true });

        // Тихий сбой: карточка и комментарии живы, ошибка карточки не тронута.
        var detail = model.Detail!;
        Assert.Single(detail.Comments);
        Assert.Empty(detail.HistoryEntries);
        Assert.False(detail.ShowHistoryEmpty);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task SwitchingRequestReloadsHistory()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 2,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров"), Request(12, "Мария Сидорова")],
            },
            TicketDetailFactory = id => Request(id, id == 11 ? "Иван Петров" : "Мария Сидорова"),
            TicketHistoryFactory = (requestId, _) => new HubTicketHistoryPage
            {
                Page = 1,
                TotalPages = 1,
                Items = [HistoryEntry(requestId, requestId, "route", "Сургут", "Москва")],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Id: 11, HistoryEntries.Count: 1 });

        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is { Id: 12, HistoryEntries.Count: 1 });

        // Лента принадлежит новой заявке — записей предыдущей нет.
        var entry = Assert.Single(model.Detail!.HistoryEntries);
        Assert.Equal(12, entry.Id);
        Assert.Equal((12, 1), api.TicketHistoryCalls.Last());
        Assert.False(model.Detail.HistoryFailed);
        Assert.False(model.Detail.ShowHistoryEmpty);
    }

    // ---- Создание заявки ----

    [Fact]
    public async Task EmployeeSearchMergesLocalAndZupOptions()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
            TicketEmployeesPage = new HubTicketEmployeePage
            {
                Items =
                [
                    new HubTicketEmployee { Id = 1, FullName = "Иван Петров", ZupEmployeeCode = "Z-1" },
                    new HubTicketEmployee { Id = 2, FullName = "Мария Локал" },
                ],
            },
            TicketZupPersons = new HubTicketZupPersonList
            {
                Items =
                [
                    // Дубли по коду и ФИО прячутся — как employeeOptions в веб-диалоге.
                    new HubTicketZupPerson { FullName = "Иван Петров", EmployeeCode = "Z-1" },
                    new HubTicketZupPerson { FullName = "Мария Локал", EmployeeCode = "Z-2" },
                    new HubTicketZupPerson { FullName = "Олег Зупов", EmployeeCode = "Z-3", Position = "Инженер" },
                ],
            },
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;

        create.EmployeeQuery = "ива";
        await WaitFor(() => create.EmployeeOptions.Count == 3);

        Assert.Equal("ива", Assert.Single(api.TicketEmployeesSearches));
        Assert.Equal("ива", Assert.Single(api.TicketZupSearches));
        Assert.Equal(2, create.EmployeeOptions.Count(option => !option.IsZup));
        var zupOnly = Assert.Single(create.EmployeeOptions, option => option.IsZup);
        Assert.Equal("Олег Зупов", zupOnly.Title);
        Assert.Contains("ЗУП", zupOnly.MetaText, StringComparison.Ordinal);

        // Меньше 2 символов — повторных запросов нет, список скрыт.
        create.EmployeeQuery = "и";
        await WaitFor(() => create.EmployeeOptions.Count == 0);
        Assert.Single(api.TicketEmployeesSearches);
    }

    [Fact]
    public async Task CreatePostsBodyAndSelectsNewItem()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Старая Заявка")],
            },
            TicketObjects = new HubTicketObjectList
            {
                Items =
                [
                    new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" },
                    new HubTicketObject { Id = 8, Code = "OFF", Name = "Склад", IsActive = false },
                ],
            },
            TicketEmployeesPage = new HubTicketEmployeePage
            {
                Items = [new HubTicketEmployee { Id = 42, FullName = "Иван Петров", ZupEmployeeCode = "Z-42" }],
            },
            TicketZupPersons = new HubTicketZupPersonList { Items = [] },
            TicketCreateResult = Request(600, "Иван Петров"),
            TicketDetail = Request(600, "Иван Петров"),
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;
        Assert.NotNull(create);
        // Неактивные объекты в форму не попадают — как в веб-диалоге.
        Assert.Single(create.Objects);
        Assert.Equal("Логистика (LG)", create.Objects[0].DisplayName);

        create.EmployeeQuery = "ива";
        await WaitFor(() => create.EmployeeOptions.Count == 1);
        create.SelectEmployeeCommand.Execute(create.EmployeeOptions[0]);
        create.SelectedObject = create.Objects[0];
        create.DepartureDate = new DateTime(2026, 12, 1);
        create.ArrivalDate = new DateTime(2026, 12, 5);
        create.RouteText = "  Сургут  ";
        create.NoteText = "Командировка";
        create.IsUrgent = true;
        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        var body = Assert.Single(api.TicketCreateCalls);
        Assert.Equal(42, body.EmployeeId);
        Assert.Equal(7, body.ObjectId);
        Assert.Equal("not_started", body.Status);
        Assert.Equal("manual", body.Source);
        Assert.Equal("2026-12-01", body.DepartureDate);
        Assert.Equal("2026-12-05", body.ArrivalDate);
        Assert.Equal("Сургут", body.Route);
        Assert.Equal("Командировка", body.Note);
        Assert.True(body.IsUrgent);
        Assert.Matches(@"^\d{4}-\d{2}-\d{2}$", body.SubmittedAt);
        // Local-сотрудник уже в справочнике — импорт из ЗУП не нужен.
        Assert.Empty(api.TicketEnsureZupCalls);

        // Панель закрыта, новая заявка сверху списка и выбрана.
        Assert.False(model.IsCreateOpen);
        Assert.Equal(2, model.Items.Count);
        Assert.Equal(600, model.Items[0].Id);
        Assert.Same(model.Items[0], model.SelectedItem);
        await WaitFor(() => model.Detail is not null);
        Assert.Equal(600, model.Detail!.Id);
        Assert.True(model.HasStatusInfo);
        Assert.Contains("600", model.StatusInfoText!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CreateValidationBlocksMissingRequired()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
            TicketEmployeesPage = new HubTicketEmployeePage
            {
                Items = [new HubTicketEmployee { Id = 42, FullName = "Иван Петров" }],
            },
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;

        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        Assert.Empty(api.TicketCreateCalls);
        Assert.True(create.HasError);
        Assert.Contains("сотрудник", create.ErrorText!, StringComparison.OrdinalIgnoreCase);

        // Сотрудник выбран, объект — нет: вторая обязательная проверка.
        create.EmployeeQuery = "ива";
        await WaitFor(() => create.EmployeeOptions.Count == 1);
        create.SelectEmployeeCommand.Execute(create.EmployeeOptions[0]);
        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        Assert.Empty(api.TicketCreateCalls);
        Assert.True(create.HasError);
        Assert.Contains("объект", create.ErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.True(model.IsCreateOpen);
    }

    [Fact]
    public async Task CreateFailureShowsFormErrorAndKeepsFields()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
            TicketEmployeesPage = new HubTicketEmployeePage
            {
                Items = [new HubTicketEmployee { Id = 42, FullName = "Иван Петров" }],
            },
            TicketCreateException = new HubApiException(HubApiErrorKind.Http, "Сотрудник не найден"),
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;
        create.EmployeeQuery = "ива";
        await WaitFor(() => create.EmployeeOptions.Count == 1);
        create.SelectEmployeeCommand.Execute(create.EmployeeOptions[0]);
        create.SelectedObject = create.Objects[0];
        create.RouteText = "Сургут";

        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        Assert.Single(api.TicketCreateCalls);
        Assert.True(create.HasError);
        Assert.Contains("Сотрудник не найден", create.ErrorText!, StringComparison.Ordinal);
        // Панель открыта, поля на месте — можно исправить и повторить.
        Assert.True(model.IsCreateOpen);
        Assert.NotNull(create.SelectedEmployee);
        Assert.NotNull(create.SelectedObject);
        Assert.Equal("Сургут", create.RouteText);
    }

    [Fact]
    public async Task CreateWithZupEmployeeImportsCodeFirst()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
            TicketZupPersons = new HubTicketZupPersonList
            {
                Items = [new HubTicketZupPerson { FullName = "Пётр Зупов", EmployeeCode = "Z-77" }],
            },
            TicketEnsureZupResult = new HubTicketEmployee
            {
                Id = 77,
                FullName = "Пётр Зупов",
                ZupEmployeeCode = "Z-77",
            },
            TicketCreateResult = Request(601, "Пётр Зупов"),
        };
        var model = new TicketsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;
        create.EmployeeQuery = "пёт";
        await WaitFor(() => create.EmployeeOptions.Count == 1);
        create.SelectEmployeeCommand.Execute(create.EmployeeOptions[0]);
        create.SelectedObject = create.Objects[0];

        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        // ЗУП-сотрудник импортируется в справочник билетов, заявка идёт с его id.
        Assert.Equal("Z-77", Assert.Single(api.TicketEnsureZupCalls));
        var body = Assert.Single(api.TicketCreateCalls);
        Assert.Equal(77, body.EmployeeId);
        Assert.False(model.IsCreateOpen);
    }

    [Fact]
    public async Task CreateUploadsFilesAfterCreate()
    {
        var file = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), $"ticket-{Guid.NewGuid():N}.pdf");
        await File.WriteAllTextAsync(file, "%PDF-1.4 fake");
        try
        {
            var api = new FakeHubApiClient
            {
                TicketObjects = new HubTicketObjectList
                {
                    Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
                },
                TicketEmployeesPage = new HubTicketEmployeePage
                {
                    Items = [new HubTicketEmployee { Id = 42, FullName = "Иван Петров" }],
                },
                TicketCreateResult = Request(602, "Иван Петров"),
            };
            var model = new TicketsViewModel(api)
            {
                DelayAsync = (_, _) => Task.CompletedTask,
                CreateFilePicker = () => [file],
            };
            await model.LoadAsync();
            await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
            var create = model.Create!;

            create.AttachCommand.Execute(null);
            var chip = Assert.Single(create.Files);
            Assert.Equal(System.IO.Path.GetFileName(file), chip.Name);
            Assert.True(chip.Size > 0);

            create.EmployeeQuery = "ива";
            await WaitFor(() => create.EmployeeOptions.Count == 1);
            create.SelectEmployeeCommand.Execute(create.EmployeeOptions[0]);
            create.SelectedObject = create.Objects[0];
            await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

            // Контракт требует id заявки: файл уходит POST …/attachments после создания.
            var upload = Assert.Single(api.TicketUploads);
            Assert.Equal(602, upload.RequestId);
            Assert.Equal(System.IO.Path.GetFileName(file), upload.FileName);
            Assert.Equal("other", upload.FileType);
            Assert.True(upload.Size > 0);
            Assert.False(model.IsCreateOpen);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public async Task CancelCreateClosesFormWithoutPosting()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.NewTicketCommand).ExecuteAsync(null);
        var create = model.Create!;
        Assert.NotNull(create);
        Assert.True(model.IsCreateOpen);

        create.CloseCommand.Execute(null);

        Assert.False(model.IsCreateOpen);
        Assert.Empty(api.TicketCreateCalls);
    }

    // ---- Режимы: Канбан и Дашборд ----

    [Fact]
    public async Task KanbanModeLoadsBoardLazilyInBackendColumnOrder()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketKanban = new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>(StringComparer.Ordinal)
            {
                ["Не запущен"] = [KanbanCard(21, "Иван Петров", "not_started")],
                ["В кассах"] = [KanbanCard(22, "Мария Сидорова", "at_cashier")],
                ["Проблема"] = [KanbanCard(23, "Пётр Проблемный", "at_cashier", urgent: true)],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        // Ленивая загрузка: в режиме списка запроса к канбану нет.
        Assert.Empty(api.TicketKanbanCalls);
        Assert.Empty(model.KanbanColumns);

        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);

        Assert.True(model.IsKanbanMode);
        Assert.False(model.IsListMode);
        Assert.False(model.IsDashboardMode);
        var call = Assert.Single(api.TicketKanbanCalls);
        Assert.Null(call.ObjectIds);
        Assert.Null(call.AssigneeIds);
        // Шесть колонок в порядке backend'а, пустые тоже видны.
        Assert.Equal(
            new[] { "Не запущен", "В кассах", "Куплен", "Возврат/обмен", "Отмена", "Проблема" },
            model.KanbanColumns.Select(column => column.Title).ToArray());
        Assert.Equal(21, model.KanbanColumns[0].Cards[0].Id);
        Assert.Equal(22, model.KanbanColumns[1].Cards[0].Id);
        Assert.Empty(model.KanbanColumns[2].Cards);
        Assert.Equal("0", model.KanbanColumns[2].CountText);
        Assert.Equal(23, model.KanbanColumns[5].Cards[0].Id);
        var card = model.KanbanColumns[0].Cards[0];
        Assert.Equal("Иван Петров", card.Title);
        Assert.Equal("Логистика", card.ObjectText);
        Assert.Equal("Не запущен", card.StatusText);
        Assert.Equal("Пётр Исполнитель", card.AssigneeText);
        Assert.True(model.KanbanColumns[5].Cards[0].IsUrgent);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task EmptyKanbanStillShowsAllColumns()
    {
        var api = new FakeHubApiClient();
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);

        Assert.Equal(6, model.KanbanColumns.Count);
        Assert.Equal(
            new[] { "Не запущен", "В кассах", "Куплен", "Возврат/обмен", "Отмена", "Проблема" },
            model.KanbanColumns.Select(column => column.Title).ToArray());
        Assert.All(model.KanbanColumns, column => Assert.Empty(column.Cards));
    }

    [Fact]
    public async Task KanbanCardClickLoadsSameDetailAsList()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров", status: "at_cashier")],
            },
            TicketKanban = new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>(StringComparer.Ordinal)
            {
                ["Не запущен"] = [KanbanCard(77, "Внешняя Заявка", "not_started")],
                ["В кассах"] = [KanbanCard(11, "Иван Петров", "at_cashier")],
            },
            TicketDetailFactory = id => Request(id, "Иван Петров", status: "at_cashier"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);

        // Заявка вне текущей выдачи списка: карточка грузится по id напрямую,
        // панель-оверлей поверх доски появляется.
        var foreign = model.KanbanColumns[0].Cards[0];
        model.SelectKanbanCardCommand.Execute(foreign);
        await WaitFor(() => model.Detail is not null);

        Assert.Equal(77, model.Detail!.Id);
        Assert.Contains(77, api.TicketDetailCalls);
        Assert.Null(model.SelectedItem);
        Assert.True(model.ShowSidePanel);

        // Заявка из списка: выделяется та же строка — флоу карточки общий.
        var own = model.KanbanColumns[1].Cards[0];
        model.SelectKanbanCardCommand.Execute(own);
        await WaitFor(() => model.Detail is { Id: 11 });

        Assert.Same(model.Items[0], model.SelectedItem);
        Assert.Contains(11, api.TicketDetailCalls);

        // «✕» скрывает оверлей — доска остаётся.
        model.CloseDetailCommand.Execute(null);
        Assert.False(model.ShowSidePanel);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
    }

    [Fact]
    public async Task ObjectFilterInKanbanGoesToObjectIds()
    {
        var api = new FakeHubApiClient
        {
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);
        Assert.Null(api.TicketKanbanCalls[0].ObjectIds);

        model.SelectedObjectFilter = model.ObjectFilterOptions[1];
        await WaitFor(() => api.TicketKanbanCalls.Count == 2);

        // Фильтр объекта в канбане идёт в object_ids, список при этом не трогаем.
        Assert.Equal("7", api.TicketKanbanCalls[1].ObjectIds);
        Assert.Equal(1, api.TicketsCallCount);
    }

    [Fact]
    public async Task RefreshInKanbanReloadsBoardNotList()
    {
        var api = new FakeHubApiClient();
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        var listCalls = api.TicketsCallCount;
        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal(2, api.TicketKanbanCalls.Count);
        Assert.Equal(listCalls, api.TicketsCallCount);
    }

    [Fact]
    public async Task KanbanFailureShowsBannerAndKeepsBoard()
    {
        var api = new FakeHubApiClient
        {
            TicketKanban = new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>(StringComparer.Ordinal)
            {
                ["Не запущен"] = [KanbanCard(21, "Иван Петров", "not_started")],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);
        Assert.Equal(6, model.KanbanColumns.Count);

        api.TicketKanbanException = new HubApiException(HubApiErrorKind.Transport, "down");
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        // Best-effort как у списка: баннер с текстом, загруженная доска не стёрта.
        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(6, model.KanbanColumns.Count);
        Assert.Equal(21, model.KanbanColumns[0].Cards[0].Id);
    }

    [Fact]
    public async Task DashboardModeLoadsSummaryLazily()
    {
        var api = new FakeHubApiClient
        {
            TicketDashboard = new HubTicketsDashboard
            {
                Metrics = new HubTicketsDashboardMetrics
                {
                    TotalActive = 12,
                    New = 3,
                    InProgress = 4,
                    Purchased = 5,
                    Problematic = 2,
                    DeparturesToday = 1,
                    DeparturesTomorrow = 2,
                    Departures3Days = 3,
                    RefundsExchanges = 1,
                    TicketSum = "150000.00",
                    LossSum = "5000.00",
                },
                PerObject =
                [
                    new HubTicketsDashboardObject
                    {
                        ObjectId = 7,
                        ObjectName = "Логистика",
                        ObjectCode = "LG",
                        Active = 8,
                        New = 2,
                        InProgress = 4,
                        Problematic = 1,
                        TicketSum = "90000.00",
                        LossSum = "0.00",
                        NearestDeparture = "2026-11-20",
                    },
                ],
                TopProblems =
                [
                    new HubTicketsDashboardObject
                    {
                        ObjectId = 7,
                        ObjectName = "Логистика",
                        Problematic = 1,
                    },
                ],
                TopAssignees =
                [
                    new HubTicketsDashboardAssignee
                    {
                        AssigneeId = 5,
                        AssigneeName = "Пётр Исполнитель",
                        ActiveCount = 4,
                    },
                ],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        // Ленивая загрузка: в режиме списка запроса к сводке нет.
        Assert.Equal(0, api.TicketDashboardCalls);

        model.SelectViewModeCommand.Execute("dashboard");
        await WaitFor(() => api.TicketDashboardCalls == 1);

        Assert.True(model.IsDashboardMode);
        Assert.False(model.IsListMode);
        // 11 метрик-карточек — как сетка Metric в веб-дашборде.
        Assert.Equal(11, model.DashboardMetrics.Count);
        Assert.Equal("Активные", model.DashboardMetrics[0].Label);
        Assert.Equal("12", model.DashboardMetrics[0].Value);
        Assert.Equal("Возвраты/обмены", model.DashboardMetrics[8].Label);
        Assert.Equal("Сумма билетов", model.DashboardMetrics[9].Label);
        Assert.Contains("150", model.DashboardMetrics[9].Value, StringComparison.Ordinal);
        var row = Assert.Single(model.DashboardObjects);
        Assert.Equal("Логистика", row.Title);
        Assert.Equal("LG", row.CodeText);
        Assert.Equal("8", row.ActiveText);
        Assert.Equal("Новые 2", row.NewText);
        Assert.Equal("Работа 4", row.InProgressText);
        Assert.Equal("Проблемы 1", row.ProblematicText);
        Assert.True(row.HasProblems);
        Assert.Contains("Билеты:", row.TicketSumText, StringComparison.Ordinal);
        Assert.Contains("20.11.2026", row.NearestDepartureText, StringComparison.Ordinal);
        var problem = Assert.Single(model.DashboardTopProblems);
        Assert.Equal("Логистика", problem.Title);
        Assert.Equal("1", problem.ValueText);
        Assert.True(problem.IsWarning);
        var assignee = Assert.Single(model.DashboardTopAssignees);
        Assert.Equal("Пётр Исполнитель", assignee.Title);
        Assert.Equal("4", assignee.ValueText);
        Assert.False(assignee.IsWarning);
        Assert.True(model.HasDashboardObjects);
        Assert.False(model.HasBannerError);
        Assert.False(model.ShowSidePanel);

        // «Обновить» в сводке перечитывает сводку, а не список.
        var listCalls = api.TicketsCallCount;
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);
        Assert.Equal(2, api.TicketDashboardCalls);
        Assert.Equal(listCalls, api.TicketsCallCount);
    }

    [Fact]
    public async Task DashboardFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            TicketDashboardException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();

        model.SelectViewModeCommand.Execute("dashboard");
        await WaitFor(() => api.TicketDashboardCalls == 1);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(model.DashboardMetrics);
        Assert.False(model.HasDashboardObjects);
    }

    [Fact]
    public async Task BackToListModeRestoresListWithoutKanbanCalls()
    {
        var api = new FakeHubApiClient();
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        var listCalls = api.TicketsCallCount;
        model.SelectViewModeCommand.Execute("kanban");
        await WaitFor(() => api.TicketKanbanCalls.Count == 1);

        model.SelectViewModeCommand.Execute("list");

        Assert.True(model.IsListMode);
        Assert.True(model.ShowSidePanel);
        // Возврат в список не гоняет ни список, ни доску — данные на месте.
        Assert.Equal(listCalls, api.TicketsCallCount);
        Assert.Single(api.TicketKanbanCalls);
        Assert.Equal(0, api.TicketDashboardCalls);
    }

    // ---- Служебное ----

    /// <summary>
    /// DataTemplate страницы ленивый: XAML TicketsView (стили, ContextMenu-фильтры,
    /// конвертеры) проверяем прямым рендером на STA-потоке — как HubWindowRendersAllStates.
    /// </summary>
    [Fact]
    public void TicketsViewRendersLoadedStateOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var api = new FakeHubApiClient
                {
                    TicketsPage = new HubTicketListPage
                    {
                        Total = 1,
                        Page = 1,
                        TotalPages = 1,
                        Items = [Request(11, "Иван Петров", status: "at_cashier")],
                    },
                    TicketDetail = Request(11, "Иван Петров", status: "at_cashier"),
                    TicketCommentsPage = new HubTicketCommentPage
                    {
                        Total = 1,
                        Page = 1,
                        Items = [Comment(1, 11, "Комментарий")],
                    },
                    TicketAttachments = new HubTicketAttachmentList
                    {
                        Items =
                        [
                            new HubTicketAttachment
                            {
                                Id = "att-1",
                                RequestId = 11,
                                FileName = "ticket.pdf",
                                FileSize = 2048,
                            },
                        ],
                    },
                    TicketObjects = new HubTicketObjectList
                    {
                        Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
                    },
                    TicketKanban = new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>(StringComparer.Ordinal)
                    {
                        ["Не запущен"] = [KanbanCard(11, "Иван Петров", "not_started")],
                        ["Проблема"] = [KanbanCard(12, "Пётр Проблемный", "at_cashier", urgent: true)],
                    },
                    TicketDashboard = new HubTicketsDashboard
                    {
                        Metrics = new HubTicketsDashboardMetrics
                        {
                            TotalActive = 2,
                            TicketSum = "1000.00",
                            LossSum = "0.00",
                        },
                        PerObject =
                        [
                            new HubTicketsDashboardObject
                            {
                                ObjectId = 7,
                                ObjectName = "Логистика",
                                Active = 2,
                                Problematic = 1,
                            },
                        ],
                        TopProblems =
                        [
                            new HubTicketsDashboardObject
                            {
                                ObjectId = 7,
                                ObjectName = "Логистика",
                                Problematic = 1,
                            },
                        ],
                        TopAssignees =
                        [
                            new HubTicketsDashboardAssignee
                            {
                                AssigneeId = 5,
                                AssigneeName = "Пётр",
                                ActiveCount = 2,
                            },
                        ],
                    },
                };
                var model = new TicketsViewModel(api);
                model.LoadAsync().GetAwaiter().GetResult();
                // Фейки отвечают синхронно — карточка догружается внутри сеттера.
                model.SelectedItem = model.Items[0];

                var window = new System.Windows.Window
                {
                    Width = 1280,
                    Height = 800,
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -30000,
                    Top = -30000,
                    ShowInTaskbar = false,
                    Content = new Native.Views.TicketsView { DataContext = model },
                };
                window.Show();
                window.UpdateLayout();

                // Канбан: колонки и карточки рендерятся, клик открывает карточку-оверлей.
                model.SelectViewModeCommand.Execute("kanban");
                window.UpdateLayout();
                model.SelectKanbanCardCommand.Execute(model.KanbanColumns[0].Cards[0]);
                window.UpdateLayout();
                model.CloseDetailCommand.Execute(null);
                window.UpdateLayout();

                // Дашборд: метрики, объекты и топ-списки.
                model.SelectViewModeCommand.Execute("dashboard");
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
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            TicketsPage = new HubTicketListPage
            {
                Total = 1,
                Page = 1,
                TotalPages = 1,
                Items = [Request(11, "Иван Петров")],
            },
            TicketDetail = Request(11, "Иван Петров"),
            TicketObjects = new HubTicketObjectList
            {
                Items = [new HubTicketObject { Id = 7, Code = "LG", Name = "Логистика" }],
            },
        };
        var model = new TicketsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Null(model.SelectedStatusFilter!.Value);
        Assert.Single(model.ObjectFilterOptions);
        Assert.Null(model.SelectedObjectFilter!.Id);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasMore);
        Assert.False(model.HasStatusInfo);
        Assert.False(model.HasDetailError);
    }

    private static HubTicketRequest Request(
        long id,
        string employee,
        string status = "not_started",
        int version = 1) =>
        new()
        {
            Id = id,
            EmployeeId = id,
            EmployeeName = employee,
            ObjectId = 7,
            ObjectCode = "LG",
            ObjectName = "Логистика",
            Status = status,
            AssigneeName = "Пётр Исполнитель",
            SubmittedAt = "2026-11-10T09:00:00",
            DepartureDate = "2026-11-20",
            ArrivalDate = "2026-11-25",
            Route = "Сургут",
            Note = "Командировка",
            TotalCost = "15000.00",
            RefundLoss = "0.00",
            IsUrgent = false,
            NeedsReview = false,
            Source = "manual",
            Version = version,
            CreatedAt = "2026-11-10T09:00:00",
            UpdatedAt = "2026-11-10T09:00:00",
        };

    private static HubTicketKanbanCard KanbanCard(
        long id,
        string employee,
        string status,
        bool urgent = false) =>
        new()
        {
            Id = id,
            EmployeeName = employee,
            ObjectName = "Логистика",
            DepartureDate = "2026-11-20",
            Route = "Сургут",
            IsUrgent = urgent,
            AssigneeName = "Пётр Исполнитель",
            Status = status,
        };

    private static HubTicketComment Comment(
        long id,
        long requestId,
        string text,
        string type = "normal") =>
        new()
        {
            Id = id,
            RequestId = requestId,
            AuthorId = 5,
            Text = text,
            CommentType = type,
            CreatedAt = "2026-11-10T09:00:00",
        };

    private static HubTicketHistoryEntry HistoryEntry(
        long id,
        long requestId,
        string field,
        string? oldValue,
        string? newValue,
        string? comment = null,
        string createdAt = "2026-11-10T09:00:00") =>
        new()
        {
            Id = id,
            RequestId = requestId,
            FieldName = field,
            OldValue = oldValue,
            NewValue = newValue,
            ChangedById = 5,
            Source = "manual",
            Comment = comment,
            CreatedAt = createdAt,
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
