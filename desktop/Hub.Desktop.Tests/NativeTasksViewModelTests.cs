using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeTasksViewModelTests
{
    // ---- Список: загрузка и состояния ----

    [Fact]
    public async Task LoadPopulatesItemsAndStatusBar()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 2,
                Items = [TaskItem(1, "Первая"), TaskItem(2, "Вторая")],
            },
        };
        var model = new TasksViewModel(api);

        await model.LoadTasksAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Первая", model.Items[0].Title);
        Assert.Equal("2", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.Contains("Обновлено", model.LastUpdatedText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task LoadFailureShowsBannerInsteadOfEmptyState()
    {
        var api = new FakeHubApiClient
        {
            TasksException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TasksViewModel(api);

        // Ошибки маппятся в баннер обработчиком команды, не самой загрузкой.
        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task OverdueFilterQueriesByDueStateNotStatus()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
        };
        var model = new TasksViewModel(api);

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("overdue");

        Assert.Null(api.LastQuery?.Status);
        Assert.Equal("overdue", api.LastQuery?.DueState);
        Assert.Equal("due_at", api.LastQuery?.SortBy);
        Assert.True(model.IsFilterOverdue);
    }

    // ---- Приоритет: отображение в элементе списка ----

    [Theory]
    [InlineData("critical", "Критичный")]
    [InlineData("urgent", "Срочный")]
    [InlineData("high", "Высокий")]
    [InlineData("medium", "Средний")]
    [InlineData("normal", "Средний")]
    [InlineData("low", "Низкий")]
    [InlineData(null, "")]
    public void ListItemFormatsPriorityLabel(string? priority, string expected)
    {
        var item = new TaskListItemViewModel(TaskItem(1, "Задача", priority: priority));

        Assert.Equal(expected, item.PriorityText);
    }

    [Theory]
    [InlineData("critical", true)]
    [InlineData("urgent", true)]
    [InlineData("high", true)]
    [InlineData("low", true)]
    [InlineData("normal", false)]
    [InlineData("medium", false)]
    [InlineData(null, false)]
    public void ListItemShowsPriorityMarkerOnlyForNonBaseline(string? priority, bool expected)
    {
        var item = new TaskListItemViewModel(TaskItem(1, "Задача", priority: priority));

        Assert.Equal(expected, item.ShowPriority);
    }

    [Fact]
    public void ListItemPriorityToneMatchesSeverity()
    {
        var critical = new TaskListItemViewModel(TaskItem(1, "a", priority: "critical"));
        var urgent = new TaskListItemViewModel(TaskItem(2, "b", priority: "urgent"));
        var high = new TaskListItemViewModel(TaskItem(3, "c", priority: "high"));
        var low = new TaskListItemViewModel(TaskItem(4, "d", priority: "low"));

        // Тон — строковый контракт с разметкой (DataTrigger в HubTheme.xaml).
        Assert.Equal("danger", critical.PriorityTone);
        Assert.Equal("danger", urgent.PriorityTone);
        Assert.Equal("warning", high.PriorityTone);
        Assert.Equal("muted", low.PriorityTone);
    }

    // ---- Приоритет: детальная панель ----

    [Fact]
    public void DetailShowsPriorityFromApiPayload()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: "high"));

        Assert.True(detail.HasPriority);
        Assert.Equal("Высокий", detail.PriorityText);
        Assert.Equal("warning", detail.PriorityTone);
    }

    [Fact]
    public void DetailHidesPriorityWhenAbsent()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: null));

        Assert.False(detail.HasPriority);
        Assert.Equal(string.Empty, detail.PriorityText);
    }

    [Fact]
    public void DetailUpdateRefreshesPriority()
    {
        var detail = new TaskDetailViewModel(Detail(5, priority: "normal"));

        detail.Update(Detail(5, priority: "critical"));

        Assert.Equal("Критичный", detail.PriorityText);
        Assert.Equal("danger", detail.PriorityTone);
    }

    // ---- Сквозной сценарий: список -> выбор -> детали ----

    [Fact]
    public async Task SelectingTaskLoadsPriorityIntoDetailPanel()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Срочная задача", priority: "urgent")],
            },
            TaskDetail = Detail(7, priority: "urgent"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();

        Assert.True(model.Items[0].ShowPriority);
        Assert.Equal("Срочный", model.Items[0].PriorityText);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.Equal("Срочный", model.Detail!.PriorityText);
        Assert.True(model.Detail.HasPriority);
    }

    [Fact]
    public async Task TransitionUpdatesStatusInDetailAndList()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача", status: "new")],
            },
            TaskDetail = Detail(7, status: "new", canStart: true),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        await ((NativeAsyncCommand)model.TransitionCommand).ExecuteAsync("Start");

        Assert.Equal(HubTaskTransition.Start, api.LastTransition);
        Assert.Equal("В работе", model.Detail!.StatusText);
        await WaitFor(() => model.Items.Count > 0 && model.Items[0].StatusText == "В работе");
    }

    // ---- Комментарии и вложения в карточке ----

    [Fact]
    public async Task SelectingTaskLoadsCommentsIntoDetail()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, commentsCount: 2),
            TaskComments = new HubTaskCommentList
            {
                Items =
                [
                    Comment("c-1", "Первый", "Lead User"),
                    Comment("c-2", "Второй", "Test User"),
                ],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 2 });

        Assert.Equal([7], api.TaskCommentListCalls);
        Assert.Equal("Комментарии (2)", model.Detail!.CommentsTitle);
        Assert.Equal("Первый", model.Detail.Comments[0].Body);
        Assert.Contains("Lead User", model.Detail.Comments[0].MetaText, StringComparison.Ordinal);
        Assert.False(model.Detail.CommentsFailed);
    }

    [Fact]
    public async Task SelectingTaskWithUnreadCommentsCallsMarkSeenAndClearsFlag()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача", hasUnread: true)],
            },
            TaskDetail = Detail(7, hasUnread: true),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => api.TaskMarkSeenCalls.Count > 0);

        Assert.Equal([7], api.TaskMarkSeenCalls);
        Assert.False(model.Detail!.HasUnreadComments);
        Assert.False(model.Items[0].HasUnreadComments);
        Assert.Equal(string.Empty, model.Items[0].UnreadCommentsText);
    }

    [Fact]
    public async Task SelectingTaskWithoutUnreadSkipsMarkSeen()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.Empty(api.TaskMarkSeenCalls);
    }

    [Fact]
    public async Task CommentsLoadFailureMarksOnlyTheSection()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7),
            TaskCommentsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { CommentsFailed: true });

        // Карточка жива: деталь и вложения на месте, ошибки карточки нет.
        Assert.NotNull(model.Detail);
        Assert.False(model.HasDetailError);
        Assert.Empty(model.Detail!.Comments);
    }

    [Fact]
    public async Task SendCommentAppendsIncrementsCountAndClearsInput()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, commentsCount: 1),
            TaskComments = new HubTaskCommentList
            {
                Items = [Comment("c-1", "Старый", "Lead User")],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 1 });

        model.Detail!.CommentText = "  Новый комментарий  ";
        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        Assert.Equal([(7, "Новый комментарий")], api.TaskCommentCreateCalls);
        Assert.Equal(2, model.Detail.Comments.Count);
        Assert.Equal("Новый комментарий", model.Detail.Comments[1].Body);
        Assert.Equal("Комментарии (2)", model.Detail.CommentsTitle);
        Assert.Equal(string.Empty, model.Detail.CommentText);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task SendCommentFailureKeepsCardAndInput()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7),
            TaskCommentCreateException = new HubApiException(
                HubApiErrorKind.Http, "use_task_discussion_chat", System.Net.HttpStatusCode.BadRequest),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        model.Detail!.CommentText = "Черновик";
        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        Assert.True(model.HasDetailError);
        Assert.Contains("use_task_discussion_chat", model.DetailErrorText!, StringComparison.Ordinal);
        Assert.Equal("Черновик", model.Detail.CommentText);
        Assert.Empty(model.Detail.Comments);
    }

    [Fact]
    public async Task DiscussionModeHidesComposerAndNavigatesToChat()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, canOpenDiscussion: true, commentsCount: 1),
            TaskComments = new HubTaskCommentList
            {
                Items = [Comment("c-1", "Архивный", "Lead User")],
            },
            TaskDiscussion = new HubTaskDiscussion
            {
                ConversationId = "conv-42",
                Created = true,
                Kind = "task",
            },
        };
        var model = new TasksViewModel(api);
        var navigated = new List<string>();
        model.DiscussionNavigator = (conversationId, _) =>
        {
            navigated.Add(conversationId);
            return Task.CompletedTask;
        };
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Comments.Count: 1 });

        // Чат-режим: композера нет, секция подписана «Архив», архивная лента видна.
        Assert.False(model.Detail!.ShowCommentComposer);
        Assert.Equal("Архив (1)", model.Detail.CommentsTitle);
        Assert.True(model.Detail.CanOpenDiscussionNow);

        await ((NativeAsyncCommand)model.OpenDiscussionCommand).ExecuteAsync(null);

        Assert.Equal([7], api.TaskDiscussionCalls);
        Assert.Equal(["conv-42"], navigated);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task AttachmentsFromDetailRenderAsChips()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, attachments:
            [
                Attachment("att-1", "spec.docx", scope: "task"),
                Attachment("att-2", "report.pdf", scope: "report"),
            ]),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 2 });

        Assert.Equal("Вложения (2)", model.Detail!.AttachmentsTitle);
        Assert.Equal("spec.docx (1 КБ)", model.Detail.Attachments[0].DisplayText);
        // scope=task удаляем и превью (docx — Office); report-файл — только скачивание.
        Assert.True(model.Detail.Attachments[0].CanDelete);
        Assert.True(model.Detail.Attachments[0].CanPreview);
        Assert.False(model.Detail.Attachments[1].CanDelete);
        Assert.False(model.Detail.Attachments[1].CanPreview);
    }

    [Fact]
    public async Task UploadAttachmentAppendsChip()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, canUploadFiles: true),
        };
        var model = new TasksViewModel(api);
        var temp = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.txt");
        await File.WriteAllTextAsync(temp, "note");
        try
        {
            model.DetailFilePicker = () => [temp];
            await model.LoadTasksAsync();
            model.SelectedItem = model.Items[0];
            await WaitFor(() => model.Detail is not null);

            await ((NativeAsyncCommand)model.AttachFilesCommand).ExecuteAsync(null);

            var upload = Assert.Single(api.TaskAttachmentUploadCalls);
            Assert.Equal(7, upload.TaskId);
            Assert.EndsWith(".txt", upload.FileName, StringComparison.Ordinal);
            Assert.Single(model.Detail!.Attachments);
            Assert.Equal("Вложения (1)", model.Detail.AttachmentsTitle);
            Assert.False(model.HasDetailError);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    [Fact]
    public async Task UploadRejectsUnsupportedExtensionBeforeRequest()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, canUploadFiles: true),
        };
        var model = new TasksViewModel(api);
        var temp = Path.Combine(Path.GetTempPath(), $"hub-test-{Guid.NewGuid():N}.exe");
        await File.WriteAllTextAsync(temp, "x");
        try
        {
            model.DetailFilePicker = () => [temp];
            await model.LoadTasksAsync();
            model.SelectedItem = model.Items[0];
            await WaitFor(() => model.Detail is not null);

            await ((NativeAsyncCommand)model.AttachFilesCommand).ExecuteAsync(null);

            Assert.Empty(api.TaskAttachmentUploadCalls);
            Assert.True(model.HasDetailError);
            Assert.Empty(model.Detail!.Attachments);
        }
        finally
        {
            File.Delete(temp);
        }
    }

    [Fact]
    public async Task DeleteAttachmentArmsThenDeletes()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, attachments: [Attachment("att-1", "spec.pdf")]),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });
        var chip = model.Detail!.Attachments[0];
        var command = (NativeAsyncCommand)model.DeleteAttachmentCommand;

        // Первое нажатие только взводит подтверждение — запроса ещё нет.
        await command.ExecuteAsync(chip);
        Assert.True(chip.DeleteArmed);
        Assert.Equal("Удалить?", chip.DeleteText);
        Assert.Empty(api.TaskAttachmentDeleteCalls);

        await command.ExecuteAsync(chip);
        Assert.Equal([(7, "att-1")], api.TaskAttachmentDeleteCalls);
        Assert.Empty(model.Detail.Attachments);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task OpenAttachmentUsesSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, attachments: [Attachment("att-1", "spec.pdf")]),
        };
        var model = new TasksViewModel(api);
        var saved = new List<(long TaskId, string AttachmentId)>();
        model.AttachmentSaver = (item, taskId) =>
        {
            saved.Add((taskId, item.AttachmentId));
            return Task.CompletedTask;
        };
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });

        var chip = model.Detail!.Attachments[0];
        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(chip);

        Assert.Equal([(7, "att-1")], saved);
        Assert.Empty(api.TaskAttachmentDownloadCalls);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task PreviewAttachmentUsesPreviewSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, attachments: [Attachment("att-1", "spec.docx")]),
        };
        var model = new TasksViewModel(api);
        var saved = new List<(long TaskId, string AttachmentId)>();
        model.AttachmentPreviewSaver = (item, taskId) =>
        {
            saved.Add((taskId, item.AttachmentId));
            return Task.CompletedTask;
        };
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });

        var chip = model.Detail!.Attachments[0];
        await ((NativeAsyncCommand)model.PreviewAttachmentCommand).ExecuteAsync(chip);

        Assert.Equal([(7, "att-1")], saved);
        Assert.Empty(api.TaskAttachmentPreviewCalls);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task DeleteAttachmentFailureKeepsChip()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 1,
                Items = [TaskItem(7, "Задача")],
            },
            TaskDetail = Detail(7, attachments: [Attachment("att-1", "spec.pdf")]),
            TaskAttachmentDeleteException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", System.Net.HttpStatusCode.Forbidden),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { Attachments.Count: 1 });
        var chip = model.Detail!.Attachments[0];
        var command = (NativeAsyncCommand)model.DeleteAttachmentCommand;

        await command.ExecuteAsync(chip);
        await command.ExecuteAsync(chip);

        Assert.Single(api.TaskAttachmentDeleteCalls);
        Assert.Single(model.Detail.Attachments);
        Assert.True(model.HasDetailError);
    }

    // ---- Создание задачи: права, форма, отправка ----

    [Fact]
    public async Task CreateButtonHiddenWithoutCreatePermission()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = ["tasks.read"] },
        };
        var model = new TasksViewModel(api);

        await model.LoadTasksAsync();

        Assert.False(model.CanCreateTasks);
        Assert.False(model.NewTaskCommand.CanExecute(null));
        Assert.False(model.IsCreateOpen);
    }

    [Theory]
    [InlineData("tasks.create")]
    [InlineData("tasks.write")]
    public async Task CreateButtonVisibleWithCreateOrWrite(string permission)
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = [permission] },
        };
        var model = new TasksViewModel(api);

        await model.LoadTasksAsync();

        Assert.True(model.CanCreateTasks);
        Assert.True(model.NewTaskCommand.CanExecute(null));
    }

    [Fact]
    public async Task CreateButtonVisibleForAdminRole()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "root", Role = "admin" },
        };
        var model = new TasksViewModel(api);

        await model.LoadTasksAsync();

        Assert.True(model.CanCreateTasks);
    }

    [Fact]
    public async Task OpenCreateLoadsDirectoriesOncePerSession()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = ["tasks.create"] },
            TaskProjects = new HubTaskProjectList
            {
                Items = [new HubTaskProject { Id = "p-1", Name = "Проект А", IsActive = true }],
            },
            TaskControllers = new HubTaskUserList
            {
                Items = [new HubTaskUserItem { Id = 12, FullName = "Контролёрова А." }],
            },
            TaskObjects = new HubTaskObjectList
            {
                Items = [new HubTaskObject { Id = "o-1", ProjectId = "p-1", Name = "Объект А", IsActive = true }],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();

        await ((NativeAsyncCommand)model.NewTaskCommand).ExecuteAsync(null);

        var create = model.Create;
        Assert.NotNull(create);
        Assert.True(model.IsCreateOpen);
        Assert.Single(create!.Projects);
        Assert.Equal(2, create.Controllers.Count); // «Без контролёра» + запись справочника
        Assert.Equal(1, api.TaskProjectsCallCount);
        Assert.Equal(1, api.TaskControllersCallCount);
        Assert.Equal(1, api.TaskObjectsCallCount);
        // Объекты фильтруются выбранным проектом клиентски.
        create.SelectedProject = create.Projects[0];
        var createdObject = Assert.Single(create.Objects);
        Assert.Equal("o-1", createdObject.Id);

        create.CloseCommand.Execute(null);
        Assert.False(model.IsCreateOpen);

        // Повторное открытие не дёргает справочники заново.
        await ((NativeAsyncCommand)model.NewTaskCommand).ExecuteAsync(null);
        Assert.NotNull(model.Create);
        Assert.Equal(1, api.TaskProjectsCallCount);
        Assert.Equal(1, api.TaskControllersCallCount);
        Assert.Equal(1, api.TaskObjectsCallCount);
    }

    [Fact]
    public async Task CreateValidationBlocksEmptyAndIncompleteSubmit()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = ["tasks.create"] },
            TaskProjects = new HubTaskProjectList
            {
                Items = [new HubTaskProject { Id = "p-1", Name = "Проект А", IsActive = true }],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        await ((NativeAsyncCommand)model.NewTaskCommand).ExecuteAsync(null);
        var create = model.Create!;

        // Пустая форма: название короче 3 — запрос не уходит.
        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);
        Assert.Empty(api.TaskCreateCalls);
        Assert.True(create.HasError);

        // Название есть, исполнитель не выбран.
        create.Title = "Починить насос";
        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);
        Assert.Empty(api.TaskCreateCalls);
        Assert.Contains("исполнител", create.ErrorText!, StringComparison.OrdinalIgnoreCase);

        // Исполнитель есть, проект не выбран (project_id обязателен на backend).
        create.AssigneeSearch.SelectCommand.Execute(AssigneeOption(11, "Иванов"));
        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);
        Assert.Empty(api.TaskCreateCalls);
        Assert.Contains("проект", create.ErrorText!, StringComparison.OrdinalIgnoreCase);
        // Поля при ошибках валидации не стираются.
        Assert.Equal("Починить насос", create.Title);
        Assert.True(model.IsCreateOpen);
    }

    [Fact]
    public async Task CreateSubmitPostsRequestClosesOverlayAndSelectsNewTask()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage
            {
                Total = 2,
                Items = [TaskItem(1, "Старая"), TaskItem(42, "Починить насос")],
            },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = ["tasks.create"] },
            TaskProjects = new HubTaskProjectList
            {
                Items = [new HubTaskProject { Id = "p-1", Name = "Проект А", IsActive = true }],
            },
            TaskObjects = new HubTaskObjectList
            {
                Items = [new HubTaskObject { Id = "o-1", ProjectId = "p-1", Name = "Насосная", IsActive = true }],
            },
            TaskCreateFactory = request => new HubTaskCreateResult
            {
                Created = 1,
                Items = [new HubTaskItem { Id = 42, Title = request.Title, Status = "new" }],
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        await ((NativeAsyncCommand)model.NewTaskCommand).ExecuteAsync(null);
        var create = model.Create!;
        create.Title = "Починить насос";
        create.Description = "Сменить подшипник";
        create.SelectedProject = create.Projects[0];
        create.SelectedObject = create.Objects[0];
        create.DueDate = new DateTime(2026, 12, 1);
        create.AssigneeSearch.SelectCommand.Execute(AssigneeOption(11, "Иванов"));

        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        var request = Assert.Single(api.TaskCreateCalls);
        Assert.Equal("Починить насос", request.Title);
        Assert.Equal("Сменить подшипник", request.Description);
        Assert.Equal([11L], request.AssigneeUserIds);
        Assert.Equal("p-1", request.ProjectId);
        Assert.Equal("o-1", request.ObjectId);
        Assert.Equal("2026-12-01T23:59", request.DueAt);
        Assert.Equal("normal", request.Priority);
        Assert.Null(request.ControllerUserId);
        Assert.NotNull(request.ProtocolDate);

        // Оверлей закрыт, свежесозданная задача найдена в списке и выбрана.
        Assert.False(model.IsCreateOpen);
        await WaitFor(() => model.SelectedItem?.Id == 42);
        await WaitFor(() => model.Detail?.Id == 42);
    }

    [Fact]
    public async Task CreateApiErrorKeepsFormOpenWithValues()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [] },
            CurrentUser = new HubUser { Id = 7, Username = "ivanov", Permissions = ["tasks.create"] },
            TaskProjects = new HubTaskProjectList
            {
                Items = [new HubTaskProject { Id = "p-1", Name = "Проект А", IsActive = true }],
            },
            TaskCreateException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        await ((NativeAsyncCommand)model.NewTaskCommand).ExecuteAsync(null);
        var create = model.Create!;
        create.Title = "Починить насос";
        create.SelectedProject = create.Projects[0];
        create.AssigneeSearch.SelectCommand.Execute(AssigneeOption(11, "Иванов"));

        await ((NativeAsyncCommand)create.CreateCommand).ExecuteAsync(null);

        Assert.Single(api.TaskCreateCalls);
        Assert.True(create.HasError);
        Assert.Contains("соединения", create.ErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.Equal("Починить насос", create.Title);
        Assert.True(model.IsCreateOpen);
    }

    [Fact]
    public async Task AssigneeSearchQueriesServerAfterDebounce()
    {
        var api = new FakeHubApiClient
        {
            TaskAssignees = new HubTaskUserList
            {
                Items = [new HubTaskUserItem { Id = 11, FullName = "Иванов И.И.", Department = "ИТ" }],
            },
        };
        var search = new TaskUserSearchViewModel(api, (_, _) => Task.CompletedTask);

        search.Query = "ива";
        await WaitFor(() => search.Options.Count == 1);

        var call = Assert.Single(api.TaskAssigneeSearchCalls);
        Assert.Equal("ива", call.Query);
        Assert.Equal(TaskUserSearchViewModel.SearchLimit, call.Limit);
        Assert.True(search.IsPopupOpen);
        Assert.Equal("Иванов И.И.", search.Options[0].Title);
        Assert.Equal("ИТ", search.Options[0].MetaText);

        // Выбор из подсказки закрывает popup и фиксирует вариант.
        search.SelectCommand.Execute(search.Options[0]);
        Assert.False(search.IsPopupOpen);
        Assert.Equal(11, search.Selected?.UserId);

        // Правка строки после выбора сбрасывает выбор и ищет заново.
        search.Query = "иванов";
        Assert.Null(search.Selected);
    }

    // ---- Подзадачи ----

    [Fact]
    public async Task SubtaskSectionShowsRowsAndCounts()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [TaskItem(7, "Родитель")], Total = 1 },
            TaskDetail = Detail(
                7,
                canCreateSubtask: true,
                subtasksTotal: 2,
                subtasksDone: 1,
                subtasks:
                [
                    new HubSubtaskItem
                    {
                        Id = 8,
                        Title = "Первая подзадача",
                        Status = "done",
                        AssigneeFullName = "Иванов И.И.",
                    },
                    new HubSubtaskItem
                    {
                        Id = 9,
                        Title = "Вторая подзадача",
                        Status = "in_progress",
                        AssigneeFullName = "Петров П.П.",
                    },
                ]),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        var detail = model.Detail!;
        Assert.True(detail.CanCreateSubtask);
        Assert.True(detail.ShowSubtasksSection);
        Assert.Equal("Подзадачи (1/2)", detail.SubtasksTitle);
        Assert.Equal(2, detail.Subtasks.Count);
        Assert.Equal("Выполнена", detail.Subtasks[0].StatusText);
        Assert.Equal("Петров П.П.", detail.Subtasks[1].AssigneeText);
        Assert.False(detail.ShowSubtasksEmpty);
    }

    [Fact]
    public async Task AddSubtaskCommandOpensFormOnlyWithCapability()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [TaskItem(7, "Родитель")], Total = 1 },
            TaskDetail = Detail(7, canCreateSubtask: true),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        Assert.True(model.AddSubtaskCommand.CanExecute(null));
        model.AddSubtaskCommand.Execute(null);

        var form = model.Detail!.SubtaskForm;
        Assert.NotNull(form);
        Assert.True(model.Detail.IsSubtaskFormOpen);
        // Повторное нажатие при открытой форме не плодит вложений.
        Assert.False(model.AddSubtaskCommand.CanExecute(null));
    }

    [Fact]
    public async Task SubtaskCreatePostsAndRefreshesParentDetail()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [TaskItem(7, "Родитель")], Total = 1 },
            TaskDetail = Detail(7, canCreateSubtask: true),
            SubtaskCreateFactory = (parentId, request) => new HubTaskDetail
            {
                Id = 9,
                ParentTaskId = parentId,
                Title = request.Title,
                Status = "new",
            },
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { CanCreateSubtask: true });
        model.AddSubtaskCommand.Execute(null);
        var form = model.Detail!.SubtaskForm!;
        form.Title = "Новая подзадача";
        form.DueDate = new DateTime(2026, 12, 5);
        form.AssigneeSearch.SelectCommand.Execute(AssigneeOption(11, "Иванов"));
        // Родитель после создания возвращает уже с подзадачей в списке.
        api.TaskDetail = Detail(
            7,
            canCreateSubtask: true,
            subtasksTotal: 1,
            subtasks:
            [
                new HubSubtaskItem { Id = 9, Title = "Новая подзадача", Status = "new" },
            ]);

        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);

        var call = Assert.Single(api.SubtaskCreateCalls);
        Assert.Equal(7, call.TaskId);
        Assert.Equal("Новая подзадача", call.Request.Title);
        Assert.Equal([11L], call.Request.AssigneeUserIds);
        Assert.Equal("2026-12-05T23:59", call.Request.DueAt);
        Assert.Equal("normal", call.Request.Priority);

        // Форма закрылась, карточка перечиталась со свежими счётчиками.
        await WaitFor(() => model.Detail is { Subtasks.Count: 1 });
        Assert.False(model.Detail!.IsSubtaskFormOpen);
        Assert.Equal("Подзадачи (0/1)", model.Detail.SubtasksTitle);
    }

    [Fact]
    public async Task SubtaskValidationBlocksSubmitWithoutAssignee()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [TaskItem(7, "Родитель")], Total = 1 },
            TaskDetail = Detail(7, canCreateSubtask: true),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { CanCreateSubtask: true });
        model.AddSubtaskCommand.Execute(null);
        var form = model.Detail!.SubtaskForm!;
        form.Title = "Новая подзадача";

        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);

        Assert.Empty(api.SubtaskCreateCalls);
        Assert.True(form.HasError);
        Assert.Contains("исполнител", form.ErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.True(model.Detail.IsSubtaskFormOpen);
    }

    [Fact]
    public async Task SubtaskApiErrorKeepsFormOpenWithValues()
    {
        var api = new FakeHubApiClient
        {
            TasksPage = new HubTaskListPage { Items = [TaskItem(7, "Родитель")], Total = 1 },
            TaskDetail = Detail(7, canCreateSubtask: true),
            SubtaskCreateException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new TasksViewModel(api);
        await model.LoadTasksAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is { CanCreateSubtask: true });
        model.AddSubtaskCommand.Execute(null);
        var form = model.Detail!.SubtaskForm!;
        form.Title = "Новая подзадача";
        form.AssigneeSearch.SelectCommand.Execute(AssigneeOption(11, "Иванов"));

        await ((NativeAsyncCommand)form.CreateCommand).ExecuteAsync(null);

        Assert.Single(api.SubtaskCreateCalls);
        Assert.True(form.HasError);
        Assert.Equal("Новая подзадача", form.Title);
        Assert.True(model.Detail!.IsSubtaskFormOpen);
    }

    private static TaskUserOptionViewModel AssigneeOption(long id, string fullName) =>
        TaskUserOptionViewModel.FromItem(new HubTaskUserItem { Id = id, FullName = fullName });

    private static HubTaskComment Comment(string id, string body, string fullName) =>
        new()
        {
            Id = id,
            TaskId = "7",
            UserId = 9,
            Username = "lead",
            FullName = fullName,
            Body = body,
            CreatedAt = new DateTimeOffset(2026, 11, 19, 10, 0, 0, TimeSpan.Zero),
        };

    private static HubTaskAttachment Attachment(
        string id,
        string fileName,
        string scope = "task") =>
        new()
        {
            Id = id,
            TaskId = "7",
            Scope = scope,
            FileName = fileName,
            FileSize = 1024,
            UploadedByUserId = 9,
            UploadedByUsername = "lead",
            UploadedAt = new DateTimeOffset(2026, 11, 19, 10, 0, 0, TimeSpan.Zero),
        };

    private static HubTaskItem TaskItem(
        long id,
        string title,
        string? status = "new",
        string? priority = null,
        bool hasUnread = false) =>
        new()
        {
            Id = id,
            Title = title,
            Status = status,
            Priority = priority,
            HasUnreadComments = hasUnread,
        };

    private static HubTaskDetail Detail(
        long id,
        string? status = "in_progress",
        string? priority = null,
        bool canStart = false,
        bool canUploadFiles = false,
        bool canOpenDiscussion = false,
        bool canCreateSubtask = false,
        int commentsCount = 0,
        int subtasksTotal = 0,
        int subtasksDone = 0,
        bool hasUnread = false,
        IReadOnlyList<HubSubtaskItem>? subtasks = null,
        IReadOnlyList<HubTaskAttachment>? attachments = null) =>
        new()
        {
            Id = id,
            Title = "Задача",
            Status = status,
            Priority = priority,
            CommentsCount = commentsCount,
            SubtasksTotal = subtasksTotal,
            SubtasksDone = subtasksDone,
            HasUnreadComments = hasUnread,
            Subtasks = subtasks,
            Attachments = attachments,
            Capabilities = new HubTaskCapabilities
            {
                CanStart = canStart,
                CanUploadFiles = canUploadFiles,
                CanOpenDiscussion = canOpenDiscussion,
                CanCreateSubtask = canCreateSubtask,
            },
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
