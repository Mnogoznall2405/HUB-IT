using System.Collections.ObjectModel;
using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Строка ленты центра уведомлений: модель API + флаг непрочитанного.
/// created_at — ISO-строка UTC; отображается в локальном времени (dd.MM HH:mm),
/// как метки времени у соседних списков (почта/чат/новости).
/// </summary>
public sealed class NotificationItemViewModel : ObservableObject
{
    private bool _isUnread;

    public NotificationItemViewModel(HubNotificationItem item)
    {
        Item = item;
        _isUnread = item.Unread != 0;
    }

    /// <summary>Исходная запись сервера (entity_type/entity_id нужны навигации).</summary>
    public HubNotificationItem Item { get; }

    public string Id => Item.Id ?? string.Empty;
    public string Title => Item.Title ?? string.Empty;
    public string Body => Item.Body ?? string.Empty;
    public string EntityType => Item.EntityType ?? string.Empty;
    public string EntityId => Item.EntityId ?? string.Empty;

    /// <summary>Непрочитано по серверному unread (0/1); локально сбрасывается при прочтении.</summary>
    public bool IsUnread
    {
        get => _isUnread;
        set => SetProperty(ref _isUnread, value);
    }

    /// <summary>dd.MM HH:mm в локальном времени (created_at приходит в UTC ISO).</summary>
    public string DateText =>
        DateTimeOffset.TryParse(
            Item.CreatedAt,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM HH:mm", CultureInfo.CurrentCulture)
            : Item.CreatedAt ?? string.Empty;

    /// <summary>Глиф типа сущности — как пиктограммы разделов левой навигации.</summary>
    public string EntityGlyph => EntityType switch
    {
        "task" => "✅",
        "announcement" => "📰",
        "chat" => "💬",
        "mail" => "✉",
        "docflow" => "📄",
        _ => "🔔",
    };

    public string AccessibleName =>
        (IsUnread ? "Непрочитанное уведомление. " : "Уведомление. ")
        + Title
        + (string.IsNullOrEmpty(Body) ? string.Empty : ". " + Body);
}

/// <summary>
/// Центр уведомлений (колокол шелла): лента GET /hub/notifications/poll,
/// бейдж непрочитанных (unread_counts.notifications_unread_total),
/// таймер-подстраховка и отметки прочитанным. Realtime-события — дешёвые
/// триггеры: данные подтягиваются тем же poll (инкремент по курсору since).
/// Навигацию по сущности делает шелл через событие OpenRequested.
/// </summary>
public sealed class NotificationsViewModel : ObservableObject
{
    /// <summary>Размер страницы ленты (сервер клампит в 1..200).</summary>
    internal const int FeedLimit = 50;

    /// <summary>Период таймера-подстраховки (realtime — основной канал).</summary>
    internal static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);

    private readonly IHubApiClient _api;
    /// <summary>Курсор since: максимальный created_at полученных записей (строка).</summary>
    private string _sinceCursor = string.Empty;
    private bool _isPanelOpen;
    private bool _isLoading;
    private bool _hasLoaded;
    private int _unreadTotal;
    private string? _bannerErrorText;
    private CancellationTokenSource? _pollCancellation;
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight загрузки.</summary>
    private int _loadEpoch;

