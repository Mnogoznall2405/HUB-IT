using System.Net;
using System.Net.Http;
using System.Text;
using Hub.Desktop.Native.Api;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Контрактные тесты DLP-методов HubApiClient — пути, query-параметры и
/// десериализация ответов fs_egress.py (/inventory/dlp/*, probes, fs-egress).
/// </summary>
public sealed class NativeDlpApiContractTests
{
    private static string Access() => CreateAccessToken(DateTimeOffset.UtcNow.AddMinutes(30));

    [Fact]
    public async Task ListDlpHostsRequestsInventoryPathAndReadsRows()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/inventory/dlp/hosts" => Json(
                """
                {"success":true,"hosts":[
                  {"computer_name":"PC-01","windows_user":"PC-01\\user",
                   "user_login":"DOM\\ivanov","user_full_name":"Иван Иванов",
                   "branch_name":"Тюмень","branch_no":5,"file_events":12,
                   "usb_events":3,"telegram_events":4,"max_events":1,
                   "visits":42,"last_ts":1730000000}
                ]}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.ListDlpHostsAsync("entertainment", CancellationToken.None);

        var request = Assert.Single(handler.Requests, r => r.Path == "/api/v1/inventory/dlp/hosts");
        Assert.Equal("?category=entertainment", request.Query);
        var host = Assert.Single(result.Hosts!);
        Assert.Equal("PC-01", host.ComputerName);
        Assert.Equal("Иван Иванов", host.UserFullName);
        Assert.Equal(5, host.BranchNo!.Value.GetInt32());
        Assert.Equal(12, host.FileEvents);
        Assert.Equal(1730000000, host.LastTs);
    }

    [Fact]
    public async Task GetDlpSummaryAndAttentionHitExpectedRoutes()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/inventory/dlp/summary" => Json(
                """{"success":true,"summary":{"hosts_total":38,"hosts_active_today":12,"visits_today":431,"file_events_today":56,"categories_today":{"work":300,"entertainment":17}}}"""),
            "/api/v1/inventory/dlp/attention" => Json(
                """
                {"success":true,"hosts":[
                  {"computer_name":"PC-01","user_full_name":"Иван Иванов","branch_name":"Тюмень",
                   "active_sec":7200,"away_sec":900,"entertainment_sec":600,
                   "usb_files":2,"usb_bytes":1048576,"messenger_files":5,
                   "break_sec":300,"offshift_sec":600,"last_ts":1730000000}
                ]}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var summary = await client.GetDlpSummaryAsync(CancellationToken.None);
        var attention = await client.GetDlpAttentionAsync("2026-03-02", CancellationToken.None);

