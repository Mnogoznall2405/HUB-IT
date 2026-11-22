using System.Windows;
using System.Windows.Media;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Векторные иконки интерфейса (24×24, fill-пути в духе Material/Telegram).
/// Геометрия заморожена и разделяется между всеми потребителями; из XAML —
/// {x:Static local:VectorIcons.Search}, из кода — напрямую. Эмодзи как
/// иконки хрома не используем: они цветные и не следуют Foreground темы.
/// </summary>
public static class VectorIcons
{
    private static Geometry G(string data)
    {
        var geometry = Geometry.Parse(data);
        geometry.Freeze();
        return geometry;
    }

    public static readonly Geometry Search = G(
        "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 " +
        "5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 " +
        "5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z");

    public static readonly Geometry Send = G(
        "M2.01 21L23 12 2.01 3 2 10l15 2-15 2z");

    public static readonly Geometry Mic = G(
        "M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" +
        "m5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28" +
        "c3.28-.48 6-3.3 6-6.72h-1.7z");

    public static readonly Geometry Emoji = G(
        "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2z" +
        "M12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm3.5-9c.83 0 1.5-.67 " +
        "1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 " +
        "1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 " +
        "5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z");

    public static readonly Geometry Attach = G(
        "M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 " +
        "2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H9v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 " +
        "2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 " +
        "5.5-5.5V6h-1.5z");

    public static readonly Geometry Pin = G(
        "M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 " +
        "3-3 3h-.99c-.55 0-1 .45-1 1s.45 1 1 1h5v6c0 .55.45 1 1 1s1-.45 1-1v-6h5c.55 0 " +
        "1-.45 1-1s-.45-1-1-1H17c-1.66 0-3-1.34-3-3z");

    public static readonly Geometry Menu = G(
        "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z");

    public static readonly Geometry MoreVertical = G(
        "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 " +
        "2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z");

    public static readonly Geometry MoreHoriz = G(
        "M6 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm12 0c-1.1 0-2 .9-2 2s.9 2 " +
        "2 2 2-.9 2-2-.9-2-2-2zm-6 0c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z");

    public static readonly Geometry ArrowDown = G(
        "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z");

    public static readonly Geometry ArrowUp = G(
        "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58-5.59L20 12l-8-8-8 8z");

    public static readonly Geometry Upload = G(
        "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z");

    public static readonly Geometry Download = G(
        "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z");

    public static readonly Geometry Play = G(
        "M8 5v14l11-7z");

    public static readonly Geometry Pause = G(
        "M6 19h4V5H6v14zm8-14v14h4V5h-4z");

    /// <summary>«Открыть в другом приложении» (open_in_new).</summary>
    public static readonly Geometry OpenInNew = G(
        "M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7z" +
        "M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z");

    public static readonly Geometry ChevronLeft = G(
        "M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z");

    public static readonly Geometry ChevronRight = G(
        "M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z");

    public static readonly Geometry ChevronDown = G(
        "M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z");

    public static readonly Geometry Close = G(
        "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 " +
        "17.59 19 19 17.59 13.41 12z");

    public static readonly Geometry Trash = G(
        "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z");

    public static readonly Geometry Check = G(
        "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z");

    public static readonly Geometry DoneAll = G(
        "M18 7l-1.41-1.41-6.34 6.34 1.41 1.41L18 7zm4.24-1.41L11.66 16.17 7.48 12l-1.41 " +
        "1.41L11.66 19l12-12-1.42-1.41zM.41 13.41L6 19l1.41-1.41L1.83 12 .41 13.41z");

    public static readonly Geometry Edit = G(
        "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 " +
        "0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z");

    public static readonly Geometry Exit = G(
        "M10.09 15.59L11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5" +
        "c-1.11 0-2 .9-2 2v4h2V5h14v14H5v-4H3v4c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5" +
        "c0-1.1-.9-2-2-2z");

    public static readonly Geometry Group = G(
        "M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3z" +
        "m-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2" +
        "c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97" +
        ".05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z");

    public static readonly Geometry Person = G(
        "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 " +
        "1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z");

    public static readonly Geometry Reply = G(
        "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z");

    public static readonly Geometry Forward = G(
        "M14 9V5l7 7-7 7v-4.1c-5 0-8.5-1.6-11-5.1 1-5 4-10 11-11z");

    public static readonly Geometry Back = G(
        "M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z");

    public static readonly Geometry Photo = G(
        "M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 " +
        "2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z");

    public static readonly Geometry Document = G(
        "M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6z" +
        "m7 7V3.5L18.5 9H13z");

    public static readonly Geometry Folder = G(
        "M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1" +
        "-.9-2-2-2h-8l-2-2z");

    public static readonly Geometry Archive = G(
        "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" +
        "m0 16H5v-3h3.56c.69 1.19 1.97 2 3.45 2s2.75-.81 3.45-2H19v3zm0-5h-4.99c0 1.1" +
        "-.9 2-2 2s-2-.9-2-2H5V5h14v9z");

