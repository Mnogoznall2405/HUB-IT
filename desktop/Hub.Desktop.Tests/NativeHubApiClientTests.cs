using System.Net;
using System.Net.Http;
using System.Text;
using Hub.Desktop.Native.Api;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeHubApiClientTests
{
    [Fact]
    public async Task LoginSavesSessionAndSendsContractHeaders()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path == "/api/v1/auth/login"
                ? Json(LoginPayload(access, "refresh-1"))
                : new HttpResponseMessage(HttpStatusCode.NotFound)));
        using var client = CreateClient(store, handler);

        var result = await client.LoginAsync("tester", "secret", CancellationToken.None);

        Assert.Equal(HubLoginStatus.Authenticated, result.Status);
        Assert.NotNull(result.Session);
        var session = result.Session!;
        Assert.Equal("refresh-1", session.RefreshToken);
        Assert.Equal(access, session.AccessToken);
        Assert.Equal("desktop-test-device", session.ClientDeviceId);
        Assert.Equal(7, session.UserId);
        Assert.Equal("tester", session.UserName);
        Assert.Equal("Test User", session.FullName);
        Assert.Equal(
            DateTimeOffset.UtcNow.AddMinutes(30).ToUnixTimeSeconds(),
            session.AccessTokenExpiresAtUtc.ToUnixTimeSeconds());
        Assert.Equal(session, store.Session);
        Assert.Equal(session, client.CurrentSession);
        Assert.Equal(1, store.SaveCount);

        var login = Assert.Single(handler.Requests);
        Assert.Equal("POST", login.Method);
        Assert.Equal("mobile", login.AuthClient);
        Assert.Equal("desktop-test-device", login.DeviceId);
        Assert.Contains("\"username\":\"tester\"", login.Body ?? string.Empty);
        Assert.Contains("\"password\":\"secret\"", login.Body ?? string.Empty);
    }

    [Fact]
    public async Task LoginTwoFactorRequiredReturnsChallengeWithoutSession()
    {
        var store = new FakeSessionStore();
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path == "/api/v1/auth/login"
                ? Json("""{"status":"2fa_required","login_challenge_id":"ch-42","available_second_factors":["totp","backup_code"]}""")
                : new HttpResponseMessage(HttpStatusCode.NotFound)));
        using var client = CreateClient(store, handler);

        var result = await client.LoginAsync("tester", "secret", CancellationToken.None);

        Assert.Equal(HubLoginStatus.TwoFactorRequired, result.Status);
        Assert.Equal("ch-42", result.LoginChallengeId);
        Assert.Equal(["totp", "backup_code"], result.AvailableSecondFactors);
        Assert.Null(result.Session);
        Assert.Null(client.CurrentSession);
        Assert.Equal(0, store.SaveCount);
    }

    [Fact]
    public async Task VerifyTwoFactorLoginSendsChallengeCode()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path == "/api/v1/auth/verify-2fa-login"
                ? Json(LoginPayload(access, "refresh-2fa"))
                : new HttpResponseMessage(HttpStatusCode.NotFound)));
        using var client = CreateClient(store, handler);

        var result = await client.VerifyTwoFactorLoginAsync(
            "ch-42", "123456", null, CancellationToken.None);

        Assert.Equal(HubLoginStatus.Authenticated, result.Status);
        var request = Assert.Single(handler.Requests);
        Assert.Equal("/api/v1/auth/verify-2fa-login", request.Path);
        Assert.Contains("\"login_challenge_id\":\"ch-42\"", request.Body ?? string.Empty);
        Assert.Contains("\"totp_code\":\"123456\"", request.Body ?? string.Empty);
        Assert.DoesNotContain("backup_code", request.Body ?? string.Empty);
    }

    [Fact]
    public async Task ExpiredAccessTokenRefreshesOnceUnderConcurrency()
    {
        var store = new FakeSessionStore();
        var expiredAccess = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(-5));
        var freshAccess = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var refreshCalls = 0;
        var handler = new StubHttpMessageHandler(async (request, cancellationToken) =>
        {
            switch (request.Path)
            {
                case "/api/v1/auth/login":
                    return Json(LoginPayload(expiredAccess, "refresh-old"));
                case "/api/v1/auth/refresh":
                    Interlocked.Increment(ref refreshCalls);
                    await Task.Delay(50, cancellationToken);
                    return Json(RefreshPayload(freshAccess, "refresh-new"));
                case "/api/v1/hub/tasks":
                    return Json("""{"items":[],"total":0,"limit":100,"offset":0,"truncated":false}""");
                default:
                    return new HttpResponseMessage(HttpStatusCode.NotFound);
            }
        });
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(_ => client.GetMyTasksAsync(new HubTaskQuery(), CancellationToken.None)));

        Assert.Equal(1, refreshCalls);
        Assert.Equal("refresh-new", client.CurrentSession?.RefreshToken);
        Assert.Equal("refresh-new", store.Session?.RefreshToken);
        Assert.Equal(8, handler.Count("GET", "/api/v1/hub/tasks"));
    }

    [Fact]
    public async Task UnauthorizedRequestRefreshesAndRetriesOnce()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var freshAccess = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var refreshCalls = 0;
        var tasksCalls = 0;
        var handler = new StubHttpMessageHandler((request, _) =>
        {
            switch (request.Path)
            {
                case "/api/v1/auth/login":
                    return Task.FromResult(Json(LoginPayload(access, "refresh-old")));
                case "/api/v1/auth/refresh":
                    Interlocked.Increment(ref refreshCalls);
                    return Task.FromResult(Json(RefreshPayload(freshAccess, "refresh-new")));
                case "/api/v1/hub/tasks":
                    return Task.FromResult(Interlocked.Increment(ref tasksCalls) == 1
                        ? Json("""{"detail":"Token expired"}""", HttpStatusCode.Unauthorized)
                        : Json("""{"items":[{"id":5,"title":"Fix pump","status":"in_progress"}],"total":1,"limit":100,"offset":0}"""));
                default:
                    return Task.FromResult(new HttpResponseMessage(HttpStatusCode.NotFound));
            }
        });
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetMyTasksAsync(new HubTaskQuery(), CancellationToken.None);

        Assert.Equal(1, refreshCalls);
        Assert.Equal(2, handler.Count("GET", "/api/v1/hub/tasks"));
        var item = Assert.Single(page.Items ?? []);
        Assert.Equal(5, item.Id);
        Assert.Equal("Fix pump", item.Title);
        var retried = handler.Requests
            .Where(request => request.Method == "GET" && request.Path == "/api/v1/hub/tasks")
            .Last();
        Assert.Equal($"Bearer {freshAccess}", retried.Authorization);
        Assert.Equal("refresh-new", store.Session?.RefreshToken);
    }

    [Fact]
    public async Task DefinitiveUnauthorizedWipesSessionAndRaisesEvent()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var refreshCalls = 0;
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/auth/refresh" => TrackRefresh(),
                "/api/v1/hub/tasks" => Json("""{"detail":"expired"}""", HttpStatusCode.Unauthorized),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        var ended = 0;
        client.SessionEnded += (_, _) => Interlocked.Increment(ref ended);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var exception = await Assert.ThrowsAsync<HubApiException>(
            () => client.GetMyTasksAsync(new HubTaskQuery(), CancellationToken.None));

        Assert.Equal(HubApiErrorKind.SessionExpired, exception.Kind);
        Assert.Equal(1, refreshCalls);
        Assert.Null(store.Session);
        Assert.Null(client.CurrentSession);
        Assert.Equal(1, store.ClearCount);
        Assert.Equal(1, ended);

        HttpResponseMessage TrackRefresh()
        {
            Interlocked.Increment(ref refreshCalls);
            return Json("""{"detail":"Refresh token is invalid"}""", HttpStatusCode.Unauthorized);
        }
    }

    [Fact]
    public async Task UserInactiveHeaderWipesSessionWithoutRefresh()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var refreshCalls = 0;
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/auth/refresh" => TrackRefresh(),
                "/api/v1/hub/tasks" => UserInactive(),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        var ended = 0;
        client.SessionEnded += (_, _) => Interlocked.Increment(ref ended);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var exception = await Assert.ThrowsAsync<HubApiException>(
            () => client.GetMyTasksAsync(new HubTaskQuery(), CancellationToken.None));

        Assert.Equal(HubApiErrorKind.SessionExpired, exception.Kind);
        Assert.Equal("user_inactive", exception.AuthReason);
        Assert.Equal(0, refreshCalls);
        Assert.Null(store.Session);
        Assert.Equal(1, store.ClearCount);
        Assert.Equal(1, ended);

        HttpResponseMessage TrackRefresh()
        {
            Interlocked.Increment(ref refreshCalls);
            return Json(RefreshPayload(access, "refresh-new"));
        }

        static HttpResponseMessage UserInactive()
        {
            var response = Json("""{"detail":"Account is deactivated"}""", HttpStatusCode.Unauthorized);
            response.Headers.TryAddWithoutValidation("X-Hubit-Auth-Reason", "user_inactive");
            return response;
        }
    }

    [Fact]
    public async Task TransportErrorKeepsSession()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) =>
        {
            if (request.Path == "/api/v1/auth/login")
            {
                return Task.FromResult(Json(LoginPayload(access, "refresh-old")));
            }

            throw new HttpRequestException("network down");
        });
        using var client = CreateClient(store, handler);
        var ended = 0;
        client.SessionEnded += (_, _) => Interlocked.Increment(ref ended);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var exception = await Assert.ThrowsAsync<HubApiException>(
            () => client.GetMyTasksAsync(new HubTaskQuery(), CancellationToken.None));

        Assert.Equal(HubApiErrorKind.Transport, exception.Kind);
        Assert.Equal("refresh-old", store.Session?.RefreshToken);
        Assert.Equal(0, store.ClearCount);
        Assert.Equal(0, ended);
    }

    [Fact]
    public async Task TaskListMapsQueryAndParsesItems()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks" => Json(
                    """{"items":[{"id":5,"title":"Fix pump","description_preview":"d","status":"in_progress","priority":"high","due_at":"2026-01-02T10:00:00Z","is_overdue":true,"assignee_full_name":"Test User","subtasks_total":3,"subtasks_done":1,"attachments_count":2,"extra_field":"ignored"}],"total":1,"limit":25,"offset":50,"truncated":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetMyTasksAsync(
            new HubTaskQuery
            {
                Status = "in_progress",
                Search = "fix bug",
                DueState = "overdue",
                SortBy = "due_at",
                SortDir = "desc",
                Limit = 25,
                Offset = 50,
            },
            CancellationToken.None);

        Assert.Equal(1, page.Total);
        Assert.Equal(25, page.Limit);
        Assert.Equal(50, page.Offset);
        Assert.True(page.Truncated);
        var item = Assert.Single(page.Items ?? []);
        Assert.Equal(5, item.Id);
        Assert.Equal("Fix pump", item.Title);
        Assert.True(item.IsOverdue);
        Assert.Equal(3, item.SubtasksTotal);
        Assert.Equal(1, item.SubtasksDone);
        Assert.Equal(new DateTimeOffset(2026, 1, 2, 10, 0, 0, TimeSpan.Zero), item.DueAt);

        var query = handler.Requests
            .Single(request => request.Method == "GET" && request.Path == "/api/v1/hub/tasks")
            .Query;
        Assert.Contains("scope=my", query);
        Assert.Contains("role_scope=both", query);
        Assert.Contains("status=in_progress", query);
        Assert.Contains("q=fix%20bug", query);
        Assert.Contains("due_state=overdue", query);
        Assert.Contains("sort_by=due_at", query);
        Assert.Contains("sort_dir=desc", query);
        Assert.Contains("limit=25", query);
        Assert.Contains("offset=50", query);
    }

    [Theory]
    [InlineData(HubTaskTransition.Start, "start", null)]
    [InlineData(HubTaskTransition.Reopen, "reopen", "{}")]
    [InlineData(HubTaskTransition.Complete, "complete", "\"comment\":\"note\"")]
    [InlineData(HubTaskTransition.Approve, "review", "\"decision\":\"approve\"")]
    [InlineData(HubTaskTransition.Reject, "review", "\"decision\":\"reject\"")]
    [InlineData(HubTaskTransition.Submit, "submit", "name=comment")]
    public async Task TransitionPostsToExpectedEndpointAndReturnsFreshDetail(
        HubTaskTransition transition,
        string suffix,
        string? bodyMarker)
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5" when request.Method == "GET" =>
                    Json("""{"id":5,"title":"Fix pump","status":"done","capabilities":{"can_reopen":true},"status_log":[{"old_status":"in_progress","new_status":"done"}]}"""),
                _ when request.Path.StartsWith("/api/v1/hub/tasks/5/", StringComparison.Ordinal) =>
                    Json("""{"id":5,"status":"done"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var detail = await client.TransitionTaskAsync(5, transition, "note", CancellationToken.None);

        Assert.Equal(5, detail.Id);
        Assert.Equal("done", detail.Status);
        Assert.True(detail.Capabilities?.CanReopen);
        var post = handler.Requests.Single(request =>
            request.Method == "POST" && request.Path == $"/api/v1/hub/tasks/5/{suffix}");
        if (transition == HubTaskTransition.Submit)
        {
            Assert.StartsWith("multipart/form-data", post.ContentType ?? string.Empty);
            Assert.Contains(bodyMarker!, post.Body ?? string.Empty);
            Assert.Contains("note", post.Body ?? string.Empty);
        }
        else if (bodyMarker is not null)
        {
            Assert.Contains(bodyMarker, post.Body ?? string.Empty);
        }
        else
        {
            Assert.Null(post.Body);
        }

        Assert.Equal(1, handler.Count("GET", "/api/v1/hub/tasks/5"));
    }

    [Fact]
    public async Task RestoreSessionValidatesAccessAgainstMe()
    {
        var store = new FakeSessionStore
        {
            Session = new NativeSession(
                CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30)),
                "refresh-old",
                "desktop-test-device",
                DateTimeOffset.UtcNow.AddMinutes(30),
                7,
                "tester",
                "Test User"),
        };
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path == "/api/v1/auth/me"
                ? Json("""{"id":7,"username":"tester","full_name":"Test User","role":"operator"}""")
                : new HttpResponseMessage(HttpStatusCode.NotFound)));
        using var client = CreateClient(store, handler);

        var restored = await client.RestoreSessionAsync(CancellationToken.None);

        Assert.NotNull(restored);
        Assert.Equal("refresh-old", restored.RefreshToken);
        var me = Assert.Single(handler.Requests);
        Assert.Equal("/api/v1/auth/me", me.Path);
        Assert.StartsWith("Bearer ", me.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task NetworkBranchesHitsExpectedRouteAndParsesCounts()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/networks/branches" => Json(
                    """{"branches":[{"id":5,"city_code":"tmn","branch_code":"tmn-p19-21","name":"Первомайская 19/21","default_site_code":"P19","db_id":"ITINVENT","devices_count":4,"ports_count":96,"occupied_ports":40,"sockets_count":80,"maps_count":2,"map_points_count":15}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var list = await client.GetNetworkBranchesAsync("tmn", CancellationToken.None);

        var branch = Assert.Single(list.Branches ?? []);
        Assert.Equal(5, branch.Id);
        Assert.Equal("Первомайская 19/21", branch.Name);
        Assert.Equal("ITINVENT", branch.DbId);
        Assert.Equal(4, branch.DevicesCount);
        Assert.Equal(15, branch.MapPointsCount);
        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/networks/branches");
        Assert.Equal("?city=tmn", request.Query);
    }

    [Fact]
    public async Task NetworkMapDownloadsStreamBodyAndReturnDispositionName()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/networks/maps/31/file" => Binary("png-bytes"u8, "floor1.png"),
                "/api/v1/networks/maps/31/export-pdf" => Binary("pdf-bytes"u8, "floor1-points.pdf"),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var fileStream = new MemoryStream();
        var fileName = await client.DownloadNetworkMapFileAsync(
            31, "original", fileStream, CancellationToken.None);
        using var pdfStream = new MemoryStream();
        var pdfName = await client.DownloadNetworkMapPdfAsync(
            31, pdfStream, CancellationToken.None);

        Assert.Equal("floor1.png", fileName);
        Assert.Equal("png-bytes", Encoding.UTF8.GetString(fileStream.ToArray()));
        Assert.Equal("floor1-points.pdf", pdfName);
        Assert.Equal("pdf-bytes", Encoding.UTF8.GetString(pdfStream.ToArray()));
        var fileRequest = handler.Requests.Single(request =>
            request.Path == "/api/v1/networks/maps/31/file");
        Assert.Equal("?render=original", fileRequest.Query);

        static HttpResponseMessage Binary(ReadOnlySpan<byte> bytes, string name)
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(bytes.ToArray()),
            };
            response.Content.Headers.TryAddWithoutValidation(
                "Content-Disposition", $"attachment; filename=\"{name}\"");
            return response;
        }
    }

    [Fact]
    public async Task DownloadImageSendsBearerToApiPathsAndSameOrigin()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/address-book/photos/001" => Binary("jpeg-bytes"u8),
                "/api/v1/equipment/5/photos/3/content" => Binary("thumb-bytes"u8),
                "/api/v1/company-structure/nodes/root/photo" => Binary("leader-bytes"u8),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // Серверный формат photo_url — ведущий «/» от корня origin.
        var photo = await client.DownloadImageAsync(
            "/api/v1/address-book/photos/001", CancellationToken.None);
        // Относительный api-путь — резолвится от /api/v1 с query.
        var thumb = await client.DownloadImageAsync(
            "equipment/5/photos/3/content?thumb=true", CancellationToken.None);
        // Абсолютный URL того же origin — тоже допустим.
        var leader = await client.DownloadImageAsync(
            "https://hub.test/api/v1/company-structure/nodes/root/photo",
            CancellationToken.None);

        Assert.Equal("jpeg-bytes", Encoding.UTF8.GetString(photo));
        Assert.Equal("thumb-bytes", Encoding.UTF8.GetString(thumb));
        Assert.Equal("leader-bytes", Encoding.UTF8.GetString(leader));
        var requests = handler.Requests
            .Where(request => request.Path != "/api/v1/auth/login").ToArray();
        Assert.Equal(3, requests.Length);
        Assert.All(requests, request =>
            Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty));
        var thumbRequest = Assert.Single(requests, request =>
            request.Path == "/api/v1/equipment/5/photos/3/content");
        Assert.Equal("?thumb=true", thumbRequest.Query);

        // Bearer за пределы origin не уходит — чужой хост отклоняется без запроса.
        var requestsBefore = handler.Requests.Count;
        await Assert.ThrowsAsync<HubApiException>(() => client.DownloadImageAsync(
            "https://evil.test/api/v1/address-book/photos/001", CancellationToken.None));
        Assert.Equal(requestsBefore, handler.Requests.Count);

        static HttpResponseMessage Binary(ReadOnlySpan<byte> bytes)
            => new(HttpStatusCode.OK) { Content = new ByteArrayContent(bytes.ToArray()) };
    }

    [Fact]
    public async Task ComputersSearchSendsFullContractQuery()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/inventory/computers/search" => Json(
                    """{"items":[{"mac_address":"AA:BB:CC:00:00:01","hostname":"WS-01","status":"online","age_seconds":120,"user_full_name":"Петров Пётр","branch_name":"Сургут","ip_primary":"10.0.0.5","changes_count_30d":2}],"total":1,"limit":50,"offset":0,"has_more":false}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.SearchComputersAsync(
            new HubComputersQuery
            {
                Scope = "all",
                Search = "ws-01",
                SearchFields = "identity,user,profiles,outlook,network,location,database",
                Status = "online",
                OutlookStatus = "warning",
                Branch = "Сургут",
                ChangedOnly = true,
                HiddenOnly = true,
                HideVm172 = true,
                SortBy = "hostname",
                SortDir = "asc",
                Limit = 50,
                Offset = 50,
            },
            CancellationToken.None);

        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("AA:BB:CC:00:00:01", item.MacAddress);
        Assert.Equal("WS-01", item.Hostname);
        Assert.Equal("online", item.Status);
        Assert.Equal(120, item.AgeSeconds);
        Assert.Equal(2, item.ChangesCount30d);
        Assert.False(page.HasMore);
        Assert.Equal(1, page.Total);
        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/inventory/computers/search");
        var query = request.Query;
        Assert.Contains("scope=all", query);
        Assert.Contains("limit=50", query);
        Assert.Contains("offset=50", query);
        Assert.Contains("q=ws-01", query);
        Assert.Contains("search_fields=identity%2Cuser%2Cprofiles%2Coutlook%2Cnetwork%2Clocation%2Cdatabase", query);
        Assert.Contains("status=online", query);
        Assert.Contains("outlook_status=warning", query);
        Assert.Contains("branch=%D0%A1%D1%83%D1%80%D0%B3%D1%83%D1%82", query);
        Assert.Contains("changed_only=true", query);
        Assert.Contains("hidden_only=true", query);
        Assert.Contains("hide_vm_172=true", query);
        Assert.Contains("sort_by=hostname", query);
        Assert.Contains("sort_dir=asc", query);
        Assert.Contains("include_summary=false", query);
        Assert.Contains("mobile_safe=true", query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
        Assert.Equal("mobile", request.AuthClient);
    }

    [Fact]
    public async Task ComputersSearchOmitsEmptyOptionalParams()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/inventory/computers/search" => Json(
                    """{"items":[],"total":0,"limit":50,"offset":0,"has_more":false,"next_offset":null}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.SearchComputersAsync(new HubComputersQuery(), CancellationToken.None);

        Assert.Empty(page.Items ?? []);
        Assert.False(page.HasMore);
        Assert.Null(page.NextOffset);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/inventory/computers/search");
        var query = request.Query;
        Assert.Contains("scope=selected", query);
        Assert.DoesNotContain("q=", query);
        Assert.DoesNotContain("offset=", query);
        Assert.DoesNotContain("status=", query);
        Assert.DoesNotContain("branch=", query);
        Assert.DoesNotContain("changed_only", query);
        Assert.DoesNotContain("hidden_only", query);
        Assert.DoesNotContain("hide_vm_172", query);
        Assert.Contains("mobile_safe=true", query);
    }

    [Fact]
    public async Task ComputerDetailEncodesMacAndParsesBoundedCard()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/inventory/computers/AA%3ABB%3ACC%3A00%3A00%3A01" => Json(
                    """{"mac_address":"AA:BB:CC:00:00:01","hostname":"WS-01","status":"online","last_seen_at":1700000000,"user_full_name":"Петров Пётр","database_name":"ITINVENT","inventory_inv_no":"100234","inventory_model_name":"ThinkCentre M70","ip_primary":"10.0.0.5","ip_list":["10.0.0.5","10.0.0.6"],"cpu_model":"Intel i7-10700","ram_gb":16,"cpu_load_percent":25,"ram_used_percent":61,"system_serial":"SN-7788","uptime_seconds":190800,"last_reboot_at":1699000000,"outlook_status":"ok","outlook_total_size_bytes":1610612736,"outlook_archives_count":3,"has_hardware_changes":true,"changes_count_30d":4,"logical_disks":[{"name":"C:","mountpoint":"C:","total_gb":200,"free_gb":150,"health_status":"ok"}],"storage":[{"device":"SSD1","media_type":"ssd","size_gb":476,"health_status":"warning"}],"network":{"devices":[{"name":"Ethernet0","connection_status":"connected","link_speed":"1 Гбит/с","ipv4":["10.0.0.5"]}]}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var computer = await client.GetComputerDetailAsync(
            "AA:BB:CC:00:00:01", "all", CancellationToken.None);

        Assert.Equal("WS-01", computer.Hostname);
        Assert.Equal(1_700_000_000, computer.LastSeenAt);
        Assert.Equal("ITINVENT", computer.DatabaseName);
        Assert.Equal("100234", computer.InventoryInvNo);
        Assert.Equal(16, computer.RamGb);
        Assert.Equal(25, computer.CpuLoadPercent);
        Assert.Equal(190800, computer.UptimeSeconds);
        Assert.Equal(1_699_000_000, computer.LastRebootAt);
        Assert.Equal("ok", computer.OutlookStatus);
        Assert.Equal(1_610_612_736, computer.OutlookTotalSizeBytes);
        Assert.Equal(3, computer.OutlookArchivesCount);
        Assert.True(computer.HasHardwareChanges);
        Assert.Equal(4, computer.ChangesCount30d);
        var disk = Assert.Single(computer.LogicalDisks ?? []);
        Assert.Equal("C:", disk.Name);
        Assert.Equal(200, disk.TotalGb);
        var storage = Assert.Single(computer.Storage ?? []);
        Assert.Equal("SSD1", storage.Device);
        var device = Assert.Single(computer.Network?.Devices ?? []);
        Assert.Equal("Ethernet0", device.Name);
        Assert.Equal(["10.0.0.5"], device.Ipv4);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/inventory/computers/AA%3ABB%3ACC%3A00%3A00%3A01");
        Assert.Equal("?scope=all&mobile_safe=true", request.Query);
    }

    [Fact]
    public async Task ItObjectComputerDetailHitsNestedRouteWithEscapedSegments()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/it-objects/ITINVENT%3A5/computers/AA%3ABB%3ACC%3A00%3A00%3A01" => Json(
                    """{"mac_address":"AA:BB:CC:00:00:01","hostname":"WS-01","status":"online","ip_primary":"10.0.0.5","cpu_model":"Intel i7-10700","ram_gb":16,"last_seen_at":1700000000,"logical_disks":[{"name":"C:","total_gb":200,"free_gb":150,"health_status":"ok"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var computer = await client.GetItObjectComputerAsync(
            "ITINVENT:5", "AA:BB:CC:00:00:01", CancellationToken.None);

        Assert.Equal("AA:BB:CC:00:00:01", computer.MacAddress);
        Assert.Equal("WS-01", computer.Hostname);
        Assert.Equal("Intel i7-10700", computer.CpuModel);
        Assert.Equal(16, computer.RamGb);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/it-objects/ITINVENT%3A5/computers/AA%3ABB%3ACC%3A00%3A00%3A01");
        Assert.Equal("GET", request.Method);
        Assert.Equal(string.Empty, request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
        Assert.Equal("mobile", request.AuthClient);
    }

    [Fact]
    public async Task ItObjectNetmapVersionsHitsNestedRouteWithEscapedRef()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/it-objects/ITINVENT%3A5/netmap/versions" => Json(
                    """{"object_ref":"ITINVENT:5","items":[{"version":3,"file_name":"map-v3.drawio","saved_at":"2026-03-12T15:04:00+00:00","saved_by":"Иванов Иван","saved_by_user_id":7},{"version":2,"file_name":null,"saved_at":null,"saved_by":null,"saved_by_user_id":5}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetItObjectNetmapVersionsAsync("ITINVENT:5", CancellationToken.None);

        Assert.Equal("ITINVENT:5", page.ObjectRef);
        Assert.Equal(2, page.Items?.Count);
        Assert.Equal(3, page.Items![0].Version);
        Assert.Equal("map-v3.drawio", page.Items[0].FileName);
        Assert.Equal("2026-03-12T15:04:00+00:00", page.Items[0].SavedAt);
        Assert.Equal("Иванов Иван", page.Items[0].SavedBy);
        Assert.Equal(7, page.Items[0].SavedByUserId);
        Assert.Equal(2, page.Items[1].Version);
        Assert.Null(page.Items[1].FileName);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/it-objects/ITINVENT%3A5/netmap/versions");
        Assert.Equal("GET", request.Method);
        Assert.Equal(string.Empty, request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
        Assert.Equal("mobile", request.AuthClient);
    }

    [Fact]
    public async Task ItObjectPasswordsAuditHitsNestedRouteWithLimit()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/it-objects/ITINVENT%3A5/passwords/audit" => Json(
                    """{"object_ref":"ITINVENT:5","items":[{"id":3,"entry_id":"e-1","action":"reveal.show","actor_user_id":11,"actor_username":"sidorov","entry_group":"РЭГА","entry_login":"rega-admin","created_at":"2026-10-28T10:00:00+00:00"},{"id":1,"entry_id":null,"action":"create","actor_user_id":7,"actor_username":"ivanov","entry_group":"","entry_login":"root","created_at":null}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetItObjectPasswordsAuditAsync("ITINVENT:5", 50, CancellationToken.None);

        Assert.Equal("ITINVENT:5", page.ObjectRef);
        Assert.Equal(2, page.Items?.Count);
        var item = page.Items![0];
        Assert.Equal(3, item.Id);
        Assert.Equal("e-1", item.EntryId);
        Assert.Equal("reveal.show", item.Action);
        Assert.Equal(11, item.ActorUserId);
        Assert.Equal("sidorov", item.ActorUsername);
        Assert.Equal("РЭГА", item.EntryGroup);
        Assert.Equal("rega-admin", item.EntryLogin);
        Assert.Equal("2026-10-28T10:00:00+00:00", item.CreatedAt);
        Assert.Null(page.Items[1].EntryId);
        Assert.Null(page.Items[1].CreatedAt);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/it-objects/ITINVENT%3A5/passwords/audit");
        Assert.Equal("GET", request.Method);
        Assert.Equal("?limit=50", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
        Assert.Equal("mobile", request.AuthClient);
    }

    [Fact]
    public async Task ItObjectMonitoringLatencyHistoryHitsNestedRouteWithEscapedSegments()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/it-objects/ITINVENT%3A5/monitoring/targets/t-3/latency-history" => Json(
                    """{"points":[{"at":"2026-03-12T10:00:00+00:00","latency_ms":12.5,"latency_ms_min":10.0,"latency_ms_max":15.0,"quality_status":"online","source_resolution_seconds":10},{"at":"2026-03-12T10:00:10+00:00","latency_ms":null,"quality_status":"missing","source_resolution_seconds":10}],"resolution_seconds":10,"has_data":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var history = await client.GetItObjectMonitoringLatencyHistoryAsync(
            "ITINVENT:5", "t-3", 24, CancellationToken.None);

        Assert.Equal(10, history.ResolutionSeconds);
        Assert.Equal(2, history.Points?.Count);
        Assert.Equal("2026-03-12T10:00:00+00:00", history.Points![0].At);
        Assert.Equal(12.5, history.Points[0].LatencyMs);
        Assert.Equal(10.0, history.Points[0].LatencyMsMin);
        Assert.Equal(15.0, history.Points[0].LatencyMsMax);
        Assert.Equal("online", history.Points[0].QualityStatus);
        Assert.Equal(10, history.Points[0].SourceResolutionSeconds);
        Assert.Null(history.Points[1].LatencyMs);
        Assert.Equal("missing", history.Points[1].QualityStatus);
        var request = handler.Requests.Single(request =>
            request.Path == "/api/v1/it-objects/ITINVENT%3A5/monitoring/targets/t-3/latency-history");
        Assert.Equal("GET", request.Method);
        Assert.Equal("?hours=24", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
        Assert.Equal("mobile", request.AuthClient);
    }

    [Fact]
    public async Task TicketKanbanSendsFiltersAndParsesColumns()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/tickets/kanban" => Json(
                    """{"Не запущен":[{"id":21,"employee_name":"Иван Петров","object_name":"Логистика","departure_date":"2026-11-20","route":"Сургут","is_urgent":false,"assignee_name":"Пётр Исполнитель","status":"not_started"}],"Проблема":[{"id":22,"employee_name":null,"object_name":null,"departure_date":null,"route":null,"is_urgent":true,"assignee_name":null,"status":"at_cashier"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var board = await client.GetTicketKanbanAsync("7,9", "5", CancellationToken.None);

        Assert.Equal(2, board.Count);
        var card = Assert.Single(board["Не запущен"]);
        Assert.Equal(21, card.Id);
        Assert.Equal("Иван Петров", card.EmployeeName);
        Assert.Equal("Логистика", card.ObjectName);
        Assert.Equal("2026-11-20", card.DepartureDate);
        Assert.Equal("Сургут", card.Route);
        Assert.False(card.IsUrgent);
        Assert.Equal("Пётр Исполнитель", card.AssigneeName);
        Assert.Equal("not_started", card.Status);
        var problem = Assert.Single(board["Проблема"]);
        Assert.True(problem.IsUrgent);
        Assert.Null(problem.EmployeeName);

        var request = handler.Requests.Single(
            request => request.Method == "GET" && request.Path == "/api/v1/tickets/kanban");
        Assert.Contains("object_ids=7%2C9", request.Query);
        Assert.Contains("assignee_ids=5", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TicketKanbanOmitsEmptyFilters()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/tickets/kanban" => Json("""{}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var board = await client.GetTicketKanbanAsync(null, "  ", CancellationToken.None);

        Assert.Empty(board);
        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/tickets/kanban");
        Assert.DoesNotContain("object_ids", request.Query);
        Assert.DoesNotContain("assignee_ids", request.Query);
    }

    [Fact]
    public async Task TicketDashboardHitsExpectedRouteAndParsesShape()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/tickets/dashboard" => Json(
                    """{"metrics":{"total_active":12,"new":3,"in_progress":4,"purchased":5,"problematic":2,"departures_today":1,"departures_tomorrow":2,"departures_3_days":3,"refunds_exchanges":1,"ticket_sum":"150000.00","loss_sum":"5000.00"},"per_object":[{"object_id":7,"object_name":"Логистика","object_code":"LG","assignee_name":"Пётр","active":8,"new":2,"in_progress":4,"purchased":3,"problematic":1,"nearest_departure":"2026-11-20","ticket_sum":"90000.00","loss_sum":"0.00"}],"top_problems":[{"object_id":7,"object_name":"Логистика","problematic":1}],"top_assignees":[{"assignee_id":5,"assignee_name":"Пётр Исполнитель","active_count":4}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var dashboard = await client.GetTicketDashboardAsync(CancellationToken.None);

        Assert.NotNull(dashboard.Metrics);
        Assert.Equal(12, dashboard.Metrics!.TotalActive);
        Assert.Equal(3, dashboard.Metrics.Departures3Days);
        Assert.Equal(1, dashboard.Metrics.RefundsExchanges);
        Assert.Equal("150000.00", dashboard.Metrics.TicketSum);
        Assert.Equal("5000.00", dashboard.Metrics.LossSum);
        var row = Assert.Single(dashboard.PerObject ?? []);
        Assert.Equal(7, row.ObjectId);
        Assert.Equal("Логистика", row.ObjectName);
        Assert.Equal("LG", row.ObjectCode);
        Assert.Equal(8, row.Active);
        Assert.Equal(3, row.Purchased);
        Assert.Equal("2026-11-20", row.NearestDeparture);
        var problem = Assert.Single(dashboard.TopProblems ?? []);
        Assert.Equal(1, problem.Problematic);
        var assignee = Assert.Single(dashboard.TopAssignees ?? []);
        Assert.Equal(5, assignee.AssigneeId);
        Assert.Equal(4, assignee.ActiveCount);

        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/tickets/dashboard");
        Assert.Equal("GET", request.Method);
        Assert.Equal(string.Empty, request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TicketHistoryHitsPagedRouteAndParsesEntries()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/tickets/requests/11/history" => Json(
                    """{"items":[{"id":9,"request_id":11,"field_name":"status","old_value":"not_started","new_value":"at_cashier","changed_by_id":5,"source":"manual","comment":"Согласовано","created_at":"2026-11-11T15:30:00"},{"id":8,"request_id":11,"field_name":"route","old_value":"Сургут","new_value":null,"changed_by_id":null,"source":"import","comment":null,"created_at":"2026-11-10T09:00:00"}],"total":2,"page":2,"page_size":20,"total_pages":3}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetTicketHistoryAsync(11, 2, 20, CancellationToken.None);

        Assert.Equal(2, page.Total);
        Assert.Equal(2, page.Page);
        Assert.Equal(20, page.PageSize);
        Assert.Equal(3, page.TotalPages);
        var first = page.Items![0];
        Assert.Equal(9, first.Id);
        Assert.Equal(11, first.RequestId);
        Assert.Equal("status", first.FieldName);
        Assert.Equal("not_started", first.OldValue);
        Assert.Equal("at_cashier", first.NewValue);
        Assert.Equal(5, first.ChangedById);
        Assert.Equal("manual", first.Source);
        Assert.Equal("Согласовано", first.Comment);
        Assert.Equal("2026-11-11T15:30:00", first.CreatedAt);
        Assert.Null(page.Items[1].NewValue);
        Assert.Null(page.Items[1].ChangedById);
        Assert.Null(page.Items[1].Comment);

        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/tickets/requests/11/history");
        Assert.Equal("GET", request.Method);
        Assert.Equal("?page=2&page_size=20", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    private static HubApiClient CreateClient(INativeSessionStore store, HttpMessageHandler handler)
        => new(new Uri("https://hub.test/"), store, handler);

    private static HttpResponseMessage Json(
        string body,
        HttpStatusCode status = HttpStatusCode.OK)
        => new(status)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };

    private static string CreateAccessToken(DateTimeOffset expiresAtUtc)
    {
        static string Segment(string json)
            => Convert.ToBase64String(Encoding.UTF8.GetBytes(json))
                .TrimEnd('=')
                .Replace('+', '-')
                .Replace('/', '_');

        return string.Join(
            '.',
            Segment("""{"alg":"none","typ":"JWT"}"""),
            Segment($$"""{"exp":{{expiresAtUtc.ToUnixTimeSeconds()}}}"""),
            Segment("""{"sig":"test"}"""));
    }

    private static string LoginPayload(string accessToken, string refreshToken)
        => $$"""{"status":"authenticated","access_token":"{{accessToken}}","refresh_token":"{{refreshToken}}","token_type":"bearer","user":{"id":7,"username":"tester","full_name":"Test User","role":"operator"},"session_id":"s-1"}""";

    private static string RefreshPayload(string accessToken, string refreshToken)
        => $$"""{"access_token":"{{accessToken}}","refresh_token":"{{refreshToken}}","token_type":"bearer","session_id":"s-1"}""";

    private sealed record RecordedRequest(
        string Method,
        string Path,
        string Query,
        string? Authorization,
        string? AuthClient,
        string? DeviceId,
        string? RequestId,
        string? ContentType,
        string? Body);

    private sealed class FakeSessionStore : INativeSessionStore
    {
        public NativeSession? Session { get; set; }

        public int SaveCount { get; private set; }

        public int ClearCount { get; private set; }

        public string DeviceId { get; } = "desktop-test-device";

        public Task<NativeSession?> LoadAsync(CancellationToken cancellationToken)
            => Task.FromResult(Session);

        public Task SaveAsync(NativeSession session, CancellationToken cancellationToken)
        {
            Session = session;
            SaveCount++;
            return Task.CompletedTask;
        }

        public Task ClearAsync(CancellationToken cancellationToken)
        {
            Session = null;
            ClearCount++;
            return Task.CompletedTask;
        }

        public Task<string> GetOrCreateClientDeviceIdAsync(CancellationToken cancellationToken)
            => Task.FromResult(DeviceId);
    }

    private sealed class StubHttpMessageHandler(
        Func<RecordedRequest, CancellationToken, Task<HttpResponseMessage>> responder)
        : HttpMessageHandler
    {
        private readonly object _sync = new();
        private readonly List<RecordedRequest> _requests = [];

        public IReadOnlyList<RecordedRequest> Requests
        {
            get
            {
                lock (_sync)
                {
                    return _requests.ToArray();
                }
            }
        }

        public int Count(string method, string path)
        {
            lock (_sync)
            {
                return _requests.Count(request =>
                    request.Method == method && request.Path == path);
            }
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            var body = request.Content is null
                ? null
                : await request.Content.ReadAsStringAsync(cancellationToken);
            var recorded = new RecordedRequest(
                request.Method.Method,
                request.RequestUri?.AbsolutePath ?? string.Empty,
                request.RequestUri?.Query ?? string.Empty,
                request.Headers.Authorization?.ToString(),
                Header(request, "X-Auth-Client"),
                Header(request, "X-Client-Device-ID"),
                Header(request, "X-Client-Request-ID"),
                request.Content?.Headers.ContentType?.ToString(),
                body);
            lock (_sync)
            {
                _requests.Add(recorded);
            }

            return await responder(recorded, cancellationToken);
        }

        private static string? Header(HttpRequestMessage request, string name)
            => request.Headers.TryGetValues(name, out var values)
                ? string.Join(",", values)
                : null;
    }
}
