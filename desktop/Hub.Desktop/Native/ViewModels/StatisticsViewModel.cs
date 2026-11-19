using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Числовая карточка раздела (MetricCard веба: подпись + значение, тон опционален).</summary>
public sealed class StatisticsMetricItem
{
    public StatisticsMetricItem(string title, string valueText, string tone = "neutral")
    {
        Title = title;
        ValueText = valueText;
        Tone = tone;
    }

    public string Title { get; }
    public string ValueText { get; }

    /// <summary>neutral|success|warning|error — тон значения (как color у MetricCard веба).</summary>
    public string Tone { get; }
}

/// <summary>
/// Блок распределения «название: число» (DistributionChips веба): заголовок
/// и список чипов в уже отсортированном сервером порядке.
/// </summary>
public sealed class StatisticsSliceViewModel
{
    public StatisticsSliceViewModel(string title, IReadOnlyList<string> chips)
    {
        Title = title;
        Chips = chips;
    }

    public string Title { get; }
    public IReadOnlyList<string> Chips { get; }
    public bool HasChips => Chips.Count > 0;
}

/// <summary>Строка филиала раздела «Чистка ПК» (branches[] из /json/works/cleaning/statistics).</summary>
public sealed class StatisticsPcBranchRow
{
    public StatisticsPcBranchRow(HubPcCleaningBranchStat row)
    {
        ArgumentNullException.ThrowIfNull(row);
        Branch = MfuFormat.OrDash(row.Branch);
        TotalPcText = row.TotalPc.ToString(CultureInfo.InvariantCulture);
        CleanedPcText = row.CleanedPc.ToString(CultureInfo.InvariantCulture);
        RemainingPcText = row.RemainingPc.ToString(CultureInfo.InvariantCulture);
        // Чип «Осталось» веба: красный, если непочищенные ещё есть.
        RemainingTone = row.RemainingPc > 0 ? "error" : "success";
        CleaningsPeriodText = row.CleaningsPeriod.ToString(CultureInfo.InvariantCulture);
        CoverageText = row.CoveragePercent.ToString("0.#", CultureInfo.CurrentCulture) + "%";
        // getCoverageColor веба: >=80 success, >=50 warning, иначе error.
        CoverageTone = row.CoveragePercent >= 80 ? "success" : row.CoveragePercent >= 50 ? "warning" : "error";
        AutomationName = $"Филиал {Branch}: покрытие {CoverageText}";
    }

