using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;
using Point = System.Windows.Point;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Подписи и цвета раздела «ИТ-объекты» — зеркало веб-констант
/// (itObjectsShared.js SECTION_LABELS/LEVEL_LABELS, constructionShared.js OBJECT_TEAM_ROLES,
/// ItObjectDetail.jsx COMPUTER_STATUS и monitoring targetStatus).
/// </summary>
internal static class ItObjectCatalog
{
    private static readonly IReadOnlyDictionary<string, string> SectionLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["passwords"] = "Пароли",
            ["computers"] = "Компьютеры",
            ["inventory"] = "Инвентарь",
            ["monitoring"] = "Мониторинг",
            ["netmap"] = "Карта сети",
        };

    private static readonly IReadOnlyDictionary<string, string> LevelLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["view"] = "Просмотр",
            ["manage"] = "Управление",
        };

    /// <summary>Порядок разделов в чипах доступа — как SECTION_KEYS в вебе.</summary>
    public static readonly IReadOnlyList<string> SectionKeys =
        ["passwords", "computers", "inventory", "monitoring", "netmap"];

    /// <summary>Действия журнала аудита паролей — AUDIT_ACTIONS из ItObjectDetail.jsx.</summary>
    private static readonly IReadOnlyDictionary<string, string> PasswordAuditActionLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["create"] = "создал(а)",
            ["update"] = "изменил(а)",
            ["archive"] = "архивировал(а)",
            ["reveal.show"] = "открыл(а) пароль",
            ["reveal.copy"] = "скопировал(а) пароль",
        };

    /// <summary>Порядок ролей постоянной команды — как OBJECT_TEAM_ROLES в вебе.</summary>
    public static readonly IReadOnlyList<(string Key, string Label)> TeamRoles =
    [
        ("project_lead", "Руководитель проекта"),
        ("pto_manager", "Менеджер ПТО"),
        ("umto_coordinator", "Координатор УМТО"),
        ("chief_project_engineer", "ГИП — главный инженер проекта"),
    ];

    public static string SectionLabelOf(string? section) =>
        section is not null && SectionLabels.TryGetValue(section, out var label)
            ? label
            : section ?? string.Empty;

    public static string LevelLabelOf(string? level) =>
        level is not null && LevelLabels.TryGetValue(level, out var label)
            ? label
            : level ?? string.Empty;

    /// <summary>Подпись действия аудита паролей; неизвестное действие — как в вебе, сырым кодом.</summary>
    public static string PasswordAuditActionLabelOf(string? action) =>
        action is not null && PasswordAuditActionLabels.TryGetValue(action, out var label)
            ? label
            : action?.Trim() ?? string.Empty;

    /// <summary>Компьютер объекта — COMPUTER_STATUS из веб-детали (color → тон).</summary>
    public static (string Label, string Tone) ComputerStatusOf(string? status) => status switch
    {
        "online" => ("В сети", HubStatusTone.Success),
        "stale" => ("Давно не выходил", HubStatusTone.Warning),
        "offline" => ("Не в сети", HubStatusTone.Muted),
        _ => ("Нет данных", HubStatusTone.Muted),
    };

    /// <summary>Цель мониторинга — targetStatus из monitoringFormat.js.</summary>
    public static (string Label, string Tone) MonitoringStatusOf(HubItObjectMonitoringTarget target)
    {
        if (!target.Enabled)
        {
            return ("Приостановлен", HubStatusTone.Muted);
        }

        var current = target.Current;
        if (string.IsNullOrEmpty(current?.CheckedAt))
        {
            return ("Ожидает опроса", HubStatusTone.Muted);
        }

        // isStale(checked_at, 120/360 сек) — как в вебе: свежесть данных по времени опроса.
        var staleAfter = TimeSpan.FromSeconds(current.Status == "offline" ? 360 : 120);
        if (DateTimeOffset.TryParse(current.CheckedAt, CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var checkedAt)
            && DateTimeOffset.UtcNow - checkedAt > staleAfter)
        {
            return ("Данные устарели", HubStatusTone.Warning);
        }

        if (current.Status == "offline")
        {
            return ("Нет связи", HubStatusTone.Danger);
        }

        if (current.Status == "unknown")
        {
            return ("Проверяем связь", HubStatusTone.Warning);
        }

        if (current.SnmpStatus != "ok")
        {
            return ("Нет SNMP", HubStatusTone.Warning);
        }

        var link = target.Outages?.FirstOrDefault(
            outage => outage.Kind == "link" && outage.ClosedAt is null);
        if (link is not null)
        {
            return (link.InterfaceRole == "wan" ? "Упал WAN" : "Нет линка", HubStatusTone.Danger);
        }

        if (current.OpenEvents > 0)
        {
            return ("Есть события", HubStatusTone.Warning);
        }

        return ("В сети", HubStatusTone.Success);
    }
}

/// <summary>Форматеры дат карточки объекта (isoformat backend'а).</summary>
internal static class ItObjectFormat
{
    internal static string FormatDate(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture)
            : string.Empty;

    /// <summary>Дата-время версии: сервер отдаёт ISO/UTC — показываем локальные «dd.MM.yyyy HH:mm».</summary>
    internal static string FormatDateTime(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "—";
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : value.Trim();
    }
}

/// <summary>Строка списка объектов: имя, айтишник, бейджи скрытия/отсутствия привязки.</summary>
public sealed class ItObjectListItemViewModel
{
    public ItObjectListItemViewModel(HubItObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        ObjectRef = item.ObjectRef ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(item.Name) ? ObjectRef : item.Name!;
        IsOwnerMissing = item.Owner is null;
        OwnerText = IsOwnerMissing ? "Айтишник не назначен" : item.Owner!.UserName ?? "Айтишник не назначен";
        IsHidden = item.Hidden;
        IsUnlinked = !item.Linked;
        OwnerAutomationName = IsOwnerMissing
            ? $"{Title}, айтишник не назначен"
            : $"{Title}, айтишник {OwnerText}";
    }

    public string ObjectRef { get; }
    public string Title { get; }
    public string OwnerText { get; }
    public bool IsOwnerMissing { get; }
    public bool IsHidden { get; }
    public bool IsUnlinked { get; }
    public string OwnerAutomationName { get; }
}

