using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Узел дерева «Структуры компании». Подпись как nodeCardTitle в вебе:
/// title, у person-узлов без title — person_position, иначе «Без названия».
/// IsExpanded/IsSelected двусторонне связаны с TreeViewItem (ItemContainerStyle).
/// </summary>
public sealed class CompanyStructureNodeViewModel : ObservableObject
{
    private bool _isExpanded;
    private bool _isSelected;
    private ImageSource? _photoImage;

    public CompanyStructureNodeViewModel(
        HubCompanyStructureNode node,
        CompanyStructureNodeViewModel? parent,
        AuthImageLoader? imageLoader = null)
    {
        ArgumentNullException.ThrowIfNull(node);
        Model = node;
        Parent = parent;
        Id = (node.Id ?? string.Empty).Trim();
        NodeType = (node.NodeType ?? string.Empty).Trim();

        var title = (node.Title ?? string.Empty).Trim();
        var personPosition = (node.PersonPosition ?? string.Empty).Trim();
        var personName = (node.PersonName ?? string.Empty).Trim();
        Title = title.Length > 0
            ? title
            : personPosition.Length > 0 ? personPosition : "Без названия";
        // Подзаголовок — человек на карточке (как subtitle у node-результатов поиска).
        SubtitleText = personName.Length > 0 && personName != Title
            ? personName
            : personPosition.Length > 0 && personPosition != Title ? personPosition : string.Empty;
        // Запасная метка шара узла: инициалы подразделения, когда фото нет.
        Initials = CompanyStructurePersonViewModel.BuildInitials(Title);

        PeopleCount = Math.Max(0, node.SubtreePeopleCount);
        PeopleCountText = PeopleCount > 0
            ? PeopleCount.ToString(CultureInfo.CurrentCulture)
            : string.Empty;

        // Фото руководителя узла (root/deputy-карточки веба): person_photo_url
        // ведёт на авторизованный /nodes/{id}/photo — грузим через loader,
        // до прихода и при ошибке аватар не показываем.
        PhotoUrl = (node.PersonPhotoUrl ?? string.Empty).Trim();
        if (imageLoader is not null && PhotoUrl.Length > 0)
        {
            _ = LoadPhotoAsync(imageLoader);
        }

        foreach (var child in node.Children ?? [])
        {
            Children.Add(new CompanyStructureNodeViewModel(child, this, imageLoader));
        }
    }

    public HubCompanyStructureNode Model { get; }
    public CompanyStructureNodeViewModel? Parent { get; }
    public string Id { get; }
    public string NodeType { get; }
    public string Title { get; }
    public string SubtitleText { get; }

    /// <summary>Инициалы подразделения — показываются в шаре, когда фото руководителя нет.</summary>
    public string Initials { get; }

    public int PeopleCount { get; }

    /// <summary>Ссылка на фото руководителя узла из дерева (пустая — запрос не делаем).</summary>
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

    /// <summary>Фото пришло — карточка узла показывает снимок руководителя.</summary>
    public bool HasPhoto => PhotoImage is not null;

    /// <summary>Ленивая загрузка фото: не блокирует построение дерева.</summary>
    private async Task LoadPhotoAsync(AuthImageLoader imageLoader)
    {
        var image = await imageLoader.LoadAsync(PhotoUrl);
        if (image is not null)
        {
            PhotoImage = image;
        }
    }

    /// <summary>Бейдж «N сотрудников» в поддереве; пусто при нуле.</summary>
    public string PeopleCountText { get; }

    public ObservableCollection<CompanyStructureNodeViewModel> Children { get; } = [];

    /// <summary>Раскрытие ветки (поиск раскрывает путь к найденному узлу).</summary>
    public bool IsExpanded
    {
        get => _isExpanded;
        set => SetProperty(ref _isExpanded, value);
    }

