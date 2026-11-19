using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Узел навигации «Помощь»: раздел базы знаний (Children — статьи)
/// или лист-статья. IsExpanded/IsSelected двусторонне связаны с TreeViewItem.
/// </summary>
public sealed class HelpNavNodeViewModel : ObservableObject
{
    private bool _isExpanded;
    private bool _isSelected;

    private HelpNavNodeViewModel(
        string id,
        string? articleId,
        string title,
        string metaText,
        string badgeText,
        HelpNavNodeViewModel? parent)
    {
        Id = id;
        ArticleId = articleId;
        Title = title;
        MetaText = metaText;
        BadgeText = badgeText;
        Parent = parent;
    }

    /// <summary>Раздел: children — статьи раздела (уже отсортированы сервером).</summary>
    public static HelpNavNodeViewModel ForCategory(
        string id,
        string title,
        string description,
        IEnumerable<HelpNavNodeViewModel> articles,
        HelpNavNodeViewModel? parent = null)
    {
        var node = new HelpNavNodeViewModel(
            "cat:" + id,
            articleId: null,
            string.IsNullOrWhiteSpace(title) ? "Раздел" : title.Trim(),
            description.Trim(),
            badgeText: string.Empty,
            parent);
        foreach (var article in articles)
        {
            article.Parent = node;
            node.Children.Add(article);
        }

        node.BadgeText = node.Children.Count > 0
            ? node.Children.Count.ToString(CultureInfo.CurrentCulture)
            : string.Empty;
        return node;
    }

    /// <summary>Лист-статья: MetaText — «Тип · дата» как чипы в веб-карточке.</summary>
    public static HelpNavNodeViewModel ForArticle(HubKbArticle article, string categoryTitle)
    {
        ArgumentNullException.ThrowIfNull(article);
        var articleId = (article.Id ?? string.Empty).Trim();
        return new HelpNavNodeViewModel(
            "art:" + articleId,
            articleId,
            string.IsNullOrWhiteSpace(article.Title) ? "Статья" : article.Title.Trim(),
            metaText: HelpViewModel.DescribeArticleMeta(article, categoryTitle),
            badgeText: string.Empty,
            parent: null);
    }

    public string Id { get; }
    public string? ArticleId { get; }
    public string Title { get; }

    /// <summary>Подпись второй строкой: описание раздела или мета статьи.</summary>
    public string MetaText { get; }

    /// <summary>Бейдж со счётчиком статей у раздела (пусто у статей и нулевых разделов).</summary>
    public string BadgeText { get; private set; }

    public HelpNavNodeViewModel? Parent { get; private set; }

    /// <summary>true — лист со статьёй; false — раздел.</summary>
    public bool IsArticle => ArticleId is not null;

    public ObservableCollection<HelpNavNodeViewModel> Children { get; } = [];

    /// <summary>Раскрытие раздела (поиск раскрывает ветку к найденной статье).</summary>
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

/// <summary>Строка выдачи серверного поиска по базе знаний.</summary>
public sealed class HelpSearchItemViewModel
{
    public HelpSearchItemViewModel(HubKbArticle article, string categoryTitle)
    {
        ArgumentNullException.ThrowIfNull(article);
        ArticleId = (article.Id ?? string.Empty).Trim();
        Title = string.IsNullOrWhiteSpace(article.Title) ? "Статья" : article.Title.Trim();
        SummaryText = (article.Summary ?? string.Empty).Trim();
        MetaText = HelpViewModel.DescribeArticleMeta(article, categoryTitle);
    }

    public string ArticleId { get; }
    public string Title { get; }
    public string SummaryText { get; }