/// <summary>Роль постоянной команды объекта: фиксированный слот с назначенным сотрудником или «не назначена».</summary>
public sealed class ItObjectTeamRoleViewModel
{
    public ItObjectTeamRoleViewModel(string label, HubItObjectTeamRole? role)
    {
        RoleLabel = label;
        PersonText = string.IsNullOrWhiteSpace(role?.FullName) ? "Не назначена" : role!.FullName!;
        IsAssigned = !string.IsNullOrWhiteSpace(role?.FullName);
        var meta = new[]
            {
                role?.Position,
                string.IsNullOrWhiteSpace(role?.DepartmentLocation)
                    ? role?.Department
                    : $"{role?.Department} · {role?.DepartmentLocation}",
            }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim());
        MetaText = string.Join(" · ", meta);
        var validFrom = ItObjectFormat.FormatDate(role?.ValidFrom);
        AssignedText = IsAssigned && validFrom.Length > 0 ? $"с {validFrom}" : string.Empty;
    }

    public string RoleLabel { get; }
    public string PersonText { get; }
    public bool IsAssigned { get; }
    public string MetaText { get; }
    public string AssignedText { get; }
}

/// <summary>Выданный доступ к разделу (строка grants карточки — виден владельцу и администратору).</summary>
public sealed class ItObjectGrantViewModel
{
    public ItObjectGrantViewModel(HubItObjectGrant grant)
    {
        PersonText = string.IsNullOrWhiteSpace(grant.UserName) ? $"Пользователь {grant.UserId}" : grant.UserName!;
        SectionText = ItObjectCatalog.SectionLabelOf(grant.Section);
        LevelText = ItObjectCatalog.LevelLabelOf(grant.Level);
        SectionLevelText = string.Join(
            " · ",
            new[] { SectionText, LevelText }.Where(part => !string.IsNullOrEmpty(part)));
        CreatedText = ItObjectFormat.FormatDate(grant.CreatedAt);
    }

    public string PersonText { get; }
    public string SectionText { get; }
    public string LevelText { get; }
    public string SectionLevelText { get; }
    public string CreatedText { get; }
}

/// <summary>Компьютер объекта: hostname, статус-плашка, пользователь, IP и инвентарные данные.</summary>
public sealed class ItObjectComputerViewModel : ObservableObject
{
    private bool _isSelected;

    public ItObjectComputerViewModel(HubItObjectComputer item)
    {
        MacAddress = item.MacAddress?.Trim() ?? string.Empty;
        Hostname = string.IsNullOrWhiteSpace(item.Hostname) ? "—" : item.Hostname!;
        var (label, tone) = ItObjectCatalog.ComputerStatusOf(item.Status);
        StatusText = label;
        StatusTone = tone;
        UserText = string.IsNullOrWhiteSpace(item.UserFullName) ? string.Empty : item.UserFullName!;
        if (UserText.Length == 0 && !string.IsNullOrWhiteSpace(item.UserLogin))
        {
            UserText = item.UserLogin!;
        }

        IpText = item.IpPrimary ?? string.Empty;
        var inventory = new[]
            {
                string.IsNullOrWhiteSpace(item.InventoryInvNo) ? null : $"Инв. {item.InventoryInvNo!.Trim()}",
                item.InventoryModelName,
            }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim());
        InventoryText = string.Join(" · ", inventory);
        AutomationName = $"Компьютер {Hostname}, {StatusText}";
    }

    /// <summary>MAC — ключ запроса детали (GET /it-objects/{ref}/computers/{mac}).</summary>
    public string MacAddress { get; }
    public string Hostname { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string UserText { get; }
    public string IpText { get; }
    public string InventoryText { get; }
    public string AutomationName { get; }

    /// <summary>Строка раскрыта — под ней показана деталь компьютера.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>Позиция оборудования объекта: тип/модель, инв. №, серийный, сотрудник и расположение.</summary>
public sealed class ItObjectInventoryItemViewModel
{
    public ItObjectInventoryItemViewModel(HubItObjectInventoryItem item)
    {
        var title = new[] { item.TypeName, item.ModelName }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim())
            .ToArray();
        Title = title.Length > 0
            ? string.Join(" · ", title)
            : $"Инв. {item.InvNo ?? "—"}";
        var meta = new[]
            {
                string.IsNullOrWhiteSpace(item.InvNo) ? null : $"Инв. {item.InvNo!.Trim()}",
                string.IsNullOrWhiteSpace(item.SerialNo) ? null : $"С/н {item.SerialNo!.Trim()}",
                item.EmployeeName,
                item.Location,
            }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim());
        MetaText = string.Join(" · ", meta);
        StatusText = item.Status ?? string.Empty;
    }

    public string Title { get; }
    public string MetaText { get; }
    public string StatusText { get; }
}

/// <summary>Устройство мониторинга объекта: имя, адрес и статусная плашка.</summary>
public sealed class ItObjectMonitoringTargetViewModel : ObservableObject
{
    private bool _isSelected;

    public ItObjectMonitoringTargetViewModel(HubItObjectMonitoringTarget target)
    {
        TargetId = target.Id?.Trim() ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(target.Name) ? target.Address ?? "—" : target.Name!;
        AddressText = string.IsNullOrWhiteSpace(target.Address)
            ? string.Empty
            : target.Port is > 0 ? $"{target.Address}:{target.Port}" : target.Address!;
        var (label, tone) = ItObjectCatalog.MonitoringStatusOf(target);
        StatusText = label;
        StatusTone = tone;
        AutomationName = $"Устройство мониторинга {Title}, {StatusText}";
    }

