using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Опция фильтра статуса или кнопка перехода (value=null — «все»).</summary>
public sealed class TicketStatusOption
{
    public TicketStatusOption(string? value, string label)
    {
        Value = value;
        Label = label;
    }

    public string? Value { get; }
    public string Label { get; }
}

/// <summary>Опция фильтра по объекту выезда (Id=null — «все объекты»).</summary>
public sealed class TicketObjectFilterItem
{
    public static readonly TicketObjectFilterItem All = new(null, "Все объекты");

    public TicketObjectFilterItem(long? id, string name)
    {
        Id = id;
        Name = name;
    }

    public long? Id { get; }
    public string Name { get; }
}

/// <summary>
/// Каталог статусов билетов: подписи — как TICKET_STATUS_OPTIONS в вебе (ticketUi.js),
/// переходы — зеркало STATUS_TRANSITIONS backend'а (tickets_service): detail-ответ
/// допустимые переходы не отдаёт, карта живёт на клиенте.
/// </summary>
internal static class TicketStatusCatalog
{
    private static readonly IReadOnlyDictionary<string, string> Labels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["not_started"] = "Не запущен",
            ["at_cashier"] = "В кассах",
            ["purchased"] = "Куплен",
            ["exchange_needed"] = "Нужна замена",
            ["cancel_purchase"] = "Отмена покупки",
            ["refund_needed"] = "Нужен возврат",
        };

    private static readonly IReadOnlyDictionary<string, string[]> Transitions =
        new Dictionary<string, string[]>(StringComparer.Ordinal)
        {
            ["not_started"] = ["at_cashier"],
            ["at_cashier"] = ["purchased", "cancel_purchase"],
            ["purchased"] = ["exchange_needed", "refund_needed"],
            ["exchange_needed"] = ["at_cashier", "refund_needed"],
            ["cancel_purchase"] = [],
            ["refund_needed"] = [],
        };

    public static IReadOnlyList<TicketStatusOption> FilterOptions { get; } =
    [
        new TicketStatusOption(null, "Все статусы"),
        new TicketStatusOption("not_started", "Не запущен"),
        new TicketStatusOption("at_cashier", "В кассах"),
        new TicketStatusOption("purchased", "Куплен"),
        new TicketStatusOption("exchange_needed", "Нужна замена"),
        new TicketStatusOption("cancel_purchase", "Отмена покупки"),
        new TicketStatusOption("refund_needed", "Нужен возврат"),
    ];

    public static string LabelOf(string? status) =>
        status is not null && Labels.TryGetValue(status, out var label)
            ? label
            : status ?? "Без статуса";

    /// <summary>Допустимые переходы из текущего статуса (пусто — терминальный).</summary>
    public static IReadOnlyList<TicketStatusOption> TransitionsOf(string? status)
    {
        if (status is null || !Transitions.TryGetValue(status, out var targets))
        {
            return [];
        }

        var options = new List<TicketStatusOption>(targets.Length);
        foreach (var target in targets)
        {
            options.Add(new TicketStatusOption(target, LabelOf(target)));
        }

        return options;
    }

    /// <summary>Тон статуса — как STATUS_COLORS в вебе (warning/success/info/error/default).</summary>
    public static string ToneOf(string? status) => status switch
    {
        "at_cashier" => HubStatusTone.Warning,
        "purchased" => HubStatusTone.Success,
        "exchange_needed" => HubStatusTone.Info,
        "cancel_purchase" => HubStatusTone.Danger,
        _ => HubStatusTone.Muted,
    };
}

/// <summary>Общие форматеры билетов: даты из isoformat, суммы из Decimal-строк.</summary>
internal static class TicketFormat
{
    internal static string FormatDate(string? value) =>
        TryParse(value, out var parsed)
            ? parsed.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture)
            : string.Empty;

    internal static string FormatDateTime(string? value) =>
        TryParse(value, out var parsed)
            ? parsed.ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : string.Empty;

    /// <summary>Прибытие/город в одну строку — как formatArrivalRoute в вебе.</summary>
    internal static string FormatArrivalRoute(string? arrivalDate, string? route)
    {
        var arrival = FormatDate(arrivalDate);
        var city = (route ?? string.Empty).Trim();
        if (arrival.Length > 0 && city.Length > 0)
        {
            return $"{arrival} / {city}";
        }

        return arrival.Length > 0 ? arrival : city;
    }

    internal static string FormatMoney(string? value)
    {
        if (decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed))
        {
            return parsed.ToString("N2", CultureInfo.CurrentCulture) + " ₽";
        }

        return (value ?? string.Empty).Trim();
    }

    private static bool TryParse(string? value, out DateTime parsed)
    {
        if (DateTimeOffset.TryParse(
                value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var offset))
        {
            parsed = offset.LocalDateTime;
            return true;
        }

        // date-only isoformat ("2026-11-18") тоже принимаем.
        return DateTime.TryParse(
            value, CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed);
    }
}

/// <summary>Строка списка заявок: ФИО, статус-плашка, маршрут, отметка «Срочно».</summary>
public sealed class TicketRequestListItemViewModel : ObservableObject
{
    private string? _statusText;
    private string _statusTone = TicketStatusCatalog.ToneOf(null);

    public TicketRequestListItemViewModel(HubTicketRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Id = request.Id;
        Title = string.IsNullOrWhiteSpace(request.EmployeeName)
            ? $"Заявка №{request.Id}"
            : request.EmployeeName!;
        RequestNumberText = $"Заявка №{request.Id} · {TicketFormat.FormatDate(request.SubmittedAt)}";
        RouteText = TicketFormat.FormatArrivalRoute(request.ArrivalDate, request.Route);
        MetaText = string.Join(
            " · ",
            new[] { request.Department, request.ObjectCode }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        if (MetaText.Length == 0)
        {
            MetaText = "Объект не указан";
        }

        IsUrgent = request.IsUrgent;
        UpdateStatus(request.Status);
    }

    public long Id { get; }
    public string Title { get; }
    public string RequestNumberText { get; }
    public string RouteText { get; }
    public string MetaText { get; }
    public bool IsUrgent { get; }

    public string? StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    public string StatusTone
    {
        get => _statusTone;
        private set => SetProperty(ref _statusTone, value);
    }

    /// <summary>Обновить статус строки после успешного PATCH …/status без перечитывания списка.</summary>
    public void UpdateStatus(string? status)
    {
        StatusText = TicketStatusCatalog.LabelOf(status);
        StatusTone = TicketStatusCatalog.ToneOf(status);
    }
}

/// <summary>Комментарий заявки в ленте: текст, время, отметка «системный».</summary>
public sealed class TicketCommentViewModel
{
    public TicketCommentViewModel(HubTicketComment comment)
    {
        ArgumentNullException.ThrowIfNull(comment);
        Id = comment.Id;
        Text = comment.Text ?? string.Empty;
        IsSystem = comment.CommentType == "system";
        CreatedText = TicketFormat.FormatDateTime(comment.CreatedAt);
        MetaText = IsSystem ? $"Система · {CreatedText}".TrimEnd(' ', '·') : CreatedText;
    }

    public long Id { get; }
    public string Text { get; }
    public string CreatedText { get; }
    public string MetaText { get; }

    /// <summary>Системная запись (смена статуса) — приглушённый стиль в ленте.</summary>
    public bool IsSystem { get; }
}

/// <summary>
/// Запись ленты истории изменений: «Поле: старое → новое», локальное время и
/// необязательный комментарий (например, к смене статуса или удалению вложения).
/// </summary>
public sealed class TicketHistoryEntryViewModel
{
    /// <summary>
    /// Подписи field_name — как Info-лейблы карточки в вебе (TicketRequestCard)
    /// и реквизиты этой же детали; неизвестные имена показываем как пришли.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> FieldLabels =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["status"] = "Статус",
            ["assignee_id"] = "Исполнитель",
            ["departure_date"] = "Дата выезда",
            ["arrival_date"] = "Дата прибытия",
            ["submitted_at"] = "Дата подачи",
            ["route"] = "Маршрут",
            ["note"] = "Примечание",
            ["total_cost"] = "Стоимость",
            ["refund_loss"] = "Возврат",
            ["attachment_deleted"] = "Вложение",
        };

    public TicketHistoryEntryViewModel(HubTicketHistoryEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);
        Id = entry.Id;
        FieldText = LabelOf(entry.FieldName);
        ChangeText = $"{FieldText}: {ValueText(entry.FieldName, entry.OldValue)} → {ValueText(entry.FieldName, entry.NewValue)}";
        CommentText = (entry.Comment ?? string.Empty).Trim();
        MetaText = TicketFormat.FormatDateTime(entry.CreatedAt);
    }

    public long Id { get; }

    /// <summary>Имя изменённого поля по-русски.</summary>
    public string FieldText { get; }

    /// <summary>«Поле: старое → новое» одной строкой; пустое значение — «—».</summary>
    public string ChangeText { get; }

    /// <summary>Комментарий записи (к смене статуса, удалению файла); пустой — скрыт.</summary>
    public string CommentText { get; }

    /// <summary>Дата/время изменения в локальной зоне.</summary>
    public string MetaText { get; }

    private static string LabelOf(string? fieldName) =>
        fieldName is not null && FieldLabels.TryGetValue(fieldName, out var label)
            ? label
            : (fieldName ?? string.Empty).Trim();

    private static string ValueText(string? fieldName, string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "—";
        }

        return fieldName switch
        {
            // В записи статусы хранятся кодами — подписи, как в пилюле статуса.
            "status" => TicketStatusCatalog.LabelOf(trimmed),
            "total_cost" or "refund_loss" => TicketFormat.FormatMoney(trimmed),
            "departure_date" or "arrival_date" or "submitted_at" => DateOrRaw(trimmed),
            _ => trimmed,
        };
    }

    private static string DateOrRaw(string value)
    {
        var formatted = TicketFormat.FormatDate(value);
        return formatted.Length > 0 ? formatted : value;
    }
}

