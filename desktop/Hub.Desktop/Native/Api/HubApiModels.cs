using System.Globalization;
using System.Net;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// Bearer-сессия нативного клиента. Контракт совпадает с mobile-hub (Expo):
/// токены в JSON-ответе login/refresh, заголовки X-Auth-Client: mobile + X-Client-Device-ID.
/// </summary>
public sealed record NativeSession(
    string AccessToken,
    string RefreshToken,
    string ClientDeviceId,
    DateTimeOffset AccessTokenExpiresAtUtc,
    long UserId,
    string UserName,
    string FullName);

public sealed record HubUser
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("role")] public string? Role { get; init; }
    /// <summary>Эффективные права из /auth/me (computers.read_all и пр.).</summary>
    [JsonPropertyName("permissions")] public IReadOnlyList<string>? Permissions { get; init; }
    [JsonPropertyName("avatar_url")] public string? AvatarUrl { get; init; }
    [JsonPropertyName("is_2fa_enabled")] public bool IsTwoFactorEnabled { get; init; }
    [JsonPropertyName("twofa_policy")] public string? TwoFactorPolicy { get; init; }
    [JsonPropertyName("twofa_enforced")] public bool TwoFactorEnforced { get; init; }
    [JsonPropertyName("network_zone")] public string? NetworkZone { get; init; }
    [JsonPropertyName("trusted_devices_count")] public int TrustedDevicesCount { get; init; }
}

public enum HubLoginStatus
{
    Authenticated,
    TwoFactorRequired,
    TwoFactorSetupRequired,
}

/// <summary>
/// Результат POST /api/v1/auth/login и verify-2fa-login.
/// Токены заполнены только при Status == Authenticated.
/// </summary>
public sealed record HubLoginResult(
    HubLoginStatus Status,
    NativeSession? Session,
    string? LoginChallengeId,
    IReadOnlyList<string> AvailableSecondFactors);

public enum HubTaskTransition
{
    Start,
    Reopen,
    Submit,
    Complete,
    Approve,
    Reject,
}

/// <summary>
/// Query для GET /api/v1/hub/tasks (scope=my, role_scope=both — константы клиента).
/// </summary>
public sealed record HubTaskQuery
{
    /// <summary>csv-статусы: new|in_progress|review|done. Null — все.</summary>
    public string? Status { get; init; }
    public string? Search { get; init; }
    public string? DueState { get; init; }
    public string SortBy { get; init; } = "status";
    public string SortDir { get; init; } = "asc";
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

public record HubTaskItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description_preview")] public string? DescriptionPreview { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("priority")] public string? Priority { get; init; }
    [JsonPropertyName("due_at")] public DateTimeOffset? DueAt { get; init; }
    [JsonPropertyName("is_overdue")] public bool IsOverdue { get; init; }
    [JsonPropertyName("assignee_user_id")] public long? AssigneeUserId { get; init; }
    [JsonPropertyName("assignee_full_name")] public string? AssigneeFullName { get; init; }
    [JsonPropertyName("controller_full_name")] public string? ControllerFullName { get; init; }
    [JsonPropertyName("created_by_full_name")] public string? CreatedByFullName { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("department_name")] public string? DepartmentName { get; init; }
    [JsonPropertyName("project_name")] public string? ProjectName { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
    [JsonPropertyName("subtasks_total")] public int SubtasksTotal { get; init; }
    [JsonPropertyName("subtasks_done")] public int SubtasksDone { get; init; }
    [JsonPropertyName("attachments_count")] public int AttachmentsCount { get; init; }
    [JsonPropertyName("comments_unread")] public int CommentsUnread { get; init; }
    /// <summary>Всего комментариев — summary задачи (comments_count backend'а).</summary>
    [JsonPropertyName("comments_count")] public int CommentsCount { get; init; }
    /// <summary>Есть комментарии, не прочитанные текущим пользователем.</summary>
    [JsonPropertyName("has_unread_comments")] public bool HasUnreadComments { get; init; }
    [JsonPropertyName("parent_task_id")] public long? ParentTaskId { get; init; }
}

public sealed record HubTaskListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
}

/// <summary>Права на действия из detail-ответа (capabilities).</summary>
public sealed record HubTaskCapabilities
{
    [JsonPropertyName("can_start")] public bool CanStart { get; init; }
    [JsonPropertyName("can_submit")] public bool CanSubmit { get; init; }
    [JsonPropertyName("can_review")] public bool CanReview { get; init; }
    [JsonPropertyName("can_close")] public bool CanClose { get; init; }
    [JsonPropertyName("can_reopen")] public bool CanReopen { get; init; }
    [JsonPropertyName("can_upload_files")] public bool CanUploadFiles { get; init; }
    /// <summary>Флаг TASK_DISCUSSION_CHAT: обсуждение задачи живёт в корпоративном чате.</summary>
    [JsonPropertyName("can_open_discussion")] public bool CanOpenDiscussion { get; init; }
    /// <summary>Участник родителя, не-done и не подзадача — можно POST …/subtasks.</summary>
    [JsonPropertyName("can_create_subtask")] public bool CanCreateSubtask { get; init; }
}

public sealed record HubTaskDetail : HubTaskItem
{
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("capabilities")] public HubTaskCapabilities? Capabilities { get; init; }
    [JsonPropertyName("comments_total")] public int CommentsTotal { get; init; }
    [JsonPropertyName("checklist_total")] public int ChecklistTotal { get; init; }
    [JsonPropertyName("checklist_done")] public int ChecklistDone { get; init; }
    [JsonPropertyName("status_log")] public IReadOnlyList<HubTaskStatusLogEntry>? StatusLog { get; init; }
    /// <summary>Вложения задачи (scope=task) и отчётные файлы — приходят внутри detail.</summary>
    [JsonPropertyName("attachments")] public IReadOnlyList<HubTaskAttachment>? Attachments { get; init; }
    /// <summary>Родительская задача, если это подзадача (detail.parent).</summary>
    [JsonPropertyName("parent")] public HubTaskParentLink? Parent { get; init; }
    /// <summary>Подзадачи первого уровня, видимые текущему пользователю (detail.subtasks).</summary>
    [JsonPropertyName("subtasks")] public IReadOnlyList<HubSubtaskItem>? Subtasks { get; init; }
}

/// <summary>Ссылка на родителя подзадачи в detail (parent: id + can_view + title/status когда можно смотреть).</summary>
public sealed record HubTaskParentLink
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("can_view")] public bool CanView { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

/// <summary>Строка подзадачи в detail родителя (detail.subtasks[]): id + поля списка.</summary>
public sealed record HubSubtaskItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("priority")] public string? Priority { get; init; }
    [JsonPropertyName("due_at")] public DateTimeOffset? DueAt { get; init; }
    [JsonPropertyName("is_overdue")] public bool IsOverdue { get; init; }
    [JsonPropertyName("assignee_user_id")] public long? AssigneeUserId { get; init; }
    [JsonPropertyName("assignee_full_name")] public string? AssigneeFullName { get; init; }
    [JsonPropertyName("created_by_user_id")] public long? CreatedByUserId { get; init; }
}

public sealed record HubTaskStatusLogEntry
{
    [JsonPropertyName("old_status")] public string? OldStatus { get; init; }
    [JsonPropertyName("new_status")] public string? NewStatus { get; init; }
    [JsonPropertyName("changed_by_full_name")] public string? ChangedByFullName { get; init; }
    [JsonPropertyName("changed_at")] public DateTimeOffset? ChangedAt { get; init; }
}

/// <summary>Запись архивной ленты hub_task_comments (id/task_id — TEXT на backend).</summary>
public sealed record HubTaskComment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("task_id")] public string? TaskId { get; init; }
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
}

/// <summary>Ответ GET /hub/tasks/{id}/comments — {"items": [...]} старые первыми.</summary>
public sealed record HubTaskCommentList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskComment>? Items { get; init; }
}

/// <summary>
/// Вложение задачи из detail/POST-ответа. scope: task — пользовательский файл
/// (удаляется), report/generated — отчётные, backend их удалить не даёт.
/// </summary>
public sealed record HubTaskAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("task_id")] public string? TaskId { get; init; }
    [JsonPropertyName("scope")] public string? Scope { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("file_mime")] public string? FileMime { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("uploaded_by_user_id")] public long UploadedByUserId { get; init; }
    [JsonPropertyName("uploaded_by_username")] public string? UploadedByUsername { get; init; }
    [JsonPropertyName("uploaded_at")] public DateTimeOffset? UploadedAt { get; init; }
}

/// <summary>Ответ GET/POST /hub/tasks/{id}/discussion — ссылка на чат-разговор (kind=task).</summary>
public sealed record HubTaskDiscussion
{
    /// <summary>Может быть null у GET, когда разговор ещё не создан.</summary>
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("created")] public bool Created { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("task_id")] public string? TaskId { get; init; }
    [JsonPropertyName("task_title")] public string? TaskTitle { get; init; }
    [JsonPropertyName("task_status")] public string? TaskStatus { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
}

/// <summary>
/// Тело POST /hub/tasks — создание задачи верхнего уровня.
/// На backend обязательны title (≥3), ≥1 исполнитель и project_id;
/// object_id должен принадлежать выбранному проекту. Неоправленные поля опускаем
/// (null → отсутствие ключа) — сервер применяет свои дефолты.
/// </summary>
public sealed record HubTaskCreateRequest
{
    /// <summary>Заголовок, backend требует минимум 3 символа после trim.</summary>
    [JsonPropertyName("title")] public string Title { get; init; } = string.Empty;
    [JsonPropertyName("description")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; init; }
    /// <summary>Исполнители (assignee_user_ids[]); desktop-форма выбирает одного.</summary>
    [JsonPropertyName("assignee_user_ids")] public IReadOnlyList<long> AssigneeUserIds { get; init; } = [];
    /// <summary>Контролёр (int); null/0 на сервере — «без контролёра».</summary>
    [JsonPropertyName("controller_user_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? ControllerUserId { get; init; }
    /// <summary>Дедлайн «yyyy-MM-ddTHH:mm» локальный naive — формат datetime-local веб-формы.</summary>
    [JsonPropertyName("due_at")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DueAt { get; init; }
    /// <summary>low|normal|high|urgent; невалидное backend заменяет на normal.</summary>
    [JsonPropertyName("priority")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Priority { get; init; }
    /// <summary>Проект (TEXT-uuid). Backend: «project_id is required».</summary>
    [JsonPropertyName("project_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ProjectId { get; init; }
    /// <summary>Объект проекта; если задан без project_id — проект выводится из объекта.</summary>
    [JsonPropertyName("object_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ObjectId { get; init; }
    /// <summary>Дата протокола «yyyy-MM-dd»; без неё backend ставит сегодня.</summary>
    [JsonPropertyName("protocol_date")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ProtocolDate { get; init; }
}

/// <summary>Ответ POST /hub/tasks — {items:[созданные…], created:N} (+failed/partial при separate).</summary>
public sealed record HubTaskCreateResult
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskItem>? Items { get; init; }
    [JsonPropertyName("created")] public int Created { get; init; }
}

/// <summary>
/// Тело POST /hub/tasks/{id}/subtasks — подзадача участником родителя.
/// Проект/объект/подразделение/видимость наследуются от родителя, контролёр —
/// тоже (можно переопределить); минимум: title + assignee_user_ids.
/// </summary>
public sealed record HubTaskSubtaskCreateRequest
{
    [JsonPropertyName("title")] public string Title { get; init; } = string.Empty;
    [JsonPropertyName("description")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; init; }
    [JsonPropertyName("assignee_user_ids")] public IReadOnlyList<long> AssigneeUserIds { get; init; } = [];
    /// <summary>«yyyy-MM-ddTHH:mm» локальный naive — как у задачи верхнего уровня.</summary>
    [JsonPropertyName("due_at")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DueAt { get; init; }
    [JsonPropertyName("priority")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Priority { get; init; }
}

/// <summary>Сотрудник из справочника задач: GET /hub/users/assignees и /users/controllers.</summary>
public sealed record HubTaskUserItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("role")] public string? Role { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_id")] public string? DepartmentId { get; init; }
}

/// <summary>Ответ /hub/users/assignees — {items,total,limit}; /users/controllers — только items.</summary>
public sealed record HubTaskUserList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskUserItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
}

/// <summary>Проект задач из GET /hub/task-projects (id — TEXT uuid).</summary>
public sealed record HubTaskProject
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
}

/// <summary>Ответ GET /hub/task-projects — {items:[…]}.</summary>
public sealed record HubTaskProjectList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskProject>? Items { get; init; }
}

/// <summary>Объект проекта из GET /hub/task-objects (id/project_id — TEXT uuid).</summary>
public sealed record HubTaskObject
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("project_id")] public string? ProjectId { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
}

/// <summary>Ответ GET /hub/task-objects — {items:[…]}.</summary>
public sealed record HubTaskObjectList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskObject>? Items { get; init; }
}

/// <summary>
/// Query для GET /hub/tasks/analytics и /hub/tasks/analytics/export
/// (backend hub.py: start_date/end_date yyyy-MM-dd, date_basis
/// protocol_date|completed_at|due_at; списки — повторяющиеся параметры
/// project_id/object_id/participant_user_id).
/// </summary>
public sealed record HubTaskAnalyticsQuery
{
    public string? StartDate { get; init; }
    public string? EndDate { get; init; }
    public string DateBasis { get; init; } = "protocol_date";
    public IReadOnlyList<string>? ProjectIds { get; init; }
    public IReadOnlyList<string>? ObjectIds { get; init; }
    public IReadOnlyList<long>? ParticipantUserIds { get; init; }
}

/// <summary>
/// Набор метрик summary и строк разрезов аналитики задач
/// (hub_service._summary_metrics_from_row; проценты сервер считает сам).
/// </summary>
public record HubTaskAnalyticsMetrics
{
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("new")] public int New { get; init; }
    [JsonPropertyName("in_progress")] public int InProgress { get; init; }
    [JsonPropertyName("review")] public int Review { get; init; }
    [JsonPropertyName("done")] public int Done { get; init; }
    [JsonPropertyName("open")] public int Open { get; init; }
    [JsonPropertyName("done_on_time")] public int DoneOnTime { get; init; }
    [JsonPropertyName("done_without_due")] public int DoneWithoutDue { get; init; }
    [JsonPropertyName("overdue")] public int Overdue { get; init; }
    [JsonPropertyName("with_due_total")] public int WithDueTotal { get; init; }
    [JsonPropertyName("completion_percent")] public double CompletionPercent { get; init; }
    [JsonPropertyName("completion_on_time_percent")] public double CompletionOnTimePercent { get; init; }
}

/// <summary>Строка разреза «по участникам» (by_participant): id + имя + метрики.</summary>
public sealed record HubTaskAnalyticsParticipant : HubTaskAnalyticsMetrics
{
    [JsonPropertyName("participant_user_id")] public long ParticipantUserId { get; init; }
    [JsonPropertyName("participant_name")] public string? ParticipantName { get; init; }
}

/// <summary>Строка разреза «по проектам» (by_project): id (TEXT uuid) + имя + метрики.</summary>
public sealed record HubTaskAnalyticsProject : HubTaskAnalyticsMetrics
{
    [JsonPropertyName("project_id")] public string? ProjectId { get; init; }
    [JsonPropertyName("project_name")] public string? ProjectName { get; init; }
}

/// <summary>Строка разреза «по объектам» (by_object): id (TEXT uuid) + имя + метрики.</summary>
public sealed record HubTaskAnalyticsObject : HubTaskAnalyticsMetrics
{
    [JsonPropertyName("object_id")] public string? ObjectId { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
}

/// <summary>Строка status_breakdown: {status, label, value}.</summary>
public sealed record HubTaskAnalyticsStatusItem
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("value")] public int Value { get; init; }
}

/// <summary>Точка динамики trend.items[]: бакет + создано/завершено/в срок.</summary>
public sealed record HubTaskAnalyticsTrendItem
{
    [JsonPropertyName("bucket_key")] public string? BucketKey { get; init; }
    [JsonPropertyName("bucket_label")] public string? BucketLabel { get; init; }
    [JsonPropertyName("created")] public int Created { get; init; }
    [JsonPropertyName("completed")] public int Completed { get; init; }
    [JsonPropertyName("completed_on_time")] public int CompletedOnTime { get; init; }
}

/// <summary>Блок trend: granularity day|week|month|quarter + упорядоченные бакеты.</summary>
public sealed record HubTaskAnalyticsTrend
{
    [JsonPropertyName("granularity")] public string? Granularity { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubTaskAnalyticsTrendItem>? Items { get; init; }
}

/// <summary>Эхо применённых фильтров (payload.filters).</summary>
public sealed record HubTaskAnalyticsAppliedFilters
{
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("date_basis")] public string? DateBasis { get; init; }
    [JsonPropertyName("project_ids")] public IReadOnlyList<string>? ProjectIds { get; init; }
    [JsonPropertyName("object_ids")] public IReadOnlyList<string>? ObjectIds { get; init; }
    [JsonPropertyName("participant_user_ids")] public IReadOnlyList<long>? ParticipantUserIds { get; init; }
}

/// <summary>
/// Ответ GET /hub/tasks/analytics (dict от hub_service.get_task_analytics —
/// не Pydantic, поля толерантны): summary, разрезы, status_breakdown, trend,
/// truncated (ACL-выборка зрителя урезана лимитом) и эхо filters.
/// </summary>
public sealed record HubTaskAnalyticsPayload
{
    [JsonPropertyName("summary")] public HubTaskAnalyticsMetrics? Summary { get; init; }
    [JsonPropertyName("by_participant")] public IReadOnlyList<HubTaskAnalyticsParticipant>? ByParticipant { get; init; }
    [JsonPropertyName("by_project")] public IReadOnlyList<HubTaskAnalyticsProject>? ByProject { get; init; }
    [JsonPropertyName("by_object")] public IReadOnlyList<HubTaskAnalyticsObject>? ByObject { get; init; }
    [JsonPropertyName("status_breakdown")] public IReadOnlyList<HubTaskAnalyticsStatusItem>? StatusBreakdown { get; init; }
    [JsonPropertyName("trend")] public HubTaskAnalyticsTrend? Trend { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("filters")] public HubTaskAnalyticsAppliedFilters? Filters { get; init; }
}

/// <summary>Ответ GET /api/v1/hub/dashboard (dict, не Pydantic — поля толерантны).</summary>
public sealed record HubDashboard
{
    [JsonPropertyName("generated_at")] public DateTimeOffset? GeneratedAt { get; init; }
    [JsonPropertyName("announcements")] public HubAnnouncementList? Announcements { get; init; }
    [JsonPropertyName("my_tasks")] public HubTaskListPage? MyTasks { get; init; }
    [JsonPropertyName("absences_today")] public HubAbsenceList? AbsencesToday { get; init; }
    [JsonPropertyName("summary")] public HubDashboardSummary? Summary { get; init; }
}

public sealed record HubDashboardSummary
{
    [JsonPropertyName("announcements_ack_pending")] public int AnnouncementsAckPending { get; init; }
    [JsonPropertyName("announcements_attention")] public int AnnouncementsAttention { get; init; }
    [JsonPropertyName("tasks_open_total")] public int TasksOpenTotal { get; init; }
    [JsonPropertyName("tasks_assignee_open")] public int TasksAssigneeOpen { get; init; }
    [JsonPropertyName("tasks_created_open")] public int TasksCreatedOpen { get; init; }
    [JsonPropertyName("tasks_controller_open")] public int TasksControllerOpen { get; init; }
    [JsonPropertyName("tasks_review_required")] public int TasksReviewRequired { get; init; }
    [JsonPropertyName("tasks_overdue")] public int TasksOverdue { get; init; }
    [JsonPropertyName("tasks_with_unread_comments")] public int TasksWithUnreadComments { get; init; }
    [JsonPropertyName("absences_today")] public int AbsencesToday { get; init; }
}

public sealed record HubAnnouncementList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncement>? Items { get; init; }
    [JsonPropertyName("unread_total")] public int UnreadTotal { get; init; }
    [JsonPropertyName("ack_pending_total")] public int AckPendingTotal { get; init; }
}

public sealed record HubAnnouncement
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("preview")] public string? Preview { get; init; }
    [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("is_ack_pending")] public bool IsAckPending { get; init; }
    [JsonPropertyName("author_full_name")] public string? AuthorFullName { get; init; }
}

public sealed record HubAbsenceList
{
    [JsonPropertyName("on")] public string? On { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubAbsenceItem>? Items { get; init; }
}

public sealed record HubAbsenceItem
{
    /// <summary>id записи: у ручных — число в JSON (толерантно читаем в строку), у ЗУП — «zup:code».</summary>
    [JsonPropertyName("id")]
    [JsonConverter(typeof(HubAbsenceIdConverter))]
    public string? Id { get; init; }
    [JsonPropertyName("user_id")] public long? UserId { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("kind_label")] public string? KindLabel { get; init; }
    [JsonPropertyName("starts_on")] public string? StartsOn { get; init; }
    [JsonPropertyName("ends_on")] public string? EndsOn { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
}

/// <summary>
/// id отсутствия: ручная запись приходит числом (42), ЗУП — строкой («zup:A-1»).
/// Читаем оба представления в строку; пишем всегда строкой.
/// </summary>
public sealed class HubAbsenceIdConverter : JsonConverter<string?>
{
    public override string? Read(
        ref Utf8JsonReader reader,
        Type typeToConvert,
        JsonSerializerOptions options) => reader.TokenType switch
    {
        JsonTokenType.String => reader.GetString(),
        JsonTokenType.Number => reader.GetInt64().ToString(CultureInfo.InvariantCulture),
        JsonTokenType.Null => null,
        _ => throw new JsonException($"Unexpected token {reader.TokenType} for absence id."),
    };

    public override void Write(
        Utf8JsonWriter writer,
        string? value,
        JsonSerializerOptions options)
    {
        if (value is null)
        {
            writer.WriteNullValue();
        }
        else
        {
            writer.WriteStringValue(value);
        }
    }
}

// ---- Новости: GET /hub/announcements (+ /{id}, mark-as-read, ack) ----

public sealed record HubAnnouncementQuery
{
    public string? Search { get; init; }
    public bool UnreadOnly { get; init; }
    /// <summary>Фильтр «только мои закладки» → параметр bookmarked_only.</summary>
    public bool BookmarkedOnly { get; init; }
    public int Limit { get; init; } = 30;
    public int Offset { get; init; }
    public string? SortBy { get; init; }
    public string? SortDir { get; init; }
}

/// <summary>Элемент списка/деталь новости — _build_announcement_item отдаёт dict.</summary>
public sealed record HubAnnouncementItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("preview")] public string? Preview { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("priority")] public string? Priority { get; init; }
    [JsonPropertyName("published_at")] public DateTimeOffset? PublishedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("author_full_name")] public string? AuthorFullName { get; init; }
    [JsonPropertyName("requires_ack")] public bool RequiresAck { get; init; }
    [JsonPropertyName("is_ack_pending")] public bool IsAckPending { get; init; }
    [JsonPropertyName("is_unread")] public bool IsUnread { get; init; }
    [JsonPropertyName("is_updated")] public bool IsUpdated { get; init; }
    [JsonPropertyName("is_pinned")] public bool IsPinned { get; init; }
    [JsonPropertyName("is_pinned_active")] public bool IsPinnedActive { get; init; }
    [JsonPropertyName("comments_count")] public int CommentsCount { get; init; }
    [JsonPropertyName("attachments_count")] public int AttachmentsCount { get; init; }
    [JsonPropertyName("comments_enabled")] public bool CommentsEnabled { get; init; }
    [JsonPropertyName("viewer_bookmarked")] public bool ViewerBookmarked { get; init; }
    [JsonPropertyName("reactions_enabled")] public bool ReactionsEnabled { get; init; }
    /// <summary>Счётчики реакций по типам (like/love/laugh/wow/sad/angry).</summary>
    [JsonPropertyName("reaction_counts")] public Dictionary<string, int>? ReactionCounts { get; init; }
    [JsonPropertyName("reactions_count")] public int ReactionsCount { get; init; }
    /// <summary>Реакция текущего пользователя (null — не реагировал).</summary>
    [JsonPropertyName("viewer_reaction")] public string? ViewerReaction { get; init; }
    [JsonPropertyName("viewer_has_liked")] public bool ViewerHasLiked { get; init; }
    [JsonPropertyName("likes_count")] public int LikesCount { get; init; }
    /// <summary>Опрос, прикреплённый к объявлению (опционально, только detail).</summary>
    [JsonPropertyName("poll")] public HubAnnouncementPoll? Poll { get; init; }
    /// <summary>Вложения объявления (detail; для ленты сервер может усечь список).</summary>
    [JsonPropertyName("attachments")] public IReadOnlyList<HubAnnouncementAttachment>? Attachments { get; init; }
    [JsonPropertyName("category")] public HubAnnouncementCategory? Category { get; init; }

    // ---- Поля админ-выдачи (GET /hub/announcements/manage и ответы write-роутов) ----
    /// <summary>draft|scheduled|published|archived — в manage-выдаче всегда заполнен.</summary>
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    /// <summary>Сырой category_id строки — для предзаполнения редактора (category?.id дублирует).</summary>
    [JsonPropertyName("category_id")] public string? CategoryId { get; init; }
    /// <summary>Теги новости — [{id,name,slug}] из _load_announcement_taxonomy_state.</summary>
    [JsonPropertyName("tags")] public IReadOnlyList<HubAnnouncementTag>? Tags { get; init; }
    [JsonPropertyName("author_user_id")] public long AuthorUserId { get; init; }
    [JsonPropertyName("author_username")] public string? AuthorUsername { get; init; }
    /// <summary>Может ли текущий пользователь править/публиковать (сервер: автор или модератор).</summary>
    [JsonPropertyName("can_manage")] public bool CanManage { get; init; }
    [JsonPropertyName("pinned_until")] public DateTimeOffset? PinnedUntil { get; init; }
    [JsonPropertyName("published_from")] public DateTimeOffset? PublishedFrom { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
}

public sealed record HubAnnouncementCategory
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    /// <summary>Заполнен в выдаче GET /hub/announcement-categories (у item.category — только id/name).</summary>
    [JsonPropertyName("slug")] public string? Slug { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
}

public sealed record HubAnnouncementListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("unread_total")] public int UnreadTotal { get; init; }
    [JsonPropertyName("ack_pending_total")] public int AckPendingTotal { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
}

/// <summary>Ответ PUT/DELETE /announcements/{id}/reaction и …/like.</summary>
public sealed record HubAnnouncementReactionState
{
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("viewer_reaction")] public string? ViewerReaction { get; init; }
    [JsonPropertyName("reaction_counts")] public Dictionary<string, int>? ReactionCounts { get; init; }
    [JsonPropertyName("reactions_count")] public int ReactionsCount { get; init; }
    [JsonPropertyName("viewer_has_liked")] public bool ViewerHasLiked { get; init; }
    [JsonPropertyName("likes_count")] public int LikesCount { get; init; }
}

/// <summary>Один реактор из GET /announcements/{id}/reactions.</summary>
public sealed record HubAnnouncementReactionUser
{
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("reaction_type")] public string? ReactionType { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
}

public sealed record HubAnnouncementReactionUserList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementReactionUser>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
}

/// <summary>Ответ PUT/DELETE /announcements/{id}/bookmark.</summary>
public sealed record HubAnnouncementBookmarkState
{
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("viewer_bookmarked")] public bool ViewerBookmarked { get; init; }
}

/// <summary>Вариант опроса объявления.</summary>
public sealed record HubAnnouncementPollOption
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("votes_count")] public int VotesCount { get; init; }
    [JsonPropertyName("viewer_voted")] public bool ViewerVoted { get; init; }
}

/// <summary>Опрос объявления (поле poll в detail и в ответе vote).</summary>
public sealed record HubAnnouncementPoll
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("question")] public string? Question { get; init; }
    [JsonPropertyName("allows_multiple")] public bool AllowsMultiple { get; init; }
    [JsonPropertyName("is_anonymous")] public bool IsAnonymous { get; init; }
    [JsonPropertyName("closes_at")] public DateTimeOffset? ClosesAt { get; init; }
    [JsonPropertyName("is_closed")] public bool IsClosed { get; init; }
    [JsonPropertyName("options")] public IReadOnlyList<HubAnnouncementPollOption>? Options { get; init; }
    [JsonPropertyName("viewer_option_ids")] public IReadOnlyList<string>? ViewerOptionIds { get; init; }
    [JsonPropertyName("has_voted")] public bool HasVoted { get; init; }
    [JsonPropertyName("total_votes")] public int TotalVotes { get; init; }
    [JsonPropertyName("total_voters")] public int TotalVoters { get; init; }
}

/// <summary>Ответ PUT /announcements/{id}/poll/vote — {announcement_id, poll}.</summary>
public sealed record HubAnnouncementPollVoteResult
{
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("poll")] public HubAnnouncementPoll? Poll { get; init; }
}

/// <summary>Вложение объявления (attachments[] в detail-ответе).</summary>
public sealed record HubAnnouncementAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("file_mime")] public string? FileMime { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("is_cover")] public bool IsCover { get; init; }
    [JsonPropertyName("uploaded_at")] public DateTimeOffset? UploadedAt { get; init; }
}

/// <summary>Вложение комментария объявления.</summary>
public sealed record HubAnnouncementCommentAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("comment_id")] public string? CommentId { get; init; }
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("file_mime")] public string? FileMime { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("uploaded_at")] public DateTimeOffset? UploadedAt { get; init; }
}

/// <summary>Комментарий объявления (элемент GET …/comments и ответ POST/PATCH).</summary>
public sealed record HubAnnouncementComment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("announcement_id")] public string? AnnouncementId { get; init; }
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("parent_comment_id")] public string? ParentCommentId { get; init; }
    [JsonPropertyName("root_comment_id")] public string? RootCommentId { get; init; }
    [JsonPropertyName("reply_to_user_id")] public long? ReplyToUserId { get; init; }
    [JsonPropertyName("reply_to_username")] public string? ReplyToUsername { get; init; }
    [JsonPropertyName("is_deleted")] public bool IsDeleted { get; init; }
    [JsonPropertyName("can_edit")] public bool CanEdit { get; init; }
    [JsonPropertyName("can_delete")] public bool CanDelete { get; init; }
    [JsonPropertyName("reaction_counts")] public Dictionary<string, int>? ReactionCounts { get; init; }
    [JsonPropertyName("viewer_reaction")] public string? ViewerReaction { get; init; }
    [JsonPropertyName("attachments")] public IReadOnlyList<HubAnnouncementCommentAttachment>? Attachments { get; init; }
    [JsonPropertyName("reply_count")] public int ReplyCount { get; init; }
}

/// <summary>Страница комментариев объявления (GET /announcements/{id}/comments).</summary>
public sealed record HubAnnouncementCommentPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementComment>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("comments_total")] public int CommentsTotal { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
    [JsonPropertyName("sort")] public string? Sort { get; init; }
}

/// <summary>Параметры GET /announcements/{id}/comments.</summary>
public sealed record HubAnnouncementCommentQuery
{
    /// <summary>Размер страницы (по умолчанию 30).</summary>
    public int Limit { get; init; } = 30;
    /// <summary>Смещение (offset).</summary>
    public int Offset { get; init; }
    /// <summary>Сортировка корневых: interesting/newest/oldest (дефолт сервера — interesting).</summary>
    public string? Sort { get; init; }
    /// <summary>Когда задан — ответы ветки этого корня (sort=oldest на сервере).</summary>
    public string? RootCommentId { get; init; }
}

/// <summary>Ответ PUT/DELETE /comments/{comment_id}/reaction.</summary>
public sealed record HubAnnouncementCommentReactionState
{
    [JsonPropertyName("comment_id")] public string? CommentId { get; init; }
    [JsonPropertyName("viewer_reaction")] public string? ViewerReaction { get; init; }
    [JsonPropertyName("reaction_counts")] public Dictionary<string, int>? ReactionCounts { get; init; }
}

// ---- Отсутствия: GET /hub/absences (manual + zup) ----

public sealed record HubAbsenceRangeList
{
    /// <summary>Ручные записи HUB (source="manual", числовой id для правок).</summary>
    [JsonPropertyName("items")] public IReadOnlyList<HubAbsenceItem>? Items { get; init; }

    /// <summary>Записи из ЗУП (source="zup", read-only).</summary>
    [JsonPropertyName("zup_items")] public IReadOnlyList<HubAbsenceItem>? ZupItems { get; init; }
    [JsonPropertyName("zup_count")] public int ZupCount { get; init; }
}

/// <summary>
/// Тело POST /hub/absences и PATCH /hub/absences/{id} (dict-контракт backend'а,
/// Pydantic-схемы нет). Null-поля не сериализуются: create собирает все поля,
/// PATCH — только изменённые (diff-семантика сервиса: «поле в payload» → обновить).
/// Очистка опционального поля — пустая строка (сервер normalize → null).
/// </summary>
public sealed record HubAbsenceUpsertRequest
{
    [JsonPropertyName("display_name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? DisplayName { get; init; }

    /// <summary>vacation|sick|trip|other; серверный дефолт — other.</summary>
    [JsonPropertyName("kind")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Kind { get; init; }

    /// <summary>ISO-дата yyyy-MM-dd; create — обязательна, ends_on ≥ starts_on.</summary>
    [JsonPropertyName("starts_on")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? StartsOn { get; init; }

    [JsonPropertyName("ends_on")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? EndsOn { get; init; }

    [JsonPropertyName("comment")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Comment { get; init; }

    [JsonPropertyName("department")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Department { get; init; }
}

// ---- Центр уведомлений: GET/POST /hub/notifications/* (лента колокола шелла) ----

/// <summary>
/// Элемент ленты GET /hub/notifications/poll: строка hub_notifications
/// + вычисленный сервером флаг непрочитанного (left join hub_notification_reads).
/// id/entity_id — текстовые идентификаторы (entity_id может быть «42#7»
/// для комментария новости), created_at — ISO-строка (UTC); сервер сравнивает
/// курсор since лексикографически, поэтому клиент хранит её как строку.
/// unread — целочисленный 0/1, как в веб-лентах.
/// </summary>
public sealed record HubNotificationItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("recipient_user_id")] public long? RecipientUserId { get; init; }
    [JsonPropertyName("event_type")] public string? EventType { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("entity_type")] public string? EntityType { get; init; }
    [JsonPropertyName("entity_id")] public string? EntityId { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("unread")] public int Unread { get; init; }
}

/// <summary>
/// Счётчики GET /hub/notifications/unread-counts и блок unread_counts
/// poll-ответа (сервис hub_service._compute_unread_counts). Бейдж колокола —
/// NotificationsUnreadTotal (тот же ключ, что у веб-шелла); остальные поля
/// — справочно, словарь сервера шире (task-метрики, hub_chat_ordinary).
/// </summary>
public sealed record HubNotificationUnreadCounts
{
    [JsonPropertyName("notifications_unread_total")] public int NotificationsUnreadTotal { get; init; }
    [JsonPropertyName("announcements_unread")] public int AnnouncementsUnread { get; init; }
    [JsonPropertyName("announcements_ack_pending")] public int AnnouncementsAckPending { get; init; }
}

/// <summary>
/// Ответ GET /hub/notifications/poll → {items, since, limit, unread_only,
/// unread_counts, generated_at} (dict hub_service.poll_notifications).
/// items — новые сверху (created_at DESC); при заданном since — только
/// записи строго новее курсора.
/// </summary>
public sealed record HubNotificationPoll
{
    [JsonPropertyName("items")] public IReadOnlyList<HubNotificationItem>? Items { get; init; }
    [JsonPropertyName("since")] public string? Since { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("unread_only")] public bool UnreadOnly { get; init; }
    [JsonPropertyName("unread_counts")] public HubNotificationUnreadCounts? UnreadCounts { get; init; }
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
}

/// <summary>Ответ POST /hub/notifications/{id}/read → {ok, notification_id}.</summary>
public sealed record HubNotificationReadResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("notification_id")] public string? NotificationId { get; init; }
}

/// <summary>Ответ POST /hub/notifications/read-all → {ok, marked_count}.</summary>
public sealed record HubNotificationReadAllResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("marked_count")] public int MarkedCount { get; init; }
}

// ---- Чат: /chat/conversations, /messages, ws ----

public sealed record HubChatUser
{
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("avatar_url")] public string? AvatarUrl { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("presence")] public HubChatPresence? Presence { get; init; }
}

/// <summary>
/// Вложенный presence сериализованного пользователя чата (direct_peer.presence,
/// member user.presence) и payload события chat.presence.updated.
/// </summary>
public sealed record HubChatPresence
{
    [JsonPropertyName("is_online")] public bool IsOnline { get; init; }
    [JsonPropertyName("last_seen_at")] public DateTimeOffset? LastSeenAt { get; init; }
    [JsonPropertyName("status_text")] public string? StatusText { get; init; }
}

public sealed record HubChatUserList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatUser>? Items { get; init; }
}

/// <summary>ChatConversationSummary.</summary>
public record HubChatConversation
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("avatar_url")] public string? AvatarUrl { get; init; }
    [JsonPropertyName("last_message_preview")] public string? LastMessagePreview { get; init; }
    [JsonPropertyName("last_message_at")] public DateTimeOffset? LastMessageAt { get; init; }
    [JsonPropertyName("last_message_is_own")] public bool LastMessageIsOwn { get; init; }
    [JsonPropertyName("unread_count")] public int UnreadCount { get; init; }
    [JsonPropertyName("unread_mention_count")] public int UnreadMentionCount { get; init; }
    [JsonPropertyName("member_count")] public int MemberCount { get; init; }
    [JsonPropertyName("online_member_count")] public int OnlineMemberCount { get; init; }
    [JsonPropertyName("is_pinned")] public bool IsPinned { get; init; }
    [JsonPropertyName("is_muted")] public bool IsMuted { get; init; }
    [JsonPropertyName("muted_until")] public DateTimeOffset? MutedUntil { get; init; }
    [JsonPropertyName("is_archived")] public bool IsArchived { get; init; }
    [JsonPropertyName("pinned_message_id")] public string? PinnedMessageId { get; init; }
    [JsonPropertyName("is_support")] public bool IsSupport { get; init; }
    [JsonPropertyName("direct_peer")] public HubChatUser? DirectPeer { get; init; }
    [JsonPropertyName("viewer_last_read_seq")] public int ViewerLastReadSeq { get; init; }
    [JsonPropertyName("last_message_seq")] public int LastMessageSeq { get; init; }
    [JsonPropertyName("viewer_restricted")] public bool? ViewerRestricted { get; init; }
    [JsonPropertyName("posting_policy")] public string? PostingPolicy { get; init; }
    /// <summary>Роль текущего пользователя в группе: owner|moderator|member (null — не группа).</summary>
    [JsonPropertyName("viewer_member_role")] public string? ViewerMemberRole { get; init; }
}

/// <summary>ChatMemberResponse — участник группы в detail-ответе.</summary>
public sealed record HubChatMember
{
    [JsonPropertyName("user")] public HubChatUser? User { get; init; }
    [JsonPropertyName("member_role")] public string? MemberRole { get; init; }
    [JsonPropertyName("joined_at")] public DateTimeOffset? JoinedAt { get; init; }
    [JsonPropertyName("is_restricted")] public bool IsRestricted { get; init; }
    [JsonPropertyName("restricted_until")] public DateTimeOffset? RestrictedUntil { get; init; }
}

