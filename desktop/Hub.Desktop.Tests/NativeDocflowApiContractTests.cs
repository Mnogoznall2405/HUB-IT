using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using Hub.Desktop.Native.Api;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Контрактные тесты docflow-методов HubApiClient: пути/методы и десериализация
/// ответов api/v1/docflow.py (GET profile, POST profile/test, PUT/DELETE
/// profile/credentials, GET metadata, GET absences). Пароль 1С допустим только
/// в теле запроса — никогда в пути, query или заголовках.
/// </summary>
public sealed class NativeDocflowApiContractTests
{
    private static string Access() => CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));

    [Fact]
    public async Task ProfileReadsConfiguredStatusAndLogin()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/profile" => Json(
                """
                {"configured":true,"login":"ivanov","status":"invalid",
                 "last_error_code":"DOCFLOW_INVALID_CREDENTIALS",
                 "last_verified_at":"2026-03-10T10:00:00+00:00",
                 "updated_at":"2026-03-09T12:00:00+00:00"}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var profile = await client.GetDocflowProfileAsync(CancellationToken.None);

        Assert.Single(handler.Requests,
            r => r.Method == "GET" && r.Path == "/api/v1/docflow/profile");
        Assert.True(profile.Configured);
        Assert.Equal("ivanov", profile.Login);
        Assert.Equal("invalid", profile.Status);
        Assert.Equal("DOCFLOW_INVALID_CREDENTIALS", profile.LastErrorCode);
        Assert.NotNull(profile.LastVerifiedAt);
    }

    [Fact]
    public async Task ProfileTestPostsCredentialsInBodyOnly()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/profile/test" => Json(
                """
                {"connected":true,"configuration":"Документооборот КОРП",
                 "verified_at":"2026-03-10T10:00:00+00:00"}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.TestDocflowCredentialsAsync(
            " ivanov ", "s3cr3t-пароль", CancellationToken.None);

        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/docflow/profile/test");
        Assert.Equal("POST", request.Method);
        // Креды только в JSON-теле: в URL их быть не должно никогда.
        Assert.Equal(string.Empty, request.Query);
        Assert.DoesNotContain("s3cr3t", request.Path);
        using var body = JsonDocument.Parse(request.Body ?? "{}");
        Assert.Equal("ivanov", body.RootElement.GetProperty("login").GetString());
        Assert.Equal("s3cr3t-пароль", body.RootElement.GetProperty("password").GetString());
        Assert.True(result.Connected);
        Assert.Equal("Документооборот КОРП", result.Configuration);
        Assert.NotNull(result.VerifiedAt);
    }

    [Fact]
    public async Task SaveCredentialsPutsBodyAndReadsProfile()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/profile/credentials" => Json(
                """
                {"configured":true,"login":"ivanov","status":"valid",
                 "last_verified_at":"2026-03-10T10:00:00+00:00",
                 "updated_at":"2026-03-10T10:00:00+00:00"}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var profile = await client.SaveDocflowCredentialsAsync(
            "ivanov", "s3cr3t", CancellationToken.None);

        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/docflow/profile/credentials");
        Assert.Equal("PUT", request.Method);
        Assert.Contains("\"login\":\"ivanov\"", request.Body);
        Assert.Contains("\"password\":\"s3cr3t\"", request.Body);
        Assert.True(profile.Configured);
        Assert.Equal("valid", profile.Status);
        Assert.Equal("ivanov", profile.Login);
    }

    [Fact]
    public async Task DeleteCredentialsSendsDeleteToCredentialsPath()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/profile/credentials" => new HttpResponseMessage(
                HttpStatusCode.NoContent),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        await client.DeleteDocflowCredentialsAsync(CancellationToken.None);

        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/docflow/profile/credentials");
        Assert.Equal("DELETE", request.Method);
        Assert.Null(request.Body);
    }

    [Fact]
    public async Task MetadataReadsConfigurationAndTypeLists()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/metadata" => Json(
                """
                {"configuration":"Документооборот КОРП 3.0",
                 "task_types":[{"name":"ЗадачаИсполнителя","label":"Задача исполнителя",
                                "attributes":["Автор","СрокИсполнения"]}],
                 "process_types":[{"name":"Согласование","label":"Согласование",
                                   "attributes":["Предмет"]}],
                 "active_task_type":"ЗадачаИсполнителя","mapping_ready":true}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var metadata = await client.GetDocflowMetadataAsync(CancellationToken.None);

        Assert.Single(handler.Requests,
            r => r.Method == "GET" && r.Path == "/api/v1/docflow/metadata");
        Assert.Equal("Документооборот КОРП 3.0", metadata.Configuration);
        Assert.Equal("ЗадачаИсполнителя", metadata.ActiveTaskType);
        Assert.True(metadata.MappingReady);
        var taskType = Assert.Single(metadata.TaskTypes!);
        Assert.Equal("ЗадачаИсполнителя", taskType.Name);
        Assert.Equal("Задача исполнителя", taskType.Label);
        Assert.Equal(["Автор", "СрокИсполнения"], taskType.Attributes!);
        Assert.Equal("Согласование", Assert.Single(metadata.ProcessTypes!).Name);
    }

    [Fact]
    public async Task AbsencesSendsOnAndEmployeeCodeAndReadsItems()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/docflow/absences" => Json(
                """
                {"status":"available","source":"docflow","on":"2026-03-10",
                 "count":1,"unresolved_count":1,"as_of":"2026-03-10T08:30:00+00:00",
                 "zup_comparison":"unavailable","zup_as_of":"2026-03-09",
                 "items":[{"id":"ab-1","employee_ref":"ref-1","employee_code":null,
                           "matching_status":"unresolved","display_name":"Пётр Сидоров",
                           "starts_on":"2026-03-10","ends_on":"2026-03-20",
                           "kind":"vacation","label":"Отпуск",
                           "comment":"Ежегодный","will_handle_tasks":false,
                           "differences":["ends_on"]}]}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var list = await client.GetDocflowAbsencesAsync(
            "E-123", "2026-03-10", CancellationToken.None);

        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/docflow/absences");
        Assert.Equal("GET", request.Method);
        Assert.Equal("?on=2026-03-10&employee_code=E-123", request.Query);
        Assert.Equal("available", list.Status);
        Assert.Equal("unavailable", list.ZupComparison);
        Assert.Equal(1, list.UnresolvedCount);
        var item = Assert.Single(list.Items!);
        Assert.Equal("unresolved", item.MatchingStatus);
        Assert.Equal("Пётр Сидоров", item.DisplayName);
        Assert.Equal("2026-03-10", item.StartsOn);
        Assert.Equal("Отпуск", item.Label);
        Assert.False(item.WillHandleTasks);
        Assert.Equal(["ends_on"], item.Differences!);
    }

    private static HubApiClient CreateClient(HttpMessageHandler handler)
        => new(new Uri("https://hub.test/"), new FakeSessionStore(), handler);

    private static HttpResponseMessage Json(string body)
        => new(HttpStatusCode.OK)
        {
            Content = new StringContent(body, Encoding.UTF8, "application/json"),
        };

    private static HttpResponseMessage NotFound() => new(HttpStatusCode.NotFound);

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

    private static string LoginPayload(string accessToken)
        => $$"""{"status":"authenticated","access_token":"{{accessToken}}","refresh_token":"refresh-1","token_type":"bearer","user":{"id":7,"username":"tester","full_name":"Test User","role":"operator"},"session_id":"s-1"}""";

    private sealed record RecordedRequest(string Method, string Path, string Query, string? Body);

    private sealed class FakeSessionStore : INativeSessionStore
    {
        public NativeSession? Session { get; set; }

        public Task<NativeSession?> LoadAsync(CancellationToken cancellationToken)
            => Task.FromResult(Session);

        public Task SaveAsync(NativeSession session, CancellationToken cancellationToken)
        {
            Session = session;
            return Task.CompletedTask;
        }

        public Task ClearAsync(CancellationToken cancellationToken)
        {
            Session = null;
            return Task.CompletedTask;
        }

        public Task<string> GetOrCreateClientDeviceIdAsync(CancellationToken cancellationToken)
            => Task.FromResult("desktop-test-device");
    }

    private sealed class StubHandler(
        Func<RecordedRequest, HttpResponseMessage> responder)
        : HttpMessageHandler
    {
        private readonly List<RecordedRequest> _requests = [];

        public IReadOnlyList<RecordedRequest> Requests => _requests;

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
                body);
            _requests.Add(recorded);
            return responder(recorded);
        }
    }
}
