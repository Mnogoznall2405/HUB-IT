using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Подписи уровней доступа — ACCESS_LEVEL_META из groupsAccessUtils.js веб-страницы:
/// read → R «Чтение», write → W «Запись», full → F «Полный», member/прочее → + «Доступ».
/// </summary>
internal static class GroupsAccessCatalog
{
    public static string LevelLabel(string? level) => level switch
    {
        "read" => "Чтение",
        "write" => "Запись",
        "full" => "Полный",
        _ => "Доступ",
    };

    /// <summary>Короткая метка ячейки/чипа: R/W/F/+ (пустой уровень — member → +).</summary>
    public static string LevelMark(string? level) => level switch
    {
        "read" => "R",
        "write" => "W",
        "full" => "F",
        _ => "+",
    };

    /// <summary>Тон подсветки метки — color в ACCESS_LEVEL_META (info/warning/error/default→member).</summary>
    public static string LevelTone(string? level) => level switch
    {
        "read" => "info",
        "write" => "warning",
        "full" => "error",
        _ => "member",
    };

    /// <summary>formatDateTime веб-страницы: ISO-время снимка → «дд.мм.гггг чч:мм» локальное.</summary>
    public static string FormatSyncTime(string? value)
    {
        var raw = value?.Trim() ?? string.Empty;
        if (raw.Length == 0)
        {
            return "—";
        }

        return DateTimeOffset.TryParse(
                   raw,
                   CultureInfo.InvariantCulture,
                   DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                   out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : raw;
    }

    /// <summary>Русская плюрализация счётчика: «1 участник / 3 участника / 5 участников».</summary>
    public static string FormatCount(int count, string one, string few, string many)
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

/// <summary>Чип OU-ветки фильтра («Все» + branches из /groups-access/status).</summary>
public sealed class GroupsAccessBranchItem : ObservableObject
{
    private bool _isChecked;

    public GroupsAccessBranchItem(string value, string label)
    {
        Value = value;
        Label = label;
    }

    /// <summary>Значение параметра branch= («» — все ветки).</summary>
    public string Value { get; }
    public string Label { get; }
    public string AutomationName => $"Ветка: {Label}";

    public bool IsChecked
    {
        get => _isChecked;
        set => SetProperty(ref _isChecked, value);
    }
}

/// <summary>
/// Колонка-группа матрицы: метка папки (folder_label/cn), путь OU, ветка,
/// уровень доступа и число участников — как заголовок колонки веб-таблицы.
/// </summary>
public sealed class GroupsAccessGroupItemViewModel
{
    public GroupsAccessGroupItemViewModel(HubGroupsAccessGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        Dn = group.Dn?.Trim() ?? string.Empty;
        Cn = group.Cn?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(group.FolderLabel)
            ? group.FolderLabel!.Trim()
            : Cn.Length > 0 ? Cn : "Группа";
        PathText = group.FolderPath?.Trim() ?? string.Empty;
        BranchText = group.Branch?.Trim() ?? string.Empty;
        Level = group.AccessLevel?.Trim() ?? string.Empty;
        LevelLabel = GroupsAccessCatalog.LevelLabel(Level);
        LevelMark = GroupsAccessCatalog.LevelMark(Level);
        LevelTone = GroupsAccessCatalog.LevelTone(Level);
        MemberCount = group.MemberCount;
        DescriptionText = group.Description?.Trim() ?? string.Empty;
        ToolTipText = string.Join(
            "\n",
            new[]
            {
                Title,
                PathText,
                string.Join(
                    " · ",
                    new[] { BranchText, $"Уровень: {LevelLabel}", MembersCountText }
                        .Where(part => !string.IsNullOrWhiteSpace(part))),
                Dn,
            }.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    /// <summary>DN группы в снимке — ключ выборки ячейки и запроса детали.</summary>
    public string Dn { get; }
    public string Cn { get; }
    public string Title { get; }
    public string PathText { get; }
    public string BranchText { get; }
    public string Level { get; }
    public string LevelLabel { get; }
    public string LevelMark { get; }
    public string LevelTone { get; }
    public int MemberCount { get; }
    public string MembersCountText =>
        GroupsAccessCatalog.FormatCount(MemberCount, "участник", "участника", "участников");

    public string DescriptionText { get; }
    public bool HasDescription => DescriptionText.Length > 0;
    public bool HasPath => PathText.Length > 0;
    public string ToolTipText { get; }
}

/// <summary>
/// Ячейка матрицы «учётка × группа»: короткая метка уровня (R/W/F/+)
/// или «·» — нет доступа. Label — подпись для всплывающей подсказки.
/// </summary>
public sealed class GroupsAccessMatrixCell
{
    public GroupsAccessMatrixCell(string? level)
    {
        Level = level?.Trim() ?? string.Empty;
        HasAccess = Level.Length > 0;
        Mark = HasAccess ? GroupsAccessCatalog.LevelMark(Level) : "·";
        Label = HasAccess ? GroupsAccessCatalog.LevelLabel(Level) : "Нет доступа";
        Tone = HasAccess ? GroupsAccessCatalog.LevelTone(Level) : "muted";
    }

    /// <summary>Сырой уровень доступа (read/write/full/member/…) или «» — нет доступа.</summary>
    public string Level { get; }
    public string Mark { get; }
    public string Label { get; }
    public string Tone { get; }
    public bool HasAccess { get; }
}

/// <summary>
/// Строка матрицы — учётная запись + ячейки по колонкам-группам (порядок Cells
/// совпадает с MatrixGroups, как buildMatrixRows в groupsAccessUtils.js).
/// </summary>
public sealed class GroupsAccessMatrixRowViewModel
{
    public GroupsAccessMatrixRowViewModel(
        HubGroupsAccessUser user,
        GroupsAccessMatrixCell[] cells)
    {
        ArgumentNullException.ThrowIfNull(user);
        ArgumentNullException.ThrowIfNull(cells);
        Login = user.Login?.Trim() ?? string.Empty;
        UserText = !string.IsNullOrWhiteSpace(user.DisplayName)
            ? user.DisplayName!.Trim()
            : Login.Length > 0 ? Login : "Учётная запись";
        AccessCount = user.AccessCount;
        Cells = cells;
    }

    public string Login { get; }
    public string UserText { get; }
    public int AccessCount { get; }
    public GroupsAccessMatrixCell[] Cells { get; }
}

/// <summary>Участник группы в карточке детали (members[] GET /groups-access/group).</summary>
public sealed class GroupsAccessMemberItemViewModel
{
    public GroupsAccessMemberItemViewModel(HubGroupsAccessMember member)
    {
        ArgumentNullException.ThrowIfNull(member);
        Login = member.Login?.Trim() ?? string.Empty;
        Title = !string.IsNullOrWhiteSpace(member.DisplayName)
            ? member.DisplayName!.Trim()
            : Login.Length > 0 ? Login : "Учётная запись";
        LoginText = string.Equals(Title, Login, StringComparison.OrdinalIgnoreCase)
            ? string.Empty
            : Login;
    }

    public string Login { get; }
    public string Title { get; }
    public string LoginText { get; }
    public string AutomationName => $"Участник {Title}";
}

/// <summary>
/// Карточка выбранной группы: поля из строки матрицы сразу, участники и
/// описание догружаются из GET /groups-access/group (как drawer в вебе).
/// </summary>
public sealed class GroupsAccessGroupDetailViewModel : ObservableObject
{
    private int _memberCount;

    public GroupsAccessGroupDetailViewModel(GroupsAccessGroupItemViewModel group)
    {
        ArgumentNullException.ThrowIfNull(group);
        Dn = group.Dn;
        Title = group.Title;
        CnText = group.Cn;
        PathText = group.PathText;
        BranchText = group.BranchText;
        LevelLabel = group.LevelLabel;
        LevelMark = group.LevelMark;
        LevelTone = group.LevelTone;
        _memberCount = group.MemberCount;
        DescriptionText = group.DescriptionText;
    }

    public string Dn { get; }
    public string Title { get; }
    public string CnText { get; }
    public string PathText { get; }
    public bool HasPath => PathText.Length > 0;
    public string BranchText { get; }
    public string LevelLabel { get; }
    public string LevelMark { get; }
    public string LevelTone { get; }
    public string MemberCountText =>
        GroupsAccessCatalog.FormatCount(_memberCount, "участник", "участника", "участников");

    public string DescriptionText { get; private set; }
    public bool HasDescription => DescriptionText.Length > 0;

    public ObservableCollection<GroupsAccessMemberItemViewModel> Members { get; } = [];
    public string MembersTitleText => $"Участники · {Members.Count}";
    public bool IsMembersEmpty => Members.Count == 0;

    /// <summary>Подмешать поля group{} и members[] ответа GET /groups-access/group.</summary>
    public void ApplyDetail(HubGroupsAccessGroupDetail payload)
    {
        ArgumentNullException.ThrowIfNull(payload);
        var group = payload.Group;
        if (group is not null)
        {
            if (!string.IsNullOrWhiteSpace(group.Description))
            {
                DescriptionText = group.Description!.Trim();
                OnPropertyChanged(nameof(DescriptionText));
                OnPropertyChanged(nameof(HasDescription));
            }

            if (group.MemberCount > 0 || Members.Count == 0)
            {
                _memberCount = group.MemberCount;
                OnPropertyChanged(nameof(MemberCountText));
            }
        }

        Members.Clear();
        foreach (var member in payload.Members ?? [])
        {
            Members.Add(new GroupsAccessMemberItemViewModel(member));
        }

        _memberCount = Math.Max(_memberCount, Members.Count);
        OnPropertyChanged(nameof(MemberCountText));
        OnPropertyChanged(nameof(MembersTitleText));
        OnPropertyChanged(nameof(IsMembersEmpty));
    }
}

/// <summary>
/// Страница «🔐 Доступы»: матрица доступа AD «учётки × папки» — как режим
/// matrix веб-страницы GroupsAccess.jsx (GET /groups-access/matrix-grid +
/// /status + /group). Серверные фильтры: учётка (user_q), папка (folder_q),
/// ветка (branch). Выбор ячейки колонки-группы → карточка с участниками.
/// Только чтение: /refresh, /export и права admin в срез не входят.
/// </summary>
public sealed class GroupsAccessViewModel : ObservableObject
{
    /// <summary>Debounce строк поиска — SEARCH_DEBOUNCE_MS веб-страницы.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(300);

    /// <summary>Лимиты матрицы — MATRIX_GROUP_LIMIT/MATRIX_USER_LIMIT веб-страницы.</summary>
    private const int MatrixGroupLimit = 250;
    private const int MatrixUserLimit = 500;

    /// <summary>_DEFAULT_BRANCHES backend'а — fallback, если /status не ответил.</summary>
    internal static readonly IReadOnlyList<string> DefaultBranches = ["SPb", "Tyumen"];

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _listCancellation;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _detailLoadCancellation;

    /// <summary>Заглушка событий фильтров на время Reset/сброса (без лишних перезагрузок).</summary>
    private bool _suppressFilterEvents;

    /// <summary>last_sync_at из /status — fallback для подписи снимка.</summary>
    private string? _lastSyncedAt;

    private GroupsAccessBranchItem _selectedBranch;
    private GroupsAccessGroupItemViewModel? _selectedGroup;
    private GroupsAccessMatrixRowViewModel? _selectedUser;
    private int _selectedGroupIndex = -1;
    private GroupsAccessGroupDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _userQuery = string.Empty;
    private string _folderQuery = string.Empty;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _summaryText = string.Empty;
    private string _truncatedText = string.Empty;
    private string _syncedAtText = string.Empty;
    private string _statusHintText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public GroupsAccessViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        ClearFiltersCommand = new NativeRelayCommand(ClearFilters);
        CloseDetailCommand = new NativeRelayCommand(CloseDetail);
        _selectedBranch = RebuildBranchItems(DefaultBranches);
    }

    // ---- Матрица ----

    /// <summary>Колонки матрицы — группы AD текущей выборки.</summary>
    public ObservableCollection<GroupsAccessGroupItemViewModel> MatrixGroups { get; } = [];

    /// <summary>Строки матрицы — учётки текущей выборки (Cells[i] ↔ MatrixGroups[i]).</summary>
    public ObservableCollection<GroupsAccessMatrixRowViewModel> MatrixRows { get; } = [];

    /// <summary>Чипы веток: «Все» + branches[] статуса (или дефолтные).</summary>
    public ObservableCollection<GroupsAccessBranchItem> BranchItems { get; } = [];

    /// <summary>Выбранная ветка (branch= запроса; «» — все).</summary>
    public string SelectedBranchValue => _selectedBranch.Value;

    /// <summary>Серверный фильтр user_q: логин или ФИО учётки (debounce).</summary>
    public string UserQuery
    {
        get => _userQuery;
        set
        {
            if (SetProperty(ref _userQuery, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(HasActiveFilters));
                ScheduleSearch();
            }
        }
    }

    /// <summary>Серверный фильтр folder_q: папка, группа или описание (debounce).</summary>
    public string FolderQuery
    {
        get => _folderQuery;
        set
        {
            if (SetProperty(ref _folderQuery, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(HasActiveFilters));
                ScheduleSearch();
            }
        }
    }

    /// <summary>Есть активные фильтры — показывать «Сбросить».</summary>
    public bool HasActiveFilters
        => !string.IsNullOrWhiteSpace(_userQuery)
            || !string.IsNullOrWhiteSpace(_folderQuery)
            || !string.IsNullOrWhiteSpace(_selectedBranch.Value);

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(IsUsersEmpty));
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
                OnPropertyChanged(nameof(IsUsersEmpty));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    /// <summary>Матрица с колонками (даже пустая по строкам — шапку показываем).</summary>
    public bool HasMatrix => MatrixGroups.Count > 0;

    /// <summary>Пусто по группам: «Нет папок для отображения матрицы».</summary>
    public bool IsEmpty => !IsLoading && MatrixGroups.Count == 0 && !HasBannerError;

    /// <summary>Группы есть, а учёток нет: «Нет учёток в выборке».</summary>
    public bool IsUsersEmpty =>
        !IsLoading && HasMatrix && MatrixRows.Count == 0 && !HasBannerError;

    /// <summary>Строка итогов: «N учёток × M папок · K доступов» — чип веб-шапки.</summary>
    public string SummaryText
    {
        get => _summaryText;
        private set => SetProperty(ref _summaryText, value);
    }

    /// <summary>Предупреждение об усечении выборки лимитами (summary.truncated).</summary>
    public string TruncatedText
    {
        get => _truncatedText;
        private set
        {
            if (SetProperty(ref _truncatedText, value))
            {
                OnPropertyChanged(nameof(HasTruncated));
            }
        }
    }

    public bool HasTruncated => TruncatedText.Length > 0;

    /// <summary>«Снимок: 12.01.2026 10:30» — synced_at матрицы или last_sync_at статуса.</summary>
    public string SyncedAtText
    {
        get => _syncedAtText;
        private set => SetProperty(ref _syncedAtText, value);
    }

    /// <summary>Подсказка состояния снимка («не создан» / «ошибка синхронизации»).</summary>
    public string StatusHintText
    {
        get => _statusHintText;
        private set
        {
            if (SetProperty(ref _statusHintText, value))
            {
                OnPropertyChanged(nameof(HasStatusHint));
            }
        }
    }

    public bool HasStatusHint => StatusHintText.Length > 0;

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    // ---- Выбор и деталь ----

    /// <summary>Выбранная колонка-группа (индекс в MatrixGroups; -1 — нет выбора).</summary>
    public int SelectedGroupIndex
    {
        get => _selectedGroupIndex;
        set
        {
            if (SetProperty(ref _selectedGroupIndex, value))
            {
                SelectedGroup = value >= 0 && value < MatrixGroups.Count
                    ? MatrixGroups[value]
                    : null;
            }
        }
    }

    /// <summary>Выбранная группа — её dn уходит в GET /groups-access/group.</summary>
    public GroupsAccessGroupItemViewModel? SelectedGroup
    {
        get => _selectedGroup;
        set
        {
            if (SetProperty(ref _selectedGroup, value))
            {
                OnPropertyChanged(nameof(SelectionContextText));
                OnPropertyChanged(nameof(HasSelectionContext));
                if (value is { Dn.Length: > 0 })
                {
                    _ = LoadDetailSafelyAsync(value);
                }
                else
                {
                    _detailLoadCancellation?.Cancel();
                    Detail = null;
                    DetailErrorText = null;
                    IsDetailLoading = false;
                }
            }
        }
    }

    /// <summary>Строка-учётка выбранной ячейки (контекст детали).</summary>
    public GroupsAccessMatrixRowViewModel? SelectedUser
    {
        get => _selectedUser;
        private set
        {
            if (SetProperty(ref _selectedUser, value))
            {
                OnPropertyChanged(nameof(SelectionContextText));
                OnPropertyChanged(nameof(HasSelectionContext));
            }
        }
    }

    /// <summary>Контекст выбранной ячейки: «Иван Иванов — Чтение» (для шапки детали).</summary>
    public string SelectionContextText =>
        _selectedGroup is null ? string.Empty : IntersectionContext(_selectedGroup) ?? string.Empty;

    public bool HasSelectionContext => SelectionContextText.Length > 0;

    /// <summary>
    /// Выбор ячейки из вида: строка-учётка + индекс колонки-группы.
    /// -1/пустая строка — снять выбор.
    /// </summary>
    public void SelectMatrixCell(GroupsAccessMatrixRowViewModel? user, int groupIndex)
    {
        SelectedUser = user;
        SelectedGroupIndex = groupIndex;
    }

    public GroupsAccessGroupDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите ячейку» — ни карточки, ни загрузки деталей.</summary>
    public bool ShowDetailPlaceholder => Detail is null && !IsDetailLoading;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set
        {
            if (SetProperty(ref _isDetailLoading, value))
            {
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
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

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand ClearFiltersCommand { get; }
    public ICommand CloseDetailCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Первичная загрузка: статус снимка (best-effort) + матрица.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        await LoadStatusSafelyAsync(cancellationToken);
        await LoadMatrixAsync(cancellationToken);
    }

    /// <summary>
    /// Статус снимка — неблокирующий: при ошибке остаются дефолтные ветки
    /// и пустая подпись sync-времени (веб-страница показывает notification,
    /// но матрицу грузит всё равно).
    /// </summary>
    private async Task LoadStatusSafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var status = await _api.GetGroupsAccessStatusAsync(cancellationToken);
            _lastSyncedAt = status.LastSyncAt;
            RebuildBranchItems(
                status.Branches is { Count: > 0 } branches ? branches : DefaultBranches);
            StatusHintText = status.Status?.Trim().ToLowerInvariant() switch
            {
                "error" => string.IsNullOrWhiteSpace(status.Error)
                    ? "Последняя синхронизация завершилась ошибкой."
                    : $"Ошибка синхронизации: {status.Error!.Trim()}",
                "never" => "Снимок ещё не создавался — данные могут быть пустыми.",
                _ => string.Empty,
            };
            UpdateSyncedAtText(null);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Статус не критичен: чипы веток и подпись остаются прежними.
        }
    }

    private HubGroupsAccessMatrixQuery BuildQuery() => new()
    {
        Branch = string.IsNullOrWhiteSpace(_selectedBranch.Value) ? null : _selectedBranch.Value,
        FolderQuery = NormalizeQuery(_folderQuery),
        UserQuery = NormalizeQuery(_userQuery),
        GroupLimit = MatrixGroupLimit,
        UserLimit = MatrixUserLimit,
    };

    /// <summary>Загрузка матрицы: предыдущий запрос отменяется — применяется только свежий.</summary>
    private async Task LoadMatrixAsync(CancellationToken cancellationToken)
    {
        _listCancellation?.Cancel();
        _listCancellation?.Dispose();
        var listCancellation = new CancellationTokenSource();
        _listCancellation = listCancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, listCancellation.Token);
        IsLoading = true;
        try
        {
            var grid = await _api.GetGroupsAccessMatrixGridAsync(BuildQuery(), linked.Token);
            // Ответ устарел: фильтры уже сменились — не применяем его.
            if (listCancellation.IsCancellationRequested)
            {
                return;
            }

            ApplyMatrix(grid);
            BannerErrorText = null;
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        catch (OperationCanceledException) when (listCancellation.IsCancellationRequested)
        {
            // Отменили мы сами (новый фильтр) — не баннерная ошибка.
        }
        finally
        {
            if (ReferenceEquals(_listCancellation, listCancellation))
            {
                IsLoading = false;
            }
            else if (!listCancellation.IsCancellationRequested)
            {
                IsLoading = false;
            }

            linked.Dispose();
        }
    }

    private void ApplyMatrix(HubGroupsAccessMatrixGrid grid)
    {
        ArgumentNullException.ThrowIfNull(grid);
        var groups = (grid.Groups ?? [])
            .Select(group => new GroupsAccessGroupItemViewModel(group))
            .ToList();

        // Разреженные ячейки [login, group_dn, level] → словарь (как buildSparseAccessMap).
        var sparse = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var cell in grid.Cells ?? [])
        {
            if (cell is null || cell.Count < 3)
            {
                continue;
            }

            var login = cell[0]?.Trim() ?? string.Empty;
            var groupDn = cell[1]?.Trim() ?? string.Empty;
            if (login.Length == 0 || groupDn.Length == 0)
            {
                continue;
            }

            sparse[login + "\0" + groupDn] = cell[2]?.Trim() ?? string.Empty;
        }

        MatrixGroups.Clear();
        foreach (var group in groups)
        {
            MatrixGroups.Add(group);
        }

        MatrixRows.Clear();
        var groupDns = groups.Select(group => group.Dn).ToList();
        foreach (var user in grid.Users ?? [])
        {
            var cells = new GroupsAccessMatrixCell[groups.Count];
            var login = user.Login?.Trim() ?? string.Empty;
            for (var index = 0; index < groups.Count; index++)
            {
                cells[index] = new GroupsAccessMatrixCell(
                    sparse.TryGetValue(login + "\0" + groupDns[index], out var level)
                        ? level
                        : null);
            }

            MatrixRows.Add(new GroupsAccessMatrixRowViewModel(user, cells));
        }

        var cellCount = grid.Cells?.Count ?? 0;
        SummaryText = $"{MatrixRows.Count} учёток × {MatrixGroups.Count} папок · {cellCount} доступов";
        TruncatedText = FormatTruncated(grid.Summary);
        UpdateSyncedAtText(grid.SyncedAt);
        SelectedUser = null;

        // Выбор сохраняется, пока dn группы ещё в выборке (как setSelectedGroupDn в вебе).
        if (_selectedGroup is not null
            && !MatrixGroups.Any(
                group => group.Dn.Length > 0
                    && string.Equals(group.Dn, _selectedGroup.Dn, StringComparison.Ordinal)))
        {
            _selectedGroupIndex = -1;
            OnPropertyChanged(nameof(SelectedGroupIndex));
            SelectedGroup = null;
        }

        OnPropertyChanged(nameof(HasMatrix));
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(IsUsersEmpty));
    }

    private static string FormatTruncated(HubGroupsAccessSummary? summary)
    {
        if (summary?.Truncated != true)
        {
            return string.Empty;
        }

        var parts = new List<string>(2);
        if (summary.GroupTruncated)
        {
            parts.Add($"папки: {summary.ReturnedGroupCount} из {summary.GroupCount}");
        }

        if (summary.UserTruncated)
        {
            parts.Add($"учётки: {summary.ReturnedUserCount} из {summary.UserCount}");
        }

        return parts.Count == 0
            ? "Выборка усечена лимитами — уточните фильтры."
            : $"Показано не всё ({string.Join("; ", parts)}) — уточните фильтры.";
    }

    private void UpdateSyncedAtText(string? gridSyncedAt)
    {
        var effective = !string.IsNullOrWhiteSpace(gridSyncedAt) ? gridSyncedAt : _lastSyncedAt;
        var stamp = GroupsAccessCatalog.FormatSyncTime(effective);
        SyncedAtText = stamp == "—" ? string.Empty : $"Снимок: {stamp}";
    }

    // ---- Фильтры ----

    /// <summary>Нормализация ввода — схлопывание пробелов, как normalizeComputersSearchInput.</summary>
    private static string? NormalizeQuery(string value)
    {
        var normalized = string.Join(
            ' ',
            (value ?? string.Empty)
                .Replace('\r', ' ')
                .Replace('\n', ' ')
                .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));
        return normalized.Length == 0 ? null : normalized;
    }

    /// <summary>Debounce 300 мс: серверные user_q/folder_q перечитывают матрицу.</summary>
    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        if (_suppressFilterEvents)
        {
            return;
        }

        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var userSnapshot = _userQuery;
        var folderSnapshot = _folderQuery;
        _ = SearchSafelyAsync(userSnapshot, folderSnapshot, cancellation.Token);
    }

    private async Task SearchSafelyAsync(
        string userSnapshot,
        string folderSnapshot,
        CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            // Строки уже сменились — запрос устарел.
            if (!string.Equals(_userQuery, userSnapshot, StringComparison.Ordinal)
                || !string.Equals(_folderQuery, folderSnapshot, StringComparison.Ordinal))
            {
                return;
            }

            await LoadMatrixAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Смена ветки/сброс фильтров: матрица перечитывается сразу.</summary>
    private void ReloadFromFilterChange()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        _ = ReloadSafelyAsync();
    }

    private async Task ReloadSafelyAsync()
    {
        try
        {
            await LoadMatrixAsync(CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Сброс строк поиска и ветки к начальным значениям (одна перезагрузка).</summary>
    private void ClearFilters()
    {
        _suppressFilterEvents = true;
        try
        {
            UserQuery = string.Empty;
            FolderQuery = string.Empty;
            // Галочка до присвоения _selectedBranch: SelectBranch снимет прежний чип,
            // перезагрузки не будет — события заглушены.
            var all = BranchItems[0];
            all.IsChecked = true;
            _selectedBranch = all;
        }
        finally
        {
            _suppressFilterEvents = false;
        }

        OnPropertyChanged(nameof(HasActiveFilters));
        ReloadFromFilterChange();
    }

    // ---- Ветки ----

    /// <summary>
    /// Пересобрать чипы веток («Все» + snapshot/configured branches), сохраняя
    /// выбранное значение, если оно ещё есть в списке.
    /// </summary>
    private GroupsAccessBranchItem RebuildBranchItems(IReadOnlyList<string> branches)
    {
        var selectedValue = _selectedBranch?.Value;
        foreach (var item in BranchItems)
        {
            item.PropertyChanged -= BranchItem_PropertyChanged;
        }

        BranchItems.Clear();
        foreach (var value in new[] { string.Empty }.Concat(
                     branches.Where(name => !string.IsNullOrWhiteSpace(name))
                         .Select(name => name.Trim())
                         .Distinct(StringComparer.OrdinalIgnoreCase)))
        {
            var item = new GroupsAccessBranchItem(
                value,
                value.Length == 0 ? "Все" : value);
            item.PropertyChanged += BranchItem_PropertyChanged;
            BranchItems.Add(item);
        }

        var selected = BranchItems.FirstOrDefault(
                           item => string.Equals(
                               item.Value, selectedValue, StringComparison.OrdinalIgnoreCase))
                       ?? BranchItems[0];
        // Присвоение выбора до галочки — SelectBranch его распознаёт и не перегружает.
        _selectedBranch = selected;
        selected.IsChecked = true;
        return selected;
    }

    private void BranchItem_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(GroupsAccessBranchItem.IsChecked)
            && sender is GroupsAccessBranchItem { IsChecked: true } item)
        {
            SelectBranch(item);
        }
    }

    private void SelectBranch(GroupsAccessBranchItem item)
    {
        if (ReferenceEquals(_selectedBranch, item))
        {
            return;
        }

        _selectedBranch = item;
        foreach (var other in BranchItems)
        {
            if (!ReferenceEquals(other, item) && other.IsChecked)
            {
                other.IsChecked = false;
            }
        }

        OnPropertyChanged(nameof(SelectedBranchValue));
        OnPropertyChanged(nameof(HasActiveFilters));
        ReloadFromFilterChange();
    }

    // ---- Карточка группы ----

    /// <summary>Закрыть карточку: снять выбор строки и колонки.</summary>
    private void CloseDetail() => SelectMatrixCell(null, -1);

    private async Task LoadDetailSafelyAsync(GroupsAccessGroupItemViewModel group)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        // Карточка из данных матрицы — без ожидания сети; участники догружаются.
        var detail = new GroupsAccessGroupDetailViewModel(group);
        Detail = detail;
        try
        {
            var payload = await _api.GetGroupsAccessGroupDetailAsync(group.Dn, cancellation.Token);
            // Выбор уже ушёл на другую группу — устаревший ответ не применяем.
            if (!ReferenceEquals(_selectedGroup, group) || !ReferenceEquals(Detail, detail))
            {
                return;
            }

            detail.ApplyDetail(payload);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(_selectedGroup, group))
            {
                DetailErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    /// <summary>Контекст выбранной ячейки: «Иван Иванов — Чтение» для шапки детали.</summary>
    private string? IntersectionContext(GroupsAccessGroupItemViewModel group)
    {
        var user = _selectedUser;
        if (user is null)
        {
            return null;
        }

        var index = MatrixGroups.IndexOf(group);
        if (index < 0 || index >= user.Cells.Length)
        {
            return null;
        }

        return $"{user.UserText} — {user.Cells[index].Label}";
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
        _listCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _detailLoadCancellation?.Cancel();
        _suppressFilterEvents = true;
        MatrixGroups.Clear();
        MatrixRows.Clear();
        Detail = null;
        SelectedGroup = null;
        SelectedUser = null;
        _selectedGroupIndex = -1;
        OnPropertyChanged(nameof(SelectedGroupIndex));
        BannerErrorText = null;
        DetailErrorText = null;
        _userQuery = string.Empty;
        OnPropertyChanged(nameof(UserQuery));
        _folderQuery = string.Empty;
        OnPropertyChanged(nameof(FolderQuery));
        _lastSyncedAt = null;
        _selectedBranch = RebuildBranchItems(DefaultBranches);
        _suppressFilterEvents = false;
        OnPropertyChanged(nameof(HasActiveFilters));
        SummaryText = string.Empty;
        TruncatedText = string.Empty;
        SyncedAtText = string.Empty;
        StatusHintText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsDetailLoading = false;
        OnPropertyChanged(nameof(HasMatrix));
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(IsUsersEmpty));
    }
}
