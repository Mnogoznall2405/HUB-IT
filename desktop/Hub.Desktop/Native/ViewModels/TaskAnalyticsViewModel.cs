using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Пресет периода аналитики: 7/30/90 дней (как quick-пресеты веб-страницы).</summary>
public sealed record TaskAnalyticsPresetOption(string Value, string Label);

/// <summary>Поле даты фильтра (date_basis контракта backend'а).</summary>
public sealed record TaskAnalyticsDateBasisOption(string Value, string Label);

/// <summary>
/// Вариант фильтра аналитики: проект/объект (TEXT uuid справочников задач)
/// или участник (int id пользователя; Id хранится строкой для единообразия).
/// </summary>
public sealed class TaskAnalyticsFilterOption
{
    public TaskAnalyticsFilterOption(string kind, string id, string title)
    {
        Kind = kind;
        Id = id;
        Title = title;
    }

    /// <summary>project|object|participant — по kind родительский VM раскладывает чипы.</summary>
    public string Kind { get; }

    public string Id { get; }

    public string Title { get; }

    public static TaskAnalyticsFilterOption ForProject(HubTaskProject project)
    {
        ArgumentNullException.ThrowIfNull(project);
        var name = (project.Name ?? string.Empty).Trim();
        var code = (project.Code ?? string.Empty).Trim();
        var title = (name.Length > 0, code.Length > 0) switch
        {
            (true, true) => $"{name} ({code})",
            (true, false) => name,
            (false, true) => code,
            _ => project.Id ?? "Проект",
        };
        return new TaskAnalyticsFilterOption("project", project.Id ?? string.Empty, title);
    }

    public static TaskAnalyticsFilterOption ForObject(HubTaskObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var name = (item.Name ?? string.Empty).Trim();
        var code = (item.Code ?? string.Empty).Trim();
        var title = (name.Length > 0, code.Length > 0) switch
        {
            (true, true) => $"{name} ({code})",
            (true, false) => name,
            (false, true) => code,
            _ => item.Id ?? "Объект",
        };
        return new TaskAnalyticsFilterOption("object", item.Id ?? string.Empty, title);
    }

    public static TaskAnalyticsFilterOption ForParticipant(HubTaskUserItem user)
    {
        ArgumentNullException.ThrowIfNull(user);
        var title = (user.FullName ?? string.Empty).Trim();
        if (title.Length == 0)
        {
            title = (user.Username ?? string.Empty).Trim();
        }

        if (title.Length == 0)
        {
            title = $"Пользователь {user.Id}";
        }

        var department = (user.Department ?? string.Empty).Trim();
        if (department.Length > 0)
        {
            title += $" · {department}";
        }

        return new TaskAnalyticsFilterOption(
            "participant", user.Id.ToString(CultureInfo.InvariantCulture), title);
    }
}

/// <summary>KPI-карточка отчёта: заголовок + значение + подсказка + тон (как KPI-грид веба).</summary>
public sealed class TaskAnalyticsKpiViewModel
{
    public TaskAnalyticsKpiViewModel(string title, string value, string helperText, string tone)
    {
        Title = title;
        Value = value;
        HelperText = helperText;
        Tone = tone;
    }

    public string Title { get; }
    public string Value { get; }
    public string HelperText { get; }
    /// <summary>Тон значения — строковый контракт local:HubTone (info/warning/review/success/danger/muted).</summary>
    public string Tone { get; }
}

/// <summary>
/// Строка разреза отчёта: имя + главный счёт + горизонтальная полоска
/// (доля от максимума секции, 0..100 — ProgressBar как у опросов новостей).
/// </summary>
public sealed class TaskAnalyticsRowViewModel
{
    public TaskAnalyticsRowViewModel(
        string title,
        int value,
        string metaText,
        double percent,
        string tone)
    {
        Title = title;
        Value = value;
        ValueText = value.ToString(CultureInfo.CurrentCulture);
        MetaText = metaText;
        Percent = percent;
        PercentText = percent.ToString("0", CultureInfo.CurrentCulture) + "%";
        Tone = tone;
    }