/// <summary>Чип вложения заявки: имя, размер, состояние «скачиваем».</summary>
public sealed class TicketAttachmentViewModel : ObservableObject
{
    private bool _isDownloading;

    public TicketAttachmentViewModel(HubTicketAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        Model = attachment;
        AttachmentId = attachment.Id ?? string.Empty;
        Name = string.IsNullOrWhiteSpace(attachment.FileName) ? "Файл" : attachment.FileName!;
        SizeText = FormatSize(attachment.FileSize);
    }

    public HubTicketAttachment Model { get; }
    public string AttachmentId { get; }
    public string Name { get; }
    public string SizeText { get; }

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(DisplayText));
                OnPropertyChanged(nameof(IsDownloadEnabled));
            }
        }
    }

    /// <summary>Чип доступен, пока файл не скачивается (дедуп — и в OpenAttachmentAsync).</summary>
    public bool IsDownloadEnabled => !IsDownloading;

    public string DisplayText => IsDownloading
        ? "Скачиваем…"
        : SizeText.Length == 0 ? Name : $"{Name} ({SizeText})";

    internal static string FormatSize(long size) => size switch
    {
        <= 0 => string.Empty,
        < 1024 => $"{size} Б",
        < 1024 * 1024 => $"{size / 1024.0:0.#} КБ",
        _ => $"{size / (1024.0 * 1024.0):0.#} МБ",
    };
}

/// <summary>Объект выезда в форме создания: «Название (код)» — как objectOptionLabel в вебе.</summary>
public sealed class TicketCreateObjectOption
{
    public TicketCreateObjectOption(HubTicketObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id;
        var name = (item.Name ?? string.Empty).Trim();
        var code = (item.Code ?? string.Empty).Trim();
        DisplayName = (name.Length > 0, code.Length > 0) switch
        {
            (true, true) => $"{name} ({code})",
            (true, false) => name,
            (false, true) => code,
            _ => $"Объект {item.Id}",
        };
    }

    public long Id { get; }
    public string DisplayName { get; }
}

/// <summary>
/// Вариант сотрудника в поиске формы создания: local — из справочника билетов
/// (id готов к POST /tickets/requests), zup — из ЗУП (импортируется через
/// POST /tickets/employees/from-zup по employee_code). Дедупликация — как
/// employeeOptions в веб-диалоге: ЗУП-вариант прячем, если код или ФИО
/// уже есть в локальном справочнике.
/// </summary>
public sealed class TicketEmployeeOptionViewModel
{
    private TicketEmployeeOptionViewModel(
        bool isZup, long? employeeId, string? zupCode, string title, string metaText)
    {
        IsZup = isZup;
        EmployeeId = employeeId;
        ZupCode = zupCode;
        Title = title;
        MetaText = metaText;
    }

    public bool IsZup { get; }

    /// <summary>id сотрудника справочника билетов (local-вариант).</summary>
    public long? EmployeeId { get; }

    /// <summary>Код ЗУП для импорта через from-zup (zup-вариант).</summary>
    public string? ZupCode { get; }

    /// <summary>ФИО.</summary>
    public string Title { get; }

    /// <summary>Вторая строка: «ЗУП · должность · отдел» или «В билетах · …».</summary>
    public string MetaText { get; }

    public static TicketEmployeeOptionViewModel Local(HubTicketEmployee employee)
    {
        ArgumentNullException.ThrowIfNull(employee);
        return new TicketEmployeeOptionViewModel(
            isZup: false,
            employeeId: employee.Id,
            zupCode: null,
            title: (employee.FullName ?? string.Empty).Trim(),
            metaText: MetaOf("В билетах", employee.Position, employee.Department));
    }

    public static TicketEmployeeOptionViewModel Zup(HubTicketZupPerson person)
    {
        ArgumentNullException.ThrowIfNull(person);
        return new TicketEmployeeOptionViewModel(
            isZup: true,
            employeeId: null,
            zupCode: (person.EmployeeCode ?? string.Empty).Trim(),
            title: (person.FullName ?? string.Empty).Trim(),
            metaText: MetaOf("ЗУП", person.Position, person.Department));
    }

    private static string MetaOf(string source, string? position, string? department) =>
        string.Join(" · ", new[] { source, position, department }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
}

/// <summary>Файл-чип формы создания: грузится на сервер после создания заявки.</summary>
public sealed class TicketCreateFileViewModel
{
    public TicketCreateFileViewModel(string path)
    {
        Path = path;
        Name = string.IsNullOrWhiteSpace(System.IO.Path.GetFileName(path))
            ? "Файл"
            : System.IO.Path.GetFileName(path);
        Size = File.Exists(path) ? new FileInfo(path).Length : -1;
        SizeText = TicketAttachmentViewModel.FormatSize(Size);
    }

    /// <summary>Полный путь к локальному файлу.</summary>
    public string Path { get; }
    public string Name { get; }

    /// <summary>Размер в байтах; -1 — файл недоступен (ошибка при добавлении).</summary>
    public long Size { get; }
    public string SizeText { get; }
    public string DisplayText => SizeText.Length == 0 ? Name : $"{Name} ({SizeText})";
}

/// <summary>Результат успешного создания: заявка + файлы, которые не удалось загрузить.</summary>
public sealed class TicketCreatedEventArgs : EventArgs
{
    public TicketCreatedEventArgs(HubTicketRequest request, IReadOnlyList<string> failedUploads)
    {
        Request = request;
        FailedUploads = failedUploads;
    }

    public HubTicketRequest Request { get; }
    public IReadOnlyList<string> FailedUploads { get; }
}

/// <summary>
/// Панель «Новая заявка» (оверлей поверх карточки, как композер у почты):
/// сотрудник — поиск по справочнику билетов и ЗУП (≥2 символов, debounce),
/// объект — из справочника, даты выезда/возвращения, маршрут, «Срочно»,
/// комментарий и файлы (грузятся POST …/attachments после создания —
/// контракт требует id заявки). Обязательные — сотрудник и объект, как в вебе.
/// </summary>
public sealed class TicketCreateViewModel : ObservableObject
{
    /// <summary>Debounce серверного поиска сотрудника — как ContactSearchDebounce у почты.</summary>
    private static readonly TimeSpan EmployeeSearchDebounce = TimeSpan.FromMilliseconds(350);

    private const int EmployeeSearchMinLength = 2;
    private const int EmployeeSearchLimit = 20;

    /// <summary>Лимиты вложений backend'а: расширения, 20 МБ и 10 файлов на заявку.</summary>
    private static readonly HashSet<string> AllowedFileExtensions =
        new(StringComparer.OrdinalIgnoreCase)
        {
            ".pdf", ".jpg", ".jpeg", ".png", ".doc", ".docx", ".xls", ".xlsx",
        };

    private const long MaxFileSizeBytes = 20L * 1024 * 1024;
    private const int MaxFiles = 10;

    private readonly IHubApiClient _api;
    private readonly Func<IReadOnlyList<string>>? _filePicker;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private CancellationTokenSource? _employeeSearchCancellation;

    private string _employeeQuery = string.Empty;
    private TicketEmployeeOptionViewModel? _selectedEmployee;
    private bool _isEmployeePopupOpen;
    private bool _isEmployeeSearchBusy;
    private TicketCreateObjectOption? _selectedObject;
    private string _routeText = string.Empty;
    private DateTime? _departureDate;
    private DateTime? _arrivalDate;
    private bool _isUrgent;
    private string _noteText = string.Empty;
    private bool _isBusy;
    private string? _errorText;