    public NotificationsViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        TogglePanelCommand = new NativeRelayCommand(() => IsPanelOpen = !IsPanelOpen);
        ClosePanelCommand = new NativeRelayCommand(() => IsPanelOpen = false);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is NotificationItemViewModel item
                ? OpenAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is NotificationItemViewModel);
        MarkReadCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is NotificationItemViewModel item
                ? MarkReadAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is NotificationItemViewModel { IsUnread: true });
        MarkAllReadCommand = new NativeAsyncCommand(
            (_, ct) => MarkAllReadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasUnread);
    }

    /// <summary>
    /// Клик по строке ленты: шелл маппит entity_type/entity_id на страницу и
    /// выбирает сущность (task → задача, announcement → новость, chat → диалог,
    /// mail/docflow — раздел). Немаппируемые типы — только отметка прочитанным.
    /// </summary>
    public event EventHandler<NotificationItemViewModel>? OpenRequested;

    /// <summary>
    /// Тестовый шов таймера: интервал между тиками. Тест, ждущий первый тик,
    /// должен блокировать последующие (иначе мгновенная задержка крутит цикл).
    /// </summary>
    public Func<TimeSpan, CancellationToken, Task> DelayAsync { get; set; } = Task.Delay;

    public ObservableCollection<NotificationItemViewModel> Items { get; } = [];

    /// <summary>Непрочитанных по notifications_unread_total сервера; уменьшается локально.</summary>
    public int UnreadTotal
    {
        get => _unreadTotal;
        private set
        {
            if (SetProperty(ref _unreadTotal, value))
            {
                OnPropertyChanged(nameof(HasUnread));
                (MarkAllReadCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasUnread => UnreadTotal > 0;

    /// <summary>Панель ленты открыта; открытие догоняет свежие записи инкрементом.</summary>
    public bool IsPanelOpen
    {
        get => _isPanelOpen;
        set
        {
            if (SetProperty(ref _isPanelOpen, value) && value)
            {
                _ = RefreshFromRealtimeAsync();
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
            }
        }
    }

    /// <summary>Первичная выдача получена хотя бы раз (пустая лента ≠ загрузка).</summary>
    public bool HasLoaded
    {
        get => _hasLoaded;
        private set
        {
            if (SetProperty(ref _hasLoaded, value))
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

    public bool HasContent => Items.Count > 0;
    public bool IsEmpty => HasLoaded && !IsLoading && Items.Count == 0 && !HasBannerError;

    public ICommand TogglePanelCommand { get; }
    public ICommand ClosePanelCommand { get; }
    public ICommand RefreshCommand { get; }
    /// <summary>Клик по уведомлению: отметка прочитанным + навигация к сущности.</summary>
    public ICommand OpenCommand { get; }
    /// <summary>«✓» на непрочитанной строке — только отметка, без перехода.</summary>
    public ICommand MarkReadCommand { get; }
    public ICommand MarkAllReadCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>
    /// Первичная загрузка/обновление: GET poll без курсора — свежая голова ленты
    /// (новые сверху), курсор и бейдж переустанавливаются по ответу.
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var epoch = _loadEpoch;
            var page = await _api.GetNotificationsPollAsync(
                since: null, FeedLimit, unreadOnly: false, cancellationToken);
            if (epoch != _loadEpoch)
            {
                return;
            }

            Items.Clear();
            foreach (var item in Sorted(page.Items))
            {
                Items.Add(new NotificationItemViewModel(item));
            }

            ApplyUnreadCounts(page.UnreadCounts);
            AdvanceCursor(page.Items);
            HasLoaded = true;
            BannerErrorText = null;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Баннер в панели (как у страниц): явный Refresh догонит состояние.
            BannerErrorText = TasksViewModel.DescribeError(exception);
            HasLoaded = true;
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
        HasLoaded = true;
    }

    /// <summary>
    /// Тихий инкремент по realtime-событию (hub.notification.created), тику
    /// таймера и reconnect-resync: poll с курсором since — только записи строго
    /// новее уже полученных; они вливаются в голову ленты, бейдж обновляется
    /// по unread_counts ответа. Пустой курсор (до первой выдачи) — свежая голова,
    /// что закрывает и догрузку после Reset.
    /// Серийная: события во время прохода сливаются в один повторный проход.
    /// Ошибки молчим — событие лишь подсказка, явное «Обновить» догонит состояние.
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
                await RefreshFromRealtimeCoreAsync(cancellationToken);
            }
            while (_realtimeRefreshQueued);
        }
        finally
        {
            _realtimeRefreshInFlight = false;
        }
    }

    private async Task RefreshFromRealtimeCoreAsync(CancellationToken cancellationToken)
    {
        var epoch = _loadEpoch;
        try
        {
            var page = await _api.GetNotificationsPollAsync(
                _sinceCursor, FeedLimit, unreadOnly: false, cancellationToken);
            if (epoch != _loadEpoch)
            {
                // Сессия сменилась (Reset) — чужие данные не применяем.
                return;
            }

            MergeIncremental(page.Items);
            ApplyUnreadCounts(page.UnreadCounts);
            AdvanceCursor(page.Items);
            HasLoaded = true;
        }
        catch
        {
            // Тихая подсказка realtime: баннер не трогаем, Refresh догонит позже.
        }
    }

    /// <summary>
    /// Один тик таймера-подстраховки; вынесен для тестов — цикл ниже крутит его
    /// с DelayAsync-интервалом до отмены. Без активной сессии (до первой
    /// загрузки/после Reset) запрос не уходит — лента не воскресает сама.
    /// </summary>
    internal Task PollTickAsync(CancellationToken cancellationToken) =>
        HasLoaded ? RefreshFromRealtimeAsync(cancellationToken) : Task.CompletedTask;

    /// <summary>Запуск таймера-подстраховки (вызывает шелл после загрузки страниц).</summary>
    public void StartPolling()
    {
        if (_pollCancellation is not null)
        {
            return;
        }

        var cancellation = new CancellationTokenSource();
        _pollCancellation = cancellation;
        _ = PollLoopAsync(cancellation);
    }

    /// <summary>Остановка таймера (Reset/закрытие окна).</summary>
    public void StopPolling()
    {
        _pollCancellation?.Cancel();
        _pollCancellation = null;
    }

    private async Task PollLoopAsync(CancellationTokenSource cancellation)
    {
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                await DelayAsync(PollInterval, cancellation.Token);
                if (cancellation.IsCancellationRequested)
                {
                    break;
                }

                await PollTickAsync(cancellation.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // Остановка таймера при выходе из сессии — штатный путь.
        }
        catch
        {
            // Таймер-подстраховка не убивает шелл: realtime и Refresh остаются.
        }
    }

    /// <summary>Сброс содержимого при выходе из сессии (и закрытии окна).</summary>
    public void Reset()
    {
        StopPolling();
        _loadEpoch++;
        _realtimeRefreshQueued = false;
        IsPanelOpen = false;
        Items.Clear();
        _sinceCursor = string.Empty;
        UnreadTotal = 0;
        BannerErrorText = null;
        HasLoaded = false;
        IsLoading = false;
    }

    /// <summary>
    /// Открытие уведомления: оптимистичная отметка прочитанным (бейдж -1,
    /// откат при ошибке POST), событие навигации шеллу и POST /{id}/read.
    /// </summary>
    private async Task OpenAsync(NotificationItemViewModel item, CancellationToken cancellationToken)
    {
        IsPanelOpen = false;
        var wasUnread = item.IsUnread;
        if (wasUnread)
        {
            item.IsUnread = false;
            UnreadTotal = Math.Max(0, UnreadTotal - 1);
        }

        // Навигация не ждёт POST прочтения — как в веб-лентах уведомлений.
        OpenRequested?.Invoke(this, item);
        if (!wasUnread)
        {
            return;
        }

        try
        {
            await _api.MarkNotificationReadAsync(item.Id, cancellationToken);
        }
        catch (Exception exception)
        {
            // Откат оптимистичного прочтения — следующий poll догонит истину.
            item.IsUnread = true;
            UnreadTotal += 1;
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>Отметка прочитанным без навигации («✓» на строке).</summary>
    private async Task MarkReadAsync(NotificationItemViewModel item, CancellationToken cancellationToken)
    {
        if (!item.IsUnread)
        {
            return;
        }

        item.IsUnread = false;
        UnreadTotal = Math.Max(0, UnreadTotal - 1);
        try
        {
            await _api.MarkNotificationReadAsync(item.Id, cancellationToken);
        }
        catch (Exception exception)
        {
            item.IsUnread = true;
            UnreadTotal += 1;
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    /// <summary>«Прочитать все»: оптимистичный сброс ленты и бейджа + POST read-all.</summary>
    private async Task MarkAllReadAsync(CancellationToken cancellationToken)
    {
        var unreadItems = Items.Where(item => item.IsUnread).ToList();
        var previousTotal = UnreadTotal;
        foreach (var item in unreadItems)
        {
            item.IsUnread = false;
        }

        UnreadTotal = 0;
        try
        {
            await _api.MarkAllNotificationsReadAsync(cancellationToken);
        }
        catch (Exception exception)
        {
            foreach (var item in unreadItems)
            {
                item.IsUnread = true;
            }

            UnreadTotal = previousTotal;
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    private void ApplyUnreadCounts(HubNotificationUnreadCounts? counts)
    {
        if (counts is not null)
        {
            UnreadTotal = Math.Max(0, counts.NotificationsUnreadTotal);
        }
    }

    /// <summary>Курсор = максимальный created_at полученных записей (ISO-строки сравнимы).</summary>
    private void AdvanceCursor(IReadOnlyList<HubNotificationItem>? items)
    {
        foreach (var item in items ?? [])
        {
            if (!string.IsNullOrEmpty(item.CreatedAt)
                && string.CompareOrdinal(item.CreatedAt, _sinceCursor) > 0)
            {
                _sinceCursor = item.CreatedAt;
            }
        }
    }

    /// <summary>
    /// Инкремент poll: новые записи (created_at > курсора) вливаются в ленту;
    /// дедуп по id на границе курсора, итог — новые сверху (created_at DESC).
    /// Слияние на уровне VM: локальный IsUnread уже прочитанных строк сохраняется.
    /// </summary>
    private void MergeIncremental(IReadOnlyList<HubNotificationItem>? items)
    {
        if (items is not { Count: > 0 })
        {
            return;
        }

        var knownIds = new HashSet<string>(Items.Select(item => item.Id), StringComparer.Ordinal);
        var merged = new List<NotificationItemViewModel>(Items);
        foreach (var item in items)
        {
            if (item.Id is { Length: > 0 } id && !knownIds.Add(id))
            {
                continue;
            }

            merged.Add(new NotificationItemViewModel(item));
        }

        Items.Clear();
        foreach (var item in merged.OrderByDescending(
                     row => row.Item.CreatedAt, StringComparer.Ordinal))
        {
            Items.Add(item);
        }
    }

    /// <summary>Лента как на сервере и в вебе: новые сверху (created_at DESC).</summary>
    private static IEnumerable<HubNotificationItem> Sorted(IReadOnlyList<HubNotificationItem>? items) =>
        (items ?? []).OrderByDescending(item => item.CreatedAt, StringComparer.Ordinal);
}
