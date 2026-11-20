using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Диалог «Новая общая папка» / «Настроить общую папку» (LibraryDialog веба).
/// Создание: POST /my-files/libraries {name, quota_bytes}; правка: PATCH только
/// изменённых. «Удалить» — внизу диалога правки, armed-паттерн как у новостей.
/// </summary>
public sealed class MyFilesLibraryEditorViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly HubMyFileLibrary? _original;
    private string _name = string.Empty;
    private string _quotaGbText = string.Empty;
    private bool _isBusy;
    private bool _deleteArmed;
    private string? _errorText;
    private string _statusText = string.Empty;

    /// <summary>Режим создания общей папки.</summary>
    public MyFilesLibraryEditorViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        _quotaGbText = "10";
        InitCommands();
    }

    /// <summary>Режим правки: имя и квота (ГБ) берутся из библиотеки.</summary>
    public MyFilesLibraryEditorViewModel(IHubApiClient api, HubMyFileLibrary library)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = library ?? throw new ArgumentNullException(nameof(library));
        _name = (library.Name ?? string.Empty).Trim();
        _quotaGbText = FormatQuotaGb(library.QuotaBytes);
        InitCommands();
    }

    private void InitCommands()
    {
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            _ => ErrorText = "Не удалось сохранить.",
            _ => !IsBusy);
        DeleteCommand = new NativeAsyncCommand(
            (_, ct) => DeleteAsync(ct),
            _ => ErrorText = "Не удалось удалить.",
            _ => !IsBusy && IsDeleteVisible);
    }

    /// <summary>Сохранение/удаление прошли — родитель перечитывает список и закрывает диалог.</summary>
    internal Action<HubMyFileLibrary>? Saved;

    /// <summary>Библиотека удалена — родитель уходит на личный диск.</summary>
    internal Action<HubMyFileLibrary>? Deleted;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    public bool IsCreateMode { get; }

    /// <summary>Кнопка «Удалить» только в режиме правки (backend режет пустые проверкой).</summary>
    public bool IsDeleteVisible => !IsCreateMode;

    public string TitleText => IsCreateMode ? "Новая общая папка" : "Настроить общую папку";

    public string SubtitleText => IsCreateMode
        ? "Общее пространство для команды — участников назначите после создания"
        : $"«{_original?.Name}» · участников — {MembersCountText}";

    private string MembersCountText =>
        _original?.MembersCount.ToString(CultureInfo.InvariantCulture) ?? "0";

    public string Name
    {
        get => _name;
        set => SetProperty(ref _name, value ?? string.Empty);
    }

    /// <summary>Поле «Квота, ГБ»: пусто/0 — без лимита, парсится при сохранении.</summary>
    public string QuotaGbText
    {
        get => _quotaGbText;
        set => SetProperty(ref _quotaGbText, value ?? string.Empty);
    }

    /// <summary>Подпись кнопки удаления: «Удалить» → «Удалить?» после первого нажатия.</summary>
    public string DeleteText => _deleteArmed ? "Удалить?" : "Удалить";

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool AreInputsEnabled => !IsBusy;

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

    public string StatusText
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

    public ICommand CloseCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand SubmitCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand DeleteCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>Сохранение: create → POST; edit → PATCH только изменённых полей.</summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;
        var name = Name.Trim();
        if (name.Length == 0)
        {
            ErrorText = "Введите название общей папки.";
            return false;
        }

        if (!TryParseQuota(out var quotaBytes))
        {
            ErrorText = "Квота — целое число ГБ (0 или пусто — без лимита).";
            return false;
        }

        IsBusy = true;
        try
        {
            if (IsCreateMode)
            {
                var created = await _api.CreateMyFileLibraryAsync(name, quotaBytes, cancellationToken);
                Saved?.Invoke(created);
                return true;
            }

            var original = _original!;
            string? newName = string.Equals(name, (original.Name ?? string.Empty).Trim(), StringComparison.Ordinal)
                ? null
                : name;
            long? newQuota = quotaBytes == original.QuotaBytes ? null : quotaBytes;
            if (newName is null && newQuota is null)
            {
                StatusText = "Изменений нет.";
                return false;
            }

            var updated = await _api.UpdateMyFileLibraryAsync(
                original.Id ?? string.Empty, newName, newQuota, cancellationToken);
            Saved?.Invoke(updated);
            return true;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>
    /// Удаление библиотеки — armed: первый вызов взводит («Удалить?»),
    /// второй шлёт DELETE. Backend удаляет только пустую библиотеку.
    /// </summary>
    public async Task<bool> DeleteAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy || _original is null)
        {
            return false;
        }

        if (!_deleteArmed)
        {
            _deleteArmed = true;
            OnPropertyChanged(nameof(DeleteText));
            return false;
        }

        ErrorText = null;
        IsBusy = true;
        try
        {
            await _api.DeleteMyFileLibraryAsync(_original.Id ?? string.Empty, cancellationToken);
            Deleted?.Invoke(_original);
            return true;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>«10» для 10 ГБ; «0»/«» — без квоты. Принимает запятую и точку.</summary>
    private bool TryParseQuota(out long quotaBytes)
    {
        quotaBytes = 0;
        var text = QuotaGbText.Trim().Replace(',', '.');
        if (text.Length == 0)
        {
            return true;
        }

        if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var gb)
            || gb < 0)
        {
            return false;
        }

        quotaBytes = (long)Math.Round(gb * 1024d * 1024d * 1024d, MidpointRounding.AwayFromZero);
        return true;
    }

    private static string FormatQuotaGb(long quotaBytes) =>
        quotaBytes <= 0
            ? string.Empty
            : (quotaBytes / (1024d * 1024d * 1024d)).ToString("0.##", CultureInfo.InvariantCulture);
}

