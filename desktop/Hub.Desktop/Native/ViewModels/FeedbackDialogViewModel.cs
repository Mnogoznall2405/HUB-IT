using System.Collections.ObjectModel;
using System.Globalization;
using System.Net;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Опция категории предложения — FEEDBACK_CATEGORY_OPTIONS веба.</summary>
public sealed record FeedbackCategoryOption(string Value, string Label);

/// <summary>
/// Карточка «Мои предложения» — элемент GET /feedback/mine (SuggestionCard веба).
/// Подписи категории и статуса + тон пилюли — как у AdminFeedbackItemViewModel,
/// мета-строка «Категория · Раздел · дата» — как в вебе.
/// </summary>
public sealed class MyFeedbackItemViewModel
{
    public MyFeedbackItemViewModel(HubFeedbackSuggestion item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = (item.Id ?? string.Empty).Trim();
        Title = MfuFormat.OrDash(item.Title);
        MessageText = (item.Message ?? string.Empty).Trim();
        Status = (item.Status ?? string.Empty).Trim();
        (StatusText, StatusTone) = FeedbackDialogViewModel.DescribeStatus(Status);
        CategoryText = FeedbackDialogViewModel.DescribeCategory(item.Category);
        SectionText = (item.Section ?? string.Empty).Trim();
        CreatedText = FeedbackDialogViewModel.FormatCreatedAt(item.CreatedAt);
        MetaText = AdminUserItemViewModel.JoinParts(CategoryText, SectionText, CreatedText);
        AdminNoteText = (item.AdminNote ?? string.Empty).Trim();
        HasAdminNote = AdminNoteText.Length > 0;
        AutomationName = $"Предложение {Title}";
    }

    public string Id { get; }
    public string Title { get; }
    public string MessageText { get; }
    public string Status { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string CategoryText { get; }
    public string SectionText { get; }
    public string CreatedText { get; }
    public string MetaText { get; }
    public string AdminNoteText { get; }
    public bool HasAdminNote { get; }
    public string AutomationName { get; }
}

/// <summary>
/// Диалог «Что улучшить в HUB?» — порт веб-FeedbackDialog.jsx: вкладка «Новая идея»
/// (форма POST /feedback) и «Мои предложения» (GET /feedback/mine?limit=50).
/// Лимиты полей повторяют FEEDBACK_*_MAX веба и сервиса; черновик при ошибке
/// сохраняется, при успехе сбрасывается и показывается success-плашка со статусом.
/// </summary>
public sealed class FeedbackDialogViewModel : ObservableObject
{
    // Лимиты — validateFeedbackDraft веба и feedback_service (TITLE_MIN/MAX и др.).
    internal const int TitleMinLength = 3;
    internal const int TitleMaxLength = 120;
    internal const int MessageMinLength = 10;
    internal const int MessageMaxLength = 2000;
    internal const int SectionMaxLength = 64;

    /// <summary>limit выборки «Мои предложения» — как feedbackAPI.listMine веба.</summary>
    internal const int MinePageLimit = 50;

    private enum MineLoadState
    {
        Idle,
        Loading,
        Ready,
        Error,
    }

    private readonly IHubApiClient _api;
    private bool _isBusy;
    private string? _errorText;
    private bool _isSubmitErrorWarning;
    private string _successText = string.Empty;
    private FeedbackCategoryOption _selectedCategory;
    private string _title = string.Empty;
    private string _message = string.Empty;
    private string _section = string.Empty;
    private string? _categoryError;
    private string? _titleError;
    private string? _messageError;
    private string? _sectionError;
    private bool _isMineMode;
    private MineLoadState _mineState = MineLoadState.Idle;
    private string? _mineErrorText;
    private int _mineTotal;

    public FeedbackDialogViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _selectedCategory = CategoryOptions[0];

        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = DescribeSubmitError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
        RefreshMineCommand = new NativeAsyncCommand(
            (_, ct) => LoadMineAsync(ct),
            ex => SetMineError(DescribeMineError(ex)),
            _ => !IsMineLoading);
        OpenMineCommand = new NativeRelayCommand(() => IsMineMode = true);
    }

