using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Строка списка «Отсутствия»: имя, тип, диапазон дат и источник (ручная запись HUB или ЗУП).
/// У ручных записей при праве hub.absences.manage — действия «Изменить»/«Удалить».
/// </summary>
public sealed class AbsenceListItemViewModel : ObservableObject
{
    private bool _isBusy;
    private bool _deleteArmed;

    public AbsenceListItemViewModel(HubAbsenceItem item, bool canManage = false)
    {
        ArgumentNullException.ThrowIfNull(item);
        Source = item;
        Id = item.Id;
        ManageId = long.TryParse(item.Id, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)
            ? id
            : null;
        CanManage = canManage;
        DisplayName = string.IsNullOrWhiteSpace(item.DisplayName)
            ? "Сотрудник"
            : item.DisplayName!;
        KindLabel = string.IsNullOrWhiteSpace(item.KindLabel)
            ? FormatKind(item.Kind)
            : item.KindLabel!;
        RangeText = FormatRange(item.StartsOn, item.EndsOn);
        IsManual = item.Source is "hub" or "manual";
        SourceText = item.Source is "zup" ? "ЗУП" : "HUB";
        Initials = string.Concat(
            DisplayName
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Take(2)
                .Select(w => char.ToUpperInvariant(w[0])));
        if (Initials.Length == 0)
        {
            Initials = "·";
        }
    }

    /// <summary>Исходная запись API: префилл диалога правки.</summary>
    internal HubAbsenceItem Source { get; }

    /// <summary>id ручной записи HUB (у записей ЗУП пустой или «zup:code»).</summary>
    public string? Id { get; }

    /// <summary>Числовой id ручной записи для PATCH/DELETE; у ЗУП («zup:…») — null.</summary>
    public long? ManageId { get; }

    /// <summary>У зрителя есть право hub.absences.manage (гейт родителя).</summary>
    public bool CanManage { get; }

    /// <summary>«Изменить»/«Удалить» видны только у ручной записи с числовым id и правом.</summary>
    public bool ShowActions => CanManage && IsManual && ManageId is not null;

    public string DisplayName { get; }
    public string Initials { get; }
    public string KindLabel { get; }
    public string RangeText { get; }
    public string SourceText { get; }

    /// <summary>Ручная запись HUB (source="hub"/"manual"); записи ЗУП read-only.</summary>
    public bool IsManual { get; }

    /// <summary>Запрос на запись идёт: кнопки действий строки заблокированы.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        internal set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(AreActionsEnabled));
            }
        }
    }

    /// <summary>Кнопки действий строки активны (обёртка !IsBusy для XAML без конвертера).</summary>
    public bool AreActionsEnabled => !IsBusy;

    /// <summary>Первое нажатие «Удалить» взводит подтверждение; второе — удаляет.</summary>
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

    /// <summary>Подпись кнопки удаления: armed-состояние просит повторное нажатие.</summary>
    public string DeleteText => DeleteArmed ? "Точно удалить?" : "Удалить";

    internal static string FormatKind(string? kind) => kind switch
    {
        "vacation" => "Отпуск",
        "sick" => "Больничный",
        "trip" => "Командировка",
        "other" => "Отсутствует",
        null => "Отсутствует",
        _ => kind,
    };

    private static string FormatRange(string? startsOn, string? endsOn)
    {
        var start = TryParseDate(startsOn);
        var end = TryParseDate(endsOn);
        if (start is null && end is null)
        {
            return string.Empty;
        }

        if (start is null || end is null || start == end)
        {
            return (start ?? end)!.Value.ToString("dd.MM", CultureInfo.CurrentCulture);
        }

        return $"{start.Value:dd.MM} — {end.Value:dd.MM}";
    }

    private static DateTime? TryParseDate(string? value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.Date
            : null;
}

/// <summary>
/// Страница «Отсутствия» нативного шелла: кто отсутствует (отпуск/больничный/
/// командировка) на день или за неделю. Свод ручных записей HUB и ЗУП
/// с клиентским поиском по имени и фильтром источника записи.
/// При праве hub.absences.manage — создание/правка/удаление ручных записей.
/// </summary>
public sealed class AbsencesViewModel : ObservableObject
{
    /// <summary>Верхняя граница выборки (backend допускает до 500).</summary>
    private const int LoadLimit = 500;

