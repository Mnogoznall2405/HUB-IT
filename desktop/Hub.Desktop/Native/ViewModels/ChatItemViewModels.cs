using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

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
    private string? _kindText;
    private bool _isPinned;
    private bool _isMuted;
    private bool _isArchived;
    private DateTimeOffset? _mutedUntil;
    private bool _isOnline;
    private string? _presenceText;
    private string? _viewerMemberRole;

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

    public HubChatUser? DirectPeer { get; private set; }

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

    public string? Preview
    {
        get => _preview;
        private set => SetProperty(ref _preview, value);
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

    public void Update(HubChatConversation conversation)
    {
        Kind = conversation.Kind;
        ViewerMemberRole = conversation.ViewerMemberRole;
        // Kind — обычное свойство без нотификации: CanLeaveGroup/CanExportHistory зависят от него.
        OnPropertyChanged(nameof(CanLeaveGroup));
        OnPropertyChanged(nameof(CanExportHistory));
        IsPinned = conversation.IsPinned;
        IsMuted = conversation.IsMuted;
        MutedUntil = conversation.MutedUntil;
        IsArchived = conversation.IsArchived;
        PinnedMessageId = conversation.PinnedMessageId;
        DirectPeer = conversation.DirectPeer;
        // DTO без presence не сбрасывает живой статус от chat.presence.updated.
        if (conversation.DirectPeer?.Presence is { } presence)
        {
            ApplyPresence(presence);
        }

        Title = ResolveTitle(conversation);
        Preview = conversation.LastMessagePreview;
        LastMessageAt = conversation.LastMessageAt;
        UnreadCount = conversation.UnreadCount;
        KindText = ResolveKindText(conversation);
    }

    /// <summary>Обновить превью/время по свежему сообщению (realtime или send-echo).</summary>
    public void UpdateLastMessage(HubChatMessage message)
    {
        if (message.CreatedAt is not null)
        {
            LastMessageAt = message.CreatedAt;
        }

        Preview = message.IsDeleted
            ? "Сообщение удалено"
            : !string.IsNullOrWhiteSpace(message.Body)
                ? message.Body
                : message.Attachments is { Count: > 0 } attachments
                    ? $"📎 {attachments.Count} {ChatPlural.Of(attachments.Count, "файл", "файла", "файлов")}"
                    : Preview;
    }

    public void IncrementUnread() => UnreadCount++;

    public void ClearUnread() => UnreadCount = 0;

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
            "group" => $"Группа · {conversation.MemberCount} "
                + ChatPlural.Of(conversation.MemberCount, "участник", "участника", "участников"),
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

    /// <summary>Вторая строка: отдел, иначе @логин.</summary>
    public string Subtitle =>
        !string.IsNullOrWhiteSpace(Department)
            ? Department
            : string.IsNullOrWhiteSpace(Username) ? string.Empty : "@" + Username;
}

/// <summary>
/// Участник группы в панели «Участники»: имя, роль, online-точка,
/// кнопка исключения по правилам web (owner любого не-owner'а, moderator — member'ов).
/// </summary>
public sealed class ChatGroupMemberItemViewModel
{
    public ChatGroupMemberItemViewModel(
        HubChatMember member,
        bool canRemove,
        Func<ChatGroupMemberItemViewModel, Task>? removeHandler,
        bool canTransferOwnership = false,
        Func<ChatGroupMemberItemViewModel, Task>? transferOwnershipHandler = null)
    {
        var user = member.User;
        UserId = user?.Id ?? 0;
        Username = user?.Username;
        DisplayName = !string.IsNullOrWhiteSpace(user?.FullName)
            ? user.FullName
            : user?.Username ?? "Пользователь";
        Department = user?.Department;
        MemberRole = NormalizeRole(member.MemberRole);
        RoleText = MemberRole switch
        {
            "owner" => "Владелец",
            "moderator" => "Модератор",
            _ => null,
        };
        IsOnline = user?.Presence?.IsOnline == true;
        RestrictedText = member.IsRestricted ? "ограничен" : null;
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

    /// <summary>Кнопка исключения видна по правилам прав текущего пользователя.</summary>
    public bool CanRemove { get; }

    public ICommand RemoveCommand { get; }

    /// <summary>
    /// «Сделать владельцем» — только для владельца на чужой строке
    /// (member/moderator; в web — canTransferSelectedOwnership).
    /// </summary>
    public bool CanTransferOwnership { get; }

    public ICommand TransferOwnershipCommand { get; }

    public string AvatarInitial =>
        string.IsNullOrWhiteSpace(DisplayName) ? "•" : DisplayName.Trim()[..1].ToUpperInvariant();

    /// <summary>Вторая строка: отдел, иначе @логин.</summary>
    public string Subtitle =>
        !string.IsNullOrWhiteSpace(Department)
            ? Department
            : string.IsNullOrWhiteSpace(Username) ? string.Empty : "@" + Username;

    private static string NormalizeRole(string? role) =>
        string.IsNullOrWhiteSpace(role) ? "member" : role.Trim().ToLowerInvariant();
}

/// <summary>Чип вложения внутри пузыря: иконка вида, имя, размер, открытие/скачивание.</summary>
public sealed class ChatAttachmentItemViewModel
{
    private readonly HubChatAttachment _attachment;

