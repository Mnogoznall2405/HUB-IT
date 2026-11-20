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

/// <summary>Строка раздела «Пользователи» — учётка HUB (UsersTab веба).</summary>
public sealed class AdminUserItemViewModel
{
    public AdminUserItemViewModel(HubAdminUser user, bool canEdit = false)
    {
        ArgumentNullException.ThrowIfNull(user);
        Source = user;
        CanEdit = canEdit;
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

    /// <summary>Исходная запись пользователя — исходные значения для диалога правки.</summary>
    internal HubAdminUser Source { get; }

    /// <summary>Кнопка «Изменить» в строке — право users.manage (+ цель не admin для не-admin).</summary>
    public bool CanEdit { get; }

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

/// <summary>
/// Диалог «Изменить пользователя» / «Новый пользователь» (UsersTab веб-админки).
/// PATCH /auth/users/{id} шлёт только изменённые поля (exclude_unset-семантика):
/// diff с исходной записью, пустое значение не уходит. Права — как на сервере:
/// не-admin видит только {email, full_name, department, job_title}; у себя
/// роль и «Активен» заблокированы (сервер отклонил бы — не даём выстрелить в ногу).
/// «Сбросить 2FA» — двойное нажатие вместо отдельного confirm-диалога.
/// </summary>
public sealed class AdminUserEditorViewModel : ObservableObject
{
    /// <summary>Значения role в контракте бэкенда (Literal admin|operator|viewer).</summary>
    internal static readonly string[] RoleValues = ["admin", "operator", "viewer"];

    private readonly IHubApiClient _api;
    private readonly HubAdminUser? _original;
    private string _password = string.Empty;
    private bool _resetTwoFactorArmed;
    private bool _twoFactorEnabled;

    private string _username = string.Empty;
    private string _fullName = string.Empty;
    private string _email = string.Empty;
    private string _department = string.Empty;
    private string _jobTitle = string.Empty;
    private string _role = "viewer";
    private bool _isActive = true;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;

    /// <summary>Режим правки: исходные значения берутся из записи пользователя.</summary>
    public AdminUserEditorViewModel(
        IHubApiClient api,
        HubAdminUser user,
        bool isAdminRole,
        long currentUserId)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = user ?? throw new ArgumentNullException(nameof(user));
        IsAdminRole = isAdminRole;
        IsSelf = user.Id == currentUserId;
        _twoFactorEnabled = user.IsTwoFactorEnabled;
        HasCustomPermissions = user.UseCustomPermissions;

        _username = (user.Username ?? string.Empty).Trim();
        _fullName = (user.FullName ?? string.Empty).Trim();
        _email = (user.Email ?? string.Empty).Trim();
        _department = (user.Department ?? string.Empty).Trim();
        _jobTitle = (user.JobTitle ?? string.Empty).Trim();
        // Нестандартную роль (user/service и пр.) храним как есть — без диффа она не уйдёт.
        _role = NormalizeRole(user.Role);
        _isActive = user.IsActive;
        InitCommands();
    }

    /// <summary>Режим создания (admin only) — дефолты как у createEmptyUserDraft веба.</summary>
    public AdminUserEditorViewModel(IHubApiClient api, bool isAdminRole)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        IsAdminRole = isAdminRole;
        InitCommands();
    }

    private void InitCommands()
    {
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
        ResetTwoFactorCommand = new NativeAsyncCommand(
            (_, ct) => ResetTwoFactorAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy && IsResetAvailable);
    }

    /// <summary>Сохранение успешно — родитель обновляет строку и закрывает диалог.</summary>
    internal Action<HubAdminUser>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    // ---- Режим и заголовки ----

    public bool IsCreateMode { get; }
    public bool IsSelf { get; }

    /// <summary>Текущий пользователь — admin: видны роль/активность/пароль/2FA.</summary>
    public bool IsAdminRole { get; }

    /// <summary>Блок привилегированных полей скрыт у не-admin (как на сервере).</summary>
    public bool CanEditPrivileged => IsAdminRole;

    /// <summary>Поля формы отключены на время запроса.</summary>
    public bool AreInputsEnabled => !IsBusy;

    /// <summary>
    /// Роль/активность отключены у собственной учётки и на время запроса —
    /// сервер вернул бы 403 «Cannot change own role or permissions» / 400
    /// на is_active=false.
    /// </summary>
    public bool ArePrivilegedInputsEnabled => !IsSelf && !IsBusy;

    /// <summary>Подсказка над формой при правке собственной учётки.</summary>
    public bool HasSelfHint => IsSelf && CanEditPrivileged;

    public string SelfHintText =>
        "Это ваша учётная запись: свою роль и активность изменить нельзя.";

    public string TitleText => IsCreateMode ? "Новый пользователь" : "Изменить пользователя";

    public string SubtitleText => IsCreateMode
        ? "Создание учётной записи HUB"
        : $"@{_username} · {RoleLabel(_role)}";

    // ---- Поля формы ----

    /// <summary>Логин — только режим создания (у существующего не меняется, как в вебе).</summary>
    public bool IsUsernameVisible => IsCreateMode;

    public string Username
    {
        get => _username;
        set => SetProperty(ref _username, value ?? string.Empty);
    }

    public string FullName
    {
        get => _fullName;
        set => SetProperty(ref _fullName, value ?? string.Empty);
    }

    public string Email
    {
        get => _email;
        set => SetProperty(ref _email, value ?? string.Empty);
    }

    public string Department
    {
        get => _department;
        set => SetProperty(ref _department, value ?? string.Empty);
    }

    public string JobTitle
    {
        get => _jobTitle;
        set => SetProperty(ref _jobTitle, value ?? string.Empty);
    }

    /// <summary>Радио-чипы роли (admin|operator|viewer — roleOptions веба).</summary>
    public bool IsRoleAdmin
    {
        get => _role == "admin";
        set
        {
            if (value)
            {
                SelectedRole = "admin";
            }
        }
    }

    public bool IsRoleOperator
    {
        get => _role == "operator";
        set
        {
            if (value)
            {
                SelectedRole = "operator";
            }
        }
    }

    public bool IsRoleViewer
    {
        get => _role == "viewer";
        set
        {
            if (value)
            {
                SelectedRole = "viewer";
            }
        }
    }

    internal string SelectedRole
    {
        set
        {
            var normalized = NormalizeRole(value);
            if (SetProperty(ref _role, normalized))
            {
                OnPropertyChanged(nameof(IsRoleAdmin));
                OnPropertyChanged(nameof(IsRoleOperator));
                OnPropertyChanged(nameof(IsRoleViewer));
                OnPropertyChanged(nameof(SubtitleText));
            }
        }
    }

    public bool IsActive
    {
        get => _isActive;
        set => SetProperty(ref _isActive, value);
    }

    /// <summary>У цели индивидуальные права — правятся в вебе, здесь только подсказка.</summary>
    public bool HasCustomPermissions { get; }

    public string CustomPermissionsHintText =>
        "Индивидуальные права пользователя настраиваются в веб-версии HUB.";

    // ---- Пароль ----

    public string PasswordLabelText =>
        IsCreateMode ? "Пароль *" : "Новый пароль (необязательно)";

    /// <summary>Пароль виден не-admin тоже нельзя — только admin меняет пароли.</summary>
    public bool IsPasswordVisible => CanEditPrivileged;

    // ---- Сброс 2FA ----

    /// <summary>Кнопка сброса видна только если у цели включена 2FA (admin, edit-режим).</summary>
    public bool IsResetAvailable => !IsCreateMode && CanEditPrivileged && _twoFactorEnabled;

    public string ResetTwoFactorText =>
        _resetTwoFactorArmed ? "Нажмите ещё раз для подтверждения" : "Сбросить 2FA";

    // ---- Состояние ----

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                OnPropertyChanged(nameof(ArePrivilegedInputsEnabled));
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