    /// <summary>Закрытие диалога (✕/«Закрыть»/Esc) — решает родитель.</summary>
    internal Action? Closed;

    /// <summary>Категории формы — FEEDBACK_CATEGORY_OPTIONS веба.</summary>
    public IReadOnlyList<FeedbackCategoryOption> CategoryOptions { get; } =
    [
        new("idea", "Идея"),
        new("inconvenience", "Неудобство"),
        new("bug", "Ошибка"),
        new("other", "Другое"),
    ];

    // ---- Вкладки (mode веба: «new» | «mine») ----

    /// <summary>Вкладка «Новая идея» активна.</summary>
    public bool IsNewMode
    {
        get => !_isMineMode;
        set => IsMineMode = !value;
    }

    /// <summary>
    /// Вкладка «Мои предложения». Смена вкладки сбрасывает ошибку отправки и
    /// success-плашку (handleModeChange веба); первый переход грузит список —
    /// как mineStatus==='idle' → loadMine у веба.
    /// </summary>
    public bool IsMineMode
    {
        get => _isMineMode;
        set
        {
            if (!SetProperty(ref _isMineMode, value))
            {
                return;
            }

            OnPropertyChanged(nameof(IsNewMode));
            ClearSubmitResult();
            if (value && _mineState == MineLoadState.Idle)
            {
                _ = ((NativeAsyncCommand)RefreshMineCommand).ExecuteAsync(null);
            }
        }
    }

    // ---- Поля формы ----

    /// <summary>Выбранная категория (дефолт — «idea», как EMPTY_DRAFT веба).</summary>
    public FeedbackCategoryOption SelectedCategory
    {
        get => _selectedCategory;
        set
        {
            if (SetProperty(ref _selectedCategory, value ?? CategoryOptions[0]))
            {
                CategoryError = null;
                ClearSubmitResult();
            }
        }
    }

    /// <summary>Заголовок (обязателен, 3..120).</summary>
    public string Title
    {
        get => _title;
        set
        {
            if (SetProperty(ref _title, value ?? string.Empty))
            {
                TitleError = null;
                ClearSubmitResult();
                OnPropertyChanged(nameof(TitleCountText));
            }
        }
    }

    /// <summary>Описание (обязательно, 10..2000).</summary>
    public string Message
    {
        get => _message;
        set
        {
            if (SetProperty(ref _message, value ?? string.Empty))
            {
                MessageError = null;
                ClearSubmitResult();
                OnPropertyChanged(nameof(MessageCountText));
            }
        }
    }

    /// <summary>Раздел портала (опционально, ≤ 64).</summary>
    public string Section
    {
        get => _section;
        set
        {
            if (SetProperty(ref _section, value ?? string.Empty))
            {
                SectionError = null;
                ClearSubmitResult();
            }
        }
    }

    /// <summary>Счётчик «N/120» под заголовком — helperText веба.</summary>
    public string TitleCountText => $"{Title.Length}/{TitleMaxLength}";

    /// <summary>Счётчик «N/2000» под описанием.</summary>
    public string MessageCountText => $"{Message.Length}/{MessageMaxLength}";

    // ---- Ошибки полей (validateFeedbackDraft веба) ----

    public string? CategoryError
    {
        get => _categoryError;
        private set
        {
            if (SetProperty(ref _categoryError, value))
            {
                OnPropertyChanged(nameof(HasCategoryError));
            }
        }
    }

    public bool HasCategoryError => !string.IsNullOrEmpty(CategoryError);

    public string? TitleError
    {
        get => _titleError;
        private set
        {
            if (SetProperty(ref _titleError, value))
            {
                OnPropertyChanged(nameof(HasTitleError));
            }
        }
    }

    public bool HasTitleError => !string.IsNullOrEmpty(TitleError);

    public string? MessageError
    {
        get => _messageError;
        private set
        {
            if (SetProperty(ref _messageError, value))
            {
                OnPropertyChanged(nameof(HasMessageError));
            }
        }
    }

    public bool HasMessageError => !string.IsNullOrEmpty(MessageError);