    /// <summary>Выбор узла: TreeViewItem.IsSelected ⇄ VM, дальше в SelectedNode.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>
/// Сотрудник узла в списке и карточке. Контракт отдаёт только рабочие поля;
/// фото не грузим (авторизованный endpoint) — показываем инициалы, как в чате.
/// </summary>
public sealed class CompanyStructurePersonViewModel
{
    public CompanyStructurePersonViewModel(HubCompanyStructurePerson person)
    {
        ArgumentNullException.ThrowIfNull(person);
        Model = person;
        FullName = string.IsNullOrWhiteSpace(person.FullName) ? "Сотрудник" : person.FullName.Trim();
        Initials = BuildInitials(FullName);

        PositionText = (person.Position ?? string.Empty).Trim();
        var department = (person.Department ?? string.Empty).Trim();
        // Веб не дублирует подразделение, если оно совпадает с должностью.
        DepartmentText = department.Length > 0 && department != PositionText ? department : string.Empty;
        LocationText = (person.DepartmentLocation ?? string.Empty).Trim();

        Subtitle = PositionText.Length > 0 && DepartmentText.Length > 0
            ? $"{PositionText} · {DepartmentText}"
            : PositionText.Length > 0 ? PositionText : DepartmentText;

        Phones = (person.WorkPhones ?? [])
            .Select(value => (value ?? string.Empty).Trim())
            .Where(value => value.Length > 0)
            .ToArray();
        Emails = (person.WorkEmails ?? [])
            .Select(value => (value ?? string.Empty).Trim())
            .Where(value => value.Length > 0)
            .ToArray();

        PrimaryPhoneText = Phones.FirstOrDefault() ?? string.Empty;
        PrimaryEmailText = Emails.FirstOrDefault() ?? string.Empty;
        // tel:-ссылка веба: String(phone).replace(/[^+\d]/g, '') — остаются цифры и '+'.
        var phoneLink = string.Concat(PrimaryPhoneText.Where(ch => char.IsDigit(ch) || ch == '+'));
        CallUri = phoneLink.Any(char.IsDigit) ? $"tel:{phoneLink}" : null;
        EmailUri = PrimaryEmailText.Contains('@') ? $"mailto:{PrimaryEmailText}" : null;
    }

    public HubCompanyStructurePerson Model { get; }
    public string FullName { get; }
    public string Initials { get; }
    public string PositionText { get; }
    public string DepartmentText { get; }
    public string LocationText { get; }

    /// <summary>Вторая строка списка: «должность · подразделение» (может быть пустой).</summary>
    public string Subtitle { get; }

    public IReadOnlyList<string> Phones { get; }
    public IReadOnlyList<string> Emails { get; }
    public string PrimaryPhoneText { get; }
    public string PrimaryEmailText { get; }

    /// <summary>tel: ссылка основного номера (null — звонить некуда).</summary>
    public string? CallUri { get; }

    /// <summary>mailto: ссылка основного рабочего e-mail (null — нет адреса).</summary>
    public string? EmailUri { get; }

    public bool CanCall => CallUri is not null;
    public bool CanEmail => EmailUri is not null;
    public bool HasContacts => Phones.Count > 0 || Emails.Count > 0;
    public bool HasWorkMeta => DepartmentText.Length > 0 || LocationText.Length > 0;

    internal static string BuildInitials(string fullName)
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

/// <summary>Строка выдачи поиска: подразделение (kind=node) или сотрудник (kind=person).</summary>
public sealed class CompanyStructureSearchItemViewModel
{
    public CompanyStructureSearchItemViewModel(HubCompanyStructureSearchItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Model = item;
        IsPerson = string.Equals(item.Kind, "person", StringComparison.OrdinalIgnoreCase);
        NodeId = (item.NodeId ?? string.Empty).Trim();
        Title = (item.Title ?? string.Empty).Trim();
        SubtitleText = IsPerson
            ? (item.Subtitle ?? string.Empty).Trim()
            : "Подразделение";
        var location = (item.DepartmentLocation ?? string.Empty).Trim();
        var path = string.Join(
            " / ",
            (item.Path ?? [])
                .Select(part => (part?.Title ?? string.Empty).Trim())
                .Where(part => part.Length > 0));
        MetaText = string.Join(
            " · ",
            new[] { location, path }.Where(part => part.Length > 0));
    }

