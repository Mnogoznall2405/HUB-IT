using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;
// ImplicitUsings тянут System.Drawing — там тоже есть Brush/Color/Point;
// алиасы фиксируют WPF-типы палитры пиров.
using Brush = System.Windows.Media.Brush;
using Color = System.Windows.Media.Color;
using ColorConverter = System.Windows.Media.ColorConverter;
using Point = System.Windows.Point;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Палитра пиров как в Telegram Desktop: имя отправителя в группе и градиент
/// круглого аватара делят один индекс (red→pink). Индекс — хэш стабильного
/// ключа: id пользователя/диалога, иначе имя; алгоритм hash*31 совпадает с
/// web (hashSenderColorIndex/resolveChatTelegramAvatarColor), поэтому цвет
/// пользователя совпадает в ленте, списке диалогов и web-чате. Палитра
/// темонезависима, как в tdesktop; кисти заморожены — создаются один раз
/// и разделяются всеми строками на STA-рендере.
/// </summary>
internal static class ChatPeerPalette
{
    // Порядок индексов — эталон tdesktop: red, orange, violet, green, cyan, blue, pink.
    private static readonly Brush[] NameBrushes =
    [
        FrozenSolid("#CC5049"),
        FrozenSolid("#D67722"),
        FrozenSolid("#955CDB"),
        FrozenSolid("#40A920"),
        FrozenSolid("#309EBA"),
        FrozenSolid("#368AD1"),
        FrozenSolid("#C7508B"),
    ];

    private static readonly Brush[] AvatarBrushes =
    [
        FrozenGradient("#FF845E", "#D45246"),
        FrozenGradient("#FEBB5B", "#F68136"),
        FrozenGradient("#B694F9", "#9C6DFB"),
        FrozenGradient("#9AD164", "#46BA43"),
        FrozenGradient("#5BE0C8", "#27B79F"),
        FrozenGradient("#5CAFFA", "#408ACF"),
        FrozenGradient("#FF8AAC", "#D95574"),
    ];

    /// <summary>Индекс пира: hash = hash*31 + char (unchecked uint32 — как web).</summary>
    public static int IndexOf(string? key)
    {
        var normalized = (key ?? string.Empty).Trim();
        if (normalized.Length == 0)
        {
            return 5; // голубой дефолт — индекс 5, как resolveChatTelegramAvatarColor
        }

        var hash = 0u;
        foreach (var symbol in normalized)
        {
            hash = hash * 31u + symbol;
        }

        return (int)(hash % (uint)NameBrushes.Length);
    }

    /// <summary>Цвет имени отправителя в групповом пузыре.</summary>
    public static Brush NameBrush(string? key) => NameBrushes[IndexOf(key)];

    /// <summary>Градиент круглого аватара — та же пара, что и цвет имени.</summary>
    public static Brush AvatarBrush(string? key) => AvatarBrushes[IndexOf(key)];

    /// <summary>Инициалы аватара: первые буквы первых двух слов, как в Telegram.</summary>
    public static string Initials(string? name)
    {
        var trimmed = (name ?? string.Empty).Trim();
        if (trimmed.Length == 0)
        {
            return "•";
        }

        var initials = new StringBuilder(2);
        foreach (var word in trimmed.Split(null as char[], StringSplitOptions.RemoveEmptyEntries))
        {
            initials.Append(char.ToUpperInvariant(word[0]));
            if (initials.Length == 2)
            {
                break;
            }
        }

        return initials.ToString();
    }

    private static Brush FrozenSolid(string color)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
        brush.Freeze();
        return brush;
    }

    private static Brush FrozenGradient(string from, string to)
    {
        var brush = new LinearGradientBrush(
            (Color)ColorConverter.ConvertFromString(from),
            (Color)ColorConverter.ConvertFromString(to),
            new Point(0, 0),
            new Point(0, 1));
        brush.Freeze();
        return brush;
    }
}

/// <summary>Русская плюрализация: 1 участник, 3 участника, 7 участников.</summary>
internal static class ChatPlural
{
    public static string Of(int count, string one, string few, string many)
    {
        var mod100 = Math.Abs(count) % 100;
        var mod10 = mod100 % 10;
        if (mod100 is >= 11 and <= 14)
        {
            return many;
        }

        return mod10 switch
        {
            1 => one,
            >= 2 and <= 4 => few,
            _ => many,
        };
    }
}

/// <summary>
/// Цель сохранения экспорта истории: путь из SaveFileDialog и формат
/// (txt|json — выбранный фильтр диалога, как в web два пункта меню).
/// </summary>
public sealed record ChatExportTarget(string Path, string Format);

/// <summary>Диалог в левом списке: заголовок, превью, время, badge непрочитанных.</summary>
public sealed class ConversationItemViewModel : ObservableObject
{
    private string _title = string.Empty;
    private string? _preview;
    private DateTimeOffset? _lastMessageAt;
    private int _unreadCount;
    private int _unreadMentionCount;
    private string? _kindText;
    private bool _isPinned;
    private bool _isMuted;
    private bool _isArchived;
    private bool _isSupport;
    private DateTimeOffset? _mutedUntil;
    private bool _isOnline;
    private string? _presenceText;
    private string? _viewerMemberRole;
    private string? _typingText;
    private string? _draftText;
    private Brush? _avatarBrush;
    private string _avatarInitials = "•";

    public ConversationItemViewModel(HubChatConversation conversation)
    {
        Id = conversation.Id;
        Update(conversation);
    }

    public string Id { get; }

    public string? Kind { get; private set; }

    /// <summary>Групповой диалог (показываем имя отправителя в ленте).</summary>
    public bool IsGroupLike => Kind is "group" or "task";

    /// <summary>Закреплён — вверху списка; переключается через меню диалога.</summary>
    public bool IsPinned
    {
        get => _isPinned;
        private set
        {
            if (SetProperty(ref _isPinned, value))
            {
                OnPropertyChanged(nameof(PinBadgeText));
                OnPropertyChanged(nameof(PinMenuText));
            }
        }
    }

    /// <summary>Уведомления заглушены — входящие не поднимают toast.</summary>
    public bool IsMuted
    {
        get => _isMuted;
        private set
        {
            if (SetProperty(ref _isMuted, value))
            {
                OnPropertyChanged(nameof(IsEffectivelyMuted));
                OnPropertyChanged(nameof(MuteBadgeText));
                OnPropertyChanged(nameof(MuteMenuText));
            }
        }
    }

    /// <summary>Архивный — скрыт из обычного списка, виден в фильтре «Архив».</summary>
    public bool IsArchived
    {
        get => _isArchived;
        private set
        {
            if (SetProperty(ref _isArchived, value))
            {
                OnPropertyChanged(nameof(ArchiveMenuText));
                OnPropertyChanged(nameof(ArchiveMenuIcon));
            }
        }
    }

    /// <summary>До какого момента заглушён (null — бессрочно).</summary>
    public DateTimeOffset? MutedUntil
    {
        get => _mutedUntil;
        private set
        {
            if (SetProperty(ref _mutedUntil, value))
            {
                OnPropertyChanged(nameof(IsEffectivelyMuted));
                OnPropertyChanged(nameof(MuteBadgeText));
            }
        }
    }

    /// <summary>
    /// Мute с истёкшим muted_until уже не глушит — как в web (chatFolderUtils).
    /// </summary>
    public bool IsEffectivelyMuted =>
        IsMuted && (MutedUntil is null || MutedUntil > DateTimeOffset.UtcNow);

    /// <summary>Закреплённое в диалоге сообщение (шапка ленты).</summary>
    public string? PinnedMessageId { get; private set; }

    /// <summary>Маркер 📌 в строке списка.</summary>
    public string PinBadgeText => IsPinned ? "📌" : string.Empty;

    /// <summary>Маркер 🔇 в строке списка.</summary>
    public string MuteBadgeText => IsEffectivelyMuted ? "🔇" : string.Empty;

    /// <summary>Подпись пункта меню закрепления.</summary>
    public string PinMenuText => IsPinned ? "Открепить" : "Закрепить";

    /// <summary>Подпись пункта меню заглушения.</summary>
    public string MuteMenuText => IsMuted ? "Включить уведомления" : "Отключить уведомления";

    /// <summary>Подпись пункта меню архива.</summary>
    public string ArchiveMenuText => IsArchived ? "Вернуть из архива" : "В архив";

    /// <summary>Иконка пункта архива: 📤 «разархивировать» / 🗃 «в архив».</summary>
    public string ArchiveMenuIcon => IsArchived ? "📤" : "🗃";

    /// <summary>Роль текущего пользователя в группе (viewer_member_role из summary).</summary>
    public string? ViewerMemberRole
    {
        get => _viewerMemberRole;
        private set
        {
            if (SetProperty(ref _viewerMemberRole, value))
            {
                OnPropertyChanged(nameof(CanLeaveGroup));
                OnPropertyChanged(nameof(CanExportHistory));
            }
        }
    }

    /// <summary>
    /// Пункт «Покинуть группу»: только kind="group" и не владельцу —
    /// владельцу сервер требует successor (передача прав вне этого меню).
    /// </summary>
    public bool CanLeaveGroup =>
        string.Equals(Kind, "group", StringComparison.Ordinal)
        && !string.Equals(ViewerMemberRole, "owner", StringComparison.Ordinal);

    /// <summary>
    /// Пункт «Экспорт истории»: в личных/заметках/задачах — любому участнику,
    /// в группе — только owner/moderator (как canExportHistory в web).
    /// </summary>
    public bool CanExportHistory =>
        !string.Equals(Kind, "group", StringComparison.Ordinal)
        || ViewerMemberRole is "owner" or "moderator";

    /// <summary>Провайдер выхода из группы — подставляет ChatViewModel (POST leave).</summary>
    public Func<ConversationItemViewModel, Task>? LeaveHandler { get; set; }

    private ICommand? _leaveGroupCommand;

    /// <summary>Меню «Покинуть группу».</summary>
    public ICommand LeaveGroupCommand => _leaveGroupCommand ??= new NativeRelayCommand(_ =>
    {
        if (CanLeaveGroup && LeaveHandler is { } handler)
        {
            _ = handler(this);
        }
    });

    private ICommand? _exportHistoryCommand;

    /// <summary>Меню «Экспорт истории» — выбор файла и выгрузка через view-провайдер.</summary>
    public ICommand ExportHistoryCommand => _exportHistoryCommand ??= new NativeRelayCommand(_ =>
    {
        if (CanExportHistory && ExportHandler is { } handler)
        {
            _ = handler(this);
        }
    });

    /// <summary>Провайдер экспорта истории — подставляет ChatViewModel (GET export → файл).</summary>
    public Func<ConversationItemViewModel, Task>? ExportHandler { get; set; }

    /// <summary>Провайдер pin/mute — подставляет ChatViewModel (PATCH settings).</summary>
    public Func<ConversationItemViewModel, string, Task>? SettingsHandler { get; set; }

    private ICommand? _togglePinCommand;

    /// <summary>Меню «Закрепить/Открепить».</summary>
    public ICommand TogglePinCommand => _togglePinCommand ??= new NativeRelayCommand(_ =>
    {
        if (SettingsHandler is { } handler)
        {
            _ = handler(this, "pin");
        }
    });

    private ICommand? _toggleMuteCommand;

    /// <summary>Меню «Отключить/Включить уведомления».</summary>
    public ICommand ToggleMuteCommand => _toggleMuteCommand ??= new NativeRelayCommand(_ =>
    {
        if (SettingsHandler is { } handler)
        {
            _ = handler(this, "mute");
        }
    });

    private ICommand? _toggleArchiveCommand;

    /// <summary>Меню «В архив/Вернуть из архива».</summary>
    public ICommand ToggleArchiveCommand => _toggleArchiveCommand ??= new NativeRelayCommand(_ =>
    {
        if (SettingsHandler is { } handler)
        {
            _ = handler(this, "archive");
        }
    });

    /// <summary>
    /// Пункты подменю «Добавить в папку» — ChatViewModel пересобирает при
    /// смене списка папок/карты членства (пусто до загрузки папок).
    /// </summary>
    public ObservableCollection<ChatFolderMenuItemViewModel> FolderMenuItems { get; } = [];

    /// <summary>Подменю «Добавить в папку» видно, когда пользовательские папки есть.</summary>
    public bool HasFolderMenuItems => FolderMenuItems.Count > 0;

    /// <summary>Нотификация видимости подменю после пересборки FolderMenuItems.</summary>
    internal void RaiseFolderMenuItemsChanged() =>
        OnPropertyChanged(nameof(HasFolderMenuItems));

    public HubChatUser? DirectPeer { get; private set; }

    /// <summary>
    /// «@username» собеседника — инфо-строка карточки direct-диалога (tg-profile).
    /// null, когда peer не direct или у него нет username.
    /// </summary>
    public string? PeerUsernameText =>
        string.IsNullOrWhiteSpace(DirectPeer?.Username) ? null : "@" + DirectPeer.Username;

    /// <summary>Собеседник онлайн — зелёная точка на аватаре строки диалога.</summary>
    public bool IsOnline
    {
        get => _isOnline;
        private set => SetProperty(ref _isOnline, value);
    }

    /// <summary>Статус в шапке direct-диалога: «В сети» / «Был(а) …»; null — скрыт.</summary>
    public string? PresenceText
    {
        get => _presenceText;
        private set => SetProperty(ref _presenceText, value);
    }

    /// <summary>
    /// Применить presence собеседника: из direct_peer.presence в DTO диалога
    /// или из события chat.presence.updated. null — «нет данных», статус гасим.
    /// </summary>
    public void ApplyPresence(HubChatPresence? presence)
    {
        IsOnline = presence?.IsOnline == true;
        PresenceText = ResolvePresenceText(presence);
    }

    /// <summary>
    /// Текст статуса: серверный status_text (всегда есть в реальном трафике),
    /// fallback — «В сети» по флагу или «Был(а) HH:mm» по last_seen_at.
    /// </summary>
    private static string? ResolvePresenceText(HubChatPresence? presence)
    {
        if (presence is null)
        {
            return null;
        }

        if (!string.IsNullOrWhiteSpace(presence.StatusText))
        {
            return presence.StatusText;
        }

        if (presence.IsOnline)
        {
            return "В сети";
        }

        return presence.LastSeenAt is { } seen
            ? $"Был(а) {seen.LocalDateTime:HH:mm}"
            : null;
    }

    public string Title
    {
        get => _title;
        private set => SetProperty(ref _title, value);
    }

    public string AvatarInitial =>
        string.IsNullOrWhiteSpace(Title) ? "•" : Title.Trim()[..1].ToUpperInvariant();

    /// <summary>Градиентный круг аватара диалога — палитра пиров Telegram.</summary>
    public Brush? AvatarBrush
    {
        get => _avatarBrush;
        private set => SetProperty(ref _avatarBrush, value);
    }

