using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Windows.Input;
using Hub.Desktop.Native.Api;
using System.Windows;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Чат» нативного шелла: список диалогов слева, лента сообщений справа,
/// composer и realtime-обновления через IHubChatRealtime.
/// Шелл создаёт ChatViewModel(api) — realtime поднимается лениво в LoadAsync;
/// тесты инжектируют свой IHubChatRealtime вторым аргументом.
/// </summary>
public sealed class ChatViewModel : ObservableObject
{
    internal const int MessagesPageSize = 50;

    private static readonly TimeSpan ConversationsReloadDebounce = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan UserSearchDebounce = TimeSpan.FromMilliseconds(350);
    private static readonly TimeSpan TypingSendThrottle = TimeSpan.FromSeconds(3);
    private const int TypingDefaultExpiresMs = 5000;
    private const int ConversationsPageLimit = 100;
    private const int ChatUsersPageLimit = 20;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly IHubApiClient _api;
    private readonly AuthImageLoader _imageLoader;
    private readonly SynchronizationContext? _syncContext;
    private readonly List<ConversationItemViewModel> _allConversations = [];
    private readonly IHubChatRealtime? _injectedRealtime;

    private IHubChatRealtime? _realtime;
    private bool _realtimeSubscribed;
    private CancellationTokenSource? _messagesLoadCancellation;
    private CancellationTokenSource? _conversationsReloadCancellation;
    private CancellationTokenSource? _userSearchCancellation;
    private CancellationTokenSource? _conversationSearchCancellation;
    private List<ConversationItemViewModel>? _serverSearchResults;
    private string? _pendingConversationId;
    private string? _olderCursor;
    private string? _conversationsCursor;
    private bool _hasMoreConversations;
    private bool _isLoadingMoreConversations;
    private bool _isNewConversationOpen;
    private string _newConversationSearchText = string.Empty;
    private bool _isSearchingUsers;
    private bool _isCreatingConversation;
    private ChatMessageViewModel? _replyingTo;
    private ChatMessageViewModel? _editingMessage;
    private CancellationTokenSource? _messageSearchCancellation;
    private string _messageSearchText = string.Empty;
    private bool _isMessageSearchOpen;
    private bool _isSearchingMessages;
    private ChatMessageViewModel? _selectedMessage;
    private CancellationTokenSource? _globalSearchCancellation;
    private string _globalSearchText = string.Empty;
    private bool _isGlobalSearchOpen;
    private bool _isSearchingGlobal;
    private bool _isForwardPanelOpen;
    private ChatMessageViewModel? _forwardingMessage;
    private bool _isForwarding;
    private bool _isReadersPanelOpen;
    private bool _isLoadingReaders;
    private string? _readersTitleText;
    private string? _pendingAnchorMessageId;
    private bool _isNewGroupMode;
    private string _newGroupTitle = string.Empty;
    private bool _isMembersPanelOpen;
    private bool _isLoadingMembers;
    private string? _membersTitleText;
    private bool _canManageGroupMembers;
    private string _memberSearchText = string.Empty;
    private bool _isSearchingMemberCandidates;
    private bool _isMemberActionBusy;
    private CancellationTokenSource? _memberSearchCancellation;
    private ConversationItemViewModel? _membersPanelConversation;
    private bool _isExportingConversation;

    // Медиагалерея диалога: вкладки «Медиа» (image+video), «Файлы», «Аудио» —
    // как attachmentStreams в web; у каждого kind свой курсор пагинации.
    private bool _isMediaPanelOpen;
    private bool _isLoadingMedia;
    private bool _isLoadingMoreMedia;
    private ConversationItemViewModel? _mediaPanelConversation;
    private string _selectedMediaTab = MediaTabMedia;
    private const int MediaPageSize = 30;
    private const string MediaTabMedia = "media";
    private const string MediaTabFiles = "file";
    private const string MediaTabAudio = "audio";

    /// <summary>Состояние потока одного kind: курсор «до», хвост и факт первой загрузки.</summary>
    private sealed class MediaStreamState
    {
        public string? Cursor;
        public bool HasMore;
        public bool Loaded;
    }

    private static readonly Dictionary<string, string[]> MediaTabKindsMap = new(StringComparer.Ordinal)
    {
        [MediaTabMedia] = ["image", "video"],
        [MediaTabFiles] = ["file"],
        [MediaTabAudio] = ["audio"],
    };

    private readonly Dictionary<string, MediaStreamState> _mediaStreams = new(StringComparer.Ordinal)
    {
        ["image"] = new(),
        ["video"] = new(),
        ["file"] = new(),
        ["audio"] = new(),
    };

    /// <summary>Загруженные плитки по kind — переиспользуются при возврате на вкладку.</summary>
    private readonly Dictionary<string, List<ChatMediaItemViewModel>> _mediaItemsByKind =
        new(StringComparer.Ordinal)
        {
            ["image"] = [],
            ["video"] = [],
            ["file"] = [],
            ["audio"] = [],
        };

    /// <summary>Защита от дублей: одно вложение не попадает в два kind-потока.</summary>
    private readonly HashSet<string> _mediaSeenIds = new(StringComparer.Ordinal);

    // Кэш превью ссылок: общий на все пузыри ленты — как _previewCache/_inflight в web.
    private const int LinkPreviewCacheMax = 300;
    private readonly Dictionary<string, Task<HubChatLinkPreview?>> _linkPreviewRequests = new(StringComparer.Ordinal);

    // «Печатает…»: исходящие кадры троттлим и помечаем целевой диалог,
    // входящий индикатор гасит маркер-таймер. Поля — только из UI-потока.
    private string? _typingSentToConversationId;
    private DateTime _lastTypingSentAt = DateTime.MinValue;
    private string? _typingText;
    private int _typingMarker;

    // Presence: последний известный статус по user_id (DTO + chat.presence.updated)
    // и текущий набор chat.watch_presence — оба живут только на UI-потоке.
    private readonly Dictionary<long, HubChatPresence> _presenceByUserId = [];
    private long[] _presenceWatchUserIds = [];

    private ConversationItemViewModel? _selectedConversation;
    private string _searchText = string.Empty;
    private string _composerText = string.Empty;
    private bool _isLoading;
    private bool _isLoadingMessages;
    private bool _isLoadingOlder;
    private bool _isSending;
    private bool _isUploading;
    private string? _uploadStatusText;
    private bool _hasOlder;
    private string? _bannerErrorText;
    private string _connectionStatusText = "офлайн";
    private string _connectionTone = HubStatusTone.Muted;

    public ChatViewModel(IHubApiClient api)
        : this(api, realtime: null)
    {
    }

