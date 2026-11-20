using System.Globalization;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Tests.Fakes;

/// <summary>
/// Общий фейк IHubApiClient для тестов нативных страниц.
/// Все методы покрыты: каждый возвращает настраиваемый результат или бросает Exception-поле.
/// </summary>
public class FakeHubApiClient : IHubApiClient
{
    // Сессия/логин
    public NativeSession? StoredSession { get; set; }
    public HubLoginResult? LoginResult { get; set; }
    public HubLoginResult? TwoFactorResult { get; set; }
    public Exception? LoginException { get; set; }
    public string? LastLoginUsername { get; private set; }
    public string? LastChallengeId { get; private set; }
    public string? LastTotpCode { get; private set; }
    public int RefreshCallCount { get; private set; }
    public int DashboardCallCount { get; private set; }
    public int TasksCallCount { get; private set; }
    public NativeSession? CurrentSession { get; private set; }

    // Задачи
    public Exception? TasksException { get; set; }
    public HubTaskListPage TasksPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка задач по параметрам запроса (пагинация).</summary>
    public Func<HubTaskQuery, HubTaskListPage>? TasksPageFactory { get; set; }
    public HubTaskDetail? TaskDetail { get; set; }
    public HubTaskDetail? TransitionResult { get; set; }
    public HubTaskQuery? LastQuery { get; private set; }
    public HubTaskTransition? LastTransition { get; private set; }
    public string? LastTransitionComment { get; private set; }

    // Задачи: комментарии/обсуждение/вложения
    public Exception? TaskCommentsException { get; set; }
    public Exception? TaskCommentCreateException { get; set; }
    public Exception? TaskMarkSeenException { get; set; }
    public Exception? TaskDiscussionException { get; set; }
    public Exception? TaskAttachmentUploadException { get; set; }
    public Exception? TaskAttachmentDeleteException { get; set; }
    public Exception? TaskAttachmentDownloadException { get; set; }
    public Exception? TaskAttachmentPreviewException { get; set; }
    public HubTaskCommentList TaskComments { get; set; } = new() { Items = [] };
    public HubTaskDiscussion? TaskDiscussion { get; set; }
    /// <summary>Если задан — ответ POST comments по тексту.</summary>
    public Func<long, string, HubTaskComment>? TaskCommentCreateFactory { get; set; }
    /// <summary>Если задан — ответ POST attachments по имени файла.</summary>
    public Func<long, string, HubTaskAttachment>? TaskAttachmentUploadFactory { get; set; }
    /// <summary>Байты, которые пишет фейк-скачивание вложения задачи в destination.</summary>
    public byte[] TaskAttachmentBytes { get; set; } = [1, 2, 3];
    public string TaskAttachmentDownloadFileName { get; set; } = "task-file.bin";
    public string TaskAttachmentPreviewFileName { get; set; } = "preview.pdf";
    public List<long> TaskCommentListCalls { get; } = [];
    public List<(long TaskId, string Body)> TaskCommentCreateCalls { get; } = [];
    public List<long> TaskMarkSeenCalls { get; } = [];
    public List<long> TaskDiscussionCalls { get; } = [];
    public List<(long TaskId, string FileName)> TaskAttachmentUploadCalls { get; } = [];
    public List<(long TaskId, string AttachmentId)> TaskAttachmentDeleteCalls { get; } = [];
    public List<(long TaskId, string AttachmentId)> TaskAttachmentDownloadCalls { get; } = [];
    public List<(long TaskId, string AttachmentId)> TaskAttachmentPreviewCalls { get; } = [];

    // Задачи: создание и справочники формы
    public Exception? TaskCreateException { get; set; }
    public Exception? SubtaskCreateException { get; set; }
    public Exception? TaskAssigneeSearchException { get; set; }
    public Exception? TaskControllersException { get; set; }
    public Exception? TaskProjectsException { get; set; }
    public Exception? TaskObjectsException { get; set; }
    public HubTaskCreateResult TaskCreateResult { get; set; } = new() { Created = 1 };
    /// <summary>Если задана — ответ POST /hub/tasks по телу запроса (нужен свежий id).</summary>
    public Func<HubTaskCreateRequest, HubTaskCreateResult>? TaskCreateFactory { get; set; }
    /// <summary>Если задана — ответ POST …/subtasks по (parentId, телу).</summary>
    public Func<long, HubTaskSubtaskCreateRequest, HubTaskDetail>? SubtaskCreateFactory { get; set; }
    public HubTaskUserList TaskAssignees { get; set; } = new() { Items = [] };
    public HubTaskUserList TaskControllers { get; set; } = new() { Items = [] };
    public HubTaskProjectList TaskProjects { get; set; } = new() { Items = [] };
    public HubTaskObjectList TaskObjects { get; set; } = new() { Items = [] };
    public List<HubTaskCreateRequest> TaskCreateCalls { get; } = [];
    public List<(long TaskId, HubTaskSubtaskCreateRequest Request)> SubtaskCreateCalls { get; } = [];
    public List<(string? Query, int Limit)> TaskAssigneeSearchCalls { get; } = [];
    public int TaskControllersCallCount { get; private set; }
    public int TaskProjectsCallCount { get; private set; }
    public int TaskObjectsCallCount { get; private set; }
    public string? LastTaskObjectsProjectId { get; private set; }

    // Задачи: аналитика (GET /hub/tasks/analytics + /export)
    public Exception? TaskAnalyticsException { get; set; }
    public Exception? TaskAnalyticsExportException { get; set; }
    public HubTaskAnalyticsPayload TaskAnalyticsPayload { get; set; } = new();
    /// <summary>Байты, которые пишет фейк-экспорт отчёта в destination.</summary>
    public byte[] TaskAnalyticsExportBytes { get; set; } = [1, 2, 3];
    public string TaskAnalyticsExportFileName { get; set; } = "task_analytics.xlsx";
    public List<HubTaskAnalyticsQuery> TaskAnalyticsCalls { get; } = [];
    public List<HubTaskAnalyticsQuery> TaskAnalyticsExportCalls { get; } = [];

    /// <summary>Если задан — отвечает на analytics-запрос асинхронно (тесты dedupe/in-flight).</summary>
    public Func<HubTaskAnalyticsQuery, CancellationToken, Task<HubTaskAnalyticsPayload>>? TaskAnalyticsHandler { get; set; }

    // Дашборд
    public Exception? DashboardException { get; set; }
    public HubDashboard Dashboard { get; set; } = new();
    public int LastAnnouncementsLimit { get; private set; }
    public int LastTasksLimit { get; private set; }

    // Новости
    public Exception? AnnouncementsException { get; set; }
    public Exception? AnnouncementDetailException { get; set; }
    public Exception? MarkReadException { get; set; }
    public Exception? AckException { get; set; }
    public HubAnnouncementListPage AnnouncementsPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка объявлений по параметрам запроса (пагинация).</summary>
    public Func<HubAnnouncementQuery, HubAnnouncementListPage>? AnnouncementsPageFactory { get; set; }
    public HubAnnouncementItem? AnnouncementDetail { get; set; }
    public HubAnnouncementQuery? LastAnnouncementsQuery { get; private set; }
    public string? LastAnnouncementId { get; private set; }
    public List<string> ReadMarkedIds { get; } = [];
    public List<string> AckedIds { get; } = [];

    // Новости: вовлечение — реакции/лайки/закладки/опрос/комментарии/вложения
    public Exception? AnnouncementReactionException { get; set; }
    public Exception? AnnouncementLikeException { get; set; }
    public Exception? AnnouncementBookmarkException { get; set; }
    public Exception? AnnouncementVoteException { get; set; }
    public Exception? AnnouncementCommentsException { get; set; }
    public Exception? AnnouncementCommentCreateException { get; set; }
    public Exception? AnnouncementAttachmentDownloadException { get; set; }

    /// <summary>Если задан — ответ reaction/like независимо от аргументов.</summary>
    public HubAnnouncementReactionState? AnnouncementReactionResult { get; set; }
    public HubAnnouncementReactionUserList AnnouncementReactionUsers { get; set; } = new() { Items = [] };
    /// <summary>Если задан — ответ vote (иначе голос проецируется на опрос детали).</summary>
    public HubAnnouncementPollVoteResult? AnnouncementVoteResult { get; set; }
    public HubAnnouncementCommentPage AnnouncementCommentsPage { get; set; } = new() { Items = [] };
    /// <summary>Если задана — ответ comments-list по параметрам запроса (пагинация/ветки).</summary>
    public Func<HubAnnouncementCommentQuery, HubAnnouncementCommentPage>? AnnouncementCommentsPageFactory { get; set; }
    /// <summary>Если задана — ответ POST comments по (body, parent_comment_id).</summary>
    public Func<string, string?, HubAnnouncementComment>? AnnouncementCommentCreateFactory { get; set; }

    public List<(string AnnouncementId, string? ReactionType)> AnnouncementReactionCalls { get; } = [];
    public List<(string AnnouncementId, bool Liked)> AnnouncementLikeCalls { get; } = [];
    public List<(string AnnouncementId, bool Bookmarked)> AnnouncementBookmarkCalls { get; } = [];
    public List<(string AnnouncementId, string[] OptionIds)> AnnouncementVoteCalls { get; } = [];
    public List<(string AnnouncementId, HubAnnouncementCommentQuery Query)> AnnouncementCommentListCalls { get; } = [];
    public List<(string AnnouncementId, string Body, string? ParentCommentId)> AnnouncementCommentCreateCalls { get; } = [];
    public List<(string AnnouncementId, string CommentId, string Body)> AnnouncementCommentUpdateCalls { get; } = [];
    public List<(string AnnouncementId, string CommentId)> AnnouncementCommentDeleteCalls { get; } = [];
    public List<(string AnnouncementId, string CommentId, string? ReactionType)> AnnouncementCommentReactionCalls { get; } = [];
    public List<(string AnnouncementId, string? CommentId, string AttachmentId)> AnnouncementAttachmentDownloads { get; } = [];

    /// <summary>Байты, которые пишет фейк-скачивание в destination.</summary>
    public byte[] AnnouncementAttachmentBytes { get; set; } = [1, 2, 3];
    public string AnnouncementAttachmentFileName { get; set; } = "attachment.bin";

    // Отсутствия
    public Exception? AbsencesException { get; set; }
    public HubAbsenceRangeList AbsencesList { get; set; } = new() { Items = [], ZupItems = [] };
    public string? LastAbsencesOn { get; private set; }
    public string? LastAbsencesStartsOn { get; private set; }
    public string? LastAbsencesEndsOn { get; private set; }
    public int AbsencesCallCount { get; private set; }
    public Exception? AbsenceCreateException { get; set; }
    public Exception? AbsenceUpdateException { get; set; }
    public Exception? AbsenceDeleteException { get; set; }

    /// <summary>Если задан — ответ create/update независимо от тела запроса.</summary>
    public HubAbsenceItem? AbsenceWriteResult { get; set; }
    public List<HubAbsenceUpsertRequest> AbsenceCreateCalls { get; } = [];
    public List<(long Id, HubAbsenceUpsertRequest Request)> AbsenceUpdateCalls { get; } = [];
    public List<long> AbsenceDeleteCalls { get; } = [];

    // Центр уведомлений
    public Exception? NotificationsPollException { get; set; }
    public HubNotificationPoll NotificationsPoll { get; set; } = new()
    {
        Items = [],
        UnreadCounts = new HubNotificationUnreadCounts(),
    };

    /// <summary>Если задана — отвечает на poll по параметрам (since/limit/unread_only).</summary>
    public Func<string?, int, bool, HubNotificationPoll>? NotificationsPollFactory { get; set; }

    /// <summary>Если задан — отвечает на poll асинхронно (тесты in-flight/очереди).</summary>
    public Func<CancellationToken, Task<HubNotificationPoll>>? NotificationsPollHandler { get; set; }
    public int NotificationsPollCallCount { get; private set; }
    public string? LastNotificationsPollSince { get; private set; }
    public int LastNotificationsPollLimit { get; private set; }
    public bool LastNotificationsPollUnreadOnly { get; private set; }
    public Exception? NotificationUnreadCountsException { get; set; }
    public HubNotificationUnreadCounts NotificationUnreadCounts { get; set; } = new();
    public int NotificationUnreadCountsCallCount { get; private set; }
    public Exception? NotificationMarkReadException { get; set; }
    public List<string> NotificationReadMarkedIds { get; } = [];
    public Exception? NotificationReadAllException { get; set; }
    public int NotificationReadAllCallCount { get; private set; }
    public HubNotificationReadAllResult NotificationReadAllResult { get; set; } = new()
    {
        Ok = true,
    };

    // Почта
    public Exception? MailBootstrapException { get; set; }
    public HubMailBootstrap MailBootstrap { get; set; } = new()
    {
        SelectedMailbox = new HubMailMailboxInfo
        {
            Id = "mb-1",
            Label = "user@zsgp.ru",
            MailIsConfigured = true,
        },
        FolderTree = new HubMailFolderTree { Items = [] },
        Messages = new HubMailMessagePage { Items = [] },
    };
    public int MailBootstrapCallCount { get; private set; }
    public Exception? MailMessagesException { get; set; }
    public HubMailMessagePage MailMessagesPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка писем по параметрам запроса (пагинация).</summary>
    public Func<HubMailMessageQuery, HubMailMessagePage>? MailMessagesPageFactory { get; set; }
    public Func<HubMailMessageQuery, Task<HubMailMessagePage>>? MailMessagesPageAsyncFactory { get; set; }
    public HubMailMessageQuery? LastMailQuery { get; private set; }
    public int MailMessagesCallCount { get; private set; }
    public Exception? MailFolderTreeException { get; set; }
    public HubMailFolderTree MailFolderTree { get; set; } = new() { Items = [] };
    public Exception? MailMessageDetailException { get; set; }
    public HubMailMessageDetail? MailMessageDetail { get; set; }

    /// <summary>Если задана — отвечает на запрос детали по id письма.</summary>
    public Func<string, HubMailMessageDetail>? MailMessageDetailFactory { get; set; }
    public string? LastMailMessageId { get; private set; }
    public Exception? MailActionException { get; set; }
    public List<string> MailReadMarkedIds { get; } = [];
    public List<string> MailUnreadMarkedIds { get; } = [];
    public List<(string MessageId, bool Permanent)> MailDeletedIds { get; } = [];
    public List<(string MessageId, string TargetFolder)> MailMovedIds { get; } = [];
    public HubMailUnreadCount MailUnreadCount { get; set; } = new();

    // Отправка/черновики/вложения/bulk почты
    public Exception? MailSendException { get; set; }
    public Exception? MailDraftSaveException { get; set; }
    public Exception? MailDraftDeleteException { get; set; }
    public Exception? MailContactsException { get; set; }
    public Exception? MailAttachmentDownloadException { get; set; }
    public Exception? MailBulkException { get; set; }
    public HubMailSendResult MailSendResult { get; set; } = new()
    {
        Ok = true,
        MessageId = "sent-1",
        MailboxId = "mb-1",
    };
    public HubMailDraftSaveResult MailDraftSaveResult { get; set; } = new()
    {
        Ok = true,
        DraftId = "draft-1",
    };
    public HubMailBulkResult MailBulkResult { get; set; } = new() { Ok = true };
    public List<HubMailSendRequest> MailSentRequests { get; } = [];
    public List<IReadOnlyList<HubMailOutgoingAttachment>?> MailSentAttachments { get; } = [];
    public List<HubMailSendRequest> MailDraftRequests { get; } = [];
    public List<(string MessageId, string AttachmentRef)> MailDownloadedAttachments { get; } = [];
    public string? MailAttachmentDownloadName { get; set; }

    /// <summary>Записывается в destination при DownloadMailAttachmentAsync (имитация тела файла).</summary>
    public byte[]? MailAttachmentBytes { get; set; }
    public List<(string Action, IReadOnlyList<string> Ids, string? TargetFolder, bool Permanent)> MailBulkCalls { get; } = [];

    // Автоподсказка контактов и удаление черновиков
    public List<HubMailContact> MailContacts { get; set; } = [];
    public string? LastMailContactQuery { get; private set; }
    public string? LastMailContactMailboxId { get; private set; }
    public int MailContactsCallCount { get; private set; }
    public List<string> MailDraftDeletedIds { get; } = [];

    // Мутации папок (создание/переименование/удаление/избранное)
    public Exception? MailFolderMutationException { get; set; }
    public List<(string? MailboxId, string Name, string? ParentFolderId, string? Scope)> MailFolderCreateCalls { get; } = [];
    public List<(string FolderId, string? MailboxId, string Name)> MailFolderRenameCalls { get; } = [];
    public List<(string FolderId, string? MailboxId)> MailFolderDeleteCalls { get; } = [];
    public List<(string FolderId, string? MailboxId, bool Favorite)> MailFolderFavoriteCalls { get; } = [];
    public HubMailFolder? MailFolderCreateResult { get; set; }
    public HubMailFolder? MailFolderRenameResult { get; set; }
    public HubMailFolderDeleteResult MailFolderDeleteResult { get; set; } = new() { Ok = true };

    // Важность письма и AI-действия (summarize / smart-replies)
    public Exception? MailImportanceException { get; set; }
    public List<(string MessageId, string? MailboxId, string Importance)> MailImportanceCalls { get; } = [];
    public HubMailImportanceResult MailImportanceResult { get; set; } = new() { Ok = true };
    public Exception? MailAiException { get; set; }
    public HubMailSummaryResult MailSummaryResult { get; set; } = new();
    public HubMailSmartRepliesResult MailSmartRepliesResult { get; set; } = new();
    public int MailSummarizeCallCount { get; private set; }
    public int MailSmartRepliesCallCount { get; private set; }

    // Шаблоны и отправка IT-заявок (/mail/templates, send-it-request*)
    public Exception? MailTemplatesException { get; set; }
    public List<HubMailTemplate> MailTemplates { get; set; } = [];
    public bool? LastMailTemplatesIncludeInactive { get; private set; }
    public int MailTemplatesCallCount { get; private set; }
    public Exception? MailItRequestException { get; set; }
    public List<(string TemplateId, IReadOnlyDictionary<string, object?> Fields)> MailItRequestCalls { get; } = [];
    public List<(string TemplateId, IReadOnlyDictionary<string, object?> Fields, IReadOnlyList<HubMailOutgoingAttachment> Attachments)> MailItRequestMultipartCalls { get; } = [];
    public HubMailSendResult MailItRequestResult { get; set; } = new() { Ok = true, MessageId = "it-req-1" };

    // Чат
    public Exception? ChatConversationsException { get; set; }
    public Exception? ChatMessagesException { get; set; }
    public Exception? ChatSendException { get; set; }
    public Exception? ChatMarkReadException { get; set; }
    public Exception? ChatUsersException { get; set; }
    public HubChatConversationList ChatConversations { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка диалогов по курсору (пагинация).</summary>
    public Func<string?, HubChatConversationList>? ChatConversationsFactory { get; set; }
    public string? LastConversationsCursor { get; private set; }
    public string? LastConversationsQuery { get; private set; }
    public int ConversationsCallCount { get; private set; }
    public HubChatMessageList ChatMessages { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы ленты по before-курсору (старшие страницы).</summary>
    public Func<string?, HubChatMessageList>? ChatMessagesFactory { get; set; }

    /// <summary>Полностью управляемый ответ истории (задержки, гонки): принимает
    /// conversationId и before-курсор; приоритетнее синхронной фабрики.</summary>
    public Func<string, string?, Task<HubChatMessageList>>? ChatMessagesAsyncFactory { get; set; }
    public Func<HubChatMessage>? SendMessageFactory { get; set; }
    public HubChatConversation? DirectConversationResult { get; set; }
    public Exception? CreateDirectException { get; set; }
    public HubChatUserList ChatUsers { get; set; } = new() { Items = [] };
    public List<int> CreatedDirectConversations { get; } = [];
    public List<(string? Query, int Limit)> ChatUsersQueries { get; } = [];
    public string? LastMessagesConversationId { get; private set; }
    public string? LastBeforeMessageId { get; private set; }
    public string? LastAfterMessageId { get; private set; }
    public List<(string ConversationId, string Body)> SentMessages { get; } = [];
    public List<(string ConversationId, string MessageId)> ReadMarkedMessages { get; } = [];
    // null по умолчанию: иначе шелл-тесты с собственным HubChatRealtimeClient
    // открывают настоящий WebSocket на боевой хост.
    public string? AccessTokenToReturn { get; set; }

    public Uri BaseUri { get; set; } = new("https://hubit.zsgp.ru");

    public event EventHandler? SessionEnded;

    public void RaiseSessionEnded() => SessionEnded?.Invoke(this, EventArgs.Empty);

    public Task<NativeSession?> RestoreSessionAsync(CancellationToken cancellationToken)
    {
        RefreshCallCount++;
        CurrentSession = StoredSession;
        return Task.FromResult(StoredSession);
    }

    public Task<HubLoginResult> LoginAsync(
        string username,
        string password,
        CancellationToken cancellationToken)
    {
        LastLoginUsername = username;
        if (LoginException is not null)
        {
            return Task.FromException<HubLoginResult>(LoginException);
        }

        var result = LoginResult
            ?? new HubLoginResult(HubLoginStatus.Authenticated, StoredSession, null, []);
        CurrentSession = result.Session;
        return Task.FromResult(result);
    }

    public Task<HubLoginResult> VerifyTwoFactorLoginAsync(
        string loginChallengeId,
        string? totpCode,
        string? backupCode,
        CancellationToken cancellationToken)
    {
        LastChallengeId = loginChallengeId;
        LastTotpCode = totpCode;
        var result = TwoFactorResult
            ?? new HubLoginResult(HubLoginStatus.Authenticated, StoredSession, null, []);
        CurrentSession = result.Session;
        return Task.FromResult(result);
    }

    public Task<HubTaskListPage> GetMyTasksAsync(
        HubTaskQuery query,
        CancellationToken cancellationToken)
    {
        TasksCallCount++;
        LastQuery = query;
        if (TasksException is not null)
        {
            return Task.FromException<HubTaskListPage>(TasksException);
        }

        return Task.FromResult(TasksPageFactory?.Invoke(query) ?? TasksPage);
    }

    public Task<HubDashboard> GetDashboardAsync(
        int announcementsLimit,
        int tasksLimit,
        CancellationToken cancellationToken)
    {
        DashboardCallCount++;
        LastAnnouncementsLimit = announcementsLimit;
        LastTasksLimit = tasksLimit;
        if (DashboardException is not null)
        {
            return Task.FromException<HubDashboard>(DashboardException);
        }

        return Task.FromResult(Dashboard);
    }

    public Task<HubTaskDetail> GetTaskAsync(
        long taskId,
        CancellationToken cancellationToken) =>
        Task.FromResult(TaskDetail ?? new HubTaskDetail
        {
            Id = taskId,
            Title = "task",
            Status = "new",
            Capabilities = new HubTaskCapabilities(),
        });

    public Task<HubTaskDetail> TransitionTaskAsync(
        long taskId,
        HubTaskTransition transition,
        string? comment,
        CancellationToken cancellationToken)
    {
        LastTransition = transition;
        LastTransitionComment = comment;
        // Имитация сервера: переход меняет статус и в выдаче списка.
        var newStatus = transition switch
        {
            HubTaskTransition.Start or HubTaskTransition.Reopen or HubTaskTransition.Reject => "in_progress",
            HubTaskTransition.Submit => "review",
            _ => "done",
        };
        var items = (TasksPage.Items ?? [])
            .Select(item => item.Id == taskId
                ? item with { Status = newStatus, IsOverdue = false }
                : item)
            .ToList();
        TasksPage = TasksPage with { Items = items };
        var result = TransitionResult ?? new HubTaskDetail
        {
            Id = taskId,
            Title = "task",
            Status = newStatus,
            Capabilities = new HubTaskCapabilities(),
        };
        return Task.FromResult(result);
    }

    public Task<HubTaskCommentList> GetTaskCommentsAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        TaskCommentListCalls.Add(taskId);
        if (TaskCommentsException is not null)
        {
            return Task.FromException<HubTaskCommentList>(TaskCommentsException);
        }

        return Task.FromResult(TaskComments);
    }

    public Task<HubTaskComment> AddTaskCommentAsync(
        long taskId,
        string body,
        CancellationToken cancellationToken)
    {
        TaskCommentCreateCalls.Add((taskId, body));
        if (TaskCommentCreateException is not null)
        {
            return Task.FromException<HubTaskComment>(TaskCommentCreateException);
        }

        return Task.FromResult(TaskCommentCreateFactory?.Invoke(taskId, body) ?? new HubTaskComment
        {
            Id = Guid.NewGuid().ToString("D"),
            TaskId = taskId.ToString(CultureInfo.InvariantCulture),
            UserId = 7,
            Username = "tester",
            FullName = "Test User",
            Body = body,
            CreatedAt = DateTimeOffset.UtcNow,
        });
    }

    public Task MarkTaskCommentsSeenAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        TaskMarkSeenCalls.Add(taskId);
        return TaskMarkSeenException is not null
            ? Task.FromException(TaskMarkSeenException)
            : Task.CompletedTask;
    }

    public Task<HubTaskDiscussion> OpenTaskDiscussionAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        TaskDiscussionCalls.Add(taskId);
        if (TaskDiscussionException is not null)
        {
            return Task.FromException<HubTaskDiscussion>(TaskDiscussionException);
        }