    public ChatAttachmentItemViewModel(
        HubChatAttachment attachment,
        Func<ChatAttachmentItemViewModel, Task>? openHandler)
    {
        _attachment = attachment;
        Id = attachment.Id ?? string.Empty;
        FileName = string.IsNullOrWhiteSpace(attachment.FileName) ? "файл" : attachment.FileName;
        SizeText = FormatSize(attachment.EffectiveSize);
        Icon = (attachment.MediaKind ?? attachment.Kind) switch
        {
            "image" => "🖼",
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
    }

    /// <summary>Внутреннее представление для обратного вызова (message/attachment id).</summary>
    public HubChatAttachment Model => _attachment;

    public string Id { get; }
    public string FileName { get; }
    public string? SizeText { get; }
    public string Icon { get; }
    public ICommand OpenCommand { get; }

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

        // Превью только у image-вложений: тот же файл, что качает OpenCommand,
        // — GET /chat/messages/{mid}/attachments/{aid}/file через loader.
        if (imageLoader is not null
            && string.Equals(kind, "image", StringComparison.OrdinalIgnoreCase)
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
    private string? _body;
    private bool _isDeleted;
    private string? _editedText;
    private string? _replyText;
    private string? _forwardText;
    private string? _reactionsText;
    private string? _statusText;
    private string? _pollSummaryText;

    public ChatMessageViewModel(HubChatMessage message, bool isGroupConversation)
    {
        _isGroupConversation = isGroupConversation;
        Id = message.Id;
        ConversationId = message.ConversationId;
        ClientMessageId = message.ClientMessageId;
        IsOwn = message.IsOwn;
        SenderName = message.Sender?.FullName ?? message.Sender?.Username ?? string.Empty;
        CreatedAt = message.CreatedAt ?? DateTimeOffset.MinValue;
        TimeText = CreatedAt == DateTimeOffset.MinValue
            ? null
            : CreatedAt.LocalDateTime.ToString("HH:mm", CultureInfo.InvariantCulture);
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

    public bool IsOwn { get; }

    public string SenderName { get; }

    /// <summary>Ключ сортировки ленты (asc).</summary>
    public DateTimeOffset CreatedAt { get; }

    public string? TimeText { get; }

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

    /// <summary>Имя отправителя показываем в группах для чужих сообщений.</summary>
    public bool ShowSender => _isGroupConversation && !IsOwn && !IsDeleted;

    /// <summary>Можно ответить/процитировать — на неудалённое сообщение.</summary>
    public bool CanReply => !IsDeleted;

    /// <summary>Править/удалять можно только свои и неудалённые сообщения.</summary>
    public bool CanEditOrDelete => IsOwn && !IsDeleted;

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
        ForwardText = null;
        ReactionsText = null;
        StatusText = null;
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
        OnPropertyChanged(nameof(CanReply));
        OnPropertyChanged(nameof(CanEditOrDelete));
        OnPropertyChanged(nameof(EditableBody));
    }

    /// <summary>Свежие реакции после toggle через API или realtime-события.</summary>
    public void ApplyReactions(IReadOnlyList<HubChatReaction>? reactions) =>
        ReactionsText = FormatReactions(reactions);

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
        ForwardText = FormatForward(message.ForwardPreview);
        RebuildAttachmentItems(message.Attachments);
        ReactionsText = FormatReactions(message.Reactions);
        ApplyDelivery(message.ReadByCount, message.DeliveryStatus);
        RebuildPoll(message.Poll);
        UpdateLinkPreviewSource();
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
        AttachmentItems.Clear();
        foreach (var attachment in attachments ?? [])
        {
            AttachmentItems.Add(
                new ChatAttachmentItemViewModel(
                    attachment,
                    item => AttachmentHandler?.Invoke(this, item) ?? Task.CompletedTask));
        }

        OnPropertyChanged(nameof(HasAttachmentItems));
    }

    /// <summary>Есть чипы вложений — строка ItemsControl видна в пузыре.</summary>
    public bool HasAttachmentItems => AttachmentItems.Count > 0;

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
