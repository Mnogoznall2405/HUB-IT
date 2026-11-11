using System.Text.RegularExpressions;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.BrowserProbe;

/// <summary>Domain/title classification and noise filtering (parity with browser_probe/classify.py).</summary>
public static partial class BrowserClassify
{
    private static readonly string[] EntertainmentSuffixes =
    {
        "youtube.com", "youtu.be", "rutube.ru", "twitch.tv", "netflix.com", "kinopoisk.ru", "ivi.ru",
        "okko.tv", "premier.one", "more.tv", "wink.ru", "vkvideo.ru", "vimeo.com", "tiktok.com",
        "instagram.com", "pornhub.com", "xvideos.com", "reddit.com", "pikabu.ru", "dtf.ru",
        "steamcommunity.com", "store.steampowered.com", "youtubekids.com", "music.yandex.ru",
        "music.youtube.com",
    };

    private static readonly string[] DefaultWorkSuffixes =
    {
        "kontur.ru", "diadoc.ru", "sbis.ru", "1c.ru", "1c.eu", "bitrix24.ru", "bitrix24.com",
        "microsoftonline.com", "office.com", "sharepoint.com", "teams.microsoft.com", "atlassian.net",
        "jira.com", "confluence.com", "notion.so", "github.com", "gitlab.com", "hubit.zsgp.ru", "zsgp.ru",
    };

    private static readonly string[] NoiseUrlPrefixes =
    {
        "chrome://", "chrome-extension://", "chrome-search://", "chrome-devtools://", "edge://",
        "devtools://", "about:blank", "about:newtab", "about:home", "browser://", "yandexbrowser://",
        "view-source:",
    };

    [GeneratedRegex(
        @"(\bфильм\b|\bкино\b|\bсериал\b|\bсмотреть\b|\bonline\s*cinema\b|\byoutube\b|\brutube\b|" +
        @"\btwitch\b|\bnetflix\b|\bkinopoisk\b|\bminecraft\s*фильм\b|\btrailer\b|\bклип\b|\bстрим\b|" +
        @"\bигра(ть|ю|ем)?\b.*\b(смотр|фильм|трейлер)\b)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex EntertainmentTitle();

    [GeneratedRegex(
        @"(\bконтур\b|\bdiadoc\b|\bсбис\b|\b1[cс]\b|\bbitrix\b|\bjira\b|\bconfluence\b|\boutlook\b|" +
        @"\bteams\b|\bhub-?it\b|\bintranet\b|\bкорпоратив)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex WorkTitle();

    [GeneratedRegex(
        @"^(новая вкладка|new tab|новая вкладка — .+|start page|домашняя страница|page d['’]accueil|" +
        @"nueva pestaña|nouvel onglet)\s*$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex NoiseTitle();

    public static string ExtractDomain(string? url)
    {
        var raw = Text.Sanitize(url);
        if (raw.Length == 0)
        {
            return string.Empty;
        }

        if (!Uri.TryCreate(raw.Contains("://") ? raw : "https://" + raw, UriKind.Absolute, out var uri))
        {
            return string.Empty;
        }

        var host = uri.Host.ToLowerInvariant().Trim('.');
        return host.StartsWith("www.", StringComparison.Ordinal) ? host[4..] : host;
    }

    public static (string Domain, string Category) Classify(string? url, string? title)
    {
        var domain = ExtractDomain(url);
        var byDomain = domain.Length == 0 ? "other" : ClassifyDomain(domain);
        if (byDomain != "other")
        {
            return (domain, byDomain);
        }

        return (domain, ClassifyTitle(title));
    }

    public static string ClassifyDomain(string domain)
    {
        var value = Text.Sanitize(domain).ToLowerInvariant().Trim('.');
        if (value.Length == 0)
        {
            return "other";
        }

        if (MatchesSuffix(value, WorkDomains()))
        {
            return "work";
        }

        return MatchesSuffix(value, EntertainmentSuffixes) ? "entertainment" : "other";
    }

    public static string ClassifyTitle(string? title)
    {
        var text = Text.Sanitize(title);
        if (text.Length == 0)
        {
            return "other";
        }

        if (WorkTitle().IsMatch(text))
        {
            return "work";
        }

        return EntertainmentTitle().IsMatch(text) ? "entertainment" : "other";
    }

    public static bool IsNoise(string? url, string? title)
    {
        var rawUrl = Text.Sanitize(url);
        var rawTitle = Text.Sanitize(title);
        var lowerUrl = rawUrl.ToLowerInvariant();

        if (rawUrl.Length == 0 && rawTitle.Length == 0)
        {
            return true;
        }

        if (NoiseUrlPrefixes.Any(prefix => lowerUrl.StartsWith(prefix, StringComparison.Ordinal)))
        {
            return true;
        }

        if (lowerUrl.Length == 0 || lowerUrl == "about:blank")
        {
            if (rawTitle.Length == 0 || NoiseTitle().IsMatch(rawTitle))
            {
                return true;
            }
        }

        if (NoiseTitle().IsMatch(rawTitle))
        {
            return true;
        }

        return lowerUrl.Contains("newtab", StringComparison.Ordinal)
               || lowerUrl.Contains("/_/chrome/newtab", StringComparison.Ordinal);
    }

    private static HashSet<string> WorkDomains()
    {
        var domains = new HashSet<string>(DefaultWorkSuffixes, StringComparer.OrdinalIgnoreCase);
        var extra = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_BROWSER_WORK_DOMAINS"));
        foreach (var part in extra.Split(new[] { ',', ';', ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var domain = part.Trim().ToLowerInvariant().TrimStart('.');
            if (domain.StartsWith("www.", StringComparison.Ordinal))
            {
                domain = domain[4..];
            }

            if (domain.Length > 0)
            {
                domains.Add(domain);
            }
        }

        return domains;
    }

    private static bool MatchesSuffix(string domain, IEnumerable<string> suffixes)
        => suffixes.Any(suffix =>
            domain.Equals(suffix, StringComparison.OrdinalIgnoreCase)
            || domain.EndsWith("." + suffix, StringComparison.OrdinalIgnoreCase));
}
