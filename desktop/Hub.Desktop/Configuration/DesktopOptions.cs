using System.Text.Json;

namespace Hub.Desktop.Configuration;

public sealed record DesktopOptions(Uri BaseUri)
{
    private const string ConfigurationFileName = "appsettings.json";

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
        return FromBaseUrl(baseUrl, allowHttpLoopback: false);
#endif
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

        return new DesktopOptions(builder.Uri);
    }

    private sealed record ConfigurationDocument(string? BaseUrl);
}
