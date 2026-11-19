using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeDocflowViewModelTests
{
    // ---- Список: загрузка, scope, поиск ----

    [Fact]
    public async Task LoadPopulatesItemsBadgeAndStatusBar()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 2,
                Items = [TaskItem("t-1", "Согласовать договор"), TaskItem("t-2", "Утвердить счёт")],
            },
            DocflowInboxSummary = new HubDocflowInboxSummary { Status = "available", Count = 2 },
        };
        var model = new DocflowViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Согласовать договор", model.Items[0].Title);
        Assert.Equal(2, model.InboxCount);
        Assert.Equal("2", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.False(model.ShowSetupHint);
        Assert.Equal("inbox", api.LastDocflowQuery?.Scope);
        Assert.Equal(1, api.DocflowProfileCallCount);
    }

    [Fact]
    public async Task NotConfiguredProfileShowsSetupHintWithoutListRequest()
    {
        var api = new FakeHubApiClient
        {
            DocflowProfile = new HubDocflowProfile
            {
                Configured = false,
                Status = "not_configured",
            },
        };
        var model = new DocflowViewModel(api);

        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.Contains("веб", model.SetupHintText, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(model.Items);
        Assert.Equal(0, api.DocflowTasksCallCount);
        Assert.False(model.IsEmpty);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ProfileFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            DocflowProfileException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new DocflowViewModel(api);

        // Ошибки маппятся в баннер обработчиком команды, не самой загрузкой.
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task ScopeChipSwitchesQueryAndReloads()
    {
        var api = new FakeHubApiClient { DocflowTasksPage = new HubDocflowTaskListPage { Items = [] } };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        Assert.Equal("inbox", api.LastDocflowQuery?.Scope);

        await ((NativeAsyncCommand)model.SelectScopeCommand).ExecuteAsync("completed");

        Assert.True(model.IsScopeCompleted);
        Assert.Equal("completed", api.LastDocflowQuery?.Scope);
    }

    [Fact]
    public async Task LoadMoreAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPageFactory = query => new HubDocflowTaskListPage
            {
                Items = query.Offset == 0
                    ? [TaskItem("t-1", "Первая")]
                    : [TaskItem("t-2", "Вторая")],
                Total = 2,
                HasMore = query.Offset == 0,
                NextOffset = query.Offset == 0 ? 1 : null,
            },
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Items.Count);
        Assert.Equal(1, api.LastDocflowQuery?.Offset);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task SearchTextDebouncesToServerQuery()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPageFactory = query =>
            {
                IReadOnlyList<HubDocflowTaskItem> items = string.IsNullOrEmpty(query.Search)
                    ? [TaskItem("t-1", "Договор"), TaskItem("t-2", "Счёт")]
                    : [TaskItem("t-2", "Счёт")];
                return new HubDocflowTaskListPage { Items = items, Total = items.Count };
            },
        };
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        Assert.Equal(2, model.Items.Count);

        model.SearchText = "счёт";
        await WaitFor(() => api.LastDocflowQuery?.Search == "счёт" && model.Items.Count == 1);

        Assert.Equal("Счёт", model.Items[0].Title);
    }

    // ---- Карточка ----

    [Fact]
    public async Task SelectingItemLoadsDetailCard()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        var detail = model.Detail!;
        Assert.Equal("t-1", api.LastDocflowTaskRef);
        Assert.Equal("Согласовать договор", detail.Title);
        Assert.Equal("Иван Петров", detail.AuthorText);
        Assert.True(detail.HasFiles);
        Assert.True(detail.HasActions);
        Assert.True(detail.HasRelated);
        Assert.Equal("state-token-1", detail.StateToken);
    }

    [Fact]
    public async Task DetailFailureShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowDetailException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HasDetailError);

        Assert.Contains("соединения", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Действия ----

    [Fact]
    public async Task AppliedActionCompletesTaskAndRefreshesCounters()
    {
        var api = new FakeHubApiClient
        {
            DocflowActionResult = new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "applied",
            },
            DocflowInboxSummary = new HubDocflowInboxSummary { Status = "available", Count = 0 },
        };
        // После действия сервер больше не отдаёт задание во inbox и возвращает
        // завершённую карточку — моделируем фабриками на счётчике вызовов.
        api.DocflowTasksPageFactory = _ =>
        {
            IReadOnlyList<HubDocflowTaskItem> items = api.DocflowActionCalls.Count == 0
                ? [TaskItem("t-1", "Согласовать договор")]
                : [];
            return new HubDocflowTaskListPage { Total = items.Count, Items = items };
        };
        api.DocflowTaskDetailFactory = _ => api.DocflowActionCalls.Count == 0
            ? Detail("t-1", "Согласовать договор")
            : Detail("t-1", "Согласовать договор") with
            {
                Completed = true,
                AvailableActions = [],
                StateToken = null,
            };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);
        var summaryCalls = api.DocflowInboxSummaryCallCount;
        var listCalls = api.DocflowTasksCallCount;

        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        var call = Assert.Single(api.DocflowActionCalls);
        Assert.Equal("t-1", call.TaskRef);
        Assert.Equal("approve", call.Action);
        Assert.Equal("state-token-1", call.StateToken);
        Assert.False(string.IsNullOrWhiteSpace(call.IdempotencyKey));
        Assert.True(model.HasStatusInfo);
        Assert.Contains("подтвердила", model.StatusInfoText!, StringComparison.OrdinalIgnoreCase);
        // Scope inbox: выполненное задание уходит из списка; счётчик/список перечитаны.
        Assert.Empty(model.Items);
        Assert.True(api.DocflowInboxSummaryCallCount > summaryCalls);
        Assert.True(api.DocflowTasksCallCount > listCalls);
        Assert.True(model.Detail!.Completed);
    }

    [Fact]
    public async Task PendingActionPollsCommandUntilApplied()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowActionResult = new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "pending",
            },
        };
        // Карточка обновляется после команды: до действия pending, после — завершённая.
        api.DocflowTaskDetailFactory = _ => api.DocflowActionCalls.Count == 0
            ? Detail("t-1", "Согласовать договор")
            : Detail("t-1", "Согласовать договор") with
            {
                Completed = true,
                AvailableActions = [],
                StateToken = null,
            };
        api.DocflowCommandResults.Enqueue(
            new HubDocflowCommandResult { CommandId = "cmd-1", Status = "pending" });
        api.DocflowCommandResults.Enqueue(
            new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "applied",
                // Завершённое задание больше не имеет доступных действий.
                Task = Detail("t-1", "Согласовать договор") with
                {
                    Completed = true,
                    AvailableActions = [],
                    StateToken = null,
                },
            });
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        Assert.Equal(2, api.DocflowCommandPolls.Count);
        Assert.All(api.DocflowCommandPolls, id => Assert.Equal("cmd-1", id));
        Assert.True(model.HasStatusInfo);
        Assert.True(model.Detail!.Completed);
        Assert.False(model.Detail!.HasActions);
    }

    [Fact]
    public async Task RejectedActionShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
            DocflowActionResult = new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "rejected",
            },
        };
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        Assert.True(model.HasDetailError);
        Assert.Contains("отклонила", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task CommandPollTimeoutShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
            DocflowActionResult = new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "pending",
            },
            // Без очереди — каждый опрос возвращает pending.
            DocflowCommandResult = new HubDocflowCommandResult
            {
                CommandId = "cmd-1",
                Status = "pending",
            },
        };
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        Assert.True(model.HasDetailError);
        Assert.Contains("долго не подтверждает", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.Equal(20, api.DocflowCommandPolls.Count);
    }

    [Fact]
    public async Task RequiredCommentBlocksActionUntilProvided()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор") with
            {
                AvailableActions =
                [
                    new HubDocflowAction
                    {
                        Code = "reject",
                        Label = "Отклонить",
                        Tone = "error",
                        CommentMode = "required",
                    },
                ],
            },
            DocflowActionResult = new HubDocflowCommandResult { Status = "applied" },
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        Assert.Empty(api.DocflowActionCalls);
        Assert.True(model.HasDetailError);
        Assert.Contains("комментария", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);

        model.Detail!.ActionComment = "Нужны правки";
        await ((NativeAsyncCommand)model.RunActionCommand).ExecuteAsync(model.Detail!.Actions[0]);

        var call = Assert.Single(api.DocflowActionCalls);
        Assert.Equal("reject", call.Action);
        Assert.Equal("Нужны правки", call.Comment);
    }

    // ---- Файлы ----

    [Fact]
    public async Task FileChipRoutesThroughSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        var saved = new List<(string Name, string TaskRef)>();
        model.FileSaver = (item, taskRef) =>
        {
            saved.Add((item.Name, taskRef));
            return Task.CompletedTask;
        };

        var file = model.Detail!.Files[0];
        await ((NativeAsyncCommand)model.OpenFileCommand).ExecuteAsync(file);
        await ((NativeAsyncCommand)model.OpenFileCommand).ExecuteAsync(file);

        // Каждый клик — один вызов шва; прямой API-скачивание задет не было.
        Assert.Equal(2, saved.Count);
        Assert.All(saved, entry =>
        {
            Assert.Equal("contract.pdf", entry.Name);
            Assert.Equal("t-1", entry.TaskRef);
        });
        Assert.Empty(api.DocflowFileDownloads);
    }

    [Fact]
    public async Task FileDownloadFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);
        model.FileSaver = (_, _) => Task.FromException(
            new HubApiException(HubApiErrorKind.Http, "Файл недоступен"));

        await ((NativeAsyncCommand)model.OpenFileCommand).ExecuteAsync(model.Detail!.Files[0]);

        Assert.True(model.HasBannerError);
        Assert.Contains("Файл недоступен", model.BannerErrorText!, StringComparison.Ordinal);
    }

    // ---- Поручения ----

    [Fact]
    public async Task DisabledCapabilityHidesNewAssignmentButton()
    {
        var api = new FakeHubApiClient
        {
            DocflowAssignmentCapability = new HubDocflowAssignmentCapability
            {
                Enabled = false,
                Reason = "Создание поручений выключено.",
            },
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();

        Assert.False(model.CanCreateAssignment);
        Assert.False(model.NewAssignmentCommand.CanExecute(null));
        Assert.Equal(1, api.DocflowAssignmentCapabilityCallCount);

        model.NewAssignmentCommand.Execute(null);
        Assert.Null(model.AssignmentForm);
    }

    [Fact]
    public async Task SetupHintHidesAssignmentButtonWithoutCapabilityRequest()
    {
        var api = new FakeHubApiClient
        {
            DocflowProfile = new HubDocflowProfile { Configured = false, Status = "not_configured" },
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();

        Assert.True(model.ShowSetupHint);
        Assert.False(model.CanCreateAssignment);
        // Без креденшелов capability не запрашивается вовсе.
        Assert.Equal(0, api.DocflowAssignmentCapabilityCallCount);
    }

    [Fact]
    public async Task CreateAssignmentSendsRequestPollsAndRefreshesList()
    {
        var api = new FakeHubApiClient
        {
            DocflowAssignmentDocuments = new HubDocflowAssignmentDocumentList
            {
                Items = [AssignmentDocument()],
            },
            DocflowAssignmentAssignees = new HubDocflowAssignmentAssigneeList
            {
                Items = [Assignee()],
            },
            DocflowAssignmentCreateResult = new HubDocflowAssignmentCommandResult
            {
                CommandId = "cmd-a1",
                Status = "pending",
            },
            DocflowAssignmentCommandResult = new HubDocflowAssignmentCommandResult
            {
                CommandId = "cmd-a1",
                Status = "applied",
                Assignment = new HubDocflowCreatedAssignment
                {
                    ProcessRef = "proc-9",
                    TaskRef = "task-9",
                    Title = "HUB-IT TEST · Согласовать",
                },
            },
        };
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        Assert.True(model.CanCreateAssignment);

        model.NewAssignmentCommand.Execute(null);
        var form = model.AssignmentForm!;
        // Справочник исполнителей предзагружается при открытии (q='').
        await WaitFor(() => form.AssigneeOptions.Count > 0);
        Assert.Contains(string.Empty, api.DocflowAssignmentAssigneeQueries);

        form.DocumentQuery = "договор";
        await WaitFor(() => form.DocumentOptions.Count > 0);
        Assert.Contains("договор", api.DocflowAssignmentDocumentQueries);
        form.SelectDocumentCommand.Execute(form.DocumentOptions[0]);
        form.SelectAssigneeCommand.Execute(form.AssigneeOptions[0]);
        form.SelectControllerCommand.Execute(form.ControllerOptions[0]);
        form.IsHighImportance = true;
        form.TitleText = "HUB-IT TEST · Согласовать";
        form.DescriptionText = "Проверьте договор до пятницы.";
        var listCalls = api.DocflowTasksCallCount;
        var summaryCalls = api.DocflowInboxSummaryCallCount;

        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);

        var call = Assert.Single(api.DocflowAssignmentCreateCalls);
        Assert.Equal("internal", call.Request.DocumentType);
        Assert.Equal(DocumentRef, call.Request.DocumentRef);
        Assert.Equal(AssigneeRef, call.Request.AssigneeRef);
        Assert.Equal(AssigneeRef, call.Request.ControllerRef);
        Assert.Equal("high", call.Request.Importance);
        Assert.Equal("HUB-IT TEST · Согласовать", call.Request.Title);
        Assert.Equal("Проверьте договор до пятницы.", call.Request.Description);
        Assert.True(call.Request.DueAt > DateTime.Now);
        Assert.False(string.IsNullOrWhiteSpace(call.IdempotencyKey));
        // pending → опрос GET /assignments/commands/{id} до applied.
        Assert.Equal(new[] { "cmd-a1" }, api.DocflowAssignmentCommandPolls);
        // Форма закрыта; список, счётчик и статус-плашка обновлены.
        Assert.Null(model.AssignmentForm);
        Assert.True(model.HasStatusInfo);
        Assert.Contains("подтвердила", model.StatusInfoText!, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("proc-9", model.StatusInfoText!, StringComparison.Ordinal);
        Assert.True(api.DocflowTasksCallCount > listCalls);
        Assert.True(api.DocflowInboxSummaryCallCount > summaryCalls);
    }

    [Fact]
    public async Task AssignmentValidationBlocksSubmitUntilRequiredFields()
    {
        var api = new FakeHubApiClient();
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.NewAssignmentCommand.Execute(null);
        var form = model.AssignmentForm!;
        await WaitFor(() => api.DocflowAssignmentAssigneeQueries.Count > 0);

        // Без документа.
        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);
        Assert.Contains("документ", form.ErrorText!, StringComparison.OrdinalIgnoreCase);

        api.DocflowAssignmentDocuments = new HubDocflowAssignmentDocumentList
        {
            Items = [AssignmentDocument()],
        };
        form.DocumentQuery = "договор";
        await WaitFor(() => form.DocumentOptions.Count > 0);
        form.SelectDocumentCommand.Execute(form.DocumentOptions[0]);

        // Без исполнителя.
        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);
        Assert.Contains("исполнителя", form.ErrorText!, StringComparison.OrdinalIgnoreCase);

        api.DocflowAssignmentAssignees = new HubDocflowAssignmentAssigneeList
        {
            Items = [Assignee()],
        };
        form.AssigneeQuery = "сидоров";
        await WaitFor(() => form.AssigneeOptions.Count > 0);
        form.SelectAssigneeCommand.Execute(form.AssigneeOptions[0]);

        // Срок в прошлом.
        form.DueDate = DateTime.Today.AddDays(-1);
        form.DueTimeText = "12:00";
        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);
        Assert.Contains("будущем", form.ErrorText!, StringComparison.OrdinalIgnoreCase);

        // Пилот: название без обязательного префикса.
        form.DueDate = DateTime.Today.AddDays(1);
        form.TitleText = "Просто название";
        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);
        Assert.Contains("префикса", form.ErrorText!, StringComparison.OrdinalIgnoreCase);

        // Осталось описание.
        form.TitleText = "HUB-IT TEST · Согласовать";
        form.DescriptionText = "   ";
        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);
        Assert.Contains("описание", form.ErrorText!, StringComparison.OrdinalIgnoreCase);

        Assert.Empty(api.DocflowAssignmentCreateCalls);
    }

    [Fact]
    public async Task CreateAssignmentFailureKeepsFieldsAndFormOpen()
    {
        var api = new FakeHubApiClient
        {
            DocflowAssignmentDocuments = new HubDocflowAssignmentDocumentList
            {
                Items = [AssignmentDocument()],
            },
            DocflowAssignmentAssignees = new HubDocflowAssignmentAssigneeList
            {
                Items = [Assignee()],
            },
            DocflowAssignmentCreateException = new HubApiException(
                HubApiErrorKind.Http, "1С не приняла поручение"),
        };
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.NewAssignmentCommand.Execute(null);
        var form = model.AssignmentForm!;
        await WaitFor(() => form.AssigneeOptions.Count > 0);
        form.DocumentQuery = "договор";
        await WaitFor(() => form.DocumentOptions.Count > 0);
        form.SelectDocumentCommand.Execute(form.DocumentOptions[0]);
        form.SelectAssigneeCommand.Execute(form.AssigneeOptions[0]);
        form.TitleText = "HUB-IT TEST · Согласовать";
        form.DescriptionText = "Описание";

        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);

        // Плашка ошибки внутри формы; форма и поля не потеряны.
        Assert.True(form.HasError);
        Assert.Contains("1С не приняла поручение", form.ErrorText!, StringComparison.Ordinal);
        Assert.Same(form, model.AssignmentForm);
        Assert.True(model.IsAssignmentFormOpen);
        Assert.Equal("HUB-IT TEST · Согласовать", form.TitleText);
        Assert.Equal("Описание", form.DescriptionText);
        Assert.NotNull(form.SelectedDocument);
        Assert.NotNull(form.SelectedAssignee);
    }

    [Fact]
    public async Task ReopeningAssignmentFormWhileOpenKeepsDraft()
    {
        var api = new FakeHubApiClient();
        var model = new DocflowViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.NewAssignmentCommand.Execute(null);
        var form = model.AssignmentForm!;
        form.TitleText = "HUB-IT TEST · Черновик";
        form.DescriptionText = "Не потерять";

        // Повторный «＋ Поручение» при открытой форме не пересоздаёт её.
        model.NewAssignmentCommand.Execute(null);

        Assert.Same(form, model.AssignmentForm);
        Assert.Equal("HUB-IT TEST · Черновик", model.AssignmentForm!.TitleText);
        Assert.Equal("Не потерять", model.AssignmentForm.DescriptionText);

        // Отмена закрывает форму; повторное открытие — чистый бланк.
        form.CloseCommand.Execute(null);
        Assert.Null(model.AssignmentForm);
        model.NewAssignmentCommand.Execute(null);
        Assert.NotSame(form, model.AssignmentForm);
        Assert.Equal("HUB-IT TEST · ", model.AssignmentForm!.TitleText);
    }

    private const string DocumentRef = "11111111-2222-3333-4444-555555555555";
    private const string AssigneeRef = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    private static HubDocflowAssignmentDocument AssignmentDocument() =>
        new()
        {
            Ref = DocumentRef,
            DocumentType = "internal",
            DocumentTypeLabel = "Внутренний документ",
            Title = "Договор поставки",
            Number = "00-1234",
            Date = "2026-11-10",
        };

    private static HubDocflowAssignmentAssignee Assignee() =>
        new()
        {
            Ref = AssigneeRef,
            Name = "Пётр Сидоров",
            Department = "ИТ",
        };

    // ---- Служебное ----

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Total = 1,
                Items = [TaskItem("t-1", "Согласовать договор")],
            },
            DocflowTaskDetail = Detail("t-1", "Согласовать договор"),
            DocflowInboxSummary = new HubDocflowInboxSummary { Status = "available", Count = 3 },
        };
        var model = new DocflowViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.Equal(0, model.InboxCount);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.True(model.IsScopeInbox);
        Assert.False(model.HasBannerError);
        Assert.False(model.ShowSetupHint);
    }

    private static HubDocflowTaskItem TaskItem(string taskRef, string title) =>
        new()
        {
            Ref = taskRef,
            TaskType = "approval",
            TaskTypeLabel = "Задача на согласование",
            Title = title,
            Author = "Иван Петров",
            CreatedAt = "2026-11-10T09:00:00",
            DueAt = DateTimeOffset.UtcNow.AddDays(3).ToString("yyyy-MM-dd'T'HH:mm:ss"),
        };

    private static HubDocflowTaskDetail Detail(string taskRef, string title) =>
        new()
        {
            Ref = taskRef,
            TaskType = "approval",
            TaskTypeLabel = "Задача на согласование",
            Title = title,
            Author = "Иван Петров",
            Description = "Проверьте текст договора.",
            ProcessTypeLabel = "Согласование",
            StateToken = "state-token-1",
            CreatedAt = "2026-11-10T09:00:00",
            DueAt = DateTimeOffset.UtcNow.AddDays(3).ToString("yyyy-MM-dd'T'HH:mm:ss"),
            AvailableActions =
            [
                new HubDocflowAction
                {
                    Code = "approve",
                    Label = "Согласовать",
                    Tone = "success",
                    CommentMode = "optional",
                },
            ],
            Files =
            [
                new HubDocflowFile
                {
                    Ref = "f-1",
                    Name = "contract.pdf",
                    Extension = ".pdf",
                    ContentType = "application/pdf",
                    Size = 12_345,
                    PreviewSupported = true,
                },
            ],
            RelatedObjects =
            [
                new HubDocflowRelatedObject
                {
                    Ref = "doc-1",
                    ObjectType = "internal_document",
                    ObjectTypeLabel = "Внутренний документ",
                    Title = "Договор №42",
                },
            ],
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
