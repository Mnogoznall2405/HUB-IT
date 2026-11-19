using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Опция фильтра справочника адресной книги (Value=null — «все»).</summary>
public sealed class AddressBookFilterItem
{
    public AddressBookFilterItem(string? value, string label)
    {
        Value = value;
        Label = label;
    }

    public string? Value { get; }
    public string Label { get; }
}

/// <summary>Строка контакта в карточке: «Вид — значение» (kind из ЗУП или подпись секции).</summary>
public sealed class AddressBookContactLineViewModel
{
    public AddressBookContactLineViewModel(string label, string value)
    {
        Label = label;
        Value = value;
    }

    public string Label { get; }
    public string Value { get; }
    public string DisplayText => string.IsNullOrWhiteSpace(Label) ? Value : $"{Label}: {Value}";
}

/// <summary>Нормализация телефонов — зеркало normalizePhoneDigits/pickPrimaryPhone веба.</summary>
internal static class AddressBookPhones
{
    /// <summary>Только цифры; 8XXXXXXXXXX → 7X…, 10 цифр → добавляет код страны 7.</summary>
    internal static string NormalizeDigits(string? value)
    {
        var digits = string.Concat((value ?? string.Empty).Where(char.IsDigit));
        if (digits.Length == 11 && digits.StartsWith('8'))
        {
            return "7" + digits[1..];
        }

        if (digits.Length == 10)
        {
            return "7" + digits;
        }

        return digits;
    }

    /// <summary>Основной номер: сначала рабочие, мобильный вид предпочтительнее.</summary>
    internal static HubAddressBookContactValue? PickPrimary(HubAddressBookItem item)
    {
        return PickFrom(item.WorkPhones) ?? PickFrom(item.PersonalPhones);
    }

    private static HubAddressBookContactValue? PickFrom(IReadOnlyList<HubAddressBookContactValue>? phones)
    {
        if (phones is null || phones.Count == 0)
        {
            return null;
        }

        return phones.FirstOrDefault(IsMobileKind) ?? phones[0];
    }

    private static bool IsMobileKind(HubAddressBookContactValue? phone) =>
        phone?.Kind is { } kind
        && (kind.Contains("мобил", StringComparison.OrdinalIgnoreCase)
            || kind.Contains("mobile", StringComparison.OrdinalIgnoreCase)
            || kind.Contains("сотов", StringComparison.OrdinalIgnoreCase));
}

/// <summary>Форматеры карточки контакта — зеркало formatAge/formatDate веба.</summary>
internal static class AddressBookFormat
{
    /// <summary>«36 лет»/«1 год»/«22 года» — русская плюрализация как formatAge в вебе.</summary>
    internal static string FormatAge(int? value)
    {
        if (value is not { } age || age < 0 || age > 120)
        {
            return string.Empty;
        }

        var lastTwo = age % 100;
        var last = age % 10;
        var unit = "лет";
        if (lastTwo < 11 || lastTwo > 14)
        {
            if (last == 1)
            {
                unit = "год";
            }
            else if (last is >= 2 and <= 4)
            {
                unit = "года";
            }
        }

        return $"{age.ToString(CultureInfo.CurrentCulture)} {unit}";
    }

    /// <summary>isoformat-дата → dd.MM.yyyy; пустые/битые значения → "".</summary>
    internal static string FormatDate(string? value)
    {
        var text = (value ?? string.Empty).Trim();
        return DateTime.TryParseExact(
            text.Length > 10 ? text[..10] : text,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.None,
            out var parsed)
            ? parsed.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture)
            : string.Empty;
    }
}

/// <summary>
/// Сотрудник в списке и карточке адресной книги. Фото грузится best-effort
/// через AuthImageLoader (endpoint /address-book/photos требует Bearer);
/// до его прихода и при ошибке показываем инициалы, как аватары чата.
/// </summary>
public sealed class AddressBookEntryViewModel : ObservableObject
{
    private ImageSource? _photoImage;