    /// <summary>id цели (uuid-строка) — ключ запроса latency-history.</summary>
    public string TargetId { get; }
    public string Title { get; }
    public string AddressText { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string AutomationName { get; }

    /// <summary>Строка раскрыта — под ней показан спарклайн задержки за 24 ч.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>
/// Спарклайн задержки цели мониторинга за 24 ч (points[] latency-history):
/// точки нормализуются в поле 100×30 (x — позиция в последовательности,
/// y — latency_ms относительно max). Точки без latency_ms — недоступность:
/// разрывают линию на отдельные сегменты и идут в «потери» сводки.
/// </summary>
public sealed class MonitoringLatencyViewModel
{
    /// <summary>Система координат спарклайна (Canvas 100×30 в фикс-рамке).</summary>
    private const double ChartWidth = 100;
    private const double ChartHeight = 30;

    public MonitoringLatencyViewModel(HubMonitoringLatencyHistory history)
    {
        ArgumentNullException.ThrowIfNull(history);
        var points = history.Points ?? [];

        var max = 0.0;
        var min = double.MaxValue;
        var sum = 0.0;
        var valid = 0;
        foreach (var point in points)
        {
            if (point.LatencyMs is { } latency)
            {
                valid++;
                sum += latency;
                if (latency < min)
                {
                    min = latency;
                }

                if (latency > max)
                {
                    max = latency;
                }
            }
        }

        var segments = new List<PointCollection>();
        PointCollection? segment = null;
        for (var i = 0; i < points.Count; i++)
        {
            if (points[i].LatencyMs is not { } latency)
            {
                segment = null; // разрыв: пропуск опроса/недоступность
                continue;
            }

            if (segment is null)
            {
                segment = new PointCollection();
                segments.Add(segment);
            }

            var x = points.Count > 1 ? ChartWidth * i / (points.Count - 1) : ChartWidth / 2;
            var y = max > 0 ? ChartHeight - latency / max * ChartHeight : ChartHeight;
            segment.Add(new Point(x, y));
        }

        foreach (var line in segments)
        {
            line.Freeze();
        }

        Segments = segments;
        var lossPercent = points.Count > 0 ? 100.0 * (points.Count - valid) / points.Count : 0;
        SummaryText = valid == 0
            ? points.Count == 0
                ? "Нет данных за 24 ч"
                : $"Нет данных за 24 ч · потери {FormatNumber(lossPercent)}%"
            : $"avg {FormatNumber(sum / valid)} мс · min {FormatNumber(min)} · max {FormatNumber(max)} · потери {FormatNumber(lossPercent)}%";
        AutomationName = $"График задержки за 24 часа: {SummaryText}";
    }

    /// <summary>Сегменты ломаной — каждая непрерывная серия непустых точек.</summary>
    public IReadOnlyList<PointCollection> Segments { get; }

    /// <summary>Сводка: «avg X мс · min Y · max Z · потери N%» (потери — доля точек без значения).</summary>
    public string SummaryText { get; }
    public string AutomationName { get; }

    private static string FormatNumber(double value) =>
        value.ToString("0.#", CultureInfo.InvariantCulture);
}

/// <summary>
/// Версия схемы карты сети (items[] GET /it-objects/{ref}/netmap/versions):
/// «vN», имя файла, локальная дата сохранения и автор — read-only строка под превью.
/// </summary>
public sealed class ItObjectNetmapVersionViewModel
{
    public ItObjectNetmapVersionViewModel(HubItObjectNetmapVersion item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Version = item.Version;
        VersionText = string.Create(CultureInfo.InvariantCulture, $"v{item.Version}");
        FileNameText = item.FileName?.Trim() ?? string.Empty;
        SavedAtText = ItObjectFormat.FormatDateTime(item.SavedAt);
        SavedByText = item.SavedBy?.Trim() ?? string.Empty;
        LineText = string.Join(
            " · ",
            new[] { VersionText, FileNameText, SavedAtText, SavedByText }
                .Where(part => !string.IsNullOrEmpty(part)));
        AutomationName = $"Версия {VersionText} карты сети";
    }

    /// <summary>Номер версии (version из ответа).</summary>
    public int Version { get; }

    /// <summary>Метка номера: «v3».</summary>
    public string VersionText { get; }
    public string FileNameText { get; }

    /// <summary>saved_at в локальном «dd.MM.yyyy HH:mm» («—», если даты нет).</summary>
    public string SavedAtText { get; }
    public string SavedByText { get; }

    /// <summary>Вся строка: «v3 · map.drawio · 12.03.2026 15:04 · Иванов Иван».</summary>
    public string LineText { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Строка журнала аудита паролей объекта (items[] GET …/passwords/audit):
/// «{время локальное} · {кто} {что сделал} · {логин записи}» — зеркало формата
/// веб-панели PasswordsAudit (toLocaleString + AUDIT_ACTIONS + entry_login).
/// Само значение секрета в контракт не входит и не показывается.
/// </summary>
public sealed class ItObjectPasswordAuditEntryViewModel
{
    public ItObjectPasswordAuditEntryViewModel(HubItObjectPasswordAuditItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id;
        var actor = string.IsNullOrWhiteSpace(item.ActorUsername)
            ? $"Пользователь {item.ActorUserId}"
            : item.ActorUsername!.Trim();
        var action = ItObjectCatalog.PasswordAuditActionLabelOf(item.Action);
        var who = string.Join(
            " ",
            new[] { actor, action }.Where(part => !string.IsNullOrEmpty(part)));
        var when = string.IsNullOrWhiteSpace(item.CreatedAt)
            ? null
            : ItObjectFormat.FormatDateTime(item.CreatedAt);
        var entry = string.IsNullOrWhiteSpace(item.EntryLogin) ? null : item.EntryLogin!.Trim();
        LineText = string.Join(
            " · ",
            new[] { when, who, entry }.Where(part => !string.IsNullOrEmpty(part)));
        AutomationName = $"Запись журнала паролей: {LineText}";
    }

    /// <summary>id записи аудита (id из ответа).</summary>
    public long Id { get; }

    /// <summary>Вся строка: «28.10.2026 13:00 · ivanov скопировал(а) пароль · rega-admin».</summary>
    public string LineText { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Карточка объекта: реквизиты, мой доступ, постоянная команда, гранты и
/// содержимое разделов (компьютеры/инвентарь/мониторинг грузятся отдельными запросами).
/// </summary>
public sealed class ItObjectDetailViewModel : ObservableObject
{
    private bool _isComputersLoading;
    private string? _computersErrorText;
    private ItObjectComputerViewModel? _selectedComputer;
    private ComputerDetailViewModel? _computerDetail;
    private bool _isComputerDetailLoading;
    private string? _computerDetailErrorText;
    private bool _isInventoryLoading;
    private string? _inventoryErrorText;
    private bool _isMonitoringLoading;
    private string? _monitoringErrorText;
    private ItObjectMonitoringTargetViewModel? _selectedMonitoringTarget;
    private MonitoringLatencyViewModel? _monitoringLatency;
    private bool _isMonitoringLatencyLoading;
    private string? _monitoringLatencyErrorText;

    public ItObjectDetailViewModel(HubItObjectDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
        ObjectRef = detail.ObjectRef ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(detail.Name) ? ObjectRef : detail.Name!;
        IsHidden = detail.Hidden;
        IsUnlinked = !detail.Linked;
        IsOwnerMissing = detail.Owner is null;
        OwnerText = IsOwnerMissing ? "Айтишник не назначен" : detail.Owner!.UserName ?? "Айтишник не назначен";
        SourceDatabaseText = string.IsNullOrWhiteSpace(detail.SourceDatabaseId)
            ? string.Empty
            : $"База источника: {detail.SourceDatabaseId}";

        var isOwner = detail.MyAccess?.IsOwner == true;
        if (isOwner)
        {
            AccessChips.Add("Вы — айтишник объекта: все разделы");
        }

        var sections = detail.MyAccess?.Sections;
        if (sections is not null)
        {
            foreach (var section in ItObjectCatalog.SectionKeys)
            {
                if (sections.TryGetValue(section, out var level))
                {
                    AccessChips.Add($"{ItObjectCatalog.SectionLabelOf(section)}: {ItObjectCatalog.LevelLabelOf(level)}");
                }
            }
        }

        // Разделы с данными: для непривязанного объекта компьютеры и инвентарь не показываем
        // (та же проверка object.linked !== false, что и у веб-детали).
        HasComputersSection = HasSection(sections, "computers") && !IsUnlinked;
        HasInventorySection = HasSection(sections, "inventory") && !IsUnlinked;
        HasMonitoringSection = HasSection(sections, "monitoring");
        HasPasswordsSection = HasSection(sections, "passwords");
        HasPasswordsManage = HasSectionLevel(sections, "passwords", "manage");
        HasNetmapSection = HasSection(sections, "netmap");

        // Все четыре роли — постоянные слоты, как у веб-панели команды.
        var team = detail.Team ?? [];
        foreach (var (key, label) in ItObjectCatalog.TeamRoles)
        {
            var role = team.FirstOrDefault(row => row.RoleKey == key);
            TeamRoles.Add(new ItObjectTeamRoleViewModel(label, role));
        }

        foreach (var grant in detail.Grants ?? [])
        {
            Grants.Add(new ItObjectGrantViewModel(grant));
        }

        SelectComputerCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ItObjectComputerViewModel row)
            {
                SelectedComputer = row;
            }
        });
        SelectMonitoringTargetCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ItObjectMonitoringTargetViewModel row)
            {
                SelectedMonitoringTarget = row;
            }
        });
    }

