using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Элемент списка заданий 1С: заголовок, статус-плашка, автор и дата.
/// Логика статуса — как TaskStatusChips в веб-Документообороте
/// (completed → «Завершено», accepted → «Принято в работу», иначе «Новое»).
/// </summary>
public sealed class DocflowTaskListItemViewModel : ObservableObject
{
    public DocflowTaskListItemViewModel(HubDocflowTaskItem task)
    {
        ArgumentNullException.ThrowIfNull(task);
        Ref = task.Ref ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(task.Title) ? "Без названия" : task.Title!;
        TypeLabel = task.TaskTypeLabel ?? string.Empty;
        AuthorText = string.IsNullOrWhiteSpace(task.Author) ? string.Empty : task.Author!;
        ApplyState(task.Completed, task.Accepted, task.DueAt, task.CreatedAt, task.CompletedAt);
        ApplyImportance(task.Importance);
    }

    public string Ref { get; }
    public string Title { get; }
    public string TypeLabel { get; }
    public string AuthorText { get; }
    public string? StatusText { get; private set; }
    public string StatusTone { get; private set; } = HubStatusTone.Info;
    public string DueText { get; private set; } = string.Empty;
    public string ImportanceText { get; private set; } = string.Empty;
    public bool ShowImportance { get; private set; }

    /// <summary>Отметить задание выполненным без перечитывания списка (scope «Все»).</summary>
    public void MarkCompleted()
    {
        ApplyState(completed: true, accepted: true, dueAt: null, createdAt: null, completedAt: null);
    }

    private void ApplyState(
        bool completed,
        bool? accepted,
        string? dueAt,
        string? createdAt,
        string? completedAt)
    {
        var overdue = !completed && IsOverdue(dueAt);
        StatusText = completed
            ? "Завершено"
            : accepted == true ? "Принято в работу" : "Новое";
        StatusTone = completed
            ? HubStatusTone.Success
            : overdue ? HubStatusTone.Danger : HubStatusTone.Info;
        if (completed)
        {
            DueText = FormatDateText("Выполнено", completedAt ?? dueAt);
        }
        else if (dueAt is not null)
        {
            DueText = FormatDateText(overdue ? "Просрочено" : "Срок", dueAt);
        }
        else
        {
            DueText = FormatDateText("Поставлено", createdAt);
        }

        OnPropertyChanged(nameof(StatusText));
        OnPropertyChanged(nameof(StatusTone));
        OnPropertyChanged(nameof(DueText));
    }

    private void ApplyImportance(string? importance)
    {
        // Как в вебе: «обычная» важность чипом не отмечается — только отклонения.
        ShowImportance = !string.IsNullOrWhiteSpace(importance)
            && !importance.Contains("обычн", StringComparison.OrdinalIgnoreCase);
        ImportanceText = ShowImportance ? importance!.Trim() : string.Empty;
    }

    internal static bool IsOverdue(string? dueAt) =>
        TryParseDate(dueAt, out var parsed) && parsed.Date < DateTime.Today;

    internal static bool TryParseDate(string? value, out DateTime parsed)
    {
        if (DateTimeOffset.TryParse(
                value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var offset))
        {
            parsed = offset.LocalDateTime;
            return true;
        }

        parsed = default;
        return false;
    }

    internal static string FormatDateTime(string? value) =>
        TryParseDate(value, out var parsed)
            ? parsed.ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : value?.Trim() ?? string.Empty;

    private static string FormatDateText(string label, string? value)
    {
        var formatted = FormatDateTime(value);
        return formatted.Length == 0 ? string.Empty : $"{label}: {formatted}";
    }
}

/// <summary>Чип файла задания в карточке: имя, размер, состояние «скачиваем».</summary>
public sealed class DocflowFileItemViewModel : ObservableObject
{
    private bool _isDownloading;

    public DocflowFileItemViewModel(HubDocflowFile file)
    {
        ArgumentNullException.ThrowIfNull(file);
        Model = file;
        Ref = file.Ref ?? string.Empty;
        Name = string.IsNullOrWhiteSpace(file.Name) ? "Файл" : file.Name!;
        SizeText = FormatSize(file.Size);
        PreviewSupported = file.PreviewSupported;
    }

    public HubDocflowFile Model { get; }
    public string Ref { get; }
    public string Name { get; }
    public string SizeText { get; }

    /// <summary>Backend умеет собрать PDF-копию — клик откроет её в системном viewer.</summary>
    public bool PreviewSupported { get; }

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

    /// <summary>Чип доступен, пока файл не скачивается (дедуп — и в OpenFileAsync).</summary>
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

/// <summary>Кнопка действия из available_actions (code/label/tone/comment_mode).</summary>
public sealed class DocflowActionItemViewModel
{
    public DocflowActionItemViewModel(HubDocflowAction action)
    {
        ArgumentNullException.ThrowIfNull(action);
        Code = action.Code ?? string.Empty;
        Label = string.IsNullOrWhiteSpace(action.Label) ? "Действие" : action.Label!;
        // Сервер шлёт и "error", и "danger" для деструктивного действия.
        IsDanger = action.Tone is "error" or "danger";
        CommentRequired = action.CommentMode is "required";
    }

    public string Code { get; }
    public string Label { get; }

    /// <summary>Деструктивное действие (tone=error — «Отклонить») — вторичный стиль кнопки.</summary>
    public bool IsDanger { get; }

    /// <summary>comment_mode=required — без комментария backend откажет.</summary>
    public bool CommentRequired { get; }
}

/// <summary>Строка «связанного документа» карточки (related_objects).</summary>
public sealed class DocflowRelatedItemViewModel
{
    public DocflowRelatedItemViewModel(HubDocflowRelatedObject related)
    {
        ArgumentNullException.ThrowIfNull(related);
        Title = related.Title ?? string.Empty;
        TypeLabel = related.ObjectTypeLabel ?? string.Empty;
    }

    public string Title { get; }
    public string TypeLabel { get; }
}

/// <summary>
/// Вариант документа 1С в форме поручения: «Название · номер»
/// (как getOptionLabel в веб-диалоге) + тип и дата второй строкой.
/// </summary>
public sealed class DocflowAssignmentDocumentOption
{
    public DocflowAssignmentDocumentOption(HubDocflowAssignmentDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);
        Ref = (document.Ref ?? string.Empty).Trim();
        DocumentType = (document.DocumentType ?? string.Empty).Trim();
        var title = (document.Title ?? string.Empty).Trim();
        var number = (document.Number ?? string.Empty).Trim();
        Title = (title.Length > 0, number.Length > 0) switch
        {
            (true, true) => $"{title} · {number}",
            (true, false) => title,
            _ => number.Length > 0 ? number : "Без названия",
        };
        MetaText = string.Join(
            " · ",
            new[] { document.DocumentTypeLabel, document.Date }
                .Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    /// <summary>UUID-ссылка документа 1С (document_ref запроса).</summary>
    public string Ref { get; }

    /// <summary>internal|incoming|outgoing (document_type запроса).</summary>
    public string DocumentType { get; }
    public string Title { get; }
    public string MetaText { get; }
}

/// <summary>Вариант исполнителя или контролёра поручения: ФИО + подразделение.</summary>
public sealed class DocflowAssigneeOption
{
    public DocflowAssigneeOption(HubDocflowAssignmentAssignee assignee)
    {
        ArgumentNullException.ThrowIfNull(assignee);
        Ref = (assignee.Ref ?? string.Empty).Trim();
        Title = string.IsNullOrWhiteSpace(assignee.Name) ? "Без имени" : assignee.Name!.Trim();
        MetaText = (assignee.Department ?? string.Empty).Trim();
    }

    /// <summary>UUID-ссылка сотрудника 1С (assignee_ref/controller_ref запроса).</summary>
    public string Ref { get; }
    public string Title { get; }
    public string MetaText { get; }
}

/// <summary>Результат подтверждённого создания поручения (команда applied/already_applied).</summary>
public sealed class DocflowAssignmentCreatedEventArgs : EventArgs
{
    public DocflowAssignmentCreatedEventArgs(HubDocflowAssignmentCommandResult result)
    {
        Result = result;
    }

    public HubDocflowAssignmentCommandResult Result { get; }
}

/// <summary>
/// Панель «Новое поручение» (оверлей поверх карточки, как форма заявки):
/// документ — серверный поиск /assignments/documents от 3 символов (debounce),
/// исполнитель и контролёр — из справочника /assignments/assignees
/// (предзагрузка при открытии, как в веб-диалоге), срок и текст поручения.
/// Обязательные: документ, исполнитель, срок в будущем, название и описание;
/// в пилоте (test_only) название обязано начинаться с required_title_prefix.
/// Отправка — POST /assignments с Idempotency-Key жизни формы: повторная
/// отправка возвращает ту же команду, дубля поручения не будет.
/// </summary>
public sealed class DocflowAssignmentCreateViewModel : ObservableObject
{
    /// <summary>Debounce серверного поиска — как SearchDebounce списка заданий.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    /// <summary>Минимум символов для поиска документа — ASSIGNMENT_DOC_SEARCH_MIN в вебе.</summary>
    private const int DocumentSearchMinLength = 3;

    /// <summary>Размер выдачи подсказок (backend допускает 1..50).</summary>
    private const int SearchLimit = 20;

    private const int TitleMaxLength = 200;
    private const int DescriptionMaxLength = 2000;

    /// <summary>Опрос команды создания — те же параметры, что у PollCommandAsync.</summary>
    private static readonly TimeSpan CommandInitialDelay = TimeSpan.FromMilliseconds(750);
    private static readonly TimeSpan CommandPollInterval = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan CommandPollTimeout = TimeSpan.FromSeconds(30);
    private const int CommandMaxAttempts = 20;

    private readonly IHubApiClient _api;
    private readonly Func<TimeSpan, CancellationToken, Task> _delayAsync;
    private readonly string _idempotencyKey;
    private CancellationTokenSource? _documentSearchCancellation;
    private CancellationTokenSource? _assigneeSearchCancellation;
    private CancellationTokenSource? _controllerSearchCancellation;