    public TicketCreateViewModel(
        IHubApiClient api,
        IEnumerable<HubTicketObject> objects,
        Func<IReadOnlyList<string>>? filePicker,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _filePicker = filePicker;
        _delayAsync = delayAsync ?? Task.Delay;

        ArgumentNullException.ThrowIfNull(objects);
        foreach (var item in objects)
        {
            // Как в веб-диалоге (is_active !== false): скрываем только явно неактивные.
            if (item.IsActive != false)
            {
                Objects.Add(new TicketCreateObjectOption(item));
            }
        }

        CreateCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        AttachCommand = new NativeRelayCommand(
            () => AddFiles(_filePicker?.Invoke() ?? []),
            () => !IsBusy);
        RemoveFileCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TicketCreateFileViewModel file)
            {
                Files.Remove(file);
            }
        });
        SelectEmployeeCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TicketEmployeeOptionViewModel option)
            {
                ApplyEmployee(option);
            }
        });
        ClearEmployeeCommand = new NativeRelayCommand(
            () => SelectedEmployee = null,
            () => !IsBusy);
        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
        Files.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasFiles));
        EmployeeOptions.CollectionChanged += (_, _) =>
            OnPropertyChanged(nameof(HasEmployeeOptions));
    }

    /// <summary>Заявка создана (и файлы догружены): родитель вставляет строку в список.</summary>
    public event EventHandler<TicketCreatedEventArgs>? Created;

    /// <summary>Закрытие панели без создания (Отмена/✕) — решает родитель.</summary>
    public event EventHandler? Closed;

    // ---- Сотрудник: поиск и выбор ----

    /// <summary>Строка поиска сотрудника: серверный поиск билеты+ЗУП от 2 символов.</summary>
    public string EmployeeQuery
    {
        get => _employeeQuery;
        set
        {
            if (SetProperty(ref _employeeQuery, value ?? string.Empty))
            {
                // Правка строки после выбора — намерение искать заново, выбор сбрасываем.
                SelectedEmployee = null;
                ScheduleEmployeeSearch();
            }
        }
    }

    public ObservableCollection<TicketEmployeeOptionViewModel> EmployeeOptions { get; } = [];

    public bool HasEmployeeOptions => EmployeeOptions.Count > 0;

    /// <summary>Выбранный сотрудник (local готов, zup импортируется при отправке).</summary>
    public TicketEmployeeOptionViewModel? SelectedEmployee
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

    /// <summary>Popup подсказок открыт; самозакрытие (StaysOpen=False) чистит список.</summary>
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

    // ---- Остальные поля ----

    /// <summary>Активные объекты справочника («Название (код)»).</summary>
    public ObservableCollection<TicketCreateObjectOption> Objects { get; } = [];

    public TicketCreateObjectOption? SelectedObject
    {
        get => _selectedObject;
        set => SetProperty(ref _selectedObject, value);
    }

    /// <summary>Маршрут / город вылета (route ≤ 500, пустое → null).</summary>
    public string RouteText
    {
        get => _routeText;
        set => SetProperty(ref _routeText, value ?? string.Empty);
    }

    public DateTime? DepartureDate
    {
        get => _departureDate;
        set => SetProperty(ref _departureDate, value);
    }

    public DateTime? ArrivalDate
    {
        get => _arrivalDate;
        set => SetProperty(ref _arrivalDate, value);
    }

    public bool IsUrgent
    {
        get => _isUrgent;
        set => SetProperty(ref _isUrgent, value);
    }

    public string NoteText
    {
        get => _noteText;
        set => SetProperty(ref _noteText, value ?? string.Empty);
    }

    /// <summary>Файлы к заявке: загружаются POST …/attachments после создания.</summary>
    public ObservableCollection<TicketCreateFileViewModel> Files { get; } = [];

    public bool HasFiles => Files.Count > 0;

    // ---- Состояние ----

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(CreateButtonText));
                ((NativeAsyncCommand)CreateCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)AttachCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearEmployeeCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string CreateButtonText => IsBusy ? "Создаём…" : "Создать";

    /// <summary>Ошибка отправки/валидации — плашка внутри формы, поля не стираются.</summary>
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

    public ICommand CreateCommand { get; }
    public ICommand AttachCommand { get; }
    public ICommand RemoveFileCommand { get; }
    public ICommand SelectEmployeeCommand { get; }
    public ICommand ClearEmployeeCommand { get; }
    public ICommand CloseCommand { get; }

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

    /// <summary>Как в веб-диалоге: справочник билетов + ЗУП-поиск одним запросом.</summary>
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
            var localTask = _api.GetTicketEmployeesAsync(query, EmployeeSearchLimit, cancellationToken);
            var zupTask = _api.SearchTicketZupEmployeesAsync(query, EmployeeSearchLimit, cancellationToken);
            var local = await localTask;
            var zup = await zupTask;
            if (!string.Equals(_employeeQuery.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            ApplyEmployeeOptions(local.Items ?? [], zup.Items ?? []);
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
            IsEmployeeSearchBusy = false;
        }
    }

    private void ApplyEmployeeOptions(
        IReadOnlyList<HubTicketEmployee> local,
        IReadOnlyList<HubTicketZupPerson> zup)
    {
        var localCodes = new HashSet<string>(
            local
                .Select(item => (item.ZupEmployeeCode ?? string.Empty).Trim())
                .Where(code => code.Length > 0),
            StringComparer.OrdinalIgnoreCase);
        var localNames = new HashSet<string>(
            local
                .Select(item => (item.FullName ?? string.Empty).Trim())
                .Where(name => name.Length > 0),
            StringComparer.OrdinalIgnoreCase);

        EmployeeOptions.Clear();
        foreach (var item in local)
        {
            EmployeeOptions.Add(TicketEmployeeOptionViewModel.Local(item));
        }

        foreach (var person in zup)
        {
            var code = (person.EmployeeCode ?? string.Empty).Trim();
            var name = (person.FullName ?? string.Empty).Trim();
            if (name.Length == 0
                || (code.Length > 0 && localCodes.Contains(code))
                || localNames.Contains(name))
            {
                continue;
            }

            EmployeeOptions.Add(TicketEmployeeOptionViewModel.Zup(person));
        }

        IsEmployeePopupOpen = EmployeeOptions.Count > 0;
    }

    /// <summary>Выбор подсказки: local готов к отправке, zup без кода — ошибка, как в вебе.</summary>
    private void ApplyEmployee(TicketEmployeeOptionViewModel option)
    {
        IsEmployeePopupOpen = false;
        if (option.IsZup && string.IsNullOrEmpty(option.ZupCode))
        {
            ErrorText = "У выбранного сотрудника ЗУП нет кода.";
            return;
        }

        SelectedEmployee = option;
    }

    // ---- Файлы ----

    /// <summary>Добавить локальные файлы; дубли/чужие форматы/переразмер — подсказка без падения.</summary>
    internal void AddFiles(IReadOnlyList<string> paths)
    {
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path)
                || Files.Any(file => string.Equals(file.Path, path, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            if (Files.Count >= MaxFiles)
            {
                ErrorText = $"Не больше {MaxFiles} файлов на заявку.";
                break;
            }

            var extension = System.IO.Path.GetExtension(path);
            if (!AllowedFileExtensions.Contains(extension))
            {
                ErrorText = $"Формат «{extension}» не поддерживается: pdf, jpg, jpeg, png, doc, docx, xls, xlsx.";
                continue;
            }

            var file = new TicketCreateFileViewModel(path);
            if (file.Size < 0)
            {
                ErrorText = $"Файл «{file.Name}» не найден или недоступен.";
                continue;
            }

            if (file.Size > MaxFileSizeBytes)
            {
                ErrorText = $"Файл «{file.Name}» больше 20 МБ.";
                continue;
            }

            Files.Add(file);
        }
    }

    // ---- Отправка ----

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        var employee = SelectedEmployee;
        var selectedObject = SelectedObject;
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        if (employee is null)
        {
            ErrorText = "Выберите сотрудника из списка или ЗУП.";
            return;
        }

        if (selectedObject is null)
        {
            ErrorText = "Выберите объект.";
            return;
        }

        IsBusy = true;
        try
        {
            var employeeId = employee.EmployeeId
                ?? (await _api.EnsureTicketEmployeeFromZupAsync(
                    employee.ZupCode!, cancellationToken)).Id;
            var created = await _api.CreateTicketRequestAsync(
                new HubCreateTicketRequest
                {
                    EmployeeId = employeeId,
                    ObjectId = selectedObject.Id,
                    SubmittedAt = DateTimeOffset.UtcNow.ToString(
                        "yyyy-MM-dd", CultureInfo.InvariantCulture),
                    DepartureDate = FormatDateValue(DepartureDate),
                    ArrivalDate = FormatDateValue(ArrivalDate),
                    Route = TrimOrNull(RouteText, 500),
                    Note = TrimOrNull(NoteText, null),
                    IsUrgent = IsUrgent,
                },
                cancellationToken);

            var failed = await UploadFilesAsync(created.Id, cancellationToken);
            Created?.Invoke(this, new TicketCreatedEventArgs(created, failed));
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>Файлы уходят после создания (контракт требует id заявки); сбои — списком.</summary>
    private async Task<IReadOnlyList<string>> UploadFilesAsync(
        long requestId,
        CancellationToken cancellationToken)
    {
        var failed = new List<string>();
        foreach (var file in Files)
        {
            try
            {
                await using var stream = new FileStream(
                    file.Path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
                await _api.UploadTicketAttachmentAsync(
                    requestId, file.Name, stream, "other", cancellationToken);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception exception)
            {
                failed.Add($"{file.Name} ({TasksViewModel.DescribeError(exception)})");
            }
        }

        return failed;
    }

    private static string? FormatDateValue(DateTime? value) =>
        value?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string? TrimOrNull(string? value, int? maxLength)
    {
        var trimmed = (value ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return null;
        }

        return maxLength is { } limit && trimmed.Length > limit ? trimmed[..limit] : trimmed;
    }
}

/// <summary>
/// Карточка заявки: реквизиты, допустимые переходы статуса (клиентская карта —
/// backend их в detail не отдаёт), вложения и лента комментариев с вводом.
/// </summary>
public sealed class TicketDetailViewModel : ObservableObject
{
    private bool _isCommentBusy;
    private bool _isStatusBusy;
    private bool _isHistoryBusy;
    private bool _historyFailed;
    private int _historyPage;
    private int _historyTotalPages;
    private string? _commentText;
    private string? _statusComment;

    public TicketDetailViewModel(HubTicketRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Comments = [];
        Attachments = [];
        StatusActions = [];
        HistoryEntries = [];
        Comments.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasComments));
        Attachments.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasAttachments));
        HistoryEntries.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasHistoryEntries));
            OnPropertyChanged(nameof(ShowHistoryEmpty));
            OnPropertyChanged(nameof(HasMoreHistory));
            OnPropertyChanged(nameof(CanLoadMoreHistory));
        };
        StatusActions.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasStatusActions));
            OnPropertyChanged(nameof(CanChangeStatus));
        };
        Update(request);
    }

    public long Id { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string? StatusText { get; private set; }
    public string StatusTone { get; private set; } = TicketStatusCatalog.ToneOf(null);
    public int Version { get; private set; }
    public string EmployeeText { get; private set; } = string.Empty;
    public string ObjectText { get; private set; } = string.Empty;
    public string RouteText { get; private set; } = string.Empty;
    public string SubmittedText { get; private set; } = string.Empty;
    public string DepartureText { get; private set; } = string.Empty;
    public string ArrivalText { get; private set; } = string.Empty;
    public string AssigneeText { get; private set; } = string.Empty;
    public string CostText { get; private set; } = string.Empty;
    public string RefundText { get; private set; } = string.Empty;
    public string NoteText { get; private set; } = string.Empty;
    public string CreatedText { get; private set; } = string.Empty;
    public string UpdatedText { get; private set; } = string.Empty;
    public bool IsUrgent { get; private set; }
    public bool NeedsReview { get; private set; }

    /// <summary>Доступные переходы статуса (кнопки под реквизитами).</summary>
    public ObservableCollection<TicketStatusOption> StatusActions { get; }
    public ObservableCollection<TicketCommentViewModel> Comments { get; }
    public ObservableCollection<TicketAttachmentViewModel> Attachments { get; }

    /// <summary>Лента истории изменений (новые первыми) — SetHistory/AppendHistory.</summary>
    public ObservableCollection<TicketHistoryEntryViewModel> HistoryEntries { get; }

    public bool HasStatusActions => StatusActions.Count > 0;
    public bool HasComments => Comments.Count > 0;
    public bool HasAttachments => Attachments.Count > 0;
    public bool HasHistoryEntries => HistoryEntries.Count > 0;

    /// <summary>Пустая история без сбоя — строка «Изменений пока нет.».</summary>
    public bool ShowHistoryEmpty => !HasHistoryEntries && !HistoryFailed;

    /// <summary>На сервере есть ещё страницы истории — показываем «Показать ещё».</summary>
    public bool HasMoreHistory => HistoryEntries.Count > 0 && _historyPage < _historyTotalPages;

    /// <summary>Кнопка догрузки активна только вне запроса.</summary>
    public bool CanLoadMoreHistory => HasMoreHistory && !IsHistoryBusy;

    /// <summary>Следующая страница истории для «Показать ещё».</summary>
    internal int NextHistoryPage => _historyPage + 1;

    public string HistoryMoreText => IsHistoryBusy ? "Загружаем…" : "Показать ещё";

    /// <summary>История грузится (первая страница при открытии или догрузка).</summary>
    public bool IsHistoryBusy
    {
        get => _isHistoryBusy;
        set
        {
            if (SetProperty(ref _isHistoryBusy, value))
            {
                OnPropertyChanged(nameof(CanLoadMoreHistory));
                OnPropertyChanged(nameof(HistoryMoreText));
            }
        }
    }

    /// <summary>Тихий сбой ленты истории: секция помечается, карточка остаётся живой.</summary>
    public bool HistoryFailed
    {
        get => _historyFailed;
        set
        {
            if (SetProperty(ref _historyFailed, value))
            {
                OnPropertyChanged(nameof(ShowHistoryEmpty));
            }
        }
    }

    public bool CanSendComment => !IsCommentBusy && !string.IsNullOrWhiteSpace(CommentText);
    public bool CanChangeStatus => HasStatusActions && !IsStatusBusy;

    /// <summary>Поле ввода нового комментария.</summary>
    public string? CommentText
    {
        get => _commentText;
        set
        {
            if (SetProperty(ref _commentText, value))
            {
                OnPropertyChanged(nameof(CanSendComment));
            }
        }
    }

    /// <summary>Необязательный комментарий к смене статуса (уходит в PATCH …/status).</summary>
    public string? StatusComment
    {
        get => _statusComment;
        set => SetProperty(ref _statusComment, value);
    }

    public bool IsCommentBusy
    {
        get => _isCommentBusy;
        set
        {
            if (SetProperty(ref _isCommentBusy, value))
            {
                OnPropertyChanged(nameof(CanSendComment));
            }
        }
    }

    public bool IsStatusBusy
    {
        get => _isStatusBusy;
        set
        {
            if (SetProperty(ref _isStatusBusy, value))
            {
                OnPropertyChanged(nameof(CanChangeStatus));
            }
        }
    }

    public void Update(HubTicketRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);
        Id = request.Id;
        Title = $"Заявка №{request.Id}";
        StatusText = TicketStatusCatalog.LabelOf(request.Status);
        StatusTone = TicketStatusCatalog.ToneOf(request.Status);
        Version = request.Version;
        EmployeeText = request.EmployeeName ?? string.Empty;
        ObjectText = string.Join(
            " ",
            new[] { request.ObjectCode, request.ObjectName }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
        RouteText = TicketFormat.FormatArrivalRoute(request.ArrivalDate, request.Route);
        SubmittedText = TicketFormat.FormatDate(request.SubmittedAt);
        DepartureText = TicketFormat.FormatDate(request.DepartureDate);
        ArrivalText = TicketFormat.FormatDate(request.ArrivalDate);
        AssigneeText = request.AssigneeName ?? string.Empty;
        CostText = TicketFormat.FormatMoney(request.TotalCost);
        RefundText = TicketFormat.FormatMoney(request.RefundLoss);
        NoteText = request.Note ?? string.Empty;
        CreatedText = TicketFormat.FormatDateTime(request.CreatedAt);
        UpdatedText = TicketFormat.FormatDateTime(request.UpdatedAt);
        IsUrgent = request.IsUrgent;
        NeedsReview = request.NeedsReview;

        StatusActions.Clear();
        foreach (var option in TicketStatusCatalog.TransitionsOf(request.Status))
        {
            StatusActions.Add(option);
        }

        StatusComment = null;
        OnPropertyChanged(string.Empty);
    }

    public void SetComments(IReadOnlyList<HubTicketComment> comments)
    {
        Comments.Clear();
        foreach (var comment in comments)
        {
            Comments.Add(new TicketCommentViewModel(comment));
        }
    }

    public void AppendComment(HubTicketComment comment)
    {
        Comments.Add(new TicketCommentViewModel(comment));
    }

    public void SetAttachments(IReadOnlyList<HubTicketAttachment> attachments)
    {
        Attachments.Clear();
        foreach (var attachment in attachments)
        {
            Attachments.Add(new TicketAttachmentViewModel(attachment));
        }
    }

    /// <summary>Первая страница истории: лента заменяется целиком.</summary>
    public void SetHistory(IReadOnlyList<HubTicketHistoryEntry> entries, int page, int totalPages)
    {
        _historyPage = page;
        _historyTotalPages = totalPages;
        HistoryEntries.Clear();
        foreach (var entry in entries)
        {
            HistoryEntries.Add(new TicketHistoryEntryViewModel(entry));
        }

        OnPropertyChanged(nameof(HasMoreHistory));
        OnPropertyChanged(nameof(CanLoadMoreHistory));
    }

    /// <summary>Догрузка следующей страницы в конец ленты («Показать ещё»).</summary>
    public void AppendHistory(IReadOnlyList<HubTicketHistoryEntry> entries, int page, int totalPages)
    {
        _historyPage = page;
        _historyTotalPages = totalPages;
        foreach (var entry in entries)
        {
            HistoryEntries.Add(new TicketHistoryEntryViewModel(entry));
        }

        OnPropertyChanged(nameof(HasMoreHistory));
        OnPropertyChanged(nameof(CanLoadMoreHistory));
    }
}