    /// <summary>Двухбуквенные инициалы на градиентном аватаре.</summary>
    public string AvatarInitials
    {
        get => _avatarInitials;
        private set => SetProperty(ref _avatarInitials, value);
    }

    private ImageSource? _avatarImage;
    private string? _avatarUrl;
    private bool _avatarRequested;
    private AuthImageLoader? _avatarLoader;

    /// <summary>
    /// Фото-аватар диалога (avatar_url → AuthImageLoader, decode 96px);
    /// null — круг остаётся градиентом с инициалами (placeholder и fallback).
    /// </summary>
    public ImageSource? AvatarImage
    {
        get => _avatarImage;
        private set
        {
            if (SetProperty(ref _avatarImage, value))
            {
                OnPropertyChanged(nameof(HasAvatarImage));
            }
        }
    }

    /// <summary>Фото загружено — поверх градиента рисуется ImageBrush-круг.</summary>
    public bool HasAvatarImage => AvatarImage is not null;

    /// <summary>Загрузчик картинок — подставляет ChatViewModel; назначение пинает загрузку.</summary>
    public AuthImageLoader? AvatarLoader
    {
        get => _avatarLoader;
        set
        {
            _avatarLoader = value;
            KickAvatarLoad();
        }
    }

    /// <summary>avatar_url из DTO; смена сбрасывает фото и перезапускает загрузку.</summary>
    private void SetAvatarUrl(string? url)
    {
        if (string.Equals(_avatarUrl, url, StringComparison.Ordinal))
        {
            return;
        }

        _avatarUrl = url;
        _avatarRequested = false;
        AvatarImage = null;
        KickAvatarLoad();
    }

    private void KickAvatarLoad()
    {
        if (_avatarRequested || _avatarLoader is null || string.IsNullOrWhiteSpace(_avatarUrl))
        {
            return;
        }

        _avatarRequested = true;
        var url = _avatarUrl;
        var loader = _avatarLoader;
        _ = Task.Run(async () =>
        {
            var image = await loader.LoadAsync(url, decodePixelWidth: 96);
            if (image is not null && string.Equals(_avatarUrl, url, StringComparison.Ordinal))
            {
                // BitmapImage заморожен — присваивание с фонового потока безопасно;
                // WPF сам маршалит PropertyChanged в UI.
                AvatarImage = image;
            }
        });
    }

    public string? Preview
    {
        get => _preview;
        private set => SetProperty(ref _preview, value);
    }

    /// <summary>
    /// Собеседник печатает (chat.typing.*): превью строки временно заменяется
    /// акцентным «… печатает…», как в Telegram. null — обычный превью.
    /// </summary>
    public string? TypingText
    {
        get => _typingText;
        private set
        {
            if (SetProperty(ref _typingText, value))
            {
                OnPropertyChanged(nameof(IsTyping));
            }
        }
    }

    /// <summary>Режим «печатает…» активен у этого диалога.</summary>
    public bool IsTyping => !string.IsNullOrEmpty(TypingText);

    /// <summary>Входящее typing-событие или его таймер выставляет/снимает текст.</summary>
    public void SetTyping(string? text) => TypingText = text;

    /// <summary>
    /// Клиентский черновик (native draft store): строка рисует красный префикс
    /// «Черновик: » + текст вместо превью. «Печатает…» важнее — выше в строке.
    /// </summary>
    public string? DraftText
    {
        get => _draftText;
        private set
        {
            if (SetProperty(ref _draftText, value))
            {
                OnPropertyChanged(nameof(HasDraft));
            }
        }
    }

    /// <summary>Есть неотправленный черновик — превью уходит под красный префикс.</summary>
    public bool HasDraft => !string.IsNullOrEmpty(DraftText);

    /// <summary>Синк черновика из VM (композитор/сторадж/отправка/выход).</summary>
    public void SetDraft(string? text) => DraftText = text;

    private bool _lastMessageIsOwn;

    /// <summary>Последнее сообщение — своё: строка рисует акцентный префикс «Вы:».</summary>
    public bool LastMessageIsOwn
    {
        get => _lastMessageIsOwn;
        private set => SetProperty(ref _lastMessageIsOwn, value);
    }

    public DateTimeOffset? LastMessageAt
    {
        get => _lastMessageAt;
        private set
        {
            if (SetProperty(ref _lastMessageAt, value))
            {
                OnPropertyChanged(nameof(TimeText));
            }
        }
    }

    /// <summary>Сегодня → HH:mm, иначе dd.MM.</summary>
    public string? TimeText
    {
        get
        {
            if (LastMessageAt is null)
            {
                return null;
            }

            var local = LastMessageAt.Value.LocalDateTime;
            return local.Date == DateTime.Now.Date
                ? local.ToString("HH:mm", CultureInfo.InvariantCulture)
                : local.ToString("dd.MM", CultureInfo.InvariantCulture);
        }
    }

    public int UnreadCount
    {
        get => _unreadCount;
        private set
        {
            if (SetProperty(ref _unreadCount, value))
            {
                OnPropertyChanged(nameof(HasUnread));
                OnPropertyChanged(nameof(UnreadBadgeText));
            }
        }
    }

    /// <summary>Непрочитанные упоминания (unread_mention_count) — бейдж «@» на FAB.</summary>
    public int UnreadMentionCount
    {
        get => _unreadMentionCount;
        private set
        {
            if (SetProperty(ref _unreadMentionCount, value))
            {
                OnPropertyChanged(nameof(HasUnreadMention));
                OnPropertyChanged(nameof(UnreadMentionBadgeText));
            }
        }
    }

    public bool HasUnreadMention => UnreadMentionCount > 0;

    /// <summary>Текст «@»-пилюли в строке списка: «@» при одном, «@N» при нескольких.</summary>
    public string UnreadMentionBadgeText => UnreadMentionCount switch
    {
        > 99 => "@99+",
        > 1 => "@" + UnreadMentionCount.ToString(CultureInfo.InvariantCulture),
        > 0 => "@",
        _ => string.Empty,
    };

    public bool HasUnread => UnreadCount > 0;

    public string UnreadBadgeText => UnreadCount switch
    {
        > 99 => "99+",
        > 0 => UnreadCount.ToString(CultureInfo.InvariantCulture),
        _ => string.Empty,
    };

    /// <summary>Подпись вида диалога: «Группа · 5 участников» и т.п.</summary>
    public string? KindText
    {
        get => _kindText;
        private set => SetProperty(ref _kindText, value);
    }

    /// <summary>Служебный диалог поддержки (is_support) — в карточке иконка 🛟.</summary>
    public bool IsSupport
    {
        get => _isSupport;
        private set
        {
            if (SetProperty(ref _isSupport, value))
            {
                OnPropertyChanged(nameof(StatusEmoji));
                OnPropertyChanged(nameof(HasStatusEmoji));
            }
        }
    }

    /// <summary>Размер группы — подзаголовок «N участников, M в сети».</summary>
    public int MemberCount { get; private set; }

    public int OnlineMemberCount { get; private set; }

    /// <summary>
    /// Статус-эмодзи рядом с именем (как emoji-status в Telegram): по данным DTO —
    /// поддержка 🛟, AI-ассистент ✨, заметки 🔖; у обычных собеседников — null.
    /// </summary>
    public string? StatusEmoji =>
        IsSupport ? "🛟"
        : Kind switch
        {
            "ai" => "✨",
            "notes" => "🔖",
            _ => null,
        };

    public bool HasStatusEmoji => StatusEmoji is not null;

    public void Update(HubChatConversation conversation)
    {
        Kind = conversation.Kind;
        ViewerMemberRole = conversation.ViewerMemberRole;
        // Kind — обычное свойство без нотификации: CanLeaveGroup/CanExportHistory/StatusEmoji зависят от него.
        OnPropertyChanged(nameof(CanLeaveGroup));
        OnPropertyChanged(nameof(CanExportHistory));
        OnPropertyChanged(nameof(StatusEmoji));
        OnPropertyChanged(nameof(HasStatusEmoji));
        IsPinned = conversation.IsPinned;
        IsMuted = conversation.IsMuted;
        MutedUntil = conversation.MutedUntil;
        IsArchived = conversation.IsArchived;
        IsSupport = conversation.IsSupport;
        MemberCount = conversation.MemberCount;
        OnlineMemberCount = conversation.OnlineMemberCount;
        PinnedMessageId = conversation.PinnedMessageId;
        DirectPeer = conversation.DirectPeer;
        OnPropertyChanged(nameof(PeerUsernameText));
        // DTO без presence не сбрасывает живой статус от chat.presence.updated.
        if (conversation.DirectPeer?.Presence is { } presence)
        {
            ApplyPresence(presence);
        }

        Title = ResolveTitle(conversation);
        // Сид цвета: direct — id собеседника (цвет совпадает с его сообщениями
        // в группах), прочие — заголовок чата, как в Telegram.
        var colorSeed = string.Equals(Kind, "direct", StringComparison.Ordinal) && DirectPeer?.Id > 0
            ? DirectPeer.Id.ToString(CultureInfo.InvariantCulture)
            : Title;
        AvatarBrush = ChatPeerPalette.AvatarBrush(colorSeed);
        AvatarInitials = ChatPeerPalette.Initials(Title);
        // Фото: avatar_url самого диалога, у direct — фото собеседника (web PresenceAvatar).
        SetAvatarUrl(conversation.AvatarUrl ?? conversation.DirectPeer?.AvatarUrl);
        // Бэкенд уже подставляет «Вы: » в preview своих сообщений — строка
        // диалога добавляет префикс сама по LastMessageIsOwn, дубль срезаем.
        Preview = StripOwnPreviewPrefix(conversation.LastMessagePreview, conversation.LastMessageIsOwn);
        LastMessageAt = conversation.LastMessageAt;
        LastMessageIsOwn = conversation.LastMessageIsOwn;
        UnreadCount = conversation.UnreadCount;
        UnreadMentionCount = conversation.UnreadMentionCount;
        KindText = ResolveKindText(conversation);
    }

    /// <summary>Срезает ведущий «Вы:» у превью своего сообщения — акцентный
    /// префикс рисует шаблон строки, дубли не нужны.</summary>
    private static string? StripOwnPreviewPrefix(string? preview, bool isOwn) =>
        isOwn && preview?.StartsWith("Вы:", StringComparison.Ordinal) == true
            ? preview[3..].TrimStart()
            : preview;

    /// <summary>Обновить превью/время по свежему сообщению (realtime или send-echo).</summary>
    public void UpdateLastMessage(HubChatMessage message)
    {
        if (message.CreatedAt is not null)
        {
            LastMessageAt = message.CreatedAt;
        }

        LastMessageIsOwn = message.IsOwn;
        // Новое сообщение в диалоге снимает «печатает…» — как в Telegram.
        SetTyping(null);

        Preview = message.IsDeleted
            ? "Сообщение удалено"
            : !string.IsNullOrWhiteSpace(message.Body)
                ? message.Body
                : message.Attachments is { Count: > 0 } attachments
                    ? $"📎 {attachments.Count} {ChatPlural.Of(attachments.Count, "файл", "файла", "файлов")}"
                    : Preview;
    }

    public void IncrementUnread() => UnreadCount++;

    public void ClearUnread()
    {
        UnreadCount = 0;
        // Открытый диалог прочитан целиком — упоминания тоже гаснут (FAB «@»).
        UnreadMentionCount = 0;
    }

