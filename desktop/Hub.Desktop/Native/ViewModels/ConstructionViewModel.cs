using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Форматтеры и статусная логика «Строительства» — порт constructionShared.js /
/// ConstructionRequestViews.jsx (REQUEST_STAGES, OBJECT_TEAM_ROLES, kindLabel,
/// positionsLabel, formatConstructionDate) в read-срезе без управления объектами.
/// </summary>
internal static class ConstructionFormat
{
    /// <summary>REQUEST_STAGES из веба + received/ready из STAGE_META backend.</summary>
    private static readonly IReadOnlyDictionary<string, string> StageLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["draft"] = "Черновик",
            ["created"] = "Заявка создана",
            ["assigned"] = "Назначен закупщик",
            ["ordered"] = "Заказано поставщику",
            ["reserved"] = "Зарезервировано",
            ["movement_planned"] = "Перемещение запланировано",
            ["received"] = "Поступило на склад",
            ["ready"] = "Готово к выдаче",
            ["fulfilled"] = "Доставлено на склад",
            ["cancelled"] = "Отменено",
            ["needs_review"] = "Требует проверки",
        };

    /// <summary>OBJECT_TEAM_ROLES из constructionShared.js.</summary>
    private static readonly IReadOnlyDictionary<string, string> RoleLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["project_lead"] = "Руководитель проекта",
            ["pto_manager"] = "Менеджер ПТО",
            ["umto_coordinator"] = "Координатор УМТО",
            ["chief_project_engineer"] = "ГИП — главный инженер проекта",
        };

    /// <summary>Подпись стадии: серверный label, иначе маппинг REQUEST_STAGES, иначе ключ.</summary>
    public static string StageLabel(HubConstructionRequestStage? stage)
    {
        if (!string.IsNullOrWhiteSpace(stage?.Label))
        {
            return stage!.Label!.Trim();
        }

        var key = stage?.Key?.Trim() ?? string.Empty;
        return StageLabels.TryGetValue(key, out var label) ? label : (key.Length > 0 ? key : "Без стадии");
    }

    /// <summary>
    /// Тон пилюли стадии — как RequestBadges веба: fulfilled → success,
    /// needs_review → warning, cancelled приглушён, остальные primary (info).
    /// </summary>
    public static string StageTone(HubConstructionRequestStage? stage) => stage?.Key switch
    {
        "fulfilled" or "received" or "ready" => HubStatusTone.Success,
        "needs_review" => HubStatusTone.Warning,
        "cancelled" => HubStatusTone.Muted,
        _ => HubStatusTone.Info,
    };

    /// <summary>kindLabel карточки веба: project/general/unassigned.</summary>
    public static (string Label, string Tone) Kind(string? kind) => kind switch
    {
        "project" => ("Объект", HubStatusTone.Info),
        "general" => ("Общий контур", HubStatusTone.Review),
        "unassigned" => ("Требует разбора", HubStatusTone.Warning),
        _ => ("Карточка", HubStatusTone.Muted),
    };

    /// <summary>roleLabel из constructionShared.js (неизвестный ключ — сам ключ).</summary>
    public static string RoleLabel(string? roleKey)
    {
        var key = roleKey?.Trim() ?? string.Empty;
        return RoleLabels.TryGetValue(key, out var label) ? label : key;
    }

    /// <summary>formatConstructionDate: dd.MM.yyyy, «—» при пустом/битом значении.</summary>
    public static string FormatDate(string? value) =>
        MonitoringFormat.TryParseTime(value, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture)
            : "—";

    /// <summary>formatConstructionDate(withTime): dd.MM.yyyy HH:mm.</summary>
    public static string FormatDateTime(string? value) =>
        MonitoringFormat.TryParseTime(value, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : "—";

    /// <summary>positionsLabel из веба: «N позиция/позиции/позиций».</summary>
    public static string PositionsLabel(int count) =>
        MonitoringFormat.FormatCount(count, "позиция", "позиции", "позиций");

    /// <summary>requestCountLabel из веба: «N заявка/заявки/заявок».</summary>
    public static string RequestsLabel(int count) =>
        MonitoringFormat.FormatCount(count, "заявка", "заявки", "заявок");

    /// <summary>formatQuantity из веба: до 3 знаков без хвостовых нулей.</summary>
    public static string FormatQuantity(double quantity) =>
        quantity.ToString("0.###", CultureInfo.CurrentCulture);
}

