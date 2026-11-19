using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Мои задачи» нативного шелла: список, фильтры, детали,
/// переходы по capabilities. Аутентификация — уровнем выше, в HubShellViewModel.
/// </summary>
public sealed class TasksViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    private TaskListItemViewModel? _selectedItem;
    private TaskDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private string _statusFilter = "all";
    private bool _isRefreshing;
    private bool _isLoadingMore;
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight realtime-загрузки.</summary>
    private int _loadEpoch;
    private int _total;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public TasksViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadTasksAsync(ct),
            ex => BannerErrorText = DescribeError(ex));
        SelectFilterCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                StatusFilter = parameter as string ?? "all";
                await LoadTasksAsync(ct);
            },
            ex => BannerErrorText = DescribeError(ex));
        TransitionCommand = new NativeAsyncCommand(
            (parameter, ct) => TransitionAsync(ParseTransition(parameter), ct),
            ex => DetailErrorText = DescribeError(ex),
            _ => Detail is { ActionsEnabled: true });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = DescribeError(ex),
            _ => HasMore && !IsRefreshing);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
        };
    }

    // ---- Список ----

    public ObservableCollection<TaskListItemViewModel> Items { get; } = [];

    public TaskListItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.Id);
            }
        }
    }

    public TaskDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set => SetProperty(ref _isDetailLoading, value);
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

    public string SearchText
    {
        get => _searchText;
        set => SetProperty(ref _searchText, value);
    }

    /// <summary>all|new|in_progress|review|done|overdue</summary>
    public string StatusFilter
    {
        get => _statusFilter;
        set
        {
            if (SetProperty(ref _statusFilter, value))
            {
                OnPropertyChanged(nameof(IsFilterAll));
                OnPropertyChanged(nameof(IsFilterNew));
                OnPropertyChanged(nameof(IsFilterInProgress));
                OnPropertyChanged(nameof(IsFilterReview));
                OnPropertyChanged(nameof(IsFilterDone));
                OnPropertyChanged(nameof(IsFilterOverdue));
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectFilterCommand.
    public bool IsFilterAll
    {
        get => StatusFilter == "all";
        set => ApplyFilterFromUi("all", value);
    }

    public bool IsFilterNew
    {
        get => StatusFilter == "new";
        set => ApplyFilterFromUi("new", value);
    }

    public bool IsFilterInProgress
    {
        get => StatusFilter == "in_progress";
        set => ApplyFilterFromUi("in_progress", value);
    }

    public bool IsFilterReview
    {
        get => StatusFilter == "review";
        set => ApplyFilterFromUi("review", value);
    }

    public bool IsFilterDone
    {
        get => StatusFilter == "done";
        set => ApplyFilterFromUi("done", value);
    }

    public bool IsFilterOverdue
    {
        get => StatusFilter == "overdue";
        set => ApplyFilterFromUi("overdue", value);
    }

    private void ApplyFilterFromUi(string filter, bool isChecked)
    {
        if (isChecked && StatusFilter != filter)
        {
            SelectFilterCommand.Execute(filter);
        }
    }

    public bool IsRefreshing
    {
        get => _isRefreshing;
        private set
        {
            if (SetProperty(ref _isRefreshing, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
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

    /// <summary>На сервере остались задачи за пределами загруженного списка.</summary>
    public bool HasMore => Items.Count < _total;

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

    /// <summary>Подпись кнопки «Показать ещё» с остатком по данным сервера.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : $"Показать ещё ({Math.Max(0, _total - Items.Count)})";

    public bool IsEmpty => !IsRefreshing && Items.Count == 0 && !HasBannerError;

    public ICommand RefreshCommand { get; }
    public ICommand SelectFilterCommand { get; }
    public ICommand TransitionCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand LoadMoreCommand { get; }

    private HubTaskQuery BuildQuery(int offset) => new()
    {
        Status = StatusFilter is "all" or "overdue" ? null : StatusFilter,
        DueState = StatusFilter == "overdue" ? "overdue" : null,
        Search = string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim(),
        SortBy = StatusFilter == "overdue" ? "due_at" : "status",
        SortDir = "asc",
        Offset = offset,
    };

    public async Task LoadTasksAsync(CancellationToken cancellationToken = default)
    {
        IsRefreshing = true;
        try
        {
            var page = await _api.GetMyTasksAsync(BuildQuery(0), cancellationToken);
            Items.Clear();
            _total = page.Total;
            foreach (var item in page.Items ?? [])
            {
                Items.Add(new TaskListItemViewModel(item));
            }

            TotalText = page.Total.ToString(CultureInfo.CurrentCulture);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Догрузка следующей страницы в конец списка («Показать ещё»).</summary>
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            var page = await _api.GetMyTasksAsync(BuildQuery(Items.Count), cancellationToken);
            _total = page.Total;
            foreach (var item in page.Items ?? [])
            {
                Items.Add(new TaskListItemViewModel(item));
            }

            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    /// <summary>
    /// Тихое обновление списка по realtime-событию (tasks.task.created/updated/
    /// deleted): та же выдача без IsRefreshing-индикатора и без сброса выбора —
    /// выбранная задача перевыбирается по id, что подтягивает свежую деталь.
    /// Серийная: события во время прохода сливаются в один повторный проход.
    /// Ошибки молчим — событие лишь подсказка, явное «Обновить» догонит состояние.
    /// </summary>
    public async Task RefreshFromRealtimeAsync(CancellationToken cancellationToken = default)
    {
        if (_realtimeRefreshInFlight)
        {
            _realtimeRefreshQueued = true;
            return;
        }

        _realtimeRefreshInFlight = true;
        try
        {
            do
            {
                _realtimeRefreshQueued = false;
                var epoch = _loadEpoch;
                try
                {
                    var selectedId = _selectedItem?.Id;
                    var page = await _api.GetMyTasksAsync(BuildQuery(0), cancellationToken);
                    if (epoch != _loadEpoch)
                    {
                        // Сессия сменилась (Reset) — чужие данные не применяем.
                        return;
                    }

                    Items.Clear();
                    _total = page.Total;
                    foreach (var item in page.Items ?? [])
                    {
                        Items.Add(new TaskListItemViewModel(item));
                    }

                    TotalText = page.Total.ToString(CultureInfo.CurrentCulture);
                    LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
                    BannerErrorText = null;
                    if (selectedId is not null)
                    {
                        var reselect = Items.FirstOrDefault(item => item.Id == selectedId);
                        if (reselect is not null)
                        {
                            // Сеттер перезагрузит открытую деталь свежей версией задачи.
                            SelectedItem = reselect;
                        }
                    }
                }
                catch
                {
                    // Тихая подсказка realtime: баннер не трогаем, Refresh догонит позже.
                }
            }
            while (_realtimeRefreshQueued);
        }
        finally
        {
            _realtimeRefreshInFlight = false;
        }
    }

    /// <summary>Навигация к задаче из других страниц: сбрасывает фильтры, находит и выбирает.</summary>
    public async Task SelectTaskByIdAsync(long taskId, CancellationToken cancellationToken = default)
    {
        var item = Items.FirstOrDefault(i => i.Id == taskId);
        if (item is null)
        {
            StatusFilter = "all";
            SearchText = string.Empty;
            await LoadTasksAsync(cancellationToken);
            item = Items.FirstOrDefault(i => i.Id == taskId);
        }

        // Глубокая ссылка на задачу за пределами первой страницы: догружаем, пока не найдём.
        for (var guard = 0; item is null && HasMore && guard < 20; guard++)
        {
            await LoadMoreAsync(cancellationToken);
            item = Items.FirstOrDefault(i => i.Id == taskId);
        }

        if (item is not null)
        {
            SelectedItem = item;
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при автономной инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _loadEpoch++;
        _realtimeRefreshQueued = false;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        SearchText = string.Empty;
        StatusFilter = "all";
        _total = 0;
        OnPropertyChanged(nameof(HasMore));
        OnPropertyChanged(nameof(MoreButtonText));
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoadingMore = false;
    }

    private async Task LoadDetailSafelyAsync(long taskId)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetTaskAsync(taskId, cancellation.Token);
            if (_selectedItem?.Id != taskId)
            {
                return;
            }

            if (Detail is null)
            {
                Detail = new TaskDetailViewModel(detail);
            }
            else
            {
                Detail.Update(detail);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            DetailErrorText = DescribeError(ex);
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    private async Task TransitionAsync(HubTaskTransition? transition, CancellationToken cancellationToken)
    {
        if (transition is null || Detail is null)
        {
            return;
        }

        var detail = Detail;
        detail.IsTransitioning = true;
        DetailErrorText = null;
        try
        {
            var updated = await _api.TransitionTaskAsync(
                detail.Id,
                transition.Value,
                detail.TransitionComment,
                cancellationToken);
            detail.Update(updated);
            detail.TransitionComment = null;
            var listItem = Items.FirstOrDefault(i => i.Id == updated.Id);
            listItem?.UpdateFrom(updated);
            if (!IsRefreshing)
            {
                _ = RefreshAfterTransitionAsync();
            }
        }
        catch (Exception ex)
        {
            DetailErrorText = DescribeError(ex);
        }
        finally
        {
            detail.IsTransitioning = false;
        }
    }

    private async Task RefreshAfterTransitionAsync()
    {
        try
        {
            await LoadTasksAsync(CancellationToken.None);
        }
        catch
        {
            // Ошибка обновления не критична: список уже оптимистично обновлён.
        }
    }

    private static HubTaskTransition? ParseTransition(object? parameter) =>
        parameter is string name && Enum.TryParse<HubTaskTransition>(name, ignoreCase: true, out var parsed)
            ? parsed
            : null;

    internal static string DescribeError(Exception exception) => exception switch
    {
        HubApiException { Kind: HubApiErrorKind.Transport } =>
            "Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
        HubApiException { Kind: HubApiErrorKind.SessionExpired } =>
            "Сессия истекла. Войдите заново.",
        HubApiException { StatusCode: System.Net.HttpStatusCode.Unauthorized } =>
            "Неверный логин или пароль.",
        HubApiException { StatusCode: System.Net.HttpStatusCode.Forbidden } =>
            "Недостаточно прав для этого действия.",
        HubApiException { StatusCode: System.Net.HttpStatusCode.TooManyRequests } =>
            "Слишком много попыток. Подождите минуту и повторите.",
        HubApiException apiEx when !string.IsNullOrWhiteSpace(apiEx.Message) =>
            apiEx.Message,
        _ => "Не удалось выполнить запрос. Повторите попытку.",
    };
}
