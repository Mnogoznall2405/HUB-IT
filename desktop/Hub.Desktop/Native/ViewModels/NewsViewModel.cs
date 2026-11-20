using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Новости» нативного шелла: список объявлений портала, поиск,
/// фильтры (непрочитанные/закладки), серверная сортировка, чтение детали,
/// подтверждение прочтения (requires_ack), реакции/лайк/закладка, опрос,
/// вложения и комментарии — как на веб-карточке ленты.
/// </summary>
public sealed class NewsViewModel : ObservableObject
{
    private const int PageSize = 30;
    private const int CommentsPageSize = 30;
    private const string DefaultSort = "published_desc";

    /// <summary>Эмодзи-реакции сервера — как FEED_REACTIONS веб-клиента.</summary>
    internal static readonly (string Type, string Emoji, string Label)[] ReactionCatalog =
    [
        ("like", "👍", "Нравится"),
        ("love", "❤️", "Любовь"),
        ("laugh", "😂", "Смех"),
        ("wow", "😮", "Удивление"),
        ("sad", "😢", "Грусть"),
        ("angry", "😡", "Возмущение"),
    ];

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);

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
        ToggleReactionCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleReactionAsync(parameter as NewsReactionChipViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        PickReactionCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleReactionByTypeAsync(parameter as string, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        ToggleLikeCommand = new NativeAsyncCommand(
            (_, ct) => ToggleLikeAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        ToggleBookmarkCommand = new NativeAsyncCommand(
            (_, ct) => ToggleBookmarkAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        VotePollOptionCommand = new NativeAsyncCommand(
            (parameter, ct) => VotePollOptionAsync(parameter as NewsPollOptionViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        SubmitPollVoteCommand = new NativeAsyncCommand(
            (_, ct) => SubmitPollVoteAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        CancelPollVoteCommand = new NativeAsyncCommand(
            (_, ct) => VotePollAsync([], ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        OpenAttachmentCommand = new NativeAsyncCommand(
            (parameter, ct) => OpenAttachmentAsync(parameter as NewsAttachmentViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        SendCommentCommand = new NativeAsyncCommand(
            (_, ct) => SendCommentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        ReplyCommentCommand = new NativeRelayCommand(
            parameter => BeginReply(parameter as NewsCommentViewModel));
        CancelReplyCommand = new NativeRelayCommand(
            () => Detail?.ClearReplyTarget());
        BeginCommentEditCommand = new NativeRelayCommand(
            parameter => (parameter as NewsCommentViewModel)?.BeginEdit());
        CancelCommentEditCommand = new NativeRelayCommand(
            parameter => (parameter as NewsCommentViewModel)?.CancelEdit());
        SaveCommentEditCommand = new NativeAsyncCommand(
            (parameter, ct) => SaveCommentEditAsync(parameter as NewsCommentViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        DeleteCommentCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteCommentAsync(parameter as NewsCommentViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        ToggleCommentReactionCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleCommentReactionAsync(parameter as NewsReactionChipViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        ToggleRepliesCommand = new NativeAsyncCommand(
            (parameter, ct) => ToggleRepliesAsync(parameter as NewsCommentViewModel, ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommentsCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreCommentsAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex));
        Items.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsEmpty));
            OnPropertyChanged(nameof(HasMore));
            OnPropertyChanged(nameof(MoreButtonText));
            ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
        };
    }

    /// <summary>
    /// Шов сохранения/открытия вложения (как AttachmentSaver у билетов): тесты
    /// подменяют потоковое скачивание в %TEMP% + Process.Start. Аргументы — чип и id новости.
    /// </summary>
    public Func<NewsAttachmentViewModel, string, Task>? AttachmentSaver { get; set; }

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

    /// <summary>all|unread|bookmarks — фильтр списка.</summary>
    public string Filter
    {
        get => _filter;
        set
        {
            if (SetProperty(ref _filter, value))
            {
                OnPropertyChanged(nameof(IsFilterAll));
                OnPropertyChanged(nameof(IsFilterUnread));
                OnPropertyChanged(nameof(IsFilterBookmarks));
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

    public bool IsFilterBookmarks
    {
        get => Filter == "bookmarks";
        set => ApplyFilterFromUi("bookmarks", value);
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
    /// <summary>Тоггл реакции по нажатому чипу (повторный клик по своей — снятие).</summary>
    public ICommand ToggleReactionCommand { get; }
    /// <summary>Тоггл реакции по типу из меню «+» (CommandParameter — строка типа).</summary>
    public ICommand PickReactionCommand { get; }
    public ICommand ToggleLikeCommand { get; }
    public ICommand ToggleBookmarkCommand { get; }
    /// <summary>Голос за вариант (single-choice; повторный клик по своему — снять голос).</summary>
    public ICommand VotePollOptionCommand { get; }
    /// <summary>Отправить выбранные варианты (multiple-choice).</summary>
    public ICommand SubmitPollVoteCommand { get; }
    /// <summary>Снять голос (multiple-choice).</summary>
    public ICommand CancelPollVoteCommand { get; }
    public ICommand OpenAttachmentCommand { get; }
    public ICommand SendCommentCommand { get; }
    public ICommand ReplyCommentCommand { get; }
    public ICommand CancelReplyCommand { get; }
    public ICommand BeginCommentEditCommand { get; }
    public ICommand CancelCommentEditCommand { get; }
    public ICommand SaveCommentEditCommand { get; }
    public ICommand DeleteCommentCommand { get; }
    /// <summary>Тоггл реакции на комментарии по нажатому чипу.</summary>
    public ICommand ToggleCommentReactionCommand { get; }
    /// <summary>Развернуть/свернуть ветку ответов (ленивая загрузка).</summary>
    public ICommand ToggleRepliesCommand { get; }
    public ICommand LoadMoreCommentsCommand { get; }

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
            BookmarkedOnly = Filter == "bookmarks",
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

            // Комментарии грузим отдельным запросом — ошибка не роняет карточку.
            _ = LoadCommentsSafelyAsync(id);

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

    // ---- Реакции / лайк / закладка ----

    /// <summary>Тоггл реакции по чипу: своя — снять, чужая — переключить. Оптимистично + откат.</summary>
    private async Task ToggleReactionAsync(NewsReactionChipViewModel? chip, CancellationToken cancellationToken)
    {
        if (chip is null)
        {
            return;
        }

        await ToggleReactionByTypeAsync(chip.ReactionType, cancellationToken);
    }

    private async Task ToggleReactionByTypeAsync(string? reactionType, CancellationToken cancellationToken)
    {
        if (Detail is not { ReactionsEnabled: true } detail
            || string.IsNullOrWhiteSpace(reactionType)
            || detail.IsSocialBusy)
        {
            return;
        }

        DetailErrorText = null;
        var snapshot = detail.CaptureSocial();
        var removing = detail.ViewerReaction == reactionType;
        detail.ApplyLocalReactionToggle(reactionType);
        detail.IsSocialBusy = true;
        try
        {
            var state = removing
                ? await _api.ClearAnnouncementReactionAsync(detail.Id, cancellationToken)
                : await _api.SetAnnouncementReactionAsync(detail.Id, reactionType, cancellationToken);
            detail.ApplyReactionState(state);
        }
        catch
        {
            detail.ApplySocial(snapshot);
            throw;
        }
        finally
        {
            detail.IsSocialBusy = false;
        }
    }

    /// <summary>Лайк-тоггл: «нравится» сервером считается реакцией «like».</summary>
    private async Task ToggleLikeAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { ReactionsEnabled: true } detail || detail.IsSocialBusy)
        {
            return;
        }

        DetailErrorText = null;
        var snapshot = detail.CaptureSocial();
        var liked = !detail.IsLiked;
        detail.ApplyLocalLike(liked);
        detail.IsSocialBusy = true;
        try
        {
            var state = await _api.SetAnnouncementLikeAsync(detail.Id, liked, cancellationToken);
            detail.ApplyReactionState(state);
        }
        catch
        {
            detail.ApplySocial(snapshot);
            throw;
        }
        finally
        {
            detail.IsSocialBusy = false;
        }
    }

    private async Task ToggleBookmarkAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || detail.IsSocialBusy)
        {
            return;
        }

        DetailErrorText = null;
        var bookmarked = !detail.IsBookmarked;
        detail.IsBookmarked = bookmarked;
        _selectedItem?.SetBookmarked(bookmarked);
        detail.IsSocialBusy = true;
        try
        {
            var state = await _api.SetAnnouncementBookmarkAsync(detail.Id, bookmarked, cancellationToken);
            detail.IsBookmarked = state.ViewerBookmarked;
            _selectedItem?.SetBookmarked(state.ViewerBookmarked);
        }
        catch
        {
            detail.IsBookmarked = !bookmarked;
            _selectedItem?.SetBookmarked(!bookmarked);
            throw;
        }
        finally
        {
            detail.IsSocialBusy = false;
        }
    }

    // ---- Опрос ----

    /// <summary>Клик по варианту single-опроса: свой — снять голос, чужой — переголосовать.</summary>
    private async Task VotePollOptionAsync(NewsPollOptionViewModel? option, CancellationToken cancellationToken)
    {
        if (option is null || Detail is not { } detail)
        {
            return;
        }

        // Повторный клик по своему варианту снимает голос (веб: submitVote([])).
        var optionIds = option.IsViewerVote
            ? new List<string>()
            : new List<string> { option.Id };
        await VotePollAsync(optionIds, cancellationToken);
    }

    /// <summary>Отправка выбранных вариантов multiple-опроса.</summary>
    private async Task SubmitPollVoteAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail)
        {
            return;
        }

        var optionIds = detail.PollOptions
            .Where(o => o.IsSelected)
            .Select(o => o.Id)
            .ToList();
        await VotePollAsync(optionIds, cancellationToken);
    }

    private async Task VotePollAsync(IReadOnlyList<string> optionIds, CancellationToken cancellationToken)
    {
        if (Detail is not { HasPoll: true, IsPollClosed: false } detail || detail.IsPollBusy)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsPollBusy = true;
        try
        {
            var result = await _api.VoteAnnouncementPollAsync(detail.Id, optionIds, cancellationToken);
            if (result.Poll is not null)
            {
                detail.ApplyPoll(result.Poll);
            }
        }
        finally
        {
            detail.IsPollBusy = false;
        }
    }

    // ---- Вложения ----

    /// <summary>Чип вложения нажат: скачиваем в %TEMP%/hub-desktop/news и открываем ОС.</summary>
    private async Task OpenAttachmentAsync(NewsAttachmentViewModel? item, CancellationToken cancellationToken)
    {
        var announcementId = Detail?.Id;
        if (item is null || announcementId is not { } id || string.IsNullOrEmpty(item.AttachmentId))
        {
            return;
        }

        var downloadKey = id + ":" + (item.CommentId ?? string.Empty) + ":" + item.AttachmentId;
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

            var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "news");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                item.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (safeName.Length == 0)
            {
                safeName = "attachment.bin";
            }

            var target = Path.Combine(directory, $"{item.AttachmentId}-{safeName}");
            var cached = File.Exists(target) && new FileInfo(target).Length == item.FileSize;
            if (!cached)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = item.CommentId is { } commentId
                    ? await _api.DownloadAnnouncementCommentAttachmentAsync(
                        id, commentId, item.AttachmentId, destination, cancellationToken)
                    : await _api.DownloadAnnouncementAttachmentAsync(
                        id, item.AttachmentId, destination, cancellationToken);
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
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            item.IsDownloading = false;
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    // ---- Комментарии ----

    /// <summary>Первая страница комментариев после загрузки детали. Ошибка — локальная плашка секции.</summary>
    private async Task LoadCommentsSafelyAsync(string announcementId)
    {
        if (Detail?.Id != announcementId)
        {
            return;
        }

        var detail = Detail;
        detail.IsCommentsLoading = true;
        detail.CommentsErrorText = null;
        try
        {
            var page = await _api.GetAnnouncementCommentsAsync(
                announcementId,
                new HubAnnouncementCommentQuery { Limit = CommentsPageSize },
                CancellationToken.None);
            if (Detail?.Id != announcementId || !ReferenceEquals(Detail, detail))
            {
                return;
            }

            detail.Comments.Clear();
            foreach (var comment in page.Items ?? [])
            {
                detail.Comments.Add(WrapComment(comment));
            }

            detail.ApplyCommentsPage(page);
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(Detail, detail))
            {
                detail.CommentsErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(Detail, detail))
            {
                detail.IsCommentsLoading = false;
            }
        }
    }

    private async Task LoadMoreCommentsAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || detail.NextCommentsOffset is not { } offset)
        {
            return;
        }

        detail.IsCommentsLoading = true;
        detail.CommentsErrorText = null;
        try
        {
            var page = await _api.GetAnnouncementCommentsAsync(
                detail.Id,
                new HubAnnouncementCommentQuery { Limit = CommentsPageSize, Offset = offset },
                cancellationToken);
            foreach (var comment in page.Items ?? [])
            {
                detail.Comments.Add(WrapComment(comment));
            }

            detail.ApplyCommentsPage(page);
        }
        finally
        {
            detail.IsCommentsLoading = false;
        }
    }

    /// <summary>Отправка комментария (или ответа — если выбран ReplyTarget).</summary>
    private async Task SendCommentAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail)
        {
            return;
        }

        var body = detail.CommentDraft.Trim();
        if (body.Length == 0)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsCommentSending = true;
        try
        {
            var created = await _api.CreateAnnouncementCommentAsync(
                detail.Id, body, detail.ReplyTarget?.Id, cancellationToken);
            var vm = WrapComment(created);
            var parent = detail.ReplyTarget;
            if (parent is null)
            {
                // Корневой — в начало ленты комментариев, как в вебе.
                detail.Comments.Insert(0, vm);
            }
            else
            {
                parent.ReplyCount++;
                if (parent.RepliesExpanded)
                {
                    parent.Replies.Add(vm);
                }
            }

            detail.CommentsTotal++;
            detail.CommentDraft = string.Empty;
            detail.ClearReplyTarget();
        }
        finally
        {
            detail.IsCommentSending = false;
        }
    }

    private void BeginReply(NewsCommentViewModel? comment)
    {
        if (Detail is { } detail && comment is not null)
        {
            detail.SetReplyTarget(comment);
        }
    }

    private async Task SaveCommentEditAsync(NewsCommentViewModel? comment, CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || comment is null)
        {
            return;
        }

        var body = comment.EditBody.Trim();
        if (body.Length == 0 || body == comment.Body)
        {
            comment.CancelEdit();
            return;
        }

        DetailErrorText = null;
        comment.IsBusy = true;
        try
        {
            var updated = await _api.UpdateAnnouncementCommentAsync(
                detail.Id, comment.Id, body, cancellationToken);
            comment.ApplyUpdate(updated);
        }
        finally
        {
            comment.IsBusy = false;
        }
    }

    private async Task DeleteCommentAsync(NewsCommentViewModel? comment, CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || comment is null)
        {
            return;
        }

        DetailErrorText = null;
        comment.IsBusy = true;
        try
        {
            await _api.DeleteAnnouncementCommentAsync(detail.Id, comment.Id, cancellationToken);
            if (comment.ReplyCount > 0 || comment.Replies.Count > 0)
            {
                // С ответами ветка остаётся: помечаем tombstone как в вебе.
                comment.MarkDeleted();
            }
            else
            {
                detail.RemoveComment(comment);
            }

            detail.CommentsTotal = Math.Max(0, detail.CommentsTotal - 1);
        }
        finally
        {
            comment.IsBusy = false;
        }
    }

    private async Task ToggleCommentReactionAsync(
        NewsReactionChipViewModel? chip,
        CancellationToken cancellationToken)
    {
        if (chip?.Comment is not { } comment || Detail is not { } detail || comment.IsBusy)
        {
            return;
        }

        DetailErrorText = null;
        comment.IsBusy = true;
        try
        {
            var removing = comment.ViewerReaction == chip.ReactionType;
            var state = await _api.SetAnnouncementCommentReactionAsync(
                detail.Id, comment.Id, removing ? null : chip.ReactionType, cancellationToken);
            comment.ApplyReactionState(state);
        }
        finally
        {
            comment.IsBusy = false;
        }
    }

    /// <summary>Тоггл реакции комментария по типу — вызывается командой самого NewsCommentViewModel (паттерн чата).</summary>
    internal async Task ToggleCommentReactionByTypeAsync(
        NewsCommentViewModel comment,
        string? reactionType,
        CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || comment.IsBusy || string.IsNullOrWhiteSpace(reactionType))
        {
            return;
        }

        DetailErrorText = null;
        comment.IsBusy = true;
        try
        {
            var removing = comment.ViewerReaction == reactionType;
            var state = await _api.SetAnnouncementCommentReactionAsync(
                detail.Id, comment.Id, removing ? null : reactionType, cancellationToken);
            comment.ApplyReactionState(state);
        }
        catch (Exception ex)
        {
            DetailErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            comment.IsBusy = false;
        }
    }

    /// <summary>VM комментария вызывает это для постановки ошибки в баннер детали.</summary>
    internal void SetDetailError(string? message) => DetailErrorText = message;

    /// <summary>Обёртка комментария с обратной ссылкой на страницу (команды треда).</summary>
    internal NewsCommentViewModel WrapComment(HubAnnouncementComment comment) => new(comment, this);

    private async Task ToggleRepliesAsync(NewsCommentViewModel? comment, CancellationToken cancellationToken)
    {
        if (comment is null || Detail is not { } detail)
        {
            return;
        }

        if (comment.RepliesExpanded)
        {
            comment.RepliesExpanded = false;
            return;
        }

        comment.RepliesExpanded = true;
        if (comment.RepliesLoaded || comment.IsRepliesLoading)
        {
            return;
        }

        comment.IsRepliesLoading = true;
        try
        {
            var page = await _api.GetAnnouncementCommentsAsync(
                detail.Id,
                new HubAnnouncementCommentQuery
                {
                    Limit = CommentsPageSize,
                    RootCommentId = comment.Id,
                },
                cancellationToken);
            foreach (var reply in page.Items ?? [])
            {
                comment.Replies.Add(WrapComment(reply));
            }

            comment.RepliesLoaded = true;
        }
        finally
        {
            comment.IsRepliesLoading = false;
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
    private string _bookmarkedMarker = string.Empty;

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
        BookmarkedMarker = item.ViewerBookmarked ? "🔖" : string.Empty;
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

    /// <summary>Маркер закладки в списке («🔖») — обновляется тоглом в детали.</summary>
    public string BookmarkedMarker
    {
        get => _bookmarkedMarker;
        private set => SetProperty(ref _bookmarkedMarker, value);
    }

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

    /// <summary>Отметка закладки после тогла в detail (синхронно с ответом сервера).</summary>
    public void SetBookmarked(bool bookmarked) =>
        BookmarkedMarker = bookmarked ? "🔖" : string.Empty;

    internal static string FormatDate(DateTimeOffset? value) =>
        value is null
            ? string.Empty
            : value.Value.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture);
}

/// <summary>
/// Детальная панель новости: полный текст, метаданные, подтверждение прочтения,
/// реакции/лайк/закладка, опрос, вложения и комментарии.
/// </summary>
public sealed class NewsDetailViewModel : ObservableObject
{
    private bool _isAckPending;
    private bool _isAckBusy;
    private bool _isSocialBusy;
    private bool _isBookmarked;
    private bool _isLiked;
    private int _likesCount;
    private int _reactionsCount;
    private string? _viewerReaction;
    private Dictionary<string, int> _reactionCounts = new(StringComparer.Ordinal);
    private bool _hasPoll;
    private bool _pollHasVoted;
    private bool _pollIsClosed;
    private bool _pollIsMultiple;
    private bool _isPollBusy;
    private bool _isCommentsLoading;
    private bool _isCommentSending;
    private bool _commentsEnabled;
    private int _commentsTotal;
    private string _commentDraft = string.Empty;
    private string? _commentsErrorText;
    private NewsCommentViewModel? _replyTarget;

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

    // ---- Реакции / лайк / закладка ----

    /// <summary>Сервер разрешил реакции на объявлении (reactions_enabled).</summary>
    public bool ReactionsEnabled { get; private set; }

    /// <summary>Чипы реакций с ненулевым счётом (или своя). Своя подсвечена IsMine.</summary>
    public ObservableCollection<NewsReactionChipViewModel> ReactionChips { get; } = [];

    /// <summary>Есть хотя бы одна реакция — ряд чипов виден вместе с кнопкой «+».</summary>
    public bool HasReactionChips => ReactionChips.Count > 0;

    public string? ViewerReaction
    {
        get => _viewerReaction;
        private set => SetProperty(ref _viewerReaction, value);
    }

    public int ReactionsCount
    {
        get => _reactionsCount;
        private set => SetProperty(ref _reactionsCount, value);
    }

    public bool IsLiked
    {
        get => _isLiked;
        private set
        {
            if (SetProperty(ref _isLiked, value))
            {
                OnPropertyChanged(nameof(LikeText));
                OnPropertyChanged(nameof(LikeTooltip));
            }
        }
    }

    public int LikesCount
    {
        get => _likesCount;
        private set
        {
            if (SetProperty(ref _likesCount, value))
            {
                OnPropertyChanged(nameof(LikeText));
            }
        }
    }

    public bool IsBookmarked
    {
        get => _isBookmarked;
        set
        {
            if (SetProperty(ref _isBookmarked, value))
            {
                OnPropertyChanged(nameof(BookmarkText));
                OnPropertyChanged(nameof(BookmarkTooltip));
            }
        }
    }

    /// <summary>Общий busy соц-действий: параллельные тоглы не даём щёлкать.</summary>
    public bool IsSocialBusy
    {
        get => _isSocialBusy;
        set => SetProperty(ref _isSocialBusy, value);
    }

    /// <summary>Подпись like-кнопки — счёт с эмодзи сердца, как на вебе.</summary>
    public string LikeText => $"❤️ {LikesCount}";

    public string LikeTooltip => IsLiked ? "Убрать отметку «Нравится»" : "Нравится";

    public string BookmarkText => IsBookmarked ? "🔖 В закладках" : "🔖 В закладки";

    public string BookmarkTooltip => IsBookmarked ? "Убрать из закладок" : "Добавить в закладки";

    /// <summary>Снимок соц-состояния для оптимистичных тоглов с откатом (паттерн чата).</summary>
    public sealed record SocialSnapshot(
        Dictionary<string, int> Counts,
        string? ViewerReaction,
        int ReactionsCount,
        bool IsLiked,
        int LikesCount);

    internal SocialSnapshot CaptureSocial() => new(
        new Dictionary<string, int>(_reactionCounts, StringComparer.Ordinal),
        ViewerReaction,
        ReactionsCount,
        IsLiked,
        LikesCount);

    internal void ApplySocial(SocialSnapshot snapshot) => ApplySocialCore(
        snapshot.Counts, snapshot.ViewerReaction, snapshot.ReactionsCount,
        snapshot.IsLiked, snapshot.LikesCount);

    /// <summary>Серверный ответ reaction/like — авторитетное состояние счётчиков.</summary>
    internal void ApplyReactionState(HubAnnouncementReactionState state) => ApplySocialCore(
        state.ReactionCounts, state.ViewerReaction, state.ReactionsCount,
        state.ViewerHasLiked, state.LikesCount);

    /// <summary>Локальная оптимистичная перестановка реакции (до ответа сервера).</summary>
    internal void ApplyLocalReactionToggle(string reactionType)
    {
        var counts = new Dictionary<string, int>(_reactionCounts, StringComparer.Ordinal);
        string? viewer;
        var isLiked = IsLiked;
        var likes = LikesCount;
        if (ViewerReaction == reactionType)
        {
            Decrement(counts, reactionType);
            viewer = null;
            if (reactionType == "like")
            {
                isLiked = false;
                likes = Math.Max(0, likes - 1);
            }
        }
        else
        {
            if (ViewerReaction is not null)
            {
                Decrement(counts, ViewerReaction);
                if (ViewerReaction == "like")
                {
                    isLiked = false;
                    likes = Math.Max(0, likes - 1);
                }
            }

            counts[reactionType] = counts.GetValueOrDefault(reactionType) + 1;
            viewer = reactionType;
            if (reactionType == "like")
            {
                isLiked = true;
                likes++;
            }
        }

        ApplySocialCore(counts, viewer, counts.Values.Sum(), isLiked, likes);
    }

    /// <summary>Локальный оптимистичный лайк (like — одна из реакций сервера).</summary>
    internal void ApplyLocalLike(bool liked)
    {
        var counts = new Dictionary<string, int>(_reactionCounts, StringComparer.Ordinal);
        if (liked)
        {
            counts["like"] = counts.GetValueOrDefault("like") + 1;
        }
        else
        {
            Decrement(counts, "like");
        }

        // Если у пользователя была другая реакция — like её заменяет.
        var viewer = liked ? "like" : (ViewerReaction == "like" ? null : ViewerReaction);
        ApplySocialCore(
            counts, viewer, counts.Values.Sum(),
            liked, Math.Max(0, LikesCount + (liked ? 1 : -1)));
    }

    private static void Decrement(Dictionary<string, int> counts, string type)
    {
        var next = counts.GetValueOrDefault(type) - 1;
        if (next > 0)
        {
            counts[type] = next;
        }
        else
        {
            counts.Remove(type);
        }
    }

    private void ApplySocialCore(
        IReadOnlyDictionary<string, int>? counts,
        string? viewerReaction,
        int reactionsCount,
        bool isLiked,
        int likesCount)
    {
        _reactionCounts = counts is null
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : new Dictionary<string, int>(counts, StringComparer.Ordinal);
        ViewerReaction = viewerReaction;
        ReactionsCount = reactionsCount;
        IsLiked = isLiked;
        LikesCount = likesCount;
        RebuildReactionChips();
    }

    private void RebuildReactionChips()
    {
        ReactionChips.Clear();
        foreach (var (type, emoji, label) in NewsViewModel.ReactionCatalog)
        {
            var count = _reactionCounts.GetValueOrDefault(type);
            var mine = ViewerReaction == type;
            if (count <= 0 && !mine)
            {
                continue;
            }

            ReactionChips.Add(new NewsReactionChipViewModel(type, emoji, label, count, mine));
        }

        OnPropertyChanged(nameof(HasReactionChips));
    }

    // ---- Опрос ----

    public bool HasPoll
    {
        get => _hasPoll;
        private set
        {
            if (SetProperty(ref _hasPoll, value))
            {
                OnPropertyChanged(nameof(ShowPollResults));
                OnPropertyChanged(nameof(CanVotePoll));
            }
        }
    }

    public string PollQuestion { get; private set; } = string.Empty;

    /// <summary>Мета-строка опроса: анонимность + мультивыбор.</summary>
    public string PollMetaText { get; private set; } = string.Empty;

    public ObservableCollection<NewsPollOptionViewModel> PollOptions { get; } = [];

    public bool PollHasVoted
    {
        get => _pollHasVoted;
        private set
        {
            if (SetProperty(ref _pollHasVoted, value))
            {
                OnPropertyChanged(nameof(ShowPollResults));
                OnPropertyChanged(nameof(PollSubmitText));
                OnPropertyChanged(nameof(ShowPollCancelVote));
            }
        }
    }

    public bool IsPollClosed
    {
        get => _pollIsClosed;
        private set
        {
            if (SetProperty(ref _pollIsClosed, value))
            {
                OnPropertyChanged(nameof(ShowPollResults));
                OnPropertyChanged(nameof(CanVotePoll));
                OnPropertyChanged(nameof(ShowPollSubmit));
                OnPropertyChanged(nameof(ShowPollCancelVote));
            }
        }
    }

    public bool PollIsMultiple
    {
        get => _pollIsMultiple;
        private set
        {
            if (SetProperty(ref _pollIsMultiple, value))
            {
                OnPropertyChanged(nameof(ShowPollSubmit));
                OnPropertyChanged(nameof(ShowPollCancelVote));
            }
        }
    }

    public bool IsPollBusy
    {
        get => _isPollBusy;
        set => SetProperty(ref _isPollBusy, value);
    }

    /// <summary>Результаты видны после голосования или когда опрос завершён — как в вебе.</summary>
    public bool ShowPollResults => PollHasVoted || IsPollClosed;

    /// <summary>Голосовать можно, пока опрос не закрыт (переголосование разрешено сервером).</summary>
    public bool CanVotePoll => HasPoll && !IsPollClosed;

    /// <summary>Кнопка «Проголосовать/Изменить выбор» — только мультивыбор.</summary>
    public bool ShowPollSubmit => CanVotePoll && PollIsMultiple;

    /// <summary>«Отменить голос» — у мультивыбора после голосования.</summary>
    public bool ShowPollCancelVote => CanVotePoll && PollIsMultiple && PollHasVoted;

    public string PollSubmitText => PollHasVoted ? "Изменить выбор" : "Проголосовать";

    /// <summary>«Голосов: N».</summary>
    public string PollVotersText { get; private set; } = string.Empty;

    /// <summary>Дедлайн: «до dd.MM.yyyy HH:mm» / «Опрос завершён».</summary>
    public string PollClosesText { get; private set; } = string.Empty;

    internal void ApplyPoll(HubAnnouncementPoll poll)
    {
        HasPoll = true;
        PollQuestion = poll.Question ?? string.Empty;
        var meta = new List<string>();
        if (poll.IsAnonymous)
        {
            meta.Add("Анонимный опрос");
        }

        if (poll.AllowsMultiple)
        {
            meta.Add("Можно выбрать несколько вариантов");
        }

        PollMetaText = string.Join(" · ", meta);
        PollIsMultiple = poll.AllowsMultiple;
        PollHasVoted = poll.HasVoted;
        IsPollClosed = poll.IsClosed || (poll.ClosesAt is { } closesAt && closesAt <= DateTimeOffset.Now);
        PollVotersText = $"Голосов: {poll.TotalVoters}";
        PollClosesText = IsPollClosed
            ? "Опрос завершён"
            : poll.ClosesAt is { } openUntil
                ? $"до {NewsListItemViewModel.FormatDate(openUntil)}"
                : string.Empty;
        var showResults = ShowPollResults;
        PollOptions.Clear();
        foreach (var option in poll.Options ?? [])
        {
            PollOptions.Add(new NewsPollOptionViewModel(
                option, poll, showResults, !IsPollClosed));
        }

        OnPropertyChanged(string.Empty);
    }

    // ---- Вложения ----

    /// <summary>Чипы вложений detail-карточки (файл скачивается по клику).</summary>
    public ObservableCollection<NewsAttachmentViewModel> Attachments { get; } = [];

    public bool HasAttachments => Attachments.Count > 0;

    // ---- Комментарии ----

    /// <summary>comments_enabled у объявления — выключает композер и ответы.</summary>
    public bool CommentsEnabled
    {
        get => _commentsEnabled;
        private set
        {
            if (SetProperty(ref _commentsEnabled, value))
            {
                OnPropertyChanged(nameof(ShowComposer));
                OnPropertyChanged(nameof(CommentsDisabledText));
            }
        }
    }

    public ObservableCollection<NewsCommentViewModel> Comments { get; } = [];

    public int CommentsTotal
    {
        get => _commentsTotal;
        set
        {
            if (SetProperty(ref _commentsTotal, value))
            {
                OnPropertyChanged(nameof(CommentsHeaderText));
            }
        }
    }

    public int? NextCommentsOffset { get; private set; }

    public bool HasMoreComments => NextCommentsOffset is not null;

    public bool IsCommentsLoading
    {
        get => _isCommentsLoading;
        set
        {
            if (SetProperty(ref _isCommentsLoading, value))
            {
                OnPropertyChanged(nameof(ShowCommentsLoading));
            }
        }
    }

    /// <summary>Индикатор только когда список пуст — при догрузке старые комментарии видны.</summary>
    public bool ShowCommentsLoading => IsCommentsLoading && Comments.Count == 0;

    /// <summary>Локальная ошибка секции комментариев — карточка новости не падает.</summary>
    public string? CommentsErrorText
    {
        get => _commentsErrorText;
        set => SetProperty(ref _commentsErrorText, value);
    }

    public bool IsCommentSending
    {
        get => _isCommentSending;
        set => SetProperty(ref _isCommentSending, value);
    }

    public string CommentDraft
    {
        get => _commentDraft;
        set => SetProperty(ref _commentDraft, value);
    }

    /// <summary>Комментарий, на который отвечает композер (null — корневой пост).</summary>
    public NewsCommentViewModel? ReplyTarget
    {
        get => _replyTarget;
        private set
        {
            if (SetProperty(ref _replyTarget, value))
            {
                OnPropertyChanged(nameof(ReplyToText));
            }
        }
    }

    public string ReplyToText => ReplyTarget is { } target
        ? $"Ответ на комментарий: {target.AuthorText}"
        : string.Empty;

    /// <summary>Композер виден только когда комментарии включены.</summary>
    public bool ShowComposer => CommentsEnabled;

    public string CommentsDisabledText => CommentsEnabled
        ? string.Empty
        : "Комментарии отключены для этой новости";

    public string CommentsHeaderText => CommentsTotal > 0
        ? $"Комментарии ({CommentsTotal})"
        : "Комментарии";

    internal void ApplyCommentsPage(HubAnnouncementCommentPage page)
    {
        NextCommentsOffset = page.NextOffset;
        CommentsTotal = page.CommentsTotal > 0 ? page.CommentsTotal : page.Total;
        OnPropertyChanged(nameof(HasMoreComments));
        OnPropertyChanged(nameof(CommentsHeaderText));
    }

    internal void SetReplyTarget(NewsCommentViewModel target) => ReplyTarget = target;

    internal void ClearReplyTarget() => ReplyTarget = null;

    internal void RemoveComment(NewsCommentViewModel comment)
    {
        if (Comments.Remove(comment))
        {
            return;
        }

        foreach (var root in Comments)
        {
            if (root.Replies.Remove(comment))
            {
                root.ReplyCount = Math.Max(0, root.ReplyCount - 1);
                return;
            }
        }
    }

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

        // Соц-слой: реакции/лайк/закладка из detail-ответа.
        ReactionsEnabled = item.ReactionsEnabled;
        IsBookmarked = item.ViewerBookmarked;
        ApplySocialCore(
            item.ReactionCounts, item.ViewerReaction, item.ReactionsCount,
            item.ViewerHasLiked, item.LikesCount);

        // Опрос — только в detail.
        if (item.Poll is { } poll)
        {
            ApplyPoll(poll);
        }
        else
        {
            HasPoll = false;
            PollOptions.Clear();
        }

        // Вложения — чипы скачивания.
        Attachments.Clear();
        foreach (var attachment in item.Attachments ?? [])
        {
            Attachments.Add(new NewsAttachmentViewModel(attachment));
        }

        OnPropertyChanged(nameof(HasAttachments));

        // Комментарии: счёт и выключенность — из detail; сам список грузится отдельно.
        CommentsEnabled = item.CommentsEnabled;
        CommentsTotal = item.CommentsCount;
        Comments.Clear();
        NextCommentsOffset = null;
        CommentsErrorText = null;
        CommentDraft = string.Empty;
        ReplyTarget = null;
        OnPropertyChanged(nameof(HasMoreComments));
        OnPropertyChanged(nameof(CommentsHeaderText));
        OnPropertyChanged(string.Empty);
    }
}

/// <summary>Чип реакции: эмодзи + счёт; своя реакция подсвечена (IsMine → чек чипа).</summary>
public sealed class NewsReactionChipViewModel : ObservableObject
{
    private int _count;
    private bool _isMine;

    public NewsReactionChipViewModel(
        string reactionType,
        string emoji,
        string label,
        int count,
        bool isMine,
        NewsCommentViewModel? comment = null)
    {
        ReactionType = reactionType;
        Emoji = emoji;
        Label = label;
        _count = count;
        _isMine = isMine;
        Comment = comment;
    }

    public string ReactionType { get; }
    public string Emoji { get; }
    public string Label { get; }

    /// <summary>Комментарий-владелец чипа; null — реакция самой новости.</summary>
    public NewsCommentViewModel? Comment { get; }

    public int Count
    {
        get => _count;
        private set
        {
            if (SetProperty(ref _count, value))
            {
                OnPropertyChanged(nameof(DisplayText));
            }
        }
    }

    /// <summary>Реакция текущего пользователя — чип отмечен.</summary>
    public bool IsMine
    {
        get => _isMine;
        private set => SetProperty(ref _isMine, value);
    }

    /// <summary>«👍 3».</summary>
    public string DisplayText => $"{Emoji} {Count}";

    public string TooltipText => Label;

    internal void Set(int count, bool isMine)
    {
        Count = count;
        IsMine = isMine;
    }
}

/// <summary>Вариант опроса объявления: выбор (кнопка/чекбокс) и результат-полоска.</summary>
public sealed class NewsPollOptionViewModel : ObservableObject
{
    private bool _isSelected;

    public NewsPollOptionViewModel(
        HubAnnouncementPollOption option,
        HubAnnouncementPoll poll,
        bool showResults,
        bool canVote)
    {
        ArgumentNullException.ThrowIfNull(option);
        ArgumentNullException.ThrowIfNull(poll);
        Id = option.Id ?? string.Empty;
        Text = option.Text ?? string.Empty;
        VotesCount = option.VotesCount;
        IsViewerVote = option.ViewerVoted;
        _isSelected = option.ViewerVoted;
        Percent = poll.TotalVoters > 0
            ? (int)Math.Round(option.VotesCount * 100.0 / poll.TotalVoters, MidpointRounding.AwayFromZero)
            : 0;
        PercentText = $"{Percent}%";
        // В вебе варианты остаются кликабельными и в режиме результатов — переголосование.
        ShowVoteButton = canVote && !poll.AllowsMultiple;
        ShowCheckBox = canVote && poll.AllowsMultiple;
        ShowResult = showResults;
    }

    public string Id { get; }
    public string Text { get; }
    public int VotesCount { get; }
    public int Percent { get; }
    public string PercentText { get; }

    /// <summary>Вариант, за который проголосовал текущий пользователь (✓-маркер).</summary>
    public bool IsViewerVote { get; }

    /// <summary>Чекбокс мультивыбора: начальное состояние — голос пользователя.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>Single-опрос: вариант — кнопка «проголосовать/переголосовать».</summary>
    public bool ShowVoteButton { get; }

    /// <summary>Multiple-опрос: вариант — чекбокс выбора.</summary>
    public bool ShowCheckBox { get; }

    /// <summary>Полоска результата (видна после голоса или при закрытом опросе).</summary>
    public bool ShowResult { get; }
}

/// <summary>Чип вложения (объявления или комментария): имя+размер, клик — скачать и открыть.</summary>
public sealed class NewsAttachmentViewModel : ObservableObject
{
    private bool _isDownloading;

    public NewsAttachmentViewModel(HubAnnouncementAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        AttachmentId = attachment.Id ?? string.Empty;
        Name = attachment.FileName ?? "Вложение";
        FileSize = attachment.FileSize;
        SizeText = FormatSize(attachment.FileSize);
    }

    public NewsAttachmentViewModel(HubAnnouncementCommentAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        AttachmentId = attachment.Id ?? string.Empty;
        CommentId = attachment.CommentId;
        Name = attachment.FileName ?? "Вложение";
        FileSize = attachment.FileSize;
        SizeText = FormatSize(attachment.FileSize);
    }

    public string AttachmentId { get; }

    /// <summary>Id комментария-владельца (null — вложение самой новости).</summary>
    public string? CommentId { get; }

    public string Name { get; }
    public long FileSize { get; }
    public string SizeText { get; }

    /// <summary>«📎 grafik.pdf · 178 КБ».</summary>
    public string DisplayText => IsDownloading
        ? $"📎 {Name} · скачиваем…"
        : SizeText.Length > 0
            ? $"📎 {Name} · {SizeText}"
            : $"📎 {Name}";

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(DisplayText));
            }
        }
    }

    private static string FormatSize(long bytes) => bytes switch
    {
        < 0 => string.Empty,
        < 1024 => $"{bytes} Б",
        < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
        _ => $"{bytes / (1024.0 * 1024.0):0.#} МБ",
    };
}