    /// <summary>Локальный фильтр поисковой строки по title/preview.</summary>
    public bool MatchesFilter(string? filter)
    {
        if (string.IsNullOrWhiteSpace(filter))
        {
            return true;
        }

        var needle = filter.Trim();
        return Title.Contains(needle, StringComparison.OrdinalIgnoreCase)
            || (Preview?.Contains(needle, StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static string ResolveTitle(HubChatConversation conversation) =>
        conversation.Kind == "direct"
            ? conversation.DirectPeer?.FullName
                ?? conversation.Title
                ?? conversation.DirectPeer?.Username
                ?? "Диалог"
            : conversation.Title ?? conversation.Kind ?? "Диалог";

    private static string? ResolveKindText(HubChatConversation conversation) =>
        conversation.Kind switch
        {
            // Подзаголовок группы как в Telegram: «N участников, M в сети».
            "group" => $"Группа · {conversation.MemberCount} "
                + ChatPlural.Of(conversation.MemberCount, "участник", "участника", "участников")
                + (conversation.OnlineMemberCount > 0
                    ? $" · {conversation.OnlineMemberCount} в сети"
                    : string.Empty),
            "ai" => "AI-ассистент",
            // «Заметки» уже являются заголовком диалога — третья строка дублировала бы его.
            "notes" => null,
            "task" => "Чат задачи",
            "direct" => conversation.DirectPeer?.Department,
            _ => null,
        };
}

/// <summary>
/// Запрос на toast-уведомление о входящем чужом сообщении.
/// Окно решает, показывать ли (подавляет, когда диалог открыт в активном окне).
/// </summary>
public sealed record ChatMessageNotification(
    string ConversationId,
    string Title,
    string Body,
    string? MessageId,
    bool IsSelectedConversation);

/// <summary>Пользователь в панели «Новый диалог»: имя, отдел/логин, инициал аватара.</summary>
public sealed class ChatUserItemViewModel : ObservableObject
{
    private bool _isSelected;

    public ChatUserItemViewModel(HubChatUser user)
    {
        Id = user.Id;
        Username = user.Username;
        DisplayName = !string.IsNullOrWhiteSpace(user.FullName)
            ? user.FullName
            : user.Username ?? "Пользователь";
        Department = user.Department;
        _avatarUrl = user.AvatarUrl;
    }

    public int Id { get; }

    public string? Username { get; }

    public string DisplayName { get; }

    public string? Department { get; }

    /// <summary>Отметка выбора в режиме «Новая группа» (галочка на строке).</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    public string AvatarInitial =>
        string.IsNullOrWhiteSpace(DisplayName) ? "•" : DisplayName.Trim()[..1].ToUpperInvariant();

    /// <summary>Градиентный круг аватара — палитра пиров по id пользователя.</summary>
    public Brush AvatarBrush => ChatPeerPalette.AvatarBrush(
        Id.ToString(CultureInfo.InvariantCulture));

    /// <summary>Двухбуквенные инициалы на градиентном аватаре.</summary>
    public string AvatarInitials => ChatPeerPalette.Initials(DisplayName);

    /// <summary>Вторая строка: отдел, иначе @логин.</summary>
    public string Subtitle =>
        !string.IsNullOrWhiteSpace(Department)
            ? Department
            : string.IsNullOrWhiteSpace(Username) ? string.Empty : "@" + Username;

    private ImageSource? _avatarImage;
    private readonly string? _avatarUrl;
    private bool _avatarRequested;
    private AuthImageLoader? _avatarLoader;

    /// <summary>Фото-аватар пользователя (avatar_url); null — градиент+инициалы.</summary>
    public ImageSource? AvatarImage
    {
        get => _avatarImage;
        private set
        {
            if (SetProperty(ref _avatarImage, value))
            {
                OnPropertyChanged(nameof(HasAvatarImage));
            }
        }
    }

    /// <summary>Фото загружено — поверх градиента рисуется ImageBrush-круг.</summary>
    public bool HasAvatarImage => AvatarImage is not null;

    /// <summary>Загрузчик картинок — подставляет ChatViewModel; назначение пинает загрузку.</summary>
    public AuthImageLoader? AvatarLoader
    {
        get => _avatarLoader;
        set
        {
            _avatarLoader = value;
            KickAvatarLoad();
        }
    }

    private void KickAvatarLoad()
    {
        if (_avatarRequested || _avatarLoader is null || string.IsNullOrWhiteSpace(_avatarUrl))
        {
            return;
        }

        _avatarRequested = true;
        var url = _avatarUrl;
        var loader = _avatarLoader;
        _ = Task.Run(async () =>
        {
            var image = await loader.LoadAsync(url, decodePixelWidth: 96);
            if (image is not null)
            {
                AvatarImage = image;
            }
        });
    }
}

/// <summary>
/// Участник группы в панели «Участники»: имя, роль, online-точка,
/// кнопка исключения по правилам web (owner любого не-owner'а, moderator — member'ов).
/// </summary>
/// <summary>
/// Модерация участника из web-гейтов ChatContextPanel:
/// promote/demote — только owner (canManageOwners и роль member/moderator),
/// restrict — по тем же правилам, что исключение (canRemoveSelectedMember).
/// </summary>
public sealed record ChatGroupMemberModeration(
    bool CanPromote,
    bool CanDemote,
    bool CanRestrict,
    Func<ChatGroupMemberItemViewModel, string, Task>? RoleHandler,
    Func<ChatGroupMemberItemViewModel, int?, Task>? RestrictHandler,
    Func<ChatGroupMemberItemViewModel, Task>? LiftRestrictionHandler);

public sealed class ChatGroupMemberItemViewModel : ObservableObject
{
    public ChatGroupMemberItemViewModel(
        HubChatMember member,
        bool canRemove,
        Func<ChatGroupMemberItemViewModel, Task>? removeHandler,
        bool canTransferOwnership = false,
        Func<ChatGroupMemberItemViewModel, Task>? transferOwnershipHandler = null,
        ChatGroupMemberModeration? moderation = null)
    {
        var user = member.User;
        UserId = user?.Id ?? 0;
        Username = user?.Username;
        DisplayName = !string.IsNullOrWhiteSpace(user?.FullName)
            ? user.FullName
            : user?.Username ?? "Пользователь";
        Department = user?.Department;
        _avatarUrl = user?.AvatarUrl;
        MemberRole = NormalizeRole(member.MemberRole);
        RoleText = MemberRole switch
        {
            "owner" => "Владелец",
            "moderator" => "Модератор",
            _ => null,
        };
        IsOnline = user?.Presence?.IsOnline == true;
        IsRestricted = member.IsRestricted;
        RestrictedText = member.IsRestricted
            ? member.RestrictedUntil is { } until
                ? $"ограничен до {until.LocalDateTime:dd.MM HH:mm}"
                : "ограничен"
            : null;
        CanRemove = canRemove;
        RemoveCommand = new NativeRelayCommand(_ =>
        {
            if (CanRemove && removeHandler is { } handler)
            {
                _ = handler(this);
            }
        });
        CanTransferOwnership = canTransferOwnership;
        TransferOwnershipCommand = new NativeRelayCommand(_ =>
        {
            if (CanTransferOwnership && transferOwnershipHandler is { } handler)
            {
                _ = handler(this);
            }
        });
        CanPromote = moderation?.CanPromote == true;
        CanDemote = moderation?.CanDemote == true;
        // Снятие ограничения — тот же гейт, что и наложение (canRestrict в web).
        CanRestrict = moderation?.CanRestrict == true;
        PromoteCommand = new NativeRelayCommand(_ =>
        {
            if (CanPromote && moderation?.RoleHandler is { } handler)
            {
                _ = handler(this, "moderator");
            }
        });
        DemoteCommand = new NativeRelayCommand(_ =>
        {
            if (CanDemote && moderation?.RoleHandler is { } handler)
            {
                _ = handler(this, "member");
            }
        });
        // CommandParameter — секунды ("3600"/"86400"/"604800"); без значения — бессрочно.
        RestrictCommand = new NativeRelayCommand(parameter =>
        {
            if (!CanRestrict || moderation?.RestrictHandler is not { } handler)
            {
                return;
            }

            var seconds = parameter switch
            {
                int i => (int?)i,
                string text when int.TryParse(text, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed) => parsed,
                _ => null,
            };
            _ = handler(this, seconds);
        });
        LiftRestrictionCommand = new NativeRelayCommand(_ =>
        {
            if (CanRestrict && IsRestricted && moderation?.LiftRestrictionHandler is { } handler)
            {
                _ = handler(this);
            }
        });
    }

    public int UserId { get; }

    public string? Username { get; }

    public string DisplayName { get; }

    public string? Department { get; }

    /// <summary>Нормализованная роль: owner|moderator|member.</summary>
    public string MemberRole { get; }

    /// <summary>Бейдж роли — для member скрыт, как в web.</summary>
    public string? RoleText { get; }

    /// <summary>Онлайн-точка из presence внутри member.user.</summary>
    public bool IsOnline { get; }

    /// <summary>Маркер «ограничен» — сервер присылает его только manager'ам.</summary>
    public string? RestrictedText { get; }

    /// <summary>Ограничен в отправке сообщений (is_restricted из detail).</summary>
    public bool IsRestricted { get; }

    /// <summary>Кнопка исключения видна по правилам прав текущего пользователя.</summary>
    public bool CanRemove { get; }

    public ICommand RemoveCommand { get; }

    /// <summary>«Назначить модератором» — только owner на строке member.</summary>
    public bool CanPromote { get; }

    public ICommand PromoteCommand { get; }

    /// <summary>«Снять модератора» — только owner на строке moderator.</summary>
    public bool CanDemote { get; }

    public ICommand DemoteCommand { get; }

    /// <summary>
    /// «Ограничить отправку»/«Снять ограничение» — тем же гейтом, что и
    /// исключение (owner любого не-owner'а, moderator — member'ов).
    /// </summary>
    public bool CanRestrict { get; }

    /// <summary>Параметр — секунды ограничения (3600|86400|604800); null — бессрочно.</summary>
    public ICommand RestrictCommand { get; }

    /// <summary>Пункт «Снять ограничение» — виден на ограниченной строке.</summary>
    public ICommand LiftRestrictionCommand { get; }

    /// <summary>Есть хотя бы один пункт меню «⋯» модерации.</summary>
    public bool HasModerationActions =>
        CanPromote || CanDemote || CanRestrict || CanRemove || CanTransferOwnership;

    /// <summary>
    /// «Сделать владельцем» — только для владельца на чужой строке
    /// (member/moderator; в web — canTransferSelectedOwnership).
    /// </summary>
    public bool CanTransferOwnership { get; }

    public ICommand TransferOwnershipCommand { get; }

    public string AvatarInitial =>
        string.IsNullOrWhiteSpace(DisplayName) ? "•" : DisplayName.Trim()[..1].ToUpperInvariant();

    /// <summary>Градиентный круг аватара — палитра пиров по id участника.</summary>
    public Brush AvatarBrush => ChatPeerPalette.AvatarBrush(
        UserId.ToString(CultureInfo.InvariantCulture));

    /// <summary>Двухбуквенные инициалы на градиентном аватаре.</summary>
    public string AvatarInitials => ChatPeerPalette.Initials(DisplayName);

    /// <summary>Вторая строка: отдел, иначе @логин.</summary>
    public string Subtitle =>
        !string.IsNullOrWhiteSpace(Department)
            ? Department
            : string.IsNullOrWhiteSpace(Username) ? string.Empty : "@" + Username;

    /// <summary>
    /// «@handle» для mention-подсказки — тот же getPersonMentionHandle, что web
    /// показывает в .mentionList справа от имени (username или производный).
    /// </summary>
    public string HandleText =>
        "@" + ChatViewModel.MentionHandle(Username, DisplayName);

    private ImageSource? _avatarImage;
    private readonly string? _avatarUrl;
    private bool _avatarRequested;
    private AuthImageLoader? _avatarLoader;

    /// <summary>Фото-аватар участника (member.user.avatar_url); null — градиент+инициалы.</summary>
    public ImageSource? AvatarImage
    {
        get => _avatarImage;
        private set
        {
            if (SetProperty(ref _avatarImage, value))
            {
                OnPropertyChanged(nameof(HasAvatarImage));
            }
        }
    }

    /// <summary>Фото загружено — поверх градиента рисуется ImageBrush-круг.</summary>
    public bool HasAvatarImage => AvatarImage is not null;

    /// <summary>Загрузчик картинок — подставляет ChatViewModel; назначение пинает загрузку.</summary>
    public AuthImageLoader? AvatarLoader
    {
        get => _avatarLoader;
        set
        {
            _avatarLoader = value;
            KickAvatarLoad();
        }
    }

    private void KickAvatarLoad()
    {
        if (_avatarRequested || _avatarLoader is null || string.IsNullOrWhiteSpace(_avatarUrl))
        {
            return;
        }

        _avatarRequested = true;
        var url = _avatarUrl;
        var loader = _avatarLoader;
        _ = Task.Run(async () =>
        {
            var image = await loader.LoadAsync(url, decodePixelWidth: 96);
            if (image is not null)
            {
                AvatarImage = image;
            }
        });
    }

    private static string NormalizeRole(string? role) =>
        string.IsNullOrWhiteSpace(role) ? "member" : role.Trim().ToLowerInvariant();
}

/// <summary>Чип вложения внутри пузыря: иконка вида, имя, размер, открытие/скачивание.</summary>
public sealed class ChatAttachmentItemViewModel : ObservableObject
{
    private readonly HubChatAttachment _attachment;
    private ImageSource? _stickerPreview;
    private ImageSource? _preview;

    public ChatAttachmentItemViewModel(
        HubChatAttachment attachment,
        Func<ChatAttachmentItemViewModel, Task>? openHandler,
        AuthImageLoader? imageLoader = null,
        string? messageId = null)
    {
        _attachment = attachment;
        Id = attachment.Id ?? string.Empty;
        var kind = attachment.MediaKind ?? attachment.Kind;
        // Фото, отправленное «как документ» (media_kind=file): по mime_type или
        // расширению имени всё равно картинка — превью-плитка и просмотрщик, как Telegram.
        IsImage = string.Equals(kind, "image", StringComparison.OrdinalIgnoreCase)
            || (attachment.MimeType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ?? false)
            || HasImageExtension(attachment.FileName);
        FileName = string.IsNullOrWhiteSpace(attachment.FileName)
            ? kind == "sticker" ? "стикер" : "файл"
            : attachment.FileName;
        SizeText = FormatSize(attachment.EffectiveSize);
        Icon = IsImage ? "🖼" : kind switch
        {
            "video" => "🎬",
            "audio" => "🎵",
            "sticker" => "🏷",
            _ => "📎",
        };
        OpenCommand = new NativeRelayCommand(_ =>
        {
            if (openHandler is { } handler)
            {
                _ = handler(this);
            }
        });

        // Стикер в пузыре — сама картинка (как в web ChatStickerMedia), а не чип.
        // Качается Bearer-маршрутом …/attachments/{aid}/file через AuthImageLoader.
        if (imageLoader is not null
            && string.Equals(kind, "sticker", StringComparison.OrdinalIgnoreCase)
            && Id.Length > 0
            && !string.IsNullOrEmpty(messageId))
        {
            _ = LoadStickerPreviewAsync(imageLoader, messageId);
        }

        // Image-вложение в пузыре — кликабельная плитка-превью (Telegram),
        // тот же Bearer-маршрут, даунскейл до размера плитки.
        if (imageLoader is not null
            && IsImage
            && Id.Length > 0
            && !string.IsNullOrEmpty(messageId))
        {
            _ = LoadPreviewAsync(imageLoader, messageId);
        }
    }

    /// <summary>Внутреннее представление для обратного вызова (message/attachment id).</summary>
    public HubChatAttachment Model => _attachment;

    public string Id { get; }
    public string FileName { get; }
    public string? SizeText { get; }
    public string Icon { get; }
    public ICommand OpenCommand { get; }

    /// <summary>Превью стикера (null, пока грузится, при ошибке и у прочих видов).</summary>
    public ImageSource? StickerPreview
    {
        get => _stickerPreview;
        private set
        {
            if (SetProperty(ref _stickerPreview, value))
            {
                OnPropertyChanged(nameof(HasStickerPreview));
            }
        }
    }

    /// <summary>Стикер отрисован картинкой — чип имени/иконки не нужен.</summary>
    public bool HasStickerPreview => StickerPreview is not null;

    /// <summary>media_kind/kind == "image" — клик открывает просмотрщик, не скачивание.</summary>
    public bool IsImage { get; }

    /// <summary>Бэкенд не всегда шлёт mime_type — распознаём фото по расширению
    /// (форматы, которые WPF BitmapDecoder точно декодирует).</summary>
    internal static bool HasImageExtension(string? fileName) =>
        System.IO.Path.GetExtension(fileName)?.ToLowerInvariant()
            is ".png" or ".jpg" or ".jpeg" or ".gif" or ".webp" or ".bmp";

    /// <summary>Превью image-вложения для плитки в пузыре (null пока грузится/ошибка).</summary>
    public ImageSource? Preview
    {
        get => _preview;
        private set
        {
            if (SetProperty(ref _preview, value))
            {
                OnPropertyChanged(nameof(HasPreview));
            }
        }
    }

    /// <summary>Превью загружено — строка рисует плитку-картинку вместо чипа.</summary>
    public bool HasPreview => Preview is not null;

    private async Task LoadPreviewAsync(AuthImageLoader imageLoader, string messageId)
    {
        var image = await imageLoader.LoadAsync(
            "chat/messages/" + Uri.EscapeDataString(messageId)
            + "/attachments/" + Uri.EscapeDataString(Id) + "/file",
            decodePixelWidth: 480);
        if (image is not null)
        {
            Preview = image;
        }
    }

    private async Task LoadStickerPreviewAsync(AuthImageLoader imageLoader, string messageId)
    {
        var image = await imageLoader.LoadAsync(
            "chat/messages/" + Uri.EscapeDataString(messageId)
            + "/attachments/" + Uri.EscapeDataString(Id) + "/file",
            decodePixelWidth: ChatMediaItemViewModel.ThumbnailDecodeWidth);
        if (image is not null)
        {
            StickerPreview = image;
        }
    }

    private static string? FormatSize(long bytes) =>
        bytes <= 0 ? null : bytes switch
        {
            < 1024 => $"{bytes} Б",
            < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
            < 1024L * 1024 * 1024 => $"{bytes / (1024.0 * 1024):0.#} МБ",
            _ => $"{bytes / (1024.0 * 1024 * 1024):0.#} ГБ",
        };
}

/// <summary>
/// Карточка превью ссылки внутри пузыря (parity с web ChatLinkPreview):
/// заголовок жирным, описание вторичным, hostname/site_name сверху, клик — открыть url.
/// Пока ответ не пришёл — компактная карточка «Загрузка превью…»; ответ без
/// title/description/image — та же карточка без подробностей.
/// </summary>
public sealed class ChatLinkPreviewItemViewModel
{
    public ChatLinkPreviewItemViewModel(
        string url,
        HubChatLinkPreview? preview,
        bool isLoading,
        Func<ChatLinkPreviewItemViewModel, Task>? openHandler)
    {
        Url = url;
        Title = preview?.Title;
        Description = preview?.Description;
        ImageUrl = preview?.Image;
        SiteName = preview?.SiteName;
        IsLoading = isLoading;
        OpenCommand = new NativeRelayCommand(_ =>
        {
            if (openHandler is { } handler)
            {
                _ = handler(this);
            }
        });
    }

    public string Url { get; }

    public string? Title { get; }

    public string? Description { get; }

    /// <summary>og:image — публичный url, Bearer не нужен.</summary>
    public string? ImageUrl { get; }

    public string? SiteName { get; }

    /// <summary>True, пока ответ /link-preview ещё в пути.</summary>
    public bool IsLoading { get; }

    /// <summary>Хост без www. — компактная шапка карточки.</summary>
    public string HostText
    {
        get
        {
            if (Uri.TryCreate(Url, UriKind.Absolute, out var uri))
            {
                var host = uri.Host;
                return host.StartsWith("www.", StringComparison.OrdinalIgnoreCase)
                    ? host[4..]
                    : host;
            }

            return Url;
        }
    }

    /// <summary>site_name или хост — верхняя строка карточки, как в web.</summary>
    public string HeaderText =>
        string.IsNullOrWhiteSpace(SiteName) ? HostText : SiteName!;

    public ICommand OpenCommand { get; }
}

/// <summary>
/// Плитка медиагалереи диалога (вкладка «Медиа» в web): превью для image-вложений
/// (Bearer-файл через AuthImageLoader), иконка вида, имя файла, длительность
/// для видео. Клик — скачать и открыть, как чип вложения.
/// </summary>
public sealed class ChatMediaItemViewModel : ObservableObject
{
    /// <summary>Ширина декода превью плитки — как thumbnail в web-галерее.</summary>
    internal const int ThumbnailDecodeWidth = 256;

    private ImageSource? _thumbnail;

    public ChatMediaItemViewModel(
        HubChatConversationAttachmentItem item,
        Func<ChatMediaItemViewModel, Task>? openHandler,
        AuthImageLoader? imageLoader = null)
    {
        Id = item.Id ?? string.Empty;
        MessageId = item.MessageId ?? string.Empty;
        CreatedAt = item.CreatedAt;
        var kind = item.MediaKind ?? item.Kind;
        FileName = string.IsNullOrWhiteSpace(item.FileName)
            ? kind switch
            {
                "audio" => "аудио",
                "file" => "файл",
                _ => "медиа",
            }
            : item.FileName;
        Model = new HubChatAttachment
        {
            Id = item.Id,
            Kind = item.Kind,
            FileName = item.FileName,
            MimeType = item.MimeType,
            MediaKind = item.MediaKind,
            FileSize = item.FileSize,
            Width = item.Width,
            Height = item.Height,
            DurationSeconds = item.DurationSeconds,
            DownloadUrl = item.DownloadUrl,
            PreviewUrl = item.PreviewUrl,
        };
        Icon = kind switch
        {
            "image" => "🖼",
            "video" => "🎬",
            "audio" => "🎵",
            "sticker" => "🏷",
            _ => "📎",
        };
        SizeText = FormatSize(item.FileSize);
        DurationText = item.DurationSeconds is { } seconds && seconds > 0
            ? TimeSpan.FromSeconds(seconds).ToString(
                seconds >= 3600 ? @"h\:mm\:ss" : @"m\:ss", CultureInfo.InvariantCulture)
            : null;
        OpenCommand = new NativeRelayCommand(_ =>
        {
            if (openHandler is { } handler)
            {
                _ = handler(this);
            }
        });

        // Превью только у image-вложений (kind/mime/расширение — как в пузыре):
        // тот же файл, что качает OpenCommand — GET …/attachments/{aid}/file.
        if (imageLoader is not null
            && (string.Equals(kind, "image", StringComparison.OrdinalIgnoreCase)
                || (item.MimeType?.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ?? false)
                || ChatAttachmentItemViewModel.HasImageExtension(item.FileName))
            && Id.Length > 0
            && MessageId.Length > 0)
        {
            _ = LoadThumbnailAsync(imageLoader);
        }
    }

    public string Id { get; }

    /// <summary>Сообщение-владелец — нужно для маршрута скачивания.</summary>
    public string MessageId { get; }

    /// <summary>Дата — сортировка слияния потоков image+video (desc).</summary>
    public DateTimeOffset? CreatedAt { get; }

    /// <summary>Модель вложения для общего пути скачивания.</summary>
    public HubChatAttachment Model { get; }

    public string FileName { get; }
    public string? SizeText { get; }
    public string Icon { get; }

    /// <summary>«m:ss» — бейдж длительности на видео-плитке.</summary>
    public string? DurationText { get; }

    /// <summary>Превью image-вложения — null пока грузится, при ошибке и у прочих видов.</summary>
    public ImageSource? Thumbnail
    {
        get => _thumbnail;
        private set
        {
            if (SetProperty(ref _thumbnail, value))
            {
                OnPropertyChanged(nameof(HasThumbnail));
            }
        }
    }

    /// <summary>Превью пришло — плитка показывает снимок вместо иконки.</summary>
    public bool HasThumbnail => Thumbnail is not null;

    public ICommand OpenCommand { get; }

    /// <summary>Ленивая загрузка превью: не блокирует галерею, ошибка → иконка.</summary>
    private async Task LoadThumbnailAsync(AuthImageLoader imageLoader)
    {
        var image = await imageLoader.LoadAsync(
            "chat/messages/" + Uri.EscapeDataString(MessageId)
            + "/attachments/" + Uri.EscapeDataString(Id) + "/file",
            decodePixelWidth: ThumbnailDecodeWidth);
        if (image is not null)
        {
            Thumbnail = image;
        }
    }

    private static string? FormatSize(long bytes) =>
        bytes <= 0 ? null : bytes switch
        {
            < 1024 => $"{bytes} Б",
            < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
            < 1024L * 1024 * 1024 => $"{bytes / (1024.0 * 1024):0.#} МБ",
            _ => $"{bytes / (1024.0 * 1024 * 1024):0.#} ГБ",
        };
}

/// <summary>Вариант ответа опроса: текст, голоса, доля, отметка своего выбора.</summary>
public sealed class ChatPollOptionViewModel
{
    public ChatPollOptionViewModel(
        int index,
        string text,
        int votes,
        int totalVoters,
        bool isMine,
        bool closed,
        Func<int, Task>? voteHandler)
    {
        Index = index;
        Text = text;
        Votes = votes;
        IsMine = isMine;
        IsClosed = closed;
        Percent = totalVoters > 0 ? (int)Math.Round(votes * 100.0 / totalVoters) : 0;
        VotesText = votes > 0
            ? $"{votes} · {Percent}%"
            : Percent > 0 ? $"{Percent}%" : null;
        VoteCommand = new NativeRelayCommand(_ =>
        {
            if (!closed && voteHandler is { } handler)
            {
                _ = handler(index);
            }
        });
    }

    public int Index { get; }
    public string Text { get; }
    public int Votes { get; }
    public int Percent { get; }
    public bool IsMine { get; }
    public bool IsClosed { get; }
    public string? VotesText { get; }
    public ICommand VoteCommand { get; }
}

/// <summary>Пузырь сообщения: текст, отправитель, метаданные, вложения/реакции.</summary>
public sealed class ChatMessageViewModel : ObservableObject
{
    private const int ReplyPreviewLength = 60;

    /// <summary>
    /// Первая http(s)-ссылка в тексте — regex портирован с web
    /// (chatPlainText.CHAT_URL_REGEX): на неё строится карточка превью.
    /// </summary>
    private static readonly Regex ChatUrlRegex = new(
        @"https?://(?:www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_+.~#?&/=]*)",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly bool _isGroupConversation;
    private readonly string _senderColorKey;
    private string? _body;
    private bool _isDeleted;
    private string? _editedText;
    private string? _replyText;
    private string? _replyToMessageId;
    private string? _forwardText;
    private string? _reactionsText;
    private IReadOnlyList<ChatReactionItemViewModel> _reactionItems = [];
    private string? _statusText;
    private string? _pollSummaryText;
    private bool _showDaySeparator;
    private bool _isGroupStart;
    private bool _isGroupEnd;
    private bool _showUnreadDivider;

    public ChatMessageViewModel(HubChatMessage message, bool isGroupConversation)
    {
        _isGroupConversation = isGroupConversation;
        Id = message.Id;
        ConversationId = message.ConversationId;
        ClientMessageId = message.ClientMessageId;
        Kind = message.Kind;
        IsOwn = message.IsOwn;
        SenderName = message.Sender?.FullName ?? message.Sender?.Username ?? string.Empty;
        // Сид цвета пира: id отправителя стабильнее имени (как web sender.id).
        _senderColorKey = message.Sender?.Id > 0
            ? message.Sender.Id.ToString(CultureInfo.InvariantCulture)
            : SenderName;
        _senderAvatarUrl = message.Sender?.AvatarUrl;
        CreatedAt = message.CreatedAt ?? DateTimeOffset.MinValue;
        TimeText = CreatedAt == DateTimeOffset.MinValue
            ? null
            : CreatedAt.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture);
        DaySeparatorText = FormatDaySeparator(CreatedAt);
        Apply(message);
    }

    /// <summary>Провайдер реакций — подставляет ChatViewModel (async toggle через API).</summary>
    public Func<ChatMessageViewModel, string, Task>? ReactionHandler { get; set; }

    private ICommand? _reactionCommand;

    /// <summary>Команда из контекстного меню: parameter — строка эмодзи.</summary>
    public ICommand ReactionCommand => _reactionCommand ??= new NativeRelayCommand(parameter =>
    {
        if (parameter is string emoji && ReactionHandler is { } handler)
        {
            _ = handler(this, emoji);
        }
    });

    /// <summary>Провайдер закрепа — подставляет ChatViewModel (PUT/DELETE pinned-messages).</summary>
    public Func<ChatMessageViewModel, Task>? PinHandler { get; set; }

    /// <summary>Провайдер перехода к цитируемому оригиналу — подставляет
    /// ChatViewModel (прокрутка/подгрузка + вспышка, как tg «go to replied»).</summary>
    public Func<ChatMessageViewModel, Task>? ReplyTargetHandler { get; set; }

    private ICommand? _openReplyTargetCommand;

    /// <summary>Клик по цитате ответа в пузыре.</summary>
    public ICommand OpenReplyTargetCommand => _openReplyTargetCommand ??= new NativeRelayCommand(_ =>
    {
        if (HasReplyTarget && ReplyTargetHandler is { } handler)
        {
            _ = handler(this);
        }
    });

    /// <summary>Провайдер открытия вложения — подставляет ChatViewModel (скачивание+открыть).</summary>
    public Func<ChatMessageViewModel, ChatAttachmentItemViewModel, Task>? AttachmentHandler { get; set; }

    /// <summary>
    /// Провайдер загрузки превью ссылки — подставляет ChatViewModel
    /// (GET /chat/link-preview с кэшем). Назначение запускает отложенный запрос.
    /// </summary>
    public Func<string, Task<HubChatLinkPreview?>>? LinkPreviewLoader
    {
        get => _linkPreviewLoader;
        set
        {
            _linkPreviewLoader = value;
            UpdateLinkPreviewSource();
        }
    }

    private Func<string, Task<HubChatLinkPreview?>>? _linkPreviewLoader;

    /// <summary>Провайдер открытия ссылки — подставляет ChatViewModel (браузер, http/https only).</summary>
    public Func<ChatMessageViewModel, ChatLinkPreviewItemViewModel, Task>? LinkPreviewHandler { get; set; }

    /// <summary>Провайдер голосования — подставляет ChatViewModel (POST poll-vote).</summary>
    public Func<ChatMessageViewModel, int, Task>? PollVoteHandler { get; set; }

    /// <summary>Провайдер закрытия опроса — подставляет ChatViewModel (POST poll-close).</summary>
    public Func<ChatMessageViewModel, Task>? PollCloseHandler { get; set; }

    /// <summary>Чипы вложений внутри пузыря (имя+размер, клик — скачать и открыть).</summary>
    public ObservableCollection<ChatAttachmentItemViewModel> AttachmentItems { get; } = [];

    /// <summary>
    /// Карточка превью первой ссылки в тексте (0 или 1 элемент) —
    /// как в web, превью только на первый url.
    /// </summary>
    public ObservableCollection<ChatLinkPreviewItemViewModel> LinkPreviewItems { get; } = [];

    /// <summary>Есть карточка превью ссылки — строка ItemsControl видна в пузыре.</summary>
    public bool HasLinkPreviews => LinkPreviewItems.Count > 0;

    private string? _linkPreviewUrl;
    private string? _linkPreviewRequestedUrl;

    /// <summary>Варианты опроса (kind="poll") — кнопки с результатами.</summary>
    public ObservableCollection<ChatPollOptionViewModel> PollOptions { get; } = [];

    private bool _isPinned;

    /// <summary>Сообщение в списке закреплённых диалога.</summary>
    public bool IsPinned
    {
        get => _isPinned;
        set
        {
            if (SetProperty(ref _isPinned, value))
            {
                OnPropertyChanged(nameof(PinMenuText));
            }
        }
    }

    /// <summary>Подпись пункта меню закрепа сообщения.</summary>
    public string PinMenuText => IsPinned ? "Открепить сообщение" : "Закрепить сообщение";

    private bool _isSelected;

    /// <summary>
    /// Отмечено в режиме мультивыбора (Telegram: круг-чек слева от пузыря).
    /// Управляется ChatViewModel при входе/выходе и toggle по клику.
    /// </summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    private ICommand? _togglePinCommand;

    /// <summary>Меню «Закрепить/Открепить сообщение».</summary>
    public ICommand TogglePinCommand => _togglePinCommand ??= new NativeRelayCommand(_ =>
    {
        if (PinHandler is { } handler)
        {
            _ = handler(this);
        }
    });

    public string Id { get; private set; }

    public string? ConversationId { get; }

    public string? ClientMessageId { get; private set; }

    /// <summary>Тип сообщения из DTO (kind: text|system|poll|task_share|file|…).</summary>
    public string? Kind { get; }

    /// <summary>Системное событие — рисуется центрированной плашкой без пузыря (parity web).</summary>
    public bool IsSystem => string.Equals(Kind, "system", StringComparison.Ordinal);

    public bool IsOwn { get; }

    public string SenderName { get; }

    /// <summary>Инициал отправителя для круглого аватара у входящего пузыря в группе.</summary>
    public string SenderAvatarInitial =>
        string.IsNullOrWhiteSpace(SenderName) ? "•" : SenderName.Trim()[..1].ToUpperInvariant();

    /// <summary>Двухбуквенные инициалы аватара отправителя.</summary>
    public string SenderAvatarInitials => ChatPeerPalette.Initials(SenderName);

    /// <summary>Цвет имени отправителя — палитра пиров Telegram (по id/имени).</summary>
    public Brush SenderNameBrush => ChatPeerPalette.NameBrush(_senderColorKey);

    /// <summary>Градиент аватара отправителя — та же пара палитры, что имя.</summary>
    public Brush SenderAvatarBrush => ChatPeerPalette.AvatarBrush(_senderColorKey);

    /// <summary>Ключ сортировки ленты (asc).</summary>
    public DateTimeOffset CreatedAt { get; }

    public string? TimeText { get; }

    /// <summary>Подпись разделителя дня над первым сообщением дня («Сегодня»/«Вчера»/дата).</summary>
    public string? DaySeparatorText { get; }

    /// <summary>Показать пилюлю-разделитель дня над сообщением (ставит ApplyGrouping).</summary>
    public bool ShowDaySeparator
    {
        get => _showDaySeparator;
        private set => SetProperty(ref _showDaySeparator, value);
    }

    /// <summary>
    /// Полоса «Непрочитанные сообщения» над сообщением — unread bar Telegram.
    /// Ставит ChatViewModel один раз при открытии диалога с unread>0;
    /// realtime-вставки её не дублируют, после прочтения/перезагрузки её нет.
    /// </summary>
    public bool ShowUnreadDivider
    {
        get => _showUnreadDivider;
        set => SetProperty(ref _showUnreadDivider, value);
    }

    /// <summary>Первое в серии подряд идущих сообщений того же отправителя — больший отступ сверху.</summary>
    public bool IsGroupStart
    {
        get => _isGroupStart;
        private set => SetProperty(ref _isGroupStart, value);
    }

    /// <summary>Последнее в серии подряд идущих сообщений того же отправителя — аватар у входящих.</summary>
    public bool IsGroupEnd
    {
        get => _isGroupEnd;
        private set
        {
            if (SetProperty(ref _isGroupEnd, value))
            {
                OnPropertyChanged(nameof(ShowSenderAvatar));
            }
        }
    }

    /// <summary>Круглый аватар слева от пузыря: группы, входящие, крайнее сообщение серии.</summary>
    public bool ShowSenderAvatar => ShowSender && IsGroupEnd;

    /// <summary>
    /// Пересчёт визуальной группировки по соседям в ленте: другой день у соседа —
    /// пилюля-дата; серия одного отправителя — компактный интервал и аватар
    /// только на крайнем сообщении серии (как в Telegram Desktop).
    /// </summary>
    public void ApplyGrouping(ChatMessageViewModel? previous, ChatMessageViewModel? next)
    {
        var sameDayAsPrevious = previous is not null
            && previous.CreatedAt.LocalDateTime.Date == CreatedAt.LocalDateTime.Date;
        ShowDaySeparator = previous is null || !sameDayAsPrevious;

        var sameRunAsPrevious = sameDayAsPrevious
            && previous is not null
            && !previous.IsSystem
            && !IsSystem
            && previous.IsOwn == IsOwn
            && string.Equals(previous.SenderName, SenderName, StringComparison.Ordinal);
        var sameDayAsNext = next is not null
            && next.CreatedAt.LocalDateTime.Date == CreatedAt.LocalDateTime.Date;
        var sameRunAsNext = sameDayAsNext
            && next is not null
            && !next.IsSystem
            && !IsSystem
            && next.IsOwn == IsOwn
            && string.Equals(next.SenderName, SenderName, StringComparison.Ordinal);
        IsGroupStart = !sameRunAsPrevious;
        IsGroupEnd = !sameRunAsNext;
    }

    private static string? FormatDaySeparator(DateTimeOffset createdAt)
    {
        if (createdAt == DateTimeOffset.MinValue)
        {
            return null;
        }

        var date = createdAt.LocalDateTime.Date;
        var today = DateTime.Today;
        if (date == today)
        {
            return "Сегодня";
        }

        if (date == today.AddDays(-1))
        {
            return "Вчера";
        }

        var culture = CultureInfo.GetCultureInfo("ru-RU");
        return date.Year == today.Year
            ? date.ToString("d MMMM", culture)
            : date.ToString("d MMMM yyyy", culture);
    }

    public string? BodyText => IsDeleted ? "Сообщение удалено" : _body;

    public bool IsDeleted
    {
        get => _isDeleted;
        private set
        {
            if (SetProperty(ref _isDeleted, value))
            {
                OnPropertyChanged(nameof(BodyText));
                OnPropertyChanged(nameof(ShowSender));
            }
        }
    }

    /// <summary>Имя отправителя показываем в группах для чужих сообщений
    /// (системные события рисуются центрированной плашкой без отправителя).</summary>
    public bool ShowSender => _isGroupConversation && !IsOwn && !IsDeleted && !IsSystem;

    /// <summary>Можно ответить/процитировать — на неудалённое сообщение.</summary>
    public bool CanReply => !IsDeleted;

    /// <summary>Править/удалять можно только свои и неудалённые сообщения.</summary>
    public bool CanEditOrDelete => IsOwn && !IsDeleted;

    /// <summary>
    /// Меню «Пожаловаться»: как в web — только в группе и только на чужие
    /// сообщения (backend дублирует гейт: себя пожаловать нельзя).
    /// </summary>
    public bool CanReport => _isGroupConversation && !IsOwn && !IsDeleted;

    /// <summary>Текст для префилла composer при правке (не tombstone-строка).</summary>
    public string? EditableBody => IsDeleted ? null : _body;

    /// <summary>Краткое «Отправитель: начало текста» для плашки ответа над composer.</summary>
    public string ReplySummaryText
    {
        get
        {
            var body = _body ?? string.Empty;
            var trimmed = body.Length > ReplyPreviewLength ? body[..ReplyPreviewLength] + "…" : body;
            var who = IsOwn ? "Вы" : string.IsNullOrWhiteSpace(SenderName) ? "Сообщение" : SenderName;
            return $"{who}: {trimmed}";
        }
    }

    public string? EditedText
    {
        get => _editedText;
        private set => SetProperty(ref _editedText, value);
    }

    public string? ReplyText
    {
        get => _replyText;
        private set => SetProperty(ref _replyText, value);
    }

    /// <summary>Id сообщения, на которое отвечает это (reply_preview.id) —
    /// клик по цитате прыгает к оригиналу, как в Telegram.</summary>
    public string? ReplyToMessageId
    {
        get => _replyToMessageId;
        private set
        {
            if (SetProperty(ref _replyToMessageId, value))
            {
                OnPropertyChanged(nameof(HasReplyTarget));
            }
        }
    }

    /// <summary>Цитата кликабельна: есть цель для перехода к оригиналу.</summary>
    public bool HasReplyTarget => !string.IsNullOrEmpty(ReplyToMessageId);

    /// <summary>Галочки доставки своего сообщения: ✓ отправлено, ✓✓ прочитано.</summary>
    public string? StatusText
    {
        get => _statusText;
        private set => SetProperty(ref _statusText, value);
    }

    /// <summary>«Переслано от Имя» — шапка пузыря при forward_preview.</summary>
    public string? ForwardText
    {
        get => _forwardText;
        private set => SetProperty(ref _forwardText, value);
    }

    /// <summary>Строка опроса под вопросом: «N голосов · закрыт».</summary>
    public string? PollSummaryText
    {
        get => _pollSummaryText;
        private set => SetProperty(ref _pollSummaryText, value);
    }

    /// <summary>Опрос можно закрыть — только автор и незакрытый.</summary>
    public bool CanClosePoll => IsOwn && PollOptions.Count > 0 && !IsPollClosed;

    public bool IsPollClosed
    {
        get => _isPollClosed;
        private set
        {
            if (SetProperty(ref _isPollClosed, value))
            {
                OnPropertyChanged(nameof(CanClosePoll));
            }
        }
    }

    private bool _isPollClosed;

    private ICommand? _closePollCommand;

    /// <summary>Меню «Завершить опрос» — только автору (CanClosePoll).</summary>
    public ICommand ClosePollCommand => _closePollCommand ??= new NativeRelayCommand(_ =>
    {
        if (PollCloseHandler is { } handler)
        {
            _ = handler(this);
        }
    });

    public string? ReactionsText
    {
        get => _reactionsText;
        private set => SetProperty(ref _reactionsText, value);
    }

    /// <summary>
    /// Реакции как чипы под пузырём (эмодзи + счётчик) — цветные иконки
    /// подставляет EmojiGlyph в разметке. ReactionsText сохранён для
    /// доступности/совместимости.
    /// </summary>
    public IReadOnlyList<ChatReactionItemViewModel> ReactionItems
    {
        get => _reactionItems;
        private set
        {
            if (SetProperty(ref _reactionItems, value))
            {
                OnPropertyChanged(nameof(HasReactionItems));
            }
        }
    }

    public bool HasReactionItems => _reactionItems.Count > 0;

    /// <summary>Полная замена содержимого (дедуп-обновление по client_message_id).</summary>
    public void Update(HubChatMessage message)
    {
        if (!string.IsNullOrEmpty(message.Id) && message.Id != Id)
        {
            Id = message.Id;
            OnPropertyChanged(nameof(Id));
        }

        ClientMessageId = message.ClientMessageId ?? ClientMessageId;
        Apply(message);
    }

    /// <summary>Короткая акцентная вспышка пузыря после перехода к якорю
    /// (reply/pinned/search — tg «flash» ~1 с). Сеттер internal: им владеет
    /// ChatViewModel через FlashMessageHighlight.</summary>
    private bool _isHighlighted;

    public bool IsHighlighted
    {
        get => _isHighlighted;
        internal set => SetProperty(ref _isHighlighted, value);
    }

    /// <summary>Точечная правка по chat.message.updated (body/edited_at могут быть частичными).</summary>
    public void ApplyEdit(string? body, DateTimeOffset? editedAt)
    {
        if (body is not null)
        {
            _body = body;
            OnPropertyChanged(nameof(BodyText));
            UpdateLinkPreviewSource();
        }

        if (editedAt is not null)
        {
            EditedText = "изм.";
        }
    }

    /// <summary>Пометить удалённым (chat.message.deleted).</summary>
    public void MarkDeleted()
    {
        IsDeleted = true;
        ReplyText = null;
        ReplyToMessageId = null;
        ForwardText = null;
        ApplyReactions(null);
        StatusText = null;
        _attachmentModels = null;
        AttachmentItems.Clear();
        OnPropertyChanged(nameof(HasAttachmentItems));
        LinkPreviewItems.Clear();
        _linkPreviewUrl = null;
        _linkPreviewRequestedUrl = null;
        OnPropertyChanged(nameof(HasLinkPreviews));
        PollOptions.Clear();
        IsPollClosed = false;
        PollSummaryText = null;
        OnPropertyChanged(nameof(HasPoll));
        ApplyTaskCard(null);
        ApplyActionCard(null);
        OnPropertyChanged(nameof(CanReply));
        OnPropertyChanged(nameof(CanEditOrDelete));
        OnPropertyChanged(nameof(CanReport));
        OnPropertyChanged(nameof(EditableBody));
    }

    /// <summary>Свежие реакции после toggle через API или realtime-события.</summary>
    public void ApplyReactions(IReadOnlyList<HubChatReaction>? reactions)
    {
        ReactionsText = FormatReactions(reactions);
        ReactionItems = reactions is { Count: > 0 } list
            ? list.Select(r => new ChatReactionItemViewModel(r)).ToArray()
            : [];
    }

    private void Apply(HubChatMessage message)
    {
        if (message.IsDeleted)
        {
            MarkDeleted();
            return;
        }

        _body = message.Body;
        OnPropertyChanged(nameof(BodyText));
        EditedText = message.EditedAt is not null ? "изм." : null;
        ReplyText = FormatReply(message.ReplyPreview);
        ReplyToMessageId = message.ReplyPreview?.Id;
        ForwardText = FormatForward(message.ForwardPreview);
        RebuildAttachmentItems(message.Attachments);
        ApplyReactions(message.Reactions);
        ApplyDelivery(message.ReadByCount, message.DeliveryStatus);
        RebuildPoll(message.Poll);
        ApplyTaskCard(message.TaskPreview);
        ApplyActionCard(message.ActionCard);
        SetSenderAvatarUrl(message.Sender?.AvatarUrl);
        UpdateLinkPreviewSource();
    }

    private void ApplyTaskCard(HubChatTaskPreview? task)
    {
        _taskCardTitle = task is null
            ? null
            : string.IsNullOrWhiteSpace(task.Title) ? "Задача" : task.Title;
        _taskCardMeta = task is null
            ? null
            : FormatTaskCardMeta(task);
        OnPropertyChanged(nameof(HasTaskCard));
        OnPropertyChanged(nameof(TaskCardTitle));
        OnPropertyChanged(nameof(TaskCardMeta));
        OnPropertyChanged(nameof(TaskCardIsOverdue));
        _taskCardIsOverdue = task?.IsOverdue == true;
    }

    private string? _taskCardTitle;
    private string? _taskCardMeta;
    private bool _taskCardIsOverdue;

    /// <summary>Карточка задачи (kind="task_share" с task_preview) внутри пузыря.</summary>
    public bool HasTaskCard => _taskCardTitle is not null;

    /// <summary>Заголовок карточки: «#id · название».</summary>
    public string? TaskCardTitle => _taskCardTitle;

    /// <summary>Вторая строка карточки: «Статус · Исполнитель · до dd.MM.yyyy».</summary>
    public string? TaskCardMeta => _taskCardMeta;

    /// <summary>Просроченная задача — мета подсвечивается danger-тоном.</summary>
    public bool TaskCardIsOverdue => _taskCardIsOverdue;

    private static string FormatTaskCardMeta(HubChatTaskPreview task)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(task.Id))
        {
            parts.Add("№ " + task.Id.Trim());
        }

        parts.Add(TaskListItemViewModel.StatusToText(task.Status));
        var assignee = task.AssigneeFullName ?? task.AssigneeUsername;
        if (!string.IsNullOrWhiteSpace(assignee))
        {
            parts.Add(assignee);
        }

        if (task.DueAt is { } due)
        {
            parts.Add("до " + due.LocalDateTime.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture));
        }

        return string.Join(" · ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }

    /// <summary>Пересоздать варианты опроса из свежего payload (vote/updated).</summary>
    public void ApplyPoll(HubChatPoll? poll) => RebuildPoll(poll);

    private void RebuildPoll(HubChatPoll? poll)
    {
        PollOptions.Clear();
        if (poll is not null)
        {
            var options = poll.Options ?? [];
            for (var i = 0; i < options.Count; i++)
            {
                var option = options[i];
                PollOptions.Add(new ChatPollOptionViewModel(
                    i,
                    option.Text ?? $"Вариант {i + 1}",
                    option.Votes,
                    poll.TotalVoters,
                    poll.MyOptionIndex == i,
                    poll.Closed,
                    index => PollVoteHandler?.Invoke(this, index) ?? Task.CompletedTask));
            }
        }

        IsPollClosed = poll?.Closed == true;
        PollSummaryText = poll is null
            ? null
            : $"{poll.TotalVoters} {ChatPlural.Of(poll.TotalVoters, "голос", "голоса", "голосов")}"
                + (poll.Closed ? " · завершён" : string.Empty)
                + (poll.Anonymous ? " · анонимный" : string.Empty);
        OnPropertyChanged(nameof(HasPoll));
        OnPropertyChanged(nameof(CanClosePoll));
    }

    /// <summary>Сообщение — опрос с вариантами.</summary>
    public bool HasPoll => PollOptions.Count > 0;

    /// <summary>chat.message.read / DTO: количество прочитавших → статус ✓/✓✓.</summary>
    public void ApplyDelivery(int readByCount, string? deliveryStatus)
    {
        StatusText = IsOwn && !IsDeleted
            ? deliveryStatus == "read" || readByCount > 0 ? "✓✓" : "✓"
            : null;
    }

    private static string? FormatForward(HubChatForwardPreview? forward)
    {
        if (forward is null)
        {
            return null;
        }

        var sender = string.IsNullOrWhiteSpace(forward.SenderName)
            ? "Переслано"
            : $"Переслано от {forward.SenderName}";
        return sender;
    }

    private static string? FormatReply(HubChatReplyPreview? reply)
    {
        if (reply is null)
        {
            return null;
        }

        var body = reply.Body ?? string.Empty;
        var trimmed = body.Length > ReplyPreviewLength ? body[..ReplyPreviewLength] + "…" : body;
        var sender = string.IsNullOrWhiteSpace(reply.SenderName) ? "Ответ" : $"Ответ {reply.SenderName}";
        return $"{sender}: {trimmed}";
    }

    private void RebuildAttachmentItems(IReadOnlyList<HubChatAttachment>? attachments)
    {
        _attachmentModels = attachments;
        AttachmentItems.Clear();
        foreach (var attachment in attachments ?? [])
        {
            AttachmentItems.Add(
                new ChatAttachmentItemViewModel(
                    attachment,
                    item => AttachmentHandler?.Invoke(this, item) ?? Task.CompletedTask,
                    ImageLoader,
                    Id));
        }

        OnPropertyChanged(nameof(HasAttachmentItems));
    }

    /// <summary>Есть чипы вложений — строка ItemsControl видна в пузыре.</summary>
    public bool HasAttachmentItems => AttachmentItems.Count > 0;

    /// <summary>
    /// Загрузчик авторизованных картинок — подставляет ChatViewModel;
    /// используется превью стикеров/медиа внутри пузыря и фото отправителя.
    /// Назначение пинает загрузку аватара.
    /// </summary>
    public AuthImageLoader? ImageLoader
    {
        get => _imageLoader;
        set
        {
            if (ReferenceEquals(_imageLoader, value))
            {
                return;
            }

            _imageLoader = value;
            KickSenderAvatarLoad();
            // Вложения собираются в Apply() раньше назначения лоадера — без
            // пересборки превью image-файлов никогда не стартует (живые данные).
            RebuildAttachmentItems(_attachmentModels);
        }
    }

    private AuthImageLoader? _imageLoader;
    private IReadOnlyList<HubChatAttachment>? _attachmentModels;
    private ImageSource? _senderAvatarImage;
    private string? _senderAvatarUrl;
    private bool _senderAvatarRequested;

    /// <summary>
    /// Фото-аватар отправителя (sender.avatar_url); null — градиент+инициалы.
    /// </summary>
    public ImageSource? SenderAvatarImage
    {
        get => _senderAvatarImage;
        private set
        {
            if (SetProperty(ref _senderAvatarImage, value))
            {
                OnPropertyChanged(nameof(HasSenderAvatarImage));
            }
        }
    }

    /// <summary>Фото отправителя загружено — поверх градиента ImageBrush-круг.</summary>
    public bool HasSenderAvatarImage => SenderAvatarImage is not null;

    /// <summary>avatar_url отправителя из DTO; смена сбрасывает фото и перезапускает загрузку.</summary>
    private void SetSenderAvatarUrl(string? url)
    {
        if (string.Equals(_senderAvatarUrl, url, StringComparison.Ordinal))
        {
            return;
        }

        _senderAvatarUrl = url;
        _senderAvatarRequested = false;
        SenderAvatarImage = null;
        KickSenderAvatarLoad();
    }

    private void KickSenderAvatarLoad()
    {
        if (_senderAvatarRequested || _imageLoader is null || string.IsNullOrWhiteSpace(_senderAvatarUrl))
        {
            return;
        }

        _senderAvatarRequested = true;
        var url = _senderAvatarUrl;
        var loader = _imageLoader;
        _ = Task.Run(async () =>
        {
            var image = await loader.LoadAsync(url, decodePixelWidth: 96);
            if (image is not null && string.Equals(_senderAvatarUrl, url, StringComparison.Ordinal))
            {
                SenderAvatarImage = image;
            }
        });
    }

    // ---- Карточка действия ассистента (action_card) ----

    /// <summary>Провайдер подтверждения карточки (choice|format|scope — как web onConfirmAction).</summary>
    public Func<ChatMessageViewModel, ChatActionCardViewModel, string?, string?, string?, Task>? ActionConfirmHandler { get; set; }

    /// <summary>Провайдер отмены карточки.</summary>
    public Func<ChatMessageViewModel, ChatActionCardViewModel, Task>? ActionCancelHandler { get; set; }

    /// <summary>Провайдер открытия result_url карточки (браузер/навигация шелла).</summary>
    public Func<ChatMessageViewModel, string, Task>? ActionResultOpenHandler { get; set; }

    private ChatActionCardViewModel? _actionCard;

    /// <summary>Карточка действия ассистента внутри пузыря (подтверждение операций HUB).</summary>
    public ChatActionCardViewModel? ActionCard
    {
        get => _actionCard;
        private set
        {
            if (SetProperty(ref _actionCard, value))
            {
                OnPropertyChanged(nameof(HasActionCard));
            }
        }
    }

    /// <summary>Есть карточка — блок в пузыре виден.</summary>
    public bool HasActionCard => ActionCard is not null;

    /// <summary>
    /// Применить action_card из DTO/обновления: та же карточка обновляется на месте,
    /// исчезнувшая — снимается (hydrate/realtime шлют частичные патчи).
    /// </summary>
    public void ApplyActionCard(HubChatActionCard? card)
    {
        if (card is null || string.IsNullOrWhiteSpace(card.Id))
        {
            ActionCard = null;
            return;
        }

        if (ActionCard is { } existing && string.Equals(existing.Id, card.Id, StringComparison.Ordinal))
        {
            existing.Update(card);
            return;
        }

        ChatActionCardViewModel? self = null;
        self = new ChatActionCardViewModel(
            card,
            (choice, format, scope) =>
                ActionConfirmHandler?.Invoke(this, self!, choice, format, scope) ?? Task.CompletedTask,
            () => ActionCancelHandler?.Invoke(this, self!) ?? Task.CompletedTask,
            url => ActionResultOpenHandler?.Invoke(this, url) ?? Task.CompletedTask);
        ActionCard = self;
    }

    // ---- Превью ссылки ----

    /// <summary>Первая http(s)-ссылка в тексте или null (parity web extractFirstChatUrl).</summary>
    public static string? ExtractFirstChatUrl(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return null;
        }

        var match = ChatUrlRegex.Match(text);
        return match.Success ? match.Value : null;
    }

    /// <summary>
    /// Перечитывает первую ссылку из текущего body: смена url пересобирает карточку
    /// и (при назначенном загрузчике) запускает запрос — как web при маунте пузыря.
    /// </summary>
    private void UpdateLinkPreviewSource()
    {
        var url = IsDeleted ? null : ExtractFirstChatUrl(_body);
        if (!string.Equals(url, _linkPreviewUrl, StringComparison.Ordinal))
        {
            _linkPreviewUrl = url;
            _linkPreviewRequestedUrl = null;
            LinkPreviewItems.Clear();
            if (url is not null)
            {
                // Компактная карточка сразу — как web: hostname + «Загрузка превью…».
                LinkPreviewItems.Add(new ChatLinkPreviewItemViewModel(
                    url, preview: null, isLoading: true, OpenLinkPreviewItemAsync));
            }

            OnPropertyChanged(nameof(HasLinkPreviews));
        }

        if (url is not null
            && _linkPreviewLoader is { } loader
            && !string.Equals(_linkPreviewRequestedUrl, url, StringComparison.Ordinal))
        {
            _linkPreviewRequestedUrl = url;
            _ = LoadLinkPreviewSafelyAsync(url, loader);
        }
    }

    private async Task LoadLinkPreviewSafelyAsync(
        string url,
        Func<string, Task<HubChatLinkPreview?>> loader)
    {
        HubChatLinkPreview? preview;
        try
        {
            preview = await loader(url);
        }
        catch
        {
            // Превью — необязательная карточка: сбой → компактный вид, без баннера.
            preview = null;
        }

        // Ответ пришёл к уже отредактированному тексту/удалённому сообщению — поздно.
        if (IsDeleted || !string.Equals(_linkPreviewRequestedUrl, url, StringComparison.Ordinal))
        {
            return;
        }

        LinkPreviewItems.Clear();
        LinkPreviewItems.Add(new ChatLinkPreviewItemViewModel(
            url, preview, isLoading: false, OpenLinkPreviewItemAsync));
        OnPropertyChanged(nameof(HasLinkPreviews));
    }

    private Task OpenLinkPreviewItemAsync(ChatLinkPreviewItemViewModel item) =>
        LinkPreviewHandler?.Invoke(this, item) ?? Task.CompletedTask;

    private static string? FormatReactions(IReadOnlyList<HubChatReaction>? reactions) =>
        reactions is { Count: > 0 } list
            ? string.Join("  ", list.Select(r => $"{r.Emoji} {r.Count}"))
            : null;
}

/// <summary>
/// Строка заявки на вступление: имя/время подачи и кнопки
/// «Принять»/«Отклонить» (PUT join-requests/{id}).
/// </summary>
public sealed class ChatJoinRequestItemViewModel : ObservableObject
{
    private bool _isResolving;