    public ChatViewModel(IHubApiClient api, IHubChatRealtime? realtime)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);
        _syncContext = SynchronizationContext.Current;
        _injectedRealtime = realtime;
        _realtime = realtime;

        Messages.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsMessagesEmpty));

        SendCommand = new NativeAsyncCommand(
            (_, ct) => SendAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSend);
        AttachCommand = new NativeAsyncCommand(
            async (_, ct) =>
            {
                var paths = AttachmentPicker?.Invoke() ?? [];
                await AttachFilesAsync(paths, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanAttach);
        LoadOlderCommand = new NativeAsyncCommand(
            (_, ct) => LoadOlderAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasOlder && !IsLoadingOlder && HasConversation);
        RetryCommand = new NativeAsyncCommand(
            (_, ct) => LoadConversationsCoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        BeginReplyCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanReply: true } message)
            {
                EditingMessage = null;
                ReplyingTo = message;
            }
        });
        BeginEditCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanEditOrDelete: true } message)
            {
                ReplyingTo = null;
                EditingMessage = message;
                ComposerText = message.EditableBody ?? string.Empty;
            }
        });
        CancelComposerContextCommand = new NativeRelayCommand(ClearComposerContext);
        DeleteMessageCommand = new NativeAsyncCommand(
            async (parameter, cancellationToken) =>
            {
                if (parameter is ChatMessageViewModel { CanEditOrDelete: true } message
                    && _selectedConversation is { } conversation)
                {
                    var result = await _api.DeleteChatMessageAsync(
                        conversation.Id, message.Id, cancellationToken);
                    message.Update(result);
                }
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        CopyMessageTextCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { EditableBody.Length: > 0 } message)
            {
                System.Windows.Clipboard.SetText(message.EditableBody);
            }
        });
        LoadMoreConversationsCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreConversationsAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMoreConversations && !IsLoading && !IsLoadingMoreConversations);
        ToggleNewConversationCommand = new NativeRelayCommand(() =>
        {
            if (IsNewConversationOpen)
            {
                CloseNewConversation();
            }
            else
            {
                OpenNewConversation();
            }
        });
        PickUserCommand = new NativeAsyncCommand(
            (parameter, ct) =>
            {
                // В режиме «Новая группа» клик по пользователю — toggle его выбора.
                if (parameter is ChatUserItemViewModel user && IsNewGroupMode)
                {
                    ToggleGroupMemberSelection(user);
                    return Task.CompletedTask;
                }

                return CreateDirectConversationAsync(parameter as ChatUserItemViewModel, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ChatUserItemViewModel && !IsCreatingConversation);
        ToggleNewGroupModeCommand = new NativeRelayCommand(() => IsNewGroupMode = !IsNewGroupMode);
        CreateGroupCommand = new NativeAsyncCommand(
            (_, ct) => CreateGroupConversationAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanCreateGroup);
        SelectedGroupMembers.CollectionChanged += (_, _) =>
            (CreateGroupCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        ToggleMembersPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleMembersPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        CloseMembersPanelCommand = new NativeRelayCommand(CloseMembersPanel);
        ToggleMediaPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleMediaPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        CloseMediaPanelCommand = new NativeRelayCommand(CloseMediaPanel);
        SelectMediaTabCommand = new NativeAsyncCommand(
            (parameter, ct) => SelectMediaTabAsync(parameter, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreMediaCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreMediaAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMoreMedia && !IsLoadingMedia && !IsLoadingMoreMedia);
        PickMemberCandidateCommand = new NativeAsyncCommand(
            (parameter, ct) => AddGroupMemberCandidateAsync(parameter as ChatUserItemViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ChatUserItemViewModel
                && CanManageGroupMembers && !IsMemberActionBusy);
        MemberCandidateResults.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasMemberCandidates));
            OnPropertyChanged(nameof(MemberSearchHint));
        };
        ToggleMessageSearchCommand = new NativeRelayCommand(() =>
        {
            if (IsMessageSearchOpen)
            {
                CloseMessageSearch();
            }
            else
            {
                // Оверлеи ленты взаимоисключающие.
                CloseForwardPanel();
                CloseMembersPanel();
                CloseMediaPanel();
                IsMessageSearchOpen = true;
            }
        });
        PickSearchResultCommand = new NativeAsyncCommand(
            (parameter, ct) => JumpToMessageAsync(parameter as ChatMessageViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ChatMessageViewModel);
        ToggleGlobalSearchCommand = new NativeRelayCommand(() =>
        {
            if (IsGlobalSearchOpen)
            {
                CloseGlobalSearch();
            }
            else
            {
                CloseNewConversation();
                IsGlobalSearchOpen = true;
            }
        });
        PickGlobalSearchResultCommand = new NativeAsyncCommand(
            (parameter, ct) => JumpToGlobalHitAsync(parameter as HubChatGlobalSearchHit, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is HubChatGlobalSearchHit);
        BeginForwardCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanReply: true } message)
            {
                CloseMessageSearch();
                CloseMembersPanel();
                CloseMediaPanel();
                ForwardingMessage = message;
                IsForwardPanelOpen = true;
            }
        });
        PickForwardTargetCommand = new NativeAsyncCommand(
            (parameter, ct) => ForwardMessageToAsync(parameter as ConversationItemViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ConversationItemViewModel && !IsForwarding);
        CloseForwardPanelCommand = new NativeRelayCommand(CloseForwardPanel);
        ShowMessageReadersCommand = new NativeAsyncCommand(
            (parameter, ct) => ShowMessageReadersAsync(parameter as ChatMessageViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ChatMessageViewModel);
        CloseReadersPanelCommand = new NativeRelayCommand(() => IsReadersPanelOpen = false);
        OpenNotesCommand = new NativeAsyncCommand(
            (_, ct) => OpenNotesAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
    }

    /// <summary>Входящее чужое сообщение: слой окна решает, показывать ли toast.</summary>
    public event EventHandler<ChatMessageNotification>? NotificationRequested;

    // ---- Списки ----

    public ObservableCollection<ConversationItemViewModel> Conversations { get; } = [];

    /// <summary>
    /// Сумма непрочитанных в бейдже навигации. Как в web (buildFolderUnreadCounts):
    /// архивные и действующие mute не считаются.
    /// </summary>
    public int TotalUnreadCount => _allConversations
        .Where(c => !c.IsArchived && !c.IsEffectivelyMuted)
        .Sum(c => c.UnreadCount);

    public ObservableCollection<ChatMessageViewModel> Messages { get; } = [];

    public ConversationItemViewModel? SelectedConversation
    {
        get => _selectedConversation;
        set
        {
            if (!SetProperty(ref _selectedConversation, value))
            {
                return;
            }

            // Ручной выбор другого диалога отменяет ожидающий deep link.
            if (value is not null
                && !string.Equals(value.Id, _pendingConversationId, StringComparison.OrdinalIgnoreCase))
            {
                _pendingConversationId = null;
                _pendingAnchorMessageId = null;
            }

            // «Печатает…» привязан к диалогу: прежнему шлём stopped,
            // чужой входящий индикатор гасим вместе с таймером.
            StopTypingIfSent();
            ClearTypingIndicator();

            // Переключение диалога отменяет ответ/правку и поиск — цель из другой ленты.
            ClearComposerContext();
            CloseMessageSearch();
            CloseForwardPanel();
            IsReadersPanelOpen = false;
            CloseMembersPanel();
            CloseMediaPanel();
            ClearPinnedState();
            SelectedMessage = null;
            OnPropertyChanged(nameof(HasConversation));
            OnPropertyChanged(nameof(IsMessagesEmpty));
            RaiseCommandStates();
            // Room-подписка: события диалога (read-галочки, чужие реакции) идут
            // только подписчикам комнаты — смена выбора переключает подписку.
            _realtime?.WatchConversation(value?.Id);
            if (value is not null)
            {
                _ = LoadMessagesSafelyAsync(value);
            }
            else
            {
                _messagesLoadCancellation?.Cancel();
                Messages.Clear();
                HasOlder = false;
                _olderCursor = null;
            }
        }
    }

    public bool HasConversation => SelectedConversation is not null;

    /// <summary>
    /// Поиск по диалогам: мгновенный локальный фильтр + серверный поиск (q)
    /// по ещё не загруженным страницам с debounce; при ошибке — только локальный.
    /// </summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value))
            {
                RebuildVisibleConversations();
                ScheduleConversationSearch(value);
            }
        }
    }

    public string ComposerText
    {
        get => _composerText;
        set
        {
            if (SetProperty(ref _composerText, value))
            {
                RaiseCommandStates();
                NotifyTypingState();
            }
        }
    }

    /// <summary>Входящий «печатает…» для открытого диалога («Имя печатает…»).</summary>
    public string? TypingText
    {
        get => _typingText;
        private set
        {
            if (SetProperty(ref _typingText, value))
            {
                OnPropertyChanged(nameof(HasTypingText));
            }
        }
    }

    /// <summary>Индикатор набора текста виден.</summary>
    public bool HasTypingText => !string.IsNullOrEmpty(TypingText);

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

    public bool IsLoadingMessages
    {
        get => _isLoadingMessages;
        private set
        {
            if (SetProperty(ref _isLoadingMessages, value))
            {
                OnPropertyChanged(nameof(IsMessagesEmpty));
            }
        }
    }

    public bool IsLoadingOlder
    {
        get => _isLoadingOlder;
        private set
        {
            if (SetProperty(ref _isLoadingOlder, value))
            {
                RaiseCommandStates();
            }
        }
    }

    public bool IsSending
    {
        get => _isSending;
        private set
        {
            if (SetProperty(ref _isSending, value))
            {
                RaiseCommandStates();
            }
        }
    }

    /// <summary>По сообщениям текущего диалога есть более старая страница.</summary>
    public bool HasOlder
    {
        get => _hasOlder;
        private set
        {
            if (SetProperty(ref _hasOlder, value))
            {
                RaiseCommandStates();
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

    /// <summary>«Диалогов пока нет» — только после загрузки и без баннера ошибки.</summary>
    public bool IsEmpty => !IsLoading && Conversations.Count == 0 && !HasBannerError;

    /// <summary>Сервер вернул has_more — за первой страницей диалогов есть продолжение.</summary>
    public bool HasMoreConversations
    {
        get => _hasMoreConversations;
        private set
        {
            if (SetProperty(ref _hasMoreConversations, value))
            {
                RaiseCommandStates();
            }
        }
    }

    public bool IsLoadingMoreConversations
    {
        get => _isLoadingMoreConversations;
        private set
        {
            if (SetProperty(ref _isLoadingMoreConversations, value))
            {
                OnPropertyChanged(nameof(ConversationsMoreText));
                RaiseCommandStates();
            }
        }
    }

    /// <summary>Подпись кнопки догрузки диалогов (сервер не отдаёт общий счётчик).</summary>
    public string ConversationsMoreText =>
        IsLoadingMoreConversations ? "Загружаем…" : "Показать ещё";

    public bool IsMessagesEmpty => HasConversation && !IsLoadingMessages && Messages.Count == 0;

    public string ConnectionStatusText
    {
        get => _connectionStatusText;
        private set => SetProperty(ref _connectionStatusText, value);
    }

    /// <summary>Тон точки подключения (HubStatusTone.*) — кисть подбирает разметка по теме.</summary>
    public string ConnectionTone
    {
        get => _connectionTone;
        private set => SetProperty(ref _connectionTone, value);
    }

    /// <summary>Процесс загрузки вложений: повторные запуски блокируются флагом.</summary>
    public bool IsUploading
    {
        get => _isUploading;
        private set
        {
            if (SetProperty(ref _isUploading, value))
            {
                OnPropertyChanged(nameof(CanAttach));
                RaiseCommandStates();
            }
        }
    }

    /// <summary>Текст статуса загрузки в composer-зоне («Отправка файл.pdf — 45 %»).</summary>
    public string? UploadStatusText
    {
        get => _uploadStatusText;
        private set
        {
            if (SetProperty(ref _uploadStatusText, value))
            {
                OnPropertyChanged(nameof(HasUploadStatus));
            }
        }
    }

    public bool HasUploadStatus => !string.IsNullOrEmpty(UploadStatusText);

    /// <summary>Провайдер выбора файлов — подставляет view (OpenFileDialog); null в тестах.</summary>
    public Func<IReadOnlyList<string>>? AttachmentPicker { get; set; }

    /// <summary>Скачивание вложения в temp-папку и открытие системным обработчиком.</summary>
    public Func<HubChatAttachment, string?, Task>? AttachmentSaver { get; set; }

    /// <summary>
    /// Провайдер «куда сохранить экспорт» — подставляет view (SaveFileDialog
    /// с фильтром txt/json); null в тестах или отмена диалога → экспорт не идёт.
    /// </summary>
    public Func<ConversationItemViewModel, ChatExportTarget?>? ExportTargetPicker { get; set; }

    /// <summary>Открытие ссылки из карточки превью; null — Process.Start браузером ОС.</summary>
    public Func<string, Task>? LinkOpener { get; set; }

    public bool CanSend =>
        HasConversation && !IsSending && !IsUploading && !string.IsNullOrWhiteSpace(ComposerText);

    /// <summary>«Скрепка» доступна при открытом диалоге и без активной отправки/загрузки.</summary>
    public bool CanAttach => HasConversation && !IsSending && !IsUploading;

    public ICommand SendCommand { get; }

    /// <summary>Выбрать файлы и отправить сообщение с вложениями (upload-session).</summary>
    public ICommand AttachCommand { get; }

    public ICommand LoadOlderCommand { get; }

    public ICommand RetryCommand { get; }

    public ICommand LoadMoreConversationsCommand { get; }

    public ICommand RefreshConversationsCommand => RetryCommand;

    public ICommand DismissBannerCommand { get; }

    /// <summary>Ответить на сообщение — плашка контекста над composer.</summary>
    public ICommand BeginReplyCommand { get; }

    /// <summary>Править своё сообщение — composer превращается в «Сохранить».</summary>
    public ICommand BeginEditCommand { get; }

    /// <summary>Снять контекст ответа/правки (кнопка ✕ на плашке).</summary>
    public ICommand CancelComposerContextCommand { get; }

    /// <summary>Удалить своё сообщение (soft-delete → tombstone).</summary>
    public ICommand DeleteMessageCommand { get; }

    /// <summary>Скопировать текст сообщения в буфер обмена.</summary>
    public ICommand CopyMessageTextCommand { get; }

    // ---- Новый диалог ----

    /// <summary>Панель создания direct-диалога поверх списка диалогов.</summary>
    public bool IsNewConversationOpen
    {
        get => _isNewConversationOpen;
        private set
        {
            if (SetProperty(ref _isNewConversationOpen, value))
            {
                OnPropertyChanged(nameof(IsConversationListActive));
            }
        }
    }

    /// <summary>Список диалогов активен: ни «Новый диалог», ни глобальный поиск
    /// не открыты — Tab/клики не должны уходить под оверлей.</summary>
    public bool IsConversationListActive => !IsNewConversationOpen && !IsGlobalSearchOpen;

    private bool _showArchived;

    /// <summary>Фильтр «Архив»: список показывает только архивные диалоги.</summary>
    public bool ShowArchived
    {
        get => _showArchived;
        private set
        {
            if (SetProperty(ref _showArchived, value))
            {
                OnPropertyChanged(nameof(ArchiveToggleText));
                OnPropertyChanged(nameof(IsArchiveView));
                OnPropertyChanged(nameof(EmptyTitle));
                OnPropertyChanged(nameof(EmptyHint));
                RebuildVisibleConversations();
            }
        }
    }

    /// <summary>Активен вид «Архив» (для стиля переключателя в шапке списка).</summary>
    public bool IsArchiveView => ShowArchived;

    /// <summary>Подпись переключателя архива в шапке списка.</summary>
    public string ArchiveToggleText => ShowArchived ? "Архив · вкл" : "Архив";

    /// <summary>Заголовок пустого списка — зависит от вида (обычный/архив).</summary>
    public string EmptyTitle => ShowArchived ? "В архиве пусто" : "Диалогов пока нет";

    /// <summary>Подсказка под заголовком пустого списка.</summary>
    public string EmptyHint => ShowArchived
        ? "Перенесённые в архив диалоги появятся здесь."
        : "Когда вам напишут, диалог появится здесь.";

    private ICommand? _toggleArchivedViewCommand;

    /// <summary>Переключить вид списка: обычные ↔ архивные.</summary>
    public ICommand ToggleArchivedViewCommand => _toggleArchivedViewCommand ??=
        new NativeRelayCommand(() =>
        {
            ShowArchived = !ShowArchived;
            // Пустой поиск в архиве остаётся локальным; текст очищаем, чтобы
            // не смешивать серверные результаты с фильтром архива.
            if (!string.IsNullOrEmpty(SearchText))
            {
                SearchText = string.Empty;
            }
        });

    /// <summary>Строка поиска пользователей — изменение запускает debounce-запрос к API.</summary>
    public string NewConversationSearchText
    {
        get => _newConversationSearchText;
        set
        {
            if (SetProperty(ref _newConversationSearchText, value))
            {
                ScheduleUserSearch(immediate: false);
            }
        }
    }

    public ObservableCollection<ChatUserItemViewModel> FoundUsers { get; } = [];

    public bool IsSearchingUsers
    {
        get => _isSearchingUsers;
        private set
        {
            if (SetProperty(ref _isSearchingUsers, value))
            {
                OnPropertyChanged(nameof(IsUserSearchEmpty));
            }
        }
    }

    /// <summary>«Никого не найдено» — панель открыта, поиск завершён и пуст.</summary>
    public bool IsUserSearchEmpty =>
        IsNewConversationOpen && !IsSearchingUsers && FoundUsers.Count == 0;

    /// <summary>Сообщение, на которое отвечаем, — плашка над composer.</summary>
    public ChatMessageViewModel? ReplyingTo
    {
        get => _replyingTo;
        private set
        {
            if (SetProperty(ref _replyingTo, value))
            {
                RaiseComposerContextChanged();
            }
        }
    }

    /// <summary>Сообщение в правке — composer работает как «Сохранить».</summary>
    public ChatMessageViewModel? EditingMessage
    {
        get => _editingMessage;
        private set
        {
            if (SetProperty(ref _editingMessage, value))
            {
                RaiseComposerContextChanged();
            }
        }
    }

    /// <summary>Плашка контекста видна (ответ или правка).</summary>
    public bool HasComposerContext => ReplyingTo is not null || EditingMessage is not null;

    /// <summary>Заголовок плашки: «Изменение сообщения» или «Ответ».</summary>
    public string ComposerContextTitle =>
        EditingMessage is not null ? "Изменение сообщения" : "Ответ";

    /// <summary>Текст плашки — «Кому: начало сообщения».</summary>
    public string? ComposerContextText =>
        EditingMessage is not null
            ? EditingMessage.ReplySummaryText
            : ReplyingTo?.ReplySummaryText;

    /// <summary>Подпись кнопки отправки.</summary>
    public string SendButtonText => EditingMessage is not null ? "Сохранить" : "Отправить";

    private void RaiseComposerContextChanged()
    {
        OnPropertyChanged(nameof(HasComposerContext));
        OnPropertyChanged(nameof(ComposerContextTitle));
        OnPropertyChanged(nameof(ComposerContextText));
        OnPropertyChanged(nameof(SendButtonText));
    }

    private void ClearComposerContext()
    {
        var wasEditing = EditingMessage is not null;
        ReplyingTo = null;
        EditingMessage = null;
        if (wasEditing)
        {
            ComposerText = string.Empty;
        }
    }

    /// <summary>Toggle реакции по сообщению через API; результат применяем к пузырю.</summary>
    private async Task ToggleReactionAsync(ChatMessageViewModel message, string emoji)
    {
        if (_selectedConversation is not { } conversation || string.IsNullOrEmpty(message.Id))
        {
            return;
        }

        try
        {
            var result = await _api.ToggleChatMessageReactionAsync(
                conversation.Id, message.Id, emoji, CancellationToken.None);
            RunOnUi(() => message.ApplyReactions(result.Reactions));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Идёт создание диалога — команда выбора пользователя блокируется.</summary>
    public bool IsCreatingConversation
    {
        get => _isCreatingConversation;
        private set
        {
            if (SetProperty(ref _isCreatingConversation, value))
            {
                (PickUserCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
                (CreateGroupCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    public ICommand ToggleNewConversationCommand { get; }

    public ICommand PickUserCommand { get; }

    // ---- Режим «Новая группа» в панели создания ----

    /// <summary>Чипы выбранных участников в режиме «Новая группа».</summary>
    public ObservableCollection<ChatUserItemViewModel> SelectedGroupMembers { get; } = [];

    /// <summary>Панель создания в режиме группы: название + мультивыбор + «Создать».</summary>
    public bool IsNewGroupMode
    {
        get => _isNewGroupMode;
        set
        {
            if (SetProperty(ref _isNewGroupMode, value))
            {
                OnPropertyChanged(nameof(NewConversationTitleText));
                OnPropertyChanged(nameof(NewConversationModeToggleText));
                if (!value)
                {
                    ClearGroupMemberSelection();
                }

                (CreateGroupCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Заголовок панели создания: «Новый диалог» / «Новая группа».</summary>
    public string NewConversationTitleText => IsNewGroupMode ? "Новая группа" : "Новый диалог";

    /// <summary>Подпись переключателя режима в шапке панели.</summary>
    public string NewConversationModeToggleText => IsNewGroupMode ? "Личный" : "Группа";

    /// <summary>Название создаваемой группы — POST /chat/conversations/group {title}.</summary>
    public string NewGroupTitle
    {
        get => _newGroupTitle;
        set
        {
            if (SetProperty(ref _newGroupTitle, value))
            {
                (CreateGroupCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>
    /// «Создать» активна в режиме группы: непустое название + минимум 1 участник
    /// (backend требует ≥1 участника помимо создателя — тот добавляется сам).
    /// </summary>
    public bool CanCreateGroup =>
        IsNewGroupMode && !IsCreatingConversation
        && !string.IsNullOrWhiteSpace(NewGroupTitle) && SelectedGroupMembers.Count > 0;

    public ICommand ToggleNewGroupModeCommand { get; }

    public ICommand CreateGroupCommand { get; }

    public ICommand ToggleMessageSearchCommand { get; }

    public ICommand PickSearchResultCommand { get; }

    // ---- Поиск по сообщениям диалога ----

    /// <summary>Результаты серверного поиска по сообщениям выбранного диалога.</summary>
    public ObservableCollection<ChatMessageViewModel> SearchResults { get; } = [];

    /// <summary>Панель поиска по сообщениям открыта.</summary>
    public bool IsMessageSearchOpen
    {
        get => _isMessageSearchOpen;
        private set
        {
            if (SetProperty(ref _isMessageSearchOpen, value))
            {
                OnPropertyChanged(nameof(MessageSearchHint));
            }
        }
    }

    /// <summary>Запрос поиска по сообщениям — debounce → сервер.</summary>
    public string MessageSearchText
    {
        get => _messageSearchText;
        set
        {
            if (SetProperty(ref _messageSearchText, value))
            {
                OnPropertyChanged(nameof(MessageSearchHint));
                ScheduleMessageSearch();
            }
        }
    }

    /// <summary>Идёт серверный поиск по сообщениям.</summary>
    public bool IsSearchingMessages
    {
        get => _isSearchingMessages;
        private set
        {
            if (SetProperty(ref _isSearchingMessages, value))
            {
                OnPropertyChanged(nameof(MessageSearchHint));
            }
        }
    }

    /// <summary>Подсказка панели поиска: «Поиск…»/«Ничего не найдено»/пусто.</summary>
    public string? MessageSearchHint
    {
        get
        {
            if (!IsMessageSearchOpen)
            {
                return null;
            }

            if (IsSearchingMessages)
            {
                return "Поиск…";
            }

            var query = _messageSearchText.Trim();
            return query.Length == 0
                ? "Поиск по сообщениям"
                : SearchResults.Count == 0 ? "Ничего не найдено" : null;
        }
    }

    /// <summary>Выделенное в ленте сообщение — переход к результату поиска.</summary>
    public ChatMessageViewModel? SelectedMessage
    {
        get => _selectedMessage;
        set => SetProperty(ref _selectedMessage, value);
    }

    private void CloseMessageSearch()
    {
        _messageSearchCancellation?.Cancel();
        IsMessageSearchOpen = false;
        SearchResults.Clear();
        _messageSearchText = string.Empty;
        OnPropertyChanged(nameof(MessageSearchText));
        OnPropertyChanged(nameof(MessageSearchHint));
        IsSearchingMessages = false;
    }

    // ---- Опросы ----

    /// <summary>Голос/снятие голоса в опросе; ответ — агрегированное состояние опроса.</summary>
    private async Task VotePollAsync(ChatMessageViewModel message, int optionIndex)
    {
        var conversationId = message.ConversationId ?? _selectedConversation?.Id;
        if (string.IsNullOrEmpty(conversationId) || string.IsNullOrEmpty(message.Id))
        {
            return;
        }

        try
        {
            var result = await _api.VoteChatPollAsync(
                conversationId, message.Id, optionIndex, CancellationToken.None);
            RunOnUi(() => message.ApplyPoll(result.Poll));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Автор завершает опрос; ответ — то же агрегированное состояние.</summary>
    private async Task ClosePollAsync(ChatMessageViewModel message)
    {
        var conversationId = message.ConversationId ?? _selectedConversation?.Id;
        if (string.IsNullOrEmpty(conversationId) || string.IsNullOrEmpty(message.Id))
        {
            return;
        }

        try
        {
            var result = await _api.CloseChatPollAsync(
                conversationId, message.Id, CancellationToken.None);
            RunOnUi(() => message.ApplyPoll(result.Poll));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>
    /// kind="poll" хранит канонический JSON в body — текстом его показывать нельзя;
    /// вопрос берём из poll-payload или из самого JSON, как web (resolveChatMessagePoll).
    /// </summary>
    private static HubChatMessage NormalizePollBody(HubChatMessage message)
    {
        if (!string.Equals(message.Kind, "poll", StringComparison.Ordinal))
        {
            return message;
        }

        var question = message.Poll?.Question;
        if (string.IsNullOrWhiteSpace(question))
        {
            question = TryExtractPollQuestion(message.Body);
        }

        return string.IsNullOrWhiteSpace(question) ? message : message with { Body = question };
    }

    /// <summary>Вопрос из JSON-тела опроса — fallback при отсутствии poll-payload.</summary>
    private static string? TryExtractPollQuestion(string? body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return null;
        }

        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement is { ValueKind: JsonValueKind.Object } root
                && root.TryGetProperty("question", out var node)
                && node.ValueKind == JsonValueKind.String
                    ? node.GetString()
                    : null;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>poll из payload chat.message.updated — приходит у kind="poll" после голоса/закрытия.</summary>
    private static HubChatPoll? TryGetPoll(JsonElement element)
    {
        if (!element.TryGetProperty("poll", out var node) || node.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<HubChatPoll>(node.GetRawText(), JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ---- Пересылка ----

    /// <summary>Панель выбора целевого диалога для пересылки поверх ленты.</summary>
    public bool IsForwardPanelOpen
    {
        get => _isForwardPanelOpen;
        private set => SetProperty(ref _isForwardPanelOpen, value);
    }

    /// <summary>Сообщение-кандидат на пересылку — подпись в шапке панели.</summary>
    public ChatMessageViewModel? ForwardingMessage
    {
        get => _forwardingMessage;
        private set => SetProperty(ref _forwardingMessage, value);
    }

    /// <summary>Идёт пересылка — клики по целевому списку блокируются.</summary>
    public bool IsForwarding
    {
        get => _isForwarding;
        private set
        {
            if (SetProperty(ref _isForwarding, value))
            {
                (PickForwardTargetCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Меню пузыря «Переслать» — открывает панель выбора диалога.</summary>
    public ICommand BeginForwardCommand { get; }

    /// <summary>Выбор целевого диалога в панели пересылки.</summary>
    public ICommand PickForwardTargetCommand { get; }

    /// <summary>Крестик панели пересылки.</summary>
    public ICommand CloseForwardPanelCommand { get; }

    /// <summary>
    /// Пересылка в выбранный диалог: client_message_id генерируется как при отправке —
    /// realtime-эхо дедупится по нему. После успеха — переход в целевой диалог (как web).
    /// </summary>
    private async Task ForwardMessageToAsync(
        ConversationItemViewModel? target,
        CancellationToken cancellationToken)
    {
        var message = _forwardingMessage;
        if (target is null
            || message is null
            || string.IsNullOrEmpty(message.Id)
            || IsForwarding)
        {
            return;
        }

        IsForwarding = true;
        try
        {
            var forwarded = await _api.ForwardChatMessageAsync(
                target.Id,
                message.Id,
                body: null,
                clientMessageId: Guid.NewGuid().ToString("N"),
                replyToMessageId: null,
                cancellationToken);
            CloseForwardPanel();
            target.UpdateLastMessage(NormalizePollBody(forwarded));
            RebuildVisibleConversations();
            if (ReferenceEquals(_selectedConversation, target))
            {
                InsertMessage(forwarded, target.IsGroupLike);
            }
            else
            {
                SelectedConversation = target;
            }

            BannerErrorText = null;
        }
        finally
        {
            IsForwarding = false;
        }
    }

    private void CloseForwardPanel()
    {
        IsForwardPanelOpen = false;
        ForwardingMessage = null;
    }

    // ---- Глобальный поиск по сообщениям ----

    /// <summary>Результаты поиска по всем диалогам (заголовок, отправитель, превью).</summary>
    public ObservableCollection<HubChatGlobalSearchHit> GlobalSearchResults { get; } = [];

    /// <summary>Панель глобального поиска поверх списка диалогов.</summary>
    public bool IsGlobalSearchOpen
    {
        get => _isGlobalSearchOpen;
        private set
        {
            if (SetProperty(ref _isGlobalSearchOpen, value))
            {
                OnPropertyChanged(nameof(IsConversationListActive));
                OnPropertyChanged(nameof(GlobalSearchHint));
            }
        }
    }

    /// <summary>Запрос глобального поиска — debounce → сервер.</summary>
    public string GlobalSearchText
    {
        get => _globalSearchText;
        set
        {
            if (SetProperty(ref _globalSearchText, value))
            {
                OnPropertyChanged(nameof(GlobalSearchHint));
                ScheduleGlobalSearch();
            }
        }
    }

    /// <summary>Идёт серверный глобальный поиск.</summary>
    public bool IsSearchingGlobal
    {
        get => _isSearchingGlobal;
        private set
        {
            if (SetProperty(ref _isSearchingGlobal, value))
            {
                OnPropertyChanged(nameof(GlobalSearchHint));
            }
        }
    }

    /// <summary>Подсказка панели: «Поиск…»/«Ничего не найдено»/пусто.</summary>
    public string? GlobalSearchHint
    {
        get
        {
            if (!IsGlobalSearchOpen)
            {
                return null;
            }

            if (IsSearchingGlobal)
            {
                return "Поиск…";
            }

            var query = _globalSearchText.Trim();
            return query.Length == 0
                ? "Поиск по сообщениям во всех чатах"
                : GlobalSearchResults.Count == 0 ? "Ничего не найдено" : null;
        }
    }

    /// <summary>Кнопка 🔎 в шапке списка диалогов.</summary>
    public ICommand ToggleGlobalSearchCommand { get; }

    /// <summary>Клик по результату — переход в диалог к найденному сообщению.</summary>
    public ICommand PickGlobalSearchResultCommand { get; }

    /// <summary>Debounce 350 мс: серверный поиск по сообщениям всех диалогов.</summary>
    private void ScheduleGlobalSearch()
    {
        _globalSearchCancellation?.Cancel();
        _globalSearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _globalSearchCancellation = cancellation;
        var query = _globalSearchText.Trim();
        _ = SearchGlobalSafelyAsync(query, cancellation.Token);
    }

    private async Task SearchGlobalSafelyAsync(string query, CancellationToken cancellationToken)
    {
        if (query.Length < 2)
        {
            RunOnUi(() =>
            {
                GlobalSearchResults.Clear();
                OnPropertyChanged(nameof(GlobalSearchHint));
                IsSearchingGlobal = false;
            });
            return;
        }

        RunOnUi(() => IsSearchingGlobal = true);
        try
        {
            await Task.Delay(UserSearchDebounce, cancellationToken);
            var result = await _api.SearchChatGlobalMessagesAsync(query, 20, cancellationToken);
            RunOnUi(() =>
            {
                // Запрос уже сменился — результат устарел.
                if (!string.Equals(_globalSearchText.Trim(), query, StringComparison.Ordinal))
                {
                    return;
                }

                GlobalSearchResults.Clear();
                foreach (var hit in result.Items ?? [])
                {
                    GlobalSearchResults.Add(hit);
                }

                OnPropertyChanged(nameof(GlobalSearchHint));
                IsSearchingGlobal = false;
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                IsSearchingGlobal = false;
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
    }

    /// <summary>Переход к результату: выбор диалога + thread-bootstrap вокруг якоря.</summary>
    private async Task JumpToGlobalHitAsync(
        HubChatGlobalSearchHit? hit,
        CancellationToken cancellationToken)
    {
        if (hit is null || string.IsNullOrEmpty(hit.ConversationId) || string.IsNullOrEmpty(hit.MessageId))
        {
            return;
        }

        var item = FindConversation(hit.ConversationId);
        if (item is null)
        {
            // Диалог вне загруженных страниц: выберем после догрузки списка,
            // якорь запомним до перехода.
            _pendingAnchorMessageId = hit.MessageId;
            await SelectConversationByIdAsync(hit.ConversationId, cancellationToken);
            await LoadConversationsCoreAsync(cancellationToken);
            return;
        }

        // Иначе цель может остаться скрытой активным фильтром/архивным видом.
        if (item.IsArchived != ShowArchived)
        {
            ShowArchived = item.IsArchived;
        }

        if (!string.IsNullOrEmpty(_searchText))
        {
            SearchText = string.Empty;
        }

        SelectedConversation = item;
        await JumpToAnchorAsync(item, hit.MessageId, closeSearch: false, cancellationToken);
    }

    private void CloseGlobalSearch()
    {
        _globalSearchCancellation?.Cancel();
        IsGlobalSearchOpen = false;
        GlobalSearchResults.Clear();
        _globalSearchText = string.Empty;
        OnPropertyChanged(nameof(GlobalSearchText));
        OnPropertyChanged(nameof(GlobalSearchHint));
        IsSearchingGlobal = false;
    }

    // ---- «Кто прочитал» ----

    /// <summary>Прочитавшие выбранное сообщение (имя + время прочтения).</summary>
    public ObservableCollection<ChatReadReceiptItemViewModel> MessageReaders { get; } = [];

    /// <summary>Панель «Кто прочитал» поверх ленты.</summary>
    public bool IsReadersPanelOpen
    {
        get => _isReadersPanelOpen;
        private set => SetProperty(ref _isReadersPanelOpen, value);
    }

    /// <summary>Заголовок панели: «Прочитали: N».</summary>
    public string? ReadersTitleText
    {
        get => _readersTitleText;
        private set => SetProperty(ref _readersTitleText, value);
    }

    /// <summary>Идёт загрузка списка прочитавших.</summary>
    public bool IsLoadingReaders
    {
        get => _isLoadingReaders;
        private set => SetProperty(ref _isLoadingReaders, value);
    }

    /// <summary>Меню пузыря «Кто прочитал» (свои прочитанные сообщения).</summary>
    public ICommand ShowMessageReadersCommand { get; }

    /// <summary>Крестик панели «Кто прочитал».</summary>
    public ICommand CloseReadersPanelCommand { get; }

    private async Task ShowMessageReadersAsync(
        ChatMessageViewModel? message,
        CancellationToken cancellationToken)
    {
        if (message is null || string.IsNullOrEmpty(message.Id))
        {
            return;
        }

        CloseMembersPanel();
        CloseMediaPanel();
        IsReadersPanelOpen = true;
        ReadersTitleText = "Прочитали";
        MessageReaders.Clear();
        IsLoadingReaders = true;
        try
        {
            var reads = await _api.GetChatMessageReadsAsync(message.Id, cancellationToken);
            RunOnUi(() =>
            {
                MessageReaders.Clear();
                foreach (var receipt in reads.Items ?? [])
                {
                    MessageReaders.Add(new ChatReadReceiptItemViewModel(receipt));
                }

                ReadersTitleText = MessageReaders.Count == 0
                    ? "Пока никто не прочитал"
                    : $"Прочитали: {MessageReaders.Count}";
                IsLoadingReaders = false;
            });
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            RunOnUi(() =>
            {
                IsLoadingReaders = false;
                IsReadersPanelOpen = false;
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
    }

    // ---- Панель «Участники» (групповые диалоги) ----

    /// <summary>Участники открытого группового диалога.</summary>
    public ObservableCollection<ChatGroupMemberItemViewModel> GroupMembers { get; } = [];

    /// <summary>Кандидаты на добавление — результат поиска внутри панели.</summary>
    public ObservableCollection<ChatUserItemViewModel> MemberCandidateResults { get; } = [];

    /// <summary>Панель участников поверх ленты.</summary>
    public bool IsMembersPanelOpen
    {
        get => _isMembersPanelOpen;
        private set => SetProperty(ref _isMembersPanelOpen, value);
    }

    /// <summary>Заголовок панели: «Участники: N».</summary>
    public string? MembersTitleText
    {
        get => _membersTitleText;
        private set => SetProperty(ref _membersTitleText, value);
    }

    /// <summary>Идёт загрузка списка участников.</summary>
    public bool IsLoadingMembers
    {
        get => _isLoadingMembers;
        private set => SetProperty(ref _isLoadingMembers, value);
    }

    /// <summary>
    /// Вижу управление (поиск + кнопки ✕): viewer — owner/moderator и kind="group".
    /// Финальную проверку всё равно делает backend.
    /// </summary>
    public bool CanManageGroupMembers
    {
        get => _canManageGroupMembers;
        private set
        {
            if (SetProperty(ref _canManageGroupMembers, value))
            {
                (PickMemberCandidateCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Идёт add/remove участника — повторные действия блокируем.</summary>
    public bool IsMemberActionBusy
    {
        get => _isMemberActionBusy;
        private set
        {
            if (SetProperty(ref _isMemberActionBusy, value))
            {
                (PickMemberCandidateCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Строка поиска кандидатов — debounce-запрос к GetChatUsersAsync.</summary>
    public string MemberSearchText
    {
        get => _memberSearchText;
        set
        {
            if (SetProperty(ref _memberSearchText, value))
            {
                OnPropertyChanged(nameof(MemberSearchHint));
                ScheduleMemberCandidateSearch();
            }
        }
    }

    /// <summary>Идёт поиск кандидатов.</summary>
    public bool IsSearchingMemberCandidates
    {
        get => _isSearchingMemberCandidates;
        private set
        {
            if (SetProperty(ref _isSearchingMemberCandidates, value))
            {
                OnPropertyChanged(nameof(MemberSearchHint));
            }
        }
    }

    /// <summary>Есть кандидаты — показываем их список под полем поиска.</summary>
    public bool HasMemberCandidates => MemberCandidateResults.Count > 0;

    /// <summary>Подсказка в панели: «Поиск…» / «Никого не найдено».</summary>
    public string? MemberSearchHint
    {
        get
        {
            if (!IsMembersPanelOpen || !CanManageGroupMembers)
            {
                return null;
            }

            if (IsSearchingMemberCandidates)
            {
                return "Поиск…";
            }

            return _memberSearchText.Trim().Length >= 2 && MemberCandidateResults.Count == 0
                ? "Никого не найдено"
                : null;
        }
    }

    /// <summary>Кнопка 👥 в шапке диалога — открыть/закрыть панель участников.</summary>
    public ICommand ToggleMembersPanelCommand { get; }

    /// <summary>Крестик панели участников.</summary>
    public ICommand CloseMembersPanelCommand { get; }

    /// <summary>Выбор кандидата → POST members.</summary>
    public ICommand PickMemberCandidateCommand { get; }

    private async Task ToggleMembersPanelAsync(CancellationToken cancellationToken)
    {
        if (IsMembersPanelOpen)
        {
            CloseMembersPanel();
            return;
        }

        if (_selectedConversation is not { IsGroupLike: true } conversation)
        {
            return;
        }

        // Оверлеи ленты взаимоисключающие.
        CloseForwardPanel();
        CloseMessageSearch();
        IsReadersPanelOpen = false;
        CloseMediaPanel();
        _membersPanelConversation = conversation;
        IsMembersPanelOpen = true;
        MembersTitleText = "Участники";
        GroupMembers.Clear();
        MemberCandidateResults.Clear();
        CanManageGroupMembers = false;
        IsLoadingMembers = true;
        try
        {
            var detail = await _api.GetChatConversationMembersAsync(
                conversation.Id, cancellationToken);
            if (!ReferenceEquals(_membersPanelConversation, conversation) || !IsMembersPanelOpen)
            {
                return;
            }

            // За время запроса состав мог измениться — применяем свежий detail и к строке списка.
            conversation.Update(detail);
            RebuildVisibleConversations();
            ApplyGroupMembers(detail);
        }
        finally
        {
            IsLoadingMembers = false;
        }
    }

    /// <summary>
    /// Раскладка detail-ответа по строкам участников. Правило кнопки ✕ — как в web
    /// (ChatContextPanel): owner исключает любого не-owner'а, moderator — только
    /// member'ов, себя исключить нельзя (для выхода — пункт меню диалога).
    /// </summary>
    private void ApplyGroupMembers(HubChatConversationDetail detail)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null)
        {
            return;
        }

        var selfId = _api.CurrentSession?.UserId;
        var viewerRole = NormalizeGroupMemberRole(
            detail.ViewerMemberRole ?? conversation.ViewerMemberRole);
        CanManageGroupMembers = string.Equals(conversation.Kind, "group", StringComparison.Ordinal)
            && viewerRole is "owner" or "moderator";
        GroupMembers.Clear();
        foreach (var member in detail.Members ?? [])
        {
            var memberUserId = member.User?.Id ?? 0;
            var memberRole = NormalizeGroupMemberRole(member.MemberRole);
            var canRemove = CanManageGroupMembers
                && memberUserId > 0
                && selfId != memberUserId
                && memberRole != "owner"
                && (viewerRole == "owner" || memberRole == "member");
            // «Сделать владельцем» — как canTransferSelectedOwnership в web:
            // только owner и только чужая строка (владелец один — сам viewer).
            var canTransferOwnership = viewerRole == "owner"
                && memberUserId > 0
                && selfId != memberUserId
                && memberRole != "owner";
            GroupMembers.Add(new ChatGroupMemberItemViewModel(
                member, canRemove, RemoveGroupMemberAsync,
                canTransferOwnership, TransferGroupOwnershipAsync));
        }

        MembersTitleText = $"Участники: {GroupMembers.Count}";
    }

    private static string NormalizeGroupMemberRole(string? role) =>
        string.IsNullOrWhiteSpace(role) ? "member" : role.Trim().ToLowerInvariant();

    /// <summary>Исключение участника (DELETE members/{id}); ответ — свежий detail.</summary>
    private async Task RemoveGroupMemberAsync(ChatGroupMemberItemViewModel member)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || member.UserId <= 0 || !member.CanRemove || IsMemberActionBusy)
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.RemoveChatConversationMemberAsync(
                conversation.Id, member.UserId, CancellationToken.None);
            RunOnUi(() =>
            {
                if (!ReferenceEquals(_membersPanelConversation, conversation))
                {
                    return;
                }

                conversation.Update(detail);
                RebuildVisibleConversations();
                ApplyGroupMembers(detail);
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            IsMemberActionBusy = false;
        }
    }

    /// <summary>
    /// Передача владения (POST ownership); ответ — свежий detail, у бывшего
    /// владельца viewer_member_role становится moderator → появляется «Покинуть».
    /// </summary>
    private async Task TransferGroupOwnershipAsync(ChatGroupMemberItemViewModel member)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || member.UserId <= 0 || !member.CanTransferOwnership || IsMemberActionBusy)
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.TransferChatConversationOwnershipAsync(
                conversation.Id, member.UserId, CancellationToken.None);
            RunOnUi(() =>
            {
                if (!ReferenceEquals(_membersPanelConversation, conversation))
                {
                    return;
                }

                conversation.Update(detail);
                RebuildVisibleConversations();
                ApplyGroupMembers(detail);
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            IsMemberActionBusy = false;
        }
    }

    /// <summary>Добавление кандидата (POST members); ответ — свежий detail.</summary>
    private async Task AddGroupMemberCandidateAsync(
        ChatUserItemViewModel? candidate,
        CancellationToken cancellationToken)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || candidate is null || !CanManageGroupMembers || IsMemberActionBusy)
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.AddChatConversationMemberAsync(
                conversation.Id, candidate.Id, cancellationToken);
            if (!ReferenceEquals(_membersPanelConversation, conversation))
            {
                return;
            }

            conversation.Update(detail);
            RebuildVisibleConversations();
            ApplyGroupMembers(detail);
            // Добавленного убираем из кандидатов; пустой результат — чистим строку поиска.
            MemberCandidateResults.Remove(candidate);
            if (MemberCandidateResults.Count == 0)
            {
                MemberSearchText = string.Empty;
            }
            else
            {
                OnPropertyChanged(nameof(MemberSearchHint));
            }
        }
        finally
        {
            IsMemberActionBusy = false;
        }
    }

    private void ScheduleMemberCandidateSearch()
    {
        _memberSearchCancellation?.Cancel();
        if (!IsMembersPanelOpen || !CanManageGroupMembers)
        {
            return;
        }

        var cancellation = _memberSearchCancellation = new CancellationTokenSource();
        _ = SearchMemberCandidatesSafelyAsync(_memberSearchText.Trim(), cancellation.Token);
    }

    /// <summary>Debounce-поиск кандидатов; уже состоящих в группе отфильтровываем.</summary>
    private async Task SearchMemberCandidatesSafelyAsync(
        string query,
        CancellationToken cancellationToken)
    {
        if (query.Length < 2)
        {
            RunOnUi(() =>
            {
                MemberCandidateResults.Clear();
                IsSearchingMemberCandidates = false;
                OnPropertyChanged(nameof(MemberSearchHint));
            });
            return;
        }

        RunOnUi(() => IsSearchingMemberCandidates = true);
        try
        {
            await Task.Delay(UserSearchDebounce, cancellationToken);
            var result = await _api.GetChatUsersAsync(query, ChatUsersPageLimit, cancellationToken);
            RunOnUi(() =>
            {
                if (!string.Equals(_memberSearchText.Trim(), query, StringComparison.Ordinal)
                    || _membersPanelConversation is null)
                {
                    return;
                }

                var existingIds = new HashSet<int>(
                    GroupMembers.Select(member => member.UserId));
                MemberCandidateResults.Clear();
                foreach (var user in result.Items ?? [])
                {
                    if (!existingIds.Contains(user.Id))
                    {
                        MemberCandidateResults.Add(new ChatUserItemViewModel(user));
                    }
                }

                IsSearchingMemberCandidates = false;
                OnPropertyChanged(nameof(MemberSearchHint));
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                IsSearchingMemberCandidates = false;
                OnPropertyChanged(nameof(MemberSearchHint));
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
    }

    private void CloseMembersPanel()
    {
        _memberSearchCancellation?.Cancel();
        IsMembersPanelOpen = false;
        _membersPanelConversation = null;
        GroupMembers.Clear();
        MemberCandidateResults.Clear();
        _memberSearchText = string.Empty;
        OnPropertyChanged(nameof(MemberSearchText));
        OnPropertyChanged(nameof(MemberSearchHint));
        IsSearchingMemberCandidates = false;
        IsLoadingMembers = false;
        CanManageGroupMembers = false;
        IsMemberActionBusy = false;
        MembersTitleText = null;
    }

    // ---- Медиагалерея диалога ----

    /// <summary>Плитки галереи: image+video вложения диалога, свежие сверху.</summary>
    public ObservableCollection<ChatMediaItemViewModel> MediaItems { get; } = [];

    /// <summary>Панель «Медиа» поверх ленты.</summary>
    public bool IsMediaPanelOpen
    {
        get => _isMediaPanelOpen;
        private set => SetProperty(ref _isMediaPanelOpen, value);
    }

    /// <summary>Идёт первая загрузка галереи.</summary>
    public bool IsLoadingMedia
    {
        get => _isLoadingMedia;
        private set
        {
            if (SetProperty(ref _isLoadingMedia, value))
            {
                RaiseMediaStates();
            }
        }
    }

    /// <summary>Идёт догрузка страницы «Показать ещё».</summary>
    public bool IsLoadingMoreMedia
    {
        get => _isLoadingMoreMedia;
        private set
        {
            if (SetProperty(ref _isLoadingMoreMedia, value))
            {
                RaiseMediaStates();
            }
        }
    }

    /// <summary>Есть следующая страница хотя бы в одном потоке активной вкладки.</summary>
    public bool HasMoreMedia => CurrentMediaKinds.Any(kind => _mediaStreams[kind].HasMore);

    /// <summary>Подсказка пустой вкладки: скрыта во время первой загрузки.</summary>
    public string? MediaEmptyText =>
        IsMediaPanelOpen && !IsLoadingMedia && MediaItems.Count == 0
            ? _selectedMediaTab switch
            {
                MediaTabFiles => "Нет файлов",
                MediaTabAudio => "Нет аудио",
                _ => "Нет медиа",
            }
            : null;

    /// <summary>Активная вкладка галереи: media|file|audio (переключатель в шапке панели).</summary>
    public string SelectedMediaTab
    {
        get => _selectedMediaTab;
        private set
        {
            if (SetProperty(ref _selectedMediaTab, value))
            {
                OnPropertyChanged(nameof(IsMediaTabSelected));
                OnPropertyChanged(nameof(IsFilesTabSelected));
                OnPropertyChanged(nameof(IsAudioTabSelected));
                RaiseMediaStates();
            }
        }
    }

    /// <summary>IsChecked вкладок галереи: media = image+video.</summary>
    public bool IsMediaTabSelected => SelectedMediaTab == MediaTabMedia;

    /// <summary>IsChecked вкладки «Файлы».</summary>
    public bool IsFilesTabSelected => SelectedMediaTab == MediaTabFiles;

    /// <summary>IsChecked вкладки «Аудио».</summary>
    public bool IsAudioTabSelected => SelectedMediaTab == MediaTabAudio;

    /// <summary>Кнопка 🖼 в шапке диалога — открыть/закрыть галерею.</summary>
    public ICommand ToggleMediaPanelCommand { get; }

    /// <summary>Крестик панели «Медиа».</summary>
    public ICommand CloseMediaPanelCommand { get; }

    /// <summary>Переключатель вкладок «Медиа/Файлы/Аудио» — CommandParameter = tab.</summary>
    public ICommand SelectMediaTabCommand { get; }

    /// <summary>«Показать ещё» — следующая страница по курсору before_attachment_id.</summary>
    public ICommand LoadMoreMediaCommand { get; }

    /// <summary>kind-потоки активной вкладки: media → image+video, остальные — один.</summary>
    private IReadOnlyList<string> CurrentMediaKinds =>
        MediaTabKindsMap.TryGetValue(_selectedMediaTab, out var kinds)
            ? kinds
            : MediaTabKindsMap[MediaTabMedia];

    private async Task ToggleMediaPanelAsync(CancellationToken cancellationToken)
    {
        if (IsMediaPanelOpen)
        {
            CloseMediaPanel();
            return;
        }

        if (_selectedConversation is not { } conversation)
        {
            return;
        }

        // Оверлеи ленты взаимоисключающие.
        CloseForwardPanel();
        CloseMessageSearch();
        IsReadersPanelOpen = false;
        CloseMembersPanel();
        _mediaPanelConversation = conversation;
        IsMediaPanelOpen = true;
        ResetMediaStreams();
        RebuildMediaItems();
        IsLoadingMedia = true;
        try
        {
            await LoadMediaPageAsync(conversation, append: false, cancellationToken);
        }
        finally
        {
            IsLoadingMedia = false;
        }
    }

    /// <summary>
    /// Смена вкладки галереи: показывает уже загруженные плитки потоков вкладки,
    /// незагруженные дотягивает первой страницей. У каждой вкладки свой курсор.
    /// </summary>
    private async Task SelectMediaTabAsync(object? parameter, CancellationToken cancellationToken)
    {
        var tab = parameter as string;
        if (_mediaPanelConversation is not { } conversation
            || string.IsNullOrEmpty(tab)
            || string.Equals(tab, _selectedMediaTab, StringComparison.Ordinal)
            || IsLoadingMedia)
        {
            return;
        }

        SelectedMediaTab = tab;
        RebuildMediaItems();
        if (CurrentMediaKinds.All(kind => _mediaStreams[kind].Loaded))
        {
            return;
        }

        IsLoadingMedia = true;
        try
        {
            await LoadMediaPageAsync(conversation, append: false, cancellationToken);
        }
        finally
        {
            IsLoadingMedia = false;
        }
    }

    /// <summary>«Показать ещё»: догружает потоки активной вкладки, где остался курсор.</summary>
    private async Task LoadMoreMediaAsync(CancellationToken cancellationToken)
    {
        if (_mediaPanelConversation is not { } conversation || IsLoadingMoreMedia)
        {
            return;
        }

        IsLoadingMoreMedia = true;
        try
        {
            await LoadMediaPageAsync(conversation, append: true, cancellationToken);
        }
        finally
        {
            IsLoadingMoreMedia = false;
        }
    }

    /// <summary>
    /// Страница галереи: на первой загрузке тянет все kind-потоки вкладки,
    /// на догрузке — только те, где сервер оставил курсор. Как в web,
    /// потоки вкладки сливаются в одну сетку по created_at desc.
    /// </summary>
    private async Task LoadMediaPageAsync(
        ConversationItemViewModel conversation,
        bool append,
        CancellationToken cancellationToken)
    {
        var pages = new List<(string Kind, HubChatConversationAttachmentPage Page)>();
        foreach (var kind in CurrentMediaKinds)
        {
            var stream = _mediaStreams[kind];
            if ((append && !stream.HasMore) || (!append && stream.Loaded))
            {
                continue;
            }

            var page = await _api.GetChatConversationAttachmentsAsync(
                conversation.Id, kind, MediaPageSize,
                append ? stream.Cursor : null, cancellationToken);
            pages.Add((kind, page));
        }

        if (!ReferenceEquals(_mediaPanelConversation, conversation) || !IsMediaPanelOpen)
        {
            return;
        }

        foreach (var (kind, page) in pages)
        {
            var stream = _mediaStreams[kind];
            stream.Loaded = true;
            // Сервер оставляет курсор только при has_more — защита от зацикливания.
            stream.HasMore = page.HasMore
                && !string.IsNullOrEmpty(page.NextBeforeAttachmentId)
                && !string.Equals(page.NextBeforeAttachmentId, stream.Cursor, StringComparison.Ordinal);
            stream.Cursor = page.NextBeforeAttachmentId ?? stream.Cursor;
            foreach (var item in (page.Items ?? [])
                         .Where(i => !string.IsNullOrEmpty(i.Id) && _mediaSeenIds.Add(i.Id))
                         .OrderByDescending(i => i.CreatedAt ?? DateTimeOffset.MinValue))
            {
                _mediaItemsByKind[kind].Add(
                    new ChatMediaItemViewModel(item, OpenMediaItemAsync, _imageLoader));
            }
        }

        RebuildMediaItems();
        RaiseMediaStates();
    }

    /// <summary>Пересборка сетки: потоки вкладки сливаются по created_at desc.</summary>
    private void RebuildMediaItems()
    {
        MediaItems.Clear();
        foreach (var item in CurrentMediaKinds
                     .SelectMany(kind => _mediaItemsByKind[kind])
                     .OrderByDescending(i => i.CreatedAt ?? DateTimeOffset.MinValue))
        {
            MediaItems.Add(item);
        }
    }

    private void ResetMediaStreams()
    {
        foreach (var stream in _mediaStreams.Values)
        {
            stream.Cursor = null;
            stream.HasMore = false;
            stream.Loaded = false;
        }

        foreach (var items in _mediaItemsByKind.Values)
        {
            items.Clear();
        }

        _mediaSeenIds.Clear();
        SelectedMediaTab = MediaTabMedia;
    }

    private void RaiseMediaStates()
    {
        OnPropertyChanged(nameof(HasMoreMedia));
        OnPropertyChanged(nameof(MediaEmptyText));
        (LoadMoreMediaCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>Клик по плитке — тот же путь, что у чипа вложения: скачать и открыть.</summary>
    private Task OpenMediaItemAsync(ChatMediaItemViewModel item) =>
        DownloadAndOpenAttachmentAsync(item.MessageId, item.Model, item.FileName);

    private void CloseMediaPanel()
    {
        IsMediaPanelOpen = false;
        _mediaPanelConversation = null;
        MediaItems.Clear();
        ResetMediaStreams();
        IsLoadingMedia = false;
        IsLoadingMoreMedia = false;
        RaiseMediaStates();
    }

    // ---- Превью ссылок ----

    /// <summary>
    /// Открытие ссылки из карточки превью — во внешнем браузере;
    /// только http/https, прочие схемы игнорируем (как guard в web).
    /// </summary>
    private async Task OpenLinkPreviewAsync(
        ChatMessageViewModel message,
        ChatLinkPreviewItemViewModel item)
    {
        if (!Uri.TryCreate(item.Url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
        {
            return;
        }

        try
        {
            if (LinkOpener is not null)
            {
                await LinkOpener(uri.AbsoluteUri);
                return;
            }

            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    /// <summary>
    /// Запрос превью с кэшем и дедупом in-flight — как _previewCache/_inflight в web:
    /// повторный url в другой карточке не дублирует сетевой запрос.
    /// </summary>
    private Task<HubChatLinkPreview?> FetchLinkPreviewCachedAsync(string url)
    {
        if (_linkPreviewRequests.TryGetValue(url, out var existing))
        {
            return existing;
        }

        if (_linkPreviewRequests.Count >= LinkPreviewCacheMax)
        {
            _linkPreviewRequests.Clear();
        }

        var task = FetchLinkPreviewSafelyAsync(url);
        _linkPreviewRequests[url] = task;
        return task;
    }

    private async Task<HubChatLinkPreview?> FetchLinkPreviewSafelyAsync(string url)
    {
        try
        {
            return await _api.GetChatLinkPreviewAsync(url, CancellationToken.None);
        }
        catch
        {
            // Превью — необязательная карточка: сбой сети/API → null (компактный вид).
            return null;
        }
    }

    // ---- Выход из группы ----

    /// <summary>
    /// «Покинуть группу» из меню строки: POST …/leave → локально убираем диалог
    /// из списка и снимаем выбор (как обработчик chat.conversation.removed).
    /// </summary>
    private async Task LeaveGroupConversationAsync(ConversationItemViewModel item)
    {
        try
        {
            await _api.LeaveChatConversationAsync(item.Id, CancellationToken.None);
            RunOnUi(() => RemoveConversationLocally(item));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Удаление строки диалога из списков + снятие выбора — общее для leave и realtime.</summary>
    private void RemoveConversationLocally(ConversationItemViewModel removed)
    {
        _allConversations.Remove(removed);
        _serverSearchResults?.RemoveAll(
            c => string.Equals(c.Id, removed.Id, StringComparison.OrdinalIgnoreCase));
        RebuildVisibleConversations();
        RefreshPresenceWatch();
        if (ReferenceEquals(_selectedConversation, removed))
        {
            SelectedConversation = null;
        }
    }

    // ---- «Заметки себе» ----

    /// <summary>Кнопка 🗒 в шапке списка диалогов.</summary>
    public ICommand OpenNotesCommand { get; }

    /// <summary>Get-or-create диалога «Заметки» с самим собой и переход в него.</summary>
    private async Task OpenNotesAsync(CancellationToken cancellationToken)
    {
        var conversation = await _api.CreateNotesConversationAsync(cancellationToken);
        var item = UpsertConversationItem(conversation);
        // Заметки могли остаться скрытыми активным фильтром/архивным видом.
        if (item.IsArchived != ShowArchived)
        {
            ShowArchived = item.IsArchived;
        }

        if (!string.IsNullOrEmpty(_searchText))
        {
            SearchText = string.Empty;
        }

        RebuildVisibleConversations();
        SelectedConversation = item;
        BannerErrorText = null;
    }

    /// <summary>Upsert summary диалога в _allConversations; возвращает item-VM.</summary>
    private ConversationItemViewModel UpsertConversationItem(HubChatConversation conversation)
    {
        var existing = FindConversation(conversation.Id);
        ConversationItemViewModel item;
        if (existing is not null)
        {
            existing.Update(conversation);
            item = existing;
        }
        else
        {
            item = CreateConversationViewModel(conversation);
            _allConversations.Add(item);
        }

        ApplyConversationPresence(item, conversation);
        // Новый direct-диалог: его собеседник должен попасть в watch-набор.
        RefreshPresenceWatch();
        return item;
    }

    // ---- Закреплённые сообщения ----

    /// <summary>Закрепы текущего диалога (превью сверху ленты).</summary>
    public ObservableCollection<HubChatPinnedMessage> PinnedMessages { get; } = [];

    private readonly HashSet<string> _pinnedMessageIds = new(StringComparer.Ordinal);

    /// <summary>Есть закреплённые — показываем плашку над лентой.</summary>
    public bool HasPinnedMessages => PinnedMessages.Count > 0;

    /// <summary>Текст плашки закрепа: «📌 Автор: превью».</summary>
    public string PinnedBarText
    {
        get
        {
            var top = PinnedMessages.FirstOrDefault();
            if (top is null)
            {
                return string.Empty;
            }

            var preview = string.IsNullOrWhiteSpace(top.Preview) ? "Сообщение" : top.Preview;
            return string.IsNullOrWhiteSpace(top.SenderName)
                ? "📌 " + preview
                : $"📌 {top.SenderName}: {preview}";
        }
    }

    private ICommand? _jumpToPinnedCommand;

    /// <summary>Клик по плашке закрепа — переход к верхнему закреплённому.</summary>
    public ICommand JumpToPinnedCommand => _jumpToPinnedCommand ??= new NativeAsyncCommand(
        (_, ct) =>
        {
            var conversation = _selectedConversation;
            var top = PinnedMessages.FirstOrDefault();
            return conversation is null || top is null || string.IsNullOrEmpty(top.Id)
                ? Task.CompletedTask
                : JumpToAnchorAsync(conversation, top.Id, closeSearch: false, ct);
        },
        ex => BannerErrorText = TasksViewModel.DescribeError(ex));

    /// <summary>PUT/DELETE pinned-messages из меню сообщения; ответ — новый список закрепов.</summary>
    private async Task ToggleMessagePinAsync(ChatMessageViewModel message)
    {
        var conversation = _selectedConversation;
        if (conversation is null || string.IsNullOrEmpty(message.Id))
        {
            return;
        }

        try
        {
            var list = message.IsPinned
                ? await _api.UnpinChatMessageAsync(conversation.Id, message.Id, CancellationToken.None)
                : await _api.PinChatMessageAsync(conversation.Id, message.Id, CancellationToken.None);
            RunOnUi(() => ApplyPinnedMessages(list.Items ?? []));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>GET pinned-messages — подгрузка плашки при открытии/смене диалога.</summary>
    private async Task LoadPinnedMessagesSafelyAsync(
        ConversationItemViewModel conversation,
        CancellationToken cancellationToken)
    {
        try
        {
            var list = await _api.GetChatPinnedMessagesAsync(conversation.Id, cancellationToken);
            RunOnUi(() =>
            {
                if (ReferenceEquals(_selectedConversation, conversation))
                {
                    ApplyPinnedMessages(list.Items ?? []);
                }
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Плашка закрепа — вспомогательная: ошибка не блокирует ленту.
        }
    }

    /// <summary>Смена диалога/Reset: плашка и флаги на пузырях не переживают ленту.</summary>
    private void ClearPinnedState()
    {
        if (PinnedMessages.Count == 0)
        {
            return;
        }

        ApplyPinnedMessages([]);
    }

    /// <summary>Новый список закрепов: обновляет коллекцию и флаги на пузырях.</summary>
    private void ApplyPinnedMessages(IReadOnlyList<HubChatPinnedMessage> items)
    {
        PinnedMessages.Clear();
        _pinnedMessageIds.Clear();
        foreach (var item in items)
        {
            if (!string.IsNullOrEmpty(item.Id))
            {
                PinnedMessages.Add(item);
                _pinnedMessageIds.Add(item.Id);
            }
        }

        foreach (var message in Messages)
        {
            message.IsPinned = message.Id is not null && _pinnedMessageIds.Contains(message.Id);
        }

        OnPropertyChanged(nameof(HasPinnedMessages));
        OnPropertyChanged(nameof(PinnedBarText));
    }

    /// <summary>Debounce 350 мс: серверный поиск по сообщениям выбранного диалога.</summary>
    private void ScheduleMessageSearch()
    {
        _messageSearchCancellation?.Cancel();
        _messageSearchCancellation?.Dispose();
        var cancellation = new CancellationTokenSource();
        _messageSearchCancellation = cancellation;
        var query = _messageSearchText.Trim();
        var conversation = _selectedConversation;
        _ = SearchMessagesSafelyAsync(conversation, query, cancellation.Token);
    }

    private async Task SearchMessagesSafelyAsync(
        ConversationItemViewModel? conversation,
        string query,
        CancellationToken cancellationToken)
    {
        if (conversation is null || query.Length < 2)
        {
            RunOnUi(() =>
            {
                SearchResults.Clear();
                IsSearchingMessages = false;
            });
            return;
        }

        RunOnUi(() => IsSearchingMessages = true);
        try
        {
            await Task.Delay(UserSearchDebounce, cancellationToken);
            var result = await _api.SearchChatMessagesAsync(
                conversation.Id, query, 20, cancellationToken);
            RunOnUi(() =>
            {
                // Запрос или диалог уже сменились — результат устарел.
                if (!ReferenceEquals(_selectedConversation, conversation)
                    || !string.Equals(_messageSearchText.Trim(), query, StringComparison.Ordinal))
                {
                    return;
                }

                SearchResults.Clear();
                foreach (var dto in result.Items ?? [])
                {
                    // Пузыри результатов без действий — только превью и переход.
                    SearchResults.Add(new ChatMessageViewModel(
                        NormalizePollBody(dto), conversation.IsGroupLike));
                }

                OnPropertyChanged(nameof(MessageSearchHint));
                IsSearchingMessages = false;
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                IsSearchingMessages = false;
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
    }

    /// <summary>Переход к найденному сообщению: thread-bootstrap вокруг якоря + выделение.</summary>
    private async Task JumpToMessageAsync(
        ChatMessageViewModel? hit,
        CancellationToken cancellationToken)
    {
        var conversation = _selectedConversation;
        if (hit is null || conversation is null || string.IsNullOrEmpty(hit.Id))
        {
            return;
        }

        await JumpToAnchorAsync(conversation, hit.Id, closeSearch: true, cancellationToken);
    }

    /// <summary>Общий переход к якорю: лента пересобирается через thread-bootstrap.</summary>
    private async Task JumpToAnchorAsync(
        ConversationItemViewModel conversation,
        string messageId,
        bool closeSearch,
        CancellationToken cancellationToken)
    {
        // Параллельная первичная загрузка ленты при смене диалога не должна
        // перезаписать результат bootstrap — гасим её.
        _messagesLoadCancellation?.Cancel();
        try
        {
            var page = await _api.GetChatThreadBootstrapAsync(
                conversation.Id, messageId, 40, cancellationToken);
            RunOnUi(() =>
            {
                if (!ReferenceEquals(_selectedConversation, conversation))
                {
                    return;
                }

                Messages.Clear();
                foreach (var dto in (page.Items ?? [])
                             .OrderBy(m => m.CreatedAt ?? DateTimeOffset.MinValue))
                {
                    Messages.Add(CreateMessageViewModel(dto, conversation.IsGroupLike));
                }

                HasOlder = page.HasOlder;
                _olderCursor = page.OlderCursorMessageId;
                var anchorId = page.InitialAnchorMessageId ?? messageId;
                SelectedMessage = Messages.FirstOrDefault(
                    m => string.Equals(m.Id, anchorId, StringComparison.Ordinal));
                if (closeSearch)
                {
                    CloseMessageSearch();
                }

                if (page.PinnedMessages is { } pinned)
                {
                    ApplyPinnedMessages(pinned);
                }

                BannerErrorText = null;

                var lastId = Messages.LastOrDefault()?.Id;
                if (!string.IsNullOrEmpty(lastId))
                {
                    _ = MarkReadSafelyAsync(conversation.Id, lastId);
                }
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    private void OpenNewConversation()
    {
        // Оверлеи левой колонки взаимоисключающие — как и у web-диалогов.
        CloseGlobalSearch();
        IsNewConversationOpen = true;
        ScheduleUserSearch(immediate: true);
    }

    private void CloseNewConversation()
    {
        _userSearchCancellation?.Cancel();
        IsNewConversationOpen = false;
        FoundUsers.Clear();
        OnPropertyChanged(nameof(IsUserSearchEmpty));
        _newConversationSearchText = string.Empty;
        OnPropertyChanged(nameof(NewConversationSearchText));
        IsNewGroupMode = false;
        ClearGroupMemberSelection();
        _newGroupTitle = string.Empty;
        OnPropertyChanged(nameof(NewGroupTitle));
    }

    /// <summary>Очистка чипов группы: снимаем галочки и сами экземпляры.</summary>
    private void ClearGroupMemberSelection()
    {
        foreach (var member in SelectedGroupMembers)
        {
            member.IsSelected = false;
        }

        SelectedGroupMembers.Clear();
    }

    /// <summary>
    /// Toggle участника группы по клику в FoundUsers/чипе. Один и тот же
    /// пользователь после повторного поиска — другой экземпляр: сравниваем по Id
    /// и синхронизируем галочки на всех видимых строках.
    /// </summary>
    private void ToggleGroupMemberSelection(ChatUserItemViewModel user)
    {
        var existing = SelectedGroupMembers.FirstOrDefault(member => member.Id == user.Id);
        if (existing is not null)
        {
            existing.IsSelected = false;
            SelectedGroupMembers.Remove(existing);
        }
        else
        {
            SelectedGroupMembers.Add(user);
        }

        var selected = existing is null;
        foreach (var item in FoundUsers.Where(candidate => candidate.Id == user.Id))
        {
            item.IsSelected = selected;
        }

        user.IsSelected = selected;
    }

    /// <summary>
    /// «Создать группу»: POST /chat/conversations/group, upsert в список,
    /// выбор созданного диалога и закрытие панели — как у direct.
    /// </summary>
    private async Task CreateGroupConversationAsync(CancellationToken cancellationToken)
    {
        var title = NewGroupTitle.Trim();
        var memberIds = SelectedGroupMembers.Select(member => member.Id).ToList();
        if (title.Length == 0 || memberIds.Count == 0 || IsCreatingConversation)
        {
            return;
        }

        IsCreatingConversation = true;
        try
        {
            var conversation = await _api.CreateChatGroupConversationAsync(
                title, memberIds, cancellationToken);
            var item = UpsertConversationItem(conversation);
            // Иначе новый диалог может остаться скрытым активным фильтром.
            SearchText = string.Empty;
            RebuildVisibleConversations();
            CloseNewConversation();
            SelectedConversation = item;
            BannerErrorText = null;
        }
        finally
        {
            IsCreatingConversation = false;
        }
    }

    private void ScheduleUserSearch(bool immediate)
    {
        if (!IsNewConversationOpen)
        {
            return;
        }

        _userSearchCancellation?.Cancel();
        var cancellation = _userSearchCancellation = new CancellationTokenSource();
        _ = SearchUsersDebouncedAsync(cancellation, immediate);
    }

    private async Task SearchUsersDebouncedAsync(
        CancellationTokenSource cancellation,
        bool immediate)
    {
        try
        {
            if (!immediate)
            {
                await Task.Delay(UserSearchDebounce, cancellation.Token);
            }

            var query = _newConversationSearchText.Trim();
            IsSearchingUsers = true;
            var list = await _api.GetChatUsersAsync(
                query,
                ChatUsersPageLimit,
                cancellation.Token);
            if (!ReferenceEquals(_userSearchCancellation, cancellation))
            {
                return;
            }

            FoundUsers.Clear();
            foreach (var user in list.Items ?? [])
            {
                var item = new ChatUserItemViewModel(user);
                // Повторный поиск в режиме группы: галочки уже выбранных сохраняем.
                item.IsSelected = SelectedGroupMembers.Any(member => member.Id == user.Id);
                FoundUsers.Add(item);
            }

            OnPropertyChanged(nameof(IsUserSearchEmpty));
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(_userSearchCancellation, cancellation))
            {
                FoundUsers.Clear();
                OnPropertyChanged(nameof(IsUserSearchEmpty));
                BannerErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_userSearchCancellation, cancellation))
            {
                IsSearchingUsers = false;
            }
        }
    }

    /// <summary>
    /// Создание (или переоткрытие существующего) direct-диалога:
    /// upsert в список, сброс локального фильтра, выбор и закрытие панели.
    /// </summary>
    private async Task CreateDirectConversationAsync(
        ChatUserItemViewModel? user,
        CancellationToken cancellationToken)
    {
        if (user is null || IsCreatingConversation)
        {
            return;
        }

        IsCreatingConversation = true;
        try
        {
            var conversation = await _api.CreateDirectConversationAsync(user.Id, cancellationToken);
            var existing = UpsertConversationItem(conversation);
            // Иначе выбранный диалог может остаться скрытым активным фильтром.
            SearchText = string.Empty;
            RebuildVisibleConversations();
            CloseNewConversation();
            SelectedConversation = existing;
            BannerErrorText = null;
        }
        finally
        {
            IsCreatingConversation = false;
        }
    }

    // ---- Загрузка ----

    /// <summary>Список диалогов + запуск realtime-цикла (ошибки старта не фатальны).</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await LoadConversationsCoreAsync(cancellationToken);
        }
        finally
        {
            await StartRealtimeSafelyAsync();
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при автономной инициализации.</summary>
    public void SetLoadError(string message) => BannerErrorText = message;

    /// <summary>Остановка realtime и полная очистка (выход из сессии).</summary>
    public void Reset()
    {
        // Stopped должен уйти по живому сокету до отписки/stop ниже.
        StopTypingIfSent();
        _messagesLoadCancellation?.Cancel();
        _conversationsReloadCancellation?.Cancel();
        _userSearchCancellation?.Cancel();
        _conversationSearchCancellation?.Cancel();
        _messageSearchCancellation?.Cancel();
        _memberSearchCancellation?.Cancel();

        var realtime = _realtime;
        _realtime = _injectedRealtime;
        _realtimeSubscribed = false;
        if (realtime is not null)
        {
            realtime.EventReceived -= Realtime_EventReceived;
            realtime.StateChanged -= Realtime_StateChanged;
            // Лениво созданный клиент — наш, dispose; инжектированный — только stop.
            var dispose = !ReferenceEquals(realtime, _injectedRealtime);
            _ = StopRealtimeSafelyAsync(realtime, dispose);
        }

        _allConversations.Clear();
        Conversations.Clear();
        Messages.Clear();
        _realtime?.WatchConversation(null);
        _realtime?.WatchPresence([]);
        _presenceByUserId.Clear();
        _presenceWatchUserIds = [];
        _serverSearchResults = null;
        _pendingConversationId = null;
        _pendingAnchorMessageId = null;
        _selectedConversation = null;
        OnPropertyChanged(nameof(SelectedConversation));
        OnPropertyChanged(nameof(HasConversation));
        _olderCursor = null;
        HasOlder = false;
        _conversationsCursor = null;
        HasMoreConversations = false;
        ComposerText = string.Empty;
        ClearComposerContext();
        ClearTypingIndicator();
        CloseMessageSearch();
        CloseGlobalSearch();
        CloseForwardPanel();
        IsForwarding = false;
        IsReadersPanelOpen = false;
        IsLoadingReaders = false;
        ReadersTitleText = null;
        MessageReaders.Clear();
        ClearPinnedState();
        SelectedMessage = null;
        ShowArchived = false;
        SearchText = string.Empty;
        BannerErrorText = null;
        IsSending = false;
        IsUploading = false;
        UploadStatusText = null;
        IsLoading = false;
        IsLoadingMessages = false;
        IsLoadingOlder = false;
        IsLoadingMoreConversations = false;
        IsNewConversationOpen = false;
        FoundUsers.Clear();
        _newConversationSearchText = string.Empty;
        OnPropertyChanged(nameof(NewConversationSearchText));
        IsSearchingUsers = false;
        IsCreatingConversation = false;
        IsNewGroupMode = false;
        ClearGroupMemberSelection();
        _newGroupTitle = string.Empty;
        OnPropertyChanged(nameof(NewGroupTitle));
        CloseMembersPanel();
        CloseMediaPanel();
        _linkPreviewRequests.Clear();
        ApplyConnectionState(HubChatRealtimeState.Disconnected);
    }

    private async Task LoadConversationsCoreAsync(CancellationToken cancellationToken)
    {
        IsLoading = true;
        try
        {
            var pages = await FetchConversationPagesAsync(cancellationToken);
            ApplyConversations(pages, allowRemoval: true);
            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Догрузка следующей страницы диалогов по серверному курсору.</summary>
    private async Task LoadMoreConversationsAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(_conversationsCursor))
        {
            return;
        }

        IsLoadingMoreConversations = true;
        try
        {
            var page = await _api.GetChatConversationsAsync(
                _conversationsCursor,
                ConversationsPageLimit,
                query: null,
                cancellationToken);
            ApplyConversations([page], allowRemoval: false);
            BannerErrorText = null;
        }
        finally
        {
            IsLoadingMoreConversations = false;
        }
    }

    /// <summary>
    /// Перечитывает все уже загруженные страницы: при наличии догруженных страниц
    /// refresh возвращает не только первую, а весь срез — список не «схлопывается».
    /// </summary>
    private async Task<List<HubChatConversationList>> FetchConversationPagesAsync(
        CancellationToken cancellationToken)
    {
        var target = _allConversations.Count;
        var pages = new List<HubChatConversationList>();
        var page = await _api.GetChatConversationsAsync(
            null,
            ConversationsPageLimit,
            query: null,
            cancellationToken);
        pages.Add(page);
        var loaded = page.Items?.Count ?? 0;
        for (var guard = 0;
             loaded < target && page.HasMore && !string.IsNullOrEmpty(page.NextCursor) && guard < 20;
             guard++)
        {
            page = await _api.GetChatConversationsAsync(
                page.NextCursor,
                ConversationsPageLimit,
                query: null,
                cancellationToken);
            pages.Add(page);
            loaded += page.Items?.Count ?? 0;
        }

        return pages;
    }

    /// <summary>
    /// Merge страниц диалогов: обновить/добавить; при полном refresh удаляет пропавшие,
    /// при догрузке страницы (allowRemoval=false) существующие не трогает.
    /// </summary>
    private void ApplyConversations(
        IReadOnlyList<HubChatConversationList> pages,
        bool allowRemoval)
    {
        var incoming = new Dictionary<string, HubChatConversation>(StringComparer.OrdinalIgnoreCase);
        foreach (var page in pages)
        {
            foreach (var dto in page.Items ?? [])
            {
                if (!string.IsNullOrEmpty(dto.Id))
                {
                    incoming[dto.Id] = dto;
                }
            }
        }

        for (var i = _allConversations.Count - 1; i >= 0; i--)
        {
            var item = _allConversations[i];
            if (incoming.TryGetValue(item.Id, out var dto))
            {
                item.Update(dto);
                ApplyConversationPresence(item, dto);
                incoming.Remove(item.Id);
            }
            else if (allowRemoval && !ReferenceEquals(item, _selectedConversation))
            {
                _allConversations.RemoveAt(i);
            }
        }

        foreach (var dto in incoming.Values)
        {
            var created = CreateConversationViewModel(dto);
            _allConversations.Add(created);
            ApplyConversationPresence(created, dto);
        }

        var last = pages.Count > 0 ? pages[^1] : null;
        _conversationsCursor = last?.NextCursor;
        HasMoreConversations = last?.HasMore == true && !string.IsNullOrEmpty(last.NextCursor);
        RebuildVisibleConversations();
        TryApplyPendingConversation();
        RefreshPresenceWatch();
    }

    /// <summary>
    /// Deep link/уведомление ведёт на конкретный диалог: выбираем, если загружен,
    /// иначе ждём следующей порции списка (refresh, догрузка страниц).
    /// </summary>
    public Task SelectConversationByIdAsync(
        string? conversationId,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(conversationId))
        {
            return Task.CompletedTask;
        }

        var item = FindConversation(conversationId);
        if (item is not null)
        {
            _pendingConversationId = null;
            SelectedConversation = item;
            return Task.CompletedTask;
        }

        _pendingConversationId = conversationId;
        return Task.CompletedTask;
    }

    private void TryApplyPendingConversation()
    {
        if (_pendingConversationId is null
            || FindConversation(_pendingConversationId) is not { } item)
        {
            return;
        }

        _pendingConversationId = null;
        var anchorMessageId = _pendingAnchorMessageId;
        _pendingAnchorMessageId = null;
        SelectedConversation = item;
        if (!string.IsNullOrEmpty(anchorMessageId))
        {
            // Переход к сообщению из глобального поиска — лента пересобирается bootstrap'ом.
            _ = JumpToAnchorAsync(item, anchorMessageId, closeSearch: false, CancellationToken.None);
        }
    }

    /// <summary>
    /// Сортировка IsPinned desc → LastMessageAt desc и локальный фильтр.
    /// Diff-синхронизация без Clear(): выделение в ListBox не теряется.
    /// </summary>
    private void RebuildVisibleConversations()
    {
        // Серверный результат уже отфильтрован бэкендом; локальный фильтр —
        // только fallback по загруженным страницам. Архив — папка как в web:
        // в обычном виде скрыт, в виде «Архив» показан только он.
        var source = _serverSearchResults
            ?? _allConversations
                .Where(item => item.IsArchived == ShowArchived)
                .Where(item => item.MatchesFilter(_searchText));
        var desired = source
            .OrderByDescending(item => item.IsPinned)
            .ThenByDescending(item => item.LastMessageAt ?? DateTimeOffset.MinValue)
            .ThenBy(item => item.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        var desiredSet = new HashSet<ConversationItemViewModel>(desired);
        for (var i = Conversations.Count - 1; i >= 0; i--)
        {
            if (!desiredSet.Contains(Conversations[i]))
            {
                Conversations.RemoveAt(i);
            }
        }

        for (var index = 0; index < desired.Count; index++)
        {
            var item = desired[index];
            if (index < Conversations.Count && ReferenceEquals(Conversations[index], item))
            {
                continue;
            }

            var current = Conversations.IndexOf(item);
            if (current >= 0)
            {
                Conversations.Move(current, index);
            }
            else
            {
                Conversations.Insert(index, item);
            }
        }

        OnPropertyChanged(nameof(IsEmpty));
        OnPropertyChanged(nameof(TotalUnreadCount));
    }

    // ---- Сообщения ----

    private async Task LoadMessagesSafelyAsync(ConversationItemViewModel conversation)
    {
        _messagesLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _messagesLoadCancellation = cancellation;
        IsLoadingMessages = true;
        Messages.Clear();
        HasOlder = false;
        _olderCursor = null;
        try
        {
            var page = await _api.GetChatMessagesAsync(
                conversation.Id,
                beforeMessageId: null,
                afterMessageId: null,
                MessagesPageSize,
                cancellation.Token);
            if (!ReferenceEquals(_selectedConversation, conversation)
                || cancellation.Token.IsCancellationRequested)
            {
                return;
            }

            Messages.Clear();
            foreach (var message in (page.Items ?? []).OrderBy(m => m.CreatedAt ?? DateTimeOffset.MinValue))
            {
                Messages.Add(CreateMessageViewModel(message, conversation.IsGroupLike));
            }

            HasOlder = page.HasOlder;
            _olderCursor = page.OlderCursorMessageId;
            BannerErrorText = null;
            conversation.ClearUnread();
            OnPropertyChanged(nameof(TotalUnreadCount));

            var lastId = Messages.LastOrDefault()?.Id;
            if (!string.IsNullOrEmpty(lastId))
            {
                _ = MarkReadSafelyAsync(conversation.Id, lastId);
            }

            _ = LoadPinnedMessagesSafelyAsync(conversation, cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(_selectedConversation, conversation))
            {
                BannerErrorText = TasksViewModel.DescribeError(ex);
            }
        }
        finally
        {
            if (ReferenceEquals(_messagesLoadCancellation, cancellation))
            {
                IsLoadingMessages = false;
            }
        }
    }

    private async Task LoadOlderAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        var cursor = _olderCursor;
        if (conversation is null || cursor is null || IsLoadingOlder)
        {
            return;
        }

        IsLoadingOlder = true;
        try
        {
            var page = await _api.GetChatMessagesAsync(
                conversation.Id,
                cursor,
                afterMessageId: null,
                MessagesPageSize,
                cancellationToken);
            if (!ReferenceEquals(_selectedConversation, conversation))
            {
                return;
            }

            var known = new HashSet<string>(Messages.Select(m => m.Id), StringComparer.Ordinal);
            var index = 0;
            foreach (var message in (page.Items ?? []).OrderBy(m => m.CreatedAt ?? DateTimeOffset.MinValue))
            {
                if (!string.IsNullOrEmpty(message.Id) && !known.Add(message.Id))
                {
                    continue;
                }

                Messages.Insert(index++, CreateMessageViewModel(message, conversation.IsGroupLike));
            }

            HasOlder = page.HasOlder;
            _olderCursor = page.OlderCursorMessageId;
        }
        catch (Exception ex) when (ex is not OperationCanceledException
            && ReferenceEquals(_selectedConversation, conversation))
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsLoadingOlder = false;
        }
    }

    private async Task SendAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        var text = ComposerText.Trim();
        if (conversation is null || text.Length == 0 || IsSending)
        {
            return;
        }

        IsSending = true;
        try
        {
            var editing = EditingMessage;
            if (editing is not null)
            {
                var updated = await _api.EditChatMessageAsync(
                    conversation.Id,
                    editing.Id,
                    text,
                    cancellationToken);
                editing.Update(updated);
                ClearComposerContext();
                ComposerText = string.Empty;
                StopTypingIfSent();
                BannerErrorText = null;
                return;
            }

            var clientMessageId = Guid.NewGuid().ToString("N");
            var message = await _api.SendChatMessageAsync(
                conversation.Id,
                text,
                clientMessageId,
                ReplyingTo?.Id,
                cancellationToken);
            // За время await пользователь мог переключить диалог — в чужую
            // открытую ленту сообщение не вставляем и composer не трогаем.
            if (ReferenceEquals(_selectedConversation, conversation))
            {
                InsertMessage(message, conversation.IsGroupLike);
                ComposerText = string.Empty;
                ClearComposerContext();
            }

            // Успешная отправка снимает «печатает…» явно — даже если диалог
            // за время await сменился и composer не чистили.
            StopTypingIfSent();
            conversation.UpdateLastMessage(message);
            RebuildVisibleConversations();
            BannerErrorText = null;
        }
        catch (Exception ex)
        {
            // Текст composer не теряем — показываем баннер с «Повторить».
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsSending = false;
        }
    }

    /// <summary>
    /// Отправка файлов как вложений: POST upload-session → чанки по chunk_size_bytes →
    /// POST complete → готовое сообщение в ленту. Текст composer и ответ-на идут в тело сессии.
    /// </summary>
    internal async Task AttachFilesAsync(IReadOnlyList<string> paths, CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null || paths.Count == 0 || IsUploading || IsSending)
        {
            return;
        }

        var requests = new List<HubChatUploadFileRequest>();
        var sourcePaths = new List<string>();
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                continue;
            }

            try
            {
                var info = new FileInfo(path);
                if (!info.Exists || info.Length <= 0)
                {
                    BannerErrorText = $"Файл «{Path.GetFileName(path)}» не найден или пуст.";
                    return;
                }

                requests.Add(new HubChatUploadFileRequest
                {
                    FileName = info.Name,
                    MimeType = GuessMimeType(info.Extension),
                    Size = info.Length,
                    OriginalSize = info.Length,
                });
                sourcePaths.Add(path);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                BannerErrorText = $"Нет доступа к файлу «{Path.GetFileName(path)}».";
                return;
            }
        }

        if (requests.Count == 0)
        {
            return;
        }

        IsUploading = true;
        UploadStatusText = requests.Count == 1
            ? $"Отправка файла «{requests[0].FileName}»…"
            : $"Отправка {requests.Count} файлов…";
        var clientMessageId = Guid.NewGuid().ToString("N");
        try
        {
            var session = await _api.CreateChatUploadSessionAsync(
                conversation.Id,
                string.IsNullOrWhiteSpace(ComposerText) ? null : ComposerText.Trim(),
                ReplyingTo?.Id,
                clientMessageId,
                requests,
                cancellationToken);

            var sessionFiles = session.Files ?? [];
            if (sessionFiles.Count < requests.Count)
            {
                // Сервер обязан вернуть file_id на каждый заявленный файл —
                // тихо обрезать нельзя: сообщение ушло бы без части файлов.
                BannerErrorText = "Сервер не принял часть файлов — попробуйте ещё раз.";
                return;
            }

            // Серверный дефолт 2 МБ — fallback только на сломанный ответ.
            var chunkSize = session.ChunkSizeBytes > 0 ? session.ChunkSizeBytes : 2 * 1024 * 1024;
            var buffer = new byte[chunkSize];
            for (var index = 0; index < requests.Count; index++)
            {
                var request = requests[index];
                var file = sessionFiles[index];
                var sourcePath = sourcePaths[index];
                UploadStatusText = $"Отправка «{request.FileName}» ({index + 1}/{requests.Count})…";

                var chunkIndex = 0;
                long offset = 0;
                await using var stream = new FileStream(
                    sourcePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
                while (offset < request.Size)
                {
                    var read = await stream.ReadAsync(
                        buffer, 0, (int)Math.Min(buffer.Length, request.Size - offset), cancellationToken);
                    if (read <= 0)
                    {
                        break;
                    }

                    await _api.UploadChatChunkAsync(
                        session.SessionId, file.FileId, chunkIndex, offset,
                        buffer.AsMemory(0, read), cancellationToken);
                    offset += read;
                    chunkIndex++;
                    UploadStatusText = request.Size > 0
                        ? $"Отправка «{request.FileName}» — {offset * 100 / request.Size}%"
                        : $"Отправка «{request.FileName}»…";
                }
            }

            var message = await _api.CompleteChatUploadSessionAsync(session.SessionId, cancellationToken);
            if (ReferenceEquals(_selectedConversation, conversation))
            {
                // Чистим composer только когда диалог не сменился за время загрузки —
                // иначе стираем черновик другого диалога.
                InsertMessage(message, conversation.IsGroupLike);
                ComposerText = string.Empty;
                ClearComposerContext();
            }

            conversation.UpdateLastMessage(message);
            RebuildVisibleConversations();
            BannerErrorText = null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            IsUploading = false;
            UploadStatusText = null;
        }
    }

    /// <summary>Вложения, которые скачиваются прямо сейчас — второй клик не дублирует запрос.</summary>
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);

    /// <summary>Чип вложения нажат: скачиваем в temp и открываем ассоциацией ОС.</summary>
    private Task OpenAttachmentAsync(
        ChatMessageViewModel message,
        ChatAttachmentItemViewModel item) =>
        DownloadAndOpenAttachmentAsync(message.Id, item.Model, item.FileName);

    /// <summary>
    /// Общий путь открытия вложения: чип в пузыре и плитка медиагалереи —
    /// скачивание в temp (с дедупом) + запуск ассоциацией ОС.
    /// </summary>
    private async Task DownloadAndOpenAttachmentAsync(
        string? messageId,
        HubChatAttachment model,
        string displayName)
    {
        var attachmentId = model.Id;
        if (string.IsNullOrEmpty(messageId) || string.IsNullOrEmpty(attachmentId))
        {
            return;
        }

        var downloadKey = messageId + ":" + attachmentId;
        if (!_attachmentDownloadsInFlight.Add(downloadKey))
        {
            // Уже качается — второй FileStream на том же target дал бы «файл занят».
            return;
        }

        try
        {
            if (AttachmentSaver is not null)
            {
                await AttachmentSaver(model, messageId);
                return;
            }

            var directory = Path.Combine(
                Path.GetTempPath(), "hub-desktop", "attachments");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                displayName.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            var target = Path.Combine(directory, $"{messageId}-{attachmentId}-{safeName}");

            if (!File.Exists(target) || new FileInfo(target).Length != model.EffectiveSize)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadChatAttachmentAsync(
                    messageId, attachmentId, destination, CancellationToken.None);
                if (!string.IsNullOrWhiteSpace(downloadedName)
                    && !string.Equals(downloadedName, safeName, StringComparison.OrdinalIgnoreCase))
                {
                    // Сервер знает имя файла точнее — переименовываем локальную копию.
                    var renamed = Path.Combine(directory, $"{messageId}-{attachmentId}-{downloadedName}");
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
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    private static string GuessMimeType(string? extension) => extension?.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
        ".mp4" => "video/mp4",
        ".mov" => "video/quicktime",
        ".webm" => "video/webm",
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".ogg" => "audio/ogg",
        ".pdf" => "application/pdf",
        ".doc" => "application/msword",
        ".docx" => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls" => "application/vnd.ms-excel",
        ".xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".zip" => "application/zip",
        ".txt" => "text/plain",
        ".csv" => "text/csv",
        _ => "application/octet-stream",
    };

    /// <summary>Append/merge сообщения в ленту: дедуп по Id и ClientMessageId, порядок по CreatedAt.</summary>
    private bool InsertMessage(HubChatMessage message, bool isGroupConversation)
    {
        message = NormalizePollBody(message);
        for (var i = 0; i < Messages.Count; i++)
        {
            var existing = Messages[i];
            var sameId = !string.IsNullOrEmpty(message.Id) && existing.Id == message.Id;
            var sameClient = !string.IsNullOrEmpty(message.ClientMessageId)
                && existing.ClientMessageId == message.ClientMessageId;
            if (sameId || sameClient)
            {
                existing.Update(message);
                return false;
            }
        }

        var index = Messages.Count;
        var created = message.CreatedAt ?? DateTimeOffset.MinValue;
        while (index > 0 && Messages[index - 1].CreatedAt > created)
        {
            index--;
        }

        Messages.Insert(index, CreateMessageViewModel(message, isGroupConversation));
        return true;
    }

    /// <summary>Пузырь с провайдерами действий — пункты меню вызывают API через VM.</summary>
    private ChatMessageViewModel CreateMessageViewModel(
        HubChatMessage message,
        bool isGroupConversation) =>
        new(NormalizePollBody(message), isGroupConversation)
        {
            ReactionHandler = ToggleReactionAsync,
            PinHandler = ToggleMessagePinAsync,
            AttachmentHandler = OpenAttachmentAsync,
            LinkPreviewLoader = FetchLinkPreviewCachedAsync,
            LinkPreviewHandler = OpenLinkPreviewAsync,
            PollVoteHandler = VotePollAsync,
            PollCloseHandler = ClosePollAsync,
            IsPinned = message.Id is not null && _pinnedMessageIds.Contains(message.Id),
        };

    /// <summary>
    /// Строка диалога: меню вызывает PATCH settings, GET export и POST leave для групп.
    /// </summary>
    private ConversationItemViewModel CreateConversationViewModel(HubChatConversation conversation) =>
        new(conversation)
        {
            SettingsHandler = ToggleConversationSettingAsync,
            LeaveHandler = LeaveGroupConversationAsync,
            ExportHandler = ExportConversationAsync,
        };

    /// <summary>
    /// Экспорт истории диалога (GET export): формат выбирает SaveFileDialog по FilterIndex,
    /// тело ответа стримится в файл на диск — как AttachmentSaver для вложений.
    /// </summary>
    private async Task ExportConversationAsync(ConversationItemViewModel conversation)
    {
        if (_isExportingConversation)
        {
            return;
        }

        var picker = ExportTargetPicker;
        if (picker is null)
        {
            return;
        }

        var target = picker(conversation);
        if (target is null || string.IsNullOrWhiteSpace(target.Path))
        {
            return;
        }

        var format = string.Equals(target.Format, "json", StringComparison.OrdinalIgnoreCase)
            ? "json"
            : "txt";
        _isExportingConversation = true;
        RaiseCommandStates();
        BannerErrorText = null;
        UploadStatusText = "Экспортирую историю…";
        try
        {
            HubChatExportResult result;
            await using (var file = new FileStream(
                             target.Path, FileMode.Create, FileAccess.Write,
                             FileShare.Read, 81920, useAsync: true))
            {
                result = await _api.ExportChatConversationAsync(
                    conversation.Id, format, file, CancellationToken.None);
            }

            RunOnUi(() => UploadStatusText = result.Truncated
                ? $"Экспортировано {result.MessagesCount} сообщений (усечено лимитом сервера)."
                : $"Экспортировано {result.MessagesCount} сообщений.");
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                BannerErrorText = TasksViewModel.DescribeError(exception);
                UploadStatusText = null;
            });
        }
        finally
        {
            _isExportingConversation = false;
            RaiseCommandStates();
        }
    }

    /// <summary>Pin/mute/archive диалога через PATCH settings; ответ мержится в строку.</summary>
    private async Task ToggleConversationSettingAsync(ConversationItemViewModel item, string flag)
    {
        try
        {
            var updated = await _api.UpdateChatConversationSettingsAsync(
                item.Id,
                flag == "pin" ? !item.IsPinned : null,
                flag == "mute" ? !item.IsMuted : null,
                flag == "archive" ? !item.IsArchived : null,
                mutedUntil: null,
                CancellationToken.None);
            RunOnUi(() =>
            {
                var live = FindConversation(item.Id) ?? item;
                live.Update(updated);
                ApplyConversationPresence(live, updated);
                RebuildVisibleConversations();
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    private ChatMessageViewModel? FindMessage(string id) =>
        Messages.FirstOrDefault(m => string.Equals(m.Id, id, StringComparison.Ordinal));

    private ConversationItemViewModel? FindConversation(string? conversationId) =>
        conversationId is null
            ? null
            : _allConversations.FirstOrDefault(
                c => string.Equals(c.Id, conversationId, StringComparison.OrdinalIgnoreCase));

    private async Task MarkReadSafelyAsync(string conversationId, string messageId)
    {
        try
        {
            await _api.MarkChatConversationReadAsync(
                conversationId, messageId, CancellationToken.None);
        }
        catch
        {
            // Отметка о прочтении best-effort: ошибки игнорируем.
        }
    }

    // ---- «Печатает…» ----

    /// <summary>
    /// Исходящий typing из composer'а: непустой текст шлёт started не чаще раза в
    /// TypingSendThrottle (сервер дополнительно rate-limit'ит started), опустевший —
    /// stopped, если started уходил. Троттлинг привязан к диалогу-получателю.
    /// </summary>
    private void NotifyTypingState()
    {
        var conversationId = _selectedConversation?.Id;
        if (string.IsNullOrEmpty(_composerText) || conversationId is null)
        {
            StopTypingIfSent();
            return;
        }

        var now = DateTime.UtcNow;
        if (string.Equals(_typingSentToConversationId, conversationId, StringComparison.Ordinal)
            && now - _lastTypingSentAt < TypingSendThrottle)
        {
            return;
        }

        _typingSentToConversationId = conversationId;
        _lastTypingSentAt = now;
        _realtime?.SendTyping(conversationId, isTyping: true);
    }

    /// <summary>Если диалогу уходил typing-started — шлём stopped и сбрасываем метку.</summary>
    private void StopTypingIfSent()
    {
        var conversationId = _typingSentToConversationId;
        if (conversationId is null)
        {
            return;
        }

        _typingSentToConversationId = null;
        _lastTypingSentAt = DateTime.MinValue;
        _realtime?.SendTyping(conversationId, isTyping: false);
    }

    /// <summary>Прятать входящий индикатор и гасить висящий таймер авто-сброса.</summary>
    private void ClearTypingIndicator()
    {
        _typingMarker++;
        TypingText = null;
    }

    /// <summary>
    /// chat.typing.started: conversation_id живёт на уровне конверта (в payload его нет),
    /// payload — {user_id, sender_name, is_typing, expires_in_ms}. Индикатор снимает
    /// stopped либо таймер по expires_in_ms — что раньше.
    /// </summary>
    private void HandleTypingStarted(HubChatRealtimeEvent realtimeEvent)
    {
        if (!IsRelevantTypingEvent(realtimeEvent))
        {
            return;
        }

        var senderName = GetStringProperty(realtimeEvent.Payload, "sender_name");
        TypingText = string.IsNullOrWhiteSpace(senderName)
            ? "Собеседник печатает…"
            : $"{senderName.Trim()} печатает…";

        var expiresMs = realtimeEvent.Payload.TryGetProperty("expires_in_ms", out var expiresElement)
            && expiresElement.ValueKind == JsonValueKind.Number
            && expiresElement.TryGetInt32(out var parsedMs)
            && parsedMs > 0
                ? parsedMs
                : TypingDefaultExpiresMs;
        var marker = ++_typingMarker;
        _ = ClearTypingAfterAsync(marker, expiresMs);
    }

    /// <summary>chat.typing.stopped: тот же конвертный фильтр, индикатор гасим сразу.</summary>
    private void HandleTypingStopped(HubChatRealtimeEvent realtimeEvent)
    {
        if (!IsRelevantTypingEvent(realtimeEvent))
        {
            return;
        }

        ClearTypingIndicator();
    }

    /// <summary>
    /// Общий фильтр typing-событий: conversation_id конверта (fallback — из payload)
    /// обязан совпадать с открытым диалогом; кадры с нашим user_id пропускаем.
    /// </summary>
    private bool IsRelevantTypingEvent(HubChatRealtimeEvent realtimeEvent)
    {
        var conversationId = realtimeEvent.ConversationId
            ?? GetStringProperty(realtimeEvent.Payload, "conversation_id");
        if (_selectedConversation is null
            || !string.Equals(
                _selectedConversation.Id, conversationId, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var currentUserId = _api.CurrentSession?.UserId;
        return currentUserId is null
            || !realtimeEvent.Payload.TryGetProperty("user_id", out var userIdElement)
            || userIdElement.ValueKind != JsonValueKind.Number
            || !userIdElement.TryGetInt64(out var senderUserId)
            || senderUserId != currentUserId.Value;
    }

    /// <summary>Авто-сброс «печатает…» по expires_in_ms: новый started/stopped гасит старый таймер.</summary>
    private async Task ClearTypingAfterAsync(int marker, int delayMs)
    {
        await Task.Delay(Math.Max(delayMs, 0));
        RunOnUi(() =>
        {
            if (_typingMarker == marker)
            {
                TypingText = null;
            }
        });
    }

    // ---- Realtime ----

    private async Task StartRealtimeSafelyAsync()
    {
        var realtime = _realtime ??= new HubChatRealtimeClient(_api);
        if (!_realtimeSubscribed)
        {
            realtime.EventReceived += Realtime_EventReceived;
            realtime.StateChanged += Realtime_StateChanged;
            _realtimeSubscribed = true;
        }

        try
        {
            await realtime.StartAsync();
            ApplyConnectionState(realtime.State);
            // Лениво созданный клиент не знает выбранный диалог — подписываем явно.
            realtime.WatchConversation(_selectedConversation?.Id);
            realtime.WatchPresence(_presenceWatchUserIds);
        }
        catch
        {
            ApplyConnectionState(HubChatRealtimeState.Disconnected);
        }
    }

    private static async Task StopRealtimeSafelyAsync(IHubChatRealtime realtime, bool dispose)
    {
        try
        {
            await realtime.StopAsync();
        }
        catch
        {
        }

        if (dispose)
        {
            try
            {
                await realtime.DisposeAsync();
            }
            catch
            {
            }
        }
    }

    private void Realtime_EventReceived(object? sender, HubChatRealtimeEvent realtimeEvent) =>
        RunOnUi(() => HandleRealtimeEvent(realtimeEvent));

    private void Realtime_StateChanged(object? sender, HubChatRealtimeState state) =>
        RunOnUi(() => ApplyConnectionState(state));

    private void ApplyConnectionState(HubChatRealtimeState state)
    {
        ConnectionStatusText = state switch
        {
            HubChatRealtimeState.Connected => "в сети",
            HubChatRealtimeState.Connecting or HubChatRealtimeState.Reconnecting =>
                "переподключение…",
            _ => "офлайн",
        };
        ConnectionTone = state switch
        {
            HubChatRealtimeState.Connected => HubStatusTone.Success,
            HubChatRealtimeState.Connecting or HubChatRealtimeState.Reconnecting =>
                HubStatusTone.Warning,
            _ => HubStatusTone.Muted,
        };
    }

    private void HandleRealtimeEvent(HubChatRealtimeEvent realtimeEvent)
    {
        switch (realtimeEvent.Type)
        {
            case "chat.message_received":
            case "chat.message.created":
                HandleIncomingMessage(realtimeEvent.Payload);
                break;
            case "chat.message.updated":
                HandleMessageUpdated(realtimeEvent.Payload);
                break;
            case "chat.message.reaction":
                HandleMessageReaction(realtimeEvent.Payload);
                break;
            case "chat.message.deleted":
                HandleMessageDeleted(realtimeEvent.Payload);
                break;
            case "chat.message.read":
                HandleMessageRead(realtimeEvent.Payload);
                break;
            case "chat.typing.started":
                HandleTypingStarted(realtimeEvent);
                break;
            case "chat.typing.stopped":
                HandleTypingStopped(realtimeEvent);
                break;
            case "chat.conversation.removed":
                HandleConversationRemoved(realtimeEvent.Payload);
                break;
            case "chat.presence.updated":
                HandlePresenceUpdated(realtimeEvent.Payload);
                break;
            case "chat.conversation.updated":
                ScheduleConversationsReload();
                // reason=pinned_message — плашка закрепов перевалилась; GET дешёвый.
                if (_selectedConversation is { } pinnedConversation)
                {
                    _ = LoadPinnedMessagesSafelyAsync(
                        pinnedConversation, CancellationToken.None);
                }

                break;
            case "chat.snapshot":
            case "chat.unread.summary":
                ScheduleConversationsReload();
                break;
            default:
                break;
        }
    }

    /// <summary>Входящее сообщение: в открытый диалог — append+read, иначе unread++.</summary>
    private void HandleIncomingMessage(JsonElement payload)
    {
        var message = DeserializeMessage(payload);
        if (message is null || string.IsNullOrEmpty(message.ConversationId))
        {
            return;
        }

        // JSON-тело опроса заменяем вопросом — превью диалога тоже берёт Body.
        message = NormalizePollBody(message);

        var item = FindConversation(message.ConversationId);
        if (item is null)
        {
            // Диалог ещё не в списке — догрузим списком по debounce-ветке.
            ScheduleConversationsReload();
            return;
        }

        item.UpdateLastMessage(message);
        var isSelected = _selectedConversation is { } selected
            && string.Equals(selected.Id, message.ConversationId, StringComparison.OrdinalIgnoreCase);
        if (isSelected)
        {
            var inserted = InsertMessage(message, item.IsGroupLike);
            item.ClearUnread();
            if (inserted && !string.IsNullOrEmpty(message.Id))
            {
                _ = MarkReadSafelyAsync(item.Id, message.Id);
            }
        }
        else if (!message.IsOwn)
        {
            item.IncrementUnread();
        }

        RebuildVisibleConversations();

        // Заглушенный диалог не поднимает toast (unread-бейдж остаётся);
        // mute с истёкшим muted_until уже не глушит — как в web.
        if (!message.IsOwn && !message.IsDeleted && !item.IsEffectivelyMuted)
        {
            NotificationRequested?.Invoke(this, CreateNotification(item, message, isSelected));
        }
    }

    /// <summary>Текст toast'а: превью диалога; в групповых — с именем отправителя.</summary>
    private static ChatMessageNotification CreateNotification(
        ConversationItemViewModel conversation,
        HubChatMessage message,
        bool isSelected)
    {
        var preview = conversation.Preview ?? string.Empty;
        var body = conversation.IsGroupLike
            && (message.Sender?.FullName ?? message.Sender?.Username) is { } sender
                ? $"{sender}: {preview}"
                : preview;
        return new ChatMessageNotification(
            conversation.Id,
            conversation.Title,
            body,
            string.IsNullOrEmpty(message.Id) ? null : message.Id,
            isSelected);
    }

    private void HandleMessageUpdated(JsonElement payload)
    {
        var element = ExtractMessageElement(payload);
        if (element is null)
        {
            return;
        }

        var id = GetStringProperty(element.Value, "id");
        if (string.IsNullOrEmpty(id))
        {
            return;
        }

        var message = FindMessage(id);
        if (message is null)
        {
            return;
        }

        var body = GetStringProperty(element.Value, "body");
        var poll = TryGetPoll(element.Value);
        if (string.Equals(GetStringProperty(element.Value, "kind"), "poll", StringComparison.Ordinal))
        {
            // kind="poll": body — канонический JSON; текстом показываем вопрос.
            body = poll?.Question is { Length: > 0 } question
                ? question
                : TryExtractPollQuestion(body) ?? body;
        }

        message.ApplyEdit(body, GetDateTimeOffsetProperty(element.Value, "edited_at"));
        if (TryGetReactions(element.Value) is { } reactions)
        {
            message.ApplyReactions(reactions);
        }

        // Голос/закрытие чужого опроса — агрегированное состояние целиком.
        if (poll is not null)
        {
            message.ApplyPoll(poll);
        }
    }

    /// <summary>Реакции из payload обновления — часть сообщений приходит без них.</summary>
    private static List<HubChatReaction>? TryGetReactions(JsonElement element)
    {
        if (!element.TryGetProperty("reactions", out var node)
            || node.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<List<HubChatReaction>>(
                node.GetRawText(), JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>chat.message.reaction: {message_id, reactions[]} — перерисовываем строку реакций.</summary>
    private void HandleMessageReaction(JsonElement payload)
    {
        var element = ExtractMessageElement(payload);
        if (element is null)
        {
            return;
        }

        var id = GetStringProperty(element.Value, "message_id")
            ?? GetStringProperty(element.Value, "id");
        if (string.IsNullOrEmpty(id))
        {
            return;
        }

        // Пустой массив — легитимное «все реакции сняты»; отсутствие поля — пропуск.
        if (TryGetReactions(element.Value) is { } reactions)
        {
            FindMessage(id)?.ApplyReactions(reactions);
        }
    }

    private void HandleMessageDeleted(JsonElement payload)
    {
        var element = ExtractMessageElement(payload);
        if (element is null)
        {
            return;
        }

        var id = GetStringProperty(element.Value, "message_id")
            ?? GetStringProperty(element.Value, "id");
        if (!string.IsNullOrEmpty(id))
        {
            FindMessage(id)?.MarkDeleted();
        }
    }

    /// <summary>chat.message.read: {message_id, read_by_count, delivery_status} — галочки ✓✓.</summary>
    private void HandleMessageRead(JsonElement payload)
    {
        var id = GetStringProperty(payload, "message_id");
        if (string.IsNullOrEmpty(id))
        {
            return;
        }

        var readByCount = payload.TryGetProperty("read_by_count", out var count)
            && count.ValueKind == JsonValueKind.Number
            && count.TryGetInt32(out var parsed)
                ? parsed
                : 0;
        FindMessage(id)?.ApplyDelivery(readByCount, GetStringProperty(payload, "delivery_status"));
    }

    /// <summary>chat.conversation.removed: {conversation_id} — диалог удалён/исключение из группы.</summary>
    private void HandleConversationRemoved(JsonElement payload)
    {
        var conversationId = GetStringProperty(payload, "conversation_id")
            ?? GetStringProperty(payload, "id");
        if (string.IsNullOrEmpty(conversationId))
        {
            return;
        }

        var removed = _allConversations.FirstOrDefault(
            c => string.Equals(c.Id, conversationId, StringComparison.OrdinalIgnoreCase));
        if (removed is null)
        {
            return;
        }

        RemoveConversationLocally(removed);
    }

    // ---- Presence (онлайн-статусы собеседников) ----

    /// <summary>
    /// Набор user_id собеседников direct-диалогов → chat.watch_presence.
    /// Дедуп по отсортированному набору: кадр уходит только при реальном
    /// изменении; на (пере)коннекте клиент повторяет его из handshake.
    /// </summary>
    private void RefreshPresenceWatch()
    {
        var userIds = _allConversations
            .Select(c => (long)(c.DirectPeer?.Id ?? 0))
            .Where(id => id > 0)
            .Distinct()
            .OrderBy(id => id)
            .ToArray();
        if (userIds.SequenceEqual(_presenceWatchUserIds))
        {
            return;
        }

        _presenceWatchUserIds = userIds;
        _realtime?.WatchPresence(userIds);
    }

    /// <summary>
    /// Стартовый presence из DTO диалога (direct_peer.presence): складывает в
    /// карту последних статусов и применяет к строке списка. DTO без presence
    /// не гасит статус от chat.presence.updated — применяется карта.
    /// </summary>
    private void ApplyConversationPresence(
        ConversationItemViewModel item,
        HubChatConversation conversation)
    {
        var peerId = (long)(conversation.DirectPeer?.Id ?? 0);
        if (conversation.DirectPeer?.Presence is { } dtoPresence && peerId > 0)
        {
            _presenceByUserId[peerId] = dtoPresence;
        }

        if (peerId > 0 && _presenceByUserId.TryGetValue(peerId, out var known))
        {
            item.ApplyPresence(known);
        }
    }

    /// <summary>
    /// chat.presence.updated: {user_id, presence:{is_online,last_seen_at,status_text}} —
    /// приходит подписчикам watch_presence при смене статуса пользователя.
    /// </summary>
    private void HandlePresenceUpdated(JsonElement payload)
    {
        if (!TryGetInt64Property(payload, "user_id", out var userId) || userId <= 0)
        {
            return;
        }

        if (!payload.TryGetProperty("presence", out var presenceElement)
            || presenceElement.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        HubChatPresence? presence;
        try
        {
            presence = JsonSerializer.Deserialize<HubChatPresence>(
                presenceElement.GetRawText(), JsonOptions);
        }
        catch (JsonException)
        {
            return;
        }

        if (presence is null)
        {
            return;
        }

        _presenceByUserId[userId] = presence;
        foreach (var item in _allConversations)
        {
            if (item.DirectPeer?.Id == userId)
            {
                item.ApplyPresence(presence);
            }
        }
    }

    /// <summary>Debounce 500мс на массовые обновления — перечитываем список диалогов.</summary>
    private void ScheduleConversationsReload()
    {
        _conversationsReloadCancellation?.Cancel();
        var cancellation = _conversationsReloadCancellation = new CancellationTokenSource();
        _ = ReloadConversationsDebouncedAsync(cancellation.Token);
    }

    private async Task ReloadConversationsDebouncedAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(ConversationsReloadDebounce, cancellationToken);
            var pages = await FetchConversationPagesAsync(cancellationToken);
            RunOnUi(() => ApplyConversations(pages, allowRemoval: true));
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Фоновое обновление списка best-effort — ошибки молчим.
        }
    }

    /// <summary>
    /// Серверный поиск диалогов (q): покрывает и не загруженные страницы.
    /// Пустая строка — возврат к локальному списку; ошибка — локальный fallback.
    /// </summary>
    private void ScheduleConversationSearch(string searchText)
    {
        _conversationSearchCancellation?.Cancel();
        if (string.IsNullOrWhiteSpace(searchText))
        {
            _serverSearchResults = null;
            _conversationSearchCancellation = null;
            RebuildVisibleConversations();
            return;
        }

        var cancellation = _conversationSearchCancellation = new CancellationTokenSource();
        _ = SearchConversationsServerAsync(searchText.Trim(), cancellation.Token);
    }

    private async Task SearchConversationsServerAsync(
        string query,
        CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(UserSearchDebounce, cancellationToken);
            var page = await _api.GetChatConversationsAsync(
                null,
                ConversationsPageLimit,
                query,
                cancellationToken);
            RunOnUi(() =>
            {
                // Пользователь уже стёр/сменил запрос — результат устарел.
                if (!string.Equals(_searchText.Trim(), query, StringComparison.Ordinal))
                {
                    return;
                }

                _serverSearchResults = (page.Items ?? [])
                    .Where(dto => !string.IsNullOrEmpty(dto.Id))
                    .Select(dto => FindConversation(dto.Id) ?? CreateConversationViewModel(dto))
                    .ToList();
                RebuildVisibleConversations();
            });
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Серверный поиск best-effort: при ошибке остаётся локальный фильтр.
        }
    }

    private static JsonElement? ExtractMessageElement(JsonElement payload)
    {
        var element = payload;
        if (element.ValueKind == JsonValueKind.Object
            && element.TryGetProperty("message", out var inner)
            && inner.ValueKind == JsonValueKind.Object)
        {
            element = inner;
        }

        return element.ValueKind == JsonValueKind.Object ? element : null;
    }

    private static HubChatMessage? DeserializeMessage(JsonElement payload)
    {
        var element = ExtractMessageElement(payload);
        if (element is null)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<HubChatMessage>(
                element.Value.GetRawText(), JsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string? GetStringProperty(JsonElement element, string name) =>
        element.TryGetProperty(name, out var property) && property.ValueKind == JsonValueKind.String
            ? property.GetString()
            : null;

    private static bool TryGetInt64Property(JsonElement element, string name, out long value)
    {
        value = 0;
        return element.TryGetProperty(name, out var property)
            && property.ValueKind == JsonValueKind.Number
            && property.TryGetInt64(out value);
    }

    private static DateTimeOffset? GetDateTimeOffsetProperty(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var property))
        {
            return null;
        }

        if (property.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(
                property.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return parsed;
        }

        if (property.ValueKind == JsonValueKind.Number && property.TryGetInt64(out var unix))
        {
            return DateTimeOffset.FromUnixTimeSeconds(unix);
        }

        return null;
    }

    private void RunOnUi(Action action)
    {
        if (_syncContext is null || SynchronizationContext.Current == _syncContext)
        {
            action();
            return;
        }

        // Исключение в posted-делегате некому поймать — показываем баннер,
        // а не роняем приложение на битом realtime-событии.
        _syncContext.Post(_ =>
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                BannerErrorText = TasksViewModel.DescribeError(exception);
            }
        }, null);
    }

    private void RaiseCommandStates()
    {
        (SendCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (AttachCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (LoadOlderCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (LoadMoreConversationsCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }
}

/// <summary>Строка панели «Кто прочитал»: имя и локальное время прочтения.</summary>
public sealed class ChatReadReceiptItemViewModel
{
    public ChatReadReceiptItemViewModel(HubChatReadReceipt receipt)
    {
        DisplayName = receipt.User?.FullName
            ?? receipt.User?.Username
            ?? "Пользователь";
        var local = receipt.ReadAt?.LocalDateTime;
        ReadAtText = local is null
            ? null
            : local.Value.Date == DateTime.Now.Date
                ? local.Value.ToString("HH:mm", CultureInfo.InvariantCulture)
                : local.Value.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture);
    }

    public string DisplayName { get; }

    /// <summary>Сегодня → HH:mm, иначе dd.MM.yyyy HH:mm.</summary>
    public string? ReadAtText { get; }
}
