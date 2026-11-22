using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Раздел «Заявки на МПЗ» (warehouse_1c.it_requests.read): snapshot-список
/// заявок ИТ с фильтрами (вид/стадия/склад/просрочка/поиск) и карточкой
/// заявки — маршрут, позиции, документы. Повторяет web /it/requests.
/// </summary>
public sealed class ItRequestsViewModel : ObservableObject
{
    private const int PageSize = 25;
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _detailCancellation;
    private string? _cursor;
    private string? _loadedRequestRef;

    private string _searchText = string.Empty;
    private string _viewFilter = "active";
    private string? _stageFilter;
    private WarehouseSuggestOption? _warehouseFilter;
    private bool _overdueOnly;
    private bool _isLoading;
    private bool _isLoadingMore;
    private bool _hasMore;
    private bool _searched;
    private string? _listErrorText;
    private string _resultText = string.Empty;
    private string _asOfText = string.Empty;
    private string? _noticeText;
    private ItRequestItemViewModel? _selectedRequest;
    private ItRequestDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string? _bannerErrorText;

    public ItRequestsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadListAsync(ct, append: false, refresh: true),
            ex => ListErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SelectViewCommand = new NativeRelayCommand(parameter =>
        {
            var view = parameter as string ?? "active";
            if (!string.Equals(_viewFilter, view, StringComparison.Ordinal))
            {
                ViewFilter = view;
            }
        });
        RetryListCommand = new NativeAsyncCommand(
            (_, ct) => LoadListAsync(ct, append: false, refresh: false),
            ex => ListErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadListAsync(ct, append: true, refresh: false),
            ex => ListErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoadingMore);
        RetryDetailCommand = new NativeAsyncCommand(
            (_, _) => SelectedRequest is not null
                ? LoadDetailSafelyAsync(SelectedRequest)
                : Task.CompletedTask,
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasContent));
            OnPropertyChanged(nameof(ShowEmpty));
        };
        StageOptions.Add(new WarehouseSuggestOption("all", "Все стадии"));
        foreach (var stage in ItRequestStages.All)
        {
            StageOptions.Add(new WarehouseSuggestOption(stage, ItRequestStages.Label(stage)));
        }
    }

    /// <summary>Тестовый шов дебаунса поиска.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    // ---- Фильтры ----

    /// <summary>Вид списка: active|history|all (как в вебе).</summary>
    public string ViewFilter
    {
        get => _viewFilter;
        private set
        {
            if (SetProperty(ref _viewFilter, value))
            {
                OnPropertyChanged(nameof(IsViewActive));
                OnPropertyChanged(nameof(IsViewHistory));
                OnPropertyChanged(nameof(IsViewAll));
                _ = LoadListSafelyAsync(append: false);
            }
        }
    }

    public bool IsViewActive => ViewFilter == "active";
    public bool IsViewHistory => ViewFilter == "history";
    public bool IsViewAll => ViewFilter == "all";

    /// <summary>Полнотекстовый поиск (q) — серверный, с дебаунсом.</summary>
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

    /// <summary>Стадия заявки (stage), «all» либо null — все стадии.</summary>
    public string? StageFilter
    {
        get => _stageFilter;
        set
        {
            var normalized = string.IsNullOrWhiteSpace(value) || value == "all" ? null : value;
            if (SetProperty(ref _stageFilter, normalized))
            {
                _ = LoadListSafelyAsync(append: false);
            }
        }
    }

    public ObservableCollection<WarehouseSuggestOption> StageOptions { get; } = [];

    /// <summary>Фильтр склада из фасетов ответа (warehouse_ref) либо null — все.</summary>
    public WarehouseSuggestOption? WarehouseFilter
    {
        get => _warehouseFilter;
        set
        {
            if (SetProperty(ref _warehouseFilter, value))
            {
                _ = LoadListSafelyAsync(append: false);
            }
        }
    }

    public ObservableCollection<WarehouseSuggestOption> WarehouseFacets { get; } = [];

    /// <summary>Только просроченные (overdue=true).</summary>
    public bool OverdueOnly
    {
        get => _overdueOnly;
        set
        {
            if (SetProperty(ref _overdueOnly, value))
            {
                _ = LoadListSafelyAsync(append: false);
            }
        }
    }

    // ---- Список ----

    public ObservableCollection<ItRequestItemViewModel> Items { get; } = [];
    public bool HasContent => Items.Count > 0;
    public bool ShowEmpty => Searched && !IsLoading && Items.Count == 0;

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(ShowEmpty));
            }
        }
    }

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set => SetProperty(ref _isLoadingMore, value);
    }

    public bool HasMore
    {
        get => _hasMore;
        private set
        {
            if (SetProperty(ref _hasMore, value))
            {
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool Searched
    {
        get => _searched;
        private set
        {
            if (SetProperty(ref _searched, value))
            {
                OnPropertyChanged(nameof(ShowEmpty));
            }
        }
    }

    public string? ListErrorText
    {
        get => _listErrorText;
        private set => SetProperty(ref _listErrorText, value);
    }

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set => SetProperty(ref _bannerErrorText, value);
    }

    public string ResultText
    {
        get => _resultText;
        private set => SetProperty(ref _resultText, value);
    }

    /// <summary>Метка снапшота («по состоянию на …», устаревший кэш).</summary>
    public string AsOfText
    {
        get => _asOfText;
        private set => SetProperty(ref _asOfText, value);
    }

    /// <summary>Предупреждение о неполном/устаревшем снапшоте.</summary>
    public string? NoticeText
    {
        get => _noticeText;
        private set => SetProperty(ref _noticeText, value);
    }

    /// <summary>Выбранная заявка — деталь грузится сама (как у Construction).</summary>
    public ItRequestItemViewModel? SelectedRequest
    {
        get => _selectedRequest;
        set
        {
            if (SetProperty(ref _selectedRequest, value))
            {
                if (value is null)
                {
                    CancelDetailLoad();
                    Detail = null;
                    DetailErrorText = null;
                    IsDetailLoading = false;
                }
                else
                {
                    _ = LoadDetailSafelyAsync(value);
                }
            }
        }
    }

    public ItRequestDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(IsDetailOpen));
            }
        }
    }

    /// <summary>Правая панель показывает выбранную заявку (даже во время загрузки).</summary>
    public bool IsDetailOpen => _selectedRequest is not null;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set => SetProperty(ref _isDetailLoading, value);
    }

    public string? DetailErrorText
    {
        get => _detailErrorText;
        private set => SetProperty(ref _detailErrorText, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand SelectViewCommand { get; }
    public ICommand RetryListCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand RetryDetailCommand { get; }

    /// <summary>Первая активация страницы — список активных заявок.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken) =>
        await LoadListAsync(cancellationToken, append: false, refresh: false);

    private async Task SearchSafelyAsync()
    {
        try
        {
            await DelayAsync(SearchDebounce, CancellationToken.None);
            await LoadListSafelyAsync(append: false);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task LoadListSafelyAsync(bool append) =>
        await LoadListAsync(CancellationToken.None, append, refresh: false);

    private async Task LoadListAsync(CancellationToken cancellationToken, bool append, bool refresh)
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = _searchCancellation =
            CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        if (!append)
        {
            IsLoading = true;
            ListErrorText = null;
            BannerErrorText = null;
            _cursor = null;
        }
        else
        {
            IsLoadingMore = true;
        }

        try
        {
            var response = await _api.GetWarehouse1cItRequestsAsync(
                new HubItRequestsQuery
                {
                    View = ViewFilter,
                    Search = SearchText,
                    Stage = StageFilter,
                    WarehouseRef = WarehouseFilter?.Ref,
                    Overdue = OverdueOnly ? true : null,
                    Limit = PageSize,
                    Cursor = append ? _cursor : null,
                    Refresh = refresh,
                },
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            if (!append)
            {
                Items.Clear();
            }

            foreach (var item in response.Items ?? [])
            {
                Items.Add(new ItRequestItemViewModel(item));
            }

            _cursor = response.NextCursor;
            HasMore = response.HasMore && !string.IsNullOrWhiteSpace(response.NextCursor);
            ResultText = response.Total > 0
                ? $"Заявок: {Items.Count} из {response.Total}"
                : $"Заявок: {Items.Count}";
            AsOfText = MonitoringFormat.TryParseTime(response.AsOf, out var asOf)
                ? "По состоянию на " + asOf.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
                : string.Empty;
            NoticeText = BuildNotice(response);
            if (!append)
            {
                // Фасеты складов обновляем с ответа — но не сбрасываем выбранный фильтр.
                var selectedRef = _warehouseFilter?.Ref;
                WarehouseFacets.Clear();
                WarehouseFacets.Add(new WarehouseSuggestOption("", "Все склады"));
                foreach (var facet in response.WarehouseFacets ?? [])
                {
                    var text = facet.OverdueCount > 0
                        ? $"{facet.Name?.Trim()} ({facet.Count}, просрочено {facet.OverdueCount})"
                        : $"{facet.Name?.Trim()} ({facet.Count})";
                    WarehouseFacets.Add(new WarehouseSuggestOption(facet.Ref?.Trim() ?? string.Empty, text));
                }

                if (selectedRef is not null
                    && !WarehouseFacets.Any(option => option.Ref == selectedRef))
                {
                    _warehouseFilter = null;
                    OnPropertyChanged(nameof(WarehouseFilter));
                }
            }

            Searched = true;
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                ListErrorText = TasksViewModel.DescribeError(exception);
                Searched = true;
            }
        }
        finally
        {
            if (ReferenceEquals(_searchCancellation, cancellation))
            {
                IsLoading = false;
                IsLoadingMore = false;
            }
        }
    }

    private async Task LoadDetailSafelyAsync(ItRequestItemViewModel row)
    {
        if (string.Equals(_loadedRequestRef, row.RequestRef, StringComparison.Ordinal)
            && Detail is not null)
        {
            return;
        }

        CancelDetailLoad();
        var cancellation = _detailCancellation = new CancellationTokenSource();
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetWarehouse1cItRequestDetailAsync(
                row.RequestRef,
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            Detail = new ItRequestDetailViewModel(detail);
            _loadedRequestRef = row.RequestRef;
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                Detail = null;
                DetailErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    private static string? BuildNotice(HubItRequestsResponse response)
    {
        var parts = new List<string>();
        if (response.Truncated)
        {
            parts.Add("Снапшот заявок неполный — часть данных может отсутствовать");
        }

        if (response.Stale)
        {
            parts.Add("Показан устаревший снимок: синхронизация с 1С ещё идёт");
        }

        if (response.SnapshotChanged)
        {
            parts.Add("Снапшот обновлён во время листания — список перечитан с начала");
        }

        return parts.Count == 0 ? null : string.Join(". ", parts) + ".";
    }

    private void CancelDetailLoad()
    {
        _detailCancellation?.Cancel();
        _detailCancellation?.Dispose();
        _detailCancellation = null;
        _loadedRequestRef = null;
    }

    /// <summary>Страничная ошибка уровня шелла.</summary>
    public void SetLoadError(string message) => BannerErrorText = message;

    /// <summary>Выход из сессии: отмена загрузок и сброс страницы.</summary>
    public void Reset()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        CancelDetailLoad();
        Items.Clear();
        WarehouseFacets.Clear();
        SelectedRequest = null;
        Detail = null;
        _viewFilter = "active";
        _stageFilter = null;
        _warehouseFilter = null;
        _overdueOnly = false;
        _searchText = string.Empty;
        _cursor = null;
        _searched = false;
        _isLoading = false;
        _isLoadingMore = false;
        _hasMore = false;
        _isDetailLoading = false;
        OnPropertyChanged(nameof(ViewFilter));
        OnPropertyChanged(nameof(IsViewActive));
        OnPropertyChanged(nameof(IsViewHistory));
        OnPropertyChanged(nameof(IsViewAll));
        OnPropertyChanged(nameof(StageFilter));
        OnPropertyChanged(nameof(WarehouseFilter));
        OnPropertyChanged(nameof(OverdueOnly));
        OnPropertyChanged(nameof(SearchText));
        OnPropertyChanged(nameof(Searched));
        OnPropertyChanged(nameof(IsLoading));
        OnPropertyChanged(nameof(IsLoadingMore));
        OnPropertyChanged(nameof(HasMore));
        OnPropertyChanged(nameof(IsDetailLoading));
        ListErrorText = null;
        DetailErrorText = null;
        BannerErrorText = null;
        NoticeText = null;
        ResultText = string.Empty;
        AsOfText = string.Empty;
    }
}

/// <summary>Справочник стадий заявки на МПЗ (ключи backend STAGE_META).</summary>
internal static class ItRequestStages
{
    internal static readonly string[] All =
        ["created", "assigned", "ordered", "movement_planned", "received", "fulfilled", "cancelled", "draft"];

    internal static string Label(string? key) => key switch
    {
        "created" => "Создана",
        "assigned" => "Закупщик назначен",
        "ordered" => "Заказана",
        "movement_planned" => "План перемещения",
        "received" => "Получена на складе",
        "ready" => "Готова к выдаче",
        "fulfilled" => "Выполнена",
        "cancelled" => "Отменена",
        "draft" => "Черновик",
        _ => "Состояние не определено",
    };
}

/// <summary>Карточка заявки в списке (как плитка в вебе: номер, состояние, склад).</summary>
public sealed class ItRequestItemViewModel
{
    public ItRequestItemViewModel(HubItRequestItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        RequestRef = item.RequestRef?.Trim() ?? string.Empty;
        Number = item.RequestNumber?.Trim() ?? item.SystemNumber?.Trim() ?? "Заявка";
        StateLabel = item.CurrentState?.Label?.Trim()
            ?? item.Stage?.Label?.Trim()
            ?? ItRequestStages.Label(item.Stage?.Key);
        StateDescription = item.CurrentState?.Description?.Trim() ?? string.Empty;
        WarehouseName = item.WarehouseName?.Trim() ?? string.Empty;
        DepartmentName = item.DepartmentName?.Trim() ?? string.Empty;
        InitiatorName = item.InitiatorName?.Trim() ?? string.Empty;
        DateText = WarehouseViewModel.FormatDate(item.Date);
        RequiredDateText = WarehouseViewModel.FormatDate(item.RequiredDate);
        ProgressLabel = item.ProgressLabel?.Trim()
            ?? (item.PositionsTotal > 0
                ? MonitoringFormat.FormatCount(item.PositionsTotal, "позиция", "позиции", "позиций")
                : string.Empty);
        NomenclaturePreview = string.Join(", ",
            (item.NomenclatureItems ?? [])
                .Select(entry => entry.Name?.Trim() ?? string.Empty)
                .Where(name => name.Length > 0)
                .Take(3));
        Overdue = item.Overdue;
        AttentionRequired = item.AttentionRequired;
        StateTone = item.Stage?.Key switch
        {
            "fulfilled" or "received" or "ready" => HubStatusTone.Success,
            "cancelled" => HubStatusTone.Muted,
            _ when item.Overdue => HubStatusTone.Danger,
            _ => HubStatusTone.Info,
        };
    }

    public string RequestRef { get; }
    public string Number { get; }
    public string AutomationName
    {
        get
        {
            var parts = "Заявка " + Number + ": " + StateLabel;
            if (!string.IsNullOrEmpty(WarehouseName))
            {
                parts += ", " + WarehouseName;
            }
            if (Overdue)
            {
                parts += ", просрочена";
            }
            return parts;
        }
    }
    public string StateLabel { get; }
    public string StateDescription { get; }
    public string WarehouseName { get; }
    public string DepartmentName { get; }
    public string InitiatorName { get; }
    public string DateText { get; }
    public string RequiredDateText { get; }
    public string ProgressLabel { get; }
    public string NomenclaturePreview { get; }
    public bool Overdue { get; }
    public bool AttentionRequired { get; }
    public string StateTone { get; }
}

/// <summary>Деталь заявки: шапка, маршрут (journey), позиции и документы (timeline).</summary>
public sealed class ItRequestDetailViewModel
{
    public ItRequestDetailViewModel(HubItRequestItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Number = item.RequestNumber?.Trim() ?? item.SystemNumber?.Trim() ?? "Заявка";
        StateLabel = item.CurrentState?.Label?.Trim()
            ?? item.Stage?.Label?.Trim()
            ?? ItRequestStages.Label(item.Stage?.Key);
        StateDescription = item.CurrentState?.Description?.Trim() ?? string.Empty;
        StateTone = item.Stage?.Key switch
        {
            "fulfilled" or "received" or "ready" => HubStatusTone.Success,
            "cancelled" => HubStatusTone.Muted,
            _ when item.Overdue => HubStatusTone.Danger,
            _ => HubStatusTone.Info,
        };
        WarehouseName = item.WarehouseName?.Trim() ?? string.Empty;
        DepartmentName = item.DepartmentName?.Trim() ?? string.Empty;
        OrganizationName = item.OrganizationName?.Trim() ?? string.Empty;
        InitiatorName = item.InitiatorName?.Trim() ?? string.Empty;
        ResponsibleName = item.ResponsibleName?.Trim() ?? string.Empty;
        SupplierNames = string.Join(", ",
            (item.SupplierNames ?? [])
                .Concat(new[] { item.SupplierName })
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Select(name => name!.Trim())
                .Distinct());
        ManagerNames = string.Join(", ", (item.ManagerNames ?? []).Where(name => !string.IsNullOrWhiteSpace(name)));
        GroupName = item.GroupName?.Trim() ?? string.Empty;
        Comment = item.Comment?.Trim() ?? string.Empty;
        DateText = WarehouseViewModel.FormatDate(item.Date);
        RequiredDateText = WarehouseViewModel.FormatDate(item.RequiredDate);
        DeliveryDateText = WarehouseViewModel.FormatDate(item.FactualDeliveryDate);
        Overdue = item.Overdue;
        AttentionRequired = item.AttentionRequired;
        ProgressLabel = item.ProgressLabel?.Trim() ?? string.Empty;
        foreach (var step in item.Journey ?? [])
        {
            Journey.Add(new ItRequestJourneyStepViewModel(step));
        }

        var groups = item.ItemGroups ?? [];
        if (groups.Count > 0)
        {
            foreach (var group in groups)
            {
                Positions.Add(new ItRequestPositionViewModel(group));
            }
        }
        else
        {
            foreach (var position in item.Positions ?? [])
            {
                Positions.Add(new ItRequestPositionViewModel(position));
            }
        }

        foreach (var entry in item.Timeline ?? [])
        {
            Documents.Add(new ItRequestDocumentViewModel(entry));
        }

        HasPositions = Positions.Count > 0;
        HasDocuments = Documents.Count > 0;
    }

    public string Number { get; }
    public string StateLabel { get; }
    public string StateDescription { get; }
    public string StateTone { get; }
    public string WarehouseName { get; }
    public string DepartmentName { get; }
    public string OrganizationName { get; }
    public string InitiatorName { get; }
    public string ResponsibleName { get; }
    public string SupplierNames { get; }
    public string ManagerNames { get; }
    public string GroupName { get; }
    public string Comment { get; }
    public string DateText { get; }
    public string RequiredDateText { get; }
    public string DeliveryDateText { get; }
    public bool Overdue { get; }
    public bool AttentionRequired { get; }
    public string ProgressLabel { get; }
    public bool HasPositions { get; }
    public bool HasDocuments { get; }
    public ObservableCollection<ItRequestJourneyStepViewModel> Journey { get; } = [];
    public ObservableCollection<ItRequestPositionViewModel> Positions { get; } = [];
    public ObservableCollection<ItRequestDocumentViewModel> Documents { get; } = [];
}

/// <summary>Шаг маршрута заявки: достигнут/текущий/пропущен.</summary>
public sealed class ItRequestJourneyStepViewModel
{
    public ItRequestJourneyStepViewModel(HubItRequestJourneyStep step)
    {
        Label = step.Label?.Trim() ?? string.Empty;
        Reached = step.Reached;
        Current = step.Current;
        Missing = step.Missing;
        var date = WarehouseViewModel.FormatDate(step.Date);
        var number = step.DocumentNumber?.Trim() ?? string.Empty;
        MetaText = string.Join(" · ", new[] { date, number }.Where(part => part.Length > 0));
        Tone = step.Missing ? HubStatusTone.Danger
            : step.Current ? HubStatusTone.Warning
            : step.Reached ? HubStatusTone.Success
            : HubStatusTone.Muted;
    }

    public string Label { get; }
    public bool Reached { get; }
    public bool Current { get; }
    public bool Missing { get; }
    public string MetaText { get; }
    public string Tone { get; }
}

/// <summary>Позиция заявки (item_groups либо сырая строка positions).</summary>
public sealed class ItRequestPositionViewModel
{
    public ItRequestPositionViewModel(HubItRequestItemGroup group)
    {
        Name = group.Name?.Trim() ?? string.Empty;
        Characteristic = group.CharacteristicName?.Trim() ?? string.Empty;
        QtyText = $"{WarehouseViewModel.FormatQty(group.Quantity)} {group.Unit?.Trim()}".Trim();
        Cancelled = group.Cancelled;
        ReasonText = group.Cancelled && group.CancellationReasons is { Count: > 0 }
            ? "Отменено: " + string.Join("; ", group.CancellationReasons)
            : string.Empty;
        ProgressText = BuildProgress(group.QtyOrdered, group.QtyReceived, group.QtyRequested);
    }

    public ItRequestPositionViewModel(HubItRequestPosition position)
    {
        Name = position.NomenclatureName?.Trim() ?? string.Empty;
        Characteristic = position.CharacteristicName?.Trim() ?? string.Empty;
        QtyText = $"{WarehouseViewModel.FormatQty(position.Quantity)} {position.UnitName?.Trim()}".Trim();
        Cancelled = position.Cancelled;
        ReasonText = position.Cancelled && !string.IsNullOrWhiteSpace(position.CancellationReason)
            ? "Отменено: " + position.CancellationReason.Trim()
            : string.Empty;
        ProgressText = string.Empty;
    }

    public string Name { get; }
    public string Characteristic { get; }
    public string QtyText { get; }
    public bool Cancelled { get; }
    public string ReasonText { get; }
    public string ProgressText { get; }

    private static string BuildProgress(double? ordered, double? received, double requested)
    {
        var parts = new List<string>();
        if (ordered is > 0)
        {
            parts.Add($"заказано {WarehouseViewModel.FormatQty(ordered.Value)}");
        }

        if (received is > 0)
        {
            parts.Add($"получено {WarehouseViewModel.FormatQty(received.Value)}");
        }

        return parts.Count == 0
            ? string.Empty
            : string.Join(" · ", parts) + $" из {WarehouseViewModel.FormatQty(requested)}";
    }
}

/// <summary>Документ из timeline заявки (заказ, резерв, поступление, выдача).</summary>
public sealed class ItRequestDocumentViewModel
{
    public ItRequestDocumentViewModel(HubItRequestTimelineEvent entry)
    {
        Label = entry.Label?.Trim() ?? entry.Type?.Trim() ?? "Документ";
        Number = entry.DocumentNumber?.Trim() ?? string.Empty;
        DateText = WarehouseViewModel.FormatDate(entry.Date);
        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(entry.ManagerName))
        {
            meta.Add("Менеджер: " + entry.ManagerName.Trim());
        }

        if (!string.IsNullOrWhiteSpace(entry.SupplierName))
        {
            meta.Add("Поставщик: " + entry.SupplierName.Trim());
        }

        if (!string.IsNullOrWhiteSpace(entry.DestinationName))
        {
            meta.Add("Склад: " + entry.DestinationName.Trim());
        }

        if (entry.Quantity > 0)
        {
            meta.Add("кол-во " + WarehouseViewModel.FormatQty(entry.Quantity));
        }

        MetaText = string.Join(" · ", meta);
        NomenclatureText = string.Join(", ",
            (entry.NomenclatureNames ?? []).Where(name => !string.IsNullOrWhiteSpace(name)).Take(4));
    }

    public string Label { get; }
    public string Number { get; }
    public string DateText { get; }
    public string MetaText { get; }
    public string NomenclatureText { get; }
}
