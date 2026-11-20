using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Раздел «Склад 1С» (warehouse_1c.read): остатки с серверными фильтрами,
/// ведомость движений с карточкой документа и склады уволенных.
/// Модель раздела повторяет web /warehouse-1c: справочники — подсказками
/// через search-роуты (ref-значения пользователь не вводит вручную).
/// </summary>
public sealed class WarehouseViewModel : ObservableObject
{
    public const string TabBalances = "balances";
    public const string TabMovements = "movements";
    public const string TabDismissed = "dismissed";

    private const int BalancesPageLimit = 200;
    private const int MovementsPageLimit = 500;
    private const int DismissedLimit = 100;
    private const int SuggestLimit = 20;

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _balancesCancellation;
    private CancellationTokenSource? _movementsCancellation;
    private CancellationTokenSource? _detailCancellation;
    private CancellationTokenSource? _dismissedCancellation;
    private string? _movementsCursor;

    private string _selectedTab = TabBalances;
    private string _balancesText = string.Empty;
    private bool _isBalancesLoading;
    private bool _balancesSearched;
    private string? _balancesErrorText;
    private string _balancesResultText = string.Empty;
    private string? _balancesNoticeText;
    private string _balancesTotalsText = string.Empty;
    private bool _isMovementsLoading;
    private bool _isLoadingMoreMovements;
    private bool _hasMoreMovements;
    private bool _movementsSearched;
    private string? _movementsErrorText;
    private string _movementsResultText = string.Empty;
    private string? _movementsNoticeText;
    private DateTime? _movementsDateFrom;
    private DateTime? _movementsDateTo;
    private string? _seriesFilterRef;
    private string _seriesFilterText = string.Empty;
    private WarehouseMovementRowViewModel? _selectedMovement;
    private WarehouseMovementDetailViewModel? _movementDetail;
    private bool _isMovementDetailLoading;
    private string? _movementDetailErrorText;
    private bool _isDismissedLoading;
    private bool _dismissedSearched;
    private string? _dismissedErrorText;
    private string? _dismissedNoticeText;
    private WarehouseDismissedItemViewModel? _selectedDismissed;
    private string _catalogStatusText = string.Empty;
    private string? _bannerErrorText;