    /// <summary>Строка статуса внизу формы — результат сброса 2FA, «изменений нет».</summary>
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
    public ICommand ResetTwoFactorCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>
    /// Сохранение: create → POST /auth/users (валидация обязательных);
    /// edit → PATCH только изменённых (diff). 400/403 — текст сервера в ErrorText,
    /// диалог не закрывается. Пароль приходит из PasswordBox через view.
    /// </summary>
    public async Task<bool> SubmitAsync(string? password, CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;
        _password = (password ?? string.Empty).Trim();

        if (IsCreateMode)
        {
            return await SubmitCreateAsync(cancellationToken);
        }

        var (request, hasChanges) = BuildUpdateRequest();
        if (!hasChanges)
        {
            StatusText = "Изменений нет.";
            return false;
        }

        IsBusy = true;
        try
        {
            var updated = await _api.UpdateUserAsync(_original!.Id, request, cancellationToken);
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

    private async Task<bool> SubmitCreateAsync(CancellationToken cancellationToken)
    {
        var username = Username.Trim();
        if (username.Length < 3)
        {
            ErrorText = "Логин — минимум 3 символа.";
            return false;
        }

        if (_password.Length < 6)
        {
            ErrorText = "Пароль — минимум 6 символов.";
            return false;
        }

        IsBusy = true;
        try
        {
            var created = await _api.CreateUserAsync(new HubUserCreateRequest
            {
                Username = username,
                Password = _password,
                FullName = NormalizeText(FullName),
                Email = NormalizeText(Email),
                Department = NormalizeText(Department),
                JobTitle = NormalizeText(JobTitle),
                // Не-admin создания нет (кнопка admin-only) — роль из формы или viewer.
                Role = CanEditPrivileged ? _role : "viewer",
                IsActive = true,
            }, cancellationToken);
            Saved?.Invoke(created);
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
    /// Diff с исходной записью → HubUserUpdateRequest: не-admin — только
    /// делегированные {email, full_name, department, job_title}; привилегированные
    /// поля (role, is_active, password) не уходят ни у не-admin, ни у self-edit.
    /// </summary>
    internal (HubUserUpdateRequest Request, bool HasChanges) BuildUpdateRequest()
    {
        if (_original is null)
        {
            return (new HubUserUpdateRequest(), false);
        }

        var fullName = TextChanged(FullName, _original.FullName) ? NormalizeText(FullName) : null;
        var email = TextChanged(Email, _original.Email) ? NormalizeText(Email) : null;
        var department = TextChanged(Department, _original.Department) ? NormalizeText(Department) : null;
        var jobTitle = TextChanged(JobTitle, _original.JobTitle) ? NormalizeText(JobTitle) : null;
        string? role = null;
        bool? isActive = null;
        if (CanEditPrivileged && !IsSelf)
        {
            if (!string.Equals(_role, NormalizeRole(_original.Role), StringComparison.Ordinal))
            {
                role = _role;
            }

            if (IsActive != _original.IsActive)
            {
                isActive = IsActive;
            }
        }

        var newPassword = CanEditPrivileged && _password.Length > 0 ? _password : null;
        var hasChanges = fullName is not null || email is not null || department is not null
            || jobTitle is not null || role is not null || isActive is not null
            || newPassword is not null;
        return (new HubUserUpdateRequest
        {
            FullName = fullName,
            Email = email,
            Department = department,
            JobTitle = jobTitle,
            Role = role,
            IsActive = isActive,
            Password = newPassword,
        }, hasChanges);
    }

    /// <summary>Подтверждение двойным нажатием вместо confirm-диалога веба.</summary>
    private async Task ResetTwoFactorAsync(CancellationToken cancellationToken)
    {
        if (!_resetTwoFactorArmed)
        {
            _resetTwoFactorArmed = true;
            OnPropertyChanged(nameof(ResetTwoFactorText));
            StatusText = "Нажмите ещё раз — 2FA, доверенные устройства и сессии будут сброшены.";
            return;
        }

        _resetTwoFactorArmed = false;
        OnPropertyChanged(nameof(ResetTwoFactorText));
        IsBusy = true;
        try
        {
            var result = await _api.ResetUserTwoFactorAsync(_original!.Id, cancellationToken);
            _twoFactorEnabled = false;
            OnPropertyChanged(nameof(IsResetAvailable));
            StatusText = $"2FA сброшена · устройств отключено: {result.RevokedDevices}";
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static string? NormalizeText(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }

    private static string NormalizeRole(string? role) =>
        (role ?? string.Empty).Trim().ToLowerInvariant() is { Length: > 0 } value ? value : "viewer";

    private static bool TextChanged(string? current, string? original) =>
        !string.Equals(NormalizeText(current), NormalizeText(original), StringComparison.Ordinal);

    internal static string RoleLabel(string? role) => NormalizeRole(role) switch
    {
        "admin" => "Админ",
        "operator" => "Оператор",
        "viewer" => "Просмотр",
        { Length: > 0 } other => other,
        _ => "—",
    };
}

/// <summary>Строка раздела «Отделы» (items[] GET /departments).</summary>
public sealed class AdminDepartmentItemViewModel : ObservableObject
{
    private string _membersText;

    public AdminDepartmentItemViewModel(HubAdminDepartment department)
    {
        ArgumentNullException.ThrowIfNull(department);
        Id = (department.Id ?? string.Empty).Trim();
        Title = MfuFormat.OrDash(department.Name);
        MembersCount = department.MembersCount;
        SourceText = string.Equals(department.Source, "ad", StringComparison.OrdinalIgnoreCase)
            ? "AD"
            : "Вручную";
        _membersText = FormatMembersText(MembersCount, department.ManagersCount);
        InactiveText = department.IsActive ? string.Empty : "неактивен";
        HasInactive = !department.IsActive;
        AutomationName = $"Отдел {Title}";
        SearchIndex = Title.ToLowerInvariant();
    }

    public string Id { get; }
    public string Title { get; }
    public string SourceText { get; }

    /// <summary>«N участ. · M нач.» — обновляется после сохранения руководителей.</summary>
    public string MembersText
    {
        get => _membersText;
        private set => SetProperty(ref _membersText, value);
    }

    public string InactiveText { get; }
    public bool HasInactive { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }

    /// <summary>Счётчик участников из списка — для строки MembersText.</summary>
    internal int MembersCount { get; }

    /// <summary>После PUT managers — пересчёт «M нач.» без перезагрузки списка.</summary>
    internal void ApplyManagersCount(int managersCount) =>
        MembersText = FormatMembersText(MembersCount, managersCount);

    private static string FormatMembersText(int membersCount, int managersCount) =>
        $"{membersCount} участ. · {managersCount} нач.";
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
        Roles = roles;
        RolesText = string.Join(", ", roles.Select(role =>
            string.Equals(role, "manager", StringComparison.OrdinalIgnoreCase) ? "начальник" : "участник"));
        AutomationName = $"Участник отдела {Title}";
    }

    /// <summary>Активные роли membership (member|manager) — для диалога руководителей.</summary>
    internal IReadOnlyList<string> Roles { get; }

    /// <summary>У пользователя есть активная manager-membership.</summary>
    internal bool IsManager => Roles.Any(role =>
        string.Equals(role, "manager", StringComparison.OrdinalIgnoreCase));

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

/// <summary>Строка раздела «AI-боты» (AiBotsTab веба).</summary>
public sealed class AdminAiBotItemViewModel
{
    public AdminAiBotItemViewModel(HubAdminAiBot bot, bool canEdit = false)
    {
        ArgumentNullException.ThrowIfNull(bot);
        Source = bot;
        CanEdit = canEdit;
        var slug = (bot.Slug ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(bot.Title) ? bot.Title.Trim() : (slug.Length > 0 ? slug : "—");
        SlugText = slug;
        TypeText = DescribeType(bot);
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

    /// <summary>Тип агента — как describeType веба (sandbox/general/assistant/corporate).</summary>
    internal static string DescribeType(HubAdminAiBot bot) =>
        (bot.Surface ?? string.Empty).Trim() switch
        {
            "sandbox" => "OpenCode · файлы и код",
            "general" => "Обычный ИИ-чат · доступен всем",
            _ => string.Equals((bot.Slug ?? string.Empty).Trim(), "corp-assistant", StringComparison.Ordinal)
                ? "HUB Ассистент · всем с правом ИИ"
                : "Агент HUB · персональный доступ",
        };

    /// <summary>Исходная запись бота — исходные значения для диалога правки.</summary>
    internal HubAdminAiBot Source { get; }

    /// <summary>Кнопка «Изменить» в строке — право settings.ai.manage (гейт раздела).</summary>
    public bool CanEdit { get; }

    public string Title { get; }
    public string SlugText { get; }
    public string TypeText { get; }
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
/// Диалог «Изменить AI-бота» / «Новый AI-бот» (BotSettingsWorkspace веба).
/// Редактируется срез «Настройки ответа» + переключатели файлов; PATCH шлёт
/// только изменённые поля (exclude_unset). Sandbox-бот (OpenCode) — только
/// название/описание, как в вебе. Инструменты, режим БД, лимиты и доступ
/// сотрудников намеренно не редактируются: tool_settings сервер заменяет
/// целиком, частичный PATCH затёр бы настройки, сделанные в вебе.
/// </summary>
public sealed class AdminAiBotEditorViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly HubAdminAiBot? _original;

    private string _slug = string.Empty;
    private string _title = string.Empty;
    private string _description = string.Empty;
    private string _systemPrompt = string.Empty;
    private string _model = string.Empty;
    private string _temperatureText = string.Empty;
    private string _maxTokensText = string.Empty;
    private string _allowedKbScope = string.Empty;
    private bool _isEnabled = true;
    private bool _allowFileInput = true;
    private bool _allowGeneratedArtifacts = true;
    private bool _allowKbDocumentDelivery;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;

    /// <summary>Режим правки: исходные значения берутся из записи бота.</summary>
    public AdminAiBotEditorViewModel(IHubApiClient api, HubAdminAiBot bot)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = bot ?? throw new ArgumentNullException(nameof(bot));
        IsSandboxMode = string.Equals(
            (bot.Surface ?? string.Empty).Trim(), "sandbox", StringComparison.OrdinalIgnoreCase);

        _slug = (bot.Slug ?? string.Empty).Trim();
        _title = (bot.Title ?? string.Empty).Trim();
        _description = (bot.Description ?? string.Empty).Trim();
        _systemPrompt = (bot.SystemPrompt ?? string.Empty).Trim();
        _model = (bot.Model ?? string.Empty).Trim();
        _temperatureText = bot.Temperature.ToString("0.###", CultureInfo.InvariantCulture);
        _maxTokensText = bot.MaxTokens.ToString(CultureInfo.InvariantCulture);
        _allowedKbScope = string.Join(", ", bot.AllowedKbScope ?? []);
        _isEnabled = bot.IsEnabled;
        _allowFileInput = bot.AllowFileInput;
        _allowGeneratedArtifacts = bot.AllowGeneratedArtifacts;
        _allowKbDocumentDelivery = bot.AllowKbDocumentDelivery;
        InitCommands();
    }

    /// <summary>Режим создания — дефолты как у newDraft веб-админки.</summary>
    public AdminAiBotEditorViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        _slug = "new-ai-bot";
        _title = "Новый AI бот";
        _temperatureText = "0.2";
        _maxTokensText = "2000";
        InitCommands();
    }

    private void InitCommands() =>
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);

    /// <summary>Сохранение успешно — родитель обновляет строку и закрывает диалог.</summary>
    internal Action<HubAdminAiBot>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    // ---- Режим и заголовки ----

    public bool IsCreateMode { get; }

    /// <summary>Sandbox-агент (OpenCode): веб правит только название/описание.</summary>
    public bool IsSandboxMode { get; }

    /// <summary>Slug — только режим создания (у существующего не меняется, как в вебе).</summary>
    public bool IsSlugVisible => IsCreateMode;

    /// <summary>Поля «Настройки ответа» + переключатели скрыты у sandbox-бота.</summary>
    public bool AreMainFieldsVisible => !IsSandboxMode;

    public string TitleText => IsCreateMode ? "Новый AI-бот" : "Изменить AI-бота";

    public string SubtitleText => IsCreateMode
        ? "Карточка агента HUB"
        : $"{_slug} · {AdminAiBotItemViewModel.DescribeType(_original!)}";

    /// <summary>Подсказка вместо полей у sandbox-бота — текст как в веб-алерте.</summary>
    public string SandboxHintText =>
        "Модель, ограничения команд и запуск OpenCode управляются серверной " +
        "конфигурацией. Эта форма меняет только название и описание.";

    /// <summary>Подсказка под формой: матрица инструментов и доступ — в вебе.</summary>
    public string ToolsHintText =>
        "Инструменты, режим базы данных, лимиты вызовов и доступ сотрудников " +
        "настраиваются в веб-версии HUB.";

    // ---- Поля формы ----

    public string Slug
    {
        get => _slug;
        set => SetProperty(ref _slug, value ?? string.Empty);
    }

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

    public string SystemPrompt
    {
        get => _systemPrompt;
        set => SetProperty(ref _systemPrompt, value ?? string.Empty);
    }

    public string Model
    {
        get => _model;
        set => SetProperty(ref _model, value ?? string.Empty);
    }

    /// <summary>Текстовое поле «Вариативность ответа»: число 0–2, парсится при сохранении.</summary>
    public string TemperatureText
    {
        get => _temperatureText;
        set => SetProperty(ref _temperatureText, value ?? string.Empty);
    }

    /// <summary>Текстовое поле «Лимит токенов ответа»: целое 256–16000 по контракту.</summary>
    public string MaxTokensText
    {
        get => _maxTokensText;
        set => SetProperty(ref _maxTokensText, value ?? string.Empty);
    }

    /// <summary>KB scope — текст через запятую (как draft.allowed_kb_scope веба).</summary>
    public string AllowedKbScope
    {
        get => _allowedKbScope;
        set => SetProperty(ref _allowedKbScope, value ?? string.Empty);
    }

    public bool IsEnabled
    {
        get => _isEnabled;
        set => SetProperty(ref _isEnabled, value);
    }

    public bool AllowFileInput
    {
        get => _allowFileInput;
        set => SetProperty(ref _allowFileInput, value);
    }

    public bool AllowGeneratedArtifacts
    {
        get => _allowGeneratedArtifacts;
        set => SetProperty(ref _allowGeneratedArtifacts, value);
    }

    public bool AllowKbDocumentDelivery
    {
        get => _allowKbDocumentDelivery;
        set => SetProperty(ref _allowKbDocumentDelivery, value);
    }

    // ---- Состояние ----

    public bool AreInputsEnabled => !IsBusy;

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
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

    public ICommand CloseCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>
    /// Сохранение: create → POST /ai-bots; edit → PATCH только изменённых.
    /// 400/403/422 — текст сервера в ErrorText, диалог не закрывается.
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;
        if (!TryValidate(out var temperature, out var maxTokens))
        {
            return false;
        }

        if (IsCreateMode)
        {
            return await SubmitCreateAsync(temperature!.Value, maxTokens!.Value, cancellationToken);
        }

        var (request, hasChanges) = BuildUpdateRequest(temperature, maxTokens);
        if (!hasChanges)
        {
            StatusText = "Изменений нет.";
            return false;
        }

        IsBusy = true;
        try
        {
            var updated = await _api.UpdateAiBotAsync(_original!.Id!, request, cancellationToken);
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

    /// <summary>Локальная валидация: title/slug обязательны; числа — по контракту.</summary>
    private bool TryValidate(out double? temperature, out int? maxTokens)
    {
        temperature = null;
        maxTokens = null;
        if (Title.Trim().Length < 2)
        {
            ErrorText = "Название — минимум 2 символа.";
            return false;
        }

        if (IsCreateMode && Slug.Trim().Length < 2)
        {
            ErrorText = "Slug — минимум 2 символа.";
            return false;
        }

        if (IsSandboxMode)
        {
            return true;
        }

        if (!TryParseDouble(TemperatureText, out var parsedTemperature)
            || parsedTemperature < 0.0 || parsedTemperature > 2.0)
        {
            ErrorText = "Вариативность ответа — число от 0 до 2.";
            return false;
        }

        if (!int.TryParse(MaxTokensText.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedTokens)
            || parsedTokens < 256 || parsedTokens > 16000)
        {
            ErrorText = "Лимит токенов — целое от 256 до 16000.";
            return false;
        }

        temperature = parsedTemperature;
        maxTokens = parsedTokens;
        return true;
    }

    private async Task<bool> SubmitCreateAsync(
        double temperature,
        int maxTokens,
        CancellationToken cancellationToken)
    {
        IsBusy = true;
        try
        {
            var created = await _api.CreateAiBotAsync(new HubAiBotCreateRequest
            {
                // slug — нижний регистр, как field_validator бэкенда.
                Slug = Slug.Trim().ToLowerInvariant(),
                Title = Title.Trim(),
                Description = Description.Trim(),
                SystemPrompt = SystemPrompt.Trim(),
                Model = Model.Trim(),
                Temperature = temperature,
                MaxTokens = maxTokens,
                AllowedKbScope = ParseKbScope(AllowedKbScope),
                AllowFileInput = AllowFileInput,
                AllowGeneratedArtifacts = AllowGeneratedArtifacts,
                AllowKbDocumentDelivery = AllowKbDocumentDelivery,
                IsEnabled = IsEnabled,
            }, cancellationToken);
            Saved?.Invoke(created);
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
    /// Diff с исходной записью → HubAiBotUpdateRequest (только изменённые поля).
    /// Sandbox — только title/description, как в вебе. Пустой текст уходит как ""
    /// (поле сервер чистит), а не как null («не трогать»).
    /// </summary>
    internal (HubAiBotUpdateRequest Request, bool HasChanges) BuildUpdateRequest(
        double? temperature,
        int? maxTokens)
    {
        if (_original is null)
        {
            return (new HubAiBotUpdateRequest(), false);
        }

        var original = _original;
        string? title = TextChanged(Title, original.Title) ? Title.Trim() : null;
        string? description = TextChanged(Description, original.Description) ? Description.Trim() : null;
        if (IsSandboxMode)
        {
            return (new HubAiBotUpdateRequest { Title = title, Description = description },
                title is not null || description is not null);
        }

        var parsedKbScope = ParseKbScope(AllowedKbScope);
        var kbChanged = !parsedKbScope.SequenceEqual(original.AllowedKbScope ?? []);
        var request = new HubAiBotUpdateRequest
        {
            Title = title,
            Description = description,
            SystemPrompt = TextChanged(SystemPrompt, original.SystemPrompt) ? SystemPrompt.Trim() : null,
            Model = TextChanged(Model, original.Model) ? Model.Trim() : null,
            Temperature = temperature != original.Temperature ? temperature : null,
            MaxTokens = maxTokens != original.MaxTokens ? maxTokens : null,
            AllowedKbScope = kbChanged ? parsedKbScope : null,
            AllowFileInput = AllowFileInput != original.AllowFileInput ? AllowFileInput : null,
            AllowGeneratedArtifacts = AllowGeneratedArtifacts != original.AllowGeneratedArtifacts
                ? AllowGeneratedArtifacts
                : null,
            AllowKbDocumentDelivery = AllowKbDocumentDelivery != original.AllowKbDocumentDelivery
                ? AllowKbDocumentDelivery
                : null,
            IsEnabled = IsEnabled != original.IsEnabled ? IsEnabled : null,
        };
        var hasChanges = request.Title is not null || request.Description is not null
            || request.SystemPrompt is not null || request.Model is not null
            || request.Temperature is not null || request.MaxTokens is not null
            || request.AllowedKbScope is not null || request.AllowFileInput is not null
            || request.AllowGeneratedArtifacts is not null || request.AllowKbDocumentDelivery is not null
            || request.IsEnabled is not null;
        return (request, hasChanges);
    }

    private static bool TryParseDouble(string? text, out double value) =>
        double.TryParse(
            (text ?? string.Empty).Trim().Replace(',', '.'),
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out value);

    /// <summary>«a, b ,c» → [a,b,c] — как pack() веба (split+trim+filter).</summary>
    private static IReadOnlyList<string> ParseKbScope(string? text) =>
        (text ?? string.Empty)
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);

    private static bool TextChanged(string? current, string? original) =>
        !string.Equals(
            (current ?? string.Empty).Trim(),
            (original ?? string.Empty).Trim(),
            StringComparison.Ordinal);
}

/// <summary>Строка диалога «Руководители отдела»: участник + чекбокс «Начальник».</summary>
public sealed class AdminDepartmentManagerRowViewModel : ObservableObject
{
    private bool _isManager;

    public AdminDepartmentManagerRowViewModel(AdminDepartmentMemberItemViewModel member)
    {
        ArgumentNullException.ThrowIfNull(member);
        UserId = member.UserId;
        Title = member.Title;
        UsernameText = member.UsernameText;
        JobTitleText = member.JobTitleText;
        _isManager = member.IsManager;
        AutomationName = $"Руководитель: {Title}";
    }

    public long UserId { get; }
    public string Title { get; }
    public string UsernameText { get; }
    public string JobTitleText { get; }
    public string AutomationName { get; }

    public bool IsManager
    {
        get => _isManager;
        set
        {
            if (SetProperty(ref _isManager, value))
            {
                Changed?.Invoke();
            }
        }
    }

    /// <summary>Подписка VM диалога: пересчёт счётчика начальников.</summary>
    internal Action? Changed;
}

/// <summary>
/// Диалог «Руководители отдела» — зеркало DepartmentsTab веба: чекбокс
/// «Начальник» у каждого участника, сохранение — PUT /departments/{id}/managers
/// полным набором manager_user_ids (участники выбираются из состава отдела,
/// как в вебе). 400/403/404 — текст сервера в ErrorText.
/// </summary>
public sealed class AdminDepartmentManagersViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly string _departmentId;
    private readonly HashSet<long> _originalManagerIds;
    private string _countText = string.Empty;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;

    public AdminDepartmentManagersViewModel(
        IHubApiClient api,
        string departmentId,
        string departmentTitle,
        IReadOnlyList<AdminDepartmentMemberItemViewModel> members)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _departmentId = departmentId ?? throw new ArgumentNullException(nameof(departmentId));
        DepartmentTitleText = departmentTitle ?? string.Empty;
        foreach (var member in members ?? [])
        {
            var row = new AdminDepartmentManagerRowViewModel(member)
            {
                Changed = OnRowChanged,
            };
            Rows.Add(row);
        }

        _originalManagerIds = Rows.Where(row => row.IsManager).Select(row => row.UserId).ToHashSet();
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
        UpdateCountText();
    }

    /// <summary>Сохранение успешно: items ответа PUT — родитель пересобирает состав.</summary>
    internal Action<IReadOnlyList<HubAdminDepartmentMember>>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    public ObservableCollection<AdminDepartmentManagerRowViewModel> Rows { get; } = [];

    public string TitleText => "Руководители отдела";
    public string DepartmentTitleText { get; }
    public string SubtitleText => $"«{DepartmentTitleText}» · отметьте начальников";

    public bool IsEmpty => Rows.Count == 0;
    public string EmptyText => "У отдела пока нет участников — начальников назначить нельзя.";

    /// <summary>Живой счётчик «Начальников: N» — пересчёт при каждом чекбоксе.</summary>
    public string CountText
    {
        get => _countText;
        private set => SetProperty(ref _countText, value);
    }

    public bool AreInputsEnabled => !IsBusy;

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
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

    public ICommand CloseCommand { get; }

    /// <summary>Сохранение: без изменений PUT не уходит; ответ — новый состав отдела.</summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;
        var desired = Rows.Where(row => row.IsManager).Select(row => row.UserId).ToList();
        if (desired.ToHashSet().SetEquals(_originalManagerIds))
        {
            StatusText = "Изменений нет.";
            return false;
        }

        IsBusy = true;
        try
        {
            var result = await _api.SetDepartmentManagersAsync(_departmentId, desired, cancellationToken);
            Saved?.Invoke(result.Items ?? []);
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

    private void OnRowChanged() => UpdateCountText();

    private void UpdateCountText() =>
        CountText = $"Начальников: {Rows.Count(row => row.IsManager)}";
}

/// <summary>
/// Пилюля сводки снимка квот («Всего: N», «≥ 90%: N», «Превышены: N», «Без квоты: N») —
/// разрез MailboxQuotaSnapshotStats; StatusTone красит текст через StatusPillTextStyle.
/// </summary>
public sealed class AdminMailQuotaStatItem
{
    public AdminMailQuotaStatItem(string label, int count, string tone)
    {
        Text = $"{label}: {count.ToString(CultureInfo.CurrentCulture)}";
        StatusTone = tone;
    }

    public string Text { get; }

    /// <summary>primary|warning|error|info|muted — триггеры StatusPillTextStyle.</summary>
    public string StatusTone { get; }
}

/// <summary>Опция селектора снимка квот («#7 · 19.11.2026 10:00»).</summary>
public sealed class AdminMailQuotaSnapshotItem
{
    public AdminMailQuotaSnapshotItem(HubMailQuotaSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        Snapshot = snapshot;
        Id = snapshot.Id;
        Label = $"#{snapshot.Id} · {MfuFormat.FormatDateTime(snapshot.CollectedAt ?? snapshot.ImportedAt)}";
    }

    public int Id { get; }
    internal HubMailQuotaSnapshot Snapshot { get; }
    public string Label { get; }
}

/// <summary>Опция фильтра базы Exchange (Value null — «Все базы»).</summary>
public sealed class AdminMailQuotaDatabaseItem
{
    public AdminMailQuotaDatabaseItem(string? value, string label)
    {
        Value = value;
        Label = label;
    }

    public string? Value { get; }
    public string Label { get; }
}

/// <summary>
/// Строка таблицы квот — порт MailQuotaReport/MailQuotaStatus веба:
/// статус из эффективного процента (server used_percent, иначе used/quota),
/// quota_bytes у default-строк уже подставлен сервером (MAIL_QUOTA_DEFAULT_GB=5).
/// </summary>
public sealed class AdminMailQuotaRowItemViewModel
{
    /// <summary>Лимит «по умолчанию» сервера (MAIL_QUOTA_DEFAULT_GB=5) — для строк без quota_bytes.</summary>
    private const double DefaultQuotaBytes = 5d * 1024 * 1024 * 1024;

    public AdminMailQuotaRowItemViewModel(HubMailQuotaRow row)
    {
        ArgumentNullException.ThrowIfNull(row);
        Id = row.Id;
        var email = (row.Email ?? string.Empty).Trim();
        var displayName = (row.DisplayName ?? string.Empty).Trim();
        Title = displayName.Length > 0 ? displayName : (email.Length > 0 ? email : "—");
        EmailText = email;
        DatabaseText = MfuFormat.OrDash(row.DatabaseName);
        UsedText = FormatBytes(row.UsedBytes);
        QuotaText = row.UsesDefaultQuota
            ? $"{FormatBytes(row.QuotaBytes)} по умолч."
            : FormatBytes(row.QuotaBytes);
        FreeText = FormatBytes(row.FreeBytes);
        var percent = ResolveUsedPercent(row);
        HasPercent = percent is not null;
        PercentValue = percent is { } value ? Math.Clamp(value, 0, 100) : 0;
        PercentText = percent is { } shown ? $"{shown:0.#}%" : "—";
        (StatusText, StatusTone) = ResolveStatus(row, percent);
        AutomationName = $"Ящик {Title}";
    }

    public int Id { get; }
    public string Title { get; }
    public string EmailText { get; }
    public string StatusText { get; }

    /// <summary>success|warning|error|muted — триггеры StatusPillTextStyle/QuotaBarStyle.</summary>
    public string StatusTone { get; }
    public string UsedText { get; }
    public string QuotaText { get; }
    public string FreeText { get; }
    public string PercentText { get; }
    public double PercentValue { get; }
    public bool HasPercent { get; }
    public string DatabaseText { get; }
    public string AutomationName { get; }

    /// <summary>resolveEffectiveUsedPercent веба: used_percent, иначе used/quota*100.</summary>
    private static double? ResolveUsedPercent(HubMailQuotaRow row)
    {
        if (row.UsedPercent is { } percent && double.IsFinite(percent))
        {
            return percent;
        }

        var quota = row.QuotaBytes is { } q && q > 0
            ? (double)q
            : row.UsesDefaultQuota ? DefaultQuotaBytes : 0;
        if (row.UsedBytes is not { } used || quota <= 0)
        {
            return null;
        }

        return Math.Round(used * 100.0 / quota, 2);
    }

    /// <summary>resolveQuotaStatus веба: ≥100 critical, ≥90 warning, иначе ok/unknown.</summary>
    private static (string Text, string Tone) ResolveStatus(HubMailQuotaRow row, double? percent)
    {
        if (row.QuotaBytes is null && !row.UsesDefaultQuota)
        {
            return ("—", "muted");
        }

        return percent switch
        {
            null => row.UsesDefaultQuota ? ("По умолч. 5 ГБ", "muted") : ("—", "muted"),
            >= 100 => ("Переполнен", "error"),
            >= 90 => ("90–100%", "warning"),
            _ => ("Норма", "success"),
        };
    }

    /// <summary>formatBytes веба: B/KB/MB/GB с «—» без значения.</summary>
    internal static string FormatBytes(long? bytes) => bytes switch
    {
        null or < 0 => "—",
        0 => "0 Б",
        < 1024 => $"{bytes} Б",
        < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
        < 1024L * 1024 * 1024 => $"{bytes / (1024.0 * 1024):0.#} МБ",
        _ => $"{bytes / (1024.0 * 1024 * 1024):0.#} ГБ",
    };
}

/// <summary>Опция селектора категории в редакторе новости (Id=null — «Без категории»).</summary>
public sealed class AdminNewsCategoryOption
{
    public AdminNewsCategoryOption(string? id, string name)
    {
        Id = id;
        Name = name;
    }

    public string? Id { get; }
    public string Name { get; }
}

/// <summary>Известный тег — чип-подсказка под полем «Теги» редактора новости.</summary>
public sealed class AdminNewsTagItem
{
    public AdminNewsTagItem(HubAnnouncementTag tag)
    {
        ArgumentNullException.ThrowIfNull(tag);
        Name = (tag.Name ?? string.Empty).Trim();
        UsageText = tag.UsageCount > 0
            ? tag.UsageCount.ToString(CultureInfo.CurrentCulture)
            : string.Empty;
    }

    public string Name { get; }
    public string UsageText { get; }
}

/// <summary>Существующее вложение новости (read-only чип в редакторе правки).</summary>
public sealed class AdminNewsAttachmentItem
{
    public AdminNewsAttachmentItem(HubAnnouncementAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        Name = MfuFormat.OrDash(attachment.FileName);
        SizeText = AdminMailQuotaRowItemViewModel.FormatBytes(attachment.FileSize);
    }

    public string Name { get; }
    public string SizeText { get; }
    public string DisplayText => $"{Name} · {SizeText}";
}

/// <summary>
/// Строка таблицы раздела «Новости» — элемент GET /hub/announcements/manage.
/// Статус — серверный (чипы = серверный фильтр); can_manage считает бэкенд
/// (автор или модератор), удаление — только announcements.moderate (как роут DELETE).
/// «Удалить» — armed-паттерн «Сбросить 2FA»: первое нажатие спрашивает, второе удаляет.
/// </summary>
public sealed class AdminNewsItemViewModel : ObservableObject
{
    private bool _deleteArmed;

    public AdminNewsItemViewModel(HubAnnouncementItem item, bool canModerate)
    {
        ArgumentNullException.ThrowIfNull(item);
        Source = item;
        Id = (item.Id ?? string.Empty).Trim();
        Status = (item.Status ?? string.Empty).Trim().ToLowerInvariant();
        (StatusText, StatusTone) = Status switch
        {
            "draft" => ("Черновик", "muted"),
            "scheduled" => ("Запланирована", "warning"),
            "published" => ("Опубликована", "success"),
            "archived" => ("В архиве", "info"),
            { Length: > 0 } other => (other, "muted"),
            _ => ("—", "muted"),
        };
        Title = MfuFormat.OrDash(item.Title);
        PreviewText = (item.Preview ?? string.Empty).Trim();
        AuthorText = !string.IsNullOrWhiteSpace(item.AuthorFullName)
            ? item.AuthorFullName!.Trim()
            : !string.IsNullOrWhiteSpace(item.AuthorUsername)
                ? "@" + item.AuthorUsername!.Trim()
                : "—";
        DateText = NewsListItemViewModel.FormatDate(item.UpdatedAt ?? item.PublishedAt ?? item.CreatedAt);
        PriorityText = (item.Priority ?? string.Empty).Trim() switch
        {
            "low" => "Низкий",
            "high" => "Высокий",
            _ => "Обычный",
        };
        CategoryText = (item.Category?.Name ?? string.Empty).Trim();
        TagsText = string.Join(
            ", ",
            (item.Tags ?? []).Select(t => (t.Name ?? string.Empty).Trim()).Where(n => n.Length > 0));
        HasRequiresAck = item.RequiresAck;
        IsPinned = item.IsPinned;
        // Сервер выставляет can_manage (автор или модератор); модератор правит всё.
        CanManage = item.CanManage || canModerate;
        CanEdit = CanManage;
        CanPublish = CanManage && Status != "published";
        CanArchive = CanManage && Status != "archived";
        CanViewStats = CanManage;
        CanDelete = canModerate;
        AutomationName = $"Новость {Title}";
        SearchIndex = string.Join(
                ' ', Title, PreviewText, AuthorText, CategoryText, TagsText)
            .ToLowerInvariant();
    }

    /// <summary>Исходный элемент — предзаполнение редактора и diff для PATCH.</summary>
    internal HubAnnouncementItem Source { get; }

    public string Id { get; }
    /// <summary>draft|scheduled|published|archived — сырой статус (совпадает с чипом).</summary>
    public string Status { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string Title { get; }
    public string PreviewText { get; }
    public string AuthorText { get; }
    public string DateText { get; }
    public string PriorityText { get; }
    public string CategoryText { get; }
    public string TagsText { get; }
    public bool HasRequiresAck { get; }
    public bool IsPinned { get; }
    /// <summary>Правка/публикация/архив — автор или модератор (серверная can_manage).</summary>
    public bool CanManage { get; }
    public bool CanEdit { get; }
    public bool CanPublish { get; }
    public bool CanArchive { get; }
    public bool CanViewStats { get; }
    /// <summary>DELETE роут требует announcements.moderate — кнопка только у модератора.</summary>
    public bool CanDelete { get; }
    public string AutomationName { get; }
    public string SearchIndex { get; }

    /// <summary>Подпись кнопки удаления: «Удалить» → «Удалить?» после первого нажатия.</summary>
    public string DeleteText => _deleteArmed ? "Удалить?" : "Удалить";

    /// <summary>Первое нажатие взводит (true → команда уже может удалять).</summary>
    public bool ArmDelete()
    {
        if (_deleteArmed)
        {
            return true;
        }

        _deleteArmed = true;
        OnPropertyChanged(nameof(DeleteText));
        return false;
    }
}

/// <summary>
/// Редактор новости «+ Новость» / «Изменить» раздела «Новости».
/// Создание: «В черновик» (POST /drafts без файлов, иначе POST multipart
/// со status=draft) и «Опубликовать» (POST JSON или multipart). Правка:
/// PATCH только изменённых полей; новые файлы — POST {id}/attachments
/// (PATCH JSON-only, существующие вложения здесь read-only).
/// Файл > 20 МБ отсекается на клиенте (MAX_ANNOUNCEMENT_FILE_BYTES).
/// </summary>
public sealed class AdminNewsEditorViewModel : ObservableObject
{
    /// <summary>MAX_ANNOUNCEMENT_FILE_BYTES роутов hub.py — пред-проверка до отправки.</summary>
    internal const long MaxFileBytes = 20L * 1024 * 1024;

    private static readonly char[] TagSeparators = [',', ';', '\n', '\r'];

    private readonly IHubApiClient _api;
    private readonly HubAnnouncementItem? _original;
    private readonly Func<IReadOnlyList<string>>? _filePicker;
    private string? _createdCategoryId;
    private string _title = string.Empty;
    private string _preview = string.Empty;
    private string _body = string.Empty;
    private string _priority = "normal";
    private string _tagsText = string.Empty;
    private string _newCategoryName = string.Empty;
    private AdminNewsCategoryOption? _selectedCategory;
    private bool _requiresAck;
    private bool _isPinned;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;

    /// <summary>Режим создания — дефолты как у веб-редактора новости.</summary>
    public AdminNewsEditorViewModel(
        IHubApiClient api,
        IReadOnlyList<HubAnnouncementCategory>? categories,
        IReadOnlyList<HubAnnouncementTag>? knownTags,
        bool canCreateCategories,
        Func<IReadOnlyList<string>>? filePicker)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        CanCreateCategories = canCreateCategories;
        _filePicker = filePicker;
        InitTaxonomy(categories, knownTags);
        InitCommands();
    }

    /// <summary>Режим правки — исходные значения из элемента manage-выдачи.</summary>
    public AdminNewsEditorViewModel(
        IHubApiClient api,
        HubAnnouncementItem item,
        IReadOnlyList<HubAnnouncementCategory>? categories,
        IReadOnlyList<HubAnnouncementTag>? knownTags,
        bool canCreateCategories,
        Func<IReadOnlyList<string>>? filePicker)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = item ?? throw new ArgumentNullException(nameof(item));
        CanCreateCategories = canCreateCategories;
        _filePicker = filePicker;
        _title = (item.Title ?? string.Empty).Trim();
        _preview = item.Preview ?? string.Empty;
        _body = item.Body ?? string.Empty;
        _priority = NormalizePriority(item.Priority);
        _requiresAck = item.RequiresAck;
        _isPinned = item.IsPinned;
        _tagsText = string.Join(
            ", ",
            (item.Tags ?? []).Select(t => (t.Name ?? string.Empty).Trim()).Where(n => n.Length > 0));
        foreach (var attachment in item.Attachments ?? [])
        {
            ExistingAttachments.Add(new AdminNewsAttachmentItem(attachment));
        }

        InitTaxonomy(categories, knownTags);
        var categoryId = item.CategoryId ?? item.Category?.Id;
        if (!string.IsNullOrWhiteSpace(categoryId))
        {
            SelectedCategory = CategoryOptions.FirstOrDefault(option =>
                string.Equals(option.Id, categoryId.Trim(), StringComparison.Ordinal))
                ?? SelectedCategory;
        }

        InitCommands();
    }

    private void InitTaxonomy(
        IReadOnlyList<HubAnnouncementCategory>? categories,
        IReadOnlyList<HubAnnouncementTag>? knownTags)
    {
        CategoryOptions.Add(new AdminNewsCategoryOption(null, "Без категории"));
        foreach (var category in categories ?? [])
        {
            var name = (category.Name ?? string.Empty).Trim();
            if (!string.IsNullOrWhiteSpace(category.Id) && name.Length > 0)
            {
                CategoryOptions.Add(new AdminNewsCategoryOption(category.Id!.Trim(), name));
            }
        }

        _selectedCategory = CategoryOptions[0];
        foreach (var tag in knownTags ?? [])
        {
            var item = new AdminNewsTagItem(tag);
            if (item.Name.Length > 0)
            {
                KnownTags.Add(item);
            }
        }
    }

    private void InitCommands()
    {
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
        AddFilesCommand = new NativeRelayCommand(
            () => AddFiles(_filePicker?.Invoke() ?? []),
            () => !IsBusy);
        RemoveAttachmentCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MailComposeAttachmentViewModel attachment)
            {
                Attachments.Remove(attachment);
                OnPropertyChanged(nameof(HasAttachments));
            }
        });
        AppendTagCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AdminNewsTagItem tag)
            {
                AppendTag(tag.Name);
            }
        });
        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(publish: true, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        SaveDraftCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(publish: false, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
    }

    /// <summary>Сохранение успешно — родитель обновляет строку и закрывает оверлей.</summary>
    internal Action<HubAnnouncementItem>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    /// <summary>Свежая категория — родитель дополняет справочник следующих редакторов.</summary>
    internal Action<HubAnnouncementCategory>? CategoryCreated;

    public bool IsCreateMode { get; }

    /// <summary>announcements.moderate — поле «Новая категория» и её создание на сервере.</summary>
    public bool CanCreateCategories { get; }

    public string TitleText => IsCreateMode ? "Новая новость" : "Изменить новость";

    public string SubtitleText => IsCreateMode
        ? "Черновик или публикация в ленту HUB"
        : $"Статус: {(_original?.Status ?? string.Empty).Trim() switch
        {
            "draft" => "черновик",
            "scheduled" => "запланирована",
            "published" => "опубликована",
            "archived" => "в архиве",
            var other => other.Length > 0 ? other : "—",
        }}";

