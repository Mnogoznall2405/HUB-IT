using System.Collections.ObjectModel;
using System.Globalization;
using System.Net;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Пункт левого меню раздела «Администрирование» — секция веб-админки
/// (accountNavigationConfig). IsChecked — радио-поведение как у вкладок статистики.
/// </summary>
public sealed class AdminSectionItem : ObservableObject
{
    private bool _isChecked;

    public AdminSectionItem(string key, string title, string icon, string hint)
    {
        Key = key;
        Title = title;
        Icon = icon;
        Hint = hint;
        AutomationName = $"Раздел администрирования: {title}";
    }

    /// <summary>users|departments|ad-users|ai-bots|feedback|system.</summary>
    public string Key { get; }
    public string Title { get; }
    public string Icon { get; }
    public string Hint { get; }
    public string AutomationName { get; }

    /// <summary>Write-back от SelectionItemPattern (UIA): выбор идёт через CheckRequested.</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set
        {
            if (SetProperty(ref _isChecked, value) && value)
            {
                CheckRequested?.Invoke(this);
            }
        }
    }

    /// <summary>Подписка VM: проставленная галочка просит переключить раздел.</summary>
    internal Action<AdminSectionItem>? CheckRequested;
}

/// <summary>Чип фильтра статусов предложений (Все + 5 статусов с счётчиками).</summary>
public sealed class AdminFilterChipItem : ObservableObject
{
    private bool _isChecked;
    private string _labelText;

    public AdminFilterChipItem(string value, string labelText)
    {
        Value = value;
        _labelText = labelText;
    }

    /// <summary>""|new|in_progress|accepted|declined|done — значение status API.</summary>
    public string Value { get; }

    public string LabelText
    {
        get => _labelText;
        private set => SetProperty(ref _labelText, value);
    }

    public bool IsChecked
    {
        get => _isChecked;
        set
        {
            if (SetProperty(ref _isChecked, value) && value)
            {
                CheckRequested?.Invoke(this);
            }
        }
    }

    internal Action<AdminFilterChipItem>? CheckRequested;

    internal void SetLabel(string labelText) => LabelText = labelText;
}