    private static bool HasSection(IReadOnlyDictionary<string, string>? sections, string key) =>
        sections is not null && sections.TryGetValue(key, out var level) && !string.IsNullOrEmpty(level);

    /// <summary>
    /// Раздел выдан ровно на указанном уровне: «manage» — владелец объекта
    /// (backend разворачивает is_owner во все разделы=manage) или грант manage.
    /// </summary>
    private static bool HasSectionLevel(IReadOnlyDictionary<string, string>? sections, string key, string level) =>
        sections is not null
        && sections.TryGetValue(key, out var actual)
        && string.Equals(actual, level, StringComparison.Ordinal);

    public string ObjectRef { get; }
    public string Title { get; }
    public bool IsHidden { get; }
    public bool IsUnlinked { get; }
    public bool IsOwnerMissing { get; }
    public string OwnerText { get; }
    public string SourceDatabaseText { get; }

    /// <summary>Чипы доступа вызывающего: «Компьютеры: Просмотр» … (my_access.sections).</summary>
    public ObservableCollection<string> AccessChips { get; } = [];

    public bool HasAccessChips => AccessChips.Count > 0;

    public ObservableCollection<ItObjectTeamRoleViewModel> TeamRoles { get; } = [];
    public bool HasTeam => TeamRoles.Any(role => role.IsAssigned);

    public ObservableCollection<ItObjectGrantViewModel> Grants { get; } = [];
    public bool HasGrants => Grants.Count > 0;

    // ---- Раздел «Компьютеры» ----

    public bool HasComputersSection { get; }
    public ObservableCollection<ItObjectComputerViewModel> Computers { get; } = [];
    public string ComputersTitleText => $"Компьютеры объекта · {Computers.Count}";
    public bool IsComputersEmpty => !IsComputersLoading && !HasComputersError && Computers.Count == 0;

    public bool IsComputersLoading
    {
        get => _isComputersLoading;
        set
        {
            if (SetProperty(ref _isComputersLoading, value))
            {
                OnPropertyChanged(nameof(IsComputersEmpty));
            }
        }
    }

    public string? ComputersErrorText
    {
        get => _computersErrorText;
        set
        {
            if (SetProperty(ref _computersErrorText, value))
            {
                OnPropertyChanged(nameof(HasComputersError));
                OnPropertyChanged(nameof(IsComputersEmpty));
            }
        }
    }

    public bool HasComputersError => !string.IsNullOrEmpty(ComputersErrorText);

    public void SetComputers(IReadOnlyList<HubItObjectComputer> items)
    {
        Computers.Clear();
        foreach (var item in items)
        {
            Computers.Add(new ItObjectComputerViewModel(item));
        }

        OnPropertyChanged(nameof(ComputersTitleText));
        OnPropertyChanged(nameof(IsComputersEmpty));
    }

    /// <summary>
    /// Раскрытая строка компьютера: повторное присвоение той же строки сворачивает
    /// её (SelectedComputer=null). Карточку детали грузит родительская VM —
    /// здесь только состояние выбора.
    /// </summary>
    public ItObjectComputerViewModel? SelectedComputer
    {
        get => _selectedComputer;
        set
        {
            var next = ReferenceEquals(_selectedComputer, value) ? null : value;
            if (ReferenceEquals(_selectedComputer, next))
            {
                return;
            }

            _selectedComputer = next;
            foreach (var row in Computers)
            {
                row.IsSelected = ReferenceEquals(row, next);
            }

            // Под новой строкой не остаётся чужая карточка или ошибка.
            ComputerDetail = null;
            ComputerDetailErrorText = null;
            if (next is null)
            {
                IsComputerDetailLoading = false;
            }

            OnPropertyChanged(nameof(SelectedComputer));
            OnPropertyChanged(nameof(HasSelectedComputer));
        }
    }

    /// <summary>Есть раскрытая строка компьютера.</summary>
    public bool HasSelectedComputer => SelectedComputer is not null;

