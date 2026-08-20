using System.IO;
using System.Text.Json;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Configuration;

public sealed record DesktopUpdateOptions(
    bool Enabled,
    Uri ManifestUri,
    TimeSpan InitialDelayMinimum,
    TimeSpan InitialDelayMaximum,
    TimeSpan CheckInterval,
    TimeSpan RetryDelay);

public sealed record DesktopOptions(Uri BaseUri, DesktopUpdateOptions Updates)
{
    private const string ConfigurationFileName = "appsettings.json";
    private static readonly Uri ProductionBaseUri = new("https://hubit.zsgp.ru/");
    private const string StableManifestPath = "/desktop-updates/stable/latest.json";

    public static DesktopOptions Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, ConfigurationFileName);
        var document = JsonSerializer.Deserialize<ConfigurationDocument>(File.ReadAllText(path))
            ?? throw new InvalidOperationException("Desktop configuration is empty.");

        var baseUrl = document.BaseUrl;

#if DEBUG
        baseUrl = Environment.GetEnvironmentVariable("HUB_DESKTOP_BASE_URL") ?? baseUrl;
        return FromBaseUrl(baseUrl, allowHttpLoopback: true);
#else
#if PERF_BENCH
        if (DesktopPerfBench.IsEnabled)
        {
            var benchBaseUrl = Environment.GetEnvironmentVariable("HUB_DESKTOP_BASE_URL");
            if (!string.IsNullOrWhiteSpace(benchBaseUrl))
            {
                return FromBaseUrl(benchBaseUrl, allowHttpLoopback: true);
            }
        }
#endif
        var options = FromProductionBaseUrl(baseUrl);
        if (document.Updates?.Enabled is false)
        {
            throw new InvalidOperationException("Release updates cannot be disabled in appsettings.");
        }

        if (document.Updates?.ManifestPath is not null
            && !string.Equals(
                document.Updates.ManifestPath,
                StableManifestPath,
                StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Release update manifest path is fixed.");
        }

        return options;
#endif
    }

    public static DesktopOptions FromProductionBaseUrl(string? baseUrl)
    {
        var options = FromBaseUrl(baseUrl);

        if (options.BaseUri != ProductionBaseUri)
        {
            throw new InvalidOperationException("Release BaseUrl must use the HUB production origin.");
        }

        return options;
    }

    public static DesktopOptions FromBaseUrl(string? baseUrl, bool allowHttpLoopback = false)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri))
        {
            throw new InvalidOperationException("BaseUrl must be an absolute URI.");
        }

        var isHttps = uri.Scheme.Equals(Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase);
        var isAllowedDevelopmentUrl = allowHttpLoopback
            && uri.Scheme.Equals(Uri.UriSchemeHttp, StringComparison.OrdinalIgnoreCase)
            && uri.IsLoopback;

        if (!isHttps && !isAllowedDevelopmentUrl)
        {
            throw new InvalidOperationException("BaseUrl must use HTTPS.");
        }

        if (!string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query)
            || !string.IsNullOrEmpty(uri.Fragment)
            || uri.AbsolutePath != "/")
        {
            throw new InvalidOperationException("BaseUrl must contain only an origin.");
        }

        var builder = new UriBuilder(uri)
        {
            Path = "/",
            Query = string.Empty,
            Fragment = string.Empty,
        };

        var normalizedBaseUri = builder.Uri;
        return new DesktopOptions(
            normalizedBaseUri,
            new DesktopUpdateOptions(
                Enabled: true,
                ManifestUri: new Uri(normalizedBaseUri, StableManifestPath),
                InitialDelayMinimum: TimeSpan.FromSeconds(30),
                InitialDelayMaximum: TimeSpan.FromSeconds(120),
                CheckInterval: TimeSpan.FromHours(12),
                RetryDelay: TimeSpan.FromMinutes(15)));
    }

    private sealed record ConfigurationDocument(
        string? BaseUrl,
        UpdateConfigurationDocument? Updates);

    private sealed record UpdateConfigurationDocument(
        bool? Enabled,
        string? ManifestPath);
}
