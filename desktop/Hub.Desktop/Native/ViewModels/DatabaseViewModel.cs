using System.Collections.ObjectModel;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Формат инвентарного номера ITINVENT: в базе INV_NO — float, поэтому
/// целые значения печатаем без дробной части (100234 вместо 100234.0).
/// </summary>
internal static class EquipmentCatalog
{
    /// <summary>Отображение инв. номера: целые — «123», дробные — «123.45».</summary>
    public static string FormatInvNo(double? invNo)
    {
        if (invNo is null)
        {
            return string.Empty;
        }

        var value = invNo.Value;
        return value == Math.Floor(value) && Math.Abs(value) < 1e15
            ? value.ToString("0", CultureInfo.InvariantCulture)
            : value.ToString("0.####", CultureInfo.InvariantCulture);
    }

    /// <summary>Инв. номер как параметр /equipment/{inv_no} (сервер приводит float()).</summary>
    public static string? InvNoParameter(double? invNo)
    {
        var text = FormatInvNo(invNo);
        return text.Length > 0 ? text : null;
    }
}

/// <summary>
/// Строка выдачи «База»: модель/тип, серийный и инвентарный номера,
/// сотрудник, филиал/локация, статус — как строка EquipmentTable в вебе.
/// </summary>
public sealed class EquipmentItemViewModel
{
    public EquipmentItemViewModel(HubEquipmentItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id;
        InvNo = item.InvNo;
        InvNoText = EquipmentCatalog.FormatInvNo(item.InvNo);
        Title = !string.IsNullOrWhiteSpace(item.ModelName)
            ? item.ModelName!.Trim()
            : !string.IsNullOrWhiteSpace(item.TypeName)
                ? item.TypeName!.Trim()
                : "Оборудование";
        TypeText = item.TypeName?.Trim() ?? string.Empty;
        VendorText = item.VendorName?.Trim() ?? string.Empty;
        SerialText = FirstNonEmpty(item.SerialNo, item.HwSerialNo) ?? string.Empty;
        PartNoText = item.PartNo?.Trim() ?? string.Empty;
        EmployeeText = string.Join(
            " · ",
            new[] { item.EmployeeName, item.EmployeeDept }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        PlaceText = string.Join(
            " · ",
            new[] { item.BranchName, item.LocationName, item.Location }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim())
                .Distinct());
        StatusText = FirstNonEmpty(item.StatusName, item.Status) ?? string.Empty;
    }

    /// <summary>ID записи — ключ запроса метаданных фото (/equipment/{id}/photos).</summary>
    public long? Id { get; }

    /// <summary>INV_NO как число — ключ запроса карточки (/equipment/{inv_no}).</summary>
    public double? InvNo { get; }
    public string InvNoText { get; }
    public string Title { get; }
    public string TypeText { get; }
    public string VendorText { get; }
    public string SerialText { get; }
    public string PartNoText { get; }
    public string EmployeeText { get; }
    public string PlaceText { get; }
    public string StatusText { get; }

    public bool HasType => TypeText.Length > 0;
    public bool HasVendor => VendorText.Length > 0;
    public bool HasSerial => SerialText.Length > 0;
    public bool HasInvNo => InvNoText.Length > 0;
    public bool HasPartNo => PartNoText.Length > 0;
    public bool HasEmployee => EmployeeText.Length > 0;
    public bool HasPlace => PlaceText.Length > 0;
    public bool HasStatus => StatusText.Length > 0;

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();
}

/// <summary>
/// Карточка оборудования (GET /equipment/{inv_no}): тип/модель/производитель,
/// номера, сотрудник и место, статус, сеть и описание — read-проекция
/// карточки веб-страницы Database.
/// </summary>
public sealed class EquipmentDetailViewModel
{
    public EquipmentDetailViewModel(HubEquipmentItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        InvNoText = EquipmentCatalog.FormatInvNo(item.InvNo);
        Title = !string.IsNullOrWhiteSpace(item.ModelName)
            ? item.ModelName!.Trim()
            : !string.IsNullOrWhiteSpace(item.TypeName)
                ? item.TypeName!.Trim()
                : "Оборудование";
        HeroMetaText = string.Join(
            " · ",
            new[] { item.TypeName, item.VendorName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));

        // ---- Номера ----
        TypeText = OrDash(item.TypeName);
        ModelText = OrDash(item.ModelName);
        VendorText = OrDash(item.VendorName);
        SerialText = OrDash(FirstNonEmpty(item.SerialNo, item.HwSerialNo));
        HwSerialText = OrDash(item.HwSerialNo);
        PartNoText = OrDash(item.PartNo);
        StatusText = OrDash(FirstNonEmpty(item.Status, item.StatusName));

        // ---- Сотрудник и место ----
        EmployeeText = OrDash(item.EmployeeName);
        EmployeeDeptText = OrDash(item.EmployeeDept);
        EmployeeEmailText = OrDash(item.EmployeeEmail);
        BranchText = OrDash(item.BranchName);
        LocationText = OrDash(FirstNonEmpty(item.Location, item.LocationName));

        // ---- Сеть и описание ----
        IpText = OrDash(item.IpAddress);
        MacText = OrDash(item.MacAddress);
        NetworkNameText = OrDash(item.NetworkName);
        DomainText = OrDash(item.DomainName);
        DescriptionText = item.Description?.Trim() ?? string.Empty;
        DateCreateText = OrDash(item.DateCreate);
        DateModifiedText = OrDash(item.DateLastModify);
    }

    public string InvNoText { get; }
    public string Title { get; }
    public string HeroMetaText { get; }
    public string TypeText { get; }
    public string ModelText { get; }
    public string VendorText { get; }
    public string SerialText { get; }
    public string HwSerialText { get; }
    public string PartNoText { get; }
    public string StatusText { get; }
    public string EmployeeText { get; }
    public string EmployeeDeptText { get; }
    public string EmployeeEmailText { get; }
    public string BranchText { get; }
    public string LocationText { get; }
    public string IpText { get; }
    public string MacText { get; }
    public string NetworkNameText { get; }
    public string DomainText { get; }
    public string DescriptionText { get; }
    public string DateCreateText { get; }
    public string DateModifiedText { get; }

    public bool HasHeroMeta => HeroMetaText.Length > 0;
    public bool HasInvNo => InvNoText.Length > 0;
    public bool HasDescription => DescriptionText.Length > 0;

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();

    private static string OrDash(string? value)
        => string.IsNullOrWhiteSpace(value) ? "—" : value.Trim();
}

/// <summary>Опция фильтра поля поиска (Value=null — «везде»).</summary>
public sealed class EquipmentFieldFilterItem
{
    public EquipmentFieldFilterItem(string? value, string label)
    {
        Value = value;
        Label = label;
    }

    public string? Value { get; }
    public string Label { get; }
}

/// <summary>Опция фильтра типа оборудования (TypeNo=null — «все типы»).</summary>
public sealed class EquipmentTypeFilterItem
{
    public EquipmentTypeFilterItem(int? typeNo, string label)
    {
        TypeNo = typeNo;
        Label = label;
    }

    public int? TypeNo { get; }
    public string Label { get; }
}

// ---- Диалог передачи оборудования ----

/// <summary>Подсказка сотрудника в диалоге передачи (строка search/employee).</summary>
public sealed class TransferEmployeeOption
{
    public TransferEmployeeOption(HubEquipmentEmployee employee)
    {
        ArgumentNullException.ThrowIfNull(employee);
        OwnerNo = employee.OwnerNo;
        Title = (employee.Name ?? string.Empty).Trim();
        var meta = new List<string>();
        if (!string.IsNullOrWhiteSpace(employee.Department))
        {
            meta.Add(employee.Department!.Trim());
        }

        if (employee.EquipmentCount > 0)
        {
            meta.Add($"техники: {employee.EquipmentCount}");
        }

        MetaText = string.Join(" · ", meta);
    }