/// <summary>
/// Строка списка объектов: имя, тон-пилюля вида, метрики заявок,
/// последняя заявка и подразделения — как карточка веб-грида.
/// </summary>
public sealed class ConstructionObjectItemViewModel
{
    public ConstructionObjectItemViewModel(HubConstructionObjectSummary item)
    {
        ArgumentNullException.ThrowIfNull(item);
        ObjectRef = item.ObjectRef?.Trim() ?? string.Empty;
        // Как в вебе: карточка открывается по managed_object_id || object_ref.
        DetailKey = !string.IsNullOrWhiteSpace(item.ManagedObjectId)
            ? item.ManagedObjectId!.Trim()
            : ObjectRef;
        KindKey = item.Kind?.Trim() ?? string.Empty;
        var (label, tone) = ConstructionFormat.Kind(KindKey);
        KindLabel = label;
        KindTone = tone;
        IsProject = KindKey == "project";
        Title = string.IsNullOrWhiteSpace(item.Name) ? "Объект строительства" : item.Name!.Trim();
        Managed = item.Managed;

        MetricsText = $"{ConstructionFormat.RequestsLabel(item.RequestCount)} за 12 мес"
            + $" · {item.RequestsLast30Days} за 30 дн"
            + $" · проведено {item.PostedCount}";
        LatestRequestText = !string.IsNullOrWhiteSpace(item.LatestRequestNumber)
            ? $"Последняя заявка {item.LatestRequestNumber!.Trim()}"
                + $" · {ConstructionFormat.FormatDate(item.LatestRequestAt)}"
            : string.Empty;
        DepartmentsText = item.DepartmentNames is { Count: > 0 } departments
            ? string.Join(", ", departments)
            : string.Empty;
        DirectionsCount = item.SourceGroups?.Count ?? 0;
        RequestCount = item.RequestCount;
        RequestsLast30Days = item.RequestsLast30Days;
        PostedCount = item.PostedCount;
        WarehousesText = item.WarehouseNames is { Count: > 0 } warehouses
            ? string.Join(", ", warehouses)
            : string.Empty;
    }

    /// <summary>object_ref из ответа (group_ref | managed:{id} | unassigned).</summary>
    public string ObjectRef { get; }

    /// <summary>Идентификатор для detail/requests-запросов: managed_object_id || object_ref.</summary>
    public string DetailKey { get; }
    public string KindKey { get; }
    public string KindLabel { get; }
    public string KindTone { get; }
    public bool IsProject { get; }
    public bool Managed { get; }
    public string Title { get; }
    public string MetricsText { get; }
    public string LatestRequestText { get; }
    public bool HasLatestRequest => LatestRequestText.Length > 0;
    public string DepartmentsText { get; }
    public bool HasDepartments => DepartmentsText.Length > 0;
    public int DirectionsCount { get; }
    public int RequestCount { get; }
    public int RequestsLast30Days { get; }
    public int PostedCount { get; }
    public string WarehousesText { get; }
    public string AutomationName => $"{Title}, {KindLabel}, {MetricsText}";
}

/// <summary>
/// Карточка направления (номенклатурная группа 1С) в детали объекта:
/// имя + счётчики активных/просроченных заявок из direction_stats —
/// как карточки направлений веб-страницы объекта.
/// </summary>
public sealed class ConstructionDirectionItemViewModel
{
    public ConstructionDirectionItemViewModel(
        HubConstructionObjectGroup group,
        HubConstructionDirectionStat? stat)
    {
        ArgumentNullException.ThrowIfNull(group);
        GroupRef = group.GroupRef?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(group.GroupName)
            ? group.GroupName!.Trim()
            : "Направление без названия";
        var active = stat?.Active ?? group.ActiveRequestCount;
        var overdue = stat?.Overdue ?? group.OverdueRequestCount;
        ActiveCount = active ?? 0;
        OverdueCount = overdue ?? 0;
        HasCounts = active is not null || overdue is not null;
        StatsText = HasCounts
            ? $"активных {ActiveCount}"
                + (OverdueCount > 0 ? $" · просрочено {OverdueCount}" : string.Empty)
            : string.Empty;
    }