/// <summary>ChatConversationDetailResponse — summary + список участников и описание.</summary>
public sealed record HubChatConversationDetail : HubChatConversation
{
    [JsonPropertyName("members")] public IReadOnlyList<HubChatMember>? Members { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
}

public sealed record HubChatConversationList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatConversation>? Items { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_cursor")] public string? NextCursor { get; init; }
}

/// <summary>ChatMessageResponse.</summary>
public sealed record HubChatMessage
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("body_format")] public string? BodyFormat { get; init; }
    [JsonPropertyName("sender")] public HubChatUser? Sender { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("edited_at")] public DateTimeOffset? EditedAt { get; init; }
    [JsonPropertyName("is_deleted")] public bool IsDeleted { get; init; }
    [JsonPropertyName("is_own")] public bool IsOwn { get; init; }
    [JsonPropertyName("delivery_status")] public string? DeliveryStatus { get; init; }
    [JsonPropertyName("read_by_count")] public int ReadByCount { get; init; }
    [JsonPropertyName("client_message_id")] public string? ClientMessageId { get; init; }
    [JsonPropertyName("reply_preview")] public HubChatReplyPreview? ReplyPreview { get; init; }
    [JsonPropertyName("forward_preview")] public HubChatForwardPreview? ForwardPreview { get; init; }
    [JsonPropertyName("poll")] public HubChatPoll? Poll { get; init; }
    [JsonPropertyName("attachments")] public IReadOnlyList<HubChatAttachment>? Attachments { get; init; }
    [JsonPropertyName("reactions")] public IReadOnlyList<HubChatReaction>? Reactions { get; init; }
    /// <summary>Карточка задачи для kind="task_share" (ChatTaskPreview).</summary>
    [JsonPropertyName("task_preview")] public HubChatTaskPreview? TaskPreview { get; init; }
    /// <summary>Карточка действия ассистента (ChatMessageResponse.action_card).</summary>
    [JsonPropertyName("action_card")] public HubChatActionCard? ActionCard { get; init; }
}

/// <summary>
/// Карточка действия ассистента в сообщении AI-диалога (action_card):
/// id/status/expires_at + сырой preview-объект (его схема зависит от action_type
/// — см. AiActionCard в web ChatBubble.jsx: title/summary/items/warnings/effects/
/// choices/formats/database_id, open_url…).
/// </summary>
public sealed record HubChatActionCard
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("action_type")] public string? ActionType { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
    [JsonPropertyName("preview")] public JsonElement? Preview { get; init; }
    [JsonPropertyName("result")] public JsonElement? Result { get; init; }
    [JsonPropertyName("result_url")] public string? ResultUrl { get; init; }
    [JsonPropertyName("database_id")] public string? DatabaseId { get; init; }
    [JsonPropertyName("error_text")] public string? ErrorText { get; init; }
}

/// <summary>
/// ChatTaskPreview — компактная карточка задачи: вложение сообщения
/// kind="task_share" и элемент выдачи GET …/shareable-tasks.
/// </summary>
public sealed record HubChatTaskPreview
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("priority")] public string? Priority { get; init; }
    [JsonPropertyName("assignee_full_name")] public string? AssigneeFullName { get; init; }
    [JsonPropertyName("assignee_username")] public string? AssigneeUsername { get; init; }
    [JsonPropertyName("due_at")] public DateTimeOffset? DueAt { get; init; }
    [JsonPropertyName("is_overdue")] public bool IsOverdue { get; init; }
}

/// <summary>ChatShareableTasksResponse — выдача задач для «Поделиться задачей».</summary>
public sealed record HubChatShareableTaskList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatTaskPreview>? Items { get; init; }
}

/// <summary>POST …/messages/{mid}/report → {id, status, already_reported}.</summary>
public sealed record HubChatMessageReportResult
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("already_reported")] public bool AlreadyReported { get; init; }
}

/// <summary>Элемент GET …/reports — жалоба на сообщение группы.</summary>
public sealed record HubChatMessageReport
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("reporter_user_id")] public int ReporterUserId { get; init; }
    [JsonPropertyName("reporter_name")] public string? ReporterName { get; init; }
    [JsonPropertyName("sender_user_id")] public int SenderUserId { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("message_preview")] public string? MessagePreview { get; init; }
}

/// <summary>GET …/reports → {items, open_count}.</summary>
public sealed record HubChatMessageReportList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatMessageReport>? Items { get; init; }
    [JsonPropertyName("open_count")] public int OpenCount { get; init; }
}

/// <summary>PUT …/reports/{rid} → {id, status}.</summary>
public sealed record HubChatMessageReportResolution
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

/// <summary>Заявка на вступление — элемент GET …/join-requests.</summary>
public sealed record HubChatJoinRequestItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("user_id")] public int UserId { get; init; }
    [JsonPropertyName("user_name")] public string? UserName { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
}

/// <summary>GET …/join-requests → {items, open_count, approval_required}.</summary>
public sealed record HubChatJoinRequestList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatJoinRequestItem>? Items { get; init; }
    [JsonPropertyName("open_count")] public int OpenCount { get; init; }
    [JsonPropertyName("approval_required")] public bool ApprovalRequired { get; init; }
}

/// <summary>PUT …/join-requests/{rid} → {id, status: approved|rejected, added}.</summary>
public sealed record HubChatJoinRequestResolution
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("added")] public bool Added { get; init; }
}

/// <summary>PUT …/join-approval → {approval_required}.</summary>
public sealed record HubChatJoinApproval
{
    [JsonPropertyName("approval_required")] public bool ApprovalRequired { get; init; }
}

/// <summary>POST …/invite-link → {token, expires_at, conversation_id}.</summary>
public sealed record HubChatInviteLink
{
    [JsonPropertyName("token")] public string? Token { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
}

/// <summary>DELETE …/invite-link → {revoked} (0 — активной ссылки не было).</summary>
public sealed record HubChatInviteRevokeResult
{
    [JsonPropertyName("revoked")] public int Revoked { get; init; }
}

/// <summary>
/// GET /chat/invite-links/{token} — превью группы по ссылке-приглашению:
/// conversation_id возвращается только уже состоящим участникам.
/// </summary>
public sealed record HubChatInvitePreview
{
    [JsonPropertyName("requires_approval")] public bool RequiresApproval { get; init; }
    [JsonPropertyName("request_status")] public string? RequestStatus { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("avatar_url")] public string? AvatarUrl { get; init; }
    [JsonPropertyName("member_count")] public int MemberCount { get; init; }
    [JsonPropertyName("already_member")] public bool AlreadyMember { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
}

/// <summary>
/// POST /chat/invite-links/{token}/join → {joined, requested, request_status, conversation}.
/// При approval_required группа возвращает requested=true и conversation=null.
/// </summary>
public sealed record HubChatInviteJoinResult
{
    [JsonPropertyName("joined")] public bool Joined { get; init; }
    [JsonPropertyName("requested")] public bool Requested { get; init; }
    [JsonPropertyName("request_status")] public string? RequestStatus { get; init; }
    [JsonPropertyName("conversation")] public HubChatConversation? Conversation { get; init; }
}

/// <summary>Элемент GET …/messages/hydrate — свежие статусы уже загруженных сообщений.</summary>
public sealed record HubChatThreadHydrateItem
{
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("read_by_count")] public int ReadByCount { get; init; }
    [JsonPropertyName("delivery_status")] public string? DeliveryStatus { get; init; }
    [JsonPropertyName("reactions")] public IReadOnlyList<HubChatReaction>? Reactions { get; init; }
    /// <summary>Обновление карточки действия (hydrate отдаёт action_card частичным патчем).</summary>
    [JsonPropertyName("action_card")] public HubChatActionCard? ActionCard { get; init; }
}

/// <summary>GET …/messages/hydrate?message_ids= → {items}.</summary>
public sealed record HubChatThreadHydrateResult
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatThreadHydrateItem>? Items { get; init; }
}

public sealed record HubChatReplyPreview
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
}

/// <summary>Превью источника пересланного сообщения (forward_preview).</summary>
public sealed record HubChatForwardPreview
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("attachments_count")] public int AttachmentsCount { get; init; }
}

/// <summary>Опрос внутри сообщения (poll).</summary>
public sealed record HubChatPoll
{
    [JsonPropertyName("question")] public string? Question { get; init; }
    [JsonPropertyName("options")] public IReadOnlyList<HubChatPollOption>? Options { get; init; }
    [JsonPropertyName("anonymous")] public bool Anonymous { get; init; }
    [JsonPropertyName("closed")] public bool Closed { get; init; }
    [JsonPropertyName("total_voters")] public int TotalVoters { get; init; }
    [JsonPropertyName("my_option_index")] public int? MyOptionIndex { get; init; }
}

public sealed record HubChatPollOption
{
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("votes")] public int Votes { get; init; }
}

/// <summary>Ответ poll-vote/poll-close: {message_id, action, poll}.</summary>
public sealed record HubChatPollVoteResult
{
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("action")] public string? Action { get; init; }
    [JsonPropertyName("poll")] public HubChatPoll? Poll { get; init; }
}

/// <summary>Кто прочитал сообщение — GET …/messages/{id}/reads.</summary>
public sealed record HubChatMessageReads
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatReadReceipt>? Items { get; init; }
}

public sealed record HubChatReadReceipt
{
    [JsonPropertyName("user")] public HubChatUser? User { get; init; }
    [JsonPropertyName("read_at")] public DateTimeOffset? ReadAt { get; init; }
}

/// <summary>Глобальный поиск по всем диалогам — GET /chat/messages/search.</summary>
public sealed record HubChatGlobalSearchResult
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatGlobalSearchHit>? Items { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
}

public sealed record HubChatGlobalSearchHit
{
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("conversation_title")] public string? ConversationTitle { get; init; }
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("preview")] public string? Preview { get; init; }
}

public sealed record HubChatAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("media_kind")] public string? MediaKind { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("size_bytes")] public long SizeBytes { get; init; }
    [JsonPropertyName("width")] public int? Width { get; init; }
    [JsonPropertyName("height")] public int? Height { get; init; }
    [JsonPropertyName("duration_seconds")] public int? DurationSeconds { get; init; }
    [JsonPropertyName("download_url")] public string? DownloadUrl { get; init; }
    [JsonPropertyName("preview_url")] public string? PreviewUrl { get; init; }

    /// <summary>Размер файла: бэкенд шлёт file_size; size_bytes — запасной алиас.</summary>
    public long EffectiveSize => FileSize > 0 ? FileSize : SizeBytes;
}

/// <summary>Ответ GET /chat/link-preview — Open Graph карточка ссылки (или пустые поля).</summary>
public sealed record HubChatLinkPreview
{
    [JsonPropertyName("url")] public string? Url { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("image")] public string? Image { get; init; }
    [JsonPropertyName("site_name")] public string? SiteName { get; init; }
}

/// <summary>ChatConversationAttachmentItemResponse — вложение в галерее диалога.</summary>
public sealed record HubChatConversationAttachmentItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("media_kind")] public string? MediaKind { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("width")] public int? Width { get; init; }
    [JsonPropertyName("height")] public int? Height { get; init; }
    [JsonPropertyName("duration_seconds")] public int? DurationSeconds { get; init; }
    [JsonPropertyName("original_url")] public string? OriginalUrl { get; init; }
    [JsonPropertyName("download_url")] public string? DownloadUrl { get; init; }
    [JsonPropertyName("variant_urls")] public IReadOnlyDictionary<string, string>? VariantUrls { get; init; }
    [JsonPropertyName("preview_url")] public string? PreviewUrl { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
}

/// <summary>ChatConversationAttachmentsResponse — страница галереи с курсором «до».</summary>
public sealed record HubChatConversationAttachmentPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatConversationAttachmentItem>? Items { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_before_attachment_id")] public string? NextBeforeAttachmentId { get; init; }
}

/// <summary>
/// Результат GET …/conversations/{id}/export: тело уже записано в поток,
/// сюда собираются метаданные из заголовков (имя файла, счётчик, усечение).
/// </summary>
public sealed record HubChatExportResult
{
    public string? FileName { get; init; }
    public int MessagesCount { get; init; }
    public bool Truncated { get; init; }
}

/// <summary>Файл в POST …/upload-sessions — заявка на загрузку.</summary>
public sealed record HubChatUploadFileRequest
{
    [JsonPropertyName("file_name")] public string FileName { get; init; } = string.Empty;
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("media_kind")] public string? MediaKind { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("original_size")] public long OriginalSize { get; init; }
    [JsonPropertyName("transfer_encoding")] public string TransferEncoding { get; init; } = "identity";
}

/// <summary>Файл в ответе upload-session: серверный file_id и сетка чанков.</summary>
public sealed record HubChatUploadSessionFile
{
    [JsonPropertyName("file_id")] public string FileId { get; init; } = string.Empty;
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("media_kind")] public string? MediaKind { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("original_size")] public long OriginalSize { get; init; }
    [JsonPropertyName("chunk_count")] public int ChunkCount { get; init; }
    [JsonPropertyName("received_bytes")] public long ReceivedBytes { get; init; }
}

/// <summary>POST …/upload-sessions — сессия загрузки: chunk_size и file_id'ы.</summary>
public sealed record HubChatUploadSession
{
    [JsonPropertyName("session_id")] public string SessionId { get; init; } = string.Empty;
    [JsonPropertyName("chunk_size_bytes")] public int ChunkSizeBytes { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("files")] public IReadOnlyList<HubChatUploadSessionFile>? Files { get; init; }
}

/// <summary>PUT …/chunks/{i} — подтверждение чанка.</summary>
public sealed record HubChatUploadChunk
{
    [JsonPropertyName("file_complete")] public bool FileComplete { get; init; }
    [JsonPropertyName("received_bytes")] public long ReceivedBytes { get; init; }
}

public sealed record HubChatReaction
{
    [JsonPropertyName("emoji")] public string? Emoji { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("user_ids")] public IReadOnlyList<int>? UserIds { get; init; }
}

/// <summary>Ответ POST …/messages/{id}/reactions — итоговый список реакций сообщения.</summary>
public sealed record HubChatReactionToggle
{
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("action")] public string? Action { get; init; }
    [JsonPropertyName("emoji")] public string? Emoji { get; init; }
    [JsonPropertyName("reactions")] public IReadOnlyList<HubChatReaction>? Reactions { get; init; }
}

public sealed record HubChatMessageList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatMessage>? Items { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("has_older")] public bool HasOlder { get; init; }
    [JsonPropertyName("has_newer")] public bool HasNewer { get; init; }
    [JsonPropertyName("older_cursor_message_id")] public string? OlderCursorMessageId { get; init; }
    [JsonPropertyName("newer_cursor_message_id")] public string? NewerCursorMessageId { get; init; }
    [JsonPropertyName("viewer_last_read_message_id")] public string? ViewerLastReadMessageId { get; init; }
}

public sealed record HubWsTicket
{
    [JsonPropertyName("ws_ticket")] public string? Ticket { get; init; }
    [JsonPropertyName("expires_in")] public int ExpiresIn { get; init; }
}

/// <summary>GET …/messages/search — {items, has_more} без курсоров.</summary>
public sealed record HubChatMessageSearchResult
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatMessage>? Items { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
}

/// <summary>
/// GET …/thread-bootstrap?focus_message_id= — страница сообщений вокруг якоря;
/// shape = ChatMessageListResponse + якорные поля.
/// </summary>
public sealed record HubChatThreadBootstrap
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatMessage>? Items { get; init; }
    [JsonPropertyName("has_older")] public bool HasOlder { get; init; }
    [JsonPropertyName("has_newer")] public bool HasNewer { get; init; }
    [JsonPropertyName("older_cursor_message_id")] public string? OlderCursorMessageId { get; init; }
    [JsonPropertyName("newer_cursor_message_id")] public string? NewerCursorMessageId { get; init; }
    [JsonPropertyName("viewer_last_read_message_id")] public string? ViewerLastReadMessageId { get; init; }
    [JsonPropertyName("initial_anchor_mode")] public string? InitialAnchorMode { get; init; }
    [JsonPropertyName("initial_anchor_message_id")] public string? InitialAnchorMessageId { get; init; }
    [JsonPropertyName("pinned_message_id")] public string? PinnedMessageId { get; init; }
    [JsonPropertyName("pinned_message")] public HubChatPinnedMessage? PinnedMessage { get; init; }
    [JsonPropertyName("pinned_messages")] public IReadOnlyList<HubChatPinnedMessage>? PinnedMessages { get; init; }
}

/// <summary>ChatPinnedMessagePreview — элемент закреплённого списка диалога.</summary>
public sealed record HubChatPinnedMessage
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("preview")] public string? Preview { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>GET/PUT/DELETE …/pinned-messages — {items:[ChatPinnedMessagePreview]}.</summary>
public sealed record HubChatPinnedMessageList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatPinnedMessage>? Items { get; init; }
}

// ---- Папки диалогов (GET/POST/PATCH/DELETE /chat/folders*) ----

/// <summary>ChatFolderSummary — пользовательская папка диалогов.</summary>
public sealed record HubChatFolder
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("conversation_count")] public int ConversationCount { get; init; }
    [JsonPropertyName("unread_count")] public int UnreadCount { get; init; }
    [JsonPropertyName("conversation_ids")] public IReadOnlyList<string>? ConversationIds { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// ChatFolderListResponse — список пользовательских папок + карта членства
/// (folder_id → conversation_ids) и непрочитанные по системным вкладкам
/// (personal/groups/tasks/archived/ai — backend folder_unread.py).
/// </summary>
public sealed record HubChatFolderList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatFolder>? Items { get; init; }
    [JsonPropertyName("conversation_ids_by_folder")] public IReadOnlyDictionary<string, IReadOnlyList<string>>? ConversationIdsByFolder { get; init; }
    [JsonPropertyName("folder_unread_counts")] public IReadOnlyDictionary<string, int>? FolderUnreadCounts { get; init; }
}

/// <summary>ChatFolderMutationResponse — ответ create/update/membership-маршрутов.</summary>
public sealed record HubChatFolderMutation
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("item")] public HubChatFolder? Item { get; init; }
}

/// <summary>DELETE /chat/folders/{id} → {ok, id}.</summary>
public sealed record HubChatFolderDeleteResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("id")] public string? Id { get; init; }
}

// ---- Стикерпаки чата (/chat/sticker-packs*, /chat/stickers/*) ----

/// <summary>ChatStickerResponse — стикер внутри пака.</summary>
public sealed record HubChatSticker
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("emoji")] public string? Emoji { get; init; }
    [JsonPropertyName("format")] public string? Format { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("width")] public int? Width { get; init; }
    [JsonPropertyName("height")] public int? Height { get; init; }
    [JsonPropertyName("file_url")] public string? FileUrl { get; init; }
    [JsonPropertyName("preview_url")] public string? PreviewUrl { get; init; }
}

/// <summary>ChatStickerPackResponse — пак со списком стикеров.</summary>
public sealed record HubChatStickerPack
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("short_name")] public string? ShortName { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("sticker_type")] public string? StickerType { get; init; }
    [JsonPropertyName("is_added")] public bool IsAdded { get; init; }
    [JsonPropertyName("stickers")] public IReadOnlyList<HubChatSticker>? Stickers { get; init; }
}

/// <summary>GET /chat/sticker-packs и POST …/import → {items}.</summary>
public sealed record HubChatStickerPackList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatStickerPack>? Items { get; init; }
}

/// <summary>DELETE /chat/sticker-packs/{id} → {ok, id} (как delete_chat_folder).</summary>
public sealed record HubChatStickerPackDeleteResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("id")] public string? Id { get; init; }
}

// ---- ИИ-ассистент (/chat/ai/*) — DTO по backend/ai_chat/schemas.py ----

/// <summary>AiBotSummaryResponse — ассистент в выдаче GET /chat/ai/bots.</summary>
public sealed record HubChatAiBot
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("slug")] public string? Slug { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("conversation_ids")] public IReadOnlyList<string>? ConversationIds { get; init; }
    [JsonPropertyName("surface")] public string? Surface { get; init; }
    [JsonPropertyName("placement")] public string? Placement { get; init; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("allow_file_input")] public bool AllowFileInput { get; init; }
    [JsonPropertyName("allow_generated_artifacts")] public bool AllowGeneratedArtifacts { get; init; }
    [JsonPropertyName("allow_kb_document_delivery")] public bool AllowKbDocumentDelivery { get; init; }
    [JsonPropertyName("is_enabled")] public bool IsEnabled { get; init; }
    [JsonPropertyName("configured")] public bool Configured { get; init; }
    [JsonPropertyName("live_data_enabled")] public bool LiveDataEnabled { get; init; }
}

/// <summary>AiBotListResponse — {items, configured}.</summary>
public sealed record HubChatAiBotList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatAiBot>? Items { get; init; }
    [JsonPropertyName("configured")] public bool Configured { get; init; }
}

/// <summary>
/// AiConversationStatusResponse — состояние запуска ассистента в диалоге:
/// status queued|running|completed|failed|cancelled (null — запуска нет),
/// stage/status_text — человеческий прогресс, server_now — возраст без перекоса,
/// agent_read_only — агент выключен (OpenCode), беседа read-only.
/// </summary>
public sealed record HubChatAiStatus
{
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("bot_id")] public string? BotId { get; init; }
    [JsonPropertyName("bot_title")] public string? BotTitle { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("stage")] public string? Stage { get; init; }
    [JsonPropertyName("status_text")] public string? StatusText { get; init; }
    [JsonPropertyName("run_id")] public string? RunId { get; init; }
    [JsonPropertyName("run_created_at")] public DateTimeOffset? RunCreatedAt { get; init; }
    [JsonPropertyName("result_message_id")] public string? ResultMessageId { get; init; }
    [JsonPropertyName("error_text")] public string? ErrorText { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("server_now")] public DateTimeOffset? ServerNow { get; init; }
    [JsonPropertyName("agent_read_only")] public bool AgentReadOnly { get; init; }
}

/// <summary>POST …/ai/conversations/{id}/reset-context → {ok, conversation_id, context_reset_seq}.</summary>
public sealed record HubChatAiResetResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("context_reset_seq")] public long ContextResetSeq { get; init; }
}

/// <summary>AiMemoryItemResponse — факт личной памяти ассистента.</summary>
public sealed record HubChatAiMemoryItem
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("content")] public string? Content { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("fact_key")] public string? FactKey { get; init; }
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("source_message_id")] public string? SourceMessageId { get; init; }
    [JsonPropertyName("source_conversation_id")] public string? SourceConversationId { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>AiMemoryListResponse — {enabled, items, limits{max_facts,max_tokens}}.</summary>
public sealed record HubChatAiMemoryList
{
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubChatAiMemoryItem>? Items { get; init; }
    [JsonPropertyName("limits")] public IReadOnlyDictionary<string, int>? Limits { get; init; }
}

/// <summary>DELETE /chat/ai/memory/{id} → {ok, id}; DELETE /chat/ai/memory → {ok, deleted_count}.</summary>
public sealed record HubChatAiMemoryDeleteResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("deleted_count")] public int DeletedCount { get; init; }
}

// ---- Почта (GET/POST /api/v1/mail/*, Exchange-интеграция backend) ----

/// <summary>
/// Query для GET /api/v1/mail/messages: offset-пагинация (offset/limit,
/// ответ отдаёт has_more/next_offset/total), folder — alias папки или id
/// узла дерева (base64-токен вида "mailbox::xxx"), folder_scope=current —
/// только выбранная папка, без рекурсии.
/// </summary>
public sealed record HubMailMessageQuery
{
    /// <summary>mailbox_id из bootstrap selected_mailbox; null — выбранный/primary ящик сервера.</summary>
    public string? MailboxId { get; init; }

    /// <summary>inbox|sent|drafts|trash|junk|archive или id пользовательской папки дерева.</summary>
    public string Folder { get; init; } = "inbox";

    /// <summary>current — только выбранная папка (единственный режим первого среза).</summary>
    public string FolderScope { get; init; } = "current";
    public int Limit { get; init; } = 50;
    public int Offset { get; init; }
    public string? Search { get; init; }
    public bool UnreadOnly { get; init; }
}

/// <summary>Адресат письма: {name, email, display, avatar_url}.</summary>
public sealed record HubMailPerson
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("display")] public string? Display { get; init; }
    [JsonPropertyName("avatar_url")] public string? AvatarUrl { get; init; }
}

/// <summary>
/// Узел дерева папок (GET /mail/folders/tree → items[]):
/// well_known_key — alias стандартной папки, id — токен для параметра folder.
/// </summary>
public sealed record HubMailFolder
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("exchange_id")] public string? ExchangeId { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("scope")] public string? Scope { get; init; }
    [JsonPropertyName("icon_key")] public string? IconKey { get; init; }
    [JsonPropertyName("well_known_key")] public string? WellKnownKey { get; init; }
    [JsonPropertyName("parent_id")] public string? ParentId { get; init; }
    [JsonPropertyName("is_favorite")] public bool IsFavorite { get; init; }
    [JsonPropertyName("is_distinguished")] public bool IsDistinguished { get; init; }
    [JsonPropertyName("can_rename")] public bool CanRename { get; init; }
    [JsonPropertyName("can_delete")] public bool CanDelete { get; init; }
    [JsonPropertyName("can_create_children")] public bool CanCreateChildren { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("unread")] public int Unread { get; init; }
    [JsonPropertyName("child_folder_count")] public int ChildFolderCount { get; init; }
}

/// <summary>GET /mail/folders/tree → {items, favorites}.</summary>
public sealed record HubMailFolderTree
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMailFolder>? Items { get; init; }
    [JsonPropertyName("favorites")] public IReadOnlyList<string>? Favorites { get; init; }
}

/// <summary>Элемент GET /mail/messages/{id}/headers → items[]: {name, value}.</summary>
public sealed record HubMailMessageHeaderItem
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("value")] public string? Value { get; init; }
}

/// <summary>
/// GET /mail/messages/{id}/headers → {message_id, source_name, items}:
/// полные заголовки письма (Received/Message-ID и пр.) для режима «показать детали».
/// </summary>
public sealed record HubMailMessageHeaders
{
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("source_name")] public string? SourceName { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubMailMessageHeaderItem>? Items { get; init; }
}

/// <summary>Элемент GET /mail/messages → items[] (превью письма без тела).</summary>
public sealed record HubMailMessagePreview
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
    [JsonPropertyName("exchange_id")] public string? ExchangeId { get; init; }
    [JsonPropertyName("folder")] public string? Folder { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("sender")] public string? Sender { get; init; }
    [JsonPropertyName("sender_person")] public HubMailPerson? SenderPerson { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("sender_email")] public string? SenderEmail { get; init; }
    [JsonPropertyName("sender_display")] public string? SenderDisplay { get; init; }
    [JsonPropertyName("recipients")] public IReadOnlyList<string>? Recipients { get; init; }
    [JsonPropertyName("recipient_people")] public IReadOnlyList<HubMailPerson>? RecipientPeople { get; init; }
    [JsonPropertyName("received_at")] public string? ReceivedAt { get; init; }
    [JsonPropertyName("is_read")] public bool IsRead { get; init; }
    [JsonPropertyName("has_attachments")] public bool HasAttachments { get; init; }
    [JsonPropertyName("attachments_count")] public int AttachmentsCount { get; init; }
    [JsonPropertyName("body_preview")] public string? BodyPreview { get; init; }
    [JsonPropertyName("importance")] public string? Importance { get; init; }
    [JsonPropertyName("categories")] public IReadOnlyList<string>? Categories { get; init; }
}

/// <summary>
/// Страница GET /mail/messages (и messages внутри /mail/bootstrap):
/// offset-пагинация, next_offset == null — страниц больше нет.
/// </summary>
public sealed record HubMailMessagePage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMailMessagePreview>? Items { get; init; }
    [JsonPropertyName("folder")] public string? Folder { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
    [JsonPropertyName("search_limited")] public bool SearchLimited { get; init; }
    [JsonPropertyName("searched_window")] public int SearchedWindow { get; init; }
    [JsonPropertyName("skipped_folders")] public int SkippedFolders { get; init; }
}

/// <summary>Вложение письма (поле attachments detail-ответа). Скачивание — вне первого среза.</summary>
public sealed record HubMailAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("content_type")] public string? ContentType { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("content_id")] public string? ContentId { get; init; }
    [JsonPropertyName("is_inline")] public bool IsInline { get; init; }
    [JsonPropertyName("downloadable")] public bool Downloadable { get; init; }
    [JsonPropertyName("download_token")] public string? DownloadToken { get; init; }
}

/// <summary>GET /mail/messages/{id}: полное письмо, body_html + готовый body_text.</summary>
public sealed record HubMailMessageDetail
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
    [JsonPropertyName("exchange_id")] public string? ExchangeId { get; init; }
    [JsonPropertyName("folder")] public string? Folder { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("sender")] public string? Sender { get; init; }
    [JsonPropertyName("sender_person")] public HubMailPerson? SenderPerson { get; init; }
    [JsonPropertyName("sender_name")] public string? SenderName { get; init; }
    [JsonPropertyName("sender_email")] public string? SenderEmail { get; init; }
    [JsonPropertyName("sender_display")] public string? SenderDisplay { get; init; }
    [JsonPropertyName("to")] public IReadOnlyList<string>? To { get; init; }
    [JsonPropertyName("to_people")] public IReadOnlyList<HubMailPerson>? ToPeople { get; init; }
    [JsonPropertyName("cc")] public IReadOnlyList<string>? Cc { get; init; }
    [JsonPropertyName("cc_people")] public IReadOnlyList<HubMailPerson>? CcPeople { get; init; }
    [JsonPropertyName("bcc")] public IReadOnlyList<string>? Bcc { get; init; }
    [JsonPropertyName("bcc_people")] public IReadOnlyList<HubMailPerson>? BccPeople { get; init; }
    [JsonPropertyName("received_at")] public string? ReceivedAt { get; init; }
    [JsonPropertyName("is_read")] public bool IsRead { get; init; }
    [JsonPropertyName("body_html")] public string? BodyHtml { get; init; }
    [JsonPropertyName("body_text")] public string? BodyText { get; init; }
    [JsonPropertyName("importance")] public string? Importance { get; init; }
    [JsonPropertyName("categories")] public IReadOnlyList<string>? Categories { get; init; }
    [JsonPropertyName("reminder_is_set")] public bool ReminderIsSet { get; init; }
    [JsonPropertyName("reminder_due_by")] public string? ReminderDueBy { get; init; }
    [JsonPropertyName("internet_message_id")] public string? InternetMessageId { get; init; }
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("restore_hint_folder")] public string? RestoreHintFolder { get; init; }
    [JsonPropertyName("attachments")] public IReadOnlyList<HubMailAttachment>? Attachments { get; init; }
    [JsonPropertyName("compose_context")] public HubMailComposeContext? ComposeContext { get; init; }
    [JsonPropertyName("draft_context")] public HubMailDraftContext? DraftContext { get; init; }
    [JsonPropertyName("has_external_images")] public bool HasExternalImages { get; init; }
    [JsonPropertyName("can_archive")] public bool CanArchive { get; init; }
    [JsonPropertyName("can_move")] public bool CanMove { get; init; }
}

/// <summary>
/// Готовый префилл композера от backend (compose_context.detail-ответа):
/// subject уже содержит «Re: »/«Fwd: », to/cc/bcc — с дедупом собственного ящика,
/// quote_html — HTML-блок цитаты («От/Дата/Тема» + blockquote тела).
/// </summary>
public sealed record HubMailComposeScenario
{
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("to")] public IReadOnlyList<string>? To { get; init; }
    [JsonPropertyName("cc")] public IReadOnlyList<string>? Cc { get; init; }
    [JsonPropertyName("bcc")] public IReadOnlyList<string>? Bcc { get; init; }
    [JsonPropertyName("quote_html")] public string? QuoteHtml { get; init; }
}

/// <summary>compose_context письма: сценарии reply/reply_all/forward (см. mail_message_serializer).</summary>
public sealed record HubMailComposeContext
{
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
    [JsonPropertyName("mailbox_email")] public string? MailboxEmail { get; init; }
    [JsonPropertyName("reply")] public HubMailComposeScenario? Reply { get; init; }
    [JsonPropertyName("reply_all")] public HubMailComposeScenario? ReplyAll { get; init; }
    [JsonPropertyName("forward")] public HubMailComposeScenario? Forward { get; init; }
}

/// <summary>draft_context черновика: режим и ссылки на исходное письмо (ответ/пересылка).</summary>
public sealed record HubMailDraftContext
{
    [JsonPropertyName("compose_mode")] public string? ComposeMode { get; init; }
    [JsonPropertyName("reply_to_message_id")] public string? ReplyToMessageId { get; init; }
    [JsonPropertyName("forward_message_id")] public string? ForwardMessageId { get; init; }
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
}

/// <summary>
/// Запрос на отправку/сохранение черновика. Без вложений уходит JSON на
/// POST /mail/messages/send; с файлами — multipart на send-multipart
/// (поля to/cc/bcc склеиваются «;», retain/forward-refs — *_json полями).
/// ComposeMode используется только drafts/upsert-multipart.
/// </summary>
public sealed record HubMailSendRequest
{
    public string? FromMailboxId { get; init; }
    public IReadOnlyList<string> To { get; init; } = [];
    public IReadOnlyList<string> Cc { get; init; } = [];
    public IReadOnlyList<string> Bcc { get; init; } = [];
    public string? Subject { get; init; }
    public string? Body { get; init; }

    /// <summary>false — plain text (desktop-композер без HTML-редактора).</summary>
    public bool IsHtml { get; init; }
    public string? ReplyToMessageId { get; init; }
    public string? ForwardMessageId { get; init; }
    public string? DraftId { get; init; }

    /// <summary>draft|reply|reply_all|forward — режим сохраняемого черновика.</summary>
    public string? ComposeMode { get; init; }

    /// <summary>
    /// Токены вложений уже лежащего на сервере черновика, которые надо оставить
    /// (retain_existing_attachments). null — пустой список, как у веб-клиента
    /// для нового письма.
    /// </summary>
    public IReadOnlyList<string>? RetainExistingAttachments { get; init; }

    /// <summary>
    /// forward_attachment_refs: null — сервер прикладывает все вложения исходного
    /// письма (семантика веба для неизменённого списка).
    /// </summary>
    public IReadOnlyList<string>? ForwardAttachmentRefs { get; init; }

    /// <summary>Idempotency-Key для /messages/send(-multipart) — повтор клика не шлёт дубль.</summary>
    public string? IdempotencyKey { get; init; }
}

/// <summary>Файл для прикрепления к письму (multipart files[]).</summary>
public sealed record HubMailOutgoingAttachment
{
    public string FileName { get; init; } = "attachment.bin";
    public string? ContentType { get; init; }
    public ReadOnlyMemory<byte> Content { get; init; }
}

/// <summary>Ответ POST /mail/messages/send(-multipart): {ok, message_id, subject, ...}.</summary>
public sealed record HubMailSendResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("recipients")] public IReadOnlyList<string>? Recipients { get; init; }
    [JsonPropertyName("cc")] public IReadOnlyList<string>? Cc { get; init; }
    [JsonPropertyName("bcc")] public IReadOnlyList<string>? Bcc { get; init; }
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
    [JsonPropertyName("mailbox_email")] public string? MailboxEmail { get; init; }
}

/// <summary>Ответ POST /mail/drafts/upsert-multipart: {ok, draft_id, saved_at, message}.</summary>
public sealed record HubMailDraftSaveResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("draft_id")] public string? DraftId { get; init; }
    [JsonPropertyName("saved_at")] public string? SavedAt { get; init; }
}

/// <summary>
/// Контакт из GET /mail/contacts: source = exchange_gal (GAL) | itinvent_users
/// (локальные пользователи с mailbox_email).
/// </summary>
public sealed record HubMailContact
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
}

/// <summary>GET /mail/contacts → {items} — автоподсказка адресатов композера.</summary>
public sealed record HubMailContactList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMailContact>? Items { get; init; }
}

/// <summary>Ошибка одного письма внутри bulk-операции (errors[]).</summary>
public sealed record HubMailBulkError
{
    [JsonPropertyName("message_id")] public string? MessageId { get; init; }
    [JsonPropertyName("detail")] public string? Detail { get; init; }
}

/// <summary>
/// Ответ POST /mail/messages/bulk: сервер выполняет действие по каждому id
/// и считает succeeded/failed (mark_read|mark_unread|move|delete|archive).
/// </summary>
public sealed record HubMailBulkResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("action")] public string? Action { get; init; }
    [JsonPropertyName("processed")] public int Processed { get; init; }
    [JsonPropertyName("succeeded")] public int Succeeded { get; init; }
    [JsonPropertyName("failed")] public int Failed { get; init; }
    [JsonPropertyName("errors")] public IReadOnlyList<HubMailBulkError>? Errors { get; init; }
}

/// <summary>
/// Ящик пользователя (selected_mailbox/mailboxInfo и элементы mailboxes[] в /mail/bootstrap):
/// флаги mail_* описывают готовность доступа — без пароля или без перелогина ящик нечитаем.
/// </summary>
public sealed record HubMailMailboxInfo
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("mailbox_id")] public string? MailboxId { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("mailbox_email")] public string? MailboxEmail { get; init; }
    [JsonPropertyName("mailbox_login")] public string? MailboxLogin { get; init; }
    [JsonPropertyName("auth_mode")] public string? AuthMode { get; init; }
    [JsonPropertyName("is_primary")] public bool IsPrimary { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    [JsonPropertyName("is_selected")] public bool IsSelected { get; init; }
    [JsonPropertyName("mail_is_configured")] public bool MailIsConfigured { get; init; }
    [JsonPropertyName("mail_requires_password")] public bool MailRequiresPassword { get; init; }
    [JsonPropertyName("mail_requires_relogin")] public bool MailRequiresRelogin { get; init; }
    [JsonPropertyName("unread_count")] public int UnreadCount { get; init; }
}

/// <summary>{total, unread} по одной папке — значения словаря folder_summary в bootstrap.</summary>
public sealed record HubMailFolderCounts
{
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("unread")] public int Unread { get; init; }
}

/// <summary>
/// GET /mail/bootstrap: состояние ящика + дерево папок + голова входящих одним запросом
/// (backend отдаёт messages только для folder=inbox — см. mail.py get_mail_bootstrap).
/// </summary>
public sealed record HubMailBootstrap
{
    [JsonPropertyName("selected_mailbox")] public HubMailMailboxInfo? SelectedMailbox { get; init; }
    [JsonPropertyName("mailboxInfo")] public HubMailMailboxInfo? MailboxInfo { get; init; }
    [JsonPropertyName("mailboxes")] public IReadOnlyList<HubMailMailboxInfo>? Mailboxes { get; init; }
    [JsonPropertyName("unread_count")] public int UnreadCount { get; init; }
    [JsonPropertyName("folder_summary")] public Dictionary<string, HubMailFolderCounts>? FolderSummary { get; init; }
    [JsonPropertyName("folder_tree")] public HubMailFolderTree? FolderTree { get; init; }
    [JsonPropertyName("messages")] public HubMailMessagePage? Messages { get; init; }
    [JsonPropertyName("state")] public string? State { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("last_error")] public string? LastError { get; init; }
}

/// <summary>Ответ мутаций почты ({ok} + служебные поля: read/unread/delete/move/restore).</summary>
public sealed record HubMailActionResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("permanent")] public bool Permanent { get; init; }
    [JsonPropertyName("moved_to")] public string? MovedTo { get; init; }
}

/// <summary>GET /mail/unread-count → {unread_count, state, source, last_error}.</summary>
public sealed record HubMailUnreadCount
{
    [JsonPropertyName("unread_count")] public int Count { get; init; }
    [JsonPropertyName("state")] public string? State { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("last_error")] public string? LastError { get; init; }
}

// ---- Мутации папок и действия над письмом (mail_folder_mutations / mail_ai_service) ----

