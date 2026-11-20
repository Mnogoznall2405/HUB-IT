using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Каталоги админки билетов: типы финопераций (FIN_OP_TYPES веба,
/// VALID_FIN_OP_TYPES backend'а) и типы правил SLA (сид-миграция
/// tickets_notification_rules). Подписи неизвестных значений — как пришли.
/// </summary>
internal static class TicketAdminCatalog
{
    /// <summary>Маскированное значение персональных полей — MASKED_PERSONAL_VALUE веба.</summary>
    internal const string MaskedPersonalValue = "** **** ******";

    public static readonly IReadOnlyList<TicketStatusOption> FinOpTypes =
    [
        new TicketStatusOption("loss", "Потеря"),
        new TicketStatusOption("refund", "Возврат"),
        new TicketStatusOption("exchange", "Обмен"),
    ];

    /// <summary>Фильтр типа: «Все типы» + рабочие значения.</summary>
    public static readonly IReadOnlyList<TicketStatusOption> FinOpFilterOptions =
        new[] { new TicketStatusOption(null, "Все типы") }.Concat(FinOpTypes).ToArray();

    private static readonly IReadOnlyDictionary<string, string> FinOpLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["loss"] = "Потеря",
            ["refund"] = "Возврат",
            ["exchange"] = "Обмен",
        };

    private static readonly IReadOnlyDictionary<string, string> RuleLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["departure_soon"] = "Скорый выезд",
            ["missing_data_stale"] = "Незаполненная заявка",
            ["stuck_request"] = "Застрявшая заявка",
            ["new_loss"] = "Новая потеря",
        };

    /// <summary>Стратегии дубликатов импорта (duplicate_strategy backend'а).</summary>
    public static readonly IReadOnlyList<TicketStatusOption> DuplicateStrategies =
    [
        new TicketStatusOption("skip", "Пропускать"),
        new TicketStatusOption("update", "Обновлять"),
        new TicketStatusOption("create", "Создавать"),
    ];

    public static string FinOpLabelOf(string? opType) =>
        opType is not null && FinOpLabels.TryGetValue(opType, out var label)
            ? label
            : (opType ?? string.Empty).Trim();

    public static string RuleLabelOf(string? ruleType) =>
        ruleType is not null && RuleLabels.TryGetValue(ruleType, out var label)
            ? label
            : (ruleType ?? string.Empty).Trim();

    /// <summary>Маску персонального значения в форму не подставляем (как веб).</summary>
    public static bool IsMaskedPersonal(string? value) =>
        string.Equals((value ?? string.Empty).Trim(), MaskedPersonalValue, StringComparison.Ordinal);

    /// <summary>Пустое/маскированное — пустая строка для полей формы.</summary>
    public static string PersonalOrEmpty(string? value) =>
        IsMaskedPersonal(value) ? string.Empty : (value ?? string.Empty).Trim();
}

/// <summary>Пункт справочника объектов в админке: фильтры, формы, маппинг листов импорта.</summary>
public sealed class TicketAdminObjectOption
{
    /// <summary>Фильтр «все объекты» (Id=null).</summary>
    public static readonly TicketAdminObjectOption All = new(null, "Все объекты");

    /// <summary>Фильтр «не указан» в формах (Id=null).</summary>
    public static readonly TicketAdminObjectOption None = new(null, "Не указан");

    public TicketAdminObjectOption(long? id, string name)
    {
        Id = id;
        Name = name;
    }

    public long? Id { get; }
    public string Name { get; }

    public override string ToString() => Name;
}

// ============================ Объекты ============================

/// <summary>Строка справочника объектов: код, название, статус «Активен/Отключен».</summary>
public sealed class TicketAdminObjectItemViewModel : ObservableObject
{
    private bool _isBusy;

    public TicketAdminObjectItemViewModel(HubTicketObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Apply(item);
    }

    public long Id { get; private set; }
    public string CodeText { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string ShortNameText { get; private set; } = string.Empty;
    public string RegionText { get; private set; } = string.Empty;

    /// <summary>is_active !== false — как в веб-менеджере (null тоже активен).</summary>
    public bool IsActive { get; private set; }

    public string StatusText => IsActive ? "Активен" : "Отключен";
    public string StatusTone => IsActive ? HubStatusTone.Success : HubStatusTone.Muted;
    public string ToggleText => IsActive ? "Отключить" : "Включить";

    /// <summary>PATCH объекта в полёте — кнопки строки на паузе.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        internal set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(ToggleText));
            }
        }
    }

    /// <summary>Ответ POST/PATCH — строка обновляется без перечитывания списка.</summary>
    internal void Apply(HubTicketObject item)
    {
        Id = item.Id;
        var code = (item.Code ?? string.Empty).Trim();
        CodeText = code.Length > 0 ? code : "—";
        Name = string.IsNullOrWhiteSpace(item.Name) ? $"Объект {item.Id}" : item.Name!.Trim();
        ShortNameText = (item.ShortName ?? string.Empty).Trim();
        RegionText = (item.Region ?? string.Empty).Trim();
        IsActive = item.IsActive != false;
        OnPropertyChanged(string.Empty);
    }
}

/// <summary>
/// Форма объекта (оверлей вкладки): создание шлёт только заданные поля,
/// редактирование — PATCH с exclude_unset (как ObjectBody backend'а).
/// </summary>
public sealed class TicketAdminObjectFormViewModel : ObservableObject
{
    private readonly long? _editId;
    private readonly Func<HubTicketObjectUpsert, CancellationToken, Task<HubTicketObject>> _save;
    private bool _isBusy;
    private string _nameText = string.Empty;
    private string _shortNameText = string.Empty;
    private string _regionText = string.Empty;
    private bool _isActive = true;
    private string? _errorText;

    public TicketAdminObjectFormViewModel(
        HubTicketObject? editing,
        Func<HubTicketObjectUpsert, CancellationToken, Task<HubTicketObject>> save)
    {
        _save = save ?? throw new ArgumentNullException(nameof(save));
        _editId = editing?.Id;
        Title = editing is null ? "Новый объект" : "Объект: " + (editing.Name ?? editing.Code ?? $"#{editing.Id}");
        if (editing is not null)
        {
            _nameText = (editing.Name ?? string.Empty).Trim();
            _shortNameText = (editing.ShortName ?? string.Empty).Trim();
            _regionText = (editing.Region ?? string.Empty).Trim();
            _isActive = editing.IsActive != false;
        }

        SaveCommand = new NativeAsyncCommand(
            (_, ct) => SaveAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CancelCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
    }

    /// <summary>Сохранено успешно: родитель обновляет строку/список и закрывает форму.</summary>
    public event EventHandler<HubTicketObject>? Saved;

    /// <summary>Закрытие без сохранения (Отмена/✕).</summary>
    public event EventHandler? Closed;

    public string Title { get; }

    /// <summary>Название — единственное обязательное поле (как в веб-менеджере).</summary>
    public string NameText
    {
        get => _nameText;
        set
        {
            if (SetProperty(ref _nameText, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(CanSave));
            }
        }
    }

    public string ShortNameText
    {
        get => _shortNameText;
        set => SetProperty(ref _shortNameText, value ?? string.Empty);
    }

    public string RegionText
    {
        get => _regionText;
        set => SetProperty(ref _regionText, value ?? string.Empty);
    }

    public bool IsActive
    {
        get => _isActive;
        set => SetProperty(ref _isActive, value);
    }

    public bool CanSave => !IsBusy && NameText.Trim().Length > 0;

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(CanSave));
                ((NativeAsyncCommand)SaveCommand).RaiseCanExecuteChanged();
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

    public ICommand SaveCommand { get; }
    public ICommand CancelCommand { get; }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        var name = NameText.Trim();
        if (name.Length == 0)
        {
            ErrorText = "Укажите название объекта.";
            return;
        }

        IsBusy = true;
        try
        {
            var saved = await _save(
                new HubTicketObjectUpsert
                {
                    Name = name,
                    ShortName = TrimOrNull(ShortNameText),
                    Region = TrimOrNull(RegionText),
                    IsActive = IsActive,
                },
                cancellationToken);
            Saved?.Invoke(this, saved);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static string? TrimOrNull(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    /// <summary>id редактируемого объекта (null — создание).</summary>
    internal long? EditId => _editId;
}

/// <summary>
/// Вкладка «Объекты»: справочник целиком (include_inactive), создание/правка
/// через форму-оверлей, вкл/откл одним PATCH — всё под ролью admin, как в вебе.
/// </summary>
public sealed class TicketAdminObjectsViewModel : ObservableObject
{
    private readonly TicketAdminViewModel _owner;
    private bool _isLoading;
    private TicketAdminObjectFormViewModel? _form;

    public TicketAdminObjectsViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        NewObjectCommand = new NativeRelayCommand(
            () => Form = new TicketAdminObjectFormViewModel(null, SaveNewAsync),
            () => _owner.IsAdmin && !IsLoading);
        EditObjectCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is TicketAdminObjectItemViewModel item)
                {
                    Form = new TicketAdminObjectFormViewModel(
                        new HubTicketObject
                        {
                            Id = item.Id,
                            Name = item.Name,
                            ShortName = item.ShortNameText,
                            Region = item.RegionText,
                            IsActive = item.IsActive,
                        },
                        (upsert, _) => SaveExistingAsync(item, upsert));
                }
            },
            parameter => _owner.IsAdmin && !IsLoading && parameter is TicketAdminObjectItemViewModel { IsBusy: false });
        ToggleObjectCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleAsync(parameter as TicketAdminObjectItemViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            parameter => _owner.IsAdmin && parameter is TicketAdminObjectItemViewModel { IsBusy: false });
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
    }

    public ObservableCollection<TicketAdminObjectItemViewModel> Items { get; } = [];

    public bool IsEmpty => Items.Count == 0 && !IsLoading;

    /// <summary>Управление справочником — только admin (fail-closed, как в вебе).</summary>
    public bool CanManage => _owner.IsAdmin;

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    /// <summary>Открытая форма создания/правки; null — оверлей скрыт.</summary>
    public TicketAdminObjectFormViewModel? Form
    {
        get => _form;
        internal set
        {
            if (_form is not null)
            {
                _form.Saved -= Form_Saved;
                _form.Closed -= Form_Closed;
            }

            if (SetProperty(ref _form, value) && value is not null)
            {
                value.Saved += Form_Saved;
                value.Closed += Form_Closed;
            }
        }
    }

    public ICommand NewObjectCommand { get; }
    public ICommand EditObjectCommand { get; }
    public ICommand ToggleObjectCommand { get; }

    internal async Task LoadSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            var items = await _owner.LoadObjectsRawAsync(force: true, cancellationToken);
            Items.Clear();
            foreach (var item in items)
            {
                Items.Add(new TicketAdminObjectItemViewModel(item));
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private Task<HubTicketObject> SaveNewAsync(
        HubTicketObjectUpsert upsert,
        CancellationToken cancellationToken) =>
        _owner.Api.CreateTicketObjectAsync(upsert, cancellationToken);

    private Task<HubTicketObject> SaveExistingAsync(
        TicketAdminObjectItemViewModel item,
        HubTicketObjectUpsert upsert) =>
        _owner.Api.UpdateTicketObjectAsync(item.Id, upsert, CancellationToken.None);

    private void Form_Saved(object? sender, HubTicketObject saved)
    {
        var existing = Items.FirstOrDefault(item => item.Id == saved.Id);
        if (existing is not null)
        {
            existing.Apply(saved);
        }
        else
        {
            Items.Add(new TicketAdminObjectItemViewModel(saved));
        }

        _owner.SyncObjectOptions(saved);
        Form = null;
        _owner.InfoText = $"Объект «{saved.Name ?? saved.Code ?? saved.Id.ToString(CultureInfo.InvariantCulture)}» сохранён.";
    }

    private void Form_Closed(object? sender, EventArgs e)
    {
        Form = null;
    }

    /// <summary>Вкл/откл — PATCH {is_active}, как кнопка в веб-менеджере объектов.</summary>
    private async Task ToggleAsync(TicketAdminObjectItemViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || item.IsBusy)
        {
            return;
        }

        item.IsBusy = true;
        try
        {
            var updated = await _owner.Api.UpdateTicketObjectAsync(
                item.Id,
                new HubTicketObjectUpsert { IsActive = !item.IsActive },
                cancellationToken);
            item.Apply(updated);
            _owner.SyncObjectOptions(updated);
        }
        finally
        {
            item.IsBusy = false;
        }
    }
}

