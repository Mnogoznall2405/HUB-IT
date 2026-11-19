using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Строка списка «Отсутствия»: имя, тип, диапазон дат и источник (ручная запись HUB или ЗУП).
/// </summary>
public sealed class AbsenceListItemViewModel
{
    public AbsenceListItemViewModel(HubAbsenceItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id;
        DisplayName = string.IsNullOrWhiteSpace(item.DisplayName)
            ? "Сотрудник"
            : item.DisplayName!;
        KindLabel = string.IsNullOrWhiteSpace(item.KindLabel)
            ? FormatKind(item.Kind)
            : item.KindLabel!;
        RangeText = FormatRange(item.StartsOn, item.EndsOn);
        IsManual = item.Source == "hub";
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

    /// <summary>id ручной записи HUB (у записей ЗУП пустой).</summary>
    public string? Id { get; }
    public string DisplayName { get; }
    public string Initials { get; }
    public string KindLabel { get; }
    public string RangeText { get; }
    public string SourceText { get; }

    /// <summary>Ручная запись HUB (source="hub"); записи ЗУП read-only.</summary>
    public bool IsManual { get; }

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
/// командировка) на день или за неделю. Read-only свод ручных записей HUB и ЗУП
/// с клиентским поиском по имени и фильтром источника записи.
/// </summary>
public sealed class AbsencesViewModel : ObservableObject
{
    /// <summary>Верхняя граница выборки (backend допускает до 500).</summary>
    private const int LoadLimit = 500;

    /// <summary>Длина недельного диапазона в днях: starts_on … starts_on+6.</summary>
    private const int WeekLengthDays = 7;

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

    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
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
                rows.Add(new AbsenceListItemViewModel(item));
            }

            foreach (var item in result.ZupItems ?? [])
            {
                rows.Add(new AbsenceListItemViewModel(item));
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
        BannerErrorText = null;
        IsLoading = false;
        IsWeekMode = false;
        SelectedDate = DateTime.Today;
        SearchText = string.Empty;
        SourceFilter = "all";
        HeaderText = BuildHeaderText();
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
