using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

public enum HubShellState
{
    /// <summary>Восстановление сессии.</summary>
    Boot,
    SignedOut,
    Ready,
}

/// <summary>
/// Шелл нативного клиента: bearer-сессия (логин/пароль + TOTP), левая навигация
/// и страницы. Дочерние страницы получают тот же IHubApiClient.
/// </summary>
public sealed class HubShellViewModel : ObservableObject
{
    /// <summary>Идентификатор страницы «Профиль» (CommandParameter в XAML и тестах).</summary>
    public const string ProfilePageId = "profile";

    /// <summary>Идентификатор страницы «Настройки» (CommandParameter в XAML и тестах).</summary>
    public const string SettingsPageId = "settings";

    private readonly IHubApiClient _api;
    private readonly SynchronizationContext? _syncContext;
    private readonly IHubRealtime? _injectedHubRealtime;
    private IHubRealtime? _hubRealtime;
    private bool _hubRealtimeSubscribed;
    /// <summary>Первый hub.realtime.connected после старта — холодный коннект сразу
    /// за инициализацией страниц, повторный (reconnect) — догоняет пропущенное.</summary>
    private bool _hubRealtimeConnectedOnce;

    private HubShellState _state = HubShellState.Boot;
    private object? _currentPage;
    private string _loginUsername = string.Empty;
    private string _twoFactorCode = string.Empty;
    private string? _loginChallengeId;
    private bool _requiresTwoFactor;
    private string? _loginErrorText;
    private bool _isLoginBusy;
    private string _userDisplayName = string.Empty;

    public HubShellViewModel(IHubApiClient api)
        : this(api, hubRealtime: null)
    {
    }

    /// <summary>Тестовый шов: realtime-подключение подменяется фейком (как у чата).</summary>
    internal HubShellViewModel(IHubApiClient api, IHubRealtime? hubRealtime)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _syncContext = SynchronizationContext.Current;
        _injectedHubRealtime = hubRealtime;
        _hubRealtime = hubRealtime;
        _api.SessionEnded += Api_SessionEnded;

        Dashboard = new DashboardViewModel(api);
        Tasks = new TasksViewModel(api);
        Tickets = new TicketsViewModel(api);
        News = new NewsViewModel(api);
        Chat = new ChatViewModel(api);
        Mail = new MailViewModel(api);
        Docflow = new DocflowViewModel(api);
        MyFiles = new MyFilesViewModel(api);
        Absences = new AbsencesViewModel(api);
        AddressBook = new AddressBookViewModel(api);
        CompanyStructure = new CompanyStructureViewModel(api);
        ItObjects = new ItObjectsViewModel(api);
        Networks = new NetworksViewModel(api);
        Computers = new ComputersViewModel(api);
        Database = new DatabaseViewModel(api);
        GroupsAccess = new GroupsAccessViewModel(api);
        Vcs = new VcsViewModel(api);
        Monitoring = new MonitoringViewModel(api);
        Mfu = new MfuViewModel(api);
        Statistics = new StatisticsViewModel(api);
        Help = new HelpViewModel(api);
        Settings = new SettingsViewModel(api);
        Admin = new AdminViewModel(api);
        // async-void: без try/catch сетевая ошибка ушла бы в DispatcherUnhandledException.
        Dashboard.TaskOpenRequested += async (_, taskId) =>
        {
            try
            {
                await NavigateToTaskAsync(taskId);
            }
            catch (Exception exception)
            {
                Tasks.SetLoadError(TasksViewModel.DescribeError(exception));
            }
        };
        Dashboard.NewsOpenRequested += async (_, newsId) =>
        {
            try
            {
                await NavigateToNewsAsync(newsId);
            }
            catch (Exception exception)
            {
                News.SetLoadError(TasksViewModel.DescribeError(exception));
            }
        };
        _currentPage = Dashboard;