/// <summary>Комментарий объявления: автор, время, ответы, реакции, вложения, edit/delete.</summary>
public sealed class NewsCommentViewModel : ObservableObject
{
    private readonly NewsViewModel? _owner;
    private string _body;
    private bool _isDeleted;
    private bool _isEditing;
    private bool _isBusy;
    private bool _repliesExpanded;
    private bool _isRepliesLoading;
    private bool _repliesLoaded;
    private int _replyCount;
    private string _editBody = string.Empty;
    private string _dateText;
    private string? _viewerReaction;
    private Dictionary<string, int> _reactionCounts = new(StringComparer.Ordinal);

    public NewsCommentViewModel(HubAnnouncementComment comment, NewsViewModel? owner = null)
    {
        ArgumentNullException.ThrowIfNull(comment);
        _owner = owner;
        Id = comment.Id ?? string.Empty;
        AuthorText = comment.FullName ?? comment.Username ?? "Пользователь";
        ReplyToText = comment.ReplyToUsername is { } replyTo
            ? $"ответ {replyTo}"
            : string.Empty;
        CanEdit = comment.CanEdit;
        CanDelete = comment.CanDelete;
        CanReply = !comment.IsDeleted;
        _replyCount = comment.ReplyCount;
        _body = comment.Body ?? string.Empty;
        _isDeleted = comment.IsDeleted;
        _dateText = FormatDateText(comment);
        _viewerReaction = comment.ViewerReaction;
        _reactionCounts = comment.ReactionCounts is null
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : new Dictionary<string, int>(comment.ReactionCounts, StringComparer.Ordinal);
        PickReactionCommand = new NativeAsyncCommand(
            (parameter, ct) => owner is null
                ? Task.CompletedTask
                : owner.ToggleCommentReactionByTypeAsync(this, parameter as string, ct),
            ex => owner?.SetDetailError(TasksViewModel.DescribeError(ex)));
        RebuildReactionChips();
        foreach (var attachment in comment.Attachments ?? [])
        {
            Attachments.Add(new NewsAttachmentViewModel(attachment));
        }
    }

