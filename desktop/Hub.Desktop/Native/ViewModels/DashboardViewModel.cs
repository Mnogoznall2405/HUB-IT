using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Статистическая карточка главной страницы.</summary>
public sealed record DashboardStatCard(
    string Label,
    string ValueText,
    string Tone,
    string? TaskFilterToOpen,
    string? PageToOpen)
{
    /// <summary>Карточка куда-то ведёт (фильтр задач или страница).</summary>
    public bool IsNavigable => TaskFilterToOpen is not null || PageToOpen is not null;

    /// <summary>Имя для скринридера: «Просрочено: 3», а не только «Просрочено».</summary>
    public string AccessibleName => $"{Label}: {ValueText}";
}

/// <summary>Строка новости на главной.</summary>
public sealed record DashboardAnnouncementRow(
    string Id,
    string Title,
    string Preview,
    string DateText,
    bool IsImportant);

/// <summary>Строка «отсутствует сегодня».</summary>
public sealed record DashboardAbsenceRow(
    string DisplayName,
    string KindLabel,
    string RangeText,
    string SourceText);

/// <summary>
/// Строка секции «Требует внимания»: задача, ждущая реакции, или обязательное
/// объявление. Ровно одно из Task/Announcement заполнено — клик открывает объект.
/// </summary>
public sealed record DashboardAttentionRow(
    string Key,
    string Title,
    string SecondaryText,
    string Tone,
    TaskListItemViewModel? Task,
    DashboardAnnouncementRow? Announcement);

/// <summary>
/// Главная страница шелла: приветствие, summary-счётчики, ближайшие задачи,
/// новости и отсутствующие сегодня — по GET /api/v1/hub/dashboard.
/// </summary>
public sealed class DashboardViewModel : ObservableObject
{
    /// <summary>Сколько строк «требует внимания» показываем (как на веб-дашборде).</summary>
    private const int MaxAttentionRows = 6;

    private readonly IHubApiClient _api;
    private int _attentionTotal;
    private bool _isLoading;
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight realtime-загрузки.</summary>
    private int _loadEpoch;
    private string? _errorText;
    private string _userName = string.Empty;
    private string _greetingText = string.Empty;
    private string _todayText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private FeedbackDialogViewModel? _feedback;

