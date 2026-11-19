using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Форматтеры и статусная логика «Мониторинга» — порт monitoringFormat.js
/// (displayTargetName/targetStatus/interfaceStatus/outageNotice, formatBps,
/// formatTime/formatDuration/isStale) без графиков истории.
/// </summary>
internal static class MonitoringFormat
{
    /// <summary>Читаемые имена площадок — DEVICE_NAMES из monitoringFormat.js.</summary>
    private static readonly IReadOnlyDictionary<string, string> DeviceNames =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Gribordoeva_3"] = "Грибоедова, 3",
            ["Kuznetcova13"] = "Кузнецова, 13",
            ["Gercena_64"] = "Герцена, 64",
            ["Gercena_55"] = "Герцена, 55",
            ["MSK"] = "Москва",
            ["SPB"] = "Санкт-Петербург",
            ["Komsomolsk"] = "Комсомольск",
            ["Kotelny_Island"] = "Котельный",
            ["Magadan"] = "Магадан",
            ["Velizhansky_6km"] = "Велижанский, 6 км",
            ["Kosmodrom2_Vostochnyy"] = "Восточный · 2",
            ["Kosmodrom_Vostochnyy"] = "Восточный · 1",
            ["Teysin"] = "Тейсин",
            ["Ykazchik1"] = "Указчик · 1",
            ["Ykazchik2"] = "Указчик · 2",
            ["Iskander"] = "Искандер",
            ["Iturup"] = "Итуруп",
            ["Severny_Island"] = "Северный остров",
            ["Seyaha-YANAO"] = "Сеяха",
            ["Vilyuchinsk"] = "Вилючинск",
            ["Zegazification"] = "Регазификация",
            ["Vologda"] = "Вологда",
            ["ZFI"] = "ЗФИ",
            ["Vladivostok"] = "Владивосток",
            ["Vladivostok_vagon"] = "Владивосток · вагон",
            ["Mozhaisk"] = "Можайск",
            ["Sharapovo"] = "Шарапово",
            ["Tiksi_ISP"] = "Тикси · ISP",
            ["Tiksi"] = "Тикси",
            ["Yu-Sakhalinsk"] = "Южно-Сахалинск",
        };

    private static readonly Regex NamePrefixPattern =
        new(@"_MikroTik-|\s·\sMikroTik", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex RouterOsPattern =
        new(@"^RouterOS\s*", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>displayTargetName из веба: имя площадки без суффикса модели + «· резерв».</summary>
    public static string DisplayTargetName(HubMonitoringTarget? target)
    {
        var raw = target?.Name;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "Устройство";
        }

        var prefix = NamePrefixPattern.Split(raw.Trim())[0];
        var name = DeviceNames.TryGetValue(prefix, out var known)
            ? known
            : prefix == "Центральный"
                ? "Центральный узел"
                : prefix;
        return Regex.IsMatch(raw, @"\(резерв\)\s*$", RegexOptions.IgnoreCase)
                   && !name.Contains("резерв", StringComparison.OrdinalIgnoreCase)
            ? $"{name} · резерв"
            : name;
    }

    /// <summary>
    /// targetStatus из веба → (подпись, тон, ключ). Тон маппится в XAML:
    /// success/warning/error/muted → HubSuccess/HubWarning/HubErrorText/вторичная кисти.
    /// </summary>
    public static (string Label, string Tone, string Key) TargetStatus(HubMonitoringTarget? target)
    {
        if (target?.Enabled != true)
        {
            return ("Приостановлен", "muted", "paused");
        }

        var current = target.Current;
        if (string.IsNullOrEmpty(current?.CheckedAt))
        {
            return ("Ожидает опроса", "muted", "unknown");
        }

        if (IsStale(current.CheckedAt, current.Status == "offline" ? 360 : 120))
        {
            return ("Данные устарели", "warning", "stale");
        }

        if (current.Status == "offline")
        {
            return ("Нет связи", "error", "offline");
        }

        if (current.Status == "unknown")
        {
            return ("Проверяем связь", "warning", "unknown");
        }

        if (current.SnmpStatus != "ok")
        {
            return ("Нет SNMP", "warning", "snmp");
        }

        var link = target.Outages?.FirstOrDefault(
            outage => outage.Kind == "link" && outage.ClosedAt is null);
        if (link is not null)
        {
            return (link.InterfaceRole == "wan" ? "Упал WAN" : "Нет линка", "error", "link");
        }

        if (current.OpenEvents > 0)
        {
            return ("Есть события", "warning", "warning");
        }

        return ("В сети", "success", "online");
    }

    /// <summary>interfaceStatus из веба → (подпись, тон).</summary>
    public static (string Label, string Tone) InterfaceStatus(HubMonitoringInterface item)
    {
        var current = item.Current;
        if (IsStale(current?.CheckedAt, 480))
        {
            return ("Нет свежих данных", "muted");
        }

        if (current?.Admin == 2)
        {
            return ("Выключен", "muted");
        }

        if (current?.Oper == 1)
        {
            return ("Up", "success");
        }

        if (current?.Oper == 2)
        {
            return ("Нет линка", item.Settings?.Critical == true ? "error" : "muted");
        }

        return ("Неизвестно", "muted");
    }

    /// <summary>
    /// outageNotice из веба: активный эпизод недоступности/линка или последний
    /// завершённый обрыв одной строкой под статусом.
    /// </summary>
    public static string? OutageNotice(HubMonitoringTarget target)
    {
        var current = target.Current;
        var availability = current?.Availability;
        var (_, _, statusKey) = TargetStatus(target);
        var episodes = target.Outages ?? [];
        var active = episodes.FirstOrDefault(episode => episode.ClosedAt is null
            && (statusKey == "offline" ? episode.Kind == "unreachable" : episode.Kind == "link"));
        if (statusKey == "offline")
        {
            var since = availability?.UnreachableSince ?? active?.OpenedAt;
            if (since is null)
            {
                return "Начало недоступности неизвестно";
            }

            var observedOnly = availability?.InitialStateKnown == true && availability?.EverReachable != true;
            var knownConnection = availability?.EverReachable == true || current?.LastSuccessAt is not null;
            return observedOnly
                ? $"Недоступен с начала наблюдения · {FormatOutageTime(availability?.ObservedSince ?? since)}"
                : knownConnection
                    ? $"Обрыв: {FormatOutageTime(since)}"
                    : $"Начало неизвестно · зафиксировано {FormatOutageTime(since)}";
        }

        if (statusKey == "link" && active is not null)
        {
            return $"Обрыв {(active.InterfaceRole == "wan" ? "WAN" : "порта")}"
                + $"{(string.IsNullOrWhiteSpace(active.InterfaceName) ? string.Empty : $" · {active.InterfaceName}")}"
                + $": {FormatOutageTime(active.OpenedAt)}";
        }

        var latest = episodes.FirstOrDefault(episode => episode.ClosedAt is not null);
        if (latest is not null)
        {
            var initial = latest.Kind == "unreachable"
                && TryParseTime(latest.OpenedAt, out var opened)
                && TryParseTime(availability?.FirstReachableAt, out var firstReachable)
                && opened < firstReachable;
            var label = initial
                ? "До первого подключения"
                : $"Последний обрыв{(latest.Kind == "link" ? " порта" : string.Empty)}";
            var duration = TryParseTime(latest.OpenedAt, out var from)
                && TryParseTime(latest.ClosedAt, out var until)
                    ? FormatDuration(from, until)
                    : "—";
            return $"{label}: {FormatOutageTime(latest.OpenedAt)} — {FormatOutageTime(latest.ClosedAt)} · {duration}";
        }

        return null;
    }

    /// <summary>Сортировка карточек — compareMonitoringTargets (центр и города впереди).</summary>
    public static int CompareTargets(HubMonitoringTarget? a, HubMonitoringTarget? b)
    {
        static int Priority(HubMonitoringTarget? target)
        {
            var name = DisplayTargetName(target);
            var core = name.EndsWith(" · резерв", StringComparison.OrdinalIgnoreCase)
                ? name[..^" · резерв".Length]
                : name;
            return core switch
            {
                "Центральный узел" => 0,
                "Москва" => 1,
                "Санкт-Петербург" => 2,
                _ => 3,
            };
        }

        var priority = Priority(a) - Priority(b);
        return priority != 0
            ? priority
            : string.Compare(
                DisplayTargetName(a), DisplayTargetName(b), StringComparison.CurrentCulture);
    }

    /// <summary>isStale из веба: пустое значение — устарело; битая дата — как JS NaN, не устарело.</summary>
    public static bool IsStale(string? value, double seconds = 120)
    {
        if (string.IsNullOrEmpty(value))
        {
            return true;
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var at)
            && DateTimeOffset.UtcNow - at > TimeSpan.FromSeconds(seconds);
    }

    /// <summary>formatNumber из веба: до digits знаков после запятой, «—» при отсутствии значения.</summary>
    public static string FormatNumber(double? value, int digits = 1) =>
        value is { } number && double.IsFinite(number)
            ? number.ToString(
                digits <= 0 ? "0" : "0." + new string('#', digits), CultureInfo.CurrentCulture)
            : "—";

    /// <summary>formatBps из веба: бит/с → Кбит/с → Мбит/с → Гбит/с.</summary>
    public static string FormatBps(double? value)
    {
        if (value is not { } bps || !double.IsFinite(bps))
        {
            return "—";
        }

        return bps switch
        {
            >= 1e9 => $"{FormatNumber(bps / 1e9)} Гбит/с",
            >= 1e6 => $"{FormatNumber(bps / 1e6)} Мбит/с",
            >= 1e3 => $"{FormatNumber(bps / 1e3)} Кбит/с",
            _ => $"{FormatNumber(bps)} бит/с",
        };
    }

    /// <summary>formatTime из веба: «Ещё не было» при отсутствии метки.</summary>
    public static string FormatTime(string? value) =>
        TryParseTime(value, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM HH:mm:ss", CultureInfo.InvariantCulture)
            : "Ещё не было";

    /// <summary>formatOutageTime из веба: «Время неизвестно» при битой метке.</summary>
    public static string FormatOutageTime(string? value) =>
        TryParseTime(value, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM HH:mm", CultureInfo.InvariantCulture)
            : "Время неизвестно";

    /// <summary>formatDuration из веба: «менее минуты», «N мин», «N ч N мин», «N д N ч».</summary>
    public static string FormatDuration(DateTimeOffset start, DateTimeOffset end)
    {
        var milliseconds = (end - start).TotalMilliseconds;
        if (!double.IsFinite(milliseconds) || milliseconds < 0)
        {
            return "—";
        }

        var minutes = (long)(milliseconds / 60000);
        return minutes switch
        {
            0 => "менее минуты",
            < 60 => $"{minutes} мин",
            < 1440 => $"{minutes / 60} ч {minutes % 60} мин",
            _ => $"{minutes / 1440} д {minutes % 1440 / 60} ч",
        };
    }

    public static bool TryParseTime(string? value, out DateTimeOffset parsed) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed);

    /// <summary>Модель карточки — как в веб-гриде: description без «RouterOS» или имя после «_MikroTik-».</summary>
    public static string ModelText(HubMonitoringTarget target)
    {
        var description = target.Current?.Device?.Description;
        if (!string.IsNullOrWhiteSpace(description))
        {
            var model = RouterOsPattern.Replace(description.Trim(), string.Empty).Trim();
            if (model.Length > 0)
            {
                return model;
            }
        }

        var name = target.Name;
        if (string.IsNullOrWhiteSpace(name))
        {
            return string.Empty;
        }

        var parts = Regex.Split(name.Trim(), @"_MikroTik-", RegexOptions.IgnoreCase);
        return parts.Length > 1
            ? Regex.Replace(parts[1], @"\s*\(резерв\)\s*$", string.Empty, RegexOptions.IgnoreCase).Trim()
            : string.Empty;
    }

    public static string FormatCount(int count, string one, string few, string many)
    {
        var mod100 = count % 100;
        var mod10 = count % 10;
        var form = mod100 is >= 11 and <= 14
            ? many
            : mod10 == 1
                ? one
                : mod10 is >= 2 and <= 4
                    ? few
                    : many;
        return string.Create(CultureInfo.CurrentCulture, $"{count} {form}");
    }
}

/// <summary>
/// Строка списка устройств мониторинга: имя площадки, адрес, статусная
/// подпись и свежие задержка/трафик сводки — как карточка веб-грида,
/// но без спарклайна.
/// </summary>
public sealed class MonitoringTargetItemViewModel
{
    public MonitoringTargetItemViewModel(HubMonitoringTarget target)
    {
        ArgumentNullException.ThrowIfNull(target);
        Id = target.Id?.Trim() ?? string.Empty;
        Title = MonitoringFormat.DisplayTargetName(target);
        RawNameText = target.Name?.Trim() ?? string.Empty;
        SysNameText = target.Current?.Device?.SysName?.Trim() ?? string.Empty;
        AddressText = target.Address?.Trim() ?? string.Empty;
        var (label, tone, key) = MonitoringFormat.TargetStatus(target);
        StatusText = label;
        StatusTone = tone;
        StatusKey = key;

        var current = target.Current;
        var ping = current?.Ping;
        // Свежая задержка (окно 20 с — как чип задержки на веб-карточке).
        HasLatency = ping?.LatencyMs is not null
            && !MonitoringFormat.IsStale(current?.IcmpCheckedAt ?? current?.CheckedAt, 20);
        LatencyText = HasLatency
            ? $"Задержка: {MonitoringFormat.FormatNumber(ping!.LatencyMs, 0)} мс"
            : string.Empty;

        var summary = target.Summary;
        var summaryStale = MonitoringFormat.IsStale(summary?.CheckedAt);
        HasSummary = !summaryStale && (summary?.RxBps is not null || summary?.TxBps is not null);
        SummaryText = HasSummary
            ? $"↓ {MonitoringFormat.FormatBps(summary!.RxBps)}"
                + $" · ↑ {MonitoringFormat.FormatBps(summary.TxBps)}"
                + (string.IsNullOrWhiteSpace(summary.Name) ? string.Empty : $" · {summary.Name!.Trim()}")
            : string.Empty;

        ModelText = MonitoringFormat.ModelText(target);
    }

    public string Id { get; }
    public string Title { get; }

    /// <summary>Сырое имя цели (name) — для поиска, как в веб-фильтре.</summary>
    public string RawNameText { get; }

    /// <summary>SNMP sysName — тоже участвует в поиске.</summary>
    public string SysNameText { get; }
    public string AddressText { get; }
    public string StatusText { get; }

    /// <summary>success|warning|error|muted → кисти статуса в XAML.</summary>
    public string StatusTone { get; }

    /// <summary>Ключ targetStatus из веба — фильтр «Требуют внимания».</summary>
    public string StatusKey { get; }
    public string LatencyText { get; }
    public bool HasLatency { get; }
    public string SummaryText { get; }
    public bool HasSummary { get; }
    public string ModelText { get; }
    public bool HasModel => ModelText.Length > 0;
    public string AutomationName => $"{Title}, {AddressText}, {StatusText}";
}

/// <summary>
/// Строка таблицы интерфейсов: имя+alias, состояние, скорость линка,
/// приём/передача, загрузка и пометка контроля — как веб-таблица MonitoringInterfaces.
/// </summary>
public sealed class MonitoringInterfaceItemViewModel
{
    public MonitoringInterfaceItemViewModel(HubMonitoringInterface item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id?.Trim() ?? string.Empty;
        Name = string.IsNullOrWhiteSpace(item.Name) ? "Интерфейс" : item.Name!.Trim();
        AliasText = item.Current?.Alias?.Trim() ?? string.Empty;
        var (label, tone) = MonitoringFormat.InterfaceStatus(item);
        StatusText = label;
        StatusTone = tone;
        var current = item.Current;
        SpeedText = current?.Oper == 1 ? MonitoringFormat.FormatBps(current.SpeedBps) : "—";
        RxText = MonitoringFormat.FormatBps(current?.RxBps);
        TxText = MonitoringFormat.FormatBps(current?.TxBps);
        UtilText = $"{MonitoringFormat.FormatNumber(current?.RxUtilPct)}"
            + $" / {MonitoringFormat.FormatNumber(current?.TxUtilPct)} %";
        IsCritical = item.Settings?.Critical == true;
        ControlText = IsCritical
            ? item.Settings?.Role?.ToUpperInvariant() ?? "Важный"
            : "Обычный";
        IsPinned = item.Settings?.Pinned == true;
    }

    public string Id { get; }
    public string Name { get; }
    public string AliasText { get; }
    public bool HasAlias => AliasText.Length > 0;
    public string StatusText { get; }
    public string StatusTone { get; }
    public string SpeedText { get; }
    public string RxText { get; }
    public string TxText { get; }
    public string UtilText { get; }
    public bool IsCritical { get; }
    public string ControlText { get; }
    public bool IsPinned { get; }
    public string AutomationName => $"{Name}, {StatusText}";
}

/// <summary>
/// Строка журнала событий: заголовок, период и состояние
/// (Открыто/Завершено · длительность) — как MonitoringEvents в вебе.
/// </summary>
public sealed class MonitoringEventItemViewModel
{
    public MonitoringEventItemViewModel(HubMonitoringEvent entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        Id = entry.Id?.Trim() ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(entry.Title) ? "Событие" : entry.Title!.Trim();
        IsOpen = entry.ClosedAt is null;
        TimeText = $"{MonitoringFormat.FormatTime(entry.OpenedAt)}"
            + (entry.ClosedAt is null ? string.Empty : $" → {MonitoringFormat.FormatTime(entry.ClosedAt)}");
        var duration = MonitoringFormat.TryParseTime(entry.OpenedAt, out var opened)
            ? MonitoringFormat.FormatDuration(
                opened,
                MonitoringFormat.TryParseTime(entry.ClosedAt, out var closed)
                    ? closed
                    : DateTimeOffset.UtcNow)
            : "—";
        StateText = $"{(IsOpen ? "Открыто" : "Завершено")} · {duration}";
        StateTone = !IsOpen ? "muted" : entry.Severity == "critical" ? "error" : "warning";
    }

    public string Id { get; }
    public string Title { get; }
    public bool IsOpen { get; }
    public string TimeText { get; }
    public string StateText { get; }
    public string StateTone { get; }
}

/// <summary>
/// Деталь цели: заголовок/адрес/описание, чипы связи ICMP+SNMP, текущие
/// ресурсы (CPU/память/температура/хранилище/задержка), таблица интерфейсов
/// и журнал событий. Графики истории в срез не входят.
/// </summary>
public sealed class MonitoringTargetDetailViewModel
{
    public MonitoringTargetDetailViewModel(HubMonitoringTarget target)
    {
        ArgumentNullException.ThrowIfNull(target);
        Id = target.Id?.Trim() ?? string.Empty;
        Title = MonitoringFormat.DisplayTargetName(target);
        var address = string.IsNullOrWhiteSpace(target.Address) ? "—" : target.Address!.Trim();
        AddressText = target.Port is > 0 ? $"{address}:{target.Port}" : address;

        var current = target.Current;
        var device = current?.Device;
        SubtitleText = !string.IsNullOrWhiteSpace(device?.Description)
            ? device!.Description!.Trim()
            : !string.IsNullOrWhiteSpace(device?.SysName)
                ? device!.SysName!.Trim()
                : "SNMPv2c";

        var (label, tone, _) = MonitoringFormat.TargetStatus(target);
        StatusText = label;
        StatusTone = tone;
        OutageText = MonitoringFormat.OutageNotice(target) ?? string.Empty;

        // Чипы связи — как строка ICMP/SNMP веб-детали (окно свежести ICMP — 20 с).
        var icmpStale = MonitoringFormat.IsStale(
            current?.IcmpCheckedAt ?? current?.CheckedAt, 20);
        var pingStatus = current?.Ping?.Status;
        IcmpText = icmpStale
            ? "ICMP: данные устарели"
            : pingStatus == "online"
                ? $"ICMP: отвечает{(current?.Ping?.LatencyMs is { } latency
                    ? $" · {MonitoringFormat.FormatNumber(latency, 0)} мс"
                    : string.Empty)}"
                : pingStatus == "offline"
                    ? "ICMP: нет ответа"
                    : "ICMP: не проверен";
        IcmpTone = pingStatus == "online" && !icmpStale ? "success" : "muted";

        var stale = MonitoringFormat.IsStale(current?.LastSuccessAt);
        SnmpText = current?.SnmpStatus == "ok"
            ? stale ? "SNMP: данные устарели" : "SNMP: отвечает"
            : current?.SnmpStatus == "error"
                ? "SNMP: ошибка"
                : "SNMP: не проверен";
        SnmpTone = current?.SnmpStatus == "ok" && !stale
            ? "success"
            : current?.SnmpStatus == "error"
                ? "warning"
                : "muted";
        LastSuccessText = $"Последний успех SNMP: {MonitoringFormat.FormatTime(current?.LastSuccessAt)}";
        SnmpErrorText = string.IsNullOrWhiteSpace(current?.SnmpError)
            ? string.Empty
            : $"{current!.SnmpError!.Trim()}. Последние известные значения сохранены.";

        // Ресурсы: текстовое значение + прогресс для процентов (как сетка метрик веба).
        CpuText = MetricText(device?.CpuPct, "%");
        CpuValue = MetricValue(device?.CpuPct);
        MemoryText = MetricText(device?.MemoryPct, "%");
        MemoryValue = MetricValue(device?.MemoryPct);
        StorageText = MetricText(device?.StoragePct, "%");
        StorageValue = MetricValue(device?.StoragePct);
        TemperatureText = MetricText(device?.TemperatureC, "°C");
        LatencyText = MetricText(current?.Ping?.LatencyMs, "мс");
        LossText = MetricText(current?.Ping?.LossPct, "%");
        SerialText = string.IsNullOrWhiteSpace(device?.Serial)
            ? string.Empty
            : $"S/N: {device!.Serial!.Trim()}";
        UptimeText = Uptime(device);

        // Подсказки про устаревшие данные — как в веб-детали.
        ResourcesStaleText = !string.IsNullOrWhiteSpace(device?.ResourcesAt)
            && MonitoringFormat.IsStale(device!.ResourcesAt)
                ? $"Измерения ресурсов устарели: {MonitoringFormat.FormatTime(device.ResourcesAt)}."
                : string.Empty;
        StaleDataText = stale && current?.LastSuccessAt is not null
            ? "Показаны последние известные данные. Новых успешных измерений пока нет."
            : string.Empty;

        foreach (var item in target.Interfaces ?? [])
        {
            Interfaces.Add(new MonitoringInterfaceItemViewModel(item));
        }

        foreach (var entry in target.Events ?? [])
        {
            Events.Add(new MonitoringEventItemViewModel(entry));
        }
    }

    public string Id { get; }
    public string Title { get; }
    public string AddressText { get; }
    public string SubtitleText { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string OutageText { get; }
    public bool HasOutage => OutageText.Length > 0;
    public string IcmpText { get; }
    public string IcmpTone { get; }
    public string SnmpText { get; }
    public string SnmpTone { get; }
    public string LastSuccessText { get; }
    public string SnmpErrorText { get; }
    public bool HasSnmpError => SnmpErrorText.Length > 0;

    public string CpuText { get; }
    public double CpuValue { get; }
    public bool HasCpu => CpuValue >= 0;
    public string MemoryText { get; }
    public double MemoryValue { get; }
    public bool HasMemory => MemoryValue >= 0;
    public string StorageText { get; }
    public double StorageValue { get; }
    public bool HasStorage => StorageValue >= 0;
    public string TemperatureText { get; }
    public bool HasTemperature => TemperatureText.Length > 0;
    public string LatencyText { get; }
    public bool HasLatency => LatencyText.Length > 0;
    public string LossText { get; }
    public bool HasLoss => LossText.Length > 0;
    public string SerialText { get; }
    public string UptimeText { get; }
    public string ResourcesStaleText { get; }
    public string StaleDataText { get; }

    public ObservableCollection<MonitoringInterfaceItemViewModel> Interfaces { get; } = [];
    public string InterfacesTitleText => $"Интерфейсы · {Interfaces.Count}";
    public bool IsInterfacesEmpty => Interfaces.Count == 0;

    public ObservableCollection<MonitoringEventItemViewModel> Events { get; } = [];
    public string EventsTitleText => $"События · {Events.Count}";
    public bool IsEventsEmpty => Events.Count == 0;

    private static string MetricText(double? value, string unit, int digits = 1) =>
        value is { } number && double.IsFinite(number)
            ? $"{MonitoringFormat.FormatNumber(number, digits)} {unit}"
            : string.Empty;

    /// <summary>Значение для ProgressBar 0..100; −1 — метрики нет (чип скрыт).</summary>
    private static double MetricValue(double? value) =>
        value is { } number && double.IsFinite(number)
            ? Math.Max(0, Math.Min(100, number))
            : -1;

    /// <summary>Аптайм устройства: тики SNMP (100 тиков = 1 с) → «N д N ч».</summary>
    private static string Uptime(HubMonitoringDevice? device)
    {
        var ticks = device?.HardwareUptimeTicks ?? device?.UptimeTicks;
        if (ticks is not > 0)
        {
            return string.Empty;
        }

        // Тик SNMP = 1/100 с = 100 000 .NET-тиков.
        var uptime = TimeSpan.FromTicks(ticks.Value * 100_000L);
        return $"Аптайм: {MonitoringFormat.FormatDuration(DateTimeOffset.UtcNow - uptime, DateTimeOffset.UtcNow)}";
    }
}