        Assert.Equal(38, summary.Summary!.HostsTotal);
        Assert.Equal(300, summary.Summary.CategoriesToday!["work"]);
        var attentionRequest = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/inventory/dlp/attention");
        Assert.Equal("?day=2026-03-02", attentionRequest.Query);
        var row = Assert.Single(attention.Hosts!);
        Assert.Equal(7200, row.ActiveSec);
        Assert.Equal(300, row.BreakSec);
        Assert.Equal(600, row.OffshiftSec);
        Assert.Equal(5, row.MessengerFiles);
    }

    [Fact]
    public async Task GetDlpActivitySendsComputerAndDayAndReadsBuckets()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/inventory/dlp/activity" => Json(
                """
                {"success":true,
                 "buckets":[{"bucket_start":"2026-03-02T09:00:00+05:00","active_sec":280,"passive_sec":20,
                             "away_sec":0,"locked_sec":0,"break_sec":0,"offshift_sec":0,
                             "zone":"work","app":"chrome.exe"}],
                 "summary":{"active_sec":7200,"passive_sec":300,"away_sec":600,"locked_sec":100,
                            "break_sec":2700,"offshift_sec":1800,"active_offshift_sec":120,"activity_pct":88.9},
                 "apps_top":[{"app":"chrome.exe","sec":5000}],
                 "local_time":{"day":"2026-03-02","branch_name":"Тюмень","utc_offset_minutes":300,
                               "work_start_min":540,"work_end_min":1080,"lunch_start_min":780,
                               "lunch_end_min":825,"workdays_mask":31}}
                """),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var result = await client.GetDlpActivityAsync("PC-01", "2026-03-02", CancellationToken.None);

        var request = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/inventory/dlp/activity");
        Assert.Equal("?computer_name=PC-01&day=2026-03-02", request.Query);
        var bucket = Assert.Single(result.Buckets!);
        Assert.Equal("2026-03-02T09:00:00+05:00", bucket.BucketStart);
        Assert.Equal(280, bucket.ActiveSec);
        Assert.Equal("work", bucket.Zone);
        Assert.Equal("chrome.exe", bucket.App);
        Assert.Equal(88.9, result.Summary!.ActivityPct);
        Assert.Equal(120, result.Summary.ActiveOffshiftSec);
        Assert.Equal(540, result.LocalTime!.WorkStartMin);
        Assert.Equal(31, result.LocalTime.WorkdaysMask);
    }

    [Fact]
    public async Task WorkScheduleCrudMatchesRouterContract()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/inventory/dlp/work-schedules" => Json(
                """
                {"success":true,"branches":["Магадан","Тюмень"],
                 "items":[{"branch_name":"Тюмень","work_start_min":540,"work_end_min":1080,
                           "lunch_start_min":780,"lunch_end_min":825,"tz_offset_minutes":0,
                           "workdays_mask":31,"updated_by":"admin","updated_at":"2026-03-02T10:00:00"}]}
                """),
            "/api/v1/inventory/dlp/work-schedules/%D0%A2%D1%8E%D0%BC%D0%B5%D0%BD%D1%8C" =>
                Json("""{"success":true,"schedule":{"branch_name":"Тюмень"}}"""),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var list = await client.ListDlpWorkSchedulesAsync(CancellationToken.None);
        Assert.Equal(["Магадан", "Тюмень"], list.Branches!);
        var row = Assert.Single(list.Items!);
        Assert.Equal("Тюмень", row.BranchName);
        Assert.Equal(540, row.WorkStartMin);
        Assert.Equal(825, row.LunchEndMin);
        Assert.Equal("admin", row.UpdatedBy);

        var saved = await client.SaveDlpWorkScheduleAsync(
            "Тюмень", 540, 1080, 780, 825, 0, 31, CancellationToken.None);
        Assert.True(saved.Success);
        var put = Assert.Single(
            handler.Requests,
            r => r.Method == "PUT" && r.Path == "/api/v1/inventory/dlp/work-schedules/%D0%A2%D1%8E%D0%BC%D0%B5%D0%BD%D1%8C");
        Assert.Contains("\"work_start_min\":540", put.Body);
        Assert.Contains("\"work_end_min\":1080", put.Body);
        Assert.Contains("\"lunch_start_min\":780", put.Body);
        Assert.Contains("\"lunch_end_min\":825", put.Body);
        Assert.Contains("\"tz_offset_minutes\":0", put.Body);
        Assert.Contains("\"workdays_mask\":31", put.Body);

        await client.DeleteDlpWorkScheduleAsync("Тюмень", CancellationToken.None);
        Assert.Single(
            handler.Requests,
            r => r.Method == "DELETE" && r.Path == "/api/v1/inventory/dlp/work-schedules/%D0%A2%D1%8E%D0%BC%D0%B5%D0%BD%D1%8C");
    }

    [Fact]
    public async Task FsEgressAndProbeReadsMatchWebClient()
    {
        var handler = new StubHandler(request => request.Path switch
        {
            "/api/v1/auth/login" => Json(LoginPayload(Access())),
            "/api/v1/inventory/fs-egress" => Json(
                """{"success":true,"items":[{"ts":1730000000,"channel":"usb","file_name":"doc.pdf","size":1024,"count":2}],"total":1,"noise_hidden":7}"""),
            "/api/v1/inventory/telegram-probe" => Json(
                """{"success":true,"chats":[{"computer_name":"PC-01","chat_id":"-100","chat_name":"Работа","updated_at":1730000000,"messages":[{"direction":"in","time":"10:00","sender":"Босс","text":"Отчёт"}],"screenshots":["a.png"]}]}"""),
            "/api/v1/inventory/max-probe" => Json(
                """{"success":true,"chats":[{"computer_name":"PC-01","chat_id":"42","chat_name":"Отдел","messages":[]}]}"""),
            "/api/v1/inventory/browser-probe" => Json(
                """{"success":true,"items":[{"id":1,"computer_name":"PC-01","browser":"chrome","profile":"work","url":"https://ya.ru","title":"Яндекс","domain":"ya.ru","category":"search","category_display":"search","visited_at":"2026-03-02T10:00:00Z","dwell_sec":120,"idle_sec":5,"count":1}],"total":1}"""),
            _ => NotFound(),
        });
        using var client = CreateClient(handler);
        await client.LoginAsync("tester", "secret", CancellationToken.None);

        var files = await client.ListFsEgressEventsAsync("PC-01", "usb", 500, CancellationToken.None);
        var filesRequest = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/inventory/fs-egress");
        Assert.Equal("?limit=500&group=1&computer_name=PC-01&channel=usb", filesRequest.Query);
        Assert.Equal(7, files.NoiseHidden);
        Assert.Equal("usb", Assert.Single(files.Items!).Channel);
        Assert.Equal(2, files.Items![0].Count);

        var tg = await client.ListTelegramChatsAsync("PC-01", 200, CancellationToken.None);
        var tgRequest = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/inventory/telegram-probe");
        Assert.Equal("?limit=200&computer_name=PC-01", tgRequest.Query);
        var chat = Assert.Single(tg.Chats!);
        Assert.Equal("Работа", chat.ChatName);
        Assert.Equal("Босс", Assert.Single(chat.Messages!).Sender);
        Assert.Equal(["a.png"], chat.Screenshots!);

        var max = await client.ListMaxChatsAsync("PC-01", 200, CancellationToken.None);
        Assert.Single(handler.Requests, r => r.Path == "/api/v1/inventory/max-probe");
        Assert.Equal("Отдел", Assert.Single(max.Chats!).ChatName);

        var visits = await client.ListBrowserVisitsAsync("PC-01", "2026-03-02", 200, CancellationToken.None);
        var visitsRequest = Assert.Single(
            handler.Requests, r => r.Path == "/api/v1/inventory/browser-probe");
        Assert.Equal("?limit=200&merge=1&computer_name=PC-01&day=2026-03-02", visitsRequest.Query);
        var visit = Assert.Single(visits.Items!);
        Assert.Equal("Яндекс", visit.Title);
        Assert.Equal("search", visit.CategoryDisplay);
        Assert.Equal(120, visit.DwellSec);
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
        => $$"""{"status":"authenticated","access_token":"{{accessToken}}","refresh_token":"refresh-1","token_type":"bearer","user":{"id":7,"username":"tester","full_name":"Test User","role":"admin"},"session_id":"s-1"}""";

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