    private string _documentQuery = string.Empty;
    private DocflowAssignmentDocumentOption? _selectedDocument;
    private bool _isDocumentPopupOpen;
    private bool _isDocumentSearchBusy;
    private string? _documentHintText;
    private string _assigneeQuery = string.Empty;
    private DocflowAssigneeOption? _selectedAssignee;
    private bool _isAssigneePopupOpen;
    private bool _isAssigneeSearchBusy;
    private string? _assigneeHintText;
    private string _controllerQuery = string.Empty;
    private DocflowAssigneeOption? _selectedController;
    private bool _isControllerPopupOpen;
    private bool _isControllerSearchBusy;
    private string? _controllerHintText;
    private DateTime? _dueDate;
    private string _dueTimeText;
    private bool _isHighImportance;
    private string _titleText;
    private string _descriptionText = string.Empty;
    private bool _isBusy;
    private string? _errorText;
    private string? _commandStatusText;

    public DocflowAssignmentCreateViewModel(
        IHubApiClient api,
        HubDocflowAssignmentCapability? capability,
        Func<TimeSpan, CancellationToken, Task>? delayAsync = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _delayAsync = delayAsync ?? Task.Delay;
        _idempotencyKey = Guid.NewGuid().ToString("N");

        TestOnly = capability?.TestOnly != false;
        RequiredTitlePrefix = (capability?.RequiredTitlePrefix ?? string.Empty).Trim();
        if (TestOnly && RequiredTitlePrefix.Length == 0)
        {
            RequiredTitlePrefix = "HUB-IT TEST";
        }

        InfoText = "Документ должен уже существовать в 1С — здесь его только выбирают."
            + (TestOnly
                ? " Пилот: одно поручение одному исполнителю; после отправки повтор отключён."
                : " После отправки повторное создание отключено.");
        TitleHintText = TestOnly
            ? $"Название должно начинаться с «{RequiredTitlePrefix}»."
            : "Укажите понятное название поручения для исполнителя.";
        _titleText = TestOnly ? $"{RequiredTitlePrefix} · " : string.Empty;
        _dueDate = DateTime.Today.AddDays(1);
        _dueTimeText = "12:00";

        CreateCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
        SelectDocumentCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DocflowAssignmentDocumentOption option)
            {
                IsDocumentPopupOpen = false;
                SelectedDocument = option;
            }
        });
        ClearDocumentCommand = new NativeRelayCommand(
            () => SelectedDocument = null,
            () => !IsBusy);
        SelectAssigneeCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DocflowAssigneeOption option)
            {
                IsAssigneePopupOpen = false;
                SelectedAssignee = option;
            }
        });
        ClearAssigneeCommand = new NativeRelayCommand(
            () => SelectedAssignee = null,
            () => !IsBusy);
        SelectControllerCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is DocflowAssigneeOption option)
            {
                IsControllerPopupOpen = false;
                SelectedController = option;
            }
        });
        ClearControllerCommand = new NativeRelayCommand(
            () => SelectedController = null,
            () => !IsBusy);
    }

    /// <summary>Поручение подтверждено 1С: родитель закрывает форму и обновляет список.</summary>
    public event EventHandler<DocflowAssignmentCreatedEventArgs>? Created;

    /// <summary>Закрытие панели без создания (Отмена/✕) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>Пилотный режим: backend ограничивает название префиксом.</summary>
    public bool TestOnly { get; }

    /// <summary>Обязательный префикс названия в пилоте («HUB-IT TEST» по умолчанию).</summary>
    public string RequiredTitlePrefix { get; }

    /// <summary>Инфо-плашка сверху формы — как Alert severity=info в вебе.</summary>
    public string InfoText { get; }

    /// <summary>Подсказка под названием (префикс пилота или общий текст).</summary>
    public string TitleHintText { get; }

    // ---- Документ ----

    /// <summary>Строка поиска документа: серверный поиск от 3 символов, debounce.</summary>
    public string DocumentQuery
    {
        get => _documentQuery;
        set
        {
            if (SetProperty(ref _documentQuery, value ?? string.Empty))
            {
                // Правка строки после выбора — намерение искать заново.
                SelectedDocument = null;
                ScheduleDocumentSearch();
            }
        }
    }

    public ObservableCollection<DocflowAssignmentDocumentOption> DocumentOptions { get; } = [];

    public DocflowAssignmentDocumentOption? SelectedDocument
    {
        get => _selectedDocument;
        private set
        {
            if (SetProperty(ref _selectedDocument, value))
            {
                OnPropertyChanged(nameof(HasSelectedDocument));
            }
        }
    }

    public bool HasSelectedDocument => SelectedDocument is not null;

    /// <summary>Popup подсказок открыт; самозакрытие (StaysOpen=False) чистит выдачу.</summary>
    public bool IsDocumentPopupOpen
    {
        get => _isDocumentPopupOpen;
        set
        {
            if (SetProperty(ref _isDocumentPopupOpen, value) && !value)
            {
                DocumentOptions.Clear();
            }
        }
    }

    public bool IsDocumentSearchBusy
    {
        get => _isDocumentSearchBusy;
        private set => SetProperty(ref _isDocumentSearchBusy, value);
    }

    /// <summary>Подсказка под полем документа (минимум символов, усечённая выдача, reason).</summary>
    public string? DocumentHintText
    {
        get => _documentHintText;
        private set => SetProperty(ref _documentHintText, value);
    }

    // ---- Исполнитель ----

    /// <summary>Строка поиска исполнителя: уточняет справочник (debounce).</summary>
    public string AssigneeQuery
    {
        get => _assigneeQuery;
        set
        {
            if (SetProperty(ref _assigneeQuery, value ?? string.Empty))
            {
                SelectedAssignee = null;
                ScheduleAssigneeSearch();
            }
        }
    }

    /// <summary>Справочник исполнителей: предзагрузка при открытии + уточнение поиском.</summary>
    public ObservableCollection<DocflowAssigneeOption> AssigneeOptions { get; } = [];

    public DocflowAssigneeOption? SelectedAssignee
    {
        get => _selectedAssignee;
        private set
        {
            if (SetProperty(ref _selectedAssignee, value))
            {
                OnPropertyChanged(nameof(HasSelectedAssignee));
            }
        }
    }

    public bool HasSelectedAssignee => SelectedAssignee is not null;

    /// <summary>
    /// Popup исполнителей; справочник не чистится при закрытии —
    /// повторный фокус открывает те же варианты (ReopenAssigneePopup).
    /// </summary>
    public bool IsAssigneePopupOpen
    {
        get => _isAssigneePopupOpen;
        set => SetProperty(ref _isAssigneePopupOpen, value);
    }

    public bool IsAssigneeSearchBusy
    {
        get => _isAssigneeSearchBusy;
        private set => SetProperty(ref _isAssigneeSearchBusy, value);
    }

    public string? AssigneeHintText
    {
        get => _assigneeHintText;
        private set => SetProperty(ref _assigneeHintText, value);
    }

    // ---- Контролёр (необязательно) ----

    /// <summary>Строка поиска контролёра: тот же справочник assignees.</summary>
    public string ControllerQuery
    {
        get => _controllerQuery;
        set
        {
            if (SetProperty(ref _controllerQuery, value ?? string.Empty))
            {
                SelectedController = null;
                ScheduleControllerSearch();
            }
        }
    }

    public ObservableCollection<DocflowAssigneeOption> ControllerOptions { get; } = [];

    public DocflowAssigneeOption? SelectedController
    {
        get => _selectedController;
        private set
        {
            if (SetProperty(ref _selectedController, value))
            {
                OnPropertyChanged(nameof(HasSelectedController));
            }
        }
    }

    public bool HasSelectedController => SelectedController is not null;

    public bool IsControllerPopupOpen
    {
        get => _isControllerPopupOpen;
        set => SetProperty(ref _isControllerPopupOpen, value);
    }

    public bool IsControllerSearchBusy
    {
        get => _isControllerSearchBusy;
        private set => SetProperty(ref _isControllerSearchBusy, value);
    }

    public string? ControllerHintText
    {
        get => _controllerHintText;
        private set => SetProperty(ref _controllerHintText, value);
    }

    // ---- Срок, важность, текст ----

    /// <summary>Дата срока исполнения (по умолчанию — завтра, как в вебе).</summary>
    public DateTime? DueDate
    {
        get => _dueDate;
        set => SetProperty(ref _dueDate, value);
    }

    /// <summary>Время срока «ЧЧ:мм» (по умолчанию 12:00, как в вебе).</summary>
    public string DueTimeText
    {
        get => _dueTimeText;
        set => SetProperty(ref _dueTimeText, value ?? string.Empty);
    }

    /// <summary>Высокая важность → importance=high, иначе normal.</summary>
    public bool IsHighImportance
    {
        get => _isHighImportance;
        set => SetProperty(ref _isHighImportance, value);
    }

    /// <summary>Название поручения (≤200; в пилоте — с обязательным префиксом).</summary>
    public string TitleText
    {
        get => _titleText;
        set => SetProperty(ref _titleText, value ?? string.Empty);
    }

    /// <summary>Описание поручения для исполнителя (≤2000).</summary>
    public string DescriptionText
    {
        get => _descriptionText;
        set => SetProperty(ref _descriptionText, value ?? string.Empty);
    }

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
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearDocumentCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearAssigneeCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearControllerCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string CreateButtonText => IsBusy ? "Создаём…" : "Создать в 1С";

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

    /// <summary>Прогресс async-команды: «Создаём…»/«Подтверждаем в 1С…»; null — скрыт.</summary>
    public string? CommandStatusText
    {
        get => _commandStatusText;
        private set
        {
            if (SetProperty(ref _commandStatusText, value))
            {
                OnPropertyChanged(nameof(IsCommandPending));
            }
        }
    }

    public bool IsCommandPending => _commandStatusText is not null;

    public ICommand CreateCommand { get; }
    public ICommand CloseCommand { get; }
    public ICommand SelectDocumentCommand { get; }
    public ICommand ClearDocumentCommand { get; }
    public ICommand SelectAssigneeCommand { get; }
    public ICommand ClearAssigneeCommand { get; }
    public ICommand SelectControllerCommand { get; }
    public ICommand ClearControllerCommand { get; }

    // ---- Предзагрузка справочника ----

    /// <summary>
    /// При открытии формы — как useEffect в веб-диалоге: один запрос q=''
    /// заполняет варианты и исполнителя, и контролёра (первые 20 записей).
    /// </summary>
    internal async Task PreloadAssigneesSafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            IsAssigneeSearchBusy = true;
            var list = await _api.SearchDocflowAssignmentAssigneesAsync(
                null, SearchLimit, cancellationToken);
            ReplaceAssigneeOptions(AssigneeOptions, list.Items);
            ReplaceAssigneeOptions(ControllerOptions, list.Items);
            var hint = HintOf(list.Reason, list.Truncated, "Показаны первые результаты — уточните ФИО.");
            AssigneeHintText = hint;
            ControllerHintText = hint;
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
            IsAssigneeSearchBusy = false;
        }
    }

    /// <summary>Фокус вернулся в поле исполнителя — показать справочник повторно.</summary>
    public void ReopenAssigneePopup() => IsAssigneePopupOpen = AssigneeOptions.Count > 0;

    /// <summary>Фокус вернулся в поле контролёра — показать справочник повторно.</summary>
    public void ReopenControllerPopup() => IsControllerPopupOpen = ControllerOptions.Count > 0;

    // ---- Поиск документа ----

    private void ScheduleDocumentSearch()
    {
        _documentSearchCancellation?.Cancel();
        _documentSearchCancellation?.Dispose();
        var query = _documentQuery.Trim();
        if (query.Length < DocumentSearchMinLength)
        {
            _documentSearchCancellation = null;
            IsDocumentPopupOpen = false;
            DocumentOptions.Clear();
            // Пустая строка — без подсказки; короткая — минимум символов, как в вебе.
            DocumentHintText = query.Length == 0
                ? null
                : $"Введите не менее {DocumentSearchMinLength} символов для поиска документов.";
            return;
        }

        DocumentHintText = null;
        var cancellation = new CancellationTokenSource();
        _documentSearchCancellation = cancellation;
        _ = SearchDocumentsSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchDocumentsSafelyAsync(string query, CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(SearchDebounce, cancellationToken);
            // Запрос уже сменился — результат устарел.
            if (!string.Equals(_documentQuery.Trim(), query, StringComparison.Ordinal))
            {
                return;
            }

            IsDocumentSearchBusy = true;
            var list = await _api.SearchDocflowAssignmentDocumentsAsync(
                query, SearchLimit, cancellationToken);
            if (!string.Equals(_documentQuery.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            DocumentOptions.Clear();
            foreach (var item in list.Items ?? [])
            {
                DocumentOptions.Add(new DocflowAssignmentDocumentOption(item));
            }

            DocumentHintText = HintOf(
                list.Reason,
                list.Truncated,
                "Показаны первые результаты — уточните название или номер.");
            IsDocumentPopupOpen = DocumentOptions.Count > 0;
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
            IsDocumentSearchBusy = false;
        }
    }

    // ---- Поиск исполнителя/контролёра ----

    private void ScheduleAssigneeSearch()
    {
        _assigneeSearchCancellation?.Cancel();
        _assigneeSearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _assigneeSearchCancellation = cancellation;
        var query = _assigneeQuery.Trim();
        _ = SearchAssigneesSafelyAsync(
            query,
            AssigneeOptions,
            () => _assigneeQuery.Trim(),
            busy => IsAssigneeSearchBusy = busy,
            hint => AssigneeHintText = hint,
            open => IsAssigneePopupOpen = open,
            cancellation.Token);
    }

    private void ScheduleControllerSearch()
    {
        _controllerSearchCancellation?.Cancel();
        _controllerSearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _controllerSearchCancellation = cancellation;
        var query = _controllerQuery.Trim();
        _ = SearchAssigneesSafelyAsync(
            query,
            ControllerOptions,
            () => _controllerQuery.Trim(),
            busy => IsControllerSearchBusy = busy,
            hint => ControllerHintText = hint,
            open => IsControllerPopupOpen = open,
            cancellation.Token);
    }

    /// <summary>Справочник assignees общий: debounce → запрос → замена вариантов.</summary>
    private async Task SearchAssigneesSafelyAsync(
        string query,
        ObservableCollection<DocflowAssigneeOption> options,
        Func<string> currentQuery,
        Action<bool> setBusy,
        Action<string?> applyHint,
        Action<bool> setPopupOpen,
        CancellationToken cancellationToken)
    {
        try
        {
            await _delayAsync(SearchDebounce, cancellationToken);
            // Запрос уже сменился — результат устарел.
            if (!string.Equals(currentQuery(), query, StringComparison.Ordinal))
            {
                return;
            }

            setBusy(true);
            var list = await _api.SearchDocflowAssignmentAssigneesAsync(
                query, SearchLimit, cancellationToken);
            if (!string.Equals(currentQuery(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            ReplaceAssigneeOptions(options, list.Items);
            applyHint(HintOf(list.Reason, list.Truncated, "Показаны первые результаты — уточните ФИО."));
            setPopupOpen(options.Count > 0);
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
            setBusy(false);
        }
    }

    private static void ReplaceAssigneeOptions(
        ObservableCollection<DocflowAssigneeOption> options,
        IReadOnlyList<HubDocflowAssignmentAssignee>? items)
    {
        options.Clear();
        foreach (var item in items ?? [])
        {
            options.Add(new DocflowAssigneeOption(item));
        }
    }

    private static string? HintOf(string? reason, bool truncated, string truncatedText) =>
        !string.IsNullOrWhiteSpace(reason)
            ? reason.Trim()
            : truncated ? truncatedText : null;

    // ---- Отправка ----

    internal async Task SubmitAsync(CancellationToken cancellationToken)
    {
        if (IsBusy)
        {
            return;
        }

        ErrorText = null;
        var document = SelectedDocument;
        var assignee = SelectedAssignee;
        if (document is null || document.Ref.Length == 0 || document.DocumentType.Length == 0)
        {
            ErrorText = "Выберите документ 1С из списка поиска.";
            return;
        }

        if (assignee is null || assignee.Ref.Length == 0)
        {
            ErrorText = "Выберите исполнителя из справочника.";
            return;
        }

        if (!TryBuildDueAt(out var dueAt))
        {
            ErrorText = "Укажите дату и время срока исполнения.";
            return;
        }

        if (dueAt <= DateTime.Now)
        {
            ErrorText = "Срок исполнения должен быть в будущем.";
            return;
        }

        var title = TitleText.Trim();
        if (!IsTitleValid(title))
        {
            ErrorText = TestOnly
                ? $"Название должно начинаться с «{RequiredTitlePrefix}» и содержать текст после префикса."
                : "Укажите название поручения.";
            return;
        }

        var description = DescriptionText.Trim();
        if (description.Length == 0)
        {
            ErrorText = "Добавьте описание для исполнителя.";
            return;
        }

        if (description.Length > DescriptionMaxLength)
        {
            ErrorText = "Описание не длиннее 2000 символов.";
            return;
        }

        IsBusy = true;
        CommandStatusText = "Создаём поручение в 1С…";
        try
        {
            var result = await _api.CreateDocflowAssignmentAsync(
                new HubDocflowAssignmentCreateRequest
                {
                    DocumentType = document.DocumentType,
                    DocumentRef = document.Ref,
                    AssigneeRef = assignee.Ref,
                    ControllerRef = string.IsNullOrWhiteSpace(SelectedController?.Ref)
                        ? null
                        : SelectedController.Ref,
                    DueAt = dueAt,
                    Importance = IsHighImportance ? "high" : "normal",
                    Title = title,
                    Description = description,
                },
                _idempotencyKey,
                cancellationToken);
            await HandleResultAsync(result, cancellationToken);
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
            CommandStatusText = null;
            IsBusy = false;
        }
    }

    /// <summary>Разбор DocflowAssignmentCommandResponse из POST и GET …/commands/{id}.</summary>
    private async Task HandleResultAsync(
        HubDocflowAssignmentCommandResult result,
        CancellationToken cancellationToken)
    {
        switch (result.Status)
        {
            case "applied":
            case "already_applied":
                Created?.Invoke(this, new DocflowAssignmentCreatedEventArgs(result));
                break;
            case "rejected":
                ErrorText = "1С отклонила создание поручения. Проверьте поля и повторите.";
                break;
            case "pending":
            case "state_unknown":
                await PollAssignmentCommandAsync(result.CommandId, cancellationToken);
                break;
            default:
                ErrorText = "1С вернула неожиданный статус команды. Повторите создание позже.";
                break;
        }
    }

    /// <summary>Опрос GET /assignments/commands/{id}: 750мс → шаг 2с до терминала или ~30с.</summary>
    private async Task PollAssignmentCommandAsync(
        string? commandId,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(commandId))
        {
            ErrorText = "1С не вернула идентификатор команды. Повторите создание.";
            return;
        }

        var deadline = DateTime.UtcNow + CommandPollTimeout;
        for (var attempt = 0; attempt < CommandMaxAttempts; attempt++)
        {
            CommandStatusText = "Подтверждаем создание в 1С…";
            await _delayAsync(
                attempt == 0 ? CommandInitialDelay : CommandPollInterval,
                cancellationToken);
            var result = await _api.GetDocflowAssignmentCommandAsync(commandId, cancellationToken);
            if (result.Status is "applied" or "already_applied" or "rejected")
            {
                await HandleResultAsync(result, cancellationToken);
                return;
            }

            if (DateTime.UtcNow >= deadline)
            {
                break;
            }
        }

        // Поручение могло создаться — повторная отправка идёт с тем же
        // Idempotency-Key и вернёт ту же команду, поэтому «Создать в 1С» безопасна.
        ErrorText = "1С долго не подтверждает создание поручения. Проверьте результат позже — обновите страницу.";
    }

    /// <summary>Дата + «ЧЧ:мм» → локальный naive datetime (как datetime-local в вебе).</summary>
    private bool TryBuildDueAt(out DateTime dueAt)
    {
        dueAt = default;
        if (DueDate is not { } date)
        {
            return false;
        }

        var time = DueTimeText.Trim();
        if (time.Length == 0
            || (!TimeSpan.TryParse(time, CultureInfo.CurrentCulture, out var parsed)
                && !TimeSpan.TryParse(time, CultureInfo.InvariantCulture, out parsed))
            || parsed < TimeSpan.Zero
            || parsed >= TimeSpan.FromDays(1))
        {
            return false;
        }

        dueAt = date.Date.Add(parsed);
        return true;
    }

    /// <summary>Пилот: префикс без учёта регистра (как backend) + текст после него (как веб).</summary>
    private bool IsTitleValid(string title)
    {
        if (title.Length == 0 || title.Length > TitleMaxLength)
        {
            return false;
        }

        return !TestOnly
            || (title.StartsWith(RequiredTitlePrefix, StringComparison.OrdinalIgnoreCase)
                && title.Length > RequiredTitlePrefix.Length);
    }
}

/// <summary>
/// Карточка задания 1С: реквизиты, описание, связанные документы, файлы
/// и панель действий (комментарий + POST /actions + опрос команды).
/// </summary>
public sealed class DocflowTaskDetailViewModel : ObservableObject
{
    private bool _isActionBusy;
    private string? _actionComment;
    private string? _commandStatusText;
    private bool _requiresDigitalSignature;

    public DocflowTaskDetailViewModel(HubDocflowTaskDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
        Files = [];
        Actions = [];
        RelatedItems = [];
        Update(detail);
    }

    public string Ref { get; private set; } = string.Empty;
    public string Title { get; private set; } = string.Empty;
    public string? StatusText { get; private set; }
    public string StatusTone { get; private set; } = HubStatusTone.Success;
    public string TypeLabel { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public string AuthorText { get; private set; } = string.Empty;
    public string CreatedText { get; private set; } = string.Empty;
    public string DueText { get; private set; } = string.Empty;
    public string CompletedText { get; private set; } = string.Empty;
    public string ResultText { get; private set; } = string.Empty;
    public string ProcessText { get; private set; } = string.Empty;
    public string NumberText { get; private set; } = string.Empty;
    public string SubjectText { get; private set; } = string.Empty;
    public string BusinessStateText { get; private set; } = string.Empty;
    public string? StateToken { get; private set; }
    public string ActionUnavailableReasonText { get; private set; } = string.Empty;
    public string OpenIn1cUrl { get; private set; } = string.Empty;
    public bool FilesIncomplete { get; private set; }
    public bool Completed { get; private set; }

    public ObservableCollection<DocflowFileItemViewModel> Files { get; }
    public ObservableCollection<DocflowActionItemViewModel> Actions { get; }
    public ObservableCollection<DocflowRelatedItemViewModel> RelatedItems { get; }

    public bool HasFiles => Files.Count > 0;
    public bool HasActions => Actions.Count > 0;
    public bool HasRelated => RelatedItems.Count > 0;
    public bool HasOpenIn1c => OpenIn1cUrl.Length > 0;
    public bool IsCommandPending => _commandStatusText is not null;
    public bool HasCommandStatus => _commandStatusText?.Length > 0;
    public bool ActionsEnabled => HasActions && !IsActionBusy && !IsCommandPending;
    public bool CanRunActions => ActionsEnabled;

    /// <summary>Для задания требуется ЭП — действие выполняют в 1С.</summary>
    public bool RequiresDigitalSignature
    {
        get => _requiresDigitalSignature;
        private set
        {
            if (SetProperty(ref _requiresDigitalSignature, value))
            {
                OnPropertyChanged(nameof(ActionsEnabled));
                OnPropertyChanged(nameof(CanRunActions));
            }
        }
    }

    /// <summary>Комментарий к действию (обязателен для comment_mode=required).</summary>
    public string? ActionComment
    {
        get => _actionComment;
        set => SetProperty(ref _actionComment, value);
    }

    /// <summary>Идёт POST /actions или опрос команды — кнопки действий блокируются.</summary>
    public bool IsActionBusy
    {
        get => _isActionBusy;
        set
        {
            if (SetProperty(ref _isActionBusy, value))
            {
                OnPropertyChanged(nameof(ActionsEnabled));
                OnPropertyChanged(nameof(CanRunActions));
            }
        }
    }

    /// <summary>Прогресс async-команды: «Выполняем…»/«Подтверждаем в 1С…»; null — скрыт.</summary>
    public string? CommandStatusText
    {
        get => _commandStatusText;
        set
        {
            if (SetProperty(ref _commandStatusText, value))
            {
                OnPropertyChanged(nameof(IsCommandPending));
                OnPropertyChanged(nameof(HasCommandStatus));
                OnPropertyChanged(nameof(ActionsEnabled));
                OnPropertyChanged(nameof(CanRunActions));
            }
        }
    }

    public void Update(HubDocflowTaskDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
        Ref = detail.Ref ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(detail.Title) ? "Без названия" : detail.Title!;
        var overdue = !detail.Completed && DocflowTaskListItemViewModel.IsOverdue(detail.DueAt);
        StatusText = detail.Completed
            ? "Завершено"
            : detail.Accepted == true ? "Принято в работу" : "Новое";
        StatusTone = detail.Completed
            ? HubStatusTone.Success
            : overdue ? HubStatusTone.Danger : HubStatusTone.Info;
        TypeLabel = detail.TaskTypeLabel ?? string.Empty;
        Description = detail.Description ?? string.Empty;
        AuthorText = detail.Author ?? string.Empty;
        CreatedText = DocflowTaskListItemViewModel.FormatDateTime(detail.CreatedAt);
        DueText = DocflowTaskListItemViewModel.FormatDateTime(detail.DueAt);
        CompletedText = DocflowTaskListItemViewModel.FormatDateTime(detail.CompletedAt);
        ResultText = detail.Result ?? string.Empty;
        ProcessText = detail.ProcessTypeLabel ?? detail.ProcessName ?? string.Empty;
        NumberText = detail.Number ?? string.Empty;
        SubjectText = detail.Subject ?? string.Empty;
        BusinessStateText = detail.BusinessState ?? string.Empty;
        StateToken = detail.StateToken;
        ActionUnavailableReasonText = detail.ActionUnavailableReason ?? string.Empty;
        OpenIn1cUrl = detail.OpenIn1cUrl ?? string.Empty;
        FilesIncomplete = detail.FilesIncomplete;
        RequiresDigitalSignature = detail.RequiresDigitalSignature;
        Completed = detail.Completed;

        Files.Clear();
        foreach (var file in detail.Files ?? [])
        {
            Files.Add(new DocflowFileItemViewModel(file));
        }

        Actions.Clear();
        foreach (var action in detail.AvailableActions ?? [])
        {
            Actions.Add(new DocflowActionItemViewModel(action));
        }

        RelatedItems.Clear();
        foreach (var related in detail.RelatedObjects ?? [])
        {
            RelatedItems.Add(new DocflowRelatedItemViewModel(related));
        }

        ActionComment = null;
        OnPropertyChanged(string.Empty);
    }

    /// <summary>Оптимистичная отметка выполнения, когда команда не вернула обновлённую карточку.</summary>
    public void MarkCompleted()
    {
        Completed = true;
        StatusText = "Завершено";
        StatusTone = HubStatusTone.Success;
        Actions.Clear();
        StateToken = null;
        OnPropertyChanged(nameof(Completed));
        OnPropertyChanged(nameof(StatusText));
        OnPropertyChanged(nameof(StatusTone));
        OnPropertyChanged(nameof(HasActions));
        OnPropertyChanged(nameof(ActionsEnabled));
        OnPropertyChanged(nameof(CanRunActions));
    }
}

/// <summary>
/// Страница «Документооборот 1С» нативного шелла: список заданий с табами
/// scope (Входящие/Завершённые/Все), серверный поиск с debounce, offset-пагинация,
/// карточка задания с файлами и действиями (async-команды с опросом /commands),
/// подсказка «подключите 1С в веб-портале», когда креденшелсы не настроены.
/// </summary>
public sealed class DocflowViewModel : ObservableObject
{
    /// <summary>Размер страницы списка (backend допускает 1..100).</summary>
    private const int PageSize = 50;

    /// <summary>Debounce серверного поиска — как UserSearchDebounce у чата.</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(400);

    /// <summary>Пауза перед первым опросом команды — как 750мс в вебе.</summary>
    private static readonly TimeSpan CommandInitialDelay = TimeSpan.FromMilliseconds(750);

    /// <summary>Шаг опроса GET /commands/{id} между попытками.</summary>
    private static readonly TimeSpan CommandPollInterval = TimeSpan.FromSeconds(2);

    /// <summary>Потолок опроса команды (~30с по требованию среза).</summary>
    private static readonly TimeSpan CommandPollTimeout = TimeSpan.FromSeconds(30);

    /// <summary>Страховочный предел попыток опроса (при заменённом DelayAsync в тестах).</summary>
    private const int CommandMaxAttempts = 20;

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private CancellationTokenSource? _searchCancellation;

    /// <summary>Файлы, которые скачиваются прямо сейчас — второй клик не дублирует запрос.</summary>
    private readonly HashSet<string> _fileDownloadsInFlight = new(StringComparer.Ordinal);

    private string _scope = "inbox";
    private DocflowTaskListItemViewModel? _selectedItem;
    private DocflowTaskDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int? _total;
    private int _nextOffset;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string? _statusInfoText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;
    private int _inboxCount;
    private bool _showSetupHint;
    private string _setupHintText = string.Empty;
    private DocflowAssignmentCreateViewModel? _assignmentForm;
    private HubDocflowAssignmentCapability? _assignmentCapability;
    private bool _canCreateAssignment;
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight realtime-загрузки.</summary>
    private int _loadEpoch;
    private HubDocflowProfile? _profile;
    private DocflowCredentialFormViewModel? _credentialForm;
    private string _profileStatusText = string.Empty;
    private string _profileStatusTone = HubStatusTone.Muted;
    private string _profileLoginText = string.Empty;
    private string _profileButtonText = "Подключить 1С";
    private bool _isProfileChipVisible;
    private bool _canShowAbsences;
    private bool _isAbsencesOpen;
    private bool _isAbsencesLoading;
    private bool _absencesLoaded;
    private string? _absencesInfoText;
    private string _absencesZupNoteText = string.Empty;

    public DocflowViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectScopeCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                Scope = NormalizeScope(parameter as string);
                Detail = null;
                SelectedItem = null;
                await LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        RunActionCommand = new NativeAsyncCommand(
            (parameter, ct) => RunActionAsync(parameter as DocflowActionItemViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanRunActions: true });
        OpenFileCommand = new NativeAsyncCommand(
            (parameter, _) => OpenFileAsync(parameter as DocflowFileItemViewModel),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is DocflowFileItemViewModel { IsDownloading: false });
        OpenIn1cCommand = new NativeRelayCommand(
            () => OpenIn1c(),
            () => Detail is { HasOpenIn1c: true });
        NewAssignmentCommand = new NativeRelayCommand(
            () => OpenAssignmentForm(),
            () => CanCreateAssignment);
        OpenCredentialFormCommand = new NativeRelayCommand(() => OpenCredentialForm());
        ToggleAbsencesCommand = new NativeRelayCommand(() => ToggleAbsences());
        RefreshAbsencesCommand = new NativeAsyncCommand(
            (_, ct) => LoadAbsencesSafelyAsync(ct),
            ex => AbsencesInfoText = TasksViewModel.DescribeError(ex),
            _ => CanShowAbsences && !IsAbsencesLoading);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        DismissStatusCommand = new NativeRelayCommand(() => StatusInfoText = null);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(MoreButtonText));
        };
    }

    // ---- Список ----

    public ObservableCollection<DocflowTaskListItemViewModel> Items { get; } = [];

    public DocflowTaskListItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.Ref);
            }
        }
    }

    public DocflowTaskDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
                ((NativeAsyncCommand)RunActionCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)OpenIn1cCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите задание» — ни карточки, ни загрузки деталей.</summary>
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

    /// <summary>Текущий scope списка: inbox|completed|all.</summary>
    public string Scope
    {
        get => _scope;
        private set
        {
            if (SetProperty(ref _scope, NormalizeScope(value)))
            {
                OnPropertyChanged(nameof(IsScopeInbox));
                OnPropertyChanged(nameof(IsScopeCompleted));
                OnPropertyChanged(nameof(IsScopeAll));
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectScopeCommand.
    /// <summary>Scope «Входящие» — активные задания на согласование/выполнение.</summary>
    public bool IsScopeInbox
    {
        get => Scope == "inbox";
        set => ApplyScopeFromUi("inbox", value);
    }

    /// <summary>Scope «Завершённые».</summary>
    public bool IsScopeCompleted
    {
        get => Scope == "completed";
        set => ApplyScopeFromUi("completed", value);
    }

    /// <summary>Scope «Все» — активные и завершённые вместе.</summary>
    public bool IsScopeAll
    {
        get => Scope == "all";
        set => ApplyScopeFromUi("all", value);
    }

    private void ApplyScopeFromUi(string scope, bool isChecked)
    {
        if (isChecked && Scope != scope)
        {
            SelectScopeCommand.Execute(scope);
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

    /// <summary>На сервере есть ещё задания за пределами выдачи (has_more из ответа).</summary>
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

    /// <summary>Подпись кнопки «Показать ещё» с остатком, когда total известен.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : _total is int total
            ? $"Показать ещё ({Math.Max(0, total - Items.Count)})"
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

    /// <summary>Инфо-плашка (результат действия/команды) — зелёная, закрываемая.</summary>
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

    /// <summary>Счётчик входящих для бейджа в навигации шелла.</summary>
    public int InboxCount
    {
        get => _inboxCount;
        private set => SetProperty(ref _inboxCount, value);
    }

    /// <summary>Креденшелсы 1С не настроены — вместо списка подсказка про веб-портал.</summary>
    public bool ShowSetupHint
    {
        get => _showSetupHint;
        private set
        {
            if (SetProperty(ref _showSetupHint, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
            }
        }
    }

    public string SetupHintText
    {
        get => _setupHintText;
        private set => SetProperty(ref _setupHintText, value);
    }

    /// <summary>Пустая выдача без ошибки, загрузки и состояния «не настроено».</summary>
    public bool IsEmpty =>
        !IsLoading && !ShowSetupHint && Items.Count == 0 && !HasBannerError;

    // ---- Форма поручения (оверлей поверх карточки, как у заявок) ----

    /// <summary>Открытая панель «Новое поручение»; null — скрыта.</summary>
    public DocflowAssignmentCreateViewModel? AssignmentForm
    {
        get => _assignmentForm;
        private set
        {
            if (SetProperty(ref _assignmentForm, value))
            {
                OnPropertyChanged(nameof(IsAssignmentFormOpen));
            }
        }
    }

    public bool IsAssignmentFormOpen => AssignmentForm is not null;

    /// <summary>
    /// Backend разрешил создание поручений (assignments/capability.enabled) —
    /// иначе кнопка «＋ Поручение» скрыта, как в вебе без права CREATE.
    /// </summary>
    public bool CanCreateAssignment
    {
        get => _canCreateAssignment;
        private set
        {
            if (SetProperty(ref _canCreateAssignment, value))
            {
                ((NativeRelayCommand)NewAssignmentCommand).RaiseCanExecuteChanged();
            }
        }
    }

    // ---- Учётная запись 1С (профиль кредов) ----

    /// <summary>Открытая панель «Учётная запись 1С»; null — скрыта.</summary>
    public DocflowCredentialFormViewModel? CredentialForm
    {
        get => _credentialForm;
        private set
        {
            if (SetProperty(ref _credentialForm, value))
            {
                OnPropertyChanged(nameof(IsCredentialFormOpen));
            }
        }
    }

    public bool IsCredentialFormOpen => CredentialForm is not null;

    /// <summary>Подпись статуса подключения (как PROFILE_STATUS в вебе).</summary>
    public string ProfileStatusText
    {
        get => _profileStatusText;
        private set => SetProperty(ref _profileStatusText, value);
    }

    /// <summary>Тон пилюли статуса: valid→success, invalid→danger, unavailable→warning.</summary>
    public string ProfileStatusTone
    {
        get => _profileStatusTone;
        private set => SetProperty(ref _profileStatusTone, value);
    }

    /// <summary>Пилюля показана, когда профиль загружен и креды сохранены.</summary>
    public bool IsProfileChipVisible
    {
        get => _isProfileChipVisible;
        private set => SetProperty(ref _isProfileChipVisible, value);
    }

    /// <summary>Логин 1С под пилюлей («пользователь 1С», если пусто).</summary>
    public string ProfileLoginText
    {
        get => _profileLoginText;
        private set => SetProperty(ref _profileLoginText, value);
    }

    /// <summary>Подпись кнопки открытия панели кредов: «1С · логин» либо «Подключить 1С».</summary>
    public string ProfileButtonText
    {
        get => _profileButtonText;
        private set => SetProperty(ref _profileButtonText, value);
    }

    // ---- Отсутствия из 1С (справочник /docflow/absences на сегодня) ----

    /// <summary>Записи об отсутствиях сегодня (имя, вид, период, флаг «разбирает задачи»).</summary>
    public ObservableCollection<DocflowAbsenceItemViewModel> Absences { get; } = [];

    /// <summary>
    /// Панель доступна: креды настроены и фича не выключена на backend
    /// (status=disabled прячет блок целиком, как DocflowAbsencesPanel в вебе).
    /// </summary>
    public bool CanShowAbsences
    {
        get => _canShowAbsences;
        private set
        {
            if (SetProperty(ref _canShowAbsences, value))
            {
                OnPropertyChanged(nameof(AbsencesHeaderVisible));
                ((NativeAsyncCommand)RefreshAbsencesCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Заголовок «Отсутствия» виден при CanShowAbsences.</summary>
    public bool AbsencesHeaderVisible => CanShowAbsences;

    /// <summary>Панель развёрнута — первый разворот лениво грузит список.</summary>
    public bool IsAbsencesOpen
    {
        get => _isAbsencesOpen;
        private set
        {
            if (SetProperty(ref _isAbsencesOpen, value))
            {
                OnPropertyChanged(nameof(AbsencesChevron));
            }
        }
    }

    /// <summary>Шеврон-индикатор свёрнутости панели.</summary>
    public string AbsencesChevron => IsAbsencesOpen ? "▾" : "▸";

    public bool IsAbsencesLoading
    {
        get => _isAbsencesLoading;
        private set
        {
            if (SetProperty(ref _isAbsencesLoading, value))
            {
                ((NativeAsyncCommand)RefreshAbsencesCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Сообщение вместо списка: пусто на сегодня, недоступно или ошибка.</summary>
    public string? AbsencesInfoText
    {
        get => _absencesInfoText;
        private set
        {
            if (SetProperty(ref _absencesInfoText, value))
            {
                OnPropertyChanged(nameof(HasAbsencesInfo));
            }
        }
    }

    public bool HasAbsencesInfo => !string.IsNullOrEmpty(AbsencesInfoText);

    /// <summary>«Сравнение с ЗУП недоступно…» — когда backend не смог сверить кэш.</summary>
    public string AbsencesZupNoteText
    {
        get => _absencesZupNoteText;
        private set
        {
            if (SetProperty(ref _absencesZupNoteText, value))
            {
                OnPropertyChanged(nameof(HasAbsencesZupNote));
            }
        }
    }

    public bool HasAbsencesZupNote => !string.IsNullOrEmpty(AbsencesZupNoteText);

    public ICommand RefreshCommand { get; }
    public ICommand SelectScopeCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand RunActionCommand { get; }
    public ICommand OpenFileCommand { get; }
    public ICommand OpenIn1cCommand { get; }
    public ICommand NewAssignmentCommand { get; }
    public ICommand OpenCredentialFormCommand { get; }
    public ICommand ToggleAbsencesCommand { get; }
    public ICommand RefreshAbsencesCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand DismissStatusCommand { get; }

    /// <summary>
    /// Шов сохранения/открытия файла (как AttachmentSaver у почты): тесты заменяют
    /// потоковое скачивание в %TEMP% + Process.Start. Аргументы — чип и ref задания.
    /// </summary>
    public Func<DocflowFileItemViewModel, string, Task>? FileSaver { get; set; }

    /// <summary>
    /// Шов ожидания (debounce поиска и опрос команд): тесты ставят мгновенный.
    /// По умолчанию — Task.Delay.
    /// </summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Шов открытия URL («Открыть в 1С»): по умолчанию Process.Start оболочкой ОС.</summary>
    public Action<string>? UrlLauncher { get; set; }

    private static string NormalizeScope(string? scope) =>
        scope is "completed" or "all" ? scope : "inbox";

    private HubDocflowTaskQuery BuildQuery(int offset) => new()
    {
        Scope = Scope,
        Search = string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim(),
        Limit = PageSize,
        Offset = offset,
    };

    /// <summary>Первичная загрузка/обновление: профиль → список → сводка входящих.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var profile = await _api.GetDocflowProfileAsync(cancellationToken);
            ApplyProfile(profile);
            if (ShowSetupHint)
            {
                Items.Clear();
                HasMore = false;
                _total = null;
                _nextOffset = 0;
                InboxCount = 0;
                TotalText = string.Empty;
                Detail = null;
                SelectedItem = null;
                _assignmentCapability = null;
                CanCreateAssignment = false;
                BannerErrorText = null;
                return;
            }

            await LoadTasksPageAsync(offset: 0, replace: true, cancellationToken);
            await RefreshInboxSummarySafelyAsync(cancellationToken);
            await RefreshAssignmentCapabilitySafelyAsync(cancellationToken);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task LoadTasksPageAsync(
        int offset,
        bool replace,
        CancellationToken cancellationToken)
    {
        var page = await _api.GetDocflowTasksAsync(BuildQuery(offset), cancellationToken);
        if (replace)
        {
            Items.Clear();
        }

        _total = page.Total;
        _nextOffset = page.NextOffset ?? offset + (page.Items?.Count ?? 0);
        HasMore = page.HasMore;
        foreach (var item in page.Items ?? [])
        {
            Items.Add(new DocflowTaskListItemViewModel(item));
        }

        TotalText = _total?.ToString(CultureInfo.CurrentCulture)
            ?? Items.Count.ToString(CultureInfo.CurrentCulture);
    }

    /// <summary>Догрузка следующей страницы в конец списка («Показать ещё»).</summary>
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            await LoadTasksPageAsync(_nextOffset, replace: false, cancellationToken);
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    /// <summary>Debounce 400 мс: серверный поиск по текущему scope.</summary>
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

    private async Task LoadDetailSafelyAsync(string taskRef)
    {
        if (string.IsNullOrEmpty(taskRef))
        {
            return;
        }

        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetDocflowTaskAsync(
                taskRef, includeRelated: true, cancellation.Token);
            if (_selectedItem?.Ref != taskRef)
            {
                return;
            }

            if (Detail is null || Detail.Ref != taskRef)
            {
                Detail = new DocflowTaskDetailViewModel(detail);
            }
            else
            {
                Detail.Update(detail);
            }
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

    // ---- Действия (POST /actions + опрос /commands) ----

    private async Task RunActionAsync(
        DocflowActionItemViewModel? action,
        CancellationToken cancellationToken)
    {
        if (action is null || Detail is not { } detail || detail.IsActionBusy)
        {
            return;
        }

        var comment = detail.ActionComment?.Trim();
        if (action.CommentRequired && string.IsNullOrEmpty(comment))
        {
            DetailErrorText = "Без комментария действие выполнить нельзя.";
            return;
        }

        if (string.IsNullOrEmpty(detail.StateToken) || string.IsNullOrEmpty(action.Code))
        {
            DetailErrorText = "Карточка устарела. Обновите её и повторите действие.";
            return;
        }

        detail.IsActionBusy = true;
        DetailErrorText = null;
        StatusInfoText = null;
        detail.CommandStatusText = $"Выполняем: {action.Label}…";
        try
        {
            var result = await _api.ApplyDocflowTaskActionAsync(
                detail.Ref,
                action.Code,
                comment,
                detail.StateToken,
                Guid.NewGuid().ToString("N"),
                cancellationToken);
            await HandleCommandResultAsync(result, detail, cancellationToken);
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
            detail.CommandStatusText = null;
            detail.IsActionBusy = false;
        }
    }

    /// <summary>Разбор DocflowCommandResponse из POST /actions и GET /commands/{id}.</summary>
    private async Task HandleCommandResultAsync(
        HubDocflowCommandResult result,
        DocflowTaskDetailViewModel detail,
        CancellationToken cancellationToken)
    {
        switch (result.Status)
        {
            case "applied":
            case "already_applied":
                await ApplyCompletedAsync(result.Task, detail, cancellationToken);
                break;
            case "rejected":
                if (result.ErrorCode == "DOCFLOW_ACTION_NOT_APPLIED")
                {
                    // Действие не применилось — карточка из ответа уже свежая.
                    if (result.Task is { } freshTask)
                    {
                        detail.Update(freshTask);
                    }

                    DetailErrorText =
                        "1С не применила действие. Карточка обновлена — " +
                        "действие можно выполнить заново.";
                }
                else
                {
                    DetailErrorText =
                        "1С отклонила действие. Обновите карточку и при необходимости повторите.";
                    _ = RefreshDetailSafelyAsync(detail.Ref);
                }

                break;
            case "pending":
            case "state_unknown":
                await PollCommandAsync(result.CommandId, detail, cancellationToken);
                break;
            default:
                DetailErrorText = "1С вернула неожиданный статус команды. Обновите карточку.";
                break;
        }
    }

    /// <summary>Опрос GET /commands/{id}: 750мс → шаг 2с до терминала или ~30с.</summary>
    private async Task PollCommandAsync(
        string? commandId,
        DocflowTaskDetailViewModel detail,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(commandId))
        {
            DetailErrorText = "1С не вернула идентификатор команды. Обновите карточку.";
            return;
        }

        var deadline = DateTime.UtcNow + CommandPollTimeout;
        for (var attempt = 0; attempt < CommandMaxAttempts; attempt++)
        {
            detail.CommandStatusText = "Подтверждаем выполнение в 1С…";
            await DelayAsync(
                attempt == 0 ? CommandInitialDelay : CommandPollInterval,
                cancellationToken);
            var result = await _api.GetDocflowCommandAsync(commandId, cancellationToken);
            if (result.Status is "applied" or "already_applied" or "rejected")
            {
                await HandleCommandResultAsync(result, detail, cancellationToken);
                return;
            }

            if (DateTime.UtcNow >= deadline)
            {
                break;
            }
        }

        DetailErrorText =
            "1С долго не подтверждает действие. Проверьте результат позже — " +
            "обновите страницу.";
        _ = RefreshDetailSafelyAsync(detail.Ref);
    }

    /// <summary>
    /// Успешное выполнение: карточка и строка списка обновляются оптимистично
    /// (scope inbox → строка уходит, all → помечается, completed → догрузится),
    /// затем тихо перечитываем список и счётчик входящих.
    /// </summary>
    private async Task ApplyCompletedAsync(
        HubDocflowTaskDetail? completedTask,
        DocflowTaskDetailViewModel detail,
        CancellationToken cancellationToken)
    {
        detail.ActionComment = null;
        if (completedTask is not null)
        {
            detail.Update(completedTask);
        }
        else
        {
            detail.MarkCompleted();
        }

        var listItem = Items.FirstOrDefault(
            item => string.Equals(item.Ref, detail.Ref, StringComparison.OrdinalIgnoreCase));
        if (listItem is not null)
        {
            if (Scope == "inbox")
            {
                Items.Remove(listItem);
            }
            else
            {
                listItem.MarkCompleted();
            }
        }

        StatusInfoText = "1С подтвердила выполнение задания.";
        await RefreshAfterActionAsync(cancellationToken);
    }

    /// <summary>
    /// Тихое обновление по realtime-событию docflow.task.changed: первая страница
    /// списка, счётчик входящих (бейдж шелла) и открытая карточка — без
    /// IsLoading-индикатора и без сброса выбора. Серийная: события во время
    /// прохода сливаются в один повторный проход. Ошибки молчим — событие лишь
    /// подсказка, явное «Обновить» догонит состояние.
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
                    var page = await _api.GetDocflowTasksAsync(BuildQuery(0), cancellationToken);
                    if (epoch != _loadEpoch)
                    {
                        // Сессия сменилась (Reset) — чужие данные не применяем.
                        return;
                    }

                    Items.Clear();
                    _total = page.Total;
                    _nextOffset = page.NextOffset ?? (page.Items?.Count ?? 0);
                    HasMore = page.HasMore;
                    foreach (var item in page.Items ?? [])
                    {
                        Items.Add(new DocflowTaskListItemViewModel(item));
                    }

                    TotalText = _total?.ToString(CultureInfo.CurrentCulture)
                        ?? Items.Count.ToString(CultureInfo.CurrentCulture);
                }
                catch
                {
                    // Тихая подсказка realtime: баннер не трогаем, Refresh догонит позже.
                }

                if (epoch == _loadEpoch)
                {
                    await RefreshInboxSummarySafelyAsync(cancellationToken);
                    _ = RefreshDetailSafelyAsync(Detail?.Ref);
                }
            }
            while (_realtimeRefreshQueued);
        }
        finally
        {
            _realtimeRefreshInFlight = false;
        }
    }

    /// <summary>Тихое обновление списка/сводки/карточки после успешного действия.</summary>
    private async Task RefreshAfterActionAsync(CancellationToken cancellationToken)
    {
        try
        {
            await LoadTasksPageAsync(offset: 0, replace: true, cancellationToken);
        }
        catch
        {
            // Ошибка обновления не критична: список уже оптимистично обновлён.
        }

        await RefreshInboxSummarySafelyAsync(cancellationToken);
        _ = RefreshDetailSafelyAsync(Detail?.Ref);
    }

    /// <summary>Best-effort GET /inbox-summary: сбой счётчика не должен ломать страницу.</summary>
    private async Task RefreshInboxSummarySafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var summary = await _api.GetDocflowInboxSummaryAsync(cancellationToken);
            InboxCount = summary.Status == "available" ? summary.Count ?? 0 : 0;
        }
        catch
        {
            // Счётчик остаётся прежним — следующий refresh поднимет его снова.
        }
    }

    /// <summary>
    /// Best-effort GET /assignments/capability: без права CREATE или при ошибке
    /// проверки кнопка «＋ Поручение» остаётся скрытой.
    /// </summary>
    private async Task RefreshAssignmentCapabilitySafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            _assignmentCapability = await _api.GetDocflowAssignmentCapabilityAsync(cancellationToken);
            CanCreateAssignment = _assignmentCapability.Enabled;
        }
        catch
        {
            _assignmentCapability = null;
            CanCreateAssignment = false;
        }
    }

    // ---- Создание поручения ----

    /// <summary>
    /// «＋ Поручение»: форма поверх карточки. Повторный клик при открытой форме
    /// не пересоздаёт её — введённые поля не теряются (паттерн заявок).
    /// </summary>
    private void OpenAssignmentForm()
    {
        if (AssignmentForm is not null || _assignmentCapability is not { Enabled: true })
        {
            return;
        }

        var form = new DocflowAssignmentCreateViewModel(_api, _assignmentCapability, DelayAsync);
        form.Created += AssignmentForm_Created;
        form.Closed += AssignmentForm_Closed;
        AssignmentForm = form;
        // Как в веб-диалоге: справочник исполнителей подгружается при открытии (q='').
        _ = form.PreloadAssigneesSafelyAsync(CancellationToken.None);
    }

    /// <summary>1С подтвердила поручение: закрыть форму, перечитать список и счётчик.</summary>
    private async void AssignmentForm_Created(object? sender, DocflowAssignmentCreatedEventArgs e)
    {
        AssignmentForm = null;
        var processRef = (e.Result.Assignment?.ProcessRef ?? string.Empty).Trim();
        var taskRef = (e.Result.Assignment?.TaskRef ?? string.Empty).Trim();
        StatusInfoText = processRef.Length == 0
            ? "1С подтвердила создание поручения."
            : $"1С подтвердила создание поручения. Процесс: {processRef}"
                + (taskRef.Length == 0 ? string.Empty : $" · задание: {taskRef}");
        try
        {
            await LoadTasksPageAsync(offset: 0, replace: true, CancellationToken.None);
        }
        catch
        {
            // Новое поручение подтянется при следующем явном refresh.
        }

        await RefreshInboxSummarySafelyAsync(CancellationToken.None);
    }

    private void AssignmentForm_Closed(object? sender, EventArgs e)
    {
        AssignmentForm = null;
    }

    /// <summary>Best-effort перечитывание карточки (после rejected/таймаута опроса).</summary>
    private async Task RefreshDetailSafelyAsync(string? taskRef)
    {
        if (string.IsNullOrEmpty(taskRef) || Detail is null)
        {
            return;
        }

        try
        {
            var detail = await _api.GetDocflowTaskAsync(
                taskRef, includeRelated: true, CancellationToken.None);
            if (Detail is { } current && current.Ref == detail.Ref)
            {
                current.Update(detail);
            }
        }
        catch
        {
            // Карточка останется прежней; явное «Обновить» поднимет её.
        }
    }

    // ---- Файлы ----

    /// <summary>Чип файла нажат: скачиваем в %TEMP%/hub-desktop/docflow и открываем ОС.</summary>
    private async Task OpenFileAsync(DocflowFileItemViewModel? item)
    {
        var taskRef = Detail?.Ref;
        if (item is null || string.IsNullOrEmpty(taskRef) || string.IsNullOrEmpty(item.Ref))
        {
            return;
        }

        var downloadKey = taskRef + ":" + item.Ref;
        if (!_fileDownloadsInFlight.Add(downloadKey))
        {
            // Уже качается — второй FileStream на том же target дал бы «файл занят».
            return;
        }

        item.IsDownloading = true;
        try
        {
            if (FileSaver is not null)
            {
                await FileSaver(item, taskRef);
                return;
            }

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "docflow");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "document.bin";
            }

            var usePreview = item.PreviewSupported;
            var target = Path.Combine(
                directory,
                usePreview ? $"{item.Ref}-preview-{safeName}" : $"{item.Ref}-{safeName}");
            // Для preview размер PDF заранее неизвестен — кэшируем по самому факту файла.
            var cached = usePreview
                ? File.Exists(target)
                : File.Exists(target) && new FileInfo(target).Length == item.Model.Size;
            if (!cached)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = usePreview
                    ? await _api.DownloadDocflowFilePreviewAsync(
                        taskRef, item.Ref, destination, CancellationToken.None)
                    : await _api.DownloadDocflowFileAsync(
                        taskRef, item.Ref, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName))
                {
                    var prefix = usePreview ? $"{item.Ref}-preview-" : $"{item.Ref}-";
                    var renamed = Path.Combine(directory, prefix + downloadedName);
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
            _fileDownloadsInFlight.Remove(downloadKey);
        }
    }

    /// <summary>«Открыть в 1С» — open_in_1c_url в браузере/клиенте ОС.</summary>
    private void OpenIn1c()
    {
        var url = Detail?.OpenIn1cUrl;
        if (string.IsNullOrWhiteSpace(url))
        {
            return;
        }

        try
        {
            if (UrlLauncher is not null)
            {
                UrlLauncher(url);
            }
            else
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    // ---- Служебное ----

    private void ApplyProfile(HubDocflowProfile? profile)
    {
        _profile = profile;
        var configured = profile is not null
            && (profile.Configured || profile.Status is "configured" or "valid");
        if (!configured)
        {
            ShowSetupHint = true;
            SetupHintText =
                "Введите логин и пароль 1С — загрузятся только назначенные вам задания. " +
                "Можно и в веб-версии HUB (раздел «Документы»), затем обновите страницу здесь.";
            ProfileStatusText = "Не подключено";
            ProfileStatusTone = HubStatusTone.Muted;
            IsProfileChipVisible = false;
            ProfileLoginText = string.Empty;
            ProfileButtonText = "Подключить 1С";
            ClearAbsencesState();
            return;
        }

        ShowSetupHint = false;
        SetupHintText = string.Empty;
        var (statusText, tone) = profile!.Status switch
        {
            "valid" => ("Подключено", HubStatusTone.Success),
            "invalid" => ("Неверные данные", HubStatusTone.Danger),
            "unavailable" => ("1С недоступна", HubStatusTone.Warning),
            _ => ("Настроено", HubStatusTone.Info),
        };
        ProfileStatusText = statusText;
        ProfileStatusTone = tone;
        IsProfileChipVisible = true;
        var login = (profile.Login ?? string.Empty).Trim();
        ProfileLoginText = login.Length > 0 ? login : "пользователь 1С";
        ProfileButtonText = $"1С · {ProfileLoginText}";
        // Профиль есть — панель отсутствий доступна, пока backend не ответит disabled.
        CanShowAbsences = true;
    }

    // ---- Учётная запись 1С: панель кредов ----

    /// <summary>
    /// «Подключить 1С»/«1С · логин»: форма поверх карточки, как панель поручения.
    /// Повторный клик при открытой форме не пересоздаёт её — введённые поля целы.
    /// </summary>
    private void OpenCredentialForm()
    {
        if (CredentialForm is not null)
        {
            return;
        }

        var form = new DocflowCredentialFormViewModel(_api, _profile);
        form.Saved += CredentialForm_Saved;
        form.Disconnected += CredentialForm_Disconnected;
        form.Closed += CredentialForm_Closed;
        CredentialForm = form;
    }

    /// <summary>Креды сохранены: закрыть форму и перечитать профиль+список целиком.</summary>
    private async void CredentialForm_Saved(object? sender, DocflowProfileSavedEventArgs e)
    {
        CredentialForm = null;
        ApplyProfile(e.Profile);
        _absencesLoaded = false;
        StatusInfoText = "Учётная запись 1С сохранена.";
        try
        {
            await LoadTasksPageAsync(offset: 0, replace: true, CancellationToken.None);
        }
        catch
        {
            // Список подтянется при следующем явном refresh.
        }

        await RefreshInboxSummarySafelyAsync(CancellationToken.None);
        await RefreshAssignmentCapabilitySafelyAsync(CancellationToken.None);
        if (IsAbsencesOpen)
        {
            await LoadAbsencesSafelyAsync(CancellationToken.None);
        }
    }

    /// <summary>
    /// Креды удалены: как removeCredentials в вебе — чистим список/карточку/кэш
    /// и возвращаем состояние «не подключено» (setup-подсказка поверх области).
    /// </summary>
    private void CredentialForm_Disconnected(object? sender, EventArgs e)
    {
        CredentialForm = null;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        AssignmentForm = null;
        _assignmentCapability = null;
        CanCreateAssignment = false;
        _total = null;
        _nextOffset = 0;
        HasMore = false;
        InboxCount = 0;
        TotalText = string.Empty;
        ApplyProfile(new HubDocflowProfile { Configured = false, Status = "not_configured" });
        StatusInfoText = "Учётная запись 1С отключена.";
    }

    private void CredentialForm_Closed(object? sender, EventArgs e)
    {
        CredentialForm = null;
    }

    // ---- Отсутствия из 1С ----

    /// <summary>Разворот/сворачивание панели; первый разворот грузит список.</summary>
    private void ToggleAbsences()
    {
        if (!CanShowAbsences)
        {
            return;
        }

        IsAbsencesOpen = !IsAbsencesOpen;
        if (IsAbsencesOpen && !_absencesLoaded)
        {
            _ = LoadAbsencesSafelyAsync(CancellationToken.None);
        }
    }

    /// <summary>
    /// GET /docflow/absences на сегодня: disabled прячет блок, прочие статусы
    /// и ошибки — строкой в панели (как Alert в веб-панели), список не трогаем
    /// до успешной выдачи.
    /// </summary>
    private async Task LoadAbsencesSafelyAsync(CancellationToken cancellationToken)
    {
        IsAbsencesLoading = true;
        try
        {
            var list = await _api.GetDocflowAbsencesAsync(null, null, cancellationToken);
            if (list.Status is "disabled")
            {
                ClearAbsencesState();
                return;
            }

            Absences.Clear();
            foreach (var item in list.Items ?? [])
            {
                Absences.Add(new DocflowAbsenceItemViewModel(item));
            }

            AbsencesInfoText = list.Status is "available"
                ? (Absences.Count == 0 ? "На сегодня записей об отсутствии нет." : null)
                : "Не удалось подтвердить состояние списка отсутствий.";
            AbsencesZupNoteText = list.ZupComparison is "unavailable"
                ? "Сравнение с ЗУП недоступно: актуальность данных не подтверждена."
                : string.Empty;
            _absencesLoaded = true;
            CanShowAbsences = true;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            AbsencesInfoText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAbsencesLoading = false;
        }
    }

    private void ClearAbsencesState()
    {
        Absences.Clear();
        AbsencesInfoText = null;
        AbsencesZupNoteText = string.Empty;
        IsAbsencesOpen = false;
        IsAbsencesLoading = false;
        _absencesLoaded = false;
        CanShowAbsences = false;
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
        _loadEpoch++;
        _realtimeRefreshQueued = false;
        _detailLoadCancellation?.Cancel();
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        AssignmentForm = null;
        CredentialForm = null;
        _profile = null;
        _assignmentCapability = null;
        CanCreateAssignment = false;
        ClearAbsencesState();
        ProfileStatusText = string.Empty;
        IsProfileChipVisible = false;
        ProfileLoginText = string.Empty;
        ProfileButtonText = "Подключить 1С";
        BannerErrorText = null;
        DetailErrorText = null;
        StatusInfoText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        Scope = "inbox";
        _total = null;
        _nextOffset = 0;
        HasMore = false;
        InboxCount = 0;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        ShowSetupHint = false;
        SetupHintText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
        _fileDownloadsInFlight.Clear();
    }
}

/// <summary>Аргументы события сохранения кредов: профиль, вернувшийся с PUT.</summary>
public sealed class DocflowProfileSavedEventArgs : EventArgs
{
    public DocflowProfileSavedEventArgs(HubDocflowProfile profile)
    {
        Profile = profile;
    }

    public HubDocflowProfile Profile { get; }
}

/// <summary>
/// Панель «Учётная запись 1С» (оверлей, как форма поручения): логин и пароль
/// учётки 1С, проверка связи без сохранения (POST /profile/test), сохранение
/// (PUT /profile/credentials) и отключение (DELETE — с inline-подтверждением,
/// как DisconnectDialog в вебе). Пароль приходит из PasswordBox аргументом
/// методов и в VM не хранится дольше одного вызова; в логи/состояние не пишется.
/// </summary>
public sealed class DocflowCredentialFormViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private string _login;
    private string? _busyAction;
    private string? _errorText;
    private string? _testResultText;
    private bool _isDisconnectConfirming;

    public DocflowCredentialFormViewModel(IHubApiClient api, HubDocflowProfile? profile)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _login = (profile?.Login ?? string.Empty).Trim();
        ProfileConfigured = profile?.Configured == true || profile?.Status is "configured" or "valid";
        HeaderText = ProfileConfigured ? "Учётная запись 1С" : "Подключение к 1С";
        InfoText = ProfileConfigured
            ? "Логин уже сохранён. Укажите пароль, чтобы обновить данные или проверить связь."
            : "Введите личные данные 1С — задания загрузятся только назначенные вам. "
                + "Нет доступа? Запросите пароль у технической поддержки (it@zsgp.ru).";

        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty),
            () => !IsBusy);
        AskDisconnectCommand = new NativeRelayCommand(
            () => IsDisconnectConfirming = true,
            () => !IsBusy && ProfileConfigured && !IsDisconnectConfirming);
        CancelDisconnectCommand = new NativeRelayCommand(
            () => IsDisconnectConfirming = false,
            () => !IsBusy);
    }

    /// <summary>PUT вернул профиль — родитель перечитывает список и capability.</summary>
    public event EventHandler<DocflowProfileSavedEventArgs>? Saved;

    /// <summary>DELETE завершён — родитель чистит список и возвращает setup-состояние.</summary>
    public event EventHandler? Disconnected;

    /// <summary>Закрытие панели без изменений (Отмена/✕) — решает родитель.</summary>
    public event EventHandler? Closed;

    /// <summary>Креды уже сохранены — показать ветку отключения и подсказку про пароль.</summary>
    public bool ProfileConfigured { get; }

    public string HeaderText { get; }
    public string InfoText { get; }

    /// <summary>Логин 1С (предзаполнен из профиля, ≤128 как у backend).</summary>
    public string Login
    {
        get => _login;
        set
        {
            if (SetProperty(ref _login, value ?? string.Empty))
            {
                ErrorText = null;
                TestResultText = null;
            }
        }
    }

    /// <summary>Идёт test|save|disconnect — имя действия для подписи прогресса.</summary>
    public string? BusyAction
    {
        get => _busyAction;
        private set
        {
            if (SetProperty(ref _busyAction, value))
            {
                OnPropertyChanged(nameof(IsBusy));
                OnPropertyChanged(nameof(IsTestBusy));
                OnPropertyChanged(nameof(IsSaveBusy));
                OnPropertyChanged(nameof(IsDisconnectBusy));
                OnPropertyChanged(nameof(TestButtonText));
                OnPropertyChanged(nameof(SaveButtonText));
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)AskDisconnectCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CancelDisconnectCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsBusy => BusyAction is not null;
    public bool IsTestBusy => BusyAction == "test";
    public bool IsSaveBusy => BusyAction == "save";
    public bool IsDisconnectBusy => BusyAction == "disconnect";

    public string TestButtonText => IsTestBusy ? "Проверяем…" : "Проверить подключение";
    public string SaveButtonText => IsSaveBusy ? "Сохраняем…" : "Подключить и сохранить";

    /// <summary>Ошибка валидации/запроса — плашка внутри формы.</summary>
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

    /// <summary>Зелёная строка результата проверки связи.</summary>
    public string? TestResultText
    {
        get => _testResultText;
        private set
        {
            if (SetProperty(ref _testResultText, value))
            {
                OnPropertyChanged(nameof(HasTestResult));
            }
        }
    }

    public bool HasTestResult => !string.IsNullOrEmpty(TestResultText);

    /// <summary>Первый клик «Отключить 1С» — подтверждение, второй — само удаление.</summary>
    public bool IsDisconnectConfirming
    {
        get => _isDisconnectConfirming;
        private set
        {
            if (SetProperty(ref _isDisconnectConfirming, value))
            {
                ((NativeRelayCommand)AskDisconnectCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public ICommand CloseCommand { get; }
    public ICommand AskDisconnectCommand { get; }
    public ICommand CancelDisconnectCommand { get; }

    /// <summary>«Проверить подключение» — POST /profile/test, креды не сохраняются.</summary>
    public async Task<bool> TestAsync(string? password, CancellationToken cancellationToken = default)
    {
        if (IsBusy || !TryValidate(password, out var login, out var secret))
        {
            return false;
        }

        BusyAction = "test";
        try
        {
            var result = await _api.TestDocflowCredentialsAsync(login, secret, cancellationToken);
            var configuration = (result.Configuration ?? string.Empty).Trim();
            TestResultText = !result.Connected
                ? "1С не подтвердила подключение по этим данным."
                : configuration.Length > 0
                    ? $"Подключение к базе «{configuration}» работает."
                    : "Подключение к 1С работает.";
            return result.Connected;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            BusyAction = null;
        }
    }

    /// <summary>«Подключить и сохранить» — PUT /profile/credentials → событие Saved.</summary>
    public async Task<bool> SaveAsync(string? password, CancellationToken cancellationToken = default)
    {
        if (IsBusy || !TryValidate(password, out var login, out var secret))
        {
            return false;
        }

        BusyAction = "save";
        try
        {
            var profile = await _api.SaveDocflowCredentialsAsync(login, secret, cancellationToken);
            Saved?.Invoke(this, new DocflowProfileSavedEventArgs(profile));
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception exception)
        {
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            BusyAction = null;
        }
    }

    /// <summary>Подтверждённое «Отключить 1С» — DELETE /profile/credentials.</summary>
    public async Task<bool> DisconnectAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy || !ProfileConfigured)
        {
            return false;
        }

        BusyAction = "disconnect";
        ErrorText = null;
        try
        {
            await _api.DeleteDocflowCredentialsAsync(cancellationToken);
            Disconnected?.Invoke(this, EventArgs.Empty);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
        catch (Exception exception)
        {
            IsDisconnectConfirming = false;
            ErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            BusyAction = null;
        }
    }

    /// <summary>Валидация как в веб-диалоге: логин и пароль обязательны.</summary>
    private bool TryValidate(string? password, out string login, out string secret)
    {
        login = Login.Trim();
        secret = password ?? string.Empty;
        ErrorText = null;
        TestResultText = null;
        if (login.Length == 0)
        {
            ErrorText = "Введите логин от 1С.";
            return false;
        }

        if (secret.Length == 0)
        {
            ErrorText = "Введите пароль от 1С.";
            return false;
        }

        if (login.Length > 128 || secret.Length > 256)
        {
            ErrorText = "Слишком длинные данные. Проверьте логин и пароль.";
            return false;
        }

        return true;
    }
}

/// <summary>
/// Строка панели «Отсутствия из 1С»: ФИО, вид и период, комментарий,
/// «разбирает задачи», расхождение с ЗУП и неподтверждённая связь.
/// </summary>
public sealed class DocflowAbsenceItemViewModel
{
    public DocflowAbsenceItemViewModel(HubDocflowAbsenceItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        DisplayName = string.IsNullOrWhiteSpace(item.DisplayName)
            ? "Сотрудник 1С"
            : item.DisplayName!.Trim();
        var label = (item.Label ?? string.Empty).Trim();
        PeriodText = $"{(label.Length > 0 ? label : "Отсутствие")} · "
            + $"{FormatDay(item.StartsOn)} — {FormatDay(item.EndsOn)} включительно";
        Comment = (item.Comment ?? string.Empty).Trim();
        WillHandleText = item.WillHandleTasks
            ? "Будет разбирать задачи"
            : "Не будет разбирать задачи";
        HasDifferences = item.Differences is { Count: > 0 };
        IsUnresolved = item.MatchingStatus is "unresolved";
    }

    public string DisplayName { get; }
    public string PeriodText { get; }
    public string Comment { get; }
    public string WillHandleText { get; }

    /// <summary>Чип «Данные отличаются от ЗУП» (differences не пуст).</summary>
    public bool HasDifferences { get; }

    /// <summary>«Связь с адресной книгой не подтверждена» (matching_status=unresolved).</summary>
    public bool IsUnresolved { get; }

    /// <summary>formatDate из веб-панели: «YYYY-MM-DD» → «dd.MM.yyyy».</summary>
    private static string FormatDay(string? value)
    {
        var raw = (value ?? string.Empty).Trim();
        var parts = raw.Split('-');
        return parts.Length == 3 && parts[0].Length == 4
            ? $"{parts[2]}.{parts[1]}.{parts[0]}"
            : "дата не указана";
    }
}
