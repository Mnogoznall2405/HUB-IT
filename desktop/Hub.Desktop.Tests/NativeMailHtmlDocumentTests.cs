using Hub.Desktop.Native;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Обёртка html-тела письма для NavigateToString: кодировка, CSP-изоляция
/// и базовые стили под тёмную/светлую тему шелла.
/// </summary>
public sealed class NativeMailHtmlDocumentTests
{
    [Fact]
    public void WrapKeepsBodyVerbatimAndDeclaresUtf8()
    {
        const string html = "<p>Привет, <b>коллеги</b>!</p><table><tr><td>1</td></tr></table>";

        var document = MailHtmlDocument.Wrap(html, isDark: true);

        Assert.StartsWith("<!DOCTYPE html>", document);
        Assert.Contains("<meta charset=\"utf-8\"", document);
        // body_html вставляется как есть — не экранируется: это и есть рендер.
        Assert.Contains(html, document);
        Assert.EndsWith("</body></html>", document);
    }

    [Fact]
    public void WrapDeclaresCspBlockingScriptsAndFrames()
    {
        var document = MailHtmlDocument.Wrap("<p>x</p>", isDark: true);

        Assert.Contains("Content-Security-Policy", document);
        Assert.Contains("default-src 'none'", document);
        Assert.Contains("script-src 'none'", document);
        // Внешние картинки письма разрешены (как в веб-почте).
        Assert.Contains("img-src http: https: data: cid:", document);
    }

    [Fact]
    public void WrapDarkThemeUsesDarkPalette()
    {
        var document = MailHtmlDocument.Wrap("<p>x</p>", isDark: true);

        Assert.Contains("content=\"dark\"", document);
        // Ключи HubColorsDark: поверхность/текст/акцент.
        Assert.Contains("background:#24282F", document);
        Assert.Contains("color:#F0F2F5", document);
        Assert.Contains("color:#3FB9F4", document);
    }

    [Fact]
    public void WrapLightThemeUsesLightPalette()
    {
        var document = MailHtmlDocument.Wrap("<p>x</p>", isDark: false);

        Assert.Contains("content=\"light\"", document);
        // Ключи HubColorsLight: поверхность/текст/акцент.
        Assert.Contains("background:#FFFFFF", document);
        Assert.Contains("color:#1D2126", document);
        Assert.Contains("color:#0067C0", document);
    }

    [Fact]
    public void WrapDeclaresDocumentTitleForUiAutomation()
    {
        var document = MailHtmlDocument.Wrap("<p>x</p>", isDark: true);

        // Без title UIA-Document WebView2 объявляется пустым именем.
        Assert.Contains("<title>Текст письма</title>", document);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void WrapEmptyBodyStillBuildsValidDocument(string? bodyHtml)
    {
        var document = MailHtmlDocument.Wrap(bodyHtml, isDark: true);

        Assert.Contains("</head><body>", document);
        Assert.EndsWith("</body></html>", document);
    }
}