/// <summary>Ответ POST /mail/folders/{id}/favorite: {ok, folder_id, favorite}.</summary>
public sealed record HubMailFolderFavoriteResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("folder_id")] public string? FolderId { get; init; }
    [JsonPropertyName("favorite")] public bool Favorite { get; init; }
}

/// <summary>Ответ DELETE /mail/folders/{id}: {ok, folder_id}.</summary>
public sealed record HubMailFolderDeleteResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("folder_id")] public string? FolderId { get; init; }
}

/// <summary>Ответ POST /mail/messages/{id}/importance: {ok, importance} — high|normal|low.</summary>
public sealed record HubMailImportanceResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("importance")] public string? Importance { get; init; }
}

/// <summary>Ответ POST /mail/messages/{id}/summarize: {summary}.</summary>
public sealed record HubMailSummaryResult
{
    [JsonPropertyName("summary")] public string? Summary { get; init; }
}

/// <summary>Ответ POST /mail/messages/{id}/smart-replies: {suggestions} — до 3 вариантов.</summary>
public sealed record HubMailSmartRepliesResult
{
    [JsonPropertyName("suggestions")] public IReadOnlyList<string>? Suggestions { get; init; }
}

// ---- Шаблоны IT-заявок (GET /mail/templates, отправка send-it-request*; ----
// ---- формат полей — backend/services/mail_template_model.py) ----

/// <summary>
/// Поле формы шаблона IT-заявки (элемент fields[] шаблона).
/// type: text|textarea|select|multiselect|date|checkbox|email|tel — набор
/// TEMPLATE_FIELD_TYPES backend'а; неизвестные значения клиент ведёт как text.
/// required у backend по умолчанию true — совпадает инициализатором.
/// default_value — сырое JSON-значение (строка, bool для checkbox, массив для multiselect).
/// </summary>
public sealed record HubMailTemplateField
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("type")] public string? Type { get; init; }
    [JsonPropertyName("required")] public bool Required { get; init; } = true;
    [JsonPropertyName("placeholder")] public string? Placeholder { get; init; }
    [JsonPropertyName("help_text")] public string? HelpText { get; init; }
    [JsonPropertyName("default_value")] public JsonElement? DefaultValue { get; init; }
    [JsonPropertyName("options")] public IReadOnlyList<string>? Options { get; init; }
    [JsonPropertyName("order")] public int Order { get; init; }
}

/// <summary>
/// Шаблон IT-заявки из GET /mail/templates (строка mail_it_templates +
/// распарсенный required_fields_json → fields). Сервер сам рендерит
/// subject_template/body_template_md при отправке — клиенту нужны id, заголовок и fields.
/// </summary>
public sealed record HubMailTemplate
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("subject_template")] public string? SubjectTemplate { get; init; }
    [JsonPropertyName("body_template_md")] public string? BodyTemplateMd { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    [JsonPropertyName("fields")] public IReadOnlyList<HubMailTemplateField>? Fields { get; init; }
}

/// <summary>Ответ GET /mail/templates → {items}.</summary>
public sealed record HubMailTemplateList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMailTemplate>? Items { get; init; }
}

// ---- Квоты почтовых ящиков (админские снапшоты /mail/mailbox-quota-snapshots*, ----
// ---- доступ по PERM_MAIL_QUOTAS_READ; DTO по модели backend/models/mailbox_quota.py) ----

/// <summary>Сводка снапшота квот (MailboxQuotaSnapshotSummary).</summary>
public sealed record HubMailQuotaSnapshot
{
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("imported_at")] public string? ImportedAt { get; init; }
    [JsonPropertyName("collected_at")] public string? CollectedAt { get; init; }
    [JsonPropertyName("source_host")] public string? SourceHost { get; init; }
    [JsonPropertyName("exchange_server")] public string? ExchangeServer { get; init; }
    [JsonPropertyName("row_count")] public int RowCount { get; init; }
}

/// <summary>Строка снапшота квот (MailboxQuotaRowResponse).</summary>
public sealed record HubMailQuotaRow
{
    [JsonPropertyName("id")] public int Id { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("upn")] public string? Upn { get; init; }
    [JsonPropertyName("mailbox_type")] public string? MailboxType { get; init; }
    [JsonPropertyName("used_bytes")] public long? UsedBytes { get; init; }
    [JsonPropertyName("quota_bytes")] public long? QuotaBytes { get; init; }
    [JsonPropertyName("free_bytes")] public long? FreeBytes { get; init; }
    [JsonPropertyName("used_percent")] public double? UsedPercent { get; init; }
    [JsonPropertyName("database_name")] public string? DatabaseName { get; init; }
    [JsonPropertyName("uses_default_quota")] public bool UsesDefaultQuota { get; init; }
}

/// <summary>Страница строк снапшота (MailboxQuotaRowsPage: {items, total, snapshot}).</summary>
public sealed record HubMailQuotaRowsPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMailQuotaRow>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("snapshot")] public HubMailQuotaSnapshot? Snapshot { get; init; }
}

/// <summary>Сводка по базе Exchange внутри снапшота (MailboxQuotaDatabaseSummary).</summary>
public sealed record HubMailQuotaDatabaseSummary
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("over_quota")] public int OverQuota { get; init; }
    [JsonPropertyName("warning_90")] public int Warning90 { get; init; }
}

/// <summary>Статистика снапшота квот (MailboxQuotaSnapshotStats из {id}/summary).</summary>
public sealed record HubMailQuotaSnapshotStats
{
    [JsonPropertyName("snapshot_id")] public int SnapshotId { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("with_quota")] public int WithQuota { get; init; }
    [JsonPropertyName("no_quota")] public int NoQuota { get; init; }
    [JsonPropertyName("over_quota")] public int OverQuota { get; init; }
    [JsonPropertyName("warning_90")] public int Warning90 { get; init; }
    [JsonPropertyName("by_database")] public IReadOnlyList<HubMailQuotaDatabaseSummary>? ByDatabase { get; init; }
}

/// <summary>
/// Query для GET /mail/mailbox-quota-snapshots/{id}/rows: search, флаги-фильтры
/// (взаимоисключающие: сервер считает no_quota первым, затем over_quota/warning_90),
/// database_name и limit/offset-пагинация.
/// </summary>
public sealed record HubMailQuotaRowsQuery
{
    public string? Search { get; init; }
    public bool OverQuota { get; init; }
    public bool Warning90 { get; init; }
    public bool NoQuota { get; init; }
    public string? DatabaseName { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

// ---- Документооборот 1С (/api/v1/docflow/*; DTO по backend/models/docflow.py) ----

/// <summary>Query для GET /docflow/tasks (scope=inbox|completed|all).</summary>
public sealed record HubDocflowTaskQuery
{
    /// <summary>inbox|completed|all — любое прочее значение нормализуется в inbox.</summary>
    public string Scope { get; init; } = "inbox";
    public string? Search { get; init; }
    public int Limit { get; init; } = 50;
    public int Offset { get; init; }
}

/// <summary>Элемент списка заданий 1С (DocflowTaskSummary; даты — строки из 1С).</summary>
public record HubDocflowTaskItem
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("task_type")] public string? TaskType { get; init; }
    [JsonPropertyName("task_type_label")] public string? TaskTypeLabel { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("number")] public string? Number { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("due_at")] public string? DueAt { get; init; }
    [JsonPropertyName("author")] public string? Author { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("result")] public string? Result { get; init; }
    [JsonPropertyName("business_state")] public string? BusinessState { get; init; }
    [JsonPropertyName("importance")] public string? Importance { get; init; }
    [JsonPropertyName("accepted")] public bool? Accepted { get; init; }
    [JsonPropertyName("completed_at")] public string? CompletedAt { get; init; }
    [JsonPropertyName("completed")] public bool Completed { get; init; }
}

/// <summary>Файл задания (DocflowTaskFileSummary).</summary>
public sealed record HubDocflowFile
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("extension")] public string? Extension { get; init; }
    [JsonPropertyName("content_type")] public string? ContentType { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("preview_supported")] public bool PreviewSupported { get; init; }
}

/// <summary>Доступное действие над заданием (DocflowAvailableAction).</summary>
public sealed record HubDocflowAction
{
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("tone")] public string? Tone { get; init; }
    [JsonPropertyName("comment_mode")] public string? CommentMode { get; init; }
}

/// <summary>Связанный объект 1С (DocflowRelatedObject).</summary>
public sealed record HubDocflowRelatedObject
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("object_type")] public string? ObjectType { get; init; }
    [JsonPropertyName("object_type_label")] public string? ObjectTypeLabel { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
}

/// <summary>Карточка задания (DocflowTaskDetail = summary + процесс/действия/файлы).</summary>
public sealed record HubDocflowTaskDetail : HubDocflowTaskItem
{
    [JsonPropertyName("process_name")] public string? ProcessName { get; init; }
    [JsonPropertyName("process_ref")] public string? ProcessRef { get; init; }
    [JsonPropertyName("process_type")] public string? ProcessType { get; init; }
    [JsonPropertyName("process_type_label")] public string? ProcessTypeLabel { get; init; }
    [JsonPropertyName("state_token")] public string? StateToken { get; init; }
    [JsonPropertyName("available_actions")]
    public IReadOnlyList<HubDocflowAction>? AvailableActions { get; init; }
    [JsonPropertyName("action_unavailable_reason")] public string? ActionUnavailableReason { get; init; }
    [JsonPropertyName("requires_digital_signature")] public bool RequiresDigitalSignature { get; init; }
    [JsonPropertyName("open_in_1c_url")] public string? OpenIn1cUrl { get; init; }
    [JsonPropertyName("related_objects")]
    public IReadOnlyList<HubDocflowRelatedObject>? RelatedObjects { get; init; }
    [JsonPropertyName("files")] public IReadOnlyList<HubDocflowFile>? Files { get; init; }
    [JsonPropertyName("files_incomplete")] public bool FilesIncomplete { get; init; }
}

/// <summary>Страница GET /docflow/tasks (DocflowTaskListResponse).</summary>
public sealed record HubDocflowTaskListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubDocflowTaskItem>? Items { get; init; }
    [JsonPropertyName("returned")] public int Returned { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("total")] public int? Total { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
    [JsonPropertyName("scope")] public string? Scope { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
}

/// <summary>Ответ POST …/actions и GET /commands/{id} (DocflowCommandResponse).</summary>
public sealed record HubDocflowCommandResult
{
    [JsonPropertyName("command_id")] public string? CommandId { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("task")] public HubDocflowTaskDetail? Task { get; init; }
    [JsonPropertyName("correlation_id")] public string? CorrelationId { get; init; }
    [JsonPropertyName("error_code")] public string? ErrorCode { get; init; }
}

/// <summary>Счётчик входящих для бейджа навигации (DocflowInboxSummary).</summary>
public sealed record HubDocflowInboxSummary
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("count")] public int? Count { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
}

/// <summary>Профиль креденшелсов 1С (DocflowCredentialProfile).</summary>
public sealed record HubDocflowProfile
{
    [JsonPropertyName("configured")] public bool Configured { get; init; }
    [JsonPropertyName("login")] public string? Login { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("last_error_code")] public string? LastErrorCode { get; init; }
    [JsonPropertyName("last_verified_at")] public DateTimeOffset? LastVerifiedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>
/// Доступность создания поручений (DocflowAssignmentCapability):
/// test_only=true ограничивает пилот — название обязано начинаться
/// с required_title_prefix (backend проверяет без учёта регистра).
/// </summary>
public sealed record HubDocflowAssignmentCapability
{
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("document_types")] public IReadOnlyList<string>? DocumentTypes { get; init; }
    [JsonPropertyName("test_only")] public bool TestOnly { get; init; } = true;
    [JsonPropertyName("required_title_prefix")] public string? RequiredTitlePrefix { get; init; }
}

/// <summary>Документ 1С для поручения (DocflowAssignmentDocument).</summary>
public sealed record HubDocflowAssignmentDocument
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    /// <summary>internal|incoming|outgoing — уходит в document_type запроса.</summary>
    [JsonPropertyName("document_type")] public string? DocumentType { get; init; }
    [JsonPropertyName("document_type_label")] public string? DocumentTypeLabel { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("number")] public string? Number { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
}

/// <summary>Исполнитель или контролёр поручения (DocflowAssignmentAssignee).</summary>
public sealed record HubDocflowAssignmentAssignee
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
}

/// <summary>Выдача GET /docflow/assignments/documents (DocflowAssignmentDocumentList).</summary>
public sealed record HubDocflowAssignmentDocumentList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubDocflowAssignmentDocument>? Items { get; init; }
    [JsonPropertyName("returned")] public int Returned { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
}

/// <summary>Выдача GET /docflow/assignments/assignees (DocflowAssignmentAssigneeList).</summary>
public sealed record HubDocflowAssignmentAssigneeList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubDocflowAssignmentAssignee>? Items { get; init; }
    [JsonPropertyName("returned")] public int Returned { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
}

/// <summary>
/// Тело POST /docflow/assignments (DocflowAssignmentCreateRequest).
/// Ref-поля — UUID-строки длиной 36; due_at — срок (backend понимает
/// naive datetime как локальное время сервера, как datetime-local в вебе).
/// </summary>
public sealed record HubDocflowAssignmentCreateRequest
{
    /// <summary>internal|incoming|outgoing.</summary>
    public required string DocumentType { get; init; }
    public required string DocumentRef { get; init; }
    public required string AssigneeRef { get; init; }
    public string? ControllerRef { get; init; }
    public required DateTime DueAt { get; init; }
    /// <summary>normal|high.</summary>
    public string Importance { get; init; } = "normal";
    public required string Title { get; init; }
    public required string Description { get; init; }
}

/// <summary>Созданный процесс поручения (DocflowCreatedAssignment).</summary>
public sealed record HubDocflowCreatedAssignment
{
    [JsonPropertyName("process_ref")] public string? ProcessRef { get; init; }
    [JsonPropertyName("task_ref")] public string? TaskRef { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("state")] public string? State { get; init; }
    [JsonPropertyName("task_completed")] public bool? TaskCompleted { get; init; }
}

/// <summary>
/// Ответ POST /docflow/assignments и GET /docflow/assignments/commands/{id}
/// (DocflowAssignmentCommandResponse): pending/state_unknown (HTTP 202)
/// опрашиваются до applied/already_applied/rejected.
/// </summary>
public sealed record HubDocflowAssignmentCommandResult
{
    [JsonPropertyName("command_id")] public string? CommandId { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("assignment")] public HubDocflowCreatedAssignment? Assignment { get; init; }
    [JsonPropertyName("correlation_id")] public string? CorrelationId { get; init; }
    [JsonPropertyName("error_code")] public string? ErrorCode { get; init; }
}

/// <summary>
/// Ответ POST /docflow/profile/test (DocflowConnectionTestResponse):
/// проверка связи по введённым кредам без их сохранения.
/// </summary>
public sealed record HubDocflowConnectionTestResult
{
    [JsonPropertyName("connected")] public bool Connected { get; init; }
    [JsonPropertyName("configuration")] public string? Configuration { get; init; }
    [JsonPropertyName("verified_at")] public DateTimeOffset? VerifiedAt { get; init; }
}

/// <summary>Тип объекта из справочника метаданных 1С (DocflowMetadataType).</summary>
public sealed record HubDocflowMetadataType
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("attributes")] public IReadOnlyList<string>? Attributes { get; init; }
}

/// <summary>
/// Выдача GET /docflow/metadata (DocflowMetadataResponse) — справочник типов
/// задач/процессов конфигурации 1С. Только docflow.admin: для остальных 403.
/// </summary>
public sealed record HubDocflowMetadata
{
    [JsonPropertyName("configuration")] public string? Configuration { get; init; }
    [JsonPropertyName("task_types")] public IReadOnlyList<HubDocflowMetadataType>? TaskTypes { get; init; }
    [JsonPropertyName("process_types")] public IReadOnlyList<HubDocflowMetadataType>? ProcessTypes { get; init; }
    [JsonPropertyName("active_task_type")] public string? ActiveTaskType { get; init; }
    [JsonPropertyName("mapping_ready")] public bool MappingReady { get; init; }
}

/// <summary>Запись об отсутствии из 1С (элемент items выдачи GET /docflow/absences).</summary>
public sealed record HubDocflowAbsenceItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("employee_ref")] public string? EmployeeRef { get; init; }
    /// <summary>Код сотрудника адресной книги; null — связь не подтверждена.</summary>
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    /// <summary>matched|unresolved — удалось ли сопоставить с адресной книгой.</summary>
    [JsonPropertyName("matching_status")] public string? MatchingStatus { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("starts_on")] public string? StartsOn { get; init; }
    [JsonPropertyName("ends_on")] public string? EndsOn { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    /// <summary>available из 1С: будет ли сотрудник разбирать задачи в отсутствие.</summary>
    [JsonPropertyName("will_handle_tasks")] public bool WillHandleTasks { get; init; }
    /// <summary>Поля, расходящиеся с кэшем ЗУП (starts_on|ends_on|kind).</summary>
    [JsonPropertyName("differences")] public IReadOnlyList<string>? Differences { get; init; }
}

/// <summary>
/// Выдача GET /docflow/absences (list_absences сервиса): status=available со
/// списком либо disabled (фича выключена — UI прячет блок, как в вебе).
/// </summary>
public sealed record HubDocflowAbsenceList
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    /// <summary>Дата выборки «на число» (YYYY-MM-DD); без параметра — сегодня.</summary>
    [JsonPropertyName("on")] public string? On { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubDocflowAbsenceItem>? Items { get; init; }
    [JsonPropertyName("count")] public int? Count { get; init; }
    [JsonPropertyName("unresolved_count")] public int? UnresolvedCount { get; init; }
    [JsonPropertyName("as_of")] public DateTimeOffset? AsOf { get; init; }
    /// <summary>available|unavailable — удалось ли сверить записи с кэшем ЗУП.</summary>
    [JsonPropertyName("zup_comparison")] public string? ZupComparison { get; init; }
    [JsonPropertyName("zup_as_of")] public string? ZupAsOf { get; init; }
}

/// <summary>
/// Query для GET /tickets/requests: page-пагинация (page_size ∈ 20/25/50/100),
/// фильтры statuses/object_ids (csv), серверный search (backend берёт от 2 символов),
/// sort_field ∈ SORTABLE_COLUMNS backend'а (id/created_at/updated_at/status/
/// departure_date/arrival_date/submitted_at/total_cost/is_urgent).
/// </summary>
public sealed record HubTicketQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 25;

    /// <summary>csv-статусы: not_started|at_cashier|purchased|exchange_needed|cancel_purchase|refund_needed.</summary>
    public string? Statuses { get; init; }

    /// <summary>csv id объектов выезда.</summary>
    public string? ObjectIds { get; init; }
    public string? Search { get; init; }
    public string SortField { get; init; } = "submitted_at";
    public string SortDir { get; init; } = "desc";
}

/// <summary>
/// Заявка на билет (dict _request_to_dict backend'а). В списке приезжают
/// дополнительные денормализованные поля сотрудника (department/position/phone).
/// Даты и суммы — строки (isoformat / Decimal as str), как у docflow-моделей.
/// </summary>
public record HubTicketRequest
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("employee_id")] public long? EmployeeId { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("object_id")] public long? ObjectId { get; init; }
    [JsonPropertyName("object_code")] public string? ObjectCode { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("assignee_id")] public long? AssigneeId { get; init; }
    [JsonPropertyName("assignee_name")] public string? AssigneeName { get; init; }
    [JsonPropertyName("submitted_at")] public string? SubmittedAt { get; init; }
    [JsonPropertyName("departure_date")] public string? DepartureDate { get; init; }
    [JsonPropertyName("arrival_date")] public string? ArrivalDate { get; init; }
    [JsonPropertyName("route")] public string? Route { get; init; }
    [JsonPropertyName("note")] public string? Note { get; init; }
    [JsonPropertyName("total_cost")] public string? TotalCost { get; init; }
    [JsonPropertyName("refund_loss")] public string? RefundLoss { get; init; }
    [JsonPropertyName("is_urgent")] public bool IsUrgent { get; init; }
    [JsonPropertyName("needs_review")] public bool NeedsReview { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }

    /// <summary>Версия для optimistic locking в PATCH …/status (expected_version).</summary>
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("phone")] public string? Phone { get; init; }
}

/// <summary>Страница GET /tickets/requests (items/total/page/page_size/total_pages).</summary>
public sealed record HubTicketListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketRequest>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>Комментарий заявки (GET/POST …/comments; comment_type: normal|system).</summary>
public sealed record HubTicketComment
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("request_id")] public long RequestId { get; init; }
    [JsonPropertyName("author_id")] public long? AuthorId { get; init; }
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("comment_type")] public string? CommentType { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>Страница GET /tickets/requests/{id}/comments (хронология, старые первыми).</summary>
public sealed record HubTicketCommentPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketComment>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>
/// Запись истории изменений заявки (GET …/history; _history_to_dict backend'а):
/// field_name — status/assignee_id/даты/total_cost/route/note/refund_loss/
/// submitted_at/attachment_deleted (TRACKED_FIELDS сервиса), значения — строки
/// (isoformat, Decimal as str) или null. Записи иммутабельны, лента — новые первыми.
/// </summary>
public sealed record HubTicketHistoryEntry
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("request_id")] public long RequestId { get; init; }
    [JsonPropertyName("field_name")] public string? FieldName { get; init; }
    [JsonPropertyName("old_value")] public string? OldValue { get; init; }
    [JsonPropertyName("new_value")] public string? NewValue { get; init; }
    [JsonPropertyName("changed_by_id")] public long? ChangedById { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>Страница GET /tickets/requests/{id}/history (items/total/page/page_size/total_pages).</summary>
public sealed record HubTicketHistoryPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketHistoryEntry>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>Вложение заявки (GET …/attachments; id — строковый идентификатор файла).</summary>
public sealed record HubTicketAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("request_id")] public long RequestId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("file_type")] public string? FileType { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("uploaded_by_id")] public long? UploadedById { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>Ответ GET /tickets/requests/{id}/attachments ({items}).</summary>
public sealed record HubTicketAttachmentList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketAttachment>? Items { get; init; }
}

/// <summary>Объект выезда из справочника GET /tickets/objects.</summary>
public sealed record HubTicketObject
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("short_name")] public string? ShortName { get; init; }
    [JsonPropertyName("region")] public string? Region { get; init; }
    /// <summary>null (поля нет в ответе) — активен, как `is_active !== false` в вебе.</summary>
    [JsonPropertyName("is_active")] public bool? IsActive { get; init; }
}

/// <summary>Ответ GET /tickets/objects ({items}).</summary>
public sealed record HubTicketObjectList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketObject>? Items { get; init; }
}

/// <summary>
/// Тело POST /tickets/requests (CreateRequestBody backend'а): обязательные
/// employee_id/object_id; status/source клиент шлёт как веб-форма
/// (not_started/manual), submitted_at — день подачи, даты — «yyyy-MM-dd»,
/// route ≤ 500 символов. total_cost/refund_loss в форме не используются.
/// </summary>
public sealed record HubCreateTicketRequest
{
    public long EmployeeId { get; init; }
    public long ObjectId { get; init; }
    public string Status { get; init; } = "not_started";
    public string? SubmittedAt { get; init; }
    public string? DepartureDate { get; init; }
    public string? ArrivalDate { get; init; }
    public string? Route { get; init; }
    public string? Note { get; init; }
    public bool IsUrgent { get; init; }
    public string Source { get; init; } = "manual";
}

/// <summary>Сотрудник справочника билетов (GET /tickets/employees, POST …/from-zup).</summary>
public sealed record HubTicketEmployee
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("phone")] public string? Phone { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("zup_employee_code")] public string? ZupEmployeeCode { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

/// <summary>Страница GET /tickets/employees ({items,total,page,page_size,total_pages}).</summary>
public sealed record HubTicketEmployeePage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketEmployee>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>
/// Человек из ЗУП-поиска (GET /tickets/employees/zup-search): id нет,
/// в заявку попадает через POST …/employees/from-zup по employee_code.
/// </summary>
public sealed record HubTicketZupPerson
{
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("phone")] public string? Phone { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
}

/// <summary>Ответ GET /tickets/employees/zup-search ({items,total,synced_at,source}).</summary>
public sealed record HubTicketZupPersonList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketZupPerson>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
}

/// <summary>
/// Карточка канбан-доски GET /tickets/kanban (_kanban_card_to_dict backend'а):
/// усечённый вид заявки — id, ФИО, объект, дата выезда, маршрут, «срочно»,
/// исполнитель и статус. Сам ответ — dict «русское имя колонки» → карточки.
/// </summary>
public sealed record HubTicketKanbanCard
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
    [JsonPropertyName("departure_date")] public string? DepartureDate { get; init; }
    [JsonPropertyName("route")] public string? Route { get; init; }
    [JsonPropertyName("is_urgent")] public bool IsUrgent { get; init; }
    [JsonPropertyName("assignee_name")] public string? AssigneeName { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

/// <summary>
/// Ответ GET /tickets/dashboard: общие метрики, разрез по объектам и два
/// топ-списка (проблемные объекты, загрузка исполнителей).
/// </summary>
public sealed record HubTicketsDashboard
{
    [JsonPropertyName("metrics")] public HubTicketsDashboardMetrics? Metrics { get; init; }
    [JsonPropertyName("per_object")] public IReadOnlyList<HubTicketsDashboardObject>? PerObject { get; init; }

    /// <summary>Топ-5 объектов по числу проблемных заявок (тот же shape, что per_object).</summary>
    [JsonPropertyName("top_problems")] public IReadOnlyList<HubTicketsDashboardObject>? TopProblems { get; init; }

    /// <summary>Топ-5 исполнителей по числу активных заявок.</summary>
    [JsonPropertyName("top_assignees")] public IReadOnlyList<HubTicketsDashboardAssignee>? TopAssignees { get; init; }
}

/// <summary>Счётчики и суммы сводки билетов (суммы — строки Decimal, как у заявок).</summary>
public sealed record HubTicketsDashboardMetrics
{
    [JsonPropertyName("total_active")] public int TotalActive { get; init; }
    [JsonPropertyName("new")] public int New { get; init; }
    [JsonPropertyName("in_progress")] public int InProgress { get; init; }
    [JsonPropertyName("purchased")] public int Purchased { get; init; }
    [JsonPropertyName("problematic")] public int Problematic { get; init; }
    [JsonPropertyName("departures_today")] public int DeparturesToday { get; init; }
    [JsonPropertyName("departures_tomorrow")] public int DeparturesTomorrow { get; init; }
    [JsonPropertyName("departures_3_days")] public int Departures3Days { get; init; }
    [JsonPropertyName("refunds_exchanges")] public int RefundsExchanges { get; init; }
    [JsonPropertyName("ticket_sum")] public string? TicketSum { get; init; }
    [JsonPropertyName("loss_sum")] public string? LossSum { get; init; }
}

/// <summary>Строка разреза по объекту в сводке (и элемент top_problems).</summary>
public sealed record HubTicketsDashboardObject
{
    [JsonPropertyName("object_id")] public long ObjectId { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
    [JsonPropertyName("object_code")] public string? ObjectCode { get; init; }
    [JsonPropertyName("assignee_name")] public string? AssigneeName { get; init; }
    [JsonPropertyName("active")] public int Active { get; init; }
    [JsonPropertyName("new")] public int New { get; init; }
    [JsonPropertyName("in_progress")] public int InProgress { get; init; }
    [JsonPropertyName("purchased")] public int Purchased { get; init; }
    [JsonPropertyName("problematic")] public int Problematic { get; init; }
    [JsonPropertyName("nearest_departure")] public string? NearestDeparture { get; init; }
    [JsonPropertyName("ticket_sum")] public string? TicketSum { get; init; }
    [JsonPropertyName("loss_sum")] public string? LossSum { get; init; }
}

/// <summary>Строка топа исполнителей по числу активных заявок.</summary>
public sealed record HubTicketsDashboardAssignee
{
    [JsonPropertyName("assignee_id")] public long AssigneeId { get; init; }
    [JsonPropertyName("assignee_name")] public string? AssigneeName { get; init; }
    [JsonPropertyName("active_count")] public int ActiveCount { get; init; }
}

/// <summary>
/// Тело POST/PATCH /tickets/objects (ObjectBody backend'а): все поля опциональны,
/// сервер берёт exclude_unset — клиент сериализует только заданные. Веб-менеджер
/// шлёт {name} при создании и {is_active} при вкл/откл (code присваивает backend).
/// </summary>
public sealed record HubTicketObjectUpsert
{
    public string? Code { get; init; }
    public string? Name { get; init; }
    public string? ShortName { get; init; }
    public string? Region { get; init; }
    public long? DefaultAssigneeId { get; init; }
    public bool? IsActive { get; init; }
}

/// <summary>
/// Документ сотрудника билетов (TicketEmployeeDocument → _document_to_dict backend'а).
/// Паспортные поля приходят открытыми при праве tickets.personal_data.read,
/// иначе замаскированы «** **** ******» — маску нельзя отправлять обратно в PATCH.
/// </summary>
public sealed record HubTicketEmployeeDocument
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("employee_id")] public long EmployeeId { get; init; }
    [JsonPropertyName("passport_series_number")] public string? PassportSeriesNumber { get; init; }
    [JsonPropertyName("passport_series")] public string? PassportSeries { get; init; }
    [JsonPropertyName("passport_number")] public string? PassportNumber { get; init; }
    [JsonPropertyName("issued_by")] public string? IssuedBy { get; init; }
    [JsonPropertyName("issuer_code")] public string? IssuerCode { get; init; }
    [JsonPropertyName("birth_place")] public string? BirthPlace { get; init; }
    [JsonPropertyName("issue_date")] public string? IssueDate { get; init; }
    [JsonPropertyName("registration_address")] public string? RegistrationAddress { get; init; }
    [JsonPropertyName("is_current")] public bool IsCurrent { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// Карточка сотрудника билетов с документами (GET /tickets/employees/{id},
/// POST /employees, PATCH /employees/{id} — все отдают полный dict).
/// </summary>
public sealed record HubTicketEmployeeDetail
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("phone")] public string? Phone { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("zup_employee_code")] public string? ZupEmployeeCode { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("app_user_id")] public long? AppUserId { get; init; }
    [JsonPropertyName("date_of_birth")] public string? DateOfBirth { get; init; }
    [JsonPropertyName("documents")] public IReadOnlyList<HubTicketEmployeeDocument>? Documents { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// Документ в теле POST/PATCH /tickets/employees: без id — создаётся новый,
/// с id текущего документа — правится он (контракт update_employee backend'а).
/// </summary>
public sealed record HubTicketEmployeeDocumentUpsert
{
    public long? Id { get; init; }
    public string? PassportSeries { get; init; }
    public string? PassportNumber { get; init; }
    public string? IssuedBy { get; init; }
    public string? IssuerCode { get; init; }
    public string? BirthPlace { get; init; }
    public string? IssueDate { get; init; }
    public string? RegistrationAddress { get; init; }
}

/// <summary>
/// Тело POST/PATCH /tickets/employees (EmployeeBody backend'а): сервер берёт
/// exclude_unset — незаданные поля не сериализуем (в т.ч. documents — только
/// при реальном вводе паспортных данных, как у веб-карточки).
/// </summary>
public sealed record HubTicketEmployeeUpsert
{
    public string? FullName { get; init; }
    public string? Department { get; init; }
    public string? Position { get; init; }
    public string? Phone { get; init; }
    public string? Email { get; init; }
    public string? ZupEmployeeCode { get; init; }
    public string? Status { get; init; }
    public string? DateOfBirth { get; init; }
    public IReadOnlyList<HubTicketEmployeeDocumentUpsert>? Documents { get; init; }
}

/// <summary>Ответ POST /tickets/import/upload: созданный import-job {id,file_name,status}.</summary>
public sealed record HubTicketImportJob
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

/// <summary>Лист книги в предпросмотре импорта (SheetPreviewInfo backend'а).</summary>
public sealed record HubTicketImportSheet
{
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("classification")] public string? Classification { get; init; }
    [JsonPropertyName("row_count")] public int RowCount { get; init; }
    [JsonPropertyName("headers")] public IReadOnlyList<string>? Headers { get; init; }
    [JsonPropertyName("matched_object_id")] public long? MatchedObjectId { get; init; }
    [JsonPropertyName("matched_object_name")] public string? MatchedObjectName { get; init; }
    [JsonPropertyName("error_count")] public int ErrorCount { get; init; }
}

/// <summary>GET /tickets/import/{job}/preview → ImportPreview backend'а (asdict).</summary>
public sealed record HubTicketImportPreview
{
    [JsonPropertyName("job_id")] public string? JobId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("sheets")] public IReadOnlyList<HubTicketImportSheet>? Sheets { get; init; }
    [JsonPropertyName("color_map")] public IReadOnlyDictionary<string, string>? ColorMap { get; init; }
    [JsonPropertyName("unmatched_sheets")] public IReadOnlyList<string>? UnmatchedSheets { get; init; }
    [JsonPropertyName("unique_colors")] public IReadOnlyList<string>? UniqueColors { get; init; }
}

/// <summary>
/// Тело POST /tickets/import/{job}/execute (ImportSettings backend'а):
/// color_map из предпросмотра, duplicate_strategy skip|update|create,
/// sheet_object_map — «имя листа → id объекта» только для рабочих листов.
/// </summary>
public sealed record HubTicketImportExecute
{
    public IReadOnlyDictionary<string, string> ColorMap { get; init; }
        = new Dictionary<string, string>(StringComparer.Ordinal);
    public string DuplicateStrategy { get; init; } = "skip";
    public IReadOnlyDictionary<string, long> SheetObjectMap { get; init; }
        = new Dictionary<string, long>(StringComparer.Ordinal);
}

/// <summary>Деталь ошибки/предупреждения импорта: {sheet,row,error|warning}.</summary>
public sealed record HubTicketImportIssue
{
    [JsonPropertyName("sheet")] public string? Sheet { get; init; }
    [JsonPropertyName("row")] public int? Row { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("warning")] public string? Warning { get; init; }
}

/// <summary>POST /tickets/import/{job}/execute → ImportResult backend'а (asdict).</summary>
public sealed record HubTicketImportResult
{
    [JsonPropertyName("imported")] public int Imported { get; init; }
    [JsonPropertyName("skipped")] public int Skipped { get; init; }
    [JsonPropertyName("errors")] public int Errors { get; init; }
    [JsonPropertyName("warnings")] public int Warnings { get; init; }
    [JsonPropertyName("error_details")] public IReadOnlyList<HubTicketImportIssue>? ErrorDetails { get; init; }
    [JsonPropertyName("warning_details")] public IReadOnlyList<HubTicketImportIssue>? WarningDetails { get; init; }
}

/// <summary>
/// Финансовая операция билетов (GET/POST /tickets/financial-ops, _financial_op_to_dict):
/// amount — Decimal строкой, op_date — isoformat или null, is_deleted — мягкое удаление.
/// </summary>
public sealed record HubTicketFinancialOp
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("request_id")] public long? RequestId { get; init; }
    [JsonPropertyName("employee_id")] public long? EmployeeId { get; init; }
    [JsonPropertyName("object_id")] public long? ObjectId { get; init; }
    [JsonPropertyName("op_type")] public string? OpType { get; init; }
    [JsonPropertyName("amount")] public string? Amount { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("refund_status")] public string? RefundStatus { get; init; }
    [JsonPropertyName("op_date")] public string? OpDate { get; init; }
    [JsonPropertyName("is_deleted")] public bool IsDeleted { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Страница GET /tickets/financial-ops ({items,total,page,page_size,total_pages}).</summary>
public sealed record HubTicketFinancialOpPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketFinancialOp>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>Фильтры GET /tickets/financial-ops (FinOpFilters backend'а + page-пагинация).</summary>
public sealed record HubTicketFinOpQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
    public long? RequestId { get; init; }
    public long? EmployeeId { get; init; }
    public long? ObjectId { get; init; }
    public string? OpType { get; init; }
    public string? RefundStatus { get; init; }
    public string? DateFrom { get; init; }
    public string? DateTo { get; init; }
    public bool IncludeDeleted { get; init; }
}

/// <summary>
/// Тело POST/PATCH /tickets/financial-ops (FinancialOpBody): сервер берёт
/// exclude_unset; op_type ∈ loss|refund|exchange, amount — Decimal строкой
/// (отрицательная → 422), op_date — «yyyy-MM-dd».
/// </summary>
public sealed record HubTicketFinancialOpUpsert
{
    public long? RequestId { get; init; }
    public long? EmployeeId { get; init; }
    public long? ObjectId { get; init; }
    public string? OpType { get; init; }
    public string? Amount { get; init; }
    public string? Reason { get; init; }
    public string? RefundStatus { get; init; }
    public string? OpDate { get; init; }
}

/// <summary>
/// Фильтры отчёта потерь GET /tickets/reports/losses (также уходит на /losses/export):
/// период ≤ 366 дней (дефолт сервера — текущий месяц), page_size ≤ 50.
/// </summary>
public sealed record HubTicketLossesQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
    public string? DateFrom { get; init; }
    public string? DateTo { get; init; }
    public long? ObjectId { get; init; }
    public string? OpType { get; init; }
}

/// <summary>Строка отчёта потерь (_loss_report_item_to_dict backend'а).</summary>
public sealed record HubTicketLossItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("object_name")] public string? ObjectName { get; init; }
    [JsonPropertyName("op_date")] public string? OpDate { get; init; }
    [JsonPropertyName("amount")] public string? Amount { get; init; }
    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("op_type")] public string? OpType { get; init; }
    [JsonPropertyName("op_type_label")] public string? OpTypeLabel { get; init; }
    [JsonPropertyName("refund_status")] public string? RefundStatus { get; init; }
}

/// <summary>Сводка отчёта потерь (Decimal-строки): потери, возвраты и баланс.</summary>
public sealed record HubTicketLossTotals
{
    [JsonPropertyName("total_losses")] public string? TotalLosses { get; init; }
    [JsonPropertyName("total_refunds")] public string? TotalRefunds { get; init; }
    [JsonPropertyName("balance")] public string? Balance { get; init; }
}

/// <summary>Пагинация отчёта потерь (вложенный объект pagination, не корневой как у списков).</summary>
public sealed record HubTicketLossPagination
{
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("page_size")] public int PageSize { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("total_pages")] public int TotalPages { get; init; }
}

/// <summary>GET /tickets/reports/losses → {items, totals, pagination}.</summary>
public sealed record HubTicketLossReport
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketLossItem>? Items { get; init; }
    [JsonPropertyName("totals")] public HubTicketLossTotals? Totals { get; init; }
    [JsonPropertyName("pagination")] public HubTicketLossPagination? Pagination { get; init; }
}

/// <summary>Правило SLA-уведомлений билетов (GET /tickets/notifications/rules, tickets.write).</summary>
public sealed record HubTicketNotificationRule
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("rule_type")] public string? RuleType { get; init; }
    [JsonPropertyName("is_enabled")] public bool IsEnabled { get; init; }
    [JsonPropertyName("threshold_days")] public int? ThresholdDays { get; init; }
    [JsonPropertyName("notify_roles")] public string? NotifyRoles { get; init; }
}

/// <summary>Ответ GET /tickets/notifications/rules ({items}).</summary>
public sealed record HubTicketNotificationRuleList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketNotificationRule>? Items { get; init; }
}

/// <summary>
/// Тело PATCH /tickets/notifications/rules/{id} (NotificationRuleBody, admin на сервере):
/// только изменённые поля — is_enabled / threshold_days (0–365) / notify_roles.
/// </summary>
public sealed record HubTicketNotificationRulePatch
{
    public bool? IsEnabled { get; init; }
    public int? ThresholdDays { get; init; }
    public string? NotifyRoles { get; init; }
}