    public HubCompanyStructureSearchItem Model { get; }
    public bool IsPerson { get; }
    public string NodeId { get; }
    public string Title { get; }
    public string SubtitleText { get; }

    /// <summary>«город · Корень / Блок / Отдел» — как secondary у опций веб-автоподсказки.</summary>
    public string MetaText { get; }

    /// <summary>person-результат → модель карточки (searchPersonToDirectoryPerson в вебе).</summary>
    public CompanyStructurePersonViewModel ToPersonViewModel()
    {
        var item = Model;
        return new CompanyStructurePersonViewModel(new HubCompanyStructurePerson
        {
            FullName = item.Title,
            Position = item.Subtitle,
            Department = item.Department,
            DepartmentLocation = item.DepartmentLocation,
            WorkPhones = item.WorkPhones,
            WorkEmails = item.WorkEmails,
        });
    }
}

/// <summary>
/// Страница «Структура компании» нативного шелла (read-only срез):
/// GET /tree целиком, выбор узла → GET nodes/{id}/people, серверный поиск
/// с debounce (веб: от 2 символов) и карточка сотрудника с tel:/mailto:.
/// </summary>
public sealed class CompanyStructureViewModel : ObservableObject
{
    /// <summary>Сотрудники узла: веб getNodePeople — limit=2000, include_descendants=true.</summary>
    private const int PeopleLimit = 2000;

    /// <summary>Автоподсказка веба стартует от 2 символов; limit=30, debounce ~250-350мс.</summary>
    private const int SearchMinLength = 2;
    private const int SearchLimit = 30;
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);

    private readonly IHubApiClient _api;
    private readonly AuthImageLoader _imageLoader;
    private readonly Dictionary<string, CompanyStructureNodeViewModel> _nodesById = new(StringComparer.Ordinal);
    private CancellationTokenSource? _searchCancellation;
    private int _peopleLoadVersion;
    private string? _pendingPersonName;

    private CompanyStructureNodeViewModel? _selectedNode;
    private CompanyStructurePersonViewModel? _selectedPerson;
    private string _searchText = string.Empty;
    private bool _isSearchPopupOpen;
    private bool _isLoading;
    private bool _isPeopleLoading;
    private bool _isSearching;
    private int _peopleTotal;
    private string? _bannerErrorText;
    private string _lastUpdatedText = string.Empty;