    /// <summary>Клик по строке компьютера — раскрыть/свернуть деталь.</summary>
    public ICommand SelectComputerCommand { get; }

    /// <summary>Карточка выбранного компьютера (mobile-safe detail payload).</summary>
    public ComputerDetailViewModel? ComputerDetail
    {
        get => _computerDetail;
        set
        {
            if (SetProperty(ref _computerDetail, value))
            {
                OnPropertyChanged(nameof(HasComputerDetail));
            }
        }
    }

    public bool HasComputerDetail => ComputerDetail is not null;

    public bool IsComputerDetailLoading
    {
        get => _isComputerDetailLoading;
        set => SetProperty(ref _isComputerDetailLoading, value);
    }

    public string? ComputerDetailErrorText
    {
        get => _computerDetailErrorText;
        set
        {
            if (SetProperty(ref _computerDetailErrorText, value))
            {
                OnPropertyChanged(nameof(HasComputerDetailError));
            }
        }
    }

    public bool HasComputerDetailError => !string.IsNullOrEmpty(ComputerDetailErrorText);

    // ---- Раздел «Инвентарь» ----

    public bool HasInventorySection { get; }
    public ObservableCollection<ItObjectInventoryItemViewModel> InventoryItems { get; } = [];
    public bool IsInventoryEmpty => !IsInventoryLoading && !HasInventoryError && InventoryItems.Count == 0;
    public string InventoryCaptionText { get; private set; } = string.Empty;

    public bool IsInventoryLoading
    {
        get => _isInventoryLoading;
        set
        {
            if (SetProperty(ref _isInventoryLoading, value))
            {
                OnPropertyChanged(nameof(IsInventoryEmpty));
            }
        }
    }

    public string? InventoryErrorText
    {
        get => _inventoryErrorText;
        set
        {
            if (SetProperty(ref _inventoryErrorText, value))
            {
                OnPropertyChanged(nameof(HasInventoryError));
                OnPropertyChanged(nameof(IsInventoryEmpty));
            }
        }
    }

    public bool HasInventoryError => !string.IsNullOrEmpty(InventoryErrorText);

    public void SetInventory(HubItObjectInventoryPage page)
    {
        InventoryItems.Clear();
        foreach (var item in page.Items ?? [])
        {
            InventoryItems.Add(new ItObjectInventoryItemViewModel(item));
        }

        InventoryCaptionText = $"Всего оборудования: {page.Total}"
            + (InventoryItems.Count < page.Total ? $" · показаны первые {InventoryItems.Count}" : string.Empty);
        OnPropertyChanged(nameof(InventoryCaptionText));
        OnPropertyChanged(nameof(IsInventoryEmpty));
    }

    // ---- Раздел «Мониторинг» ----

    public bool HasMonitoringSection { get; }
    public ObservableCollection<ItObjectMonitoringTargetViewModel> MonitoringTargets { get; } = [];
    public string MonitoringTitleText => $"Мониторинг · {MonitoringTargets.Count}";
    public bool IsMonitoringEmpty => !IsMonitoringLoading && !HasMonitoringError && MonitoringTargets.Count == 0;

    public bool IsMonitoringLoading
    {
        get => _isMonitoringLoading;
        set
        {
            if (SetProperty(ref _isMonitoringLoading, value))
            {
                OnPropertyChanged(nameof(IsMonitoringEmpty));
            }
        }
    }

    public string? MonitoringErrorText
    {
        get => _monitoringErrorText;
        set
        {
            if (SetProperty(ref _monitoringErrorText, value))
            {
                OnPropertyChanged(nameof(HasMonitoringError));
                OnPropertyChanged(nameof(IsMonitoringEmpty));
            }
        }
    }

    public bool HasMonitoringError => !string.IsNullOrEmpty(MonitoringErrorText);

    public void SetMonitoring(IReadOnlyList<HubItObjectMonitoringTarget> targets)
    {
        MonitoringTargets.Clear();
        foreach (var target in targets)
        {
            MonitoringTargets.Add(new ItObjectMonitoringTargetViewModel(target));
        }

        OnPropertyChanged(nameof(MonitoringTitleText));
        OnPropertyChanged(nameof(IsMonitoringEmpty));
    }

    /// <summary>
    /// Раскрытая строка цели мониторинга: повторное присвоение той же строки
    /// сворачивает её (SelectedMonitoringTarget=null). Спарклайн задержки
    /// грузит родительская VM — здесь только состояние выбора.
    /// </summary>
    public ItObjectMonitoringTargetViewModel? SelectedMonitoringTarget
    {
        get => _selectedMonitoringTarget;
        set
        {
            var next = ReferenceEquals(_selectedMonitoringTarget, value) ? null : value;
            if (ReferenceEquals(_selectedMonitoringTarget, next))
            {
                return;
            }

            _selectedMonitoringTarget = next;
            foreach (var row in MonitoringTargets)
            {
                row.IsSelected = ReferenceEquals(row, next);
            }

            // Под новой строкой не остаётся чужой график или ошибка.
            MonitoringLatency = null;
            MonitoringLatencyErrorText = null;
            if (next is null)
            {
                IsMonitoringLatencyLoading = false;
            }

            OnPropertyChanged(nameof(SelectedMonitoringTarget));
            OnPropertyChanged(nameof(HasSelectedMonitoringTarget));
        }
    }

    /// <summary>Есть раскрытая строка цели мониторинга.</summary>
    public bool HasSelectedMonitoringTarget => SelectedMonitoringTarget is not null;

    /// <summary>Клик по строке цели мониторинга — раскрыть/свернуть спарклайн задержки.</summary>
    public ICommand SelectMonitoringTargetCommand { get; }

    /// <summary>Спарклайн задержки выбранной цели за 24 ч (latency-history payload).</summary>
    public MonitoringLatencyViewModel? MonitoringLatency
    {
        get => _monitoringLatency;
        set
        {
            if (SetProperty(ref _monitoringLatency, value))
            {
                OnPropertyChanged(nameof(HasMonitoringLatency));
            }
        }
    }

    public bool HasMonitoringLatency => MonitoringLatency is not null;

    public bool IsMonitoringLatencyLoading
    {
        get => _isMonitoringLatencyLoading;
        set => SetProperty(ref _isMonitoringLatencyLoading, value);
    }