/// <summary>Отложенное SLA-уведомление (GET /tickets/notifications/pending, Notification.to_dict).</summary>
public sealed record HubTicketPendingNotification
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("rule_type")] public string? RuleType { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("request_id")] public long? RequestId { get; init; }
    [JsonPropertyName("financial_op_id")] public long? FinancialOpId { get; init; }
    [JsonPropertyName("severity")] public string? Severity { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>Ответ GET /tickets/notifications/pending ({items}).</summary>
public sealed record HubTicketPendingNotificationList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubTicketPendingNotification>? Items { get; init; }
}

/// <summary>
/// Query для GET /address-book/search: серверный поиск по ФИО, должности,
/// подразделению, городу, телефону и e-mail (backend токенизирует сам,
/// минимальной длины нет), offset-пагинация (limit ≤ 200) и точные фильтры
/// department/city (город — это department_location записи).
/// </summary>
public sealed record HubAddressBookQuery
{
    public string? Search { get; init; }
    public int Limit { get; init; } = 50;
    public int Offset { get; init; }
    public string? Department { get; init; }
    public string? City { get; init; }
}

/// <summary>Контактное значение записи адресной книги (телефон/e-mail: value+kind+normalized).</summary>
public sealed record HubAddressBookContactValue
{
    [JsonPropertyName("value")] public string? Value { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("normalized")] public string? Normalized { get; init; }
}

/// <summary>
/// Сотрудник адресной книги (элемент items ответа /search). Возраст, ИНН,
/// дата приёма и личные контакты приходят только при соответствующих правах —
/// поля толерантны к отсутствию. photo_url ведёт на авторизованный endpoint
/// (Bearer) — контент грузится через DownloadImageAsync/AuthImageLoader,
/// до его прихода и при ошибке нативный клиент показывает инициалы, как в чате.
/// </summary>
public sealed record HubAddressBookItem
{
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_code")] public string? DepartmentCode { get; init; }
    [JsonPropertyName("department_location")] public string? DepartmentLocation { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    [JsonPropertyName("middle_name")] public string? MiddleName { get; init; }
    [JsonPropertyName("office_address")] public string? OfficeAddress { get; init; }
    [JsonPropertyName("office_room")] public string? OfficeRoom { get; init; }
    [JsonPropertyName("workplace_number")] public string? WorkplaceNumber { get; init; }
    [JsonPropertyName("work_phones")]
    public IReadOnlyList<HubAddressBookContactValue>? WorkPhones { get; init; }
    [JsonPropertyName("personal_phones")]
    public IReadOnlyList<HubAddressBookContactValue>? PersonalPhones { get; init; }
    [JsonPropertyName("work_emails")]
    public IReadOnlyList<HubAddressBookContactValue>? WorkEmails { get; init; }
    [JsonPropertyName("personal_emails")]
    public IReadOnlyList<HubAddressBookContactValue>? PersonalEmails { get; init; }
    [JsonPropertyName("dismissal_date")] public string? DismissalDate { get; init; }
    [JsonPropertyName("hire_date")] public string? HireDate { get; init; }
    [JsonPropertyName("age")] public int? Age { get; init; }
    [JsonPropertyName("inn")] public string? Inn { get; init; }
    [JsonPropertyName("photo_url")] public string? PhotoUrl { get; init; }
}

/// <summary>Страница GET /address-book/search (items/total/has_more + мета синхронизации).</summary>
public sealed record HubAddressBookPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAddressBookItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("dismissed")] public bool Dismissed { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
    [JsonPropertyName("last_error")] public string? LastError { get; init; }
    [JsonPropertyName("last_sync_failed")] public bool LastSyncFailed { get; init; }
}

/// <summary>Опция справочника фильтров адресной книги ({name, count}).</summary>
public sealed record HubAddressBookFilterOption
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Ответ GET /address-book/filters: подразделения и города для фильтров списка.</summary>
public sealed record HubAddressBookFilters
{
    [JsonPropertyName("departments")]
    public IReadOnlyList<HubAddressBookFilterOption>? Departments { get; init; }
    [JsonPropertyName("cities")]
    public IReadOnlyList<HubAddressBookFilterOption>? Cities { get; init; }
}

// ---- Мои файлы: общие папки (библиотеки) и личный диск (/my-files) ----

/// <summary>
/// Общая папка «Моих файлов» (библиотека): элемент items ответа
/// GET /my-files/libraries. my_role: manage|edit|comment|view.
/// </summary>
public sealed record HubMyFileLibrary
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("quota_bytes")] public long QuotaBytes { get; init; }
    [JsonPropertyName("used_bytes")] public long UsedBytes { get; init; }
    [JsonPropertyName("files_count")] public int FilesCount { get; init; }
    [JsonPropertyName("members_count")] public int MembersCount { get; init; }
    [JsonPropertyName("my_role")] public string? MyRole { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /my-files/libraries: {items, can_manage}.</summary>
public sealed record HubMyFileLibraryList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMyFileLibrary>? Items { get; init; }
    [JsonPropertyName("can_manage")] public bool CanManage { get; init; }
}

/// <summary>
/// Папка «Моих файлов» (MyFileFolderResponse): и в folders текущей выдачи,
/// и в breadcrumbs пути. is_shared — есть активная публичная ссылка.
/// </summary>
public sealed record HubMyFileFolder
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("parent_id")] public string? ParentId { get; init; }
    [JsonPropertyName("file_count")] public int FileCount { get; init; }
    [JsonPropertyName("is_shared")] public bool IsShared { get; init; }
    [JsonPropertyName("is_favorite")] public bool IsFavorite { get; init; }
    [JsonPropertyName("my_role")] public string? MyRole { get; init; }
    [JsonPropertyName("library_id")] public string? LibraryId { get; init; }
    [JsonPropertyName("library_name")] public string? LibraryName { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
}

/// <summary>
/// Файл «Моих файлов» (MyFileResponse): поля списка и действий.
/// status: uploading|queued|scanning|processing|ready|failed —
/// скачивать можно только ready (backend: "Only ready files can be downloaded").
/// </summary>
public sealed record HubMyFileItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("original_file_name")] public string? OriginalFileName { get; init; }
    [JsonPropertyName("download_file_name")] public string? DownloadFileName { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("original_size_bytes")] public long OriginalSizeBytes { get; init; }
    [JsonPropertyName("retention_days")] public int RetentionDays { get; init; }
    [JsonPropertyName("folder_id")] public string? FolderId { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("error_text")] public string? ErrorText { get; init; }
    [JsonPropertyName("is_shared")] public bool IsShared { get; init; }
    [JsonPropertyName("is_favorite")] public bool IsFavorite { get; init; }
    [JsonPropertyName("my_role")] public string? MyRole { get; init; }
    [JsonPropertyName("owner_username")] public string? OwnerUsername { get; init; }
    [JsonPropertyName("folder_name")] public string? FolderName { get; init; }
    [JsonPropertyName("library_id")] public string? LibraryId { get; init; }
    [JsonPropertyName("library_name")] public string? LibraryName { get; init; }
    /// <summary>image|pdf|office|video|text|unsupported — по полю GET …/preview решается рендер.</summary>
    [JsonPropertyName("preview_kind")] public string? PreviewKind { get; init; }
    /// <summary>Сервер готов отдать /preview/content — гейт кнопки предпросмотра.</summary>
    [JsonPropertyName("preview_available")] public bool PreviewAvailable { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
}

/// <summary>Метка библиотеки в ответе списка файлов (MyFileLibraryInfo).</summary>
public sealed record HubMyFileLibraryInfo
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("my_role")] public string? MyRole { get; init; }
}

/// <summary>
/// Ответ GET /my-files?folder_id=&library_id= (MyFileListResponse):
/// файлы и папки текущего места + путь для хлебных крошек.
/// </summary>
public sealed record HubMyFileListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMyFileItem>? Items { get; init; }
    [JsonPropertyName("folders")] public IReadOnlyList<HubMyFileFolder>? Folders { get; init; }
    [JsonPropertyName("breadcrumbs")] public IReadOnlyList<HubMyFileFolder>? Breadcrumbs { get; init; }
    [JsonPropertyName("folder")] public HubMyFileFolder? Folder { get; init; }
    [JsonPropertyName("library")] public HubMyFileLibraryInfo? Library { get; init; }
}

/// <summary>
/// Тело POST /my-files/upload-sessions (MyFileUploadSessionCreateRequest).
/// Загрузка — сессионная, чанками (не multipart).
/// </summary>
public sealed record HubMyFileUploadSessionCreate
{
    [JsonPropertyName("file_name")] public string FileName { get; init; } = string.Empty;
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("retention_days")] public int RetentionDays { get; init; } = 1;
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("folder_id")] public string? FolderId { get; init; }
    [JsonPropertyName("library_id")] public string? LibraryId { get; init; }
}

/// <summary>
/// Ответ upload-sessions и PUT …/chunks (MyFileUploadSessionResponse):
/// file_id сессии, размер чанка сервера и принятые диапазоны [start,end).
/// </summary>
public sealed record HubMyFileUploadSession
{
    [JsonPropertyName("file_id")] public string? FileId { get; init; }
    [JsonPropertyName("chunk_size_bytes")] public int ChunkSizeBytes { get; init; }
    [JsonPropertyName("uploaded_bytes")] public long UploadedBytes { get; init; }
    [JsonPropertyName("file_size_bytes")] public long FileSizeBytes { get; init; }
    [JsonPropertyName("ranges")] public IReadOnlyList<long[]>? Ranges { get; init; }
    [JsonPropertyName("complete")] public bool Complete { get; init; }
}

/// <summary>
/// Ответ POST /my-files/{id}/download-grant (MyFileDownloadGrantResponse):
/// одноразовый путь вида «/my-files/download-grant/{token}» (относительно /api/v1).
/// </summary>
public sealed record HubMyFileDownloadGrant
{
    [JsonPropertyName("download_path")] public string? DownloadPath { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
    [JsonPropertyName("expires_in_seconds")] public int ExpiresInSeconds { get; init; }
}

/// <summary>
/// Ответ POST /my-files/{id}/share и POST /my-files/folders/{id}/share
/// (MyFileShareResponse): token + public_path веб-маршрута
/// («/shared-files/{token}» или «/shared-folders/{token}») и expires_at —
/// у файла срок жизни самого файла, у папки null (бессрочно).
/// </summary>
public sealed record HubMyFileShare
{
    [JsonPropertyName("token")] public string? Token { get; init; }
    [JsonPropertyName("public_path")] public string? PublicPath { get; init; }
    [JsonPropertyName("expires_at")] public DateTimeOffset? ExpiresAt { get; init; }
}

// ---- Структура компании (/company-structure, чтение) ----

/// <summary>
/// Узел оргструктуры (CompanyStructureNodeResponse). GET /company-structure/tree
/// возвращает дерево целиком: дети вложены в children, поуровневой выгрузки нет.
/// node_type: root|block|deputy|service|directorate|department|group|other;
/// у person-узлов (root/deputy) имя руководителя — в person_полях.
/// </summary>
public sealed record HubCompanyStructureNode
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("parent_id")] public string? ParentId { get; init; }
    [JsonPropertyName("node_type")] public string? NodeType { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("person_name")] public string? PersonName { get; init; }
    [JsonPropertyName("person_position")] public string? PersonPosition { get; init; }
    [JsonPropertyName("person_employee_code")] public string? PersonEmployeeCode { get; init; }
    [JsonPropertyName("person_photo_url")] public string? PersonPhotoUrl { get; init; }
    [JsonPropertyName("direct_people_count")] public int DirectPeopleCount { get; init; }
    [JsonPropertyName("subtree_people_count")] public int SubtreePeopleCount { get; init; }
    [JsonPropertyName("child_node_count")] public int ChildNodeCount { get; init; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("department_codes")] public IReadOnlyList<string>? DepartmentCodes { get; init; }
    [JsonPropertyName("children")] public IReadOnlyList<HubCompanyStructureNode>? Children { get; init; }
}

/// <summary>Ответ GET /company-structure/tree (items — корневые узлы, count — всего узлов).</summary>
public sealed record HubCompanyStructureTree
{
    [JsonPropertyName("items")] public IReadOnlyList<HubCompanyStructureNode>? Items { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>
/// Сотрудник узла (CompanyStructureWorkPerson): allowlist без личных полей —
/// только рабочие телефоны/e-mail, как в веб-справочнике сотрудников.
/// </summary>
public sealed record HubCompanyStructurePerson
{
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_location")] public string? DepartmentLocation { get; init; }
    [JsonPropertyName("work_phones")] public IReadOnlyList<string>? WorkPhones { get; init; }
    [JsonPropertyName("work_emails")] public IReadOnlyList<string>? WorkEmails { get; init; }
}

/// <summary>Ответ GET /company-structure/nodes/{id}/people.</summary>
public sealed record HubCompanyStructurePeople
{
    [JsonPropertyName("node")] public HubCompanyStructureNode? Node { get; init; }
    [JsonPropertyName("department_codes")] public IReadOnlyList<string>? DepartmentCodes { get; init; }
    [JsonPropertyName("matched_by_title")] public bool MatchedByTitle { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubCompanyStructurePerson>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
}

/// <summary>Элемент пути к узлу в ответе /company-structure/search ({id,title}).</summary>
public sealed record HubCompanyStructurePathItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
}

/// <summary>
/// Элемент GET /company-structure/search: kind=node — подразделение
/// (title — имя узла), kind=person — сотрудник (title — ФИО, subtitle — должность).
/// node_id у person — узел, к которому сматчился по коду/имени подразделения (может быть пустым).
/// </summary>
public sealed record HubCompanyStructureSearchItem
{
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("node_id")] public string? NodeId { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("subtitle")] public string? Subtitle { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_location")] public string? DepartmentLocation { get; init; }
    [JsonPropertyName("work_phones")] public IReadOnlyList<string>? WorkPhones { get; init; }
    [JsonPropertyName("work_emails")] public IReadOnlyList<string>? WorkEmails { get; init; }
    [JsonPropertyName("path")] public IReadOnlyList<HubCompanyStructurePathItem>? Path { get; init; }
}

/// <summary>Ответ GET /company-structure/search?q=&limit=.</summary>
public sealed record HubCompanyStructureSearchResult
{
    [JsonPropertyName("items")] public IReadOnlyList<HubCompanyStructureSearchItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
}

// ---- ИТ-объекты (/it-objects, read-срез: список, карточка, состав) ----

/// <summary>Айтишник объекта (owner): кто отвечает за объект в реестре.</summary>
public sealed record HubItObjectOwner
{
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("user_name")] public string? UserName { get; init; }
    [JsonPropertyName("valid_from")] public string? ValidFrom { get; init; }
}

/// <summary>
/// my_access: доступ вызывающего к разделам объекта.
/// is_owner — вызывающий и есть айтишник (тогда все разделы manage);
/// sections — выданные гранты {section: view|manage}, ключи:
/// passwords|computers|inventory|monitoring|netmap.
/// </summary>
public sealed record HubItObjectAccess
{
    [JsonPropertyName("is_owner")] public bool IsOwner { get; init; }
    [JsonPropertyName("sections")] public IReadOnlyDictionary<string, string>? Sections { get; init; }
}

/// <summary>
/// Строка списка GET /it-objects (items[]). object_ref вида "ITINVENT:5"
/// (филиал-источник) или "OBJ-HUB:…" (ручной объект); hidden=true — скрытый
/// («удалённый») объект, виден только администратору.
/// </summary>
public sealed record HubItObject
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("owner")] public HubItObjectOwner? Owner { get; init; }
    [JsonPropertyName("my_access")] public HubItObjectAccess? MyAccess { get; init; }
    [JsonPropertyName("custom")] public bool Custom { get; init; }
    [JsonPropertyName("linked")] public bool Linked { get; init; }
    [JsonPropertyName("hidden")] public bool Hidden { get; init; }
}

/// <summary>
/// Ответ GET /it-objects?q=&mine=&hidden=. Серверной пагинации у контракта нет:
/// backend отдаёт всю выдачу за один ответ (внутренний лимит 500), сортировка
/// по имени. can_manage — флаг права it_objects.manage (фильтр «Удалённые»).
/// </summary>
public sealed record HubItObjectList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubItObject>? Items { get; init; }
    [JsonPropertyName("source_db_id")] public string? SourceDatabaseId { get; init; }
    [JsonPropertyName("can_manage")] public bool CanManage { get; init; }
}

/// <summary>
/// Роль постоянной команды объекта (team[] карточки): сотрудник из справочника
/// ЗУП. role_key: project_lead|pto_manager|umto_coordinator|chief_project_engineer.
/// </summary>
public sealed record HubItObjectTeamRole
{
    [JsonPropertyName("role_key")] public string? RoleKey { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_location")] public string? DepartmentLocation { get; init; }
    [JsonPropertyName("valid_from")] public string? ValidFrom { get; init; }
    [JsonPropertyName("valid_to")] public string? ValidTo { get; init; }
}

/// <summary>Выданный доступ к разделу (grants[] карточки — виден владельцу и администратору).</summary>
public sealed record HubItObjectGrant
{
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("user_name")] public string? UserName { get; init; }
    [JsonPropertyName("section")] public string? Section { get; init; }
    [JsonPropertyName("level")] public string? Level { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>
/// Карточка объекта GET /it-objects/{ref}: реквизиты строки списка + доступы,
/// команда и гранты. team_history (история назначений) в срез не входит.
/// </summary>
public sealed record HubItObjectDetail
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("source_db_id")] public string? SourceDatabaseId { get; init; }
    [JsonPropertyName("custom")] public bool Custom { get; init; }
    [JsonPropertyName("linked")] public bool Linked { get; init; }
    [JsonPropertyName("hidden")] public bool Hidden { get; init; }
    [JsonPropertyName("owner")] public HubItObjectOwner? Owner { get; init; }
    [JsonPropertyName("my_access")] public HubItObjectAccess? MyAccess { get; init; }
    [JsonPropertyName("can_manage_owner")] public bool CanManageOwner { get; init; }
    [JsonPropertyName("can_manage_grants")] public bool CanManageGrants { get; init; }
    [JsonPropertyName("grants")] public IReadOnlyList<HubItObjectGrant>? Grants { get; init; }
    [JsonPropertyName("team")] public IReadOnlyList<HubItObjectTeamRole>? Team { get; init; }
}

/// <summary>
/// Компьютер объекта (items[] GET /it-objects/{ref}/computers) — ограниченный
/// «мобильный» набор полей агента. status: online|stale|offline|unknown.
/// </summary>
public sealed record HubItObjectComputer
{
    [JsonPropertyName("mac_address")] public string? MacAddress { get; init; }
    [JsonPropertyName("hostname")] public string? Hostname { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("user_full_name")] public string? UserFullName { get; init; }
    [JsonPropertyName("user_login")] public string? UserLogin { get; init; }
    [JsonPropertyName("ip_primary")] public string? IpPrimary { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
    [JsonPropertyName("inventory_inv_no")] public string? InventoryInvNo { get; init; }
    [JsonPropertyName("inventory_model_name")] public string? InventoryModelName { get; init; }
    [JsonPropertyName("system_serial")] public string? SystemSerial { get; init; }
    [JsonPropertyName("last_seen_at")] public double? LastSeenAt { get; init; }
}

/// <summary>Ответ GET /it-objects/{ref}/computers (object_ref + database_id + items).</summary>
public sealed record HubItObjectComputersPage
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("database_id")] public string? DatabaseId { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubItObjectComputer>? Items { get; init; }
}

/// <summary>
/// Позиция оборудования объекта (items[] GET /it-objects/{ref}/inventory) —
/// строка из реестра ITINVENT с полями в нижнем регистре (как у веб-таблицы).
/// </summary>
public sealed record HubItObjectInventoryItem
{
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("vendor_name")] public string? VendorName { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("part_no")] public string? PartNo { get; init; }
    [JsonPropertyName("ip_address")] public string? IpAddress { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_dept")] public string? EmployeeDept { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
}

/// <summary>
/// Ответ GET /it-objects/{ref}/inventory?page=&limit= — единственный из
/// объектных разделов с серверной пагинацией (page/limit/pages + total).
/// </summary>
public sealed record HubItObjectInventoryPage
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("database_id")] public string? DatabaseId { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubItObjectInventoryItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("pages")] public int Pages { get; init; }
}

/// <summary>Текущее состояние цели мониторинга (current{} из overview).</summary>
public sealed record HubItObjectMonitoringCurrent
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("snmp_status")] public string? SnmpStatus { get; init; }
    [JsonPropertyName("open_events")] public int? OpenEvents { get; init; }
    [JsonPropertyName("latency_ms")] public double? LatencyMs { get; init; }
}

/// <summary>Эпизод обрыва/линка (outages[] из overview): kind=unreachable|link.</summary>
public sealed record HubItObjectMonitoringOutage
{
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("interface_name")] public string? InterfaceName { get; init; }
    [JsonPropertyName("interface_role")] public string? InterfaceRole { get; init; }
    [JsonPropertyName("opened_at")] public string? OpenedAt { get; init; }
    [JsonPropertyName("closed_at")] public string? ClosedAt { get; init; }
}

/// <summary>Устройство мониторинга объекта (targets[] из overview; id — uuid-строка).</summary>
public sealed record HubItObjectMonitoringTarget
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("address")] public string? Address { get; init; }
    [JsonPropertyName("port")] public int? Port { get; init; }
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("current")] public HubItObjectMonitoringCurrent? Current { get; init; }
    [JsonPropertyName("outages")] public IReadOnlyList<HubItObjectMonitoringOutage>? Outages { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /it-objects/{ref}/monitoring: object_ref + targets[] + worker + checked_at.</summary>
public sealed record HubItObjectMonitoringOverview
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("targets")] public IReadOnlyList<HubItObjectMonitoringTarget>? Targets { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
}

/// <summary>
/// Точка истории задержки устройства мониторинга (points[] GET
/// /it-objects/{ref}/monitoring/targets/{target_id}/latency-history).
/// latency_ms null — пропуск/недоступность (разрыв графика); latency_ms_min/max —
/// коридор агрегированной точки, quality_status — состояние опроса слота.
/// </summary>
public sealed record HubMonitoringLatencyPoint
{
    [JsonPropertyName("at")] public string? At { get; init; }
    [JsonPropertyName("latency_ms")] public double? LatencyMs { get; init; }
    [JsonPropertyName("latency_ms_min")] public double? LatencyMsMin { get; init; }
    [JsonPropertyName("latency_ms_max")] public double? LatencyMsMax { get; init; }
    [JsonPropertyName("quality_status")] public string? QualityStatus { get; init; }
    [JsonPropertyName("source_resolution_seconds")] public int? SourceResolutionSeconds { get; init; }
}

/// <summary>
/// Ответ GET /it-objects/{ref}/monitoring/targets/{target_id}/latency-history?hours=:
/// points[] + resolution_seconds (шаг сетки; totals/has_data в срез не входят).
/// </summary>
public sealed record HubMonitoringLatencyHistory
{
    [JsonPropertyName("points")] public IReadOnlyList<HubMonitoringLatencyPoint>? Points { get; init; }
    [JsonPropertyName("resolution_seconds")] public int? ResolutionSeconds { get; init; }
}

/// <summary>
/// Версия схемы карты сети объекта (items[] GET /it-objects/{ref}/netmap/versions) —
/// метаданные снапшота drawio: номер версии, имя файла, кто и когда сохранил.
/// Сам XML версии отдаёт GET …/netmap/versions/{version} — в нативный срез не входит.
/// </summary>
public sealed record HubItObjectNetmapVersion
{
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("saved_at")] public string? SavedAt { get; init; }
    [JsonPropertyName("saved_by")] public string? SavedBy { get; init; }
    [JsonPropertyName("saved_by_user_id")] public long SavedByUserId { get; init; }
}

/// <summary>
/// Ответ GET /it-objects/{ref}/netmap/versions: object_ref + items[],
/// отсортированный по version desc (новая версия сверху).
/// </summary>
public sealed record HubItObjectNetmapVersionsResponse
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubItObjectNetmapVersion>? Items { get; init; }
}

/// <summary>
/// Запись журнала аудита секретов объекта (items[] GET
/// /it-objects/{ref}/passwords/audit) — результат
/// password_vault_service.list_object_audit: кто и когда создавал, менял,
/// архивировал или раскрывал пароли объекта. action:
/// create|update|archive|reveal.show|reveal.copy. Значения секретов контракт
/// не отдаёт; ip_address/user_agent из объектного журнала backend вырезает —
/// здесь их нет (остаются только в общем админ-аудите /passwords/audit).
/// </summary>
public sealed record HubItObjectPasswordAuditItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("entry_id")] public string? EntryId { get; init; }
    [JsonPropertyName("action")] public string? Action { get; init; }
    [JsonPropertyName("actor_user_id")] public long ActorUserId { get; init; }
    [JsonPropertyName("actor_username")] public string? ActorUsername { get; init; }
    [JsonPropertyName("entry_group")] public string? EntryGroup { get; init; }
    [JsonPropertyName("entry_login")] public string? EntryLogin { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
}

/// <summary>
/// Ответ GET /it-objects/{ref}/passwords/audit?limit=: object_ref + items[]
/// по created_at desc. Endpoint требует manage-доступ к разделу passwords
/// объекта (владелец или грант manage) — иначе 403.
/// </summary>
public sealed record HubItObjectPasswordAuditResponse
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubItObjectPasswordAuditItem>? Items { get; init; }
}

// ---- База знаний (/kb, read-срез: категории и статьи) ----

/// <summary>
/// Раздел базы знаний (KbCategoryResponse): плоский список GET /kb/categories
/// (иерархии нет; article.category ссылается на id раздела в нижнем регистре).
/// </summary>
public sealed record HubKbCategory
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("order")] public int Order { get; init; }
    [JsonPropertyName("total_articles")] public int TotalArticles { get; init; }
    [JsonPropertyName("published_articles")] public int PublishedArticles { get; init; }
}

/// <summary>Элемент «Вопросы и ответы» тела статьи (KbFaqItem).</summary>
public sealed record HubKbFaqItem
{
    [JsonPropertyName("question")] public string? Question { get; init; }
    [JsonPropertyName("answer")] public string? Answer { get; init; }
}

/// <summary>
/// Тело статьи (KbContentBlock) — структурированные секции, не markdown:
/// текстовые overview/symptoms/escalation, списки checks/commands/
/// resolution_steps/rollback_steps и пары вопрос-ответ faq.
/// </summary>
public sealed record HubKbContentBlock
{
    [JsonPropertyName("overview")] public string? Overview { get; init; }
    [JsonPropertyName("symptoms")] public string? Symptoms { get; init; }
    [JsonPropertyName("checks")] public IReadOnlyList<string>? Checks { get; init; }
    [JsonPropertyName("commands")] public IReadOnlyList<string>? Commands { get; init; }
    [JsonPropertyName("resolution_steps")] public IReadOnlyList<string>? ResolutionSteps { get; init; }
    [JsonPropertyName("rollback_steps")] public IReadOnlyList<string>? RollbackSteps { get; init; }
    [JsonPropertyName("escalation")] public string? Escalation { get; init; }
    [JsonPropertyName("faq")] public IReadOnlyList<HubKbFaqItem>? Faq { get; init; }
}

/// <summary>Вложение статьи (KbAttachmentResponse; сам файл — GET …/attachments/{id}).</summary>
public sealed record HubKbAttachment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("content_type")] public string? ContentType { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("uploaded_at")] public string? UploadedAt { get; init; }
    [JsonPropertyName("uploaded_by")] public string? UploadedBy { get; init; }
}

/// <summary>
/// Статья базы знаний (KbArticleResponse): и в списке, и в детали одна модель;
/// article_type: runbook|faq|template|note; status: draft|published|archived.
/// </summary>
public sealed record HubKbArticle
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("article_type")] public string? ArticleType { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("summary")] public string? Summary { get; init; }
    [JsonPropertyName("tags")] public IReadOnlyList<string>? Tags { get; init; }
    [JsonPropertyName("owner_name")] public string? OwnerName { get; init; }
    [JsonPropertyName("department_name")] public string? DepartmentName { get; init; }
    [JsonPropertyName("visibility_scope")] public string? VisibilityScope { get; init; }
    [JsonPropertyName("version")] public int Version { get; init; }
    [JsonPropertyName("last_reviewed_at")] public string? LastReviewedAt { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public DateTimeOffset? UpdatedAt { get; init; }
    [JsonPropertyName("created_by")] public string? CreatedBy { get; init; }
    [JsonPropertyName("updated_by")] public string? UpdatedBy { get; init; }
    [JsonPropertyName("content")] public HubKbContentBlock? Content { get; init; }
    [JsonPropertyName("attachments")] public IReadOnlyList<HubKbAttachment>? Attachments { get; init; }
}

/// <summary>Ответ GET /kb/articles — offset-страница {items,total,limit,offset}.</summary>
public sealed record HubKbArticleListPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubKbArticle>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
}

/// <summary>Фильтр GET /kb/articles: серверный q-поиск, category, status + пагинация.</summary>
public sealed record HubKbArticleQuery
{
    public string? Search { get; init; }
    public string? Category { get; init; }
    public string? Status { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

// ---- База ITINVENT (/equipment, read-срез: поиск, карточка, справочник типов, метаданные фото) ----

/// <summary>
/// Строка универсального поиска GET /equipment/search/universal и карточка
/// GET /equipment/{inv_no}: один тип на оба ответа — у детали ключи статуса
/// и помещения другие ("status"/"location", без "_name"), плюс DESCRIPTION.
/// INV_NO в ITINVENT — float, поэтому double.
/// </summary>
public sealed record HubEquipmentItem
{
    [JsonPropertyName("id")] public long? Id { get; init; }
    [JsonPropertyName("inv_no")] public double? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("part_no")] public string? PartNo { get; init; }
    [JsonPropertyName("ci_type")] public int? CiType { get; init; }
    [JsonPropertyName("type_no")] public int? TypeNo { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
    [JsonPropertyName("model_no")] public int? ModelNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("vendor_no")] public int? VendorNo { get; init; }
    [JsonPropertyName("vendor_name")] public string? VendorName { get; init; }
    [JsonPropertyName("status_no")] public int? StatusNo { get; init; }
    /// <summary>Статус в строке поиска (s.DESCR as status_name).</summary>
    [JsonPropertyName("status_name")] public string? StatusName { get; init; }
    /// <summary>Статус в карточке (s.DESCR as status).</summary>
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("empl_no")] public long? EmplNo { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_dept")] public string? EmployeeDept { get; init; }
    [JsonPropertyName("employee_email")] public string? EmployeeEmail { get; init; }
    [JsonPropertyName("branch_no")] public long? BranchNo { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("loc_no")] public long? LocNo { get; init; }
    /// <summary>Помещение в строке поиска (l.DESCR as location_name).</summary>
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
    /// <summary>Помещение в карточке (l.DESCR as location).</summary>
    [JsonPropertyName("location")] public string? Location { get; init; }
    /// <summary>Описание в карточке (i.DESCRIPTION, регистронезависимый JSON).</summary>
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("ip_address")] public string? IpAddress { get; init; }
    [JsonPropertyName("mac_address")] public string? MacAddress { get; init; }
    [JsonPropertyName("network_name")] public string? NetworkName { get; init; }
    [JsonPropertyName("domain_name")] public string? DomainName { get; init; }
    [JsonPropertyName("date_create")] public string? DateCreate { get; init; }
    [JsonPropertyName("date_last_modify")] public string? DateLastModify { get; init; }
    [JsonPropertyName("ch_user")] public string? ChUser { get; init; }
}

/// <summary>Ответ GET /equipment/search/universal: страница списка + total/pages.</summary>
public sealed record HubEquipmentSearchPage
{
    [JsonPropertyName("equipment")] public IReadOnlyList<HubEquipmentItem>? Equipment { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("pages")] public int Pages { get; init; }
    [JsonPropertyName("data_version")] public long DataVersion { get; init; }
}

/// <summary>
/// Параметры GET /equipment/search/universal. Field — allowlist бэкенда:
/// serial, model, inv_no, part_no, employee, branch, location, status,
/// vendor, type, ip, mac, netbios; пустое значение — поиск по всем полям.
/// </summary>
public sealed record HubEquipmentSearchQuery
{
    public string? Search { get; init; }
    public string? Field { get; init; }
    public int? TypeNo { get; init; }
    public int Page { get; init; } = 1;
    public int Limit { get; init; } = 50;
}

/// <summary>Тип оборудования GET /equipment/types; ci_type: 1 — оборудование, 4 — расходники.</summary>
public sealed record HubEquipmentType
{
    [JsonPropertyName("ci_type")] public int? CiType { get; init; }
    [JsonPropertyName("type_no")] public int TypeNo { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
}

/// <summary>Статус карточки GET /equipment/statuses (EquipmentStatus бэкенда).</summary>
public sealed record HubEquipmentStatus
{
    [JsonPropertyName("status_no")] public int StatusNo { get; init; }
    [JsonPropertyName("status_name")] public string? StatusName { get; init; }
}

/// <summary>
/// Строка models[] ответа GET /equipment/models?type_no=&ci_type= — сырая
/// запись CI_MODELS (model_no/model_name/type_no, опционально ci_type).
/// </summary>
public sealed record HubEquipmentModel
{
    [JsonPropertyName("model_no")] public int ModelNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("type_no")] public int? TypeNo { get; init; }
    [JsonPropertyName("ci_type")] public int? CiType { get; init; }
}

/// <summary>Обёртка ответа GET /equipment/models — единственный ключ models.</summary>
public sealed record HubEquipmentModelList
{
    [JsonPropertyName("models")] public IReadOnlyList<HubEquipmentModel>? Models { get; init; }
}

/// <summary>
/// Владелец из GET /equipment/owners/search?q=&limit= (owners[] бэкенда —
/// сырые ключи OWNER_NO/OWNER_DISPLAY_NAME/OWNER_DEPT; имя свойства
/// регистронезависимо совпадает с ними).
/// </summary>
public sealed record HubEquipmentOwner
{
    [JsonPropertyName("owner_no")] public long? OwnerNo { get; init; }
    [JsonPropertyName("owner_display_name")] public string? OwnerDisplayName { get; init; }
    [JsonPropertyName("owner_dept")] public string? OwnerDept { get; init; }
}

/// <summary>Обёртка ответа GET /equipment/owners/search — единственный ключ owners.</summary>
public sealed record HubEquipmentOwnerList
{
    [JsonPropertyName("owners")] public IReadOnlyList<HubEquipmentOwner>? Owners { get; init; }
}

/// <summary>
/// Метаданные фото GET /equipment/{item_id}/photos (бинарный контент — вне среза).
/// Поля модерации совпадают с EquipmentPhotoItem бэкенда; тот же срез отдают
/// POST /photos/{file_no}/verify|reject и PATCH /photos/{file_no}/reject.
/// </summary>
public sealed record HubEquipmentPhoto
{
    [JsonPropertyName("file_no")] public long FileNo { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("size_mb")] public double SizeMb { get; init; }
    [JsonPropertyName("has_thumb")] public bool HasThumb { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("created_by")] public string? CreatedBy { get; init; }
    [JsonPropertyName("verified")] public bool Verified { get; init; }
    [JsonPropertyName("verified_by")] public string? VerifiedBy { get; init; }
    [JsonPropertyName("verified_at")] public string? VerifiedAt { get; init; }
    [JsonPropertyName("can_verify")] public bool CanVerify { get; init; }
    [JsonPropertyName("can_unverify")] public bool CanUnverify { get; init; }
    [JsonPropertyName("rejected")] public bool Rejected { get; init; }
    [JsonPropertyName("rejected_by")] public string? RejectedBy { get; init; }
    [JsonPropertyName("rejected_at")] public string? RejectedAt { get; init; }
    [JsonPropertyName("reject_reason")] public string? RejectReason { get; init; }
    [JsonPropertyName("can_reject")] public bool CanReject { get; init; }
    [JsonPropertyName("is_own")] public bool IsOwn { get; init; }
}

/// <summary>Список фото GET /equipment/{item_id}/photos + флаги верификации.</summary>
public sealed record HubEquipmentPhotoList
{
    [JsonPropertyName("item_id")] public long ItemId { get; init; }
    [JsonPropertyName("photos")] public IReadOnlyList<HubEquipmentPhoto>? Photos { get; init; }
    [JsonPropertyName("verification_available")] public bool VerificationAvailable { get; init; }
    [JsonPropertyName("verify_permitted")] public bool VerifyPermitted { get; init; }
    [JsonPropertyName("serial_confirmed_by_photo")] public bool SerialConfirmedByPhoto { get; init; }
    [JsonPropertyName("ocr_available")] public bool OcrAvailable { get; init; }
}

/// <summary>
/// Ответ POST /equipment/{item_id}/photos и POST /equipment/photo-uploads/{id}/complete:
/// идентификаторы вставленной строки FILES.
/// </summary>
public sealed record HubEquipmentPhotoUploadResult
{
    [JsonPropertyName("file_no")] public long FileNo { get; init; }
    [JsonPropertyName("item_id")] public long ItemId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
}

/// <summary>
/// Тело POST /equipment/{item_id}/photo-uploads — открытие сессии чанковой
/// загрузки. client_id (8–128 символов) — ключ идемпотентности: повторное
/// открытие с тем же id возвращает ту же сессию, а не вторую запись.
/// </summary>
public sealed record HubEquipmentPhotoUploadSessionCreate
{
    [JsonPropertyName("client_id")] public string? ClientId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("sha256")] public string? Sha256 { get; init; }
}

/// <summary>
/// Состояние сессии чанковой загрузки (ответ create/put/state): upload_id,
/// прогресс received[] и file_no после complete.
/// </summary>
public sealed record HubEquipmentPhotoUploadSession
{
    [JsonPropertyName("upload_id")] public string? UploadId { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("item_id")] public long ItemId { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("chunk_size")] public long ChunkSize { get; init; }
    [JsonPropertyName("total_chunks")] public int TotalChunks { get; init; }
    [JsonPropertyName("received")] public IReadOnlyList<int>? Received { get; init; }
    [JsonPropertyName("file_no")] public long? FileNo { get; init; }
}

/// <summary>Ответ POST /equipment/{item_id}/photos/{file_no}/rotate.</summary>
public sealed record HubEquipmentPhotoRotateResult
{
    [JsonPropertyName("ok")] public bool Ok { get; init; }
    [JsonPropertyName("file_no")] public long FileNo { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("size_mb")] public double? SizeMb { get; init; }
    [JsonPropertyName("has_thumb")] public bool HasThumb { get; init; }
}

/// <summary>Строка истории CI_HISTORY из GET /equipment/{inv_no}/history.</summary>
public sealed record HubEquipmentHistoryRow
{
    [JsonPropertyName("hist_id")] public long? HistId { get; init; }
    [JsonPropertyName("ch_date")] public string? ChDate { get; init; }
    [JsonPropertyName("ch_user")] public string? ChUser { get; init; }
    [JsonPropertyName("ch_comment")] public string? ChComment { get; init; }
    [JsonPropertyName("old_employee_no")] public long? OldEmployeeNo { get; init; }
    [JsonPropertyName("old_employee_name")] public string? OldEmployeeName { get; init; }
    [JsonPropertyName("new_employee_no")] public long? NewEmployeeNo { get; init; }
    [JsonPropertyName("new_employee_name")] public string? NewEmployeeName { get; init; }
    [JsonPropertyName("old_branch_no")] public long? OldBranchNo { get; init; }
    [JsonPropertyName("old_branch_name")] public string? OldBranchName { get; init; }
    [JsonPropertyName("new_branch_no")] public long? NewBranchNo { get; init; }
    [JsonPropertyName("new_branch_name")] public string? NewBranchName { get; init; }
    [JsonPropertyName("old_loc_no")] public long? OldLocNo { get; init; }
    [JsonPropertyName("old_location_name")] public string? OldLocationName { get; init; }
    [JsonPropertyName("new_loc_no")] public long? NewLocNo { get; init; }
    [JsonPropertyName("new_location_name")] public string? NewLocationName { get; init; }
}

