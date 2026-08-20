using Hub.Desktop.Configuration;
using Hub.Desktop.Diagnostics;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopPerfBenchTests
{
    [Fact]
    public void IsTruthyOnlyAcceptsExplicitOne()
    {
        Assert.True(DesktopPerfBench.IsTruthy("1"));
        Assert.True(DesktopPerfBench.IsTruthy(" 1 "));
        Assert.False(DesktopPerfBench.IsTruthy("true"));
        Assert.False(DesktopPerfBench.IsTruthy("0"));
        Assert.False(DesktopPerfBench.IsTruthy(null));
        Assert.False(DesktopPerfBench.IsTruthy(""));
    }

    [Fact]
    public void ApplicationIdStaysStableForNormalRelease()
    {
        if (DesktopPerfBench.IsEnabled)
        {
#if PERF_BENCH
            Assert.Equal(DesktopPerfBench.BenchApplicationId, DesktopPerfBench.ApplicationId);
#endif
            return;
        }

        Assert.Equal("HUBIT.Desktop", DesktopPerfBench.ApplicationId);
        Assert.False(DesktopPerfBench.TryGetIsolatedRoot(out _));
        Assert.False(DesktopPerfBench.TryGetUserDataFolder(out _));
        Assert.False(DesktopPerfBench.TryGetQuitAfter(out _));
    }

    [Fact]
    public void DefaultUserDataFolderStaysUnderLocalAppDataWhenBenchDisabled()
    {
        if (DesktopPerfBench.IsEnabled)
        {
            return;
        }

        Assert.Contains("HUB-IT", DesktopPaths.UserDataFolder, StringComparison.Ordinal);
        Assert.EndsWith("WebView2", DesktopPaths.UserDataFolder, StringComparison.Ordinal);
    }

    [Fact]
    public void InjectedScriptsDoNotIncludeUrlsOrRouteIdentifiers()
    {
        var probe = DesktopPerfBench.CreateFrontendProbeScript();
        if (DesktopPerfBench.IsEnabled)
        {
            Assert.Equal("window.__HUB_DESKTOP_PERF_BENCH=true;", DesktopPerfBench.CreateDocumentCreatedScript());
        }
        else
        {
            Assert.Equal(string.Empty, DesktopPerfBench.CreateDocumentCreatedScript());
        }
        Assert.DoesNotContain("http", probe, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("pathname", probe, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("location", probe, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("first-contentful-paint", probe, StringComparison.Ordinal);
    }

    [Fact]
    public void GenerateTotpMatchesRfc6238Sha1Vector()
    {
        var code = DesktopPerfBench.GenerateTotp(
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            unixSeconds: 59);

        Assert.Equal("287082", code);
    }

    [Fact]
    public void AutoLoginScriptsStayDisabledWithoutBenchLoginEnv()
    {
        Assert.False(DesktopPerfBench.HasAutoLogin);
        Assert.Null(DesktopPerfBench.CreatePasswordLoginScript());
        Assert.Null(DesktopPerfBench.CreateTotpLoginScript());
        Assert.Null(DesktopPerfBench.GetNavigatePath());
        Assert.Null(DesktopPerfBench.CreateNavigateScript());
    }

    [Theory]
    [InlineData("/dashboard", "/dashboard")]
    [InlineData("chat", "/chat")]
    [InlineData("/mail/", "/mail")]
    [InlineData("/tasks", "/tasks")]
    public void NavigatePathAllowsKnownPortalRoutes(string raw, string expected)
    {
        Assert.True(DesktopPerfBench.TryNormalizeNavigatePath(raw, out var path));
        Assert.Equal(expected, path);
    }

    [Theory]
    [InlineData("")]
    [InlineData("/")]
    [InlineData("/settings")]
    [InlineData("https://example.com")]
    [InlineData("/chat?x=1")]
    public void NavigatePathRejectsUnknownRoutes(string raw)
    {
        Assert.False(DesktopPerfBench.TryNormalizeNavigatePath(raw, out _));
    }
}
