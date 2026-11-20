using System.IO;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// API-клиент нативного desktop-приложения. Bearer-контракт как у mobile-hub:
/// Authorization: Bearer + X-Auth-Client: mobile + X-Client-Device-ID.
/// Refresh — строго single-flight, пара токенов заменяется атомарно.
/// </summary>
public interface IHubApiClient
{
    /// <summary>Текущая восстановленная сессия, null — нужен логин.</summary>
    NativeSession? CurrentSession { get; }

    /// <summary>
    /// Сессия окончательно мертва (401 после refresh или user_inactive):
    /// хранилище уже очищено, UI обязан показать логин.
    /// </summary>
    event EventHandler? SessionEnded;

    /// <summary>Восстановить сессию из хранилища; проверяет access, при необходимости refresh.</summary>
    Task<NativeSession?> RestoreSessionAsync(CancellationToken cancellationToken);

    Task<HubLoginResult> LoginAsync(string username, string password, CancellationToken cancellationToken);

    Task<HubLoginResult> VerifyTwoFactorLoginAsync(
        string loginChallengeId,
        string? totpCode,
        string? backupCode,
        CancellationToken cancellationToken);

    Task<HubTaskListPage> GetMyTasksAsync(HubTaskQuery query, CancellationToken cancellationToken);

    /// <summary>GET /hub/dashboard: summary-счётчики, последние задачи, новости, отсутствующие.</summary>
    Task<HubDashboard> GetDashboardAsync(
        int announcementsLimit,
        int tasksLimit,
        CancellationToken cancellationToken);

    Task<HubTaskDetail> GetTaskAsync(long taskId, CancellationToken cancellationToken);

    /// <summary>
    /// Переход статуса: start/reopen/complete/approve/reject — JSON; submit — multipart с comment.
    /// Возвращает обновлённый detail задачи.
    /// </summary>
    Task<HubTaskDetail> TransitionTaskAsync(
        long taskId,
        HubTaskTransition transition,
        string? comment,
        CancellationToken cancellationToken);