    /// <summary>Подпись основной кнопки: создание — «Опубликовать», правка — «Сохранить».</summary>
    public string SubmitText => IsCreateMode ? "Опубликовать" : "Сохранить";

    public bool AreInputsEnabled => !IsBusy;

    // ---- Поля формы ----

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value ?? string.Empty);
    }

    public string Preview
    {
        get => _preview;
        set => SetProperty(ref _preview, value ?? string.Empty);
    }

    public string Body
    {
        get => _body;
        set => SetProperty(ref _body, value ?? string.Empty);
    }

    public bool IsPriorityLow
    {
        get => _priority == "low";
        set { if (value) SelectedPriority = "low"; }
    }

    public bool IsPriorityNormal
    {
        get => _priority == "normal";
        set { if (value) SelectedPriority = "normal"; }
    }

    public bool IsPriorityHigh
    {
        get => _priority == "high";
        set { if (value) SelectedPriority = "high"; }
    }

    internal string SelectedPriority
    {
        set
        {
            var normalized = NormalizePriority(value);
            if (SetProperty(ref _priority, normalized))
            {
                OnPropertyChanged(nameof(IsPriorityLow));
                OnPropertyChanged(nameof(IsPriorityNormal));
                OnPropertyChanged(nameof(IsPriorityHigh));
            }
        }
    }

    /// <summary>Опции селектора категории («Без категории» + активные категории).</summary>
    public ObservableCollection<AdminNewsCategoryOption> CategoryOptions { get; } = [];

    public AdminNewsCategoryOption? SelectedCategory
    {
        get => _selectedCategory;
        set => SetProperty(ref _selectedCategory, value);
    }

    /// <summary>Имя новой категории (moderate): создаётся при сохранении и выбирается.</summary>
    public string NewCategoryName
    {
        get => _newCategoryName;
        set => SetProperty(ref _newCategoryName, value ?? string.Empty);
    }

    /// <summary>Теги через запятую — массив имён в JSON/multipart (как веб).</summary>
    public string TagsText
    {
        get => _tagsText;
        set => SetProperty(ref _tagsText, value ?? string.Empty);
    }

    /// <summary>Известные теги — чипы-подсказки под полем «Теги».</summary>
    public ObservableCollection<AdminNewsTagItem> KnownTags { get; } = [];

    public bool HasKnownTags => KnownTags.Count > 0;

    public bool RequiresAck
    {
        get => _requiresAck;
        set => SetProperty(ref _requiresAck, value);
    }

    public bool IsPinned
    {
        get => _isPinned;
        set => SetProperty(ref _isPinned, value);
    }

    // ---- Вложения ----

    /// <summary>Новые локальные файлы — уйдут multipart при создании / POST attachments при правке.</summary>
    public ObservableCollection<MailComposeAttachmentViewModel> Attachments { get; } = [];

    public bool HasAttachments => Attachments.Count > 0;

    /// <summary>Существующие вложения при правке — read-only (reorder/delete — в вебе).</summary>
    public ObservableCollection<AdminNewsAttachmentItem> ExistingAttachments { get; } = [];

    public bool HasExistingAttachments => ExistingAttachments.Count > 0;

    // ---- Состояние ----

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
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

    public ICommand CloseCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand AddFilesCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand RemoveAttachmentCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand AppendTagCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand SubmitCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand SaveDraftCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>
    /// Сохранение. Создание: publish=false — черновик (POST /drafts без файлов —
    /// роут JSON-only; с файлами — POST multipart status=draft); publish=true —
    /// POST status=published. Правка: PATCH только изменённых + upload новых
    /// файлов; publish-флаг в режиме правки не используется (переходы — publish/archive).
    /// </summary>
    public async Task<bool> SubmitAsync(bool publish, CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;
        var title = _title.Trim();
        var minTitle = IsCreateMode
            ? (publish ? 3 : 1)
            : _original?.Status is "published" or "scheduled" ? 3 : 1;
        if (title.Length < minTitle)
        {
            ErrorText = publish || !IsCreateMode
                ? "Заголовок — минимум 3 символа."
                : "Заголовок обязателен.";
            return false;
        }

        var newCategoryName = _newCategoryName.Trim();
        if (newCategoryName.Length == 1)
        {
            ErrorText = "Название новой категории — минимум 2 символа.";
            return false;
        }

        IsBusy = true;
        try
        {
            if (newCategoryName.Length >= 2 && CanCreateCategories)
            {
                var created = await _api.CreateAnnouncementCategoryAsync(newCategoryName, cancellationToken);
                _createdCategoryId = (created.Id ?? string.Empty).Trim();
                if (_createdCategoryId.Length == 0)
                {
                    _createdCategoryId = null;
                }
                else
                {
                    CategoryCreated?.Invoke(created);
                    NewCategoryName = string.Empty;
                }
            }

            var files = await LoadFilesAsync(cancellationToken);
            if (IsCreateMode)
            {
                var request = new HubAnnouncementCreateRequest
                {
                    Title = title,
                    Preview = NormalizeText(_preview),
                    Body = NormalizeText(_body),
                    Priority = _priority,
                    Status = publish ? "published" : "draft",
                    CategoryId = _createdCategoryId ?? _selectedCategory?.Id,
                    Tags = ParseTags(_tagsText),
                    RequiresAck = _requiresAck,
                    IsPinned = _isPinned,
                    CommentsEnabled = true,
                    ReactionsEnabled = true,
                    ClientRequestId = Guid.NewGuid().ToString("N"),
                };
                HubAnnouncementItem saved;
                if (!publish && files.Count == 0)
                {
                    saved = await _api.CreateAnnouncementDraftAsync(request, cancellationToken);
                }
                else
                {
                    saved = await _api.CreateAnnouncementAsync(request, files, cancellationToken);
                }

                Saved?.Invoke(saved);
                return true;
            }

            var (patch, hasChanges) = BuildUpdateRequest();
            if (!hasChanges && files.Count == 0)
            {
                StatusText = "Изменений нет.";
                return false;
            }

            var updated = hasChanges
                ? await _api.UpdateAnnouncementAsync(_original!.Id!, patch, cancellationToken)
                : _original;
            foreach (var file in files)
            {
                await _api.UploadAnnouncementAttachmentAsync(_original!.Id!, file, cancellationToken);
            }

            Saved?.Invoke(updated!);
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
    /// Diff с исходной записью → HubAnnouncementUpdateRequest (exclude_unset):
    /// только изменённые поля; снятие категории уходит как "", теги — массивом
    /// ([] — снять все). Статус здесь не правим — переходы отдельными роутами.
    /// </summary>
    internal (HubAnnouncementUpdateRequest Request, bool HasChanges) BuildUpdateRequest()
    {
        if (_original is null)
        {
            return (new HubAnnouncementUpdateRequest(), false);
        }

        var title = TextChanged(_title, _original.Title) ? NormalizeText(_title) : null;
        var preview = TextChanged(_preview, _original.Preview) ? NormalizeText(_preview) : null;
        var body = TextChanged(_body, _original.Body) ? NormalizeText(_body) : null;
        var priority = !string.Equals(
            _priority,
            NormalizePriority(_original.Priority),
            StringComparison.Ordinal)
            ? _priority
            : null;
        var originalCategoryId = _original.CategoryId ?? _original.Category?.Id ?? string.Empty;
        var effectiveCategoryId = _createdCategoryId ?? _selectedCategory?.Id ?? string.Empty;
        // "" — снять категорию: сервер нормализует пустую строку в NULL.
        var categoryId = !string.Equals(effectiveCategoryId, originalCategoryId, StringComparison.Ordinal)
            ? effectiveCategoryId
            : null;
        var originalTags = (_original.Tags ?? [])
            .Select(t => (t.Name ?? string.Empty).Trim())
            .Where(n => n.Length > 0)
            .OrderBy(n => n, StringComparer.OrdinalIgnoreCase)
            .ToList();
        var tags = ParseTags(_tagsText).OrderBy(n => n, StringComparer.OrdinalIgnoreCase).ToList();
        var tagsUpdate = tags.SequenceEqual(originalTags, StringComparer.OrdinalIgnoreCase)
            ? null
            : tags;
        bool? requiresAck = _requiresAck != _original.RequiresAck ? _requiresAck : null;
        bool? isPinned = _isPinned != _original.IsPinned ? _isPinned : null;
        var hasChanges = title is not null || preview is not null || body is not null
            || priority is not null || categoryId is not null || tagsUpdate is not null
            || requiresAck is not null || isPinned is not null;
        return (new HubAnnouncementUpdateRequest
        {
            Title = title,
            Preview = preview,
            Body = body,
            Priority = priority,
            CategoryId = categoryId,
            Tags = tagsUpdate,
            RequiresAck = requiresAck,
            IsPinned = isPinned,
        }, hasChanges);
    }

    /// <summary>Локальные файлы в outgoing-список; дубликаты/недоступные — с подсказкой.</summary>
    internal void AddFiles(IReadOnlyList<string> paths)
    {
        ErrorText = null;
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path)
                || Attachments.Any(a => string.Equals(a.Path, path, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var attachment = new MailComposeAttachmentViewModel(path);
            if (attachment.Size < 0)
            {
                ErrorText = $"Файл «{attachment.Name}» не найден или недоступен.";
                continue;
            }

            if (attachment.Size > MaxFileBytes)
            {
                ErrorText = $"Файл «{attachment.Name}» больше 20 МБ — сервер отклонит.";
                continue;
            }

            Attachments.Add(attachment);
            OnPropertyChanged(nameof(HasAttachments));
        }
    }

    /// <summary>Прочитать файлы перед отправкой; >20 МБ — ошибка до сети.</summary>
    private async Task<IReadOnlyList<HubAnnouncementOutgoingFile>> LoadFilesAsync(
        CancellationToken cancellationToken)
    {
        var files = new List<HubAnnouncementOutgoingFile>();
        foreach (var attachment in Attachments)
        {
            var bytes = await System.IO.File.ReadAllBytesAsync(attachment.Path, cancellationToken);
            if (bytes.Length > MaxFileBytes)
            {
                throw new InvalidOperationException(
                    $"Файл «{attachment.Name}» больше 20 МБ — сервер отклонит.");
            }

            files.Add(new HubAnnouncementOutgoingFile
            {
                FileName = attachment.Name,
                Content = bytes,
            });
        }

        return files;
    }

    private void AppendTag(string name)
    {
        var tags = ParseTags(_tagsText);
        if (tags.Any(tag => string.Equals(tag, name, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }

        var trimmed = _tagsText.TrimEnd(',', ';', ' ', '\n', '\r');
        TagsText = trimmed.Length == 0 ? name : trimmed + ", " + name;
    }

    /// <summary>Разбор «тег1, тег2;тег3» — дедуп без учёта регистра.</summary>
    internal static List<string> ParseTags(string? raw)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return result;
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in raw.Split(TagSeparators, StringSplitOptions.RemoveEmptyEntries))
        {
            var tag = part.Trim().TrimStart('#');
            if (tag.Length > 0 && seen.Add(tag))
            {
                result.Add(tag);
            }
        }

        return result;
    }

    private static string? NormalizeText(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }

    private static string NormalizePriority(string? priority) =>
        (priority ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "low" => "low",
            "high" => "high",
            _ => "normal",
        };

    private static bool TextChanged(string? current, string? original) =>
        !string.Equals(NormalizeText(current), NormalizeText(original), StringComparison.Ordinal);
}

/// <summary>Строка списка прочитавших в оверлее «Статистика» новости.</summary>
public sealed class AdminNewsReaderItem
{
    public AdminNewsReaderItem(HubAnnouncementReadItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var username = (item.Username ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(item.FullName)
            ? item.FullName!.Trim()
            : (username.Length > 0 ? "@" + username : "—");
        UsernameText = !string.IsNullOrWhiteSpace(item.FullName) && username.Length > 0
            ? "@" + username
            : string.Empty;
        StatusText = item.IsSeen ? "Прочитано" : "Не прочитано";
        StatusTone = item.IsSeen ? "success" : "muted";
        AckText = item.IsAcknowledged
            ? "✓ Подтверждено"
            : item.IsSeen ? "Ожидает подтверждения" : string.Empty;
    }

    public string Title { get; }
    public string UsernameText { get; }
    /// <summary>Пилюля «Прочитано/Не прочитано» — StatusTone для StatusPillTextStyle.</summary>
    public string StatusText { get; }
    public string StatusTone { get; }
    /// <summary>Строка подтверждения под ФИО (пусто — не было requires_ack-состояния).</summary>
    public string AckText { get; }
}

/// <summary>
/// Оверлей «Статистика» раздела «Новости» — GET {id}/analytics
/// (автор или модератор): сводка прочтений/подтверждений + список читателей.
/// </summary>
public sealed class AdminNewsStatsViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly string _announcementId;
    private bool _isLoading;
    private string? _errorText;
    private string _summaryText = string.Empty;
    private string _reactionsText = string.Empty;

    public AdminNewsStatsViewModel(IHubApiClient api, string announcementId, string title)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _announcementId = announcementId ?? string.Empty;
        TitleText = $"Статистика: {title}";
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsLoading);
    }

    internal Action? Closed;

    public string TitleText { get; }

    public ObservableCollection<AdminNewsReaderItem> Readers { get; } = [];

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

    public string SummaryText
    {
        get => _summaryText;
        private set => SetProperty(ref _summaryText, value);
    }

    public string ReactionsText
    {
        get => _reactionsText;
        private set => SetProperty(ref _reactionsText, value);
    }

    public bool IsEmpty => !IsLoading && !HasError && Readers.Count == 0;

    public ICommand CloseCommand { get; }

    /// <summary>Загрузка аналитики; ошибка — в ErrorText оверлея (fire-and-forget при открытии).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        ErrorText = null;
        try
        {
            var analytics = await _api.GetAnnouncementAnalyticsAsync(_announcementId, cancellationToken);
            var summary = analytics.Summary ?? new HubAnnouncementAnalyticsSummary();
            SummaryText =
                $"Прочитано: {summary.SeenTotal} из {summary.RecipientsTotal}"
                + $" · Подтвердили: {summary.AckTotal}"
                + $" · Ожидают подтверждения: {summary.PendingAckTotal}";
            var reactions = summary.ReactionCounts is { Count: > 0 } counts
                ? string.Join(" · ", counts.Select(pair => $"{pair.Key}: {pair.Value}"))
                : "реакций нет";
            ReactionsText = $"Реакции: {reactions} · Комментарии: {summary.CommentsTotal}"
                + (summary.PollTotalVoters > 0
                    ? $" · Опрос: {summary.PollTotalVoters} проголосовавших"
                    : string.Empty);
            Readers.Clear();
            foreach (var item in analytics.Items ?? [])
            {
                Readers.Add(new AdminNewsReaderItem(item));
            }

            OnPropertyChanged(nameof(IsEmpty));
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
}

