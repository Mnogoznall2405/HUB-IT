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

        if (query.BookmarkedOnly)
        {
            parts.Add("bookmarked_only=true");
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

    public async Task<HubAnnouncementReactionState> SetAnnouncementReactionAsync(
        string announcementId,
        string reactionType,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(reactionType);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/reaction";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { reaction_type = reactionType });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementReactionState>(response, cancellationToken);
    }

    public async Task<HubAnnouncementReactionState> ClearAnnouncementReactionAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/reaction";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementReactionState>(response, cancellationToken);
    }

    public async Task<HubAnnouncementReactionUserList> GetAnnouncementReactionUsersAsync(
        string announcementId,
        string? reactionType,
        int limit,
        int offset,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + limit.ToString(CultureInfo.InvariantCulture),
            "offset=" + offset.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(reactionType))
        {
            parts.Add("reaction_type=" + Uri.EscapeDataString(reactionType));
        }

        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/reactions?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementReactionUserList>(response, cancellationToken);
    }

    public async Task<HubAnnouncementReactionState> SetAnnouncementLikeAsync(
        string announcementId,
        bool liked,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/like";
        var method = liked ? HttpMethod.Put : HttpMethod.Delete;
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(method, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementReactionState>(response, cancellationToken);
    }

    public async Task<HubAnnouncementBookmarkState> SetAnnouncementBookmarkAsync(
        string announcementId,
        bool bookmarked,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/bookmark";
        var method = bookmarked ? HttpMethod.Put : HttpMethod.Delete;
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(method, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementBookmarkState>(response, cancellationToken);
    }

    public async Task<HubAnnouncementPollVoteResult> VoteAnnouncementPollAsync(
        string announcementId,
        IReadOnlyList<string> optionIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentNullException.ThrowIfNull(optionIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/poll/vote";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { option_ids = optionIds });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementPollVoteResult>(response, cancellationToken);
    }

    public async Task<HubAnnouncementCommentPage> GetAnnouncementCommentsAsync(
        string announcementId,
        HubAnnouncementCommentQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + query.Limit.ToString(CultureInfo.InvariantCulture),
            "offset=" + query.Offset.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(query.Sort))
        {
            parts.Add("sort=" + Uri.EscapeDataString(query.Sort));
        }

        if (!string.IsNullOrWhiteSpace(query.RootCommentId))
        {
            parts.Add("root_comment_id=" + Uri.EscapeDataString(query.RootCommentId));
        }

        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/comments?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementCommentPage>(response, cancellationToken);
    }

    public async Task<HubAnnouncementComment> CreateAnnouncementCommentAsync(
        string announcementId,
        string body,
        string? parentCommentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/comments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    body,
                    parent_comment_id = parentCommentId,
                    // Идемпотентность повторной отправки — как у веб-клиента.
                    client_request_id = Guid.NewGuid().ToString(),
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementComment>(response, cancellationToken);
    }

    public async Task<HubAnnouncementComment> UpdateAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        string body,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(commentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/comments/" + Uri.EscapeDataString(commentId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { body });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementComment>(response, cancellationToken);
    }

    public async Task DeleteAnnouncementCommentAsync(
        string announcementId,
        string commentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(commentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/comments/" + Uri.EscapeDataString(commentId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubAnnouncementCommentReactionState> SetAnnouncementCommentReactionAsync(
        string announcementId,
        string commentId,
        string? reactionType,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(commentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/comments/" + Uri.EscapeDataString(commentId) + "/reaction";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var method = reactionType is null ? HttpMethod.Delete : HttpMethod.Put;
                var request = CreateRequest(method, relative, token, deviceId);
                if (reactionType is not null)
                {
                    request.Content = CreateJsonContent(new { reaction_type = reactionType });
                }

                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementCommentReactionState>(response, cancellationToken);
    }

    public async Task<string> DownloadAnnouncementAttachmentAsync(
        string announcementId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/file";
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

    public async Task<string> DownloadAnnouncementCommentAttachmentAsync(
        string announcementId,
        string commentId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentException.ThrowIfNullOrWhiteSpace(commentId);
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId)
            + "/comments/" + Uri.EscapeDataString(commentId)
            + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/file";
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

    public async Task<HubAbsenceItem> CreateHubAbsenceAsync(
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "hub/absences", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAbsenceItem>(response, cancellationToken);
    }

    public async Task<HubAbsenceItem> UpdateHubAbsenceAsync(
        long absenceId,
        HubAbsenceUpsertRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/absences/" + absenceId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAbsenceItem>(response, cancellationToken);
    }

    public async Task DeleteHubAbsenceAsync(
        long absenceId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/absences/" + absenceId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubNotificationPoll> GetNotificationsPollAsync(
        string? since,
        int limit,
        bool unreadOnly,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "since=" + (string.IsNullOrWhiteSpace(since)
                ? string.Empty
                : Uri.EscapeDataString(since.Trim())),
            "limit=" + limit.ToString(CultureInfo.InvariantCulture),
        };
        if (unreadOnly)
        {
            parts.Add("unread_only=true");
        }

        var relative = "hub/notifications/poll?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNotificationPoll>(response, cancellationToken);
    }

    public async Task<HubNotificationUnreadCounts> GetNotificationUnreadCountsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(
                HttpMethod.Get, "hub/notifications/unread-counts", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNotificationUnreadCounts>(response, cancellationToken);
    }

    public async Task<HubNotificationReadResult> MarkNotificationReadAsync(
        string notificationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(notificationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/notifications/" + Uri.EscapeDataString(notificationId.Trim()) + "/read";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNotificationReadResult>(response, cancellationToken);
    }

    public async Task<HubNotificationReadAllResult> MarkAllNotificationsReadAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(
                HttpMethod.Post, "hub/notifications/read-all", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubNotificationReadAllResult>(response, cancellationToken);
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

    public async Task<HubMailMessageHeaders> GetMailMessageHeadersAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/headers";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailMessageHeaders>(response, cancellationToken);
    }

    public async Task<string> DownloadMailMessageSourceAsync(
        string messageId,
        string? mailboxId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/eml";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        // ResponseHeadersRead: исходник стримится в destination — паттерн DownloadMailAttachmentAsync.
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

    public async Task<HubMailActionResult> RestoreMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        return await PostMailMessageActionAsync(
            messageId,
            "restore",
            mailboxId: null,
            body: new { mailbox_id = mailboxId ?? string.Empty },
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

    public async Task<HubMailFolder> CreateMailFolderAsync(
        string? mailboxId,
        string name,
        string? parentFolderId,
        string? scope,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "mail/folders", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    mailbox_id = mailboxId ?? string.Empty,
                    name,
                    parent_folder_id = parentFolderId ?? string.Empty,
                    scope = string.IsNullOrWhiteSpace(scope) ? "mailbox" : scope,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailFolder>(response, cancellationToken);
    }

    public async Task<HubMailFolder> RenameMailFolderAsync(
        string folderId,
        string? mailboxId,
        string name,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/folders/" + Uri.EscapeDataString(folderId);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { name });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailFolder>(response, cancellationToken);
    }

    public async Task<HubMailFolderDeleteResult> DeleteMailFolderAsync(
        string folderId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/folders/" + Uri.EscapeDataString(folderId);
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailFolderDeleteResult>(response, cancellationToken);
    }

    public async Task<HubMailFolderFavoriteResult> SetMailFolderFavoriteAsync(
        string folderId,
        string? mailboxId,
        bool favorite,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/folders/" + Uri.EscapeDataString(folderId) + "/favorite";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    mailbox_id = mailboxId ?? string.Empty,
                    favorite,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailFolderFavoriteResult>(response, cancellationToken);
    }

    public async Task<HubMailImportanceResult> SetMailMessageImportanceAsync(
        string messageId,
        string? mailboxId,
        string importance,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(importance);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/importance";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    importance,
                    mailbox_id = mailboxId ?? string.Empty,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailImportanceResult>(response, cancellationToken);
    }

    public async Task<HubMailSummaryResult> SummarizeMailMessageAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/summarize";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailSummaryResult>(response, cancellationToken);
    }

    public async Task<HubMailSmartRepliesResult> GetMailSmartRepliesAsync(
        string messageId,
        string? mailboxId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/messages/" + Uri.EscapeDataString(messageId) + "/smart-replies";
        if (!string.IsNullOrWhiteSpace(mailboxId))
        {
            relative += "?mailbox_id=" + Uri.EscapeDataString(mailboxId);
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailSmartRepliesResult>(response, cancellationToken);
    }

    public async Task<IReadOnlyList<HubMailTemplate>> GetMailTemplatesAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/templates?include_inactive="
            + (includeInactive ? "true" : "false");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        var payload = await ReadJsonAsync<HubMailTemplateList>(response, cancellationToken);
        return payload.Items ?? [];
    }

    public async Task<HubMailSendResult> SendMailItRequestAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        CancellationToken cancellationToken,
        string? idempotencyKey = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(templateId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(
                    HttpMethod.Post, "mail/messages/send-it-request", token, deviceId);
                if (!string.IsNullOrWhiteSpace(idempotencyKey))
                {
                    request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
                }
                // Контракт SendItRequestPayload: {template_id, fields{…}} — mail.py.
                request.Content = CreateJsonContent(new
                {
                    template_id = templateId,
                    fields = fields ?? new Dictionary<string, object?>(),
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailSendResult>(response, cancellationToken);
    }

    public async Task<HubMailSendResult> SendMailItRequestMultipartAsync(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<HubMailOutgoingAttachment> attachments,
        CancellationToken cancellationToken,
        string? idempotencyKey = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(templateId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(
                    HttpMethod.Post,
                    "mail/messages/send-it-request-multipart",
                    token,
                    deviceId);
                if (!string.IsNullOrWhiteSpace(idempotencyKey))
                {
                    request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
                }
                request.Content = CreateMailItRequestMultipart(
                    templateId, fields, attachments ?? []);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMailSendResult>(response, cancellationToken);
    }

    /// <summary>
    /// multipart-форма send-it-request-multipart: template_id и fields_json —
    /// обычные поля, файлы — повторяющимся files[] (контракт mail.py,
    /// как у send-multipart композера).
    /// </summary>
    private static MultipartFormDataContent CreateMailItRequestMultipart(
        string templateId,
        IReadOnlyDictionary<string, object?> fields,
        IReadOnlyList<HubMailOutgoingAttachment> attachments)
    {
        var content = new MultipartFormDataContent();
        content.Add(new StringContent(templateId, Encoding.UTF8), "template_id");
        content.Add(
            new StringContent(
                JsonSerializer.Serialize(
                    fields ?? new Dictionary<string, object?>(), JsonOptions),
                Encoding.UTF8),
            "fields_json");
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

        return content;
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

    public async Task<HubDocflowConnectionTestResult> TestDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(login);
        ArgumentException.ThrowIfNullOrEmpty(password);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "docflow/profile/test", token, deviceId);
                // Пароль только в теле запроса — не в пути, query и логах.
                request.Content = CreateJsonContent(new { login = login.Trim(), password });
                return request;
            },
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowConnectionTestResult>(response, cancellationToken);
    }

    public async Task<HubDocflowProfile> SaveDocflowCredentialsAsync(
        string login,
        string password,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(login);
        ArgumentException.ThrowIfNullOrEmpty(password);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(
                    HttpMethod.Put, "docflow/profile/credentials", token, deviceId);
                request.Content = CreateJsonContent(new { login = login.Trim(), password });
                return request;
            },
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowProfile>(response, cancellationToken);
    }

    public async Task DeleteDocflowCredentialsAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(
                HttpMethod.Delete, "docflow/profile/credentials", token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubDocflowMetadata> GetDocflowMetadataAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "docflow/metadata", token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowMetadata>(response, cancellationToken);
    }

    public async Task<HubDocflowAbsenceList> GetDocflowAbsencesAsync(
        string? employeeCode,
        string? on,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("docflow/absences");
        var separator = '?';
        if (!string.IsNullOrWhiteSpace(on))
        {
            builder.Append(separator).Append("on=").Append(Uri.EscapeDataString(on.Trim()));
            separator = '&';
        }

        if (!string.IsNullOrWhiteSpace(employeeCode))
        {
            builder.Append(separator)
                .Append("employee_code=")
                .Append(Uri.EscapeDataString(employeeCode.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: DocflowRequestTimeout);
        return await ReadJsonAsync<HubDocflowAbsenceList>(response, cancellationToken);
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

    public async Task DeleteTicketAttachmentAsync(
        long requestId,
        string attachmentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/requests/" + requestId.ToString(CultureInfo.InvariantCulture)
            + "/attachments/" + Uri.EscapeDataString(attachmentId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
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

    public async Task<HubTicketObjectList> GetTicketObjectsAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = includeInactive
            ? "tickets/objects?include_inactive=true"
            : "tickets/objects";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketObjectList>(response, cancellationToken);
    }

    public async Task<HubTicketObject> CreateTicketObjectAsync(
        HubTicketObjectUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "tickets/objects", token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketObjectBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketObject>(response, cancellationToken);
    }

    public async Task<HubTicketObject> UpdateTicketObjectAsync(
        long objectId,
        HubTicketObjectUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/objects/" + objectId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketObjectBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketObject>(response, cancellationToken);
    }

    /// <summary>exclude_unset ObjectBody: сериализуем только заданные поля (snake_case).</summary>
    private static Dictionary<string, object?> TicketObjectBody(HubTicketObjectUpsert request)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (request.Code is not null)
        {
            body["code"] = request.Code;
        }

        if (request.Name is not null)
        {
            body["name"] = request.Name;
        }

        if (request.ShortName is not null)
        {
            body["short_name"] = request.ShortName;
        }

        if (request.Region is not null)
        {
            body["region"] = request.Region;
        }

        if (request.DefaultAssigneeId is not null)
        {
            body["default_assignee_id"] = request.DefaultAssigneeId;
        }

        if (request.IsActive is not null)
        {
            body["is_active"] = request.IsActive;
        }

        return body;
    }

    public async Task<HubTicketEmployeeDetail> GetTicketEmployeeAsync(
        long employeeId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/employees/" + employeeId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketEmployeeDetail>(response, cancellationToken);
    }

    public async Task<HubTicketEmployeeDetail> CreateTicketEmployeeAsync(
        HubTicketEmployeeUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "tickets/employees", token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketEmployeeBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketEmployeeDetail>(response, cancellationToken);
    }

    public async Task<HubTicketEmployeeDetail> UpdateTicketEmployeeAsync(
        long employeeId,
        HubTicketEmployeeUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/employees/" + employeeId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketEmployeeBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketEmployeeDetail>(response, cancellationToken);
    }

    /// <summary>exclude_unset EmployeeBody: только заданные поля; documents — списком словарей.</summary>
    private static Dictionary<string, object?> TicketEmployeeBody(HubTicketEmployeeUpsert request)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (request.FullName is not null)
        {
            body["full_name"] = request.FullName;
        }

        if (request.Department is not null)
        {
            body["department"] = request.Department;
        }

        if (request.Position is not null)
        {
            body["position"] = request.Position;
        }

        if (request.Phone is not null)
        {
            body["phone"] = request.Phone;
        }

        if (request.Email is not null)
        {
            body["email"] = request.Email;
        }

        if (request.ZupEmployeeCode is not null)
        {
            body["zup_employee_code"] = request.ZupEmployeeCode;
        }

        if (request.Status is not null)
        {
            body["status"] = request.Status;
        }

        if (request.DateOfBirth is not null)
        {
            body["date_of_birth"] = request.DateOfBirth;
        }

        if (request.Documents is not null)
        {
            var documents = new List<Dictionary<string, object?>>(request.Documents.Count);
            foreach (var document in request.Documents)
            {
                documents.Add(TicketEmployeeDocumentBody(document));
            }

            body["documents"] = documents;
        }

        return body;
    }

    private static Dictionary<string, object?> TicketEmployeeDocumentBody(
        HubTicketEmployeeDocumentUpsert document)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (document.Id is not null)
        {
            body["id"] = document.Id;
        }

        if (document.PassportSeries is not null)
        {
            body["passport_series"] = document.PassportSeries;
        }

        if (document.PassportNumber is not null)
        {
            body["passport_number"] = document.PassportNumber;
        }

        if (document.IssuedBy is not null)
        {
            body["issued_by"] = document.IssuedBy;
        }

        if (document.IssuerCode is not null)
        {
            body["issuer_code"] = document.IssuerCode;
        }

        if (document.BirthPlace is not null)
        {
            body["birth_place"] = document.BirthPlace;
        }

        if (document.IssueDate is not null)
        {
            body["issue_date"] = document.IssueDate;
        }

        if (document.RegistrationAddress is not null)
        {
            body["registration_address"] = document.RegistrationAddress;
        }

        return body;
    }

    public async Task<HubTicketImportJob> UploadTicketImportAsync(
        string fileName,
        Stream content,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "tickets/import/upload", token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new StreamContent(content);
                fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                form.Add(fileContent, "file", fileName);
                request.Content = form;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketImportJob>(response, cancellationToken);
    }

    public async Task<HubTicketImportPreview> GetTicketImportPreviewAsync(
        string jobId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/import/" + Uri.EscapeDataString(jobId) + "/preview";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketImportPreview>(response, cancellationToken);
    }

    public async Task<HubTicketImportResult> ExecuteTicketImportAsync(
        string jobId,
        HubTicketImportExecute request,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(jobId);
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/import/" + Uri.EscapeDataString(jobId) + "/execute";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    color_map = request.ColorMap,
                    duplicate_strategy = request.DuplicateStrategy,
                    sheet_object_map = request.SheetObjectMap,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketImportResult>(response, cancellationToken);
    }

    public async Task<HubTicketFinancialOpPage> GetTicketFinancialOpsAsync(
        HubTicketFinOpQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/financial-ops?page=")
            .Append(query.Page.ToString(CultureInfo.InvariantCulture))
            .Append("&page_size=").Append(query.PageSize.ToString(CultureInfo.InvariantCulture));
        if (query.RequestId is { } requestId)
        {
            builder.Append("&request_id=").Append(requestId.ToString(CultureInfo.InvariantCulture));
        }

        if (query.EmployeeId is { } employeeId)
        {
            builder.Append("&employee_id=").Append(employeeId.ToString(CultureInfo.InvariantCulture));
        }

        if (query.ObjectId is { } objectId)
        {
            builder.Append("&object_id=").Append(objectId.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(query.OpType))
        {
            builder.Append("&op_type=").Append(Uri.EscapeDataString(query.OpType));
        }

        if (!string.IsNullOrWhiteSpace(query.RefundStatus))
        {
            builder.Append("&refund_status=").Append(Uri.EscapeDataString(query.RefundStatus));
        }

        if (!string.IsNullOrWhiteSpace(query.DateFrom))
        {
            builder.Append("&date_from=").Append(Uri.EscapeDataString(query.DateFrom));
        }

        if (!string.IsNullOrWhiteSpace(query.DateTo))
        {
            builder.Append("&date_to=").Append(Uri.EscapeDataString(query.DateTo));
        }

        if (query.IncludeDeleted)
        {
            builder.Append("&include_deleted=true");
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketFinancialOpPage>(response, cancellationToken);
    }

    public async Task<HubTicketFinancialOp> CreateTicketFinancialOpAsync(
        HubTicketFinancialOpUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "tickets/financial-ops", token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketFinOpBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketFinancialOp>(response, cancellationToken);
    }

    public async Task<HubTicketFinancialOp> UpdateTicketFinancialOpAsync(
        long opId,
        HubTicketFinancialOpUpsert request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/financial-ops/" + opId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(TicketFinOpBody(request));
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketFinancialOp>(response, cancellationToken);
    }

    public async Task DeleteTicketFinancialOpAsync(
        long opId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/financial-ops/" + opId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    /// <summary>exclude_unset FinancialOpBody: только заданные поля (snake_case).</summary>
    private static Dictionary<string, object?> TicketFinOpBody(HubTicketFinancialOpUpsert request)
    {
        var body = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (request.RequestId is not null)
        {
            body["request_id"] = request.RequestId;
        }

        if (request.EmployeeId is not null)
        {
            body["employee_id"] = request.EmployeeId;
        }

        if (request.ObjectId is not null)
        {
            body["object_id"] = request.ObjectId;
        }

        if (request.OpType is not null)
        {
            body["op_type"] = request.OpType;
        }

        if (request.Amount is not null)
        {
            body["amount"] = request.Amount;
        }

        if (request.Reason is not null)
        {
            body["reason"] = request.Reason;
        }

        if (request.RefundStatus is not null)
        {
            body["refund_status"] = request.RefundStatus;
        }

        if (request.OpDate is not null)
        {
            body["op_date"] = request.OpDate;
        }

        return body;
    }

    /// <summary>Общий query-билдер отчёта потерь: date_from/date_to/object_id/op_type.</summary>
    private static void AppendTicketLossesQuery(StringBuilder builder, HubTicketLossesQuery query)
    {
        if (!string.IsNullOrWhiteSpace(query.DateFrom))
        {
            builder.Append("&date_from=").Append(Uri.EscapeDataString(query.DateFrom));
        }

        if (!string.IsNullOrWhiteSpace(query.DateTo))
        {
            builder.Append("&date_to=").Append(Uri.EscapeDataString(query.DateTo));
        }

        if (query.ObjectId is { } objectId)
        {
            builder.Append("&object_id=").Append(objectId.ToString(CultureInfo.InvariantCulture));
        }

        if (!string.IsNullOrWhiteSpace(query.OpType))
        {
            builder.Append("&op_type=").Append(Uri.EscapeDataString(query.OpType));
        }
    }

    public async Task<HubTicketLossReport> GetTicketLossesReportAsync(
        HubTicketLossesQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/reports/losses?page=")
            .Append(query.Page.ToString(CultureInfo.InvariantCulture))
            .Append("&page_size=").Append(query.PageSize.ToString(CultureInfo.InvariantCulture));
        AppendTicketLossesQuery(builder, query);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketLossReport>(response, cancellationToken);
    }

    public async Task<string> ExportTicketLossesAsync(
        HubTicketLossesQuery query,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/reports/losses/export");
        var prefixLength = builder.Length;
        AppendTicketLossesQuery(builder, query);
        if (builder.Length > prefixLength)
        {
            // Фильтры добавлены с '&'-префиксом: первый из них открывает query-строку '?'.
            builder[prefixLength] = '?';
        }

        var relative = builder.ToString();

        // ResponseHeadersRead: тело xlsx стримится в destination — паттерн ExportTaskAnalyticsAsync.
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

    public async Task<string> ExportTicketRequestsAsync(
        HubTicketQuery query,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("tickets/reports/requests/export");
        var separator = '?';
        void Append(string name, string? value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return;
            }

            builder.Append(separator).Append(name).Append('=').Append(Uri.EscapeDataString(value));
            separator = '&';
        }

        Append("object_ids", query.ObjectIds);
        Append("statuses", query.Statuses);
        Append("search", query.Search?.Trim());
        Append("sort_field", query.SortField);
        Append("sort_dir", query.SortDir);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    public async Task<HubTicketNotificationRuleList> GetTicketNotificationRulesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "tickets/notifications/rules", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketNotificationRuleList>(response, cancellationToken);
    }

    public async Task<HubTicketNotificationRule> UpdateTicketNotificationRuleAsync(
        long ruleId,
        HubTicketNotificationRulePatch patch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(patch);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/notifications/rules/" + ruleId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                var body = new Dictionary<string, object?>(StringComparer.Ordinal);
                if (patch.IsEnabled is not null)
                {
                    body["is_enabled"] = patch.IsEnabled;
                }

                if (patch.ThresholdDays is not null)
                {
                    body["threshold_days"] = patch.ThresholdDays;
                }

                if (patch.NotifyRoles is not null)
                {
                    body["notify_roles"] = patch.NotifyRoles;
                }

                httpRequest.Content = CreateJsonContent(body);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTicketNotificationRule>(response, cancellationToken);
    }

    public async Task<HubTicketPendingNotificationList> GetTicketPendingNotificationsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "tickets/notifications/pending", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTicketPendingNotificationList>(response, cancellationToken);
    }

    public async Task DismissTicketNotificationAsync(
        string notificationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(notificationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "tickets/notifications/" + Uri.EscapeDataString(notificationId) + "/dismiss";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
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

    /// <summary>
    /// POST /equipment/{item_id}/photos — простая загрузка (multipart/form-data,
    /// поле «file», description — query). Тело держим байтами: на 401-retry
    /// фабрика создаёт свежий контент повторно, а поток уже был бы прочитан.
    /// </summary>
    public async Task<HubEquipmentPhotoUploadResult> UploadEquipmentPhotoAsync(
        long itemId,
        string fileName,
        byte[] content,
        string? mimeType,
        string? description,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        var relative = "equipment/" + itemId.ToString(CultureInfo.InvariantCulture) + "/photos";
        if (!string.IsNullOrWhiteSpace(description))
        {
            relative += "?description=" + Uri.EscapeDataString(description.Trim());
        }

        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new ByteArrayContent(content);
                fileContent.Headers.ContentType = new MediaTypeHeaderValue(
                    string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType.Trim());
                form.Add(fileContent, "file", fileName);
                request.Content = form;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoUploadResult>(response, cancellationToken);
    }

    /// <summary>POST /equipment/{item_id}/photo-uploads — сессия чанковой загрузки.</summary>
    public async Task<HubEquipmentPhotoUploadSession> CreateEquipmentPhotoUploadSessionAsync(
        long itemId,
        HubEquipmentPhotoUploadSessionCreate request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/" + itemId.ToString(CultureInfo.InvariantCulture) + "/photo-uploads";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var requestMessage = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                requestMessage.Content = CreateJsonContent(request);
                return requestMessage;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoUploadSession>(response, cancellationToken);
    }

    /// <summary>PUT /equipment/photo-uploads/{upload_id}/chunks/{index} — сырой чанк.</summary>
    public async Task<HubEquipmentPhotoUploadSession> UploadEquipmentPhotoChunkAsync(
        string uploadId,
        int chunkIndex,
        ReadOnlyMemory<byte> data,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(uploadId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/photo-uploads/"
            + Uri.EscapeDataString(uploadId.Trim())
            + "/chunks/"
            + chunkIndex.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                var content = new ByteArrayContent(data.ToArray());
                content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                request.Content = content;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoUploadSession>(response, cancellationToken);
    }

    /// <summary>POST /equipment/photo-uploads/{upload_id}/complete — сборка файла.</summary>
    public async Task<HubEquipmentPhotoUploadResult> CompleteEquipmentPhotoUploadAsync(
        string uploadId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(uploadId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/photo-uploads/" + Uri.EscapeDataString(uploadId.Trim()) + "/complete";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoUploadResult>(response, cancellationToken);
    }

    /// <summary>POST /equipment/{item_id}/photos/{file_no}/verify — «проверено».</summary>
    public async Task<HubEquipmentPhoto> VerifyEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = PhotoModerationPath(itemId, fileNo, "verify");
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhoto>(response, cancellationToken);
    }

    /// <summary>POST /equipment/{item_id}/photos/{file_no}/reject — причина обязательна.</summary>
    public Task<HubEquipmentPhoto> RejectEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken) =>
        RejectEquipmentPhotoCoreAsync(HttpMethod.Post, itemId, fileNo, reason, cancellationToken);

    /// <summary>PATCH /equipment/{item_id}/photos/{file_no}/reject — правка причины.</summary>
    public Task<HubEquipmentPhoto> UpdateEquipmentPhotoRejectReasonAsync(
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken) =>
        RejectEquipmentPhotoCoreAsync(new HttpMethod("PATCH"), itemId, fileNo, reason, cancellationToken);

    private async Task<HubEquipmentPhoto> RejectEquipmentPhotoCoreAsync(
        HttpMethod method,
        long itemId,
        long fileNo,
        string reason,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = PhotoModerationPath(itemId, fileNo, "reject");
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(method, relative, token, deviceId);
                request.Content = CreateJsonContent(new { reason });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhoto>(response, cancellationToken);
    }

    /// <summary>POST /equipment/{item_id}/photos/{file_no}/rotate — 90/180/270 по часовой.</summary>
    public async Task<HubEquipmentPhotoRotateResult> RotateEquipmentPhotoAsync(
        long itemId,
        long fileNo,
        int degrees,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = PhotoModerationPath(itemId, fileNo, "rotate");
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { degrees });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentPhotoRotateResult>(response, cancellationToken);
    }

    private static string PhotoModerationPath(long itemId, long fileNo, string action) =>
        "equipment/" + itemId.ToString(CultureInfo.InvariantCulture)
        + "/photos/" + fileNo.ToString(CultureInfo.InvariantCulture)
        + "/" + action;

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

    /// <summary>
    /// GET /equipment/employee/{owner_no}/items — техника владельца. Имя
    /// параметра как у веб equipmentSearch.getEmployeeEquipment (employee_name);
    /// all_databases не шлём — в натив срез входит только текущая база.
    /// </summary>
    public async Task<HubEmployeeItemsResponse> GetEmployeeItemsAsync(
        long ownerNo,
        string? employeeName,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/employee/" + ownerNo.ToString(CultureInfo.InvariantCulture) + "/items";
        if (!string.IsNullOrWhiteSpace(employeeName))
        {
            relative += "?employee_name=" + Uri.EscapeDataString(employeeName.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEmployeeItemsResponse>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/employee/{owner_no}/history — движения по сотруднику.
    /// Имена параметров как у веб employeeHistoryAPI.getHistory: direction
    /// (all|incoming|outgoing), q, page, limit; date_from/date_to в срез не входят.
    /// </summary>
    public async Task<HubEmployeeHistoryResponse> GetEmployeeHistoryAsync(
        long ownerNo,
        string? direction,
        string? q,
        int page,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("equipment/employee/")
            .Append(ownerNo.ToString(CultureInfo.InvariantCulture))
            .Append("/history?page=")
            .Append((page > 0 ? page : 1).ToString(CultureInfo.InvariantCulture))
            .Append("&limit=")
            .Append((limit > 0 ? limit : 50).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(direction))
        {
            builder.Append("&direction=").Append(Uri.EscapeDataString(direction.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(q))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(q.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubEmployeeHistoryResponse>(response, cancellationToken);
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
    /// GET /equipment/locations?branch_no=&only_branch=true — только локации
    /// выбранного филиала; имена параметров как у веб getLocations.
    /// </summary>
    public async Task<IReadOnlyList<HubEquipmentLocation>> GetEquipmentBranchLocationsAsync(
        string branchId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(branchId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/locations?only_branch=true&branch_no="
            + Uri.EscapeDataString(branchId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubEquipmentLocation>>(response, cancellationToken);
    }

    /// <summary>GET /equipment/statuses — справочник статусов карточки.</summary>
    public async Task<IReadOnlyList<HubEquipmentStatus>> GetEquipmentStatusesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "equipment/statuses", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubEquipmentStatus>>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/models?type_no=&ci_type=1 — модели выбранного типа;
    /// ci_type=1 как у веб-справочника моделей оборудования.
    /// </summary>
    public async Task<IReadOnlyList<HubEquipmentModel>> GetEquipmentModelsAsync(
        int typeNo,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/models?type_no="
            + typeNo.ToString(CultureInfo.InvariantCulture)
            + "&ci_type=1";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        var page = await ReadJsonAsync<HubEquipmentModelList>(response, cancellationToken);
        return page.Models ?? [];
    }

    /// <summary>
    /// GET /equipment/owners/search?q=&limit= — подбор владельца (ФИО/отдел);
    /// ответ — обёртка {owners:[]}, как searchOwners в веб-форме карточки.
    /// </summary>
    public async Task<IReadOnlyList<HubEquipmentOwner>> SearchEquipmentOwnersAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/owners/search?limit="
            + (limit > 0 ? limit : 20).ToString(CultureInfo.InvariantCulture)
            + "&q=" + Uri.EscapeDataString(query.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        var page = await ReadJsonAsync<HubEquipmentOwnerList>(response, cancellationToken);
        return page.Owners ?? [];
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

    /// <summary>
    /// POST /equipment/transfer/location — тело как у веб
    /// transferModel.buildTransferLocationPayload: inv_nos/branch_no/loc_no
    /// + обязательный operation_id и опциональный comment. Без смены владельца
    /// и без актов; queued досматриваем через GetTransferActJobAsync.
    /// </summary>
    public async Task<HubTransferExecuteResponse> TransferEquipmentLocationAsync(
        HubTransferLocationRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/transfer/location", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    operation_id = request.OperationId,
                    inv_nos = request.InvNos,
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

    /// <summary>
    /// POST /equipment/transfer/act-only — акт(ы) без перемещения: тело как у
    /// веб buildTransferActOnlyPayload (inv_nos/issuer_employee/issuer_owner_no/
    /// comment + operation_id). Владелец/филиал/локация не меняются; queued
    /// досматриваем через GetTransferActJobAsync.
    /// </summary>
    public async Task<HubTransferExecuteResponse> TransferActOnlyAsync(
        HubTransferActOnlyRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/transfer/act-only", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    operation_id = request.OperationId,
                    inv_nos = request.InvNos,
                    issuer_employee = request.IssuerEmployee,
                    issuer_owner_no = request.IssuerOwnerNo,
                    comment = request.Comment,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTransferExecuteResponse>(response, cancellationToken);
    }

    /// <summary>Распознавание акта через LLM дольше обычного запроса — как 180с в вебе.</summary>
    private static readonly TimeSpan UploadedActParseTimeout = TimeSpan.FromSeconds(180);

    /// <summary>
    /// POST /equipment/acts/upload/parse — multipart-поле file с PDF;
    /// manual_mode=true добавляем в query — как uploadEquipmentActParse в вебе.
    /// </summary>
    public async Task<HubUploadedActDraft> ParseUploadedActAsync(
        string fileName,
        byte[] content,
        bool manualMode,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/acts/upload/parse";
        if (manualMode)
        {
            relative += "?manual_mode=true";
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new ByteArrayContent(content);
                fileContent.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
                form.Add(fileContent, "file", fileName);
                request.Content = form;
                return request;
            },
            cancellationToken,
            requestTimeout: UploadedActParseTimeout);
        return await ReadJsonAsync<HubUploadedActDraft>(response, cancellationToken);
    }

    /// <summary>POST /equipment/acts/upload/commit — запись акта из черновика.</summary>
    public async Task<HubUploadedActCommitResult> CommitUploadedActAsync(
        HubUploadedActCommitRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/acts/upload/commit", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubUploadedActCommitResult>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/transfer/reminders/{reminder_id} — reminder-задача
    /// ожидания подписанных актов; 404 прокидываем как HubApiException —
    /// диалог загрузки показывает её в панели напоминания, не в общей ошибке.
    /// </summary>
    public async Task<HubTransferActReminder> GetTransferReminderAsync(
        string reminderId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(reminderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/transfer/reminders/" + Uri.EscapeDataString(reminderId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTransferActReminder>(response, cancellationToken);
    }

    /// <summary>
    /// POST /equipment/acts/upload/email — письмо с записанным актом
    /// (auto по from/to сотрудникам или selected по owner_nos — как веб-форма).
    /// </summary>
    public async Task<HubUploadedActEmailResult> SendUploadedActEmailAsync(
        HubUploadedActEmailRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/acts/upload/email", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubUploadedActEmailResult>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/acts/{doc_no}/file — файл записанного акта: тело стримится
    /// в destination — паттерн DownloadTransferActAsync.
    /// </summary>
    public async Task<string> DownloadEquipmentActFileAsync(
        long docNo,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/acts/" + docNo.ToString(CultureInfo.InvariantCulture) + "/file";
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
    /// PATCH /equipment/{inv_no} — тело diff'а (как updateByInvNo веба):
    /// сервер отвечает обновлённой карточкой — деталь применяем без повторного GET.
    /// </summary>
    public async Task<HubEquipmentItem> UpdateEquipmentAsync(
        string invNo,
        HubEquipmentUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(invNo);
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/" + Uri.EscapeDataString(invNo.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(new HttpMethod("PATCH"), relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentItem>(response, cancellationToken);
    }

    /// <summary>
    /// POST /equipment/create — тело как у веб buildAddEquipmentPayload:
    /// обязательные serial_no/employee_name/branch_no/loc_no/type_no/status_no +
    /// опциональные поля; сервер создаёт владельца/модель при отсутствии.
    /// </summary>
    public async Task<HubEquipmentCreateResult> CreateEquipmentAsync(
        HubEquipmentCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/create", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubEquipmentCreateResult>(response, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/consumables/lookup — справочник складских расходников
    /// с остатком и адресом; параметры как у веб getConsumablesLookup.
    /// </summary>
    public async Task<IReadOnlyList<HubConsumableLookupItem>> GetConsumablesLookupAsync(
        bool onlyPositiveQty,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "equipment/consumables/lookup?only_positive_qty="
            + (onlyPositiveQty ? "true" : "false")
            + "&limit=" + (limit > 0 ? limit : 500).ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubConsumableLookupItem>>(response, cancellationToken);
    }

    /// <summary>
    /// POST /equipment/consumables/consume — тело как у веб consumeConsumable:
    /// item_id/inv_no, qty, reason, operation_id.
    /// </summary>
    public async Task<HubConsumableConsumeResponse> ConsumeConsumableAsync(
        HubConsumableConsumeRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/consumables/consume", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    item_id = request.ItemId,
                    inv_no = request.InvNo,
                    qty = request.Qty,
                    reason = request.Reason,
                    operation_id = request.OperationId,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubConsumableConsumeResponse>(response, cancellationToken);
    }

    /// <summary>
    /// PATCH /equipment/consumables/qty — тело как у веб updateConsumableQty:
    /// item_id/inv_no и новый точный остаток qty.
    /// </summary>
    public async Task<HubConsumableQtyUpdateResponse> UpdateConsumableQtyAsync(
        HubConsumableQtyUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(new HttpMethod("PATCH"), "equipment/consumables/qty", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    item_id = request.ItemId,
                    inv_no = request.InvNo,
                    qty = request.Qty,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubConsumableQtyUpdateResponse>(response, cancellationToken);
    }

    /// <summary>
    /// POST /equipment/consumables/create — тело как у веб
    /// consumableModel.buildAddConsumablePayload: branch_no/loc_no (int|str),
    /// type_no, qty и модель (model_name и/или model_no) + опциональные поля.
    /// </summary>
    public async Task<HubConsumableCreateResponse> CreateConsumableAsync(
        HubConsumableCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "equipment/consumables/create", token, deviceId);
                httpRequest.Content = CreateJsonContent(new
                {
                    branch_no = request.BranchNo,
                    loc_no = request.LocNo,
                    type_no = request.TypeNo,
                    qty = request.Qty,
                    model_name = request.ModelName,
                    model_no = request.ModelNo,
                    status_no = request.StatusNo,
                    part_no = request.PartNo,
                    description = request.Description,
                });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubConsumableCreateResponse>(response, cancellationToken);
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

    /// <summary>POST /vcs/computers — тело {name, ip_address, location}.</summary>
    public async Task<HubVcsComputer> CreateVcsComputerAsync(
        HubVcsComputerInput computer,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(computer);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "vcs/computers", token, deviceId);
                request.Content = CreateJsonContent(computer);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubVcsComputer>(response, cancellationToken);
    }

    /// <summary>PUT /vcs/computers/{id} — тело как у create (все поля формы).</summary>
    public async Task<HubVcsComputer> UpdateVcsComputerAsync(
        string computerId,
        HubVcsComputerInput computer,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(computerId);
        ArgumentNullException.ThrowIfNull(computer);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "vcs/computers/" + Uri.EscapeDataString(computerId.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(computer);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubVcsComputer>(response, cancellationToken);
    }

    /// <summary>DELETE /vcs/computers/{id} — тела нет; успех {"success": true}.</summary>
    public async Task DeleteVcsComputerAsync(
        string computerId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(computerId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "vcs/computers/" + Uri.EscapeDataString(computerId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    /// <summary>
    /// PUT /vcs/computers/order — тело {"order": [id, …]}: порядок карточек
    /// одним массивом (на сервере маршрут объявлен до /computers/{id}).
    /// </summary>
    public async Task UpdateVcsComputersOrderAsync(
        IReadOnlyList<string> orderedIds,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(orderedIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, "vcs/computers/order", token, deviceId);
                request.Content = CreateJsonContent(new { order = orderedIds });
                return request;
            },
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    /// <summary>GET /vcs/config — флаг password_configured без секрета.</summary>
    public async Task<HubVcsConfig> GetVcsConfigAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "vcs/config", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubVcsConfig>(response, cancellationToken);
    }

    /// <summary>PUT /vcs/config — тело {"password_hex": "…"}; пустое — сброс.</summary>
    public async Task<HubVcsConfig> UpdateVcsConfigAsync(
        string passwordHex,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(passwordHex);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, "vcs/config", token, deviceId);
                request.Content = CreateJsonContent(new { password_hex = passwordHex });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubVcsConfig>(response, cancellationToken);
    }

    /// <summary>GET /vcs/info — {content} инфо-блока ВКС.</summary>
    public async Task<HubVcsInfo> GetVcsInfoAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "vcs/info", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubVcsInfo>(response, cancellationToken);
    }

    /// <summary>PUT /vcs/info — тело {"content": "…"}.</summary>
    public async Task<HubVcsInfo> UpdateVcsInfoAsync(
        string content,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, "vcs/info", token, deviceId);
                request.Content = CreateJsonContent(new { content });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubVcsInfo>(response, cancellationToken);
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

    // ---- Журнал работ по карточке оборудования (/json/works*) ----

    /// <summary>GET /json/works/cartridge/history — сводка замен картриджа по оборудованию.</summary>
    public async Task<HubMaintenanceHistory> GetCartridgeWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        string? cartridgeModel,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cartridge/history"
            + QueryString(
                ("serial_number", serialNumber),
                ("hw_serial_number", hwSerialNumber),
                ("inv_no", invNo),
                ("cartridge_model", cartridgeModel));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMaintenanceHistory>(response, cancellationToken);
    }

    /// <summary>GET /json/works/battery/history — сводка замен батареи по серийнику.</summary>
    public async Task<HubMaintenanceHistory> GetBatteryWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/battery/history"
            + QueryString(
                ("serial_number", serialNumber),
                ("hw_serial_number", hwSerialNumber));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMaintenanceHistory>(response, cancellationToken);
    }

    /// <summary>GET /json/works/component/history — сводка замен комплектующих.</summary>
    public async Task<HubMaintenanceHistory> GetComponentWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? componentType,
        string? componentName,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/component/history"
            + QueryString(
                ("serial_number", serialNumber),
                ("hw_serial_number", hwSerialNumber),
                ("component_type", componentType),
                ("component_name", componentName));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMaintenanceHistory>(response, cancellationToken);
    }

    /// <summary>GET /json/works/cleaning/history — сводка чисток ПК по оборудованию.</summary>
    public async Task<HubMaintenanceHistory> GetCleaningWorkHistoryAsync(
        string? serialNumber,
        string? hwSerialNumber,
        string? invNo,
        long? equipmentId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cleaning/history"
            + QueryString(
                ("serial_number", serialNumber),
                ("hw_serial_number", hwSerialNumber),
                ("inv_no", invNo),
                ("equipment_id", equipmentId?.ToString(CultureInfo.InvariantCulture)));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMaintenanceHistory>(response, cancellationToken);
    }

    /// <summary>
    /// GET /json/works/cartridge?limit= — последние записи журнала картриджей;
    /// серверного фильтра по серийнику у эндпоинта нет — фильтруем клиентом.
    /// </summary>
    public async Task<IReadOnlyList<HubCartridgeWorkRecord>> GetCartridgeWorksAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cartridge"
            + QueryString(("limit", limit.ToString(CultureInfo.InvariantCulture)));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubCartridgeWorkRecord>>(response, cancellationToken)
            ?? [];
    }

    /// <summary>GET /json/works/battery?serial_number=&limit= — записи журнала батарей.</summary>
    public async Task<IReadOnlyList<HubBatteryWorkRecord>> GetBatteryWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/battery"
            + QueryString(
                ("serial_number", serialNumber),
                ("limit", limit.ToString(CultureInfo.InvariantCulture)));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubBatteryWorkRecord>>(response, cancellationToken)
            ?? [];
    }

    /// <summary>GET /json/works/component?serial_number=&limit= — записи журнала комплектующих.</summary>
    public async Task<IReadOnlyList<HubComponentWorkRecord>> GetComponentWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/component"
            + QueryString(
                ("serial_number", serialNumber),
                ("limit", limit.ToString(CultureInfo.InvariantCulture)));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubComponentWorkRecord>>(response, cancellationToken)
            ?? [];
    }

    /// <summary>GET /json/works/cleaning?serial_number=&limit= — записи журнала чисток.</summary>
    public async Task<IReadOnlyList<HubCleaningWorkRecord>> GetCleaningWorksAsync(
        string? serialNumber,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cleaning"
            + QueryString(
                ("serial_number", serialNumber),
                ("limit", limit.ToString(CultureInfo.InvariantCulture)));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<IReadOnlyList<HubCleaningWorkRecord>>(response, cancellationToken)
            ?? [];
    }

    /// <summary>GET /json/works/cleaning/statistics/remaining — ПК филиала без чистки за период.</summary>
    public async Task<HubPcCleaningRemaining> GetPcCleaningRemainingAsync(
        int periodDays,
        string branch,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(branch);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/works/cleaning/statistics/remaining?period_days="
            + periodDays.ToString(CultureInfo.InvariantCulture)
            + "&branch=" + Uri.EscapeDataString(branch.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubPcCleaningRemaining>(response, cancellationToken);
    }

    /// <summary>GET /json/cartridges/compatibility/{printer_model} — таблица совместимости принтера.</summary>
    public async Task<HubCartridgeCompatibility> GetCartridgeCompatibilityAsync(
        string printerModel,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(printerModel);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "json/cartridges/compatibility/" + Uri.EscapeDataString(printerModel.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubCartridgeCompatibility>(response, cancellationToken);
    }

    /// <summary>POST /json/works/cartridge — запись замены картриджа в журнал работ.</summary>
    public async Task<HubCartridgeWorkRecord> RegisterCartridgeWorkAsync(
        HubCartridgeWorkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "json/works/cartridge", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubCartridgeWorkRecord>(response, cancellationToken);
    }

    /// <summary>POST /json/works/battery — запись замены батареи в журнал работ.</summary>
    public async Task<HubBatteryWorkRecord> RegisterBatteryWorkAsync(
        HubBatteryWorkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "json/works/battery", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubBatteryWorkRecord>(response, cancellationToken);
    }

    /// <summary>POST /json/works/component — запись замены комплектующей в журнал работ.</summary>
    public async Task<HubComponentWorkRecord> RegisterComponentWorkAsync(
        HubComponentWorkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "json/works/component", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubComponentWorkRecord>(response, cancellationToken);
    }

    /// <summary>POST /json/works/cleaning — запись чистки ПК в журнал работ.</summary>
    public async Task<HubCleaningWorkRecord> RegisterCleaningWorkAsync(
        HubCleaningWorkRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "json/works/cleaning", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubCleaningWorkRecord>(response, cancellationToken);
    }

    /// <summary>
    /// «?name=value&…» из пар, пропуская пустые значения; при пустом наборе — "".
    /// </summary>
    private static string QueryString(params (string Name, string? Value)[] parts)
    {
        var builder = new StringBuilder();
        var first = true;
        foreach (var (name, value) in parts)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            builder.Append(first ? '?' : '&');
            builder.Append(name);
            builder.Append('=');
            builder.Append(Uri.EscapeDataString(value.Trim()));
            first = false;
        }

        return builder.ToString();
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

    public async Task<HubChatConversationDetail> UpdateChatGroupMemberRoleAsync(
        string conversationId,
        int userId,
        string memberRole,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(memberRole);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/members/" + userId.ToString(CultureInfo.InvariantCulture) + "/role";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { member_role = memberRole });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> RestrictChatGroupMemberAsync(
        string conversationId,
        int userId,
        int? durationSeconds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/members/" + userId.ToString(CultureInfo.InvariantCulture) + "/restriction";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { duration_seconds = durationSeconds });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> LiftChatGroupMemberRestrictionAsync(
        string conversationId,
        int userId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/members/" + userId.ToString(CultureInfo.InvariantCulture) + "/restriction";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatJoinRequestList> GetChatJoinRequestsAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/join-requests";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatJoinRequestList>(response, cancellationToken);
    }

    public async Task<HubChatJoinApproval> SetChatJoinApprovalAsync(
        string conversationId,
        bool approvalRequired,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/join-approval";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { approval_required = approvalRequired });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatJoinApproval>(response, cancellationToken);
    }

    public async Task<HubChatJoinRequestResolution> ResolveChatJoinRequestAsync(
        string conversationId,
        long requestId,
        string decision,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(decision);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/join-requests/" + requestId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { decision });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatJoinRequestResolution>(response, cancellationToken);
    }

    public async Task<HubChatMessageReportResult> ReportChatMessageAsync(
        string conversationId,
        string messageId,
        string reason,
        string? comment,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(messageId);
        ArgumentException.ThrowIfNullOrWhiteSpace(reason);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/" + Uri.EscapeDataString(messageId) + "/report";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { reason, comment });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageReportResult>(response, cancellationToken);
    }

    public async Task<HubChatMessageReportList> GetChatMessageReportsAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/reports";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageReportList>(response, cancellationToken);
    }

    public async Task<HubChatMessageReportResolution> ResolveChatMessageReportAsync(
        string conversationId,
        long reportId,
        string resolution,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(resolution);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/reports/" + reportId.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { resolution });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessageReportResolution>(response, cancellationToken);
    }

    public async Task<HubChatInviteLink> CreateChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/invite-link";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatInviteLink>(response, cancellationToken);
    }

    public async Task<HubChatInviteRevokeResult> RevokeChatGroupInviteLinkAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/invite-link";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatInviteRevokeResult>(response, cancellationToken);
    }

    public async Task<HubChatInvitePreview> GetChatInviteLinkPreviewAsync(
        string token,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/invite-links/" + Uri.EscapeDataString(token);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatInvitePreview>(response, cancellationToken);
    }

    public async Task<HubChatInviteJoinResult> JoinChatByInviteLinkAsync(
        string token,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(token);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/invite-links/" + Uri.EscapeDataString(token) + "/join";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatInviteJoinResult>(response, cancellationToken);
    }

    public async Task DeleteChatConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateChatSupportConversationAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, "chat/conversations/support", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> UpdateChatGroupProfileAsync(
        string conversationId,
        string? title,
        string? description,
        string? postingPolicy,
        int? slowModeSeconds,
        bool? membersSendFiles,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/profile";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                // Поля с null просто не меняются на сервере — PATCH-семантика.
                request.Content = CreateJsonContent(new
                {
                    title,
                    description,
                    posting_policy = postingPolicy,
                    slow_mode_seconds = slowModeSeconds,
                    members_send_files = membersSendFiles,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> UploadChatGroupAvatarAsync(
        string conversationId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/avatar";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new StreamContent(content);
                fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                    string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType);
                form.Add(fileContent, "file", fileName);
                request.Content = form;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatConversationDetail> DeleteChatGroupAvatarAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/avatar";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConversationDetail>(response, cancellationToken);
    }

    public async Task<HubChatShareableTaskList> GetChatShareableTasksAsync(
        string conversationId,
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/shareable-tasks?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(query))
        {
            relative += "&q=" + Uri.EscapeDataString(query.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatShareableTaskList>(response, cancellationToken);
    }

    public async Task<HubChatMessage> SendChatTaskShareAsync(
        string conversationId,
        string taskId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(taskId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/task-share";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    task_id = taskId,
                    client_message_id = clientMessageId,
                    reply_to_message_id = replyToMessageId,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    public async Task<HubChatThreadHydrateResult> HydrateChatMessagesAsync(
        string conversationId,
        IReadOnlyList<string> messageIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentNullException.ThrowIfNull(messageIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId)
            + "/messages/hydrate?message_ids=" + Uri.EscapeDataString(string.Join(",", messageIds));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatThreadHydrateResult>(response, cancellationToken);
    }

    public async Task<HubChatConfig> GetChatConfigAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "chat/config", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatConfig>(response, cancellationToken);
    }

    public async Task<HubChatScheduledMessageList> GetChatScheduledMessagesAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/scheduled";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatScheduledMessageList>(response, cancellationToken);
    }

    public async Task<HubChatScheduledMessage> CreateChatScheduledMessageAsync(
        string conversationId,
        string body,
        DateTimeOffset scheduledFor,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(body);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/scheduled";
        // Как в web: reply_to_message_id в теле только при контексте ответа.
        var payload = new Dictionary<string, object?>(4)
        {
            ["body"] = body,
            ["body_format"] = "plain",
            // Как в web (date.toISOString()): момент отправки уходит в UTC.
            ["scheduled_for"] = scheduledFor.UtcDateTime,
        };
        if (!string.IsNullOrEmpty(replyToMessageId))
        {
            payload["reply_to_message_id"] = replyToMessageId;
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(payload);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatScheduledMessage>(response, cancellationToken);
    }

    public async Task<HubChatScheduledMessage> UpdateChatScheduledMessageAsync(
        string scheduledId,
        string? body,
        DateTimeOffset? scheduledFor,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(scheduledId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/scheduled/" + Uri.EscapeDataString(scheduledId);
        // Web шлёт только переданные поля — явный null затёр бы значение на сервере.
        var payload = new Dictionary<string, object?>(2);
        if (body is not null)
        {
            payload["body"] = body;
        }

        if (scheduledFor is { } when)
        {
            payload["scheduled_for"] = when.UtcDateTime;
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(payload);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatScheduledMessage>(response, cancellationToken);
    }

    public async Task<HubChatScheduledCancelResult> CancelChatScheduledMessageAsync(
        string scheduledId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(scheduledId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/scheduled/" + Uri.EscapeDataString(scheduledId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatScheduledCancelResult>(response, cancellationToken);
    }

    // ---- Чат: папки диалогов (/chat/folders*) ----

    public async Task<HubChatFolderList> GetChatFoldersAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "chat/folders", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderList>(response, cancellationToken);
    }

    public async Task<HubChatFolderMutation> CreateChatFolderAsync(
        string name,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "chat/folders", token, deviceId);
                request.Content = CreateJsonContent(new { name });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderMutation>(response, cancellationToken);
    }

    public async Task<HubChatFolder> GetChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatFolder>(response, cancellationToken);
    }

    public async Task<HubChatFolderMutation> UpdateChatFolderAsync(
        string folderId,
        string? name,
        int? sortOrder,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId);
        // Как в web: только переданные поля — явный null затёр бы значение.
        var payload = new Dictionary<string, object?>(2);
        if (name is not null)
        {
            payload["name"] = name;
        }

        if (sortOrder is { } order)
        {
            payload["sort_order"] = order;
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(payload);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderMutation>(response, cancellationToken);
    }

    public async Task<HubChatFolderDeleteResult> DeleteChatFolderAsync(
        string folderId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderDeleteResult>(response, cancellationToken);
    }

    public async Task<HubChatFolderMutation> ReplaceChatFolderConversationsAsync(
        string folderId,
        IReadOnlyList<string> conversationIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentNullException.ThrowIfNull(conversationIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId) + "/conversations";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { conversation_ids = conversationIds });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderMutation>(response, cancellationToken);
    }

    public async Task<HubChatFolderMutation> AddChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId)
            + "/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderMutation>(response, cancellationToken);
    }

    public async Task<HubChatFolderMutation> RemoveChatFolderConversationAsync(
        string folderId,
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/folders/" + Uri.EscapeDataString(folderId)
            + "/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatFolderMutation>(response, cancellationToken);
    }

    // ---- Чат: стикеры (/chat/sticker-packs*, /chat/stickers/*) ----

    public async Task<HubChatStickerPackList> GetChatStickerPacksAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "chat/sticker-packs", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatStickerPackList>(response, cancellationToken);
    }

    public async Task<HubChatStickerPackList> ImportChatStickerPackAsync(
        string source,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(source);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "chat/sticker-packs/import", token, deviceId);
                request.Content = CreateJsonContent(new { source });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatStickerPackList>(response, cancellationToken);
    }

    public async Task<HubChatStickerPack> GetChatStickerPackPreviewAsync(
        string shortName,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(shortName);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/sticker-packs/preview/" + Uri.EscapeDataString(shortName);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatStickerPack>(response, cancellationToken);
    }

    public async Task<HubChatMessage> SendChatStickerMessageAsync(
        string conversationId,
        string stickerId,
        string? clientMessageId,
        string? replyToMessageId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(stickerId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/messages/sticker";
        // Точный payload web (chatStickers.js sendSticker): необязательные поля
        // не шлём, если их нет — сервер трактует пустую строку как None.
        var payload = new Dictionary<string, object?>(3)
        {
            ["sticker_id"] = stickerId,
        };
        if (!string.IsNullOrEmpty(clientMessageId))
        {
            payload["client_message_id"] = clientMessageId;
        }

        if (!string.IsNullOrEmpty(replyToMessageId))
        {
            payload["reply_to_message_id"] = replyToMessageId;
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(payload);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatMessage>(response, cancellationToken);
    }

    // ---- Чат: ИИ-ассистент (/chat/ai/*) ----

    public async Task<HubChatAiBotList> GetChatAiBotsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "chat/ai/bots", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatAiBotList>(response, cancellationToken);
    }

    public async Task<HubChatConversation> OpenChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(botId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/bots/" + Uri.EscapeDataString(botId) + "/open";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateChatAiBotConversationAsync(
        string botId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(botId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/bots/" + Uri.EscapeDataString(botId) + "/conversations";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversation> CreateChatAiConversationAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "chat/ai/conversations", token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<HubChatConversation> UpdateChatAiConversationAsync(
        string conversationId,
        string title,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        ArgumentException.ThrowIfNullOrWhiteSpace(title);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { title });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatConversation>(response, cancellationToken);
    }

    public async Task<bool> DeleteChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/conversations/" + Uri.EscapeDataString(conversationId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        // Ответ {ok, conversation_id}: без строгой схемы — важен сам факт ok.
        var payload = await ReadJsonAsync<HubChatAiResetResult>(response, cancellationToken);
        return payload.Ok;
    }

    public async Task<HubChatAiStatus> GetChatAiStatusAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/conversations/" + Uri.EscapeDataString(conversationId) + "/ai-status";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatAiStatus>(response, cancellationToken);
    }

    public async Task<HubChatAiStatus> StopChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/conversations/" + Uri.EscapeDataString(conversationId) + "/stop";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatAiStatus>(response, cancellationToken);
    }

    public async Task<HubChatAiStatus> RetryChatAiConversationAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/conversations/" + Uri.EscapeDataString(conversationId) + "/retry";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatAiStatus>(response, cancellationToken);
    }

    public async Task<HubChatAiResetResult> ResetChatAiContextAsync(
        string conversationId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/conversations/" + Uri.EscapeDataString(conversationId) + "/reset-context";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatAiResetResult>(response, cancellationToken);
    }

    public async Task<HubChatActionCard> ConfirmChatAiActionAsync(
        string actionId,
        string? choice,
        string? format,
        string? scope,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/actions/" + Uri.EscapeDataString(actionId) + "/confirm";
        // payload_overrides — как web onConfirmAction(card, message, {choice|format|scope}).
        Dictionary<string, object?>? payload = null;
        if (!string.IsNullOrEmpty(choice))
        {
            payload = new Dictionary<string, object?>(1) { ["choice"] = choice };
        }
        else if (!string.IsNullOrEmpty(format))
        {
            payload = new Dictionary<string, object?>(1) { ["format"] = format };
        }
        else if (!string.IsNullOrEmpty(scope))
        {
            payload = new Dictionary<string, object?>(1) { ["scope"] = scope };
        }

        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(payload ?? new Dictionary<string, object?>());
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatActionCard>(response, cancellationToken);
    }

    public async Task<HubChatActionCard> CancelChatAiActionAsync(
        string actionId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(actionId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/actions/" + Uri.EscapeDataString(actionId) + "/cancel";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatActionCard>(response, cancellationToken);
    }

    public async Task<HubChatAiMemoryList> GetChatAiMemoryAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "chat/ai/memory", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatAiMemoryList>(response, cancellationToken);
    }

    public async Task<HubChatAiMemoryList> UpdateChatAiMemorySettingsAsync(
        bool enabled,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, "chat/ai/memory/settings", token, deviceId);
                request.Content = CreateJsonContent(new { enabled });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatAiMemoryList>(response, cancellationToken);
    }

    public async Task<HubChatAiMemoryItem> UpdateChatAiMemoryItemAsync(
        string memoryId,
        string content,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(memoryId);
        ArgumentException.ThrowIfNullOrWhiteSpace(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/memory/" + Uri.EscapeDataString(memoryId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new { content });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubChatAiMemoryItem>(response, cancellationToken);
    }

    public async Task<HubChatAiMemoryDeleteResult> DeleteChatAiMemoryItemAsync(
        string memoryId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(memoryId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "chat/ai/memory/" + Uri.EscapeDataString(memoryId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatAiMemoryDeleteResult>(response, cancellationToken);
    }

    public async Task<HubChatAiMemoryDeleteResult> ClearChatAiMemoryAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, "chat/ai/memory", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubChatAiMemoryDeleteResult>(response, cancellationToken);
    }

    // ---- Desktop presence ----

    /// <summary>POST /desktop-presence/heartbeat — тело {} (модель extra=forbid).</summary>
    public async Task<HubDesktopPresence> SendDesktopPresenceHeartbeatAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "desktop-presence/heartbeat", token, deviceId);
                request.Content = CreateJsonContent(new { });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubDesktopPresence>(response, cancellationToken);
    }

    /// <summary>DELETE /desktop-presence/current — graceful disconnect; best-effort.</summary>
    public async Task<HubDesktopPresence> DisconnectDesktopPresenceAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, "desktop-presence/current", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDesktopPresence>(response, cancellationToken);
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

    // ---- Мои файлы: корзина ----

    public async Task<HubMyFileTrash> GetMyFilesTrashAsync(
        string? libraryId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash";
        if (!string.IsNullOrWhiteSpace(libraryId))
        {
            relative += "?library_id=" + Uri.EscapeDataString(libraryId.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileTrash>(response, cancellationToken)
            ?? new HubMyFileTrash();
    }

    public async Task EmptyMyFilesTrashAsync(
        string? libraryId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash/empty";
        if (!string.IsNullOrWhiteSpace(libraryId))
        {
            relative += "?library_id=" + Uri.EscapeDataString(libraryId.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task RestoreMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash/files/" + Uri.EscapeDataString(fileId.Trim()) + "/restore";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task RestoreMyFileFolderAsync(string folderId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash/folders/" + Uri.EscapeDataString(folderId.Trim()) + "/restore";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task PurgeMyFileAsync(string fileId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash/files/" + Uri.EscapeDataString(fileId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task PurgeMyFileFolderAsync(string folderId, CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/trash/folders/" + Uri.EscapeDataString(folderId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    // ---- Мои файлы: квота / копия / архив / предпросмотр ----

    public async Task<HubMyFileQuota> GetMyFilesQuotaAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "my-files/quota", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileQuota>(response, cancellationToken)
            ?? new HubMyFileQuota();
    }

    public async Task<HubMyFileItem> CopyMyFileAsync(
        string fileId,
        string? folderId,
        string? libraryId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/copy";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    folder_id = folderId,
                    library_id = libraryId,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileItem>(response, cancellationToken);
    }

    public async Task<string> DownloadMyFileFolderArchiveAsync(
        string folderId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(folderId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var grantPath = "my-files/folders/" + Uri.EscapeDataString(folderId.Trim())
            + "/archive-grant";
        using var grantResponse = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, grantPath, token, deviceId),
            cancellationToken);
        var grant = await ReadJsonAsync<HubMyFileDownloadGrant>(grantResponse, cancellationToken);
        var relative = NormalizeMyFilesDownloadPath(grant.DownloadPath);
        // Тот же конвейер, что DownloadMyFileAsync: одноразовый grant → стрим в файл.
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

    public async Task<HubMyFilePreview> GetMyFilePreviewAsync(
        string fileId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/preview";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFilePreview>(response, cancellationToken);
    }

    public async Task<string> DownloadMyFilePreviewContentAsync(
        string fileId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/" + Uri.EscapeDataString(fileId.Trim()) + "/preview/content";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return response.Content.Headers.ContentType?.MediaType ?? string.Empty;
    }

    // ---- Мои файлы: управление общими папками ----

    public async Task<HubMyFileLibrary> CreateMyFileLibraryAsync(
        string name,
        long quotaBytes,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, "my-files/libraries", token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    name = name.Trim(),
                    quota_bytes = quotaBytes,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileLibrary>(response, cancellationToken);
    }

    public async Task<HubMyFileLibrary> UpdateMyFileLibraryAsync(
        string libraryId,
        string? name,
        long? quotaBytes,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/libraries/" + Uri.EscapeDataString(libraryId.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    name = string.IsNullOrWhiteSpace(name) ? null : name.Trim(),
                    quota_bytes = quotaBytes,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileLibrary>(response, cancellationToken);
    }

    public async Task DeleteMyFileLibraryAsync(
        string libraryId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/libraries/" + Uri.EscapeDataString(libraryId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubMyFileLibraryMembers> GetMyFileLibraryMembersAsync(
        string libraryId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/libraries/" + Uri.EscapeDataString(libraryId.Trim()) + "/members";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFileLibraryMembers>(response, cancellationToken)
            ?? new HubMyFileLibraryMembers();
    }

    public async Task<HubMyFileLibraryMembers> SetMyFileLibraryMembersAsync(
        string libraryId,
        IReadOnlyList<HubMyFileLibraryMemberInput> members,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(libraryId);
        ArgumentNullException.ThrowIfNull(members);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "my-files/libraries/" + Uri.EscapeDataString(libraryId.Trim()) + "/members";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new { members });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubMyFileLibraryMembers>(response, cancellationToken)
            ?? new HubMyFileLibraryMembers();
    }

    public async Task<IReadOnlyList<HubMyFileOfficeGroup>> GetMyFileOfficeGroupsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        try
        {
            using var response = await SendAuthenticatedAsync(
                token => CreateRequest(HttpMethod.Get, "my-files/office/groups", token, deviceId),
                cancellationToken);
            var list = await ReadJsonAsync<HubMyFileOfficeGroupList>(response, cancellationToken);
            return list.Items ?? [];
        }
        catch (HubApiException)
        {
            // Отделы — необязательная часть диалога (право my_files.share):
            // как в вебе, при отказе список просто пуст — пользователи ищутся по chat/users.
            return [];
        }
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

    /// <summary>
    /// PATCH /feedback/{id} — только выставленные ключи (backend exclude_unset):
    /// admin_note:null очистил бы комментарий, поэтому словарь собирается по флагу.
    /// </summary>
    public async Task<HubAdminFeedbackItem> UpdateFeedbackAsync(
        string itemId,
        string? status,
        string? adminNote,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(itemId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var patch = new Dictionary<string, object?>(StringComparer.Ordinal);
        if (!string.IsNullOrWhiteSpace(status))
        {
            patch["status"] = status.Trim();
        }

        if (adminNote is not null)
        {
            patch["admin_note"] = adminNote;
        }

        var relative = "feedback/" + Uri.EscapeDataString(itemId.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                request.Content = CreateJsonContent(patch);
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminFeedbackItem>(response, cancellationToken);
    }

    public async Task<HubFeedbackSuggestion> CreateFeedbackAsync(
        HubFeedbackCreate request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "feedback", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubFeedbackSuggestion>(response, cancellationToken);
    }

    public async Task<HubMyFeedbackPage> GetMyFeedbackAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "feedback/mine?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMyFeedbackPage>(response, cancellationToken)
            ?? new HubMyFeedbackPage();
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

    public async Task<HubAdminAiBot> UpdateAiBotAsync(
        string botId,
        HubAiBotUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(botId);
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"ai-bots/{Uri.EscapeDataString(botId)}";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminAiBot>(response, cancellationToken);
    }

    public async Task<HubAdminAiBot> CreateAiBotAsync(
        HubAiBotCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "ai-bots", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminAiBot>(response, cancellationToken);
    }

    public async Task<HubAdminDepartmentMembers> SetDepartmentManagersAsync(
        string departmentId,
        IReadOnlyList<long> managerUserIds,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(departmentId);
        ArgumentNullException.ThrowIfNull(managerUserIds);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"departments/{Uri.EscapeDataString(departmentId)}/managers";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(
                    new HubDepartmentManagersUpdateRequest { ManagerUserIds = managerUserIds });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminDepartmentMembers>(response, cancellationToken)
            ?? new HubAdminDepartmentMembers();
    }

    public async Task<HubAdminUser> UpdateUserAsync(
        long userId,
        HubUserUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"auth/users/{userId.ToString(CultureInfo.InvariantCulture)}";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminUser>(response, cancellationToken);
    }

    public async Task<HubAdminUser> CreateUserAsync(
        HubUserCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "auth/users", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAdminUser>(response, cancellationToken);
    }

    public async Task<HubResetTwoFactorResult> ResetUserTwoFactorAsync(
        long userId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"auth/users/{userId.ToString(CultureInfo.InvariantCulture)}/reset-2fa";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubResetTwoFactorResult>(response, cancellationToken)
            ?? new HubResetTwoFactorResult { Success = true, UserId = userId };
    }

    public async Task<HubMailQuotaSnapshot> GetLatestMailQuotaSnapshotAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "mail/mailbox-quota-snapshots/latest", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailQuotaSnapshot>(response, cancellationToken);
    }

    public async Task<IReadOnlyList<HubMailQuotaSnapshot>> GetMailQuotaSnapshotsAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "mail/mailbox-quota-snapshots?limit="
            + Math.Clamp(limit, 1, 100).ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<List<HubMailQuotaSnapshot>>(response, cancellationToken) ?? [];
    }

    public async Task<HubMailQuotaSnapshotStats> GetMailQuotaSnapshotSummaryAsync(
        int snapshotId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"mail/mailbox-quota-snapshots/{snapshotId.ToString(CultureInfo.InvariantCulture)}/summary";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailQuotaSnapshotStats>(response, cancellationToken)
            ?? new HubMailQuotaSnapshotStats();
    }

    public async Task<HubMailQuotaRowsPage> GetMailQuotaRowsAsync(
        int snapshotId,
        HubMailQuotaRowsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder(
            $"mail/mailbox-quota-snapshots/{snapshotId.ToString(CultureInfo.InvariantCulture)}/rows?");
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("search=").Append(Uri.EscapeDataString(query.Search.Trim())).Append('&');
        }

        // Флаги-фильтры уходят только при true — false-вариант равен дефолту сервера.
        if (query.OverQuota)
        {
            builder.Append("over_quota=true&");
        }

        if (query.Warning90)
        {
            builder.Append("warning_90=true&");
        }

        if (query.NoQuota)
        {
            builder.Append("no_quota=true&");
        }

        if (!string.IsNullOrWhiteSpace(query.DatabaseName))
        {
            builder.Append("database_name=").Append(Uri.EscapeDataString(query.DatabaseName.Trim())).Append('&');
        }

        builder.Append("limit=").Append(Math.Clamp(query.Limit, 1, 500).ToString(CultureInfo.InvariantCulture))
            .Append("&offset=").Append(Math.Max(0, query.Offset).ToString(CultureInfo.InvariantCulture));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubMailQuotaRowsPage>(response, cancellationToken)
            ?? new HubMailQuotaRowsPage();
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

    /// <summary>Сколько раз повторяем preview/pdf при 202 — как DocflowPreviewMaxAttempts.</summary>
    private const int TaskAttachmentPreviewMaxAttempts = 8;

    public async Task<HubTaskCommentList> GetTaskCommentsAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/comments";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskCommentList>(response, cancellationToken);
    }

    public async Task<HubTaskComment> AddTaskCommentAsync(
        long taskId,
        string body,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(body);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/comments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                request.Content = CreateJsonContent(new { body });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTaskComment>(response, cancellationToken);
    }

    public async Task MarkTaskCommentsSeenAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/comments/mark-seen";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<HubTaskDiscussion> OpenTaskDiscussionAsync(
        long taskId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/discussion";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskDiscussion>(response, cancellationToken);
    }

    public async Task<HubTaskAttachment> UploadTaskAttachmentAsync(
        long taskId,
        string fileName,
        Stream content,
        string? mimeType,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(fileName);
        ArgumentNullException.ThrowIfNull(content);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/attachments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new StreamContent(content);
                fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                    string.IsNullOrWhiteSpace(mimeType) ? "application/octet-stream" : mimeType);
                form.Add(fileContent, "file", fileName);
                request.Content = form;
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTaskAttachment>(response, cancellationToken);
    }

    public async Task DeleteTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}"
            + "/attachments/" + Uri.EscapeDataString(attachmentId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    public async Task<string> DownloadTaskAttachmentAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}"
            + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/file";
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

    public async Task<string> DownloadTaskAttachmentPreviewPdfAsync(
        long taskId,
        string attachmentId,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(attachmentId);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}"
            + "/attachments/" + Uri.EscapeDataString(attachmentId) + "/preview/pdf";
        // Office-превью генерируется асинхронно: 202 + Retry-After, пока не ready.
        for (var attempt = 1; ; attempt++)
        {
            using var response = await SendAuthenticatedAsync(
                token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
                cancellationToken,
                HttpCompletionOption.ResponseHeadersRead);
            if (response.StatusCode == HttpStatusCode.Accepted)
            {
                if (attempt >= TaskAttachmentPreviewMaxAttempts)
                {
                    throw new HubApiException(
                        HubApiErrorKind.Http,
                        "Предпросмотр файла ещё готовится. Откройте сам файл или повторите позже.",
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

    public async Task<HubTaskCreateResult> CreateTaskAsync(
        HubTaskCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "hub/tasks", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTaskCreateResult>(response, cancellationToken);
    }

    public async Task<HubTaskDetail> CreateSubtaskAsync(
        long taskId,
        HubTaskSubtaskCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = $"hub/tasks/{taskId.ToString(CultureInfo.InvariantCulture)}/subtasks";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubTaskDetail>(response, cancellationToken);
    }

    public async Task<HubTaskUserList> SearchTaskAssigneesAsync(
        string? query,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/users/assignees?limit=" + limit.ToString(CultureInfo.InvariantCulture);
        if (!string.IsNullOrWhiteSpace(query))
        {
            relative += "&q=" + Uri.EscapeDataString(query.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskUserList>(response, cancellationToken);
    }

    public async Task<HubTaskUserList> GetTaskControllersAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "hub/users/controllers", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskUserList>(response, cancellationToken);
    }

    public async Task<HubTaskProjectList> GetTaskProjectsAsync(CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "hub/task-projects", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskProjectList>(response, cancellationToken);
    }

    public async Task<HubTaskObjectList> GetTaskObjectsAsync(
        string? projectId,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/task-objects";
        if (!string.IsNullOrWhiteSpace(projectId))
        {
            relative += "?project_id=" + Uri.EscapeDataString(projectId.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskObjectList>(response, cancellationToken);
    }

    public async Task<HubTaskAnalyticsPayload> GetTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/tasks/analytics" + BuildTaskAnalyticsQueryString(query);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubTaskAnalyticsPayload>(response, cancellationToken);
    }

    public async Task<string> ExportTaskAnalyticsAsync(
        HubTaskAnalyticsQuery query,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/tasks/analytics/export" + BuildTaskAnalyticsQueryString(query);
        // ResponseHeadersRead: тело xlsx стримится в destination — паттерн DownloadTaskAttachmentAsync.
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

    /// <summary>
    /// Параметры /hub/tasks/analytics(+ /export): пустые даты опускаем, date_basis
    /// шлём всегда (дефолт роута protocol_date); списки id — повторяющимися
    /// параметрами project_id/object_id/participant_user_id (list[...] = Query).
    /// </summary>
    private static string BuildTaskAnalyticsQueryString(HubTaskAnalyticsQuery query)
    {
        var builder = new StringBuilder();
        AppendParameter(builder, "start_date", TrimOrEmpty(query.StartDate));
        AppendParameter(builder, "end_date", TrimOrEmpty(query.EndDate));
        builder.Append("&date_basis=").Append(
            Uri.EscapeDataString(
                string.IsNullOrWhiteSpace(query.DateBasis) ? "protocol_date" : query.DateBasis.Trim()));
        if (query.ProjectIds is not null)
        {
            foreach (var id in query.ProjectIds)
            {
                AppendParameter(builder, "project_id", TrimOrEmpty(id));
            }
        }

        if (query.ObjectIds is not null)
        {
            foreach (var id in query.ObjectIds)
            {
                AppendParameter(builder, "object_id", TrimOrEmpty(id));
            }
        }

        if (query.ParticipantUserIds is not null)
        {
            foreach (var id in query.ParticipantUserIds)
            {
                if (id > 0)
                {
                    builder.Append("&participant_user_id=").Append(
                        id.ToString(CultureInfo.InvariantCulture));
                }
            }
        }

        return builder.Length == 0 ? string.Empty : "?" + builder.ToString()[1..];

        static string? TrimOrEmpty(string? value)
        {
            var trimmed = (value ?? string.Empty).Trim();
            return trimmed.Length == 0 ? null : trimmed;
        }

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

    // ============================================================================
    // Администрирование новостей (раздел «Новости» нативной админки).
    // Контракт — api/v1/hub.py: manage-выдача и publish/archive — write|moderate
    // (сервер дополнительно ограничивает не-модератора своими новостями),
    // create/drafts — строго announcements.write, delete — announcements.moderate.
    // ============================================================================

    public async Task<HubAnnouncementManagePage> GetManagedAnnouncementsAsync(
        HubAnnouncementManageQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("hub/announcements/manage?");
        if (!string.IsNullOrWhiteSpace(query.Status))
        {
            builder.Append("status=").Append(Uri.EscapeDataString(query.Status.Trim())).Append('&');
        }

        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("q=").Append(Uri.EscapeDataString(query.Search.Trim())).Append('&');
        }

        if (!string.IsNullOrWhiteSpace(query.CategoryId))
        {
            builder.Append("category_id=").Append(Uri.EscapeDataString(query.CategoryId.Trim())).Append('&');
        }

        if (!string.IsNullOrWhiteSpace(query.Tag))
        {
            builder.Append("tag=").Append(Uri.EscapeDataString(query.Tag.Trim())).Append('&');
        }

        builder.Append("limit=").Append(query.Limit.ToString(CultureInfo.InvariantCulture))
            .Append("&offset=").Append(query.Offset.ToString(CultureInfo.InvariantCulture));
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementManagePage>(response, cancellationToken)
            ?? new HubAnnouncementManagePage();
    }

    public async Task<HubAnnouncementItem> CreateAnnouncementAsync(
        HubAnnouncementCreateRequest request,
        IReadOnlyList<HubAnnouncementOutgoingFile>? files,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var hasFiles = files is { Count: > 0 };
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "hub/announcements", token, deviceId);
                // Контракт роута: content-type определяет парсинг — JSON или
                // multipart со скалярами-строками и повторяющимся полем files.
                httpRequest.Content = hasFiles
                    ? CreateAnnouncementMultipart(request, files!)
                    : (HttpContent)CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken)
            ?? new HubAnnouncementItem();
    }

    public async Task<HubAnnouncementItem> CreateAnnouncementDraftAsync(
        HubAnnouncementCreateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "hub/announcements/drafts", token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken)
            ?? new HubAnnouncementItem();
    }

    public async Task<HubAnnouncementItem> UpdateAnnouncementAsync(
        string announcementId,
        HubAnnouncementUpdateRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        ArgumentNullException.ThrowIfNull(request);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Patch, relative, token, deviceId);
                httpRequest.Content = CreateJsonContent(request);
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken)
            ?? new HubAnnouncementItem();
    }

    public async Task<HubAnnouncementItem> PublishAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/publish";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken)
            ?? new HubAnnouncementItem();
    }

    public async Task<HubAnnouncementItem> ArchiveAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/archive";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Post, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementItem>(response, cancellationToken)
            ?? new HubAnnouncementItem();
    }

    public async Task DeleteManagedAnnouncementAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
    }

    public async Task<HubAnnouncementCategoryList> GetAnnouncementCategoriesAsync(
        bool includeInactive,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcement-categories"
            + (includeInactive ? "?include_inactive=true" : string.Empty);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementCategoryList>(response, cancellationToken)
            ?? new HubAnnouncementCategoryList();
    }

    public async Task<HubAnnouncementCategory> CreateAnnouncementCategoryAsync(
        string name,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, "hub/announcement-categories", token, deviceId);
                httpRequest.Content = CreateJsonContent(
                    new HubAnnouncementCategorySaveRequest { Name = name.Trim() });
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementCategory>(response, cancellationToken)
            ?? new HubAnnouncementCategory();
    }

    public async Task<HubAnnouncementTagList> GetAnnouncementTagsAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "hub/announcement-tags", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementTagList>(response, cancellationToken)
            ?? new HubAnnouncementTagList();
    }

    public async Task<HubAnnouncementAttachment> UploadAnnouncementAttachmentAsync(
        string announcementId,
        HubAnnouncementOutgoingFile file,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/attachments";
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var httpRequest = CreateRequest(HttpMethod.Post, relative, token, deviceId);
                var form = new MultipartFormDataContent();
                var fileContent = new ByteArrayContent(file.Content.ToArray());
                fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                    string.IsNullOrWhiteSpace(file.ContentType)
                        ? "application/octet-stream"
                        : file.ContentType);
                form.Add(fileContent, "file", file.FileName ?? "file.bin");
                httpRequest.Content = form;
                return httpRequest;
            },
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementAttachment>(response, cancellationToken)
            ?? new HubAnnouncementAttachment();
    }

    public async Task<HubAnnouncementAnalytics> GetAnnouncementAnalyticsAsync(
        string announcementId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(announcementId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "hub/announcements/" + Uri.EscapeDataString(announcementId) + "/analytics";
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubAnnouncementAnalytics>(response, cancellationToken)
            ?? new HubAnnouncementAnalytics();
    }

    /// <summary>
    /// Multipart-тело POST /hub/announcements — имена полей как у
    /// createAnnouncement веб-клиента: скаляры строками, tags JSON-массивом,
    /// файлы повторяющимся полем files (лимит сервера 20 МБ на файл).
    /// </summary>
    private static MultipartFormDataContent CreateAnnouncementMultipart(
        HubAnnouncementCreateRequest request,
        IReadOnlyList<HubAnnouncementOutgoingFile> files)
    {
        var content = new MultipartFormDataContent();
        void AddField(string name, string? value) =>
            content.Add(new StringContent(value ?? string.Empty, Encoding.UTF8), name);

        AddField("title", request.Title);
        AddField("preview", request.Preview);
        AddField("body", request.Body);
        AddField("priority", request.Priority ?? "normal");
        AddField("status", request.Status ?? "published");
        AddField("category_id", request.CategoryId);
        AddField(
            "tags",
            JsonSerializer.Serialize(request.Tags ?? (IReadOnlyList<string>)[], JsonOptions));
        AddField("requires_ack", request.RequiresAck ? "true" : "false");
        AddField("is_pinned", request.IsPinned ? "true" : "false");
        AddField("comments_enabled", request.CommentsEnabled ? "true" : "false");
        AddField("reactions_enabled", request.ReactionsEnabled ? "true" : "false");
        if (!string.IsNullOrWhiteSpace(request.ClientRequestId))
        {
            AddField("client_request_id", request.ClientRequestId);
        }

        foreach (var file in files)
        {
            var fileContent = new ByteArrayContent(file.Content.ToArray());
            fileContent.Headers.ContentType = MediaTypeHeaderValue.Parse(
                string.IsNullOrWhiteSpace(file.ContentType)
                    ? "application/octet-stream"
                    : file.ContentType);
            fileContent.Headers.TryAddWithoutValidation(
                "Content-Disposition",
                "form-data; name=\"files\"; filename=\""
                + (file.FileName ?? "file.bin").Replace("\"", "_")
                + "\"");
            content.Add(fileContent, "files", file.FileName ?? "file.bin");
        }

        return content;
    }

    // ---- Строительство ----

    /// <summary>Запросы строительного контура идут в 1С — как WAREHOUSE_1C_QUERY_TIMEOUT_MS в вебе.</summary>
    private static readonly TimeSpan ConstructionRequestTimeout = TimeSpan.FromSeconds(120);

    /// <summary>GET /construction/objects — портфель объектов/контуров заявок 1С.</summary>
    public async Task<HubConstructionObjectsResponse> GetConstructionObjectsAsync(
        HubConstructionObjectsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var kind = query.Kind is "project" or "general" or "unassigned" ? query.Kind : "all";
        var builder = new StringBuilder("construction/objects?kind=").Append(kind)
            .Append("&limit=").Append(Math.Clamp(query.Limit, 1, 48).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Cursor))
        {
            builder.Append("&cursor=").Append(Uri.EscapeDataString(query.Cursor.Trim()));
        }

        if (query.Refresh)
        {
            builder.Append("&refresh=true");
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: ConstructionRequestTimeout);
        return await ReadJsonAsync<HubConstructionObjectsResponse>(response, cancellationToken);
    }

    /// <summary>GET /construction/objects/{id} — карточка: группы-направления, команда, реквизиты.</summary>
    public async Task<HubConstructionObjectDetail> GetConstructionObjectDetailAsync(
        string objectId,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectId);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "construction/objects/" + Uri.EscapeDataString(objectId.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: ConstructionRequestTimeout);
        return await ReadJsonAsync<HubConstructionObjectDetail>(response, cancellationToken);
    }

    /// <summary>GET /construction/objects/{id}/requests — заявки по всем группам объекта + direction_stats.</summary>
    public async Task<HubConstructionObjectRequestsResponse> GetConstructionObjectRequestsAsync(
        string objectId,
        HubConstructionRequestsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(objectId);
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var view = query.View is "history" or "all" ? query.View : "active";
        var builder = new StringBuilder("construction/objects/")
            .Append(Uri.EscapeDataString(objectId.Trim()))
            .Append("/requests?view=").Append(view)
            .Append("&limit=").Append(Math.Clamp(query.Limit, 1, 100).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Cursor))
        {
            builder.Append("&cursor=").Append(Uri.EscapeDataString(query.Cursor.Trim()));
        }

        if (query.Refresh)
        {
            builder.Append("&refresh=true");
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: ConstructionRequestTimeout);
        return await ReadJsonAsync<HubConstructionObjectRequestsResponse>(response, cancellationToken);
    }

    // ---- Склад 1С ----

    /// <summary>Запросы склада 1С идут в COM-коннектор — как WAREHOUSE_1C_QUERY_TIMEOUT_MS в вебе.</summary>
    private static readonly TimeSpan Warehouse1cRequestTimeout = TimeSpan.FromSeconds(120);

    /// <summary>GET /warehouse-1c/nomenclature/search — подсказки номенклатуры (массив либо {items}).</summary>
    public async Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cNomenclatureAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        var builder = new StringBuilder("warehouse-1c/nomenclature/search?limit=")
            .Append(Math.Clamp(limit, 1, 100).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Trim()));
        }

        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadWarehouse1cItemsAsync<HubWarehouse1cCatalogItem>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/warehouses/search — подсказки складов (массив либо {items}).</summary>
    public async Task<IReadOnlyList<HubWarehouse1cCatalogItem>> SearchWarehouse1cWarehousesAsync(
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        var builder = new StringBuilder("warehouse-1c/warehouses/search?limit=")
            .Append(Math.Clamp(limit, 1, 100).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Trim()));
        }

        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadWarehouse1cItemsAsync<HubWarehouse1cCatalogItem>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/balances?include_meta=true — остатки с фильтрами и агрегатами.</summary>
    public async Task<HubWarehouse1cBalancesResponse> GetWarehouse1cBalancesAsync(
        HubWarehouse1cBalancesQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("warehouse-1c/balances?include_meta=true&limit=")
            .Append(Math.Clamp(query.Limit, 1, 500).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.NomenclatureRef))
        {
            builder.Append("&nomenclature_ref=").Append(Uri.EscapeDataString(query.NomenclatureRef.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.WarehouseRef))
        {
            builder.Append("&warehouse_ref=").Append(Uri.EscapeDataString(query.WarehouseRef.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Text))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Text.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubWarehouse1cBalancesResponse>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/movements?include_meta=true — ведомость с cursor-пагинацией.</summary>
    public async Task<HubWarehouse1cMovementsResponse> GetWarehouse1cMovementsAsync(
        HubWarehouse1cMovementsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var builder = new StringBuilder("warehouse-1c/movements?include_meta=true&limit=")
            .Append(Math.Clamp(query.Limit, 1, 2000).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.NomenclatureRef))
        {
            builder.Append("&nomenclature_ref=").Append(Uri.EscapeDataString(query.NomenclatureRef.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.WarehouseRef))
        {
            builder.Append("&warehouse_ref=").Append(Uri.EscapeDataString(query.WarehouseRef.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.SeriesRef))
        {
            builder.Append("&series_ref=").Append(Uri.EscapeDataString(query.SeriesRef.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.DateFrom))
        {
            builder.Append("&date_from=").Append(Uri.EscapeDataString(query.DateFrom.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.DateTo))
        {
            builder.Append("&date_to=").Append(Uri.EscapeDataString(query.DateTo.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Cursor))
        {
            builder.Append("&cursor=").Append(Uri.EscapeDataString(query.Cursor.Trim()));
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubWarehouse1cMovementsResponse>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/movements/detail — карточка регистратора с файлами.</summary>
    public async Task<HubWarehouse1cMovementDetail> GetWarehouse1cMovementDetailAsync(
        string registrarRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(registrarRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "warehouse-1c/movements/detail?registrar_ref="
            + Uri.EscapeDataString(registrarRef.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubWarehouse1cMovementDetail>(response, cancellationToken);
    }

    /// <summary>
    /// GET /warehouse-1c/movements/files/{file_ref}?registrar_ref — скачивание вложения
    /// в destination (ResponseHeadersRead, как у chat-attachments).
    /// </summary>
    public async Task<string> DownloadWarehouse1cMovementFileAsync(
        string registrarRef,
        string fileRef,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(registrarRef);
        ArgumentException.ThrowIfNullOrWhiteSpace(fileRef);
        ArgumentNullException.ThrowIfNull(destination);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "warehouse-1c/movements/files/" + Uri.EscapeDataString(fileRef.Trim())
            + "?registrar_ref=" + Uri.EscapeDataString(registrarRef.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            HttpCompletionOption.ResponseHeadersRead,
            requestTimeout: Warehouse1cRequestTimeout);
        await EnsureSuccessAsync(response, cancellationToken);
        await response.Content.CopyToAsync(destination, cancellationToken);
        return ParseContentDispositionFileName(
            response.Content.Headers.ContentDisposition?.FileNameStar
            ?? response.Content.Headers.ContentDisposition?.FileName);
    }

    /// <summary>GET /warehouse-1c/dismissed-warehouses?include_meta=true — склады уволенных.</summary>
    public async Task<HubWarehouse1cDismissedResponse> GetWarehouse1cDismissedWarehousesAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "warehouse-1c/dismissed-warehouses?include_meta=true&limit="
            + Math.Clamp(limit, 1, 200).ToString(CultureInfo.InvariantCulture);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubWarehouse1cDismissedResponse>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/catalog/status — состояние кэша справочников 1С.</summary>
    public async Task<HubWarehouse1cCatalogStatus> GetWarehouse1cCatalogStatusAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "warehouse-1c/catalog/status", token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubWarehouse1cCatalogStatus>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/it-requests — snapshot-список заявок на МПЗ.</summary>
    public async Task<HubItRequestsResponse> GetWarehouse1cItRequestsAsync(
        HubItRequestsQuery query,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(query);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var view = query.View is "history" or "all" ? query.View : "active";
        var builder = new StringBuilder("warehouse-1c/it-requests?view=").Append(view)
            .Append("&limit=").Append(Math.Clamp(query.Limit, 1, 100).ToString(CultureInfo.InvariantCulture));
        if (!string.IsNullOrWhiteSpace(query.Search))
        {
            builder.Append("&q=").Append(Uri.EscapeDataString(query.Search.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.Stage))
        {
            builder.Append("&stage=").Append(Uri.EscapeDataString(query.Stage.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(query.WarehouseRef))
        {
            builder.Append("&warehouse_ref=").Append(Uri.EscapeDataString(query.WarehouseRef.Trim()));
        }

        if (query.Overdue is { } overdue)
        {
            builder.Append("&overdue=").Append(overdue ? "true" : "false");
        }

        if (!string.IsNullOrWhiteSpace(query.Cursor))
        {
            builder.Append("&cursor=").Append(Uri.EscapeDataString(query.Cursor.Trim()));
        }

        if (query.Refresh)
        {
            builder.Append("&refresh=true");
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, builder.ToString(), token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubItRequestsResponse>(response, cancellationToken);
    }

    /// <summary>GET /warehouse-1c/it-requests/{ref} — деталь заявки на МПЗ.</summary>
    public async Task<HubItRequestItem> GetWarehouse1cItRequestDetailAsync(
        string requestRef,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(requestRef);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "warehouse-1c/it-requests/" + Uri.EscapeDataString(requestRef.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken,
            requestTimeout: Warehouse1cRequestTimeout);
        return await ReadJsonAsync<HubItRequestItem>(response, cancellationToken);
    }

    /// <summary>
    /// Списки warehouse-1c приходят то массивом, то конвертом {items|rows, meta}
    /// (normalizeWarehouse1cListResponse в вебе): читаем JsonElement и достаём массив.
    /// </summary>
    private static async Task<IReadOnlyList<TItem>> ReadWarehouse1cItemsAsync<TItem>(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);
        var root = document.RootElement;
        var items = root;
        if (root.ValueKind == JsonValueKind.Object)
        {
            if (root.TryGetProperty("items", out var itemsElement)
                || root.TryGetProperty("rows", out itemsElement)
                || root.TryGetProperty("results", out itemsElement))
            {
                items = itemsElement;
            }
            else
            {
                return [];
            }
        }

        return items.ValueKind == JsonValueKind.Array
            ? items.Deserialize<List<TItem>>(JsonOptions) ?? []
            : [];
    }

    // ==================== DLP-мониторинг (admin-only на сервере) ====================

    /// <summary>GET /inventory/dlp/hosts?category= — статистика по ПК.</summary>
    public async Task<HubDlpHostsResponse> ListDlpHostsAsync(
        string? category,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/dlp/hosts";
        if (!string.IsNullOrWhiteSpace(category))
        {
            relative += "?category=" + Uri.EscapeDataString(category.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpHostsResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/dlp/summary — счётчики дня для шапки страницы.</summary>
    public async Task<HubDlpSummaryResponse> GetDlpSummaryAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "inventory/dlp/summary", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpSummaryResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/dlp/attention?day= — сводка за день (YYYY-MM-DD).</summary>
    public async Task<HubDlpAttentionResponse> GetDlpAttentionAsync(
        string? day,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/dlp/attention";
        if (!string.IsNullOrWhiteSpace(day))
        {
            relative += "?day=" + Uri.EscapeDataString(day.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpAttentionResponse>(response, cancellationToken);
    }

    /// <summary>
    /// GET /inventory/dlp/activity?computer_name=&day= — 5-минутные бакеты дня хоста.
    /// </summary>
    public async Task<HubDlpActivityResponse> GetDlpActivityAsync(
        string computerName,
        string? day,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(computerName);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/dlp/activity?computer_name="
            + Uri.EscapeDataString(computerName.Trim());
        if (!string.IsNullOrWhiteSpace(day))
        {
            relative += "&day=" + Uri.EscapeDataString(day.Trim());
        }

        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpActivityResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/dlp/work-schedules — графики филиалов + список филиалов.</summary>
    public async Task<HubDlpWorkSchedulesResponse> ListDlpWorkSchedulesAsync(
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, "inventory/dlp/work-schedules", token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpWorkSchedulesResponse>(response, cancellationToken);
    }

    /// <summary>PUT /inventory/dlp/work-schedules/{branch} — создать/обновить график.</summary>
    public async Task<HubDlpWorkScheduleSaveResponse> SaveDlpWorkScheduleAsync(
        string branchName,
        int workStartMin,
        int workEndMin,
        int? lunchStartMin,
        int? lunchEndMin,
        int tzOffsetMinutes,
        int workdaysMask,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(branchName);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/dlp/work-schedules/" + Uri.EscapeDataString(branchName.Trim());
        using var response = await SendAuthenticatedAsync(
            token =>
            {
                var request = CreateRequest(HttpMethod.Put, relative, token, deviceId);
                request.Content = CreateJsonContent(new
                {
                    work_start_min = workStartMin,
                    work_end_min = workEndMin,
                    lunch_start_min = lunchStartMin,
                    lunch_end_min = lunchEndMin,
                    tz_offset_minutes = tzOffsetMinutes,
                    workdays_mask = workdaysMask,
                });
                return request;
            },
            cancellationToken);
        return await ReadJsonAsync<HubDlpWorkScheduleSaveResponse>(response, cancellationToken);
    }

    /// <summary>DELETE /inventory/dlp/work-schedules/{branch} — сброс графика филиала.</summary>
    public async Task DeleteDlpWorkScheduleAsync(
        string branchName,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(branchName);
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = "inventory/dlp/work-schedules/" + Uri.EscapeDataString(branchName.Trim());
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Delete, relative, token, deviceId),
            cancellationToken);
        await EnsureSuccessAsync(response, cancellationToken);
    }

    /// <summary>
    /// GET /inventory/fs-egress?computer_name=&channel=&group=1 — события файлового канала.
    /// </summary>
    public async Task<HubFsEgressResponse> ListFsEgressEventsAsync(
        string? computerName,
        string? channel,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + limit.ToString(CultureInfo.InvariantCulture),
            "group=1",
        };
        if (!string.IsNullOrWhiteSpace(computerName))
        {
            parts.Add("computer_name=" + Uri.EscapeDataString(computerName.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(channel))
        {
            parts.Add("channel=" + Uri.EscapeDataString(channel.Trim()));
        }

        var relative = "inventory/fs-egress?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubFsEgressResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/telegram-probe?computer_name=&limit= — диалоги Telegram.</summary>
    public async Task<HubDlpChatsResponse> ListTelegramChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = ProbeChatsRelative("inventory/telegram-probe", computerName, limit);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpChatsResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/max-probe?computer_name=&limit= — диалоги MAX.</summary>
    public async Task<HubDlpChatsResponse> ListMaxChatsAsync(
        string? computerName,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var relative = ProbeChatsRelative("inventory/max-probe", computerName, limit);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubDlpChatsResponse>(response, cancellationToken);
    }

    /// <summary>GET /inventory/browser-probe?computer_name=&day=&merge=1 — визиты браузера.</summary>
    public async Task<HubBrowserVisitsResponse> ListBrowserVisitsAsync(
        string? computerName,
        string? day,
        int limit,
        CancellationToken cancellationToken)
    {
        var deviceId = await GetDeviceIdAsync(cancellationToken);
        var parts = new List<string>
        {
            "limit=" + limit.ToString(CultureInfo.InvariantCulture),
            "merge=1",
        };
        if (!string.IsNullOrWhiteSpace(computerName))
        {
            parts.Add("computer_name=" + Uri.EscapeDataString(computerName.Trim()));
        }

        if (!string.IsNullOrWhiteSpace(day))
        {
            parts.Add("day=" + Uri.EscapeDataString(day.Trim()));
        }

        var relative = "inventory/browser-probe?" + string.Join("&", parts);
        using var response = await SendAuthenticatedAsync(
            token => CreateRequest(HttpMethod.Get, relative, token, deviceId),
            cancellationToken);
        return await ReadJsonAsync<HubBrowserVisitsResponse>(response, cancellationToken);
    }

    /// <summary>Query-строка telegram/max probe — одинаковая у обоих каналов.</summary>
    private static string ProbeChatsRelative(string path, string? computerName, int limit)
    {
        var parts = new List<string>
        {
            "limit=" + limit.ToString(CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(computerName))
        {
            parts.Add("computer_name=" + Uri.EscapeDataString(computerName.Trim()));
        }

        return path + "?" + string.Join("&", parts);
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