/// <summary>
/// Страница «📈 Мониторинг»: список устройств со статусами слева (клиентский
/// поиск по имени/адресу/sysName + фильтр «Требуют внимания»), выбор → деталь
/// с текущими метриками, интерфейсами и событиями. Только чтение: управление
/// целями, ручной опрос и графики истории в срез не входят.
/// </summary>
public sealed class MonitoringViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    /// <summary>Полная выдача списка (поиск и фильтр «Требуют внимания» режут её локально).</summary>
    private IReadOnlyList<MonitoringTargetItemViewModel> _allTargets = [];

    private MonitoringTargetItemViewModel? _selectedTarget;
    private MonitoringTargetDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private bool _issuesOnly;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _issuesText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private string? _workerNoticeText;
    private string _workerNoticeTone = "info";

    public MonitoringViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Список устройств ----

    public ObservableCollection<MonitoringTargetItemViewModel> Items { get; } = [];

    public MonitoringTargetItemViewModel? SelectedTarget
    {
        get => _selectedTarget;
        set
        {
            if (SetProperty(ref _selectedTarget, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.Id);
            }
        }
    }

    public MonitoringTargetDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите устройство» — ни карточки, ни загрузки детали.</summary>
    public bool ShowDetailPlaceholder => Detail is null && !IsDetailLoading;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set
        {
            if (SetProperty(ref _isDetailLoading, value))
            {
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public string? DetailErrorText
    {
        get => _detailErrorText;
        private set
        {
            if (SetProperty(ref _detailErrorText, value))
            {
                OnPropertyChanged(nameof(HasDetailError));
            }
        }
    }

    public bool HasDetailError => !string.IsNullOrEmpty(DetailErrorText);

    /// <summary>Клиентский поиск (имя/адрес/sysName) — как фильтр списка в вебе.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ApplyFilter();
            }
        }
    }

    /// <summary>Фильтр «Требуют внимания» — статус не «В сети» и не «Приостановлен».</summary>
    public bool IssuesOnly
    {
        get => _issuesOnly;
        set
        {
            if (SetProperty(ref _issuesOnly, value))
            {
                ApplyFilter();
            }
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set
        {
            if (SetProperty(ref _bannerErrorText, value))
            {
                OnPropertyChanged(nameof(HasBannerError));
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    /// <summary>Подпись счётчика: «5 устройств».</summary>
    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    /// <summary>«требуют внимания: N» — только при наличии проблем (чип «count / issues» веба).</summary>
    public string IssuesText
    {
        get => _issuesText;
        private set => SetProperty(ref _issuesText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    /// <summary>Уведомление о состоянии сборщика (worker{} из overview).</summary>
    public string? WorkerNoticeText
    {
        get => _workerNoticeText;
        private set
        {
            if (SetProperty(ref _workerNoticeText, value))
            {
                OnPropertyChanged(nameof(HasWorkerNotice));
            }
        }
    }

    /// <summary>info|warning → кисти баннера сборщика в XAML.</summary>
    public string WorkerNoticeTone
    {
        get => _workerNoticeTone;
        private set => SetProperty(ref _workerNoticeTone, value);
    }

    public bool HasWorkerNotice => !string.IsNullOrEmpty(WorkerNoticeText);

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Первичная загрузка/обновление обзора мониторинга.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var overview = await _api.GetMonitoringOverviewAsync(cancellationToken);
            var sorted = (overview.Targets ?? [])
                .OrderBy(target => target, Comparer<HubMonitoringTarget>.Create(
                    MonitoringFormat.CompareTargets));
            _allTargets = sorted
                .Select(target => new MonitoringTargetItemViewModel(target))
                .ToList();
            ApplyFilter();
            TotalText = MonitoringFormat.FormatCount(
                _allTargets.Count, "устройство", "устройства", "устройств");
            var issues = _allTargets.Count(item => item.StatusKey is not ("online" or "paused"));
            IssuesText = issues > 0 ? $"требуют внимания: {issues}" : string.Empty;
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            ApplyWorker(overview.Worker);
            BannerErrorText = null;

            // Цель удалили из мониторинга — карточку тоже убираем.
            if (_selectedTarget is not null
                && _allTargets.All(item => item.Id != _selectedTarget.Id))
            {
                Detail = null;
                _detailLoadCancellation?.Cancel();
                SelectedTarget = null;
            }

            if (_selectedTarget is not null)
            {
                await LoadDetailSafelyAsync(_selectedTarget.Id);
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Баннер состояния сборщика — три ветки алертов веб-шапки в одну строку.</summary>
    private void ApplyWorker(HubMonitoringWorker? worker)
    {
        if (worker is { Enabled: true })
        {
            if (MonitoringFormat.IsStale(worker.HeartbeatAt, 120))
            {
                WorkerNoticeTone = "warning";
                WorkerNoticeText =
                    $"Сбор данных задерживается. Последний цикл: {MonitoringFormat.FormatTime(worker.HeartbeatAt)}.";
            }
            else if (MonitoringFormat.IsStale(worker.HeartbeatAt, 30))
            {
                WorkerNoticeTone = "warning";
                WorkerNoticeText = "Сборщик мониторинга не обновляет данные.";
            }
            else
            {
                WorkerNoticeText = null;
            }
        }
        else if (worker is not null)
        {
            WorkerNoticeTone = "info";
            WorkerNoticeText =
                "Автоматический сбор пока не включён. Новые данные появятся после включения сбора.";
        }
        else
        {
            WorkerNoticeText = null;
        }
    }

    private void ApplyFilter()
    {
        var query = _searchText.Trim();
        Items.Clear();
        foreach (var target in _allTargets)
        {
            if (_issuesOnly && target.StatusKey is "online" or "paused")
            {
                continue;
            }

            if (query.Length == 0
                || target.Title.Contains(query, StringComparison.OrdinalIgnoreCase)
                || target.RawNameText.Contains(query, StringComparison.OrdinalIgnoreCase)
                || target.AddressText.Contains(query, StringComparison.OrdinalIgnoreCase)
                || target.SysNameText.Contains(query, StringComparison.OrdinalIgnoreCase))
            {
                Items.Add(target);
            }
        }
    }

    // ---- Деталь устройства ----

    private async Task LoadDetailSafelyAsync(string targetId)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetMonitoringTargetAsync(targetId, cancellation.Token);
            if (_selectedTarget?.Id == targetId)
            {
                Detail = new MonitoringTargetDetailViewModel(detail);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            // Ошибка устаревшей загрузки не должна перекрывать карточку нового выбора.
            if (_selectedTarget?.Id == targetId)
            {
                DetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadCancellation?.Cancel();
        _detailLoadCancellation = null;
        _allTargets = [];
        Items.Clear();
        Detail = null;
        SelectedTarget = null;
        BannerErrorText = null;
        DetailErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _issuesOnly = false;
        OnPropertyChanged(nameof(IssuesOnly));
        TotalText = string.Empty;
        IssuesText = string.Empty;
        LastUpdatedText = string.Empty;
        WorkerNoticeText = null;
        WorkerNoticeTone = "info";
        IsLoading = false;
        IsDetailLoading = false;
    }
}