    public WarehouseViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        BalNomenclature = new WarehouseSuggestFieldViewModel(
            (q, ct) => _api.SearchWarehouse1cNomenclatureAsync(q, SuggestLimit, ct),
            (ts, ct) => DelayAsync(ts, ct));
        BalWarehouse = new WarehouseSuggestFieldViewModel(
            (q, ct) => _api.SearchWarehouse1cWarehousesAsync(q, SuggestLimit, ct),
            (ts, ct) => DelayAsync(ts, ct));
        MovNomenclature = new WarehouseSuggestFieldViewModel(
            (q, ct) => _api.SearchWarehouse1cNomenclatureAsync(q, SuggestLimit, ct),
            (ts, ct) => DelayAsync(ts, ct));
        MovWarehouse = new WarehouseSuggestFieldViewModel(
            (q, ct) => _api.SearchWarehouse1cWarehousesAsync(q, SuggestLimit, ct),
            (ts, ct) => DelayAsync(ts, ct));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct, refresh: true),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SelectTabCommand = new NativeRelayCommand(parameter =>
        {
            var tab = parameter as string ?? TabBalances;
            if (!string.Equals(_selectedTab, tab, StringComparison.Ordinal))
            {
                SelectedTab = tab;
            }
        });
        SearchBalancesCommand = new NativeAsyncCommand(
            (_, _) => LoadBalancesSafelyAsync(),
            ex => BalancesErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSearchBalances);
        RetryBalancesCommand = new NativeAsyncCommand(
            (_, _) => LoadBalancesSafelyAsync(),
            ex => BalancesErrorText = TasksViewModel.DescribeError(ex));
        SearchMovementsCommand = new NativeAsyncCommand(
            (_, _) => LoadMovementsSafelyAsync(append: false),
            ex => MovementsErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSearchMovements);
        RetryMovementsCommand = new NativeAsyncCommand(
            (_, _) => LoadMovementsSafelyAsync(append: false),
            ex => MovementsErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreMovementsCommand = new NativeAsyncCommand(
            (_, _) => LoadMovementsSafelyAsync(append: true),
            ex => MovementsErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMoreMovements && !IsLoadingMoreMovements);
        RetryMovementDetailCommand = new NativeAsyncCommand(
            (_, _) => SelectedMovement is not null
                ? LoadMovementDetailSafelyAsync(SelectedMovement)
                : Task.CompletedTask,
            ex => MovementDetailErrorText = TasksViewModel.DescribeError(ex));
        CloseMovementDetailCommand = new NativeRelayCommand(() => SelectedMovement = null);
        ClearSeriesCommand = new NativeRelayCommand(() =>
        {
            _seriesFilterRef = null;
            SeriesFilterText = string.Empty;
        });
        ShowMovementsCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is WarehouseBalanceRowViewModel row)
            {
                ShowMovementsFor(row);
            }
        });
        LoadDismissedCommand = new NativeAsyncCommand(
            (_, _) => LoadDismissedSafelyAsync(),
            ex => DismissedErrorText = TasksViewModel.DescribeError(ex));
        RetryDismissedCommand = new NativeAsyncCommand(
            (_, _) => LoadDismissedSafelyAsync(),
            ex => DismissedErrorText = TasksViewModel.DescribeError(ex));
        Balances.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasBalances));
        Movements.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasMovements));
        DismissedItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasDismissed));
    }

    /// <summary>Тестовый шов дебаунса подсказок (как у ItObjects/Construction).</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Запрос на скачивание файла документа — View открывает SaveFileDialog.</summary>
    public event EventHandler<WarehouseMovementFileItemViewModel>? FileDownloadRequested;

    // ---- Общие состояния ----

    public string SelectedTab
    {
        get => _selectedTab;
        private set
        {
            if (SetProperty(ref _selectedTab, value))
            {
                OnPropertyChanged(nameof(IsBalancesTab));
                OnPropertyChanged(nameof(IsMovementsTab));
                OnPropertyChanged(nameof(IsDismissedTab));
                if (IsDismissedTab && !DismissedSearched && !IsDismissedLoading)
                {
                    _ = LoadDismissedSafelyAsync();
                }
            }
        }
    }

    public bool IsBalancesTab => SelectedTab == TabBalances;
    public bool IsMovementsTab => SelectedTab == TabMovements;
    public bool IsDismissedTab => SelectedTab == TabDismissed;

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set => SetProperty(ref _bannerErrorText, value);
    }

    /// <summary>Статус кэша справочников 1С (возраст, объём, идёт ли синхронизация).</summary>
    public string CatalogStatusText
    {
        get => _catalogStatusText;
        private set => SetProperty(ref _catalogStatusText, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand SelectTabCommand { get; }

    // ---- Вкладка «Остатки» ----

    /// <summary>Подсказка номенклатуры (ввод → search, выбор → nomenclature_ref).</summary>
    public WarehouseSuggestFieldViewModel BalNomenclature { get; }

    /// <summary>Подсказка склада (ввод → search, выбор → warehouse_ref).</summary>
    public WarehouseSuggestFieldViewModel BalWarehouse { get; }

    /// <summary>Свободный поиск по остаткам (q) — запуск кнопкой, как в вебе.</summary>
    public string BalancesText
    {
        get => _balancesText;
        set
        {
            if (SetProperty(ref _balancesText, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(CanSearchBalances));
                ((NativeAsyncCommand)SearchBalancesCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Backend требует хотя бы один фильтр: номенклатура, склад или текст.</summary>
    public bool CanSearchBalances =>
        !string.IsNullOrWhiteSpace(BalNomenclature.SelectedRef)
        || !string.IsNullOrWhiteSpace(BalWarehouse.SelectedRef)
        || !string.IsNullOrWhiteSpace(BalancesText);

    public ObservableCollection<WarehouseBalanceRowViewModel> Balances { get; } = [];
    public bool HasBalances => Balances.Count > 0;

    public bool IsBalancesLoading
    {
        get => _isBalancesLoading;
        private set
        {
            if (SetProperty(ref _isBalancesLoading, value))
            {
                ((NativeAsyncCommand)SearchBalancesCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool BalancesSearched
    {
        get => _balancesSearched;
        private set
        {
            if (SetProperty(ref _balancesSearched, value))
            {
                OnPropertyChanged(nameof(ShowBalancesEmpty));
            }
        }
    }

    public bool ShowBalancesEmpty => BalancesSearched && !IsBalancesLoading && Balances.Count == 0;

    public string? BalancesErrorText
    {
        get => _balancesErrorText;
        private set => SetProperty(ref _balancesErrorText, value);
    }

    public string BalancesResultText
    {
        get => _balancesResultText;
        private set => SetProperty(ref _balancesResultText, value);
    }

    /// <summary>Предупреждение о неполной выборке (has_more/truncated/incomplete_reason).</summary>
    public string? BalancesNoticeText
    {
        get => _balancesNoticeText;
        private set => SetProperty(ref _balancesNoticeText, value);
    }

    public string BalancesTotalsText
    {
        get => _balancesTotalsText;
        private set => SetProperty(ref _balancesTotalsText, value);
    }

    public ICommand SearchBalancesCommand { get; }
    public ICommand RetryBalancesCommand { get; }

    /// <summary>Из строки остатков — переход в ведомость с фильтрами по строке.</summary>
    public ICommand ShowMovementsCommand { get; }

    // ---- Вкладка «Ведомость» ----

    public WarehouseSuggestFieldViewModel MovNomenclature { get; }
    public WarehouseSuggestFieldViewModel MovWarehouse { get; }

    /// <summary>Начало периода ведомости (date_from, дата без времени).</summary>
    public DateTime? MovementsDateFrom
    {
        get => _movementsDateFrom;
        set => SetProperty(ref _movementsDateFrom, value);
    }

    /// <summary>Конец периода ведомости (date_to).</summary>
    public DateTime? MovementsDateTo
    {
        get => _movementsDateTo;
        set => SetProperty(ref _movementsDateTo, value);
    }

    /// <summary>Подпись активного фильтра серии (выставляется из строки остатков).</summary>
    public string SeriesFilterText
    {
        get => _seriesFilterText;
        private set
        {
            if (SetProperty(ref _seriesFilterText, value))
            {
                OnPropertyChanged(nameof(HasSeriesFilter));
            }
        }
    }

    public bool HasSeriesFilter => !string.IsNullOrWhiteSpace(_seriesFilterRef);

    /// <summary>Ведомость строится по номенклатуре — ref обязателен у backend.</summary>
    public bool CanSearchMovements => !string.IsNullOrWhiteSpace(MovNomenclature.SelectedRef);

    public ObservableCollection<WarehouseMovementRowViewModel> Movements { get; } = [];
    public bool HasMovements => Movements.Count > 0;

    public bool IsMovementsLoading
    {
        get => _isMovementsLoading;
        private set
        {
            if (SetProperty(ref _isMovementsLoading, value))
            {
                ((NativeAsyncCommand)SearchMovementsCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsLoadingMoreMovements
    {
        get => _isLoadingMoreMovements;
        private set => SetProperty(ref _isLoadingMoreMovements, value);
    }

    public bool HasMoreMovements
    {
        get => _hasMoreMovements;
        private set
        {
            if (SetProperty(ref _hasMoreMovements, value))
            {
                ((NativeAsyncCommand)LoadMoreMovementsCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool MovementsSearched
    {
        get => _movementsSearched;
        private set
        {
            if (SetProperty(ref _movementsSearched, value))
            {
                OnPropertyChanged(nameof(ShowMovementsEmpty));
            }
        }
    }

    public bool ShowMovementsEmpty => MovementsSearched && !IsMovementsLoading && Movements.Count == 0;

    public string? MovementsErrorText
    {
        get => _movementsErrorText;
        private set => SetProperty(ref _movementsErrorText, value);
    }

    public string MovementsResultText
    {
        get => _movementsResultText;
        private set => SetProperty(ref _movementsResultText, value);
    }

    public string? MovementsNoticeText
    {
        get => _movementsNoticeText;
        private set => SetProperty(ref _movementsNoticeText, value);
    }

    /// <summary>Выбранная строка ведомости — карточка документа грузится сама.</summary>
    public WarehouseMovementRowViewModel? SelectedMovement
    {
        get => _selectedMovement;
        set
        {
            if (SetProperty(ref _selectedMovement, value))
            {
                if (value is null)
                {
                    CancelDetailLoad();
                    MovementDetail = null;
                    MovementDetailErrorText = null;
                    IsMovementDetailLoading = false;
                }
                else
                {
                    _ = LoadMovementDetailSafelyAsync(value);
                }
            }
        }
    }

    public WarehouseMovementDetailViewModel? MovementDetail
    {
        get => _movementDetail;
        private set
        {
            if (SetProperty(ref _movementDetail, value))
            {
                OnPropertyChanged(nameof(IsMovementDetailOpen));
            }
        }
    }

    /// <summary>Панель карточки открыта, когда выбрана строка (даже во время загрузки).</summary>
    public bool IsMovementDetailOpen => _selectedMovement is not null;

    public bool IsMovementDetailLoading
    {
        get => _isMovementDetailLoading;
        private set => SetProperty(ref _isMovementDetailLoading, value);
    }

    public string? MovementDetailErrorText
    {
        get => _movementDetailErrorText;
        private set => SetProperty(ref _movementDetailErrorText, value);
    }

    public ICommand SearchMovementsCommand { get; }
    public ICommand RetryMovementsCommand { get; }
    public ICommand LoadMoreMovementsCommand { get; }
    public ICommand RetryMovementDetailCommand { get; }
    public ICommand CloseMovementDetailCommand { get; }
    public ICommand ClearSeriesCommand { get; }

    // ---- Вкладка «Уволенные» ----

    public ObservableCollection<WarehouseDismissedItemViewModel> DismissedItems { get; } = [];
    public bool HasDismissed => DismissedItems.Count > 0;

    public bool IsDismissedLoading
    {
        get => _isDismissedLoading;
        private set
        {
            if (SetProperty(ref _isDismissedLoading, value))
            {
                OnPropertyChanged(nameof(ShowDismissedEmpty));
            }
        }
    }

    public bool DismissedSearched
    {
        get => _dismissedSearched;
        private set
        {
            if (SetProperty(ref _dismissedSearched, value))
            {
                OnPropertyChanged(nameof(ShowDismissedEmpty));
            }
        }
    }

    public bool ShowDismissedEmpty => DismissedSearched && !IsDismissedLoading && DismissedItems.Count == 0;

    public string? DismissedErrorText
    {
        get => _dismissedErrorText;
        private set => SetProperty(ref _dismissedErrorText, value);
    }

    public string? DismissedNoticeText
    {
        get => _dismissedNoticeText;
        private set => SetProperty(ref _dismissedNoticeText, value);
    }

    /// <summary>Выбранный склад — карточка сотрудника и остатки уже в элементе.</summary>
    public WarehouseDismissedItemViewModel? SelectedDismissed
    {
        get => _selectedDismissed;
        set => SetProperty(ref _selectedDismissed, value);
    }

    public ICommand LoadDismissedCommand { get; }
    public ICommand RetryDismissedCommand { get; }

    /// <summary>Первая активация страницы: только статус справочников — списки по запросу.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken) =>
        await LoadAsync(cancellationToken, refresh: false);

    private async Task LoadAsync(CancellationToken cancellationToken, bool refresh)
    {
        BannerErrorText = null;
        try
        {
            var status = await _api.GetWarehouse1cCatalogStatusAsync(cancellationToken);
            CatalogStatusText = FormatCatalogStatus(status);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Статус — вспомогательная строка: не блокируем раздел.
            CatalogStatusText = "Статус кэша справочников 1С недоступен";
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }

        if (!refresh)
        {
            return;
        }

        if (IsBalancesTab && BalancesSearched)
        {
            await LoadBalancesSafelyAsync();
        }
        else if (IsMovementsTab && MovementsSearched)
        {
            await LoadMovementsSafelyAsync(append: false);
        }
        else if (IsDismissedTab && DismissedSearched)
        {
            await LoadDismissedSafelyAsync();
        }
    }

    private async Task LoadBalancesSafelyAsync()
    {
        CancelBalancesLoad();
        var cancellation = _balancesCancellation = new CancellationTokenSource();
        IsBalancesLoading = true;
        BalancesErrorText = null;
        try
        {
            var response = await _api.GetWarehouse1cBalancesAsync(
                new HubWarehouse1cBalancesQuery
                {
                    NomenclatureRef = BalNomenclature.SelectedRef,
                    WarehouseRef = BalWarehouse.SelectedRef,
                    Text = BalancesText,
                    Limit = BalancesPageLimit,
                },
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            Balances.Clear();
            foreach (var row in response.Items ?? [])
            {
                Balances.Add(new WarehouseBalanceRowViewModel(row, ShowMovementsCommand));
            }

            var returned = response.Returned > 0 ? response.Returned : Balances.Count;
            var total = response.Total;
            var aggregates = response.Aggregates;
            BalancesResultText = total is > 0
                ? $"Найдено позиций: {returned} из {total}"
                : $"Найдено позиций: {returned}";
            BalancesTotalsText = aggregates is null
                ? string.Empty
                : $"Σ кол-во: {FormatNumber(aggregates.Qty)}   Σ остаток: {FormatMoney(aggregates.Cost)}   Σ бух: {FormatMoney(aggregates.CostAccounting)}";
            BalancesNoticeText = IncompleteNotice(response, returned);
            BalancesSearched = true;
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                BalancesErrorText = TasksViewModel.DescribeError(exception);
                BalancesSearched = true;
            }
        }
        finally
        {
            if (ReferenceEquals(_balancesCancellation, cancellation))
            {
                IsBalancesLoading = false;
            }
        }
    }

    private async Task LoadMovementsSafelyAsync(bool append)
    {
        CancelMovementsLoad();
        var cancellation = _movementsCancellation = new CancellationTokenSource();
        if (!append)
        {
            IsMovementsLoading = true;
            MovementsErrorText = null;
            _movementsCursor = null;
        }
        else
        {
            IsLoadingMoreMovements = true;
        }

        try
        {
            var response = await _api.GetWarehouse1cMovementsAsync(
                new HubWarehouse1cMovementsQuery
                {
                    NomenclatureRef = MovNomenclature.SelectedRef,
                    WarehouseRef = MovWarehouse.SelectedRef,
                    SeriesRef = _seriesFilterRef,
                    DateFrom = MovementsDateFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    DateTo = MovementsDateTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    Limit = MovementsPageLimit,
                    Cursor = append ? _movementsCursor : null,
                },
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            if (!append)
            {
                Movements.Clear();
                MovementDetail = null;
            }

            foreach (var row in response.Items ?? [])
            {
                Movements.Add(new WarehouseMovementRowViewModel(row));
            }

            var returned = response.Returned > 0 ? response.Returned : Movements.Count;
            MovementsResultText = response.Total is > 0
                ? $"Показано записей: {returned} из {response.Total}"
                : $"Показано записей: {returned}";
            MovementsNoticeText = IncompleteNotice(response, returned);
            _movementsCursor = response.NextCursor;
            HasMoreMovements = response.HasMore && !string.IsNullOrWhiteSpace(response.NextCursor);
            MovementsSearched = true;
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                MovementsErrorText = TasksViewModel.DescribeError(exception);
                MovementsSearched = true;
            }
        }
        finally
        {
            if (ReferenceEquals(_movementsCancellation, cancellation))
            {
                IsMovementsLoading = false;
                IsLoadingMoreMovements = false;
            }
        }
    }

    private async Task LoadMovementDetailSafelyAsync(WarehouseMovementRowViewModel row)
    {
        CancelDetailLoad();
        var cancellation = _detailCancellation = new CancellationTokenSource();
        IsMovementDetailLoading = true;
        MovementDetailErrorText = null;
        try
        {
            var detail = await _api.GetWarehouse1cMovementDetailAsync(
                row.RegistrarRef,
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            MovementDetail = new WarehouseMovementDetailViewModel(detail, RequestFileDownload);
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                MovementDetail = null;
                MovementDetailErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailCancellation, cancellation))
            {
                IsMovementDetailLoading = false;
            }
        }
    }

    private void RequestFileDownload(WarehouseMovementFileItemViewModel file) =>
        FileDownloadRequested?.Invoke(this, file);

    /// <summary>Выгрузка файла документа в поток (View открывает SaveFileDialog).</summary>
    public async Task DownloadMovementFileAsync(
        WarehouseMovementFileItemViewModel file,
        Stream destination,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(destination);
        var registrarRef = _selectedMovement?.RegistrarRef ?? string.Empty;
        var name = await _api.DownloadWarehouse1cMovementFileAsync(
            registrarRef,
            file.Ref,
            destination,
            cancellationToken);
        file.MarkDownloaded(name);
    }

    private async Task LoadDismissedSafelyAsync()
    {
        CancelDismissedLoad();
        var cancellation = _dismissedCancellation = new CancellationTokenSource();
        IsDismissedLoading = true;
        DismissedErrorText = null;
        try
        {
            var response = await _api.GetWarehouse1cDismissedWarehousesAsync(
                DismissedLimit,
                cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            DismissedItems.Clear();
            foreach (var item in response.Items ?? [])
            {
                DismissedItems.Add(new WarehouseDismissedItemViewModel(item));
            }

            var returned = response.Returned > 0 ? response.Returned : DismissedItems.Count;
            DismissedNoticeText = IncompleteNotice(response, returned);
            DismissedSearched = true;
        }
        catch (Exception exception)
        {
            if (!cancellation.IsCancellationRequested)
            {
                DismissedErrorText = TasksViewModel.DescribeError(exception);
                DismissedSearched = true;
            }
        }
        finally
        {
            if (ReferenceEquals(_dismissedCancellation, cancellation))
            {
                IsDismissedLoading = false;
            }
        }
    }

    private void ShowMovementsFor(WarehouseBalanceRowViewModel row)
    {
        MovNomenclature.SelectExternally(row.NomenclatureRef, row.NomenclatureTitle);
        MovWarehouse.SelectExternally(row.WarehouseRef, row.WarehouseName);
        _seriesFilterRef = string.IsNullOrWhiteSpace(row.SeriesRef) ? null : row.SeriesRef;
        SeriesFilterText = string.IsNullOrWhiteSpace(row.SeriesLabel) ? string.Empty : row.SeriesLabel;
        SelectedTab = TabMovements;
        if (CanSearchMovements)
        {
            _ = LoadMovementsSafelyAsync(append: false);
        }
    }

    private static string? IncompleteNotice(HubWarehouse1cListEnvelope envelope, int returned)
    {
        if (envelope.Truncated || envelope.HasMore)
        {
            var total = envelope.Total is > 0 ? $" из {envelope.Total}" : string.Empty;
            return $"Выборка неполная: показано {returned}{total}. Уточните фильтры.";
        }

        return envelope.IncompleteReason is { Length: > 0 } reason
            ? $"Выборка может быть неполной: {reason}"
            : null;
    }

    private static string FormatCatalogStatus(HubWarehouse1cCatalogStatus? status)
    {
        if (status is null)
        {
            return "Статус кэша справочников 1С недоступен";
        }

        var updated = MonitoringFormat.TryParseTime(status.UpdatedAt, out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : "никогда";
        var sync = status.SyncInProgress ? " · идёт синхронизация" : string.Empty;
        var error = !string.IsNullOrWhiteSpace(status.LastError) ? " · последняя синхронизация с ошибкой" : string.Empty;
        return $"Кэш справочников 1С: {status.NomenclatureCount:N0} позиций · {status.WarehousesCount} складов · обновлён {updated}{sync}{error}";
    }

    internal static string FormatNumber(double value) =>
        value.ToString("N2", CultureInfo.CurrentCulture);

    internal static string FormatMoney(double value) =>
        value.ToString("N0", CultureInfo.CurrentCulture) + " ₽";

    internal static string FormatQty(double value) =>
        value.ToString("G", CultureInfo.CurrentCulture);

    internal static string FormatDate(string? value) =>
        MonitoringFormat.TryParseTime(value, out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy", CultureInfo.CurrentCulture)
            : value ?? string.Empty;

    private void CancelBalancesLoad()
    {
        _balancesCancellation?.Cancel();
        _balancesCancellation?.Dispose();
        _balancesCancellation = null;
    }

    private void CancelMovementsLoad()
    {
        _movementsCancellation?.Cancel();
        _movementsCancellation?.Dispose();
        _movementsCancellation = null;
    }

    private void CancelDetailLoad()
    {
        _detailCancellation?.Cancel();
        _detailCancellation?.Dispose();
        _detailCancellation = null;
    }

    private void CancelDismissedLoad()
    {
        _dismissedCancellation?.Cancel();
        _dismissedCancellation?.Dispose();
        _dismissedCancellation = null;
    }

    /// <summary>Страничная ошибка уровня шелла (как у Construction.SetLoadError).</summary>
    public void SetLoadError(string message) => BannerErrorText = message;

    /// <summary>Выход из сессии: отмена всех загрузок и сброс состояния страницы.</summary>
    public void Reset()
    {
        CancelBalancesLoad();
        CancelMovementsLoad();
        CancelDetailLoad();
        CancelDismissedLoad();
        BalNomenclature.Clear();
        BalWarehouse.Clear();
        MovNomenclature.Clear();
        MovWarehouse.Clear();
        Balances.Clear();
        Movements.Clear();
        DismissedItems.Clear();
        MovementDetail = null;
        SelectedMovement = null;
        SelectedDismissed = null;
        _selectedTab = TabBalances;
        OnPropertyChanged(nameof(SelectedTab));
        OnPropertyChanged(nameof(IsBalancesTab));
        OnPropertyChanged(nameof(IsMovementsTab));
        OnPropertyChanged(nameof(IsDismissedTab));
        _balancesText = string.Empty;
        OnPropertyChanged(nameof(BalancesText));
        _seriesFilterRef = null;
        SeriesFilterText = string.Empty;
        _movementsDateFrom = null;
        OnPropertyChanged(nameof(MovementsDateFrom));
        _movementsDateTo = null;
        OnPropertyChanged(nameof(MovementsDateTo));
        _movementsCursor = null;
        _balancesSearched = false;
        _movementsSearched = false;
        _dismissedSearched = false;
        OnPropertyChanged(nameof(BalancesSearched));
        OnPropertyChanged(nameof(MovementsSearched));
        OnPropertyChanged(nameof(DismissedSearched));
        _isBalancesLoading = false;
        _isMovementsLoading = false;
        _isLoadingMoreMovements = false;
        _hasMoreMovements = false;
        _isDismissedLoading = false;
        _isMovementDetailLoading = false;
        OnPropertyChanged(nameof(IsBalancesLoading));
        OnPropertyChanged(nameof(IsMovementsLoading));
        OnPropertyChanged(nameof(IsLoadingMoreMovements));
        OnPropertyChanged(nameof(HasMoreMovements));
        OnPropertyChanged(nameof(IsDismissedLoading));
        OnPropertyChanged(nameof(IsMovementDetailLoading));
        BalancesErrorText = null;
        MovementsErrorText = null;
        MovementDetailErrorText = null;
        DismissedErrorText = null;
        BannerErrorText = null;
        BalancesNoticeText = null;
        MovementsNoticeText = null;
        DismissedNoticeText = null;
        BalancesResultText = string.Empty;
        MovementsResultText = string.Empty;
        BalancesTotalsText = string.Empty;
        CatalogStatusText = string.Empty;
    }
}

/// <summary>
/// Поле-автодополнение справочника 1С: ввод текста → search-роут → варианты;
/// выбор варианта фиксирует ref. Пустой ref = фильтр не задан.
/// </summary>
public sealed class WarehouseSuggestFieldViewModel : ObservableObject
{
    private const int MinQueryLength = 2;

    private readonly Func<string, CancellationToken, Task<IReadOnlyList<HubWarehouse1cCatalogItem>>> _search;
    private readonly Func<TimeSpan, CancellationToken, Task> _delay;
    private static readonly TimeSpan Debounce = TimeSpan.FromMilliseconds(350);
    private CancellationTokenSource? _suggestCancellation;
    private string _text = string.Empty;
    private WarehouseSuggestOption? _selected;
    private bool _suppressText;
    private bool _isSearching;

    public WarehouseSuggestFieldViewModel(
        Func<string, CancellationToken, Task<IReadOnlyList<HubWarehouse1cCatalogItem>>> search,
        Func<TimeSpan, CancellationToken, Task> delay)
    {
        _search = search ?? throw new ArgumentNullException(nameof(search));
        _delay = delay ?? throw new ArgumentNullException(nameof(delay));
    }

    /// <summary>Текст в поле: правка запускает подсказки и сбрасывает выбранный ref.</summary>
    public string Text
    {
        get => _text;
        set
        {
            if (!SetProperty(ref _text, value ?? string.Empty) || _suppressText)
            {
                return;
            }

            if (_selected is not null && !string.Equals(_selected.Text, _text, StringComparison.Ordinal))
            {
                _selected = null;
                OnPropertyChanged(nameof(SelectedOption));
                OnPropertyChanged(nameof(SelectedRef));
            }

            _ = SuggestSafelyAsync();
        }
    }

    /// <summary>Выбранный вариант списка подсказок (null — фильтр не задан).</summary>
    public WarehouseSuggestOption? SelectedOption
    {
        get => _selected;
        set
        {
            if (!SetProperty(ref _selected, value))
            {
                return;
            }

            OnPropertyChanged(nameof(SelectedRef));
            if (value is not null)
            {
                _suppressText = true;
                try
                {
                    Text = value.Text;
                }
                finally
                {
                    _suppressText = false;
                }
            }
        }
    }

    public string? SelectedRef => _selected?.Ref;

    public ObservableCollection<WarehouseSuggestOption> Options { get; } = [];

    public bool IsSearching
    {
        get => _isSearching;
        private set => SetProperty(ref _isSearching, value);
    }

    /// <summary>Программный выбор значения (из строки остатков) без round-trip поиска.</summary>
    public void SelectExternally(string? reference, string display)
    {
        if (string.IsNullOrWhiteSpace(reference))
        {
            Clear();
            return;
        }

        var option = new WarehouseSuggestOption(reference.Trim(), display.Trim());
        Options.Clear();
        Options.Add(option);
        SelectedOption = option;
    }

    public void Clear()
    {
        _suggestCancellation?.Cancel();
        _suggestCancellation?.Dispose();
        _suggestCancellation = null;
        Options.Clear();
        IsSearching = false;
        _selected = null;
        OnPropertyChanged(nameof(SelectedOption));
        OnPropertyChanged(nameof(SelectedRef));
        _suppressText = true;
        try
        {
            Text = string.Empty;
        }
        finally
        {
            _suppressText = false;
        }
    }

    private async Task SuggestSafelyAsync()
    {
        _suggestCancellation?.Cancel();
        _suggestCancellation?.Dispose();
        var cancellation = _suggestCancellation = new CancellationTokenSource();
        var query = _text.Trim();
        if (query.Length < MinQueryLength)
        {
            Options.Clear();
            return;
        }

        IsSearching = true;
        try
        {
            await _delay(Debounce, cancellation.Token);
            var items = await _search(query, cancellation.Token);
            if (cancellation.IsCancellationRequested)
            {
                return;
            }

            Options.Clear();
            foreach (var item in items)
            {
                Options.Add(WarehouseSuggestOption.From(item));
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            // Подсказки — вспомогательный поиск: ошибка показывается основным запросом.
            if (!cancellation.IsCancellationRequested)
            {
                Options.Clear();
            }
        }
        finally
        {
            if (ReferenceEquals(_suggestCancellation, cancellation))
            {
                IsSearching = false;
            }
        }
    }
}

/// <summary>Вариант подсказки справочника 1С («код — имя» / имя).</summary>
public sealed record WarehouseSuggestOption(string Ref, string Text)
{
    public static WarehouseSuggestOption From(HubWarehouse1cCatalogItem item)
    {
        var name = item.Name?.Trim() ?? string.Empty;
        var code = item.Code?.Trim() ?? string.Empty;
        var text = string.IsNullOrEmpty(code) ? name : $"{code} — {name}";
        return new WarehouseSuggestOption(item.Ref?.Trim() ?? string.Empty, text);
    }

    public override string ToString() => Text;
}

/// <summary>Строка таблицы остатков (форматирование как в веб-таблице).</summary>
public sealed class WarehouseBalanceRowViewModel
{
    public WarehouseBalanceRowViewModel(HubWarehouse1cBalance row, ICommand showMovements)
    {
        ArgumentNullException.ThrowIfNull(row);
        NomenclatureRef = row.NomenclatureRef?.Trim() ?? string.Empty;
        WarehouseRef = row.WarehouseRef?.Trim() ?? string.Empty;
        SeriesRef = row.SeriesRef?.Trim() ?? string.Empty;
        NomenclatureTitle = string.IsNullOrWhiteSpace(row.NomenclatureCode)
            ? row.NomenclatureName?.Trim() ?? string.Empty
            : $"{row.NomenclatureCode?.Trim()} — {row.NomenclatureName?.Trim()}";
        CharacteristicName = row.CharacteristicName?.Trim() ?? string.Empty;
        WarehouseName = row.WarehouseName?.Trim() ?? string.Empty;
        SeriesLabel = string.Join(" / ",
            new[] { row.SeriesName, row.SeriesNumber }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        BatchDocument = row.BatchDocumentName?.Trim() ?? string.Empty;
        BatchStatus = row.BatchStatusName?.Trim() ?? string.Empty;
        QtyText = WarehouseViewModel.FormatQty(row.QtyBalance);
        CostText = WarehouseViewModel.FormatMoney(row.CostBalance);
        CostAccountingText = WarehouseViewModel.FormatMoney(row.CostAccountingBalance);
        AvgPriceText = WarehouseViewModel.FormatNumber(row.AvgPrice);
        Torg12Text = string.Join(" ",
            new[] { row.Torg12Number, WarehouseViewModel.FormatDate(row.Torg12Date) }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        InvoiceText = string.Join(" ",
            new[] { row.InvoiceNumber, WarehouseViewModel.FormatDate(row.InvoiceDate) }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        ShowMovementsCommand = showMovements;
    }

    public string NomenclatureRef { get; }
    public string WarehouseRef { get; }
    public string SeriesRef { get; }
    public string NomenclatureTitle { get; }
    public string CharacteristicName { get; }
    public string WarehouseName { get; }
    public string SeriesLabel { get; }
    public string BatchDocument { get; }
    public string BatchStatus { get; }
    public string QtyText { get; }
    public string CostText { get; }
    public string CostAccountingText { get; }
    public string AvgPriceText { get; }
    public string Torg12Text { get; }
    public string InvoiceText { get; }
    public ICommand ShowMovementsCommand { get; }
}

/// <summary>Строка ведомости движений.</summary>
public sealed class WarehouseMovementRowViewModel
{
    public WarehouseMovementRowViewModel(HubWarehouse1cMovement row)
    {
        ArgumentNullException.ThrowIfNull(row);
        RegistrarRef = row.RegistrarRef?.Trim() ?? string.Empty;
        CanOpenDetail = row.CanOpenDetail || !string.IsNullOrWhiteSpace(RegistrarRef);
        PeriodText = WarehouseViewModel.FormatDate(row.Period);
        DocumentText = string.Join(" ",
            new[] { row.RegistrarNumber, row.RegistrarName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        WarehouseText = row.IsTransfer
            ? $"{row.TransferFromWarehouseName?.Trim()} → {row.TransferToWarehouseName?.Trim()}"
            : row.WarehouseName?.Trim() ?? string.Empty;
        QtyInText = WarehouseViewModel.FormatQty(row.QtyIn);
        QtyOutText = WarehouseViewModel.FormatQty(row.QtyOut);
        QtyEndText = WarehouseViewModel.FormatQty(row.QtyEnd);
        CostInText = WarehouseViewModel.FormatMoney(row.CostIn);
        CostOutText = WarehouseViewModel.FormatMoney(row.CostOut);
        CostEndText = WarehouseViewModel.FormatMoney(row.CostEnd);
        AvgPriceText = WarehouseViewModel.FormatNumber(row.AvgPriceEnd);
        Torg12Text = string.Join(" ",
            new[] { row.Torg12Number, WarehouseViewModel.FormatDate(row.Torg12Date) }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        InvoiceText = string.Join(" ",
            new[] { row.InvoiceNumber, WarehouseViewModel.FormatDate(row.InvoiceDate) }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    public string RegistrarRef { get; }
    public bool CanOpenDetail { get; }
    public string PeriodText { get; }
    public string DocumentText { get; }
    public string WarehouseText { get; }
    public string QtyInText { get; }
    public string QtyOutText { get; }
    public string QtyEndText { get; }
    public string CostInText { get; }
    public string CostOutText { get; }
    public string CostEndText { get; }
    public string AvgPriceText { get; }
    public string Torg12Text { get; }
    public string InvoiceText { get; }
}

/// <summary>Карточка документа-регистратора (movements/detail).</summary>
public sealed class WarehouseMovementDetailViewModel
{
    public WarehouseMovementDetailViewModel(
        HubWarehouse1cMovementDetail detail,
        Action<WarehouseMovementFileItemViewModel> downloadRequested)
    {
        ArgumentNullException.ThrowIfNull(detail);
        ArgumentNullException.ThrowIfNull(downloadRequested);
        Title = string.Join(" №",
            new[] { detail.DocumentTitle, detail.RegistrarNumber }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        if (string.IsNullOrWhiteSpace(Title))
        {
            Title = detail.RegistrarName?.Trim() ?? "Документ 1С";
        }

        DateText = WarehouseViewModel.FormatDate(detail.RegistrarDate);
        RouteText = detail.IsTransfer
            ? $"{detail.TransferFromWarehouseName?.Trim()} → {detail.TransferToWarehouseName?.Trim()}"
            : detail.WarehouseName?.Trim() ?? string.Empty;
        IsTransfer = detail.IsTransfer;
        CounterpartyText = detail.CounterpartyName?.Trim() ?? string.Empty;
        CommentText = detail.Comment?.Trim() ?? string.Empty;
        FilesMessage = detail.FilesMessage?.Trim() ?? string.Empty;
        foreach (var file in detail.Files ?? [])
        {
            Files.Add(new WarehouseMovementFileItemViewModel(file, downloadRequested));
        }

        HasFiles = Files.Count > 0;
    }

    public string Title { get; }
    public string DateText { get; }
    public string RouteText { get; }
    public bool IsTransfer { get; }
    public string CounterpartyText { get; }
    public string CommentText { get; }
    public string FilesMessage { get; }
    public bool HasFiles { get; }
    public ObservableCollection<WarehouseMovementFileItemViewModel> Files { get; } = [];
}

/// <summary>Файл документа 1С: имя, размер и команда выгрузки через SaveFileDialog.</summary>
public sealed class WarehouseMovementFileItemViewModel : ObservableObject
{
    private string _statusText = string.Empty;

    public WarehouseMovementFileItemViewModel(
        HubWarehouse1cMovementFile file,
        Action<WarehouseMovementFileItemViewModel> downloadRequested)
    {
        Ref = file.Ref?.Trim() ?? string.Empty;
        Name = file.Name?.Trim() ?? "file.bin";
        SizeText = file.Size >= 1024 * 1024
            ? $"{file.Size / 1024.0 / 1024.0:0.#} МБ"
            : file.Size >= 1024
                ? $"{file.Size / 1024.0:0.#} КБ"
                : $"{file.Size} Б";
        DownloadCommand = new NativeRelayCommand(() => downloadRequested(this));
    }

    public string Ref { get; }
    public string Name { get; }
    public string SizeText { get; }
    public ICommand DownloadCommand { get; }

    /// <summary>Итог выгрузки («сохранено как …» либо текст ошибки от View).</summary>
    public string StatusText
    {
        get => _statusText;
        set => SetProperty(ref _statusText, value);
    }

    public void MarkDownloaded(string? fileName) =>
        StatusText = string.IsNullOrWhiteSpace(fileName) ? "Сохранено" : $"Сохранено: {fileName}";
}

/// <summary>Склад уволенного сотрудника: владелец, суммы и остатки (в ответе).</summary>
public sealed class WarehouseDismissedItemViewModel
{
    public WarehouseDismissedItemViewModel(HubWarehouse1cDismissedWarehouse item)
    {
        ArgumentNullException.ThrowIfNull(item);
        WarehouseName = item.Warehouse?.Name?.Trim() ?? "Склад без названия";
        EmployeeName = item.EmployeeName?.Trim() ?? string.Empty;
        var metaParts = new[] { item.Position, item.Department, item.City }
            .Where(part => !string.IsNullOrWhiteSpace(part))
            .Select(part => part!.Trim())
            .ToList();
        var dismissal = WarehouseViewModel.FormatDate(item.DismissalDate);
        if (!string.IsNullOrWhiteSpace(dismissal))
        {
            metaParts.Add("уволен " + dismissal);
        }

        EmployeeMeta = string.Join(" · ", metaParts);
        EmploymentLabel = item.EmploymentLabel?.Trim() ?? string.Empty;
        IsAmbiguous = item.Ambiguous;
        CandidatesText = !item.Ambiguous || item.EmployeeCandidates is not { Count: > 0 }
            ? string.Empty
            : "Кандидаты: " + string.Join("; ",
                item.EmployeeCandidates
                    .Select(c => c.EmployeeName?.Trim() ?? string.Empty)
                    .Where(name => name.Length > 0));
        var totals = item.Totals;
        TotalsText = totals is null
            ? string.Empty
            : $"Позиций: {totals.Positions} · Кол-во: {WarehouseViewModel.FormatQty(totals.Qty)} · Σ {WarehouseViewModel.FormatMoney(totals.Cost)}";
        Balances = (item.Balances ?? [])
            .Select(row => new WarehouseBalanceRowViewModel(row, NullCommand.Instance))
            .ToList();
    }

    public string WarehouseName { get; }
    public string EmployeeName { get; }
    public string EmployeeMeta { get; }
    public string EmploymentLabel { get; }
    public bool IsAmbiguous { get; }
    public string CandidatesText { get; }
    public string TotalsText { get; }
    public IReadOnlyList<WarehouseBalanceRowViewModel> Balances { get; }

    /// <summary>Строкам остатков в карточке уволенного движение недоступно.</summary>
    private sealed class NullCommand : ICommand
    {
        internal static readonly NullCommand Instance = new();
        public event EventHandler? CanExecuteChanged { add { } remove { } }
        public bool CanExecute(object? parameter) => false;
        public void Execute(object? parameter) { }
    }
}