    public string Branch { get; }
    public string TotalPcText { get; }
    public string CleanedPcText { get; }
    public string RemainingPcText { get; }
    public string RemainingTone { get; }
    public string CleaningsPeriodText { get; }
    public string CoverageText { get; }
    public string CoverageTone { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Строка «филиал + локация» (by_location_period) разделов МФУ/батареи/комплектующие:
/// число операций, топ-3 позиций и дата последней записи.
/// </summary>
public sealed class StatisticsLocationRow
{
    public StatisticsLocationRow(
        string? branch,
        string? location,
        int operations,
        IReadOnlyList<(string? Name, int Count)>? topItems,
        string? lastTimestamp)
    {
        Branch = MfuFormat.OrDash(branch);
        Location = MfuFormat.OrDash(location);
        OperationsText = operations.ToString(CultureInfo.InvariantCulture);
        var top = (topItems ?? [])
            .Take(3)
            .Select(item => $"{MfuFormat.OrDash(item.Name)} ({item.Count})")
            .ToList();
        TopItemsText = top.Count > 0 ? string.Join("; ", top) : "-";
        LastReplacementText = MfuFormat.FormatDateTime(lastTimestamp);
        AutomationName = $"{Branch}, {Location}: операций {OperationsText}";
    }

    public string Branch { get; }
    public string Location { get; }
    public string OperationsText { get; }
    public string TopItemsText { get; }
    public string LastReplacementText { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Строка последней записи журнала (recent_replacements): дата, филиал, локация,
/// модель, вид работ (тип/производитель/компонент — зависит от раздела) и позиция.
/// </summary>
public sealed class StatisticsRecentRow
{
    public StatisticsRecentRow(
        string? timestamp,
        string? branch,
        string? location,
        string? model,
        string? kind,
        string? replacementItem)
    {
        DateText = MfuFormat.FormatDateTime(timestamp);
        Branch = MfuFormat.OrDash(branch);
        Location = MfuFormat.OrDash(location);
        ModelText = MfuFormat.OrDash(model);
        KindText = MfuFormat.OrDash(kind);
        ItemText = MfuFormat.OrDash(replacementItem);
        AutomationName = $"{DateText}: {ItemText}";
    }

    public string DateText { get; }
    public string Branch { get; }
    public string Location { get; }
    public string ModelText { get; }
    public string KindText { get; }
    public string ItemText { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Страница «📊 Статистика» — порт Statistics.jsx: разделы «Чистка ПК»,
/// «МФУ», «Батареи», «Комплектующие ПК»; период 30/90/180/365 дней, фильтр
/// по филиалу/локации, числовые карточки, распределения и таблицы.
/// Только чтение: экспорт Excel и список непочищенных ПК в срез не входят.
/// </summary>
public sealed class StatisticsViewModel : ObservableObject
{
    /// <summary>Раздел «МФУ» виден только с правом mfu.read (canViewMfu веба).</summary>
    private const string MfuReadPermission = "mfu.read";

    internal static readonly MfuFilterItem Period30 = new("30", "30 дней");
    internal static readonly MfuFilterItem Period90 = new("90", "90 дней");
    internal static readonly MfuFilterItem Period180 = new("180", "180 дней");
    internal static readonly MfuFilterItem Period365 = new("365", "365 дней");

    /// <summary>Число чипов в блоке распределения — limit веба (8, у моделей 15).</summary>
    private const int SliceChipLimit = 8;
    private const int ModelSliceChipLimit = 15;

    private readonly IHubApiClient _api;

    /// <summary>Ид применять данные может только последняя загрузка (loadRequestRef веба).</summary>
    private int _loadRequest;

    /// <summary>Полные списки строк текущего раздела (поиск режет их локально).</summary>
    private List<StatisticsPcBranchRow> _allPcBranches = [];
    private List<StatisticsLocationRow> _allLocations = [];

    /// <summary>mfu.read из /auth/me — узнаём один раз, как computers.read_all.</summary>
    private bool _permissionsLoaded;
    private bool _canViewMfu;
    private bool _showMfuTab;

    private string _selectedTab = "pc";
    private MfuFilterItem _selectedPeriod = Period90;
    private string _searchText = string.Empty;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _titleText = "Статистика чистки ПК";
    private string _periodRangeText = string.Empty;
    private string _locationsTitleText = "Где меняли";
    private string _locationOpsHeaderText = "Операций";
    private string _recentTitleText = "Что и где поменяно (последние записи)";
    private string _recentModelHeaderText = "Модель";
    private string _recentKindHeaderText = "Тип";

    public StatisticsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectTabCommand = new NativeAsyncCommand(
            (parameter, ct) =>
            {
                if (parameter is string tab)
                {
                    SelectedTab = tab;
                }

                return LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectPeriodCommand = new NativeAsyncCommand(
            (parameter, ct) =>
            {
                if (parameter is MfuFilterItem option)
                {
                    SelectedPeriod = option;
                }

                return LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        PcBranches.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasPcBranches));
            OnPropertyChanged(nameof(IsEmpty));
        };
        Locations.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasLocations));
            OnPropertyChanged(nameof(IsEmpty));
        };
        RecentItems.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasRecentItems));
            OnPropertyChanged(nameof(IsEmpty));
        };
    }

    // ---- Разделы и период ----

