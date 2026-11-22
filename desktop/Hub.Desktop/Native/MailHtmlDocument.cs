namespace Hub.Desktop.Native;

/// <summary>
/// Документ-обёртка тела письма (body_html) для NavigateToString в ридере почты.
/// Добавляет meta charset, CSP (скрипты/фреймы/формы запрещены — дублирует
/// отключённые настройки CoreWebView2) и базовые стили под эффективную тему шелла.
/// Сам HTML вставляется как есть: письмо — недоверенный контент, но документ
/// изолирован настройками WebView2 (без скриптов, переходов и host-objects),
/// а внешние картинки грузятся анонимно из отдельного user-data профиля.
/// </summary>
internal static class MailHtmlDocument
{
    public static string Wrap(string? bodyHtml, bool isDark)
    {
        var body = string.IsNullOrWhiteSpace(bodyHtml) ? string.Empty : bodyHtml;
        var scheme = isDark ? "dark" : "light";
        // Цвета — те же ключи, что в HubColorsDark/HubColorsLight
        // (поверхность/текст/вторичный/акцент/граница; граница в палитре
        // полупрозрачная — здесь её композитный эквивалент на поверхности).
        var background = isDark ? "#24282F" : "#FFFFFF";
        var text = isDark ? "#F0F2F5" : "#1D2126";
        var secondary = isDark ? "#A3AAB4" : "#5B626C";
        var link = isDark ? "#3FB9F4" : "#0067C0";
        var border = isDark ? "#3D424B" : "#DFE0E3";
        return "<!DOCTYPE html><html><head>" +
            "<meta charset=\"utf-8\" />" +
            // Title документа — имя Document в дереве UIA (скринридер).
            "<title>Текст письма</title>" +
            $"<meta name=\"color-scheme\" content=\"{scheme}\" />" +
            "<meta http-equiv=\"Content-Security-Policy\" content=\"" +
            "default-src 'none'; script-src 'none'; " +
            "img-src http: https: data: cid:; " +
            "style-src 'unsafe-inline'; " +
            "font-src http: https: data:; " +
            "media-src http: https: data:;" +
            "\" />" +
            "<style>" +
            "html,body{margin:0;padding:0;}" +
            $"body{{color:{text};background:{background};" +
            "font:13px/1.5 \"Segoe UI Variable Text\",\"Segoe UI\",sans-serif;" +
            "overflow-wrap:anywhere;word-wrap:break-word;}" +
            "img{max-width:100%;height:auto;}" +
            $"a{{color:{link};}}" +
            $"blockquote{{margin:8px 0;padding:2px 12px;border-left:3px solid {border};color:{secondary};}}" +
            "pre{white-space:pre-wrap;font-family:inherit;}" +
            "table{border-collapse:collapse;max-width:100%;}" +
            "td,th{overflow-wrap:anywhere;}" +
            $"hr{{border:0;border-top:1px solid {border};}}" +
            "</style>" +
            "</head><body>" +
            body +
            "</body></html>";
    }
}