    public AddressBookEntryViewModel(HubAddressBookItem item, AuthImageLoader? imageLoader = null)
    {
        ArgumentNullException.ThrowIfNull(item);
        Model = item;
        FullName = string.IsNullOrWhiteSpace(item.FullName) ? "Сотрудник" : item.FullName!.Trim();
        Initials = BuildInitials(FullName);
        PhotoUrl = (item.PhotoUrl ?? string.Empty).Trim();

        var position = (item.Position ?? string.Empty).Trim();
        var department = (item.Department ?? string.Empty).Trim();
        Subtitle = position.Length > 0 && department.Length > 0
            ? $"{position} · {department}"
            : position.Length > 0 ? position : department;

        var primaryPhone = AddressBookPhones.PickPrimary(item);
        PrimaryPhoneText = (primaryPhone?.Value ?? string.Empty).Trim();
        var phoneDigits = (primaryPhone?.Normalized ?? string.Empty).Trim();
        if (phoneDigits.Length == 0)
        {
            phoneDigits = AddressBookPhones.NormalizeDigits(primaryPhone?.Value);
        }

        // tel:-ссылка веба: tel:+digits при наличии цифр, иначе tel:сырое значение.
        CallUri = phoneDigits.Length > 0
            ? $"tel:+{phoneDigits}"
            : PrimaryPhoneText.Length > 0 ? $"tel:{PrimaryPhoneText}" : null;

        var primaryEmail = item.WorkEmails?.FirstOrDefault();
        PrimaryEmailText = (primaryEmail?.Value ?? string.Empty).Trim();
        EmailUri = PrimaryEmailText.Contains('@') ? $"mailto:{PrimaryEmailText}" : null;

        var ageText = AddressBookFormat.FormatAge(item.Age);
        MetaText = string.Join(
            " · ",
            new[]
            {
                position.Length > 0 ? position : "Должность не указана",
                ageText,
            }.Where(part => part.Length > 0));

        Phones = BuildLines(item.WorkPhones, "Рабочий")
            .Concat(BuildLines(item.PersonalPhones, "Личный"))
            .ToArray();
        Emails = BuildLines(item.WorkEmails, "Рабочий e-mail")
            .Concat(BuildLines(item.PersonalEmails, "Личный e-mail"))
            .ToArray();

        DepartmentText = department;
        DepartmentCodeText = (item.DepartmentCode ?? string.Empty).Trim();
        CityText = (item.DepartmentLocation ?? string.Empty).Trim();
        WorkplaceText = BuildWorkplace(item);
        EmployeeCodeText = (item.EmployeeCode ?? string.Empty).Trim();
        HireDateText = AddressBookFormat.FormatDate(item.HireDate);
        MiddleNameText = (item.MiddleName ?? string.Empty).Trim();
        AgeText = ageText;
        InnText = (item.Inn ?? string.Empty).Trim();

        if (imageLoader is not null && PhotoUrl.Length > 0)
        {
            _ = LoadPhotoAsync(imageLoader);
        }
    }

    public HubAddressBookItem Model { get; }
    public string FullName { get; }
    public string Initials { get; }

    /// <summary>Ссылка на фото из выдачи (пустая — запрос не делаем).</summary>
    public string PhotoUrl { get; }

    /// <summary>Загруженное фото (замороженный BitmapImage) — null пока грузится или при ошибке.</summary>
    public ImageSource? PhotoImage
    {
        get => _photoImage;
        private set
        {
            if (SetProperty(ref _photoImage, value))
            {
                OnPropertyChanged(nameof(HasPhoto));
            }
        }
    }

    /// <summary>Фото пришло — аватар показывает снимок вместо инициалов.</summary>
    public bool HasPhoto => PhotoImage is not null;
    public string Subtitle { get; }
    public string PrimaryPhoneText { get; }
    public string PrimaryEmailText { get; }
    public string MetaText { get; }

    /// <summary>tel: ссылка основного номера (null — звонить некуда).</summary>
    public string? CallUri { get; }

    /// <summary>mailto: ссылка основного рабочего e-mail (null — нет адреса).</summary>
    public string? EmailUri { get; }

    public bool CanCall => CallUri is not null;
    public bool CanEmail => EmailUri is not null;

