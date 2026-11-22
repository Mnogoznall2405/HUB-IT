using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Windows.Input;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.Voice;
using System.Windows;
// ImplicitUsings тянут System.Drawing — там тоже есть Brush/ImageSource.
using Brush = System.Windows.Media.Brush;
using ImageSource = System.Windows.Media.ImageSource;

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
    private readonly Thread _syncContextThread;
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
    private IReadOnlyList<ChatMessageViewModel>? _forwardingMessages;
    private bool _isForwarding;
    // Отдельный фильтр панели пересылки: свой список по всем диалогам,
    // чтобы поиск внутри пикера не трогал общий SearchText/sidebar.
    private string _forwardSearchText = string.Empty;
    // Подтверждение удаления (tg-modal): снапшот целей на момент клика «Удалить».
    private List<ChatMessageViewModel>? _pendingDelete;
    private bool _isDeleteConfirmOpen;
    private bool _isDeleting;
    // Драг файлов над лентой: оверлей tg-drop («Перетащите файлы…»).
    private bool _isFileDropOverlayOpen;
    // Вспышка якорного пузыря после перехода (reply/pinned/search) — маркер
    // гасит устаревшие тики таймера, как у черновиков.
    private int _highlightMarker;
    private bool _isSelectionMode;
    private readonly List<ChatMessageViewModel> _selectedMessages = [];
    private int _scrollToEndSignal;
    // Просмотрщик медиа (UI-026): плоский список image/video/audio-вложений —
    // из ленты сообщений или из галереи (тогда догрузка страниц при листании).
    private readonly List<MediaViewerEntry> _mediaViewerItems = [];
    private int _mediaViewerIndex = -1;
    private int _mediaViewerLoadMarker;
    private bool _mediaViewerGallerySource;
    private bool _isMediaViewerOpen;
    private bool _isMediaViewerLoading;
    private ImageSource? _mediaViewerImage;
    private string? _mediaViewerMediaSource;
    private string? _mediaViewerPlaybackKind;
    private string? _mediaViewerUnsupportedText;
    private string? _mediaViewerStatusText;
    // «Печатает…» по диалогам: маркер таймера на conversation_id —
    // новый started/stopped гасит висящее автоснятие прежнего кадра.
    private readonly Dictionary<string, int> _conversationTypingMarkers = new(StringComparer.Ordinal);
    // Клиентские черновики (как web chatDraftsStorage): память в _drafts,
    // диск через INativeChatDraftStore; дебаунс записи ~320 мс.
    private readonly INativeChatDraftStore? _injectedDraftStore;
    private readonly Dictionary<string, string> _drafts = new(StringComparer.Ordinal);
    private INativeChatDraftStore? _draftStore;
    private long? _draftUserId;
    private bool _draftsInitialized;
    private int _draftSyncMarker;
    private bool _suppressDraftSync;
    // Снапшот черновика на время правки сообщения: пока в composer тело edit,
    // в сторадж/строку идёт исходный черновик (см. editDraftSnapshotRef в web).
    private (string ConversationId, string Text)? _editDraftSnapshot;
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

    // «Отправить позже»: серверный флаг из GET /chat/config (раз на загрузку,
    // до 3 попыток как в web), список отложенных, панель и редактор времени.
    private bool _chatConfigRequested;
    private bool _scheduledMessagesEnabled;
    private object _scheduledScope = new();
    private bool _isScheduledPanelOpen;
    private bool _isLoadingScheduled;
    private bool _isScheduledBusy;
    private string? _scheduledErrorText;
    private bool _isScheduleEditorOpen;
    private ChatScheduledMessageItemViewModel? _editingScheduled;
    private string _scheduleDraftBody = string.Empty;
    private DateTime? _scheduleDraftDate;
    private string _scheduleDraftTime = string.Empty;
    private string? _scheduleDraftErrorText;
    private string? _scheduleDraftHint;
    private ChatScheduledMessageItemViewModel? _armedScheduledCancel;

    // ---- Модерация и настройки группы ----
    // Гейты вычисляются только из серверной viewer_member_role последнего
    // detail-ответа (fail-closed: без роли управление скрыто).
    private bool _canManageGroupOwners;
    private bool _isGroupSettingsOpen;
    private ConversationItemViewModel? _groupSettingsConversation;
    private string _groupTitleDraft = string.Empty;
    private string _groupDescriptionDraft = string.Empty;
    private bool _hasGroupAvatar;
    private string? _groupInviteLink;
    private bool _groupDeleteArmed;
    private bool _inviteRevokeArmed;
    private bool _isGroupActionBusy;
    private int _joinRequestsOpenCount;
    private int _reportsOpenCount;

    // Панель «Заявки на вступление».
    private bool _isJoinRequestsPanelOpen;
    private bool _isLoadingJoinRequests;
    private bool _isJoinApprovalRequired;
    private bool _isJoinApprovalBusy;
    private bool _suppressJoinApprovalSync;

    // Панель «Жалобы».
    private bool _isReportsPanelOpen;
    private bool _isLoadingReports;

    // Диалог «Пожаловаться на сообщение».
    private bool _isReportDialogOpen;
    private ChatMessageViewModel? _reportTarget;
    private string _reportReason = "spam";
    private string _reportComment = string.Empty;
    private bool _isSubmittingReport;

    // Панель «Поделиться задачей».
    private bool _isTaskShareOpen;
    private string _taskShareSearchText = string.Empty;
    private bool _isTaskShareLoading;
    private CancellationTokenSource? _taskShareCancellation;

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
    // входящий индикатор гасит маркер-таймер per conversation_id.
    // Поля — только из UI-потока.
    private string? _typingSentToConversationId;
    private DateTime _lastTypingSentAt = DateTime.MinValue;
    private string? _typingText;

    // Presence: последний известный статус по user_id (DTO + chat.presence.updated)
    // и текущий набор chat.watch_presence — оба живут только на UI-потоке.
    private readonly Dictionary<long, HubChatPresence> _presenceByUserId = [];
    private long[] _presenceWatchUserIds = [];

    // ---- Папки диалогов (parity web ChatFolderTabs/chatFolderUtils) ----
    // «Все» — виртуальная вкладка tg-main (web ALL_CHAT_FOLDER_TAB): первой в
    // полосе, показывает все не-архивные диалоги; не серверная папка.
    // System-вкладки Личные/Беседы/Задачи + пользовательские папки сервера;
    // членство — карта folder_id → conversation_ids (serverMap ∪ folder.conversation_ids).
    internal const string AllFolderKey = "all";
    internal const string PersonalFolderKey = "personal";
    internal const string GroupsFolderKey = "groups";
    internal const string TasksFolderKey = "tasks";

    private static readonly (string Key, string Title)[] SystemFolderTabs =
    [
        (AllFolderKey, "Все"),
        (PersonalFolderKey, "Личные"),
        (GroupsFolderKey, "Беседы"),
        (TasksFolderKey, "Задачи"),
    ];

    // Вкладка по умолчанию — «Все» (как «All chats» верхним пунктом в tg-main).
    private string _activeFolderKey = AllFolderKey;
    private readonly ObservableCollection<ChatFolderTabViewModel> _customFolderTabs = [];
    private readonly Dictionary<string, List<string>> _conversationIdsByFolder = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _serverFolderUnreadCounts = new(StringComparer.Ordinal);
    private bool _isFolderManagerOpen;
    private bool _isFolderBusy;
    private string _newFolderName = string.Empty;
    private string? _folderErrorText;
    private ChatFolderTabViewModel? _renamingFolder;
    private string _renamingFolderName = string.Empty;
    private bool _isFolderMembershipOpen;
    private ChatFolderTabViewModel? _membershipFolder;

    // ---- Стикеры (панель composer'а, parity web TelegramStickersTab) ----
    private bool _isStickerPanelOpen;
    private bool _isLoadingStickers;
    private bool _stickersLoaded;
    private string? _stickerErrorText;
    private bool _isSendingSticker;
    private string _stickerImportSource = string.Empty;
    private bool _isImportingStickerPack;
    private ChatStickerPackViewModel? _selectedStickerPack;
    private bool _isEmojiTab;

    // ---- Правая панель «Информация» (клик по шапке, tdesktop profile) ----
    private bool _isPeerCardOpen;
    private bool _isCompactInfoOverlay;
    private ConversationItemViewModel? _peerPanelConversation;
    private string? _peerMembersTitleText;
    private string? _peerDescriptionText;
    private const int PeerPanelPreviewLimit = 4;

    // ---- @mention-автокомплит composer'а (parity ChatComposer.jsx) ----
    private const int MentionQueryLimit = 32;
    private const int MentionResultLimit = 8;
    private readonly List<ChatGroupMemberItemViewModel> _mentionSource = [];
    private string? _mentionConversationId;
    private string? _mentionQuery;
    private int _mentionStart;
    private int _mentionEnd;
    private bool _isMentionPopupOpen;
    private bool _isLoadingMentions;
    private ChatGroupMemberItemViewModel? _selectedMentionSuggestion;

    // ---- ИИ-ассистент (/chat/ai/*) ----
    private static readonly TimeSpan AiStatusPollInterval = TimeSpan.FromSeconds(2);
    private bool _isAiPanelOpen;
    private bool _isLoadingAiBots;
    private bool _aiBotsLoaded;
    private string? _aiErrorText;
    private bool _isAiActionBusy;
    private HubChatAiStatus? _aiStatus;
    private CancellationTokenSource? _aiStatusPolling;

    private ConversationItemViewModel? _selectedConversation;
    private string _searchText = string.Empty;
    private string _composerText = string.Empty;
    private bool _isLoading;
    private bool _isLoadingMessages;
    private bool _isLoadingOlder;
    private bool _hasOlderHistoryError;
    private bool _isSending;
    private bool _isUploading;
    private string? _uploadStatusText;
    private string? _attachmentCaption;
    private bool _hasOlder;
    private string? _bannerErrorText;
    private string? _historyErrorText;
    private string _connectionStatusText = "офлайн";
    private string _connectionTone = HubStatusTone.Muted;

    public ChatViewModel(IHubApiClient api)
        : this(api, realtime: null)
    {
    }

    public ChatViewModel(IHubApiClient api, IHubChatRealtime? realtime)
        : this(api, realtime, draftStore: null)
    {
    }

    public ChatViewModel(
        IHubApiClient api,
        IHubChatRealtime? realtime,
        INativeChatDraftStore? draftStore)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _imageLoader = new AuthImageLoader(api);
        _syncContext = SynchronizationContext.Current;
        _syncContextThread = Thread.CurrentThread;
        _injectedRealtime = realtime;
        _realtime = realtime;
        _injectedDraftStore = draftStore;
        _draftStore = draftStore;

        Messages.CollectionChanged += (_, _) => OnPropertyChanged(nameof(IsMessagesEmpty));

        SendCommand = new NativeAsyncCommand(
            (_, ct) => SendAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSend);
        AttachCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                // «media»/«document» из меню скрепки: фильтр диалога разделяет
                // выбор медиа и документов (UI-027), пайплайн дальше общий.
                var paths = AttachmentPicker?.Invoke(parameter as string) ?? [];
                await AttachFilesAsync(paths, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanAttach);
        // Пути из ОС-драга/вставки картинки — та же очередь подтверждения,
        // что у «скрепки»: загрузка стартует только из модала (UI-027).
        AttachDroppedFilesCommand = new NativeAsyncCommand(
            (parameter, ct) => AttachFilesAsync(NormalizeDroppedPaths(parameter), ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => NormalizeDroppedPaths(parameter).Count > 0 && CanAttach);
        ConfirmAttachmentsCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmAttachmentsAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => PendingAttachments.Count > 0 && !IsUploading && !IsSending);
        RemovePendingAttachmentCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is PendingAttachmentItemViewModel item)
            {
                PendingAttachments.Remove(item);
                RaisePendingAttachmentChanged();
                if (PendingAttachments.Count == 0)
                {
                    ClearPendingAttachments();
                }
            }
        });
        CancelAttachmentsCommand = new NativeRelayCommand(ClearPendingAttachments);
        LoadOlderCommand = new NativeAsyncCommand(
            (_, ct) => LoadOlderAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasOlder && !IsLoadingOlder && HasConversation);
        RetryCommand = new NativeAsyncCommand(
            (_, ct) => HasHistoryError && SelectedConversation is { } retryConversation
                ? LoadMessagesSafelyAsync(retryConversation)
                : LoadConversationsCoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        // Повтор именно истории текущего диалога — для панели ошибки в ленте;
        // баннерный RetryCommand сам направляется сюда, пока висит HasHistoryError.
        RetryHistoryCommand = new NativeAsyncCommand(
            (_, _) => SelectedConversation is { } conversation
                ? LoadMessagesSafelyAsync(conversation)
                : Task.CompletedTask,
            ex => HistoryErrorText = TasksViewModel.DescribeError(ex),
            _ => HasConversation && !IsLoadingMessages);
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        BeginReplyCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanReply: true } message)
            {
                // Очищает и edit со снапшотом черновика, если правка была активна.
                ClearComposerContext();
                ReplyingTo = message;
            }
        });
        BeginEditCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanEditOrDelete: true } message)
            {
                ReplyingTo = null;
                // Черновик прячем в снапшот ДО подмены composer телом правки —
                // тело edit не должно затереть черновик ни в памяти, ни на диске.
                if (_selectedConversation is { } editConversation)
                {
                    _editDraftSnapshot = (editConversation.Id, _composerText);
                }

                EditingMessage = message;
                ComposerText = message.EditableBody ?? string.Empty;
            }
        });
        CancelComposerContextCommand = new NativeRelayCommand(ClearComposerContext);
        // Telegram: «Удалить» из меню пузыря спрашивает подтверждение — открываем
        // модал «Удалить сообщение?»; сам DELETE уходит из ConfirmDeleteCommand.
        DeleteMessageCommand = new NativeAsyncCommand(
            (parameter, _) =>
            {
                if (parameter is ChatMessageViewModel { CanEditOrDelete: true } message)
                {
                    OpenDeleteConfirm([message]);
                }

                return Task.CompletedTask;
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ConfirmDeleteCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmDeleteAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => _pendingDelete is { Count: > 0 } && !IsDeleting);
        CancelDeleteCommand = new NativeRelayCommand(CloseDeleteConfirm);
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
                _forwardingMessages = null;
                ForwardingMessage = message;
                _forwardSearchText = string.Empty;
                RebuildForwardTargets();
                IsForwardPanelOpen = true;
            }
        });
        PickForwardTargetCommand = new NativeAsyncCommand(
            (parameter, ct) => ForwardMessageToAsync(parameter as ConversationItemViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ConversationItemViewModel && !IsForwarding);
        CloseForwardPanelCommand = new NativeRelayCommand(CloseForwardPanel);
        // Режим мультивыбора сообщений (Telegram: «Выделить» в меню пузыря).
        BeginSelectCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { IsSystem: false } message)
            {
                IsSelectionMode = true;
                if (!message.IsSelected)
                {
                    ToggleMessageSelection(message);
                }
            }
        });
        ToggleMessageSelectionCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { IsSystem: false } message)
            {
                ToggleMessageSelection(message);
            }
        });
        ExitSelectionCommand = new NativeRelayCommand(ExitMessageSelection);
        CopySelectedCommand = new NativeRelayCommand(() =>
        {
            var text = string.Join(
                "\n",
                _selectedMessages
                    .OrderBy(message => message.CreatedAt)
                    .Select(message => message.EditableBody)
                    .Where(body => !string.IsNullOrEmpty(body)));
            if (text.Length > 0)
            {
                System.Windows.Clipboard.SetText(text);
            }

            ExitMessageSelection();
        });
        // Мультивыбор «🗑»: та же подтверждающая модал, пачка — в _pendingDelete.
        DeleteSelectedCommand = new NativeAsyncCommand(
            (_, _) =>
            {
                var targets = _selectedMessages
                    .Where(message => message.CanEditOrDelete && !string.IsNullOrEmpty(message.Id))
                    .OrderBy(message => message.CreatedAt)
                    .ToList();
                if (targets.Count > 0)
                {
                    OpenDeleteConfirm(targets);
                }

                return Task.CompletedTask;
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => _selectedMessages.Count > 0);
        ForwardSelectedCommand = new NativeRelayCommand(() =>
        {
            var targets = _selectedMessages
                .Where(message => message.CanReply && !string.IsNullOrEmpty(message.Id))
                .OrderBy(message => message.CreatedAt)
                .ToList();
            if (targets.Count == 0)
            {
                return;
            }

            CloseMessageSearch();
            CloseMembersPanel();
            CloseMediaPanel();
            _forwardingMessages = targets;
            ForwardingMessage = null;
            _forwardSearchText = string.Empty;
            RebuildForwardTargets();
            IsForwardPanelOpen = true;
            ExitMessageSelection();
        });
        // ☰-меню: «Новый диалог»/«Новая группа» открывают панель создания
        // в нужном режиме — та же механика, что у кнопки «＋».
        BeginNewDirectCommand = new NativeRelayCommand(() => OpenNewConversationMode(group: false));
        BeginNewGroupCommand = new NativeRelayCommand(() => OpenNewConversationMode(group: true));
        // «Ночной режим» — та же подмена палитры, что в настройках (NativeThemeManager).
        ToggleNightThemeCommand = new NativeAsyncCommand(
            (_, ct) => ToggleNightThemeSafelyAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        // Скоуп «Глобальный поиск» в выдаче списка — открывает существующую панель,
        // запрос уже синхронизирован из SearchText.
        OpenGlobalSearchScopeCommand = new NativeRelayCommand(() =>
        {
            CloseNewConversation();
            IsGlobalSearchOpen = true;
        });
        // FAB «вниз»: инкремент сигнала → attached-поведение докручивает ленту.
        ScrollToEndCommand = new NativeRelayCommand(() => ScrollToEndSignal++);
        // Просмотрщик медиа (media viewer Telegram): навигация, закрытие,
        // явные «Сохранить» (скачать на диск) и «Открыть в другом приложении»
        // — оба по выбору пользователя, без скрытых запусков (UI-026).
        CloseMediaViewerCommand = new NativeRelayCommand(CloseMediaViewer);
        MediaViewerPrevCommand = new NativeRelayCommand(() => MoveMediaViewer(-1));
        MediaViewerNextCommand = new NativeRelayCommand(() => MoveMediaViewer(1));
        SaveMediaViewerCommand = new NativeRelayCommand(() =>
        {
            if (_mediaViewerIndex >= 0 && _mediaViewerIndex < _mediaViewerItems.Count)
            {
                var entry = _mediaViewerItems[_mediaViewerIndex];
                _ = SaveMediaViewerItemAsync(entry);
            }
        });
        OpenMediaViewerExternalCommand = new NativeRelayCommand(() =>
        {
            if (_mediaViewerIndex >= 0 && _mediaViewerIndex < _mediaViewerItems.Count)
            {
                var entry = _mediaViewerItems[_mediaViewerIndex];
                _ = DownloadAndOpenAttachmentAsync(entry.MessageId, entry.Model, entry.DisplayName);
            }
        });
        // Голосовые (UI-028): запись только по явной команде (FAB-🎤 при
        // пустом composer), без автостарта; стоп → предпрослушивание,
        // отмена без сети, отправка — общим upload-пайплайном.
        StartVoiceRecordingCommand = new NativeAsyncCommand(
            (_, ct) => StartVoiceRecordingAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanVoiceRecord);
        StopVoiceRecordingCommand = new NativeAsyncCommand(
            (_, ct) => StopVoiceRecordingAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => IsVoiceRecording);
        CancelVoiceRecordingCommand = new NativeRelayCommand(
            CancelVoiceSession,
            () => IsVoiceRecording || HasVoiceDraft);
        SendVoiceMessageCommand = new NativeAsyncCommand(
            (_, ct) => SendVoiceMessageAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasVoiceDraft && !IsUploading && !IsSending);
        ToggleVoicePreviewCommand = new NativeRelayCommand(
            () => IsVoicePreviewPlaying = !IsVoicePreviewPlaying,
            () => HasVoiceDraft);
        Conversations.CollectionChanged += (_, _) =>
            OnPropertyChanged(nameof(IsConversationSearchEmpty));
        GlobalSearchResults.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(IsConversationSearchEmpty));
            OnPropertyChanged(nameof(HasGlobalSearchResults));
        };
        NativeThemeManager.EffectiveThemeChanged += (_, _) =>
            RunOnUi(() => OnPropertyChanged(nameof(IsNightTheme)));
        ShowMessageReadersCommand = new NativeAsyncCommand(
            (parameter, ct) => ShowMessageReadersAsync(parameter as ChatMessageViewModel, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ChatMessageViewModel);
        CloseReadersPanelCommand = new NativeRelayCommand(() => IsReadersPanelOpen = false);
        OpenNotesCommand = new NativeAsyncCommand(
            (_, ct) => OpenNotesAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        OpenSupportCommand = new NativeAsyncCommand(
            (_, ct) => OpenSupportAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ToggleGroupSettingsCommand = new NativeAsyncCommand(
            (_, ct) => ToggleGroupSettingsAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        CloseGroupSettingsCommand = new NativeRelayCommand(CloseGroupSettings);
        SaveGroupProfileCommand = new NativeAsyncCommand(
            (_, ct) => SaveGroupProfileAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsGroupActionBusy);
        UploadGroupAvatarCommand = new NativeAsyncCommand(
            (_, ct) => UploadGroupAvatarAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupOwners && !IsGroupActionBusy);
        RemoveGroupAvatarCommand = new NativeAsyncCommand(
            (_, ct) => RemoveGroupAvatarAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupOwners && HasGroupAvatar && !IsGroupActionBusy);
        CreateInviteLinkCommand = new NativeAsyncCommand(
            (_, ct) => CreateInviteLinkAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupMembers && !IsGroupActionBusy);
        CopyInviteLinkCommand = new NativeRelayCommand(() =>
        {
            if (_groupInviteLink is { } link)
            {
                System.Windows.Clipboard.SetText(link);
            }
        });
        RevokeInviteLinkCommand = new NativeAsyncCommand(
            (_, ct) => RevokeInviteLinkAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupMembers && !IsGroupActionBusy);
        DeleteGroupCommand = new NativeAsyncCommand(
            (_, ct) => DeleteGroupConversationAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupOwners && !IsGroupActionBusy);
        ToggleJoinRequestsPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleJoinRequestsPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupMembers);
        CloseJoinRequestsPanelCommand = new NativeRelayCommand(CloseJoinRequestsPanel);
        ToggleReportsPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleReportsPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => CanManageGroupMembers);
        CloseReportsPanelCommand = new NativeRelayCommand(CloseReportsPanel);
        BeginReportCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatMessageViewModel { CanReport: true } message)
            {
                BeginReport(message);
            }
        });
        SubmitReportCommand = new NativeAsyncCommand(
            (_, ct) => SubmitReportAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => IsReportDialogOpen && !IsSubmittingReport);
        CancelReportCommand = new NativeRelayCommand(CloseReportDialog);
        OpenTaskShareCommand = new NativeAsyncCommand(
            (_, ct) => ToggleTaskShareAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasConversation);
        CloseTaskShareCommand = new NativeRelayCommand(CloseTaskShare);
        OpenScheduleEditorCommand = new NativeRelayCommand(
            _ => OpenScheduleEditor(),
            _ => CanScheduleMessage);
        CloseScheduleEditorCommand = new NativeRelayCommand(CloseScheduleEditor);
        ConfirmScheduleCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmScheduleAsync(ct),
            ex => ScheduledErrorText = TasksViewModel.DescribeError(ex),
            _ => CanConfirmSchedule);
        ApplySchedulePresetCommand = new NativeRelayCommand(parameter =>
            ApplySchedulePreset(parameter as string));
        ToggleScheduledPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleScheduledPanelAsync(ct),
            ex => ScheduledErrorText = TasksViewModel.DescribeError(ex));
        CloseScheduledPanelCommand = new NativeRelayCommand(CloseScheduledPanel);
        SelectFolderCommand = new NativeAsyncCommand(
            (parameter, _) =>
            {
                SelectFolder(parameter as ChatFolderTabViewModel);
                return Task.CompletedTask;
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ToggleFolderManagerCommand = new NativeRelayCommand(() =>
        {
            if (IsFolderManagerOpen)
            {
                CloseFolderManager();
            }
            else
            {
                OpenFolderManager();
            }
        });
        CloseFolderManagerCommand = new NativeRelayCommand(CloseFolderManager);
        CreateFolderCommand = new NativeAsyncCommand(
            (_, ct) => CreateFolderAsync(ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsFolderBusy && !string.IsNullOrWhiteSpace(NewFolderName));
        BeginFolderRenameCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatFolderTabViewModel { IsSystem: false } folder)
            {
                RenamingFolder = folder;
                RenamingFolderName = folder.Title;
            }
        });
        CancelFolderRenameCommand = new NativeRelayCommand(() => RenamingFolder = null);
        SaveFolderRenameCommand = new NativeAsyncCommand(
            (_, ct) => SaveFolderRenameAsync(ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsFolderBusy && RenamingFolder is not null
                && !string.IsNullOrWhiteSpace(RenamingFolderName));
        DeleteFolderCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteFolderAsync(parameter as ChatFolderTabViewModel, ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            parameter => !IsFolderBusy && parameter is ChatFolderTabViewModel { IsSystem: false });
        MoveFolderUpCommand = new NativeAsyncCommand(
            (parameter, ct) => MoveFolderAsync(parameter as ChatFolderTabViewModel, -1, ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            parameter => !IsFolderBusy && parameter is ChatFolderTabViewModel { IsSystem: false });
        MoveFolderDownCommand = new NativeAsyncCommand(
            (parameter, ct) => MoveFolderAsync(parameter as ChatFolderTabViewModel, +1, ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            parameter => !IsFolderBusy && parameter is ChatFolderTabViewModel { IsSystem: false });
        OpenFolderMembershipCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatFolderTabViewModel { IsSystem: false } folder)
            {
                OpenFolderMembership(folder);
            }
        });
        CloseFolderMembershipCommand = new NativeRelayCommand(CloseFolderMembership);
        SaveFolderMembershipCommand = new NativeAsyncCommand(
            (_, ct) => SaveFolderMembershipAsync(ct),
            ex => FolderErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsFolderBusy && IsFolderMembershipOpen);
        ToggleStickerPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleStickerPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasConversation);
        CloseStickerPanelCommand = new NativeRelayCommand(CloseStickerPanel);
        SelectStickerPackCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatStickerPackViewModel pack)
            {
                SelectedStickerPack = pack;
            }
        });
        ImportStickerPackCommand = new NativeAsyncCommand(
            (_, ct) => ImportStickerPackAsync(ct),
            ex => StickerErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsImportingStickerPack && !string.IsNullOrWhiteSpace(StickerImportSource));
        SelectStickerTabCommand = new NativeRelayCommand(parameter =>
            IsEmojiTab = string.Equals(parameter as string, "emoji", StringComparison.Ordinal));
        InsertEmojiCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is string emoji)
            {
                ComposerText += emoji;
            }
        });
        TogglePeerCardCommand = new NativeRelayCommand(_ =>
        {
            if (IsPeerCardOpen)
            {
                ClosePeerCard();
            }
            else if (HasConversation)
            {
                OpenPeerCard();
            }
        });
        ClosePeerCardCommand = new NativeRelayCommand(ClosePeerCard);
        InsertMentionCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ChatGroupMemberItemViewModel candidate)
            {
                InsertMention(candidate);
            }
        });
        CloseMentionPopupCommand = new NativeRelayCommand(CloseMentionPopup);
        ToggleAiPanelCommand = new NativeAsyncCommand(
            (_, ct) => ToggleAiPanelAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        CloseAiPanelCommand = new NativeRelayCommand(CloseAiPanel);
        SelectAiConversationCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is ConversationItemViewModel conversation)
            {
                CloseAiPanel();
                SelectedConversation = conversation;
            }
        });
        DeleteAiConversationCommand = new NativeAsyncCommand(
            (parameter, ct) => DeleteAiConversationAsync(parameter as ConversationItemViewModel, ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is ConversationItemViewModel && !IsAiActionBusy);
        CreateGeneralAiConversationCommand = new NativeAsyncCommand(
            (_, ct) => CreateGeneralAiConversationAsync(ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsAiActionBusy);
        StopAiRunCommand = new NativeAsyncCommand(
            (_, ct) => StopAiRunAsync(ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => CanStopAiRun && !IsAiActionBusy);
        RetryAiRunCommand = new NativeAsyncCommand(
            (_, ct) => RetryAiRunAsync(ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => CanRetryAiRun && !IsAiActionBusy);
        ResetAiContextCommand = new NativeAsyncCommand(
            (_, ct) => ResetAiContextAsync(ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => IsAiConversation && !IsAiActionBusy);
        // Системные вкладки существуют всегда — сидируем до первой загрузки папок.
        RebuildFolderTabs();
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
            var previousConversation = _selectedConversation;
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
            // чужой входящий индикатор гасим вместе с таймером — а у нового
            // диалога подхватываем его «печатает…», если оно ещё живо.
            StopTypingIfSent();
            ClearTypingIndicator();
            TypingText = value?.IsTyping == true ? value.TypingText : null;

            // Черновик прежнего диалога фиксируем ДО очистки композитора
            // (ClearComposerContext вернёт снапшот правки, если она была);
            // подмена composer текстом целевого диалога идёт под suppress,
            // чтобы старый текст не записался под новый convId — см.
            // useChatConversationDraftRestore (suppress + restore на next tick).
            _suppressDraftSync = true;
            try
            {
                // Переключение диалога отменяет ответ/правку и поиск — цель из другой ленты.
                ClearComposerContext();
                if (previousConversation is { } previous
                    && !ReferenceEquals(previous, value))
                {
                    PersistDraftNow(previous.Id, _composerText);
                }

                var restoredDraft = value is { } target
                    && _drafts.TryGetValue(target.Id, out var draft)
                    ? draft
                    : null;
                ComposerText = restoredDraft ?? string.Empty;
                if (!string.IsNullOrEmpty(restoredDraft))
                {
                    // tdesktop ставит курсор в композитор с восстановленным черновиком.
                    FocusComposer?.Invoke();
                }
            }
            finally
            {
                _suppressDraftSync = false;
            }

            CloseMessageSearch();
            CloseForwardPanel();
            CloseDeleteConfirm();
            IsReadersPanelOpen = false;
            CloseMembersPanel();
            CloseMediaPanel();
            CloseGroupSettings();
            CloseJoinRequestsPanel();
            CloseReportsPanel();
            CloseReportDialog();
            CloseTaskShare();
            CloseStickerPanel();
            ClosePeerCard();
            CloseMentionPopup();
            CloseMediaViewer();
            ClearPinnedState();
            ExitMessageSelection();
            SetFileDropOverlay(false);
            // Гасим отложенный тик вспышки якоря прошлого диалога.
            _highlightMarker++;
            ResetScheduledState();
            SelectedMessage = null;
            OnPropertyChanged(nameof(HasConversation));
            OnPropertyChanged(nameof(IsMessagesEmpty));
            // UI-027: смена диалога сбрасывает очередь вложений — файлы
            // и подпись не должны утекать в чужой диалог и мешать
            // повторному выбору после возврата.
            ClearPendingAttachments();
            // UI-028: запись/черновик голосового принадлежит диалогу —
            // обрываем без сети, чтобы не отправить в чужой чат.
            CancelVoiceSession();
            RaiseScrollFabBadge();
            RefreshAiConversationState();
            RaiseCommandStates();
            // Room-подписка: события диалога (read-галочки, чужие реакции) идут
            // только подписчикам комнаты — смена выбора переключает подписку.
            _realtime?.WatchConversation(value?.Id);
            if (value is not null)
            {
                _ = LoadMessagesSafelyAsync(value);
                _ = LoadScheduledSafelyAsync(value);
            }
            else
            {
                _messagesLoadCancellation?.Cancel();
                Messages.Clear();
                HasOlder = false;
                _olderCursor = null;
                HistoryErrorText = null;
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
                OnPropertyChanged(nameof(IsConversationSearchActive));
                OnPropertyChanged(nameof(IsConversationSearchEmpty));
                OnPropertyChanged(nameof(IsEmpty));
                RebuildVisibleConversations();
                ScheduleConversationSearch(value);
                // Тот же запрос кормит раздел «Сообщения» — переиспользуем
                // существующий глобальный поиск (debounce внутри ScheduleGlobalSearch).
                GlobalSearchText = value;
            }
        }
    }

    /// <summary>Непустой SearchText: список меняется на выдачу «В чатах» (tg-search).</summary>
    public bool IsConversationSearchActive => !string.IsNullOrWhiteSpace(_searchText);

    /// <summary>Выдача пуста и поиск завершён — показать «Ничего не найдено».</summary>
    public bool IsConversationSearchEmpty =>
        IsConversationSearchActive
        && !IsSearchingGlobal
        && Conversations.Count == 0
        && GlobalSearchResults.Count == 0;

    /// <summary>Есть строки в секции «Сообщения» поисковой выдачи.</summary>
    public bool HasGlobalSearchResults => GlobalSearchResults.Count > 0;

    public string ComposerText
    {
        get => _composerText;
        set
        {
            if (SetProperty(ref _composerText, value))
            {
                OnPropertyChanged(nameof(HasComposerText));
                RaiseCommandStates();
                NotifyTypingState();
                ScheduleDraftSync();
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

    /// <summary>
    /// Бейдж на FAB «вниз» (tg-main): «@»-упоминания открытого диалога,
    /// иначе счётчик непрочитанных; null — бейдж скрыт.
    /// </summary>
    public string? ScrollFabBadgeText =>
        _selectedConversation is { } conversation
            ? conversation.UnreadMentionCount switch
            {
                > 99 => "@99+",
                > 0 => "@" + conversation.UnreadMentionCount.ToString(CultureInfo.InvariantCulture),
                _ => conversation.UnreadCount switch
                {
                    > 99 => "99+",
                    > 0 => conversation.UnreadCount.ToString(CultureInfo.InvariantCulture),
                    _ => null,
                },
            }
            : null;

    /// <summary>Показывать счётчик/«@» на FAB прокрутки вниз.</summary>
    public bool HasScrollFabBadge => !string.IsNullOrEmpty(ScrollFabBadgeText);

    /// <summary>Изменился счётчик упоминаний/непрочитанных выбранного диалога.</summary>
    private void RaiseScrollFabBadge()
    {
        OnPropertyChanged(nameof(ScrollFabBadgeText));
        OnPropertyChanged(nameof(HasScrollFabBadge));
    }

    /// <summary>Подпись режима «Архив» над списком: «Архив · N диалогов».</summary>
    public string ArchiveHeaderText =>
        $"Архив · {Conversations.Count} "
        + ChatPlural.Of(Conversations.Count, "диалог", "диалога", "диалогов");

    // ---- Просмотрщик изображений (media viewer Telegram) ----

    /// <summary>Открыт полноэкранный просмотрщик image-вложения.</summary>
    public bool IsMediaViewerOpen
    {
        get => _isMediaViewerOpen;
        private set => SetProperty(ref _isMediaViewerOpen, value);
    }

    /// <summary>Текущая картинка просмотрщика (null, пока докачивается).</summary>
    public ImageSource? MediaViewerImage
    {
        get => _mediaViewerImage;
        private set => SetProperty(ref _mediaViewerImage, value);
    }

    /// <summary>Заголовок под картинкой — имя файла.</summary>
    public string? MediaViewerTitle =>
        _mediaViewerIndex >= 0 && _mediaViewerIndex < _mediaViewerItems.Count
            ? _mediaViewerItems[_mediaViewerIndex].DisplayName
            : null;

    /// <summary>Счётчик «N из M» — виден, когда элементов больше одного.</summary>
    public string? MediaViewerCounterText =>
        _mediaViewerItems.Count > 1 && _mediaViewerIndex >= 0
            ? $"{_mediaViewerIndex + 1} из {_mediaViewerItems.Count}"
            : null;

    /// <summary>Подсказка в шапке: «Сохранено в …» после явного скачивания.</summary>
    public string? MediaViewerStatusText
    {
        get => _mediaViewerStatusText;
        private set => SetProperty(ref _mediaViewerStatusText, value);
    }

    public bool MediaViewerCanGoBack => _mediaViewerIndex > 0;

    public bool MediaViewerCanGoForward =>
        _mediaViewerIndex >= 0 && _mediaViewerIndex < _mediaViewerItems.Count - 1
        || _mediaViewerGallerySource && HasMoreMedia
        && _mediaViewerIndex == _mediaViewerItems.Count - 1;

    /// <summary>Локальный файл текущего видео/аудио — Source MediaElement;
    /// null на смене элемента/закрытии (view гасит воспроизведение).</summary>
    public string? MediaViewerMediaSource
    {
        get => _mediaViewerMediaSource;
        private set => SetProperty(ref _mediaViewerMediaSource, value);
    }

    /// <summary>Что показывает просмотрщик: image — картинка, video/audio —
    /// MediaElement + транспорт, иначе fallback «открыть в другом приложении».</summary>
    public bool MediaViewerIsImage => _mediaViewerPlaybackKind is null
        && _mediaViewerUnsupportedText is null && IsMediaViewerOpen;

    public bool MediaViewerIsVideo => _mediaViewerPlaybackKind == "video";

    public bool MediaViewerIsAudio => _mediaViewerPlaybackKind == "audio";

    /// <summary>Формат без встроенного показа — fallback + явный внешний запуск.</summary>
    public bool MediaViewerIsUnsupported => _mediaViewerUnsupportedText is not null;

    /// <summary>Текст fallback-а неподдерживаемого формата.</summary>
    public string? MediaViewerUnsupportedText
    {
        get => _mediaViewerUnsupportedText;
        private set => SetProperty(ref _mediaViewerUnsupportedText, value);
    }

    /// <summary>Картинка ещё скачивается — под каркасом крутится подсказка.</summary>
    public bool IsMediaViewerLoading
    {
        get => _isMediaViewerLoading;
        private set => SetProperty(ref _isMediaViewerLoading, value);
    }

    /// <summary>MediaElement сообщил об ошибке кодека — переводим элемент
    /// в fallback с явным «Открыть в другом приложении» (UI-026).</summary>
    public void MarkMediaViewerPlaybackFailed()
    {
        if (_mediaViewerPlaybackKind is null)
        {
            return;
        }

        _mediaViewerPlaybackKind = null;
        MediaViewerMediaSource = null;
        MediaViewerUnsupportedText = "Формат не поддерживается встроенным воспроизведением.";
        RaiseMediaViewerKindChanged();
    }

    public ICommand CloseMediaViewerCommand { get; }

    public ICommand MediaViewerPrevCommand { get; }

    public ICommand MediaViewerNextCommand { get; }

    public ICommand SaveMediaViewerCommand { get; }

    /// <summary>«Открыть в другом приложении» — явный выбор пользователя (UI-026).</summary>
    public ICommand OpenMediaViewerExternalCommand { get; }

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
                RaiseCommandStates();
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

    public bool HasOlderHistoryError
    {
        get => _hasOlderHistoryError;
        private set => SetProperty(ref _hasOlderHistoryError, value);
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

    /// <summary>
    /// Ошибка загрузки истории выбранного диалога. Отделена от баннера: «Повторить»
    /// при ней перезапрашивает историю этого диалога, а пустое состояние ленты
    /// подменяется панелью ошибки — «Сообщений пока нет» не утверждается.
    /// </summary>
    public string? HistoryErrorText
    {
        get => _historyErrorText;
        private set
        {
            if (SetProperty(ref _historyErrorText, value))
            {
                OnPropertyChanged(nameof(HasHistoryError));
                OnPropertyChanged(nameof(IsMessagesEmpty));
            }
        }
    }

    public bool HasHistoryError => !string.IsNullOrEmpty(HistoryErrorText);

    /// <summary>«Диалогов пока нет» — только после загрузки, без баннера и вне поиска
    /// (в режиме поиска пустую выдачу рисует «Ничего не найдено» — IsConversationSearchEmpty).</summary>
    public bool IsEmpty => !IsLoading && Conversations.Count == 0 && !HasBannerError
        && !IsConversationSearchActive;

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

    public bool IsMessagesEmpty => HasConversation && !IsLoadingMessages && !HasHistoryError && Messages.Count == 0;

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

    // ---- Подтверждение вложений (UI-027, tg-send-files) ----

    /// <summary>Файлы, отложенные к подтверждению — выбор/дроп/вставка сначала
    /// показывают список; upload-сессия создаётся только по «Отправить».</summary>
    public ObservableCollection<PendingAttachmentItemViewModel> PendingAttachments { get; } = [];

    /// <summary>Диалог-получатель файлов: фиксируется при выборе;
    /// переключение диалога обнуляет его вместе с очередью (UI-027).</summary>
    private ConversationItemViewModel? _pendingAttachmentConversation;

    /// <summary>Подпись к отправляемым файлам — отдельное поле модала,
    /// черновик composer к ней не привязан и после отправки сохраняется.</summary>
    public string? AttachmentCaption
    {
        get => _attachmentCaption;
        set => SetProperty(ref _attachmentCaption, value);
    }

    /// <summary>Модал подтверждения виден только в диалоге-владельце очереди;
    /// переключение чата сбрасывает очередь целиком (UI-027).</summary>
    public bool IsAttachmentConfirmOpen => PendingAttachments.Count > 0
        && ReferenceEquals(_pendingAttachmentConversation, _selectedConversation);

    public string? PendingAttachmentTargetTitle => _pendingAttachmentConversation?.Title;

    /// <summary>Заголовок модала: «Отправить файл» / «Отправить 3 файла».</summary>
    public string PendingAttachmentTitleText => PendingAttachments.Count switch
    {
        1 => "Отправить файл",
        _ => $"Отправить {PendingAttachments.Count} {PluralizeFiles(PendingAttachments.Count)}",
    };

    private static string PluralizeFiles(int count)
    {
        var mod100 = count % 100;
        if (mod100 is >= 11 and <= 14)
        {
            return "файлов";
        }

        return (count % 10) switch
        {
            1 => "файл",
            2 or 3 or 4 => "файла",
            _ => "файлов",
        };
    }

    /// <summary>Провайдер выбора файлов — подставляет view (OpenFileDialog);
    /// аргумент — вид («media» фильтрует изображения+видео); null в тестах.</summary>
    public Func<string?, IReadOnlyList<string>>? AttachmentPicker { get; set; }

    /// <summary>Скачивание вложения в temp-папку и открытие системным обработчиком.</summary>
    public Func<HubChatAttachment, string?, Task>? AttachmentSaver { get; set; }

    /// <summary>
    /// Провайдер «куда сохранить экспорт» — подставляет view (SaveFileDialog
    /// с фильтром txt/json); null в тестах или отмена диалога → экспорт не идёт.
    /// </summary>
    public Func<ConversationItemViewModel, ChatExportTarget?>? ExportTargetPicker { get; set; }

    /// <summary>Открытие ссылки из карточки превью; null — Process.Start браузером ОС.</summary>
    public Func<string, Task>? LinkOpener { get; set; }

    /// <summary>
    /// Запрос фокуса в поле ввода (view ставит хук на ComposerInput.Focus);
    /// дергается при восстановлении черновика после смены диалога.
    /// </summary>
    public Action? FocusComposer { get; set; }

    /// <summary>Просьба прокрутить ленту к сообщению (view → ScrollIntoView);
    /// дергается при переходе к якорю reply/pinned/search.</summary>
    public Action<ChatMessageViewModel>? RequestScrollToMessage { get; set; }

    public bool CanSend =>
        HasConversation && !IsSending && !IsUploading && !string.IsNullOrWhiteSpace(ComposerText);

    /// <summary>Текст в composer — FAB показывает ➤ (пусто — 🎤, как tdesktop).</summary>
    public bool HasComposerText => !string.IsNullOrWhiteSpace(ComposerText);

    /// <summary>«Скрепка» доступна при открытом диалоге и без активной отправки/загрузки.</summary>
    public bool CanAttach => HasConversation && !IsSending && !IsUploading;

    public ICommand SendCommand { get; }

    /// <summary>Выбрать файлы в очередь подтверждения вложений (UI-027);
    /// параметр — «media»/«document» для фильтра диалога.</summary>
    public ICommand AttachCommand { get; }

    /// <summary>Файлы из drag&amp;drop на ленту/вставки картинки — та же очередь
    /// подтверждения, что и «скрепка» (параметр — пути файлов).</summary>
    public ICommand AttachDroppedFilesCommand { get; }

    /// <summary>Подтвердить очередь вложений — только здесь стартует
    /// upload-сессия с показанными файлами и подписью.</summary>
    public ICommand ConfirmAttachmentsCommand { get; }

    /// <summary>Убрать один файл из очереди подтверждения (крест строки).</summary>
    public ICommand RemovePendingAttachmentCommand { get; }

    /// <summary>Отменить очередь вложений целиком — черновик не затрагивается.</summary>
    public ICommand CancelAttachmentsCommand { get; }

    public ICommand LoadOlderCommand { get; }

    public ICommand RetryCommand { get; }

    /// <summary>Повтор загрузки истории выбранного диалога (панель ошибки в ленте).</summary>
    public ICommand RetryHistoryCommand { get; }

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
    /// <summary>Список активен только без overlay-панелей (новый диалог, поиск, папки, ИИ).</summary>
    public bool IsConversationListActive => !IsNewConversationOpen && !IsGlobalSearchOpen
        && !IsFolderManagerOpen && !IsFolderMembershipOpen && !IsAiPanelOpen;

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
                OnPropertyChanged(nameof(ArchiveHeaderText));
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

    /// <summary>FAB показывает ➤/✓ — есть текст или идёт правка; голосовая
    /// панель (запись/черновик) прячет текстовую отправку (UI-028).</summary>
    public bool ShowSendFab =>
        (HasComposerText || EditingMessage is not null) && !VoiceBarVisible;

    /// <summary>FAB показывает 🎤 — пустой composer без правки и голосовой
    /// сессии; запись только по явному нажатию (UI-028).</summary>
    public bool ShowMicFab =>
        !HasComposerText && EditingMessage is null && !VoiceBarVisible && HasConversation;

    private void RaiseComposerContextChanged()
    {
        OnPropertyChanged(nameof(HasComposerContext));
        OnPropertyChanged(nameof(ComposerContextTitle));
        OnPropertyChanged(nameof(ComposerContextText));
        OnPropertyChanged(nameof(SendButtonText));
        OnPropertyChanged(nameof(ShowSendFab));
        OnPropertyChanged(nameof(ShowMicFab));
        OnPropertyChanged(nameof(CanScheduleMessage));
        (OpenScheduleEditorCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
    }

    private void ClearComposerContext()
    {
        var wasEditing = EditingMessage is not null;
        ReplyingTo = null;
        EditingMessage = null;
        if (wasEditing)
        {
            // После правки композитор возвращает снапшот черновика (tdesktop),
            // а не пустую строку — иначе исходный черновик терялся бы.
            ComposerText = _editDraftSnapshot?.Text ?? string.Empty;
        }

        _editDraftSnapshot = null;
    }

    /// <summary>
    /// ↑ в пустом composer — правка последнего собственного сообщения
    /// (tdesktop: Up в пустом поле открывает edit ближайшего своего текста).
    /// </summary>
    public void BeginEditLastOwnMessage()
    {
        var message = Messages.LastOrDefault(m => m.CanEditOrDelete);
        if (message is not null)
        {
            BeginEditCommand.Execute(message);
        }
    }

    /// <summary>
    /// Alt+↑/↓ (и Ctrl+PgUp/PgDn) — выбор соседнего диалога в списке,
    /// как клавиатурная навигация tdesktop по чатам.
    /// </summary>
    public void SelectAdjacentConversation(int direction)
    {
        if (Conversations.Count == 0 || direction == 0)
        {
            return;
        }

        var index = Conversations.IndexOf(SelectedConversation!);
        var next = index < 0
            ? (direction > 0 ? 0 : Conversations.Count - 1)
            : Math.Clamp(index + Math.Sign(direction), 0, Conversations.Count - 1);
        SelectedConversation = Conversations[next];
    }

    /// <summary>
    /// Ctrl+B/Ctrl+I/Ctrl+K — markdown-обёртка выделения composer (tdesktop):
    /// **жирный**, *курсив*, `код`. Повторное нажатие снимает обёртку.
    /// </summary>
    public void ToggleComposerWrap(string marker, int selectionStart, int selectionLength)
    {
        if (string.IsNullOrEmpty(marker))
        {
            return;
        }

        var text = ComposerText ?? string.Empty;
        selectionStart = Math.Clamp(selectionStart, 0, text.Length);
        selectionLength = Math.Clamp(selectionLength, 0, text.Length - selectionStart);
        var markerLength = marker.Length;

        if (selectionLength > 0)
        {
            // Маркеры вплотную СНАРУЖИ выделения → снять их.
            if (selectionStart >= markerLength
                && selectionStart + selectionLength + markerLength <= text.Length
                && string.CompareOrdinal(text, selectionStart - markerLength, marker, 0, markerLength) == 0
                && string.CompareOrdinal(text, selectionStart + selectionLength, marker, 0, markerLength) == 0)
            {
                ComposerText = text
                    .Remove(selectionStart + selectionLength, markerLength)
                    .Remove(selectionStart - markerLength, markerLength);
                RequestComposerSelection?.Invoke(selectionStart - markerLength, selectionLength);
                return;
            }

            // Маркеры по краям ВНУТРИ выделения → снять их.
            if (selectionLength >= markerLength * 2
                && string.CompareOrdinal(text, selectionStart, marker, 0, markerLength) == 0
                && string.CompareOrdinal(
                    text, selectionStart + selectionLength - markerLength, marker, 0, markerLength) == 0)
            {
                ComposerText = text
                    .Remove(selectionStart + selectionLength - markerLength, markerLength)
                    .Remove(selectionStart, markerLength);
                RequestComposerSelection?.Invoke(selectionStart, selectionLength - markerLength * 2);
                return;
            }

            ComposerText = text
                .Insert(selectionStart + selectionLength, marker)
                .Insert(selectionStart, marker);
            // Выделение остаётся на внутреннем тексте — как в tdesktop после Ctrl+B.
            RequestComposerSelection?.Invoke(selectionStart + markerLength, selectionLength);
            return;
        }

        // Без выделения — парные маркеры, каретка между ними.
        ComposerText = text.Insert(selectionStart, marker + marker);
        RequestComposerSelection?.Invoke(selectionStart + markerLength, 0);
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
        set
        {
            // Режим мультивыбора: клик по пузырю переключает галочку сообщения,
            // а не ListBox-выделение — как в Telegram Desktop.
            if (IsSelectionMode && value is { IsSystem: false } message)
            {
                _selectedMessage = null;
                OnPropertyChanged();
                ToggleMessageSelection(message);
                return;
            }

            SetProperty(ref _selectedMessage, value);
        }
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
    /// Строка поиска внутри пикера пересылки (tg-forward «Forward to…»):
    /// свой фильтр, не трогает общий SearchText и вкладки папок.
    /// </summary>
    public string ForwardSearchText
    {
        get => _forwardSearchText;
        set
        {
            if (SetProperty(ref _forwardSearchText, value))
            {
                RebuildForwardTargets();
            }
        }
    }

    /// <summary>
    /// Цели пересылки: все не-архивные диалоги (как вкладка «Все»),
    /// отфильтрованные ForwardSearchText, в том же порядке, что и список.
    /// </summary>
    public ObservableCollection<ConversationItemViewModel> ForwardTargets { get; } = [];

    /// <summary>В пикере нет ни одной цели — показать пустую подпись.</summary>
    public bool HasForwardTargets => ForwardTargets.Count > 0;

    private void RebuildForwardTargets()
    {
        ForwardTargets.Clear();
        foreach (var item in _allConversations
                     .Where(item => !item.IsArchived)
                     .Where(item => item.MatchesFilter(_forwardSearchText))
                     .OrderByDescending(item => item.IsPinned)
                     .ThenByDescending(item => item.LastMessageAt ?? DateTimeOffset.MinValue)
                     .ThenBy(item => item.Title, StringComparer.CurrentCultureIgnoreCase))
        {
            ForwardTargets.Add(item);
        }

        OnPropertyChanged(nameof(HasForwardTargets));
    }

    /// <summary>
    /// Пересылка в выбранный диалог: client_message_id генерируется как при отправке —
    /// realtime-эхо дедупится по нему. После успеха — переход в целевой диалог (как web).
    /// </summary>
    private async Task ForwardMessageToAsync(
        ConversationItemViewModel? target,
        CancellationToken cancellationToken)
    {
        // Пакет мультивыбора приоритетнее одиночного сообщения.
        var batch = _forwardingMessages is { Count: > 0 }
            ? _forwardingMessages
            : _forwardingMessage is { Id.Length: > 0 } single
                ? [single]
                : null;
        if (target is null || batch is null || IsForwarding)
        {
            return;
        }

        IsForwarding = true;
        try
        {
            HubChatMessage? forwarded = null;
            foreach (var message in batch)
            {
                if (string.IsNullOrEmpty(message.Id))
                {
                    continue;
                }

                forwarded = await _api.ForwardChatMessageAsync(
                    target.Id,
                    message.Id,
                    body: null,
                    clientMessageId: Guid.NewGuid().ToString("N"),
                    replyToMessageId: null,
                    cancellationToken);
            }

            CloseForwardPanel();
            if (forwarded is not null)
            {
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
        _forwardingMessages = null;
        _forwardSearchText = string.Empty;
        ForwardTargets.Clear();
        OnPropertyChanged(nameof(HasForwardTargets));
    }

    // ---- Мультивыбор сообщений (Telegram «Выделить») ----

    /// <summary>Активен режим выделения: кружки-чеки у пузырей, шапка и низ меняются.</summary>
    public bool IsSelectionMode
    {
        get => _isSelectionMode;
        private set
        {
            if (SetProperty(ref _isSelectionMode, value))
            {
                RaiseSelectionChanged();
            }
        }
    }

    /// <summary>Сколько сообщений отмечено.</summary>
    public int SelectedCount => _selectedMessages.Count;

    /// <summary>Заголовок шапки в режиме выделения: «N выбрано».</summary>
    public string SelectionHeaderText =>
        $"{SelectedCount} выбрано";

    /// <summary>Подпись нижней панели: «Выбрано: N».</summary>
    public string SelectedCountText => $"Выбрано: {SelectedCount}";

    /// <summary>Подписи акцентных пилюль шапки в режиме выделения (tg-multiselect).</summary>
    public string ForwardSelectedText => $"ПЕРЕСЛАТЬ {SelectedCount}";

    public string DeleteSelectedText => $"УДАЛИТЬ {SelectedCount}";

    /// <summary>Пункт «Выделить» контекстного меню пузыря.</summary>
    public ICommand BeginSelectCommand { get; }

    /// <summary>Клик по пузырю в режиме выделения — toggle галочки.</summary>
    public ICommand ToggleMessageSelectionCommand { get; }

    /// <summary>✕ в шапке — выход из режима выделения.</summary>
    public ICommand ExitSelectionCommand { get; }

    /// <summary>⧉ скопировать текст выделенных сообщений.</summary>
    public ICommand CopySelectedCommand { get; }

    /// <summary>↪ переслать выделенные — переиспользует панель выбора диалога.</summary>
    public ICommand ForwardSelectedCommand { get; }

    /// <summary>🗑 удалить выделенные (только свои, как и одиночное удаление).</summary>
    public ICommand DeleteSelectedCommand { get; }

    /// <summary>Toggle галочки сообщения; снятие последней выходит из режима.</summary>
    private void ToggleMessageSelection(ChatMessageViewModel message)
    {
        if (message.IsSelected)
        {
            message.IsSelected = false;
            _selectedMessages.Remove(message);
        }
        else
        {
            message.IsSelected = true;
            _selectedMessages.Add(message);
        }

        RaiseSelectionChanged();
        if (_selectedMessages.Count == 0)
        {
            IsSelectionMode = false;
        }
    }

    /// <summary>Снять галочки со всех и выйти из режима выделения.</summary>
    private void ExitMessageSelection()
    {
        foreach (var message in _selectedMessages)
        {
            message.IsSelected = false;
        }

        _selectedMessages.Clear();
        RaiseSelectionChanged();
        IsSelectionMode = false;
    }

    private void RaiseSelectionChanged()
    {
        OnPropertyChanged(nameof(SelectedCount));
        OnPropertyChanged(nameof(SelectionHeaderText));
        OnPropertyChanged(nameof(SelectedCountText));
        OnPropertyChanged(nameof(ForwardSelectedText));
        OnPropertyChanged(nameof(DeleteSelectedText));
        (DeleteSelectedCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    // ---- Подтверждение удаления (модал tg-main «Удалить сообщение?») ----

    /// <summary>Открыт модал подтверждения удаления поверх ленты.</summary>
    public bool IsDeleteConfirmOpen
    {
        get => _isDeleteConfirmOpen;
        private set => SetProperty(ref _isDeleteConfirmOpen, value);
    }

    /// <summary>Идёт DELETE — «Удалить»/«Отмена» блокируются.</summary>
    public bool IsDeleting
    {
        get => _isDeleting;
        private set
        {
            if (SetProperty(ref _isDeleting, value))
            {
                (ConfirmDeleteCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Заголовок модала: «Удалить сообщение»/«Удалить сообщения».</summary>
    public string DeleteConfirmTitle =>
        _pendingDelete is { Count: > 1 } ? "Удалить сообщения" : "Удалить сообщение";

    /// <summary>Текст модала с плюрализацией числа сообщений.</summary>
    public string DeleteConfirmText =>
        _pendingDelete is { Count: > 1 } batch
            ? $"Вы уверены, что хотите удалить {batch.Count} {ChatPlural.Of(batch.Count, "сообщение", "сообщения", "сообщений")}?"
            : "Вы уверены, что хотите удалить сообщение?";

    /// <summary>Сколько сообщений ждёт удаления в модале.</summary>
    public int PendingDeleteCount => _pendingDelete?.Count ?? 0;

    /// <summary>Красная «Удалить» модала — реальный DELETE по каждой цели.</summary>
    public ICommand ConfirmDeleteCommand { get; }

    /// <summary>«Отмена» модала — закрыть без удаления.</summary>
    public ICommand CancelDeleteCommand { get; }

    private void OpenDeleteConfirm(List<ChatMessageViewModel> targets)
    {
        _pendingDelete = targets;
        IsDeleteConfirmOpen = true;
        OnPropertyChanged(nameof(DeleteConfirmTitle));
        OnPropertyChanged(nameof(DeleteConfirmText));
        OnPropertyChanged(nameof(PendingDeleteCount));
        (ConfirmDeleteCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    private void CloseDeleteConfirm()
    {
        IsDeleteConfirmOpen = false;
        _pendingDelete = null;
        (ConfirmDeleteCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    // ---- Оверлей drag&drop файлов на ленту (tg-drop prompt) ----

    /// <summary>Над лентой тащат файлы — показываем затемнение с подписью.</summary>
    public bool IsFileDropOverlayOpen
    {
        get => _isFileDropOverlayOpen;
        private set => SetProperty(ref _isFileDropOverlayOpen, value);
    }

    /// <summary>«Перетащите файлы, чтобы отправить их в …» — цель из заголовка чата.</summary>
    public string FileDropTargetText =>
        $"Перетащите файлы, чтобы отправить их в {SelectedConversation?.Title ?? "чат"}";

    /// <summary>View дёргает на DragEnter/DragLeave/Drop: счётчик DragEnter
    /// дочерних элементов ведёт сам view, сюда приходит уже сведённый флаг.</summary>
    public void SetFileDropOverlay(bool open)
    {
        IsFileDropOverlayOpen = open;
        OnPropertyChanged(nameof(FileDropTargetText));
    }

    /// <summary>Подтверждённое удаление: тот же DELETE по одному сообщению, как было.</summary>
    private async Task ConfirmDeleteAsync(CancellationToken cancellationToken)
    {
        var targets = _pendingDelete;
        if (targets is null || _selectedConversation is not { } conversation || IsDeleting)
        {
            return;
        }

        IsDeleting = true;
        try
        {
            foreach (var message in targets)
            {
                if (string.IsNullOrEmpty(message.Id))
                {
                    continue;
                }

                var result = await _api.DeleteChatMessageAsync(
                    conversation.Id, message.Id, cancellationToken);
                message.Update(result);
            }

            CloseDeleteConfirm();
            // Отмена оставляет выделение на месте (как tg), успех — снимает.
            ExitMessageSelection();
        }
        finally
        {
            IsDeleting = false;
        }
    }

    // ---- Меню ☰ в шапке списка диалогов ----

    private string? _menuProfileName;
    private string? _menuProfileUsername;
    private Brush? _menuProfileBrush;
    private string _menuProfileInitials = "•";
    private bool _menuProfileRequested;

    /// <summary>Имя текущего пользователя — шапка ☰-меню (tg-menu).</summary>
    public string? MenuProfileName
    {
        get => _menuProfileName;
        private set
        {
            if (SetProperty(ref _menuProfileName, value))
            {
                OnPropertyChanged(nameof(HasMenuProfile));
            }
        }
    }

    /// <summary>@username / почта — вторая строка шапки ☰-меню.</summary>
    public string? MenuProfileUsername
    {
        get => _menuProfileUsername;
        private set => SetProperty(ref _menuProfileUsername, value);
    }

    /// <summary>Градиент аватара текущего пользователя (та же палитра пиров).</summary>
    public Brush? MenuProfileBrush
    {
        get => _menuProfileBrush;
        private set => SetProperty(ref _menuProfileBrush, value);
    }

    /// <summary>Инициалы на градиентном аватаре шапки ☰-меню.</summary>
    public string MenuProfileInitials
    {
        get => _menuProfileInitials;
        private set => SetProperty(ref _menuProfileInitials, value);
    }

    private ImageSource? _menuProfileAvatarImage;

    /// <summary>Фото-аватар текущего пользователя (/auth/me avatar_url); null — инициалы.</summary>
    public ImageSource? MenuProfileAvatarImage
    {
        get => _menuProfileAvatarImage;
        private set
        {
            if (SetProperty(ref _menuProfileAvatarImage, value))
            {
                OnPropertyChanged(nameof(HasMenuProfileAvatarImage));
            }
        }
    }

    /// <summary>Фото загружено — поверх градиента рисуется ImageBrush-круг.</summary>
    public bool HasMenuProfileAvatarImage => MenuProfileAvatarImage is not null;

    public bool HasMenuProfile => MenuProfileName is not null;

    /// <summary>Пункт «Новый диалог» ☰-меню — та же панель создания, режим direct.</summary>
    public ICommand BeginNewDirectCommand { get; }

    /// <summary>Пункт «Новая группа» ☰-меню — та же панель создания, режим group.</summary>
    public ICommand BeginNewGroupCommand { get; }

    /// <summary>Чекбокс «Ночной режим»: тёмная палитра сейчас применена.</summary>
    public bool IsNightTheme => NativeThemeManager.EffectiveMode == "dark";

    /// <summary>Пункт «Ночной режим» — переключает палитру и сохраняет в настройках.</summary>
    public ICommand ToggleNightThemeCommand { get; }

    /// <summary>Скоуп «Глобальный поиск» в выдаче — открывает панель поиска по сообщениям.</summary>
    public ICommand OpenGlobalSearchScopeCommand { get; }

    /// <summary>Круглый FAB «вниз» — инкрементирует сигнал для attached-скролла.</summary>
    public ICommand ScrollToEndCommand { get; }

    /// <summary>Сигнал «прокрутить вниз»: view следит за изменением и скроллит ленту.</summary>
    public int ScrollToEndSignal
    {
        get => _scrollToEndSignal;
        private set => SetProperty(ref _scrollToEndSignal, value);
    }

    /// <summary>Открыть панель создания в конкретном режиме (direct/group).</summary>
    private void OpenNewConversationMode(bool group)
    {
        if (!IsNewConversationOpen)
        {
            OpenNewConversation();
        }

        IsNewGroupMode = group;
    }

    /// <summary>
    /// GET /auth/me один раз за сессию — имя и username для шапки ☰-меню.
    /// Профильная карточка вспомогательная: ошибка не блокирует список.
    /// </summary>
    private async Task LoadMenuProfileSafelyAsync(CancellationToken cancellationToken)
    {
        if (_menuProfileRequested)
        {
            return;
        }

        _menuProfileRequested = true;
        try
        {
            var user = await _api.GetCurrentUserAsync(cancellationToken);
            RunOnUi(() =>
            {
                var name = string.IsNullOrWhiteSpace(user.FullName) ? user.Username : user.FullName;
                MenuProfileName = string.IsNullOrWhiteSpace(name) ? "Профиль" : name;
                MenuProfileUsername = string.IsNullOrWhiteSpace(user.Username)
                    ? user.Email
                    : "@" + user.Username;
                MenuProfileBrush = ChatPeerPalette.AvatarBrush(MenuProfileName);
                MenuProfileInitials = ChatPeerPalette.Initials(MenuProfileName);
                if (!string.IsNullOrWhiteSpace(user.AvatarUrl))
                {
                    var avatarUrl = user.AvatarUrl;
                    _ = Task.Run(async () =>
                    {
                        var image = await _imageLoader.LoadAsync(avatarUrl, decodePixelWidth: 96);
                        if (image is not null)
                        {
                            MenuProfileAvatarImage = image;
                        }
                    });
                }
            });
        }
        catch
        {
            // Шапка меню покажет плейсхолдер — данные не критичны.
        }
    }

    /// <summary>
    /// «Ночной режим»: локально переключает палитру (как Settings → внешний вид)
    /// и best-effort сохраняет выбор через PATCH /settings/me.
    /// </summary>
    private async Task ToggleNightThemeSafelyAsync(CancellationToken cancellationToken)
    {
        var mode = IsNightTheme ? "light" : "dark";
        NativeThemeManager.Apply(mode);
        try
        {
            var settings = await _api.GetMySettingsAsync(cancellationToken);
            await _api.UpdateMySettingsAsync(
                mode,
                settings.FontFamily ?? "Aptos",
                settings.FontScale ?? 1.0,
                cancellationToken);
        }
        catch
        {
            // Локальное переключение уже применено — сохранение не блокирует.
        }
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
                OnPropertyChanged(nameof(IsConversationSearchEmpty));
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
                RaiseGroupCommandStates();
            }
        }
    }

    /// <summary>
    /// Владелец группы: назначение ролей, передача владения, название/фото,
    /// posting_policy и удаление группы (canManageOwners в web).
    /// </summary>
    public bool CanManageGroupOwners
    {
        get => _canManageGroupOwners;
        private set
        {
            if (SetProperty(ref _canManageGroupOwners, value))
            {
                RaiseGroupCommandStates();
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
        var isGroup = string.Equals(conversation.Kind, "group", StringComparison.Ordinal);
        CanManageGroupMembers = isGroup && (viewerRole is "owner" or "moderator");
        CanManageGroupOwners = isGroup && viewerRole == "owner";
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
            var canTransferOwnership = CanManageGroupOwners
                && memberUserId > 0
                && selfId != memberUserId
                && memberRole != "owner";
            // Меню модерации — гейты ChatContextPanel: роли меняет только owner,
            // ограничение действует по той же иерархии, что исключение.
            var moderation = new ChatGroupMemberModeration(
                CanPromote: CanManageGroupOwners && memberRole == "member",
                CanDemote: CanManageGroupOwners && memberRole == "moderator",
                CanRestrict: canRemove,
                RoleHandler: SetGroupMemberRoleAsync,
                RestrictHandler: RestrictGroupMemberAsync,
                LiftRestrictionHandler: LiftGroupMemberRestrictionAsync);
            GroupMembers.Add(new ChatGroupMemberItemViewModel(
                member, canRemove, RemoveGroupMemberAsync,
                canTransferOwnership, TransferGroupOwnershipAsync,
                moderation)
            {
                AvatarLoader = _imageLoader,
            });
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

    /// <summary>
    /// Назначить/снять модератора (PATCH members/{id}/role); только owner.
    /// Ответ — свежий detail, права пересчитываются из него.
    /// </summary>
    private async Task SetGroupMemberRoleAsync(ChatGroupMemberItemViewModel member, string role)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || member.UserId <= 0 || IsMemberActionBusy
            || role is not ("member" or "moderator"))
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.UpdateChatGroupMemberRoleAsync(
                conversation.Id, member.UserId, role, CancellationToken.None);
            RunOnUi(() => ApplyMemberMutationDetail(conversation, detail));
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
    /// Ограничить отправку (PUT members/{id}/restriction);
    /// durationSeconds: 3600/86400/604800, null — бессрочно до снятия.
    /// </summary>
    private async Task RestrictGroupMemberAsync(ChatGroupMemberItemViewModel member, int? durationSeconds)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || member.UserId <= 0 || !member.CanRestrict || IsMemberActionBusy)
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.RestrictChatGroupMemberAsync(
                conversation.Id, member.UserId, durationSeconds, CancellationToken.None);
            RunOnUi(() => ApplyMemberMutationDetail(conversation, detail));
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

    /// <summary>Снять ограничение (DELETE members/{id}/restriction).</summary>
    private async Task LiftGroupMemberRestrictionAsync(ChatGroupMemberItemViewModel member)
    {
        var conversation = _membersPanelConversation;
        if (conversation is null || member.UserId <= 0 || !member.CanRestrict || IsMemberActionBusy)
        {
            return;
        }

        IsMemberActionBusy = true;
        try
        {
            var detail = await _api.LiftChatGroupMemberRestrictionAsync(
                conversation.Id, member.UserId, CancellationToken.None);
            RunOnUi(() => ApplyMemberMutationDetail(conversation, detail));
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

    /// <summary>Свежий detail от мутации участника — в строку списка и в панель.</summary>
    private void ApplyMemberMutationDetail(
        ConversationItemViewModel conversation,
        HubChatConversationDetail detail)
    {
        if (!ReferenceEquals(_membersPanelConversation, conversation))
        {
            return;
        }

        conversation.Update(detail);
        RebuildVisibleConversations();
        ApplyGroupMembers(detail);
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
                        MemberCandidateResults.Add(new ChatUserItemViewModel(user)
                        {
                            AvatarLoader = _imageLoader,
                        });
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
        CanManageGroupOwners = false;
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

    /// <summary>Клик по плитке (UI-026): image/video/audio — тот же
    /// просмотрщик, что у пузыря; файлы — скачать и открыть как раньше.</summary>
    private Task OpenMediaItemAsync(ChatMediaItemViewModel item)
    {
        if (ResolveMediaViewerKind(item.Model) is not null)
        {
            OpenMediaViewerForGalleryItem(item);
            return Task.CompletedTask;
        }

        return DownloadAndOpenAttachmentAsync(item.MessageId, item.Model, item.FileName);
    }

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
    private Task OpenLinkPreviewAsync(
        ChatMessageViewModel message,
        ChatLinkPreviewItemViewModel item) =>
        OpenExternalLinkAsync(item.Url);

    /// <summary>
    /// Открытие http(s)-ссылки во внешнем браузере — общий guard для карточки
    /// превью и кликабельных ссылок в тексте пузыря (прочие схемы игнорируем).
    /// </summary>
    private async Task OpenExternalLinkAsync(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
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

    /// <summary>Заголовок Telegram-плашки закрепа (первая строка, акцентная).</summary>
    public string PinnedBarTitleText => "Закреплённое сообщение";

    /// <summary>Вторая строка плашки: «Автор: превью» без пиктограммы (она слева-полосой).</summary>
    public string PinnedBarPreviewText
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
                ? preview
                : $"{top.SenderName}: {preview}";
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
        OnPropertyChanged(nameof(PinnedBarPreviewText));
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
                        NormalizePollBody(dto), conversation.IsGroupLike)
                    {
                        ImageLoader = _imageLoader,
                    });
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
                    InsertMessageItem(Messages.Count, CreateMessageViewModel(dto, conversation.IsGroupLike));
                }

                HasOlder = page.HasOlder;
                _olderCursor = page.OlderCursorMessageId;
                var anchorId = page.InitialAnchorMessageId ?? messageId;
                SelectedMessage = Messages.FirstOrDefault(
                    m => string.Equals(m.Id, anchorId, StringComparison.Ordinal));
                if (SelectedMessage is { } anchor)
                {
                    // Скролл + акцентная вспышка пузыря — «go to anchor» как в tdesktop.
                    RequestScrollToMessage?.Invoke(anchor);
                    FlashMessageHighlight(anchor);
                }

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

                // Статусы якорного среза могли устареть за время прыжка —
                // догружаем read/реакции точечно, как hydrateThread в web.
                _ = HydrateLoadedMessagesSafelyAsync(conversation, cancellationToken);
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

    /// <summary>Клик по цитате ответа: к оригиналу — прокрутка к уже
    /// загруженному, подгрузка старших страниц (не больше 5 итераций), а
    /// если цель вне истории — thread-bootstrap как у pinned/search.</summary>
    private async Task OpenReplyTargetAsync(
        ChatMessageViewModel? message,
        CancellationToken cancellationToken)
    {
        var conversation = _selectedConversation;
        var targetId = message?.ReplyToMessageId;
        if (conversation is null || string.IsNullOrEmpty(targetId))
        {
            return;
        }

        ChatMessageViewModel? FindTarget() => Messages.FirstOrDefault(
            item => string.Equals(item.Id, targetId, StringComparison.Ordinal));

        var target = FindTarget();
        // Подгружаем старшие страницы ограниченно: «далекий» оригинал дешевле
        // открыть одним thread-bootstrap, чем тянуть всю историю.
        for (var attempt = 0;
             target is null && attempt < 5 && HasOlder && _olderCursor is not null;
             attempt++)
        {
            await LoadOlderAsync(cancellationToken);
            if (cancellationToken.IsCancellationRequested
                || !ReferenceEquals(_selectedConversation, conversation))
            {
                return;
            }

            target = FindTarget();
        }

        if (target is null)
        {
            // Цель старше подгруженной истории — тот же якорный переход,
            // что у pinned-бара и поиска по сообщениям.
            await JumpToAnchorAsync(conversation, targetId, closeSearch: false, cancellationToken);
            return;
        }

        SelectedMessage = target;
        RequestScrollToMessage?.Invoke(target);
        FlashMessageHighlight(target);
    }

    /// <summary>Секундная акцентная вспышка пузыря после перехода к якорю;
    /// маркер гасит устаревшие тики, чтобы повторный прыжок продлевал свечение.</summary>
    internal void FlashMessageHighlight(ChatMessageViewModel message)
    {
        var marker = ++_highlightMarker;
        message.IsHighlighted = true;
        RunDelayed(TimeSpan.FromMilliseconds(1100), () =>
        {
            if (_highlightMarker == marker)
            {
                message.IsHighlighted = false;
            }
        });
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
                var item = new ChatUserItemViewModel(user)
                {
                    AvatarLoader = _imageLoader,
                };
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
        // Флаги чата (scheduled_messages_enabled и др.) — фоном, параллельно
        // списку диалогов: «Отправить позже» появляется, когда конфиг придёт.
        _ = LoadChatConfigSafelyAsync();
        // Папки диалогов — тоже фоном: вкладки появятся над списком по готовности.
        _ = LoadChatFoldersSafelyAsync();
        // Профиль шапки ☰-меню — один GET на сессию.
        _ = LoadMenuProfileSafelyAsync(cancellationToken);
        try
        {
            await LoadConversationsCoreAsync(cancellationToken);
        }
        finally
        {
            await StartRealtimeSafelyAsync();
        }

        // Черновики — после списка: строкам сразу проставляем «Черновик: ».
        InitializeDrafts();
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
        _conversationTypingMarkers.Clear();
        // Клиентские черновики не переживают сессию — как clearAllDrafts в web.
        ClearAllDrafts();
        // Кэш фото — тоже: после смены пользователя чужие аватары не должны висеть.
        _imageLoader.Clear();
        // ComposerText в самом конце цепочки: если правка была активна,
        // ClearComposerContext вернул снапшот — после ClearAllDrafts его уже
        // нет, но свойство осталось заполненным; гасим явно (сессия сброшена,
        // ScheduleDraftSync здесь no-op — выбранного диалога нет).
        ComposerText = string.Empty;
        CloseMediaViewer();
        CloseMessageSearch();
        CloseGlobalSearch();
        CloseForwardPanel();
        CloseDeleteConfirm();
        IsDeleting = false;
        IsForwarding = false;
        IsReadersPanelOpen = false;
        IsLoadingReaders = false;
        ReadersTitleText = null;
        MessageReaders.Clear();
        ClearPinnedState();
        ExitMessageSelection();
        SelectedMessage = null;
        ShowArchived = false;
        SearchText = string.Empty;
        BannerErrorText = null;
        IsSending = false;
        IsUploading = false;
        UploadStatusText = null;
        ClearPendingAttachments();
        CancelVoiceSession();
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
        CloseGroupSettings();
        CloseJoinRequestsPanel();
        CloseReportsPanel();
        CloseReportDialog();
        CloseTaskShare();
        _taskShareCancellation?.Cancel();
        _linkPreviewRequests.Clear();
        ResetScheduledState();
        IsScheduledMessagesEnabled = false;
        _chatConfigRequested = false;
        // Папки/стикеры/ИИ — сессионное состояние не переживает выход.
        CloseFolderManager();
        FolderMembershipItems.Clear();
        IsFolderBusy = false;
        _newFolderName = string.Empty;
        OnPropertyChanged(nameof(NewFolderName));
        _renamingFolderName = string.Empty;
        OnPropertyChanged(nameof(RenamingFolderName));
        _menuProfileRequested = false;
        MenuProfileName = null;
        MenuProfileUsername = null;
        MenuProfileBrush = null;
        MenuProfileInitials = "•";
        MenuProfileAvatarImage = null;
        _customFolderTabs.Clear();
        _conversationIdsByFolder.Clear();
        _serverFolderUnreadCounts.Clear();
        _activeFolderKey = AllFolderKey;
        OnPropertyChanged(nameof(ActiveFolderKey));
        RebuildFolderTabs();
        CloseStickerPanel();
        IsPeerCardOpen = false;
        StickerPacks.Clear();
        SelectedStickerPack = null;
        _stickersLoaded = false;
        IsLoadingStickers = false;
        IsSendingSticker = false;
        _stickerImportSource = string.Empty;
        OnPropertyChanged(nameof(StickerImportSource));
        IsImportingStickerPack = false;
        CloseAiPanel();
        StopAiStatusPolling();
        AiConversations.Clear();
        AiBots.Clear();
        _aiBotsLoaded = false;
        IsLoadingAiBots = false;
        AiErrorText = null;
        IsAiActionBusy = false;
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
                .Where(MatchesActiveFolder)
                .Where(item => item.MatchesFilter(_searchText));
        var desired = source
            .OrderByDescending(item => item.IsPinned)
            .ThenByDescending(item => item.LastMessageAt ?? DateTimeOffset.MinValue)
            .ThenBy(item => item.Title, StringComparer.CurrentCultureIgnoreCase)
            .ToList();

        // Открытый диалог не закрывается от фильтра поиска: держим его первым
        // в выдаче, как в Telegram — иначе SelectedItem=Null у ListBox
        // заталкивает null обратно в SelectedConversation и гасит ленту.
        if (!string.IsNullOrWhiteSpace(_searchText)
            && _selectedConversation is { } open
            && !desired.Contains(open))
        {
            desired.Insert(0, open);
        }

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
        OnPropertyChanged(nameof(ArchiveHeaderText));
        RaiseScrollFabBadge();
        // Бейджи вкладок без серверного покрытия — локальный пересчёт;
        // список AI-диалогов панели держим синхронным с общим.
        RefreshFolderTabStates();
        RefreshAiConversationList();
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
        HasOlderHistoryError = false;
        _olderCursor = null;
        HistoryErrorText = null;
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
                InsertMessageItem(Messages.Count, CreateMessageViewModel(message, conversation.IsGroupLike));
            }

            HasOlder = page.HasOlder;
            _olderCursor = page.OlderCursorMessageId;
            BannerErrorText = null;
            // Полоса «Непрочитанные сообщения» — до ClearUnread, пока счётчик
            // строки жив: one-shot unread bar, realtime её не дублирует.
            ApplyUnreadDivider(conversation.UnreadCount, page.ViewerLastReadMessageId);
            conversation.ClearUnread();
            OnPropertyChanged(nameof(TotalUnreadCount));

            // UI-017: страница истории несёт delivery_status — синк галочек строки.
            if (Messages.LastOrDefault() is { } tailMessage)
            {
                conversation.SyncLastMessageStatus(tailMessage);
            }

            var lastId = Messages.LastOrDefault()?.Id;
            if (!string.IsNullOrEmpty(lastId))
            {
                _ = MarkReadSafelyAsync(conversation.Id, lastId);
            }

            _ = LoadPinnedMessagesSafelyAsync(conversation, cancellation.Token);
            _ = HydrateLoadedMessagesSafelyAsync(conversation, cancellation.Token);
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception ex)
        {
            if (ReferenceEquals(_selectedConversation, conversation))
            {
                var errorText = TasksViewModel.DescribeError(ex);
                // Ошибка истории — и в баннер (с диспетчером RetryCommand), и в
                // панель ленты: «Сообщений пока нет» при ней не показывается.
                HistoryErrorText = errorText;
                BannerErrorText = errorText;
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

    /// <summary>
    /// Unread bar tdesktop: полоса «Непрочитанные сообщения» над первым
    /// непрочитанным входящим — один раз при открытии диалога. Якорь —
    /// viewer_last_read_message_id из ответа; если его нет или он вне
    /// загруженной страницы — отсчитываем UnreadCount входящих с конца ленты.
    /// </summary>
    private void ApplyUnreadDivider(int unreadCount, string? viewerLastReadMessageId)
    {
        if (unreadCount <= 0 || Messages.Count == 0)
        {
            return;
        }

        var index = -1;
        if (!string.IsNullOrEmpty(viewerLastReadMessageId))
        {
            for (var i = 0; i < Messages.Count; i++)
            {
                if (!string.Equals(Messages[i].Id, viewerLastReadMessageId, StringComparison.Ordinal))
                {
                    continue;
                }

                for (var j = i + 1; j < Messages.Count; j++)
                {
                    if (!Messages[j].IsOwn)
                    {
                        index = j;
                        break;
                    }
                }

                break;
            }
        }

        if (index < 0)
        {
            // Запасной путь: UnreadCount-е входящее с конца; когда счётчик
            // больше входящих страницы — полоса над первым входящим.
            var seen = 0;
            var firstIncoming = -1;
            for (var i = Messages.Count - 1; i >= 0; i--)
            {
                if (Messages[i].IsOwn)
                {
                    continue;
                }

                firstIncoming = i;
                if (++seen == unreadCount)
                {
                    index = i;
                    break;
                }
            }

            index = index >= 0 ? index : firstIncoming;
        }

        if (index >= 0)
        {
            Messages[index].ShowUnreadDivider = true;
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
        HasOlderHistoryError = false;
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

                InsertMessageItem(index++, CreateMessageViewModel(message, conversation.IsGroupLike));
            }

            HasOlder = page.HasOlder;
            _olderCursor = page.OlderCursorMessageId;
        }
        catch (Exception ex) when (ex is not OperationCanceledException
            && ReferenceEquals(_selectedConversation, conversation))
        {
            HasOlderHistoryError = true;
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
                // ClearComposerContext сам вернёт снапшот черновика в composer.
                ClearComposerContext();
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
            // Черновик отправленного диалога сгорает — даже если выбор уже
            // ушёл на другой диалог (removeDraft on submit в web).
            PersistDraftNow(conversation.Id, null);
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

    /// <summary>Параметр команды дропа/вставки: string[], перечисление или один путь.</summary>
    private static IReadOnlyList<string> NormalizeDroppedPaths(object? parameter) =>
        parameter switch
        {
            IReadOnlyList<string> list => list,
            IEnumerable<string> enumerable => enumerable.ToList(),
            string single => [single],
            _ => [],
        };

    /// <summary>
    /// Постановка файлов в очередь подтверждения (UI-027): валидация и список —
    /// сеть не трогается. Повторный выбор в том же диалоге дополняет очередь,
    /// в другом — заменяет (получатель всегда один — открытый диалог выбора).
    /// Загрузка стартует только из ConfirmAttachmentsAsync.
    /// </summary>
    internal Task AttachFilesAsync(IReadOnlyList<string> paths, CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null || paths.Count == 0)
        {
            return Task.CompletedTask;
        }

        if (!ReferenceEquals(_pendingAttachmentConversation, conversation))
        {
            PendingAttachments.Clear();
            AttachmentCaption = null;
        }

        _pendingAttachmentConversation = conversation;
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
                    return Task.CompletedTask;
                }

                PendingAttachments.Add(new PendingAttachmentItemViewModel(
                    path,
                    new HubChatUploadFileRequest
                    {
                        FileName = info.Name,
                        MimeType = GuessMimeType(info.Extension),
                        Size = info.Length,
                        OriginalSize = info.Length,
                    }));
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                BannerErrorText = $"Нет доступа к файлу «{Path.GetFileName(path)}».";
                return Task.CompletedTask;
            }
        }

        RaisePendingAttachmentChanged();
        return Task.CompletedTask;
    }

    /// <summary>Пересчёт заголовка/счётчика очереди и состояния кнопок модала.</summary>
    private void RaisePendingAttachmentChanged()
    {
        OnPropertyChanged(nameof(IsAttachmentConfirmOpen));
        OnPropertyChanged(nameof(PendingAttachmentTitleText));
        OnPropertyChanged(nameof(PendingAttachmentTargetTitle));
        (ConfirmAttachmentsCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>Сброс очереди подтверждения: модал закрывается, файлы не отправлены.</summary>
    internal void ClearPendingAttachments()
    {
        if (PendingAttachments.Count == 0 && _pendingAttachmentConversation is null)
        {
            return;
        }

        PendingAttachments.Clear();
        _pendingAttachmentConversation = null;
        AttachmentCaption = null;
        RaisePendingAttachmentChanged();
    }

    // ═══ Голосовые сообщения (UI-028): запись → предпрослушивание → отправка ═══

    private INativeVoiceRecorder? _voiceRecorder;
    private NativeVoiceRecording? _voiceDraft;
    private ConversationItemViewModel? _voiceConversation;
    private CancellationTokenSource? _voiceUiCts;
    private bool _isVoiceRecording;
    private bool _isVoicePreviewPlaying;
    private string _voiceElapsedText = "0:00";

    /// <summary>Идёт запись — composer показывает панель с таймером и отменой.</summary>
    public bool IsVoiceRecording
    {
        get => _isVoiceRecording;
        private set => SetProperty(ref _isVoiceRecording, value);
    }

    /// <summary>Запись остановлена и ждёт «Прослушать/Отправить/Удалить».</summary>
    public bool HasVoiceDraft => _voiceDraft is not null;

    /// <summary>Панель голосового вместо поля ввода (запись или черновик).</summary>
    public bool VoiceBarVisible => IsVoiceRecording || HasVoiceDraft;

    /// <summary>Текст панели: «Запись m:ss» при записи, «Голосовое m:ss» у черновика.</summary>
    public string VoiceElapsedText
    {
        get => _voiceElapsedText;
        private set => SetProperty(ref _voiceElapsedText, value);
    }

    /// <summary>Путь записанного файла — view ставит его в MediaElement превью.</summary>
    public string? VoicePreviewSource => _voiceDraft?.FilePath;

    /// <summary>Играет ли превью черновика — двигает глиф ▶/⏸ и реальный плеер.</summary>
    public bool IsVoicePreviewPlaying
    {
        get => _isVoicePreviewPlaying;
        set => SetProperty(ref _isVoicePreviewPlaying, value);
    }

    /// <summary>Фабрика рекордера — в тестах фейк, в проде MediaCapture (UI-028).</summary>
    public Func<INativeVoiceRecorder>? VoiceRecorderFactory { get; set; }

    public bool CanVoiceRecord =>
        HasConversation && !IsSending && !IsUploading && EditingMessage is null && !IsVoiceRecording;

    public ICommand StartVoiceRecordingCommand { get; }
    public ICommand StopVoiceRecordingCommand { get; }
    public ICommand CancelVoiceRecordingCommand { get; }
    public ICommand SendVoiceMessageCommand { get; }
    public ICommand ToggleVoicePreviewCommand { get; }

    /// <summary>MediaElement доиграл черновик — view сигналит сюда, глиф → ▶.</summary>
    public void NotifyVoicePreviewEnded() => IsVoicePreviewPlaying = false;

    private static string FormatVoiceElapsed(TimeSpan span) =>
        span.ToString(span.TotalHours >= 1 ? @"h\:mm\:ss" : @"m\:ss", CultureInfo.InvariantCulture);

    private async Task StartVoiceRecordingAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null || !CanVoiceRecord)
        {
            return;
        }

        var recorder = VoiceRecorderFactory?.Invoke() ?? new MediaCaptureVoiceRecorder();
        try
        {
            await recorder.StartAsync(cancellationToken);
        }
        catch (NativeVoiceStartException ex)
        {
            BannerErrorText = ex.Kind switch
            {
                NativeVoiceStartError.NoDevice => "Микрофон не найден — проверьте подключение.",
                NativeVoiceStartError.PermissionDenied => "Нет доступа к микрофону — разрешите его в настройках Windows.",
                _ => "Запись голосовых недоступна на этом устройстве.",
            };
            recorder.Dispose();
            return;
        }
        catch (OperationCanceledException)
        {
            recorder.Dispose();
            return;
        }

        _voiceRecorder = recorder;
        _voiceConversation = conversation;
        IsVoiceRecording = true;
        VoiceElapsedText = "Запись 0:00";
        _voiceUiCts = new CancellationTokenSource();
        _ = RunVoiceElapsedLoopAsync(recorder, _voiceUiCts.Token);
        RaiseVoiceStates();
    }

    /// <summary>Таймер строки «Запись m:ss» — опрос Elapsed раз в полсекунды.</summary>
    private async Task RunVoiceElapsedLoopAsync(
        INativeVoiceRecorder recorder, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(500));
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                VoiceElapsedText = "Запись " + FormatVoiceElapsed(recorder.Elapsed);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task StopVoiceRecordingAsync(CancellationToken cancellationToken)
    {
        var recorder = _voiceRecorder;
        _voiceRecorder = null;
        if (recorder is null)
        {
            return;
        }

        try
        {
            _voiceDraft = await recorder.StopAsync(cancellationToken);
            VoiceElapsedText = "Голосовое " + FormatVoiceElapsed(_voiceDraft.Duration);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            _voiceUiCts?.Cancel();
            _voiceUiCts = null;
            IsVoiceRecording = false;
            recorder.Dispose();
            RaiseVoiceStates();
        }
    }

    /// <summary>Отмена записи/черновика: рекордер обрывается, temp-файл чистится,
    /// сеть не трогается. Смена диалога и сброс сессии идут сюда же (UI-028).</summary>
    private void CancelVoiceSession()
    {
        _voiceUiCts?.Cancel();
        _voiceUiCts = null;
        var recorder = _voiceRecorder;
        _voiceRecorder = null;
        recorder?.Abort();
        recorder?.Dispose();
        DeleteVoiceDraftFile();
        _voiceDraft = null;
        _voiceConversation = null;
        IsVoiceRecording = false;
        IsVoicePreviewPlaying = false;
        RaiseVoiceStates();
    }

    /// <summary>Удалить temp-файл черновика — после отправки и отмены.</summary>
    private void DeleteVoiceDraftFile()
    {
        var path = _voiceDraft?.FilePath;
        if (path is null)
        {
            return;
        }

        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
            }
        }
        catch (IOException)
        {
        }
        catch (UnauthorizedAccessException)
        {
        }
    }

    private void RaiseVoiceStates()
    {
        OnPropertyChanged(nameof(IsVoiceRecording));
        OnPropertyChanged(nameof(HasVoiceDraft));
        OnPropertyChanged(nameof(VoiceBarVisible));
        OnPropertyChanged(nameof(VoicePreviewSource));
        OnPropertyChanged(nameof(SendButtonText));
        OnPropertyChanged(nameof(ShowSendFab));
        OnPropertyChanged(nameof(ShowMicFab));
        OnPropertyChanged(nameof(CanVoiceRecord));
        (StartVoiceRecordingCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (StopVoiceRecordingCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (SendVoiceMessageCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>Отправка черновика: та же upload-сессия, файл voice_*.m4a
    /// с media_kind=audio и duration_seconds — как у web (UI-028).</summary>
    private async Task SendVoiceMessageAsync(CancellationToken cancellationToken)
    {
        var draft = _voiceDraft;
        var conversation = _voiceConversation;
        if (draft is null || conversation is null || IsUploading || IsSending)
        {
            return;
        }

        var info = new FileInfo(draft.FilePath);
        if (!info.Exists || info.Length <= 0)
        {
            BannerErrorText = "Запись потеряна — файл черновика недоступен.";
            CancelVoiceSession();
            return;
        }

        var request = new HubChatUploadFileRequest
        {
            FileName = Path.GetFileName(draft.FilePath),
            MimeType = draft.MimeType,
            MediaKind = "audio",
            Size = info.Length,
            OriginalSize = info.Length,
            DurationSeconds = (int)Math.Round(draft.Duration.TotalSeconds),
        };
        IsUploading = true;
        try
        {
            if (await UploadFilesToConversationAsync(
                    conversation, null, [request], [draft.FilePath], cancellationToken))
            {
                _voiceUiCts?.Cancel();
                _voiceUiCts = null;
                DeleteVoiceDraftFile();
                _voiceDraft = null;
                _voiceConversation = null;
                IsVoicePreviewPlaying = false;
                RaiseVoiceStates();
            }
        }
        finally
        {
            IsUploading = false;
            UploadStatusText = null;
        }
    }

    /// <summary>
    /// Подтверждение очереди (UI-027): POST upload-session → чанки по
    /// chunk_size_bytes → POST complete → готовое сообщение в ленту. Подпись
    /// модала и ответ-на идут в тело сессии; черновик composer не расходуется.
    /// </summary>
    private async Task ConfirmAttachmentsAsync(CancellationToken cancellationToken)
    {
        var conversation = _pendingAttachmentConversation;
        if (conversation is null || PendingAttachments.Count == 0 || IsUploading || IsSending)
        {
            return;
        }

        var requests = PendingAttachments.Select(i => i.Request).ToList();
        var sourcePaths = PendingAttachments.Select(i => i.Path).ToList();
        var caption = string.IsNullOrWhiteSpace(AttachmentCaption) ? null : AttachmentCaption.Trim();

        IsUploading = true;
        try
        {
            if (await UploadFilesToConversationAsync(
                    conversation, caption, requests, sourcePaths, cancellationToken))
            {
                ClearPendingAttachments();
            }
        }
        finally
        {
            IsUploading = false;
            UploadStatusText = null;
        }
    }

    /// <summary>
    /// Общий upload-пайплайн (UI-027/UI-028): POST upload-session → чанки по
    /// chunk_size_bytes → POST complete → сообщение в ленту. Подпись и
    /// ответ-на идут в тело сессии. Возвращает true при успехе — очистка
    /// очереди/голосового на вызывающей стороне.
    /// </summary>
    private async Task<bool> UploadFilesToConversationAsync(
        ConversationItemViewModel conversation,
        string? caption,
        IReadOnlyList<HubChatUploadFileRequest> requests,
        IReadOnlyList<string> sourcePaths,
        CancellationToken cancellationToken)
    {
        UploadStatusText = requests.Count == 1
            ? $"Отправка файла «{requests[0].FileName}»…"
            : $"Отправка {requests.Count} файлов…";
        var clientMessageId = Guid.NewGuid().ToString("N");
        try
        {
            var session = await _api.CreateChatUploadSessionAsync(
                conversation.Id,
                caption,
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
                return false;
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
                // Ответ-на израсходован отправкой — снимаем, как при обычной
                // отправке; черновик composer не трогаем — подпись отдельная.
                InsertMessage(message, conversation.IsGroupLike);
                ClearComposerContext();
            }

            conversation.UpdateLastMessage(message);
            RebuildVisibleConversations();
            BannerErrorText = null;
            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
            return false;
        }
    }

    /// <summary>Вложения, которые скачиваются прямо сейчас: все ожидающие
    /// делят одну задачу — второй клик не дублирует запрос, а просмотрщик
    /// просто дожидается той же загрузки (UI-026).</summary>
    private readonly Dictionary<string, Task<string?>> _attachmentDownloadsInFlight =
        new(StringComparer.Ordinal);

    /// <summary>
    /// Чип вложения нажат (UI-026): image/video/audio — просмотрщик Telegram
    /// (встроенное воспроизведение или fallback), файлы/стикеры — скачивание
    /// в temp и открытие ассоциацией ОС.
    /// </summary>
    private Task OpenAttachmentAsync(
        ChatMessageViewModel message,
        ChatAttachmentItemViewModel item)
    {
        if (!string.IsNullOrEmpty(message.Id)
            && ResolveMediaViewerKind(item.Model) is not null)
        {
            OpenMediaViewer(message, item);
            return Task.CompletedTask;
        }

        return DownloadAndOpenAttachmentAsync(message.Id, item.Model, item.FileName);
    }

    /// <summary>
    /// Открыть просмотрщик на нажатом вложении (UI-026): список — все
    /// просматриваемые вложения ленты (image+video+audio) в порядке сообщений.
    /// </summary>
    private void OpenMediaViewer(ChatMessageViewModel message, ChatAttachmentItemViewModel clicked)
    {
        _mediaViewerItems.Clear();
        foreach (var entry in Messages)
        {
            if (string.IsNullOrEmpty(entry.Id))
            {
                continue;
            }

            foreach (var attachment in entry.AttachmentItems)
            {
                var kind = ResolveMediaViewerKind(attachment.Model);
                if (kind is not null && !string.IsNullOrEmpty(attachment.Id))
                {
                    _mediaViewerItems.Add(new MediaViewerEntry(
                        entry.Id!, attachment.Model, attachment.FileName, kind.Value));
                }
            }
        }

        var index = _mediaViewerItems.FindIndex(
            entry => string.Equals(entry.Model.Id, clicked.Id, StringComparison.Ordinal));
        if (index < 0)
        {
            return;
        }

        _mediaViewerGallerySource = false;
        IsMediaViewerOpen = true;
        _ = ShowMediaViewerItemAsync(index);
    }

    /// <summary>
    /// Открыть просмотрщик из плитки галереи (UI-026): список — все
    /// просматриваемые плитки текущей вкладки в том же порядке; при листании
    /// к концу загруженного списка дотягивается следующая страница.
    /// </summary>
    private void OpenMediaViewerForGalleryItem(ChatMediaItemViewModel clicked)
    {
        RebuildMediaViewerEntriesFromGallery();
        var index = _mediaViewerItems.FindIndex(
            entry => string.Equals(entry.Model.Id, clicked.Model.Id, StringComparison.Ordinal));
        if (index < 0)
        {
            return;
        }

        _mediaViewerGallerySource = true;
        IsMediaViewerOpen = true;
        _ = ShowMediaViewerItemAsync(index);
    }

    /// <summary>Список просмотрщика из плиток галереи: только просматриваемые
    /// kind'ы, порядок сетки (created_at desc) сохранён.</summary>
    private void RebuildMediaViewerEntriesFromGallery()
    {
        _mediaViewerItems.Clear();
        foreach (var tile in MediaItems)
        {
            var kind = ResolveMediaViewerKind(tile.Model);
            if (kind is not null && !string.IsNullOrEmpty(tile.Model.Id))
            {
                _mediaViewerItems.Add(new MediaViewerEntry(
                    tile.MessageId, tile.Model, tile.FileName, kind.Value));
            }
        }
    }

    /// <summary>
    /// Показать элемент просмотрщика (UI-026): image — полный кадр через
    /// AuthImageLoader; video/audio из проигрываемых контейнеров — скачиваем
    /// в temp и отдаём MediaElement; прочее — fallback с явным внешним
    /// запуском. Галерейный список при упоре в конец дотягивает страницу.
    /// </summary>
    private async Task ShowMediaViewerItemAsync(int index)
    {
        if (!IsMediaViewerOpen || index < 0)
        {
            return;
        }

        if (index >= _mediaViewerItems.Count)
        {
            // Галерея: конец загруженного — подтягиваем следующую страницу
            // и пересобираем список (курсоры/флаги живут в _mediaStreams).
            if (!_mediaViewerGallerySource || !HasMoreMedia || IsLoadingMoreMedia)
            {
                return;
            }

            await LoadMoreMediaAsync(CancellationToken.None);
            RebuildMediaViewerEntriesFromGallery();
            if (index >= _mediaViewerItems.Count)
            {
                // Страница ничего просматриваемого не добавила — конец списка.
                return;
            }
        }

        _mediaViewerIndex = index;
        OnPropertyChanged(nameof(MediaViewerTitle));
        OnPropertyChanged(nameof(MediaViewerCounterText));
        OnPropertyChanged(nameof(MediaViewerCanGoBack));
        OnPropertyChanged(nameof(MediaViewerCanGoForward));

        var marker = ++_mediaViewerLoadMarker;
        MediaViewerImage = null;
        MediaViewerMediaSource = null;
        _mediaViewerPlaybackKind = null;
        MediaViewerUnsupportedText = null;
        MediaViewerStatusText = null;
        RaiseMediaViewerKindChanged();
        var entry = _mediaViewerItems[index];
        if (entry.Kind == MediaViewerContentKind.Unsupported)
        {
            IsMediaViewerLoading = false;
            MediaViewerUnsupportedText =
                $"«{entry.DisplayName}» — формат не поддерживается встроенным просмотром.";
            RaiseMediaViewerKindChanged();
            return;
        }

        IsMediaViewerLoading = true;
        if (entry.Kind == MediaViewerContentKind.Image)
        {
            // Полный размер нужен только на экран: ~1600px покрывает и ретину ноутбука.
            var image = await _imageLoader.LoadAsync(
                "chat/messages/" + Uri.EscapeDataString(entry.MessageId)
                + "/attachments/" + Uri.EscapeDataString(entry.Model.Id!) + "/file",
                decodePixelWidth: 1600);
            if (marker != _mediaViewerLoadMarker)
            {
                // Успели листнуть/закрыть — результат уже не актуален.
                return;
            }

            IsMediaViewerLoading = false;
            MediaViewerImage = image;
            if (image is null)
            {
                MediaViewerUnsupportedText = $"Не удалось показать изображение «{entry.DisplayName}».";
                RaiseMediaViewerKindChanged();
            }

            return;
        }

        // Video/Audio: файл целиком в temp — MediaElement играет с диска,
        // сетевого стриминга в контракте нет. Путь уходит в Source элемента
        // view; закрытие/смена элемента обнуляет источник и гасит звук.
        var localPath = await DownloadAttachmentToTempAsync(
            entry.MessageId, entry.Model, entry.DisplayName);
        if (marker != _mediaViewerLoadMarker)
        {
            return;
        }

        IsMediaViewerLoading = false;
        if (localPath is null)
        {
            MediaViewerUnsupportedText =
                $"«{entry.DisplayName}» — файл недоступен для воспроизведения.";
            RaiseMediaViewerKindChanged();
            return;
        }

        _mediaViewerPlaybackKind = entry.Kind == MediaViewerContentKind.Video ? "video" : "audio";
        RaiseMediaViewerKindChanged();
        MediaViewerMediaSource = localPath;
    }

    private void MoveMediaViewer(int delta) =>
        _ = ShowMediaViewerItemAsync(_mediaViewerIndex + delta);

    /// <summary>Уведомления флагов вида контента просмотрщика (image/video/audio/fallback).</summary>
    private void RaiseMediaViewerKindChanged()
    {
        OnPropertyChanged(nameof(MediaViewerIsImage));
        OnPropertyChanged(nameof(MediaViewerIsVideo));
        OnPropertyChanged(nameof(MediaViewerIsAudio));
        OnPropertyChanged(nameof(MediaViewerIsUnsupported));
    }

    /// <summary>✕ / Esc / смена диалога — закрыть просмотрщик и сбросить список.</summary>
    private void CloseMediaViewer()
    {
        if (!IsMediaViewerOpen && _mediaViewerItems.Count == 0)
        {
            return;
        }

        _mediaViewerLoadMarker++;
        IsMediaViewerOpen = false;
        IsMediaViewerLoading = false;
        MediaViewerImage = null;
        // null-источник — сигнал view остановить MediaElement: звука после
        // закрытия просмотрщика быть не должно (UI-026).
        _mediaViewerPlaybackKind = null;
        MediaViewerMediaSource = null;
        MediaViewerUnsupportedText = null;
        MediaViewerStatusText = null;
        RaiseMediaViewerKindChanged();
        _mediaViewerItems.Clear();
        _mediaViewerIndex = -1;
        _mediaViewerGallerySource = false;
    }

    /// <summary>«Сохранить» в просмотрщике: скачать на диск без внешнего
    /// запуска — статус в шапке показывает целевой путь (UI-026).</summary>
    private async Task SaveMediaViewerItemAsync(MediaViewerEntry entry)
    {
        var path = await DownloadAttachmentToTempAsync(entry.MessageId, entry.Model, entry.DisplayName);
        if (path is not null && _mediaViewerIndex < _mediaViewerItems.Count
            && ReferenceEquals(_mediaViewerItems[_mediaViewerIndex], entry))
        {
            MediaViewerStatusText = $"Сохранено: {Path.GetFileName(path)}";
        }
    }

    /// <summary>
    /// Скачивание вложения в temp-папку с дедупом: повторный вызов делит
    /// уже идущую задачу. Возвращает путь к локальному файлу либо null при
    /// ошибке (баннер выставляется здесь же). Внешний запуск — отдельно:
    /// просмотрщик и «Сохранить» играют/складывают файл без Process.Start.
    /// </summary>
    private async Task<string?> DownloadAttachmentToTempAsync(
        string? messageId,
        HubChatAttachment model,
        string displayName)
    {
        var attachmentId = model.Id;
        if (string.IsNullOrEmpty(messageId) || string.IsNullOrEmpty(attachmentId))
        {
            return null;
        }

        var downloadKey = messageId + ":" + attachmentId;
        if (_attachmentDownloadsInFlight.TryGetValue(downloadKey, out var inFlight))
        {
            return await inFlight;
        }

        var task = DownloadAttachmentToTempCoreAsync(messageId, attachmentId, model, displayName, downloadKey);
        _attachmentDownloadsInFlight[downloadKey] = task;
        try
        {
            return await task;
        }
        finally
        {
            _attachmentDownloadsInFlight.Remove(downloadKey);
        }
    }

    private async Task<string?> DownloadAttachmentToTempCoreAsync(
        string messageId,
        string attachmentId,
        HubChatAttachment model,
        string displayName,
        string downloadKey)
    {
        try
        {
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

            return target;
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
            return null;
        }
    }

    /// <summary>
    /// Общий путь открытия вложения: чип файла в пузыре, «Открыть в другом
    /// приложении» просмотрщика — скачивание в temp (с дедупом) + запуск
    /// ассоциацией ОС, только по явному выбору пользователя (UI-026).
    /// </summary>
    private async Task DownloadAndOpenAttachmentAsync(
        string? messageId,
        HubChatAttachment model,
        string displayName)
    {
        if (AttachmentSaver is not null)
        {
            await AttachmentSaver(model, messageId);
            return;
        }

        var target = await DownloadAttachmentToTempAsync(messageId, model, displayName);
        if (target is null)
        {
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    /// <summary>
    /// Просматриваемый kind вложения для просмотрщика (UI-026): по
    /// media_kind/kind → mime → расширению. Файл/стикер/неопознанное —
    /// null: такие чипы по-прежнему уходят в скачивание+открытие.
    /// Непроигрываемый контейнер → Unsupported (fallback с явным
    /// «Открыть в другом приложении»).
    /// </summary>
    private static MediaViewerContentKind? ResolveMediaViewerKind(HubChatAttachment attachment)
    {
        var kind = attachment.MediaKind ?? attachment.Kind;
        var mime = attachment.MimeType;
        var extension = Path.GetExtension(attachment.FileName ?? string.Empty).ToLowerInvariant();
        var isImage = string.Equals(kind, "image", StringComparison.OrdinalIgnoreCase)
            || (mime?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ?? false)
            || ChatAttachmentItemViewModel.HasImageExtension(attachment.FileName);
        if (isImage)
        {
            return MediaViewerContentKind.Image;
        }

        var isVideo = string.Equals(kind, "video", StringComparison.OrdinalIgnoreCase)
            || (mime?.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ?? false);
        if (isVideo)
        {
            return PlayableVideoExtensions.Contains(extension)
                ? MediaViewerContentKind.Video
                : MediaViewerContentKind.Unsupported;
        }

        var isAudio = string.Equals(kind, "audio", StringComparison.OrdinalIgnoreCase)
            || (mime?.StartsWith("audio/", StringComparison.OrdinalIgnoreCase) ?? false);
        if (isAudio)
        {
            return PlayableAudioExtensions.Contains(extension)
                ? MediaViewerContentKind.Audio
                : MediaViewerContentKind.Unsupported;
        }

        return null;
    }

    /// <summary>Контейнеры, которые WPF MediaElement играет без кодек-паков.</summary>
    private static readonly HashSet<string> PlayableVideoExtensions = new(StringComparer.Ordinal)
    {
        ".mp4", ".m4v", ".mov", ".wmv", ".avi", ".mpg", ".mpeg", ".3gp",
    };

    private static readonly HashSet<string> PlayableAudioExtensions = new(StringComparer.Ordinal)
    {
        ".mp3", ".wav", ".m4a", ".aac", ".wma", ".mid", ".midi",
    };

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

        InsertMessageItem(index, CreateMessageViewModel(message, isGroupConversation));
        return true;
    }

    /// <summary>
    /// Вставка/добавление сообщения с пересчётом визуальной группировки
    /// (пилюля дня, серия одного отправителя) у нового элемента и соседей.
    /// </summary>
    private void InsertMessageItem(int index, ChatMessageViewModel item)
    {
        Messages.Insert(index, item);
        RefreshMessageGroupingAt(index - 1);
        RefreshMessageGroupingAt(index);
        RefreshMessageGroupingAt(index + 1);
    }

    /// <summary>Пересчитать флаги группировки сообщения по его соседям в ленте.</summary>
    private void RefreshMessageGroupingAt(int index)
    {
        if (index < 0 || index >= Messages.Count)
        {
            return;
        }

        var previous = index > 0 ? Messages[index - 1] : null;
        var next = index + 1 < Messages.Count ? Messages[index + 1] : null;
        Messages[index].ApplyGrouping(previous, next);
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
            BodyLinkHandler = OpenExternalLinkAsync,
            PollVoteHandler = VotePollAsync,
            PollCloseHandler = ClosePollAsync,
            ReplyTargetHandler = message => OpenReplyTargetAsync(message, CancellationToken.None),
            ActionConfirmHandler = ConfirmAiActionAsync,
            ActionCancelHandler = CancelAiActionAsync,
            ActionResultOpenHandler = OpenAiActionResultAsync,
            ImageLoader = _imageLoader,
            IsPinned = message.Id is not null && _pinnedMessageIds.Contains(message.Id),
        };

    /// <summary>
    /// Строка диалога: меню вызывает PATCH settings, GET export и POST leave для групп.
    /// </summary>
    private ConversationItemViewModel CreateConversationViewModel(HubChatConversation conversation)
    {
        var item = new ConversationItemViewModel(conversation)
        {
            SettingsHandler = ToggleConversationSettingAsync,
            LeaveHandler = LeaveGroupConversationAsync,
            ExportHandler = ExportConversationAsync,
            AvatarLoader = _imageLoader,
        };
        // Строка сразу получает черновик — иначе поздние страницы списка
        // (подгрузка, пересборка фильтра) теряли бы «Черновик: ».
        if (_drafts.TryGetValue(item.Id, out var draft))
        {
            item.SetDraft(draft);
        }

        return item;
    }

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

    /// <summary>Прятать индикатор шапки открытого диалога и гасить его таймер авто-сброса.</summary>
    private void ClearTypingIndicator()
    {
        // Маркер шапки и строки общий: смена диалога не трогает «печатает…» на
        // строке списка — то состояние живёт своим таймером до expires_in_ms.
        if (_selectedConversation is { } current)
        {
            _conversationTypingMarkers[current.Id] =
                _conversationTypingMarkers.GetValueOrDefault(current.Id) + 1;
        }

        TypingText = null;
    }

    // ── Клиентские черновики (parity web chatDraftsStorage.js) ─────────────

    /// <summary>Дебаунс записи черновика — как draftWriteTimeout в web (~320 мс).</summary>
    private const int DraftDebounceMs = 320;

    /// <summary>
    /// Подмена стора черновиков для харнессов (скриншоты держат демо-VM без
    /// инъекции — иначе ленивый стор писал бы в реальный %LocalAppData%).
    /// </summary>
    internal INativeChatDraftStore? DraftStore
    {
        get => _draftStore;
        set => _draftStore = value;
    }

    /// <summary>
    /// Ленивая привязка стораджа к текущему пользователю: файл — отдельный на
    /// userId (как chat:draft:&lt;userId&gt;:… в web localStorage). Без сессии
    /// черновики живут только в памяти — чужой файл не трогаем.
    /// </summary>
    private INativeChatDraftStore? EnsureDraftStore()
    {
        if (_draftStore is not null)
        {
            return _draftStore;
        }

        var userId = _api.CurrentSession?.UserId;
        if (userId is null)
        {
            return null;
        }

        _draftStore = new NativeChatDraftStore(userId.Value);
        _draftUserId = userId.Value;
        return _draftStore;
    }

    /// <summary>
    /// Одноразовая загрузка черновиков после первой загрузки диалогов: store
    /// сам подметает TTL/лимит (sweep в web). Строкам черновик подставляет и
    /// CreateConversationViewModel — поздние страницы списка не теряют его.
    /// </summary>
    private void InitializeDrafts()
    {
        if (_draftsInitialized)
        {
            return;
        }

        var store = EnsureDraftStore();
        if (store is null)
        {
            return;
        }

        _draftsInitialized = true;
        _draftUserId = _api.CurrentSession?.UserId;
        foreach (var (conversationId, text) in store.Load())
        {
            _drafts[conversationId] = text;
            FindConversation(conversationId)?.SetDraft(text);
        }
    }

    /// <summary>
    /// Изменение composer'а → отложенная запись черновика активного диалога.
    /// Молчим при переключении диалога (suppress) и без выбранного диалога.
    /// </summary>
    private void ScheduleDraftSync()
    {
        if (_suppressDraftSync
            || _selectedConversation is not { } conversation
            || string.IsNullOrEmpty(conversation.Id))
        {
            return;
        }

        var marker = ++_draftSyncMarker;
        var conversationId = conversation.Id;
        _ = PersistDraftDebouncedAsync(conversationId, DraftTextFor(conversationId), marker);
    }

    /// <summary>
    /// Текст черновика для диалога: пока открыта правка — снапшот (тело edit в
    /// composer не является черновиком, parity editDraftSnapshotRef из web).
    /// </summary>
    private string DraftTextFor(string conversationId) =>
        _editDraftSnapshot is { } snapshot
        && string.Equals(snapshot.ConversationId, conversationId, StringComparison.Ordinal)
            ? snapshot.Text
            : _composerText;

    /// <summary>
    /// Отложенная запись: маркер гасит устаревшие тики (новый ввод, смена
    /// диалога, выход). Задержка вне UI, применение — через RunOnUi.
    /// </summary>
    private async Task PersistDraftDebouncedAsync(string conversationId, string text, int marker)
    {
        await Task.Delay(DraftDebounceMs).ConfigureAwait(false);
        if (_syncContext is System.Windows.Threading.DispatcherSynchronizationContext
            && !_syncContextThread.IsAlive)
        {
            // Пост на мёртвый UI-поток воссоздаёт его message-only HWND уже на
            // чужом потоке — WndProc на выгрузке валит процесс (SubclassWndProc).
            return;
        }

        RunOnUi(() =>
        {
            if (marker != _draftSyncMarker)
            {
                return;
            }

            PersistDraftNow(conversationId, text);
        });
    }

    /// <summary>
    /// Мгновенный коммит черновика: память → диск → строка списка. Пустой текст
    /// стирает запись (черновик храним только для непустого composer'а).
    /// </summary>
    private void PersistDraftNow(string conversationId, string? text)
    {
        if (string.IsNullOrEmpty(conversationId))
        {
            return;
        }

        var draft = string.IsNullOrWhiteSpace(text) ? null : text;
        if (draft is null)
        {
            _drafts.Remove(conversationId);
        }
        else
        {
            _drafts[conversationId] = draft;
        }

        // Save(null) в сторадже — no-op при отсутствии записи, поэтому можно
        // звать без проверки: не создаём и не трогаем файл без необходимости.
        EnsureDraftStore()?.Save(conversationId, draft);
        FindConversation(conversationId)?.SetDraft(draft);
    }

    /// <summary>
    /// Выход/сброс сессии: сносим все черновики (clearAllDrafts в web), гасим
    /// отложенные записи маркером и отвязываем стор — при следующем логине он
    /// создастся заново под нового пользователя.
    /// </summary>
    private void ClearAllDrafts()
    {
        _draftSyncMarker++;
        _drafts.Clear();
        _editDraftSnapshot = null;
        foreach (var item in _allConversations)
        {
            item.SetDraft(null);
        }

        (_draftStore ?? _injectedDraftStore)?.ClearAll();
        _draftStore = _injectedDraftStore;
        _draftsInitialized = false;
        _draftUserId = null;
    }

    /// <summary>
    /// chat.typing.started: conversation_id живёт на уровне конверта (в payload его нет),
    /// payload — {user_id, sender_name, is_typing, expires_in_ms}. Индикатор — и на
    /// строке диалога в списке, и в шапке открытого; снимает stopped либо таймер
    /// по expires_in_ms — что раньше.
    /// </summary>
    private void HandleTypingStarted(HubChatRealtimeEvent realtimeEvent)
    {
        if (!TryGetTypingTarget(realtimeEvent, out var conversationId))
        {
            return;
        }

        var senderName = GetStringProperty(realtimeEvent.Payload, "sender_name");
        var text = string.IsNullOrWhiteSpace(senderName)
            ? "Собеседник печатает…"
            : $"{senderName.Trim()} печатает…";

        FindConversation(conversationId)?.SetTyping(text);
        if (IsSelectedConversation(conversationId))
        {
            TypingText = text;
        }

        var expiresMs = realtimeEvent.Payload.TryGetProperty("expires_in_ms", out var expiresElement)
            && expiresElement.ValueKind == JsonValueKind.Number
            && expiresElement.TryGetInt32(out var parsedMs)
            && parsedMs > 0
                ? parsedMs
                : TypingDefaultExpiresMs;
        var marker = _conversationTypingMarkers[conversationId] =
            _conversationTypingMarkers.GetValueOrDefault(conversationId) + 1;
        _ = ClearTypingAfterAsync(conversationId, marker, expiresMs);
    }

    /// <summary>chat.typing.stopped: тот же конвертный фильтр, индикатор гасим сразу.</summary>
    private void HandleTypingStopped(HubChatRealtimeEvent realtimeEvent)
    {
        if (!TryGetTypingTarget(realtimeEvent, out var conversationId))
        {
            return;
        }

        _conversationTypingMarkers[conversationId] =
            _conversationTypingMarkers.GetValueOrDefault(conversationId) + 1;
        FindConversation(conversationId)?.SetTyping(null);
        if (IsSelectedConversation(conversationId))
        {
            TypingText = null;
        }
    }

    /// <summary>
    /// Общий фильтр typing-событий: conversation_id конверта (fallback — из payload)
    /// обязан быть непустым; кадры с нашим user_id пропускаем. Индикатор вешается
    /// на строку списка найденного диалога и на шапку, если он открыт.
    /// </summary>
    private bool TryGetTypingTarget(HubChatRealtimeEvent realtimeEvent, out string conversationId)
    {
        conversationId = realtimeEvent.ConversationId
            ?? GetStringProperty(realtimeEvent.Payload, "conversation_id")
            ?? string.Empty;
        if (conversationId.Length == 0)
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

    private bool IsSelectedConversation(string conversationId) =>
        _selectedConversation is { } selected
        && string.Equals(selected.Id, conversationId, StringComparison.OrdinalIgnoreCase);

    /// <summary>Авто-сброс «печатает…» по expires_in_ms: новый started/stopped гасит старый таймер.</summary>
    private async Task ClearTypingAfterAsync(string conversationId, int marker, int delayMs)
    {
        await Task.Delay(Math.Max(delayMs, 0));
        RunOnUi(() =>
        {
            if (_conversationTypingMarkers.GetValueOrDefault(conversationId) != marker)
            {
                return;
            }

            FindConversation(conversationId)?.SetTyping(null);
            if (IsSelectedConversation(conversationId))
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

        // action_card — частичный патч: поле присутствует только при смене карточки.
        if (element.Value.TryGetProperty("action_card", out var actionCardNode))
        {
            message.ApplyActionCard(DeserializeActionCard(actionCardNode));
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
        // UI-017: галочки в строке диалога, когда read относится к её
        // последнему сообщению (список диалогов read-статус не отдаёт).
        if (FindMessage(id) is { } readMessage
            && Messages.LastOrDefault() is { } tail
            && tail.Id == readMessage.Id)
        {
            _selectedConversation?.SyncLastMessageStatus(tail);
        }
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

    /// <summary>action_card из realtime-патча (может быть явным null — карточку сняли).</summary>
    private static HubChatActionCard? DeserializeActionCard(JsonElement element)
    {
        if (element.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<HubChatActionCard>(
                element.GetRawText(), JsonOptions);
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

    // ---- Папки диалогов ----

    /// <summary>Вкладки папок над списком диалогов (системные + пользовательские).</summary>
    public ObservableCollection<ChatFolderTabViewModel> FolderTabs { get; } = [];

    /// <summary>Только пользовательские папки — строки панели «Управление папками».</summary>
    public ObservableCollection<ChatFolderTabViewModel> CustomFolderTabs => _customFolderTabs;

    /// <summary>Активная вкладка: system key (all|personal|groups|tasks) или id папки.</summary>
    public string ActiveFolderKey
    {
        get => _activeFolderKey;
        set
        {
            var normalized = string.IsNullOrWhiteSpace(value) ? PersonalFolderKey : value.Trim();
            // «Архив» — не вкладка, а отдельный вид списка (как в web) — маппим
            // на «Личные»; «Все» — живая системная вкладка tg-main.
            if (normalized is "archived")
            {
                normalized = PersonalFolderKey;
            }

            if (SetProperty(ref _activeFolderKey, normalized))
            {
                RefreshFolderTabStates();
                RebuildVisibleConversations();
            }
        }
    }

    /// <summary>Переключение вкладки: фильтр списка диалогов + подсветка чипа.</summary>
    public ICommand SelectFolderCommand { get; }

    /// <summary>«Управление папками»: создать/переименовать/удалить/состав.</summary>
    public ICommand ToggleFolderManagerCommand { get; }

    public ICommand CloseFolderManagerCommand { get; }

    /// <summary>Создать папку по имени из поля «Новая папка».</summary>
    public ICommand CreateFolderCommand { get; }

    /// <summary>Начать переименование строки папки в менеджере.</summary>
    public ICommand BeginFolderRenameCommand { get; }

    public ICommand CancelFolderRenameCommand { get; }

    /// <summary>Сохранить новое имя (PATCH folders/{id}).</summary>
    public ICommand SaveFolderRenameCommand { get; }

    /// <summary>Удалить пользовательскую папку (диалоги остаются — как в web).</summary>
    public ICommand DeleteFolderCommand { get; }

    /// <summary>Перестановка папки вверх/вниз — PATCH sort_order соседей.</summary>
    public ICommand MoveFolderUpCommand { get; }

    public ICommand MoveFolderDownCommand { get; }

    /// <summary>Открыть «Состав папки»: чек-лист всех диалогов → PUT membership.</summary>
    public ICommand OpenFolderMembershipCommand { get; }

    public ICommand CloseFolderMembershipCommand { get; }

    /// <summary>Сохранить состав папки (полная замена членства).</summary>
    public ICommand SaveFolderMembershipCommand { get; }

    /// <summary>Панель «Управление папками» поверх списка диалогов.</summary>
    public bool IsFolderManagerOpen
    {
        get => _isFolderManagerOpen;
        private set
        {
            if (SetProperty(ref _isFolderManagerOpen, value))
            {
                OnPropertyChanged(nameof(IsConversationListActive));
            }
        }
    }

    /// <summary>Идёт вызов API папок — кнопки менеджера блокируются.</summary>
    public bool IsFolderBusy
    {
        get => _isFolderBusy;
        private set
        {
            if (SetProperty(ref _isFolderBusy, value))
            {
                RaiseFolderCommandStates();
            }
        }
    }

    /// <summary>Имя новой папки в менеджере.</summary>
    public string NewFolderName
    {
        get => _newFolderName;
        set
        {
            if (SetProperty(ref _newFolderName, value))
            {
                RaiseFolderCommandStates();
            }
        }
    }

    /// <summary>Ошибка операций с папками — строка в менеджере.</summary>
    public string? FolderErrorText
    {
        get => _folderErrorText;
        private set
        {
            if (SetProperty(ref _folderErrorText, value))
            {
                OnPropertyChanged(nameof(HasFolderError));
            }
        }
    }

    public bool HasFolderError => !string.IsNullOrEmpty(FolderErrorText);

    /// <summary>Папка в режиме переименования (inline-поле вместо заголовка).</summary>
    public ChatFolderTabViewModel? RenamingFolder
    {
        get => _renamingFolder;
        private set
        {
            var previous = _renamingFolder;
            if (SetProperty(ref _renamingFolder, value))
            {
                if (previous is not null)
                {
                    previous.IsRenaming = false;
                }

                if (value is not null)
                {
                    value.IsRenaming = true;
                }

                OnPropertyChanged(nameof(RenamingFolderId));
                RaiseFolderCommandStates();
            }
        }
    }

    /// <summary>Id переименовываемой папки — строка менеджера сверяется с ней.</summary>
    public string? RenamingFolderId => RenamingFolder?.FolderId;

    public string RenamingFolderName
    {
        get => _renamingFolderName;
        set
        {
            if (SetProperty(ref _renamingFolderName, value))
            {
                RaiseFolderCommandStates();
            }
        }
    }

    /// <summary>«Состав папки» — чек-лист диалогов поверх списка.</summary>
    public bool IsFolderMembershipOpen
    {
        get => _isFolderMembershipOpen;
        private set
        {
            if (SetProperty(ref _isFolderMembershipOpen, value))
            {
                OnPropertyChanged(nameof(IsConversationListActive));
            }
        }
    }

    /// <summary>Папка, чей состав правится (заголовок панели).</summary>
    public string MembershipFolderTitle => _membershipFolder?.Title ?? "папки";

    /// <summary>Строки чек-листа: все не-архивные диалоги с галочкой членства.</summary>
    public ObservableCollection<ChatFolderMembershipItemViewModel> FolderMembershipItems { get; } = [];

    /// <summary>Фильтр активной папки (parity web filterSidebarConversationsByFolder).</summary>
    private bool MatchesActiveFolder(ConversationItemViewModel item)
    {
        if (ShowArchived || _serverSearchResults is not null)
        {
            // Вид «Архив» и серверная выдача поиска — вне вкладок папок.
            return true;
        }

        return _activeFolderKey switch
        {
            // «Все»: без фильтра kind — все диалоги видимого (не-архивного) списка.
            AllFolderKey => true,
            PersonalFolderKey => item.Kind is "direct" or "notes" or "ai",
            GroupsFolderKey => string.Equals(item.Kind, "group", StringComparison.Ordinal),
            TasksFolderKey => string.Equals(item.Kind, "task", StringComparison.Ordinal),
            var customKey => _conversationIdsByFolder.TryGetValue(customKey, out var ids)
                && ids.Contains(item.Id, StringComparer.Ordinal),
        };
    }

    /// <summary>GET /chat/folders: фон, без блокировки списка (ошибки молчим — вкладки системные живут).</summary>
    private async Task LoadChatFoldersSafelyAsync()
    {
        try
        {
            var list = await _api.GetChatFoldersAsync(CancellationToken.None);
            RunOnUi(() => ApplyFolderList(list));
        }
        catch
        {
            // Папки — необязательная надстройка: при сбое остаются системные вкладки.
        }
    }

    /// <summary>Слияние ответа GET/мутаций папок: вкладки, карта членства, бейджи.</summary>
    private void ApplyFolderList(HubChatFolderList list)
    {
        _serverFolderUnreadCounts.Clear();
        foreach (var pair in list.FolderUnreadCounts ?? (IReadOnlyDictionary<string, int>)new Dictionary<string, int>())
        {
            if (!string.IsNullOrEmpty(pair.Key) && pair.Value > 0)
            {
                _serverFolderUnreadCounts[pair.Key] = pair.Value;
            }
        }

        var folders = (list.Items ?? [])
            .Where(folder => !string.IsNullOrEmpty(folder.Id))
            .ToList();

        // Карта членства: conversation_ids_by_folder ∪ folder.conversation_ids
        // (как buildConversationIdsByFolder в web).
        _conversationIdsByFolder.Clear();
        foreach (var folder in folders)
        {
            var ids = new List<string>();
            if (list.ConversationIdsByFolder is not null
                && list.ConversationIdsByFolder.TryGetValue(folder.Id, out var serverIds)
                && serverIds is not null)
            {
                ids.AddRange(serverIds);
            }

            if (folder.ConversationIds is not null)
            {
                ids.AddRange(folder.ConversationIds);
            }

            _conversationIdsByFolder[folder.Id] = ids
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Select(id => id.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }

        // Пользовательские вкладки — после системных, по sort_order (Telegram-style).
        _customFolderTabs.Clear();
        foreach (var folder in folders
                     .OrderBy(folder => folder.SortOrder)
                     .ThenBy(folder => folder.Name, StringComparer.CurrentCultureIgnoreCase))
        {
            var existing = _customFolderTabs.FirstOrDefault(tab => tab.FolderId == folder.Id)
                ?? FolderTabs.FirstOrDefault(tab => tab.FolderId == folder.Id);
            if (existing is not null)
            {
                existing.Title = folder.Name ?? "Папка";
                existing.ConversationCount = _conversationIdsByFolder.TryGetValue(folder.Id, out var ids)
                    ? ids.Count
                    : folder.ConversationCount;
                _customFolderTabs.Add(existing);
            }
            else
            {
                _customFolderTabs.Add(CreateFolderTab(folder));
            }
        }

        RebuildFolderTabs();
        RebuildFolderMenuItems();

        // Активная вкладка удалена на сервере — fallback на «Личные» (как web).
        if (!FolderTabs.Any(tab => tab.Key == _activeFolderKey))
        {
            ActiveFolderKey = PersonalFolderKey;
        }
        else
        {
            RebuildVisibleConversations();
        }
    }

    private ChatFolderTabViewModel CreateFolderTab(HubChatFolder folder)
    {
        var tab = new ChatFolderTabViewModel(
            folder.Id,
            string.IsNullOrWhiteSpace(folder.Name) ? "Папка" : folder.Name,
            folder.Id,
            folder.SortOrder,
            SelectFolderTabAsync)
        {
            ConversationCount = _conversationIdsByFolder.TryGetValue(folder.Id, out var ids)
                ? ids.Count
                : folder.ConversationCount,
        };
        return tab;
    }

    private Task SelectFolderTabAsync(ChatFolderTabViewModel tab)
    {
        SelectFolder(tab);
        return Task.CompletedTask;
    }

    private void SelectFolder(ChatFolderTabViewModel? tab)
    {
        if (tab is not null)
        {
            ActiveFolderKey = tab.Key;
        }
    }

    /// <summary>Состав вкладок: системные всегда первые, дальше пользовательские.</summary>
    private void RebuildFolderTabs()
    {
        for (var i = FolderTabs.Count - 1; i >= SystemFolderTabs.Length; i--)
        {
            FolderTabs.RemoveAt(i);
        }

        while (FolderTabs.Count < SystemFolderTabs.Length)
        {
            var (key, title) = SystemFolderTabs[FolderTabs.Count];
            FolderTabs.Add(new ChatFolderTabViewModel(
                key, title, folderId: null, sortOrder: 0, SelectFolderTabAsync));
        }

        var index = SystemFolderTabs.Length;
        foreach (var tab in _customFolderTabs)
        {
            FolderTabs.Insert(index++, tab);
        }

        RefreshFolderTabStates();
    }

    /// <summary>Выделение и бейджи непрочитанных вкладок (server counts ∪ локальный расчёт).</summary>
    private void RefreshFolderTabStates()
    {
        foreach (var tab in FolderTabs)
        {
            tab.IsSelected = string.Equals(tab.Key, _activeFolderKey, StringComparison.Ordinal);
            tab.UnreadCount = ResolveFolderUnread(tab.Key);
        }
    }

    /// <summary>
    /// Бейдж вкладки: серверный folder_unread_counts — источник истины;
    /// для ключей без серверного значения — локальный расчёт по списку
    /// (buildFolderUnreadCounts: архивные и действующий mute не считаются).
    /// </summary>
    private int ResolveFolderUnread(string key) =>
        _serverFolderUnreadCounts.TryGetValue(key, out var serverCount)
            ? serverCount
            : ComputeLocalFolderUnread(key);

    private int ComputeLocalFolderUnread(string key)
    {
        var items = _allConversations.Where(item => !item.IsEffectivelyMuted);
        return key switch
        {
            "all" => items.Where(item => !item.IsArchived).Sum(item => item.UnreadCount),
            "archived" => items.Where(item => item.IsArchived).Sum(item => item.UnreadCount),
            PersonalFolderKey => items
                .Where(item => !item.IsArchived && item.Kind is "direct" or "notes")
                .Sum(item => item.UnreadCount),
            GroupsFolderKey => items
                .Where(item => !item.IsArchived && item.Kind == "group")
                .Sum(item => item.UnreadCount),
            TasksFolderKey => items
                .Where(item => !item.IsArchived && item.Kind == "task")
                .Sum(item => item.UnreadCount),
            "ai" => items
                .Where(item => !item.IsArchived && item.Kind == "ai")
                .Sum(item => item.UnreadCount),
            _ => _conversationIdsByFolder.TryGetValue(key, out var ids)
                ? items
                    .Where(item => !item.IsArchived && ids.Contains(item.Id, StringComparer.Ordinal))
                    .Sum(item => item.UnreadCount)
                : 0,
        };
    }

    /// <summary>
    /// Подменю «Добавить в папку» на строках диалогов пересобирается при смене
    /// папок/карты членства (галочки членства + свежие названия).
    /// </summary>
    private void RebuildFolderMenuItems()
    {
        foreach (var conversation in _allConversations)
        {
            RebuildFolderMenuItems(conversation);
        }
    }

    private void RebuildFolderMenuItems(ConversationItemViewModel conversation)
    {
        conversation.FolderMenuItems.Clear();
        foreach (var folder in _customFolderTabs)
        {
            if (folder.FolderId is not { } folderId)
            {
                continue;
            }

            var included = _conversationIdsByFolder.TryGetValue(folderId, out var ids)
                && ids.Contains(conversation.Id, StringComparer.Ordinal);
            var captured = folder;
            conversation.FolderMenuItems.Add(new ChatFolderMenuItemViewModel(
                folderId,
                folder.Title,
                included,
                menuItem => ToggleFolderMembershipAsync(conversation, captured, menuItem)));
        }

        conversation.RaiseFolderMenuItemsChanged();
    }

    /// <summary>
    /// Toggle диалога в папке из контекстного меню строки:
    /// POST/DELETE …/folders/{id}/conversations/{cid}, ответ — свежая карта.
    /// </summary>
    private async Task ToggleFolderMembershipAsync(
        ConversationItemViewModel conversation,
        ChatFolderTabViewModel folder,
        ChatFolderMenuItemViewModel menuItem)
    {
        if (folder.FolderId is not { } folderId || IsFolderBusy)
        {
            return;
        }

        try
        {
            var mutation = menuItem.IsIncluded
                ? await _api.RemoveChatFolderConversationAsync(
                    folderId, conversation.Id, CancellationToken.None)
                : await _api.AddChatFolderConversationAsync(
                    folderId, conversation.Id, CancellationToken.None);
            RunOnUi(() =>
            {
                ApplyFolderMembership(folder, mutation.Item);
                FolderErrorText = null;
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Обновить карту членства из ответа мутации (item.conversation_ids — канон).</summary>
    private void ApplyFolderMembership(ChatFolderTabViewModel folder, HubChatFolder? item)
    {
        if (folder.FolderId is not { } folderId)
        {
            return;
        }

        if (item?.ConversationIds is { } ids)
        {
            _conversationIdsByFolder[folderId] = ids
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Select(id => id.Trim())
                .Distinct(StringComparer.Ordinal)
                .ToList();
            folder.ConversationCount = item.ConversationIds.Count;
        }
        else if (item is not null)
        {
            folder.ConversationCount = item.ConversationCount;
        }

        RebuildFolderMenuItems();
        RefreshFolderTabStates();
        // Правила видимости текущей вкладки могли измениться для этого диалога.
        RebuildVisibleConversations();
    }

    private void OpenFolderManager()
    {
        CloseNewConversation();
        CloseGlobalSearch();
        CloseAiPanel();
        FolderErrorText = null;
        RenamingFolder = null;
        IsFolderManagerOpen = true;
    }

    private void CloseFolderManager()
    {
        RenamingFolder = null;
        FolderErrorText = null;
        IsFolderManagerOpen = false;
        CloseFolderMembership();
    }

    private async Task CreateFolderAsync(CancellationToken cancellationToken)
    {
        var name = NewFolderName.Trim();
        if (name.Length == 0)
        {
            return;
        }

        IsFolderBusy = true;
        try
        {
            var mutation = await _api.CreateChatFolderAsync(name, cancellationToken);
            FolderErrorText = null;
            if (mutation.Item is { } item)
            {
                _conversationIdsByFolder.TryAdd(item.Id, []);
                var tab = CreateFolderTab(item);
                _customFolderTabs.Add(tab);
                RebuildFolderTabs();
                RebuildFolderMenuItems();
                NewFolderName = string.Empty;
            }
        }
        catch (Exception exception)
        {
            FolderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFolderBusy = false;
        }
    }

    private async Task SaveFolderRenameAsync(CancellationToken cancellationToken)
    {
        var folder = RenamingFolder;
        var name = RenamingFolderName.Trim();
        if (folder?.FolderId is not { } folderId || name.Length == 0)
        {
            return;
        }

        IsFolderBusy = true;
        try
        {
            var mutation = await _api.UpdateChatFolderAsync(
                folderId, name, sortOrder: null, cancellationToken);
            FolderErrorText = null;
            if (mutation.Item is { } item)
            {
                folder.Title = item.Name ?? name;
            }
            else
            {
                folder.Title = name;
            }

            RenamingFolder = null;
            RebuildFolderMenuItems();
        }
        catch (Exception exception)
        {
            FolderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFolderBusy = false;
        }
    }

    private async Task DeleteFolderAsync(
        ChatFolderTabViewModel? folder,
        CancellationToken cancellationToken)
    {
        if (folder?.FolderId is not { } folderId)
        {
            return;
        }

        IsFolderBusy = true;
        try
        {
            await _api.DeleteChatFolderAsync(folderId, cancellationToken);
            FolderErrorText = null;
            _customFolderTabs.Remove(folder);
            _conversationIdsByFolder.Remove(folderId);
            if (ReferenceEquals(_renamingFolder, folder))
            {
                RenamingFolder = null;
            }

            RebuildFolderTabs();
            RebuildFolderMenuItems();
            // Активная папка удалена — фильтрация возвращается на «Личные».
            if (string.Equals(_activeFolderKey, folderId, StringComparison.Ordinal))
            {
                ActiveFolderKey = PersonalFolderKey;
            }
            else
            {
                RebuildVisibleConversations();
            }
        }
        catch (Exception exception)
        {
            FolderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFolderBusy = false;
        }
    }

    /// <summary>Перестановка: меняем sort_order с соседом (PATCH обеих строк — как web reorder).</summary>
    private async Task MoveFolderAsync(
        ChatFolderTabViewModel? folder,
        int direction,
        CancellationToken cancellationToken)
    {
        if (folder?.FolderId is not { } folderId)
        {
            return;
        }

        var index = _customFolderTabs.IndexOf(folder);
        var neighborIndex = index + direction;
        if (index < 0 || neighborIndex < 0 || neighborIndex >= _customFolderTabs.Count)
        {
            return;
        }

        var neighbor = _customFolderTabs[neighborIndex];
        IsFolderBusy = true;
        try
        {
            // Обмениваем sort_order пары; при равных значениях раздвигаем вручную.
            var folderOrder = folder.SortOrder == neighbor.SortOrder
                ? neighbor.SortOrder + (direction > 0 ? 1 : -1)
                : neighbor.SortOrder;
            await _api.UpdateChatFolderAsync(
                folderId, name: null, folderOrder, cancellationToken);
            if (neighbor.FolderId is { } neighborId)
            {
                await _api.UpdateChatFolderAsync(
                    neighborId, name: null, folder.SortOrder, cancellationToken);
            }

            FolderErrorText = null;
            // Сервер — источник порядка: перечитываем список папок и пересобираем вкладки.
            var refreshed = await _api.GetChatFoldersAsync(cancellationToken);
            ApplyFolderList(refreshed);
        }
        catch (Exception exception)
        {
            FolderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFolderBusy = false;
        }
    }

    /// <summary>«Состав папки»: чек-лист всех не-архивных диалогов.</summary>
    private void OpenFolderMembership(ChatFolderTabViewModel folder)
    {
        _membershipFolder = folder;
        OnPropertyChanged(nameof(MembershipFolderTitle));
        FolderMembershipItems.Clear();
        var memberIds = _conversationIdsByFolder.TryGetValue(folder.Key, out var ids)
            ? ids
            : [];
        foreach (var conversation in _allConversations.Where(item => !item.IsArchived))
        {
            FolderMembershipItems.Add(new ChatFolderMembershipItemViewModel(
                conversation, memberIds.Contains(conversation.Id, StringComparer.Ordinal)));
        }

        FolderErrorText = null;
        IsFolderMembershipOpen = true;
    }

    private void CloseFolderMembership()
    {
        _membershipFolder = null;
        IsFolderMembershipOpen = false;
    }

    /// <summary>Полная замена членства папки выбранными в чек-листе диалогами.</summary>
    private async Task SaveFolderMembershipAsync(CancellationToken cancellationToken)
    {
        var folder = _membershipFolder;
        if (folder?.FolderId is not { } folderId)
        {
            return;
        }

        var ids = FolderMembershipItems
            .Where(item => item.IsIncluded)
            .Select(item => item.ConversationId)
            .ToList();
        IsFolderBusy = true;
        try
        {
            var mutation = await _api.ReplaceChatFolderConversationsAsync(
                folderId, ids, cancellationToken);
            FolderErrorText = null;
            ApplyFolderMembership(folder, mutation.Item ?? new HubChatFolder
            {
                Id = folderId,
                ConversationIds = ids,
                ConversationCount = ids.Count,
            });
            CloseFolderMembership();
        }
        catch (Exception exception)
        {
            FolderErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsFolderBusy = false;
        }
    }

    private void RaiseFolderCommandStates()
    {
        (CreateFolderCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (SaveFolderRenameCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (DeleteFolderCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (MoveFolderUpCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (MoveFolderDownCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (SaveFolderMembershipCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    // ---- Стикеры ----

    /// <summary>Панель стикеров над composer'ом.</summary>
    public bool IsStickerPanelOpen
    {
        get => _isStickerPanelOpen;
        private set => SetProperty(ref _isStickerPanelOpen, value);
    }

    /// <summary>Активная вкладка панели: true — «Эмодзи» (сетка вставки), false — «Стикеры».</summary>
    public bool IsEmojiTab
    {
        get => _isEmojiTab;
        private set => SetProperty(ref _isEmojiTab, value);
    }

    /// <summary>
    /// Вкладка «Эмодзи» — категоризованные секции как в tg-stickers
    /// («Улыбки»/«Жесты и люди»/«Символы и объекты»); InsertEmojiCommand
    /// дописывает выбранный эмодзи в composer.
    /// </summary>
    public IReadOnlyList<ChatEmojiSectionViewModel> EmojiSections { get; } =
    [
        new ChatEmojiSectionViewModel("Улыбки",
        [
            "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🥲", "☺️",
            "😊", "😇", "🙂", "🙃", "😉", "😌", "😍", "🥰", "😘", "😗",
            "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓",
            "😎", "🥸", "🤩", "🥳", "😏", "😒", "😞", "😔", "😟", "😕",
            "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢", "😭", "😤",
            "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰",
        ]),
        new ChatEmojiSectionViewModel("Жесты и люди",
        [
            "👋", "🤚", "🖐", "✋", "🖖", "👌", "🤌", "🤏", "✌️", "🤞",
            "🫰", "🤟", "🤘", "🤙", "👈", "👉", "👆", "🖕", "👇", "☝️",
            "👍", "👎", "✊", "👊", "🤛", "🤜", "👏", "🙌", "🫶", "👐",
            "🤲", "🤝", "🙏", "✍️", "💅", "🤳", "💪", "🫵", "🦾", "👀",
            "👁️", "🧠", "👶", "🧒", "👦", "👧", "🧑", "👱", "👨", "👩",
        ]),
        new ChatEmojiSectionViewModel("Символы и объекты",
        [
            "❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "🤍", "🤎", "💔",
            "❣️", "💕", "💞", "💓", "💗", "💖", "💘", "💝", "💯", "💢",
            "💥", "💫", "💦", "💨", "🔥", "⚡", "🌟", "⭐", "✨", "☀️",
            "🌙", "☁️", "🌈", "🎉", "🎊", "🎈", "🎁", "🏆", "🥇", "🥈",
            "🥉", "☕", "🍕", "🎂", "🍰", "🍬", "🍭", "🍿", "🥂", "🍾",
            "🎵", "🎶", "📌", "📎", "✅", "❌", "➕", "🔔", "⏰", "💡",
        ]),
    ];

    /// <summary>
    /// Правая панель «Информация» (tdesktop profile panel): открывается кликом
    /// по имени диалога, закрывается ✕/сменой диалога; лента сжимается колонкой.
    /// </summary>
    public bool IsPeerCardOpen
    {
        get => _isPeerCardOpen;
        private set => SetProperty(ref _isPeerCardOpen, value);
    }

    /// <summary>
    /// Компактная раскладка (UI-002): панель «Информация» не отнимает колонку
    /// у ленты, а становится оверлеем поверх неё — как профиль tdesktop на
    /// узком окне. Флаг выставляет вью по фактической ширине области чата.
    /// </summary>
    public bool IsCompactInfoOverlay
    {
        get => _isCompactInfoOverlay;
        set => SetProperty(ref _isCompactInfoOverlay, value);
    }

    /// <summary>Top-4 участника для превью «N участников» правой панели (группы).</summary>
    public ObservableCollection<ChatGroupMemberItemViewModel> PeerPanelMembers { get; } = [];

    /// <summary>Подпись секции участников панели: «12 участников».</summary>
    public string? PeerMembersTitleText
    {
        get => _peerMembersTitleText;
        private set => SetProperty(ref _peerMembersTitleText, value);
    }

    /// <summary>Описание группы из detail — инфо-строка панели (null — скрыто).</summary>
    public string? PeerDescriptionText
    {
        get => _peerDescriptionText;
        private set
        {
            if (SetProperty(ref _peerDescriptionText, value))
            {
                OnPropertyChanged(nameof(HasPeerDescription));
            }
        }
    }

    public bool HasPeerDescription => !string.IsNullOrWhiteSpace(PeerDescriptionText);

    /// <summary>Кандидаты @mention-попапа — участники активной группы, до 8.</summary>
    public ObservableCollection<ChatGroupMemberItemViewModel> MentionSuggestions { get; } = [];

    /// <summary>Попап @упоминаний над composer — триггер активен и есть что показать.</summary>
    public bool IsMentionPopupOpen
    {
        get => _isMentionPopupOpen;
        private set => SetProperty(ref _isMentionPopupOpen, value);
    }

    /// <summary>Идёт подгрузка участников для меншнов — попап показывает состояние.</summary>
    public bool IsLoadingMentions
    {
        get => _isLoadingMentions;
        private set => SetProperty(ref _isLoadingMentions, value);
    }

    /// <summary>Подсвеченный кандидат (↑↓ навигация и клик; Enter/Tab вставляют его).</summary>
    public ChatGroupMemberItemViewModel? SelectedMentionSuggestion
    {
        get => _selectedMentionSuggestion;
        set => SetProperty(ref _selectedMentionSuggestion, value);
    }

    /// <summary>
    /// View ставит каретку composer'а после вставки меншна (FocusComposer —
    /// только в конец; тут нужен точный индекс).
    /// </summary>
    public Action<int>? RequestComposerCaret { get; set; }

    /// <summary>
    /// View восстанавливает выделение composer'а после markdown-обёртки
    /// (Ctrl+B/I/K): аргументы — start и length в новом тексте.
    /// </summary>
    public Action<int, int>? RequestComposerSelection { get; set; }

    /// <summary>Паки стикеров — вкладки полосы + сетка активного пака.</summary>
    public ObservableCollection<ChatStickerPackViewModel> StickerPacks { get; } = [];

    /// <summary>Активный пак — его стикеры рисует сетка панели.</summary>
    public ChatStickerPackViewModel? SelectedStickerPack
    {
        get => _selectedStickerPack;
        set
        {
            if (SetProperty(ref _selectedStickerPack, value))
            {
                foreach (var pack in StickerPacks)
                {
                    pack.IsSelected = ReferenceEquals(pack, value);
                }
            }
        }
    }

    public bool IsLoadingStickers
    {
        get => _isLoadingStickers;
        private set => SetProperty(ref _isLoadingStickers, value);
    }

    /// <summary>Идёт отправка стикера — повторный клик не дублирует запрос.</summary>
    public bool IsSendingSticker
    {
        get => _isSendingSticker;
        private set => SetProperty(ref _isSendingSticker, value);
    }

    /// <summary>Ошибка панели стикеров (загрузка паков/импорт/отправка).</summary>
    public string? StickerErrorText
    {
        get => _stickerErrorText;
        private set
        {
            if (SetProperty(ref _stickerErrorText, value))
            {
                OnPropertyChanged(nameof(HasStickerError));
            }
        }
    }

    public bool HasStickerError => !string.IsNullOrEmpty(StickerErrorText);

    /// <summary>Ссылка/short_name пака Telegram для импорта.</summary>
    public string StickerImportSource
    {
        get => _stickerImportSource;
        set
        {
            if (SetProperty(ref _stickerImportSource, value))
            {
                (ImportStickerPackCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsImportingStickerPack
    {
        get => _isImportingStickerPack;
        private set
        {
            if (SetProperty(ref _isImportingStickerPack, value))
            {
                (ImportStickerPackCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    public ICommand ToggleStickerPanelCommand { get; }

    public ICommand CloseStickerPanelCommand { get; }

    public ICommand SelectStickerPackCommand { get; }

    /// <summary>Переключение вкладок «Эмодзи»/«Стикеры» (parameter: "emoji"|"stickers").</summary>
    public ICommand SelectStickerTabCommand { get; }

    /// <summary>Вставка эмодзи из сетки панели в текст composer'а.</summary>
    public ICommand InsertEmojiCommand { get; }

    /// <summary>Клик по заголовку диалога — правая панель «Информация».</summary>
    public ICommand TogglePeerCardCommand { get; }

    /// <summary>Крестик правой панели.</summary>
    public ICommand ClosePeerCardCommand { get; }

    /// <summary>Выбор кандидата меншна — вставка «@handle » в composer.</summary>
    public ICommand InsertMentionCommand { get; }

    /// <summary>Esc/смена контекста — закрыть попап @упоминаний.</summary>
    public ICommand CloseMentionPopupCommand { get; }

    /// <summary>Импорт пака по ссылке/short_name (POST sticker-packs/import).</summary>
    public ICommand ImportStickerPackCommand { get; }

    private async Task ToggleStickerPanelAsync(CancellationToken cancellationToken)
    {
        if (IsStickerPanelOpen)
        {
            CloseStickerPanel();
            return;
        }

        StickerErrorText = null;
        IsStickerPanelOpen = true;
        // Открывшаяся панель перекрывает composer-оверлеи — попап меншнов гасим.
        CloseMentionPopup();
        if (!_stickersLoaded)
        {
            await LoadStickerPacksSafelyAsync(cancellationToken);
        }
    }

    private void CloseStickerPanel()
    {
        IsStickerPanelOpen = false;
        StickerErrorText = null;
        // Панель закрывает composer-оверлеи — попап меншнов тоже гасим.
        CloseMentionPopup();
    }

    // ---- Правая панель «Информация» (tdesktop: шапка диалога → профиль справа) ----

    private void OpenPeerCard()
    {
        _peerPanelConversation = _selectedConversation;
        IsPeerCardOpen = true;
        _ = EnsurePeerPanelDataSafelyAsync(_peerPanelConversation);
    }

    private void ClosePeerCard()
    {
        IsPeerCardOpen = false;
        _peerPanelConversation = null;
        PeerPanelMembers.Clear();
        PeerMembersTitleText = null;
        PeerDescriptionText = null;
    }

    /// <summary>
    /// Данные правой панели: для групп — detail (описание + top-4 участника
    /// под «Показать всех»); у direct всё уже в строке диалога — без запроса.
    /// </summary>
    private async Task EnsurePeerPanelDataSafelyAsync(ConversationItemViewModel? conversation)
    {
        if (conversation is null || !conversation.IsGroupLike || !IsPeerCardOpen)
        {
            return;
        }

        PeerPanelMembers.Clear();
        PeerMembersTitleText = "Участники";
        try
        {
            var detail = await _api.GetChatConversationMembersAsync(
                conversation.Id, CancellationToken.None);
            if (!ReferenceEquals(_peerPanelConversation, conversation) || !IsPeerCardOpen)
            {
                return;
            }

            PeerDescriptionText = detail.Description;
            var memberCount = detail.MemberCount > 0
                ? detail.MemberCount
                : conversation.MemberCount;
            PeerMembersTitleText = memberCount > 0
                ? $"{memberCount} {ChatPlural.Of(memberCount, "участник", "участника", "участников")}"
                : "Участники";
            foreach (var member in (detail.Members ?? []).Take(PeerPanelPreviewLimit))
            {
                PeerPanelMembers.Add(new ChatGroupMemberItemViewModel(
                    member, canRemove: false, removeHandler: null)
                {
                    AvatarLoader = _imageLoader,
                });
            }
        }
        catch (Exception exception)
        {
            if (ReferenceEquals(_peerPanelConversation, conversation) && IsPeerCardOpen)
            {
                BannerErrorText = TasksViewModel.DescribeError(exception);
            }
        }
    }

    // ---- @mention-автокомплит (parity ChatComposer.jsx getComposerMentionTrigger) ----

    /// <summary>
    /// Триггер упоминания как в web: '@' в начале строки или после пробела,
    /// запрос — непробельные символы до каретки (≤32). null — триггера нет.
    /// </summary>
    internal static (int Start, int End, string Query)? ParseMentionTrigger(
        string? text, int caretIndex)
    {
        var value = text ?? string.Empty;
        var caret = Math.Clamp(caretIndex, 0, value.Length);
        var beforeCaret = value[..caret];
        var atIndex = beforeCaret.LastIndexOf('@');
        if (atIndex < 0)
        {
            return null;
        }

        if (atIndex > 0 && !char.IsWhiteSpace(beforeCaret[atIndex - 1]))
        {
            return null;
        }

        var query = beforeCaret[(atIndex + 1)..];
        if (query.Length > MentionQueryLimit || query.Any(char.IsWhiteSpace))
        {
            return null;
        }

        return (atIndex, caret, query);
    }

    /// <summary>
    /// Handle как в web getPersonMentionHandle: username без '@', иначе
    /// full_name → «Имя_Фамилия» (пробелы → '_', мусор вычищен, ≤48).
    /// </summary>
    internal static string MentionHandle(string? username, string? displayName)
    {
        var handle = (username ?? string.Empty).Trim().TrimStart('@');
        if (handle.Length > 0)
        {
            return handle;
        }

        var derived = new StringBuilder(48);
        var pendingUnderscore = false;
        foreach (var ch in (displayName ?? string.Empty).Trim())
        {
            if (char.IsWhiteSpace(ch))
            {
                pendingUnderscore = derived.Length > 0;
                continue;
            }

            if (!char.IsLetterOrDigit(ch) && ch is not ('_' or '.' or '-'))
            {
                continue;
            }

            if (pendingUnderscore)
            {
                derived.Append('_');
                pendingUnderscore = false;
            }

            derived.Append(ch);
        }

        return derived.Length > 48 ? derived.ToString(0, 48) : derived.ToString();
    }

    /// <summary>
    /// Фильтр кандидата как в web filterMentionCandidates: нормализованный
    /// запрос — подстрока «handle displayName» без учёта регистра.
    /// </summary>
    internal static bool MentionMatches(string? query, string? handle, string? displayName)
    {
        var normalized = (query ?? string.Empty).Trim().TrimStart('@');
        if (normalized.Length == 0)
        {
            return true;
        }

        var haystack = string.Concat(handle, " ", displayName);
        return haystack.Contains(normalized, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Каретка/текст composer'а → состояние попапа @упоминаний. View зовёт на
    /// TextChanged/SelectionChanged; только группы — в direct меншн выключен.
    /// </summary>
    public void UpdateMentionTrigger(string? text, int caretIndex)
    {
        var trigger = _selectedConversation is { IsGroupLike: true }
            ? ParseMentionTrigger(text, caretIndex)
            : null;
        if (trigger is null)
        {
            CloseMentionPopup();
            return;
        }

        _mentionStart = trigger.Value.Start;
        _mentionEnd = trigger.Value.End;
        _mentionQuery = trigger.Value.Query;
        RebuildMentionSuggestions();
        if (_selectedConversation is { } conversation
            && !string.Equals(_mentionConversationId, conversation.Id, StringComparison.Ordinal))
        {
            _ = EnsureMentionCandidatesSafelyAsync(conversation);
        }

        IsMentionPopupOpen = MentionSuggestions.Count > 0 || IsLoadingMentions;
    }

    /// <summary>↑↓ по кандидатам — циклически, как web activeMentionIndex.</summary>
    public void MoveMentionSelection(int delta)
    {
        if (MentionSuggestions.Count == 0)
        {
            return;
        }

        var index = SelectedMentionSuggestion is { } current
            ? MentionSuggestions.IndexOf(current)
            : -1;
        index = index < 0
            ? (delta >= 0 ? 0 : MentionSuggestions.Count - 1)
            : (index + delta + MentionSuggestions.Count) % MentionSuggestions.Count;
        SelectedMentionSuggestion = MentionSuggestions[index];
    }

    /// <summary>
    /// Вставка «@handle » вместо триггера и каретка за ней — web insertMention
    /// (@username при наличии, иначе производный из имени).
    /// </summary>
    public void InsertMention(ChatGroupMemberItemViewModel? candidate)
    {
        if (candidate is null || _mentionQuery is null)
        {
            return;
        }

        var handle = MentionHandle(candidate.Username, candidate.DisplayName);
        if (handle.Length == 0)
        {
            return;
        }

        var insertText = "@" + handle + " ";
        var text = _composerText;
        var start = Math.Clamp(_mentionStart, 0, text.Length);
        var end = Math.Clamp(_mentionEnd, start, text.Length);
        var nextCaret = start + insertText.Length;
        ComposerText = string.Concat(text.AsSpan(0, start), insertText, text.AsSpan(end));
        CloseMentionPopup();
        RequestComposerCaret?.Invoke(nextCaret);
    }

    /// <summary>Закрытие попапа меншнов; источник кандидатов кэширован на диалог.</summary>
    public void CloseMentionPopup()
    {
        _mentionQuery = null;
        IsLoadingMentions = false;
        IsMentionPopupOpen = false;
        MentionSuggestions.Clear();
        SelectedMentionSuggestion = null;
    }

    /// <summary>Запрос после триггера: haystack «handle displayName» до 8 строк.</summary>
    private void RebuildMentionSuggestions()
    {
        var query = _mentionQuery ?? string.Empty;
        MentionSuggestions.Clear();
        foreach (var item in _mentionSource)
        {
            var handle = MentionHandle(item.Username, item.DisplayName);
            if (handle.Length == 0 && item.DisplayName.Length == 0)
            {
                continue;
            }

            if (!MentionMatches(query, handle, item.DisplayName))
            {
                continue;
            }

            MentionSuggestions.Add(item);
            if (MentionSuggestions.Count == MentionResultLimit)
            {
                break;
            }
        }

        // Активная строка — первая, как web activeMentionIndex=0.
        SelectedMentionSuggestion = MentionSuggestions.FirstOrDefault();
    }

    /// <summary>
    /// Ленивая подгрузка участников диалога для меншнов (тот же GET members,
    /// что и панель «Участники»); себя исключаем — как web currentUserId.
    /// </summary>
    private async Task EnsureMentionCandidatesSafelyAsync(ConversationItemViewModel conversation)
    {
        _mentionConversationId = conversation.Id;
        IsLoadingMentions = true;
        IsMentionPopupOpen = _mentionQuery is not null;
        try
        {
            var detail = await _api.GetChatConversationMembersAsync(
                conversation.Id, CancellationToken.None);
            // За запрос триггер/диалог мог умереть — кандидаты не применяем.
            if (!string.Equals(_mentionConversationId, conversation.Id, StringComparison.Ordinal)
                || _mentionQuery is null)
            {
                return;
            }

            var selfId = _api.CurrentSession?.UserId;
            _mentionSource.Clear();
            var seen = new HashSet<int>();
            foreach (var member in detail.Members ?? [])
            {
                var user = member.User;
                if (user is null || user.Id <= 0 || user.Id == selfId || !seen.Add(user.Id))
                {
                    continue;
                }

                _mentionSource.Add(new ChatGroupMemberItemViewModel(
                    member, canRemove: false, removeHandler: null)
                {
                    AvatarLoader = _imageLoader,
                });
            }

            RebuildMentionSuggestions();
        }
        catch (Exception exception)
        {
            if (_mentionQuery is not null)
            {
                BannerErrorText = TasksViewModel.DescribeError(exception);
            }
        }
        finally
        {
            IsLoadingMentions = false;
            // web: попап жив, пока триггер активен и есть строки/загрузка.
            IsMentionPopupOpen = _mentionQuery is not null
                && (MentionSuggestions.Count > 0 || IsLoadingMentions);
        }
    }

    /// <summary>GET /chat/sticker-packs: паки + превью через AuthImageLoader (лениво).</summary>
    private async Task LoadStickerPacksSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoadingStickers = true;
        try
        {
            var list = await _api.GetChatStickerPacksAsync(cancellationToken);
            ApplyStickerPacks(list);
            _stickersLoaded = true;
            StickerErrorText = null;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            StickerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoadingStickers = false;
        }
    }

    private void ApplyStickerPacks(HubChatStickerPackList list)
    {
        var selectedId = SelectedStickerPack?.Id;
        StickerPacks.Clear();
        foreach (var pack in (list.Items ?? []).Where(pack => !string.IsNullOrEmpty(pack.Id)))
        {
            StickerPacks.Add(new ChatStickerPackViewModel(pack, SendStickerAsync, _imageLoader));
        }

        SelectedStickerPack = StickerPacks.FirstOrDefault(pack => pack.Id == selectedId)
            ?? StickerPacks.FirstOrDefault();
    }

    /// <summary>Отправка стикера как в web sendSticker: sticker_id + reply контекст.</summary>
    private async Task SendStickerAsync(ChatStickerItemViewModel sticker)
    {
        var conversation = SelectedConversation;
        if (conversation is null || IsSendingSticker || IsSending || IsUploading)
        {
            return;
        }

        IsSendingSticker = true;
        try
        {
            var clientMessageId = Guid.NewGuid().ToString("N");
            var message = await _api.SendChatStickerMessageAsync(
                conversation.Id,
                sticker.Id,
                clientMessageId,
                ReplyingTo?.Id,
                CancellationToken.None);
            // Диалог мог смениться за время await — чужую ленту не трогаем.
            if (ReferenceEquals(_selectedConversation, conversation))
            {
                InsertMessage(message, conversation.IsGroupLike);
                ClearComposerContext();
            }

            conversation.UpdateLastMessage(message);
            RebuildVisibleConversations();
            BannerErrorText = null;
            StickerErrorText = null;
        }
        catch (Exception exception)
        {
            StickerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsSendingSticker = false;
        }
    }

    /// <summary>Импорт пака: сервер возвращает свежий список — пересобираем вкладки.</summary>
    private async Task ImportStickerPackAsync(CancellationToken cancellationToken)
    {
        var source = StickerImportSource.Trim();
        if (source.Length == 0)
        {
            return;
        }

        IsImportingStickerPack = true;
        try
        {
            var list = await _api.ImportChatStickerPackAsync(source, cancellationToken);
            ApplyStickerPacks(list);
            StickerImportSource = string.Empty;
            StickerErrorText = null;
        }
        catch (Exception exception)
        {
            StickerErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsImportingStickerPack = false;
        }
    }

    // ---- ИИ-ассистент ----

    /// <summary>Панель «ИИ-ассистент» поверх списка диалогов: боты и диалоги с ними.</summary>
    public bool IsAiPanelOpen
    {
        get => _isAiPanelOpen;
        private set
        {
            if (SetProperty(ref _isAiPanelOpen, value))
            {
                OnPropertyChanged(nameof(IsConversationListActive));
            }
        }
    }

    /// <summary>Диалоги с ассистентами (kind="ai") — верхний блок панели.</summary>
    public ObservableCollection<ConversationItemViewModel> AiConversations { get; } = [];

    /// <summary>Доступные боты из GET /chat/ai/bots.</summary>
    public ObservableCollection<ChatAiBotItemViewModel> AiBots { get; } = [];

    public bool IsLoadingAiBots
    {
        get => _isLoadingAiBots;
        private set => SetProperty(ref _isLoadingAiBots, value);
    }

    /// <summary>Ошибка AI-операций — строка в панели/под шапкой.</summary>
    public string? AiErrorText
    {
        get => _aiErrorText;
        private set
        {
            if (SetProperty(ref _aiErrorText, value))
            {
                OnPropertyChanged(nameof(HasAiError));
            }
        }
    }

    public bool HasAiError => !string.IsNullOrEmpty(AiErrorText);

    /// <summary>Вызов AI-API в полёте (open/create/delete/stop/retry/reset).</summary>
    public bool IsAiActionBusy
    {
        get => _isAiActionBusy;
        private set
        {
            if (SetProperty(ref _isAiActionBusy, value))
            {
                RaiseAiCommandStates();
            }
        }
    }

    public ICommand ToggleAiPanelCommand { get; }

    public ICommand CloseAiPanelCommand { get; }

    /// <summary>Перейти в диалог с ассистентом из панели.</summary>
    public ICommand SelectAiConversationCommand { get; }

    /// <summary>Удалить диалог с ассистентом (DELETE /chat/ai/conversations/{id}).</summary>
    public ICommand DeleteAiConversationCommand { get; }

    /// <summary>Общий чат с ассистентом без привязки к боту (web GENERAL_AI_OPENING_ID).</summary>
    public ICommand CreateGeneralAiConversationCommand { get; }

    /// <summary>Остановить запуск ассистента (queued|running).</summary>
    public ICommand StopAiRunCommand { get; }

    /// <summary>Повторить запуск после failed/cancelled (кнопка «Повторить» в web).</summary>
    public ICommand RetryAiRunCommand { get; }

    /// <summary>Сброс контекста ассистента — старые сообщения перестают учитываться.</summary>
    public ICommand ResetAiContextCommand { get; }

    /// <summary>Открыт AI-диалог — плашка статуса запуска и кнопки управления.</summary>
    public bool IsAiConversation => SelectedConversation?.Kind == "ai";

    /// <summary>Есть данные о запуске — плашка статуса видна.</summary>
    public bool HasAiStatus => _aiStatus is not null;

    /// <summary>Статус запуска текстом (status → русская подпись, status_text приоритетнее).</summary>
    public string? AiStatusText
    {
        get
        {
            var status = _aiStatus;
            if (status is null)
            {
                return null;
            }

            if (!string.IsNullOrWhiteSpace(status.StatusText))
            {
                return status.StatusText;
            }

            return status.Status switch
            {
                "queued" => "Ассистент в очереди…",
                "running" => "Ассистент отвечает…",
                "completed" => "Ответ готов",
                "cancelled" => "Запуск остановлен",
                "failed" => "Запуск завершился ошибкой",
                _ => null,
            };
        }
    }

    /// <summary>Этап запуска (stage) или текст ошибки — вторая строка плашки.</summary>
    public string? AiStatusHint => _aiStatus?.Stage ?? _aiStatus?.ErrorText;

    /// <summary>Запуск активен — кнопка «Остановить» доступна.</summary>
    public bool CanStopAiRun => _aiStatus?.Status is "queued" or "running";

    /// <summary>Запуск упал/отменён — кнопка «Повторить» доступна.</summary>
    public bool CanRetryAiRun => _aiStatus?.Status is "failed" or "cancelled";

    /// <summary>Агент выключен (agent_read_only) — composer беседы read-only, плашка-предупреждение.</summary>
    public bool IsAiReadOnly => _aiStatus?.AgentReadOnly == true;

    public string? AiReadOnlyText => IsAiReadOnly
        ? "Ассистент отключён администратором — диалог доступен только для чтения."
        : null;

    private async Task ToggleAiPanelAsync(CancellationToken cancellationToken)
    {
        if (IsAiPanelOpen)
        {
            CloseAiPanel();
            return;
        }

        CloseNewConversation();
        CloseGlobalSearch();
        CloseFolderManager();
        AiErrorText = null;
        RefreshAiConversationList();
        IsAiPanelOpen = true;
        if (!_aiBotsLoaded)
        {
            await LoadAiBotsSafelyAsync(cancellationToken);
        }
    }

    private void CloseAiPanel() => IsAiPanelOpen = false;

    /// <summary>Блок «Диалоги с ассистентами» — текущие kind="ai" из общего списка.</summary>
    private void RefreshAiConversationList()
    {
        AiConversations.Clear();
        foreach (var conversation in _allConversations.Where(item => item.Kind == "ai"))
        {
            AiConversations.Add(conversation);
        }
    }

    /// <summary>GET /chat/ai/bots: список помощников; 403/пусто — панель показывает ошибку.</summary>
    private async Task LoadAiBotsSafelyAsync(CancellationToken cancellationToken)
    {
        IsLoadingAiBots = true;
        try
        {
            var list = await _api.GetChatAiBotsAsync(cancellationToken);
            AiBots.Clear();
            foreach (var bot in (list.Items ?? []).Where(bot => !string.IsNullOrEmpty(bot.Id)))
            {
                AiBots.Add(new ChatAiBotItemViewModel(bot, OpenAiBotConversationAsync));
            }

            _aiBotsLoaded = true;
            AiErrorText = null;
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsLoadingAiBots = false;
        }
    }

    /// <summary>Открыть существующий или создать новый диалог с ботом (как web).</summary>
    private async Task OpenAiBotConversationAsync(
        ChatAiBotItemViewModel bot,
        bool createNew)
    {
        if (IsAiActionBusy)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            var conversation = createNew
                ? await _api.CreateChatAiBotConversationAsync(bot.Id, CancellationToken.None)
                : await _api.OpenChatAiBotConversationAsync(bot.Id, CancellationToken.None);
            ApplyOpenedAiConversation(conversation);
            AiErrorText = null;
        }
        catch (Exception exception)
        {
            RunOnUi(() => AiErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    /// <summary>Общий диалог с ассистентом (без конкретного бота).</summary>
    private async Task CreateGeneralAiConversationAsync(CancellationToken cancellationToken)
    {
        if (IsAiActionBusy)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            var conversation = await _api.CreateChatAiConversationAsync(cancellationToken);
            ApplyOpenedAiConversation(conversation);
            AiErrorText = null;
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    /// <summary>
    /// Диалог с ассистентом пришёл из open/create: upsert в список, переход в него —
    /// AI-диалоги живут во вкладке «Личные» (секция ИИ как в web).
    /// </summary>
    private void ApplyOpenedAiConversation(HubChatConversation conversation)
    {
        var item = UpsertConversationItem(conversation);
        RefreshAiConversationList();
        if (item.IsArchived != ShowArchived)
        {
            ShowArchived = item.IsArchived;
        }

        // AI-диалог виден в «Личные» и «Все» — только остальные вкладки сбрасываем.
        if (ActiveFolderKey is not (PersonalFolderKey or AllFolderKey))
        {
            ActiveFolderKey = PersonalFolderKey;
        }

        if (!string.IsNullOrEmpty(_searchText))
        {
            SearchText = string.Empty;
        }

        RebuildVisibleConversations();
        CloseAiPanel();
        SelectedConversation = item;
        BannerErrorText = null;
    }

    private async Task DeleteAiConversationAsync(
        ConversationItemViewModel? conversation,
        CancellationToken cancellationToken)
    {
        if (conversation is null || IsAiActionBusy)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            var deleted = await _api.DeleteChatAiConversationAsync(conversation.Id, cancellationToken);
            if (deleted)
            {
                AiConversations.Remove(conversation);
                RemoveConversationLocally(conversation);
                AiErrorText = null;
            }
            else
            {
                AiErrorText = "Не удалось удалить диалог с ассистентом.";
            }
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    /// <summary>
    /// Выбор AI-диалога: запускаем опрос ai-status (queued|running — интервал,
    /// как shouldPollActiveAiThread в web); обычный диалог — поллинг гасим.
    /// </summary>
    private void RefreshAiConversationState()
    {
        OnPropertyChanged(nameof(IsAiConversation));
        if (SelectedConversation is { Kind: "ai" } conversation)
        {
            StartAiStatusPolling(conversation);
        }
        else
        {
            StopAiStatusPolling();
        }
    }

    private void StartAiStatusPolling(ConversationItemViewModel conversation)
    {
        _aiStatusPolling?.Cancel();
        var cancellation = _aiStatusPolling = new CancellationTokenSource();
        _ = PollAiStatusLoopAsync(conversation, cancellation.Token);
    }

    private void StopAiStatusPolling()
    {
        _aiStatusPolling?.Cancel();
        _aiStatusPolling = null;
        ApplyAiStatus(null);
    }

    /// <summary>Первый запрос сразу; дальше — пока статус queued|running.</summary>
    private async Task PollAiStatusLoopAsync(
        ConversationItemViewModel conversation,
        CancellationToken cancellationToken)
    {
        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                var status = await _api.GetChatAiStatusAsync(conversation.Id, cancellationToken);
                if (cancellationToken.IsCancellationRequested
                    || !ReferenceEquals(_selectedConversation, conversation))
                {
                    return;
                }

                var shouldContinue = status.Status is "queued" or "running";
                RunOnUi(() =>
                {
                    if (ReferenceEquals(_selectedConversation, conversation))
                    {
                        ApplyAiStatus(status);
                    }
                });
                if (!shouldContinue)
                {
                    return;
                }

                await Task.Delay(AiStatusPollInterval, cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception exception)
        {
            // Статус — вспомогательная плашка: сбой не блокирует ленту,
            // показываем текст и не повторяем.
            RunOnUi(() => AiErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    private void ApplyAiStatus(HubChatAiStatus? status)
    {
        _aiStatus = status;
        OnPropertyChanged(nameof(HasAiStatus));
        OnPropertyChanged(nameof(AiStatusText));
        OnPropertyChanged(nameof(AiStatusHint));
        OnPropertyChanged(nameof(IsAiReadOnly));
        OnPropertyChanged(nameof(AiReadOnlyText));
        RaiseAiCommandStates();
    }

    private async Task StopAiRunAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            var status = await _api.StopChatAiConversationAsync(conversation.Id, cancellationToken);
            ApplyAiStatus(status);
            AiErrorText = null;
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    /// <summary>Повтор запуска: сервер возвращает новый статус — поллинг возобновляем.</summary>
    private async Task RetryAiRunAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            var status = await _api.RetryChatAiConversationAsync(conversation.Id, cancellationToken);
            ApplyAiStatus(status);
            AiErrorText = null;
            if (status.Status is "queued" or "running")
            {
                StartAiStatusPolling(conversation);
            }
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    private async Task ResetAiContextAsync(CancellationToken cancellationToken)
    {
        var conversation = SelectedConversation;
        if (conversation is null)
        {
            return;
        }

        IsAiActionBusy = true;
        try
        {
            await _api.ResetChatAiContextAsync(conversation.Id, cancellationToken);
            AiErrorText = null;
        }
        catch (Exception exception)
        {
            AiErrorText = TasksViewModel.DescribeError(exception);
        }
        finally
        {
            IsAiActionBusy = false;
        }
    }

    private void RaiseAiCommandStates()
    {
        OnPropertyChanged(nameof(CanStopAiRun));
        OnPropertyChanged(nameof(CanRetryAiRun));
        (StopAiRunCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (RetryAiRunCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ResetAiContextCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (DeleteAiConversationCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (CreateGeneralAiConversationCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>Подтверждение карточки действия: choice|format|scope → confirm API.</summary>
    private async Task ConfirmAiActionAsync(
        ChatMessageViewModel message,
        ChatActionCardViewModel card,
        string? choice,
        string? format,
        string? scope)
    {
        try
        {
            var updated = await _api.ConfirmChatAiActionAsync(
                card.Id, choice, format, scope, CancellationToken.None);
            RunOnUi(() => message.ApplyActionCard(updated));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Отмена карточки действия → cancel API, ответ — свежий статус карточки.</summary>
    private async Task CancelAiActionAsync(
        ChatMessageViewModel message,
        ChatActionCardViewModel card)
    {
        try
        {
            var updated = await _api.CancelChatAiActionAsync(card.Id, CancellationToken.None);
            RunOnUi(() => message.ApplyActionCard(updated));
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    /// <summary>Открытие result_url карточки: только http/https — как OpenLinkPreviewAsync.</summary>
    private async Task OpenAiActionResultAsync(ChatMessageViewModel message, string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
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
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
        }
    }

    // ---- Настройки группы ----

    /// <summary>
    /// Панель «Настройки группы» поверх ленты: название/описание/фото,
    /// ссылка-приглашение и удаление. Гейты — viewer_member_role последнего
    /// detail-ответа (fail-closed), backend проверку дублирует.
    /// </summary>
    public bool IsGroupSettingsOpen
    {
        get => _isGroupSettingsOpen;
        private set => SetProperty(ref _isGroupSettingsOpen, value);
    }

    /// <summary>Черновик названия группы (редактирует только владелец).</summary>
    public string GroupTitleDraft
    {
        get => _groupTitleDraft;
        set
        {
            if (SetProperty(ref _groupTitleDraft, value))
            {
                OnPropertyChanged(nameof(CanSaveGroupProfile));
            }
        }
    }

    /// <summary>Черновик описания (owner/moderator — как в web).</summary>
    public string GroupDescriptionDraft
    {
        get => _groupDescriptionDraft;
        set => SetProperty(ref _groupDescriptionDraft, value);
    }

    /// <summary>Название отличается от текущего — «Сохранить» активна.</summary>
    public bool CanSaveGroupProfile =>
        IsGroupSettingsOpen
        && !IsGroupActionBusy
        && ((CanManageGroupOwners
             && !string.IsNullOrWhiteSpace(_groupTitleDraft)
             && !string.Equals(_groupTitleDraft.Trim(), _groupSettingsConversation?.Title, StringComparison.Ordinal))
            || (CanManageGroupMembers
                && !string.Equals(
                    _groupDescriptionDraft.Trim(), _groupDescriptionOriginal, StringComparison.Ordinal)));

    private string _groupDescriptionOriginal = string.Empty;

    /// <summary>У группы есть фото — «Удалить фото» доступна.</summary>
    public bool HasGroupAvatar
    {
        get => _hasGroupAvatar;
        private set
        {
            if (SetProperty(ref _hasGroupAvatar, value))
            {
                RaiseGroupCommandStates();
            }
        }
    }

    /// <summary>Любое действие настроек в полёте — кнопки блокируем.</summary>
    public bool IsGroupActionBusy
    {
        get => _isGroupActionBusy;
        private set
        {
            if (SetProperty(ref _isGroupActionBusy, value))
            {
                RaiseGroupCommandStates();
                OnPropertyChanged(nameof(CanSaveGroupProfile));
            }
        }
    }

    /// <summary>Ссылка-приглашение после «Создать ссылку» (видна и копируется).</summary>
    public string? GroupInviteLink
    {
        get => _groupInviteLink;
        private set
        {
            if (SetProperty(ref _groupInviteLink, value))
            {
                OnPropertyChanged(nameof(HasGroupInviteLink));
            }
        }
    }

    public bool HasGroupInviteLink => GroupInviteLink is not null;

    /// <summary>Подпись «Отозвать ссылку»: armed-подтверждение вторым нажатием.</summary>
    public string InviteRevokeText => _inviteRevokeArmed ? "Точно отозвать?" : "Отозвать ссылку";

    /// <summary>Подпись «Удалить группу»: armed-подтверждение вторым нажатием.</summary>
    public string DeleteGroupText => _groupDeleteArmed ? "Точно удалить группу?" : "Удалить группу";

    /// <summary>Открытые заявки — бейдж на кнопке «Заявки» (null без данных).</summary>
    public string? JoinRequestsBadgeText =>
        _joinRequestsOpenCount > 0 ? _joinRequestsOpenCount.ToString(CultureInfo.InvariantCulture) : null;

    /// <summary>Открытые жалобы — бейдж на кнопке «Жалобы» (null без данных).</summary>
    public string? ReportsBadgeText =>
        _reportsOpenCount > 0 ? _reportsOpenCount.ToString(CultureInfo.InvariantCulture) : null;

    /// <summary>Кнопка ⚙ в шапке группового диалога — открыть/закрыть настройки.</summary>
    public ICommand ToggleGroupSettingsCommand { get; }

    public ICommand CloseGroupSettingsCommand { get; }

    /// <summary>«Сохранить» — PATCH profile {title?, description?} по гейтам ролей.</summary>
    public ICommand SaveGroupProfileCommand { get; }

    /// <summary>«Сменить фото» — OpenFileDialog (view) → POST avatar multipart.</summary>
    public ICommand UploadGroupAvatarCommand { get; }

    /// <summary>«Удалить фото» — DELETE avatar.</summary>
    public ICommand RemoveGroupAvatarCommand { get; }

    /// <summary>«Создать ссылку» — POST invite-link → показ + буфер обмена.</summary>
    public ICommand CreateInviteLinkCommand { get; }

    /// <summary>«Копировать» — ссылка-приглашение в буфер обмена.</summary>
    public ICommand CopyInviteLinkCommand { get; }

    /// <summary>«Отозвать ссылку» — armed DELETE invite-link.</summary>
    public ICommand RevokeInviteLinkCommand { get; }

    /// <summary>«Удалить группу» — armed DELETE conversations/{id} (только владелец).</summary>
    public ICommand DeleteGroupCommand { get; }

    /// <summary>Провайдер выбора файла аватара — инжектит view (OpenFileDialog image/*).</summary>
    public Func<string?>? GroupAvatarPicker { get; set; }

    private async Task ToggleGroupSettingsAsync(CancellationToken cancellationToken)
    {
        if (IsGroupSettingsOpen)
        {
            CloseGroupSettings();
            return;
        }

        if (_selectedConversation is not { Kind: "group" } conversation)
        {
            return;
        }

        // Оверлеи ленты взаимоисключающие.
        CloseForwardPanel();
        CloseMessageSearch();
        IsReadersPanelOpen = false;
        CloseMediaPanel();
        CloseJoinRequestsPanel();
        CloseReportsPanel();
        _groupSettingsConversation = conversation;
        IsGroupSettingsOpen = true;
        GroupTitleDraft = conversation.Title;
        GroupDescriptionDraft = string.Empty;
        _groupDescriptionOriginal = string.Empty;
        HasGroupAvatar = false;
        GroupInviteLink = null;
        _groupDeleteArmed = false;
        _inviteRevokeArmed = false;
        OnPropertyChanged(nameof(DeleteGroupText));
        OnPropertyChanged(nameof(InviteRevokeText));
        _joinRequestsOpenCount = 0;
        _reportsOpenCount = 0;
        OnPropertyChanged(nameof(JoinRequestsBadgeText));
        OnPropertyChanged(nameof(ReportsBadgeText));
        IsGroupActionBusy = true;
        try
        {
            // Свежее описание/роль — из detail; счётчики бейджей — только
            // для owner/moderator (для member запросы не делаем, как в web).
            var detail = await _api.GetChatConversationMembersAsync(conversation.Id, cancellationToken);
            if (!ReferenceEquals(_groupSettingsConversation, conversation) || !IsGroupSettingsOpen)
            {
                return;
            }

            conversation.Update(detail);
            RebuildVisibleConversations();
            var viewerRole = NormalizeGroupMemberRole(
                detail.ViewerMemberRole ?? conversation.ViewerMemberRole);
            var isGroup = string.Equals(conversation.Kind, "group", StringComparison.Ordinal);
            CanManageGroupMembers = isGroup && (viewerRole is "owner" or "moderator");
            CanManageGroupOwners = isGroup && viewerRole == "owner";
            GroupTitleDraft = detail.Title ?? conversation.Title;
            GroupDescriptionDraft = detail.Description ?? string.Empty;
            _groupDescriptionOriginal = GroupDescriptionDraft;
            HasGroupAvatar = !string.IsNullOrWhiteSpace(detail.AvatarUrl);
            OnPropertyChanged(nameof(CanSaveGroupProfile));
            if (CanManageGroupMembers)
            {
                _ = LoadModerationCountsSafelyAsync(conversation);
            }
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    /// <summary>Бейджи заявок и жалоб — фоновая догрузка для owner/moderator.</summary>
    private async Task LoadModerationCountsSafelyAsync(ConversationItemViewModel conversation)
    {
        try
        {
            var requests = await _api.GetChatJoinRequestsAsync(conversation.Id, CancellationToken.None);
            var reports = await _api.GetChatMessageReportsAsync(conversation.Id, CancellationToken.None);
            RunOnUi(() =>
            {
                if (!ReferenceEquals(_groupSettingsConversation, conversation))
                {
                    return;
                }

                _joinRequestsOpenCount = requests.OpenCount;
                _reportsOpenCount = reports.OpenCount;
                OnPropertyChanged(nameof(JoinRequestsBadgeText));
                OnPropertyChanged(nameof(ReportsBadgeText));
            });
        }
        catch (Exception)
        {
            // Бейджи необязательны — сбой не показываем баннером.
        }
    }

    private void CloseGroupSettings()
    {
        IsGroupSettingsOpen = false;
        _groupSettingsConversation = null;
        _groupTitleDraft = string.Empty;
        OnPropertyChanged(nameof(GroupTitleDraft));
        _groupDescriptionDraft = string.Empty;
        OnPropertyChanged(nameof(GroupDescriptionDraft));
        _groupDescriptionOriginal = string.Empty;
        _hasGroupAvatar = false;
        _groupInviteLink = null;
        OnPropertyChanged(nameof(HasGroupInviteLink));
        OnPropertyChanged(nameof(HasGroupAvatar));
        _groupDeleteArmed = false;
        _inviteRevokeArmed = false;
        OnPropertyChanged(nameof(DeleteGroupText));
        OnPropertyChanged(nameof(InviteRevokeText));
        _joinRequestsOpenCount = 0;
        _reportsOpenCount = 0;
        OnPropertyChanged(nameof(JoinRequestsBadgeText));
        OnPropertyChanged(nameof(ReportsBadgeText));
        IsGroupActionBusy = false;
    }

    /// <summary>PATCH profile: название — только owner, описание — owner/moderator.</summary>
    private async Task SaveGroupProfileAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        if (conversation is null || IsGroupActionBusy)
        {
            return;
        }

        var title = CanManageGroupOwners && !string.IsNullOrWhiteSpace(_groupTitleDraft)
            && !string.Equals(_groupTitleDraft.Trim(), conversation.Title, StringComparison.Ordinal)
            ? _groupTitleDraft.Trim()
            : null;
        var description = CanManageGroupMembers
            && !string.Equals(_groupDescriptionDraft.Trim(), _groupDescriptionOriginal, StringComparison.Ordinal)
            ? _groupDescriptionDraft.Trim()
            : null;
        if (title is null && description is null)
        {
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            var detail = await _api.UpdateChatGroupProfileAsync(
                conversation.Id, title, description, null, null, null, cancellationToken);
            if (!ReferenceEquals(_groupSettingsConversation, conversation))
            {
                return;
            }

            conversation.Update(detail);
            RebuildVisibleConversations();
            GroupTitleDraft = detail.Title ?? conversation.Title;
            GroupDescriptionDraft = detail.Description ?? string.Empty;
            _groupDescriptionOriginal = GroupDescriptionDraft;
            OnPropertyChanged(nameof(CanSaveGroupProfile));
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    /// <summary>Фото группы: image-файл ≤ 5 МБ → multipart POST avatar.</summary>
    private async Task UploadGroupAvatarAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        var picker = GroupAvatarPicker;
        if (conversation is null || !CanManageGroupOwners || IsGroupActionBusy || picker is null)
        {
            return;
        }

        var path = picker();
        if (string.IsNullOrWhiteSpace(path))
        {
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            var mime = GuessMimeType(Path.GetExtension(path));
            if (!mime.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            {
                BannerErrorText = "Выберите изображение: JPG, PNG или WebP.";
                return;
            }

            var bytes = await File.ReadAllBytesAsync(path, cancellationToken);
            const int maxBytes = 5 * 1024 * 1024;
            if (bytes.Length > maxBytes)
            {
                BannerErrorText = "Фото группы не должно быть больше 5 МБ.";
                return;
            }

            HubChatConversationDetail detail;
            await using (var stream = new MemoryStream(bytes))
            {
                detail = await _api.UploadChatGroupAvatarAsync(
                    conversation.Id, Path.GetFileName(path), stream, mime, cancellationToken);
            }

            if (!ReferenceEquals(_groupSettingsConversation, conversation))
            {
                return;
            }

            conversation.Update(detail);
            RebuildVisibleConversations();
            HasGroupAvatar = !string.IsNullOrWhiteSpace(detail.AvatarUrl);
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    private async Task RemoveGroupAvatarAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        if (conversation is null || !CanManageGroupOwners || IsGroupActionBusy)
        {
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            var detail = await _api.DeleteChatGroupAvatarAsync(conversation.Id, cancellationToken);
            if (!ReferenceEquals(_groupSettingsConversation, conversation))
            {
                return;
            }

            conversation.Update(detail);
            RebuildVisibleConversations();
            HasGroupAvatar = !string.IsNullOrWhiteSpace(detail.AvatarUrl);
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    /// <summary>Ссылка действует 7 дней; новая инвалидирует прежнюю (backend).</summary>
    private async Task CreateInviteLinkAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        if (conversation is null || !CanManageGroupMembers || IsGroupActionBusy)
        {
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            var link = await _api.CreateChatGroupInviteLinkAsync(conversation.Id, cancellationToken);
            if (!ReferenceEquals(_groupSettingsConversation, conversation)
                || string.IsNullOrWhiteSpace(link.Token))
            {
                return;
            }

            // Ссылка на web-страницу чата — desktop открывает её по deep link'у join=.
            GroupInviteLink = new Uri(
                _api.BaseUri, "chat?join=" + Uri.EscapeDataString(link.Token)).AbsoluteUri;
            _inviteRevokeArmed = false;
            OnPropertyChanged(nameof(InviteRevokeText));
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    private async Task RevokeInviteLinkAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        if (conversation is null || !CanManageGroupMembers || IsGroupActionBusy)
        {
            return;
        }

        // Armed-подтверждение: первое нажатие меняет подпись, второе вызывает API.
        if (!_inviteRevokeArmed)
        {
            _inviteRevokeArmed = true;
            OnPropertyChanged(nameof(InviteRevokeText));
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            await _api.RevokeChatGroupInviteLinkAsync(conversation.Id, cancellationToken);
            GroupInviteLink = null;
            _inviteRevokeArmed = false;
            OnPropertyChanged(nameof(InviteRevokeText));
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    /// <summary>Armed-удаление: первое нажатие меняет подпись, второе — DELETE.</summary>
    private async Task DeleteGroupConversationAsync(CancellationToken cancellationToken)
    {
        var conversation = _groupSettingsConversation;
        if (conversation is null || !CanManageGroupOwners || IsGroupActionBusy)
        {
            return;
        }

        if (!_groupDeleteArmed)
        {
            _groupDeleteArmed = true;
            OnPropertyChanged(nameof(DeleteGroupText));
            return;
        }

        IsGroupActionBusy = true;
        try
        {
            await _api.DeleteChatConversationAsync(conversation.Id, cancellationToken);
            RunOnUi(() =>
            {
                CloseGroupSettings();
                RemoveConversationLocally(conversation);
            });
        }
        finally
        {
            IsGroupActionBusy = false;
        }
    }

    // ---- Заявки на вступление ----

    /// <summary>Открытые заявки на вступление (owner/moderator).</summary>
    public ObservableCollection<ChatJoinRequestItemViewModel> JoinRequests { get; } = [];

    public bool IsJoinRequestsPanelOpen
    {
        get => _isJoinRequestsPanelOpen;
        private set => SetProperty(ref _isJoinRequestsPanelOpen, value);
    }

    public bool IsLoadingJoinRequests
    {
        get => _isLoadingJoinRequests;
        private set => SetProperty(ref _isLoadingJoinRequests, value);
    }

    /// <summary>
    /// «Вступление по заявкам» — свитч из web-диалога заявок; запись PUT
    /// join-approval только на пользовательский toggle (load — под suppress'ом).
    /// </summary>
    public bool IsJoinApprovalRequired
    {
        get => _isJoinApprovalRequired;
        set
        {
            if (SetProperty(ref _isJoinApprovalRequired, value) && !_suppressJoinApprovalSync)
            {
                _ = SetJoinApprovalSafelyAsync(value);
            }
        }
    }

    /// <summary>Запись режима в полёте — повторный toggle ждёт завершения.</summary>
    public bool IsJoinApprovalBusy
    {
        get => _isJoinApprovalBusy;
        private set => SetProperty(ref _isJoinApprovalBusy, value);
    }

    public ICommand ToggleJoinRequestsPanelCommand { get; }

    public ICommand CloseJoinRequestsPanelCommand { get; }

    private async Task ToggleJoinRequestsPanelAsync(CancellationToken cancellationToken)
    {
        if (IsJoinRequestsPanelOpen)
        {
            CloseJoinRequestsPanel();
            return;
        }

        var conversation = _groupSettingsConversation
            ?? (_selectedConversation is { Kind: "group" } selected ? selected : null);
        if (conversation is null || !CanManageGroupMembers)
        {
            return;
        }

        CloseReportsPanel();
        _groupSettingsConversation ??= conversation;
        IsJoinRequestsPanelOpen = true;
        JoinRequests.Clear();
        IsLoadingJoinRequests = true;
        try
        {
            var list = await _api.GetChatJoinRequestsAsync(conversation.Id, cancellationToken);
            if (!IsJoinRequestsPanelOpen)
            {
                return;
            }

            JoinRequests.Clear();
            foreach (var request in list.Items ?? [])
            {
                JoinRequests.Add(new ChatJoinRequestItemViewModel(request, ResolveJoinRequestAsync));
            }

            _joinRequestsOpenCount = list.OpenCount;
            OnPropertyChanged(nameof(JoinRequestsBadgeText));
            _suppressJoinApprovalSync = true;
            IsJoinApprovalRequired = list.ApprovalRequired;
            _suppressJoinApprovalSync = false;
        }
        finally
        {
            IsLoadingJoinRequests = false;
        }
    }

    private void CloseJoinRequestsPanel()
    {
        IsJoinRequestsPanelOpen = false;
        JoinRequests.Clear();
        IsLoadingJoinRequests = false;
        IsJoinApprovalBusy = false;
        _suppressJoinApprovalSync = true;
        IsJoinApprovalRequired = false;
        _suppressJoinApprovalSync = false;
    }

    /// <summary>Решение по заявке: approve|reject → строка убирается из списка.</summary>
    private async Task ResolveJoinRequestAsync(
        ChatJoinRequestItemViewModel request,
        string decision)
    {
        var conversation = _groupSettingsConversation
            ?? (_selectedConversation is { Kind: "group" } selected ? selected : null);
        if (conversation is null || !CanManageGroupMembers || request.IsResolving
            || decision is not ("approve" or "reject"))
        {
            return;
        }

        request.IsResolving = true;
        try
        {
            await _api.ResolveChatJoinRequestAsync(
                conversation.Id, request.Id, decision, CancellationToken.None);
            RunOnUi(() =>
            {
                JoinRequests.Remove(request);
                if (_joinRequestsOpenCount > 0)
                {
                    _joinRequestsOpenCount--;
                    OnPropertyChanged(nameof(JoinRequestsBadgeText));
                }

                // Одобренный пополнил состав — обновим строку и панель участников.
                if (string.Equals(decision, "approve", StringComparison.Ordinal))
                {
                    _ = RefreshMembersAfterApprovalAsync(conversation);
                }
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            request.IsResolving = false;
        }
    }

    /// <summary>После approve перечитываем detail: member_count/состав меняются.</summary>
    private async Task RefreshMembersAfterApprovalAsync(ConversationItemViewModel conversation)
    {
        try
        {
            var detail = await _api.GetChatConversationMembersAsync(
                conversation.Id, CancellationToken.None);
            RunOnUi(() =>
            {
                conversation.Update(detail);
                RebuildVisibleConversations();
                if (ReferenceEquals(_membersPanelConversation, conversation))
                {
                    ApplyGroupMembers(detail);
                }
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    private async Task SetJoinApprovalSafelyAsync(bool required)
    {
        var conversation = _groupSettingsConversation
            ?? (_selectedConversation is { Kind: "group" } selected ? selected : null);
        if (conversation is null || !CanManageGroupMembers || IsJoinApprovalBusy)
        {
            return;
        }

        IsJoinApprovalBusy = true;
        try
        {
            await _api.SetChatJoinApprovalAsync(conversation.Id, required, CancellationToken.None);
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                // Откат свитча к факту, чтобы UI не врал о режиме.
                _suppressJoinApprovalSync = true;
                IsJoinApprovalRequired = !required;
                _suppressJoinApprovalSync = false;
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
        finally
        {
            IsJoinApprovalBusy = false;
        }
    }

    // ---- Жалобы на сообщения ----

    /// <summary>Открытые жалобы на сообщения диалога (owner/moderator).</summary>
    public ObservableCollection<ChatMessageReportItemViewModel> MessageReports { get; } = [];

    public bool IsReportsPanelOpen
    {
        get => _isReportsPanelOpen;
        private set => SetProperty(ref _isReportsPanelOpen, value);
    }

    public bool IsLoadingReports
    {
        get => _isLoadingReports;
        private set => SetProperty(ref _isLoadingReports, value);
    }

    public ICommand ToggleReportsPanelCommand { get; }

    public ICommand CloseReportsPanelCommand { get; }

    private async Task ToggleReportsPanelAsync(CancellationToken cancellationToken)
    {
        if (IsReportsPanelOpen)
        {
            CloseReportsPanel();
            return;
        }

        var conversation = _groupSettingsConversation
            ?? (_selectedConversation is { Kind: "group" } selected ? selected : null);
        if (conversation is null || !CanManageGroupMembers)
        {
            return;
        }

        CloseJoinRequestsPanel();
        _groupSettingsConversation ??= conversation;
        IsReportsPanelOpen = true;
        MessageReports.Clear();
        IsLoadingReports = true;
        try
        {
            var list = await _api.GetChatMessageReportsAsync(conversation.Id, cancellationToken);
            if (!IsReportsPanelOpen)
            {
                return;
            }

            MessageReports.Clear();
            foreach (var report in list.Items ?? [])
            {
                MessageReports.Add(new ChatMessageReportItemViewModel(report, ResolveMessageReportAsync));
            }

            _reportsOpenCount = list.OpenCount;
            OnPropertyChanged(nameof(ReportsBadgeText));
        }
        finally
        {
            IsLoadingReports = false;
        }
    }

    private void CloseReportsPanel()
    {
        IsReportsPanelOpen = false;
        MessageReports.Clear();
        IsLoadingReports = false;
    }

    /// <summary>Решение по жалобе: resolved|dismissed → строка убирается из списка.</summary>
    private async Task ResolveMessageReportAsync(
        ChatMessageReportItemViewModel report,
        string resolution)
    {
        var conversation = _groupSettingsConversation
            ?? (_selectedConversation is { Kind: "group" } selected ? selected : null);
        if (conversation is null || !CanManageGroupMembers || report.IsResolving
            || resolution is not ("resolved" or "dismissed"))
        {
            return;
        }

        report.IsResolving = true;
        try
        {
            await _api.ResolveChatMessageReportAsync(
                conversation.Id, report.Id, resolution, CancellationToken.None);
            RunOnUi(() =>
            {
                MessageReports.Remove(report);
                if (_reportsOpenCount > 0)
                {
                    _reportsOpenCount--;
                    OnPropertyChanged(nameof(ReportsBadgeText));
                }
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            report.IsResolving = false;
        }
    }

    // ---- Диалог «Пожаловаться на сообщение» ----

    /// <summary>Диалог жалобы поверх ленты (reason + необязательный комментарий).</summary>
    public bool IsReportDialogOpen
    {
        get => _isReportDialogOpen;
        private set => SetProperty(ref _isReportDialogOpen, value);
    }

    /// <summary>Причина: spam|abuse|illegal|other (enum ChatMessageReportRequest).</summary>
    public string ReportReason
    {
        get => _reportReason;
        set => SetProperty(ref _reportReason, value);
    }

    public bool IsReportReasonSpam
    {
        get => ReportReason == "spam";
        set { if (value) { ReportReason = "spam"; } }
    }

    public bool IsReportReasonAbuse
    {
        get => ReportReason == "abuse";
        set { if (value) { ReportReason = "abuse"; } }
    }

    public bool IsReportReasonIllegal
    {
        get => ReportReason == "illegal";
        set { if (value) { ReportReason = "illegal"; } }
    }

    public bool IsReportReasonOther
    {
        get => ReportReason == "other";
        set { if (value) { ReportReason = "other"; } }
    }

    /// <summary>Комментарий жалобы (≤500 символов — как в схеме).</summary>
    public string ReportComment
    {
        get => _reportComment;
        set => SetProperty(ref _reportComment, value);
    }

    /// <summary>Отправка жалобы в полёте.</summary>
    public bool IsSubmittingReport
    {
        get => _isSubmittingReport;
        private set => SetProperty(ref _isSubmittingReport, value);
    }

    /// <summary>Пункт меню «Пожаловаться» (чужие сообщения в группе).</summary>
    public ICommand BeginReportCommand { get; }

    /// <summary>«Отправить» — POST messages/{id}/report.</summary>
    public ICommand SubmitReportCommand { get; }

    /// <summary>«Отмена» диалога жалобы.</summary>
    public ICommand CancelReportCommand { get; }

    private void BeginReport(ChatMessageViewModel message)
    {
        _reportTarget = message;
        ReportReason = "spam";
        ReportComment = string.Empty;
        IsReportDialogOpen = true;
    }

    private void CloseReportDialog()
    {
        IsReportDialogOpen = false;
        _reportTarget = null;
        IsSubmittingReport = false;
    }

    private async Task SubmitReportAsync(CancellationToken cancellationToken)
    {
        var message = _reportTarget;
        var conversation = _selectedConversation;
        if (message is null || conversation is null || IsSubmittingReport)
        {
            return;
        }

        var reason = ReportReason is "spam" or "abuse" or "illegal" ? ReportReason : "other";
        var comment = _reportComment.Trim();
        if (comment.Length > 500)
        {
            comment = comment[..500];
        }

        IsSubmittingReport = true;
        try
        {
            var result = await _api.ReportChatMessageAsync(
                conversation.Id, message.Id, reason,
                comment.Length > 0 ? comment : null, cancellationToken);
            RunOnUi(() =>
            {
                CloseReportDialog();
                BannerErrorText = null;
                UploadStatusText = result.AlreadyReported
                    ? "Вы уже жаловались на это сообщение."
                    : "Жалоба отправлена владельцу группы.";
            });
        }
        finally
        {
            IsSubmittingReport = false;
        }
    }

    // ---- «Поделиться задачей» ----

    /// <summary>Задачи для выбора в панели (GET shareable-tasks).</summary>
    public ObservableCollection<ChatShareableTaskItemViewModel> ShareableTasks { get; } = [];

    /// <summary>Панель «Поделиться задачей» поверх ленты.</summary>
    public bool IsTaskShareOpen
    {
        get => _isTaskShareOpen;
        private set => SetProperty(ref _isTaskShareOpen, value);
    }

    /// <summary>Идёт загрузка задач.</summary>
    public bool IsTaskShareLoading
    {
        get => _isTaskShareLoading;
        private set => SetProperty(ref _isTaskShareLoading, value);
    }

    /// <summary>Строка фильтра задач — debounce-запрос shareable-tasks?q=.</summary>
    public string TaskShareSearchText
    {
        get => _taskShareSearchText;
        set
        {
            if (SetProperty(ref _taskShareSearchText, value))
            {
                ScheduleTaskShareSearch();
            }
        }
    }

    /// <summary>Кнопка 📋 в composer'е — панель задач для отправки.</summary>
    public ICommand OpenTaskShareCommand { get; }

    public ICommand CloseTaskShareCommand { get; }

    private async Task ToggleTaskShareAsync(CancellationToken cancellationToken)
    {
        if (IsTaskShareOpen)
        {
            CloseTaskShare();
            return;
        }

        if (_selectedConversation is null)
        {
            return;
        }

        // Оверлеи ленты взаимоисключающие.
        CloseForwardPanel();
        CloseMessageSearch();
        IsReadersPanelOpen = false;
        CloseMembersPanel();
        CloseMediaPanel();
        IsTaskShareOpen = true;
        ShareableTasks.Clear();
        await LoadShareableTasksAsync(_taskShareSearchText.Trim(), cancellationToken);
    }

    private void CloseTaskShare()
    {
        _taskShareCancellation?.Cancel();
        IsTaskShareOpen = false;
        ShareableTasks.Clear();
        IsTaskShareLoading = false;
    }

    private void ScheduleTaskShareSearch()
    {
        _taskShareCancellation?.Cancel();
        if (!IsTaskShareOpen)
        {
            return;
        }

        var cancellation = _taskShareCancellation = new CancellationTokenSource();
        _ = LoadShareableTasksDebouncedSafelyAsync(_taskShareSearchText.Trim(), cancellation.Token);
    }

    private async Task LoadShareableTasksDebouncedSafelyAsync(
        string query,
        CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(UserSearchDebounce, cancellationToken);
            await LoadShareableTasksAsync(query, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }

    private async Task LoadShareableTasksAsync(string query, CancellationToken cancellationToken)
    {
        var conversation = _selectedConversation;
        if (conversation is null || !IsTaskShareOpen)
        {
            return;
        }

        IsTaskShareLoading = true;
        try
        {
            var list = await _api.GetChatShareableTasksAsync(
                conversation.Id, query, 50, cancellationToken);
            RunOnUi(() =>
            {
                if (!IsTaskShareOpen
                    || !string.Equals(_taskShareSearchText.Trim(), query, StringComparison.Ordinal))
                {
                    return;
                }

                ShareableTasks.Clear();
                foreach (var task in list.Items ?? [])
                {
                    ShareableTasks.Add(new ChatShareableTaskItemViewModel(task, ShareTaskAsync));
                }

                IsTaskShareLoading = false;
            });
        }
        catch (OperationCanceledException)
        {
            RunOnUi(() => IsTaskShareLoading = false);
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                IsTaskShareLoading = false;
                BannerErrorText = TasksViewModel.DescribeError(exception);
            });
        }
    }

    /// <summary>«Поделиться» — POST messages/task-share; ответ вставляем в ленту.</summary>
    private async Task ShareTaskAsync(ChatShareableTaskItemViewModel item)
    {
        var conversation = _selectedConversation;
        if (conversation is null || string.IsNullOrEmpty(item.TaskId) || item.IsSharing)
        {
            return;
        }

        item.IsSharing = true;
        try
        {
            var clientMessageId = "task-share-" + Guid.NewGuid().ToString("N");
            var message = await _api.SendChatTaskShareAsync(
                conversation.Id, item.TaskId, clientMessageId,
                ReplyingTo?.Id, CancellationToken.None);
            RunOnUi(() =>
            {
                CloseTaskShare();
                ReplyingTo = null;
                InsertMessage(message, conversation.IsGroupLike);
                conversation.UpdateLastMessage(message);
                RebuildVisibleConversations();
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
        finally
        {
            item.IsSharing = false;
        }
    }

    // ---- «Поддержка» ----

    /// <summary>Кнопка 🛟 в шапке списка диалогов — чат с поддержкой портала.</summary>
    public ICommand OpenSupportCommand { get; }

    /// <summary>Get-or-create support-диалога и переход в него — зеркало OpenNotes.</summary>
    private async Task OpenSupportAsync(CancellationToken cancellationToken)
    {
        var conversation = await _api.CreateChatSupportConversationAsync(cancellationToken);
        var item = UpsertConversationItem(conversation);
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

    // ---- Отложенные сообщения («Отправить позже») ----
    //
    // Parity web (chatScheduled.js + useChatScheduledMessages + ChatScheduledMessages.jsx):
    // фича режется серверным флагом GET /chat/config → scheduled_messages_enabled;
    // список — свои отложенные открытого диалога (status scheduled|sending|failed);
    // создание — с текстом composer и контекстом ответа; правка времени/текста и
    // armed-отмена из панели; список перечитывается при смене диалога и сразу после
    // наступления ближайшего срока (сообщение уходит в ленту обычным событием).

    /// <summary>Отложенные сообщения открытого диалога (панель «Запланированные»).</summary>
    public ObservableCollection<ChatScheduledMessageItemViewModel> ScheduledMessages { get; } = [];

    /// <summary>Серверный выключатель «Отправить позже» (scheduled_messages_enabled).</summary>
    public bool IsScheduledMessagesEnabled
    {
        get => _scheduledMessagesEnabled;
        private set
        {
            if (SetProperty(ref _scheduledMessagesEnabled, value))
            {
                OnPropertyChanged(nameof(CanScheduleMessage));
                OnPropertyChanged(nameof(HasScheduledBar));
                (OpenScheduleEditorCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>
    /// Кнопка 🕐 у composer и меню «Отправить позже»: фича включена, диалог
    /// обычный (не ai — сервер такие отклоняет) и composer не в режиме правки.
    /// Текст не обязателен: в редакторе есть своё поле сообщения.
    /// </summary>
    public bool CanScheduleMessage =>
        IsScheduledMessagesEnabled
        && _selectedConversation is { Kind: not "ai" }
        && EditingMessage is null
        && !IsSending
        && !IsUploading;

    /// <summary>Плашка «Запланировано: N · ближайшее …» над composer видна.</summary>
    public bool HasScheduledBar =>
        IsScheduledMessagesEnabled
        && (ScheduledMessages.Count > 0 || HasScheduledError);

    /// <summary>Текст плашки: счётчики ожидающих/неотправленных или ошибка загрузки.</summary>
    public string ScheduledBarText
    {
        get
        {
            if (HasScheduledError)
            {
                return ScheduledErrorText!;
            }

            var parts = new List<string>(2);
            var nearest = ScheduledMessages
                .FirstOrDefault(item => item.Status is "scheduled" or "sending")?.ScheduledFor;
            var waiting = ScheduledMessages.Count(item => item.Status is "scheduled" or "sending");
            var failed = ScheduledMessages.Count(item => item.Status is "failed");
            if (waiting > 0)
            {
                var text = $"Запланировано: {waiting}";
                if (nearest is { } when)
                {
                    text += $" · ближайшее {ChatScheduleTime.Format(when)}";
                }

                parts.Add(text);
            }

            if (failed > 0)
            {
                parts.Add($"не отправлено: {failed}");
            }

            return string.Join(" · ", parts);
        }
    }

    /// <summary>Плашка красная — есть неотправленные или ошибка списка.</summary>
    public bool ScheduledBarIsError =>
        HasScheduledError || ScheduledMessages.Any(item => item.Status is "failed");

    /// <summary>Панель «Запланированные» поверх ленты.</summary>
    public bool IsScheduledPanelOpen
    {
        get => _isScheduledPanelOpen;
        private set => SetProperty(ref _isScheduledPanelOpen, value);
    }

    public bool IsLoadingScheduled
    {
        get => _isLoadingScheduled;
        private set => SetProperty(ref _isLoadingScheduled, value);
    }

    /// <summary>
    /// Ошибка списка/операций отложенных — изолирована от BannerErrorText:
    /// показывается в плашке и панели/редакторе (web единый error хука).
    /// </summary>
    public string? ScheduledErrorText
    {
        get => _scheduledErrorText;
        private set
        {
            if (SetProperty(ref _scheduledErrorText, value))
            {
                OnPropertyChanged(nameof(HasScheduledError));
                OnPropertyChanged(nameof(HasScheduledBar));
                OnPropertyChanged(nameof(ScheduledBarText));
                OnPropertyChanged(nameof(ScheduledBarIsError));
                OnPropertyChanged(nameof(IsScheduledListEmpty));
            }
        }
    }

    public bool HasScheduledError => !string.IsNullOrEmpty(ScheduledErrorText);

    /// <summary>«Запланированных сообщений нет» — панель открыта, пусто и без ошибки.</summary>
    public bool IsScheduledListEmpty =>
        IsScheduledPanelOpen && !IsLoadingScheduled
        && ScheduledMessages.Count == 0 && !HasScheduledError;

    /// <summary>Запись (создать/правка/отмена) в полёте — действия списка и editor'а глушим.</summary>
    public bool IsScheduledBusy
    {
        get => _isScheduledBusy;
        private set
        {
            if (SetProperty(ref _isScheduledBusy, value))
            {
                foreach (var item in ScheduledMessages)
                {
                    item.IsBusy = value;
                }

                OnPropertyChanged(nameof(CanConfirmSchedule));
                (ConfirmScheduleCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Оверлей выбора текста и момента отправки (create или правка).</summary>
    public bool IsScheduleEditorOpen
    {
        get => _isScheduleEditorOpen;
        private set
        {
            if (SetProperty(ref _isScheduleEditorOpen, value))
            {
                OnPropertyChanged(nameof(CanConfirmSchedule));
                (ConfirmScheduleCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Заголовок редактора: «Отправить позже» / «Изменить запланированное».</summary>
    public string ScheduleEditorTitle =>
        _editingScheduled is null ? "Отправить позже" : "Изменить запланированное";

    /// <summary>Подпись подтверждения: «Запланировать» / «Сохранить».</summary>
    public string ScheduleEditorConfirmText =>
        _editingScheduled is null ? "Запланировать" : "Сохранить";

    /// <summary>Текст отложенного сообщения (при создании предзаполнен composer'ом).</summary>
    public string ScheduleDraftBody
    {
        get => _scheduleDraftBody;
        set
        {
            if (SetProperty(ref _scheduleDraftBody, value))
            {
                RefreshScheduleDraftValidity();
            }
        }
    }

    /// <summary>Дата отправки (DatePicker; локальная).</summary>
    public DateTime? ScheduleDraftDate
    {
        get => _scheduleDraftDate;
        set
        {
            if (SetProperty(ref _scheduleDraftDate, value))
            {
                RefreshScheduleDraftValidity();
            }
        }
    }

    /// <summary>Время отправки «ЧЧ:ММ» (текстовое поле — в web input datetime-local).</summary>
    public string ScheduleDraftTime
    {
        get => _scheduleDraftTime;
        set
        {
            if (SetProperty(ref _scheduleDraftTime, value))
            {
                RefreshScheduleDraftValidity();
            }
        }
    }

    /// <summary>Ошибка валидации даты/времени/текста — подсказка под полем (красная).</summary>
    public string? ScheduleDraftErrorText
    {
        get => _scheduleDraftErrorText;
        private set
        {
            if (SetProperty(ref _scheduleDraftErrorText, value))
            {
                OnPropertyChanged(nameof(HasScheduleDraftError));
                OnPropertyChanged(nameof(CanConfirmSchedule));
                (ConfirmScheduleCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
            }
        }
    }

    public bool HasScheduleDraftError => !string.IsNullOrEmpty(ScheduleDraftErrorText);

    /// <summary>При валидном времени — «Будет отправлено завтра в 9:00» (helperText web).</summary>
    public string? ScheduleDraftHint
    {
        get => _scheduleDraftHint;
        private set => SetProperty(ref _scheduleDraftHint, value);
    }

    /// <summary>Подтвердить можно при заполненном тексте и валидном будущем времени.</summary>
    public bool CanConfirmSchedule =>
        IsScheduleEditorOpen && !IsScheduledBusy
        && !string.IsNullOrWhiteSpace(ScheduleDraftBody)
        && !HasScheduleDraftError
        && ResolveScheduleDraftTime() is not null;

    /// <summary>Открыть редактор «Отправить позже» (кнопка 🕐 у composer / меню отправки).</summary>
    public ICommand OpenScheduleEditorCommand { get; }

    public ICommand CloseScheduleEditorCommand { get; }

    /// <summary>«Запланировать»/«Сохранить» — POST или PATCH по режиму редактора.</summary>
    public ICommand ConfirmScheduleCommand { get; }

    /// <summary>Быстрые чипы времени (hour|tomorrow|monday — как в web-диалоге).</summary>
    public ICommand ApplySchedulePresetCommand { get; }

    /// <summary>Плашка «Запланировано…» — открыть панель списка.</summary>
    public ICommand ToggleScheduledPanelCommand { get; }

    public ICommand CloseScheduledPanelCommand { get; }

    /// <summary>
    /// GET /chat/config раз на загрузку (web кеширует на сессию): до 3 попыток
    /// с нарастающей паузой; сбой — фича остаётся скрытой без баннера.
    /// </summary>
    private async Task LoadChatConfigSafelyAsync()
    {
        if (_chatConfigRequested)
        {
            return;
        }

        _chatConfigRequested = true;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            try
            {
                if (attempt > 0)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5) * attempt);
                }

                var config = await _api.GetChatConfigAsync(CancellationToken.None);
                RunOnUi(() =>
                {
                    IsScheduledMessagesEnabled = config.ScheduledMessagesEnabled;
                    if (IsScheduledMessagesEnabled && _selectedConversation is { } conversation)
                    {
                        _ = LoadScheduledSafelyAsync(conversation);
                    }
                });
                return;
            }
            catch (Exception)
            {
                // Конфиг — вспомогательный запрос: молчим и повторяем, как web.
            }
        }
    }

    /// <summary>GET …/scheduled для диалога; список пересобирается и вешает due-таймер.</summary>
    private async Task LoadScheduledSafelyAsync(ConversationItemViewModel conversation)
    {
        if (!IsScheduledMessagesEnabled || conversation.Kind == "ai")
        {
            return;
        }

        var scope = _scheduledScope;
        try
        {
            var list = await _api.GetChatScheduledMessagesAsync(
                conversation.Id, CancellationToken.None);
            RunOnUi(() =>
            {
                if (!ReferenceEquals(_scheduledScope, scope)
                    || !ReferenceEquals(_selectedConversation, conversation))
                {
                    return;
                }

                ApplyScheduledItems(conversation, list.Items ?? []);
                ScheduledErrorText = null;
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                if (ReferenceEquals(_scheduledScope, scope)
                    && ReferenceEquals(_selectedConversation, conversation))
                {
                    ScheduledErrorText = TasksViewModel.DescribeError(exception);
                }
            });
        }
    }

    /// <summary>Список отложенных пересобран: пункты + due-таймер ближайшего срока.</summary>
    private void ApplyScheduledItems(
        ConversationItemViewModel conversation,
        IReadOnlyList<HubChatScheduledMessage> items)
    {
        ScheduledMessages.Clear();
        _armedScheduledCancel = null;
        foreach (var model in items)
        {
            if (string.IsNullOrEmpty(model.Id))
            {
                continue;
            }

            ScheduledMessages.Add(new ChatScheduledMessageItemViewModel(
                model,
                item => BeginEditScheduledAsync(item),
                item => CancelScheduledSafelyAsync(item))
            {
                IsBusy = IsScheduledBusy,
            });
        }

        OnPropertyChanged(nameof(HasScheduledBar));
        OnPropertyChanged(nameof(ScheduledBarText));
        OnPropertyChanged(nameof(ScheduledBarIsError));
        OnPropertyChanged(nameof(IsScheduledListEmpty));
        ScheduleDueReload(conversation);
    }

    /// <summary>
    /// Перечитать список сразу после ближайшего срока отправки (+3 с — web reload
    /// at due+3s): ушедшее сообщение покидает список без ручного refresh.
    /// </summary>
    private void ScheduleDueReload(ConversationItemViewModel conversation)
    {
        var due = ScheduledMessages
            .Where(item => item.Status is "scheduled" or "sending" && item.ScheduledFor is not null)
            .Select(item => item.ScheduledFor!.Value)
            .DefaultIfEmpty()
            .Min();
        if (due == default)
        {
            return;
        }

        var scope = _scheduledScope;
        var delay = due - DateTimeOffset.Now + TimeSpan.FromSeconds(3);
        if (delay < TimeSpan.FromSeconds(3))
        {
            delay = TimeSpan.FromSeconds(3);
        }

        _ = ReloadScheduledAtDueAsync(conversation, scope, delay);
    }

    private async Task ReloadScheduledAtDueAsync(
        ConversationItemViewModel conversation,
        object scope,
        TimeSpan delay)
    {
        try
        {
            await Task.Delay(delay);
            if (ReferenceEquals(_scheduledScope, scope)
                && ReferenceEquals(_selectedConversation, conversation)
                && IsScheduledMessagesEnabled)
            {
                await LoadScheduledSafelyAsync(conversation);
            }
        }
        catch (Exception)
        {
            // Таймер — фоновая освежалка: любой сбой гасим, список перечитают действия.
        }
    }

    /// <summary>
    /// Общий прогон записи (web run()): busy → запрос → перечитать список;
    /// ошибка — в изолированный ScheduledErrorText, состояние гуардам по scope.
    /// </summary>
    private async Task<T?> RunScheduledAsync<T>(
        Func<CancellationToken, Task<T>> action,
        string fallback) where T : class
    {
        var scope = _scheduledScope;
        RunOnUi(() =>
        {
            IsScheduledBusy = true;
            ScheduledErrorText = null;
        });
        try
        {
            var result = await action(CancellationToken.None);
            if (!ReferenceEquals(_scheduledScope, scope))
            {
                return null;
            }

            if (_selectedConversation is { } conversation)
            {
                await LoadScheduledSafelyAsync(conversation);
            }

            return ReferenceEquals(_scheduledScope, scope) ? result : null;
        }
        catch (Exception exception)
        {
            RunOnUi(() =>
            {
                if (ReferenceEquals(_scheduledScope, scope))
                {
                    ScheduledErrorText = exception is HubApiException
                        ? TasksViewModel.DescribeError(exception)
                        : fallback;
                }
            });
            return null;
        }
        finally
        {
            RunOnUi(() =>
            {
                if (ReferenceEquals(_scheduledScope, scope))
                {
                    IsScheduledBusy = false;
                }
            });
        }
    }

    /// <summary>Редактор создания: текст из composer'а, время — ближайший пресет.</summary>
    private void OpenScheduleEditor()
    {
        if (!CanScheduleMessage)
        {
            return;
        }

        _editingScheduled = null;
        ScheduleDraftBody = ComposerText;
        var preset = ChatScheduleTime.Presets()[0].When.LocalDateTime;
        ScheduleDraftDate = preset.Date;
        ScheduleDraftTime = preset.ToString("HH:mm", CultureInfo.InvariantCulture);
        ScheduledErrorText = null;
        OnPropertyChanged(nameof(ScheduleEditorTitle));
        OnPropertyChanged(nameof(ScheduleEditorConfirmText));
        IsScheduleEditorOpen = true;
        RefreshScheduleDraftValidity();
    }

    /// <summary>Правка из панели: подставить текст и время, панель закрыть (web-флоу).</summary>
    private Task BeginEditScheduledAsync(ChatScheduledMessageItemViewModel item)
    {
        if (!CanScheduleMessage && _selectedConversation is null)
        {
            return Task.CompletedTask;
        }

        CloseScheduledPanel();
        _editingScheduled = item;
        ScheduleDraftBody = item.Body;
        var local = item.ScheduledFor?.LocalDateTime ?? DateTime.Now.AddHours(1);
        ScheduleDraftDate = local.Date;
        ScheduleDraftTime = local.ToString("HH:mm", CultureInfo.InvariantCulture);
        ScheduledErrorText = null;
        OnPropertyChanged(nameof(ScheduleEditorTitle));
        OnPropertyChanged(nameof(ScheduleEditorConfirmText));
        IsScheduleEditorOpen = true;
        RefreshScheduleDraftValidity();
        return Task.CompletedTask;
    }

    private void CloseScheduleEditor()
    {
        IsScheduleEditorOpen = false;
        _editingScheduled = null;
        ScheduledErrorText = null;
    }

    /// <summary>Чип пресета: подставить дату/время выбранного варианта.</summary>
    private void ApplySchedulePreset(string? key)
    {
        var preset = ChatScheduleTime.Presets()
            .FirstOrDefault(candidate => candidate.Key == key);
        if (preset.Key is null)
        {
            return;
        }

        var local = preset.When.LocalDateTime;
        ScheduleDraftDate = local.Date;
        ScheduleDraftTime = local.ToString("HH:mm", CultureInfo.InvariantCulture);
    }

    /// <summary>Живая валидация даты/времени: ошибка либо подсказка «Будет отправлено …».</summary>
    private void RefreshScheduleDraftValidity()
    {
        var when = ResolveScheduleDraftTime();
        if (when is { } valid)
        {
            ScheduleDraftErrorText = null;
            ScheduleDraftHint = $"Будет отправлено {ChatScheduleTime.Format(valid)}";
        }
        else
        {
            ScheduleDraftHint = null;
        }

        OnPropertyChanged(nameof(CanConfirmSchedule));
        (ConfirmScheduleCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>
    /// Дата + «ЧЧ:ММ» → локальный момент отправки или null (ошибка попадает
    /// в ScheduleDraftErrorText, как helperText datetime-local в web).
    /// </summary>
    private DateTimeOffset? ResolveScheduleDraftTime()
    {
        string? error = null;
        DateTimeOffset? when = null;
        if (_scheduleDraftDate is not { } date)
        {
            error = "Укажите дату и время";
        }
        else if (!TimeSpan.TryParseExact(
                     (_scheduleDraftTime ?? string.Empty).Trim(),
                     ["h\\:mm", "hh\\:mm"],
                     CultureInfo.InvariantCulture,
                     out var timeOfDay)
                 || timeOfDay >= TimeSpan.FromDays(1))
        {
            error = "Укажите дату и время";
        }
        else
        {
            var candidate = new DateTimeOffset(date.Date + timeOfDay);
            var validation = ChatScheduleTime.Validate(candidate);
            if (validation.Length > 0)
            {
                error = validation;
            }
            else
            {
                when = candidate;
            }
        }

        ScheduleDraftErrorText = error;
        return when;
    }

    /// <summary>Подтверждение редактора: POST нового или PATCH существующего.</summary>
    private async Task ConfirmScheduleAsync(CancellationToken cancellationToken)
    {
        var body = ScheduleDraftBody.Trim();
        var when = ResolveScheduleDraftTime();
        if (body.Length == 0)
        {
            ScheduleDraftErrorText = "Введите текст сообщения";
            return;
        }

        if (when is not { } scheduledFor)
        {
            return;
        }

        if (_editingScheduled is { } editing)
        {
            var updated = await RunScheduledAsync(
                ct => _api.UpdateChatScheduledMessageAsync(
                    editing.Id, body, scheduledFor, ct),
                "Не удалось изменить сообщение.");
            if (updated is not null)
            {
                CloseScheduleEditor();
            }

            return;
        }

        var conversation = _selectedConversation;
        if (conversation is null || !CanScheduleMessage)
        {
            return;
        }

        var created = await RunScheduledAsync(
            ct => _api.CreateChatScheduledMessageAsync(
                conversation.Id, body, scheduledFor, ReplyingTo?.Id, ct),
            "Не удалось запланировать сообщение.");
        if (created is null)
        {
            return;
        }

        CloseScheduleEditor();
        // Успешное планирование очищает composer и контекст ответа (web-флоу).
        if (ReferenceEquals(_selectedConversation, conversation))
        {
            ComposerText = string.Empty;
            ClearComposerContext();
        }

        // Текст ушёл в отложенное — черновик этого диалога тоже сгорает.
        PersistDraftNow(conversation.Id, null);
    }

    /// <summary>Отмена отложенного — armed: первое нажатие взводит, второе DELETE.</summary>
    private async Task CancelScheduledSafelyAsync(ChatScheduledMessageItemViewModel item)
    {
        if (item.IsBusy)
        {
            return;
        }

        if (!item.CancelArmed)
        {
            if (_armedScheduledCancel is { } previous && !ReferenceEquals(previous, item))
            {
                previous.CancelArmed = false;
            }

            _armedScheduledCancel = item;
            item.CancelArmed = true;
            return;
        }

        item.CancelArmed = false;
        _armedScheduledCancel = null;
        await RunScheduledAsync(
            ct => _api.CancelChatScheduledMessageAsync(item.Id, ct),
            "Не удалось отменить сообщение.");
    }

    /// <summary>Плашка/кнопка «Запланировано…» — открыть/закрыть панель со списком.</summary>
    private async Task ToggleScheduledPanelAsync(CancellationToken cancellationToken)
    {
        if (IsScheduledPanelOpen)
        {
            CloseScheduledPanel();
            return;
        }

        if (!IsScheduledMessagesEnabled || _selectedConversation is not { Kind: not "ai" } conversation)
        {
            return;
        }

        // Оверлеи ленты взаимоисключающие.
        CloseForwardPanel();
        CloseMessageSearch();
        IsReadersPanelOpen = false;
        CloseMembersPanel();
        CloseMediaPanel();
        CloseGroupSettings();
        CloseJoinRequestsPanel();
        CloseReportsPanel();
        CloseReportDialog();
        CloseTaskShare();
        IsScheduledPanelOpen = true;
        IsLoadingScheduled = true;
        try
        {
            var list = await _api.GetChatScheduledMessagesAsync(conversation.Id, cancellationToken);
            if (IsScheduledPanelOpen && ReferenceEquals(_selectedConversation, conversation))
            {
                ApplyScheduledItems(conversation, list.Items ?? []);
                ScheduledErrorText = null;
            }
        }
        finally
        {
            IsLoadingScheduled = false;
        }
    }

    private void CloseScheduledPanel()
    {
        IsScheduledPanelOpen = false;
        IsLoadingScheduled = false;
    }

    /// <summary>Смена диалога/Reset: список, панель, редактор и armed-отмена не переживают ленту.</summary>
    private void ResetScheduledState()
    {
        _scheduledScope = new object();
        _armedScheduledCancel = null;
        ScheduledMessages.Clear();
        IsScheduledPanelOpen = false;
        IsScheduleEditorOpen = false;
        _editingScheduled = null;
        IsLoadingScheduled = false;
        IsScheduledBusy = false;
        ScheduledErrorText = null;
        _scheduleDraftBody = string.Empty;
        OnPropertyChanged(nameof(ScheduleDraftBody));
        _scheduleDraftDate = null;
        OnPropertyChanged(nameof(ScheduleDraftDate));
        _scheduleDraftTime = string.Empty;
        OnPropertyChanged(nameof(ScheduleDraftTime));
        ScheduleDraftErrorText = null;
        ScheduleDraftHint = null;
        OnPropertyChanged(nameof(HasScheduledBar));
        OnPropertyChanged(nameof(ScheduledBarText));
        OnPropertyChanged(nameof(ScheduledBarIsError));
        OnPropertyChanged(nameof(IsScheduledListEmpty));
        OnPropertyChanged(nameof(CanScheduleMessage));
    }

    // ---- Вступление по ссылке-приглашению (deep link ?join=) ----

    /// <summary>
    /// Deep link «/chat?join=TOKEN»: POST invite-links/{token}/join.
    /// joined → upsert + выбор; при режиме «по заявкам» — requested: ждём решения.
    /// </summary>
    public async Task JoinConversationByInviteTokenAsync(
        string token,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(token))
        {
            return;
        }

        try
        {
            var result = await _api.JoinChatByInviteLinkAsync(token, cancellationToken);
            RunOnUi(() =>
            {
                if (result.Joined && result.Conversation is { } joined)
                {
                    var item = UpsertConversationItem(joined);
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
                else if (result.Requested)
                {
                    // Группа пускает по заявкам: участник ждёт решения owner/moderator.
                    BannerErrorText = "Заявка на вступление отправлена владельцу группы.";
                }
                else
                {
                    BannerErrorText = "Не удалось вступить по ссылке-приглашению.";
                }
            });
        }
        catch (Exception exception)
        {
            RunOnUi(() => BannerErrorText = TasksViewModel.DescribeError(exception));
        }
    }

    // ---- Гидратация статусов загруженных сообщений ----

    /// <summary>
    /// GET …/messages/hydrate?message_ids= — догрузка read_by_count/delivery/
    /// reactions для видимого среза: после bootstrap-переходов (глобальный поиск,
    /// deep link, закреп) серверные статусы успевают устареть за полёт запросов.
    /// </summary>
    private async Task HydrateLoadedMessagesSafelyAsync(
        ConversationItemViewModel conversation,
        CancellationToken cancellationToken)
    {
        var ids = Messages
            .Select(message => message.Id)
            .Where(id => !string.IsNullOrEmpty(id))
            .Take(200)
            .ToList();
        if (ids.Count == 0)
        {
            return;
        }

        try
        {
            var result = await _api.HydrateChatMessagesAsync(
                conversation.Id, ids, cancellationToken);
            if (!ReferenceEquals(_selectedConversation, conversation)
                || cancellationToken.IsCancellationRequested)
            {
                return;
            }

            var fresh = (result.Items ?? [])
                .Where(item => !string.IsNullOrEmpty(item.MessageId))
                .ToDictionary(item => item.MessageId!, StringComparer.Ordinal);
            foreach (var message in Messages)
            {
                if (fresh.TryGetValue(message.Id, out var item))
                {
                    message.ApplyDelivery(item.ReadByCount, item.DeliveryStatus);
                    message.ApplyReactions(item.Reactions);
                    // Hydrate отдаёт action_card частичным патчем — отсутствие
                    // поля не значит удаления карточки (как realtime-апдейт).
                    if (item.ActionCard is not null)
                    {
                        message.ApplyActionCard(item.ActionCard);
                    }
                }
            }

            // UI-017: свежий read-статус хвоста истории → галочки строки диалога.
            if (Messages.LastOrDefault() is { } tail)
            {
                conversation.SyncLastMessageStatus(tail);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (Exception)
        {
            // Гидратация — фоновое уточнение статусов: сбой гасим без баннера.
        }
    }

    private void RaiseGroupCommandStates()
    {
        (SaveGroupProfileCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (UploadGroupAvatarCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (RemoveGroupAvatarCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (CreateInviteLinkCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (RevokeInviteLinkCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (DeleteGroupCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ToggleJoinRequestsPanelCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ToggleReportsPanelCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
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

    /// <summary>Отложенный UI-тик (гасить вспышку якоря): задержка вне
    /// UI-потока, сам тик — через RunOnUi; умерший тестовый контекст гасим.</summary>
    private void RunDelayed(TimeSpan delay, Action action)
    {
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(delay).ConfigureAwait(false);
                RunOnUi(action);
            }
            catch (Exception)
            {
                // UI-контекст мог умереть (конец теста) — отложенный тик теряем.
            }
        });
    }

    private void RaiseCommandStates()
    {
        // UI-014: IsEnabled скрепки биндится к CanAttach напрямую, без
        // уведомления при смене выбора/отправки/загрузки цель остаётся
        // выключенной при CanAttach=True в VM. Эмодзи и «Поделиться
        // задачей» — CanExecute по HasConversation: нужен явный raise.
        OnPropertyChanged(nameof(CanAttach));
        OnPropertyChanged(nameof(ShowSendFab));
        OnPropertyChanged(nameof(ShowMicFab));
        (SendCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (AttachCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (AttachDroppedFilesCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ToggleStickerPanelCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (OpenTaskShareCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (LoadOlderCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (LoadMoreConversationsCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ConfirmAttachmentsCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (RetryHistoryCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (OpenScheduleEditorCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
        (ConfirmScheduleCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (StartVoiceRecordingCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (StopVoiceRecordingCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (CancelVoiceRecordingCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
        (SendVoiceMessageCommand as NativeAsyncCommand)?.RaiseCanExecuteChanged();
        (ToggleVoicePreviewCommand as NativeRelayCommand)?.RaiseCanExecuteChanged();
    }

    /// <summary>Вид контента просмотрщика: картинка, видео, аудио или fallback.</summary>
    private enum MediaViewerContentKind
    {
        Image,
        Video,
        Audio,
        Unsupported,
    }

    /// <summary>Элемент списка просмотрщика: источник из ленты или из галереи —
    /// полей хватает и для докачки, и для определения способа показа (UI-026).</summary>
    private sealed record MediaViewerEntry(
        string MessageId,
        HubChatAttachment Model,
        string DisplayName,
        MediaViewerContentKind Kind);
}

/// <summary>Строка панели «Кто прочитал»: имя и локальное время прочтения.</summary>
public sealed class ChatReadReceiptItemViewModel
{
    private readonly int _userId;

    public ChatReadReceiptItemViewModel(HubChatReadReceipt receipt)
    {
        _userId = receipt.User?.Id ?? 0;
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

    /// <summary>Градиентный круг аватара — палитра пиров по id пользователя.</summary>
    public System.Windows.Media.Brush AvatarBrush => ChatPeerPalette.AvatarBrush(
        _userId.ToString(CultureInfo.InvariantCulture));

    /// <summary>Двухбуквенные инициалы на градиентном аватаре.</summary>
    public string AvatarInitials => ChatPeerPalette.Initials(DisplayName);
}