    public DashboardViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        OpenFeedbackCommand = new NativeRelayCommand(
            OpenFeedback,
            () => !IsFeedbackOpen);
        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex));
        OpenTaskCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TaskListItemViewModel item)
            {
                TaskOpenRequested?.Invoke(this, item.Id);
            }
        });
        OpenNewsCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DashboardAnnouncementRow row && !string.IsNullOrEmpty(row.Id))
            {
                NewsOpenRequested?.Invoke(this, row.Id);
            }
        });
        OpenAttentionItemCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is not DashboardAttentionRow row)
            {
                return;
            }

            if (row.Task is not null)
            {
                TaskOpenRequested?.Invoke(this, row.Task.Id);
            }
            else if (row.Announcement is not null && !string.IsNullOrEmpty(row.Announcement.Id))
            {
                NewsOpenRequested?.Invoke(this, row.Announcement.Id);
            }
        });
        TodayText = DateTime.Now.ToString("dddd, d MMMM", CultureInfo.CurrentCulture);
    }

    /// <summary>Пользователь запросил переход к задаче (id) — обрабатывает шелл.</summary>
    public event EventHandler<long>? TaskOpenRequested;

    /// <summary>Пользователь запросил переход к новости (id) — обрабатывает шелл.</summary>
    public event EventHandler<string>? NewsOpenRequested;

    public ObservableCollection<DashboardStatCard> StatCards { get; } = [];
    public ObservableCollection<DashboardAttentionRow> AttentionItems { get; } = [];
    public ObservableCollection<TaskListItemViewModel> UpcomingTasks { get; } = [];
    public ObservableCollection<DashboardAnnouncementRow> Announcements { get; } = [];
    public ObservableCollection<DashboardAbsenceRow> Absences { get; } = [];

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(HasContent));
            }
        }
    }

    public string? ErrorText
    {
        get => _errorText;
        private set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
                OnPropertyChanged(nameof(HasContent));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    /// <summary>Показывать содержимое: загрузка завершена и нет фатальной ошибки без данных.</summary>
    public bool HasContent => !IsLoading && (!HasError || StatCards.Count > 0);

    public string GreetingText
    {
        get => _greetingText;
        private set => SetProperty(ref _greetingText, value);
    }

    public string TodayText
    {
        get => _todayText;
        private set => SetProperty(ref _todayText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    public bool HasUpcomingTasks => UpcomingTasks.Count > 0;
    public bool HasAnnouncements => Announcements.Count > 0;
    public bool HasAbsences => Absences.Count > 0;

    /// <summary>
    /// Полное число пунктов «требует внимания»: сумма авторитетных
    /// summary-счётчиков, но не меньше числа собранных строк.
    /// </summary>
    public int AttentionTotal => Math.Max(_attentionTotal, AttentionItems.Count);
    public string AttentionTotalText => AttentionTotal.ToString(CultureInfo.CurrentCulture);

    /// <summary>Есть что-то, требующее реакции пользователя.</summary>
    public bool HasAttention => AttentionTotal > 0;

    /// <summary>Счётчики сигналят, но конкретных объектов в выдаче нет — показываем подсказку.</summary>
    public bool HasAttentionSummaryOnly => _attentionTotal > 0 && AttentionItems.Count == 0;

    /// <summary>Тон панели: красный при просрочке, иначе янтарный.</summary>
    public string AttentionTone { get; private set; } = HubStatusTone.Warning;

    /// <summary>
    /// Диалог «Предложить улучшение HUB» (FeedbackDialog веба): не null — оверлей
    /// поверх страницы открыт. Живёт до «Закрыть»/Esc — вкладки и черновик
    /// сохраняются, пока диалог виден.
    /// </summary>
    public FeedbackDialogViewModel? Feedback
    {
        get => _feedback;
        private set
        {
            if (SetProperty(ref _feedback, value))
            {
                OnPropertyChanged(nameof(IsFeedbackOpen));
                ((NativeRelayCommand)OpenFeedbackCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Оверлей предложения виден.</summary>
    public bool IsFeedbackOpen => Feedback is not null;

    public ICommand RefreshCommand { get; }
    public ICommand OpenTaskCommand { get; }
    public ICommand OpenNewsCommand { get; }
    public ICommand OpenAttentionItemCommand { get; }

    /// <summary>Кнопка «Предложить улучшение HUB» в шапке страницы.</summary>
    public ICommand OpenFeedbackCommand { get; }

    public void SetUserName(string displayName)
    {
        _userName = displayName ?? string.Empty;
        UpdateGreeting();
    }

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var dashboard = await _api.GetDashboardAsync(
                announcementsLimit: 6,
                tasksLimit: 6,
                cancellationToken);
            ApplyDashboard(dashboard);
            ErrorText = null;
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        catch (Exception ex)
        {
            ErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Тихое обновление по realtime-событию (dashboard.invalidate и события
    /// доменов, которые дашборд агрегирует): та же выборка без IsLoading-
    /// индикатора — страница не мигает спиннером на каждое событие.
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
                    var dashboard = await _api.GetDashboardAsync(
                        announcementsLimit: 6,
                        tasksLimit: 6,
                        cancellationToken);
                    if (epoch != _loadEpoch)
                    {
                        // Сессия сменилась (Reset) — чужие данные не применяем.
                        return;
                    }

                    ApplyDashboard(dashboard);
                    ErrorText = null;
                    LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
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

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        ErrorText = message;
        IsLoading = false;
    }

    /// <summary>
    /// Синхронизация карточки «Непрочитанных новостей» со страницей новостей:
    /// после чтения счётчик обновляется без перезагрузки дашборда.
    /// </summary>
    public void SetNewsUnreadCount(int unreadTotal)
    {
        for (var i = 0; i < StatCards.Count; i++)
        {
            if (StatCards[i].PageToOpen == "news")
            {
                StatCards[i] = StatCards[i] with
                {
                    ValueText = unreadTotal.ToString(CultureInfo.CurrentCulture),
                };
                return;
            }
        }
    }

    /// <summary>Открыть диалог предложения; второй экземпляр не создаётся.</summary>
    private void OpenFeedback()
    {
        if (Feedback is not null)
        {
            return;
        }

        var dialog = new FeedbackDialogViewModel(_api);
        dialog.Closed = () => Feedback = null;
        Feedback = dialog;
    }

    public void Reset()
    {
        _loadEpoch++;
        _realtimeRefreshQueued = false;
        // Диалог предложения привязан к сессии — при смене пользователя закрываем.
        Feedback = null;
        StatCards.Clear();
        AttentionItems.Clear();
        _attentionTotal = 0;
        AttentionTone = HubStatusTone.Warning;
        UpcomingTasks.Clear();
        Announcements.Clear();
        Absences.Clear();
        ErrorText = null;
        IsLoading = false;
        _userName = string.Empty;
        GreetingText = string.Empty;
        LastUpdatedText = string.Empty;
        RaiseContentFlags();
    }

    private void ApplyDashboard(HubDashboard dashboard)
    {
        var summary = dashboard.Summary;
        StatCards.Clear();
        StatCards.Add(new DashboardStatCard(
            "Просрочено", Count(summary?.TasksOverdue), HubStatusTone.Danger, "overdue", null));
        StatCards.Add(new DashboardStatCard(
            "Требует проверки", Count(summary?.TasksReviewRequired), HubStatusTone.Review, "review", null));
        StatCards.Add(new DashboardStatCard(
            "Открыто задач", Count(summary?.TasksOpenTotal), HubStatusTone.Info, "all", null));
        StatCards.Add(new DashboardStatCard(
            "Непрочитанных новостей", Count(summary?.AnnouncementsAttention), HubStatusTone.Warning, null, "news"));
        StatCards.Add(new DashboardStatCard(
            "Отсутствуют сегодня", Count(summary?.AbsencesToday), HubStatusTone.Muted, null, "absences"));

        var orderedTasks = (dashboard.MyTasks?.Items ?? [])
            .OrderBy(t => t.DueAt ?? DateTimeOffset.MaxValue)
            .ToList();
        var taskViewModels = orderedTasks
            .Select(t => new TaskListItemViewModel(t))
            .ToList();
        UpcomingTasks.Clear();
        foreach (var item in taskViewModels.Take(6))
        {
            UpcomingTasks.Add(item);
        }

        Announcements.Clear();
        var announcementRows = new List<DashboardAnnouncementRow>();
        foreach (var announcement in dashboard.Announcements?.Items ?? [])
        {
            var when = announcement.UpdatedAt ?? announcement.PublishedAt ?? announcement.CreatedAt;
            var row = new DashboardAnnouncementRow(
                Id: announcement.Id ?? string.Empty,
                Title: string.IsNullOrWhiteSpace(announcement.Title)
                    ? "Объявление"
                    : announcement.Title!,
                Preview: announcement.Preview ?? string.Empty,
                DateText: when is null
                    ? string.Empty
                    : when.Value.ToLocalTime().ToString("dd.MM HH:mm", CultureInfo.CurrentCulture),
                IsImportant: announcement.IsAckPending);
            announcementRows.Add(row);
            Announcements.Add(row);
        }

        RebuildAttention(orderedTasks, taskViewModels, announcementRows, summary);

        Absences.Clear();
        foreach (var absence in dashboard.AbsencesToday?.Items ?? [])
        {
            Absences.Add(new DashboardAbsenceRow(
                DisplayName: string.IsNullOrWhiteSpace(absence.DisplayName)
                    ? "Сотрудник"
                    : absence.DisplayName!,
                KindLabel: string.IsNullOrWhiteSpace(absence.KindLabel)
                    ? FormatAbsenceKind(absence.Kind)
                    : absence.KindLabel!,
                RangeText: FormatAbsenceRange(absence.StartsOn, absence.EndsOn),
                SourceText: absence.Source is "zup" ? "ЗУП" : "HUB"));
        }

        UpdateGreeting();
        RaiseContentFlags();
    }

    /// <summary>
    /// Секция «Требует внимания» (паритет с вебом): просроченные задачи, задачи
    /// на проверке, задачи с новыми комментариями и обязательные объявления —
    /// одна приоритетная очередь с кликом в конкретный объект. Порядок сортировки
    /// видов как в вебе: overdue → review → comments → ack. Задача входит один раз
    /// (первый подошедший вид). Полный объём берётся из summary-счётчиков —
    /// выдача my_tasks/announcements ограничена лимитом запроса.
    /// </summary>
    private void RebuildAttention(
        IReadOnlyList<HubTaskItem> tasks,
        IReadOnlyList<TaskListItemViewModel> taskViewModels,
        IReadOnlyList<DashboardAnnouncementRow> announcements,
        HubDashboardSummary? summary)
    {
        AttentionItems.Clear();
        _attentionTotal = Math.Max(0, summary?.TasksOverdue ?? 0)
            + Math.Max(0, summary?.TasksReviewRequired ?? 0)
            + Math.Max(0, summary?.TasksWithUnreadComments ?? 0)
            + Math.Max(0, summary?.AnnouncementsAckPending ?? 0);
        var hasOverdue = (summary?.TasksOverdue ?? 0) > 0;

        var seenTasks = new HashSet<long>();
        void AddTaskRows(
            Func<HubTaskItem, bool> match,
            string tone,
            Func<TaskListItemViewModel, string> secondary)
        {
            for (var i = 0; i < tasks.Count && AttentionItems.Count < MaxAttentionRows; i++)
            {
                if (match(tasks[i]) && seenTasks.Add(tasks[i].Id))
                {
                    var item = taskViewModels[i];
                    AttentionItems.Add(new DashboardAttentionRow(
                        $"task:{item.Id}", item.Title, secondary(item), tone, item, null));
                }
            }
        }

        AddTaskRows(t => t.IsOverdue, HubStatusTone.Danger, item => item.DueText);
        hasOverdue |= AttentionItems.Count > 0;
        AddTaskRows(
            t => string.Equals(t.Status, "review", StringComparison.OrdinalIgnoreCase),
            HubStatusTone.Review,
            _ => "На проверке");
        // has_unread_comments может не приходить в выдаче — тогда счётчик
        // учтён в AttentionTotal, а точечной строки не будет.
        AddTaskRows(
            t => t.CommentsUnread > 0,
            HubStatusTone.Muted,
            item => string.IsNullOrEmpty(item.UnreadCommentsText)
                ? "Есть новый комментарий"
                : item.UnreadCommentsText);

        var seenAnnouncements = new HashSet<string>(StringComparer.Ordinal);
        foreach (var row in announcements)
        {
            if (AttentionItems.Count >= MaxAttentionRows)
            {
                break;
            }

            if (row.IsImportant && seenAnnouncements.Add(row.Id))
            {
                AttentionItems.Add(new DashboardAttentionRow(
                    $"news:{row.Id}",
                    row.Title,
                    "Нужно прочитать и подтвердить",
                    HubStatusTone.Warning,
                    null,
                    row));
            }
        }

        AttentionTone = hasOverdue ? HubStatusTone.Danger : HubStatusTone.Warning;
    }

    private void UpdateGreeting()
    {
        var part = DateTime.Now.Hour switch
        {
            >= 5 and < 12 => "Доброе утро",
            >= 12 and < 18 => "Добрый день",
            >= 18 and < 23 => "Добрый вечер",
            _ => "Доброй ночи",
        };
        GreetingText = string.IsNullOrWhiteSpace(_userName)
            ? part
            : $"{part}, {_userName}";
    }

    private void RaiseContentFlags()
    {
        OnPropertyChanged(nameof(HasUpcomingTasks));
        OnPropertyChanged(nameof(HasAnnouncements));
        OnPropertyChanged(nameof(HasAbsences));
        OnPropertyChanged(nameof(AttentionTotal));
        OnPropertyChanged(nameof(AttentionTotalText));
        OnPropertyChanged(nameof(HasAttention));
        OnPropertyChanged(nameof(HasAttentionSummaryOnly));
        OnPropertyChanged(nameof(AttentionTone));
        OnPropertyChanged(nameof(HasContent));
    }

    private static string Count(int? value) =>
        (value ?? 0).ToString(CultureInfo.CurrentCulture);

    private static string FormatAbsenceKind(string? kind) => kind switch
    {
        "vacation" => "Отпуск",
        "sick" => "Больничный",
        "trip" => "Командировка",
        "other" => "Отсутствует",
        null => "Отсутствует",
        _ => kind,
    };

    private static string FormatAbsenceRange(string? startsOn, string? endsOn)
    {
        var start = TryParseDate(startsOn);
        var end = TryParseDate(endsOn);
        if (start is null && end is null)
        {
            return string.Empty;
        }

        if (start is null || end is null || start == end)
        {
            return (start ?? end)!.Value.ToString("dd.MM", CultureInfo.CurrentCulture);
        }

        return $"{start.Value:dd.MM} — {end.Value:dd.MM}";
    }

    private static DateTime? TryParseDate(string? value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.Date
            : null;
}