    public string? MonitoringLatencyErrorText
    {
        get => _monitoringLatencyErrorText;
        set
        {
            if (SetProperty(ref _monitoringLatencyErrorText, value))
            {
                OnPropertyChanged(nameof(HasMonitoringLatencyError));
            }
        }
    }

    public bool HasMonitoringLatencyError => !string.IsNullOrEmpty(MonitoringLatencyErrorText);

    // ---- Разделы без нативного просмотра в этом срезе ----

    /// <summary>«Пароли»: значения секретов в нативный срез не переносим — только отметка.</summary>
    public bool HasPasswordsSection { get; }

    /// <summary>
    /// У вызывающего manage-доступ к «Паролям» (владелец или грант manage) —
    /// только тогда backend отдаёт журнал аудита секретов.
    /// </summary>
    public bool HasPasswordsManage { get; }

    // ---- Журнал аудита «Пароли» (read-only список под отметкой, только manage) ----

    private bool _passwordAuditLoaded;

    /// <summary>
    /// Журнал аудита секретов объекта (GET …/passwords/audit), новые сверху.
    /// Содержит только факты действий — значения секретов не запрашиваются.
    /// </summary>
    public ObservableCollection<ItObjectPasswordAuditEntryViewModel> PasswordAuditEntries { get; } = [];

    /// <summary>Журнал запрошен и получен (в т.ч. пустой); при ошибке блок скрыт.</summary>
    public bool PasswordAuditLoaded
    {
        get => _passwordAuditLoaded;
        private set
        {
            if (SetProperty(ref _passwordAuditLoaded, value))
            {
                OnPropertyChanged(nameof(PasswordAuditText));
            }
        }
    }

    /// <summary>Есть хотя бы одна запись журнала.</summary>
    public bool HasPasswordAudit => PasswordAuditEntries.Count > 0;

    /// <summary>
    /// Метка блока: «Журнал: кто работал с паролями объекта» или
    /// «Записей аудита нет» (пусто до загрузки).
    /// </summary>
    public string PasswordAuditText => !PasswordAuditLoaded
        ? string.Empty
        : HasPasswordAudit
            ? "Журнал: кто работал с паролями объекта"
            : "Записей аудита нет";

    /// <summary>
    /// Применить ответ аудита: порядок — как отдаёт backend (created_at desc).
    /// </summary>
    public void SetPasswordAudit(IReadOnlyList<HubItObjectPasswordAuditItem> items)
    {
        PasswordAuditEntries.Clear();
        foreach (var item in items)
        {
            PasswordAuditEntries.Add(new ItObjectPasswordAuditEntryViewModel(item));
        }

        PasswordAuditLoaded = true;
        OnPropertyChanged(nameof(HasPasswordAudit));
    }

    /// <summary>«Карта сети»: раздел доступен — превью грузится через AuthImageLoader.</summary>
    public bool HasNetmapSection { get; }

    private ImageSource? _netmapImage;

    /// <summary>Превью карты сети (PNG по Bearer); null — превью нет/не загрузилось.</summary>
    public ImageSource? NetmapImage
    {
        get => _netmapImage;
        set
        {
            if (SetProperty(ref _netmapImage, value))
            {
                OnPropertyChanged(nameof(HasNetmapImage));
            }
        }
    }

    /// <summary>Превью карты сети загружено.</summary>
    public bool HasNetmapImage => NetmapImage is not null;

    // ---- Версии схемы «Карта сети» (read-only список под превью) ----

    private bool _netmapVersionsLoaded;

    /// <summary>
    /// Версии схемы (GET …/netmap/versions), новая сверху. Содержимое версии
    /// (XML drawio) в нативный срез не входит — только метаданные строкой.
    /// </summary>
    public ObservableCollection<ItObjectNetmapVersionViewModel> NetmapVersions { get; } = [];

    /// <summary>Список версий запрошен и получен (в т.ч. пустой); при ошибке блок скрыт.</summary>
    public bool NetmapVersionsLoaded
    {
        get => _netmapVersionsLoaded;
        private set
        {
            if (SetProperty(ref _netmapVersionsLoaded, value))
            {
                OnPropertyChanged(nameof(NetmapVersionsText));
            }
        }
    }

    /// <summary>Есть хотя бы одна сохранённая версия схемы.</summary>
    public bool HasNetmapVersions => NetmapVersions.Count > 0;

    /// <summary>Метка блока: «Версии: N» или «Версий нет» (пусто до загрузки).</summary>
    public string NetmapVersionsText => !NetmapVersionsLoaded
        ? string.Empty
        : HasNetmapVersions
            ? $"Версии: {NetmapVersions.Count}"
            : "Версий нет";

    /// <summary>
    /// Применить ответ версий: показ в порядке version desc — как отдаёт backend
    /// (перестраховываемся сортировкой, вдруг прокси/фейк поменял порядок).
    /// </summary>
    public void SetNetmapVersions(IReadOnlyList<HubItObjectNetmapVersion> items)
    {
        NetmapVersions.Clear();
        foreach (var item in items.OrderByDescending(item => item.Version))
        {
            NetmapVersions.Add(new ItObjectNetmapVersionViewModel(item));
        }

        NetmapVersionsLoaded = true;
        OnPropertyChanged(nameof(HasNetmapVersions));
    }
}

/// <summary>
/// Страница «🖥 ИТ-объекты»: список объектов реестра с поиском и фильтрами,
/// выбор → карточка с реквизитами, доступами, командой и составом разделов.
/// Серверной пагинации у GET /it-objects нет — «Показать ещё» порциями
/// раскрывает уже полученную выдачу (контракт отдаёт весь список за один ответ).
/// </summary>
public sealed class ItObjectsViewModel : ObservableObject
{
    /// <summary>Сколько строк выдачи видно сразу и за один клик «Показать ещё».</summary>
    private const int PageSize = 50;

    /// <summary>Первый срез состава «Инвентарь» в карточке (page=1).</summary>
    private const int InventoryPageSize = 20;

    /// <summary>Окно спарклайна задержки цели мониторинга (hours=24).</summary>
    private const int MonitoringLatencyHours = 24;

    /// <summary>Сколько записей аудита паролей показываем в карточке (limit=50).</summary>
    private const int PasswordAuditLimit = 50;

    /// <summary>Debounce серверного поиска — как у билетов/чата.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _computerDetailLoadCancellation;
    private CancellationTokenSource? _monitoringLatencyLoadCancellation;
    private CancellationTokenSource? _searchCancellation;