    public string Title { get; }
    public int Value { get; }
    public string ValueText { get; }
    /// <summary>Счётчики второй строкой («Открыто · Выполнено · Просрочено»); пусто — скрыто.</summary>
    public string MetaText { get; }
    /// <summary>Доля полоски 0..100 относительно максимума секции.</summary>
    public double Percent { get; }
    public string PercentText { get; }
    public string Tone { get; }
}

/// <summary>Строка динамики: «дата — создано/завершено (в срок)».</summary>
public sealed class TaskAnalyticsTrendRowViewModel
{
    public TaskAnalyticsTrendRowViewModel(HubTaskAnalyticsTrendItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Label = (item.BucketLabel ?? string.Empty).Trim();
        Created = item.Created;
        Completed = item.Completed;
        CompletedOnTime = item.CompletedOnTime;
        ValuesText = string.Create(
            CultureInfo.CurrentCulture,
            $"Создано {Created} · Завершено {Completed} · в срок {CompletedOnTime}");
    }

    public string Label { get; }
    public int Created { get; }
    public int Completed { get; }
    public int CompletedOnTime { get; }
    public string ValuesText { get; }
}

/// <summary>
/// Режим «Аналитика» страницы «Мои задачи»: GET /hub/tasks/analytics
/// (KPI + разрезы + динамика, право tasks.read) и выгрузка xlsx через
/// GET /hub/tasks/analytics/export. Пресеты 7/30/90 дней + date_basis +
/// multi-фильтры проект/объект/участник — как в веб-отчёте.
/// Запрос уходит только при смене параметров (dedupe по ключу параметров),
/// справочники фильтров грузятся один раз при первой активации.
/// </summary>
public sealed class TaskAnalyticsViewModel : ObservableObject
{
    /// <summary>Размер выдачи GET /hub/users/assignees для фильтра «Участник» (limit роута ≤ 200).</summary>
    internal const int ParticipantsLimit = 200;

    /// <summary>Сколько строк показываем в разрезах (веб режет топ-8).</summary>
    internal const int BreakdownRowLimit = 8;

    internal const string Preset7d = "7d";
    internal const string Preset30d = "30d";
    internal const string Preset90d = "90d";
    internal const string DefaultPreset = Preset30d;
    internal const string DefaultDateBasis = "protocol_date";

    private static readonly TaskAnalyticsDateBasisOption BasisProtocolDate =
        new("protocol_date", "По дате постановки");
    private static readonly TaskAnalyticsDateBasisOption BasisCompletedAt =
        new("completed_at", "По завершению");
    private static readonly TaskAnalyticsDateBasisOption BasisDueAt =
        new("due_at", "По сроку");

    private readonly IHubApiClient _api;

    /// <summary>id последнего запроса: применяем payload только самого свежего.</summary>
    private int _loadRequestId;
    private string? _inFlightParamsKey;
    private string _lastLoadedParamsKey = string.Empty;
    private bool _directoriesLoaded;

    private string _preset = DefaultPreset;
    private TaskAnalyticsDateBasisOption _selectedDateBasis = BasisProtocolDate;
    private TaskAnalyticsFilterOption? _selectedProjectCandidate;
    private TaskAnalyticsFilterOption? _selectedObjectCandidate;
    private TaskAnalyticsFilterOption? _selectedParticipantCandidate;
    private bool _isLoading;
    private bool _isExporting;
    private string? _errorText;
    private string? _statusText;
    private bool _hasPayload;
    private int _totalCount;
    private string _rangeText = string.Empty;
    private string _trendGranularityText = string.Empty;
    private bool _isTruncated;