/// <summary>Опция роли участника общей папки (LIBRARY_ROLE_LABELS веба).</summary>
public sealed class MyFilesLibraryRoleOption
{
    public MyFilesLibraryRoleOption(string value, string label)
    {
        Value = value;
        Label = label;
    }

    public string Value { get; }
    public string Label { get; }

    public override string ToString() => Label;
}

/// <summary>
/// Строка состава участников: principal user|department + роль.
/// Ключ — (type, id): повторное добавление заменяет роль, как set_members backend'а.
/// </summary>
public sealed class MyFilesLibraryMemberRowViewModel : ObservableObject
{
    private string _role;

    public MyFilesLibraryMemberRowViewModel(
        string principalType,
        string principalId,
        string name,
        string role,
        int membersCount)
    {
        PrincipalType = principalType;
        PrincipalId = principalId;
        Name = name;
        _role = role;
        KindIcon = principalType == "department" ? "🏢" : "👤";
        MetaText = principalType == "department"
            ? $"Отдел · {membersCount.ToString(CultureInfo.InvariantCulture)} чел."
            : "Сотрудник";
    }

    public string PrincipalType { get; }
    public string PrincipalId { get; }
    public string Name { get; }
    public string KindIcon { get; }
    public string MetaText { get; }

    /// <summary>Роль manage|edit|comment|view — двусторонняя привязка ComboBox.</summary>
    public string Role
    {
        get => _role;
        set
        {
            if (SetProperty(ref _role, value ?? "edit"))
            {
                Dirty?.Invoke();
            }
        }
    }

    /// <summary>Любая правка роли помечает диалог грязным.</summary>
    internal Action? Dirty { get; set; }

    public HubMyFileLibraryMemberInput ToInput() => new()
    {
        PrincipalType = PrincipalType,
        PrincipalId = PrincipalId,
        Role = Role,
    };
}

/// <summary>Кандидат из поиска сотрудников (chat/users) или списка отделов.</summary>
public sealed class MyFilesLibraryCandidateViewModel
{
    private MyFilesLibraryCandidateViewModel(
        string principalType,
        string principalId,
        string name,
        string metaText)
    {
        PrincipalType = principalType;
        PrincipalId = principalId;
        Name = name;
        MetaText = metaText;
        KindIcon = principalType == "department" ? "🏢" : "👤";
    }

    public string PrincipalType { get; }
    public string PrincipalId { get; }
    public string Name { get; }
    public string MetaText { get; }
    public string KindIcon { get; }

    public static MyFilesLibraryCandidateViewModel FromUser(HubChatUser user)
    {
        ArgumentNullException.ThrowIfNull(user);
        // principal_id сотрудника — числовой user id (list_members backend'а читает isdigit).
        var login = (user.Username ?? string.Empty).Trim();
        var name = !string.IsNullOrWhiteSpace(user.FullName) ? user.FullName.Trim() : "@" + login;
        var meta = !string.IsNullOrWhiteSpace(user.Department) ? user.Department.Trim() : "@" + login;
        return new MyFilesLibraryCandidateViewModel(
            "user", user.Id.ToString(CultureInfo.InvariantCulture), name, meta);
    }

