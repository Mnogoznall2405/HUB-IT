using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
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
public sealed class EquipmentItemViewModel : ObservableObject
{
    private bool _isChecked;

    public EquipmentItemViewModel(HubEquipmentItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Source = item;
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

    /// <summary>Исходная строка контракта — карточка «панель сотрудника» открывает её без перепоиска.</summary>
    public HubEquipmentItem Source { get; }

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

    /// <summary>Чекбокс массового выделения — групповая передача (как bulk у почты).</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set => SetProperty(ref _isChecked, value);
    }

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
        OwnerNo = item.EmplNo;
        OwnerName = item.EmployeeName?.Trim() ?? string.Empty;
        OwnerDept = item.EmployeeDept?.Trim() ?? string.Empty;
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

    /// <summary>OWNER_NO из empl_no ответа detail — ключ панели сотрудника.</summary>
    public long? OwnerNo { get; }

    /// <summary>ФИО владельца без плейсхолдера — заголовок панели и параметр employee_name.</summary>
    public string OwnerName { get; }

    /// <summary>Подразделение владельца без плейсхолдера — подзаголовок панели.</summary>
    public string OwnerDept { get; }

    /// <summary>Есть ли владелец с номером — без него панель сотрудника открыть нельзя.</summary>
    public bool HasOwner => OwnerNo is > 0;

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
/// Режим диалога передачи: «Сотруднику» — POST /equipment/transfer (владелец
/// обязателен, акты); «По местоположению» — POST /equipment/transfer/location
/// (только филиал+локация, обязательные, без владельца и актов); «Только акт» —
/// POST /equipment/transfer/act-only (кто выдал обязателен, получатель в акте —
/// текущий владелец; данные позиций не меняются).
/// </summary>
public enum EquipmentTransferMode
{
    Employee,
    Location,
    ActOnly,
}

/// <summary>Позиция цели диалога передачи: инв. № (в inv_nos) + подпись строки.</summary>
public sealed class TransferTargetItem
{
    public required string InvNo { get; init; }
    public string? Title { get; init; }

    /// <summary>«Инв. № 100234 — ThinkPad T14»; без модели — только номер.</summary>
    public string DisplayText => string.IsNullOrWhiteSpace(Title)
        ? $"Инв. № {InvNo}"
        : $"Инв. № {InvNo} — {Title.Trim()}";
}

/// <summary>
/// Оверлей-диалог «Передача оборудования»: сотрудник (search/employee с
/// debounce), опционально филиал→локация и комментарий; POST /equipment/transfer
/// под клиентским operation_id (один на форму — повторный сабмит дедуплицирует
/// сервер), статус job досматривается поллингом act-jobs до done/failed.
/// Цели — 1..N позиций (одиночная из карточки — тот же флоу с inv_nos[1]).
/// Режим «По местоположению» шлёт POST /equipment/transfer/location: филиал и
/// локация обязательны, владелец не меняется, актов нет.
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

    /// <summary>Сколько позиций показываем списком в диалоге — дальше «и ещё N».</summary>
    private const int TargetPreviewLimit = 5;

    private readonly IHubApiClient _api;
    private readonly IReadOnlyList<TransferTargetItem> _targets;
    private readonly IReadOnlyList<string> _invNos;
    private readonly Func<TransferActItemViewModel, Task>? _actSaver;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _employeeSearchCancellation;
    private CancellationTokenSource? _jobCancellation;
    private CancellationTokenSource? _locationsCancellation;

    private EquipmentTransferMode _mode = EquipmentTransferMode.Employee;
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
    private string _reminderInfoText = string.Empty;
    private string _reminderWarningText = string.Empty;
    private string? _reminderTaskId;
    private string? _reminderId;

