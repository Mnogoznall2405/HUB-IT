using Hub.Desktop.Audio;
using Xunit;

namespace Hub.Desktop.Tests;

// The HRESULT/registry -> reason matrix decides which Russian hint the user sees.
// E2E cannot reproduce exclusive mode, privacy denial, a per-app Deny or a
// disabled endpoint, so the priority order is pinned here.
public sealed class DesktopMicrophoneDiagnosisClassifierTests
{
    private static readonly DesktopMicrophoneConsent Allowed = new("Allow", "Allow", "Allow", null);
    private static readonly DesktopMicrophoneAppConsent[] NoAppEntries = [];
    private static readonly DesktopMicrophoneDevice ActiveMic = new("{0.0.1}.{a}", "Микрофон", "active");
    private static readonly DesktopMicrophoneDevice DisabledMic = new("{0.0.1}.{b}", "Гарнитура", "disabled");

    private static DesktopMicrophoneReason Classify(
        DesktopMicrophoneProbeStatus probe,
        DesktopMicrophoneConsent? consent = null,
        DesktopMicrophoneAppConsent[]? apps = null,
        DesktopMicrophoneDevice[]? devices = null,
        bool hasDefault = true) =>
        DesktopMicrophoneDiagnosisClassifier.Classify(
            probe,
            consent ?? Allowed,
            apps ?? NoAppEntries,
            devices ?? [ActiveMic],
            hasDefault);

    [Theory]
    [InlineData(0x00000000u, DesktopMicrophoneProbeStatus.Ok)]
    [InlineData(0x8889000Au, DesktopMicrophoneProbeStatus.DeviceInUse)]
    [InlineData(0x80070005u, DesktopMicrophoneProbeStatus.AccessDenied)]
    [InlineData(0x88890004u, DesktopMicrophoneProbeStatus.DeviceInvalidated)]
    [InlineData(0x88890010u, DesktopMicrophoneProbeStatus.ServiceNotRunning)]
    [InlineData(0x80070490u, DesktopMicrophoneProbeStatus.NoDefaultDevice)]
    [InlineData(0x8889000Fu, DesktopMicrophoneProbeStatus.Failed)]
    [InlineData(0x80004005u, DesktopMicrophoneProbeStatus.Failed)]
    public void MapsCoreAudioHresults(uint hresult, DesktopMicrophoneProbeStatus expected)
    {
        Assert.Equal(expected, DesktopMicrophoneDiagnosisClassifier.MapProbeResult(unchecked((int)hresult)));
    }

    [Theory]
    [InlineData(0x1u, "active")]
    [InlineData(0x2u, "disabled")]
    [InlineData(0x4u, "notPresent")]
    [InlineData(0x8u, "unplugged")]
    [InlineData(0x3u, "unknown")]
    public void FormatsEndpointState(uint state, string expected)
    {
        Assert.Equal(expected, DesktopMicrophoneDiagnosisClassifier.FormatDeviceState(state));
    }