    public ChatJoinRequestItemViewModel(
        HubChatJoinRequestItem request,
        Func<ChatJoinRequestItemViewModel, string, Task>? decisionHandler)
    {
        Id = request.Id;
        UserId = request.UserId;
        UserName = string.IsNullOrWhiteSpace(request.UserName)
            ? $"Пользователь {request.UserId}"
            : request.UserName!;
        CreatedAtText = request.CreatedAt is { } created
            ? created.LocalDateTime.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : null;
        ApproveCommand = new NativeRelayCommand(_ =>
        {
            if (!IsResolving && decisionHandler is { } handler)
            {
                _ = handler(this, "approve");
            }
        });
        RejectCommand = new NativeRelayCommand(_ =>
        {
            if (!IsResolving && decisionHandler is { } handler)
            {
                _ = handler(this, "reject");
            }
        });
    }

    public long Id { get; }

    public int UserId { get; }

    public string UserName { get; }

    /// <summary>«Подана 15.11.2025 09:41»; null — без даты.</summary>
    public string? CreatedAtText { get; }

    /// <summary>Решение в полёте — повторные нажатия глушим.</summary>
    public bool IsResolving
    {
        get => _isResolving;
        set => SetProperty(ref _isResolving, value);
    }

    public ICommand ApproveCommand { get; }