    public EquipmentTransferViewModel(
        IHubApiClient api,
        IReadOnlyList<TransferTargetItem> targets,
        IEnumerable<HubEquipmentBranch> branches,
        Func<TransferActItemViewModel, Task>? actSaver,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        ArgumentNullException.ThrowIfNull(targets);
        if (targets.Count == 0)
        {
            throw new ArgumentException("Список позиций передачи пуст.", nameof(targets));
        }

        _targets = targets;
        _invNos = targets.Select(target => target.InvNo.Trim()).ToArray();
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

        // Превью позиций в диалоге — первые строки списком, остальное «и ещё N».
        foreach (var target in _targets.Take(TargetPreviewLimit))
        {
            TargetItems.Add(target);
        }

        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy && !HasResult);
        SelectModeCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is string key
                && Enum.TryParse<EquipmentTransferMode>(key, ignoreCase: true, out var parsed))
            {
                Mode = parsed;
            }
        });
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
        DownloadActCommand = new NativeAsyncCommand(
            (parameter, ct) => DownloadActAsync(parameter, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex));
        // «Открыть задачу» reminder-блока: навигация на странице задач — дело родителя.
        OpenReminderTaskCommand = new NativeRelayCommand(
            () =>
            {
                if (_reminderTaskId is { Length: > 0 } taskId)
                {
                    ReminderTaskOpenRequested?.Invoke(this, taskId);
                }
            },
            () => _reminderTaskId is { Length: > 0 });
        // «Загрузить подписанный акт» — родитель открывает диалог в reminder-режиме.
        OpenUploadReminderCommand = new NativeRelayCommand(
            () => UploadReminderRequested?.Invoke(this, EventArgs.Empty),
            () => HasReminderBlock);
        CloseCommand = new NativeRelayCommand(RequestClose);
        Acts.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasActs));
    }

    /// <summary>Клиентский idempotency-key POST /equipment/transfer.</summary>
    public string OperationId { get; }

    /// <summary>Передача завершилась успешно — родитель обновляет карточку и историю.</summary>
    public event EventHandler? Completed;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>
    /// «Открыть задачу» reminder-блока результата — родитель ведёт на страницу
    /// задач через шов навигации (аргумент — task_id строкой).
    /// </summary>
    public event EventHandler<string>? ReminderTaskOpenRequested;

    /// <summary>
    /// «Загрузить подписанный акт» reminder-блока — родитель открывает диалог
    /// загрузки в reminder-binding режиме (reminder_id/task_id берёт с VM).
    /// </summary>
    public event EventHandler? UploadReminderRequested;

    /// <summary>Инвентарный номер первой позиции (одиночная передача — цель).</summary>
    public string InvNoText => _targets[0].InvNo;

    /// <summary>Число позиций диалога: 1 — одиночная из карточки, N — групповая.</summary>
    public int TargetCount => _targets.Count;

    /// <summary>Превью позиций (первые TargetPreviewLimit) — строки «Инв. № — модель».</summary>
    public ObservableCollection<TransferTargetItem> TargetItems { get; } = [];

    /// <summary>Список позиций виден при групповой передаче (N &gt; 1).</summary>
    public bool HasTargetList => _targets.Count > 1;

    /// <summary>«… и ещё N» — хвост позиций сверх превью.</summary>
    public string MoreTargetsText => _targets.Count > TargetPreviewLimit
        ? $"… и ещё {_targets.Count - TargetPreviewLimit}"
        : string.Empty;

    /// <summary>Подпись цели в заголовке: «Инв. № 100234» или «12 позиций».</summary>
    public string TargetSummaryText => _targets.Count == 1
        ? $"Инв. № {_targets[0].InvNo}"
        : FormatTransferCount(_targets.Count);

    // ---- Режим: сотруднику / по местоположению ----

    /// <summary>Заголовок диалога по режиму операции.</summary>
    public string TitleText => IsActOnlyMode
        ? "Акт без перемещения"
        : IsLocationMode
            ? "Перемещение по местоположению"
            : "Передача оборудования";

    /// <summary>Режим формы; «не менять»-заглушки есть только без обязательных полей.</summary>
    public EquipmentTransferMode Mode
    {
        get => _mode;
        private set
        {
            if (!SetProperty(ref _mode, value))
            {
                return;
            }

            OnPropertyChanged(nameof(IsEmployeeMode));
            OnPropertyChanged(nameof(IsLocationMode));
            OnPropertyChanged(nameof(IsActOnlyMode));
            OnPropertyChanged(nameof(ShowsEmployeeField));
            OnPropertyChanged(nameof(ShowsLocationFields));
            OnPropertyChanged(nameof(EmployeeLabelText));
            OnPropertyChanged(nameof(TitleText));
            OnPropertyChanged(nameof(SubmitButtonText));
            OnPropertyChanged(nameof(BranchLabelText));
            OnPropertyChanged(nameof(LocationLabelText));
            IsEmployeePopupOpen = false;
            SyncModeOptions();
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectModeCommand.
    public bool IsEmployeeMode
    {
        get => _mode == EquipmentTransferMode.Employee;
        set => ApplyModeFromUi(EquipmentTransferMode.Employee, value);
    }

    public bool IsLocationMode
    {
        get => _mode == EquipmentTransferMode.Location;
        set => ApplyModeFromUi(EquipmentTransferMode.Location, value);
    }

    public bool IsActOnlyMode
    {
        get => _mode == EquipmentTransferMode.ActOnly;
        set => ApplyModeFromUi(EquipmentTransferMode.ActOnly, value);
    }

    /// <summary>Поле сотрудника: «Сотруднику» — получатель, «Только акт» — кто выдал.</summary>
    public bool ShowsEmployeeField => !IsLocationMode;

    /// <summary>Филиал/локация скрыты в «Только акт» — позиции не перемещаются.</summary>
    public bool ShowsLocationFields => !IsActOnlyMode;

    /// <summary>Подпись поля сотрудника — «Кто выдал» в режиме «Только акт».</summary>
    public string EmployeeLabelText => IsActOnlyMode ? "Кто выдал *" : "Новый сотрудник *";

    private void ApplyModeFromUi(EquipmentTransferMode mode, bool isChecked)
    {
        if (isChecked && Mode != mode && !IsBusy && !HasResult)
        {
            Mode = mode;
        }
    }

    /// <summary>«— не менять —» в списках — только в режиме сотрудника: «по
    /// местоположению» филиал и локация обязательны — заглушки убираем, реальный
    /// выбор пользователя сохраняем при переключении туда-обратно.</summary>
    private void SyncModeOptions()
    {
        if (IsLocationMode)
        {
            if (BranchOptions.Count > 0 && ReferenceEquals(BranchOptions[0], TransferBranchOption.None))
            {
                BranchOptions.RemoveAt(0);
            }

            if (LocationOptions.Count > 0 && ReferenceEquals(LocationOptions[0], TransferLocationOption.None))
            {
                LocationOptions.RemoveAt(0);
            }

            if (ReferenceEquals(_selectedBranch, TransferBranchOption.None))
            {
                _selectedBranch = null;
                OnPropertyChanged(nameof(SelectedBranch));
                OnPropertyChanged(nameof(HasBranchSelection));
                OnPropertyChanged(nameof(AreLocationsEnabled));
            }

            if (ReferenceEquals(_selectedLocation, TransferLocationOption.None))
            {
                _selectedLocation = null;
                OnPropertyChanged(nameof(SelectedLocation));
            }
        }
        else
        {
            if (BranchOptions.Count == 0 || !ReferenceEquals(BranchOptions[0], TransferBranchOption.None))
            {
                BranchOptions.Insert(0, TransferBranchOption.None);
            }

            if (_selectedBranch is null)
            {
                _selectedBranch = TransferBranchOption.None;
                OnPropertyChanged(nameof(SelectedBranch));
                OnPropertyChanged(nameof(HasBranchSelection));
                OnPropertyChanged(nameof(AreLocationsEnabled));
            }

            if (LocationOptions.Count == 0 || !ReferenceEquals(LocationOptions[0], TransferLocationOption.None))
            {
                LocationOptions.Insert(0, TransferLocationOption.None);
            }

            if (_selectedLocation is null)
            {
                _selectedLocation = TransferLocationOption.None;
                OnPropertyChanged(nameof(SelectedLocation));
            }
        }
    }

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
                OnPropertyChanged(nameof(AreLocationsEnabled));
                // Смена филиала — локация перечитывается для нового контекста.
                ResetLocationOptions();
                if (!string.IsNullOrEmpty(value?.IdText))
                {
                    _ = LoadLocationsSafelyAsync(value.IdText);
                }
            }
        }
    }

    /// <summary>Выбран конкретный филиал — локация имеет смысл и активна.</summary>
    public bool HasBranchSelection => !string.IsNullOrEmpty(_selectedBranch?.IdText);

    /// <summary>Локация активна после выбора филиала и вне полёта сабмита.</summary>
    public bool AreLocationsEnabled => HasBranchSelection && AreInputsEnabled;

    /// <summary>Подпись поля филиала — «*» только там, где выбор обязателен.</summary>
    public string BranchLabelText => IsLocationMode ? "Филиал *" : "Филиал";

    /// <summary>Подпись поля локации — «*» только там, где выбор обязателен.</summary>
    public string LocationLabelText => IsLocationMode ? "Локация *" : "Локация";

    /// <summary>Сброс списка локаций: «— не менять —» есть только в режиме сотрудника.</summary>
    private void ResetLocationOptions()
    {
        LocationOptions.Clear();
        if (!IsLocationMode)
        {
            LocationOptions.Add(TransferLocationOption.None);
        }

        SelectedLocation = IsLocationMode ? null : TransferLocationOption.None;
    }

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
                OnPropertyChanged(nameof(SubmitButtonText));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearEmployeeCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Поле формы доступно, пока нет в полёте сабмита/поллинга.</summary>
    public bool AreInputsEnabled => !IsBusy;

    public string SubmitButtonText => IsBusy
        ? "Выполняется…"
        : IsActOnlyMode ? "Сформировать акт"
        : IsLocationMode ? "Переместить" : "Передать";

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

    // ---- Reminder «загрузить подписанный акт» (upload_reminder_* результата) ----

    /// <summary>
    /// Инфо-текст напоминания — как info-Alert веба:
    /// «Создано напоминание… Контролёр: X. [Использован fallback-контролёр.]»
    /// </summary>
    public string ReminderInfoText
    {
        get => _reminderInfoText;
        private set
        {
            if (SetProperty(ref _reminderInfoText, value))
            {
                OnPropertyChanged(nameof(HasReminderInfo));
                OnPropertyChanged(nameof(HasReminderBlock));
                ((NativeRelayCommand)OpenUploadReminderCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasReminderInfo => ReminderInfoText.Length > 0;

    /// <summary>upload_reminder_warning — предупреждение сервиса напоминаний (warning-плашка).</summary>
    public string ReminderWarningText
    {
        get => _reminderWarningText;
        private set
        {
            if (SetProperty(ref _reminderWarningText, value))
            {
                OnPropertyChanged(nameof(HasReminderWarning));
                OnPropertyChanged(nameof(HasReminderBlock));
                ((NativeRelayCommand)OpenUploadReminderCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasReminderWarning => ReminderWarningText.Length > 0;

    /// <summary>Reminder-блок виден при созданном напоминании или предупреждении — как в вебе.</summary>
    public bool HasReminderBlock => HasReminderInfo || HasReminderWarning;

    /// <summary>task_id reminder-задачи — «Открыть задачу» ведёт на страницу задач.</summary>
    public string? ReminderTaskId
    {
        get => _reminderTaskId;
        private set
        {
            if (SetProperty(ref _reminderTaskId, value))
            {
                OnPropertyChanged(nameof(HasReminderTask));
                ((NativeRelayCommand)OpenReminderTaskCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasReminderTask => ReminderTaskId is { Length: > 0 };

    /// <summary>reminder_id для binding-загрузки; пустой — привязка идёт только по task_id.</summary>
    public string? ReminderId => _reminderId;

    public ICommand SubmitCommand { get; }
    public ICommand SelectEmployeeCommand { get; }
    public ICommand ClearEmployeeCommand { get; }
    public ICommand SelectModeCommand { get; }
    public ICommand DownloadActCommand { get; }
    public ICommand OpenReminderTaskCommand { get; }
    public ICommand OpenUploadReminderCommand { get; }
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
            if (!IsLocationMode)
            {
                LocationOptions.Add(TransferLocationOption.None);
            }
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
        // Режим формы выбирает endpoint: сотруднику → /transfer, по
        // местоположению → /transfer/location, только акт → /transfer/act-only
        // (все три — тот же job-поллинг act-jobs).
        Func<CancellationToken, Task<HubTransferExecuteResponse>>? send = _mode switch
        {
            EquipmentTransferMode.Location => BuildLocationRequest() is { } locationRequest
                ? token => _api.TransferEquipmentLocationAsync(locationRequest, token)
                : null,
            EquipmentTransferMode.ActOnly => BuildActOnlyRequest() is { } actOnlyRequest
                ? token => _api.TransferActOnlyAsync(actOnlyRequest, token)
                : null,
            _ => BuildEmployeeRequest() is { } employeeRequest
                ? token => _api.TransferEquipmentAsync(employeeRequest, token)
                : null,
        };
        if (send is null)
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
        StatusText = IsActOnlyMode
            ? "Формируем акт…"
            : IsLocationMode ? "Отправляем перемещение…" : "Отправляем передачу…";
        try
        {
            var response = await send(linked.Token);
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
                ? "Операция поставлена в очередь…"
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
                StatusText = string.Empty;
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

        var verb = IsActOnlyMode ? "Подготовлено" : IsLocationMode ? "Перемещено" : "Передано";
        ResultText = response.FailedCount > 0
            ? $"{verb} {FormatTransferCount(response.SuccessCount)} · ошибок: {response.FailedCount}"
            : $"{verb} {FormatTransferCount(response.SuccessCount)}";
        HasResult = true;
        StatusText = string.Empty;
        // Акты — передача сотруднику и «только акт»; «по местоположению» их не
        // создаёт и не показывает (location_transfer-job актов не имеет).
        foreach (var act in IsLocationMode ? [] : response.Acts ?? [])
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

        // upload_reminder_* — reminder-задача «загрузить подписанный акт» (веб
        // показывает инфо-плашку + warning + «Открыть задачу»/«Загрузить акт»).
        ApplyUploadReminder(response);

        // Частичный исход: позиции с ошибкой показываем как предупреждение вверху.
        var firstFailed = response.Failed?.FirstOrDefault();
        if (response.FailedCount > 0 && firstFailed is not null)
        {
            var failVerb = IsActOnlyMode
                ? "Не подготовлено"
                : IsLocationMode ? "Не перемещено" : "Не передано";
            ErrorText = string.IsNullOrWhiteSpace(firstFailed.Error)
                ? $"{failVerb}: {firstFailed.InvNo}"
                : $"{firstFailed.InvNo}: {firstFailed.Error.Trim()}";
        }

        // «Только акт» не меняет данные позиций (веб тоже не обновляет список:
        // refreshEquipment=false) — перечитывать карточку/историю нечему.
        if (response.SuccessCount > 0 && !IsActOnlyMode)
        {
            Completed?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>
    /// upload_reminder_* терминального ответа: reminder-задача ожидания подписанных
    /// актов — инфо-текст (контролёр, fallback), предупреждение и id для кнопок.
    /// </summary>
    private void ApplyUploadReminder(HubTransferExecuteResponse response)
    {
        var warning = response.UploadReminderWarning?.Trim();
        if (!response.UploadReminderCreated && warning is not { Length: > 0 })
        {
            return;
        }

        _reminderId = string.IsNullOrWhiteSpace(response.UploadReminderId)
            ? null
            : response.UploadReminderId.Trim();
        ReminderTaskId = string.IsNullOrWhiteSpace(response.UploadReminderTaskId)
            ? null
            : response.UploadReminderTaskId.Trim();
        ReminderWarningText = warning ?? string.Empty;
        ReminderInfoText = !response.UploadReminderCreated
            ? string.Empty
            : "Создано напоминание о загрузке подписанного акта."
                + (string.IsNullOrWhiteSpace(response.UploadReminderControllerUsername)
                    ? string.Empty
                    : $" Контролёр: {response.UploadReminderControllerUsername.Trim()}.")
                + (response.UploadReminderControllerFallbackUsed
                    ? " Использован fallback-контролёр."
                    : string.Empty);
    }

    private HubEquipmentTransferRequest? BuildEmployeeRequest()
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
            InvNos = _invNos,
            NewEmployee = newEmployee,
            NewEmployeeNo = newEmployeeNo,
            BranchNo = SelectedBranch?.Id,
            LocNo = SelectedLocation?.LocNo,
            Comment = string.IsNullOrWhiteSpace(_commentText) ? null : _commentText.Trim(),
        };
    }

    /// <summary>
    /// Режим «По местоположению»: только филиал+локация (обязательные) и
    /// комментарий — как buildTransferLocationPayload веба. Без владельца.
    /// </summary>
    private HubTransferLocationRequest? BuildLocationRequest()
    {
        if (!HasBranchSelection || SelectedBranch?.Id is not { } branchNo)
        {
            ErrorText = "Выберите филиал назначения из списка.";
            return null;
        }

        if (SelectedLocation?.LocNo is not { } locNo)
        {
            ErrorText = "Выберите местоположение назначения из списка.";
            return null;
        }

        return new HubTransferLocationRequest
        {
            OperationId = OperationId,
            InvNos = _invNos,
            BranchNo = branchNo,
            LocNo = locNo,
            Comment = string.IsNullOrWhiteSpace(_commentText) ? null : _commentText.Trim(),
        };
    }

    /// <summary>
    /// Режим «Только акт»: issuer_employee обязателен — кто выдал технику
    /// (выбор из списка или ручной ввод, как у веб-диалога); получателем в акте
    /// становится текущий владелец позиции. Данные позиций не меняются.
    /// </summary>
    private HubTransferActOnlyRequest? BuildActOnlyRequest()
    {
        var issuer = SelectedEmployee;
        var issuerName = issuer?.Title ?? _employeeQuery.Trim();
        if (issuerName.Length < 2)
        {
            ErrorText = "Укажите, кто выдал технику.";
            return null;
        }

        return new HubTransferActOnlyRequest
        {
            OperationId = OperationId,
            InvNos = _invNos,
            IssuerEmployee = issuerName,
            IssuerOwnerNo = issuer?.OwnerNo,
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

// ---- Диалог карточки оборудования: «✎ Изменить» (PATCH /equipment/{inv_no}) ----
// ---- и «+ Новая позиция» (POST /equipment/create) ----

/// <summary>Режим диалога карточки: правка выбранной позиции или создание новой.</summary>
public enum EquipmentEditorMode
{
    Edit,
    Create,
}

/// <summary>Итог успешного сабмита редактора — родитель обновляет список и карточку.</summary>
public sealed class EquipmentEditorCompletedEventArgs : EventArgs
{
    /// <summary>Обновлённая карточка из ответа PATCH /equipment/{inv_no}.</summary>
    public HubEquipmentItem? UpdatedItem { get; init; }

    /// <summary>Инвентарный номер созданной позиции из ответа POST /equipment/create.</summary>
    public string? CreatedInvNo { get; init; }
}

/// <summary>Опция типа оборудования в форме редактора (type_no + подпись).</summary>
public sealed class EditorTypeOption
{
    public EditorTypeOption(int typeNo, string name)
    {
        TypeNo = typeNo;
        Name = name;
    }

    public int TypeNo { get; }
    public string Name { get; }
}

/// <summary>
/// Опция модели в форме редактора (model_no + подпись). В режиме создания
/// список только подсказывает существующие — имя можно ввести свободно.
/// </summary>
public sealed class EditorModelOption
{
    public EditorModelOption(int modelNo, string name)
    {
        ModelNo = modelNo;
        Name = name;
    }

    public int ModelNo { get; }
    public string Name { get; }
}

/// <summary>Опция статуса карточки в форме редактора (status_no + подпись).</summary>
public sealed class EditorStatusOption
{
    public EditorStatusOption(int statusNo, string name)
    {
        StatusNo = statusNo;
        Name = name;
    }

    public int StatusNo { get; }
    public string Name { get; }
}

/// <summary>Подсказка владельца из GET /equipment/owners/search (или текущий владелец карточки).</summary>
public sealed class EditorEmployeeOption
{
    public EditorEmployeeOption(long? ownerNo, string? title, string? dept)
    {
        OwnerNo = ownerNo;
        Title = (title ?? string.Empty).Trim();
        Dept = (dept ?? string.Empty).Trim();
    }

    public EditorEmployeeOption(HubEquipmentOwner owner)
        : this(owner?.OwnerNo, owner?.OwnerDisplayName, owner?.OwnerDept)
    {
    }

    /// <summary>OWNER_NO — уходит в empl_no (правка) или employee_no (создание).</summary>
    public long? OwnerNo { get; }
    public string Title { get; }

    /// <summary>Отдел владельца — уходит в employee_dept при создании.</summary>
    public string Dept { get; }
    public string MetaText => Dept;
}

/// <summary>
/// Оверлей-диалог карточки оборудования — как детальная правка и «Добавить» в вебе.
/// Правка шлёт PATCH /equipment/{inv_no} только изменёнными полями
/// (buildDetailUpdatePayload: очистка текстового поля — пустой строкой, не null).
/// Создание шлёт POST /equipment/create: обязательные серийный/сотрудник/тип/
/// модель/статус/филиал/локация; модель — опция из /equipment/models либо
/// свободное имя (сервер создаст), сотрудник — выбор из /equipment/owners/search
/// либо свободное ФИО (сервер создаст владельца). MAC нормализует сервер.
/// </summary>
public sealed class EquipmentEditorViewModel : ObservableObject
{
    /// <summary>Debounce поиска владельца — 280 мс, как у веб-формы карточки.</summary>
    private static readonly TimeSpan EmployeeSearchDebounce = TimeSpan.FromMilliseconds(280);

    /// <summary>Серверный поиск владельца — от двух символов, лимит как в вебе.</summary>
    private const int EmployeeSearchMinLength = 2;
    private const int EmployeeSearchLimit = 20;

    private readonly IHubApiClient _api;
    private readonly EquipmentEditorMode _mode;
    private readonly string? _invNo;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _employeeSearchCancellation;
    private CancellationTokenSource? _locationsCancellation;
    private CancellationTokenSource? _modelsCancellation;
    private CancellationTokenSource? _submitCancellation;

    /// <summary>
    /// Сторона сравнения diff'а — normalizeDetailComparable веба: тексты в trim,
    /// id как есть, branch/loc — текстовая форма (toIdOrNull).
    /// </summary>
    private sealed record EditorSnapshot(
        string SerialNo,
        string HwSerialNo,
        string PartNo,
        string IpAddress,
        string MacAddress,
        string NetworkName,
        string Description,
        int? TypeNo,
        int? ModelNo,
        int? StatusNo,
        long? EmplNo,
        string? BranchNoText,
        string? LocNoText);

    private EditorSnapshot _initial = EmptySnapshot();

    /// <summary>Модель/локация карточки, восстанавливаемая после загрузки зависимого справочника.</summary>
    private int? _pendingModelNo;
    private string? _pendingLocNoText;

    /// <summary>
    /// Выбор до пересборки списка опций: ComboBox синхронно пишет null в
    /// SelectedItem, когда объект уходит из ItemsSource, — значение держим здесь.
    /// </summary>
    private EditorModelOption? _staleModel;
    private TransferLocationOption? _staleLocation;

    private string _serialText = string.Empty;
    private string _hwSerialText = string.Empty;
    private string _partNoText = string.Empty;
    private string _ipText = string.Empty;
    private string _macText = string.Empty;
    private string _networkNameText = string.Empty;
    private string _descriptionText = string.Empty;
    private string _modelNameText = string.Empty;
    private string _employeeQuery = string.Empty;
    private EditorTypeOption? _selectedType;
    private EditorModelOption? _selectedModel;
    private EditorStatusOption? _selectedStatus;
    private TransferBranchOption? _selectedBranch;
    private TransferLocationOption? _selectedLocation;
    private EditorEmployeeOption? _selectedEmployee;
    private bool _isEmployeePopupOpen;
    private bool _isEmployeeSearchBusy;
    private bool _isLocationsLoading;
    private bool _isModelsLoading;
    private bool _isBusy;
    private string? _errorText;
    private string? _successText;
    private string? _createdInvNo;
    private string _statusText = string.Empty;

    private EquipmentEditorViewModel(
        IHubApiClient api,
        EquipmentEditorMode mode,
        HubEquipmentItem? item,
        IEnumerable<HubEquipmentType> types,
        IEnumerable<HubEquipmentStatus> statuses,
        IEnumerable<HubEquipmentBranch> branches,
        string? lookupError,
        Func<TimeSpan, CancellationToken, Task>? delayAsync)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _mode = mode;
        _delayAsync = delayAsync ?? Task.Delay;
        _invNo = EquipmentCatalog.InvNoParameter(item?.InvNo);
        InvNoText = item is null ? string.Empty : EquipmentCatalog.FormatInvNo(item.InvNo);
        _errorText = lookupError;

        ArgumentNullException.ThrowIfNull(types);
        ArgumentNullException.ThrowIfNull(statuses);
        ArgumentNullException.ThrowIfNull(branches);
        foreach (var type in types)
        {
            // Только оборудование — ci_type 1 (null трактуем как 1, как TypeFilterOptions страницы).
            if (type.CiType is not null and not 1)
            {
                continue;
            }

            TypeOptions.Add(new EditorTypeOption(
                type.TypeNo,
                string.IsNullOrWhiteSpace(type.TypeName) ? $"Тип {type.TypeNo}" : type.TypeName!.Trim()));
        }

        foreach (var status in statuses)
        {
            StatusOptions.Add(new EditorStatusOption(
                status.StatusNo,
                string.IsNullOrWhiteSpace(status.StatusName) ? $"Статус {status.StatusNo}" : status.StatusName!.Trim()));
        }

        foreach (var branch in branches)
        {
            if (!string.IsNullOrWhiteSpace(branch.Name))
            {
                BranchOptions.Add(new TransferBranchOption(branch));
            }
        }

        if (mode == EquipmentEditorMode.Edit && item is not null)
        {
            SeedFromItem(item);
        }

        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => AreInputsEnabled);
        SelectEmployeeCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is EditorEmployeeOption option)
            {
                SelectedEmployee = option;
                // Мимо сеттера: правка текста сбрасывает выбор — а здесь его только что сделали.
                _employeeQuery = option.Title;
                OnPropertyChanged(nameof(EmployeeQuery));
                IsEmployeePopupOpen = false;
            }
        });
        ClearEmployeeCommand = new NativeRelayCommand(
            () => SelectedEmployee = null,
            () => AreInputsEnabled);
        CloseCommand = new NativeRelayCommand(RequestClose);
        OpenCreatedCardCommand = new NativeRelayCommand(() =>
        {
            if (!string.IsNullOrWhiteSpace(_createdInvNo))
            {
                OpenCardRequested?.Invoke(this, _createdInvNo!);
            }
        });
    }

    /// <summary>Диалог правки: поля из текущей карточки (загруженная деталь).</summary>
    public static EquipmentEditorViewModel ForEdit(
        IHubApiClient api,
        HubEquipmentItem item,
        IEnumerable<HubEquipmentType> types,
        IEnumerable<HubEquipmentStatus> statuses,
        IEnumerable<HubEquipmentBranch> branches,
        string? lookupError = null,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        return new EquipmentEditorViewModel(
            api, EquipmentEditorMode.Edit, item, types, statuses, branches, lookupError, delayAsync);
    }

    /// <summary>Диалог создания: пустые поля, справочники те же.</summary>
    public static EquipmentEditorViewModel ForCreate(
        IHubApiClient api,
        IEnumerable<HubEquipmentType> types,
        IEnumerable<HubEquipmentStatus> statuses,
        IEnumerable<HubEquipmentBranch> branches,
        string? lookupError = null,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
        => new(api, EquipmentEditorMode.Create, null, types, statuses, branches, lookupError, delayAsync);

    /// <summary>Сабмит прошёл — правка вернула обновлённую карточку, создание — inv_no.</summary>
    public event EventHandler<EquipmentEditorCompletedEventArgs>? Completed;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>«Открыть карточку» из строки успеха создания — родитель выбирает позицию.</summary>
    public event EventHandler<string>? OpenCardRequested;

    public EquipmentEditorMode Mode => _mode;
    public bool IsCreate => _mode == EquipmentEditorMode.Create;
    public bool IsEdit => _mode == EquipmentEditorMode.Edit;

    /// <summary>Модель вводится свободным текстом только при создании (model_name сервер создаст).</summary>
    public bool IsModelEditable => IsCreate;

    public string TitleText => IsCreate ? "Новая позиция" : "Изменить карточку";

    /// <summary>Подзаголовок: инвентарный номер в правке, пояснение при создании.</summary>
    public string SubtitleText => IsCreate
        ? "Позиция базы ITINVENT (оборудование)"
        : $"Инв. № {InvNoText}";

    public string InvNoText { get; }

    // ---- Текстовые поля (serial/hw/part/ip/mac/network/description) ----

    public string SerialText
    {
        get => _serialText;
        set => SetProperty(ref _serialText, value ?? string.Empty);
    }

    public string HwSerialText
    {
        get => _hwSerialText;
        set => SetProperty(ref _hwSerialText, value ?? string.Empty);
    }

    public string PartNoText
    {
        get => _partNoText;
        set => SetProperty(ref _partNoText, value ?? string.Empty);
    }

    public string IpText
    {
        get => _ipText;
        set => SetProperty(ref _ipText, value ?? string.Empty);
    }

    public string MacText
    {
        get => _macText;
        set => SetProperty(ref _macText, value ?? string.Empty);
    }

    public string NetworkNameText
    {
        get => _networkNameText;
        set => SetProperty(ref _networkNameText, value ?? string.Empty);
    }

    public string DescriptionText
    {
        get => _descriptionText;
        set => SetProperty(ref _descriptionText, value ?? string.Empty);
    }

    /// <summary>Свободное имя модели при создании (model_name); при выборе опции — её имя.</summary>
    public string ModelNameText
    {
        get => _modelNameText;
        set => SetProperty(ref _modelNameText, value ?? string.Empty);
    }

    /// <summary>«*» обязательности — только у создания, как звёздочки веб-формы «Добавить».</summary>
    public string SerialLabelText => IsCreate ? "Серийный номер *" : "Серийный номер";
    public string EmployeeLabelText => IsCreate ? "Сотрудник *" : "Сотрудник";
    public string TypeLabelText => IsCreate ? "Тип *" : "Тип";
    public string ModelLabelText => IsCreate ? "Модель *" : "Модель";
    public string StatusLabelText => IsCreate ? "Статус *" : "Статус";
    public string BranchLabelText => IsCreate ? "Филиал *" : "Филиал";
    public string LocationLabelText => IsCreate ? "Локация *" : "Локация";

    // ---- Тип → модели ----

    public ObservableCollection<EditorTypeOption> TypeOptions { get; } = [];

    public EditorTypeOption? SelectedType
    {
        get => _selectedType;
        set
        {
            if (!SetProperty(ref _selectedType, value))
            {
                return;
            }

            OnPropertyChanged(nameof(HasTypeSelection));
            OnPropertyChanged(nameof(AreModelsEnabled));
            // Смена типа — список моделей перечитывается, несовместимый выбор
            // сбрасываем; исходную модель карточки восстанавливаем только
            // когда выбран исходный тип (открытие карточки / возврат к нему).
            // Устаревший выбор захватываем до Clear() — ComboBox напишет null.
            _pendingModelNo = value?.TypeNo == _initial.TypeNo ? _initial.ModelNo : null;
            _staleModel = value?.TypeNo == _initial.TypeNo ? _selectedModel : null;
            ModelOptions.Clear();
            if (value?.TypeNo is { } typeNo)
            {
                _ = LoadModelsSafelyAsync(typeNo);
            }
            else
            {
                ApplyModelReselect();
            }
        }
    }

    public bool HasTypeSelection => _selectedType is not null;

    /// <summary>Модель активна после выбора типа и вне полёта сабмита.</summary>
    public bool AreModelsEnabled => HasTypeSelection && AreInputsEnabled;

    public ObservableCollection<EditorModelOption> ModelOptions { get; } = [];

    public EditorModelOption? SelectedModel
    {
        get => _selectedModel;
        set
        {
            if (SetProperty(ref _selectedModel, value) && value is not null)
            {
                // Выбор опции синхронизирует имя модели (editable ComboBox).
                _modelNameText = value.Name;
                OnPropertyChanged(nameof(ModelNameText));
            }
        }
    }

    public bool IsModelsLoading
    {
        get => _isModelsLoading;
        private set => SetProperty(ref _isModelsLoading, value);
    }

    // ---- Статус ----

    public ObservableCollection<EditorStatusOption> StatusOptions { get; } = [];

    public EditorStatusOption? SelectedStatus
    {
        get => _selectedStatus;
        set => SetProperty(ref _selectedStatus, value);
    }

    // ---- Филиал → локации ----

    public ObservableCollection<TransferBranchOption> BranchOptions { get; } = [];

    public TransferBranchOption? SelectedBranch
    {
        get => _selectedBranch;
        set
        {
            if (!SetProperty(ref _selectedBranch, value))
            {
                return;
            }

            OnPropertyChanged(nameof(HasBranchSelection));
            OnPropertyChanged(nameof(AreLocationsEnabled));
            // Локации перечитываются под филиал (only_branch, как в веб-форме);
            // исходная локация карточки восстанавливается для исходного филиала,
            // прочий выбор держим как устаревший (form.loc_no у веба переживает
            // справочник). Захват до Clear() — ComboBox напишет null.
            _pendingLocNoText = value?.IdText == _initial.BranchNoText ? _initial.LocNoText : null;
            _staleLocation = _selectedLocation;
            LocationOptions.Clear();
            var branchId = value?.IdText;
            if (string.IsNullOrEmpty(branchId))
            {
                ApplyLocationReselect();
            }
            else
            {
                _ = LoadLocationsSafelyAsync(branchId);
            }
        }
    }

    /// <summary>Выбран филиал — локация имеет смысл и активна.</summary>
    public bool HasBranchSelection => !string.IsNullOrEmpty(_selectedBranch?.IdText);

    /// <summary>Локация активна после выбора филиала и вне полёта сабмита.</summary>
    public bool AreLocationsEnabled => HasBranchSelection && AreInputsEnabled;

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

    // ---- Сотрудник: поиск и выбор ----

    /// <summary>Строка поиска владельца; в режиме создания — это же employee_name.</summary>
    public string EmployeeQuery
    {
        get => _employeeQuery;
        set
        {
            if (SetProperty(ref _employeeQuery, value ?? string.Empty))
            {
                // Правка после выбора — намерение искать заново, выбор сбрасываем
                // (в создании employee_name остаётся набранным текстом, как у веба).
                SelectedEmployee = null;
                ScheduleEmployeeSearch();
            }
        }
    }

    public ObservableCollection<EditorEmployeeOption> EmployeeOptions { get; } = [];

    /// <summary>Выбранный владелец (owner_no уходит в empl_no/employee_no).</summary>
    public EditorEmployeeOption? SelectedEmployee
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

    // ---- Состояние ----

    /// <summary>Сабмит в полёте — поля и кнопки закрыты.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                OnPropertyChanged(nameof(AreLocationsEnabled));
                OnPropertyChanged(nameof(AreModelsEnabled));
                OnPropertyChanged(nameof(SubmitButtonText));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearEmployeeCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Поле формы доступно, пока сабмит не в полёте.</summary>
    public bool AreInputsEnabled => !IsBusy;

    public string SubmitButtonText => IsBusy
        ? "Выполняется…"
        : IsCreate ? "Добавить" : "Сохранить";

    /// <summary>Строка прогресса сабмита под формой.</summary>
    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    /// <summary>Ошибка валидации/справочников/сабмита — форма и поля сохраняются.</summary>
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

    /// <summary>Строка успеха создания («Оборудование добавлено. Инв. № …»).</summary>
    public string? SuccessText
    {
        get => _successText;
        private set
        {
            if (SetProperty(ref _successText, value))
            {
                OnPropertyChanged(nameof(HasSuccess));
            }
        }
    }

    /// <summary>Создание прошло: диалог остаётся открытым для пакетного ввода.</summary>
    public bool HasSuccess => !string.IsNullOrEmpty(SuccessText);

    public ICommand SubmitCommand { get; }
    public ICommand SelectEmployeeCommand { get; }
    public ICommand ClearEmployeeCommand { get; }
    public ICommand CloseCommand { get; }
    /// <summary>«Открыть карточку» в строке успеха создания.</summary>
    public ICommand OpenCreatedCardCommand { get; }

    /// <summary>Закрытие родителем (смена выбора/сессия): гасим поиск, справочники и сабмит.</summary>
    public void Close()
    {
        _employeeSearchCancellation?.Cancel();
        _locationsCancellation?.Cancel();
        _modelsCancellation?.Cancel();
        _submitCancellation?.Cancel();
    }

    /// <summary>✕/Отмена/Esc: отменить фон и сообщить родителю.</summary>
    private void RequestClose()
    {
        Close();
        Closed?.Invoke(this, EventArgs.Empty);
    }

    // ---- Инициализация правки из карточки ----

    private void SeedFromItem(HubEquipmentItem item)
    {
        _serialText = item.SerialNo?.Trim() ?? string.Empty;
        _hwSerialText = item.HwSerialNo?.Trim() ?? string.Empty;
        _partNoText = item.PartNo?.Trim() ?? string.Empty;
        _ipText = item.IpAddress?.Trim() ?? string.Empty;
        _macText = item.MacAddress?.Trim() ?? string.Empty;
        _networkNameText = item.NetworkName?.Trim() ?? string.Empty;
        _descriptionText = item.Description?.Trim() ?? string.Empty;
        // До сеттеров: они сравнивают выбор с _initial (тип/филиал исходной карточки).
        _initial = new EditorSnapshot(
            _serialText,
            _hwSerialText,
            _partNoText,
            _ipText,
            _macText,
            _networkNameText,
            _descriptionText,
            item.TypeNo,
            item.ModelNo,
            item.StatusNo,
            item.EmplNo,
            ToIdText(item.BranchNo),
            ToIdText(item.LocNo));

        // Синтетические опции модели/локации карточки — до выбора типа/филиала:
        // их сеттеры захватывают эти значения в stale для перевыбора после
        // загрузки зависимых списков (веб seed'ит текущие опции в справочники).
        if (item.ModelNo is { } modelNo)
        {
            _selectedModel = new EditorModelOption(
                modelNo,
                string.IsNullOrWhiteSpace(item.ModelName) ? $"Модель {modelNo}" : item.ModelName!.Trim());
        }

        if (_initial.LocNoText is not null)
        {
            _selectedLocation = new TransferLocationOption(new HubEquipmentLocation
            {
                LocNo = ToJsonElement(item.LocNo),
                LocName = FirstNonEmpty(item.Location, item.LocationName) ?? _initial.LocNoText,
            });
        }

        // Отсутствующие в справочниках значения карточки дописываем синтетическими
        // опциями — иначе ComboBox показал бы пустое поле вместо реального значения
        // (веб seed'ит текущие опции в detailModels/detailEmployeeOptions).
        if (item.TypeNo is { } typeNo)
        {
            var match = TypeOptions.FirstOrDefault(option => option.TypeNo == typeNo);
            if (match is null)
            {
                match = new EditorTypeOption(
                    typeNo,
                    string.IsNullOrWhiteSpace(item.TypeName) ? $"Тип {typeNo}" : item.TypeName!.Trim());
                TypeOptions.Add(match);
            }

            SelectedType = match;
        }

        if (item.StatusNo is { } statusNo)
        {
            var match = StatusOptions.FirstOrDefault(option => option.StatusNo == statusNo);
            if (match is null)
            {
                match = new EditorStatusOption(
                    statusNo,
                    FirstNonEmpty(item.Status, item.StatusName) ?? $"Статус {statusNo}");
                StatusOptions.Add(match);
            }

            SelectedStatus = match;
        }

        if (_initial.BranchNoText is not null)
        {
            var match = BranchOptions.FirstOrDefault(option =>
                NormalizeIdText(option.IdText) == _initial.BranchNoText);
            if (match is null)
            {
                match = new TransferBranchOption(new HubEquipmentBranch
                {
                    Id = ToJsonElement(item.BranchNo),
                    Name = item.BranchName ?? _initial.BranchNoText,
                });
                BranchOptions.Add(match);
            }

            SelectedBranch = match;
        }

        // Уведомления для прямых посевов полей (Selected* — через сеттеры выше).
        OnPropertyChanged(nameof(SelectedModel));
        OnPropertyChanged(nameof(SelectedLocation));
        if (item.EmplNo is { } emplNo)
        {
            _selectedEmployee = new EditorEmployeeOption(emplNo, item.EmployeeName, item.EmployeeDept);
            OnPropertyChanged(nameof(SelectedEmployee));
            OnPropertyChanged(nameof(HasSelectedEmployee));
        }
    }

    private static EditorSnapshot EmptySnapshot()
        => new(string.Empty, string.Empty, string.Empty, string.Empty,
            string.Empty, string.Empty, string.Empty,
            null, null, null, null, null, null);

    /// <summary>BRANCH_NO/LOC_NO карточки → текст сравнения (toIdOrNull веба).</summary>
    private static string? ToIdText(long? value)
        => value?.ToString(CultureInfo.InvariantCulture);

    private static string? NormalizeIdText(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>Числовой branch_no/loc_no карточки → сырой JSON (int|str контракта).</summary>
    private static JsonElement? ToJsonElement(long? value)
        => value is null ? null : JsonSerializer.SerializeToElement(value.Value);

    private static string? FirstNonEmpty(params string?[] values)
        => values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value))?.Trim();

    /// <summary>Текущая форма → снапшот сравнения (та же нормализация, что у _initial).</summary>
    private EditorSnapshot CurrentSnapshot()
        => new(
            _serialText.Trim(),
            _hwSerialText.Trim(),
            _partNoText.Trim(),
            _ipText.Trim(),
            _macText.Trim(),
            _networkNameText.Trim(),
            _descriptionText.Trim(),
            SelectedType?.TypeNo,
            SelectedModel?.ModelNo,
            SelectedStatus?.StatusNo,
            // Сброшенный/ненайденный выбор владельца empl_no не обнуляет —
            // PATCH не умеет снять владельца (для этого есть операция передачи).
            SelectedEmployee?.OwnerNo ?? _initial.EmplNo,
            NormalizeIdText(SelectedBranch?.IdText),
            NormalizeIdText(SelectedLocation?.LocNo?.ToString()));

    // ---- Поиск владельца (/equipment/owners/search) ----

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
        _ = SearchOwnersSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchOwnersSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(EmployeeSearchDebounce, cancellationToken);
            if (!string.Equals(_employeeQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            IsEmployeeSearchBusy = true;
            var owners = await _api.SearchEquipmentOwnersAsync(
                query, EmployeeSearchLimit, cancellationToken);
            if (!string.Equals(_employeeQuery.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            // Текущий выбор всегда в списке — как merged options у веб-формы.
            EmployeeOptions.Clear();
            var seen = new HashSet<long>();
            if (SelectedEmployee?.OwnerNo is { } currentNo)
            {
                EmployeeOptions.Add(SelectedEmployee);
                seen.Add(currentNo);
            }

            foreach (var owner in owners ?? [])
            {
                if (owner.OwnerNo is not { } ownerNo || !seen.Add(ownerNo))
                {
                    continue;
                }

                if (!string.IsNullOrWhiteSpace(owner.OwnerDisplayName))
                {
                    EmployeeOptions.Add(new EditorEmployeeOption(owner));
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

    // ---- Модели выбранного типа (/equipment/models?type_no=&ci_type=1) ----

    private async Task LoadModelsSafelyAsync(int typeNo)
    {
        _modelsCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _modelsCancellation = cancellation;
        IsModelsLoading = true;
        try
        {
            var models = await _api.GetEquipmentModelsAsync(typeNo, cancellation.Token);
            if (cancellation.IsCancellationRequested || _selectedType?.TypeNo != typeNo)
            {
                return;
            }

            ModelOptions.Clear();
            foreach (var model in models ?? [])
            {
                if (!string.IsNullOrWhiteSpace(model.ModelName))
                {
                    ModelOptions.Add(new EditorModelOption(model.ModelNo, model.ModelName!.Trim()));
                }
            }

            ApplyModelReselect();
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            // Справочник не найден — модель можно выбрать/ввести без подсказок.
            ErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            if (ReferenceEquals(_modelsCancellation, cancellation))
            {
                IsModelsLoading = false;
            }
        }
    }

    /// <summary>
    /// Перевыбор модели после загрузки списка типа: захваченное значение
    /// (pending исходной карточки или устаревший выбор) ищем в выдаче; нет —
    /// восстанавливаем сам объект, как значение form.model_no у веба.
    /// </summary>
    private void ApplyModelReselect()
    {
        var wanted = _pendingModelNo ?? _staleModel?.ModelNo;
        _pendingModelNo = null;
        var match = wanted is null
            ? null
            : ModelOptions.FirstOrDefault(option => option.ModelNo == wanted);
        SelectedModel = match ?? _staleModel;
        _staleModel = null;
    }

    // ---- Локации выбранного филиала (only_branch, как в веб-форме) ----

    private async Task LoadLocationsSafelyAsync(string branchId)
    {
        _locationsCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _locationsCancellation = cancellation;
        IsLocationsLoading = true;
        try
        {
            var locations = await _api.GetEquipmentBranchLocationsAsync(branchId, cancellation.Token);
            if (cancellation.IsCancellationRequested || _selectedBranch?.IdText != branchId)
            {
                return;
            }

            LocationOptions.Clear();
            foreach (var location in locations ?? [])
            {
                if (!string.IsNullOrWhiteSpace(location.LocName))
                {
                    LocationOptions.Add(new TransferLocationOption(location));
                }
            }

            ApplyLocationReselect();
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
            if (ReferenceEquals(_locationsCancellation, cancellation))
            {
                IsLocationsLoading = false;
            }
        }
    }

    /// <summary>
    /// Перевыбор локации после загрузки списка филиала: текущая локация
    /// сохраняется, если она есть в выдаче; при создании отсутствующая —
    /// очищается (веб сбрасывает loc_no), при правке значение переживает
    /// справочник — прежний выбор держит его, как form.loc_no веба.
    /// </summary>
    private void ApplyLocationReselect()
    {
        var wanted = _pendingLocNoText ?? NormalizeIdText(_staleLocation?.LocNo?.ToString());
        _pendingLocNoText = null;
        var match = wanted is null
            ? null
            : LocationOptions.FirstOrDefault(option =>
                NormalizeIdText(option.LocNo?.ToString()) == wanted);
        if (match is not null)
        {
            SelectedLocation = match;
        }
        else if (_mode == EquipmentEditorMode.Create)
        {
            SelectedLocation = null;
        }
        else
        {
            // Правка: значение переживает справочник — возвращаем устаревший
            // объект, его id уйдёт в loc_no diff'а (form.loc_no у веба).
            SelectedLocation = _staleLocation;
        }

        _staleLocation = null;
    }

    // ---- Отправка ----

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        if (IsCreate)
        {
            await SubmitCreateAsync(cancellationToken);
        }
        else
        {
            await SubmitEditAsync(cancellationToken);
        }
    }

    private async Task SubmitEditAsync(CancellationToken cancellationToken)
    {
        var current = CurrentSnapshot();
        if (current == _initial)
        {
            // Изменений нет — выходим без запроса, как handleDetailSave веба.
            RequestClose();
            return;
        }

        var branchChanged = !string.Equals(
            current.BranchNoText, _initial.BranchNoText, StringComparison.Ordinal);
        if (branchChanged && current.LocNoText is null)
        {
            ErrorText = "Выберите местоположение.";
            return;
        }

        var typeOrModelChanged = current.TypeNo != _initial.TypeNo
            || current.ModelNo != _initial.ModelNo;
        if (typeOrModelChanged && current.ModelNo is null)
        {
            ErrorText = "Выберите модель для выбранного типа.";
            return;
        }

        var locChanged = !string.Equals(
            current.LocNoText, _initial.LocNoText, StringComparison.Ordinal);
        var request = new HubEquipmentUpdateRequest
        {
            SerialNo = Diff(current.SerialNo, _initial.SerialNo),
            HwSerialNo = Diff(current.HwSerialNo, _initial.HwSerialNo),
            PartNo = Diff(current.PartNo, _initial.PartNo),
            IpAddress = Diff(current.IpAddress, _initial.IpAddress),
            MacAddress = Diff(current.MacAddress, _initial.MacAddress),
            NetworkName = Diff(current.NetworkName, _initial.NetworkName),
            Description = Diff(current.Description, _initial.Description),
            StatusNo = current.StatusNo != _initial.StatusNo ? current.StatusNo : null,
            EmplNo = current.EmplNo != _initial.EmplNo ? current.EmplNo : null,
            BranchNo = branchChanged ? SelectedBranch?.Id : null,
            LocNo = locChanged ? SelectedLocation?.LocNo : null,
            TypeNo = current.TypeNo != _initial.TypeNo ? current.TypeNo : null,
            ModelNo = current.ModelNo != _initial.ModelNo ? current.ModelNo : null,
        };

        await SendAsync(
            async ct =>
            {
                var updated = await _api.UpdateEquipmentAsync(_invNo!, request, ct);
                Completed?.Invoke(this, new EquipmentEditorCompletedEventArgs { UpdatedItem = updated });
            },
            cancellationToken,
            "Сохраняем изменения…");
    }

    private async Task SubmitCreateAsync(CancellationToken cancellationToken)
    {
        if (BuildCreateRequest() is not { } request)
        {
            return;
        }

        await SendAsync(
            async ct =>
            {
                var result = await _api.CreateEquipmentAsync(request, ct);
                if (!result.Success || string.IsNullOrWhiteSpace(result.InvNo))
                {
                    ErrorText = string.IsNullOrWhiteSpace(result.Message)
                        ? "Не удалось добавить оборудование."
                        : result.Message!.Trim();
                    return;
                }

                _createdInvNo = result.InvNo!.Trim();
                SuccessText = BuildCreateSuccessText(result, _createdInvNo);
                // Пакетный ввод как в вебе: сотрудник/место/тип/модель/статус
                // остаются, чистим только уникальные поля позиции.
                SerialText = string.Empty;
                HwSerialText = string.Empty;
                IpText = string.Empty;
                MacText = string.Empty;
                NetworkNameText = string.Empty;
                DescriptionText = string.Empty;
                Completed?.Invoke(this, new EquipmentEditorCompletedEventArgs
                {
                    CreatedInvNo = _createdInvNo,
                });
            },
            cancellationToken,
            "Добавляем позицию…");
    }

    /// <summary>Обязательные поля создания — тот же порядок и тексты, что у buildAddEquipmentPayload.</summary>
    private HubEquipmentCreateRequest? BuildCreateRequest()
    {
        var serial = _serialText.Trim();
        if (serial.Length == 0)
        {
            ErrorText = "Укажите серийный номер.";
            return null;
        }

        var employeeName = _employeeQuery.Trim();
        if (employeeName.Length == 0)
        {
            ErrorText = "Выберите или введите сотрудника.";
            return null;
        }

        if (SelectedType?.TypeNo is not { } typeNo)
        {
            ErrorText = "Выберите тип оборудования.";
            return null;
        }

        var modelName = _modelNameText.Trim();
        if (modelName.Length == 0)
        {
            ErrorText = "Укажите модель оборудования.";
            return null;
        }

        if (SelectedStatus?.StatusNo is not { } statusNo)
        {
            ErrorText = "Выберите статус оборудования.";
            return null;
        }

        if (SelectedBranch?.Id is not { } branchNo || !IsUsableId(branchNo))
        {
            ErrorText = "Выберите филиал.";
            return null;
        }

        if (SelectedLocation?.LocNo is not { } locNo || !IsUsableId(locNo))
        {
            ErrorText = "Выберите местоположение.";
            return null;
        }

        var mac = _macText.Trim();
        if (mac.Length > 0 && !IsMacComplete(mac))
        {
            ErrorText = "MAC-адрес должен содержать 12 символов (например, AA:BB:CC:DD:EE:FF).";
            return null;
        }

        return new HubEquipmentCreateRequest
        {
            SerialNo = serial,
            EmployeeName = employeeName,
            EmployeeNo = SelectedEmployee?.OwnerNo,
            EmployeeDept = string.IsNullOrWhiteSpace(SelectedEmployee?.Dept)
                ? null
                : SelectedEmployee!.Dept,
            BranchNo = branchNo,
            LocNo = locNo,
            TypeNo = typeNo,
            StatusNo = statusNo,
            ModelName = modelName,
            ModelNo = SelectedModel?.ModelNo,
            HwSerialNo = EmptyToNull(_hwSerialText),
            PartNo = EmptyToNull(_partNoText),
            Description = EmptyToNull(_descriptionText),
            IpAddress = EmptyToNull(_ipText),
            MacAddress = mac.Length == 0 ? null : mac,
            NetworkName = EmptyToNull(_networkNameText),
        };
    }

    /// <summary>Изменение поля: null при совпадении (свойство опускается при сериализации).</summary>
    private static string? Diff(string current, string initial)
        => current != initial ? current : null;

    private static string? EmptyToNull(string value)
    {
        var trimmed = value.Trim();
        return trimmed.Length == 0 ? null : trimmed;
    }

    private static bool IsUsableId(JsonElement element)
        => element.ValueKind is not (JsonValueKind.Null or JsonValueKind.Undefined)
            && (element.ValueKind != JsonValueKind.String
                || !string.IsNullOrWhiteSpace(element.GetString()));

    /// <summary>isMacComplete веба: 12 hex-цифр после снятия разделителей.</summary>
    private static bool IsMacComplete(string value)
        => value.Count(char.IsAsciiHexDigit) == 12;

    private static string BuildCreateSuccessText(HubEquipmentCreateResult result, string invNo)
    {
        var extra = string.Join(", ", new[]
            {
                result.CreatedOwner ? "создан сотрудник" : null,
                result.CreatedModel ? "создана модель" : null,
            }
            .Where(part => part is not null));
        return extra.Length == 0
            ? $"Оборудование добавлено. Инв. № {invNo}."
            : $"Оборудование добавлено. Инв. № {invNo} ({extra}).";
    }

    /// <summary>Общий прогон сабмита: busy + отмена при закрытии диалога.</summary>
    private async Task SendAsync(
        Func<CancellationToken, Task> send,
        CancellationToken cancellationToken,
        string status)
    {
        _submitCancellation?.Cancel();
        _submitCancellation?.Dispose();
        var submitCancellation = new CancellationTokenSource();
        _submitCancellation = submitCancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, submitCancellation.Token);
        IsBusy = true;
        StatusText = status;
        try
        {
            await send(linked.Token);
        }
        catch (OperationCanceledException) when (submitCancellation.IsCancellationRequested)
        {
            // Закрытие диалога/смена выбора — без ошибки.
        }
        finally
        {
            if (ReferenceEquals(_submitCancellation, submitCancellation))
            {
                IsBusy = false;
                StatusText = string.Empty;
            }

            linked.Dispose();
        }
    }
}

// ---- Панель сотрудника (карточка оборудования → клик по ФИО владельца) ----

/// <summary>Строка истории сотрудника (CI_HISTORY по владельцу) — как в веб EmployeeHistoryPanel.</summary>
public sealed class EmployeeHistoryEntry
{
    /// <summary>HIST_ID — ключ дедупликации на границе страниц.</summary>
    public required long? HistId { get; init; }
    public required string DateText { get; init; }

    /// <summary>«Приход»/«Расход» — direction события относительно сотрудника.</summary>
    public required string DirectionText { get; init; }
    public required bool IsIncoming { get; init; }

    /// <summary>«Тип / модель» позиции на момент события.</summary>
    public required string EquipmentText { get; init; }

    /// <summary>«Инв. № … · Сер. № …» — номера на момент события.</summary>
    public required string NumbersText { get; init; }

    /// <summary>«От кого → кому»: имя или «ID {no}», пустое — «Без владельца».</summary>
    public required string EmployeeText { get; init; }

    /// <summary>«Филиал / локация» места события.</summary>
    public required string PlaceText { get; init; }
    public required string UserText { get; init; }
    public required string CommentText { get; init; }
    public bool HasComment => !string.IsNullOrWhiteSpace(CommentText);
}

/// <summary>
/// Оверлей «карточка сотрудника»: его техника (/equipment/employee/{owner}/items)
/// и история перемещений (…/history — чипы Все/Приход/Расход, поиск q,
/// «Показать ещё»). Секции грузятся best-effort: ошибка одной панель не ломает.
/// </summary>
public sealed class EmployeePanelViewModel : ObservableObject
{
    /// <summary>Порция истории — page-size как у выдачи списка.</summary>
    private const int HistoryPageSize = 50;

    /// <summary>Debounce поля поиска по истории — как у общей строки поиска.</summary>
    private static readonly TimeSpan HistorySearchDebounce = TimeSpan.FromMilliseconds(500);

    /// <summary>direction= all — значения чипов как Literal роута бэкенда.</summary>
    internal const string DirectionAll = "all";
    internal const string DirectionIncoming = "incoming";
    internal const string DirectionOutgoing = "outgoing";

    private readonly IHubApiClient _api;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _itemsCancellation;
    private CancellationTokenSource? _historyCancellation;
    private CancellationTokenSource? _historySearchCancellation;
    private bool _isClosed;

    private string _historyQuery = string.Empty;
    private string _direction = DirectionAll;
    private int _historyNextPage = 1;
    private int _historyTotal;
    private bool _itemsLoaded;
    private bool _isItemsLoading;
    private string? _itemsErrorText;
    private string _dbErrorsText = string.Empty;
    private bool _historyLoaded;
    private bool _isHistoryLoading;
    private bool _isHistoryLoadingMore;
    private string? _historyErrorText;

    public EmployeePanelViewModel(
        IHubApiClient api,
        long ownerNo,
        string? employeeName,
        string? employeeDept,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        OwnerNo = ownerNo;
        EmployeeName = employeeName?.Trim() ?? string.Empty;
        Title = EmployeeName.Length > 0 ? EmployeeName : $"Сотрудник № {ownerNo}";
        DeptText = employeeDept?.Trim() ?? string.Empty;
        _delayAsync = delayAsync ?? Task.Delay;

        CloseCommand = new NativeRelayCommand(RequestClose);
        OpenItemCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is EquipmentItemViewModel row && row.HasInvNo)
            {
                ItemOpenRequested?.Invoke(row.Source);
            }
        });
        SelectDirectionCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is string key)
            {
                ApplyDirection(key);
            }
        });
        LoadMoreHistoryCommand = new NativeAsyncCommand(
            (_, ct) => LoadHistoryPageAsync(_historyNextPage, append: true, ct),
            ex => HistoryErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMoreHistory && !IsHistoryLoading && !IsHistoryLoadingMore);
    }

    /// <summary>OWNER_NO владельца — ключ обоих запросов панели.</summary>
    public long OwnerNo { get; }

    /// <summary>ФИО без плейсхолдера — параметр employee_name (пустое — только owner).</summary>
    public string EmployeeName { get; }

    /// <summary>Заголовок оверлея: ФИО, fallback — «Сотрудник № {owner_no}».</summary>
    public string Title { get; }

    /// <summary>Подразделение владельца — подзаголовок (пустое — скрыто).</summary>
    public string DeptText { get; }
    public bool HasDept => DeptText.Length > 0;

    /// <summary>Клик по строке техники — открыть её карточку в основной панели.</summary>
    public event Action<HubEquipmentItem>? ItemOpenRequested;

    /// <summary>✕/Esc — решение о закрытии у родителя.</summary>
    public event EventHandler? Closed;

    public ICommand CloseCommand { get; }
    public ICommand OpenItemCommand { get; }
    public ICommand SelectDirectionCommand { get; }
    public ICommand LoadMoreHistoryCommand { get; }

    // ---- Техника сотрудника ----

    /// <summary>Позиции /employee/{owner}/items — те же строки, что в выдаче поиска.</summary>
    public ObservableCollection<EquipmentItemViewModel> Items { get; } = [];

    public bool IsItemsLoading
    {
        get => _isItemsLoading;
        private set => SetProperty(ref _isItemsLoading, value);
    }

    /// <summary>Первый ответ техники получен (или ошибка) — различает пусто/грузим.</summary>
    public bool ItemsLoaded
    {
        get => _itemsLoaded;
        private set
        {
            if (SetProperty(ref _itemsLoaded, value))
            {
                OnPropertyChanged(nameof(ShowItemsEmpty));
            }
        }
    }

    public string? ItemsErrorText
    {
        get => _itemsErrorText;
        private set
        {
            if (SetProperty(ref _itemsErrorText, value))
            {
                OnPropertyChanged(nameof(HasItemsError));
                OnPropertyChanged(nameof(ShowItemsEmpty));
            }
        }
    }

    public bool HasItemsError => !string.IsNullOrEmpty(ItemsErrorText);
    public bool HasItems => Items.Count > 0;

    /// <summary>Пустая секция «Техника» — владелец есть, позиций нет.</summary>
    public bool ShowItemsEmpty => ItemsLoaded && !HasItemsError && Items.Count == 0;

    /// <summary>Сбойные базы при cross-DB выборке (db_errors) — заметка под списком.</summary>
    public string DbErrorsText
    {
        get => _dbErrorsText;
        private set
        {
            if (SetProperty(ref _dbErrorsText, value))
            {
                OnPropertyChanged(nameof(HasDbErrors));
            }
        }
    }

    public bool HasDbErrors => DbErrorsText.Length > 0;

    // ---- История сотрудника ----

    public ObservableCollection<EmployeeHistoryEntry> HistoryEntries { get; } = [];

    /// <summary>Активный direction-фильтр: all|incoming|outgoing.</summary>
    public string Direction => _direction;

    /// <summary>Чип «Все» — IsChecked радиокнопки.</summary>
    public bool IsDirectionAll
    {
        get => _direction == DirectionAll;
        set => ApplyDirection(DirectionAll, value);
    }

    /// <summary>Чип «Приход» — входящие передачи сотруднику.</summary>
    public bool IsDirectionIncoming
    {
        get => _direction == DirectionIncoming;
        set => ApplyDirection(DirectionIncoming, value);
    }

    /// <summary>Чип «Расход» — исходящие передачи от сотрудника.</summary>
    public bool IsDirectionOutgoing
    {
        get => _direction == DirectionOutgoing;
        set => ApplyDirection(DirectionOutgoing, value);
    }

    /// <summary>Поиск по истории (q: модель/инв./серийный №) — debounce-перезагрузка.</summary>
    public string HistoryQuery
    {
        get => _historyQuery;
        set
        {
            if (SetProperty(ref _historyQuery, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(ShowHistoryEmpty));
                ScheduleHistorySearch();
            }
        }
    }

    public bool IsHistoryLoading
    {
        get => _isHistoryLoading;
        private set
        {
            if (SetProperty(ref _isHistoryLoading, value))
            {
                ((NativeAsyncCommand)LoadMoreHistoryCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsHistoryLoadingMore
    {
        get => _isHistoryLoadingMore;
        private set
        {
            if (SetProperty(ref _isHistoryLoadingMore, value))
            {
                OnPropertyChanged(nameof(LoadMoreHistoryText));
                ((NativeAsyncCommand)LoadMoreHistoryCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Первый ответ истории получен (или ошибка) — различает пусто/грузим.</summary>
    public bool HistoryLoaded
    {
        get => _historyLoaded;
        private set
        {
            if (SetProperty(ref _historyLoaded, value))
            {
                OnPropertyChanged(nameof(ShowHistoryEmpty));
                OnPropertyChanged(nameof(HasMoreHistory));
                ((NativeAsyncCommand)LoadMoreHistoryCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public int HistoryTotal
    {
        get => _historyTotal;
        private set
        {
            if (SetProperty(ref _historyTotal, value))
            {
                OnPropertyChanged(nameof(HistoryStatusText));
                OnPropertyChanged(nameof(HasMoreHistory));
                OnPropertyChanged(nameof(LoadMoreHistoryText));
            }
        }
    }

    public string? HistoryErrorText
    {
        get => _historyErrorText;
        private set
        {
            if (SetProperty(ref _historyErrorText, value))
            {
                OnPropertyChanged(nameof(HasHistoryError));
                OnPropertyChanged(nameof(ShowHistoryEmpty));
            }
        }
    }

    public bool HasHistoryError => !string.IsNullOrEmpty(HistoryErrorText);
    public bool HasHistoryEntries => HistoryEntries.Count > 0;

    /// <summary>Пустая секция «История» — по фильтрам или вообще.</summary>
    public bool ShowHistoryEmpty => HistoryLoaded && !HasHistoryError && HistoryEntries.Count == 0;

    /// <summary>Текст пустой истории: под фильтры или «пока пустая».</summary>
    public string HistoryEmptyText => HasHistoryFilters
        ? "По выбранным фильтрам перемещений не найдено."
        : "История перемещений сотрудника пока пустая.";

    private bool HasHistoryFilters
        => _direction != DirectionAll || _historyQuery.Trim().Length > 0;

    /// <summary>На сервере остались страницы (count &lt; total) — «Показать ещё» видна.</summary>
    public bool HasMoreHistory => HistoryLoaded && HistoryEntries.Count < HistoryTotal;

    /// <summary>Метка счётчика истории — «Показано 12 из 34».</summary>
    public string HistoryStatusText => HistoryTotal > 0
        ? $"Показано {HistoryEntries.Count} из {HistoryTotal}"
        : string.Empty;

    /// <summary>Подпись «Показать ещё» с остатком — как MoreButtonText выдачи.</summary>
    public string LoadMoreHistoryText => IsHistoryLoadingMore
        ? "Загружаем…"
        : HistoryTotal > HistoryEntries.Count
            ? $"Показать ещё ({HistoryTotal - HistoryEntries.Count})"
            : "Показать ещё";

    /// <summary>Запуск загрузки секций: техника + первая страница истории.</summary>
    internal void Start()
    {
        _ = LoadItemsSafelyAsync();
        _ = ReloadHistoryAsync();
    }

    /// <summary>Закрытие родителем (смена карточки/выбора): гасим летящие запросы.</summary>
    public void Close()
    {
        _isClosed = true;
        _itemsCancellation?.Cancel();
        _historyCancellation?.Cancel();
        _historySearchCancellation?.Cancel();
    }

    /// <summary>✕/Esc: отменить фон и сообщить родителю.</summary>
    private void RequestClose()
    {
        Close();
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private async Task LoadItemsSafelyAsync()
    {
        _itemsCancellation?.Cancel();
        _itemsCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _itemsCancellation = cancellation;
        IsItemsLoading = true;
        try
        {
            var response = await _api.GetEmployeeItemsAsync(
                OwnerNo, EmployeeName, cancellation.Token);
            if (_isClosed || cancellation.IsCancellationRequested)
            {
                return;
            }

            Items.Clear();
            foreach (var equipment in response.Equipment ?? [])
            {
                Items.Add(new EquipmentItemViewModel(equipment));
            }

            DbErrorsText = response.DbErrors?.Count > 0
                ? "Не удалось получить данные из баз: " + string.Join(", ", response.DbErrors)
                : string.Empty;
            ItemsErrorText = null;
            ItemsLoaded = true;
            OnPropertyChanged(nameof(HasItems));
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            if (_isClosed || cancellation.IsCancellationRequested)
            {
                return;
            }

            ItemsErrorText = TasksViewModel.DescribeError(exception);
            ItemsLoaded = true;
        }
        finally
        {
            if (ReferenceEquals(_itemsCancellation, cancellation))
            {
                IsItemsLoading = false;
            }
        }
    }

    /// <summary>Смена direction/q: история перечитывается с первой страницы.</summary>
    private async Task ReloadHistoryAsync()
    {
        HistoryEntries.Clear();
        _historyNextPage = 1;
        HistoryTotal = 0;
        HistoryLoaded = false;
        HistoryErrorText = null;
        OnPropertyChanged(nameof(HasHistoryEntries));
        OnPropertyChanged(nameof(HistoryStatusText));
        await LoadHistoryPageAsync(1, append: false, CancellationToken.None);
    }

    /// <summary>
    /// Страница /employee/{owner}/history: append=false — после смены фильтров,
    /// true — «Показать ещё». Устаревший ответ отменённым CTS не применяем.
    /// </summary>
    private async Task LoadHistoryPageAsync(
        int page,
        bool append,
        CancellationToken cancellationToken)
    {
        _historyCancellation?.Cancel();
        _historyCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _historyCancellation = cancellation;
        var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, cancellation.Token);
        if (append)
        {
            IsHistoryLoadingMore = true;
        }
        else
        {
            IsHistoryLoading = true;
        }

        try
        {
            var response = await _api.GetEmployeeHistoryAsync(
                OwnerNo, _direction, _historyQuery.Trim(), page, HistoryPageSize, linked.Token);
            if (_isClosed || cancellation.IsCancellationRequested)
            {
                return;
            }

            if (append)
            {
                // Дедуп по hist_id — повторные строки на границе страниц.
                var known = new HashSet<long>(
                    HistoryEntries.Select(entry => entry.HistId)
                        .Where(id => id.HasValue)
                        .Select(id => id!.Value));
                foreach (var row in response.History ?? [])
                {
                    if (row.HistId is { } histId && !known.Add(histId))
                    {
                        continue;
                    }

                    HistoryEntries.Add(ToEntry(row));
                }
            }
            else
            {
                HistoryEntries.Clear();
                foreach (var row in response.History ?? [])
                {
                    HistoryEntries.Add(ToEntry(row));
                }
            }

            HistoryTotal = response.Total;
            var servedPage = response.Page > 0 ? response.Page : page;
            _historyNextPage = servedPage + 1;
            HistoryLoaded = true;
            HistoryErrorText = null;
            OnPropertyChanged(nameof(HasHistoryEntries));
            OnPropertyChanged(nameof(HistoryStatusText));
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            if (!_isClosed && !cancellation.IsCancellationRequested)
            {
                HistoryErrorText = TasksViewModel.DescribeError(exception);
                HistoryLoaded = true;
            }
        }
        finally
        {
            if (ReferenceEquals(_historyCancellation, cancellation))
            {
                IsHistoryLoading = false;
                IsHistoryLoadingMore = false;
            }

            linked.Dispose();
        }
    }

    /// <summary>Чип направления: смена — перечитать историю с первой страницы.</summary>
    private void ApplyDirection(string direction, bool isChecked = true)
    {
        if (!isChecked || _direction == direction)
        {
            return;
        }

        _direction = direction;
        OnPropertyChanged(nameof(Direction));
        OnPropertyChanged(nameof(IsDirectionAll));
        OnPropertyChanged(nameof(IsDirectionIncoming));
        OnPropertyChanged(nameof(IsDirectionOutgoing));
        OnPropertyChanged(nameof(ShowHistoryEmpty));
        _ = ReloadHistoryAsync();
    }

    /// <summary>Debounce 500 мс: изменение q перечитывает историю с первой страницы.</summary>
    private void ScheduleHistorySearch()
    {
        _historySearchCancellation?.Cancel();
        _historySearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _historySearchCancellation = cancellation;
        var query = _historyQuery.Trim();
        _ = SearchHistorySafelyAsync(query, cancellation.Token);
    }

    private async Task SearchHistorySafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(HistorySearchDebounce, cancellationToken);
            // Строка уже сменилась — поиск устарел.
            if (!string.Equals(_historyQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            await ReloadHistoryAsync();
        }
        catch (OperationCanceledException)
        {
        }
    }

    private static EmployeeHistoryEntry ToEntry(HubEmployeeHistoryRow row)
    {
        var isIncoming = string.Equals(row.Direction, "incoming", StringComparison.OrdinalIgnoreCase);
        var equipmentText = string.Join(
            " / ",
            new[] { row.TypeName, row.ModelName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        var numbers = new List<string>
        {
            "Инв. № " + (EquipmentCatalog.FormatInvNo(row.InvNo) is { Length: > 0 } inv ? inv : "—"),
            "Сер. № " + (string.IsNullOrWhiteSpace(row.SerialNo) ? "—" : row.SerialNo.Trim()),
        };
        var placeText = string.Join(
            " / ",
            new[] { row.BranchName, row.LocationName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim()));
        return new EmployeeHistoryEntry
        {
            HistId = row.HistId,
            DateText = FormatHistoryDate(row.ChDate),
            DirectionText = isIncoming ? "Приход" : "Расход",
            IsIncoming = isIncoming,
            EquipmentText = equipmentText.Length > 0 ? equipmentText : "Техника не указана",
            NumbersText = string.Join(" · ", numbers),
            EmployeeText = EmployeeTransition(row),
            PlaceText = placeText.Length > 0 ? placeText : "—",
            UserText = string.IsNullOrWhiteSpace(row.ChUser) ? "—" : row.ChUser.Trim(),
            CommentText = row.ChComment?.Trim() ?? string.Empty,
        };
    }

    /// <summary>«От кого → кому» как в веб-панели: имя, иначе «ID {no}», иначе «Без владельца».</summary>
    private static string EmployeeTransition(HubEmployeeHistoryRow row)
    {
        return EmployeePerson(row.OldEmployeeName, row.OldEmployeeNo)
            + " → "
            + EmployeePerson(row.NewEmployeeName, row.NewEmployeeNo);
    }

    private static string EmployeePerson(string? name, long? ownerNo)
    {
        if (!string.IsNullOrWhiteSpace(name))
        {
            return name.Trim();
        }

        return ownerNo is > 0
            ? $"ID {ownerNo.Value.ToString(CultureInfo.InvariantCulture)}"
            : "Без владельца";
    }

    /// <summary>Дата события: ISO/UTC сервера — локальная «dd.MM.yyyy HH:mm».</summary>
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

    /// <summary>Причина отклонения фото — ограничение бэкенда (EquipmentPhotoRejectRequest).</summary>
    private const int PhotoRejectReasonMaxLength = 500;

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
    private EquipmentEditorViewModel? _editor;
    private EmployeePanelViewModel? _employee;
    private MaintenanceDialogViewModel? _maintenance;

    /// <summary>Сырая карточка выбранной позиции — исходные поля для диалога правки.</summary>
    private HubEquipmentItem? _detailItem;

    /// <summary>item_id карточки, чьи фото в превью — цель загрузки и модерации.</summary>
    private long? _photosItemId;

    /// <summary>verification_available / verify_permitted последнего ответа photos.</summary>
    private bool _photoVerificationAvailable;
    private bool _photoVerifyPermitted;

    /// <summary>rev-ключи /photos/{no}/content после rotate — сброс кэша картинок.</summary>
    private readonly Dictionary<long, int> _photoRevisions = new();
    private EquipmentPhotoUploadViewModel? _photoUpload;
    private UploadedActViewModel? _uploadAct;
    private DatabasePhotoItem? _photoRejectTarget;
    private bool _isPhotoRejectOpen;
    private bool _photoRejectEditing;
    private bool _isPhotoRejectBusy;
    private string _photoRejectReason = string.Empty;
    private string? _photoRejectErrorText;

    /// <summary>Диалог открыт из чекбоксов списка — завершение снимает выбор.</summary>
    private bool _transferFromSelection;

    /// <summary>После done список перечитываем при закрытии результата (там акты).</summary>
    private bool _reloadListOnTransferClose;

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
        AddPhotoCommand = new NativeRelayCommand(
            OpenPhotoUpload,
            () => CanAddPhoto && !IsPhotoUploadOpen);
        VerifyPhotoCommand = new NativeAsyncCommand(
            (parameter, ct) => VerifyPhotoAsync(parameter, ct),
            ex =>
            {
                if (ex is not OperationCanceledException)
                {
                    BannerErrorText = TasksViewModel.DescribeError(ex);
                }
            },
            parameter => parameter is DatabasePhotoItem { ShowVerifyButton: true });
        RotatePhotoCommand = new NativeAsyncCommand(
            (parameter, ct) => RotatePhotoAsync(parameter, ct),
            ex =>
            {
                if (ex is not OperationCanceledException)
                {
                    BannerErrorText = TasksViewModel.DescribeError(ex);
                }
            },
            parameter => parameter is DatabasePhotoItem && CanRotatePhotos);
        OpenRejectPhotoCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DatabasePhotoItem item)
            {
                OpenPhotoReject(item, editing: false);
            }
        });
        EditRejectPhotoCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DatabasePhotoItem item)
            {
                OpenPhotoReject(item, editing: true);
            }
        });
        ConfirmRejectPhotoCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmPhotoRejectAsync(ct),
            ex =>
            {
                if (ex is not OperationCanceledException)
                {
                    PhotoRejectErrorText = TasksViewModel.DescribeError(ex);
                }
            });
        CancelRejectPhotoCommand = new NativeRelayCommand(ClosePhotoReject, () => !IsPhotoRejectBusy);
        OpenTransferCommand = new NativeAsyncCommand(
            (_, ct) => OpenTransferAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectAllCommand = new NativeRelayCommand(
            () => SetAllChecked(true), () => Items.Count > 0);
        ClearSelectionCommand = new NativeRelayCommand(
            () => SetAllChecked(false), () => HasSelection);
        OpenTransferSelectedCommand = new NativeAsyncCommand(
            (_, ct) => OpenTransferSelectedAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection);
        OpenUploadActCommand = new NativeAsyncCommand(
            (_, ct) => OpenUploadActAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenEditCommand = new NativeAsyncCommand(
            (_, ct) => OpenEditorAsync(create: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenCreateCommand = new NativeAsyncCommand(
            (_, ct) => OpenEditorAsync(create: true, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenEmployeeCommand = new NativeRelayCommand(
            OpenEmployee, () => Detail?.HasOwner == true);
        OpenMaintenanceCommand = new NativeAsyncCommand(
            (parameter, ct) => OpenMaintenanceAsync(parameter, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is EquipmentWorkStreamViewModel);
        Items.CollectionChanged += (_, args) =>
        {
            // Чекбоксы строк подписаны как у bulk-панели почты: счётчик выбора
            // пересчитывается по IsChecked каждой позиции.
            if (args.OldItems is not null)
            {
                foreach (EquipmentItemViewModel item in args.OldItems)
                {
                    item.PropertyChanged -= OnItemCheckedChanged;
                }
            }

            if (args.NewItems is not null)
            {
                foreach (EquipmentItemViewModel item in args.NewItems)
                {
                    item.PropertyChanged += OnItemCheckedChanged;
                }
            }

            OnSelectionChanged();
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(ShowSearchPlaceholder));
            OnPropertyChanged(nameof(MoreButtonText));
        };
        PhotoPreviews.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasPhotoPreviews));
        WorkStreams.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasWorkStreams));
    }

    // ---- Список и фильтры ----

    public ObservableCollection<EquipmentItemViewModel> Items { get; } = [];

    /// <summary>
    /// Секция «Работы» карточки: потоки журнальных операций по типам
    /// (картридж/комплектующие/батарея/чистка — набор зависит от типа позиции).
    /// </summary>
    public ObservableCollection<EquipmentWorkStreamViewModel> WorkStreams { get; } = [];
    public bool HasWorkStreams => WorkStreams.Count > 0;

    // ---- Массовый выбор позиций (чекбоксы строк → групповая передача) ----

    /// <summary>Число отмеченных чекбоксом позиций.</summary>
    public int SelectedCount => Items.Count(item => item.IsChecked);

    public bool HasSelection => SelectedCount > 0;

    /// <summary>Подпись счётчика выбора — «Выбрано: N», как у bulk-панели почты.</summary>
    public string SelectionText => $"Выбрано: {SelectedCount}";

    /// <summary>Кнопка групповой передачи — «⇄ Передать выбранные (N)».</summary>
    public string TransferSelectionText => $"⇄ Передать выбранные ({SelectedCount})";

    private void OnItemCheckedChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName is nameof(EquipmentItemViewModel.IsChecked) or "")
        {
            OnSelectionChanged();
        }
    }

    private void OnSelectionChanged()
    {
        OnPropertyChanged(nameof(SelectedCount));
        OnPropertyChanged(nameof(HasSelection));
        OnPropertyChanged(nameof(SelectionText));
        OnPropertyChanged(nameof(TransferSelectionText));
        ((NativeRelayCommand)SelectAllCommand).RaiseCanExecuteChanged();
        ((NativeRelayCommand)ClearSelectionCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)OpenTransferSelectedCommand).RaiseCanExecuteChanged();
    }

    /// <summary>
    /// Отметить/снять все строки текущей выдачи («☑ Все» / «✕»). Без инв. №
    /// позиция непередаваема (чекбокс в UI выключен) — «все» её не отмечает.
    /// </summary>
    internal void SetAllChecked(bool isChecked)
    {
        foreach (var item in Items)
        {
            item.IsChecked = isChecked && item.HasInvNo;
        }

        OnSelectionChanged();
    }

    /// <summary>
    /// Превью фото: миниатюра + идентификаторы контента и состояние модерации
    /// из /equipment/{id}/photos (EquipmentPhotoItem). Отметки обновляем из
    /// ответов verify/reject, миниатюру — после rotate (через rev в URL).
    /// </summary>
    public sealed class DatabasePhotoItem : ObservableObject
    {
        private ImageSource? _image;
        private string _fileName = string.Empty;
        private bool _verified;
        private string? _verifiedBy;
        private bool _rejected;
        private string? _rejectedBy;
        private string? _rejectReason;

        public required long ItemId { get; init; }
        public required long FileNo { get; init; }

        /// <summary>Миниатюра; может быть пустой, пока thumb ещё грузится.</summary>
        public required ImageSource? Image
        {
            get => _image;
            set => SetProperty(ref _image, value);
        }

        public string FileName
        {
            get => _fileName;
            private set => SetProperty(ref _fileName, value);
        }

        public string? Description { get; private set; }

        public bool Verified
        {
            get => _verified;
            private set => SetProperty(ref _verified, value);
        }

        public string? VerifiedBy
        {
            get => _verifiedBy;
            private set => SetProperty(ref _verifiedBy, value);
        }

        public bool Rejected
        {
            get => _rejected;
            private set => SetProperty(ref _rejected, value);
        }

        public string? RejectedBy
        {
            get => _rejectedBy;
            private set => SetProperty(ref _rejectedBy, value);
        }

        public string? RejectReason
        {
            get => _rejectReason;
            private set => SetProperty(ref _rejectReason, value);
        }

        /// <summary>Загрузил текущий пользователь — свои фото сам не проверяет.</summary>
        public bool IsOwn { get; private set; }

        public bool CanVerify { get; private set; }
        public bool CanReject { get; private set; }
        public bool CanUnverify { get; private set; }

        /// <summary>
        /// verification_available && verify_permitted ответа списка — единый гейт
        /// кнопок модерации (право уточняет сервер, повторно /auth/me не дёргаем).
        /// </summary>
        internal bool ModerationAllowed { get; set; }

        // ---- Отображение статуса ----

        /// <summary>Бейдж на превью: «✓» проверено / «✕» отклонено / пусто.</summary>
        public string StatusBadgeText => Verified ? "✓" : Rejected ? "✕" : string.Empty;
        public bool HasStatusBadge => Verified || Rejected;

        /// <summary>Подсказка бейджа — причина отклонения или «проверено».</summary>
        public string StatusTooltip => Verified
            ? "Проверено"
            : Rejected
                ? string.IsNullOrWhiteSpace(RejectReason)
                    ? "Отклонено"
                    : "Отклонено: " + RejectReason.Trim()
                : string.Empty;

        /// <summary>Строка статуса в полном кадре — как footer модерации в вебе.</summary>
        public string StatusLineText => Verified
            ? "✓ Проверено" + WhoSuffix(VerifiedBy)
            : Rejected
                ? "✕ Отклонено" + WhoSuffix(RejectedBy)
                : IsOwn
                    ? "На проверке · загрузили вы — отметит модератор"
                    : "На проверке";

        /// <summary>Строка причины отклонения под статусом (обёртка до 500 симв.).</summary>
        public string RejectReasonText => Rejected && !string.IsNullOrWhiteSpace(RejectReason)
            ? "Причина: " + RejectReason.Trim()
            : string.Empty;
        public bool HasRejectReason => RejectReasonText.Length > 0;

        // ---- Кнопки модерации на карточке полного кадра ----

        public bool ShowVerifyButton => ModerationAllowed && CanVerify;
        public bool ShowRejectButton => ModerationAllowed && CanReject;
        public bool ShowEditReasonButton => ModerationAllowed && Rejected && CanUnverify;

        /// <summary>Инициализация из строки списка photos (флаги гейтов — из ответа).</summary>
        internal void Initialize(HubEquipmentPhoto photo)
        {
            FileName = photo.FileName?.Trim() ?? string.Empty;
            Description = photo.Description;
            _verified = photo.Verified;
            _verifiedBy = photo.VerifiedBy;
            _rejected = photo.Rejected;
            _rejectedBy = photo.RejectedBy;
            _rejectReason = photo.RejectReason;
            IsOwn = photo.IsOwn;
            CanVerify = photo.CanVerify;
            CanReject = photo.CanReject;
            CanUnverify = photo.CanUnverify;
            RaiseModerationChanged();
        }

        /// <summary>Применить ответ verify: отметка «проверено» (как applyMark веба).</summary>
        internal void ApplyVerification(HubEquipmentPhoto photo)
        {
            Verified = true;
            if (!string.IsNullOrWhiteSpace(photo.VerifiedBy))
            {
                VerifiedBy = photo.VerifiedBy;
            }

            CanVerify = false;
            // Свою отметку модератор снимает (DELETE verify) — как в веб-клиенте.
            CanUnverify = true;
            RaiseModerationChanged();
        }

        /// <summary>Применить ответ reject/patch: отметка «отклонено» + причина.</summary>
        internal void ApplyRejection(HubEquipmentPhoto photo)
        {
            Rejected = true;
            if (!string.IsNullOrWhiteSpace(photo.RejectedBy))
            {
                RejectedBy = photo.RejectedBy;
            }

            RejectReason = photo.RejectReason;
            CanVerify = true;
            CanReject = false;
            CanUnverify = true;
            RaiseModerationChanged();
        }

        /// <summary>После rotate сервер мог сменить имя файла (jpg/png по формату).</summary>
        internal void ApplyRotation(HubEquipmentPhotoRotateResult result)
        {
            if (!string.IsNullOrWhiteSpace(result.FileName))
            {
                FileName = result.FileName.Trim();
            }
        }

        private void RaiseModerationChanged()
        {
            OnPropertyChanged(nameof(StatusBadgeText));
            OnPropertyChanged(nameof(HasStatusBadge));
            OnPropertyChanged(nameof(StatusTooltip));
            OnPropertyChanged(nameof(StatusLineText));
            OnPropertyChanged(nameof(RejectReasonText));
            OnPropertyChanged(nameof(HasRejectReason));
            OnPropertyChanged(nameof(ShowVerifyButton));
            OnPropertyChanged(nameof(ShowRejectButton));
            OnPropertyChanged(nameof(ShowEditReasonButton));
        }

        private static string WhoSuffix(string? user) =>
            string.IsNullOrWhiteSpace(user) ? string.Empty : " · " + user.Trim();
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
            // Редактор привязан к карточке тем же образом: новый выбор гасит его.
            CloseEditor();
            // Панель сотрудника — тоже привязка к карточке: закрываем с выбором.
            CloseEmployee();
            if (value is null)
            {
                // Снятие выбора: гасим летящий запрос и прячем карточку без ошибки.
                _detailLoadCancellation?.Cancel();
                Detail = null;
                _detailItem = null;
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
                _detailItem = null;
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
                ((NativeRelayCommand)OpenEmployeeCommand).RaiseCanExecuteChanged();
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
                OnPropertyChanged(nameof(PhotoHeaderText));
                OnPropertyChanged(nameof(HasPhotos));
                OnPropertyChanged(nameof(ShowPhotoSection));
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
                OnPropertyChanged(nameof(PhotoHeaderText));
                OnPropertyChanged(nameof(HasPhotos));
                OnPropertyChanged(nameof(ShowPhotoSection));
            }
        }
    }

    public bool HasPhotos => PhotosLoaded && PhotoCount > 0;

    /// <summary>Загруженные превью фото карточки (первые снимки, thumb-контент).</summary>
    public ObservableCollection<DatabasePhotoItem> PhotoPreviews { get; } = [];

    private ImageSource? _photoViewerImage;
    private bool _isPhotoViewerOpen;
    private DatabasePhotoItem? _photoViewerItem;

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

    /// <summary>Фото полного кадра: статус и кнопки модерации под изображением.</summary>
    public DatabasePhotoItem? PhotoViewerItem
    {
        get => _photoViewerItem;
        private set => SetProperty(ref _photoViewerItem, value);
    }

    /// <summary>Клик по превью: оверлей с миниатюрой + догрузка полного кадра (без thumb).</summary>
    private async Task OpenPhotoViewerAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not DatabasePhotoItem item)
        {
            return;
        }

        PhotoViewerItem = item;
        PhotoViewerImage = item.Image;
        IsPhotoViewerOpen = true;
        var image = await _imageLoader.LoadAsync(
            PhotoContentUri(item, thumb: false),
            decodePixelWidth: 1600,
            cancellationToken);
        if (image is not null && IsPhotoViewerOpen && ReferenceEquals(PhotoViewerItem, item))
        {
            PhotoViewerImage = image;
        }
    }

    private void ClosePhotoViewer()
    {
        IsPhotoViewerOpen = false;
        PhotoViewerImage = null;
        PhotoViewerItem = null;
    }

    /// <summary>
    /// URL контента фото; ?v=N после rotate — иначе AuthImageLoader и сервер
    /// отдают закэшированный доротационный кадр (как ?v= в веб-превью).
    /// </summary>
    private string PhotoContentUri(DatabasePhotoItem item, bool thumb)
    {
        var uri = "equipment/" + item.ItemId + "/photos/" + item.FileNo + "/content";
        var hasQuery = false;
        if (thumb)
        {
            uri += "?thumb=true";
            hasQuery = true;
        }

        if (_photoRevisions.TryGetValue(item.FileNo, out var revision) && revision > 0)
        {
            uri += (hasQuery ? "&" : "?") + "v=" + revision.ToString(CultureInfo.InvariantCulture);
        }

        return uri;
    }

    // ---- Фото: загрузка и модерация (write-флоу) ----

    /// <summary>
    /// Шов выбора файла (OpenFileDialog — в code-behind, паттерн билетов/почты).
    /// Возвращает пути; берём первый — фото грузится по одному.
    /// </summary>
    public Func<IReadOnlyList<string>>? PhotoFilePicker { get; set; }

    /// <summary>Карточка с item_id и правом database.write — «+ Добавить фото».</summary>
    public bool CanAddPhoto => CanTransfer && _photosItemId is not null;

    /// <summary>Секция фото видна, если есть снимки или их можно добавить.</summary>
    public bool ShowPhotoSection => (PhotosLoaded && PhotoCount > 0) || CanAddPhoto;

    /// <summary>
    /// Поворот доступен при database.write ИЛИ database.photo_verify —
    /// контракт роута rotate бэкенда (verify_permitted берём из списка photos).
    /// </summary>
    public bool CanRotatePhotos => CanTransfer || _photoVerifyPermitted;

    /// <summary>Открытый диалог загрузки фото; null — закрыт.</summary>
    public EquipmentPhotoUploadViewModel? PhotoUpload
    {
        get => _photoUpload;
        private set
        {
            if (SetProperty(ref _photoUpload, value))
            {
                OnPropertyChanged(nameof(IsPhotoUploadOpen));
                ((NativeRelayCommand)AddPhotoCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsPhotoUploadOpen => PhotoUpload is not null;

    /// <summary>Диалог ввода причины отклонения открыт.</summary>
    public bool IsPhotoRejectOpen
    {
        get => _isPhotoRejectOpen;
        private set => SetProperty(ref _isPhotoRejectOpen, value);
    }

    /// <summary>Идёт POST/PATCH reject — кнопки диалога выключены.</summary>
    public bool IsPhotoRejectBusy
    {
        get => _isPhotoRejectBusy;
        private set
        {
            if (SetProperty(ref _isPhotoRejectBusy, value))
            {
                ((NativeRelayCommand)CancelRejectPhotoCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Заголовок диалога причины: POST — «Отклонить фото», PATCH — «Изменить…».</summary>
    public string PhotoRejectTitle => _photoRejectEditing
        ? "Изменить причину отклонения"
        : "Отклонить фото";

    /// <summary>Кнопка подтверждения диалога причины.</summary>
    public string PhotoRejectConfirmText => _photoRejectEditing ? "Сохранить" : "Отклонить";

    /// <summary>Введённая причина (TwoWay); обязательна, сервер режет до 500 символов.</summary>
    public string PhotoRejectReason
    {
        get => _photoRejectReason;
        set
        {
            if (SetProperty(ref _photoRejectReason, value ?? string.Empty))
            {
                PhotoRejectErrorText = null;
            }
        }
    }

    public string? PhotoRejectErrorText
    {
        get => _photoRejectErrorText;
        private set
        {
            if (SetProperty(ref _photoRejectErrorText, value))
            {
                OnPropertyChanged(nameof(HasPhotoRejectError));
            }
        }
    }

    public bool HasPhotoRejectError => !string.IsNullOrEmpty(PhotoRejectErrorText);

    /// <summary>
    /// «+ Добавить фото»: сначала выбор файла; диалог открываем только с файлом
    /// — отмена в OpenFileDialog ничего не показывает (как в веб-кнопке).
    /// </summary>
    private void OpenPhotoUpload()
    {
        if (_photosItemId is not { } itemId)
        {
            return;
        }

        var path = PhotoFilePicker?.Invoke().FirstOrDefault();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        ClosePhotoUpload();
        var upload = new EquipmentPhotoUploadViewModel(_api, itemId, PhotoFilePicker);
        upload.Uploaded += PhotoUpload_Uploaded;
        upload.Closed += PhotoUpload_Closed;
        PhotoUpload = upload;
        upload.SelectFile(path);
    }

    /// <summary>Фото вставлено: счётчик +1, строка в галерею с локальным превью.</summary>
    private void PhotoUpload_Uploaded(object? sender, HubEquipmentPhotoUploadResult result)
    {
        var localPath = (sender as EquipmentPhotoUploadViewModel)?.SelectedPath;
        ClosePhotoUpload();
        _ = AppendUploadedPhotoAsync(result, localPath);
    }

    private void PhotoUpload_Closed(object? sender, EventArgs e)
    {
        if (sender is EquipmentPhotoUploadViewModel upload)
        {
            upload.Uploaded -= PhotoUpload_Uploaded;
            upload.Closed -= PhotoUpload_Closed;
        }

        PhotoUpload = null;
    }

    // ---- Загрузка подписанного акта (тулбар «⇪ Загрузить акт», write-флоу) ----

    /// <summary>
    /// Шов выбора PDF (OpenFileDialog — в code-behind, как у фото). Возвращает
    /// пути; берём первый — акт грузится по одному.
    /// </summary>
    public Func<IReadOnlyList<string>>? ActFilePicker { get; set; }

    /// <summary>
    /// Шов скачивания записанного акта (doc_no → Task): тесты подменяют
    /// потоковую запись в %TEMP% + Process.Start.
    /// </summary>
    public Func<long, Task>? UploadedActFileSaver { get; set; }

    /// <summary>
    /// Шов навигации к задаче reminder'а (task_id строкой → шелл переключает
    /// «Мои задачи» и выбирает карточку). Как DiscussionNavigator у задач;
    /// тесты/шелл подменяют, null — кнопка молча не действует.
    /// </summary>
    public Func<string, CancellationToken, Task>? ReminderTaskNavigator { get; set; }

    /// <summary>Открытый диалог «Загрузить акт»; null — закрыт.</summary>
    public UploadedActViewModel? UploadAct
    {
        get => _uploadAct;
        private set
        {
            if (SetProperty(ref _uploadAct, value))
            {
                OnPropertyChanged(nameof(IsUploadActOpen));
            }
        }
    }

    public bool IsUploadActOpen => UploadAct is not null;

    /// <summary>
    /// «⇪ Загрузить акт»: право database.write, затем выбор PDF; диалог
    /// открываем только с файлом — отмена в OpenFileDialog ничего не показывает
    /// (как «+ Добавить фото»). Диалог не привязан к позиции — веб-модал тоже
    /// страничный.
    /// </summary>
    private async Task OpenUploadActAsync(CancellationToken cancellationToken)
    {
        if (UploadAct is not null)
        {
            return;
        }

        await EnsurePermissionsAsync(cancellationToken);
        if (!_canTransfer)
        {
            BannerErrorText = "Недостаточно прав для изменения данных.";
            return;
        }

        var path = ActFilePicker?.Invoke().FirstOrDefault();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        var upload = new UploadedActViewModel(_api, ActFilePicker, UploadedActFileSaver, DelayAsync);
        AttachUploadActEvents(upload);
        UploadAct = upload;
        upload.SelectFile(path);
    }

    /// <summary>
    /// Reminder-режим загрузки акта (веб openUploadActModalForReminder и диплинк
    /// /database?upload_act=1&amp;reminder_id=…&amp;source_task_id=…): диалог
    /// открывается без файла — PDF выбирается «Обзор…»; данные напоминания
    /// грузятся в панель, их ошибка изолирована и не ломает обычный флоу.
    /// </summary>
    public async Task OpenUploadActReminderAsync(string? reminderId, string? sourceTaskId)
    {
        if (UploadAct is not null)
        {
            return;
        }

        try
        {
            await EnsurePermissionsAsync(CancellationToken.None);
            if (!_canTransfer)
            {
                BannerErrorText = "Недостаточно прав для изменения данных.";
                return;
            }

            var upload = new UploadedActViewModel(_api, ActFilePicker, UploadedActFileSaver, DelayAsync);
            AttachUploadActEvents(upload);
            UploadAct = upload;
            await upload.BeginReminderBindingAsync(reminderId, sourceTaskId, CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    private void AttachUploadActEvents(UploadedActViewModel upload)
    {
        upload.Closed += UploadAct_Closed;
        upload.ReminderTaskOpenRequested += UploadAct_ReminderTaskOpenRequested;
    }

    private void DetachUploadActEvents(UploadedActViewModel upload)
    {
        upload.Closed -= UploadAct_Closed;
        upload.ReminderTaskOpenRequested -= UploadAct_ReminderTaskOpenRequested;
    }

    private void UploadAct_ReminderTaskOpenRequested(object? sender, string taskId)
        => _ = OpenReminderTaskSafelyAsync(taskId);

    /// <summary>«Открыть задачу» reminder-панели/результата — навигация через шов шелла.</summary>
    internal async Task OpenReminderTaskSafelyAsync(string? taskId)
    {
        if (string.IsNullOrWhiteSpace(taskId) || ReminderTaskNavigator is null)
        {
            return;
        }

        try
        {
            await ReminderTaskNavigator(taskId.Trim(), CancellationToken.None);
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    private void UploadAct_Closed(object? sender, EventArgs e)
    {
        if (sender is UploadedActViewModel upload)
        {
            DetachUploadActEvents(upload);
        }

        UploadAct = null;
    }

    private void CloseUploadAct()
    {
        if (UploadAct is { } upload)
        {
            DetachUploadActEvents(upload);
        }

        UploadAct = null;
    }

    private void ClosePhotoUpload()
    {
        if (PhotoUpload is { } upload)
        {
            upload.Uploaded -= PhotoUpload_Uploaded;
            upload.Closed -= PhotoUpload_Closed;
        }

        PhotoUpload = null;
    }

    /// <summary>
    /// Новая строка галереи после upload: мгновенный превью из локального файла,
    /// затем серверный thumb (он уже собран при insert). Модерация свежего фото —
    /// «своё»: проверить/отклонить его сам uploader не может.
    /// </summary>
    private async Task AppendUploadedPhotoAsync(
        HubEquipmentPhotoUploadResult result,
        string? localPath)
    {
        PhotoCount += 1;
        var item = new DatabasePhotoItem
        {
            ItemId = result.ItemId,
            FileNo = result.FileNo,
            Image = TryDecodeLocalPhoto(localPath),
        };
        // Свежая загрузка — «своё» фото: verify/reject себе сервер не разрешает.
        item.Initialize(new HubEquipmentPhoto { FileName = result.FileName, IsOwn = true });
        item.ModerationAllowed = _photoVerificationAvailable && _photoVerifyPermitted;
        PhotoPreviews.Add(item);
        var image = await _imageLoader.LoadAsync(
            PhotoContentUri(item, thumb: true),
            decodePixelWidth: 256,
            CancellationToken.None);
        if (image is not null && PhotoPreviews.Contains(item))
        {
            item.Image = image;
        }
    }

    /// <summary>Мгновенное превью загруженного файла до ответа сервера (256px).</summary>
    private static ImageSource? TryDecodeLocalPhoto(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return null;
        }

        try
        {
            // Поток под using: и при ошибке декода файл не остаётся залоченным.
            using var stream = new FileStream(
                path, FileMode.Open, FileAccess.Read, FileShare.Read);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.StreamSource = stream;
            bitmap.DecodePixelWidth = 256;
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.EndInit();
            bitmap.Freeze();
            return bitmap;
        }
        catch (Exception)
        {
            return null;
        }
    }

    /// <summary>«✓ Подтвердить» — POST verify; ответ разворачиваем в отметки строки.</summary>
    private async Task VerifyPhotoAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not DatabasePhotoItem item)
        {
            return;
        }

        var updated = await _api.VerifyEquipmentPhotoAsync(item.ItemId, item.FileNo, cancellationToken);
        item.ApplyVerification(updated);
    }

    /// <summary>
    /// Открыть диалог причины: POST — свежее отклонение; editing — PATCH правки
    /// причины на уже отклонённом (как «Изменить» в веб-диалоге).
    /// </summary>
    private void OpenPhotoReject(DatabasePhotoItem item, bool editing)
    {
        _photoRejectTarget = item;
        _photoRejectEditing = editing;
        PhotoRejectReason = editing ? item.RejectReason?.Trim() ?? string.Empty : string.Empty;
        PhotoRejectErrorText = null;
        IsPhotoRejectOpen = true;
        OnPropertyChanged(nameof(PhotoRejectTitle));
        OnPropertyChanged(nameof(PhotoRejectConfirmText));
    }

    /// <summary>Подтверждение диалога: POST reject или PATCH причины.</summary>
    private async Task ConfirmPhotoRejectAsync(CancellationToken cancellationToken)
    {
        var target = _photoRejectTarget;
        if (target is null)
        {
            return;
        }

        var reason = PhotoRejectReason.Trim();
        if (reason.Length == 0)
        {
            PhotoRejectErrorText = "Укажите причину отклонения.";
            return;
        }

        if (reason.Length > PhotoRejectReasonMaxLength)
        {
            PhotoRejectErrorText = "Причина длиннее 500 символов — сократите текст.";
            return;
        }

        IsPhotoRejectBusy = true;
        PhotoRejectErrorText = null;
        try
        {
            var updated = _photoRejectEditing
                ? await _api.UpdateEquipmentPhotoRejectReasonAsync(
                    target.ItemId, target.FileNo, reason, cancellationToken)
                : await _api.RejectEquipmentPhotoAsync(
                    target.ItemId, target.FileNo, reason, cancellationToken);
            target.ApplyRejection(updated);
            ClosePhotoReject();
        }
        finally
        {
            IsPhotoRejectBusy = false;
        }
    }

    private void ClosePhotoReject()
    {
        IsPhotoRejectOpen = false;
        _photoRejectTarget = null;
        _photoRejectEditing = false;
        PhotoRejectReason = string.Empty;
        PhotoRejectErrorText = null;
    }

    /// <summary>
    /// «⟳ Повернуть» — POST rotate 90°: контент и thumb меняются на сервере,
    /// поэтому сбрасываем кэш сменой ?v= и перечитываем обе картинки.
    /// </summary>
    private async Task RotatePhotoAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not DatabasePhotoItem item)
        {
            return;
        }

        var result = await _api.RotateEquipmentPhotoAsync(item.ItemId, item.FileNo, 90, cancellationToken);
        item.ApplyRotation(result);
        _photoRevisions[item.FileNo] = _photoRevisions.TryGetValue(item.FileNo, out var revision)
            ? revision + 1
            : 1;
        var thumb = await _imageLoader.LoadAsync(
            PhotoContentUri(item, thumb: true),
            decodePixelWidth: 256,
            cancellationToken);
        if (thumb is not null && PhotoPreviews.Contains(item))
        {
            item.Image = thumb;
        }

        if (IsPhotoViewerOpen && ReferenceEquals(PhotoViewerItem, item))
        {
            var image = await _imageLoader.LoadAsync(
                PhotoContentUri(item, thumb: false),
                decodePixelWidth: 1600,
                cancellationToken);
            if (image is not null && ReferenceEquals(PhotoViewerItem, item))
            {
                PhotoViewerImage = image;
            }
        }
    }

    // ---- Передача оборудования (write-флоу) ----

    /// <summary>
    /// Кнопка «Передать…» видна только с правом database.write (admin — всегда),
    /// как hasPermission('database.write') в вебе. Узнаём из /auth/me один раз.
    /// </summary>
    public bool CanTransfer
    {
        get => _canTransfer;
        private set
        {
            if (SetProperty(ref _canTransfer, value))
            {
                OnPropertyChanged(nameof(CanAddPhoto));
                OnPropertyChanged(nameof(ShowPhotoSection));
                OnPropertyChanged(nameof(CanRotatePhotos));
                ((NativeRelayCommand)AddPhotoCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)RotatePhotoCommand).RaiseCanExecuteChanged();
            }
        }
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

    /// <summary>Открытый диалог карточки (правка/создание); null — закрыт.</summary>
    public EquipmentEditorViewModel? Editor
    {
        get => _editor;
        private set
        {
            if (SetProperty(ref _editor, value))
            {
                OnPropertyChanged(nameof(IsEditorOpen));
            }
        }
    }

    public bool IsEditorOpen => Editor is not null;

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

        var transfer = await CreateTransferAsync(
            [new TransferTargetItem { InvNo = invNo, Title = Detail.Title }],
            cancellationToken);
        if (transfer is null)
        {
            return;
        }

        _transferFromSelection = false;
        Transfer = transfer;
    }

    /// <summary>
    /// «⇄ Передать выбранные (N)»: тот же диалог, но inv_nos — из отмеченных
    /// строк списка (веб-форма передачи тоже принимает несколько позиций).
    /// </summary>
    private async Task OpenTransferSelectedAsync(CancellationToken cancellationToken)
    {
        if (Transfer is not null)
        {
            return;
        }

        var targets = Items
            .Where(item => item.IsChecked)
            .Select(item => (Item: item, InvNo: EquipmentCatalog.InvNoParameter(item.InvNo)))
            .Where(pair => pair.InvNo is not null)
            .Select(pair => new TransferTargetItem { InvNo = pair.InvNo!, Title = pair.Item.Title })
            .ToList();
        if (targets.Count == 0)
        {
            return;
        }

        var transfer = await CreateTransferAsync(targets, cancellationToken);
        if (transfer is null)
        {
            return;
        }

        _transferFromSelection = true;
        Transfer = transfer;
    }

    /// <summary>
    /// Общая часть открытия диалога: право database.write (один раз /auth/me),
    /// справочник филиалов (ошибка не блокирует — пустой список), подписки.
    /// </summary>
    private async Task<EquipmentTransferViewModel?> CreateTransferAsync(
        IReadOnlyList<TransferTargetItem> targets,
        CancellationToken cancellationToken)
    {
        await EnsurePermissionsAsync(cancellationToken);
        if (!_canTransfer)
        {
            BannerErrorText = "Недостаточно прав для изменения данных.";
            return null;
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
            _api, targets, branches, ActSaver, DelayAsync);
        transfer.Completed += Transfer_Completed;
        transfer.Closed += Transfer_Closed;
        transfer.ReminderTaskOpenRequested += Transfer_ReminderTaskOpenRequested;
        transfer.UploadReminderRequested += Transfer_UploadReminderRequested;
        return transfer;
    }

    /// <summary>«Открыть задачу» из reminder-блока результата передачи.</summary>
    private void Transfer_ReminderTaskOpenRequested(object? sender, string taskId)
        => _ = OpenReminderTaskSafelyAsync(taskId);

    /// <summary>«Загрузить подписанный акт» из reminder-блока — диалог в binding-режиме.</summary>
    private void Transfer_UploadReminderRequested(object? sender, EventArgs e)
    {
        if (sender is EquipmentTransferViewModel transfer)
        {
            _ = OpenUploadActReminderAsync(transfer.ReminderId, transfer.ReminderTaskId);
        }
    }

    /// <summary>Job done с успешными позициями: перечитываем затронутые данные.</summary>
    private void Transfer_Completed(object? sender, EventArgs e)
    {
        if (_transferFromSelection)
        {
            // Чекбоксы снимаем сразу; список с новыми владельцами перечитаем
            // после закрытия результата — иначе пересборка выдачи сорвёт диалог
            // (смена выбранной строки закрывает его) вместе с актами.
            SetAllChecked(false);
            _reloadListOnTransferClose = true;
            return;
        }

        var invNo = EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo);
        if (invNo is not null)
        {
            _ = LoadDetailSafelyAsync(invNo, _selectedItem?.Id);
        }
    }

    private void Transfer_Closed(object? sender, EventArgs e)
    {
        var reloadList = _reloadListOnTransferClose;
        _reloadListOnTransferClose = false;
        _transferFromSelection = false;
        CloseTransfer();
        if (reloadList)
        {
            // Позиции сменили владельца/место — страница перечитывается с начала.
            _ = ReloadListSafelyAsync();
        }
    }

    private void CloseTransfer()
    {
        if (Transfer is { } transfer)
        {
            transfer.Completed -= Transfer_Completed;
            transfer.Closed -= Transfer_Closed;
            transfer.ReminderTaskOpenRequested -= Transfer_ReminderTaskOpenRequested;
            transfer.UploadReminderRequested -= Transfer_UploadReminderRequested;
            transfer.Close();
        }

        Transfer = null;
    }

    // ---- Диалог карточки: «✎ Изменить» и «+ Новая позиция» ----

    /// <summary>
    /// Открытие редактора: права уже прочитаны при загрузке, справочники формы
    /// (типы/статусы/филиалы) догружаем здесь — сбой не отменяет диалог,
    /// текст ошибки показываем внутри него (как lookup-ошибки у веб-формы).
    /// </summary>
    private async Task OpenEditorAsync(bool create, CancellationToken cancellationToken)
    {
        if (Editor is not null)
        {
            return;
        }

        await EnsurePermissionsAsync(cancellationToken);
        if (!_canTransfer)
        {
            BannerErrorText = "Недостаточно прав для изменения данных.";
            return;
        }

        HubEquipmentItem? item = null;
        if (!create)
        {
            // Правка инициализируется из загруженной карточки — той же,
            // что видит пользователь (сырые id для ComboBox'ов).
            item = _detailItem;
            if (item is null || Detail is null
                || EquipmentCatalog.InvNoParameter(item.InvNo) is null)
            {
                return;
            }
        }

        var lookupErrors = new List<string>();
        var types = await LoadEditorLookupAsync(
            () => _api.GetEquipmentTypesAsync(cancellationToken), lookupErrors);
        var statuses = await LoadEditorLookupAsync(
            () => _api.GetEquipmentStatusesAsync(cancellationToken), lookupErrors);
        var branches = await LoadEditorLookupAsync(
            () => _api.GetEquipmentBranchesAsync(cancellationToken), lookupErrors);
        var lookupError = lookupErrors.Count == 0 ? null : string.Join(" ", lookupErrors);

        var editor = create
            ? EquipmentEditorViewModel.ForCreate(
                _api, types, statuses, branches, lookupError, DelayAsync)
            : EquipmentEditorViewModel.ForEdit(
                _api, item!, types, statuses, branches, lookupError, DelayAsync);
        editor.Completed += Editor_Completed;
        editor.Closed += Editor_Closed;
        editor.OpenCardRequested += Editor_OpenCardRequested;
        Editor = editor;
    }

    /// <summary>Справочник формы с мягким отказом: ошибка собирается в баннер диалога.</summary>
    private static async Task<IReadOnlyList<T>> LoadEditorLookupAsync<T>(
        Func<Task<IReadOnlyList<T>>> load, List<string> errors)
    {
        try
        {
            return await load();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            errors.Add(TasksViewModel.DescribeError(exception));
            return [];
        }
    }

    /// <summary>
    /// Итог правки — ответ PATCH применяем к детали и строке списка
    /// (upsertCard из handleDetailSave веба). Итог создания — диалог
    /// остаётся открытым для пакетного ввода, карточку догружаем фоном.
    /// </summary>
    private void Editor_Completed(object? sender, EquipmentEditorCompletedEventArgs e)
    {
        if (e.UpdatedItem is { } updated)
        {
            CloseEditor();
            var selected = _selectedItem;
            var index = selected is null ? -1 : Items.IndexOf(selected);
            if (index < 0)
            {
                // Откреплённая строка (карточка из панели сотрудника) —
                // применяем ответ напрямую к детали.
                Detail = new EquipmentDetailViewModel(updated);
                _detailItem = updated;
                return;
            }

            var fresh = new EquipmentItemViewModel(updated) { IsChecked = selected!.IsChecked };
            Items[index] = fresh;
            // Перевыбор строки перечитывает карточку целиком (история/фото тоже).
            SelectedItem = fresh;
            return;
        }

        if (!string.IsNullOrWhiteSpace(e.CreatedInvNo))
        {
            _ = LoadCreatedItemSafelyAsync(e.CreatedInvNo!.Trim());
        }
    }

    /// <summary>Созданная позиция: карточку читаем и вставляем строку в выдачу.</summary>
    private async Task LoadCreatedItemSafelyAsync(string invNo)
    {
        try
        {
            var item = await _api.GetEquipmentByInvAsync(invNo, CancellationToken.None);
            var existing = Items.FirstOrDefault(row =>
                string.Equals(
                    EquipmentCatalog.InvNoParameter(row.InvNo), invNo, StringComparison.Ordinal));
            var index = existing is null ? -1 : Items.IndexOf(existing);
            var fresh = new EquipmentItemViewModel(item);
            if (index >= 0)
            {
                fresh.IsChecked = Items[index].IsChecked;
                Items[index] = fresh;
            }
            else
            {
                Items.Insert(0, fresh);
            }
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>«Открыть карточку» из строки успеха: выбираем созданную строку списка.</summary>
    private void Editor_OpenCardRequested(object? sender, string invNo)
    {
        var match = Items.FirstOrDefault(item =>
            string.Equals(
                EquipmentCatalog.InvNoParameter(item.InvNo), invNo, StringComparison.Ordinal));
        if (match is not null)
        {
            // Смена выбора сама закроет диалог и откроет карточку.
            SelectedItem = match;
        }
    }

    private void Editor_Closed(object? sender, EventArgs e)
        => CloseEditor();

    private void CloseEditor()
    {
        if (Editor is { } editor)
        {
            editor.Completed -= Editor_Completed;
            editor.Closed -= Editor_Closed;
            editor.OpenCardRequested -= Editor_OpenCardRequested;
            editor.Close();
        }

        Editor = null;
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

    // ---- Панель сотрудника (клик по ФИО владельца в карточке) ----

    /// <summary>Открытая панель сотрудника; null — закрыта.</summary>
    public EmployeePanelViewModel? Employee
    {
        get => _employee;
        private set
        {
            if (SetProperty(ref _employee, value))
            {
                OnPropertyChanged(nameof(IsEmployeePanelOpen));
            }
        }
    }

    public bool IsEmployeePanelOpen => Employee is not null;

    /// <summary>
    /// «Сотрудник» карточки как ссылка: панель по owner_no (empl_no detail-ответа),
    /// поверх страницы — тот же оверлей-паттерн, что и диалог передачи.
    /// </summary>
    private void OpenEmployee()
    {
        var detail = Detail;
        if (detail?.HasOwner != true || detail.OwnerNo is not { } ownerNo)
        {
            return;
        }

        CloseEmployee();
        var employee = new EmployeePanelViewModel(
            _api, ownerNo, detail.OwnerName, detail.OwnerDept, DelayAsync);
        employee.ItemOpenRequested += Employee_ItemOpenRequested;
        employee.Closed += Employee_Closed;
        Employee = employee;
        employee.Start();
    }

    /// <summary>
    /// Строка техники панели: карточку открываем существующим механизмом выбора.
    /// Позиция есть в выдаче — выбираем её; нет — откреплённая строка на тот же
    /// SelectedItem (выдачу не переписываем, строка списка просто без выделения).
    /// Смена SelectedItem закрывает саму панель.
    /// </summary>
    private void Employee_ItemOpenRequested(HubEquipmentItem item)
    {
        var invNo = EquipmentCatalog.InvNoParameter(item.InvNo);
        if (invNo is null)
        {
            return;
        }

        var match = Items.FirstOrDefault(existing =>
            string.Equals(
                EquipmentCatalog.InvNoParameter(existing.InvNo), invNo, StringComparison.Ordinal));
        SelectedItem = match ?? new EquipmentItemViewModel(item);
    }

    private void Employee_Closed(object? sender, EventArgs e)
    {
        CloseEmployee();
    }

    private void CloseEmployee()
    {
        if (Employee is { } employee)
        {
            employee.ItemOpenRequested -= Employee_ItemOpenRequested;
            employee.Closed -= Employee_Closed;
            employee.Close();
        }

        Employee = null;
    }

    // ---- Секция «Работы» и регистрация журнальных операций ----

    /// <summary>Открытый диалог регистрации работы; null — закрыт.</summary>
    public MaintenanceDialogViewModel? Maintenance
    {
        get => _maintenance;
        private set
        {
            if (SetProperty(ref _maintenance, value))
            {
                OnPropertyChanged(nameof(IsMaintenanceOpen));
            }
        }
    }

    public bool IsMaintenanceOpen => Maintenance is not null;

    /// <summary>
    /// Потоки «Работы» по типу позиции — набор как action-флаги строки веба:
    /// принтер/МФУ → картридж + комплектующие, системник → комплектующие + чистка,
    /// ИБП → батарея. Каждый поток грузится и ошибается независимо.
    /// </summary>
    private void StartWorkStreams(HubEquipmentItem item, string invNo, CancellationToken cancellationToken)
    {
        WorkStreams.Clear();
        var (isPrinterOrMfu, isUps, isPc) = EquipmentMaintenance.GetFlags(item);
        if (isPrinterOrMfu)
        {
            WorkStreams.Add(new EquipmentWorkStreamViewModel(
                MaintenanceWorkKind.Cartridge, componentKind: string.Empty));
            WorkStreams.Add(new EquipmentWorkStreamViewModel(
                MaintenanceWorkKind.Component, componentKind: "printer"));
        }

        if (isPc && !isPrinterOrMfu)
        {
            WorkStreams.Add(new EquipmentWorkStreamViewModel(
                MaintenanceWorkKind.Component, componentKind: "pc"));
        }

        if (isUps)
        {
            WorkStreams.Add(new EquipmentWorkStreamViewModel(
                MaintenanceWorkKind.Battery, componentKind: string.Empty));
        }

        if (isPc)
        {
            WorkStreams.Add(new EquipmentWorkStreamViewModel(
                MaintenanceWorkKind.Cleaning, componentKind: string.Empty));
        }

        foreach (var stream in WorkStreams)
        {
            _ = stream.LoadAsync(_api, item, invNo, cancellationToken);
        }
    }

    /// <summary>
    /// «Зарегистрировать» в потоке работ: диалог по типу операции, право
    /// database.write (как у «Передать»), оверлей поверх страницы.
    /// </summary>
    private async Task OpenMaintenanceAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (Maintenance is not null
            || parameter is not EquipmentWorkStreamViewModel stream
            || _detailItem is not { } item)
        {
            return;
        }

        await EnsurePermissionsAsync(cancellationToken);
        if (!_canTransfer)
        {
            BannerErrorText = "Недостаточно прав для изменения данных.";
            return;
        }

        var dialog = new MaintenanceDialogViewModel(
            _api, item, stream.Kind, stream.ComponentKind);
        dialog.Completed += Maintenance_Completed;
        dialog.Closed += Maintenance_Closed;
        Maintenance = dialog;
        dialog.Start();
    }

    /// <summary>
    /// Работа записана: сервер дописывает примечание в DESCR карточки
    /// (equipment_id+current_description) — карточку и потоки перечитываем,
    /// как shouldRefreshEquipment у веб-действий.
    /// </summary>
    private void Maintenance_Completed(object? sender, EventArgs e)
    {
        var invNo = EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo);
        if (invNo is not null)
        {
            _ = LoadDetailSafelyAsync(invNo, _selectedItem?.Id);
        }
    }

    private void Maintenance_Closed(object? sender, EventArgs e)
    {
        CloseMaintenance();
    }

    private void CloseMaintenance()
    {
        if (Maintenance is { } dialog)
        {
            dialog.Completed -= Maintenance_Completed;
            dialog.Closed -= Maintenance_Closed;
            dialog.Close();
        }

        Maintenance = null;
    }

    /// <summary>Сброс превью фото и истории — при смене выбора/списка.</summary>
    private void ResetPhotoAndHistoryState()
    {
        PhotoPreviews.Clear();
        HistoryTotal = 0;
        HistoryLoaded = false;
        HistoryEntries.Clear();
        // Потоки «Работы» и диалог регистрации привязаны к карточке — гасим вместе.
        WorkStreams.Clear();
        CloseMaintenance();
        // Загрузка/модерация привязаны к item_id карточки — оверлеи гасим вместе
        // с фотосостоянием (поллинг upload-VM живёт своим CTS, сервер допишет сам).
        _photosItemId = null;
        _photoVerificationAvailable = false;
        _photoVerifyPermitted = false;
        _photoRevisions.Clear();
        ClosePhotoUpload();
        ClosePhotoReject();
        OnPropertyChanged(nameof(CanAddPhoto));
        OnPropertyChanged(nameof(ShowPhotoSection));
        OnPropertyChanged(nameof(CanRotatePhotos));
        ((NativeRelayCommand)AddPhotoCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)RotatePhotoCommand).RaiseCanExecuteChanged();
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

    /// <summary>Заголовок секции: «Фото: N», карточка без снимков — «Фото».</summary>
    public string PhotoHeaderText => PhotoText.Length > 0 ? PhotoText : "Фото";

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
    /// <summary>«+ Добавить фото» — file picker → диалог загрузки (database.write).</summary>
    public ICommand AddPhotoCommand { get; }
    /// <summary>«✓ Подтвердить» в полном кадре — POST verify (database.photo_verify).</summary>
    public ICommand VerifyPhotoCommand { get; }
    /// <summary>«✕ Отклонить» — диалог причины → POST reject.</summary>
    public ICommand OpenRejectPhotoCommand { get; }
    /// <summary>«Изменить причину» на отклонённом — тот же диалог → PATCH reject.</summary>
    public ICommand EditRejectPhotoCommand { get; }
    public ICommand ConfirmRejectPhotoCommand { get; }
    public ICommand CancelRejectPhotoCommand { get; }
    /// <summary>«⟳ Повернуть» — POST rotate 90° (database.write или photo_verify).</summary>
    public ICommand RotatePhotoCommand { get; }
    public ICommand OpenTransferCommand { get; }
    public ICommand OpenTransferSelectedCommand { get; }
    /// <summary>«⇪ Загрузить акт» в шапке — диалог загрузки подписанного акта (database.write).</summary>
    public ICommand OpenUploadActCommand { get; }
    /// <summary>«✎ Изменить» в карточке — диалог правки позиции (database.write).</summary>
    public ICommand OpenEditCommand { get; }
    /// <summary>«+ Новая позиция» в шапке — диалог создания позиции (database.write).</summary>
    public ICommand OpenCreateCommand { get; }
    public ICommand OpenEmployeeCommand { get; }
    /// <summary>«Зарегистрировать» в потоке «Работы» — диалог операции (database.write).</summary>
    public ICommand OpenMaintenanceCommand { get; }
    public ICommand SelectAllCommand { get; }
    public ICommand ClearSelectionCommand { get; }

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
            // Сырая карточка — исходные поля для диалога «✎ Изменить».
            _detailItem = item;
            // Потоки «Работы» — необязательный сигнал: без них карточка остаётся.
            StartWorkStreams(item, invNo, cancellation.Token);
            // История — необязательный сигнал: без неё карточка остаётся.
            _ = LoadHistorySafelyAsync(invNo, cancellation.Token);
            // Метаданные фото — необязательный сигнал: без них карточка остаётся.
            // item_id запоминаем и без ответа списка — «+ Добавить фото» работает
            // даже когда снимков пока нет или /photos недоступен.
            var photoItemId = item.Id ?? itemId;
            _photosItemId = photoItemId;
            OnPropertyChanged(nameof(CanAddPhoto));
            OnPropertyChanged(nameof(ShowPhotoSection));
            ((NativeRelayCommand)AddPhotoCommand).RaiseCanExecuteChanged();
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
            // Гейты модерации едут в ответе списка — /auth/me второй раз не дёргаем.
            _photoVerificationAvailable = photos.VerificationAvailable;
            _photoVerifyPermitted = photos.VerifyPermitted;
            var moderationAllowed = photos.VerificationAvailable && photos.VerifyPermitted;
            OnPropertyChanged(nameof(CanRotatePhotos));
            ((NativeAsyncCommand)RotatePhotoCommand).RaiseCanExecuteChanged();

            var rows = (photos.Photos ?? [])
                .Take(PhotoPreviewLimit)
                .ToArray();
            foreach (var photo in rows)
            {
                var image = await _imageLoader.LoadAsync(
                    $"equipment/{itemId}/photos/{photo.FileNo}/content?thumb=true",
                    decodePixelWidth: 256,
                    cancellationToken);
                // Выбор уже ушёл на другую позицию — превью не вставляем.
                if (!string.Equals(EquipmentCatalog.InvNoParameter(_selectedItem?.InvNo), invNo, StringComparison.Ordinal))
                {
                    return;
                }

                if (image is not null)
                {
                    var item = new DatabasePhotoItem
                    {
                        ItemId = itemId,
                        FileNo = photo.FileNo,
                        Image = image,
                    };
                    item.Initialize(photo);
                    item.ModerationAllowed = moderationAllowed;
                    PhotoPreviews.Add(item);
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
        CloseEditor();
        CloseEmployee();
        CloseUploadAct();
        _transferFromSelection = false;
        _reloadListOnTransferClose = false;
        _permissionsLoaded = false;
        CanTransfer = false;
        _detailItem = null;
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

/// <summary>
/// Диалог «+ Добавить фото»: выбранный файл → «Загрузить» → простой POST
/// /equipment/{id}/photos (файл до SimpleUploadLimitBytes) или чанковая сессия
/// photo-uploads для крупных — тот же лимит бэкенда (15 МБ), что и в вебе.
/// </summary>
public sealed class EquipmentPhotoUploadViewModel : ObservableObject
{
    /// <summary>Лимит фото бэкенда (MAX_PHOTO_BYTES): больше — отказ до отправки.</summary>
    internal const long MaxPhotoBytes = 15L * 1024 * 1024;

    /// <summary>Порог простого POST /photos; крупнее — чанковая сессия (256 КБ).</summary>
    internal const long SimpleUploadLimitBytes = 4L * 1024 * 1024;

    /// <summary>Размер чанка сессии на бэкенде — фолбэк, если ответ его не дал.</summary>
    private const int PhotoChunkSizeFallback = 256 * 1024;

    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp",
    };

    private readonly IHubApiClient _api;
    private readonly long _itemId;
    private readonly Func<IReadOnlyList<string>>? _filePicker;
    private string? _selectedPath;
    private string _fileName = string.Empty;
    private string _fileSizeText = string.Empty;
    private bool _isBusy;
    private double _uploadPercent;
    private bool _isUploadDeterminate;
    private string _statusText = string.Empty;
    private string? _errorText;

    public EquipmentPhotoUploadViewModel(
        IHubApiClient api,
        long itemId,
        Func<IReadOnlyList<string>>? filePicker)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _itemId = itemId;
        _filePicker = filePicker;
        PickFileCommand = new NativeRelayCommand(PickFile, () => !IsBusy);
        UploadCommand = new NativeAsyncCommand(
            (_, ct) => UploadAsync(ct),
            ex =>
            {
                if (ex is not OperationCanceledException)
                {
                    ErrorText = TasksViewModel.DescribeError(ex);
                }
            },
            _ => HasFile && !IsBusy);
        CloseCommand = new NativeRelayCommand(RequestClose, () => !IsBusy);
    }

    /// <summary>Фото вставлено в FILES — родитель обновляет счётчик и галерею.</summary>
    public event EventHandler<HubEquipmentPhotoUploadResult>? Uploaded;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>«Обзор…»: переоткрыть file picker и заменить выбранный файл.</summary>
    public ICommand PickFileCommand { get; }

    public ICommand UploadCommand { get; }
    public ICommand CloseCommand { get; }

    /// <summary>Файл выбран и прошёл локальную проверку — «Загрузить» активна.</summary>
    public bool HasFile => _selectedPath is not null;

    /// <summary>Путь выбранного файла — родитель берёт его для мгновенного превью.</summary>
    public string? SelectedPath => _selectedPath;

    /// <summary>Имя выбранного файла — превью-строка в диалоге.</summary>
    public string FileName
    {
        get => _fileName;
        private set => SetProperty(ref _fileName, value);
    }

    /// <summary>Размер выбранного файла человеческим видом («2,4 МБ»).</summary>
    public string FileSizeText
    {
        get => _fileSizeText;
        private set => SetProperty(ref _fileSizeText, value);
    }

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                ((NativeAsyncCommand)UploadCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)PickFileCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Процент отправки (чанковый путь); 0 при простом POST.</summary>
    public double UploadPercent
    {
        get => _uploadPercent;
        private set => SetProperty(ref _uploadPercent, value);
    }

    /// <summary>Прогресс детерминированный (чанки) или бегущий (простой POST).</summary>
    public bool IsUploadDeterminate
    {
        get => _isUploadDeterminate;
        private set => SetProperty(ref _isUploadDeterminate, value);
    }

    /// <summary>Строка этапа под прогрессом («Отправка 45%…»).</summary>
    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
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

    private void PickFile()
    {
        var path = _filePicker?.Invoke().FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(path))
        {
            SelectFile(path);
        }
    }

    /// <summary>
    /// Локальная проверка выбранного файла: расширение из allowlist бэкенда,
    /// размер ≤15 МБ и файл читается. При ошибке выбор сбрасываем.
    /// </summary>
    public void SelectFile(string? path)
    {
        ErrorText = null;
        _selectedPath = null;
        FileName = string.Empty;
        FileSizeText = string.Empty;
        OnPropertyChanged(nameof(HasFile));
        ((NativeAsyncCommand)UploadCommand).RaiseCanExecuteChanged();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        if (!AllowedExtensions.Contains(Path.GetExtension(path)))
        {
            ErrorText = "Это не изображение. Поддерживаются JPG, PNG, GIF, WEBP и BMP.";
            return;
        }

        FileInfo info;
        try
        {
            info = new FileInfo(path);
        }
        catch (Exception)
        {
            ErrorText = "Файл недоступен.";
            return;
        }

        if (!info.Exists)
        {
            ErrorText = "Файл не найден: " + Path.GetFileName(path);
            return;
        }

        if (info.Length <= 0)
        {
            ErrorText = "Файл пустой.";
            return;
        }

        if (info.Length > MaxPhotoBytes)
        {
            ErrorText = "Файл больше 15 МБ ("
                + (info.Length / (1024.0 * 1024.0)).ToString("0.#", CultureInfo.InvariantCulture)
                + " МБ) — выберите другой.";
            return;
        }

        _selectedPath = info.FullName;
        FileName = info.Name;
        FileSizeText = FormatFileSize(info.Length);
        OnPropertyChanged(nameof(HasFile));
        ((NativeAsyncCommand)UploadCommand).RaiseCanExecuteChanged();
    }

    private async Task UploadAsync(CancellationToken cancellationToken)
    {
        var path = _selectedPath;
        if (path is null)
        {
            return;
        }

        IsBusy = true;
        StatusText = "Читаю файл…";
        try
        {
            var data = await File.ReadAllBytesAsync(path, cancellationToken);
            var mimeType = MimeFromExtension(Path.GetExtension(path));
            HubEquipmentPhotoUploadResult result;
            if (data.Length <= SimpleUploadLimitBytes)
            {
                StatusText = "Отправка…";
                result = await _api.UploadEquipmentPhotoAsync(
                    _itemId, FileName, data, mimeType, description: null, cancellationToken);
            }
            else
            {
                result = await UploadChunkedAsync(data, FileName, mimeType, cancellationToken);
            }

            StatusText = string.Empty;
            Uploaded?.Invoke(this, result);
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>
    /// Чанковая загрузка как в вебе (resumablePhotoUpload): сессия с client_id
    /// из sha256 файла — повтор той же загрузки не создаёт вторую запись;
    /// шлём только недостающие куски, complete собирает файл.
    /// </summary>
    private async Task<HubEquipmentPhotoUploadResult> UploadChunkedAsync(
        byte[] data,
        string fileName,
        string mimeType,
        CancellationToken cancellationToken)
    {
        var clientId = "d2-" + Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        StatusText = "Открываю сессию загрузки…";
        var session = await _api.CreateEquipmentPhotoUploadSessionAsync(
            _itemId,
            new HubEquipmentPhotoUploadSessionCreate
            {
                ClientId = clientId,
                FileName = fileName,
                Size = data.Length,
                MimeType = mimeType,
            },
            cancellationToken);
        // Повторная сессия по тому же client_id уже завершена — дубликата не будет.
        if (string.Equals(session.Status, "complete", StringComparison.Ordinal)
            && session.FileNo is { } completedFileNo)
        {
            return new HubEquipmentPhotoUploadResult
            {
                ItemId = session.ItemId,
                FileNo = completedFileNo,
                FileName = fileName,
            };
        }

        var uploadId = session.UploadId
            ?? throw new InvalidOperationException("Сервер не вернул upload_id сессии.");
        var chunkSize = session.ChunkSize is > 0 ? (int)session.ChunkSize : PhotoChunkSizeFallback;
        var totalChunks = session.TotalChunks > 0
            ? session.TotalChunks
            : Math.Max(1, (data.Length + chunkSize - 1) / chunkSize);
        var received = new HashSet<int>(session.Received ?? []);
        IsUploadDeterminate = true;
        var sentBytes = (long)received.Count * chunkSize;
        for (var index = 0; index < totalChunks; index++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (received.Contains(index))
            {
                continue;
            }

            var offset = index * chunkSize;
            var length = Math.Min(chunkSize, data.Length - offset);
            await _api.UploadEquipmentPhotoChunkAsync(
                uploadId, index, data.AsMemory(offset, length), cancellationToken);
            sentBytes += length;
            UploadPercent = Math.Min(100.0, sentBytes * 100.0 / data.Length);
            StatusText = "Отправка " + UploadPercent.ToString("0", CultureInfo.InvariantCulture) + "%…";
        }

        StatusText = "Завершаю загрузку…";
        return await _api.CompleteEquipmentPhotoUploadAsync(uploadId, cancellationToken);
    }

    /// <summary>MIME по расширению — allowlist как у бэкенда (_sniff_image_mime).</summary>
    internal static string MimeFromExtension(string? extension) => extension?.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        _ => "application/octet-stream",
    };

    private static string FormatFileSize(long bytes) => bytes switch
    {
        >= 1024 * 1024 =>
            (bytes / (1024.0 * 1024.0)).ToString("0.#", CultureInfo.InvariantCulture) + " МБ",
        >= 1024 => (bytes / 1024.0).ToString("0.#", CultureInfo.InvariantCulture) + " КБ",
        _ => bytes.ToString(CultureInfo.InvariantCulture) + " Б",
    };

    private void RequestClose() => Closed?.Invoke(this, EventArgs.Empty);
}

/// <summary>Разрешённая позиция акта — строка таблицы «Найдено в базе» в диалоге загрузки.</summary>
public sealed class UploadedActItemViewModel
{
    public UploadedActItemViewModel(HubUploadedActResolvedItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        var invNo = item.InvNo?.Trim() ?? string.Empty;
        TitleText = invNo.Length > 0 ? $"Инв. № {invNo}" : "Инв. № —";
        var model = item.ModelName?.Trim() ?? string.Empty;
        if (model.Length > 0)
        {
            TitleText += " — " + model;
        }

        SerialText = item.SerialNo?.Trim() ?? string.Empty;
        EmployeeText = item.EmployeeName?.Trim() ?? string.Empty;
        PlaceText = string.Join(
            " · ",
            new[] { item.BranchName, item.LocationName }
                .Where(part => !string.IsNullOrWhiteSpace(part))
                .Select(part => part!.Trim())
                .Distinct());
    }

    public string TitleText { get; }
    public string SerialText { get; }
    public string EmployeeText { get; }
    public string PlaceText { get; }
    public bool HasSerial => SerialText.Length > 0;
    public bool HasEmployee => EmployeeText.Length > 0;
    public bool HasPlace => PlaceText.Length > 0;
}

/// <summary>
/// Диалог «Загрузить акт» (тулбар «Базы»): PDF подписанного акта →
/// POST /equipment/acts/upload/parse (автоматически; ошибка распознавания —
/// fallback на manual_mode, как в вебе) → правка черновика (от/на сотрудника,
/// дата, инв. номера) + обязательная верификация списка по PDF →
/// POST /equipment/acts/upload/commit → «Скачать акт» (GET /equipment/acts/{doc_no}/file).
/// Только PDF до 15 МБ — как validateUploadActPdfFile веба; email/reminder
/// интеграций в нативном флоу нет.
/// </summary>
public sealed class UploadedActViewModel : ObservableObject
{
    /// <summary>Лимит файла акта — как UPLOAD_ACT_MAX_SIZE_BYTES веба.</summary>
    internal const long MaxActBytes = 15L * 1024 * 1024;

    /// <summary>Pending-группы в панели напоминания — превью первых четырёх, как в вебе.</summary>
    private const int ReminderGroupsPreviewLimit = 4;

    /// <summary>Поиск получателей email — debounce/лимит как у формы карточки (280 мс, 20).</summary>
    private static readonly TimeSpan EmailSearchDebounce = TimeSpan.FromMilliseconds(280);
    private const int EmailSearchMinLength = 2;
    private const int EmailSearchLimit = 20;

    private readonly IHubApiClient _api;
    private readonly Func<IReadOnlyList<string>>? _filePicker;
    private readonly Func<long, Task>? _actFileSaver;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private string? _selectedPath;
    private string _fileName = string.Empty;
    private string _fileSizeText = string.Empty;
    private HubUploadedActDraft? _draft;
    private IReadOnlyList<string> _recognizedInvNos = [];
    private string _fromEmployeeText = string.Empty;
    private string _toEmployeeText = string.Empty;
    private string _docDateText = string.Empty;
    private string _invNosText = string.Empty;
    private bool _invVerified;
    private bool _isBusy;
    private bool _isDownloading;
    private string _statusText = string.Empty;
    private string? _errorText;
    private string? _noticeText;
    private string _warningsText = string.Empty;
    private HubUploadedActCommitResult? _result;
    private string _resultText = string.Empty;
    private string _resultInvNosText = string.Empty;
    private string _verificationHeadline = string.Empty;
    private bool _verificationIsWarning;
    private string _recognizedInvNosText = "—";
    private string _finalInvNosText = "—";
    private string _droppedInvNosText = string.Empty;
    private string _addedInvNosText = string.Empty;
    private bool _hasFinalInvNos;

    // ---- Reminder-binding и email после записи ----

    private string? _reminderId;
    private string? _reminderTaskId;
    private HubTransferActReminder? _reminder;
    private bool _hasReminderBinding;
    private bool _isReminderLoading;
    private string? _reminderErrorText;
    private string _reminderSummaryText = string.Empty;
    private string _reminderMoreGroupsText = string.Empty;
    private bool _autoEmailEnabled = true;
    private bool _isEmailBusy;
    private string? _emailStatusText;
    private string? _emailErrorText;
    private string _emailSubjectText = string.Empty;
    private string _emailBodyText = string.Empty;
    private string _emailRecipientQuery = string.Empty;
    private bool _isEmailRecipientPopupOpen;
    private bool _isEmailSearchBusy;
    private CancellationTokenSource? _emailSearchCancellation;

    public UploadedActViewModel(
        IHubApiClient api,
        Func<IReadOnlyList<string>>? filePicker,
        Func<long, Task>? actFileSaver,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _filePicker = filePicker;
        _actFileSaver = actFileSaver;
        _delayAsync = delayAsync ?? Task.Delay;
        PickFileCommand = new NativeRelayCommand(PickFile, () => !IsBusy && !HasResult);
        ParseAutoCommand = new NativeAsyncCommand(
            (_, ct) => ParseAsync(manualMode: false, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => HasFile && !IsBusy && !HasResult);
        ParseManualCommand = new NativeAsyncCommand(
            (_, ct) => ParseAsync(manualMode: true, ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => HasFile && !IsBusy && !HasResult);
        CommitCommand = new NativeAsyncCommand(
            (_, ct) => CommitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => CanCommit);
        DownloadActCommand = new NativeAsyncCommand(
            (_, ct) => DownloadActAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => _result?.DocNo > 0 && !IsDownloading);
        // «Открыть задачу» reminder-панели: навигация — дело родителя/шелла.
        OpenReminderTaskCommand = new NativeRelayCommand(
            () =>
            {
                if (_reminderTaskId is { Length: > 0 } taskId)
                {
                    ReminderTaskOpenRequested?.Invoke(this, taskId);
                }
            },
            () => _reminderTaskId is { Length: > 0 });
        RefreshReminderCommand = new NativeAsyncCommand(
            (_, ct) => LoadReminderSafelyAsync(_reminderId!, ct),
            ex => ReminderErrorText = TasksViewModel.DescribeError(ex),
            _ => _reminderId is { Length: > 0 } && !IsReminderLoading);
        SelectEmailRecipientCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is EditorEmployeeOption option)
                {
                    AddEmailRecipient(option);
                }
            });
        RemoveEmailRecipientCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is EditorEmployeeOption chip)
                {
                    EmailRecipients.Remove(chip);
                }
            });
        SendEmailCommand = new NativeAsyncCommand(
            (_, ct) => SendSelectedEmailAsync(ct),
            ex => EmailErrorText = TasksViewModel.DescribeError(ex),
            _ => HasResult && EmailRecipients.Count > 0 && !IsEmailBusy);
        CloseCommand = new NativeRelayCommand(RequestClose);
        ResolvedItems.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasResolvedItems));
        ReminderPendingGroups.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasReminderPendingGroups));
        EmailRecipients.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasEmailRecipients));
            ((NativeAsyncCommand)SendEmailCommand).RaiseCanExecuteChanged();
        };
        EmailRecipientStatuses.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasEmailRecipientStatuses));
    }

    /// <summary>Закрытие диалога (✕/Закрыть/Esc) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>«Открыть задачу» reminder-панели — навигация через родителя (task_id).</summary>
    public event EventHandler<string>? ReminderTaskOpenRequested;

    public ICommand PickFileCommand { get; }
    public ICommand ParseAutoCommand { get; }
    public ICommand ParseManualCommand { get; }
    public ICommand CommitCommand { get; }
    public ICommand DownloadActCommand { get; }
    public ICommand OpenReminderTaskCommand { get; }
    public ICommand RefreshReminderCommand { get; }
    public ICommand SelectEmailRecipientCommand { get; }
    public ICommand RemoveEmailRecipientCommand { get; }
    public ICommand SendEmailCommand { get; }
    public ICommand CloseCommand { get; }

    /// <summary>Файл выбран и прошёл локальную проверку — «Распознать» активна.</summary>
    public bool HasFile => _selectedPath is not null;

    /// <summary>Имя выбранного файла — превью-строка в диалоге.</summary>
    public string FileName
    {
        get => _fileName;
        private set => SetProperty(ref _fileName, value);
    }

    /// <summary>Размер выбранного файла человеческим видом («2,4 МБ»).</summary>
    public string FileSizeText
    {
        get => _fileSizeText;
        private set => SetProperty(ref _fileSizeText, value);
    }

    // ---- Черновик после parse ----

    /// <summary>Черновик получен — форма правки и таблица позиций видны.</summary>
    public bool HasDraft => _draft is not null;

    /// <summary>«От сотрудника» — кто выдал технику по акту (from_employee).</summary>
    public string FromEmployeeText
    {
        get => _fromEmployeeText;
        set => SetProperty(ref _fromEmployeeText, value ?? string.Empty);
    }

    /// <summary>«На сотрудника» — кто принял технику по акту (to_employee).</summary>
    public string ToEmployeeText
    {
        get => _toEmployeeText;
        set => SetProperty(ref _toEmployeeText, value ?? string.Empty);
    }

    /// <summary>Дата документа (doc_date): дефолт сервера — момент загрузки.</summary>
    public string DocDateText
    {
        get => _docDateText;
        set => SetProperty(ref _docDateText, value ?? string.Empty);
    }

    /// <summary>Итоговый список инв. номеров текстом — разбор как parseInvNosInput веба.</summary>
    public string InvNosText
    {
        get => _invNosText;
        set
        {
            if (!SetProperty(ref _invNosText, value ?? string.Empty))
            {
                return;
            }

            // Правка списка обнуляет подтверждение — проверка заново, как в вебе.
            if (_invVerified)
            {
                _invVerified = false;
                OnPropertyChanged(nameof(InvVerified));
            }

            RefreshVerification();
        }
    }

    /// <summary>Разрешённые сервером позиции (resolved_items) — сверка с PDF.</summary>
    public ObservableCollection<UploadedActItemViewModel> ResolvedItems { get; } = [];

    public bool HasResolvedItems => ResolvedItems.Count > 0;

    /// <summary>Предупреждения парсера (warnings[]) — желтая плашка под черновиком.</summary>
    public string WarningsText
    {
        get => _warningsText;
        private set
        {
            if (SetProperty(ref _warningsText, value))
            {
                OnPropertyChanged(nameof(HasWarnings));
            }
        }
    }

    public bool HasWarnings => WarningsText.Length > 0;

    // ---- Верификация инвентарных номеров (buildUploadActInvVerification веба) ----

    /// <summary>Заголовок блока сверки: совпадает/отличается/не распознано.</summary>
    public string VerificationHeadline
    {
        get => _verificationHeadline;
        private set => SetProperty(ref _verificationHeadline, value);
    }

    /// <summary>Сверка не сходится или номеров нет — плашка жёлтая, не зелёная.</summary>
    public bool VerificationIsWarning
    {
        get => _verificationIsWarning;
        private set => SetProperty(ref _verificationIsWarning, value);
    }

    /// <summary>Найдено API — нормализованный список из черновика.</summary>
    public string RecognizedInvNosText
    {
        get => _recognizedInvNosText;
        private set => SetProperty(ref _recognizedInvNosText, value);
    }

    /// <summary>Будет записано в акт — разбор итогового поля.</summary>
    public string FinalInvNosText
    {
        get => _finalInvNosText;
        private set => SetProperty(ref _finalInvNosText, value);
    }

    /// <summary>Номера из распознанного, которые не попадут в запись.</summary>
    public string DroppedInvNosText
    {
        get => _droppedInvNosText;
        private set
        {
            if (SetProperty(ref _droppedInvNosText, value))
            {
                OnPropertyChanged(nameof(HasDroppedInvNos));
            }
        }
    }

    public bool HasDroppedInvNos => DroppedInvNosText.Length > 0;

    /// <summary>Номера, добавленные или изменённые вручную.</summary>
    public string AddedInvNosText
    {
        get => _addedInvNosText;
        private set
        {
            if (SetProperty(ref _addedInvNosText, value))
            {
                OnPropertyChanged(nameof(HasAddedInvNos));
            }
        }
    }

    public bool HasAddedInvNos => AddedInvNosText.Length > 0;

    /// <summary>В итоговом поле есть хотя бы один валидный номер — условие записи.</summary>
    public bool HasFinalInvNos
    {
        get => _hasFinalInvNos;
        private set
        {
            if (SetProperty(ref _hasFinalInvNos, value))
            {
                ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>«Я проверил инвентарные номера по PDF» — обязательный чек записи.</summary>
    public bool InvVerified
    {
        get => _invVerified;
        set
        {
            if (SetProperty(ref _invVerified, value))
            {
                ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
            }
        }
    }

    // ---- Состояние ----

    /// <summary>Parse или commit в полёте — поля и команды закрыты.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                ((NativeAsyncCommand)ParseAutoCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)ParseManualCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)PickFileCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Поля формы доступны вне полёта parse/commit.</summary>
    public bool AreInputsEnabled => !IsBusy;

    /// <summary>Скачивание записанного акта в полёте.</summary>
    public bool IsDownloading
    {
        get => _isDownloading;
        private set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                ((NativeAsyncCommand)DownloadActCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Строка этапа под прогрессом («Распознаём акт…», «Записываем акт…»).</summary>
    public string StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    /// <summary>Ошибка выбора/parse/commit — форма сохраняется.</summary>
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

    /// <summary>Инфо-плашка: ручной черновик, fallback, reminder-статус из ответа.</summary>
    public string? NoticeText
    {
        get => _noticeText;
        private set
        {
            if (SetProperty(ref _noticeText, value))
            {
                OnPropertyChanged(nameof(HasNotice));
            }
        }
    }

    public bool HasNotice => !string.IsNullOrEmpty(NoticeText);

    /// <summary>Акт записан — форму прячем, показываем итог и «Скачать акт».</summary>
    public bool HasResult => _result is not null;

    /// <summary>Черновик ещё не записан — форма правки и «Записать акт» видны.</summary>
    public bool ShowsDraftForm => HasDraft && !HasResult;

    /// <summary>Итог записи: «Акт загружен. DOC_NO: X, FILE_NO: Y.»</summary>
    public string ResultText
    {
        get => _resultText;
        private set => SetProperty(ref _resultText, value);
    }

    /// <summary>Привязанные позиции из ответа commit (linked_inv_nos).</summary>
    public string ResultInvNosText
    {
        get => _resultInvNosText;
        private set
        {
            if (SetProperty(ref _resultInvNosText, value))
            {
                OnPropertyChanged(nameof(HasResultInvNos));
            }
        }
    }

    public bool HasResultInvNos => ResultInvNosText.Length > 0;

    /// <summary>Коммит разрешён: черновик, валидные номера, чек проверки — как isUploadActCommitDisabled веба.</summary>
    public bool CanCommit => HasDraft && HasFinalInvNos && InvVerified && !IsBusy && !HasResult;

    // ---- Reminder-панель (binding-режим из «Загрузить подписанный акт»/диплинка) ----

    /// <summary>Диалог привязан к reminder-задаче — панель напоминания видна.</summary>
    public bool HasReminderBinding
    {
        get => _hasReminderBinding;
        private set => SetProperty(ref _hasReminderBinding, value);
    }

    /// <summary>reminder_id для commit-запроса и GET напоминания.</summary>
    public string? ReminderId
    {
        get => _reminderId;
        private set
        {
            if (SetProperty(ref _reminderId, value))
            {
                ((NativeAsyncCommand)RefreshReminderCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>task_id напоминания — source_task_id в commit и «Открыть задачу».</summary>
    public string? ReminderTaskId
    {
        get => _reminderTaskId;
        private set
        {
            if (SetProperty(ref _reminderTaskId, value))
            {
                OnPropertyChanged(nameof(HasReminderTask));
                ((NativeRelayCommand)OpenReminderTaskCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasReminderTask => _reminderTaskId is { Length: > 0 };

    /// <summary>GET reminder в полёте (первичная загрузка, «Обновить», после commit).</summary>
    public bool IsReminderLoading
    {
        get => _isReminderLoading;
        private set
        {
            if (SetProperty(ref _isReminderLoading, value))
            {
                ((NativeAsyncCommand)RefreshReminderCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>
    /// Ошибка GET reminder изолирована в панели — общий флоу загрузки акта
    /// не ломается (как веб: reminder-запрос вне основного try/catch).
    /// </summary>
    public string? ReminderErrorText
    {
        get => _reminderErrorText;
        private set
        {
            if (SetProperty(ref _reminderErrorText, value))
            {
                OnPropertyChanged(nameof(HasReminderError));
            }
        }
    }

    public bool HasReminderError => !string.IsNullOrEmpty(ReminderErrorText);

    /// <summary>Сводка счётчиков напоминания: «Ожидается актов: N. Загружено: M.»</summary>
    public string ReminderSummaryText
    {
        get => _reminderSummaryText;
        private set
        {
            if (SetProperty(ref _reminderSummaryText, value))
            {
                OnPropertyChanged(nameof(HasReminderSummary));
            }
        }
    }

    public bool HasReminderSummary => ReminderSummaryText.Length > 0;

    /// <summary>Pending-группы напоминания (превью) — «от кого / инв. номера».</summary>
    public ObservableCollection<UploadReminderGroupItemViewModel> ReminderPendingGroups { get; } = [];

    public bool HasReminderPendingGroups => ReminderPendingGroups.Count > 0;

    /// <summary>«… и ещё N» — если pending-групп больше превью.</summary>
    public string ReminderMoreGroupsText
    {
        get => _reminderMoreGroupsText;
        private set
        {
            if (SetProperty(ref _reminderMoreGroupsText, value))
            {
                OnPropertyChanged(nameof(HasReminderMoreGroups));
            }
        }
    }

    public bool HasReminderMoreGroups => ReminderMoreGroupsText.Length > 0;

    // ---- Email после записи (POST /equipment/acts/upload/email) ----

    /// <summary>«Автоотправка после записи» — чекбокс формы (autoEmail веба).</summary>
    public bool AutoEmailEnabled
    {
        get => _autoEmailEnabled;
        set => SetProperty(ref _autoEmailEnabled, value);
    }

    /// <summary>POST email в полёте (авто после commit или ручная отправка).</summary>
    public bool IsEmailBusy
    {
        get => _isEmailBusy;
        private set
        {
            if (SetProperty(ref _isEmailBusy, value))
            {
                ((NativeAsyncCommand)SendEmailCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Итог отправки: «Автоотправка: отправлено 1, ошибок 0.»</summary>
    public string? EmailStatusText
    {
        get => _emailStatusText;
        private set
        {
            if (SetProperty(ref _emailStatusText, value))
            {
                OnPropertyChanged(nameof(HasEmailStatus));
            }
        }
    }

    public bool HasEmailStatus => !string.IsNullOrEmpty(EmailStatusText);

    /// <summary>Ошибка отправки — отдельная плашка, commit-итог сохранён.</summary>
    public string? EmailErrorText
    {
        get => _emailErrorText;
        private set
        {
            if (SetProperty(ref _emailErrorText, value))
            {
                OnPropertyChanged(nameof(HasEmailError));
            }
        }
    }

    public bool HasEmailError => !string.IsNullOrEmpty(EmailErrorText);

    /// <summary>Тема письма — дефолт «Акт №{docNo}» после записи.</summary>
    public string EmailSubjectText
    {
        get => _emailSubjectText;
        set => SetProperty(ref _emailSubjectText, value ?? string.Empty);
    }

    /// <summary>Текст письма — дефолт с авто-подписью после записи.</summary>
    public string EmailBodyText
    {
        get => _emailBodyText;
        set => SetProperty(ref _emailBodyText, value ?? string.Empty);
    }

    /// <summary>Строка поиска получателя — debounce в SearchEquipmentOwnersAsync.</summary>
    public string EmailRecipientQuery
    {
        get => _emailRecipientQuery;
        set
        {
            if (SetProperty(ref _emailRecipientQuery, value ?? string.Empty))
            {
                ScheduleEmailRecipientSearch();
            }
        }
    }

    /// <summary>Popup с вариантами получателей открыт.</summary>
    public bool IsEmailRecipientPopupOpen
    {
        get => _isEmailRecipientPopupOpen;
        set => SetProperty(ref _isEmailRecipientPopupOpen, value);
    }

    /// <summary>Серверный поиск получателей в полёте — индикатор у поля.</summary>
    public bool IsEmailSearchBusy
    {
        get => _isEmailSearchBusy;
        private set => SetProperty(ref _isEmailSearchBusy, value);
    }

    /// <summary>Варианты подсказки получателя (owner_no + ФИО + отдел).</summary>
    public ObservableCollection<EditorEmployeeOption> EmailRecipientOptions { get; } = [];

    /// <summary>Выбранные получатели — чипы; уходят в owner_nos mode=selected.</summary>
    public ObservableCollection<EditorEmployeeOption> EmailRecipients { get; } = [];

    public bool HasEmailRecipients => EmailRecipients.Count > 0;

    /// <summary>Строки статусов получателей из последнего ответа email.</summary>
    public ObservableCollection<string> EmailRecipientStatuses { get; } = [];

    public bool HasEmailRecipientStatuses => EmailRecipientStatuses.Count > 0;

    private void PickFile()
    {
        var path = _filePicker?.Invoke().FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(path))
        {
            SelectFile(path);
        }
    }

    /// <summary>
    /// Локальная проверка выбранного файла — как validateUploadActPdfFile веба:
    /// только PDF, ≤15 МБ, файл читается. Новый выбор сбрасывает черновик и итог.
    /// </summary>
    public void SelectFile(string? path)
    {
        ErrorText = null;
        NoticeText = null;
        ClearDraft();
        _selectedPath = null;
        FileName = string.Empty;
        FileSizeText = string.Empty;
        OnPropertyChanged(nameof(HasFile));
        ((NativeAsyncCommand)ParseAutoCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)ParseManualCommand).RaiseCanExecuteChanged();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        if (!string.Equals(Path.GetExtension(path), ".pdf", StringComparison.OrdinalIgnoreCase))
        {
            ErrorText = "Поддерживается только PDF.";
            return;
        }

        FileInfo info;
        try
        {
            info = new FileInfo(path);
        }
        catch (Exception)
        {
            ErrorText = "Файл недоступен.";
            return;
        }

        if (!info.Exists)
        {
            ErrorText = "Файл не найден: " + Path.GetFileName(path);
            return;
        }

        if (info.Length <= 0)
        {
            ErrorText = "Файл пустой.";
            return;
        }

        if (info.Length > MaxActBytes)
        {
            ErrorText = "PDF слишком большой: "
                + (info.Length / (1024.0 * 1024.0)).ToString("0.0", CultureInfo.InvariantCulture)
                + " МБ. Максимальный размер для акта: 15 МБ.";
            return;
        }

        _selectedPath = info.FullName;
        FileName = info.Name;
        FileSizeText = FormatFileSize(info.Length);
        OnPropertyChanged(nameof(HasFile));
        ((NativeAsyncCommand)ParseAutoCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)ParseManualCommand).RaiseCanExecuteChanged();
    }

    // ---- Parse: автоматически или ручной черновик (fallback при недоступном LLM) ----

    internal async Task ParseAsync(bool manualMode, CancellationToken cancellationToken)
    {
        var path = _selectedPath;
        if (path is null || IsBusy)
        {
            return;
        }

        IsBusy = true;
        ErrorText = null;
        NoticeText = null;
        StatusText = manualMode ? "Создаём ручной черновик…" : "Распознаём акт…";
        try
        {
            var data = await File.ReadAllBytesAsync(path, cancellationToken);
            try
            {
                var draft = await _api.ParseUploadedActAsync(
                    FileName, data, manualMode, cancellationToken);
                ApplyDraft(draft);
                if (manualMode)
                {
                    NoticeText = "Черновик создан в ручном режиме. Заполните поля акта и инвентарные номера.";
                }
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception) when (!manualMode && IsRecognitionUnavailable(exception))
            {
                // LLM/распознавание недоступно — веб фолбэчит на manual_mode:
                // сервер вернёт пустой черновик, поля заполняет пользователь.
                var fallback = await _api.ParseUploadedActAsync(
                    FileName, data, manualMode: true, cancellationToken);
                ApplyDraft(fallback);
                NoticeText = "API распознавания недоступен. Создан ручной черновик для заполнения.";
            }
        }
        finally
        {
            IsBusy = false;
            StatusText = string.Empty;
        }
    }

    /// <summary>isApiUnavailableForActParseError веба: fallback только при ответе сервера.</summary>
    private static bool IsRecognitionUnavailable(Exception exception)
    {
        if (exception is not HubApiException { Kind: HubApiErrorKind.Http } http)
        {
            return false;
        }

        var detail = (http.Message ?? string.Empty).ToLowerInvariant();
        return detail.Contains("openrouter")
            || detail.Contains("api распознавания")
            || detail.Contains("распознавание через модель")
            || detail.Contains("act_parse_model")
            || detail.Contains("ocr_model")
            || detail.Contains("timeout")
            || detail.Contains("timed out");
    }

    /// <summary>Применить черновик: поля формы, позиции, предупреждения, сверка номеров.</summary>
    private void ApplyDraft(HubUploadedActDraft draft)
    {
        _draft = draft;
        _recognizedInvNos = UniqueInvNos(draft.EquipmentInvNos);
        FromEmployeeText = draft.FromEmployee?.Trim() ?? string.Empty;
        ToEmployeeText = draft.ToEmployee?.Trim() ?? string.Empty;
        DocDateText = draft.DocDate?.Trim() ?? string.Empty;
        // Сеттер InvNosText сам обновит сверку; верификация — заново.
        InvNosText = string.Join(", ", _recognizedInvNos);
        _invVerified = false;
        OnPropertyChanged(nameof(InvVerified));
        ResolvedItems.Clear();
        foreach (var item in draft.ResolvedItems ?? [])
        {
            ResolvedItems.Add(new UploadedActItemViewModel(item));
        }

        WarningsText = string.Join(
            "\n",
            (draft.Warnings ?? [])
                .Where(warning => !string.IsNullOrWhiteSpace(warning))
                .Select(warning => warning!.Trim()));
        // Reminder-режим: пустые поля черновика добираем из напоминания —
        // в ручном режиме форма стартует уже заполненной.
        PrefillFromReminder();
        ErrorText = null;
        OnPropertyChanged(nameof(HasDraft));
        OnPropertyChanged(nameof(ShowsDraftForm));
        OnPropertyChanged(nameof(HasResolvedItems));
        ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
    }

    /// <summary>Сброс черновика/итога при новом файле — как setUploadActDraft(null) веба.</summary>
    private void ClearDraft()
    {
        _draft = null;
        _result = null;
        _recognizedInvNos = [];
        FromEmployeeText = string.Empty;
        ToEmployeeText = string.Empty;
        DocDateText = string.Empty;
        InvNosText = string.Empty;
        _invVerified = false;
        OnPropertyChanged(nameof(InvVerified));
        ResolvedItems.Clear();
        WarningsText = string.Empty;
        ResultText = string.Empty;
        ResultInvNosText = string.Empty;
        EmailStatusText = null;
        EmailErrorText = null;
        EmailRecipientStatuses.Clear();
        OnPropertyChanged(nameof(HasDraft));
        OnPropertyChanged(nameof(ShowsDraftForm));
        OnPropertyChanged(nameof(HasResolvedItems));
        OnPropertyChanged(nameof(HasResult));
        ((NativeAsyncCommand)DownloadActCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
    }

    // ---- Reminder-binding: панель, загрузка напоминания, prefill из него ----

    /// <summary>
    /// Binding-режим (веб openUploadActModalForReminder и диплинк
    /// /database?upload_act=1&amp;reminder_id=…&amp;source_task_id=…): сохраняем
    /// id для commit'а и грузим данные напоминания. Привязка только по task_id —
    /// панель без деталей до commit'а, когда сервер вернёт reminder_id.
    /// </summary>
    internal async Task BeginReminderBindingAsync(
        string? reminderId,
        string? sourceTaskId,
        CancellationToken cancellationToken)
    {
        ReminderId = NullIfEmpty(reminderId);
        ReminderTaskId = NullIfEmpty(sourceTaskId);
        HasReminderBinding = ReminderId is not null || ReminderTaskId is not null;
        _reminder = null;
        ReminderErrorText = null;
        ReminderSummaryText = string.Empty;
        ReminderPendingGroups.Clear();
        ReminderMoreGroupsText = string.Empty;
        if (ReminderId is null)
        {
            return;
        }

        await LoadReminderSafelyAsync(ReminderId, cancellationToken);
    }

    /// <summary>
    /// GET /equipment/transfer/reminders/{id}: ошибка изолирована в панель —
    /// загрузка акта продолжает работать без напоминания.
    /// </summary>
    internal async Task LoadReminderSafelyAsync(string reminderId, CancellationToken cancellationToken)
    {
        if (IsReminderLoading)
        {
            return;
        }

        IsReminderLoading = true;
        try
        {
            var reminder = await _api.GetTransferReminderAsync(reminderId, cancellationToken);
            ApplyReminder(reminder);
            ReminderErrorText = null;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            ReminderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsReminderLoading = false;
        }
    }

    /// <summary>Применить ответ reminder'а: сводка, pending-группы, prefill полей.</summary>
    private void ApplyReminder(HubTransferActReminder reminder)
    {
        _reminder = reminder;
        if (NullIfEmpty(reminder.ReminderId) is { } reminderId)
        {
            ReminderId = reminderId;
        }

        if (NullIfEmpty(reminder.TaskId) is { } taskId)
        {
            ReminderTaskId = taskId;
        }

        ReminderSummaryText =
            $"Ожидается актов: {reminder.PendingGroupsTotal}. Загружено: {reminder.CompletedGroupsTotal}.";
        var groups = reminder.PendingGroups ?? [];
        ReminderPendingGroups.Clear();
        foreach (var group in groups.Take(ReminderGroupsPreviewLimit))
        {
            var invNos = (group.InvNos ?? [])
                .Select(invNo => invNo?.Trim())
                .Where(invNo => !string.IsNullOrEmpty(invNo))
                .Cast<string>()
                .ToArray();
            ReminderPendingGroups.Add(new UploadReminderGroupItemViewModel
            {
                TitleText = NullIfEmpty(group.OldEmployeeName) ?? "—",
                InvNosText = string.Join(", ", invNos),
            });
        }

        var hidden = Math.Max(0, reminder.PendingGroupsTotal - ReminderPendingGroups.Count);
        ReminderMoreGroupsText = hidden > 0 ? $"… и ещё {hidden}" : string.Empty;
        PrefillFromReminder();
    }

    /// <summary>
    /// Prefill из reminder-payload: получатель — из new_employee_name; одиночная
    /// pending-группа — её владелец и инв. номера. Только пустые поля — ввод
    /// пользователя и распознанные значения не затираем.
    /// </summary>
    private void PrefillFromReminder()
    {
        var reminder = _reminder;
        if (reminder is null || HasResult)
        {
            return;
        }

        if (ToEmployeeText.Length == 0 && NullIfEmpty(reminder.NewEmployeeName) is { } toEmployee)
        {
            ToEmployeeText = toEmployee;
        }

        var groups = reminder.PendingGroups ?? [];
        if (groups.Count == 1 && groups[0] is { } group)
        {
            if (FromEmployeeText.Length == 0 && NullIfEmpty(group.OldEmployeeName) is { } fromEmployee)
            {
                FromEmployeeText = fromEmployee;
            }

            if (ParseInvNosText(_invNosText).Count == 0 && (group.InvNos?.Count ?? 0) > 0)
            {
                InvNosText = string.Join(", ", group.InvNos ?? []);
            }
        }
    }

    /// <summary>Сверка «Найдено API» vs «Будет записано» — buildUploadActInvVerification веба.</summary>
    private void RefreshVerification()
    {
        var recognized = _recognizedInvNos;
        var final = ParseInvNosText(_invNosText);
        var finalKeys = new HashSet<string>(final, StringComparer.OrdinalIgnoreCase);
        var recognizedKeys = new HashSet<string>(recognized, StringComparer.OrdinalIgnoreCase);
        var onlyRecognized = recognized.Where(item => !finalKeys.Contains(item)).ToArray();
        var onlyFinal = final.Where(item => !recognizedKeys.Contains(item)).ToArray();

        if (recognized.Count == 0)
        {
            VerificationIsWarning = true;
            VerificationHeadline =
                "API не нашёл инвентарные номера. Проверьте введённый список по PDF перед записью.";
        }
        else if (onlyRecognized.Length > 0 || onlyFinal.Length > 0)
        {
            VerificationIsWarning = true;
            VerificationHeadline =
                "Итоговый список отличается от распознанного API. Проверьте номера перед записью.";
        }
        else
        {
            VerificationIsWarning = false;
            VerificationHeadline = "Итоговый список совпадает с номерами, найденными API.";
        }

        RecognizedInvNosText = recognized.Count > 0 ? string.Join(", ", recognized) : "—";
        FinalInvNosText = final.Count > 0 ? string.Join(", ", final) : "—";
        DroppedInvNosText = onlyRecognized.Length > 0
            ? "Не попадут в запись: " + string.Join(", ", onlyRecognized)
            : string.Empty;
        AddedInvNosText = onlyFinal.Length > 0
            ? "Добавлены или изменены вручную: " + string.Join(", ", onlyFinal)
            : string.Empty;
        HasFinalInvNos = final.Count > 0;
    }

    /// <summary>Разбор текстового поля инв. номеров — parseInvNosInput веба (дедуп, порядок).</summary>
    internal static IReadOnlyList<string> ParseInvNosText(string? text)
    {
        var result = new List<string>();
        if (string.IsNullOrWhiteSpace(text))
        {
            return result;
        }

        var start = 0;
        var length = text.Length;
        while (start < length)
        {
            var end = start;
            while (end < length && !IsInvNoSeparator(text[end]))
            {
                end++;
            }

            var normalized = NormalizeInvNo(text[start..end]);
            if (normalized.Length > 0 && !result.Contains(normalized, StringComparer.Ordinal))
            {
                result.Add(normalized);
            }

            start = end + 1;
        }

        return result;
    }

    private static bool IsInvNoSeparator(char value)
        => char.IsWhiteSpace(value) || value is ',' or ';';

    /// <summary>
    /// Нормализация инв. номера — normalizeInvNoValue веба: убрать пробелы/«№»/
    /// краевые пунктуаторы, «123.0»→«123», только цифры, без ведущих нулей.
    /// </summary>
    private static string NormalizeInvNo(string? raw)
    {
        var normalized = (raw ?? string.Empty).Trim();
        if (normalized.Length == 0)
        {
            return string.Empty;
        }

        normalized = string.Concat(normalized.Where(ch => !char.IsWhiteSpace(ch) && ch != '№'));
        normalized = normalized.Trim('.', ',', ';', ':', '|');
        if (normalized.Length == 0)
        {
            return string.Empty;
        }

        // «123,0»/«123.0» — дробное представление целого номера из PDF.
        var separatorIndex = normalized.IndexOfAny(['.', ',']);
        if (separatorIndex > 0
            && separatorIndex < normalized.Length - 1
            && normalized[..separatorIndex].All(char.IsDigit)
            && normalized[(separatorIndex + 1)..].All(ch => ch == '0'))
        {
            normalized = normalized[..separatorIndex];
        }

        if (!normalized.All(char.IsDigit))
        {
            return string.Empty;
        }

        normalized = normalized.TrimStart('0');
        return normalized.Length > 0 ? normalized : "0";
    }

    /// <summary>Список номеров из черновика → нормализованный уникальный список.</summary>
    private static IReadOnlyList<string> UniqueInvNos(IReadOnlyList<string>? values)
    {
        var result = new List<string>();
        foreach (var value in values ?? [])
        {
            var normalized = NormalizeInvNo(value);
            if (normalized.Length > 0 && !result.Contains(normalized, StringComparer.Ordinal))
            {
                result.Add(normalized);
            }
        }

        return result;
    }

    // ---- Commit ----

    internal async Task CommitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy || HasResult)
        {
            return;
        }

        var draftId = _draft?.DraftId?.Trim() ?? string.Empty;
        if (draftId.Length == 0)
        {
            ErrorText = "Черновик не найден. Выполните распознавание снова.";
            return;
        }

        var finalInvNos = ParseInvNosText(_invNosText);
        if (finalInvNos.Count == 0)
        {
            ErrorText = "Укажите хотя бы один инвентарный номер для привязки акта.";
            return;
        }

        if (!InvVerified)
        {
            ErrorText = "Подтвердите проверку инвентарных номеров перед записью.";
            return;
        }

        IsBusy = true;
        ErrorText = null;
        StatusText = "Записываем акт…";
        try
        {
            var result = await _api.CommitUploadedActAsync(
                new HubUploadedActCommitRequest
                {
                    // Пустые поля не шлём — сервер возьмёт их из черновика.
                    DraftId = draftId,
                    FromEmployee = NullIfEmpty(_fromEmployeeText),
                    ToEmployee = NullIfEmpty(_toEmployeeText),
                    DocDate = NullIfEmpty(_docDateText),
                    EquipmentInvNos = finalInvNos,
                    // Reminder-binding: диалог открыт из «Загрузить подписанный
                    // акт»/диплинка — сервер обновит reminder-задачу.
                    ReminderId = _reminderId,
                    SourceTaskId = _reminderTaskId,
                },
                cancellationToken);
            _result = result;
            var docNo = result.DocNo.ToString(CultureInfo.InvariantCulture);
            var fileNo = result.FileNo.ToString(CultureInfo.InvariantCulture);
            ResultText = $"Акт загружен. DOC_NO: {docNo}, FILE_NO: {fileNo}.";
            var linked = result.LinkedInvNos?
                .Where(invNo => !string.IsNullOrWhiteSpace(invNo))
                .Select(invNo => invNo!.Trim())
                .ToArray() ?? [];
            ResultInvNosText = linked.Length > 0
                ? "Привязанные позиции: " + string.Join(", ", linked)
                : string.Empty;
            // reminder_* в ответе возможны и без нативной привязки напоминания.
            if (!string.IsNullOrWhiteSpace(result.ReminderWarning))
            {
                NoticeText = result.ReminderWarning.Trim();
            }
            else if (string.Equals(result.ReminderStatus?.Trim(), "matched_partial", StringComparison.Ordinal))
            {
                NoticeText = $"Подписанный акт привязан к reminder-задаче. Осталось актов: {result.ReminderPendingGroups}.";
            }
            else if (string.Equals(result.ReminderStatus?.Trim(), "completed", StringComparison.Ordinal))
            {
                NoticeText = "Все подписанные акты загружены. Reminder-задача закрыта автоматически.";
            }

            OnPropertyChanged(nameof(HasResult));
            OnPropertyChanged(nameof(ShowsDraftForm));
            ((NativeAsyncCommand)ParseAutoCommand).RaiseCanExecuteChanged();
            ((NativeAsyncCommand)ParseManualCommand).RaiseCanExecuteChanged();
            ((NativeAsyncCommand)CommitCommand).RaiseCanExecuteChanged();
            ((NativeAsyncCommand)DownloadActCommand).RaiseCanExecuteChanged();
            ((NativeRelayCommand)PickFileCommand).RaiseCanExecuteChanged();

            // Reminder после записи: сервер вернул reminder_id/task_id —
            // дочитываем напоминание как веб (loadTransferReminder), ошибка
            // GET изолируется в панель и не ломает итог.
            var nextReminderId = NullIfEmpty(result.ReminderId) ?? _reminderId;
            if (nextReminderId is not null)
            {
                ReminderId = nextReminderId;
                if (NullIfEmpty(result.ReminderTaskId) is { } reminderTaskId)
                {
                    ReminderTaskId = reminderTaskId;
                }

                HasReminderBinding = true;
                await LoadReminderSafelyAsync(nextReminderId, cancellationToken);
            }

            // Email-блок: дефолтные тема/тело как в вебе (buildUploadActEmailDefaults).
            EmailSubjectText = $"Акт №{docNo}";
            EmailBodyText = $"Во вложении акт №{docNo}.\n\nПисьмо сформировано автоматически системой IT Invent.";
            EmailStatusText = null;
            EmailErrorText = null;
            EmailRecipientStatuses.Clear();
            // Автоотправка (autoEmail веба): сервер резолвит получателей по ФИО
            // from/to акта; без сотрудников — только подсказка про ручную отправку.
            if (AutoEmailEnabled && (_fromEmployeeText.Trim().Length > 0 || _toEmployeeText.Trim().Length > 0))
            {
                await SendEmailAsync(
                    new HubUploadedActEmailRequest
                    {
                        DocNo = result.DocNo,
                        Mode = "auto",
                        FromEmployee = NullIfEmpty(_fromEmployeeText),
                        ToEmployee = NullIfEmpty(_toEmployeeText),
                        Subject = EmailSubjectText,
                        Body = EmailBodyText,
                    },
                    isAuto: true,
                    cancellationToken);
            }
            else
            {
                EmailStatusText = "Акт сохранён. Укажите сотрудников в блоке ниже и отправьте вручную.";
            }
        }
        finally
        {
            IsBusy = false;
            StatusText = string.Empty;
        }
    }

    // ---- Email: автоматическая и ручная отправка записанного акта ----

    /// <summary>
    /// POST /equipment/acts/upload/email — общий путь для auto/selected.
    /// Ошибки почты изолированы: записанный акт и reminder-статус не трогаем.
    /// </summary>
    private async Task SendEmailAsync(
        HubUploadedActEmailRequest request, bool isAuto, CancellationToken cancellationToken)
    {
        IsEmailBusy = true;
        EmailErrorText = null;
        EmailStatusText = null;
        try
        {
            var result = await _api.SendUploadedActEmailAsync(request, cancellationToken);
            EmailRecipientStatuses.Clear();
            foreach (var recipient in result.Recipients ?? [])
            {
                EmailRecipientStatuses.Add(FormatEmailRecipientStatus(recipient));
            }

            EmailStatusText = isAuto
                ? $"Автоотправка: отправлено {result.SuccessCount}, ошибок {result.FailedCount}."
                : $"Отправлено: {result.SuccessCount}, ошибок: {result.FailedCount}.";
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            EmailErrorText = (isAuto ? "Автоотправка не выполнена. " : string.Empty)
                + TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsEmailBusy = false;
        }
    }

    /// <summary>Ручная отправка: mode=selected + owner_nos из чипов получателей.</summary>
    internal async Task SendSelectedEmailAsync(CancellationToken cancellationToken)
    {
        var result = _result;
        if (result?.DocNo is not > 0 || IsEmailBusy)
        {
            return;
        }

        var ownerNos = EmailRecipients
            .Where(chip => chip.OwnerNo.HasValue)
            .Select(chip => chip.OwnerNo!.Value)
            .ToArray();
        if (ownerNos.Length == 0)
        {
            EmailErrorText = "Выберите хотя бы одного сотрудника.";
            return;
        }

        await SendEmailAsync(
            new HubUploadedActEmailRequest
            {
                DocNo = result.DocNo,
                Mode = "selected",
                OwnerNos = ownerNos,
                Subject = NullIfEmpty(_emailSubjectText),
                Body = NullIfEmpty(_emailBodyText),
            },
            isAuto: false,
            cancellationToken);
    }

    /// <summary>Строка статуса получателя для списка: «Иванов И.И. (mail) — sent — detail».</summary>
    private static string FormatEmailRecipientStatus(HubUploadedActEmailRecipient recipient)
    {
        var name = NullIfEmpty(recipient.EmployeeName) ?? recipient.OwnerNo?.ToString() ?? "—";
        var email = NullIfEmpty(recipient.Email);
        var status = NullIfEmpty(recipient.Status) ?? "unknown";
        var detail = NullIfEmpty(recipient.Detail);
        return name
            + (email is null ? string.Empty : $" ({email})")
            + $" — {status}"
            + (detail is null ? string.Empty : $": {detail}");
    }

    /// <summary>Добавить получателя из подсказки — дедуп по owner_no.</summary>
    private void AddEmailRecipient(EditorEmployeeOption option)
    {
        if (option.OwnerNo is { } ownerNo
            && EmailRecipients.Any(chip => chip.OwnerNo == ownerNo))
        {
            EmailRecipientQuery = string.Empty;
            IsEmailRecipientPopupOpen = false;
            return;
        }

        EmailRecipients.Add(option);
        EmailRecipientQuery = string.Empty;
        IsEmailRecipientPopupOpen = false;
    }

    /// <summary>Debounce поиска получателей email — тот же паттерн, что у передачи.</summary>
    private void ScheduleEmailRecipientSearch()
    {
        _emailSearchCancellation?.Cancel();
        _emailSearchCancellation?.Dispose();
        var query = _emailRecipientQuery.Trim();
        if (query.Length < EmailSearchMinLength)
        {
            _emailSearchCancellation = null;
            IsEmailRecipientPopupOpen = false;
            EmailRecipientOptions.Clear();
            return;
        }

        var cancellation = new CancellationTokenSource();
        _emailSearchCancellation = cancellation;
        _ = SearchEmailRecipientsSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchEmailRecipientsSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(EmailSearchDebounce, cancellationToken);
            if (!string.Equals(_emailRecipientQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            IsEmailSearchBusy = true;
            var owners = await _api.SearchEquipmentOwnersAsync(
                query, EmailSearchLimit, cancellationToken);
            if (!string.Equals(_emailRecipientQuery.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            EmailRecipientOptions.Clear();
            foreach (var owner in owners)
            {
                if (!string.IsNullOrWhiteSpace(owner.OwnerDisplayName))
                {
                    EmailRecipientOptions.Add(new EditorEmployeeOption(owner));
                }
            }

            IsEmailRecipientPopupOpen = EmailRecipientOptions.Count > 0;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            // Подсказки опциональны — без них форма отправки работает (как console.error веба).
            EmailRecipientOptions.Clear();
            IsEmailRecipientPopupOpen = false;
        }
        finally
        {
            IsEmailSearchBusy = false;
        }
    }

    // ---- Скачивание записанного акта — GET /equipment/acts/{doc_no}/file ----

    internal async Task DownloadActAsync(CancellationToken cancellationToken)
    {
        var result = _result;
        if (result?.DocNo is not > 0 || IsDownloading)
        {
            return;
        }

        IsDownloading = true;
        try
        {
            var docNo = result.DocNo;
            if (_actFileSaver is not null)
            {
                await _actFileSaver(docNo);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "acts");
            Directory.CreateDirectory(directory);
            var target = Path.Combine(directory, $"uploaded-act-{docNo.ToString(CultureInfo.InvariantCulture)}.pdf");
            if (!File.Exists(target))
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadEquipmentActFileAsync(
                    docNo, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var safeName = string.Concat(
                        downloadedName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
                    var renamed = Path.Combine(
                        directory,
                        $"{docNo.ToString(CultureInfo.InvariantCulture)}-{safeName}");
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
            IsDownloading = false;
        }
    }

    private static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value!.Trim();

    internal static string FormatFileSize(long bytes) => bytes switch
    {
        >= 1024 * 1024 =>
            (bytes / (1024.0 * 1024.0)).ToString("0.#", CultureInfo.InvariantCulture) + " МБ",
        >= 1024 => (bytes / 1024.0).ToString("0.#", CultureInfo.InvariantCulture) + " КБ",
        _ => bytes.ToString(CultureInfo.InvariantCulture) + " Б",
    };

    /// <summary>✕/Закрыть/Esc: in-flight запрос на сервере завершится сам — как у передачи.</summary>
    private void RequestClose() => Closed?.Invoke(this, EventArgs.Empty);
}

/// <summary>Строка pending-группы в reminder-панели диалога «Загрузить акт».</summary>
public sealed class UploadReminderGroupItemViewModel
{
    /// <summary>От кого акт (old_employee_name).</summary>
    public required string TitleText { get; init; }

    /// <summary>Инв. номера группы через запятую.</summary>
    public string InvNosText { get; init; } = string.Empty;
}

// ===================== Журнал работ (works journal) =====================
// Порт веб-слоя database/equipmentModel.js + actionExecution.js: capability-
// флаги по типу позиции, список потоков «Работы» в карточке и диалог
// регистрации операции (durable-списание склада или прямая запись журнала).

/// <summary>Тип журнальной работы карточки — actionType веб-диалога.</summary>
public enum MaintenanceWorkKind
{
    Cartridge,
    Battery,
    Component,
    Cleaning,
}

/// <summary>Опция выпадающего списка формы работы (тип компонента и т.п.).</summary>
public sealed record MaintenanceOptionItem(string Value, string Label)
{
    public override string ToString() => Label;
}

/// <summary>
/// Складской расходник в списке выбора диалога работы — обёртка строки
/// /equipment/consumables/lookup с меткой formatConsumableSourceLabel веба.
/// </summary>
public sealed record MaintenanceConsumableOption
{
    public MaintenanceConsumableOption(HubConsumableLookupItem item)
    {
        Item = item;
        var model = NullIfEmpty(item.ModelName) ?? "-";
        var type = NullIfEmpty(item.TypeName) ?? "-";
        var branch = NullIfEmpty(item.BranchName) ?? "-";
        var location = NullIfEmpty(item.LocationName) ?? "-";
        Label = $"{model} | {type} | {branch} / {location} | Остаток: {item.Qty}";
    }

    public HubConsumableLookupItem Item { get; }
    public long Id => Item.Id;
    public string? ModelName => NullIfEmpty(Item.ModelName);
    public string Label { get; }
    public override string ToString() => Label;

    internal static string? NullIfEmpty(string? value)
        => string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}

/// <summary>Строка журнальной записи в потоке «Работы»: дата, суть, детали.</summary>
public sealed record EquipmentWorkEntry
{
    public required string DateText { get; init; }
    public required string TitleText { get; init; }
    public string DetailText { get; init; } = string.Empty;
    public bool HasDetail => DetailText.Length > 0;
}

/// <summary>
/// Поток секции «Работы» карточки одного типа: сводка истории (*/history) и
/// последние записи журнала (список */{kind}). Каждый поток грузится и
/// ошибается независимо — сбой одного не ломает соседние (useDatabaseMaintenanceData веба).
/// </summary>
public sealed class EquipmentWorkStreamViewModel : ObservableObject
{
    /// <summary>Свежих записей в потоке (хвост журнала, новые сверху).</summary>
    internal const int EntryLimit = 5;

    /// <summary>Выборка списка под клиентский фильтра по serial/hw/inv.</summary>
    internal const int SourceLimit = 500;

    private bool _isLoading;
    private bool _loaded;
    private string? _errorText;
    private string _summaryText = string.Empty;
    private int _historyCount;

    public EquipmentWorkStreamViewModel(MaintenanceWorkKind kind, string componentKind)
    {
        Kind = kind;
        ComponentKind = componentKind;
        (IconText, TitleText, EmptyText) = kind switch
        {
            MaintenanceWorkKind.Cartridge => ("🖨", "Замена картриджа", "Замен картриджа не было"),
            MaintenanceWorkKind.Battery => ("🔋", "Замена батареи", "Замен батареи не было"),
            MaintenanceWorkKind.Component => ("🧩", "Замена комплектующих", "Замен комплектующих не было"),
            _ => ("🧹", "Чистка ПК", "Чисток не было"),
        };
    }

    public MaintenanceWorkKind Kind { get; }

    /// <summary>"pc"|"printer" — источник опций компонентов (componentKind веба).</summary>
    public string ComponentKind { get; }

    public string IconText { get; }
    public string TitleText { get; }
    public string EmptyText { get; }
    public string RegisterText => "Зарегистрировать";
    public ObservableCollection<EquipmentWorkEntry> Entries { get; } = [];
    public bool HasEntries => Entries.Count > 0;

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    /// <summary>Первая загрузка завершилась (успех или ошибка).</summary>
    public bool Loaded
    {
        get => _loaded;
        private set
        {
            if (SetProperty(ref _loaded, value))
            {
                OnPropertyChanged(nameof(ShowEmpty));
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
                OnPropertyChanged(nameof(ShowEmpty));
            }
        }
    }

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    /// <summary>Строка сводки history-эндпоинта: «N записей · последняя: …».</summary>
    public string SummaryText
    {
        get => _summaryText;
        private set => SetProperty(ref _summaryText, value);
    }

    public bool ShowEmpty => Loaded && !HasError && Entries.Count == 0 && _historyCount == 0;

    /// <summary>
    /// Сводка + список записей потока. Частичные данные показываем: сводка или
    /// список могут ответить ошибкой независимо — тогда текст ошибки и то, что пришло.
    /// </summary>
    internal async Task LoadAsync(
        IHubApiClient api, HubEquipmentItem item, string invNo, CancellationToken cancellationToken)
    {
        IsLoading = true;
        ErrorText = null;
        var serial = MaintenanceConsumableOption.NullIfEmpty(item.SerialNo);
        var hwSerial = MaintenanceConsumableOption.NullIfEmpty(item.HwSerialNo);
        try
        {
            HubMaintenanceHistory? history = null;
            Exception? historyError = null;
            try
            {
                history = await FetchHistoryAsync(api, item, serial, hwSerial, invNo, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception)
            {
                historyError = exception;
            }

            IReadOnlyList<EquipmentWorkEntry>? entries = null;
            Exception? entriesError = null;
            try
            {
                entries = await FetchEntriesAsync(api, serial, hwSerial, invNo, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception)
            {
                entriesError = exception;
            }

            var firstError = historyError ?? entriesError;
            ErrorText = firstError is null ? null : TasksViewModel.DescribeError(firstError);
            if (history is not null)
            {
                _historyCount = history.Count;
                SummaryText = FormatSummary(history);
            }
            else
            {
                SummaryText = "Сводка недоступна";
            }

            Entries.Clear();
            if (entries is not null)
            {
                foreach (var entry in entries)
                {
                    Entries.Add(entry);
                }
            }

            OnPropertyChanged(nameof(HasEntries));
            Loaded = true;
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            IsLoading = false;
        }
    }

    private Task<HubMaintenanceHistory> FetchHistoryAsync(
        IHubApiClient api,
        HubEquipmentItem item,
        string? serial,
        string? hwSerial,
        string invNo,
        CancellationToken cancellationToken)
        => Kind switch
        {
            MaintenanceWorkKind.Cartridge => api.GetCartridgeWorkHistoryAsync(
                serial, hwSerial, invNo, cartridgeModel: null, cancellationToken),
            MaintenanceWorkKind.Battery => api.GetBatteryWorkHistoryAsync(
                serial, hwSerial, cancellationToken),
            MaintenanceWorkKind.Component => api.GetComponentWorkHistoryAsync(
                serial, hwSerial, componentType: null, componentName: null, cancellationToken),
            _ => api.GetCleaningWorkHistoryAsync(
                serial, hwSerial, invNo, item.Id, cancellationToken),
        };

    /// <summary>
    /// Последние записи журнала потока. Серверный фильтр списка беднее history
    /// (только serial_number у части эндпоинтов), поэтому тянем хвост выдачи и
    /// матчим клиентом по serial/hw_serial/inv_no — как _record_matches_serial.
    /// </summary>
    private async Task<IReadOnlyList<EquipmentWorkEntry>> FetchEntriesAsync(
        IHubApiClient api,
        string? serial,
        string? hwSerial,
        string invNo,
        CancellationToken cancellationToken)
    {
        switch (Kind)
        {
            case MaintenanceWorkKind.Cartridge:
            {
                var rows = await api.GetCartridgeWorksAsync(SourceLimit, cancellationToken);
                return rows
                    .Where(row => EquipmentMaintenance.MatchesEquipment(
                            serial, hwSerial, invNo,
                            row.SerialNumber, row.SerialNo, row.HwSerialNo, row.InvNo)
                        && EquipmentMaintenance.IsCartridgeRow(row.ComponentType))
                    .TakeLast(EntryLimit)
                    .Reverse()
                    .Select(row => new EquipmentWorkEntry
                    {
                        DateText = EquipmentMaintenance.FormatWorkDate(row.Timestamp),
                        TitleText = MaintenanceConsumableOption.NullIfEmpty(row.CartridgeModel)
                            ?? MaintenanceConsumableOption.NullIfEmpty(row.PrinterModel)
                            ?? "Картридж",
                        DetailText = JoinDetails(
                            MaintenanceConsumableOption.NullIfEmpty(row.Employee)
                                ?? EquipmentMaintenance.ReadAdditionalString(row.AdditionalData, "employee"),
                            row.Branch,
                            row.Location),
                    })
                    .ToList();
            }

            case MaintenanceWorkKind.Battery:
            {
                var rows = await api.GetBatteryWorksAsync(serialNumber: null, SourceLimit, cancellationToken);
                return rows
                    .Where(row => EquipmentMaintenance.MatchesEquipment(
                        serial, hwSerial, invNo,
                        row.SerialNumber, row.SerialNo, row.HwSerialNo, row.InvNo))
                    .TakeLast(EntryLimit)
                    .Reverse()
                    .Select(row => new EquipmentWorkEntry
                    {
                        DateText = EquipmentMaintenance.FormatWorkDate(row.Timestamp),
                        TitleText = MaintenanceConsumableOption.NullIfEmpty(row.ModelName) ?? "Замена батареи",
                        DetailText = JoinDetails(
                            MaintenanceConsumableOption.NullIfEmpty(row.Employee)
                                ?? EquipmentMaintenance.ReadAdditionalString(row.AdditionalData, "employee"),
                            row.Branch,
                            row.Location),
                    })
                    .ToList();
            }

            case MaintenanceWorkKind.Component:
            {
                var rows = await api.GetComponentWorksAsync(serialNumber: null, SourceLimit, cancellationToken);
                return rows
                    .Where(row => EquipmentMaintenance.MatchesEquipment(
                        serial, hwSerial, invNo,
                        row.SerialNumber, row.SerialNo, row.HwSerialNo, row.InvNo))
                    .TakeLast(EntryLimit)
                    .Reverse()
                    .Select(row => new EquipmentWorkEntry
                    {
                        DateText = EquipmentMaintenance.FormatWorkDate(row.Timestamp),
                        TitleText = MaintenanceConsumableOption.NullIfEmpty(row.ComponentName)
                            ?? MaintenanceConsumableOption.NullIfEmpty(row.ComponentType)
                            ?? "Компонент",
                        DetailText = JoinDetails(
                            row.ComponentModel,
                            MaintenanceConsumableOption.NullIfEmpty(row.Employee)
                                ?? EquipmentMaintenance.ReadAdditionalString(row.AdditionalData, "employee")),
                    })
                    .ToList();
            }

            default:
            {
                var rows = await api.GetCleaningWorksAsync(serialNumber: null, SourceLimit, cancellationToken);
                return rows
                    .Where(row => EquipmentMaintenance.MatchesEquipment(
                        serial, hwSerial, invNo,
                        row.SerialNumber, row.SerialNo, row.HwSerialNo, row.InvNo))
                    .TakeLast(EntryLimit)
                    .Reverse()
                    .Select(row => new EquipmentWorkEntry
                    {
                        DateText = EquipmentMaintenance.FormatWorkDate(row.Timestamp),
                        TitleText = MaintenanceConsumableOption.NullIfEmpty(row.ModelName) ?? "Чистка",
                        DetailText = JoinDetails(
                            MaintenanceConsumableOption.NullIfEmpty(row.Employee)
                                ?? EquipmentMaintenance.ReadAdditionalString(row.AdditionalData, "employee"),
                            row.Location),
                    })
                    .ToList();
            }
        }
    }

    private static string FormatSummary(HubMaintenanceHistory history)
    {
        if (history.Count <= 0)
        {
            return "Не выполнялась";
        }

        var last = MaintenanceConsumableOption.NullIfEmpty(history.TimeAgoStr)
            ?? MaintenanceConsumableOption.NullIfEmpty(history.LastDate)
            ?? string.Empty;
        return FormatCount(history.Count, "запись", "записи", "записей")
            + (last.Length > 0 ? " · последняя: " + last : string.Empty);
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

    private static string JoinDetails(params string?[] parts)
        => string.Join(" · ", parts
            .Select(part => MaintenanceConsumableOption.NullIfEmpty(part))
            .Where(part => part is not null)!);
}

/// <summary>
/// Оверлей регистрации журнальной работы (MaintenanceActionContent веба):
/// для картриджа/комплектующей — durable-списание склада с вложенной записью
/// (operation_id на сессию диалога — повтор возобновляет, не списывает дважды),
/// для батареи/чистки — прямой POST /json/works/*.
/// </summary>
public sealed class MaintenanceDialogViewModel : ObservableObject
{
    /// <summary>Лимит справочника расходников — как limit=500 веб-загрузки.</summary>
    private const int ConsumableLookupLimit = 500;

    private readonly IHubApiClient _api;
    private readonly HubEquipmentItem _item;
    private readonly string _invNo;

    /// <summary>
    /// Сид durable-операции: один на сессию диалога — повторная отправка после
    /// сбоя переиспользует operation_id (как createMaintenanceOperationSeed веба).
    /// </summary>
    private readonly string _operationSeed;

    private CancellationTokenSource? _loadCancellation;
    private int _historyRequest;
    private bool _closed;
    private bool _isBusy;
    private bool _isConsumablesLoading;
    private string? _consumablesErrorText;
    private MaintenanceConsumableOption? _selectedConsumable;
    private MaintenanceOptionItem? _selectedComponentType;
    private bool _isHistoryLoading;
    private bool _historyLoaded;
    private string? _historyErrorText;
    private string _historyText = string.Empty;
    private string _historyEmptyText;
    private string _compatibilityText = string.Empty;
    private string? _errorText;

    public MaintenanceDialogViewModel(
        IHubApiClient api,
        HubEquipmentItem item,
        MaintenanceWorkKind kind,
        string componentKind)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _item = item ?? throw new ArgumentNullException(nameof(item));
        Kind = kind;
        ComponentKind = componentKind;
        _invNo = EquipmentCatalog.InvNoParameter(item.InvNo) ?? string.Empty;
        _operationSeed = EquipmentMaintenance.NewOperationSeed();

        TitleText = kind switch
        {
            MaintenanceWorkKind.Cartridge => "Замена картриджа",
            MaintenanceWorkKind.Battery => "Замена батареи",
            MaintenanceWorkKind.Component => "Замена комплектующих",
            _ => "Чистка ПК",
        };
        var model = MaintenanceConsumableOption.NullIfEmpty(item.ModelName) ?? "—";
        var serialText = MaintenanceConsumableOption.NullIfEmpty(item.SerialNo) ?? "—";
        var invText = _invNo.Length > 0 ? _invNo : "—";
        ItemMetaText = $"{model} · Инв. № {invText} · S/N {serialText}";

        ConsumableLabelText = kind == MaintenanceWorkKind.Cartridge
            ? "Картридж / расходник"
            : componentKind == "printer"
                ? "Запчасть / расходник"
                : "Компонент / расходник";
        ConsumableEmptyText = kind == MaintenanceWorkKind.Cartridge
            ? "Картриджи не найдены"
            : componentKind == "printer"
                ? "Нет запчастей (картриджи скрыты)"
                : "Расходники не найдены";

        _historyEmptyText = kind switch
        {
            MaintenanceWorkKind.Cartridge => "История замен картриджа пуста",
            MaintenanceWorkKind.Battery => "История замен батареи пуста",
            MaintenanceWorkKind.Component => "История замен по этому компоненту пуста",
            _ => "История чисток пуста",
        };
        HistoryCountLabel = kind == MaintenanceWorkKind.Cleaning ? "Всего чисток" : "Всего записей";

        if (kind == MaintenanceWorkKind.Component)
        {
            ComponentTypeOptions = EquipmentMaintenance.ComponentOptions(componentKind);
            _selectedComponentType = ComponentTypeOptions[0];
        }

        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex =>
            {
                if (ex is not OperationCanceledException)
                {
                    ErrorText = TasksViewModel.DescribeError(ex);
                }
            },
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(RequestClose, () => !IsBusy);
    }

    /// <summary>Работа записана — родитель перечитывает карточку и потоки.</summary>
    public event EventHandler? Completed;

    /// <summary>Закрытие оверлея (✕/Отмена/Esc и после успешной записи).</summary>
    public event EventHandler? Closed;

    public MaintenanceWorkKind Kind { get; }
    public string ComponentKind { get; }
    public string TitleText { get; }
    public string ItemMetaText { get; }
    public string ConsumableLabelText { get; }
    public string ConsumableEmptyText { get; }
    public string HistoryCountLabel { get; }

    // ---- Выбор типа компонента (только kind=Component) ----

    public bool ShowComponentTypeSelect => Kind == MaintenanceWorkKind.Component;
    public IReadOnlyList<MaintenanceOptionItem> ComponentTypeOptions { get; } = [];

    public MaintenanceOptionItem? SelectedComponentType
    {
        get => _selectedComponentType;
        set
        {
            if (SetProperty(ref _selectedComponentType, value))
            {
                OnPropertyChanged(nameof(HistoryTitleText));
                _ = LoadHistorySafelyAsync();
            }
        }
    }

    // ---- Справочник складских расходников (картридж/комплектующая) ----

    public bool ShowConsumables => Kind is MaintenanceWorkKind.Cartridge or MaintenanceWorkKind.Component;
    public ObservableCollection<MaintenanceConsumableOption> ConsumableOptions { get; } = [];

    public MaintenanceConsumableOption? SelectedConsumable
    {
        get => _selectedConsumable;
        set
        {
            if (SetProperty(ref _selectedConsumable, value))
            {
                OnPropertyChanged(nameof(HasSelectedConsumable));
                OnPropertyChanged(nameof(HistoryTitleText));
                // cartridgeModel истории веба — модель выбранного расходника.
                if (Kind == MaintenanceWorkKind.Cartridge)
                {
                    _ = LoadHistorySafelyAsync();
                }
            }
        }
    }

    public bool HasSelectedConsumable => SelectedConsumable is not null;

    public bool IsConsumablesLoading
    {
        get => _isConsumablesLoading;
        private set
        {
            if (SetProperty(ref _isConsumablesLoading, value))
            {
                OnPropertyChanged(nameof(ShowConsumablesEmpty));
            }
        }
    }

    public string? ConsumablesErrorText
    {
        get => _consumablesErrorText;
        private set
        {
            if (SetProperty(ref _consumablesErrorText, value))
            {
                OnPropertyChanged(nameof(HasConsumablesError));
                OnPropertyChanged(nameof(ShowConsumablesEmpty));
            }
        }
    }

    public bool HasConsumablesError => !string.IsNullOrEmpty(ConsumablesErrorText);
    public bool ShowConsumablesEmpty =>
        ShowConsumables && !IsConsumablesLoading && !HasConsumablesError && ConsumableOptions.Count == 0;

    // ---- Панель истории операции ----

    public string HistoryTitleText => Kind switch
    {
        MaintenanceWorkKind.Cartridge =>
            "ИСТОРИЯ ЗАМЕНЫ КАРТРИДЖА"
                + (SelectedConsumable?.ModelName is { } model ? $": {model}" : string.Empty),
        MaintenanceWorkKind.Battery => "ИСТОРИЯ ЗАМЕНЫ БАТАРЕИ",
        MaintenanceWorkKind.Component =>
            "ИСТОРИЯ ЗАМЕНЫ: "
                + EquipmentMaintenance.GetComponentLabel(ComponentKind, _selectedComponentType?.Value)
                    .ToUpper(CultureInfo.CurrentCulture),
        _ => "ИСТОРИЯ ЧИСТОК",
    };

    public bool IsHistoryLoading
    {
        get => _isHistoryLoading;
        private set => SetProperty(ref _isHistoryLoading, value);
    }

    public bool HistoryLoaded
    {
        get => _historyLoaded;
        private set
        {
            if (SetProperty(ref _historyLoaded, value))
            {
                OnPropertyChanged(nameof(ShowHistoryEmpty));
            }
        }
    }

    /// <summary>«Всего записей: N · последняя: …» — сводка истории операции.</summary>
    public string HistoryText
    {
        get => _historyText;
        private set => SetProperty(ref _historyText, value);
    }

    public string? HistoryErrorText
    {
        get => _historyErrorText;
        private set
        {
            if (SetProperty(ref _historyErrorText, value))
            {
                OnPropertyChanged(nameof(HasHistoryError));
                OnPropertyChanged(nameof(ShowHistoryEmpty));
            }
        }
    }

    public bool HasHistoryError => !string.IsNullOrEmpty(HistoryErrorText);
    public bool ShowHistoryEmpty => HistoryLoaded && !HasHistoryError && HistoryText.Length == 0;
    public string HistoryEmptyText => _historyEmptyText;

    // ---- Совместимость картриджей (GET /json/cartridges/compatibility) ----

    /// <summary>Строка «Совместимые: …» — только kind=Cartridge и непустая таблица.</summary>
    public string CompatibilityText
    {
        get => _compatibilityText;
        private set
        {
            if (SetProperty(ref _compatibilityText, value))
            {
                OnPropertyChanged(nameof(HasCompatibilityText));
            }
        }
    }

    public bool HasCompatibilityText => CompatibilityText.Length > 0;

    // ---- Состояние ----

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                OnPropertyChanged(nameof(SubmitText));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool AreInputsEnabled => !IsBusy;
    public string SubmitText => IsBusy ? "Отправка…" : "Зарегистрировать";

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

    public ICommand SubmitCommand { get; }
    public ICommand CloseCommand { get; }

    /// <summary>Старт диалога: расходники (по типу), история, совместимость.</summary>
    internal void Start()
    {
        _loadCancellation?.Cancel();
        _loadCancellation = new CancellationTokenSource();
        var token = _loadCancellation.Token;
        if (ShowConsumables)
        {
            _ = LoadConsumablesSafelyAsync(token);
        }

        _ = LoadHistorySafelyAsync(token);
        if (Kind == MaintenanceWorkKind.Cartridge)
        {
            _ = LoadCompatibilitySafelyAsync(token);
        }
    }

    /// <summary>Закрытие со стороны родителя: отмена in-flight загрузок диалога.</summary>
    internal void Close()
    {
        _closed = true;
        _loadCancellation?.Cancel();
    }

    /// <summary>
    /// Расходники склада: только положительный остаток, fallback — весь справочник
    /// (двухшаговая загрузка useDatabaseMaintenanceData веба), дедуп по item_id.
    /// </summary>
    private async Task LoadConsumablesSafelyAsync(CancellationToken cancellationToken)
    {
        IsConsumablesLoading = true;
        ConsumablesErrorText = null;
        try
        {
            var items = await _api.GetConsumablesLookupAsync(
                onlyPositiveQty: true, ConsumableLookupLimit, cancellationToken);
            if (items.Count == 0)
            {
                items = await _api.GetConsumablesLookupAsync(
                    onlyPositiveQty: false, ConsumableLookupLimit, cancellationToken);
            }

            var options = items
                .Where(item => item.Id > 0)
                .GroupBy(item => item.Id)
                .Select(group => group.First())
                .Where(MatchesConsumableFilter)
                .Select(item => new MaintenanceConsumableOption(item))
                .ToList();
            if (_closed || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            ConsumableOptions.Clear();
            foreach (var option in options)
            {
                ConsumableOptions.Add(option);
            }

            // Пересвязка выбранного по id — как existsInCurrentList в веб-хуке.
            if (_selectedConsumable is { } previous)
            {
                SelectedConsumable = options.FirstOrDefault(option => option.Id == previous.Id);
            }

            OnPropertyChanged(nameof(ShowConsumablesEmpty));
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            ConsumablesErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            if (!cancellationToken.IsCancellationRequested)
            {
                IsConsumablesLoading = false;
            }
        }
    }

    /// <summary>Фильтр расходников по типу операции — filterActionWorkConsumableOptions.</summary>
    private bool MatchesConsumableFilter(HubConsumableLookupItem item)
        => Kind switch
        {
            MaintenanceWorkKind.Cartridge => EquipmentMaintenance.IsCartridgeLikeConsumable(item),
            MaintenanceWorkKind.Component when ComponentKind == "printer" =>
                !EquipmentMaintenance.IsCartridgeLikeConsumable(item),
            _ => true,
        };

    /// <summary>
    /// История операции внутри диалога: для картриджа — фильтр по модели
    /// расходника, для компонента — по типу+имени (как useEffect-хуки веба).
    /// </summary>
    private async Task LoadHistorySafelyAsync(CancellationToken cancellationToken = default)
    {
        var requestId = ++_historyRequest;
        IsHistoryLoading = true;
        HistoryErrorText = null;
        try
        {
            var serial = MaintenanceConsumableOption.NullIfEmpty(_item.SerialNo);
            var hwSerial = MaintenanceConsumableOption.NullIfEmpty(_item.HwSerialNo);
            var task = Kind switch
            {
                MaintenanceWorkKind.Cartridge => _api.GetCartridgeWorkHistoryAsync(
                    serial, hwSerial, _invNo.Length > 0 ? _invNo : null,
                    _selectedConsumable?.ModelName, cancellationToken),
                MaintenanceWorkKind.Battery => _api.GetBatteryWorkHistoryAsync(
                    serial, hwSerial, cancellationToken),
                MaintenanceWorkKind.Component => _api.GetComponentWorkHistoryAsync(
                    serial, hwSerial, _selectedComponentType?.Value,
                    EquipmentMaintenance.GetComponentLabel(ComponentKind, _selectedComponentType?.Value),
                    cancellationToken),
                _ => _api.GetCleaningWorkHistoryAsync(
                    serial, hwSerial, _invNo.Length > 0 ? _invNo : null,
                    _item.Id, cancellationToken),
            };
            var history = await task;
            if (_closed || requestId != _historyRequest || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            HistoryLoaded = true;
            if (history.Count > 0)
            {
                var last = MaintenanceConsumableOption.NullIfEmpty(history.TimeAgoStr)
                    ?? MaintenanceConsumableOption.NullIfEmpty(history.LastDate)
                    ?? string.Empty;
                HistoryText = $"{HistoryCountLabel}: {history.Count}"
                    + (last.Length > 0 ? " · последняя: " + last : string.Empty);
            }
            else
            {
                HistoryText = string.Empty;
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            if (requestId == _historyRequest)
            {
                HistoryLoaded = true;
                HistoryErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (requestId == _historyRequest)
            {
                IsHistoryLoading = false;
            }
        }
    }

    /// <summary>
    /// Таблица совместимости принтера — опциональный сигнал: 404/ошибка тихо
    /// оставляет блок пустым (в вебе подсказка тоже не блокирует диалог).
    /// </summary>
    private async Task LoadCompatibilitySafelyAsync(CancellationToken cancellationToken)
    {
        var printerModel = MaintenanceConsumableOption.NullIfEmpty(_item.ModelName);
        if (printerModel is null)
        {
            return;
        }

        try
        {
            var compatibility = await _api.GetCartridgeCompatibilityAsync(printerModel, cancellationToken);
            if (_closed || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            var models = (compatibility.CompatibleModels ?? [])
                .Select(entry => MaintenanceConsumableOption.NullIfEmpty(entry.Model))
                .Where(model => model is not null)
                .ToList();
            var parts = new List<string>();
            if (MaintenanceConsumableOption.NullIfEmpty(compatibility.OemCartridge) is { } oem)
            {
                parts.Add($"OEM: {oem}");
            }

            parts.AddRange(models!);
            CompatibilityText = parts.Count > 0
                ? "Совместимые картриджи: " + string.Join(", ", parts)
                : string.Empty;
        }
        catch (Exception)
        {
            // Нет таблицы или запрос упал — диалог работает и без подсказки.
        }
    }

    /// <summary>
    /// Отправка: валидация обязательных полей как getRequiredActionItemFields
    /// веба; картридж/компонент — consume с вложенной работой, батарея/чистка —
    /// прямые записи журнала. После успеха — Completed + закрытие.
    /// </summary>
    private async Task SubmitAsync(CancellationToken cancellationToken)
    {
        ErrorText = null;
        var serial = MaintenanceConsumableOption.NullIfEmpty(_item.SerialNo);
        var branch = MaintenanceConsumableOption.NullIfEmpty(_item.BranchName);
        var location = MaintenanceConsumableOption.NullIfEmpty(_item.Location)
            ?? MaintenanceConsumableOption.NullIfEmpty(_item.LocationName);
        var employee = MaintenanceConsumableOption.NullIfEmpty(_item.EmployeeName) ?? "Не указан";
        var hwSerial = MaintenanceConsumableOption.NullIfEmpty(_item.HwSerialNo);
        var invNo = _invNo.Length > 0 ? _invNo : null;

        if (serial is null)
        {
            ErrorText = $"Для оборудования {_invNo} не указан серийный номер";
            return;
        }

        if (branch is null)
        {
            ErrorText = $"Для оборудования {_invNo} не указан филиал";
            return;
        }

        if (location is null)
        {
            ErrorText = $"Для оборудования {_invNo} не указана локация";
            return;
        }

        IsBusy = true;
        try
        {
            switch (Kind)
            {
                case MaintenanceWorkKind.Cartridge:
                {
                    if (_selectedConsumable is not { } consumable)
                    {
                        ErrorText = "Выберите картридж из таблицы расходников.";
                        return;
                    }

                    var workPayload = CommonWorkPayload(serial, employee, branch, location, hwSerial, invNo);
                    workPayload["printer_model"] = _item.ModelName ?? "Unknown";
                    workPayload["cartridge_color"] = EquipmentMaintenance.DefaultCartridgeColor;
                    workPayload["component_type"] = "cartridge";
                    workPayload["component_color"] = EquipmentMaintenance.DefaultCartridgeColor;
                    workPayload["cartridge_model"] = consumable.ModelName;
                    workPayload["detection_source"] = "sql-consumables";
                    workPayload["additional_data"] = ConsumableAdditionalData(consumable);
                    await _api.ConsumeConsumableAsync(
                        new HubConsumableConsumeRequest
                        {
                            ItemId = consumable.Id,
                            Qty = 1,
                            Reason = "cartridge",
                            OperationId = EquipmentMaintenance.BuildOperationId(
                                _operationSeed, "cartridge", invNo, consumable.Id),
                            Work = new HubConsumableWorkPayload
                            {
                                Kind = "cartridge",
                                Payload = workPayload,
                            },
                        },
                        cancellationToken);
                    break;
                }

                case MaintenanceWorkKind.Component:
                {
                    if (_selectedComponentType?.Value is not { } componentType)
                    {
                        ErrorText = "Выберите тип компонента из доступного списка.";
                        return;
                    }

                    if (_selectedConsumable is not { } consumable)
                    {
                        ErrorText = "Выберите запчасть из таблицы расходников.";
                        return;
                    }

                    var componentModel = consumable.ModelName;
                    if (componentModel is null)
                    {
                        ErrorText = "Не удалось определить модель компонента из выбранного расходника";
                        return;
                    }

                    var workPayload = CommonWorkPayload(serial, employee, branch, location, hwSerial, invNo);
                    workPayload["component_type"] = componentType;
                    workPayload["component_name"] =
                        EquipmentMaintenance.GetComponentLabel(ComponentKind, componentType);
                    workPayload["component_model"] = componentModel;
                    workPayload["equipment_kind"] = ComponentKind;
                    workPayload["detection_source"] = "sql-consumables";
                    workPayload["additional_data"] = ConsumableAdditionalData(consumable);
                    await _api.ConsumeConsumableAsync(
                        new HubConsumableConsumeRequest
                        {
                            ItemId = consumable.Id,
                            Qty = 1,
                            Reason = "component",
                            OperationId = EquipmentMaintenance.BuildOperationId(
                                _operationSeed, "component", invNo, consumable.Id, componentType),
                            Work = new HubConsumableWorkPayload
                            {
                                Kind = "component",
                                Payload = workPayload,
                            },
                        },
                        cancellationToken);
                    break;
                }

                case MaintenanceWorkKind.Battery:
                    await _api.RegisterBatteryWorkAsync(
                        new HubBatteryWorkRequest
                        {
                            SerialNumber = serial,
                            Branch = branch,
                            Location = location,
                            InvNo = invNo,
                            EquipmentId = _item.Id,
                            CurrentDescription = _item.Description,
                            HwSerialNo = hwSerial,
                            ModelName = _item.ModelName,
                            Manufacturer = _item.VendorName,
                            Employee = employee,
                        },
                        cancellationToken);
                    break;

                default:
                    await _api.RegisterCleaningWorkAsync(
                        new HubCleaningWorkRequest
                        {
                            SerialNumber = serial,
                            Employee = employee,
                            Branch = branch,
                            Location = location,
                            InvNo = invNo,
                            EquipmentId = _item.Id,
                            CurrentDescription = _item.Description,
                            HwSerialNo = hwSerial,
                            ModelName = _item.ModelName,
                            Manufacturer = _item.VendorName,
                        },
                        cancellationToken);
                    break;
            }
        }
        catch (OperationCanceledException)
        {
            return;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return;
        }
        finally
        {
            IsBusy = false;
        }

        Completed?.Invoke(this, EventArgs.Empty);
        RequestClose();
    }

    /// <summary>getCommonHistoryPayload веба: общие поля записи журнала.</summary>
    private Dictionary<string, object?> CommonWorkPayload(
        string serial, string employee, string branch, string location, string? hwSerial, string? invNo)
        => new()
        {
            ["serial_number"] = serial,
            ["employee"] = employee,
            ["branch"] = branch,
            ["location"] = location,
            ["inv_no"] = invNo,
            ["equipment_id"] = _item.Id,
            ["current_description"] = _item.Description,
            ["hw_serial_no"] = hwSerial,
            ["model_name"] = _item.ModelName,
            ["manufacturer"] = _item.VendorName,
        };

    /// <summary>additional_data записи: ссылка на списанный расходник (как веб).</summary>
    private static Dictionary<string, object?> ConsumableAdditionalData(
        MaintenanceConsumableOption consumable)
        => new()
        {
            ["consumable_item_id"] = consumable.Id,
            ["consumable_inv_no"] = consumable.Item.InvNo ?? string.Empty,
            ["consumable_model"] = consumable.Item.ModelName ?? string.Empty,
            ["consumable_branch"] = consumable.Item.BranchName ?? string.Empty,
            ["consumable_location"] = consumable.Item.LocationName ?? string.Empty,
        };

    /// <summary>✕/Отмена/Esc: запрос на сервере завершится сам — как у передачи.</summary>
    private void RequestClose() => Closed?.Invoke(this, EventArgs.Empty);
}

/// <summary>
/// Capability-логика карточки оборудования — порт equipmentModel.js веба:
/// флаги по ключевым словам типа/модели/вендора, токены картриджей,
/// опции типов компонентов и сборка durable operation_id.
/// </summary>
internal static class EquipmentMaintenance
{
    public const string DefaultCartridgeColor = "Универсальный";

    private static readonly string[] PrinterMfuKeywords =
    [
        "принтер", "мфу", "плоттер", "плотер", "printer", "plotter", "mfp", "mfc",
        "large format", "wide format", "laserjet", "officejet", "deskjet",
        "workcentre", "versalink", "i-sensys", "designjet", "imageprograf",
        "surecolor", "plotwave",
    ];

    private static readonly string[] UpsKeywords =
    [
        "ибп", "ups", "uninterruptible", "power supply",
    ];

    private static readonly string[] PcKeywords =
    [
        "системный блок", "системный", "пк", "pc", "system unit",
    ];

    private static readonly string[] CartridgeTokens =
    [
        "картридж", "катридж", "тонер", "cartridge", "toner",
    ];

    public static readonly IReadOnlyList<MaintenanceOptionItem> PrinterComponentOptions =
    [
        new("fuser", "Фьюзер"),
        new("photoconductor", "Фотобарабан"),
        new("waste_toner", "Отработанный тонер"),
        new("transfer_belt", "Трансферный ролик"),
    ];

    public static readonly IReadOnlyList<MaintenanceOptionItem> PcComponentOptions =
    [
        new("ram", "Оперативная память"),
        new("ssd", "SSD накопитель"),
        new("hdd", "HDD накопитель"),
        new("gpu", "Видеокарта"),
        new("cpu", "Процессор"),
        new("motherboard", "Материнская плата"),
        new("psu", "Блок питания"),
        new("cooler", "Кулер"),
        new("fan", "Вентилятор"),
    ];

    /// <summary>getItemCapabilityFlags веба: тип+модель+вендор в один haystack.</summary>
    public static (bool IsPrinterOrMfu, bool IsUps, bool IsPc) GetFlags(HubEquipmentItem item)
    {
        var allFields = $"{item.TypeName} {item.ModelName} {item.VendorName}"
            .ToLowerInvariant();
        return (
            HasAnyKeyword(allFields, PrinterMfuKeywords),
            HasAnyKeyword(allFields, UpsKeywords),
            HasAnyKeyword(allFields, PcKeywords));
    }

    /// <summary>короткие «pc»/«пк» — только отдельным словом (hasShortEquipmentToken).</summary>
    private static bool HasAnyKeyword(string text, string[] keywords)
    {
        foreach (var keyword in keywords)
        {
            if (keyword is "pc" or "пк")
            {
                if (HasShortToken(text, keyword))
                {
                    return true;
                }

                continue;
            }

            if (text.Contains(keyword, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    /// <summary>(^|не буква/цифра)token($|не буква/цифра) — как в веб-регулярке.</summary>
    private static bool HasShortToken(string text, string token)
        => Regex.IsMatch(
            text,
            $@"(^|[^\p{{L}}\p{{N}}]){Regex.Escape(token)}($|[^\p{{L}}\p{{N}}])");

    /// <summary>isCartridgeLikeConsumable: type_name+model_name содержат токен.</summary>
    public static bool IsCartridgeLikeConsumable(HubConsumableLookupItem item)
    {
        var haystack = $"{item.TypeName} {item.ModelName}".ToLowerInvariant();
        return CartridgeTokens.Any(token => haystack.Contains(token, StringComparison.Ordinal));
    }

    /// <summary>Строка журнала картриджей относится к самому картриджу, а не к компоненту принтера.</summary>
    public static bool IsCartridgeRow(string? componentType)
        => string.IsNullOrWhiteSpace(componentType) || componentType.Trim() == "cartridge";

    /// <summary>getComponentOptionsByKind веба.</summary>
    public static IReadOnlyList<MaintenanceOptionItem> ComponentOptions(string componentKind)
        => componentKind == "pc" ? PcComponentOptions : PrinterComponentOptions;

    /// <summary>normalizePrinterComponentType + getComponentLabel веба.</summary>
    public static string GetComponentLabel(string componentKind, string? componentType)
    {
        var normalized = componentType?.Trim().ToLowerInvariant() ?? string.Empty;
        if (normalized == "drum")
        {
            normalized = "photoconductor";
        }

        var option = ComponentOptions(componentKind)
            .FirstOrDefault(entry => entry.Value == normalized);
        return option?.Label ?? (normalized.Length > 0 ? normalized : "Компонент");
    }

    /// <summary>
    /// Принадлежность записи журнала оборудованию — _record_matches_serial
    /// бэкенда: совпадение по serial/hw_serial (в полях serial_number/serial_no/
    /// hw_serial_no записи) или по inv_no.
    /// </summary>
    public static bool MatchesEquipment(
        string? serial,
        string? hwSerial,
        string? invNo,
        string? recordSerialNumber,
        string? recordSerialNo,
        string? recordHwSerialNo,
        string? recordInvNo)
    {
        var recordSerials = new HashSet<string>(StringComparer.Ordinal);
        foreach (var candidate in new[] { recordSerialNumber, recordSerialNo, recordHwSerialNo })
        {
            if (!string.IsNullOrWhiteSpace(candidate))
            {
                recordSerials.Add(candidate.Trim());
            }
        }

        if (serial is not null && recordSerials.Contains(serial))
        {
            return true;
        }

        if (hwSerial is not null && recordSerials.Contains(hwSerial))
        {
            return true;
        }

        var recordInv = MaintenanceConsumableOption.NullIfEmpty(recordInvNo);
        return invNo is not null
            && invNo.Length > 0
            && recordInv is not null
            && string.Equals(recordInv, invNo, StringComparison.Ordinal);
    }

    /// <summary>Дата записи журнала — timestamp ISO → «dd.MM.yyyy HH:mm».</summary>
    public static string FormatWorkDate(string? timestamp)
    {
        var text = timestamp?.Trim() ?? string.Empty;
        if (text.Length == 0)
        {
            return "—";
        }

        return DateTimeOffset.TryParse(
            text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : text;
    }

    /// <summary>Строковое поле из additional_data записи журнала.</summary>
    public static string? ReadAdditionalString(
        Dictionary<string, JsonElement>? additionalData, string key)
    {
        if (additionalData is not null
            && additionalData.TryGetValue(key, out var element)
            && element.ValueKind == JsonValueKind.String)
        {
            return MaintenanceConsumableOption.NullIfEmpty(element.GetString());
        }

        return null;
    }

    /// <summary>createMaintenanceOperationSeed веба: mnt + base36(ms) + 4 random base36.</summary>
    public static string NewOperationSeed()
    {
        var milliseconds = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var suffix = Random.Shared.Next(0, 36 * 36 * 36 * 36);
        return "mnt" + ToBase36(milliseconds) + ToBase36(suffix).PadLeft(4, '0');
    }

    /// <summary>buildMaintenanceOperationId веба: seed-kind-invNo-consumableId[-componentType], ≤64.</summary>
    public static string BuildOperationId(
        string seed, string kind, string? invNo, long consumableId, string componentType = "")
    {
        var parts = new[]
            {
                seed,
                kind,
                invNo?.Trim() ?? string.Empty,
                consumableId.ToString(CultureInfo.InvariantCulture),
                componentType.Trim(),
            }
            .Where(part => part.Length > 0);
        var operationId = string.Join('-', parts);
        return operationId.Length > 64 ? operationId[..64] : operationId;
    }

    private static string ToBase36(long value)
    {
        const string digits = "0123456789abcdefghijklmnopqrstuvwxyz";
        if (value == 0)
        {
            return "0";
        }

        var buffer = new char[16];
        var index = buffer.Length;
        while (value > 0)
        {
            buffer[--index] = digits[(int)(value % 36)];
            value /= 36;
        }

        return new string(buffer, index, buffer.Length - index);
    }
}