    /// <summary>«Раздел · Тип · дата» — вторая строка результата.</summary>
    public string MetaText { get; }
}

/// <summary>
/// Открытая статья: метаданные + тело, собранное в markdown-подмножество
/// MarkdownTextBlock из структурированного KbContentBlock (не markdown в API).
/// </summary>
public sealed class HelpArticleDetailViewModel
{
    public HelpArticleDetailViewModel(HubKbArticle article, string categoryTitle)
    {
        ArgumentNullException.ThrowIfNull(article);
        Id = (article.Id ?? string.Empty).Trim();
        Title = string.IsNullOrWhiteSpace(article.Title) ? "Статья" : article.Title.Trim();
        TypeText = HelpViewModel.ArticleTypeLabel(article.ArticleType);
        CategoryText = categoryTitle;
        OwnerText = (article.OwnerName ?? string.Empty).Trim();
        UpdatedText = HelpViewModel.FormatKbDate(article.UpdatedAt ?? article.CreatedAt);
        TagsText = string.Join(
            " ",
            (article.Tags ?? [])
                .Select(tag => (tag ?? string.Empty).Trim())
                .Where(tag => tag.Length > 0)
                .Select(tag => "#" + tag));
        AttachmentsText = BuildAttachmentsText(article.Attachments);
        BodyMarkdown = BuildBodyMarkdown(article);
    }

    public string Id { get; }
    public string Title { get; }
    public string TypeText { get; }
    public string CategoryText { get; }
    public string OwnerText { get; }
    public string UpdatedText { get; }
    public string TagsText { get; }

    /// <summary>«Файлы: a.pdf (12 КБ), b.xlsx» — имена без скачивания (read-срез).</summary>
    public string AttachmentsText { get; }

    /// <summary>Markdown-представление секций статьи для MarkdownTextBlock.</summary>
    public string BodyMarkdown { get; }

    public bool HasBody => BodyMarkdown.Length > 0;

    /// <summary>Порядок секций — как detail-диалог KbHelpSection в вебе.</summary>
    private static string BuildBodyMarkdown(HubKbArticle article)
    {
        var builder = new StringBuilder();
        var content = article.Content;

        void AppendBlock(string text)
        {
            if (builder.Length > 0)
            {
                builder.Append("\n\n");
            }

            builder.Append(text);
        }

        void AppendSection(string heading, string body)
        {
            AppendBlock("## " + heading + "\n" + body);
        }

        // pre-wrap секции веба: markdown склеивает строки абзаца — раздвигаем
        // переводы строк пустой строкой, чтобы шаги/строки не сливались.
        static string PreWrap(string? text)
        {
            var lines = (text ?? string.Empty)
                .Replace("\r\n", "\n")
                .Split('\n')
                .Select(line => line.Trim())
                .Where(line => line.Length > 0);
            return string.Join("\n\n", lines);
        }

        void AppendTextSection(string heading, string? text)
        {
            var body = PreWrap(text);
            if (body.Length > 0)
            {
                AppendSection(heading, body);
            }
        }

        void AppendListSection(string heading, IReadOnlyList<string>? items, bool ordered)
        {
            var lines = (items ?? [])
                .Select(item => (item ?? string.Empty).Trim())
                .Where(item => item.Length > 0)
                .Select((item, index) => ordered ? $"{index + 1}. {item}" : "- " + item);
            var body = string.Join("\n", lines);
            if (body.Length > 0)
            {
                AppendSection(heading, body);
            }
        }

        var summary = (article.Summary ?? string.Empty).Trim();
        if (summary.Length > 0
            && !string.Equals(summary, (article.Title ?? string.Empty).Trim(), StringComparison.Ordinal))
        {
            AppendBlock(summary);
        }

        AppendTextSection("Описание", content?.Overview);
        AppendTextSection("Симптомы", content?.Symptoms);
        AppendListSection("Что проверить", content?.Checks, ordered: false);
        AppendListSection(
            "Команды",
            (content?.Commands ?? [])
                .Select(item => (item ?? string.Empty).Trim())
                .Where(item => item.Length > 0)
                .Select(item => item.Contains('`') ? item : $"`{item}`")
                .ToArray(),
            ordered: false);
        AppendListSection("Шаги решения", content?.ResolutionSteps, ordered: true);
        AppendListSection("Откат", content?.RollbackSteps, ordered: false);
        AppendTextSection("Эскалация", content?.Escalation);

        var faq = (content?.Faq ?? [])
            .Select(row => (
                Question: (row?.Question ?? string.Empty).Trim(),
                Answer: (row?.Answer ?? string.Empty).Trim()))
            .Where(row => row.Question.Length > 0 && row.Answer.Length > 0)
            .ToList();
        if (faq.Count > 0)
        {
            var body = string.Join(
                "\n\n",
                faq.Select(row => $"**{row.Question}**\n\n{row.Answer}"));
            AppendSection("Вопросы и ответы", body);
        }

        var files = (article.Attachments ?? [])
            .Select(file => FormatAttachment(file))
            .Where(line => line.Length > 0)
            .Select(line => "- " + line);
        var filesBody = string.Join("\n", files);
        if (filesBody.Length > 0)
        {
            AppendSection("Файлы", filesBody);
        }

        return builder.ToString();
    }