    public string GroupRef { get; }
    public string Title { get; }
    public int ActiveCount { get; }
    public int OverdueCount { get; }
    public bool HasCounts { get; }
    public string StatsText { get; }
    public bool HasOverdue => OverdueCount > 0;
    public string AutomationName => $"{Title}, {StatsText}";
}

/// <summary>Участник команды объекта: подпись роли + ФИО + должность/подразделение.</summary>
public sealed class ConstructionTeamItemViewModel
{
    public ConstructionTeamItemViewModel(HubConstructionTeamMember member)
    {
        ArgumentNullException.ThrowIfNull(member);
        RoleText = ConstructionFormat.RoleLabel(member.RoleKey);
        FullName = !string.IsNullOrWhiteSpace(member.FullName)
            ? member.FullName!.Trim()
            : "Не назначен";
        var parts = new[]
            {
                member.Position?.Trim(),
                member.Department?.Trim(),
            }
            .Where(part => !string.IsNullOrEmpty(part));
        Subtitle = string.Join(" · ", parts!);
    }

    public string RoleText { get; }
    public string FullName { get; }
    public string Subtitle { get; }
    public bool HasSubtitle => Subtitle.Length > 0;
}

/// <summary>
/// Строка заявки 1С: номер, даты, стадия-пилюля с русской подписью,
/// просрочка/проверка, состояние, склад, позиции и превью номенклатуры —
/// как ConstructionRequestCard веба (без перехода в деталь заявки).
/// </summary>
public sealed class ConstructionRequestItemViewModel
{
    public ConstructionRequestItemViewModel(HubConstructionRequestItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        RequestRef = item.RequestRef?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(item.RequestNumber)
            ? item.RequestNumber!.Trim()
            : "Заявка без входящего номера";
        DatesText = $"{ConstructionFormat.FormatDate(item.Date)}"
            + $" · требуется {ConstructionFormat.FormatDate(item.RequiredDate)}";
        var sectionCodes = item.SectionCodes ?? [];
        if (sectionCodes.Count > 0)
        {
            DatesText += " · раздел " + string.Join(", ", sectionCodes.Take(2))
                + (sectionCodes.Count > 2 ? "…" : string.Empty);
        }

        StageText = ConstructionFormat.StageLabel(item.Stage);
        StageTone = ConstructionFormat.StageTone(item.Stage);
        Overdue = item.Overdue;
        Attention = item.AttentionRequired && item.Stage?.Key != "needs_review";
        StateText = !string.IsNullOrWhiteSpace(item.CurrentState?.Description)
            ? item.CurrentState!.Description!.Trim()
            : !string.IsNullOrWhiteSpace(item.ProgressLabel)
                ? item.ProgressLabel!.Trim()
                : ConstructionFormat.PositionsLabel(item.PositionsTotal);
        var nomenclature = item.NomenclatureItems ?? [];
        NomenclatureText = string.Join(
            "\n",
            nomenclature.Take(3).Select(position =>
                $"{(string.IsNullOrWhiteSpace(position.Name) ? "Номенклатура без наименования" : position.Name!.Trim())}"
                + $" — {ConstructionFormat.FormatQuantity(position.Quantity)} {position.Unit?.Trim()}"));
        if (nomenclature.Count > 3)
        {
            NomenclatureText += $"\nЕщё {nomenclature.Count - 3} наимен.";
        }

        WarehouseText = !string.IsNullOrWhiteSpace(item.WarehouseName)
            ? item.WarehouseName!.Trim()
            : "Склад не указан";
        PositionsText = ConstructionFormat.PositionsLabel(item.PositionsTotal);
        var meta = new[]
            {
                item.DepartmentName?.Trim(),
                item.ResponsibleName?.Trim(),
                item.GroupName?.Trim(),
            }
            .Where(part => !string.IsNullOrEmpty(part));
        MetaText = string.Join(" · ", meta!);
    }

    public string RequestRef { get; }
    public string Title { get; }
    public string DatesText { get; }
    public string StageText { get; }
    public string StageTone { get; }
    public bool Overdue { get; }
    public bool Attention { get; }
    public string StateText { get; }
    public string NomenclatureText { get; }
    public bool HasNomenclature => NomenclatureText.Length > 0;
    public string WarehouseText { get; }
    public string PositionsText { get; }
    public string MetaText { get; }
    public bool HasMeta => MetaText.Length > 0;
    public string AutomationName => $"{Title}, {StageText}";
}