    public CompanyStructureViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectSearchResultCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is CompanyStructureSearchItemViewModel item)
            {
                ApplySearchResult(item);
            }
        });
        CallCommand = new NativeRelayCommand(
            parameter => OpenUri((parameter as CompanyStructurePersonViewModel)?.CallUri),
            parameter => parameter is CompanyStructurePersonViewModel { CanCall: true });
        EmailCommand = new NativeRelayCommand(
            parameter => OpenUri((parameter as CompanyStructurePersonViewModel)?.EmailUri),
            parameter => parameter is CompanyStructurePersonViewModel { CanEmail: true });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        People.CollectionChanged += (_, _) => NotifyPeopleEmptyState();
    }

    // ---- Дерево ----

    public ObservableCollection<CompanyStructureNodeViewModel> RootNodes { get; } = [];

    /// <summary>
    /// Выбранный узел (список сотрудников грузится под него). Присваивается из
    /// TreeView.SelectedItemChanged в представлении и из поиска через SelectNodeById.
    /// </summary>
    public CompanyStructureNodeViewModel? SelectedNode
    {
        get => _selectedNode;
        set
        {
            if (SetProperty(ref _selectedNode, value))
            {
                OnPropertyChanged(nameof(HasSelectedNode));
                OnPropertyChanged(nameof(ShowNodePlaceholder));
                OnPropertyChanged(nameof(SelectedNodeTitleText));
                OnPropertyChanged(nameof(SelectedNodeSubtitleText));
                People.Clear();
                SelectedPerson = null;
                PeopleTotal = 0;
                if (value is not null)
                {
                    _ = LoadPeopleSafelyAsync(value);
                }
            }
        }
    }

    public bool HasSelectedNode => SelectedNode is not null;

    /// <summary>Заглушка «выберите подразделение» справа — после загрузки и без ошибки.</summary>
    public bool ShowNodePlaceholder => !IsLoading && SelectedNode is null;

    /// <summary>Заголовок панели сотрудников: название выбранного узла.</summary>
    public string SelectedNodeTitleText => SelectedNode?.Title ?? string.Empty;

    /// <summary>Подзаголовок узла (руководитель на person-карточке).</summary>
    public string SelectedNodeSubtitleText => SelectedNode?.SubtitleText ?? string.Empty;

    // ---- Сотрудники узла ----

    public ObservableCollection<CompanyStructurePersonViewModel> People { get; } = [];

    /// <summary>Выбранный сотрудник: карточка справа читает ту же модель, что и строка списка.</summary>
    public CompanyStructurePersonViewModel? SelectedPerson
    {
        get => _selectedPerson;
        set
        {
            if (SetProperty(ref _selectedPerson, value))
            {
                OnPropertyChanged(nameof(HasPersonDetail));
                OnPropertyChanged(nameof(ShowPersonPlaceholder));
            }
        }
    }

    public bool HasPersonDetail => SelectedPerson is not null;

    /// <summary>Заглушка «выберите сотрудника» — карточки нет.</summary>
    public bool ShowPersonPlaceholder => SelectedPerson is null;

    public bool IsPeopleLoading
    {
        get => _isPeopleLoading;
        private set
        {
            if (SetProperty(ref _isPeopleLoading, value))
            {
                NotifyPeopleEmptyState();
            }
        }
    }

    /// <summary>Пустая выдача сотрудников при выбранном узле и без загрузки/ошибки.</summary>
    public bool IsPeopleEmpty =>
        HasSelectedNode && !IsPeopleLoading && People.Count == 0 && !HasBannerError;

    private int PeopleTotal
    {
        get => _peopleTotal;
        set
        {
            if (SetProperty(ref _peopleTotal, value))
            {
                OnPropertyChanged(nameof(PeopleTotalText));
            }
        }
    }

    /// <summary>«N человек» — счётчик выдачи узла (чип в вебе).</summary>
    public string PeopleTotalText => PeopleTotal > 0
        ? $"{PeopleTotal.ToString(CultureInfo.CurrentCulture)} человек"
        : string.Empty;

    // ---- Поиск ----

    /// <summary>Серверный поиск: изменение строки запускает debounce-запрос подсказок.</summary>
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

    public ObservableCollection<CompanyStructureSearchItemViewModel> SearchResults { get; } = [];

    /// <summary>
    /// Popup подсказок открыт. TwoWay: самозакрытие popup (клик вне) пишет false
    /// обратно — тогда список очищается (как у подсказок контактов почты).
    /// </summary>
    public bool IsSearchPopupOpen
    {
        get => _isSearchPopupOpen;
        set
        {
            if (SetProperty(ref _isSearchPopupOpen, value) && !value)
            {
                SearchResults.Clear();
            }
        }
    }

    /// <summary>Поиск идёт на сервер — индикатор в строке поиска.</summary>
    public bool IsSearching
    {
        get => _isSearching;
        private set => SetProperty(ref _isSearching, value);
    }

    // ---- Состояния ----

    public bool IsLoading
    {
        get => _isLoading;
        private set
        {
            if (SetProperty(ref _isLoading, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                OnPropertyChanged(nameof(ShowNodePlaceholder));
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
                NotifyPeopleEmptyState();
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrEmpty(BannerErrorText);

    /// <summary>Пустое дерево без ошибки и загрузки («Структура пока пуста»).</summary>
    public bool IsEmpty => !IsLoading && RootNodes.Count == 0 && !HasBannerError;

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand SelectSearchResultCommand { get; }
    public ICommand CallCommand { get; }
    public ICommand EmailCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>Шов открытия tel:/mailto: ссылок — Process.Start, тесты подменяют.</summary>
    public Action<string>? UriOpener { get; set; }

    /// <summary>Первичная загрузка/обновление: GET /tree целиком.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        // Баннер чистим до запросов: выбор узла в ApplyTree запускает загрузку
        // сотрудников, и её ошибка не должна затираться успехом дерева.
        BannerErrorText = null;
        try
        {
            var tree = await _api.GetCompanyStructureTreeAsync(
                includeInactive: false,
                cancellationToken);
            ApplyTree(tree, preferredNodeId: SelectedNode?.Id);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Пересобирает дерево и восстанавливает выбор: прежний узел, если он ещё
    /// есть, иначе — как в вебе: первый block-корня, первый ребёнок или первый корень.
    /// </summary>
    private void ApplyTree(HubCompanyStructureTree tree, string? preferredNodeId)
    {
        RootNodes.Clear();
        _nodesById.Clear();
        foreach (var node in tree.Items ?? [])
        {
            var viewModel = new CompanyStructureNodeViewModel(node, parent: null, _imageLoader);
            RootNodes.Add(viewModel);
            IndexSubtree(viewModel);
        }

        OnPropertyChanged(nameof(IsEmpty));

        CompanyStructureNodeViewModel? next = null;
        if (!string.IsNullOrEmpty(preferredNodeId))
        {
            _nodesById.TryGetValue(preferredNodeId, out next);
        }

        next ??= PickDefaultNode();
        if (next is null)
        {
            SelectedNode = null;
            return;
        }

        SelectNodeById(next.Id);
    }

    private void IndexSubtree(CompanyStructureNodeViewModel node)
    {
        if (node.Id.Length > 0)
        {
            _nodesById[node.Id] = node;
        }

        foreach (var child in node.Children)
        {
            IndexSubtree(child);
        }
    }

    /// <summary>
    /// Выбор по умолчанию — зеркало веба (getCompanyRootAndBlocks + fallback loadTree):
    /// корень = первый root-узел или items[0]; блоки = его block-дети (иначе все дети);
    /// выбирается первый блок, а без детей — сам корень.
    /// </summary>
    private CompanyStructureNodeViewModel? PickDefaultNode()
    {
        if (RootNodes.Count == 0)
        {
            return null;
        }

        var root = RootNodes.FirstOrDefault(
            node => string.Equals(node.NodeType, "root", StringComparison.OrdinalIgnoreCase))
            ?? RootNodes[0];
        var children = root.Children;
        var blocks = children.Where(
            node => string.Equals(node.NodeType, "block", StringComparison.OrdinalIgnoreCase))
            .ToList();
        var candidates = blocks.Count > 0 ? blocks : children.ToList();
        return candidates.Count > 0 ? candidates[0] : root;
    }

    /// <summary>
    /// Выбор узла по id (поиск, восстановление после refresh): раскрывает
    /// предков и ставит IsSelected — в представлении это шевелит TreeViewItem.
    /// </summary>
    internal bool SelectNodeById(string? nodeId)
    {
        if (string.IsNullOrWhiteSpace(nodeId) || !_nodesById.TryGetValue(nodeId, out var node))
        {
            return false;
        }

        for (var parent = node.Parent; parent is not null; parent = parent.Parent)
        {
            parent.IsExpanded = true;
        }

        node.IsSelected = true; // TreeViewItem → SelectedItemChanged → SelectedNode
        SelectedNode = node;    // прямой путь для вызовов вне представления (тесты, поиск)
        return true;
    }

    /// <summary>Загрузка сотрудников узла; гонку выборов гасит _peopleLoadVersion.</summary>
    private async Task LoadPeopleSafelyAsync(CompanyStructureNodeViewModel node)
    {
        var version = ++_peopleLoadVersion;
        IsPeopleLoading = true;
        try
        {
            var result = await _api.GetCompanyStructureNodePeopleAsync(
                node.Id,
                PeopleLimit,
                includeDescendants: true,
                CancellationToken.None);
            if (version != _peopleLoadVersion || !ReferenceEquals(SelectedNode, node))
            {
                return; // пока грузили, пользователь выбрал другой узел
            }

            foreach (var person in result.Items ?? [])
            {
                People.Add(new CompanyStructurePersonViewModel(person));
            }

            PeopleTotal = result.Total;
            BannerErrorText = null;

            // Выбор человека из поиска: ждали именно эту выдачу.
            if (_pendingPersonName is { } pending)
            {
                _pendingPersonName = null;
                SelectedPerson = People.FirstOrDefault(
                    entry => string.Equals(entry.FullName, pending, StringComparison.OrdinalIgnoreCase));
            }
        }
        catch (Exception exception)
        {
            if (version == _peopleLoadVersion)
            {
                BannerErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (version == _peopleLoadVersion)
            {
                IsPeopleLoading = false;
            }
        }
    }

    // ---- Поиск ----

    private void ScheduleSearch()
    {
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        var query = _searchText.Trim();
        if (query.Length < SearchMinLength)
        {
            _searchCancellation = null;
            IsSearchPopupOpen = false;
            SearchResults.Clear();
            return;
        }

        var cancellation = new CancellationTokenSource();
        _searchCancellation = cancellation;
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

            IsSearching = true;
            var result = await _api.SearchCompanyStructureAsync(query, SearchLimit, cancellationToken);
            if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            SearchResults.Clear();
            foreach (var item in result.Items ?? [])
            {
                SearchResults.Add(new CompanyStructureSearchItemViewModel(item));
            }

            IsSearchPopupOpen = SearchResults.Count > 0;
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
            IsSearching = false;
        }
    }

    /// <summary>
    /// Выбор подсказки (как handleSearchChoice в вебе): узел → раскрыть и выбрать
    /// в дереве; сотрудник → узел + выбор человека после догрузки списка,
    /// а без привязки к узлу — карточка напрямую из полей результата.
    /// </summary>
    private void ApplySearchResult(CompanyStructureSearchItemViewModel item)
    {
        IsSearchPopupOpen = false;
        if (!item.IsPerson)
        {
            SelectNodeById(item.NodeId);
            return;
        }

        _pendingPersonName = item.Title;
        if (item.NodeId.Length > 0 && _nodesById.TryGetValue(item.NodeId, out var node))
        {
            if (ReferenceEquals(SelectedNode, node))
            {
                // Уже на узле: выбираем из текущего списка без повторной загрузки.
                _pendingPersonName = null;
                SelectedPerson = People.FirstOrDefault(
                    entry => string.Equals(entry.FullName, item.Title, StringComparison.OrdinalIgnoreCase))
                    ?? item.ToPersonViewModel();
            }
            else
            {
                SelectNodeById(node.Id);
            }

            return;
        }

        _pendingPersonName = null;
        SelectedPerson = item.ToPersonViewModel();
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
        IsPeopleLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _peopleLoadVersion++;
        _pendingPersonName = null;
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        RootNodes.Clear();
        _nodesById.Clear();
        _selectedNode = null;
        OnPropertyChanged(nameof(SelectedNode));
        OnPropertyChanged(nameof(HasSelectedNode));
        OnPropertyChanged(nameof(ShowNodePlaceholder));
        OnPropertyChanged(nameof(SelectedNodeTitleText));
        OnPropertyChanged(nameof(SelectedNodeSubtitleText));
        People.Clear();
        SelectedPerson = null;
        PeopleTotal = 0;
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        SearchResults.Clear();
        IsSearchPopupOpen = false;
        IsSearching = false;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsPeopleLoading = false;
        OnPropertyChanged(nameof(IsEmpty));
        NotifyPeopleEmptyState();
    }

    private void NotifyPeopleEmptyState() => OnPropertyChanged(nameof(IsPeopleEmpty));
}