/// <summary>Ответ GET /equipment/{inv_no}/history.</summary>
public sealed record HubEquipmentHistoryResponse
{
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("history")] public IReadOnlyList<HubEquipmentHistoryRow>? History { get; init; }
}

// ---- Карточка сотрудника ITINVENT (/equipment/employee/{owner_no}) ----

/// <summary>
/// Ответ GET /equipment/employee/{owner_no}/items (EquipmentSearchResponse):
/// вся техника владельца; db_errors — сбойные базы при cross-DB режиме
/// (натив его не включает, список пуст).
/// </summary>
public sealed record HubEmployeeItemsResponse
{
    [JsonPropertyName("found")] public bool Found { get; init; }
    [JsonPropertyName("equipment")] public IReadOnlyList<HubEquipmentItem>? Equipment { get; init; }
    [JsonPropertyName("db_errors")] public IReadOnlyList<string>? DbErrors { get; init; }
}

/// <summary>
/// Строка истории сотрудника GET /equipment/employee/{owner_no}/history
/// (CI_HISTORY по владельцу): direction incoming|outgoing относительно
/// сотрудника, данные техники на момент события (inv_no/current_inv_no —
/// COALESCE float из ITINVENT), филиал/локация события.
/// </summary>
public sealed record HubEmployeeHistoryRow
{
    [JsonPropertyName("hist_id")] public long? HistId { get; init; }
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("ch_date")] public string? ChDate { get; init; }
    [JsonPropertyName("ch_user")] public string? ChUser { get; init; }
    [JsonPropertyName("ch_comment")] public string? ChComment { get; init; }
    [JsonPropertyName("direction")] public string? Direction { get; init; }
    [JsonPropertyName("old_employee_no")] public long? OldEmployeeNo { get; init; }
    [JsonPropertyName("old_employee_name")] public string? OldEmployeeName { get; init; }
    [JsonPropertyName("new_employee_no")] public long? NewEmployeeNo { get; init; }
    [JsonPropertyName("new_employee_name")] public string? NewEmployeeName { get; init; }
    [JsonPropertyName("inv_no")] public double? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
    /// <summary>Текущий инв. № живой карточки — при наличии позицию можно открыть.</summary>
    [JsonPropertyName("current_inv_no")] public double? CurrentInvNo { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
}

/// <summary>Ответ GET /equipment/employee/{owner_no}/history — страница записей.</summary>
public sealed record HubEmployeeHistoryResponse
{
    [JsonPropertyName("owner_no")] public long? OwnerNo { get; init; }
    [JsonPropertyName("history")] public IReadOnlyList<HubEmployeeHistoryRow>? History { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
}

// ---- Передача оборудования (POST /equipment/transfer, job-акты) ----

/// <summary>Сотрудник-владелец из GET /equipment/search/employee (EmployeeSummary).</summary>
public sealed record HubEquipmentEmployee
{
    [JsonPropertyName("owner_no")] public long? OwnerNo { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("equipment_count")] public int EquipmentCount { get; init; }
}

/// <summary>Ответ GET /equipment/search/employee — страница подбора сотрудника.</summary>
public sealed record HubEquipmentEmployeePage
{
    [JsonPropertyName("employees")] public IReadOnlyList<HubEquipmentEmployee>? Employees { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("page")] public int Page { get; init; }
    [JsonPropertyName("pages")] public int Pages { get; init; }
}

/// <summary>
/// Филиал GET /equipment/branches: id — BRANCH_NO, в модели бэкенда int|str,
/// поэтому значение хранится как сырой JSON и уходит в запрос без потери типа.
/// </summary>
public sealed record HubEquipmentBranch
{
    [JsonPropertyName("id")] public JsonElement? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
}

/// <summary>Локация GET /equipment/locations/{branch}: loc_no — LOC_NO (int|str).</summary>
public sealed record HubEquipmentLocation
{
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("loc_name")] public string? LocName { get; init; }
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
}

/// <summary>
/// Тело POST /equipment/transfer (TransferExecuteRequest): operation_id —
/// клиентский idempotency-key (8-64, ^[A-Za-z0-9][\w.:-]*$), inv_nos — 1..2000,
/// new_employee обязателен (≥2). branch_no/loc_no — int|str, поэтому сырой JSON.
/// </summary>
public sealed record HubEquipmentTransferRequest
{
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("inv_nos")] public IReadOnlyList<string> InvNos { get; init; } = [];
    [JsonPropertyName("new_employee")] public string? NewEmployee { get; init; }
    [JsonPropertyName("new_employee_no")] public long? NewEmployeeNo { get; init; }
    [JsonPropertyName("new_employee_dept")] public string? NewEmployeeDept { get; init; }
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
}

/// <summary>
/// Тело POST /equipment/transfer/location (TransferLocationRequest): operation_id
/// обязателен (8-64, тот же паттерн), inv_nos — 1..2000, branch_no/loc_no —
/// обязательные int|str (сырой JSON). Двигает только филиал/локацию: без смены
/// владельца и без актов (CI_HISTORY пишет бэкенд).
/// </summary>
public sealed record HubTransferLocationRequest
{
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("inv_nos")] public IReadOnlyList<string> InvNos { get; init; } = [];
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
}

/// <summary>Успешно перемещённая позиция (transferred[] ответа передачи).</summary>
public sealed record HubTransferItemResult
{
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("old_employee_no")] public long? OldEmployeeNo { get; init; }
    [JsonPropertyName("old_employee_name")] public string? OldEmployeeName { get; init; }
    [JsonPropertyName("new_employee_no")] public long? NewEmployeeNo { get; init; }
    [JsonPropertyName("new_employee_name")] public string? NewEmployeeName { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
}

/// <summary>Позиция, которую переместить не удалось (failed[] ответа).</summary>
public sealed record HubTransferFailedItem
{
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
}

/// <summary>Сформированный акт передачи (acts[] ответа, TransferActInfo).</summary>
public sealed record HubTransferAct
{
    [JsonPropertyName("act_id")] public string? ActId { get; init; }
    [JsonPropertyName("old_employee")] public string? OldEmployee { get; init; }
    [JsonPropertyName("new_employee")] public string? NewEmployee { get; init; }
    [JsonPropertyName("equipment_count")] public int EquipmentCount { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("file_type")] public string? FileType { get; init; }
}

/// <summary>
/// Ответ POST /equipment/transfer и GET /equipment/transfer/act-jobs/{job_id}
/// (TransferExecuteResponse): счётчики, позиции, акты и статус фонового job
/// (queued/processing/done/failed + job_status_text/job_error).
/// upload_reminder_* — созданная сервером reminder-задача «загрузить
/// подписанный акт» (как в веб-результате TransferActionContent).
/// </summary>
public sealed record HubTransferExecuteResponse
{
    [JsonPropertyName("success_count")] public int SuccessCount { get; init; }
    [JsonPropertyName("failed_count")] public int FailedCount { get; init; }
    [JsonPropertyName("transferred")] public IReadOnlyList<HubTransferItemResult>? Transferred { get; init; }
    [JsonPropertyName("failed")] public IReadOnlyList<HubTransferFailedItem>? Failed { get; init; }
    [JsonPropertyName("retry_inv_nos")] public IReadOnlyList<string>? RetryInvNos { get; init; }
    [JsonPropertyName("acts")] public IReadOnlyList<HubTransferAct>? Acts { get; init; }
    [JsonPropertyName("upload_reminder_created")] public bool UploadReminderCreated { get; init; }
    [JsonPropertyName("upload_reminder_task_id")] public string? UploadReminderTaskId { get; init; }
    [JsonPropertyName("upload_reminder_id")] public string? UploadReminderId { get; init; }
    [JsonPropertyName("upload_reminder_warning")] public string? UploadReminderWarning { get; init; }
    [JsonPropertyName("upload_reminder_controller_username")] public string? UploadReminderControllerUsername { get; init; }
    [JsonPropertyName("upload_reminder_controller_fallback_used")] public bool UploadReminderControllerFallbackUsed { get; init; }
    [JsonPropertyName("job_id")] public string? JobId { get; init; }
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("job_status")] public string? JobStatus { get; init; }
    [JsonPropertyName("job_status_text")] public string? JobStatusText { get; init; }
    [JsonPropertyName("job_error")] public string? JobError { get; init; }
    [JsonPropertyName("job_operation")] public string? JobOperation { get; init; }
}

/// <summary>
/// Тело POST /equipment/transfer/act-only (TransferActOnlyRequest): акт(ы) по
/// выбранным позициям БЕЗ смены владельца/филиала/локации. issuer_employee —
/// кто выдал технику (обязателен; получателем в акте становится текущий
/// владелец позиции), issuer_owner_no — OWNER_NO выбранного из справочника.
/// operation_id — тот же клиентский idempotency-key, что у transfer.
/// </summary>
public sealed record HubTransferActOnlyRequest
{
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("inv_nos")] public IReadOnlyList<string> InvNos { get; init; } = [];
    [JsonPropertyName("issuer_employee")] public string? IssuerEmployee { get; init; }
    [JsonPropertyName("issuer_owner_no")] public long? IssuerOwnerNo { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
}

/// <summary>Позиция, разрешённая сервером из распознанного акта (resolved_items[]).</summary>
public sealed record HubUploadedActResolvedItem
{
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
}

/// <summary>
/// Ответ POST /equipment/acts/upload/parse (UploadedActDraftResponse): черновик
/// загруженного подписанного акта — распознанные стороны, дата, инв. номера,
/// разрешённые позиции и предупреждения парсера. draft_id живёт до commit.
/// </summary>
public sealed record HubUploadedActDraft
{
    [JsonPropertyName("draft_id")] public string? DraftId { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("from_employee")] public string? FromEmployee { get; init; }
    [JsonPropertyName("to_employee")] public string? ToEmployee { get; init; }
    [JsonPropertyName("doc_date")] public string? DocDate { get; init; }
    [JsonPropertyName("equipment_inv_nos")] public IReadOnlyList<string>? EquipmentInvNos { get; init; }
    [JsonPropertyName("resolved_items")] public IReadOnlyList<HubUploadedActResolvedItem>? ResolvedItems { get; init; }
    [JsonPropertyName("warnings")] public IReadOnlyList<string>? Warnings { get; init; }
}

/// <summary>
/// Тело POST /equipment/acts/upload/commit (UploadedActCommitRequest): правки
/// пользователя поверх черновика; пустые поля сервер берёт из черновика
/// (как buildUploadActCommitPayload веба — пустое не шлём). source_task_id /
/// reminder_id — привязка к reminder-задаче ожидания подписанных актов;
/// email в теле нет — это отдельный POST /equipment/acts/upload/email.
/// </summary>
public sealed record HubUploadedActCommitRequest
{
    [JsonPropertyName("draft_id")] public string? DraftId { get; init; }
    [JsonPropertyName("from_employee")] public string? FromEmployee { get; init; }
    [JsonPropertyName("to_employee")] public string? ToEmployee { get; init; }
    [JsonPropertyName("doc_date")] public string? DocDate { get; init; }
    [JsonPropertyName("equipment_inv_nos")] public IReadOnlyList<string>? EquipmentInvNos { get; init; }

    /// <summary>reminder_id из GET /equipment/transfer/reminders или диплинка.</summary>
    [JsonPropertyName("reminder_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ReminderId { get; init; }

    /// <summary>task_id напоминания — сервер найдёт привязанный reminder и по задаче.</summary>
    [JsonPropertyName("source_task_id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SourceTaskId { get; init; }
}

/// <summary>
/// Ответ POST /equipment/acts/upload/commit (UploadedActCommitResponse):
/// записанный документ DOCS+FILES и привязанные позиции; reminder_* — статус
/// задачи-напоминания, которую сервер обновил по reminder_id/source_task_id
/// из запроса (как reminder_result в commit-ответе веба).
/// </summary>
public sealed record HubUploadedActCommitResult
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("doc_no")] public long DocNo { get; init; }
    [JsonPropertyName("doc_number")] public string? DocNumber { get; init; }
    [JsonPropertyName("file_no")] public long FileNo { get; init; }
    [JsonPropertyName("linked_item_ids")] public IReadOnlyList<long>? LinkedItemIds { get; init; }
    [JsonPropertyName("linked_inv_nos")] public IReadOnlyList<string>? LinkedInvNos { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("reminder_status")] public string? ReminderStatus { get; init; }
    [JsonPropertyName("reminder_task_id")] public string? ReminderTaskId { get; init; }
    [JsonPropertyName("reminder_id")] public string? ReminderId { get; init; }
    [JsonPropertyName("reminder_pending_groups")] public int ReminderPendingGroups { get; init; }
    [JsonPropertyName("reminder_warning")] public string? ReminderWarning { get; init; }
}

/// <summary>Одна группа ожидаемых/закрытых актов в reminder (TransferActReminderGroupResponse).</summary>
public sealed record HubTransferActReminderGroup
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("generated_act_id")] public string? GeneratedActId { get; init; }
    [JsonPropertyName("old_employee_name")] public string? OldEmployeeName { get; init; }
    [JsonPropertyName("inv_nos")] public IReadOnlyList<string>? InvNos { get; init; }
    [JsonPropertyName("equipment_count")] public int EquipmentCount { get; init; }
    [JsonPropertyName("matched_doc_no")] public long? MatchedDocNo { get; init; }
    [JsonPropertyName("matched_doc_number")] public string? MatchedDocNumber { get; init; }
    [JsonPropertyName("completed_at")] public string? CompletedAt { get; init; }
}

/// <summary>
/// Ответ GET /equipment/transfer/reminders/{reminder_id} (TransferActReminderResponse):
/// персистентное напоминание «загрузить подписанные акты» — задача hub,
/// сотрудник-получатель и группы позиций с их состоянием.
/// </summary>
public sealed record HubTransferActReminder
{
    [JsonPropertyName("reminder_id")] public string? ReminderId { get; init; }
    [JsonPropertyName("task_id")] public string? TaskId { get; init; }
    [JsonPropertyName("db_id")] public string? DbId { get; init; }
    [JsonPropertyName("assignee_user_id")] public long AssigneeUserId { get; init; }
    [JsonPropertyName("controller_user_id")] public long ControllerUserId { get; init; }
    [JsonPropertyName("created_by_user_id")] public long CreatedByUserId { get; init; }
    [JsonPropertyName("new_employee_no")] public string? NewEmployeeNo { get; init; }
    [JsonPropertyName("new_employee_name")] public string? NewEmployeeName { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
    [JsonPropertyName("completed_at")] public string? CompletedAt { get; init; }
    [JsonPropertyName("pending_groups_total")] public int PendingGroupsTotal { get; init; }
    [JsonPropertyName("completed_groups_total")] public int CompletedGroupsTotal { get; init; }
    [JsonPropertyName("pending_groups")] public IReadOnlyList<HubTransferActReminderGroup>? PendingGroups { get; init; }
    [JsonPropertyName("completed_groups")] public IReadOnlyList<HubTransferActReminderGroup>? CompletedGroups { get; init; }
    [JsonPropertyName("upload_url")] public string? UploadUrl { get; init; }
}

/// <summary>
/// Тело POST /equipment/acts/upload/email (UploadedActEmailSendRequest):
/// отправка записанного акта по почте после commit. mode=auto — сервер резолвит
/// получателей по ФИО from/to акта; mode=selected — по явному owner_nos.
/// </summary>
public sealed record HubUploadedActEmailRequest
{
    [JsonPropertyName("doc_no")] public long DocNo { get; init; }
    [JsonPropertyName("mode")] public string? Mode { get; init; }
    [JsonPropertyName("from_employee")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? FromEmployee { get; init; }
    [JsonPropertyName("to_employee")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ToEmployee { get; init; }
    [JsonPropertyName("owner_nos")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public IReadOnlyList<long>? OwnerNos { get; init; }
    [JsonPropertyName("subject")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Subject { get; init; }
    [JsonPropertyName("body")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Body { get; init; }
}

/// <summary>Статус доставки одному получателю (UploadedActEmailRecipientStatus).</summary>
public sealed record HubUploadedActEmailRecipient
{
    [JsonPropertyName("owner_no")] public long? OwnerNo { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("detail")] public string? Detail { get; init; }
}

/// <summary>Ответ POST /equipment/acts/upload/email (UploadedActEmailSendResponse).</summary>
public sealed record HubUploadedActEmailResult
{
    [JsonPropertyName("doc_no")] public long DocNo { get; init; }
    [JsonPropertyName("subject")] public string? Subject { get; init; }
    [JsonPropertyName("success_count")] public int SuccessCount { get; init; }
    [JsonPropertyName("failed_count")] public int FailedCount { get; init; }
    [JsonPropertyName("recipients")] public IReadOnlyList<HubUploadedActEmailRecipient>? Recipients { get; init; }
}

// ---- Карточка оборудования: точечная правка и создание (права database.write) ----

/// <summary>
/// Тело PATCH /equipment/{inv_no} (EquipmentUpdateRequest бэкенда): только
/// изменённые поля — как buildDetailUpdatePayload веба. null-свойства при
/// сериализации отбрасываются (эквивалент exclude_unset у сервера): очистка
/// текстового поля уходит пустой строкой, ссылочные id формой не обнуляются.
/// branch_no/loc_no — int|str у бэкенда, поэтому сырой JSON без потери типа.
/// </summary>
public sealed record HubEquipmentUpdateRequest
{
    [JsonPropertyName("serial_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? HwSerialNo { get; init; }
    [JsonPropertyName("part_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PartNo { get; init; }
    [JsonPropertyName("ip_address")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? IpAddress { get; init; }
    [JsonPropertyName("mac_address")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? MacAddress { get; init; }
    [JsonPropertyName("network_name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NetworkName { get; init; }
    [JsonPropertyName("description")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; init; }
    [JsonPropertyName("status_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? StatusNo { get; init; }
    [JsonPropertyName("empl_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? EmplNo { get; init; }
    [JsonPropertyName("branch_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("loc_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? LocNo { get; init; }
    [JsonPropertyName("type_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? TypeNo { get; init; }
    [JsonPropertyName("model_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ModelNo { get; init; }
}

/// <summary>
/// Тело POST /equipment/create (EquipmentCreateRequest бэкенда): новая позиция
/// ITEMS. serial_no/employee_name/branch_no/loc_no/type_no/status_no
/// обязательны; модель — model_no выбранной опции либо свободный model_name
/// (сервер создаст модель), сотрудник — employee_no из справочника либо
/// только employee_name (сервер создаст владельца). null-свойства опускаем —
/// как undefined у веб-payload.
/// </summary>
public sealed record HubEquipmentCreateRequest
{
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public long? EmployeeNo { get; init; }
    [JsonPropertyName("employee_dept")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? EmployeeDept { get; init; }
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("type_no")] public int? TypeNo { get; init; }
    [JsonPropertyName("status_no")] public int? StatusNo { get; init; }
    [JsonPropertyName("model_name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ModelName { get; init; }
    [JsonPropertyName("model_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public int? ModelNo { get; init; }
    [JsonPropertyName("hw_serial_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? HwSerialNo { get; init; }
    [JsonPropertyName("part_no")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? PartNo { get; init; }
    [JsonPropertyName("description")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Description { get; init; }
    [JsonPropertyName("ip_address")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? IpAddress { get; init; }
    [JsonPropertyName("mac_address")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? MacAddress { get; init; }
    [JsonPropertyName("network_name")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? NetworkName { get; init; }
}

/// <summary>Ответ POST /equipment/create (EquipmentCreateResponse бэкенда).</summary>
public sealed record HubEquipmentCreateResult
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("created_owner")] public bool CreatedOwner { get; init; }
    [JsonPropertyName("created_model")] public bool CreatedModel { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
}

// ---- Расходники склада (/equipment/consumables*: справочник, списание, ----
// ---- точный остаток, создание; CI_TYPE=4, права database.write) ----

/// <summary>
/// Строка справочника GET /equipment/consumables/lookup (ConsumableLookupItem):
/// складская позиция расходника с остатком и адресом (филиал/локация).
/// branch_no/loc_no — int|str у бэкенда, поэтому сырой JSON без потери типа.
/// </summary>
public sealed record HubConsumableLookupItem
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("type_no")] public int? TypeNo { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
    [JsonPropertyName("model_no")] public int? ModelNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("qty")] public int Qty { get; init; }
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
    [JsonPropertyName("part_no")] public string? PartNo { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
}

/// <summary>
/// Тело POST /equipment/consumables/consume (ConsumableConsumeRequest):
/// идентификация по item_id или inv_no (item_id приоритетнее), qty ≥ 1,
/// operation_id — idempotency-key для durable-пути (как у transfer).
/// </summary>
public sealed record HubConsumableConsumeRequest
{
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("qty")] public int Qty { get; init; } = 1;
    [JsonPropertyName("reason")] public string? Reason { get; init; }
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }

    /// <summary>
    /// Журнальная запись, атомарная со списанием (durable-путь веба):
    /// повтор с тем же operation_id возобновляется с checkpoint, не списывая снова.
    /// </summary>
    [JsonPropertyName("work")] public HubConsumableWorkPayload? Work { get; init; }
}

/// <summary>
/// Вложенная работа в durable-списании (ConsumableWorkPayload): kind —
/// cartridge|component, payload — поля записи журнала /json/works*.
/// </summary>
public sealed record HubConsumableWorkPayload
{
    [JsonPropertyName("kind")] public required string Kind { get; init; }
    [JsonPropertyName("payload")] public Dictionary<string, object?>? Payload { get; init; }
}

/// <summary>Ответ POST /equipment/consumables/consume (ConsumableConsumeResponse).</summary>
public sealed record HubConsumableConsumeResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("qty_old")] public int? QtyOld { get; init; }
    [JsonPropertyName("qty_new")] public int? QtyNew { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("work_status")] public string? WorkStatus { get; init; }
    [JsonPropertyName("work_record")] public Dictionary<string, JsonElement>? WorkRecord { get; init; }
}

/// <summary>
/// Тело PATCH /equipment/consumables/qty (ConsumableQtyUpdateRequest):
/// точная установка остатка, qty ≥ 0; позиция — item_id или inv_no.
/// </summary>
public sealed record HubConsumableQtyUpdateRequest
{
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("qty")] public int Qty { get; init; }
}

/// <summary>Ответ PATCH /equipment/consumables/qty (ConsumableQtyUpdateResponse).</summary>
public sealed record HubConsumableQtyUpdateResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("qty_old")] public int? QtyOld { get; init; }
    [JsonPropertyName("qty_new")] public int? QtyNew { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
}

/// <summary>
/// Тело POST /equipment/consumables/create (ConsumableCreateRequest): новая
/// позиция CI_TYPE=4. branch_no/loc_no обязательные int|str — сырой JSON;
/// модель — либо model_no (id существующей), либо model_name (создаст новую).
/// </summary>
public sealed record HubConsumableCreateRequest
{
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("loc_no")] public JsonElement? LocNo { get; init; }
    [JsonPropertyName("type_no")] public int TypeNo { get; init; }
    [JsonPropertyName("qty")] public int Qty { get; init; } = 1;
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("model_no")] public int? ModelNo { get; init; }
    [JsonPropertyName("status_no")] public int? StatusNo { get; init; }
    [JsonPropertyName("part_no")] public string? PartNo { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
}

/// <summary>Ответ POST /equipment/consumables/create (ConsumableCreateResponse).</summary>
public sealed record HubConsumableCreateResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("item_id")] public long? ItemId { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("created_model")] public bool CreatedModel { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
}

// ---- Сети (/networks, read-срез: филиалы, устройства, карты) ----

/// <summary>
/// Филиал сети (branches[] GET /networks/branches?city=): плоская запись
/// network_branches + агрегатные счётчики + db_id из network_branch_db_map.
/// is_active в sqlite — INTEGER 0/1, поэтому int, а не bool.
/// </summary>
public sealed record HubNetworkBranch
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("city_code")] public string? CityCode { get; init; }
    [JsonPropertyName("branch_code")] public string? BranchCode { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("is_active")] public int IsActive { get; init; }
    [JsonPropertyName("default_site_code")] public string? DefaultSiteCode { get; init; }
    [JsonPropertyName("db_id")] public string? DbId { get; init; }
    [JsonPropertyName("devices_count")] public int DevicesCount { get; init; }
    [JsonPropertyName("ports_count")] public int PortsCount { get; init; }
    [JsonPropertyName("occupied_ports")] public int OccupiedPorts { get; init; }
    [JsonPropertyName("sockets_count")] public int SocketsCount { get; init; }
    [JsonPropertyName("maps_count")] public int MapsCount { get; init; }
    [JsonPropertyName("map_points_count")] public int MapPointsCount { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /networks/branches?city= — {branches:[]} без пагинации.</summary>
public sealed record HubNetworkBranchList
{
    [JsonPropertyName("branches")] public IReadOnlyList<HubNetworkBranch>? Branches { get; init; }
}

/// <summary>Метрики филиала (metrics{} из GET /networks/branches/{id}/overview).</summary>
public sealed record HubNetworkMetrics
{
    [JsonPropertyName("devices_count")] public int DevicesCount { get; init; }
    [JsonPropertyName("ports_count")] public int PortsCount { get; init; }
    [JsonPropertyName("occupied_ports")] public int OccupiedPorts { get; init; }
    [JsonPropertyName("sockets_count")] public int SocketsCount { get; init; }
    [JsonPropertyName("maps_count")] public int MapsCount { get; init; }
    [JsonPropertyName("map_points_count")] public int MapPointsCount { get; init; }
}

/// <summary>
/// Площадка филиала (sites[] из overview): site_code + имя + счётчики
/// устройств и портов площадки.
/// </summary>
public sealed record HubNetworkSite
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("branch_id")] public long BranchId { get; init; }
    [JsonPropertyName("site_code")] public string? SiteCode { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("sort_order")] public int SortOrder { get; init; }
    [JsonPropertyName("devices_count")] public int DevicesCount { get; init; }
    [JsonPropertyName("ports_count")] public int PortsCount { get; init; }
}

/// <summary>
/// Ответ GET /networks/branches/{id}/overview: реквизиты филиала (branch —
/// запись network_branches без счётчиков), metrics и список площадок sites[].
/// </summary>
public sealed record HubNetworkOverview
{
    [JsonPropertyName("branch")] public HubNetworkBranch? Branch { get; init; }
    [JsonPropertyName("metrics")] public HubNetworkMetrics? Metrics { get; init; }
    [JsonPropertyName("sites")] public IReadOnlyList<HubNetworkSite>? Sites { get; init; }
}

/// <summary>
/// Устройство филиала (devices[] GET /networks/branches/{id}/devices):
/// network_devices + site_code/site_name + счётчики портов устройства.
/// monitoring_only — INTEGER 0/1 (мониторинговые устройства список отсекает).
/// </summary>
public sealed record HubNetworkDevice
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("branch_id")] public long BranchId { get; init; }
    [JsonPropertyName("site_id")] public long? SiteId { get; init; }
    [JsonPropertyName("site_code")] public string? SiteCode { get; init; }
    [JsonPropertyName("site_name")] public string? SiteName { get; init; }
    [JsonPropertyName("device_code")] public string? DeviceCode { get; init; }
    [JsonPropertyName("device_type")] public string? DeviceType { get; init; }
    [JsonPropertyName("vendor")] public string? Vendor { get; init; }
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("sheet_name")] public string? SheetName { get; init; }
    [JsonPropertyName("mgmt_ip")] public string? MgmtIp { get; init; }
    [JsonPropertyName("notes")] public string? Notes { get; init; }
    [JsonPropertyName("monitoring_only")] public int MonitoringOnly { get; init; }
    [JsonPropertyName("ports_count")] public int PortsCount { get; init; }
    [JsonPropertyName("occupied_ports")] public int OccupiedPorts { get; init; }
}

/// <summary>Ответ GET /networks/branches/{id}/devices — {devices:[]}.</summary>
public sealed record HubNetworkDeviceList
{
    [JsonPropertyName("devices")] public IReadOnlyList<HubNetworkDevice>? Devices { get; init; }
}

/// <summary>
/// Файл-схема филиала (maps[] GET /networks/branches/{id}/maps): метаданные
/// network_maps без blob — сам файл качается GET /networks/maps/{id}/file.
/// </summary>
public sealed record HubNetworkMap
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("branch_id")] public long BranchId { get; init; }
    [JsonPropertyName("site_id")] public long? SiteId { get; init; }
    [JsonPropertyName("site_code")] public string? SiteCode { get; init; }
    [JsonPropertyName("site_name")] public string? SiteName { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("floor_label")] public string? FloorLabel { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("mime_type")] public string? MimeType { get; init; }
    [JsonPropertyName("file_size")] public long FileSize { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /networks/branches/{id}/maps — {maps:[]}.</summary>
public sealed record HubNetworkMapList
{
    [JsonPropertyName("maps")] public IReadOnlyList<HubNetworkMap>? Maps { get; init; }
}

// ---- Компьютеры (/inventory/computers, read-срез: поиск и карточка агента) ----

/// <summary>
/// Диск/том компьютера (logical_disks[]/storage[] mobile-проекции):
/// поля _MOBILE_DISK_FIELDS — имя, точка монтирования, размеры и здоровье.
/// </summary>
public sealed record HubComputerDisk
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("mountpoint")] public string? Mountpoint { get; init; }
    [JsonPropertyName("device")] public string? Device { get; init; }
    [JsonPropertyName("total_gb")] public double? TotalGb { get; init; }
    [JsonPropertyName("free_gb")] public double? FreeGb { get; init; }
    [JsonPropertyName("size_gb")] public double? SizeGb { get; init; }
    [JsonPropertyName("health_status")] public string? HealthStatus { get; init; }
    [JsonPropertyName("media_type")] public string? MediaType { get; init; }
}

/// <summary>
/// Сетевой интерфейс из network.devices[] детали (_MOBILE_NETWORK_DEVICE_FIELDS):
/// имя, состояние линка, скорость и до 8 IPv4-адресов.
/// </summary>
public sealed record HubComputerNetworkDevice
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("connection_status")] public string? ConnectionStatus { get; init; }
    [JsonPropertyName("link_speed")] public string? LinkSpeed { get; init; }
    [JsonPropertyName("ipv4")] public IReadOnlyList<string>? Ipv4 { get; init; }
}

/// <summary>Блок network карточки: в mobile-проекции только devices[] (до 32).</summary>
public sealed record HubComputerNetwork
{
    [JsonPropertyName("devices")] public IReadOnlyList<HubComputerNetworkDevice>? Devices { get; init; }
}

/// <summary>
/// Компьютер инвентаризации: items[] GET /inventory/computers/search и ответ
/// GET /inventory/computers/{mac} — единая форма (деталь — надмножество списка,
/// как ComputerRecord в mobile-hub). Клиент шлёт mobile_safe=true: backend
/// проецирует только _MOBILE_COMPUTER_LIST_FIELDS (+ detail-поля у /{mac});
/// os_info/agent_runtime/профили в нативную выдачу не входят по контракту.
/// Метки времени (last_seen_at, last_reboot_at) — epoch-секунды или null.
/// </summary>
public sealed record HubComputer
{
    [JsonPropertyName("mac_address")] public string? MacAddress { get; init; }
    [JsonPropertyName("hostname")] public string? Hostname { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("age_seconds")] public long? AgeSeconds { get; init; }
    [JsonPropertyName("last_seen_at")] public long? LastSeenAt { get; init; }
    [JsonPropertyName("current_user")] public string? CurrentUser { get; init; }
    [JsonPropertyName("user_login")] public string? UserLogin { get; init; }
    [JsonPropertyName("user_full_name")] public string? UserFullName { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
    [JsonPropertyName("database_name")] public string? DatabaseName { get; init; }
    [JsonPropertyName("inventory_inv_no")] public string? InventoryInvNo { get; init; }
    [JsonPropertyName("inventory_model_name")] public string? InventoryModelName { get; init; }
    [JsonPropertyName("is_unassigned")] public bool IsUnassigned { get; init; }
    [JsonPropertyName("ip_primary")] public string? IpPrimary { get; init; }
    [JsonPropertyName("ip_list")] public IReadOnlyList<string>? IpList { get; init; }
    [JsonPropertyName("cpu_model")] public string? CpuModel { get; init; }
    [JsonPropertyName("cpu_load_percent")] public double? CpuLoadPercent { get; init; }
    [JsonPropertyName("ram_gb")] public double? RamGb { get; init; }
    [JsonPropertyName("ram_used_percent")] public double? RamUsedPercent { get; init; }
    [JsonPropertyName("system_serial")] public string? SystemSerial { get; init; }
    [JsonPropertyName("uptime_seconds")] public long? UptimeSeconds { get; init; }
    [JsonPropertyName("last_reboot_at")] public long? LastRebootAt { get; init; }
    [JsonPropertyName("outlook_status")] public string? OutlookStatus { get; init; }
    [JsonPropertyName("outlook_total_size_bytes")] public long? OutlookTotalSizeBytes { get; init; }
    [JsonPropertyName("outlook_archives_count")] public int? OutlookArchivesCount { get; init; }
    [JsonPropertyName("has_hardware_changes")] public bool HasHardwareChanges { get; init; }
    [JsonPropertyName("changes_count_30d")] public int ChangesCount30d { get; init; }
    [JsonPropertyName("logical_disks")] public IReadOnlyList<HubComputerDisk>? LogicalDisks { get; init; }
    [JsonPropertyName("storage")] public IReadOnlyList<HubComputerDisk>? Storage { get; init; }
    [JsonPropertyName("network")] public HubComputerNetwork? Network { get; init; }
}

/// <summary>
/// Страница GET /inventory/computers/search — {items,total,limit,offset,
/// has_more,next_offset}: серверная offset-пагинация (limit ≤ 500).
/// </summary>
public sealed record HubComputersPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubComputer>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
}

/// <summary>
/// Фильтры GET /inventory/computers/search — имена параметров как в веб-странице
/// Computers.jsx и mobile-hub (searchComputers). scope=selected — выбранная база;
/// all — все базы (нужно право computers.read_all). mobile_safe/include_summary
/// клиент фиксирует сам, здесь их нет.
/// </summary>
public sealed record HubComputersQuery
{
    /// <summary>scope: selected|all (null — selected).</summary>
    public string? Scope { get; init; }
    /// <summary>q: подстрока поиска (ПК, IP, MAC, сотрудник, инв. №, филиал, база).</summary>
    public string? Search { get; init; }
    /// <summary>search_fields: csv полей поиска; null — серверный набор по умолчанию.</summary>
    public string? SearchFields { get; init; }
    /// <summary>status: online|stale|offline; null — все статусы.</summary>
    public string? Status { get; init; }
    /// <summary>outlook_status: ok|warning|critical; null — все.</summary>
    public string? OutlookStatus { get; init; }
    /// <summary>branch: имя филиала; null — все филиалы.</summary>
    public string? Branch { get; init; }
    /// <summary>changed_only=true — только хосты с изменениями железа за 30 дней.</summary>
    public bool ChangedOnly { get; init; }
    /// <summary>hidden_only=true — только скрытые хосты (нужно computers.manage).</summary>
    public bool HiddenOnly { get; init; }
    /// <summary>hide_vm_172=true — отсекать ПК, у которых все IP в 172.16.0.0/12 (ВМ).</summary>
    public bool HideVm172 { get; init; }
    public string? SortBy { get; init; }
    public string? SortDir { get; init; }
    public int Limit { get; init; } = 50;
    public int Offset { get; init; }
}

// ---- Доступ к группам AD (/groups-access, read-срез: статус, матрица, участники) ----

/// <summary>
/// Группа доступа из снимка AD (groups[] GET /groups-access/matrix-grid и
/// group{} GET /groups-access/group): OU-группа безопасности с меткой папки
/// и уровнем доступа read|write|full|member (backend: access_level_rules
/// по имени группы). member_count — развёрнутые участники снимка.
/// </summary>
public sealed record HubGroupsAccessGroup
{
    [JsonPropertyName("dn")] public string? Dn { get; init; }
    [JsonPropertyName("cn")] public string? Cn { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("folder_label")] public string? FolderLabel { get; init; }
    [JsonPropertyName("folder_path")] public string? FolderPath { get; init; }
    [JsonPropertyName("access_level")] public string? AccessLevel { get; init; }
    [JsonPropertyName("member_count")] public int MemberCount { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
}

/// <summary>
/// Строка-учётка матрицы (users[] GET /groups-access/matrix-grid): лёгкая
/// проекция — логин, отображаемое имя и число доступов в текущей выборке.
/// </summary>
public sealed record HubGroupsAccessUser
{
    [JsonPropertyName("login")] public string? Login { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("access_count")] public int AccessCount { get; init; }
}

/// <summary>
/// Агрегаты матрицы (summary{} GET /groups-access/matrix-grid; у /status
/// заполнены только group_count/user_count): полные и возвращённые счётчики,
/// лимиты и флаги усечения выборки.
/// </summary>
public sealed record HubGroupsAccessSummary
{
    [JsonPropertyName("group_count")] public int GroupCount { get; init; }
    [JsonPropertyName("user_count")] public int UserCount { get; init; }
    [JsonPropertyName("cell_count")] public int CellCount { get; init; }
    [JsonPropertyName("returned_group_count")] public int ReturnedGroupCount { get; init; }
    [JsonPropertyName("returned_user_count")] public int ReturnedUserCount { get; init; }
    [JsonPropertyName("group_limit")] public int GroupLimit { get; init; }
    [JsonPropertyName("user_limit")] public int UserLimit { get; init; }
    [JsonPropertyName("group_truncated")] public bool GroupTruncated { get; init; }
    [JsonPropertyName("user_truncated")] public bool UserTruncated { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
}

/// <summary>
/// Ответ GET /groups-access/matrix-grid: колонки-группы, строки-учётки и
/// разреженные ячейки cells[] вида [login, group_dn, access_level].
/// </summary>
public sealed record HubGroupsAccessMatrixGrid
{
    [JsonPropertyName("synced_at")] public string? SyncedAt { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("groups")] public IReadOnlyList<HubGroupsAccessGroup>? Groups { get; init; }
    [JsonPropertyName("users")] public IReadOnlyList<HubGroupsAccessUser>? Users { get; init; }
    [JsonPropertyName("cells")] public IReadOnlyList<IReadOnlyList<string>>? Cells { get; init; }
    [JsonPropertyName("summary")] public HubGroupsAccessSummary? Summary { get; init; }
}

/// <summary>
/// Ответ GET /groups-access/status — состояние фоновой синхронизации снимка:
/// status (ok|error|never|disabled), last_sync_at, ошибка, summary и ветки
/// AD_GROUPS_ACCESS_BRANCHES.
/// </summary>
public sealed record HubGroupsAccessStatus
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("last_sync_at")] public string? LastSyncAt { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("summary")] public HubGroupsAccessSummary? Summary { get; init; }
    [JsonPropertyName("branches")] public IReadOnlyList<string>? Branches { get; init; }
    [JsonPropertyName("base_dn")] public string? BaseDn { get; init; }
}

/// <summary>
/// Участник группы (members[] GET /groups-access/group): логин и имя —
/// только учётки, ПК (CN=$) backend отсекает при построении снимка.
/// </summary>
public sealed record HubGroupsAccessMember
{
    [JsonPropertyName("login")] public string? Login { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("via")] public string? Via { get; init; }
}

/// <summary>
/// Ответ GET /groups-access/group?dn= — карточка группы и её участники.
/// Группа вне снимка — HTTP 404 (HubApiException), а не этот ответ.
/// </summary>
public sealed record HubGroupsAccessGroupDetail
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("group")] public HubGroupsAccessGroup? Group { get; init; }
    [JsonPropertyName("members")] public IReadOnlyList<HubGroupsAccessMember>? Members { get; init; }
    [JsonPropertyName("synced_at")] public string? SyncedAt { get; init; }
}

/// <summary>
/// Параметры GET /groups-access/matrix-grid — как у веб-страницы GroupsAccess.jsx
/// (MATRIX_GROUP_LIMIT=250, MATRIX_USER_LIMIT=500). Пустые фильтры не шлются.
/// </summary>
public sealed record HubGroupsAccessMatrixQuery
{
    /// <summary>branch: OU-ветка (SPb/Tyumen); null — все ветки.</summary>
    public string? Branch { get; init; }
    /// <summary>folder_q: подстрока по cn/folder_label/folder_path/description группы.</summary>
    public string? FolderQuery { get; init; }
    /// <summary>user_q: подстрока по логину/ФИО учётки.</summary>
    public string? UserQuery { get; init; }
    public int GroupLimit { get; init; } = 250;
    public int UserLimit { get; init; } = 500;
}

// ---- Терминалы ВКС (/vcs, read-срез: список + одноразовый launch-token) ----

/// <summary>
/// Терминал ВКС — элемент массива GET /vcs/computers (ответ — плоский
/// JSON-массив, без пагинации): имя переговорки/кабинета, endpoint VNC
/// (host[:port], в ip_address) и расположение. Метки времени — ISO-строкой.
/// </summary>
public sealed record HubVcsComputer
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("ip_address")] public string? IpAddress { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// Ответ POST /vcs/computers/{id}/launch-token: одноразовый токен на выдачу
/// .vnc-файла (GET /vcs/launch/{token}.vnc; TTL на сервере ~60 c). Токен
/// подставляется в vnc:// URI — его забирает зарегистрированный обработчик.
/// </summary>
public sealed record HubVcsLaunchToken
{
    [JsonPropertyName("token")] public string? Token { get; init; }
    [JsonPropertyName("expires_in_seconds")] public int ExpiresInSeconds { get; init; }
}

/// <summary>
/// Тело POST /vcs/computers и PUT /vcs/computers/{id} (VcsComputerCreate/
/// VcsComputerUpdate backend'а): name обязателен (≤ 100), ip_address — VNC
/// endpoint host[:port] (create: 7..50 символов), location опционален. Веб
/// шлёт все три поля и при правке — повторяем ту же форму.
/// </summary>
public sealed record HubVcsComputerInput
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("ip_address")] public string? IpAddress { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
}

/// <summary>
/// Ответ GET/PUT /vcs/config (VcsConfig backend'а): сервер никогда не отдаёт
/// сохранённый password_hex — только флаг password_configured. Тело PUT —
/// {"password_hex": "…"}; пустая строка сбрасывает пароль.
/// </summary>
public sealed record HubVcsConfig
{
    [JsonPropertyName("password_hex")] public string? PasswordHex { get; init; }
    [JsonPropertyName("password_configured")] public bool PasswordConfigured { get; init; }
}

/// <summary>
/// Ответ GET/PUT /vcs/info (VcsInfo backend'а): текст инфо-блока ВКС
/// (в вебе — JSON-таблица контактов; без vcs.manage сервер вырезает пароли).
/// Тело PUT — {"content": "…"}.
/// </summary>
public sealed record HubVcsInfo
{
    [JsonPropertyName("content")] public string? Content { get; init; }
}

// ---- Мониторинг (/monitoring, read-срез: обзор целей и деталь устройства) ----

/// <summary>
/// ICMP-снимок цели (current.ping{} из monitoring-store): status —
/// online|offline|unknown; latency_ms/loss_pct по последней группе из трёх
/// запросов от HUB; sent/received — счётчики группы.
/// </summary>
public sealed record HubMonitoringPing
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("latency_ms")] public double? LatencyMs { get; init; }
    [JsonPropertyName("loss_pct")] public double? LossPct { get; init; }
    [JsonPropertyName("sent")] public int? Sent { get; init; }
    [JsonPropertyName("received")] public int? Received { get; init; }
}

/// <summary>
/// SNMP-снимок устройства (current.device{}): идентификация (sys_name,
/// description, serial) и ресурсы — cpu_pct/memory_pct/storage_pct (0..100),
/// температуры платы (°C), аптайм в тиках (100 тиков = 1 с) и метка
/// resources_at для свежести измерений.
/// </summary>
public sealed record HubMonitoringDevice
{
    [JsonPropertyName("sys_name")] public string? SysName { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("serial")] public string? Serial { get; init; }
    [JsonPropertyName("cpu_pct")] public double? CpuPct { get; init; }
    [JsonPropertyName("memory_pct")] public double? MemoryPct { get; init; }
    [JsonPropertyName("temperature_c")] public double? TemperatureC { get; init; }
    [JsonPropertyName("cpu_temperature_c")] public double? CpuTemperatureC { get; init; }
    [JsonPropertyName("storage_pct")] public double? StoragePct { get; init; }
    [JsonPropertyName("storage_total_bytes")] public double? StorageTotalBytes { get; init; }
    [JsonPropertyName("storage_used_bytes")] public double? StorageUsedBytes { get; init; }
    [JsonPropertyName("uptime_ticks")] public long? UptimeTicks { get; init; }
    [JsonPropertyName("hardware_uptime_ticks")] public long? HardwareUptimeTicks { get; init; }
    [JsonPropertyName("resources_at")] public string? ResourcesAt { get; init; }
}

/// <summary>
/// Журнал достижимости цели (current.availability{}): ever_reachable —
/// устройство хоть раз отвечало; unreachable_since — начало текущего
/// эпизода недоступности; last_reachable_at — последняя успешная связь.
/// </summary>
public sealed record HubMonitoringAvailability
{
    [JsonPropertyName("initial_state_known")] public bool? InitialStateKnown { get; init; }
    [JsonPropertyName("observed_since")] public string? ObservedSince { get; init; }
    [JsonPropertyName("ever_reachable")] public bool? EverReachable { get; init; }
    [JsonPropertyName("first_reachable_at")] public string? FirstReachableAt { get; init; }
    [JsonPropertyName("last_reachable_at")] public string? LastReachableAt { get; init; }
    [JsonPropertyName("unreachable_since")] public string? UnreachableSince { get; init; }
}

/// <summary>
/// Текущее состояние цели (current{} из overview/detail): сводный status —
/// online|offline|unknown; протокольные часы checked_at/icmp_checked_at/
/// snmp_checked_at — ISO; snmp_status — ok|error; open_events — число
/// открытых событий; ping/device/availability — вложенные снимки.
/// </summary>
public sealed record HubMonitoringCurrent
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("icmp_checked_at")] public string? IcmpCheckedAt { get; init; }
    [JsonPropertyName("snmp_checked_at")] public string? SnmpCheckedAt { get; init; }
    [JsonPropertyName("snmp_status")] public string? SnmpStatus { get; init; }
    [JsonPropertyName("snmp_error")] public string? SnmpError { get; init; }
    [JsonPropertyName("last_success_at")] public string? LastSuccessAt { get; init; }
    [JsonPropertyName("open_events")] public int? OpenEvents { get; init; }
    [JsonPropertyName("ping")] public HubMonitoringPing? Ping { get; init; }
    [JsonPropertyName("device")] public HubMonitoringDevice? Device { get; init; }
    [JsonPropertyName("availability")] public HubMonitoringAvailability? Availability { get; init; }
}

/// <summary>
/// Эпизод недоступности (outages[] в overview/detail): kind —
/// unreachable|link; для link заполнены interface_name/interface_role;
/// closed_at == null — эпизод ещё открыт.
/// </summary>
public sealed record HubMonitoringOutage
{
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("interface_name")] public string? InterfaceName { get; init; }
    [JsonPropertyName("interface_role")] public string? InterfaceRole { get; init; }
    [JsonPropertyName("opened_at")] public string? OpenedAt { get; init; }
    [JsonPropertyName("closed_at")] public string? ClosedAt { get; init; }
}

/// <summary>
/// Событие журнала мониторинга (events[] детали): kind — unreachable|snmp|
/// link|flapping|speed|utilization|errors|cpu_pct|memory_pct|temperature_c|
/// latency|loss|restart|identity; severity — critical|warning|info;
/// closed_at == null — событие открыто.
/// </summary>
public sealed record HubMonitoringEvent
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("target_id")] public string? TargetId { get; init; }
    [JsonPropertyName("interface_id")] public string? InterfaceId { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("severity")] public string? Severity { get; init; }
    [JsonPropertyName("opened_at")] public string? OpenedAt { get; init; }
    [JsonPropertyName("closed_at")] public string? ClosedAt { get; init; }
}

/// <summary>
/// Настройки интерфейса (interfaces[].settings): role — wan|lan|wifi|other,
/// critical — «важный» (алерты по линку), pinned — закреплён для карточки.
/// </summary>
public sealed record HubMonitoringInterfaceSettings
{
    [JsonPropertyName("role")] public string? Role { get; init; }
    [JsonPropertyName("critical")] public bool Critical { get; init; }
    [JsonPropertyName("pinned")] public bool Pinned { get; init; }
}

/// <summary>
/// Текущее состояние интерфейса (interfaces[].current): admin/oper —
/// IF-MIB (1=up, 2=down), bps — скорости в бит/с, util_pct — загрузка
/// канала в %, absent_since — порт пропал из опроса (сервер его не отдаёт).
/// </summary>
public sealed record HubMonitoringInterfaceCurrent
{
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("admin")] public int? Admin { get; init; }
    [JsonPropertyName("oper")] public int? Oper { get; init; }
    [JsonPropertyName("alias")] public string? Alias { get; init; }
    [JsonPropertyName("type")] public int? Type { get; init; }
    [JsonPropertyName("speed_bps")] public double? SpeedBps { get; init; }
    [JsonPropertyName("rx_bps")] public double? RxBps { get; init; }
    [JsonPropertyName("tx_bps")] public double? TxBps { get; init; }
    [JsonPropertyName("rx_util_pct")] public double? RxUtilPct { get; init; }
    [JsonPropertyName("tx_util_pct")] public double? TxUtilPct { get; init; }
}

/// <summary>Интерфейс устройства мониторинга (interfaces[] детали цели).</summary>
public sealed record HubMonitoringInterface
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("snmp_index")] public int? SnmpIndex { get; init; }
    [JsonPropertyName("settings")] public HubMonitoringInterfaceSettings? Settings { get; init; }
    [JsonPropertyName("current")] public HubMonitoringInterfaceCurrent? Current { get; init; }
}

/// <summary>
/// Карточная сводка трафика (targets[].summary в overview): выбранный
/// интерфейс и его последние rx_bps/tx_bps/speed_bps. Точки спарклайна
/// в нативный срез не входят.
/// </summary>
public sealed record HubMonitoringSummary
{
    [JsonPropertyName("interface_id")] public string? InterfaceId { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("pinned")] public bool Pinned { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("rx_bps")] public double? RxBps { get; init; }
    [JsonPropertyName("tx_bps")] public double? TxBps { get; init; }
    [JsonPropertyName("speed_bps")] public double? SpeedBps { get; init; }
}

/// <summary>
/// Цель мониторинга: target_data (id/name/address/port/enabled/current/
/// updated_at) + прикреплённые в overview outages[] и summary; в детали
/// добавляются interfaces[] и events[] (до 50 последних).
/// </summary>
public sealed record HubMonitoringTarget
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("address")] public string? Address { get; init; }
    [JsonPropertyName("port")] public int? Port { get; init; }
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("current")] public HubMonitoringCurrent? Current { get; init; }
    [JsonPropertyName("outages")] public IReadOnlyList<HubMonitoringOutage>? Outages { get; init; }
    [JsonPropertyName("summary")] public HubMonitoringSummary? Summary { get; init; }
    [JsonPropertyName("interfaces")] public IReadOnlyList<HubMonitoringInterface>? Interfaces { get; init; }
    [JsonPropertyName("events")] public IReadOnlyList<HubMonitoringEvent>? Events { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// Состояние сборщика (worker{} из overview): enabled — фоновый сбор
/// ожидается; heartbeat_at — метка последнего цикла; cycle_seconds — длительность.
/// </summary>
public sealed record HubMonitoringWorker
{
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("heartbeat_at")] public string? HeartbeatAt { get; init; }
    [JsonPropertyName("cycle_seconds")] public double? CycleSeconds { get; init; }
}

/// <summary>Ответ GET /monitoring/overview: targets[] + worker + checked_at.</summary>
public sealed record HubMonitoringOverview
{
    [JsonPropertyName("targets")] public IReadOnlyList<HubMonitoringTarget>? Targets { get; init; }
    [JsonPropertyName("worker")] public HubMonitoringWorker? Worker { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
}

// ---- МФУ и принтеры (/mfu, read-срез: список со статусами, печать по месяцам,
// ---- статистика работ из JSON-журнала) ----

/// <summary>
/// ICMP-снимок устройства (runtime.ping из GET /mfu/devices):
/// status — online|offline|unknown; latency_ms — ответ последнего ping;
/// last_online_at — когда устройство последний раз было в сети.
/// </summary>
public sealed record HubMfuPing
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("latency_ms")] public double? LatencyMs { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("last_online_at")] public string? LastOnlineAt { get; init; }
}