        // Бейджи навигации: непрочитанные новости + диалоги чата + письма.
        News.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(NewsViewModel.UnreadTotal))
            {
                UpdateNavBadges();
                Dashboard.SetNewsUnreadCount(News.UnreadTotal);
            }
        };
        Chat.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(ChatViewModel.TotalUnreadCount))
            {
                UpdateNavBadges();
            }
        };
        Mail.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(MailViewModel.TotalUnreadCount))
            {
                UpdateNavBadges();
            }
        };
        Docflow.PropertyChanged += (_, args) =>
        {
            if (args.PropertyName == nameof(DocflowViewModel.InboxCount))
            {
                UpdateNavBadges();
            }
        };

        SignInCommand = new NativeAsyncCommand(
            (parameter, ct) => SignInAsync(parameter as string ?? string.Empty, ct),
            ex => LoginErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSignIn);
        VerifyTwoFactorCommand = new NativeAsyncCommand(
            (_, ct) => VerifyTwoFactorAsync(ct),
            ex => LoginErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSignIn);
        LogoutCommand = new NativeAsyncCommand(
            async (_, ct) =>
            {
                await _api.LogoutAsync(ct);
                EnterSignedOut();
            },
            _ => EnterSignedOut());
        Profile = new ProfileViewModel(api, LogoutCommand);
        NavigateToPageCommand = new NativeRelayCommand(parameter =>
            CurrentPage = parameter switch
            {
                "tasks" => Tasks,
                "tickets" => Tickets,
                "news" => News,
                "chat" => Chat,
                "mail" => Mail,
                "docflow" => Docflow,
                "myfiles" => MyFiles,
                "absences" => Absences,
                "addressbook" => AddressBook,
                "structure" => CompanyStructure,
                "itobjects" => ItObjects,
                "networks" => Networks,
                "computers" => Computers,
                "database" => Database,
                "groupsaccess" => GroupsAccess,
                "vcs" => Vcs,
                "monitoring" => Monitoring,
                "mfu" => Mfu,
                "statistics" => Statistics,
                "help" => Help,
                SettingsPageId => Settings,
                ProfilePageId => Profile,
                "admin" => Admin,
                _ => Dashboard,
            });
        NavigateToTasksCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                var filter = parameter as string ?? "all";
                CurrentPage = Tasks;
                Tasks.StatusFilter = filter;
                await Tasks.LoadTasksAsync(ct);
            },
            ex => Tasks.SetLoadError(TasksViewModel.DescribeError(ex)));
        OpenStatCardCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                if (parameter is not DashboardStatCard card)
                {
                    return;
                }

                if (!string.IsNullOrEmpty(card.TaskFilterToOpen))
                {
                    CurrentPage = Tasks;
                    Tasks.StatusFilter = card.TaskFilterToOpen;
                    await Tasks.LoadTasksAsync(ct);
                }
                else if (!string.IsNullOrEmpty(card.PageToOpen))
                {
                    NavigateToPageCommand.Execute(card.PageToOpen);
                }
            },
            ex => Tasks.SetLoadError(TasksViewModel.DescribeError(ex)));
        RefreshCurrentPageCommand = new NativeRelayCommand(() =>
        {
            var command = CurrentPage switch
            {
                TasksViewModel => Tasks.RefreshCommand,
                TicketsViewModel => Tickets.RefreshCommand,
                NewsViewModel => News.RefreshCommand,
                ChatViewModel => Chat.RefreshConversationsCommand,
                MailViewModel => Mail.RefreshCommand,
                DocflowViewModel => Docflow.RefreshCommand,
                MyFilesViewModel => MyFiles.RefreshCommand,
                AbsencesViewModel => Absences.RefreshCommand,
                AddressBookViewModel => AddressBook.RefreshCommand,
                CompanyStructureViewModel => CompanyStructure.RefreshCommand,
                ItObjectsViewModel => ItObjects.RefreshCommand,
                NetworksViewModel => Networks.RefreshCommand,
                ComputersViewModel => Computers.RefreshCommand,
                DatabaseViewModel => Database.RefreshCommand,
                GroupsAccessViewModel => GroupsAccess.RefreshCommand,
                VcsViewModel => Vcs.RefreshCommand,
                MonitoringViewModel => Monitoring.RefreshCommand,
                MfuViewModel => Mfu.RefreshCommand,
                StatisticsViewModel => Statistics.RefreshCommand,
                HelpViewModel => Help.RefreshCommand,
                SettingsViewModel => Settings.RefreshCommand,
                ProfileViewModel => Profile.RefreshCommand,
                AdminViewModel => Admin.RefreshCommand,
                _ => Dashboard.RefreshCommand,
            };
            if (command.CanExecute(null))
            {
                command.Execute(null);
            }
        });
    }

    public DashboardViewModel Dashboard { get; }
    public TasksViewModel Tasks { get; }
    public TicketsViewModel Tickets { get; }
    public NewsViewModel News { get; }
    public ChatViewModel Chat { get; }
    public MailViewModel Mail { get; }
    public DocflowViewModel Docflow { get; }
    public MyFilesViewModel MyFiles { get; }
    public AbsencesViewModel Absences { get; }
    public AddressBookViewModel AddressBook { get; }
    public CompanyStructureViewModel CompanyStructure { get; }
    public ItObjectsViewModel ItObjects { get; }
    public NetworksViewModel Networks { get; }
    public ComputersViewModel Computers { get; }
    public DatabaseViewModel Database { get; }
    public GroupsAccessViewModel GroupsAccess { get; }
    public VcsViewModel Vcs { get; }
    public MonitoringViewModel Monitoring { get; }
    public MfuViewModel Mfu { get; }
    public StatisticsViewModel Statistics { get; }
    public HelpViewModel Help { get; }
    public SettingsViewModel Settings { get; }
    public ProfileViewModel Profile { get; }
    public AdminViewModel Admin { get; }

    public HubShellState State
    {
        get => _state;
        private set
        {
            if (SetProperty(ref _state, value))
            {
                OnPropertyChanged(nameof(IsBoot));
                OnPropertyChanged(nameof(IsSignedOut));
                OnPropertyChanged(nameof(IsReady));
            }
        }
    }

    public bool IsBoot => State == HubShellState.Boot;
    public bool IsSignedOut => State == HubShellState.SignedOut;
    public bool IsReady => State == HubShellState.Ready;

    /// <summary>Текущая страница (DashboardViewModel или TasksViewModel) для ContentControl.</summary>
    public object? CurrentPage
    {
        get => _currentPage;
        private set
        {
            if (SetProperty(ref _currentPage, value))
            {
                OnPropertyChanged(nameof(IsDashboardPage));
                OnPropertyChanged(nameof(IsTasksPage));
                OnPropertyChanged(nameof(IsTicketsPage));
                OnPropertyChanged(nameof(IsNewsPage));
                OnPropertyChanged(nameof(IsChatPage));
                OnPropertyChanged(nameof(IsMailPage));
                OnPropertyChanged(nameof(IsDocflowPage));
                OnPropertyChanged(nameof(IsMyFilesPage));
                OnPropertyChanged(nameof(IsAbsencesPage));
                OnPropertyChanged(nameof(IsAddressBookPage));
                OnPropertyChanged(nameof(IsCompanyStructurePage));
                OnPropertyChanged(nameof(IsItObjectsPage));
                OnPropertyChanged(nameof(IsNetworksPage));
                OnPropertyChanged(nameof(IsComputersPage));
                OnPropertyChanged(nameof(IsDatabasePage));
                OnPropertyChanged(nameof(IsGroupsAccessPage));
                OnPropertyChanged(nameof(IsVcsPage));
                OnPropertyChanged(nameof(IsMonitoringPage));
                OnPropertyChanged(nameof(IsMfuPage));
                OnPropertyChanged(nameof(IsStatisticsPage));
                OnPropertyChanged(nameof(IsHelpPage));
                OnPropertyChanged(nameof(IsSettingsPage));
                OnPropertyChanged(nameof(IsProfilePage));
                OnPropertyChanged(nameof(IsAdminPage));
            }
        }
    }

    /// <summary>Бейджи навигации: непрочитанные новости, сообщения чата и письма.</summary>
    public bool HasNewsUnread => News.UnreadTotal > 0;
    public string NewsUnreadBadgeText => FormatBadgeCount(News.UnreadTotal);
    public string NewsUnreadBadgeName => $"Непрочитанных новостей: {News.UnreadTotal}";
    public bool HasChatUnread => Chat.TotalUnreadCount > 0;
    public string ChatUnreadBadgeText => FormatBadgeCount(Chat.TotalUnreadCount);
    public string ChatUnreadBadgeName => $"Непрочитанных сообщений: {Chat.TotalUnreadCount}";
    public bool HasMailUnread => Mail.TotalUnreadCount > 0;
    public string MailUnreadBadgeText => FormatBadgeCount(Mail.TotalUnreadCount);
    public string MailUnreadBadgeName => $"Непрочитанных писем: {Mail.TotalUnreadCount}";
    public bool HasDocflowUnread => Docflow.InboxCount > 0;
    public string DocflowBadgeText => FormatBadgeCount(Docflow.InboxCount);
    public string DocflowBadgeName => $"Входящих заданий 1С: {Docflow.InboxCount}";

    private static string FormatBadgeCount(int count) => count switch
    {
        > 99 => "99+",
        > 0 => count.ToString(CultureInfo.InvariantCulture),
        _ => string.Empty,
    };

    private void UpdateNavBadges()
    {
        OnPropertyChanged(nameof(HasNewsUnread));
        OnPropertyChanged(nameof(NewsUnreadBadgeText));
        OnPropertyChanged(nameof(NewsUnreadBadgeName));
        OnPropertyChanged(nameof(HasChatUnread));
        OnPropertyChanged(nameof(ChatUnreadBadgeText));
        OnPropertyChanged(nameof(ChatUnreadBadgeName));
        OnPropertyChanged(nameof(HasMailUnread));
        OnPropertyChanged(nameof(MailUnreadBadgeText));
        OnPropertyChanged(nameof(MailUnreadBadgeName));
        OnPropertyChanged(nameof(HasDocflowUnread));
        OnPropertyChanged(nameof(DocflowBadgeText));
        OnPropertyChanged(nameof(DocflowBadgeName));
    }

    public bool IsDashboardPage
    {
        get => ReferenceEquals(CurrentPage, Dashboard);
        set { if (value) CurrentPage = Dashboard; }
    }

    public bool IsTasksPage
    {
        get => ReferenceEquals(CurrentPage, Tasks);
        set { if (value) CurrentPage = Tasks; }
    }

    public bool IsTicketsPage
    {
        get => ReferenceEquals(CurrentPage, Tickets);
        set { if (value) CurrentPage = Tickets; }
    }

    public bool IsNewsPage
    {
        get => ReferenceEquals(CurrentPage, News);
        set { if (value) CurrentPage = News; }
    }

    public bool IsChatPage
    {
        get => ReferenceEquals(CurrentPage, Chat);
        set { if (value) CurrentPage = Chat; }
    }

    public bool IsMailPage
    {
        get => ReferenceEquals(CurrentPage, Mail);
        set { if (value) CurrentPage = Mail; }
    }

    public bool IsDocflowPage
    {
        get => ReferenceEquals(CurrentPage, Docflow);
        set { if (value) CurrentPage = Docflow; }
    }

    public bool IsMyFilesPage
    {
        get => ReferenceEquals(CurrentPage, MyFiles);
        set { if (value) CurrentPage = MyFiles; }
    }

    public bool IsAbsencesPage
    {
        get => ReferenceEquals(CurrentPage, Absences);
        set { if (value) CurrentPage = Absences; }
    }

    public bool IsAddressBookPage
    {
        get => ReferenceEquals(CurrentPage, AddressBook);
        set { if (value) CurrentPage = AddressBook; }
    }

    public bool IsCompanyStructurePage
    {
        get => ReferenceEquals(CurrentPage, CompanyStructure);
        set { if (value) CurrentPage = CompanyStructure; }
    }

    public bool IsItObjectsPage
    {
        get => ReferenceEquals(CurrentPage, ItObjects);
        set { if (value) CurrentPage = ItObjects; }
    }

    public bool IsNetworksPage
    {
        get => ReferenceEquals(CurrentPage, Networks);
        set { if (value) CurrentPage = Networks; }
    }

    public bool IsComputersPage
    {
        get => ReferenceEquals(CurrentPage, Computers);
        set { if (value) CurrentPage = Computers; }
    }

    public bool IsDatabasePage
    {
        get => ReferenceEquals(CurrentPage, Database);
        set { if (value) CurrentPage = Database; }
    }

    public bool IsGroupsAccessPage
    {
        get => ReferenceEquals(CurrentPage, GroupsAccess);
        set { if (value) CurrentPage = GroupsAccess; }
    }

    public bool IsVcsPage
    {
        get => ReferenceEquals(CurrentPage, Vcs);
        set { if (value) CurrentPage = Vcs; }
    }

    public bool IsMonitoringPage
    {
        get => ReferenceEquals(CurrentPage, Monitoring);
        set { if (value) CurrentPage = Monitoring; }
    }

    public bool IsMfuPage
    {
        get => ReferenceEquals(CurrentPage, Mfu);
        set { if (value) CurrentPage = Mfu; }
    }

    public bool IsStatisticsPage
    {
        get => ReferenceEquals(CurrentPage, Statistics);
        set { if (value) CurrentPage = Statistics; }
    }

    public bool IsHelpPage
    {
        get => ReferenceEquals(CurrentPage, Help);
        set { if (value) CurrentPage = Help; }
    }

    public bool IsSettingsPage
    {
        get => ReferenceEquals(CurrentPage, Settings);
        set { if (value) CurrentPage = Settings; }
    }

    public bool IsProfilePage
    {
        get => ReferenceEquals(CurrentPage, Profile);
        set { if (value) CurrentPage = Profile; }
    }

    public bool IsAdminPage
    {
        get => ReferenceEquals(CurrentPage, Admin);
        set { if (value) CurrentPage = Admin; }
    }

    // ---- Логин ----

    public string LoginUsername
    {
        get => _loginUsername;
        set
        {
            if (SetProperty(ref _loginUsername, value))
            {
                RaiseSignInCanExecute();
            }
        }
    }

    public string TwoFactorCode
    {
        get => _twoFactorCode;
        set
        {
            if (SetProperty(ref _twoFactorCode, value))
            {
                RaiseSignInCanExecute();
            }
        }
    }

    public bool RequiresTwoFactor
    {
        get => _requiresTwoFactor;
        private set => SetProperty(ref _requiresTwoFactor, value);
    }

    public string? LoginErrorText
    {
        get => _loginErrorText;
        set => SetProperty(ref _loginErrorText, value);
    }

    public bool IsLoginBusy
    {
        get => _isLoginBusy;
        private set
        {
            if (SetProperty(ref _isLoginBusy, value))
            {
                RaiseSignInCanExecute();
            }
        }
    }

    public bool CanSignIn =>
        !IsLoginBusy
        && !string.IsNullOrWhiteSpace(LoginUsername)
        && (!RequiresTwoFactor || !string.IsNullOrWhiteSpace(TwoFactorCode));

    public string UserDisplayName
    {
        get => _userDisplayName;
        private set => SetProperty(ref _userDisplayName, value);
    }

    public ICommand SignInCommand { get; }
    public ICommand VerifyTwoFactorCommand { get; }
    public ICommand LogoutCommand { get; }
    public ICommand NavigateToPageCommand { get; }
    public ICommand NavigateToTasksCommand { get; }
    public ICommand OpenStatCardCommand { get; }
    public ICommand RefreshCurrentPageCommand { get; }

    /// <summary>Точка входа: восстановление сессии и первичная загрузка страниц.</summary>
    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            var session = await _api.RestoreSessionAsync(cancellationToken);
            if (session is null)
            {
                EnterSignedOut();
                return;
            }

            ApplySession(session);
            State = HubShellState.Ready;
            await LoadPagesAsync(cancellationToken);
        }
        catch (HubApiException ex) when (ex.Kind == HubApiErrorKind.SessionExpired)
        {
            EnterSignedOut();
        }
        catch (Exception ex)
        {
            // Сессия могла быть валидной: страницы покажут свои состояния ошибок.
            State = HubShellState.Ready;
            await LoadPagesAsync(cancellationToken);
            if (Dashboard.HasError && Tasks.HasBannerError)
            {
                LoginErrorText = TasksViewModel.DescribeError(ex);
            }
        }
    }

    public async Task SignInAsync(string password, CancellationToken cancellationToken = default)
    {
        // Любая попытка входа показывает карточку логина (включая ветки 2FA и ошибок).
        State = HubShellState.SignedOut;
        IsLoginBusy = true;
        LoginErrorText = null;
        try
        {
            var result = await _api.LoginAsync(LoginUsername.Trim(), password, cancellationToken);
            switch (result.Status)
            {
                case HubLoginStatus.Authenticated when result.Session is not null:
                    RequiresTwoFactor = false;
                    _loginChallengeId = null;
                    TwoFactorCode = string.Empty;
                    ApplySession(result.Session);
                    State = HubShellState.Ready;
                    await LoadPagesAsync(cancellationToken);
                    break;
                case HubLoginStatus.Authenticated:
                    LoginErrorText = "Сервер вернул неполный ответ. Повторите попытку.";
                    break;
                case HubLoginStatus.TwoFactorRequired:
                    _loginChallengeId = result.LoginChallengeId;
                    RequiresTwoFactor = true;
                    break;
                case HubLoginStatus.TwoFactorSetupRequired:
                    LoginErrorText =
                        "Для учётной записи требуется двухфакторная аутентификация. " +
                        "Выполните первичную настройку 2FA в веб-версии HUB, затем войдите здесь.";
                    break;
            }
        }
        finally
        {
            IsLoginBusy = false;
        }
    }

    public async Task VerifyTwoFactorAsync(CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(_loginChallengeId))
        {
            return;
        }

        State = HubShellState.SignedOut;
        IsLoginBusy = true;
        LoginErrorText = null;
        try
        {
            var result = await _api.VerifyTwoFactorLoginAsync(
                _loginChallengeId,
                TwoFactorCode.Trim(),
                backupCode: null,
                cancellationToken);
            if (result.Status == HubLoginStatus.Authenticated && result.Session is not null)
            {
                RequiresTwoFactor = false;
                _loginChallengeId = null;
                TwoFactorCode = string.Empty;
                ApplySession(result.Session);
                State = HubShellState.Ready;
                await LoadPagesAsync(cancellationToken);
            }
            else
            {
                LoginErrorText = "Не удалось подтвердить код. Проверьте его и повторите попытку.";
            }
        }
        finally
        {
            IsLoginBusy = false;
        }
    }

    public async Task NavigateToTaskAsync(long taskId, CancellationToken cancellationToken = default)
    {
        CurrentPage = Tasks;
        await Tasks.SelectTaskByIdAsync(taskId, cancellationToken);
    }

    public async Task NavigateToNewsAsync(string newsId, CancellationToken cancellationToken = default)
    {
        CurrentPage = News;
        await News.SelectNewsByIdAsync(newsId, cancellationToken);
    }

    /// <summary>
    /// Веб-маршрут deep link'а → идентификатор нативной страницы
    /// (null — раздела в нативном клиенте нет, открывает web-шелл).
    /// </summary>
    public static string? TryMapWebRoute(string? route)
    {
        if (string.IsNullOrWhiteSpace(route))
        {
            return null;
        }

        var path = route.Split('?')[0].TrimEnd('/');
        if (path.Length == 0)
        {
            path = "/";
        }

        var normalizedPath = path.ToLowerInvariant();
        // /admin и вложенные маршруты веб-админки (/admin/users, /admin/ad-users, …).
        if (normalizedPath == "/admin" || normalizedPath.StartsWith("/admin/", StringComparison.Ordinal))
        {
            return "admin";
        }

        return normalizedPath switch
        {
            "/" or "/dashboard" => "dashboard",
            "/tasks" => "tasks",
            "/tickets" => "tickets",
            "/feed" => "news",
            "/chat" => "chat",
            "/mail" => "mail",
            "/docflow" => "docflow",
            "/my-files" => "myfiles",
            "/address-book" => "addressbook",
            "/company-structure" => "structure",
            "/it/objects" => "itobjects",
            "/networks" => "networks",
            "/computers" => "computers",
            "/database" => "database",
            "/groups-access" => "groupsaccess",
            "/vcs" => "vcs",
            "/monitoring" => "monitoring",
            "/mfu" => "mfu",
            "/statistics" => "statistics",
            "/help" or "/kb" => "help",
            "/settings" => "settings",
            _ => null,
        };
    }

    private async Task LoadPagesAsync(CancellationToken cancellationToken)
    {
        // Страницы грузятся последовательно — один HttpClient, предсказуемая нагрузка.
        try
        {
            await Dashboard.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Dashboard.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Tasks.LoadTasksAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Tasks.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Tickets.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Tickets.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await News.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            News.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Chat.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Chat.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Mail.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Mail.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Docflow.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Docflow.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await MyFiles.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            MyFiles.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Absences.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Absences.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await AddressBook.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            AddressBook.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await CompanyStructure.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            CompanyStructure.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await ItObjects.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            ItObjects.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Networks.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Networks.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Computers.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Computers.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Database.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Database.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await GroupsAccess.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            GroupsAccess.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Vcs.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Vcs.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Monitoring.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Monitoring.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Mfu.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Mfu.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Statistics.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Statistics.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Help.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Help.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Settings.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Settings.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        try
        {
            await Admin.LoadAsync(cancellationToken);
        }
        catch (Exception ex)
        {
            Admin.SetLoadError(TasksViewModel.DescribeError(ex));
        }

        // Hub realtime — событийные обновления почты/задач/докфлоу/дашборда.
        // Старт после первичной загрузки: первый connected-кадр не дублирует её
        // (_hubRealtimeConnectedOnce), reconnect — догоняет пропущенное.
        await StartHubRealtimeSafelyAsync();
    }

    private void ApplySession(NativeSession session)
    {
        UserDisplayName = string.IsNullOrWhiteSpace(session.FullName)
            ? session.UserName
            : session.FullName;
        Dashboard.SetUserName(UserDisplayName);
        Profile.SetSession(session);
    }

    private void EnterSignedOut()
    {
        RunOnUi(() =>
        {
            var realtime = _hubRealtime;
            _hubRealtime = _injectedHubRealtime;
            _hubRealtimeSubscribed = false;
            _hubRealtimeConnectedOnce = false;
            if (realtime is not null)
            {
                realtime.EventReceived -= HubRealtime_EventReceived;
                // Лениво созданный клиент — наш, dispose; инжектированный — только stop.
                var dispose = !ReferenceEquals(realtime, _injectedHubRealtime);
                _ = StopHubRealtimeSafelyAsync(realtime, dispose);
            }

            Tasks.Reset();
            Dashboard.Reset();
            Tickets.Reset();
            News.Reset();
            Chat.Reset();
            Mail.Reset();
            Docflow.Reset();
            MyFiles.Reset();
            Absences.Reset();
            AddressBook.Reset();
            CompanyStructure.Reset();
            ItObjects.Reset();
            Networks.Reset();
            Computers.Reset();
            Database.Reset();
            GroupsAccess.Reset();
            Vcs.Reset();
            Monitoring.Reset();
            Mfu.Reset();
            Statistics.Reset();
            Help.Reset();
            Settings.Reset();
            Profile.Reset();
            Admin.Reset();
            UserDisplayName = string.Empty;
            TwoFactorCode = string.Empty;
            RequiresTwoFactor = false;
            _loginChallengeId = null;
            CurrentPage = Dashboard;
            State = HubShellState.SignedOut;
        });
    }

    private void Api_SessionEnded(object? sender, EventArgs e) => EnterSignedOut();

    // ---- Hub realtime ----

    /// <summary>Запуск hub realtime-цикла (ошибки старта не фатальны — REST остаётся).</summary>
    private async Task StartHubRealtimeSafelyAsync()
    {
        var realtime = _hubRealtime ??= new HubRealtimeClient(_api);
        if (!_hubRealtimeSubscribed)
        {
            realtime.EventReceived += HubRealtime_EventReceived;
            _hubRealtimeSubscribed = true;
        }

        try
        {
            await realtime.StartAsync();
        }
        catch
        {
            // Канал не поднялся — страницы живут на явных refresh.
        }
    }

    private static async Task StopHubRealtimeSafelyAsync(IHubRealtime realtime, bool dispose)
    {
        try
        {
            await realtime.StopAsync();
        }
        catch
        {
        }

        if (dispose)
        {
            try
            {
                await realtime.DisposeAsync();
            }
            catch
            {
            }
        }
    }

    private void HubRealtime_EventReceived(object? sender, HubRealtimeEvent realtimeEvent) =>
        RunOnUi(() => HandleHubRealtimeEvent(realtimeEvent));

    /// <summary>
    /// Маршрутизация доменных событий hub realtime в существующие страницы.
    /// События — дешёвые триггеры: данные подтягиваются обычными REST-запросами
    /// (тихие RefreshFromRealtimeAsync без индикаторов и без сброса выбора).
    /// Бейджи навигации едут сами через PropertyChanged счётчиков страниц.
    /// </summary>
    private void HandleHubRealtimeEvent(HubRealtimeEvent realtimeEvent)
    {
        switch (realtimeEvent.Type)
        {
            case "mail.message.received":
            case "mail.unread.changed":
            case "mail.message.state_changed":
                _ = Mail.RefreshFromRealtimeAsync();
                break;
            case "hub.notification.created":
                // Тот же путь, что и mail.*: обновляет бейдж непрочитанных.
                // Дашборд (агрегат «требует внимания») — как в веб-дашборде.
                _ = Mail.RefreshFromRealtimeAsync();
                _ = Dashboard.RefreshFromRealtimeAsync();
                break;
            case "tasks.task.created":
            case "tasks.task.updated":
            case "tasks.task.deleted":
                _ = Tasks.RefreshFromRealtimeAsync();
                _ = Dashboard.RefreshFromRealtimeAsync();
                break;
            case "docflow.task.changed":
                _ = Docflow.RefreshFromRealtimeAsync();
                break;
            case "dashboard.invalidate":
                _ = Dashboard.RefreshFromRealtimeAsync();
                break;
            case "hub.realtime.connected":
                // Reconnect: за разрыв могли пропустить события любого домена —
                // тихий resync всех источников. Первый коннект сессии пропускаем:
                // страницы только что загрузились в LoadPagesAsync.
                if (_hubRealtimeConnectedOnce)
                {
                    _ = Mail.RefreshFromRealtimeAsync();
                    _ = Tasks.RefreshFromRealtimeAsync();
                    _ = Docflow.RefreshFromRealtimeAsync();
                    _ = Dashboard.RefreshFromRealtimeAsync();
                }

                _hubRealtimeConnectedOnce = true;
                break;
            default:
                // integration.1c.* и прочие типы без нативного потребителя.
                break;
        }
    }

    private void RunOnUi(Action action)
    {
        if (_syncContext is null || SynchronizationContext.Current == _syncContext)
        {
            action();
            return;
        }

        _syncContext.Post(_ => action(), null);
    }

    private void RaiseSignInCanExecute()
    {
        (SignInCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (VerifyTwoFactorCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }
}
