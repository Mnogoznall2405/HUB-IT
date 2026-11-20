using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Сотрудник в форме задачи: исполнитель (поиск) или контролёр (список).</summary>
public sealed class TaskUserOptionViewModel
{
    private TaskUserOptionViewModel(long userId, string title, string metaText)
    {
        UserId = userId;
        Title = title;
        MetaText = metaText;
        DisplayText = metaText.Length == 0 ? title : $"{title} · {metaText}";
    }

    /// <summary>id пользователя; 0 — заглушка «не выбран» (контролёр).</summary>
    public long UserId { get; }
    public string Title { get; }
    /// <summary>Вторая строка: подразделение из справочника задач.</summary>
    public string MetaText { get; }
    /// <summary>Однострочный текст для ComboBox.</summary>
    public string DisplayText { get; }

    public static TaskUserOptionViewModel FromItem(HubTaskUserItem user)
    {
        ArgumentNullException.ThrowIfNull(user);
        var title = (user.FullName ?? string.Empty).Trim();
        if (title.Length == 0)
        {
            title = (user.Username ?? string.Empty).Trim();
        }

        return new TaskUserOptionViewModel(
            user.Id,
            title.Length == 0 ? $"Пользователь {user.Id}" : title,
            (user.Department ?? string.Empty).Trim());
    }

    /// <summary>Пустой вариант для необязательного контролёра («Без контролёра»).</summary>
    public static TaskUserOptionViewModel Empty(string label) =>
        new(0, label, string.Empty);
}

