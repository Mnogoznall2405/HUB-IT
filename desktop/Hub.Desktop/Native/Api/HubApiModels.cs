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
}

public sealed record HubTaskDetail : HubTaskItem
{
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("capabilities")] public HubTaskCapabilities? Capabilities { get; init; }
    [JsonPropertyName("comments_total")] public int CommentsTotal { get; init; }
    [JsonPropertyName("checklist_total")] public int ChecklistTotal { get; init; }
    [JsonPropertyName("checklist_done")] public int ChecklistDone { get; init; }
    [JsonPropertyName("status_log")] public IReadOnlyList<HubTaskStatusLogEntry>? StatusLog { get; init; }
}

public sealed record HubTaskStatusLogEntry
{
    [JsonPropertyName("old_status")] public string? OldStatus { get; init; }
    [JsonPropertyName("new_status")] public string? NewStatus { get; init; }
    [JsonPropertyName("changed_by_full_name")] public string? ChangedByFullName { get; init; }
    [JsonPropertyName("changed_at")] public DateTimeOffset? ChangedAt { get; init; }
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
    /// <summary>id ручной записи HUB (число в JSON, толерантно читаем в строку).</summary>
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("display_name")] public string? DisplayName { get; init; }
    [JsonPropertyName("kind")] public string? Kind { get; init; }
    [JsonPropertyName("kind_label")] public string? KindLabel { get; init; }
    [JsonPropertyName("starts_on")] public string? StartsOn { get; init; }
    [JsonPropertyName("ends_on")] public string? EndsOn { get; init; }
    [JsonPropertyName("source")] public string? Source { get; init; }
}

// ---- Новости: GET /hub/announcements (+ /{id}, mark-as-read, ack) ----

public sealed record HubAnnouncementQuery
{
    public string? Search { get; init; }
    public bool UnreadOnly { get; init; }
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
    [JsonPropertyName("category")] public HubAnnouncementCategory? Category { get; init; }
}

public sealed record HubAnnouncementCategory
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("name")] public string? Name { get; init; }
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

// ---- Отсутствия: GET /hub/absences (manual + zup) ----

public sealed record HubAbsenceRangeList
{
    /// <summary>Ручные записи HUB (source="hub", есть id для правок).</summary>
    [JsonPropertyName("items")] public IReadOnlyList<HubAbsenceItem>? Items { get; init; }

    /// <summary>Записи из ЗУП (source="zup", read-only).</summary>
    [JsonPropertyName("zup_items")] public IReadOnlyList<HubAbsenceItem>? ZupItems { get; init; }
    [JsonPropertyName("zup_count")] public int ZupCount { get; init; }
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
    [JsonPropertyName("used_bytes")] public long UsedBytes { get; init; }
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

/// <summary>Метаданные фото GET /equipment/{item_id}/photos (бинарный контент — вне среза).</summary>
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
    [JsonPropertyName("rejected")] public bool Rejected { get; init; }
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
/// </summary>
public sealed record HubTransferExecuteResponse
{
    [JsonPropertyName("success_count")] public int SuccessCount { get; init; }
    [JsonPropertyName("failed_count")] public int FailedCount { get; init; }
    [JsonPropertyName("transferred")] public IReadOnlyList<HubTransferItemResult>? Transferred { get; init; }
    [JsonPropertyName("failed")] public IReadOnlyList<HubTransferFailedItem>? Failed { get; init; }
    [JsonPropertyName("retry_inv_nos")] public IReadOnlyList<string>? RetryInvNos { get; init; }
    [JsonPropertyName("acts")] public IReadOnlyList<HubTransferAct>? Acts { get; init; }
    [JsonPropertyName("job_id")] public string? JobId { get; init; }
    [JsonPropertyName("operation_id")] public string? OperationId { get; init; }
    [JsonPropertyName("job_status")] public string? JobStatus { get; init; }
    [JsonPropertyName("job_status_text")] public string? JobStatusText { get; init; }
    [JsonPropertyName("job_error")] public string? JobError { get; init; }
    [JsonPropertyName("job_operation")] public string? JobOperation { get; init; }
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
    [JsonPropertyName("mailbox_login")] public string? MailboxLogin { get; init; }
    [JsonPropertyName("mail_is_configured")] public bool MailIsConfigured { get; init; }
    [JsonPropertyName("is_2fa_enabled")] public bool IsTwoFactorEnabled { get; init; }
    [JsonPropertyName("last_login_at")] public string? LastLoginAt { get; init; }
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
/// AI-бот (админ-список): элемент массива GET /ai-bots
/// (admin или право settings.ai.manage). Правка/прогоны — вне read-среза.
/// </summary>
public sealed record HubAdminAiBot
{
    [JsonPropertyName("id")] public string? Id { get; init; }
    [JsonPropertyName("slug")] public string? Slug { get; init; }
    [JsonPropertyName("title")] public string? Title { get; init; }
    [JsonPropertyName("description")] public string? Description { get; init; }
    [JsonPropertyName("model")] public string? Model { get; init; }
    [JsonPropertyName("is_enabled")] public bool IsEnabled { get; init; }
    [JsonPropertyName("configured")] public bool Configured { get; init; }
    [JsonPropertyName("required_permission")] public string? RequiredPermission { get; init; }
    [JsonPropertyName("enabled_tools")] public IReadOnlyList<string>? EnabledTools { get; init; }
    [JsonPropertyName("allowed_kb_scope")] public IReadOnlyList<string>? AllowedKbScope { get; init; }
    [JsonPropertyName("latest_run_status")] public string? LatestRunStatus { get; init; }
    [JsonPropertyName("latest_run_error")] public string? LatestRunError { get; init; }
    [JsonPropertyName("updated_at")] public string? UpdatedAt { get; init; }
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