    public static readonly Geometry BellOff = G(
        "M20 18.69L7.84 6.14 5.27 3.49 4 4.76l2.8 2.8v.01c-.52.99-.8 2.16-.8 3.42v5l-2 " +
        "2v1h13.73l1 1L21 19.72l-1-1.03zM12 22c1.11 0 2-.89 2-2h-4c0 1.11.89 2 2 2zm6-7.32" +
        "V11c0-3.08-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68" +
        "c-.24.06-.47.15-.69.23L18 14.68z");

    public static readonly Geometry Clock = G(
        "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 " +
        "11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13" +
        "H11v6l5.25 3.15.75-1.23-4.5-2.67z");

    public static readonly Geometry Task = G(
        "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14" +
        "c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 " +
        "1-1 1-1-.45-1-1 .45-1 1-1zm-2 14l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z");

    public static readonly Geometry Chat = G(
        "M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" +
        "M6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z");

    public static readonly Geometry Phone = G(
        "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 " +
        "1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 " +
        "0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 " +
        "1.02l-2.2 2.2z");

    public static readonly Geometry Video = G(
        "M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 " +
        "1-.45 1-1v-3.5l4 4v-11l-4 4z");

    public static readonly Geometry Info = G(
        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2" +
        "v-6h2v6zm0-8h-2V7h2v2z");

    public static readonly Geometry Star = G(
        "M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 " +
        "4.73L5.82 21z");

    public static readonly Geometry StarOutline = G(
        "M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21" +
        "l-1.64-7.03zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04" +
        " 4.38.38-3.32 2.88 1 4.28L12 15.4z");

    public static readonly Geometry Robot = G(
        "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2" +
        "c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 " +
        "3-1.34 3-3s-1.34-3-3-3zm-2 10H6V7h12v12zM9 13c-.83 0-1.5-.67-1.5-1.5S8.17 10 " +
        "9 10s1.5.67 1.5 1.5S9.83 13 9 13zm6 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 " +
        "1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM8 15h8v2H8v-2z");

    public static readonly Geometry Unarchive = G(
        "M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55" +
        "L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5" +
        "c0-.48-.17-.93-.46-1.27zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.81-1" +
        "h12l.94 1H5.12z");

    public static readonly Geometry Bell = G(
        "M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32" +
        "V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 " +
        "2v1h16v-1l-2-2z");

    public static readonly Geometry Plus = G(
        "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z");

    public static readonly Geometry Settings = G(
        "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14" +
        ".23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7" +
        "-1.62-.94L14.4 2.81c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41" +
        "l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 " +
        "8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94" +
        "l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96" +
        "c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17" +
        ".47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22" +
        "l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62" +
        "-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z");

    public static readonly Geometry Link = G(
        "M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9" +
        "H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 " +
        "3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z");

    public static readonly Geometry Eye = G(
        "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5" +
        "c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5" +
        "-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z");

    public static readonly Geometry Refresh = G(
        "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 " +
        "7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 " +
        "0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z");

    public static readonly Geometry Moon = G(
        "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9 9-4.03 9-9c0-.46-.04-.92-.1-1.36" +
        "-.98 1.37-2.58 2.26-4.4 2.26-3.03 0-5.5-2.47-5.5-5.5 0-1.82.89-3.42 " +
        "2.26-4.4-.44-.06-.9-.1-1.36-.1z");

    public static readonly Geometry Help = G(
        "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" +
        "m1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5" +
        "c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2" +
        "-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z");

    public static readonly Geometry Copy = G(
        "M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14" +
        "c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z");

    public static readonly Geometry Poll = G(
        "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5" +
        "c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z");

    public static readonly Geometry SelectAll = G(
        "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2z" +
        "m10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zm-2 18v-2h2v-2h-2zm4-10h2v-2" +
        "h-2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2zm0 8h2v-2h-2zm-8 8h2v-2" +
        "h-2zm-4 0h2v-2H9v2z");

    public static readonly Geometry Flag = G(
        "M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6z");

    public static readonly Geometry Music = G(
        "M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 " +
        "4-1.79 4-4V7h4V3h-6z");

    public static readonly Geometry Home = G(
        "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z");

    public static readonly Geometry CheckBox = G(
        "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" +
        "m-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z");

    public static readonly Geometry Ticket = G(
        "M22 10V6c0-1.11-.9-2-2-2H4c-1.1 0-2 .89-2 2v4c1.11 0 2 .9 2 2s-.89 2-2 2v4" +
        "c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-4c-1.11 0-2-.9-2-2s.9-2 2-2zm-9 7.5h-2v-2h2v2z" +
        "m0-4.5h-2v-2h2v2zm0-4.5h-2v-2h2v2z");

    public static readonly Geometry News = G(
        "M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" +
        "m-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z");

    public static readonly Geometry Mail = G(
        "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" +
        "m0 4l-8 5-8-5V6l8 5 8-5v2z");

    public static readonly Geometry Apartment = G(
        "M17 11V3H7v4H3v14h8v-4h2v4h8V11h-4zM7 19H5v-2h2v2zm0-4H5v-2h2v2zm0-4H5V9h2v2z" +
        "m4 4H9v-2h2v2zm0-4H9V9h2v2zm0-4H9V5h2v2zm4 8h-2v-2h2v2zm0-4h-2V9h2v2zm0-4h-2V5h2v2z" +
        "m4 12h-2v-2h2v2zm0-4h-2v-2h2v2z");