    public IReadOnlyList<AddressBookContactLineViewModel> Phones { get; }
    public IReadOnlyList<AddressBookContactLineViewModel> Emails { get; }

    public string DepartmentText { get; }
    public string DepartmentCodeText { get; }
    public string CityText { get; }
    public string WorkplaceText { get; }
    public string EmployeeCodeText { get; }
    public string HireDateText { get; }
    public string MiddleNameText { get; }
    public string AgeText { get; }
    public string InnText { get; }

    public bool HasContacts => Phones.Count > 0 || Emails.Count > 0;
    public bool HasWorkMeta =>
        DepartmentText.Length > 0
        || DepartmentCodeText.Length > 0
        || CityText.Length > 0
        || WorkplaceText.Length > 0
        || EmployeeCodeText.Length > 0
        || HireDateText.Length > 0;
    public bool HasPersonalMeta =>
        MiddleNameText.Length > 0 || AgeText.Length > 0 || InnText.Length > 0;

    /// <summary>
    /// Ленивая загрузка фото после создания строки списка: не блокирует выдачу,
    /// loader сам возвращает null при любой ошибке — инициалы остаются.
    /// </summary>
    private async Task LoadPhotoAsync(AuthImageLoader imageLoader)
    {
        var image = await imageLoader.LoadAsync(PhotoUrl);
        if (image is not null)
        {
            PhotoImage = image;
        }
    }

    private static IReadOnlyList<AddressBookContactLineViewModel> BuildLines(
        IReadOnlyList<HubAddressBookContactValue>? values,
        string fallbackLabel)
    {
        if (values is null)
        {
            return [];
        }

        var lines = new List<AddressBookContactLineViewModel>(values.Count);
        foreach (var contact in values)
        {
            var value = (contact?.Value ?? string.Empty).Trim();
            if (value.Length == 0)
            {
                continue;
            }

            var label = LocalizeContactKind(contact?.Kind);
            lines.Add(new AddressBookContactLineViewModel(
                label.Length > 0 ? label : fallbackLabel,
                value));
        }

        return lines;
    }

    /// <summary>
    /// kind из синка/источника → короткая русская метка («work» → «раб.»).
    /// Неизвестные значения идут как пришли — источник может отдавать и
    /// русские подписи; пустые остаются пустыми (подставится fallbackLabel).
    /// </summary>
    internal static string LocalizeContactKind(string? kind)
    {
        var value = (kind ?? string.Empty).Trim();
        return value.ToLowerInvariant() switch
        {
            "work" or "office" or "рабочий" => "раб.",
            "mobile" or "cell" or "мобильный" or "сотовый" => "моб.",
            "home" or "домашний" => "дом.",
            "fax" or "факс" => "факс",
            "pager" or "пейджер" => "пейдж.",
            _ => value,
        };
    }

    /// <summary>«адрес · каб. N · рм M» — как workplaceLabel в вебе («0» не показываем).</summary>
    private static string BuildWorkplace(HubAddressBookItem item)
    {
        var room = (item.OfficeRoom ?? string.Empty).Trim();
        var workplace = (item.WorkplaceNumber ?? string.Empty).Trim();
        return string.Join(
            " · ",
            new[]
            {
                (item.OfficeAddress ?? string.Empty).Trim(),
                room.Length > 0 && room != "0" ? $"каб. {room}" : string.Empty,
                workplace.Length > 0 && workplace != "0" ? $"рм {workplace}" : string.Empty,
            }.Where(part => part.Length > 0));
    }

    private static string BuildInitials(string fullName)
    {
        var parts = fullName.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2)
        {
            return string.Concat(
                char.ToUpperInvariant(parts[0][0]),
                char.ToUpperInvariant(parts[1][0]));
        }

        return parts.Length == 1 && parts[0].Length > 0
            ? parts[0][..Math.Min(2, parts[0].Length)].ToUpperInvariant()
            : "?";
    }
}