    /// <summary>Заглушка событий фильтров на время Reset (без лишних перезагрузок).</summary>
    private bool _suppressFilterEvents;

    /// <summary>Полная выдача последнего списка (серверной пагинации нет).</summary>
    private IReadOnlyList<HubItObject> _allItems = [];

    private ItObjectListItemViewModel? _selectedItem;
    private ItObjectDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private bool _onlyMine;
    private bool _showHidden;
    private bool _canManage;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _visibleCount;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    private readonly AuthImageLoader _imageLoader;

    public ItObjectsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(MoreButtonText));
        };
    }

    // ---- Список и фильтры ----

    public ObservableCollection<ItObjectListItemViewModel> Items { get; } = [];

    public ItObjectListItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.ObjectRef);
            }
        }
    }

    public ItObjectDetailViewModel? Detail
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

    /// <summary>Заглушка «выберите объект» — ни карточки, ни загрузки деталей.</summary>
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

    /// <summary>Поиск по имени (параметр q): изменение строки запускает debounce-перезагрузку.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ScheduleSearch();
            }
        }
    }

    /// <summary>Фильтр mine= — только объекты, где я айтишник (веб-переключатель «Только мои»).</summary>
    public bool OnlyMine
    {
        get => _onlyMine;
        set
        {
            if (SetProperty(ref _onlyMine, value))
            {
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Фильтр hidden= — скрытые («удалённые») объекты; доступен при can_manage.</summary>
    public bool ShowHidden
    {
        get => _showHidden;
        set
        {
            if (SetProperty(ref _showHidden, value))
            {
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>can_manage из ответа списка: без права it_objects.manage фильтры прячем, как в вебе.</summary>
    public bool CanManage
    {
        get => _canManage;
        private set
        {
            if (SetProperty(ref _canManage, value))
            {
                OnPropertyChanged(nameof(ShowManageFilters));
            }
        }
    }

    public bool ShowManageFilters => CanManage;

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set
        {
            if (SetProperty(ref _isLoadingMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
            }
        }
    }

    /// <summary>В локальной выдаче остались скрытые строки (Items.Count меньше total).</summary>
    public bool HasMore
    {
        get => _hasMore;
        private set
        {
            if (SetProperty(ref _hasMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Подпись кнопки «Показать ещё» с остатком выдачи.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : _allItems.Count > 0
            ? $"Показать ещё ({Math.Max(0, _allItems.Count - Items.Count)})"
            : "Показать ещё";

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

    /// <summary>Подпись счётчика: «12 объектов».</summary>
    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Первичная загрузка/обновление списка с текущими фильтрами.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var list = await _api.GetItObjectsAsync(
                SearchText.Trim(), OnlyMine, ShowHidden, cancellationToken);
            ApplyList(list);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ApplyList(HubItObjectList list)
    {
        _allItems = list.Items ?? [];
        Items.Clear();
        _visibleCount = Math.Min(PageSize, _allItems.Count);
        foreach (var item in _allItems.Take(_visibleCount))
        {
            Items.Add(new ItObjectListItemViewModel(item));
        }

        HasMore = _visibleCount < _allItems.Count;
        CanManage = list.CanManage;
        TotalText = FormatCount(_allItems.Count, "объект", "объекта", "объектов");
    }

    /// <summary>«Показать ещё»: раскрыть следующую порцию уже полученной выдачи.</summary>
    private Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            var next = Math.Min(_visibleCount + PageSize, _allItems.Count);
            foreach (var item in _allItems.Skip(_visibleCount).Take(next - _visibleCount))
            {
                Items.Add(new ItObjectListItemViewModel(item));
            }

            _visibleCount = next;
            HasMore = _visibleCount < _allItems.Count;
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }

        return Task.CompletedTask;
    }

    /// <summary>Смена фильтра: список и карточка перечитываются с начала выдачи.</summary>
    private void ReloadFromFilterChange()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        _ = ReloadListSafelyAsync();
    }

    private async Task ReloadListSafelyAsync()
    {
        try
        {
            Detail = null;
            SelectedItem = null;
            await LoadAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Debounce 400 мс: серверный поиск по текущим фильтрам.</summary>
    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var query = _searchText.Trim();
        _ = SearchSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            // Запрос уже сменился — результат устарел.
            if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            Detail = null;
            SelectedItem = null;
            await LoadAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    // ---- Карточка ----

    private async Task LoadDetailSafelyAsync(string objectRef)
    {
        _detailLoadCancellation?.Cancel();
        _computerDetailLoadCancellation?.Cancel();
        _monitoringLatencyLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetItObjectAsync(objectRef, cancellation.Token);
            if (_selectedItem?.ObjectRef != objectRef)
            {
                return;
            }

            var card = new ItObjectDetailViewModel(detail);
            card.PropertyChanged += OnDetailCardPropertyChanged;
            Detail = card;

            // Содержимое разделов — отдельными запросами и только при наличии доступа,
            // как в веб-детали: секции грузятся по my_access.sections.
            if (Detail.HasComputersSection)
            {
                await LoadComputersSafelyAsync(objectRef, cancellation.Token);
            }

            if (Detail.HasInventorySection)
            {
                await LoadInventorySafelyAsync(objectRef, cancellation.Token);
            }

            if (Detail.HasMonitoringSection)
            {
                await LoadMonitoringSafelyAsync(objectRef, cancellation.Token);
            }

            // Аудит секретов — только при manage-уровне «Паролей»:
            // backend отвечает 403 на меньший доступ, запрос не шлём.
            if (Detail.HasPasswordsManage)
            {
                await LoadPasswordAuditSafelyAsync(objectRef, cancellation.Token);
            }

            if (Detail.HasNetmapSection)
            {
                await LoadNetmapPreviewSafelyAsync(objectRef, cancellation.Token);
                await LoadNetmapVersionsSafelyAsync(objectRef, cancellation.Token);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    /// <summary>Превью карты сети: PNG по Bearer через AuthImageLoader, тихий фолбэк.</summary>
    private async Task LoadNetmapPreviewSafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        var image = await _imageLoader.LoadAsync(
            "it-objects/" + Uri.EscapeDataString(objectRef) + "/netmap/preview",
            cancellationToken: cancellationToken);
        if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
        {
            detail.NetmapImage = image;
        }
    }

    /// <summary>
    /// Версии схемы карты сети: read-only список под превью. Best-effort, как у
    /// истории в реестре: ошибка → блок просто не показываем, карточка живёт.
    /// </summary>
    private async Task LoadNetmapVersionsSafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        try
        {
            var response = await _api.GetItObjectNetmapVersionsAsync(objectRef, cancellationToken);
            if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
            {
                detail.SetNetmapVersions(response.Items ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Версии недоступны — карточка остаётся без блока версий.
        }
    }

    /// <summary>
    /// Журнал аудита секретов объекта (GET /it-objects/{ref}/passwords/audit?limit=50):
    /// read-only список под отметкой раздела. Best-effort, как версии карты, —
    /// журнал может быть недоступен, тогда блок просто не показываем.
    /// </summary>
    private async Task LoadPasswordAuditSafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        try
        {
            var response = await _api.GetItObjectPasswordsAuditAsync(
                objectRef, PasswordAuditLimit, cancellationToken);
            if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
            {
                detail.SetPasswordAudit(response.Items ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Аудит недоступен — карточка остаётся без блока журнала.
        }
    }

    private async Task LoadComputersSafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        detail.IsComputersLoading = true;
        detail.ComputersErrorText = null;
        try
        {
            var page = await _api.GetItObjectComputersAsync(objectRef, cancellationToken);
            if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
            {
                detail.SetComputers(page.Items ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            detail.ComputersErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            detail.IsComputersLoading = false;
        }
    }

    /// <summary>
    /// Клик по строке «Компьютеры объекта»: detail-VM владеет только выбором,
    /// запрос детали делает родитель (он держит _api).
    /// </summary>
    private void OnDetailCardPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (sender is not ItObjectDetailViewModel detail
            || !ReferenceEquals(Detail, detail))
        {
            return;
        }

        if (e.PropertyName == nameof(ItObjectDetailViewModel.SelectedComputer))
        {
            _computerDetailLoadCancellation?.Cancel();
            if (detail.SelectedComputer is { } selected)
            {
                _ = LoadComputerDetailSafelyAsync(detail, selected);
            }
        }
        else if (e.PropertyName == nameof(ItObjectDetailViewModel.SelectedMonitoringTarget))
        {
            _monitoringLatencyLoadCancellation?.Cancel();
            if (detail.SelectedMonitoringTarget is { } target)
            {
                _ = LoadMonitoringLatencySafelyAsync(detail, target);
            }
        }
    }

    /// <summary>
    /// Деталь компьютера объекта (GET /it-objects/{ref}/computers/{mac}) —
    /// race-guard как у разделов: ответ применяем, только пока выбраны
    /// тот же объект и та же строка.
    /// </summary>
    private async Task LoadComputerDetailSafelyAsync(
        ItObjectDetailViewModel detail,
        ItObjectComputerViewModel computer)
    {
        var cancellation = new CancellationTokenSource();
        _computerDetailLoadCancellation = cancellation;
        detail.IsComputerDetailLoading = true;
        detail.ComputerDetailErrorText = null;
        try
        {
            var payload = await _api.GetItObjectComputerAsync(
                detail.ObjectRef, computer.MacAddress, cancellation.Token);
            if (ReferenceEquals(Detail, detail)
                && ReferenceEquals(detail.SelectedComputer, computer))
            {
                detail.ComputerDetail = new ComputerDetailViewModel(payload);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(Detail, detail)
                && ReferenceEquals(detail.SelectedComputer, computer))
            {
                detail.ComputerDetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_computerDetailLoadCancellation, cancellation))
            {
                detail.IsComputerDetailLoading = false;
            }
        }
    }

    /// <summary>
    /// Спарклайн задержки цели мониторинга (GET /it-objects/{ref}/monitoring/
    /// targets/{id}/latency-history?hours=24) — race-guard как у детали ПК:
    /// ответ применяем, только пока выбраны тот же объект и та же строка.
    /// </summary>
    private async Task LoadMonitoringLatencySafelyAsync(
        ItObjectDetailViewModel detail,
        ItObjectMonitoringTargetViewModel target)
    {
        var cancellation = new CancellationTokenSource();
        _monitoringLatencyLoadCancellation = cancellation;
        detail.IsMonitoringLatencyLoading = true;
        detail.MonitoringLatencyErrorText = null;
        try
        {
            var payload = await _api.GetItObjectMonitoringLatencyHistoryAsync(
                detail.ObjectRef, target.TargetId, MonitoringLatencyHours, cancellation.Token);
            if (ReferenceEquals(Detail, detail)
                && ReferenceEquals(detail.SelectedMonitoringTarget, target))
            {
                detail.MonitoringLatency = new MonitoringLatencyViewModel(payload);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(Detail, detail)
                && ReferenceEquals(detail.SelectedMonitoringTarget, target))
            {
                detail.MonitoringLatencyErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_monitoringLatencyLoadCancellation, cancellation))
            {
                detail.IsMonitoringLatencyLoading = false;
            }
        }
    }

    private async Task LoadInventorySafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        detail.IsInventoryLoading = true;
        detail.InventoryErrorText = null;
        try
        {
            var page = await _api.GetItObjectInventoryAsync(
                objectRef, page: 1, InventoryPageSize, cancellationToken);
            if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
            {
                detail.SetInventory(page);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            detail.InventoryErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            detail.IsInventoryLoading = false;
        }
    }

    private async Task LoadMonitoringSafelyAsync(string objectRef, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null)
        {
            return;
        }

        detail.IsMonitoringLoading = true;
        detail.MonitoringErrorText = null;
        try
        {
            var overview = await _api.GetItObjectMonitoringAsync(objectRef, cancellationToken);
            if (_selectedItem?.ObjectRef == objectRef && ReferenceEquals(Detail, detail))
            {
                detail.SetMonitoring(overview.Targets ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            detail.MonitoringErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            detail.IsMonitoringLoading = false;
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
        _computerDetailLoadCancellation?.Cancel();
        _monitoringLatencyLoadCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _suppressFilterEvents = true;
        _allItems = [];
        _visibleCount = 0;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _onlyMine = false;
        OnPropertyChanged(nameof(OnlyMine));
        _showHidden = false;
        OnPropertyChanged(nameof(ShowHidden));
        CanManage = false;
        _suppressFilterEvents = false;
        HasMore = false;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
    }

    private static string FormatCount(int count, string one, string few, string many)
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
