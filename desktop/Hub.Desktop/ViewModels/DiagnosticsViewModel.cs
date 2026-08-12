using System.Globalization;
using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.ViewModels;

public sealed record DiagnosticItem(string Label, string Value);

public sealed class DiagnosticsViewModel
{
    public DiagnosticsViewModel(DesktopDiagnosticsSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        Snapshot = snapshot;
        Items =
        [
            new("Версия HUB Desktop", snapshot.DesktopVersion),
            new("Путь установки", snapshot.InstallPath),
            new("Windows", $"{snapshot.WindowsDescription} ({snapshot.WindowsVersion})"),
            new("Архитектура процесса", snapshot.ProcessArchitecture),
            new("Повышенные права", FormatElevated(snapshot.IsElevated)),
            new("WebView2 Runtime", snapshot.WebView2Version),
            new("Windows App SDK", snapshot.WindowsAppSdkStatus),
            new("WPF Render Tier", snapshot.WpfRenderTier.ToString(CultureInfo.InvariantCulture)),
            new("Адрес HUB", snapshot.ConfiguredOrigin),
            new("Последняя навигация", snapshot.LastNavigationStatus),
            new("Время навигации", FormatDate(snapshot.LastNavigationAtUtc)),
            new("Последний bridge handshake", FormatDate(snapshot.LastBridgeHandshakeUtc)),
            new("Уведомления", snapshot.NotificationMode),
            new("Автозапуск", snapshot.AutostartStatus),
            new("Обновления", snapshot.UpdaterStatus),
            new("Свободно для обновлений", FormatBytes(snapshot.UpdateFreeSpaceBytes)),
            new("Профиль WebView2", FormatBytes(snapshot.WebViewProfileBytes)),
            new("Кэш обновлений", FormatBytes(snapshot.UpdateCacheBytes)),
            new("Старт → WebView2", FormatMilliseconds(snapshot.ProcessStartToWebViewMilliseconds)),
            new("WebView2 → bridge", FormatMilliseconds(snapshot.WebViewToBridgeMilliseconds)),
            new("Зависания UI-потока", snapshot.UiThreadStallCount.ToString(CultureInfo.InvariantCulture)),
            new("Сбои процессов WebView2", snapshot.WebViewProcessFailureCount.ToString(CultureInfo.InvariantCulture)),
            new("Папка логов", snapshot.LogsFolder),
        ];
        HasRenderingWarning = snapshot.SoftwareRendering;
        RenderingWarning = snapshot.SoftwareRendering
            ? "Используется программная отрисовка WPF. Интерфейс может работать медленнее; " +
              "обновите видеодрайвер или обратитесь в IT-службу."
            : string.Empty;
    }

    public DesktopDiagnosticsSnapshot Snapshot { get; }

    public IReadOnlyList<DiagnosticItem> Items { get; }

    public bool HasRenderingWarning { get; }

    public string RenderingWarning { get; }

    private static string FormatElevated(bool? elevated) => elevated switch
    {
        true => "Да",
        false => "Нет",
        null => "Не удалось определить",
    };

    private static string FormatDate(DateTimeOffset? value) =>
        value is null
            ? "Нет данных"
            : value.Value.ToLocalTime().ToString(
                "dd.MM.yyyy HH:mm:ss",
                CultureInfo.CurrentCulture);

    private static string FormatBytes(long? bytes)
    {
        if (bytes is null)
        {
            return "Нет данных";
        }

        string[] units = ["Б", "КБ", "МБ", "ГБ", "ТБ"];
        var value = Math.Max(0, bytes.Value);
        var display = (double)value;
        var unit = 0;
        while (display >= 1024 && unit < units.Length - 1)
        {
            display /= 1024;
            unit++;
        }

        return $"{display:0.#} {units[unit]}";
    }

    private static string FormatMilliseconds(long? milliseconds) =>
        milliseconds is null
            ? "Нет данных"
            : $"{milliseconds.Value} мс";
}
