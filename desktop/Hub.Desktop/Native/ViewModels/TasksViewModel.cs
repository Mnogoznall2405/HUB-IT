using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Мои задачи» нативного шелла: список, фильтры, детали,
/// переходы по capabilities. Аутентификация — уровнем выше, в HubShellViewModel.
/// </summary>
public sealed class TasksViewModel : ObservableObject
{
    /// <summary>Расширения, которые принимает POST …/attachments (ALLOWED_UPLOAD_EXTENSIONS).</summary>
    internal static readonly HashSet<string> AllowedAttachmentExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
        ".jpg", ".jpeg", ".png", ".txt", ".zip",
    };

    /// <summary>MAX_TASK_ATTACHMENT_FILE_BYTES backend'а.</summary>
    internal const long MaxAttachmentFileBytes = 20L * 1024 * 1024;

    /// <summary>Режимы просмотра — значения CommandParameter чипов в тулбаре.</summary>
    private const string ViewModeList = "list";
    private const string ViewModeAnalytics = "analytics";

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    /// <summary>Вложения, которые скачиваются прямо сейчас — второй клик не дублирует запрос.</summary>
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);

    /// <summary>Чип со взведённым подтверждением удаления — одновременно один.</summary>
    private TaskAttachmentItemViewModel? _armedAttachmentDelete;

    private TaskListItemViewModel? _selectedItem;
    private TaskDetailViewModel? _detail;
    private TaskCreateViewModel? _create;
    private bool _permissionsLoaded;
    private bool _canCreateTasks;
    private bool _createDirectoriesLoaded;
    private List<HubTaskProject>? _createProjects;
    private List<HubTaskUserItem>? _createControllers;
    private List<HubTaskObject>? _createObjects;
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
    private string _viewMode = ViewModeList;

    public TasksViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        Analytics = new TaskAnalyticsViewModel(api);

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => RefreshActiveModeAsync(ct),
            ex => BannerErrorText = DescribeError(ex));
        SelectViewModeCommand = new NativeRelayCommand(
            parameter => ViewMode = parameter as string ?? ViewModeList);
        NewTaskCommand = new NativeAsyncCommand(
            (_, ct) => OpenCreateAsync(ct),
            ex => BannerErrorText = DescribeError(ex),
            _ => CanCreateTasks);
        AddSubtaskCommand = new NativeRelayCommand(
            OpenSubtaskForm,
            () => Detail is { CanCreateSubtask: true, IsSubtaskFormOpen: false });
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
        SendCommentCommand = new NativeAsyncCommand(
            (_, ct) => SendCommentAsync(ct),
            ex => DetailErrorText = DescribeError(ex),
            _ => Detail is { CanSendComment: true });
        AttachFilesCommand = new NativeAsyncCommand(
            (_, ct) => AttachFilesAsync(ct),
            ex => DetailErrorText = DescribeError(ex),
            _ => Detail is { CanAttach: true });
        OpenAttachmentCommand = new NativeAsyncCommand(
            (parameter, _) => OpenAttachmentAsync(parameter as TaskAttachmentItemViewModel),
            ex => DetailErrorText = DescribeError(ex),
            parameter => parameter is TaskAttachmentItemViewModel { IsDownloading: false });
        PreviewAttachmentCommand = new NativeAsyncCommand(
            (parameter, _) => PreviewAttachmentAsync(parameter as TaskAttachmentItemViewModel),
            ex => DetailErrorText = DescribeError(ex),
            parameter => parameter is TaskAttachmentItemViewModel { CanPreview: true, IsDownloading: false });
        DeleteAttachmentCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteAttachmentAsync(parameter as TaskAttachmentItemViewModel, ct),
            ex => DetailErrorText = DescribeError(ex),
            parameter => parameter is TaskAttachmentItemViewModel { CanDelete: true });
        OpenDiscussionCommand = new NativeAsyncCommand(
            (_, ct) => OpenDiscussionAsync(ct),
            ex => DetailErrorText = DescribeError(ex),
            _ => Detail is { CanOpenDiscussionNow: true });
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
        };
    }

    // ---- Режим просмотра: Список | Аналитика ----

    /// <summary>Отчётная панель «Аналитика» — лениво активируется из ViewMode.</summary>
    public TaskAnalyticsViewModel Analytics { get; }

    /// <summary>Текущий режим: list|analytics (чипы в тулбаре, как у билетов).</summary>
    public string ViewMode
    {
        get => _viewMode;
        private set
        {
            var normalized = value is ViewModeAnalytics ? value : ViewModeList;
            if (SetProperty(ref _viewMode, normalized))
            {
                OnPropertyChanged(nameof(IsListMode));
                OnPropertyChanged(nameof(IsAnalyticsMode));
                // Ленивая загрузка отчёта при первом входе в режим.
                if (normalized == ViewModeAnalytics)
                {
                    _ = Analytics.ActivateAsync(CancellationToken.None);
                }
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectViewModeCommand.
    /// <summary>Режим «Список»: фильтры + карточки задач + деталь.</summary>
    public bool IsListMode
    {
        get => _viewMode == ViewModeList;
        set
        {
            if (value)
            {
                SelectViewModeCommand.Execute(ViewModeList);
            }
        }
    }

    /// <summary>Режим «Аналитика»: KPI + разрезы + динамика задач.</summary>
    public bool IsAnalyticsMode
    {
        get => _viewMode == ViewModeAnalytics;
        set
        {
            if (value)
            {
                SelectViewModeCommand.Execute(ViewModeAnalytics);
            }
        }
    }

    /// <summary>«Обновить» тулбара: грузит данные активного режима.</summary>
    private Task RefreshActiveModeAsync(CancellationToken cancellationToken) =>
        _viewMode == ViewModeAnalytics
            ? Analytics.RefreshAsync(cancellationToken)
            : LoadTasksAsync(cancellationToken);

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
            if (_detail is not null)
            {
                _detail.PropertyChanged -= Detail_PropertyChanged;
            }

            // Взведённое «✕» относится к чипам старой карточки — снимаем.
            _armedAttachmentDelete = null;
            if (SetProperty(ref _detail, value))
            {
                if (value is not null)
                {
                    value.PropertyChanged += Detail_PropertyChanged;
                }

                OnPropertyChanged(nameof(HasDetail));
                RaiseCommandStates();
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Панель создания задачи (оверлей); null — форма закрыта.</summary>
    public TaskCreateViewModel? Create
    {
        get => _create;
        private set
        {
            if (SetProperty(ref _create, value))
            {
                OnPropertyChanged(nameof(IsCreateOpen));
            }
        }
    }

    public bool IsCreateOpen => Create is not null;

    /// <summary>
    /// «＋ Новая задача» видна с правом tasks.create или tasks.write
    /// (require_any_permission роута POST /hub/tasks; admin — всегда).
    /// Грузится из /auth/me лениво первой загрузкой списка.
    /// </summary>
    public bool CanCreateTasks
    {
        get => _canCreateTasks;
        private set
        {
            if (SetProperty(ref _canCreateTasks, value))
            {
                ((NativeAsyncCommand)NewTaskCommand).RaiseCanExecuteChanged();
            }
        }
    }

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
    public ICommand SelectViewModeCommand { get; }
    public ICommand NewTaskCommand { get; }
    public ICommand AddSubtaskCommand { get; }
    public ICommand SelectFilterCommand { get; }
    public ICommand TransitionCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand SendCommentCommand { get; }
    public ICommand AttachFilesCommand { get; }
    public ICommand OpenAttachmentCommand { get; }
    public ICommand PreviewAttachmentCommand { get; }
    public ICommand DeleteAttachmentCommand { get; }
    public ICommand OpenDiscussionCommand { get; }

    /// <summary>
    /// Шов выбора файлов для «📎 Прикрепить» карточки (как DetailFilePicker у билетов):
    /// view ставит OpenFileDialog, тесты — заглушку с путями. null — пустой список.
    /// </summary>
    public Func<IReadOnlyList<string>>? DetailFilePicker { get; set; }

    /// <summary>
    /// Шов сохранения/открытия вложения (как AttachmentSaver у билетов): тесты заменяют
    /// потоковое скачивание в %TEMP% + Process.Start. Аргументы — чип и id задачи.
    /// </summary>
    public Func<TaskAttachmentItemViewModel, long, Task>? AttachmentSaver { get; set; }

    /// <summary>Шов для «👁» PDF-превью вложения — то же назначение, что AttachmentSaver.</summary>
    public Func<TaskAttachmentItemViewModel, long, Task>? AttachmentPreviewSaver { get; set; }

    /// <summary>
    /// Шов перехода в чат-обсуждение задачи: shell подставляет навигацию
    /// «страница Чат + выбор разговора», тесты — запись conversation_id.
    /// </summary>
    public Func<string, CancellationToken, Task>? DiscussionNavigator { get; set; }

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
            // Кнопка «＋ Новая задача»: права из /auth/me — один раз за сессию.
            await EnsurePermissionsAsync(cancellationToken);
        }
        finally
        {
            IsRefreshing = false;
        }
    }

    /// <summary>Права страницы из /auth/me; сбой — кнопка создания скрыта (как у билетов).</summary>
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
            var isAdmin = string.Equals(user.Role?.Trim(), "admin", StringComparison.OrdinalIgnoreCase);
            CanCreateTasks = isAdmin
                || user.Permissions?.Contains("tasks.create") == true
                || user.Permissions?.Contains("tasks.write") == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            CanCreateTasks = false;
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
        _armedAttachmentDelete = null;
        _attachmentDownloadsInFlight.Clear();
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        CloseCreate();
        _permissionsLoaded = false;
        CanCreateTasks = false;
        _createDirectoriesLoaded = false;
        _createProjects = null;
        _createControllers = null;
        _createObjects = null;
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
        Analytics.Reset();
        _viewMode = ViewModeList;
        OnPropertyChanged(nameof(ViewMode));
        OnPropertyChanged(nameof(IsListMode));
        OnPropertyChanged(nameof(IsAnalyticsMode));
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

            // Update пересоздал чипы вложений — взведённое «✕» относилось к старым.
            _armedAttachmentDelete = null;

            // Лента комментариев — отдельным запросом: сбой помечает только секцию.
            await LoadCommentsSafelyAsync(taskId, cancellation.Token);
            await MarkTaskCommentsSeenSafelyAsync(taskId, cancellation.Token);
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

    /// <summary>
    /// GET …/comments: сбой помечает только секцию (CommentsFailed) — карточка,
    /// вложения и переходы не страдают (паттерн LoadHistorySafelyAsync у билетов).
    /// </summary>
    private async Task LoadCommentsSafelyAsync(long taskId, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.Id != taskId)
        {
            return;
        }

        try
        {
            var list = await _api.GetTaskCommentsAsync(taskId, cancellationToken);
            if (_selectedItem?.Id == taskId && Detail?.Id == taskId)
            {
                Detail.SetComments(list.Items ?? []);
                Detail.CommentsFailed = false;
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            if (_selectedItem?.Id == taskId && Detail?.Id == taskId)
            {
                Detail.CommentsFailed = true;
            }
        }
    }

    /// <summary>
    /// Открытие карточки с непрочитанными комментариями → POST …/comments/mark-seen
    /// (backend гасит и task.comment_added-уведомления). Best-effort: ошибки молчим —
    /// при следующем открытии попытка повторится.
    /// </summary>
    private async Task MarkTaskCommentsSeenSafelyAsync(long taskId, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.Id != taskId || !detail.HasUnreadComments)
        {
            return;
        }

        try
        {
            await _api.MarkTaskCommentsSeenAsync(taskId, cancellationToken);
            detail.MarkCommentsSeen();
            _selectedItem?.MarkCommentsRead();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Авто-отметка не обязана успевать: карточка уже открыта и жива.
        }
    }

    // ---- Создание задачи и подзадач ----

    /// <summary>
    /// «＋ Новая задача»: справочники (проекты/контролёры/объекты) грузятся один
    /// раз за сессию, затем открывается оверлей-форма. Ошибки — баннером списка.
    /// </summary>
    private async Task OpenCreateAsync(CancellationToken cancellationToken)
    {
        if (Create is not null || !CanCreateTasks)
        {
            return;
        }

        await EnsureCreateDirectoriesAsync(cancellationToken);
        var create = new TaskCreateViewModel(
            _api,
            _createProjects ?? [],
            _createControllers ?? [],
            _createObjects ?? []);
        create.Created += Create_Created;
        create.Closed += Create_Closed;
        Create = create;
    }

    /// <summary>Ленивая загрузка справочников формы: GET task-projects/controllers/objects.</summary>
    private async Task EnsureCreateDirectoriesAsync(CancellationToken cancellationToken)
    {
        if (_createDirectoriesLoaded)
        {
            return;
        }

        var projects = await _api.GetTaskProjectsAsync(cancellationToken);
        var controllers = await _api.GetTaskControllersAsync(cancellationToken);
        var objects = await _api.GetTaskObjectsAsync(null, cancellationToken);
        _createProjects = [.. projects.Items ?? []];
        _createControllers = [.. controllers.Items ?? []];
        _createObjects = [.. objects.Items ?? []];
        _createDirectoriesLoaded = true;
    }

    /// <summary>Форма создала задачу: закрыть оверлей и выбрать её в списке.</summary>
    private void Create_Created(object? sender, TaskCreatedEventArgs e)
    {
        Create = null;
        // Свежесозданная попадает в выдачу scope=my — повторная загрузка + выбор по id.
        _ = SelectTaskByIdAsync(e.Task.Id);
    }

    /// <summary>Форма закрыта без создания (Отмена/✕/Esc) — просто гасим оверлей.</summary>
    private void Create_Closed(object? sender, EventArgs e)
    {
        CloseCreate();
    }

    /// <summary>Гасит оверлей и отписывается от формы (Reset тоже идёт сюда).</summary>
    private void CloseCreate()
    {
        if (Create is { } create)
        {
            create.Created -= Create_Created;
            create.Closed -= Create_Closed;
            Create = null;
        }
    }

    /// <summary>
    /// «＋ Подзадача» в карточке: компактная форма внутри секции «Подзадачи».
    /// Видна только при can_create_subtask; повторное нажатие не плодит форм.
    /// </summary>
    private void OpenSubtaskForm()
    {
        var detail = Detail;
        if (detail is null || !detail.CanCreateSubtask || detail.SubtaskForm is not null)
        {
            return;
        }

        var form = new TaskSubtaskCreateViewModel(_api, detail.Id);
        form.Created += SubtaskForm_Created;
        form.Closed += SubtaskForm_Closed;
        detail.SubtaskForm = form;
    }

    /// <summary>
    /// Подзадача создана: форма закрывается, карточка родителя перечитывается
    /// (detail.subtasks + счётчики), список — тихо (subtasks_total в строке).
    /// </summary>
    private void SubtaskForm_Created(object? sender, TaskSubtaskCreatedEventArgs e)
    {
        var detail = Detail;
        CloseSubtaskForm(detail);
        if (detail is not null)
        {
            _ = LoadDetailSafelyAsync(detail.Id);
        }

        if (!IsRefreshing)
        {
            _ = RefreshAfterTransitionAsync();
        }
    }

    private void SubtaskForm_Closed(object? sender, EventArgs e)
    {
        CloseSubtaskForm(Detail);
    }

    private void CloseSubtaskForm(TaskDetailViewModel? detail)
    {
        if (detail?.SubtaskForm is { } form)
        {
            form.Created -= SubtaskForm_Created;
            form.Closed -= SubtaskForm_Closed;
            detail.SubtaskForm = null;
        }
    }

    // ---- Комментарии ----

    private async Task SendCommentAsync(CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.IsCommentBusy)
        {
            return;
        }

        var text = detail.CommentText?.Trim() ?? string.Empty;
        if (text.Length == 0)
        {
            return;
        }

        detail.IsCommentBusy = true;
        DetailErrorText = null;
        try
        {
            var comment = await _api.AddTaskCommentAsync(detail.Id, text, cancellationToken);
            detail.AppendComment(comment);
            detail.CommentText = string.Empty;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            // В т.ч. 400 use_task_discussion_chat — текст и карточка сохраняются.
            DetailErrorText = DescribeError(ex);
        }
        finally
        {
            detail.IsCommentBusy = false;
        }
    }

    /// <summary>
    /// «Обсудить в чате»: POST …/discussion создаёт/открывает разговор kind=task,
    /// conversation_id уходит в шов навигации (страница Чат). 404 флага/403 прав —
    /// текстом в карточке.
    /// </summary>
    private async Task OpenDiscussionAsync(CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.IsDiscussionBusy)
        {
            return;
        }

        detail.IsDiscussionBusy = true;
        DetailErrorText = null;
        try
        {
            var discussion = await _api.OpenTaskDiscussionAsync(detail.Id, cancellationToken);
            var conversationId = discussion.ConversationId?.Trim() ?? string.Empty;
            if (conversationId.Length == 0 || DiscussionNavigator is null)
            {
                DetailErrorText = "Обсуждение недоступно.";
                return;
            }

            await DiscussionNavigator(conversationId, cancellationToken);
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
            detail.IsDiscussionBusy = false;
        }
    }

    // ---- Вложения ----

    /// <summary>Чип вложения нажат: скачиваем в %TEMP%/hub-desktop/tasks и открываем ОС.</summary>
    private async Task OpenAttachmentAsync(TaskAttachmentItemViewModel? item)
    {
        var taskId = Detail?.Id;
        if (item is null || taskId is not { } id || string.IsNullOrEmpty(item.AttachmentId))
        {
            return;
        }

        var downloadKey = id + ":" + item.AttachmentId;
        if (!_attachmentDownloadsInFlight.Add(downloadKey))
        {
            // Уже качается — второй FileStream на том же target дал бы «файл занят».
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (AttachmentSaver is not null)
            {
                await AttachmentSaver(item, id);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "tasks");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "attachment.bin";
            }

            var target = Path.Combine(directory, $"{item.AttachmentId}-{safeName}");
            var cached = File.Exists(target) && new FileInfo(target).Length == item.Model.FileSize;
            if (!cached)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadTaskAttachmentAsync(
                    id, item.AttachmentId, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var renamed = Path.Combine(directory, $"{item.AttachmentId}-{downloadedName}");
                    if (!string.Equals(renamed, target, StringComparison.OrdinalIgnoreCase))
                    {
                        if (File.Exists(renamed))
                        {
                            File.Delete(renamed);
                        }

                        try
                        {
                            File.Move(target, renamed);
                            target = renamed;
                        }
                        catch (IOException)
                        {
                        }
                    }
                }
            }

            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            DetailErrorText = DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    /// <summary>«👁» у Office-чипа: preview/pdf → временный PDF и открыть системным вьювером.</summary>
    private async Task PreviewAttachmentAsync(TaskAttachmentItemViewModel? item)
    {
        var taskId = Detail?.Id;
        if (item is null || taskId is not { } id || !item.CanPreview
            || string.IsNullOrEmpty(item.AttachmentId))
        {
            return;
        }

        var downloadKey = "preview:" + id + ":" + item.AttachmentId;
        if (!_attachmentDownloadsInFlight.Add(downloadKey))
        {
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (AttachmentPreviewSaver is not null)
            {
                await AttachmentPreviewSaver(item, id);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "tasks");
            Directory.CreateDirectory(directory);
            // PDF превью всегда перекачиваем: серверная копия могла перегенерироваться.
            var target = Path.Combine(directory, $"{item.AttachmentId}-preview.pdf");
            string downloadedName;
            await using (var destination = new FileStream(
                target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true))
            {
                downloadedName = await _api.DownloadTaskAttachmentPreviewPdfAsync(
                    id, item.AttachmentId, destination, CancellationToken.None);
            }

            // Поток закрыт — переименование по имени из Content-Disposition теперь возможно.
            if (!string.IsNullOrWhiteSpace(downloadedName))
            {
                var renamed = Path.Combine(directory, $"{item.AttachmentId}-{downloadedName}");
                if (!string.Equals(renamed, target, StringComparison.OrdinalIgnoreCase))
                {
                    if (File.Exists(renamed))
                    {
                        File.Delete(renamed);
                    }

                    try
                    {
                        File.Move(target, renamed);
                        target = renamed;
                    }
                    catch (IOException)
                    {
                    }
                }
            }

            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            DetailErrorText = DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    /// <summary>
    /// «📎 Прикрепить»: лимиты backend'а (расширения из ALLOWED_UPLOAD_EXTENSIONS, 20 МБ);
    /// каждый файл — POST …/attachments, чип дописывается в секцию.
    /// Сбои — текстом в карточке, карточка жива.
    /// </summary>
    private async Task AttachFilesAsync(CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || !detail.CanAttach)
        {
            return;
        }

        var paths = DetailFilePicker?.Invoke() ?? [];
        if (paths.Count == 0)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsAttachmentBusy = true;
        var failed = new List<string>();
        try
        {
            foreach (var rawPath in paths)
            {
                var path = rawPath?.Trim();
                if (string.IsNullOrEmpty(path))
                {
                    continue;
                }

                var name = Path.GetFileName(path);
                var extension = Path.GetExtension(name);
                if (!AllowedAttachmentExtensions.Contains(extension))
                {
                    failed.Add($"{name} (формат не поддерживается)");
                    continue;
                }

                var size = File.Exists(path) ? new FileInfo(path).Length : -1;
                if (size < 0)
                {
                    failed.Add($"{name} (файл недоступен)");
                    continue;
                }

                if (size > MaxAttachmentFileBytes)
                {
                    failed.Add($"{name} (больше 20 МБ)");
                    continue;
                }

                try
                {
                    await using var stream = new FileStream(
                        path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
                    var uploaded = await _api.UploadTaskAttachmentAsync(
                        detail.Id, name, stream, mimeType: null, cancellationToken);
                    detail.AppendAttachment(uploaded);
                }
                catch (OperationCanceledException)
                {
                    throw;
                }
                catch (Exception exception)
                {
                    failed.Add($"{name} ({DescribeError(exception)})");
                }
            }
        }
        finally
        {
            detail.IsAttachmentBusy = false;
        }

        if (failed.Count > 0)
        {
            DetailErrorText = "Не удалось загрузить: " + string.Join(", ", failed);
        }
    }

    /// <summary>
    /// «✕» у чипа: первое нажатие взводит подтверждение (как у билетов), второе —
    /// DELETE …/attachments/{id} и локальное снятие чипа. Удаление доступно только
    /// scope=task (отчётные/generated файлы backend не удаляет).
    /// </summary>
    private async Task DeleteAttachmentAsync(
        TaskAttachmentItemViewModel? item,
        CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (item is null
            || detail is null
            || !item.CanDelete
            || item.IsDeleteBusy
            || string.IsNullOrEmpty(item.AttachmentId))
        {
            return;
        }

        if (!item.DeleteArmed)
        {
            ArmAttachmentDelete(item);
            return;
        }

        item.DeleteArmed = false;
        _armedAttachmentDelete = null;
        item.IsDeleteBusy = true;
        DetailErrorText = null;
        try
        {
            await _api.DeleteTaskAttachmentAsync(detail.Id, item.AttachmentId, cancellationToken);
            detail.Attachments.Remove(item);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            DetailErrorText = DescribeError(exception);
        }
        finally
        {
            item.IsDeleteBusy = false;
        }
    }

    /// <summary>Armed-нажатие только у одного чипа: новое снимает предыдущее.</summary>
    private void ArmAttachmentDelete(TaskAttachmentItemViewModel item)
    {
        if (_armedAttachmentDelete is { } previous && !ReferenceEquals(previous, item))
        {
            previous.DeleteArmed = false;
        }

        _armedAttachmentDelete = item;
        item.DeleteArmed = true;
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
            // Update пересоздал чипы вложений — взведённое «✕» умерло вместе с ними.
            _armedAttachmentDelete = null;
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

    private void Detail_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is null
            or nameof(TaskDetailViewModel.CanSendComment)
            or nameof(TaskDetailViewModel.CanAttach)
            or nameof(TaskDetailViewModel.CanOpenDiscussionNow)
            or nameof(TaskDetailViewModel.CanCreateSubtask)
            or nameof(TaskDetailViewModel.IsSubtaskFormOpen))
        {
            RaiseCommandStates();
        }
    }

    private void RaiseCommandStates()
    {
        (SendCommentCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (AttachFilesCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (OpenAttachmentCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (PreviewAttachmentCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (DeleteAttachmentCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (OpenDiscussionCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (TransitionCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (AddSubtaskCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
    }

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