    public string Id { get; }
    public string AuthorText { get; }

    /// <summary>«ответ username» — для дочерних комментариев ветки.</summary>
    public string ReplyToText { get; }

    public bool CanEdit { get; }
    public bool CanDelete { get; }
    public bool CanReply { get; }
    public bool ShowActions => CanEdit || CanDelete;

    public string Body
    {
        get => _body;
        private set => SetProperty(ref _body, value);
    }

    /// <summary>Тело под tombstone — «Комментарий удалён» курсивом, как в вебе.</summary>
    public string DisplayBody => IsDeleted ? "Комментарий удалён" : Body;

    public bool IsDeleted
    {
        get => _isDeleted;
        private set
        {
            if (SetProperty(ref _isDeleted, value))
            {
                OnPropertyChanged(nameof(DisplayBody));
                OnPropertyChanged(nameof(ShowReactions));
            }
        }
    }

    public string DateText
    {
        get => _dateText;
        private set => SetProperty(ref _dateText, value);
    }

    /// <summary>Дочерний комментарий ветки (есть reply_to).</summary>
    public bool IsReply => ReplyToText.Length > 0;

    public bool IsEditing
    {
        get => _isEditing;
        private set => SetProperty(ref _isEditing, value);
    }

    public string EditBody
    {
        get => _editBody;
        set => SetProperty(ref _editBody, value);
    }