    public ICommand RejectCommand { get; }

    public string AvatarInitial =>
        string.IsNullOrWhiteSpace(UserName) ? "•" : UserName.Trim()[..1].ToUpperInvariant();

    /// <summary>Градиентный круг аватара — палитра пиров по id заявителя.</summary>
    public Brush AvatarBrush => ChatPeerPalette.AvatarBrush(
        UserId.ToString(CultureInfo.InvariantCulture));

    /// <summary>Двухбуквенные инициалы на градиентном аватаре.</summary>
    public string AvatarInitials => ChatPeerPalette.Initials(UserName);
}

/// <summary>
/// Строка жалобы на сообщение: причина, автор жалобы, превью сообщения
/// и кнопки «Решено»/«Отклонить» (PUT reports/{id}).
/// </summary>
public sealed class ChatMessageReportItemViewModel : ObservableObject
{
    private bool _isResolving;

    public ChatMessageReportItemViewModel(
        HubChatMessageReport report,
        Func<ChatMessageReportItemViewModel, string, Task>? resolutionHandler)
    {
        Id = report.Id;
        MessageId = report.MessageId ?? string.Empty;
        ReasonText = report.Reason switch
        {
            "spam" => "Спам",
            "abuse" => "Оскорбления",
            "illegal" => "Незаконное",
            _ => "Другое",
        };
        Comment = string.IsNullOrWhiteSpace(report.Comment) ? null : report.Comment;
        ReporterText = string.IsNullOrWhiteSpace(report.ReporterName)
            ? "Жалоба"
            : $"от {report.ReporterName}";
        CreatedAtText = report.CreatedAt is { } created
            ? created.LocalDateTime.ToString("dd.MM.yyyy HH:mm", CultureInfo.InvariantCulture)
            : null;
        SenderName = string.IsNullOrWhiteSpace(report.SenderName) ? null : report.SenderName;
        MessagePreview = string.IsNullOrWhiteSpace(report.MessagePreview)
            ? null
            : report.MessagePreview;
        ResolveCommand = new NativeRelayCommand(_ =>
        {
            if (!IsResolving && resolutionHandler is { } handler)
            {
                _ = handler(this, "resolved");
            }
        });
        DismissCommand = new NativeRelayCommand(_ =>
        {
            if (!IsResolving && resolutionHandler is { } handler)
            {
                _ = handler(this, "dismissed");
            }
        });
    }