    public static readonly Geometry InventoryBox = G(
        "M20 2H4c-1 0-2 .9-2 2v3.01c0 .72.43 1.34 1 1.69V20c0 1.1 1.1 2 2 2h14c.9 0 2-.9 " +
        "2-2V8.7c.57-.35 1-.97 1-1.69V4c0-1.1-1-2-2-2zm-5 12H9v-2h6v2zm5-7H4V4h16v3z");

    public static readonly Geometry Assignment = G(
        "M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14" +
        "c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 " +
        "1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z");

    public static readonly Geometry Calendar = G(
        "M19 3h-1V1h-2v2H8V1H6v2H5c-1.11 0-1.99.9-1.99 2L3 19c0 1.1.89 2 2 2h14c1.1 0 " +
        "2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z");

    public static readonly Geometry Contacts = G(
        "M20 0H4v2h16V0zM4 24h16v-2H4v2zM20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16" +
        "c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 2.75c1.24 0 2.25 1.01 2.25 2.25s-1.01 2.25-2.25 " +
        "2.25S9.75 10.24 9.75 9 10.76 6.75 12 6.75zM17 17H7v-1.5c0-1.67 3.33-2.5 5-2.5s5 .83 5 2.5V17z");

    public static readonly Geometry AccountTree = G(
        "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z");

    public static readonly Geometry Monitor = G(
        "M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7v2H8v2h8v-2h-2v-2h7c1.1 0 2-.9 " +
        "2-2V4c0-1.1-.9-2-2-2zm0 14H3V4h18v12z");

    public static readonly Geometry Globe = G(
        "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 " +
        "11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 " +
        "4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 " +
        "4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95" +
        "c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 " +
        "4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 " +
        "1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68" +
        "c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95" +
        "c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38" +
        "c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z");

    public static readonly Geometry Computer = G(
        "M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 " +
        "2 2H0v2h24v-2h-4zM4 6h16v10H4V6z");

    public static readonly Geometry Database = G(
        "M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z");

    public static readonly Geometry VpnKey = G(
        "M12.65 10C11.83 7.67 9.61 6 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6c2.61 0 " +
        "4.83-1.67 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z");

    public static readonly Geometry DeviceHub = G(
        "M17 16l-4-4V8.82C14.16 8.4 15 7.3 15 6c0-1.66-1.34-3-3-3S9 4.34 9 6c0 1.3" +
        ".84 2.4 2 2.82V12l-4 4H3v5h5v-3.05l4-4.2 4 4.2V21h5v-5h-4z");

    public static readonly Geometry TrendingUp = G(
        "M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z");

    public static readonly Geometry Print = G(
        "M19 8H5c-1.66 0-3 1.34-3 3v6h4v4h12v-4h4v-6c0-1.66-1.34-3-3-3zm-3 11H8v-5h8v5z" +
        "m3-7c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1zm-1-9H6v4h12V3z");

    public static readonly Geometry BarChart = G(
        "M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z");

    public static readonly Geometry Build = G(
        "M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7" +
        "C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3" +
        "c.5-.4.5-1.1.1-1.4z");

    public static readonly Geometry Shield = G(
        "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7" +
        "c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z");

    public static readonly Geometry Bookmark = G(
        "M17 3H7c-1.1 0-1.99.9-1.99 2L5 21l7-3 7 3V5c0-1.1-.9-2-2-2z");

    public static readonly Geometry Lightbulb = G(
        "M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9" +
        "c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26" +
        "c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z");

    public static readonly Geometry Palette = G(
        "M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74" +
        "-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5" +
        " 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5" +
        " 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 " +
        "9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 " +
        "8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z");

    public static readonly Geometry Warning = G(
        "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z");

    public static readonly Geometry Map = G(
        "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5" +
        ".5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5" +
        "-.5zM15 19l-6-2.11V5l6 2.11V19z");

    public static readonly Geometry SwapHoriz = G(
        "M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z");

    public static readonly Geometry Maximize = G(
        "M3 5v14h18V5H3zm16 12H5V7h14v10z");

    public static readonly Geometry Minimize = G(
        "M6 19h12v-2H6v2z");
}

/// <summary>
/// Attached-иконка пункта навигации шелла: шаблон HubNavItemStyle рисует
/// VectorIcon слева от содержимого, когда свойство задано. Служит заменой
/// эмодзи-префиксов «🏠  Главная» на векторный глиф, следующий Foreground темы.
/// </summary>
public static class NavGlyph
{
    public static readonly DependencyProperty IconProperty = DependencyProperty.RegisterAttached(
        "Icon",
        typeof(Geometry),
        typeof(NavGlyph),
        new FrameworkPropertyMetadata(null, FrameworkPropertyMetadataOptions.AffectsRender));

    public static void SetIcon(DependencyObject element, Geometry? value) => element.SetValue(IconProperty, value);

    public static Geometry? GetIcon(DependencyObject element) => (Geometry?)element.GetValue(IconProperty);
}