/// <summary>
/// Деталь объекта справа: реквизиты, метрики из карточки списка,
/// направления и команда. Для не-project видов — только уведомление
/// (в вебе карточки «Общий контур»/«Без группы» не открываются).
/// </summary>
public sealed class ConstructionObjectDetailViewModel : ObservableObject
{
    public ConstructionObjectDetailViewModel(
        ConstructionObjectItemViewModel summary,
        HubConstructionObjectDetail? detail,
        IReadOnlyList<HubConstructionDirectionStat> directionStats)
    {
        ArgumentNullException.ThrowIfNull(summary);
        Title = summary.Title;
        KindLabel = summary.KindLabel;
        KindTone = summary.KindTone;
        IsProject = summary.IsProject;

        if (!summary.IsProject)
        {
            // Те же уведомления, что на карточке веб-портфеля.
            NoticeText = summary.KindKey == "general"
                ? "Заявки общего назначения не входят в карточку строительного объекта."
                : "Для этих заявок в 1С не заполнена номенклатурная группа.";
        }

        if (detail is null)
        {
            return;
        }

        if (!string.IsNullOrWhiteSpace(detail.Name))
        {
            Title = detail.Name!.Trim();
        }

        Managed = detail.Managed;
        IsActive = detail.IsActive;
        StatusText = detail.IsActive ? "Активный" : "Архивный";
        StatusTone = detail.IsActive ? HubStatusTone.Success : HubStatusTone.Muted;

        var stats = directionStats
            .Where(stat => !string.IsNullOrWhiteSpace(stat.GroupRef))
            .ToDictionary(stat => stat.GroupRef!.Trim(), StringComparer.OrdinalIgnoreCase);
        Directions = (detail.Groups ?? [])
            .Select(group => new ConstructionDirectionItemViewModel(
                group,
                !string.IsNullOrWhiteSpace(group.GroupRef) && stats.TryGetValue(group.GroupRef!.Trim(), out var stat)
                    ? stat
                    : null))
            .ToList();
        Team = (detail.Team ?? [])
            .Select(member => new ConstructionTeamItemViewModel(member))
            .ToList();

        RequisitesText = string.Join(
            " · ",
            new[]
                {
                    detail.CreatedAt is not null ? $"Создан {ConstructionFormat.FormatDate(detail.CreatedAt)}" : null,
                    detail.UpdatedAt is not null ? $"Обновлён {ConstructionFormat.FormatDate(detail.UpdatedAt)}" : null,
                }
                .Where(part => part is not null)!);
    }

    public string Title { get; }
    public string KindLabel { get; }
    public string KindTone { get; }
    public bool IsProject { get; }
    public bool Managed { get; }
    public bool IsActive { get; }
    public string StatusText { get; } = string.Empty;
    public string StatusTone { get; } = HubStatusTone.Muted;
    public string RequisitesText { get; } = string.Empty;
    public bool HasRequisites => RequisitesText.Length > 0;

    /// <summary>Уведомление для карточек «Общий контур»/«Без группы» — без detail-запроса.</summary>
    public string? NoticeText { get; }
    public bool HasNotice => !string.IsNullOrEmpty(NoticeText);

    public IReadOnlyList<ConstructionDirectionItemViewModel> Directions { get; } = [];
    public bool HasDirections => Directions.Count > 0;
    public IReadOnlyList<ConstructionTeamItemViewModel> Team { get; } = [];
    public bool HasTeam => Team.Count > 0;
}

/// <summary>
/// Раздел «Строительство»: master-detail по веб-референсу —
/// слева портфель объектов (поиск/вид на сервере), справа карточка:
/// реквизиты, направления со счётчиками, команда, заявки со стадиями.
/// Read-срез: управление объектами (construction.write) не реализуется.
/// </summary>
public sealed class ConstructionViewModel : ObservableObject
{
    private const int ObjectsPageSize = 24;
    private const int RequestsPageSize = 50;
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _detailLoadCancellation;
    private string? _objectsCursor;
    private string? _requestsCursor;