/// <summary>
/// Страница «Адресная книга» нативного шелла: серверный поиск с debounce,
/// фильтры подразделения/города из GET /address-book/filters, offset-пагинация
/// «Показать ещё» и карточка контакта с tel:/mailto: действиями.
/// </summary>
public sealed class AddressBookViewModel : ObservableObject
{
    /// <summary>Размер страницы (веб: SEARCH_LIMIT = 50).</summary>
    private const int PageSize = 50;

    /// <summary>Debounce серверного поиска (веб: 300мс; у соседних экранов 400мс).</summary>
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);

    private readonly IHubApiClient _api;
    private readonly AuthImageLoader _imageLoader;
    private CancellationTokenSource? _searchCancellation;
    private bool _suppressFilterEvents;

    private AddressBookEntryViewModel? _selectedItem;
    private string _searchText = string.Empty;
    private AddressBookFilterItem? _selectedDepartmentFilter;
    private AddressBookFilterItem? _selectedCityFilter;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _total;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public AddressBookViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);

        DepartmentFilterOptions.Add(AllDepartments);
        CityFilterOptions.Add(AllCities);
        _selectedDepartmentFilter = AllDepartments;
        _selectedCityFilter = AllCities;

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        SelectDepartmentFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AddressBookFilterItem option)
            {
                SelectedDepartmentFilter = option;
            }
        });
        SelectCityFilterCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is AddressBookFilterItem option)
            {
                SelectedCityFilter = option;
            }
        });
        ClearFiltersCommand = new NativeRelayCommand(() =>
        {
            _suppressFilterEvents = true;
            SelectedDepartmentFilter = AllDepartments;
            SelectedCityFilter = AllCities;
            _suppressFilterEvents = false;
            ReloadFromFilterChange();
        });
        CallCommand = new NativeRelayCommand(
            parameter => OpenUri((parameter as AddressBookEntryViewModel)?.CallUri),
            parameter => parameter is AddressBookEntryViewModel { CanCall: true });
        EmailCommand = new NativeRelayCommand(
            parameter => OpenUri((parameter as AddressBookEntryViewModel)?.EmailUri),
            parameter => parameter is AddressBookEntryViewModel { CanEmail: true });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        Items.CollectionChanged += (_, _) =>
        {
            NotifyEmptyState();
            OnPropertyChanged(nameof(MoreButtonText));
            OnPropertyChanged(nameof(TotalText));
        };
    }

    /// <summary>IsEmpty + тексты пустого состояния меняются вместе с выдачей/поиском/фильтрами.</summary>
    private void NotifyEmptyState()
    {
        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(EmptyTitleText));
        OnPropertyChanged(nameof(EmptyHintText));
    }

    private static AddressBookFilterItem AllDepartments { get; } = new(null, "Все подразделения");
    private static AddressBookFilterItem AllCities { get; } = new(null, "Все города");

    // ---- Список и фильтры ----

    public ObservableCollection<AddressBookEntryViewModel> Items { get; } = [];

    /// <summary>Фильтр подразделения: «Все подразделения» + справочник GET /filters.</summary>
    public ObservableCollection<AddressBookFilterItem> DepartmentFilterOptions { get; } = [];

    /// <summary>Фильтр города (department_location): «Все города» + справочник.</summary>
    public ObservableCollection<AddressBookFilterItem> CityFilterOptions { get; } = [];

    public AddressBookFilterItem? SelectedDepartmentFilter
    {
        get => _selectedDepartmentFilter;
        set
        {
            if (SetProperty(ref _selectedDepartmentFilter, value))
            {
                OnPropertyChanged(nameof(SelectedDepartmentFilterText));
                OnPropertyChanged(nameof(HasActiveFilters));
                NotifyEmptyState();
                ReloadFromFilterChange();
            }
        }
    }

    /// <summary>Подпись кнопки фильтра: «Подразделение: ИТ-отдел ▾».</summary>
    public string SelectedDepartmentFilterText =>
        SelectedDepartmentFilter?.Label ?? AllDepartments.Label;

    public AddressBookFilterItem? SelectedCityFilter
    {
        get => _selectedCityFilter;
        set
        {
            if (SetProperty(ref _selectedCityFilter, value))
            {
                OnPropertyChanged(nameof(SelectedCityFilterText));
                OnPropertyChanged(nameof(HasActiveFilters));
                NotifyEmptyState();
                ReloadFromFilterChange();
            }
        }
    }

    public string SelectedCityFilterText => SelectedCityFilter?.Label ?? AllCities.Label;

    /// <summary>Хотя бы один справочный фильтр активен — показываем «Сбросить фильтры».</summary>
    public bool HasActiveFilters =>
        SelectedDepartmentFilter?.Value is not null || SelectedCityFilter?.Value is not null;

    /// <summary>Выбранный сотрудник: карточка справа читает ту же модель, что и строка списка.</summary>
    public AddressBookEntryViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
            }
        }
    }

    public bool HasDetail => SelectedItem is not null;

    /// <summary>Заглушка «выберите сотрудника» — карточки нет.</summary>
    public bool ShowDetailPlaceholder => SelectedItem is null;

    /// <summary>Серверный поиск: изменение строки запускает debounce-перезагрузку списка.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                NotifyEmptyState();
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
                NotifyEmptyState();
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

    /// <summary>На сервере есть ещё записи (has_more из ответа поиска).</summary>
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
                NotifyEmptyState();
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    /// <summary>«Найдено N» / «Найдено N, показано M» — как countLabel в вебе.</summary>
    public string TotalText => _total > Items.Count
        ? $"Найдено {_total.ToString(CultureInfo.CurrentCulture)}, показано {Items.Count.ToString(CultureInfo.CurrentCulture)}"
        : $"Найдено {_total.ToString(CultureInfo.CurrentCulture)}";

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    /// <summary>Пустая выдача без ошибки и загрузки.</summary>
    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    /// <summary>Заголовок пустого состояния: при активном поиске/фильтре — «не совпало».</summary>
    public string EmptyTitleText => HasActiveQuery
        ? "Никого не найдено"
        : "Адресная книга пуста";

    public string EmptyHintText => HasActiveQuery
        ? "Попробуйте изменить поиск или сбросить фильтры."
        : "Попробуйте обновить адресную книгу.";

    private bool HasActiveQuery =>
        _searchText.Trim().Length > 0 || HasActiveFilters;

    public ICommand RefreshCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand SelectDepartmentFilterCommand { get; }
    public ICommand SelectCityFilterCommand { get; }
    public ICommand ClearFiltersCommand { get; }
    public ICommand CallCommand { get; }
    public ICommand EmailCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>
    /// Шов открытия tel:/mailto: ссылок («Позвонить»/«Написать»): по умолчанию
    /// Process.Start оболочкой ОС, тесты подменяют записывающим делегатом.
    /// </summary>
    public Action<string>? UriOpener { get; set; }

    private HubAddressBookQuery BuildQuery(int offset) => new()
    {
        // Как в вебе: q уходит как есть — минимальной длины у поиска нет.
        Search = _searchText.Trim(),
        Limit = PageSize,
        Offset = offset,
        Department = SelectedDepartmentFilter?.Value,
        City = SelectedCityFilter?.Value,
    };

    /// <summary>Первичная загрузка/обновление: справочники фильтров → первая страница.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            await LoadFiltersSafelyAsync(cancellationToken);
            await LoadListPageAsync(offset: 0, replace: true, cancellationToken);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    private async Task LoadFiltersSafelyAsync(CancellationToken cancellationToken)
    {
        try
        {
            var filters = await _api.GetAddressBookFiltersAsync(cancellationToken);
            ApplyFilters(filters);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch
        {
            // Справочники нужны только для фильтров — список грузим и без них.
        }
    }

    private void ApplyFilters(HubAddressBookFilters filters)
    {
        var selectedDepartment = SelectedDepartmentFilter?.Value;
        var selectedCity = SelectedCityFilter?.Value;

        DepartmentFilterOptions.Clear();
        DepartmentFilterOptions.Add(AllDepartments);
        foreach (var option in filters.Departments ?? [])
        {
            var name = (option.Name ?? string.Empty).Trim();
            if (name.Length > 0)
            {
                DepartmentFilterOptions.Add(new AddressBookFilterItem(name, OptionLabel(name, option.Count)));
            }
        }

        CityFilterOptions.Clear();
        CityFilterOptions.Add(AllCities);
        foreach (var option in filters.Cities ?? [])
        {
            var name = (option.Name ?? string.Empty).Trim();
            if (name.Length > 0)
            {
                CityFilterOptions.Add(new AddressBookFilterItem(name, OptionLabel(name, option.Count)));
            }
        }

        _suppressFilterEvents = true;
        RestoreFilterSelection(DepartmentFilterOptions, selectedDepartment,
            option => _selectedDepartmentFilter = option);
        RestoreFilterSelection(CityFilterOptions, selectedCity,
            option => _selectedCityFilter = option);
        _suppressFilterEvents = false;
        OnPropertyChanged(nameof(SelectedDepartmentFilter));
        OnPropertyChanged(nameof(SelectedDepartmentFilterText));
        OnPropertyChanged(nameof(SelectedCityFilter));
        OnPropertyChanged(nameof(SelectedCityFilterText));
        OnPropertyChanged(nameof(HasActiveFilters));
    }

    /// <summary>Подпись опции меню: «ИТ-отдел (12)» — count из справочника, как в вебе.</summary>
    private static string OptionLabel(string name, int count) =>
        count > 0 ? $"{name} ({count.ToString(CultureInfo.CurrentCulture)})" : name;

    /// <summary>Выбор фильтра переживает перечитывание справочника (совпадение по Value).</summary>
    private static void RestoreFilterSelection(
        ObservableCollection<AddressBookFilterItem> options,
        string? previousValue,
        Action<AddressBookFilterItem> apply)
    {
        var restored = previousValue is null
            ? options[0]
            : options.FirstOrDefault(option => option.Value == previousValue) ?? options[0];
        apply(restored);
    }

    private async Task LoadListPageAsync(int offset, bool replace, CancellationToken cancellationToken)
    {
        var result = await _api.SearchAddressBookAsync(BuildQuery(offset), cancellationToken);
        if (replace)
        {
            Items.Clear();
            SelectedItem = null;
        }

        _total = result.Total;
        HasMore = result.HasMore;
        foreach (var item in result.Items ?? [])
        {
            Items.Add(new AddressBookEntryViewModel(item, _imageLoader));
        }

        OnPropertyChanged(nameof(TotalText));
    }

    /// <summary>Догрузка следующей страницы в конец списка («Показать ещё»).</summary>
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            await LoadListPageAsync(Items.Count, replace: false, cancellationToken);
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    /// <summary>Смена фильтра: список перечитывается с первой страницы.</summary>
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
            IsLoading = true;
            try
            {
                await LoadListPageAsync(offset: 0, replace: true, CancellationToken.None);
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

    /// <summary>Debounce поиска: запрос уходит на сервер по текущим фильтрам.</summary>
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

    private void OpenUri(string? uri)
    {
        if (string.IsNullOrWhiteSpace(uri))
        {
            return;
        }

        try
        {
            if (UriOpener is not null)
            {
                UriOpener(uri);
                return;
            }

            Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
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
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        _suppressFilterEvents = true;
        Items.Clear();
        SelectedItem = null;
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        DepartmentFilterOptions.Clear();
        DepartmentFilterOptions.Add(AllDepartments);
        _selectedDepartmentFilter = AllDepartments;
        OnPropertyChanged(nameof(SelectedDepartmentFilter));
        OnPropertyChanged(nameof(SelectedDepartmentFilterText));
        CityFilterOptions.Clear();
        CityFilterOptions.Add(AllCities);
        _selectedCityFilter = AllCities;
        OnPropertyChanged(nameof(SelectedCityFilter));
        OnPropertyChanged(nameof(SelectedCityFilterText));
        _suppressFilterEvents = false;
        OnPropertyChanged(nameof(HasActiveFilters));
        _total = 0;
        HasMore = false;
        OnPropertyChanged(nameof(TotalText));
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        NotifyEmptyState();
    }
}