/// <summary>
/// Расходник устройства (runtime.snmp.supplies[], Printer-MIB): процент
/// остатка и абсолютные уровень/ёмкость; index — индекс prtMarkerSupplies.
/// </summary>
public sealed record HubMfuSupply
{
    [JsonPropertyName("index")] public int? Index { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("level")] public int? Level { get; init; }
    [JsonPropertyName("max")] public int? Max { get; init; }
    [JsonPropertyName("percent")] public int? Percent { get; init; }
}

/// <summary>
/// Лоток бумаги (runtime.snmp.trays[]): имя/тип носителя и заполненность
/// в процентах и листах.
/// </summary>
public sealed record HubMfuTray
{
    [JsonPropertyName("index")] public int? Index { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("media_name")] public string? MediaName { get; init; }
    [JsonPropertyName("current_level")] public int? CurrentLevel { get; init; }
    [JsonPropertyName("max_capacity")] public int? MaxCapacity { get; init; }
    [JsonPropertyName("percent")] public int? Percent { get; init; }
}

/// <summary>
/// Идентификация устройства по SNMP (runtime.snmp.device_info):
/// sys_name/sys_descr/sys_location из MIB-2, модель и заводской серийник.
/// </summary>
public sealed record HubMfuDeviceInfo
{
    [JsonPropertyName("sys_name")] public string? SysName { get; init; }
    [JsonPropertyName("sys_descr")] public string? SysDescr { get; init; }
    [JsonPropertyName("sys_location")] public string? SysLocation { get; init; }
    [JsonPropertyName("device_model")] public string? DeviceModel { get; init; }
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("uptime_seconds")] public long? UptimeSeconds { get; init; }
}

/// <summary>
/// SNMP-снимок (runtime.snmp): status — ok|error|no_data; best_percent —
/// лучший процент остатка по расходникам (когда supplies пусты); page_total —
/// счётчик отпечатанных страниц; error — текст последней ошибки опроса.
/// </summary>
public sealed record HubMfuSnmp
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("checked_at")] public string? CheckedAt { get; init; }
    [JsonPropertyName("last_success_at")] public string? LastSuccessAt { get; init; }
    [JsonPropertyName("best_percent")] public int? BestPercent { get; init; }
    [JsonPropertyName("page_total")] public long? PageTotal { get; init; }
    [JsonPropertyName("page_checked_at")] public string? PageCheckedAt { get; init; }
    [JsonPropertyName("page_oid")] public string? PageOid { get; init; }
    [JsonPropertyName("supplies")] public IReadOnlyList<HubMfuSupply>? Supplies { get; init; }
    [JsonPropertyName("trays")] public IReadOnlyList<HubMfuTray>? Trays { get; init; }
    [JsonPropertyName("device_info")] public HubMfuDeviceInfo? DeviceInfo { get; init; }
    [JsonPropertyName("custom_metrics")] public Dictionary<string, string>? CustomMetrics { get; init; }
    [JsonPropertyName("version")] public string? Version { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
}

/// <summary>Пара рантайм-статусов устройства (runtime{} из GET /mfu/devices).</summary>
public sealed record HubMfuRuntime
{
    [JsonPropertyName("ping")] public HubMfuPing? Ping { get; init; }
    [JsonPropertyName("snmp")] public HubMfuSnmp? Snmp { get; init; }
}

/// <summary>
/// Запись о работе с устройством (maintenance.recent[] из GET /mfu/devices):
/// строка из JSON-журнала работ МФУ (замена картриджа/фьюзера и т.п.).
/// </summary>
public sealed record HubMfuMaintenanceEvent
{
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("printer_model")] public string? PrinterModel { get; init; }
    [JsonPropertyName("component_type")] public string? ComponentType { get; init; }
    [JsonPropertyName("replacement_item")] public string? ReplacementItem { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
}

/// <summary>История работ по устройству (maintenance{} из GET /mfu/devices).</summary>
public sealed record HubMfuMaintenance
{
    [JsonPropertyName("total_operations")] public int TotalOperations { get; init; }
    [JsonPropertyName("last_operation_at")] public string? LastOperationAt { get; init; }
    [JsonPropertyName("recent")] public IReadOnlyList<HubMfuMaintenanceEvent>? Recent { get; init; }
}

/// <summary>
/// Нормализованная строка инвентаря МФУ/принтера/плоттера (элементы массивов
/// в grouped{филиал → локация → […]} ответа GET /mfu/devices; поля — по
/// backend/services/mfu_device_rows.py). key — «db|item id» для pages/monthly.
/// </summary>
public sealed record HubMfuDevice
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("type_name")] public string? TypeName { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("location_name")] public string? LocationName { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("ip_address")] public string? IpAddress { get; init; }
    [JsonPropertyName("hostname")] public string? Hostname { get; init; }
    [JsonPropertyName("mac_address")] public string? MacAddress { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_dept")] public string? EmployeeDept { get; init; }
    [JsonPropertyName("runtime")] public HubMfuRuntime? Runtime { get; init; }
    [JsonPropertyName("maintenance")] public HubMfuMaintenance? Maintenance { get; init; }
}

/// <summary>
/// Агрегаты по всему набору устройств (totals{} из GET /mfu/devices):
/// ping-статусы, SNMP-качество (fresh — успех за ttl, cached — активный кэш)
/// и служебные счётчики опросчика.
/// </summary>
public sealed record HubMfuTotals
{
    [JsonPropertyName("devices")] public int Devices { get; init; }
    [JsonPropertyName("online")] public int Online { get; init; }
    [JsonPropertyName("offline")] public int Offline { get; init; }
    [JsonPropertyName("unknown")] public int Unknown { get; init; }
    [JsonPropertyName("snmp_ok")] public int SnmpOk { get; init; }
    [JsonPropertyName("snmp_fresh")] public int SnmpFresh { get; init; }
    [JsonPropertyName("snmp_cached_active")] public int SnmpCachedActive { get; init; }
    [JsonPropertyName("snmp_error")] public int SnmpError { get; init; }
    [JsonPropertyName("snmp_unknown")] public int SnmpUnknown { get; init; }
    [JsonPropertyName("snmp_probe_timeout_count")] public int SnmpProbeTimeoutCount { get; init; }
    [JsonPropertyName("snmp_devices_in_backoff")] public int SnmpDevicesInBackoff { get; init; }
    [JsonPropertyName("snmp_active_ttl_sec")] public int SnmpActiveTtlSec { get; init; }
}

/// <summary>Отладочная мета ответа GET /mfu/devices (источник и усечение).</summary>
public sealed record HubMfuMeta
{
    [JsonPropertyName("source_limit")] public int SourceLimit { get; init; }
    [JsonPropertyName("raw_rows_count")] public int RawRowsCount { get; init; }
    [JsonPropertyName("matched_mfu_count")] public int MatchedMfuCount { get; init; }
    [JsonPropertyName("source_maybe_truncated")] public bool SourceMaybeTruncated { get; init; }
}

/// <summary>
/// Ответ GET /mfu/devices: снимок всего парка МФУ выбранной БД, сгруппированный
/// по филиалам и локациям ({филиал → локация → [devices]}).
/// </summary>
public sealed record HubMfuDeviceList
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("db_id")] public string? DbId { get; init; }
    [JsonPropertyName("totals")] public HubMfuTotals? Totals { get; init; }
    [JsonPropertyName("grouped")] public Dictionary<string, Dictionary<string, List<HubMfuDevice>>>? Grouped { get; init; }
    [JsonPropertyName("meta")] public HubMfuMeta? Meta { get; init; }
}

/// <summary>Помесячная печать устройства (months[] из GET /mfu/pages/monthly).</summary>
public sealed record HubMfuMonthPages
{
    [JsonPropertyName("month")] public string? Month { get; init; }
    [JsonPropertyName("printed_pages")] public int PrintedPages { get; init; }
    [JsonPropertyName("start_counter")] public int? StartCounter { get; init; }
    [JsonPropertyName("end_counter")] public int? EndCounter { get; init; }
    [JsonPropertyName("reset_detected")] public bool ResetDetected { get; init; }
}

/// <summary>
/// Ответ GET /mfu/pages/monthly?device_key=&months= — печать по месяцам
/// и текущий SNMP-счётчик страниц устройства.
/// </summary>
public sealed record HubMfuMonthlyPages
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("device_key")] public string? DeviceKey { get; init; }
    [JsonPropertyName("months_requested")] public int MonthsRequested { get; init; }
    [JsonPropertyName("months")] public IReadOnlyList<HubMfuMonthPages>? Months { get; init; }
    [JsonPropertyName("current_total_pages")] public int? CurrentTotalPages { get; init; }
    [JsonPropertyName("current_checked_at")] public string? CurrentCheckedAt { get; init; }
    [JsonPropertyName("tracking_start_date")] public string? TrackingStartDate { get; init; }
    [JsonPropertyName("page_oid")] public string? PageOid { get; init; }
}

/// <summary>Агрегаты работ МФУ (totals{} из GET /json/works/mfu/statistics).</summary>
public sealed record HubMfuWorksTotals
{
    [JsonPropertyName("total_operations")] public int TotalOperations { get; init; }
    [JsonPropertyName("unique_branches")] public int UniqueBranches { get; init; }
    [JsonPropertyName("unique_locations")] public int UniqueLocations { get; init; }
}

/// <summary>Позиция топа моделей (by_model_period[] из /json/works/mfu/statistics).</summary>
public sealed record HubMfuWorksModelStat
{
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Топ-расходник локации (top_items[] в by_location_period).</summary>
public sealed record HubMfuWorksLocationItemStat
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Строка статистики по локации (by_location_period[] из /json/works/mfu/statistics).</summary>
public sealed record HubMfuWorksLocationStat
{
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("operations")] public int Operations { get; init; }
    [JsonPropertyName("last_timestamp")] public string? LastTimestamp { get; init; }
    [JsonPropertyName("by_type")] public Dictionary<string, int>? ByType { get; init; }
    [JsonPropertyName("top_items")] public IReadOnlyList<HubMfuWorksLocationItemStat>? TopItems { get; init; }
}

/// <summary>
/// Ответ GET /json/works/mfu/statistics: журнальные работы МФУ за период —
/// итоги, разрезы по типам/расходникам/филиалам/моделям и последние замены.
/// by_type_period/by_item_period — словари «название → число работ».
/// </summary>
public sealed record HubMfuWorksStatistics
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("period_days")] public int PeriodDays { get; init; }
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("totals")] public HubMfuWorksTotals? Totals { get; init; }
    [JsonPropertyName("by_type_period")] public Dictionary<string, int>? ByTypePeriod { get; init; }
    [JsonPropertyName("by_item_period")] public Dictionary<string, int>? ByItemPeriod { get; init; }
    [JsonPropertyName("by_branch_period")] public Dictionary<string, int>? ByBranchPeriod { get; init; }
    [JsonPropertyName("by_model_period")] public IReadOnlyList<HubMfuWorksModelStat>? ByModelPeriod { get; init; }
    [JsonPropertyName("by_location_period")] public IReadOnlyList<HubMfuWorksLocationStat>? ByLocationPeriod { get; init; }
    [JsonPropertyName("recent_replacements")] public IReadOnlyList<HubMfuMaintenanceEvent>? RecentReplacements { get; init; }
}

// ---- Статистика работ /json/works/*/statistics (страница «Статистика» веба) ----

/// <summary>Агрегаты чистки ПК (totals{} из GET /json/works/cleaning/statistics).</summary>
public sealed record HubPcCleaningStatisticsTotals
{
    [JsonPropertyName("total_pc")] public int TotalPc { get; init; }
    [JsonPropertyName("cleaned_pc")] public int CleanedPc { get; init; }
    [JsonPropertyName("remaining_pc")] public int RemainingPc { get; init; }
    [JsonPropertyName("coverage_percent")] public double CoveragePercent { get; init; }
    [JsonPropertyName("cleanings_total")] public int CleaningsTotal { get; init; }
    [JsonPropertyName("cleanings_period")] public int CleaningsPeriod { get; init; }
}

/// <summary>
/// Строка филиала (branches[] из /json/works/cleaning/statistics).
/// Вложенный remaining_pcs[] не читаем: список непочищенных ПК догружается
/// отдельным endpoint'ом /works/cleaning/statistics/remaining и в срез не входит.
/// </summary>
public sealed record HubPcCleaningBranchStat
{
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("total_pc")] public int TotalPc { get; init; }
    [JsonPropertyName("cleaned_pc")] public int CleanedPc { get; init; }
    [JsonPropertyName("remaining_pc")] public int RemainingPc { get; init; }
    [JsonPropertyName("coverage_percent")] public double CoveragePercent { get; init; }
    [JsonPropertyName("cleanings_total")] public int CleaningsTotal { get; init; }
    [JsonPropertyName("cleanings_period")] public int CleaningsPeriod { get; init; }
}

/// <summary>
/// Ответ GET /json/works/cleaning/statistics: покрытие чистки ПК по филиалам
/// за период (start_date/end_date — границы периода от сервера).
/// </summary>
public sealed record HubPcCleaningStatistics
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("period_days")] public int PeriodDays { get; init; }
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("totals")] public HubPcCleaningStatisticsTotals? Totals { get; init; }
    [JsonPropertyName("branches")] public IReadOnlyList<HubPcCleaningBranchStat>? Branches { get; init; }
}

/// <summary>Агрегаты замен батарей ИБП (totals{} из GET /json/works/battery/statistics).</summary>
public sealed record HubBatteryStatisticsTotals
{
    [JsonPropertyName("total_operations")] public int TotalOperations { get; init; }
    [JsonPropertyName("unique_branches")] public int UniqueBranches { get; init; }
    [JsonPropertyName("unique_locations")] public int UniqueLocations { get; init; }
}

/// <summary>Позиция топа моделей ИБП (by_model_period[] из /json/works/battery/statistics).</summary>
public sealed record HubBatteryModelStat
{
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Топ-позиция локации (top_items[] в by_location_period батарей).</summary>
public sealed record HubBatteryLocationItemStat
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Строка статистики по локации (by_location_period[] из /json/works/battery/statistics).</summary>
public sealed record HubBatteryLocationStat
{
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("operations")] public int Operations { get; init; }
    [JsonPropertyName("last_timestamp")] public string? LastTimestamp { get; init; }
    [JsonPropertyName("top_items")] public IReadOnlyList<HubBatteryLocationItemStat>? TopItems { get; init; }
}

/// <summary>Последняя замена батареи (recent_replacements[] из /json/works/battery/statistics).</summary>
public sealed record HubBatteryReplacementEvent
{
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("replacement_item")] public string? ReplacementItem { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
}

/// <summary>
/// Ответ GET /json/works/battery/statistics: замены батарей ИБП за период —
/// итоги, разрезы по позициям/производителям/филиалам/моделям/локациям
/// и последние записи. Словари — «название → число замен», уже отсортированы.
/// </summary>
public sealed record HubBatteryStatistics
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("period_days")] public int PeriodDays { get; init; }
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("totals")] public HubBatteryStatisticsTotals? Totals { get; init; }
    [JsonPropertyName("by_branch_period")] public Dictionary<string, int>? ByBranchPeriod { get; init; }
    [JsonPropertyName("by_model_period")] public IReadOnlyList<HubBatteryModelStat>? ByModelPeriod { get; init; }
    [JsonPropertyName("by_manufacturer_period")] public Dictionary<string, int>? ByManufacturerPeriod { get; init; }
    [JsonPropertyName("by_item_period")] public Dictionary<string, int>? ByItemPeriod { get; init; }
    [JsonPropertyName("by_location_period")] public IReadOnlyList<HubBatteryLocationStat>? ByLocationPeriod { get; init; }
    [JsonPropertyName("recent_replacements")] public IReadOnlyList<HubBatteryReplacementEvent>? RecentReplacements { get; init; }
}

/// <summary>Агрегаты замен комплектующих ПК (totals{} из GET /json/works/pc-components/statistics).</summary>
public sealed record HubPcComponentsStatisticsTotals
{
    [JsonPropertyName("total_operations")] public int TotalOperations { get; init; }
    [JsonPropertyName("unique_branches")] public int UniqueBranches { get; init; }
    [JsonPropertyName("unique_locations")] public int UniqueLocations { get; init; }
}

/// <summary>Позиция топа моделей ПК (by_model_period[] из /json/works/pc-components/statistics).</summary>
public sealed record HubPcComponentsModelStat
{
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Топ-позиция локации (top_items[] в by_location_period комплектующих).</summary>
public sealed record HubPcComponentsLocationItemStat
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
}

/// <summary>Строка статистики по локации (by_location_period[] из /json/works/pc-components/statistics).</summary>
public sealed record HubPcComponentsLocationStat
{
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("operations")] public int Operations { get; init; }
    [JsonPropertyName("last_timestamp")] public string? LastTimestamp { get; init; }
    [JsonPropertyName("top_items")] public IReadOnlyList<HubPcComponentsLocationItemStat>? TopItems { get; init; }
}

/// <summary>Последняя замена комплектующего (recent_replacements[] из /json/works/pc-components/statistics).</summary>
public sealed record HubPcComponentsReplacementEvent
{
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("component_name")] public string? ComponentName { get; init; }
    [JsonPropertyName("replacement_item")] public string? ReplacementItem { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
}

/// <summary>
/// Ответ GET /json/works/pc-components/statistics: замены комплектующих ПК
/// за период — итоги, разрезы по компонентам/позициям/филиалам/моделям/локациям
/// и последние записи.
/// </summary>
public sealed record HubPcComponentsStatistics
{
    [JsonPropertyName("generated_at")] public string? GeneratedAt { get; init; }
    [JsonPropertyName("period_days")] public int PeriodDays { get; init; }
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("totals")] public HubPcComponentsStatisticsTotals? Totals { get; init; }
    [JsonPropertyName("by_component_period")] public Dictionary<string, int>? ByComponentPeriod { get; init; }
    [JsonPropertyName("by_item_period")] public Dictionary<string, int>? ByItemPeriod { get; init; }
    [JsonPropertyName("by_branch_period")] public Dictionary<string, int>? ByBranchPeriod { get; init; }
    [JsonPropertyName("by_model_period")] public IReadOnlyList<HubPcComponentsModelStat>? ByModelPeriod { get; init; }
    [JsonPropertyName("by_location_period")] public IReadOnlyList<HubPcComponentsLocationStat>? ByLocationPeriod { get; init; }
    [JsonPropertyName("recent_replacements")] public IReadOnlyList<HubPcComponentsReplacementEvent>? RecentReplacements { get; init; }
}

/// <summary>
/// GET/PATCH /settings/me — пользовательские настройки интерфейса.
/// Нативный клиент читает и сохраняет только внешний вид; остальные поля
/// контракта (pinned_database, dashboard_sections, mobile_bottom_nav_items,
/// database_branch_filters) десктоп не редактирует.
/// </summary>
public sealed record HubUserSettings
{
    [JsonPropertyName("theme_mode")] public string? ThemeMode { get; init; }
    [JsonPropertyName("font_family")] public string? FontFamily { get; init; }
    [JsonPropertyName("font_scale")] public double? FontScale { get; init; }
}

/// <summary>
/// GET/PATCH /settings/notifications/preferences — каналы уведомлений пользователя.
/// Серверная семантика chat-каналов: явный chat наследуется подканалами
/// (chat_direct/chat_group/chat_task/chat_ai), правка подканалов сводит chat
/// в «включён, если хоть один подканал включён». quiet_hours в ответе есть,
/// но десктоп его пока не редактирует.
/// </summary>
public sealed record HubNotificationPreferences
{
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("channels")] public Dictionary<string, bool>? Channels { get; init; }
}

/// <summary>
/// Ответ POST /auth/change-password. Сервер при успехе закрывает все сессии
/// пользователя и отзывает доверенные устройства/биометрические креденшелы.
/// </summary>
public sealed record HubChangePasswordResult
{
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("closed_sessions")] public int ClosedSessions { get; init; }
    [JsonPropertyName("revoked_devices")] public int RevokedDevices { get; init; }
    [JsonPropertyName("revoked_biometric_credentials")] public int RevokedBiometricCredentials { get; init; }
}

// ---- Администрирование (/admin — read-срез как в вебе) ----

/// <summary>
/// Пользователь веб-доступа: элемент списка GET /auth/users
/// (право settings.users.manage). Создание/правка/деактивация — вне read-среза.
/// </summary>
public sealed record HubAdminUser
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("email")] public string? Email { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("job_title")] public string? JobTitle { get; init; }
    [JsonPropertyName("role")] public string? Role { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("auth_source")] public string? AuthSource { get; init; }
    [JsonPropertyName("telegram_id")] public long? TelegramId { get; init; }
    [JsonPropertyName("assigned_database")] public string? AssignedDatabase { get; init; }
    [JsonPropertyName("mailbox_email")] public string? MailboxEmail { get; init; }
    [JsonPropertyName("mailbox_login")] public string? MailboxLogin { get; init; }
    [JsonPropertyName("mail_is_configured")] public bool MailIsConfigured { get; init; }
    [JsonPropertyName("use_custom_permissions")] public bool UseCustomPermissions { get; init; }
    [JsonPropertyName("custom_permissions")] public IReadOnlyList<string>? CustomPermissions { get; init; }
    [JsonPropertyName("is_2fa_enabled")] public bool IsTwoFactorEnabled { get; init; }
    [JsonPropertyName("last_login_at")] public string? LastLoginAt { get; init; }
}