/// <summary>
/// Страница «🛠 Админ» — нативный срез веб-админки (/admin):
/// левое меню секций как в вебе, списки с клиентским поиском, деталь отдела.
/// Пользователи — write-флоу: правка (PATCH только изменённых), создание,
/// сброс 2FA, активация/деактивация через чекбокс «Активен».
/// AI-боты — правка карточки (PATCH) и создание; отделы — назначение
/// начальников чекбоксами по составу (PUT managers, как DepartmentsTab).
/// Инструменты/доступ AI-ботов, импорт/синхронизация AD и индивидуальные
/// права — в вебе.
/// Видимость секций — по role/permissions из /auth/me (как getAvailableAdminSections);
/// 403 конкретного раздела — подсказка «Недостаточно прав» вместо баннера-краха.
/// </summary>
public sealed class AdminViewModel : ObservableObject
{
    /// <summary>Число предложений за одну загрузку (limit API — до 200).</summary>
    private const int FeedbackPageSize = 200;

    /// <summary>Число маршрутов в таблице метрик (limit API).</summary>
    private const int MetricsRoutesLimit = 50;

    /// <summary>Строк снапшота квот за одну загрузку (limit API — до 500).</summary>
    private const int MailQuotaRowsPageSize = 100;

    /// <summary>Снимков в селекторе «Квот почтовых ящиков» (limit API).</summary>
    private const int MailQuotaSnapshotsLimit = 20;