    /// <summary>OWNER_NO — уходит в new_employee_no при наличии.</summary>
    public long? OwnerNo { get; }
    public string Title { get; }
    public string MetaText { get; }
}

/// <summary>Опция филиала диалога передачи: Id — сырой BRANCH_NO (int|str).</summary>
public sealed class TransferBranchOption
{
    public TransferBranchOption(HubEquipmentBranch branch)
    {
        ArgumentNullException.ThrowIfNull(branch);
        Id = branch.Id;
        Name = (branch.Name ?? string.Empty).Trim();
    }

    /// <summary>«— не менять —»: филиал/локация опциональны, без выбора не шлём.</summary>
    internal static readonly TransferBranchOption None = new(new HubEquipmentBranch { Name = "— не менять —" });

    public System.Text.Json.JsonElement? Id { get; }
    public string Name { get; }

    /// <summary>BRANCH_NO как строка — параметр /equipment/locations/{branch}.</summary>
    public string IdText => Id?.ToString() ?? string.Empty;
}

/// <summary>Опция локации диалога передачи: LocNo — сырой LOC_NO (int|str).</summary>
public sealed class TransferLocationOption
{
    public TransferLocationOption(HubEquipmentLocation location)
    {
        ArgumentNullException.ThrowIfNull(location);
        LocNo = location.LocNo;
        Name = (location.LocName ?? string.Empty).Trim();
    }

    /// <summary>«— не менять —» — первая строка списка локаций.</summary>
    internal static readonly TransferLocationOption None = new(new HubEquipmentLocation { LocName = "— не менять —" });

    public System.Text.Json.JsonElement? LocNo { get; }
    public string Name { get; }
}

/// <summary>Сформированный акт в результате передачи — строка с «Скачать».</summary>
public sealed class TransferActItemViewModel : ObservableObject
{
    private bool _isDownloading;

    public required string ActId { get; init; }
    public required string Title { get; init; }
    public required string FileName { get; init; }

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(IsNotDownloading));
            }
        }
    }

    /// <summary>Кнопка «Скачать» активна вне загрузки.</summary>
    public bool IsNotDownloading => !IsDownloading;
}

/// <summary>
/// Оверлей-диалог «Передача оборудования»: сотрудник (search/employee с
/// debounce), опционально филиал→локация и комментарий; POST /equipment/transfer
/// под клиентским operation_id (один на форму — повторный сабмит дедуплицирует
/// сервер), статус job досматривается поллингом act-jobs до done/failed.
/// </summary>
public sealed class EquipmentTransferViewModel : ObservableObject
{
    /// <summary>Debounce поиска сотрудника — как у формы заявки/почты.</summary>
    private static readonly TimeSpan EmployeeSearchDebounce = TimeSpan.FromMilliseconds(350);

    /// <summary>Серверный поиск сотрудника — от двух символов.</summary>
    private const int EmployeeSearchMinLength = 2;
    private const int EmployeeSearchLimit = 20;

    /// <summary>Шаг и потолок поллинга job — как в веб-диалоге (~1.5с, до минуты).</summary>
    private static readonly TimeSpan JobPollInterval = TimeSpan.FromMilliseconds(1500);
    private static readonly TimeSpan JobPollTimeout = TimeSpan.FromSeconds(60);

    private readonly IHubApiClient _api;
    private readonly string _invNo;
    private readonly Func<TransferActItemViewModel, Task>? _actSaver;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _employeeSearchCancellation;
    private CancellationTokenSource? _jobCancellation;
    private CancellationTokenSource? _locationsCancellation;

    private string _employeeQuery = string.Empty;
    private TransferEmployeeOption? _selectedEmployee;
    private bool _isEmployeePopupOpen;
    private bool _isEmployeeSearchBusy;
    private TransferBranchOption? _selectedBranch;
    private TransferLocationOption? _selectedLocation;
    private bool _isLocationsLoading;
    private string _commentText = string.Empty;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;
    private string _resultText = string.Empty;
    private bool _hasResult;