    [Theory]
    [InlineData(
        @"C:\Program Files\HUB-IT\HUB Desktop\HUB.Desktop.exe",
        "C:#Program Files#HUB-IT#HUB Desktop#HUB.Desktop.exe")]
    [InlineData(
        @"C:\Program Files (x86)\Microsoft\EdgeWebView\Application\141.0.3537.57\msedgewebview2.exe",
        "C:#Program Files (x86)#Microsoft#EdgeWebView#Application#141.0.3537.57#msedgewebview2.exe")]
    [InlineData(@"C:\a\..\b\app.exe", "C:#b#app.exe")]
    [InlineData("app.exe", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    public void BuildsConsentStoreKeyNameFromFullPath(string? path, string? expected)
    {
        Assert.Equal(expected, DesktopMicrophoneDiagnosisClassifier.ToConsentKeyName(path));
    }

    [Theory]
    [InlineData("Deny", null)]
    [InlineData(null, "Deny")]
    public void PerAppDenyWinsEvenWhenNativeCaptureWorks(string? user, string? machine)
    {
        var apps = new[]
        {
            new DesktopMicrophoneAppConsent("HUB.Desktop.exe", "Allow", null),
            new DesktopMicrophoneAppConsent("msedgewebview2.exe", user, machine),
        };
        Assert.Equal(DesktopMicrophoneReason.AppConsentDenied, Classify(DesktopMicrophoneProbeStatus.Ok, apps: apps));
    }

    [Fact]
    public void NativeCaptureOkWinsOverStaleGlobalConsentValues()
    {
        var denied = new DesktopMicrophoneConsent("Deny", "Deny", "Deny", 2);
        var apps = new[] { new DesktopMicrophoneAppConsent("msedgewebview2.exe", "Allow", null) };
        Assert.Equal(
            DesktopMicrophoneReason.NativeCaptureOk,
            Classify(DesktopMicrophoneProbeStatus.Ok, denied, apps));
    }

    [Theory]
    [InlineData("Allow", "Deny", "Allow", null)]
    [InlineData("Allow", "Allow", "Deny", null)]
    [InlineData(null, null, null, 2)]
    [InlineData(null, " deny ", null, null)]
    public void AnyGlobalPrivacySwitchOffMeansPrivacyDenied(string? user, string? nonPackaged, string? machine, int? policy)
    {
        var consent = new DesktopMicrophoneConsent(user, nonPackaged, machine, policy);
        Assert.Equal(DesktopMicrophoneReason.PrivacyDenied, Classify(DesktopMicrophoneProbeStatus.DeviceInUse, consent));
    }

    [Fact]
    public void StoreAppsSwitchAloneDoesNotBlockDesktopApp()
    {
        var consent = new DesktopMicrophoneConsent("Deny", "Allow", "Allow", null);
        Assert.False(DesktopMicrophoneDiagnosisClassifier.IsConsentDenied(consent));
        Assert.Equal(DesktopMicrophoneReason.ExclusiveInUse, Classify(DesktopMicrophoneProbeStatus.DeviceInUse, consent));
    }

    [Fact]
    public void AccessDeniedProbeIsPrivacyEvenWithoutRegistryValues()
    {
        Assert.Equal(
            DesktopMicrophoneReason.PrivacyDenied,
            Classify(DesktopMicrophoneProbeStatus.AccessDenied, new DesktopMicrophoneConsent(null, null, null, null)));
    }

    [Fact]
    public void AllowValuesAreNotTreatedAsDenied()
    {
        Assert.False(DesktopMicrophoneDiagnosisClassifier.IsConsentDenied(new("Allow", null, "Allow", 0)));
        Assert.False(DesktopMicrophoneDiagnosisClassifier.IsConsentDenied(new(null, null, null, 1)));
        Assert.False(DesktopMicrophoneDiagnosisClassifier.IsAppConsentDenied(
            [new DesktopMicrophoneAppConsent("HUB.Desktop.exe", "Allow", null)]));
    }

    [Fact]
    public void NoEndpointsMeansNoDevices()
    {
        Assert.Equal(
            DesktopMicrophoneReason.NoDevices,
            Classify(DesktopMicrophoneProbeStatus.NoDefaultDevice, devices: [], hasDefault: false));
    }

    [Fact]
    public void OnlyDisabledOrUnpluggedEndpointsMeansDevicesDisabled()
    {
        var unplugged = new DesktopMicrophoneDevice("{0.0.1}.{c}", "USB", "unplugged");
        Assert.Equal(
            DesktopMicrophoneReason.DevicesDisabled,
            Classify(DesktopMicrophoneProbeStatus.NoDefaultDevice, devices: [DisabledMic, unplugged], hasDefault: false));
    }

    [Fact]
    public void ActiveEndpointWithoutDefaultMeansNoDefaultDevice()
    {
        Assert.Equal(
            DesktopMicrophoneReason.NoDefaultDevice,
            Classify(DesktopMicrophoneProbeStatus.NoDefaultDevice, devices: [DisabledMic, ActiveMic], hasDefault: false));
    }

    [Theory]
    [InlineData(DesktopMicrophoneProbeStatus.DeviceInUse, DesktopMicrophoneReason.ExclusiveInUse)]
    [InlineData(DesktopMicrophoneProbeStatus.DeviceInvalidated, DesktopMicrophoneReason.DeviceInvalidated)]
    [InlineData(DesktopMicrophoneProbeStatus.ServiceNotRunning, DesktopMicrophoneReason.AudioServiceStopped)]
    [InlineData(DesktopMicrophoneProbeStatus.Failed, DesktopMicrophoneReason.ProbeFailed)]
    [InlineData(DesktopMicrophoneProbeStatus.NotRun, DesktopMicrophoneReason.ProbeFailed)]
    public void ProbeFailureOnHealthyConfigurationMapsToReason(
        DesktopMicrophoneProbeStatus probe,
        DesktopMicrophoneReason expected)
    {
        Assert.Equal(expected, Classify(probe));
    }

    [Fact]
    public void StoppedAudioServiceIsReportedEvenWhenEndpointsCannotBeListed()
    {
        Assert.Equal(
            DesktopMicrophoneReason.AudioServiceStopped,
            Classify(DesktopMicrophoneProbeStatus.ServiceNotRunning, devices: [], hasDefault: false));
    }
}
