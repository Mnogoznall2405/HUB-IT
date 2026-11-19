using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Новости» нативного шелла: список объявлений портала, поиск,
/// фильтр непрочитанных, серверная сортировка, чтение детали
/// и подтверждение прочтения (requires_ack).
/// </summary>
public sealed class NewsViewModel : ObservableObject
{
    private const int PageSize = 30;
    private const string DefaultSort = "published_desc";

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    private NewsListItemViewModel? _selectedItem;
    private NewsDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private string _filter = "all";
    private string _sort = DefaultSort;
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _total;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private string _unreadText = string.Empty;
    private int _unreadTotal;
    private string _ackPendingText = string.Empty;
    private string _lastUpdatedText = string.Empty;

    public NewsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectFilterCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                Filter = parameter as string ?? "all";
                await LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectSortCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                Sort = parameter as string ?? DefaultSort;
                await LoadAsync(ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        AckCommand = new NativeAsyncCommand(
            (_, ct) => AckCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading);
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
        };
    }

    // ---- Список ----

    public ObservableCollection<NewsListItemViewModel> Items { get; } = [];

    public NewsListItemViewModel? SelectedItem
    {
        get => _selectedItem;
        set
        {
            if (SetProperty(ref _selectedItem, value) && value is not null)
            {
                _ = LoadDetailSafelyAsync(value.Id);
            }
        }
    }

    public NewsDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailEmpty));
                OnPropertyChanged(nameof(ShowDetailLoading));
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Подсказка «Выберите новость»: ни детали, ни загрузки детали.</summary>
    public bool ShowDetailEmpty => !HasDetail && !IsDetailLoading;

    /// <summary>Индикатор загрузки детали — только когда детали ещё нет (старую не заслоняем).</summary>
    public bool ShowDetailLoading => IsDetailLoading && !HasDetail;

    public bool IsDetailLoading
    {
        get => _isDetailLoading;
        private set
        {
            if (SetProperty(ref _isDetailLoading, value))
            {
                OnPropertyChanged(nameof(ShowDetailEmpty));
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

    public string SearchText
    {
        get => _searchText;
        set => SetProperty(ref _searchText, value);
    }

    /// <summary>all|unread — фильтр списка.</summary>
    public string Filter
    {
        get => _filter;
        set
        {
            if (SetProperty(ref _filter, value))
            {
                OnPropertyChanged(nameof(IsFilterAll));
                OnPropertyChanged(nameof(IsFilterUnread));
            }
        }
    }

    // TwoWay IsChecked на чипах: сеттеры нужны для write-back от
    // SelectionItemPattern (скринридер/UIA) — клик идёт через SelectFilterCommand.
    public bool IsFilterAll
    {
        get => Filter == "all";
        set => ApplyFilterFromUi("all", value);
    }

    public bool IsFilterUnread
    {
        get => Filter == "unread";
        set => ApplyFilterFromUi("unread", value);
    }

    private void ApplyFilterFromUi(string filter, bool isChecked)
    {
        if (isChecked && Filter != filter)
        {
            SelectFilterCommand.Execute(filter);
        }
    }

    /// <summary>published_desc|published_asc|updated_desc|priority_desc — порядок списка (sort_by/sort_dir API).</summary>
    public string Sort
    {
        get => _sort;
        set
        {
            if (SetProperty(ref _sort, value))
            {
                OnPropertyChanged(nameof(IsSortNewest));
                OnPropertyChanged(nameof(IsSortOldest));
                OnPropertyChanged(nameof(IsSortUpdated));
                OnPropertyChanged(nameof(IsSortPriority));
            }
        }
    }

    // TwoWay IsChecked на чипах сортировки: write-back от SelectionItemPattern
    // идёт через SelectSortCommand, как и у фильтров.
    public bool IsSortNewest
    {
        get => Sort == "published_desc";
        set => ApplySortFromUi("published_desc", value);
    }

    public bool IsSortOldest
    {
        get => Sort == "published_asc";
        set => ApplySortFromUi("published_asc", value);
    }

    public bool IsSortUpdated
    {
        get => Sort == "updated_desc";
        set => ApplySortFromUi("updated_desc", value);
    }

    public bool IsSortPriority
    {
        get => Sort == "priority_desc";
        set => ApplySortFromUi("priority_desc", value);
    }

    private void ApplySortFromUi(string sort, bool isChecked)
    {
        if (isChecked && Sort != sort)
        {
            SelectSortCommand.Execute(sort);
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

    /// <summary>На сервере остались объявления за пределами загруженного списка.</summary>
    public bool HasMore => Items.Count < _total;

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

    /// <summary>Подпись кнопки «Показать ещё» с остатком по данным сервера.</summary>
    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : $"Показать ещё ({Math.Max(0, _total - Items.Count)})";

    /// <summary>Непрочитанных по данным сервера; уменьшается при локальном прочтении.</summary>
    public int UnreadTotal
    {
        get => _unreadTotal;
        private set => SetProperty(ref _unreadTotal, value);
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

    public string TotalText
    {
        get => _totalText;
        private set => SetProperty(ref _totalText, value);
    }

    public string UnreadText
    {
        get => _unreadText;
        private set => SetProperty(ref _unreadText, value);
    }

    public string AckPendingText
    {
        get => _ackPendingText;
        private set => SetProperty(ref _ackPendingText, value);
    }

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    public bool IsEmpty => !IsLoading && Items.Count == 0 && !HasBannerError;

    public ICommand RefreshCommand { get; }
    public ICommand SelectFilterCommand { get; }
    public ICommand SelectSortCommand { get; }
    public ICommand AckCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand LoadMoreCommand { get; }

    private HubAnnouncementQuery BuildQuery(int offset)
    {
        // Набор значений — контракт GET /hub/announcements:
        // sort_by ∈ {published_at, updated_at, priority}, sort_dir ∈ {asc, desc}.
        var (sortBy, sortDir) = Sort switch
        {
            "published_asc" => ("published_at", "asc"),
            "updated_desc" => ("updated_at", "desc"),
            "priority_desc" => ("priority", "desc"),
            _ => ("published_at", "desc"),
        };
        return new HubAnnouncementQuery
        {
            Search = string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim(),
            UnreadOnly = Filter == "unread",
            Limit = PageSize,
            Offset = offset,
            SortBy = sortBy,
            SortDir = sortDir,
        };
    }

    /// <summary>Загрузка первой страницы: список объявлений по текущему поиску, фильтру и порядку.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var page = await _api.GetAnnouncementsAsync(BuildQuery(0), cancellationToken);
            Items.Clear();
            ApplyPageTotals(page);
            foreach (var item in page.Items ?? [])
            {
                Items.Add(new NewsListItemViewModel(item));
            }

            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Догрузка следующей страницы в конец списка («Показать ещё»).</summary>
    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            var page = await _api.GetAnnouncementsAsync(BuildQuery(Items.Count), cancellationToken);
            ApplyPageTotals(page);
            foreach (var item in page.Items ?? [])
            {
                Items.Add(new NewsListItemViewModel(item));
            }

            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    private void ApplyPageTotals(HubAnnouncementListPage page)
    {
        _total = page.Total;
        TotalText = page.Total.ToString(CultureInfo.CurrentCulture);
        UnreadText = page.UnreadTotal.ToString(CultureInfo.CurrentCulture);
        UnreadTotal = page.UnreadTotal;
        AckPendingText = page.AckPendingTotal.ToString(CultureInfo.CurrentCulture);
    }

    /// <summary>Навигация к новости из других страниц: сбрасывает фильтры, находит и выбирает.</summary>
    public async Task SelectNewsByIdAsync(string id, CancellationToken cancellationToken = default)
    {
        var item = Items.FirstOrDefault(i => i.Id == id);
        if (item is null)
        {
            Filter = "all";
            SearchText = string.Empty;
            await LoadAsync(cancellationToken);
            item = Items.FirstOrDefault(i => i.Id == id);
        }

        // Глубокая ссылка на старую новость: догружаем страницы, пока не найдём.
        for (var guard = 0; item is null && HasMore && guard < 20; guard++)
        {
            await LoadMoreAsync(cancellationToken);
            item = Items.FirstOrDefault(i => i.Id == id);
        }

        if (item is not null)
        {
            SelectedItem = item;
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при автономной инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadCancellation?.Cancel();
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        SearchText = string.Empty;
        Filter = "all";
        Sort = DefaultSort;
        UnreadTotal = 0;
        _total = 0;
        OnPropertyChanged(nameof(HasMore));
        OnPropertyChanged(nameof(MoreButtonText));
        TotalText = string.Empty;
        UnreadText = string.Empty;
        AckPendingText = string.Empty;
        LastUpdatedText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
    }

    private async Task LoadDetailSafelyAsync(string id)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        try
        {
            var detail = await _api.GetAnnouncementAsync(id, cancellation.Token);
            if (_selectedItem?.Id != id)
            {
                return;
            }

            if (Detail is null)
            {
                Detail = new NewsDetailViewModel(detail);
            }
            else
            {
                Detail.Update(detail);
            }

            // Прочитано: снимаем флаг в списке сразу, сервер — best-effort.
            var wasUnread = _selectedItem?.IsUnread == true;
            _selectedItem?.MarkRead();
            if (wasUnread && UnreadTotal > 0)
            {
                UnreadTotal--;
            }
            _ = MarkReadSafelyAsync(id);
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

    private async Task MarkReadSafelyAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return;
        }

        try
        {
            await _api.MarkAnnouncementReadAsync(id, CancellationToken.None);
        }
        catch
        {
            // Отметка о прочтении — best-effort: ошибка не должна мешать чтению новости.
        }
    }

    private async Task AckCurrentAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { IsAckPending: true } detail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsAckBusy = true;
        try
        {
            await _api.AckAnnouncementAsync(detail.Id, cancellationToken);
            detail.MarkAcknowledged();
            _selectedItem?.MarkAcknowledged();
        }
        finally
        {
            detail.IsAckBusy = false;
        }
    }
}

/// <summary>
/// Элемент списка новостей: доменные поля + готовые отображаемые строки.
/// Непрочитанность видна не только цветом: маркер и плашка «Новая».
/// </summary>
public sealed class NewsListItemViewModel : ObservableObject
{
    private bool _isUnread;
    private bool _isAckPending;

    public NewsListItemViewModel(HubAnnouncementItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(item.Title) ? "Объявление" : item.Title!;
        Preview = item.Preview ?? string.Empty;
        AuthorText = item.AuthorFullName ?? string.Empty;
        CategoryText = item.Category?.Name ?? string.Empty;
        DateText = FormatDate(item.PublishedAt ?? item.UpdatedAt);
        PriorityText = item.Priority == "high" ? "Важно" : string.Empty;
        IsHighPriority = item.Priority == "high";
        PinnedMarker = item.IsPinnedActive ? "📌" : string.Empty;
        UpdatedBadgeText = item.IsUpdated ? "Обновлено" : string.Empty;
        AttachmentsText = item.AttachmentsCount > 0 ? $"📎 {item.AttachmentsCount}" : string.Empty;
        CommentsText = item.CommentsCount > 0 ? $"💬 {item.CommentsCount}" : string.Empty;
        _isUnread = item.IsUnread;
        _isAckPending = item.IsAckPending;
    }

    public string Id { get; }
    public string Title { get; }
    public string Preview { get; }
    public string AuthorText { get; }
    public string CategoryText { get; }
    public string DateText { get; }
    public string PriorityText { get; }
    public bool IsHighPriority { get; }
    public string PinnedMarker { get; }
    public string UpdatedBadgeText { get; }
    public string AttachmentsText { get; }
    public string CommentsText { get; }

    public bool IsUnread
    {
        get => _isUnread;
        private set => SetProperty(ref _isUnread, value);
    }

    public bool IsAckPending
    {
        get => _isAckPending;
        private set
        {
            if (SetProperty(ref _isAckPending, value))
            {
                OnPropertyChanged(nameof(AckPendingText));
            }
        }
    }

    public string AckPendingText => IsAckPending ? "Требует подтверждения" : string.Empty;

    /// <summary>Отметить прочитанным локально (вызов API делается отдельно, best-effort).</summary>
    public void MarkRead() => IsUnread = false;

    /// <summary>Снять флаг «требует подтверждения» после успешного ack.</summary>
    public void MarkAcknowledged() => IsAckPending = false;

    internal static string FormatDate(DateTimeOffset? value) =>
        value is null
            ? string.Empty
            : value.Value.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture);
}

/// <summary>Детальная панель новости: полный текст, метаданные и подтверждение прочтения.</summary>
public sealed class NewsDetailViewModel : ObservableObject
{
    private bool _isAckPending;
    private bool _isAckBusy;

    public NewsDetailViewModel(HubAnnouncementItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Update(item);
    }

    public string Id { get; private set; } = string.Empty;
    public string Title { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public bool HasBody => Body.Length > 0;
    public string DateText { get; private set; } = string.Empty;
    public string UpdatedText { get; private set; } = string.Empty;
    public string AuthorText { get; private set; } = string.Empty;
    public string CategoryText { get; private set; } = string.Empty;
    public string PriorityText { get; private set; } = string.Empty;
    public bool IsHighPriority { get; private set; }
    public bool RequiresAck { get; private set; }
    public string AttachmentsText { get; private set; } = string.Empty;
    public string CommentsText { get; private set; } = string.Empty;

    public bool IsAckPending
    {
        get => _isAckPending;
        private set
        {
            if (SetProperty(ref _isAckPending, value))
            {
                OnPropertyChanged(nameof(ShowAckDone));
                OnPropertyChanged(nameof(CanAck));
            }
        }
    }

    public bool IsAckBusy
    {
        get => _isAckBusy;
        set
        {
            if (SetProperty(ref _isAckBusy, value))
            {
                OnPropertyChanged(nameof(CanAck));
                OnPropertyChanged(nameof(AckButtonText));
            }
        }
    }

    /// <summary>Подтверждение получено: показываем «Подтверждено» вместо кнопки.</summary>
    public bool ShowAckDone => RequiresAck && !IsAckPending;

    public bool CanAck => IsAckPending && !IsAckBusy;

    public string AckButtonText => IsAckBusy ? "Подтверждаем…" : "Подтвердить прочтение";

    /// <summary>Фиксация успешного ack: кнопка прячется, показывается «Подтверждено».</summary>
    public void MarkAcknowledged() => IsAckPending = false;

    public void Update(HubAnnouncementItem item)
    {
        Id = item.Id ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(item.Title) ? "Объявление" : item.Title!;
        Body = item.Body ?? string.Empty;
        DateText = NewsListItemViewModel.FormatDate(item.PublishedAt);
        UpdatedText = item.IsUpdated
            ? item.UpdatedAt is null
                ? "Обновлено"
                : $"Обновлено {NewsListItemViewModel.FormatDate(item.UpdatedAt)}"
            : string.Empty;
        AuthorText = item.AuthorFullName ?? string.Empty;
        CategoryText = item.Category?.Name ?? string.Empty;
        PriorityText = item.Priority == "high" ? "Важно" : string.Empty;
        IsHighPriority = item.Priority == "high";
        RequiresAck = item.RequiresAck;
        IsAckPending = item.IsAckPending;
        AttachmentsText = item.AttachmentsCount > 0 ? $"📎 {item.AttachmentsCount}" : string.Empty;
        CommentsText = item.CommentsCount > 0 ? $"💬 {item.CommentsCount}" : string.Empty;
        OnPropertyChanged(string.Empty);
    }
}