    public EquipmentTransferViewModel(
        IHubApiClient api,
        string invNo,
        IEnumerable<HubEquipmentBranch> branches,
        Func<TransferActItemViewModel, Task>? actSaver,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _invNo = invNo;
        _actSaver = actSaver;
        _delayAsync = delayAsync ?? Task.Delay;
        // Один operation_id на открытую форму (32 hex — вписывается в паттерн
        // бэкенда ^[A-Za-z0-9][\w.:-]*$ длиной 8-64): даблклик/повторный сабмит
        // с той же формы дедуплицируется на сервере, а не новым ключом.
        OperationId = Guid.NewGuid().ToString("N");

        ArgumentNullException.ThrowIfNull(branches);
        BranchOptions.Add(TransferBranchOption.None);
        foreach (var branch in branches)
        {
            if (!string.IsNullOrWhiteSpace(branch.Name))
            {
                BranchOptions.Add(new TransferBranchOption(branch));
            }
        }

        _selectedBranch = TransferBranchOption.None;

        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy && !HasResult);
        SelectEmployeeCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TransferEmployeeOption option)
            {
                SelectedEmployee = option;
                _employeeQuery = option.Title;
                OnPropertyChanged(nameof(EmployeeQuery));
                IsEmployeePopupOpen = false;
            }
        });
        ClearEmployeeCommand = new NativeRelayCommand(
            () => SelectedEmployee = null,
            () => !IsBusy && !HasResult);
        SelectBranchCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TransferBranchOption option)
            {
                SelectedBranch = option;
            }
        });
        SelectLocationCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TransferLocationOption option)
            {
                SelectedLocation = option;
            }
        });
        DownloadActCommand = new NativeAsyncCommand(
            (parameter, ct) => DownloadActAsync(parameter, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex));
        CloseCommand = new NativeRelayCommand(RequestClose);
        Acts.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasActs));
        EmployeeOptions.CollectionChanged += (_, _) =>
            OnPropertyChanged(nameof(HasEmployeeOptions));
    }

    /// <summary>Клиентский idempotency-key POST /equipment/transfer.</summary>
    public string OperationId { get; }

    /// <summary>Передача завершилась успешно — родитель обновляет карточку и историю.</summary>
    public event EventHandler? Completed;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>Инвентарный номер цели — подпись диалога.</summary>
    public string InvNoText => _invNo;

    // ---- Сотрудник: поиск и выбор ----

    /// <summary>Строка поиска сотрудника: от 2 символов — серверный search/employee.</summary>
    public string EmployeeQuery
    {
        get => _employeeQuery;
        set
        {
            if (SetProperty(ref _employeeQuery, value ?? string.Empty))
            {
                // Правка после выбора — намерение искать заново, выбор сбрасываем.
                SelectedEmployee = null;
                ScheduleEmployeeSearch();
            }
        }
    }

    public ObservableCollection<TransferEmployeeOption> EmployeeOptions { get; } = [];
    public bool HasEmployeeOptions => EmployeeOptions.Count > 0;

    /// <summary>Выбранный сотрудник (owner_no заполнит new_employee_no).</summary>
    public TransferEmployeeOption? SelectedEmployee
    {
        get => _selectedEmployee;
        private set
        {
            if (SetProperty(ref _selectedEmployee, value))
            {
                OnPropertyChanged(nameof(HasSelectedEmployee));
            }
        }
    }

    public bool HasSelectedEmployee => SelectedEmployee is not null;

    /// <summary>Popup подсказок; самозакрытие (StaysOpen=False) чистит список.</summary>
    public bool IsEmployeePopupOpen
    {
        get => _isEmployeePopupOpen;
        set
        {
            if (SetProperty(ref _isEmployeePopupOpen, value) && !value)
            {
                EmployeeOptions.Clear();
            }
        }
    }

    public bool IsEmployeeSearchBusy
    {
        get => _isEmployeeSearchBusy;
        private set => SetProperty(ref _isEmployeeSearchBusy, value);
    }

    // ---- Филиал и локация (опционально) ----

    public ObservableCollection<TransferBranchOption> BranchOptions { get; } = [];

    public TransferBranchOption? SelectedBranch
    {
        get => _selectedBranch;
        set
        {
            if (SetProperty(ref _selectedBranch, value))
            {
                OnPropertyChanged(nameof(HasBranchSelection));
                // Смена филиала — локация перечитывается для нового контекста.
                LocationOptions.Clear();
                LocationOptions.Add(TransferLocationOption.None);
                SelectedLocation = TransferLocationOption.None;
                if (!string.IsNullOrEmpty(value?.IdText))
                {
                    _ = LoadLocationsSafelyAsync(value.IdText);
                }
            }
        }
    }

    /// <summary>Выбран конкретный филиал — локация имеет смысл и активна.</summary>
    public bool HasBranchSelection => !string.IsNullOrEmpty(_selectedBranch?.IdText);

    public ObservableCollection<TransferLocationOption> LocationOptions { get; } = [];

    public TransferLocationOption? SelectedLocation
    {
        get => _selectedLocation;
        set => SetProperty(ref _selectedLocation, value);
    }

    public bool IsLocationsLoading
    {
        get => _isLocationsLoading;
        private set => SetProperty(ref _isLocationsLoading, value);
    }

    /// <summary>Комментарий к передаче (comment, пустое — null).</summary>
    public string CommentText
    {
        get => _commentText;
        set => SetProperty(ref _commentText, value ?? string.Empty);
    }

    // ---- Состояние ----

    /// <summary>Отправка или поллинг job в полёте — поля и кнопки закрыты.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearEmployeeCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Поле формы доступно, пока нет в полёте сабмита/поллинга.</summary>
    public bool AreInputsEnabled => !IsBusy;

    public string SubmitButtonText => IsBusy ? "Выполняется…" : "Передать";

    /// <summary>Строка прогресса job (job_status_text сервера) под формой.</summary>
    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    /// <summary>Ошибка отправки/валидации/поллинга — форма не закрывается.</summary>
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

    /// <summary>Итог выполненной передачи («Передано N позиций»).</summary>
    public string ResultText
    {
        get => _resultText;
        private set => SetProperty(ref _resultText, value);
    }

    /// <summary>Результат получен: форму прячем, показываем итог и акты.</summary>
    public bool HasResult
    {
        get => _hasResult;
        private set
        {
            if (SetProperty(ref _hasResult, value))
            {
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearEmployeeCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Акты результата — клик по строке скачивает файл.</summary>
    public ObservableCollection<TransferActItemViewModel> Acts { get; } = [];
    public bool HasActs => Acts.Count > 0;

    public ICommand SubmitCommand { get; }
    public ICommand SelectEmployeeCommand { get; }
    public ICommand ClearEmployeeCommand { get; }
    public ICommand SelectBranchCommand { get; }
    public ICommand SelectLocationCommand { get; }
    public ICommand DownloadActCommand { get; }
    public ICommand CloseCommand { get; }

    /// <summary>Закрытие родителем (смена выбора/сессия): гасим поллинг и поиск.</summary>
    public void Close()
    {
        _employeeSearchCancellation?.Cancel();
        _jobCancellation?.Cancel();
        _locationsCancellation?.Cancel();
    }

    /// <summary>✕/Отмена/Esc: отменить фон и сообщить родителю.</summary>
    private void RequestClose()
    {
        Close();
        Closed?.Invoke(this, EventArgs.Empty);
    }

    // ---- Поиск сотрудника ----

    private void ScheduleEmployeeSearch()
    {
        _employeeSearchCancellation?.Cancel();
        _employeeSearchCancellation?.Dispose();
        var query = _employeeQuery.Trim();
        if (query.Length < EmployeeSearchMinLength)
        {
            _employeeSearchCancellation = null;
            IsEmployeePopupOpen = false;
            EmployeeOptions.Clear();
            return;
        }

        var cancellation = new CancellationTokenSource();
        _employeeSearchCancellation = cancellation;
        _ = SearchEmployeesSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchEmployeesSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(EmployeeSearchDebounce, cancellationToken);
            if (!string.Equals(_employeeQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            IsEmployeeSearchBusy = true;
            var page = await _api.SearchEquipmentEmployeesAsync(
                query, EmployeeSearchLimit, cancellationToken);
            if (!string.Equals(_employeeQuery.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            EmployeeOptions.Clear();
            foreach (var employee in page.Employees ?? [])
            {
                if (!string.IsNullOrWhiteSpace(employee.Name))
                {
                    EmployeeOptions.Add(new TransferEmployeeOption(employee));
                }
            }

            IsEmployeePopupOpen = EmployeeOptions.Count > 0;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            // Подсказки не обязательны: ошибка поиска не ломает ручной ввод ФИО.
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsEmployeeSearchBusy = false;
        }
    }

    // ---- Локации выбранного филиала ----

    private async Task LoadLocationsSafelyAsync(string branchId)
    {
        _locationsCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _locationsCancellation = cancellation;
        IsLocationsLoading = true;
        try
        {
            var locations = await _api.GetEquipmentLocationsAsync(branchId, cancellation.Token);
            if (cancellation.IsCancellationRequested || _selectedBranch?.IdText != branchId)
            {
                return;
            }

            LocationOptions.Clear();
            LocationOptions.Add(TransferLocationOption.None);
            foreach (var location in locations ?? [])
            {
                if (!string.IsNullOrWhiteSpace(location.LocName))
                {
                    LocationOptions.Add(new TransferLocationOption(location));
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            // Справочник опционален: без него передача остаётся доступной.
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            if (ReferenceEquals(_locationsCancellation, cancellation))
            {
                IsLocationsLoading = false;
            }
        }
    }

    // ---- Отправка и поллинг job ----

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy || HasResult)
        {
            return;
        }

        ErrorText = null;
        var request = BuildRequest();
        if (request is null)
        {
            return;
        }

        _jobCancellation?.Cancel();
        _jobCancellation?.Dispose();
        var jobCancellation = new CancellationTokenSource();
        _jobCancellation = jobCancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, jobCancellation.Token);
        IsBusy = true;
        StatusText = "Отправляем передачу…";
        try
        {
            var response = await _api.TransferEquipmentAsync(request, linked.Token);
            if (IsTerminal(response))
            {
                ApplyResult(response);
                return;
            }

            var jobId = (response.JobId ?? string.Empty).Trim();
            if (jobId.Length == 0)
            {
                ErrorText = "Сервер не вернул задание передачи.";
                return;
            }

            StatusText = string.IsNullOrWhiteSpace(response.JobStatusText)
                ? "Передача поставлена в очередь…"
                : response.JobStatusText.Trim();
            await PollJobAsync(jobId, linked.Token);
        }
        catch (OperationCanceledException) when (jobCancellation.IsCancellationRequested)
        {
            // Закрытие диалога/смена выбора — без ошибки (job живёт на сервере).
        }
        finally
        {
            if (ReferenceEquals(_jobCancellation, jobCancellation))
            {
                IsBusy = false;
            }

            linked.Dispose();
        }
    }

    /// <summary>Поллинг act-jobs каждые ~1.5с до done/failed, потолок ~60с.</summary>
    private async Task PollJobAsync(string jobId, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + JobPollTimeout;
        var consecutiveErrors = 0;
        while (DateTime.UtcNow < deadline)
        {
            await _delayAsync(JobPollInterval, cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            HubTransferExecuteResponse job;
            try
            {
                job = await _api.GetTransferActJobAsync(jobId, cancellationToken);
                consecutiveErrors = 0;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception) when (++consecutiveErrors < 3)
            {
                // Сетевой сбой не убивает поллинг — job на сервере живёт сам.
                _ = exception;
                continue;
            }

            if (!string.IsNullOrWhiteSpace(job.JobStatusText))
            {
                StatusText = job.JobStatusText!.Trim();
            }

            var status = (job.JobStatus ?? string.Empty).Trim().ToLowerInvariant();
            if (status == "done")
            {
                ApplyResult(job);
                return;
            }

            if (status == "failed" || status == "error")
            {
                ErrorText = string.IsNullOrWhiteSpace(job.JobError)
                    ? "Передача завершилась ошибкой."
                    : job.JobError!.Trim();
                return;
            }
        }

        // Таймаут — job продолжается на сервере, диалог остаётся открытым.
        ErrorText = "Операция ещё выполняется на сервере. Проверьте результат позже.";
    }

    private static bool IsTerminal(HubTransferExecuteResponse response)
        => string.IsNullOrWhiteSpace(response.JobStatus)
            || (response.JobStatus.Trim().ToLowerInvariant() is "done" or "failed" or "error");

    /// <summary>Терминальный ответ: счётчики, акты, ошибки позиций.</summary>
    private void ApplyResult(HubTransferExecuteResponse response)
    {
        if ((response.JobStatus ?? "done").Trim().ToLowerInvariant() is "failed" or "error")
        {
            ErrorText = string.IsNullOrWhiteSpace(response.JobError)
                ? "Передача завершилась ошибкой."
                : response.JobError!.Trim();
            return;
        }

        ResultText = response.FailedCount > 0
            ? $"Передано {FormatTransferCount(response.SuccessCount)} · ошибок: {response.FailedCount}"
            : $"Передано {FormatTransferCount(response.SuccessCount)}";
        HasResult = true;
        StatusText = string.Empty;
        foreach (var act in response.Acts ?? [])
        {
            if (string.IsNullOrWhiteSpace(act.ActId))
            {
                continue;
            }

            var who = string.IsNullOrWhiteSpace(act.NewEmployee)
                ? act.OldEmployee?.Trim()
                : $"{act.OldEmployee?.Trim()} → {act.NewEmployee?.Trim()}";
            Acts.Add(new TransferActItemViewModel
            {
                ActId = act.ActId.Trim(),
                Title = $"{who} ({act.EquipmentCount})",
                FileName = string.IsNullOrWhiteSpace(act.FileName)
                    ? $"act_{act.ActId.Trim()}.pdf"
                    : act.FileName.Trim(),
            });
        }

        // Частичный исход: позиции с ошибкой показываем как предупреждение вверху.
        var firstFailed = response.Failed?.FirstOrDefault();
        if (response.FailedCount > 0 && firstFailed is not null)
        {
            ErrorText = string.IsNullOrWhiteSpace(firstFailed.Error)
                ? $"Не передано: {firstFailed.InvNo}"
                : $"{firstFailed.InvNo}: {firstFailed.Error.Trim()}";
        }

        if (response.SuccessCount > 0)
        {
            Completed?.Invoke(this, EventArgs.Empty);
        }
    }

    private HubEquipmentTransferRequest? BuildRequest()
    {
        var employee = SelectedEmployee;
        var manualName = _employeeQuery.Trim();
        string? newEmployee;
        long? newEmployeeNo = null;
        if (employee is not null)
        {
            newEmployee = employee.Title;
            newEmployeeNo = employee.OwnerNo;
        }
        else if (manualName.Length >= 2)
        {
            // Ручной ввод: бэкенд создаст владельца по ФИО (как «Добавить» в вебе).
            newEmployee = manualName;
        }
        else
        {
            newEmployee = null;
        }

        if (newEmployee is null || newEmployee.Length < 2)
        {
            ErrorText = "Выберите сотрудника из списка или введите ФИО.";
            return null;
        }

        return new HubEquipmentTransferRequest
        {
            OperationId = OperationId,
            InvNos = [_invNo],
            NewEmployee = newEmployee,
            NewEmployeeNo = newEmployeeNo,
            BranchNo = SelectedBranch?.Id,
            LocNo = SelectedLocation?.LocNo,
            Comment = string.IsNullOrWhiteSpace(_commentText) ? null : _commentText.Trim(),
        };
    }

    // ---- Скачивание акта ----

    private async Task DownloadActAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not TransferActItemViewModel act || act.IsDownloading)
        {
            return;
        }

        act.IsDownloading = true;
        try
        {
            if (_actSaver is not null)
            {
                await _actSaver(act);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "acts");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                act.FileName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "act.pdf";
            }

            var target = Path.Combine(directory, $"{act.ActId}-{safeName}");
            if (!File.Exists(target))
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadTransferActAsync(
                    act.ActId, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var renamed = Path.Combine(directory, $"{act.ActId}-{downloadedName}");
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

            System.Diagnostics.Process.Start(
                new System.Diagnostics.ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            act.IsDownloading = false;
        }
    }

    private static string FormatTransferCount(int count)
    {
        var mod100 = count % 100;
        var mod10 = count % 10;
        var form = mod100 is >= 11 and <= 14
            ? "позиций"
            : mod10 == 1
                ? "позиция"
                : mod10 is >= 2 and <= 4
                    ? "позиции"
                    : "позиций";
        return string.Create(CultureInfo.CurrentCulture, $"{count} {form}");
    }
}

/// <summary>
/// Страница «🗄 База»: серверный поиск оборудования ITINVENT
/// (/equipment/search/universal) по полю (серийный №, инв. №, сотрудник и
/// остальной allowlist веба) и типу, пагинация «Показать ещё» и карточка
/// по инвентарному номеру. Только чтение: передачи, акты, истории и
/// просмотр самих файлов фото (Bearer-контент) в срез не входят.
/// </summary>
public sealed class DatabaseViewModel : ObservableObject
{
    /// <summary>Порция выдачи — limit=50, как page-size по умолчанию в вебе.</summary>
    private const int PageSize = 50;

    /// <summary>Право записи базы — как canDatabaseWrite=hasPermission('database.write') веба.</summary>
    private const string DatabaseWritePermission = "database.write";

    /// <summary>Debounce строки поиска — как в ComputersViewModel/вебе.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(500);

    /// <summary>Поиск короче двух символов на сервер не уходит (общее правило натива).</summary>
    private const int MinSearchLength = 2;

    /// <summary>Сколько превью фото грузим в карточку (первые снимки по file_no).</summary>
    private const int PhotoPreviewLimit = 4;

    /// <summary>«Везде» — первый пункт меню поля поиска (field= не шлём).</summary>
    internal static readonly EquipmentFieldFilterItem AllFields = new(null, "Везде");

    /// <summary>«Все типы» — первый пункт меню типа (type_no= не шлём).</summary>
    internal static readonly EquipmentTypeFilterItem AllTypes = new(null, "Все типы");

    private readonly IHubApiClient _api;
    private readonly AuthImageLoader _imageLoader;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _searchCancellation;
    private CancellationTokenSource? _listCancellation;

    /// <summary>Заглушка событий фильтров на время Reset/сброса (без лишних перезагрузок).</summary>
    private bool _suppressFilterEvents;

    /// <summary>Справочник типов читаем один раз на сессию.</summary>
    private bool _typesLoaded;

    /// <summary>database.write из /auth/me — узнаём один раз, как mfu.read у статистики.</summary>
    private bool _permissionsLoaded;
    private bool _canTransfer;
    private EquipmentTransferViewModel? _transfer;

    /// <summary>Страница следующей порции (page+1 ответа; fallback — по числу строк).</summary>
    private int _nextPage = 1;

    /// <summary>Был хотя бы один удачный поиск — отличает «введите запрос» от «ничего не найдено».</summary>
    private bool _hasSearched;

    private EquipmentItemViewModel? _selectedItem;
    private EquipmentDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private int _photoCount;
    private bool _photosLoaded;
    private string _searchText = string.Empty;
    private EquipmentFieldFilterItem _selectedFieldFilter = AllFields;
    private EquipmentTypeFilterItem _selectedTypeFilter = AllTypes;
    private bool _isLoading;
    private bool _isLoadingMore;
    private bool _hasMore;
    private int _total;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public DatabaseViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading && !IsLoadingMore);
        SelectFieldFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is EquipmentFieldFilterItem option)
            {
                SelectedFieldFilter = option;
            }
        });
        SelectTypeFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is EquipmentTypeFilterItem option)
            {
                SelectedTypeFilter = option;
            }
        });
        ClearFiltersCommand = new NativeRelayCommand(ClearFilters);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        OpenPhotoCommand = new NativeAsyncCommand(
            (parameter, ct) => OpenPhotoViewerAsync(parameter, ct),
            _ => { });
        ClosePhotoViewerCommand = new NativeRelayCommand(ClosePhotoViewer);
        OpenTransferCommand = new NativeAsyncCommand(
            (_, ct) => OpenTransferAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(ShowSearchPlaceholder));
            OnPropertyChanged(nameof(MoreButtonText));
        };
        PhotoPreviews.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasPhotoPreviews));
    }

    // ---- Список и фильтры ----

    public ObservableCollection<EquipmentItemViewModel> Items { get; } = [];

    /// <summary>Превью фото: миниатюра + идентификаторы полноразмерного Bearer-контента.</summary>
    public sealed class DatabasePhotoItem
    {
        public required long ItemId { get; init; }
        public required long FileNo { get; init; }
        public required ImageSource Image { get; init; }
    }

    /// <summary>Фильтр типа — справочник /equipment/types (ci_type=1, как equipmentTypeOptions веба).</summary>
    public ObservableCollection<EquipmentTypeFilterItem> TypeFilterOptions { get; } = [AllTypes];

    public EquipmentItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (!SetProperty(ref _selectedItem, value))
            {
                return;
            }

            ClosePhotoViewer();
            // Передача привязана к карточке: смена выбора закрывает диалог
            // (его поллинг отменяется, job на сервере живёт дальше).
            CloseTransfer();
            if (value is null)
            {
                // Снятие выбора: гасим летящий запрос и прячем карточку без ошибки.
                _detailLoadCancellation?.Cancel();
                Detail = null;
                PhotoCount = 0;
                PhotosLoaded = false;
                ResetPhotoAndHistoryState();
                DetailErrorText = null;
                return;
            }

            var invNo = EquipmentCatalog.InvNoParameter(value.InvNo);
            if (invNo is not null)
            {
                _ = LoadDetailSafelyAsync(invNo, value.Id);
            }
            else
            {
                // Строка без инвентарного номера — карточку запросить нельзя.
                _detailLoadCancellation?.Cancel();
                Detail = null;
                PhotoCount = 0;
                PhotosLoaded = false;
                ResetPhotoAndHistoryState();
                DetailErrorText = "У записи нет инвентарного номера — карточка недоступна.";
            }
        }
    }

    public EquipmentDetailViewModel? Detail
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

    /// <summary>Заглушка «выберите оборудование» — ни карточки, ни загрузки деталей.</summary>
    public bool ShowDetailPlaceholder => Detail is null && !IsDetailLoading && !HasDetailError;

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
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetailError => !string.IsNullOrEmpty(DetailErrorText);

    /// <summary>Число фото карточки из /equipment/{id}/photos (сами файлы — вне среза).</summary>
    public int PhotoCount
    {
        get => _photoCount;
        private set
        {
            if (SetProperty(ref _photoCount, value))
            {
                OnPropertyChanged(nameof(PhotoText));
                OnPropertyChanged(nameof(HasPhotos));
            }
        }
    }

    /// <summary>Ответ на запрос фото получен — метку показываем только по факту.</summary>
    public bool PhotosLoaded
    {
        get => _photosLoaded;
        private set
        {
            if (SetProperty(ref _photosLoaded, value))
            {
                OnPropertyChanged(nameof(PhotoText));
                OnPropertyChanged(nameof(HasPhotos));
            }
        }
    }

    public bool HasPhotos => PhotosLoaded && PhotoCount > 0;

    /// <summary>Загруженные превью фото карточки (первые снимки, thumb-контент).</summary>
    public ObservableCollection<DatabasePhotoItem> PhotoPreviews { get; } = [];

    private ImageSource? _photoViewerImage;
    private bool _isPhotoViewerOpen;

    /// <summary>Фото в оверлее просмотра: сразу миниатюра, догружается полный кадр.</summary>
    public ImageSource? PhotoViewerImage
    {
        get => _photoViewerImage;
        private set => SetProperty(ref _photoViewerImage, value);
    }

    /// <summary>Оверлей просмотра фото открыт.</summary>
    public bool IsPhotoViewerOpen
    {
        get => _isPhotoViewerOpen;
        private set => SetProperty(ref _isPhotoViewerOpen, value);
    }

    /// <summary>Клик по превью: оверлей с миниатюрой + догрузка полного кадра (без thumb).</summary>
    private async Task OpenPhotoViewerAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not DatabasePhotoItem item)
        {
            return;
        }

        PhotoViewerImage = item.Image;
        IsPhotoViewerOpen = true;
        var image = await _imageLoader.LoadAsync(
            "equipment/" + item.ItemId + "/photos/" + item.FileNo + "/content",
            decodePixelWidth: 1600,
            cancellationToken);
        if (image is not null && IsPhotoViewerOpen)
        {
            PhotoViewerImage = image;
        }
    }

    private void ClosePhotoViewer()
    {
        IsPhotoViewerOpen = false;
        PhotoViewerImage = null;
    }

    // ---- Передача оборудования (write-флоу) ----

    /// <summary>
    /// Кнопка «Передать…» видна только с правом database.write (admin — всегда),
    /// как hasPermission('database.write') в вебе. Узнаём из /auth/me один раз.
    /// </summary>
    public bool CanTransfer
    {
        get => _canTransfer;
        private set => SetProperty(ref _canTransfer, value);
    }

    /// <summary>Открытый диалог передачи; null — закрыт.</summary>
    public EquipmentTransferViewModel? Transfer
    {
        get => _transfer;
        private set
        {
            if (SetProperty(ref _transfer, value))
            {
                OnPropertyChanged(nameof(IsTransferOpen));
            }
        }
    }

    public bool IsTransferOpen => Transfer is not null;

    /// <summary>
    /// Шов скачивания/открытия акта (как AttachmentSaver у билетов): тесты
    /// подменяют потоковое скачивание в %TEMP% + Process.Start.
    /// </summary>
    public Func<TransferActItemViewModel, Task>? ActSaver { get; set; }

    /// <summary>
    /// «Передать…» в карточке: справочник филиалов догружаем при открытии,
    /// форма — оверлей поверх страницы (как «Новая заявка» у билетов).
    /// </summary>
    private async Task OpenTransferAsync(CancellationToken cancellationToken)
    {
        // Повторный клик при открытой форме не пересоздаёт её — поля сохраняются.
        if (Transfer is not null)
        {
            return;
        }

        var invNo = EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo);
        if (invNo is null || Detail is null)
        {
            return;
        }

        await EnsurePermissionsAsync(cancellationToken);
        if (!_canTransfer)
        {
            BannerErrorText = "Недостаточно прав для изменения данных.";
            return;
        }

        // Филиалы опциональны: ошибка справочника не блокирует диалог — пустой список.
        IReadOnlyList<HubEquipmentBranch> branches;
        try
        {
            branches = await _api.GetEquipmentBranchesAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            branches = [];
        }

        var transfer = new EquipmentTransferViewModel(
            _api, invNo, branches, ActSaver, DelayAsync);
        transfer.Completed += Transfer_Completed;
        transfer.Closed += Transfer_Closed;
        Transfer = transfer;
    }

    /// <summary>Job done с успешными позициями: перечитываем карточку и историю.</summary>
    private void Transfer_Completed(object? sender, EventArgs e)
    {
        var invNo = EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo);
        if (invNo is not null)
        {
            _ = LoadDetailSafelyAsync(invNo, _selectedItem?.Id);
        }
    }

    private void Transfer_Closed(object? sender, EventArgs e)
    {
        CloseTransfer();
    }

    private void CloseTransfer()
    {
        Transfer?.Close();
        Transfer = null;
    }

    /// <summary>
    /// Право database.write узнаём один раз из /auth/me (матрица как у веба:
    /// admin видит всё, иначе — явное право). Ошибка /me не ломает карточку.
    /// </summary>
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
            CanTransfer = isAdmin || user.Permissions?.Contains(DatabaseWritePermission) == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            CanTransfer = false;
        }
    }

    /// <summary>Сброс превью фото и истории — при смене выбора/списка.</summary>
    private void ResetPhotoAndHistoryState()
    {
        PhotoPreviews.Clear();
        HistoryTotal = 0;
        HistoryLoaded = false;
        HistoryEntries.Clear();
    }

    /// <summary>Строка истории перемещений (CI_HISTORY) — отформатирована как в веб-панели.</summary>
    public sealed class EquipmentHistoryEntry
    {
        public required string DateText { get; init; }
        public required string HistIdText { get; init; }
        public required string EmployeeText { get; init; }
        public required string BranchText { get; init; }
        public required string LocationText { get; init; }
        public required string UserText { get; init; }
        public required string CommentText { get; init; }
        public bool HasComment => !string.IsNullOrWhiteSpace(CommentText);
    }

    /// <summary>Записи истории перемещений карточки.</summary>
    public ObservableCollection<EquipmentHistoryEntry> HistoryEntries { get; } = [];

    private int _historyTotal;
    private bool _historyLoaded;

    /// <summary>Число записей истории из /equipment/{inv}/history.</summary>
    public int HistoryTotal
    {
        get => _historyTotal;
        private set
        {
            if (SetProperty(ref _historyTotal, value))
            {
                OnPropertyChanged(nameof(HistoryText));
                OnPropertyChanged(nameof(HasHistory));
            }
        }
    }

    /// <summary>История загружена (метку показываем и для пустой).</summary>
    public bool HistoryLoaded
    {
        get => _historyLoaded;
        private set
        {
            if (SetProperty(ref _historyLoaded, value))
            {
                OnPropertyChanged(nameof(HistoryText));
                OnPropertyChanged(nameof(HasHistory));
            }
        }
    }

    /// <summary>Есть записи истории — блок виден.</summary>
    public bool HasHistory => HistoryLoaded && HistoryTotal > 0;

    /// <summary>Метка истории: счётчик, как у фото.</summary>
    public string HistoryText => !HistoryLoaded
        ? string.Empty
        : HistoryTotal > 0
            ? $"История: {HistoryTotal}"
            : "История пуста";

    /// <summary>Хотя бы одно превью пришло — галерея под меткой видна.</summary>
    public bool HasPhotoPreviews => PhotoPreviews.Count > 0;

    /// <summary>Метка фото: счётчик по /equipment/{id}/photos, превью — под ней.</summary>
    public string PhotoText => !PhotosLoaded
        ? string.Empty
        : PhotoCount > 0
            ? $"Фото: {PhotoCount}"
            : string.Empty;

    /// <summary>Поиск q: ввод стартует debounce-перезагрузку серверного поиска.</summary>
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

    /// <summary>Поле поиска — SEARCH_FIELD_OPTIONS веба (allowlist field= бэкенда).</summary>
    public ObservableCollection<EquipmentFieldFilterItem> FieldFilterOptions { get; } =
    [
        AllFields,
        new("model", "Модель"),
        new("serial", "Серийный №"),
        new("inv_no", "Инв. №"),
        new("part_no", "Парт. №"),
        new("employee", "Сотрудник"),
        new("branch", "Филиал"),
        new("location", "Локация"),
        new("status", "Статус"),
        new("vendor", "Производитель"),
        new("type", "Тип (текст)"),
        new("ip", "IP"),
        new("mac", "MAC"),
        new("netbios", "Сетевое имя"),
    ];

    /// <summary>Фильтр field= («Везде» — без параметра): смена перечитывает список.</summary>
    public EquipmentFieldFilterItem SelectedFieldFilter
    {
        get => _selectedFieldFilter;
        set
        {
            if (SetProperty(ref _selectedFieldFilter, value ?? AllFields))
            {
                OnPropertyChanged(nameof(SelectedFieldFilterText));
                OnPropertyChanged(nameof(HasActiveFilters));
                OnPropertyChanged(nameof(SearchPlaceholderText));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки-меню поля («Везде ▾»).</summary>
    public string SelectedFieldFilterText => _selectedFieldFilter.Label;

    /// <summary>Подсказка поля ввода — «Поиск по полю «Серийный №»…» как в вебе.</summary>
    public string SearchPlaceholderText => _selectedFieldFilter.Value is null
        ? "Инв. №, серийный №, сотрудник…"
        : $"Поиск по полю «{_selectedFieldFilter.Label}»…";

    /// <summary>Фильтр type_no= («Все типы» — без параметра): смена перечитывает список.</summary>
    public EquipmentTypeFilterItem SelectedTypeFilter
    {
        get => _selectedTypeFilter;
        set
        {
            if (SetProperty(ref _selectedTypeFilter, value ?? AllTypes))
            {
                OnPropertyChanged(nameof(SelectedTypeFilterText));
                OnPropertyChanged(nameof(HasActiveFilters));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки-меню типа («Все типы ▾»).</summary>
    public string SelectedTypeFilterText => _selectedTypeFilter.Label;

    /// <summary>Есть активные фильтры — показывать «Сбросить».</summary>
    public bool HasActiveFilters
        => _selectedFieldFilter.Value is not null
            || _selectedTypeFilter.TypeNo is not null
            || !string.IsNullOrWhiteSpace(_searchText);

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(ShowSearchPlaceholder));
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
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>На сервере остались страницы выдачи (page &lt; pages).</summary>
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

    /// <summary>Подпись «Показать ещё» с остатком серверной выдачи.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : _total > Items.Count
            ? $"Показать ещё ({_total - Items.Count})"
            : "Показать ещё";

    public string? BannerErrorText
    {
        get => _bannerErrorText;
        private set
        {
            if (SetProperty(ref _bannerErrorText, value))
            {
                OnPropertyChanged(nameof(HasBannerError));
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(ShowSearchPlaceholder));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    /// <summary>Пустая выдача после поиска — «ничего не найдено».</summary>
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError && _hasSearched;

    /// <summary>Пустое начальное состояние — «введите запрос» (поиск ещё не выполнялся).</summary>
    public bool ShowSearchPlaceholder
        => !IsLoading && Items.Count == 0 && !HasBannerError && !_hasSearched;

    /// <summary>Подпись счётчика серверной выдачи: «120 позиций».</summary>
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

    public ICommand RefreshCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand SelectFieldFilterCommand { get; }
    public ICommand SelectTypeFilterCommand { get; }
    public ICommand ClearFiltersCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand OpenPhotoCommand { get; }
    public ICommand ClosePhotoViewerCommand { get; }
    public ICommand OpenTransferCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Нормализация ввода — как в соседних поисковых страницах натива.</summary>
    private static string NormalizeQuery(string value)
        => string.Join(' ', (value ?? string.Empty)
            .Replace('\r', ' ')
            .Replace('\n', ' ')
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries));

    /// <summary>
    /// Первичная загрузка страницы: только справочник типов. Сам список не
    /// грузим без запроса — пустой q без type_no бэкенд считает пустым
    /// ответом, а полный просмотр базы в срез не входит.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        // Права для кнопки «Передать…» — ленивый разовый запрос /auth/me.
        await EnsurePermissionsAsync(cancellationToken);
        await EnsureTypesAsync(cancellationToken);
        if (HasQuery)
        {
            await LoadPageAsync(append: false, cancellationToken);
        }
    }

    /// <summary>Активный запрос: текст нужной длины или выбранный тип (type без q — листинг типа).</summary>
    private bool HasQuery
        => NormalizeQuery(_searchText).Length >= MinSearchLength
            || _selectedTypeFilter.TypeNo is not null;

    /// <summary>
    /// Справочник типов /equipment/types: как в вебе — только оборудование
    /// (ci_type === 1), расходники в этот срез не входят. Ошибка справочника
    /// не блокирует поиск — просто без фильтра типа.
    /// </summary>
    private async Task EnsureTypesAsync(CancellationToken cancellationToken)
    {
        if (_typesLoaded)
        {
            return;
        }

        _typesLoaded = true;
        try
        {
            var types = await _api.GetEquipmentTypesAsync(cancellationToken);
            TypeFilterOptions.Clear();
            TypeFilterOptions.Add(AllTypes);
            foreach (var type in types ?? [])
            {
                if (type.CiType is not null and not 1)
                {
                    continue;
                }

                TypeFilterOptions.Add(new EquipmentTypeFilterItem(
                    type.TypeNo,
                    string.IsNullOrWhiteSpace(type.TypeName) ? $"Тип {type.TypeNo}" : type.TypeName!.Trim()));
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            // Справочник не обязателен для поиска — без фильтра типа.
        }
    }

    private HubEquipmentSearchQuery BuildQuery(int page)
        => new()
        {
            Search = NormalizeQuery(_searchText) is { Length: >= MinSearchLength } query ? query : null,
            Field = _selectedFieldFilter.Value,
            TypeNo = _selectedTypeFilter.TypeNo,
            Page = page,
            Limit = PageSize,
        };

    /// <summary>Загрузка страницы: append=false — первая страница, иначе следующая.</summary>
    private async Task LoadPageAsync(bool append, CancellationToken cancellationToken)
    {
        _listCancellation?.Cancel();
        _listCancellation?.Dispose();
        var listCancellation = new CancellationTokenSource();
        _listCancellation = listCancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, listCancellation.Token);
        var page = append ? _nextPage : 1;
        if (append)
        {
            IsLoadingMore = true;
        }
        else
        {
            IsLoading = true;
        }

        try
        {
            var result = await _api.SearchEquipmentAsync(BuildQuery(page), linked.Token);
            // Ответ устарел: поиск/фильтры уже сменились — не применяем его.
            if (listCancellation.IsCancellationRequested)
            {
                return;
            }

            if (append)
            {
                // Дедуп по id|inv_no — повторные строки на границе страниц.
                var known = new HashSet<string>(
                    Items.Select(item => item.Id is not null
                        ? $"id:{item.Id}"
                        : $"inv:{item.InvNoText}"),
                    StringComparer.OrdinalIgnoreCase);
                foreach (var equipment in result.Equipment ?? [])
                {
                    var item = new EquipmentItemViewModel(equipment);
                    var key = item.Id is not null ? $"id:{item.Id}" : $"inv:{item.InvNoText}";
                    if (known.Add(key))
                    {
                        Items.Add(item);
                    }
                }
            }
            else
            {
                Items.Clear();
                foreach (var equipment in result.Equipment ?? [])
                {
                    Items.Add(new EquipmentItemViewModel(equipment));
                }
            }

            _hasSearched = true;
            _total = Math.Max(result.Total, Items.Count);
            var servedPage = result.Page > 0 ? result.Page : page;
            _nextPage = servedPage + 1;
            HasMore = result.Pages > 0 && servedPage < result.Pages;
            TotalText = FormatCount(_total, "позиция", "позиции", "позиций");
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        catch (OperationCanceledException) when (listCancellation.IsCancellationRequested)
        {
            // Отменили мы сами (новый поиск/фильтр/страница) — не баннерная ошибка.
        }
        finally
        {
            if (ReferenceEquals(_listCancellation, listCancellation))
            {
                IsLoading = false;
                IsLoadingMore = false;
            }
            else if (!listCancellation.IsCancellationRequested)
            {
                IsLoading = false;
                IsLoadingMore = false;
            }

            linked.Dispose();
        }
    }

    /// <summary>«Показать ещё»: следующая страница серверной выдачи.</summary>
    private Task LoadMoreAsync(CancellationToken cancellationToken)
        => LoadPageAsync(append: true, cancellationToken);

    /// <summary>Смена фильтра: список и карточка перечитываются с начала выдачи.</summary>
    private void ReloadFromFilterChange()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        _ = ReloadListSafelyAsync();
    }

    private async Task ReloadListSafelyAsync()
    {
        try
        {
            Detail = null;
            PhotoCount = 0;
            PhotosLoaded = false;
            ResetPhotoAndHistoryState();
            SelectedItem = null;
            if (HasQuery)
            {
                await LoadPageAsync(append: false, CancellationToken.None);
            }
            else
            {
                // Фильтры вернули в нейтраль: пустой запрос не шлём.
                _listCancellation?.Cancel();
                _hasSearched = false;
                Items.Clear();
                _total = 0;
                HasMore = false;
                TotalText = string.Empty;
                LastUpdatedText = string.Empty;
            }
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Debounce 500 мс: серверный поиск; короче 2 символов — без запроса.</summary>
    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        // Сброс фильтров переписывает строку напрямую — отложенный поиск не нужен.
        if (_suppressFilterEvents)
        {
            return;
        }

        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var query = NormalizeQuery(_searchText);
        // Ввод длиной 1 символ выдачу не меняет — как в вебе (SEARCH_MIN_QUERY_LEN).
        if (query.Length == 1)
        {
            return;
        }

        _ = SearchSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            // Строка уже сменилась — результат устарел.
            if (!string.Equals(NormalizeQuery(_searchText), query, StringComparison.Ordinal))
            {
                return;
            }

            Detail = null;
            PhotoCount = 0;
            PhotosLoaded = false;
            ResetPhotoAndHistoryState();
            SelectedItem = null;
            if (HasQuery)
            {
                await LoadPageAsync(append: false, cancellationToken);
            }
            else
            {
                // Строку очистили и тип не выбран — пустое начальное состояние.
                _listCancellation?.Cancel();
                _hasSearched = false;
                Items.Clear();
                _total = 0;
                HasMore = false;
                TotalText = string.Empty;
                LastUpdatedText = string.Empty;
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

    /// <summary>Сброс фильтров и строки поиска к начальным значениям.</summary>
    private void ClearFilters()
    {
        _suppressFilterEvents = true;
        try
        {
            SearchText = string.Empty;
            SelectedFieldFilter = AllFields;
            SelectedTypeFilter = AllTypes;
        }
        finally
        {
            _suppressFilterEvents = false;
        }

        OnPropertyChanged(nameof(HasActiveFilters));
        OnPropertyChanged(nameof(SearchPlaceholderText));
        ReloadFromFilterChange();
    }

    // ---- Карточка ----

    private async Task LoadDetailSafelyAsync(string invNo, long? itemId)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        PhotoCount = 0;
        PhotosLoaded = false;
        ResetPhotoAndHistoryState();
        try
        {
            var item = await _api.GetEquipmentByInvAsync(invNo, cancellation.Token);
            // Выбор уже ушёл на другую позицию — устаревший ответ не применяем.
            if (!string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
            {
                return;
            }

            Detail = new EquipmentDetailViewModel(item);
            // История — необязательный сигнал: без неё карточка остаётся.
            _ = LoadHistorySafelyAsync(invNo, cancellation.Token);
            // Метаданные фото — необязательный сигнал: без них карточка остаётся.
            var photoItemId = item.Id ?? itemId;
            if (photoItemId is not null)
            {
                _ = LoadPhotosSafelyAsync(photoItemId.Value, invNo, cancellation.Token);
            }
            else
            {
                PhotosLoaded = true;
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
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

    /// <summary>
    /// Фото карточки — best-effort: ошибка/отмена метку и превью не показывают,
    /// карточку не ломают. Превью — Bearer-контент /photos/{file_no}/content?thumb=true
    /// через AuthImageLoader, по одному за раз, первые PhotoPreviewLimit снимков.
    /// </summary>
    private async Task LoadPhotosSafelyAsync(long itemId, string invNo, CancellationToken cancellationToken)
    {
        try
        {
            var photos = await _api.GetEquipmentPhotosAsync(itemId, cancellationToken);
            if (!string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
            {
                return;
            }

            PhotoCount = photos.Photos?.Count ?? 0;
            PhotosLoaded = true;

            var fileNos = (photos.Photos ?? [])
                .Select(photo => photo.FileNo)
                .Take(PhotoPreviewLimit)
                .ToArray();
            foreach (var fileNo in fileNos)
            {
                var image = await _imageLoader.LoadAsync(
                    $"equipment/{itemId}/photos/{fileNo}/content?thumb=true",
                    decodePixelWidth: 256,
                    cancellationToken);
                // Выбор уже ушёл на другую позицию — превью не вставляем.
                if (!string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
                {
                    return;
                }

                if (image is not null)
                {
                    PhotoPreviews.Add(new DatabasePhotoItem
                    {
                        ItemId = itemId,
                        FileNo = fileNo,
                        Image = image,
                    });
                }
            }
        }
        catch (Exception)
        {
            // Список фото или контент недоступны — карточка живёт без метки/превью.
        }
    }

    /// <summary>
    /// История перемещений — best-effort как у фото: ошибка/отмена блок не ломают,
    /// метка не показывается. Строки форматируются как EquipmentDetailHistoryPanel веба.
    /// </summary>
    private async Task LoadHistorySafelyAsync(string invNo, CancellationToken cancellationToken)
    {
        try
        {
            var response = await _api.GetEquipmentHistoryAsync(invNo, cancellationToken);
            if (!string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
            {
                return;
            }

            HistoryTotal = response.Total;
            HistoryLoaded = true;
            foreach (var row in response.History ?? [])
            {
                HistoryEntries.Add(ToHistoryEntry(row));
            }
        }
        catch (Exception)
        {
            // История недоступна — карточка живёт без блока.
        }
    }

    private static EquipmentHistoryEntry ToHistoryEntry(HubEquipmentHistoryRow row)
    {
        return new EquipmentHistoryEntry
        {
            DateText = FormatHistoryDate(row.ChDate),
            HistIdText = row.HistId?.ToString(CultureInfo.InvariantCulture) ?? "—",
            EmployeeText = HistoryTransition(
                row.OldEmployeeName ?? row.OldEmployeeNo?.ToString(CultureInfo.InvariantCulture),
                row.NewEmployeeName ?? row.NewEmployeeNo?.ToString(CultureInfo.InvariantCulture)),
            BranchText = HistoryTransition(
                row.OldBranchName ?? row.OldBranchNo?.ToString(CultureInfo.InvariantCulture),
                row.NewBranchName ?? row.NewBranchNo?.ToString(CultureInfo.InvariantCulture)),
            LocationText = HistoryTransition(
                row.OldLocationName ?? row.OldLocNo?.ToString(CultureInfo.InvariantCulture),
                row.NewLocationName ?? row.NewLocNo?.ToString(CultureInfo.InvariantCulture)),
            UserText = string.IsNullOrWhiteSpace(row.ChUser) ? "—" : row.ChUser.Trim(),
            CommentText = row.ChComment?.Trim() ?? string.Empty,
        };
    }

    /// <summary>Переход «было → стало» как formatHistoryTransition веба.</summary>
    private static string HistoryTransition(string? oldValue, string? newValue)
    {
        var oldText = string.IsNullOrWhiteSpace(oldValue) ? "—" : oldValue.Trim();
        var newText = string.IsNullOrWhiteSpace(newValue) ? "—" : newValue.Trim();
        return oldText == "—" && newText == "—" ? "—" : oldText + " → " + newText;
    }

    /// <summary>Дата изменения: сервер отдаёт ISO/UTC — показываем локальную дату.</summary>
    private static string FormatHistoryDate(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "—";
        }

        return DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : value.Trim();
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
        IsLoadingMore = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        CloseTransfer();
        _permissionsLoaded = false;
        CanTransfer = false;
        _detailLoadCancellation?.Cancel();
        _listCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _suppressFilterEvents = true;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        PhotoCount = 0;
        PhotosLoaded = false;
        ResetPhotoAndHistoryState();
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedFieldFilter = AllFields;
        OnPropertyChanged(nameof(SelectedFieldFilter));
        OnPropertyChanged(nameof(SelectedFieldFilterText));
        OnPropertyChanged(nameof(SearchPlaceholderText));
        _selectedTypeFilter = AllTypes;
        OnPropertyChanged(nameof(SelectedTypeFilter));
        OnPropertyChanged(nameof(SelectedTypeFilterText));
        TypeFilterOptions.Clear();
        TypeFilterOptions.Add(AllTypes);
        _typesLoaded = false;
        _suppressFilterEvents = false;
        OnPropertyChanged(nameof(HasActiveFilters));
        _nextPage = 1;
        _total = 0;
        _hasSearched = false;
        HasMore = false;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
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