/// <summary>Карточка канбан-колонки: ФИО, объект, пилюли статуса/«Срочно», выезд и исполнитель.</summary>
public sealed class TicketKanbanCardViewModel
{
    public TicketKanbanCardViewModel(HubTicketKanbanCard card)
    {
        ArgumentNullException.ThrowIfNull(card);
        Id = card.Id;
        // Как в веб-карточке: employee_name || #id, object_name || '-'.
        Title = string.IsNullOrWhiteSpace(card.EmployeeName) ? $"#{card.Id}" : card.EmployeeName!.Trim();
        ObjectText = string.IsNullOrWhiteSpace(card.ObjectName) ? "—" : card.ObjectName!.Trim();
        StatusText = TicketStatusCatalog.LabelOf(card.Status);
        StatusTone = TicketStatusCatalog.ToneOf(card.Status);
        IsUrgent = card.IsUrgent;

        var departure = TicketFormat.FormatDate(card.DepartureDate);
        var route = (card.Route ?? string.Empty).Trim();
        RouteText = $"{(departure.Length > 0 ? departure : "—")} · {(route.Length > 0 ? route : "маршрут не указан")}";
        AssigneeText = string.IsNullOrWhiteSpace(card.AssigneeName)
            ? "Без ответственного"
            : card.AssigneeName!.Trim();
    }