    /// <summary>Debounce серверного поиска по строкам квот — как у соседних экранов.</summary>
    private static readonly TimeSpan MailQuotaSearchDebounce = TimeSpan.FromMilliseconds(350);

    private static readonly (string Value, string Label)[] FeedbackStatusChips =
    [
        ("", "Все"),
        ("new", "Новое"),
        ("in_progress", "В работе"),
        ("accepted", "Принято"),
        ("declined", "Отклонено"),
        ("done", "Сделано"),
    ];

    /// <summary>
    /// Чипы фильтра строк квот → флаги rows-запроса (взаимоисключающие,
    /// как quickFilter веба: no_quota вытесняет over_quota/warning_90 на сервере).
    /// </summary>
    private static readonly (string Value, string Label)[] MailQuotaFilterChips =
    [
        ("", "Все"),
        ("warning_90", "≥ 90%"),
        ("over_quota", "Превышены"),
        ("no_quota", "Без квоты"),
    ];

    private static AdminMailQuotaDatabaseItem AllQuotaDatabases { get; } = new(null, "Все базы");

    /// <summary>Строк manage-выдачи за загрузку (limit API — до 300).</summary>
    private const int NewsPageSize = 300;

    /// <summary>
    /// Чипы статусов новостей — серверный фильтр (manage отдаёт один статус
    /// за запрос, regex draft|scheduled|published|archived; «Все» нет в контракте).
    /// </summary>
    private static readonly (string Value, string Label)[] NewsStatusChipsDef =
    [
        ("draft", "Черновики"),
        ("scheduled", "Запланированные"),
        ("published", "Опубликованные"),
        ("archived", "Архив"),
    ];

    private readonly IHubApiClient _api;

    /// <summary>Права/разделы вычислены по /auth/me и есть хотя бы один раздел.</summary>
    private bool _accessResolved;

    /// <summary>Текущий пользователь — admin: все разделы и все поля формы.</summary>
    private bool _isAdminRole;

    /// <summary>Право settings.users.manage — раздел «Пользователи» и правки.</summary>
    private bool _canManageUsers;

    /// <summary>Право settings.ai.manage — раздел «AI-боты» и правки (require_agent_manager).</summary>
    private bool _canManageAiBots;

    /// <summary>Право departments.manage — раздел «Отделы» и назначение начальников.</summary>
    private bool _canManageDepartments;

    /// <summary>Право announcements.write — «+ Новость» (create-роуты строже manage-гейта).</summary>
    private bool _canWriteAnnouncements;

    /// <summary>Право announcements.moderate — удаление и правка чужих новостей.</summary>
    private bool _canModerateAnnouncements;

    /// <summary>Id текущего пользователя — детект self-edit.</summary>
    private long _currentUserId;

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
    private List<AdminNewsItemViewModel> _allNews = [];

    /// <summary>Справочники редактора новостей — грузятся вместе с разделом.</summary>
    private List<HubAnnouncementCategory> _newsCategories = [];
    private List<HubAnnouncementTag> _newsTags = [];

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
    private AdminUserEditorViewModel? _userEditor;
    private AdminAiBotEditorViewModel? _aiBotEditor;
    private AdminDepartmentManagersViewModel? _departmentManagersEditor;
    private AdminNewsEditorViewModel? _newsEditor;
    private AdminNewsStatsViewModel? _newsStats;
    private string _selectedNewsStatus = "draft";
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private string _syncStatusText = string.Empty;
    private string _metricsSummaryText = string.Empty;
    private string _metricsUptimeText = string.Empty;

    // ---- Квоты почтовых ящиков: состояние раздела ----
    private CancellationTokenSource? _quotaSearchCancellation;
    private int _quotaRowsRequest;
    private int _quotaSnapshotId;
    private int _quotaRowsTotal;
    private bool _quotaHasMore;
    private bool _isQuotaLoadingMore;
    private string _selectedQuotaFilter = string.Empty;
    private bool _suppressQuotaEvents;
    private bool _hasQuotaSnapshot;
    private string _quotaSnapshotInfoText = string.Empty;
    private AdminMailQuotaSnapshotItem? _selectedQuotaSnapshot;
    private AdminMailQuotaDatabaseItem? _selectedQuotaDatabase;

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

        foreach (var (value, label) in MailQuotaFilterChips)
        {
            var chip = new AdminFilterChipItem(value, label);
            chip.CheckRequested = OnMailQuotaChipCheckRequested;
            MailQuotaChips.Add(chip);
        }

        MailQuotaChips[0].IsChecked = true;
        MailQuotaDatabaseOptions.Add(AllQuotaDatabases);
        _selectedQuotaDatabase = AllQuotaDatabases;

        foreach (var (value, label) in NewsStatusChipsDef)
        {
            var chip = new AdminFilterChipItem(value, label);
            chip.CheckRequested = OnNewsChipCheckRequested;
            NewsChips.Add(chip);
        }