/// <summary>
/// Поисковый селектор исполнителя: серверный GET /hub/users/assignees?q=
/// с debounce, как поиск сотрудника у заявок (≥2 символов, список-подсказка).
/// </summary>
public sealed class TaskUserSearchViewModel : ObservableObject
{
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);

    internal const int SearchMinLength = 2;
    internal const int SearchLimit = 30;

    private readonly IHubApiClient _api;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _searchCancellation;

    private string _query = string.Empty;
    private TaskUserOptionViewModel? _selected;
    private bool _isPopupOpen;
    private bool _isSearchBusy;

    public TaskUserSearchViewModel(
        IHubApiClient api,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _delayAsync = delayAsync ?? Task.Delay;

        SelectCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TaskUserOptionViewModel option)
            {
                ApplyOption(option);
            }
        });
        ClearCommand = new NativeRelayCommand(ClearSelection);
        Options.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasOptions));
    }

    /// <summary>Сбой поиска — форма показывает текст в своей плашке ошибок.</summary>
    public event EventHandler<Exception>? SearchFailed;

    /// <summary>Строка поиска: правка после выбора сбрасывает выбор и ищет заново.</summary>
    public string Query
    {
        get => _query;
        set
        {
            if (SetProperty(ref _query, value ?? string.Empty))
            {
                _selected = null;
                OnPropertyChanged(nameof(Selected));
                OnPropertyChanged(nameof(HasSelected));
                ScheduleSearch();
            }
        }
    }

    public ObservableCollection<TaskUserOptionViewModel> Options { get; } = [];

    public bool HasOptions => Options.Count > 0;

    /// <summary>Выбранный исполнитель; null — поле обязательного выбора пусто.</summary>
    public TaskUserOptionViewModel? Selected
    {
        get => _selected;
        private set
        {
            if (SetProperty(ref _selected, value))
            {
                OnPropertyChanged(nameof(HasSelected));
            }
        }
    }

    public bool HasSelected => Selected is not null;

    /// <summary>Popup подсказок; самозакрытие (StaysOpen=False) чистит список.</summary>
    public bool IsPopupOpen
    {
        get => _isPopupOpen;
        set
        {
            if (SetProperty(ref _isPopupOpen, value) && !value)
            {
                Options.Clear();
            }
        }
    }

    public bool IsSearchBusy
    {
        get => _isSearchBusy;
        private set => SetProperty(ref _isSearchBusy, value);
    }

    public ICommand SelectCommand { get; }
    public ICommand ClearCommand { get; }

    /// <summary>Сброс выбора и строки (форме перед повторным заполнением).</summary>
    public void ClearSelection()
    {
        _searchCancellation?.Cancel();
        _searchCancellation = null;
        Options.Clear();
        IsPopupOpen = false;
        _query = string.Empty;
        OnPropertyChanged(nameof(Query));
        Selected = null;
    }

    private void ApplyOption(TaskUserOptionViewModel option)
    {
        IsPopupOpen = false;
        Selected = option;
    }

    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var query = _query.Trim();
        if (query.Length < SearchMinLength)
        {
            _searchCancellation = null;
            IsPopupOpen = false;
            Options.Clear();
            return;
        }

        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        _ = SearchSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(SearchDebounce, cancellationToken);
            if (!string.Equals(_query.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            IsSearchBusy = true;
            var page = await _api.SearchTaskAssigneesAsync(query, SearchLimit, cancellationToken);
            if (!string.Equals(_query.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            Options.Clear();
            foreach (var user in page.Items ?? [])
            {
                Options.Add(TaskUserOptionViewModel.FromItem(user));
            }

            IsPopupOpen = Options.Count > 0;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            SearchFailed?.Invoke(this, exception);
        }
        finally
        {
            IsSearchBusy = false;
        }
    }
}

/// <summary>Проект в форме задачи: «Название (код)» — как у объектов заявок.</summary>
public sealed class TaskCreateProjectOption
{
    public TaskCreateProjectOption(HubTaskProject project)
    {
        ArgumentNullException.ThrowIfNull(project);
        Id = project.Id ?? string.Empty;
        var name = (project.Name ?? string.Empty).Trim();
        var code = (project.Code ?? string.Empty).Trim();
        DisplayName = (name.Length > 0, code.Length > 0) switch
        {
            (true, true) => $"{name} ({code})",
            (true, false) => name,
            (false, true) => code,
            _ => Id.Length == 0 ? "Проект" : Id,
        };
    }

    public string Id { get; }
    public string DisplayName { get; }
}

/// <summary>Объект проекта в форме задачи; фильтруется выбранным проектом.</summary>
public sealed class TaskCreateObjectOption
{
    public TaskCreateObjectOption(HubTaskObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id ?? string.Empty;
        ProjectId = item.ProjectId ?? string.Empty;
        var name = (item.Name ?? string.Empty).Trim();
        var code = (item.Code ?? string.Empty).Trim();
        DisplayName = (name.Length > 0, code.Length > 0) switch
        {
            (true, true) => $"{name} ({code})",
            (true, false) => name,
            (false, true) => code,
            _ => Id.Length == 0 ? "Объект" : Id,
        };
    }

    public string Id { get; }
    public string ProjectId { get; }
    public string DisplayName { get; }
}

/// <summary>Приоритет формы: low|normal|high|urgent — множество backend'а.</summary>
public sealed record TaskCreatePriorityOption(string Value, string Label);

/// <summary>Событие успешного создания задачи — родитель выбирает её в списке.</summary>
public sealed class TaskCreatedEventArgs : EventArgs
{
    public TaskCreatedEventArgs(HubTaskItem task)
    {
        Task = task;
    }

    public HubTaskItem Task { get; }
}

/// <summary>Событие успешного создания подзадачи — родитель перечитывает карточку.</summary>
public sealed class TaskSubtaskCreatedEventArgs : EventArgs
{
    public TaskSubtaskCreatedEventArgs(HubTaskDetail subtask)
    {
        Subtask = subtask;
    }

    public HubTaskDetail Subtask { get; }
}

/// <summary>
/// Панель «Новая задача» (оверлей, как композер у почты/заявка):
/// название, описание, исполнитель (поиск), контролёр, приоритет, срок,
/// проект и объект. Обязательные — название ≥3, исполнитель и проект
/// (project_id обязателен на backend).
/// </summary>
public sealed class TaskCreateViewModel : ObservableObject
{
    /// <summary>Минимум заголовка — как в backend («at least 3 characters»).</summary>
    internal const int MinTitleLength = 3;

    private readonly IHubApiClient _api;
    private readonly List<TaskCreateObjectOption> _objectsAll = [];

    private string _title = string.Empty;
    private string _description = string.Empty;
    private TaskUserOptionViewModel? _selectedController;
    private TaskCreatePriorityOption _selectedPriority;
    private DateTime? _dueDate;
    private TaskCreateProjectOption? _selectedProject;
    private TaskCreateObjectOption? _selectedObject;
    private bool _isBusy;
    private string? _errorText;

    public TaskCreateViewModel(
        IHubApiClient api,
        IEnumerable<HubTaskProject> projects,
        IEnumerable<HubTaskUserItem> controllers,
        IEnumerable<HubTaskObject> objects)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        ArgumentNullException.ThrowIfNull(projects);
        ArgumentNullException.ThrowIfNull(controllers);
        ArgumentNullException.ThrowIfNull(objects);

        foreach (var project in projects)
        {
            // Как в веб-справочнике: явно неактивные строки не показываем.
            if (project.IsActive != false)
            {
                Projects.Add(new TaskCreateProjectOption(project));
            }
        }

        // Первый пункт — «без контролёра»: поле необязательное, backend принимает null/0.
        Controllers.Add(TaskUserOptionViewModel.Empty("Без контролёра"));
        foreach (var controller in controllers)
        {
            if (controller.Id > 0)
            {
                Controllers.Add(TaskUserOptionViewModel.FromItem(controller));
            }
        }

        _selectedController = Controllers[0];
        _selectedPriority = PriorityOptions[1]; // normal — дефолт backend'а и веб-черновика.

        foreach (var item in objects)
        {
            if (item.IsActive != false)
            {
                _objectsAll.Add(new TaskCreateObjectOption(item));
            }
        }

        ApplyObjectFilter();

        AssigneeSearch = new TaskUserSearchViewModel(api);
        AssigneeSearch.SearchFailed += (_, exception) => ErrorText = TasksViewModel.DescribeError(exception);

        CreateCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
    }

    /// <summary>Задача создана: родитель вставляет/находит строку списка и выбирает её.</summary>
    public event EventHandler<TaskCreatedEventArgs>? Created;

    /// <summary>Закрытие панели без создания (Отмена/✕/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>Список приоритетов backend'а; «Средний» — normal.</summary>
    internal static IReadOnlyList<TaskCreatePriorityOption> PriorityOptions { get; } =
    [
        new("low", "Низкий"),
        new("normal", "Средний"),
        new("high", "Высокий"),
        new("urgent", "Срочный"),
    ];

    /// <summary>Экземплярное свойство для {Binding} — static в XAML не резолвится.</summary>
    public IReadOnlyList<TaskCreatePriorityOption> Priorities => PriorityOptions;

    // ---- Поля формы ----

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value ?? string.Empty);
    }

    public string Description
    {
        get => _description;
        set => SetProperty(ref _description, value ?? string.Empty);
    }

    /// <summary>Исполнитель * — серверный поиск /hub/users/assignees.</summary>
    public TaskUserSearchViewModel AssigneeSearch { get; }

    /// <summary>Контролёры из GET /hub/users/controllers + пункт «Без контролёра».</summary>
    public ObservableCollection<TaskUserOptionViewModel> Controllers { get; } = [];

    public TaskUserOptionViewModel? SelectedController
    {
        get => _selectedController;
        set => SetProperty(ref _selectedController, value);
    }

    public TaskCreatePriorityOption SelectedPriority
    {
        get => _selectedPriority;
        set => SetProperty(ref _selectedPriority, value ?? PriorityOptions[1]);
    }

    /// <summary>Срок — дата; на сервер уходит конец дня «yyyy-MM-ddT23:59».</summary>
    public DateTime? DueDate
    {
        get => _dueDate;
        set => SetProperty(ref _dueDate, value);
    }

    public ObservableCollection<TaskCreateProjectOption> Projects { get; } = [];

    /// <summary>Проект * (project_id обязателен на backend); смена фильтрует объекты.</summary>
    public TaskCreateProjectOption? SelectedProject
    {
        get => _selectedProject;
        set
        {
            if (SetProperty(ref _selectedProject, value))
            {
                OnPropertyChanged(nameof(HasSelectedProject));
                ApplyObjectFilter();
            }
        }
    }

    public bool HasSelectedProject => SelectedProject is not null;

    /// <summary>Объекты выбранного проекта (необязательно).</summary>
    public ObservableCollection<TaskCreateObjectOption> Objects { get; } = [];

    public TaskCreateObjectOption? SelectedObject
    {
        get => _selectedObject;
        set => SetProperty(ref _selectedObject, value);
    }

    // ---- Состояние ----

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(CreateButtonText));
                ((NativeAsyncCommand)CreateCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string CreateButtonText => IsBusy ? "Создаём…" : "Создать";

    /// <summary>Ошибка отправки/валидации — плашка внутри формы, поля не стираются.</summary>
    public string? ErrorText
    {
        get => _errorText;
        private set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public ICommand CreateCommand { get; }
    public ICommand CloseCommand { get; }

    // ---- Отправка ----

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        var title = Title.Trim();
        if (title.Length < MinTitleLength)
        {
            ErrorText = "Название — не короче 3 символов.";
            return;
        }

        var assignee = AssigneeSearch.Selected;
        if (assignee is null || assignee.UserId <= 0)
        {
            ErrorText = "Выберите исполнителя.";
            return;
        }

        var project = SelectedProject;
        if (project is null || project.Id.Length == 0)
        {
            ErrorText = "Выберите проект.";
            return;
        }

        IsBusy = true;
        try
        {
            var result = await _api.CreateTaskAsync(
                new HubTaskCreateRequest
                {
                    Title = title,
                    Description = TrimOrNull(Description),
                    AssigneeUserIds = [assignee.UserId],
                    ControllerUserId = SelectedController is { UserId: > 0 } controller
                        ? controller.UserId
                        : null,
                    DueAt = FormatDueAt(DueDate),
                    Priority = SelectedPriority.Value,
                    ProjectId = project.Id,
                    ObjectId = SelectedObject is { Id.Length: > 0 } selected ? selected.Id : null,
                    ProtocolDate = DateTime.Today.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                },
                cancellationToken);
            var created = result.Items?.FirstOrDefault();
            if (created is null)
            {
                ErrorText = "Сервер не вернул созданную задачу.";
                return;
            }

            Created?.Invoke(this, new TaskCreatedEventArgs(created));
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>Объекты только выбранного проекта; чужой выбор объекта снимаем.</summary>
    private void ApplyObjectFilter()
    {
        var projectId = SelectedProject?.Id;
        Objects.Clear();
        foreach (var item in _objectsAll)
        {
            if (projectId is not null
                && string.Equals(item.ProjectId, projectId, StringComparison.Ordinal))
            {
                Objects.Add(item);
            }
        }

        if (SelectedObject is not null
            && (projectId is null || SelectedObject.ProjectId != projectId))
        {
            SelectedObject = null;
        }
    }

    /// <summary>Дата → «yyyy-MM-ddT23:59» локальный naive (конец дня), пусто → null.</summary>
    internal static string? FormatDueAt(DateTime? value) =>
        value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + "T23:59";

    internal static string? TrimOrNull(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}

/// <summary>
/// Компактная форма «+ Подзадача» внутри карточки родителя:
/// название, исполнитель (тот же поиск), описание, срок, приоритет.
/// Проект/объект/подразделение/контролёр наследуются от родителя на backend'е.
/// </summary>
public sealed class TaskSubtaskCreateViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly long _parentTaskId;

    private string _title = string.Empty;
    private string _description = string.Empty;
    private TaskCreatePriorityOption _selectedPriority;
    private DateTime? _dueDate;
    private bool _isBusy;
    private string? _errorText;

    public TaskSubtaskCreateViewModel(IHubApiClient api, long parentTaskId)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _parentTaskId = parentTaskId;
        _selectedPriority = TaskCreateViewModel.PriorityOptions[1];

        AssigneeSearch = new TaskUserSearchViewModel(api);
        AssigneeSearch.SearchFailed += (_, exception) => ErrorText = TasksViewModel.DescribeError(exception);

        CreateCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
    }

    /// <summary>Подзадача создана: родитель перечитывает карточку (счётчики и список).</summary>
    public event EventHandler<TaskSubtaskCreatedEventArgs>? Created;

    /// <summary>Закрытие формы без создания — решает родитель.</summary>
    public event EventHandler? Closed;

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value ?? string.Empty);
    }

    public string Description
    {
        get => _description;
        set => SetProperty(ref _description, value ?? string.Empty);
    }

    public TaskUserSearchViewModel AssigneeSearch { get; }

    public IReadOnlyList<TaskCreatePriorityOption> Priorities => TaskCreateViewModel.PriorityOptions;

    public TaskCreatePriorityOption SelectedPriority
    {
        get => _selectedPriority;
        set => SetProperty(ref _selectedPriority, value ?? Priorities[1]);
    }

    public DateTime? DueDate
    {
        get => _dueDate;
        set => SetProperty(ref _dueDate, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(CreateButtonText));
                ((NativeAsyncCommand)CreateCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string CreateButtonText => IsBusy ? "Создаём…" : "Создать";

    public string? ErrorText
    {
        get => _errorText;
        private set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public ICommand CreateCommand { get; }
    public ICommand CloseCommand { get; }

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        var title = Title.Trim();
        if (title.Length < TaskCreateViewModel.MinTitleLength)
        {
            ErrorText = "Название — не короче 3 символов.";
            return;
        }

        var assignee = AssigneeSearch.Selected;
        if (assignee is null || assignee.UserId <= 0)
        {
            ErrorText = "Выберите исполнителя.";
            return;
        }

        IsBusy = true;
        try
        {
            var created = await _api.CreateSubtaskAsync(
                _parentTaskId,
                new HubTaskSubtaskCreateRequest
                {
                    Title = title,
                    Description = TaskCreateViewModel.TrimOrNull(Description),
                    AssigneeUserIds = [assignee.UserId],
                    DueAt = TaskCreateViewModel.FormatDueAt(DueDate),
                    Priority = SelectedPriority.Value,
                },
                cancellationToken);
            Created?.Invoke(this, new TaskSubtaskCreatedEventArgs(created));
        }
        finally
        {
            IsBusy = false;
        }
    }
}
