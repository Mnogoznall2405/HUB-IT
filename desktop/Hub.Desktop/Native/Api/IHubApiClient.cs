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

    // ---- Отсутствия ----

    /// <summary>GET /hub/absences: ручные записи + ЗУП. День (on) или диапазон.</summary>
    Task<HubAbsenceRangeList> GetAbsencesAsync(
        string? on,
        string? startsOn,
        string? endsOn,
        int limit,
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
    /// GET /tickets/kanban?object_ids=&assignee_ids= — доска заявок: словарь
    /// «русское имя колонки» → карточки (фильтры — csv id, как в веб-канбане).
    /// </summary>
    Task<IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>> GetTicketKanbanAsync(
        string? objectIds,
        string? assigneeIds,
        CancellationToken cancellationToken);

    /// <summary>GET /tickets/dashboard — сводка: metrics, per_object, top_problems/top_assignees.</summary>
    Task<HubTicketsDashboard> GetTicketDashboardAsync(CancellationToken cancellationToken);

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
    /// GET /equipment/{inv_no}/history — история перемещений CI_HISTORY:
    /// сотрудник/филиал/локация old→new, пользователь, комментарий.
    /// </summary>
    Task<HubEquipmentHistoryResponse> GetEquipmentHistoryAsync(
        string invNo,
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
    /// POST /equipment/transfer — перемещение оборудования другому сотруднику
    /// (права database.write). Ответ job-based: queued/processing досматриваются
    /// через GetTransferActJobAsync; operation_id — idempotency-key клиента.
    /// </summary>
    Task<HubTransferExecuteResponse> TransferEquipmentAsync(
        HubEquipmentTransferRequest request,
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

    /// <summary>GET /system/request-metrics?limit=&sort_by= → снимок метрик запросов (admin).</summary>
    Task<HubAdminRequestMetrics> GetAdminRequestMetricsAsync(
        int limit,
        string? sortBy,
        CancellationToken cancellationToken);

    /// <summary>GET /ai-bots → административный список AI-ботов (admin или settings.ai.manage).</summary>
    Task<IReadOnlyList<HubAdminAiBot>> GetAdminAiBotsAsync(CancellationToken cancellationToken);

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

    /// <summary>
    /// Актуальный access-токен для WebSocket-handshake (refresh при необходимости).
    /// null — сессии нет.
    /// </summary>
    Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken);

    /// <summary>Origin сервера (для построения wss:// URL realtime-подключений).</summary>
    Uri BaseUri { get; }

    /// <summary>Best-effort logout (ревокация refresh на сервере) + локальная очистка.</summary>
    Task LogoutAsync(CancellationToken cancellationToken);
}