/// <summary>Строка раздела «Пользователи» — учётка HUB (UsersTab веба, read-срез).</summary>
public sealed class AdminUserItemViewModel
{
    public AdminUserItemViewModel(HubAdminUser user)
    {
        ArgumentNullException.ThrowIfNull(user);
        Id = user.Id;
        var username = (user.Username ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(user.FullName) ? user.FullName.Trim() : (username.Length > 0 ? username : "—");
        UsernameText = username.Length > 0 ? $"@{username}" : string.Empty;
        SubtitleText = JoinParts(user.JobTitle, user.Department);
        // Подписи ролей — как roleOptions веб-админки (admin→Админ, …).
        (RoleText, RoleTone) = (user.Role ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "admin" => ("Админ", "error"),
            "operator" => ("Оператор", "primary"),
            "viewer" => ("Просмотр", "muted"),
            "user" => ("Пользователь", "muted"),
            "service" => ("Сервис", "muted"),
            { Length: > 0 } other => (other, "muted"),
            _ => ("—", "muted"),
        };
        StatusText = user.IsActive ? "Активен" : "Отключён";
        StatusTone = user.IsActive ? "success" : "muted";
        AuthSourceText = string.Equals(user.AuthSource, "ldap", StringComparison.OrdinalIgnoreCase)
            ? "AD / LDAP"
            : "Локальная";
        MailboxText = !string.IsNullOrWhiteSpace(user.MailboxLogin)
            ? user.MailboxLogin.Trim()
            : MfuFormat.OrDash(user.Email);
        AutomationName = $"Пользователь {Title}";
        SearchIndex = string.Join(' ',
                Title, username, user.Email, user.Department, user.JobTitle)
            .ToLowerInvariant();
    }

    public long Id { get; }
    public string Title { get; }
    public string UsernameText { get; }
    public string SubtitleText { get; }
    public string RoleText { get; }
    public string RoleTone { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string AuthSourceText { get; }
    public string MailboxText { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }

    internal static string JoinParts(params string?[] parts) =>
        string.Join(" · ", parts.Where(p => !string.IsNullOrWhiteSpace(p)).Select(p => p!.Trim()));
}

/// <summary>Строка раздела «Отделы» (items[] GET /departments).</summary>
public sealed class AdminDepartmentItemViewModel
{
    public AdminDepartmentItemViewModel(HubAdminDepartment department)
    {
        ArgumentNullException.ThrowIfNull(department);
        Id = (department.Id ?? string.Empty).Trim();
        Title = MfuFormat.OrDash(department.Name);
        SourceText = string.Equals(department.Source, "ad", StringComparison.OrdinalIgnoreCase)
            ? "AD"
            : "Вручную";
        MembersText = $"{department.MembersCount} участ. · {department.ManagersCount} нач.";
        InactiveText = department.IsActive ? string.Empty : "неактивен";
        HasInactive = !department.IsActive;
        AutomationName = $"Отдел {Title}";
        SearchIndex = Title.ToLowerInvariant();
    }

    public string Id { get; }
    public string Title { get; }
    public string SourceText { get; }
    public string MembersText { get; }
    public string InactiveText { get; }
    public bool HasInactive { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }
}

/// <summary>Строка состава отдела: пользователь + сведённые роли membership.</summary>
public sealed class AdminDepartmentMemberItemViewModel
{
    public AdminDepartmentMemberItemViewModel(
        HubAdminDepartmentMemberUser? user,
        long userId,
        IReadOnlyList<string> roles)
    {
        UserId = userId;
        var username = (user?.Username ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(user?.FullName)
            ? user!.FullName!.Trim()
            : (username.Length > 0 ? username : $"#{userId}");
        UsernameText = username.Length > 0 ? $"@{username}" : string.Empty;
        JobTitleText = MfuFormat.OrDash(user?.JobTitle);
        RolesText = string.Join(", ", roles.Select(role =>
            string.Equals(role, "manager", StringComparison.OrdinalIgnoreCase) ? "начальник" : "участник"));
        AutomationName = $"Участник отдела {Title}";
    }

    public long UserId { get; }
    public string Title { get; }
    public string UsernameText { get; }
    public string JobTitleText { get; }
    public string RolesText { get; }
    public string AutomationName { get; }
}

/// <summary>Строка раздела «Пользователи AD» — кандидат импорта (AdUsers веба).</summary>
public sealed class AdminAdUserItemViewModel
{
    public AdminAdUserItemViewModel(HubAdminAdCandidate user)
    {
        ArgumentNullException.ThrowIfNull(user);
        var login = (user.Login ?? string.Empty).Trim();
        Login = login;
        Title = !string.IsNullOrWhiteSpace(user.DisplayName) ? user.DisplayName.Trim() : (login.Length > 0 ? login : "—");
        LoginText = login.Length > 0 ? $"@{login}" : string.Empty;
        DepartmentText = MfuFormat.OrDash(user.Department);
        JobTitleText = MfuFormat.OrDash(user.Title);
        MailText = MfuFormat.OrDash(user.Mail);
        (StatusText, StatusTone) = (user.ImportStatus ?? string.Empty).Trim() switch
        {
            "new" => ("Новый", "success"),
            "exists_ldap" => ("В HUB (LDAP)", "primary"),
            "local_conflict" => ("Конфликт локальной учётки", "warning"),
            "non_person" => ("Служебная", "muted"),
            { Length: > 0 } other => (other, "muted"),
            _ => ("—", "muted"),
        };
        var warnings = (user.Warnings ?? [])
            .Select(w => w switch
            {
                "missing_mail" => "нет почты",
                "missing_department" => "нет отдела",
                { Length: > 0 } other => other,
                _ => string.Empty,
            })
            .Where(w => w.Length > 0)
            .ToList();
        WarningsText = warnings.Count > 0 ? string.Join(" · ", warnings) : string.Empty;
        HasWarnings = WarningsText.Length > 0;
        AutomationName = $"Пользователь AD {Title}";
        SearchIndex = string.Join(' ', Title, login, user.Department, user.Mail, user.Title)
            .ToLowerInvariant();
    }

    public string Login { get; }
    public string Title { get; }
    public string LoginText { get; }
    public string DepartmentText { get; }
    public string JobTitleText { get; }
    public string MailText { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string WarningsText { get; }
    public bool HasWarnings { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }
}

/// <summary>Карточка раздела «Предложения» — feedback-элемент (FeedbackAdminSection веба).</summary>
public sealed class AdminFeedbackItemViewModel
{
    public AdminFeedbackItemViewModel(HubAdminFeedbackItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = (item.Id ?? string.Empty).Trim();
        Title = MfuFormat.OrDash(item.Title);
        MessageText = (item.Message ?? string.Empty).Trim();
        CategoryText = (item.Category ?? string.Empty).Trim() switch
        {
            "idea" => "Идея",
            "inconvenience" => "Неудобство",
            "bug" => "Ошибка",
            { Length: > 0 } other => other,
            _ => "Другое",
        };
        Status = (item.Status ?? string.Empty).Trim();
        (StatusText, StatusTone) = Status switch
        {
            "new" => ("Новое", "info"),
            "in_progress" => ("В работе", "warning"),
            "accepted" => ("Принято", "primary"),
            "declined" => ("Отклонено", "error"),
            "done" => ("Сделано", "success"),
            { Length: > 0 } other => (other, "muted"),
            _ => ("—", "muted"),
        };
        AuthorText = !string.IsNullOrWhiteSpace(item.Author?.FullName)
            ? item.Author!.FullName!.Trim()
            : MfuFormat.OrDash(item.Author?.Username);
        SectionText = (item.Section ?? string.Empty).Trim();
        CreatedText = MfuFormat.FormatDateTime(item.CreatedAt);
        MetaText = AdminUserItemViewModel.JoinParts(AuthorText, CategoryText, SectionText, CreatedText);
        AdminNoteText = (item.AdminNote ?? string.Empty).Trim();
        HasAdminNote = AdminNoteText.Length > 0;
        AutomationName = $"Предложение {Title}";
        SearchIndex = string.Join(' ', Title, MessageText, AuthorText, SectionText)
            .ToLowerInvariant();
    }

    public string Id { get; }
    public string Title { get; }
    public string MessageText { get; }
    public string CategoryText { get; }
    public string Status { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string AuthorText { get; }
    public string SectionText { get; }
    public string CreatedText { get; }
    public string MetaText { get; }
    public string AdminNoteText { get; }
    public bool HasAdminNote { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }
}

/// <summary>Строка раздела «AI-боты» (AiBotsTab веба, read-срез).</summary>
public sealed class AdminAiBotItemViewModel
{
    public AdminAiBotItemViewModel(HubAdminAiBot bot)
    {
        ArgumentNullException.ThrowIfNull(bot);
        var slug = (bot.Slug ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(bot.Title) ? bot.Title.Trim() : (slug.Length > 0 ? slug : "—");
        SlugText = slug;
        ModelText = MfuFormat.OrDash(bot.Model);
        DescriptionText = (bot.Description ?? string.Empty).Trim();
        StatusText = bot.IsEnabled ? "Включён" : "Выключен";
        StatusTone = bot.IsEnabled ? "success" : "muted";
        ConfiguredText = bot.Configured ? "Настроен" : "Не настроен";
        RunStatusText = (bot.LatestRunStatus ?? string.Empty).Trim() switch
        {
            "success" => "успешно",
            "error" => "ошибка",
            "running" => "выполняется",
            "queued" => "в очереди",
            { Length: > 0 } other => other,
            _ => "—",
        };
        UpdatedText = MfuFormat.FormatDateTime(bot.UpdatedAt);
        AutomationName = $"AI-бот {Title}";
        SearchIndex = string.Join(' ', Title, slug, bot.Model, bot.Description).ToLowerInvariant();
    }

    public string Title { get; }
    public string SlugText { get; }
    public string ModelText { get; }
    public string DescriptionText { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string ConfiguredText { get; }
    public string RunStatusText { get; }
    public string UpdatedText { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }
}

/// <summary>Строка раздела «Система» — маршрут метрик запросов.</summary>
public sealed class AdminRouteStatItemViewModel
{
    public AdminRouteStatItemViewModel(HubAdminRouteStat route)
    {
        ArgumentNullException.ThrowIfNull(route);
        MethodText = MfuFormat.OrDash(route.Method);
        PathText = MfuFormat.OrDash(route.Path);
        CountText = route.Count.ToString(CultureInfo.InvariantCulture);
        ServerErrorsText = route.ServerErrorCount.ToString(CultureInfo.InvariantCulture);
        ClientErrorsText = route.ClientErrorCount.ToString(CultureInfo.InvariantCulture);
        ServerErrorsTone = route.ServerErrorCount > 0 ? "error" : "muted";
        P95Text = $"{route.P95Ms:0} мс";
        MaxText = $"{route.MaxMs:0} мс";
        AutomationName = $"Маршрут {MethodText} {PathText}";
        SearchIndex = string.Join(' ', route.Method, route.Path).ToLowerInvariant();
    }

    public string MethodText { get; }
    public string PathText { get; }
    public string CountText { get; }
    public string ServerErrorsText { get; }
    public string ClientErrorsText { get; }
    public string ServerErrorsTone { get; }
    public string P95Text { get; }
    public string MaxText { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }
}

/// <summary>
/// Страница «🛠 Админ» — первый нативный срез веб-админки (/admin):
/// левое меню секций как в вебе, списки с клиентским поиском, деталь отдела.
/// Только чтение: импорт/синхронизация AD, правка пользователей и начальников,
/// смена статуса предложений и правка AI-ботов остаются в вебе (отложено).
/// Видимость секций — по role/permissions из /auth/me (как getAvailableAdminSections);
/// 403 конкретного раздела — подсказка «Недостаточно прав» вместо баннера-краха.
/// </summary>
public sealed class AdminViewModel : ObservableObject
{
    /// <summary>Число предложений за одну загрузку (limit API — до 200).</summary>
    private const int FeedbackPageSize = 200;

    /// <summary>Число маршрутов в таблице метрик (limit API).</summary>
    private const int MetricsRoutesLimit = 50;

    private static readonly (string Value, string Label)[] FeedbackStatusChips =
    [
        ("", "Все"),
        ("new", "Новое"),
        ("in_progress", "В работе"),
        ("accepted", "Принято"),
        ("declined", "Отклонено"),
        ("done", "Сделано"),
    ];

    private readonly IHubApiClient _api;

    /// <summary>Права/разделы вычислены по /auth/me и есть хотя бы один раздел.</summary>
    private bool _accessResolved;

    /// <summary>Ид применять данные может только последняя загрузка.</summary>
    private int _loadRequest;

    /// <summary>Подавление CheckRequested при программной синхронизации галочек.</summary>
    private bool _suppressSectionCheck;
    private bool _suppressChipCheck;

    private CancellationTokenSource? _detailLoadCancellation;

    // Полные списки активного раздела — поиск/фильтры режут их локально.
    private List<AdminUserItemViewModel> _allUsers = [];
    private List<AdminDepartmentItemViewModel> _allDepartments = [];
    private List<AdminAdUserItemViewModel> _allAdUsers = [];
    private List<AdminFeedbackItemViewModel> _allFeedback = [];
    private List<AdminAiBotItemViewModel> _allAiBots = [];
    private List<AdminRouteStatItemViewModel> _allRoutes = [];

    private AdminSectionItem? _selectedSection;
    private AdminDepartmentItemViewModel? _selectedDepartment;
    private string _searchText = string.Empty;
    private string _selectedFeedbackStatus = string.Empty;
    private bool _isLoading;
    private bool _isDepartmentDetailLoading;
    private string? _bannerErrorText;
    private string? _sectionDeniedText;
    private string? _departmentDetailErrorText;
    private bool _showAccessDenied;
    private string _accessDeniedText = string.Empty;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private string _syncStatusText = string.Empty;
    private string _metricsSummaryText = string.Empty;
    private string _metricsUptimeText = string.Empty;

    public AdminViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        foreach (var (value, label) in FeedbackStatusChips)
        {
            var chip = new AdminFilterChipItem(value, label);
            chip.CheckRequested = OnFeedbackChipCheckRequested;
            FeedbackChips.Add(chip);
        }

        FeedbackChips[0].IsChecked = true;

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectSectionCommand = new NativeAsyncCommand(
            (parameter, ct) =>
            {
                if (parameter is AdminSectionItem section)
                {
                    SelectedSection = section;
                }

                return LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Users.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        Departments.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        AdUsers.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        FeedbackItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        AiBots.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        Routes.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Секции и состояние ----

    /// <summary>Видимые разделы — после /auth/me (admin видит все).</summary>
    public ObservableCollection<AdminSectionItem> Sections { get; } = [];

    /// <summary>Выбранный раздел: переключение — через SelectSectionCommand.</summary>
    public AdminSectionItem? SelectedSection
    {
        get => _selectedSection;
        set
        {
            if (SetProperty(ref _selectedSection, value))
            {
                _suppressSectionCheck = true;
                try
                {
                    foreach (var item in Sections)
                    {
                        item.IsChecked = ReferenceEquals(item, value);
                    }
                }
                finally
                {
                    _suppressSectionCheck = false;
                }

                OnPropertyChanged(nameof(IsUsersSection));
                OnPropertyChanged(nameof(IsDepartmentsSection));
                OnPropertyChanged(nameof(IsAdUsersSection));
                OnPropertyChanged(nameof(IsAiBotsSection));
                OnPropertyChanged(nameof(IsFeedbackSection));
                OnPropertyChanged(nameof(IsSystemSection));
                OnPropertyChanged(nameof(SectionTitleText));
                OnPropertyChanged(nameof(SearchPlaceholderText));
                OnPropertyChanged(nameof(EmptyText));
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public bool IsUsersSection => SelectedSection?.Key == "users";
    public bool IsDepartmentsSection => SelectedSection?.Key == "departments";
    public bool IsAdUsersSection => SelectedSection?.Key == "ad-users";
    public bool IsAiBotsSection => SelectedSection?.Key == "ai-bots";
    public bool IsFeedbackSection => SelectedSection?.Key == "feedback";
    public bool IsSystemSection => SelectedSection?.Key == "system";

    public string SectionTitleText => SelectedSection?.Title ?? "Администрирование";

    /// <summary>Поиск по списку активного раздела — клиентский, как в вебе.</summary>
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

    public string SearchPlaceholderText => SelectedSection?.Key switch
    {
        "users" => "Имя, логин, почта или отдел…",
        "departments" => "Название отдела…",
        "ad-users" => "Имя, логин, отдел или почта…",
        "ai-bots" => "Название или модель бота…",
        "feedback" => "Заголовок, автор или раздел…",
        "system" => "Метод или путь…",
        _ => "Поиск…",
    };

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

    /// <summary>Страница без ни одного доступного раздела — дружелюбная подсказка.</summary>
    public bool ShowAccessDenied
    {
        get => _showAccessDenied;
        private set => SetProperty(ref _showAccessDenied, value);
    }

    public string AccessDeniedText
    {
        get => _accessDeniedText;
        private set => SetProperty(ref _accessDeniedText, value);
    }

    /// <summary>403 по конкретному разделу — подсказка в области контента, не крах.</summary>
    public string? SectionDeniedText
    {
        get => _sectionDeniedText;
        private set
        {
            if (SetProperty(ref _sectionDeniedText, value))
            {
                OnPropertyChanged(nameof(HasSectionDenied));
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public bool HasSectionDenied => !string.IsNullOrEmpty(SectionDeniedText);

    /// <summary>Список активного раздела пуст (загрузка завершена, ошибок нет).</summary>
    public bool IsEmpty =>
        !IsLoading
        && !HasBannerError
        && !HasSectionDenied
        && !ShowAccessDenied
        && SelectedSection is not null
        && ActiveItemCount == 0;

    private int ActiveItemCount => SelectedSection?.Key switch
    {
        "users" => Users.Count,
        "departments" => Departments.Count,
        "ad-users" => AdUsers.Count,
        "ai-bots" => AiBots.Count,
        "feedback" => FeedbackItems.Count,
        "system" => Routes.Count,
        _ => 0,
    };

    public string EmptyText => SelectedSection?.Key switch
    {
        "users" => "Пользователей не найдено",
        "departments" => "Отделы не найдены",
        "ad-users" => "Пользователи AD не найдены",
        "ai-bots" => "AI-боты не настроены",
        "feedback" => "Предложений с таким статусом пока нет",
        "system" => "Метрики по маршрутам пока не собраны",
        _ => "Нет данных",
    };

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

    // ---- Данные разделов ----

    public ObservableCollection<AdminUserItemViewModel> Users { get; } = [];
    public ObservableCollection<AdminDepartmentItemViewModel> Departments { get; } = [];
    public ObservableCollection<AdminAdUserItemViewModel> AdUsers { get; } = [];
    public ObservableCollection<AdminFeedbackItemViewModel> FeedbackItems { get; } = [];
    public ObservableCollection<AdminAiBotItemViewModel> AiBots { get; } = [];
    public ObservableCollection<AdminRouteStatItemViewModel> Routes { get; } = [];

    /// <summary>Строка статуса AD-синхронизации над списком (некритичная — как в вебе).</summary>
    public string SyncStatusText
    {
        get => _syncStatusText;
        private set => SetProperty(ref _syncStatusText, value);
    }

    /// <summary>Сводка метрик запросов над таблицей маршрутов.</summary>
    public string MetricsSummaryText
    {
        get => _metricsSummaryText;
        private set => SetProperty(ref _metricsSummaryText, value);
    }

    public string MetricsUptimeText
    {
        get => _metricsUptimeText;
        private set => SetProperty(ref _metricsUptimeText, value);
    }

    /// <summary>Чипы фильтра статусов предложений (Все + 5, с серверными счётчиками).</summary>
    public ObservableCollection<AdminFilterChipItem> FeedbackChips { get; } = [];

    public string SelectedFeedbackStatus
    {
        get => _selectedFeedbackStatus;
        private set
        {
            if (SetProperty(ref _selectedFeedbackStatus, value))
            {
                ApplyFilter();
            }
        }
    }

    /// <summary>Выбранный отдел — деталь (состав) подгружается отдельно.</summary>
    public AdminDepartmentItemViewModel? SelectedDepartment
    {
        get => _selectedDepartment;
        set
        {
            if (SetProperty(ref _selectedDepartment, value))
            {
                OnPropertyChanged(nameof(HasSelectedDepartment));
                OnPropertyChanged(nameof(DepartmentDetailTitle));
                if (value is not null)
                {
                    _ = LoadDepartmentDetailSafelyAsync(value);
                }
                else
                {
                    DepartmentMembers.Clear();
                }
            }
        }
    }

    public bool HasSelectedDepartment => SelectedDepartment is not null;
    public string DepartmentDetailTitle =>
        SelectedDepartment is null ? string.Empty : $"Состав отдела «{SelectedDepartment.Title}»";

    public ObservableCollection<AdminDepartmentMemberItemViewModel> DepartmentMembers { get; } = [];

    public bool IsDepartmentDetailLoading
    {
        get => _isDepartmentDetailLoading;
        private set => SetProperty(ref _isDepartmentDetailLoading, value);
    }

    public string? DepartmentDetailErrorText
    {
        get => _departmentDetailErrorText;
        private set
        {
            if (SetProperty(ref _departmentDetailErrorText, value))
            {
                OnPropertyChanged(nameof(HasDepartmentDetailError));
            }
        }
    }

    public bool HasDepartmentDetailError => !string.IsNullOrEmpty(DepartmentDetailErrorText);

    public ICommand RefreshCommand { get; }
    public ICommand SelectSectionCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>
    /// Первичная загрузка/обновление: /auth/me → видимые разделы → данные
    /// активного раздела. 403 раздела — подсказка, остальные ошибки — наружу (баннер).
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var request = Interlocked.Increment(ref _loadRequest);
        IsLoading = true;
        try
        {
            if (!await EnsureAccessAsync(cancellationToken))
            {
                return;
            }

            var section = SelectedSection;
            if (section is null)
            {
                return;
            }

            SectionDeniedText = null;
            try
            {
                switch (section.Key)
                {
                    case "users":
                        await LoadUsersAsync(cancellationToken);
                        break;
                    case "departments":
                        await LoadDepartmentsAsync(cancellationToken);
                        break;
                    case "ad-users":
                        await LoadAdUsersAsync(cancellationToken);
                        break;
                    case "ai-bots":
                        await LoadAiBotsAsync(cancellationToken);
                        break;
                    case "feedback":
                        await LoadFeedbackAsync(cancellationToken);
                        break;
                    case "system":
                        await LoadSystemMetricsAsync(cancellationToken);
                        break;
                }

                if (request != _loadRequest)
                {
                    return;
                }

                BannerErrorText = null;
                LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            }
            catch (HubApiException exception)
                when (exception.StatusCode == HttpStatusCode.Forbidden)
            {
                if (request != _loadRequest)
                {
                    return;
                }

                // Не крах и не баннер: право на просмотр раздела может отличаться
                // от права на список (например ad_users.read vs admin-only import-candidates).
                SectionDeniedText =
                    $"Недостаточно прав для раздела «{section.Title}». " +
                    "Если доступ нужен — обратитесь к администратору HUB.";
            }
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// /auth/me → видимые разделы (матрица как у getAvailableAdminSections веба).
    /// false — разделов нет: страница показывает подсказку «Недостаточно прав».
    /// </summary>
    private async Task<bool> EnsureAccessAsync(CancellationToken cancellationToken)
    {
        if (_accessResolved)
        {
            return true;
        }

        var user = await _api.GetCurrentUserAsync(cancellationToken);
        var sections = BuildSections(user);
        if (sections.Count == 0)
        {
            // Не кэшируем отказ: права могут выдать, «Обновить» проверит заново.
            ShowAccessDenied = true;
            AccessDeniedText =
                "Раздел «Администрирование» доступен администраторам HUB " +
                "и пользователям с особыми правами.";
            return false;
        }

        _suppressSectionCheck = true;
        try
        {
            foreach (var section in sections)
            {
                section.CheckRequested = OnSectionCheckRequested;
                Sections.Add(section);
            }
        }
        finally
        {
            _suppressSectionCheck = false;
        }

        SelectedSection = sections[0];
        _accessResolved = true;
        ShowAccessDenied = false;
        return true;
    }

    /// <summary>
    /// Матрица видимости разделов — подмножество getAvailableAdminSections веба:
    /// admin видит всё; иначе — по явным правам (в т.ч. adminOnlyFallback для AD).
    /// </summary>
    internal static List<AdminSectionItem> BuildSections(HubUser? user)
    {
        var isAdmin = string.Equals(user?.Role?.Trim(), "admin", StringComparison.OrdinalIgnoreCase);
        var permissions = new HashSet<string>(user?.Permissions ?? [], StringComparer.Ordinal);
        bool Has(string permission) => isAdmin || permissions.Contains(permission);
        var items = new List<AdminSectionItem>();
        if (Has("settings.users.manage"))
        {
            items.Add(new AdminSectionItem("users", "Пользователи", "👥", "Учётные записи HUB"));
        }

        if (Has("departments.manage"))
        {
            items.Add(new AdminSectionItem("departments", "Отделы", "🏢", "Состав и начальники"));
        }

        if (isAdmin || permissions.Contains("ad_users.read") || permissions.Contains("ad_users.manage"))
        {
            items.Add(new AdminSectionItem("ad-users", "Пользователи AD", "🗂", "Импорт и синхронизация AD"));
        }

        if (Has("settings.ai.manage"))
        {
            items.Add(new AdminSectionItem("ai-bots", "AI-боты", "🤖", "Конфигурация и запуски"));
        }

        if (Has("feedback.manage"))
        {
            items.Add(new AdminSectionItem("feedback", "Предложения", "💡", "Идеи пользователей"));
        }

        if (isAdmin)
        {
            items.Add(new AdminSectionItem("system", "Система", "⚙", "Метрики запросов"));
        }

        return items;
    }

    private void OnSectionCheckRequested(AdminSectionItem item)
    {
        if (_suppressSectionCheck || ReferenceEquals(item, SelectedSection))
        {
            return;
        }

        SelectSectionCommand.Execute(item);
    }

    private void OnFeedbackChipCheckRequested(AdminFilterChipItem item)
    {
        if (_suppressChipCheck)
        {
            return;
        }

        _suppressChipCheck = true;
        try
        {
            foreach (var chip in FeedbackChips)
            {
                chip.IsChecked = ReferenceEquals(chip, item);
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        SelectedFeedbackStatus = item.Value;
    }

    // ---- Загрузка разделов ----

    private async Task LoadUsersAsync(CancellationToken cancellationToken)
    {
        var users = await _api.GetAdminUsersAsync(cancellationToken);
        _allUsers = (users ?? []).Select(u => new AdminUserItemViewModel(u)).ToList();
        ApplyFilter();
        TotalText = FormatCount(_allUsers.Count, "пользователь", "пользователя", "пользователей");
    }

    private async Task LoadDepartmentsAsync(CancellationToken cancellationToken)
    {
        var page = await _api.GetAdminDepartmentsAsync(includeInactive: false, cancellationToken);
        _allDepartments = (page.Items ?? [])
            .Select(d => new AdminDepartmentItemViewModel(d))
            .ToList();
        ApplyFilter();
        // Выбор сохраняем, если отдел ещё в списке (как selectedDepartmentId веба).
        SelectedDepartment = Departments.FirstOrDefault(d => d.Id == SelectedDepartment?.Id)
            ?? Departments.FirstOrDefault();
        TotalText = FormatCount(_allDepartments.Count, "отдел", "отдела", "отделов");
    }

    private async Task LoadAdUsersAsync(CancellationToken cancellationToken)
    {
        var candidates = await _api.GetAdminAdImportCandidatesAsync(cancellationToken);
        _allAdUsers = (candidates ?? []).Select(u => new AdminAdUserItemViewModel(u)).ToList();
        ApplyFilter();
        TotalText = FormatCount(_allAdUsers.Count, "учётная запись AD", "учётные записи AD", "учётных записей AD");
        // sync-status — некритичная строка состояния: в вебе её ошибка только в консоли.
        try
        {
            var sync = await _api.GetAdminAdSyncStatusAsync(cancellationToken);
            SyncStatusText = FormatSyncStatus(sync);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            SyncStatusText = string.Empty;
        }
    }

    private async Task LoadAiBotsAsync(CancellationToken cancellationToken)
    {
        var bots = await _api.GetAdminAiBotsAsync(cancellationToken);
        _allAiBots = (bots ?? []).Select(b => new AdminAiBotItemViewModel(b)).ToList();
        ApplyFilter();
        TotalText = FormatCount(_allAiBots.Count, "AI-бот", "AI-бота", "AI-ботов");
    }

    private async Task LoadFeedbackAsync(CancellationToken cancellationToken)
    {
        var page = await _api.GetAdminFeedbackAsync(
            status: null,
            FeedbackPageSize,
            offset: 0,
            cancellationToken);
        _allFeedback = (page.Items ?? []).Select(i => new AdminFeedbackItemViewModel(i)).ToList();
        UpdateFeedbackChips(page.Counts);
        ApplyFilter();
        TotalText = FormatCount(page.Total, "предложение", "предложения", "предложений");
    }

    private async Task LoadSystemMetricsAsync(CancellationToken cancellationToken)
    {
        var metrics = await _api.GetAdminRequestMetricsAsync(
            MetricsRoutesLimit, sortBy: "p95_ms", cancellationToken);
        _allRoutes = (metrics.Routes ?? []).Select(r => new AdminRouteStatItemViewModel(r)).ToList();
        ApplyFilter();
        MetricsSummaryText = metrics.Enabled
            ? $"Запросов: {metrics.TotalRequests.ToString(CultureInfo.InvariantCulture)}"
                + $" · маршрутов: {metrics.RouteCount.ToString(CultureInfo.InvariantCulture)}"
                + $" · ошибок 5xx: {metrics.TotalServerErrors.ToString(CultureInfo.InvariantCulture)}"
                + $" ({metrics.ServerErrorRate * 100:0.##}%)"
            : "Сбор метрик запросов выключен на сервере";
        MetricsUptimeText = metrics.Enabled
            ? $"Uptime: {MfuFormat.FormatUptime((long)metrics.UptimeSec)}"
                + $" · с {MfuFormat.FormatDateTime(metrics.StartedAt)}"
            : string.Empty;
        TotalText = FormatCount(_allRoutes.Count, "маршрут", "маршрута", "маршрутов");
    }

    private async Task LoadDepartmentDetailSafelyAsync(AdminDepartmentItemViewModel department)
    {
        var cancellation = ResetDetailLoadCancellation();
        IsDepartmentDetailLoading = true;
        DepartmentDetailErrorText = null;
        try
        {
            var payload = await _api.GetAdminDepartmentMembersAsync(department.Id, cancellation.Token);
            if (!ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                return;
            }

            DepartmentMembers.Clear();
            foreach (var member in GroupMembers(payload.Items))
            {
                DepartmentMembers.Add(member);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (HubApiException exception) when (exception.StatusCode == HttpStatusCode.Forbidden)
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                DepartmentDetailErrorText = "Недостаточно прав для просмотра состава отдела.";
            }
        }
        catch (Exception exception)
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                DepartmentDetailErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDepartmentDetailLoading = false;
            }
        }
    }

    private CancellationTokenSource ResetDetailLoadCancellation()
    {
        var previous = _detailLoadCancellation;
        _detailLoadCancellation = new CancellationTokenSource();
        try
        {
            previous?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        return _detailLoadCancellation;
    }

    /// <summary>
    /// memberRows веба: membership-строки схлопываются по user_id —
    /// один пользователь, набор активных ролей (начальник/участник).
    /// </summary>
    private static List<AdminDepartmentMemberItemViewModel> GroupMembers(
        IReadOnlyList<HubAdminDepartmentMember>? items)
    {
        var byUser = new Dictionary<long, (HubAdminDepartmentMemberUser? User, HashSet<string> Roles)>();
        foreach (var item in items ?? [])
        {
            if (item.UserId <= 0)
            {
                continue;
            }

            if (!byUser.TryGetValue(item.UserId, out var entry))
            {
                entry = (item.User, new HashSet<string>(StringComparer.Ordinal));
            }

            if (entry.User is null && item.User is not null)
            {
                entry.User = item.User;
            }

            if (item.IsActive)
            {
                entry.Roles.Add(string.IsNullOrWhiteSpace(item.Role) ? "member" : item.Role!.Trim());
            }

            byUser[item.UserId] = entry;
        }

        return byUser
            .Select(pair => new AdminDepartmentMemberItemViewModel(
                pair.Value.User, pair.Key, pair.Value.Roles.Order().ToList()))
            .OrderBy(row => row.Title, StringComparer.Create(new CultureInfo("ru-RU"), false))
            .ToList();
    }

    private void UpdateFeedbackChips(Dictionary<string, int>? counts)
    {
        var countsValue = counts ?? [];
        var totalAll = FeedbackStatusChips.Skip(1).Sum(pair => countsValue.GetValueOrDefault(pair.Value));
        _suppressChipCheck = true;
        try
        {
            for (var index = 0; index < FeedbackChips.Count; index++)
            {
                var chip = FeedbackChips[index];
                var count = chip.Value.Length == 0 ? totalAll : countsValue.GetValueOrDefault(chip.Value);
                chip.SetLabel($"{FeedbackStatusChips[index].Label} ({count})");
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }
    }

    private void ApplyFilter()
    {
        var query = _searchText.Trim().ToLowerInvariant();
        ApplyTo(Users, _allUsers, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
        ApplyTo(Departments, _allDepartments, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
        ApplyTo(AdUsers, _allAdUsers, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
        ApplyTo(AiBots, _allAiBots, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
        ApplyTo(Routes, _allRoutes, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
        ApplyTo(FeedbackItems, _allFeedback, item =>
            (_selectedFeedbackStatus.Length == 0 || item.Status == _selectedFeedbackStatus)
            && item.SearchIndex.Contains(query, StringComparison.Ordinal));
        OnPropertyChanged(nameof(IsEmpty));
    }

    private static void ApplyTo<T>(
        ObservableCollection<T> target,
        List<T> source,
        Func<T, bool> matches)
    {
        target.Clear();
        foreach (var item in source)
        {
            if (matches(item))
            {
                target.Add(item);
            }
        }
    }

    private static string FormatSyncStatus(HubAdminAdSyncStatus? sync)
    {
        if (sync is null)
        {
            return string.Empty;
        }

        var parts = new List<string> { $"Последняя синхронизация: {MfuFormat.FormatDateTime(sync.LastSyncAt)}" };
        if (sync.Result is { } result)
        {
            parts.Add(
                $"создано {result.Created}, обновлено {result.Updated}, " +
                $"реактивировано {result.Reactivated}, деактивировано {result.Deactivated}");
        }

        if (!string.IsNullOrWhiteSpace(sync.Error))
        {
            parts.Add($"Ошибка: {sync.Error.Trim()}");
        }

        return string.Join(" · ", parts);
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
        Interlocked.Increment(ref _loadRequest);
        _accessResolved = false;
        _suppressSectionCheck = true;
        try
        {
            Sections.Clear();
            SelectedSection = null;
        }
        finally
        {
            _suppressSectionCheck = false;
        }

        _allUsers = [];
        _allDepartments = [];
        _allAdUsers = [];
        _allFeedback = [];
        _allAiBots = [];
        _allRoutes = [];
        Users.Clear();
        Departments.Clear();
        AdUsers.Clear();
        FeedbackItems.Clear();
        AiBots.Clear();
        Routes.Clear();
        try
        {
            _detailLoadCancellation?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        _detailLoadCancellation = null;
        SelectedDepartment = null;
        DepartmentMembers.Clear();
        DepartmentDetailErrorText = null;
        IsDepartmentDetailLoading = false;
        _suppressChipCheck = true;
        try
        {
            for (var index = 0; index < FeedbackChips.Count; index++)
            {
                FeedbackChips[index].IsChecked = index == 0;
                FeedbackChips[index].SetLabel(FeedbackStatusChips[index].Label);
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        _selectedFeedbackStatus = string.Empty;
        OnPropertyChanged(nameof(SelectedFeedbackStatus));
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        ShowAccessDenied = false;
        AccessDeniedText = string.Empty;
        SectionDeniedText = null;
        BannerErrorText = null;
        SyncStatusText = string.Empty;
        MetricsSummaryText = string.Empty;
        MetricsUptimeText = string.Empty;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
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
