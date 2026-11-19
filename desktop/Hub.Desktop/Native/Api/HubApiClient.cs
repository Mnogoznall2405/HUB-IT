using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// IHubApiClient поверх /api/v1: Bearer-контракт mobile-клиента
/// (X-Auth-Client + X-Client-Device-ID), single-flight refresh,
/// один retry после 401 и полный wipe сессии по окончательному отказу.
/// </summary>
public sealed class HubApiClient : IHubApiClient, IDisposable
{
    private static readonly TimeSpan AccessTokenRefreshSkew = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan AccessTokenExpiryFallback = TimeSpan.FromMinutes(14);
    private static readonly TimeSpan DefaultRequestTimeout = TimeSpan.FromSeconds(30);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowReadingFromString,
    };

    private readonly HttpClient _httpClient;
    private readonly Uri _baseUri;
    private readonly Uri _apiBaseUri;
    private readonly INativeSessionStore _sessionStore;
    private readonly SemaphoreSlim _refreshLock = new(1, 1);
    private NativeSession? _session;
    private volatile string? _deviceId;

    public HubApiClient(
        Uri baseUri,
        INativeSessionStore sessionStore,
        HttpMessageHandler? handler = null)
    {
        ArgumentNullException.ThrowIfNull(baseUri);
        ArgumentNullException.ThrowIfNull(sessionStore);
        _sessionStore = sessionStore;
        var normalized = baseUri.AbsoluteUri.EndsWith('/')
            ? baseUri
            : new Uri(baseUri.AbsoluteUri + "/");
        _baseUri = normalized;
        _apiBaseUri = new Uri(normalized, "api/v1/");
        _httpClient = handler is null
            ? new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false })
            : new HttpClient(handler);
        // Глобальный Timeout выключен: стриминг скачиваний не должен подпадать под 30с
        // на всё тело. Единый предел — per-request linked token в SendCoreAsync.
        _httpClient.Timeout = Timeout.InfiniteTimeSpan;
    }

    public NativeSession? CurrentSession => Volatile.Read(ref _session);

    public Uri BaseUri => _baseUri;

    public event EventHandler? SessionEnded;

    public async Task<NativeSession?> RestoreSessionAsync(CancellationToken cancellationToken)
    {
        var stored = await _sessionStore.LoadAsync(cancellationToken);
        Volatile.Write(ref _session, stored);
        if (stored is null)
        {
            return null;
        }

        try
        {
            var deviceId = await GetDeviceIdAsync(cancellationToken);
            using var response = await SendAuthenticatedAsync(
                token => CreateRequest(HttpMethod.Get, "auth/me", token, deviceId),
                cancellationToken);
            _ = await ReadJsonAsync<HubUser>(response, cancellationToken);
            return Volatile.Read(ref _session);
        }
        catch (HubApiException exception)
        {
            // Only a definitive rejection kills the session — transport/HTTP failures
            // keep it so the app can still start behind a flaky network.
            return exception.Kind == HubApiErrorKind.SessionExpired
                ? null
                : Volatile.Read(ref _session);
        }
    }

    public async Task<HubLoginResult> LoginAsync(
        string username,
        string password,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(username);
        ArgumentException.ThrowIfNullOrWhiteSpace(password);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var request = CreateRequest(HttpMethod.Post, "auth/login", bearer: null, deviceId);
        request.Content = CreateJsonContent(new { username, password });
        using var response = await SendCoreAsync(request, cancellationToken);
        var payload = await ReadJsonAsync<AuthTokenResponse>(response, cancellationToken);
        return await CompleteLoginAsync(payload, deviceId, username, cancellationToken);
    }

    public async Task<HubLoginResult> VerifyTwoFactorLoginAsync(
        string loginChallengeId,
        string? totpCode,
        string? backupCode,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(loginChallengeId);
        if (totpCode is null && backupCode is null)
        {
            throw new ArgumentException("TOTP code or backup code is required.");
        }

        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var payload = new Dictionary<string, string>
        {
            ["login_challenge_id"] = loginChallengeId,
        };
        if (totpCode is not null)
        {
            payload["totp_code"] = totpCode;
        }

        if (backupCode is not null)
        {
            payload["backup_code"] = backupCode;
        }

        using var request = CreateRequest(HttpMethod.Post, "auth/verify-2fa-login", bearer: null, deviceId);
        request.Content = CreateJsonContent(payload);
        using var response = await SendCoreAsync(request, cancellationToken);
        var parsed = await ReadJsonAsync<AuthTokenResponse>(response, cancellationToken);
        return await CompleteLoginAsync(parsed, deviceId, string.Empty, cancellationToken);
    }

    public async Task<HubTaskListPage> GetMyTasksAsync(
        HubTaskQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = BuildTasksQueryUri(query);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskListPage>(response, cancellationToken);
    }

    public async Task<HubDashboard> GetDashboardAsync(
        int announcementsLimit,
        int tasksLimit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative =
            "hub/dashboard?announcements_limit="
            + announcementsLimit.ToString(CultureInfo.InvariantCulture)
            + "&tasks_limit="
            + tasksLimit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDashboard>(response, cancellationToken);
    }

    public async Task<HubAnnouncementListPage> GetAnnouncementsAsync(
        HubAnnouncementQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + query.Limit.ToString(CultureInfo.InvariantCulture),
            "offset=" + query.Offset.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            parts.Add("q=" + Uri.EscapeDataString(query.Search.Trim()));
        }

        if (query.UnreadOnly)
        {
            parts.Add("unread_only=true");
        }

        if (!string.IsNullOrWhiteSpace(query.SortBy))
        {
            parts.Add("sort_by=" + Uri.EscapeDataString(query.SortBy));
        }

        if (!string.IsNullOrWhiteSpace(query.SortDir))
        {
            parts.Add("sort_dir=" + Uri.EscapeDataString(query.SortDir));
        }

        var relative = "hub/announcements?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementListPage>(response, cancellationToken);
    }

    public async Task<HubAnnouncementItem> GetAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken);
    }

    public async Task MarkAnnouncementReadAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        await PostEmptyAsync(
            "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/mark-as-read",
            cancellationToken);
    }

    public async Task AckAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        await PostEmptyAsync(
            "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/ack",
            cancellationToken);
    }

    public async Task<HubAbsenceRangeList> GetAbsencesAsync(
        string? on,
        string? startsOn,
        string? endsOn,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string> { "limit=" + limit.ToString(CultureInfo.InvariantCulture) };
        if (!string.IsNullOrWhiteSpace(on))
        {
            parts.Add("on=" + Uri.EscapeDataString(on));
        }

        if (!string.IsNullOrWhiteSpace(startsOn))
        {
            parts.Add("starts_on=" + Uri.EscapeDataString(startsOn));
        }

        if (!string.IsNullOrWhiteSpace(endsOn))
        {
            parts.Add("ends_on=" + Uri.EscapeDataString(endsOn));
        }

        var relative = "hub/absences?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAbsenceRangeList>(response, cancellationToken);
    }

    public async Task<HubMailBootstrap> GetMailBootstrapAsync(
        int limit,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/bootstrap?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "&mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailBootstrap>(response, cancellationToken);
    }

    public async Task<HubMailFolderTree> GetMailFolderTreeAsync(
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/folders/tree";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailFolderTree>(response, cancellationToken);
    }

    public async Task<HubMailMessagePage> GetMailMessagesAsync(
        HubMailMessageQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "folder=" + Uri.EscapeDataString(string.IsNullOrWhiteSpace(query.Folder) ? "inbox" : query.Folder),
            "folder_scope=" + Uri.EscapeDataString(string.IsNullOrWhiteSpace(query.FolderScope) ? "current" : query.FolderScope),
            "limit=" + query.Limit.ToString(CultureInfo.InvariantCulture),
            "offset=" + query.Offset.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(query.MailboxId))
        {
            parts.Add("mailbox_id=" + Uri.EscapeDataString(query.MailboxId));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            parts.Add("q=" + Uri.EscapeDataString(query.Search.Trim()));
        }

        if (query.UnreadOnly)
        {
            parts.Add("unread_only=true");
        }

        var relative = "mail/messages?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailMessagePage>(response, cancellationToken);
    }

    public async Task<HubMailMessageDetail> GetMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailMessageDetail>(response, cancellationToken);
    }

    public async Task<HubMailActionResult> MarkMailMessageReadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        return await PostMailMessageActionAsync(
            messageId,
            "read",
            mailboxId,
            body: null,
            cancellationToken);
    }

    public async Task<HubMailActionResult> MarkMailMessageUnreadAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        return await PostMailMessageActionAsync(
            messageId,
            "unread",
            mailboxId,
            body: null,
            cancellationToken);
    }

    public async Task<HubMailActionResult> DeleteMailMessageAsync(
        string messageId,
        string? mailboxId,
        bool permanent,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        return await PostMailMessageActionAsync(
            messageId,
            "delete",
            mailboxId: null,
            body: new { mailbox_id = mailboxId ?? string.Empty, permanent },
            cancellationToken);
    }

    public async Task<HubMailActionResult> MoveMailMessageAsync(
        string messageId,
        string? mailboxId,
        string targetFolder,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetFolder);
        return await PostMailMessageActionAsync(
            messageId,
            "move",
            mailboxId: null,
            body: new { mailbox_id = mailboxId ?? string.Empty, target_folder = targetFolder },
            cancellationToken);
    }

    public async Task<HubMailSendResult> SendMailMessageAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var hasFiles = attachments is { Count: > 0 };
        var relative = hasFiles ? "mail/messages/send-multipart" : "mail/messages/send";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                if (!string.IsNullOrWhiteSpace(request.IdempotencyKey))
                {
                    httpRequest.Headers.TryAddWithoutValidation(
                        "Idempotency-Key", request.IdempotencyKey);
                }

                httpRequest.Content = hasFiles
                    ? CreateMailComposeMultipart(request, attachments!, includeDraftFields: false)
                    : CreateJsonContent(new
                    {
                        from_mailbox_id = request.FromMailboxId ?? string.Empty,
                        to = request.To,
                        cc = request.Cc,
                        bcc = request.Bcc,
                        subject = request.Subject ?? string.Empty,
                        body = request.Body ?? string.Empty,
                        is_html = request.IsHtml,
                        reply_to_message_id = request.ReplyToMessageId ?? string.Empty,
                        forward_message_id = request.ForwardMessageId ?? string.Empty,
                        draft_id = request.DraftId ?? string.Empty,
                        retain_existing_attachments = request.RetainExistingAttachments,
                        forward_attachment_refs = request.ForwardAttachmentRefs,
                    });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailSendResult>(response, cancellationToken);
    }

    public async Task<HubMailDraftSaveResult> SaveMailDraftAsync(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment>? attachments,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(
                    HttpMethod.Post, "mail/drafts/upsert-multipart", token, deviceId);
                httpRequest.Content = CreateMailComposeMultipart(
                    request,
                    attachments ?? Array.Empty<HubMailOutgoingAttachment>(),
                    includeDraftFields: true);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailDraftSaveResult>(response, cancellationToken);
    }

    public async Task<HubMailActionResult> DeleteMailDraftAsync(
        string draftId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(draftId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/drafts/" + Uri.EscapeDataString(draftId);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailActionResult>(response, cancellationToken);
    }

    public async Task<IReadOnlyList<HubMailContact>> SearchMailContactsAsync(
        string query,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/contacts?q=" + Uri.EscapeDataString(query.Trim());
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "&mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        var payload = await ReadJsonAsync<HubMailContactList>(response, cancellationToken);
        return payload.Items ?? [];
    }

    public async Task<string> DownloadMailAttachmentAsync(
        string messageId,
        string attachmentRef,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentRef);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId)
            + "/attachments/" + Uri.EscapeDataString(attachmentRef);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        // ResponseHeadersRead: тело стримится в destination — паттерн DownloadChatAttachmentAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    public async Task<HubMailBulkResult> BulkMailMessageActionAsync(
        string? mailboxId,
        string action,
        IReadOnlyList<string> messageIds,
        string? targetFolder,
        bool permanent,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentNullException.ThrowIfNull(messageIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "mail/messages/bulk", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    mailbox_id = mailboxId ?? string.Empty,
                    action,
                    message_ids = messageIds,
                    target_folder = targetFolder ?? string.Empty,
                    permanent,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailBulkResult>(response, cancellationToken);
    }

    /// <summary>
    /// multipart-форма send-multipart/drafts-upsert: to/cc/bcc — «;»-склейка,
    /// retain/forward-refs — *_json полями, файлы — повторяющимся полем files[]
    /// (inline_files и compose-подпись desktop-срез не использует).
    /// </summary>
    private static MultipartFormDataContent CreateMailComposeMultipart(
        HubMailSendRequest request,
        IReadOnlyList<HubMailOutgoingAttachment> attachments,
        bool includeDraftFields)
    {
        var content = new MultipartFormDataContent();
        void AddField(string name, string? value) =>
            content.Add(new StringContent(value ?? string.Empty, Encoding.UTF8), name);

        AddField("from_mailbox_id", request.FromMailboxId ?? string.Empty);
        if (includeDraftFields)
        {
            AddField("draft_id", request.DraftId ?? string.Empty);
            AddField("compose_mode", request.ComposeMode ?? "draft");
        }

        AddField("to", string.Join(";", request.To));
        AddField("cc", string.Join(";", request.Cc));
        AddField("bcc", string.Join(";", request.Bcc));
        AddField("subject", request.Subject ?? string.Empty);
        AddField("body", request.Body ?? string.Empty);
        AddField("is_html", request.IsHtml ? "true" : "false");
        AddField("reply_to_message_id", request.ReplyToMessageId ?? string.Empty);
        AddField("forward_message_id", request.ForwardMessageId ?? string.Empty);
        if (!includeDraftFields)
        {
            // У send-multipart draft_id — обычное поле, у drafts — уже добавлен выше.
            AddField("draft_id", request.DraftId ?? string.Empty);
        }

        // Как веб-клиент: retain-поле шлётся всегда (пустой массив для нового письма),
        // forward_attachment_refs — только при явном списке.
        AddField(
            "retain_existing_attachments_json",
            JsonSerializer.Serialize(
                request.RetainExistingAttachments ?? Array.Empty<string>(), JsonOptions));
        if (request.ForwardAttachmentRefs is not null)
        {
            AddField(
                "forward_attachment_refs_json",
                JsonSerializer.Serialize(request.ForwardAttachmentRefs, JsonOptions));
        }

        foreach (var attachment in attachments)
        {
            var fileContent = new ByteArrayContent(attachment.Content.ToArray());
            fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                string.IsNullOrWhiteSpace(attachment.ContentType)
                    ? "application/octet-stream"
                    : attachment.ContentType);
            fileContent.Headers.TryAddWithoutValidation(
                "Content-Disposition",
                "form-data; name=\"files\"; filename=\""
                + (attachment.FileName ?? "attachment.bin").Replace("\"", "_")
                + "\"");
            content.Add(fileContent, "files", attachment.FileName ?? "attachment.bin");
        }

        AddField("inline_content_ids_json", "[]");
        return content;
    }

    /// <summary>
    /// POST /mail/messages/{id}/{action}: read/unread берут mailbox_id query-параметром,
    /// delete/move — полем JSON-тела (контракт mail.py).
    /// </summary>
    private async Task<HubMailActionResult> PostMailMessageActionAsync(
        string messageId,
        string action,
        string? mailboxId,
        object? body,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/" + action;
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                if (body is not null)
                {
                    request.Content = CreateJsonContent(body);
                }

                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailActionResult>(response, cancellationToken);
    }

    public async Task<HubMailUnreadCount> GetMailUnreadCountAsync(
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/unread-count";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailUnreadCount>(response, cancellationToken);
    }

    // ---- Документооборот 1С ----

    /// <summary>Запросы к 1С медленнее стандартных 30с — как DOCFLOW_1C_QUERY_TIMEOUT_MS в вебе.</summary>
    private static readonly TimeSpan DocflowRequestTimeout = TimeSpan.FromSeconds(90);

    /// <summary>Сколько раз повторяем preview/pdf при 202 («копия ещё готовится в 1С»).</summary>
    private const int DocflowPreviewMaxAttempts = 8;

    public async Task<HubDocflowTaskListPage> GetDocflowTasksAsync(
        HubDocflowTaskQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var scope = query.Scope is "completed" or "all" ? query.Scope : "inbox";
        var builder = new StringBuilder("docflow/tasks?scope=").Append(scope)
            .Append("&limit=").Append(query.Limit.ToString(CultureInfo.InvariantCulture))
            .Append("&offset=").Append(query.Offset.ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowTaskListPage>(response, cancellationToken);
    }

    public async Task<HubDocflowInboxSummary> GetDocflowInboxSummaryAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "docflow/inbox-summary", token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowInboxSummary>(response, cancellationToken);
    }

    public async Task<HubDocflowTaskDetail> GetDocflowTaskAsync(
        string taskRef,
        bool includeRelated,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        // Явный 0/1 — как в веб-клиенте (сериализаторы/proxy не выкидывают false).
        var relative = "docflow/tasks/" + Uri.EscapeDataString(taskRef)
            + "?include_related=" + (includeRelated ? "1" : "0");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowTaskDetail>(response, cancellationToken);
    }

    public async Task<HubDocflowCommandResult> ApplyDocflowTaskActionAsync(
        string taskRef,
        string action,
        string? comment,
        string stateToken,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(action);
        ArgumentException.ThrowIfNullOrWhiteSpace(stateToken);
        ArgumentException.ThrowIfNullOrWhiteSpace(idempotencyKey);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "docflow/tasks/" + Uri.EscapeDataString(taskRef) + "/actions";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                // Backend требует Idempotency-Key длиной 8..128.
                request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
                request.Content = CreateJsonContent(new
                {
                    action,
                    comment = comment ?? string.Empty,
                    state_token = stateToken,
                });
                return request;
            },
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        // 202 (pending/state_unknown) — тоже успешный ответ с DocflowCommandResult.
        return await ReadJsonAsync<HubDocflowCommandResult>(response, cancellationToken);
    }

    public async Task<HubDocflowCommandResult> GetDocflowCommandAsync(
        string commandId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(commandId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "docflow/commands/" + Uri.EscapeDataString(commandId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowCommandResult>(response, cancellationToken);
    }

    public async Task<string> DownloadDocflowFileAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileRef);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "docflow/tasks/" + Uri.EscapeDataString(taskRef)
            + "/files/" + Uri.EscapeDataString(fileRef) + "/content";
        // ResponseHeadersRead: тело стримится в destination — паттерн DownloadChatAttachmentAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead,
            DocflowRequestTimeout);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    public async Task<string> DownloadDocflowFilePreviewAsync(
        string taskRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(taskRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileRef);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "docflow/tasks/" + Uri.EscapeDataString(taskRef)
            + "/files/" + Uri.EscapeDataString(fileRef) + "/preview/pdf";
        // 1С генерирует PDF-копию асинхронно: 202 + Retry-After, пока не ready.
        for (var attempt = 1; ; attempt++)
        {
            using var response = await SendAuthenticatedAsync(
                token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
                cancellationToken,
                HttpCompletionOption.ResponseHeadersRead,
                DocflowRequestTimeout);
            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                if (attempt >= DocflowPreviewMaxAttempts)
                {
                    throw new HubApiException(
                        HubApiErrorKind.Http,
                        "Предпросмотр файла ещё готовится в 1С. Откройте сам файл или повторите позже.",
                        HttpStatusCode.Accepted);
                }

                var retryAfter = response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(1);
                await Task.Delay(retryAfter, cancellationToken);
                continue;
            }

            await EnsureSuccessAsync(response, cancellationToken);
            await response.Content.CopyToAsync(destination, cancellationToken);
            return ParseContentDispositionFileName(
                response.Content.Headers.ContentDisposition?.FileNameStar
                ?? response.Content.Headers.ContentDisposition?.FileName);
        }
    }

    public async Task<HubDocflowProfile> GetDocflowProfileAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "docflow/profile", token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowProfile>(response, cancellationToken);
    }

    public async Task<HubDocflowAssignmentCapability> GetDocflowAssignmentCapabilityAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "docflow/assignments/capability", token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowAssignmentCapability>(response, cancellationToken);
    }

    public async Task<HubDocflowAssignmentDocumentList> SearchDocflowAssignmentDocumentsAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("docflow/assignments/documents?limit=")
            .Append(Math.Clamp(limit, 1, 50).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowAssignmentDocumentList>(response, cancellationToken);
    }

    public async Task<HubDocflowAssignmentAssigneeList> SearchDocflowAssignmentAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("docflow/assignments/assignees?limit=")
            .Append(Math.Clamp(limit, 1, 50).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowAssignmentAssigneeList>(response, cancellationToken);
    }

    public async Task<HubDocflowAssignmentCommandResult> CreateDocflowAssignmentAsync(
        HubDocflowAssignmentCreateRequest request,
        string idempotencyKey,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.DocumentType);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.DocumentRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.AssigneeRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Title);
        ArgumentException.ThrowIfNullOrWhiteSpace(request.Description);
        ArgumentException.ThrowIfNullOrWhiteSpace(idempotencyKey);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "docflow/assignments", token, deviceId);
                // Backend требует Idempotency-Key длиной 8..128.
                httpRequest.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
                httpRequest.Content = CreateJsonContent(new
                {
                    document_type = request.DocumentType,
                    document_ref = request.DocumentRef,
                    assignee_ref = request.AssigneeRef,
                    controller_ref = string.IsNullOrWhiteSpace(request.ControllerRef)
                        ? null
                        : request.ControllerRef.Trim(),
                    // Naive datetime — как datetime-local в вебе: локальное время сервера.
                    due_at = request.DueAt.ToString(
                        "yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture),
                    importance = request.Importance is "high" ? "high" : "normal",
                    title = request.Title,
                    description = request.Description,
                });
                return httpRequest;
            },
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        // 202 (pending/state_unknown) — тоже успешный ответ с HubDocflowAssignmentCommandResult.
        return await ReadJsonAsync<HubDocflowAssignmentCommandResult>(response, cancellationToken);
    }

    public async Task<HubDocflowAssignmentCommandResult> GetDocflowAssignmentCommandAsync(
        string commandId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(commandId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "docflow/assignments/commands/" + Uri.EscapeDataString(commandId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowAssignmentCommandResult>(response, cancellationToken);
    }

    // ---- Билеты ----

    public async Task<HubTicketListPage> GetTicketRequestsAsync(
        HubTicketQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/requests?page=")
            .Append(query.Page.ToString(CultureInfo.InvariantCulture))
            .Append("&page_size=").Append(query.PageSize.ToString(CultureInfo.InvariantCulture))
            .Append("&sort_field=").Append(Uri.EscapeDataString(query.SortField))
            .Append("&sort_dir=").Append(Uri.EscapeDataString(query.SortDir));
        if (!string.IsNullOrWhiteSpace(query.Statuses))
        {
            builder.Append("&statuses=").Append(Uri.EscapeDataString(query.Statuses));
        }

        if (!string.IsNullOrWhiteSpace(query.ObjectIds))
        {
            builder.Append("&object_ids=").Append(Uri.EscapeDataString(query.ObjectIds));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&search=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketListPage>(response, cancellationToken);
    }

    public async Task<HubTicketRequest> GetTicketRequestAsync(
        long requestId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketRequest>(response, cancellationToken);
    }

    public async Task<HubTicketRequest> ChangeTicketStatusAsync(
        long requestId,
        string newStatus,
        int expectedVersion,
        string? comment,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(newStatus);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture) + "/status";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    new_status = newStatus,
                    expected_version = expectedVersion,
                    comment,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketRequest>(response, cancellationToken);
    }

    public async Task<HubTicketCommentPage> GetTicketCommentsAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture)
            + "/comments?page=" + page.ToString(CultureInfo.InvariantCulture)
            + "&page_size=" + pageSize.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketCommentPage>(response, cancellationToken);
    }

    public async Task<HubTicketHistoryPage> GetTicketHistoryAsync(
        long requestId,
        int page,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture)
            + "/history?page=" + page.ToString(CultureInfo.InvariantCulture)
            + "&page_size=" + pageSize.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketHistoryPage>(response, cancellationToken);
    }

    public async Task<HubTicketComment> AddTicketCommentAsync(
        long requestId,
        string text,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture) + "/comments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { text, comment_type = "normal" });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketComment>(response, cancellationToken);
    }

    public async Task<HubTicketAttachmentList> GetTicketAttachmentsAsync(
        long requestId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture) + "/attachments";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketAttachmentList>(response, cancellationToken);
    }

    public async Task<string> DownloadTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture)
            + "/attachments/" + Uri.EscapeDataString(attachmentId);
        // ResponseHeadersRead: тело стримится в destination — паттерн DownloadDocflowFileAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    public async Task<HubTicketObjectList> GetTicketObjectsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "tickets/objects", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketObjectList>(response, cancellationToken);
    }

    public async Task<HubTicketRequest> CreateTicketRequestAsync(
        HubCreateTicketRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "tickets/requests", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    employee_id = request.EmployeeId,
                    object_id = request.ObjectId,
                    status = request.Status,
                    submitted_at = request.SubmittedAt,
                    departure_date = request.DepartureDate,
                    arrival_date = request.ArrivalDate,
                    route = request.Route,
                    note = request.Note,
                    is_urgent = request.IsUrgent,
                    source = request.Source,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketRequest>(response, cancellationToken);
    }

    public async Task<HubTicketEmployeePage> GetTicketEmployeesAsync(
        string? search,
        int pageSize,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/employees?page_size=")
            .Append(pageSize.ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(search))
        {
            builder.Append("&search=").Append(Uri.EscapeDataString(search.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketEmployeePage>(response, cancellationToken);
    }

    public async Task<HubTicketZupPersonList> SearchTicketZupEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/employees/zup-search?q=" + Uri.EscapeDataString(query.Trim())
            + "&limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketZupPersonList>(response, cancellationToken);
    }

    public async Task<HubTicketEmployee> EnsureTicketEmployeeFromZupAsync(
        string employeeCode,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(employeeCode);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "tickets/employees/from-zup", token, deviceId);
                request.Content = CreateJsonContent(new { employee_code = employeeCode });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketEmployee>(response, cancellationToken);
    }

    public async Task<HubTicketAttachment> UploadTicketAttachmentAsync(
        long requestId,
        string fileName,
        Stream content,
        string fileType,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileType);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture) + "/attachments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new StreamContent(content);
                fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse("application/octet-stream");
                form.Add(fileContent, "file", fileName);
                form.Add(new StringContent(fileType, Encoding.UTF8), "file_type");
                request.Content = form;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketAttachment>(response, cancellationToken);
    }

    public async Task<IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>> GetTicketKanbanAsync(
        string? objectIds,
        string? assigneeIds,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/kanban");
        var separator = '?';
        if (!string.IsNullOrWhiteSpace(objectIds))
        {
            builder.Append(separator).Append("object_ids=").Append(Uri.EscapeDataString(objectIds));
            separator = '&';
        }

        if (!string.IsNullOrWhiteSpace(assigneeIds))
        {
            builder.Append(separator).Append("assignee_ids=").Append(Uri.EscapeDataString(assigneeIds));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        var kanban = await ReadJsonAsync<Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>>(
            response, cancellationToken);
        return kanban;
    }

    public async Task<HubTicketsDashboard> GetTicketDashboardAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "tickets/dashboard", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketsDashboard>(response, cancellationToken);
    }

    // ---- Адресная книга ----

    public async Task<HubAddressBookPage> SearchAddressBookAsync(
        HubAddressBookQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("address-book/search?limit=")
            .Append(query.Limit.ToString(CultureInfo.InvariantCulture));
        if (query.Offset > 0)
        {
            builder.Append("&offset=").Append(query.Offset.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Department))
        {
            builder.Append("&department=").Append(Uri.EscapeDataString(query.Department.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.City))
        {
            builder.Append("&city=").Append(Uri.EscapeDataString(query.City.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAddressBookPage>(response, cancellationToken);
    }

    public async Task<HubAddressBookFilters> GetAddressBookFiltersAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "address-book/filters", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAddressBookFilters>(response, cancellationToken);
    }

    // ---- Структура компании ----

    public async Task<HubCompanyStructureTree> GetCompanyStructureTreeAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = includeInactive
            ? "company-structure/tree?include_inactive=true"
            : "company-structure/tree";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubCompanyStructureTree>(response, cancellationToken);
    }

    public async Task<HubCompanyStructurePeople> GetCompanyStructureNodePeopleAsync(
        string nodeId,
        int limit,
        bool includeDescendants,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "company-structure/nodes/" + Uri.EscapeDataString(nodeId)
            + "/people?limit=" + limit.ToString(CultureInfo.InvariantCulture)
            + "&include_descendants=" + (includeDescendants ? "true" : "false");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubCompanyStructurePeople>(response, cancellationToken);
    }

    public async Task<HubCompanyStructureSearchResult> SearchCompanyStructureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "company-structure/search?q=" + Uri.EscapeDataString(query.Trim())
            + "&limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubCompanyStructureSearchResult>(response, cancellationToken);
    }

    // ---- ИТ-объекты ----

    public async Task<HubItObjectList> GetItObjectsAsync(
        string? query,
        bool onlyMine,
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects"
            + "?q=" + Uri.EscapeDataString((query ?? string.Empty).Trim())
            + "&mine=" + (onlyMine ? "true" : "false")
            + "&hidden=" + (includeHidden ? "true" : "false");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectList>(response, cancellationToken);
    }

    public async Task<HubItObjectDetail> GetItObjectAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectDetail>(response, cancellationToken);
    }

    public async Task<HubItObjectComputersPage> GetItObjectComputersAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef) + "/computers";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectComputersPage>(response, cancellationToken);
    }

    /// <summary>
    /// GET /it-objects/{objectRef}/computers/{mac} — карточка ПК объекта;
    /// ответ — тот же mobile-safe detail, что у GET /inventory/computers/{mac}.
    /// </summary>
    public async Task<HubComputer> GetItObjectComputerAsync(
        string objectRef,
        string macAddress,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(macAddress);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef)
            + "/computers/" + Uri.EscapeDataString(macAddress.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubComputer>(response, cancellationToken);
    }

    public async Task<HubItObjectInventoryPage> GetItObjectInventoryAsync(
        string objectRef,
        int page,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef)
            + "/inventory?page=" + page.ToString(CultureInfo.InvariantCulture)
            + "&limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectInventoryPage>(response, cancellationToken);
    }

    public async Task<HubItObjectMonitoringOverview> GetItObjectMonitoringAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef) + "/monitoring";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectMonitoringOverview>(response, cancellationToken);
    }

    /// <summary>
    /// GET /it-objects/{objectRef}/monitoring/targets/{targetId}/latency-history?hours=
    /// — история задержки устройства мониторинга объекта.
    /// </summary>
    public async Task<HubMonitoringLatencyHistory> GetItObjectMonitoringLatencyHistoryAsync(
        string objectRef,
        string targetId,
        int hours,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(targetId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef)
            + "/monitoring/targets/" + Uri.EscapeDataString(targetId.Trim())
            + "/latency-history?hours=" + hours.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMonitoringLatencyHistory>(response, cancellationToken);
    }

    public async Task<HubItObjectNetmapVersionsResponse> GetItObjectNetmapVersionsAsync(
        string objectRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef) + "/netmap/versions";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectNetmapVersionsResponse>(response, cancellationToken);
    }

    /// <summary>
    /// GET /it-objects/{objectRef}/passwords/audit?limit= — журнал аудита
    /// секретов объекта; требует manage-доступ к разделу passwords.
    /// </summary>
    public async Task<HubItObjectPasswordAuditResponse> GetItObjectPasswordsAuditAsync(
        string objectRef,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "it-objects/" + Uri.EscapeDataString(objectRef)
            + "/passwords/audit?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubItObjectPasswordAuditResponse>(response, cancellationToken);
    }

    // ---- Сети ----

    public async Task<HubNetworkBranchList> GetNetworkBranchesAsync(
        string? city,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/branches?city="
            + Uri.EscapeDataString(string.IsNullOrWhiteSpace(city) ? "tmn" : city.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNetworkBranchList>(response, cancellationToken);
    }

    public async Task<HubNetworkOverview> GetNetworkBranchOverviewAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/branches/" + branchId.ToString(CultureInfo.InvariantCulture) + "/overview";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNetworkOverview>(response, cancellationToken);
    }

    public async Task<HubNetworkDeviceList> GetNetworkDevicesAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/branches/" + branchId.ToString(CultureInfo.InvariantCulture) + "/devices";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNetworkDeviceList>(response, cancellationToken);
    }

    public async Task<HubNetworkMapList> GetNetworkMapsAsync(
        long branchId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/branches/" + branchId.ToString(CultureInfo.InvariantCulture) + "/maps";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNetworkMapList>(response, cancellationToken);
    }

    public async Task<string> DownloadNetworkMapFileAsync(
        long mapId,
        string? render,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/maps/" + mapId.ToString(CultureInfo.InvariantCulture) + "/file";
        if (!string.IsNullOrWhiteSpace(render))
        {
            relative += "?render=" + Uri.EscapeDataString(render.Trim());
        }

        // ResponseHeadersRead: тело стримится в destination, не буферизуется в память —
        // паттерн DownloadChatAttachmentAsync/DownloadDocflowFileAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    public async Task<string> DownloadNetworkMapPdfAsync(
        long mapId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "networks/maps/" + mapId.ToString(CultureInfo.InvariantCulture) + "/export-pdf";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    // ---- Компьютеры ----

    /// <summary>
    /// GET /inventory/computers/search — имена параметров как у mobile-hub
    /// (computersApi.ts): scope/q/search_fields/status/outlook_status/branch/
    /// changed_only/hidden_only/hide_vm_172 + сортировка и offset-пагинация.
    /// mobile_safe=true и include_summary=false фиксированы для нативного клиента.
    /// </summary>
    public async Task<HubComputersPage> SearchComputersAsync(
        HubComputersQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("inventory/computers/search?scope=")
            .Append(string.Equals(query.Scope, "all", StringComparison.OrdinalIgnoreCase)
                ? "all"
                : "selected")
            .Append("&limit=").Append(query.Limit.ToString(CultureInfo.InvariantCulture));
        if (query.Offset > 0)
        {
            builder.Append("&offset=").Append(query.Offset.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.SearchFields))
        {
            builder.Append("&search_fields=").Append(Uri.EscapeDataString(query.SearchFields.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            builder.Append("&status=").Append(Uri.EscapeDataString(query.Status.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.OutlookStatus))
        {
            builder.Append("&outlook_status=").Append(Uri.EscapeDataString(query.OutlookStatus.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Branch))
        {
            builder.Append("&branch=").Append(Uri.EscapeDataString(query.Branch.Trim()));
        }

        if (query.ChangedOnly)
        {
            builder.Append("&changed_only=true");
        }

        if (query.HiddenOnly)
        {
            builder.Append("&hidden_only=true");
        }

        if (query.HideVm172)
        {
            builder.Append("&hide_vm_172=true");
        }

        if (!string.IsNullOrWhiteSpace(query.SortBy))
        {
            builder.Append("&sort_by=").Append(Uri.EscapeDataString(query.SortBy.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.SortDir))
        {
            builder.Append("&sort_dir=").Append(Uri.EscapeDataString(query.SortDir.Trim()));
        }

        builder.Append("&include_summary=false&mobile_safe=true");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubComputersPage>(response, cancellationToken);
    }

    /// <summary>GET /inventory/computers/{mac}?scope=&mobile_safe=true — карточка по MAC.</summary>
    public async Task<HubComputer> GetComputerDetailAsync(
        string macAddress,
        string? scope,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(macAddress);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/computers/" + Uri.EscapeDataString(macAddress.Trim())
            + "?scope=" + (string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase)
                ? "all"
                : "selected")
            + "&mobile_safe=true";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubComputer>(response, cancellationToken);
    }

    // ---- База ITINVENT ----

    /// <summary>
    /// GET /equipment/search/universal — имена параметров как у веб
    /// equipmentSearch.js (q/field/type_no/page/limit); пустые значения
    /// опускаются. Пустой q без type_no бэкенд считает пустой выдачей —
    /// фильтр по типу уходит отдельным параметром, как в Database.jsx.
    /// </summary>
    public async Task<HubEquipmentSearchPage> SearchEquipmentAsync(
        HubEquipmentSearchQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var page = query.Page > 0 ? query.Page : 1;
        var limit = query.Limit > 0 ? query.Limit : 50;
        var builder = new StringBuilder("equipment/search/universal?page=")
            .Append(page.ToString(CultureInfo.InvariantCulture))
            .Append("&limit=").Append(limit.ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Field))
        {
            builder.Append("&field=").Append(Uri.EscapeDataString(query.Field.Trim()));
        }

        if (query.TypeNo is > 0)
        {
            builder.Append("&type_no=").Append(query.TypeNo.Value.ToString(CultureInfo.InvariantCulture));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentSearchPage>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/{inv_no} — карточка по инвентарному номеру. Сервер сам
    /// приводит параметр через float(), поэтому передаём номер как есть.
    /// </summary>
    public async Task<HubEquipmentItem> GetEquipmentByInvAsync(
        string invNo,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(invNo);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/" + Uri.EscapeDataString(invNo.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentItem>(response, cancellationToken);
    }

    /// <summary>GET /equipment/{item_id}/photos — метаданные фото карточки.</summary>
    public async Task<HubEquipmentPhotoList> GetEquipmentPhotosAsync(
        long itemId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/" + itemId.ToString(CultureInfo.InvariantCulture) + "/photos";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoList>(response, cancellationToken);
    }

    /// <summary>GET /equipment/{inv_no}/history — история перемещений CI_HISTORY.</summary>
    public async Task<HubEquipmentHistoryResponse> GetEquipmentHistoryAsync(
        string invNo,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(invNo);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/" + Uri.EscapeDataString(invNo.Trim()) + "/history";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentHistoryResponse>(response, cancellationToken);
    }

    /// <summary>GET /equipment/types — справочник типов (ci_type фильтрует клиент).</summary>
    public async Task<IReadOnlyList<HubEquipmentType>> GetEquipmentTypesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "equipment/types", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubEquipmentType>>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/search/employee?q=&page=1&limit= — подбор сотрудника
    /// ФИО/отдел для передачи (имена параметров как у веб search/employee).
    /// </summary>
    public async Task<HubEquipmentEmployeePage> SearchEquipmentEmployeesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var pageSize = limit > 0 ? limit : 20;
        var relative = "equipment/search/employee?page=1&limit="
            + pageSize.ToString(CultureInfo.InvariantCulture)
            + "&q=" + Uri.EscapeDataString(query.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentEmployeePage>(response, cancellationToken);
    }

    /// <summary>GET /equipment/branches — справочник филиалов.</summary>
    public async Task<IReadOnlyList<HubEquipmentBranch>> GetEquipmentBranchesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "equipment/branches", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubEquipmentBranch>>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/locations/{branch_id} — локации с приоритетом филиала;
    /// без филиала — плоский GET /equipment/locations (весь справочник).
    /// </summary>
    public async Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentLocationsAsync(
        string? branchId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = string.IsNullOrWhiteSpace(branchId)
            ? "equipment/locations"
            : "equipment/locations/" + Uri.EscapeDataString(branchId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubEquipmentLocation>>(response, cancellationToken);
    }

    /// <summary>
    /// POST /equipment/transfer — тело как у веб transferModel.buildTransferMovePayload:
    /// inv_nos/new_employee(+_no/_dept)/branch_no/loc_no/comment + operation_id.
    /// Ответ job-based — queued досматриваем через GetTransferActJobAsync.
    /// </summary>
    public async Task<HubTransferExecuteResponse> TransferEquipmentAsync(
        HubEquipmentTransferRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/transfer", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    operation_id = request.OperationId,
                    inv_nos = request.InvNos,
                    new_employee = request.NewEmployee,
                    new_employee_no = request.NewEmployeeNo,
                    new_employee_dept = request.NewEmployeeDept,
                    branch_no = request.BranchNo,
                    loc_no = request.LocNo,
                    comment = request.Comment,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTransferExecuteResponse>(response, cancellationToken);
    }

    /// <summary>GET /equipment/transfer/act-jobs/{job_id} — статус job передачи.</summary>
    public async Task<HubTransferExecuteResponse> GetTransferActJobAsync(
        string jobId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/transfer/act-jobs/" + Uri.EscapeDataString(jobId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTransferExecuteResponse>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/transfer/act/{act_id} — файл акта: тело стримится
    /// в destination — паттерн DownloadTicketAttachmentAsync.
    /// </summary>
    public async Task<string> DownloadTransferActAsync(
        string actId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/transfer/act/" + Uri.EscapeDataString(actId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    // ---- Доступ к группам AD ----

    public async Task<HubGroupsAccessStatus> GetGroupsAccessStatusAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "groups-access/status", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubGroupsAccessStatus>(response, cancellationToken);
    }

    /// <summary>
    /// GET /groups-access/matrix-grid — имена параметров как у веб groupsAccess.js
    /// (getMatrixGrid): branch/folder_q/user_q опускаются пустыми, лимиты
    /// передаются всегда (backend по умолчанию 250×500).
    /// </summary>
    public async Task<HubGroupsAccessMatrixGrid> GetGroupsAccessMatrixGridAsync(
        HubGroupsAccessMatrixQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("groups-access/matrix-grid?group_limit=")
            .Append(query.GroupLimit.ToString(CultureInfo.InvariantCulture))
            .Append("&user_limit=").Append(query.UserLimit.ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Branch))
        {
            builder.Append("&branch=").Append(Uri.EscapeDataString(query.Branch.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.FolderQuery))
        {
            builder.Append("&folder_q=").Append(Uri.EscapeDataString(query.FolderQuery.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.UserQuery))
        {
            builder.Append("&user_q=").Append(Uri.EscapeDataString(query.UserQuery.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubGroupsAccessMatrixGrid>(response, cancellationToken);
    }

    /// <summary>GET /groups-access/group?dn= — участники группы из снимка.</summary>
    public async Task<HubGroupsAccessGroupDetail> GetGroupsAccessGroupDetailAsync(
        string groupDn,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(groupDn);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "groups-access/group?dn=" + Uri.EscapeDataString(groupDn.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubGroupsAccessGroupDetail>(response, cancellationToken);
    }

    // ---- Терминалы ВКС ----

    public async Task<IReadOnlyList<HubVcsComputer>> GetVcsComputersAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "vcs/computers", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubVcsComputer>>(response, cancellationToken);
    }

    /// <summary>POST /vcs/computers/{id}/launch-token — тело не нужно, ответ {token, ttl}.</summary>
    public async Task<HubVcsLaunchToken> CreateVcsLaunchTokenAsync(
        string computerId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(computerId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "vcs/computers/" + Uri.EscapeDataString(computerId.Trim()) + "/launch-token";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubVcsLaunchToken>(response, cancellationToken);
    }

    // ---- Мониторинг ----

    /// <summary>GET /monitoring/overview — цели + состояние сборщика.</summary>
    public async Task<HubMonitoringOverview> GetMonitoringOverviewAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "monitoring/overview", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMonitoringOverview>(response, cancellationToken);
    }

    /// <summary>GET /monitoring/targets/{id} — деталь: interfaces[] + events[].</summary>
    public async Task<HubMonitoringTarget> GetMonitoringTargetAsync(
        string targetId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(targetId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "monitoring/targets/" + Uri.EscapeDataString(targetId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMonitoringTarget>(response, cancellationToken);
    }

    // ---- МФУ и принтеры ----

    /// <summary>GET /mfu/devices — весь парк МФУ выбранной БД с рантайм-статусами.</summary>
    public async Task<HubMfuDeviceList> GetMfuDevicesAsync(
        int periodDays,
        int recentLimit,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mfu/devices?period_days=" + periodDays.ToString(CultureInfo.InvariantCulture)
            + "&recent_limit=" + recentLimit.ToString(CultureInfo.InvariantCulture)
            + "&limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMfuDeviceList>(response, cancellationToken);
    }

    /// <summary>GET /mfu/pages/monthly — печать по месяцам по ключу устройства.</summary>
    public async Task<HubMfuMonthlyPages> GetMfuMonthlyPagesAsync(
        string deviceKey,
        int months,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(deviceKey);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mfu/pages/monthly?device_key=" + Uri.EscapeDataString(deviceKey.Trim())
            + "&months=" + months.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMfuMonthlyPages>(response, cancellationToken);
    }

    /// <summary>GET /json/works/mfu/statistics — работы МФУ за период из JSON-журнала.</summary>
    public async Task<HubMfuWorksStatistics> GetMfuWorksStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/mfu/statistics?period_days=" + periodDays.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMfuWorksStatistics>(response, cancellationToken);
    }

    // ---- Статистика работ ----

    /// <summary>GET /json/works/cleaning/statistics — покрытие чистки ПК за период.</summary>
    public async Task<HubPcCleaningStatistics> GetPcCleaningStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cleaning/statistics?period_days=" + periodDays.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubPcCleaningStatistics>(response, cancellationToken);
    }

    /// <summary>GET /json/works/battery/statistics — замены батарей ИБП за период.</summary>
    public async Task<HubBatteryStatistics> GetBatteryStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/battery/statistics?period_days=" + periodDays.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubBatteryStatistics>(response, cancellationToken);
    }

    /// <summary>GET /json/works/pc-components/statistics — замены комплектующих ПК за период.</summary>
    public async Task<HubPcComponentsStatistics> GetPcComponentsStatisticsAsync(
        int periodDays,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/pc-components/statistics?period_days=" + periodDays.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubPcComponentsStatistics>(response, cancellationToken);
    }

    public async Task<HubChatConversationList> GetChatConversationsAsync(
        string? cursor,
        int limit,
        string? query,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(cursor))
        {
            relative += "&cursor=" + Uri.EscapeDataString(cursor);
        }

        if (!string.IsNullOrWhiteSpace(query))
        {
            relative += "&q=" + Uri.EscapeDataString(query);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationList>(response, cancellationToken);
    }

    public async Task<HubChatMessageList> GetChatMessagesAsync(
        string conversationId,
        string? beforeMessageId,
        string? afterMessageId,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(beforeMessageId))
        {
            relative += "&before_message_id=" + Uri.EscapeDataString(beforeMessageId);
        }

        if (!string.IsNullOrWhiteSpace(afterMessageId))
        {
            relative += "&after_message_id=" + Uri.EscapeDataString(afterMessageId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageList>(response, cancellationToken);
    }

    public async Task<HubChatMessage> SendChatMessageAsync(
        string conversationId,
        string body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(body);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/messages";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    body,
                    body_format = "plain",
                    client_message_id = clientMessageId,
                    reply_to_message_id = replyToMessageId,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<HubChatMessage> EditChatMessageAsync(
        string conversationId,
        string messageId,
        string body,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(body);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { body, body_format = "plain" });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<HubChatMessage> DeleteChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Delete, relative, token, deviceId);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<HubChatReactionToggle> ToggleChatMessageReactionAsync(
        string conversationId,
        string messageId,
        string emoji,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(emoji);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId) + "/reactions";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { emoji });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatReactionToggle>(response, cancellationToken);
    }

    public async Task MarkChatConversationReadAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/read";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { message_id = messageId });
                return request;
            },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubChatConversation> UpdateChatConversationSettingsAsync(
        string conversationId,
        bool? isPinned,
        bool? isMuted,
        bool? isArchived,
        DateTimeOffset? mutedUntil,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/settings";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    is_pinned = isPinned,
                    is_muted = isMuted,
                    is_archived = isArchived,
                    muted_until = mutedUntil,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatMessageSearchResult> SearchChatMessagesAsync(
        string conversationId,
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/search?limit=" + limit.ToString(CultureInfo.InvariantCulture)
            + "&q=" + Uri.EscapeDataString(query ?? string.Empty);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageSearchResult>(response, cancellationToken);
    }

    public async Task<HubChatThreadBootstrap> GetChatThreadBootstrapAsync(
        string conversationId,
        string? focusMessageId,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/thread-bootstrap?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(focusMessageId))
        {
            relative += "&focus_message_id=" + Uri.EscapeDataString(focusMessageId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatThreadBootstrap>(response, cancellationToken);
    }

    public async Task<HubChatPinnedMessageList> GetChatPinnedMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/pinned-messages";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatPinnedMessageList>(response, cancellationToken);
    }

    public Task<HubChatPinnedMessageList> PinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken) =>
        SendPinnedMessageChangeAsync(conversationId, messageId, HttpMethod.Put, cancellationToken);

    public Task<HubChatPinnedMessageList> UnpinChatMessageAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken) =>
        SendPinnedMessageChangeAsync(conversationId, messageId, HttpMethod.Delete, cancellationToken);

    private async Task<HubChatPinnedMessageList> SendPinnedMessageChangeAsync(
        string conversationId,
        string messageId,
        HttpMethod method,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/pinned-messages/" + Uri.EscapeDataString(messageId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(method, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatPinnedMessageList>(response, cancellationToken);
    }

    public async Task<HubChatUploadSession> CreateChatUploadSessionAsync(
        string conversationId,
        string? body,
        string? replyToMessageId,
        string? clientMessageId,
        IReadOnlyList<HubChatUploadFileRequest> files,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/upload-sessions";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    body,
                    reply_to_message_id = replyToMessageId,
                    client_message_id = clientMessageId,
                    files,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatUploadSession>(response, cancellationToken);
    }

    public async Task<HubChatUploadChunk> UploadChatChunkAsync(
        string sessionId,
        string fileId,
        int chunkIndex,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionId);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/upload-sessions/" + Uri.EscapeDataString(sessionId)
            + "/files/" + Uri.EscapeDataString(fileId)
            + "/chunks/" + chunkIndex.ToString(CultureInfo.InvariantCulture)
            + "?offset=" + offset.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = new ReadOnlyMemoryContent(data);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatUploadChunk>(response, cancellationToken);
    }

    public async Task<HubChatMessage> CompleteChatUploadSessionAsync(
        string sessionId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/upload-sessions/" + Uri.EscapeDataString(sessionId) + "/complete";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<string> DownloadChatAttachmentAsync(
        string messageId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/messages/" + Uri.EscapeDataString(messageId)
            + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/file";
        // ResponseHeadersRead: тело стримится в destination, не буферизуется в память;
        // per-request таймаут покрывает только заголовки, сам поток живёт до токена вызова.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    private static string ParseContentDispositionFileName(string? headerValue)
    {
        var name = (headerValue ?? string.Empty).Trim().Trim('"');
        if (name.StartsWith("UTF-8''", StringComparison.OrdinalIgnoreCase))
        {
            try
            {
                name = Uri.UnescapeDataString(name[7..]);
            }
            catch (UriFormatException)
            {
            }
        }

        foreach (var invalid in Path.GetInvalidFileNameChars())
        {
            name = name.Replace(invalid, '_');
        }

        return name;
    }

    public async Task<HubChatMessage> ForwardChatMessageAsync(
        string conversationId,
        string sourceMessageId,
        string? body,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(sourceMessageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/messages/forward";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    source_message_id = sourceMessageId,
                    body,
                    body_format = "plain",
                    client_message_id = clientMessageId,
                    reply_to_message_id = replyToMessageId,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<HubChatPollVoteResult> VoteChatPollAsync(
        string conversationId,
        string messageId,
        int optionIndex,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId) + "/poll-vote";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { option_index = optionIndex });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatPollVoteResult>(response, cancellationToken);
    }

    public async Task<HubChatPollVoteResult> CloseChatPollAsync(
        string conversationId,
        string messageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId) + "/poll-close";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatPollVoteResult>(response, cancellationToken);
    }

    public async Task<HubChatMessageReads> GetChatMessageReadsAsync(
        string messageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/messages/" + Uri.EscapeDataString(messageId) + "/reads";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageReads>(response, cancellationToken);
    }

    public async Task<HubChatLinkPreview> GetChatLinkPreviewAsync(
        string url,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(url);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/link-preview?url=" + Uri.EscapeDataString(url);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatLinkPreview>(response, cancellationToken);
    }

    public async Task<HubChatConversationAttachmentPage> GetChatConversationAttachmentsAsync(
        string conversationId,
        string kind,
        int limit,
        string? beforeAttachmentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(kind);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/attachments?kind=" + Uri.EscapeDataString(kind)
            + "&limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(beforeAttachmentId))
        {
            relative += "&before_attachment_id=" + Uri.EscapeDataString(beforeAttachmentId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationAttachmentPage>(response, cancellationToken);
    }

    public async Task<HubChatExportResult> ExportChatConversationAsync(
        string conversationId,
        string format,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentNullException.ThrowIfNull(destination);
        var normalizedFormat = string.Equals(format, "json", StringComparison.OrdinalIgnoreCase)
            ? "json"
            : "txt";
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/export?format=" + normalizedFormat;
        // ResponseHeadersRead: тело стримится в destination — паттерн DownloadChatAttachmentAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return new HubChatExportResult
        {
            FileName = ParseContentDispositionFileName(
                response.Content.Headers.ContentDisposition?.FileNameStar
                ?? response.Content.Headers.ContentDisposition?.FileName),
            MessagesCount = ReadIntHeader(response, "X-Chat-Export-Messages"),
            Truncated = string.Equals(
                ReadFirstHeader(response, "X-Chat-Export-Truncated"), "1", StringComparison.Ordinal),
        };
    }

    private static string? ReadFirstHeader(HttpResponseMessage response, string name) =>
        response.Headers.TryGetValues(name, out var values) ? values.FirstOrDefault() : null;

    private static int ReadIntHeader(HttpResponseMessage response, string name) =>
        int.TryParse(
            ReadFirstHeader(response, name),
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var value)
            ? value
            : 0;

    public async Task<HubChatGlobalSearchResult> SearchChatGlobalMessagesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/messages/search?limit=" + limit.ToString(CultureInfo.InvariantCulture)
            + "&q=" + Uri.EscapeDataString(query ?? string.Empty);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatGlobalSearchResult>(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateNotesConversationAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, "chat/conversations/notes", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateDirectConversationAsync(
        int peerUserId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "chat/conversations/direct", token, deviceId);
                request.Content = CreateJsonContent(new { peer_user_id = peerUserId });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateChatGroupConversationAsync(
        string title,
        IReadOnlyList<int> memberUserIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        ArgumentNullException.ThrowIfNull(memberUserIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "chat/conversations/group", token, deviceId);
                request.Content = CreateJsonContent(new { title, member_user_ids = memberUserIds });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> GetChatConversationMembersAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> AddChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/members";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { member_user_ids = new[] { userId } });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> RemoveChatConversationMemberAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/members/" + userId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task LeaveChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/leave";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { successor_user_id = (int?)null });
                return request;
            },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> TransferChatConversationOwnershipAsync(
        string conversationId,
        int ownerUserId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/ownership";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { owner_user_id = ownerUserId });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatUserList> GetChatUsersAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/users?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(query))
        {
            relative += "&q=" + Uri.EscapeDataString(query.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatUserList>(response, cancellationToken);
    }

    public async Task<HubWsTicket> GetChatWsTicketAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, "chat/ws-ticket", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubWsTicket>(response, cancellationToken);
    }

    // ---- Мои файлы ----

    /// <summary>Таймаут одного чанка загрузки (как у web-клиента: 5 минут).</summary>
    private static readonly TimeSpan MyFileChunkUploadTimeout = TimeSpan.FromMinutes(5);
    /// <summary>Таймаут complete: backend копирует/подсчитывает итоговый файл.</summary>
    private static readonly TimeSpan MyFileUploadCompleteTimeout = TimeSpan.FromMinutes(2);

    public async Task<HubMyFileLibraryList> GetMyFileLibrariesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "my-files/libraries", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileLibraryList>(response, cancellationToken);
    }

    public async Task<HubMyFileListPage> GetMyFilesAsync(
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files";
        var separator = '?';
        if (!string.IsNullOrWhiteSpace(folderId))
        {
            relative += separator + "folder_id=" + Uri.EscapeDataString(folderId.Trim());
            separator = '&';
        }
        if (!string.IsNullOrWhiteSpace(libraryId))
        {
            relative += separator + "library_id=" + Uri.EscapeDataString(libraryId.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileListPage>(response, cancellationToken);
    }

    public async Task<HubMyFileFolder> CreateMyFileFolderAsync(
        string name,
        string? parentId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "my-files/folders", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    name = name.Trim(),
                    parent_id = parentId,
                    library_id = libraryId,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileFolder>(response, cancellationToken);
    }

    public async Task<HubMyFileFolder> RenameMyFileFolderAsync(
        string folderId,
        string name,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/folders/" + Uri.EscapeDataString(folderId.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { name = name.Trim() });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileFolder>(response, cancellationToken);
    }

    public async Task<HubMyFileItem> RenameMyFileAsync(
        string fileId,
        string name,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { name = name.Trim() });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileItem>(response, cancellationToken);
    }

    public async Task DeleteMyFileFolderAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/folders/" + Uri.EscapeDataString(folderId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task DeleteMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<string> DownloadMyFileAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var grantPath = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/download-grant";
        using var grantResponse = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, grantPath, token, deviceId),
            cancellationToken);
        var grant = await ReadJsonAsync<HubMyFileDownloadGrant>(grantResponse, cancellationToken);
        var relative = NormalizeMyFilesDownloadPath(grant.DownloadPath);
        // ResponseHeadersRead: тело стримится в destination — паттерн DownloadTicketAttachmentAsync.
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    /// <summary>
    /// download_path из grant-ответа («/my-files/download-grant/{token}» или
    /// «/api/v1/my-files/…») → относительный URI от _apiBaseUri. Ведущий «/» нельзя
    /// передавать в new Uri(base, rel) — он сбрасывал бы префикс api/v1.
    /// </summary>
    private static string NormalizeMyFilesDownloadPath(string? downloadPath)
    {
        var path = (downloadPath ?? string.Empty).Trim().TrimStart('/');
        const string apiPrefix = "api/v1/";
        if (path.StartsWith(apiPrefix, StringComparison.OrdinalIgnoreCase))
        {
            path = path[apiPrefix.Length..];
        }
        if (!path.StartsWith("my-files/", StringComparison.Ordinal))
        {
            throw new HubApiException(
                HubApiErrorKind.Transport,
                "Malformed download grant path in API response.");
        }
        return path;
    }

    public async Task<HubMyFileUploadSession> CreateMyFileUploadSessionAsync(
        HubMyFileUploadSessionCreate request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(
                    HttpMethod.Post, "my-files/upload-sessions", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileUploadSession>(response, cancellationToken);
    }

    public async Task<HubMyFileUploadSession> UploadMyFileChunkAsync(
        string fileId,
        long offset,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/upload-sessions/" + Uri.EscapeDataString(fileId.Trim())
            + "/chunks?offset=" + offset.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = new ReadOnlyMemoryContent(data);
                request.Content.Headers.ContentType =
                    new MediaTypeHeaderValue("application/octet-stream");
                return request;
            },
            cancellationToken,
            requestTimeout: MyFileChunkUploadTimeout);
        return await ReadJsonAsync<HubMyFileUploadSession>(response, cancellationToken);
    }

    public async Task<HubMyFileItem> CompleteMyFileUploadSessionAsync(
        string fileId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/upload-sessions/" + Uri.EscapeDataString(fileId.Trim())
            + "/complete";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken,
            requestTimeout: MyFileUploadCompleteTimeout);
        return await ReadJsonAsync<HubMyFileItem>(response, cancellationToken);
    }

    public async Task CancelMyFileUploadSessionAsync(
        string fileId,
        string? reason,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/upload-sessions/" + Uri.EscapeDataString(fileId.Trim());
        if (!string.IsNullOrWhiteSpace(reason))
        {
            relative += "?reason=" + Uri.EscapeDataString(reason.Trim());
        }
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubMyFileShare> CreateMyFileShareAsync(
        string fileId,
        bool rotate,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/share"
            + (rotate ? "?rotate=true" : string.Empty);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileShare>(response, cancellationToken);
    }

    public async Task RevokeMyFileShareAsync(
        string fileId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/share";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubMyFileShare> CreateMyFileFolderShareAsync(
        string folderId,
        bool rotate,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/folders/" + Uri.EscapeDataString(folderId.Trim()) + "/share"
            + (rotate ? "?rotate=true" : string.Empty);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileShare>(response, cancellationToken);
    }

    public async Task RevokeMyFileFolderShareAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/folders/" + Uri.EscapeDataString(folderId.Trim()) + "/share";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    // ---- База знаний ----

    public async Task<IReadOnlyList<HubKbCategory>> GetKbCategoriesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "kb/categories", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubKbCategory>>(response, cancellationToken);
    }

    public async Task<HubKbArticleListPage> GetKbArticlesAsync(
        HubKbArticleQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + query.Limit.ToString(CultureInfo.InvariantCulture),
            "offset=" + query.Offset.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            parts.Add("q=" + Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Category))
        {
            parts.Add("category=" + Uri.EscapeDataString(query.Category.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            parts.Add("status=" + Uri.EscapeDataString(query.Status.Trim()));
        }

        var relative = "kb/articles?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubKbArticleListPage>(response, cancellationToken);
    }

    public async Task<HubKbArticle> GetKbArticleAsync(
        string articleId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(articleId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "kb/articles/" + Uri.EscapeDataString(articleId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubKbArticle>(response, cancellationToken);
    }

    // ---- Администрирование ----

    public async Task<IReadOnlyList<HubAdminUser>> GetAdminUsersAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "auth/users", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubAdminUser>>(response, cancellationToken) ?? [];
    }

    public async Task<HubAdminDepartmentList> GetAdminDepartmentsAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = includeInactive
            ? "departments?include_inactive=true"
            : "departments";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAdminDepartmentList>(response, cancellationToken)
            ?? new HubAdminDepartmentList();
    }

    public async Task<HubAdminDepartmentMembers> GetAdminDepartmentMembersAsync(
        string departmentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(departmentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"departments/{Uri.EscapeDataString(departmentId)}/members";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAdminDepartmentMembers>(response, cancellationToken)
            ?? new HubAdminDepartmentMembers();
    }

    public async Task<IReadOnlyList<HubAdminAdCandidate>> GetAdminAdImportCandidatesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "ad-users/import-candidates", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubAdminAdCandidate>>(response, cancellationToken) ?? [];
    }

    public async Task<HubAdminAdSyncStatus> GetAdminAdSyncStatusAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "ad-users/sync-status", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAdminAdSyncStatus>(response, cancellationToken)
            ?? new HubAdminAdSyncStatus();
    }

    public async Task<HubAdminFeedbackPage> GetAdminFeedbackAsync(
        string? status,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("feedback?");
        if (!string.IsNullOrWhiteSpace(status))
        {
            builder.Append("status=").Append(Uri.EscapeDataString(status)).Append('&');
        }

        builder.Append("limit=").Append(limit.ToString(CultureInfo.InvariantCulture))
            .Append("&offset=").Append(offset.ToString(CultureInfo.InvariantCulture));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAdminFeedbackPage>(response, cancellationToken)
            ?? new HubAdminFeedbackPage();
    }

    public async Task<HubAdminRequestMetrics> GetAdminRequestMetricsAsync(
        int limit,
        string? sortBy,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"system/request-metrics?limit={limit.ToString(CultureInfo.InvariantCulture)}"
            + (string.IsNullOrWhiteSpace(sortBy)
                ? string.Empty
                : $"&sort_by={Uri.EscapeDataString(sortBy)}");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAdminRequestMetrics>(response, cancellationToken)
            ?? new HubAdminRequestMetrics();
    }

    public async Task<IReadOnlyList<HubAdminAiBot>> GetAdminAiBotsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "ai-bots", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubAdminAiBot>>(response, cancellationToken) ?? [];
    }

    // ---- Настройки ----

    public async Task<HubUser> GetCurrentUserAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "auth/me", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubUser>(response, cancellationToken);
    }

    public async Task<HubUserSettings> GetMySettingsAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "settings/me", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubUserSettings>(response, cancellationToken);
    }

    public async Task<HubUserSettings> UpdateMySettingsAsync(
        string themeMode,
        string fontFamily,
        double fontScale,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(themeMode);
        ArgumentException.ThrowIfNullOrWhiteSpace(fontFamily);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, "settings/me", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    theme_mode = themeMode,
                    font_family = fontFamily,
                    font_scale = fontScale,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubUserSettings>(response, cancellationToken);
    }

    public async Task<HubNotificationPreferences> GetNotificationPreferencesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(
                HttpMethod.Get, "settings/notifications/preferences", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNotificationPreferences>(response, cancellationToken);
    }

    public async Task<HubNotificationPreferences> UpdateNotificationPreferencesAsync(
        IReadOnlyDictionary<string, bool> patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(patch);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(
                    HttpMethod.Patch, "settings/notifications/preferences", token, deviceId);
                request.Content = CreateJsonContent(patch);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubNotificationPreferences>(response, cancellationToken);
    }

    public async Task<HubChangePasswordResult> ChangePasswordAsync(
        string oldPassword,
        string newPassword,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(oldPassword);
        ArgumentException.ThrowIfNullOrWhiteSpace(newPassword);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(
                    HttpMethod.Post, "auth/change-password", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    old_password = oldPassword,
                    new_password = newPassword,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChangePasswordResult>(response, cancellationToken);
    }

    public async Task<string?> GetAccessTokenAsync(CancellationToken cancellationToken)
    {
        var session = Volatile.Read(ref _session);
        if (session is null)
        {
            return null;
        }

        if (session.AccessTokenExpiresAtUtc <= DateTimeOffset.UtcNow + AccessTokenRefreshSkew)
        {
            session = await RefreshSessionAsync(session, cancellationToken);
        }

        return session.AccessToken;
    }

    private async Task PostEmptyAsync(string relativeUri, CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relativeUri, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubTaskDetail> GetTaskAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskDetail>(response, cancellationToken);
    }

    public async Task<HubTaskDetail> TransitionTaskAsync(
        long taskId,
        HubTaskTransition transition,
        string? comment,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var taskPath = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}";
        var relative = transition switch
        {
            HubTaskTransition.Start => $"{taskPath}/start",
            HubTaskTransition.Reopen => $"{taskPath}/reopen",
            HubTaskTransition.Submit => $"{taskPath}/submit",
            HubTaskTransition.Complete => $"{taskPath}/complete",
            HubTaskTransition.Approve or HubTaskTransition.Reject => $"{taskPath}/review",
            _ => throw new ArgumentOutOfRangeException(
                nameof(transition), transition, "Unknown task transition."),
        };

        HttpContent? CreateContent()
        {
            return transition switch
            {
                HubTaskTransition.Start => null,
                HubTaskTransition.Reopen => CreateJsonContent(new { }),
                HubTaskTransition.Complete => CreateJsonContent(new { comment }),
                HubTaskTransition.Approve => CreateJsonContent(new { decision = "approve", comment }),
                HubTaskTransition.Reject => CreateJsonContent(new { decision = "reject", comment }),
                HubTaskTransition.Submit => CreateSubmitContent(comment),
                _ => null,
            };
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateContent();
                return request;
            },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
        return await GetTaskAsync(taskId, cancellationToken);
    }

    public async Task LogoutAsync(CancellationToken cancellationToken)
    {
        var session = Volatile.Read(ref _session);
        if (session is not null)
        {
            try
            {
                var deviceId = await GetDeviceIdAsync(cancellationToken);
                using var request = CreateRequest(HttpMethod.Post, "auth/logout", session.AccessToken, deviceId);
                request.Content = CreateJsonContent(new { refresh_token = session.RefreshToken });
                using var response = await SendCoreAsync(request, cancellationToken);
            }
            catch (Exception exception) when (
                exception is not OperationCanceledException
                || !cancellationToken.IsCancellationRequested)
            {
                // Best-effort revoke: the local wipe below runs regardless.
            }
        }

        // Not a session expiry: a user-initiated logout must not raise SessionEnded.
        await _refreshLock.WaitAsync();
        try
        {
            await WipeSessionCoreAsync();
        }
        finally
        {
            _refreshLock.Release();
        }
    }

    /// <summary>
    /// Авторизованный GET картинки: относительный api-путь, серверная ссылка
    /// «/api/v1/…» или абсолютный URL того же origin — Bearer не уходит наружу.
    /// </summary>
    public async Task<byte[]> DownloadImageAsync(
        string uriOrPath,
        CancellationToken cancellationToken)
    {
        var relative = NormalizeImageRequestUri(uriOrPath);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        return await response.Content.ReadAsByteArrayAsync(cancellationToken);
    }

    /// <summary>
    /// Относительные пути резолвятся от /api/v1, ведущий «/» — от корня origin
    /// (это формат photo_url backend'а). Абсолютный http(s)-URL допустим только
    /// на свой origin: чужому хосту Bearer-токен не отдаём.
    /// </summary>
    private string NormalizeImageRequestUri(string uriOrPath)
    {
        var value = (uriOrPath ?? string.Empty).Trim();
        ArgumentException.ThrowIfNullOrWhiteSpace(value);
        if (!Uri.TryCreate(value, UriKind.Absolute, out var absolute)
            || (absolute.Scheme != Uri.UriSchemeHttp && absolute.Scheme != Uri.UriSchemeHttps))
        {
            return value;
        }

        if (!string.Equals(
                absolute.GetLeftPart(UriPartial.Authority),
                _baseUri.GetLeftPart(UriPartial.Authority),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new HubApiException(
                HubApiErrorKind.Transport,
                "Image URI points outside the hub origin.");
        }

        return value;
    }

    public void Dispose()
    {
        _httpClient.Dispose();
        _refreshLock.Dispose();
    }

    private async Task<HubLoginResult> CompleteLoginAsync(
        AuthTokenResponse payload,
        string deviceId,
        string userNameFallback,
        CancellationToken cancellationToken)
    {
        var status = payload.Status?.Trim();
        IReadOnlyList<string> factors = payload.AvailableSecondFactors?.ToArray() ?? [];
        if (string.Equals(status, "2fa_required", StringComparison.Ordinal))
        {
            return new HubLoginResult(
                HubLoginStatus.TwoFactorRequired, null, payload.LoginChallengeId, factors);
        }

        if (string.Equals(status, "2fa_setup_required", StringComparison.Ordinal))
        {
            return new HubLoginResult(
                HubLoginStatus.TwoFactorSetupRequired, null, payload.LoginChallengeId, factors);
        }

        if (!string.Equals(status, "authenticated", StringComparison.Ordinal))
        {
            throw new HubApiException(
                HubApiErrorKind.Transport, "Unsupported login status in API response.");
        }

        if (string.IsNullOrEmpty(payload.AccessToken) || string.IsNullOrEmpty(payload.RefreshToken))
        {
            throw new HubApiException(
                HubApiErrorKind.Transport, "Incomplete token pair in login response.");
        }

        var session = new NativeSession(
            payload.AccessToken,
            payload.RefreshToken,
            deviceId,
            DecodeAccessTokenExpiryUtc(payload.AccessToken),
            payload.User?.Id ?? 0,
            payload.User?.Username ?? userNameFallback,
            payload.User?.FullName ?? payload.User?.Username ?? userNameFallback);
        await _sessionStore.SaveAsync(session, cancellationToken);
        Volatile.Write(ref _session, session);
        return new HubLoginResult(HubLoginStatus.Authenticated, session, null, factors);
    }

    private async Task<HttpResponseMessage> SendAuthenticatedAsync(
        Func<string, HttpRequestMessage> requestFactory,
        CancellationToken cancellationToken,
        HttpCompletionOption completionOption = HttpCompletionOption.ResponseContentRead,
        TimeSpan? requestTimeout = null)
    {
        var session = Volatile.Read(ref _session)
            ?? throw new HubApiException(
                HubApiErrorKind.SessionExpired,
                "No authenticated session.",
                HttpStatusCode.Unauthorized);
        if (session.AccessTokenExpiresAtUtc <= DateTimeOffset.UtcNow + AccessTokenRefreshSkew)
        {
            session = await RefreshSessionAsync(session, cancellationToken);
        }

        using var request = requestFactory(session.AccessToken);
        var response = await SendCoreAsync(request, cancellationToken, completionOption, requestTimeout);
        var authReason = GetAuthReason(response);
        if (IsUserInactive(authReason))
        {
            var inactiveMessage = await ReadErrorDetailAsync(response, cancellationToken);
            var inactiveStatus = response.StatusCode;
            response.Dispose();
            await EndSessionAsync();
            throw new HubApiException(
                HubApiErrorKind.SessionExpired, inactiveMessage, inactiveStatus, authReason);
        }

        if (response.StatusCode != HttpStatusCode.Unauthorized)
        {
            return response;
        }

        response.Dispose();

        var refreshed = await RefreshSessionAsync(session, cancellationToken);
        using var retryRequest = requestFactory(refreshed.AccessToken);
        var retryResponse = await SendCoreAsync(retryRequest, cancellationToken, completionOption, requestTimeout);
        var retryReason = GetAuthReason(retryResponse);
        if (retryResponse.StatusCode != HttpStatusCode.Unauthorized
            && !IsUserInactive(retryReason))
        {
            return retryResponse;
        }

        var message = await ReadErrorDetailAsync(retryResponse, cancellationToken);
        var statusCode = retryResponse.StatusCode;
        retryResponse.Dispose();
        await EndSessionAsync();
        throw new HubApiException(
            HubApiErrorKind.SessionExpired, message, statusCode, retryReason);
    }

    private async Task<NativeSession> RefreshSessionAsync(
        NativeSession expected,
        CancellationToken cancellationToken)
    {
        var sessionEnded = false;
        await _refreshLock.WaitAsync(cancellationToken);
        try
        {
            var current = Volatile.Read(ref _session);
            if (current is null)
            {
                throw new HubApiException(
                    HubApiErrorKind.SessionExpired,
                    "No authenticated session.",
                    HttpStatusCode.Unauthorized);
            }

            if (!string.Equals(current.RefreshToken, expected.RefreshToken, StringComparison.Ordinal))
            {
                // A concurrent refresh or a fresh login already replaced the pair.
                return current;
            }

            var deviceId = await GetDeviceIdAsync(cancellationToken);
            using var request = CreateRequest(HttpMethod.Post, "auth/refresh", bearer: null, deviceId);
            request.Content = CreateJsonContent(new { refresh_token = current.RefreshToken });
            using var response = await SendCoreAsync(request, cancellationToken);
            var authReason = GetAuthReason(response);
            if (response.StatusCode == HttpStatusCode.Unauthorized || IsUserInactive(authReason))
            {
                var message = await ReadErrorDetailAsync(response, cancellationToken);
                var statusCode = response.StatusCode;
                await WipeSessionCoreAsync();
                sessionEnded = true;
                throw new HubApiException(
                    HubApiErrorKind.SessionExpired, message, statusCode, authReason);
            }

            var payload = await ReadJsonAsync<AuthTokenResponse>(response, cancellationToken);
            if (string.IsNullOrEmpty(payload.AccessToken) || string.IsNullOrEmpty(payload.RefreshToken))
            {
                throw new HubApiException(
                    HubApiErrorKind.Transport,
                    "Incomplete token pair in refresh response.",
                    response.StatusCode);
            }

            var updated = new NativeSession(
                payload.AccessToken,
                payload.RefreshToken,
                current.ClientDeviceId,
                DecodeAccessTokenExpiryUtc(payload.AccessToken),
                payload.User?.Id ?? current.UserId,
                payload.User?.Username ?? current.UserName,
                payload.User?.FullName ?? current.FullName);
            // The server already rotated the pair: the save must not inherit the
            // caller's cancellation or the fresh credentials are lost mid-swap.
            await _sessionStore.SaveAsync(updated, CancellationToken.None);
            Volatile.Write(ref _session, updated);
            return updated;
        }
        finally
        {
            _refreshLock.Release();
            if (sessionEnded)
            {
                RaiseSessionEnded();
            }
        }
    }

    private async Task<HttpResponseMessage> SendCoreAsync(
        HttpRequestMessage request,
        CancellationToken cancellationToken,
        HttpCompletionOption completionOption = HttpCompletionOption.ResponseContentRead,
        TimeSpan? requestTimeout = null)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(requestTimeout ?? DefaultRequestTimeout);
        try
        {
            return await _httpClient.SendAsync(request, completionOption, timeout.Token);
        }
        catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested)
        {
            throw new HubApiException(
                HubApiErrorKind.Transport, "API request timed out.", inner: exception);
        }
        catch (HttpRequestException exception)
        {
            throw new HubApiException(
                HubApiErrorKind.Transport, "API request failed.", inner: exception);
        }
    }

    private HttpRequestMessage CreateRequest(
        HttpMethod method,
        string relativeUri,
        string? bearer,
        string deviceId)
    {
        var request = new HttpRequestMessage(method, new Uri(_apiBaseUri, relativeUri));
        request.Headers.TryAddWithoutValidation("X-Auth-Client", "mobile");
        request.Headers.TryAddWithoutValidation("X-Client-Device-ID", deviceId);
        if (bearer is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
            request.Headers.TryAddWithoutValidation("X-Client-Request-ID", Guid.NewGuid().ToString("D"));
        }

        return request;
    }

    private async Task<string> GetDeviceIdAsync(CancellationToken cancellationToken)
    {
        var cached = _deviceId;
        if (cached is not null)
        {
            return cached;
        }

        var resolved = await _sessionStore.GetOrCreateClientDeviceIdAsync(cancellationToken);
        _deviceId = resolved;
        return resolved;
    }

    private async Task WipeSessionCoreAsync()
    {
        Volatile.Write(ref _session, null);
        try
        {
            await _sessionStore.ClearAsync(CancellationToken.None);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            // The in-memory session is dead either way; a leftover file loses to
            // the next definitive 401 on the following restore.
        }
    }

    private async Task EndSessionAsync()
    {
        var ended = false;
        await _refreshLock.WaitAsync();
        try
        {
            await WipeSessionCoreAsync();
            ended = true;
        }
        finally
        {
            _refreshLock.Release();
        }

        if (ended)
        {
            RaiseSessionEnded();
        }
    }

    private void RaiseSessionEnded()
    {
        try
        {
            SessionEnded?.Invoke(this, EventArgs.Empty);
        }
        catch
        {
            // A subscriber failure must not break the auth pipeline.
        }
    }

    private static StringContent CreateJsonContent(object payload)
    {
        return new StringContent(
            JsonSerializer.Serialize(payload, JsonOptions), Encoding.UTF8, "application/json");
    }

    private static MultipartFormDataContent CreateSubmitContent(string? comment)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(comment ?? string.Empty, Encoding.UTF8), "comment");
        return content;
    }

    private static string BuildTasksQueryUri(HubTaskQuery query)
    {
        var builder = new StringBuilder("hub/tasks?scope=my&role_scope=both");
        AppendParameter(builder, "status", query.Status);
        AppendParameter(builder, "q", query.Search);
        AppendParameter(builder, "due_state", query.DueState);
        builder.Append("&sort_by=").Append(Uri.EscapeDataString(query.SortBy));
        builder.Append("&sort_dir=").Append(Uri.EscapeDataString(query.SortDir));
        builder.Append("&limit=").Append(query.Limit.ToString(CultureInfo.InvariantCulture));
        builder.Append("&offset=").Append(query.Offset.ToString(CultureInfo.InvariantCulture));
        return builder.ToString();

        static void AppendParameter(StringBuilder builder, string name, string? value)
        {
            if (value is not null)
            {
                builder.Append('&').Append(name).Append('=').Append(Uri.EscapeDataString(value));
            }
        }
    }

    private static async Task<T> ReadJsonAsync<T>(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        await EnsureSuccessAsync(response, cancellationToken);
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var value = await JsonSerializer.DeserializeAsync<T>(stream, JsonOptions, cancellationToken);
            return value ?? throw new HubApiException(
                HubApiErrorKind.Transport, "Empty API response.", response.StatusCode);
        }
        catch (Exception exception) when (exception is JsonException or IOException)
        {
            throw new HubApiException(
                HubApiErrorKind.Transport,
                "Malformed API response.",
                response.StatusCode,
                inner: exception);
        }
    }

    private static async Task EnsureSuccessAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        var detail = await ReadErrorDetailAsync(response, cancellationToken);
        throw new HubApiException(
            HubApiErrorKind.Http, detail, response.StatusCode, GetAuthReason(response));
    }

    private static async Task<string> ReadErrorDetailAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var fallback = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}".Trim();
        string body;
        try
        {
            body = await response.Content.ReadAsStringAsync(cancellationToken);
        }
        catch
        {
            return fallback;
        }

        if (string.IsNullOrWhiteSpace(body))
        {
            return fallback;
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            if (document.RootElement.ValueKind == JsonValueKind.Object
                && document.RootElement.TryGetProperty("detail", out var detail))
            {
                // FastAPI-сервисы (docflow и др.) кладут в detail объект {code,message,…} —
                // показываем человекочитаемое message, а не сырой JSON.
                if (detail.ValueKind == JsonValueKind.Object
                    && detail.TryGetProperty("message", out var message)
                    && message.ValueKind == JsonValueKind.String
                    && !string.IsNullOrWhiteSpace(message.GetString()))
                {
                    return message.GetString()!;
                }

                return detail.ValueKind == JsonValueKind.String
                    ? detail.GetString() ?? fallback
                    : detail.GetRawText();
            }
        }
        catch (JsonException)
        {
        }

        var trimmed = body.Trim();
        return trimmed.Length > 512 ? trimmed[..512] : trimmed;
    }

    private static string? GetAuthReason(HttpResponseMessage response)
    {
        return response.Headers.TryGetValues("X-Hubit-Auth-Reason", out var values)
            ? values.FirstOrDefault()?.Trim()
            : null;
    }

    private static bool IsUserInactive(string? authReason)
    {
        return string.Equals(authReason, "user_inactive", StringComparison.OrdinalIgnoreCase);
    }

    private static DateTimeOffset DecodeAccessTokenExpiryUtc(string accessToken)
    {
        try
        {
            var parts = accessToken.Split('.');
            if (parts.Length < 2)
            {
                return FallbackExpiry();
            }

            using var document = JsonDocument.Parse(Base64UrlDecode(parts[1]));
            if (document.RootElement.TryGetProperty("exp", out var exp)
                && exp.ValueKind == JsonValueKind.Number
                && exp.TryGetInt64(out var seconds))
            {
                return DateTimeOffset.FromUnixTimeSeconds(seconds);
            }
        }
        catch (Exception exception) when (
            exception is FormatException
            or JsonException
            or ArgumentException
            or OverflowException)
        {
        }

        return FallbackExpiry();

        static DateTimeOffset FallbackExpiry() =>
            DateTimeOffset.UtcNow + AccessTokenExpiryFallback;
    }

    private static byte[] Base64UrlDecode(string segment)
    {
        var normalized = segment.Replace('-', '+').Replace('_', '/');
        switch (normalized.Length % 4)
        {
            case 0:
                break;
            case 2:
                normalized += "==";
                break;
            case 3:
                normalized += "=";
                break;
            default:
                throw new FormatException("Invalid base64url segment.");
        }

        return Convert.FromBase64String(normalized);
    }

    private sealed record AuthTokenResponse
    {
        [JsonPropertyName("status")] public string? Status { get; init; }
        [JsonPropertyName("access_token")] public string? AccessToken { get; init; }
        [JsonPropertyName("refresh_token")] public string? RefreshToken { get; init; }
        [JsonPropertyName("user")] public HubUser? User { get; init; }
        [JsonPropertyName("session_id")] public string? SessionId { get; init; }
        [JsonPropertyName("login_challenge_id")] public string? LoginChallengeId { get; init; }
        [JsonPropertyName("available_second_factors")] public List<string>? AvailableSecondFactors { get; init; }
    }
}