    /// <summary>pc|mfu|battery|pc_components — вкладки веб-страницы.</summary>
    public string SelectedTab
    {
        get => _selectedTab;
        set
        {
            var next = NormalizeTab(value);
            if (SetProperty(ref _selectedTab, next))
            {
                OnPropertyChanged(nameof(IsPcTab));
                OnPropertyChanged(nameof(IsMfuTab));
                OnPropertyChanged(nameof(IsBatteryTab));
                OnPropertyChanged(nameof(IsPcComponentsTab));
                ApplyTabLayout();
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectTabCommand.
    public bool IsPcTab
    {
        get => SelectedTab == "pc";
        set => ApplyTabFromUi("pc", value);
    }

    public bool IsMfuTab
    {
        get => SelectedTab == "mfu";
        set => ApplyTabFromUi("mfu", value);
    }

    public bool IsBatteryTab
    {
        get => SelectedTab == "battery";
        set => ApplyTabFromUi("battery", value);
    }

    public bool IsPcComponentsTab
    {
        get => SelectedTab == "pc_components";
        set => ApplyTabFromUi("pc_components", value);
    }

    private void ApplyTabFromUi(string tab, bool isChecked)
    {
        if (isChecked && SelectedTab != tab)
        {
            SelectTabCommand.Execute(tab);
        }
    }

    /// <summary>Вкладка «МФУ» — только с mfu.read (в вебе её просто нет).</summary>
    public bool ShowMfuTab
    {
        get => _showMfuTab;
        private set => SetProperty(ref _showMfuTab, value);
    }

    /// <summary>Опции периода — PERIOD_OPTIONS веба (30/90/180/365 дней).</summary>
    public IReadOnlyList<MfuFilterItem> PeriodOptions { get; } = [Period30, Period90, Period180, Period365];

    public MfuFilterItem SelectedPeriod
    {
        get => _selectedPeriod;
        set
        {
            if (SetProperty(ref _selectedPeriod, value ?? Period90))
            {
                OnPropertyChanged(nameof(SelectedPeriodText));
            }
        }
    }

    public string SelectedPeriodText => _selectedPeriod.Label;

    public int PeriodDays =>
        int.TryParse(_selectedPeriod.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var days)
            ? days
            : 90;

    /// <summary>Фильтр по филиалу (pc) или филиалу/локации — клиентский, как searchText веба.</summary>
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

    public string FilterPlaceholderText =>
        IsPcTab ? "Фильтр по филиалу…" : "Фильтр по филиалу/локации…";

    // ---- Состояние ----

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

    /// <summary>Ни одной строки в активной таблице (с учётом фильтра) — и не идёт загрузка.</summary>
    public bool IsEmpty =>
        !IsLoading && !HasBannerError && (IsPcTab ? !HasPcBranches : !HasLocations);

    // ---- Тексты раздела ----

    /// <summary>«Статистика чистки ПК» и т.п. — titleText веба.</summary>
    public string TitleText
    {
        get => _titleText;
        private set => SetProperty(ref _titleText, value);
    }

    /// <summary>«Период: start_date - end_date» из ответа.</summary>
    public string PeriodRangeText
    {
        get => _periodRangeText;
        private set => SetProperty(ref _periodRangeText, value);
    }

    /// <summary>Заголовок таблицы локаций: «Где меняли…» по разделу.</summary>
    public string LocationsTitleText
    {
        get => _locationsTitleText;
        private set => SetProperty(ref _locationsTitleText, value);
    }

    /// <summary>Колонка операций: «Замен» у батарей, «Операций» у остальных.</summary>
    public string LocationOpsHeaderText
    {
        get => _locationOpsHeaderText;
        private set => SetProperty(ref _locationOpsHeaderText, value);
    }

    /// <summary>Заголовок таблицы последних записей по разделу.</summary>
    public string RecentTitleText
    {
        get => _recentTitleText;
        private set => SetProperty(ref _recentTitleText, value);
    }

    /// <summary>Колонка модели: «Модель» / «Модель ИБП» / «Модель ПК».</summary>
    public string RecentModelHeaderText
    {
        get => _recentModelHeaderText;
        private set => SetProperty(ref _recentModelHeaderText, value);
    }

    /// <summary>Колонка вида работ: «Тип» / «Производитель» / «Компонент».</summary>
    public string RecentKindHeaderText
    {
        get => _recentKindHeaderText;
        private set => SetProperty(ref _recentKindHeaderText, value);
    }

    /// <summary>Таблица филиалов — только раздел «Чистка ПК».</summary>
    public bool ShowPcTable => IsPcTab;

    /// <summary>Таблицы локаций и последних записей — разделы МФУ/батареи/комплектующие.</summary>
    public bool ShowOperationsTables => !IsPcTab;

    // ---- Данные ----

    /// <summary>Числовые карточки активного раздела.</summary>
    public ObservableCollection<StatisticsMetricItem> MetricCards { get; } = [];

    /// <summary>Блоки распределений (DistributionChips веба) активного раздела.</summary>
    public ObservableCollection<StatisticsSliceViewModel> Slices { get; } = [];

    /// <summary>Таблица филиалов раздела «Чистка ПК» (с учётом фильтра).</summary>
    public ObservableCollection<StatisticsPcBranchRow> PcBranches { get; } = [];
    public bool HasPcBranches => PcBranches.Count > 0;

    /// <summary>Таблица «филиал + локация» разделов МФУ/батареи/комплектующие.</summary>
    public ObservableCollection<StatisticsLocationRow> Locations { get; } = [];
    public bool HasLocations => Locations.Count > 0;

    /// <summary>Последние записи журнала раздела (фильтр веба их не режет).</summary>
    public ObservableCollection<StatisticsRecentRow> RecentItems { get; } = [];
    public bool HasRecentItems => RecentItems.Count > 0;

    public ICommand RefreshCommand { get; }
    public ICommand SelectTabCommand { get; }
    public ICommand SelectPeriodCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Первичная загрузка/обновление активного раздела.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var requestId = ++_loadRequest;
        IsLoading = true;
        try
        {
            await EnsurePermissionsAsync(cancellationToken);
            // Без mfu.read раздел МФУ недоступен — веб откатывается на «Чистка ПК».
            if (_selectedTab == "mfu" && !_canViewMfu)
            {
                SelectedTab = "pc";
            }

            var periodDays = PeriodDays;
            switch (_selectedTab)
            {
                case "mfu":
                    var mfu = await _api.GetMfuWorksStatisticsAsync(periodDays, cancellationToken);
                    if (requestId == _loadRequest)
                    {
                        ApplyMfu(mfu);
                        BannerErrorText = null;
                    }

                    break;
                case "battery":
                    var battery = await _api.GetBatteryStatisticsAsync(periodDays, cancellationToken);
                    if (requestId == _loadRequest)
                    {
                        ApplyBattery(battery);
                        BannerErrorText = null;
                    }

                    break;
                case "pc_components":
                    var components = await _api.GetPcComponentsStatisticsAsync(periodDays, cancellationToken);
                    if (requestId == _loadRequest)
                    {
                        ApplyPcComponents(components);
                        BannerErrorText = null;
                    }

                    break;
                default:
                    var cleaning = await _api.GetPcCleaningStatisticsAsync(periodDays, cancellationToken);
                    if (requestId == _loadRequest)
                    {
                        ApplyPcCleaning(cleaning);
                        BannerErrorText = null;
                    }

                    break;
            }
        }
        finally
        {
            if (requestId == _loadRequest)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>
    /// Право mfu.read узнаём один раз из /auth/me (canViewMfu веба).
    /// Ошибка /me не блокирует разделы — просто без вкладки МФУ.
    /// </summary>
    private async Task EnsurePermissionsAsync(CancellationToken cancellationToken)
    {
        if (_permissionsLoaded)
        {
            return;
        }

        _permissionsLoaded = true;
        try
        {
            var user = await _api.GetCurrentUserAsync(cancellationToken);
            _canViewMfu = user.Permissions?.Contains(MfuReadPermission) == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            _canViewMfu = false;
        }

        ShowMfuTab = _canViewMfu;
    }

    // ---- Применение ответов ----

    private void ApplyPcCleaning(HubPcCleaningStatistics stats)
    {
        var totals = stats.Totals;
        SetMetrics(
            new StatisticsMetricItem("ПК всего", Number(totals?.TotalPc)),
            new StatisticsMetricItem("Почищено", Number(totals?.CleanedPc), "success"),
            new StatisticsMetricItem("Осталось", Number(totals?.RemainingPc), "error"),
            new StatisticsMetricItem("Покрытие", Percent(totals?.CoveragePercent)),
            new StatisticsMetricItem("Чисток за период", Number(totals?.CleaningsPeriod)));
        _allPcBranches = (stats.Branches ?? []).Select(row => new StatisticsPcBranchRow(row)).ToList();
        _allLocations = [];
        Locations.Clear();
        RecentItems.Clear();
        Slices.Clear();
        ApplyFilter();
        PeriodRangeText = FormatRange(stats.StartDate, stats.EndDate);
    }

    private void ApplyMfu(HubMfuWorksStatistics stats)
    {
        var totals = stats.Totals;
        SetMetrics(
            new StatisticsMetricItem("Операций за период", Number(totals?.TotalOperations)),
            new StatisticsMetricItem("Филиалов", Number(totals?.UniqueBranches)),
            new StatisticsMetricItem("Локаций", Number(totals?.UniqueLocations)));
        SetSlices(
            new StatisticsSliceViewModel("Сколько чего использовано (типы)", DictChips(stats.ByTypePeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("Сколько чего использовано (позиции)", DictChips(stats.ByItemPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По филиалам", DictChips(stats.ByBranchPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По моделям МФУ", ModelChips(stats.ByModelPeriod, ModelSliceChipLimit)));
        _allLocations = (stats.ByLocationPeriod ?? [])
            .Select(row => new StatisticsLocationRow(
                row.Branch,
                row.Location,
                row.Operations,
                row.TopItems?.Select(item => (item.Name, item.Count)).ToList(),
                row.LastTimestamp))
            .ToList();
        _allPcBranches = [];
        PcBranches.Clear();
        Refill(RecentItems, (stats.RecentReplacements ?? []).Select(row => new StatisticsRecentRow(
            row.Timestamp, row.Branch, row.Location, row.PrinterModel, row.ComponentType, row.ReplacementItem)));
        ApplyFilter();
        PeriodRangeText = FormatRange(stats.StartDate, stats.EndDate);
    }

    private void ApplyBattery(HubBatteryStatistics stats)
    {
        var totals = stats.Totals;
        SetMetrics(
            new StatisticsMetricItem("Замен за период", Number(totals?.TotalOperations)),
            new StatisticsMetricItem("Филиалов", Number(totals?.UniqueBranches)),
            new StatisticsMetricItem("Локаций", Number(totals?.UniqueLocations)));
        // У батарей веб показывает позиции/производителей/филиалы — без среза моделей.
        SetSlices(
            new StatisticsSliceViewModel("Сколько батарей использовано", DictChips(stats.ByItemPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По производителям ИБП", DictChips(stats.ByManufacturerPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По филиалам", DictChips(stats.ByBranchPeriod, SliceChipLimit)));
        _allLocations = (stats.ByLocationPeriod ?? [])
            .Select(row => new StatisticsLocationRow(
                row.Branch,
                row.Location,
                row.Operations,
                row.TopItems?.Select(item => (item.Name, item.Count)).ToList(),
                row.LastTimestamp))
            .ToList();
        _allPcBranches = [];
        PcBranches.Clear();
        Refill(RecentItems, (stats.RecentReplacements ?? []).Select(row => new StatisticsRecentRow(
            row.Timestamp, row.Branch, row.Location, row.ModelName, row.Manufacturer, row.ReplacementItem)));
        ApplyFilter();
        PeriodRangeText = FormatRange(stats.StartDate, stats.EndDate);
    }

    private void ApplyPcComponents(HubPcComponentsStatistics stats)
    {
        var totals = stats.Totals;
        SetMetrics(
            new StatisticsMetricItem("Операций за период", Number(totals?.TotalOperations)),
            new StatisticsMetricItem("Филиалов", Number(totals?.UniqueBranches)),
            new StatisticsMetricItem("Локаций", Number(totals?.UniqueLocations)));
        SetSlices(
            new StatisticsSliceViewModel("По компонентам", DictChips(stats.ByComponentPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По позициям", DictChips(stats.ByItemPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По филиалам", DictChips(stats.ByBranchPeriod, SliceChipLimit)),
            new StatisticsSliceViewModel("По моделям ПК", ModelChips(stats.ByModelPeriod, ModelSliceChipLimit)));
        _allLocations = (stats.ByLocationPeriod ?? [])
            .Select(row => new StatisticsLocationRow(
                row.Branch,
                row.Location,
                row.Operations,
                row.TopItems?.Select(item => (item.Name, item.Count)).ToList(),
                row.LastTimestamp))
            .ToList();
        _allPcBranches = [];
        PcBranches.Clear();
        Refill(RecentItems, (stats.RecentReplacements ?? []).Select(row => new StatisticsRecentRow(
            row.Timestamp, row.Branch, row.Location, row.ModelName, row.ComponentName, row.ReplacementItem)));
        ApplyFilter();
        PeriodRangeText = FormatRange(stats.StartDate, stats.EndDate);
    }

    /// <summary>Заголовки/видимость таблиц активного раздела + сброс данных другого раздела.</summary>
    private void ApplyTabLayout()
    {
        TitleText = _selectedTab switch
        {
            "mfu" => "Статистика обслуживания МФУ",
            "battery" => "Статистика замены батарей ИБП",
            "pc_components" => "Статистика комплектующих ПК",
            _ => "Статистика чистки ПК",
        };
        LocationsTitleText = _selectedTab switch
        {
            "battery" => "Где меняли батареи",
            "pc_components" => "Где меняли комплектующие ПК",
            _ => "Где меняли",
        };
        LocationOpsHeaderText = _selectedTab == "battery" ? "Замен" : "Операций";
        RecentTitleText = _selectedTab switch
        {
            "battery" => "Последние замены батарей",
            "pc_components" => "Последние замены комплектующих ПК",
            _ => "Что и где поменяно (последние записи)",
        };
        RecentModelHeaderText = _selectedTab switch
        {
            "battery" => "Модель ИБП",
            "pc_components" => "Модель ПК",
            _ => "Модель",
        };
        RecentKindHeaderText = _selectedTab switch
        {
            "battery" => "Производитель",
            "pc_components" => "Компонент",
            _ => "Тип",
        };
        OnPropertyChanged(nameof(ShowPcTable));
        OnPropertyChanged(nameof(ShowOperationsTables));
        OnPropertyChanged(nameof(FilterPlaceholderText));

        // Строки другого раздела не должны мелькать, пока грузится новый.
        PeriodRangeText = string.Empty;
        MetricCards.Clear();
        Slices.Clear();
        _allPcBranches = [];
        PcBranches.Clear();
        _allLocations = [];
        Locations.Clear();
        RecentItems.Clear();
    }

    /// <summary>Клиентский фильтр: филиал (pc) и филиал+локация (остальные разделы).</summary>
    private void ApplyFilter()
    {
        var needle = _searchText.Trim();
        Refill(PcBranches, _allPcBranches.Where(row =>
            needle.Length == 0 || row.Branch.Contains(needle, StringComparison.OrdinalIgnoreCase)));
        Refill(Locations, _allLocations.Where(row =>
            needle.Length == 0
            || row.Branch.Contains(needle, StringComparison.OrdinalIgnoreCase)
            || row.Location.Contains(needle, StringComparison.OrdinalIgnoreCase)));
    }

    private void SetMetrics(params StatisticsMetricItem[] metrics)
    {
        MetricCards.Clear();
        foreach (var metric in metrics)
        {
            MetricCards.Add(metric);
        }
    }

    private void SetSlices(params StatisticsSliceViewModel[] slices)
    {
        Slices.Clear();
        foreach (var slice in slices.Where(slice => slice.HasChips))
        {
            Slices.Add(slice);
        }
    }

    /// <summary>Чипы «название: число» — словарь приходит уже отсортированным с сервера.</summary>
    private static List<string> DictChips(IReadOnlyDictionary<string, int>? data, int limit) =>
        (data ?? new Dictionary<string, int>())
        .Take(limit)
        .Select(pair => $"{pair.Key}: {pair.Value.ToString(CultureInfo.InvariantCulture)}")
        .ToList();

    /// <summary>Чипы топа моделей — by_model_period[] ({model, count}), порядок сервера.</summary>
    private static List<string> ModelChips(IEnumerable<HubBatteryModelStat>? models, int limit) =>
        (models ?? []).Take(limit).Select(item => $"{item.Model}: {item.Count}").ToList();

    private static List<string> ModelChips(IEnumerable<HubPcComponentsModelStat>? models, int limit) =>
        (models ?? []).Take(limit).Select(item => $"{item.Model}: {item.Count}").ToList();

    private static List<string> ModelChips(IEnumerable<HubMfuWorksModelStat>? models, int limit) =>
        (models ?? []).Take(limit).Select(item => $"{item.Model}: {item.Count}").ToList();

    private static void Refill<T>(ObservableCollection<T> target, IEnumerable<T> rows)
    {
        target.Clear();
        foreach (var row in rows)
        {
            target.Add(row);
        }
    }

    private static string Number(int? value) =>
        (value ?? 0).ToString(CultureInfo.InvariantCulture);

    private static string Percent(double? value) =>
        (value ?? 0).ToString("0.#", CultureInfo.CurrentCulture) + "%";

    /// <summary>«Период: start - end»; при пустых датах — выбранный период («90 дней»).</summary>
    private string FormatRange(string? startDate, string? endDate)
    {
        var start = MfuFormat.OrDash(startDate);
        var end = MfuFormat.OrDash(endDate);
        return start == "-" && end == "-"
            ? $"Период: {_selectedPeriod.Label}"
            : $"Период: {start} - {end}";
    }

    private static string NormalizeTab(string? tab) => tab switch
    {
        "mfu" => "mfu",
        "battery" => "battery",
        "pc_components" => "pc_components",
        _ => "pc",
    };

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _loadRequest++;
        _permissionsLoaded = false;
        _canViewMfu = false;
        ShowMfuTab = false;
        _allPcBranches = [];
        _allLocations = [];
        MetricCards.Clear();
        Slices.Clear();
        PcBranches.Clear();
        Locations.Clear();
        RecentItems.Clear();
        BannerErrorText = null;
        PeriodRangeText = string.Empty;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedPeriod = Period90;
        OnPropertyChanged(nameof(SelectedPeriod));
        OnPropertyChanged(nameof(SelectedPeriodText));
        SelectedTab = "pc";
        IsLoading = false;
    }
}