    public string? SectionError
    {
        get => _sectionError;
        private set
        {
            if (SetProperty(ref _sectionError, value))
            {
                OnPropertyChanged(nameof(HasSectionError));
            }
        }
    }

    public bool HasSectionError => !string.IsNullOrEmpty(SectionError);

    // ---- Состояние отправки ----

    /// <summary>Идёт POST /feedback: поля и «Закрыть» заблокированы.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreInputsEnabled));
                OnPropertyChanged(nameof(SubmitButtonText));
                OnPropertyChanged(nameof(ShowProgress));
                ((NativeAsyncCommand)SubmitCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Поля формы отключены на время запроса.</summary>
    public bool AreInputsEnabled => !IsBusy;

    public string SubmitButtonText => IsBusy ? "Отправка…" : "Отправить";

    /// <summary>Верхняя полоса прогресса: отправка формы или загрузка списка.</summary>
    public bool ShowProgress => IsBusy || IsMineLoading;

    /// <summary>Ошибка отправки — плашка внутри формы, черновик не стирается.</summary>
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

    /// <summary>429 — плашка-«warning» (дневной лимит), остальные — «error».</summary>
    public bool IsSubmitErrorWarning
    {
        get => _isSubmitErrorWarning;
        private set => SetProperty(ref _isSubmitErrorWarning, value);
    }

    /// <summary>Success-плашка «Спасибо! Предложение отправлено, статус: …».</summary>
    public string SuccessText
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

    public bool HasSuccess => !string.IsNullOrEmpty(SuccessText);

    // ---- «Мои предложения» ----

    public ObservableCollection<MyFeedbackItemViewModel> MyItems { get; } = [];

    /// <summary>Идёт GET /feedback/mine (спиннер вкладки).</summary>
    public bool IsMineLoading => _mineState == MineLoadState.Loading;

    /// <summary>Список загружен (шапка «Всего: N» видна и при пустом списке).</summary>
    public bool IsMineReady => _mineState == MineLoadState.Ready;

    /// <summary>Загружено и пусто — «Вы пока не отправляли предложений.»</summary>
    public bool IsMineEmpty => _mineState == MineLoadState.Ready && MyItems.Count == 0;

    /// <summary>Загружено и есть элементы.</summary>
    public bool HasMineItems => _mineState == MineLoadState.Ready && MyItems.Count > 0;

    public string? MineErrorText
    {
        get => _mineErrorText;
        private set
        {
            if (SetProperty(ref _mineErrorText, value))
            {
                OnPropertyChanged(nameof(HasMineError));
            }
        }
    }

    public bool HasMineError => !string.IsNullOrEmpty(MineErrorText);

    /// <summary>Подпись «Всего: N» в шапке вкладки.</summary>
    public string MineTotalText => $"Всего: {_mineTotal.ToString(CultureInfo.CurrentCulture)}";

    /// <summary>Сервер вернул больше, чем показано: «Показаны последние N из M.»</summary>
    public bool HasMineOverflow => IsMineReady && _mineTotal > MyItems.Count;

    public string MineOverflowText =>
        $"Показаны последние {MyItems.Count.ToString(CultureInfo.CurrentCulture)} из {_mineTotal.ToString(CultureInfo.CurrentCulture)}.";

    public ICommand SubmitCommand { get; }
    public ICommand CloseCommand { get; }
    public ICommand RefreshMineCommand { get; }

    /// <summary>«Мои предложения» из success-плашки — переход на вкладку списка.</summary>
    public ICommand OpenMineCommand { get; }

    /// <summary>
    /// Отправка: валидация как validateFeedbackDraft веба (поля подсвечиваются
    /// своими ошибками, общей плашки при локальной валидации нет), затем POST.
    /// При успехе черновик очищается и показывается плашка со статусом; если
    /// «Мои предложения» уже загружены — новый элемент добавляется в начало без
    /// повторного запроса. false — диалог остаётся открытым.
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ClearSubmitResult();
        ClearFieldErrors();
        if (!ValidateDraft())
        {
            return false;
        }

        var section = Section.Trim();
        var request = new HubFeedbackCreate
        {
            Category = SelectedCategory.Value,
            Title = Title.Trim(),
            Message = Message.Trim(),
            // Как веб: пустой раздел не уходит в payload (section=null).
            Section = section.Length > 0 ? section : null,
        };

        IsBusy = true;
        try
        {
            var created = await _api.CreateFeedbackAsync(request, cancellationToken);
            Title = string.Empty;
            Message = string.Empty;
            Section = string.Empty;
            SuccessText = created is null
                ? "Спасибо! Предложение отправлено."
                : $"Спасибо! Предложение отправлено, статус: «{DescribeStatus(created.Status).Text}».";
            if (created is not null && IsMineReady)
            {
                PrependMine(created);
            }

            return true;
        }
        catch (Exception exception)
        {
            IsSubmitErrorWarning = exception is HubApiException
            {
                StatusCode: HttpStatusCode.TooManyRequests,
            };
            ErrorText = DescribeSubmitError(exception);
            return false;
        }
        finally
        {
            IsBusy = false;
        }
    }

