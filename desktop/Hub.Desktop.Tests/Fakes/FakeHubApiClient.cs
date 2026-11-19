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

    // Отсутствия
    public Exception? AbsencesException { get; set; }
    public HubAbsenceRangeList AbsencesList { get; set; } = new() { Items = [], ZupItems = [] };
    public string? LastAbsencesOn { get; private set; }
    public string? LastAbsencesStartsOn { get; private set; }
    public string? LastAbsencesEndsOn { get; private set; }

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

    public Task<HubAbsenceRangeList> GetAbsencesAsync(
        string? on,
        string? startsOn,
        string? endsOn,
        int limit,
        CancellationToken cancellationToken)
    {
        LastAbsencesOn = on;
        LastAbsencesStartsOn = startsOn;
        LastAbsencesEndsOn = endsOn;
        if (AbsencesException is not null)
        {
            return Task.FromException<HubAbsenceRangeList>(AbsencesException);
        }

        return Task.FromResult(AbsencesList);
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

        return Task.FromResult(MailMessagesPageFactory?.Invoke(query) ?? MailMessagesPage);
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

        return Task.FromResult(ChatMessages);
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

    public Task LogoutAsync(CancellationToken cancellationToken)
    {
        CurrentSession = null;
        return Task.CompletedTask;
    }
}