    public long Id { get; }

    public string MessageId { get; }

    /// <summary>Локализованная причина: «Спам»/«Оскорбления»/«Незаконное»/«Другое».</summary>
    public string ReasonText { get; }

    /// <summary>Комментарий жалобы; null — не заполнен.</summary>
    public string? Comment { get; }

    /// <summary>«от Имя» — кто пожаловался.</summary>
    public string ReporterText { get; }

    /// <summary>Дата подачи локальным временем.</summary>
    public string? CreatedAtText { get; }

    /// <summary>Автор сообщения, на которое пожаловались.</summary>
    public string? SenderName { get; }

    /// <summary>Первые ~200 символов сообщения (message_preview с бэкенда).</summary>
    public string? MessagePreview { get; }

    /// <summary>Решение в полёте — повторные нажатия глушим.</summary>
    public bool IsResolving
    {
        get => _isResolving;
        set => SetProperty(ref _isResolving, value);
    }

    public ICommand ResolveCommand { get; }

    public ICommand DismissCommand { get; }
}

/// <summary>
/// Строка задачи в диалоге «Поделиться задачей»: название + статус/исполнитель,
/// кнопка «Поделиться» — POST messages/task-share.
/// </summary>
public sealed class ChatShareableTaskItemViewModel : ObservableObject
{
    private bool _isSharing;