    /// <summary>Длина недельного диапазона в днях: starts_on … starts_on+6.</summary>
    private const int WeekLengthDays = 7;

    /// <summary>Право на write-флоу ручных записей — как PERM_HUB_ABSENCES_MANAGE backend'а.</summary>
    internal const string AbsencesManagePermission = "hub.absences.manage";

    private readonly IHubApiClient _api;

    /// <summary>Полный снапшот последней загрузки: Items показывает его срез по фильтрам.</summary>
    private readonly List<AbsenceListItemViewModel> _allItems = [];

    private DateTime _selectedDate;
    private bool _isWeekMode;
    private bool _isLoading;
    private string? _bannerErrorText;
    private string _headerText;
    private string _searchText = string.Empty;
    private string _sourceFilter = "all";
    private bool _canManageAbsences;
    private bool _permissionsLoaded;
    private AbsenceEditorViewModel? _editor;
    private AbsenceListItemViewModel? _armedDeleteRow;

    public AbsencesViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _selectedDate = DateTime.Today;

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectModeCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                IsWeekMode = parameter as string == "week";
                await LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        PrevDayCommand = new NativeAsyncCommand(
            (_, ct) => MoveAndLoadAsync(-1, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        NextDayCommand = new NativeAsyncCommand(
            (_, ct) => MoveAndLoadAsync(1, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        TodayCommand = new NativeAsyncCommand(
            (_, ct) =>
            {
                SelectedDate = DateTime.Today;
                return LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SelectSourceCommand = new NativeRelayCommand(
            parameter => SourceFilter = parameter as string ?? "all");
        OpenCreateCommand = new NativeAsyncCommand(
            (_, ct) => OpenCreateAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageAbsences && !IsEditorOpen);
        EditAbsenceCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is AbsenceListItemViewModel row && row.ShowActions)
                {
                    OpenEditor(new AbsenceEditorViewModel(_api, row.Source));
                }
            });
        DeleteAbsenceCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteAsync(parameter, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        Items.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsEmpty));

        _headerText = BuildHeaderText();
    }

    public ObservableCollection<AbsenceListItemViewModel> Items { get; } = [];

    /// <summary>Дата-якорь режима «Сегодня» и начала недельного диапазона.</summary>
    public DateTime SelectedDate
    {
        get => _selectedDate;
        set
        {
            if (SetProperty(ref _selectedDate, value.Date))
            {
                OnPropertyChanged(nameof(SelectedDateText));
                HeaderText = BuildHeaderText();
            }
        }
    }

    /// <summary>«Пн, 16 ноября» — подпись выбранной даты в верхней панели.</summary>
    public string SelectedDateText => FormatSelectedDate(_selectedDate);

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectModeCommand.
    /// <summary>Режим «Сегодня»: одиночная дата (on=yyyy-MM-dd).</summary>
    public bool IsDayMode
    {
        get => !IsWeekMode;
        set
        {
            if (value && IsWeekMode)
            {
                SelectModeCommand.Execute("day");
            }
        }
    }

    /// <summary>Режим «Неделя»: диапазон starts_on/ends_on из 7 дней от SelectedDate.</summary>
    public bool IsWeekMode
    {
        get => _isWeekMode;
        set
        {
            if (SetProperty(ref _isWeekMode, value))
            {
                OnPropertyChanged(nameof(IsDayMode));
                if (value)
                {
                    SelectModeCommand.Execute("week");
                }
            }
        }
    }

    /// <summary>Поиск по имени сотрудника: локальный фильтр уже загруженной выдачи.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                OnFilterStateChanged();
            }
        }
    }

    /// <summary>Фильтр источника записей: all|hub|zup (клиентский, без запроса к API).</summary>
    public string SourceFilter
    {
        get => _sourceFilter;
        set
        {
            var normalized = value is "hub" or "zup" ? value : "all";
            if (SetProperty(ref _sourceFilter, normalized))
            {
                OnPropertyChanged(nameof(IsFilterAll));
                OnPropertyChanged(nameof(IsFilterHub));
                OnPropertyChanged(nameof(IsFilterZup));
                OnFilterStateChanged();
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectSourceCommand.
    /// <summary>Фильтр «Все»: ручные записи HUB и записи ЗУП вместе.</summary>
    public bool IsFilterAll
    {
        get => SourceFilter == "all";
        set => ApplySourceFilterFromUi("all", value);
    }

    /// <summary>Фильтр «HUB»: только ручные записи HUB.</summary>
    public bool IsFilterHub
    {
        get => SourceFilter == "hub";
        set => ApplySourceFilterFromUi("hub", value);
    }

    /// <summary>Фильтр «ЗУП»: только записи из ЗУП.</summary>
    public bool IsFilterZup
    {
        get => SourceFilter == "zup";
        set => ApplySourceFilterFromUi("zup", value);
    }

    /// <summary>Активен поиск или фильтр источника: список показывает срез выдачи.</summary>
    public bool HasActiveFilter =>
        !string.IsNullOrWhiteSpace(_searchText) || SourceFilter != "all";

    /// <summary>Заголовок пустого состояния: при фильтре — «ничего не совпало», а не «все на месте».</summary>
    public string EmptyTitleText => HasActiveFilter
        ? "Никого не найдено"
        : "Все на месте";

    /// <summary>Подсказка пустого состояния.</summary>
    public string EmptyHintText => HasActiveFilter
        ? "Измените поиск или фильтр источника записей."
        : "Ни у кого нет отпуска, больничного или командировки.";

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

    public string HeaderText
    {
        get => _headerText;
        private set => SetProperty(ref _headerText, value);
    }

    /// <summary>Пустая выдача без ошибки и не в процессе загрузки: «Все на месте».</summary>
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    public ICommand RefreshCommand { get; }
    public ICommand SelectModeCommand { get; }
    public ICommand PrevDayCommand { get; }
    public ICommand NextDayCommand { get; }
    public ICommand TodayCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand SelectSourceCommand { get; }

    // ---- Ручные записи: добавление / правка / удаление (hub.absences.manage) ----

    /// <summary>Право hub.absences.manage (или admin): кнопки добавления и действий строк.</summary>
    public bool CanManageAbsences
    {
        get => _canManageAbsences;
        private set => SetProperty(ref _canManageAbsences, value);
    }

    /// <summary>Открытый диалог создания/правки ручной записи; null — закрыт.</summary>
    public AbsenceEditorViewModel? Editor
    {
        get => _editor;
        private set
        {
            if (SetProperty(ref _editor, value))
            {
                OnPropertyChanged(nameof(IsEditorOpen));
                ((NativeAsyncCommand)OpenCreateCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsEditorOpen => Editor is not null;

    /// <summary>«+ Добавить отсутствие» в тулбаре — только с правом manage.</summary>
    public ICommand OpenCreateCommand { get; }

    /// <summary>«Изменить» у ручной записи (CommandParameter — AbsenceListItemViewModel).</summary>
    public ICommand EditAbsenceCommand { get; }

    /// <summary>«Удалить» у ручной записи: первое нажатие — подтверждение, второе — DELETE.</summary>
    public ICommand DeleteAbsenceCommand { get; }

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            // Право узнаём до сборки строк: у ручных записей от него зависят кнопки действий.
            await EnsurePermissionsAsync(cancellationToken);

            string? on = null;
            string? startsOn = null;
            string? endsOn = null;
            if (IsWeekMode)
            {
                startsOn = FormatQueryDate(SelectedDate);
                endsOn = FormatQueryDate(SelectedDate.AddDays(WeekLengthDays - 1));
            }
            else
            {
                on = FormatQueryDate(SelectedDate);
            }

            var result = await _api.GetAbsencesAsync(on, startsOn, endsOn, LoadLimit, cancellationToken);

            var rows = new List<AbsenceListItemViewModel>();
            foreach (var item in result.Items ?? [])
            {
                rows.Add(new AbsenceListItemViewModel(item, _canManageAbsences));
            }

            foreach (var item in result.ZupItems ?? [])
            {
                rows.Add(new AbsenceListItemViewModel(item, _canManageAbsences));
            }

            _allItems.Clear();
            _allItems.AddRange(rows.OrderBy(r => r.DisplayName, StringComparer.CurrentCulture));
            ApplyFilters();
            BannerErrorText = null;
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsLoading = false;
        }
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
        _allItems.Clear();
        Items.Clear();
        Editor = null;
        _armedDeleteRow = null;
        CanManageAbsences = false;
        _permissionsLoaded = false;
        BannerErrorText = null;
        IsLoading = false;
        IsWeekMode = false;
        SelectedDate = DateTime.Today;
        SearchText = string.Empty;
        SourceFilter = "all";
        HeaderText = BuildHeaderText();
    }

    /// <summary>
    /// Право hub.absences.manage узнаём один раз из /auth/me (матрица как у backend'а:
    /// admin видит всё, иначе — явное право). Ошибка /me не ломает список — false.
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
            CanManageAbsences = isAdmin
                || user.Permissions?.Contains(AbsencesManagePermission) == true;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception)
        {
            CanManageAbsences = false;
        }
    }

    private async Task OpenCreateAsync(CancellationToken cancellationToken)
    {
        await EnsurePermissionsAsync(cancellationToken);
        if (!CanManageAbsences)
        {
            // Кнопка скрыта без права; на всякий случай дублируем отказ сервером словами.
            BannerErrorText = "Недостаточно прав для управления отсутствиями.";
            return;
        }

        OpenEditor(new AbsenceEditorViewModel(_api));
    }

    private void OpenEditor(AbsenceEditorViewModel editor)
    {
        if (Editor is not null)
        {
            return;
        }

        editor.Saved = OnEditorSaved;
        editor.Closed = OnEditorClosed;
        Editor = editor;
    }

    private void OnEditorClosed() => Editor = null;

    /// <summary>Запись сохранена: диалог закрываем, текущую выборку перечитываем —
    /// новые даты могут вывести запись из дня/недели или, наоборот, ввести в него.</summary>
    private void OnEditorSaved(HubAbsenceItem item)
    {
        Editor = null;
        _ = LoadAsync(CancellationToken.None);
    }

    /// <summary>
    /// «Удалить»: первое нажатие взводит подтверждение на строке (как сброс 2FA),
    /// второе — DELETE и локальное удаление строки. Одновременно armed одна строка.
    /// </summary>
    private async Task DeleteAsync(object? parameter, CancellationToken cancellationToken)
    {
        if (parameter is not AbsenceListItemViewModel row
            || !row.ShowActions
            || row.ManageId is not { } absenceId
            || row.IsBusy)
        {
            return;
        }

        if (!row.DeleteArmed)
        {
            ArmDelete(row);
            return;
        }

        row.DeleteArmed = false;
        _armedDeleteRow = null;
        row.IsBusy = true;
        try
        {
            await _api.DeleteHubAbsenceAsync(absenceId, cancellationToken);
            _allItems.Remove(row);
            ApplyFilters();
            BannerErrorText = null;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            row.IsBusy = false;
        }
    }

    /// <summary>Armed-нажатие только у одной строки: новое снимает предыдущее.</summary>
    private void ArmDelete(AbsenceListItemViewModel row)
    {
        if (_armedDeleteRow is { } previous && !ReferenceEquals(previous, row))
        {
            previous.DeleteArmed = false;
        }

        _armedDeleteRow = row;
        row.DeleteArmed = true;
    }

    private Task MoveAndLoadAsync(int days, CancellationToken cancellationToken)
    {
        SelectedDate = SelectedDate.AddDays(days);
        return LoadAsync(cancellationToken);
    }

    private void ApplySourceFilterFromUi(string filter, bool isChecked)
    {
        if (isChecked && SourceFilter != filter)
        {
            SelectSourceCommand.Execute(filter);
        }
    }

    private void OnFilterStateChanged()
    {
        OnPropertyChanged(nameof(HasActiveFilter));
        OnPropertyChanged(nameof(EmptyTitleText));
        OnPropertyChanged(nameof(EmptyHintText));
        ApplyFilters();
    }

    /// <summary>Пересборка видимого списка из снапшота _allItems по поиску и источнику.</summary>
    private void ApplyFilters()
    {
        Items.Clear();
        var query = _searchText.Trim();
        foreach (var row in _allItems)
        {
            if (!MatchesSourceFilter(row)
                || (query.Length > 0
                    && !row.DisplayName.Contains(query, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            Items.Add(row);
        }

        HeaderText = BuildHeaderText();
    }

    private bool MatchesSourceFilter(AbsenceListItemViewModel row) => _sourceFilter switch
    {
        "hub" => row.IsManual,
        "zup" => !row.IsManual,
        _ => true,
    };

    /// <summary>«Отсутствуют {SelectedDateText} · N чел.»; при фильтре — «N из M чел.».</summary>
    private string BuildHeaderText() => HasActiveFilter
        ? $"Отсутствуют {SelectedDateText} · {Items.Count} из {_allItems.Count} чел."
        : $"Отсутствуют {SelectedDateText} · {Items.Count} чел.";

    private static string FormatQueryDate(DateTime date) =>
        date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static string FormatSelectedDate(DateTime date)
    {
        var text = date.ToString("ddd, d MMMM", CultureInfo.CurrentCulture);
        return text.Length == 0
            ? text
            : string.Concat(char.ToUpper(text[0], CultureInfo.CurrentCulture).ToString(), text[1..]);
    }
}

/// <summary>
/// Диалог «Новое отсутствие» / «Изменить отсутствие» (ручные записи HUB).
/// Create → POST /hub/absences полным телом; edit → PATCH только изменённых полей
/// (diff-семантика сервиса: «поле в payload» → обновить; очистка опционального
/// поля — пустая строка). Ошибки 400/403 — текст сервера в ErrorText,
/// диалог и введённые поля сохраняются.
/// </summary>
public sealed class AbsenceEditorViewModel : ObservableObject
{
    /// <summary>Значения kind в контракте backend'а (ABSENCE_KINDS).</summary>
    internal static readonly string[] KindValues = ["vacation", "sick", "trip", "other"];

    /// <summary>Ограничение сервера на длину комментария (_normalize_text, 500).</summary>
    internal const int CommentMaxLength = 500;

    private readonly IHubApiClient _api;
    private readonly HubAbsenceItem? _original;
    private readonly long _originalManageId;
    private bool _isBusy;
    private string? _errorText;
    private string _statusText = string.Empty;
    private string _displayName = string.Empty;
    private string _kind = "other";
    private DateTime? _startsOn;
    private DateTime? _endsOn;
    private string _comment = string.Empty;
    private string _department = string.Empty;

    /// <summary>Режим правки ручной записи: форма заполняется исходными значениями.</summary>
    public AbsenceEditorViewModel(IHubApiClient api, HubAbsenceItem original)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _original = original ?? throw new ArgumentNullException(nameof(original));
        _originalManageId = long.TryParse(
            original.Id, NumberStyles.Integer, CultureInfo.InvariantCulture, out var id)
            ? id
            : 0;
        _displayName = (original.DisplayName ?? string.Empty).Trim();
        _kind = NormalizeKind(original.Kind);
        _startsOn = ParseIsoDate(original.StartsOn);
        _endsOn = ParseIsoDate(original.EndsOn);
        _comment = original.Comment ?? string.Empty;
        _department = original.Department ?? string.Empty;
        InitCommands();
    }

    /// <summary>Режим создания ручной записи.</summary>
    public AbsenceEditorViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        IsCreateMode = true;
        InitCommands();
    }

    private void InitCommands()
    {
        SubmitCommand = new NativeAsyncCommand(
            (_, ct) => SubmitAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsBusy);
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(), () => !IsBusy);
    }

    /// <summary>Сохранение успешно — родитель перечитывает выборку и закрывает диалог.</summary>
    internal Action<HubAbsenceItem>? Saved;

    /// <summary>Закрытие диалога (✕/Отмена/Esc) — решает родитель.</summary>
    internal Action? Closed;

    // ---- Режим и заголовки ----

    public bool IsCreateMode { get; }

    public string TitleText => IsCreateMode ? "Новое отсутствие" : "Изменить отсутствие";

    public string SubtitleText => IsCreateMode
        ? "Ручная запись HUB"
        : _original?.DisplayName ?? string.Empty;

    // ---- Поля формы ----

    /// <summary>ФИО сотрудника — обязательное (display_name).</summary>
    public string DisplayName
    {
        get => _displayName;
        set => SetProperty(ref _displayName, value ?? string.Empty);
    }

    /// <summary>Вид отсутствия — чипы vacation|sick|trip|other (дефолт other, как у сервера).</summary>
    public bool IsKindVacation
    {
        get => _kind == "vacation";
        set
        {
            if (value)
            {
                SelectedKind = "vacation";
            }
        }
    }

    public bool IsKindSick
    {
        get => _kind == "sick";
        set
        {
            if (value)
            {
                SelectedKind = "sick";
            }
        }
    }

    public bool IsKindTrip
    {
        get => _kind == "trip";
        set
        {
            if (value)
            {
                SelectedKind = "trip";
            }
        }
    }

    public bool IsKindOther
    {
        get => _kind == "other";
        set
        {
            if (value)
            {
                SelectedKind = "other";
            }
        }
    }

    internal string SelectedKind
    {
        set
        {
            var normalized = NormalizeKind(value);
            if (SetProperty(ref _kind, normalized))
            {
                OnPropertyChanged(nameof(IsKindVacation));
                OnPropertyChanged(nameof(IsKindSick));
                OnPropertyChanged(nameof(IsKindTrip));
                OnPropertyChanged(nameof(IsKindOther));
            }
        }
    }

    /// <summary>Дата «С» (starts_on) — DatePicker, обязательна.</summary>
    public DateTime? StartsOn
    {
        get => _startsOn;
        set => SetProperty(ref _startsOn, value);
    }

    /// <summary>Дата «По» (ends_on) — DatePicker, обязательна, не раньше «С».</summary>
    public DateTime? EndsOn
    {
        get => _endsOn;
        set => SetProperty(ref _endsOn, value);
    }

    /// <summary>Комментарий (≤ 500 символов, опционально).</summary>
    public string Comment
    {
        get => _comment;
        set => SetProperty(ref _comment, value ?? string.Empty);
    }

    /// <summary>Отдел (опционально).</summary>
    public string Department
    {
        get => _department;
        set => SetProperty(ref _department, value ?? string.Empty);
    }

    // ---- Состояние ----

    /// <summary>Поля формы отключены на время запроса.</summary>
    public bool AreInputsEnabled => !IsBusy;

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
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string SubmitButtonText => IsBusy
        ? "Сохранение…"
        : IsCreateMode ? "Добавить" : "Сохранить";

    /// <summary>Ошибка валидации/сервера — плашка внутри формы, поля не стираются.</summary>
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

    /// <summary>Строка статуса внизу формы — «изменений нет» при пустом diff.</summary>
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

    public ICommand SubmitCommand { get; private set; } = new NativeRelayCommand(() => { });
    public ICommand CloseCommand { get; private set; } = new NativeRelayCommand(() => { });

    /// <summary>
    /// Сохранение: create → POST (обязательные проверяем до запроса);
    /// edit → PATCH только изменённых полей. false — диалог остаётся открытым.
    /// </summary>
    public async Task<bool> SubmitAsync(CancellationToken cancellationToken = default)
    {
        if (IsBusy)
        {
            return false;
        }

        ErrorText = null;
        StatusText = string.Empty;

        if (IsCreateMode)
        {
            var request = BuildCreateRequest(out var createError);
            if (createError is not null || request is null)
            {
                ErrorText = createError;
                return false;
            }

            IsBusy = true;
            try
            {
                var created = await _api.CreateHubAbsenceAsync(request, cancellationToken);
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

        var (patch, hasChanges, updateError) = BuildUpdateRequest();
        if (updateError is not null)
        {
            ErrorText = updateError;
            return false;
        }

        if (!hasChanges)
        {
            StatusText = "Изменений нет.";
            return false;
        }

        IsBusy = true;
        try
        {
            var updated = await _api.UpdateHubAbsenceAsync(_originalManageId, patch, cancellationToken);
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

    /// <summary>Тело POST: все поля формы; display_name/kind/dаты обязательны.</summary>
    internal HubAbsenceUpsertRequest? BuildCreateRequest(out string? error)
    {
        error = ValidateForm(out var start, out var end);
        if (error is not null)
        {
            return null;
        }

        return new HubAbsenceUpsertRequest
        {
            DisplayName = DisplayName.Trim(),
            Kind = _kind,
            StartsOn = FormatIsoDate(start),
            EndsOn = FormatIsoDate(end),
            Comment = NormalizeOptional(Comment),
            Department = NormalizeOptional(Department),
        };
    }

    /// <summary>
    /// Diff с исходной записью → тело PATCH: только изменённые поля
    /// (WhenWritingNull: неустановленное свойство ключа в JSON не даёт).
    /// Опциональное поле, очищенное в форме, уходит пустой строкой — сервер
    /// normalize → null, то есть сброс отличается от «поля нет в diff».
    /// </summary>
    internal (HubAbsenceUpsertRequest Request, bool HasChanges, string? Error) BuildUpdateRequest()
    {
        if (_original is null)
        {
            return (new HubAbsenceUpsertRequest(), false, null);
        }

        var error = ValidateForm(out var start, out var end);
        if (error is not null)
        {
            return (new HubAbsenceUpsertRequest(), false, error);
        }

        var displayName = TextChanged(DisplayName, _original.DisplayName)
            ? DisplayName.Trim()
            : null;
        var kind = !string.Equals(_kind, NormalizeKind(_original.Kind), StringComparison.Ordinal)
            ? _kind
            : null;
        var startsOn = start != ParseIsoDate(_original.StartsOn)
            ? FormatIsoDate(start)
            : null;
        var endsOn = end != ParseIsoDate(_original.EndsOn)
            ? FormatIsoDate(end)
            : null;
        var comment = TextChanged(Comment, _original.Comment)
            ? NormalizeOptional(Comment) ?? string.Empty
            : null;
        var department = TextChanged(Department, _original.Department)
            ? NormalizeOptional(Department) ?? string.Empty
            : null;

        var hasChanges = displayName is not null || kind is not null || startsOn is not null
            || endsOn is not null || comment is not null || department is not null;
        return (new HubAbsenceUpsertRequest
        {
            DisplayName = displayName,
            Kind = kind,
            StartsOn = startsOn,
            EndsOn = endsOn,
            Comment = comment,
            Department = department,
        }, hasChanges, null);
    }

    /// <summary>
    /// Общая валидация формы (до запроса): ФИО обязательно, обе даты обязательны,
    /// «По» не раньше «С», комментарий ≤ 500.
    /// </summary>
    private string? ValidateForm(out DateTime start, out DateTime end)
    {
        start = default;
        end = default;
        if (string.IsNullOrWhiteSpace(DisplayName))
        {
            return "Укажите ФИО сотрудника.";
        }

        if (StartsOn is null || EndsOn is null)
        {
            return "Укажите даты «С» и «По».";
        }

        if (EndsOn.Value.Date < StartsOn.Value.Date)
        {
            return "Дата «По» не может быть раньше даты «С».";
        }

        if (Comment.Trim().Length > CommentMaxLength)
        {
            return $"Комментарий — не более {CommentMaxLength} символов.";
        }

        start = StartsOn.Value.Date;
        end = EndsOn.Value.Date;
        return null;
    }

    private static string NormalizeKind(string? kind) =>
        KindValues.Contains(kind?.Trim(), StringComparer.Ordinal)
            ? kind!.Trim()
            : "other";

    private static string? NormalizeOptional(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim();
        return trimmed.Length > 0 ? trimmed : null;
    }

    private static bool TextChanged(string? current, string? original) =>
        !string.Equals(NormalizeOptional(current), NormalizeOptional(original), StringComparison.Ordinal);

    internal static DateTime? ParseIsoDate(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return DateTime.TryParseExact(
            text.Length > 10 ? text[..10] : text,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsed)
            ? parsed.Date
            : null;
    }

    private static string FormatIsoDate(DateTime date) =>
        date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