    /// <summary>GET /feedback/mine: спиннер → список/ошибка/пусто.</summary>
    public async Task LoadMineAsync(CancellationToken cancellationToken = default)
    {
        SetMineState(MineLoadState.Loading);
        MineErrorText = null;
        try
        {
            var page = await _api.GetMyFeedbackAsync(MinePageLimit, cancellationToken);
            MyItems.Clear();
            foreach (var item in page.Items ?? [])
            {
                MyItems.Add(new MyFeedbackItemViewModel(item));
            }

            _mineTotal = page.Total;
            SetMineState(MineLoadState.Ready);
        }
        catch (Exception exception)
        {
            SetMineError(DescribeMineError(exception));
        }
    }

    /// <summary>
    /// Новое предложение в начало уже загруженного списка (веб: unshift + total+1);
    /// дубликат по id сначала убирается.
    /// </summary>
    private void PrependMine(HubFeedbackSuggestion created)
    {
        var createdId = (created.Id ?? string.Empty).Trim();
        var existing = MyItems.FirstOrDefault(
            item => string.Equals(item.Id, createdId, StringComparison.Ordinal));
        if (existing is not null)
        {
            MyItems.Remove(existing);
        }

        MyItems.Insert(0, new MyFeedbackItemViewModel(created));
        _mineTotal += 1;
        RaiseMineFlags();
    }

    private bool ValidateDraft()
    {
        var valid = true;
        if (CategoryOptions.All(option => option.Value != SelectedCategory.Value))
        {
            CategoryError = "Выберите категорию.";
            valid = false;
        }

        var titleLength = Title.Trim().Length;
        if (titleLength < TitleMinLength)
        {
            TitleError = $"Заголовок: не менее {TitleMinLength} символов.";
            valid = false;
        }
        else if (titleLength > TitleMaxLength)
        {
            TitleError = $"Заголовок: не более {TitleMaxLength} символов.";
            valid = false;
        }

        var messageLength = Message.Trim().Length;
        if (messageLength < MessageMinLength)
        {
            MessageError = $"Описание: не менее {MessageMinLength} символов.";
            valid = false;
        }
        else if (messageLength > MessageMaxLength)
        {
            MessageError = $"Описание: не более {MessageMaxLength} символов.";
            valid = false;
        }

        if (Section.Trim().Length > SectionMaxLength)
        {
            SectionError = $"Раздел: не более {SectionMaxLength} символов.";
            valid = false;
        }

        return valid;
    }

    private void ClearFieldErrors()
    {
        CategoryError = null;
        TitleError = null;
        MessageError = null;
        SectionError = null;
    }

    /// <summary>Сброс плашек результата — при смене вкладки и правке полей.</summary>
    private void ClearSubmitResult()
    {
        ErrorText = null;
        IsSubmitErrorWarning = false;
        SuccessText = string.Empty;
    }

    private void SetMineError(string message)
    {
        MineErrorText = message;
        SetMineState(MineLoadState.Error);
    }

    private void SetMineState(MineLoadState state)
    {
        if (_mineState == state)
        {
            return;
        }

        _mineState = state;
        RaiseMineFlags();
    }