/// <summary>
/// PATCH /auth/users/{id} — тело UserUpdateRequest бэкенда. Все поля nullable
/// и null не сериализуется (exclude_unset-семантика): клиент заполняет только
/// реально изменённые поля, остальные ключи в JSON отсутствуют.
/// Сервер сам режет права: свой is_active=false → 400, свои role/permissions → 403,
/// не-admin — только {email, full_name, department, job_title} не-admin целей.
/// </summary>
public sealed record HubUserUpdateRequest
{
    [JsonPropertyName("email")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Email { get; init; }
    [JsonPropertyName("full_name")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? FullName { get; init; }
    [JsonPropertyName("department")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Department { get; init; }
    [JsonPropertyName("job_title")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? JobTitle { get; init; }
    [JsonPropertyName("role")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Role { get; init; }
    [JsonPropertyName("auth_source")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? AuthSource { get; init; }
    [JsonPropertyName("telegram_id")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public long? TelegramId { get; init; }
    [JsonPropertyName("assigned_database")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? AssignedDatabase { get; init; }
    [JsonPropertyName("is_active")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? IsActive { get; init; }
    [JsonPropertyName("password")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Password { get; init; }
    [JsonPropertyName("use_custom_permissions")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? UseCustomPermissions { get; init; }
    [JsonPropertyName("custom_permissions")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? CustomPermissions { get; init; }
    [JsonPropertyName("mailbox_email")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxEmail { get; init; }
    [JsonPropertyName("mailbox_login")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxLogin { get; init; }
    [JsonPropertyName("mailbox_password")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxPassword { get; init; }
    [JsonPropertyName("mail_signature_html")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailSignatureHtml { get; init; }
    [JsonPropertyName("my_files_quota_bytes")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public long? MyFilesQuotaBytes { get; init; }
}

/// <summary>
/// POST /auth/users — тело UserCreateRequest (201 → User). username обязателен;
/// остальные null-поля опускаются — бэкенд подставляет свои дефолты
/// (role=viewer, is_active=true, auth_source=local).
/// </summary>
public sealed record HubUserCreateRequest
{
    [JsonPropertyName("username")] public required string Username { get; init; }
    [JsonPropertyName("password")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Password { get; init; }
    [JsonPropertyName("email")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Email { get; init; }
    [JsonPropertyName("full_name")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? FullName { get; init; }
    [JsonPropertyName("department")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Department { get; init; }
    [JsonPropertyName("job_title")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? JobTitle { get; init; }
    [JsonPropertyName("role")] public string Role { get; init; } = "viewer";
    [JsonPropertyName("auth_source")] public string AuthSource { get; init; } = "local";
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("use_custom_permissions")] public bool UseCustomPermissions { get; init; }
    [JsonPropertyName("custom_permissions")] public IReadOnlyList<string> CustomPermissions { get; init; } = [];
    [JsonPropertyName("telegram_id")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public long? TelegramId { get; init; }
    [JsonPropertyName("assigned_database")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? AssignedDatabase { get; init; }
    [JsonPropertyName("mailbox_email")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxEmail { get; init; }
    [JsonPropertyName("mailbox_login")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxLogin { get; init; }
    [JsonPropertyName("mailbox_password")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailboxPassword { get; init; }
    [JsonPropertyName("mail_signature_html")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? MailSignatureHtml { get; init; }
    [JsonPropertyName("my_files_quota_bytes")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public long? MyFilesQuotaBytes { get; init; }
}

/// <summary>Ответ POST /auth/users/{id}/reset-2fa — счётчики сброса TOTP.</summary>
public sealed record HubResetTwoFactorResult
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("revoked_devices")] public int RevokedDevices { get; init; }
    [JsonPropertyName("revoked_biometric_credentials")] public int RevokedBiometricCredentials { get; init; }
    [JsonPropertyName("closed_sessions")] public int ClosedSessions { get; init; }
}

/// <summary>
/// Отдел: элемент items[] из GET /departments (право departments.manage
/// или базовое settings.read — список отдаёт сервер).
/// </summary>
public sealed record HubAdminDepartment
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("members_count")] public int MembersCount { get; init; }
    [JsonPropertyName("managers_count")] public int ManagersCount { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /departments → {items: [...]}.</summary>
public sealed record HubAdminDepartmentList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAdminDepartment>? Items { get; init; }
}

/// <summary>
/// Сотрудник в записи membership отдела (items[].user из
/// GET /departments/{id}/members): id/логин/ФИО/должность.
/// </summary>
public sealed record HubAdminDepartmentMemberUser
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("job_title")] public string? JobTitle { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
}

/// <summary>
/// Запись membership: user_id + роль (member|manager) + вложенный user.
/// Один пользователь может иметь несколько записей (member + manager).
/// </summary>
public sealed record HubAdminDepartmentMember
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("role")] public string? Role { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; } = true;
    [JsonPropertyName("user")] public HubAdminDepartmentMemberUser? User { get; init; }
}

/// <summary>Ответ GET /departments/{id}/members → {department, items[]}.</summary>
public sealed record HubAdminDepartmentMembers
{
    [JsonPropertyName("department")] public HubAdminDepartment? Department { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubAdminDepartmentMember>? Items { get; init; }
}

/// <summary>
/// Пользователь AD — кандидат на импорт: элемент массива
/// GET /ad-users/import-candidates (admin). import_status:
/// new|exists_ldap|local_conflict|non_person; warnings[] — missing_mail и др.
/// </summary>
public sealed record HubAdminAdCandidate
{
    [JsonPropertyName("login")] public string? Login { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("mail")] public string? Mail { get; init; }
    [JsonPropertyName("user_principal_name")] public string? UserPrincipalName { get; init; }
    [JsonPropertyName("mailbox_login")] public string? MailboxLogin { get; init; }
    [JsonPropertyName("import_status")] public string? ImportStatus { get; init; }
    [JsonPropertyName("warnings")] public IReadOnlyList<string>? Warnings { get; init; }
}

/// <summary>
/// Статус AD-синхронизации в app: GET /ad-users/sync-status (admin).
/// result{} — счётчики последней синхронизации; в read-срезе берём
/// основные числа, полный разбор остаётся в вебе.
/// </summary>
public sealed record HubAdminAdSyncStatus
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("last_sync_at")] public string? LastSyncAt { get; init; }
    [JsonPropertyName("error")] public string? Error { get; init; }
    [JsonPropertyName("result")] public HubAdminAdSyncResult? Result { get; init; }
}

/// <summary>Счётчики последней синхронизации AD→app (result{} из sync-status).</summary>
public sealed record HubAdminAdSyncResult
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("created")] public int Created { get; init; }
    [JsonPropertyName("updated")] public int Updated { get; init; }
    [JsonPropertyName("reactivated")] public int Reactivated { get; init; }
    [JsonPropertyName("deactivated")] public int Deactivated { get; init; }
    [JsonPropertyName("skipped")] public int Skipped { get; init; }
    [JsonPropertyName("errors")] public IReadOnlyList<string>? Errors { get; init; }
}

/// <summary>
/// Предложение по улучшению: элемент items[] из GET /feedback
/// (право feedback.manage). status: new|in_progress|accepted|declined|done.
/// </summary>
public sealed record HubAdminFeedbackItem
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("section")] public string? Section { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("admin_note")] public string? AdminNote { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
    [JsonPropertyName("author")] public HubAdminFeedbackAuthor? Author { get; init; }
}

/// <summary>Автор предложения (author{} из feedback-элемента).</summary>
public sealed record HubAdminFeedbackAuthor
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
}

/// <summary>Ответ GET /feedback?status=&limit=&offset= → {items,total,counts}.</summary>
public sealed record HubAdminFeedbackPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAdminFeedbackItem>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }

    /// <summary>Счётчики по статусам — counts{new,in_progress,accepted,declined,done}.</summary>
    [JsonPropertyName("counts")] public Dictionary<string, int>? Counts { get; init; }
}

/// <summary>
/// Маршрут метрик запросов: элемент routes[] из GET /system/request-metrics (admin).
/// </summary>
public sealed record HubAdminRouteStat
{
    [JsonPropertyName("method")] public string? Method { get; init; }
    [JsonPropertyName("path")] public string? Path { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("server_error_count")] public int ServerErrorCount { get; init; }
    [JsonPropertyName("client_error_count")] public int ClientErrorCount { get; init; }
    [JsonPropertyName("mean_ms")] public double MeanMs { get; init; }
    [JsonPropertyName("p50_ms")] public double P50Ms { get; init; }
    [JsonPropertyName("p95_ms")] public double P95Ms { get; init; }
    [JsonPropertyName("p99_ms")] public double P99Ms { get; init; }
    [JsonPropertyName("max_ms")] public double MaxMs { get; init; }
    [JsonPropertyName("last_seen_at")] public string? LastSeenAt { get; init; }
}

/// <summary>Снимок метрик запросов: GET /system/request-metrics?limit=&sort_by= (admin).</summary>
public sealed record HubAdminRequestMetrics
{
    [JsonPropertyName("enabled")] public bool Enabled { get; init; }
    [JsonPropertyName("started_at")] public string? StartedAt { get; init; }
    [JsonPropertyName("uptime_sec")] public double UptimeSec { get; init; }
    [JsonPropertyName("route_count")] public int RouteCount { get; init; }
    [JsonPropertyName("total_requests")] public int TotalRequests { get; init; }
    [JsonPropertyName("total_server_errors")] public int TotalServerErrors { get; init; }
    [JsonPropertyName("server_error_rate")] public double ServerErrorRate { get; init; }
    [JsonPropertyName("slow_threshold_ms")] public double SlowThresholdMs { get; init; }
    [JsonPropertyName("sort_by")] public string? SortBy { get; init; }
    [JsonPropertyName("routes")] public IReadOnlyList<HubAdminRouteStat>? Routes { get; init; }
}

/// <summary>
/// AI-бот (админ-список): элемент массива GET /ai-bots и ответ
/// POST/PATCH (admin или право settings.ai.manage). Полей среза хватает
/// на форму правки; enabled_tools/tool_settings/доступ сотрудников
/// намеренно не редактируются — только читаются/пересылаются назад нетронутыми.
/// </summary>
public sealed record HubAdminAiBot
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("slug")] public string? Slug { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("system_prompt")] public string? SystemPrompt { get; init; }
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("temperature")] public double Temperature { get; init; } = 0.2;
    [JsonPropertyName("max_tokens")] public int MaxTokens { get; init; } = 2000;
    [JsonPropertyName("surface")] public string? Surface { get; init; }
    [JsonPropertyName("is_enabled")] public bool IsEnabled { get; init; }
    [JsonPropertyName("configured")] public bool Configured { get; init; }
    [JsonPropertyName("required_permission")] public string? RequiredPermission { get; init; }
    [JsonPropertyName("enabled_tools")] public IReadOnlyList<string>? EnabledTools { get; init; }
    [JsonPropertyName("allowed_kb_scope")] public IReadOnlyList<string>? AllowedKbScope { get; init; }
    [JsonPropertyName("allow_file_input")] public bool AllowFileInput { get; init; } = true;
    [JsonPropertyName("allow_generated_artifacts")] public bool AllowGeneratedArtifacts { get; init; } = true;
    [JsonPropertyName("allow_kb_document_delivery")] public bool AllowKbDocumentDelivery { get; init; }
    [JsonPropertyName("latest_run_status")] public string? LatestRunStatus { get; init; }
    [JsonPropertyName("latest_run_error")] public string? LatestRunError { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>
/// PATCH /ai-bots/{bot_id} — тело AiBotUpdateRequest бэкенда.
/// exclude_unset-семантика (как HubUserUpdateRequest): null-поля не
/// сериализуются — клиент заполняет только изменённые значения.
/// ВАЖНО: tool_settings сервер заменяет целиком (multi_db_mode/allowed_databases
/// затёрлись бы дефолтами) — поэтому лимиты/режим БД здесь не редактируются
/// и не отправляются вовсе.
/// </summary>
public sealed record HubAiBotUpdateRequest
{
    [JsonPropertyName("title")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Title { get; init; }
    [JsonPropertyName("description")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Description { get; init; }
    [JsonPropertyName("system_prompt")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? SystemPrompt { get; init; }
    [JsonPropertyName("model")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Model { get; init; }
    [JsonPropertyName("temperature")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public double? Temperature { get; init; }
    [JsonPropertyName("max_tokens")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public int? MaxTokens { get; init; }
    [JsonPropertyName("allowed_kb_scope")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? AllowedKbScope { get; init; }
    [JsonPropertyName("allow_file_input")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? AllowFileInput { get; init; }
    [JsonPropertyName("allow_generated_artifacts")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? AllowGeneratedArtifacts { get; init; }
    [JsonPropertyName("allow_kb_document_delivery")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? AllowKbDocumentDelivery { get; init; }
    [JsonPropertyName("is_enabled")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? IsEnabled { get; init; }
}

/// <summary>
/// POST /ai-bots — тело AiBotCreateRequest бэкенда. slug/title обязательны;
/// остальное совпадает с дефолтами сервера (enabled_tools/tool_settings/
/// surface/placement/required_permission — как у новой карточки веба).
/// </summary>
public sealed record HubAiBotCreateRequest
{
    [JsonPropertyName("slug")] public required string Slug { get; init; }
    [JsonPropertyName("title")] public required string Title { get; init; }
    [JsonPropertyName("description")] public string Description { get; init; } = string.Empty;
    [JsonPropertyName("system_prompt")] public string SystemPrompt { get; init; } = string.Empty;
    [JsonPropertyName("model")] public string Model { get; init; } = string.Empty;
    [JsonPropertyName("temperature")] public double Temperature { get; init; } = 0.2;
    [JsonPropertyName("max_tokens")] public int MaxTokens { get; init; } = 2000;
    [JsonPropertyName("allowed_kb_scope")] public IReadOnlyList<string> AllowedKbScope { get; init; } = [];
    [JsonPropertyName("allow_file_input")] public bool AllowFileInput { get; init; } = true;
    [JsonPropertyName("allow_generated_artifacts")] public bool AllowGeneratedArtifacts { get; init; } = true;
    [JsonPropertyName("allow_kb_document_delivery")] public bool AllowKbDocumentDelivery { get; init; }
    [JsonPropertyName("is_enabled")] public bool IsEnabled { get; init; } = true;
}

/// <summary>
/// PUT /departments/{id}/managers — тело replace_department_managers:
/// полная замена набора руководителей отдела (право departments.manage).
/// Ответ {items[]} — memberships того же вида, что у GET members.
/// </summary>
public sealed record HubDepartmentManagersUpdateRequest
{
    [JsonPropertyName("manager_user_ids")] public IReadOnlyList<long> ManagerUserIds { get; init; } = [];
}

public enum HubApiErrorKind
{
    /// <summary>Сеть/DNS/таймаут — сессия сохраняется, можно retry.</summary>
    Transport,
    /// <summary>HTTP-ответ с не-2xx статусом.</summary>
    Http,
    /// <summary>401: refresh исчерпан или user_inactive — сессия мертва, нужен логин.</summary>
    SessionExpired,
}

public sealed class HubApiException : Exception
{
    public HubApiException(HubApiErrorKind kind, string message, HttpStatusCode? statusCode = null, string? authReason = null, Exception? inner = null)
        : base(message, inner)
    {
        Kind = kind;
        StatusCode = statusCode;
        AuthReason = authReason;
    }

    public HubApiErrorKind Kind { get; }
    public HttpStatusCode? StatusCode { get; }

    /// <summary>Значение заголовка X-Hubit-Auth-Reason (например user_inactive).</summary>
    public string? AuthReason { get; }
}

// ============================================================================
// Администрирование новостей (раздел «Новости» нативной админки)
// Контракт — WEB-itinvent/backend/api/v1/hub.py; права:
// manage-выдача и publish/archive/delete — _require_announcement_manager
// (announcements.write ИЛИ announcements.moderate/admin), create — строго
// announcements.write, категории/теги — announcements.read (+moderate на запись).
// ============================================================================

/// <summary>Тег новости из GET /hub/announcement-tags и поля tags[] у item.</summary>
public sealed record HubAnnouncementTag
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("slug")] public string? Slug { get; init; }
    /// <summary>Сколько новостей используют тег (announcement-tags; у item.tags поля нет).</summary>
    [JsonPropertyName("usage_count")] public int UsageCount { get; init; }
}

/// <summary>Параметры GET /hub/announcements/manage (announcements.write|moderate).</summary>
public sealed record HubAnnouncementManageQuery
{
    /// <summary>draft|scheduled|published|archived; null — серверный дефолт draft.</summary>
    public string? Status { get; init; }
    /// <summary>Поиск по заголовку/тексту → параметр q.</summary>
    public string? Search { get; init; }
    public string? CategoryId { get; init; }
    public string? Tag { get; init; }
    public int Limit { get; init; } = 100;
    public int Offset { get; init; }
}

/// <summary>
/// Ответ GET /hub/announcements/manage:
/// {items,status,total,limit,offset,has_more,next_offset}.
/// </summary>
public sealed record HubAnnouncementManagePage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementItem>? Items { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("limit")] public int Limit { get; init; }
    [JsonPropertyName("offset")] public int Offset { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("next_offset")] public int? NextOffset { get; init; }
}

/// <summary>Ответ GET /hub/announcement-categories → {items:[{id,name,slug,is_active}]}.</summary>
public sealed record HubAnnouncementCategoryList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementCategory>? Items { get; init; }
}

/// <summary>Ответ GET /hub/announcement-tags → {items:[{id,name,slug,usage_count}]}.</summary>
public sealed record HubAnnouncementTagList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementTag>? Items { get; init; }
}

/// <summary>
/// Тело POST /hub/announcements (JSON-вариант, без файлов) и поля
/// multipart-варианта — имена как у createAnnouncement веб-клиента.
/// status: draft|published (scheduled/архив — не задаём в форме).
/// </summary>
public sealed record HubAnnouncementCreateRequest
{
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("preview")] public string? Preview { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    /// <summary>low|normal|high — дефолт сервера normal.</summary>
    [JsonPropertyName("priority")] public string? Priority { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("category_id")] public string? CategoryId { get; init; }
    /// <summary>Имена тегов — JSON-массивом и в multipart (как веб).</summary>
    [JsonPropertyName("tags")] public IReadOnlyList<string>? Tags { get; init; }
    [JsonPropertyName("requires_ack")] public bool RequiresAck { get; init; }
    [JsonPropertyName("is_pinned")] public bool IsPinned { get; init; }
    [JsonPropertyName("comments_enabled")] public bool CommentsEnabled { get; init; } = true;
    [JsonPropertyName("reactions_enabled")] public bool ReactionsEnabled { get; init; } = true;
    [JsonPropertyName("client_request_id")] public string? ClientRequestId { get; init; }
}

/// <summary>
/// PATCH /hub/announcements/{id} — только изменённые поля (exclude_unset,
/// как HubAiBotUpdateRequest): null не сериализуется. Пустая строка в
/// title/preview/body/category_id сервер трактует как очистку поля;
/// tags:[] — снять все теги. status здесь не передаём — переходы
/// идут отдельными publish/archive роутами.
/// </summary>
public sealed record HubAnnouncementUpdateRequest
{
    [JsonPropertyName("title")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Title { get; init; }
    [JsonPropertyName("preview")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Preview { get; init; }
    [JsonPropertyName("body")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Body { get; init; }
    [JsonPropertyName("priority")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? Priority { get; init; }
    [JsonPropertyName("category_id")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public string? CategoryId { get; init; }
    [JsonPropertyName("tags")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public IReadOnlyList<string>? Tags { get; init; }
    [JsonPropertyName("requires_ack")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? RequiresAck { get; init; }
    [JsonPropertyName("is_pinned")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? IsPinned { get; init; }
    [JsonPropertyName("comments_enabled")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? CommentsEnabled { get; init; }
    [JsonPropertyName("reactions_enabled")][JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] public bool? ReactionsEnabled { get; init; }
}

/// <summary>Локальный файл новости для multipart create / POST attachments.</summary>
public sealed record HubAnnouncementOutgoingFile
{
    public string FileName { get; init; } = "file.bin";
    public string? ContentType { get; init; }
    public ReadOnlyMemory<byte> Content { get; init; }
}

/// <summary>Тело POST /hub/announcement-categories {name[,slug,is_active]} (moderate).</summary>
public sealed record HubAnnouncementCategorySaveRequest
{
    [JsonPropertyName("name")] public required string Name { get; init; }
}

/// <summary>
/// Ответ GET /hub/announcements/{id}/analytics:
/// {items:[read-строки], summary:{recipients/seen/ack/реакции/опрос}}.
/// </summary>
public sealed record HubAnnouncementAnalytics
{
    [JsonPropertyName("items")] public IReadOnlyList<HubAnnouncementReadItem>? Items { get; init; }
    [JsonPropertyName("summary")] public HubAnnouncementAnalyticsSummary? Summary { get; init; }
}

/// <summary>Строка прочтения в analytics/reads (read_at может быть "" — строки, не DateTime).</summary>
public sealed record HubAnnouncementReadItem
{
    [JsonPropertyName("user_id")] public long UserId { get; init; }
    [JsonPropertyName("username")] public string? Username { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("read_at")] public string? ReadAt { get; init; }
    [JsonPropertyName("acknowledged_at")] public string? AcknowledgedAt { get; init; }
    [JsonPropertyName("is_seen")] public bool IsSeen { get; init; }
    [JsonPropertyName("is_acknowledged")] public bool IsAcknowledged { get; init; }
}

/// <summary>Сводка analytics: получатели/просмотры/подтверждения + соцсчётчики.</summary>
public sealed record HubAnnouncementAnalyticsSummary
{
    [JsonPropertyName("recipients_total")] public int RecipientsTotal { get; init; }
    [JsonPropertyName("seen_total")] public int SeenTotal { get; init; }
    [JsonPropertyName("ack_total")] public int AckTotal { get; init; }
    [JsonPropertyName("pending_ack_total")] public int PendingAckTotal { get; init; }
    [JsonPropertyName("reaction_counts")] public Dictionary<string, int>? ReactionCounts { get; init; }
    [JsonPropertyName("comments_total")] public int CommentsTotal { get; init; }
    [JsonPropertyName("poll_total_voters")] public int PollTotalVoters { get; init; }
    [JsonPropertyName("poll_total_votes")] public int PollTotalVotes { get; init; }
}

// ---- Строительство (backend models/construction.py) ----

/// <summary>Участник команды объекта/история ролей (ConstructionTeamMember).</summary>
public sealed record HubConstructionTeamMember
{
    [JsonPropertyName("role_key")] public string? RoleKey { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    [JsonPropertyName("full_name")] public string? FullName { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("department_location")] public string? DepartmentLocation { get; init; }
    [JsonPropertyName("valid_from")] public string? ValidFrom { get; init; }
    [JsonPropertyName("valid_to")] public string? ValidTo { get; init; }
    [JsonPropertyName("group_ref")] public string? GroupRef { get; init; }
}

/// <summary>Номенклатурная группа 1С / направление объекта (ConstructionObjectGroup).</summary>
public sealed record HubConstructionObjectGroup
{
    [JsonPropertyName("group_ref")] public string? GroupRef { get; init; }
    [JsonPropertyName("group_name")] public string? GroupName { get; init; }
    [JsonPropertyName("active_request_count")] public int? ActiveRequestCount { get; init; }
    [JsonPropertyName("overdue_request_count")] public int? OverdueRequestCount { get; init; }
}

/// <summary>Строка «последние заявки» карточки объекта (ConstructionRecentRequest).</summary>
public sealed record HubConstructionRecentRequest
{
    [JsonPropertyName("request_ref")] public string? RequestRef { get; init; }
    [JsonPropertyName("number")] public string? Number { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
    [JsonPropertyName("required_date")] public string? RequiredDate { get; init; }
    [JsonPropertyName("department_name")] public string? DepartmentName { get; init; }
    [JsonPropertyName("responsible_name")] public string? ResponsibleName { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
}

/// <summary>
/// Карточка портфеля из GET /construction/objects (ConstructionObjectSummary):
/// object_ref — group_ref 1С, «managed:{id}» для ведомых или «unassigned»;
/// kind — project|general|unassigned.
/// </summary>
public sealed record HubConstructionObjectSummary
{
    [JsonPropertyName("object_ref")] public string? ObjectRef { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("request_count")] public int RequestCount { get; init; }
    [JsonPropertyName("requests_last_30_days")] public int RequestsLast30Days { get; init; }
    [JsonPropertyName("posted_count")] public int PostedCount { get; init; }
    [JsonPropertyName("latest_request_at")] public string? LatestRequestAt { get; init; }
    [JsonPropertyName("latest_request_number")] public string? LatestRequestNumber { get; init; }
    [JsonPropertyName("department_names")] public IReadOnlyList<string>? DepartmentNames { get; init; }
    [JsonPropertyName("responsible_names")] public IReadOnlyList<string>? ResponsibleNames { get; init; }
    [JsonPropertyName("warehouse_names")] public IReadOnlyList<string>? WarehouseNames { get; init; }
    [JsonPropertyName("recent_requests")] public IReadOnlyList<HubConstructionRecentRequest>? RecentRequests { get; init; }
    [JsonPropertyName("managed")] public bool Managed { get; init; }
    [JsonPropertyName("managed_object_id")] public string? ManagedObjectId { get; init; }
    [JsonPropertyName("source_groups")] public IReadOnlyList<HubConstructionObjectGroup>? SourceGroups { get; init; }
    [JsonPropertyName("team")] public IReadOnlyList<HubConstructionTeamMember>? Team { get; init; }
}

/// <summary>Итоги портфеля (ConstructionPortfolioTotals).</summary>
public sealed record HubConstructionPortfolioTotals
{
    [JsonPropertyName("project_count")] public int ProjectCount { get; init; }
    [JsonPropertyName("request_count")] public int RequestCount { get; init; }
    [JsonPropertyName("requests_last_30_days")] public int RequestsLast30Days { get; init; }
    [JsonPropertyName("general_request_count")] public int GeneralRequestCount { get; init; }
    [JsonPropertyName("unassigned_request_count")] public int UnassignedRequestCount { get; init; }
}

/// <summary>Состояние снапшота (ConstructionCacheState: fresh|cached|stale).</summary>
public sealed record HubConstructionCacheState
{
    [JsonPropertyName("state")] public string? State { get; init; }
    [JsonPropertyName("age_seconds")] public int AgeSeconds { get; init; }
    [JsonPropertyName("last_error")] public string? LastError { get; init; }
}

/// <summary>Ответ GET /construction/objects (ConstructionObjectsResponse).</summary>
public sealed record HubConstructionObjectsResponse
{
    [JsonPropertyName("items")] public IReadOnlyList<HubConstructionObjectSummary>? Items { get; init; }
    [JsonPropertyName("next_cursor")] public string? NextCursor { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("snapshot_changed")] public bool SnapshotChanged { get; init; }
    [JsonPropertyName("as_of")] public string? AsOf { get; init; }
    [JsonPropertyName("window_from")] public string? WindowFrom { get; init; }
    [JsonPropertyName("scanned_requests")] public int ScannedRequests { get; init; }
    [JsonPropertyName("scan_truncated")] public bool ScanTruncated { get; init; }
    [JsonPropertyName("summary")] public HubConstructionPortfolioTotals? Summary { get; init; }
    [JsonPropertyName("cache")] public HubConstructionCacheState? Cache { get; init; }
    [JsonPropertyName("management_available")] public bool ManagementAvailable { get; init; }
}

/// <summary>Карточка объекта из GET /construction/objects/{id} (ConstructionObjectDetail).</summary>
public sealed record HubConstructionObjectDetail
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("managed")] public bool Managed { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    [JsonPropertyName("groups")] public IReadOnlyList<HubConstructionObjectGroup>? Groups { get; init; }
    [JsonPropertyName("team")] public IReadOnlyList<HubConstructionTeamMember>? Team { get; init; }
    [JsonPropertyName("role_history")] public IReadOnlyList<HubConstructionTeamMember>? RoleHistory { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Стадия заявки 1С (_stage(): {key,label,rank}; ключи — REQUEST_STAGES веба).</summary>
public sealed record HubConstructionRequestStage
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("rank")] public int Rank { get; init; }
}

/// <summary>Текущее состояние заявки (_current_state: label/description/document_number/date).</summary>
public sealed record HubConstructionCurrentState
{
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("document_number")] public string? DocumentNumber { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
}

/// <summary>Позиция номенклатуры в сводке заявки (nomenclature_items/preview).</summary>
public sealed record HubConstructionNomenclatureItem
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("quantity")] public double Quantity { get; init; }
    [JsonPropertyName("unit")] public string? Unit { get; init; }
    [JsonPropertyName("section_code")] public string? SectionCode { get; init; }
}

/// <summary>
/// Строка items[] ответа заявок объекта: backend отдаёт list[dict] (сводка
/// _build_request_summary), моделируем известные поля — остальное игнорируется.
/// </summary>
public sealed record HubConstructionRequestItem
{
    [JsonPropertyName("request_ref")] public string? RequestRef { get; init; }
    [JsonPropertyName("request_number")] public string? RequestNumber { get; init; }
    [JsonPropertyName("system_number")] public string? SystemNumber { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
    [JsonPropertyName("required_date")] public string? RequiredDate { get; init; }
    [JsonPropertyName("department_name")] public string? DepartmentName { get; init; }
    [JsonPropertyName("responsible_name")] public string? ResponsibleName { get; init; }
    [JsonPropertyName("initiator_name")] public string? InitiatorName { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
    [JsonPropertyName("group_ref")] public string? GroupRef { get; init; }
    [JsonPropertyName("group_name")] public string? GroupName { get; init; }
    [JsonPropertyName("stage")] public HubConstructionRequestStage? Stage { get; init; }
    [JsonPropertyName("current_state")] public HubConstructionCurrentState? CurrentState { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    [JsonPropertyName("status_group")] public string? StatusGroup { get; init; }
    [JsonPropertyName("overdue")] public bool Overdue { get; init; }
    [JsonPropertyName("attention_required")] public bool AttentionRequired { get; init; }
    [JsonPropertyName("positions_total")] public int PositionsTotal { get; init; }
    [JsonPropertyName("progress_label")] public string? ProgressLabel { get; init; }
    [JsonPropertyName("nomenclature_items")] public IReadOnlyList<HubConstructionNomenclatureItem>? NomenclatureItems { get; init; }
    [JsonPropertyName("section_codes")] public IReadOnlyList<string>? SectionCodes { get; init; }
    [JsonPropertyName("manager_names")] public IReadOnlyList<string>? ManagerNames { get; init; }
    [JsonPropertyName("supplier_names")] public IReadOnlyList<string>? SupplierNames { get; init; }
}

/// <summary>Счётчики по направлению (ConstructionDirectionStat).</summary>
public sealed record HubConstructionDirectionStat
{
    [JsonPropertyName("group_ref")] public string? GroupRef { get; init; }
    [JsonPropertyName("group_name")] public string? GroupName { get; init; }
    [JsonPropertyName("active")] public int? Active { get; init; }
    [JsonPropertyName("overdue")] public int? Overdue { get; init; }
}

/// <summary>Итоги по заявкам объекта (ConstructionObjectRequestTotals).</summary>
public sealed record HubConstructionRequestTotals
{
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("active")] public int Active { get; init; }
    [JsonPropertyName("history")] public int History { get; init; }
    [JsonPropertyName("overdue")] public int Overdue { get; init; }
}

/// <summary>Ответ GET /construction/objects/{id}/requests (ConstructionObjectRequestsResponse).</summary>
public sealed record HubConstructionObjectRequestsResponse
{
    [JsonPropertyName("items")] public IReadOnlyList<HubConstructionRequestItem>? Items { get; init; }
    [JsonPropertyName("next_cursor")] public string? NextCursor { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("snapshot_changed")] public bool SnapshotChanged { get; init; }
    [JsonPropertyName("as_of")] public string? AsOf { get; init; }
    [JsonPropertyName("window_from")] public string? WindowFrom { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("source_groups")] public IReadOnlyList<HubConstructionObjectGroup>? SourceGroups { get; init; }
    [JsonPropertyName("direction_stats")] public IReadOnlyList<HubConstructionDirectionStat>? DirectionStats { get; init; }
    [JsonPropertyName("summary")] public HubConstructionRequestTotals? Summary { get; init; }
}

/// <summary>Параметры GET /construction/objects (q/kind/limit/cursor/refresh).</summary>
public sealed record HubConstructionObjectsQuery
{
    public string? Search { get; init; }
    public string Kind { get; init; } = "all";
    public int Limit { get; init; } = 24;
    public string? Cursor { get; init; }
    public bool Refresh { get; init; }
}

/// <summary>Параметры GET /construction/objects/{id}/requests (view/q/limit/cursor/refresh).</summary>
public sealed record HubConstructionRequestsQuery
{
    public string View { get; init; } = "active";
    public string? Search { get; init; }
    public int Limit { get; init; } = 25;
    public string? Cursor { get; init; }
    public bool Refresh { get; init; }
}

// ---- Склад 1С (api/v1/warehouse_1c.py, services/warehouse_1c_service.py) ----

/// <summary>
/// Элемент справочника 1С (номенклатура/склад из search-роутов) и фасет склада
/// it-requests ({ref, name, count, overdue_count}) — форма одинаковая.
/// </summary>
public sealed record HubWarehouse1cCatalogItem
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("code")] public string? Code { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("overdue_count")] public int OverdueCount { get; init; }
}

/// <summary>
/// Плоские meta-поля конверта списков warehouse-1c (балансы/движения/уволенные):
/// backend кладёт их рядом с items, не вложенным объектом.
/// </summary>
public abstract record HubWarehouse1cListEnvelope
{
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("returned")] public int Returned { get; init; }
    [JsonPropertyName("total")] public int? Total { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("as_of")] public string? AsOf { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
    [JsonPropertyName("incomplete_reason")] public string? IncompleteReason { get; init; }
    [JsonPropertyName("next_cursor")] public string? NextCursor { get; init; }
}

/// <summary>Строка остатков GET /warehouse-1c/balances (_row_to_balance).</summary>
public sealed record HubWarehouse1cBalance
{
    [JsonPropertyName("nomenclature_ref")] public string? NomenclatureRef { get; init; }
    [JsonPropertyName("nomenclature_code")] public string? NomenclatureCode { get; init; }
    [JsonPropertyName("nomenclature_name")] public string? NomenclatureName { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("series_ref")] public string? SeriesRef { get; init; }
    [JsonPropertyName("series_name")] public string? SeriesName { get; init; }
    [JsonPropertyName("series_number")] public string? SeriesNumber { get; init; }
    [JsonPropertyName("warehouse_ref")] public string? WarehouseRef { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
    [JsonPropertyName("batch_document_name")] public string? BatchDocumentName { get; init; }
    [JsonPropertyName("batch_status_name")] public string? BatchStatusName { get; init; }
    [JsonPropertyName("cost_method_name")] public string? CostMethodName { get; init; }
    [JsonPropertyName("qty_balance")] public double QtyBalance { get; init; }
    [JsonPropertyName("cost_balance")] public double CostBalance { get; init; }
    [JsonPropertyName("cost_accounting_balance")] public double CostAccountingBalance { get; init; }
    [JsonPropertyName("avg_price")] public double AvgPrice { get; init; }
    [JsonPropertyName("torg12_number")] public string? Torg12Number { get; init; }
    [JsonPropertyName("torg12_date")] public string? Torg12Date { get; init; }
    [JsonPropertyName("invoice_number")] public string? InvoiceNumber { get; init; }
    [JsonPropertyName("invoice_date")] public string? InvoiceDate { get; init; }
}

/// <summary>Агрегаты выборки остатков (include_meta=true).</summary>
public sealed record HubWarehouse1cBalancesAggregates
{
    [JsonPropertyName("qty")] public double Qty { get; init; }
    [JsonPropertyName("cost")] public double Cost { get; init; }
    [JsonPropertyName("cost_accounting")] public double CostAccounting { get; init; }
}

/// <summary>Ответ GET /warehouse-1c/balances?include_meta=true.</summary>
public sealed record HubWarehouse1cBalancesResponse : HubWarehouse1cListEnvelope
{
    [JsonPropertyName("items")] public IReadOnlyList<HubWarehouse1cBalance>? Items { get; init; }
    [JsonPropertyName("aggregates")] public HubWarehouse1cBalancesAggregates? Aggregates { get; init; }
}

/// <summary>Строка ведомости движений GET /warehouse-1c/movements.</summary>
public sealed record HubWarehouse1cMovement
{
    [JsonPropertyName("registrar_ref")] public string? RegistrarRef { get; init; }
    [JsonPropertyName("registrar_name")] public string? RegistrarName { get; init; }
    [JsonPropertyName("registrar_number")] public string? RegistrarNumber { get; init; }
    [JsonPropertyName("registrar_date")] public string? RegistrarDate { get; init; }
    [JsonPropertyName("registrar_document_type")] public string? RegistrarDocumentType { get; init; }
    [JsonPropertyName("is_transfer")] public bool IsTransfer { get; init; }
    [JsonPropertyName("can_open_detail")] public bool CanOpenDetail { get; init; }
    [JsonPropertyName("period")] public string? Period { get; init; }
    [JsonPropertyName("nomenclature_ref")] public string? NomenclatureRef { get; init; }
    [JsonPropertyName("nomenclature_code")] public string? NomenclatureCode { get; init; }
    [JsonPropertyName("nomenclature_name")] public string? NomenclatureName { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("series_ref")] public string? SeriesRef { get; init; }
    [JsonPropertyName("series_name")] public string? SeriesName { get; init; }
    [JsonPropertyName("warehouse_ref")] public string? WarehouseRef { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
    [JsonPropertyName("transfer_from_warehouse_ref")] public string? TransferFromWarehouseRef { get; init; }
    [JsonPropertyName("transfer_from_warehouse_name")] public string? TransferFromWarehouseName { get; init; }
    [JsonPropertyName("transfer_to_warehouse_ref")] public string? TransferToWarehouseRef { get; init; }
    [JsonPropertyName("transfer_to_warehouse_name")] public string? TransferToWarehouseName { get; init; }
    [JsonPropertyName("batch_document_name")] public string? BatchDocumentName { get; init; }
    [JsonPropertyName("qty_start")] public double QtyStart { get; init; }
    [JsonPropertyName("qty_end")] public double QtyEnd { get; init; }
    [JsonPropertyName("qty_in")] public double QtyIn { get; init; }
    [JsonPropertyName("qty_out")] public double QtyOut { get; init; }
    [JsonPropertyName("cost_start")] public double CostStart { get; init; }
    [JsonPropertyName("cost_end")] public double CostEnd { get; init; }
    [JsonPropertyName("cost_in")] public double CostIn { get; init; }
    [JsonPropertyName("cost_out")] public double CostOut { get; init; }
    [JsonPropertyName("cost_accounting_start")] public double CostAccountingStart { get; init; }
    [JsonPropertyName("cost_accounting_end")] public double CostAccountingEnd { get; init; }
    [JsonPropertyName("cost_accounting_in")] public double CostAccountingIn { get; init; }
    [JsonPropertyName("cost_accounting_out")] public double CostAccountingOut { get; init; }
    [JsonPropertyName("avg_price_start")] public double AvgPriceStart { get; init; }
    [JsonPropertyName("avg_price_end")] public double AvgPriceEnd { get; init; }
    [JsonPropertyName("torg12_number")] public string? Torg12Number { get; init; }
    [JsonPropertyName("torg12_date")] public string? Torg12Date { get; init; }
    [JsonPropertyName("invoice_number")] public string? InvoiceNumber { get; init; }
    [JsonPropertyName("invoice_date")] public string? InvoiceDate { get; init; }
}

/// <summary>Ответ GET /warehouse-1c/movements?include_meta=true (cursor-пагинация).</summary>
public sealed record HubWarehouse1cMovementsResponse : HubWarehouse1cListEnvelope
{
    [JsonPropertyName("items")] public IReadOnlyList<HubWarehouse1cMovement>? Items { get; init; }
}

/// <summary>Приложенный файл документа 1С (movements/detail, files[]).</summary>
public sealed record HubWarehouse1cMovementFile
{
    [JsonPropertyName("ref")] public string? Ref { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("size")] public long Size { get; init; }
    [JsonPropertyName("content_type")] public string? ContentType { get; init; }
}

/// <summary>Ответ GET /warehouse-1c/movements/detail (карточка документа-регистратора).</summary>
public sealed record HubWarehouse1cMovementDetail
{
    [JsonPropertyName("registrar_ref")] public string? RegistrarRef { get; init; }
    [JsonPropertyName("registrar_name")] public string? RegistrarName { get; init; }
    [JsonPropertyName("registrar_number")] public string? RegistrarNumber { get; init; }
    [JsonPropertyName("registrar_date")] public string? RegistrarDate { get; init; }
    [JsonPropertyName("document_type")] public string? DocumentType { get; init; }
    [JsonPropertyName("document_title")] public string? DocumentTitle { get; init; }
    [JsonPropertyName("is_transfer")] public bool IsTransfer { get; init; }
    [JsonPropertyName("warehouse_ref")] public string? WarehouseRef { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
    [JsonPropertyName("counterparty_name")] public string? CounterpartyName { get; init; }
    [JsonPropertyName("transfer_from_warehouse_ref")] public string? TransferFromWarehouseRef { get; init; }
    [JsonPropertyName("transfer_from_warehouse_name")] public string? TransferFromWarehouseName { get; init; }
    [JsonPropertyName("transfer_to_warehouse_ref")] public string? TransferToWarehouseRef { get; init; }
    [JsonPropertyName("transfer_to_warehouse_name")] public string? TransferToWarehouseName { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("files_status")] public string? FilesStatus { get; init; }
    [JsonPropertyName("files_message")] public string? FilesMessage { get; init; }
    [JsonPropertyName("files")] public IReadOnlyList<HubWarehouse1cMovementFile>? Files { get; init; }
}

/// <summary>Кандидат-владелец склада (dismissed-warehouses, employee_candidates[]).</summary>
public sealed record HubWarehouse1cDismissedCandidate
{
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    [JsonPropertyName("city")] public string? City { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("dismissal_date")] public string? DismissalDate { get; init; }
}

/// <summary>Суммы остатков склада уволенного (dismissed-warehouses, totals).</summary>
public sealed record HubWarehouse1cDismissedTotals
{
    [JsonPropertyName("qty")] public double Qty { get; init; }
    [JsonPropertyName("cost")] public double Cost { get; init; }
    [JsonPropertyName("cost_accounting")] public double CostAccounting { get; init; }
    [JsonPropertyName("positions")] public int Positions { get; init; }
}

/// <summary>Строка GET /warehouse-1c/dismissed-warehouses: склад + владелец + остатки.</summary>
public sealed record HubWarehouse1cDismissedWarehouse
{
    [JsonPropertyName("warehouse")] public HubWarehouse1cCatalogItem? Warehouse { get; init; }
    [JsonPropertyName("employee_name")] public string? EmployeeName { get; init; }
    [JsonPropertyName("employee_code")] public string? EmployeeCode { get; init; }
    [JsonPropertyName("city")] public string? City { get; init; }
    [JsonPropertyName("department")] public string? Department { get; init; }
    [JsonPropertyName("position")] public string? Position { get; init; }
    [JsonPropertyName("dismissal_date")] public string? DismissalDate { get; init; }
    [JsonPropertyName("owner_nos")] public IReadOnlyList<string>? OwnerNos { get; init; }
    [JsonPropertyName("employment_status")] public string? EmploymentStatus { get; init; }
    [JsonPropertyName("employment_label")] public string? EmploymentLabel { get; init; }
    [JsonPropertyName("match_score")] public int MatchScore { get; init; }
    [JsonPropertyName("ambiguous")] public bool Ambiguous { get; init; }
    [JsonPropertyName("employee_candidates")] public IReadOnlyList<HubWarehouse1cDismissedCandidate>? EmployeeCandidates { get; init; }
    [JsonPropertyName("totals")] public HubWarehouse1cDismissedTotals? Totals { get; init; }
    [JsonPropertyName("balances")] public IReadOnlyList<HubWarehouse1cBalance>? Balances { get; init; }
}

/// <summary>Ответ GET /warehouse-1c/dismissed-warehouses?include_meta=true.</summary>
public sealed record HubWarehouse1cDismissedResponse : HubWarehouse1cListEnvelope
{
    [JsonPropertyName("items")] public IReadOnlyList<HubWarehouse1cDismissedWarehouse>? Items { get; init; }
}

/// <summary>Статус кэша справочников 1С (GET /warehouse-1c/catalog/status).</summary>
public sealed record HubWarehouse1cCatalogStatus
{
    [JsonPropertyName("nomenclature_count")] public int NomenclatureCount { get; init; }
    [JsonPropertyName("warehouses_count")] public int WarehousesCount { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
    [JsonPropertyName("sync_in_progress")] public bool SyncInProgress { get; init; }
    [JsonPropertyName("last_error")] public string? LastError { get; init; }
    [JsonPropertyName("warehouses_truncated")] public bool WarehousesTruncated { get; init; }
}

// ---- Заявки на МПЗ (warehouse_1c_it_requests.py; право warehouse_1c.it_requests.read) ----

/// <summary>Стадия заявки на МПЗ ({key,label,rank}).</summary>
public sealed record HubItRequestStage
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("rank")] public int Rank { get; init; }
}

/// <summary>Резюме текущего состояния заявки (current_state).</summary>
public sealed record HubItRequestCurrentState
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("document_number")] public string? DocumentNumber { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
}

/// <summary>Событие документооборота заявки (timeline[]).</summary>
public sealed record HubItRequestTimelineEvent
{
    [JsonPropertyName("type")] public string? Type { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("document_ref")] public string? DocumentRef { get; init; }
    [JsonPropertyName("document_number")] public string? DocumentNumber { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
    [JsonPropertyName("quantity")] public double Quantity { get; init; }
    [JsonPropertyName("amount")] public double? Amount { get; init; }
    [JsonPropertyName("manager_name")] public string? ManagerName { get; init; }
    [JsonPropertyName("supplier_name")] public string? SupplierName { get; init; }
    [JsonPropertyName("source_name")] public string? SourceName { get; init; }
    [JsonPropertyName("destination_name")] public string? DestinationName { get; init; }
    [JsonPropertyName("nomenclature_names")] public IReadOnlyList<string>? NomenclatureNames { get; init; }
}

/// <summary>Шаг маршрута заявки (journey[]): Заявка → Закупщик → Заказ → Резерв → Поставлено.</summary>
public sealed record HubItRequestJourneyStep
{
    [JsonPropertyName("key")] public string? Key { get; init; }
    [JsonPropertyName("label")] public string? Label { get; init; }
    [JsonPropertyName("reached")] public bool Reached { get; init; }
    [JsonPropertyName("current")] public bool Current { get; init; }
    [JsonPropertyName("missing")] public bool Missing { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
    [JsonPropertyName("document_number")] public string? DocumentNumber { get; init; }
    [JsonPropertyName("documents")] public IReadOnlyList<HubItRequestTimelineEvent>? Documents { get; init; }
}

/// <summary>Превью номенклатуры в карточке списка (nomenclature_items[]).</summary>
public sealed record HubItRequestNomenclaturePreview
{
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("quantity")] public double Quantity { get; init; }
    [JsonPropertyName("unit")] public string? Unit { get; init; }
}

/// <summary>Сгруппированная позиция заявки (item_groups[] в detail).</summary>
public sealed record HubItRequestItemGroup
{
    [JsonPropertyName("nomenclature_ref")] public string? NomenclatureRef { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("unit")] public string? Unit { get; init; }
    [JsonPropertyName("section_code")] public string? SectionCode { get; init; }
    [JsonPropertyName("quantity")] public double Quantity { get; init; }
    [JsonPropertyName("qty_requested")] public double QtyRequested { get; init; }
    [JsonPropertyName("qty_ordered")] public double? QtyOrdered { get; init; }
    [JsonPropertyName("qty_received")] public double? QtyReceived { get; init; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; init; }
    [JsonPropertyName("cancellation_reasons")] public IReadOnlyList<string>? CancellationReasons { get; init; }
    [JsonPropertyName("source_line_count")] public int SourceLineCount { get; init; }
}

/// <summary>Строка табличной части заявки (positions[] в detail).</summary>
public sealed record HubItRequestPosition
{
    [JsonPropertyName("line_number")] public int LineNumber { get; init; }
    [JsonPropertyName("line_key")] public string? LineKey { get; init; }
    [JsonPropertyName("nomenclature_ref")] public string? NomenclatureRef { get; init; }
    [JsonPropertyName("nomenclature_name")] public string? NomenclatureName { get; init; }
    [JsonPropertyName("characteristic_name")] public string? CharacteristicName { get; init; }
    [JsonPropertyName("unit_name")] public string? UnitName { get; init; }
    [JsonPropertyName("quantity")] public double Quantity { get; init; }
    [JsonPropertyName("required_date")] public string? RequiredDate { get; init; }
    [JsonPropertyName("cancelled")] public bool Cancelled { get; init; }
    [JsonPropertyName("cancellation_reason")] public string? CancellationReason { get; init; }
    [JsonPropertyName("supplier_name")] public string? SupplierName { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("section_code")] public string? SectionCode { get; init; }
    [JsonPropertyName("replacement_name")] public string? ReplacementName { get; init; }
    [JsonPropertyName("replacement_unit")] public string? ReplacementUnit { get; init; }
}

/// <summary>
/// Заявка на МПЗ: сводка (элемент items) и деталь (it-requests/{ref}) — один контракт,
/// в сводке timeline/item_groups/positions отсутствуют.
/// </summary>
public sealed record HubItRequestItem
{
    [JsonPropertyName("request_ref")] public string? RequestRef { get; init; }
    [JsonPropertyName("request_number")] public string? RequestNumber { get; init; }
    [JsonPropertyName("system_number")] public string? SystemNumber { get; init; }
    [JsonPropertyName("date")] public string? Date { get; init; }
    [JsonPropertyName("incoming_date")] public string? IncomingDate { get; init; }
    [JsonPropertyName("required_date")] public string? RequiredDate { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("factual_delivery_date")] public string? FactualDeliveryDate { get; init; }
    [JsonPropertyName("posted")] public bool Posted { get; init; }
    [JsonPropertyName("organization_name")] public string? OrganizationName { get; init; }
    [JsonPropertyName("department_name")] public string? DepartmentName { get; init; }
    [JsonPropertyName("initiator_name")] public string? InitiatorName { get; init; }
    [JsonPropertyName("responsible_name")] public string? ResponsibleName { get; init; }
    [JsonPropertyName("warehouse_ref")] public string? WarehouseRef { get; init; }
    [JsonPropertyName("warehouse_name")] public string? WarehouseName { get; init; }
    [JsonPropertyName("supplier_ref")] public string? SupplierRef { get; init; }
    [JsonPropertyName("supplier_name")] public string? SupplierName { get; init; }
    [JsonPropertyName("group_ref")] public string? GroupRef { get; init; }
    [JsonPropertyName("group_name")] public string? GroupName { get; init; }
    [JsonPropertyName("comment")] public string? Comment { get; init; }
    [JsonPropertyName("stage")] public HubItRequestStage? Stage { get; init; }
    [JsonPropertyName("current_state")] public HubItRequestCurrentState? CurrentState { get; init; }
    [JsonPropertyName("is_active")] public bool IsActive { get; init; }
    [JsonPropertyName("status_group")] public string? StatusGroup { get; init; }
    [JsonPropertyName("overdue")] public bool Overdue { get; init; }
    [JsonPropertyName("attention_required")] public bool AttentionRequired { get; init; }
    [JsonPropertyName("positions_total")] public int PositionsTotal { get; init; }
    [JsonPropertyName("progress_label")] public string? ProgressLabel { get; init; }
    [JsonPropertyName("nomenclature_items")] public IReadOnlyList<HubItRequestNomenclaturePreview>? NomenclatureItems { get; init; }
    [JsonPropertyName("manager_names")] public IReadOnlyList<string>? ManagerNames { get; init; }
    [JsonPropertyName("supplier_names")] public IReadOnlyList<string>? SupplierNames { get; init; }
    [JsonPropertyName("journey")] public IReadOnlyList<HubItRequestJourneyStep>? Journey { get; init; }
    [JsonPropertyName("timeline")] public IReadOnlyList<HubItRequestTimelineEvent>? Timeline { get; init; }
    [JsonPropertyName("item_groups")] public IReadOnlyList<HubItRequestItemGroup>? ItemGroups { get; init; }
    [JsonPropertyName("positions")] public IReadOnlyList<HubItRequestPosition>? Positions { get; init; }
}

/// <summary>Ответ GET /warehouse-1c/it-requests (snapshot cursor-пагинация).</summary>
public sealed record HubItRequestsResponse
{
    [JsonPropertyName("items")] public IReadOnlyList<HubItRequestItem>? Items { get; init; }
    [JsonPropertyName("warehouse_facets")] public IReadOnlyList<HubWarehouse1cCatalogItem>? WarehouseFacets { get; init; }
    [JsonPropertyName("next_cursor")] public string? NextCursor { get; init; }
    [JsonPropertyName("has_more")] public bool HasMore { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("as_of")] public string? AsOf { get; init; }
    [JsonPropertyName("snapshot_id")] public string? SnapshotId { get; init; }
    [JsonPropertyName("snapshot_changed")] public bool SnapshotChanged { get; init; }
    [JsonPropertyName("truncated")] public bool Truncated { get; init; }
    [JsonPropertyName("stale")] public bool Stale { get; init; }
}

/// <summary>Параметры GET /warehouse-1c/balances (nomenclature_ref/warehouse_ref/q/limit).</summary>
public sealed record HubWarehouse1cBalancesQuery
{
    public string? NomenclatureRef { get; init; }
    public string? WarehouseRef { get; init; }
    public string? Text { get; init; }
    public int Limit { get; init; } = 200;
}

/// <summary>Параметры GET /warehouse-1c/movements (nomenclature_ref обязателен).</summary>
public sealed record HubWarehouse1cMovementsQuery
{
    public string? NomenclatureRef { get; init; }
    public string? WarehouseRef { get; init; }
    public string? SeriesRef { get; init; }
    public string? DateFrom { get; init; }
    public string? DateTo { get; init; }
    public int Limit { get; init; } = 500;
    public string? Cursor { get; init; }
}

/// <summary>Параметры GET /warehouse-1c/it-requests (view/q/stage/warehouse_ref/limit/cursor).</summary>
public sealed record HubItRequestsQuery
{
    public string View { get; init; } = "active";
    public string? Search { get; init; }
    public string? Stage { get; init; }
    public string? WarehouseRef { get; init; }
    public bool? Overdue { get; init; }
    public int Limit { get; init; } = 25;
    public string? Cursor { get; init; }
    public bool Refresh { get; init; }
}

/// <summary>POST /desktop-presence/heartbeat и DELETE /current: {active, expires_in_seconds}.</summary>
public sealed record HubDesktopPresence
{
    [JsonPropertyName("active")] public bool Active { get; init; }
    [JsonPropertyName("expires_in_seconds")] public int ExpiresInSeconds { get; init; }
}

/// <summary>
/// GET /chat/config → {group_max_members, scheduled_messages_enabled, support_user_id}:
/// серверные флаги чата. scheduled_messages_enabled — серверный выключатель
/// «Отправить позже» (CHAT_SCHEDULED_MESSAGES_ENABLED, по умолчанию выкл.).
/// </summary>
public sealed record HubChatConfig
{
    [JsonPropertyName("group_max_members")] public int GroupMaxMembers { get; init; }
    [JsonPropertyName("scheduled_messages_enabled")] public bool ScheduledMessagesEnabled { get; init; }
    [JsonPropertyName("support_user_id")] public int? SupportUserId { get; init; }
}

/// <summary>
/// Отложенное сообщение «Отправить позже» — элемент GET …/conversations/{id}/scheduled
/// и ответ POST/PATCH. status: scheduled|sending|sent|cancelled|failed;
/// в выдаче только scheduled|sending|failed.
/// </summary>
public sealed record HubChatScheduledMessage
{
    [JsonPropertyName("id")] public string Id { get; init; } = string.Empty;
    [JsonPropertyName("conversation_id")] public string? ConversationId { get; init; }
    [JsonPropertyName("body")] public string? Body { get; init; }
    [JsonPropertyName("body_format")] public string? BodyFormat { get; init; }
    [JsonPropertyName("reply_to_message_id")] public string? ReplyToMessageId { get; init; }
    [JsonPropertyName("scheduled_for")] public DateTimeOffset? ScheduledFor { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("attempt_count")] public int AttemptCount { get; init; }
    [JsonPropertyName("sent_message_id")] public string? SentMessageId { get; init; }
    [JsonPropertyName("error_text")] public string? ErrorText { get; init; }
    [JsonPropertyName("created_at")] public DateTimeOffset? CreatedAt { get; init; }
}

/// <summary>GET /chat/conversations/{id}/scheduled → {items}.</summary>
public sealed record HubChatScheduledMessageList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubChatScheduledMessage>? Items { get; init; }
}

/// <summary>DELETE /chat/scheduled/{id} → {id, status: "cancelled"}.</summary>
public sealed record HubChatScheduledCancelResult
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
}

// ==================== DLP-мониторинг (fs_egress.py /inventory/dlp/*) ====================

/// <summary>GET /inventory/dlp/hosts → {success, hosts[]} — статистика по ПК.</summary>
public sealed record HubDlpHostsResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("hosts")] public IReadOnlyList<HubDlpHost>? Hosts { get; init; }
}

/// <summary>
/// Строка /dlp/hosts: счётчики file-egress + браузерных визитов за окно,
/// обогащённые логином/ФИО/филиалом из инвентаря.
/// </summary>
public sealed record HubDlpHost
{
    [JsonPropertyName("computer_name")] public string? ComputerName { get; init; }
    [JsonPropertyName("windows_user")] public string? WindowsUser { get; init; }
    [JsonPropertyName("user_login")] public string? UserLogin { get; init; }
    [JsonPropertyName("login")] public string? Login { get; init; }
    [JsonPropertyName("user_full_name")] public string? UserFullName { get; init; }
    [JsonPropertyName("ip_primary")] public string? IpPrimary { get; init; }
    /// <summary>Номер филиала из SQL-контекста (может быть числом или строкой).</summary>
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("file_events")] public int FileEvents { get; init; }
    [JsonPropertyName("service_files")] public int ServiceFiles { get; init; }
    [JsonPropertyName("usb_events")] public int UsbEvents { get; init; }
    [JsonPropertyName("telegram_events")] public int TelegramEvents { get; init; }
    [JsonPropertyName("max_events")] public int MaxEvents { get; init; }
    [JsonPropertyName("browser_events")] public int BrowserEvents { get; init; }
    [JsonPropertyName("telegram_sent")] public int TelegramSent { get; init; }
    [JsonPropertyName("max_sent")] public int MaxSent { get; init; }
    [JsonPropertyName("deleted_events")] public int DeletedEvents { get; init; }
    [JsonPropertyName("visits")] public int Visits { get; init; }
    [JsonPropertyName("visits_window_days")] public int VisitsWindowDays { get; init; }
    [JsonPropertyName("last_ts")] public long LastTs { get; init; }
    [JsonPropertyName("last_visited_at")] public string? LastVisitedAt { get; init; }
}

/// <summary>GET /inventory/dlp/summary → {success, summary} — счётчики дня в шапке.</summary>
public sealed record HubDlpSummaryResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("summary")] public HubDlpSummary? Summary { get; init; }
}

public sealed record HubDlpSummary
{
    [JsonPropertyName("hosts_total")] public int HostsTotal { get; init; }
    [JsonPropertyName("hosts_active_today")] public int HostsActiveToday { get; init; }
    [JsonPropertyName("visits_today")] public int VisitsToday { get; init; }
    [JsonPropertyName("file_events_today")] public int FileEventsToday { get; init; }
    [JsonPropertyName("categories_today")] public Dictionary<string, int>? CategoriesToday { get; init; }
}

/// <summary>GET /inventory/dlp/attention?day= → {success, hosts[]} — сводка за день.</summary>
public sealed record HubDlpAttentionResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("hosts")] public IReadOnlyList<HubDlpAttentionHost>? Hosts { get; init; }
}

/// <summary>
/// Строка /dlp/attention: активность + фокус браузера + usb/мессенджеры за день.
/// Секунды уже переклассифицированы графиком филиала (break/offshift на сервере).
/// </summary>
public sealed record HubDlpAttentionHost
{
    [JsonPropertyName("computer_name")] public string? ComputerName { get; init; }
    [JsonPropertyName("windows_user")] public string? WindowsUser { get; init; }
    [JsonPropertyName("user_login")] public string? UserLogin { get; init; }
    [JsonPropertyName("user_full_name")] public string? UserFullName { get; init; }
    [JsonPropertyName("branch_no")] public JsonElement? BranchNo { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("active_sec")] public double ActiveSec { get; init; }
    [JsonPropertyName("passive_sec")] public double PassiveSec { get; init; }
    [JsonPropertyName("away_sec")] public double AwaySec { get; init; }
    [JsonPropertyName("locked_sec")] public double LockedSec { get; init; }
    [JsonPropertyName("break_sec")] public double BreakSec { get; init; }
    [JsonPropertyName("offshift_sec")] public double OffshiftSec { get; init; }
    [JsonPropertyName("work_sec")] public double WorkSec { get; init; }
    [JsonPropertyName("entertainment_sec")] public double EntertainmentSec { get; init; }
    [JsonPropertyName("browser_idle_sec")] public double BrowserIdleSec { get; init; }
    [JsonPropertyName("usb_files")] public int UsbFiles { get; init; }
    [JsonPropertyName("usb_bytes")] public long UsbBytes { get; init; }
    [JsonPropertyName("messenger_files")] public int MessengerFiles { get; init; }
    [JsonPropertyName("first_ts")] public long? FirstTs { get; init; }
    [JsonPropertyName("last_ts")] public long? LastTs { get; init; }
}

/// <summary>
/// GET /inventory/dlp/activity?computer_name=&day= → {success, buckets, summary, apps_top, local_time}.
/// Бакеты — 5-минутные, время локальное для филиала (не сдвигается клиентом).
/// </summary>
public sealed record HubDlpActivityResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("buckets")] public IReadOnlyList<HubDlpActivityBucket>? Buckets { get; init; }
    [JsonPropertyName("summary")] public HubDlpActivitySummary? Summary { get; init; }
    [JsonPropertyName("apps_top")] public IReadOnlyList<HubDlpAppTop>? AppsTop { get; init; }
    [JsonPropertyName("local_time")] public HubDlpLocalTime? LocalTime { get; init; }
}

public sealed record HubDlpActivityBucket
{
    [JsonPropertyName("bucket_start")] public string? BucketStart { get; init; }
    [JsonPropertyName("active_sec")] public double ActiveSec { get; init; }
    [JsonPropertyName("passive_sec")] public double PassiveSec { get; init; }
    [JsonPropertyName("away_sec")] public double AwaySec { get; init; }
    [JsonPropertyName("locked_sec")] public double LockedSec { get; init; }
    [JsonPropertyName("break_sec")] public double BreakSec { get; init; }
    [JsonPropertyName("offshift_sec")] public double OffshiftSec { get; init; }
    /// <summary>Зона графика: work | lunch | off (без графика всегда work).</summary>
    [JsonPropertyName("zone")] public string? Zone { get; init; }
    /// <summary>Доминирующее приложение бакета (null без активности).</summary>
    [JsonPropertyName("app")] public string? App { get; init; }
}

public sealed record HubDlpActivitySummary
{
    [JsonPropertyName("first_ts")] public long? FirstTs { get; init; }
    [JsonPropertyName("last_ts")] public long? LastTs { get; init; }
    [JsonPropertyName("active_sec")] public double ActiveSec { get; init; }
    [JsonPropertyName("passive_sec")] public double PassiveSec { get; init; }
    [JsonPropertyName("away_sec")] public double AwaySec { get; init; }
    [JsonPropertyName("locked_sec")] public double LockedSec { get; init; }
    [JsonPropertyName("break_sec")] public double BreakSec { get; init; }
    [JsonPropertyName("offshift_sec")] public double OffshiftSec { get; init; }
    /// <summary>Ввод за пределами смены — показывается как «Ввод вне смены».</summary>
    [JsonPropertyName("active_offshift_sec")] public double ActiveOffshiftSec { get; init; }
    [JsonPropertyName("activity_pct")] public double? ActivityPct { get; init; }
}

public sealed record HubDlpAppTop
{
    [JsonPropertyName("app")] public string? App { get; init; }
    [JsonPropertyName("sec")] public double Sec { get; init; }
}

public sealed record HubDlpLocalTime
{
    [JsonPropertyName("day")] public string? Day { get; init; }
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("utc_offset_minutes")] public int UtcOffsetMinutes { get; init; }
    [JsonPropertyName("work_start_min")] public int? WorkStartMin { get; init; }
    [JsonPropertyName("work_end_min")] public int? WorkEndMin { get; init; }
    [JsonPropertyName("lunch_start_min")] public int? LunchStartMin { get; init; }
    [JsonPropertyName("lunch_end_min")] public int? LunchEndMin { get; init; }
    [JsonPropertyName("workdays_mask")] public int? WorkdaysMask { get; init; }
}

/// <summary>GET /inventory/dlp/work-schedules → {success, items, branches}.</summary>
public sealed record HubDlpWorkSchedulesResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubDlpWorkSchedule>? Items { get; init; }
    [JsonPropertyName("branches")] public IReadOnlyList<string>? Branches { get; init; }
}

/// <summary>График работы филиала (serialize_schedule; интервалы — минуты от полуночи).</summary>
public sealed record HubDlpWorkSchedule
{
    [JsonPropertyName("branch_name")] public string? BranchName { get; init; }
    [JsonPropertyName("work_start_min")] public int WorkStartMin { get; init; }
    [JsonPropertyName("work_end_min")] public int WorkEndMin { get; init; }
    [JsonPropertyName("lunch_start_min")] public int? LunchStartMin { get; init; }
    [JsonPropertyName("lunch_end_min")] public int? LunchEndMin { get; init; }
    [JsonPropertyName("tz_offset_minutes")] public int TzOffsetMinutes { get; init; }
    [JsonPropertyName("workdays_mask")] public int WorkdaysMask { get; init; }
    [JsonPropertyName("updated_by")] public string? UpdatedBy { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>PUT /inventory/dlp/work-schedules/{branch} → {success, schedule}.</summary>
public sealed record HubDlpWorkScheduleSaveResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("schedule")] public HubDlpWorkSchedule? Schedule { get; init; }
}

/// <summary>
/// GET /inventory/fs-egress?computer_name=&channel=&group=1 → {success, items, total, noise_hidden}.
/// События файлового канала (usb/telegram/max/deleted/...) вкладки «Файлы».
/// </summary>
public sealed record HubFsEgressResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubFsEgressEvent>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
    [JsonPropertyName("noise_hidden")] public int NoiseHidden { get; init; }
}

public sealed record HubFsEgressEvent
{
    [JsonPropertyName("ts")] public long Ts { get; init; }
    [JsonPropertyName("computer_name")] public string? ComputerName { get; init; }
    [JsonPropertyName("windows_user")] public string? WindowsUser { get; init; }
    [JsonPropertyName("channel")] public string? Channel { get; init; }
    [JsonPropertyName("file_name")] public string? FileName { get; init; }
    [JsonPropertyName("size")] public long? Size { get; init; }
    /// <summary>Число событий в сгруппированной строке (group=1).</summary>
    [JsonPropertyName("count")] public int? Count { get; init; }
    [JsonPropertyName("send_state")] public string? SendState { get; init; }
    [JsonPropertyName("target")] public string? Target { get; init; }
}

/// <summary>GET /inventory/telegram-probe|max-probe → {success, chats[]}.</summary>
public sealed record HubDlpChatsResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("chats")] public IReadOnlyList<HubDlpChat>? Chats { get; init; }
}

public sealed record HubDlpChat
{
    [JsonPropertyName("computer_name")] public string? ComputerName { get; init; }
    [JsonPropertyName("windows_user")] public string? WindowsUser { get; init; }
    [JsonPropertyName("chat_id")] public string? ChatId { get; init; }
    [JsonPropertyName("chat_name")] public string? ChatName { get; init; }
    [JsonPropertyName("updated_at")] public long? UpdatedAt { get; init; }
    [JsonPropertyName("messages")] public IReadOnlyList<HubDlpChatMessage>? Messages { get; init; }
    [JsonPropertyName("screenshots")] public IReadOnlyList<string>? Screenshots { get; init; }
}

public sealed record HubDlpChatMessage
{
    [JsonPropertyName("direction")] public string? Direction { get; init; }
    [JsonPropertyName("time")] public string? Time { get; init; }
    [JsonPropertyName("sender")] public string? Sender { get; init; }
    [JsonPropertyName("text")] public string? Text { get; init; }
    [JsonPropertyName("media")] public string? Media { get; init; }
}

/// <summary>GET /inventory/browser-probe → {success, items, total} — визиты браузера.</summary>
public sealed record HubBrowserVisitsResponse
{
    [JsonPropertyName("success")] public bool Success { get; init; }
    [JsonPropertyName("items")] public IReadOnlyList<HubBrowserVisit>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
}

public sealed record HubBrowserVisit
{
    [JsonPropertyName("id")] public long Id { get; init; }
    [JsonPropertyName("computer_name")] public string? ComputerName { get; init; }
    [JsonPropertyName("windows_user")] public string? WindowsUser { get; init; }
    [JsonPropertyName("browser")] public string? Browser { get; init; }
    [JsonPropertyName("profile")] public string? Profile { get; init; }
    [JsonPropertyName("url")] public string? Url { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("domain")] public string? Domain { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("category_display")] public string? CategoryDisplay { get; init; }
    [JsonPropertyName("visited_at")] public string? VisitedAt { get; init; }
    [JsonPropertyName("dwell_sec")] public double? DwellSec { get; init; }
    [JsonPropertyName("idle_sec")] public double? IdleSec { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("merged")] public bool Merged { get; init; }
    /// <summary>Имя файла скриншота (просмотр в нативе недоступен — нужна auth-загрузка).</summary>
    [JsonPropertyName("screenshot_file")] public string? ScreenshotFile { get; init; }
}

// ---- Журнал работ ITINVENT (/json/works*): история обслуживания по карточке ----
// ---- оборудования и регистрация операций. Чтение — database.read, запись — ----
// ---- database.write. Контракт — backend/models/json_operations.py.        ----

/// <summary>
/// Сводка истории работ по единице оборудования — общий вид *HistoryResponse
/// (GET /json/works/cartridge|battery|component|cleaning/history): счёт,
/// дата последней операции и серверное «давно» (time_ago_str). Поля
/// cartridge_*/component_* эхо-фильтры — заполнены только у своих эндпоинтов.
/// </summary>
public sealed record HubMaintenanceHistory
{
    [JsonPropertyName("last_date")] public string? LastDate { get; init; }
    [JsonPropertyName("count")] public int Count { get; init; }
    [JsonPropertyName("time_ago_str")] public string? TimeAgoStr { get; init; }
    [JsonPropertyName("cartridge_color")] public string? CartridgeColor { get; init; }
    [JsonPropertyName("cartridge_model")] public string? CartridgeModel { get; init; }
    [JsonPropertyName("component_type")] public string? ComponentType { get; init; }
    [JsonPropertyName("component_name")] public string? ComponentName { get; init; }
}

/// <summary>
/// Запись журнала картриджей/принтерных комплектующих
/// (GET/POST /json/works/cartridge → CartridgeReplacementResponse).
/// </summary>
public sealed record HubCartridgeWorkRecord
{
    [JsonPropertyName("printer_model")] public string? PrinterModel { get; init; }
    [JsonPropertyName("component_type")] public string? ComponentType { get; init; }
    [JsonPropertyName("component_color")] public string? ComponentColor { get; init; }
    [JsonPropertyName("cartridge_model")] public string? CartridgeModel { get; init; }
    [JsonPropertyName("detection_source")] public string? DetectionSource { get; init; }
    [JsonPropertyName("printer_is_color")] public bool? PrinterIsColor { get; init; }
    [JsonPropertyName("cartridge_color")] public string? CartridgeColor { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
}

/// <summary>
/// Запись журнала батарей (GET/POST /json/works/battery → BatteryReplacementResponse).
/// Ответный контракт бэкенда отдаёт только перечисленные поля; employee и прочее
/// приезжают внутри additional_data, если их положили при записи.
/// </summary>
public sealed record HubBatteryWorkRecord
{
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
}

/// <summary>
/// Запись журнала комплектующих (GET/POST /json/works/component →
/// ComponentReplacementResponse; список объединяет ПК-файл и записи принтерных
/// комплектующих из файла картриджей).
/// </summary>
public sealed record HubComponentWorkRecord
{
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("component_type")] public string? ComponentType { get; init; }
    [JsonPropertyName("component_name")] public string? ComponentName { get; init; }
    [JsonPropertyName("component_model")] public string? ComponentModel { get; init; }
    [JsonPropertyName("equipment_kind")] public string? EquipmentKind { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
}

/// <summary>
/// Запись журнала чисток ПК (GET/POST /json/works/cleaning → PcCleaningResponse).
/// </summary>
public sealed record HubCleaningWorkRecord
{
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("timestamp")] public string? Timestamp { get; init; }
    [JsonPropertyName("db_name")] public string? DbName { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
}

/// <summary>
/// Тело POST /json/works/cartridge (CartridgeReplacementCreate): модель принтера,
/// цвет и ветка/локация обязательны; остальные поля — журнальная метадата
/// (как getCommonHistoryPayload веба).
/// </summary>
public sealed record HubCartridgeWorkRequest
{
    [JsonPropertyName("printer_model")] public required string PrinterModel { get; init; }
    [JsonPropertyName("cartridge_color")] public required string CartridgeColor { get; init; }
    [JsonPropertyName("component_type")] public string? ComponentType { get; init; }
    [JsonPropertyName("component_color")] public string? ComponentColor { get; init; }
    [JsonPropertyName("cartridge_model")] public string? CartridgeModel { get; init; }
    [JsonPropertyName("detection_source")] public string? DetectionSource { get; init; }
    [JsonPropertyName("printer_is_color")] public bool? PrinterIsColor { get; init; }
    [JsonPropertyName("branch")] public required string Branch { get; init; }
    [JsonPropertyName("location")] public required string Location { get; init; }
    [JsonPropertyName("serial_number")] public string? SerialNumber { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("current_description")] public string? CurrentDescription { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
}

/// <summary>Тело POST /json/works/battery (BatteryReplacementCreate).</summary>
public sealed record HubBatteryWorkRequest
{
    [JsonPropertyName("serial_number")] public required string SerialNumber { get; init; }
    [JsonPropertyName("branch")] public required string Branch { get; init; }
    [JsonPropertyName("location")] public required string Location { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("current_description")] public string? CurrentDescription { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
}

/// <summary>Тело POST /json/works/component (ComponentReplacementCreate).</summary>
public sealed record HubComponentWorkRequest
{
    [JsonPropertyName("serial_number")] public required string SerialNumber { get; init; }
    [JsonPropertyName("component_type")] public required string ComponentType { get; init; }
    [JsonPropertyName("component_model")] public required string ComponentModel { get; init; }
    [JsonPropertyName("branch")] public required string Branch { get; init; }
    [JsonPropertyName("location")] public required string Location { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("current_description")] public string? CurrentDescription { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("component_name")] public string? ComponentName { get; init; }
    [JsonPropertyName("equipment_kind")] public string? EquipmentKind { get; init; }
}

/// <summary>Тело POST /json/works/cleaning (PcCleaningCreate).</summary>
public sealed record HubCleaningWorkRequest
{
    [JsonPropertyName("serial_number")] public required string SerialNumber { get; init; }
    [JsonPropertyName("employee")] public string Employee { get; init; } = "Не указан";
    [JsonPropertyName("branch")] public required string Branch { get; init; }
    [JsonPropertyName("location")] public required string Location { get; init; }
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("additional_data")] public Dictionary<string, JsonElement>? AdditionalData { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("current_description")] public string? CurrentDescription { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
}

/// <summary>
/// Ответ GET /json/works/cleaning/statistics/remaining?period_days=&branch=
/// (PcCleaningRemainingResponse) — ПК филиала без чистки за период.
/// </summary>
public sealed record HubPcCleaningRemaining
{
    [JsonPropertyName("branch")] public string? Branch { get; init; }
    [JsonPropertyName("period_days")] public int PeriodDays { get; init; }
    [JsonPropertyName("start_date")] public string? StartDate { get; init; }
    [JsonPropertyName("end_date")] public string? EndDate { get; init; }
    [JsonPropertyName("total_pc")] public int TotalPc { get; init; }
    [JsonPropertyName("remaining_pc")] public int RemainingPc { get; init; }
    [JsonPropertyName("remaining_pcs")] public IReadOnlyList<HubPcCleaningRemainingPc>? RemainingPcs { get; init; }
}

/// <summary>Строка remaining_pcs — ПК, не почищенный за период.</summary>
public sealed record HubPcCleaningRemainingPc
{
    [JsonPropertyName("inv_no")] public string? InvNo { get; init; }
    [JsonPropertyName("serial_no")] public string? SerialNo { get; init; }
    [JsonPropertyName("hw_serial_no")] public string? HwSerialNo { get; init; }
    [JsonPropertyName("location")] public string? Location { get; init; }
    [JsonPropertyName("model_name")] public string? ModelName { get; init; }
    [JsonPropertyName("employee")] public string? Employee { get; init; }
    [JsonPropertyName("last_cleaned_at")] public string? LastCleanedAt { get; init; }
    [JsonPropertyName("equipment_id")] public long? EquipmentId { get; init; }
    [JsonPropertyName("manufacturer")] public string? Manufacturer { get; init; }
    [JsonPropertyName("current_description")] public string? CurrentDescription { get; init; }
}

/// <summary>
/// Ответ GET /json/cartridges/compatibility/{printer_model}
/// (PrinterCompatibilityResponse) — совместимость картриджей и комплектующих
/// принтера; 404 «совместимость не найдена» маппится в HubApiException.
/// </summary>
public sealed record HubCartridgeCompatibility
{
    [JsonPropertyName("printer_model")] public string? PrinterModel { get; init; }
    [JsonPropertyName("oem_cartridge")] public string? OemCartridge { get; init; }
    [JsonPropertyName("compatible_models")] public IReadOnlyList<HubCartridgeModelInfo>? CompatibleModels { get; init; }
    [JsonPropertyName("is_color")] public bool IsColor { get; init; }
    [JsonPropertyName("components")] public IReadOnlyList<string>? Components { get; init; }
    [JsonPropertyName("fuser_models")] public IReadOnlyList<string>? FuserModels { get; init; }
    [JsonPropertyName("photoconductor_models")] public IReadOnlyList<string>? PhotoconductorModels { get; init; }
    [JsonPropertyName("waste_toner_models")] public IReadOnlyList<string>? WasteTonerModels { get; init; }
    [JsonPropertyName("transfer_belt_models")] public IReadOnlyList<string>? TransferBeltModels { get; init; }
}

/// <summary>Модель картриджа в таблице совместимости (CartridgeInfoResponse).</summary>
public sealed record HubCartridgeModelInfo
{
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("color")] public string? Color { get; init; }
    [JsonPropertyName("page_yield")] public int? PageYield { get; init; }
    [JsonPropertyName("oem_part")] public string? OemPart { get; init; }
}

// ---- Мои файлы: корзина, квота, копия, архив, предпросмотр, участники ----
// ---- библиотеки (/my-files/*). Обратная связь (/feedback).             ----

/// <summary>
/// Ответ GET /my-files/trash?library_id= (MyFileTrashResponse):
/// удалённые файлы и папки диска (library_id=null) или библиотеки.
/// </summary>
public sealed record HubMyFileTrash
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMyFileItem>? Items { get; init; }
    [JsonPropertyName("folders")] public IReadOnlyList<HubMyFileFolder>? Folders { get; init; }
}

/// <summary>
/// Ответ GET /my-files/quota (MyFileQuotaResponse): занято/лимит личного диска.
/// </summary>
public sealed record HubMyFileQuota
{
    [JsonPropertyName("used_bytes")] public long UsedBytes { get; init; }
    [JsonPropertyName("limit_bytes")] public long LimitBytes { get; init; }
    [JsonPropertyName("remaining_bytes")] public long RemainingBytes { get; init; }
}

/// <summary>
/// Ответ GET /my-files/{id}/preview (PublicMyFilePreviewResponse):
/// preview_kind: image|pdf|office|video|text|unsupported — решает, что
/// рендерить у /preview/content (у office — имя PDF в pdf_filename).
/// </summary>
public sealed record HubMyFilePreview
{
    [JsonPropertyName("preview_kind")] public string? PreviewKind { get; init; }
    [JsonPropertyName("source_kind")] public string? SourceKind { get; init; }
    [JsonPropertyName("source_filename")] public string? SourceFilename { get; init; }
    [JsonPropertyName("pdf_filename")] public string? PdfFilename { get; init; }
    [JsonPropertyName("page_count")] public int PageCount { get; init; }
    [JsonPropertyName("preview_url")] public string? PreviewUrl { get; init; }
}

/// <summary>
/// Элемент PUT /my-files/libraries/{id}/members (LibraryMember):
/// principal_type user|department, роль manage|edit|comment|view.
/// </summary>
public sealed record HubMyFileLibraryMemberInput
{
    [JsonPropertyName("principal_type")] public string PrincipalType { get; init; } = "user";
    [JsonPropertyName("principal_id")] public string PrincipalId { get; init; } = string.Empty;
    [JsonPropertyName("role")] public string Role { get; init; } = "edit";
}

/// <summary>
/// Участник общей папки — элемент items GET/PUT …/libraries/{id}/members
/// (LibraryMemberResponse = LibraryMember + name + members_count).
/// </summary>
public sealed record HubMyFileLibraryMember
{
    [JsonPropertyName("principal_type")] public string? PrincipalType { get; init; }
    [JsonPropertyName("principal_id")] public string? PrincipalId { get; init; }
    [JsonPropertyName("role")] public string? Role { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    /// <summary>У department — число сотрудников отдела; у пользователя — 0.</summary>
    [JsonPropertyName("members_count")] public int MembersCount { get; init; }
}

/// <summary>Ответ GET/PUT /my-files/libraries/{id}/members → {items}.</summary>
public sealed record HubMyFileLibraryMembers
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMyFileLibraryMember>? Items { get; init; }
}

/// <summary>Элемент items GET /my-files/office/groups (OfficeGroup) — отдел как участник.</summary>
public sealed record HubMyFileOfficeGroup
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
    [JsonPropertyName("members_count")] public int MembersCount { get; init; }
}

/// <summary>Ответ GET /my-files/office/groups → {items} (право my_files.share).</summary>
public sealed record HubMyFileOfficeGroupList
{
    [JsonPropertyName("items")] public IReadOnlyList<HubMyFileOfficeGroup>? Items { get; init; }
}

/// <summary>
/// Тело POST /feedback (SuggestionCreate): категория idea|inconvenience|bug|other.
/// </summary>
public sealed record HubFeedbackCreate
{
    [JsonPropertyName("category")] public string Category { get; init; } = "idea";
    [JsonPropertyName("title")] public string Title { get; init; } = string.Empty;
    [JsonPropertyName("message")] public string Message { get; init; } = string.Empty;
    [JsonPropertyName("section")] public string? Section { get; init; }
}

/// <summary>
/// Предложение пользователя: элемент items GET /feedback/mine и ответ
/// POST /feedback (сериализация feedback_service._serialize без author).
/// status: new|in_progress|accepted|declined|done.
/// </summary>
public sealed record HubFeedbackSuggestion
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("category")] public string? Category { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("message")] public string? Message { get; init; }
    [JsonPropertyName("section")] public string? Section { get; init; }
    [JsonPropertyName("status")] public string? Status { get; init; }
    [JsonPropertyName("admin_note")] public string? AdminNote { get; init; }
    [JsonPropertyName("created_at")] public string? CreatedAt { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
}

/// <summary>Ответ GET /feedback/mine?limit= → {items,total}.</summary>
public sealed record HubMyFeedbackPage
{
    [JsonPropertyName("items")] public IReadOnlyList<HubFeedbackSuggestion>? Items { get; init; }
    [JsonPropertyName("total")] public int Total { get; init; }
}