    private static string FormatAttachment(HubKbAttachment? file)
    {
        var name = (file?.FileName ?? string.Empty).Trim();
        if (name.Length == 0)
        {
            return string.Empty;
        }

        var size = FormatFileSize(file?.Size ?? 0);
        return size.Length > 0 ? $"{name} ({size})" : name;
    }

    private static string BuildAttachmentsText(IReadOnlyList<HubKbAttachment>? attachments)
    {
        var names = (attachments ?? [])
            .Select(FormatAttachment)
            .Where(line => line.Length > 0)
            .ToList();
        return names.Count > 0 ? "Файлы: " + string.Join(", ", names) : string.Empty;
    }

    private static string FormatFileSize(long bytes) => bytes switch
    {
        >= 1024 * 1024 => $"{bytes / (1024d * 1024d):0.#} МБ",
        >= 1024 => $"{Math.Round(bytes / 1024d):0} КБ",
        > 0 => $"{bytes} Б",
        _ => string.Empty,
    };
}

/// <summary>
/// Страница «Помощь» нативного шелла (read-срез базы знаний /kb):
/// слева дерево раздел→статьи (как группы KbHelpSection в вебе),
/// справа статья markdown-рендером; серверный поиск с debounce.
/// </summary>
public sealed class HelpViewModel : ObservableObject
{
    /// <summary>Веб грузит опубликованные статьи одним запросом (limit=300).</summary>
    private const int ArticlesLimit = 300;

    /// <summary>Серверный поиск — от 2 символов, как у остальных нативных экранов.</summary>
    private const int SearchMinLength = 2;
    private const int SearchLimit = 50;
    private static readonly TimeSpan SearchDebounce = TimeSpan.FromMilliseconds(350);

    /// <summary>Псевдо-раздел для статей без известной категории ('__other__' в вебе).</summary>
    private const string OtherCategoryId = "__other__";

    private readonly IHubApiClient _api;
    private readonly Dictionary<string, HelpNavNodeViewModel> _articleNodesById = new(StringComparer.Ordinal);
    private Dictionary<string, string>? _categoryTitleById;
    private CancellationTokenSource? _searchCancellation;
    private int _detailLoadVersion;

    private HelpNavNodeViewModel? _selectedNode;
    private HelpArticleDetailViewModel? _detail;
    private HelpSearchItemViewModel? _selectedSearchItem;
    private string _searchText = string.Empty;
    private bool _isLoading;
    private bool _isSearching;
    private bool _isDetailLoading;
    private string? _bannerErrorText;
    private string? _detailErrorText;
    private string _lastUpdatedText = string.Empty;
    private string _articlesTotalText = string.Empty;