    public TaskAnalyticsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        SelectPresetCommand = new NativeRelayCommand(
            parameter => Preset = parameter as string ?? DefaultPreset);
        RemoveFilterCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is TaskAnalyticsFilterOption option)
                {
                    RemoveFilter(option);
                }
            });
        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(force: true, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex));
        ExportCommand = new NativeAsyncCommand(
            (_, ct) => ExportAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => HasPayload && !IsExporting);
        DismissStatusCommand = new NativeRelayCommand(() => StatusText = null);
        DismissErrorCommand = new NativeRelayCommand(() => ErrorText = null);

        SelectedProjects.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasSelectedProjects));
        SelectedObjects.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasSelectedObjects));
        SelectedParticipants.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasSelectedParticipants));
        StatusRows.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasStatusRows));
        ParticipantRows.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasParticipantRows));
        ProjectRows.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasProjectRows));
        ObjectRows.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasObjectRows));
        TrendItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasTrendItems));

        UpdateRangeText();
    }

    // ---- Фильтры ----

    /// <summary>Пресеты периода (start/end считаются от сегодняшнего дня — как веб).</summary>
    public IReadOnlyList<TaskAnalyticsPresetOption> Presets { get; } =
    [
        new(Preset7d, "7 дней"),
        new(Preset30d, "30 дней"),
        new(Preset90d, "90 дней"),
    ];

    /// <summary>Варианты date_basis роута: protocol_date|completed_at|due_at.</summary>
    public IReadOnlyList<TaskAnalyticsDateBasisOption> DateBasisOptions { get; } =
    [
        BasisProtocolDate,
        BasisCompletedAt,
        BasisDueAt,
    ];

    /// <summary>Текущий пресет: 7d|30d|90d — смена пересчитывает диапазон и перезагружает.</summary>
    public string Preset
    {
        get => _preset;
        set
        {
            var normalized = value is Preset7d or Preset90d ? value : DefaultPreset;
            if (SetProperty(ref _preset, normalized))
            {
                OnPropertyChanged(nameof(IsPreset7d));
                OnPropertyChanged(nameof(IsPreset30d));
                OnPropertyChanged(nameof(IsPreset90d));
                UpdateRangeText();
                RequestReload();
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры — для write-back SelectionItemPattern,
    // клик идёт через SelectPresetCommand (как StatusFilter списка).
    public bool IsPreset7d
    {
        get => _preset == Preset7d;
        set => ApplyPresetFromUi(Preset7d, value);
    }

    public bool IsPreset30d
    {
        get => _preset == Preset30d;
        set => ApplyPresetFromUi(Preset30d, value);
    }

    public bool IsPreset90d
    {
        get => _preset == Preset90d;
        set => ApplyPresetFromUi(Preset90d, value);
    }

    private void ApplyPresetFromUi(string preset, bool isChecked)
    {
        if (isChecked && _preset != preset)
        {
            SelectPresetCommand.Execute(preset);
        }
    }

    /// <summary>Поле даты фильтра; смена перезагружает отчёт.</summary>
    public TaskAnalyticsDateBasisOption SelectedDateBasis
    {
        get => _selectedDateBasis;
        set
        {
            if (SetProperty(ref _selectedDateBasis, value ?? BasisProtocolDate))
            {
                RequestReload();
            }
        }
    }

    /// <summary>Подпись диапазона под пресетами («Период: dd.MM.yyyy — dd.MM.yyyy»).</summary>
    public string RangeText
    {
        get => _rangeText;
        private set => SetProperty(ref _rangeText, value);
    }

    /// <summary>Справочники фильтров (GET task-projects/task-objects/users/assignees).</summary>
    public ObservableCollection<TaskAnalyticsFilterOption> ProjectOptions { get; } = [];
    public ObservableCollection<TaskAnalyticsFilterOption> ObjectOptions { get; } = [];
    public ObservableCollection<TaskAnalyticsFilterOption> ParticipantOptions { get; } = [];

    /// <summary>Выбранные чипы фильтров (multi как у веба).</summary>
    public ObservableCollection<TaskAnalyticsFilterOption> SelectedProjects { get; } = [];
    public ObservableCollection<TaskAnalyticsFilterOption> SelectedObjects { get; } = [];
    public ObservableCollection<TaskAnalyticsFilterOption> SelectedParticipants { get; } = [];

    public bool HasSelectedProjects => SelectedProjects.Count > 0;
    public bool HasSelectedObjects => SelectedObjects.Count > 0;
    public bool HasSelectedParticipants => SelectedParticipants.Count > 0;

    /// <summary>ComboBox «Проект»: выбор превращается в чип, само поле очищается.</summary>
    public TaskAnalyticsFilterOption? SelectedProjectCandidate
    {
        get => _selectedProjectCandidate;
        set
        {
            _selectedProjectCandidate = null;
            OnPropertyChanged();
            if (value is not null)
            {
                AddFilter(SelectedProjects, value);
            }
        }
    }

    /// <summary>ComboBox «Объект» — то же поведение, что и у проекта.</summary>
    public TaskAnalyticsFilterOption? SelectedObjectCandidate
    {
        get => _selectedObjectCandidate;
        set
        {
            _selectedObjectCandidate = null;
            OnPropertyChanged();
            if (value is not null)
            {
                AddFilter(SelectedObjects, value);
            }
        }
    }

    /// <summary>ComboBox «Участник» — то же поведение, что и у проекта.</summary>
    public TaskAnalyticsFilterOption? SelectedParticipantCandidate
    {
        get => _selectedParticipantCandidate;
        set
        {
            _selectedParticipantCandidate = null;
            OnPropertyChanged();
            if (value is not null)
            {
                AddFilter(SelectedParticipants, value);
            }
        }
    }

    public ICommand SelectPresetCommand { get; }
    public ICommand RemoveFilterCommand { get; }
    public ICommand RefreshCommand { get; }
    public ICommand ExportCommand { get; }
    public ICommand DismissStatusCommand { get; }
    public ICommand DismissErrorCommand { get; }

    private void AddFilter(ObservableCollection<TaskAnalyticsFilterOption> target, TaskAnalyticsFilterOption option)
    {
        if (option.Id.Length == 0 || target.Any(item => item.Id == option.Id))
        {
            return;
        }

        target.Add(option);
        RequestReload();
    }

    private void RemoveFilter(TaskAnalyticsFilterOption option)
    {
        var removed = option.Kind switch
        {
            "project" => RemoveOption(SelectedProjects, option),
            "object" => RemoveOption(SelectedObjects, option),
            "participant" => RemoveOption(SelectedParticipants, option),
            _ => false,
        };
        if (removed)
        {
            RequestReload();
        }

        static bool RemoveOption(
            ObservableCollection<TaskAnalyticsFilterOption> collection,
            TaskAnalyticsFilterOption option) =>
            collection.Remove(option)
            || collection.Remove(collection.FirstOrDefault(item => item.Id == option.Id)!);
    }

    // ---- Состояние и данные ----

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

    public bool IsExporting
    {
        get => _isExporting;
        private set
        {
            if (SetProperty(ref _isExporting, value))
            {
                OnPropertyChanged(nameof(ExportButtonText));
                ((NativeAsyncCommand)ExportCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string ExportButtonText => IsExporting ? "Экспортирую…" : "⭳ Excel";

    /// <summary>Ошибка загрузки/экспорта — плашка панели с «Повторить».</summary>
    public string? ErrorText
    {
        get => _errorText;
        private set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    /// <summary>Не-ошибочный статус («Отчёт сохранён: …», ACL-усечение выборки).</summary>
    public string? StatusText
    {
        get => _statusText;
        private set
        {
            if (SetProperty(ref _statusText, value))
            {
                OnPropertyChanged(nameof(HasStatus));
            }
        }
    }

    public bool HasStatus => !string.IsNullOrEmpty(StatusText);

    /// <summary>Отчёт загружен и соответствует текущим фильтрам.</summary>
    public bool HasPayload
    {
        get => _hasPayload;
        private set
        {
            if (SetProperty(ref _hasPayload, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                ((NativeAsyncCommand)ExportCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Пусто под текущие фильтры: payload есть, задач в выдаче нет.</summary>
    public bool IsEmpty => HasPayload && !IsLoading && !HasError && _totalCount == 0;

    /// <summary>Отметка backend'а: ACL-выборка зрителя усечена лимитом сканирования.</summary>
    public bool IsTruncated
    {
        get => _isTruncated;
        private set => SetProperty(ref _isTruncated, value);
    }

    public ObservableCollection<TaskAnalyticsKpiViewModel> Kpis { get; } = [];
    public ObservableCollection<TaskAnalyticsRowViewModel> StatusRows { get; } = [];
    public ObservableCollection<TaskAnalyticsRowViewModel> ParticipantRows { get; } = [];
    public ObservableCollection<TaskAnalyticsRowViewModel> ProjectRows { get; } = [];
    public ObservableCollection<TaskAnalyticsRowViewModel> ObjectRows { get; } = [];
    public ObservableCollection<TaskAnalyticsTrendRowViewModel> TrendItems { get; } = [];

    public bool HasStatusRows => StatusRows.Count > 0;
    public bool HasParticipantRows => ParticipantRows.Count > 0;
    public bool HasProjectRows => ProjectRows.Count > 0;
    public bool HasObjectRows => ObjectRows.Count > 0;
    public bool HasTrendItems => TrendItems.Count > 0;

    /// <summary>Подпись гранулярности тренда («по дням/неделям/месяцам/кварталам»).</summary>
    public string TrendGranularityText
    {
        get => _trendGranularityText;
        private set => SetProperty(ref _trendGranularityText, value);
    }

    /// <summary>
    /// Шов сохранения отчёта (как ExportTargetPicker у чата): аргумент —
    /// предложенное имя файла, возврат — путь назначения или null (отмена).
    /// View подставляет SaveFileDialog, тесты — фиксированный путь.
    /// </summary>
    public Func<string, string?>? ExportTargetPicker { get; set; }

    // ---- Загрузка ----

    /// <summary>
    /// Вход в режим (чип «Аналитика»): справочники — один раз, отчёт — если
    /// параметры с последней загрузки изменились (dedupe ключом параметров).
    /// Ошибки не бросаются наружу: маппятся в ErrorText панели.
    /// </summary>
    public async Task ActivateAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await EnsureDirectoriesAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            // Справочники — best-effort: отчёт грузим в любом случае.
            ErrorText = TasksViewModel.DescribeError(exception);
        }

        await LoadSafelyAsync(force: false, cancellationToken);
    }

    /// <summary>«Обновить»/«Повторить» панели: принудительная перезагрузка текущих параметров.</summary>
    public Task RefreshAsync(CancellationToken cancellationToken = default) =>
        LoadSafelyAsync(force: true, cancellationToken);

    /// <summary>Смена параметра фильтра: запрос только если ключ параметров новый.</summary>
    private void RequestReload() => _ = LoadSafelyAsync(force: false, CancellationToken.None);

    private async Task LoadSafelyAsync(bool force, CancellationToken cancellationToken)
    {
        try
        {
            await LoadAsync(force, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>
    /// GET /hub/tasks/analytics по текущим фильтрам. Dedupe: ключ параметров
    /// совпал с загруженным или уже в полёте — повторный запрос не уходит
    /// (force для явного «Обновить»). Ответ применяет только самый свежий запрос.
    /// </summary>
    public async Task LoadAsync(bool force = false, CancellationToken cancellationToken = default)
    {
        var paramsKey = BuildParamsKey();
        if (!force && paramsKey == _lastLoadedParamsKey)
        {
            return;
        }

        if (paramsKey == _inFlightParamsKey)
        {
            return;
        }

        var requestId = ++_loadRequestId;
        _inFlightParamsKey = paramsKey;
        IsLoading = true;
        ErrorText = null;
        try
        {
            var payload = await _api.GetTaskAnalyticsAsync(BuildQuery(), cancellationToken);
            if (requestId != _loadRequestId)
            {
                return;
            }

            ApplyPayload(payload);
            _lastLoadedParamsKey = paramsKey;
            HasPayload = true;
            ErrorText = null;
        }
        finally
        {
            if (paramsKey == _inFlightParamsKey)
            {
                _inFlightParamsKey = null;
            }

            if (requestId == _loadRequestId)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>Справочники фильтров: активные проекты/объекты + первая выдача исполнителей.</summary>
    private async Task EnsureDirectoriesAsync(CancellationToken cancellationToken)
    {
        if (_directoriesLoaded)
        {
            return;
        }

        var projects = await _api.GetTaskProjectsAsync(cancellationToken);
        var objects = await _api.GetTaskObjectsAsync(null, cancellationToken);
        var participants = await _api.SearchTaskAssigneesAsync(null, ParticipantsLimit, cancellationToken);
        ProjectOptions.Clear();
        foreach (var project in projects.Items ?? [])
        {
            if (project.IsActive && !string.IsNullOrEmpty(project.Id))
            {
                ProjectOptions.Add(TaskAnalyticsFilterOption.ForProject(project));
            }
        }

        ObjectOptions.Clear();
        foreach (var item in objects.Items ?? [])
        {
            if (item.IsActive && !string.IsNullOrEmpty(item.Id))
            {
                ObjectOptions.Add(TaskAnalyticsFilterOption.ForObject(item));
            }
        }

        ParticipantOptions.Clear();
        foreach (var user in participants.Items ?? [])
        {
            if (user.Id > 0)
            {
                ParticipantOptions.Add(TaskAnalyticsFilterOption.ForParticipant(user));
            }
        }

        _directoriesLoaded = true;
    }

    /// <summary>
    /// Диапазон пресета — как buildAnalyticsRangeFromPreset веба:
    /// end = сегодня, start = end − (N−1) день («7d» = сегодня и 6 дней назад).
    /// </summary>
    internal static (string Start, string End) BuildRangeFromPreset(string preset, DateTime today)
    {
        var end = today.Date;
        var start = preset switch
        {
            Preset7d => end.AddDays(-6),
            Preset90d => end.AddDays(-89),
            _ => end.AddDays(-29),
        };
        return (
            start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture));
    }

    /// <summary>Текущий запрос /hub/tasks/analytics (и /export — тот же набор параметров).</summary>
    internal HubTaskAnalyticsQuery BuildQuery()
    {
        var (start, end) = BuildRangeFromPreset(_preset, DateTime.Today);
        return new HubTaskAnalyticsQuery
        {
            StartDate = start,
            EndDate = end,
            DateBasis = _selectedDateBasis.Value,
            ProjectIds = [.. SelectedProjects.Select(item => item.Id)],
            ObjectIds = [.. SelectedObjects.Select(item => item.Id)],
            ParticipantUserIds =
            [
                .. SelectedParticipants
                    .Select(item => long.TryParse(
                        item.Id, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)
                        ? id
                        : 0L)
                    .Where(id => id > 0),
            ],
        };
    }

    /// <summary>Стабильный ключ параметров для dedupe — списки в сортированном порядке.</summary>
    internal string BuildParamsKey()
    {
        var query = BuildQuery();
        return string.Join(
            "|",
            query.StartDate,
            query.EndDate,
            query.DateBasis,
            string.Join(",", (query.ProjectIds ?? []).OrderBy(id => id, StringComparer.Ordinal)),
            string.Join(",", (query.ObjectIds ?? []).OrderBy(id => id, StringComparer.Ordinal)),
            string.Join(",", (query.ParticipantUserIds ?? []).OrderBy(id => id)));
    }

    /// <summary>Маппинг payload → KPI/разрезы/тренд (подмножество веб-логики buildAnalytics*).</summary>
    private void ApplyPayload(HubTaskAnalyticsPayload? payload)
    {
        var summary = payload?.Summary ?? new HubTaskAnalyticsMetrics();
        _totalCount = summary.Total;
        OnPropertyChanged(nameof(IsEmpty));
        IsTruncated = payload?.Truncated == true;
        if (IsTruncated)
        {
            StatusText = "Выборка усечена лимитом сервера — показана часть задач.";
        }
        else if (StatusText is not null && StatusText.StartsWith("Выборка", StringComparison.Ordinal))
        {
            StatusText = null;
        }

        // KPI — те же шесть карточек, что у веб-отчёта (buildAnalyticsKpis).
        Kpis.Clear();
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "Всего задач",
            FormatCount(summary.Total),
            "Все задачи по фильтрам",
            HubStatusTone.Info));
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "Открыто",
            FormatCount(summary.Open),
            $"Новые {FormatCount(summary.New)} · В работе {FormatCount(summary.InProgress)} · На проверке {FormatCount(summary.Review)}",
            HubStatusTone.Warning));
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "Выполнено",
            FormatCountPercent(summary.Done, summary.CompletionPercent),
            "Общий процент выполнения",
            HubStatusTone.Success));
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "В срок",
            FormatCountPercent(summary.DoneOnTime, summary.CompletionOnTimePercent),
            $"Со сроком: {FormatCount(summary.WithDueTotal)}",
            HubStatusTone.Review));
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "Просрочено",
            FormatCount(summary.Overdue),
            "Открытые задачи с истёкшим сроком",
            HubStatusTone.Danger));
        Kpis.Add(new TaskAnalyticsKpiViewModel(
            "Выполнено без срока",
            FormatCount(summary.DoneWithoutDue),
            "Не попадают в KPI «В срок»",
            HubStatusTone.Muted));

        // «По статусам»: status_breakdown сервера; при пустом списке — из summary (как веб).
        var statusItems = payload?.StatusBreakdown is { Count: > 0 } breakdown
            ? breakdown
            : DefaultStatusBreakdown(summary);
        StatusRows.Clear();
        FillRows(
            StatusRows,
            statusItems.Select(item => (
                (item.Label ?? item.Status ?? string.Empty).Trim(),
                item.Value,
                string.Empty,
                StatusTone(item.Status))));

        // Разрезы — топ-N по total (сервер уже сортирует); полоска — доля от максимума.
        ParticipantRows.Clear();
        FillRows(
            ParticipantRows,
            (payload?.ByParticipant ?? [])
                .Take(BreakdownRowLimit)
                .Select(item => (
                    string.IsNullOrWhiteSpace(item.ParticipantName) ? "Не назначен" : item.ParticipantName.Trim(),
                    item.Total,
                    GroupMetaText(item),
                    HubStatusTone.Info)));

        ProjectRows.Clear();
        FillRows(
            ProjectRows,
            (payload?.ByProject ?? [])
                .Take(BreakdownRowLimit)
                .Select(item => (
                    string.IsNullOrWhiteSpace(item.ProjectName) ? "Без проекта" : item.ProjectName.Trim(),
                    item.Total,
                    GroupMetaText(item),
                    HubStatusTone.Success)));

        ObjectRows.Clear();
        FillRows(
            ObjectRows,
            (payload?.ByObject ?? [])
                .Take(BreakdownRowLimit)
                .Select(item => (
                    string.IsNullOrWhiteSpace(item.ObjectName) ? "Без объекта" : item.ObjectName.Trim(),
                    item.Total,
                    GroupMetaText(item),
                    HubStatusTone.Review)));

        TrendItems.Clear();
        foreach (var item in payload?.Trend?.Items ?? [])
        {
            TrendItems.Add(new TaskAnalyticsTrendRowViewModel(item));
        }

        TrendGranularityText = payload?.Trend?.Granularity switch
        {
            "week" => "по неделям",
            "month" => "по месяцам",
            "quarter" => "по кварталам",
            _ => TrendItems.Count > 0 ? "по дням" : string.Empty,
        };
    }

    private static IEnumerable<HubTaskAnalyticsStatusItem> DefaultStatusBreakdown(
        HubTaskAnalyticsMetrics summary) =>
    [
        new HubTaskAnalyticsStatusItem { Status = "new", Label = "Новые", Value = summary.New },
        new HubTaskAnalyticsStatusItem { Status = "in_progress", Label = "В работе", Value = summary.InProgress },
        new HubTaskAnalyticsStatusItem { Status = "review", Label = "На проверке", Value = summary.Review },
        new HubTaskAnalyticsStatusItem { Status = "done", Label = "Выполнено", Value = summary.Done },
    ];

    /// <summary>Мета-строка разреза: «Открыто x · Выполнено y · Просрочено z».</summary>
    private static string GroupMetaText(HubTaskAnalyticsMetrics item) => string.Create(
        CultureInfo.CurrentCulture,
        $"Открыто {item.Open} · Выполнено {item.Done} · Просрочено {item.Overdue}");

    /// <summary>Тон строки статуса — как analyticsStatusColors веба, на палитре HubStatusTone.</summary>
    private static string StatusTone(string? status) => status switch
    {
        "new" => HubStatusTone.Info,
        "in_progress" => HubStatusTone.Warning,
        "review" => HubStatusTone.Review,
        "done" => HubStatusTone.Success,
        "overdue" => HubStatusTone.Danger,
        _ => HubStatusTone.Muted,
    };

    /// <summary>Наполнение секции: полоска — доля от максимума секции (0..100).</summary>
    private static void FillRows(
        ObservableCollection<TaskAnalyticsRowViewModel> target,
        IEnumerable<(string Title, int Value, string Meta, string Tone)> rows)
    {
        var materialized = rows.ToList();
        var max = materialized.Count == 0 ? 0 : materialized.Max(row => row.Value);
        foreach (var row in materialized)
        {
            var percent = max > 0 ? row.Value * 100.0 / max : 0;
            target.Add(new TaskAnalyticsRowViewModel(row.Title, row.Value, row.Meta, percent, row.Tone));
        }
    }

    private static string FormatCount(int value) => value.ToString(CultureInfo.CurrentCulture);

    /// <summary>«count / percent%» — formatMetricCountPercent веба (процент с одним знаком).</summary>
    private static string FormatCountPercent(int count, double percent) =>
        string.Create(
            CultureInfo.CurrentCulture,
            $"{count} / {percent.ToString("0.0", CultureInfo.CurrentCulture)}%");

    private void UpdateRangeText()
    {
        var (start, end) = BuildRangeFromPreset(_preset, DateTime.Today);
        RangeText = $"Период: {FormatDay(start)} — {FormatDay(end)}";

        static string FormatDay(string iso) =>
            DateTime.TryParseExact(iso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)
                ? day.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture)
                : iso;
    }

    // ---- Экспорт ----

    /// <summary>
    /// «⭳ Excel»: путь выбирает шов ExportTargetPicker (SaveFileDialog view),
    /// тело GET /hub/tasks/analytics/export стримится в файл; имя из
    /// Content-Disposition переименовывает файл, как у вложений.
    /// </summary>
    private async Task ExportAsync(CancellationToken cancellationToken)
    {
        var picker = ExportTargetPicker;
        if (picker is null || IsExporting || !HasPayload)
        {
            return;
        }

        var suggested = $"task_analytics_{DateTime.Now:yyyyMMdd_HHmm}.xlsx";
        var path = picker(suggested);
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        IsExporting = true;
        ErrorText = null;
        try
        {
            string serverName;
            await using (var file = new FileStream(
                             path, FileMode.Create, FileAccess.Write, FileShare.Read, 81920, useAsync: true))
            {
                serverName = await _api.ExportTaskAnalyticsAsync(BuildQuery(), file, cancellationToken);
            }

            var finalPath = path;
            if (!string.IsNullOrWhiteSpace(serverName))
            {
                var directory = Path.GetDirectoryName(path);
                var renamed = string.IsNullOrEmpty(directory)
                    ? serverName
                    : Path.Combine(directory, serverName);
                if (!string.Equals(renamed, path, StringComparison.OrdinalIgnoreCase))
                {
                    try
                    {
                        if (File.Exists(renamed))
                        {
                            File.Delete(renamed);
                        }

                        File.Move(path, renamed);
                        finalPath = renamed;
                    }
                    catch (IOException)
                    {
                    }
                }
            }

            StatusText = $"Отчёт сохранён: {Path.GetFileName(finalPath)}";
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            IsExporting = false;
        }
    }

    /// <summary>Сброс содержимого при выходе из сессии (вместе со списком).</summary>
    public void Reset()
    {
        _loadRequestId++;
        _inFlightParamsKey = null;
        _lastLoadedParamsKey = string.Empty;
        _directoriesLoaded = false;
        _preset = DefaultPreset;
        _selectedDateBasis = BasisProtocolDate;
        _selectedProjectCandidate = null;
        _selectedObjectCandidate = null;
        _selectedParticipantCandidate = null;
        OnPropertyChanged(nameof(Preset));
        OnPropertyChanged(nameof(IsPreset7d));
        OnPropertyChanged(nameof(IsPreset30d));
        OnPropertyChanged(nameof(IsPreset90d));
        OnPropertyChanged(nameof(SelectedDateBasis));
        OnPropertyChanged(nameof(SelectedProjectCandidate));
        OnPropertyChanged(nameof(SelectedObjectCandidate));
        OnPropertyChanged(nameof(SelectedParticipantCandidate));
        UpdateRangeText();
        ProjectOptions.Clear();
        ObjectOptions.Clear();
        ParticipantOptions.Clear();
        SelectedProjects.Clear();
        SelectedObjects.Clear();
        SelectedParticipants.Clear();
        Kpis.Clear();
        StatusRows.Clear();
        ParticipantRows.Clear();
        ProjectRows.Clear();
        ObjectRows.Clear();
        TrendItems.Clear();
        TrendGranularityText = string.Empty;
        _totalCount = 0;
        IsTruncated = false;
        HasPayload = false;
        IsLoading = false;
        IsExporting = false;
        ErrorText = null;
        StatusText = null;
    }
}
