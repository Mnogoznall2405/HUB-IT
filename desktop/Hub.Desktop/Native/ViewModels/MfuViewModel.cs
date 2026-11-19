using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Форматтеры и фильтры страницы «МФУ» — порт Mfu.jsx (normalizeText,
/// getDeviceHostname, getPingMeta, getSupplySeverity, formatMonthLabel,
/// formatReplacementItemName, groupSupplies, фильтры filteredGrouped и
/// сортировка «критичный тонер вперёд»). Без записи работ и QR-подбора.
/// </summary>
internal static class MfuFormat
{
    private static readonly Regex HexLabelPattern = new(@"^0x([0-9a-f]+)$", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SndSuffixPattern = new(@"\s*[;,]?\s*SND[0-9A-Z_-]+", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex SnSuffixPattern = new(@"\s*[;,]?\s*SN[0-9A-Z_-]{8,}", RegexOptions.Compiled | RegexOptions.IgnoreCase);
    private static readonly Regex MonthPattern = new(@"^(\d{4})-(\d{2})$", RegexOptions.Compiled);
    private static readonly Regex MultiSpacePattern = new(@"\s{2,}", RegexOptions.Compiled);

    /// <summary>Замены в именах расходников/работ — таблица replacements из веба.</summary>
    private static readonly (Regex Pattern, string Value)[] ItemNameReplacements =
    [
        (new Regex(@"\bfuser unit\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Фьюзер"),
        (new Regex(@"\bfuser\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Фьюзер"),
        (new Regex(@"\bphotoconductor\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Фотобарабан"),
        (new Regex(@"\bwaste toner container\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Бункер отработки"),
        (new Regex(@"\bwaste[_\s-]*toner\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Отработанный тонер"),
        (new Regex(@"\btransfer[_\s-]*belt\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Трансферный ремень"),
        (new Regex(@"\btransfer belt\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Трансферный ремень"),
        (new Regex(@"\bdrum cartridge\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Фотобарабан"),
        (new Regex(@"\btoner cartridge\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Тонер-картридж"),
        (new Regex(@"\bcartridge\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Картридж"),
        (new Regex(@"\bimaging unit\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Блок формирования изображения"),
        (new Regex(@"\bmaintenance kit\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "Сервисный комплект"),
        (new Regex(@"\bPN\b", RegexOptions.Compiled | RegexOptions.IgnoreCase), "арт."),
    ];

    /// <summary>Имена групп расходников — groupSupplies из веба, порядок показа тот же.</summary>
    public static readonly string[] SupplyGroupTitles =
    [
        "Картриджи / Тонеры",
        "Фотобарабаны",
        "Отстойники (Отработка)",
        "Печки и Ленты",
        "Прочее",
    ];

    public static string NormalizeText(string? value) => (value ?? string.Empty).Trim().ToLowerInvariant();

    /// <summary>getDeviceHostname из веба: инвентарный hostname → SNMP sys_name.</summary>
    public static string DeviceHostname(HubMfuDevice? device) =>
        FirstNonEmpty(
            device?.Hostname,
            device?.Runtime?.Snmp?.DeviceInfo?.SysName) ?? string.Empty;

    /// <summary>getPingMeta → (подпись, тон success/error/muted).</summary>
    public static (string Label, string Tone) PingMeta(string? status)
    {
        var normalized = NormalizeText(status);
        return normalized switch
        {
            "online" => ("В сети", "success"),
            "offline" => ("Оффлайн", "error"),
            _ => ("Неизвестно", "muted"),
        };
    }

    /// <summary>getSupplySeverity → тон: &lt;20 error, &lt;40 warning, иначе success.</summary>
    public static string SupplyTone(double? percent) =>
        percent is not { } value || !double.IsFinite(value)
            ? "muted"
            : value < 20 ? "error" : value < 40 ? "warning" : "success";

    /// <summary>Тон лотка бумаги из веба: &lt;20 error, &lt;50 warning, иначе success.</summary>
    public static string TrayTone(double? percent) =>
        percent is not { } value || !double.IsFinite(value)
            ? "muted"
            : value < 20 ? "error" : value < 50 ? "warning" : "success";

    /// <summary>
    /// Минимальный процент остатка по supplies[]; если таблицы нет — best_percent
    /// снимка SNMP (как в карточке и фильтре low_toner веба). null — данных нет.
    /// </summary>
    public static double? MinSupplyPercent(HubMfuDevice? device)
    {
        var supplies = device?.Runtime?.Snmp?.Supplies;
        var min = supplies is { Count: > 0 }
            ? supplies.Where(s => s.Percent is not null).Select(s => (double)s.Percent!.Value).DefaultIfEmpty(double.NaN).Min()
            : double.NaN;
        if (!double.IsNaN(min))
        {
            return min;
        }

        var best = device?.Runtime?.Snmp?.BestPercent;
        return best is not null ? best.Value : null;
    }

    /// <summary>formatDateTime из веба: «dd.MM.yyyy HH:mm» локального времени, «-» без значения.</summary>
    public static string FormatDateTime(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "-";
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : value.Trim();
    }

    /// <summary>formatDateOnly из веба: «dd.MM.yyyy», «-» без значения.</summary>
    public static string FormatDateOnly(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "-";
        }

        return DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture)
            : value.Trim();
    }

    /// <summary>formatMonthLabel: «YYYY-MM» → «MM.YYYY».</summary>
    public static string FormatMonthLabel(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        var match = MonthPattern.Match(text);
        return match.Success ? $"{match.Groups[2].Value}.{match.Groups[1].Value}" : (text.Length > 0 ? text : "-");
    }

    /// <summary>Uptime секунд → «Nд Nч Nм» (как в SNMP-блоке веб-детали).</summary>
    public static string FormatUptime(long? seconds)
    {
        if (seconds is not > 0)
        {
            return string.Empty;
        }

        var total = seconds.Value;
        return $"{total / 86400}д {total % 86400 / 3600}ч {total % 3600 / 60}м";
    }

    /// <summary>
    /// decodeHexLabel: метки «0x…» → UTF-8. (В вебе ещё windows-1251 — в .NET
    /// кодовая страница недоступна без пакета CodePages; крайний случай оставляем сырым.)
    /// </summary>
    private static string DecodeHexLabel(string raw)
    {
        var match = HexLabelPattern.Match(raw);
        if (!match.Success)
        {
            return raw;
        }

        var hex = match.Groups[1].Value;
        if (hex.Length == 0 || hex.Length % 2 != 0)
        {
            return raw;
        }

        try
        {
            var bytes = new byte[hex.Length / 2];
            for (var i = 0; i < bytes.Length; i++)
            {
                bytes[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            }

            var decoded = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false, throwOnInvalidBytes: true)
                .GetString(bytes)
                .Replace('\0', ' ')
                .Trim();
            return decoded.Length > 0 ? decoded : raw;
        }
        catch
        {
            return raw;
        }
    }

    /// <summary>
    /// formatReplacementItemName: hex-декод, срезание ;SND…/SN…-суффиксов
    /// и английские типы → русские подписи из таблицы replacements веба.
    /// </summary>
    public static string FormatReplacementItemName(string? value)
    {
        var text = DecodeHexLabel((value ?? string.Empty).Trim()).Trim();
        if (text.Length == 0)
        {
            return "-";
        }

        text = SndSuffixPattern.Replace(text, string.Empty);
        text = SnSuffixPattern.Replace(text, string.Empty);
        foreach (var (pattern, replacement) in ItemNameReplacements)
        {
            text = pattern.Replace(text, replacement);
        }

        text = MultiSpacePattern.Replace(text, " ").Replace(" ,", ",").Trim();
        return text.Length > 0 ? text : "-";
    }

    /// <summary>Ключ группы расходника по имени — группировка groupSupplies веба.</summary>
    public static int SupplyGroupIndex(string? name)
    {
        var raw = (name ?? string.Empty).ToLowerInvariant();
        if (raw.Contains("toner") || raw.Contains("cartridge") || raw.Contains("тонер")
            || raw.Contains("картридж") || raw.Contains("ink") || raw.Contains("чернила"))
        {
            return 0;
        }

        if (raw.Contains("drum") || raw.Contains("барабан")
            || raw.Contains("imaging unit") || raw.Contains("фотобарабан"))
        {
            return 1;
        }

        if (raw.Contains("waste") || raw.Contains("отработ")
            || raw.Contains("collector") || raw.Contains("бункер"))
        {
            return 2;
        }

        if (raw.Contains("fuser") || raw.Contains("belt") || raw.Contains("transfer")
            || raw.Contains("ремень") || raw.Contains("лента") || raw.Contains("печк"))
        {
            return 3;
        }

        return 4;
    }

    /// <summary>
    /// Порядок карточек внутри локации — компаратор веб-списка:
    /// «мало тонера» (&lt;20) вперёд, затем по возрастанию минимального процента.
    /// </summary>
    public static double SortPercent(HubMfuDevice? device) => MinSupplyPercent(device) ?? 999;

    /// <summary>Строка поиска карточки — blob полей из filteredGrouped веба.</summary>
    public static string SearchBlob(HubMfuDevice? device, string? branchName, string? locationName) =>
        string.Join(' ', new[]
        {
            device?.InvNo, device?.SerialNo, device?.HwSerialNo, device?.TypeName,
            device?.ModelName, device?.Manufacturer, device?.IpAddress,
            DeviceHostname(device), device?.EmployeeName, device?.EmployeeDept,
            branchName, locationName,
        }.Where(part => !string.IsNullOrWhiteSpace(part)).Select(NormalizeText));

    public static string? FirstNonEmpty(params string?[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();

    public static string OrDash(string? value) =>
        string.IsNullOrWhiteSpace(value) ? "-" : value.Trim();

    /// <summary>Русская плюрализация «N устройство/устройства/устройств».</summary>
    public static string FormatCount(int count, string one, string few, string many)
    {
        var mod100 = count % 100;
        var mod10 = count % 10;
        var form = mod100 is >= 11 and <= 14
            ? many
            : mod10 == 1 ? one : mod10 is >= 2 and <= 4 ? few : many;
        return string.Create(CultureInfo.CurrentCulture, $"{count} {form}");
    }
}

/// <summary>Опция меню-фильтра (Value — ключ фильтра, «all» — без ограничения).</summary>
public sealed class MfuFilterItem
{
    public MfuFilterItem(string value, string label)
    {
        Value = value;
        Label = label;
    }

    public string Value { get; }
    public string Label { get; }
}

/// <summary>База строки списка МФУ: заголовки филиала/локации и карточки устройств.</summary>
public abstract class MfuListRow
{
    /// <summary>Выбираемые строки — только устройства; заголовки отключены.</summary>
    public virtual bool IsSelectable => false;
}

/// <summary>Заголовок филиала в списке (аккордеон первого уровня веба).</summary>
public sealed class MfuBranchRow : MfuListRow
{
    public MfuBranchRow(string title, int deviceCount, int locationCount)
    {
        Title = title;
        CountText = MfuFormat.FormatCount(deviceCount, "устройство", "устройства", "устройств");
        LocationsText = MfuFormat.FormatCount(locationCount, "локация", "локации", "локаций");
    }

    public string Title { get; }
    public string CountText { get; }
    public string LocationsText { get; }
}

/// <summary>Заголовок локации внутри филиала (счётчики online/offline как в вебе).</summary>
public sealed class MfuLocationRow : MfuListRow
{
    public MfuLocationRow(string title, int total, int online, int offline)
    {
        Title = title;
        CountText = MfuFormat.FormatCount(total, "шт", "шт", "шт");
        OnlineText = $"Online: {online}";
        OfflineText = $"Offline: {offline}";
    }

    public string Title { get; }
    public string CountText { get; }
    public string OnlineText { get; }
    public string OfflineText { get; }
}

/// <summary>
/// Карточка устройства в списке: модель/тип, ping-пилюля, минимальный тонер,
/// инвентарные поля и счётчик работ — как компактная карточка веб-сетки
/// (+ блок «подробно» при IsDetailed).
/// </summary>
public sealed class MfuDeviceItemViewModel : MfuListRow
{
    public MfuDeviceItemViewModel(HubMfuDevice device, string branchName, string locationName)
    {
        ArgumentNullException.ThrowIfNull(device);
        Device = device;
        Key = device.Key?.Trim() ?? string.Empty;
        BranchName = branchName;
        LocationName = locationName;

        Title = MfuFormat.OrDash(device.ModelName);
        TypeText = MfuFormat.OrDash(device.TypeName);
        var (label, tone) = MfuFormat.PingMeta(device.Runtime?.Ping?.Status);
        PingStatusText = label;
        PingTone = tone;

        MinPercent = MfuFormat.MinSupplyPercent(device);
        MinSupplyValue = MinPercent is { } pct ? Math.Max(0, Math.Min(100, pct)) : 0;
        MinSupplyTone = MfuFormat.SupplyTone(MinPercent);
        MinSupplyText = $"Мин. тонер: {(MinPercent is { } p ? $"{p:0}%" : "N/A")}";
        SuppliesCountText = $"Расходники: {device.Runtime?.Snmp?.Supplies?.Count ?? 0}";
        IsLowToner = MinPercent is < 20;

        InvText = $"Инв.: {MfuFormat.OrDash(device.InvNo)}";
        IpText = $"IP: {MfuFormat.OrDash(device.IpAddress)}";
        HostnameText = $"Hostname: {MfuFormat.OrDash(MfuFormat.DeviceHostname(device))}";
        PagesText = $"Страниц: {(device.Runtime?.Snmp?.PageTotal is { } pages ? pages.ToString(CultureInfo.InvariantCulture) : "-")}";
        WorksText = $"Работ: {device.Maintenance?.TotalOperations ?? 0}";
        SerialText = $"Серийный: {MfuFormat.OrDash(MfuFormat.FirstNonEmpty(device.SerialNo, device.HwSerialNo))}";
        DeptText = $"Отдел: {MfuFormat.OrDash(device.EmployeeDept)}";
        LastWorkText = $"Последняя работа: {MfuFormat.FormatDateTime(device.Maintenance?.LastOperationAt)}";
        SearchBlob = MfuFormat.SearchBlob(device, branchName, locationName);
    }

    public override bool IsSelectable => true;

    /// <summary>Сырой payload устройства — для детальной карточки.</summary>
    public HubMfuDevice Device { get; }
    public string Key { get; }
    public string BranchName { get; }
    public string LocationName { get; }
    public string Title { get; }
    public string TypeText { get; }
    public string PingStatusText { get; }
    public string PingTone { get; }
    public double? MinPercent { get; }
    public double MinSupplyValue { get; }
    public string MinSupplyTone { get; }
    public bool HasMinSupply => MinPercent is not null;
    public string MinSupplyText { get; }
    public string SuppliesCountText { get; }
    public bool IsLowToner { get; }
    public string InvText { get; }
    public string IpText { get; }
    public string HostnameText { get; }
    public string PagesText { get; }
    public string WorksText { get; }
    public string SerialText { get; }
    public string DeptText { get; }
    public string LastWorkText { get; }
    public string SearchBlob { get; }
    public string AutomationName => $"{Title}, {PingStatusText}, {LocationName}";
}

/// <summary>Расходник в детали: имя (formatReplacementItemName), прогресс и уровни.</summary>
public sealed class MfuSupplyItemViewModel
{
    public MfuSupplyItemViewModel(HubMfuSupply supply)
    {
        ArgumentNullException.ThrowIfNull(supply);
        Name = MfuFormat.FormatReplacementItemName(
            MfuFormat.FirstNonEmpty(supply.Name, $"Расходник {supply.Index}") ?? string.Empty);
        Percent = supply.Percent;
        PercentValue = supply.Percent is { } p ? Math.Max(0, Math.Min(100, p)) : 0;
        Tone = MfuFormat.SupplyTone(supply.Percent);
        // Подпись уровня — как secondary в веб-списке: -2/-3 → «OK»/«Неизвестно».
        LevelText = supply.Level is < 0 || supply.Max is < 0
            ? $"Уровень: {(supply.Level is -3 or -2 ? "OK" : "Неизвестно")}; {PercentText}"
            : $"Уровень: {(supply.Level?.ToString(CultureInfo.InvariantCulture) ?? "-")} / {(supply.Max?.ToString(CultureInfo.InvariantCulture) ?? "-")}; {PercentText}";
    }

    public string Name { get; }
    public int? Percent { get; }
    public double PercentValue { get; }
    public string Tone { get; }
    public string LevelText { get; }
    public bool IsLow => Percent is < 20;
    public string PercentText => Percent is { } p ? $"{p}%" : "N/A";
}

/// <summary>Группа расходников (groupSupplies веба): заголовок + элементы.</summary>
public sealed class MfuSupplyGroupViewModel
{
    public MfuSupplyGroupViewModel(string title, IEnumerable<MfuSupplyItemViewModel> items)
    {
        Title = title;
        Items = items.ToList();
    }

    public string Title { get; }
    public IReadOnlyList<MfuSupplyItemViewModel> Items { get; }
}

/// <summary>Лоток бумаги: имя/носитель, заполненность и уровни в листах.</summary>
public sealed class MfuTrayItemViewModel
{
    public MfuTrayItemViewModel(HubMfuTray tray)
    {
        ArgumentNullException.ThrowIfNull(tray);
        Name = string.IsNullOrWhiteSpace(tray.Name) ? $"Лоток {tray.Index}" : tray.Name!.Trim();
        Percent = tray.Percent;
        PercentValue = tray.Percent is { } p ? Math.Max(0, Math.Min(100, p)) : 0;
        Tone = MfuFormat.TrayTone(tray.Percent);
        var media = string.IsNullOrWhiteSpace(tray.MediaName) ? string.Empty : $"Бумага: {tray.MediaName!.Trim()}; ";
        LevelText = $"{media}Уровень: {(tray.CurrentLevel?.ToString(CultureInfo.InvariantCulture) ?? "-")} / {(tray.MaxCapacity?.ToString(CultureInfo.InvariantCulture) ?? "-")}";
    }

    public string Name { get; }
    public int? Percent { get; }
    public double PercentValue { get; }
    public string Tone { get; }
    public string LevelText { get; }
    public bool HasPercent => Percent is not null;
    public string PercentText => Percent is { } p ? $"{p}%" : string.Empty;
}

/// <summary>Дополнительный SNMP-датчик (custom_metrics{}).</summary>
public sealed class MfuMetricItemViewModel
{
    public MfuMetricItemViewModel(string name, string value)
    {
        Title = $"{name}: {value}";
    }

    public string Title { get; }
}

/// <summary>Строка помесячной печати: «MM.YYYY: N стр.» + счётчик или сброс.</summary>
public sealed class MfuMonthItemViewModel
{
    public MfuMonthItemViewModel(HubMfuMonthPages month)
    {
        ArgumentNullException.ThrowIfNull(month);
        TitleText = $"{MfuFormat.FormatMonthLabel(month.Month)}: {month.PrintedPages} стр.";
        HasReset = month.ResetDetected;
        DetailText = HasReset
            ? "Обнаружен сброс счетчика"
            : $"Счетчик: {(month.StartCounter?.ToString(CultureInfo.InvariantCulture) ?? "-")} → {(month.EndCounter?.ToString(CultureInfo.InvariantCulture) ?? "-")}";
    }

    public string TitleText { get; }
    public string DetailText { get; }
    public bool HasReset { get; }
}

/// <summary>Строка истории работ: «Тип: расходник» + «время; сотрудник».</summary>
public sealed class MfuMaintenanceItemViewModel
{
    public MfuMaintenanceItemViewModel(HubMfuMaintenanceEvent entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        TitleText = $"{MfuFormat.FormatReplacementItemName(entry.ComponentType)}: {MfuFormat.FormatReplacementItemName(entry.ReplacementItem)}";
        DetailText = $"{MfuFormat.FormatDateTime(entry.Timestamp)}; {(string.IsNullOrWhiteSpace(entry.Employee) ? "Без сотрудника" : entry.Employee!.Trim())}";
    }

    public string TitleText { get; }
    public string DetailText { get; }
}

/// <summary>
/// Деталь устройства: инвентарные поля, ping, SNMP-расходники по группам,
/// device_info, дополнительные датчики, лотки, помесячная печать (догружается
/// отдельным запросом /mfu/pages/monthly) и история работ.
/// </summary>
public sealed class MfuDeviceDetailViewModel : ObservableObject
{
    private bool _isMonthlyLoading;
    private string? _monthlyErrorText;
    private string _currentPagesText = "Текущий: -";
    private string _monthlyCheckedAtText = "Дата счетчика: -";
    private string _trackingStartText = "Начало учета: -";

    public MfuDeviceDetailViewModel(HubMfuDevice device)
    {
        ArgumentNullException.ThrowIfNull(device);
        Key = device.Key?.Trim() ?? string.Empty;
        Title = MfuFormat.OrDash(device.ModelName);
        SubtitleText = MfuFormat.OrDash(device.TypeName);
        ManufacturerText = string.IsNullOrWhiteSpace(device.Manufacturer) ? string.Empty : device.Manufacturer!.Trim();

        var (pingLabel, pingTone) = MfuFormat.PingMeta(device.Runtime?.Ping?.Status);
        PingStatusText = pingLabel;
        PingTone = pingTone;
        IsLowToner = MfuFormat.MinSupplyPercent(device) is < 20;

        InvNoText = InfoLine("Инв. номер", device.InvNo);
        SerialText = InfoLine("Серийный", device.SerialNo);
        HwSerialText = InfoLine("HW серийный", device.HwSerialNo);
        IpText = InfoLine("IP", device.IpAddress);
        HostnameText = InfoLine("Hostname", MfuFormat.DeviceHostname(device));
        MacText = InfoLine("MAC", device.MacAddress);
        BranchText = InfoLine("Филиал", device.BranchName);
        LocationText = InfoLine("Локация", device.LocationName);
        EmployeeText = InfoLine("Сотрудник", device.EmployeeName);
        DeptText = InfoLine("Отдел", device.EmployeeDept);

        var ping = device.Runtime?.Ping;
        PingCheckedText = $"Последняя проверка: {MfuFormat.FormatDateTime(ping?.CheckedAt)}";
        PingLastOnlineText = $"Последний online: {MfuFormat.FormatDateTime(ping?.LastOnlineAt)}";
        PingLatencyText = $"Задержка: {(ping?.LatencyMs is { } latency ? $"{latency:0} мс" : "-")}";

        var snmp = device.Runtime?.Snmp;
        SnmpStatusText = string.IsNullOrWhiteSpace(snmp?.Status) ? "unknown" : snmp!.Status!.Trim();
        SnmpCheckedText = $"Последняя проверка: {MfuFormat.FormatDateTime(snmp?.CheckedAt)}";
        SnmpLastSuccessText = $"Последний успешный опрос: {MfuFormat.FormatDateTime(snmp?.LastSuccessAt)}";
        SnmpVersionText = $"Версия SNMP: {MfuFormat.OrDash(snmp?.Version)}";
        SnmpErrorText = string.IsNullOrWhiteSpace(snmp?.Error) ? string.Empty : $"Ошибка SNMP: {snmp!.Error!.Trim()}";
        SnmpCachedNoteText = MfuFormat.NormalizeText(snmp?.Status) == "error" && !string.IsNullOrWhiteSpace(snmp?.LastSuccessAt)
            ? "Временная ошибка SNMP. Показаны последние валидные данные."
            : string.Empty;
        SuppliesEmptyText = MfuFormat.NormalizeText(snmp?.Status) == "error"
            ? "Ошибка SNMP-соединения. Проверьте community и доступность порта 161."
            : "Данных о расходниках нет — принтер не вернул таблицу supplies. Проверьте настройки SNMP в custom_snmp.json.";

        var buckets = new List<MfuSupplyItemViewModel>[MfuFormat.SupplyGroupTitles.Length];
        for (var i = 0; i < buckets.Length; i++)
        {
            buckets[i] = [];
        }

        foreach (var supply in snmp?.Supplies ?? [])
        {
            buckets[MfuFormat.SupplyGroupIndex(supply.Name)].Add(new MfuSupplyItemViewModel(supply));
        }

        for (var i = 0; i < buckets.Length; i++)
        {
            if (buckets[i].Count > 0)
            {
                SupplyGroups.Add(new MfuSupplyGroupViewModel(MfuFormat.SupplyGroupTitles[i], buckets[i]));
            }
        }

        var info = snmp?.DeviceInfo;
        HasDeviceInfo = info is not null
            && (MfuFormat.FirstNonEmpty(info.SerialNumber, info.DeviceModel, info.SysName, info.SysDescr, info.SysLocation) is not null
                || info.UptimeSeconds is not null);
        if (HasDeviceInfo)
        {
            DeviceSerialText = info!.SerialNumber is { Length: > 0 } ? $"Серийный №: {info.SerialNumber.Trim()}" : string.Empty;
            DeviceModelText = info.DeviceModel is { Length: > 0 } ? $"Модель (SNMP): {info.DeviceModel.Trim()}" : string.Empty;
            SysNameText = info.SysName is { Length: > 0 } ? $"Имя устройства: {info.SysName.Trim()}" : string.Empty;
            SysDescrText = info.SysDescr is { Length: > 0 } ? $"Описание: {info.SysDescr.Trim()}" : string.Empty;
            SysLocationText = info.SysLocation is { Length: > 0 } ? $"Расположение: {info.SysLocation.Trim()}" : string.Empty;
            var uptime = MfuFormat.FormatUptime(info.UptimeSeconds);
            UptimeText = uptime.Length > 0 ? $"Uptime: {uptime}" : string.Empty;
        }

        foreach (var (name, value) in snmp?.CustomMetrics ?? [])
        {
            if (!string.IsNullOrWhiteSpace(value))
            {
                CustomMetrics.Add(new MfuMetricItemViewModel(name, value.Trim()));
            }
        }

        foreach (var tray in snmp?.Trays ?? [])
        {
            Trays.Add(new MfuTrayItemViewModel(tray));
        }

        var maintenance = device.Maintenance;
        MaintenanceTotalText = (maintenance?.TotalOperations ?? 0).ToString(CultureInfo.InvariantCulture);
        foreach (var entry in maintenance?.Recent ?? [])
        {
            MaintenanceItems.Add(new MfuMaintenanceItemViewModel(entry));
        }

        MonthlyItems.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsMonthlyEmpty));
            OnPropertyChanged(nameof(HasMonthlyItems));
        };
    }

    public string Key { get; }
    public string Title { get; }
    public string SubtitleText { get; }
    public string ManufacturerText { get; }
    public bool HasManufacturer => ManufacturerText.Length > 0;
    public string PingStatusText { get; }
    public string PingTone { get; }
    public bool IsLowToner { get; }

    /// <summary>Строка реквизита: пустое значение → пустая строка (строку скрывает вью).</summary>
    private static string InfoLine(string label, string? value)
        => string.IsNullOrWhiteSpace(value) ? string.Empty : $"{label}: {value!.Trim()}";

    public string InvNoText { get; }
    public string SerialText { get; }
    public string HwSerialText { get; }
    public string IpText { get; }
    public string HostnameText { get; }
    public string MacText { get; }
    public string BranchText { get; }
    public string LocationText { get; }
    public string EmployeeText { get; }
    public string DeptText { get; }

    public string PingCheckedText { get; }
    public string PingLastOnlineText { get; }
    public string PingLatencyText { get; }

    public string SnmpStatusText { get; }
    public string SnmpCheckedText { get; }
    public string SnmpLastSuccessText { get; }
    public string SnmpVersionText { get; }
    public string SnmpErrorText { get; }
    public bool HasSnmpError => SnmpErrorText.Length > 0;
    public string SnmpCachedNoteText { get; }
    public bool HasSnmpCachedNote => SnmpCachedNoteText.Length > 0;
    public string SuppliesEmptyText { get; }

    public ObservableCollection<MfuSupplyGroupViewModel> SupplyGroups { get; } = [];
    public bool HasSupplies => SupplyGroups.Count > 0;

    public bool HasDeviceInfo { get; }
    public string DeviceSerialText { get; } = string.Empty;
    public string DeviceModelText { get; } = string.Empty;
    public string SysNameText { get; } = string.Empty;
    public string SysDescrText { get; } = string.Empty;
    public string SysLocationText { get; } = string.Empty;
    public string UptimeText { get; } = string.Empty;

    public ObservableCollection<MfuMetricItemViewModel> CustomMetrics { get; } = [];
    public bool HasCustomMetrics => CustomMetrics.Count > 0;

    public ObservableCollection<MfuTrayItemViewModel> Trays { get; } = [];
    public bool HasTrays => Trays.Count > 0;

    // ---- Печать по месяцам (GET /mfu/pages/monthly — догружается при выборе) ----

    public ObservableCollection<MfuMonthItemViewModel> MonthlyItems { get; } = [];

    public bool IsMonthlyLoading
    {
        get => _isMonthlyLoading;
        private set => SetProperty(ref _isMonthlyLoading, value);
    }

    public string? MonthlyErrorText
    {
        get => _monthlyErrorText;
        private set
        {
            if (SetProperty(ref _monthlyErrorText, value))
            {
                OnPropertyChanged(nameof(HasMonthlyError));
            }
        }
    }

    public bool HasMonthlyError => !string.IsNullOrEmpty(MonthlyErrorText);
    public bool IsMonthlyEmpty => MonthlyItems.Count == 0;
    public bool HasMonthlyItems => MonthlyItems.Count > 0;

    public string CurrentPagesText
    {
        get => _currentPagesText;
        private set => SetProperty(ref _currentPagesText, value);
    }

    public string MonthlyCheckedAtText
    {
        get => _monthlyCheckedAtText;
        private set => SetProperty(ref _monthlyCheckedAtText, value);
    }

    public string TrackingStartText
    {
        get => _trackingStartText;
        private set => SetProperty(ref _trackingStartText, value);
    }

    public void SetMonthlyLoading()
    {
        IsMonthlyLoading = true;
        MonthlyErrorText = null;
    }

    /// <summary>Применить ответ /mfu/pages/monthly к секции помесячной печати.</summary>
    public void ApplyMonthly(HubMfuMonthlyPages payload)
    {
        MonthlyItems.Clear();
        foreach (var month in payload.Months ?? [])
        {
            MonthlyItems.Add(new MfuMonthItemViewModel(month));
        }

        CurrentPagesText = $"Текущий: {(payload.CurrentTotalPages?.ToString(CultureInfo.InvariantCulture) ?? "-")}";
        MonthlyCheckedAtText = $"Дата счетчика: {MfuFormat.FormatDateTime(payload.CurrentCheckedAt)}";
        TrackingStartText = $"Начало учета: {MfuFormat.FormatDateOnly(payload.TrackingStartDate)}";
        IsMonthlyLoading = false;
        MonthlyErrorText = null;
    }

    /// <summary>Ошибка загрузки помесячной печати — показывается только в секции.</summary>
    public void SetMonthlyError(string message)
    {
        MonthlyErrorText = message;
        IsMonthlyLoading = false;
    }

    /// <summary>Снять индикатор загрузки при отмене запроса (смена выбора/сброс).</summary>
    public void CancelMonthlyLoading() => IsMonthlyLoading = false;

    // ---- История работ ----

    public ObservableCollection<MfuMaintenanceItemViewModel> MaintenanceItems { get; } = [];
    public string MaintenanceTotalText { get; }
    public bool IsMaintenanceEmpty => MaintenanceItems.Count == 0;
}

/// <summary>
/// Страница «🖨 МФУ»: список МФУ/принтеров/плоттеров выбранной БД со счётчиками
/// доступности, клиентским поиском и фильтрами (филиал/сеть/SNMP) слева, выбор →
/// деталь с расходниками, лотками, помесячной печатью и историей работ.
/// Только чтение: регистрация работ и замена расходников в срез не входят.
/// </summary>
public sealed class MfuViewModel : ObservableObject
{
    /// <summary>Параметры выборки — как DASHBOARD_* константы веб-страницы.</summary>
    private const int PeriodDays = 365;
    private const int RecentLimit = 8;
    private const int DevicesLimit = 5000;

    /// <summary>Глубина помесячной печати — PAGE_MONTHS веба.</summary>
    private const int MonthlyMonths = 12;

    /// <summary>Период статистики работ /json/works/mfu/statistics.</summary>
    private const int WorksPeriodDays = 90;

    internal static readonly MfuFilterItem AllBranches = new("all", "Все");
    internal static readonly MfuFilterItem AllPings = new("all", "Все");
    internal static readonly MfuFilterItem AllSnmp = new("all", "Все");

    private static readonly StringComparer RussianComparer =
        StringComparer.Create(CultureInfo.GetCultureInfo("ru-RU"), ignoreCase: true);

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _monthlyLoadCancellation;

    /// <summary>Кэш помесячной печати по ключу — monthlyDataByKey веба.</summary>
    private readonly Dictionary<string, HubMfuMonthlyPages> _monthlyCache = new(StringComparer.Ordinal);

    /// <summary>Полный срез сгруппированных устройств (фильтры режут его локально).</summary>
    private IReadOnlyList<BranchGroup> _groups = [];

    /// <summary>Заглушка событий фильтров на время Reset.</summary>
    private bool _suppressFilterEvents;

    private MfuDeviceItemViewModel? _selectedDevice;
    private MfuDeviceDetailViewModel? _detail;
    private string _searchText = string.Empty;
    private MfuFilterItem _selectedBranchFilter = AllBranches;
    private MfuFilterItem _selectedPingFilter = AllPings;
    private MfuFilterItem _selectedSnmpFilter = AllSnmp;
    private bool _isDetailedView;
    private bool _isLoading;
    private string? _bannerErrorText;
    private int _devicesTotal;
    private int _filteredCount;
    private string _devicesTotalText = "0";
    private string _onlineTotalText = "0";
    private string _offlineTotalText = "0";
    private string _snmpOkTotalText = "0";
    private string _snmpMetricHelperText = string.Empty;
    private string _snmpDetailHelperText = string.Empty;
    private string _generatedAtText = string.Empty;
    private string _dbIdText = string.Empty;
    private string? _worksSummaryText;
    private string _worksTopTypesText = string.Empty;

    public MfuViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        RefreshMonthlyCommand = new NativeAsyncCommand(
            (_, ct) => ReloadMonthlyAsync(force: true, ct),
            ex => { if (Detail is { } detail) detail.SetMonthlyError(TasksViewModel.DescribeError(ex)); },
            _ => SelectedDevice is not null);
        SelectBranchFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MfuFilterItem option)
            {
                SelectedBranchFilter = option;
            }
        });
        SelectPingFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MfuFilterItem option)
            {
                SelectedPingFilter = option;
            }
        });
        SelectSnmpFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MfuFilterItem option)
            {
                SelectedSnmpFilter = option;
            }
        });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(FilteredSummaryText));
        };
    }

    // ---- Список и фильтры ----

    /// <summary>Строки списка: заголовки филиалов/локаций и карточки устройств.</summary>
    public ObservableCollection<MfuListRow> Items { get; } = [];

    /// <summary>Выбранное устройство (заголовки групп не выбираются).</summary>
    public MfuDeviceItemViewModel? SelectedDevice
    {
        get => _selectedDevice;
        set
        {
            if (SetProperty(ref _selectedDevice, value))
            {
                Detail = value is null ? null : new MfuDeviceDetailViewModel(value.Device);
                if (value is not null)
                {
                    _ = LoadMonthlySafelyAsync(value.Key, force: false);
                }
                else
                {
                    _monthlyLoadCancellation?.Cancel();
                }

                ((NativeAsyncCommand)RefreshMonthlyCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public MfuDeviceDetailViewModel? Detail
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
    public bool ShowDetailPlaceholder => Detail is null;

    /// <summary>Поиск по модели/инв.номеру/серийному/IP/сотруднику — blob веба.</summary>
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

    /// <summary>Опции фильтра «Филиал» — «Все» + имена филиалов из выдачи.</summary>
    public ObservableCollection<MfuFilterItem> BranchFilterOptions { get; } = [AllBranches];

    public MfuFilterItem SelectedBranchFilter
    {
        get => _selectedBranchFilter;
        set
        {
            if (SetProperty(ref _selectedBranchFilter, value ?? AllBranches))
            {
                OnPropertyChanged(nameof(SelectedBranchFilterText));
                ApplyFilter();
            }
        }
    }

    public string SelectedBranchFilterText => _selectedBranchFilter.Label;

    /// <summary>Опции фильтра «Сеть» — ping-статусы из веб-Select.</summary>
    public ObservableCollection<MfuFilterItem> PingFilterOptions { get; } =
    [
        AllPings,
        new("online", "В сети"),
        new("offline", "Оффлайн"),
        new("unknown", "Неизвестно"),
    ];

    public MfuFilterItem SelectedPingFilter
    {
        get => _selectedPingFilter;
        set
        {
            if (SetProperty(ref _selectedPingFilter, value ?? AllPings))
            {
                OnPropertyChanged(nameof(SelectedPingFilterText));
                ApplyFilter();
            }
        }
    }

    public string SelectedPingFilterText => _selectedPingFilter.Label;

    /// <summary>Опции фильтра «SNMP» — low_toner/no_data/error из веб-Select.</summary>
    public ObservableCollection<MfuFilterItem> SnmpFilterOptions { get; } =
    [
        AllSnmp,
        new("low_toner", "Тонер < 20%"),
        new("no_data", "Нет данных"),
        new("error", "Ошибка SNMP"),
    ];

    public MfuFilterItem SelectedSnmpFilter
    {
        get => _selectedSnmpFilter;
        set
        {
            if (SetProperty(ref _selectedSnmpFilter, value ?? AllSnmp))
            {
                OnPropertyChanged(nameof(SelectedSnmpFilterText));
                ApplyFilter();
            }
        }
    }

    public string SelectedSnmpFilterText => _selectedSnmpFilter.Label;

    /// <summary>Переключатель «Подробно» — карточки с серийником/отделом/последней работой.</summary>
    public bool IsDetailedView
    {
        get => _isDetailedView;
        set => SetProperty(ref _isDetailedView, value);
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(ShowZeroDevicesNotice));
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
                OnPropertyChanged(nameof(ShowZeroDevicesNotice));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    // ---- Счётчики и метаданные выдачи ----

    public string DevicesTotalText
    {
        get => _devicesTotalText;
        private set => SetProperty(ref _devicesTotalText, value);
    }

    public string OnlineTotalText
    {
        get => _onlineTotalText;
        private set => SetProperty(ref _onlineTotalText, value);
    }

    public string OfflineTotalText
    {
        get => _offlineTotalText;
        private set => SetProperty(ref _offlineTotalText, value);
    }

    public string SnmpOkTotalText
    {
        get => _snmpOkTotalText;
        private set => SetProperty(ref _snmpOkTotalText, value);
    }

    /// <summary>«свежие: X, кэш: Y, TTL: Z мин» — helper карточки SNMP веба.</summary>
    public string SnmpMetricHelperText
    {
        get => _snmpMetricHelperText;
        private set => SetProperty(ref _snmpMetricHelperText, value);
    }

    /// <summary>«ошибки: X, неизвестно: Y» — строка под карточками веба.</summary>
    public string SnmpDetailHelperText
    {
        get => _snmpDetailHelperText;
        private set => SetProperty(ref _snmpDetailHelperText, value);
    }

    /// <summary>«Обновлено: …» по generated_at выдачи.</summary>
    public string GeneratedAtText
    {
        get => _generatedAtText;
        private set => SetProperty(ref _generatedAtText, value);
    }

    /// <summary>«БД: …» — выбранная база ответа.</summary>
    public string DbIdText
    {
        get => _dbIdText;
        private set => SetProperty(ref _dbIdText, value);
    }

    /// <summary>Предупреждение веба «API вернул 0 устройств МФУ…» (только без загрузки и ошибки).</summary>
    public bool ShowZeroDevicesNotice => _devicesTotal == 0 && !IsLoading && !HasBannerError;

    /// <summary>«N устройств» или «Показано: X из Y» — счётчик применённых фильтров.</summary>
    public string FilteredSummaryText => _filteredCount == _devicesTotal
        ? MfuFormat.FormatCount(_filteredCount, "устройство", "устройства", "устройств")
        : $"Показано: {_filteredCount} из {_devicesTotal}";

    // ---- Статистика работ /json/works/mfu/statistics ----

    /// <summary>«Работ за N дн.: X · филиалов: Y · локаций: Z» — пусто при ошибке.</summary>
    public string? WorksSummaryText
    {
        get => _worksSummaryText;
        private set
        {
            if (SetProperty(ref _worksSummaryText, value))
            {
                OnPropertyChanged(nameof(HasWorksSummary));
            }
        }
    }

    /// <summary>«По типам: Картридж — 5 · …» — топ типов работ за период.</summary>
    public string WorksTopTypesText
    {
        get => _worksTopTypesText;
        private set
        {
            if (SetProperty(ref _worksTopTypesText, value))
            {
                OnPropertyChanged(nameof(HasWorksTopTypes));
            }
        }
    }

    public bool HasWorksSummary => !string.IsNullOrEmpty(WorksSummaryText);
    public bool HasWorksTopTypes => !string.IsNullOrEmpty(WorksTopTypesText);

    public ICommand RefreshCommand { get; }
    public ICommand RefreshMonthlyCommand { get; }
    public ICommand SelectBranchFilterCommand { get; }
    public ICommand SelectPingFilterCommand { get; }
    public ICommand SelectSnmpFilterCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Первичная загрузка/обновление снимка МФУ + статистики работ.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var payload = await _api.GetMfuDevicesAsync(
                PeriodDays, RecentLimit, DevicesLimit, cancellationToken);
            ApplyPayload(payload);
            BannerErrorText = null;

            // Статистика работ — вторичный виджет: её сбой не портит список.
            try
            {
                var stats = await _api.GetMfuWorksStatisticsAsync(WorksPeriodDays, cancellationToken);
                ApplyWorksStatistics(stats);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch
            {
                WorksSummaryText = null;
                WorksTopTypesText = string.Empty;
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ApplyPayload(HubMfuDeviceList payload)
    {
        var previousSelection = _selectedDevice?.Key;
        var groups = new List<BranchGroup>();
        var devicesCount = 0;
        foreach (var (branchName, locations) in payload.Grouped ?? [])
        {
            var branch = new BranchGroup(branchName);
            foreach (var (locationName, devices) in (locations ?? [])
                     .OrderBy(pair => pair.Key, RussianComparer))
            {
                var location = new LocationGroup(locationName);
                // Порядок веба: критичный тонер вперёд, затем по минимальному проценту.
                var sorted = (devices ?? [])
                    .Select(device => new MfuDeviceItemViewModel(device, branchName, locationName))
                    .OrderBy(item => item.MinPercent is < 20 ? 0 : 1)
                    .ThenBy(item => MfuFormat.SortPercent(item.Device))
                    .ToList();
                location.Items.AddRange(sorted);
                devicesCount += sorted.Count;
                branch.Locations.Add(location);
            }

            if (branch.Locations.Count > 0)
            {
                groups.Add(branch);
            }
        }

        _groups = groups;
        _devicesTotal = payload.Totals?.Devices ?? devicesCount;

        // Опции филиалов — «Все» + ветки в порядке выдачи; выбор сохраняем, если ветка жива.
        BranchFilterOptions.Clear();
        BranchFilterOptions.Add(AllBranches);
        foreach (var name in groups.Select(group => group.Name))
        {
            BranchFilterOptions.Add(new MfuFilterItem(name, name));
        }

        var branchAlive = BranchFilterOptions.Any(option => option.Value == _selectedBranchFilter.Value);
        if (!branchAlive)
        {
            _suppressFilterEvents = true;
            SelectedBranchFilter = AllBranches;
            _suppressFilterEvents = false;
        }

        ApplyFilter();

        var totals = payload.Totals;
        DevicesTotalText = (totals?.Devices ?? devicesCount).ToString(CultureInfo.InvariantCulture);
        OnlineTotalText = (totals?.Online ?? 0).ToString(CultureInfo.InvariantCulture);
        OfflineTotalText = (totals?.Offline ?? 0).ToString(CultureInfo.InvariantCulture);
        SnmpOkTotalText = (totals?.SnmpOk ?? 0).ToString(CultureInfo.InvariantCulture);
        var ttlMinutes = totals is { SnmpActiveTtlSec: > 0 }
            ? Math.Max(1, (int)Math.Round(totals.SnmpActiveTtlSec / 60.0))
            : 60;
        SnmpMetricHelperText = $"свежие: {totals?.SnmpFresh ?? 0}, кэш: {totals?.SnmpCachedActive ?? 0}, TTL: {ttlMinutes} мин";
        SnmpDetailHelperText = $"ошибки: {totals?.SnmpError ?? 0}, неизвестно: {totals?.SnmpUnknown ?? 0}";
        GeneratedAtText = $"Обновлено: {MfuFormat.FormatDateTime(payload.GeneratedAt)}";
        DbIdText = string.IsNullOrWhiteSpace(payload.DbId) ? string.Empty : $"БД: {payload.DbId!.Trim()}";
        OnPropertyChanged(nameof(ShowZeroDevicesNotice));

        // Выбранное устройство обновляем свежим payload или снимаем выбор.
        if (previousSelection is not null)
        {
            var fresh = groups
                .SelectMany(branch => branch.Locations)
                .SelectMany(location => location.Items)
                .FirstOrDefault(item => item.Key == previousSelection);
            if (fresh is null)
            {
                _monthlyLoadCancellation?.Cancel();
                Detail = null;
                SelectedDevice = null;
            }
            else
            {
                SelectedDevice = fresh;
            }
        }
    }

    private void ApplyWorksStatistics(HubMfuWorksStatistics stats)
    {
        var totals = stats.Totals;
        var period = stats.PeriodDays > 0 ? stats.PeriodDays : WorksPeriodDays;
        WorksSummaryText = totals is null
            ? null
            : $"Работ за {period} дн.: {totals.TotalOperations} · филиалов: {totals.UniqueBranches} · локаций: {totals.UniqueLocations}";
        var top = (stats.ByTypePeriod ?? [])
            .OrderByDescending(pair => pair.Value)
            .ThenBy(pair => pair.Key, RussianComparer)
            .Take(4)
            .Select(pair => $"{pair.Key} — {pair.Value}")
            .ToList();
        WorksTopTypesText = top.Count > 0 ? $"По типам: {string.Join(" · ", top)}" : string.Empty;
    }

    /// <summary>
    /// Фильтры и поиск — filteredGrouped веба: филиал → ping-статус → SNMP
    /// (low_toner/no_data/error) → подстрока по blob полей.
    /// </summary>
    private void ApplyFilter()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        var needle = MfuFormat.NormalizeText(_searchText);
        var filteredCount = 0;
        Items.Clear();
        foreach (var branch in _groups)
        {
            if (_selectedBranchFilter.Value != "all" && branch.Name != _selectedBranchFilter.Value)
            {
                continue;
            }

            var branchRows = new List<MfuListRow>();
            var branchCount = 0;
            var branchLocationCount = 0;
            foreach (var location in branch.Locations)
            {
                var rows = location.Items.Where(item =>
                {
                    var pingStatus = MfuFormat.NormalizeText(item.Device.Runtime?.Ping?.Status ?? "unknown");
                    if (_selectedPingFilter.Value != "all" && pingStatus != _selectedPingFilter.Value)
                    {
                        return false;
                    }

                    if (_selectedSnmpFilter.Value != "all")
                    {
                        var snmpStatus = MfuFormat.NormalizeText(item.Device.Runtime?.Snmp?.Status);
                        var minPct = MfuFormat.MinSupplyPercent(item.Device);
                        if (_selectedSnmpFilter.Value == "no_data" && snmpStatus != "no_data")
                        {
                            return false;
                        }

                        if (_selectedSnmpFilter.Value == "error" && snmpStatus != "error")
                        {
                            return false;
                        }

                        if (_selectedSnmpFilter.Value == "low_toner" && minPct is not < 20)
                        {
                            return false;
                        }
                    }

                    return needle.Length == 0 || item.SearchBlob.Contains(needle, StringComparison.Ordinal);
                }).ToList();
                if (rows.Count == 0)
                {
                    continue;
                }

                var online = rows.Count(item => MfuFormat.NormalizeText(item.Device.Runtime?.Ping?.Status) == "online");
                var offline = rows.Count(item => MfuFormat.NormalizeText(item.Device.Runtime?.Ping?.Status) == "offline");
                branchRows.Add(new MfuLocationRow(location.Name, rows.Count, online, offline));
                branchRows.AddRange(rows);
                branchCount += rows.Count;
                branchLocationCount++;
            }

            if (branchCount == 0)
            {
                continue;
            }

            Items.Add(new MfuBranchRow(branch.Name, branchCount, branchLocationCount));
            foreach (var row in branchRows)
            {
                Items.Add(row);
            }

            filteredCount += branchCount;
        }

        _filteredCount = filteredCount;
        OnPropertyChanged(nameof(FilteredSummaryText));
        OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Печать по месяцам ----

    /// <summary>Кнопка «Обновить» в секции помесячной печати — принудительный перезапрос.</summary>
    private Task ReloadMonthlyAsync(bool force, CancellationToken cancellationToken) =>
        _selectedDevice is { Key.Length: > 0 } selected
            ? LoadMonthlySafelyAsync(selected.Key, force, cancellationToken)
            : Task.CompletedTask;

    private async Task LoadMonthlySafelyAsync(string key, bool force, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(key))
        {
            return;
        }

        var detail = Detail;
        if (!force && _monthlyCache.TryGetValue(key, out var cached))
        {
            detail?.ApplyMonthly(cached);
            return;
        }

        _monthlyLoadCancellation?.Cancel();
        var cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _monthlyLoadCancellation = cancellation;
        detail?.SetMonthlyLoading();
        try
        {
            var payload = await _api.GetMfuMonthlyPagesAsync(key, MonthlyMonths, cancellation.Token);
            _monthlyCache[key] = payload;
            if (_selectedDevice?.Key == key && ReferenceEquals(Detail, detail))
            {
                detail?.ApplyMonthly(payload);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            // Ошибка устаревшей загрузки не перекрывает секцию нового выбора.
            if (_selectedDevice?.Key == key && ReferenceEquals(Detail, detail))
            {
                detail?.SetMonthlyError(TasksViewModel.DescribeError(ex));
            }
        }
        finally
        {
            if (ReferenceEquals(_monthlyLoadCancellation, cancellation))
            {
                detail?.CancelMonthlyLoading();
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
        _monthlyLoadCancellation?.Cancel();
        _monthlyLoadCancellation = null;
        _monthlyCache.Clear();
        _groups = [];
        _devicesTotal = 0;
        _filteredCount = 0;
        _suppressFilterEvents = true;
        Items.Clear();
        Detail = null;
        SelectedDevice = null;
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedBranchFilter = AllBranches;
        OnPropertyChanged(nameof(SelectedBranchFilter));
        OnPropertyChanged(nameof(SelectedBranchFilterText));
        _selectedPingFilter = AllPings;
        OnPropertyChanged(nameof(SelectedPingFilter));
        OnPropertyChanged(nameof(SelectedPingFilterText));
        _selectedSnmpFilter = AllSnmp;
        OnPropertyChanged(nameof(SelectedSnmpFilter));
        OnPropertyChanged(nameof(SelectedSnmpFilterText));
        _isDetailedView = false;
        OnPropertyChanged(nameof(IsDetailedView));
        BranchFilterOptions.Clear();
        BranchFilterOptions.Add(AllBranches);
        _suppressFilterEvents = false;
        DevicesTotalText = "0";
        OnlineTotalText = "0";
        OfflineTotalText = "0";
        SnmpOkTotalText = "0";
        SnmpMetricHelperText = string.Empty;
        SnmpDetailHelperText = string.Empty;
        GeneratedAtText = string.Empty;
        DbIdText = string.Empty;
        OnPropertyChanged(nameof(ShowZeroDevicesNotice));
        WorksSummaryText = null;
        WorksTopTypesText = string.Empty;
        IsLoading = false;
        OnPropertyChanged(nameof(FilteredSummaryText));
    }

    /// <summary>Филиал → локации → устройства — внутренняя структура среза выдачи.</summary>
    private sealed class BranchGroup(string name)
    {
        public string Name { get; } = name;
        public List<LocationGroup> Locations { get; } = [];
    }

    private sealed class LocationGroup(string name)
    {
        public string Name { get; } = name;
        public List<MfuDeviceItemViewModel> Items { get; } = [];
    }
}