    public HelpViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        SearchResults.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsSearchEmpty));
            OnPropertyChanged(nameof(HasSearchResults));
        };
    }

    // ---- Дерево разделов ----

    /// <summary>Корни дерева: непустые разделы + «Прочее» (как groups в вебе).</summary>
    public ObservableCollection<HelpNavNodeViewModel> RootNodes { get; } = [];

    /// <summary>
    /// Выбранный узел: статья → догрузка детали (GET /kb/articles/{id});
    /// раздел → просто раскрываем ветку.
    /// </summary>
    public HelpNavNodeViewModel? SelectedNode
    {
        get => _selectedNode;
        set
        {
            if (SetProperty(ref _selectedNode, value))
            {
                if (value is { IsArticle: true, ArticleId: { } articleId })
                {
                    _ = LoadDetailSafelyAsync(articleId);
                }
                else if (value is { IsArticle: false })
                {
                    value.IsExpanded = true;
                }
            }
        }
    }

    // ---- Деталь статьи ----

    public HelpArticleDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
                OnPropertyChanged(nameof(ShowDetailLoading));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Заглушка «выберите статью»: ни детали, ни её загрузки.</summary>
    public bool ShowDetailPlaceholder => !HasDetail && !IsDetailLoading;

    /// <summary>Индикатор загрузки — только когда прежней статьи на экране нет.</summary>
    public bool ShowDetailLoading => IsDetailLoading && !HasDetail;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set
        {
            if (SetProperty(ref _isDetailLoading, value))
            {
                OnPropertyChanged(nameof(ShowDetailPlaceholder));
                OnPropertyChanged(nameof(ShowDetailLoading));
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

    // ---- Поиск ----

    /// <summary>Серверный поиск по базе: изменение строки запускает debounce-запрос.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value ?? string.Empty))
            {
                OnPropertyChanged(nameof(IsSearchActive));
                OnPropertyChanged(nameof(IsSearchEmpty));
                OnPropertyChanged(nameof(IsEmpty));
                ScheduleSearch();
            }
        }
    }

    /// <summary>Режим выдачи: левая панель показывает список результатов вместо дерева.</summary>
    public bool IsSearchActive => _searchText.Trim().Length >= SearchMinLength;

    public ObservableCollection<HelpSearchItemViewModel> SearchResults { get; } = [];

    public bool HasSearchResults => SearchResults.Count > 0;

    /// <summary>Пустая выдача при активном поиске и без запроса в полёте.</summary>
    public bool IsSearchEmpty => IsSearchActive && !IsSearching && SearchResults.Count == 0;

    /// <summary>Поиск идёт на сервер — индикатор в строке поиска.</summary>
    public bool IsSearching
    {
        get => _isSearching;
        private set
        {
            if (SetProperty(ref _isSearching, value))
            {
                OnPropertyChanged(nameof(IsSearchEmpty));
            }
        }
    }

    /// <summary>
    /// Выбор результата поиска (ListBox.SelectedItem): раскрываем ветку до статьи
    /// и выбираем её; узел мог не попасть в дерево (лимит) — тогда деталь по id.
    /// </summary>
    public HelpSearchItemViewModel? SelectedSearchItem
    {
        get => _selectedSearchItem;
        set
        {
            if (SetProperty(ref _selectedSearchItem, value) && value is not null)
            {
                SelectArticleById(value.ArticleId);
                SetProperty(ref _selectedSearchItem, null);
            }
        }
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

    /// <summary>Пустая база без ошибки и загрузки («материалов пока нет»; вне поиска).</summary>
    public bool IsEmpty => !IsLoading && !IsSearchActive && RootNodes.Count == 0 && !HasBannerError;

    /// <summary>«N статей» — счётчик базы в статусной строке.</summary>
    public string ArticlesTotalText
    {
        get => _articlesTotalText;
        private set => SetProperty(ref _articlesTotalText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Шов ожидания (debounce поиска): тесты ставят мгновенный.</summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    /// <summary>
    /// Первичная загрузка/обновление: категории + все опубликованные статьи
    /// (веб: GET /kb/categories + /kb/articles?status=published&limit=300),
    /// дерево собирается на клиенте по article.category → category.id.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        BannerErrorText = null;
        try
        {
            var categories = await _api.GetKbCategoriesAsync(cancellationToken);
            var page = await _api.GetKbArticlesAsync(
                new HubKbArticleQuery { Status = "published", Limit = ArticlesLimit },
                cancellationToken);
            ApplyTree(categories, page.Items ?? [], preferredArticleId: _selectedNode?.ArticleId);
            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Группировка статей по разделам — зеркало веба: только непустые разделы,
    /// неизвестная/пустая категория уходит в «Прочее» в конец списка.
    /// </summary>
    private void ApplyTree(
        IReadOnlyList<HubKbCategory> categories,
        IReadOnlyList<HubKbArticle> articles,
        string? preferredArticleId)
    {
        var categoryTitleById = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var articlesByCategory = new Dictionary<string, List<HubKbArticle>>(StringComparer.OrdinalIgnoreCase);
        foreach (var category in categories)
        {
            var id = (category.Id ?? string.Empty).Trim();
            if (id.Length > 0)
            {
                categoryTitleById[id] = (category.Title ?? string.Empty).Trim();
            }
        }

        foreach (var article in articles)
        {
            var categoryId = (article.Category ?? string.Empty).Trim();
            if (!articlesByCategory.TryGetValue(categoryId, out var bucket))
            {
                bucket = [];
                articlesByCategory[categoryId] = bucket;
            }

            bucket.Add(article);
        }

        RootNodes.Clear();
        _articleNodesById.Clear();
        _categoryTitleById = categoryTitleById;

        var other = new List<HelpNavNodeViewModel>();
        foreach (var category in categories)
        {
            var id = (category.Id ?? string.Empty).Trim();
            if (id.Length == 0
                || !articlesByCategory.TryGetValue(id, out var rows)
                || rows.Count == 0)
            {
                continue;
            }

            var children = rows
                .Select(article => HelpNavNodeViewModel.ForArticle(article, CategoryTitleOf(id)));
            var node = HelpNavNodeViewModel.ForCategory(
                id,
                category.Title ?? id,
                category.Description ?? string.Empty,
                children);
            RootNodes.Add(node);
            IndexArticles(node);
        }

        // Статьи с неизвестной/пустой категорией — «Прочее», как __other__ в вебе.
        var knownIds = new HashSet<string>(
            categories.Select(c => (c.Id ?? string.Empty).Trim()).Where(id => id.Length > 0),
            StringComparer.OrdinalIgnoreCase);
        foreach (var article in articles)
        {
            var categoryId = (article.Category ?? string.Empty).Trim();
            if (categoryId.Length > 0 && knownIds.Contains(categoryId))
            {
                continue;
            }

            other.Add(HelpNavNodeViewModel.ForArticle(article, "Прочее"));
        }

        if (other.Count > 0)
        {
            var node = HelpNavNodeViewModel.ForCategory(
                OtherCategoryId, "Прочее", string.Empty, other);
            RootNodes.Add(node);
            IndexArticles(node);
        }

        ArticlesTotalText = articles.Count > 0
            ? $"Статей: {articles.Count.ToString(CultureInfo.CurrentCulture)}"
            : string.Empty;
        OnPropertyChanged(nameof(IsEmpty));

        // Восстановление выбора после refresh; иначе — первая статья первого раздела.
        if (!string.IsNullOrEmpty(preferredArticleId)
            && _articleNodesById.ContainsKey(preferredArticleId))
        {
            SelectArticleById(preferredArticleId);
            return;
        }

        var first = RootNodes
            .SelectMany(node => node.Children)
            .FirstOrDefault(child => child.IsArticle);
        if (first is not null)
        {
            SelectArticleById(first.ArticleId);
        }
        else if (SelectedNode is not null)
        {
            SelectedNode = null;
        }
    }

    private void IndexArticles(HelpNavNodeViewModel categoryNode)
    {
        foreach (var child in categoryNode.Children)
        {
            if (child.ArticleId is { Length: > 0 } articleId)
            {
                _articleNodesById[articleId] = child;
            }
        }
    }

    /// <summary>
    /// Выбор статьи по id (поиск, refresh): раскрывает раздел и ставит IsSelected —
    /// в представлении это шевелит TreeViewItem; без узла — деталь грузится по id.
    /// </summary>
    internal bool SelectArticleById(string? articleId)
    {
        if (string.IsNullOrWhiteSpace(articleId))
        {
            return false;
        }

        if (_articleNodesById.TryGetValue(articleId, out var node))
        {
            for (var parent = node.Parent; parent is not null; parent = parent.Parent)
            {
                parent.IsExpanded = true;
            }

            node.IsSelected = true; // TreeViewItem → SelectedItemChanged → SelectedNode
            SelectedNode = node;    // прямой путь для вызовов вне представления (тесты, поиск)
            return true;
        }

        // Статья есть в выдаче поиска, но не попала в дерево — читаем напрямую.
        SelectedNode = null;
        _ = LoadDetailSafelyAsync(articleId);
        return true;
    }

    private string CategoryTitleOf(string? categoryId)
    {
        if (string.IsNullOrWhiteSpace(categoryId))
        {
            return "Прочее";
        }

        return _categoryTitleById is not null
            && _categoryTitleById.TryGetValue(categoryId.Trim(), out var title)
            && title.Length > 0
                ? title
                : "Прочее";
    }

    /// <summary>Догрузка детали; гонку выборов гасит _detailLoadVersion.</summary>
    private async Task LoadDetailSafelyAsync(string articleId)
    {
        var version = ++_detailLoadVersion;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var article = await _api.GetKbArticleAsync(articleId, CancellationToken.None);
            if (version != _detailLoadVersion)
            {
                return; // пока грузили, пользователь выбрал другую статью
            }

            Detail = new HelpArticleDetailViewModel(article, CategoryTitleOf(article.Category));
            DetailErrorText = null;
        }
        catch (Exception exception)
        {
            if (version == _detailLoadVersion)
            {
                Detail = null;
                DetailErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            if (version == _detailLoadVersion)
            {
                IsDetailLoading = false;
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
            var page = await _api.GetKbArticlesAsync(
                new HubKbArticleQuery
                {
                    Search = query,
                    Status = "published",
                    Limit = SearchLimit,
                },
                cancellationToken);
            if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            SearchResults.Clear();
            foreach (var article in page.Items ?? [])
            {
                SearchResults.Add(new HelpSearchItemViewModel(article, CategoryTitleOf(article.Category)));
            }

            BannerErrorText = null;
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

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
        IsDetailLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadVersion++;
        _searchCancellation?.Cancel();
        _searchCancellation?.Dispose();
        _searchCancellation = null;
        RootNodes.Clear();
        _articleNodesById.Clear();
        _categoryTitleById = null;
        _selectedNode = null;
        OnPropertyChanged(nameof(SelectedNode));
        Detail = null;
        DetailErrorText = null;
        BannerErrorText = null;
        _searchText = string.Empty;
        OnPropertyChanged(nameof(SearchText));
        OnPropertyChanged(nameof(IsSearchActive));
        OnPropertyChanged(nameof(IsSearchEmpty));
        SearchResults.Clear();
        _selectedSearchItem = null;
        OnPropertyChanged(nameof(SelectedSearchItem));
        IsSearching = false;
        IsDetailLoading = false;
        IsLoading = false;
        ArticlesTotalText = string.Empty;
        LastUpdatedText = string.Empty;
        OnPropertyChanged(nameof(IsEmpty));
    }

    // ---- Отображаемые метки (общие для узлов, поиска и детали) ----

    internal static string ArticleTypeLabel(string? articleType) =>
        (articleType ?? string.Empty).Trim().ToLowerInvariant() switch
        {
            "runbook" => "Инструкция",
            "faq" => "Вопросы и ответы",
            "template" => "Шаблон",
            "note" => "Заметка",
            _ => string.Empty,
        };

    internal static string FormatKbDate(DateTimeOffset? value) =>
        value is null
            ? string.Empty
            : value.Value.ToLocalTime().ToString("dd.MM.yyyy", CultureInfo.CurrentCulture);

    /// <summary>«Тип · дата»; раздел известен — он пишется в MetaText отдельно.</summary>
    internal static string DescribeArticleMeta(HubKbArticle article, string categoryTitle)
    {
        return string.Join(
            " · ",
            new[]
            {
                categoryTitle,
                ArticleTypeLabel(article.ArticleType),
                FormatKbDate(article.UpdatedAt ?? article.CreatedAt),
            }.Where(part => !string.IsNullOrEmpty(part)));
    }
}