    public long Id { get; }
    public string Title { get; }
    public string ObjectText { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public bool IsUrgent { get; }
    public string RouteText { get; }
    public string AssigneeText { get; }
}

/// <summary>Колонка канбана: заголовок backend'а, счётчик и карточки.</summary>
public sealed class TicketKanbanColumnViewModel : ObservableObject
{
    public TicketKanbanColumnViewModel(string title)
    {
        Title = title;
        Cards.CollectionChanged += (_, _) => OnPropertyChanged(nameof(CountText));
    }

    public string Title { get; }
    public ObservableCollection<TicketKanbanCardViewModel> Cards { get; } = [];
    public int Count => Cards.Count;
    public string CountText => Cards.Count.ToString(CultureInfo.CurrentCulture);
}

/// <summary>Метрика-карточка сводки: подпись + готовое значение (как Metric в вебе).</summary>
public sealed class TicketDashboardMetricViewModel
{
    public TicketDashboardMetricViewModel(string label, string value)
    {
        Label = label;
        Value = value;
    }

    public string Label { get; }
    public string Value { get; }
}

/// <summary>Строка «имя — число» топ-списков сводки (проблемы/нагрузка).</summary>
public sealed class TicketDashboardTopRowViewModel
{
    public TicketDashboardTopRowViewModel(string title, int value, bool isWarning)
    {
        Title = title;
        ValueText = value.ToString(CultureInfo.CurrentCulture);
        IsWarning = isWarning;
    }

    public string Title { get; }
    public string ValueText { get; }

    /// <summary>Проблемные объекты подсвечиваются warning-чипом, как в вебе.</summary>
    public bool IsWarning { get; }
}

/// <summary>Карточка объекта в сводке: счётчики-чипы, суммы, ближайший вылет.</summary>
public sealed class TicketDashboardObjectViewModel
{
    public TicketDashboardObjectViewModel(HubTicketsDashboardObject item)
    {
        ArgumentNullException.ThrowIfNull(item);
        ObjectId = item.ObjectId;
        Title = string.IsNullOrWhiteSpace(item.ObjectName)
            ? $"Объект {item.ObjectId}"
            : item.ObjectName!.Trim();
        CodeText = (item.ObjectCode ?? string.Empty).Trim();
        ActiveText = item.Active.ToString(CultureInfo.CurrentCulture);
        NewText = $"Новые {item.New.ToString(CultureInfo.CurrentCulture)}";
        InProgressText = $"Работа {item.InProgress.ToString(CultureInfo.CurrentCulture)}";
        ProblematicText = $"Проблемы {item.Problematic.ToString(CultureInfo.CurrentCulture)}";
        HasProblems = item.Problematic > 0;
        TicketSumText = $"Билеты: {TicketFormat.FormatMoney(item.TicketSum)}";
        LossSumText = $"Потери: {TicketFormat.FormatMoney(item.LossSum)}";
        var nearest = TicketFormat.FormatDate(item.NearestDeparture);
        NearestDepartureText = $"Ближайший вылет: {(nearest.Length > 0 ? nearest : "—")}";
    }

    public long ObjectId { get; }
    public string Title { get; }
    public string CodeText { get; }
    public string ActiveText { get; }
    public string NewText { get; }
    public string InProgressText { get; }
    public string ProblematicText { get; }
    public bool HasProblems { get; }
    public string TicketSumText { get; }
    public string LossSumText { get; }
    public string NearestDepartureText { get; }
}

/// <summary>
/// Страница «Билеты» нативного шелла: список заявок с фильтрами (статус, объект,
/// серверный поиск от 2 символов), page-пагинация «Показать ещё», карточка с
/// вложениями, переходами статуса и лентой комментариев. Режимы просмотра:
/// Список | Канбан (GET /tickets/kanban) | Дашборд (GET /tickets/dashboard) —
/// переключаются чипами в тулбаре, догружаются лениво при выборе.
/// </summary>
public sealed class TicketsViewModel : ObservableObject
{
    /// <summary>Размер страницы списка (backend принимает 20/25/50/100).</summary>
    private const int PageSize = 25;

    /// <summary>Комментариев на карточку за один запрос.</summary>
    private const int CommentsPageSize = 50;

    /// <summary>Записей истории на страницу — дефолт endpoint'а …/history.</summary>
    private const int HistoryPageSize = 20;

    /// <summary>Debounce серверного поиска — как у docflow/чата.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    /// <summary>Режимы просмотра — значения CommandParameter чипов в тулбаре.</summary>
    private const string ViewModeList = "list";
    private const string ViewModeKanban = "kanban";
    private const string ViewModeDashboard = "dashboard";

    /// <summary>
    /// Порядок колонок канбана — как в get_kanban backend'а (tickets_service):
    /// «Проблема» забирает заявки с needs_review/is_urgent вместо их статусной колонки.
    /// </summary>
    private static readonly IReadOnlyList<string> KanbanColumnOrder =
        ["Не запущен", "В кассах", "Куплен", "Возврат/обмен", "Отмена", "Проблема"];

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _searchCancellation;

    /// <summary>Вложения, которые скачиваются прямо сейчас — второй клик не дублирует запрос.</summary>
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);

    /// <summary>Заглушка событий фильтров на время Reset (без лишних перезагрузок).</summary>
    private bool _suppressFilterEvents;

    /// <summary>Сырой справочник объектов последней загрузки — для формы создания.</summary>
    private IReadOnlyList<HubTicketObject> _objectsRaw = [];

    private TicketRequestListItemViewModel? _selectedItem;

    /// <summary>
    /// Заявка, чья карточка открыта/грузится: совпадает с SelectedItem для списка,
    /// но канбан выбирает карточку, которой может не быть в текущей выдаче списка.
    /// </summary>
    private long? _selectedRequestId;

    private TicketDetailViewModel? _detail;
    private TicketCreateViewModel? _create;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private TicketStatusOption? _selectedStatusFilter = TicketStatusCatalog.FilterOptions[0];
    private TicketObjectFilterItem? _selectedObjectFilter = TicketObjectFilterItem.All;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _total;
    private int _currentPage;
    private int _totalPages;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string? _statusInfoText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private string _viewMode = ViewModeList;
    private bool _isKanbanLoading;
    private bool _isDashboardLoading;