    /// <summary>GET /hub/tasks/{id}/comments — архивная лента (старые первыми).</summary>
    Task<HubTaskCommentList> GetTaskCommentsAsync(long taskId, CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/tasks/{id}/comments {body}. При включённом чат-обсуждении
    /// backend отвечает 400 «use_task_discussion_chat» — писать надо в чат.
    /// </summary>
    Task<HubTaskComment> AddTaskCommentAsync(
        long taskId,
        string body,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/tasks/{id}/comments/mark-seen — прочитано + backend гасит
    /// уведомления task.comment_added.
    /// </summary>
    Task MarkTaskCommentsSeenAsync(long taskId, CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/tasks/{id}/discussion — создать/открыть привязанный разговор
    /// (kind="task"), вернуть conversation_id для навигации в чат.
    /// 404, когда флаг чат-обсуждений выключен; 403 не-участнику.
    /// </summary>
    Task<HubTaskDiscussion> OpenTaskDiscussionAsync(
        long taskId,
        CancellationToken cancellationToken);

    /// <summary>POST /hub/tasks/{id}/attachments — multipart file; лимит backend'а 20 МБ.</summary>
    Task<HubTaskAttachment> UploadTaskAttachmentAsync(
        long taskId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken);

    /// <summary>DELETE /hub/tasks/{id}/attachments/{attachment_id} — автор/постановщик/admin, scope=task, статус != done.</summary>
    Task DeleteTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        CancellationToken cancellationToken);

    /// <summary>GET …/attachments/{attachment_id}/file — стрим в destination, имя из Content-Disposition.</summary>
    Task<string> DownloadTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET …/attachments/{attachment_id}/preview/pdf — Office-превью:
    /// 202 + Retry-After пока генерируется, затем PDF-поток (паттерн docflow preview).
    /// </summary>
    Task<string> DownloadTaskAttachmentPreviewPdfAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/tasks — создание задачи верхнего уровня
    /// (право tasks.create или tasks.write; admin — всегда).
    /// Ответ {items:[созданные…], created:N}; поля DTO — по request-модели роута.
    /// Роут Idempotency-Key не принимает. 400 — валидация, 403 — нет права.
    /// </summary>
    Task<HubTaskCreateResult> CreateTaskAsync(
        HubTaskCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/tasks/{id}/subtasks — подзадача: tasks.read + участник родителя
    /// (capability can_create_subtask), право tasks.create не нужно.
    /// Ответ — detail созданной задачи (с capabilities).
    /// 403 не-участнику; 400 — родитель выполнен или сам подзадача.
    /// </summary>
    Task<HubTaskDetail> CreateSubtaskAsync(
        long taskId,
        HubTaskSubtaskCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/users/assignees?q=&limit= — поиск исполнителей по ФИО/логину
    /// (активные, без служебных; tasks.read). Пустой q — первые limit записей.
    /// </summary>
    Task<HubTaskUserList> SearchTaskAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/users/controllers — контролёры: право tasks.review или
    /// руководитель подразделения (tasks.read). Параметра поиска у роута нет.
    /// </summary>
    Task<HubTaskUserList> GetTaskControllersAsync(CancellationToken cancellationToken);

    /// <summary>GET /hub/task-projects — активные проекты для выбора в форме задачи.</summary>
    Task<HubTaskProjectList> GetTaskProjectsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/task-objects?project_id= — активные объекты; project_id null —
    /// все объекты (роут принимает повторяющийся параметр, desktop фильтрует по одному).
    /// </summary>
    Task<HubTaskObjectList> GetTaskObjectsAsync(
        string? projectId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/tasks/analytics?start_date=&end_date=&date_basis=&project_id=&object_id=&participant_user_id=
    /// — отчётная панель задач (право tasks.read): summary-метрики, разрезы
    /// by_participant/by_project/by_object, status_breakdown и trend; списки id
    /// уходят повторяющимися параметрами, как в веб-запросе.
    /// </summary>
    Task<HubTaskAnalyticsPayload> GetTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/tasks/analytics/export — xlsx-отчёт (те же параметры), стримится
    /// в destination; возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> ExportTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        Stream destination,
        CancellationToken cancellationToken);

    // ---- Новости ----

    /// <summary>GET /hub/announcements: список опубликованных с фильтрами.</summary>
    Task<HubAnnouncementListPage> GetAnnouncementsAsync(
        HubAnnouncementQuery query,
        CancellationToken cancellationToken);

    /// <summary>GET /hub/announcements/{id}: деталь с body и attachments.</summary>
    Task<HubAnnouncementItem> GetAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken);

    Task MarkAnnouncementReadAsync(string announcementId, CancellationToken cancellationToken);

    /// <summary>Подтверждение прочтения обязательной новости (requires_ack).</summary>
    Task AckAnnouncementAsync(string announcementId, CancellationToken cancellationToken);

    /// <summary>
    /// PUT /hub/announcements/{id}/reaction — поставить/сменить свою эмодзи-реакцию
    /// (reaction_type: like|love|laugh|wow|sad|angry). Ответ — счётчики и viewer_reaction.
    /// </summary>
    Task<HubAnnouncementReactionState> SetAnnouncementReactionAsync(
        string announcementId,
        string reactionType,
        CancellationToken cancellationToken);

    /// <summary>DELETE /hub/announcements/{id}/reaction — снять свою реакцию.</summary>
    Task<HubAnnouncementReactionState> ClearAnnouncementReactionAsync(
        string announcementId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/announcements/{id}/reactions — кто реагировал
    /// (user_id/username/full_name/reaction_type/updated_at).
    /// </summary>
    Task<HubAnnouncementReactionUserList> GetAnnouncementReactionUsersAsync(
        string announcementId,
        string? reactionType,
        int limit,
        int offset,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT/DELETE /hub/announcements/{id}/like — «нравится» (= реакция «like»,
    /// ответ той же формы, что и у reaction).
    /// </summary>
    Task<HubAnnouncementReactionState> SetAnnouncementLikeAsync(
        string announcementId,
        bool liked,
        CancellationToken cancellationToken);

    /// <summary>PUT/DELETE /hub/announcements/{id}/bookmark → {viewer_bookmarked}.</summary>
    Task<HubAnnouncementBookmarkState> SetAnnouncementBookmarkAsync(
        string announcementId,
        bool bookmarked,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /hub/announcements/{id}/poll/vote — голосование; тело {option_ids}.
    /// Пустой список снимает голос; повторный вызов заменяет выбор (как в вебе).
    /// Ответ {announcement_id, poll} с актуальными счётчиками.
    /// </summary>
    Task<HubAnnouncementPollVoteResult> VoteAnnouncementPollAsync(
        string announcementId,
        IReadOnlyList<string> optionIds,
        CancellationToken cancellationToken);

    /// <summary>GET /hub/announcements/{id}/comments — корневые комментарии или ответы ветки.</summary>
    Task<HubAnnouncementCommentPage> GetAnnouncementCommentsAsync(
        string announcementId,
        HubAnnouncementCommentQuery query,
        CancellationToken cancellationToken);

    /// <summary>POST /hub/announcements/{id}/comments — новый комментарий/ответ.</summary>
    Task<HubAnnouncementComment> CreateAnnouncementCommentAsync(
        string announcementId,
        string body,
        string? parentCommentId,
        CancellationToken cancellationToken);

    /// <summary>PATCH /hub/announcements/{id}/comments/{comment_id} — правка своего.</summary>
    Task<HubAnnouncementComment> UpdateAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        string body,
        CancellationToken cancellationToken);

    /// <summary>DELETE /hub/announcements/{id}/comments/{comment_id} — удаление своего.</summary>
    Task DeleteAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        CancellationToken cancellationToken);

    /// <summary>PUT/DELETE /hub/announcements/{id}/comments/{comment_id}/reaction.</summary>
    Task<HubAnnouncementCommentReactionState> SetAnnouncementCommentReactionAsync(
        string announcementId,
        string commentId,
        string? reactionType,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/announcements/{id}/attachments/{attachment_id}/file —
    /// бинарное скачивание вложения объявления. Возвращает имя файла из
    /// Content-Disposition (пусто, если заголовка нет). Ошибка HTTP — HubApiException.
    /// </summary>
    Task<string> DownloadAnnouncementAttachmentAsync(
        string announcementId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/announcements/{id}/comments/{comment_id}/attachments/{attachment_id}/file —
    /// бинарное скачивание вложения комментария. Возвращает имя файла (или пусто).
    /// </summary>
    Task<string> DownloadAnnouncementCommentAttachmentAsync(
        string announcementId,
        string commentId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    // ---- Отсутствия ----

    /// <summary>GET /hub/absences: ручные записи + ЗУП. День (on) или диапазон.</summary>
    Task<HubAbsenceRangeList> GetAbsencesAsync(
        string? on,
        string? startsOn,
        string? endsOn,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/absences — создание ручной записи (право hub.absences.manage или admin).
    /// Ответ — сериализованная запись; 400 — валидация сервера, 403 — нет права.
    /// </summary>
    Task<HubAbsenceItem> CreateHubAbsenceAsync(
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /hub/absences/{id} — правка ручной записи; тело — diff изменённых полей.
    /// Ответ — обновлённая запись; 404 — запись не найдена.
    /// </summary>
    Task<HubAbsenceItem> UpdateHubAbsenceAsync(
        long absenceId,
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken);

    /// <summary>DELETE /hub/absences/{id} — удаление ручной записи (ответ {ok:true}).</summary>
    Task DeleteHubAbsenceAsync(long absenceId, CancellationToken cancellationToken);

    // ---- Центр уведомлений ----

    /// <summary>
    /// GET /hub/notifications/poll?since=&limit=&unread_only= — лента уведомлений
    /// (новые сверху, unread 0/1) + unread_counts в том же ответе.
    /// since — курсор максимального created_at прошлой выдачи: сервер отдаёт
    /// только записи строго новее (created_at > since); пустой since — свежая
    /// голова списка. limit клампится сервером в 1..200.
    /// </summary>
    Task<HubNotificationPoll> GetNotificationsPollAsync(
        string? since,
        int limit,
        bool unreadOnly,
        CancellationToken cancellationToken);

    /// <summary>GET /hub/notifications/unread-counts — счётчики бейджа колокола.</summary>
    Task<HubNotificationUnreadCounts> GetNotificationUnreadCountsAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/notifications/{id}/read → {ok, notification_id}.
    /// 404 «Notification not found» — HubApiException с detail в Message.
    /// </summary>
    Task<HubNotificationReadResult> MarkNotificationReadAsync(
        string notificationId,
        CancellationToken cancellationToken);

    /// <summary>POST /hub/notifications/read-all → {ok, marked_count}.</summary>
    Task<HubNotificationReadAllResult> MarkAllNotificationsReadAsync(
        CancellationToken cancellationToken);

    // ---- Почта ----

    /// <summary>
    /// GET /mail/bootstrap?limit=&mailbox_id= — одним запросом: состояние ящика
    /// (selected_mailbox/mailboxInfo: mail_is_configured, mail_requires_password,
    /// mail_requires_relogin), дерево папок, unread_count и голова входящих
    /// (messages всегда по folder=inbox). limit — размер головной страницы (10..100).
    /// </summary>
    Task<HubMailBootstrap> GetMailBootstrapAsync(
        int limit,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>GET /mail/folders/tree?mailbox_id= → {items, favorites} с total/unread по папкам.</summary>
    Task<HubMailFolderTree> GetMailFolderTreeAsync(
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/messages — offset-пагинация (has_more/next_offset/total),
    /// серверный поиск q и фильтр unread_only. folder — alias или id узла дерева.
    /// </summary>
    Task<HubMailMessagePage> GetMailMessagesAsync(
        HubMailMessageQuery query,
        CancellationToken cancellationToken);

    /// <summary>GET /mail/messages/{id}?mailbox_id= — полное письмо (body_html + body_text).</summary>
    Task<HubMailMessageDetail> GetMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>POST /mail/messages/{id}/read?mailbox_id= → {ok}.</summary>
    Task<HubMailActionResult> MarkMailMessageReadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>POST /mail/messages/{id}/unread?mailbox_id= → {ok}.</summary>
    Task<HubMailActionResult> MarkMailMessageUnreadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/{id}/delete {mailbox_id, permanent}.
    /// permanent=false — в «Удалённые»; permanent=true — безвозвратно.
    /// </summary>
    Task<HubMailActionResult> DeleteMailMessageAsync(
        string messageId,
        string? mailboxId,
        bool permanent,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/{id}/restore {mailbox_id} — возврат письма из «Удалённых»
    /// (аналог restoreMessage веб-почты); ответ {ok, moved_to}.
    /// </summary>
    Task<HubMailActionResult> RestoreMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/messages/{id}/headers — полные заголовки письма
    /// ({items: [{name, value}]}, как message_headers_payload веба).
    /// </summary>
    Task<HubMailMessageHeaders> GetMailMessageHeadersAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/messages/{id}/eml — исходник письма (RFC822) стримом в destination;
    /// возвращает имя файла из Content-Disposition (как DownloadMailAttachmentAsync).
    /// </summary>
    Task<string> DownloadMailMessageSourceAsync(
        string messageId,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>POST /mail/messages/{id}/move {mailbox_id, target_folder} — перенос в другую папку.</summary>
    Task<HubMailActionResult> MoveMailMessageAsync(
        string messageId,
        string? mailboxId,
        string targetFolder,
        CancellationToken cancellationToken);

    /// <summary>
    /// Отправка письма: без вложений — POST /mail/messages/send (JSON),
    /// с файлами — POST /mail/messages/send-multipart (multipart, файлы полем files[]).
    /// Reply/forward идут через reply_to_message_id/forward_message_id — тело цитаты
    /// и серверные вложения исходного письма собирает backend.
    /// </summary>
    Task<HubMailSendResult> SendMailMessageAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/drafts/upsert-multipart — сохранить черновик (multipart даже без файлов,
    /// JSON-варианта у endpoint нет). Ответ — {ok, draft_id, saved_at, message}.
    /// </summary>
    Task<HubMailDraftSaveResult> SaveMailDraftAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /mail/drafts/{id}?mailbox_id= — безвозвратное удаление черновика
    /// (ответ {ok, draft_id}). id — message-ref черновика из папки «Черновики».
    /// </summary>
    Task<HubMailActionResult> DeleteMailDraftAsync(
        string draftId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/contacts?q=&mailbox_id= — автоподсказка адресатов композера
    /// (GAL Exchange + локальные пользователи; backend ищет от 2 символов, limit'а нет).
    /// </summary>
    Task<IReadOnlyList<HubMailContact>> SearchMailContactsAsync(
        string query,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/messages/{mid}/attachments/{ref}?mailbox_id= — поток файла в destination.
    /// Возвращает имя файла из Content-Disposition (или fallback).
    /// </summary>
    Task<string> DownloadMailAttachmentAsync(
        string messageId,
        string attachmentRef,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/bulk {mailbox_id, action, message_ids, target_folder, permanent} —
    /// mark_read|mark_unread|move|delete|archive над списком id одним вызовом.
    /// </summary>
    Task<HubMailBulkResult> BulkMailMessageActionAsync(
        string? mailboxId,
        string action,
        IReadOnlyList<string> messageIds,
        string? targetFolder,
        bool permanent,
        CancellationToken cancellationToken);

    /// <summary>GET /mail/unread-count?mailbox_id= — агрегат непрочитанных ящика.</summary>
    Task<HubMailUnreadCount> GetMailUnreadCountAsync(
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/folders {mailbox_id, name, parent_folder_id, scope} — пользовательская
    /// папка; parent_folder_id пустой — корень области (scope=mailbox|archive).
    /// Ответ — сериализованный узел дерева (как элементы folders/tree).
    /// </summary>
    Task<HubMailFolder> CreateMailFolderAsync(
        string? mailboxId,
        string name,
        string? parentFolderId,
        string? scope,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /mail/folders/{id}?mailbox_id= {name} — переименование пользовательской
    /// папки; стандартные backend отклоняет (can_rename=false в дереве).
    /// </summary>
    Task<HubMailFolder> RenameMailFolderAsync(
        string folderId,
        string? mailboxId,
        string name,
        CancellationToken cancellationToken);

    /// <summary>DELETE /mail/folders/{id}?mailbox_id= → {ok, folder_id}; только пользовательские.</summary>
    Task<HubMailFolderDeleteResult> DeleteMailFolderAsync(
        string folderId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/folders/{id}/favorite {mailbox_id, favorite} → {ok, folder_id, favorite};
    /// избранное детерминированно по дереву — сервер согласует флаг.
    /// </summary>
    Task<HubMailFolderFavoriteResult> SetMailFolderFavoriteAsync(
        string folderId,
        string? mailboxId,
        bool favorite,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/{id}/importance {importance, mailbox_id} → {ok, importance};
    /// importance = high|normal|low.
    /// </summary>
    Task<HubMailImportanceResult> SetMailMessageImportanceAsync(
        string messageId,
        string? mailboxId,
        string importance,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/{id}/summarize?mailbox_id= → {summary}.
    /// Серверный гейт: MAIL_AI_ENABLED kill-switch + rate limit
    /// (403 MAIL_AI_DISABLED / 429 MAIL_AI_RATE_LIMITED).
    /// </summary>
    Task<HubMailSummaryResult> SummarizeMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>POST /mail/messages/{id}/smart-replies?mailbox_id= → {suggestions} (до 3).</summary>
    Task<HubMailSmartRepliesResult> GetMailSmartRepliesAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/templates?include_inactive= — шаблоны IT-заявок для формы
    /// «Заявка в IT» (активные по умолчанию; поля fields[] по mail_template_model).
    /// </summary>
    Task<IReadOnlyList<HubMailTemplate>> GetMailTemplatesAsync(
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /mail/messages/send-it-request {template_id, fields} — заявка без
    /// файлов; сервер рендерит тему/тело шаблона и шлёт на адреса ИТ.
    /// </summary>
    Task<HubMailSendResult> SendMailItRequestAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken,
        string? idempotencyKey = null);

    /// <summary>
    /// POST /mail/messages/send-it-request-multipart — та же заявка с файлами:
    /// поля template_id + fields_json (JSON-объект) + повторяющееся files[].
    /// </summary>
    Task<HubMailSendResult> SendMailItRequestMultipartAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<HubMailOutgoingAttachment> attachments,
        CancellationToken cancellationToken,
        string? idempotencyKey = null);

    // ---- Документооборот 1С ----

    /// <summary>
    /// GET /docflow/tasks?scope=&q=&limit=&offset= — список заданий 1С
    /// (scope=inbox|completed|all, offset-пагинация has_more/next_offset).
    /// </summary>
    Task<HubDocflowTaskListPage> GetDocflowTasksAsync(
        HubDocflowTaskQuery query,
        CancellationToken cancellationToken);

    /// <summary>GET /docflow/inbox-summary — счётчик входящих для бейджа навигации.</summary>
    Task<HubDocflowInboxSummary> GetDocflowInboxSummaryAsync(
        CancellationToken cancellationToken);

    /// <summary>GET /docflow/tasks/{ref}?include_related= — карточка задания с файлами и действиями.</summary>
    Task<HubDocflowTaskDetail> GetDocflowTaskAsync(
        string taskRef,
        bool includeRelated,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /docflow/tasks/{ref}/actions {action, comment, state_token} + Idempotency-Key.
    /// Ответ — DocflowCommandResponse; статус pending/state_unknown (HTTP 202)
    /// опрашивается через GetDocflowCommandAsync.
    /// </summary>
    Task<HubDocflowCommandResult> ApplyDocflowTaskActionAsync(
        string taskRef,
        string action,
        string? comment,
        string stateToken,
        string idempotencyKey,
        CancellationToken cancellationToken);

    /// <summary>GET /docflow/commands/{id} — статус асинхронного действия (202 → ещё не готово).</summary>
    Task<HubDocflowCommandResult> GetDocflowCommandAsync(
        string commandId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/tasks/{task_ref}/files/{file_ref}/content — поток файла в destination.
    /// Возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> DownloadDocflowFileAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/tasks/{task_ref}/files/{file_ref}/preview/pdf — PDF-предпросмотр файла.
    /// При 202 (копия ещё готовится в 1С) ждёт Retry-After и повторяет запрос;
    /// исчерпание попыток или 422 — HubApiException. Тело стримится в destination;
    /// возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> DownloadDocflowFilePreviewAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>GET /docflow/profile — профиль креденшелсов 1С («не настроены» → подсказка).</summary>
    Task<HubDocflowProfile> GetDocflowProfileAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/assignments/capability — доступно ли пользователю создание
    /// поручений (enabled/reason/document_types/test_only/required_title_prefix).
    /// </summary>
    Task<HubDocflowAssignmentCapability> GetDocflowAssignmentCapabilityAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/assignments/documents?q=&limit= — поиск документа 1С
    /// для поручения (веб ищет от 3 символов, limit ≤ 50).
    /// </summary>
    Task<HubDocflowAssignmentDocumentList> SearchDocflowAssignmentDocumentsAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/assignments/assignees?q=&limit= — справочник исполнителей
    /// и контролёров поручения (limit ≤ 50; пустой q — первые записи).
    /// </summary>
    Task<HubDocflowAssignmentAssigneeList> SearchDocflowAssignmentAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /docflow/assignments {document_type, document_ref, assignee_ref,
    /// controller_ref?, due_at, importance, title, description} + Idempotency-Key
    /// (8..128 — ключ жизни формы, повторная отправка не дублирует поручение).
    /// Ответ — DocflowAssignmentCommandResponse; статус pending/state_unknown
    /// (HTTP 202) опрашивается через GetDocflowAssignmentCommandAsync.
    /// </summary>
    Task<HubDocflowAssignmentCommandResult> CreateDocflowAssignmentAsync(
        HubDocflowAssignmentCreateRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/assignments/commands/{id} — статус команды создания поручения
    /// (202 → ещё не готово; endpoint отдельный от /commands — права CREATE, а не ACT).
    /// </summary>
    Task<HubDocflowAssignmentCommandResult> GetDocflowAssignmentCommandAsync(
        string commandId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /docflow/profile/test {login,password} — проверка связи с 1С по
    /// введённым кредам без их сохранения (на backend rate-limit 5/мин — не спамить).
    /// </summary>
    Task<HubDocflowConnectionTestResult> TestDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /docflow/profile/credentials {login,password} — сохранить креды 1С
    /// (зашифрованные на backend); ответ — обновлённый профиль.
    /// </summary>
    Task<HubDocflowProfile> SaveDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken);

    /// <summary>DELETE /docflow/profile/credentials → 204: удалить креды, отключить 1С.</summary>
    Task DeleteDocflowCredentialsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/metadata — справочник типов задач/процессов конфигурации 1С.
    /// Только docflow.admin (для прочих 403); в веб-UI не показывается.
    /// </summary>
    Task<HubDocflowMetadata> GetDocflowMetadataAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /docflow/absences?on=&employee_code= — записи об отсутствиях из 1С
    /// на дату (on — YYYY-MM-DD, по умолчанию сегодня; employee_code сужает до
    /// сотрудника адресной книги). Требует docflow.read + address_book.read.
    /// </summary>
    Task<HubDocflowAbsenceList> GetDocflowAbsencesAsync(
        string? employeeCode,
        string? on,
        CancellationToken cancellationToken);

    // ---- Билеты ----

    /// <summary>
    /// GET /tickets/requests — список заявок с page-пагинацией (total/total_pages),
    /// фильтрами statuses/object_ids (csv) и серверным search (от 2 символов).
    /// </summary>
    Task<HubTicketListPage> GetTicketRequestsAsync(
        HubTicketQuery query,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/requests/{id} — карточка заявки (version для optimistic locking).</summary>
    Task<HubTicketRequest> GetTicketRequestAsync(
        long requestId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /tickets/requests/{id}/status {new_status, expected_version, comment} —
    /// смена статуса по state-машине backend'а; 409 при конфликте версии/недопустимом
    /// переходе. Возвращает обновлённую заявку.
    /// </summary>
    Task<HubTicketRequest> ChangeTicketStatusAsync(
        long requestId,
        string newStatus,
        int expectedVersion,
        string? comment,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/requests/{id}/comments — хронологическая лента (старые первыми).</summary>
    Task<HubTicketCommentPage> GetTicketCommentsAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/requests/{id}/history?page=&page_size= — история изменений
    /// заявки, обратная хронология (новые первыми); page_size ∈ 20/25/50/100.
    /// </summary>
    Task<HubTicketHistoryPage> GetTicketHistoryAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken);

    /// <summary>POST /tickets/requests/{id}/comments {text, comment_type=normal} → созданный комментарий.</summary>
    Task<HubTicketComment> AddTicketCommentAsync(
        long requestId,
        string text,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/requests/{id}/attachments → {items}.</summary>
    Task<HubTicketAttachmentList> GetTicketAttachmentsAsync(
        long requestId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/requests/{id}/attachments/{attachment_id} — поток файла в destination.
    /// Возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> DownloadTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/objects — справочник объектов выезда для фильтра списка.</summary>
    Task<HubTicketObjectList> GetTicketObjectsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// POST /tickets/requests — создание заявки (CreateRequestBody backend'а);
    /// status=not_started и source=manual клиент шлёт как веб-форма.
    /// 201 → созданная заявка, 422 → HubApiException с текстом валидации.
    /// </summary>
    Task<HubTicketRequest> CreateTicketRequestAsync(
        HubCreateTicketRequest request,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/employees?search=&page_size= — справочник сотрудников билетов.</summary>
    Task<HubTicketEmployeePage> GetTicketEmployeesAsync(
        string? search,
        int pageSize,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/employees/zup-search?q=&limit= — поиск людей в ЗУП для формы
    /// заявки; выбранного импортируют через EnsureTicketEmployeeFromZupAsync.
    /// </summary>
    Task<HubTicketZupPersonList> SearchTicketZupEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /tickets/employees/from-zup {employee_code} — создать/обновить сотрудника
    /// билетов из ЗУП; возвращает запись (id нужен для создания заявки).
    /// </summary>
    Task<HubTicketEmployee> EnsureTicketEmployeeFromZupAsync(
        string employeeCode,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /tickets/requests/{id}/attachments — multipart file + file_type
    /// (itinerary|pdf_ticket|receipt|voucher|other; ≤20 МБ, ≤10 файлов на заявку).
    /// </summary>
    Task<HubTicketAttachment> UploadTicketAttachmentAsync(
        long requestId,
        string fileName,
        Stream content,
        string fileType,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /tickets/requests/{id}/attachments/{attachment_id} → 204.
    /// Право tickets.write; backend пишет attachment_deleted в историю заявки.
    /// </summary>
    Task DeleteTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/kanban?object_ids=&assignee_ids= — доска заявок: словарь
    /// «русское имя колонки» → карточки (фильтры — csv id, как в веб-канбане).
    /// </summary>
    Task<IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>> GetTicketKanbanAsync(
        string? objectIds,
        string? assigneeIds,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/dashboard — сводка: metrics, per_object, top_problems/top_assignees.</summary>
    Task<HubTicketsDashboard> GetTicketDashboardAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/objects?include_inactive= — справочник объектов целиком:
    /// include_inactive=true отдаёт и отключённые (управление справочником в вебе).
    /// </summary>
    Task<HubTicketObjectList> GetTicketObjectsAsync(
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /tickets/objects → созданный объект (tickets.write; сервер дополнительно
    /// требует роль admin — fail-closed и в клиенте). Веб шлёт только {name}.
    /// </summary>
    Task<HubTicketObject> CreateTicketObjectAsync(
        HubTicketObjectUpsert request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /tickets/objects/{id} — только заданные поля (tickets.write + admin).
    /// 403 без admin, 404/422 — HubApiException с detail в Message.
    /// </summary>
    Task<HubTicketObject> UpdateTicketObjectAsync(
        long objectId,
        HubTicketObjectUpsert request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/employees/{id} → карточка с documents и date_of_birth.
    /// Без tickets.personal_data.read личные поля замаскированы «** **** ******».
    /// </summary>
    Task<HubTicketEmployeeDetail> GetTicketEmployeeAsync(
        long employeeId,
        CancellationToken cancellationToken);

    /// <summary>POST /tickets/employees → созданный сотрудник с документами (tickets.write).</summary>
    Task<HubTicketEmployeeDetail> CreateTicketEmployeeAsync(
        HubTicketEmployeeUpsert request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /tickets/employees/{id} — правка полей/текущего документа (tickets.write).
    /// Документ с id правится, без id — создаётся; маскированные значения не шлём.
    /// </summary>
    Task<HubTicketEmployeeDetail> UpdateTicketEmployeeAsync(
        long employeeId,
        HubTicketEmployeeUpsert request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /tickets/import/upload — multipart file (.xlsx, ≤50 МБ — лимит backend'а)
    /// → job {id,file_name,status}. Только tickets.write; 413/422 — HubApiException.
    /// </summary>
    Task<HubTicketImportJob> UploadTicketImportAsync(
        string fileName,
        Stream content,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/import/{job}/preview → листы с классификацией и color_map
    /// (tickets.write). 404 — job не найден, 409 — статус не uploaded/previewed.
    /// </summary>
    Task<HubTicketImportPreview> GetTicketImportPreviewAsync(
        string jobId,
        CancellationToken cancellationToken);

    /// <summary>POST /tickets/import/{job}/execute → счётчики и детали результата (tickets.write).</summary>
    Task<HubTicketImportResult> ExecuteTicketImportAsync(
        string jobId,
        HubTicketImportExecute request,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/financial-ops — финоперации с фильтрами и page-пагинацией (tickets.read).</summary>
    Task<HubTicketFinancialOpPage> GetTicketFinancialOpsAsync(
        HubTicketFinOpQuery query,
        CancellationToken cancellationToken);

    /// <summary>POST /tickets/financial-ops → созданная операция (tickets.write; 422 при невалидных полях).</summary>
    Task<HubTicketFinancialOp> CreateTicketFinancialOpAsync(
        HubTicketFinancialOpUpsert request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /tickets/financial-ops/{id} → обновлённая операция (tickets.write;
    /// сервер разрешает amount/reason/refund_status/op_date/op_type).
    /// </summary>
    Task<HubTicketFinancialOp> UpdateTicketFinancialOpAsync(
        long opId,
        HubTicketFinancialOpUpsert request,
        CancellationToken cancellationToken);

    /// <summary>DELETE /tickets/financial-ops/{id} → 204; мягкое удаление на сервере (tickets.write).</summary>
    Task DeleteTicketFinancialOpAsync(
        long opId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/reports/losses — отчёт потерь: items + totals{total_losses,
    /// total_refunds,balance} + pagination (tickets.read; период ≤366 дней, ≤50/стр).
    /// </summary>
    Task<HubTicketLossReport> GetTicketLossesReportAsync(
        HubTicketLossesQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/reports/losses/export — xlsx-поток в destination
    /// (tickets.write). Возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> ExportTicketLossesAsync(
        HubTicketLossesQuery query,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /tickets/reports/requests/export — xlsx-поток заявок в destination
    /// (tickets.write). Фильтры как у списка: statuses/object_ids/search/sort_*.
    /// </summary>
    Task<string> ExportTicketRequestsAsync(
        HubTicketQuery query,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/notifications/rules → {items} (tickets.write).</summary>
    Task<HubTicketNotificationRuleList> GetTicketNotificationRulesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /tickets/notifications/rules/{id} — только изменённые поля
    /// (tickets.write; сервер дополнительно требует admin — 403 без роли).
    /// </summary>
    Task<HubTicketNotificationRule> UpdateTicketNotificationRuleAsync(
        long ruleId,
        HubTicketNotificationRulePatch patch,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/notifications/pending → {items} отложенных SLA-уведомлений (tickets.read).</summary>
    Task<HubTicketPendingNotificationList> GetTicketPendingNotificationsAsync(CancellationToken cancellationToken);

    /// <summary>POST /tickets/notifications/{id}/dismiss → 204: скрыть уведомление (tickets.read).</summary>
    Task DismissTicketNotificationAsync(
        string notificationId,
        CancellationToken cancellationToken);

    // ---- Адресная книга ----

    /// <summary>
    /// GET /address-book/search?q=&limit=&offset=&department=&city= —
    /// серверный поиск с offset-пагинацией (has_more). Права на личные поля
    /// решает сервер; клиент только читает присланное.
    /// </summary>
    Task<HubAddressBookPage> SearchAddressBookAsync(
        HubAddressBookQuery query,
        CancellationToken cancellationToken);

    /// <summary>GET /address-book/filters — справочники подразделений/городов для фильтров.</summary>
    Task<HubAddressBookFilters> GetAddressBookFiltersAsync(CancellationToken cancellationToken);

    // ---- Структура компании ----

    /// <summary>
    /// GET /company-structure/tree?include_inactive= — дерево подразделений целиком:
    /// дети вложены в children узла, поуровневых запросов у контракта нет.
    /// </summary>
    Task<HubCompanyStructureTree> GetCompanyStructureTreeAsync(
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /company-structure/nodes/{id}/people?limit=&include_descendants= —
    /// сотрудники узла (веб: limit=2000, include_descendants=true — люди
    /// вложенных подразделений тоже попадают в выдачу).
    /// </summary>
    Task<HubCompanyStructurePeople> GetCompanyStructureNodePeopleAsync(
        string nodeId,
        int limit,
        bool includeDescendants,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /company-structure/search?q=&limit= — поиск по узлам и сотрудникам
    /// (веб ищет от 2 символов; backend принимает от 1, limit ≤ 100).
    /// </summary>
    Task<HubCompanyStructureSearchResult> SearchCompanyStructureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    // ---- ИТ-объекты ----

    /// <summary>
    /// GET /it-objects?q=&mine=&hidden= — список ИТ-объектов. q — подстрока
    /// имени (без учёта регистра), mine — только объекты, где я айтишник,
    /// hidden — добавить скрытые (учитывается только при it_objects.manage).
    /// Серверной пагинации нет: вся выдача в одном ответе (items[]).
    /// </summary>
    Task<HubItObjectList> GetItObjectsAsync(
        string? query,
        bool onlyMine,
        bool includeHidden,
        CancellationToken cancellationToken);

    /// <summary>GET /it-objects/{objectRef} — карточка объекта: реквизиты, доступы, команда, гранты.</summary>
    Task<HubItObjectDetail> GetItObjectAsync(
        string objectRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/computers — состав объекта: компьютеры с «мобильным»
    /// набором полей. Требует доступ к разделу computers (владелец/грант/admin).
    /// </summary>
    Task<HubItObjectComputersPage> GetItObjectComputersAsync(
        string objectRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/computers/{macAddress} — карточка компьютера
    /// объекта: тот же mobile-safe detail payload, что GET /inventory/computers/{mac}
    /// (backend проецирует _project_mobile_computer detail=True — HubComputer).
    /// Требует доступ к разделу computers объекта.
    /// </summary>
    Task<HubComputer> GetItObjectComputerAsync(
        string objectRef,
        string macAddress,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/inventory?page=&limit= — оборудование филиала
    /// объекта (серверная пагинация page/limit/pages). Требует раздел inventory.
    /// </summary>
    Task<HubItObjectInventoryPage> GetItObjectInventoryAsync(
        string objectRef,
        int page,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/monitoring — обзор устройств мониторинга
    /// объекта (targets[] с текущим состоянием и эпизодами обрывов).
    /// Требует раздел monitoring.
    /// </summary>
    Task<HubItObjectMonitoringOverview> GetItObjectMonitoringAsync(
        string objectRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/monitoring/targets/{targetId}/latency-history?hours=
    /// — история задержки устройства мониторинга объекта (points[]; latency_ms
    /// null — недоступность/разрыв графика). Требует раздел monitoring (уровень
    /// view — тот же, что и у обзора: backend проверяет через _scoped_read).
    /// </summary>
    Task<HubMonitoringLatencyHistory> GetItObjectMonitoringLatencyHistoryAsync(
        string objectRef,
        string targetId,
        int hours,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/netmap/versions — read-only список версий
    /// схемы карты сети (items[] по version desc; деталь версии с XML drawio —
    /// отдельный endpoint, в нативный срез не входит). Требует раздел netmap.
    /// </summary>
    Task<HubItObjectNetmapVersionsResponse> GetItObjectNetmapVersionsAsync(
        string objectRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /it-objects/{objectRef}/passwords/audit?limit= — журнал аудита
    /// секретов объекта (items[]: кто и когда создавал/менял/архивировал/
    /// раскрывал записи; сами значения не отдаются). Backend требует
    /// manage-доступ к разделу passwords — клиент вызывает только при
    /// my_access.sections["passwords"] == "manage".
    /// </summary>
    Task<HubItObjectPasswordAuditResponse> GetItObjectPasswordsAuditAsync(
        string objectRef,
        int limit,
        CancellationToken cancellationToken);

    // ---- Сети ----

    /// <summary>
    /// GET /networks/branches?city= — филиалы сети города с агрегатными
    /// счётчиками (устройства/порты/розетки/карты/точки). Пагинации нет:
    /// весь список приходит одним ответом.
    /// </summary>
    Task<HubNetworkBranchList> GetNetworkBranchesAsync(
        string? city,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /networks/branches/{id}/overview — реквизиты филиала (branch),
    /// метрики (metrics) и площадки (sites).
    /// </summary>
    Task<HubNetworkOverview> GetNetworkBranchOverviewAsync(
        long branchId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /networks/branches/{id}/devices — оборудование филиала
    /// (network_devices + site + счётчики портов).
    /// </summary>
    Task<HubNetworkDeviceList> GetNetworkDevicesAsync(
        long branchId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /networks/branches/{id}/maps — метаданные файлов-схем филиала
    /// (без blob: файл качается отдельным запросом).
    /// </summary>
    Task<HubNetworkMapList> GetNetworkMapsAsync(
        long branchId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /networks/maps/{id}/file?render= — тело файла карты стримится
    /// в destination; возвращает имя из Content-Disposition.
    /// render=original — исходный blob; auto — PDF отдаётся первой страницей PNG.
    /// </summary>
    Task<string> DownloadNetworkMapFileAsync(
        long mapId,
        string? render,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /networks/maps/{id}/export-pdf — карта с нанесёнными точками в PDF
    /// (attachment), стримится в destination; возвращает имя файла.
    /// </summary>
    Task<string> DownloadNetworkMapPdfAsync(
        long mapId,
        Stream destination,
        CancellationToken cancellationToken);

    // ---- Компьютеры ----

    /// <summary>
    /// GET /inventory/computers/search — серверный поиск компьютеров с
    /// offset-пагинацией (limit/offset + has_more/next_offset). Фильтры — как
    /// у веб-страницы Computers.jsx: scope, q + search_fields, status,
    /// outlook_status, branch, changed_only, hidden_only, hide_vm_172, сортировка.
    /// Клиент всегда шлёт mobile_safe=true и include_summary=false — нативная
    /// выдача ограничена _MOBILE_COMPUTER_LIST_FIELDS.
    /// </summary>
    Task<HubComputersPage> SearchComputersAsync(
        HubComputersQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /inventory/computers/{mac}?scope=&mobile_safe=true — карточка
    /// компьютера по MAC-адресу: списочные поля + последний отчёт, база,
    /// инвентаризация, IP-список, железо, нагрузки, Outlook и bounded-коллекции
    /// дисков/сетевых устройств (_MOBILE_COMPUTER_DETAIL_FIELDS).
    /// </summary>
    Task<HubComputer> GetComputerDetailAsync(
        string macAddress,
        string? scope,
        CancellationToken cancellationToken);

    // ---- База ITINVENT ----

    /// <summary>
    /// GET /equipment/search/universal?q=&field=&type_no=&page=&limit= —
    /// серверный поиск оборудования с пагинацией (page/pages + total).
    /// field — allowlist бэкенда (serial, model, inv_no, part_no, employee,
    /// branch, location, status, vendor, type, ip, mac, netbios); пустое
    /// значение — поиск по всем полям. Пустой q без type_no — пустая выдача,
    /// поэтому фильтр типа отдельным параметром (как в веб-странице Database).
    /// </summary>
    Task<HubEquipmentSearchPage> SearchEquipmentAsync(
        HubEquipmentSearchQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/{inv_no} — карточка оборудования по инвентарному номеру
    /// (в ITINVENT INV_NO — float; сервер сам приводит параметр через float()).
    /// </summary>
    Task<HubEquipmentItem> GetEquipmentByInvAsync(
        string invNo,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/{item_id}/photos — метаданные фото карточки.
    /// Бинарный контент снимков — Bearer-файлы, в read-срез не входит:
    /// используется только счётчик/флаги верификации.
    /// </summary>
    Task<HubEquipmentPhotoList> GetEquipmentPhotosAsync(
        long itemId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/{item_id}/photos — простая multipart-загрузка фото
    /// (database.write): одно поле формы «file», description уходит
    /// query-параметром. Лимит бэкенда — 15 МБ; большие файлы надёжнее
    /// чанками (CreateEquipmentPhotoUploadSessionAsync).
    /// </summary>
    Task<HubEquipmentPhotoUploadResult> UploadEquipmentPhotoAsync(
        long itemId,
        string fileName,
        byte[] content,
        string? mimeType,
        string? description,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/{item_id}/photo-uploads — сессия чанковой загрузки
    /// (database.write). client_id делает её идемпотентной: повтор с тем же id
    /// возвращает текущее состояние (в т.ч. уже завершённую — с file_no).
    /// </summary>
    Task<HubEquipmentPhotoUploadSession> CreateEquipmentPhotoUploadSessionAsync(
        long itemId,
        HubEquipmentPhotoUploadSessionCreate request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /equipment/photo-uploads/{upload_id}/chunks/{chunk_index} — кусок
    /// файла телом octet-stream (256 КБ, последний — остаток). Порядок и
    /// повторы свободны; ответ — актуальное состояние сессии.
    /// </summary>
    Task<HubEquipmentPhotoUploadSession> UploadEquipmentPhotoChunkAsync(
        string uploadId,
        int chunkIndex,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/photo-uploads/{upload_id}/complete — сборка и вставка
    /// фото в FILES. Повтор на завершённой сессии отдаёт исходный результат.
    /// </summary>
    Task<HubEquipmentPhotoUploadResult> CompleteEquipmentPhotoUploadAsync(
        string uploadId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/{item_id}/photos/{file_no}/verify — отметка «проверено»
    /// (database.photo_verify). Ответ — карточка фото, как в списке.
    /// </summary>
    Task<HubEquipmentPhoto> VerifyEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/{item_id}/photos/{file_no}/reject — отклонение фото
    /// (database.photo_verify), тело {reason} обязательно (до 500 символов).
    /// </summary>
    Task<HubEquipmentPhoto> RejectEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /equipment/{item_id}/photos/{file_no}/reject — правка причины
    /// отклонения уже отклонённого фото (database.photo_verify).
    /// </summary>
    Task<HubEquipmentPhoto> UpdateEquipmentPhotoRejectReasonAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/{item_id}/photos/{file_no}/rotate — поворот снимка по
    /// часовой на 90/180/270 (database.write или database.photo_verify).
    /// Контент и миниатюра меняются на сервере — кэш картинок сбрасываем
    /// сменой query-параметра у /content.
    /// </summary>
    Task<HubEquipmentPhotoRotateResult> RotateEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        int degrees,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/{inv_no}/history — история перемещений CI_HISTORY:
    /// сотрудник/филиал/локация old→new, пользователь, комментарий.
    /// </summary>
    Task<HubEquipmentHistoryResponse> GetEquipmentHistoryAsync(
        string invNo,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/employee/{owner_no}/items?employee_name= — вся техника
    /// владельца (EquipmentSearchResponse). employee_name сервер использует
    /// для resolve владельца в других базах (all_databases не шлём).
    /// </summary>
    Task<HubEmployeeItemsResponse> GetEmployeeItemsAsync(
        long ownerNo,
        string? employeeName,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/employee/{owner_no}/history?direction=&q=&page=&limit= —
    /// движения техники по сотруднику: direction all|incoming|outgoing,
    /// q — подстрока модели/инв./серийного номера, page-пагинация + total.
    /// </summary>
    Task<HubEmployeeHistoryResponse> GetEmployeeHistoryAsync(
        long ownerNo,
        string? direction,
        string? q,
        int page,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/types — справочник типов для фильтра поиска
    /// (ci_type: 1 — оборудование, 4 — расходники; в срез берём только 1).
    /// </summary>
    Task<IReadOnlyList<HubEquipmentType>> GetEquipmentTypesAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/search/employee?q=&page=1&limit= — подбор сотрудника
    /// для диалога передачи (ФИО или отдел, серверная пагинация).
    /// </summary>
    Task<HubEquipmentEmployeePage> SearchEquipmentEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET /equipment/branches — справочник филиалов для передачи.</summary>
    Task<IReadOnlyList<HubEquipmentBranch>> GetEquipmentBranchesAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/locations/{branch_id} — справочник локаций; бэкенд
    /// отдаёт полный справочник с приоритетом локаций выбранного филиала.
    /// Пустой branch_id — плоский список /equipment/locations.
    /// </summary>
    Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentLocationsAsync(
        string? branchId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/locations?branch_no=&only_branch=true — только локации
    /// выбранного филиала (LOC_BRANCH или занятые его техникой): как
    /// getLocations(branchNo, {onlyBranch: true}) в веб-формах карточки.
    /// </summary>
    Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentBranchLocationsAsync(
        string branchId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/statuses — справочник статусов карточки для редактора.
    /// </summary>
    Task<IReadOnlyList<HubEquipmentStatus>> GetEquipmentStatusesAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/models?type_no=&ci_type=1 — модели выбранного типа;
    /// ответ — обёртка {models:[]}, как getModels в веб-справочниках.
    /// </summary>
    Task<IReadOnlyList<HubEquipmentModel>> GetEquipmentModelsAsync(
        int typeNo,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/owners/search?q=&limit= — подбор владельца в форме
    /// карточки (ФИО или отдел; как searchOwners в веб-диалоге «Добавить»).
    /// </summary>
    Task<IReadOnlyList<HubEquipmentOwner>> SearchEquipmentOwnersAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/transfer — перемещение оборудования другому сотруднику
    /// (права database.write). Ответ job-based: queued/processing досматриваются
    /// через GetTransferActJobAsync; operation_id — idempotency-key клиента.
    /// </summary>
    Task<HubTransferExecuteResponse> TransferEquipmentAsync(
        HubEquipmentTransferRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/transfer/location — перемещение позиций в другой
    /// филиал/локацию без смены владельца и без актов (права database.write).
    /// Ответ job-based: та же TransferExecuteResponse, поллинг —
    /// GetTransferActJobAsync; operation_id — обязательный idempotency-key.
    /// </summary>
    Task<HubTransferExecuteResponse> TransferEquipmentLocationAsync(
        HubTransferLocationRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/transfer/act-jobs/{job_id} — статус фонового job передачи:
    /// та же TransferExecuteResponse (done/failed — терминальные).
    /// </summary>
    Task<HubTransferExecuteResponse> GetTransferActJobAsync(
        string jobId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/transfer/act/{act_id} — файл акта (pdf): тело стримится
    /// в destination, возвращается имя из Content-Disposition (может быть пустым).
    /// </summary>
    Task<string> DownloadTransferActAsync(
        string actId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/transfer/act-only — акт(ы) по выбранным позициям БЕЗ
    /// смены владельца/филиала/локации (database.write): «кто выдал» —
    /// issuer_employee (+issuer_owner_no из справочника), получатель в акте —
    /// текущий владелец позиции. Тот же job-флоу: поллинг GetTransferActJobAsync.
    /// </summary>
    Task<HubTransferExecuteResponse> TransferActOnlyAsync(
        HubTransferActOnlyRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/acts/upload/parse — распознать PDF подписанного акта
    /// (database.write): multipart-поле file; manualMode=true добавляет
    /// ?manual_mode=true (черновик без распознавания). Таймаут длинный — как у веба.
    /// </summary>
    Task<HubUploadedActDraft> ParseUploadedActAsync(
        string fileName,
        byte[] content,
        bool manualMode,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/acts/upload/commit — запись загруженного акта
    /// (database.write): DOCS+FILES и привязка позиций по inv-номерам;
    /// reminder_id/source_task_id в теле привязывают акт к reminder-задаче.
    /// </summary>
    Task<HubUploadedActCommitResult> CommitUploadedActAsync(
        HubUploadedActCommitRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/transfer/reminders/{reminder_id} — персистентное
    /// напоминание «загрузить подписанные акты» (database.write): задача,
    /// сотрудник-получатель, pending/completed группы позиций.
    /// </summary>
    Task<HubTransferActReminder> GetTransferReminderAsync(
        string reminderId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/acts/upload/email — письмо с записанным актом
    /// (database.write): mode=auto резолвит получателей по ФИО акта,
    /// mode=selected — по списку owner_nos.
    /// </summary>
    Task<HubUploadedActEmailResult> SendUploadedActEmailAsync(
        HubUploadedActEmailRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/acts/{doc_no}/file — файл записанного акта: тело стримится
    /// в destination, возвращается имя из Content-Disposition (может быть пустым).
    /// </summary>
    Task<string> DownloadEquipmentActFileAsync(
        long docNo,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /equipment/{inv_no} — точечная правка карточки (database.write):
    /// только изменённые поля diff'а; ответ — обновлённая карточка целиком
    /// (та же форма, что у GET /equipment/{inv_no}).
    /// </summary>
    Task<HubEquipmentItem> UpdateEquipmentAsync(
        string invNo,
        HubEquipmentUpdateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/create — новая позиция ITEMS (database.write): сервер
    /// создаёт владельца/модель при отсутствии, присваивает inv_no и шлёт его
    /// в ответе. MAC-адрес нормализуется и валидируется на сервере.
    /// </summary>
    Task<HubEquipmentCreateResult> CreateEquipmentAsync(
        HubEquipmentCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /equipment/consumables/lookup?only_positive_qty=&limit= — справочник
    /// складских расходников (CI_TYPE=4) с остатком и адресом; в вебе экран МФУ
    /// грузит его отдельно от SNMP-снабженцев (у SNMP-строк нет item_id/inv_no).
    /// </summary>
    Task<IReadOnlyList<HubConsumableLookupItem>> GetConsumablesLookupAsync(
        bool onlyPositiveQty,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/consumables/consume — списание остатка (database.write):
    /// позиция по item_id (иначе inv_no), qty ≥ 1. С operation_id уходит
    /// durable-путь сервера (idempotency-key, как у transfer).
    /// </summary>
    Task<HubConsumableConsumeResponse> ConsumeConsumableAsync(
        HubConsumableConsumeRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /equipment/consumables/qty — точная установка остатка
    /// (database.write): позиция по item_id (иначе inv_no), qty ≥ 0.
    /// </summary>
    Task<HubConsumableQtyUpdateResponse> UpdateConsumableQtyAsync(
        HubConsumableQtyUpdateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /equipment/consumables/create — новая позиция CI_TYPE=4
    /// (database.write): branch_no/loc_no/type_no/qty обязательны, модель —
    /// model_no или свободный model_name (сервер создаст при отсутствии).
    /// </summary>
    Task<HubConsumableCreateResponse> CreateConsumableAsync(
        HubConsumableCreateRequest request,
        CancellationToken cancellationToken);

    // ---- Доступ к группам AD ----

    /// <summary>
    /// GET /groups-access/status — состояние фонового снимка AD-матрицы:
    /// status/last_sync_at/error, summary{group_count,user_count}, branches[].
    /// Право чтения — groups_access.read; POST /refresh (admin) в read-срез не входит.
    /// </summary>
    Task<HubGroupsAccessStatus> GetGroupsAccessStatusAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /groups-access/matrix-grid?branch=&folder_q=&user_q=&group_limit=&user_limit= —
    /// матрица доступа: колонки-группы, строки-учётки, разреженные ячейки
    /// [login, group_dn, access_level] и summary с флагами усечения.
    /// </summary>
    Task<HubGroupsAccessMatrixGrid> GetGroupsAccessMatrixGridAsync(
        HubGroupsAccessMatrixQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /groups-access/group?dn= — карточка группы AD и её участники
    /// (members[] из снимка). 404 «группа вне снимка» → HubApiException.
    /// </summary>
    Task<HubGroupsAccessGroupDetail> GetGroupsAccessGroupDetailAsync(
        string groupDn,
        CancellationToken cancellationToken);

    // ---- Терминалы ВКС ----

    /// <summary>
    /// GET /vcs/computers — список терминалов ВКС (плоский массив, пагинации нет).
    /// Право чтения — vcs.read; добавление/правка терминалов в срез не входят.
    /// </summary>
    Task<IReadOnlyList<HubVcsComputer>> GetVcsComputersAsync(CancellationToken cancellationToken);

    /// <summary>
    /// POST /vcs/computers/{id}/launch-token → {token, expires_in_seconds} —
    /// одноразовый токен (TTL сервера ~60 c) на GET /vcs/launch/{token}.vnc.
    /// Требует vcs.manage — без права сервер отвечает 403 (HubApiException).
    /// </summary>
    Task<HubVcsLaunchToken> CreateVcsLaunchTokenAsync(
        string computerId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /vcs/computers {name, ip_address, location} → созданный терминал.
    /// Право — vcs.manage; 422 при нарушении ограничений (name ≤ 100,
    /// ip_address 7..50) — HubApiException с текстом сервера.
    /// </summary>
    Task<HubVcsComputer> CreateVcsComputerAsync(
        HubVcsComputerInput computer,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /vcs/computers/{id} {name, ip_address, location} → обновлённый
    /// терминал (как в вебе, шлём все поля формы). 404 «Computer not found»
    /// и 403 без vcs.manage — HubApiException.
    /// </summary>
    Task<HubVcsComputer> UpdateVcsComputerAsync(
        string computerId,
        HubVcsComputerInput computer,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /vcs/computers/{id} → {"success": true}; 404 — HubApiException.
    /// Требует vcs.manage.
    /// </summary>
    Task DeleteVcsComputerAsync(
        string computerId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /vcs/computers/order {"order": [id, …]} — порядок карточек целиком;
    /// маршрут сервера объявлен до /computers/{id}, «order» с id не путается.
    /// Требует vcs.manage.
    /// </summary>
    Task UpdateVcsComputersOrderAsync(
        IReadOnlyList<string> orderedIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /vcs/config → {password_hex: "", password_configured}: сервер не
    /// отдаёт сохранённый секрет — только флаг. Право чтения — vcs.read.
    /// </summary>
    Task<HubVcsConfig> GetVcsConfigAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PUT /vcs/config {"password_hex": "…"} → актуальный {password_configured};
    /// пустая строка — сброс пароля. Требует vcs.manage.
    /// </summary>
    Task<HubVcsConfig> UpdateVcsConfigAsync(
        string passwordHex,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /vcs/info → {content} — текст инфо-блока ВКС; без vcs.manage сервер
    /// вырезает поля password из JSON-таблицы. Право чтения — vcs.read.
    /// </summary>
    Task<HubVcsInfo> GetVcsInfoAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PUT /vcs/info {"content": "…"} → сохранённый текст. Требует vcs.manage.
    /// </summary>
    Task<HubVcsInfo> UpdateVcsInfoAsync(
        string content,
        CancellationToken cancellationToken);

    // ---- Мониторинг ----

    /// <summary>
    /// GET /monitoring/overview — цели с текущим состоянием, эпизодами
    /// обрывов (outages) и карточной сводкой трафика (summary), плюс
    /// состояние сборщика (worker). Право чтения — monitoring.read.
    /// </summary>
    Task<HubMonitoringOverview> GetMonitoringOverviewAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /monitoring/targets/{id} — деталь цели: interfaces[] с текущими
    /// счётчиками и events[] журнала (до 50 последних). 404 — HubApiException.
    /// </summary>
    Task<HubMonitoringTarget> GetMonitoringTargetAsync(
        string targetId,
        CancellationToken cancellationToken);

    // ---- МФУ и принтеры ----

    /// <summary>
    /// GET /mfu/devices?period_days=&recent_limit=&limit= — снимок парка
    /// МФУ/принтеров/плоттеров выбранной БД: нормализованные поля инвентаря,
    /// runtime ping/SNMP (расходники, лотки, счётчик страниц) и maintenance{}
    /// по журналу работ. Ответ сгруппирован {филиал → локация → [devices]}.
    /// Право чтения — mfu.read; запись работ в срез не входит.
    /// </summary>
    Task<HubMfuDeviceList> GetMfuDevicesAsync(
        int periodDays,
        int recentLimit,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mfu/pages/monthly?device_key=&months= — печать по месяцам
    /// (months[]: month «YYYY-MM», printed_pages, start/end счётчика,
    /// reset_detected) и текущий SNMP-счётчик. device_key — поле key устройства
    /// («db|item id»). 404 — HubApiException.
    /// </summary>
    Task<HubMfuMonthlyPages> GetMfuMonthlyPagesAsync(
        string deviceKey,
        int months,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/mfu/statistics?period_days= — статистика журнальных
    /// работ МФУ за период: итоги, разрезы по типам/расходникам/филиалам/
    /// локациям/моделям и последние замены. Право чтения — mfu.read.
    /// </summary>
    Task<HubMfuWorksStatistics> GetMfuWorksStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken);

    // ---- Статистика работ ----

    /// <summary>
    /// GET /json/works/cleaning/statistics?period_days= — покрытие чистки ПК
    /// по филиалам за период (итоги + branches[]). Право чтения — database.read.
    /// </summary>
    Task<HubPcCleaningStatistics> GetPcCleaningStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/battery/statistics?period_days= — замены батарей ИБП
    /// из JSON-журнала за период: итоги, разрезы и последние записи.
    /// Право чтения — database.read.
    /// </summary>
    Task<HubBatteryStatistics> GetBatteryStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/pc-components/statistics?period_days= — замены
    /// комплектующих ПК из JSON-журнала за период. Право чтения — database.read.
    /// </summary>
    Task<HubPcComponentsStatistics> GetPcComponentsStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken);

    // ---- Журнал работ по карточке оборудования (/json/works*) ----

    /// <summary>
    /// GET /json/works/cartridge/history?serial_number=&hw_serial_number=&inv_no=
    /// &cartridge_model= — сводка замен картриджа по оборудованию
    /// {last_date, count, time_ago_str}. Пустые параметры в запрос не идут.
    /// Право чтения — database.read.
    /// </summary>
    Task<HubMaintenanceHistory> GetCartridgeWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        string? cartridgeModel,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/battery/history?serial_number=&hw_serial_number= —
    /// сводка замен батареи по серийнику. Право чтения — database.read.
    /// </summary>
    Task<HubMaintenanceHistory> GetBatteryWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/component/history?serial_number=&hw_serial_number=
    /// &component_type=&component_name= — сводка замен комплектующих
    /// (объединённые записи ПК- и принтер-компонентов). Право — database.read.
    /// </summary>
    Task<HubMaintenanceHistory> GetComponentWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? componentType,
        string? componentName,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/cleaning/history?serial_number=&hw_serial_number=&inv_no=
    /// &equipment_id= — сводка чисток ПК по оборудованию. Право — database.read.
    /// </summary>
    Task<HubMaintenanceHistory> GetCleaningWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        long? equipmentId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/cartridge?limit= — последние записи журнала картриджей
    /// (серверного фильтра по серийнику у эндпоинта нет — поток фильтруем
    /// клиентом по serial/hw_serial/inv_no, как _record_matches_serial бэкенда).
    /// Право — database.read.
    /// </summary>
    Task<IReadOnlyList<HubCartridgeWorkRecord>> GetCartridgeWorksAsync(
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/battery?serial_number=&limit= — записи журнала батарей;
    /// serial_number опционален (точное совпадение serial_number|serial_no).
    /// Право — database.read.
    /// </summary>
    Task<IReadOnlyList<HubBatteryWorkRecord>> GetBatteryWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/component?serial_number=&limit= — записи журнала
    /// комплектующих (объединённый список ПК+принтер). Право — database.read.
    /// </summary>
    Task<IReadOnlyList<HubComponentWorkRecord>> GetComponentWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/cleaning?serial_number=&limit= — записи журнала чисток.
    /// Право — database.read.
    /// </summary>
    Task<IReadOnlyList<HubCleaningWorkRecord>> GetCleaningWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/works/cleaning/statistics/remaining?period_days=&branch= —
    /// ПК филиала без чистки за период (диалог «ПК без чистки» веб-статистики).
    /// branch обязателен на бэкенде (422 при пустом). Право — database.read.
    /// </summary>
    Task<HubPcCleaningRemaining> GetPcCleaningRemainingAsync(
        int periodDays,
        string branch,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /json/cartridges/compatibility/{printer_model} — таблица
    /// совместимости принтера: OEM-картридж, совместимые модели, флаг цвета и
    /// комплектующие. 404 → HubApiException. Требует активную сессию.
    /// </summary>
    Task<HubCartridgeCompatibility> GetCartridgeCompatibilityAsync(
        string printerModel,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /json/works/cartridge → 201 CartridgeReplacementResponse — запись
    /// замены картриджа/принтерной комплектующей в журнал. Право — database.write;
    /// 400 при отказе валидации бэкенда — HubApiException с текстом сервера.
    /// </summary>
    Task<HubCartridgeWorkRecord> RegisterCartridgeWorkAsync(
        HubCartridgeWorkRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /json/works/battery → 201 BatteryReplacementResponse — запись
    /// замены батареи. Право — database.write.
    /// </summary>
    Task<HubBatteryWorkRecord> RegisterBatteryWorkAsync(
        HubBatteryWorkRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /json/works/component → 201 ComponentReplacementResponse — запись
    /// замены комплектующей (ПК — component_replacements.json, принтер —
    /// картриджный файл, решает бэкенд по component_type/equipment_kind).
    /// Право — database.write.
    /// </summary>
    Task<HubComponentWorkRecord> RegisterComponentWorkAsync(
        HubComponentWorkRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /json/works/cleaning → 201 PcCleaningResponse — запись чистки ПК.
    /// Право — database.write.
    /// </summary>
    Task<HubCleaningWorkRecord> RegisterCleaningWorkAsync(
        HubCleaningWorkRequest request,
        CancellationToken cancellationToken);

    // ---- Чат ----

    /// <summary>GET /chat/conversations?limit=&cursor=&q= — курсорная пагинация + серверный поиск.</summary>
    Task<HubChatConversationList> GetChatConversationsAsync(
        string? cursor,
        int limit,
        string? query,
        CancellationToken cancellationToken);

    Task<HubChatMessageList> GetChatMessagesAsync(
        string conversationId,
        string? beforeMessageId,
        string? afterMessageId,
        int limit,
        CancellationToken cancellationToken);

    Task<HubChatMessage> SendChatMessageAsync(
        string conversationId,
        string body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken);

    /// <summary>PATCH /chat/conversations/{id}/messages/{mid} — правка своего сообщения.</summary>
    Task<HubChatMessage> EditChatMessageAsync(
        string conversationId,
        string messageId,
        string body,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/conversations/{id}/messages/{mid} — soft-delete своего сообщения.</summary>
    Task<HubChatMessage> DeleteChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/conversations/{id}/messages/{mid}/reactions — toggle эмодзи.</summary>
    Task<HubChatReactionToggle> ToggleChatMessageReactionAsync(
        string conversationId,
        string messageId,
        string emoji,
        CancellationToken cancellationToken);

    Task MarkChatConversationReadAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /chat/conversations/{id}/settings — флаги pin/mute/archive (null = не трогать).
    /// mutedUntil — срок мьюта (null не меняет текущий muted_until).
    /// Возвращает обновлённый summary диалога.
    /// </summary>
    Task<HubChatConversation> UpdateChatConversationSettingsAsync(
        string conversationId,
        bool? isPinned,
        bool? isMuted,
        bool? isArchived,
        DateTimeOffset? mutedUntil,
        CancellationToken cancellationToken);

    /// <summary>GET …/messages/search?q= — поиск по сообщениям внутри диалога.</summary>
    Task<HubChatMessageSearchResult> SearchChatMessagesAsync(
        string conversationId,
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET …/thread-bootstrap?focus_message_id= — лента вокруг якорного сообщения.</summary>
    Task<HubChatThreadBootstrap> GetChatThreadBootstrapAsync(
        string conversationId,
        string? focusMessageId,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET …/pinned-messages — закреплённые сообщения диалога (превью).</summary>
    Task<HubChatPinnedMessageList> GetChatPinnedMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>PUT …/pinned-messages/{message_id} — закрепить сообщение.</summary>
    Task<HubChatPinnedMessageList> PinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>DELETE …/pinned-messages/{message_id} — открепить сообщение.</summary>
    Task<HubChatPinnedMessageList> UnpinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>POST …/upload-sessions — сессия загрузки файлов к сообщению.</summary>
    Task<HubChatUploadSession> CreateChatUploadSessionAsync(
        string conversationId,
        string? body,
        string? replyToMessageId,
        string? clientMessageId,
        IReadOnlyList<HubChatUploadFileRequest> files,
        CancellationToken cancellationToken);

    /// <summary>PUT …/upload-sessions/{sid}/files/{fid}/chunks/{i}?offset= — сырой чанк.</summary>
    Task<HubChatUploadChunk> UploadChatChunkAsync(
        string sessionId,
        string fileId,
        int chunkIndex,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken);

    /// <summary>POST …/upload-sessions/{sid}/complete — собирает сообщение из сессии.</summary>
    Task<HubChatMessage> CompleteChatUploadSessionAsync(
        string sessionId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET …/messages/{mid}/attachments/{aid}/file — поток файла в destination.
    /// Возвращает имя файла из Content-Disposition (или fallback).
    /// </summary>
    Task<string> DownloadChatAttachmentAsync(
        string messageId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>POST …/messages/forward — пересылка сообщения в этот диалог.</summary>
    Task<HubChatMessage> ForwardChatMessageAsync(
        string conversationId,
        string sourceMessageId,
        string? body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken);

    /// <summary>POST …/messages/{mid}/poll-vote {option_index} — голос/снятие голоса.</summary>
    Task<HubChatPollVoteResult> VoteChatPollAsync(
        string conversationId,
        string messageId,
        int optionIndex,
        CancellationToken cancellationToken);

    /// <summary>POST …/messages/{mid}/poll-close — автор закрывает опрос.</summary>
    Task<HubChatPollVoteResult> CloseChatPollAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>GET /chat/messages/{mid}/reads — список прочитавших.</summary>
    Task<HubChatMessageReads> GetChatMessageReadsAsync(
        string messageId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/link-preview?url= — Open Graph карточка ссылки
    /// (url/title/description/image/site_name; пустые поля, если мета не нашлась).
    /// </summary>
    Task<HubChatLinkPreview> GetChatLinkPreviewAsync(
        string url,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET …/conversations/{id}/attachments?kind=&limit=&before_attachment_id= —
    /// медиагалерея диалога: страница вложений вида image|video|file|audio.
    /// </summary>
    Task<HubChatConversationAttachmentPage> GetChatConversationAttachmentsAsync(
        string conversationId,
        string kind,
        int limit,
        string? beforeAttachmentId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET …/conversations/{id}/export?format=txt|json — история диалога файлом.
    /// Тело стримится в destination; возвращает имя файла и флаг усечения
    /// из Content-Disposition и X-Chat-Export-* заголовков.
    /// </summary>
    Task<HubChatExportResult> ExportChatConversationAsync(
        string conversationId,
        string format,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>GET /chat/messages/search?q= — глобальный поиск по всем диалогам.</summary>
    Task<HubChatGlobalSearchResult> SearchChatGlobalMessagesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/conversations/notes — диалог «Заметки» с самим собой.</summary>
    Task<HubChatConversation> CreateNotesConversationAsync(
        CancellationToken cancellationToken);

    Task<HubChatConversation> CreateDirectConversationAsync(
        int peerUserId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/group {title, member_user_ids} — создатель становится owner.
    /// Бэкенд требует минимум одного участника помимо создателя.
    /// </summary>
    Task<HubChatConversation> CreateChatGroupConversationAsync(
        string title,
        IReadOnlyList<int> memberUserIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id} — detail: members + viewer_member_role.
    /// </summary>
    Task<HubChatConversationDetail> GetChatConversationMembersAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/members {member_user_ids:[userId]} —
    /// добавление участника в группу (owner/moderator). Ответ — свежий detail.
    /// </summary>
    Task<HubChatConversationDetail> AddChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /chat/conversations/{id}/members/{userId} — исключение участника
    /// (owner/moderator; модератор — только member'ов). Ответ — свежий detail.
    /// </summary>
    Task<HubChatConversationDetail> RemoveChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/leave — выход из группы.
    /// Владельцу нужен successor_user_id (передача прав — отдельный endpoint).
    /// </summary>
    Task LeaveChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/ownership {owner_user_id} — передача владения
    /// группой другому участнику (только owner). Ответ — свежий detail:
    /// viewer_member_role вызывающего уже сменилась на moderator.
    /// </summary>
    Task<HubChatConversationDetail> TransferChatConversationOwnershipAsync(
        string conversationId,
        int ownerUserId,
        CancellationToken cancellationToken);

    Task<HubChatUserList> GetChatUsersAsync(string? query, int limit, CancellationToken cancellationToken);

    /// <summary>POST /chat/ws-ticket: короткоживущий тикет для in-socket реавторизации.</summary>
    Task<HubWsTicket> GetChatWsTicketAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /chat/conversations/{id}/members/{userId}/role {member_role}
    /// — назначить/снять модератора (только owner; web допускает только
    /// moderator|member). Ответ — свежий detail.
    /// </summary>
    Task<HubChatConversationDetail> UpdateChatGroupMemberRoleAsync(
        string conversationId,
        int userId,
        string memberRole,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /chat/conversations/{id}/members/{userId}/restriction
    /// {duration_seconds: 3600|86400|604800|null} — запрет писать в группу;
    /// null — бессрочно до снятия. Ответ — свежий detail.
    /// </summary>
    Task<HubChatConversationDetail> RestrictChatGroupMemberAsync(
        string conversationId,
        int userId,
        int? durationSeconds,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /chat/conversations/{id}/members/{userId}/restriction —
    /// снять ограничение на отправку. Ответ — свежий detail.
    /// </summary>
    Task<HubChatConversationDetail> LiftChatGroupMemberRestrictionAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/join-requests → {items, open_count,
    /// approval_required} — заявки на вступление (owner/moderator).
    /// </summary>
    Task<HubChatJoinRequestList> GetChatJoinRequestsAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /chat/conversations/{id}/join-approval {approval_required} —
    /// режим «вступление по заявкам» (owner/moderator).
    /// </summary>
    Task<HubChatJoinApproval> SetChatJoinApprovalAsync(
        string conversationId,
        bool approvalRequired,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /chat/conversations/{id}/join-requests/{requestId} {decision:
    /// approve|reject} — решение по заявке → {id, status, added}.
    /// </summary>
    Task<HubChatJoinRequestResolution> ResolveChatJoinRequestAsync(
        string conversationId,
        long requestId,
        string decision,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/messages/{mid}/report
    /// {reason: spam|abuse|illegal|other, comment?} → {id, status,
    /// already_reported} — повторная жалоба того же пользователя дедупится.
    /// </summary>
    Task<HubChatMessageReportResult> ReportChatMessageAsync(
        string conversationId,
        string messageId,
        string reason,
        string? comment,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/reports → {items, open_count} —
    /// открытые жалобы на сообщения (owner/moderator).
    /// </summary>
    Task<HubChatMessageReportList> GetChatMessageReportsAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /chat/conversations/{id}/reports/{reportId}
    /// {resolution: dismissed|resolved} → {id, status}.
    /// </summary>
    Task<HubChatMessageReportResolution> ResolveChatMessageReportAsync(
        string conversationId,
        long reportId,
        string resolution,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/invite-link → {token, expires_at:
    /// now+7d, conversation_id}. На группу одновременно одна активная
    /// ссылка: создание новой инвалидирует прежнюю.
    /// </summary>
    Task<HubChatInviteLink> CreateChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/conversations/{id}/invite-link → {revoked}.</summary>
    Task<HubChatInviteRevokeResult> RevokeChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/invite-links/{token} — превью группы по ссылке:
    /// conversation_id приходит только уже состоящим участникам.
    /// </summary>
    Task<HubChatInvitePreview> GetChatInviteLinkPreviewAsync(
        string token,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/invite-links/{token}/join → {joined, requested,
    /// request_status, conversation}. При approval_required группа —
    /// requested=true и conversation=null (заявка ждёт решения).
    /// </summary>
    Task<HubChatInviteJoinResult> JoinChatByInviteLinkAsync(
        string token,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /chat/conversations/{id} — удаление диалога владельцем
    /// (группы; direct удаляет backend по своим правилам — web зовёт тот же
    /// endpoint, сервер решает).
    /// </summary>
    Task DeleteChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/conversations/support → summary диалога поддержки.</summary>
    Task<HubChatConversation> CreateChatSupportConversationAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /chat/conversations/{id}/profile — карточка группы: title и
    /// posting_policy/slow_mode_seconds/members_send_files только owner,
    /// description — owner/moderator (web-гейты). null = не менять.
    /// </summary>
    Task<HubChatConversationDetail> UpdateChatGroupProfileAsync(
        string conversationId,
        string? title,
        string? description,
        string? postingPolicy,
        int? slowModeSeconds,
        bool? membersSendFiles,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/avatar — multipart file (image, ≤5 МБ)
    /// → свежий detail с avatar_url. Только owner.
    /// </summary>
    Task<HubChatConversationDetail> UploadChatGroupAvatarAsync(
        string conversationId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/conversations/{id}/avatar → свежий detail.</summary>
    Task<HubChatConversationDetail> DeleteChatGroupAvatarAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/shareable-tasks?q=&limit= — задачи
    /// для «Поделиться задачей» (требует chat.read + tasks.read).
    /// </summary>
    Task<HubChatShareableTaskList> GetChatShareableTasksAsync(
        string conversationId,
        string? query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/messages/task-share
    /// {task_id, client_message_id?, reply_to_message_id?} → сообщение
    /// kind="task_share" с task_preview.
    /// </summary>
    Task<HubChatMessage> SendChatTaskShareAsync(
        string conversationId,
        string taskId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/messages/hydrate?message_ids=a,b,c —
    /// догрузка read_by_count/delivery_status/reactions для уже загруженных
    /// сообщений (после bootstrap-переходов статусы успевают устареть).
    /// </summary>
    Task<HubChatThreadHydrateResult> HydrateChatMessagesAsync(
        string conversationId,
        IReadOnlyList<string> messageIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/config → {group_max_members, scheduled_messages_enabled,
    /// support_user_id} — серверные флаги чата; кешируем на сессию как web
    /// (getChatConfigCached): запрос один раз за загрузку страницы.
    /// </summary>
    Task<HubChatConfig> GetChatConfigAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/scheduled → {items} — свои отложенные
    /// сообщения диалога (status scheduled|sending|failed), по времени отправки.
    /// </summary>
    Task<HubChatScheduledMessageList> GetChatScheduledMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/scheduled {body, body_format, scheduled_for,
    /// reply_to_message_id?} — запланировать текстовое сообщение.
    /// Только текст: файлы/опросы сервер не планирует (как в web).
    /// </summary>
    Task<HubChatScheduledMessage> CreateChatScheduledMessageAsync(
        string conversationId,
        string body,
        DateTimeOffset scheduledFor,
        string? replyToMessageId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /chat/scheduled/{id} {body?, scheduled_for?} — правка текста/времени
    /// своего отложенного (только status scheduled|failed; failed возвращается
    /// в очередь). null-поля сервер игнорирует.
    /// </summary>
    Task<HubChatScheduledMessage> UpdateChatScheduledMessageAsync(
        string scheduledId,
        string? body,
        DateTimeOffset? scheduledFor,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/scheduled/{id} → {id, status: cancelled}.</summary>
    Task<HubChatScheduledCancelResult> CancelChatScheduledMessageAsync(
        string scheduledId,
        CancellationToken cancellationToken);

    // ---- Чат: папки диалогов (/chat/folders*, chat.read / chat.write) ----

    /// <summary>
    /// GET /chat/folders → {items, conversation_ids_by_folder, folder_unread_counts}.
    /// Непрочитанные по системным вкладкам считает сервер (personal/groups/tasks/
    /// archived/ai; архивные и действующие mute не входят — как в web).
    /// </summary>
    Task<HubChatFolderList> GetChatFoldersAsync(
        CancellationToken cancellationToken);

    /// <summary>POST /chat/folders {name} → {ok, item} — новая пользовательская папка.</summary>
    Task<HubChatFolderMutation> CreateChatFolderAsync(
        string name,
        CancellationToken cancellationToken);

    /// <summary>GET /chat/folders/{id} → ChatFolderSummary (с conversation_ids).</summary>
    Task<HubChatFolder> GetChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken);

    /// <summary>PATCH /chat/folders/{id} {name?, sort_order?} → {ok, item}. null = не менять.</summary>
    Task<HubChatFolderMutation> UpdateChatFolderAsync(
        string folderId,
        string? name,
        int? sortOrder,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/folders/{id} → {ok, id} — папка удаляется, диалоги остаются.</summary>
    Task<HubChatFolderDeleteResult> DeleteChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /chat/folders/{id}/conversations {conversation_ids:[…]} — полная замена
    /// членства папки → {ok, item}.
    /// </summary>
    Task<HubChatFolderMutation> ReplaceChatFolderConversationsAsync(
        string folderId,
        IReadOnlyList<string> conversationIds,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/folders/{id}/conversations/{conversation_id} → {ok, item}.</summary>
    Task<HubChatFolderMutation> AddChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/folders/{id}/conversations/{conversation_id} → {ok, item}.</summary>
    Task<HubChatFolderMutation> RemoveChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken);

    // ---- Чат: стикеры (/chat/sticker-packs*, /chat/stickers/*) ----

    /// <summary>
    /// GET /chat/sticker-packs → {items:[{id, short_name, title, sticker_type,
    /// is_added, stickers:[{id, emoji, format, mime_type, file_url, preview_url}]}]} —
    /// добавленные пользователем паки. Превью стикеров качается тем же
    /// DownloadImageAsync (file_url/preview_url — same-origin Bearer-маршруты).
    /// </summary>
    Task<HubChatStickerPackList> GetChatStickerPacksAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/sticker-packs/import {source} → {items} — импорт пака по
    /// ссылке/short_name Telegram (пользовательский жест в web-панели стикеров).
    /// </summary>
    Task<HubChatStickerPackList> ImportChatStickerPackAsync(
        string source,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/sticker-packs/preview/{short_name} → ChatStickerPackResponse —
    /// общий (ещё не добавленный) пак по ссылке.
    /// </summary>
    Task<HubChatStickerPack> GetChatStickerPackPreviewAsync(
        string shortName,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/conversations/{id}/messages/sticker
    /// {sticker_id, client_message_id?, reply_to_message_id?} → ChatMessageResponse.
    /// </summary>
    Task<HubChatMessage> SendChatStickerMessageAsync(
        string conversationId,
        string stickerId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken);

    // ---- Чат: ИИ-ассистент (/chat/ai/*, chat.ai.use) ----

    /// <summary>
    /// GET /chat/ai/bots → {items:[AiBotSummary], configured} — доступные
    /// ассистенты (пустой список/403 без chat.ai.use — раздел скрываем).
    /// </summary>
    Task<HubChatAiBotList> GetChatAiBotsAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/ai/bots/{botId}/open → ChatConversationSummary — открыть
    /// существующий диалог с ботом или создать новый (как web openAiBotConversation).
    /// </summary>
    Task<HubChatConversation> OpenChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/ai/bots/{botId}/conversations → ChatConversationSummary —
    /// «Новый чат с этим помощником» (всегда новый диалог).
    /// </summary>
    Task<HubChatConversation> CreateChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/ai/conversations → ChatConversationSummary — общий чат с
    /// ассистентом без привязки к конкретному боту (web GENERAL_AI_OPENING_ID).
    /// </summary>
    Task<HubChatConversation> CreateChatAiConversationAsync(
        CancellationToken cancellationToken);

    /// <summary>PATCH /chat/ai/conversations/{id} {title} → ChatConversationSummary.</summary>
    Task<HubChatConversation> UpdateChatAiConversationAsync(
        string conversationId,
        string title,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/ai/conversations/{id} → {ok, conversation_id}.</summary>
    Task<bool> DeleteChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/conversations/{id}/ai-status → AiConversationStatusResponse —
    /// прогресс запуска ассистента (опрашиваем, пока queued|running или сокет
    /// не подключён — как shouldPollActiveAiThread в web).
    /// </summary>
    Task<HubChatAiStatus> GetChatAiStatusAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/ai/conversations/{id}/stop → AiConversationStatusResponse.</summary>
    Task<HubChatAiStatus> StopChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/ai/conversations/{id}/retry → AiConversationStatusResponse.</summary>
    Task<HubChatAiStatus> RetryChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/ai/conversations/{id}/reset-context →
    /// {ok, conversation_id, context_reset_seq} — ассистент перестаёт учитывать
    /// старые сообщения (видимыми они остаются).
    /// </summary>
    Task<HubChatAiResetResult> ResetChatAiContextAsync(
        string conversationId,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /chat/ai/actions/{actionId}/confirm {choice?|format?|scope?} →
    /// обновлённый action_card dict (payload как в web onConfirmAction).
    /// </summary>
    Task<HubChatActionCard> ConfirmChatAiActionAsync(
        string actionId,
        string? choice,
        string? format,
        string? scope,
        CancellationToken cancellationToken);

    /// <summary>POST /chat/ai/actions/{actionId}/cancel → обновлённый action_card.</summary>
    Task<HubChatActionCard> CancelChatAiActionAsync(
        string actionId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /chat/ai/memory → {enabled, items, limits} — личная память
    /// ассистента (AiPersonalMemoryManager в web).
    /// </summary>
    Task<HubChatAiMemoryList> GetChatAiMemoryAsync(
        CancellationToken cancellationToken);

    /// <summary>PATCH /chat/ai/memory/settings {enabled} → свежий список памяти.</summary>
    Task<HubChatAiMemoryList> UpdateChatAiMemorySettingsAsync(
        bool enabled,
        CancellationToken cancellationToken);

    /// <summary>PATCH /chat/ai/memory/{id} {content} → AiMemoryItemResponse.</summary>
    Task<HubChatAiMemoryItem> UpdateChatAiMemoryItemAsync(
        string memoryId,
        string content,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/ai/memory/{id} → {ok, id}.</summary>
    Task<HubChatAiMemoryDeleteResult> DeleteChatAiMemoryItemAsync(
        string memoryId,
        CancellationToken cancellationToken);

    /// <summary>DELETE /chat/ai/memory → {ok, deleted_count} — очистить всю память.</summary>
    Task<HubChatAiMemoryDeleteResult> ClearChatAiMemoryAsync(
        CancellationToken cancellationToken);

    // ---- Мои файлы ----

    /// <summary>GET /my-files/libraries → {items, can_manage}: общие папки пользователя.</summary>
    Task<HubMyFileLibraryList> GetMyFileLibrariesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /my-files?folder_id=&library_id= → {items, folders, breadcrumbs, folder, library}:
    /// содержимое корня (оба id null), папки или корня библиотеки (folder_id=null + library_id).
    /// </summary>
    Task<HubMyFileListPage> GetMyFilesAsync(
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken);

    /// <summary>POST /my-files/folders {name, parent_id, library_id} → созданная папка.</summary>
    Task<HubMyFileFolder> CreateMyFileFolderAsync(
        string name,
        string? parentId,
        string? libraryId,
        CancellationToken cancellationToken);

    /// <summary>PATCH /my-files/folders/{id} {name} → переименованная папка.</summary>
    Task<HubMyFileFolder> RenameMyFileFolderAsync(
        string folderId,
        string name,
        CancellationToken cancellationToken);

    /// <summary>PATCH /my-files/{id} {name} → переименованный файл.</summary>
    Task<HubMyFileItem> RenameMyFileAsync(
        string fileId,
        string name,
        CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/folders/{id} → 204: папка уходит в корзину (soft-delete).</summary>
    Task DeleteMyFileFolderAsync(string folderId, CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/{id} → 204: файл уходит в корзину (soft-delete).</summary>
    Task DeleteMyFileAsync(string fileId, CancellationToken cancellationToken);

    /// <summary>
    /// Скачивание файла по реальному контракту: POST /my-files/{id}/download-grant
    /// выдаёт одноразовый download_path, GET по нему стримит тело в destination
    /// (ResponseHeadersRead). Прямой GET /{id}/download на backend отключён (410).
    /// Возвращает имя файла из Content-Disposition (или пустую строку).
    /// </summary>
    Task<string> DownloadMyFileAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /my-files/upload-sessions {file_name, file_size, retention_days,
    /// mime_type, folder_id, library_id} → сессия чанковой загрузки.
    /// reuse_existing на backend: вернёт и незавершённую сессию с ranges для resume.
    /// </summary>
    Task<HubMyFileUploadSession> CreateMyFileUploadSessionAsync(
        HubMyFileUploadSessionCreate request,
        CancellationToken cancellationToken);

    /// <summary>PUT /my-files/upload-sessions/{id}/chunks?offset= — сырой чанк (octet-stream).</summary>
    Task<HubMyFileUploadSession> UploadMyFileChunkAsync(
        string fileId,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken);

    /// <summary>POST /my-files/upload-sessions/{id}/complete → готовый файл (MyFileResponse).</summary>
    Task<HubMyFileItem> CompleteMyFileUploadSessionAsync(
        string fileId,
        CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/upload-sessions/{id}?reason= → 204: отмена сессии загрузки.</summary>
    Task CancelMyFileUploadSessionAsync(
        string fileId,
        string? reason,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /my-files/{id}/share?rotate= → {token, public_path, expires_at}.
    /// rotate=false возвращает действующую ссылку, если она уже есть;
    /// rotate=true выпускает новую и гасит прежнюю.
    /// </summary>
    Task<HubMyFileShare> CreateMyFileShareAsync(
        string fileId,
        bool rotate,
        CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/{id}/share → 204: публичная ссылка файла отозвана.</summary>
    Task RevokeMyFileShareAsync(string fileId, CancellationToken cancellationToken);

    /// <summary>
    /// POST /my-files/folders/{id}/share?rotate= → {token, public_path, expires_at=null}.
    /// Семантика rotate — как у файловой ссылки.
    /// </summary>
    Task<HubMyFileShare> CreateMyFileFolderShareAsync(
        string folderId,
        bool rotate,
        CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/folders/{id}/share → 204: публичная ссылка папки отозвана.</summary>
    Task RevokeMyFileFolderShareAsync(string folderId, CancellationToken cancellationToken);

    // ---- Мои файлы: корзина, квота, копия, архив, предпросмотр, библиотеки ----

    /// <summary>
    /// GET /my-files/trash?library_id= → {items, folders}: удалённые объекты
    /// личного диска (library_id=null) или библиотеки (нужна роль manage).
    /// </summary>
    Task<HubMyFileTrash> GetMyFilesTrashAsync(string? libraryId, CancellationToken cancellationToken);

    /// <summary>POST /my-files/trash/empty?library_id= → 204: корзина очищена навсегда.</summary>
    Task EmptyMyFilesTrashAsync(string? libraryId, CancellationToken cancellationToken);

    /// <summary>POST /my-files/trash/files/{id}/restore → 204: файл возвращён из корзины.</summary>
    Task RestoreMyFileAsync(string fileId, CancellationToken cancellationToken);

    /// <summary>POST /my-files/trash/folders/{id}/restore → 204: папка возвращена из корзины.</summary>
    Task RestoreMyFileFolderAsync(string folderId, CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/trash/files/{id} → 204: файл удалён навсегда.</summary>
    Task PurgeMyFileAsync(string fileId, CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/trash/folders/{id} → 204: папка удалена навсегда.</summary>
    Task PurgeMyFileFolderAsync(string folderId, CancellationToken cancellationToken);

    /// <summary>GET /my-files/quota → {used_bytes, limit_bytes, remaining_bytes} (личный диск).</summary>
    Task<HubMyFileQuota> GetMyFilesQuotaAsync(CancellationToken cancellationToken);

    /// <summary>
    /// POST /my-files/{id}/copy {folder_id, library_id} → 201 + копия (MyFileResponse).
    /// folder_id+library_id=null — корень личного диска.
    /// </summary>
    Task<HubMyFileItem> CopyMyFileAsync(
        string fileId,
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken);

    /// <summary>
    /// Архив папки по реальному контракту: POST /my-files/folders/{id}/archive-grant
    /// выдаёт одноразовый download_path, GET по нему стримит zip в destination —
    /// тот же конвейер, что DownloadMyFileAsync. Возвращает имя из Content-Disposition.
    /// </summary>
    Task<string> DownloadMyFileFolderArchiveAsync(
        string folderId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /my-files/{id}/preview → {preview_kind, …}: метаданные предпросмотра.
    /// 404/«preview недоступен» — HubApiException.
    /// </summary>
    Task<HubMyFilePreview> GetMyFilePreviewAsync(string fileId, CancellationToken cancellationToken);

    /// <summary>
    /// GET /my-files/{id}/preview/content?variant= — тело предпросмотра в destination
    /// (ResponseHeadersRead). Возвращает Content-Type ответа (или пустую строку).
    /// </summary>
    Task<string> DownloadMyFilePreviewContentAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>POST /my-files/libraries {name, quota_bytes} → 201 + LibraryResponse (право my_files.libraries.manage).</summary>
    Task<HubMyFileLibrary> CreateMyFileLibraryAsync(
        string name,
        long quotaBytes,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /my-files/libraries/{id} {name?, quota_bytes?} → LibraryResponse.
    /// Шлём оба поля; backend игнорирует null (право my_files.libraries.manage).
    /// </summary>
    Task<HubMyFileLibrary> UpdateMyFileLibraryAsync(
        string libraryId,
        string? name,
        long? quotaBytes,
        CancellationToken cancellationToken);

    /// <summary>DELETE /my-files/libraries/{id} → 204 (право my_files.libraries.manage).</summary>
    Task DeleteMyFileLibraryAsync(string libraryId, CancellationToken cancellationToken);

    /// <summary>
    /// GET /my-files/libraries/{id}/members → {items} — участники библиотеки.
    /// Доступ: глобальное право libraries.manage или своя роль manage в библиотеке.
    /// </summary>
    Task<HubMyFileLibraryMembers> GetMyFileLibraryMembersAsync(
        string libraryId,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /my-files/libraries/{id}/members {members[]} → {items}: полная замена
    /// состава (contract-семантика set_members — как у руководителей отдела).
    /// </summary>
    Task<HubMyFileLibraryMembers> SetMyFileLibraryMembersAsync(
        string libraryId,
        IReadOnlyList<HubMyFileLibraryMemberInput> members,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /my-files/office/groups → {items}: отделы для выбора участников
    /// библиотеки (право my_files.share; при 403 возвращаем пустой список — как веб).
    /// </summary>
    Task<IReadOnlyList<HubMyFileOfficeGroup>> GetMyFileOfficeGroupsAsync(
        CancellationToken cancellationToken);

    // ---- База знаний ----

    /// <summary>
    /// GET /kb/categories → плоский список разделов с счётчиками статей
    /// (иерархии нет; дерево собирается на клиенте из статей по category).
    /// </summary>
    Task<IReadOnlyList<HubKbCategory>> GetKbCategoriesAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /kb/articles?q=&category=&status=&limit=&offset= → {items,total,limit,offset}.
    /// Серверный поиск по title/summary/tags/content; сортировка updated_at desc.
    /// </summary>
    Task<HubKbArticleListPage> GetKbArticlesAsync(
        HubKbArticleQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /kb/articles/{id} — статья со структурированным content
    /// (KbContentBlock, не markdown) и метаданными вложений. 404 — HubApiException.
    /// </summary>
    Task<HubKbArticle> GetKbArticleAsync(
        string articleId,
        CancellationToken cancellationToken);

    // ---- Администрирование ----

    /// <summary>
    /// GET /auth/users — пользователи веб-доступа (право settings.users.manage).
    /// Только чтение: создание/правка/деактивация остаются в веб-админке.
    /// </summary>
    Task<IReadOnlyList<HubAdminUser>> GetAdminUsersAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /departments?include_inactive= → {items[]} с счётчиками участников.
    /// Сервер разрешает чтение по departments.manage или settings.read.
    /// </summary>
    Task<HubAdminDepartmentList> GetAdminDepartmentsAsync(
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>GET /departments/{id}/members → {department, items[]} — состав отдела.</summary>
    Task<HubAdminDepartmentMembers> GetAdminDepartmentMembersAsync(
        string departmentId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /ad-users/import-candidates → массив пользователей AD со статусом
    /// импорта (admin). Импорт/синхронизация — write, в срез не входят.
    /// </summary>
    Task<IReadOnlyList<HubAdminAdCandidate>> GetAdminAdImportCandidatesAsync(
        CancellationToken cancellationToken);

    /// <summary>GET /ad-users/sync-status → состояние последней синхронизации AD→app (admin).</summary>
    Task<HubAdminAdSyncStatus> GetAdminAdSyncStatusAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /feedback?status=&limit=&offset= → {items,total,counts}
    /// (право feedback.manage). status=null — все; смена статуса — write.
    /// </summary>
    Task<HubAdminFeedbackPage> GetAdminFeedbackAsync(
        string? status,
        int limit,
        int offset,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /feedback/{id} {status?, admin_note?} → элемент с author{}
    /// (право feedback.manage). Ключи шлём только при реальном изменении —
    /// backend читает exclude_unset, null admin_note очистил бы комментарий.
    /// </summary>
    Task<HubAdminFeedbackItem> UpdateFeedbackAsync(
        string itemId,
        string? status,
        string? adminNote,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /feedback {category, title, message, section} → 201 + предложение
    /// (право dashboard.read — кнопка «Предложить улучшение HUB» веб-дашборда).
    /// </summary>
    Task<HubFeedbackSuggestion> CreateFeedbackAsync(
        HubFeedbackCreate request,
        CancellationToken cancellationToken);

    /// <summary>GET /feedback/mine?limit= → {items,total}: мои обращения и их статусы.</summary>
    Task<HubMyFeedbackPage> GetMyFeedbackAsync(int limit, CancellationToken cancellationToken);

    /// <summary>GET /system/request-metrics?limit=&sort_by= → снимок метрик запросов (admin).</summary>
    Task<HubAdminRequestMetrics> GetAdminRequestMetricsAsync(
        int limit,
        string? sortBy,
        CancellationToken cancellationToken);

    /// <summary>GET /ai-bots → административный список AI-ботов (admin или settings.ai.manage).</summary>
    Task<IReadOnlyList<HubAdminAiBot>> GetAdminAiBotsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /ai-bots/{bot_id} → AiBotAdminResponse (admin или settings.ai.manage).
    /// Тело — только изменённые поля (exclude_unset). 404 «AI bot not found» и
    /// 422 валидации — HubApiException с detail в Message.
    /// </summary>
    Task<HubAdminAiBot> UpdateAiBotAsync(
        string botId,
        HubAiBotUpdateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /ai-bots → созданный бот (admin или settings.ai.manage).
    /// Дубликат slug — ошибка сервера текстом в Message.
    /// </summary>
    Task<HubAdminAiBot> CreateAiBotAsync(
        HubAiBotCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PUT /departments/{id}/managers {manager_user_ids} → {items} memberships
    /// (право departments.manage). Полная замена набора руководителей;
    /// 404 «Department not found» — HubApiException с detail в Message.
    /// </summary>
    Task<HubAdminDepartmentMembers> SetDepartmentManagersAsync(
        string departmentId,
        IReadOnlyList<long> managerUserIds,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /auth/users/{id} → User (право settings.users.manage).
    /// Тело — только изменённые поля (exclude_unset). Ограничения сервера:
    /// свой is_active=false → 400, свои role/permissions → 403, не-admin —
    /// только {email, full_name, department, job_title} не-admin целей.
    /// 400/403/404 — HubApiException с detail в Message.
    /// </summary>
    Task<HubAdminUser> UpdateUserAsync(
        long userId,
        HubUserUpdateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /auth/users → User (201, право settings.users.manage).
    /// Admin — все поля; не-admin — только role=viewer без кастомных полей.
    /// </summary>
    Task<HubAdminUser> CreateUserAsync(
        HubUserCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /auth/users/{id}/reset-2fa → счётчики сброса TOTP (admin):
    /// гасит секрет/backup-коды, отзывает доверенные устройства и биометрию,
    /// закрывает активные сессии пользователя.
    /// </summary>
    Task<HubResetTwoFactorResult> ResetUserTwoFactorAsync(
        long userId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/mailbox-quota-snapshots/latest → MailboxQuotaSnapshotSummary
    /// (право mail.quotas.read; admin — автоматически).
    /// 404 «No snapshots found» — HubApiException (снимков ещё не импортировали).
    /// </summary>
    Task<HubMailQuotaSnapshot> GetLatestMailQuotaSnapshotAsync(CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/mailbox-quota-snapshots?limit= → история снимков по убыванию
    /// даты (право mail.quotas.read). Источник для селектора снимка и
    /// запасной путь, когда latest отвечает 404.
    /// </summary>
    Task<IReadOnlyList<HubMailQuotaSnapshot>> GetMailQuotaSnapshotsAsync(
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/mailbox-quota-snapshots/{id}/summary → MailboxQuotaSnapshotStats:
    /// счётчики total/with_quota/no_quota/over_quota/warning_90 + разрез by_database.
    /// 404 «Snapshot not found» — HubApiException.
    /// </summary>
    Task<HubMailQuotaSnapshotStats> GetMailQuotaSnapshotSummaryAsync(
        int snapshotId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /mail/mailbox-quota-snapshots/{id}/rows?search=&over_quota=&warning_90=&
    /// no_quota=&database_name=&limit=&offset= → MailboxQuotaRowsPage {items,total,snapshot}.
    /// Пустые строки и false-флаги в query не уходят (как в вебе).
    /// </summary>
    Task<HubMailQuotaRowsPage> GetMailQuotaRowsAsync(
        int snapshotId,
        HubMailQuotaRowsQuery query,
        CancellationToken cancellationToken);

    // ---- Администрирование новостей (раздел «Новости») ----

    /// <summary>
    /// GET /hub/announcements/manage?status=&q=&category_id=&tag=&limit=&offset=
    /// → {items,status,total,limit,offset,has_more,next_offset}.
    /// Гейт _require_announcement_manager: announcements.write ИЛИ
    /// announcements.moderate/admin; не-модератор видит только свои новости,
    /// модератор — все (ограничение на стороне сервера).
    /// </summary>
    Task<HubAnnouncementManagePage> GetManagedAnnouncementsAsync(
        HubAnnouncementManageQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/announcements → созданная новость (право announcements.write —
    /// строже manage-гейта: у модератора без write создания нет).
    /// Без файлов — JSON; с файлами — multipart/form-data, скаляры строками,
    /// tags — JSON-массивом, файлы повторяющимся полем files
    /// (лимит сервера 20 МБ на файл — MAX_ANNOUNCEMENT_FILE_BYTES).
    /// </summary>
    Task<HubAnnouncementItem> CreateAnnouncementAsync(
        HubAnnouncementCreateRequest request,
        IReadOnlyList<HubAnnouncementOutgoingFile>? files,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/announcements/drafts — JSON-тело как у create; сервер
    /// принудительно ставит status=draft (веб-драфт autosave, announcements.write).
    /// </summary>
    Task<HubAnnouncementItem> CreateAnnouncementDraftAsync(
        HubAnnouncementCreateRequest request,
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /hub/announcements/{id} → обновлённая новость (write|moderate;
    /// автор или модератор — сервер проверяет). Тело — только изменённые поля.
    /// </summary>
    Task<HubAnnouncementItem> UpdateAnnouncementAsync(
        string announcementId,
        HubAnnouncementUpdateRequest request,
        CancellationToken cancellationToken);

    /// <summary>POST /hub/announcements/{id}/publish → обновлённая новость (status=published).</summary>
    Task<HubAnnouncementItem> PublishAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken);

    /// <summary>POST /hub/announcements/{id}/archive → обновлённая новость (status=archived).</summary>
    Task<HubAnnouncementItem> ArchiveAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /hub/announcements/{id} → {ok} (announcements.moderate/admin —
    /// веб прячет кнопку от авторов-write, мы тоже).
    /// </summary>
    Task DeleteManagedAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/announcement-categories?include_inactive= → {items}.
    /// announcements.read; include_inactive=true требует moderate (иначе 403).
    /// </summary>
    Task<HubAnnouncementCategoryList> GetAnnouncementCategoriesAsync(
        bool includeInactive,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/announcement-categories {name} → созданная категория
    /// (announcements.moderate; name ≥ 2 символов).
    /// </summary>
    Task<HubAnnouncementCategory> CreateAnnouncementCategoryAsync(
        string name,
        CancellationToken cancellationToken);

    /// <summary>GET /hub/announcement-tags → {items:[{id,name,slug,usage_count}]} (announcements.read).</summary>
    Task<HubAnnouncementTagList> GetAnnouncementTagsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// POST /hub/announcements/{id}/attachments — multipart с полем file
    /// (manage-гейт + автор/модератор; лимит 20 МБ). Ответ — созданное вложение.
    /// </summary>
    Task<HubAnnouncementAttachment> UploadAnnouncementAttachmentAsync(
        string announcementId,
        HubAnnouncementOutgoingFile file,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /hub/announcements/{id}/analytics → {items:[read-строки], summary}
    /// (manage-гейт + автор/модератор). Возвращается пустая модель при пустом теле.
    /// </summary>
    Task<HubAnnouncementAnalytics> GetAnnouncementAnalyticsAsync(
        string announcementId,
        CancellationToken cancellationToken);

    // ---- Настройки ----

    /// <summary>
    /// GET /auth/me — карточка текущего пользователя (в т.ч. статус 2FA и
    /// зона сети для read-only отображения в настройках).
    /// </summary>
    Task<HubUser> GetCurrentUserAsync(CancellationToken cancellationToken);

    /// <summary>GET /settings/me — пользовательские настройки интерфейса.</summary>
    Task<HubUserSettings> GetMySettingsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /settings/me — внешний вид: theme_mode (light|dark|system),
    /// font_family, font_scale (0.9–1.2 по контракту backend).
    /// </summary>
    Task<HubUserSettings> UpdateMySettingsAsync(
        string themeMode,
        string fontFamily,
        double fontScale,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /settings/notifications/preferences → {user_id, channels{…}}.
    /// </summary>
    Task<HubNotificationPreferences> GetNotificationPreferencesAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// PATCH /settings/notifications/preferences — словарь каналов
    /// (mail/tasks/task_email/announcements/chat*/docflow…). Сервер сам
    /// наследует chat-подканалы при явном chat и сводит chat при правке
    /// подканалов — клиент присылает явные значения.
    /// </summary>
    Task<HubNotificationPreferences> UpdateNotificationPreferencesAsync(
        IReadOnlyDictionary<string, bool> patch,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /auth/change-password {old_password, new_password}.
    /// Сервер при успехе закрывает все сессии пользователя и отзывает
    /// доверенные устройства — клиент никакой session-политики не добавляет.
    /// </summary>
    Task<HubChangePasswordResult> ChangePasswordAsync(
        string oldPassword,
        string newPassword,
        CancellationToken cancellationToken);

    /// <summary>
    /// Авторизованный GET бинарного контента для картинок: относительный api-путь
    /// («equipment/{id}/photos/{no}/content?thumb=true»), серверная ссылка вида
    /// «/api/v1/address-book/photos/{code}» или абсолютный http(s)-URL того же
    /// origin (чужой origin — HubApiException: Bearer за пределы не уходит).
    /// Тот же Bearer/refresh-путь, что у прочих запросов; тело читается целиком.
    /// </summary>
    Task<byte[]> DownloadImageAsync(string uriOrPath, CancellationToken cancellationToken);

    // ---- Строительство ----

    /// <summary>
    /// GET /construction/objects?q&kind&limit&cursor&refresh — портфель объектов
    /// строительства/направлений 1С (право construction.read).
    /// kind: all|project|general|unassigned.
    /// </summary>
    Task<HubConstructionObjectsResponse> GetConstructionObjectsAsync(
        HubConstructionObjectsQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /construction/objects/{object_id} — карточка объекта:
    /// реквизиты, номенклатурные группы (направления), команда (construction.read).
    /// object_id — managed id либо group_ref 1С (как у веб-клиента:
    /// managed_object_id || object_ref из карточки портфеля).
    /// </summary>
    Task<HubConstructionObjectDetail> GetConstructionObjectDetailAsync(
        string objectId,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /construction/objects/{object_id}/requests?view&q&limit&cursor&refresh —
    /// заявки объекта по всем направлениям + direction_stats/сводка (construction.read).
    /// view: active|history|all.
    /// </summary>
    Task<HubConstructionObjectRequestsResponse> GetConstructionObjectRequestsAsync(
        string objectId,
        HubConstructionRequestsQuery query,
        CancellationToken cancellationToken);

    // ---- Склад 1С ----

    /// <summary>
    /// GET /warehouse-1c/nomenclature/search?q&limit — подсказки номенклатуры 1С
    /// (право warehouse_1c.read). Ответ — массив либо конверт {items}; клиент
    /// нормализует оба варианта, как веб (normalizeWarehouse1cListResponse).
    /// </summary>
    Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cNomenclatureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/warehouses/search?q&limit — подсказки складов 1С
    /// (warehouse_1c.read). Та же нормализация массив/конверт.
    /// </summary>
    Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cWarehousesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/balances?nomenclature_ref&warehouse_ref&q&limit&include_meta=true —
    /// остатки номенклатуры с серверными фильтрами (warehouse_1c.read).
    /// Backend требует хотя бы один фильтр; has_more/truncated помечают неполную выдачу.
    /// </summary>
    Task<HubWarehouse1cBalancesResponse> GetWarehouse1cBalancesAsync(
        HubWarehouse1cBalancesQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/movements?nomenclature_ref&warehouse_ref&series_ref&date_from&
    /// date_to&limit&cursor&include_meta=true — ведомость движений (warehouse_1c.read).
    /// nomenclature_ref обязателен; next_cursor хранится в конверте ответа.
    /// </summary>
    Task<HubWarehouse1cMovementsResponse> GetWarehouse1cMovementsAsync(
        HubWarehouse1cMovementsQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/movements/detail?registrar_ref — карточка документа-регистратора:
    /// маршрут перемещения, контрагент, приложенные файлы (warehouse_1c.read).
    /// </summary>
    Task<HubWarehouse1cMovementDetail> GetWarehouse1cMovementDetailAsync(
        string registrarRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/movements/files/{file_ref}?registrar_ref — бинарная выгрузка
    /// приложенного к документу файла в destination; имя — из Content-Disposition.
    /// </summary>
    Task<string> DownloadWarehouse1cMovementFileAsync(
        string registrarRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/dismissed-warehouses?limit&include_meta=true — склады,
    /// закреплённые за уволенными сотрудниками, с суммами и остатками (warehouse_1c.read).
    /// </summary>
    Task<HubWarehouse1cDismissedResponse> GetWarehouse1cDismissedWarehousesAsync(
        int limit,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/catalog/status — возраст/полнота кэша справочников 1С,
    /// от которого идут автодополнения номенклатуры и складов (warehouse_1c.read).
    /// </summary>
    Task<HubWarehouse1cCatalogStatus> GetWarehouse1cCatalogStatusAsync(
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/it-requests?view&q&stage&warehouse_ref&overdue&limit&cursor&refresh —
    /// заявки на МПЗ (право warehouse_1c.it_requests.read). view: active|history|all.
    /// </summary>
    Task<HubItRequestsResponse> GetWarehouse1cItRequestsAsync(
        HubItRequestsQuery query,
        CancellationToken cancellationToken);

    /// <summary>
    /// GET /warehouse-1c/it-requests/{request_ref} — деталь заявки: позиции,
    /// маршрут (journey), документы (timeline), группы номенклатуры.
    /// </summary>
    Task<HubItRequestItem> GetWarehouse1cItRequestDetailAsync(
        string requestRef,
        CancellationToken cancellationToken);

    /// <summary>
    /// POST /desktop-presence/heartbeat {} — heartbeat «десктоп онлайн» для
    /// нативного шелла (веб вызывает его только в desktop-runtime, 60 c ± джиттер,
    /// rate-limit 120/мин). Best-effort: ошибки глотаются вызывающим циклом.
    /// </summary>
    Task<HubDesktopPresence> SendDesktopPresenceHeartbeatAsync(CancellationToken cancellationToken);

    /// <summary>
    /// DELETE /desktop-presence/current — graceful disconnect при выходе;
    /// TTL на сервере остаётся границей корректности, если вызов не дошёл.
    /// </summary>
    Task<HubDesktopPresence> DisconnectDesktopPresenceAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Актуальный access-токен для WebSocket-handshake (refresh при необходимости).
    /// null — сессии нет.
    /// </summary>
    Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken);

    /// <summary>Origin сервера (для построения wss:// URL realtime-подключений).</summary>
    Uri BaseUri { get; }

    // ==================== DLP-мониторинг (admin-only на сервере) ====================

    /// <summary>GET /inventory/dlp/hosts?category= — статистика по ПК (файлы/визиты/филиал).</summary>
    Task<HubDlpHostsResponse> ListDlpHostsAsync(string? category, CancellationToken cancellationToken);

    /// <summary>GET /inventory/dlp/summary — счётчики дня для шапки страницы.</summary>
    Task<HubDlpSummaryResponse> GetDlpSummaryAsync(CancellationToken cancellationToken);

    /// <summary>GET /inventory/dlp/attention?day= — сводка за день (YYYY-MM-DD).</summary>
    Task<HubDlpAttentionResponse> GetDlpAttentionAsync(string? day, CancellationToken cancellationToken);

    /// <summary>
    /// GET /inventory/dlp/activity?computer_name=&day= — 5-минутные бакеты дня.
    /// day — «YYYY-MM-DD» в локальном времени филиала; пустая строка → сегодня.
    /// </summary>
    Task<HubDlpActivityResponse> GetDlpActivityAsync(
        string computerName,
        string? day,
        CancellationToken cancellationToken);

    /// <summary>GET /inventory/dlp/work-schedules — графики филиалов + список филиалов.</summary>
    Task<HubDlpWorkSchedulesResponse> ListDlpWorkSchedulesAsync(CancellationToken cancellationToken);

    /// <summary>PUT /inventory/dlp/work-schedules/{branch} — создать/обновить график.</summary>
    Task<HubDlpWorkScheduleSaveResponse> SaveDlpWorkScheduleAsync(
        string branchName,
        int workStartMin,
        int workEndMin,
        int? lunchStartMin,
        int? lunchEndMin,
        int tzOffsetMinutes,
        int workdaysMask,
        CancellationToken cancellationToken);

    /// <summary>DELETE /inventory/dlp/work-schedules/{branch} — сброс к поведению без графика.</summary>
    Task DeleteDlpWorkScheduleAsync(string branchName, CancellationToken cancellationToken);

    /// <summary>
    /// GET /inventory/fs-egress?computer_name=&channel=&group=1 — файлы хоста (вкладка «Файлы»).
    /// channel: usb | telegram | max | deleted | пусто — все каналы.
    /// </summary>
    Task<HubFsEgressResponse> ListFsEgressEventsAsync(
        string? computerName,
        string? channel,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET /inventory/telegram-probe?computer_name=&limit= — диалоги Telegram.</summary>
    Task<HubDlpChatsResponse> ListTelegramChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET /inventory/max-probe?computer_name=&limit= — диалоги MAX.</summary>
    Task<HubDlpChatsResponse> ListMaxChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>GET /inventory/browser-probe?computer_name=&day=&merge=1 — визиты браузера.</summary>
    Task<HubBrowserVisitsResponse> ListBrowserVisitsAsync(
        string? computerName,
        string? day,
        int limit,
        CancellationToken cancellationToken);

    /// <summary>Best-effort logout (ревокация refresh на сервере) + локальная очистка.</summary>
    Task LogoutAsync(CancellationToken cancellationToken);
}