    /// <summary>Busy: локальные действия (edit/delete/реакции) сериализуем.</summary>
    public bool IsBusy
    {
        get => _isBusy;
        set => SetProperty(ref _isBusy, value);
    }

    public int ReplyCount
    {
        get => _replyCount;
        set
        {
            if (SetProperty(ref _replyCount, value))
            {
                OnPropertyChanged(nameof(RepliesButtonText));
                OnPropertyChanged(nameof(HasReplies));
            }
        }
    }

    public bool HasReplies => ReplyCount > 0 || Replies.Count > 0;

    /// <summary>«Ответов: N»/«Скрыть ответы» на кнопке раскрытия ветки.</summary>
    public string RepliesButtonText => RepliesExpanded
        ? "Скрыть ответы"
        : $"Ответов: {ReplyCount}";

    public bool RepliesExpanded
    {
        get => _repliesExpanded;
        set => SetProperty(ref _repliesExpanded, value);
    }

    public bool IsRepliesLoading
    {
        get => _isRepliesLoading;
        set => SetProperty(ref _isRepliesLoading, value);
    }

    /// <summary>Ветка уже загружена — повторный GET не нужен.</summary>
    public bool RepliesLoaded
    {
        get => _repliesLoaded;
        set => SetProperty(ref _repliesLoaded, value);
    }