        NewsChips[0].IsChecked = true;

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
        EditUserCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AdminUserItemViewModel { CanEdit: true } item)
            {
                OpenUserEditor(item);
            }
        });
        CreateUserCommand = new NativeRelayCommand(OpenUserCreator, () => CanCreateUsers);
        EditAiBotCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AdminAiBotItemViewModel { CanEdit: true } item)
            {
                OpenAiBotEditor(item);
            }
        });
        CreateAiBotCommand = new NativeRelayCommand(OpenAiBotCreator, () => CanManageAiBots);
        // Кнопка «Руководители…» видна только с departments.manage; условия
        // открытия (выбран отдел, состав загружен) проверяются внутри Open.
        EditDepartmentManagersCommand = new NativeRelayCommand(OpenDepartmentManagersEditor);
        CreateNewsCommand = new NativeRelayCommand(OpenNewsCreator, () => CanCreateNews);
        EditNewsCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AdminNewsItemViewModel { CanEdit: true } item)
            {
                OpenNewsEditor(item);
            }
        });
        PublishNewsCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is AdminNewsItemViewModel { CanPublish: true } item
                ? PublishNewsAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ArchiveNewsCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is AdminNewsItemViewModel { CanArchive: true } item
                ? ArchiveNewsAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DeleteNewsCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is AdminNewsItemViewModel { CanDelete: true } item
                ? DeleteNewsAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        NewsStatsCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AdminNewsItemViewModel { CanViewStats: true } item)
            {
                OpenNewsStats(item);
            }
        });
        LoadMoreMailQuotaRowsCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreMailQuotaRowsAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => QuotaHasMore && !IsLoading);
        Users.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        Departments.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        AdUsers.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        FeedbackItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        AiBots.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        Routes.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        News.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        MailQuotaRows.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(QuotaMoreButtonText));
        };
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
                OnPropertyChanged(nameof(IsNewsSection));
                OnPropertyChanged(nameof(IsSystemSection));
                OnPropertyChanged(nameof(IsMailQuotasSection));
                OnPropertyChanged(nameof(IsMailQuotaContentVisible));
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
    public bool IsNewsSection => SelectedSection?.Key == "news";
    public bool IsSystemSection => SelectedSection?.Key == "system";
    public bool IsMailQuotasSection => SelectedSection?.Key == "mail-quotas";

    /// <summary>Панель квот видна: активен раздел и выбран снимок (иначе — empty-state).</summary>
    public bool IsMailQuotaContentVisible => IsMailQuotasSection && HasQuotaSnapshot;

    public string SectionTitleText => SelectedSection?.Title ?? "Администрирование";

    /// <summary>
    /// Поиск по активному разделу — клиентский для локальных списков;
    /// в разделе «Почтовые квоты» тот же ввод — серверный search строк (debounce).
    /// </summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                ApplyFilter();
                if (IsMailQuotasSection)
                {
                    ScheduleMailQuotaSearch();
                }
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
        "news" => "Заголовок, автор, категория или тег…",
        "system" => "Метод или путь…",
        "mail-quotas" => "Email, ФИО или UPN…",
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
        "news" => News.Count,
        "system" => Routes.Count,
        "mail-quotas" => MailQuotaRows.Count,
        _ => 0,
    };

    public string EmptyText => SelectedSection?.Key switch
    {
        "users" => "Пользователей не найдено",
        "departments" => "Отделы не найдены",
        "ad-users" => "Пользователи AD не найдены",
        "ai-bots" => "AI-боты не настроены",
        "feedback" => "Предложений с таким статусом пока нет",
        "news" => "Новостей с таким статусом пока нет",
        "system" => "Метрики по маршрутам пока не собраны",
        "mail-quotas" => _hasQuotaSnapshot
            ? "Ящики по текущим фильтрам не найдены"
            : "Снимков квот пока нет — дождитесь импорта",
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

    // ---- Раздел «Новости» (AnnouncementsTab веб-админки) ----

    /// <summary>Строки manage-выдачи активного статуса — поиск режет локально.</summary>
    public ObservableCollection<AdminNewsItemViewModel> News { get; } = [];

    /// <summary>Чипы статуса — серверный фильтр (manage отдаёт один статус за запрос).</summary>
    public ObservableCollection<AdminFilterChipItem> NewsChips { get; } = [];

    /// <summary>Активный статус выдачи (draft|scheduled|published|archived).</summary>
    public string SelectedNewsStatus
    {
        get => _selectedNewsStatus;
        private set => SetProperty(ref _selectedNewsStatus, value);
    }

    /// <summary>«+ Новость» — POST /announcements и /drafts требуют строго write.</summary>
    public bool CanCreateNews => _canWriteAnnouncements;

    /// <summary>Открытый редактор новости (создание/правка); null — закрыт.</summary>
    public AdminNewsEditorViewModel? NewsEditor
    {
        get => _newsEditor;
        private set
        {
            if (SetProperty(ref _newsEditor, value))
            {
                OnPropertyChanged(nameof(IsNewsEditorOpen));
            }
        }
    }

    public bool IsNewsEditorOpen => NewsEditor is not null;

    /// <summary>Открытый оверлей статистики новости; null — закрыт.</summary>
    public AdminNewsStatsViewModel? NewsStats
    {
        get => _newsStats;
        private set
        {
            if (SetProperty(ref _newsStats, value))
            {
                OnPropertyChanged(nameof(IsNewsStatsOpen));
            }
        }
    }

    public bool IsNewsStatsOpen => NewsStats is not null;

    /// <summary>Шов выбора файлов «Прикрепить» редактора — view ставит OpenFileDialog.</summary>
    public Func<IReadOnlyList<string>>? NewsFilePicker { get; set; }

    /// <summary>«+ Новость» в шапке раздела.</summary>
    public ICommand CreateNewsCommand { get; }

    /// <summary>«Изменить» в строке (CommandParameter — AdminNewsItemViewModel).</summary>
    public ICommand EditNewsCommand { get; }

    /// <summary>«Опубликовать» в строке — POST {id}/publish.</summary>
    public ICommand PublishNewsCommand { get; }

    /// <summary>«В архив» в строке — POST {id}/archive.</summary>
    public ICommand ArchiveNewsCommand { get; }

    /// <summary>«Удалить»/«Удалить?» в строке — armed-удаление (moderate).</summary>
    public ICommand DeleteNewsCommand { get; }

    /// <summary>«Статистика» в строке — оверлей {id}/analytics.</summary>
    public ICommand NewsStatsCommand { get; }

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

    // ---- Раздел «Почтовые квоты» (MailQuotaReport веба) ----

    /// <summary>Строки выбранного снимка квот — серверная пагинация offset.</summary>
    public ObservableCollection<AdminMailQuotaRowItemViewModel> MailQuotaRows { get; } = [];

    /// <summary>Чипы фильтра строк: Все / ≥ 90% / Превышены / Без квоты (один выбор).</summary>
    public ObservableCollection<AdminFilterChipItem> MailQuotaChips { get; } = [];

    /// <summary>Пилюли сводки снимка (total/warning_90/over_quota/no_quota из {id}/summary).</summary>
    public ObservableCollection<AdminMailQuotaStatItem> MailQuotaStats { get; } = [];

    /// <summary>Снимки для селектора (GET .../mailbox-quota-snapshots?limit=20).</summary>
    public ObservableCollection<AdminMailQuotaSnapshotItem> MailQuotaSnapshots { get; } = [];

    /// <summary>Опции фильтра базы Exchange — из stats.by_database («Все базы» + имена).</summary>
    public ObservableCollection<AdminMailQuotaDatabaseItem> MailQuotaDatabaseOptions { get; } = [];

    /// <summary>Выбранный снимок есть: карточка сводки и таблица видны.</summary>
    public bool HasQuotaSnapshot
    {
        get => _hasQuotaSnapshot;
        private set
        {
            if (SetProperty(ref _hasQuotaSnapshot, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(EmptyText));
                OnPropertyChanged(nameof(IsMailQuotaContentVisible));
            }
        }
    }

    /// <summary>Строка «Снимок #id · дата · host · N ч назад» над пилюлями сводки.</summary>
    public string QuotaSnapshotInfoText
    {
        get => _quotaSnapshotInfoText;
        private set => SetProperty(ref _quotaSnapshotInfoText, value);
    }

    /// <summary>Выбранный снимок в селекторе: смена перечитывает сводку и строки.</summary>
    public AdminMailQuotaSnapshotItem? SelectedMailQuotaSnapshot
    {
        get => _selectedQuotaSnapshot;
        set
        {
            if (SetProperty(ref _selectedQuotaSnapshot, value)
                && !_suppressQuotaEvents
                && value is not null
                && value.Id != _quotaSnapshotId)
            {
                _ = ReloadMailQuotaSnapshotSafelyAsync(value);
            }
        }
    }

    /// <summary>Выбранная база Exchange: смена перечитывает строки с offset=0.</summary>
    public AdminMailQuotaDatabaseItem? SelectedMailQuotaDatabase
    {
        get => _selectedQuotaDatabase;
        set
        {
            if (SetProperty(ref _selectedQuotaDatabase, value))
            {
                OnPropertyChanged(nameof(HasQuotaFilters));
                ReloadMailQuotaRowsFromFilter();
            }
        }
    }

    /// <summary>Активный фильтр строк (""|warning_90|over_quota|no_quota).</summary>
    public string SelectedQuotaFilter
    {
        get => _selectedQuotaFilter;
        private set
        {
            if (SetProperty(ref _selectedQuotaFilter, value))
            {
                OnPropertyChanged(nameof(HasQuotaFilters));
            }
        }
    }

    /// <summary>Активен хотя бы один фильтр строк (чип ≠ «Все», база или поиск).</summary>
    public bool HasQuotaFilters =>
        _selectedQuotaFilter.Length > 0
        || SelectedMailQuotaDatabase?.Value is not null
        || _searchText.Trim().Length > 0;

    public bool IsQuotaLoadingMore
    {
        get => _isQuotaLoadingMore;
        private set
        {
            if (SetProperty(ref _isQuotaLoadingMore, value))
            {
                OnPropertyChanged(nameof(QuotaMoreButtonText));
            }
        }
    }

    /// <summary>На сервере остались строки за показанными (total &gt; загружено).</summary>
    public bool QuotaHasMore
    {
        get => _quotaHasMore;
        private set
        {
            if (SetProperty(ref _quotaHasMore, value))
            {
                OnPropertyChanged(nameof(QuotaMoreButtonText));
                ((NativeAsyncCommand)LoadMoreMailQuotaRowsCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Подпись «Показать ещё (N)» — остаток по total выдачи.</summary>
    public string QuotaMoreButtonText => IsQuotaLoadingMore
        ? "Загружаем…"
        : _quotaRowsTotal > MailQuotaRows.Count
            ? $"Показать ещё ({(_quotaRowsTotal - MailQuotaRows.Count).ToString(CultureInfo.CurrentCulture)})"
            : "Показать ещё";

    /// <summary>«Показать ещё» — догрузка следующей offset-страницы строк квот.</summary>
    public ICommand LoadMoreMailQuotaRowsCommand { get; }

    /// <summary>Шов ожидания (debounce поиска по строкам): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    public ICommand RefreshCommand { get; }
    public ICommand SelectSectionCommand { get; }
    public ICommand DismissBannerCommand { get; }

    // ---- Пользователи: write-флоу ----

    /// <summary>Текущий пользователь — admin (все поля формы + «Новый пользователь»).</summary>
    public bool IsAdminRole => _isAdminRole;

    /// <summary>«+ Новый пользователь» в шапке раздела — только admin (как в вебе).</summary>
    public bool CanCreateUsers => _isAdminRole && _canManageUsers;

    /// <summary>Открытый диалог правки/создания пользователя; null — закрыт.</summary>
    public AdminUserEditorViewModel? UserEditor
    {
        get => _userEditor;
        private set
        {
            if (SetProperty(ref _userEditor, value))
            {
                OnPropertyChanged(nameof(IsUserEditorOpen));
            }
        }
    }

    public bool IsUserEditorOpen => UserEditor is not null;

    /// <summary>«Изменить» в строке пользователя (CommandParameter — AdminUserItemViewModel).</summary>
    public ICommand EditUserCommand { get; }

    /// <summary>«+ Новый пользователь» — та же форма в режиме создания.</summary>
    public ICommand CreateUserCommand { get; }

    private void OpenUserEditor(AdminUserItemViewModel item)
    {
        if (UserEditor is not null)
        {
            return;
        }

        var editor = new AdminUserEditorViewModel(_api, item.Source, _isAdminRole, _currentUserId);
        editor.Saved = OnUserEditorSaved;
        editor.Closed = OnUserEditorClosed;
        UserEditor = editor;
    }

    private void OpenUserCreator()
    {
        if (UserEditor is not null || !CanCreateUsers)
        {
            return;
        }

        var editor = new AdminUserEditorViewModel(_api, isAdminRole: true);
        editor.Saved = OnUserEditorSaved;
        editor.Closed = OnUserEditorClosed;
        UserEditor = editor;
    }

    /// <summary>Ответ User из PATCH/POST → заменяем/добавляем строку списка, диалог закрываем.</summary>
    private void OnUserEditorSaved(HubAdminUser updated)
    {
        UserEditor = null;
        var item = new AdminUserItemViewModel(updated, ComputeCanEdit(updated));
        var index = _allUsers.FindIndex(user => user.Id == updated.Id);
        if (index >= 0)
        {
            _allUsers[index] = item;
        }
        else
        {
            _allUsers.Add(item);
        }

        ApplyFilter();
        TotalText = FormatCount(_allUsers.Count, "пользователь", "пользователя", "пользователей");
    }

    private void OnUserEditorClosed() => UserEditor = null;

    /// <summary>
    /// Право на правку строки: users.manage + (не-admin — только не-admin цели,
    /// сервер отклонил бы 403 «Admin role required to update admin user»).
    /// </summary>
    private bool ComputeCanEdit(HubAdminUser user) =>
        _canManageUsers
        && (_isAdminRole
            || !string.Equals(user.Role?.Trim(), "admin", StringComparison.OrdinalIgnoreCase));

    // ---- AI-боты: write-флоу ----

    /// <summary>Раздел «AI-боты» виден → правки разрешены (admin или settings.ai.manage).</summary>
    public bool CanManageAiBots => _canManageAiBots;

    /// <summary>Открытый диалог правки/создания AI-бота; null — закрыт.</summary>
    public AdminAiBotEditorViewModel? AiBotEditor
    {
        get => _aiBotEditor;
        private set
        {
            if (SetProperty(ref _aiBotEditor, value))
            {
                OnPropertyChanged(nameof(IsAiBotEditorOpen));
            }
        }
    }

    public bool IsAiBotEditorOpen => AiBotEditor is not null;

    /// <summary>«Изменить» в строке бота (CommandParameter — AdminAiBotItemViewModel).</summary>
    public ICommand EditAiBotCommand { get; }

    /// <summary>«+ Новый бот» в шапке раздела AI-ботов.</summary>
    public ICommand CreateAiBotCommand { get; }

    private bool HasOpenDialog =>
        UserEditor is not null || AiBotEditor is not null || DepartmentManagersEditor is not null
        || NewsEditor is not null || NewsStats is not null;

    private void OpenAiBotEditor(AdminAiBotItemViewModel item)
    {
        if (HasOpenDialog)
        {
            return;
        }

        var editor = new AdminAiBotEditorViewModel(_api, item.Source)
        {
            Saved = OnAiBotEditorSaved,
            Closed = OnAiBotEditorClosed,
        };
        AiBotEditor = editor;
    }

    private void OpenAiBotCreator()
    {
        if (HasOpenDialog || !CanManageAiBots)
        {
            return;
        }

        var editor = new AdminAiBotEditorViewModel(_api)
        {
            Saved = OnAiBotEditorSaved,
            Closed = OnAiBotEditorClosed,
        };
        AiBotEditor = editor;
    }

    /// <summary>Ответ бота из PATCH/POST → заменяем/добавляем строку списка.</summary>
    private void OnAiBotEditorSaved(HubAdminAiBot bot)
    {
        AiBotEditor = null;
        var item = new AdminAiBotItemViewModel(bot, _canManageAiBots);
        var index = _allAiBots.FindIndex(existing =>
            string.Equals(existing.Source.Id?.Trim(), bot.Id?.Trim(), StringComparison.Ordinal));
        if (index >= 0)
        {
            _allAiBots[index] = item;
        }
        else
        {
            _allAiBots.Add(item);
        }

        ApplyFilter();
        TotalText = FormatCount(_allAiBots.Count, "AI-бот", "AI-бота", "AI-ботов");
    }

    private void OnAiBotEditorClosed() => AiBotEditor = null;

    // ---- Отделы: назначение начальников ----

    /// <summary>Раздел «Отделы» виден → назначение начальников разрешено (departments.manage).</summary>
    public bool CanManageDepartments => _canManageDepartments;

    /// <summary>Открытый диалог «Руководители отдела»; null — закрыт.</summary>
    public AdminDepartmentManagersViewModel? DepartmentManagersEditor
    {
        get => _departmentManagersEditor;
        private set
        {
            if (SetProperty(ref _departmentManagersEditor, value))
            {
                OnPropertyChanged(nameof(IsDepartmentManagersEditorOpen));
            }
        }
    }

    public bool IsDepartmentManagersEditorOpen => DepartmentManagersEditor is not null;

    /// <summary>«Руководители…» в шапке детали отдела.</summary>
    public ICommand EditDepartmentManagersCommand { get; }

    /// <summary>
    /// Открытие только при загруженном составе: иначе пустой диалог при
    /// сохранении затёр бы руководителей, которых клиент не успел показать.
    /// </summary>
    private void OpenDepartmentManagersEditor()
    {
        if (HasOpenDialog
            || !CanManageDepartments
            || SelectedDepartment is not { } department
            || IsDepartmentDetailLoading
            || HasDepartmentDetailError)
        {
            return;
        }

        var editor = new AdminDepartmentManagersViewModel(
            _api, department.Id, department.Title, DepartmentMembers.ToList())
        {
            Saved = OnDepartmentManagersSaved,
            Closed = OnDepartmentManagersClosed,
        };
        DepartmentManagersEditor = editor;
    }

    /// <summary>Ответ PUT managers (items memberships) → состав + счётчик «нач.» у строки.</summary>
    private void OnDepartmentManagersSaved(IReadOnlyList<HubAdminDepartmentMember> items)
    {
        DepartmentManagersEditor = null;
        DepartmentMembers.Clear();
        foreach (var member in GroupMembers(items))
        {
            DepartmentMembers.Add(member);
        }

        var managersCount = (items ?? []).Count(item =>
            item.IsActive
            && string.Equals(item.Role?.Trim(), "manager", StringComparison.OrdinalIgnoreCase));
        SelectedDepartment?.ApplyManagersCount(managersCount);
    }

    private void OnDepartmentManagersClosed() => DepartmentManagersEditor = null;

    // ---- Новости: write-флоу ----

    private void OpenNewsEditor(AdminNewsItemViewModel item)
    {
        if (HasOpenDialog)
        {
            return;
        }

        var editor = new AdminNewsEditorViewModel(
            _api, item.Source, _newsCategories, _newsTags, _canModerateAnnouncements, NewsFilePicker)
        {
            Saved = OnNewsEditorSaved,
            Closed = OnNewsEditorClosed,
            CategoryCreated = OnNewsCategoryCreated,
        };
        NewsEditor = editor;
    }

    private void OpenNewsCreator()
    {
        if (HasOpenDialog || !CanCreateNews)
        {
            return;
        }

        var editor = new AdminNewsEditorViewModel(
            _api, _newsCategories, _newsTags, _canModerateAnnouncements, NewsFilePicker)
        {
            Saved = OnNewsEditorSaved,
            Closed = OnNewsEditorClosed,
            CategoryCreated = OnNewsCategoryCreated,
        };
        NewsEditor = editor;
    }

    /// <summary>
    /// Ответ create/PATCH → upsert строки. Статусная фильтрация серверная:
    /// элемент с чужим статусом из текущего списка уходит (и наоборот).
    /// </summary>
    private void OnNewsEditorSaved(HubAnnouncementItem saved)
    {
        NewsEditor = null;
        var item = new AdminNewsItemViewModel(saved, _canModerateAnnouncements);
        var index = _allNews.FindIndex(existing => existing.Id == item.Id);
        if (string.Equals(item.Status, _selectedNewsStatus, StringComparison.OrdinalIgnoreCase))
        {
            if (index >= 0)
            {
                _allNews[index] = item;
            }
            else
            {
                _allNews.Add(item);
            }
        }
        else if (index >= 0)
        {
            _allNews.RemoveAt(index);
        }

        ApplyFilter();
        TotalText = FormatCount(_allNews.Count, "новость", "новости", "новостей");
    }

    private void OnNewsEditorClosed() => NewsEditor = null;

    /// <summary>Свежая категория из редактора — в справочник следующих открытий.</summary>
    private void OnNewsCategoryCreated(HubAnnouncementCategory category) =>
        _newsCategories.Add(category);

    /// <summary>POST {id}/publish → статус сменился → перечитать выдачу (строка уйдёт под другой чип).</summary>
    private async Task PublishNewsAsync(AdminNewsItemViewModel item, CancellationToken cancellationToken)
    {
        await _api.PublishAnnouncementAsync(item.Id, cancellationToken);
        await LoadNewsItemsAsync(cancellationToken);
    }

    /// <summary>POST {id}/archive → перечитать выдачу.</summary>
    private async Task ArchiveNewsAsync(AdminNewsItemViewModel item, CancellationToken cancellationToken)
    {
        await _api.ArchiveAnnouncementAsync(item.Id, cancellationToken);
        await LoadNewsItemsAsync(cancellationToken);
    }

    /// <summary>DELETE {id} — второе нажатие armed-кнопки; первое только взводит.</summary>
    private async Task DeleteNewsAsync(AdminNewsItemViewModel item, CancellationToken cancellationToken)
    {
        if (!item.ArmDelete())
        {
            return;
        }

        await _api.DeleteManagedAnnouncementAsync(item.Id, cancellationToken);
        await LoadNewsItemsAsync(cancellationToken);
    }

    private void OpenNewsStats(AdminNewsItemViewModel item)
    {
        if (HasOpenDialog)
        {
            return;
        }

        var stats = new AdminNewsStatsViewModel(_api, item.Id, item.Title)
        {
            Closed = () => NewsStats = null,
        };
        NewsStats = stats;
        // Как деталь отдела: загрузка фоном, ошибка — в ErrorText оверлея.
        _ = stats.LoadAsync();
    }

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
                    case "news":
                        await LoadNewsAsync(cancellationToken);
                        break;
                    case "system":
                        await LoadSystemMetricsAsync(cancellationToken);
                        break;
                    case "mail-quotas":
                        await LoadMailQuotasAsync(cancellationToken);
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
        _isAdminRole = string.Equals(user?.Role?.Trim(), "admin", StringComparison.OrdinalIgnoreCase);
        _currentUserId = user?.Id ?? 0;
        var sections = BuildSections(user);
        _canManageUsers = sections.Any(section => section.Key == "users");
        _canManageAiBots = sections.Any(section => section.Key == "ai-bots");
        _canManageDepartments = sections.Any(section => section.Key == "departments");
        // Раздел «Новости» виден при write|moderate; create — строго write,
        // delete — строго moderate (fail-closed, как роуты hub.py).
        var permissions = new HashSet<string>(user?.Permissions ?? [], StringComparer.Ordinal);
        _canWriteAnnouncements = _isAdminRole || permissions.Contains("announcements.write");
        _canModerateAnnouncements = _isAdminRole || permissions.Contains("announcements.moderate");
        OnPropertyChanged(nameof(IsAdminRole));
        OnPropertyChanged(nameof(CanCreateUsers));
        OnPropertyChanged(nameof(CanManageAiBots));
        OnPropertyChanged(nameof(CanManageDepartments));
        OnPropertyChanged(nameof(CanCreateNews));
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

        // _require_announcement_manager роутов hub.py: write ИЛИ moderate.
        if (Has("announcements.write") || Has("announcements.moderate"))
        {
            items.Add(new AdminSectionItem("news", "Новости", "📰", "Публикации и черновики"));
        }

        // PERM_MAIL_QUOTAS_READ: admin — автоматически (ensure_user_permission),
        // иначе явное право; fail-closed — без него раздела нет в меню.
        if (Has("mail.quotas.read"))
        {
            items.Add(new AdminSectionItem("mail-quotas", "Почтовые квоты", "📮", "Снимки заполнения ящиков Exchange"));
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

    /// <summary>Чипы квот — один активный (как quickFilter веба): смена → перечитать строки.</summary>
    private void OnMailQuotaChipCheckRequested(AdminFilterChipItem item)
    {
        if (_suppressChipCheck)
        {
            return;
        }

        _suppressChipCheck = true;
        try
        {
            foreach (var chip in MailQuotaChips)
            {
                chip.IsChecked = ReferenceEquals(chip, item);
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        SelectedQuotaFilter = item.Value;
        ReloadMailQuotaRowsFromFilter();
    }

    /// <summary>Чипы статусов новостей — серверный фильтр: смена перечитывает выдачу.</summary>
    private void OnNewsChipCheckRequested(AdminFilterChipItem item)
    {
        if (_suppressChipCheck)
        {
            return;
        }

        _suppressChipCheck = true;
        try
        {
            foreach (var chip in NewsChips)
            {
                chip.IsChecked = ReferenceEquals(chip, item);
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        _selectedNewsStatus = item.Value;
        OnPropertyChanged(nameof(SelectedNewsStatus));
        _ = ReloadNewsSafelyAsync();
    }

    /// <summary>
    /// Перечитать manage-выдачу по текущему статусу (чип/мутация строки).
    /// Ошибка — в баннер, без краха секции; 403 тоже баннер (право могли отозвать).
    /// </summary>
    private async Task ReloadNewsSafelyAsync()
    {
        // Начальный IsChecked в конструкторе и скрытые чипы не дёргают сеть.
        if (!_accessResolved || !IsNewsSection)
        {
            return;
        }

        var request = Interlocked.Increment(ref _loadRequest);
        IsLoading = true;
        try
        {
            await LoadNewsItemsAsync(CancellationToken.None);
            if (request != _loadRequest)
            {
                return;
            }

            BannerErrorText = null;
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    // ---- Загрузка разделов ----

    private async Task LoadUsersAsync(CancellationToken cancellationToken)
    {
        var users = await _api.GetAdminUsersAsync(cancellationToken);
        _allUsers = (users ?? [])
            .Select(u => new AdminUserItemViewModel(u, ComputeCanEdit(u)))
            .ToList();
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
        _allAiBots = (bots ?? []).Select(b => new AdminAiBotItemViewModel(b, _canManageAiBots)).ToList();
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

    /// <summary>
    /// Раздел «Новости»: manage-выдача по активному статусу + справочники
    /// редактора (категории/теги — announcements.read, ошибка некритична).
    /// </summary>
    private async Task LoadNewsAsync(CancellationToken cancellationToken)
    {
        await LoadNewsItemsAsync(cancellationToken);
        try
        {
            var categories = await _api.GetAnnouncementCategoriesAsync(
                includeInactive: false, cancellationToken);
            _newsCategories = (categories.Items ?? []).ToList();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _newsCategories = [];
        }

        try
        {
            var tags = await _api.GetAnnouncementTagsAsync(cancellationToken);
            _newsTags = (tags.Items ?? []).ToList();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            _newsTags = [];
        }
    }

    /// <summary>GET /announcements/manage?status= — список активного статуса.</summary>
    private async Task LoadNewsItemsAsync(CancellationToken cancellationToken)
    {
        var page = await _api.GetManagedAnnouncementsAsync(
            new HubAnnouncementManageQuery
            {
                Status = _selectedNewsStatus,
                Limit = NewsPageSize,
                Offset = 0,
            },
            cancellationToken);
        _allNews = (page.Items ?? [])
            .Select(item => new AdminNewsItemViewModel(item, _canModerateAnnouncements))
            .ToList();
        ApplyFilter();
        TotalText = FormatCount(page.Total, "новость", "новости", "новостей");
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

    /// <summary>
    /// Загрузка раздела «Почтовые квоты» (loadData веба): latest-снимок →
    /// сводка {id}/summary → первая страница rows по текущим фильтрам.
    /// 404 latest — не ошибка: снимков ещё не было, показываем селектор списка
    /// (пустой — «Снимков квот пока нет»). 403 всплывает в SectionDeniedText.
    /// </summary>
    private async Task LoadMailQuotasAsync(CancellationToken cancellationToken)
    {
        // Отменяет висящий debounce-поиск и инвалидирует летящие rows-ответы.
        Interlocked.Increment(ref _quotaRowsRequest);
        try
        {
            _quotaSearchCancellation?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        HubMailQuotaSnapshot? snapshot;
        try
        {
            snapshot = await _api.GetLatestMailQuotaSnapshotAsync(cancellationToken);
        }
        catch (HubApiException exception) when (exception.StatusCode == HttpStatusCode.NotFound)
        {
            snapshot = null;
        }

        // Список — источник селектора и запасной путь при 404 latest.
        var snapshots = await _api.GetMailQuotaSnapshotsAsync(MailQuotaSnapshotsLimit, cancellationToken);
        snapshot ??= (snapshots ?? []).FirstOrDefault();

        var previousSnapshotId = _quotaSnapshotId;
        ApplyMailQuotaSnapshots(snapshots ?? [], snapshot, previousSnapshotId);
        if (snapshot is null)
        {
            _quotaSnapshotId = 0;
            HasQuotaSnapshot = false;
            QuotaSnapshotInfoText = string.Empty;
            MailQuotaStats.Clear();
            ApplyMailQuotaDatabaseOptions(null);
            MailQuotaRows.Clear();
            _quotaRowsTotal = 0;
            QuotaHasMore = false;
            TotalText = "Снимков квот нет";
            return;
        }

        _quotaSnapshotId = snapshot.Id;
        HasQuotaSnapshot = true;
        QuotaSnapshotInfoText = FormatQuotaSnapshotInfo(snapshot);

        var stats = await _api.GetMailQuotaSnapshotSummaryAsync(snapshot.Id, cancellationToken);
        ApplyMailQuotaStats(stats, snapshot.RowCount);
        ApplyMailQuotaDatabaseOptions(stats);
        await LoadMailQuotaRowsPageAsync(offset: 0, replace: true, cancellationToken);
    }

    /// <summary>
    /// Селектор снимков из list-ответа; если latest не совпал со списком
    /// (или вернул 404) — ведущий элемент добавляется отдельно. Выбор снимка
    /// сохраняется по id при повторных загрузках (как selectedSnapshotId веба).
    /// </summary>
    private void ApplyMailQuotaSnapshots(
        IReadOnlyList<HubMailQuotaSnapshot> snapshots,
        HubMailQuotaSnapshot? current,
        int previousSnapshotId)
    {
        MailQuotaSnapshots.Clear();
        var items = new List<AdminMailQuotaSnapshotItem>();
        foreach (var item in snapshots)
        {
            if (item.Id > 0 && items.All(existing => existing.Id != item.Id))
            {
                items.Add(new AdminMailQuotaSnapshotItem(item));
            }
        }

        if (current is not null && items.All(item => item.Id != current.Id))
        {
            items.Insert(0, new AdminMailQuotaSnapshotItem(current));
        }

        foreach (var item in items)
        {
            MailQuotaSnapshots.Add(item);
        }

        // Текущий снимок — из ответа; устаревший выбор сохраняем, если он в списке.
        var selected = current is null
            ? items.FirstOrDefault(item => item.Id == previousSnapshotId)
            : items.FirstOrDefault(item => item.Id == current.Id) ?? items.FirstOrDefault();
        _suppressQuotaEvents = true;
        try
        {
            SelectedMailQuotaSnapshot = selected;
        }
        finally
        {
            _suppressQuotaEvents = false;
        }
    }

    /// <summary>Пилюли сводки из {id}/summary; total подстрахован row_count снимка.</summary>
    private void ApplyMailQuotaStats(HubMailQuotaSnapshotStats? stats, int snapshotRowCount)
    {
        MailQuotaStats.Clear();
        MailQuotaStats.Add(new AdminMailQuotaStatItem("Всего", stats?.Total ?? snapshotRowCount, "muted"));
        MailQuotaStats.Add(new AdminMailQuotaStatItem("≥ 90%", stats?.Warning90 ?? 0, "warning"));
        MailQuotaStats.Add(new AdminMailQuotaStatItem("Превышены", stats?.OverQuota ?? 0, "error"));
        MailQuotaStats.Add(new AdminMailQuotaStatItem("Без квоты", stats?.NoQuota ?? 0, "info"));
    }

    /// <summary>Опции «Все базы» + имена из stats.by_database с счётчиками, как в вебе.</summary>
    private void ApplyMailQuotaDatabaseOptions(HubMailQuotaSnapshotStats? stats)
    {
        var previousValue = SelectedMailQuotaDatabase?.Value;
        _suppressQuotaEvents = true;
        try
        {
            MailQuotaDatabaseOptions.Clear();
            MailQuotaDatabaseOptions.Add(AllQuotaDatabases);
            foreach (var database in stats?.ByDatabase ?? [])
            {
                var name = (database.Name ?? string.Empty).Trim();
                if (name.Length > 0 && name != "—")
                {
                    MailQuotaDatabaseOptions.Add(new AdminMailQuotaDatabaseItem(
                        name, $"{name} ({database.Total.ToString(CultureInfo.CurrentCulture)})"));
                }
            }

            SelectedMailQuotaDatabase = previousValue is null
                ? AllQuotaDatabases
                : MailQuotaDatabaseOptions.FirstOrDefault(option => option.Value == previousValue)
                    ?? AllQuotaDatabases;
        }
        finally
        {
            _suppressQuotaEvents = false;
        }
    }

    /// <summary>Снимок #id · собран/imported · host · «N ч назад» — строка из веб-шапки отчёта.</summary>
    private static string FormatQuotaSnapshotInfo(HubMailQuotaSnapshot snapshot)
    {
        var at = snapshot.CollectedAt ?? snapshot.ImportedAt;
        var parts = new List<string>
        {
            $"Снимок #{snapshot.Id.ToString(CultureInfo.InvariantCulture)}",
            MfuFormat.FormatDateTime(at),
        };
        if (!string.IsNullOrWhiteSpace(snapshot.SourceHost))
        {
            parts.Add(snapshot.SourceHost.Trim());
        }
        else if (!string.IsNullOrWhiteSpace(snapshot.ExchangeServer))
        {
            parts.Add(snapshot.ExchangeServer.Trim());
        }

        if (DateTimeOffset.TryParse(at, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            var hours = Math.Max(0, (int)Math.Round((DateTimeOffset.Now - parsed).TotalHours));
            parts.Add($"{hours.ToString(CultureInfo.InvariantCulture)} ч назад");
        }

        return string.Join(" · ", parts);
    }

    /// <summary>Query rows из текущего поиска/чипа/базы — как listRows в вебе.</summary>
    private HubMailQuotaRowsQuery BuildMailQuotaRowsQuery(int offset) => new()
    {
        Search = _searchText.Trim(),
        Warning90 = _selectedQuotaFilter == "warning_90",
        OverQuota = _selectedQuotaFilter == "over_quota",
        NoQuota = _selectedQuotaFilter == "no_quota",
        DatabaseName = SelectedMailQuotaDatabase?.Value,
        Limit = MailQuotaRowsPageSize,
        Offset = offset,
    };

    /// <summary>
    /// Страница строк: replace=true — заново с offset=0; ответ применяется,
    /// только если это последний запрос (_quotaRowsRequest — защита от гонок
    /// поиск/чип/снимок). total выдачи управляет «Показать ещё».
    /// </summary>
    private async Task LoadMailQuotaRowsPageAsync(int offset, bool replace, CancellationToken cancellationToken)
    {
        var request = _quotaRowsRequest;
        var page = await _api.GetMailQuotaRowsAsync(
            _quotaSnapshotId, BuildMailQuotaRowsQuery(offset), cancellationToken);
        if (request != _quotaRowsRequest)
        {
            return;
        }

        if (replace)
        {
            MailQuotaRows.Clear();
        }

        _quotaRowsTotal = page.Total;
        foreach (var row in page.Items ?? [])
        {
            MailQuotaRows.Add(new AdminMailQuotaRowItemViewModel(row));
        }

        QuotaHasMore = MailQuotaRows.Count < _quotaRowsTotal;
        TotalText = MailQuotaRows.Count < _quotaRowsTotal
            ? $"Показано {MailQuotaRows.Count.ToString(CultureInfo.CurrentCulture)} из {_quotaRowsTotal.ToString(CultureInfo.CurrentCulture)}"
            : FormatCount(_quotaRowsTotal, "ящик", "ящика", "ящиков");
    }

    /// <summary>«Показать ещё»: следующая offset-страница в конец списка.</summary>
    private async Task LoadMoreMailQuotaRowsAsync(CancellationToken cancellationToken)
    {
        if (!HasQuotaSnapshot)
        {
            return;
        }

        IsQuotaLoadingMore = true;
        try
        {
            await LoadMailQuotaRowsPageAsync(MailQuotaRows.Count, replace: false, cancellationToken);
            BannerErrorText = null;
        }
        finally
        {
            IsQuotaLoadingMore = false;
        }
    }

    /// <summary>Смена чипа/базы: перечитать строки с первой страницы (без повторной сводки).</summary>
    private void ReloadMailQuotaRowsFromFilter()
    {
        if (_suppressQuotaEvents || !IsMailQuotasSection || !HasQuotaSnapshot)
        {
            return;
        }

        _ = ReloadMailQuotaRowsSafelyAsync();
    }

    private async Task ReloadMailQuotaRowsSafelyAsync()
    {
        Interlocked.Increment(ref _quotaRowsRequest);
        IsLoading = true;
        try
        {
            await LoadMailQuotaRowsPageAsync(offset: 0, replace: true, CancellationToken.None);
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Смена снимка в селекторе: сводка + строки нового снимка.</summary>
    private async Task ReloadMailQuotaSnapshotSafelyAsync(AdminMailQuotaSnapshotItem item)
    {
        Interlocked.Increment(ref _quotaRowsRequest);
        _quotaSnapshotId = item.Id;
        QuotaSnapshotInfoText = FormatQuotaSnapshotInfo(item.Snapshot);
        IsLoading = true;
        try
        {
            var request = _quotaRowsRequest;
            var stats = await _api.GetMailQuotaSnapshotSummaryAsync(item.Id, CancellationToken.None);
            if (request == _quotaRowsRequest)
            {
                ApplyMailQuotaStats(stats, item.Snapshot.RowCount);
                ApplyMailQuotaDatabaseOptions(stats);
            }

            await LoadMailQuotaRowsPageAsync(offset: 0, replace: true, CancellationToken.None);
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Debounce серверного поиска строк квот — как ScheduleSearch адресной книги.</summary>
    private void ScheduleMailQuotaSearch()
    {
        try
        {
            _quotaSearchCancellation?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        _quotaSearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _quotaSearchCancellation = cancellation;
        var query = _searchText.Trim();
        _ = SearchMailQuotaSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchMailQuotaSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(MailQuotaSearchDebounce, cancellationToken);
            // Запрос сменился или раздел уже другой — ответ устарел.
            if (!IsMailQuotasSection || !HasQuotaSnapshot
                || !string.Equals(_searchText.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            Interlocked.Increment(ref _quotaRowsRequest);
            IsLoading = true;
            try
            {
                await LoadMailQuotaRowsPageAsync(offset: 0, replace: true, cancellationToken);
                BannerErrorText = null;
            }
            finally
            {
                IsLoading = false;
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
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
        ApplyTo(News, _allNews, item => item.SearchIndex.Contains(query, StringComparison.Ordinal));
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
        _allNews = [];
        _newsCategories = [];
        _newsTags = [];
        Users.Clear();
        Departments.Clear();
        AdUsers.Clear();
        FeedbackItems.Clear();
        AiBots.Clear();
        Routes.Clear();
        News.Clear();
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
        UserEditor = null;
        AiBotEditor = null;
        DepartmentManagersEditor = null;
        NewsEditor = null;
        NewsStats = null;
        _isAdminRole = false;
        _canManageUsers = false;
        _canManageAiBots = false;
        _canManageDepartments = false;
        _canWriteAnnouncements = false;
        _canModerateAnnouncements = false;
        _currentUserId = 0;
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
        _suppressChipCheck = true;
        try
        {
            for (var index = 0; index < NewsChips.Count; index++)
            {
                NewsChips[index].IsChecked = index == 0;
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        _selectedNewsStatus = "draft";
        OnPropertyChanged(nameof(SelectedNewsStatus));
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));

        // Раздел квот: отмена debounce-поиска, сброс снимка/фильтров/пагинации.
        Interlocked.Increment(ref _quotaRowsRequest);
        try
        {
            _quotaSearchCancellation?.Cancel();
        }
        catch (ObjectDisposedException)
        {
        }

        _quotaSearchCancellation?.Dispose();
        _quotaSearchCancellation = null;
        _quotaSnapshotId = 0;
        _quotaRowsTotal = 0;
        _selectedQuotaFilter = string.Empty;
        OnPropertyChanged(nameof(SelectedQuotaFilter));
        _suppressChipCheck = true;
        try
        {
            for (var index = 0; index < MailQuotaChips.Count; index++)
            {
                MailQuotaChips[index].IsChecked = index == 0;
            }
        }
        finally
        {
            _suppressChipCheck = false;
        }

        _suppressQuotaEvents = true;
        try
        {

            MailQuotaRows.Clear();
            MailQuotaStats.Clear();
            MailQuotaSnapshots.Clear();
            MailQuotaDatabaseOptions.Clear();
            MailQuotaDatabaseOptions.Add(AllQuotaDatabases);
            SelectedMailQuotaSnapshot = null;
            SelectedMailQuotaDatabase = AllQuotaDatabases;
        }
        finally
        {
            _suppressQuotaEvents = false;
        }

        HasQuotaSnapshot = false;
        QuotaSnapshotInfoText = string.Empty;
        QuotaHasMore = false;
        IsQuotaLoadingMore = false;
        OnPropertyChanged(nameof(HasQuotaFilters));
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