    private void RaiseMineFlags()
    {
        OnPropertyChanged(nameof(IsMineLoading));
        OnPropertyChanged(nameof(IsMineReady));
        OnPropertyChanged(nameof(IsMineEmpty));
        OnPropertyChanged(nameof(HasMineItems));
        OnPropertyChanged(nameof(ShowProgress));
        OnPropertyChanged(nameof(MineTotalText));
        OnPropertyChanged(nameof(HasMineOverflow));
        OnPropertyChanged(nameof(MineOverflowText));
        ((NativeAsyncCommand)RefreshMineCommand).RaiseCanExecuteChanged();
    }

    /// <summary>
    /// Текст ошибки отправки — fallbackSubmitMessage/getFeedbackErrorMessage веба:
    /// detail сервера приоритетнее, иначе по статусу (429 — лимит, 503 — не
    /// подключено); сеть/сессия — общие тексты DescribeError.
    /// </summary>
    internal static string DescribeSubmitError(Exception exception)
    {
        if (exception is HubApiException { Kind: HubApiErrorKind.Http } apiEx)
        {
            var detail = ServerDetail(apiEx);
            if (detail is not null)
            {
                return detail;
            }

            return apiEx.StatusCode switch
            {
                HttpStatusCode.TooManyRequests =>
                    "Достигнут дневной лимит предложений. Попробуйте завтра.",
                HttpStatusCode.ServiceUnavailable =>
                    "Раздел предложений пока не подключён. Попробуйте позже.",
                _ => "Не удалось отправить предложение. Попробуйте позже.",
            };
        }

        if (exception is HubApiException { Kind: HubApiErrorKind.Transport or HubApiErrorKind.SessionExpired })
        {
            return TasksViewModel.DescribeError(exception);
        }

        return "Не удалось отправить предложение. Попробуйте позже.";
    }

    /// <summary>Ошибка загрузки списка — detail сервера, иначе fallback веба.</summary>
    private static string DescribeMineError(Exception exception)
    {
        if (exception is HubApiException { Kind: HubApiErrorKind.Http } apiEx
            && ServerDetail(apiEx) is { } detail)
        {
            return detail;
        }

        if (exception is HubApiException { Kind: HubApiErrorKind.Transport or HubApiErrorKind.SessionExpired })
        {
            return TasksViewModel.DescribeError(exception);
        }

        return "Не удалось загрузить предложения.";
    }

    /// <summary>
    /// detail из ответа FastAPI живёт в Message исключения; синтезированный
    /// «HTTP 500 …» без тела не показываем — у статуса есть свой текст.
    /// </summary>
    private static string? ServerDetail(HubApiException exception)
    {
        var detail = (exception.Message ?? string.Empty).Trim();
        return detail.Length > 0 && !detail.StartsWith("HTTP ", StringComparison.Ordinal)
            ? detail
            : null;
    }

    /// <summary>Подпись и тон статуса — FEEDBACK_STATUS_META веба (info|warning|primary|error|success).</summary>
    internal static (string Text, string Tone) DescribeStatus(string? status) =>
        (status ?? string.Empty).Trim() switch
        {
            "new" => ("Новое", "info"),
            "in_progress" => ("В работе", "warning"),
            "accepted" => ("Принято", "primary"),
            "declined" => ("Отклонено", "error"),
            "done" => ("Сделано", "success"),
            { Length: > 0 } other => (other, "muted"),
            _ => ("—", "muted"),
        };

    /// <summary>Подпись категории — FEEDBACK_CATEGORY_LABELS веба.</summary>
    internal static string DescribeCategory(string? category) =>
        (category ?? string.Empty).Trim() switch
        {
            "idea" => "Идея",
            "inconvenience" => "Неудобство",
            "bug" => "Ошибка",
            { Length: > 0 } other => other,
            _ => "Другое",
        };

    /// <summary>formatFeedbackDateTime веба: «dd.MM.yyyy HH:mm» локально, пусто при битом значении.</summary>
    internal static string FormatCreatedAt(string? value) =>
        DateTimeOffset.TryParse(
            value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.LocalDateTime.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : string.Empty;
}