        return Task.FromResult(TaskDiscussion ?? new HubTaskDiscussion
        {
            ConversationId = "conv-" + taskId.ToString(CultureInfo.InvariantCulture),
            Created = true,
            Title = "Задача: task",
            Kind = "task",
        });
    }

    public Task<HubTaskAttachment> UploadTaskAttachmentAsync(
        long taskId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken)
    {
        TaskAttachmentUploadCalls.Add((taskId, fileName));
        if (TaskAttachmentUploadException is not null)
        {
            return Task.FromException<HubTaskAttachment>(TaskAttachmentUploadException);
        }

        return Task.FromResult(TaskAttachmentUploadFactory?.Invoke(taskId, fileName) ?? new HubTaskAttachment
        {
            Id = Guid.NewGuid().ToString("D"),
            TaskId = taskId.ToString(CultureInfo.InvariantCulture),
            Scope = "task",
            FileName = fileName,
            FileMime = mimeType,
            FileSize = content.Length,
            UploadedByUserId = 7,
            UploadedByUsername = "tester",
            UploadedAt = DateTimeOffset.UtcNow,
        });
    }

    public Task DeleteTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        CancellationToken cancellationToken)
    {
        TaskAttachmentDeleteCalls.Add((taskId, attachmentId));
        return TaskAttachmentDeleteException is not null
            ? Task.FromException(TaskAttachmentDeleteException)
            : Task.CompletedTask;
    }

    public async Task<string> DownloadTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        TaskAttachmentDownloadCalls.Add((taskId, attachmentId));
        if (TaskAttachmentDownloadException is not null)
        {
            throw TaskAttachmentDownloadException;
        }

        await destination.WriteAsync(TaskAttachmentBytes, cancellationToken);
        return TaskAttachmentDownloadFileName;
    }

    public async Task<string> DownloadTaskAttachmentPreviewPdfAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        TaskAttachmentPreviewCalls.Add((taskId, attachmentId));
        if (TaskAttachmentPreviewException is not null)
        {
            throw TaskAttachmentPreviewException;
        }

        await destination.WriteAsync(TaskAttachmentBytes, cancellationToken);
        return TaskAttachmentPreviewFileName;
    }

    public Task<HubTaskCreateResult> CreateTaskAsync(
        HubTaskCreateRequest request,
        CancellationToken cancellationToken)
    {
        TaskCreateCalls.Add(request);
        if (TaskCreateException is not null)
        {
            return Task.FromException<HubTaskCreateResult>(TaskCreateException);
        }

        return Task.FromResult(TaskCreateFactory?.Invoke(request) ?? TaskCreateResult);
    }

    public Task<HubTaskDetail> CreateSubtaskAsync(
        long taskId,
        HubTaskSubtaskCreateRequest request,
        CancellationToken cancellationToken)
    {
        SubtaskCreateCalls.Add((taskId, request));
        if (SubtaskCreateException is not null)
        {
            return Task.FromException<HubTaskDetail>(SubtaskCreateException);
        }

        return Task.FromResult(
            SubtaskCreateFactory?.Invoke(taskId, request)
            ?? new HubTaskDetail { Id = taskId + 1000, Title = request.Title });
    }

    public Task<HubTaskUserList> SearchTaskAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        TaskAssigneeSearchCalls.Add((query, limit));
        if (TaskAssigneeSearchException is not null)
        {
            return Task.FromException<HubTaskUserList>(TaskAssigneeSearchException);
        }

        return Task.FromResult(TaskAssignees);
    }

    public Task<HubTaskUserList> GetTaskControllersAsync(CancellationToken cancellationToken)
    {
        TaskControllersCallCount++;
        if (TaskControllersException is not null)
        {
            return Task.FromException<HubTaskUserList>(TaskControllersException);
        }

        return Task.FromResult(TaskControllers);
    }

    public Task<HubTaskProjectList> GetTaskProjectsAsync(CancellationToken cancellationToken)
    {
        TaskProjectsCallCount++;
        if (TaskProjectsException is not null)
        {
            return Task.FromException<HubTaskProjectList>(TaskProjectsException);
        }

        return Task.FromResult(TaskProjects);
    }

    public Task<HubTaskObjectList> GetTaskObjectsAsync(
        string? projectId,
        CancellationToken cancellationToken)
    {
        TaskObjectsCallCount++;
        LastTaskObjectsProjectId = projectId;
        if (TaskObjectsException is not null)
        {
            return Task.FromException<HubTaskObjectList>(TaskObjectsException);
        }

        return Task.FromResult(TaskObjects);
    }

    public Task<HubTaskAnalyticsPayload> GetTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        CancellationToken cancellationToken)
    {
        TaskAnalyticsCalls.Add(query);
        if (TaskAnalyticsException is not null)
        {
            return Task.FromException<HubTaskAnalyticsPayload>(TaskAnalyticsException);
        }

        return TaskAnalyticsHandler?.Invoke(query, cancellationToken)
            ?? Task.FromResult(TaskAnalyticsPayload);
    }

    public async Task<string> ExportTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        Stream destination,
        CancellationToken cancellationToken)
    {
        TaskAnalyticsExportCalls.Add(query);
        if (TaskAnalyticsExportException is not null)
        {
            throw TaskAnalyticsExportException;
        }

        await destination.WriteAsync(TaskAnalyticsExportBytes, cancellationToken);
        return TaskAnalyticsExportFileName;
    }

    public Task<HubAnnouncementListPage> GetAnnouncementsAsync(
        HubAnnouncementQuery query,
        CancellationToken cancellationToken)
    {
        LastAnnouncementsQuery = query;
        if (AnnouncementsException is not null)
        {
            return Task.FromException<HubAnnouncementListPage>(AnnouncementsException);
        }

        return Task.FromResult(AnnouncementsPageFactory?.Invoke(query) ?? AnnouncementsPage);
    }

    public Task<HubAnnouncementItem> GetAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        LastAnnouncementId = announcementId;
        if (AnnouncementDetailException is not null)
        {
            return Task.FromException<HubAnnouncementItem>(AnnouncementDetailException);
        }

        var item = AnnouncementDetail
            ?? (AnnouncementsPage.Items ?? []).FirstOrDefault(a => a.Id == announcementId)
            ?? new HubAnnouncementItem { Id = announcementId, Title = "Объявление" };
        return Task.FromResult(item);
    }

    public Task MarkAnnouncementReadAsync(string announcementId, CancellationToken cancellationToken)
    {
        if (MarkReadException is not null)
        {
            return Task.FromException(MarkReadException);
        }

        ReadMarkedIds.Add(announcementId);
        return Task.CompletedTask;
    }

    public Task AckAnnouncementAsync(string announcementId, CancellationToken cancellationToken)
    {
        if (AckException is not null)
        {
            return Task.FromException(AckException);
        }

        AckedIds.Add(announcementId);
        return Task.CompletedTask;
    }

    public Task<HubAnnouncementReactionState> SetAnnouncementReactionAsync(
        string announcementId,
        string reactionType,
        CancellationToken cancellationToken)
    {
        AnnouncementReactionCalls.Add((announcementId, reactionType));
        if (AnnouncementReactionException is not null)
        {
            return Task.FromException<HubAnnouncementReactionState>(AnnouncementReactionException);
        }

        return Task.FromResult(AnnouncementReactionResult ?? new HubAnnouncementReactionState
        {
            AnnouncementId = announcementId,
            ViewerReaction = reactionType,
            ReactionCounts = new Dictionary<string, int> { [reactionType] = 1 },
            ReactionsCount = 1,
            ViewerHasLiked = reactionType == "like",
            LikesCount = reactionType == "like" ? 1 : 0,
        });
    }

    public Task<HubAnnouncementReactionState> ClearAnnouncementReactionAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        AnnouncementReactionCalls.Add((announcementId, null));
        if (AnnouncementReactionException is not null)
        {
            return Task.FromException<HubAnnouncementReactionState>(AnnouncementReactionException);
        }

        return Task.FromResult(AnnouncementReactionResult ?? new HubAnnouncementReactionState
        {
            AnnouncementId = announcementId,
        });
    }

    public Task<HubAnnouncementReactionUserList> GetAnnouncementReactionUsersAsync(
        string announcementId,
        string? reactionType,
        int limit,
        int offset,
        CancellationToken cancellationToken) => Task.FromResult(AnnouncementReactionUsers);

    public Task<HubAnnouncementReactionState> SetAnnouncementLikeAsync(
        string announcementId,
        bool liked,
        CancellationToken cancellationToken)
    {
        AnnouncementLikeCalls.Add((announcementId, liked));
        if (AnnouncementLikeException is not null)
        {
            return Task.FromException<HubAnnouncementReactionState>(AnnouncementLikeException);
        }

        return Task.FromResult(AnnouncementReactionResult ?? new HubAnnouncementReactionState
        {
            AnnouncementId = announcementId,
            ViewerReaction = liked ? "like" : null,
            ReactionCounts = liked ? new Dictionary<string, int> { ["like"] = 1 } : new(),
            ReactionsCount = liked ? 1 : 0,
            ViewerHasLiked = liked,
            LikesCount = liked ? 1 : 0,
        });
    }

    public Task<HubAnnouncementBookmarkState> SetAnnouncementBookmarkAsync(
        string announcementId,
        bool bookmarked,
        CancellationToken cancellationToken)
    {
        AnnouncementBookmarkCalls.Add((announcementId, bookmarked));
        if (AnnouncementBookmarkException is not null)
        {
            return Task.FromException<HubAnnouncementBookmarkState>(AnnouncementBookmarkException);
        }

        return Task.FromResult(new HubAnnouncementBookmarkState
        {
            AnnouncementId = announcementId,
            ViewerBookmarked = bookmarked,
        });
    }

    public Task<HubAnnouncementPollVoteResult> VoteAnnouncementPollAsync(
        string announcementId,
        IReadOnlyList<string> optionIds,
        CancellationToken cancellationToken)
    {
        AnnouncementVoteCalls.Add((announcementId, optionIds.ToArray()));
        if (AnnouncementVoteException is not null)
        {
            return Task.FromException<HubAnnouncementPollVoteResult>(AnnouncementVoteException);
        }

        if (AnnouncementVoteResult is not null)
        {
            return Task.FromResult(AnnouncementVoteResult);
        }

        // Проекция голоса на опрос детали: счётчики пересчитываются «как сервер» —
        // старый голос снимается, новые варианты получают +1.
        var poll = AnnouncementDetail?.Poll;
        if (poll is null)
        {
            return Task.FromResult(new HubAnnouncementPollVoteResult { AnnouncementId = announcementId });
        }

        var voted = new HashSet<string>(optionIds, StringComparer.Ordinal);
        var options = (poll.Options ?? [])
            .Select(o =>
            {
                var votes = o.VotesCount - (o.ViewerVoted ? 1 : 0)
                    + (o.Id is not null && voted.Contains(o.Id) ? 1 : 0);
                return new HubAnnouncementPollOption
                {
                    Id = o.Id,
                    Text = o.Text,
                    SortOrder = o.SortOrder,
                    VotesCount = votes,
                    ViewerVoted = o.Id is not null && voted.Contains(o.Id),
                };
            })
            .ToList();
        var updated = poll with
        {
            Options = options,
            ViewerOptionIds = optionIds,
            HasVoted = optionIds.Count > 0,
            TotalVoters = poll.TotalVoters - (poll.HasVoted ? 1 : 0) + (optionIds.Count > 0 ? 1 : 0),
            TotalVotes = options.Sum(o => o.VotesCount),
        };
        AnnouncementDetail = AnnouncementDetail! with { Poll = updated };
        return Task.FromResult(new HubAnnouncementPollVoteResult
        {
            AnnouncementId = announcementId,
            Poll = updated,
        });
    }

    public Task<HubAnnouncementCommentPage> GetAnnouncementCommentsAsync(
        string announcementId,
        HubAnnouncementCommentQuery query,
        CancellationToken cancellationToken)
    {
        AnnouncementCommentListCalls.Add((announcementId, query));
        if (AnnouncementCommentsException is not null)
        {
            return Task.FromException<HubAnnouncementCommentPage>(AnnouncementCommentsException);
        }

        return Task.FromResult(
            AnnouncementCommentsPageFactory?.Invoke(query) ?? AnnouncementCommentsPage);
    }

    public Task<HubAnnouncementComment> CreateAnnouncementCommentAsync(
        string announcementId,
        string body,
        string? parentCommentId,
        CancellationToken cancellationToken)
    {
        AnnouncementCommentCreateCalls.Add((announcementId, body, parentCommentId));
        if (AnnouncementCommentCreateException is not null)
        {
            return Task.FromException<HubAnnouncementComment>(AnnouncementCommentCreateException);
        }

        if (AnnouncementCommentCreateFactory is not null)
        {
            return Task.FromResult(AnnouncementCommentCreateFactory(body, parentCommentId));
        }

        return Task.FromResult(new HubAnnouncementComment
        {
            Id = Guid.NewGuid().ToString("N")[..8],
            AnnouncementId = announcementId,
            Body = body,
            ParentCommentId = parentCommentId,
            RootCommentId = parentCommentId,
            FullName = "Иван Иванов",
            Username = "ivanov",
            CreatedAt = DateTimeOffset.Now,
            CanEdit = true,
            CanDelete = true,
        });
    }

    public Task<HubAnnouncementComment> UpdateAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        string body,
        CancellationToken cancellationToken)
    {
        AnnouncementCommentUpdateCalls.Add((announcementId, commentId, body));
        return Task.FromResult(new HubAnnouncementComment
        {
            Id = commentId,
            AnnouncementId = announcementId,
            Body = body,
            CreatedAt = DateTimeOffset.Now.AddMinutes(-10),
            UpdatedAt = DateTimeOffset.Now,
            CanEdit = true,
            CanDelete = true,
        });
    }

    public Task DeleteAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        CancellationToken cancellationToken)
    {
        AnnouncementCommentDeleteCalls.Add((announcementId, commentId));
        return Task.CompletedTask;
    }

    public Task<HubAnnouncementCommentReactionState> SetAnnouncementCommentReactionAsync(
        string announcementId,
        string commentId,
        string? reactionType,
        CancellationToken cancellationToken)
    {
        AnnouncementCommentReactionCalls.Add((announcementId, commentId, reactionType));
        return Task.FromResult(new HubAnnouncementCommentReactionState
        {
            CommentId = commentId,
            ViewerReaction = reactionType,
            ReactionCounts = reactionType is null
                ? new Dictionary<string, int>()
                : new Dictionary<string, int> { [reactionType] = 1 },
        });
    }

    public Task<string> DownloadAnnouncementAttachmentAsync(
        string announcementId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken) =>
        WriteAnnouncementAttachmentAsync(announcementId, null, attachmentId, destination);

    public Task<string> DownloadAnnouncementCommentAttachmentAsync(
        string announcementId,
        string commentId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken) =>
        WriteAnnouncementAttachmentAsync(announcementId, commentId, attachmentId, destination);

    private async Task<string> WriteAnnouncementAttachmentAsync(
        string announcementId,
        string? commentId,
        string attachmentId,
        Stream destination)
    {
        AnnouncementAttachmentDownloads.Add((announcementId, commentId, attachmentId));
        if (AnnouncementAttachmentDownloadException is not null)
        {
            throw AnnouncementAttachmentDownloadException;
        }

        await destination.WriteAsync(AnnouncementAttachmentBytes);
        return AnnouncementAttachmentFileName;
    }

    public Task<HubAbsenceRangeList> GetAbsencesAsync(
        string? on,
        string? startsOn,
        string? endsOn,
        int limit,
        CancellationToken cancellationToken)
    {
        AbsencesCallCount++;
        LastAbsencesOn = on;
        LastAbsencesStartsOn = startsOn;
        LastAbsencesEndsOn = endsOn;
        if (AbsencesException is not null)
        {
            return Task.FromException<HubAbsenceRangeList>(AbsencesException);
        }

        return Task.FromResult(AbsencesList);
    }

    public Task<HubAbsenceItem> CreateHubAbsenceAsync(
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken)
    {
        AbsenceCreateCalls.Add(request);
        if (AbsenceCreateException is not null)
        {
            return Task.FromException<HubAbsenceItem>(AbsenceCreateException);
        }

        return Task.FromResult(AbsenceWriteResult ?? new HubAbsenceItem
        {
            Id = (900 + AbsenceCreateCalls.Count).ToString(),
            DisplayName = request.DisplayName,
            Kind = request.Kind,
            StartsOn = request.StartsOn,
            EndsOn = request.EndsOn,
            Comment = request.Comment,
            Department = request.Department,
            Source = "manual",
        });
    }

    public Task<HubAbsenceItem> UpdateHubAbsenceAsync(
        long absenceId,
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken)
    {
        AbsenceUpdateCalls.Add((absenceId, request));
        if (AbsenceUpdateException is not null)
        {
            return Task.FromException<HubAbsenceItem>(AbsenceUpdateException);
        }

        return Task.FromResult(AbsenceWriteResult ?? new HubAbsenceItem
        {
            Id = absenceId.ToString(),
            DisplayName = request.DisplayName,
            Kind = request.Kind,
            StartsOn = request.StartsOn,
            EndsOn = request.EndsOn,
            Comment = request.Comment,
            Department = request.Department,
            Source = "manual",
        });
    }

    public Task DeleteHubAbsenceAsync(long absenceId, CancellationToken cancellationToken)
    {
        AbsenceDeleteCalls.Add(absenceId);
        return AbsenceDeleteException is not null
            ? Task.FromException(AbsenceDeleteException)
            : Task.CompletedTask;
    }

    public Task<HubNotificationPoll> GetNotificationsPollAsync(
        string? since,
        int limit,
        bool unreadOnly,
        CancellationToken cancellationToken)
    {
        NotificationsPollCallCount++;
        LastNotificationsPollSince = since;
        LastNotificationsPollLimit = limit;
        LastNotificationsPollUnreadOnly = unreadOnly;
        if (NotificationsPollException is not null)
        {
            return Task.FromException<HubNotificationPoll>(NotificationsPollException);
        }

        return NotificationsPollHandler?.Invoke(cancellationToken)
            ?? Task.FromResult(
                NotificationsPollFactory?.Invoke(since, limit, unreadOnly) ?? NotificationsPoll);
    }

    public Task<HubNotificationUnreadCounts> GetNotificationUnreadCountsAsync(
        CancellationToken cancellationToken)
    {
        NotificationUnreadCountsCallCount++;
        if (NotificationUnreadCountsException is not null)
        {
            return Task.FromException<HubNotificationUnreadCounts>(NotificationUnreadCountsException);
        }

        return Task.FromResult(NotificationUnreadCounts);
    }

    public Task<HubNotificationReadResult> MarkNotificationReadAsync(
        string notificationId,
        CancellationToken cancellationToken)
    {
        NotificationReadMarkedIds.Add(notificationId);
        if (NotificationMarkReadException is not null)
        {
            return Task.FromException<HubNotificationReadResult>(NotificationMarkReadException);
        }

        // Имитация сервера: отметка фиксируется и в отложенном poll-ответе.
        var updated = NotificationsPoll.Items?.Select(item =>
            item.Id == notificationId ? item with { Unread = 0 } : item).ToList();
        NotificationsPoll = NotificationsPoll with { Items = updated };
        return Task.FromResult(new HubNotificationReadResult
        {
            Ok = true,
            NotificationId = notificationId,
        });
    }

    public Task<HubNotificationReadAllResult> MarkAllNotificationsReadAsync(
        CancellationToken cancellationToken)
    {
        NotificationReadAllCallCount++;
        if (NotificationReadAllException is not null)
        {
            return Task.FromException<HubNotificationReadAllResult>(NotificationReadAllException);
        }

        var marked = NotificationsPoll.Items?.Count(item => item.Unread != 0) ?? 0;
        NotificationsPoll = NotificationsPoll with
        {
            Items = NotificationsPoll.Items?.Select(item => item with { Unread = 0 }).ToList(),
        };
        return Task.FromResult(NotificationReadAllResult with
        {
            Ok = true,
            MarkedCount = marked,
        });
    }

    public Task<HubMailBootstrap> GetMailBootstrapAsync(
        int limit,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailBootstrapCallCount++;
        if (MailBootstrapException is not null)
        {
            return Task.FromException<HubMailBootstrap>(MailBootstrapException);
        }

        return Task.FromResult(MailBootstrap);
    }

    public Task<HubMailFolderTree> GetMailFolderTreeAsync(
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        if (MailFolderTreeException is not null)
        {
            return Task.FromException<HubMailFolderTree>(MailFolderTreeException);
        }

        return Task.FromResult(MailFolderTree);
    }

    public Task<HubMailMessagePage> GetMailMessagesAsync(
        HubMailMessageQuery query,
        CancellationToken cancellationToken)
    {
        MailMessagesCallCount++;
        LastMailQuery = query;
        if (MailMessagesException is not null)
        {
            return Task.FromException<HubMailMessagePage>(MailMessagesException);
        }

        return MailMessagesPageAsyncFactory?.Invoke(query)
            ?? Task.FromResult(MailMessagesPageFactory?.Invoke(query) ?? MailMessagesPage);
    }

    public Task<HubMailMessageDetail> GetMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        LastMailMessageId = messageId;
        if (MailMessageDetailException is not null)
        {
            return Task.FromException<HubMailMessageDetail>(MailMessageDetailException);
        }

        return Task.FromResult(
            MailMessageDetailFactory?.Invoke(messageId)
            ?? MailMessageDetail
            ?? new HubMailMessageDetail { Id = messageId, IsRead = true });
    }

    public Task<HubMailActionResult> MarkMailMessageReadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        if (MailActionException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailActionException);
        }

        MailReadMarkedIds.Add(messageId);
        return Task.FromResult(new HubMailActionResult { Ok = true });
    }

    public Task<HubMailActionResult> MarkMailMessageUnreadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        if (MailActionException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailActionException);
        }

        MailUnreadMarkedIds.Add(messageId);
        return Task.FromResult(new HubMailActionResult { Ok = true });
    }

    public Task<HubMailActionResult> DeleteMailMessageAsync(
        string messageId,
        string? mailboxId,
        bool permanent,
        CancellationToken cancellationToken)
    {
        if (MailActionException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailActionException);
        }

        MailDeletedIds.Add((messageId, permanent));
        return Task.FromResult(new HubMailActionResult { Ok = true });
    }

    public List<(string MessageId, string? MailboxId)> MailRestoreCalls { get; } = [];

    public Exception? MailRestoreException { get; set; }

    public Task<HubMailActionResult> RestoreMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailRestoreCalls.Add((messageId, mailboxId));
        if (MailRestoreException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailRestoreException);
        }

        return Task.FromResult(new HubMailActionResult { Ok = true, MovedTo = "inbox" });
    }

    public List<(string MessageId, string? MailboxId)> MailHeadersCalls { get; } = [];

    public Exception? MailHeadersException { get; set; }

    public Task<HubMailMessageHeaders> GetMailMessageHeadersAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailHeadersCalls.Add((messageId, mailboxId));
        if (MailHeadersException is not null)
        {
            return Task.FromException<HubMailMessageHeaders>(MailHeadersException);
        }

        return Task.FromResult(MailHeadersResult);
    }

    public HubMailMessageHeaders MailHeadersResult { get; set; } = new()
    {
        MessageId = "m1",
        SourceName = "message.eml",
        Items =
        [
            new HubMailMessageHeaderItem { Name = "Received", Value = "from mail.zsgp.ru by hub.zsgp.ru with SMTP; Fri, 20 Nov 2026 10:00:00 +0300" },
            new HubMailMessageHeaderItem { Name = "Message-ID", Value = "<CALd=eM1@mail.zsgp.ru>" },
            new HubMailMessageHeaderItem { Name = "Subject", Value = "Регламентные работы в ДЦ — график на выходные" },
        ],
    };

    public List<string> MailSourceDownloadCalls { get; } = [];

    public Exception? MailSourceDownloadException { get; set; }

    public Task<string> DownloadMailMessageSourceAsync(
        string messageId,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        MailSourceDownloadCalls.Add(messageId);
        if (MailSourceDownloadException is not null)
        {
            return Task.FromException<string>(MailSourceDownloadException);
        }

        var payload = "From: sender@zsgp.ru"u8.ToArray();
        destination.Write(payload, 0, payload.Length);
        return Task.FromResult("message.eml");
    }

    public Task<HubMailActionResult> MoveMailMessageAsync(
        string messageId,
        string? mailboxId,
        string targetFolder,
        CancellationToken cancellationToken)
    {
        if (MailActionException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailActionException);
        }

        MailMovedIds.Add((messageId, targetFolder));
        return Task.FromResult(new HubMailActionResult { Ok = true, MovedTo = targetFolder });
    }

    public Task<HubMailSendResult> SendMailMessageAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken)
    {
        MailSentRequests.Add(request);
        MailSentAttachments.Add(attachments);
        if (MailSendException is not null)
        {
            return Task.FromException<HubMailSendResult>(MailSendException);
        }

        return Task.FromResult(MailSendResult);
    }

    public Task<HubMailDraftSaveResult> SaveMailDraftAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken)
    {
        MailDraftRequests.Add(request);
        if (MailDraftSaveException is not null)
        {
            return Task.FromException<HubMailDraftSaveResult>(MailDraftSaveException);
        }

        return Task.FromResult(MailDraftSaveResult);
    }

    public Task<HubMailActionResult> DeleteMailDraftAsync(
        string draftId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailDraftDeletedIds.Add(draftId);
        if (MailDraftDeleteException is not null)
        {
            return Task.FromException<HubMailActionResult>(MailDraftDeleteException);
        }

        return Task.FromResult(new HubMailActionResult { Ok = true });
    }

    public Task<IReadOnlyList<HubMailContact>> SearchMailContactsAsync(
        string query,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailContactsCallCount++;
        LastMailContactQuery = query;
        LastMailContactMailboxId = mailboxId;
        if (MailContactsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubMailContact>>(MailContactsException);
        }

        return Task.FromResult<IReadOnlyList<HubMailContact>>(MailContacts);
    }

    public async Task<string> DownloadMailAttachmentAsync(
        string messageId,
        string attachmentRef,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        MailDownloadedAttachments.Add((messageId, attachmentRef));
        if (MailAttachmentDownloadException is not null)
        {
            throw MailAttachmentDownloadException;
        }

        if (MailAttachmentBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return MailAttachmentDownloadName ?? string.Empty;
    }

    public Task<HubMailBulkResult> BulkMailMessageActionAsync(
        string? mailboxId,
        string action,
        IReadOnlyList<string> messageIds,
        string? targetFolder,
        bool permanent,
        CancellationToken cancellationToken)
    {
        MailBulkCalls.Add((action, messageIds, targetFolder, permanent));
        if (MailBulkException is not null)
        {
            return Task.FromException<HubMailBulkResult>(MailBulkException);
        }

        var result = MailBulkResult;
        return Task.FromResult(result with
        {
            Action = action,
            Processed = messageIds.Count,
            Succeeded = result.Succeeded == 0 && result.Failed == 0
                ? messageIds.Count
                : result.Succeeded,
        });
    }

    public int MailUnreadCountCallCount { get; private set; }
    public Exception? MailUnreadCountException { get; set; }

    public Task<HubMailUnreadCount> GetMailUnreadCountAsync(
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailUnreadCountCallCount++;
        if (MailUnreadCountException is not null)
        {
            return Task.FromException<HubMailUnreadCount>(MailUnreadCountException);
        }

        return Task.FromResult(MailUnreadCount);
    }

    public Task<HubMailFolder> CreateMailFolderAsync(
        string? mailboxId,
        string name,
        string? parentFolderId,
        string? scope,
        CancellationToken cancellationToken)
    {
        MailFolderCreateCalls.Add((mailboxId, name, parentFolderId, scope));
        if (MailFolderMutationException is not null)
        {
            return Task.FromException<HubMailFolder>(MailFolderMutationException);
        }

        return Task.FromResult(MailFolderCreateResult ?? new HubMailFolder
        {
            Id = "custom-" + (MailFolderCreateCalls.Count + 100),
            Name = name,
            Label = name,
            Scope = string.IsNullOrWhiteSpace(scope) ? "mailbox" : scope,
            ParentId = parentFolderId,
            IconKey = "folder",
            CanRename = true,
            CanDelete = true,
            CanCreateChildren = true,
        });
    }

    public Task<HubMailFolder> RenameMailFolderAsync(
        string folderId,
        string? mailboxId,
        string name,
        CancellationToken cancellationToken)
    {
        MailFolderRenameCalls.Add((folderId, mailboxId, name));
        if (MailFolderMutationException is not null)
        {
            return Task.FromException<HubMailFolder>(MailFolderMutationException);
        }

        return Task.FromResult(MailFolderRenameResult ?? new HubMailFolder
        {
            Id = folderId,
            Name = name,
            Label = name,
            Scope = "mailbox",
            IconKey = "folder",
            CanRename = true,
            CanDelete = true,
            CanCreateChildren = true,
        });
    }

    public Task<HubMailFolderDeleteResult> DeleteMailFolderAsync(
        string folderId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailFolderDeleteCalls.Add((folderId, mailboxId));
        if (MailFolderMutationException is not null)
        {
            return Task.FromException<HubMailFolderDeleteResult>(MailFolderMutationException);
        }

        return Task.FromResult(MailFolderDeleteResult with { FolderId = folderId });
    }

    public Task<HubMailFolderFavoriteResult> SetMailFolderFavoriteAsync(
        string folderId,
        string? mailboxId,
        bool favorite,
        CancellationToken cancellationToken)
    {
        MailFolderFavoriteCalls.Add((folderId, mailboxId, favorite));
        if (MailFolderMutationException is not null)
        {
            return Task.FromException<HubMailFolderFavoriteResult>(MailFolderMutationException);
        }

        return Task.FromResult(new HubMailFolderFavoriteResult
        {
            Ok = true,
            FolderId = folderId,
            Favorite = favorite,
        });
    }

    public Task<HubMailImportanceResult> SetMailMessageImportanceAsync(
        string messageId,
        string? mailboxId,
        string importance,
        CancellationToken cancellationToken)
    {
        MailImportanceCalls.Add((messageId, mailboxId, importance));
        if (MailImportanceException is not null)
        {
            return Task.FromException<HubMailImportanceResult>(MailImportanceException);
        }

        return Task.FromResult(MailImportanceResult with { Importance = importance });
    }

    public Task<HubMailSummaryResult> SummarizeMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailSummarizeCallCount++;
        if (MailAiException is not null)
        {
            return Task.FromException<HubMailSummaryResult>(MailAiException);
        }

        return Task.FromResult(MailSummaryResult);
    }

    public Task<HubMailSmartRepliesResult> GetMailSmartRepliesAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        MailSmartRepliesCallCount++;
        if (MailAiException is not null)
        {
            return Task.FromException<HubMailSmartRepliesResult>(MailAiException);
        }

        return Task.FromResult(MailSmartRepliesResult);
    }

    public Task<IReadOnlyList<HubMailTemplate>> GetMailTemplatesAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        MailTemplatesCallCount++;
        LastMailTemplatesIncludeInactive = includeInactive;
        if (MailTemplatesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubMailTemplate>>(MailTemplatesException);
        }

        return Task.FromResult<IReadOnlyList<HubMailTemplate>>(MailTemplates);
    }

    public List<string?> MailItRequestSendKeys { get; } = [];

    public Task<HubMailSendResult> SendMailItRequestAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken,
        string? idempotencyKey = null)
    {
        MailItRequestSendKeys.Add(idempotencyKey);
        MailItRequestCalls.Add((templateId, fields));
        if (MailItRequestException is not null)
        {
            return Task.FromException<HubMailSendResult>(MailItRequestException);
        }

        return Task.FromResult(MailItRequestResult);
    }

    public Task<HubMailSendResult> SendMailItRequestMultipartAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<HubMailOutgoingAttachment> attachments,
        CancellationToken cancellationToken,
        string? idempotencyKey = null)
    {
        MailItRequestSendKeys.Add(idempotencyKey);
        MailItRequestMultipartCalls.Add((templateId, fields, attachments));
        if (MailItRequestException is not null)
        {
            return Task.FromException<HubMailSendResult>(MailItRequestException);
        }

        return Task.FromResult(MailItRequestResult);
    }

    // ---- Документооборот 1С ----

    public Task<HubDocflowTaskListPage> GetDocflowTasksAsync(
        HubDocflowTaskQuery query,
        CancellationToken cancellationToken)
    {
        DocflowTasksCallCount++;
        LastDocflowQuery = query;
        if (DocflowTasksException is not null)
        {
            return Task.FromException<HubDocflowTaskListPage>(DocflowTasksException);
        }

        return Task.FromResult(DocflowTasksPageFactory?.Invoke(query) ?? DocflowTasksPage);
    }

    public Task<HubDocflowInboxSummary> GetDocflowInboxSummaryAsync(
        CancellationToken cancellationToken)
    {
        DocflowInboxSummaryCallCount++;
        if (DocflowInboxSummaryException is not null)
        {
            return Task.FromException<HubDocflowInboxSummary>(DocflowInboxSummaryException);
        }

        return Task.FromResult(DocflowInboxSummary);
    }

    public Task<HubDocflowTaskDetail> GetDocflowTaskAsync(
        string taskRef,
        bool includeRelated,
        CancellationToken cancellationToken)
    {
        DocflowDetailCallCount++;
        LastDocflowTaskRef = taskRef;
        if (DocflowDetailException is not null)
        {
            return Task.FromException<HubDocflowTaskDetail>(DocflowDetailException);
        }

        return Task.FromResult(
            DocflowTaskDetailFactory?.Invoke(taskRef)
            ?? DocflowTaskDetail
            ?? new HubDocflowTaskDetail { Ref = taskRef, Title = "Задание" });
    }

    public Task<HubDocflowCommandResult> ApplyDocflowTaskActionAsync(
        string taskRef,
        string action,
        string? comment,
        string stateToken,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        DocflowActionCalls.Add((taskRef, action, comment, stateToken, idempotencyKey));
        if (DocflowActionException is not null)
        {
            return Task.FromException<HubDocflowCommandResult>(DocflowActionException);
        }

        return Task.FromResult(
            DocflowActionResultFactory?.Invoke()
            ?? DocflowActionResult
            ?? new HubDocflowCommandResult { CommandId = "cmd-1", Status = "applied" });
    }

    public Task<HubDocflowCommandResult> GetDocflowCommandAsync(
        string commandId,
        CancellationToken cancellationToken)
    {
        DocflowCommandPolls.Add(commandId);
        if (DocflowCommandException is not null)
        {
            return Task.FromException<HubDocflowCommandResult>(DocflowCommandException);
        }

        if (DocflowCommandResults.Count > 0)
        {
            return Task.FromResult(DocflowCommandResults.Dequeue());
        }

        return Task.FromResult(
            DocflowCommandResult
            ?? new HubDocflowCommandResult { CommandId = commandId, Status = "applied" });
    }

    public async Task<string> DownloadDocflowFileAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        DocflowFileDownloads.Add((taskRef, fileRef));
        if (DocflowFileDownloadException is not null)
        {
            throw DocflowFileDownloadException;
        }

        if (DocflowFileBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return DocflowFileDownloadName ?? string.Empty;
    }

    public async Task<string> DownloadDocflowFilePreviewAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        DocflowPreviewDownloads.Add((taskRef, fileRef));
        if (DocflowPreviewDownloadException is not null)
        {
            throw DocflowPreviewDownloadException;
        }

        if (DocflowPreviewBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return DocflowPreviewDownloadName ?? "preview.pdf";
    }

    public Task<HubDocflowProfile> GetDocflowProfileAsync(
        CancellationToken cancellationToken)
    {
        DocflowProfileCallCount++;
        if (DocflowProfileException is not null)
        {
            return Task.FromException<HubDocflowProfile>(DocflowProfileException);
        }

        return Task.FromResult(DocflowProfile);
    }

    public Task<HubDocflowAssignmentCapability> GetDocflowAssignmentCapabilityAsync(
        CancellationToken cancellationToken)
    {
        DocflowAssignmentCapabilityCallCount++;
        if (DocflowAssignmentCapabilityException is not null)
        {
            return Task.FromException<HubDocflowAssignmentCapability>(
                DocflowAssignmentCapabilityException);
        }

        return Task.FromResult(DocflowAssignmentCapability);
    }

    public Task<HubDocflowAssignmentDocumentList> SearchDocflowAssignmentDocumentsAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        DocflowAssignmentDocumentQueries.Add(query ?? string.Empty);
        if (DocflowAssignmentDocumentsException is not null)
        {
            return Task.FromException<HubDocflowAssignmentDocumentList>(
                DocflowAssignmentDocumentsException);
        }

        return Task.FromResult(
            DocflowAssignmentDocumentsFactory?.Invoke(query ?? string.Empty)
            ?? DocflowAssignmentDocuments);
    }

    public Task<HubDocflowAssignmentAssigneeList> SearchDocflowAssignmentAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        DocflowAssignmentAssigneeQueries.Add(query ?? string.Empty);
        if (DocflowAssignmentAssigneesException is not null)
        {
            return Task.FromException<HubDocflowAssignmentAssigneeList>(
                DocflowAssignmentAssigneesException);
        }

        return Task.FromResult(
            DocflowAssignmentAssigneesFactory?.Invoke(query ?? string.Empty)
            ?? DocflowAssignmentAssignees);
    }

    public Task<HubDocflowAssignmentCommandResult> CreateDocflowAssignmentAsync(
        HubDocflowAssignmentCreateRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        DocflowAssignmentCreateCalls.Add((request, idempotencyKey));
        if (DocflowAssignmentCreateException is not null)
        {
            return Task.FromException<HubDocflowAssignmentCommandResult>(
                DocflowAssignmentCreateException);
        }

        return Task.FromResult(
            DocflowAssignmentCreateResultFactory?.Invoke()
            ?? DocflowAssignmentCreateResult
            ?? new HubDocflowAssignmentCommandResult { CommandId = "cmd-a1", Status = "applied" });
    }

    public Task<HubDocflowAssignmentCommandResult> GetDocflowAssignmentCommandAsync(
        string commandId,
        CancellationToken cancellationToken)
    {
        DocflowAssignmentCommandPolls.Add(commandId);
        if (DocflowAssignmentCommandException is not null)
        {
            return Task.FromException<HubDocflowAssignmentCommandResult>(
                DocflowAssignmentCommandException);
        }

        if (DocflowAssignmentCommandResults.Count > 0)
        {
            return Task.FromResult(DocflowAssignmentCommandResults.Dequeue());
        }

        return Task.FromResult(
            DocflowAssignmentCommandResult
            ?? new HubDocflowAssignmentCommandResult { CommandId = commandId, Status = "applied" });
    }

    public Task<HubDocflowConnectionTestResult> TestDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken)
    {
        DocflowCredentialTestCalls.Add((login, password));
        if (DocflowCredentialTestException is not null)
        {
            return Task.FromException<HubDocflowConnectionTestResult>(
                DocflowCredentialTestException);
        }

        return Task.FromResult(
            DocflowConnectionTestResultFactory?.Invoke()
            ?? DocflowConnectionTestResult
            ?? new HubDocflowConnectionTestResult
            {
                Connected = true,
                Configuration = "Документооборот КОРП",
            });
    }

    public Task<HubDocflowProfile> SaveDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken)
    {
        DocflowCredentialSaveCalls.Add((login, password));
        if (DocflowCredentialSaveException is not null)
        {
            return Task.FromException<HubDocflowProfile>(DocflowCredentialSaveException);
        }

        return Task.FromResult(
            DocflowCredentialSaveResultFactory?.Invoke()
            ?? DocflowProfile with
            {
                Configured = true,
                Login = login.Trim(),
                Status = "configured",
            });
    }

    public Task DeleteDocflowCredentialsAsync(CancellationToken cancellationToken)
    {
        DocflowCredentialDeleteCallCount++;
        if (DocflowCredentialDeleteException is not null)
        {
            return Task.FromException(DocflowCredentialDeleteException);
        }

        return Task.CompletedTask;
    }

    public Task<HubDocflowMetadata> GetDocflowMetadataAsync(
        CancellationToken cancellationToken)
    {
        DocflowMetadataCallCount++;
        if (DocflowMetadataException is not null)
        {
            return Task.FromException<HubDocflowMetadata>(DocflowMetadataException);
        }

        return Task.FromResult(DocflowMetadata);
    }

    public Task<HubDocflowAbsenceList> GetDocflowAbsencesAsync(
        string? employeeCode,
        string? on,
        CancellationToken cancellationToken)
    {
        DocflowAbsencesCallCount++;
        DocflowAbsencesQueries.Add((employeeCode ?? string.Empty, on ?? string.Empty));
        if (DocflowAbsencesException is not null)
        {
            return Task.FromException<HubDocflowAbsenceList>(DocflowAbsencesException);
        }

        return Task.FromResult(
            DocflowAbsencesFactory?.Invoke(employeeCode ?? string.Empty, on ?? string.Empty)
            ?? DocflowAbsences);
    }

    public Exception? DocflowTasksException { get; set; }
    public HubDocflowTaskListPage DocflowTasksPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка заданий по параметрам (scope/q/пагинация).</summary>
    public Func<HubDocflowTaskQuery, HubDocflowTaskListPage>? DocflowTasksPageFactory { get; set; }
    public HubDocflowTaskQuery? LastDocflowQuery { get; private set; }
    public int DocflowTasksCallCount { get; private set; }
    public Exception? DocflowDetailException { get; set; }
    public HubDocflowTaskDetail? DocflowTaskDetail { get; set; }

    /// <summary>Если задана — отвечает на запрос карточки по ref задания.</summary>
    public Func<string, HubDocflowTaskDetail>? DocflowTaskDetailFactory { get; set; }
    public string? LastDocflowTaskRef { get; private set; }
    public int DocflowDetailCallCount { get; private set; }
    public Exception? DocflowActionException { get; set; }
    public HubDocflowCommandResult? DocflowActionResult { get; set; }

    /// <summary>Если задана — отвечает на POST /actions (например, pending-команда).</summary>
    public Func<HubDocflowCommandResult>? DocflowActionResultFactory { get; set; }
    public List<(string TaskRef, string Action, string? Comment, string StateToken, string IdempotencyKey)> DocflowActionCalls { get; } = [];
    public Exception? DocflowCommandException { get; set; }
    public HubDocflowCommandResult? DocflowCommandResult { get; set; }

    /// <summary>Очередь ответов GET /commands/{id}: пустая — возвращается DocflowCommandResult.</summary>
    public Queue<HubDocflowCommandResult> DocflowCommandResults { get; } = new();
    public List<string> DocflowCommandPolls { get; } = [];
    public Exception? DocflowFileDownloadException { get; set; }
    public byte[]? DocflowFileBytes { get; set; }
    public string? DocflowFileDownloadName { get; set; }
    public List<(string TaskRef, string FileRef)> DocflowFileDownloads { get; } = [];
    public Exception? DocflowPreviewDownloadException { get; set; }
    public byte[]? DocflowPreviewBytes { get; set; }
    public string? DocflowPreviewDownloadName { get; set; }
    public List<(string TaskRef, string FileRef)> DocflowPreviewDownloads { get; } = [];
    public Exception? DocflowProfileException { get; set; }
    public HubDocflowProfile DocflowProfile { get; set; } = new()
    {
        Configured = true,
        Status = "valid",
        Login = "ivanov",
    };
    public Exception? DocflowInboxSummaryException { get; set; }
    public HubDocflowInboxSummary DocflowInboxSummary { get; set; } = new()
    {
        Status = "available",
        Count = 0,
    };
    public int DocflowProfileCallCount { get; private set; }
    public int DocflowInboxSummaryCallCount { get; private set; }

    // ---- Поручения 1С ----
    public Exception? DocflowAssignmentCapabilityException { get; set; }
    public HubDocflowAssignmentCapability DocflowAssignmentCapability { get; set; } = new()
    {
        Enabled = true,
        DocumentTypes = ["internal", "incoming", "outgoing"],
        TestOnly = true,
        RequiredTitlePrefix = "HUB-IT TEST",
    };
    public int DocflowAssignmentCapabilityCallCount { get; private set; }
    public Exception? DocflowAssignmentDocumentsException { get; set; }
    public HubDocflowAssignmentDocumentList DocflowAssignmentDocuments { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на поиск документов по строке запроса.</summary>
    public Func<string, HubDocflowAssignmentDocumentList>? DocflowAssignmentDocumentsFactory { get; set; }
    public List<string> DocflowAssignmentDocumentQueries { get; } = [];
    public Exception? DocflowAssignmentAssigneesException { get; set; }
    public HubDocflowAssignmentAssigneeList DocflowAssignmentAssignees { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на поиск исполнителей по строке запроса.</summary>
    public Func<string, HubDocflowAssignmentAssigneeList>? DocflowAssignmentAssigneesFactory { get; set; }
    public List<string> DocflowAssignmentAssigneeQueries { get; } = [];
    public Exception? DocflowAssignmentCreateException { get; set; }
    public HubDocflowAssignmentCommandResult? DocflowAssignmentCreateResult { get; set; }

    /// <summary>Если задана — отвечает на POST /assignments (например, pending-команда).</summary>
    public Func<HubDocflowAssignmentCommandResult>? DocflowAssignmentCreateResultFactory { get; set; }
    public List<(HubDocflowAssignmentCreateRequest Request, string IdempotencyKey)> DocflowAssignmentCreateCalls { get; } = [];
    public Exception? DocflowAssignmentCommandException { get; set; }
    public HubDocflowAssignmentCommandResult? DocflowAssignmentCommandResult { get; set; }

    /// <summary>Очередь ответов GET /assignments/commands/{id}: пустая — DocflowAssignmentCommandResult.</summary>
    public Queue<HubDocflowAssignmentCommandResult> DocflowAssignmentCommandResults { get; } = new();
    public List<string> DocflowAssignmentCommandPolls { get; } = [];

    // ---- Учётная запись 1С: проверка/сохранение/удаление кредов ----
    public Exception? DocflowCredentialTestException { get; set; }
    public HubDocflowConnectionTestResult? DocflowConnectionTestResult { get; set; }

    /// <summary>Если задана — отвечает на POST /profile/test (например, connected=false).</summary>
    public Func<HubDocflowConnectionTestResult>? DocflowConnectionTestResultFactory { get; set; }
    public List<(string Login, string Password)> DocflowCredentialTestCalls { get; } = [];
    public Exception? DocflowCredentialSaveException { get; set; }

    /// <summary>Если задана — отвечает на PUT /profile/credentials (профиль со статусом).</summary>
    public Func<HubDocflowProfile>? DocflowCredentialSaveResultFactory { get; set; }
    public List<(string Login, string Password)> DocflowCredentialSaveCalls { get; } = [];
    public Exception? DocflowCredentialDeleteException { get; set; }
    public int DocflowCredentialDeleteCallCount { get; private set; }
    public Exception? DocflowMetadataException { get; set; }
    public HubDocflowMetadata DocflowMetadata { get; set; } = new()
    {
        Configuration = "Документооборот КОРП",
        MappingReady = true,
    };
    public int DocflowMetadataCallCount { get; private set; }
    public Exception? DocflowAbsencesException { get; set; }
    public HubDocflowAbsenceList DocflowAbsences { get; set; } = new()
    {
        Status = "available",
        Items = [],
        Count = 0,
    };

    /// <summary>Если задана — отвечает на GET /absences по (employee_code, on).</summary>
    public Func<string, string, HubDocflowAbsenceList>? DocflowAbsencesFactory { get; set; }
    public List<(string EmployeeCode, string On)> DocflowAbsencesQueries { get; } = [];
    public int DocflowAbsencesCallCount { get; private set; }

    // ---- Билеты ----
    public Exception? TicketsListException { get; set; }
    public HubTicketListPage TicketsPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запросы списка заявок по параметрам (фильтры/пагинация).</summary>
    public Func<HubTicketQuery, HubTicketListPage>? TicketsPageFactory { get; set; }
    public HubTicketQuery? LastTicketQuery { get; private set; }
    public int TicketsCallCount { get; private set; }
    public Exception? TicketDetailException { get; set; }
    public HubTicketRequest? TicketDetail { get; set; }

    /// <summary>Если задана — отвечает на запрос карточки по id заявки.</summary>
    public Func<long, HubTicketRequest>? TicketDetailFactory { get; set; }
    public List<long> TicketDetailCalls { get; } = [];
    public Exception? TicketStatusException { get; set; }
    public HubTicketRequest? TicketStatusResult { get; set; }
    public List<(long RequestId, string NewStatus, int ExpectedVersion, string? Comment)> TicketStatusCalls { get; } = [];
    public Exception? TicketCommentsException { get; set; }
    public HubTicketCommentPage TicketCommentsPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — лента по id заявки (например, меняется после смены статуса).</summary>
    public Func<long, HubTicketCommentPage>? TicketCommentsFactory { get; set; }
    public List<long> TicketCommentsCalls { get; } = [];
    public Exception? TicketHistoryException { get; set; }
    public HubTicketHistoryPage TicketHistory { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает по (requestId, page) — например, постраничная выдача.</summary>
    public Func<long, int, HubTicketHistoryPage>? TicketHistoryFactory { get; set; }
    public List<(long RequestId, int Page)> TicketHistoryCalls { get; } = [];
    public Exception? TicketCommentAddException { get; set; }
    public HubTicketComment? TicketCommentAddResult { get; set; }
    public List<(long RequestId, string Text)> TicketAddedComments { get; } = [];
    public Exception? TicketAttachmentsException { get; set; }
    public HubTicketAttachmentList TicketAttachments { get; set; } = new() { Items = [] };
    public List<long> TicketAttachmentsCalls { get; } = [];
    public Exception? TicketAttachmentDownloadException { get; set; }
    public byte[]? TicketAttachmentBytes { get; set; }
    public string? TicketAttachmentDownloadName { get; set; }
    public List<(long RequestId, string AttachmentId)> TicketAttachmentDownloads { get; } = [];
    public Exception? TicketObjectsException { get; set; }
    public HubTicketObjectList TicketObjects { get; set; } = new() { Items = [] };
    public int TicketObjectsCallCount { get; private set; }

    public Task<HubTicketListPage> GetTicketRequestsAsync(
        HubTicketQuery query,
        CancellationToken cancellationToken)
    {
        TicketsCallCount++;
        LastTicketQuery = query;
        if (TicketsListException is not null)
        {
            return Task.FromException<HubTicketListPage>(TicketsListException);
        }

        return Task.FromResult(TicketsPageFactory?.Invoke(query) ?? TicketsPage);
    }

    public Task<HubTicketRequest> GetTicketRequestAsync(
        long requestId,
        CancellationToken cancellationToken)
    {
        TicketDetailCalls.Add(requestId);
        if (TicketDetailException is not null)
        {
            return Task.FromException<HubTicketRequest>(TicketDetailException);
        }

        return Task.FromResult(
            TicketDetailFactory?.Invoke(requestId)
            ?? TicketDetail
            ?? new HubTicketRequest { Id = requestId, Status = "not_started" });
    }

    public Task<HubTicketRequest> ChangeTicketStatusAsync(
        long requestId,
        string newStatus,
        int expectedVersion,
        string? comment,
        CancellationToken cancellationToken)
    {
        TicketStatusCalls.Add((requestId, newStatus, expectedVersion, comment));
        if (TicketStatusException is not null)
        {
            return Task.FromException<HubTicketRequest>(TicketStatusException);
        }

        // Имитация сервера: версия инкрементируется, статус заменяется.
        var result = (TicketStatusResult
            ?? TicketDetailFactory?.Invoke(requestId)
            ?? TicketDetail
            ?? new HubTicketRequest { Id = requestId }) with
        {
            Status = newStatus,
            Version = expectedVersion + 1,
        };
        return Task.FromResult(result);
    }

    public Task<HubTicketCommentPage> GetTicketCommentsAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        TicketCommentsCalls.Add(requestId);
        if (TicketCommentsException is not null)
        {
            return Task.FromException<HubTicketCommentPage>(TicketCommentsException);
        }

        return Task.FromResult(TicketCommentsFactory?.Invoke(requestId) ?? TicketCommentsPage);
    }

    public Task<HubTicketHistoryPage> GetTicketHistoryAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        TicketHistoryCalls.Add((requestId, page));
        if (TicketHistoryException is not null)
        {
            return Task.FromException<HubTicketHistoryPage>(TicketHistoryException);
        }

        return Task.FromResult(TicketHistoryFactory?.Invoke(requestId, page) ?? TicketHistory);
    }

    public Task<HubTicketComment> AddTicketCommentAsync(
        long requestId,
        string text,
        CancellationToken cancellationToken)
    {
        if (TicketCommentAddException is not null)
        {
            return Task.FromException<HubTicketComment>(TicketCommentAddException);
        }

        TicketAddedComments.Add((requestId, text));
        var comment = TicketCommentAddResult ?? new HubTicketComment
        {
            Id = 900 + TicketAddedComments.Count,
            RequestId = requestId,
            Text = text,
            CommentType = "normal",
            CreatedAt = DateTime.UtcNow.ToString("o"),
        };
        return Task.FromResult(comment);
    }

    public Task<HubTicketAttachmentList> GetTicketAttachmentsAsync(
        long requestId,
        CancellationToken cancellationToken)
    {
        TicketAttachmentsCalls.Add(requestId);
        if (TicketAttachmentsException is not null)
        {
            return Task.FromException<HubTicketAttachmentList>(TicketAttachmentsException);
        }

        return Task.FromResult(TicketAttachments);
    }

    public async Task<string> DownloadTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        TicketAttachmentDownloads.Add((requestId, attachmentId));
        if (TicketAttachmentDownloadException is not null)
        {
            throw TicketAttachmentDownloadException;
        }

        if (TicketAttachmentBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return TicketAttachmentDownloadName ?? string.Empty;
    }

    public Task<HubTicketObjectList> GetTicketObjectsAsync(
        CancellationToken cancellationToken)
    {
        TicketObjectsCallCount++;
        if (TicketObjectsException is not null)
        {
            return Task.FromException<HubTicketObjectList>(TicketObjectsException);
        }

        return Task.FromResult(TicketObjects);
    }

    public Exception? TicketCreateException { get; set; }

    /// <summary>Если задан — ответ создания заявки независимо от тела запроса.</summary>
    public HubTicketRequest? TicketCreateResult { get; set; }
    public List<HubCreateTicketRequest> TicketCreateCalls { get; } = [];
    public Exception? TicketEmployeesException { get; set; }
    public HubTicketEmployeePage TicketEmployeesPage { get; set; } = new() { Items = [] };
    public List<string?> TicketEmployeesSearches { get; } = [];
    public Exception? TicketZupException { get; set; }
    public HubTicketZupPersonList TicketZupPersons { get; set; } = new() { Items = [] };
    public List<string> TicketZupSearches { get; } = [];
    public Exception? TicketEnsureZupException { get; set; }
    public HubTicketEmployee? TicketEnsureZupResult { get; set; }
    public List<string> TicketEnsureZupCalls { get; } = [];
    public Exception? TicketUploadException { get; set; }
    public List<(long RequestId, string FileName, string FileType, long Size)> TicketUploads { get; } = [];

    public Task<HubTicketRequest> CreateTicketRequestAsync(
        HubCreateTicketRequest request,
        CancellationToken cancellationToken)
    {
        TicketCreateCalls.Add(request);
        if (TicketCreateException is not null)
        {
            return Task.FromException<HubTicketRequest>(TicketCreateException);
        }

        var created = TicketCreateResult ?? new HubTicketRequest
        {
            Id = 500 + TicketCreateCalls.Count,
            EmployeeId = request.EmployeeId,
            ObjectId = request.ObjectId,
            Status = request.Status,
            SubmittedAt = request.SubmittedAt,
            DepartureDate = request.DepartureDate,
            ArrivalDate = request.ArrivalDate,
            Route = request.Route,
            Note = request.Note,
            IsUrgent = request.IsUrgent,
            Source = request.Source,
            Version = 1,
        };
        return Task.FromResult(created);
    }

    public Task<HubTicketEmployeePage> GetTicketEmployeesAsync(
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        TicketEmployeesSearches.Add(search);
        if (TicketEmployeesException is not null)
        {
            return Task.FromException<HubTicketEmployeePage>(TicketEmployeesException);
        }

        return Task.FromResult(TicketEmployeesPage);
    }

    public Task<HubTicketZupPersonList> SearchTicketZupEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        TicketZupSearches.Add(query);
        if (TicketZupException is not null)
        {
            return Task.FromException<HubTicketZupPersonList>(TicketZupException);
        }

        return Task.FromResult(TicketZupPersons);
    }

    public Task<HubTicketEmployee> EnsureTicketEmployeeFromZupAsync(
        string employeeCode,
        CancellationToken cancellationToken)
    {
        TicketEnsureZupCalls.Add(employeeCode);
        if (TicketEnsureZupException is not null)
        {
            return Task.FromException<HubTicketEmployee>(TicketEnsureZupException);
        }

        return Task.FromResult(TicketEnsureZupResult ?? new HubTicketEmployee
        {
            Id = 900 + TicketEnsureZupCalls.Count,
            FullName = "Сотрудник ЗУП",
            ZupEmployeeCode = employeeCode,
        });
    }

    public async Task<HubTicketAttachment> UploadTicketAttachmentAsync(
        long requestId,
        string fileName,
        Stream content,
        string fileType,
        CancellationToken cancellationToken)
    {
        var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        TicketUploads.Add((requestId, fileName, fileType, buffer.Length));
        if (TicketUploadException is not null)
        {
            throw TicketUploadException;
        }

        return new HubTicketAttachment
        {
            Id = "att-" + TicketUploads.Count,
            RequestId = requestId,
            FileName = fileName,
            FileType = fileType,
            FileSize = buffer.Length,
        };
    }

    public Exception? TicketAttachmentDeleteException { get; set; }
    public List<(long RequestId, string AttachmentId)> TicketAttachmentDeletes { get; } = [];

    public Task DeleteTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        CancellationToken cancellationToken)
    {
        TicketAttachmentDeletes.Add((requestId, attachmentId));
        if (TicketAttachmentDeleteException is not null)
        {
            return Task.FromException(TicketAttachmentDeleteException);
        }

        return Task.CompletedTask;
    }

    // ---- Канбан и сводка заявок ----
    public Exception? TicketKanbanException { get; set; }

    /// <summary>Доска: «русское имя колонки» → карточки (ключи — как get_kanban backend'а).</summary>
    public IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>> TicketKanban { get; set; } =
        new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>(StringComparer.Ordinal);

    /// <summary>Если задана — отвечает по фильтрам (object_ids/assignee_ids).</summary>
    public Func<string?, string?, IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>>? TicketKanbanFactory { get; set; }
    public List<(string? ObjectIds, string? AssigneeIds)> TicketKanbanCalls { get; } = [];

    public Task<IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>> GetTicketKanbanAsync(
        string? objectIds,
        string? assigneeIds,
        CancellationToken cancellationToken)
    {
        TicketKanbanCalls.Add((objectIds, assigneeIds));
        if (TicketKanbanException is not null)
        {
            return Task.FromException<IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>>(
                TicketKanbanException);
        }

        return Task.FromResult(TicketKanbanFactory?.Invoke(objectIds, assigneeIds) ?? TicketKanban);
    }

    public Exception? TicketDashboardException { get; set; }
    public HubTicketsDashboard TicketDashboard { get; set; } = new();
    public int TicketDashboardCalls { get; private set; }

    public Task<HubTicketsDashboard> GetTicketDashboardAsync(
        CancellationToken cancellationToken)
    {
        TicketDashboardCalls++;
        if (TicketDashboardException is not null)
        {
            return Task.FromException<HubTicketsDashboard>(TicketDashboardException);
        }

        return Task.FromResult(TicketDashboard);
    }

    // ---- Адресная книга ----
    public Exception? AddressBookSearchException { get; set; }
    public HubAddressBookPage AddressBookPage { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на поиск по параметрам (q/фильтры/offset).</summary>
    public Func<HubAddressBookQuery, HubAddressBookPage>? AddressBookPageFactory { get; set; }
    public HubAddressBookQuery? LastAddressBookQuery { get; private set; }
    public int AddressBookSearchCallCount { get; private set; }
    public Exception? AddressBookFiltersException { get; set; }
    public HubAddressBookFilters AddressBookFilters { get; set; } = new();
    public int AddressBookFiltersCallCount { get; private set; }

    public Task<HubAddressBookPage> SearchAddressBookAsync(
        HubAddressBookQuery query,
        CancellationToken cancellationToken)
    {
        AddressBookSearchCallCount++;
        LastAddressBookQuery = query;
        if (AddressBookSearchException is not null)
        {
            return Task.FromException<HubAddressBookPage>(AddressBookSearchException);
        }

        return Task.FromResult(AddressBookPageFactory?.Invoke(query) ?? AddressBookPage);
    }

    public Task<HubAddressBookFilters> GetAddressBookFiltersAsync(
        CancellationToken cancellationToken)
    {
        AddressBookFiltersCallCount++;
        if (AddressBookFiltersException is not null)
        {
            return Task.FromException<HubAddressBookFilters>(AddressBookFiltersException);
        }

        return Task.FromResult(AddressBookFilters);
    }

    // ---- Структура компании ----
    public Exception? CompanyStructureTreeException { get; set; }
    public HubCompanyStructureTree CompanyStructureTree { get; set; } = new() { Items = [] };

    /// <summary>Если задана — отвечает на запрос дерева (например, обновлённая версия).</summary>
    public Func<HubCompanyStructureTree>? CompanyStructureTreeFactory { get; set; }
    public bool LastCompanyStructureIncludeInactive { get; private set; }
    public int CompanyStructureTreeCallCount { get; private set; }
    public Exception? CompanyStructurePeopleException { get; set; }

    /// <summary>Выдача people по id узла; иначе — общий CompanyStructurePeople.</summary>
    public Func<string, HubCompanyStructurePeople>? CompanyStructurePeopleFactory { get; set; }
    public HubCompanyStructurePeople CompanyStructurePeople { get; set; } = new() { Items = [] };
    public List<(string NodeId, int Limit, bool IncludeDescendants)> CompanyStructurePeopleCalls { get; } = [];
    public Exception? CompanyStructureSearchException { get; set; }
    public HubCompanyStructureSearchResult CompanyStructureSearch { get; set; } = new() { Items = [] };
    public List<(string Query, int Limit)> CompanyStructureSearchCalls { get; } = [];

    public Task<HubCompanyStructureTree> GetCompanyStructureTreeAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        CompanyStructureTreeCallCount++;
        LastCompanyStructureIncludeInactive = includeInactive;
        if (CompanyStructureTreeException is not null)
        {
            return Task.FromException<HubCompanyStructureTree>(CompanyStructureTreeException);
        }

        return Task.FromResult(CompanyStructureTreeFactory?.Invoke() ?? CompanyStructureTree);
    }

    public Task<HubCompanyStructurePeople> GetCompanyStructureNodePeopleAsync(
        string nodeId,
        int limit,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        CompanyStructurePeopleCalls.Add((nodeId, limit, includeDescendants));
        if (CompanyStructurePeopleException is not null)
        {
            return Task.FromException<HubCompanyStructurePeople>(CompanyStructurePeopleException);
        }

        return Task.FromResult(
            CompanyStructurePeopleFactory?.Invoke(nodeId) ?? CompanyStructurePeople);
    }

    public Task<HubCompanyStructureSearchResult> SearchCompanyStructureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        CompanyStructureSearchCalls.Add((query, limit));
        if (CompanyStructureSearchException is not null)
        {
            return Task.FromException<HubCompanyStructureSearchResult>(CompanyStructureSearchException);
        }

        return Task.FromResult(CompanyStructureSearch);
    }

    // ---- ИТ-объекты ----
    public Exception? ItObjectsException { get; set; }
    public HubItObjectList ItObjectsList { get; set; } = new() { Items = [] };

    /// <summary>Выдача списка по фильтрам (q/mine/hidden), иначе — общий ItObjectsList.</summary>
    public Func<string?, bool, bool, HubItObjectList>? ItObjectsListFactory { get; set; }
    public List<(string? Query, bool OnlyMine, bool Hidden)> ItObjectsCalls { get; } = [];
    public int ItObjectsCallCount => ItObjectsCalls.Count;
    public Exception? ItObjectDetailException { get; set; }
    public HubItObjectDetail? ItObjectDetail { get; set; }

    /// <summary>Деталь объекта по object_ref; иначе — общий ItObjectDetail.</summary>
    public Func<string, HubItObjectDetail>? ItObjectDetailFactory { get; set; }
    public List<string> ItObjectDetailCalls { get; } = [];
    public Exception? ItObjectComputersException { get; set; }
    public HubItObjectComputersPage ItObjectComputersPage { get; set; } = new() { Items = [] };
    public List<string> ItObjectComputersCalls { get; } = [];
    public Exception? ItObjectComputerDetailException { get; set; }
    public HubComputer? ItObjectComputerDetail { get; set; }

    /// <summary>Деталь ПК объекта по (objectRef, mac); иначе — общий ItObjectComputerDetail.</summary>
    public Func<string, string, HubComputer>? ItObjectComputerDetailFactory { get; set; }
    public List<(string ObjectRef, string MacAddress)> ItObjectComputerDetailCalls { get; } = [];
    public Exception? ItObjectInventoryException { get; set; }
    public HubItObjectInventoryPage ItObjectInventoryPage { get; set; } = new() { Items = [] };
    public List<(string ObjectRef, int Page, int Limit)> ItObjectInventoryCalls { get; } = [];
    public Exception? ItObjectMonitoringException { get; set; }
    public HubItObjectMonitoringOverview ItObjectMonitoring { get; set; } = new() { Targets = [] };
    public List<string> ItObjectMonitoringCalls { get; } = [];
    public Exception? ItObjectMonitoringLatencyException { get; set; }
    public HubMonitoringLatencyHistory ItObjectMonitoringLatency { get; set; } = new() { Points = [] };
    public List<(string ObjectRef, string TargetId, int Hours)> ItObjectMonitoringLatencyCalls { get; } = [];
    public Exception? ItObjectNetmapVersionsException { get; set; }
    public HubItObjectNetmapVersionsResponse ItObjectNetmapVersions { get; set; } = new() { Items = [] };
    public List<string> ItObjectNetmapVersionsCalls { get; } = [];
    public Exception? ItObjectPasswordsAuditException { get; set; }
    public HubItObjectPasswordAuditResponse ItObjectPasswordsAudit { get; set; } = new() { Items = [] };
    public List<(string ObjectRef, int Limit)> ItObjectPasswordsAuditCalls { get; } = [];

    public Task<HubItObjectList> GetItObjectsAsync(
        string? query,
        bool onlyMine,
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        ItObjectsCalls.Add((query, onlyMine, includeHidden));
        if (ItObjectsException is not null)
        {
            return Task.FromException<HubItObjectList>(ItObjectsException);
        }

        return Task.FromResult(
            ItObjectsListFactory?.Invoke(query, onlyMine, includeHidden) ?? ItObjectsList);
    }

    public Task<HubItObjectDetail> GetItObjectAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ItObjectDetailCalls.Add(objectRef);
        if (ItObjectDetailException is not null)
        {
            return Task.FromException<HubItObjectDetail>(ItObjectDetailException);
        }

        return Task.FromResult(
            ItObjectDetailFactory?.Invoke(objectRef) ?? ItObjectDetail
            ?? new HubItObjectDetail { ObjectRef = objectRef });
    }

    public Task<HubItObjectComputersPage> GetItObjectComputersAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ItObjectComputersCalls.Add(objectRef);
        if (ItObjectComputersException is not null)
        {
            return Task.FromException<HubItObjectComputersPage>(ItObjectComputersException);
        }

        return Task.FromResult(ItObjectComputersPage);
    }

    public Task<HubComputer> GetItObjectComputerAsync(
        string objectRef,
        string macAddress,
        CancellationToken cancellationToken)
    {
        ItObjectComputerDetailCalls.Add((objectRef, macAddress));
        if (ItObjectComputerDetailException is not null)
        {
            return Task.FromException<HubComputer>(ItObjectComputerDetailException);
        }

        return Task.FromResult(
            ItObjectComputerDetailFactory?.Invoke(objectRef, macAddress) ?? ItObjectComputerDetail
            ?? new HubComputer { MacAddress = macAddress, Hostname = "PC-TEST" });
    }

    public Task<HubItObjectInventoryPage> GetItObjectInventoryAsync(
        string objectRef,
        int page,
        int limit,
        CancellationToken cancellationToken)
    {
        ItObjectInventoryCalls.Add((objectRef, page, limit));
        if (ItObjectInventoryException is not null)
        {
            return Task.FromException<HubItObjectInventoryPage>(ItObjectInventoryException);
        }

        return Task.FromResult(ItObjectInventoryPage);
    }

    public Task<HubItObjectMonitoringOverview> GetItObjectMonitoringAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ItObjectMonitoringCalls.Add(objectRef);
        if (ItObjectMonitoringException is not null)
        {
            return Task.FromException<HubItObjectMonitoringOverview>(ItObjectMonitoringException);
        }

        return Task.FromResult(ItObjectMonitoring);
    }

    public Task<HubMonitoringLatencyHistory> GetItObjectMonitoringLatencyHistoryAsync(
        string objectRef,
        string targetId,
        int hours,
        CancellationToken cancellationToken)
    {
        ItObjectMonitoringLatencyCalls.Add((objectRef, targetId, hours));
        if (ItObjectMonitoringLatencyException is not null)
        {
            return Task.FromException<HubMonitoringLatencyHistory>(ItObjectMonitoringLatencyException);
        }

        return Task.FromResult(ItObjectMonitoringLatency);
    }

    public Task<HubItObjectNetmapVersionsResponse> GetItObjectNetmapVersionsAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ItObjectNetmapVersionsCalls.Add(objectRef);
        if (ItObjectNetmapVersionsException is not null)
        {
            return Task.FromException<HubItObjectNetmapVersionsResponse>(ItObjectNetmapVersionsException);
        }

        return Task.FromResult(ItObjectNetmapVersions);
    }

    public Task<HubItObjectPasswordAuditResponse> GetItObjectPasswordsAuditAsync(
        string objectRef,
        int limit,
        CancellationToken cancellationToken)
    {
        ItObjectPasswordsAuditCalls.Add((objectRef, limit));
        if (ItObjectPasswordsAuditException is not null)
        {
            return Task.FromException<HubItObjectPasswordAuditResponse>(ItObjectPasswordsAuditException);
        }

        return Task.FromResult(ItObjectPasswordsAudit);
    }

    // ---- Сети ----
    public Exception? NetworkBranchesException { get; set; }
    public HubNetworkBranchList NetworkBranches { get; set; } = new() { Branches = [] };

    /// <summary>Выдача филиалов по городу, иначе — общий NetworkBranches.</summary>
    public Func<string?, HubNetworkBranchList>? NetworkBranchesFactory { get; set; }
    public List<string?> NetworkBranchesCalls { get; } = [];
    public int NetworkBranchesCallCount => NetworkBranchesCalls.Count;
    public Exception? NetworkOverviewException { get; set; }
    public HubNetworkOverview? NetworkOverview { get; set; }

    /// <summary>Overview по id филиала, иначе — общий NetworkOverview.</summary>
    public Func<long, HubNetworkOverview>? NetworkOverviewFactory { get; set; }
    public List<long> NetworkOverviewCalls { get; } = [];
    public Exception? NetworkDevicesException { get; set; }
    public HubNetworkDeviceList NetworkDevices { get; set; } = new() { Devices = [] };

    /// <summary>Устройства по id филиала, иначе — общий NetworkDevices.</summary>
    public Func<long, HubNetworkDeviceList>? NetworkDevicesFactory { get; set; }
    public List<long> NetworkDevicesCalls { get; } = [];
    public Exception? NetworkMapsException { get; set; }
    public HubNetworkMapList NetworkMaps { get; set; } = new() { Maps = [] };

    /// <summary>Схемы по id филиала, иначе — общий NetworkMaps.</summary>
    public Func<long, HubNetworkMapList>? NetworkMapsFactory { get; set; }
    public List<long> NetworkMapsCalls { get; } = [];
    public Exception? NetworkMapFileDownloadException { get; set; }
    public byte[]? NetworkMapFileBytes { get; set; }
    public string? NetworkMapFileDownloadName { get; set; }
    public List<(long MapId, string? Render)> NetworkMapFileDownloads { get; } = [];
    public Exception? NetworkMapPdfDownloadException { get; set; }
    public byte[]? NetworkMapPdfBytes { get; set; }
    public string? NetworkMapPdfDownloadName { get; set; }
    public List<long> NetworkMapPdfDownloads { get; } = [];

    public Task<HubNetworkBranchList> GetNetworkBranchesAsync(
        string? city,
        CancellationToken cancellationToken)
    {
        NetworkBranchesCalls.Add(city);
        if (NetworkBranchesException is not null)
        {
            return Task.FromException<HubNetworkBranchList>(NetworkBranchesException);
        }

        return Task.FromResult(
            NetworkBranchesFactory?.Invoke(city) ?? NetworkBranches);
    }

    public Task<HubNetworkOverview> GetNetworkBranchOverviewAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        NetworkOverviewCalls.Add(branchId);
        if (NetworkOverviewException is not null)
        {
            return Task.FromException<HubNetworkOverview>(NetworkOverviewException);
        }

        return Task.FromResult(
            NetworkOverviewFactory?.Invoke(branchId) ?? NetworkOverview
            ?? new HubNetworkOverview { Branch = new HubNetworkBranch { Id = branchId } });
    }

    public Task<HubNetworkDeviceList> GetNetworkDevicesAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        NetworkDevicesCalls.Add(branchId);
        if (NetworkDevicesException is not null)
        {
            return Task.FromException<HubNetworkDeviceList>(NetworkDevicesException);
        }

        return Task.FromResult(
            NetworkDevicesFactory?.Invoke(branchId) ?? NetworkDevices);
    }

    public Task<HubNetworkMapList> GetNetworkMapsAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        NetworkMapsCalls.Add(branchId);
        if (NetworkMapsException is not null)
        {
            return Task.FromException<HubNetworkMapList>(NetworkMapsException);
        }

        return Task.FromResult(
            NetworkMapsFactory?.Invoke(branchId) ?? NetworkMaps);
    }

    public async Task<string> DownloadNetworkMapFileAsync(
        long mapId,
        string? render,
        Stream destination,
        CancellationToken cancellationToken)
    {
        NetworkMapFileDownloads.Add((mapId, render));
        if (NetworkMapFileDownloadException is not null)
        {
            throw NetworkMapFileDownloadException;
        }

        if (NetworkMapFileBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return NetworkMapFileDownloadName ?? string.Empty;
    }

    public async Task<string> DownloadNetworkMapPdfAsync(
        long mapId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        NetworkMapPdfDownloads.Add(mapId);
        if (NetworkMapPdfDownloadException is not null)
        {
            throw NetworkMapPdfDownloadException;
        }

        if (NetworkMapPdfBytes is { Length: > 0 } bytes)
        {
            await destination.WriteAsync(bytes, cancellationToken);
        }

        return NetworkMapPdfDownloadName ?? $"map_{mapId}-points.pdf";
    }

    // ---- Компьютеры ----
    public Exception? ComputersException { get; set; }
    public HubComputersPage ComputersPage { get; set; } = new() { Items = [] };

    /// <summary>Выдача страницы по запросу (offset/фильтры), иначе — общая ComputersPage.</summary>
    public Func<HubComputersQuery, HubComputersPage>? ComputersPageFactory { get; set; }
    public List<HubComputersQuery> ComputersQueries { get; } = [];
    public int ComputersCallCount => ComputersQueries.Count;
    public Exception? ComputerDetailException { get; set; }
    public HubComputer? ComputerDetail { get; set; }

    /// <summary>Деталь по MAC-адресу, иначе — общий ComputerDetail.</summary>
    public Func<string, HubComputer>? ComputerDetailFactory { get; set; }
    public List<(string MacAddress, string? Scope)> ComputerDetailCalls { get; } = [];

    /// <summary>
    /// Задержка ответа детали: тесты гонки выбора ставят Task.Delay/TaskCompletionSource.
    /// </summary>
    public Func<string, CancellationToken, Task>? ComputerDetailDelay { get; set; }

    public Task<HubComputersPage> SearchComputersAsync(
        HubComputersQuery query,
        CancellationToken cancellationToken)
    {
        ComputersQueries.Add(query);
        if (ComputersException is not null)
        {
            return Task.FromException<HubComputersPage>(ComputersException);
        }

        return Task.FromResult(ComputersPageFactory?.Invoke(query) ?? ComputersPage);
    }

    public async Task<HubComputer> GetComputerDetailAsync(
        string macAddress,
        string? scope,
        CancellationToken cancellationToken)
    {
        ComputerDetailCalls.Add((macAddress, scope));
        if (ComputerDetailException is not null)
        {
            throw ComputerDetailException;
        }

        if (ComputerDetailDelay is not null)
        {
            await ComputerDetailDelay(macAddress, cancellationToken);
        }

        return ComputerDetailFactory?.Invoke(macAddress) ?? ComputerDetail
            ?? new HubComputer { MacAddress = macAddress, Hostname = "PC-TEST" };
    }

    // ---- База ITINVENT ----
    public Exception? EquipmentSearchException { get; set; }
    public HubEquipmentSearchPage EquipmentSearchPage { get; set; } = new() { Equipment = [] };

    /// <summary>Выдача страницы по запросу (страница/поле/тип), иначе — общая EquipmentSearchPage.</summary>
    public Func<HubEquipmentSearchQuery, HubEquipmentSearchPage>? EquipmentSearchPageFactory { get; set; }
    public List<HubEquipmentSearchQuery> EquipmentSearchQueries { get; } = [];
    public int EquipmentSearchCallCount => EquipmentSearchQueries.Count;
    public Exception? EquipmentDetailException { get; set; }
    public HubEquipmentItem? EquipmentDetail { get; set; }

    /// <summary>Карточка по инвентарному номеру, иначе — общая EquipmentDetail.</summary>
    public Func<string, HubEquipmentItem>? EquipmentDetailFactory { get; set; }
    public List<string> EquipmentDetailCalls { get; } = [];

    /// <summary>
    /// Задержка ответа детали: тесты гонки выбора ставят Task.Delay/TaskCompletionSource.
    /// </summary>
    public Func<string, CancellationToken, Task>? EquipmentDetailDelay { get; set; }
    public Exception? EquipmentPhotosException { get; set; }
    public HubEquipmentPhotoList EquipmentPhotos { get; set; } = new() { Photos = [] };

    /// <summary>Метаданные фото по item_id, иначе — общий EquipmentPhotos.</summary>
    public Func<long, HubEquipmentPhotoList>? EquipmentPhotosFactory { get; set; }
    public List<long> EquipmentPhotosCalls { get; } = [];
    public Exception? EquipmentTypesException { get; set; }
    public IReadOnlyList<HubEquipmentType> EquipmentTypes { get; set; } = [];
    public int EquipmentTypesCallCount { get; private set; }

    public Task<HubEquipmentSearchPage> SearchEquipmentAsync(
        HubEquipmentSearchQuery query,
        CancellationToken cancellationToken)
    {
        EquipmentSearchQueries.Add(query);
        if (EquipmentSearchException is not null)
        {
            return Task.FromException<HubEquipmentSearchPage>(EquipmentSearchException);
        }

        return Task.FromResult(EquipmentSearchPageFactory?.Invoke(query) ?? EquipmentSearchPage);
    }

    public async Task<HubEquipmentItem> GetEquipmentByInvAsync(
        string invNo,
        CancellationToken cancellationToken)
    {
        EquipmentDetailCalls.Add(invNo);
        if (EquipmentDetailException is not null)
        {
            throw EquipmentDetailException;
        }

        if (EquipmentDetailDelay is not null)
        {
            await EquipmentDetailDelay(invNo, cancellationToken);
        }

        return EquipmentDetailFactory?.Invoke(invNo) ?? EquipmentDetail
            ?? new HubEquipmentItem { InvNo = double.TryParse(invNo, out var n) ? n : null };
    }

    public Task<HubEquipmentPhotoList> GetEquipmentPhotosAsync(
        long itemId,
        CancellationToken cancellationToken)
    {
        EquipmentPhotosCalls.Add(itemId);
        if (EquipmentPhotosException is not null)
        {
            return Task.FromException<HubEquipmentPhotoList>(EquipmentPhotosException);
        }

        return Task.FromResult(EquipmentPhotosFactory?.Invoke(itemId) ?? EquipmentPhotos);
    }

    // ---- Фото: загрузка (простая + чанковая) и модерация ----

    public Exception? EquipmentPhotoUploadException { get; set; }
    public HubEquipmentPhotoUploadResult? EquipmentPhotoUploadResult { get; set; }
    /// <summary>Ответ загрузки по параметрам (item_id, file_name, размер, mime), иначе — EquipmentPhotoUploadResult.</summary>
    public Func<long, string, byte[], string?, string?, HubEquipmentPhotoUploadResult>? EquipmentPhotoUploadFactory { get; set; }
    public List<(long ItemId, string FileName, byte[] Content, string? MimeType, string? Description)> EquipmentPhotoUploadCalls { get; } = [];

    public Task<HubEquipmentPhotoUploadResult> UploadEquipmentPhotoAsync(
        long itemId,
        string fileName,
        byte[] content,
        string? mimeType,
        string? description,
        CancellationToken cancellationToken)
    {
        EquipmentPhotoUploadCalls.Add((itemId, fileName, content, mimeType, description));
        if (EquipmentPhotoUploadException is not null)
        {
            return Task.FromException<HubEquipmentPhotoUploadResult>(EquipmentPhotoUploadException);
        }

        return Task.FromResult(
            EquipmentPhotoUploadFactory?.Invoke(itemId, fileName, content, mimeType, description)
            ?? EquipmentPhotoUploadResult
            ?? new HubEquipmentPhotoUploadResult { ItemId = itemId, FileNo = 9901, FileName = fileName });
    }

    public Exception? PhotoUploadSessionException { get; set; }
    /// <summary>Сессия по запросу, иначе — открытая «uploading» с upload_id из client_id.</summary>
    public Func<long, HubEquipmentPhotoUploadSessionCreate, HubEquipmentPhotoUploadSession>? PhotoUploadSessionFactory { get; set; }
    public List<(long ItemId, HubEquipmentPhotoUploadSessionCreate Request)> PhotoUploadSessionCalls { get; } = [];
    public List<(string UploadId, int ChunkIndex, byte[] Data)> PhotoUploadChunkCalls { get; } = [];
    public List<string> PhotoUploadCompleteCalls { get; } = [];
    public HubEquipmentPhotoUploadResult? PhotoUploadCompleteResult { get; set; }

    public Task<HubEquipmentPhotoUploadSession> CreateEquipmentPhotoUploadSessionAsync(
        long itemId,
        HubEquipmentPhotoUploadSessionCreate request,
        CancellationToken cancellationToken)
    {
        PhotoUploadSessionCalls.Add((itemId, request));
        if (PhotoUploadSessionException is not null)
        {
            return Task.FromException<HubEquipmentPhotoUploadSession>(PhotoUploadSessionException);
        }

        var size = request?.Size ?? 0;
        return Task.FromResult(
            PhotoUploadSessionFactory?.Invoke(itemId, request!)
            ?? new HubEquipmentPhotoUploadSession
            {
                UploadId = "0123456789abcdef0123456789abcdef",
                Status = "uploading",
                ItemId = itemId,
                Size = size,
                ChunkSize = 256 * 1024,
                TotalChunks = (int)Math.Max(1, (size + 256 * 1024 - 1) / (256 * 1024)),
                Received = [],
            });
    }

    public Task<HubEquipmentPhotoUploadSession> UploadEquipmentPhotoChunkAsync(
        string uploadId,
        int chunkIndex,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        PhotoUploadChunkCalls.Add((uploadId, chunkIndex, data.ToArray()));
        if (PhotoUploadSessionException is not null)
        {
            return Task.FromException<HubEquipmentPhotoUploadSession>(PhotoUploadSessionException);
        }

        return Task.FromResult(new HubEquipmentPhotoUploadSession
        {
            UploadId = uploadId,
            Status = "uploading",
            Received = [chunkIndex],
        });
    }

    public Task<HubEquipmentPhotoUploadResult> CompleteEquipmentPhotoUploadAsync(
        string uploadId,
        CancellationToken cancellationToken)
    {
        PhotoUploadCompleteCalls.Add(uploadId);
        if (PhotoUploadSessionException is not null)
        {
            return Task.FromException<HubEquipmentPhotoUploadResult>(PhotoUploadSessionException);
        }

        return Task.FromResult(
            PhotoUploadCompleteResult
            ?? new HubEquipmentPhotoUploadResult { FileNo = 9901, FileName = "photo.jpg" });
    }

    public Exception? PhotoModerationException { get; set; }
    /// <summary>Карточка после verify/reject/patch по (item_id, file_no), иначе — отметки по вызову.</summary>
    public Func<long, long, string, string?, HubEquipmentPhoto>? PhotoModerationFactory { get; set; }
    public List<(long ItemId, long FileNo)> PhotoVerifyCalls { get; } = [];
    public List<(long ItemId, long FileNo, string Reason)> PhotoRejectCalls { get; } = [];
    public List<(long ItemId, long FileNo, string Reason)> PhotoRejectReasonPatchCalls { get; } = [];
    public List<(long ItemId, long FileNo, int Degrees)> PhotoRotateCalls { get; } = [];
    public HubEquipmentPhotoRotateResult? PhotoRotateResult { get; set; }

    public Task<HubEquipmentPhoto> VerifyEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        CancellationToken cancellationToken)
    {
        PhotoVerifyCalls.Add((itemId, fileNo));
        if (PhotoModerationException is not null)
        {
            return Task.FromException<HubEquipmentPhoto>(PhotoModerationException);
        }

        return Task.FromResult(
            PhotoModerationFactory?.Invoke(itemId, fileNo, "verify", null)
            ?? new HubEquipmentPhoto { FileNo = fileNo, Verified = true, VerifiedBy = "moderator" });
    }

    public Task<HubEquipmentPhoto> RejectEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken)
    {
        PhotoRejectCalls.Add((itemId, fileNo, reason));
        if (PhotoModerationException is not null)
        {
            return Task.FromException<HubEquipmentPhoto>(PhotoModerationException);
        }

        return Task.FromResult(
            PhotoModerationFactory?.Invoke(itemId, fileNo, "reject", reason)
            ?? new HubEquipmentPhoto { FileNo = fileNo, Rejected = true, RejectedBy = "moderator", RejectReason = reason });
    }

    public Task<HubEquipmentPhoto> UpdateEquipmentPhotoRejectReasonAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken)
    {
        PhotoRejectReasonPatchCalls.Add((itemId, fileNo, reason));
        if (PhotoModerationException is not null)
        {
            return Task.FromException<HubEquipmentPhoto>(PhotoModerationException);
        }

        return Task.FromResult(
            PhotoModerationFactory?.Invoke(itemId, fileNo, "reject-patch", reason)
            ?? new HubEquipmentPhoto { FileNo = fileNo, Rejected = true, RejectedBy = "moderator", RejectReason = reason });
    }

    public Task<HubEquipmentPhotoRotateResult> RotateEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        int degrees,
        CancellationToken cancellationToken)
    {
        PhotoRotateCalls.Add((itemId, fileNo, degrees));
        if (PhotoModerationException is not null)
        {
            return Task.FromException<HubEquipmentPhotoRotateResult>(PhotoModerationException);
        }

        return Task.FromResult(
            PhotoRotateResult
            ?? new HubEquipmentPhotoRotateResult { Ok = true, FileNo = fileNo, HasThumb = true });
    }

    public Exception? EquipmentHistoryException { get; set; }
    public HubEquipmentHistoryResponse EquipmentHistory { get; set; } = new();
    public List<string> EquipmentHistoryCalls { get; } = [];

    public Task<HubEquipmentHistoryResponse> GetEquipmentHistoryAsync(
        string invNo,
        CancellationToken cancellationToken)
    {
        EquipmentHistoryCalls.Add(invNo);
        if (EquipmentHistoryException is not null)
        {
            return Task.FromException<HubEquipmentHistoryResponse>(EquipmentHistoryException);
        }

        return Task.FromResult(EquipmentHistory);
    }

    // ---- Карточка сотрудника (/equipment/employee/{owner_no}) ----
    public Exception? EmployeeItemsException { get; set; }
    public HubEmployeeItemsResponse EmployeeItems { get; set; } = new();
    public List<(long OwnerNo, string? EmployeeName)> EmployeeItemsCalls { get; } = [];
    public Exception? EmployeeHistoryException { get; set; }
    public HubEmployeeHistoryResponse EmployeeHistory { get; set; } = new();

    /// <summary>Страница истории по (owner, direction, q, page) — иначе общая EmployeeHistory.</summary>
    public Func<(long OwnerNo, string? Direction, string? Q, int Page, int Limit), HubEmployeeHistoryResponse>?
        EmployeeHistoryFactory { get; set; }
    public List<(long OwnerNo, string? Direction, string? Q, int Page, int Limit)> EmployeeHistoryCalls { get; } = [];

    /// <summary>Шов задержки истории — тест гонки «панель закрыта до ответа».</summary>
    public Func<CancellationToken, Task>? EmployeeHistoryDelay { get; set; }

    public Task<HubEmployeeItemsResponse> GetEmployeeItemsAsync(
        long ownerNo,
        string? employeeName,
        CancellationToken cancellationToken)
    {
        EmployeeItemsCalls.Add((ownerNo, employeeName));
        if (EmployeeItemsException is not null)
        {
            return Task.FromException<HubEmployeeItemsResponse>(EmployeeItemsException);
        }

        return Task.FromResult(EmployeeItems);
    }

    public async Task<HubEmployeeHistoryResponse> GetEmployeeHistoryAsync(
        long ownerNo,
        string? direction,
        string? q,
        int page,
        int limit,
        CancellationToken cancellationToken)
    {
        EmployeeHistoryCalls.Add((ownerNo, direction, q, page, limit));
        if (EmployeeHistoryException is not null)
        {
            throw EmployeeHistoryException;
        }

        if (EmployeeHistoryDelay is not null)
        {
            await EmployeeHistoryDelay(cancellationToken);
        }

        var call = (ownerNo, direction, q, page, limit);
        return EmployeeHistoryFactory?.Invoke(call) ?? EmployeeHistory;
    }

    public Task<IReadOnlyList<HubEquipmentType>> GetEquipmentTypesAsync(
        CancellationToken cancellationToken)
    {
        EquipmentTypesCallCount++;
        if (EquipmentTypesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentType>>(EquipmentTypesException);
        }

        return Task.FromResult(EquipmentTypes);
    }

    // ---- Передача оборудования ----
    public Exception? EquipmentEmployeesException { get; set; }
    public HubEquipmentEmployeePage EquipmentEmployeePage { get; set; } = new() { Employees = [] };
    public List<string> EquipmentEmployeeQueries { get; } = [];
    public int EquipmentEmployeesCallCount => EquipmentEmployeeQueries.Count;
    public Exception? EquipmentBranchesException { get; set; }
    public IReadOnlyList<HubEquipmentBranch> EquipmentBranches { get; set; } = [];
    public int EquipmentBranchesCallCount { get; private set; }
    public Exception? EquipmentLocationsException { get; set; }
    public IReadOnlyList<HubEquipmentLocation> EquipmentLocations { get; set; } = [];
    public List<string?> EquipmentLocationsCalls { get; } = [];
    public Exception? TransferException { get; set; }
    public List<HubEquipmentTransferRequest> TransferRequests { get; } = [];
    public List<HubTransferLocationRequest> LocationTransferRequests { get; } = [];
    public Exception? LocationTransferException { get; set; }

    /// <summary>Ответы transfer/job по очереди: фабрика по номеру вызова, иначе TransferResponse.</summary>
    public Func<int, HubTransferExecuteResponse>? TransferResponseFactory { get; set; }
    public HubTransferExecuteResponse TransferResponse { get; set; } = new();
    public Func<int, HubTransferExecuteResponse>? TransferJobResponseFactory { get; set; }
    public HubTransferExecuteResponse TransferJobResponse { get; set; } = new();
    public Exception? TransferJobException { get; set; }
    public List<string> TransferJobCalls { get; } = [];
    public Exception? TransferActDownloadException { get; set; }
    public List<string> TransferActDownloads { get; } = [];
    public string? TransferActDownloadName { get; set; }
    public byte[]? TransferActBytes { get; set; }

    public Task<HubEquipmentEmployeePage> SearchEquipmentEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        EquipmentEmployeeQueries.Add(query);
        if (EquipmentEmployeesException is not null)
        {
            return Task.FromException<HubEquipmentEmployeePage>(EquipmentEmployeesException);
        }

        return Task.FromResult(EquipmentEmployeePage);
    }

    public Task<IReadOnlyList<HubEquipmentBranch>> GetEquipmentBranchesAsync(
        CancellationToken cancellationToken)
    {
        EquipmentBranchesCallCount++;
        if (EquipmentBranchesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentBranch>>(EquipmentBranchesException);
        }

        return Task.FromResult(EquipmentBranches);
    }

    public Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentLocationsAsync(
        string? branchId,
        CancellationToken cancellationToken)
    {
        EquipmentLocationsCalls.Add(branchId);
        if (EquipmentLocationsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentLocation>>(EquipmentLocationsException);
        }

        return Task.FromResult(EquipmentLocations);
    }

    // ---- Справочники и запись карточки оборудования (редактор «Базы») ----
    public Exception? EquipmentBranchLocationsException { get; set; }
    public IReadOnlyList<HubEquipmentLocation> EquipmentBranchLocations { get; set; } = [];

    /// <summary>Ответ локаций по branch_id, иначе — общий EquipmentBranchLocations.</summary>
    public Func<string, IReadOnlyList<HubEquipmentLocation>>? EquipmentBranchLocationsFactory { get; set; }
    public List<string> EquipmentBranchLocationsCalls { get; } = [];
    public Exception? EquipmentStatusesException { get; set; }
    public IReadOnlyList<HubEquipmentStatus> EquipmentStatuses { get; set; } = [];
    public int EquipmentStatusesCallCount { get; private set; }
    public Exception? EquipmentModelsException { get; set; }
    public IReadOnlyList<HubEquipmentModel> EquipmentModels { get; set; } = [];

    /// <summary>Ответ моделей по type_no, иначе — общий EquipmentModels.</summary>
    public Func<int, IReadOnlyList<HubEquipmentModel>>? EquipmentModelsFactory { get; set; }
    public List<int> EquipmentModelsCalls { get; } = [];
    public Exception? EquipmentOwnersException { get; set; }
    public IReadOnlyList<HubEquipmentOwner> EquipmentOwners { get; set; } = [];
    public List<(string Query, int Limit)> EquipmentOwnersCalls { get; } = [];
    public Exception? EquipmentUpdateException { get; set; }
    public HubEquipmentItem? EquipmentUpdateResult { get; set; }
    public List<(string InvNo, HubEquipmentUpdateRequest Request)> EquipmentUpdateCalls { get; } = [];
    public Exception? EquipmentCreateException { get; set; }
    public HubEquipmentCreateResult EquipmentCreateResult { get; set; } = new()
    {
        Success = true,
        InvNo = "100500",
    };
    public List<HubEquipmentCreateRequest> EquipmentCreateCalls { get; } = [];

    public Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentBranchLocationsAsync(
        string branchId,
        CancellationToken cancellationToken)
    {
        EquipmentBranchLocationsCalls.Add(branchId);
        if (EquipmentBranchLocationsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentLocation>>(EquipmentBranchLocationsException);
        }

        return Task.FromResult(
            EquipmentBranchLocationsFactory?.Invoke(branchId) ?? EquipmentBranchLocations);
    }

    public Task<IReadOnlyList<HubEquipmentStatus>> GetEquipmentStatusesAsync(
        CancellationToken cancellationToken)
    {
        EquipmentStatusesCallCount++;
        if (EquipmentStatusesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentStatus>>(EquipmentStatusesException);
        }

        return Task.FromResult(EquipmentStatuses);
    }

    public Task<IReadOnlyList<HubEquipmentModel>> GetEquipmentModelsAsync(
        int typeNo,
        CancellationToken cancellationToken)
    {
        EquipmentModelsCalls.Add(typeNo);
        if (EquipmentModelsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentModel>>(EquipmentModelsException);
        }

        return Task.FromResult(
            EquipmentModelsFactory?.Invoke(typeNo) ?? EquipmentModels);
    }

    public Task<IReadOnlyList<HubEquipmentOwner>> SearchEquipmentOwnersAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        EquipmentOwnersCalls.Add((query, limit));
        if (EquipmentOwnersException is not null)
        {
            return Task.FromException<IReadOnlyList<HubEquipmentOwner>>(EquipmentOwnersException);
        }

        return Task.FromResult(EquipmentOwners);
    }

    public Task<HubEquipmentItem> UpdateEquipmentAsync(
        string invNo,
        HubEquipmentUpdateRequest request,
        CancellationToken cancellationToken)
    {
        EquipmentUpdateCalls.Add((invNo, request));
        if (EquipmentUpdateException is not null)
        {
            return Task.FromException<HubEquipmentItem>(EquipmentUpdateException);
        }

        return Task.FromResult(
            EquipmentUpdateResult
            ?? EquipmentDetail
            ?? new HubEquipmentItem
            {
                InvNo = double.TryParse(invNo, out var n) ? n : null,
            });
    }

    public Task<HubEquipmentCreateResult> CreateEquipmentAsync(
        HubEquipmentCreateRequest request,
        CancellationToken cancellationToken)
    {
        EquipmentCreateCalls.Add(request);
        if (EquipmentCreateException is not null)
        {
            return Task.FromException<HubEquipmentCreateResult>(EquipmentCreateException);
        }

        return Task.FromResult(EquipmentCreateResult);
    }

    public Task<HubTransferExecuteResponse> TransferEquipmentAsync(
        HubEquipmentTransferRequest request,
        CancellationToken cancellationToken)
    {
        TransferRequests.Add(request);
        if (TransferException is not null)
        {
            return Task.FromException<HubTransferExecuteResponse>(TransferException);
        }

        return Task.FromResult(
            TransferResponseFactory?.Invoke(TransferRequests.Count) ?? TransferResponse);
    }

    public Task<HubTransferExecuteResponse> TransferEquipmentLocationAsync(
        HubTransferLocationRequest request,
        CancellationToken cancellationToken)
    {
        LocationTransferRequests.Add(request);
        if (LocationTransferException is not null)
        {
            return Task.FromException<HubTransferExecuteResponse>(LocationTransferException);
        }

        return Task.FromResult(
            TransferResponseFactory?.Invoke(LocationTransferRequests.Count) ?? TransferResponse);
    }

    public Task<HubTransferExecuteResponse> GetTransferActJobAsync(
        string jobId,
        CancellationToken cancellationToken)
    {
        TransferJobCalls.Add(jobId);
        if (TransferJobException is not null)
        {
            return Task.FromException<HubTransferExecuteResponse>(TransferJobException);
        }

        return Task.FromResult(
            TransferJobResponseFactory?.Invoke(TransferJobCalls.Count) ?? TransferJobResponse);
    }

    public Task<string> DownloadTransferActAsync(
        string actId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        TransferActDownloads.Add(actId);
        if (TransferActDownloadException is not null)
        {
            return Task.FromException<string>(TransferActDownloadException);
        }

        if (TransferActBytes is not null)
        {
            destination.Write(TransferActBytes, 0, TransferActBytes.Length);
        }

        return Task.FromResult(TransferActDownloadName ?? "act.pdf");
    }

    // ---- «Только акт» и загрузка подписанного акта ----
    public Exception? ActOnlyTransferException { get; set; }
    public List<HubTransferActOnlyRequest> ActOnlyTransferRequests { get; } = [];
    public Exception? UploadedActParseException { get; set; }

    /// <summary>Ошибка parse по номеру вызова (1-based): авто→manual fallback тестам.</summary>
    public Func<int, Exception?>? UploadedActParseExceptionFactory { get; set; }
    public HubUploadedActDraft UploadedActParseResult { get; set; } = new()
    {
        DraftId = "draft-1",
        FileName = "act.pdf",
        FromEmployee = "Иванов И.И.",
        ToEmployee = "Петров П.П.",
        DocDate = "2025-01-15",
        EquipmentInvNos = ["100234", "100235"],
        ResolvedItems =
        [
            new HubUploadedActResolvedItem
            {
                ItemId = 42,
                InvNo = "100234",
                SerialNo = "SN-1",
                ModelName = "ThinkPad T14",
                EmployeeName = "Иванов И.И.",
                BranchName = "Центральный",
                LocationName = "Офис 101",
            },
        ],
    };
    public List<(string FileName, long Size, bool ManualMode)> UploadedActParseCalls { get; } = [];
    public Exception? UploadedActCommitException { get; set; }
    public HubUploadedActCommitResult UploadedActCommitResult { get; set; } = new()
    {
        Success = true,
        DocNo = 501,
        DocNumber = "А-501",
        FileNo = 7001,
        LinkedItemIds = [42],
        LinkedInvNos = ["100234", "100235"],
    };
    public List<HubUploadedActCommitRequest> UploadedActCommitRequests { get; } = [];
    public Exception? EquipmentActDownloadException { get; set; }
    public List<long> EquipmentActDownloads { get; } = [];
    public string? EquipmentActDownloadName { get; set; }
    public byte[]? EquipmentActBytes { get; set; }

    // ---- Напоминания о загрузке актов и email-отправка акта ----
    public Exception? TransferReminderException { get; set; }
    public HubTransferActReminder TransferReminderResult { get; set; } = new()
    {
        ReminderId = "rem-1",
        TaskId = "901",
        NewEmployeeNo = "77",
        NewEmployeeName = "Иванов И.И.",
        Status = "pending",
        PendingGroupsTotal = 1,
        CompletedGroupsTotal = 0,
        PendingGroups =
        [
            new HubTransferActReminderGroup
            {
                Id = "g-1",
                OldEmployeeName = "Петров П.П.",
                InvNos = ["100234", "100235"],
                EquipmentCount = 2,
            },
        ],
        UploadUrl = "/database?upload_act=1&reminder_id=rem-1&source_task_id=901",
    };
    public List<string> TransferReminderCalls { get; } = [];
    public Exception? UploadedActEmailException { get; set; }
    public HubUploadedActEmailResult UploadedActEmailResult { get; set; } = new()
    {
        DocNo = 501,
        Subject = "Акт №501",
        SuccessCount = 1,
        FailedCount = 0,
        Recipients =
        [
            new HubUploadedActEmailRecipient
            {
                OwnerNo = 77,
                EmployeeName = "Иванов И.И.",
                Email = "ivanov@hub.test",
                Status = "sent",
            },
        ],
    };
    public List<HubUploadedActEmailRequest> UploadedActEmailRequests { get; } = [];

    public Task<HubTransferExecuteResponse> TransferActOnlyAsync(
        HubTransferActOnlyRequest request,
        CancellationToken cancellationToken)
    {
        ActOnlyTransferRequests.Add(request);
        if (ActOnlyTransferException is not null)
        {
            return Task.FromException<HubTransferExecuteResponse>(ActOnlyTransferException);
        }

        return Task.FromResult(
            TransferResponseFactory?.Invoke(ActOnlyTransferRequests.Count) ?? TransferResponse);
    }

    public Task<HubUploadedActDraft> ParseUploadedActAsync(
        string fileName,
        byte[] content,
        bool manualMode,
        CancellationToken cancellationToken)
    {
        UploadedActParseCalls.Add((fileName, content?.Length ?? 0, manualMode));
        var exception = UploadedActParseExceptionFactory?.Invoke(UploadedActParseCalls.Count)
            ?? UploadedActParseException;
        if (exception is not null)
        {
            return Task.FromException<HubUploadedActDraft>(exception);
        }

        return Task.FromResult(UploadedActParseResult);
    }

    public Task<HubUploadedActCommitResult> CommitUploadedActAsync(
        HubUploadedActCommitRequest request,
        CancellationToken cancellationToken)
    {
        UploadedActCommitRequests.Add(request);
        if (UploadedActCommitException is not null)
        {
            return Task.FromException<HubUploadedActCommitResult>(UploadedActCommitException);
        }

        return Task.FromResult(UploadedActCommitResult);
    }

    public Task<HubTransferActReminder> GetTransferReminderAsync(
        string reminderId,
        CancellationToken cancellationToken)
    {
        TransferReminderCalls.Add(reminderId);
        if (TransferReminderException is not null)
        {
            return Task.FromException<HubTransferActReminder>(TransferReminderException);
        }

        return Task.FromResult(TransferReminderResult);
    }

    public Task<HubUploadedActEmailResult> SendUploadedActEmailAsync(
        HubUploadedActEmailRequest request,
        CancellationToken cancellationToken)
    {
        UploadedActEmailRequests.Add(request);
        if (UploadedActEmailException is not null)
        {
            return Task.FromException<HubUploadedActEmailResult>(UploadedActEmailException);
        }

        return Task.FromResult(UploadedActEmailResult);
    }

    public Task<string> DownloadEquipmentActFileAsync(
        long docNo,
        Stream destination,
        CancellationToken cancellationToken)
    {
        EquipmentActDownloads.Add(docNo);
        if (EquipmentActDownloadException is not null)
        {
            return Task.FromException<string>(EquipmentActDownloadException);
        }

        if (EquipmentActBytes is not null)
        {
            destination.Write(EquipmentActBytes, 0, EquipmentActBytes.Length);
        }

        return Task.FromResult(EquipmentActDownloadName ?? "act.pdf");
    }

    // ---- Расходники склада (/equipment/consumables*) ----
    public Exception? ConsumablesLookupException { get; set; }
    public IReadOnlyList<HubConsumableLookupItem> ConsumablesLookup { get; set; } = [];
    public List<(bool OnlyPositiveQty, int Limit)> ConsumablesLookupCalls { get; } = [];

    /// <summary>Шов задержки справочника — тест гонки «устройство сменилось до ответа».</summary>
    public Func<CancellationToken, Task>? ConsumablesLookupDelay { get; set; }
    public Exception? ConsumableConsumeException { get; set; }
    public List<HubConsumableConsumeRequest> ConsumableConsumeRequests { get; } = [];
    public HubConsumableConsumeResponse ConsumableConsumeResponse { get; set; } = new()
    {
        Success = true,
        QtyNew = 0,
    };
    public Exception? ConsumableQtyUpdateException { get; set; }
    public List<HubConsumableQtyUpdateRequest> ConsumableQtyUpdateRequests { get; } = [];
    public HubConsumableQtyUpdateResponse ConsumableQtyUpdateResponse { get; set; } = new()
    {
        Success = true,
        QtyNew = 0,
    };
    public Exception? ConsumableCreateException { get; set; }
    public List<HubConsumableCreateRequest> ConsumableCreateRequests { get; } = [];
    public HubConsumableCreateResponse ConsumableCreateResponse { get; set; } = new()
    {
        Success = true,
    };

    public async Task<IReadOnlyList<HubConsumableLookupItem>> GetConsumablesLookupAsync(
        bool onlyPositiveQty,
        int limit,
        CancellationToken cancellationToken)
    {
        ConsumablesLookupCalls.Add((onlyPositiveQty, limit));
        if (ConsumablesLookupException is not null)
        {
            throw ConsumablesLookupException;
        }

        if (ConsumablesLookupDelay is not null)
        {
            await ConsumablesLookupDelay(cancellationToken);
        }

        return ConsumablesLookup;
    }

    public Task<HubConsumableConsumeResponse> ConsumeConsumableAsync(
        HubConsumableConsumeRequest request,
        CancellationToken cancellationToken)
    {
        ConsumableConsumeRequests.Add(request);
        if (ConsumableConsumeException is not null)
        {
            return Task.FromException<HubConsumableConsumeResponse>(ConsumableConsumeException);
        }

        return Task.FromResult(ConsumableConsumeResponse);
    }

    public Task<HubConsumableQtyUpdateResponse> UpdateConsumableQtyAsync(
        HubConsumableQtyUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ConsumableQtyUpdateRequests.Add(request);
        if (ConsumableQtyUpdateException is not null)
        {
            return Task.FromException<HubConsumableQtyUpdateResponse>(ConsumableQtyUpdateException);
        }

        return Task.FromResult(ConsumableQtyUpdateResponse);
    }

    public Task<HubConsumableCreateResponse> CreateConsumableAsync(
        HubConsumableCreateRequest request,
        CancellationToken cancellationToken)
    {
        ConsumableCreateRequests.Add(request);
        if (ConsumableCreateException is not null)
        {
            return Task.FromException<HubConsumableCreateResponse>(ConsumableCreateException);
        }

        return Task.FromResult(ConsumableCreateResponse);
    }

    // ---- Доступ к группам AD ----
    public Exception? GroupsAccessStatusException { get; set; }
    public HubGroupsAccessStatus GroupsAccessStatus { get; set; } = new();
    public int GroupsAccessStatusCallCount { get; private set; }
    public Exception? GroupsAccessMatrixException { get; set; }
    public HubGroupsAccessMatrixGrid GroupsAccessMatrix { get; set; } = new();

    /// <summary>Выдача матрицы по запросу (branch/filters), иначе — общая GroupsAccessMatrix.</summary>
    public Func<HubGroupsAccessMatrixQuery, HubGroupsAccessMatrixGrid>? GroupsAccessMatrixFactory { get; set; }
    public List<HubGroupsAccessMatrixQuery> GroupsAccessMatrixQueries { get; } = [];
    public Exception? GroupsAccessGroupDetailException { get; set; }
    public HubGroupsAccessGroupDetail? GroupsAccessGroupDetail { get; set; }

    /// <summary>Деталь группы по dn; иначе — общий GroupsAccessGroupDetail.</summary>
    public Func<string, HubGroupsAccessGroupDetail>? GroupsAccessGroupDetailFactory { get; set; }
    public List<string> GroupsAccessGroupDetailCalls { get; } = [];

    /// <summary>Задержка ответа детали: тесты гонки выбора ставят Task.Delay/TaskCompletionSource.</summary>
    public Func<string, CancellationToken, Task>? GroupsAccessGroupDetailDelay { get; set; }

    public Task<HubGroupsAccessStatus> GetGroupsAccessStatusAsync(
        CancellationToken cancellationToken)
    {
        GroupsAccessStatusCallCount++;
        if (GroupsAccessStatusException is not null)
        {
            return Task.FromException<HubGroupsAccessStatus>(GroupsAccessStatusException);
        }

        return Task.FromResult(GroupsAccessStatus);
    }

    public Task<HubGroupsAccessMatrixGrid> GetGroupsAccessMatrixGridAsync(
        HubGroupsAccessMatrixQuery query,
        CancellationToken cancellationToken)
    {
        GroupsAccessMatrixQueries.Add(query);
        if (GroupsAccessMatrixException is not null)
        {
            return Task.FromException<HubGroupsAccessMatrixGrid>(GroupsAccessMatrixException);
        }

        return Task.FromResult(
            GroupsAccessMatrixFactory?.Invoke(query) ?? GroupsAccessMatrix);
    }

    public async Task<HubGroupsAccessGroupDetail> GetGroupsAccessGroupDetailAsync(
        string groupDn,
        CancellationToken cancellationToken)
    {
        GroupsAccessGroupDetailCalls.Add(groupDn);
        if (GroupsAccessGroupDetailException is not null)
        {
            throw GroupsAccessGroupDetailException;
        }

        if (GroupsAccessGroupDetailDelay is not null)
        {
            await GroupsAccessGroupDetailDelay(groupDn, cancellationToken);
        }

        return GroupsAccessGroupDetailFactory?.Invoke(groupDn) ?? GroupsAccessGroupDetail
            ?? new HubGroupsAccessGroupDetail
            {
                Group = new HubGroupsAccessGroup { Dn = groupDn },
                Members = [],
            };
    }

    // ---- Терминалы ВКС ----
    public Exception? VcsComputersException { get; set; }
    public IReadOnlyList<HubVcsComputer> VcsComputers { get; set; } = [];
    public int VcsComputersCallCount { get; private set; }
    public Exception? VcsLaunchTokenException { get; set; }
    public HubVcsLaunchToken VcsLaunchToken { get; set; } = new() { Token = "launch-token-1", ExpiresInSeconds = 60 };

    /// <summary>Токен по id терминала, иначе — общий VcsLaunchToken.</summary>
    public Func<string, HubVcsLaunchToken>? VcsLaunchTokenFactory { get; set; }
    public List<string> VcsLaunchTokenCalls { get; } = [];

    public Task<IReadOnlyList<HubVcsComputer>> GetVcsComputersAsync(
        CancellationToken cancellationToken)
    {
        VcsComputersCallCount++;
        if (VcsComputersException is not null)
        {
            return Task.FromException<IReadOnlyList<HubVcsComputer>>(VcsComputersException);
        }

        return Task.FromResult(VcsComputers);
    }

    public Task<HubVcsLaunchToken> CreateVcsLaunchTokenAsync(
        string computerId,
        CancellationToken cancellationToken)
    {
        VcsLaunchTokenCalls.Add(computerId);
        if (VcsLaunchTokenException is not null)
        {
            return Task.FromException<HubVcsLaunchToken>(VcsLaunchTokenException);
        }

        return Task.FromResult(
            VcsLaunchTokenFactory?.Invoke(computerId) ?? VcsLaunchToken);
    }

    // ---- Терминалы ВКС: управление (vcs.manage) ----
    public Exception? VcsComputerWriteException { get; set; }

    /// <summary>Ответ create/update по (id — null для create, тело), иначе — echo тела.</summary>
    public Func<string?, HubVcsComputerInput, HubVcsComputer>? VcsComputerWriteFactory { get; set; }
    public List<(string? Id, HubVcsComputerInput Input)> VcsComputerWriteCalls { get; } = [];
    public Exception? VcsComputerDeleteException { get; set; }
    public List<string> VcsComputerDeleteCalls { get; } = [];
    public Exception? VcsOrderException { get; set; }

    /// <summary>Если задана — управляемая задержка ответа PUT …/order (гонки reorder).</summary>
    public Func<CancellationToken, Task>? VcsOrderDelay { get; set; }
    public List<IReadOnlyList<string>> VcsOrderCalls { get; } = [];
    public Exception? VcsConfigException { get; set; }
    public Exception? VcsConfigUpdateException { get; set; }
    public HubVcsConfig VcsConfig { get; set; } = new() { PasswordConfigured = true };
    public int VcsConfigGetCount { get; private set; }
    public List<string> VcsConfigUpdateCalls { get; } = [];
    public Exception? VcsInfoException { get; set; }
    public Exception? VcsInfoUpdateException { get; set; }
    public HubVcsInfo VcsInfo { get; set; } = new() { Content = string.Empty };
    public int VcsInfoGetCount { get; private set; }
    public List<string> VcsInfoUpdateCalls { get; } = [];

    public Task<HubVcsComputer> CreateVcsComputerAsync(
        HubVcsComputerInput computer,
        CancellationToken cancellationToken)
    {
        VcsComputerWriteCalls.Add((null, computer));
        if (VcsComputerWriteException is not null)
        {
            return Task.FromException<HubVcsComputer>(VcsComputerWriteException);
        }

        return Task.FromResult(
            VcsComputerWriteFactory?.Invoke(null, computer)
            ?? new HubVcsComputer
            {
                Id = "vcs-new",
                Name = computer.Name,
                IpAddress = computer.IpAddress,
                Location = computer.Location,
            });
    }

    public Task<HubVcsComputer> UpdateVcsComputerAsync(
        string computerId,
        HubVcsComputerInput computer,
        CancellationToken cancellationToken)
    {
        VcsComputerWriteCalls.Add((computerId, computer));
        if (VcsComputerWriteException is not null)
        {
            return Task.FromException<HubVcsComputer>(VcsComputerWriteException);
        }

        return Task.FromResult(
            VcsComputerWriteFactory?.Invoke(computerId, computer)
            ?? new HubVcsComputer
            {
                Id = computerId,
                Name = computer.Name,
                IpAddress = computer.IpAddress,
                Location = computer.Location,
            });
    }

    public Task DeleteVcsComputerAsync(
        string computerId,
        CancellationToken cancellationToken)
    {
        VcsComputerDeleteCalls.Add(computerId);
        return VcsComputerDeleteException is not null
            ? Task.FromException(VcsComputerDeleteException)
            : Task.CompletedTask;
    }

    public async Task UpdateVcsComputersOrderAsync(
        IReadOnlyList<string> orderedIds,
        CancellationToken cancellationToken)
    {
        VcsOrderCalls.Add(orderedIds);
        if (VcsOrderException is not null)
        {
            throw VcsOrderException;
        }

        if (VcsOrderDelay is not null)
        {
            await VcsOrderDelay(cancellationToken);
        }
    }

    public Task<HubVcsConfig> GetVcsConfigAsync(
        CancellationToken cancellationToken)
    {
        VcsConfigGetCount++;
        if (VcsConfigException is not null)
        {
            return Task.FromException<HubVcsConfig>(VcsConfigException);
        }

        return Task.FromResult(VcsConfig);
    }

    public Task<HubVcsConfig> UpdateVcsConfigAsync(
        string passwordHex,
        CancellationToken cancellationToken)
    {
        VcsConfigUpdateCalls.Add(passwordHex);
        if (VcsConfigUpdateException is not null)
        {
            return Task.FromException<HubVcsConfig>(VcsConfigUpdateException);
        }

        // Как сервер: password_configured — по непустому hex.
        VcsConfig = new HubVcsConfig { PasswordConfigured = passwordHex.Trim().Length > 0 };
        return Task.FromResult(VcsConfig);
    }

    public Task<HubVcsInfo> GetVcsInfoAsync(
        CancellationToken cancellationToken)
    {
        VcsInfoGetCount++;
        if (VcsInfoException is not null)
        {
            return Task.FromException<HubVcsInfo>(VcsInfoException);
        }

        return Task.FromResult(VcsInfo);
    }

    public Task<HubVcsInfo> UpdateVcsInfoAsync(
        string content,
        CancellationToken cancellationToken)
    {
        VcsInfoUpdateCalls.Add(content);
        if (VcsInfoUpdateException is not null)
        {
            return Task.FromException<HubVcsInfo>(VcsInfoUpdateException);
        }

        VcsInfo = new HubVcsInfo { Content = content };
        return Task.FromResult(VcsInfo);
    }

    // ---- Мониторинг ----
    public Exception? MonitoringOverviewException { get; set; }
    public HubMonitoringOverview MonitoringOverview { get; set; } = new() { Targets = [] };
    public int MonitoringOverviewCallCount { get; private set; }
    public Exception? MonitoringTargetDetailException { get; set; }
    public HubMonitoringTarget? MonitoringTargetDetail { get; set; }

    /// <summary>Деталь по id цели, иначе — общий MonitoringTargetDetail.</summary>
    public Func<string, HubMonitoringTarget>? MonitoringTargetDetailFactory { get; set; }
    public List<string> MonitoringTargetDetailCalls { get; } = [];

    public Task<HubMonitoringOverview> GetMonitoringOverviewAsync(
        CancellationToken cancellationToken)
    {
        MonitoringOverviewCallCount++;
        if (MonitoringOverviewException is not null)
        {
            return Task.FromException<HubMonitoringOverview>(MonitoringOverviewException);
        }

        return Task.FromResult(MonitoringOverview);
    }

    public Task<HubMonitoringTarget> GetMonitoringTargetAsync(
        string targetId,
        CancellationToken cancellationToken)
    {
        MonitoringTargetDetailCalls.Add(targetId);
        if (MonitoringTargetDetailException is not null)
        {
            return Task.FromException<HubMonitoringTarget>(MonitoringTargetDetailException);
        }

        return Task.FromResult(
            MonitoringTargetDetailFactory?.Invoke(targetId)
            ?? MonitoringTargetDetail
            ?? new HubMonitoringTarget { Id = targetId, Enabled = true });
    }

    // ---- МФУ и принтеры ----
    public Exception? MfuDevicesException { get; set; }
    public HubMfuDeviceList MfuDevices { get; set; } = new()
    {
        Totals = new HubMfuTotals(),
        Grouped = new Dictionary<string, Dictionary<string, List<HubMfuDevice>>>(),
    };
    public int MfuDevicesCallCount { get; private set; }
    public List<(int PeriodDays, int RecentLimit, int Limit)> MfuDevicesCalls { get; } = [];

    public Exception? MfuMonthlyPagesException { get; set; }
    public HubMfuMonthlyPages MfuMonthlyPages { get; set; } = new() { Months = [] };

    /// <summary>Помесячная печать по ключу устройства, иначе — общий MfuMonthlyPages.</summary>
    public Func<string, HubMfuMonthlyPages>? MfuMonthlyPagesFactory { get; set; }
    public List<string> MfuMonthlyPagesCalls { get; } = [];

    public Exception? MfuWorksStatisticsException { get; set; }
    public HubMfuWorksStatistics MfuWorksStatistics { get; set; } = new()
    {
        Totals = new HubMfuWorksTotals(),
    };
    public int MfuWorksStatisticsCallCount { get; private set; }

    public Task<HubMfuDeviceList> GetMfuDevicesAsync(
        int periodDays,
        int recentLimit,
        int limit,
        CancellationToken cancellationToken)
    {
        MfuDevicesCallCount++;
        MfuDevicesCalls.Add((periodDays, recentLimit, limit));
        if (MfuDevicesException is not null)
        {
            return Task.FromException<HubMfuDeviceList>(MfuDevicesException);
        }

        return Task.FromResult(MfuDevices);
    }

    public Task<HubMfuMonthlyPages> GetMfuMonthlyPagesAsync(
        string deviceKey,
        int months,
        CancellationToken cancellationToken)
    {
        MfuMonthlyPagesCalls.Add(deviceKey);
        if (MfuMonthlyPagesException is not null)
        {
            return Task.FromException<HubMfuMonthlyPages>(MfuMonthlyPagesException);
        }

        return Task.FromResult(
            MfuMonthlyPagesFactory?.Invoke(deviceKey)
            ?? MfuMonthlyPages
            ?? new HubMfuMonthlyPages { DeviceKey = deviceKey, Months = [] });
    }

    public Task<HubMfuWorksStatistics> GetMfuWorksStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        MfuWorksStatisticsCallCount++;
        if (MfuWorksStatisticsException is not null)
        {
            return Task.FromException<HubMfuWorksStatistics>(MfuWorksStatisticsException);
        }

        return Task.FromResult(MfuWorksStatistics);
    }

    // ---- Статистика работ ----
    public Exception? PcCleaningStatisticsException { get; set; }
    public HubPcCleaningStatistics PcCleaningStatistics { get; set; } = new()
    {
        Totals = new HubPcCleaningStatisticsTotals(),
        Branches = [],
    };
    public List<int> PcCleaningStatisticsCalls { get; } = [];

    public Exception? BatteryStatisticsException { get; set; }
    public HubBatteryStatistics BatteryStatistics { get; set; } = new()
    {
        Totals = new HubBatteryStatisticsTotals(),
    };
    public List<int> BatteryStatisticsCalls { get; } = [];

    public Exception? PcComponentsStatisticsException { get; set; }
    public HubPcComponentsStatistics PcComponentsStatistics { get; set; } = new()
    {
        Totals = new HubPcComponentsStatisticsTotals(),
    };
    public List<int> PcComponentsStatisticsCalls { get; } = [];

    public Task<HubPcCleaningStatistics> GetPcCleaningStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        PcCleaningStatisticsCalls.Add(periodDays);
        if (PcCleaningStatisticsException is not null)
        {
            return Task.FromException<HubPcCleaningStatistics>(PcCleaningStatisticsException);
        }

        return Task.FromResult(PcCleaningStatistics);
    }

    public Task<HubBatteryStatistics> GetBatteryStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        BatteryStatisticsCalls.Add(periodDays);
        if (BatteryStatisticsException is not null)
        {
            return Task.FromException<HubBatteryStatistics>(BatteryStatisticsException);
        }

        return Task.FromResult(BatteryStatistics);
    }

    public Task<HubPcComponentsStatistics> GetPcComponentsStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        PcComponentsStatisticsCalls.Add(periodDays);
        if (PcComponentsStatisticsException is not null)
        {
            return Task.FromException<HubPcComponentsStatistics>(PcComponentsStatisticsException);
        }

        return Task.FromResult(PcComponentsStatistics);
    }

    // ---- Журнал работ по карточке оборудования (/json/works*) ----

    public Exception? CartridgeWorkHistoryException { get; set; }
    public HubMaintenanceHistory CartridgeWorkHistory { get; set; } = new();
    public List<(string? SerialNumber, string? HwSerialNumber, string? InvNo, string? CartridgeModel)> CartridgeWorkHistoryCalls { get; } = [];

    public Exception? BatteryWorkHistoryException { get; set; }
    public HubMaintenanceHistory BatteryWorkHistory { get; set; } = new();
    public List<(string? SerialNumber, string? HwSerialNumber)> BatteryWorkHistoryCalls { get; } = [];

    public Exception? ComponentWorkHistoryException { get; set; }
    public HubMaintenanceHistory ComponentWorkHistory { get; set; } = new();
    public List<(string? SerialNumber, string? HwSerialNumber, string? ComponentType, string? ComponentName)> ComponentWorkHistoryCalls { get; } = [];

    public Exception? CleaningWorkHistoryException { get; set; }
    public HubMaintenanceHistory CleaningWorkHistory { get; set; } = new();
    public List<(string? SerialNumber, string? HwSerialNumber, string? InvNo, long? EquipmentId)> CleaningWorkHistoryCalls { get; } = [];

    public Task<HubMaintenanceHistory> GetCartridgeWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        string? cartridgeModel,
        CancellationToken cancellationToken)
    {
        CartridgeWorkHistoryCalls.Add((serialNumber, hwSerialNumber, invNo, cartridgeModel));
        if (CartridgeWorkHistoryException is not null)
        {
            return Task.FromException<HubMaintenanceHistory>(CartridgeWorkHistoryException);
        }

        return Task.FromResult(CartridgeWorkHistory);
    }

    public Task<HubMaintenanceHistory> GetBatteryWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        CancellationToken cancellationToken)
    {
        BatteryWorkHistoryCalls.Add((serialNumber, hwSerialNumber));
        if (BatteryWorkHistoryException is not null)
        {
            return Task.FromException<HubMaintenanceHistory>(BatteryWorkHistoryException);
        }

        return Task.FromResult(BatteryWorkHistory);
    }

    public Task<HubMaintenanceHistory> GetComponentWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? componentType,
        string? componentName,
        CancellationToken cancellationToken)
    {
        ComponentWorkHistoryCalls.Add((serialNumber, hwSerialNumber, componentType, componentName));
        if (ComponentWorkHistoryException is not null)
        {
            return Task.FromException<HubMaintenanceHistory>(ComponentWorkHistoryException);
        }

        return Task.FromResult(ComponentWorkHistory);
    }

    public Task<HubMaintenanceHistory> GetCleaningWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        long? equipmentId,
        CancellationToken cancellationToken)
    {
        CleaningWorkHistoryCalls.Add((serialNumber, hwSerialNumber, invNo, equipmentId));
        if (CleaningWorkHistoryException is not null)
        {
            return Task.FromException<HubMaintenanceHistory>(CleaningWorkHistoryException);
        }

        return Task.FromResult(CleaningWorkHistory);
    }

    public Exception? CartridgeWorksException { get; set; }
    public IReadOnlyList<HubCartridgeWorkRecord> CartridgeWorks { get; set; } = [];
    public List<int> CartridgeWorksCalls { get; } = [];

    public Exception? BatteryWorksException { get; set; }
    public IReadOnlyList<HubBatteryWorkRecord> BatteryWorks { get; set; } = [];
    public List<(string? SerialNumber, int Limit)> BatteryWorksCalls { get; } = [];

    public Exception? ComponentWorksException { get; set; }
    public IReadOnlyList<HubComponentWorkRecord> ComponentWorks { get; set; } = [];
    public List<(string? SerialNumber, int Limit)> ComponentWorksCalls { get; } = [];

    public Exception? CleaningWorksException { get; set; }
    public IReadOnlyList<HubCleaningWorkRecord> CleaningWorks { get; set; } = [];
    public List<(string? SerialNumber, int Limit)> CleaningWorksCalls { get; } = [];

    public Task<IReadOnlyList<HubCartridgeWorkRecord>> GetCartridgeWorksAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        CartridgeWorksCalls.Add(limit);
        if (CartridgeWorksException is not null)
        {
            return Task.FromException<IReadOnlyList<HubCartridgeWorkRecord>>(CartridgeWorksException);
        }

        return Task.FromResult(CartridgeWorks);
    }

    public Task<IReadOnlyList<HubBatteryWorkRecord>> GetBatteryWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        BatteryWorksCalls.Add((serialNumber, limit));
        if (BatteryWorksException is not null)
        {
            return Task.FromException<IReadOnlyList<HubBatteryWorkRecord>>(BatteryWorksException);
        }

        return Task.FromResult(BatteryWorks);
    }

    public Task<IReadOnlyList<HubComponentWorkRecord>> GetComponentWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        ComponentWorksCalls.Add((serialNumber, limit));
        if (ComponentWorksException is not null)
        {
            return Task.FromException<IReadOnlyList<HubComponentWorkRecord>>(ComponentWorksException);
        }

        return Task.FromResult(ComponentWorks);
    }

    public Task<IReadOnlyList<HubCleaningWorkRecord>> GetCleaningWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        CleaningWorksCalls.Add((serialNumber, limit));
        if (CleaningWorksException is not null)
        {
            return Task.FromException<IReadOnlyList<HubCleaningWorkRecord>>(CleaningWorksException);
        }

        return Task.FromResult(CleaningWorks);
    }

    public Exception? PcCleaningRemainingException { get; set; }
    public HubPcCleaningRemaining PcCleaningRemaining { get; set; } = new()
    {
        RemainingPcs = [],
    };
    public List<(int PeriodDays, string Branch)> PcCleaningRemainingCalls { get; } = [];

    public Task<HubPcCleaningRemaining> GetPcCleaningRemainingAsync(
        int periodDays,
        string branch,
        CancellationToken cancellationToken)
    {
        PcCleaningRemainingCalls.Add((periodDays, branch));
        if (PcCleaningRemainingException is not null)
        {
            return Task.FromException<HubPcCleaningRemaining>(PcCleaningRemainingException);
        }

        return Task.FromResult(PcCleaningRemaining);
    }

    public Exception? CartridgeCompatibilityException { get; set; }
    public HubCartridgeCompatibility? CartridgeCompatibility { get; set; }
    public List<string> CartridgeCompatibilityCalls { get; } = [];

    public Task<HubCartridgeCompatibility> GetCartridgeCompatibilityAsync(
        string printerModel,
        CancellationToken cancellationToken)
    {
        CartridgeCompatibilityCalls.Add(printerModel);
        if (CartridgeCompatibilityException is not null)
        {
            return Task.FromException<HubCartridgeCompatibility>(CartridgeCompatibilityException);
        }

        return Task.FromResult(CartridgeCompatibility
            ?? new HubCartridgeCompatibility { PrinterModel = printerModel, CompatibleModels = [], Components = [] });
    }

    public Exception? RegisterCartridgeWorkException { get; set; }
    public HubCartridgeWorkRecord RegisterCartridgeWorkResponse { get; set; } = new();
    public List<HubCartridgeWorkRequest> RegisterCartridgeWorkRequests { get; } = [];

    public Exception? RegisterBatteryWorkException { get; set; }
    public HubBatteryWorkRecord RegisterBatteryWorkResponse { get; set; } = new();
    public List<HubBatteryWorkRequest> RegisterBatteryWorkRequests { get; } = [];

    public Exception? RegisterComponentWorkException { get; set; }
    public HubComponentWorkRecord RegisterComponentWorkResponse { get; set; } = new();
    public List<HubComponentWorkRequest> RegisterComponentWorkRequests { get; } = [];

    public Exception? RegisterCleaningWorkException { get; set; }
    public HubCleaningWorkRecord RegisterCleaningWorkResponse { get; set; } = new();
    public List<HubCleaningWorkRequest> RegisterCleaningWorkRequests { get; } = [];

    public Task<HubCartridgeWorkRecord> RegisterCartridgeWorkAsync(
        HubCartridgeWorkRequest request,
        CancellationToken cancellationToken)
    {
        RegisterCartridgeWorkRequests.Add(request);
        if (RegisterCartridgeWorkException is not null)
        {
            return Task.FromException<HubCartridgeWorkRecord>(RegisterCartridgeWorkException);
        }

        return Task.FromResult(RegisterCartridgeWorkResponse);
    }

    public Task<HubBatteryWorkRecord> RegisterBatteryWorkAsync(
        HubBatteryWorkRequest request,
        CancellationToken cancellationToken)
    {
        RegisterBatteryWorkRequests.Add(request);
        if (RegisterBatteryWorkException is not null)
        {
            return Task.FromException<HubBatteryWorkRecord>(RegisterBatteryWorkException);
        }

        return Task.FromResult(RegisterBatteryWorkResponse);
    }

    public Task<HubComponentWorkRecord> RegisterComponentWorkAsync(
        HubComponentWorkRequest request,
        CancellationToken cancellationToken)
    {
        RegisterComponentWorkRequests.Add(request);
        if (RegisterComponentWorkException is not null)
        {
            return Task.FromException<HubComponentWorkRecord>(RegisterComponentWorkException);
        }

        return Task.FromResult(RegisterComponentWorkResponse);
    }

    public Task<HubCleaningWorkRecord> RegisterCleaningWorkAsync(
        HubCleaningWorkRequest request,
        CancellationToken cancellationToken)
    {
        RegisterCleaningWorkRequests.Add(request);
        if (RegisterCleaningWorkException is not null)
        {
            return Task.FromException<HubCleaningWorkRecord>(RegisterCleaningWorkException);
        }

        return Task.FromResult(RegisterCleaningWorkResponse);
    }

    // ---- База знаний ----
    public Exception? KbCategoriesException { get; set; }
    public IReadOnlyList<HubKbCategory> KbCategories { get; set; } = [];
    public int KbCategoriesCallCount { get; private set; }
    public Exception? KbArticlesException { get; set; }
    public HubKbArticleListPage KbArticlesPage { get; set; } = new() { Items = [] };

    /// <summary>Выдача списка статей по запросу (q/category/status), иначе — общая KbArticlesPage.</summary>
    public Func<HubKbArticleQuery, HubKbArticleListPage>? KbArticlesPageFactory { get; set; }
    public List<HubKbArticleQuery> KbArticleQueries { get; } = [];
    public Exception? KbArticleDetailException { get; set; }
    public HubKbArticle? KbArticleDetail { get; set; }

    /// <summary>Деталь статьи по id; иначе — общий KbArticleDetail.</summary>
    public Func<string, HubKbArticle?>? KbArticleDetailFactory { get; set; }
    public List<string> KbArticleDetailCalls { get; } = [];

    public Task<IReadOnlyList<HubKbCategory>> GetKbCategoriesAsync(
        CancellationToken cancellationToken)
    {
        KbCategoriesCallCount++;
        if (KbCategoriesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubKbCategory>>(KbCategoriesException);
        }

        return Task.FromResult(KbCategories);
    }

    public Task<HubKbArticleListPage> GetKbArticlesAsync(
        HubKbArticleQuery query,
        CancellationToken cancellationToken)
    {
        KbArticleQueries.Add(query);
        if (KbArticlesException is not null)
        {
            return Task.FromException<HubKbArticleListPage>(KbArticlesException);
        }

        return Task.FromResult(KbArticlesPageFactory?.Invoke(query) ?? KbArticlesPage);
    }

    public Task<HubKbArticle> GetKbArticleAsync(
        string articleId,
        CancellationToken cancellationToken)
    {
        KbArticleDetailCalls.Add(articleId);
        if (KbArticleDetailException is not null)
        {
            return Task.FromException<HubKbArticle>(KbArticleDetailException);
        }

        var detail = KbArticleDetailFactory?.Invoke(articleId) ?? KbArticleDetail;
        return detail is not null
            ? Task.FromResult(detail)
            : Task.FromException<HubKbArticle>(new HubApiException(
                HubApiErrorKind.Http, "Article not found", System.Net.HttpStatusCode.NotFound));
    }

    public Task<HubChatConversationList> GetChatConversationsAsync(
        string? cursor,
        int limit,
        string? query,
        CancellationToken cancellationToken)
    {
        LastConversationsCursor = cursor;
        LastConversationsQuery = query;
        ConversationsCallCount++;
        if (ChatConversationsException is not null)
        {
            return Task.FromException<HubChatConversationList>(ChatConversationsException);
        }

        if (!string.IsNullOrWhiteSpace(query))
        {
            // Имитация серверного q-поиска: фильтр по title/preview, без курсора.
            var items = (ChatConversations.Items ?? [])
                .Where(c =>
                    (c.Title?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false)
                    || (c.LastMessagePreview?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false)
                    || (c.DirectPeer?.FullName?.Contains(query, StringComparison.OrdinalIgnoreCase) ?? false))
                .ToList();
            return Task.FromResult(new HubChatConversationList { Items = items });
        }

        return Task.FromResult(ChatConversationsFactory?.Invoke(cursor) ?? ChatConversations);
    }

    public Task<HubChatMessageList> GetChatMessagesAsync(
        string conversationId,
        string? beforeMessageId,
        string? afterMessageId,
        int limit,
        CancellationToken cancellationToken)
    {
        LastMessagesConversationId = conversationId;
        LastBeforeMessageId = beforeMessageId;
        LastAfterMessageId = afterMessageId;
        if (ChatMessagesException is not null)
        {
            return Task.FromException<HubChatMessageList>(ChatMessagesException);
        }

        if (ChatMessagesAsyncFactory is { } asyncFactory)
        {
            return asyncFactory(conversationId, beforeMessageId);
        }

        // Фабрика — постраничная лента по before-курсору (как у диалогов);
        // без неё — единый список, как было.
        return Task.FromResult(ChatMessagesFactory?.Invoke(beforeMessageId) ?? ChatMessages);
    }

    public Task<HubChatMessage> SendChatMessageAsync(
        string conversationId,
        string body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        if (ChatSendException is not null)
        {
            return Task.FromException<HubChatMessage>(ChatSendException);
        }

        SentMessages.Add((conversationId, body));
        SentMessageDetails.Add((conversationId, body, replyToMessageId));
        var message = SendMessageFactory?.Invoke() ?? new HubChatMessage
        {
            Id = "m-" + SentMessages.Count,
            ConversationId = conversationId,
            Body = body,
            Kind = "text",
            IsOwn = true,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        return Task.FromResult(message);
    }

    /// <summary>(conversationId, body, replyToMessageId) — проверка reply-параметра.</summary>
    public List<(string ConversationId, string Body, string? ReplyToMessageId)> SentMessageDetails { get; } = [];

    public Task<HubChatMessage> EditChatMessageAsync(
        string conversationId,
        string messageId,
        string body,
        CancellationToken cancellationToken)
    {
        if (ChatEditException is not null)
        {
            return Task.FromException<HubChatMessage>(ChatEditException);
        }

        EditedMessages.Add((conversationId, messageId, body));
        var message = EditMessageResult ?? new HubChatMessage
        {
            Id = messageId,
            ConversationId = conversationId,
            Body = body,
            Kind = "text",
            IsOwn = true,
            CreatedAt = DateTimeOffset.UtcNow,
            EditedAt = DateTimeOffset.UtcNow,
        };
        return Task.FromResult(message);
    }

    public Exception? ChatEditException { get; set; }
    public HubChatMessage? EditMessageResult { get; set; }
    public List<(string ConversationId, string MessageId, string Body)> EditedMessages { get; } = [];

    public Task<HubChatMessage> DeleteChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        if (ChatDeleteException is not null)
        {
            return Task.FromException<HubChatMessage>(ChatDeleteException);
        }

        DeletedMessages.Add((conversationId, messageId));
        var message = DeleteMessageResult ?? new HubChatMessage
        {
            Id = messageId,
            ConversationId = conversationId,
            Kind = "text",
            IsOwn = true,
            IsDeleted = true,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        return Task.FromResult(message);
    }

    public Exception? ChatDeleteException { get; set; }
    public HubChatMessage? DeleteMessageResult { get; set; }
    public List<(string ConversationId, string MessageId)> DeletedMessages { get; } = [];

    public Task<HubChatReactionToggle> ToggleChatMessageReactionAsync(
        string conversationId,
        string messageId,
        string emoji,
        CancellationToken cancellationToken)
    {
        if (ChatReactionException is not null)
        {
            return Task.FromException<HubChatReactionToggle>(ChatReactionException);
        }

        ToggledReactions.Add((conversationId, messageId, emoji));
        var result = ReactionToggleResult ?? new HubChatReactionToggle
        {
            MessageId = messageId,
            ConversationId = conversationId,
            Action = "added",
            Emoji = emoji,
            Reactions = [new HubChatReaction { Emoji = emoji, Count = 1 }],
        };
        return Task.FromResult(result);
    }

    public Exception? ChatReactionException { get; set; }
    public HubChatReactionToggle? ReactionToggleResult { get; set; }
    public List<(string ConversationId, string MessageId, string Emoji)> ToggledReactions { get; } = [];

    public Task MarkChatConversationReadAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        if (ChatMarkReadException is not null)
        {
            return Task.FromException(ChatMarkReadException);
        }

        ReadMarkedMessages.Add((conversationId, messageId));
        return Task.CompletedTask;
    }

    public Task<HubChatConversation> CreateDirectConversationAsync(
        int peerUserId,
        CancellationToken cancellationToken)
    {
        CreatedDirectConversations.Add(peerUserId);
        if (CreateDirectException is not null)
        {
            return Task.FromException<HubChatConversation>(CreateDirectException);
        }

        return Task.FromResult(DirectConversationResult ?? new HubChatConversation
        {
            Id = "direct-" + peerUserId,
            Kind = "direct",
            Title = "Диалог",
        });
    }

    // ---- Групповые диалоги ----
    public Exception? CreateGroupException { get; set; }
    public HubChatConversation? GroupConversationResult { get; set; }
    public List<(string Title, IReadOnlyList<int> MemberUserIds)> CreatedGroups { get; } = [];
    public Exception? ConversationDetailException { get; set; }
    public HubChatConversationDetail? ConversationDetailResult { get; set; }
    public List<string> ConversationDetailCalls { get; } = [];
    public Exception? AddMemberException { get; set; }
    public HubChatConversationDetail? AddMemberResult { get; set; }
    public List<(string ConversationId, int UserId)> AddedMembers { get; } = [];
    public Exception? RemoveMemberException { get; set; }
    public HubChatConversationDetail? RemoveMemberResult { get; set; }
    public List<(string ConversationId, int UserId)> RemovedMembers { get; } = [];
    public Exception? LeaveException { get; set; }
    public List<string> LeftConversations { get; } = [];

    public Task<HubChatConversation> CreateChatGroupConversationAsync(
        string title,
        IReadOnlyList<int> memberUserIds,
        CancellationToken cancellationToken)
    {
        CreatedGroups.Add((title, memberUserIds));
        if (CreateGroupException is not null)
        {
            return Task.FromException<HubChatConversation>(CreateGroupException);
        }

        return Task.FromResult(GroupConversationResult ?? new HubChatConversation
        {
            Id = "group-" + CreatedGroups.Count,
            Kind = "group",
            Title = title,
            MemberCount = memberUserIds.Count + 1,
        });
    }

    public Task<HubChatConversationDetail> GetChatConversationMembersAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ConversationDetailCalls.Add(conversationId);
        if (ConversationDetailException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(ConversationDetailException);
        }

        return Task.FromResult(ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatConversationDetail> AddChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        AddedMembers.Add((conversationId, userId));
        if (AddMemberException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(AddMemberException);
        }

        return Task.FromResult(AddMemberResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatConversationDetail> RemoveChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        RemovedMembers.Add((conversationId, userId));
        if (RemoveMemberException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(RemoveMemberException);
        }

        return Task.FromResult(RemoveMemberResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task LeaveChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        if (LeaveException is not null)
        {
            return Task.FromException(LeaveException);
        }

        LeftConversations.Add(conversationId);
        return Task.CompletedTask;
    }

    private static HubChatConversationDetail DefaultDetail(string conversationId) =>
        new()
        {
            Id = conversationId,
            Kind = "group",
            Title = "Группа",
            Members = [],
        };

    public Task<HubChatUserList> GetChatUsersAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        if (ChatUsersException is not null)
        {
            return Task.FromException<HubChatUserList>(ChatUsersException);
        }

        ChatUsersQueries.Add((query, limit));
        return Task.FromResult(ChatUsers);
    }

    public Task<HubChatConversation> UpdateChatConversationSettingsAsync(
        string conversationId,
        bool? isPinned,
        bool? isMuted,
        bool? isArchived,
        DateTimeOffset? mutedUntil,
        CancellationToken cancellationToken)
    {
        if (ChatSettingsException is not null)
        {
            return Task.FromException<HubChatConversation>(ChatSettingsException);
        }

        UpdatedConversationSettings.Add((conversationId, isPinned, isMuted, isArchived, mutedUntil));
        var result = ConversationSettingsResult ?? new HubChatConversation
        {
            Id = conversationId,
            Kind = "direct",
            Title = "Диалог " + conversationId,
            IsPinned = isPinned ?? false,
            IsMuted = isMuted ?? false,
            IsArchived = isArchived ?? false,
        };
        return Task.FromResult(result);
    }

    public Exception? ChatSettingsException { get; set; }
    public HubChatConversation? ConversationSettingsResult { get; set; }
    public List<(string ConversationId, bool? IsPinned, bool? IsMuted, bool? IsArchived, DateTimeOffset? MutedUntil)> UpdatedConversationSettings { get; } = [];

    public Task<HubChatPinnedMessageList> GetChatPinnedMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        PinnedListCalls.Add(conversationId);
        return Task.FromResult(new HubChatPinnedMessageList { Items = PinnedMessages.ToList() });
    }

    public Task<HubChatPinnedMessageList> PinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        PinnedCalls.Add((conversationId, messageId, Unpin: false));
        if (!PinnedMessages.Any(p => p.Id == messageId))
        {
            var source = ChatMessages.Items?.FirstOrDefault(m => m.Id == messageId);
            PinnedMessages.Add(new HubChatPinnedMessage
            {
                Id = messageId,
                SenderName = source?.Sender?.FullName ?? string.Empty,
                Preview = source?.Body ?? string.Empty,
            });
        }

        return Task.FromResult(new HubChatPinnedMessageList { Items = PinnedMessages.ToList() });
    }

    public Task<HubChatPinnedMessageList> UnpinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        PinnedCalls.Add((conversationId, messageId, Unpin: true));
        PinnedMessages.RemoveAll(p => p.Id == messageId);
        return Task.FromResult(new HubChatPinnedMessageList { Items = PinnedMessages.ToList() });
    }

    public List<HubChatPinnedMessage> PinnedMessages { get; } = [];
    public List<string> PinnedListCalls { get; } = [];
    public List<(string ConversationId, string MessageId, bool Unpin)> PinnedCalls { get; } = [];

    public Task<HubChatMessageSearchResult> SearchChatMessagesAsync(
        string conversationId,
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        if (ChatSearchException is not null)
        {
            return Task.FromException<HubChatMessageSearchResult>(ChatSearchException);
        }

        MessageSearchQueries.Add((conversationId, query, limit));
        return Task.FromResult(MessageSearchResult ?? new HubChatMessageSearchResult { Items = [] });
    }

    public Exception? ChatSearchException { get; set; }
    public HubChatMessageSearchResult? MessageSearchResult { get; set; }
    public List<(string ConversationId, string Query, int Limit)> MessageSearchQueries { get; } = [];

    public Task<HubChatThreadBootstrap> GetChatThreadBootstrapAsync(
        string conversationId,
        string? focusMessageId,
        int limit,
        CancellationToken cancellationToken)
    {
        if (ThreadBootstrapException is not null)
        {
            return Task.FromException<HubChatThreadBootstrap>(ThreadBootstrapException);
        }

        ThreadBootstrapCalls.Add((conversationId, focusMessageId, limit));
        return Task.FromResult(ThreadBootstrapResult ?? new HubChatThreadBootstrap { Items = [] });
    }

    public Exception? ThreadBootstrapException { get; set; }
    public HubChatThreadBootstrap? ThreadBootstrapResult { get; set; }
    public List<(string ConversationId, string? FocusMessageId, int Limit)> ThreadBootstrapCalls { get; } = [];

    public Task<HubChatUploadSession> CreateChatUploadSessionAsync(
        string conversationId,
        string? body,
        string? replyToMessageId,
        string? clientMessageId,
        IReadOnlyList<HubChatUploadFileRequest> files,
        CancellationToken cancellationToken)
    {
        if (UploadException is not null)
        {
            return Task.FromException<HubChatUploadSession>(UploadException);
        }

        UploadSessionRequests.Add((conversationId, body, replyToMessageId, clientMessageId, files));
        var session = UploadSession ?? new HubChatUploadSession
        {
            SessionId = "upload-1",
            ChunkSizeBytes = UploadChunkSize,
            Files = files.Select((f, i) => new HubChatUploadSessionFile
            {
                FileId = $"file-{i}",
                FileName = f.FileName,
                Size = f.Size,
                ChunkCount = (int)Math.Ceiling(f.Size / (double)UploadChunkSize),
            }).ToList(),
        };
        return Task.FromResult(session);
    }

    public Task<HubChatUploadChunk> UploadChatChunkAsync(
        string sessionId,
        string fileId,
        int chunkIndex,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        if (UploadChunkException is not null)
        {
            return Task.FromException<HubChatUploadChunk>(UploadChunkException);
        }

        UploadedChunks.Add((sessionId, fileId, chunkIndex, offset, data.ToArray()));
        return Task.FromResult(new HubChatUploadChunk { FileComplete = true });
    }

    public Task<HubChatMessage> CompleteChatUploadSessionAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        if (UploadCompleteException is not null)
        {
            return Task.FromException<HubChatMessage>(UploadCompleteException);
        }

        CompletedSessions.Add(sessionId);
        return Task.FromResult(UploadCompletedMessage ?? new HubChatMessage { Id = "uploaded-message" });
    }

    public async Task<string> DownloadChatAttachmentAsync(
        string messageId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        if (DownloadException is not null)
        {
            throw DownloadException;
        }

        DownloadCalls.Add((messageId, attachmentId));
        var bytes = DownloadBytes ?? [];
        await destination.WriteAsync(bytes, cancellationToken);
        return DownloadFileName ?? string.Empty;
    }

    public Exception? UploadException { get; set; }
    public Exception? UploadChunkException { get; set; }
    public Exception? UploadCompleteException { get; set; }
    public Exception? DownloadException { get; set; }
    public int UploadChunkSize { get; set; } = 4;
    public HubChatUploadSession? UploadSession { get; set; }
    public HubChatMessage? UploadCompletedMessage { get; set; }
    public byte[]? DownloadBytes { get; set; }
    public string? DownloadFileName { get; set; }
    public List<(string ConversationId, string? Body, string? ReplyId, string? ClientMessageId, IReadOnlyList<HubChatUploadFileRequest> Files)>
        UploadSessionRequests { get; } = [];
    public List<(string SessionId, string FileId, int ChunkIndex, long Offset, byte[] Data)>
        UploadedChunks { get; } = [];
    public List<string> CompletedSessions { get; } = [];
    public List<(string MessageId, string AttachmentId)> DownloadCalls { get; } = [];

    public Task<HubChatMessage> ForwardChatMessageAsync(
        string conversationId,
        string sourceMessageId,
        string? body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        if (ForwardException is not null)
        {
            return Task.FromException<HubChatMessage>(ForwardException);
        }

        ForwardCalls.Add((conversationId, sourceMessageId, body, clientMessageId, replyToMessageId));
        return Task.FromResult(ForwardResult ?? new HubChatMessage
        {
            Id = "m-forward-" + ForwardCalls.Count,
            ConversationId = conversationId,
            Kind = "text",
            Body = body ?? "forwarded",
            IsOwn = true,
            CreatedAt = DateTimeOffset.UtcNow,
        });
    }

    public Task<HubChatPollVoteResult> VoteChatPollAsync(
        string conversationId,
        string messageId,
        int optionIndex,
        CancellationToken cancellationToken)
    {
        if (PollException is not null)
        {
            return Task.FromException<HubChatPollVoteResult>(PollException);
        }

        PollVoteCalls.Add((conversationId, messageId, optionIndex));
        return Task.FromResult(PollResult ?? new HubChatPollVoteResult
        {
            MessageId = messageId,
            Action = "voted",
        });
    }

    public Task<HubChatPollVoteResult> CloseChatPollAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        if (PollException is not null)
        {
            return Task.FromException<HubChatPollVoteResult>(PollException);
        }

        PollCloseCalls.Add((conversationId, messageId));
        return Task.FromResult(PollResult ?? new HubChatPollVoteResult
        {
            MessageId = messageId,
            Action = "closed",
        });
    }

    public Task<HubChatMessageReads> GetChatMessageReadsAsync(
        string messageId,
        CancellationToken cancellationToken)
    {
        ReadsCalls.Add(messageId);
        return Task.FromResult(MessageReads ?? new HubChatMessageReads { Items = [] });
    }

    public Task<HubChatLinkPreview> GetChatLinkPreviewAsync(
        string url,
        CancellationToken cancellationToken)
    {
        LinkPreviewRequests.Add(url);
        if (LinkPreviewException is not null)
        {
            return Task.FromException<HubChatLinkPreview>(LinkPreviewException);
        }

        if (LinkPreviewFactory is { } factory)
        {
            return factory(url);
        }

        return Task.FromResult(LinkPreviewResult ?? new HubChatLinkPreview { Url = url });
    }

    public Task<HubChatConversationAttachmentPage> GetChatConversationAttachmentsAsync(
        string conversationId,
        string kind,
        int limit,
        string? beforeAttachmentId,
        CancellationToken cancellationToken)
    {
        ConversationAttachmentCalls.Add((conversationId, kind, beforeAttachmentId));
        if (ConversationAttachmentsException is not null)
        {
            return Task.FromException<HubChatConversationAttachmentPage>(ConversationAttachmentsException);
        }

        if (ConversationAttachmentsFactory is { } factory)
        {
            return Task.FromResult(factory(conversationId, kind, beforeAttachmentId));
        }

        var items = (ConversationAttachments?.Items ?? [])
            .Where(i => string.Equals(i.MediaKind ?? i.Kind, kind, StringComparison.OrdinalIgnoreCase))
            .ToList();
        return Task.FromResult(new HubChatConversationAttachmentPage { Items = items });
    }

    public Exception? LinkPreviewException { get; set; }
    public HubChatLinkPreview? LinkPreviewResult { get; set; }

    /// <summary>Если задана — отвечает на запрос превью по конкретному url (можно задержать).</summary>
    public Func<string, Task<HubChatLinkPreview>>? LinkPreviewFactory { get; set; }
    public List<string> LinkPreviewRequests { get; } = [];

    public Exception? ConversationAttachmentsException { get; set; }
    public HubChatConversationAttachmentPage? ConversationAttachments { get; set; }

    /// <summary>Если задана — отвечает на запрос галереи по (conversationId, kind, cursor).</summary>
    public Func<string, string, string?, HubChatConversationAttachmentPage>? ConversationAttachmentsFactory { get; set; }
    public List<(string ConversationId, string Kind, string? BeforeAttachmentId)> ConversationAttachmentCalls { get; } = [];

    public async Task<HubChatExportResult> ExportChatConversationAsync(
        string conversationId,
        string format,
        Stream destination,
        CancellationToken cancellationToken)
    {
        if (ExportException is not null)
        {
            throw ExportException;
        }

        ExportCalls.Add((conversationId, format));
        var bytes = ExportBytes ?? [];
        await destination.WriteAsync(bytes, cancellationToken);
        return ExportResult ?? new HubChatExportResult
        {
            FileName = "chat.txt",
            MessagesCount = bytes.Length,
        };
    }

    public Exception? ExportException { get; set; }
    public byte[]? ExportBytes { get; set; }
    public HubChatExportResult? ExportResult { get; set; }
    public List<(string ConversationId, string Format)> ExportCalls { get; } = [];

    public Task<HubChatConversationDetail> TransferChatConversationOwnershipAsync(
        string conversationId,
        int ownerUserId,
        CancellationToken cancellationToken)
    {
        TransferOwnershipCalls.Add((conversationId, ownerUserId));
        if (TransferOwnershipException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(TransferOwnershipException);
        }

        return Task.FromResult(
            TransferOwnershipResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Exception? TransferOwnershipException { get; set; }
    public HubChatConversationDetail? TransferOwnershipResult { get; set; }
    public List<(string ConversationId, int OwnerUserId)> TransferOwnershipCalls { get; } = [];

    // ---- Модерация группы: роли, ограничения, заявки, жалобы, ссылки ----

    public Exception? MemberRoleException { get; set; }
    public HubChatConversationDetail? MemberRoleResult { get; set; }
    public List<(string ConversationId, int UserId, string Role)> MemberRoleCalls { get; } = [];
    public Exception? RestrictMemberException { get; set; }
    public HubChatConversationDetail? RestrictMemberResult { get; set; }
    public List<(string ConversationId, int UserId, int? DurationSeconds)> RestrictMemberCalls { get; } = [];
    public List<(string ConversationId, int UserId)> LiftRestrictionCalls { get; } = [];
    public Exception? JoinRequestsException { get; set; }
    public HubChatJoinRequestList JoinRequestsResult { get; set; } = new() { Items = [] };
    public List<string> JoinRequestsCalls { get; } = [];
    public Exception? JoinApprovalException { get; set; }
    public List<(string ConversationId, bool ApprovalRequired)> JoinApprovalCalls { get; } = [];
    public Exception? JoinRequestDecisionException { get; set; }
    public HubChatJoinRequestResolution? JoinRequestDecisionResult { get; set; }
    public List<(string ConversationId, long RequestId, string Decision)> JoinRequestDecisionCalls { get; } = [];
    public Exception? ReportException { get; set; }
    public HubChatMessageReportResult? ReportResult { get; set; }
    public List<(string ConversationId, string MessageId, string Reason, string? Comment)> ReportCalls { get; } = [];
    public Exception? ReportsException { get; set; }
    public HubChatMessageReportList ReportsResult { get; set; } = new() { Items = [] };
    public List<string> ReportsCalls { get; } = [];
    public Exception? ReportResolveException { get; set; }
    public List<(string ConversationId, long ReportId, string Resolution)> ReportResolveCalls { get; } = [];
    public Exception? InviteLinkException { get; set; }
    public HubChatInviteLink InviteLinkResult { get; set; } = new()
    {
        Token = "invite-token",
        ConversationId = "g1",
        ExpiresAt = DateTimeOffset.UtcNow.AddDays(7),
    };
    public List<string> InviteLinkCalls { get; } = [];
    public List<string> InviteRevokeCalls { get; } = [];
    public Exception? InviteJoinException { get; set; }
    public HubChatInviteJoinResult? InviteJoinResult { get; set; }
    public List<string> InviteJoinCalls { get; } = [];
    public Exception? DeleteConversationException { get; set; }
    public List<string> DeletedConversations { get; } = [];
    public Exception? SupportException { get; set; }
    public HubChatConversation? SupportConversationResult { get; set; }
    public int SupportCalls { get; private set; }
    public Exception? GroupProfileException { get; set; }
    public HubChatConversationDetail? GroupProfileResult { get; set; }
    public List<(string ConversationId, string? Title, string? Description, string? PostingPolicy, int? SlowModeSeconds, bool? MembersSendFiles)> GroupProfileCalls { get; } = [];
    public Exception? GroupAvatarException { get; set; }
    public HubChatConversationDetail? GroupAvatarResult { get; set; }
    public List<(string ConversationId, string FileName, string? MimeType, long Size)> GroupAvatarCalls { get; } = [];
    public List<string> GroupAvatarDeleteCalls { get; } = [];
    public Exception? ShareableTasksException { get; set; }
    public HubChatShareableTaskList ShareableTasksResult { get; set; } = new() { Items = [] };
    public List<(string ConversationId, string? Query, int Limit)> ShareableTasksCalls { get; } = [];
    public Exception? TaskShareException { get; set; }
    public Func<HubChatMessage>? TaskShareFactory { get; set; }
    public List<(string ConversationId, string TaskId)> TaskShareCalls { get; } = [];
    public Exception? HydrateException { get; set; }
    public HubChatThreadHydrateResult? HydrateResult { get; set; }
    public List<(string ConversationId, IReadOnlyList<string> MessageIds)> HydrateCalls { get; } = [];

    public Task<HubChatConversationDetail> UpdateChatGroupMemberRoleAsync(
        string conversationId,
        int userId,
        string memberRole,
        CancellationToken cancellationToken)
    {
        MemberRoleCalls.Add((conversationId, userId, memberRole));
        if (MemberRoleException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(MemberRoleException);
        }

        return Task.FromResult(
            MemberRoleResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatConversationDetail> RestrictChatGroupMemberAsync(
        string conversationId,
        int userId,
        int? durationSeconds,
        CancellationToken cancellationToken)
    {
        RestrictMemberCalls.Add((conversationId, userId, durationSeconds));
        if (RestrictMemberException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(RestrictMemberException);
        }

        return Task.FromResult(
            RestrictMemberResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatConversationDetail> LiftChatGroupMemberRestrictionAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        LiftRestrictionCalls.Add((conversationId, userId));
        if (RestrictMemberException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(RestrictMemberException);
        }

        return Task.FromResult(
            RestrictMemberResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatJoinRequestList> GetChatJoinRequestsAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        JoinRequestsCalls.Add(conversationId);
        if (JoinRequestsException is not null)
        {
            return Task.FromException<HubChatJoinRequestList>(JoinRequestsException);
        }

        return Task.FromResult(JoinRequestsResult);
    }

    public Task<HubChatJoinApproval> SetChatJoinApprovalAsync(
        string conversationId,
        bool approvalRequired,
        CancellationToken cancellationToken)
    {
        JoinApprovalCalls.Add((conversationId, approvalRequired));
        if (JoinApprovalException is not null)
        {
            return Task.FromException<HubChatJoinApproval>(JoinApprovalException);
        }

        return Task.FromResult(new HubChatJoinApproval { ApprovalRequired = approvalRequired });
    }

    public Task<HubChatJoinRequestResolution> ResolveChatJoinRequestAsync(
        string conversationId,
        long requestId,
        string decision,
        CancellationToken cancellationToken)
    {
        JoinRequestDecisionCalls.Add((conversationId, requestId, decision));
        if (JoinRequestDecisionException is not null)
        {
            return Task.FromException<HubChatJoinRequestResolution>(JoinRequestDecisionException);
        }

        return Task.FromResult(JoinRequestDecisionResult ?? new HubChatJoinRequestResolution
        {
            Id = requestId,
            Status = decision == "approve" ? "approved" : "rejected",
            Added = decision == "approve",
        });
    }

    public Task<HubChatMessageReportResult> ReportChatMessageAsync(
        string conversationId,
        string messageId,
        string reason,
        string? comment,
        CancellationToken cancellationToken)
    {
        ReportCalls.Add((conversationId, messageId, reason, comment));
        if (ReportException is not null)
        {
            return Task.FromException<HubChatMessageReportResult>(ReportException);
        }

        return Task.FromResult(ReportResult ?? new HubChatMessageReportResult
        {
            Id = 101,
            Status = "open",
            AlreadyReported = false,
        });
    }

    public Task<HubChatMessageReportList> GetChatMessageReportsAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ReportsCalls.Add(conversationId);
        if (ReportsException is not null)
        {
            return Task.FromException<HubChatMessageReportList>(ReportsException);
        }

        return Task.FromResult(ReportsResult);
    }

    public Task<HubChatMessageReportResolution> ResolveChatMessageReportAsync(
        string conversationId,
        long reportId,
        string resolution,
        CancellationToken cancellationToken)
    {
        ReportResolveCalls.Add((conversationId, reportId, resolution));
        if (ReportResolveException is not null)
        {
            return Task.FromException<HubChatMessageReportResolution>(ReportResolveException);
        }

        return Task.FromResult(new HubChatMessageReportResolution
        {
            Id = reportId,
            Status = resolution,
        });
    }

    public Task<HubChatInviteLink> CreateChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        InviteLinkCalls.Add(conversationId);
        if (InviteLinkException is not null)
        {
            return Task.FromException<HubChatInviteLink>(InviteLinkException);
        }

        return Task.FromResult(InviteLinkResult);
    }

    public Task<HubChatInviteRevokeResult> RevokeChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        InviteRevokeCalls.Add(conversationId);
        if (InviteLinkException is not null)
        {
            return Task.FromException<HubChatInviteRevokeResult>(InviteLinkException);
        }

        return Task.FromResult(new HubChatInviteRevokeResult { Revoked = 1 });
    }

    public Task<HubChatInvitePreview> GetChatInviteLinkPreviewAsync(
        string token,
        CancellationToken cancellationToken)
    {
        if (InviteLinkException is not null)
        {
            return Task.FromException<HubChatInvitePreview>(InviteLinkException);
        }

        return Task.FromResult(new HubChatInvitePreview { Title = "Группа" });
    }

    public Task<HubChatInviteJoinResult> JoinChatByInviteLinkAsync(
        string token,
        CancellationToken cancellationToken)
    {
        InviteJoinCalls.Add(token);
        if (InviteJoinException is not null)
        {
            return Task.FromException<HubChatInviteJoinResult>(InviteJoinException);
        }

        return Task.FromResult(InviteJoinResult ?? new HubChatInviteJoinResult
        {
            Joined = true,
            Conversation = new HubChatConversation
            {
                Id = "joined-" + token,
                Kind = "group",
                Title = "Группа",
            },
        });
    }

    public Task DeleteChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        DeletedConversations.Add(conversationId);
        return DeleteConversationException is null
            ? Task.CompletedTask
            : Task.FromException(DeleteConversationException);
    }

    public Task<HubChatConversation> CreateChatSupportConversationAsync(
        CancellationToken cancellationToken)
    {
        SupportCalls++;
        if (SupportException is not null)
        {
            return Task.FromException<HubChatConversation>(SupportException);
        }

        return Task.FromResult(SupportConversationResult ?? new HubChatConversation
        {
            Id = "support-1",
            Kind = "support",
            Title = "Поддержка HUB",
            IsSupport = true,
        });
    }

    public Task<HubChatConversationDetail> UpdateChatGroupProfileAsync(
        string conversationId,
        string? title,
        string? description,
        string? postingPolicy,
        int? slowModeSeconds,
        bool? membersSendFiles,
        CancellationToken cancellationToken)
    {
        GroupProfileCalls.Add(
            (conversationId, title, description, postingPolicy, slowModeSeconds, membersSendFiles));
        if (GroupProfileException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(GroupProfileException);
        }

        return Task.FromResult(
            GroupProfileResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public async Task<HubChatConversationDetail> UploadChatGroupAvatarAsync(
        string conversationId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken)
    {
        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        GroupAvatarCalls.Add((conversationId, fileName, mimeType, buffer.Length));
        if (GroupAvatarException is not null)
        {
            throw GroupAvatarException;
        }

        return GroupAvatarResult ?? ConversationDetailResult ?? DefaultDetail(conversationId);
    }

    public Task<HubChatConversationDetail> DeleteChatGroupAvatarAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        GroupAvatarDeleteCalls.Add(conversationId);
        if (GroupAvatarException is not null)
        {
            return Task.FromException<HubChatConversationDetail>(GroupAvatarException);
        }

        return Task.FromResult(
            GroupAvatarResult ?? ConversationDetailResult ?? DefaultDetail(conversationId));
    }

    public Task<HubChatShareableTaskList> GetChatShareableTasksAsync(
        string conversationId,
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        ShareableTasksCalls.Add((conversationId, query, limit));
        if (ShareableTasksException is not null)
        {
            return Task.FromException<HubChatShareableTaskList>(ShareableTasksException);
        }

        return Task.FromResult(ShareableTasksResult);
    }

    public Task<HubChatMessage> SendChatTaskShareAsync(
        string conversationId,
        string taskId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        TaskShareCalls.Add((conversationId, taskId));
        if (TaskShareException is not null)
        {
            return Task.FromException<HubChatMessage>(TaskShareException);
        }

        return Task.FromResult(TaskShareFactory?.Invoke() ?? new HubChatMessage
        {
            Id = "task-share-" + TaskShareCalls.Count,
            ConversationId = conversationId,
            Kind = "task_share",
            CreatedAt = DateTimeOffset.UtcNow,
            IsOwn = true,
            ClientMessageId = clientMessageId,
            TaskPreview = new HubChatTaskPreview { Id = taskId, Title = "Задача " + taskId },
        });
    }

    public Task<HubChatThreadHydrateResult> HydrateChatMessagesAsync(
        string conversationId,
        IReadOnlyList<string> messageIds,
        CancellationToken cancellationToken)
    {
        HydrateCalls.Add((conversationId, messageIds));
        if (HydrateException is not null)
        {
            return Task.FromException<HubChatThreadHydrateResult>(HydrateException);
        }

        return Task.FromResult(HydrateResult ?? new HubChatThreadHydrateResult { Items = [] });
    }

    public Task<HubChatGlobalSearchResult> SearchChatGlobalMessagesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        if (GlobalSearchException is not null)
        {
            return Task.FromException<HubChatGlobalSearchResult>(GlobalSearchException);
        }

        GlobalSearchQueries.Add((query, limit));
        return Task.FromResult(GlobalSearchResult ?? new HubChatGlobalSearchResult { Items = [] });
    }

    public Task<HubChatConversation> CreateNotesConversationAsync(
        CancellationToken cancellationToken)
    {
        NotesCalls++;
        return Task.FromResult(NotesConversation ?? new HubChatConversation
        {
            Id = "notes-1",
            Kind = "notes",
            Title = "Заметки",
        });
    }

    public Exception? ForwardException { get; set; }
    public Exception? PollException { get; set; }
    public Exception? GlobalSearchException { get; set; }
    public HubChatMessage? ForwardResult { get; set; }
    public HubChatPollVoteResult? PollResult { get; set; }
    public HubChatMessageReads? MessageReads { get; set; }
    public HubChatGlobalSearchResult? GlobalSearchResult { get; set; }
    public HubChatConversation? NotesConversation { get; set; }
    public List<(string ConversationId, string SourceMessageId, string? Body, string? ClientMessageId, string? ReplyToMessageId)> ForwardCalls { get; } = [];
    public List<(string ConversationId, string MessageId, int OptionIndex)> PollVoteCalls { get; } = [];
    public List<(string ConversationId, string MessageId)> PollCloseCalls { get; } = [];
    public List<string> ReadsCalls { get; } = [];
    public List<(string Query, int Limit)> GlobalSearchQueries { get; } = [];
    public int NotesCalls { get; private set; }

    // Чат: «Отправить позже» (config + CRUD запланированных)
    public Exception? ChatConfigException { get; set; }
    public HubChatConfig ChatConfig { get; set; } = new();
    public int ChatConfigCallCount { get; private set; }
    public Exception? ScheduledListException { get; set; }
    public Exception? ScheduledCreateException { get; set; }
    public Exception? ScheduledUpdateException { get; set; }
    public Exception? ScheduledCancelException { get; set; }

    /// <summary>Хранилище отложенных по conversation_id — GET …/scheduled отдаёт отсюда.</summary>
    public Dictionary<string, List<HubChatScheduledMessage>> ScheduledItems { get; } = new();

    /// <summary>Если задана — ответ create по (conversationId, body, when, replyId).</summary>
    public Func<string, string, DateTimeOffset, string?, HubChatScheduledMessage>? ScheduledCreateFactory { get; set; }

    /// <summary>Если задан — ответ update по (id, body, when).</summary>
    public Func<string, string?, DateTimeOffset?, HubChatScheduledMessage>? ScheduledUpdateFactory { get; set; }
    public int ScheduledListCallCount { get; private set; }
    public string? LastScheduledListConversationId { get; private set; }
    public List<(string ConversationId, string Body, DateTimeOffset ScheduledFor, string? ReplyToMessageId)> ScheduledCreateCalls { get; } = [];
    public List<(string Id, string? Body, DateTimeOffset? ScheduledFor)> ScheduledUpdateCalls { get; } = [];
    public List<string> ScheduledCancelCalls { get; } = [];

    public Task<HubChatConfig> GetChatConfigAsync(CancellationToken cancellationToken)
    {
        ChatConfigCallCount++;
        if (ChatConfigException is not null)
        {
            return Task.FromException<HubChatConfig>(ChatConfigException);
        }

        return Task.FromResult(ChatConfig);
    }

    public Task<HubChatScheduledMessageList> GetChatScheduledMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ScheduledListCallCount++;
        LastScheduledListConversationId = conversationId;
        if (ScheduledListException is not null)
        {
            return Task.FromException<HubChatScheduledMessageList>(ScheduledListException);
        }

        var items = ScheduledItems.TryGetValue(conversationId, out var list) ? list : [];
        return Task.FromResult(new HubChatScheduledMessageList { Items = items });
    }

    public Task<HubChatScheduledMessage> CreateChatScheduledMessageAsync(
        string conversationId,
        string body,
        DateTimeOffset scheduledFor,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ScheduledCreateCalls.Add((conversationId, body, scheduledFor, replyToMessageId));
        if (ScheduledCreateException is not null)
        {
            return Task.FromException<HubChatScheduledMessage>(ScheduledCreateException);
        }

        var created = ScheduledCreateFactory?.Invoke(conversationId, body, scheduledFor, replyToMessageId)
            ?? new HubChatScheduledMessage
            {
                Id = $"sched-{ScheduledCreateCalls.Count}",
                ConversationId = conversationId,
                Body = body,
                BodyFormat = "plain",
                ReplyToMessageId = replyToMessageId,
                ScheduledFor = scheduledFor,
                Status = "scheduled",
            };
        if (ScheduledItems.TryGetValue(conversationId, out var existing))
        {
            existing.Add(created);
        }
        else
        {
            ScheduledItems[conversationId] = [created];
        }

        return Task.FromResult(created);
    }

    public Task<HubChatScheduledMessage> UpdateChatScheduledMessageAsync(
        string scheduledId,
        string? body,
        DateTimeOffset? scheduledFor,
        CancellationToken cancellationToken)
    {
        ScheduledUpdateCalls.Add((scheduledId, body, scheduledFor));
        if (ScheduledUpdateException is not null)
        {
            return Task.FromException<HubChatScheduledMessage>(ScheduledUpdateException);
        }

        var stored = ScheduledItems.Values.SelectMany(items => items)
            .FirstOrDefault(item => item.Id == scheduledId);
        var updated = ScheduledUpdateFactory?.Invoke(scheduledId, body, scheduledFor)
            ?? new HubChatScheduledMessage
            {
                Id = scheduledId,
                ConversationId = stored?.ConversationId ?? "conv-1",
                Body = body ?? stored?.Body ?? string.Empty,
                BodyFormat = stored?.BodyFormat ?? "plain",
                ScheduledFor = scheduledFor ?? stored?.ScheduledFor,
                Status = stored?.Status ?? "scheduled",
            };
        return Task.FromResult(updated);
    }

    public Task<HubChatScheduledCancelResult> CancelChatScheduledMessageAsync(
        string scheduledId,
        CancellationToken cancellationToken)
    {
        ScheduledCancelCalls.Add(scheduledId);
        if (ScheduledCancelException is not null)
        {
            return Task.FromException<HubChatScheduledCancelResult>(ScheduledCancelException);
        }

        foreach (var items in ScheduledItems.Values)
        {
            items.RemoveAll(item => item.Id == scheduledId);
        }

        return Task.FromResult(new HubChatScheduledCancelResult
        {
            Id = scheduledId,
            Status = "cancelled",
        });
    }

    // ---- Папки диалогов (/chat/folders*) ----

    public Exception? ChatFoldersException { get; set; }
    public Exception? ChatFolderMutationException { get; set; }
    public HubChatFolderList ChatFolders { get; set; } = new() { Items = [] };
    public int ChatFoldersCallCount { get; private set; }
    public List<string> ChatFolderCreateNames { get; } = [];
    public List<(string FolderId, string? Name, int? SortOrder)> ChatFolderUpdateCalls { get; } = [];
    public List<string> ChatFolderDeleteCalls { get; } = [];
    public List<(string FolderId, string ConversationId)> ChatFolderAddCalls { get; } = [];
    public List<(string FolderId, string ConversationId)> ChatFolderRemoveCalls { get; } = [];
    public List<(string FolderId, IReadOnlyList<string> ConversationIds)> ChatFolderReplaceCalls { get; } = [];

    /// <summary>Созданные фейком папки — отражаются в ChatFolders для последующих GET.</summary>
    public List<HubChatFolder> ChatFolderItems { get; } = [];

    public Task<HubChatFolderList> GetChatFoldersAsync(CancellationToken cancellationToken)
    {
        ChatFoldersCallCount++;
        if (ChatFoldersException is not null)
        {
            return Task.FromException<HubChatFolderList>(ChatFoldersException);
        }

        var result = ChatFolders;
        if (ChatFolderItems.Count > 0)
        {
            result = new HubChatFolderList
            {
                Items = result.Items is { } existing
                    ? [.. existing, .. ChatFolderItems]
                    : ChatFolderItems.ToList(),
                ConversationIdsByFolder = result.ConversationIdsByFolder,
                FolderUnreadCounts = result.FolderUnreadCounts,
            };
        }

        return Task.FromResult(result);
    }

    public Task<HubChatFolderMutation> CreateChatFolderAsync(
        string name,
        CancellationToken cancellationToken)
    {
        ChatFolderCreateNames.Add(name);
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderMutation>(ChatFolderMutationException);
        }

        var item = new HubChatFolder
        {
            Id = $"f{ChatFolderItems.Count + 1}",
            Name = name,
            ConversationIds = [],
        };
        ChatFolderItems.Add(item);
        return Task.FromResult(new HubChatFolderMutation { Ok = true, Item = item });
    }

    public Task<HubChatFolder> GetChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        var item = ChatFolderItems.FirstOrDefault(f => f.Id == folderId)
            ?? ChatFolders.Items?.FirstOrDefault(f => f.Id == folderId)
            ?? new HubChatFolder { Id = folderId };
        return Task.FromResult(item);
    }

    public Task<HubChatFolderMutation> UpdateChatFolderAsync(
        string folderId,
        string? name,
        int? sortOrder,
        CancellationToken cancellationToken)
    {
        ChatFolderUpdateCalls.Add((folderId, name, sortOrder));
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderMutation>(ChatFolderMutationException);
        }

        var item = new HubChatFolder
        {
            Id = folderId,
            Name = name,
            SortOrder = sortOrder ?? 0,
        };
        var index = ChatFolderItems.FindIndex(f => f.Id == folderId);
        if (index >= 0)
        {
            ChatFolderItems[index] = ChatFolderItems[index] with
            {
                Name = name ?? ChatFolderItems[index].Name,
                SortOrder = sortOrder ?? ChatFolderItems[index].SortOrder,
            };
            item = ChatFolderItems[index];
        }

        return Task.FromResult(new HubChatFolderMutation { Ok = true, Item = item });
    }

    public Task<HubChatFolderDeleteResult> DeleteChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        ChatFolderDeleteCalls.Add(folderId);
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderDeleteResult>(ChatFolderMutationException);
        }

        ChatFolderItems.RemoveAll(f => f.Id == folderId);
        return Task.FromResult(new HubChatFolderDeleteResult { Ok = true, Id = folderId });
    }

    public Task<HubChatFolderMutation> ReplaceChatFolderConversationsAsync(
        string folderId,
        IReadOnlyList<string> conversationIds,
        CancellationToken cancellationToken)
    {
        ChatFolderReplaceCalls.Add((folderId, conversationIds));
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderMutation>(ChatFolderMutationException);
        }

        var item = UpsertFakeFolder(folderId, conversationIds);
        return Task.FromResult(new HubChatFolderMutation { Ok = true, Item = item });
    }

    public Task<HubChatFolderMutation> AddChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatFolderAddCalls.Add((folderId, conversationId));
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderMutation>(ChatFolderMutationException);
        }

        var current = FakeFolderIds(folderId);
        if (!current.Contains(conversationId))
        {
            current.Add(conversationId);
        }

        var item = UpsertFakeFolder(folderId, current);
        return Task.FromResult(new HubChatFolderMutation { Ok = true, Item = item });
    }

    public Task<HubChatFolderMutation> RemoveChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatFolderRemoveCalls.Add((folderId, conversationId));
        if (ChatFolderMutationException is not null)
        {
            return Task.FromException<HubChatFolderMutation>(ChatFolderMutationException);
        }

        var current = FakeFolderIds(folderId);
        current.Remove(conversationId);
        var item = UpsertFakeFolder(folderId, current);
        return Task.FromResult(new HubChatFolderMutation { Ok = true, Item = item });
    }

    private List<string> FakeFolderIds(string folderId) =>
        (ChatFolderItems.FirstOrDefault(f => f.Id == folderId)?.ConversationIds
            ?? ChatFolders.Items?.FirstOrDefault(f => f.Id == folderId)?.ConversationIds
            ?? []).ToList();

    private HubChatFolder UpsertFakeFolder(string folderId, IReadOnlyList<string> conversationIds)
    {
        var index = ChatFolderItems.FindIndex(f => f.Id == folderId);
        var item = index >= 0
            ? ChatFolderItems[index] with { ConversationIds = conversationIds, ConversationCount = conversationIds.Count }
            : new HubChatFolder
            {
                Id = folderId,
                ConversationIds = conversationIds,
                ConversationCount = conversationIds.Count,
            };
        if (index >= 0)
        {
            ChatFolderItems[index] = item;
        }
        else
        {
            ChatFolderItems.Add(item);
        }

        return item;
    }

    // ---- Стикеры (/chat/sticker-packs*, /chat/stickers/*) ----

    public Exception? ChatStickerPacksException { get; set; }
    public Exception? ChatStickerImportException { get; set; }
    public Exception? ChatStickerSendException { get; set; }
    public HubChatStickerPackList ChatStickerPacks { get; set; } = new() { Items = [] };
    public Func<string, HubChatStickerPackList>? ChatStickerImportFactory { get; set; }
    public Func<string, string?, string?, HubChatMessage>? ChatStickerSendFactory { get; set; }
    public int ChatStickerPacksCallCount { get; private set; }
    public List<string> ChatStickerImportSources { get; } = [];
    public List<(string ConversationId, string StickerId, string? ClientMessageId, string? ReplyToMessageId)> ChatStickerSendCalls { get; } = [];

    public Task<HubChatStickerPackList> GetChatStickerPacksAsync(CancellationToken cancellationToken)
    {
        ChatStickerPacksCallCount++;
        if (ChatStickerPacksException is not null)
        {
            return Task.FromException<HubChatStickerPackList>(ChatStickerPacksException);
        }

        return Task.FromResult(ChatStickerPacks);
    }

    public Task<HubChatStickerPackList> ImportChatStickerPackAsync(
        string source,
        CancellationToken cancellationToken)
    {
        ChatStickerImportSources.Add(source);
        if (ChatStickerImportException is not null)
        {
            return Task.FromException<HubChatStickerPackList>(ChatStickerImportException);
        }

        var result = ChatStickerImportFactory?.Invoke(source) ?? ChatStickerPacks;
        ChatStickerPacks = result;
        return Task.FromResult(result);
    }

    public Task<HubChatStickerPack> GetChatStickerPackPreviewAsync(
        string shortName,
        CancellationToken cancellationToken)
    {
        var item = ChatStickerPacks.Items?.FirstOrDefault(
            p => string.Equals(p.ShortName, shortName, StringComparison.Ordinal))
            ?? new HubChatStickerPack { Id = "preview-" + shortName, ShortName = shortName };
        return Task.FromResult(item);
    }

    public Task<HubChatMessage> SendChatStickerMessageAsync(
        string conversationId,
        string stickerId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ChatStickerSendCalls.Add((conversationId, stickerId, clientMessageId, replyToMessageId));
        if (ChatStickerSendException is not null)
        {
            return Task.FromException<HubChatMessage>(ChatStickerSendException);
        }

        var message = ChatStickerSendFactory?.Invoke(conversationId, clientMessageId, replyToMessageId)
            ?? new HubChatMessage
            {
                Id = "sticker-msg-" + ChatStickerSendCalls.Count,
                ConversationId = conversationId,
                ClientMessageId = clientMessageId,
                CreatedAt = DateTimeOffset.UtcNow,
                IsOwn = true,
                Attachments =
                [
                    new HubChatAttachment
                    {
                        Id = "sticker-att-" + stickerId,
                        Kind = "file",
                        MediaKind = "sticker",
                        FileName = stickerId + ".webp",
                        MimeType = "image/webp",
                    },
                ],
            };
        return Task.FromResult(message);
    }

    // ---- ИИ-ассистент (/chat/ai/*) ----

    public Exception? ChatAiBotsException { get; set; }
    public Exception? ChatAiActionException { get; set; }
    public Exception? ChatAiMemoryException { get; set; }
    public HubChatAiBotList ChatAiBots { get; set; } = new() { Items = [] };
    public int ChatAiBotsCallCount { get; private set; }
    public HubChatConversation? ChatAiOpenResult { get; set; }
    public Func<string, HubChatConversation>? ChatAiOpenFactory { get; set; }
    public Func<string, HubChatConversation>? ChatAiCreateBotFactory { get; set; }
    public Func<HubChatConversation>? ChatAiCreateGeneralFactory { get; set; }
    public HubChatAiStatus? ChatAiStatus { get; set; }
    public Func<string, HubChatAiStatus>? ChatAiStatusFactory { get; set; }
    public List<string> ChatAiOpenCalls { get; } = [];
    public List<string> ChatAiCreateBotCalls { get; } = [];
    public int ChatAiCreateGeneralCalls { get; private set; }
    public List<(string ConversationId, string Title)> ChatAiRenameCalls { get; } = [];
    public List<string> ChatAiDeleteCalls { get; } = [];
    public List<string> ChatAiStatusCalls { get; } = [];
    public List<string> ChatAiStopCalls { get; } = [];
    public List<string> ChatAiRetryCalls { get; } = [];
    public List<string> ChatAiResetCalls { get; } = [];
    public List<(string ActionId, string? Choice, string? Format, string? Scope)> ChatAiConfirmCalls { get; } = [];
    public List<string> ChatAiCancelCalls { get; } = [];
    public HubChatActionCard? ChatAiConfirmResult { get; set; }
    public HubChatActionCard? ChatAiCancelResult { get; set; }
    public HubChatAiMemoryList ChatAiMemory { get; set; } = new() { Enabled = true, Items = [] };
    public int ChatAiMemoryCallCount { get; private set; }
    public List<bool> ChatAiMemorySettingsCalls { get; } = [];
    public List<(string MemoryId, string Content)> ChatAiMemoryUpdateCalls { get; } = [];
    public List<string> ChatAiMemoryDeleteCalls { get; } = [];
    public int ChatAiMemoryClearCalls { get; private set; }

    public Task<HubChatAiBotList> GetChatAiBotsAsync(CancellationToken cancellationToken)
    {
        ChatAiBotsCallCount++;
        if (ChatAiBotsException is not null)
        {
            return Task.FromException<HubChatAiBotList>(ChatAiBotsException);
        }

        return Task.FromResult(ChatAiBots);
    }

    public Task<HubChatConversation> OpenChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken)
    {
        ChatAiOpenCalls.Add(botId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatConversation>(ChatAiActionException);
        }

        var conversation = ChatAiOpenFactory?.Invoke(botId)
            ?? ChatAiOpenResult
            ?? new HubChatConversation { Id = "ai-" + botId, Kind = "ai", Title = "HUB Ассистент" };
        return Task.FromResult(conversation);
    }

    public Task<HubChatConversation> CreateChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken)
    {
        ChatAiCreateBotCalls.Add(botId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatConversation>(ChatAiActionException);
        }

        var conversation = ChatAiCreateBotFactory?.Invoke(botId)
            ?? new HubChatConversation
            {
                Id = "ai-" + botId + "-" + ChatAiCreateBotCalls.Count,
                Kind = "ai",
                Title = "HUB Ассистент",
            };
        return Task.FromResult(conversation);
    }

    public Task<HubChatConversation> CreateChatAiConversationAsync(
        CancellationToken cancellationToken)
    {
        ChatAiCreateGeneralCalls++;
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatConversation>(ChatAiActionException);
        }

        var conversation = ChatAiCreateGeneralFactory?.Invoke()
            ?? new HubChatConversation
            {
                Id = "ai-general-" + ChatAiCreateGeneralCalls,
                Kind = "ai",
                Title = "HUB Ассистент",
            };
        return Task.FromResult(conversation);
    }

    public Task<HubChatConversation> UpdateChatAiConversationAsync(
        string conversationId,
        string title,
        CancellationToken cancellationToken)
    {
        ChatAiRenameCalls.Add((conversationId, title));
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatConversation>(ChatAiActionException);
        }

        return Task.FromResult(new HubChatConversation { Id = conversationId, Kind = "ai", Title = title });
    }

    public Task<bool> DeleteChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatAiDeleteCalls.Add(conversationId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<bool>(ChatAiActionException);
        }

        return Task.FromResult(true);
    }

    public Task<HubChatAiStatus> GetChatAiStatusAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatAiStatusCalls.Add(conversationId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatAiStatus>(ChatAiActionException);
        }

        var status = ChatAiStatusFactory?.Invoke(conversationId)
            ?? ChatAiStatus
            ?? new HubChatAiStatus { ConversationId = conversationId };
        return Task.FromResult(status);
    }

    public Task<HubChatAiStatus> StopChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatAiStopCalls.Add(conversationId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatAiStatus>(ChatAiActionException);
        }

        var status = ChatAiStatusFactory?.Invoke(conversationId)
            ?? ChatAiStatus
            ?? new HubChatAiStatus { ConversationId = conversationId, Status = "cancelled" };
        return Task.FromResult(status with { Status = status.Status ?? "cancelled" });
    }

    public Task<HubChatAiStatus> RetryChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatAiRetryCalls.Add(conversationId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatAiStatus>(ChatAiActionException);
        }

        var status = ChatAiStatusFactory?.Invoke(conversationId)
            ?? ChatAiStatus
            ?? new HubChatAiStatus { ConversationId = conversationId, Status = "queued" };
        return Task.FromResult(status with { Status = status.Status ?? "queued" });
    }

    public Task<HubChatAiResetResult> ResetChatAiContextAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ChatAiResetCalls.Add(conversationId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatAiResetResult>(ChatAiActionException);
        }

        return Task.FromResult(new HubChatAiResetResult
        {
            Ok = true,
            ConversationId = conversationId,
        });
    }

    public Task<HubChatActionCard> ConfirmChatAiActionAsync(
        string actionId,
        string? choice,
        string? format,
        string? scope,
        CancellationToken cancellationToken)
    {
        ChatAiConfirmCalls.Add((actionId, choice, format, scope));
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatActionCard>(ChatAiActionException);
        }

        var card = ChatAiConfirmResult
            ?? new HubChatActionCard { Id = actionId, Status = "confirmed" };
        return Task.FromResult(card);
    }

    public Task<HubChatActionCard> CancelChatAiActionAsync(
        string actionId,
        CancellationToken cancellationToken)
    {
        ChatAiCancelCalls.Add(actionId);
        if (ChatAiActionException is not null)
        {
            return Task.FromException<HubChatActionCard>(ChatAiActionException);
        }

        var card = ChatAiCancelResult
            ?? new HubChatActionCard { Id = actionId, Status = "cancelled" };
        return Task.FromResult(card);
    }

    public Task<HubChatAiMemoryList> GetChatAiMemoryAsync(CancellationToken cancellationToken)
    {
        ChatAiMemoryCallCount++;
        if (ChatAiMemoryException is not null)
        {
            return Task.FromException<HubChatAiMemoryList>(ChatAiMemoryException);
        }

        return Task.FromResult(ChatAiMemory);
    }

    public Task<HubChatAiMemoryList> UpdateChatAiMemorySettingsAsync(
        bool enabled,
        CancellationToken cancellationToken)
    {
        ChatAiMemorySettingsCalls.Add(enabled);
        if (ChatAiMemoryException is not null)
        {
            return Task.FromException<HubChatAiMemoryList>(ChatAiMemoryException);
        }

        ChatAiMemory = ChatAiMemory with { Enabled = enabled };
        return Task.FromResult(ChatAiMemory);
    }

    public Task<HubChatAiMemoryItem> UpdateChatAiMemoryItemAsync(
        string memoryId,
        string content,
        CancellationToken cancellationToken)
    {
        ChatAiMemoryUpdateCalls.Add((memoryId, content));
        if (ChatAiMemoryException is not null)
        {
            return Task.FromException<HubChatAiMemoryItem>(ChatAiMemoryException);
        }

        var item = new HubChatAiMemoryItem { Id = memoryId, Content = content };
        var items = ChatAiMemory.Items?.ToList() ?? [];
        var index = items.FindIndex(i => i.Id == memoryId);
        if (index >= 0)
        {
            items[index] = item;
        }
        else
        {
            items.Add(item);
        }

        ChatAiMemory = ChatAiMemory with { Items = items };
        return Task.FromResult(item);
    }

    public Task<HubChatAiMemoryDeleteResult> DeleteChatAiMemoryItemAsync(
        string memoryId,
        CancellationToken cancellationToken)
    {
        ChatAiMemoryDeleteCalls.Add(memoryId);
        if (ChatAiMemoryException is not null)
        {
            return Task.FromException<HubChatAiMemoryDeleteResult>(ChatAiMemoryException);
        }

        ChatAiMemory = ChatAiMemory with
        {
            Items = (ChatAiMemory.Items ?? []).Where(i => i.Id != memoryId).ToList(),
        };
        return Task.FromResult(new HubChatAiMemoryDeleteResult { Ok = true, Id = memoryId });
    }

    public Task<HubChatAiMemoryDeleteResult> ClearChatAiMemoryAsync(
        CancellationToken cancellationToken)
    {
        ChatAiMemoryClearCalls++;
        if (ChatAiMemoryException is not null)
        {
            return Task.FromException<HubChatAiMemoryDeleteResult>(ChatAiMemoryException);
        }

        var count = ChatAiMemory.Items?.Count ?? 0;
        ChatAiMemory = ChatAiMemory with { Items = [] };
        return Task.FromResult(new HubChatAiMemoryDeleteResult { Ok = true, DeletedCount = count });
    }

    // ---- Мои файлы ----

    public Task<HubMyFileLibraryList> GetMyFileLibrariesAsync(
        CancellationToken cancellationToken)
    {
        if (MyFilesLibrariesException is not null)
        {
            return Task.FromException<HubMyFileLibraryList>(MyFilesLibrariesException);
        }

        return Task.FromResult(MyFileLibraries ?? new HubMyFileLibraryList { Items = [] });
    }

    public Task<HubMyFileListPage> GetMyFilesAsync(
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        MyFilesListCalls.Add((folderId, libraryId));
        if (MyFilesListException is not null)
        {
            return Task.FromException<HubMyFileListPage>(MyFilesListException);
        }

        if (MyFilesPageFactory is { } factory)
        {
            return Task.FromResult(factory(folderId, libraryId));
        }

        return Task.FromResult(MyFilesPage ?? new HubMyFileListPage { Items = [], Folders = [] });
    }

    public Task<HubMyFileFolder> CreateMyFileFolderAsync(
        string name,
        string? parentId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        if (MyFilesCreateFolderException is not null)
        {
            return Task.FromException<HubMyFileFolder>(MyFilesCreateFolderException);
        }

        MyFilesCreatedFolders.Add((name, parentId, libraryId));
        return Task.FromResult(MyFilesCreatedFolderResult ?? new HubMyFileFolder
        {
            Id = "folder-" + MyFilesCreatedFolders.Count,
            Name = name,
            ParentId = parentId,
            LibraryId = libraryId,
        });
    }

    public Task<HubMyFileFolder> RenameMyFileFolderAsync(
        string folderId,
        string name,
        CancellationToken cancellationToken)
    {
        if (MyFilesRenameException is not null)
        {
            return Task.FromException<HubMyFileFolder>(MyFilesRenameException);
        }

        MyFilesRenamed.Add(("folder", folderId, name));
        return Task.FromResult(new HubMyFileFolder { Id = folderId, Name = name });
    }

    public Task<HubMyFileItem> RenameMyFileAsync(
        string fileId,
        string name,
        CancellationToken cancellationToken)
    {
        if (MyFilesRenameException is not null)
        {
            return Task.FromException<HubMyFileItem>(MyFilesRenameException);
        }

        MyFilesRenamed.Add(("file", fileId, name));
        return Task.FromResult(new HubMyFileItem
        {
            Id = fileId,
            OriginalFileName = name,
            Status = "ready",
        });
    }

    public Task DeleteMyFileFolderAsync(string folderId, CancellationToken cancellationToken)
    {
        if (MyFilesDeleteException is not null)
        {
            return Task.FromException(MyFilesDeleteException);
        }

        MyFilesDeleted.Add(("folder", folderId));
        return Task.CompletedTask;
    }

    public Task DeleteMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        if (MyFilesDeleteException is not null)
        {
            return Task.FromException(MyFilesDeleteException);
        }

        MyFilesDeleted.Add(("file", fileId));
        return Task.CompletedTask;
    }

    public async Task<string> DownloadMyFileAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        if (MyFilesDownloadException is not null)
        {
            throw MyFilesDownloadException;
        }

        MyFilesDownloadCalls.Add(fileId);
        var bytes = MyFilesDownloadBytes ?? [];
        await destination.WriteAsync(bytes, cancellationToken);
        return MyFilesDownloadName ?? string.Empty;
    }

    public Task<HubMyFileUploadSession> CreateMyFileUploadSessionAsync(
        HubMyFileUploadSessionCreate request,
        CancellationToken cancellationToken)
    {
        if (MyFilesUploadException is not null)
        {
            return Task.FromException<HubMyFileUploadSession>(MyFilesUploadException);
        }

        MyFilesUploadSessionRequests.Add(request);
        var session = MyFilesUploadSession ?? new HubMyFileUploadSession
        {
            FileId = "my-upload-" + MyFilesUploadSessionRequests.Count,
            ChunkSizeBytes = MyFilesUploadChunkSize,
            FileSizeBytes = request.FileSize,
            Ranges = [],
        };
        return Task.FromResult(session);
    }

    public Task<HubMyFileUploadSession> UploadMyFileChunkAsync(
        string fileId,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        MyFilesUploadChunkCalls++;
        if (MyFilesUploadChunkException is not null)
        {
            return Task.FromException<HubMyFileUploadSession>(MyFilesUploadChunkException);
        }

        MyFilesUploadedChunks.Add((fileId, offset, data.ToArray()));
        return Task.FromResult(new HubMyFileUploadSession
        {
            FileId = fileId,
            ChunkSizeBytes = MyFilesUploadChunkSize,
            UploadedBytes = offset + data.Length,
            Ranges = [[offset, offset + data.Length]],
        });
    }

    public Task<HubMyFileItem> CompleteMyFileUploadSessionAsync(
        string fileId,
        CancellationToken cancellationToken)
    {
        if (MyFilesUploadCompleteException is not null)
        {
            return Task.FromException<HubMyFileItem>(MyFilesUploadCompleteException);
        }

        MyFilesCompletedSessions.Add(fileId);
        var request = MyFilesUploadSessionRequests.LastOrDefault();
        return Task.FromResult(MyFilesUploadCompletedFile ?? new HubMyFileItem
        {
            Id = fileId,
            OriginalFileName = request?.FileName ?? "uploaded.bin",
            FolderId = request?.FolderId,
            LibraryId = request?.LibraryId,
            OriginalSizeBytes = request?.FileSize ?? 0,
            Status = "ready",
        });
    }

    public Task CancelMyFileUploadSessionAsync(
        string fileId,
        string? reason,
        CancellationToken cancellationToken)
    {
        MyFilesCancelledSessions.Add(fileId);
        return Task.CompletedTask;
    }

    public Task<HubMyFileShare> CreateMyFileShareAsync(
        string fileId,
        bool rotate,
        CancellationToken cancellationToken)
    {
        if (MyFilesShareException is not null)
        {
            return Task.FromException<HubMyFileShare>(MyFilesShareException);
        }

        MyFilesShareCreated.Add(("file", fileId, rotate));
        return Task.FromResult(MyFilesShareResult ?? new HubMyFileShare
        {
            Token = "file-share-" + MyFilesShareCreated.Count,
            PublicPath = "/shared-files/file-share-" + MyFilesShareCreated.Count,
        });
    }

    public Task RevokeMyFileShareAsync(string fileId, CancellationToken cancellationToken)
    {
        if (MyFilesShareRevokeException is not null)
        {
            return Task.FromException(MyFilesShareRevokeException);
        }

        MyFilesShareRevoked.Add(("file", fileId));
        return Task.CompletedTask;
    }

    public Task<HubMyFileShare> CreateMyFileFolderShareAsync(
        string folderId,
        bool rotate,
        CancellationToken cancellationToken)
    {
        if (MyFilesShareException is not null)
        {
            return Task.FromException<HubMyFileShare>(MyFilesShareException);
        }

        MyFilesShareCreated.Add(("folder", folderId, rotate));
        return Task.FromResult(MyFilesShareResult ?? new HubMyFileShare
        {
            Token = "folder-share-" + MyFilesShareCreated.Count,
            PublicPath = "/shared-folders/folder-share-" + MyFilesShareCreated.Count,
        });
    }

    public Task RevokeMyFileFolderShareAsync(string folderId, CancellationToken cancellationToken)
    {
        if (MyFilesShareRevokeException is not null)
        {
            return Task.FromException(MyFilesShareRevokeException);
        }

        MyFilesShareRevoked.Add(("folder", folderId));
        return Task.CompletedTask;
    }

    public Exception? MyFilesLibrariesException { get; set; }
    public HubMyFileLibraryList? MyFileLibraries { get; set; }
    public Exception? MyFilesListException { get; set; }
    public HubMyFileListPage? MyFilesPage { get; set; }
    /// <summary>Если задана — отвечает на listing по (folderId, libraryId).</summary>
    public Func<string?, string?, HubMyFileListPage>? MyFilesPageFactory { get; set; }
    public Exception? MyFilesCreateFolderException { get; set; }
    public HubMyFileFolder? MyFilesCreatedFolderResult { get; set; }
    public Exception? MyFilesRenameException { get; set; }
    public Exception? MyFilesDeleteException { get; set; }
    public Exception? MyFilesDownloadException { get; set; }
    public byte[]? MyFilesDownloadBytes { get; set; }
    public string? MyFilesDownloadName { get; set; }
    public Exception? MyFilesUploadException { get; set; }
    public Exception? MyFilesUploadChunkException { get; set; }
    public Exception? MyFilesUploadCompleteException { get; set; }
    /// <summary>Размер чанка, который фейк сообщает в сессии загрузки.</summary>
    public int MyFilesUploadChunkSize { get; set; } = 4;
    public HubMyFileUploadSession? MyFilesUploadSession { get; set; }
    public HubMyFileItem? MyFilesUploadCompletedFile { get; set; }
    public List<(string? FolderId, string? LibraryId)> MyFilesListCalls { get; } = [];
    public List<(string Name, string? ParentId, string? LibraryId)> MyFilesCreatedFolders { get; } = [];
    public List<(string Kind, string Id, string Name)> MyFilesRenamed { get; } = [];
    public List<(string Kind, string Id)> MyFilesDeleted { get; } = [];
    public List<string> MyFilesDownloadCalls { get; } = [];
    public List<HubMyFileUploadSessionCreate> MyFilesUploadSessionRequests { get; } = [];
    /// <summary>Счётчик всех вызовов chunk-upload, включая упавшие попытки.</summary>
    public int MyFilesUploadChunkCalls { get; private set; }
    public List<(string FileId, long Offset, byte[] Data)> MyFilesUploadedChunks { get; } = [];
    public List<string> MyFilesCompletedSessions { get; } = [];
    public List<string> MyFilesCancelledSessions { get; } = [];
    public Exception? MyFilesShareException { get; set; }
    public Exception? MyFilesShareRevokeException { get; set; }
    /// <summary>Если задан — ответ create-share вместо сгенерированного токена.</summary>
    public HubMyFileShare? MyFilesShareResult { get; set; }
    /// <summary>Вызовы create-share: (file|folder), id и флаг rotate.</summary>
    public List<(string Kind, string Id, bool Rotate)> MyFilesShareCreated { get; } = [];
    /// <summary>Вызовы revoke-share: (file|folder) и id.</summary>
    public List<(string Kind, string Id)> MyFilesShareRevoked { get; } = [];

    // ---- Администрирование ----

    public Exception? AdminUsersException { get; set; }
    public IReadOnlyList<HubAdminUser> AdminUsers { get; set; } = [];
    public int AdminUsersCallCount { get; private set; }
    public Exception? AdminDepartmentsException { get; set; }
    public HubAdminDepartmentList AdminDepartments { get; set; } = new() { Items = [] };
    public bool? LastAdminDepartmentsIncludeInactive { get; private set; }
    public Exception? AdminDepartmentMembersException { get; set; }
    public HubAdminDepartmentMembers AdminDepartmentMembers { get; set; } = new() { Items = [] };
    public string? LastAdminDepartmentMembersId { get; private set; }
    public Exception? AdminAdCandidatesException { get; set; }
    public IReadOnlyList<HubAdminAdCandidate> AdminAdCandidates { get; set; } = [];
    public Exception? AdminAdSyncStatusException { get; set; }
    public HubAdminAdSyncStatus AdminAdSyncStatus { get; set; } = new();
    public Exception? AdminFeedbackException { get; set; }
    public HubAdminFeedbackPage AdminFeedbackPage { get; set; } = new() { Items = [] };
    public string? LastAdminFeedbackStatus { get; private set; }
    public int AdminFeedbackCallCount { get; private set; }
    public Exception? AdminRequestMetricsException { get; set; }
    public HubAdminRequestMetrics AdminRequestMetrics { get; set; } = new();
    public Exception? AdminAiBotsException { get; set; }
    public IReadOnlyList<HubAdminAiBot> AdminAiBots { get; set; } = [];

    public Task<IReadOnlyList<HubAdminUser>> GetAdminUsersAsync(CancellationToken cancellationToken)
    {
        AdminUsersCallCount++;
        if (AdminUsersException is not null)
        {
            return Task.FromException<IReadOnlyList<HubAdminUser>>(AdminUsersException);
        }

        return Task.FromResult(AdminUsers);
    }

    public Task<HubAdminDepartmentList> GetAdminDepartmentsAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        LastAdminDepartmentsIncludeInactive = includeInactive;
        if (AdminDepartmentsException is not null)
        {
            return Task.FromException<HubAdminDepartmentList>(AdminDepartmentsException);
        }

        return Task.FromResult(AdminDepartments);
    }

    public Task<HubAdminDepartmentMembers> GetAdminDepartmentMembersAsync(
        string departmentId,
        CancellationToken cancellationToken)
    {
        LastAdminDepartmentMembersId = departmentId;
        if (AdminDepartmentMembersException is not null)
        {
            return Task.FromException<HubAdminDepartmentMembers>(AdminDepartmentMembersException);
        }

        return Task.FromResult(AdminDepartmentMembers);
    }

    public Task<IReadOnlyList<HubAdminAdCandidate>> GetAdminAdImportCandidatesAsync(
        CancellationToken cancellationToken)
    {
        if (AdminAdCandidatesException is not null)
        {
            return Task.FromException<IReadOnlyList<HubAdminAdCandidate>>(AdminAdCandidatesException);
        }

        return Task.FromResult(AdminAdCandidates);
    }

    public Task<HubAdminAdSyncStatus> GetAdminAdSyncStatusAsync(CancellationToken cancellationToken)
    {
        if (AdminAdSyncStatusException is not null)
        {
            return Task.FromException<HubAdminAdSyncStatus>(AdminAdSyncStatusException);
        }

        return Task.FromResult(AdminAdSyncStatus);
    }

    public Task<HubAdminFeedbackPage> GetAdminFeedbackAsync(
        string? status,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        AdminFeedbackCallCount++;
        LastAdminFeedbackStatus = status;
        if (AdminFeedbackException is not null)
        {
            return Task.FromException<HubAdminFeedbackPage>(AdminFeedbackException);
        }

        return Task.FromResult(AdminFeedbackPage);
    }

    public Task<HubAdminRequestMetrics> GetAdminRequestMetricsAsync(
        int limit,
        string? sortBy,
        CancellationToken cancellationToken)
    {
        if (AdminRequestMetricsException is not null)
        {
            return Task.FromException<HubAdminRequestMetrics>(AdminRequestMetricsException);
        }

        return Task.FromResult(AdminRequestMetrics);
    }

    public Task<IReadOnlyList<HubAdminAiBot>> GetAdminAiBotsAsync(CancellationToken cancellationToken)
    {
        if (AdminAiBotsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubAdminAiBot>>(AdminAiBotsException);
        }

        return Task.FromResult(AdminAiBots);
    }

    public Exception? UpdateAiBotException { get; set; }
    public List<(string BotId, HubAiBotUpdateRequest Request)> UpdateAiBotCalls { get; } = [];
    /// <summary>Ответ PATCH вместо сгенерированного из записанного запроса.</summary>
    public Func<string, HubAiBotUpdateRequest, HubAdminAiBot>? UpdateAiBotResponder { get; set; }
    public Exception? CreateAiBotException { get; set; }
    public List<HubAiBotCreateRequest> CreateAiBotCalls { get; } = [];
    public Func<HubAiBotCreateRequest, HubAdminAiBot>? CreateAiBotResponder { get; set; }
    public Exception? SetDepartmentManagersException { get; set; }
    public List<(string DepartmentId, IReadOnlyList<long> ManagerUserIds)> SetDepartmentManagersCalls { get; } = [];
    /// <summary>Ответ PUT вместо сгенерированного из текущих memberships.</summary>
    public Func<string, IReadOnlyList<long>, HubAdminDepartmentMembers>? SetDepartmentManagersResponder { get; set; }

    public Task<HubAdminAiBot> UpdateAiBotAsync(
        string botId,
        HubAiBotUpdateRequest request,
        CancellationToken cancellationToken)
    {
        UpdateAiBotCalls.Add((botId, request));
        if (UpdateAiBotException is not null)
        {
            return Task.FromException<HubAdminAiBot>(UpdateAiBotException);
        }

        if (UpdateAiBotResponder is not null)
        {
            return Task.FromResult(UpdateAiBotResponder(botId, request));
        }

        // Имитация сервера: исходник списка + применённые поля запроса.
        var original = AdminAiBots.FirstOrDefault(bot =>
            string.Equals(bot.Id?.Trim(), botId.Trim(), StringComparison.Ordinal)) ?? new HubAdminAiBot { Id = botId };
        return Task.FromResult(original with
        {
            Title = request.Title ?? original.Title,
            Description = request.Description ?? original.Description,
            SystemPrompt = request.SystemPrompt ?? original.SystemPrompt,
            Model = request.Model ?? original.Model,
            Temperature = request.Temperature ?? original.Temperature,
            MaxTokens = request.MaxTokens ?? original.MaxTokens,
            AllowedKbScope = request.AllowedKbScope ?? original.AllowedKbScope,
            AllowFileInput = request.AllowFileInput ?? original.AllowFileInput,
            AllowGeneratedArtifacts = request.AllowGeneratedArtifacts ?? original.AllowGeneratedArtifacts,
            AllowKbDocumentDelivery = request.AllowKbDocumentDelivery ?? original.AllowKbDocumentDelivery,
            IsEnabled = request.IsEnabled ?? original.IsEnabled,
        });
    }

    public Task<HubAdminAiBot> CreateAiBotAsync(
        HubAiBotCreateRequest request,
        CancellationToken cancellationToken)
    {
        CreateAiBotCalls.Add(request);
        if (CreateAiBotException is not null)
        {
            return Task.FromException<HubAdminAiBot>(CreateAiBotException);
        }

        if (CreateAiBotResponder is not null)
        {
            return Task.FromResult(CreateAiBotResponder(request));
        }

        var created = new HubAdminAiBot
        {
            Id = $"bot_{(AdminAiBots.Count + 1).ToString(CultureInfo.InvariantCulture)}",
            Slug = request.Slug,
            Title = request.Title,
            Description = request.Description,
            SystemPrompt = request.SystemPrompt,
            Model = request.Model,
            Temperature = request.Temperature,
            MaxTokens = request.MaxTokens,
            AllowedKbScope = request.AllowedKbScope,
            AllowFileInput = request.AllowFileInput,
            AllowGeneratedArtifacts = request.AllowGeneratedArtifacts,
            AllowKbDocumentDelivery = request.AllowKbDocumentDelivery,
            IsEnabled = request.IsEnabled,
            Configured = true,
        };
        return Task.FromResult(created);
    }

    public Task<HubAdminDepartmentMembers> SetDepartmentManagersAsync(
        string departmentId,
        IReadOnlyList<long> managerUserIds,
        CancellationToken cancellationToken)
    {
        SetDepartmentManagersCalls.Add((departmentId, managerUserIds));
        if (SetDepartmentManagersException is not null)
        {
            return Task.FromException<HubAdminDepartmentMembers>(SetDepartmentManagersException);
        }

        if (SetDepartmentManagersResponder is not null)
        {
            return Task.FromResult(SetDepartmentManagersResponder(departmentId, managerUserIds));
        }

        // Имитация сервера: member-записи сохраняются, manager-набор заменяется.
        var kept = (AdminDepartmentMembers.Items ?? [])
            .Where(item => !string.Equals(item.Role?.Trim(), "manager", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var added = managerUserIds
            .Select((userId, index) =>
            {
                var existing = (AdminDepartmentMembers.Items ?? [])
                    .FirstOrDefault(item => item.UserId == userId && item.User is not null);
                return new HubAdminDepartmentMember
                {
                    Id = 1000L + index,
                    UserId = userId,
                    Role = "manager",
                    Source = "manual",
                    IsActive = true,
                    User = existing?.User,
                };
            });
        return Task.FromResult(new HubAdminDepartmentMembers
        {
            Department = AdminDepartmentMembers.Department,
            Items = kept.Concat(added).ToList(),
        });
    }

    public Exception? UpdateUserException { get; set; }
    public List<(long UserId, HubUserUpdateRequest Request)> UpdateUserCalls { get; } = [];
    /// <summary>Ответ PATCH вместо сгенерированного из записанного запроса.</summary>
    public Func<long, HubUserUpdateRequest, HubAdminUser>? UpdateUserResponder { get; set; }
    public Exception? CreateUserException { get; set; }
    public List<HubUserCreateRequest> CreateUserCalls { get; } = [];
    public Func<HubUserCreateRequest, HubAdminUser>? CreateUserResponder { get; set; }
    public Exception? ResetTwoFactorException { get; set; }
    public List<long> ResetTwoFactorCalls { get; } = [];
    public HubResetTwoFactorResult ResetTwoFactorResult { get; set; } = new() { Success = true };

    public Task<HubAdminUser> UpdateUserAsync(
        long userId,
        HubUserUpdateRequest request,
        CancellationToken cancellationToken)
    {
        UpdateUserCalls.Add((userId, request));
        if (UpdateUserException is not null)
        {
            return Task.FromException<HubAdminUser>(UpdateUserException);
        }

        if (UpdateUserResponder is not null)
        {
            return Task.FromResult(UpdateUserResponder(userId, request));
        }

        // Имитация сервера: исходник списка + применённые поля запроса.
        var original = AdminUsers.FirstOrDefault(user => user.Id == userId) ?? new HubAdminUser { Id = userId };
        return Task.FromResult(original with
        {
            Email = request.Email ?? original.Email,
            FullName = request.FullName ?? original.FullName,
            Department = request.Department ?? original.Department,
            JobTitle = request.JobTitle ?? original.JobTitle,
            Role = request.Role ?? original.Role,
            IsActive = request.IsActive ?? original.IsActive,
        });
    }

    public Task<HubAdminUser> CreateUserAsync(
        HubUserCreateRequest request,
        CancellationToken cancellationToken)
    {
        CreateUserCalls.Add(request);
        if (CreateUserException is not null)
        {
            return Task.FromException<HubAdminUser>(CreateUserException);
        }

        if (CreateUserResponder is not null)
        {
            return Task.FromResult(CreateUserResponder(request));
        }

        var created = new HubAdminUser
        {
            Id = (AdminUsers.Count > 0 ? AdminUsers.Max(user => user.Id) : 0) + 1,
            Username = request.Username,
            FullName = request.FullName,
            Email = request.Email,
            Department = request.Department,
            JobTitle = request.JobTitle,
            Role = request.Role,
            IsActive = request.IsActive,
            AuthSource = request.AuthSource,
        };
        return Task.FromResult(created);
    }

    public Task<HubResetTwoFactorResult> ResetUserTwoFactorAsync(
        long userId,
        CancellationToken cancellationToken)
    {
        ResetTwoFactorCalls.Add(userId);
        if (ResetTwoFactorException is not null)
        {
            return Task.FromException<HubResetTwoFactorResult>(ResetTwoFactorException);
        }

        return Task.FromResult(ResetTwoFactorResult with { UserId = userId });
    }

    // ---- Квоты почтовых ящиков ----

    public Exception? MailQuotaLatestException { get; set; }
    /// <summary>null — имитация 404 «No snapshots found», как у сервера без снимков.</summary>
    public HubMailQuotaSnapshot? MailQuotaLatest { get; set; }
    public int MailQuotaLatestCallCount { get; private set; }
    public Exception? MailQuotaSnapshotsException { get; set; }
    public IReadOnlyList<HubMailQuotaSnapshot> MailQuotaSnapshots { get; set; } = [];
    public int? LastMailQuotaSnapshotsLimit { get; private set; }
    public Exception? MailQuotaSummaryException { get; set; }
    public HubMailQuotaSnapshotStats MailQuotaSummary { get; set; } = new();
    public List<int> MailQuotaSummaryCalls { get; } = [];
    public Exception? MailQuotaRowsException { get; set; }
    public HubMailQuotaRowsPage MailQuotaRowsPage { get; set; } = new() { Items = [] };
    public List<(int SnapshotId, HubMailQuotaRowsQuery Query)> MailQuotaRowsCalls { get; } = [];
    /// <summary>Ответ rows вместо MailQuotaRowsPage — для постраничных сценариев.</summary>
    public Func<int, HubMailQuotaRowsQuery, HubMailQuotaRowsPage>? MailQuotaRowsResponder { get; set; }

    public Task<HubMailQuotaSnapshot> GetLatestMailQuotaSnapshotAsync(CancellationToken cancellationToken)
    {
        MailQuotaLatestCallCount++;
        if (MailQuotaLatestException is not null)
        {
            return Task.FromException<HubMailQuotaSnapshot>(MailQuotaLatestException);
        }

        if (MailQuotaLatest is null)
        {
            return Task.FromException<HubMailQuotaSnapshot>(new HubApiException(
                HubApiErrorKind.Http, "No snapshots found", System.Net.HttpStatusCode.NotFound));
        }

        return Task.FromResult(MailQuotaLatest);
    }

    public Task<IReadOnlyList<HubMailQuotaSnapshot>> GetMailQuotaSnapshotsAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        LastMailQuotaSnapshotsLimit = limit;
        if (MailQuotaSnapshotsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubMailQuotaSnapshot>>(MailQuotaSnapshotsException);
        }

        return Task.FromResult(MailQuotaSnapshots);
    }

    public Task<HubMailQuotaSnapshotStats> GetMailQuotaSnapshotSummaryAsync(
        int snapshotId,
        CancellationToken cancellationToken)
    {
        MailQuotaSummaryCalls.Add(snapshotId);
        if (MailQuotaSummaryException is not null)
        {
            return Task.FromException<HubMailQuotaSnapshotStats>(MailQuotaSummaryException);
        }

        return Task.FromResult(MailQuotaSummary with { SnapshotId = snapshotId });
    }

    public Task<HubMailQuotaRowsPage> GetMailQuotaRowsAsync(
        int snapshotId,
        HubMailQuotaRowsQuery query,
        CancellationToken cancellationToken)
    {
        MailQuotaRowsCalls.Add((snapshotId, query));
        if (MailQuotaRowsException is not null)
        {
            return Task.FromException<HubMailQuotaRowsPage>(MailQuotaRowsException);
        }

        if (MailQuotaRowsResponder is not null)
        {
            return Task.FromResult(MailQuotaRowsResponder(snapshotId, query));
        }

        return Task.FromResult(MailQuotaRowsPage);
    }

    // ---- Настройки ----

    public Exception? CurrentUserException { get; set; }
    public HubUser CurrentUser { get; set; } = new() { Id = 7, Username = "ivanov" };
    public Exception? MySettingsException { get; set; }
    public HubUserSettings MySettings { get; set; } = new();
    public List<(string ThemeMode, string FontFamily, double FontScale)> MySettingsUpdates { get; } = [];
    public Exception? NotificationPreferencesException { get; set; }
    public HubNotificationPreferences NotificationPreferences { get; set; } = new();
    public List<Dictionary<string, bool>> NotificationPreferencePatches { get; } = [];
    public Exception? ChangePasswordException { get; set; }
    public HubChangePasswordResult ChangePasswordResult { get; set; } = new()
    {
        Message = "Password changed successfully",
    };
    public string? LastChangePasswordOld { get; private set; }
    public string? LastChangePasswordNew { get; private set; }
    public int ChangePasswordCallCount { get; private set; }

    public Task<HubUser> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        if (CurrentUserException is not null)
        {
            return Task.FromException<HubUser>(CurrentUserException);
        }

        return Task.FromResult(CurrentUser);
    }

    public Task<HubUserSettings> GetMySettingsAsync(CancellationToken cancellationToken)
    {
        if (MySettingsException is not null)
        {
            return Task.FromException<HubUserSettings>(MySettingsException);
        }

        return Task.FromResult(MySettings);
    }

    public Task<HubUserSettings> UpdateMySettingsAsync(
        string themeMode,
        string fontFamily,
        double fontScale,
        CancellationToken cancellationToken)
    {
        MySettingsUpdates.Add((themeMode, fontFamily, fontScale));
        if (MySettingsException is not null)
        {
            return Task.FromException<HubUserSettings>(MySettingsException);
        }

        // Имитация сервера: PATCH возвращает применённые значения.
        MySettings = new HubUserSettings
        {
            ThemeMode = themeMode,
            FontFamily = fontFamily,
            FontScale = fontScale,
        };
        return Task.FromResult(MySettings);
    }

    public Task<HubNotificationPreferences> GetNotificationPreferencesAsync(
        CancellationToken cancellationToken)
    {
        if (NotificationPreferencesException is not null)
        {
            return Task.FromException<HubNotificationPreferences>(NotificationPreferencesException);
        }

        return Task.FromResult(NotificationPreferences);
    }

    public Task<HubNotificationPreferences> UpdateNotificationPreferencesAsync(
        IReadOnlyDictionary<string, bool> patch,
        CancellationToken cancellationToken)
    {
        NotificationPreferencePatches.Add(new Dictionary<string, bool>(patch));
        if (NotificationPreferencesException is not null)
        {
            return Task.FromException<HubNotificationPreferences>(NotificationPreferencesException);
        }

        // Имитация сервера: патч накладывается поверх сохранённых каналов.
        var channels = new Dictionary<string, bool>(NotificationPreferences.Channels ?? []);
        foreach (var pair in patch)
        {
            channels[pair.Key] = pair.Value;
        }

        NotificationPreferences = new HubNotificationPreferences
        {
            UserId = NotificationPreferences.UserId,
            Channels = channels,
        };
        return Task.FromResult(NotificationPreferences);
    }

    public Task<HubChangePasswordResult> ChangePasswordAsync(
        string oldPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        ChangePasswordCallCount++;
        LastChangePasswordOld = oldPassword;
        LastChangePasswordNew = newPassword;
        if (ChangePasswordException is not null)
        {
            return Task.FromException<HubChangePasswordResult>(ChangePasswordException);
        }

        return Task.FromResult(ChangePasswordResult);
    }

    public int ChatWsTicketCallCount { get; private set; }

    /// <summary>Если задан — отвечает на ws-ticket вызовы сам (тесты in-flight/задержек).</summary>
    public Func<CancellationToken, Task<HubWsTicket>>? ChatWsTicketHandler { get; set; }

    public Task<HubWsTicket> GetChatWsTicketAsync(CancellationToken cancellationToken)
    {
        ChatWsTicketCallCount++;
        return ChatWsTicketHandler?.Invoke(cancellationToken)
            ?? Task.FromResult(new HubWsTicket { Ticket = "ticket", ExpiresIn = 30 });
    }

    public Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken) =>
        Task.FromResult(AccessTokenToReturn);

    // ---- Desktop presence ----

    public int PresenceHeartbeatCallCount { get; private set; }
    public int PresenceDisconnectCallCount { get; private set; }
    public Exception? PresenceException { get; set; }
    /// <summary>Шов задержки heartbeat-тика (для тестов остановки цикла).</summary>
    public Func<CancellationToken, Task<HubDesktopPresence>>? PresenceHeartbeatHandler { get; set; }

    public Task<HubDesktopPresence> SendDesktopPresenceHeartbeatAsync(CancellationToken cancellationToken)
    {
        PresenceHeartbeatCallCount++;
        if (PresenceException is not null)
        {
            return Task.FromException<HubDesktopPresence>(PresenceException);
        }

        return PresenceHeartbeatHandler?.Invoke(cancellationToken)
            ?? Task.FromResult(new HubDesktopPresence { Active = true, ExpiresInSeconds = 90 });
    }

    public Task<HubDesktopPresence> DisconnectDesktopPresenceAsync(CancellationToken cancellationToken)
    {
        PresenceDisconnectCallCount++;
        if (PresenceException is not null)
        {
            return Task.FromException<HubDesktopPresence>(PresenceException);
        }

        return Task.FromResult(new HubDesktopPresence { Active = false, ExpiresInSeconds = 0 });
    }

    // ---- Картинки (DownloadImageAsync: фото контактов/руководителей, превью) ----

    public Exception? ImageDownloadException { get; set; }
    public byte[]? ImageDownloadBytes { get; set; }

    /// <summary>Ответ по запрошенному пути/URL; иначе — общий ImageDownloadBytes.</summary>
    public Func<string, byte[]?>? ImageDownloadBytesFactory { get; set; }
    public List<string> ImageDownloadCalls { get; } = [];

    public Task<byte[]> DownloadImageAsync(string uriOrPath, CancellationToken cancellationToken)
    {
        ImageDownloadCalls.Add(uriOrPath);
        if (ImageDownloadException is not null)
        {
            return Task.FromException<byte[]>(ImageDownloadException);
        }

        return Task.FromResult(
            ImageDownloadBytesFactory?.Invoke(uriOrPath) ?? ImageDownloadBytes ?? []);
    }

    // ============================================================================
    // Новости: администрирование (раздел «Новости» AdminViewModel).
    // ManagedAnnouncementsItems — мутируемый список: publish/archive/delete
    // фейк правит его как сервер, чтобы reload в тестах отражал новый статус.
    // ============================================================================

    public Exception? ManagedAnnouncementsException { get; set; }
    public List<HubAnnouncementItem> ManagedAnnouncementsItems { get; set; } = [];
    public List<HubAnnouncementManageQuery> ManagedAnnouncementsCalls { get; } = [];
    /// <summary>Ответ вместо сгенерированной страницы из ManagedAnnouncementsItems.</summary>
    public HubAnnouncementManagePage? ManagedAnnouncementsPageOverride { get; set; }

    public Task<HubAnnouncementManagePage> GetManagedAnnouncementsAsync(
        HubAnnouncementManageQuery query,
        CancellationToken cancellationToken)
    {
        ManagedAnnouncementsCalls.Add(query);
        if (ManagedAnnouncementsException is not null)
        {
            return Task.FromException<HubAnnouncementManagePage>(ManagedAnnouncementsException);
        }

        if (ManagedAnnouncementsPageOverride is not null)
        {
            return Task.FromResult(ManagedAnnouncementsPageOverride);
        }

        // Как сервер: фильтр по запрошенному статусу (regex-обязателен в контракте).
        var items = ManagedAnnouncementsItems
            .Where(item => string.Equals(
                (item.Status ?? "draft").Trim(), query.Status ?? "draft", StringComparison.OrdinalIgnoreCase))
            .ToList();
        return Task.FromResult(new HubAnnouncementManagePage
        {
            Items = items,
            Status = query.Status,
            Total = items.Count,
            Limit = query.Limit,
            Offset = query.Offset,
        });
    }

    public Exception? AnnouncementCreateException { get; set; }
    public List<HubAnnouncementCreateRequest> AnnouncementCreateCalls { get; } = [];
    public List<IReadOnlyList<HubAnnouncementOutgoingFile>> AnnouncementCreateFileCalls { get; } = [];
    public Func<HubAnnouncementCreateRequest, HubAnnouncementItem>? AnnouncementCreateResponder { get; set; }
    public int AnnouncementCreateSeq { get; set; }

    public Task<HubAnnouncementItem> CreateAnnouncementAsync(
        HubAnnouncementCreateRequest request,
        IReadOnlyList<HubAnnouncementOutgoingFile>? files,
        CancellationToken cancellationToken)
    {
        AnnouncementCreateCalls.Add(request);
        AnnouncementCreateFileCalls.Add(files ?? []);
        if (AnnouncementCreateException is not null)
        {
            return Task.FromException<HubAnnouncementItem>(AnnouncementCreateException);
        }

        var created = AnnouncementCreateResponder?.Invoke(request) ?? new HubAnnouncementItem
        {
            Id = $"news-{++AnnouncementCreateSeq}",
            Title = request.Title,
            Preview = request.Preview,
            Body = request.Body,
            Priority = request.Priority,
            Status = request.Status,
            CategoryId = request.CategoryId,
            Category = request.CategoryId is null
                ? null
                : new HubAnnouncementCategory { Id = request.CategoryId },
            Tags = (request.Tags ?? []).Select(t => new HubAnnouncementTag { Name = t }).ToList(),
            RequiresAck = request.RequiresAck,
            IsPinned = request.IsPinned,
            CanManage = true,
        };
        ManagedAnnouncementsItems.Add(created);
        return Task.FromResult(created);
    }

    public Exception? AnnouncementDraftException { get; set; }
    public List<HubAnnouncementCreateRequest> AnnouncementDraftCalls { get; } = [];

    public Task<HubAnnouncementItem> CreateAnnouncementDraftAsync(
        HubAnnouncementCreateRequest request,
        CancellationToken cancellationToken)
    {
        AnnouncementDraftCalls.Add(request);
        if (AnnouncementDraftException is not null)
        {
            return Task.FromException<HubAnnouncementItem>(AnnouncementDraftException);
        }

        // Как роут /drafts: status принудительно draft.
        var created = new HubAnnouncementItem
        {
            Id = $"news-{++AnnouncementCreateSeq}",
            Title = request.Title,
            Preview = request.Preview,
            Body = request.Body,
            Priority = request.Priority,
            Status = "draft",
            CategoryId = request.CategoryId,
            Tags = (request.Tags ?? []).Select(t => new HubAnnouncementTag { Name = t }).ToList(),
            RequiresAck = request.RequiresAck,
            IsPinned = request.IsPinned,
            CanManage = true,
        };
        ManagedAnnouncementsItems.Add(created);
        return Task.FromResult(created);
    }

    public Exception? AnnouncementUpdateException { get; set; }
    public List<(string Id, HubAnnouncementUpdateRequest Request)> AnnouncementUpdateCalls { get; } = [];
    public Func<string, HubAnnouncementUpdateRequest, HubAnnouncementItem>? AnnouncementUpdateResponder { get; set; }

    public Task<HubAnnouncementItem> UpdateAnnouncementAsync(
        string announcementId,
        HubAnnouncementUpdateRequest request,
        CancellationToken cancellationToken)
    {
        AnnouncementUpdateCalls.Add((announcementId, request));
        if (AnnouncementUpdateException is not null)
        {
            return Task.FromException<HubAnnouncementItem>(AnnouncementUpdateException);
        }

        if (AnnouncementUpdateResponder is not null)
        {
            return Task.FromResult(AnnouncementUpdateResponder(announcementId, request));
        }

        // Имитация сервера: исходник списка + применённые (не-null) поля запроса.
        var index = ManagedAnnouncementsItems.FindIndex(item =>
            string.Equals(item.Id?.Trim(), announcementId.Trim(), StringComparison.Ordinal));
        var original = index >= 0 ? ManagedAnnouncementsItems[index] : new HubAnnouncementItem { Id = announcementId };
        var updated = original with
        {
            Title = request.Title ?? original.Title,
            Preview = request.Preview ?? original.Preview,
            Body = request.Body ?? original.Body,
            Priority = request.Priority ?? original.Priority,
            CategoryId = request.CategoryId ?? original.CategoryId,
            Tags = request.Tags is null
                ? original.Tags
                : request.Tags.Select(t => new HubAnnouncementTag { Name = t }).ToList(),
            RequiresAck = request.RequiresAck ?? original.RequiresAck,
            IsPinned = request.IsPinned ?? original.IsPinned,
        };
        if (index >= 0)
        {
            ManagedAnnouncementsItems[index] = updated;
        }

        return Task.FromResult(updated);
    }

    public Exception? AnnouncementPublishException { get; set; }
    public List<string> AnnouncementPublishCalls { get; } = [];
    public Exception? AnnouncementArchiveException { get; set; }
    public List<string> AnnouncementArchiveCalls { get; } = [];

    private Task<HubAnnouncementItem> ChangeAnnouncementStatusAsync(
        string announcementId,
        string status,
        Exception? exception)
    {
        if (exception is not null)
        {
            return Task.FromException<HubAnnouncementItem>(exception);
        }

        var index = ManagedAnnouncementsItems.FindIndex(item =>
            string.Equals(item.Id?.Trim(), announcementId.Trim(), StringComparison.Ordinal));
        var updated = index >= 0
            ? ManagedAnnouncementsItems[index] with { Status = status }
            : new HubAnnouncementItem { Id = announcementId, Status = status };
        if (index >= 0)
        {
            ManagedAnnouncementsItems[index] = updated;
        }

        return Task.FromResult(updated);
    }

    public Task<HubAnnouncementItem> PublishAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        AnnouncementPublishCalls.Add(announcementId);
        return ChangeAnnouncementStatusAsync(announcementId, "published", AnnouncementPublishException);
    }

    public Task<HubAnnouncementItem> ArchiveAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        AnnouncementArchiveCalls.Add(announcementId);
        return ChangeAnnouncementStatusAsync(announcementId, "archived", AnnouncementArchiveException);
    }

    public Exception? AnnouncementDeleteException { get; set; }
    public List<string> AnnouncementDeleteCalls { get; } = [];

    public Task DeleteManagedAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        AnnouncementDeleteCalls.Add(announcementId);
        if (AnnouncementDeleteException is not null)
        {
            return Task.FromException(AnnouncementDeleteException);
        }

        ManagedAnnouncementsItems.RemoveAll(item =>
            string.Equals(item.Id?.Trim(), announcementId.Trim(), StringComparison.Ordinal));
        return Task.CompletedTask;
    }

    public Exception? AnnouncementCategoriesException { get; set; }
    public HubAnnouncementCategoryList AnnouncementCategories { get; set; } = new() { Items = [] };
    public bool? LastAnnouncementCategoriesIncludeInactive { get; private set; }

    public Task<HubAnnouncementCategoryList> GetAnnouncementCategoriesAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        LastAnnouncementCategoriesIncludeInactive = includeInactive;
        if (AnnouncementCategoriesException is not null)
        {
            return Task.FromException<HubAnnouncementCategoryList>(AnnouncementCategoriesException);
        }

        return Task.FromResult(AnnouncementCategories);
    }

    public Exception? AnnouncementCategoryCreateException { get; set; }
    public List<string> AnnouncementCategoryCreateCalls { get; } = [];

    public Task<HubAnnouncementCategory> CreateAnnouncementCategoryAsync(
        string name,
        CancellationToken cancellationToken)
    {
        AnnouncementCategoryCreateCalls.Add(name);
        if (AnnouncementCategoryCreateException is not null)
        {
            return Task.FromException<HubAnnouncementCategory>(AnnouncementCategoryCreateException);
        }

        var created = new HubAnnouncementCategory
        {
            Id = $"cat-{AnnouncementCategoryCreateCalls.Count}",
            Name = name,
            Slug = name.ToLowerInvariant().Replace(' ', '-'),
            IsActive = true,
        };
        AnnouncementCategories = AnnouncementCategories with
        {
            Items = [.. (AnnouncementCategories.Items ?? []), created],
        };
        return Task.FromResult(created);
    }

    public Exception? AnnouncementTagsException { get; set; }
    public HubAnnouncementTagList AnnouncementTags { get; set; } = new() { Items = [] };

    public Task<HubAnnouncementTagList> GetAnnouncementTagsAsync(CancellationToken cancellationToken)
    {
        if (AnnouncementTagsException is not null)
        {
            return Task.FromException<HubAnnouncementTagList>(AnnouncementTagsException);
        }

        return Task.FromResult(AnnouncementTags);
    }

    public Exception? AnnouncementAttachmentUploadException { get; set; }
    public List<(string AnnouncementId, HubAnnouncementOutgoingFile File)> AnnouncementAttachmentUploadCalls { get; } = [];

    public Task<HubAnnouncementAttachment> UploadAnnouncementAttachmentAsync(
        string announcementId,
        HubAnnouncementOutgoingFile file,
        CancellationToken cancellationToken)
    {
        AnnouncementAttachmentUploadCalls.Add((announcementId, file));
        if (AnnouncementAttachmentUploadException is not null)
        {
            return Task.FromException<HubAnnouncementAttachment>(AnnouncementAttachmentUploadException);
        }

        return Task.FromResult(new HubAnnouncementAttachment
        {
            Id = $"att-{AnnouncementAttachmentUploadCalls.Count}",
            AnnouncementId = announcementId,
            FileName = file.FileName,
            FileMime = file.ContentType,
            FileSize = file.Content.Length,
        });
    }

    public Exception? AnnouncementAnalyticsException { get; set; }
    public HubAnnouncementAnalytics AnnouncementAnalytics { get; set; } = new();
    public List<string> AnnouncementAnalyticsCalls { get; } = [];

    public Task<HubAnnouncementAnalytics> GetAnnouncementAnalyticsAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        AnnouncementAnalyticsCalls.Add(announcementId);
        if (AnnouncementAnalyticsException is not null)
        {
            return Task.FromException<HubAnnouncementAnalytics>(AnnouncementAnalyticsException);
        }

        return Task.FromResult(AnnouncementAnalytics);
    }

    // ---- Строительство ----
    public Exception? ConstructionObjectsException { get; set; }
    public HubConstructionObjectsResponse ConstructionObjects { get; set; } = new() { Items = [] };
    public int ConstructionObjectsCallCount { get; private set; }
    public List<HubConstructionObjectsQuery> ConstructionObjectsCalls { get; } = [];

    /// <summary>Страница объектов по запросу (поиск/kind/cursor), иначе — общий ConstructionObjects.</summary>
    public Func<HubConstructionObjectsQuery, HubConstructionObjectsResponse>? ConstructionObjectsFactory { get; set; }

    public Task<HubConstructionObjectsResponse> GetConstructionObjectsAsync(
        HubConstructionObjectsQuery query,
        CancellationToken cancellationToken)
    {
        ConstructionObjectsCallCount++;
        ConstructionObjectsCalls.Add(query);
        if (ConstructionObjectsException is not null)
        {
            return Task.FromException<HubConstructionObjectsResponse>(ConstructionObjectsException);
        }

        return Task.FromResult(
            ConstructionObjectsFactory?.Invoke(query) ?? ConstructionObjects);
    }

    public Exception? ConstructionObjectDetailException { get; set; }
    public HubConstructionObjectDetail? ConstructionObjectDetail { get; set; }
    public List<string> ConstructionObjectDetailCalls { get; } = [];

    /// <summary>Карточка по id объекта (managed:…|group_ref), иначе — общий ConstructionObjectDetail.</summary>
    public Func<string, HubConstructionObjectDetail?>? ConstructionObjectDetailFactory { get; set; }

    /// <summary>
    /// Задержка ответа детали: тесты гонки выбора ставят Task.Delay/TaskCompletionSource.
    /// </summary>
    public Func<string, CancellationToken, Task>? ConstructionObjectDetailDelay { get; set; }

    public async Task<HubConstructionObjectDetail> GetConstructionObjectDetailAsync(
        string objectId,
        CancellationToken cancellationToken)
    {
        ConstructionObjectDetailCalls.Add(objectId);
        if (ConstructionObjectDetailException is not null)
        {
            throw ConstructionObjectDetailException;
        }

        if (ConstructionObjectDetailDelay is not null)
        {
            await ConstructionObjectDetailDelay(objectId, cancellationToken);
        }

        return ConstructionObjectDetailFactory?.Invoke(objectId)
            ?? ConstructionObjectDetail
            ?? new HubConstructionObjectDetail
            {
                Id = objectId,
                Name = objectId,
                Kind = "project",
                IsActive = true,
                Groups = [],
                Team = [],
            };
    }

    public Exception? ConstructionObjectRequestsException { get; set; }
    public HubConstructionObjectRequestsResponse ConstructionObjectRequests { get; set; } = new() { Items = [] };
    public List<(string ObjectId, HubConstructionRequestsQuery Query)> ConstructionObjectRequestsCalls { get; } = [];

    /// <summary>Страница заявок по id объекта и запросу (view/cursor), иначе — общий ConstructionObjectRequests.</summary>
    public Func<string, HubConstructionRequestsQuery, HubConstructionObjectRequestsResponse>? ConstructionObjectRequestsFactory { get; set; }

    public Task<HubConstructionObjectRequestsResponse> GetConstructionObjectRequestsAsync(
        string objectId,
        HubConstructionRequestsQuery query,
        CancellationToken cancellationToken)
    {
        ConstructionObjectRequestsCalls.Add((objectId, query));
        if (ConstructionObjectRequestsException is not null)
        {
            return Task.FromException<HubConstructionObjectRequestsResponse>(ConstructionObjectRequestsException);
        }

        return Task.FromResult(
            ConstructionObjectRequestsFactory?.Invoke(objectId, query) ?? ConstructionObjectRequests);
    }

    // ---- Склад 1С ----
    public List<HubWarehouse1cCatalogItem> Warehouse1cNomenclatureSearch { get; set; } = [];
    public List<string> Warehouse1cNomenclatureSearchQueries { get; } = [];

    public Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cNomenclatureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        Warehouse1cNomenclatureSearchQueries.Add(query);
        return Task.FromResult<IReadOnlyList<HubWarehouse1cCatalogItem>>(Warehouse1cNomenclatureSearch);
    }

    public List<HubWarehouse1cCatalogItem> Warehouse1cWarehousesSearch { get; set; } = [];
    public List<string> Warehouse1cWarehousesSearchQueries { get; } = [];

    public Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cWarehousesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        Warehouse1cWarehousesSearchQueries.Add(query);
        return Task.FromResult<IReadOnlyList<HubWarehouse1cCatalogItem>>(Warehouse1cWarehousesSearch);
    }

    public Exception? Warehouse1cBalancesException { get; set; }
    public HubWarehouse1cBalancesResponse Warehouse1cBalances { get; set; } = new() { Items = [] };
    public List<HubWarehouse1cBalancesQuery> Warehouse1cBalancesCalls { get; } = [];

    /// <summary>Страница остатков по запросу (фильтры), иначе — общий Warehouse1cBalances.</summary>
    public Func<HubWarehouse1cBalancesQuery, HubWarehouse1cBalancesResponse>? Warehouse1cBalancesFactory { get; set; }

    public Task<HubWarehouse1cBalancesResponse> GetWarehouse1cBalancesAsync(
        HubWarehouse1cBalancesQuery query,
        CancellationToken cancellationToken)
    {
        Warehouse1cBalancesCalls.Add(query);
        if (Warehouse1cBalancesException is not null)
        {
            return Task.FromException<HubWarehouse1cBalancesResponse>(Warehouse1cBalancesException);
        }

        return Task.FromResult(
            Warehouse1cBalancesFactory?.Invoke(query) ?? Warehouse1cBalances);
    }

    public Exception? Warehouse1cMovementsException { get; set; }
    public HubWarehouse1cMovementsResponse Warehouse1cMovements { get; set; } = new() { Items = [] };
    public List<HubWarehouse1cMovementsQuery> Warehouse1cMovementsCalls { get; } = [];

    /// <summary>Страница движений по запросу (фильтры/cursor), иначе — общий Warehouse1cMovements.</summary>
    public Func<HubWarehouse1cMovementsQuery, HubWarehouse1cMovementsResponse>? Warehouse1cMovementsFactory { get; set; }

    public Task<HubWarehouse1cMovementsResponse> GetWarehouse1cMovementsAsync(
        HubWarehouse1cMovementsQuery query,
        CancellationToken cancellationToken)
    {
        Warehouse1cMovementsCalls.Add(query);
        if (Warehouse1cMovementsException is not null)
        {
            return Task.FromException<HubWarehouse1cMovementsResponse>(Warehouse1cMovementsException);
        }

        return Task.FromResult(
            Warehouse1cMovementsFactory?.Invoke(query) ?? Warehouse1cMovements);
    }

    public Exception? Warehouse1cMovementDetailException { get; set; }
    public HubWarehouse1cMovementDetail? Warehouse1cMovementDetail { get; set; }
    public List<string> Warehouse1cMovementDetailCalls { get; } = [];

    /// <summary>Задержка ответа детали: тесты гонки выбора ставят TaskCompletionSource.</summary>
    public Func<string, CancellationToken, Task>? Warehouse1cMovementDetailDelay { get; set; }

    public async Task<HubWarehouse1cMovementDetail> GetWarehouse1cMovementDetailAsync(
        string registrarRef,
        CancellationToken cancellationToken)
    {
        Warehouse1cMovementDetailCalls.Add(registrarRef);
        if (Warehouse1cMovementDetailException is not null)
        {
            throw Warehouse1cMovementDetailException;
        }

        if (Warehouse1cMovementDetailDelay is not null)
        {
            await Warehouse1cMovementDetailDelay(registrarRef, cancellationToken);
        }

        return Warehouse1cMovementDetail ?? new HubWarehouse1cMovementDetail
        {
            RegistrarRef = registrarRef,
            RegistrarName = "Поступление товаров и услуг",
            RegistrarNumber = "000-123",
            Files = [],
        };
    }

    public List<(string RegistrarRef, string FileRef)> Warehouse1cFileCalls { get; } = [];
    public byte[] Warehouse1cFileContent { get; set; } = [];
    public string Warehouse1cFileName { get; set; } = "file.bin";

    public async Task<string> DownloadWarehouse1cMovementFileAsync(
        string registrarRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        Warehouse1cFileCalls.Add((registrarRef, fileRef));
        await destination.WriteAsync(Warehouse1cFileContent, cancellationToken);
        return Warehouse1cFileName;
    }

    public Exception? Warehouse1cDismissedException { get; set; }
    public HubWarehouse1cDismissedResponse Warehouse1cDismissed { get; set; } = new() { Items = [] };
    public int Warehouse1cDismissedCallCount { get; private set; }

    public Task<HubWarehouse1cDismissedResponse> GetWarehouse1cDismissedWarehousesAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        Warehouse1cDismissedCallCount++;
        if (Warehouse1cDismissedException is not null)
        {
            return Task.FromException<HubWarehouse1cDismissedResponse>(Warehouse1cDismissedException);
        }

        return Task.FromResult(Warehouse1cDismissed);
    }

    public Exception? Warehouse1cCatalogStatusException { get; set; }
    public HubWarehouse1cCatalogStatus? Warehouse1cCatalogStatus { get; set; }

    public Task<HubWarehouse1cCatalogStatus> GetWarehouse1cCatalogStatusAsync(
        CancellationToken cancellationToken)
    {
        if (Warehouse1cCatalogStatusException is not null)
        {
            return Task.FromException<HubWarehouse1cCatalogStatus>(Warehouse1cCatalogStatusException);
        }

        return Task.FromResult(Warehouse1cCatalogStatus ?? new HubWarehouse1cCatalogStatus());
    }

    public Exception? Warehouse1cItRequestsException { get; set; }
    public HubItRequestsResponse Warehouse1cItRequests { get; set; } = new() { Items = [] };
    public List<HubItRequestsQuery> Warehouse1cItRequestsCalls { get; } = [];

    /// <summary>Страница заявок по запросу (view/стадия/cursor), иначе — общий Warehouse1cItRequests.</summary>
    public Func<HubItRequestsQuery, HubItRequestsResponse>? Warehouse1cItRequestsFactory { get; set; }

    public Task<HubItRequestsResponse> GetWarehouse1cItRequestsAsync(
        HubItRequestsQuery query,
        CancellationToken cancellationToken)
    {
        Warehouse1cItRequestsCalls.Add(query);
        if (Warehouse1cItRequestsException is not null)
        {
            return Task.FromException<HubItRequestsResponse>(Warehouse1cItRequestsException);
        }

        return Task.FromResult(
            Warehouse1cItRequestsFactory?.Invoke(query) ?? Warehouse1cItRequests);
    }

    public Exception? Warehouse1cItRequestDetailException { get; set; }
    public HubItRequestItem? Warehouse1cItRequestDetail { get; set; }
    public List<string> Warehouse1cItRequestDetailCalls { get; } = [];

    /// <summary>Деталь по ref заявки, иначе — общий Warehouse1cItRequestDetail.</summary>
    public Func<string, HubItRequestItem?>? Warehouse1cItRequestDetailFactory { get; set; }

    /// <summary>Задержка ответа детали: тесты гонки выбора ставят TaskCompletionSource.</summary>
    public Func<string, CancellationToken, Task>? Warehouse1cItRequestDetailDelay { get; set; }

    public async Task<HubItRequestItem> GetWarehouse1cItRequestDetailAsync(
        string requestRef,
        CancellationToken cancellationToken)
    {
        Warehouse1cItRequestDetailCalls.Add(requestRef);
        if (Warehouse1cItRequestDetailException is not null)
        {
            throw Warehouse1cItRequestDetailException;
        }

        if (Warehouse1cItRequestDetailDelay is not null)
        {
            await Warehouse1cItRequestDetailDelay(requestRef, cancellationToken);
        }

        return Warehouse1cItRequestDetailFactory?.Invoke(requestRef)
            ?? Warehouse1cItRequestDetail
            ?? new HubItRequestItem { RequestRef = requestRef };
    }

    // ==================== DLP-мониторинг ====================

    public Exception? DlpException { get; set; }
    public HubDlpHostsResponse? DlpHosts { get; set; }
    public HubDlpSummaryResponse? DlpSummary { get; set; }

    /// <summary>Сводка за день по ключу даты, иначе общий DlpAttention.</summary>
    public Func<string?, HubDlpAttentionResponse?>? DlpAttentionFactory { get; set; }
    public HubDlpAttentionResponse? DlpAttention { get; set; }
    public List<string?> DlpAttentionCalls { get; } = [];

    /// <summary>Активность по ключу (computer, day), иначе общий DlpActivity.</summary>
    public Func<string, string?, HubDlpActivityResponse?>? DlpActivityFactory { get; set; }
    public HubDlpActivityResponse? DlpActivity { get; set; }
    public List<(string Computer, string? Day)> DlpActivityCalls { get; } = [];

    public Exception? DlpSchedulesException { get; set; }
    public HubDlpWorkSchedulesResponse? DlpWorkSchedules { get; set; }

    /// <summary>Сохранённые через PUT графики — тесты проверяют payload.</summary>
    public List<(string Branch, int WorkStartMin, int WorkEndMin, int? LunchStartMin, int? LunchEndMin, int TzOffsetMinutes, int WorkdaysMask)> DlpScheduleSaves { get; } = [];
    public List<string> DlpScheduleDeletes { get; } = [];
    public Exception? DlpScheduleSaveException { get; set; }
    public Exception? DlpScheduleDeleteException { get; set; }
    public Func<HubDlpWorkSchedule?>? DlpScheduleSaveFactory { get; set; }

    /// <summary>Файловые события по компьютеру — вкладка «Файлы».</summary>
    public Func<string?, string?, HubFsEgressResponse?>? FsEgressFactory { get; set; }
    public HubFsEgressResponse? FsEgress { get; set; }

    public Func<string?, HubDlpChatsResponse?>? TelegramChatsFactory { get; set; }
    public HubDlpChatsResponse? TelegramChats { get; set; }
    public Func<string?, HubDlpChatsResponse?>? MaxChatsFactory { get; set; }
    public HubDlpChatsResponse? MaxChats { get; set; }
    public Func<string?, string?, HubBrowserVisitsResponse?>? BrowserVisitsFactory { get; set; }
    public HubBrowserVisitsResponse? BrowserVisits { get; set; }

    public Task<HubDlpHostsResponse> ListDlpHostsAsync(
        string? category,
        CancellationToken cancellationToken)
    {
        if (DlpException is not null)
        {
            throw DlpException;
        }

        return Task.FromResult(DlpHosts ?? new HubDlpHostsResponse());
    }

    public Task<HubDlpSummaryResponse> GetDlpSummaryAsync(
        CancellationToken cancellationToken)
    {
        if (DlpException is not null)
        {
            throw DlpException;
        }

        return Task.FromResult(DlpSummary ?? new HubDlpSummaryResponse());
    }

    public Task<HubDlpAttentionResponse> GetDlpAttentionAsync(
        string? day,
        CancellationToken cancellationToken)
    {
        DlpAttentionCalls.Add(day);
        if (DlpException is not null)
        {
            throw DlpException;
        }

        return Task.FromResult(
            DlpAttentionFactory?.Invoke(day)
            ?? DlpAttention
            ?? new HubDlpAttentionResponse());
    }

    public Task<HubDlpActivityResponse> GetDlpActivityAsync(
        string computerName,
        string? day,
        CancellationToken cancellationToken)
    {
        DlpActivityCalls.Add((computerName, day));
        if (DlpException is not null)
        {
            throw DlpException;
        }

        return Task.FromResult(
            DlpActivityFactory?.Invoke(computerName, day)
            ?? DlpActivity
            ?? new HubDlpActivityResponse());
    }

    public Task<HubDlpWorkSchedulesResponse> ListDlpWorkSchedulesAsync(
        CancellationToken cancellationToken)
    {
        if (DlpSchedulesException is not null)
        {
            throw DlpSchedulesException;
        }

        return Task.FromResult(DlpWorkSchedules ?? new HubDlpWorkSchedulesResponse());
    }

    public Task<HubDlpWorkScheduleSaveResponse> SaveDlpWorkScheduleAsync(
        string branchName,
        int workStartMin,
        int workEndMin,
        int? lunchStartMin,
        int? lunchEndMin,
        int tzOffsetMinutes,
        int workdaysMask,
        CancellationToken cancellationToken)
    {
        DlpScheduleSaves.Add(
            (branchName, workStartMin, workEndMin, lunchStartMin, lunchEndMin, tzOffsetMinutes, workdaysMask));
        if (DlpScheduleSaveException is not null)
        {
            throw DlpScheduleSaveException;
        }

        return Task.FromResult(new HubDlpWorkScheduleSaveResponse
        {
            Success = true,
            Schedule = DlpScheduleSaveFactory?.Invoke(),
        });
    }

    public Task DeleteDlpWorkScheduleAsync(
        string branchName,
        CancellationToken cancellationToken)
    {
        DlpScheduleDeletes.Add(branchName);
        if (DlpScheduleDeleteException is not null)
        {
            throw DlpScheduleDeleteException;
        }

        return Task.CompletedTask;
    }

    public Task<HubFsEgressResponse> ListFsEgressEventsAsync(
        string? computerName,
        string? channel,
        int limit,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(
            FsEgressFactory?.Invoke(computerName, channel)
            ?? FsEgress
            ?? new HubFsEgressResponse());
    }

    public Task<HubDlpChatsResponse> ListTelegramChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(
            TelegramChatsFactory?.Invoke(computerName)
            ?? TelegramChats
            ?? new HubDlpChatsResponse());
    }

    public Task<HubDlpChatsResponse> ListMaxChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(
            MaxChatsFactory?.Invoke(computerName)
            ?? MaxChats
            ?? new HubDlpChatsResponse());
    }

    public Task<HubBrowserVisitsResponse> ListBrowserVisitsAsync(
        string? computerName,
        string? day,
        int limit,
        CancellationToken cancellationToken)
    {
        return Task.FromResult(
            BrowserVisitsFactory?.Invoke(computerName, day)
            ?? BrowserVisits
            ?? new HubBrowserVisitsResponse());
    }

    public Task LogoutAsync(CancellationToken cancellationToken)
    {
        CurrentSession = null;
        return Task.CompletedTask;
    }

    // ---- Мои файлы: корзина / квота / копия / архив / предпросмотр / библиотеки ----

    public Exception? MyFilesTrashException { get; set; }
    public HubMyFileTrash? MyFilesTrash { get; set; }
    public Func<string?, HubMyFileTrash>? MyFilesTrashFactory { get; set; }
    public List<string?> MyFilesTrashCalls { get; } = [];
    public Exception? MyFilesTrashEmptyException { get; set; }
    public List<string?> MyFilesTrashEmptyCalls { get; } = [];
    public Exception? MyFilesTrashRestoreException { get; set; }
    public List<(string Kind, string Id)> MyFilesRestored { get; } = [];
    public Exception? MyFilesTrashPurgeException { get; set; }
    public List<(string Kind, string Id)> MyFilesPurged { get; } = [];
    public Exception? MyFilesQuotaException { get; set; }
    public HubMyFileQuota? MyFilesQuota { get; set; }
    public int MyFilesQuotaCallCount { get; private set; }
    public Exception? MyFilesCopyException { get; set; }
    public HubMyFileItem? MyFilesCopyResult { get; set; }
    public List<(string FileId, string? FolderId, string? LibraryId)> MyFilesCopied { get; } = [];
    public Exception? MyFilesArchiveException { get; set; }
    public byte[]? MyFilesArchiveBytes { get; set; }
    public string? MyFilesArchiveName { get; set; }
    public List<string> MyFilesArchiveCalls { get; } = [];
    public Exception? MyFilesPreviewException { get; set; }
    public HubMyFilePreview? MyFilesPreview { get; set; }
    public List<string> MyFilesPreviewCalls { get; } = [];
    public Exception? MyFilesPreviewContentException { get; set; }
    public byte[]? MyFilesPreviewContentBytes { get; set; }
    public string? MyFilesPreviewContentType { get; set; }
    public List<string> MyFilesPreviewContentCalls { get; } = [];

    public Task<HubMyFileTrash> GetMyFilesTrashAsync(
        string? libraryId,
        CancellationToken cancellationToken)
    {
        MyFilesTrashCalls.Add(libraryId);
        if (MyFilesTrashException is not null)
        {
            return Task.FromException<HubMyFileTrash>(MyFilesTrashException);
        }

        return Task.FromResult(
            MyFilesTrashFactory?.Invoke(libraryId)
            ?? MyFilesTrash
            ?? new HubMyFileTrash { Items = [], Folders = [] });
    }

    public Task EmptyMyFilesTrashAsync(string? libraryId, CancellationToken cancellationToken)
    {
        MyFilesTrashEmptyCalls.Add(libraryId);
        if (MyFilesTrashEmptyException is not null)
        {
            return Task.FromException(MyFilesTrashEmptyException);
        }

        return Task.CompletedTask;
    }

    public Task RestoreMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        if (MyFilesTrashRestoreException is not null)
        {
            return Task.FromException(MyFilesTrashRestoreException);
        }

        MyFilesRestored.Add(("file", fileId));
        return Task.CompletedTask;
    }

    public Task RestoreMyFileFolderAsync(string folderId, CancellationToken cancellationToken)
    {
        if (MyFilesTrashRestoreException is not null)
        {
            return Task.FromException(MyFilesTrashRestoreException);
        }

        MyFilesRestored.Add(("folder", folderId));
        return Task.CompletedTask;
    }

    public Task PurgeMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        if (MyFilesTrashPurgeException is not null)
        {
            return Task.FromException(MyFilesTrashPurgeException);
        }

        MyFilesPurged.Add(("file", fileId));
        return Task.CompletedTask;
    }

    public Task PurgeMyFileFolderAsync(string folderId, CancellationToken cancellationToken)
    {
        if (MyFilesTrashPurgeException is not null)
        {
            return Task.FromException(MyFilesTrashPurgeException);
        }

        MyFilesPurged.Add(("folder", folderId));
        return Task.CompletedTask;
    }

    public Task<HubMyFileQuota> GetMyFilesQuotaAsync(CancellationToken cancellationToken)
    {
        MyFilesQuotaCallCount++;
        if (MyFilesQuotaException is not null)
        {
            return Task.FromException<HubMyFileQuota>(MyFilesQuotaException);
        }

        return Task.FromResult(MyFilesQuota ?? new HubMyFileQuota());
    }

    public Task<HubMyFileItem> CopyMyFileAsync(
        string fileId,
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        if (MyFilesCopyException is not null)
        {
            return Task.FromException<HubMyFileItem>(MyFilesCopyException);
        }

        MyFilesCopied.Add((fileId, folderId, libraryId));
        return Task.FromResult(MyFilesCopyResult ?? new HubMyFileItem
        {
            Id = "copy-" + MyFilesCopied.Count,
            OriginalFileName = "копия.bin",
            Status = "ready",
        });
    }

    public async Task<string> DownloadMyFileFolderArchiveAsync(
        string folderId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        if (MyFilesArchiveException is not null)
        {
            throw MyFilesArchiveException;
        }

        MyFilesArchiveCalls.Add(folderId);
        var bytes = MyFilesArchiveBytes ?? [];
        await destination.WriteAsync(bytes, cancellationToken);
        return MyFilesArchiveName ?? string.Empty;
    }

    public Task<HubMyFilePreview> GetMyFilePreviewAsync(
        string fileId,
        CancellationToken cancellationToken)
    {
        MyFilesPreviewCalls.Add(fileId);
        if (MyFilesPreviewException is not null)
        {
            return Task.FromException<HubMyFilePreview>(MyFilesPreviewException);
        }

        return Task.FromResult(MyFilesPreview ?? new HubMyFilePreview { PreviewKind = "image" });
    }

    public async Task<string> DownloadMyFilePreviewContentAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        MyFilesPreviewContentCalls.Add(fileId);
        if (MyFilesPreviewContentException is not null)
        {
            throw MyFilesPreviewContentException;
        }

        var bytes = MyFilesPreviewContentBytes ?? [];
        await destination.WriteAsync(bytes, cancellationToken);
        return MyFilesPreviewContentType ?? "image/png";
    }

    // ---- Мои файлы: управление библиотеками ----

    public Exception? MyFilesLibraryCreateException { get; set; }
    public HubMyFileLibrary? MyFilesLibraryCreateResult { get; set; }
    public List<(string Name, long QuotaBytes)> MyFilesLibraryCreated { get; } = [];
    public Exception? MyFilesLibraryUpdateException { get; set; }
    public HubMyFileLibrary? MyFilesLibraryUpdateResult { get; set; }
    public List<(string Id, string? Name, long? QuotaBytes)> MyFilesLibraryUpdated { get; } = [];
    public Exception? MyFilesLibraryDeleteException { get; set; }
    public List<string> MyFilesLibraryDeleted { get; } = [];
    public Exception? MyFilesLibraryMembersException { get; set; }
    public Func<string, HubMyFileLibraryMembers>? MyFilesLibraryMembersFactory { get; set; }
    public HubMyFileLibraryMembers? MyFilesLibraryMembers { get; set; }
    public List<string> MyFilesLibraryMembersCalls { get; } = [];
    public Exception? MyFilesLibraryMembersSetException { get; set; }
    public Func<string, IReadOnlyList<HubMyFileLibraryMemberInput>, HubMyFileLibraryMembers>?
        MyFilesLibraryMembersSetResponder { get; set; }
    public List<(string Id, IReadOnlyList<HubMyFileLibraryMemberInput> Members)>
        MyFilesLibraryMembersSet { get; } = [];
    public Exception? MyFilesOfficeGroupsException { get; set; }
    public IReadOnlyList<HubMyFileOfficeGroup>? MyFilesOfficeGroups { get; set; }

    public Task<HubMyFileLibrary> CreateMyFileLibraryAsync(
        string name,
        long quotaBytes,
        CancellationToken cancellationToken)
    {
        if (MyFilesLibraryCreateException is not null)
        {
            return Task.FromException<HubMyFileLibrary>(MyFilesLibraryCreateException);
        }

        MyFilesLibraryCreated.Add((name, quotaBytes));
        return Task.FromResult(MyFilesLibraryCreateResult ?? new HubMyFileLibrary
        {
            Id = "lib-new-" + MyFilesLibraryCreated.Count,
            Name = name,
            QuotaBytes = quotaBytes,
            MyRole = "manage",
        });
    }

    public Task<HubMyFileLibrary> UpdateMyFileLibraryAsync(
        string libraryId,
        string? name,
        long? quotaBytes,
        CancellationToken cancellationToken)
    {
        if (MyFilesLibraryUpdateException is not null)
        {
            return Task.FromException<HubMyFileLibrary>(MyFilesLibraryUpdateException);
        }

        MyFilesLibraryUpdated.Add((libraryId, name, quotaBytes));
        var original = MyFileLibraries?.Items?.FirstOrDefault(
            library => string.Equals(library.Id?.Trim(), libraryId.Trim(), StringComparison.Ordinal))
            ?? new HubMyFileLibrary { Id = libraryId };
        return Task.FromResult(MyFilesLibraryUpdateResult ?? original with
        {
            Name = name ?? original.Name,
            QuotaBytes = quotaBytes ?? original.QuotaBytes,
        });
    }

    public Task DeleteMyFileLibraryAsync(string libraryId, CancellationToken cancellationToken)
    {
        if (MyFilesLibraryDeleteException is not null)
        {
            return Task.FromException(MyFilesLibraryDeleteException);
        }

        MyFilesLibraryDeleted.Add(libraryId);
        return Task.CompletedTask;
    }

    public Task<HubMyFileLibraryMembers> GetMyFileLibraryMembersAsync(
        string libraryId,
        CancellationToken cancellationToken)
    {
        MyFilesLibraryMembersCalls.Add(libraryId);
        if (MyFilesLibraryMembersException is not null)
        {
            return Task.FromException<HubMyFileLibraryMembers>(MyFilesLibraryMembersException);
        }

        return Task.FromResult(
            MyFilesLibraryMembersFactory?.Invoke(libraryId)
            ?? MyFilesLibraryMembers
            ?? new HubMyFileLibraryMembers { Items = [] });
    }

    public Task<HubMyFileLibraryMembers> SetMyFileLibraryMembersAsync(
        string libraryId,
        IReadOnlyList<HubMyFileLibraryMemberInput> members,
        CancellationToken cancellationToken)
    {
        if (MyFilesLibraryMembersSetException is not null)
        {
            return Task.FromException<HubMyFileLibraryMembers>(MyFilesLibraryMembersSetException);
        }

        MyFilesLibraryMembersSet.Add((libraryId, members));
        return Task.FromResult(
            MyFilesLibraryMembersSetResponder?.Invoke(libraryId, members)
            ?? new HubMyFileLibraryMembers
            {
                Items = members.Select(m => new HubMyFileLibraryMember
                {
                    PrincipalType = m.PrincipalType,
                    PrincipalId = m.PrincipalId,
                    Role = m.Role,
                }).ToList(),
            });
    }

    public Task<IReadOnlyList<HubMyFileOfficeGroup>> GetMyFileOfficeGroupsAsync(
        CancellationToken cancellationToken)
    {
        if (MyFilesOfficeGroupsException is not null)
        {
            return Task.FromException<IReadOnlyList<HubMyFileOfficeGroup>>(MyFilesOfficeGroupsException);
        }

        return Task.FromResult(MyFilesOfficeGroups ?? (IReadOnlyList<HubMyFileOfficeGroup>)[]);
    }

    // ---- Обратная связь ----

    public Exception? FeedbackCreateException { get; set; }
    public List<HubFeedbackCreate> FeedbackCreated { get; } = [];
    public Func<HubFeedbackCreate, HubFeedbackSuggestion>? FeedbackCreateResponder { get; set; }
    public Exception? MyFeedbackException { get; set; }
    public HubMyFeedbackPage? MyFeedbackPage { get; set; }
    public int MyFeedbackCallCount { get; private set; }
    public Exception? UpdateFeedbackException { get; set; }
    public List<(string Id, string? Status, string? AdminNote)> FeedbackUpdated { get; } = [];
    public Func<string, string?, string?, HubAdminFeedbackItem>? UpdateFeedbackResponder { get; set; }

    public Task<HubFeedbackSuggestion> CreateFeedbackAsync(
        HubFeedbackCreate request,
        CancellationToken cancellationToken)
    {
        if (FeedbackCreateException is not null)
        {
            return Task.FromException<HubFeedbackSuggestion>(FeedbackCreateException);
        }

        FeedbackCreated.Add(request);
        return Task.FromResult(
            FeedbackCreateResponder?.Invoke(request)
            ?? new HubFeedbackSuggestion
            {
                Id = "fb-new-" + FeedbackCreated.Count,
                Category = request.Category,
                Title = request.Title,
                Message = request.Message,
                Section = request.Section,
                Status = "new",
            });
    }

    public Task<HubMyFeedbackPage> GetMyFeedbackAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        MyFeedbackCallCount++;
        if (MyFeedbackException is not null)
        {
            return Task.FromException<HubMyFeedbackPage>(MyFeedbackException);
        }

        return Task.FromResult(
            MyFeedbackPage ?? new HubMyFeedbackPage { Items = [], Total = 0 });
    }

    public Task<HubAdminFeedbackItem> UpdateFeedbackAsync(
        string itemId,
        string? status,
        string? adminNote,
        CancellationToken cancellationToken)
    {
        if (UpdateFeedbackException is not null)
        {
            return Task.FromException<HubAdminFeedbackItem>(UpdateFeedbackException);
        }

        FeedbackUpdated.Add((itemId, status, adminNote));
        var original = AdminFeedbackPage.Items?.FirstOrDefault(
            item => string.Equals(item.Id?.Trim(), itemId.Trim(), StringComparison.Ordinal))
            ?? new HubAdminFeedbackItem { Id = itemId };
        return Task.FromResult(
            UpdateFeedbackResponder?.Invoke(itemId, status, adminNote)
            ?? original with
            {
                Status = status ?? original.Status,
                AdminNote = adminNote ?? original.AdminNote,
            });
    }
    // ---- Админка заявок (tickets admin) ----

    public List<HubTicketObjectUpsert> CreatedTicketObjects { get; } = [];
    public List<(long Id, HubTicketObjectUpsert Request)> UpdatedTicketObjects { get; } = [];
    public Exception? TicketObjectMutationException { get; set; }

    public Task<HubTicketObjectList> GetTicketObjectsAsync(bool includeInactive, CancellationToken cancellationToken)
        => TicketObjectsException is not null
            ? Task.FromException<HubTicketObjectList>(TicketObjectsException)
            : Task.FromResult(TicketObjects);

    public Task<HubTicketObject> CreateTicketObjectAsync(HubTicketObjectUpsert request, CancellationToken cancellationToken)
    {
        if (TicketObjectMutationException is not null)
        {
            return Task.FromException<HubTicketObject>(TicketObjectMutationException);
        }

        CreatedTicketObjects.Add(request);
        var created = new HubTicketObject { Id = TicketObjects.Items?.Count + 1 ?? 1, Name = request.Name };
        return Task.FromResult(created);
    }

    public Task<HubTicketObject> UpdateTicketObjectAsync(long objectId, HubTicketObjectUpsert request, CancellationToken cancellationToken)
    {
        if (TicketObjectMutationException is not null)
        {
            return Task.FromException<HubTicketObject>(TicketObjectMutationException);
        }

        UpdatedTicketObjects.Add((objectId, request));
        var original = TicketObjects.Items?.FirstOrDefault(item => item.Id == objectId)
            ?? new HubTicketObject { Id = objectId };
        return Task.FromResult(original with { Name = request.Name ?? original.Name });
    }

    public HubTicketEmployeeDetail TicketEmployeeDetail { get; set; } = new();
    public List<HubTicketEmployeeUpsert> CreatedTicketEmployees { get; } = [];
    public List<(long Id, HubTicketEmployeeUpsert Request)> UpdatedTicketEmployees { get; } = [];
    public Exception? TicketEmployeeDetailException { get; set; }
    public Exception? TicketEmployeeMutationException { get; set; }

    public Task<HubTicketEmployeeDetail> GetTicketEmployeeAsync(long employeeId, CancellationToken cancellationToken)
        => TicketEmployeeDetailException is not null
            ? Task.FromException<HubTicketEmployeeDetail>(TicketEmployeeDetailException)
            : Task.FromResult(TicketEmployeeDetail);

    public Task<HubTicketEmployeeDetail> CreateTicketEmployeeAsync(HubTicketEmployeeUpsert request, CancellationToken cancellationToken)
    {
        if (TicketEmployeeMutationException is not null)
        {
            return Task.FromException<HubTicketEmployeeDetail>(TicketEmployeeMutationException);
        }

        CreatedTicketEmployees.Add(request);
        return Task.FromResult(TicketEmployeeDetail);
    }

    public Task<HubTicketEmployeeDetail> UpdateTicketEmployeeAsync(long employeeId, HubTicketEmployeeUpsert request, CancellationToken cancellationToken)
    {
        if (TicketEmployeeMutationException is not null)
        {
            return Task.FromException<HubTicketEmployeeDetail>(TicketEmployeeMutationException);
        }

        UpdatedTicketEmployees.Add((employeeId, request));
        return Task.FromResult(TicketEmployeeDetail);
    }

    public HubTicketImportJob? UploadedTicketImport { get; set; }
    public HubTicketImportPreview? TicketImportPreview { get; set; }
    public HubTicketImportResult? TicketImportResult { get; set; }
    public Exception? TicketImportException { get; set; }
    public string? LastTicketImportFileName { get; private set; }
    public string? LastTicketImportJobId { get; private set; }

    public Task<HubTicketImportJob> UploadTicketImportAsync(string fileName, Stream content, CancellationToken cancellationToken)
    {
        LastTicketImportFileName = fileName;
        return TicketImportException is not null
            ? Task.FromException<HubTicketImportJob>(TicketImportException)
            : Task.FromResult(UploadedTicketImport ?? new HubTicketImportJob { Id = "job-1" });
    }

    public Task<HubTicketImportPreview> GetTicketImportPreviewAsync(string jobId, CancellationToken cancellationToken)
    {
        LastTicketImportJobId = jobId;
        return TicketImportException is not null
            ? Task.FromException<HubTicketImportPreview>(TicketImportException)
            : Task.FromResult(TicketImportPreview ?? new HubTicketImportPreview());
    }

    public Task<HubTicketImportResult> ExecuteTicketImportAsync(string jobId, HubTicketImportExecute request, CancellationToken cancellationToken)
    {
        LastTicketImportJobId = jobId;
        return TicketImportException is not null
            ? Task.FromException<HubTicketImportResult>(TicketImportException)
            : Task.FromResult(TicketImportResult ?? new HubTicketImportResult());
    }

    public HubTicketFinancialOpPage TicketFinancialOpsPage { get; set; } = new() { Items = [] };
    public List<HubTicketFinancialOpUpsert> CreatedTicketFinancialOps { get; } = [];
    public List<(long Id, HubTicketFinancialOpUpsert Request)> UpdatedTicketFinancialOps { get; } = [];
    public List<long> DeletedTicketFinancialOps { get; } = [];
    public Exception? TicketFinancialOpsException { get; set; }
    public Exception? TicketFinancialOpMutationException { get; set; }
    public HubTicketFinOpQuery? LastTicketFinOpQuery { get; private set; }

    public Task<HubTicketFinancialOpPage> GetTicketFinancialOpsAsync(HubTicketFinOpQuery query, CancellationToken cancellationToken)
    {
        LastTicketFinOpQuery = query;
        return TicketFinancialOpsException is not null
            ? Task.FromException<HubTicketFinancialOpPage>(TicketFinancialOpsException)
            : Task.FromResult(TicketFinancialOpsPage);
    }

    public Task<HubTicketFinancialOp> CreateTicketFinancialOpAsync(HubTicketFinancialOpUpsert request, CancellationToken cancellationToken)
    {
        if (TicketFinancialOpMutationException is not null)
        {
            return Task.FromException<HubTicketFinancialOp>(TicketFinancialOpMutationException);
        }

        CreatedTicketFinancialOps.Add(request);
        return Task.FromResult(new HubTicketFinancialOp { Id = CreatedTicketFinancialOps.Count });
    }

    public Task<HubTicketFinancialOp> UpdateTicketFinancialOpAsync(long opId, HubTicketFinancialOpUpsert request, CancellationToken cancellationToken)
    {
        if (TicketFinancialOpMutationException is not null)
        {
            return Task.FromException<HubTicketFinancialOp>(TicketFinancialOpMutationException);
        }

        UpdatedTicketFinancialOps.Add((opId, request));
        return Task.FromResult(new HubTicketFinancialOp { Id = opId });
    }

    public Task DeleteTicketFinancialOpAsync(long opId, CancellationToken cancellationToken)
    {
        if (TicketFinancialOpMutationException is not null)
        {
            return Task.FromException(TicketFinancialOpMutationException);
        }

        DeletedTicketFinancialOps.Add(opId);
        return Task.CompletedTask;
    }

    public HubTicketLossReport TicketLossesReport { get; set; } = new();
    public Exception? TicketLossesException { get; set; }
    public HubTicketLossesQuery? LastTicketLossesQuery { get; private set; }
    public List<string> TicketExports { get; } = [];

    public Task<HubTicketLossReport> GetTicketLossesReportAsync(HubTicketLossesQuery query, CancellationToken cancellationToken)
    {
        LastTicketLossesQuery = query;
        return TicketLossesException is not null
            ? Task.FromException<HubTicketLossReport>(TicketLossesException)
            : Task.FromResult(TicketLossesReport);
    }

    public async Task<string> ExportTicketLossesAsync(HubTicketLossesQuery query, Stream destination, CancellationToken cancellationToken)
    {
        if (TicketLossesException is not null)
        {
            throw TicketLossesException;
        }

        var fileName = "ticket-losses.xlsx";
        TicketExports.Add(fileName);
        var bytes = System.Text.Encoding.UTF8.GetBytes("demo");
        await destination.WriteAsync(bytes, cancellationToken);
        return fileName;
    }

    public async Task<string> ExportTicketRequestsAsync(HubTicketQuery query, Stream destination, CancellationToken cancellationToken)
    {
        if (TicketLossesException is not null)
        {
            throw TicketLossesException;
        }

        var fileName = "ticket-requests.xlsx";
        TicketExports.Add(fileName);
        var bytes = System.Text.Encoding.UTF8.GetBytes("demo");
        await destination.WriteAsync(bytes, cancellationToken);
        return fileName;
    }

    public HubTicketNotificationRuleList TicketNotificationRules { get; set; } = new() { Items = [] };
    public List<(long Id, HubTicketNotificationRulePatch Patch)> UpdatedTicketNotificationRules { get; } = [];
    public Exception? TicketNotificationRulesException { get; set; }

    public Task<HubTicketNotificationRuleList> GetTicketNotificationRulesAsync(CancellationToken cancellationToken)
        => TicketNotificationRulesException is not null
            ? Task.FromException<HubTicketNotificationRuleList>(TicketNotificationRulesException)
            : Task.FromResult(TicketNotificationRules);

    public Task<HubTicketNotificationRule> UpdateTicketNotificationRuleAsync(long ruleId, HubTicketNotificationRulePatch patch, CancellationToken cancellationToken)
    {
        if (TicketNotificationRulesException is not null)
        {
            return Task.FromException<HubTicketNotificationRule>(TicketNotificationRulesException);
        }

        UpdatedTicketNotificationRules.Add((ruleId, patch));
        var original = TicketNotificationRules.Items?.FirstOrDefault(item => item.Id == ruleId)
            ?? new HubTicketNotificationRule { Id = ruleId };
        return Task.FromResult(original);
    }

    public HubTicketPendingNotificationList TicketPendingNotifications { get; set; } = new() { Items = [] };
    public List<string> DismissedTicketNotifications { get; } = [];

    public Task<HubTicketPendingNotificationList> GetTicketPendingNotificationsAsync(CancellationToken cancellationToken)
        => Task.FromResult(TicketPendingNotifications);

    public Task DismissTicketNotificationAsync(string notificationId, CancellationToken cancellationToken)
    {
        DismissedTicketNotifications.Add(notificationId);
        return Task.CompletedTask;
    }
}