    public ChatShareableTaskItemViewModel(
        HubChatTaskPreview task,
        Func<ChatShareableTaskItemViewModel, Task>? shareHandler)
    {
        TaskId = task.Id ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(task.Title) ? "Задача" : task.Title;
        MetaText = FormatMeta(task);
        IsOverdue = task.IsOverdue;
        ShareCommand = new NativeRelayCommand(_ =>
        {
            if (!IsSharing && shareHandler is { } handler)
            {
                _ = handler(this);
            }
        });
    }

    public string TaskId { get; }

    public string Title { get; }

    /// <summary>«№ id · Статус · Исполнитель · до dd.MM.yyyy» — как карточка в ленте.</summary>
    public string MetaText { get; }

    public bool IsOverdue { get; }

    /// <summary>Отправка в полёте — повторные нажатия глушим.</summary>
    public bool IsSharing
    {
        get => _isSharing;
        set => SetProperty(ref _isSharing, value);
    }

    public ICommand ShareCommand { get; }

    private static string FormatMeta(HubChatTaskPreview task)
    {
        var parts = new List<string>();
        if (!string.IsNullOrWhiteSpace(task.Id))
        {
            parts.Add("№ " + task.Id.Trim());
        }

        parts.Add(TaskListItemViewModel.StatusToText(task.Status));
        var assignee = task.AssigneeFullName ?? task.AssigneeUsername;
        if (!string.IsNullOrWhiteSpace(assignee))
        {
            parts.Add(assignee);
        }

        if (task.DueAt is { } due)
        {
            parts.Add("до " + due.LocalDateTime.ToString("dd.MM.yyyy", CultureInfo.InvariantCulture));
        }

        return string.Join(" · ", parts.Where(part => !string.IsNullOrWhiteSpace(part)));
    }
}

/// <summary>
/// Время «Отправить позже» (parity web chatScheduledTime.js): локальное время
/// пользователя, на сервер уходит ISO. Пресеты — «Через час», «Завтра в 9:00»,
/// «В понедельник в 9:00»; формат — «сегодня в 18:30», «завтра в 09:00», «5 нояб. в 09:00».
/// </summary>
internal static class ChatScheduleTime
{
    /// <summary>Сервер отказывает ближе 30 с; диалог просит минуту запаса (web MIN_SCHEDULE_LEAD_MS).</summary>
    public static readonly TimeSpan MinScheduleLead = TimeSpan.FromMinutes(1);

    public static readonly TimeSpan MaxScheduleLead = TimeSpan.FromDays(365);

    /// <summary>«сегодня в HH:mm», «завтра в HH:mm», «d MMM [yyyy] в HH:mm» (локальное время).</summary>
    public static string Format(DateTimeOffset value, DateTime? now = null)
    {
        var local = value.LocalDateTime;
        var time = local.ToString("HH:mm", CultureInfo.InvariantCulture);
        var today = (now ?? DateTime.Now).Date;
        if (local.Date == today)
        {
            return $"сегодня в {time}";
        }

        if (local.Date == today.AddDays(1))
        {
            return $"завтра в {time}";
        }

        var day = local.ToString("d MMM", CultureInfo.GetCultureInfo("ru-RU"));
        var year = local.Year == today.Year ? string.Empty : $" {local.Year}";
        return $"{day}{year} в {time}";
    }

    /// <summary>Быстрые выборы диалога (key → подпись и момент), как buildSchedulePresets web.</summary>
    public static IReadOnlyList<(string Key, string Label, DateTimeOffset When)> Presets(DateTimeOffset? now = null)
    {
        var baseTime = now ?? DateTimeOffset.Now;
        // «Через час»: сдвиг на час и обрезка до минуты (setSeconds(0,0) в web).
        var shifted = baseTime.LocalDateTime.AddHours(1);
        var inOneHour = new DateTimeOffset(
            new DateTime(shifted.Year, shifted.Month, shifted.Day, shifted.Hour, shifted.Minute, 0),
            baseTime.Offset);
        var tomorrowMorning = new DateTimeOffset(
            baseTime.LocalDateTime.Date.AddDays(1).AddHours(9), baseTime.Offset);
        var daysToMonday = ((8 - (int)baseTime.LocalDateTime.DayOfWeek) % 7) switch
        {
            0 => 7,
            var days => days,
        };
        var nextMonday = new DateTimeOffset(
            baseTime.LocalDateTime.Date.AddDays(daysToMonday).AddHours(9), baseTime.Offset);
        return
        [
            ("hour", "Через час", inOneHour),
            ("tomorrow", "Завтра в 9:00", tomorrowMorning),
            ("monday", "В понедельник в 9:00", nextMonday),
        ];
    }

    /// <summary>Валидация момента отправки, как validateScheduleDate web ('' — валидно).</summary>
    public static string Validate(DateTimeOffset? value, DateTimeOffset? now = null)
    {
        var moment = now ?? DateTimeOffset.Now;
        if (value is not { } when)
        {
            return "Укажите дату и время";
        }

        if (when < moment + MinScheduleLead)
        {
            return "Время должно быть в будущем";
        }

        if (when > moment + MaxScheduleLead)
        {
            return "Не дальше, чем на год";
        }

        return string.Empty;
    }
}

/// <summary>
/// Отложенное сообщение в панели «Запланированные»: текст, подпись времени
/// («завтра в 09:00» / «Отправляется…» / «Не отправлено: причина»),
/// правка времени/текста и armed-отмена (parity web ScheduledMessagesDialog).
/// </summary>
public sealed class ChatScheduledMessageItemViewModel : ObservableObject
{
    private bool _isBusy;
    private bool _cancelArmed;

    public ChatScheduledMessageItemViewModel(
        HubChatScheduledMessage model,
        Func<ChatScheduledMessageItemViewModel, Task>? editHandler,
        Func<ChatScheduledMessageItemViewModel, Task>? cancelHandler)
    {
        Id = model.Id;
        Body = model.Body ?? string.Empty;
        Status = model.Status ?? "scheduled";
        ScheduledFor = model.ScheduledFor;
        ErrorText = model.ErrorText;
        EditCommand = new NativeRelayCommand(_ =>
        {
            if (CanEdit && editHandler is { } handler)
            {
                _ = handler(this);
            }
        });
        CancelCommand = new NativeRelayCommand(_ =>
        {
            if (CanEdit && !IsBusy && cancelHandler is { } handler)
            {
                _ = handler(this);
            }
        });
    }

    public string Id { get; }

    public string Body { get; }

    /// <summary>scheduled|sending|failed (sent/cancelled из выдачи уходят).</summary>
    public string Status { get; }

    public DateTimeOffset? ScheduledFor { get; }

    public string? ErrorText { get; }

    /// <summary>Веб: sending блокирует правку/отмену — сообщение уже уходит.</summary>
    public bool CanEdit => Status is not "sending";

    /// <summary>Подпись строки: время отправки или состояние ошибки/отправки.</summary>
    public string StatusText => Status switch
    {
        "failed" => string.IsNullOrWhiteSpace(ErrorText)
            ? "Не отправлено"
            : $"Не отправлено: {ErrorText}",
        "sending" => "Отправляется…",
        _ => ScheduledFor is { } when
            ? ChatScheduleTime.Format(when)
            : "Время не задано",
    };

    /// <summary>Ошибочная строка — красная подпись времени.</summary>
    public bool IsFailed => Status is "failed";

    /// <summary>Любая запись в полёте (busy хука web): действия строк глушим.</summary>
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

    /// <summary>Действия строки активны (обёртка для XAML без конвертера).</summary>
    public bool AreActionsEnabled => !IsBusy;

    /// <summary>Armed-отмена: первое нажатие просит повторное, как DeleteArmed у строк.</summary>
    public bool CancelArmed
    {
        get => _cancelArmed;
        internal set
        {
            if (SetProperty(ref _cancelArmed, value))
            {
                OnPropertyChanged(nameof(CancelText));
            }
        }
    }

    /// <summary>Подпись кнопки отмены: armed-состояние просит повторное нажатие.</summary>
    public string CancelText => CancelArmed ? "Точно?" : "✕";

    public ICommand EditCommand { get; }

    public ICommand CancelCommand { get; }
}

/// <summary>Опция подтверждения action_card (preview.choices/formats: {id,label}).</summary>
public sealed record ChatActionCardOption(string Id, string Label);

/// <summary>
/// Карточка действия AI-ассистента в пузыре (action_card): заголовок/сводка/пункты/
/// предупреждения из preview, выбор choice|format, подтверждение/отмена/открытие
/// результата. Статусы сервера: pending|confirmed|cancelled|expired|error.
/// </summary>
public sealed class ChatActionCardViewModel : ObservableObject
{
    private readonly Func<string?, string?, string?, Task> _confirm;
    private readonly Func<Task> _cancel;
    private readonly Func<string, Task> _openResult;
    private string _status = string.Empty;
    private string _title = string.Empty;
    private string? _summary;
    private string? _errorText;
    private string? _resultUrl;
    private DateTimeOffset? _expiresAt;
    private ChatActionCardOption? _selectedChoice;
    private ChatActionCardOption? _selectedFormat;
    private bool _isBusy;

    public ChatActionCardViewModel(
        HubChatActionCard card,
        Func<string?, string?, string?, Task> confirm,
        Func<Task> cancel,
        Func<string, Task> openResult)
    {
        Id = card.Id ?? string.Empty;
        ActionType = card.ActionType ?? string.Empty;
        _confirm = confirm;
        _cancel = cancel;
        _openResult = openResult;
        ConfirmCommand = new NativeRelayCommand(_ => _ = ConfirmAsync());
        CancelCommand = new NativeRelayCommand(_ => _ = CancelAsync());
        OpenResultCommand = new NativeRelayCommand(_ => _ = OpenResultAsync());
        Update(card);
    }

    public string Id { get; }
    public string ActionType { get; }

    /// <summary>Обновление из нового DTO (hydrate/realtime): статус/результат/превью.</summary>
    public void Update(HubChatActionCard card)
    {
        Status = card.Status ?? string.Empty;
        ExpiresAt = card.ExpiresAt;
        ResultUrl = card.ResultUrl;
        ErrorText = card.ErrorText;

        var preview = card.Preview;
        if (preview is { ValueKind: JsonValueKind.Object } element)
        {
            Title = ReadString(element, "title") ?? ActionType;
            Summary = ReadString(element, "summary") ?? ReadString(element, "description");
            Items = ReadLabels(element, "items");
            Warnings = ReadLabels(element, "warnings");
            Choices = ReadOptions(element, "choices");
            Formats = ReadOptions(element, "formats");
            DatabaseId = ReadString(element, "database_id") ?? card.DatabaseId;
        }
        else
        {
            Title = ActionType;
            Summary = null;
            Items = [];
            Warnings = [];
            Choices = [];
            Formats = [];
            DatabaseId = card.DatabaseId;
        }

        // Автосвойства выше не уведомляют — поднимаем разом (live-апдейт той же карточки).
        OnPropertyChanged(nameof(Items));
        OnPropertyChanged(nameof(HasItems));
        OnPropertyChanged(nameof(Warnings));
        OnPropertyChanged(nameof(HasWarnings));
        OnPropertyChanged(nameof(Choices));
        OnPropertyChanged(nameof(HasChoices));
        OnPropertyChanged(nameof(Formats));
        OnPropertyChanged(nameof(HasFormats));
        OnPropertyChanged(nameof(DatabaseId));

        if (Choices.Count > 0 && _selectedChoice is null)
        {
            _selectedChoice = Choices[0];
        }

        if (Formats.Count > 0 && _selectedFormat is null)
        {
            _selectedFormat = Formats[0];
        }
    }

    public string Status
    {
        get => _status;
        private set
        {
            if (SetProperty(ref _status, value))
            {
                OnPropertyChanged(nameof(IsActionable));
                OnPropertyChanged(nameof(StatusText));
            }
        }
    }

    public string Title
    {
        get => _title;
        private set => SetProperty(ref _title, value);
    }

    public string? Summary
    {
        get => _summary;
        private set
        {
            if (SetProperty(ref _summary, value))
            {
                OnPropertyChanged(nameof(HasSummary));
            }
        }
    }

    public bool HasSummary => !string.IsNullOrWhiteSpace(Summary);

    public IReadOnlyList<string> Items { get; private set; } = [];
    public IReadOnlyList<string> Warnings { get; private set; } = [];
    public IReadOnlyList<ChatActionCardOption> Choices { get; private set; } = [];
    public IReadOnlyList<ChatActionCardOption> Formats { get; private set; } = [];

    public bool HasItems => Items.Count > 0;
    public bool HasWarnings => Warnings.Count > 0;
    public bool HasChoices => Choices.Count > 0;
    public bool HasFormats => Formats.Count > 0;

    /// <summary>Выбранная опция (choice) — уходит в confirm как первый аргумент.</summary>
    public ChatActionCardOption? SelectedChoice
    {
        get => _selectedChoice;
        set => SetProperty(ref _selectedChoice, value);
    }

    /// <summary>Выбранный формат — второй аргумент confirm.</summary>
    public ChatActionCardOption? SelectedFormat
    {
        get => _selectedFormat;
        set => SetProperty(ref _selectedFormat, value);
    }

    public string? DatabaseId { get; private set; }

    public DateTimeOffset? ExpiresAt
    {
        get => _expiresAt;
        private set
        {
            if (SetProperty(ref _expiresAt, value))
            {
                OnPropertyChanged(nameof(IsActionable));
            }
        }
    }

    public string? ResultUrl
    {
        get => _resultUrl;
        private set
        {
            if (SetProperty(ref _resultUrl, value))
            {
                OnPropertyChanged(nameof(HasResultUrl));
            }
        }
    }

    public bool HasResultUrl => !string.IsNullOrWhiteSpace(ResultUrl);

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

    public bool HasError => !string.IsNullOrWhiteSpace(ErrorText);

    public bool IsBusy
    {
        get => _isBusy;
        private set
        {
            if (SetProperty(ref _isBusy, value))
            {
                OnPropertyChanged(nameof(IsActionable));
            }
        }
    }

    /// <summary>Ждёт решения: pending, не истекла, нет запроса в полёте.</summary>
    public bool IsActionable =>
        !IsBusy
        && Status is "pending" or ""
        && (ExpiresAt is null || ExpiresAt > DateTimeOffset.UtcNow);

