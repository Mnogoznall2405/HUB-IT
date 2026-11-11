using System.Diagnostics;
using System.Text.Json;
using Hub.Desktop.Interop;
using Hub.Desktop.Audio;
using Hub.Desktop.Security;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopMicrophoneBridgeTests
{
    private const string TrustedSource = "https://hubit.zsgp.ru/chat?conversation=7";
    private static readonly string[] Executables =
    [
        @"C:\Program Files\HUB-IT\HUB Desktop\HUB.Desktop.exe",
    ];

    private readonly NavigationPolicy _policy = new(new Uri("https://hubit.zsgp.ru/"), new Uri("https://adfs.zsgp.ru/"));
    private readonly List<ProcessStartInfo> _started = [];
    private readonly FakeDiagnostics _diagnostics = new();

    private DesktopMicrophoneBridge CreateBridge(TimeSpan? timeout = null) => new(
        _policy,
        _diagnostics,
        startInfo =>
        {
            _started.Add(startInfo);
            return true;
        },
        timeout ?? TimeSpan.FromSeconds(5));

    private static DesktopMicrophoneDiagnosis SampleDiagnosis() => new(
        [new DesktopMicrophoneDevice("{0.0.1}.{a}", "Микрофон", "active")],
        new DesktopMicrophoneDevice("{0.0.1}.{a}", "Микрофон", "active"),
        null,
        new DesktopMicrophoneConsent("Allow", "Allow", "Allow", null),
        [new DesktopMicrophoneAppConsent("msedgewebview2.exe", "Deny", null)],
        DesktopMicrophoneProbeStatus.DeviceInUse,
        unchecked((int)0x8889000A),
        DesktopMicrophoneReason.ExclusiveInUse);

    [Theory]
    [InlineData(DesktopMediaSettingsKind.PrivacyMicrophone, "ms-settings:privacy-microphone")]
    [InlineData(DesktopMediaSettingsKind.Sound, "ms-settings:sound")]
    public void OpensOnlyTheFixedSettingsPageForTrustedPortal(DesktopMediaSettingsKind kind, string uri)
    {
        Assert.True(CreateBridge().OpenSettings(TrustedSource, kind));

        var startInfo = Assert.Single(_started);
        Assert.Equal(uri, startInfo.FileName);
        Assert.True(startInfo.UseShellExecute);
        Assert.Equal(string.Empty, startInfo.Arguments);
    }

    [Theory]
    [InlineData("https://evil.example/")]
    [InlineData("https://hubit.zsgp.ru.evil.example/")]
    [InlineData("https://adfs.zsgp.ru/adfs/ls")]
    [InlineData("about:blank")]
    [InlineData(null)]
    public async Task RefusesSettingsAndDiagnosticsForForeignDocuments(string? source)
    {
        var bridge = CreateBridge();
        var siteInspected = false;

        Assert.False(bridge.OpenSettings(source, DesktopMediaSettingsKind.Sound));
        Assert.Null(await bridge.CreateDiagnosisResponseAsync(
            source,
            "req-1",
            Executables,
            () =>
            {
                siteInspected = true;
                return Task.FromResult<DesktopSiteMediaPermissions?>(null);
            }));
        Assert.Empty(_started);
        Assert.Equal(0, _diagnostics.Calls);
        Assert.False(siteInspected);
    }

    [Fact]
    public async Task ReturnsDiagnosisWithSitePermissionsForTrustedPortal()
    {
        _diagnostics.Result = SampleDiagnosis();

        var json = await CreateBridge().CreateDiagnosisResponseAsync(
            TrustedSource,
            "req-1",
            Executables,
            () => Task.FromResult<DesktopSiteMediaPermissions?>(new("deny", "default", true)));

        Assert.Equal(Executables, _diagnostics.LastPaths);
        using var document = JsonDocument.Parse(json!);
        var root = document.RootElement;
        Assert.Equal("media.microphoneDiagnosis", root.GetProperty("type").GetString());
        Assert.Equal("req-1", root.GetProperty("requestId").GetString());
        Assert.Equal("completed", root.GetProperty("status").GetString());
        var diagnosis = root.GetProperty("diagnosis");
        Assert.Equal("exclusiveInUse", diagnosis.GetProperty("reason").GetString());
        Assert.Equal("deviceInUse", diagnosis.GetProperty("probe").GetString());
        Assert.Equal("0x8889000A", diagnosis.GetProperty("probeHresult").GetString());
        Assert.Equal("Микрофон", diagnosis.GetProperty("devices")[0].GetProperty("name").GetString());
        Assert.Equal(JsonValueKind.Null, diagnosis.GetProperty("defaultCommunications").ValueKind);
        Assert.Equal("Allow", diagnosis.GetProperty("consent").GetProperty("userNonPackaged").GetString());
        var app = diagnosis.GetProperty("apps")[0];
        Assert.Equal("msedgewebview2.exe", app.GetProperty("name").GetString());
        Assert.Equal("Deny", app.GetProperty("user").GetString());
        Assert.False(app.TryGetProperty("path", out _));
        Assert.Equal("deny", diagnosis.GetProperty("site").GetProperty("microphone").GetString());
        Assert.True(diagnosis.GetProperty("site").GetProperty("repaired").GetBoolean());
    }

    [Fact]
    public async Task SitePermissionFailureKeepsNativeDiagnosis()
    {
        _diagnostics.Result = SampleDiagnosis();

        var json = await CreateBridge().CreateDiagnosisResponseAsync(
            TrustedSource,
            "req-4",
            Executables,
            () => Task.FromException<DesktopSiteMediaPermissions?>(new InvalidOperationException()));

        using var document = JsonDocument.Parse(json!);
        Assert.Equal("completed", document.RootElement.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("diagnosis").GetProperty("site").ValueKind);
    }

    [Fact]
    public async Task ReportsFailedStatusWhenDiagnosticsThrows()
    {
        _diagnostics.Error = new InvalidOperationException("COM failure");

        var json = await CreateBridge().CreateDiagnosisResponseAsync(TrustedSource, "req-2", Executables);

        using var document = JsonDocument.Parse(json!);
        Assert.Equal("failed", document.RootElement.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("diagnosis").ValueKind);
    }

    [Fact]
    public async Task ReportsFailedStatusWhenDiagnosticsHangs()
    {
        _diagnostics.Delay = TimeSpan.FromSeconds(10);

        var json = await CreateBridge(TimeSpan.FromMilliseconds(50))
            .CreateDiagnosisResponseAsync(TrustedSource, "req-3", Executables);

        using var document = JsonDocument.Parse(json!);
        Assert.Equal("failed", document.RootElement.GetProperty("status").GetString());
    }

    [Theory]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"privacy-microphone\"}", DesktopMediaSettingsKind.PrivacyMicrophone)]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"sound\"}", DesktopMediaSettingsKind.Sound)]
    public void ParsesAllowListedSettingsKinds(string json, DesktopMediaSettingsKind expected)
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(json, out var message));
        Assert.Equal(DesktopInboundMessageType.OpenMediaSettings, message.Type);
        Assert.Equal(expected, message.MediaSettings);
    }

    [Theory]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"ms-settings:privacy-microphone\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"privacy-webcam\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"Sound\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"file:///C:/Windows/System32/cmd.exe\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":\"sound\",\"uri\":\"ms-settings:display\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":2,\"kind\":\"sound\"}")]
    [InlineData("{\"type\":\"media.openSettings\",\"version\":1,\"kind\":1}")]
    public void RejectsSettingsRequestsOutsideAllowList(string json)
    {
        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Fact]
    public void ParsesStrictMicrophoneDiagnoseRequest()
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(
            "{\"type\":\"media.microphoneDiagnose\",\"version\":1,\"requestId\":\"mic-1_a\"}",
            out var message));
        Assert.Equal(DesktopInboundMessageType.DiagnoseMicrophone, message.Type);
        Assert.Equal("mic-1_a", message.RequestId);

        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            "{\"type\":\"media.microphoneDiagnose\",\"version\":1}", out _));
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            "{\"type\":\"media.microphoneDiagnose\",\"version\":1,\"requestId\":\"a b\"}", out _));
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            "{\"type\":\"media.microphoneDiagnose\",\"version\":1,\"requestId\":\"a\",\"x\":1}", out _));
    }

    private sealed class FakeDiagnostics : IDesktopMicrophoneDiagnostics
    {
        public int Calls { get; private set; }

        public IReadOnlyList<string>? LastPaths { get; private set; }

        public DesktopMicrophoneDiagnosis? Result { get; set; }

        public Exception? Error { get; set; }

        public TimeSpan Delay { get; set; }

        public DesktopMicrophoneDiagnosis Diagnose(IReadOnlyList<string> executablePaths)
        {
            Calls++;
            LastPaths = executablePaths;
            if (Delay > TimeSpan.Zero)
            {
                Thread.Sleep(Delay);
            }

            if (Error is not null)
            {
                throw Error;
            }

            return Result ?? throw new InvalidOperationException("No result configured.");
        }
    }
}