    public ObservableCollection<NewsCommentViewModel> Replies { get; } = [];

    public ObservableCollection<NewsReactionChipViewModel> ReactionChips { get; } = [];

    /// <summary>Меню «+» на комментарии: параметр — тип реакции (паттерн чата).</summary>
    public ICommand PickReactionCommand { get; }

    public string? ViewerReaction => _viewerReaction;

    public bool ShowReactions => !IsDeleted;

    public ObservableCollection<NewsAttachmentViewModel> Attachments { get; } = [];

    public bool HasAttachments => Attachments.Count > 0;

    public void BeginEdit()
    {
        EditBody = Body;
        IsEditing = true;
    }

    public void CancelEdit() => IsEditing = false;

    /// <summary>Успешный PATCH: тело/время/флаги обновляем из ответа сервера.</summary>
    internal void ApplyUpdate(HubAnnouncementComment comment)
    {
        Body = comment.Body ?? Body;
        DateText = FormatDateText(comment);
        IsEditing = false;
    }

    internal void MarkDeleted()
    {
        IsDeleted = true;
        Body = string.Empty;
        IsEditing = false;
    }

    /// <summary>Ответ PUT/DELETE …/reaction: авторитетные счётчики и своя реакция.</summary>
    internal void ApplyReactionState(HubAnnouncementCommentReactionState state)
    {
        _reactionCounts = state.ReactionCounts is null
            ? new Dictionary<string, int>(StringComparer.Ordinal)
            : new Dictionary<string, int>(state.ReactionCounts, StringComparer.Ordinal);
        _viewerReaction = state.ViewerReaction;
        RebuildReactionChips();
    }

    private void RebuildReactionChips()
    {
        ReactionChips.Clear();
        foreach (var (type, emoji, label) in NewsViewModel.ReactionCatalog)
        {
            var count = _reactionCounts.GetValueOrDefault(type);
            var mine = _viewerReaction == type;
            if (count <= 0 && !mine)
            {
                continue;
            }

            ReactionChips.Add(new NewsReactionChipViewModel(type, emoji, label, count, mine, this));
        }
    }

    private static string FormatDateText(HubAnnouncementComment comment)
    {
        var text = NewsListItemViewModel.FormatDate(comment.CreatedAt);
        if (comment.UpdatedAt is { } updated && updated != comment.CreatedAt)
        {
            text += " (изменено)";
        }

        return text;
    }
}

