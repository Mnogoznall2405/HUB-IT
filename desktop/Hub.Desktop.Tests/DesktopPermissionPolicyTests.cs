using Hub.Desktop.Security;
using Microsoft.Web.WebView2.Core;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopPermissionPolicyTests
{
    private readonly NavigationPolicy _policy = new(
        new Uri("https://hubit.zsgp.ru/"),
        new Uri("https://adfs.zsgp.ru/"));

    [Theory]
    [InlineData(CoreWebView2PermissionKind.Microphone)]
    [InlineData(CoreWebView2PermissionKind.Camera)]
    public void AllowsMicrophoneAndCameraForTrustedOrigin(CoreWebView2PermissionKind kind)
    {
        Assert.Equal(
            DesktopPermissionDecision.Allow,
            DesktopPermissionPolicy.Evaluate(_policy, "https://hubit.zsgp.ru", kind));
        Assert.Equal(
            DesktopPermissionDecision.Allow,
            DesktopPermissionPolicy.Evaluate(_policy, "https://HUBIT.zsgp.ru:443/chat", kind));
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru.evil.example")]
    [InlineData("https://evil.example/?next=https://hubit.zsgp.ru/")]
    [InlineData("https://hubit.zsgp.ru:8443")]
    [InlineData("http://hubit.zsgp.ru")]
    [InlineData("https://adfs.zsgp.ru/adfs/ls")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("not a uri")]
    public void DeniesEveryPermissionForOtherOrigins(string? uri)
    {
        foreach (var kind in Enum.GetValues<CoreWebView2PermissionKind>())
        {
            Assert.Equal(
                DesktopPermissionDecision.Deny,
                DesktopPermissionPolicy.Evaluate(_policy, uri, kind));
        }
    }

    [Fact]
    public void KeepsDefaultPromptForOtherKindsOfTrustedOrigin()
    {
        foreach (var kind in Enum.GetValues<CoreWebView2PermissionKind>()
            .Where(k => k is not (CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera)))
        {
            Assert.Equal(
                DesktopPermissionDecision.Default,
                DesktopPermissionPolicy.Evaluate(_policy, "https://hubit.zsgp.ru/", kind));
        }
    }

    [Theory]
    [InlineData("https://hubit.zsgp.ru", CoreWebView2PermissionKind.Microphone, true)]
    [InlineData("https://hubit.zsgp.ru", CoreWebView2PermissionKind.Camera, true)]
    [InlineData("https://hubit.zsgp.ru", CoreWebView2PermissionKind.Notifications, false)]
    [InlineData("https://hubit.zsgp.ru", CoreWebView2PermissionKind.Geolocation, false)]
    [InlineData("https://evil.example", CoreWebView2PermissionKind.Microphone, false)]
    [InlineData("https://adfs.zsgp.ru", CoreWebView2PermissionKind.Camera, false)]
    public void ResetsOnlyStoredDenyOfPortalMicrophoneAndCamera(
        string origin,
        CoreWebView2PermissionKind kind,
        bool expected)
    {
        Assert.Equal(
            expected,
            DesktopPermissionPolicy.ShouldResetStoredDeny(_policy, origin, kind, CoreWebView2PermissionState.Deny));
        Assert.False(
            DesktopPermissionPolicy.ShouldResetStoredDeny(_policy, origin, kind, CoreWebView2PermissionState.Allow));
        Assert.False(
            DesktopPermissionPolicy.ShouldResetStoredDeny(_policy, origin, kind, CoreWebView2PermissionState.Default));
    }
}