    public TicketsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        ObjectFilterOptions.Add(TicketObjectFilterItem.All);

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        SendCommentCommand = new NativeAsyncCommand(
            (_, ct) => SendCommentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanSendComment: true });
        ChangeStatusCommand = new NativeAsyncCommand(
            (parameter, ct) => ChangeStatusAsync(parameter as TicketStatusOption, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanChangeStatus: true });
        OpenAttachmentCommand = new NativeAsyncCommand(
            (parameter, _) => OpenAttachmentAsync(parameter as TicketAttachmentViewModel),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is TicketAttachmentViewModel { IsDownloading: false });
        LoadMoreHistoryCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreHistoryAsync(ct),
            ex =>
            {
                // Сбои ленты уже отражены флагом HistoryFailed; снимаем спиннер.
                if (Detail is { } detail)
                {
                    detail.IsHistoryBusy = false;
                }
            },
            _ => Detail is { CanLoadMoreHistory: true });
        SelectStatusFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TicketStatusOption option)
            {
                SelectedStatusFilter = option;
            }
        });
        SelectObjectFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TicketObjectFilterItem option)
            {
                SelectedObjectFilter = option;
            }
        });
        NewTicketCommand = new NativeAsyncCommand(
            (_, ct) => OpenCreateAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectViewModeCommand = new NativeRelayCommand(
            parameter => ViewMode = parameter as string ?? ViewModeList);
        SelectKanbanCardCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is TicketKanbanCardViewModel card)
            {
                SelectRequestById(card.Id);
            }
        });
        CloseDetailCommand = new NativeRelayCommand(() =>
        {
            // «✕» карточки в канбане: скрыть оверлей, доска остаётся.
            _detailLoadCancellation?.Cancel();
            SelectedItem = null;
            SetSelectedRequestId(null);
            Detail = null;
            DetailErrorText = null;
        });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        DismissStatusCommand = new NativeRelayCommand(() => StatusInfoText = null);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(MoreButtonText));
        };
        DashboardObjects.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasDashboardObjects));
        DashboardTopProblems.CollectionChanged += (_, _) =>
            OnPropertyChanged(nameof(HasDashboardTopProblems));
        DashboardTopAssignees.CollectionChanged += (_, _) =>
            OnPropertyChanged(nameof(HasDashboardTopAssignees));
    }

    // ---- Список и фильтры ----

    public ObservableCollection<TicketRequestListItemViewModel> Items { get; } = [];

    /// <summary>Фильтр статуса: «Все статусы» + 6 статусов backend'а.</summary>
    public IReadOnlyList<TicketStatusOption> StatusFilterOptions => TicketStatusCatalog.FilterOptions;

    /// <summary>Фильтр по объекту: «Все объекты» + справочник GET /tickets/objects.</summary>
    public ObservableCollection<TicketObjectFilterItem> ObjectFilterOptions { get; } = [];

    public TicketStatusOption? SelectedStatusFilter
    {
        get => _selectedStatusFilter;
        set
        {
            if (SetProperty(ref _selectedStatusFilter, value))
            {
                OnPropertyChanged(nameof(SelectedStatusFilterText));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки фильтра статуса: «Статус: В кассах ▾».</summary>
    public string SelectedStatusFilterText => SelectedStatusFilter?.Label ?? "Все статусы";

    public TicketObjectFilterItem? SelectedObjectFilter
    {
        get => _selectedObjectFilter;
        set
        {
            if (SetProperty(ref _selectedObjectFilter, value))
            {
                OnPropertyChanged(nameof(SelectedObjectFilterText));
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки фильтра объекта: «Объект: Логистика ▾».</summary>
    public string SelectedObjectFilterText => SelectedObjectFilter?.Name ?? "Все объекты";

    // ---- Режим просмотра: Список | Канбан | Дашборд ----

    /// <summary>Текущий режим: list|kanban|dashboard (чипы в тулбаре).</summary>
    public string ViewMode
    {
        get => _viewMode;
        private set
        {
            var normalized = value is ViewModeKanban or ViewModeDashboard ? value : ViewModeList;
            if (SetProperty(ref _viewMode, normalized))
            {
                OnPropertyChanged(nameof(IsListMode));
                OnPropertyChanged(nameof(IsKanbanMode));
                OnPropertyChanged(nameof(IsDashboardMode));
                OnPropertyChanged(nameof(ShowSidePanel));
                OnPropertyChanged(nameof(IsKanbanDetailOpen));
                // Ленивая догрузка при входе в режим — данные оперативные, как у списка.
                if (normalized == ViewModeKanban)
                {
                    _ = LoadKanbanSafelyAsync(CancellationToken.None);
                }
                else if (normalized == ViewModeDashboard)
                {
                    _ = LoadDashboardSafelyAsync(CancellationToken.None);
                }
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectViewModeCommand.
    /// <summary>Режим «Список»: фильтры + страницы заявок.</summary>
    public bool IsListMode
    {
        get => _viewMode == ViewModeList;
        set
        {
            if (value)
            {
                SelectViewModeCommand.Execute(ViewModeList);
            }
        }
    }

    /// <summary>Режим «Канбан»: доска колонок по статусам.</summary>
    public bool IsKanbanMode
    {
        get => _viewMode == ViewModeKanban;
        set
        {
            if (value)
            {
                SelectViewModeCommand.Execute(ViewModeKanban);
            }
        }
    }

    /// <summary>Режим «Дашборд»: метрики и топ-списки.</summary>
    public bool IsDashboardMode
    {
        get => _viewMode == ViewModeDashboard;
        set
        {
            if (value)
            {
                SelectViewModeCommand.Execute(ViewModeDashboard);
            }
        }
    }

    // ---- Канбан ----

    /// <summary>Колонки доски в фиксированном порядке backend'а (пустые тоже видны).</summary>
    public ObservableCollection<TicketKanbanColumnViewModel> KanbanColumns { get; } = [];

    public bool IsKanbanLoading
    {
        get => _isKanbanLoading;
        private set => SetProperty(ref _isKanbanLoading, value);
    }

    // ---- Дашборд ----

    /// <summary>Карточки-счётчики сводки (label + значение) — как сетка Metric в вебе.</summary>
    public ObservableCollection<TicketDashboardMetricViewModel> DashboardMetrics { get; } = [];

    /// <summary>Разрез по объектам выезда.</summary>
    public ObservableCollection<TicketDashboardObjectViewModel> DashboardObjects { get; } = [];

    /// <summary>Топ объектов по числу проблемных заявок.</summary>
    public ObservableCollection<TicketDashboardTopRowViewModel> DashboardTopProblems { get; } = [];

    /// <summary>Топ исполнителей по числу активных заявок.</summary>
    public ObservableCollection<TicketDashboardTopRowViewModel> DashboardTopAssignees { get; } = [];

    public bool HasDashboardObjects => DashboardObjects.Count > 0;
    public bool HasDashboardTopProblems => DashboardTopProblems.Count > 0;
    public bool HasDashboardTopAssignees => DashboardTopAssignees.Count > 0;

    public bool IsDashboardLoading
    {
        get => _isDashboardLoading;
        private set => SetProperty(ref _isDashboardLoading, value);
    }

    public TicketRequestListItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value))
            {
                SetSelectedRequestId(value?.Id);
                if (value is not null)
                {
                    _ = LoadDetailSafelyAsync(value.Id);
                }
            }
        }
    }

    public TicketDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (_detail is not null)
            {
                _detail.PropertyChanged -= Detail_PropertyChanged;
            }

            if (SetProperty(ref _detail, value))
            {
                if (value is not null)
                {
                    value.PropertyChanged += Detail_PropertyChanged;
                }

                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
                RaiseCommandStates();
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите заявку» — ни карточки, ни загрузки деталей.</summary>
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

    /// <summary>
    /// Правая колонка с карточкой: в списке видна всегда (плейсхолдер/карточка),
    /// в канбане — оверлей поверх доски только при выбранной заявке, в сводке — скрыта.
    /// </summary>
    public bool ShowSidePanel => IsListMode || (IsKanbanMode && _selectedRequestId is not null);

    /// <summary>
    /// Канбан-оверлей карточки открыт: под ним показывается scrim,
    /// клик по которому закрывает карточку.
    /// </summary>
    public bool IsKanbanDetailOpen => IsKanbanMode && _selectedRequestId is not null;

    private void SetSelectedRequestId(long? requestId)
    {
        if (_selectedRequestId != requestId)
        {
            _selectedRequestId = requestId;
            OnPropertyChanged(nameof(ShowSidePanel));
            OnPropertyChanged(nameof(IsKanbanDetailOpen));
        }
    }

    /// <summary>Поиск по серверу: изменение строки запускает debounce-перезагрузку списка.</summary>
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

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
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

    /// <summary>На сервере есть ещё страницы (current_page меньше total_pages).</summary>
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

    /// <summary>Подпись кнопки «Показать ещё» с остатком по total.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : _total > 0
            ? $"Показать ещё ({Math.Max(0, _total - Items.Count)})"
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
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    // ---- Форма создания (оверлей поверх карточки, как композер у почты) ----

    /// <summary>Открытая панель «Новая заявка»; null — скрыта.</summary>
    public TicketCreateViewModel? Create
    {
        get => _create;
        private set
        {
            if (SetProperty(ref _create, value))
            {
                OnPropertyChanged(nameof(IsCreateOpen));
            }
        }
    }

    public bool IsCreateOpen => Create is not null;

    /// <summary>
    /// Шов выбора файлов для «Прикрепить» формы (как ComposeFilePicker у почты):
    /// view ставит OpenFileDialog, тесты — заглушку с путями. null — пустой список.
    /// </summary>
    public Func<IReadOnlyList<string>>? CreateFilePicker { get; set; }

    /// <summary>Инфо-плашка (результат смены статуса) — зелёная, закрываемая.</summary>
    public string? StatusInfoText
    {
        get => _statusInfoText;
        private set
        {
            if (SetProperty(ref _statusInfoText, value))
            {
                OnPropertyChanged(nameof(HasStatusInfo));
            }
        }
    }

    public bool HasStatusInfo => !string.IsNullOrEmpty(StatusInfoText);

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

    /// <summary>Пустая выдача без ошибки и загрузки.</summary>
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    public ICommand RefreshCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand NewTicketCommand { get; }
    public ICommand SelectViewModeCommand { get; }
    public ICommand SelectKanbanCardCommand { get; }
    public ICommand CloseDetailCommand { get; }
    public ICommand SelectStatusFilterCommand { get; }
    public ICommand SelectObjectFilterCommand { get; }
    public ICommand SendCommentCommand { get; }
    public ICommand ChangeStatusCommand { get; }
    public ICommand OpenAttachmentCommand { get; }
    public ICommand LoadMoreHistoryCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand DismissStatusCommand { get; }

    /// <summary>
    /// Шов сохранения/открытия вложения (как FileSaver у docflow): тесты заменяют
    /// потоковое скачивание в %TEMP% + Process.Start. Аргументы — чип и id заявки.
    /// </summary>
    public Func<TicketAttachmentViewModel, long, Task>? AttachmentSaver { get; set; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    private HubTicketQuery BuildQuery(int page) => new()
    {
        Page = page,
        PageSize = PageSize,
        Statuses = SelectedStatusFilter?.Value,
        ObjectIds = SelectedObjectFilter?.Id?.ToString(CultureInfo.InvariantCulture),
        // Как в вебе: поиск короче 2 символов на сервер не уходит.
        Search = SearchText.Trim().Length >= 2 ? SearchText.Trim() : null,
        SortField = "submitted_at",
        SortDir = "desc",
    };

    /// <summary>
    /// Первичная загрузка/обновление: в режиме списка — справочник объектов и
    /// первая страница; в канбане/дашборде «Обновить» перечитывает их данные.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        if (IsKanbanMode)
        {
            await LoadKanbanSafelyAsync(cancellationToken);
            return;
        }

        if (IsDashboardMode)
        {
            await LoadDashboardSafelyAsync(cancellationToken);
            return;
        }

        IsLoading = true;
        try
        {
            await LoadObjectsSafelyAsync(cancellationToken);
            await LoadListPageAsync(page: 1, replace: true, cancellationToken);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task LoadObjectsSafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var objects = await _api.GetTicketObjectsAsync(cancellationToken);
            ApplyObjects(objects);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            // Справочник нужен только для фильтра — список грузим и без него.
        }
    }

    private void ApplyObjects(HubTicketObjectList list)
    {
        var selectedId = SelectedObjectFilter?.Id;
        _objectsRaw = list.Items ?? [];
        ObjectFilterOptions.Clear();
        ObjectFilterOptions.Add(TicketObjectFilterItem.All);
        foreach (var item in list.Items ?? [])
        {
            var name = string.IsNullOrWhiteSpace(item.Name)
                ? (item.Code ?? $"Объект {item.Id}")
                : item.Name!;
            ObjectFilterOptions.Add(new TicketObjectFilterItem(item.Id, name));
        }

        var restored = ObjectFilterOptions.FirstOrDefault(option => option.Id == selectedId)
            ?? TicketObjectFilterItem.All;
        if (!ReferenceEquals(SelectedObjectFilter, restored))
        {
            _selectedObjectFilter = restored;
            OnPropertyChanged(nameof(SelectedObjectFilter));
            OnPropertyChanged(nameof(SelectedObjectFilterText));
        }
    }

    private async Task LoadListPageAsync(int page, bool replace, CancellationToken cancellationToken)
    {
        var result = await _api.GetTicketRequestsAsync(BuildQuery(page), cancellationToken);
        if (replace)
        {
            Items.Clear();
        }

        _total = result.Total;
        _currentPage = result.Page > 0 ? result.Page : page;
        _totalPages = result.TotalPages;
        HasMore = _currentPage < _totalPages;
        foreach (var item in result.Items ?? [])
        {
            Items.Add(new TicketRequestListItemViewModel(item));
        }

        TotalText = _total.ToString(CultureInfo.CurrentCulture);
    }

    /// <summary>Догрузка следующей страницы в конец списка («Показать ещё»).</summary>
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            await LoadListPageAsync(_currentPage + 1, replace: false, cancellationToken);
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    /// <summary>Смена фильтра: список и карточка перечитываются с первой страницы.</summary>
    private void ReloadFromFilterChange()
    {
        if (_suppressFilterEvents)
        {
            return;
        }

        if (IsDashboardMode)
        {
            // У сводки параметров нет — фильтры в этом режиме скрыты.
            return;
        }

        if (IsKanbanMode)
        {
            // В канбане виден только фильтр объекта — он идёт в object_ids запроса.
            _ = LoadKanbanSafelyAsync(CancellationToken.None);
            return;
        }

        _ = ReloadListSafelyAsync();
    }

    private async Task ReloadListSafelyAsync()
    {
        try
        {
            Detail = null;
            SelectedItem = null;
            IsLoading = true;
            try
            {
                await LoadListPageAsync(page: 1, replace: true, CancellationToken.None);
            }
            finally
            {
                IsLoading = false;
            }

            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Debounce 400 мс: серверный поиск по текущим фильтрам.</summary>
    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
        var query = _searchText.Trim();
        _ = SearchSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await DelayAsync(SearchDebounce, cancellationToken);
            // Запрос уже сменился — результат устарел.
            if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            Detail = null;
            SelectedItem = null;
            await LoadAsync(cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    // ---- Канбан и дашборд ----

    /// <summary>
    /// GET /tickets/kanban: доска по статусам; фильтр объекта идёт в object_ids.
    /// Best-effort: ошибка — в баннер, доска остаётся как была.
    /// </summary>
    private async Task LoadKanbanSafelyAsync(CancellationToken cancellationToken)
    {
        IsKanbanLoading = true;
        try
        {
            var board = await _api.GetTicketKanbanAsync(
                SelectedObjectFilter?.Id?.ToString(CultureInfo.InvariantCulture),
                assigneeIds: null,
                cancellationToken);
            ApplyKanban(board);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsKanbanLoading = false;
        }
    }

    /// <summary>
    /// Колонки — в порядке backend'а, пустые тоже показываем; ключи вне карты
    /// (если backend добавит колонку) дописываем в конец, чтобы не потерять карточки.
    /// </summary>
    private void ApplyKanban(IReadOnlyDictionary<string, IReadOnlyList<HubTicketKanbanCard>>? board)
    {
        KanbanColumns.Clear();
        var known = new HashSet<string>(StringComparer.Ordinal);
        foreach (var title in KanbanColumnOrder)
        {
            known.Add(title);
            var column = new TicketKanbanColumnViewModel(title);
            if (board is not null && board.TryGetValue(title, out var cards))
            {
                foreach (var card in cards)
                {
                    column.Cards.Add(new TicketKanbanCardViewModel(card));
                }
            }

            KanbanColumns.Add(column);
        }

        if (board is null)
        {
            return;
        }

        foreach (var pair in board)
        {
            if (!known.Add(pair.Key))
            {
                continue;
            }

            var column = new TicketKanbanColumnViewModel(pair.Key);
            foreach (var card in pair.Value)
            {
                column.Cards.Add(new TicketKanbanCardViewModel(card));
            }

            KanbanColumns.Add(column);
        }
    }

    /// <summary>GET /tickets/dashboard: метрики + разрез по объектам + топ-списки.</summary>
    private async Task LoadDashboardSafelyAsync(CancellationToken cancellationToken)
    {
        IsDashboardLoading = true;
        try
        {
            var dashboard = await _api.GetTicketDashboardAsync(cancellationToken);
            ApplyDashboard(dashboard);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsDashboardLoading = false;
        }
    }

    private void ApplyDashboard(HubTicketsDashboard? dashboard)
    {
        DashboardMetrics.Clear();
        DashboardObjects.Clear();
        DashboardTopProblems.Clear();
        DashboardTopAssignees.Clear();
        if (dashboard is null)
        {
            return;
        }

        // Подписи — как в веб-дашборде (TicketDashboard.jsx).
        if (dashboard.Metrics is { } metrics)
        {
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Активные", metrics.TotalActive.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Новые", metrics.New.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "В работе", metrics.InProgress.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Куплены", metrics.Purchased.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Проблемные", metrics.Problematic.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Вылет сегодня", metrics.DeparturesToday.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Вылет завтра", metrics.DeparturesTomorrow.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Вылет 3 дня", metrics.Departures3Days.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Возвраты/обмены", metrics.RefundsExchanges.ToString(CultureInfo.CurrentCulture)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Сумма билетов", TicketFormat.FormatMoney(metrics.TicketSum)));
            DashboardMetrics.Add(new TicketDashboardMetricViewModel(
                "Потери", TicketFormat.FormatMoney(metrics.LossSum)));
        }

        foreach (var item in dashboard.PerObject ?? [])
        {
            DashboardObjects.Add(new TicketDashboardObjectViewModel(item));
        }

        foreach (var item in dashboard.TopProblems ?? [])
        {
            var title = string.IsNullOrWhiteSpace(item.ObjectName)
                ? $"Объект {item.ObjectId}"
                : item.ObjectName!.Trim();
            DashboardTopProblems.Add(new TicketDashboardTopRowViewModel(title, item.Problematic, isWarning: true));
        }

        foreach (var item in dashboard.TopAssignees ?? [])
        {
            var title = string.IsNullOrWhiteSpace(item.AssigneeName)
                ? $"#{item.AssigneeId}"
                : item.AssigneeName!.Trim();
            DashboardTopAssignees.Add(new TicketDashboardTopRowViewModel(title, item.ActiveCount, isWarning: false));
        }
    }

    /// <summary>
    /// Выбор заявки по id (карточка канбана): если строка есть в списке — выделяем
    /// её же, иначе грузим карточку напрямую; дальше общий флоу карточки.
    /// </summary>
    private void SelectRequestById(long requestId)
    {
        var match = Items.FirstOrDefault(item => item.Id == requestId);
        if (match is not null)
        {
            SelectedItem = match;
            return;
        }

        // Заявки нет в текущей выдаче списка — выделение там снимаем.
        SelectedItem = null;
        SetSelectedRequestId(requestId);
        _ = LoadDetailSafelyAsync(requestId);
    }

    private async Task LoadDetailSafelyAsync(long requestId)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var request = await _api.GetTicketRequestAsync(requestId, cancellation.Token);
            if (_selectedRequestId != requestId)
            {
                return;
            }

            if (Detail is null || Detail.Id != requestId)
            {
                Detail = new TicketDetailViewModel(request);
            }
            else
            {
                Detail.Update(request);
            }

            // Лента и вложения — отдельными запросами; backend при смене статуса
            // дописывает системный комментарий, поэтому перечитываем их же.
            await LoadCommentsSafelyAsync(requestId, cancellation.Token);
            await LoadAttachmentsSafelyAsync(requestId, cancellation.Token);
            await LoadHistorySafelyAsync(requestId, page: 1, append: false, cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            if (ReferenceEquals(_detailLoadCancellation, cancellation))
            {
                IsDetailLoading = false;
            }
        }
    }

    private async Task LoadCommentsSafelyAsync(long requestId, CancellationToken cancellationToken)
    {
        try
        {
            var page = await _api.GetTicketCommentsAsync(
                requestId, page: 1, CommentsPageSize, cancellationToken);
            if (_selectedRequestId == requestId && Detail?.Id == requestId)
            {
                Detail.SetComments(page.Items ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    private async Task LoadAttachmentsSafelyAsync(long requestId, CancellationToken cancellationToken)
    {
        try
        {
            var list = await _api.GetTicketAttachmentsAsync(requestId, cancellationToken);
            if (_selectedRequestId == requestId && Detail?.Id == requestId)
            {
                Detail.SetAttachments(list.Items ?? []);
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    /// <summary>
    /// GET …/history (новые первыми). Best-effort: сбой помечает только секцию
    /// истории флагом HistoryFailed — карточка, комментарии и файлы не страдают.
    /// </summary>
    private async Task LoadHistorySafelyAsync(
        long requestId,
        int page,
        bool append,
        CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.Id != requestId)
        {
            return;
        }

        detail.IsHistoryBusy = true;
        try
        {
            var result = await _api.GetTicketHistoryAsync(
                requestId, page, HistoryPageSize, cancellationToken);
            if (_selectedRequestId != requestId || Detail?.Id != requestId)
            {
                return;
            }

            if (append)
            {
                Detail.AppendHistory(result.Items ?? [], result.Page, result.TotalPages);
            }
            else
            {
                Detail.SetHistory(result.Items ?? [], result.Page, result.TotalPages);
            }

            Detail.HistoryFailed = false;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            if (_selectedRequestId == requestId && Detail?.Id == requestId)
            {
                Detail.HistoryFailed = true;
            }
        }
        finally
        {
            detail.IsHistoryBusy = false;
        }
    }

    /// <summary>«Показать ещё» истории: следующая страница дописывается в конец ленты.</summary>
    private async Task LoadMoreHistoryAsync(CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || !detail.HasMoreHistory)
        {
            return;
        }

        await LoadHistorySafelyAsync(
            detail.Id, detail.NextHistoryPage, append: true, cancellationToken);
    }

    // ---- Комментарии ----

    private async Task SendCommentAsync(CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (detail is null || detail.IsCommentBusy)
        {
            return;
        }

        var text = detail.CommentText?.Trim() ?? string.Empty;
        if (text.Length == 0)
        {
            return;
        }

        detail.IsCommentBusy = true;
        DetailErrorText = null;
        try
        {
            var comment = await _api.AddTicketCommentAsync(detail.Id, text, cancellationToken);
            detail.AppendComment(comment);
            detail.CommentText = string.Empty;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            detail.IsCommentBusy = false;
        }
    }

    // ---- Смена статуса (PATCH …/status с optimistic locking) ----

    private async Task ChangeStatusAsync(TicketStatusOption? option, CancellationToken cancellationToken)
    {
        var detail = Detail;
        if (option?.Value is not { } newStatus || detail is null || detail.IsStatusBusy)
        {
            return;
        }

        detail.IsStatusBusy = true;
        DetailErrorText = null;
        StatusInfoText = null;
        try
        {
            var comment = detail.StatusComment?.Trim();
            var updated = await _api.ChangeTicketStatusAsync(
                detail.Id,
                newStatus,
                detail.Version,
                comment?.Length > 0 ? comment : null,
                cancellationToken);
            detail.Update(updated);
            Items.FirstOrDefault(item => item.Id == detail.Id)?.UpdateStatus(updated.Status);
            // Backend дописывает системный комментарий и запись истории — перечитываем обе ленты.
            await LoadCommentsSafelyAsync(detail.Id, CancellationToken.None);
            await LoadHistorySafelyAsync(detail.Id, page: 1, append: false, CancellationToken.None);
            StatusInfoText = $"Статус обновлён: {TicketStatusCatalog.LabelOf(updated.Status)}";
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
            // 409 (конфликт версии/запрет перехода) — карточка устарела, тихо перечитаем.
            _ = RefreshDetailSafelyAsync(detail.Id);
        }
        finally
        {
            detail.IsStatusBusy = false;
        }
    }

    /// <summary>Best-effort перечитывание карточки после конфликта версии.</summary>
    private async Task RefreshDetailSafelyAsync(long requestId)
    {
        if (Detail is null)
        {
            return;
        }

        try
        {
            var request = await _api.GetTicketRequestAsync(requestId, CancellationToken.None);
            if (Detail is { } current && current.Id == request.Id)
            {
                current.Update(request);
            }
        }
        catch
        {
            // Карточка останется прежней; явное «Обновить» поднимет её.
        }
    }

    // ---- Вложения ----

    /// <summary>Чип вложения нажат: скачиваем в %TEMP%/hub-desktop/tickets и открываем ОС.</summary>
    private async Task OpenAttachmentAsync(TicketAttachmentViewModel? item)
    {
        var requestId = Detail?.Id;
        if (item is null || requestId is not { } id || string.IsNullOrEmpty(item.AttachmentId))
        {
            return;
        }

        var downloadKey = id + ":" + item.AttachmentId;
        if (!_attachmentDownloadsInFlight.Add(downloadKey))
        {
            // Уже качается — второй FileStream на том же target дал бы «файл занят».
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (AttachmentSaver is not null)
            {
                await AttachmentSaver(item, id);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "tickets");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "attachment.bin";
            }

            var target = Path.Combine(directory, $"{item.AttachmentId}-{safeName}");
            var cached = File.Exists(target) && new FileInfo(target).Length == item.Model.FileSize;
            if (!cached)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadTicketAttachmentAsync(
                    id, item.AttachmentId, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var renamed = Path.Combine(directory, $"{item.AttachmentId}-{downloadedName}");
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

            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    // ---- Создание заявки ----

    /// <summary>«＋ Новая заявка»: справочник объектов догружаем лениво, форма — поверх карточки.</summary>
    private async Task OpenCreateAsync(CancellationToken cancellationToken)
    {
        // Повторный клик при открытой форме — не пересоздаём, иначе потеряем введённые поля.
        if (Create is not null)
        {
            return;
        }

        if (_objectsRaw.Count == 0)
        {
            await LoadObjectsSafelyAsync(cancellationToken);
        }

        var create = new TicketCreateViewModel(_api, _objectsRaw, CreateFilePicker, DelayAsync);
        create.Created += Create_Created;
        create.Closed += Create_Closed;
        Create = create;
    }

    /// <summary>Создано: строка сверху списка (submitted_at desc), заявка сразу выбрана.</summary>
    private void Create_Created(object? sender, TicketCreatedEventArgs e)
    {
        var created = e.Request;
        var item = new TicketRequestListItemViewModel(created);
        Items.Insert(0, item);
        _total += 1;
        TotalText = _total.ToString(CultureInfo.CurrentCulture);
        Create = null;
        SelectedItem = item;
        StatusInfoText = e.FailedUploads.Count == 0
            ? $"Заявка №{created.Id} создана."
            : $"Заявка №{created.Id} создана, но файлы не загрузились: {string.Join(", ", e.FailedUploads)}";
    }

    private void Create_Closed(object? sender, EventArgs e)
    {
        Create = null;
    }

    // ---- Служебное ----

    private void Detail_PropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName is null
            or nameof(TicketDetailViewModel.CanSendComment)
            or nameof(TicketDetailViewModel.CanChangeStatus)
            or nameof(TicketDetailViewModel.CanLoadMoreHistory))
        {
            RaiseCommandStates();
        }
    }

    private void RaiseCommandStates()
    {
        (SendCommentCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ChangeStatusCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (LoadMoreHistoryCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
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
        _detailLoadCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _suppressFilterEvents = true;
        Items.Clear();
        KanbanColumns.Clear();
        DashboardMetrics.Clear();
        DashboardObjects.Clear();
        DashboardTopProblems.Clear();
        DashboardTopAssignees.Clear();
        Detail = null;
        SelectedItem = null;
        SetSelectedRequestId(null);
        Create = null;
        _objectsRaw = [];
        BannerErrorText = null;
        DetailErrorText = null;
        StatusInfoText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        _selectedStatusFilter = StatusFilterOptions[0];
        OnPropertyChanged(nameof(SelectedStatusFilter));
        OnPropertyChanged(nameof(SelectedStatusFilterText));
        ObjectFilterOptions.Clear();
        ObjectFilterOptions.Add(TicketObjectFilterItem.All);
        _selectedObjectFilter = TicketObjectFilterItem.All;
        OnPropertyChanged(nameof(SelectedObjectFilter));
        OnPropertyChanged(nameof(SelectedObjectFilterText));
        _suppressFilterEvents = false;
        _total = 0;
        _currentPage = 0;
        _totalPages = 0;
        HasMore = false;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
        IsKanbanLoading = false;
        IsDashboardLoading = false;
        _viewMode = ViewModeList;
        OnPropertyChanged(nameof(ViewMode));
        OnPropertyChanged(nameof(IsListMode));
        OnPropertyChanged(nameof(IsKanbanMode));
        OnPropertyChanged(nameof(IsDashboardMode));
        _attachmentDownloadsInFlight.Clear();
    }
}