// ============================ Сотрудники ============================

/// <summary>Строка справочника сотрудников билетов (список и сохранённая карточка).</summary>
public sealed class TicketAdminEmployeeItemViewModel
{
    /// <summary>Из записи справочника (GET /tickets/employees, POST …/from-zup).</summary>
    public static TicketAdminEmployeeItemViewModel FromList(HubTicketEmployee employee)
    {
        ArgumentNullException.ThrowIfNull(employee);
        return new TicketAdminEmployeeItemViewModel(
            employee.Id, employee.FullName, employee.Position,
            employee.Department, employee.Phone, employee.ZupEmployeeCode);
    }

    /// <summary>Из детальной карточки (POST/PATCH /employees) — тот же вид строки.</summary>
    public static TicketAdminEmployeeItemViewModel FromDetail(HubTicketEmployeeDetail employee)
    {
        ArgumentNullException.ThrowIfNull(employee);
        return new TicketAdminEmployeeItemViewModel(
            employee.Id, employee.FullName, employee.Position,
            employee.Department, employee.Phone, employee.ZupEmployeeCode);
    }

    private TicketAdminEmployeeItemViewModel(
        long id,
        string? fullName,
        string? position,
        string? department,
        string? phone,
        string? zupCode)
    {
        Id = id;
        FullName = string.IsNullOrWhiteSpace(fullName)
            ? $"Сотрудник {id.ToString(CultureInfo.InvariantCulture)}"
            : fullName.Trim();
        MetaText = string.Join(
            " · ",
            new[] { position, department, phone }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        ZupCodeText = string.IsNullOrWhiteSpace(zupCode)
            ? string.Empty
            : $"ЗУП: {zupCode.Trim()}";
    }

    public long Id { get; }
    public string FullName { get; }
    public string MetaText { get; }
    public string ZupCodeText { get; }
}

/// <summary>Подсказка ЗУП-поиска на вкладке «Сотрудники» — импорт по employee_code.</summary>
public sealed class TicketAdminZupOptionViewModel
{
    public TicketAdminZupOptionViewModel(HubTicketZupPerson person)
    {
        ArgumentNullException.ThrowIfNull(person);
        EmployeeCode = (person.EmployeeCode ?? string.Empty).Trim();
        Title = string.IsNullOrWhiteSpace(person.FullName) ? "Без имени" : person.FullName!.Trim();
        MetaText = string.Join(
            " · ",
            new[] { "ЗУП", person.Position, person.Department }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    public string EmployeeCode { get; }
    public string Title { get; }
    public string MetaText { get; }
}

/// <summary>
/// Форма сотрудника билетов: общие поля всегда, паспортный блок — при праве
/// tickets.personal_data.read (маскированные «** **** ******» в PATCH не уходят).
/// Документ с id правится, без id — создаётся (контракт update_employee).
/// </summary>
public sealed class TicketAdminEmployeeFormViewModel : ObservableObject
{
    private readonly TicketAdminViewModel _owner;
    private readonly long? _editId;
    private long? _documentId;
    private bool _isBusy;
    private string? _errorText;

    public TicketAdminEmployeeFormViewModel(TicketAdminViewModel owner, HubTicketEmployeeDetail? editing)
    {
        _owner = owner;
        _editId = editing?.Id;
        Title = editing is null ? "Новый сотрудник" : "Сотрудник: " + (editing.FullName ?? $"#{editing.Id}");
        if (editing is not null)
        {
            Apply(editing);
        }

        SaveCommand = new NativeAsyncCommand(
            (_, ct) => SaveAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CancelCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
    }

    public event EventHandler<HubTicketEmployeeDetail>? Saved;
    public event EventHandler? Closed;

    public string Title { get; }

    /// <summary>Паспортный блок виден при праве на персональные данные (как canEditPersonal веба).</summary>
    public bool ShowPersonalSection => _owner.CanWrite && _owner.CanReadPersonal;

    /// <summary>Подсказка без права на персональные данные — как Alert warning в вебе.</summary>
    public bool ShowPersonalHint => _owner.CanWrite && !_owner.CanReadPersonal;

    public long? EditId => _editId;

    private string _fullNameText = string.Empty;
    private string _departmentText = string.Empty;
    private string _positionText = string.Empty;
    private string _phoneText = string.Empty;
    private string _emailText = string.Empty;
    private string _dateOfBirthText = string.Empty;
    private string _passportSeriesText = string.Empty;
    private string _passportNumberText = string.Empty;
    private string _issuedByText = string.Empty;
    private string _issuerCodeText = string.Empty;
    private string _issueDateText = string.Empty;
    private string _birthPlaceText = string.Empty;
    private string _registrationAddressText = string.Empty;

    public string FullNameText { get => _fullNameText; set { if (SetProperty(ref _fullNameText, value ?? string.Empty)) OnPropertyChanged(nameof(CanSave)); } }
    public string DepartmentText { get => _departmentText; set => SetProperty(ref _departmentText, value ?? string.Empty); }
    public string PositionText { get => _positionText; set => SetProperty(ref _positionText, value ?? string.Empty); }
    public string PhoneText { get => _phoneText; set => SetProperty(ref _phoneText, value ?? string.Empty); }
    public string EmailText { get => _emailText; set => SetProperty(ref _emailText, value ?? string.Empty); }
    public string DateOfBirthText { get => _dateOfBirthText; set => SetProperty(ref _dateOfBirthText, value ?? string.Empty); }
    public string PassportSeriesText { get => _passportSeriesText; set => SetProperty(ref _passportSeriesText, value ?? string.Empty); }
    public string PassportNumberText { get => _passportNumberText; set => SetProperty(ref _passportNumberText, value ?? string.Empty); }
    public string IssuedByText { get => _issuedByText; set => SetProperty(ref _issuedByText, value ?? string.Empty); }
    public string IssuerCodeText { get => _issuerCodeText; set => SetProperty(ref _issuerCodeText, value ?? string.Empty); }
    public string IssueDateText { get => _issueDateText; set => SetProperty(ref _issueDateText, value ?? string.Empty); }
    public string BirthPlaceText { get => _birthPlaceText; set => SetProperty(ref _birthPlaceText, value ?? string.Empty); }
    public string RegistrationAddressText { get => _registrationAddressText; set => SetProperty(ref _registrationAddressText, value ?? string.Empty); }

    public bool CanSave => !IsBusy && FullNameText.Trim().Length > 0;

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(CanSave));
                ((NativeAsyncCommand)SaveCommand).RaiseCanExecuteChanged();
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

    public ICommand SaveCommand { get; }
    public ICommand CancelCommand { get; }

    /// <summary>Карточка GET /tickets/employees/{id} → поля формы; маски не показываем.</summary>
    internal void Apply(HubTicketEmployeeDetail employee)
    {
        ArgumentNullException.ThrowIfNull(employee);
        FullNameText = employee.FullName ?? string.Empty;
        DepartmentText = employee.Department ?? string.Empty;
        PositionText = employee.Position ?? string.Empty;
        PhoneText = employee.Phone ?? string.Empty;
        EmailText = employee.Email ?? string.Empty;
        var document = employee.Documents?.FirstOrDefault(item => item.IsCurrent)
            ?? employee.Documents?.FirstOrDefault();
        _documentId = document?.Id;
        if (_owner.CanReadPersonal)
        {
            DateOfBirthText = TicketAdminCatalog.PersonalOrEmpty(employee.DateOfBirth);
            if (document is not null)
            {
                PassportSeriesText = TicketAdminCatalog.PersonalOrEmpty(document.PassportSeries);
                PassportNumberText = TicketAdminCatalog.PersonalOrEmpty(document.PassportNumber);
                IssuedByText = TicketAdminCatalog.PersonalOrEmpty(document.IssuedBy);
                IssuerCodeText = TicketAdminCatalog.PersonalOrEmpty(document.IssuerCode);
                IssueDateText = TicketAdminCatalog.PersonalOrEmpty(document.IssueDate);
                BirthPlaceText = TicketAdminCatalog.PersonalOrEmpty(document.BirthPlace);
                RegistrationAddressText = TicketAdminCatalog.PersonalOrEmpty(document.RegistrationAddress);
            }
        }
    }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        if (FullNameText.Trim().Length == 0)
        {
            ErrorText = "Укажите ФИО сотрудника.";
            return;
        }

        var upsert = new HubTicketEmployeeUpsert
        {
            FullName = FullNameText.Trim(),
            Department = TrimOrNull(DepartmentText),
            Position = TrimOrNull(PositionText),
            Phone = TrimOrNull(PhoneText),
            Email = TrimOrNull(EmailText),
        };
        if (ShowPersonalSection)
        {
            var birth = TrimOrNull(DateOfBirthText);
            if (birth is not null)
            {
                upsert = upsert with { DateOfBirth = birth };
            }

            // Документ уходит только при реальном вводе — как hasPassportInput веба.
            var document = BuildDocument();
            if (document is not null)
            {
                upsert = upsert with { Documents = [document] };
            }
        }

        IsBusy = true;
        try
        {
            var saved = _editId is { } id
                ? await _owner.Api.UpdateTicketEmployeeAsync(id, upsert, cancellationToken)
                : await _owner.Api.CreateTicketEmployeeAsync(upsert, cancellationToken);
            Saved?.Invoke(this, saved);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private HubTicketEmployeeDocumentUpsert? BuildDocument()
    {
        var document = new HubTicketEmployeeDocumentUpsert
        {
            PassportSeries = TrimOrNull(PassportSeriesText),
            PassportNumber = TrimOrNull(PassportNumberText),
            IssuedBy = TrimOrNull(IssuedByText),
            IssuerCode = TrimOrNull(IssuerCodeText),
            BirthPlace = TrimOrNull(BirthPlaceText),
            IssueDate = TrimOrNull(IssueDateText),
            RegistrationAddress = TrimOrNull(RegistrationAddressText),
        };
        var hasInput = document.PassportSeries is not null
            || document.PassportNumber is not null
            || document.IssuedBy is not null
            || document.IssuerCode is not null
            || document.BirthPlace is not null
            || document.IssueDate is not null
            || document.RegistrationAddress is not null;
        if (!hasInput)
        {
            return null;
        }

        return _documentId is { } id ? document with { Id = id } : document;
    }

    private static string? TrimOrNull(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}

/// <summary>
/// Вкладка «Сотрудники»: справочник билетов с серверным поиском, карточка-форма
/// (create/update), ЗУП-поиск с импортом через from-zup — флоу TicketEmployeeCard веба.
/// </summary>
public sealed class TicketAdminEmployeesViewModel : ObservableObject
{
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);
    private const int SearchMinLength = 2;
    private const int PageSize = 50;

    private readonly TicketAdminViewModel _owner;
    private CancellationTokenSource? _searchCancellation;
    private string _searchText = string.Empty;
    private string _zupQuery = string.Empty;
    private bool _isLoading;
    private bool _isZupBusy;
    private bool _isFormLoading;
    private TicketAdminEmployeeItemViewModel? _selectedItem;
    private TicketAdminEmployeeFormViewModel? _form;

    public TicketAdminEmployeesViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        SearchCommand = new NativeAsyncCommand(
            (_, ct) => LoadSafelyAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex));
        NewEmployeeCommand = new NativeRelayCommand(
            () => Form = new TicketAdminEmployeeFormViewModel(_owner, null),
            () => _owner.CanWrite);
        SelectZupCommand = new NativeAsyncCommand(
            (parameter, ct) => ImportZupAsync(parameter as TicketAdminZupOptionViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => _owner.CanWrite && !IsZupBusy);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        ZupOptions.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasZupOptions));
    }