    public static MyFilesLibraryCandidateViewModel FromDepartment(HubMyFileOfficeGroup group)
    {
        ArgumentNullException.ThrowIfNull(group);
        return new MyFilesLibraryCandidateViewModel(
            "department",
            (group.Id ?? string.Empty).Trim(),
            string.IsNullOrWhiteSpace(group.Name) ? "Отдел" : group.Name.Trim(),
            $"Отдел · {group.MembersCount.ToString(CultureInfo.InvariantCulture)} чел.");
    }
}

/// <summary>
/// Диалог «Участники общей папки» (LibraryMembersDialog веба): список состава +
/// поиск сотрудников (chat/users) и отделов (office/groups); сохранение — PUT
/// полным набором, как «Руководители отдела» в админке.
/// </summary>
public sealed class MyFilesLibraryMembersViewModel : ObservableObject
{
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);
    private const int SearchMinLength = 2;
    private const int SearchLimit = 20;

    private readonly IHubApiClient _api;
    private readonly string _libraryId;
    private CancellationTokenSource? _searchCancellation;
    private bool _isLoading;
    private bool _isSearching;
    private bool _isBusy;
    private bool _isDirty;
    private string _searchText = string.Empty;
    private string? _errorText;
    private string _statusText = string.Empty;
    private string _emptyText = "Добавьте сотрудников или отделы — у библиотеки пока нет участников.";

    public MyFilesLibraryMembersViewModel(IHubApiClient api, HubMyFileLibrary library)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        ArgumentNullException.ThrowIfNull(library);
        _libraryId = (library.Id ?? string.Empty).Trim();
        LibraryName = string.IsNullOrWhiteSpace(library.Name) ? "Общая папка" : library.Name.Trim();
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke());
        AddMemberCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is MyFilesLibraryCandidateViewModel candidate)
                {
                    AddCandidate(candidate);
                }
            });
        RemoveMemberCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is MyFilesLibraryMemberRowViewModel row && Members.Remove(row))
                {
                    MarkDirty();
                }
            });
        SaveCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            _ => ErrorText = "Не удалось сохранить состав.",
            _ => !IsBusy && IsDirty);
    }

    /// <summary>Сохранение прошло — родитель обновляет список библиотек.</summary>
    internal Action? Saved;

    /// <summary>Закрытие диалога (✕/Закрыть/Esc) — решает родитель.</summary>
    internal Action? Closed;

    public string LibraryName { get; }

    public string TitleText => $"Участники «{LibraryName}»";

    /// <summary>Состав: отделы и сотрудники с ролями; PUT отправляет их всех.</summary>
    public ObservableCollection<MyFilesLibraryMemberRowViewModel> Members { get; } = [];

    /// <summary>Выдача поиска сотрудников + подходящие отделы.</summary>
    public ObservableCollection<MyFilesLibraryCandidateViewModel> Candidates { get; } = [];

    /// <summary>Отделы для добавления одним кликом (office/groups; может быть пусто без права share).</summary>
    public ObservableCollection<MyFilesLibraryCandidateViewModel> Departments { get; } = [];

    public IReadOnlyList<MyFilesLibraryRoleOption> RoleOptions { get; } =
    [
        new("manage", "Управление"),
        new("edit", "Правка"),
        new("comment", "Комментарии"),
        new("view", "Просмотр"),
    ];

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public bool IsSearching
    {
        get => _isSearching;
        private set => SetProperty(ref _isSearching, value);
    }

    /// <summary>Идёт PUT — поля и кнопки временно недоступны.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                ((NativeAsyncCommand)SaveCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool AreInputsEnabled => !IsBusy;

    /// <summary>Есть несохранённые правки состава — подпись кнопки и подсказка.</summary>
    public bool IsDirty
    {
        get => _isDirty;
        private set
        {
            if (SetProperty(ref _isDirty, value))
            {
                OnPropertyChanged(nameof(SaveText));
                ((NativeAsyncCommand)SaveCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string SaveText => IsDirty ? "Сохранить" : "Сохранено";

    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ScheduleSearch();
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
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public string StatusText
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

    public string EmptyText
    {
        get => _emptyText;
        private set => SetProperty(ref _emptyText, value);
    }

    /// <summary>Подпись пустой выдачи поиска.</summary>
    public bool IsSearchEmpty =>
        SearchText.Trim().Length >= SearchMinLength && !IsSearching && Candidates.Count == 0;

    public ICommand CloseCommand { get; }
    public ICommand AddMemberCommand { get; }
    public ICommand RemoveMemberCommand { get; }
    public ICommand SaveCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Открытие: GET состава + GET отделов (необязательная часть — пусто при 403).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        ErrorText = null;
        try
        {
            var members = await _api.GetMyFileLibraryMembersAsync(_libraryId, cancellationToken);
            ApplyMembers(members);
            try
            {
                var groups = await _api.GetMyFileOfficeGroupsAsync(cancellationToken);
                Departments.Clear();
                foreach (var group in groups)
                {
                    Departments.Add(MyFilesLibraryCandidateViewModel.FromDepartment(group));
                }
            }
            catch
            {
                // Отделы — вспомогательная часть диалога; ошибку не поднимаем.
                Departments.Clear();
            }
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ApplyMembers(HubMyFileLibraryMembers response)
    {
        Members.Clear();
        foreach (var item in response.Items ?? [])
        {
            var row = new MyFilesLibraryMemberRowViewModel(
                (item.PrincipalType ?? "user").Trim().ToLowerInvariant(),
                (item.PrincipalId ?? string.Empty).Trim(),
                string.IsNullOrWhiteSpace(item.Name) ? "—" : item.Name.Trim(),
                NormalizeRole(item.Role),
                item.MembersCount)
            {
                Dirty = MarkDirty,
            };
            Members.Add(row);
        }

        IsDirty = false;
    }

    /// <summary>Неизвестная роль сводится к edit — backend не принимает иные значения.</summary>
    private static string NormalizeRole(string? role) =>
        (role ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "manage" or "edit" or "comment" or "view" =>
                (role ?? string.Empty).Trim().ToLowerInvariant(),
            _ => "edit",
        };

    private void MarkDirty()
    {
        IsDirty = true;
        StatusText = "Есть несохранённые изменения.";
    }

    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        var query = SearchText.Trim();
        if (query.Length < SearchMinLength)
        {
            Candidates.Clear();
            OnPropertyChanged(nameof(IsSearchEmpty));
            return;
        }

        var local = _searchCancellation = new CancellationTokenSource();
        _ = SearchSafelyAsync(query, local.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            IsSearching = true;
            var users = await _api.GetChatUsersAsync(query, SearchLimit, cancellationToken);
            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            Candidates.Clear();
            var knownUsers = new HashSet<string>(
                Members.Where(m => m.PrincipalType == "user").Select(m => m.PrincipalId),
                StringComparer.OrdinalIgnoreCase);
            foreach (var user in users.Items ?? [])
            {
                var candidate = MyFilesLibraryCandidateViewModel.FromUser(user);
                if (candidate.PrincipalId.Length == 0 || knownUsers.Contains(candidate.PrincipalId))
                {
                    continue;
                }

                Candidates.Add(candidate);
            }

            // Подходящие отделы идут следом за сотрудниками — как два блока веба.
            var knownDepartments = new HashSet<string>(
                Members.Where(m => m.PrincipalType == "department").Select(m => m.PrincipalId),
                StringComparer.OrdinalIgnoreCase);
            foreach (var department in Departments)
            {
                if (department.Name.Contains(query, StringComparison.OrdinalIgnoreCase)
                    && !knownDepartments.Contains(department.PrincipalId))
                {
                    Candidates.Add(department);
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsSearching = false;
            OnPropertyChanged(nameof(IsSearchEmpty));
        }
    }

    /// <summary>Добавление кандидата: дубликат по (type,id) — роль обновляется (как backend).</summary>
    private void AddCandidate(MyFilesLibraryCandidateViewModel candidate)
    {
        var existing = Members.FirstOrDefault(row =>
            row.PrincipalType == candidate.PrincipalType
            && string.Equals(row.PrincipalId, candidate.PrincipalId, StringComparison.OrdinalIgnoreCase));
        if (existing is not null)
        {
            existing.Role = "edit";
            return;
        }

        var row = new MyFilesLibraryMemberRowViewModel(
            candidate.PrincipalType,
            candidate.PrincipalId,
            candidate.Name,
            "edit",
            0)
        {
            Dirty = MarkDirty,
        };
        Members.Add(row);
        Candidates.Remove(candidate);
        MarkDirty();
    }

    /// <summary>Сохранение: PUT полным набором участников (контракт set_members).</summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy || !IsDirty)
        {
            return !IsDirty;
        }

        ErrorText = null;
        StatusText = string.Empty;
        IsBusy = true;
        try
        {
            var members = Members.Select(row => row.ToInput()).ToList();
            var updated = await _api.SetMyFileLibraryMembersAsync(_libraryId, members, cancellationToken);
            ApplyMembers(updated);
            StatusText = "Состав сохранён.";
            Saved?.Invoke();
            return true;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            StatusText = "Не сохранено.";
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }
}