    /// <summary>Подпись терминального статуса для завершённых карточек.</summary>
    public string? StatusText => Status switch
    {
        "confirmed" => "Подтверждено",
        "cancelled" => "Отменено",
        "expired" => "Истекло",
        "error" => ErrorText ?? "Ошибка действия",
        _ => null,
    };

    public ICommand ConfirmCommand { get; }
    public ICommand CancelCommand { get; }
    public ICommand OpenResultCommand { get; }

    private async Task ConfirmAsync()
    {
        if (!IsActionable)
        {
            return;
        }

        IsBusy = true;
        try
        {
            await _confirm(_selectedChoice?.Id, _selectedFormat?.Id, DatabaseId);
        }
        catch
        {
            // Ошибка поверхится в ErrorText через realtime/ответ — карточка жива.
        }
        finally
        {
            IsBusy = false;
        }
    }

    private async Task CancelAsync()
    {
        if (!IsActionable)
        {
            return;
        }

        IsBusy = true;
        try
        {
            await _cancel();
        }
        catch
        {
        }
        finally
        {
            IsBusy = false;
        }
    }

    private Task OpenResultAsync()
    {
        var url = ResultUrl;
        return url is null ? Task.CompletedTask : _openResult(url);
    }

    private static string? ReadString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static List<string> ReadLabels(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<string>();
        foreach (var item in array.EnumerateArray())
        {
            var label = item.ValueKind == JsonValueKind.String
                ? item.GetString()
                : item.ValueKind == JsonValueKind.Object
                    ? ReadString(item, "label") ?? ReadString(item, "text") ?? ReadString(item, "title")
                    : null;
            if (!string.IsNullOrWhiteSpace(label))
            {
                result.Add(label);
            }
        }

        return result;
    }

    private static List<ChatActionCardOption> ReadOptions(JsonElement element, string name)
    {
        if (!element.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        var result = new List<ChatActionCardOption>();
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(item.GetString()))
            {
                var text = item.GetString()!;
                result.Add(new ChatActionCardOption(text, text));
                continue;
            }

            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            var id = ReadString(item, "id") ?? ReadString(item, "key") ?? ReadString(item, "value");
            var label = ReadString(item, "label") ?? ReadString(item, "title") ?? id;
            if (!string.IsNullOrWhiteSpace(id))
            {
                result.Add(new ChatActionCardOption(id, label ?? id));
            }
        }

        return result;
    }
}

/// <summary>
/// Вкладка папки над списком диалогов (parity web ChatFolderTabs): системные
/// «Личные/Беседы/Задачи» + пользовательские папки сервера. Key — system key
/// или id папки; FolderId != null только у пользовательских (для меню папки).
/// </summary>
public sealed class ChatFolderTabViewModel : ObservableObject
{
    private bool _isSelected;
    private bool _isRenaming;
    private int _unreadCount;
    private string _title;
    private int _conversationCount;

    public ChatFolderTabViewModel(
        string key,
        string title,
        string? folderId,
        int sortOrder,
        Func<ChatFolderTabViewModel, Task> selectHandler)
    {
        Key = key;
        _title = title;
        FolderId = folderId;
        SortOrder = sortOrder;
        SelectCommand = new NativeAsyncCommand(
            (parameter, _) => selectHandler(parameter as ChatFolderTabViewModel ?? this),
            _ => { });
    }

    /// <summary>System key (personal|groups|tasks) или id пользовательской папки.</summary>
    public string Key { get; }

    /// <summary>Id пользовательской папки; null у системных вкладок.</summary>
    public string? FolderId { get; }

    /// <summary>Системная вкладка — меню переименования/удаления скрыто.</summary>
    public bool IsSystem => FolderId is null;

    /// <summary>Иконка вкладки в вертикальной полосе папок слева (как в Telegram Desktop).</summary>
    public string IconText => Key switch
    {
        ChatViewModel.AllFolderKey => "💬",
        ChatViewModel.PersonalFolderKey => "👤",
        ChatViewModel.GroupsFolderKey => "👥",
        ChatViewModel.TasksFolderKey => "📌",
        _ => "📁",
    };

    /// <summary>Порядок сортировки пользовательской папки (sort_order сервера).</summary>
    public int SortOrder { get; }

    public string Title
    {
        get => _title;
        set
        {
            if (SetProperty(ref _title, value))
            {
                OnPropertyChanged(nameof(AutomationName));
            }
        }
    }

    /// <summary>Диалогов в папке — подпись строки в «Управлении папками».</summary>
    public int ConversationCount
    {
        get => _conversationCount;
        set
        {
            if (SetProperty(ref _conversationCount, value))
            {
                OnPropertyChanged(nameof(ConversationCountText));
            }
        }
    }

    public string ConversationCountText =>
        ConversationCount + " " + ChatPlural.Of(ConversationCount, "чат", "чата", "чатов");

    public int UnreadCount
    {
        get => _unreadCount;
        set
        {
            if (SetProperty(ref _unreadCount, value))
            {
                OnPropertyChanged(nameof(HasUnread));
                OnPropertyChanged(nameof(UnreadBadgeText));
                OnPropertyChanged(nameof(AutomationName));
            }
        }
    }

    public bool HasUnread => UnreadCount > 0;

    public string UnreadBadgeText => UnreadCount switch
    {
        > 99 => "99+",
        > 0 => UnreadCount.ToString(CultureInfo.InvariantCulture),
        _ => string.Empty,
    };

    /// <summary>Активная вкладка — стиль и aria-роль переключателя.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }

    /// <summary>Строка менеджера в режиме переименования — поле вместо заголовка.</summary>
    public bool IsRenaming
    {
        get => _isRenaming;
        set => SetProperty(ref _isRenaming, value);
    }

    /// <summary>Имя вкладки для чтения экранным диктором (с бейджем непрочитанных).</summary>
    public string AutomationName => HasUnread
        ? $"Папка {Title}, непрочитанных: {UnreadCount}"
        : $"Папка {Title}";

    public ICommand SelectCommand { get; }
}

/// <summary>
/// Пункт подменю «Добавить в папку» в контекстном меню строки диалога:
/// галочка членства + toggle через API (POST/DELETE …/folders/{id}/conversations/{cid}).
/// </summary>
public sealed class ChatFolderMenuItemViewModel : ObservableObject
{
    private bool _isIncluded;
    private string _title;

    public ChatFolderMenuItemViewModel(
        string folderId,
        string title,
        bool isIncluded,
        Func<ChatFolderMenuItemViewModel, Task> toggleHandler)
    {
        FolderId = folderId;
        _title = title;
        _isIncluded = isIncluded;
        ToggleCommand = new NativeAsyncCommand(
            (parameter, _) => toggleHandler(parameter as ChatFolderMenuItemViewModel ?? this),
            _ => { });
    }

    public string FolderId { get; }

    public string Title
    {
        get => _title;
        set => SetProperty(ref _title, value);
    }

    /// <summary>Диалог входит в папку — галочка пункта меню.</summary>
    public bool IsIncluded
    {
        get => _isIncluded;
        set => SetProperty(ref _isIncluded, value);
    }

    public ICommand ToggleCommand { get; }
}

/// <summary>Строка «Состава папки»: диалог с галочкой членства.</summary>
public sealed class ChatFolderMembershipItemViewModel : ObservableObject
{
    private bool _isIncluded;

    public ChatFolderMembershipItemViewModel(ConversationItemViewModel conversation, bool isIncluded)
    {
        ConversationId = conversation.Id;
        Title = conversation.Title;
        Subtitle = conversation.KindText;
        _isIncluded = isIncluded;
    }

    public string ConversationId { get; }

    public string Title { get; }

    public string? Subtitle { get; }

    public bool IsIncluded
    {
        get => _isIncluded;
        set => SetProperty(ref _isIncluded, value);
    }
}

/// <summary>
/// Стикер в сетке панели: превью — авторизованная картинка (file_url/preview_url
/// — same-origin Bearer-маршруты), emoji подписывает alt. Клик — отправка.
/// </summary>
public sealed class ChatStickerItemViewModel : ObservableObject
{
    private ImageSource? _preview;

    public ChatStickerItemViewModel(
        HubChatSticker sticker,
        Func<ChatStickerItemViewModel, Task> sendHandler,
        AuthImageLoader? imageLoader)
    {
        Id = sticker.Id ?? string.Empty;
        Emoji = sticker.Emoji;
        AutomationName = string.IsNullOrWhiteSpace(sticker.Emoji)
            ? "Стикер"
            : $"Стикер {sticker.Emoji}";
        SendCommand = new NativeAsyncCommand(
            (parameter, _) => sendHandler(parameter as ChatStickerItemViewModel ?? this),
            _ => { });

        var previewUrl = !string.IsNullOrWhiteSpace(sticker.PreviewUrl)
            ? sticker.PreviewUrl
            : sticker.FileUrl;
        if (imageLoader is not null && !string.IsNullOrWhiteSpace(previewUrl))
        {
            _ = LoadPreviewAsync(imageLoader, previewUrl);
        }
    }

    public string Id { get; }

    /// <summary>Эмодзи стикера — alt-имя и fallback без картинки.</summary>
    public string? Emoji { get; }

    public string AutomationName { get; }

    /// <summary>Превью стикера (null — пока грузится либо при ошибке).</summary>
    public ImageSource? Preview
    {
        get => _preview;
        private set
        {
            if (SetProperty(ref _preview, value))
            {
                OnPropertyChanged(nameof(HasPreview));
            }
        }
    }

    /// <summary>Превью загружено — ячейка рисует картинку вместо эмодзи.</summary>
    public bool HasPreview => Preview is not null;

    public ICommand SendCommand { get; }

    private async Task LoadPreviewAsync(AuthImageLoader imageLoader, string previewUrl)
    {
        var image = await imageLoader.LoadAsync(
            previewUrl, decodePixelWidth: ChatMediaItemViewModel.ThumbnailDecodeWidth);
        if (image is not null)
        {
            Preview = image;
        }
    }
}

/// <summary>
/// Пак стикеров — вкладка панели: заголовок, обложка (первый стикер) и сетка.
/// </summary>
public sealed class ChatStickerPackViewModel : ObservableObject
{
    private bool _isSelected;

    public ChatStickerPackViewModel(
        HubChatStickerPack pack,
        Func<ChatStickerItemViewModel, Task> sendHandler,
        AuthImageLoader? imageLoader)
    {
        Id = pack.Id ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(pack.Title) ? "Набор стикеров" : pack.Title;
        ShortName = pack.ShortName;
        foreach (var sticker in pack.Stickers ?? [])
        {
            if (!string.IsNullOrEmpty(sticker.Id))
            {
                Stickers.Add(new ChatStickerItemViewModel(sticker, sendHandler, imageLoader));
            }
        }

        // Обложка — превью первого стикера; грузится вместе с ним.
        if (Stickers.FirstOrDefault() is { } first)
        {
            first.PropertyChanged += (_, args) =>
            {
                if (args.PropertyName is nameof(ChatStickerItemViewModel.Preview))
                {
                    OnPropertyChanged(nameof(Cover));
                    OnPropertyChanged(nameof(HasCover));
                    OnPropertyChanged(nameof(CoverEmoji));
                }
            };
        }
    }

    public string Id { get; }

    public string Title { get; }

    public string? ShortName { get; }

    public ObservableCollection<ChatStickerItemViewModel> Stickers { get; } = [];

    /// <summary>Обложка вкладки — превью первого стикера пака.</summary>
    public ImageSource? Cover => Stickers.FirstOrDefault()?.Preview;

    public bool HasCover => Cover is not null;

    /// <summary>Эмодзи первого стикера — fallback обложки без картинки.</summary>
    public string CoverEmoji => Stickers.FirstOrDefault()?.Emoji ?? "🏷";

    /// <summary>Активная вкладка паков — подсветка в полосе.</summary>
    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>
/// Ассистент в панели «ИИ»: открыть существующий диалог или начать новый —
/// как openAiBotConversation/createAiBotConversation в web.
/// </summary>
public sealed class ChatAiBotItemViewModel : ObservableObject
{
    public ChatAiBotItemViewModel(
        HubChatAiBot bot,
        Func<ChatAiBotItemViewModel, bool, Task> openHandler)
    {
        Id = bot.Id ?? string.Empty;
        Title = string.IsNullOrWhiteSpace(bot.Title) ? "HUB Ассистент" : bot.Title;
        Description = bot.Description;
        HasExistingConversation = !string.IsNullOrEmpty(bot.ConversationId)
            || bot.ConversationIds is { Count: > 0 };
        OpenCommand = new NativeAsyncCommand(
            (parameter, _) => openHandler(
                parameter as ChatAiBotItemViewModel ?? this, false),
            _ => { });
        NewConversationCommand = new NativeAsyncCommand(
            (parameter, _) => openHandler(
                parameter as ChatAiBotItemViewModel ?? this, true),
            _ => { });
    }

    public string Id { get; }

    public string Title { get; }

    public string? Description { get; }

    /// <summary>У бота уже есть диалог — кнопка «Открыть», иначе «Начать чат».</summary>
    public bool HasExistingConversation { get; }

    public string OpenText => HasExistingConversation ? "Открыть" : "Начать чат";

    /// <summary>Открыть/начать диалог с ботом (open — сервер вернёт существующий).</summary>
    public ICommand OpenCommand { get; }

    /// <summary>Всегда новый диалог с ботом (createAiBotConversation).</summary>
    public ICommand NewConversationCommand { get; }
}

/// <summary>
/// Категория вкладки «Эмодзи» стикер-панели (tg-stickers «Smileys and people»):
/// заголовок секции + набор символов для сетки вставки.
/// </summary>
public sealed class ChatEmojiSectionViewModel
{
    public ChatEmojiSectionViewModel(string title, IReadOnlyList<string> emojis)
    {
        Title = title;
        Emojis = emojis;
    }

    /// <summary>Заголовок секции — «Улыбки» и т.п.</summary>
    public string Title { get; }

    /// <summary>Эмодзи секции в порядке показа.</summary>
    public IReadOnlyList<string> Emojis { get; }
}

/// <summary>
/// Чип реакции под пузырём (tg-reactions): эмодзи-иконка + счётчик.
/// Эмодзи остаётся строкой — цветную картинку подставляет EmojiGlyph/конвертер.
/// </summary>
public sealed class ChatReactionItemViewModel
{
    public ChatReactionItemViewModel(HubChatReaction reaction)
    {
        Emoji = reaction.Emoji ?? string.Empty;
        Count = reaction.Count;
    }

    /// <summary>Строка-эмодзи реакции (❤️/👍/…).</summary>
    public string Emoji { get; }

    /// <summary>Сколько поставили реакцию.</summary>
    public int Count { get; }

    /// <summary>Подпись счётчика в чипе.</summary>
    public string CountText => Count.ToString(CultureInfo.InvariantCulture);
}
