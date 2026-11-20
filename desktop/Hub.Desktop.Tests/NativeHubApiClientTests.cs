using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
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
    public async Task TaskCreatePostsJsonToTasksAndParsesItems()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks" when request.Method == "POST" => Json(
                    """{"items":[{"id":42,"title":"Новая задача","status":"new","priority":"high"}],"created":1}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.CreateTaskAsync(
            new HubTaskCreateRequest
            {
                Title = "Новая задача",
                Description = "Описание",
                AssigneeUserIds = [11L],
                ControllerUserId = 12,
                DueAt = "2026-12-01T23:59",
                Priority = "high",
                ProjectId = "p-1",
                ObjectId = "o-1",
                ProtocolDate = "2026-11-20",
            },
            CancellationToken.None);

        Assert.Equal(1, result.Created);
        var created = Assert.Single(result.Items ?? []);
        Assert.Equal(42, created.Id);
        Assert.Equal("new", created.Status);

        var post = handler.Requests.Single(
            request => request.Method == "POST" && request.Path == "/api/v1/hub/tasks");
        var body = post.Body ?? string.Empty;
        // snake_case-ключи — контракт роута; значения проверяем через разбор
        // (System.Text.Json экранирует кириллицу в \\uXXXX).
        Assert.Contains("\"assignee_user_ids\":[11]", body);
        Assert.Contains("\"controller_user_id\":12", body);
        Assert.Contains("\"due_at\":\"2026-12-01T23:59\"", body);
        Assert.Contains("\"priority\":\"high\"", body);
        Assert.Contains("\"project_id\":\"p-1\"", body);
        Assert.Contains("\"object_id\":\"o-1\"", body);
        Assert.Contains("\"protocol_date\":\"2026-11-20\"", body);
        var sent = JsonSerializer.Deserialize<HubTaskCreateRequest>(body);
        Assert.NotNull(sent);
        Assert.Equal("Новая задача", sent!.Title);
        Assert.Equal("Описание", sent.Description);
        Assert.Equal([11L], sent.AssigneeUserIds);
    }

    [Fact]
    public async Task TaskCreateOmitsNullOptionalFields()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks" when request.Method == "POST" => Json("""{"items":[],"created":1}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.CreateTaskAsync(
            new HubTaskCreateRequest { Title = "Задача", AssigneeUserIds = [11L], ProjectId = "p-1" },
            CancellationToken.None);

        var body = handler.Requests.Single(
            request => request.Method == "POST" && request.Path == "/api/v1/hub/tasks").Body ?? string.Empty;
        // null-поля не сериализуются: backend применяет свои дефолты.
        Assert.DoesNotContain("description", body);
        Assert.DoesNotContain("controller_user_id", body);
        Assert.DoesNotContain("due_at", body);
        Assert.DoesNotContain("priority", body);
        Assert.DoesNotContain("object_id", body);
        Assert.DoesNotContain("protocol_date", body);
        Assert.Contains("\"title\":", body);
        Assert.Contains("\"project_id\":\"p-1\"", body);
        var sent = JsonSerializer.Deserialize<HubTaskCreateRequest>(body);
        Assert.Equal("Задача", sent?.Title);
        Assert.Equal([11L], sent?.AssigneeUserIds);
    }

    [Fact]
    public async Task SubtaskCreatePostsJsonToNestedRouteAndParsesDetail()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/subtasks" => Json(
                    """{"id":9,"title":"Подзадача","status":"new","parent_task_id":5,"subtasks_total":0,"capabilities":{"can_create_subtask":false}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var detail = await client.CreateSubtaskAsync(
            5,
            new HubTaskSubtaskCreateRequest
            {
                Title = "Подзадача",
                Description = "Шаг один",
                AssigneeUserIds = [11L],
                DueAt = "2026-12-05T23:59",
                Priority = "low",
            },
            CancellationToken.None);

        Assert.Equal(9, detail.Id);
        Assert.Equal(5, detail.ParentTaskId);
        Assert.Equal("new", detail.Status);
        Assert.False(detail.Capabilities?.CanCreateSubtask);

        var post = handler.Requests.Single(
            request => request.Method == "POST" && request.Path == "/api/v1/hub/tasks/5/subtasks");
        var body = post.Body ?? string.Empty;
        Assert.Contains("\"assignee_user_ids\":[11]", body);
        Assert.Contains("\"due_at\":\"2026-12-05T23:59\"", body);
        Assert.Contains("\"priority\":\"low\"", body);
        // У подзадачи проект/объект/контролёр не передаются — наследуются у родителя.
        Assert.DoesNotContain("project_id", body);
        Assert.DoesNotContain("controller_user_id", body);
        var sent = JsonSerializer.Deserialize<HubTaskSubtaskCreateRequest>(body);
        Assert.NotNull(sent);
        Assert.Equal("Подзадача", sent!.Title);
        Assert.Equal("Шаг один", sent.Description);
        Assert.Equal([11L], sent.AssigneeUserIds);
    }

    [Fact]
    public async Task TaskDirectoriesHitExpectedRoutesAndParseItems()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/users/assignees" => Json(
                    """{"items":[{"id":11,"username":"ivanov","full_name":"Иванов И.И.","department":"ИТ","department_id":"d-1"}],"total":1,"limit":30}"""),
                "/api/v1/hub/users/controllers" => Json(
                    """{"items":[{"id":12,"username":"petrov","full_name":"Петров П.П.","role":"lead"}]}"""),
                "/api/v1/hub/task-projects" => Json(
                    """{"items":[{"id":"p-1","name":"Проект А","code":"PA","is_active":true}]}"""),
                "/api/v1/hub/task-objects" => Json(
                    """{"items":[{"id":"o-1","project_id":"p-1","name":"Насосная","code":"N1","is_active":true}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var assignees = await client.SearchTaskAssigneesAsync("ива", 30, CancellationToken.None);
        var controllers = await client.GetTaskControllersAsync(CancellationToken.None);
        var projects = await client.GetTaskProjectsAsync(CancellationToken.None);
        var objects = await client.GetTaskObjectsAsync("p-1", CancellationToken.None);

        var assignee = Assert.Single(assignees.Items ?? []);
        Assert.Equal(11, assignee.Id);
        Assert.Equal("Иванов И.И.", assignee.FullName);
        Assert.Equal("d-1", assignee.DepartmentId);
        Assert.Equal(12, Assert.Single(controllers.Items ?? []).Id);
        Assert.Equal("p-1", Assert.Single(projects.Items ?? []).Id);
        var obj = Assert.Single(objects.Items ?? []);
        Assert.Equal("o-1", obj.Id);
        Assert.Equal("p-1", obj.ProjectId);

        var assigneeQuery = handler.Requests
            .Single(request => request.Path == "/api/v1/hub/users/assignees").Query;
        Assert.Contains("limit=30", assigneeQuery);
        Assert.Contains("q=%D0%B8%D0%B2%D0%B0", assigneeQuery); // «ива» url-encoded
        var objectQuery = handler.Requests
            .Single(request => request.Path == "/api/v1/hub/task-objects").Query;
        Assert.Contains("project_id=p-1", objectQuery);
        Assert.Equal(1, handler.Count("GET", "/api/v1/hub/users/controllers"));
        Assert.Equal(1, handler.Count("GET", "/api/v1/hub/task-projects"));
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

    [Fact]
    public async Task TicketAttachmentUploadPostsMultipartAndDeleteHitsRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/tickets/requests/11/attachments" when request.Method == "POST" => Json(
                    """{"id":"att-9","request_id":11,"file_name":"bill.pdf","file_type":"other","file_size":13,"uploaded_by_id":7,"created_at":"2026-11-10T09:00:00"}""",
                    HttpStatusCode.Created),
                "/api/v1/tickets/requests/11/attachments/att-9" when request.Method == "DELETE" =>
                    new HttpResponseMessage(HttpStatusCode.NoContent),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // Контракт tickets.py: multipart-поля file + file_type → 201 с записью вложения.
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("fake pdf body"));
        var uploaded = await client.UploadTicketAttachmentAsync(
            11, "bill.pdf", content, "other", CancellationToken.None);

        Assert.Equal("att-9", uploaded.Id);
        Assert.Equal(11, uploaded.RequestId);
        Assert.Equal("bill.pdf", uploaded.FileName);
        Assert.Equal("other", uploaded.FileType);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/tickets/requests/11/attachments");
        Assert.StartsWith("multipart/form-data", post.ContentType ?? string.Empty);
        // Сериализация Content-Disposition может быть с кавычками или без —
        // нормализуем и проверяем сам контракт полей.
        var body = (post.Body ?? string.Empty).Replace("\"", string.Empty);
        Assert.Contains("name=file;", body);
        Assert.Contains("filename=bill.pdf", body);
        Assert.Contains("name=file_type", body);
        Assert.Contains("other", body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);

        // DELETE …/attachments/{attachment_id} → 204 без тела.
        await client.DeleteTicketAttachmentAsync(11, "att-9", CancellationToken.None);

        Assert.Equal(1, handler.Count("DELETE", "/api/v1/tickets/requests/11/attachments/att-9"));
    }

    [Fact]
    public async Task TransferPostsSnakeCasePayloadAndParsesJobResponse()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer" => Json(
                    """{"success_count":1,"failed_count":0,"transferred":[{"inv_no":"100234","new_employee_name":"Иванов Иван"}],"failed":[],"acts":[{"act_id":"act-7","old_employee":"Петров Пётр","new_employee":"Иванов Иван","equipment_count":1,"file_name":"act_100234.pdf","file_type":"pdf"}],"job_id":"job-9","operation_id":"op-42","job_status":"done","job_status_text":"Готово"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var branchNo = System.Text.Json.JsonDocument.Parse("5");
        using var locNo = System.Text.Json.JsonDocument.Parse("\"L-3\"");
        var response = await client.TransferEquipmentAsync(
            new HubEquipmentTransferRequest
            {
                OperationId = "op-42",
                InvNos = ["100234"],
                NewEmployee = "Иванов Иван",
                NewEmployeeNo = 77,
                NewEmployeeDept = "ИТ-отдел",
                BranchNo = branchNo.RootElement,
                LocNo = locNo.RootElement,
                Comment = "переезд",
            },
            CancellationToken.None);

        Assert.Equal(1, response.SuccessCount);
        Assert.Equal("job-9", response.JobId);
        Assert.Equal("done", response.JobStatus);
        Assert.Equal("op-42", response.OperationId);
        var act = Assert.Single(response.Acts ?? []);
        Assert.Equal("act-7", act.ActId);
        Assert.Equal("act_100234.pdf", act.FileName);
        var transferred = Assert.Single(response.Transferred ?? []);
        Assert.Equal("100234", transferred.InvNo);

        // Контракт тела — snake_case как у веб buildTransferMovePayload.
        var post = Assert.Single(handler.Requests, request =>
            request.Method == "POST" && request.Path == "/api/v1/equipment/transfer");
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var root = payload.RootElement;
        Assert.Equal("op-42", root.GetProperty("operation_id").GetString());
        Assert.Equal("100234", Assert.Single(root.GetProperty("inv_nos").EnumerateArray()).GetString());
        Assert.Equal("Иванов Иван", root.GetProperty("new_employee").GetString());
        Assert.Equal(77, root.GetProperty("new_employee_no").GetInt64());
        Assert.Equal("ИТ-отдел", root.GetProperty("new_employee_dept").GetString());
        // int|str из справочников уходит без потери типа.
        Assert.Equal(5, root.GetProperty("branch_no").GetInt32());
        Assert.Equal("L-3", root.GetProperty("loc_no").GetString());
        Assert.Equal("переезд", root.GetProperty("comment").GetString());
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task LocationTransferPostsLocationRouteAndSnakeCasePayload()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer/location" => Json(
                    """{"success_count":2,"failed_count":0,"job_id":"job-loc","operation_id":"op-loc","job_status":"done"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var branchNo = System.Text.Json.JsonDocument.Parse("5");
        using var locNo = System.Text.Json.JsonDocument.Parse("\"L-3\"");
        var response = await client.TransferEquipmentLocationAsync(
            new HubTransferLocationRequest
            {
                OperationId = "op-loc",
                InvNos = ["100234", "100235"],
                BranchNo = branchNo.RootElement,
                LocNo = locNo.RootElement,
                Comment = "переезд",
            },
            CancellationToken.None);

        Assert.Equal(2, response.SuccessCount);
        Assert.Equal("job-loc", response.JobId);
        Assert.Equal("done", response.JobStatus);

        // Контракт тела — buildTransferLocationPayload веба: без new_employee.
        var post = Assert.Single(handler.Requests, request =>
            request.Method == "POST" && request.Path == "/api/v1/equipment/transfer/location");
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var root = payload.RootElement;
        Assert.Equal("op-loc", root.GetProperty("operation_id").GetString());
        Assert.Equal(
            ["100234", "100235"],
            root.GetProperty("inv_nos").EnumerateArray().Select(item => item.GetString()!).ToArray());
        Assert.Equal(5, root.GetProperty("branch_no").GetInt32());
        Assert.Equal("L-3", root.GetProperty("loc_no").GetString());
        Assert.Equal("переезд", root.GetProperty("comment").GetString());
        Assert.False(root.TryGetProperty("new_employee", out _));
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TransferActJobAndDownloadHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer/act-jobs/job-9" => Json(
                    """{"success_count":1,"failed_count":0,"job_id":"job-9","job_status":"done"}"""),
                "/api/v1/equipment/transfer/act/act-7" => Binary(),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var job = await client.GetTransferActJobAsync("job-9", CancellationToken.None);
        using var destination = new MemoryStream();
        var fileName = await client.DownloadTransferActAsync("act-7", destination, CancellationToken.None);

        Assert.Equal("done", job.JobStatus);
        Assert.Equal("act_100234.pdf", fileName);
        Assert.Equal("pdf-bytes", Encoding.UTF8.GetString(destination.ToArray()));
        Assert.Equal(1, handler.Count("GET", "/api/v1/equipment/transfer/act-jobs/job-9"));
        Assert.Equal(1, handler.Count("GET", "/api/v1/equipment/transfer/act/act-7"));

        static HttpResponseMessage Binary()
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent("pdf-bytes"u8.ToArray()),
            };
            response.Content.Headers.TryAddWithoutValidation(
                "Content-Disposition", "attachment; filename=\"act_100234.pdf\"");
            return response;
        }
    }

    [Fact]
    public async Task ActOnlyTransferPostsIssuerSnakeCasePayload()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer/act-only" => Json(
                    """{"success_count":1,"failed_count":0,"job_id":"job-act","operation_id":"op-act","job_status":"done","acts":[{"act_id":"act-9","old_employee":"Иванов Иван","new_employee":"Петров Пётр","equipment_count":1,"file_name":"act.pdf","file_type":"pdf"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var response = await client.TransferActOnlyAsync(
            new HubTransferActOnlyRequest
            {
                OperationId = "op-act",
                InvNos = ["100234"],
                IssuerEmployee = "Иванов Иван",
                IssuerOwnerNo = 77,
                Comment = "комплект",
            },
            CancellationToken.None);

        Assert.Equal(1, response.SuccessCount);
        Assert.Equal("job-act", response.JobId);
        Assert.Equal("done", response.JobStatus);
        var act = Assert.Single(response.Acts ?? []);
        Assert.Equal("act-9", act.ActId);

        // Контракт тела — buildTransferActOnlyPayload веба + operation_id/comment.
        var post = Assert.Single(handler.Requests, request =>
            request.Method == "POST" && request.Path == "/api/v1/equipment/transfer/act-only");
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var root = payload.RootElement;
        Assert.Equal("op-act", root.GetProperty("operation_id").GetString());
        Assert.Equal("100234", Assert.Single(root.GetProperty("inv_nos").EnumerateArray()).GetString());
        Assert.Equal("Иванов Иван", root.GetProperty("issuer_employee").GetString());
        Assert.Equal(77, root.GetProperty("issuer_owner_no").GetInt64());
        Assert.Equal("комплект", root.GetProperty("comment").GetString());
        // Без перемещения: полей владельца/филиала/локации в теле нет.
        Assert.False(root.TryGetProperty("new_employee", out _));
        Assert.False(root.TryGetProperty("branch_no", out _));
        Assert.False(root.TryGetProperty("loc_no", out _));
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task UploadedActParsePostsMultipartPdfAndManualMode()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/acts/upload/parse" => Json(
                    """{"draft_id":"draft-7","file_name":"act.pdf","from_employee":"Иванов И.И.","to_employee":"Петров П.П.","doc_date":"2025-01-15","equipment_inv_nos":["100234"],"resolved_items":[{"item_id":42,"inv_no":"100234","serial_no":"SN-1","model_name":"ThinkPad T14","employee_name":"Иванов И.И.","branch_name":"Центральный","location_name":"Офис 101"}],"warnings":["низкая уверенность"]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var draft = await client.ParseUploadedActAsync(
            "act.pdf", "%PDF-1.4"u8.ToArray(), manualMode: true, CancellationToken.None);

        Assert.Equal("draft-7", draft.DraftId);
        Assert.Equal("Иванов И.И.", draft.FromEmployee);
        Assert.Equal("Петров П.П.", draft.ToEmployee);
        Assert.Equal("2025-01-15", draft.DocDate);
        Assert.Equal(["100234"], draft.EquipmentInvNos);
        var item = Assert.Single(draft.ResolvedItems ?? []);
        Assert.Equal(42, item.ItemId);
        Assert.Equal("100234", item.InvNo);
        Assert.Equal("ThinkPad T14", item.ModelName);
        Assert.Equal(["низкая уверенность"], draft.Warnings);

        // Контракт: multipart-поле «file» + ?manual_mode=true в query.
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/parse");
        Assert.Contains("multipart/form-data", post.ContentType);
        Assert.Contains("manual_mode=true", post.Query);
        var body = post.Body ?? string.Empty;
        Assert.Contains("name=file", body);
        Assert.Contains("act.pdf", body);
        Assert.Contains("application/pdf", body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task UploadedActCommitPostsDraftFieldsAndParsesResult()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/acts/upload/commit" => Json(
                    """{"success":true,"doc_no":501,"doc_number":"А-501","file_no":7001,"linked_item_ids":[42],"linked_inv_nos":["100234"],"message":"Акт загружен","reminder_status":"completed","reminder_pending_groups":0}"""),
                "/api/v1/equipment/acts/501/file" => Binary(),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.CommitUploadedActAsync(
            new HubUploadedActCommitRequest
            {
                DraftId = "draft-7",
                FromEmployee = "Иванов И.И.",
                ToEmployee = "Петров П.П.",
                DocDate = "2025-01-15",
                EquipmentInvNos = ["100234"],
            },
            CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal(501, result.DocNo);
        Assert.Equal("А-501", result.DocNumber);
        Assert.Equal(7001, result.FileNo);
        Assert.Equal(["100234"], result.LinkedInvNos);
        Assert.Equal("completed", result.ReminderStatus);

        // Тело — buildUploadActCommitPayload веба (snake_case).
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/commit");
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var root = payload.RootElement;
        Assert.Equal("draft-7", root.GetProperty("draft_id").GetString());
        Assert.Equal("Иванов И.И.", root.GetProperty("from_employee").GetString());
        Assert.Equal("Петров П.П.", root.GetProperty("to_employee").GetString());
        Assert.Equal("2025-01-15", root.GetProperty("doc_date").GetString());
        Assert.Equal("100234", Assert.Single(root.GetProperty("equipment_inv_nos").EnumerateArray()).GetString());

        // Файл записанного акта — GET /equipment/acts/{doc_no}/file.
        using var destination = new MemoryStream();
        var fileName = await client.DownloadEquipmentActFileAsync(501, destination, CancellationToken.None);
        Assert.Equal("uploaded-act.pdf", fileName);
        Assert.Equal("pdf-bytes", Encoding.UTF8.GetString(destination.ToArray()));
        Assert.Equal(1, handler.Count("GET", "/api/v1/equipment/acts/501/file"));

        static HttpResponseMessage Binary()
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent("pdf-bytes"u8.ToArray()),
            };
            response.Content.Headers.TryAddWithoutValidation(
                "Content-Disposition", "attachment; filename=\"uploaded-act.pdf\"");
            return response;
        }
    }

    [Fact]
    public async Task TransferParsesUploadReminderFields()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer" => Json(
                    """{"success_count":1,"failed_count":0,"job_status":"done","upload_reminder_created":true,"upload_reminder_task_id":"901","upload_reminder_id":"rem-1","upload_reminder_warning":"не нашёл контролёра","upload_reminder_controller_username":"boss","upload_reminder_controller_fallback_used":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // upload_reminder_* — контракт сервиса напоминаний: баннер и binding-загрузка.
        var response = await client.TransferEquipmentAsync(
            new HubEquipmentTransferRequest { OperationId = "op-1", InvNos = ["100234"] },
            CancellationToken.None);

        Assert.True(response.UploadReminderCreated);
        Assert.Equal("901", response.UploadReminderTaskId);
        Assert.Equal("rem-1", response.UploadReminderId);
        Assert.Equal("не нашёл контролёра", response.UploadReminderWarning);
        Assert.Equal("boss", response.UploadReminderControllerUsername);
        Assert.True(response.UploadReminderControllerFallbackUsed);
    }

    [Fact]
    public async Task GetTransferReminderHitsRouteAndParsesGroups()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/transfer/reminders/rem-9" => Json(
                    """{"reminder_id":"rem-9","task_id":"901","db_id":"it-invent","assignee_user_id":7,"controller_user_id":9,"created_by_user_id":7,"new_employee_no":"77","new_employee_name":"Иванов И.И.","status":"pending","created_at":"2025-01-10T10:00:00","pending_groups_total":2,"completed_groups_total":1,"pending_groups":[{"id":"g-1","generated_act_id":"act-7","old_employee_name":"Петров П.П.","inv_nos":["100234","100235"],"equipment_count":2},{"id":"g-2","generated_act_id":"act-8","old_employee_name":"Сидоров С.С.","inv_nos":["100240"],"equipment_count":1}],"completed_groups":[{"id":"g-0","generated_act_id":"act-1","old_employee_name":"Петров П.П.","inv_nos":["100230"],"equipment_count":1,"matched_doc_no":500,"matched_doc_number":"А-500","completed_at":"2025-01-11T12:00:00"}],"upload_url":"/database?upload_act=1&reminder_id=rem-9&source_task_id=901"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var reminder = await client.GetTransferReminderAsync("rem-9", CancellationToken.None);

        Assert.Equal("rem-9", reminder.ReminderId);
        Assert.Equal("901", reminder.TaskId);
        Assert.Equal("it-invent", reminder.DbId);
        Assert.Equal("Иванов И.И.", reminder.NewEmployeeName);
        Assert.Equal("pending", reminder.Status);
        Assert.Equal(2, reminder.PendingGroupsTotal);
        Assert.Equal(1, reminder.CompletedGroupsTotal);
        Assert.Equal("/database?upload_act=1&reminder_id=rem-9&source_task_id=901", reminder.UploadUrl);
        var pending = Assert.Single(reminder.PendingGroups ?? [], group => group.Id == "g-2");
        Assert.Equal("Сидоров С.С.", pending.OldEmployeeName);
        Assert.Equal(["100240"], pending.InvNos);
        var completed = Assert.Single(reminder.CompletedGroups ?? []);
        Assert.Equal(500, completed.MatchedDocNo);
        Assert.Equal("А-500", completed.MatchedDocNumber);

        var get = Assert.Single(handler.Requests, request =>
            request.Path == "/api/v1/equipment/transfer/reminders/rem-9");
        Assert.Equal("GET", get.Method);
        Assert.StartsWith("Bearer ", get.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task UploadedActCommitPostsReminderBindingOnlyWhenSet()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/acts/upload/commit" => Json("""{"success":true,"doc_no":502,"file_no":7002}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // Binding-режим: reminder_id + source_task_id уходят в теле (веб-пейлоад).
        await client.CommitUploadedActAsync(
            new HubUploadedActCommitRequest
            {
                DraftId = "draft-9",
                EquipmentInvNos = ["100234"],
                ReminderId = "rem-9",
                SourceTaskId = "901",
            },
            CancellationToken.None);

        var boundPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/commit");
        using (var boundPayload = System.Text.Json.JsonDocument.Parse(boundPost.Body ?? "{}"))
        {
            var bound = boundPayload.RootElement;
            Assert.Equal("rem-9", bound.GetProperty("reminder_id").GetString());
            Assert.Equal("901", bound.GetProperty("source_task_id").GetString());
        }

        // Обычная загрузка без привязки: ключей в теле нет — сервер не ищет напоминание.
        await client.CommitUploadedActAsync(
            new HubUploadedActCommitRequest { DraftId = "draft-9", EquipmentInvNos = ["100235"] },
            CancellationToken.None);

        var plainPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/commit"
                && request != boundPost);
        using (var plainPayload = System.Text.Json.JsonDocument.Parse(plainPost.Body ?? "{}"))
        {
            var plain = plainPayload.RootElement;
            Assert.False(plain.TryGetProperty("reminder_id", out _));
            Assert.False(plain.TryGetProperty("source_task_id", out _));
        }
    }

    [Fact]
    public async Task UploadedActEmailPostsAutoAndSelectedPayloads()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/acts/upload/email" => Json(
                    """{"doc_no":501,"subject":"Акт №501","success_count":1,"failed_count":1,"recipients":[{"owner_no":77,"employee_name":"Иванов И.И.","email":"ivanov@hub.test","status":"sent"},{"owner_no":78,"employee_name":"Петров П.П.","status":"failed","detail":"нет email"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // mode=auto: сервер резолвит получателей по ФИО from/to акта.
        var auto = await client.SendUploadedActEmailAsync(
            new HubUploadedActEmailRequest
            {
                DocNo = 501,
                Mode = "auto",
                FromEmployee = "Петров П.П.",
                ToEmployee = "Иванов И.И.",
                Subject = "Акт №501",
                Body = "Во вложении акт.",
            },
            CancellationToken.None);

        Assert.Equal(501, auto.DocNo);
        Assert.Equal("Акт №501", auto.Subject);
        Assert.Equal(1, auto.SuccessCount);
        Assert.Equal(1, auto.FailedCount);
        var sent = Assert.Single(auto.Recipients ?? [], r => r.Status == "sent");
        Assert.Equal("ivanov@hub.test", sent.Email);
        var failed = Assert.Single(auto.Recipients ?? [], r => r.Status == "failed");
        Assert.Equal("нет email", failed.Detail);

        var autoPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/email");
        using (var autoPayload = System.Text.Json.JsonDocument.Parse(autoPost.Body ?? "{}"))
        {
            var autoRoot = autoPayload.RootElement;
            Assert.Equal(501, autoRoot.GetProperty("doc_no").GetInt64());
            Assert.Equal("auto", autoRoot.GetProperty("mode").GetString());
            Assert.Equal("Петров П.П.", autoRoot.GetProperty("from_employee").GetString());
            Assert.Equal("Иванов И.И.", autoRoot.GetProperty("to_employee").GetString());
            Assert.Equal("Акт №501", autoRoot.GetProperty("subject").GetString());
            Assert.False(autoRoot.TryGetProperty("owner_nos", out _));
        }

        // mode=selected: явный список owner_nos, from/to не шлём.
        await client.SendUploadedActEmailAsync(
            new HubUploadedActEmailRequest
            {
                DocNo = 501,
                Mode = "selected",
                OwnerNos = [77, 78],
                Subject = "Акт №501",
            },
            CancellationToken.None);

        var selectedPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/acts/upload/email"
                && request != autoPost);
        using var selectedPayload = System.Text.Json.JsonDocument.Parse(selectedPost.Body ?? "{}");
        var selected = selectedPayload.RootElement;
        Assert.Equal("selected", selected.GetProperty("mode").GetString());
        Assert.Equal(
            [77L, 78L],
            selected.GetProperty("owner_nos").EnumerateArray().Select(item => item.GetInt64()).ToArray());
        Assert.False(selected.TryGetProperty("from_employee", out _));
        Assert.False(selected.TryGetProperty("body", out _));
        Assert.StartsWith("Bearer ", selectedPost.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task EmployeeSearchAndCatalogsHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/search/employee" => Json(
                    """{"employees":[{"owner_no":77,"name":"Иванов Иван","department":"ИТ-отдел","equipment_count":3}],"total":1,"page":1,"pages":1}"""),
                "/api/v1/equipment/branches" => Json(
                    """[{"id":5,"name":"Сургут"},{"id":"B-1","name":"Филиал-1"}]"""),
                "/api/v1/equipment/locations/5" => Json(
                    """[{"loc_no":31,"loc_name":"офис 210","branch_no":5}]"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.SearchEquipmentEmployeesAsync("Ива нов", 20, CancellationToken.None);
        var branches = await client.GetEquipmentBranchesAsync(CancellationToken.None);
        var locations = await client.GetEquipmentLocationsAsync("5", CancellationToken.None);

        var employee = Assert.Single(page.Employees ?? []);
        Assert.Equal(77, employee.OwnerNo);
        Assert.Equal("Иванов Иван", employee.Name);
        Assert.Equal(2, branches.Count);
        // id/loc_no — int|str в модели бэкенда, сырой JSON сохраняет тип.
        Assert.Equal(5, branches[0].Id?.GetInt32());
        Assert.Equal("B-1", branches[1].Id?.GetString());
        Assert.Equal(31, locations[0].LocNo?.GetInt32());

        var search = handler.Requests.Single(request =>
            request.Path == "/api/v1/equipment/search/employee");
        Assert.Equal("?page=1&limit=20&q=%D0%98%D0%B2%D0%B0%20%D0%BD%D0%BE%D0%B2", search.Query);
        Assert.Equal(1, handler.Count("GET", "/api/v1/equipment/locations/5"));
    }

    [Fact]
    public async Task EmployeeItemsAndHistoryHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/employee/77/items" => Json(
                    """{"found":true,"equipment":[{"id":5,"inv_no":100234,"model_name":"ThinkPad T14","type_name":"Ноутбук","empl_no":77,"employee_name":"Иванов Иван"}],"db_errors":[]}"""),
                "/api/v1/equipment/employee/77/history" => Json(
                    """{"owner_no":77,"history":[{"hist_id":11,"direction":"incoming","old_employee_name":"Склад","new_employee_name":"Иванов Иван","inv_no":100234.0,"type_name":"Ноутбук","model_name":"ThinkPad T14","current_inv_no":100234.0}],"total":1,"page":1,"limit":20}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var items = await client.GetEmployeeItemsAsync(77, "Иванов Иван", CancellationToken.None);
        var history = await client.GetEmployeeHistoryAsync(
            77, "outgoing", "think", 2, 20, CancellationToken.None);

        Assert.True(items.Found);
        var equipment = Assert.Single(items.Equipment ?? []);
        Assert.Equal(77, equipment.EmplNo);
        var row = Assert.Single(history.History ?? []);
        Assert.Equal("incoming", row.Direction);
        Assert.Equal(100234.0, row.InvNo);
        Assert.Equal(1, history.Total);

        var itemsRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/equipment/employee/77/items");
        Assert.Equal(
            "?employee_name=%D0%98%D0%B2%D0%B0%D0%BD%D0%BE%D0%B2%20%D0%98%D0%B2%D0%B0%D0%BD",
            itemsRequest.Query);
        var historyRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/equipment/employee/77/history");
        Assert.Equal("?page=2&limit=20&direction=outgoing&q=think", historyRequest.Query);
    }

    [Fact]
    public async Task EquipmentEditorLookupsHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/statuses" => Json(
                    """[{"status_no":3,"status_name":"В работе"},{"status_no":4,"status_name":"На складе"}]"""),
                "/api/v1/equipment/models" => Json(
                    """{"models":[{"model_no":55,"model_name":"ThinkPad","type_no":101,"ci_type":1}]}"""),
                "/api/v1/equipment/owners/search" => Json(
                    """{"owners":[{"OWNER_NO":88,"OWNER_DISPLAY_NAME":"Иванов Иван","OWNER_DEPT":"ИТ"}]}"""),
                "/api/v1/equipment/locations" => Json(
                    """[{"loc_no":31,"loc_name":"офис 210","branch_no":5}]"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var statuses = await client.GetEquipmentStatusesAsync(CancellationToken.None);
        var models = await client.GetEquipmentModelsAsync(101, CancellationToken.None);
        var owners = await client.SearchEquipmentOwnersAsync("Ива", 20, CancellationToken.None);
        var locations = await client.GetEquipmentBranchLocationsAsync("5", CancellationToken.None);

        Assert.Equal(2, statuses.Count);
        Assert.Equal(3, statuses[0].StatusNo);
        var model = Assert.Single(models);
        Assert.Equal(55, model.ModelNo);
        Assert.Equal("ThinkPad", model.ModelName);
        // Владельцы отдаются сырыми ключами OWNER_* — разбор регистронезависим.
        var owner = Assert.Single(owners);
        Assert.Equal<long?>(88, owner.OwnerNo);
        Assert.Equal("Иванов Иван", owner.OwnerDisplayName);
        Assert.Equal("ИТ", owner.OwnerDept);
        Assert.Equal<int?>(31, locations[0].LocNo?.GetInt32());

        Assert.Equal("?type_no=101&ci_type=1",
            Assert.Single(handler.Requests,
                request => request.Path == "/api/v1/equipment/models").Query);
        var ownersRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/equipment/owners/search");
        Assert.Equal("?limit=20&q=%D0%98%D0%B2%D0%B0", ownersRequest.Query);
        // only_branch — только локации филиала, как getLocations в веб-форме.
        Assert.Equal("?only_branch=true&branch_no=5",
            Assert.Single(handler.Requests,
                request => request.Path == "/api/v1/equipment/locations").Query);
        Assert.Equal(1, handler.Count("GET", "/api/v1/equipment/statuses"));
    }

    [Fact]
    public async Task EquipmentUpdateSendsPatchAndDeserializesCard()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/100234" => Json(
                    """{"id":5,"inv_no":100234,"model_name":"ThinkPad","serial_no":"SN-9","status_no":4,"status":"На складе","branch_no":5,"branch_name":"Сургут","loc_no":31,"location":"офис","data_version":42}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var branchNo = System.Text.Json.JsonDocument.Parse("5");
        using var locNo = System.Text.Json.JsonDocument.Parse("\"L-3\"");
        var updated = await client.UpdateEquipmentAsync(
            "100234",
            new HubEquipmentUpdateRequest
            {
                SerialNo = "SN-9",
                HwSerialNo = "",   // очищенное текстовое поле уходит пустой строкой
                StatusNo = 4,
                BranchNo = branchNo.RootElement,
                LocNo = locNo.RootElement,
            },
            CancellationToken.None);

        Assert.Equal<double?>(100234, updated.InvNo);
        Assert.Equal("SN-9", updated.SerialNo);
        Assert.Equal("На складе", updated.Status);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/equipment/100234");
        using var body = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}");
        var root = body.RootElement;
        Assert.Equal("SN-9", root.GetProperty("serial_no").GetString());
        Assert.Equal("", root.GetProperty("hw_serial_no").GetString());
        Assert.Equal(4, root.GetProperty("status_no").GetInt32());
        // branch_no/loc_no — int|str без потери типа.
        Assert.Equal(5, root.GetProperty("branch_no").GetInt32());
        Assert.Equal("L-3", root.GetProperty("loc_no").GetString());
        // Не заданные поля опущены — сервер делает model_dump(exclude_unset).
        Assert.False(root.TryGetProperty("part_no", out _));
        Assert.False(root.TryGetProperty("ip_address", out _));
        Assert.False(root.TryGetProperty("mac_address", out _));
        Assert.False(root.TryGetProperty("type_no", out _));
        Assert.False(root.TryGetProperty("model_no", out _));
        Assert.False(root.TryGetProperty("empl_no", out _));
    }

    [Fact]
    public async Task EquipmentCreatePostsContractAndParsesResult()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/create" => Json(
                    """{"success":true,"item_id":9,"inv_no":"100777","created_owner":true,"created_model":false,"message":"ok"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var branchNo = System.Text.Json.JsonDocument.Parse("5");
        using var locNo = System.Text.Json.JsonDocument.Parse("\"L-3\"");
        var result = await client.CreateEquipmentAsync(
            new HubEquipmentCreateRequest
            {
                SerialNo = "SN-NEW",
                EmployeeName = "Иванов Иван",
                EmployeeNo = 88,
                EmployeeDept = "ИТ",
                BranchNo = branchNo.RootElement,
                LocNo = locNo.RootElement,
                TypeNo = 101,
                StatusNo = 3,
                ModelName = "ThinkPad X1",
                MacAddress = "aa-bb-cc-dd-ee-11",
            },
            CancellationToken.None);

        Assert.True(result.Success);
        Assert.Equal<long?>(9, result.ItemId);
        Assert.Equal("100777", result.InvNo);
        Assert.True(result.CreatedOwner);
        Assert.False(result.CreatedModel);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/create");
        using var body = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var root = body.RootElement;
        Assert.Equal("SN-NEW", root.GetProperty("serial_no").GetString());
        Assert.Equal("Иванов Иван", root.GetProperty("employee_name").GetString());
        Assert.Equal(88L, root.GetProperty("employee_no").GetInt64());
        Assert.Equal("ИТ", root.GetProperty("employee_dept").GetString());
        Assert.Equal(5, root.GetProperty("branch_no").GetInt32());
        Assert.Equal("L-3", root.GetProperty("loc_no").GetString());
        Assert.Equal(101, root.GetProperty("type_no").GetInt32());
        Assert.Equal(3, root.GetProperty("status_no").GetInt32());
        Assert.Equal("ThinkPad X1", root.GetProperty("model_name").GetString());
        Assert.Equal("aa-bb-cc-dd-ee-11", root.GetProperty("mac_address").GetString());
        Assert.False(root.TryGetProperty("model_no", out _));
        Assert.False(root.TryGetProperty("ip_address", out _));
        Assert.False(root.TryGetProperty("hw_serial_no", out _));
    }

    [Fact]
    public async Task EquipmentUpdatePropagatesServerErrorDetail()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/100234" => Json(
                    """{"detail":"model_no does not belong to type"}""",
                    HttpStatusCode.BadRequest),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var exception = await Assert.ThrowsAsync<HubApiException>(() =>
            client.UpdateEquipmentAsync(
                "100234", new HubEquipmentUpdateRequest { TypeNo = 102 }, CancellationToken.None));
        Assert.Equal(HubApiErrorKind.Http, exception.Kind);
        Assert.Equal(HttpStatusCode.BadRequest, exception.StatusCode);
        Assert.Contains("model_no", exception.Message);
    }

    [Fact]
    public async Task AdminUserWriteCallsSerializeContract()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/auth/users/5" => Json("""{"id":5,"username":"petrov","full_name":"Pyotr Sidorov","role":"viewer","is_active":true}"""),
                "/api/v1/auth/users" => Json("""{"id":9,"username":"novikov","role":"viewer","is_active":true}""", HttpStatusCode.Created),
                "/api/v1/auth/users/5/reset-2fa" => Json("""{"success":true,"user_id":5,"revoked_devices":3,"revoked_biometric_credentials":1,"closed_sessions":2}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // PATCH: snake_case, null-поля из JSON отсутствуют (exclude_unset).
        var updated = await client.UpdateUserAsync(5, new HubUserUpdateRequest
        {
            FullName = "Pyotr Sidorov",
            IsActive = false,
        }, CancellationToken.None);
        Assert.Equal("Pyotr Sidorov", updated.FullName);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/auth/users/5");
        Assert.Contains("\"full_name\":\"Pyotr Sidorov\"", patch.Body ?? string.Empty);
        Assert.Contains("\"is_active\":false", patch.Body ?? string.Empty);
        Assert.DoesNotContain("\"role\"", patch.Body ?? string.Empty);
        Assert.DoesNotContain("\"email\"", patch.Body ?? string.Empty);
        Assert.DoesNotContain("\"password\"", patch.Body ?? string.Empty);
        Assert.DoesNotContain("\"telegram_id\"", patch.Body ?? string.Empty);

        // POST create: обязательные + дефолты role/is_active; null-опциональные опускаются.
        var created = await client.CreateUserAsync(new HubUserCreateRequest
        {
            Username = "novikov",
            Password = "secret123",
            FullName = "Новиков Дмитрий",
        }, CancellationToken.None);
        Assert.Equal(9, created.Id);
        var post = handler.Requests.Last(
            request => request.Method == "POST" && request.Path == "/api/v1/auth/users");
        Assert.Contains("\"username\":\"novikov\"", post.Body ?? string.Empty);
        Assert.Contains("\"password\":\"secret123\"", post.Body ?? string.Empty);
        Assert.Contains("\"role\":\"viewer\"", post.Body ?? string.Empty);
        Assert.Contains("\"is_active\":true", post.Body ?? string.Empty);
        Assert.DoesNotContain("\"email\"", post.Body ?? string.Empty);
        Assert.DoesNotContain("\"mailbox_password\"", post.Body ?? string.Empty);

        // Сброс 2FA: POST без тела → счётчики ответа.
        var reset = await client.ResetUserTwoFactorAsync(5, CancellationToken.None);
        Assert.True(reset.Success);
        Assert.Equal(3, reset.RevokedDevices);
        Assert.Equal(2, reset.ClosedSessions);
        Assert.Equal(1, handler.Count("POST", "/api/v1/auth/users/5/reset-2fa"));
    }

    [Fact]
    public async Task AdminAiBotAndDepartmentManagersWriteCallsSerializeContract()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/ai-bots/b1" => Json(
                    """{"id":"b1","slug":"corp-assistant","title":"Новое имя","is_enabled":false,"temperature":0.7,"max_tokens":4000,"updated_at":"2026-11-21T10:00:00+03:00"}"""),
                "/api/v1/ai-bots" => Json(
                    """{"id":"b9","slug":"support-bot","title":"Саппорт","temperature":0.2,"max_tokens":2000,"is_enabled":true,"configured":false}""",
                    HttpStatusCode.Created),
                "/api/v1/departments/d-1/managers" => Json(
                    """{"department":{"id":"d-1","name":"ИТ"},"items":[{"id":11,"user_id":7,"role":"member","is_active":true},{"id":12,"user_id":7,"role":"manager","is_active":true},{"id":13,"user_id":9,"role":"manager","is_active":true}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // PATCH /ai-bots/{id}: snake_case, null-поля не уходят (exclude_unset).
        var updated = await client.UpdateAiBotAsync("b1", new HubAiBotUpdateRequest
        {
            Title = "Новое имя",
            IsEnabled = false,
            Temperature = 0.7,
            MaxTokens = 4000,
        }, CancellationToken.None);
        Assert.Equal("Новое имя", updated.Title);
        Assert.False(updated.IsEnabled);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/ai-bots/b1");
        using var patchBody = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}");
        var patchRoot = patchBody.RootElement;
        Assert.Equal("Новое имя", patchRoot.GetProperty("title").GetString());
        Assert.False(patchRoot.GetProperty("is_enabled").GetBoolean());
        Assert.Equal(0.7, patchRoot.GetProperty("temperature").GetDouble());
        Assert.Equal(4000, patchRoot.GetProperty("max_tokens").GetInt32());
        Assert.False(patchRoot.TryGetProperty("description", out _));
        Assert.False(patchRoot.TryGetProperty("system_prompt", out _));
        Assert.False(patchRoot.TryGetProperty("model", out _));
        Assert.False(patchRoot.TryGetProperty("slug", out _));
        Assert.False(patchRoot.TryGetProperty("tool_settings", out _));

        // POST /ai-bots: обязательные slug/title + поля формы.
        var created = await client.CreateAiBotAsync(new HubAiBotCreateRequest
        {
            Slug = "support-bot",
            Title = "Саппорт",
            Description = "Помощник поддержки",
            AllowedKbScope = ["support", "it"],
            AllowKbDocumentDelivery = true,
        }, CancellationToken.None);
        Assert.Equal("b9", created.Id);
        Assert.Equal("support-bot", created.Slug);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/ai-bots");
        using var postBody = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        var postRoot = postBody.RootElement;
        Assert.Equal("support-bot", postRoot.GetProperty("slug").GetString());
        Assert.Equal("Саппорт", postRoot.GetProperty("title").GetString());
        Assert.Equal("Помощник поддержки", postRoot.GetProperty("description").GetString());
        Assert.Equal(
            new[] { "support", "it" },
            postRoot.GetProperty("allowed_kb_scope").EnumerateArray().Select(e => e.GetString()).ToArray());
        Assert.True(postRoot.GetProperty("allow_kb_document_delivery").GetBoolean());
        Assert.True(postRoot.GetProperty("is_enabled").GetBoolean());

        // PUT /departments/{id}/managers: {manager_user_ids:[...]} → items memberships.
        var members = await client.SetDepartmentManagersAsync("d-1", [7, 9], CancellationToken.None);
        var put = Assert.Single(handler.Requests,
            request => request.Method == "PUT" && request.Path == "/api/v1/departments/d-1/managers");
        using var putBody = System.Text.Json.JsonDocument.Parse(put.Body ?? "{}");
        Assert.Equal(
            [7L, 9L],
            putBody.RootElement.GetProperty("manager_user_ids").EnumerateArray().Select(e => e.GetInt64()).ToArray());
        Assert.Equal("d-1", members.Department?.Id);
        Assert.Equal(3, members.Items!.Count);
        Assert.Equal(2, members.Items.Count(i => i.Role == "manager"));
    }

    [Fact]
    public async Task ConsumablesLookupHitsExpectedRouteAndParsesRows()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/consumables/lookup" => Json(
                    """[{"id":42,"inv_no":"C-1001","type_no":12,"type_name":"Картридж","model_no":7,"model_name":"HP CF283A","qty":5,"branch_no":5,"branch_name":"Сургут","loc_no":"L-3","location_name":"офис 210","part_no":"CF283A","description":"для МФУ"},{"id":43,"inv_no":null,"qty":1,"branch_no":"B-1"}]"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var rows = await client.GetConsumablesLookupAsync(
            onlyPositiveQty: true, 500, CancellationToken.None);

        Assert.Equal(2, rows.Count);
        var first = rows[0];
        Assert.Equal(42, first.Id);
        Assert.Equal("C-1001", first.InvNo);
        Assert.Equal(12, first.TypeNo);
        Assert.Equal("Картридж", first.TypeName);
        Assert.Equal(7, first.ModelNo);
        Assert.Equal("HP CF283A", first.ModelName);
        Assert.Equal(5, first.Qty);
        // branch_no/loc_no — int|str в модели бэкенда, сырой JSON сохраняет тип.
        Assert.Equal(5, first.BranchNo?.GetInt32());
        Assert.Equal("Сургут", first.BranchName);
        Assert.Equal("L-3", first.LocNo?.GetString());
        Assert.Equal("офис 210", first.LocationName);
        Assert.Equal("CF283A", first.PartNo);
        Assert.Equal("B-1", rows[1].BranchNo?.GetString());

        var request = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/equipment/consumables/lookup");
        Assert.Equal("GET", request.Method);
        Assert.Equal("?only_positive_qty=true&limit=500", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task ConsumableWriteCallsSerializeContract()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/equipment/consumables/consume" => Json(
                    """{"success":true,"item_id":42,"inv_no":"C-1001","qty_old":5,"qty_new":4,"message":"ok","operation_id":"op-c1","work_status":"recorded"}"""),
                "/api/v1/equipment/consumables/qty" => Json(
                    """{"success":true,"item_id":42,"inv_no":"C-1001","qty_old":4,"qty_new":9,"message":"ok"}"""),
                "/api/v1/equipment/consumables/create" => Json(
                    """{"success":true,"item_id":44,"inv_no":"C-1002","created_model":true,"message":"создан"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // consume: item_id+qty+reason+operation_id — как веб consumeConsumable.
        var consumed = await client.ConsumeConsumableAsync(
            new HubConsumableConsumeRequest
            {
                ItemId = 42,
                InvNo = "C-1001",
                Qty = 1,
                Reason = "mfu",
                OperationId = "op-c1",
            },
            CancellationToken.None);
        Assert.True(consumed.Success);
        Assert.Equal(5, consumed.QtyOld);
        Assert.Equal(4, consumed.QtyNew);
        Assert.Equal("op-c1", consumed.OperationId);
        Assert.Equal("recorded", consumed.WorkStatus);
        var consumePost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/consumables/consume");
        using var consumeBody = System.Text.Json.JsonDocument.Parse(consumePost.Body ?? "{}");
        var consumeRoot = consumeBody.RootElement;
        Assert.Equal(42, consumeRoot.GetProperty("item_id").GetInt64());
        Assert.Equal("C-1001", consumeRoot.GetProperty("inv_no").GetString());
        Assert.Equal(1, consumeRoot.GetProperty("qty").GetInt32());
        Assert.Equal("mfu", consumeRoot.GetProperty("reason").GetString());
        Assert.Equal("op-c1", consumeRoot.GetProperty("operation_id").GetString());

        // qty: точный остаток, PATCH.
        var updated = await client.UpdateConsumableQtyAsync(
            new HubConsumableQtyUpdateRequest { ItemId = 42, InvNo = "C-1001", Qty = 9 },
            CancellationToken.None);
        Assert.True(updated.Success);
        Assert.Equal(9, updated.QtyNew);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/equipment/consumables/qty");
        using var patchBody = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}");
        var patchRoot = patchBody.RootElement;
        Assert.Equal(42, patchRoot.GetProperty("item_id").GetInt64());
        Assert.Equal("C-1001", patchRoot.GetProperty("inv_no").GetString());
        Assert.Equal(9, patchRoot.GetProperty("qty").GetInt32());
        Assert.False(patchRoot.TryGetProperty("operation_id", out _));

        // create: branch_no int / loc_no str — int|str без потери типа.
        using var branchNo = System.Text.Json.JsonDocument.Parse("5");
        using var locNo = System.Text.Json.JsonDocument.Parse("\"L-3\"");
        var created = await client.CreateConsumableAsync(
            new HubConsumableCreateRequest
            {
                BranchNo = branchNo.RootElement,
                LocNo = locNo.RootElement,
                TypeNo = 12,
                Qty = 3,
                ModelName = "HP CF283A",
                PartNo = "CF283A",
                Description = "для МФУ",
            },
            CancellationToken.None);
        Assert.True(created.Success);
        Assert.Equal(44, created.ItemId);
        Assert.Equal("C-1002", created.InvNo);
        Assert.True(created.CreatedModel);
        var createPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/consumables/create");
        using var createBody = System.Text.Json.JsonDocument.Parse(createPost.Body ?? "{}");
        var createRoot = createBody.RootElement;
        Assert.Equal(5, createRoot.GetProperty("branch_no").GetInt32());
        Assert.Equal("L-3", createRoot.GetProperty("loc_no").GetString());
        Assert.Equal(12, createRoot.GetProperty("type_no").GetInt32());
        Assert.Equal(3, createRoot.GetProperty("qty").GetInt32());
        Assert.Equal("HP CF283A", createRoot.GetProperty("model_name").GetString());
        Assert.Equal("CF283A", createRoot.GetProperty("part_no").GetString());
        Assert.Equal("для МФУ", createRoot.GetProperty("description").GetString());
        Assert.StartsWith("Bearer ", createPost.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task EquipmentPhotoUploadPostsMultipartToPhotosRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/equipment/42/photos" => Json(
                    """{"file_no":77,"item_id":42,"file_name":"a.jpg"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var content = new byte[] { 1, 2, 3, 4 };
        var result = await client.UploadEquipmentPhotoAsync(
            42, "a.jpg", content, "image/jpeg", "Лицевая панель", CancellationToken.None);

        Assert.Equal(77, result.FileNo);
        Assert.Equal(42, result.ItemId);
        Assert.Equal("a.jpg", result.FileName);
        // Контракт веб-аплоада: POST /equipment/{id}/photos, multipart-поле «file»,
        // description — query-параметром (сервер принимает только его).
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/42/photos");
        Assert.Contains("multipart/form-data", post.ContentType);
        Assert.Contains("description=", post.Query);
        Assert.Contains("Лицевая", Uri.UnescapeDataString(post.Query));
        var body = post.Body ?? string.Empty;
        Assert.Contains("name=file", body);
        Assert.Contains("filename", body);
        Assert.Contains("a.jpg", body);
        Assert.Contains("image/jpeg", body);
    }

    [Fact]
    public async Task EquipmentPhotoChunkedUploadHitsSessionRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/equipment/42/photo-uploads" => Json(
                    """{"upload_id":"0123456789abcdef0123456789abcdef","status":"uploading","item_id":42,"size":300000,"chunk_size":262144,"total_chunks":2,"received":[],"file_no":null}"""),
                "/api/v1/equipment/photo-uploads/0123456789abcdef0123456789abcdef/chunks/0" => Json(
                    """{"upload_id":"0123456789abcdef0123456789abcdef","status":"uploading","item_id":42,"size":300000,"chunk_size":262144,"total_chunks":2,"received":[0],"file_no":null}"""),
                "/api/v1/equipment/photo-uploads/0123456789abcdef0123456789abcdef/complete" => Json(
                    """{"file_no":88,"item_id":42,"file_name":"b.jpg"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // Сессия: JSON-манифест (client_id — ключ идемпотентности).
        var session = await client.CreateEquipmentPhotoUploadSessionAsync(
            42,
            new HubEquipmentPhotoUploadSessionCreate
            {
                ClientId = "d2-abc123",
                FileName = "b.jpg",
                Size = 300000,
                MimeType = "image/jpeg",
            },
            CancellationToken.None);
        Assert.Equal("0123456789abcdef0123456789abcdef", session.UploadId);
        Assert.Equal(262144, session.ChunkSize);
        var create = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/42/photo-uploads");
        using var createBody = System.Text.Json.JsonDocument.Parse(create.Body ?? "{}");
        var createRoot = createBody.RootElement;
        Assert.Equal("d2-abc123", createRoot.GetProperty("client_id").GetString());
        Assert.Equal("b.jpg", createRoot.GetProperty("file_name").GetString());
        Assert.Equal(300000, createRoot.GetProperty("size").GetInt64());
        Assert.Equal("image/jpeg", createRoot.GetProperty("mime_type").GetString());

        // Чанк: PUT сырого тела octet-stream на /photo-uploads/{id}/chunks/{i}.
        var chunk = new byte[100];
        var state = await client.UploadEquipmentPhotoChunkAsync(
            session.UploadId!, 0, chunk, CancellationToken.None);
        Assert.Equal("uploading", state.Status);
        var put = Assert.Single(handler.Requests,
            request => request.Method == "PUT"
                && request.Path == "/api/v1/equipment/photo-uploads/0123456789abcdef0123456789abcdef/chunks/0");
        Assert.Equal("application/octet-stream", put.ContentType);

        // Complete: POST без тела → идентификаторы вставленной записи.
        var done = await client.CompleteEquipmentPhotoUploadAsync(session.UploadId!, CancellationToken.None);
        Assert.Equal(88, done.FileNo);
        Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/equipment/photo-uploads/0123456789abcdef0123456789abcdef/complete");
    }

    [Fact]
    public async Task EquipmentPhotoModerationRoutesAndBodies()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/equipment/42/photos/77/verify" => Json(
                    """{"file_no":77,"verified":true,"verified_by":"mod","can_verify":false}"""),
                "/api/v1/equipment/42/photos/77/reject" => Json(
                    """{"file_no":77,"rejected":true,"rejected_by":"mod","reject_reason":"нечитаемо","can_reject":false}"""),
                "/api/v1/equipment/42/photos/77/rotate" => Json(
                    """{"ok":true,"file_no":77,"file_name":"a.jpg","size_mb":0.5,"has_thumb":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // verify: POST без тела → карточка с отметкой.
        var verified = await client.VerifyEquipmentPhotoAsync(42, 77, CancellationToken.None);
        Assert.True(verified.Verified);
        Assert.Equal("mod", verified.VerifiedBy);
        Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/equipment/42/photos/77/verify"
                && request.Body is null or "");

        // reject: reason в JSON-теле обязателен по контракту.
        var rejected = await client.RejectEquipmentPhotoAsync(
            42, 77, "фото нечитаемо", CancellationToken.None);
        Assert.True(rejected.Rejected);
        Assert.Equal("нечитаемо", rejected.RejectReason);
        var rejectPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/42/photos/77/reject");
        using (var rejectBody = System.Text.Json.JsonDocument.Parse(rejectPost.Body ?? "{}"))
        {
            Assert.Equal("фото нечитаемо", rejectBody.RootElement.GetProperty("reason").GetString());
        }

        // PATCH reject — правка причины тем же телом {reason}.
        await client.UpdateEquipmentPhotoRejectReasonAsync(
            42, 77, "новое описание", CancellationToken.None);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/equipment/42/photos/77/reject");
        using (var patchBody = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}"))
        {
            Assert.Equal("новое описание", patchBody.RootElement.GetProperty("reason").GetString());
        }

        // rotate: {degrees: 90} → ok + новое имя файла.
        var rotated = await client.RotateEquipmentPhotoAsync(42, 77, 90, CancellationToken.None);
        Assert.True(rotated.Ok);
        Assert.Equal(77, rotated.FileNo);
        var rotatePost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/equipment/42/photos/77/rotate");
        using var rotateBody = System.Text.Json.JsonDocument.Parse(rotatePost.Body ?? "{}");
        Assert.Equal(90, rotateBody.RootElement.GetProperty("degrees").GetInt32());
    }

    // ---- Отсутствия: POST/PATCH/DELETE /hub/absences ----

    [Fact]
    public async Task AbsenceCreatePostsSnakeCaseBodyAndReadsNumericId()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/absences" => Json(
                    """{"id":42,"user_id":null,"display_name":"Иванов Иван","department":"ИТ","kind":"sick","kind_label":"Больничный","starts_on":"2026-11-16","ends_on":"2026-11-20","comment":"справка","source":"manual","created_by":7,"created_at":"2026-11-10T08:00:00Z","updated_at":"2026-11-10T08:00:00Z"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var created = await client.CreateHubAbsenceAsync(
            new HubAbsenceUpsertRequest
            {
                DisplayName = "Иванов Иван",
                Kind = "sick",
                StartsOn = "2026-11-16",
                EndsOn = "2026-11-20",
                Comment = "справка",
                Department = "ИТ",
            },
            CancellationToken.None);

        // Числовой id ручной записи читается в строку (у ЗУП — «zup:…»).
        Assert.Equal("42", created.Id);
        Assert.Equal("manual", created.Source);
        Assert.Equal("ИТ", created.Department);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/hub/absences");
        using var body = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("Иванов Иван", body.RootElement.GetProperty("display_name").GetString());
        Assert.Equal("sick", body.RootElement.GetProperty("kind").GetString());
        Assert.Equal("2026-11-16", body.RootElement.GetProperty("starts_on").GetString());
        Assert.Equal("2026-11-20", body.RootElement.GetProperty("ends_on").GetString());
        Assert.Equal("справка", body.RootElement.GetProperty("comment").GetString());
        Assert.Equal("ИТ", body.RootElement.GetProperty("department").GetString());
    }

    [Fact]
    public async Task AbsenceUpdatePatchesOnlyProvidedFields()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/absences/42" => Json(
                    """{"id":42,"display_name":"Иванов Иван","kind":"trip","kind_label":"Командировка","starts_on":"2026-11-16","ends_on":"2026-11-20","source":"manual"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var updated = await client.UpdateHubAbsenceAsync(
            42,
            new HubAbsenceUpsertRequest { Kind = "trip" },
            CancellationToken.None);

        Assert.Equal("42", updated.Id);
        Assert.Equal("trip", updated.Kind);
        // diff-тело: только переданное поле, остальные ключи в JSON не попадают.
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH" && request.Path == "/api/v1/hub/absences/42");
        using var body = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}");
        Assert.Equal("trip", body.RootElement.GetProperty("kind").GetString());
        Assert.Single(body.RootElement.EnumerateObject());
    }

    [Fact]
    public async Task AbsenceDeleteHitsIdRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/absences/42" => Json("""{"ok":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.DeleteHubAbsenceAsync(42, CancellationToken.None);

        Assert.Equal(1, handler.Count("DELETE", "/api/v1/hub/absences/42"));
    }

    // ---- Центр уведомлений: /hub/notifications/* ----

    [Fact]
    public async Task NotificationsPollSendsCursorLimitAndUnreadFlag()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/notifications/poll" => Json(
                    """{"items":[],"since":"2026-11-20T10:00:00Z","limit":50,"unread_only":true,"unread_counts":{"notifications_unread_total":3,"announcements_unread":1},"generated_at":"2026-11-20T10:05:00Z"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetNotificationsPollAsync(
            "2026-11-20T09:00:00+00:00", 50, unreadOnly: true, CancellationToken.None);

        Assert.Equal("2026-11-20T10:00:00Z", page.Since);
        Assert.Equal(3, page.UnreadCounts?.NotificationsUnreadTotal);
        var request = Assert.Single(handler.Requests,
            r => r.Method == "GET" && r.Path == "/api/v1/hub/notifications/poll");
        Assert.Contains("since=2026-11-20T09%3A00%3A00%2B00%3A00", request.Query);
        Assert.Contains("limit=50", request.Query);
        Assert.Contains("unread_only=true", request.Query);
        Assert.Equal("Bearer " + access, request.Authorization);
    }

    [Fact]
    public async Task NotificationsPollParsesItemsAndCounts()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/notifications/poll" => Json(
                    """{"items":[{"id":"n2","recipient_user_id":7,"event_type":"task.assigned","title":"Новая задача","body":"Согласовать договор","entity_type":"task","entity_id":"42","created_at":"2026-11-20T10:00:00Z","unread":1},{"id":"n1","event_type":"announcement.published","title":"Объявление","body":null,"entity_type":"announcement","entity_id":"a1#5","created_at":"2026-11-19T18:30:00Z","unread":0}],"since":null,"unread_counts":{"notifications_unread_total":7,"announcements_unread":2,"announcements_ack_pending":1},"generated_at":"2026-11-20T10:05:00Z"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetNotificationsPollAsync(null, 50, unreadOnly: false, CancellationToken.None);

        Assert.Equal(2, page.Items?.Count);
        var first = page.Items![0];
        Assert.Equal("n2", first.Id);
        Assert.Equal(7, first.RecipientUserId);
        Assert.Equal("task.assigned", first.EventType);
        Assert.Equal("task", first.EntityType);
        Assert.Equal("42", first.EntityId);
        Assert.Equal(1, first.Unread);
        Assert.Equal(0, page.Items[1].Unread);
        Assert.Equal(7, page.UnreadCounts?.NotificationsUnreadTotal);
        // Без курсора since уходит пустым, unread_only опускается.
        var request = Assert.Single(handler.Requests,
            r => r.Method == "GET" && r.Path == "/api/v1/hub/notifications/poll");
        Assert.Contains("since=", request.Query);
        Assert.DoesNotContain("unread_only", request.Query);
    }

    [Fact]
    public async Task NotificationUnreadCountsHitsRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/notifications/unread-counts" => Json(
                    """{"notifications_unread_total":9,"announcements_unread":4,"announcements_ack_pending":2,"hub_chat_ordinary":{"unread_total":5}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var counts = await client.GetNotificationUnreadCountsAsync(CancellationToken.None);

        Assert.Equal(9, counts.NotificationsUnreadTotal);
        Assert.Equal(4, counts.AnnouncementsUnread);
        var request = Assert.Single(handler.Requests,
            r => r.Method == "GET" && r.Path == "/api/v1/hub/notifications/unread-counts");
        Assert.Equal("Bearer " + access, request.Authorization);
    }

    [Fact]
    public async Task NotificationMarkReadPostsToEscapedIdRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/notifications/n%3A42/read" => Json(
                    """{"ok":true,"notification_id":"n:42"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.MarkNotificationReadAsync("n:42", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("n:42", result.NotificationId);
        var request = Assert.Single(handler.Requests,
            r => r.Method == "POST" && r.Path == "/api/v1/hub/notifications/n%3A42/read");
        Assert.Equal("Bearer " + access, request.Authorization);
    }

    [Fact]
    public async Task NotificationReadAllPostsAndReadsMarkedCount()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/notifications/read-all" => Json("""{"ok":true,"marked_count":6}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.MarkAllNotificationsReadAsync(CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal(6, result.MarkedCount);
        Assert.Equal(1, handler.Count("POST", "/api/v1/hub/notifications/read-all"));
    }

    // ---- Новости: вовлечение (реакции/лайк/закладка/опрос/комментарии/вложения) ----

    [Fact]
    public async Task AnnouncementReactionSetAndClearHitExpectedRoutesAndBody()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            (request.Path, request.Method) switch
            {
                ("/api/v1/auth/login", _) => Json(LoginPayload(access, "refresh-old")),
                ("/api/v1/hub/announcements/a1/reaction", "PUT") => Json(
                    """{"announcement_id":"a1","viewer_reaction":"wow","reaction_counts":{"wow":2},"reactions_count":2,"viewer_has_liked":false,"likes_count":5}"""),
                ("/api/v1/hub/announcements/a1/reaction", "DELETE") => Json(
                    """{"announcement_id":"a1","viewer_reaction":null,"reaction_counts":{},"reactions_count":0,"viewer_has_liked":false,"likes_count":5}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var set = await client.SetAnnouncementReactionAsync("a1", "wow", CancellationToken.None);
        var cleared = await client.ClearAnnouncementReactionAsync("a1", CancellationToken.None);

        Assert.Equal("wow", set.ViewerReaction);
        Assert.Equal(2, set.ReactionCounts?["wow"]);
        Assert.Equal(5, set.LikesCount);
        var put = handler.Requests.First(request =>
            request.Method == "PUT" && request.Path == "/api/v1/hub/announcements/a1/reaction");
        Assert.Contains("\"reaction_type\":\"wow\"", put.Body ?? string.Empty);
        Assert.Equal(
            1,
            handler.Count("DELETE", "/api/v1/hub/announcements/a1/reaction"));
        Assert.Null(cleared.ViewerReaction);
    }

    [Fact]
    public async Task AnnouncementLikeToggleUsesPutDelete()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/like" => Json(
                    """{"announcement_id":"a1","viewer_reaction":"like","reaction_counts":{"like":4},"reactions_count":4,"viewer_has_liked":true,"likes_count":4}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var liked = await client.SetAnnouncementLikeAsync("a1", true, CancellationToken.None);
        var unliked = await client.SetAnnouncementLikeAsync("a1", false, CancellationToken.None);

        Assert.True(liked.ViewerHasLiked);
        Assert.Equal(4, liked.LikesCount);
        Assert.Equal(1, handler.Count("PUT", "/api/v1/hub/announcements/a1/like"));
        Assert.Equal(1, handler.Count("DELETE", "/api/v1/hub/announcements/a1/like"));
        Assert.NotNull(unliked);
    }

    [Fact]
    public async Task AnnouncementBookmarkToggleUsesPutDeleteAndParsesFlag()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/bookmark" => Json(
                    """{"announcement_id":"a1","viewer_bookmarked":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var added = await client.SetAnnouncementBookmarkAsync("a1", true, CancellationToken.None);
        await client.SetAnnouncementBookmarkAsync("a1", false, CancellationToken.None);

        Assert.True(added.ViewerBookmarked);
        Assert.Equal(1, handler.Count("PUT", "/api/v1/hub/announcements/a1/bookmark"));
        Assert.Equal(1, handler.Count("DELETE", "/api/v1/hub/announcements/a1/bookmark"));
    }

    [Fact]
    public async Task AnnouncementPollVoteSendsOptionIdsAndParsesPoll()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/poll/vote" => Json(
                    """
                    {"announcement_id":"a1","poll":{"id":"p1","question":"Окно?","allows_multiple":false,
                     "is_anonymous":true,"closes_at":null,"is_closed":false,"has_voted":true,
                     "viewer_option_ids":["o2"],"total_votes":9,"total_voters":9,
                     "options":[{"id":"o1","text":"Суббота","votes_count":3,"viewer_voted":false},
                                {"id":"o2","text":"Воскресенье","votes_count":6,"viewer_voted":true}]}}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.VoteAnnouncementPollAsync(
            "a1", ["o2"], CancellationToken.None);

        var vote = Assert.Single(
            handler.Requests,
            request => request.Path == "/api/v1/hub/announcements/a1/poll/vote");
        Assert.Equal("PUT", vote.Method);
        Assert.Contains("\"option_ids\":[\"o2\"]", vote.Body ?? string.Empty);
        Assert.Equal("p1", result.Poll?.Id);
        Assert.True(result.Poll?.HasVoted);
        Assert.Equal(9, result.Poll?.TotalVoters);
        Assert.True(result.Poll?.Options?[1].ViewerVoted);
        Assert.Equal(6, result.Poll?.Options?[1].VotesCount);
    }

    [Fact]
    public async Task AnnouncementReactionUsersHitExpectedRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/reactions" => Json(
                    """{"items":[{"user_id":7,"username":"tester","full_name":"Test User","reaction_type":"wow","updated_at":"2025-11-18T10:00:00Z"}],"total":1,"next_offset":null}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var users = await client.GetAnnouncementReactionUsersAsync(
            "a1", "wow", 30, 0, CancellationToken.None);

        var request = handler.Requests.Last(request =>
            request.Path == "/api/v1/hub/announcements/a1/reactions");
        Assert.Equal("GET", request.Method);
        Assert.Contains("reaction_type=wow", request.Query);
        Assert.Contains("limit=30", request.Query);
        var user = Assert.Single(users.Items ?? []);
        Assert.Equal("Test User", user.FullName);
        Assert.Equal("wow", user.ReactionType);
    }

    [Fact]
    public async Task AnnouncementsBookmarkedOnlyAddsQueryFlag()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements" => Json(
                    """{"items":[],"total":0,"unread_total":0,"ack_pending_total":0,"limit":30,"offset":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.GetAnnouncementsAsync(
            new HubAnnouncementQuery { BookmarkedOnly = true }, CancellationToken.None);

        var request = handler.Requests.Last(request =>
            request.Path == "/api/v1/hub/announcements");
        Assert.Equal("GET", request.Method);
        Assert.Contains("bookmarked_only=true", request.Query);
        Assert.DoesNotContain("unread_only", request.Query);
    }

    [Fact]
    public async Task AnnouncementCommentsRoutesBodiesAndReplies()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            (request.Path, request.Method) switch
            {
                ("/api/v1/auth/login", _) => Json(LoginPayload(access, "refresh-old")),
                ("/api/v1/hub/announcements/a1/comments", "GET") => Json(
                    """{"items":[{"id":"c1","announcement_id":"a1","user_id":9,"username":"petrov","full_name":"Пётр Петров","body":"Понял, спасибо","created_at":"2025-11-18T10:00:00Z","is_deleted":false,"can_edit":false,"can_delete":false,"reaction_counts":{"like":2},"viewer_reaction":null,"attachments":[],"reply_count":1}],"total":1,"comments_total":2,"limit":30,"offset":0,"sort":"interesting","next_offset":null}"""),
                ("/api/v1/hub/announcements/a1/comments", "POST") => Json(
                    """{"id":"c2","announcement_id":"a1","user_id":7,"username":"tester","full_name":"Test User","body":"Подтверждаю","parent_comment_id":"c1","root_comment_id":"c1","reply_to_username":"petrov","created_at":"2025-11-18T11:00:00Z","is_deleted":false,"can_edit":true,"can_delete":true,"reaction_counts":{},"viewer_reaction":null,"attachments":[],"reply_count":0}"""),
                ("/api/v1/hub/announcements/a1/comments/c2", "PATCH") => Json(
                    """{"id":"c2","announcement_id":"a1","user_id":7,"username":"tester","full_name":"Test User","body":"Подтверждаю, v2","created_at":"2025-11-18T11:00:00Z","updated_at":"2025-11-18T11:05:00Z","is_deleted":false,"can_edit":true,"can_delete":true,"reaction_counts":{},"viewer_reaction":null,"attachments":[],"reply_count":0}"""),
                ("/api/v1/hub/announcements/a1/comments/c2", "DELETE") => Json(
                    """{"ok":true,"comment_id":"c2"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetAnnouncementCommentsAsync(
            "a1",
            new HubAnnouncementCommentQuery { Limit = 30, RootCommentId = "c1" },
            CancellationToken.None);
        var created = await client.CreateAnnouncementCommentAsync(
            "a1", "Подтверждаю", "c1", CancellationToken.None);
        var updated = await client.UpdateAnnouncementCommentAsync(
            "a1", "c2", "Подтверждаю, v2", CancellationToken.None);
        await client.DeleteAnnouncementCommentAsync("a1", "c2", CancellationToken.None);

        var list = handler.Requests.First(request =>
            request.Path == "/api/v1/hub/announcements/a1/comments" && request.Method == "GET");
        Assert.Contains("root_comment_id=c1", list.Query);
        Assert.Contains("limit=30", list.Query);
        var comment = Assert.Single(page.Items ?? []);
        Assert.Equal("Пётр Петров", comment.FullName);
        Assert.False(comment.CanEdit);
        Assert.Equal(2, page.CommentsTotal);

        var post = handler.Requests.First(request =>
            request.Path == "/api/v1/hub/announcements/a1/comments" && request.Method == "POST");
        // Тело кириллическое → System.Text.Json экранирует в \uXXXX: проверяем ключи.
        Assert.Contains("\"body\":", post.Body ?? string.Empty);
        Assert.Contains("\"parent_comment_id\":\"c1\"", post.Body ?? string.Empty);
        Assert.Contains("client_request_id", post.Body ?? string.Empty);
        Assert.True(created.CanDelete);
        Assert.Equal("c1", created.ParentCommentId);

        var patch = handler.Requests.First(request =>
            request.Path == "/api/v1/hub/announcements/a1/comments/c2" && request.Method == "PATCH");
        Assert.Contains("\"body\":", patch.Body ?? string.Empty);
        Assert.Equal("Подтверждаю, v2", updated.Body);
        Assert.Equal(
            1,
            handler.Count("DELETE", "/api/v1/hub/announcements/a1/comments/c2"));
    }

    [Fact]
    public async Task AnnouncementCommentReactionSetAndClearHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/comments/c1/reaction" => Json(
                    """{"comment_id":"c1","viewer_reaction":"love","reaction_counts":{"love":3}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var set = await client.SetAnnouncementCommentReactionAsync(
            "a1", "c1", "love", CancellationToken.None);
        await client.SetAnnouncementCommentReactionAsync(
            "a1", "c1", null, CancellationToken.None);

        var put = handler.Requests.First(request =>
            request.Method == "PUT"
            && request.Path == "/api/v1/hub/announcements/a1/comments/c1/reaction");
        Assert.Contains("\"reaction_type\":\"love\"", put.Body ?? string.Empty);
        Assert.Equal(
            1,
            handler.Count("DELETE", "/api/v1/hub/announcements/a1/comments/c1/reaction"));
        Assert.Equal("love", set.ViewerReaction);
        Assert.Equal(3, set.ReactionCounts?["love"]);
    }

    [Fact]
    public async Task AnnouncementAttachmentDownloadsStreamBodyAndReturnDispositionName()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1/attachments/att-1/file" =>
                    Binary("pdf-bytes"u8, "grafik.pdf"),
                "/api/v1/hub/announcements/a1/comments/c1/attachments/att-2/file" =>
                    Binary("txt-bytes"u8, "note.txt"),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        using var fileStream = new MemoryStream();
        var fileName = await client.DownloadAnnouncementAttachmentAsync(
            "a1", "att-1", fileStream, CancellationToken.None);
        using var commentStream = new MemoryStream();
        var commentName = await client.DownloadAnnouncementCommentAttachmentAsync(
            "a1", "c1", "att-2", commentStream, CancellationToken.None);

        Assert.Equal("grafik.pdf", fileName);
        Assert.Equal("pdf-bytes", Encoding.UTF8.GetString(fileStream.ToArray()));
        Assert.Equal("note.txt", commentName);
        Assert.Equal("txt-bytes", Encoding.UTF8.GetString(commentStream.ToArray()));
        Assert.Equal(
            1,
            handler.Count("GET", "/api/v1/hub/announcements/a1/attachments/att-1/file"));
        Assert.Equal(
            1,
            handler.Count("GET", "/api/v1/hub/announcements/a1/comments/c1/attachments/att-2/file"));

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

    /// <summary>Detail-ответ содержит реакции/опрос/вложения — парсинг всех полей.</summary>
    [Fact]
    public async Task AnnouncementDetailParsesSocialPollAndAttachments()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/announcements/a1" => Json(
                    """
                    {"id":"a1","title":"Работы в ДЦ","body":"Текст","comments_enabled":true,
                     "reactions_enabled":true,"reaction_counts":{"like":3,"wow":1},"reactions_count":4,
                     "viewer_reaction":"wow","viewer_has_liked":false,"likes_count":3,
                     "viewer_bookmarked":true,
                     "poll":{"id":"p1","question":"Когда?","allows_multiple":true,"is_anonymous":false,
                             "closes_at":"2030-01-01T00:00:00Z","is_closed":false,"has_voted":true,
                             "viewer_option_ids":["o1","o2"],"total_votes":7,"total_voters":4,
                             "options":[{"id":"o1","text":"Сб","votes_count":2,"viewer_voted":true},
                                        {"id":"o2","text":"Вс","votes_count":5,"viewer_voted":true}]},
                     "attachments":[{"id":"att-1","announcement_id":"a1","file_name":"grafik.pdf",
                                     "file_mime":"application/pdf","file_size":182400,"is_cover":false}]}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var item = await client.GetAnnouncementAsync("a1", CancellationToken.None);

        Assert.True(item.ReactionsEnabled);
        Assert.True(item.ViewerBookmarked);
        Assert.Equal("wow", item.ViewerReaction);
        Assert.Equal(3, item.ReactionCounts?["like"]);
        Assert.Equal(3, item.LikesCount);
        Assert.False(item.ViewerHasLiked);
        Assert.Equal("p1", item.Poll?.Id);
        Assert.True(item.Poll?.AllowsMultiple);
        Assert.Equal(4, item.Poll?.TotalVoters);
        Assert.Equal(["o1", "o2"], item.Poll?.ViewerOptionIds ?? []);
        Assert.True(item.Poll?.Options?[0].ViewerVoted);
        var attachment = Assert.Single(item.Attachments ?? []);
        Assert.Equal("grafik.pdf", attachment.FileName);
        Assert.Equal(182400, attachment.FileSize);
    }

    // ---- Задачи: комментарии, обсуждение, вложения ----

    [Fact]
    public async Task TaskCommentsGetParsesArchiveList()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/comments" => Json(
                    """{"items":[{"id":"c-1","task_id":"5","user_id":9,"username":"lead","full_name":"Lead User","body":"Первый","created_at":"2026-11-19T10:00:00+00:00"},{"id":"c-2","task_id":"5","user_id":7,"username":"tester","full_name":"Test User","body":"Второй","created_at":"2026-11-19T11:00:00+00:00"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var list = await client.GetTaskCommentsAsync(5, CancellationToken.None);

        Assert.Equal(2, list.Items?.Count);
        var first = list.Items![0];
        Assert.Equal("c-1", first.Id);
        Assert.Equal("Lead User", first.FullName);
        Assert.Equal("Первый", first.Body);
        Assert.Equal(new DateTimeOffset(2026, 11, 19, 10, 0, 0, TimeSpan.Zero), first.CreatedAt);
        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/hub/tasks/5/comments");
        Assert.Equal("GET", request.Method);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TaskCommentPostsBodyJsonAndParsesCreated()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/comments" when request.Method == "POST" => Json(
                    """{"id":"c-9","task_id":"5","user_id":7,"username":"tester","full_name":"Test User","body":"Привет","created_at":"2026-11-19T12:00:00+00:00"}""",
                    HttpStatusCode.OK),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var created = await client.AddTaskCommentAsync(5, "Привет", CancellationToken.None);

        Assert.Equal("c-9", created.Id);
        Assert.Equal("Привет", created.Body);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/hub/tasks/5/comments");
        // Контракт create_task_comment в hub.py: поле называется body, не text.
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("Привет", payload.RootElement.GetProperty("body").GetString());
        Assert.False(payload.RootElement.TryGetProperty("text", out _));
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TaskCommentsMarkSeenPostsToMarkSeenRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/comments/mark-seen" when request.Method == "POST" =>
                    Json("""{"id":5,"has_unread_comments":false}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.MarkTaskCommentsSeenAsync(5, CancellationToken.None);

        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/tasks/5/comments/mark-seen");
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TaskDiscussionPostsAndParsesConversationId()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/discussion" when request.Method == "POST" => Json(
                    """{"conversation_id":"conv-42","created":true,"title":"Задача: Fix pump","task_id":"5","task_title":"Fix pump","task_status":"in_progress","kind":"task"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var discussion = await client.OpenTaskDiscussionAsync(5, CancellationToken.None);

        Assert.Equal("conv-42", discussion.ConversationId);
        Assert.True(discussion.Created);
        Assert.Equal("task", discussion.Kind);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/hub/tasks/5/discussion");
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TaskAttachmentUploadPostsMultipartAndDeleteHitsRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/attachments" when request.Method == "POST" => Json(
                    """{"id":"att-7","task_id":"5","scope":"task","file_name":"spec.pdf","file_mime":"application/octet-stream","file_size":13,"uploaded_by_user_id":7,"uploaded_by_username":"tester","uploaded_at":"2026-11-19T10:00:00+00:00"}"""),
                "/api/v1/hub/tasks/5/attachments/att-7" when request.Method == "DELETE" =>
                    Json("""{"deleted":true,"id":"att-7"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // Контракт upload_task_attachment: единственное multipart-поле — file.
        await using var content = new MemoryStream(Encoding.UTF8.GetBytes("fake pdf body"));
        var uploaded = await client.UploadTaskAttachmentAsync(
            5, "spec.pdf", content, mimeType: null, CancellationToken.None);

        Assert.Equal("att-7", uploaded.Id);
        Assert.Equal("task", uploaded.Scope);
        Assert.Equal("spec.pdf", uploaded.FileName);
        Assert.Equal(13, uploaded.FileSize);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/tasks/5/attachments");
        Assert.StartsWith("multipart/form-data", post.ContentType ?? string.Empty);
        // Сериализация Content-Disposition может быть с кавычками или без —
        // нормализуем и проверяем сам контракт полей.
        var body = (post.Body ?? string.Empty).Replace("\"", string.Empty);
        Assert.Contains("name=file;", body);
        Assert.Contains("filename=spec.pdf", body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);

        await client.DeleteTaskAttachmentAsync(5, "att-7", CancellationToken.None);

        Assert.Equal(1, handler.Count("DELETE", "/api/v1/hub/tasks/5/attachments/att-7"));
    }

    [Fact]
    public async Task TaskAttachmentDownloadStreamsToDestinationAndReadsFileName()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/5/attachments/att-7/file" => new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = FileDownload("attachment; filename=\"spec.pdf\""),
                },
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await using var destination = new MemoryStream();
        var fileName = await client.DownloadTaskAttachmentAsync(
            5, "att-7", destination, CancellationToken.None);

        Assert.Equal("spec.pdf", fileName);
        Assert.Equal("file-body", Encoding.UTF8.GetString(destination.ToArray()));
        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/hub/tasks/5/attachments/att-7/file");
        Assert.Equal("GET", request.Method);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task TaskAttachmentPreviewRetriesAcceptedUntilPdfIsReady()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var previewCalls = 0;
        var handler = new StubHttpMessageHandler((request, _) =>
        {
            if (request.Path == "/api/v1/hub/tasks/5/attachments/att-7/preview/pdf")
            {
                previewCalls += 1;
                if (previewCalls == 1)
                {
                    var pending = new HttpResponseMessage(HttpStatusCode.Accepted)
                    {
                        Content = new StringContent(
                            """{"status":"queued","retry_after_ms":500}""",
                            Encoding.UTF8,
                            "application/json"),
                    };
                    pending.Headers.TryAddWithoutValidation("Retry-After", "0");
                    return Task.FromResult(pending);
                }

                return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = FileDownload("inline; filename=\"spec-preview.pdf\""),
                });
            }

            return Task.FromResult(request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            });
        });
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await using var destination = new MemoryStream();
        var fileName = await client.DownloadTaskAttachmentPreviewPdfAsync(
            5, "att-7", destination, CancellationToken.None);

        Assert.Equal("spec-preview.pdf", fileName);
        Assert.Equal("file-body", Encoding.UTF8.GetString(destination.ToArray()));
        Assert.Equal(2, previewCalls);
    }

    // ---- Почта: папки (создание/переименование/удаление/избранное) и AI-действия ----

    [Fact]
    public async Task MailFolderCreatePostsSnakeCaseBodyAndParsesNode()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/folders" when request.Method == "POST" => Json(
                    """{"id":"custom-9","name":"Проекты","label":"Проекты","scope":"mailbox","icon_key":"folder","well_known_key":null,"parent_id":"custom-1","is_favorite":false,"is_distinguished":false,"can_rename":true,"can_delete":true,"can_create_children":true,"total":0,"unread":0,"child_folder_count":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var folder = await client.CreateMailFolderAsync(
            "mb-1", "Проекты", "custom-1", "mailbox", CancellationToken.None);

        Assert.Equal("custom-9", folder.Id);
        Assert.Equal("Проекты", folder.Label);
        Assert.Equal("custom-1", folder.ParentId);
        Assert.True(folder.CanRename);
        Assert.True(folder.CanDelete);
        Assert.True(folder.CanCreateChildren);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/mail/folders");
        // Контракт FolderCreatePayload (mail.py): mailbox_id, name, parent_folder_id, scope.
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("mb-1", payload.RootElement.GetProperty("mailbox_id").GetString());
        Assert.Equal("Проекты", payload.RootElement.GetProperty("name").GetString());
        Assert.Equal("custom-1", payload.RootElement.GetProperty("parent_folder_id").GetString());
        Assert.Equal("mailbox", payload.RootElement.GetProperty("scope").GetString());
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailFolderRenamePatchesNameWithMailboxQuery()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/folders/custom-9" when request.Method == "PATCH" => Json(
                    """{"id":"custom-9","name":"Новое","label":"Новое","scope":"mailbox","icon_key":"folder","can_rename":true,"can_delete":true,"total":0,"unread":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var folder = await client.RenameMailFolderAsync(
            "custom-9", "mb-1", "Новое", CancellationToken.None);

        Assert.Equal("Новое", folder.Label);
        var patch = Assert.Single(handler.Requests,
            request => request.Method == "PATCH"
                && request.Path == "/api/v1/mail/folders/custom-9");
        // mailbox_id уходит query-параметром, в теле только {name} — контракт FolderRenamePayload.
        Assert.Contains("mailbox_id=mb-1", patch.Query);
        using var payload = System.Text.Json.JsonDocument.Parse(patch.Body ?? "{}");
        Assert.Equal("Новое", payload.RootElement.GetProperty("name").GetString());
        Assert.False(payload.RootElement.TryGetProperty("mailbox_id", out _));
        Assert.StartsWith("Bearer ", patch.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailFolderDeleteHitsRouteWithMailboxQuery()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/folders/custom-9" when request.Method == "DELETE" =>
                    Json("""{"ok":true,"folder_id":"custom-9"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.DeleteMailFolderAsync("custom-9", "mb-1", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("custom-9", result.FolderId);
        var delete = Assert.Single(handler.Requests,
            request => request.Method == "DELETE"
                && request.Path == "/api/v1/mail/folders/custom-9");
        Assert.Contains("mailbox_id=mb-1", delete.Query);
        Assert.Null(delete.Body);
        Assert.StartsWith("Bearer ", delete.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailFolderFavoritePostsFlagInBody()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/folders/inbox/favorite" when request.Method == "POST" =>
                    Json("""{"ok":true,"folder_id":"inbox","favorite":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.SetMailFolderFavoriteAsync(
            "inbox", "mb-1", true, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("inbox", result.FolderId);
        Assert.True(result.Favorite);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/folders/inbox/favorite");
        // Контракт FolderFavoritePayload: mailbox_id и favorite в JSON-теле.
        Assert.Equal(string.Empty, post.Query);
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("mb-1", payload.RootElement.GetProperty("mailbox_id").GetString());
        Assert.True(payload.RootElement.GetProperty("favorite").GetBoolean());
    }

    [Fact]
    public async Task MailImportancePostsImportanceAndMailboxInBody()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/messages/m-1/importance" when request.Method == "POST" =>
                    Json("""{"ok":true,"importance":"high"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.SetMailMessageImportanceAsync(
            "m-1", "mb-1", "high", CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("high", result.Importance);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/messages/m-1/importance");
        // Контракт MessageImportancePayload: {importance, mailbox_id} в теле (не query).
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("high", payload.RootElement.GetProperty("importance").GetString());
        Assert.Equal("mb-1", payload.RootElement.GetProperty("mailbox_id").GetString());
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailSummarizePostsWithMailboxQueryAndParsesSummary()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/messages/m-1/summarize" when request.Method == "POST" =>
                    Json("""{"summary":"Кратко о письме"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.SummarizeMailMessageAsync(
            "m-1", "mb-1", CancellationToken.None);

        Assert.Equal("Кратко о письме", result.Summary);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/messages/m-1/summarize");
        Assert.Contains("mailbox_id=mb-1", post.Query);
        Assert.Null(post.Body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailSmartRepliesPostsWithMailboxQueryAndParsesSuggestions()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/messages/m-1/smart-replies" when request.Method == "POST" =>
                    Json("""{"suggestions":["Да","Нет","Позже"]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.GetMailSmartRepliesAsync(
            "m-1", "mb-1", CancellationToken.None);

        Assert.Equal(["Да", "Нет", "Позже"], result.Suggestions ?? []);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/messages/m-1/smart-replies");
        Assert.Contains("mailbox_id=mb-1", post.Query);
        Assert.Null(post.Body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    // ---- Почта: шаблоны IT-заявок и send-it-request ----

    [Fact]
    public async Task MailTemplatesGetHitsRouteAndParsesFields()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/templates" => Json(
                    """{"items":[{"id":"tpl-1","code":"printer","title":"Замена картриджа","category":"Оргтехника","subject_template":"Картридж {{model}}","body_template_md":"Модель: {{model}}","is_active":true,"fields":[{"key":"model","label":"Модель","type":"text","required":true,"placeholder":"","help_text":"","default_value":"","options":[],"order":0},{"key":"kind","label":"Тип","type":"select","required":false,"options":["ч/б","цвет"],"default_value":"ч/б","order":1}]}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var templates = await client.GetMailTemplatesAsync(false, CancellationToken.None);

        var template = Assert.Single(templates);
        Assert.Equal("tpl-1", template.Id);
        Assert.Equal("Замена картриджа", template.Title);
        Assert.Equal("printer", template.Code);
        Assert.True(template.IsActive);
        Assert.Equal(2, template.Fields?.Count);
        Assert.Equal("model", template.Fields![0].Key);
        Assert.Equal("text", template.Fields[0].Type);
        Assert.True(template.Fields[0].Required);
        Assert.Equal("select", template.Fields[1].Type);
        Assert.Equal(
            new[] { "ч/б", "цвет" },
            (template.Fields[1].Options ?? []).ToArray());
        var get = Assert.Single(handler.Requests,
            request => request.Method == "GET" && request.Path == "/api/v1/mail/templates");
        // Контракт list_it_templates: include_inactive=false → только активные.
        Assert.Contains("include_inactive=false", get.Query);
        Assert.StartsWith("Bearer ", get.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailItRequestWithoutFilesPostsJsonPayload()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/messages/send-it-request" when request.Method == "POST" =>
                    Json("""{"ok":true,"message_id":"msg-77","subject":"Заявка"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var fields = new Dictionary<string, object?>
        {
            ["model"] = "HP M404",
            ["urgent"] = true,
            ["colors"] = new List<string> { "cyan", "magenta" },
        };
        var result = await client.SendMailItRequestAsync("tpl-1", fields, CancellationToken.None);

        Assert.True(result.Ok);
        Assert.Equal("msg-77", result.MessageId);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/messages/send-it-request");
        // Контракт SendItRequestPayload: {template_id, fields{…}} — JSON, не форма.
        Assert.Equal("application/json; charset=utf-8", post.ContentType);
        using var payload = System.Text.Json.JsonDocument.Parse(post.Body ?? "{}");
        Assert.Equal("tpl-1", payload.RootElement.GetProperty("template_id").GetString());
        var fieldsJson = payload.RootElement.GetProperty("fields");
        Assert.Equal("HP M404", fieldsJson.GetProperty("model").GetString());
        Assert.True(fieldsJson.GetProperty("urgent").GetBoolean());
        Assert.Equal(
            new[] { "cyan", "magenta" },
            fieldsJson.GetProperty("colors").EnumerateArray()
                .Select(item => item.GetString() ?? string.Empty).ToArray());
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailItRequestWithFilesPostsMultipartFieldsJsonAndFiles()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/mail/messages/send-it-request-multipart" when request.Method == "POST" =>
                    Json("""{"ok":true,"message_id":"msg-78"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var attachments = new List<HubMailOutgoingAttachment>
        {
            new()
            {
                FileName = "spec.txt",
                ContentType = "text/plain",
                Content = new ReadOnlyMemory<byte>(Encoding.UTF8.GetBytes("body-1")),
            },
        };
        var fields = new Dictionary<string, object?> { ["model"] = "HP M404" };
        var result = await client.SendMailItRequestMultipartAsync(
            "tpl-2", fields, attachments, CancellationToken.None);

        Assert.True(result.Ok);
        var post = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/mail/messages/send-it-request-multipart");
        Assert.StartsWith("multipart/form-data", post.ContentType ?? string.Empty);
        var body = post.Body ?? string.Empty;
        // Контракт: template_id и fields_json — поля формы, файлы — повторяющееся files[].
        // .NET пишет name=<token> без кавычек для валидных token-имён.
        Assert.Contains("name=template_id", body);
        Assert.Contains("tpl-2", body);
        Assert.Contains("name=fields_json", body);
        // fields_json — сериализованный словарь полей заявки.
        Assert.Contains("\"model\"", body);
        Assert.Contains("HP M404", body);
        Assert.Contains("name=\"files\"; filename=\"spec.txt\"", body);
        Assert.Contains("body-1", body);
        Assert.StartsWith("Bearer ", post.Authorization ?? string.Empty);
    }

    // ---- Задачи: аналитика (GET /hub/tasks/analytics + /export) ----

    [Fact]
    public async Task TaskAnalyticsSendsDatesBasisAndRepeatedListParams()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/analytics" => Json(
                    """{"summary":{"total":4,"open":3,"done":1,"overdue":1,"done_on_time":1,"done_without_due":0,"with_due_total":3,"completion_percent":25.0,"completion_on_time_percent":33.3},"status_breakdown":[{"status":"new","label":"Новые","value":2},{"status":"done","label":"Выполнено","value":1}],"by_participant":[{"participant_user_id":11,"participant_name":"Иванов И.И.","total":4,"open":3,"done":1,"overdue":1}],"by_project":[{"project_id":"p-1","project_name":"Проект А","total":4,"open":3,"done":1}],"by_object":[{"object_id":"o-1","object_name":"Насосная","total":2,"open":2}],"trend":{"granularity":"day","items":[{"bucket_key":"2025-01-01","bucket_label":"01.01","created":2,"completed":1,"completed_on_time":1}]},"truncated":true,"filters":{"date_basis":"due_at"}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var payload = await client.GetTaskAnalyticsAsync(
            new HubTaskAnalyticsQuery
            {
                StartDate = "2025-01-01",
                EndDate = "2025-01-30",
                DateBasis = "due_at",
                ProjectIds = ["p-1", "p-2"],
                ObjectIds = ["o-1"],
                ParticipantUserIds = [11, 22],
            },
            CancellationToken.None);

        // Контракт hub.py: даты/basis одиночные, list[...] — повторяющимися параметрами.
        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/hub/tasks/analytics");
        Assert.Equal("GET", request.Method);
        Assert.Contains("start_date=2025-01-01", request.Query);
        Assert.Contains("end_date=2025-01-30", request.Query);
        Assert.Contains("date_basis=due_at", request.Query);
        Assert.Contains("project_id=p-1", request.Query);
        Assert.Contains("project_id=p-2", request.Query);
        Assert.Contains("object_id=o-1", request.Query);
        Assert.Contains("participant_user_id=11", request.Query);
        Assert.Contains("participant_user_id=22", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);

        // Толерантный разбор payload: summary + разрезы + trend + truncated.
        Assert.Equal(4, payload.Summary?.Total);
        Assert.Equal(3, payload.Summary?.Open);
        Assert.Equal(33.3, payload.Summary?.CompletionOnTimePercent);
        Assert.Equal(2, payload.StatusBreakdown?.Count);
        Assert.Equal("Иванов И.И.", payload.ByParticipant?[0].ParticipantName);
        Assert.Equal("Проект А", payload.ByProject?[0].ProjectName);
        Assert.Equal("Насосная", payload.ByObject?[0].ObjectName);
        Assert.Equal("day", payload.Trend?.Granularity);
        Assert.Equal(1, Assert.Single(payload.Trend?.Items ?? []).CompletedOnTime);
        Assert.True(payload.Truncated);
    }

    [Fact]
    public async Task TaskAnalyticsExportStreamsToDestinationAndReadsFileName()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/hub/tasks/analytics/export" => new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = FileDownload("attachment; filename=\"task_analytics_20250130.xlsx\""),
                },
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await using var destination = new MemoryStream();
        var fileName = await client.ExportTaskAnalyticsAsync(
            new HubTaskAnalyticsQuery { DateBasis = "completed_at" },
            destination,
            CancellationToken.None);

        Assert.Equal("task_analytics_20250130.xlsx", fileName);
        Assert.Equal("file-body", Encoding.UTF8.GetString(destination.ToArray()));
        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/hub/tasks/analytics/export");
        Assert.Equal("GET", request.Method);
        Assert.Contains("date_basis=completed_at", request.Query);
        // Пустые даты и списки не уходят — только дефолтный набор параметров.
        Assert.DoesNotContain("start_date", request.Query);
        Assert.DoesNotContain("project_id", request.Query);
    }

    // ---- Квоты почтовых ящиков: GET /mail/mailbox-quota-snapshots* ----

    [Fact]
    public async Task MailQuotaLatestAndSnapshotsHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/mail/mailbox-quota-snapshots/latest" => Json(
                    """{"id":7,"imported_at":"2026-11-19T09:00:00+03:00","collected_at":"2026-11-19T08:55:00+03:00","source_host":"exch-01","exchange_server":"EXCH-01","row_count":3}"""),
                "/api/v1/mail/mailbox-quota-snapshots" => Json(
                    """[{"id":7,"imported_at":"2026-11-19T09:00:00+03:00","collected_at":"2026-11-19T08:55:00+03:00","source_host":"exch-01","exchange_server":"EXCH-01","row_count":3},{"id":6,"imported_at":"2026-11-18T09:00:00+03:00","collected_at":null,"source_host":"exch-01","exchange_server":"EXCH-01","row_count":2}]"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var latest = await client.GetLatestMailQuotaSnapshotAsync(CancellationToken.None);
        var snapshots = await client.GetMailQuotaSnapshotsAsync(20, CancellationToken.None);

        Assert.Equal(7, latest.Id);
        Assert.Equal("2026-11-19T08:55:00+03:00", latest.CollectedAt);
        Assert.Equal("exch-01", latest.SourceHost);
        Assert.Equal("EXCH-01", latest.ExchangeServer);
        Assert.Equal(3, latest.RowCount);
        Assert.Equal(2, snapshots.Count);
        Assert.Null(snapshots[1].CollectedAt);

        Assert.Equal(1, handler.Count("GET", "/api/v1/mail/mailbox-quota-snapshots/latest"));
        var list = Assert.Single(handler.Requests,
            request => request.Method == "GET"
                && request.Path == "/api/v1/mail/mailbox-quota-snapshots");
        Assert.Equal("?limit=20", list.Query);
        Assert.StartsWith("Bearer ", list.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailQuotaSummaryHitsNestedRouteAndParsesStats()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/mail/mailbox-quota-snapshots/7/summary" => Json(
                    """{"snapshot_id":7,"total":3,"with_quota":2,"no_quota":1,"over_quota":1,"warning_90":1,"by_database":[{"name":"DB1","total":3,"over_quota":1,"warning_90":1},{"name":"DB2","total":0,"over_quota":0,"warning_90":0}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var stats = await client.GetMailQuotaSnapshotSummaryAsync(7, CancellationToken.None);

        Assert.Equal(7, stats.SnapshotId);
        Assert.Equal(3, stats.Total);
        Assert.Equal(2, stats.WithQuota);
        Assert.Equal(1, stats.NoQuota);
        Assert.Equal(1, stats.OverQuota);
        Assert.Equal(1, stats.Warning90);
        Assert.Equal(2, stats.ByDatabase?.Count);
        Assert.Equal("DB1", stats.ByDatabase![0].Name);
        Assert.Equal(1, stats.ByDatabase[0].OverQuota);

        var request = Assert.Single(handler.Requests,
            request => request.Method == "GET"
                && request.Path == "/api/v1/mail/mailbox-quota-snapshots/7/summary");
        Assert.Equal(string.Empty, request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailQuotaRowsSendsFullContractQuery()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/mail/mailbox-quota-snapshots/7/rows" => Json(
                    """{"items":[{"id":11,"email":"full@zsgp.ru","display_name":"Полный Ящик","upn":"full@zsgp.ru","mailbox_type":"User","used_bytes":6442450944,"quota_bytes":5368709120,"free_bytes":0,"used_percent":120.0,"database_name":"DB1","uses_default_quota":false},{"id":12,"email":"plain@zsgp.ru","display_name":null,"upn":null,"mailbox_type":null,"used_bytes":null,"quota_bytes":null,"free_bytes":null,"used_percent":null,"database_name":"DB2","uses_default_quota":true}],"total":150,"snapshot":{"id":7,"imported_at":"2026-11-19T09:00:00+03:00","collected_at":null,"source_host":"exch-01","exchange_server":"EXCH-01","row_count":150}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetMailQuotaRowsAsync(
            7,
            new HubMailQuotaRowsQuery
            {
                Search = "full@zsgp.ru",
                OverQuota = true,
                DatabaseName = "DB1",
                Limit = 100,
                Offset = 50,
            },
            CancellationToken.None);

        Assert.Equal(150, page.Total);
        Assert.Equal(7, page.Snapshot?.Id);
        Assert.Equal(2, page.Items?.Count);
        var first = page.Items![0];
        Assert.Equal("full@zsgp.ru", first.Email);
        Assert.Equal(6442450944L, first.UsedBytes);
        Assert.Equal(120.0, first.UsedPercent);
        var second = page.Items[1];
        // Nullable-поля бэкенда остаются null — «неизвестно», не ноль.
        Assert.Null(second.UsedBytes);
        Assert.Null(second.QuotaBytes);
        Assert.Null(second.UsedPercent);
        Assert.True(second.UsesDefaultQuota);

        var request = Assert.Single(handler.Requests,
            request => request.Method == "GET"
                && request.Path == "/api/v1/mail/mailbox-quota-snapshots/7/rows");
        // Имена параметров — как у роута backend/api/v1/mailbox_quota.py.
        Assert.Contains("search=full%40zsgp.ru", request.Query);
        Assert.Contains("over_quota=true", request.Query);
        Assert.Contains("database_name=DB1", request.Query);
        Assert.Contains("limit=100", request.Query);
        Assert.Contains("offset=50", request.Query);
        // Флаги false не уходят — дефолт сервера.
        Assert.DoesNotContain("warning_90", request.Query);
        Assert.DoesNotContain("no_quota", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task MailQuotaRowsOmitsEmptyFilters()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/mail/mailbox-quota-snapshots/7/rows" => Json(
                    """{"items":[],"total":0,"snapshot":null}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetMailQuotaRowsAsync(
            7, new HubMailQuotaRowsQuery(), CancellationToken.None);

        Assert.Empty(page.Items ?? []);
        var request = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/mail/mailbox-quota-snapshots/7/rows");
        Assert.DoesNotContain("search", request.Query);
        Assert.DoesNotContain("over_quota", request.Query);
        Assert.DoesNotContain("warning_90", request.Query);
        Assert.DoesNotContain("no_quota", request.Query);
        Assert.DoesNotContain("database_name", request.Query);
        Assert.Contains("limit=100", request.Query);
        Assert.Contains("offset=0", request.Query);
    }

    [Fact]
    public async Task ManagedAnnouncementsSendsStatusAndFilters()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/manage" => Json(
                    """{"items":[{"id":"n-1","title":"Релиз","preview":"Коротко","body":"Тело","priority":"urgent","status":"draft","author_full_name":"Автор Авторов","requires_ack":true,"is_pinned":false,"can_manage":true,"created_at":"2026-11-19T09:00:00+00:00","published_at":null,"updated_at":null,"category":{"id":"4","name":"ИТ","slug":"it"},"tags":[{"id":"1","name":"релиз","slug":"reliz"}],"attachments":[{"id":"a-1","file_name":"spec.pdf","file_size":10}]}],"total":5}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetManagedAnnouncementsAsync(
            new HubAnnouncementManageQuery
            {
                Status = "draft",
                Search = "релиз",
                CategoryId = "4",
                Tag = "it",
                Limit = 50,
                Offset = 100,
            },
            CancellationToken.None);

        Assert.Equal(5, page.Total);
        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("n-1", item.Id);
        Assert.Equal("Релиз", item.Title);
        Assert.Equal("draft", item.Status);
        Assert.Equal("urgent", item.Priority);
        Assert.True(item.RequiresAck);
        Assert.True(item.CanManage);
        Assert.Equal("Автор Авторов", item.AuthorFullName);
        Assert.Equal("4", item.Category?.Id);
        Assert.Equal("ИТ", item.Category?.Name);
        Assert.Equal("релиз", Assert.Single(item.Tags ?? []).Name);
        Assert.Equal("spec.pdf", Assert.Single(item.Attachments ?? []).FileName);

        var request = Assert.Single(handler.Requests,
            request => request.Method == "GET"
                && request.Path == "/api/v1/hub/announcements/manage");
        Assert.Contains("status=draft", request.Query);
        Assert.Contains("q=%D1%80%D0%B5%D0%BB%D0%B8%D0%B7", request.Query);
        Assert.Contains("category_id=4", request.Query);
        Assert.Contains("tag=it", request.Query);
        Assert.Contains("limit=50", request.Query);
        Assert.Contains("offset=100", request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);
    }

    [Fact]
    public async Task ManagedAnnouncementsOmitsEmptyFilters()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/manage" => Json("""{"items":[],"total":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.GetManagedAnnouncementsAsync(
            new HubAnnouncementManageQuery(), CancellationToken.None);

        var request = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/hub/announcements/manage");
        Assert.DoesNotContain("status", request.Query);
        Assert.DoesNotContain("q=", request.Query);
        Assert.DoesNotContain("category_id", request.Query);
        Assert.DoesNotContain("tag", request.Query);
        Assert.Contains("limit=100", request.Query);
        Assert.Contains("offset=0", request.Query);
    }

    [Fact]
    public async Task AnnouncementCreateWithoutFilesPostsJson()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements" => Json(
                    """{"id":"n-9","title":"Новая","status":"published","priority":"normal","requires_ack":false,"is_pinned":true,"can_manage":true}""",
                    HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var item = await client.CreateAnnouncementAsync(
            new HubAnnouncementCreateRequest
            {
                Title = "Новая",
                Preview = "Превью",
                Body = "Тело",
                Priority = "normal",
                RequiresAck = false,
                IsPinned = true,
                CategoryId = "2",
                Tags = ["один", "два"],
            },
            files: null,
            CancellationToken.None);

        Assert.Equal("n-9", item.Id);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/announcements");
        Assert.StartsWith("application/json", request.ContentType ?? string.Empty);
        // Кириллица уходит как \uXXXX — проверяем распарсенные поля, а не подстроки.
        using var json = System.Text.Json.JsonDocument.Parse(request.Body ?? "{}");
        var root = json.RootElement;
        Assert.Equal("Новая", root.GetProperty("title").GetString());
        Assert.Equal("normal", root.GetProperty("priority").GetString());
        Assert.False(root.GetProperty("requires_ack").GetBoolean());
        Assert.True(root.GetProperty("is_pinned").GetBoolean());
        Assert.Equal("2", root.GetProperty("category_id").GetString());
        Assert.Equal(
            ["один", "два"],
            root.GetProperty("tags").EnumerateArray()
                .Select(e => e.GetString() ?? string.Empty).ToArray());
    }

    [Fact]
    public async Task AnnouncementCreateWithFilesPostsMultipart()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements" => Json(
                    """{"id":"n-10","title":"С файлами","status":"published","can_manage":true}""",
                    HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var item = await client.CreateAnnouncementAsync(
            new HubAnnouncementCreateRequest
            {
                Title = "С файлами",
                Tags = ["release"],
            },
            files:
            [
                new HubAnnouncementOutgoingFile
                {
                    FileName = "a.pdf",
                    ContentType = "application/pdf",
                    Content = new byte[] { 1, 2, 3 },
                },
                new HubAnnouncementOutgoingFile
                {
                    FileName = "b.txt",
                    ContentType = "text/plain",
                    Content = new byte[] { 4, 5 },
                },
            ],
            CancellationToken.None);

        Assert.Equal("n-10", item.Id);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/announcements");
        Assert.StartsWith("multipart/form-data", request.ContentType ?? string.Empty);
        // Content-Disposition сериализуется с кавычками — нормализуем, как соседние тесты.
        var body = (request.Body ?? string.Empty).Replace("\"", string.Empty);
        Assert.Contains("name=title", body);
        Assert.Contains("С файлами", body);
        Assert.Contains("name=tags", body);
        Assert.Contains("[release]", body);
        Assert.Equal(2, System.Text.RegularExpressions.Regex.Matches(body, "name=files").Count);
        Assert.Contains("filename=a.pdf", body);
        Assert.Contains("filename=b.txt", body);
    }

    [Fact]
    public async Task AnnouncementDraftPostsToDraftsRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/drafts" => Json(
                    """{"id":"n-11","title":"Черновик","status":"draft","can_manage":true}""",
                    HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var item = await client.CreateAnnouncementDraftAsync(
            new HubAnnouncementCreateRequest { Title = "Черновик", Body = "Черновое тело" },
            CancellationToken.None);

        Assert.Equal("n-11", item.Id);
        Assert.Equal("draft", item.Status);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/announcements/drafts");
        Assert.StartsWith("application/json", request.ContentType ?? string.Empty);
        using var json = System.Text.Json.JsonDocument.Parse(request.Body ?? "{}");
        Assert.Equal("Черновик", json.RootElement.GetProperty("title").GetString());
        Assert.Equal("Черновое тело", json.RootElement.GetProperty("body").GetString());
        Assert.DoesNotContain("files", request.Body ?? string.Empty);
    }

    [Fact]
    public async Task AnnouncementPatchSendsOnlyChangedFields()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/n-1" => Json(
                    """{"id":"n-1","title":"Новый заголовок","status":"draft","requires_ack":true,"can_manage":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var item = await client.UpdateAnnouncementAsync(
            "n-1",
            new HubAnnouncementUpdateRequest
            {
                Title = "Новый заголовок",
                RequiresAck = true,
            },
            CancellationToken.None);

        Assert.Equal("Новый заголовок", item.Title);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "PATCH"
                && request.Path == "/api/v1/hub/announcements/n-1");
        using var json = System.Text.Json.JsonDocument.Parse(request.Body ?? "{}");
        var root = json.RootElement;
        Assert.Equal("Новый заголовок", root.GetProperty("title").GetString());
        Assert.True(root.GetProperty("requires_ack").GetBoolean());
        // exclude_unset: нетронутые поля не сериализуются — backend меняет только присланные ключи.
        Assert.False(root.TryGetProperty("preview", out _));
        Assert.False(root.TryGetProperty("body", out _));
        Assert.False(root.TryGetProperty("priority", out _));
        Assert.False(root.TryGetProperty("category_id", out _));
        Assert.False(root.TryGetProperty("tags", out _));
        Assert.False(root.TryGetProperty("is_pinned", out _));
        Assert.False(root.TryGetProperty("status", out _));
    }

    [Fact]
    public async Task AnnouncementPublishArchiveDeleteHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/n-1/publish" => Json(
                    """{"id":"n-1","title":"T","status":"published","can_manage":true}"""),
                "/api/v1/hub/announcements/n-1/archive" => Json(
                    """{"id":"n-1","title":"T","status":"archived","can_manage":true}"""),
                "/api/v1/hub/announcements/n-1" => new HttpResponseMessage(HttpStatusCode.NoContent),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var published = await client.PublishAnnouncementAsync("n-1", CancellationToken.None);
        var archived = await client.ArchiveAnnouncementAsync("n-1", CancellationToken.None);
        await client.DeleteManagedAnnouncementAsync("n-1", CancellationToken.None);

        Assert.Equal("published", published.Status);
        Assert.Equal("archived", archived.Status);
        Assert.Equal(1, handler.Count("POST", "/api/v1/hub/announcements/n-1/publish"));
        Assert.Equal(1, handler.Count("POST", "/api/v1/hub/announcements/n-1/archive"));
        Assert.Equal(1, handler.Count("DELETE", "/api/v1/hub/announcements/n-1"));
    }

    [Fact]
    public async Task AnnouncementCategoriesAndTagsHitExpectedRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcement-categories" => Json(
                    """{"items":[{"id":"1","name":"Общее","slug":"obshee"},{"id":"2","name":"ИТ","slug":"it"}]}"""),
                "/api/v1/hub/announcement-tags" => Json(
                    """{"items":[{"id":"7","name":"релиз","slug":"reliz","usage_count":3}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var categories = await client.GetAnnouncementCategoriesAsync(
            includeInactive: true, CancellationToken.None);
        var tags = await client.GetAnnouncementTagsAsync(CancellationToken.None);

        Assert.Equal(2, categories.Items?.Count);
        Assert.Equal("ИТ", categories.Items![1].Name);
        Assert.Equal("1", categories.Items[0].Id);
        Assert.Equal("релиз", Assert.Single(tags.Items ?? []).Name);

        var categoriesRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/hub/announcement-categories");
        Assert.Contains("include_inactive=true", categoriesRequest.Query);
        Assert.Equal(1, handler.Count("GET", "/api/v1/hub/announcement-tags"));
    }

    [Fact]
    public async Task AnnouncementCategoryCreatePostsName()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcement-categories" => Json(
                    """{"id":"9","name":"Новая категория","slug":"novaya-kategoriya","is_active":true}""",
                    HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var category = await client.CreateAnnouncementCategoryAsync(
            "  Новая категория  ", CancellationToken.None);

        Assert.Equal("9", category.Id);
        Assert.Equal("Новая категория", category.Name);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/announcement-categories");
        using var json = System.Text.Json.JsonDocument.Parse(request.Body ?? "{}");
        // Имя уходит с trim.
        Assert.Equal("Новая категория", json.RootElement.GetProperty("name").GetString());
    }

    [Fact]
    public async Task AnnouncementAttachmentUploadPostsMultipartFile()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/n-1/attachments" => Json(
                    """{"id":"att-1","file_name":"doc.pdf","file_size":3}""",
                    HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var attachment = await client.UploadAnnouncementAttachmentAsync(
            "n-1",
            new HubAnnouncementOutgoingFile
            {
                FileName = "doc.pdf",
                ContentType = "application/pdf",
                Content = new byte[] { 9, 8, 7 },
            },
            CancellationToken.None);

        Assert.Equal("att-1", attachment.Id);
        Assert.Equal("doc.pdf", attachment.FileName);
        var request = Assert.Single(handler.Requests,
            request => request.Method == "POST"
                && request.Path == "/api/v1/hub/announcements/n-1/attachments");
        Assert.StartsWith("multipart/form-data", request.ContentType ?? string.Empty);
        var body = (request.Body ?? string.Empty).Replace("\"", string.Empty);
        Assert.Contains("name=file;", body);
        Assert.Contains("filename=doc.pdf", body);
    }

    [Fact]
    public async Task AnnouncementAnalyticsParsesSummary()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/hub/announcements/n-1/analytics" => Json(
                    """{"items":[{"user_id":7,"username":"reader","full_name":"Читатель","read_at":"2026-11-19T09:00:00+00:00","acknowledged_at":null,"is_seen":true,"is_acknowledged":false}],"summary":{"recipients_total":12,"seen_total":5,"ack_total":3,"pending_ack_total":9,"comments_total":2}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var analytics = await client.GetAnnouncementAnalyticsAsync("n-1", CancellationToken.None);

        Assert.Equal(12, analytics.Summary?.RecipientsTotal);
        Assert.Equal(5, analytics.Summary?.SeenTotal);
        Assert.Equal(9, analytics.Summary?.PendingAckTotal);
        var reader = Assert.Single(analytics.Items ?? []);
        Assert.Equal(7, reader.UserId);
        Assert.Equal("Читатель", reader.FullName);
        Assert.True(reader.IsSeen);
        Assert.Equal(1, handler.Count("GET", "/api/v1/hub/announcements/n-1/analytics"));
    }

    // ---- Строительство ----

    [Fact]
    public async Task ConstructionObjectsSendsContractQueryAndParsesPortfolio()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/construction/objects" => Json("""
                    {"items":[{"object_ref":"grp-1","name":"ЖК Северный","kind":"project",
                     "request_count":42,"requests_last_30_days":5,"posted_count":30,
                     "latest_request_at":"2026-11-10T08:30:00Z","latest_request_number":"REQ-104",
                     "department_names":["УМТО"],"responsible_names":["Иван Иванов"],
                     "warehouse_names":["ЦО"],"managed":true,"managed_object_id":"managed:17",
                     "source_groups":[{"group_ref":"g1","group_name":"Школа №3","active_request_count":3,"overdue_request_count":1}],
                     "team":[{"role_key":"project_lead","full_name":"Иван Иванов"}]}],
                     "next_cursor":"cur-2","has_more":true,"snapshot_changed":false,
                     "as_of":"2026-11-19T10:00:00Z","scanned_requests":120,
                     "summary":{"project_count":1,"request_count":42,"requests_last_30_days":5,
                                "general_request_count":2,"unassigned_request_count":1},
                     "cache":{"state":"fresh","age_seconds":0},
                     "management_available":true}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetConstructionObjectsAsync(
            new HubConstructionObjectsQuery
            {
                Kind = "project",
                Search = "цех",
                Limit = 24,
                Cursor = "cur-1",
                Refresh = true,
            },
            CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/construction/objects");
        // Имена параметров — как у веб-клиента construction.js (kind/q/limit/cursor/refresh).
        Assert.Equal(
            "?kind=project&limit=24&q=%D1%86%D0%B5%D1%85&cursor=cur-1&refresh=true",
            request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);

        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("grp-1", item.ObjectRef);
        Assert.Equal("managed:17", item.ManagedObjectId);
        Assert.True(item.Managed);
        Assert.Equal(42, item.RequestCount);
        Assert.Equal("Школа №3", Assert.Single(item.SourceGroups ?? []).GroupName);
        Assert.Equal("project_lead", Assert.Single(item.Team ?? []).RoleKey);
        Assert.Equal("cur-2", page.NextCursor);
        Assert.True(page.HasMore);
        Assert.Equal(1, page.Summary?.ProjectCount);
        Assert.Equal("fresh", page.Cache?.State);
        Assert.True(page.ManagementAvailable);
    }

    [Fact]
    public async Task ConstructionObjectDetailHitsObjectRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/construction/objects/managed%3A17" => Json("""
                    {"id":"managed:17","name":"ЖК Северный","kind":"project","managed":true,
                     "is_active":true,
                     "groups":[{"group_ref":"g1","group_name":"Школа №3"}],
                     "team":[{"role_key":"project_lead","employee_code":"E-77",
                              "full_name":"Иван Иванов","position":"Директор","department":"УМТО"}],
                     "role_history":[{"role_key":"project_lead","full_name":"Пётр Петров"}],
                     "created_at":"2026-01-05T00:00:00Z","updated_at":"2026-11-01T00:00:00Z"}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        // object_id с «managed:…» кодируется в путь, как веб-клиент (managed_object_id || object_ref).
        var detail = await client.GetConstructionObjectDetailAsync("managed:17", CancellationToken.None);

        Assert.Equal("managed:17", detail.Id);
        Assert.True(detail.Managed);
        Assert.True(detail.IsActive);
        Assert.Equal("Школа №3", Assert.Single(detail.Groups ?? []).GroupName);
        Assert.Equal("Иван Иванов", Assert.Single(detail.Team ?? []).FullName);
        Assert.Single(detail.RoleHistory ?? []);
        Assert.Equal(1, handler.Count("GET", "/api/v1/construction/objects/managed%3A17"));
    }

    [Fact]
    public async Task ConstructionObjectRequestsSendsViewCursorAndParsesItems()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/construction/objects/grp-1/requests" => Json("""
                    {"items":[{"request_ref":"REQ-1","request_number":"1С-00142",
                     "date":"2026-11-01T09:00:00Z","required_date":"2026-11-20T00:00:00Z",
                     "department_name":"УМТО","responsible_name":"Иван Иванов",
                     "warehouse_name":"ЦО","group_ref":"g1","group_name":"Школа №3",
                     "stage":{"key":"ordered","label":"Заказано поставщику","rank":4},
                     "current_state":{"label":"ordered","description":"Заказ PO-77 размещён",
                                      "document_number":"PO-77","date":"2026-11-03T00:00:00Z"},
                     "is_active":true,"overdue":false,"attention_required":false,
                     "positions_total":3,"progress_label":"Заказано 3 позиции",
                     "nomenclature_items":[{"name":"Кабель ВВГ 3х2.5","characteristic_name":"бухта",
                                            "quantity":12,"unit":"м","section_code":"EL"}],
                     "section_codes":["EL"],"manager_names":["Пётр"],"supplier_names":["ООО Кабель"]}],
                     "next_cursor":"rcur-1","has_more":true,"total":14,"snapshot_changed":false,
                     "source_groups":[{"group_ref":"g1","group_name":"Школа №3"}],
                     "direction_stats":[{"group_ref":"g1","group_name":"Школа №3","active":9,"overdue":2}],
                     "summary":{"total":14,"active":9,"history":5,"overdue":2}}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetConstructionObjectRequestsAsync(
            "grp-1",
            new HubConstructionRequestsQuery
            {
                View = "all",
                Search = "кабель",
                Limit = 50,
                Cursor = "rc-9",
                Refresh = true,
            },
            CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/construction/objects/grp-1/requests");
        Assert.Equal(
            "?view=all&limit=50&q=%D0%BA%D0%B0%D0%B1%D0%B5%D0%BB%D1%8C&cursor=rc-9&refresh=true",
            request.Query);

        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("1С-00142", item.RequestNumber);
        Assert.Equal("ordered", item.Stage?.Key);
        Assert.Equal("Заказано поставщику", item.Stage?.Label);
        Assert.Equal("Заказ PO-77 размещён", item.CurrentState?.Description);
        Assert.Equal(3, item.PositionsTotal);
        Assert.Equal("Кабель ВВГ 3х2.5", Assert.Single(item.NomenclatureItems ?? []).Name);
        Assert.Equal("rcur-1", page.NextCursor);
        Assert.True(page.HasMore);
        Assert.Equal(14, page.Summary?.Total);
        Assert.Equal(9, Assert.Single(page.DirectionStats ?? []).Active);
    }

    // ---- Склад 1С ----

    [Fact]
    public async Task Warehouse1cBalancesSendsFiltersAndParsesEnvelope()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/warehouse-1c/balances" => Json("""
                    {"items":[{"nomenclature_ref":"nom-1","nomenclature_code":"CBL-01",
                     "nomenclature_name":"Кабель ВВГ 3х2.5","characteristic_name":"бухта 100м",
                     "series_ref":"ser-1","series_name":"Серия 7","series_number":"S-7",
                     "warehouse_ref":"wh-1","warehouse_name":"ЦО",
                     "batch_document_name":"Поступление 000-11","batch_status_name":"в наличии",
                     "cost_method_name":"ФИФО","qty_balance":12.5,"cost_balance":18750.0,
                     "cost_accounting_balance":18750.0,"avg_price":1500.0,
                     "torg12_number":"Т-44","torg12_date":"2026-11-01T00:00:00Z",
                     "invoice_number":"СФ-9","invoice_date":"2026-11-02T00:00:00Z"}],
                     "aggregates":{"qty":12.5,"cost":18750.0,"cost_accounting":18750.0},
                     "returned":1,"total":42,"has_more":true,"truncated":false,
                     "as_of":"2026-11-19T10:00:00Z","source":"live","status":"ok"}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetWarehouse1cBalancesAsync(
            new HubWarehouse1cBalancesQuery
            {
                NomenclatureRef = "nom-1",
                WarehouseRef = "wh-1",
                Text = "кабель",
                Limit = 250,
            },
            CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/warehouse-1c/balances");
        // Имена параметров — как у веб-клиента warehouse1c.js.
        Assert.Equal(
            "?include_meta=true&limit=250&nomenclature_ref=nom-1&warehouse_ref=wh-1&q=%D0%BA%D0%B0%D0%B1%D0%B5%D0%BB%D1%8C",
            request.Query);
        Assert.StartsWith("Bearer ", request.Authorization ?? string.Empty);

        var row = Assert.Single(page.Items ?? []);
        Assert.Equal("nom-1", row.NomenclatureRef);
        Assert.Equal("CBL-01", row.NomenclatureCode);
        Assert.Equal(12.5, row.QtyBalance);
        Assert.Equal(18750.0, row.CostBalance);
        Assert.Equal("ser-1", row.SeriesRef);
        Assert.Equal(18750.0, page.Aggregates?.Cost);
        Assert.Equal(42, page.Total);
        Assert.True(page.HasMore);
        Assert.Equal("live", page.Source);
    }

    [Fact]
    public async Task Warehouse1cNomenclatureSearchNormalizesArrayAndEnvelope()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                // Search-роуты отдают то массив, то {items} — клиент берёт оба варианта.
                "/api/v1/warehouse-1c/nomenclature/search" => Json("""
                    [{"ref":"nom-1","code":"CBL-01","name":"Кабель ВВГ"}]
                    """),
                "/api/v1/warehouse-1c/warehouses/search" => Json("""
                    {"items":[{"ref":"wh-1","name":"ЦО"}]}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var nomenclature = await client.SearchWarehouse1cNomenclatureAsync("каб", 20, CancellationToken.None);
        var warehouses = await client.SearchWarehouse1cWarehousesAsync("цо", 20, CancellationToken.None);

        var nomenclatureRequest = handler.Requests.Single(request =>
            request.Path == "/api/v1/warehouse-1c/nomenclature/search");
        Assert.Equal("?limit=20&q=%D0%BA%D0%B0%D0%B1", nomenclatureRequest.Query);
        Assert.Equal("nom-1", Assert.Single(nomenclature).Ref);
        Assert.Equal("wh-1", Assert.Single(warehouses).Ref);
    }

    [Fact]
    public async Task Warehouse1cMovementsSendsCursorDatesAndParsesPage()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/warehouse-1c/movements" => Json("""
                    {"items":[{"registrar_ref":"reg-1","registrar_name":"Поступление товаров и услуг",
                     "registrar_number":"000-77","registrar_date":"2026-11-10T09:00:00Z",
                     "can_open_detail":true,"registrar_document_type":"receipt",
                     "period":"2026-11-10T09:00:00Z","nomenclature_ref":"nom-1",
                     "nomenclature_name":"Кабель ВВГ","warehouse_ref":"wh-1","warehouse_name":"ЦО",
                     "qty_start":0,"qty_end":12,"qty_in":12,"qty_out":0,
                     "cost_end":18000.0,"avg_price_end":1500.0,
                     "is_transfer":false}],
                     "returned":1,"has_more":true,"next_cursor":"mv-2","truncated":false,
                     "as_of":"2026-11-19T10:00:00Z","status":"ok"}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetWarehouse1cMovementsAsync(
            new HubWarehouse1cMovementsQuery
            {
                NomenclatureRef = "nom-1",
                WarehouseRef = "wh-1",
                SeriesRef = "ser-1",
                DateFrom = "2026-11-01",
                DateTo = "2026-11-19",
                Limit = 500,
                Cursor = "mv-1",
            },
            CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/warehouse-1c/movements");
        Assert.Equal(
            "?include_meta=true&limit=500&nomenclature_ref=nom-1&warehouse_ref=wh-1&series_ref=ser-1&date_from=2026-11-01&date_to=2026-11-19&cursor=mv-1",
            request.Query);

        var row = Assert.Single(page.Items ?? []);
        Assert.Equal("reg-1", row.RegistrarRef);
        Assert.True(row.CanOpenDetail);
        Assert.Equal(12, row.QtyIn);
        Assert.Equal("mv-2", page.NextCursor);
        Assert.True(page.HasMore);
    }

    [Fact]
    public async Task Warehouse1cMovementDetailHitsRegistrarRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/warehouse-1c/movements/detail" => Json("""
                    {"registrar_ref":"reg-1","registrar_name":"Перемещение товаров",
                     "registrar_number":"000-5","registrar_date":"2026-11-12T10:00:00Z",
                     "document_type":"transfer","document_title":"Перемещение товаров",
                     "is_transfer":true,"warehouse_ref":"wh-1","warehouse_name":"ЦО",
                     "transfer_from_warehouse_ref":"wh-1","transfer_from_warehouse_name":"ЦО",
                     "transfer_to_warehouse_ref":"wh-2","transfer_to_warehouse_name":"Склад ИТ",
                     "comment":"Перемещение под заявку",
                     "files_status":"ok","files_message":"",
                     "files":[{"ref":"file-1","name":"накладная.pdf","size":10240,"content_type":"application/pdf"}]}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var detail = await client.GetWarehouse1cMovementDetailAsync("reg-1", CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/warehouse-1c/movements/detail");
        Assert.Equal("?registrar_ref=reg-1", request.Query);
        Assert.True(detail.IsTransfer);
        Assert.Equal("Перемещение товаров", detail.DocumentTitle);
        Assert.Equal("Склад ИТ", detail.TransferToWarehouseName);
        var file = Assert.Single(detail.Files ?? []);
        Assert.Equal("file-1", file.Ref);
        Assert.Equal(10240, file.Size);
    }

    [Fact]
    public async Task Warehouse1cItRequestsSendsViewFiltersAndParsesPage()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/warehouse-1c/it-requests" => Json("""
                    {"items":[{"request_ref":"req-1","request_number":"000-ИТ-42",
                     "system_number":"000777","date":"2026-11-05T09:00:00Z",
                     "required_date":"2026-11-25T00:00:00Z","department_name":"ИТ",
                     "initiator_name":"Иван Иванов","responsible_name":"Пётр Петров",
                     "warehouse_ref":"wh-1","warehouse_name":"Склад ИТ",
                     "stage":{"key":"ordered","label":"Заказана","rank":2},
                     "current_state":{"label":"Заказана","description":"Заказ у поставщика",
                                      "document_number":"PO-9","date":"2026-11-07T00:00:00Z"},
                     "is_active":true,"status_group":"active","overdue":true,
                     "attention_required":true,"positions_total":2,
                     "progress_label":"2 позиции в заявке",
                     "journey":[{"key":"created","label":"Заявка","reached":true,"current":false,
                                 "date":"2026-11-05T09:00:00Z","document_number":"000-ИТ-42","missing":false}],
                     "manager_names":["Пётр Петров"],"supplier_names":["ООО Снаб"],
                     "nomenclature_items":[{"name":"SSD 1TB","quantity":4,"unit":"шт"}]}],
                     "groups":[],"warehouse_facets":[{"ref":"wh-1","name":"Склад ИТ","count":3,"overdue_count":1}],
                     "next_cursor":"it-2","has_more":true,"total":7,
                     "as_of":"2026-11-19T10:00:00Z","snapshot_id":"snap-1",
                     "snapshot_changed":false,"truncated":false,"stale":false}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetWarehouse1cItRequestsAsync(
            new HubItRequestsQuery
            {
                View = "history",
                Search = "ssd",
                Stage = "ordered",
                WarehouseRef = "wh-1",
                Overdue = true,
                Limit = 25,
                Cursor = "it-1",
                Refresh = true,
            },
            CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/warehouse-1c/it-requests");
        Assert.Equal(
            "?view=history&limit=25&q=ssd&stage=ordered&warehouse_ref=wh-1&overdue=true&cursor=it-1&refresh=true",
            request.Query);

        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("req-1", item.RequestRef);
        Assert.Equal("ordered", item.Stage?.Key);
        Assert.True(item.Overdue);
        Assert.Equal("Склад ИТ", Assert.Single(page.WarehouseFacets ?? []).Name);
        Assert.Equal("it-2", page.NextCursor);
        Assert.Equal("snap-1", page.SnapshotId);
    }

    [Fact]
    public async Task Warehouse1cDismissedParsesWarehousesWithBalances()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/warehouse-1c/dismissed-warehouses" => Json("""
                    {"items":[{"warehouse":{"ref":"wh-9","name":"Склад отдела продаж"},
                     "employee_name":"Сидоров Сидор","employee_code":"E-12","city":"Москва",
                     "department":"Продажи","position":"Менеджер",
                     "dismissal_date":"2026-10-01T00:00:00Z",
                     "employment_status":"dismissed","employment_label":"Уволен",
                     "match_score":90,"ambiguous":false,
                     "totals":{"qty":7,"cost":21000.0,"cost_accounting":21000.0,"positions":2},
                     "balances":[{"nomenclature_name":"Мышь Logitech","qty_balance":5,"cost_balance":15000.0}]}],
                     "returned":1,"has_more":false,"truncated":false,"status":"ok"}
                    """),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var page = await client.GetWarehouse1cDismissedWarehousesAsync(100, CancellationToken.None);

        var request = handler.Requests.Single(request =>
            request.Method == "GET" && request.Path == "/api/v1/warehouse-1c/dismissed-warehouses");
        Assert.Equal("?include_meta=true&limit=100", request.Query);

        var item = Assert.Single(page.Items ?? []);
        Assert.Equal("Склад отдела продаж", item.Warehouse?.Name);
        Assert.Equal("Сидоров Сидор", item.EmployeeName);
        Assert.Equal(2, item.Totals?.Positions);
        Assert.Equal(15000.0, Assert.Single(item.Balances ?? []).CostBalance);
    }

    [Fact]
    public async Task DesktopPresenceHeartbeatPostsEmptyBodyAndParsesResponse()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/desktop-presence/heartbeat" => Json("""{"active":true,"expires_in_seconds":90}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var presence = await client.SendDesktopPresenceHeartbeatAsync(CancellationToken.None);

        Assert.True(presence.Active);
        Assert.Equal(90, presence.ExpiresInSeconds);
        var request = handler.Requests.Single(
            request => request.Method == "POST" && request.Path == "/api/v1/desktop-presence/heartbeat");
        Assert.Equal("{}", (request.Body ?? string.Empty).Trim());
    }

    [Fact]
    public async Task DesktopPresenceDisconnectSendsDelete()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/desktop-presence/current" => Json("""{"active":false,"expires_in_seconds":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var presence = await client.DisconnectDesktopPresenceAsync(CancellationToken.None);

        Assert.False(presence.Active);
        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/desktop-presence/current");
        Assert.Equal("DELETE", request.Method);
    }

    // ---- Терминалы ВКС: управление (vcs.manage) ----

    [Fact]
    public async Task VcsComputerCreatePostsJsonBodyAndParses()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/computers" when request.Method == "POST" => Json(
                    """{"id":"c-9","name":"Переговорная 3","ip_address":"10.0.0.9","location":"Тюмень","created_at":"2026-11-19T10:00:00+00:00","updated_at":"2026-11-19T10:00:00+00:00"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var created = await client.CreateVcsComputerAsync(
            new HubVcsComputerInput
            {
                Name = "Переговорная 3",
                IpAddress = "10.0.0.9",
                Location = "Тюмень",
            },
            CancellationToken.None);

        Assert.Equal("c-9", created.Id);
        Assert.Equal("Переговорная 3", created.Name);
        Assert.Equal("10.0.0.9", created.IpAddress);
        Assert.Equal("Тюмень", created.Location);

        var post = handler.Requests.Single(
            request => request.Method == "POST" && request.Path == "/api/v1/vcs/computers");
        var body = post.Body ?? string.Empty;
        // snake_case-ключи — контракт роута (кириллица уходит в \uXXXX).
        Assert.Contains("\"name\":", body);
        Assert.Contains("\"ip_address\":\"10.0.0.9\"", body);
        Assert.Contains("\"location\":", body);
        var sent = JsonSerializer.Deserialize<HubVcsComputerInput>(body);
        Assert.NotNull(sent);
        Assert.Equal("Переговорная 3", sent!.Name);
        Assert.Equal("Тюмень", sent.Location);
    }

    [Fact]
    public async Task VcsComputerUpdatePutsJsonBodyToIdRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/computers/c-1" when request.Method == "PUT" => Json(
                    """{"id":"c-1","name":"Переговорная 1*","ip_address":"10.0.0.5:5901","location":"","created_at":"2026-11-19T10:00:00+00:00","updated_at":"2026-11-19T11:00:00+00:00"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var updated = await client.UpdateVcsComputerAsync(
            "c-1",
            new HubVcsComputerInput
            {
                Name = "Переговорная 1*",
                IpAddress = "10.0.0.5:5901",
                Location = "",
            },
            CancellationToken.None);

        Assert.Equal("c-1", updated.Id);
        Assert.Equal("10.0.0.5:5901", updated.IpAddress);
        var put = handler.Requests.Single(
            request => request.Method == "PUT" && request.Path == "/api/v1/vcs/computers/c-1");
        var body = put.Body ?? string.Empty;
        Assert.Contains("\"ip_address\":\"10.0.0.5:5901\"", body);
        Assert.Contains("\"location\":\"\"", body);
        var sent = JsonSerializer.Deserialize<HubVcsComputerInput>(body);
        Assert.Equal("Переговорная 1*", sent?.Name);
    }

    [Fact]
    public async Task VcsComputerDeleteSendsDeleteToIdRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/computers/c-1" when request.Method == "DELETE" => Json("""{"success":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.DeleteVcsComputerAsync("c-1", CancellationToken.None);

        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/vcs/computers/c-1");
        Assert.Equal("DELETE", request.Method);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task VcsComputersOrderPutsIdArrayToOrderRoute()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/computers/order" => Json("""{"success":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.UpdateVcsComputersOrderAsync(["c-2", "c-1", "c-3"], CancellationToken.None);

        var request = handler.Requests.Single(
            request => request.Path == "/api/v1/vcs/computers/order");
        Assert.Equal("PUT", request.Method);
        Assert.Contains("{\"order\":[\"c-2\",\"c-1\",\"c-3\"]}", request.Body ?? string.Empty);
    }

    [Fact]
    public async Task VcsConfigGetReadsFlagAndUpdatePutsPasswordHex()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/config" when request.Method == "GET" => Json(
                    """{"password_hex":"","password_configured":true}"""),
                "/api/v1/vcs/config" when request.Method == "PUT" => Json(
                    """{"password_hex":"","password_configured":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var config = await client.GetVcsConfigAsync(CancellationToken.None);

        Assert.True(config.PasswordConfigured);
        Assert.Equal(string.Empty, config.PasswordHex);

        var updated = await client.UpdateVcsConfigAsync("6e4114ad4dc9c9d7", CancellationToken.None);

        Assert.True(updated.PasswordConfigured);
        var put = handler.Requests.Single(
            request => request.Method == "PUT" && request.Path == "/api/v1/vcs/config");
        Assert.Contains("{\"password_hex\":\"6e4114ad4dc9c9d7\"}", put.Body ?? string.Empty);
    }

    [Fact]
    public async Task VcsInfoGetReadsContentAndUpdatePutsContent()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-1")),
                "/api/v1/vcs/info" when request.Method == "GET" => Json(
                    """{"content":"[{\"agent\":\"Ростелеком\"}]"}"""),
                "/api/v1/vcs/info" when request.Method == "PUT" => Json(
                    """{"content":"[{\"agent\":\"Ростелеком\"}]"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var info = await client.GetVcsInfoAsync(CancellationToken.None);

        Assert.Equal("[{\"agent\":\"Ростелеком\"}]", info.Content);

        var saved = await client.UpdateVcsInfoAsync(
            "[{\"agent\":\"Ростелеком\"}]", CancellationToken.None);

        Assert.Equal("[{\"agent\":\"Ростелеком\"}]", saved.Content);
        var put = handler.Requests.Single(
            request => request.Method == "PUT" && request.Path == "/api/v1/vcs/info");
        var body = put.Body ?? string.Empty;
        Assert.Contains("\"content\":", body);
        var sent = JsonSerializer.Deserialize<HubVcsInfo>(body);
        Assert.Equal("[{\"agent\":\"Ростелеком\"}]", sent?.Content);
    }

    // ---- Чат: модерация групп (роли, ограничения, заявки, жалобы, ссылки) ----

    [Fact]
    public async Task ChatMemberRoleRestrictionAndLiftHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/members/42/role"
                    or "/api/v1/chat/conversations/g1/members/42/restriction"
                    => Json("""{"id":"g1","kind":"group","title":"Команда","viewer_member_role":"owner","members":[]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.UpdateChatGroupMemberRoleAsync("g1", 42, "moderator", CancellationToken.None);
        await client.RestrictChatGroupMemberAsync("g1", 42, 3600, CancellationToken.None);
        await client.RestrictChatGroupMemberAsync("g1", 42, null, CancellationToken.None);
        await client.LiftChatGroupMemberRestrictionAsync("g1", 42, CancellationToken.None);

        var role = handler.Requests.Single(request => request.Path.EndsWith("/role"));
        Assert.Equal("PATCH", role.Method);
        Assert.Equal("/api/v1/chat/conversations/g1/members/42/role", role.Path);
        Assert.Contains("\"member_role\":\"moderator\"", role.Body ?? string.Empty);

        var puts = handler.Requests
            .Where(request => request.Method == "PUT" && request.Path.EndsWith("/restriction"))
            .ToArray();
        Assert.Equal(2, puts.Length);
        Assert.Contains("\"duration_seconds\":3600", puts[0].Body ?? string.Empty);
        Assert.Contains("\"duration_seconds\":null", puts[1].Body ?? string.Empty);

        var delete = Assert.Single(handler.Requests, request =>
            request.Method == "DELETE" && request.Path.EndsWith("/restriction"));
        Assert.Equal("/api/v1/chat/conversations/g1/members/42/restriction", delete.Path);
    }

    [Fact]
    public async Task ChatJoinRequestsListApprovalAndDecisionHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/join-requests" => Json(
                    """{"items":[{"id":11,"user_id":55,"user_name":"Пётр","created_at":"2026-11-19T10:00:00Z"}],"open_count":1,"approval_required":true}"""),
                "/api/v1/chat/conversations/g1/join-approval" => Json("""{"approval_required":true}"""),
                "/api/v1/chat/conversations/g1/join-requests/11" => Json("""{"id":11,"status":"approved","added":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var list = await client.GetChatJoinRequestsAsync("g1", CancellationToken.None);
        Assert.Equal(1, list.OpenCount);
        Assert.True(list.ApprovalRequired);
        var item = Assert.Single(list.Items!);
        Assert.Equal(55, item.UserId);
        Assert.Equal("Пётр", item.UserName);

        var approval = await client.SetChatJoinApprovalAsync("g1", true, CancellationToken.None);
        Assert.True(approval.ApprovalRequired);
        var approvalRequest = handler.Requests.Single(request => request.Path.EndsWith("/join-approval"));
        Assert.Equal("PUT", approvalRequest.Method);
        Assert.Contains("\"approval_required\":true", approvalRequest.Body ?? string.Empty);

        var resolution = await client.ResolveChatJoinRequestAsync("g1", 11, "approve", CancellationToken.None);
        Assert.Equal("approved", resolution.Status);
        Assert.True(resolution.Added);
        var decision = handler.Requests.Single(request => request.Path.EndsWith("/join-requests/11"));
        Assert.Equal("PUT", decision.Method);
        Assert.Contains("\"decision\":\"approve\"", decision.Body ?? string.Empty);
    }

    [Fact]
    public async Task ChatMessageReportListAndResolveHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/messages/m1/report" => Json(
                    """{"id":21,"status":"open","already_reported":false}"""),
                "/api/v1/chat/conversations/g1/reports" => Json(
                    """{"items":[{"id":21,"message_id":"m1","reason":"spam","reporter_user_id":9,"reporter_name":"Иван","sender_name":"Пётр","message_preview":"купи слона"}],"open_count":1}"""),
                "/api/v1/chat/conversations/g1/reports/21" => Json("""{"id":21,"status":"resolved"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var created = await client.ReportChatMessageAsync(
            "g1", "m1", "spam", "купи слона", CancellationToken.None);
        Assert.Equal(21, created.Id);
        Assert.False(created.AlreadyReported);
        var report = handler.Requests.Single(request => request.Path.EndsWith("/report"));
        Assert.Equal("POST", report.Method);
        Assert.Contains("\"reason\":\"spam\"", report.Body ?? string.Empty);
        Assert.Contains("\"comment\":\"", report.Body ?? string.Empty);

        var list = await client.GetChatMessageReportsAsync("g1", CancellationToken.None);
        Assert.Equal(1, list.OpenCount);
        var row = Assert.Single(list.Items!);
        Assert.Equal("Иван", row.ReporterName);
        Assert.Equal("купи слона", row.MessagePreview);

        var resolution = await client.ResolveChatMessageReportAsync(
            "g1", 21, "resolved", CancellationToken.None);
        Assert.Equal("resolved", resolution.Status);
        var resolve = handler.Requests.Single(request => request.Path.EndsWith("/reports/21"));
        Assert.Equal("PUT", resolve.Method);
        Assert.Contains("\"resolution\":\"resolved\"", resolve.Body ?? string.Empty);
    }

    [Fact]
    public async Task ChatInviteLinkCreateRevokePreviewAndJoinHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/invite-link" => request.Method == "POST"
                    ? Json("""{"token":"tok-1","expires_at":"2026-11-26T10:00:00Z","conversation_id":"g1"}""")
                    : Json("""{"revoked":1}"""),
                "/api/v1/chat/invite-links/tok-1" => Json(
                    """{"requires_approval":false,"title":"Команда","member_count":10,"already_member":false}"""),
                "/api/v1/chat/invite-links/tok-1/join" => Json(
                    """{"joined":true,"requested":false,"conversation":{"id":"g1","kind":"group","title":"Команда","viewer_member_role":"member"}}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var link = await client.CreateChatGroupInviteLinkAsync("g1", CancellationToken.None);
        Assert.Equal("tok-1", link.Token);

        var preview = await client.GetChatInviteLinkPreviewAsync("tok-1", CancellationToken.None);
        Assert.Equal("Команда", preview.Title);
        Assert.Equal(10, preview.MemberCount);
        Assert.False(preview.AlreadyMember);

        var joined = await client.JoinChatByInviteLinkAsync("tok-1", CancellationToken.None);
        Assert.True(joined.Joined);
        Assert.Equal("g1", joined.Conversation?.Id);
        var join = handler.Requests.Single(request => request.Path.EndsWith("/join"));
        Assert.Equal("POST", join.Method);

        var revoked = await client.RevokeChatGroupInviteLinkAsync("g1", CancellationToken.None);
        Assert.Equal(1, revoked.Revoked);
        var revoke = handler.Requests.Single(request =>
            request.Method == "DELETE" && request.Path.EndsWith("/invite-link"));
        Assert.Equal("/api/v1/chat/conversations/g1/invite-link", revoke.Path);
    }

    [Fact]
    public async Task ChatDeleteAndSupportConversationHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1" => new HttpResponseMessage(HttpStatusCode.NoContent),
                "/api/v1/chat/conversations/support" => Json(
                    """{"id":"sup-1","kind":"direct","title":"Поддержка","is_support":true}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.DeleteChatConversationAsync("g1", CancellationToken.None);
        var delete = Assert.Single(handler.Requests, request =>
            request.Method == "DELETE" && request.Path == "/api/v1/chat/conversations/g1");

        var support = await client.CreateChatSupportConversationAsync(CancellationToken.None);
        Assert.Equal("sup-1", support.Id);
        Assert.True(support.IsSupport);
        var create = handler.Requests.Single(request => request.Path.EndsWith("/support"));
        Assert.Equal("POST", create.Method);
    }

    [Fact]
    public async Task ChatGroupProfileAvatarAndDeleteHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/profile"
                    or "/api/v1/chat/conversations/g1/avatar"
                    => Json("""{"id":"g1","kind":"group","title":"Новое имя","description":"описание","avatar_url":"https://hub.test/a.png","viewer_member_role":"owner","members":[]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var detail = await client.UpdateChatGroupProfileAsync(
            "g1", "Новое имя", "описание", "members_only", 30, false, CancellationToken.None);
        Assert.Equal("Новое имя", detail.Title);
        Assert.Equal("описание", detail.Description);
        var patch = handler.Requests.Single(request => request.Path.EndsWith("/profile"));
        Assert.Equal("PATCH", patch.Method);
        // Тело парсим: сериализатор экранирует кириллицу в \uXXXX.
        using var patchJson = JsonDocument.Parse(patch.Body ?? "{}");
        var profile = patchJson.RootElement;
        Assert.Equal("Новое имя", profile.GetProperty("title").GetString());
        Assert.Equal("описание", profile.GetProperty("description").GetString());
        Assert.Equal("members_only", profile.GetProperty("posting_policy").GetString());
        Assert.Equal(30, profile.GetProperty("slow_mode_seconds").GetInt32());
        Assert.False(profile.GetProperty("members_send_files").GetBoolean());

        await using (var stream = new MemoryStream(new byte[] { 1, 2, 3 }))
        {
            var withAvatar = await client.UploadChatGroupAvatarAsync(
                "g1", "photo.png", stream, "image/png", CancellationToken.None);
            Assert.Equal("https://hub.test/a.png", withAvatar.AvatarUrl);
        }

        var upload = handler.Requests.Single(request =>
            request.Method == "POST" && request.Path.EndsWith("/avatar"));
        Assert.StartsWith("multipart/form-data", upload.ContentType ?? string.Empty);
        Assert.Contains("photo.png", upload.Body ?? string.Empty);
        Assert.Contains("image/png", upload.Body ?? string.Empty);

        var withoutAvatar = await client.DeleteChatGroupAvatarAsync("g1", CancellationToken.None);
        var remove = handler.Requests.Single(request =>
            request.Method == "DELETE" && request.Path.EndsWith("/avatar"));
        Assert.Equal("/api/v1/chat/conversations/g1/avatar", remove.Path);
        Assert.NotNull(withoutAvatar);
    }

    [Fact]
    public async Task ChatShareableTasksTaskShareAndHydrateHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/conversations/g1/shareable-tasks" => Json(
                    """{"items":[{"id":"42","title":"Починить принтер","status":"in_progress","is_overdue":false}]}"""),
                "/api/v1/chat/conversations/g1/messages/task-share" => Json(
                    """{"id":"msg-1","conversation_id":"g1","kind":"task_share","created_at":"2026-11-19T10:00:00Z","is_own":true,"task_preview":{"id":"42","title":"Починить принтер","status":"in_progress"}}"""),
                "/api/v1/chat/conversations/g1/messages/hydrate" => Json(
                    """{"items":[{"message_id":"m1","read_by_count":3,"delivery_status":"read"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var tasks = await client.GetChatShareableTasksAsync("g1", "принтер", 20, CancellationToken.None);
        var task = Assert.Single(tasks.Items!);
        Assert.Equal("42", task.Id);
        var list = handler.Requests.Single(request => request.Path.EndsWith("/shareable-tasks"));
        Assert.Equal("?limit=20&q=%D0%BF%D1%80%D0%B8%D0%BD%D1%82%D0%B5%D1%80", list.Query);

        var message = await client.SendChatTaskShareAsync(
            "g1", "42", "client-1", null, CancellationToken.None);
        Assert.Equal("task_share", message.Kind);
        Assert.Equal("Починить принтер", message.TaskPreview?.Title);
        var share = handler.Requests.Single(request => request.Path.EndsWith("/task-share"));
        Assert.Equal("POST", share.Method);
        Assert.Contains("\"task_id\":\"42\"", share.Body ?? string.Empty);
        Assert.Contains("\"client_message_id\":\"client-1\"", share.Body ?? string.Empty);

        var hydrated = await client.HydrateChatMessagesAsync(
            "g1", ["m1", "m2"], CancellationToken.None);
        var hydratedItem = Assert.Single(hydrated.Items!);
        Assert.Equal("m1", hydratedItem.MessageId);
        Assert.Equal(3, hydratedItem.ReadByCount);
        var hydrate = handler.Requests.Single(request => request.Path.EndsWith("/hydrate"));
        Assert.Equal("?message_ids=m1%2Cm2", hydrate.Query);
    }

    [Fact]
    public async Task ChatConfigAndScheduledMessagesHitContractRoutes()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/chat/config" => Json(
                    """{"group_max_members":200,"scheduled_messages_enabled":true,"support_user_id":9}"""),
                "/api/v1/chat/conversations/c1/scheduled" => request.Method == "POST"
                    ? Json("""{"id":"s1","conversation_id":"c1","body":"Напомнить","body_format":"plain","reply_to_message_id":"m9","scheduled_for":"2026-11-20T12:00:00Z","status":"scheduled","attempt_count":0}""")
                    : Json(
                    """{"items":[{"id":"s1","conversation_id":"c1","body":"Напомнить","body_format":"plain","reply_to_message_id":"m9","scheduled_for":"2026-11-20T12:00:00Z","status":"scheduled","attempt_count":0,"sent_message_id":null,"error_text":null,"created_at":"2026-11-19T10:00:00Z"}]}"""),
                "/api/v1/chat/scheduled/s1" => request.Method == "DELETE"
                    ? Json("""{"id":"s1","status":"cancelled"}""")
                    : Json("""{"id":"s1","conversation_id":"c1","body":"Новый текст","body_format":"plain","scheduled_for":"2026-11-21T06:00:00Z","status":"scheduled","attempt_count":0}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var config = await client.GetChatConfigAsync(CancellationToken.None);
        Assert.True(config.ScheduledMessagesEnabled);
        Assert.Equal(200, config.GroupMaxMembers);
        Assert.Equal("/api/v1/chat/config",
            handler.Requests.Single(request => request.Path == "/api/v1/chat/config").Path);

        var list = await client.GetChatScheduledMessagesAsync("c1", CancellationToken.None);
        var item = Assert.Single(list.Items!);
        Assert.Equal("s1", item.Id);
        Assert.Equal("scheduled", item.Status);
        Assert.Equal("m9", item.ReplyToMessageId);
        var listRequest = handler.Requests.Single(
            request => request.Path == "/api/v1/chat/conversations/c1/scheduled"
                       && request.Method == "GET");
        Assert.Equal("GET", listRequest.Method);

        // POST: body/body_format/plain, scheduled_for в UTC-ISO, reply_to только с контекстом.
        var when = new DateTimeOffset(2026, 11, 20, 15, 0, 0, TimeSpan.FromHours(3));
        var created = await client.CreateChatScheduledMessageAsync(
            "c1", "Напомнить", when, "m9", CancellationToken.None);
        Assert.Equal("s1", created.Id);
        var create = handler.Requests.Single(
            request => request.Path == "/api/v1/chat/conversations/c1/scheduled"
                       && request.Method == "POST");
        using (var doc = JsonDocument.Parse(create.Body ?? "{}"))
        {
            Assert.Equal("Напомнить", doc.RootElement.GetProperty("body").GetString());
            Assert.Equal("plain", doc.RootElement.GetProperty("body_format").GetString());
            Assert.Equal("2026-11-20T12:00:00Z", doc.RootElement.GetProperty("scheduled_for").GetString());
            Assert.Equal("m9", doc.RootElement.GetProperty("reply_to_message_id").GetString());
        }

        await client.CreateChatScheduledMessageAsync(
            "c1", "Без ответа", when, null, CancellationToken.None);
        var createNoReply = handler.Requests.Last(
            request => request.Path == "/api/v1/chat/conversations/c1/scheduled"
                       && request.Method == "POST");
        Assert.DoesNotContain("reply_to_message_id", createNoReply.Body ?? string.Empty);

        // PATCH: только переданные поля — оба вместе и по одному.
        var later = new DateTimeOffset(2026, 11, 21, 9, 0, 0, TimeSpan.FromHours(3));
        var updated = await client.UpdateChatScheduledMessageAsync(
            "s1", "Новый текст", later, CancellationToken.None);
        Assert.Equal("Новый текст", updated.Body);
        var patchBoth = handler.Requests.Single(
            request => request.Path == "/api/v1/chat/scheduled/s1"
                       && request.Method == "PATCH");
        using (var doc = JsonDocument.Parse(patchBoth.Body ?? "{}"))
        {
            Assert.Equal("Новый текст", doc.RootElement.GetProperty("body").GetString());
            Assert.Equal("2026-11-21T06:00:00Z", doc.RootElement.GetProperty("scheduled_for").GetString());
        }

        await client.UpdateChatScheduledMessageAsync(
            "s1", null, later, CancellationToken.None);
        var patchTimeOnly = handler.Requests.Last(
            request => request.Path == "/api/v1/chat/scheduled/s1"
                       && request.Method == "PATCH");
        Assert.DoesNotContain("\"body\"", patchTimeOnly.Body ?? string.Empty);
        Assert.Contains("scheduled_for", patchTimeOnly.Body ?? string.Empty);

        await client.UpdateChatScheduledMessageAsync(
            "s1", "Только текст", null, CancellationToken.None);
        var patchBodyOnly = handler.Requests.Last(
            request => request.Path == "/api/v1/chat/scheduled/s1"
                       && request.Method == "PATCH");
        using (var doc = JsonDocument.Parse(patchBodyOnly.Body ?? "{}"))
        {
            Assert.Equal("Только текст", doc.RootElement.GetProperty("body").GetString());
            Assert.False(doc.RootElement.TryGetProperty("scheduled_for", out _));
        }

        var cancelled = await client.CancelChatScheduledMessageAsync("s1", CancellationToken.None);
        Assert.Equal("cancelled", cancelled.Status);
        var delete = handler.Requests.Single(
            request => request.Path == "/api/v1/chat/scheduled/s1"
                       && request.Method == "DELETE");
        Assert.Null(delete.Body);
    }

    // ---- Журнал работ /json/works* (обслуживание оборудования) ----

    [Fact]
    public async Task WorkHistoryEndpointsSendTheirIdentifierSets()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/json/works/cartridge/history" => Json(
                    """{"last_date":"2025-10-01T12:00:00Z","count":3,"time_ago_str":"2 дня назад"}"""),
                "/api/v1/json/works/battery/history" => Json(
                    """{"last_date":null,"count":0,"time_ago_str":null}"""),
                "/api/v1/json/works/component/history" => Json(
                    """{"last_date":"2025-09-15T08:00:00Z","count":1,"time_ago_str":"месяц назад","component_type":"fuser"}"""),
                "/api/v1/json/works/cleaning/history" => Json(
                    """{"last_date":"2025-08-20T09:30:00Z","count":5,"time_ago_str":"2 месяца назад"}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var cartridge = await client.GetCartridgeWorkHistoryAsync(
            "SN-1", "HW-1", "100234", "CE285A", CancellationToken.None);
        Assert.Equal(3, cartridge.Count);
        Assert.Equal("2 дня назад", cartridge.TimeAgoStr);
        Assert.Equal("2025-10-01T12:00:00Z", cartridge.LastDate);
        var cartridgeRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/cartridge/history");
        Assert.Equal("GET", cartridgeRequest.Method);
        Assert.Equal(
            "?serial_number=SN-1&hw_serial_number=HW-1&inv_no=100234&cartridge_model=CE285A",
            cartridgeRequest.Query);
        Assert.StartsWith("Bearer ", cartridgeRequest.Authorization ?? string.Empty);

        await client.GetBatteryWorkHistoryAsync("SN-1", null, CancellationToken.None);
        var batteryRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/battery/history");
        Assert.Equal("?serial_number=SN-1", batteryRequest.Query);

        var component = await client.GetComponentWorkHistoryAsync(
            "SN-1", "HW-1", "fuser", "Фьюзер", CancellationToken.None);
        Assert.Equal("fuser", component.ComponentType);
        var componentRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/component/history");
        Assert.Equal(
            "?serial_number=SN-1&hw_serial_number=HW-1&component_type=fuser&component_name=%D0%A4%D1%8C%D1%8E%D0%B7%D0%B5%D1%80",
            componentRequest.Query);

        var cleaning = await client.GetCleaningWorkHistoryAsync(
            "SN-1", "  ", "100234", 777, CancellationToken.None);
        Assert.Equal(5, cleaning.Count);
        var cleaningRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/cleaning/history");
        // Пустые/пробельные параметры в запрос не идут.
        Assert.Equal(
            "?serial_number=SN-1&inv_no=100234&equipment_id=777",
            cleaningRequest.Query);
    }

    [Fact]
    public async Task WorksListEndpointsSendSerialAndLimitAndParseRows()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/json/works/cartridge" => Json(
                    """[{"printer_model":"HP M404","component_type":"cartridge","cartridge_color":"Универсальный","cartridge_model":"CE285A","branch":"ЦО","location":"Каб. 1","serial_number":"SN-1","inv_no":"100234","timestamp":"2025-10-01T10:00:00Z"}]"""),
                "/api/v1/json/works/battery" => Json(
                    """[{"serial_no":"SN-9","hw_serial_no":"HW-9","branch":"ЦО","location":"Серверная","timestamp":"2025-10-02T11:00:00Z"}]"""),
                "/api/v1/json/works/component" => Json(
                    """[{"serial_no":"SN-1","component_type":"fuser","component_name":"Фьюзер","component_model":"RM1-1234","equipment_kind":"printer","branch":"ЦО","location":"Каб. 1","timestamp":"2025-10-03T12:00:00Z"}]"""),
                "/api/v1/json/works/cleaning" => Json(
                    """[{"serial_no":"SN-1","inv_no":"100234","employee":"Петров","branch":"ЦО","location":"Каб. 2","equipment_id":777,"timestamp":"2025-10-04T13:00:00Z"}]"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var cartridgeRows = await client.GetCartridgeWorksAsync(500, CancellationToken.None);
        var cartridge = Assert.Single(cartridgeRows);
        Assert.Equal("CE285A", cartridge.CartridgeModel);
        Assert.Equal("SN-1", cartridge.SerialNumber);
        Assert.Equal("2025-10-01T10:00:00Z", cartridge.Timestamp);
        var cartridgeRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/cartridge");
        Assert.Equal("?limit=500", cartridgeRequest.Query);

        var batteryRows = await client.GetBatteryWorksAsync("SN-9", 100, CancellationToken.None);
        Assert.Equal("HW-9", Assert.Single(batteryRows).HwSerialNo);
        var batteryRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/battery");
        Assert.Equal("?serial_number=SN-9&limit=100", batteryRequest.Query);

        var componentRows = await client.GetComponentWorksAsync("SN-1", 100, CancellationToken.None);
        Assert.Equal("RM1-1234", Assert.Single(componentRows).ComponentModel);
        var componentRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/component");
        Assert.Equal("?serial_number=SN-1&limit=100", componentRequest.Query);

        var cleaningRows = await client.GetCleaningWorksAsync("SN-1", 100, CancellationToken.None);
        Assert.Equal<long?>(777, Assert.Single(cleaningRows).EquipmentId);
        var cleaningRequest = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/cleaning");
        Assert.Equal("?serial_number=SN-1&limit=100", cleaningRequest.Query);
    }

    [Fact]
    public async Task PcCleaningRemainingSendsPeriodAndEscapedBranch()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/json/works/cleaning/statistics/remaining" => Json(
                    """{"branch":"ЦО A","period_days":90,"total_pc":6,"remaining_pc":1,"remaining_pcs":[{"inv_no":"100234","serial_no":"SN-1","hw_serial_no":"HW-1","location":"Кабинет 101","model_name":"HP ProDesk","employee":"Петров","last_cleaned_at":null,"equipment_id":5,"manufacturer":"HP","current_description":"черновик"}]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var data = await client.GetPcCleaningRemainingAsync(90, "ЦО A", CancellationToken.None);

        Assert.Equal("ЦО A", data.Branch);
        Assert.Equal(6, data.TotalPc);
        Assert.Equal(1, data.RemainingPc);
        var row = Assert.Single(data.RemainingPcs!);
        Assert.Equal("100234", row.InvNo);
        Assert.Equal("SN-1", row.SerialNo);
        Assert.Equal("HW-1", row.HwSerialNo);
        Assert.Equal("Кабинет 101", row.Location);
        Assert.Equal("HP ProDesk", row.ModelName);
        Assert.Equal("Петров", row.Employee);
        Assert.Null(row.LastCleanedAt);
        Assert.Equal<long?>(5, row.EquipmentId);
        Assert.Equal("HP", row.Manufacturer);
        Assert.Equal("черновик", row.CurrentDescription);
        var request = Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/works/cleaning/statistics/remaining");
        Assert.Equal("?period_days=90&branch=%D0%A6%D0%9E%20A", request.Query);
    }

    [Fact]
    public async Task CartridgeCompatibilityEncodesModelAndParsesTable()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/json/cartridges/compatibility/HP%20LaserJet%20M404" => Json(
                    """{"printer_model":"HP LaserJet M404","oem_cartridge":"CF283A","compatible_models":[{"model":"CE285A","description":"чёрный","color":"black","page_yield":1600,"oem_part":"CE285A"}],"is_color":false,"components":["fuser","photoconductor"],"fuser_models":["RM1-1"],"photoconductor_models":[],"waste_toner_models":[],"transfer_belt_models":[]}"""),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var table = await client.GetCartridgeCompatibilityAsync(
            "HP LaserJet M404", CancellationToken.None);

        Assert.Equal("HP LaserJet M404", table.PrinterModel);
        Assert.Equal("CF283A", table.OemCartridge);
        Assert.False(table.IsColor);
        Assert.Equal(["fuser", "photoconductor"], table.Components!);
        var model = Assert.Single(table.CompatibleModels!);
        Assert.Equal("CE285A", model.Model);
        Assert.Equal<int?>(1600, model.PageYield);
        Assert.Equal("CE285A", model.OemPart);
        Assert.Single(handler.Requests,
            request => request.Path == "/api/v1/json/cartridges/compatibility/HP%20LaserJet%20M404");
    }

    [Fact]
    public async Task MaintenanceRegistrationsPostContractBodies()
    {
        var store = new FakeSessionStore();
        var access = CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));
        var handler = new StubHttpMessageHandler((request, _) => Task.FromResult(
            request.Path switch
            {
                "/api/v1/auth/login" => Json(LoginPayload(access, "refresh-old")),
                "/api/v1/json/works/cartridge" => Json(
                    """{"printer_model":"HP M404","component_type":"cartridge","cartridge_color":"Универсальный","branch":"ЦО","location":"Каб. 1","serial_number":"SN-1","timestamp":"2025-10-05T10:00:00Z"}""", HttpStatusCode.Created),
                "/api/v1/json/works/battery" => Json(
                    """{"serial_number":"SN-9","branch":"ЦО","location":"Серверная","timestamp":"2025-10-05T11:00:00Z"}""", HttpStatusCode.Created),
                "/api/v1/json/works/component" => Json(
                    """{"serial_number":"SN-1","component_type":"ssd","component_model":"Samsung 870","branch":"ЦО","location":"Офис","timestamp":"2025-10-05T12:00:00Z"}""", HttpStatusCode.Created),
                "/api/v1/json/works/cleaning" => Json(
                    """{"serial_number":"SN-1","employee":"Петров","branch":"ЦО","location":"Каб. 2","timestamp":"2025-10-05T13:00:00Z"}""", HttpStatusCode.Created),
                _ => new HttpResponseMessage(HttpStatusCode.NotFound),
            }));
        using var client = CreateClient(store, handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var cartridge = await client.RegisterCartridgeWorkAsync(
            new HubCartridgeWorkRequest
            {
                PrinterModel = "HP M404",
                CartridgeColor = "Универсальный",
                Branch = "ЦО",
                Location = "Каб. 1",
                SerialNumber = "SN-1",
                CartridgeModel = "CE285A",
                InvNo = "100234",
            },
            CancellationToken.None);
        Assert.Equal("2025-10-05T10:00:00Z", cartridge.Timestamp);
        var cartridgePost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/json/works/cartridge");
        using var cartridgeBody = System.Text.Json.JsonDocument.Parse(cartridgePost.Body ?? "{}");
        Assert.Equal("HP M404", cartridgeBody.RootElement.GetProperty("printer_model").GetString());
        Assert.Equal("Универсальный", cartridgeBody.RootElement.GetProperty("cartridge_color").GetString());
        Assert.Equal("SN-1", cartridgeBody.RootElement.GetProperty("serial_number").GetString());
        Assert.Equal("CE285A", cartridgeBody.RootElement.GetProperty("cartridge_model").GetString());
        Assert.StartsWith("Bearer ", cartridgePost.Authorization ?? string.Empty);

        await client.RegisterBatteryWorkAsync(
            new HubBatteryWorkRequest
            {
                SerialNumber = "SN-9",
                Branch = "ЦО",
                Location = "Серверная",
            },
            CancellationToken.None);
        var batteryPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/json/works/battery");
        using var batteryBody = System.Text.Json.JsonDocument.Parse(batteryPost.Body ?? "{}");
        Assert.Equal("SN-9", batteryBody.RootElement.GetProperty("serial_number").GetString());
        Assert.Equal("Серверная", batteryBody.RootElement.GetProperty("location").GetString());

        await client.RegisterComponentWorkAsync(
            new HubComponentWorkRequest
            {
                SerialNumber = "SN-1",
                ComponentType = "ssd",
                ComponentModel = "Samsung 870",
                Branch = "ЦО",
                Location = "Офис",
                EquipmentKind = "pc",
            },
            CancellationToken.None);
        var componentPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/json/works/component");
        using var componentBody = System.Text.Json.JsonDocument.Parse(componentPost.Body ?? "{}");
        Assert.Equal("ssd", componentBody.RootElement.GetProperty("component_type").GetString());
        Assert.Equal("Samsung 870", componentBody.RootElement.GetProperty("component_model").GetString());
        Assert.Equal("pc", componentBody.RootElement.GetProperty("equipment_kind").GetString());

        await client.RegisterCleaningWorkAsync(
            new HubCleaningWorkRequest
            {
                SerialNumber = "SN-1",
                Employee = "Петров",
                Branch = "ЦО",
                Location = "Каб. 2",
                InvNo = "100234",
                EquipmentId = 777,
            },
            CancellationToken.None);
        var cleaningPost = Assert.Single(handler.Requests,
            request => request.Method == "POST" && request.Path == "/api/v1/json/works/cleaning");
        using var cleaningBody = System.Text.Json.JsonDocument.Parse(cleaningPost.Body ?? "{}");
        Assert.Equal("SN-1", cleaningBody.RootElement.GetProperty("serial_number").GetString());
        Assert.Equal("Петров", cleaningBody.RootElement.GetProperty("employee").GetString());
        Assert.Equal(777, cleaningBody.RootElement.GetProperty("equipment_id").GetInt64());
    }

    private static HttpContent FileDownload(string contentDisposition)
    {
        var content = new ByteArrayContent(Encoding.UTF8.GetBytes("file-body"));
        content.Headers.TryAddWithoutValidation("Content-Disposition", contentDisposition);
        return content;
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