    private ConstructionObjectItemViewModel? _selectedObject;
    private ConstructionObjectDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private bool _isRequestsLoading;
    private string? _requestsErrorText;
    private string _requestsSummaryText = string.Empty;
    private bool _hasMoreRequests;
    private string _searchText = string.Empty;
    private string _kindFilter = "all";
    private bool _isLoading;
    private bool _isLoadingMore;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public ConstructionViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct, refresh: true),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SelectKindCommand = new NativeRelayCommand(parameter =>
        {
            var kind = parameter as string ?? "all";
            if (!string.Equals(_kindFilter, kind, StringComparison.Ordinal))
            {
                KindFilter = kind;
            }
        });
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct, append: true),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoadingMore);
        RetryDetailCommand = new NativeAsyncCommand(
            (_, _) => SelectedObject is not null ? LoadDetailSafelyAsync(SelectedObject) : Task.CompletedTask,
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        RetryRequestsCommand = new NativeAsyncCommand(
            (_, _) => SelectedObject is not null ? LoadRequestsSafelyAsync(SelectedObject, append: false) : Task.CompletedTask,
            ex => RequestsErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreRequestsCommand = new NativeAsyncCommand(
            (_, _) => SelectedObject is not null ? LoadRequestsSafelyAsync(SelectedObject, append: true) : Task.CompletedTask,
            ex => RequestsErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMoreRequests && !IsRequestsLoading);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(HasContent));
        };
    }

    /// <summary>Тестовый шов дебаунса поиска (как у ItObjects/Database).</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    // ---- Список объектов ----

    public ObservableCollection<ConstructionObjectItemViewModel> Items { get; } = [];

    public ConstructionObjectItemViewModel? SelectedObject
    {
        get => _selectedObject;
        set
        {
            if (SetProperty(ref _selectedObject, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value);
            }
        }
    }

    /// <summary>Серверный поиск (q) по имени/заявкам — дебаунс как в вебе.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                _ = SearchSafelyAsync();
            }
        }
    }

    /// <summary>Вид карточек: all|project|general|unassigned (kind у backend).</summary>
    public string KindFilter
    {
        get => _kindFilter;
        private set
        {
            if (SetProperty(ref _kindFilter, value))
            {
                OnPropertyChanged(nameof(IsKindAll));
                OnPropertyChanged(nameof(IsKindProject));
                OnPropertyChanged(nameof(IsKindGeneral));
                OnPropertyChanged(nameof(IsKindUnassigned));
                _ = LoadSafelyAsync();
            }
        }
    }

    public bool IsKindAll => KindFilter == "all";
    public bool IsKindProject => KindFilter == "project";
    public bool IsKindGeneral => KindFilter == "general";
    public bool IsKindUnassigned => KindFilter == "unassigned";

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

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set => SetProperty(ref _isLoadingMore, value);
    }

    /// <summary>Есть следующая страница объектов (cursor-пагинация backend).</summary>
    public bool HasMore
    {
        get => _hasMore;
        private set => SetProperty(ref _hasMore, value);
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

    /// <summary>Есть карточки в выдаче — итоги/счётчики имеет смысл показывать.</summary>
    public bool HasContent => Items.Count > 0;

    /// <summary>Подпись итогов портфеля: «N объектов · M заявок».</summary>
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

    // ---- Деталь объекта ----

    public ConstructionObjectDetailViewModel? Detail
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

    public bool ShowDetailPlaceholder => Detail is null && !IsDetailLoading && !HasDetailError;

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
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetailError => !string.IsNullOrEmpty(DetailErrorText);

    // ---- Заявки выбранного объекта ----

    public ObservableCollection<ConstructionRequestItemViewModel> Requests { get; } = [];

    public bool IsRequestsLoading
    {
        get => _isRequestsLoading;
        private set
        {
            if (SetProperty(ref _isRequestsLoading, value))
            {
                OnPropertyChanged(nameof(ShowRequestsEmpty));
            }
        }
    }

    public string? RequestsErrorText
    {
        get => _requestsErrorText;
        private set
        {
            if (SetProperty(ref _requestsErrorText, value))
            {
                OnPropertyChanged(nameof(HasRequestsError));
                OnPropertyChanged(nameof(ShowRequestsEmpty));
            }
        }
    }

    public bool HasRequestsError => !string.IsNullOrEmpty(RequestsErrorText);

    /// <summary>«Показать ещё» — next_cursor страницы заявок.</summary>
    public bool HasMoreRequests
    {
        get => _hasMoreRequests;
        private set => SetProperty(ref _hasMoreRequests, value);
    }

    /// <summary>Сводка по заявкам: «всего N · активных A · просрочено O».</summary>
    public string RequestsSummaryText
    {
        get => _requestsSummaryText;
        private set => SetProperty(ref _requestsSummaryText, value);
    }

    public bool HasRequestsSummary => RequestsSummaryText.Length > 0;

    /// <summary>Пустой список заявок — только для project-карточки после загрузки.</summary>
    public bool ShowRequestsEmpty =>
        Detail?.IsProject == true
        && !IsRequestsLoading
        && !HasRequestsError
        && Requests.Count == 0;

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand SelectKindCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand RetryDetailCommand { get; }
    public ICommand RetryRequestsCommand { get; }
    public ICommand LoadMoreRequestsCommand { get; }

    /// <summary>Первичная загрузка/обновление портфеля объектов.</summary>
    public async Task LoadAsync(
        CancellationToken cancellationToken = default,
        bool refresh = false,
        bool append = false)
    {
        var cursor = append ? _objectsCursor : null;
        if (append)
        {
            IsLoadingMore = true;
        }
        else
        {
            IsLoading = true;
        }

        try
        {
            var response = await _api.GetConstructionObjectsAsync(
                new HubConstructionObjectsQuery
                {
                    Search = _searchText.Trim(),
                    Kind = _kindFilter,
                    Limit = ObjectsPageSize,
                    Cursor = cursor,
                    Refresh = refresh,
                },
                cancellationToken);
            var pageItems = (response.Items ?? [])
                .Select(item => new ConstructionObjectItemViewModel(item))
                .ToList();
            // snapshot_changed — снапшот пересобран: старые элементы заменяем страницей.
            var merge = append && !response.SnapshotChanged;
            if (!merge)
            {
                Items.Clear();
            }

            foreach (var item in pageItems)
            {
                if (merge && Items.Any(existing => existing.ObjectRef == item.ObjectRef))
                {
                    continue;
                }

                Items.Add(item);
            }

            _objectsCursor = response.NextCursor;
            HasMore = response.HasMore && !string.IsNullOrEmpty(response.NextCursor);
            var summary = response.Summary;
            TotalText = summary is not null
                ? $"{MonitoringFormat.FormatCount(summary.ProjectCount, "объект", "объекта", "объектов")}"
                    + $" · {ConstructionFormat.RequestsLabel(summary.RequestCount)}"
                : MonitoringFormat.FormatCount(Items.Count, "карточка", "карточки", "карточек");
            LastUpdatedText = MonitoringFormat.TryParseTime(response.AsOf, out var asOf)
                ? $"Обновлено {asOf.LocalDateTime:dd.MM.yyyy HH:mm}"
                : $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;

            // Выбранный объект пропал из выдачи — закрываем карточку;
            // иначе подменяем выбор свежим экземпляром (ListBox сверяет ссылку).
            if (_selectedObject is not null)
            {
                var replacement = Items.FirstOrDefault(
                    item => item.ObjectRef == _selectedObject.ObjectRef);
                if (replacement is null)
                {
                    _detailLoadCancellation?.Cancel();
                    Detail = null;
                    ClearRequests();
                    SelectedObject = null;
                }
                else
                {
                    if (!ReferenceEquals(_selectedObject, replacement))
                    {
                        _selectedObject = replacement;
                        OnPropertyChanged(nameof(SelectedObject));
                    }

                    await LoadDetailSafelyAsync(replacement, cancellationToken);
                }
            }
        }
        finally
        {
            IsLoading = false;
            IsLoadingMore = false;
        }
    }

    /// <summary>Выбор объекта → карточка + заявки (для не-project — уведомление без запросов).</summary>
    private async Task LoadDetailSafelyAsync(
        ConstructionObjectItemViewModel selected,
        CancellationToken cancellationToken = default)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _detailLoadCancellation = cancellation;
        var token = cancellation.Token;
        IsDetailLoading = true;
        DetailErrorText = null;
        Detail = null;
        ClearRequests();
        try
        {
            // Уведомления веб-портфеля: общие/без группы заявки в карточку объекта не входят.
            if (!selected.IsProject)
            {
                if (ReferenceEquals(_selectedObject, selected))
                {
                    Detail = new ConstructionObjectDetailViewModel(selected, detail: null, []);
                }

                return;
            }

            var detail = await _api.GetConstructionObjectDetailAsync(selected.DetailKey, token);
            // Заявки грузим отдельно: их ошибка не роняет карточку — секция
            // покажет свой текст и кнопку «Повторить», как список веб-страницы.
            HubConstructionObjectRequestsResponse? requestsPage = null;
            try
            {
                IsRequestsLoading = true;
                requestsPage = await _api.GetConstructionObjectRequestsAsync(
                    selected.DetailKey,
                    new HubConstructionRequestsQuery
                    {
                        View = "all",
                        Limit = RequestsPageSize,
                    },
                    token);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                if (ReferenceEquals(_selectedObject, selected))
                {
                    RequestsErrorText = TasksViewModel.DescribeError(ex);
                }
            }
            finally
            {
                if (ReferenceEquals(_detailLoadCancellation, cancellation))
                {
                    IsRequestsLoading = false;
                }
            }

            if (ReferenceEquals(_selectedObject, selected))
            {
                Detail = new ConstructionObjectDetailViewModel(
                    selected,
                    detail,
                    requestsPage?.DirectionStats ?? []);
                if (requestsPage is not null)
                {
                    ApplyRequests(requestsPage, append: false);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            // Ошибка устаревшей загрузки не должна перекрывать карточку нового выбора.
            if (ReferenceEquals(_selectedObject, selected))
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

    /// <summary>Догрузка страниц заявок выбранного объекта (view=all, cursor).</summary>
    private async Task LoadRequestsSafelyAsync(
        ConstructionObjectItemViewModel selected,
        bool append)
    {
        var cursor = append ? _requestsCursor : null;
        IsRequestsLoading = true;
        try
        {
            var response = await _api.GetConstructionObjectRequestsAsync(
                selected.DetailKey,
                new HubConstructionRequestsQuery
                {
                    View = "all",
                    Limit = RequestsPageSize,
                    Cursor = cursor,
                },
                CancellationToken.None);
            if (ReferenceEquals(_selectedObject, selected))
            {
                ApplyRequests(response, append && !response.SnapshotChanged);
            }
        }
        finally
        {
            IsRequestsLoading = false;
        }
    }

    private void ApplyRequests(HubConstructionObjectRequestsResponse response, bool append)
    {
        if (!append)
        {
            Requests.Clear();
        }

        foreach (var item in response.Items ?? [])
        {
            var row = new ConstructionRequestItemViewModel(item);
            if (append && Requests.Any(existing => existing.RequestRef == row.RequestRef))
            {
                continue;
            }

            Requests.Add(row);
        }

        _requestsCursor = response.NextCursor;
        HasMoreRequests = response.HasMore && !string.IsNullOrEmpty(response.NextCursor);
        var totals = response.Summary;
        RequestsSummaryText = totals is not null
            ? $"{ConstructionFormat.RequestsLabel(totals.Total)}"
                + $" · активных {totals.Active}"
                + (totals.Overdue > 0 ? $" · просрочено {totals.Overdue}" : string.Empty)
            : string.Empty;
        RequestsErrorText = null;
    }

    private void ClearRequests()
    {
        Requests.Clear();
        _requestsCursor = null;
        HasMoreRequests = false;
        RequestsSummaryText = string.Empty;
        RequestsErrorText = null;
    }

    /// <summary>Серверный поиск с дебаунсом — как q-фильтр веб-страницы портфеля.</summary>
    private async Task SearchSafelyAsync()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        try
        {
            await DelayAsync(SearchDebounce, cancellation.Token);
            if (!cancellation.IsCancellationRequested)
            {
                await LoadAsync(cancellation.Token);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task LoadSafelyAsync()
    {
        try
        {
            await LoadAsync(CancellationToken.None);
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
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
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _detailLoadCancellation?.Cancel();
        _detailLoadCancellation = null;
        Items.Clear();
        Detail = null;
        SelectedObject = null;
        ClearRequests();
        BannerErrorText = null;
        DetailErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _kindFilter = "all";
        OnPropertyChanged(nameof(KindFilter));
        OnPropertyChanged(nameof(IsKindAll));
        OnPropertyChanged(nameof(IsKindProject));
        OnPropertyChanged(nameof(IsKindGeneral));
        OnPropertyChanged(nameof(IsKindUnassigned));
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        _objectsCursor = null;
        HasMore = false;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
        IsRequestsLoading = false;
    }
}