    public ObservableCollection<TicketAdminEmployeeItemViewModel> Items { get; } = [];
    public ObservableCollection<TicketAdminZupOptionViewModel> ZupOptions { get; } = [];

    public bool IsEmpty => Items.Count == 0 && !IsLoading;
    public bool HasZupOptions => ZupOptions.Count > 0;

    /// <summary>Серверный поиск справочника: debounce, от 2 символов пустая строка = все.</summary>
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

    /// <summary>Строка «Взять из ЗУП»: от 2 символов идёт zup-search.</summary>
    public string ZupQuery
    {
        get => _zupQuery;
        set
        {
            if (SetProperty(ref _zupQuery, value ?? string.Empty))
            {
                _ = SearchZupSafelyAsync(_zupQuery.Trim());
            }
        }
    }

    public TicketAdminEmployeeItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is not null)
            {
                _ = OpenEmployeeSafelyAsync(value.Id);
            }
        }
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public bool IsZupBusy
    {
        get => _isZupBusy;
        private set
        {
            if (SetProperty(ref _isZupBusy, value))
            {
                ((NativeAsyncCommand)SelectZupCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Карточка выбранного сотрудника грузится (GET /tickets/employees/{id}).</summary>
    public bool IsFormLoading
    {
        get => _isFormLoading;
        private set => SetProperty(ref _isFormLoading, value);
    }

    /// <summary>Форма создания/правки справа от списка; null — скрыта.</summary>
    public TicketAdminEmployeeFormViewModel? Form
    {
        get => _form;
        internal set
        {
            if (_form is not null)
            {
                _form.Saved -= Form_Saved;
                _form.Closed -= Form_Closed;
            }

            if (SetProperty(ref _form, value) && value is not null)
            {
                value.Saved += Form_Saved;
                value.Closed += Form_Closed;
            }
        }
    }

    public ICommand SearchCommand { get; }
    public ICommand NewEmployeeCommand { get; }
    public ICommand SelectZupCommand { get; }

    internal async Task LoadSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            var page = await _owner.Api.GetTicketEmployeesAsync(
                _searchText.Trim().Length > 0 ? _searchText.Trim() : null,
                PageSize,
                cancellationToken);
            Items.Clear();
            foreach (var employee in page.Items ?? [])
            {
                Items.Add(TicketAdminEmployeeItemViewModel.FromList(employee));
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        _ = SearchSafelyAsync(_searchText.Trim(), cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _owner.DelayAsync(SearchDebounce, cancellationToken);
            if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            await LoadSafelyAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }

    /// <summary>Выбор строки: карточка целиком (с документами) открывает форму правки.</summary>
    private async Task OpenEmployeeSafelyAsync(long employeeId)
    {
        IsFormLoading = true;
        try
        {
            var detail = await _owner.Api.GetTicketEmployeeAsync(employeeId, CancellationToken.None);
            if (_selectedItem?.Id == employeeId)
            {
                if (_form is { EditId: { } openId } && openId == employeeId)
                {
                    _form.Apply(detail);
                }
                else
                {
                    Form = new TicketAdminEmployeeFormViewModel(_owner, detail);
                }
            }
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFormLoading = false;
        }
    }

    /// <summary>ZUP-поиск от 2 символов; короче — список подсказок пуст.</summary>
    private async Task SearchZupSafelyAsync(string query)
    {
        if (query.Length < SearchMinLength)
        {
            ZupOptions.Clear();
            return;
        }

        IsZupBusy = true;
        try
        {
            await _owner.DelayAsync(SearchDebounce, CancellationToken.None);
            if (!string.Equals(_zupQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            var result = await _owner.Api.SearchTicketZupEmployeesAsync(
                query, PageSize, CancellationToken.None);
            if (!string.Equals(_zupQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            ZupOptions.Clear();
            foreach (var person in result.Items ?? [])
            {
                ZupOptions.Add(new TicketAdminZupOptionViewModel(person));
            }
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsZupBusy = false;
        }
    }

    /// <summary>Выбор ЗУП-подсказки: POST from-zup по коду, карточка — в форму правки.</summary>
    private async Task ImportZupAsync(TicketAdminZupOptionViewModel? option, CancellationToken cancellationToken)
    {
        if (option is null || IsZupBusy)
        {
            return;
        }

        if (option.EmployeeCode.Length == 0)
        {
            _owner.ErrorText = "У выбранного сотрудника ЗУП нет кода.";
            return;
        }

        IsZupBusy = true;
        try
        {
            var imported = await _owner.Api.EnsureTicketEmployeeFromZupAsync(
                option.EmployeeCode, cancellationToken);
            _owner.InfoText = _owner.CanReadPersonal
                ? "Сотрудник взят из ЗУП вместе с данными. Проверьте и сохраните правки."
                : "Сотрудник взят из ЗУП.";
            // Импортированный открываем в форме и обновляем список справочника.
            Form = new TicketAdminEmployeeFormViewModel(
                _owner,
                new HubTicketEmployeeDetail
                {
                    Id = imported.Id,
                    FullName = imported.FullName,
                    Department = imported.Department,
                    Position = imported.Position,
                    Phone = imported.Phone,
                    Email = imported.Email,
                    ZupEmployeeCode = imported.ZupEmployeeCode,
                    Status = imported.Status,
                });
            ZupOptions.Clear();
            await LoadSafelyAsync(CancellationToken.None);
        }
        finally
        {
            IsZupBusy = false;
        }
    }

    private void Form_Saved(object? sender, HubTicketEmployeeDetail saved)
    {
        var index = Items.IndexOf(Items.FirstOrDefault(item => item.Id == saved.Id)!);
        var row = TicketAdminEmployeeItemViewModel.FromDetail(saved);
        if (index >= 0)
        {
            Items[index] = row;
        }
        else
        {
            Items.Insert(0, row);
        }

        _selectedItem = null;
        OnPropertyChanged(nameof(SelectedItem));
        _owner.InfoText = "Данные сотрудника сохранены.";
        // Форму оставляем открытой с обновлёнными данными — как в веб-карточке.
        Form?.Apply(saved);
    }

    private void Form_Closed(object? sender, EventArgs e)
    {
        Form = null;
    }
}

// ============================ Импорт ============================

/// <summary>Лист книги в предпросмотре импорта: тип, строки, маппинг на объект.</summary>
public sealed class TicketAdminImportSheetViewModel : ObservableObject
{
    private TicketAdminObjectOption? _selectedObject;

    public TicketAdminImportSheetViewModel(
        HubTicketImportSheet sheet,
        IReadOnlyList<TicketAdminObjectOption> objects)
    {
        ArgumentNullException.ThrowIfNull(sheet);
        Title = string.IsNullOrWhiteSpace(sheet.Title) ? "Лист" : sheet.Title!.Trim();
        Classification = (sheet.Classification ?? string.Empty).Trim();
        IsWorkSheet = string.Equals(Classification, "рабочий", StringComparison.OrdinalIgnoreCase);
        RowCountText = sheet.RowCount.ToString(CultureInfo.CurrentCulture);
        HeadersText = string.Join(
            ", ",
            (sheet.Headers ?? []).Where(header => !string.IsNullOrWhiteSpace(header)).Take(6));
        ErrorCount = sheet.ErrorCount;
        ErrorCountText = sheet.ErrorCount > 0
            ? $"Ошибок: {sheet.ErrorCount.ToString(CultureInfo.CurrentCulture)}"
            : string.Empty;
        // «Не указан» позволяет снять маппинг рабочего листа.
        ObjectOptions = new[] { TicketAdminObjectOption.None }.Concat(objects).ToArray();
        _selectedObject = TicketAdminObjectOption.None;
        if (sheet.MatchedObjectId is { } matched)
        {
            _selectedObject = objects.FirstOrDefault(option => option.Id == matched)
                ?? TicketAdminObjectOption.None;
            MatchedText = _selectedObject.Id is not null
                ? string.Empty
                : (sheet.MatchedObjectName ?? string.Empty).Trim();
        }
        else
        {
            MatchedText = (sheet.MatchedObjectName ?? string.Empty).Trim();
        }
    }

    public string Title { get; }
    public string Classification { get; }

    /// <summary>«рабочий» лист импортируется — для него выбирают объект маппинга.</summary>
    public bool IsWorkSheet { get; }
    public string RowCountText { get; }
    public string HeadersText { get; }
    public int ErrorCount { get; }
    public string ErrorCountText { get; }

    /// <summary>Имя объекта, сматчившегося сервером вне справочника (только показ).</summary>
    public string MatchedText { get; }

    public IReadOnlyList<TicketAdminObjectOption> ObjectOptions { get; }

    /// <summary>Выбранный объект маппинга листа — идёт в sheet_object_map.</summary>
    public TicketAdminObjectOption? SelectedObject
    {
        get => _selectedObject;
        set => SetProperty(ref _selectedObject, value);
    }
}

/// <summary>Строка ошибки/предупреждения результата импорта: лист, строка, текст.</summary>
public sealed class TicketAdminImportIssueViewModel
{
    public TicketAdminImportIssueViewModel(HubTicketImportIssue issue)
    {
        ArgumentNullException.ThrowIfNull(issue);
        SheetText = (issue.Sheet ?? string.Empty).Trim();
        RowText = issue.Row is { } row
            ? $"строка {row.ToString(CultureInfo.CurrentCulture)}"
            : string.Empty;
        Message = (issue.Error ?? issue.Warning ?? string.Empty).Trim();
    }

    public string SheetText { get; }
    public string RowText { get; }
    public string Message { get; }
}

/// <summary>
/// Вкладка «Импорт»: upload .xlsx → preview (листы, color_map, маппинг объектов)
/// → execute со стратегией дубликатов → счётчики и детали результата.
/// Шаги — как Stepper «Файл → Предпросмотр → Запуск» TicketImportWizard веба.
/// </summary>
public sealed class TicketAdminImportViewModel : ObservableObject
{
    /// <summary>Лимит backend'а на файл импорта — 50 МБ.</summary>
    internal const long MaxFileSizeBytes = 50L * 1024 * 1024;

    private readonly TicketAdminViewModel _owner;
    private bool _isBusy;
    private string? _jobId;
    private string _fileNameText = string.Empty;
    private IReadOnlyDictionary<string, string> _colorMap =
        new Dictionary<string, string>(StringComparer.Ordinal);
    private TicketStatusOption _duplicateStrategy = TicketAdminCatalog.DuplicateStrategies[0];
    private string _resultText = string.Empty;

    public TicketAdminImportViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        UploadCommand = new NativeAsyncCommand(
            (_, ct) => UploadAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => _owner.CanWrite && !IsBusy);
        ExecuteCommand = new NativeAsyncCommand(
            (_, ct) => ExecuteAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => _owner.CanWrite && !IsBusy && HasPreview);
        ResetCommand = new NativeRelayCommand(Reset, () => !IsBusy);
        Sheets.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasPreview));
        Issues.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasIssues));
        UnmatchedSheets.CollectionChanged += (_, _) => OnPropertyChanged(nameof(UnmatchedText));
    }

    /// <summary>Шаг «Файл»: имя загруженной книги и кнопка выбора.</summary>
    public string FileNameText
    {
        get => _fileNameText;
        private set => SetProperty(ref _fileNameText, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                ((NativeAsyncCommand)UploadCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)ExecuteCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Шаг «Предпросмотр»: листы с классификацией и маппингом объектов.</summary>
    public ObservableCollection<TicketAdminImportSheetViewModel> Sheets { get; } = [];

    /// <summary>Листы без объекта — unmatched_sheets предпросмотра, одной строкой.</summary>
    public ObservableCollection<string> UnmatchedSheets { get; } = [];

    public bool HasPreview => Sheets.Count > 0;

    public string UnmatchedText => UnmatchedSheets.Count == 0
        ? string.Empty
        : "Листы без объекта: " + string.Join(", ", UnmatchedSheets);

    /// <summary>Стратегия дубликатов: skip|update|create (дефолт — «Пропускать»).</summary>
    public IReadOnlyList<TicketStatusOption> DuplicateStrategies => TicketAdminCatalog.DuplicateStrategies;

    public TicketStatusOption DuplicateStrategy
    {
        get => _duplicateStrategy;
        set => SetProperty(ref _duplicateStrategy, value ?? TicketAdminCatalog.DuplicateStrategies[0]);
    }

    /// <summary>Шаг «Запуск»: сводка результата и список ошибок/предупреждений.</summary>
    public string ResultText
    {
        get => _resultText;
        private set
        {
            if (SetProperty(ref _resultText, value))
            {
                OnPropertyChanged(nameof(HasResult));
            }
        }
    }

    public bool HasResult => ResultText.Length > 0;

    public ObservableCollection<TicketAdminImportIssueViewModel> Issues { get; } = [];

    public bool HasIssues => Issues.Count > 0;

    public ICommand UploadCommand { get; }
    public ICommand ExecuteCommand { get; }
    public ICommand ResetCommand { get; }

    /// <summary>Подготовка вкладки: справочник объектов для маппинга листов (лениво).</summary>
    internal async Task PrepareAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _owner.LoadObjectsRawAsync(force: false, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>POST /tickets/import/upload → сразу GET …/preview (как веб-визард).</summary>
    private async Task UploadAsync(CancellationToken cancellationToken)
    {
        var path = _owner.ImportFilePicker?.Invoke();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        var extension = Path.GetExtension(path);
        if (!string.Equals(extension, ".xlsx", StringComparison.OrdinalIgnoreCase))
        {
            _owner.ErrorText = "Импорт принимает только файлы .xlsx.";
            return;
        }

        if (!File.Exists(path))
        {
            _owner.ErrorText = $"Файл «{Path.GetFileName(path)}» не найден.";
            return;
        }

        if (new FileInfo(path).Length > MaxFileSizeBytes)
        {
            _owner.ErrorText = $"Файл «{Path.GetFileName(path)}» больше 50 МБ.";
            return;
        }

        IsBusy = true;
        _owner.ErrorText = null;
        try
        {
            await using var stream = new FileStream(
                path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            var job = await _owner.Api.UploadTicketImportAsync(
                Path.GetFileName(path), stream, cancellationToken);
            if (string.IsNullOrEmpty(job.Id))
            {
                _owner.ErrorText = "Сервер не вернул id задания импорта.";
                return;
            }

            _jobId = job.Id;
            FileNameText = job.FileName ?? Path.GetFileName(path);
            await LoadPreviewAsync(cancellationToken);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task LoadPreviewAsync(CancellationToken cancellationToken)
    {
        var preview = await _owner.Api.GetTicketImportPreviewAsync(_jobId!, cancellationToken);
        _colorMap = preview.ColorMap ?? new Dictionary<string, string>(StringComparer.Ordinal);
        FileNameText = preview.FileName ?? FileNameText;

        var objects = _owner.ObjectOptions.Count > 0
            ? _owner.ObjectOptions.ToArray()
            : (await SafeObjectsAsync(cancellationToken));
        Sheets.Clear();
        foreach (var sheet in preview.Sheets ?? [])
        {
            Sheets.Add(new TicketAdminImportSheetViewModel(sheet, objects));
        }

        UnmatchedSheets.Clear();
        foreach (var title in preview.UnmatchedSheets ?? [])
        {
            UnmatchedSheets.Add(title);
        }
    }

    /// <summary>Справочник объектов для маппинга листов: штатный путь — через owner.</summary>
    private async Task<TicketAdminObjectOption[]> SafeObjectsAsync(CancellationToken cancellationToken)
    {
        await _owner.LoadObjectsRawAsync(force: true, cancellationToken);
        return _owner.ObjectOptions.ToArray();
    }

    /// <summary>POST …/execute: color_map предпросмотра, стратегия и маппинг рабочих листов.</summary>
    private async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        if (_jobId is null || IsBusy)
        {
            return;
        }

        IsBusy = true;
        _owner.ErrorText = null;
        try
        {
            var sheetObjectMap = new Dictionary<string, long>(StringComparer.Ordinal);
            foreach (var sheet in Sheets)
            {
                if (sheet.IsWorkSheet && sheet.SelectedObject?.Id is { } objectId)
                {
                    sheetObjectMap[sheet.Title] = objectId;
                }
            }

            var result = await _owner.Api.ExecuteTicketImportAsync(
                _jobId,
                new HubTicketImportExecute
                {
                    ColorMap = _colorMap,
                    DuplicateStrategy = DuplicateStrategy.Value ?? "skip",
                    SheetObjectMap = sheetObjectMap,
                },
                cancellationToken);
            ResultText = $"Импортировано: {result.Imported.ToString(CultureInfo.CurrentCulture)} · " +
                $"пропущено: {result.Skipped.ToString(CultureInfo.CurrentCulture)} · " +
                $"ошибок: {result.Errors.ToString(CultureInfo.CurrentCulture)} · " +
                $"предупреждений: {result.Warnings.ToString(CultureInfo.CurrentCulture)}";
            Issues.Clear();
            foreach (var issue in result.ErrorDetails ?? [])
            {
                Issues.Add(new TicketAdminImportIssueViewModel(issue));
            }

            foreach (var issue in result.WarningDetails ?? [])
            {
                Issues.Add(new TicketAdminImportIssueViewModel(issue));
            }
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>«Сбросить»: новый файл без перезахода на вкладку.</summary>
    internal void Reset()
    {
        _jobId = null;
        _colorMap = new Dictionary<string, string>(StringComparer.Ordinal);
        FileNameText = string.Empty;
        Sheets.Clear();
        UnmatchedSheets.Clear();
        Issues.Clear();
        ResultText = string.Empty;
        DuplicateStrategy = TicketAdminCatalog.DuplicateStrategies[0];
    }
}

// ============================ Финоперации ============================

/// <summary>Строка финоперации: дата, тип, сумма, причина, armed-удаление.</summary>
public sealed class TicketAdminFinOpItemViewModel : ObservableObject
{
    private bool _deleteArmed;
    private bool _isDeleteBusy;

    public TicketAdminFinOpItemViewModel(HubTicketFinancialOp op)
    {
        ArgumentNullException.ThrowIfNull(op);
        Apply(op);
    }

    public long Id { get; private set; }
    public string DateText { get; private set; } = string.Empty;
    public string OpTypeText { get; private set; } = string.Empty;
    public string AmountText { get; private set; } = string.Empty;
    public string ReasonText { get; private set; } = string.Empty;
    public string RefundStatusText { get; private set; } = string.Empty;
    public string RefText { get; private set; } = string.Empty;
    public bool IsDeleted { get; private set; }
    public string? OpType { get; private set; }
    public string? Amount { get; private set; }
    public string? Reason { get; private set; }
    public string? RefundStatus { get; private set; }
    public string? OpDate { get; private set; }
    public long? ObjectId { get; private set; }
    public long? RequestId { get; private set; }
    public long? EmployeeId { get; private set; }

    /// <summary>Первый «Удалить» взводит подтверждение; второй — DELETE (мягкое удаление).</summary>
    public bool DeleteArmed
    {
        get => _deleteArmed;
        internal set
        {
            if (SetProperty(ref _deleteArmed, value))
            {
                OnPropertyChanged(nameof(DeleteText));
            }
        }
    }

    public bool IsDeleteBusy
    {
        get => _isDeleteBusy;
        internal set
        {
            if (SetProperty(ref _isDeleteBusy, value))
            {
                OnPropertyChanged(nameof(DeleteText));
                OnPropertyChanged(nameof(IsDeleteEnabled));
            }
        }
    }

    public bool IsDeleteEnabled => !IsDeleteBusy;
    public string DeleteText => IsDeleteBusy ? "…" : DeleteArmed ? "Удалить?" : "Удалить";

    internal void Apply(HubTicketFinancialOp op)
    {
        Id = op.Id;
        OpType = op.OpType;
        Amount = op.Amount;
        Reason = op.Reason;
        RefundStatus = op.RefundStatus;
        OpDate = op.OpDate;
        ObjectId = op.ObjectId;
        RequestId = op.RequestId;
        EmployeeId = op.EmployeeId;
        var date = TicketFormat.FormatDate(op.OpDate ?? op.CreatedAt);
        DateText = date.Length > 0 ? date : "—";
        OpTypeText = TicketAdminCatalog.FinOpLabelOf(op.OpType);
        AmountText = TicketFormat.FormatMoney(op.Amount);
        ReasonText = string.IsNullOrWhiteSpace(op.Reason) ? "—" : op.Reason!.Trim();
        RefundStatusText = (op.RefundStatus ?? string.Empty).Trim();
        RefText = string.Join(
            " · ",
            new[]
            {
                op.RequestId is { } requestId ? $"Заявка №{requestId.ToString(CultureInfo.InvariantCulture)}" : null,
                op.ObjectId is { } objectId ? $"Объект {objectId.ToString(CultureInfo.InvariantCulture)}" : null,
                op.EmployeeId is { } employeeId ? $"Сотрудник {employeeId.ToString(CultureInfo.InvariantCulture)}" : null,
            }.Where(part => part is not null));
        IsDeleted = op.IsDeleted;
        OnPropertyChanged(string.Empty);
    }
}

/// <summary>
/// Форма финоперации (оверлей): op_type обязателен, amount — Decimal строкой,
/// op_date «yyyy-MM-dd». PATCH шлёт те же поля (сервер берёт exclude_unset).
/// </summary>
public sealed class TicketAdminFinOpFormViewModel : ObservableObject
{
    private readonly long? _editId;
    private readonly Func<HubTicketFinancialOpUpsert, CancellationToken, Task<HubTicketFinancialOp>> _save;
    private bool _isBusy;
    private string _amountText = string.Empty;
    private string _reasonText = string.Empty;
    private string _refundStatusText = string.Empty;
    private string _requestIdText = string.Empty;
    private string _employeeIdText = string.Empty;
    private TicketStatusOption _opType = TicketAdminCatalog.FinOpTypes[0];
    private TicketAdminObjectOption? _selectedObject;
    private DateTime? _opDate;
    private string? _errorText;

    public TicketAdminFinOpFormViewModel(
        TicketAdminFinOpItemViewModel? editing,
        IReadOnlyList<TicketAdminObjectOption> objects,
        Func<HubTicketFinancialOpUpsert, CancellationToken, Task<HubTicketFinancialOp>> save)
    {
        _save = save ?? throw new ArgumentNullException(nameof(save));
        _editId = editing?.Id;
        Title = editing is null ? "Новая операция" : $"Операция №{editing.Id}";
        ObjectOptions = objects;
        if (editing is not null)
        {
            _opType = TicketAdminCatalog.FinOpTypes.FirstOrDefault(
                option => option.Value == editing.OpType) ?? TicketAdminCatalog.FinOpTypes[0];
            _amountText = editing.Amount ?? string.Empty;
            _reasonText = editing.Reason ?? string.Empty;
            _refundStatusText = editing.RefundStatus ?? string.Empty;
            _requestIdText = editing.RequestId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
            _employeeIdText = editing.EmployeeId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
            _selectedObject = objects.FirstOrDefault(option => option.Id == editing.ObjectId);
            if (DateTime.TryParse(
                    editing.OpDate, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
            {
                _opDate = parsed;
            }
        }

        SaveCommand = new NativeAsyncCommand(
            (_, ct) => SaveAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CancelCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
    }

    public event EventHandler<HubTicketFinancialOp>? Saved;
    public event EventHandler? Closed;

    public string Title { get; }
    public IReadOnlyList<TicketAdminObjectOption> ObjectOptions { get; }
    public IReadOnlyList<TicketStatusOption> OpTypeOptions => TicketAdminCatalog.FinOpTypes;

    /// <summary>id редактируемой операции (null — создание; request/employee править нельзя).</summary>
    internal long? EditId => _editId;

    /// <summary>Связи с заявкой/сотрудником задаются только при создании (как веб-форма).</summary>
    public bool ShowLinkFields => _editId is null;

    public TicketStatusOption OpType
    {
        get => _opType;
        set => SetProperty(ref _opType, value ?? TicketAdminCatalog.FinOpTypes[0]);
    }

    public string AmountText
    {
        get => _amountText;
        set => SetProperty(ref _amountText, value ?? string.Empty);
    }

    public string ReasonText
    {
        get => _reasonText;
        set => SetProperty(ref _reasonText, value ?? string.Empty);
    }

    public string RefundStatusText
    {
        get => _refundStatusText;
        set => SetProperty(ref _refundStatusText, value ?? string.Empty);
    }

    public string RequestIdText
    {
        get => _requestIdText;
        set => SetProperty(ref _requestIdText, value ?? string.Empty);
    }

    public string EmployeeIdText
    {
        get => _employeeIdText;
        set => SetProperty(ref _employeeIdText, value ?? string.Empty);
    }

    public TicketAdminObjectOption? SelectedObject
    {
        get => _selectedObject;
        set => SetProperty(ref _selectedObject, value);
    }

    public DateTime? OpDate
    {
        get => _opDate;
        set => SetProperty(ref _opDate, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                ((NativeAsyncCommand)SaveCommand).RaiseCanExecuteChanged();
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

    public ICommand SaveCommand { get; }
    public ICommand CancelCommand { get; }

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        var amount = AmountText.Trim();
        if (amount.Length > 0)
        {
            if (!decimal.TryParse(amount, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
                || parsed < 0)
            {
                ErrorText = "Сумма должна быть неотрицательным числом.";
                return;
            }
        }

        if (!TryParseId(RequestIdText, out var requestId))
        {
            ErrorText = "№ заявки должен быть числом.";
            return;
        }

        if (!TryParseId(EmployeeIdText, out var employeeId))
        {
            ErrorText = "id сотрудника должен быть числом.";
            return;
        }

        var upsert = new HubTicketFinancialOpUpsert
        {
            OpType = OpType.Value,
            Amount = amount.Length > 0 ? amount : null,
            Reason = TrimOrNull(ReasonText),
            RefundStatus = TrimOrNull(RefundStatusText),
            OpDate = OpDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            ObjectId = SelectedObject?.Id,
            RequestId = _editId is null ? requestId : null,
            EmployeeId = _editId is null ? employeeId : null,
        };

        IsBusy = true;
        try
        {
            var saved = await _save(upsert, cancellationToken);
            Saved?.Invoke(this, saved);
        }
        finally
        {
            IsBusy = false;
        }
    }

    private static bool TryParseId(string text, out long? id)
    {
        var trimmed = text.Trim();
        if (trimmed.Length == 0)
        {
            id = null;
            return true;
        }

        if (long.TryParse(trimmed, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed))
        {
            id = parsed;
            return true;
        }

        id = null;
        return false;
    }

    private static string? TrimOrNull(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }
}

/// <summary>
/// Вкладка «Финоперации»: фильтры (тип/объект/период/удалённые), страница по 50,
/// создание и правка через форму-оверлей, удаление — armed (мягкое на сервере).
/// </summary>
public sealed class TicketAdminFinOpsViewModel : ObservableObject
{
    private const int PageSize = 50;

    private readonly TicketAdminViewModel _owner;
    private TicketAdminFinOpItemViewModel? _armedDelete;
    private TicketStatusOption? _opTypeFilter = TicketAdminCatalog.FinOpFilterOptions[0];
    private TicketAdminObjectOption? _objectFilter = TicketAdminObjectOption.All;
    private DateTime? _dateFrom;
    private DateTime? _dateTo;
    private bool _includeDeleted;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _currentPage;
    private int _totalPages;
    private bool _hasMore;
    private string _totalText = string.Empty;
    private TicketAdminFinOpFormViewModel? _form;

    public TicketAdminFinOpsViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        ApplyFiltersCommand = new NativeAsyncCommand(
            (_, ct) => LoadSafelyAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        NewOpCommand = new NativeRelayCommand(
            () => Form = new TicketAdminFinOpFormViewModel(null, FormObjectOptions, SaveNewAsync),
            () => _owner.CanWrite);
        EditOpCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is TicketAdminFinOpItemViewModel item)
                {
                    Form = new TicketAdminFinOpFormViewModel(
                        item, FormObjectOptions, (upsert, _) => SaveExistingAsync(item, upsert));
                }
            },
            parameter => _owner.CanWrite && parameter is TicketAdminFinOpItemViewModel);
        DeleteOpCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteAsync(parameter as TicketAdminFinOpItemViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            parameter => _owner.CanWrite && parameter is TicketAdminFinOpItemViewModel { IsDeleteBusy: false });
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        ObjectOptions.Add(TicketAdminObjectOption.All);
    }

    public ObservableCollection<TicketAdminFinOpItemViewModel> Items { get; } = [];

    /// <summary>Фильтр объекта: «Все объекты» + справочник из owner.</summary>
    public ObservableCollection<TicketAdminObjectOption> ObjectOptions { get; } = [];

    /// <summary>Варианты объекта в форме: «Не указан» + справочник.</summary>
    private TicketAdminObjectOption[] FormObjectOptions =>
        new[] { TicketAdminObjectOption.None }.Concat(_owner.ObjectOptions).ToArray();

    public IReadOnlyList<TicketStatusOption> OpTypeFilterOptions => TicketAdminCatalog.FinOpFilterOptions;

    public TicketStatusOption? OpTypeFilter
    {
        get => _opTypeFilter;
        set => SetProperty(ref _opTypeFilter, value);
    }

    public TicketAdminObjectOption? ObjectFilter
    {
        get => _objectFilter;
        set => SetProperty(ref _objectFilter, value);
    }

    public DateTime? DateFrom
    {
        get => _dateFrom;
        set => SetProperty(ref _dateFrom, value);
    }

    public DateTime? DateTo
    {
        get => _dateTo;
        set => SetProperty(ref _dateTo, value);
    }

    /// <summary>Показывать мягко удалённые — include_deleted backend'а.</summary>
    public bool IncludeDeleted
    {
        get => _includeDeleted;
        set => SetProperty(ref _includeDeleted, value);
    }

    public bool IsEmpty => Items.Count == 0 && !IsLoading;

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

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

    public bool HasMore
    {
        get => _hasMore;
        private set
        {
            if (SetProperty(ref _hasMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string MoreButtonText => IsLoadingMore ? "Загружаем…" : "Показать ещё";

    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    /// <summary>Форма создания/правки операции; null — оверлей скрыт.</summary>
    public TicketAdminFinOpFormViewModel? Form
    {
        get => _form;
        internal set
        {
            if (_form is not null)
            {
                _form.Saved -= Form_Saved;
                _form.Closed -= Form_Closed;
            }

            if (SetProperty(ref _form, value) && value is not null)
            {
                value.Saved += Form_Saved;
                value.Closed += Form_Closed;
            }
        }
    }

    public ICommand ApplyFiltersCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand NewOpCommand { get; }
    public ICommand EditOpCommand { get; }
    public ICommand DeleteOpCommand { get; }

    internal async Task LoadSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            await _owner.LoadObjectsRawAsync(force: false, cancellationToken);
            SyncObjectOptions();
            var page = await _owner.Api.GetTicketFinancialOpsAsync(BuildQuery(1), cancellationToken);
            Items.Clear();
            ApplyPage(page, 1);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            var next = _currentPage + 1;
            var page = await _owner.Api.GetTicketFinancialOpsAsync(BuildQuery(next), cancellationToken);
            ApplyPage(page, next);
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    private HubTicketFinOpQuery BuildQuery(int page) => new()
    {
        Page = page,
        PageSize = PageSize,
        OpType = OpTypeFilter?.Value,
        ObjectId = ObjectFilter?.Id,
        DateFrom = DateFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTo = DateTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        IncludeDeleted = IncludeDeleted,
    };

    private void ApplyPage(HubTicketFinancialOpPage page, int requestedPage)
    {
        _currentPage = page.Page > 0 ? page.Page : requestedPage;
        _totalPages = page.TotalPages;
        HasMore = _currentPage < _totalPages;
        foreach (var op in page.Items ?? [])
        {
            Items.Add(new TicketAdminFinOpItemViewModel(op));
        }

        TotalText = page.Total.ToString(CultureInfo.CurrentCulture);
    }

    private void SyncObjectOptions()
    {
        var selectedId = ObjectFilter?.Id;
        ObjectOptions.Clear();
        ObjectOptions.Add(TicketAdminObjectOption.All);
        foreach (var option in _owner.ObjectOptions)
        {
            ObjectOptions.Add(option);
        }

        ObjectFilter = ObjectOptions.FirstOrDefault(option => option.Id == selectedId)
            ?? TicketAdminObjectOption.All;
    }

    private Task<HubTicketFinancialOp> SaveNewAsync(
        HubTicketFinancialOpUpsert upsert,
        CancellationToken cancellationToken) =>
        _owner.Api.CreateTicketFinancialOpAsync(upsert, cancellationToken);

    private Task<HubTicketFinancialOp> SaveExistingAsync(
        TicketAdminFinOpItemViewModel item,
        HubTicketFinancialOpUpsert upsert) =>
        _owner.Api.UpdateTicketFinancialOpAsync(item.Id, upsert, CancellationToken.None);

    private void Form_Saved(object? sender, HubTicketFinancialOp saved)
    {
        var existing = Items.FirstOrDefault(item => item.Id == saved.Id);
        if (existing is not null)
        {
            existing.Apply(saved);
        }
        else
        {
            Items.Insert(0, new TicketAdminFinOpItemViewModel(saved));
        }

        Form = null;
        _owner.InfoText = "Операция сохранена.";
    }

    private void Form_Closed(object? sender, EventArgs e)
    {
        Form = null;
    }

    /// <summary>Armed-удаление: первый клик — подтверждение, второй — DELETE + снятие строки.</summary>
    private async Task DeleteAsync(TicketAdminFinOpItemViewModel? item, CancellationToken cancellationToken)
    {
        if (item is null || item.IsDeleteBusy)
        {
            return;
        }

        if (!item.DeleteArmed)
        {
            if (_armedDelete is { } previous && !ReferenceEquals(previous, item))
            {
                previous.DeleteArmed = false;
            }

            _armedDelete = item;
            item.DeleteArmed = true;
            return;
        }

        item.DeleteArmed = false;
        _armedDelete = null;
        item.IsDeleteBusy = true;
        try
        {
            await _owner.Api.DeleteTicketFinancialOpAsync(item.Id, cancellationToken);
            Items.Remove(item);
            _owner.InfoText = $"Операция №{item.Id.ToString(CultureInfo.InvariantCulture)} удалена.";
        }
        finally
        {
            item.IsDeleteBusy = false;
        }
    }
}

// ============================ Отчёт потерь ============================

/// <summary>Строка отчёта потерь: дата, ФИО, объект, тип, сумма, причина, статус.</summary>
public sealed class TicketAdminLossItemViewModel
{
    public TicketAdminLossItemViewModel(HubTicketLossItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var date = TicketFormat.FormatDate(item.OpDate);
        DateText = date.Length > 0 ? date : "—";
        EmployeeText = string.IsNullOrWhiteSpace(item.EmployeeName) ? "—" : item.EmployeeName!.Trim();
        ObjectText = string.IsNullOrWhiteSpace(item.ObjectName) ? "—" : item.ObjectName!.Trim();
        TypeText = string.IsNullOrWhiteSpace(item.OpTypeLabel)
            ? TicketAdminCatalog.FinOpLabelOf(item.OpType)
            : item.OpTypeLabel!.Trim();
        AmountText = TicketFormat.FormatMoney(item.Amount);
        ReasonText = string.IsNullOrWhiteSpace(item.Reason) ? "—" : item.Reason!.Trim();
        StatusText = string.IsNullOrWhiteSpace(item.RefundStatus) ? "—" : item.RefundStatus!.Trim();
    }

    public string DateText { get; }
    public string EmployeeText { get; }
    public string ObjectText { get; }
    public string TypeText { get; }
    public string AmountText { get; }
    public string ReasonText { get; }
    public string StatusText { get; }
}

/// <summary>
/// Вкладка «Потери»: отчёт GET /tickets/reports/losses с фильтрами периода/объекта/типа,
/// сводка totals, экспорт xlsx через SaveFileDialog; рядом — экспорт заявок
/// текущего списка (фильтры родителя).
/// </summary>
public sealed class TicketAdminLossesViewModel : ObservableObject
{
    private const int PageSize = 50;

    private readonly TicketAdminViewModel _owner;
    private TicketStatusOption? _opTypeFilter = TicketAdminCatalog.FinOpFilterOptions[0];
    private TicketAdminObjectOption? _objectFilter = TicketAdminObjectOption.All;
    private DateTime? _dateFrom;
    private DateTime? _dateTo;
    private bool _isLoading;
    private bool _isExporting;
    private string _totalLossesText = string.Empty;
    private string _totalRefundsText = string.Empty;
    private string _balanceText = string.Empty;
    private string _totalText = string.Empty;

    public TicketAdminLossesViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        ApplyFiltersCommand = new NativeAsyncCommand(
            (_, ct) => LoadSafelyAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex));
        ExportLossesCommand = new NativeAsyncCommand(
            (_, ct) => ExportAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => _owner.CanWrite && !IsExporting);
        ExportRequestsCommand = new NativeAsyncCommand(
            (_, ct) => ExportRequestsAsync(ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            _ => _owner.CanWrite && !IsExporting);
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));
        ObjectOptions.Add(TicketAdminObjectOption.All);
    }

    public ObservableCollection<TicketAdminLossItemViewModel> Items { get; } = [];

    /// <summary>Фильтр объекта: «Все объекты» + справочник из owner.</summary>
    public ObservableCollection<TicketAdminObjectOption> ObjectOptions { get; } = [];

    public IReadOnlyList<TicketStatusOption> OpTypeFilterOptions => TicketAdminCatalog.FinOpFilterOptions;

    public TicketStatusOption? OpTypeFilter
    {
        get => _opTypeFilter;
        set => SetProperty(ref _opTypeFilter, value);
    }

    public TicketAdminObjectOption? ObjectFilter
    {
        get => _objectFilter;
        set => SetProperty(ref _objectFilter, value);
    }

    public DateTime? DateFrom
    {
        get => _dateFrom;
        set => SetProperty(ref _dateFrom, value);
    }

    public DateTime? DateTo
    {
        get => _dateTo;
        set => SetProperty(ref _dateTo, value);
    }

    public bool IsEmpty => Items.Count == 0 && !IsLoading;

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    public bool IsExporting
    {
        get => _isExporting;
        private set
        {
            if (SetProperty(ref _isExporting, value))
            {
                ((NativeAsyncCommand)ExportLossesCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)ExportRequestsCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Итоги отчёта: потери / возвраты / баланс (карточки сверху, как в вебе).</summary>
    public string TotalLossesText
    {
        get => _totalLossesText;
        private set => SetProperty(ref _totalLossesText, value);
    }

    public string TotalRefundsText
    {
        get => _totalRefundsText;
        private set => SetProperty(ref _totalRefundsText, value);
    }

    public string BalanceText
    {
        get => _balanceText;
        private set => SetProperty(ref _balanceText, value);
    }

    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    public ICommand ApplyFiltersCommand { get; }
    public ICommand ExportLossesCommand { get; }
    public ICommand ExportRequestsCommand { get; }

    internal async Task LoadSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            await _owner.LoadObjectsRawAsync(force: false, cancellationToken);
            SyncObjectOptions();
            var report = await _owner.Api.GetTicketLossesReportAsync(BuildQuery(), cancellationToken);
            Items.Clear();
            foreach (var item in report.Items ?? [])
            {
                Items.Add(new TicketAdminLossItemViewModel(item));
            }

            TotalLossesText = TicketFormat.FormatMoney(report.Totals?.TotalLosses);
            TotalRefundsText = TicketFormat.FormatMoney(report.Totals?.TotalRefunds);
            BalanceText = TicketFormat.FormatMoney(report.Totals?.Balance);
            TotalText = (report.Pagination?.Total ?? Items.Count).ToString(CultureInfo.CurrentCulture);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    private HubTicketLossesQuery BuildQuery() => new()
    {
        Page = 1,
        PageSize = PageSize,
        DateFrom = DateFrom?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        DateTo = DateTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
        ObjectId = ObjectFilter?.Id,
        OpType = OpTypeFilter?.Value,
    };

    private void SyncObjectOptions()
    {
        var selectedId = ObjectFilter?.Id;
        ObjectOptions.Clear();
        ObjectOptions.Add(TicketAdminObjectOption.All);
        foreach (var option in _owner.ObjectOptions)
        {
            ObjectOptions.Add(option);
        }

        ObjectFilter = ObjectOptions.FirstOrDefault(option => option.Id == selectedId)
            ?? TicketAdminObjectOption.All;
    }

    /// <summary>«Экспорт»: SaveFileDialog → GET /tickets/reports/losses/export в файл.</summary>
    private async Task ExportAsync(CancellationToken cancellationToken)
    {
        var path = _owner.SaveFilePicker?.Invoke("ticket-losses.xlsx");
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        IsExporting = true;
        try
        {
            await using var stream = new FileStream(
                path, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
            var name = await _owner.Api.ExportTicketLossesAsync(BuildQuery(), stream, cancellationToken);
            _owner.InfoText = $"Отчёт потерь сохранён: {(name.Length > 0 ? name : Path.GetFileName(path))}.";
        }
        finally
        {
            IsExporting = false;
        }
    }

    /// <summary>«Экспорт заявок»: xlsx текущего списка с фильтрами родителя.</summary>
    private async Task ExportRequestsAsync(CancellationToken cancellationToken)
    {
        var path = _owner.SaveFilePicker?.Invoke("ticket-requests.xlsx");
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        IsExporting = true;
        try
        {
            await using var stream = new FileStream(
                path, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
            var name = await _owner.Api.ExportTicketRequestsAsync(
                _owner.BuildRequestsQuery(), stream, cancellationToken);
            _owner.InfoText = $"Заявки сохранены: {(name.Length > 0 ? name : Path.GetFileName(path))}.";
        }
        finally
        {
            IsExporting = false;
        }
    }
}

// ============================ Уведомления ============================

/// <summary>
/// Правило SLA-уведомлений: подпись по rule_type, вкл/выкл (PATCH is_enabled),
/// порог в днях (PATCH threshold_days). Правка — только admin, как в веб-таблице.
/// </summary>
public sealed class TicketAdminRuleViewModel : ObservableObject
{
    private bool _isBusy;
    private string _thresholdText;

    public TicketAdminRuleViewModel(HubTicketNotificationRule rule)
    {
        ArgumentNullException.ThrowIfNull(rule);
        Id = rule.Id;
        RuleType = (rule.RuleType ?? string.Empty).Trim();
        Label = TicketAdminCatalog.RuleLabelOf(rule.RuleType);
        if (Label.Length == 0)
        {
            Label = $"Правило {rule.Id.ToString(CultureInfo.InvariantCulture)}";
        }

        IsEnabled = rule.IsEnabled;
        _thresholdText = rule.ThresholdDays?.ToString(CultureInfo.InvariantCulture) ?? string.Empty;
        RolesText = string.IsNullOrWhiteSpace(rule.NotifyRoles) ? "—" : rule.NotifyRoles!.Trim();
    }

    public long Id { get; }
    public string RuleType { get; }
    public string Label { get; }

    /// <summary>Текущее состояние правила; переключатель биндится OneWay + команда.</summary>
    public bool IsEnabled
    {
        get => _isEnabled;
        private set => SetProperty(ref _isEnabled, value);
    }

    private bool _isEnabled;
    public string RolesText { get; }

    /// <summary>Порог в днях (0–365); пустое поле — threshold_days=null уходит нетронутым.</summary>
    public string ThresholdText
    {
        get => _thresholdText;
        set => SetProperty(ref _thresholdText, value ?? string.Empty);
    }

    /// <summary>PATCH правила в полёте — переключатель и ввод порога на паузе.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        internal set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(IsEditEnabled));
            }
        }
    }

    /// <summary>Переключатель «Включено» при веб-перевороте: IsEnabled инвертируем командой.</summary>
    public bool IsEditEnabled => !IsBusy;

    internal void Apply(HubTicketNotificationRule rule)
    {
        IsEnabled = rule.IsEnabled;
        if (rule.ThresholdDays is { } threshold)
        {
            ThresholdText = threshold.ToString(CultureInfo.InvariantCulture);
        }
    }
}

/// <summary>Отложенное SLA-уведомление: severity-плашка, текст, кнопка «Скрыть».</summary>
public sealed class TicketAdminPendingNotificationViewModel
{
    public TicketAdminPendingNotificationViewModel(HubTicketPendingNotification item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id ?? string.Empty;
        RuleTypeText = TicketAdminCatalog.RuleLabelOf(item.RuleType);
        Title = (item.Title ?? string.Empty).Trim();
        Message = (item.Message ?? string.Empty).Trim();
        Severity = (item.Severity ?? string.Empty).Trim();
        SeverityTone = Severity == "critical" ? HubStatusTone.Danger : HubStatusTone.Warning;
        CreatedText = TicketFormat.FormatDateTime(item.CreatedAt);
        RefText = string.Join(
            " · ",
            new[]
            {
                item.RequestId is { } requestId ? $"Заявка №{requestId.ToString(CultureInfo.InvariantCulture)}" : null,
                item.FinancialOpId is { } opId ? $"Операция №{opId.ToString(CultureInfo.InvariantCulture)}" : null,
            }.Where(part => part is not null));
    }

    public string Id { get; }
    public string RuleTypeText { get; }
    public string Title { get; }
    public string Message { get; }
    public string Severity { get; }
    public string SeverityTone { get; }
    public string CreatedText { get; }
    public string RefText { get; }
}

/// <summary>
/// Вкладка «Уведомления»: правила SLA (вкл/порог — admin) и отложенные
/// уведомления с кнопкой «Скрыть» (dismiss), как TicketNotifications веба.
/// </summary>
public sealed class TicketAdminNotificationsViewModel : ObservableObject
{
    private readonly TicketAdminViewModel _owner;
    private bool _isLoading;

    public TicketAdminNotificationsViewModel(TicketAdminViewModel owner)
    {
        _owner = owner;
        ToggleRuleCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleRuleAsync(parameter as TicketAdminRuleViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            parameter => _owner.IsAdmin && parameter is TicketAdminRuleViewModel { IsBusy: false });
        SaveThresholdCommand = new NativeAsyncCommand(
            (parameter, ct) => SaveThresholdAsync(parameter as TicketAdminRuleViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            parameter => _owner.IsAdmin && parameter is TicketAdminRuleViewModel { IsBusy: false });
        DismissCommand = new NativeAsyncCommand(
            (parameter, ct) => DismissAsync(parameter as TicketAdminPendingNotificationViewModel, ct),
            ex => _owner.ErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is TicketAdminPendingNotificationViewModel);
        Rules.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasRules));
        Pending.CollectionChanged += (_, _) => OnPropertyChanged(nameof(ShowPendingEmpty));
    }

    public ObservableCollection<TicketAdminRuleViewModel> Rules { get; } = [];
    public ObservableCollection<TicketAdminPendingNotificationViewModel> Pending { get; } = [];

    public bool HasRules => Rules.Count > 0;
    public bool ShowPendingEmpty => Pending.Count == 0 && !IsLoading;

    /// <summary>Правка правил — только admin (fail-closed, как веб-таблица).</summary>
    public bool CanEditRules => _owner.IsAdmin;

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(ShowPendingEmpty));
            }
        }
    }

    public ICommand ToggleRuleCommand { get; }
    public ICommand SaveThresholdCommand { get; }
    public ICommand DismissCommand { get; }

    internal async Task LoadSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            // GET /pending — tickets.read, GET /rules — tickets.write (уже отгейтовано входом).
            var pendingTask = _owner.Api.GetTicketPendingNotificationsAsync(cancellationToken);
            var rules = await _owner.Api.GetTicketNotificationRulesAsync(cancellationToken);
            var pending = await pendingTask;
            Rules.Clear();
            foreach (var rule in rules.Items ?? [])
            {
                Rules.Add(new TicketAdminRuleViewModel(rule));
            }

            Pending.Clear();
            foreach (var item in pending.Items ?? [])
            {
                Pending.Add(new TicketAdminPendingNotificationViewModel(item));
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            _owner.ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Переключатель: PATCH {is_enabled} и применить ответ к строке.</summary>
    private async Task ToggleRuleAsync(TicketAdminRuleViewModel? rule, CancellationToken cancellationToken)
    {
        if (rule is null || rule.IsBusy)
        {
            return;
        }

        rule.IsBusy = true;
        try
        {
            var updated = await _owner.Api.UpdateTicketNotificationRuleAsync(
                rule.Id,
                new HubTicketNotificationRulePatch { IsEnabled = !rule.IsEnabled },
                cancellationToken);
            rule.Apply(updated);
        }
        finally
        {
            rule.IsBusy = false;
        }
    }

    /// <summary>«Сохранить» порог: PATCH {threshold_days}; пустое поле — ошибка валидации.</summary>
    private async Task SaveThresholdAsync(TicketAdminRuleViewModel? rule, CancellationToken cancellationToken)
    {
        if (rule is null || rule.IsBusy)
        {
            return;
        }

        var text = rule.ThresholdText.Trim();
        if (text.Length == 0)
        {
            _owner.ErrorText = "Укажите порог в днях для правила.";
            return;
        }

        if (!int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var days)
            || days < 0 || days > 365)
        {
            _owner.ErrorText = "Порог должен быть числом от 0 до 365.";
            return;
        }

        rule.IsBusy = true;
        try
        {
            var updated = await _owner.Api.UpdateTicketNotificationRuleAsync(
                rule.Id,
                new HubTicketNotificationRulePatch { ThresholdDays = days },
                cancellationToken);
            rule.Apply(updated);
        }
        finally
        {
            rule.IsBusy = false;
        }
    }

    /// <summary>«Скрыть»: POST …/dismiss и локальное снятие плашки.</summary>
    private async Task DismissAsync(
        TicketAdminPendingNotificationViewModel? item,
        CancellationToken cancellationToken)
    {
        if (item is null || item.Id.Length == 0)
        {
            return;
        }

        await _owner.Api.DismissTicketNotificationAsync(item.Id, cancellationToken);
        Pending.Remove(item);
    }
}

// ============================ Корень админки ============================

/// <summary>
/// Панель «Управление» билетов (режим admin нативной страницы): вкладки
/// Объекты | Сотрудники | Импорт | Финоперации | Потери | Уведомления.
/// Открывается при tickets.write/admin (как в вебе), админские операции
/// дополнительно отгейтованы IsAdmin. Каждая вкладка лениво грузит свои данные
/// при активации и умеет «Обновить» корневой командой.
/// </summary>
public sealed class TicketAdminViewModel : ObservableObject
{
    internal const string TabObjects = "objects";
    internal const string TabEmployees = "employees";
    internal const string TabImport = "import";
    internal const string TabFinOps = "finops";
    internal const string TabLosses = "losses";
    internal const string TabNotifications = "notifications";

    private readonly IHubApiClient _api;
    private readonly Func<HubTicketQuery>? _requestsQueryFactory;
    private IReadOnlyList<HubTicketObject> _objectsRaw = [];
    private bool _objectOptionsLoaded;
    private string _tab = TabObjects;
    private bool _canWrite;
    private bool _isAdmin;
    private bool _canReadPersonal;
    private string? _errorText;
    private string? _infoText;

    public TicketAdminViewModel(IHubApiClient api, Func<HubTicketQuery>? requestsQueryFactory = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _requestsQueryFactory = requestsQueryFactory;
        Objects = new TicketAdminObjectsViewModel(this);
        Employees = new TicketAdminEmployeesViewModel(this);
        Import = new TicketAdminImportViewModel(this);
        FinOps = new TicketAdminFinOpsViewModel(this);
        Losses = new TicketAdminLossesViewModel(this);
        Notifications = new TicketAdminNotificationsViewModel(this);
        SelectTabCommand = new NativeRelayCommand(
            parameter => SelectedTab = parameter as string ?? TabObjects);
        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadActiveTabSafelyAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex));
        DismissErrorCommand = new NativeRelayCommand(() => ErrorText = null);
        DismissInfoCommand = new NativeRelayCommand(() => InfoText = null);
    }

    // ---- Вкладки ----

    public TicketAdminObjectsViewModel Objects { get; }
    public TicketAdminEmployeesViewModel Employees { get; }
    public TicketAdminImportViewModel Import { get; }
    public TicketAdminFinOpsViewModel FinOps { get; }
    public TicketAdminLossesViewModel Losses { get; }
    public TicketAdminNotificationsViewModel Notifications { get; }

    /// <summary>Текущая вкладка: objects|employees|import|finops|losses|notifications.</summary>
    public string SelectedTab
    {
        get => _tab;
        private set
        {
            var normalized = value is TabEmployees or TabImport or TabFinOps or TabLosses or TabNotifications
                ? value
                : TabObjects;
            if (SetProperty(ref _tab, normalized))
            {
                OnPropertyChanged(nameof(IsObjectsTab));
                OnPropertyChanged(nameof(IsEmployeesTab));
                OnPropertyChanged(nameof(IsImportTab));
                OnPropertyChanged(nameof(IsFinOpsTab));
                OnPropertyChanged(nameof(IsLossesTab));
                OnPropertyChanged(nameof(IsNotificationsTab));
                // Вкладки оперативные — при активации перечитываются (как mount в вебе).
                _ = LoadActiveTabSafelyAsync(CancellationToken.None);
            }
        }
    }

    // TwoWay IsChecked на чипах вкладок: сеттеры для write-back SelectionItemPattern.
    public bool IsObjectsTab
    {
        get => _tab == TabObjects;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabObjects);
            }
        }
    }

    public bool IsEmployeesTab
    {
        get => _tab == TabEmployees;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabEmployees);
            }
        }
    }

    public bool IsImportTab
    {
        get => _tab == TabImport;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabImport);
            }
        }
    }

    public bool IsFinOpsTab
    {
        get => _tab == TabFinOps;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabFinOps);
            }
        }
    }

    public bool IsLossesTab
    {
        get => _tab == TabLosses;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabLosses);
            }
        }
    }

    public bool IsNotificationsTab
    {
        get => _tab == TabNotifications;
        set
        {
            if (value)
            {
                SelectTabCommand.Execute(TabNotifications);
            }
        }
    }

    // ---- Права (проставляет родитель после /auth/me) ----

    /// <summary>tickets.write или admin — вход в панель уже проверен родителем.</summary>
    public bool CanWrite
    {
        get => _canWrite;
        private set => SetProperty(ref _canWrite, value);
    }

    /// <summary>Роль admin — создание/вкл-откл объектов и правка правил (fail-closed).</summary>
    public bool IsAdmin
    {
        get => _isAdmin;
        private set => SetProperty(ref _isAdmin, value);
    }

    /// <summary>tickets.personal_data.read — паспортный блок карточки сотрудника.</summary>
    public bool CanReadPersonal
    {
        get => _canReadPersonal;
        private set => SetProperty(ref _canReadPersonal, value);
    }

    /// <summary>Матрица прав из /auth/me родителя: один вызов на открытие панели.</summary>
    internal void ConfigurePermissions(bool canWrite, bool isAdmin, bool canReadPersonal)
    {
        CanWrite = canWrite;
        CanReadPersonal = canReadPersonal;
        IsAdmin = isAdmin;
    }

    // ---- Общие состояния ----

    /// <summary>Баннер ошибки админки (внутри панели, не трогает список заявок).</summary>
    public string? ErrorText
    {
        get => _errorText;
        internal set
        {
            if (SetProperty(ref _errorText, value))
            {
                OnPropertyChanged(nameof(HasError));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    /// <summary>Зелёная плашка результата (сохранено/импортировано/экспортировано).</summary>
    public string? InfoText
    {
        get => _infoText;
        internal set
        {
            if (SetProperty(ref _infoText, value))
            {
                OnPropertyChanged(nameof(HasInfo));
            }
        }
    }

    public bool HasInfo => !string.IsNullOrEmpty(InfoText);

    /// <summary>Справочник объектов для фильтров/форм вкладок (id+имя).</summary>
    public ObservableCollection<TicketAdminObjectOption> ObjectOptions { get; } = [];

    internal IHubApiClient Api => _api;

    /// <summary>Шов выбора .xlsx для импорта: view ставит OpenFileDialog, тесты — заглушку.</summary>
    public Func<string?>? ImportFilePicker { get; set; }

    /// <summary>Шов SaveFileDialog экспорта: аргумент — имя по умолчанию, возврат — путь.</summary>
    public Func<string, string?>? SaveFilePicker { get; set; }

    /// <summary>Шов задержки debounce поисков: тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    public ICommand SelectTabCommand { get; }
    public ICommand RefreshCommand { get; }
    public ICommand DismissErrorCommand { get; }
    public ICommand DismissInfoCommand { get; }

    /// <summary>Загрузка/обновление активной вкладки («Обновить» и вход в режим admin).</summary>
    internal Task LoadActiveTabSafelyAsync(CancellationToken cancellationToken) =>
        _tab switch
        {
            TabEmployees => Employees.LoadSafelyAsync(cancellationToken),
            TabImport => Import.PrepareAsync(cancellationToken),
            TabFinOps => FinOps.LoadSafelyAsync(cancellationToken),
            TabLosses => Losses.LoadSafelyAsync(cancellationToken),
            TabNotifications => Notifications.LoadSafelyAsync(cancellationToken),
            _ => Objects.LoadSafelyAsync(cancellationToken),
        };

    /// <summary>
    /// GET /tickets/objects?include_inactive=true — справочник целиком для
    /// вкладки «Объекты» и для опций фильтров/форм остальных вкладок.
    /// </summary>
    internal async Task<IReadOnlyList<HubTicketObject>> LoadObjectsRawAsync(
        bool force,
        CancellationToken cancellationToken)
    {
        if (_objectOptionsLoaded && !force)
        {
            return _objectsRaw;
        }

        var list = await _api.GetTicketObjectsAsync(includeInactive: true, cancellationToken);
        _objectsRaw = list.Items ?? [];
        _objectOptionsLoaded = true;
        RebuildObjectOptions();
        return _objectsRaw;
    }

    /// <summary>После сохранения объекта опции фильтров/форм подхватывают его без перечитывания.</summary>
    internal void SyncObjectOptions(HubTicketObject changed)
    {
        var name = OptionName(changed);
        var existing = ObjectOptions.FirstOrDefault(option => option.Id == changed.Id);
        if (existing is not null && !string.Equals(existing.Name, name, StringComparison.Ordinal))
        {
            var index = ObjectOptions.IndexOf(existing);
            ObjectOptions[index] = new TicketAdminObjectOption(changed.Id, name);
        }
        else if (existing is null)
        {
            ObjectOptions.Add(new TicketAdminObjectOption(changed.Id, name));
        }
    }

    /// <summary>Запрос экспорта заявок — текущие фильтры родительского списка.</summary>
    internal HubTicketQuery BuildRequestsQuery() =>
        _requestsQueryFactory?.Invoke()
        ?? new HubTicketQuery
        {
            Page = 1,
            PageSize = 25,
            SortField = "submitted_at",
            SortDir = "desc",
        };

    private void RebuildObjectOptions()
    {
        ObjectOptions.Clear();
        foreach (var item in _objectsRaw)
        {
            ObjectOptions.Add(new TicketAdminObjectOption(item.Id, OptionName(item)));
        }
    }

    private static string OptionName(HubTicketObject item)
    {
        var name = (item.Name ?? string.Empty).Trim();
        if (name.Length > 0)
        {
            return name;
        }

        var code = (item.Code ?? string.Empty).Trim();
        return code.Length > 0 ? code : $"Объект {item.Id.ToString(CultureInfo.InvariantCulture)}";
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    internal void Reset()
    {
        _objectsRaw = [];
        _objectOptionsLoaded = false;
        ObjectOptions.Clear();
        ErrorText = null;
        InfoText = null;
        _tab = TabObjects;
        OnPropertyChanged(nameof(SelectedTab));
        OnPropertyChanged(nameof(IsObjectsTab));
        OnPropertyChanged(nameof(IsEmployeesTab));
        OnPropertyChanged(nameof(IsImportTab));
        OnPropertyChanged(nameof(IsFinOpsTab));
        OnPropertyChanged(nameof(IsLossesTab));
        OnPropertyChanged(nameof(IsNotificationsTab));
        Objects.Items.Clear();
        Objects.Form = null;
        Employees.Items.Clear();
        Employees.ZupOptions.Clear();
        Employees.Form = null;
        Import.Reset();
        FinOps.Items.Clear();
        FinOps.Form = null;
        Losses.Items.Clear();
        Notifications.Rules.Clear();
        Notifications.Pending.Clear();
        _canWrite = false;
        _isAdmin = false;
        _canReadPersonal = false;
        OnPropertyChanged(nameof(CanWrite));
        OnPropertyChanged(nameof(IsAdmin));
        OnPropertyChanged(nameof(CanReadPersonal));
    }
}
