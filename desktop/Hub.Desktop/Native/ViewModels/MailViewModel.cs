using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Windows.Input;
using System.Windows.Media;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.Views;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Грубая конвертация HTML в читаемый plain text: для тела письма без body_text
/// и для цитаты композера (quote_html → текст). Разрывы блочных тегов → \n.
/// </summary>
internal static class MailHtmlText
{
    private static readonly Regex BlockBreakRe = new(
        "<\\s*(br|/p|/div|/blockquote|/li|/h[1-6]|/tr)[^>]*>",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex TagRe = new("<[^>]+>", RegexOptions.Compiled);
    private static readonly Regex SpacesRe = new("[ \\t]+", RegexOptions.Compiled);
    private static readonly Regex LinePadRe = new(" ?\\n ?", RegexOptions.Compiled);
    private static readonly Regex EmptyLinesRe = new("\\n{3,}", RegexOptions.Compiled);
    private static readonly Regex CidRefRe = new("\\[?cid:[^\\s\\]>\"']+\\]?", RegexOptions.IgnoreCase | RegexOptions.Compiled);
    private static readonly Regex AnyWhitespaceRe = new("\\s+", RegexOptions.Compiled);

    public static string ToPlainText(string? html)
    {
        if (string.IsNullOrWhiteSpace(html))
        {
            return string.Empty;
        }

        var withBreaks = BlockBreakRe.Replace(html, "\n");
        var decoded = WebUtility.HtmlDecode(TagRe.Replace(withBreaks, " "));
        var collapsed = LinePadRe.Replace(SpacesRe.Replace(decoded, " "), "\n");
        return EmptyLinesRe.Replace(collapsed, "\n\n").Trim();
    }

    /// <summary>
    /// Превью для строки списка: серверный body_preview иногда содержит сырые
    /// cid:-ссылки на inline-вложения и остатки разметки — чистим в одну строку.
    /// </summary>
    public static string ToPreviewText(string? preview)
    {
        if (string.IsNullOrWhiteSpace(preview))
        {
            return string.Empty;
        }

        var noCid = CidRefRe.Replace(preview, " ");
        var plain = ToPlainText(noCid);
        return AnyWhitespaceRe.Replace(plain, " ").Trim();
    }
}

/// <summary>
/// Порядок стандартных папок — как в веб-почте (STANDARD_ORDER в mailListModel.js).
/// Пользовательские папки идут после, по label.
/// </summary>
internal static class MailFolderOrder
{
    private static readonly string[] StandardOrder =
        ["inbox", "sent", "drafts", "trash", "junk", "archive"];

    public static int RankOf(HubMailFolder folder)
    {
        var key = folder.WellKnownKey ?? folder.Id ?? string.Empty;
        var index = Array.IndexOf(StandardOrder, key);
        return index >= 0 ? index : StandardOrder.Length;
    }
}

/// <summary>
/// Имя отправителя без «&lt;email&gt;»-хвоста: аватар (цвет + инициалы)
/// должен быть стабильным для человека, а не меняться от адреса.
/// </summary>
internal static class MailSenderAvatar
{
    public static string NameOf(string? senderText)
    {
        var text = (senderText ?? string.Empty).Trim();
        var lessThan = text.IndexOf('<');
        if (lessThan > 0)
        {
            text = text[..lessThan].Trim();
        }

        return text.Length > 0 ? text : "?";
    }
}

/// <summary>Папка в левой рейке: label, иконка и бейдж непрочитанных из folder_tree.</summary>
public sealed class MailFolderViewModel : ObservableObject
{
    private int _unread;
    private string _label = string.Empty;
    private bool _isFavorite;
    private bool _isBusy;
    private bool _deleteArmed;
    private bool _isDropTarget;
    private bool _isExpanded = true;
    private bool _isTreeVisible = true;

    public MailFolderViewModel(HubMailFolder folder)
    {
        ArgumentNullException.ThrowIfNull(folder);
        Id = string.IsNullOrWhiteSpace(folder.Id)
            ? folder.WellKnownKey ?? string.Empty
            : folder.Id!;
        WellKnownKey = folder.WellKnownKey ?? string.Empty;
        _label = string.IsNullOrWhiteSpace(folder.Label)
            ? (string.IsNullOrWhiteSpace(folder.Name) ? Id : folder.Name!)
            : folder.Label!;
        IconGlyph = MapIcon(folder.IconKey);
        IconData = MapIconData(folder.IconKey);
        Total = folder.Total;
        _unread = folder.Unread;
        IsCustom = string.IsNullOrWhiteSpace(folder.WellKnownKey);
        Scope = string.IsNullOrWhiteSpace(folder.Scope) ? "mailbox" : folder.Scope!;
        ParentId = folder.ParentId;
        _isFavorite = folder.IsFavorite;
        CanRename = folder.CanRename;
        CanDelete = folder.CanDelete;
        CanCreateChildren = folder.CanCreateChildren;
        SortRank = MailFolderOrder.RankOf(folder);
    }

    /// <summary>Токен для параметра folder в GET /mail/messages.</summary>
    public string Id { get; }
    public string WellKnownKey { get; }

    public string Label
    {
        get => _label;
        private set => SetProperty(ref _label, value);
    }

    public string IconGlyph { get; }

    /// <summary>Векторная иконка папки (Geometry) — наследует цвет темы, как в чате.</summary>
    public Geometry IconData { get; }
    public bool IsCustom { get; }
    public int Total { get; }

    /// <summary>Область дерева (mailbox|archive) — scope тела POST /mail/folders.</summary>
    public string Scope { get; }

    /// <summary>Родитель для POST /mail/folders (вложенная пользовательская папка).</summary>
    public string? ParentId { get; }

    /// <summary>Серверные флаги мутаций (стандартные папки — can_rename/can_delete=false).</summary>
    public bool CanRename { get; }
    public bool CanDelete { get; }
    public bool CanCreateChildren { get; }

    /// <summary>Пункты контекстного меню: rename/delete только у пользовательских папок.</summary>
    public bool ShowRename => IsCustom && CanRename;
    public bool ShowDelete => IsCustom && CanDelete;

    /// <summary>Позиция в рейке — тот же ранг, что у ApplyFolderTree (стандартные, затем по label).</summary>
    internal int SortRank { get; }

    /// <summary>Избранное (is_favorite дерева): тоглит POST /mail/folders/{id}/favorite.</summary>
    public bool IsFavorite
    {
        get => _isFavorite;
        private set
        {
            if (SetProperty(ref _isFavorite, value))
            {
                OnPropertyChanged(nameof(FavoriteText));
            }
        }
    }

    /// <summary>Подпись пункта меню избранного.</summary>
    public string FavoriteText => IsFavorite ? "Убрать из избранного" : "В избранное";

    /// <summary>
    /// Папка под курсором при переносе письма (drag-over): акцентная подсветка
    /// цели drop, как выделение папки в Thunderbird при перетаскивании.
    /// </summary>
    public bool IsDropTarget
    {
        get => _isDropTarget;
        set => SetProperty(ref _isDropTarget, value);
    }

    // ---- Иерархия дерева (parent_id плоской выгрузки /mail/folders/tree) ----

    /// <summary>Глубина в дереве (0 — верхний уровень): отступ строки и chevron.</summary>
    public int Depth { get; internal set; }

    /// <summary>Есть дочерние узлы — показываем chevron раскрытия.</summary>
    public bool HasChildren { get; internal set; }

    /// <summary>Родитель в дереве: для пересчёта видимости при сворачивании.</summary>
    internal MailFolderViewModel? Parent { get; set; }

    /// <summary>Сворачивание узла (сессия, по умолчанию раскрыто — как в TB/Outlook).</summary>
    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            if (SetProperty(ref _isExpanded, value))
            {
                OnPropertyChanged(nameof(ChevronText));
            }
        }
    }

    /// <summary>Показывать ли узел: все предки должны быть раскрыты.</summary>
    public bool IsTreeVisible
    {
        get => _isTreeVisible;
        private set => SetProperty(ref _isTreeVisible, value);
    }

    /// <summary>Отступ строки: +16 за каждый уровень (как indent дерева TB).</summary>
    public double IndentWidth => Depth * 16;

    /// <summary>Глиф chevron (Segoe MDL2): раскрыт — вниз, свёрнут — вправо.</summary>
    public string ChevronText => IsExpanded ? "\uE70D" : "\uE76C";

    internal void UpdateTreeVisibility()
    {
        var visible = true;
        var parent = Parent;
        while (parent is not null && visible)
        {
            visible = parent.IsExpanded;
            parent = parent.Parent;
        }

        IsTreeVisible = visible;
    }

    /// <summary>Оптимистичный тогл избранного из VM (ошибка откатывает назад).</summary>
    internal void SetFavorite(bool favorite) => IsFavorite = favorite;

    /// <summary>Идёт мутация папки — повторные клики пунктов меню игнорируем.</summary>
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

    /// <summary>Кнопки действий строки активны (обёртка !IsBusy для XAML без конвертера).</summary>
    public bool AreActionsEnabled => !IsBusy;

    /// <summary>Первый клик «Удалить» в меню взводит подтверждение; второй — удаляет.</summary>
    public bool DeleteArmed
    {
        get => _deleteArmed;
        internal set
        {
            if (SetProperty(ref _deleteArmed, value))
            {
                OnPropertyChanged(nameof(DeleteText));
            }
        }
    }

    public string DeleteText => DeleteArmed ? "Точно удалить?" : "Удалить";

    /// <summary>Свежий узел после rename/favorite — подпись и флаги из ответа сервера.</summary>
    internal void ApplyFolderNode(HubMailFolder folder)
    {
        ArgumentNullException.ThrowIfNull(folder);
        Label = string.IsNullOrWhiteSpace(folder.Label)
            ? (string.IsNullOrWhiteSpace(folder.Name) ? Label : folder.Name!)
            : folder.Label!;
        IsFavorite = folder.IsFavorite;
        SetUnread(folder.Unread);
    }

    public int Unread
    {
        get => _unread;
        private set
        {
            if (SetProperty(ref _unread, value))
            {
                OnPropertyChanged(nameof(HasUnread));
                OnPropertyChanged(nameof(UnreadBadgeText));
                OnPropertyChanged(nameof(AccessibleName));
            }
        }
    }

    public bool HasUnread => Unread > 0;
    public string UnreadBadgeText => Unread > 99 ? "99+" : Unread.ToString(CultureInfo.InvariantCulture);

    /// <summary>Имя строки для скринридера: «Входящие, 12 непрочитанных».</summary>
    public string AccessibleName => HasUnread ? $"{Label}, {Unread} непрочитанных" : Label;

    /// <summary>Имя шеврона раскрытия: привязка к конкретной папке.</summary>
    public string ExpanderAccessibleName => $"Развернуть или свернуть вложенные папки: {Label}";

    /// <summary>Мягкий счётчик писем папки в рейке; пустая папка место не занимает.</summary>
    public string TotalText => Total > 0 ? Total.ToString(CultureInfo.InvariantCulture) : string.Empty;

    /// <summary>Локальная отметка прочтения: уменьшает бейдж (серверное значение придёт при refresh).</summary>
    public void DecrementUnread() => Unread = Math.Max(0, Unread - 1);

    public void IncrementUnread() => Unread += 1;

    public void SetUnread(int value) => Unread = Math.Max(0, value);

    internal static string MapIcon(string? iconKey) => iconKey switch
    {
        "inbox" => "📥",
        "send" or "sent" => "📤",
        "drafts" => "📝",
        "trash" => "🗑",
        "junk" => "⚠",
        "archive" => "🗄",
        _ => "📁",
    };

    internal static Geometry MapIconData(string? iconKey) => iconKey switch
    {
        "inbox" => VectorIcons.Archive,
        "send" or "sent" => VectorIcons.Send,
        "drafts" => VectorIcons.Edit,
        "trash" => VectorIcons.Trash,
        "junk" => VectorIcons.Warning,
        "archive" => VectorIcons.InventoryBox,
        _ => VectorIcons.Folder,
    };
}

/// <summary>
/// Элемент списка писем: отправитель, тема, превью, дата, флаги.
/// Непрочитанное выделено точкой и жирным шрифтом, как в веб-списке.
/// </summary>
public sealed class MailListItemViewModel : ObservableObject
{
    private bool _isUnread;
    private bool _isChecked;
    private bool _isImportant;

    public MailListItemViewModel(HubMailMessagePreview item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id ?? string.Empty;
        MailboxId = item.MailboxId;
        Folder = item.Folder ?? string.Empty;
        Subject = string.IsNullOrWhiteSpace(item.Subject) ? "(без темы)" : item.Subject!;
        SenderText = string.IsNullOrWhiteSpace(item.SenderDisplay)
            ? (string.IsNullOrWhiteSpace(item.Sender) ? "Неизвестный отправитель" : item.Sender!)
            : item.SenderDisplay!;
        Preview = MailHtmlText.ToPreviewText(item.BodyPreview);
        DateText = FormatListDate(item.ReceivedAt);
        _isUnread = !item.IsRead;
        HasAttachments = item.HasAttachments || item.AttachmentsCount > 0;
        AttachmentsText = item.AttachmentsCount > 0 ? $"📎 {item.AttachmentsCount}" : (HasAttachments ? "📎" : string.Empty);
        _isImportant = string.Equals(item.Importance, "high", StringComparison.OrdinalIgnoreCase);
        DateGroup = ComputeDateGroup(item.ReceivedAt);
    }

    public string Id { get; }
    public string? MailboxId { get; }
    public string Folder { get; }
    public string Subject { get; }
    public string SenderText { get; }
    public string Preview { get; }
    public string DateText { get; }
    public bool HasAttachments { get; }
    public string AttachmentsText { get; }

    /// <summary>
    /// Ключ группировки списка по датам (Outlook): «0|Сегодня», «1|Вчера»…
    /// Префикс-номер задаёт порядок групп (WPF сортирует имена как строки),
    /// заголовок группы отрезает его (MailGroupHeaderConverter).
    /// </summary>
    public string DateGroup { get; }

    /// <summary>«!»-пилюля важности в строке списка (importance=high).</summary>
    public bool IsImportant
    {
        get => _isImportant;
        private set
        {
            if (SetProperty(ref _isImportant, value))
            {
                OnPropertyChanged(nameof(StarText));
                OnPropertyChanged(nameof(AccessibleName));
            }
        }
    }

    /// <summary>Глиф звезды-флага строки: заполненная у важного, контур у обычного (как button-star в Thunderbird).</summary>
    public string StarText => IsImportant ? "★" : "☆";

    /// <summary>Имя строки для скринридера; без него UIA объявляет имя типа VM.</summary>
    public string AccessibleName =>
        $"{SenderText}: {Subject}, {DateText}"
        + (IsUnread ? ", непрочитанное" : string.Empty)
        + (HasAttachments ? ", с вложением" : string.Empty)
        + (IsImportant ? ", важное" : string.Empty);

    /// <summary>Имя чекбокса массового выбора: одинаковая подпись на всех строках
    /// не даёт скринридеру понять, какое письмо выбирается.</summary>
    public string CheckBoxAccessibleName => $"Выбрать письмо: {Subject}";

    /// <summary>Имя кнопки-звезды строки — с привязкой к теме письма.</summary>
    public string StarAccessibleName => $"Переключить важность: {Subject}";

    /// <summary>Имя кнопки «…» строки — с привязкой к теме письма.</summary>
    public string MenuAccessibleName => $"Меню письма: {Subject}";

    /// <summary>Оптимистичный тогл важности из панели чтения (ошибка откатывает).</summary>
    internal void SetImportant(bool important) => IsImportant = important;

    public bool IsUnread
    {
        get => _isUnread;
        private set
        {
            if (SetProperty(ref _isUnread, value))
            {
                OnPropertyChanged(nameof(ToggleReadItemText));
                OnPropertyChanged(nameof(AccessibleName));
            }
        }
    }

    /// <summary>Подпись kebab-меню строки: отметить прочитанным или непрочитанным.</summary>
    public string ToggleReadItemText => IsUnread ? "Пометить прочитанным" : "Пометить непрочитанным";

    /// <summary>Чекбокс массового выделения (bulk-панель над списком).</summary>
    public bool IsChecked
    {
        get => _isChecked;
        set => SetProperty(ref _isChecked, value);
    }

    /// <summary>Локальная отметка прочтения; серверная операция делается отдельно.</summary>
    public void MarkRead() => IsUnread = false;

    /// <summary>Вернуть флаг «непрочитано» после POST /unread.</summary>
    public void MarkUnread() => IsUnread = true;

    /// <summary>Сегодня — «HH:mm», в этом году — «dd.MM», иначе «dd.MM.yyyy».</summary>
    internal static string FormatListDate(string? receivedAt)
    {
        if (!DateTimeOffset.TryParse(
                receivedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return string.Empty;
        }

        var local = parsed.ToLocalTime();
        var now = DateTime.Now;
        if (local.Date == now.Date)
        {
            return local.ToString("HH:mm", CultureInfo.CurrentCulture);
        }

        return local.Year == now.Year
            ? local.ToString("dd.MM", CultureInfo.CurrentCulture)
            : local.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture);
    }

    /// <summary>
    /// Ключ группы дат Outlook-стиля. Префиксы гарантируют хронологический
    /// порядок групп при строковой сортировке имён CollectionView.
    /// </summary>
    internal static string ComputeDateGroup(string? receivedAt)
    {
        if (!DateTimeOffset.TryParse(
                receivedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed))
        {
            return "4|Ранее";
        }

        var local = parsed.ToLocalTime();
        var now = DateTime.Now;
        if (local.Date == now.Date)
        {
            return "0|Сегодня";
        }

        if (local.Date == now.AddDays(-1).Date)
        {
            return "1|Вчера";
        }

        if (local.Date > now.Date.AddDays(-7))
        {
            return "2|Ранее на этой неделе";
        }

        if (local.Year == now.Year && local.Month == now.Month)
        {
            return "3|Ранее в этом месяце";
        }

        return "4|Ранее";
    }

    internal static string FormatFullDate(string? receivedAt) =>
        DateTimeOffset.TryParse(receivedAt, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed)
            ? parsed.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : string.Empty;
}

/// <summary>
/// Чип вложения в панели чтения: имя+размер, клик — скачивание в temp и открытие.
/// Ref — токен для GET …/attachments/{ref} (download_token, fallback — id).
/// </summary>
public sealed class MailAttachmentItemViewModel : ObservableObject
{
    private bool _isDownloading;

    public MailAttachmentItemViewModel(HubMailAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        Model = attachment;
        Ref = string.IsNullOrWhiteSpace(attachment.DownloadToken)
            ? attachment.Id ?? string.Empty
            : attachment.DownloadToken!;
        Name = string.IsNullOrWhiteSpace(attachment.Name) ? "вложение" : attachment.Name!;
        SizeText = FormatSize(attachment.Size);
    }

    /// <summary>Исходная DTO — для размера при проверке кэша скачанного.</summary>
    public HubMailAttachment Model { get; }
    public string Ref { get; }
    public string Name { get; }
    public string? SizeText { get; }
    public string DownloadText => IsDownloading ? "Скачиваем…" : Name;

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(DownloadText));
            }
        }
    }

    internal static string? FormatSize(long bytes) =>
        bytes <= 0 ? null : bytes switch
        {
            < 1024 => $"{bytes} Б",
            < 1024 * 1024 => $"{bytes / 1024.0:0.#} КБ",
            < 1024L * 1024 * 1024 => $"{bytes / (1024.0 * 1024):0.#} МБ",
            _ => $"{bytes / (1024.0 * 1024 * 1024):0.#} ГБ",
        };
}

/// <summary>Чип локального файла в композере (ещё не отправлен — путь на диске).</summary>
public sealed class MailComposeAttachmentViewModel
{
    public MailComposeAttachmentViewModel(string path)
    {
        Path = path;
        Name = string.IsNullOrWhiteSpace(path) ? "файл" : System.IO.Path.GetFileName(path);
        long size = -1;
        try
        {
            var info = new FileInfo(path);
            if (info.Exists)
            {
                size = info.Length;
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or ArgumentException)
        {
        }

        Size = size;
        SizeText = MailAttachmentItemViewModel.FormatSize(Math.Max(0, size));
    }

    public string Path { get; }
    public string Name { get; }
    public long Size { get; }
    public string? SizeText { get; }
}

/// <summary>
/// Подсказка контакта под полем адресатов композера (ответ GET /mail/contacts).
/// Name может совпадать с адресом (GAL без имени) — тогда показываем только email.
/// </summary>
public sealed class MailContactSuggestionViewModel
{
    public MailContactSuggestionViewModel(HubMailContact contact)
    {
        ArgumentNullException.ThrowIfNull(contact);
        Email = contact.Email?.Trim() ?? string.Empty;
        var name = contact.Name?.Trim() ?? string.Empty;
        Name = name.Length > 0 && !name.Equals(Email, StringComparison.OrdinalIgnoreCase)
            ? name
            : string.Empty;
    }

    public string Email { get; }
    public string Name { get; }
    public bool HasName => Name.Length > 0;
    public string DisplayText => HasName ? $"{Name} — {Email}" : Email;

    /// <summary>Формат «Имя <addr@dom>» — как чип получателя в веб-композере.</summary>
    public string AddressToken => HasName ? $"{Name} <{Email}>" : Email;
}

/// <summary>Панель чтения письма: отправитель, адресаты, дата, текст и вложения.</summary>
public sealed class MailDetailViewModel : ObservableObject
{
    private bool _isUnread;
    private bool _isActionBusy;
    private bool _areHeadersVisible;
    private bool _isHeadersLoading;
    private string _headersText = string.Empty;
    private string _headersSourceName = string.Empty;

    public MailDetailViewModel(HubMailMessageDetail item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Update(item);
    }

    public string Id { get; private set; } = string.Empty;
    public string? MailboxId { get; private set; }
    public string Folder { get; private set; } = string.Empty;
    public string Subject { get; private set; } = string.Empty;
    public string SenderText { get; private set; } = string.Empty;
    public string SenderEmail { get; private set; } = string.Empty;
    public string ToText { get; private set; } = string.Empty;
    public string CcText { get; private set; } = string.Empty;
    public string DateText { get; private set; } = string.Empty;
    public string Body { get; private set; } = string.Empty;
    public bool HasBody => Body.Length > 0;
    /// <summary>
    /// HTML-версия тела (body_html) — ридер показывает её в изолированном
    /// WebView2; при сбое/отсутствии рантайма виден текстовый fallback (Body).
    /// </summary>
    public string BodyHtml { get; private set; } = string.Empty;
    public bool HasBodyHtml => BodyHtml.Length > 0;
    /// <summary>Тело не пусто (текст или html) — плашка «отсутствует» лишь когда пусто совсем.</summary>
    public bool HasAnyBody => HasBody || HasBodyHtml;

    /// <summary>
    /// Показывать ли plain-text fallback: только когда нет HTML-версии.
    /// Если есть body_html, WebView2 рендерит письмо и TextBlock не нужен —
    /// иначе белый фон HWND перекрывает текст снизу (P0-дефект).
    /// </summary>
    public bool ShowPlainTextBody => HasBody && !HasBodyHtml;
    public string AttachmentsText { get; private set; } = string.Empty;
    public string AttachmentNamesText { get; private set; } = string.Empty;

    /// <summary>Инициалы отправителя для серого круга-аватара в шапке письма (как recipient-avatar в Thunderbird).</summary>
    public string AvatarInitials { get; private set; } = "•";

    /// <summary>Скачиваемые не-inline вложения — чипы в панели чтения.</summary>
    public IReadOnlyList<MailAttachmentItemViewModel> Attachments { get; private set; } = [];

    /// <summary>
    /// Есть ли чипы вложений: AttachmentsText считает и inline-картинки
    /// (подписи cid:), поэтому секция «Вложения» должна зависеть от чипов,
    /// иначе заголовок висел бы над пустым списком.
    /// </summary>
    public bool HasVisibleAttachments => Attachments.Count > 0;

    /// <summary>Префилл композера от backend (reply/reply_all/forward); null у старых ответов.</summary>
    public HubMailComposeContext? ComposeContext { get; private set; }

    /// <summary>draft_context черновика — для передачи ссылок при повторном сохранении.</summary>
    public HubMailDraftContext? DraftContext { get; private set; }

    /// <summary>Число не-inline вложений (для подсказки пересылки «будут приложены»).</summary>
    public int ForwardableAttachmentCount { get; private set; }

    /// <summary>Письмо — черновик (есть draft_context): показываем «Редактировать».</summary>
    public bool IsDraft => DraftContext is not null;

    public bool IsImportant { get; private set; }
    public string ImportanceText => IsImportant ? "Важно" : string.Empty;
    /// <summary>Подпись кнопки-тогла важности в панели действий (как ToggleReadButtonText).</summary>
    public string ImportanceToggleText => IsImportant ? "Снять важность" : "Важное";
    public bool CanMove { get; private set; }

    /// <summary>Оптимистичный тогл важности: пилюля и кнопка обновятся; ошибка откатывает.</summary>
    internal void SetImportant(bool important)
    {
        if (IsImportant == important)
        {
            return;
        }

        IsImportant = important;
        OnPropertyChanged(nameof(IsImportant));
        OnPropertyChanged(nameof(ImportanceText));
        OnPropertyChanged(nameof(ImportanceToggleText));
    }

    public bool IsUnread
    {
        get => _isUnread;
        private set
        {
            if (SetProperty(ref _isUnread, value))
            {
                OnPropertyChanged(nameof(ToggleReadButtonText));
            }
        }
    }

    /// <summary>Идёт мутация read/unread/delete — действия временно блокируются.</summary>
    public bool IsActionBusy
    {
        get => _isActionBusy;
        set
        {
            if (SetProperty(ref _isActionBusy, value))
            {
                OnPropertyChanged(nameof(CanRunActions));
            }
        }
    }

    public bool CanRunActions => !IsActionBusy;

    public string ToggleReadButtonText => IsUnread ? "Пометить прочитанным" : "Пометить непрочитанным";

    // ---- Полные заголовки («показать детали», как в Gmail) ----

    public bool AreHeadersVisible
    {
        get => _areHeadersVisible;
        private set
        {
            if (SetProperty(ref _areHeadersVisible, value))
            {
                OnPropertyChanged(nameof(HeadersToggleText));
            }
        }
    }

    public bool IsHeadersLoading
    {
        get => _isHeadersLoading;
        private set => SetProperty(ref _isHeadersLoading, value);
    }

    /// <summary>Моноширинный список «Name: value» построчно; грузится один раз и кэшируется.</summary>
    public string HeadersText
    {
        get => _headersText;
        private set => SetProperty(ref _headersText, value);
    }

    /// <summary>Имя исходного файла письма (source_name) — подпись блока заголовков.</summary>
    public string HeadersSourceName
    {
        get => _headersSourceName;
        private set => SetProperty(ref _headersSourceName, value);
    }

    public string HeadersToggleText => AreHeadersVisible ? "Скрыть заголовки" : "Показать заголовки";

    internal void SetHeadersVisible(bool visible) => AreHeadersVisible = visible;

    internal void SetHeadersLoading(bool loading) => IsHeadersLoading = loading;

    internal void SetHeaders(string text, string sourceName)
    {
        HeadersText = text;
        HeadersSourceName = sourceName;
    }

    public void MarkRead() => IsUnread = false;

    public void MarkUnread() => IsUnread = true;

    public void Update(HubMailMessageDetail item)
    {
        Id = item.Id ?? string.Empty;
        MailboxId = item.MailboxId;
        Folder = item.Folder ?? string.Empty;
        Subject = string.IsNullOrWhiteSpace(item.Subject) ? "(без темы)" : item.Subject!;
        SenderText = string.IsNullOrWhiteSpace(item.SenderDisplay)
            ? (string.IsNullOrWhiteSpace(item.Sender) ? "Неизвестный отправитель" : item.Sender!)
            : item.SenderDisplay!;
        SenderEmail = item.SenderEmail ?? item.Sender ?? string.Empty;
        AvatarInitials = ChatPeerPalette.Initials(MailSenderAvatar.NameOf(SenderText));
        ToText = JoinAddresses(item.To, item.ToPeople);
        CcText = JoinAddresses(item.Cc, item.CcPeople);
        DateText = MailListItemViewModel.FormatFullDate(item.ReceivedAt);
        BodyHtml = string.IsNullOrWhiteSpace(item.BodyHtml) ? string.Empty : item.BodyHtml!;
        Body = ResolveBody(item);
        var attachments = item.Attachments ?? [];
        var visible = attachments.Where(a => !a.IsInline).ToList();
        var count = visible.Count > 0 ? visible.Count : attachments.Count;
        AttachmentsText = count > 0 ? $"📎 {count}" : string.Empty;
        AttachmentNamesText = visible.Count > 0
            ? string.Join("\n", visible.Select(a => a.Name ?? "вложение"))
            : string.Empty;
        Attachments = visible
            .Where(a => a.Downloadable && !string.IsNullOrWhiteSpace(a.DownloadToken ?? a.Id))
            .Select(a => new MailAttachmentItemViewModel(a))
            .ToList();
        ForwardableAttachmentCount = visible.Count;
        ComposeContext = item.ComposeContext;
        DraftContext = item.DraftContext;
        IsImportant = string.Equals(item.Importance, "high", StringComparison.OrdinalIgnoreCase);
        CanMove = item.CanMove;
        _isUnread = !item.IsRead;
        OnPropertyChanged(string.Empty);
    }

    private static string JoinAddresses(
        IReadOnlyList<string>? addresses,
        IReadOnlyList<HubMailPerson>? people)
    {
        var display = people?
            .Select(p => string.IsNullOrWhiteSpace(p.Display) ? p.Email : p.Display)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToList();
        if (display is { Count: > 0 })
        {
            return string.Join(", ", display!);
        }

        return addresses is { Count: > 0 } ? string.Join(", ", addresses) : string.Empty;
    }

    /// <summary>body_text готовится backend'ом; если его нет — грубо чистим body_html.</summary>
    private static string ResolveBody(HubMailMessageDetail item)
    {
        if (!string.IsNullOrWhiteSpace(item.BodyText))
        {
            return item.BodyText!;
        }

        if (string.IsNullOrWhiteSpace(item.BodyHtml))
        {
            return string.Empty;
        }

        return MailHtmlText.ToPlainText(item.BodyHtml);
    }
}

/// <summary>
/// Панель композера: Кому/Копия/Скрытая/Тема/Тело (plain text, is_html=false),
/// локальные файлы-вложения, отправка через send/send-multipart и «В черновик»
/// (drafts/upsert-multipart). Reply/forward-ссылки хранятся как id исходного письма —
/// цитату и серверные вложения прикладывает backend. Ошибка отправки полей не стирает.
/// </summary>
public sealed class MailComposeViewModel : ObservableObject
{
    private static readonly Regex RecipientSplitRe = new("[;,\\n]+", RegexOptions.Compiled);
    private static readonly char[] RecipientSeparatorChars = [';', ',', '\n'];
    private static readonly Regex EmailRe = new("^[^\\s@]+@[^\\s@]+$", RegexOptions.Compiled);
    private static readonly Regex DisplayAddressRe = new("<([^>]+)>", RegexOptions.Compiled);

    /// <summary>Debounce подсказок контактов — как UserSearchDebounce у чата.</summary>
    private static readonly TimeSpan ContactSearchDebounce = TimeSpan.FromMilliseconds(350);

    private readonly IHubApiClient _api;
    private readonly Func<string?> _mailboxIdProvider;
    private readonly Func<IReadOnlyList<string>>? _filePicker;

    private string _mode = "new";
    private string _title = "Новое письмо";
    private string _to = string.Empty;
    private string _cc = string.Empty;
    private string _bcc = string.Empty;
    private string _subject = string.Empty;
    private string _body = string.Empty;
    private string? _draftId;
    private string? _replyToMessageId;
    private string? _forwardMessageId;
    private string? _fromMailboxId;
    private IReadOnlyList<string>? _retainExistingAttachments;
    private string _retainedAttachmentsText = string.Empty;
    private bool _isSending;
    private bool _isSavingDraft;
    private bool _isDeletingDraft;
    private string? _errorText;
    private string _idempotencyKey = Guid.NewGuid().ToString("N");
    private CancellationTokenSource? _contactSearchCancellation;
    private string _suggestionField = "to";
    private bool _isContactPopupOpen;

    public MailComposeViewModel(
        IHubApiClient api,
        Func<string?> mailboxIdProvider,
        Func<IReadOnlyList<string>>? filePicker)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _mailboxIdProvider = mailboxIdProvider ?? throw new ArgumentNullException(nameof(mailboxIdProvider));
        _filePicker = filePicker;

        SendCommand = new NativeAsyncCommand(
            (_, ct) => SendAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSend);
        SaveDraftCommand = new NativeAsyncCommand(
            (_, ct) => SaveDraftAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsSending && !IsSavingDraft && !IsDeletingDraft);
        DeleteDraftCommand = new NativeAsyncCommand(
            (_, ct) => DeleteDraftAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsSending && !IsSavingDraft && !IsDeletingDraft && HasDraft);
        AttachCommand = new NativeAsyncCommand(
            (_, _) =>
            {
                AddFiles(_filePicker?.Invoke() ?? []);
                return Task.CompletedTask;
            },
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsSending);
        RemoveAttachmentCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MailComposeAttachmentViewModel attachment)
            {
                Attachments.Remove(attachment);
            }
        });
        ApplyContactSuggestionCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MailContactSuggestionViewModel suggestion)
            {
                ApplyContactSuggestion(suggestion);
            }
        });
        CloseCommand = new NativeRelayCommand(() => Closed?.Invoke(this, EventArgs.Empty));
    }

    /// <summary>Успешная отправка (result от /mail/messages/send*).</summary>
    public event EventHandler<HubMailSendResult>? Sent;

    /// <summary>Черновик сохранён (result от drafts/upsert-multipart).</summary>
    public event EventHandler<HubMailDraftSaveResult>? DraftSaved;

    /// <summary>
    /// Серверный черновик удалён (DELETE /mail/drafts/{id}) —
    /// родитель закрывает панель и убирает строку из списка.
    /// </summary>
    public event EventHandler? DraftDeleted;

    /// <summary>
    /// Подсказка подставлена в поле (аргумент — "to"|"cc"|"bcc"):
    /// view возвращает фокус в поле и каретку в конец.
    /// </summary>
    internal event Action<string>? SuggestionApplied;

    /// <summary>Закрытие панели (кнопка ✕ или после отправки — решает родитель).</summary>
    public event EventHandler? Closed;

    /// <summary>new|reply|reply_all|forward — режим композера (заголовок и draft compose_mode).</summary>
    public string Mode
    {
        get => _mode;
        set
        {
            if (SetProperty(ref _mode, value))
            {
                Title = value switch
                {
                    "reply" => "Ответ",
                    "reply_all" => "Ответ всем",
                    "forward" => "Пересылка",
                    "draft" => "Черновик",
                    _ => "Новое письмо",
                };
            }
        }
    }

    public string Title
    {
        get => _title;
        private set => SetProperty(ref _title, value);
    }

    /// <summary>Адреса «Кому» через «;»/«,»/перевод строки — форма multipart и JSON to[].</summary>
    public string To
    {
        get => _to;
        set
        {
            if (SetProperty(ref _to, value))
            {
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string Cc
    {
        get => _cc;
        set => SetProperty(ref _cc, value);
    }

    public string Bcc
    {
        get => _bcc;
        set => SetProperty(ref _bcc, value);
    }

    public string Subject
    {
        get => _subject;
        set => SetProperty(ref _subject, value);
    }

    public string Body
    {
        get => _body;
        set => SetProperty(ref _body, value);
    }

    /// <summary>Локальные файлы, приложенные через «📎» (отправляются в send-multipart).</summary>
    public ObservableCollection<MailComposeAttachmentViewModel> Attachments { get; } = [];

    public bool HasAttachments => Attachments.Count > 0;

    /// <summary>Подсказка о серверных вложениях исходного письма (пересылка/черновик).</summary>
    public string RetainedAttachmentsText
    {
        get => _retainedAttachmentsText;
        private set
        {
            if (SetProperty(ref _retainedAttachmentsText, value))
            {
                OnPropertyChanged(nameof(HasRetainedAttachments));
            }
        }
    }

    public bool HasRetainedAttachments => !string.IsNullOrEmpty(RetainedAttachmentsText);

    /// <summary>id исходного письма для ответа (reply_to_message_id).</summary>
    internal string? ReplyToMessageId
    {
        get => _replyToMessageId;
        set => _replyToMessageId = value;
    }

    /// <summary>id исходного письма для пересылки (forward_message_id).</summary>
    internal string? ForwardMessageId
    {
        get => _forwardMessageId;
        set => _forwardMessageId = value;
    }

    /// <summary>id сохранённого черновика (draft_id) — бэкенд удалит его после отправки.</summary>
    internal string? DraftId
    {
        get => _draftId;
        set
        {
            if (_draftId != value)
            {
                _draftId = value;
                OnPropertyChanged(nameof(HasDraft));
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Ящик-отправитель из compose_context (null — текущий ящик страницы).</summary>
    internal string? FromMailboxId
    {
        get => _fromMailboxId;
        set => _fromMailboxId = value;
    }

    /// <summary>retain_existing_attachments — токены вложений серверного черновика.</summary>
    internal IReadOnlyList<string>? RetainExistingAttachments
    {
        get => _retainExistingAttachments;
        set => _retainExistingAttachments = value;
    }

    public bool IsSending
    {
        get => _isSending;
        private set
        {
            if (SetProperty(ref _isSending, value))
            {
                OnPropertyChanged(nameof(CanSend));
                OnPropertyChanged(nameof(SendButtonText));
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)SaveDraftCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)AttachCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool IsSavingDraft
    {
        get => _isSavingDraft;
        private set
        {
            if (SetProperty(ref _isSavingDraft, value))
            {
                OnPropertyChanged(nameof(CanSend));
                OnPropertyChanged(nameof(SaveDraftButtonText));
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)SaveDraftCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Идёт DELETE /mail/drafts/{id} — поля и действия композера блокируются.</summary>
    public bool IsDeletingDraft
    {
        get => _isDeletingDraft;
        private set
        {
            if (SetProperty(ref _isDeletingDraft, value))
            {
                OnPropertyChanged(nameof(CanSend));
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)SaveDraftCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Композер связан с серверным черновиком — показываем «Удалить черновик».</summary>
    public bool HasDraft => !string.IsNullOrWhiteSpace(_draftId);

    public bool CanSend =>
        !IsSending && !IsSavingDraft && !IsDeletingDraft && ParseRecipients(To).Count > 0;

    public string SendButtonText => IsSending ? "Отправляем…" : "Отправить";

    public string SaveDraftButtonText => IsSavingDraft ? "Сохраняем…" : "В черновик";

    /// <summary>Ошибка отправки/сохранения — плашка внутри композера, поля не стираются.</summary>
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

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public ICommand SendCommand { get; }
    public ICommand SaveDraftCommand { get; }
    public ICommand DeleteDraftCommand { get; }
    public ICommand AttachCommand { get; }
    public ICommand RemoveAttachmentCommand { get; }
    public ICommand ApplyContactSuggestionCommand { get; }
    public ICommand CloseCommand { get; }

    // ---- Подсказки контактов (GET /mail/contacts) ----

    /// <summary>Текущие подсказки под полем адресатов (пусто — popup закрыт).</summary>
    public ObservableCollection<MailContactSuggestionViewModel> ContactSuggestions { get; } = [];

    /// <summary>
    /// Popup подсказок открыт. TwoWay: самозакрытие popup (клик вне) пишет false
    /// обратно — тогда очищаем список.
    /// </summary>
    public bool IsContactPopupOpen
    {
        get => _isContactPopupOpen;
        set
        {
            if (SetProperty(ref _isContactPopupOpen, value) && !value)
            {
                ContactSuggestions.Clear();
            }
        }
    }

    /// <summary>Поле, чей последний токен дополняется ("to"|"cc"|"bcc") — для возврата фокуса.</summary>
    internal string SuggestionField => _suggestionField;

    /// <summary>Добавить локальные файлы; недоступные/дубли — с подсказкой, без падения.</summary>
    internal void AddFiles(IReadOnlyList<string> paths)
    {
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path)
                || Attachments.Any(a => string.Equals(a.Path, path, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var attachment = new MailComposeAttachmentViewModel(path);
            if (attachment.Size < 0)
            {
                ErrorText = $"Файл «{attachment.Name}» не найден или недоступен.";
                continue;
            }

            Attachments.Add(attachment);
            OnPropertyChanged(nameof(HasAttachments));
        }
    }

    /// <summary>Подсказка «вложения исходного письма» (пересылка без явного списка refs).</summary>
    internal void SetRetainedAttachmentsHint(int count) => RetainedAttachmentsText = count > 0
        ? $"Вложения исходного письма будут приложены ({count})"
        : string.Empty;

    /// <summary>Подсказка «сохранённые на сервере вложения черновика».</summary>
    internal void SetServerAttachmentsNote(int count) => RetainedAttachmentsText = count > 0
        ? $"Сохранённые вложения черновика ({count}) — будут оставлены"
        : string.Empty;

    internal static List<string> ParseRecipients(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        var result = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in RecipientSplitRe.Split(raw))
        {
            var text = part.Trim();
            if (text.Length == 0)
            {
                continue;
            }

            // «Имя <addr@dom>» → addr@dom (как normalizeMailRecipient в вебе).
            var match = DisplayAddressRe.Match(text);
            var email = (match.Success ? match.Groups[1].Value : text).Trim();
            if (email.Length > 0 && seen.Add(email))
            {
                result.Add(email);
            }
        }

        return result;
    }

    private string? FirstInvalidRecipient(List<string> to, List<string> cc, List<string> bcc) =>
        to.Concat(cc).Concat(bcc).FirstOrDefault(email => !EmailRe.IsMatch(email));

    private HubMailSendRequest BuildRequest(
        List<string> to,
        List<string> cc,
        List<string> bcc) =>
        new()
        {
            FromMailboxId = _fromMailboxId ?? _mailboxIdProvider(),
            To = to,
            Cc = cc,
            Bcc = bcc,
            Subject = Subject,
            Body = Body,
            IsHtml = false,
            ReplyToMessageId = _replyToMessageId,
            ForwardMessageId = _forwardMessageId,
            DraftId = _draftId,
            ComposeMode = _mode,
            RetainExistingAttachments = _retainExistingAttachments,
            IdempotencyKey = _idempotencyKey,
        };

    /// <summary>Чтение файлов вложений в память; null — ошибка уже в ErrorText.</summary>
    private async Task<IReadOnlyList<HubMailOutgoingAttachment>?> ReadAttachmentFilesAsync(
        CancellationToken cancellationToken)
    {
        if (Attachments.Count == 0)
        {
            return null;
        }

        var files = new List<HubMailOutgoingAttachment>(Attachments.Count);
        foreach (var attachment in Attachments)
        {
            try
            {
                var bytes = await File.ReadAllBytesAsync(attachment.Path, cancellationToken);
                files.Add(new HubMailOutgoingAttachment
                {
                    FileName = attachment.Name,
                    ContentType = GuessMimeType(System.IO.Path.GetExtension(attachment.Path)),
                    Content = bytes,
                });
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                ErrorText = $"Нет доступа к файлу «{attachment.Name}».";
                return null;
            }
        }

        return files;
    }

    internal async Task SendAsync(CancellationToken cancellationToken)
    {
        if (IsSending)
        {
            return;
        }

        ErrorText = null;
        var to = ParseRecipients(To);
        var cc = ParseRecipients(Cc);
        var bcc = ParseRecipients(Bcc);
        if (to.Count == 0)
        {
            ErrorText = "Укажите получателя в поле «Кому».";
            return;
        }

        var invalid = FirstInvalidRecipient(to, cc, bcc);
        if (invalid is not null)
        {
            ErrorText = $"Некорректный адрес: «{invalid}».";
            return;
        }

        IsSending = true;
        try
        {
            var files = await ReadAttachmentFilesAsync(cancellationToken);
            if (Attachments.Count > 0 && files is null)
            {
                return;
            }

            var result = await _api.SendMailMessageAsync(
                BuildRequest(to, cc, bcc), files, cancellationToken);
            if (!result.Ok)
            {
                ErrorText = "Письмо не отправлено.";
                return;
            }

            _idempotencyKey = Guid.NewGuid().ToString("N");
            Sent?.Invoke(this, result);
        }
        finally
        {
            IsSending = false;
        }
    }

    internal async Task SaveDraftAsync(CancellationToken cancellationToken)
    {
        if (IsSavingDraft || IsSending)
        {
            return;
        }

        ErrorText = null;
        IsSavingDraft = true;
        try
        {
            var files = await ReadAttachmentFilesAsync(cancellationToken);
            if (Attachments.Count > 0 && files is null)
            {
                return;
            }

            var result = await _api.SaveMailDraftAsync(
                BuildRequest(ParseRecipients(To), ParseRecipients(Cc), ParseRecipients(Bcc)),
                files,
                cancellationToken);
            if (!result.Ok)
            {
                ErrorText = "Черновик не сохранён.";
                return;
            }

            if (!string.IsNullOrWhiteSpace(result.DraftId) && _draftId != result.DraftId)
            {
                _draftId = result.DraftId;
                OnPropertyChanged(nameof(HasDraft));
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
            }

            DraftSaved?.Invoke(this, result);
        }
        finally
        {
            IsSavingDraft = false;
        }
    }

    /// <summary>
    /// DELETE /mail/drafts/{id} для серверного черновика композера.
    /// Успех — событие DraftDeleted (панель закроет родитель).
    /// </summary>
    internal async Task DeleteDraftAsync(CancellationToken cancellationToken)
    {
        if (IsDeletingDraft || IsSending || IsSavingDraft || _draftId is not { Length: > 0 } draftId)
        {
            return;
        }

        ErrorText = null;
        IsDeletingDraft = true;
        try
        {
            var result = await _api.DeleteMailDraftAsync(
                draftId, _fromMailboxId ?? _mailboxIdProvider(), cancellationToken);
            if (!result.Ok)
            {
                ErrorText = "Черновик не удалён.";
                return;
            }

            DraftDeleted?.Invoke(this, EventArgs.Empty);
        }
        finally
        {
            IsDeletingDraft = false;
        }
    }

    /// <summary>
    /// Ввод в поле адресатов (view зовёт из TextChanged сфокусированного поля):
    /// debounce → GET /mail/contacts по последнему токену поля
    /// (от 2 символов — порог backend'а и веб-композера).
    /// </summary>
    internal void ScheduleContactSuggestions(string field)
    {
        _suggestionField = field is "cc" or "bcc" ? field : "to";
        var token = CurrentRecipientToken();
        if (token.Length < 2)
        {
            CloseContactSuggestions();
            return;
        }

        _contactSearchCancellation?.Cancel();
        var cancellation = _contactSearchCancellation = new CancellationTokenSource();
        _ = SearchContactsDebouncedAsync(token, cancellation);
    }

    /// <summary>Токен под кареткой в конце активного поля (после последнего «;», «,» или переноса).</summary>
    private string CurrentRecipientToken()
    {
        var raw = _suggestionField switch
        {
            "cc" => Cc,
            "bcc" => Bcc,
            _ => To,
        };
        var parts = RecipientSplitRe.Split(raw ?? string.Empty);
        return parts.Length == 0 ? string.Empty : parts[^1].Trim();
    }

    private async Task SearchContactsDebouncedAsync(
        string token,
        CancellationTokenSource cancellation)
    {
        try
        {
            await Task.Delay(ContactSearchDebounce, cancellation.Token);
            var contacts = await _api.SearchMailContactsAsync(
                token, _mailboxIdProvider(), cancellation.Token);
            if (!ReferenceEquals(_contactSearchCancellation, cancellation))
            {
                return;
            }

            ContactSuggestions.Clear();
            foreach (var contact in contacts.Where(c => !string.IsNullOrWhiteSpace(c.Email)))
            {
                ContactSuggestions.Add(new MailContactSuggestionViewModel(contact));
            }

            IsContactPopupOpen = ContactSuggestions.Count > 0;
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Подсказки — best-effort: сбой GAL/сети не должен мешать набору письма.
            if (ReferenceEquals(_contactSearchCancellation, cancellation))
            {
                CloseContactSuggestions();
            }
        }
    }

    /// <summary>
    /// Выбор подсказки: последний токен активного поля заменяется «Имя <addr>; »,
    /// уже завершённые адреса до последнего разделителя не трогаются.
    /// </summary>
    internal void ApplyContactSuggestion(MailContactSuggestionViewModel suggestion)
    {
        ArgumentNullException.ThrowIfNull(suggestion);
        var raw = _suggestionField switch
        {
            "cc" => Cc,
            "bcc" => Bcc,
            _ => To,
        } ?? string.Empty;
        var separatorIndex = raw.LastIndexOfAny(RecipientSeparatorChars);
        var prefix = separatorIndex < 0 ? string.Empty : raw[..(separatorIndex + 1)] + " ";
        var next = prefix + suggestion.AddressToken + "; ";
        switch (_suggestionField)
        {
            case "cc":
                Cc = next;
                break;
            case "bcc":
                Bcc = next;
                break;
            default:
                To = next;
                break;
        }

        CloseContactSuggestions();
        SuggestionApplied?.Invoke(_suggestionField);
    }

    /// <summary>Отмена поиска и закрытие popup (Escape, клик вне, закрытие композера).</summary>
    public void CloseContactSuggestions()
    {
        _contactSearchCancellation?.Cancel();
        _contactSearchCancellation = null;
        ContactSuggestions.Clear();
        IsContactPopupOpen = false;
    }

    internal static string GuessMimeType(string? extension) => extension?.ToLowerInvariant() switch
    {
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".bmp" => "image/bmp",
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
}

/// <summary>Опция поля multiselect шаблона IT-заявки: текст + отметка выбора.</summary>
public sealed class MailItFieldOptionViewModel : ObservableObject
{
    private bool _isSelected;

    public MailItFieldOptionViewModel(string text, bool isSelected = false)
    {
        Text = text;
        _isSelected = isSelected;
    }

    public string Text { get; }

    public bool IsSelected
    {
        get => _isSelected;
        set => SetProperty(ref _isSelected, value);
    }
}

/// <summary>
/// Одно динамическое поле формы IT-заявки (элемент fields[] шаблона).
/// Типы — TEMPLATE_FIELD_TYPES backend'а: text|textarea|select|multiselect|
/// date|checkbox|email|tel; неизвестный тип ведёт себя как text.
/// </summary>
public sealed class MailItRequestFieldViewModel : ObservableObject
{
    private string _textValue = string.Empty;
    private bool _boolValue;
    private string? _selectedOption;
    private DateTime? _dateValue;

    private readonly string _defaultText = string.Empty;
    private readonly bool _defaultBool;
    private readonly string? _defaultOption;
    private readonly DateTime? _defaultDate;
    private readonly bool[] _defaultMultiSelected = [];

    public MailItRequestFieldViewModel(HubMailTemplateField field)
    {
        ArgumentNullException.ThrowIfNull(field);
        Key = (field.Key ?? string.Empty).Trim();
        Label = !string.IsNullOrWhiteSpace(field.Label) ? field.Label.Trim() : Key;
        FieldType = NormalizeFieldType(field.Type);
        Required = field.Required;
        HelpText = (field.HelpText ?? string.Empty).Trim();
        var options = (field.Options ?? [])
            .Where(option => !string.IsNullOrWhiteSpace(option))
            .Select(option => option.Trim())
            .ToList();
        OptionValues = options;

        switch (FieldType)
        {
            case "checkbox":
                _defaultBool = DefaultBool(field.DefaultValue);
                _boolValue = _defaultBool;
                break;
            case "multiselect":
                var defaults = DefaultList(field.DefaultValue);
                var selected = new List<bool>(options.Count);
                foreach (var option in options)
                {
                    var isDefault = defaults.Contains(option, StringComparer.Ordinal);
                    OptionItems.Add(new MailItFieldOptionViewModel(option, isDefault));
                    selected.Add(isDefault);
                }

                _defaultMultiSelected = [.. selected];
                break;
            case "select":
                var defaultOption = DefaultText(field.DefaultValue);
                _defaultOption = options.Contains(defaultOption, StringComparer.Ordinal)
                    ? defaultOption
                    : null;
                _selectedOption = _defaultOption;
                break;
            case "date":
                _defaultDate = DefaultDate(field.DefaultValue);
                _dateValue = _defaultDate;
                break;
            default:
                _defaultText = DefaultText(field.DefaultValue);
                _textValue = _defaultText;
                break;
        }
    }

    public string Key { get; }
    public string Label { get; }

    /// <summary>Подпись поля: обязательные помечаются « *» — как в веб-форме.</summary>
    public string LabelText => Required ? Label + " *" : Label;

    /// <summary>Нормализованный тип поля (text|textarea|select|multiselect|date|checkbox|email|tel).</summary>
    public string FieldType { get; }

    public bool Required { get; }
    public string HelpText { get; }
    public bool HasHelpText => HelpText.Length > 0;

    /// <summary>text/email/tel — однострочное поле ввода.</summary>
    public bool IsTextInput => FieldType is "text" or "email" or "tel";
    public bool IsTextarea => FieldType == "textarea";
    public bool IsSelect => FieldType == "select";
    public bool IsMultiSelect => FieldType == "multiselect";
    public bool IsDate => FieldType == "date";
    public bool IsCheckbox => FieldType == "checkbox";

    /// <summary>Варианты select (отображаемые строки опций).</summary>
    public IReadOnlyList<string> OptionValues { get; } = [];

    /// <summary>Варианты multiselect с отметкой выбора.</summary>
    public ObservableCollection<MailItFieldOptionViewModel> OptionItems { get; } = [];

    /// <summary>Текстовые типы (text/textarea/email/tel).</summary>
    public string TextValue
    {
        get => _textValue;
        set => SetProperty(ref _textValue, value ?? string.Empty);
    }

    /// <summary>checkbox.</summary>
    public bool BoolValue
    {
        get => _boolValue;
        set => SetProperty(ref _boolValue, value);
    }

    /// <summary>select — выбранная опция (null — не выбрано).</summary>
    public string? SelectedOption
    {
        get => _selectedOption;
        set => SetProperty(ref _selectedOption, value);
    }

    /// <summary>date.</summary>
    public DateTime? DateValue
    {
        get => _dateValue;
        set => SetProperty(ref _dateValue, value);
    }

    /// <summary>
    /// Проверка required как на backend (validate_template_values): checkbox
    /// обязан быть включён, multiselect — ≥1 отметка, прочие — непустое значение.
    /// </summary>
    internal bool ValidateRequired() => !Required || FieldType switch
    {
        "checkbox" => BoolValue,
        "multiselect" => OptionItems.Any(option => option.IsSelected),
        "select" => !string.IsNullOrEmpty(SelectedOption),
        "date" => DateValue is not null,
        _ => TextValue.Trim().Length > 0,
    };

    /// <summary>Значение для fields{} контракта: bool, список строк или строка.</summary>
    internal object? ToFieldValue() => FieldType switch
    {
        "checkbox" => BoolValue,
        "multiselect" => OptionItems
            .Where(option => option.IsSelected)
            .Select(option => option.Text)
            .ToList(),
        "date" => DateValue?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? string.Empty,
        "select" => SelectedOption ?? string.Empty,
        _ => TextValue.Trim(),
    };

    /// <summary>«Очистить»: возврат к default_value шаблона.</summary>
    internal void Reset()
    {
        switch (FieldType)
        {
            case "checkbox":
                BoolValue = _defaultBool;
                break;
            case "multiselect":
                for (var index = 0; index < OptionItems.Count; index++)
                {
                    OptionItems[index].IsSelected =
                        index < _defaultMultiSelected.Length && _defaultMultiSelected[index];
                }

                break;
            case "select":
                SelectedOption = _defaultOption;
                break;
            case "date":
                DateValue = _defaultDate;
                break;
            default:
                TextValue = _defaultText;
                break;
        }
    }

    internal static string NormalizeFieldType(string? rawType)
    {
        var type = (rawType ?? "text").Trim().ToLowerInvariant();
        return type is "textarea" or "select" or "multiselect" or "date"
            or "checkbox" or "email" or "tel" or "text"
            ? type
            : "text";
    }

    /// <summary>default_value → текст (строка/число/bool; массив склеивается запятой).</summary>
    internal static string DefaultText(JsonElement? value) => value switch
    {
        { ValueKind: JsonValueKind.String } element => (element.GetString() ?? string.Empty).Trim(),
        { ValueKind: JsonValueKind.Number } element => element.GetRawText().Trim(),
        { ValueKind: JsonValueKind.True } => "true",
        { ValueKind: JsonValueKind.False } => "false",
        { ValueKind: JsonValueKind.Array } element => string.Join(
            ", ",
            element.EnumerateArray()
                .Select(item => item.ValueKind == JsonValueKind.String
                    ? item.GetString() ?? string.Empty
                    : item.GetRawText())
                .Select(item => item.Trim())
                .Where(item => item.Length > 0)),
        _ => string.Empty,
    };

    internal static bool DefaultBool(JsonElement? value) => value switch
    {
        { ValueKind: JsonValueKind.True } => true,
        { ValueKind: JsonValueKind.String } element =>
            (element.GetString() ?? string.Empty).Trim().ToLowerInvariant()
                is "1" or "true" or "yes" or "on" or "да",
        _ => false,
    };

    internal static IReadOnlyList<string> DefaultList(JsonElement? value)
    {
        if (value is { ValueKind: JsonValueKind.Array } array)
        {
            var list = new List<string>();
            foreach (var item in array.EnumerateArray())
            {
                var text = (item.ValueKind == JsonValueKind.String
                        ? item.GetString() ?? string.Empty
                        : item.GetRawText())
                    .Trim();
                if (text.Length > 0)
                {
                    list.Add(text);
                }
            }

            return list;
        }

        if (value is { ValueKind: JsonValueKind.String } element)
        {
            return (element.GetString() ?? string.Empty).Split(
                [',', ';'],
                StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        }

        return [];
    }

    internal static DateTime? DefaultDate(JsonElement? value)
    {
        var text = DefaultText(value);
        return DateTime.TryParseExact(
            text, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : null;
    }
}

/// <summary>Шаблон в селекторе формы: заголовок или код (как в веб-диалоге).</summary>
public sealed class MailItTemplateOptionViewModel
{
    public MailItTemplateOptionViewModel(HubMailTemplate template)
    {
        ArgumentNullException.ThrowIfNull(template);
        Model = template;
        Id = (template.Id ?? string.Empty).Trim();
        Title = !string.IsNullOrWhiteSpace(template.Title)
            ? template.Title.Trim()
            : !string.IsNullOrWhiteSpace(template.Code)
                ? template.Code.Trim()
                : Id;
        Category = (template.Category ?? string.Empty).Trim();
    }

    public HubMailTemplate Model { get; }
    public string Id { get; }
    public string Title { get; }
    public string Category { get; }

    /// <summary>«Название · Категория» в списке шаблонов; без категории — название.</summary>
    public string DisplayTitle => Category.Length > 0 ? $"{Title} · {Category}" : Title;
}

/// <summary>
/// Оверлей «Заявка в IT» (как «Новая задача»): выбор шаблона, динамическая
/// форма по fields[] (text/textarea/select/multiselect/date/checkbox/email/tel),
/// вложения-чипы. Без файлов — JSON /mail/messages/send-it-request,
/// с файлами — multipart send-it-request-multipart. Гейт как у почты —
/// кнопку входа гасит ShowSetupHint страницы.
/// </summary>
public sealed class MailItRequestViewModel : ObservableObject
{
    private readonly IHubApiClient _api;
    private readonly Func<IReadOnlyList<string>>? _filePicker;

    private MailItTemplateOptionViewModel? _selectedTemplate;
    private bool _isSending;
    private string? _errorText;
    private (string Fingerprint, string Key)? _sendAttempt;

    public MailItRequestViewModel(
        IHubApiClient api,
        IEnumerable<HubMailTemplate> templates,
        Func<IReadOnlyList<string>>? filePicker)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _filePicker = filePicker;
        ArgumentNullException.ThrowIfNull(templates);

        foreach (var template in templates)
        {
            if (template is not null && !string.IsNullOrWhiteSpace(template.Id))
            {
                Templates.Add(new MailItTemplateOptionViewModel(template));
            }
        }

        SendCommand = new NativeAsyncCommand(
            (_, ct) => SendAsync(ct),
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSend);
        AttachCommand = new NativeAsyncCommand(
            (_, _) =>
            {
                AddFiles(_filePicker?.Invoke() ?? []);
                return Task.CompletedTask;
            },
            ex => ErrorText = TasksViewModel.DescribeError(ex),
            _ => !IsSending);
        RemoveAttachmentCommand = new NativeRelayCommand(parameter =>
        {
            if (parameter is MailComposeAttachmentViewModel attachment)
            {
                Attachments.Remove(attachment);
            }
        });
        ClearCommand = new NativeRelayCommand(
            ClearValues, () => !IsSending);
        CloseCommand = new NativeRelayCommand(
            () => Closed?.Invoke(this, EventArgs.Empty), () => !IsSending);
        Attachments.CollectionChanged += (_, _) => OnPropertyChanged(nameof(HasAttachments));
    }

    /// <summary>Успешная отправка (result от send-it-request*).</summary>
    public event EventHandler<HubMailSendResult>? Sent;

    /// <summary>Закрытие формы (✕/Отмена/Esc или после отправки — решает родитель).</summary>
    public event EventHandler? Closed;

    public string Title => "Заявка в IT";

    /// <summary>Активные шаблоны из GET /mail/templates.</summary>
    public ObservableCollection<MailItTemplateOptionViewModel> Templates { get; } = [];

    public bool HasTemplates => Templates.Count > 0;

    /// <summary>Выбранный шаблон: смена пересобирает форму по его fields[].</summary>
    public MailItTemplateOptionViewModel? SelectedTemplate
    {
        get => _selectedTemplate;
        set
        {
            if (SetProperty(ref _selectedTemplate, value))
            {
                ApplyTemplate(value);
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Динамические поля выбранного шаблона (порядок — order backend'а).</summary>
    public ObservableCollection<MailItRequestFieldViewModel> Fields { get; } = [];

    public bool HasFields => Fields.Count > 0;

    /// <summary>Локальные файлы — отправляются multipart-вариантом.</summary>
    public ObservableCollection<MailComposeAttachmentViewModel> Attachments { get; } = [];

    public bool HasAttachments => Attachments.Count > 0;

    public bool IsSending
    {
        get => _isSending;
        private set
        {
            if (SetProperty(ref _isSending, value))
            {
                OnPropertyChanged(nameof(CanSend));
                OnPropertyChanged(nameof(SendButtonText));
                ((NativeAsyncCommand)SendCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)AttachCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ClearCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)CloseCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public bool CanSend => !IsSending && SelectedTemplate is not null;

    public string SendButtonText => IsSending ? "Отправляем…" : "Отправить";

    /// <summary>Ошибка валидации/отправки — плашка внутри формы, поля не стираются.</summary>
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

    public bool HasError => !string.IsNullOrEmpty(ErrorText);

    public ICommand SendCommand { get; }
    public ICommand AttachCommand { get; }
    public ICommand RemoveAttachmentCommand { get; }
    public ICommand ClearCommand { get; }
    public ICommand CloseCommand { get; }

    /// <summary>Пересобрать форму под выбранный шаблон (поля с default_value).</summary>
    private void ApplyTemplate(MailItTemplateOptionViewModel? template)
    {
        Fields.Clear();
        var fields = template?.Model.Fields;
        if (fields is null)
        {
            OnPropertyChanged(nameof(HasFields));
            return;
        }

        foreach (var field in fields.OrderBy(field => field.Order))
        {
            Fields.Add(new MailItRequestFieldViewModel(field));
        }

        OnPropertyChanged(nameof(HasFields));
    }

    /// <summary>«Очистить» — значения полей обратно в default_value шаблона.</summary>
    internal void ClearValues()
    {
        ErrorText = null;
        foreach (var field in Fields)
        {
            field.Reset();
        }
    }

    /// <summary>Файлы «📎»; недоступные/дубли — с подсказкой, без падения (как композер).</summary>
    internal void AddFiles(IReadOnlyList<string> paths)
    {
        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path)
                || Attachments.Any(a => string.Equals(a.Path, path, StringComparison.OrdinalIgnoreCase)))
            {
                continue;
            }

            var attachment = new MailComposeAttachmentViewModel(path);
            if (attachment.Size < 0)
            {
                ErrorText = $"Файл «{attachment.Name}» не найден или недоступен.";
                continue;
            }

            Attachments.Add(attachment);
        }
    }

    /// <summary>fields{} для контракта: все поля шаблона по ключу.</summary>
    internal Dictionary<string, object?> BuildFields()
    {
        var fields = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var field in Fields)
        {
            if (field.Key.Length == 0)
            {
                continue;
            }

            fields[field.Key] = field.ToFieldValue();
        }

        return fields;
    }

    /// <summary>Чтение файлов вложений в память; null — ошибка уже в ErrorText.</summary>
    private async Task<IReadOnlyList<HubMailOutgoingAttachment>?> ReadAttachmentFilesAsync(
        CancellationToken cancellationToken)
    {
        if (Attachments.Count == 0)
        {
            return null;
        }

        var files = new List<HubMailOutgoingAttachment>(Attachments.Count);
        foreach (var attachment in Attachments)
        {
            try
            {
                var bytes = await File.ReadAllBytesAsync(attachment.Path, cancellationToken);
                files.Add(new HubMailOutgoingAttachment
                {
                    FileName = attachment.Name,
                    ContentType = MailComposeViewModel.GuessMimeType(
                        System.IO.Path.GetExtension(attachment.Path)),
                    Content = bytes,
                });
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                ErrorText = $"Нет доступа к файлу «{attachment.Name}».";
                return null;
            }
        }

        return files;
    }

    internal async Task SendAsync(CancellationToken cancellationToken)
    {
        if (IsSending)
        {
            return;
        }

        ErrorText = null;
        var template = SelectedTemplate;
        if (template is null || template.Id.Length == 0)
        {
            ErrorText = "Выберите шаблон заявки.";
            return;
        }

        var missing = Fields
            .Where(field => !field.ValidateRequired())
            .Select(field => field.Label)
            .ToList();
        if (missing.Count > 0)
        {
            ErrorText = "Заполните обязательные поля: " + string.Join(", ", missing) + ".";
            return;
        }

        IsSending = true;
        try
        {
            var fields = BuildFields();
            var files = await ReadAttachmentFilesAsync(cancellationToken);
            if (Attachments.Count > 0 && files is null)
            {
                return;
            }

            var fingerprint = JsonSerializer.Serialize(new
            {
                template.Id,
                Fields = fields.OrderBy(pair => pair.Key, StringComparer.Ordinal),
                Files = files?.Select(file => new
                {
                    file.FileName,
                    Hash = Convert.ToHexString(SHA256.HashData(file.Content.Span)),
                }),
            });
            if (_sendAttempt is not { } attempt || attempt.Fingerprint != fingerprint)
            {
                _sendAttempt = (fingerprint, Guid.NewGuid().ToString("N"));
            }
            var sendKey = _sendAttempt.Value.Key;
            var result = files is { Count: > 0 }
                ? await _api.SendMailItRequestMultipartAsync(
                    template.Id, fields, files, cancellationToken, sendKey)
                : await _api.SendMailItRequestAsync(template.Id, fields, cancellationToken, sendKey);
            if (!result.Ok)
            {
                ErrorText = "Заявка не отправлена.";
                return;
            }

            _sendAttempt = null;
            Sent?.Invoke(this, result);
        }
        finally
        {
            IsSending = false;
        }
    }
}

/// <summary>
/// Страница «Почта» нативного шелла: дерево папок с бейджами непрочитанных,
/// список писем с offset-пагинацией и серверным поиском, панель чтения,
/// отметки read/unread, удаление (мягкое; permanent=true — только в «Корзине»),
/// архивация и удаление черновиков (DELETE /mail/drafts/{id}).
/// </summary>
public sealed class MailViewModel : ObservableObject
{
    /// <summary>Страница списка и limit bootstrap (backend принимает 10..100 для bootstrap).</summary>
    private const int PageSize = 50;

    private readonly IHubApiClient _api;
    private CancellationTokenSource? _detailLoadCancellation;

    private string _currentFolder = "inbox";
    private MailFolderViewModel? _selectedFolder;
    private MailListItemViewModel? _selectedItem;
    private MailDetailViewModel? _detail;
    private bool _isDetailLoading;
    private string? _detailErrorText;
    private string _searchText = string.Empty;
    private bool _searchAllFolders;
    private bool _showingAllFolderResults;
    private string? _searchStatusText;
    private string _filter = "all";
    private bool _isLoading;
    private bool _isLoadingMore;
    private int _total;
    private bool _hasMore;
    private string? _bannerErrorText;
    private string _totalText = string.Empty;
    private int _totalUnreadCount;
    private string _lastUpdatedText = string.Empty;
    private string? _mailboxId;
    private string _mailboxLabel = string.Empty;
    private bool _showSetupHint;
    private string _setupHintText = string.Empty;
    private MailComposeViewModel? _composer;
    private MailItRequestViewModel? _itRequest;
    private string? _statusInfoText;
    private bool _isBulkBusy;
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight realtime-загрузки.</summary>
    private int _loadEpoch;
    private int _listRequestVersion;
    private HubMailMessageQuery? _appliedListQuery;
    private int? _nextMailOffset;

    // Папки: inline-редактор имени и armed-удаление из контекстного меню рейки.
    private MailFolderViewModel? _armedFolderDelete;
    private bool _isFolderEditorOpen;
    private bool _isFolderEditorBusy;
    private string _folderEditorMode = "create";
    private string _folderEditorName = string.Empty;
    private string? _folderEditorErrorText;
    private MailFolderViewModel? _folderEditorTarget;
    private MailFolderViewModel? _folderEditorParent;

    // AI (пересказ/быстрые ответы): локальный opt-in + серверный kill-switch по пробе.
    private bool _mailAiEnabled;
    private bool _mailAiServerDisabled;
    private bool _aiConsentOpen;
    private string? _pendingAiAction;
    private bool _isAiBusy;
    private bool _isSummaryLoading;
    private bool _isSmartRepliesLoading;
    private string? _aiSummaryText;
    private string? _aiErrorText;
    private CancellationTokenSource? _aiLoadCancellation;

    public MailViewModel(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectFolderCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                if (parameter is string folderId
                    && !string.Equals(folderId, _currentFolder, StringComparison.Ordinal))
                {
                    await SelectFolderCoreAsync(folderId, ct);
                }
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SelectFilterCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                Filter = parameter as string ?? "all";
                Detail = null;
                SelectedItem = null;
                await LoadMessagesAsync(offset: 0, replace: true, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        LoadMoreCommand = new NativeAsyncCommand(
            (_, ct) => LoadMoreAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasMore && !IsLoading && !IsLoadingMore);
        ToggleReadCommand = new NativeAsyncCommand(
            (_, ct) => ToggleReadCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanRunActions: true });
        DeleteCommand = new NativeAsyncCommand(
            (_, ct) => DeleteCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => CanSoftDeleteDetail);
        DeleteDraftCommand = new NativeAsyncCommand(
            (_, ct) => DeleteDraftCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanRunActions: true, DraftContext: not null });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        DismissStatusCommand = new NativeRelayCommand(() => StatusInfoText = null);
        // Ненастроенный ящик: композер открылся бы за оверлеем «Почта пока
        // недоступна» — кнопка честно гасится (как IT-заявка и «Папка»).
        NewMessageCommand = new NativeRelayCommand(() => OpenCompose("new"), () => !ShowSetupHint);
        OpenItRequestCommand = new NativeAsyncCommand(
            (_, ct) => OpenItRequestAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => !ShowSetupHint);
        ReplyCommand = new NativeRelayCommand(
            () => OpenComposeFromDetail("reply"), () => Detail is not null);
        ReplyAllCommand = new NativeRelayCommand(
            () => OpenComposeFromDetail("reply_all"), () => Detail is not null);
        ForwardCommand = new NativeRelayCommand(
            () => OpenComposeFromDetail("forward"), () => Detail is not null);
        EditDraftCommand = new NativeRelayCommand(
            OpenDraftFromDetail, () => Detail is { DraftContext: not null });
        OpenAttachmentCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailAttachmentItemViewModel attachment
                ? DownloadAttachmentAsync(attachment, ct)
                : Task.CompletedTask,
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailAttachmentItemViewModel { IsDownloading: false });
        MoveCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is string targetFolder
                ? MoveCurrentAsync(targetFolder, ct)
                : Task.CompletedTask,
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            parameter => Detail is { CanRunActions: true, CanMove: true }
                && parameter is string { Length: > 0 });
        SelectAllCommand = new NativeRelayCommand(() => SetAllChecked(true));
        ClearSelectionCommand = new NativeRelayCommand(
            () => SetAllChecked(false), () => HasSelection);
        BulkMarkReadCommand = new NativeAsyncCommand(
            (_, ct) => BulkActionAsync("mark_read", targetFolder: null, permanent: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection && !IsBulkBusy);
        BulkMarkUnreadCommand = new NativeAsyncCommand(
            (_, ct) => BulkActionAsync("mark_unread", targetFolder: null, permanent: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection && !IsBulkBusy);
        BulkDeleteCommand = new NativeAsyncCommand(
            (_, ct) => BulkActionAsync("delete", targetFolder: null, permanent: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection && !IsBulkBusy && !_showingAllFolderResults);
        // Как в веб-почте: безвозвратное удаление предлагается только в «Удалённых».
        BulkDeletePermanentCommand = new NativeAsyncCommand(
            (_, ct) => BulkActionAsync("delete", targetFolder: null, permanent: true, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection && !IsBulkBusy && IsTrashFolder);
        BulkArchiveCommand = new NativeAsyncCommand(
            (_, ct) => BulkActionAsync("archive", targetFolder: null, permanent: false, ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            _ => HasSelection && !IsBulkBusy);
        BulkMoveCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is string targetFolder
                ? BulkActionAsync("move", targetFolder, permanent: false, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => HasSelection && !IsBulkBusy && parameter is string { Length: > 0 });
        ToggleImportanceCommand = new NativeAsyncCommand(
            (_, ct) => ToggleImportanceCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanRunActions: true });
        ToggleItemImportanceCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailListItemViewModel item
                ? ToggleItemImportanceAsync(item, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailListItemViewModel);
        ToggleItemReadCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailListItemViewModel item
                ? RunItemsActionAsync(
                    [item],
                    item.IsUnread ? "mark_read" : "mark_unread",
                    targetFolder: null,
                    permanent: false,
                    ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailListItemViewModel);
        ArchiveItemCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailListItemViewModel item
                ? RunItemsActionAsync([item], "archive", targetFolder: null, permanent: false, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailListItemViewModel);
        DeleteItemCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailListItemViewModel item
                ? RunItemsActionAsync(
                    [item],
                    "delete",
                    targetFolder: null,
                    // Мягкое удаление в «Удалённых» на сервере необратимо — как в bulk-баре.
                    permanent: IsTrashFolder,
                    ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailListItemViewModel);
        MoveItemFromKebabCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                if (parameter is not string { Length: > 0 } folderId || KebabTargetItem is not { } item)
                {
                    return;
                }

                KebabTargetItem = null;
                await RunItemsActionAsync([item], "move", folderId, permanent: false, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is string { Length: > 0 } && KebabTargetItem is not null);
        ResetListFiltersCommand = new NativeAsyncCommand(
            async (_, ct) =>
            {
                SearchText = string.Empty;
                Filter = "all";
                Detail = null;
                SelectedItem = null;
                await LoadMessagesAsync(offset: 0, replace: true, ct);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        RestoreItemCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailListItemViewModel or MailDetailViewModel
                ? RestoreItemAsync(parameter, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex),
            parameter => parameter is MailListItemViewModel or MailDetailViewModel);
        ToggleFolderExpandedCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is not MailFolderViewModel { HasChildren: true } folder)
                {
                    return;
                }

                folder.IsExpanded = !folder.IsExpanded;
                foreach (var node in Folders)
                {
                    node.UpdateTreeVisibility();
                }
            });
        ToggleDetailHeadersCommand = new NativeAsyncCommand(
            async (_, ct) => await ToggleDetailHeadersAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is not null);
        DownloadMessageSourceCommand = new NativeAsyncCommand(
            (_, ct) => DownloadMessageSourceAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is not null);
        NewFolderCommand = new NativeRelayCommand(
            () => OpenFolderEditor("create", parent: null, target: null),
            () => !ShowSetupHint);
        NewSubfolderCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is MailFolderViewModel { CanCreateChildren: true, IsBusy: false } parent)
                {
                    OpenFolderEditor("create", parent, target: null);
                }
            });
        RenameFolderCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is MailFolderViewModel { ShowRename: true, IsBusy: false } folder)
                {
                    OpenFolderEditor("rename", parent: null, target: folder);
                }
            });
        DeleteFolderCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailFolderViewModel folder
                ? DeleteFolderAsync(folder, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ToggleFolderFavoriteCommand = new NativeAsyncCommand(
            (parameter, ct) => parameter is MailFolderViewModel folder
                ? ToggleFolderFavoriteAsync(folder, ct)
                : Task.CompletedTask,
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ConfirmFolderEditorCommand = new NativeAsyncCommand(
            (_, ct) => ConfirmFolderEditorAsync(ct),
            ex => FolderEditorErrorText = TasksViewModel.DescribeError(ex),
            _ => IsFolderEditorOpen && !IsFolderEditorBusy);
        CancelFolderEditorCommand = new NativeRelayCommand(CloseFolderEditor);
        SummarizeCommand = new NativeAsyncCommand(
            (_, ct) => RunAiActionAsync("summary", ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => ShowAiActions && !IsAiBusy);
        SmartRepliesCommand = new NativeAsyncCommand(
            (_, ct) => RunAiActionAsync("replies", ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex),
            _ => ShowAiActions && !IsAiBusy);
        AcceptAiConsentCommand = new NativeAsyncCommand(
            (_, ct) => AcceptAiConsentAsync(ct),
            ex => AiErrorText = TasksViewModel.DescribeError(ex));
        DismissAiConsentCommand = new NativeRelayCommand(() => AiConsentOpen = false);
        ApplySmartReplyCommand = new NativeRelayCommand(
            parameter =>
            {
                if (parameter is string suggestion)
                {
                    ApplySmartReply(suggestion);
                }
            });
        Items.CollectionChanged += (_, args) =>
        {
            if (args.OldItems is not null)
            {
                foreach (MailListItemViewModel item in args.OldItems)
                {
                    item.PropertyChanged -= OnItemCheckedChanged;
                }
            }

            if (args.NewItems is not null)
            {
                foreach (MailListItemViewModel item in args.NewItems)
                {
                    item.PropertyChanged += OnItemCheckedChanged;
                }
            }

            OnSelectionChanged();
            OnPropertyChanged(nameof(IsEmpty));
            ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
        };
    }

    // ---- Папки ----

    public ObservableCollection<MailFolderViewModel> Folders { get; } = [];

    /// <summary>
    /// Выбранная папка в рейке. Присвоение из UI запускает загрузку писем
    /// этой папки (как SelectedItem деталь у новостей).
    /// </summary>
    public MailFolderViewModel? SelectedFolder
    {
        get => _selectedFolder;
        set
        {
            if (SetProperty(ref _selectedFolder, value))
            {
                OnPropertyChanged(nameof(ListHeaderTitle));
                OnPropertyChanged(nameof(ListHeaderAutomationName));
                if (value is not null
                    && !string.Equals(value.Id, _currentFolder, StringComparison.Ordinal))
                {
                    _ = SelectFolderSafelyAsync(value.Id);
                }
            }
        }
    }

    /// <summary>id текущей папки для запросов (alias или токен узла дерева).</summary>
    public string CurrentFolder => _currentFolder;

    // ---- Список ----

    public ObservableCollection<MailListItemViewModel> Items { get; } = [];

    public MailListItemViewModel? SelectedItem
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

    public MailDetailViewModel? Detail
    {
        get => _detail;
        private set
        {
            if (SetProperty(ref _detail, value))
            {
                OnPropertyChanged(nameof(HasDetail));
                OnPropertyChanged(nameof(ShowDetailEmpty));
                OnPropertyChanged(nameof(ShowDetailLoading));
                ((NativeRelayCommand)ReplyCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ReplyAllCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)ForwardCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)EditDraftCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)ToggleReadCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)DeleteDraftCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)MoveCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)ToggleImportanceCommand).RaiseCanExecuteChanged();
                OnPropertyChanged(nameof(ShowAiActions));
                RaiseAiCommandsCanExecuteChanged();
            }
        }
    }

    public bool HasDetail => Detail is not null;

    /// <summary>Подсказка «Выберите письмо»: ни детали, ни её загрузки.</summary>
    public bool ShowDetailEmpty => !HasDetail && !IsDetailLoading;

    /// <summary>Спиннер детали — только когда письма ещё нет (старое не заслоняем).</summary>
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

    /// <summary>Серверный поиск (q) по текущей папке; применяется кнопкой «Обновить»/Enter.</summary>
    public string SearchText
    {
        get => _searchText;
        set
        {
            if (SetProperty(ref _searchText, value))
            {
                OnPropertyChanged(nameof(HasActiveListFilters));
                OnPropertyChanged(nameof(ListHeaderTitle));
                OnPropertyChanged(nameof(ListHeaderAutomationName));
            }
        }
    }

    /// <summary>Активен ли поиск/фильтр списка — кнопка «Сбросить фильтры» в пустом состоянии.</summary>
    public bool HasActiveListFilters =>
        !string.IsNullOrWhiteSpace(SearchText)
        || !string.Equals(Filter, "all", StringComparison.Ordinal)
        || SearchAllFolders;

    public bool SearchAllFolders
    {
        get => _searchAllFolders;
        set
        {
            if (SetProperty(ref _searchAllFolders, value))
            {
                OnPropertyChanged(nameof(ListHeaderTitle));
                OnPropertyChanged(nameof(ListHeaderAutomationName));
                OnPropertyChanged(nameof(HasActiveListFilters));
            }
        }
    }

    /// <summary>
    /// Заголовок списка (threadPaneHeaderBar в TB): имя выбранной папки;
    /// при поиске по всем папкам — «Все папки», а не вводящая в заблуждение
    /// выбранная строка рейки.
    /// </summary>
    public string ListHeaderTitle => SearchAllFolders && !string.IsNullOrWhiteSpace(SearchText)
        ? "Все папки"
        : SelectedFolder?.Label ?? "Почта";

    /// <summary>UIA-имя заголовка списка: для поиска по всем папкам это область
    /// поиска, а не «текущая папка».</summary>
    public string ListHeaderAutomationName => SearchAllFolders && !string.IsNullOrWhiteSpace(SearchText)
        ? "Область поиска: все папки"
        : $"Текущая папка: {SelectedFolder?.Label ?? "Почта"}";

    public string? SearchStatusText
    {
        get => _searchStatusText;
        private set => SetProperty(ref _searchStatusText, value);
    }

    /// <summary>all|unread — фильтр списка (unread_only в API).</summary>
    public string Filter
    {
        get => _filter;
        private set
        {
            if (SetProperty(ref _filter, value is "unread" ? "unread" : "all"))
            {
                OnPropertyChanged(nameof(IsFilterAll));
                OnPropertyChanged(nameof(IsFilterUnread));
                OnPropertyChanged(nameof(HasActiveListFilters));
            }
        }
    }

    /// <summary>unread_only=true в запросе списка.</summary>
    public bool UnreadOnly => Filter == "unread";

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

    public bool IsLoadingMore
    {
        get => _isLoadingMore;
        private set
        {
            if (SetProperty(ref _isLoadingMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Сервер сообщил has_more=true — есть следующая страница.</summary>
    public bool HasMore
    {
        get => _hasMore;
        private set
        {
            if (SetProperty(ref _hasMore, value))
            {
                OnPropertyChanged(nameof(MoreButtonText));
                OnPropertyChanged(nameof(ListHeaderCountText));
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    /// <summary>Сколько писем текущей выдачи ещё не загружено (total сервера − показано).</summary>
    public int RemainingCount => Math.Max(0, _total - Items.Count);

    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : $"Показать ещё ({RemainingCount})";

    /// <summary>Подсказка кнопки догрузки: различает «загружено» и «всего по фильтру».</summary>
    public string LoadMoreToolTip => $"Загружено {Items.Count} из {_total}; показать следующую порцию";

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

    /// <summary>Всего непрочитанных в ящике (unread_count) — бейдж навигации шелла.</summary>
    public int TotalUnreadCount
    {
        get => _totalUnreadCount;
        private set
        {
            if (SetProperty(ref _totalUnreadCount, value))
            {
                OnPropertyChanged(nameof(UnreadText));
            }
        }
    }

    public string UnreadText => TotalUnreadCount.ToString(CultureInfo.CurrentCulture);

    public string TotalText
    {
        get => _totalText;
        private set
        {
            if (SetProperty(ref _totalText, value))
            {
                OnPropertyChanged(nameof(ListHeaderCountText));
            }
        }
    }

    /// <summary>
    /// Подпись счётчика для заголовка списка писем («42 письма») — аналог
    /// threadPaneFolderCount в Thunderbird; пустая, когда папка ещё не считана.
    /// Пока выдача догружается страницами, рядом указываем, сколько уже на экране:
    /// «854 письма · загружено 50» — иначе два одинаковых числа (заголовок и
    /// кнопка догрузки) читаются как дубль.
    /// </summary>
    public string ListHeaderCountText
    {
        get
        {
            var total = PluralizeMailCount(TotalText);
            return total.Length > 0 && HasMore && Items.Count > 0
                ? $"{total} · загружено {Items.Count}"
                : total;
        }
    }

    internal static string PluralizeMailCount(string totalText) =>
        int.TryParse(totalText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var total)
            ? PluralizeMailCount(total)
            : string.Empty;

    private static string PluralizeMailCount(int total) => (total % 10, total % 100) switch
    {
        (1, not 11) => $"{total} письмо",
        // Скобки обязательны: «not >= 12 and <= 14» парсится как
        // «(not >= 12) and <= 14» — иначе 22-24, 92-94… падают в «писем».
        (>= 2 and <= 4, not (>= 12 and <= 14)) => $"{total} письма",
        _ => $"{total} писем",
    };

    public string LastUpdatedText
    {
        get => _lastUpdatedText;
        private set => SetProperty(ref _lastUpdatedText, value);
    }

    /// <summary>Подпись ящика из bootstrap (selected_mailbox.label / mailbox_email).</summary>
    public string MailboxLabel
    {
        get => _mailboxLabel;
        private set => SetProperty(ref _mailboxLabel, value);
    }

    /// <summary>Ящик не настроен/ждёт пароль или перелогин — вместо списка подсказка.</summary>
    public bool ShowSetupHint
    {
        get => _showSetupHint;
        private set
        {
            if (SetProperty(ref _showSetupHint, value))
            {
                OnPropertyChanged(nameof(IsEmpty));
                ((NativeRelayCommand)NewMessageCommand).RaiseCanExecuteChanged();
                ((NativeRelayCommand)NewFolderCommand).RaiseCanExecuteChanged();
                ((NativeAsyncCommand)OpenItRequestCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string SetupHintText
    {
        get => _setupHintText;
        private set => SetProperty(ref _setupHintText, value);
    }

    /// <summary>Пустая выдача без ошибки, загрузки и состояния «почта не настроена».</summary>
    public bool IsEmpty =>
        !IsLoading && !ShowSetupHint && Items.Count == 0 && !HasBannerError;

    public ICommand RefreshCommand { get; }
    public ICommand SelectFolderCommand { get; }
    public ICommand SelectFilterCommand { get; }
    public ICommand LoadMoreCommand { get; }
    public ICommand ToggleReadCommand { get; }
    public ICommand DeleteCommand { get; }
    public ICommand DismissBannerCommand { get; }
    public ICommand DismissStatusCommand { get; }
    public ICommand NewMessageCommand { get; }
    public ICommand OpenItRequestCommand { get; }
    public ICommand ReplyCommand { get; }
    public ICommand ReplyAllCommand { get; }
    public ICommand ForwardCommand { get; }
    public ICommand EditDraftCommand { get; }
    public ICommand OpenAttachmentCommand { get; }
    public ICommand MoveCommand { get; }
    public ICommand SelectAllCommand { get; }
    public ICommand ClearSelectionCommand { get; }
    public ICommand BulkMarkReadCommand { get; }
    public ICommand BulkMarkUnreadCommand { get; }
    public ICommand BulkDeleteCommand { get; }
    public ICommand BulkDeletePermanentCommand { get; }
    public ICommand BulkArchiveCommand { get; }
    public ICommand BulkMoveCommand { get; }
    public ICommand DeleteDraftCommand { get; }
    public ICommand ToggleImportanceCommand { get; }

    /// <summary>
    /// Звезда-флаг важности прямо в строке списка (как button-star в Thunderbird):
    /// тогл важности письма без его открытия, параметр — MailListItemViewModel.
    /// </summary>
    public ICommand ToggleItemImportanceCommand { get; }

    /// <summary>Kebab-меню строки (tree-button-more в TB): прочитано — без открытия письма.</summary>
    public ICommand ToggleItemReadCommand { get; }

    /// <summary>«В архив» из kebab-меню строки — то же ядро, что у bulk-действий.</summary>
    public ICommand ArchiveItemCommand { get; }

    /// <summary>«Удалить» из kebab-меню строки; в «Удалённых» — навсегда.</summary>
    public ICommand DeleteItemCommand { get; }

    /// <summary>«Переместить в…» из kebab-меню: параметр — id папки-цели из MoveTargets.</summary>
    public ICommand MoveItemFromKebabCommand { get; }

    /// <summary>
    /// «Восстановить» из «Удалённых» (undo-паттерн Gmail): параметр — строка списка
    /// или открытая деталь; письмо возвращается на сервер, строка уходит из выдачи.
    /// </summary>
    public ICommand RestoreItemCommand { get; }

    /// <summary>Chevron узла дерева папок: свернуть/развернуть детей (сессия).</summary>
    public ICommand ToggleFolderExpandedCommand { get; }

    /// <summary>
    /// «Показать заголовки» в меню «Ещё» (режим деталей Gmail): раскрывает блок
    /// полных заголовков открытого письма; первая загрузка кэшируется в детали.
    /// </summary>
    public ICommand ToggleDetailHeadersCommand { get; }

    /// <summary>
    /// «Скачать исходник (.eml)» из меню «Ещё»: RFC822-файл сохраняется в
    /// %TEMP%/hub-desktop/mail-sources, папка открывается проводником (паритет
    /// с downloadMessageSource веб-почты).
    /// </summary>
    public ICommand DownloadMessageSourceCommand { get; }

    /// <summary>
    /// Сбросить поиск и фильтры списка (Esc в поиске, кнопка пустого состояния) —
    /// как «Показать все» в Gmail: пустой запрос + фильтр «Все» и перезагрузка.
    /// </summary>
    public ICommand ResetListFiltersCommand { get; }

    /// <summary>
    /// Строка, чей kebab-меню открыт: контекст для «Переместить в…».
    /// Присваивает code-behind перед открытием меню; команда погашает после выполнения.
    /// </summary>
    internal MailListItemViewModel? KebabTargetItem { get; set; }
    public ICommand NewFolderCommand { get; }
    public ICommand NewSubfolderCommand { get; }
    public ICommand RenameFolderCommand { get; }
    public ICommand DeleteFolderCommand { get; }
    public ICommand ToggleFolderFavoriteCommand { get; }
    public ICommand ConfirmFolderEditorCommand { get; }
    public ICommand CancelFolderEditorCommand { get; }
    public ICommand SummarizeCommand { get; }
    public ICommand SmartRepliesCommand { get; }
    public ICommand AcceptAiConsentCommand { get; }
    public ICommand DismissAiConsentCommand { get; }
    public ICommand ApplySmartReplyCommand { get; }

    /// <summary>Текущая папка — «Удалённые»: в bulk-баре вместо мягкого «Удалить» показываем «Удалить навсегда».</summary>
    public bool IsTrashFolder => !_showingAllFolderResults && IsFolder("trash");
    public bool ShowBulkSoftDelete => !_showingAllFolderResults && !IsTrashFolder;

    /// <summary>Подпись «Удалить» в kebab-меню строки: в «Удалённых» операция навсегда.</summary>
    public string ItemDeleteMenuText => IsTrashFolder ? "Удалить навсегда" : "Удалить";

    private bool CanSoftDeleteDetail => Detail is { CanRunActions: true } detail
        && detail.Folder != "trash" && !IsTrashFolder && !_showingAllFolderResults;

    // ---- Композер ----

    /// <summary>Открытая панель композера (новое письмо/ответ/пересылка/черновик); null — скрыта.</summary>
    public MailComposeViewModel? Composer
    {
        get => _composer;
        private set
        {
            if (SetProperty(ref _composer, value))
            {
                OnPropertyChanged(nameof(IsComposeOpen));
            }
        }
    }

    public bool IsComposeOpen => Composer is not null;

    /// <summary>Открытый оверлей «Заявка в IT» (шаблонная форма); null — скрыт.</summary>
    public MailItRequestViewModel? ItRequest
    {
        get => _itRequest;
        private set
        {
            if (SetProperty(ref _itRequest, value))
            {
                OnPropertyChanged(nameof(IsItRequestOpen));
            }
        }
    }

    public bool IsItRequestOpen => ItRequest is not null;

    /// <summary>
    /// Шов выбора файлов для «📎» композера и формы заявки: code-behind ставит
    /// OpenFileDialog, тесты — заглушку с путями. null — кнопка вернёт пустой список.
    /// </summary>
    public Func<IReadOnlyList<string>>? ComposeFilePicker { get; set; }

    /// <summary>
    /// Шов сохранения/открытия вложения (как AttachmentSaver у чата): тесты заменяют
    /// потоковое скачивание в %TEMP% + Process.Start. Аргументы — чип и id письма.
    /// </summary>
    public Func<MailAttachmentItemViewModel, string, Task>? AttachmentSaver { get; set; }

    /// <summary>Инфо-строка в шапке («Отправлено», «Перемещено», итог bulk) — зелёная плашка.</summary>
    public string? StatusInfoText
    {
        get => _statusInfoText;
        private set
        {
            if (SetProperty(ref _statusInfoText, value))
            {
                OnPropertyChanged(nameof(HasStatusInfo));
            }
        }
    }

    public bool HasStatusInfo => !string.IsNullOrEmpty(StatusInfoText);

    // ---- Массовое выделение ----

    /// <summary>Сколько строк списка отмечено чекбоксом.</summary>
    public int SelectedCount => Items.Count(item => item.IsChecked);

    public bool HasSelection => SelectedCount > 0;

    public string SelectionText => $"Выбрано: {SelectedCount}";

    /// <summary>
    /// Трёхсостояний чекбокс «Выбрать все» в заголовке списка: true — все
    /// загруженные отмечены, null — часть, false — ничего. Сеттер от клика:
    /// true отмечает все загруженные, false снимает (выбор всех писем папки
    /// целиком API не поддерживает — действуем только над показанной порцией).
    /// </summary>
    public bool? IsAllLoadedChecked
    {
        get => Items.Count == 0
            ? false
            : SelectedCount == 0 ? false : SelectedCount == Items.Count ? true : null;
        set
        {
            if (value is bool isChecked)
            {
                SetAllChecked(isChecked);
            }
        }
    }

    /// <summary>Идёт bulk-операция — кнопки панели блокируются, показываем прогресс-текст.</summary>
    public bool IsBulkBusy
    {
        get => _isBulkBusy;
        private set
        {
            if (SetProperty(ref _isBulkBusy, value))
            {
                OnPropertyChanged(nameof(BulkBusyText));
                RaiseBulkCommandsCanExecuteChanged();
            }
        }
    }

    public string BulkBusyText => IsBulkBusy ? "Выполняем…" : string.Empty;

    /// <summary>Папки-цели для меню «Переместить» (без текущей).</summary>
    public IReadOnlyList<MailFolderViewModel> MoveTargets =>
        Folders.Where(f => f.Id != _currentFolder).ToList();

    /// <summary>
    /// Первичная загрузка/обновление: GET /mail/bootstrap (ящик + папки + непрочитанные),
    /// затем список писем текущей папки (для inbox без фильтров — голова из bootstrap).
    /// </summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        var version = ++_listRequestVersion;
        var epoch = _loadEpoch;
        IsLoading = true;
        try
        {
            var bootstrap = await _api.GetMailBootstrapAsync(
                PageSize, _mailboxId, cancellationToken);
            if (version != _listRequestVersion || epoch != _loadEpoch || cancellationToken.IsCancellationRequested)
            {
                return;
            }
            ApplyMailboxInfo(bootstrap.SelectedMailbox ?? bootstrap.MailboxInfo);
            if (ShowSetupHint)
            {
                Folders.Clear();
                Items.Clear();
                ApplyPage(null);
                TotalUnreadCount = 0;
                TotalText = string.Empty;
                BannerErrorText = null;
                return;
            }

            ApplyFolderTree(bootstrap.FolderTree);
            TotalUnreadCount = bootstrap.UnreadCount;

            // Голова inbox из bootstrap валидна только без фильтров.
            var canReuseInboxHead =
                string.Equals(_currentFolder, "inbox", StringComparison.Ordinal)
                && !UnreadOnly
                && string.IsNullOrWhiteSpace(SearchText)
                && bootstrap.Messages is not null;
            if (canReuseInboxHead)
            {
                Items.Clear();
                ApplyPage(bootstrap.Messages, BuildQuery(0));
            }
            else
            {
                if (!await LoadMessagesAsync(offset: 0, replace: true, cancellationToken))
                {
                    return;
                }
            }

            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
        }
        catch when (epoch != _loadEpoch)
        {
            // Ignore errors from a previous session.
        }
        finally
        {
            if (epoch == _loadEpoch)
            {
                IsLoading = false;
            }
        }
    }

    /// <summary>Ошибка загрузки, выставленная шеллом при инициализации страниц.</summary>
    public void SetLoadError(string message)
    {
        BannerErrorText = message;
        IsLoading = false;
    }

    /// <summary>
    /// Мягкая перезагрузка по realtime-событию (mail.message.received /
    /// mail.unread.changed / mail.message.state_changed, hub.realtime.connected,
    /// hub.notification.created): unread-агрегат, дерево папок и первая страница
    /// списка — без IsLoading-индикатора и без сброса открытого письма
    /// (выбранная строка перевыбирается по id, Detail подтягивается свежей).
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
        var version = _listRequestVersion;
        try
        {
            var unread = await _api.GetMailUnreadCountAsync(_mailboxId, cancellationToken);
            if (epoch != _loadEpoch)
            {
                // Сессия сменилась (Reset) — чужие данные не применяем.
                return;
            }

            TotalUnreadCount = Math.Max(0, unread.Count);
            if (ShowSetupHint || version != _listRequestVersion)
            {
                return;
            }

            var query = _appliedListQuery ?? BuildQuery(0);
            var page = await _api.GetMailMessagesAsync(query, cancellationToken);
            if (!IsCurrentListRequest(version, query, cancellationToken))
            {
                return;
            }

            _listRequestVersion++;
            var selectedId = _selectedItem?.Id;
            Items.Clear();
            ApplyPage(page, query);

            if (selectedId is not null)
            {
                var reselect = Items.FirstOrDefault(item => item.Id == selectedId);
                if (reselect is not null)
                {
                    // Сеттер перезагрузит открытую деталь свежей версией письма.
                    SelectedItem = reselect;
                }
            }

            var tree = await _api.GetMailFolderTreeAsync(_mailboxId, cancellationToken);
            if (epoch != _loadEpoch)
            {
                return;
            }

            if (tree.Items is { Count: > 0 })
            {
                ApplyFolderTree(tree);
            }

            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
        }
        catch
        {
            // Тихая подсказка realtime: баннер не трогаем, Refresh догонит позже.
        }
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        _detailLoadCancellation?.Cancel();
        _loadEpoch++;
        _listRequestVersion++;
        _appliedListQuery = null;
        _nextMailOffset = null;
        _realtimeRefreshQueued = false;
        _mailboxId = null;
        _currentFolder = "inbox";
        Folders.Clear();
        SelectedFolder = null;
        Items.Clear();
        Detail = null;
        SelectedItem = null;
        BannerErrorText = null;
        DetailErrorText = null;
        // Папки: редактор и armed-подтверждение сбрасываем вместе с деревом.
        CloseFolderEditor();
        if (_armedFolderDelete is { } armed)
        {
            _armedFolderDelete = null;
            armed.DeleteArmed = false;
        }

        // AI-контекст привязан к сессии: opt-in и серверный гейт спрашиваем заново.
        CancelAiLoad();
        _mailAiEnabled = false;
        MailAiServerDisabled = false;
        AiConsentOpen = false;
        _pendingAiAction = null;
        SearchText = string.Empty;
        SearchAllFolders = false;
        _showingAllFolderResults = false;
        SearchStatusText = null;
        Filter = "all";
        _total = 0;
        HasMore = false;
        TotalUnreadCount = 0;
        TotalText = string.Empty;
        LastUpdatedText = string.Empty;
        MailboxLabel = string.Empty;
        ShowSetupHint = false;
        SetupHintText = string.Empty;
        IsLoading = false;
        IsLoadingMore = false;
        IsDetailLoading = false;
        StatusInfoText = null;
        _attachmentDownloadsInFlight.Clear();
        OnPropertyChanged(nameof(IsTrashFolder));
        OnPropertyChanged(nameof(ShowBulkSoftDelete));
        CloseComposer();
        CloseItRequest();
    }

    private void ApplyMailboxInfo(HubMailMailboxInfo? info)
    {
        _mailboxId = info?.Id ?? info?.MailboxId ?? _mailboxId;
        MailboxLabel = (info?.Label ?? info?.MailboxEmail ?? string.Empty).ReplaceLineEndings(" ").Trim();
        if (info is null)
        {
            ShowSetupHint = false;
            SetupHintText = string.Empty;
            return;
        }

        if (info.MailRequiresRelogin)
        {
            ShowSetupHint = true;
            SetupHintText =
                "Для доступа к почте нужно заново войти в HUB через веб-версию, " +
                "затем обновить страницу здесь.";
        }
        else if (info.MailRequiresPassword)
        {
            ShowSetupHint = true;
            SetupHintText =
                "Ящик ждёт пароль корпоративной почты. Введите его в веб-версии HUB " +
                "(раздел «Почта»), затем обновите страницу здесь.";
        }
        else if (!info.MailIsConfigured)
        {
            ShowSetupHint = true;
            SetupHintText =
                "Почта не настроена. Подключите ящик в веб-версии HUB (раздел «Почта»), " +
                "затем обновите страницу здесь.";
        }
        else
        {
            ShowSetupHint = false;
            SetupHintText = string.Empty;
        }
    }

    private void ApplyFolderTree(HubMailFolderTree? tree)
    {
        var nodes = (tree?.Items ?? [])
            .Select(f => new MailFolderViewModel(f))
            .ToList();
        var byId = nodes
            .GroupBy(n => n.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        var childrenByParent = nodes
            .Where(n => !string.IsNullOrWhiteSpace(n.ParentId))
            .GroupBy(n => n.ParentId!.Trim(), StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.ToList(), StringComparer.OrdinalIgnoreCase);
        foreach (var node in nodes)
        {
            node.HasChildren = childrenByParent.TryGetValue(node.Id, out var own) && own.Count > 0;
        }

        // DFS: дети следуют за родителем (отступ + chevron), уровень —
        // как раньше: стандартные по рангу, затем по label; «осиротевшие»
        // узлы (parent_id нет в выдаче) показываем корнями.
        var ordered = new List<MailFolderViewModel>(nodes.Count);
        void Visit(MailFolderViewModel node, int depth)
        {
            node.Depth = depth;
            ordered.Add(node);
            if (!childrenByParent.TryGetValue(node.Id, out var childNodes))
            {
                return;
            }

            foreach (var child in childNodes
                         .OrderBy(c => c.SortRank)
                         .ThenBy(c => c.Label, StringComparer.CurrentCulture))
            {
                child.Parent = node;
                Visit(child, depth + 1);
            }
        }

        var roots = nodes
            .Where(n => string.IsNullOrWhiteSpace(n.ParentId) || !byId.ContainsKey(n.ParentId!.Trim()))
            .OrderBy(f => f.SortRank)
            .ThenBy(f => f.Label, StringComparer.CurrentCulture);
        foreach (var root in roots)
        {
            Visit(root, 0);
        }

        Folders.Clear();
        foreach (var folder in ordered)
        {
            folder.UpdateTreeVisibility();
            Folders.Add(folder);
        }

        // Текущая папка могла исчезнуть из дерева — откатываемся на inbox/первую.
        var selected = Folders.FirstOrDefault(f => f.Id == _currentFolder)
            ?? Folders.FirstOrDefault(f => f.WellKnownKey == _currentFolder)
            ?? Folders.FirstOrDefault(f => f.WellKnownKey == "inbox")
            ?? Folders.FirstOrDefault();
        SelectedFolder = selected;
        _currentFolder = selected?.Id ?? "inbox";
        OnPropertyChanged(nameof(MoveTargets));
        OnPropertyChanged(nameof(IsTrashFolder));
        OnPropertyChanged(nameof(ShowBulkSoftDelete));
        RaiseBulkCommandsCanExecuteChanged();
    }

    private async Task SelectFolderCoreAsync(string folderId, CancellationToken cancellationToken)
    {
        _currentFolder = folderId;
        OnPropertyChanged(nameof(IsTrashFolder));
        OnPropertyChanged(nameof(ShowBulkSoftDelete));
        RaiseBulkCommandsCanExecuteChanged();
        SelectedFolder = Folders.FirstOrDefault(f => f.Id == folderId);
        Detail = null;
        SelectedItem = null;
        await LoadMessagesAsync(offset: 0, replace: true, cancellationToken);
    }

    /// <summary>Смена папки из UI: ошибки показываются баннером, как у команд.</summary>
    private async Task SelectFolderSafelyAsync(string folderId)
    {
        try
        {
            await SelectFolderCoreAsync(folderId, CancellationToken.None);
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    private HubMailMessageQuery BuildQuery(int offset) => new()
    {
        MailboxId = _mailboxId,
        Folder = _currentFolder,
        Limit = PageSize,
        Offset = offset,
        Search = string.IsNullOrWhiteSpace(SearchText) ? null : SearchText.Trim(),
        FolderScope = SearchAllFolders && !string.IsNullOrWhiteSpace(SearchText) ? "all" : "current",
        UnreadOnly = UnreadOnly,
    };

    /// <summary>Страница списка: replace=true пересобирает Items, иначе — догрузка в конец.</summary>
    private async Task<bool> LoadMessagesAsync(
        int offset,
        bool replace,
        CancellationToken cancellationToken)
    {
        var query = BuildQuery(offset);
        var version = ++_listRequestVersion;
        HubMailMessagePage page;
        try
        {
            page = await _api.GetMailMessagesAsync(query, cancellationToken);
        }
        catch when (!IsCurrentListRequest(version, query, cancellationToken))
        {
            return false;
        }
        if (!IsCurrentListRequest(version, query, cancellationToken))
        {
            return false;
        }
        if (replace)
        {
            Items.Clear();
        }

        ApplyPage(page, query with { Offset = 0 });
        return true;
    }

    private bool IsCurrentListRequest(int version, HubMailMessageQuery query, CancellationToken cancellationToken) =>
        version == _listRequestVersion && !cancellationToken.IsCancellationRequested && query == BuildQuery(query.Offset);

    private void ApplyPage(HubMailMessagePage? page, HubMailMessageQuery? query = null)
    {
        _appliedListQuery = query;
        _nextMailOffset = page?.NextOffset;
        var allFolders = query?.FolderScope == "all";
        if (_showingAllFolderResults != allFolders)
        {
            _showingAllFolderResults = allFolders;
            OnPropertyChanged(nameof(IsTrashFolder));
            OnPropertyChanged(nameof(ShowBulkSoftDelete));
            ((NativeAsyncCommand)DeleteCommand).RaiseCanExecuteChanged();
        }
        _total = page?.Total ?? 0;
        HasMore = page?.HasMore == true && page.NextOffset is not null;
        TotalText = _total.ToString(CultureInfo.CurrentCulture);
        var limited = page?.SearchLimited == true ? "Выдача неполная: уточните запрос." : null;
        var skipped = page is { SkippedFolders: > 0 } ? $"Недоступные папки: {page.SkippedFolders}." : null;
        SearchStatusText = limited is null ? skipped : skipped is null ? limited : $"{limited} {skipped}";
        // Догрузка по offset: приход/удаление письма между страницами сдвигает
        // позиции и одно сообщение может вернуться на двух страницах —
        // пропускаем уже показанные id (как dedup в веб-клиенте).
        var seen = new HashSet<string>(Items.Select(i => i.Id), StringComparer.Ordinal);
        foreach (var item in page?.Items ?? [])
        {
            if (!string.IsNullOrEmpty(item.Id) && !seen.Add(item.Id))
            {
                continue;
            }
            Items.Add(new MailListItemViewModel(item));
        }
    }

    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        if (_nextMailOffset is not int offset || _appliedListQuery != BuildQuery(0))
        {
            return;
        }
        IsLoadingMore = true;
        try
        {
            if (await LoadMessagesAsync(offset, replace: false, cancellationToken))
            {
                BannerErrorText = null;
            }
        }
        finally
        {
            IsLoadingMore = false;
        }
    }

    private async Task LoadDetailSafelyAsync(string id)
    {
        _detailLoadCancellation?.Cancel();
        var cancellation = new CancellationTokenSource();
        _detailLoadCancellation = cancellation;
        IsDetailLoading = true;
        DetailErrorText = null;
        // AI-панели привязаны к письму: смена выбора гасит пересказ/чипы/согласие.
        if (!string.Equals(Detail?.Id, id, StringComparison.Ordinal))
        {
            CancelAiLoad();
            AiConsentOpen = false;
        }

        try
        {
            var detail = await _api.GetMailMessageAsync(id, _mailboxId, cancellation.Token);
            if (_selectedItem?.Id != id)
            {
                return;
            }

            if (Detail is null)
            {
                Detail = new MailDetailViewModel(detail);
            }
            else
            {
                Detail.Update(detail);
            }

            // Прочитано при открытии — как в веб-почте (mark_read_on_select по умолчанию).
            var wasUnread = _selectedItem?.IsUnread == true;
            if (wasUnread)
            {
                _selectedItem?.MarkRead();
                Detail.MarkRead();
                ApplyUnreadDelta(-1);
                _ = MarkReadSafelyAsync(id);
            }
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

    private async Task ToggleReadCurrentAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { CanRunActions: true } detail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsActionBusy = true;
        try
        {
            if (detail.IsUnread)
            {
                await _api.MarkMailMessageReadAsync(detail.Id, _mailboxId, cancellationToken);
                detail.MarkRead();
                _selectedItem?.MarkRead();
                ApplyUnreadDelta(-1);
            }
            else
            {
                await _api.MarkMailMessageUnreadAsync(detail.Id, _mailboxId, cancellationToken);
                detail.MarkUnread();
                _selectedItem?.MarkUnread();
                ApplyUnreadDelta(1);
            }
        }
        finally
        {
            detail.IsActionBusy = false;
        }
    }

    private async Task DeleteCurrentAsync(CancellationToken cancellationToken)
    {
        // A soft delete of an item in Trash is destructive on the server.
        if (Detail is not { } detail || !CanSoftDeleteDetail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsActionBusy = true;
        try
        {
            // Первый срез — только мягкое удаление в «Удалённые» (permanent=false).
            await _api.DeleteMailMessageAsync(
                detail.Id, _mailboxId, permanent: false, cancellationToken);
            RemoveListItem(detail.Id);
            Detail = null;
            SelectedItem = null;
        }
        finally
        {
            detail.IsActionBusy = false;
        }
    }

    /// <summary>
    /// DELETE /mail/drafts/{id} из панели чтения: строка уходит из списка,
    /// счётчики папки пересчитываются (permanent-операция, отдельного подтверждения нет).
    /// </summary>
    private async Task DeleteDraftCurrentAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { CanRunActions: true, DraftContext: not null } detail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsActionBusy = true;
        try
        {
            var result = await _api.DeleteMailDraftAsync(detail.Id, _mailboxId, cancellationToken);
            if (!result.Ok)
            {
                DetailErrorText = "Черновик не удалён.";
                return;
            }

            RemoveListItem(detail.Id);
            Detail = null;
            SelectedItem = null;
            StatusInfoText = "Черновик удалён";
            await RefreshFolderTreeSafelyAsync();
        }
        finally
        {
            detail.IsActionBusy = false;
        }
    }

    /// <summary>Сдвиг счётчиков непрочитанных: бейдж папки письма и агрегат ящика.</summary>
    private void ApplyUnreadDelta(int delta)
    {
        var folder = _selectedItem is { } selected
            ? Folders.FirstOrDefault(f => f.Id == selected.Folder || f.WellKnownKey == selected.Folder)
            : null;
        folder ??= SelectedFolder;
        if (delta < 0)
        {
            folder?.DecrementUnread();
        }
        else if (delta > 0)
        {
            folder?.IncrementUnread();
        }

        TotalUnreadCount = Math.Max(0, TotalUnreadCount + delta);
    }

    private async Task MarkReadSafelyAsync(string id)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            return;
        }

        try
        {
            await _api.MarkMailMessageReadAsync(id, _mailboxId, CancellationToken.None);
        }
        catch
        {
            // Отметка о прочтении — best-effort: ошибка не должна мешать чтению письма.
        }
    }

    // ---- Композер ----

    /// <summary>Новое письмо: пустой композер без ссылок на исходное сообщение.</summary>
    internal void OpenCompose(string mode)
    {
        WireComposer(new MailComposeViewModel(_api, () => _mailboxId, ComposeFilePicker)
        {
            Mode = mode,
        });
    }

    /// <summary>
    /// Ответ/ответ всем/пересылка из панели чтения. Основной источник префилла —
    /// compose_context backend'а (тема с Re:/Fwd:, получатели, quote_html → plain text);
    /// без него собираем минимальный вариант из полей письма.
    /// </summary>
    internal void OpenComposeFromDetail(string mode)
    {
        if (Detail is not { } detail)
        {
            return;
        }

        var composer = new MailComposeViewModel(_api, () => _mailboxId, ComposeFilePicker)
        {
            Mode = mode,
            FromMailboxId = detail.ComposeContext?.MailboxId,
        };
        var scenario = mode switch
        {
            "reply" => detail.ComposeContext?.Reply,
            "reply_all" => detail.ComposeContext?.ReplyAll,
            "forward" => detail.ComposeContext?.Forward,
            _ => null,
        };
        if (scenario is not null)
        {
            composer.Subject = scenario.Subject ?? string.Empty;
            composer.To = string.Join("; ", scenario.To ?? []);
            composer.Cc = string.Join("; ", scenario.Cc ?? []);
            composer.Bcc = string.Join("; ", scenario.Bcc ?? []);
            var quote = MailHtmlText.ToPlainText(scenario.QuoteHtml);
            composer.Body = quote.Length > 0 ? "\n\n" + quote : string.Empty;
        }
        else
        {
            var subject = detail.Subject == "(без темы)" ? string.Empty : detail.Subject;
            composer.Subject = mode == "forward"
                ? EnsureSubjectPrefix(subject, "Fwd: ", "fwd:", "пересл")
                : EnsureSubjectPrefix(subject, "Re: ", "re:", "ответ");
            if (mode != "forward" && !string.IsNullOrWhiteSpace(detail.SenderEmail))
            {
                composer.To = detail.SenderEmail;
            }

            composer.Body =
                $"\n\nОт: {detail.SenderText}\nДата: {detail.DateText}\nТема: {detail.Subject}\n\n{detail.Body}";
        }

        if (mode == "forward")
        {
            composer.ForwardMessageId = detail.Id;
            composer.SetRetainedAttachmentsHint(detail.ForwardableAttachmentCount);
        }
        else
        {
            composer.ReplyToMessageId = detail.Id;
        }

        WireComposer(composer);
    }

    /// <summary>Черновик из панели чтения: поля письма + draft_context (режим/ссылки).</summary>
    private void OpenDraftFromDetail()
    {
        if (Detail is not { DraftContext: { } draftContext } detail)
        {
            return;
        }

        var composer = new MailComposeViewModel(_api, () => _mailboxId, ComposeFilePicker)
        {
            Mode = string.IsNullOrWhiteSpace(draftContext.ComposeMode)
                ? "draft"
                : draftContext.ComposeMode!,
            DraftId = detail.Id,
            ReplyToMessageId = draftContext.ReplyToMessageId,
            ForwardMessageId = draftContext.ForwardMessageId,
            FromMailboxId = draftContext.MailboxId ?? detail.MailboxId,
            To = detail.ToText,
            Cc = detail.CcText,
            Subject = detail.Subject == "(без темы)" ? string.Empty : detail.Subject,
            Body = detail.Body,
            // Вложения, уже лежащие на сервере в черновике, просим сохранить.
            RetainExistingAttachments = detail.Attachments
                .Select(a => a.Model.Id ?? a.Ref)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToList(),
        };
        composer.SetServerAttachmentsNote(detail.Attachments.Count);
        WireComposer(composer);
    }

    private static string EnsureSubjectPrefix(string subject, string prefix, params string[] known)
    {
        var trimmed = subject.TrimStart();
        return known.Any(k => trimmed.StartsWith(k, StringComparison.OrdinalIgnoreCase))
            ? subject
            : prefix + subject;
    }

    private void WireComposer(MailComposeViewModel composer)
    {
        composer.Sent += OnComposerSent;
        composer.DraftSaved += OnComposerDraftSaved;
        composer.DraftDeleted += OnComposerDraftDeleted;
        composer.Closed += (_, _) => CloseComposer();
        Composer = composer;
    }

    internal void CloseComposer()
    {
        if (Composer is { } old)
        {
            old.Sent -= OnComposerSent;
            old.DraftSaved -= OnComposerDraftSaved;
            old.DraftDeleted -= OnComposerDraftDeleted;
            old.CloseContactSuggestions();
        }

        Composer = null;
    }

    /// <summary>Черновик отправлен через send → backend удалил draft: строку убираем.</summary>
    private async void OnComposerSent(object? sender, HubMailSendResult result)
    {
        if (sender is not MailComposeViewModel composer)
        {
            return;
        }

        var sentDraftId = composer.DraftId;
        CloseComposer();
        StatusInfoText = "Отправлено";
        if (!string.IsNullOrWhiteSpace(sentDraftId)
            && Items.Any(item => item.Id == sentDraftId))
        {
            RemoveListItem(sentDraftId);
        }

        // Отправленное видно в «Отправленные»; удалённый черновик — в «Черновики».
        if (IsFolder("sent") || (!string.IsNullOrWhiteSpace(sentDraftId) && IsFolder("drafts")))
        {
            try
            {
                await LoadMessagesAsync(offset: 0, replace: true, CancellationToken.None);
            }
            catch
            {
                // Список обновится следующим Refresh — отправка уже подтверждена.
            }
        }

        await RefreshFolderTreeSafelyAsync();
    }

    /// <summary>Черновик удалён из композера: строка в «Черновиках» исчезает, счётчики обновляем.</summary>
    private void OnComposerDraftDeleted(object? sender, EventArgs e)
    {
        if (sender is not MailComposeViewModel composer)
        {
            return;
        }

        var draftId = composer.DraftId;
        CloseComposer();
        StatusInfoText = "Черновик удалён";
        if (!string.IsNullOrWhiteSpace(draftId))
        {
            RemoveListItem(draftId);
        }

        _ = RefreshFolderTreeSafelyAsync();
    }

    private void OnComposerDraftSaved(object? sender, HubMailDraftSaveResult result)
    {
        StatusInfoText = "Черновик сохранён";
        if (IsFolder("drafts"))
        {
            _ = ReloadListSafelyAsync();
        }

        _ = RefreshFolderTreeSafelyAsync();
    }

    // ---- Заявка в IT (шаблонная форма) ----

    /// <summary>
    /// «IT-заявка»: активные шаблоны грузятся при открытии (GET /mail/templates),
    /// затем открывается оверлей-форма. Ошибка загрузки — баннером страницы.
    /// </summary>
    private async Task OpenItRequestAsync(CancellationToken cancellationToken)
    {
        if (ItRequest is not null || ShowSetupHint)
        {
            return;
        }

        var templates = await _api.GetMailTemplatesAsync(
            includeInactive: false, cancellationToken);
        var itRequest = new MailItRequestViewModel(_api, templates, ComposeFilePicker);
        itRequest.Sent += OnItRequestSent;
        itRequest.Closed += (_, _) => CloseItRequest();
        ItRequest = itRequest;
    }

    /// <summary>Гасит оверлей заявки и отписывается (Reset тоже идёт сюда).</summary>
    internal void CloseItRequest()
    {
        if (ItRequest is { } old)
        {
            old.Sent -= OnItRequestSent;
        }

        ItRequest = null;
    }

    /// <summary>Заявка отправлена: закрыть оверлей, статус и счётчики папок обновить.</summary>
    private async void OnItRequestSent(object? sender, HubMailSendResult result)
    {
        CloseItRequest();
        StatusInfoText = "Отправлено";
        await RefreshFolderTreeSafelyAsync();
    }

    private bool IsFolder(string wellKnown) =>
        Folders.FirstOrDefault(f => f.Id == _currentFolder)?.WellKnownKey == wellKnown
        || string.Equals(_currentFolder, wellKnown, StringComparison.Ordinal);

    private async Task ReloadListSafelyAsync()
    {
        try
        {
            await LoadMessagesAsync(offset: 0, replace: true, CancellationToken.None);
        }
        catch
        {
        }
    }

    private async Task RefreshFolderTreeSafelyAsync()
    {
        try
        {
            var tree = await _api.GetMailFolderTreeAsync(_mailboxId, CancellationToken.None);
            if (tree.Items is { Count: > 0 })
            {
                ApplyFolderTree(tree);
            }
        }
        catch
        {
            // Счётчики папок подтянутся ближайшим Refresh — не блокируем сценарий.
        }
    }

    // ---- Переместить ----

    private async Task MoveCurrentAsync(string targetFolder, CancellationToken cancellationToken)
    {
        if (Detail is not { CanRunActions: true, CanMove: true } detail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsActionBusy = true;
        try
        {
            await _api.MoveMailMessageAsync(detail.Id, _mailboxId, targetFolder, cancellationToken);
            var label = Folders.FirstOrDefault(f => f.Id == targetFolder)?.Label ?? targetFolder;
            RemoveListItem(detail.Id);
            Detail = null;
            SelectedItem = null;
            StatusInfoText = $"Перемещено в «{label}»";
        }
        finally
        {
            detail.IsActionBusy = false;
        }
    }

    /// <summary>Удаление строки списка + пересчёт непрочитанных и total пагинации.</summary>
    private void RemoveListItem(string id)
    {
        var item = Items.FirstOrDefault(i => i.Id == id);
        if (item is null)
        {
            return;
        }

        if (item.IsUnread)
        {
            ApplyUnreadDelta(-1);
        }

        Items.Remove(item);
        _total = Math.Max(0, _total - 1);
        TotalText = _total.ToString(CultureInfo.CurrentCulture);
        OnPropertyChanged(nameof(MoreButtonText));
    }

    // ---- Вложения письма ----

    /// <summary>
    /// Скачивание в %TEMP%/hub-desktop/mail-attachments и открытие ОС —
    /// паттерн DownloadChatAttachmentAsync: стрим в файл, имя из Content-Disposition,
    /// защита от повторного клика по тому же вложению.
    /// </summary>
    private async Task DownloadAttachmentAsync(
        MailAttachmentItemViewModel attachment,
        CancellationToken cancellationToken)
    {
        if (Detail is not { } detail)
        {
            return;
        }

        var key = detail.Id + ":" + attachment.Ref;
        if (!_attachmentDownloadsInFlight.Add(key))
        {
            return;
        }

        attachment.IsDownloading = true;
        try
        {
            if (AttachmentSaver is not null)
            {
                await AttachmentSaver(attachment, detail.Id);
                return;
            }

            var directory = Path.Combine(
                Path.GetTempPath(), "hub-desktop", "mail-attachments");
            Directory.CreateDirectory(directory);
            var safeName = string.Concat(
                attachment.Name.Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
            if (string.IsNullOrWhiteSpace(safeName))
            {
                safeName = "attachment.bin";
            }

            var target = Path.Combine(directory, $"{detail.Id}-{safeName}");
            if (!File.Exists(target) || new FileInfo(target).Length != attachment.Model.Size)
            {
                await using var destination = new FileStream(
                    target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, true);
                var downloadedName = await _api.DownloadMailAttachmentAsync(
                    detail.Id, attachment.Ref, _mailboxId, destination, cancellationToken);
                if (!string.IsNullOrWhiteSpace(downloadedName)
                    && !string.Equals(downloadedName, safeName, StringComparison.OrdinalIgnoreCase))
                {
                    var renamed = Path.Combine(directory, $"{detail.Id}-{downloadedName}");
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

            StatusInfoText = "Вложение сохранено";
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        finally
        {
            attachment.IsDownloading = false;
            _attachmentDownloadsInFlight.Remove(key);
        }
    }

    // ---- Массовые действия ----

    private void OnItemCheckedChanged(object? sender, PropertyChangedEventArgs args)
    {
        if (args.PropertyName is nameof(MailListItemViewModel.IsChecked) or "")
        {
            OnSelectionChanged();
        }
    }

    private void OnSelectionChanged()
    {
        OnPropertyChanged(nameof(SelectedCount));
        OnPropertyChanged(nameof(HasSelection));
        OnPropertyChanged(nameof(SelectionText));
        OnPropertyChanged(nameof(IsAllLoadedChecked));
        // Items меняется вместе с выбором (догрузка, bulk-удаление) —
        // подписи счётчиков обновляем из той же точки: иначе «Показать ещё (N)»
        // оставался со старым N, если HasMore не сменил значение.
        OnPropertyChanged(nameof(ListHeaderCountText));
        OnPropertyChanged(nameof(MoreButtonText));
        OnPropertyChanged(nameof(LoadMoreToolTip));
        RaiseBulkCommandsCanExecuteChanged();
        ((NativeRelayCommand)ClearSelectionCommand).RaiseCanExecuteChanged();
    }

    private void RaiseBulkCommandsCanExecuteChanged()
    {
        ((NativeAsyncCommand)BulkMarkReadCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BulkMarkUnreadCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BulkDeleteCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BulkDeletePermanentCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BulkArchiveCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)BulkMoveCommand).RaiseCanExecuteChanged();
    }

    internal void SetAllChecked(bool isChecked)
    {
        foreach (var item in Items)
        {
            item.IsChecked = isChecked;
        }

        OnSelectionChanged();
    }

    /// <summary>
    /// POST /mail/messages/bulk над отмеченными: read/unread правят флаги строк и
    /// счётчики, delete/move/archive убирают строки из текущей выдачи.
    /// Сервер отвечает per-id errors[] — ошибочные id локально не трогаем.
    /// </summary>
    private async Task BulkActionAsync(
        string action,
        string? targetFolder,
        bool permanent,
        CancellationToken cancellationToken)
    {
        var selected = Items.Where(item => item.IsChecked).ToList();
        if (selected.Count == 0)
        {
            return;
        }

        await RunItemsActionAsync(selected, action, targetFolder, permanent, cancellationToken);
    }

    /// <summary>
    /// Общее ядро массовых и строковых действий (kebab-меню письма работает с
    /// одним адресатом): один API-вызов, одинаковые дельты непрочитанных,
    /// удаление из выдачи и снятие открытой детали, если письмо ушло.
    /// </summary>
    private async Task RunItemsActionAsync(
        IReadOnlyList<MailListItemViewModel> targets,
        string action,
        string? targetFolder,
        bool permanent,
        CancellationToken cancellationToken)
    {
        if (targets.Count == 0 || IsBulkBusy || (action == "delete" && !permanent && _showingAllFolderResults))
        {
            return;
        }

        IsBulkBusy = true;
        try
        {
            var ids = targets.Select(item => item.Id).ToList();
            var result = await _api.BulkMailMessageActionAsync(
                _mailboxId, action, ids, targetFolder, permanent, cancellationToken);
            var failedIds = result.Errors?
                .Select(error => error.MessageId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.Ordinal) ?? [];
            var succeeded = targets.Where(item => !failedIds.Contains(item.Id)).ToList();
            // «Все папки»: выделение может охватывать разные папки — дельту
            // считаем по фактической папке каждого письма, а не текущей выдачи.
            var unreadDeltas = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            void BumpUnreadDelta(string? folderId, int delta)
            {
                var key = string.IsNullOrWhiteSpace(folderId) ? _currentFolder : folderId;
                unreadDeltas[key] = unreadDeltas.TryGetValue(key, out var current) ? current + delta : delta;
            }

            switch (action)
            {
                case "mark_read":
                    foreach (var item in succeeded.Where(item => item.IsUnread))
                    {
                        item.MarkRead();
                        BumpUnreadDelta(item.Folder, -1);
                    }

                    break;
                case "mark_unread":
                    foreach (var item in succeeded.Where(item => !item.IsUnread))
                    {
                        item.MarkUnread();
                        BumpUnreadDelta(item.Folder, 1);
                    }

                    break;
                default:
                    // delete/move/archive — письмо уходит из текущей папки.
                    foreach (var item in succeeded)
                    {
                        if (item.IsUnread)
                        {
                            BumpUnreadDelta(item.Folder, -1);
                        }

                        Items.Remove(item);
                        _total = Math.Max(0, _total - 1);
                    }

                    TotalText = _total.ToString(CultureInfo.CurrentCulture);
                    OnPropertyChanged(nameof(MoreButtonText));
                    if (SelectedItem is { } current
                        && succeeded.Any(item => item.Id == current.Id))
                    {
                        Detail = null;
                        SelectedItem = null;
                    }

                    break;
            }

            if (unreadDeltas.Count > 0)
            {
                ApplyUnreadDeltas(unreadDeltas);
            }

            StatusInfoText = result.Failed > 0
                ? $"Готово: {result.Succeeded} из {ids.Count}, ошибок: {result.Failed}"
                : $"Готово: {result.Succeeded} из {ids.Count}";
            await RefreshFolderTreeSafelyAsync();
        }
        finally
        {
            IsBulkBusy = false;
        }
    }

    /// <summary>Дельты непрочитанных по фактической папке каждого письма.</summary>
    private void ApplyUnreadDeltas(IReadOnlyDictionary<string, int> deltas)
    {
        var total = 0;
        foreach (var (folderId, delta) in deltas)
        {
            var folder = Folders.FirstOrDefault(f => f.Id == folderId || f.WellKnownKey == folderId);
            if (folder is not null)
            {
                folder.SetUnread(Math.Max(0, folder.Unread + delta));
            }

            total += delta;
        }

        if (total != 0)
        {
            TotalUnreadCount = Math.Max(0, TotalUnreadCount + total);
        }
    }

    // ---- Папки: создание/переименование/удаление/избранное ----

    /// <summary>Inline-редактор имени папки над списком папок (режим create/rename).</summary>
    public bool IsFolderEditorOpen
    {
        get => _isFolderEditorOpen;
        private set
        {
            if (SetProperty(ref _isFolderEditorOpen, value))
            {
                ((NativeAsyncCommand)ConfirmFolderEditorCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string FolderEditorTitle => _folderEditorMode == "rename"
        ? "Переименовать папку"
        : _folderEditorParent is { } parent
            ? $"Новая вложенная в «{parent.Label}»"
            : "Новая папка";

    /// <summary>Двустороннее поле имени в редакторе папки.</summary>
    public string FolderEditorName
    {
        get => _folderEditorName;
        set => SetProperty(ref _folderEditorName, value);
    }

    /// <summary>Локальная ошибка редактора (пустое имя, отказ API) — показывается внутри панели.</summary>
    public string? FolderEditorErrorText
    {
        get => _folderEditorErrorText;
        private set
        {
            if (SetProperty(ref _folderEditorErrorText, value))
            {
                OnPropertyChanged(nameof(HasFolderEditorError));
            }
        }
    }

    public bool HasFolderEditorError => !string.IsNullOrEmpty(FolderEditorErrorText);

    public bool IsFolderEditorBusy
    {
        get => _isFolderEditorBusy;
        private set
        {
            if (SetProperty(ref _isFolderEditorBusy, value))
            {
                OnPropertyChanged(nameof(FolderEditorConfirmText));
                ((NativeAsyncCommand)ConfirmFolderEditorCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string FolderEditorConfirmText => IsFolderEditorBusy
        ? "Сохраняем…"
        : _folderEditorMode == "rename" ? "Переименовать" : "Создать";

    private void OpenFolderEditor(
        string mode,
        MailFolderViewModel? parent,
        MailFolderViewModel? target)
    {
        _folderEditorMode = mode;
        _folderEditorParent = parent;
        _folderEditorTarget = target;
        FolderEditorName = mode == "rename" ? target?.Label ?? string.Empty : string.Empty;
        FolderEditorErrorText = null;
        IsFolderEditorOpen = true;
        OnPropertyChanged(nameof(FolderEditorTitle));
        OnPropertyChanged(nameof(FolderEditorConfirmText));
    }

    private void CloseFolderEditor()
    {
        IsFolderEditorOpen = false;
        _folderEditorTarget = null;
        _folderEditorParent = null;
        FolderEditorErrorText = null;
    }

    /// <summary>
    /// POST /mail/folders или PATCH /mail/folders/{id}: созданная папка вставляется
    /// в рейку локально (узел из ответа), затем дерево догоняет счётчики.
    /// </summary>
    private async Task ConfirmFolderEditorAsync(CancellationToken cancellationToken)
    {
        var name = FolderEditorName.Trim();
        if (name.Length == 0)
        {
            FolderEditorErrorText = "Введите имя папки.";
            return;
        }

        IsFolderEditorBusy = true;
        try
        {
            if (_folderEditorMode == "rename")
            {
                if (_folderEditorTarget is not { ShowRename: true } target)
                {
                    CloseFolderEditor();
                    return;
                }

                var updated = await _api.RenameMailFolderAsync(
                    target.Id, _mailboxId, name, cancellationToken);
                target.ApplyFolderNode(updated);
                StatusInfoText = $"Папка переименована в «{target.Label}»";
            }
            else
            {
                var created = await _api.CreateMailFolderAsync(
                    _mailboxId,
                    name,
                    _folderEditorParent?.Id,
                    _folderEditorParent?.Scope ?? "mailbox",
                    cancellationToken);
                var model = new MailFolderViewModel(created);
                InsertFolderSorted(model);
                StatusInfoText = $"Папка «{model.Label}» создана";
                CloseFolderEditor();
                SelectedFolder = model;
                await RefreshFolderTreeSafelyAsync();
                return;
            }

            CloseFolderEditor();
            await RefreshFolderTreeSafelyAsync();
        }
        finally
        {
            IsFolderEditorBusy = false;
        }
    }

    /// <summary>Вставка созданной папки в ту же сортировку, что у ApplyFolderTree.</summary>
    private void InsertFolderSorted(MailFolderViewModel folder)
    {
        var index = 0;
        while (index < Folders.Count
            && (Folders[index].SortRank < folder.SortRank
                || (Folders[index].SortRank == folder.SortRank
                    && string.Compare(
                        Folders[index].Label,
                        folder.Label,
                        StringComparison.CurrentCulture) < 0)))
        {
            index++;
        }

        Folders.Insert(index, folder);
        OnPropertyChanged(nameof(MoveTargets));
    }

    /// <summary>
    /// DELETE /mail/folders/{id} по серверному can_delete: первый клик в меню
    /// взводит «Точно удалить?», второй удаляет. Текущая папка → откат на inbox.
    /// </summary>
    private async Task DeleteFolderAsync(
        MailFolderViewModel folder,
        CancellationToken cancellationToken)
    {
        if (!folder.ShowDelete || folder.IsBusy)
        {
            return;
        }

        if (!folder.DeleteArmed)
        {
            ArmFolderDelete(folder);
            return;
        }

        folder.DeleteArmed = false;
        _armedFolderDelete = null;
        folder.IsBusy = true;
        try
        {
            await _api.DeleteMailFolderAsync(folder.Id, _mailboxId, cancellationToken);
            var wasCurrent = string.Equals(folder.Id, _currentFolder, StringComparison.Ordinal);
            Folders.Remove(folder);
            OnPropertyChanged(nameof(MoveTargets));
            StatusInfoText = $"Папка «{folder.Label}» удалена";
            if (wasCurrent)
            {
                var fallback = Folders.FirstOrDefault(f => f.WellKnownKey == "inbox")
                    ?? Folders.FirstOrDefault();
                if (fallback is not null)
                {
                    await SelectFolderCoreAsync(fallback.Id, cancellationToken);
                }
                else
                {
                    _currentFolder = "inbox";
                    SelectedFolder = null;
                    Detail = null;
                    SelectedItem = null;
                }
            }

            await RefreshFolderTreeSafelyAsync();
        }
        finally
        {
            folder.IsBusy = false;
        }
    }

    /// <summary>Armed-подтверждение только у одной папки: новое снимает предыдущее.</summary>
    private void ArmFolderDelete(MailFolderViewModel folder)
    {
        if (_armedFolderDelete is { } previous && !ReferenceEquals(previous, folder))
        {
            previous.DeleteArmed = false;
        }

        _armedFolderDelete = folder;
        folder.DeleteArmed = true;
    }

    /// <summary>Избранное — оптимистичный тогл: звезда сразу, при ошибке откатываем.</summary>
    private async Task ToggleFolderFavoriteAsync(
        MailFolderViewModel folder,
        CancellationToken cancellationToken)
    {
        if (folder.IsBusy)
        {
            return;
        }

        folder.IsBusy = true;
        var next = !folder.IsFavorite;
        folder.SetFavorite(next);
        try
        {
            var result = await _api.SetMailFolderFavoriteAsync(
                folder.Id, _mailboxId, next, cancellationToken);
            folder.SetFavorite(result.Favorite);
            await RefreshFolderTreeSafelyAsync();
        }
        catch
        {
            folder.SetFavorite(!next);
            throw;
        }
        finally
        {
            folder.IsBusy = false;
        }
    }

    // ---- Важность письма ----

    /// <summary>
    /// POST /mail/messages/{id}/importance: тогл high↔normal открытого письма —
    /// оптимистично для детали и пилюли строки, ошибка откатывает оба флага.
    /// </summary>
    private async Task ToggleImportanceCurrentAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { CanRunActions: true } detail)
        {
            return;
        }

        DetailErrorText = null;
        detail.IsActionBusy = true;
        var next = !detail.IsImportant;
        detail.SetImportant(next);
        _selectedItem?.SetImportant(next);
        try
        {
            var result = await _api.SetMailMessageImportanceAsync(
                detail.Id, _mailboxId, next ? "high" : "normal", cancellationToken);
            var applied = string.Equals(
                result.Importance, "high", StringComparison.OrdinalIgnoreCase);
            detail.SetImportant(applied);
            _selectedItem?.SetImportant(applied);
        }
        catch
        {
            detail.SetImportant(!next);
            _selectedItem?.SetImportant(!next);
            throw;
        }
        finally
        {
            detail.IsActionBusy = false;
        }
    }

    /// <summary>
    /// Звезда в строке списка: тот же API и семантика отката, что у тогла в
    /// панели чтения; открытая деталь этого же письма остаётся синхронной.
    /// </summary>
    private async Task ToggleItemImportanceAsync(
        MailListItemViewModel item, CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(item.Id))
        {
            return;
        }

        var mailboxId = item.MailboxId ?? _mailboxId;
        var next = !item.IsImportant;
        item.SetImportant(next);
        SyncDetailImportance(item.Id, next);
        try
        {
            var result = await _api.SetMailMessageImportanceAsync(
                item.Id, mailboxId, next ? "high" : "normal", cancellationToken);
            var applied = string.Equals(
                result.Importance, "high", StringComparison.OrdinalIgnoreCase);
            item.SetImportant(applied);
            SyncDetailImportance(item.Id, applied);
        }
        catch
        {
            item.SetImportant(!next);
            SyncDetailImportance(item.Id, !next);
            throw;
        }
    }

    /// <summary>Держим шапку чтения в согласии со звездой строки этого же письма.</summary>
    private void SyncDetailImportance(string itemId, bool important)
    {
        if (Detail is { } detail
            && string.Equals(detail.Id, itemId, StringComparison.Ordinal))
        {
            detail.SetImportant(important);
        }
    }

    /// <summary>
    /// Переместить одно письмо в папку (drag&drop в рейку): то же ядро и семантика,
    /// что у bulk-перемещения; ошибка уходит в баннер, а не в необработанный throw.
    /// </summary>
    internal async Task MoveItemToFolderSafelyAsync(
        MailListItemViewModel item, string targetFolder, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(targetFolder))
        {
            return;
        }

        try
        {
            await RunItemsActionAsync([item], "move", targetFolder, permanent: false, cancellationToken);
        }
        catch (Exception ex)
        {
            BannerErrorText = TasksViewModel.DescribeError(ex);
        }
    }

    /// <summary>
    /// «Восстановить» из «Удалённых»: параметр — строка списка или открытая деталь.
    /// POST /mail/messages/{id}/restore; строка уходит из выдачи, открытая деталь
    /// закрывается, дерево папок пересчитывается (авторитетные счётчики — сервер).
    /// </summary>
    private async Task RestoreItemAsync(object target, CancellationToken cancellationToken)
    {
        var (id, mailboxId) = target switch
        {
            MailListItemViewModel item => (item.Id, item.MailboxId ?? _mailboxId),
            MailDetailViewModel mailDetail => (mailDetail.Id, _mailboxId),
            _ => (string.Empty, _mailboxId),
        };
        if (string.IsNullOrEmpty(id))
        {
            return;
        }

        var result = await _api.RestoreMailMessageAsync(id, mailboxId, cancellationToken);
        if (!result.Ok)
        {
            BannerErrorText = "Письмо не восстановлено.";
            return;
        }

        RemoveListItem(id);
        if (Detail is { } openDetail && string.Equals(openDetail.Id, id, StringComparison.Ordinal))
        {
            Detail = null;
            SelectedItem = null;
        }

        StatusInfoText = "Письмо восстановлено";
        await RefreshFolderTreeSafelyAsync();
    }

    /// <summary>
    /// Режим деталей (Gmail «show details»): раскрывает блок полных заголовков;
    /// первая загрузка кэшируется в детали, повторные тоглы только показывают/прячут.
    /// </summary>
    private async Task ToggleDetailHeadersAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail)
        {
            return;
        }

        if (detail.AreHeadersVisible)
        {
            detail.SetHeadersVisible(false);
            return;
        }

        detail.SetHeadersVisible(true);
        if (!string.IsNullOrEmpty(detail.HeadersText))
        {
            return;
        }

        detail.SetHeadersLoading(true);
        try
        {
            var headers = await _api.GetMailMessageHeadersAsync(detail.Id, _mailboxId, cancellationToken);
            var text = string.Join(
                Environment.NewLine,
                (headers.Items ?? [])
                    .Select(item => $"{item.Name}: {item.Value}"));
            detail.SetHeaders(text, headers.SourceName ?? string.Empty);
        }
        finally
        {
            detail.SetHeadersLoading(false);
        }
    }

    /// <summary>
    /// Тестовый шов для «Скачать исходник»: заменяет сохранение файла и запуск
    /// проводника (как AttachmentSaver у вложений).
    /// </summary>
    internal Func<MailDetailViewModel, Task>? MessageSourceSaver { get; set; }

    /// <summary>
    /// Скачать RFC822-исходник открытого письма в %TEMP%/hub-desktop/mail-sources
    /// и открыть папку проводником — как downloadMessageSource в веб-почте.
    /// </summary>
    private async Task DownloadMessageSourceAsync(CancellationToken cancellationToken)
    {
        if (Detail is not { } detail || string.IsNullOrEmpty(detail.Id))
        {
            return;
        }

        // Тестовый шов (как AttachmentSaver): подмена сохранения без файловой системы.
        if (MessageSourceSaver is { } saver)
        {
            await saver(detail);
            return;
        }

        var directory = Path.Combine(Path.GetTempPath(), "hub-desktop", "mail-sources");
        Directory.CreateDirectory(directory);
        var safeName = string.Concat(
            (detail.Subject ?? detail.Id).Split(Path.GetInvalidFileNameChars(), StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrWhiteSpace(safeName))
        {
            safeName = detail.Id;
        }

        var target = Path.Combine(directory, $"{safeName}.eml");
        string downloadedName;
        await using (var destination = new FileStream(
            target, FileMode.Create, FileAccess.Write, FileShare.None, 81920, useAsync: true))
        {
            downloadedName = await _api.DownloadMailMessageSourceAsync(
                detail.Id, _mailboxId, destination, cancellationToken);
        }

        // Серверное имя файла из Content-Disposition авторитетнее сгенерированного.
        if (!string.IsNullOrWhiteSpace(downloadedName)
            && !string.Equals(downloadedName, Path.GetFileName(target), StringComparison.OrdinalIgnoreCase))
        {
            var renamed = Path.Combine(directory, downloadedName);
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
                    // Имя занято — оставляем сгенерированное.
                }
            }
        }

        StatusInfoText = $"Исходник письма сохранён: {target}";
        Process.Start(new ProcessStartInfo(directory) { UseShellExecute = true });
    }

    // ---- AI: пересказ и быстрые ответы ----

    /// <summary>
    /// Локальное согласие на отправку темы/текста письма во внешний ИИ —
    /// аналог mail_ai_enabled из localStorage веба (здесь — флаг сессии приложения:
    /// после перезапуска согласие спрашиваем заново, серверный гейт отдельно).
    /// </summary>
    public bool IsMailAiEnabled
    {
        get => _mailAiEnabled;
        private set => SetProperty(ref _mailAiEnabled, value);
    }

    /// <summary>
    /// Сервер ответил 403/404 на AI-вызов (MAIL_AI_DISABLED, недоступность маршрута) —
    /// «проба+скрытие»: кнопки AI прячем до конца сессии вместо повторных ошибок.
    /// </summary>
    public bool MailAiServerDisabled
    {
        get => _mailAiServerDisabled;
        private set
        {
            if (SetProperty(ref _mailAiServerDisabled, value))
            {
                OnPropertyChanged(nameof(ShowAiActions));
                RaiseAiCommandsCanExecuteChanged();
            }
        }
    }

    /// <summary>Кнопки «Кратко»/«Быстрые ответы» — при открытом письме и живом AI.</summary>
    public bool ShowAiActions => HasDetail && !MailAiServerDisabled;

    /// <summary>Панель согласия под мета письма — первое нажатие AI-кнопки без opt-in.</summary>
    public bool AiConsentOpen
    {
        get => _aiConsentOpen;
        private set => SetProperty(ref _aiConsentOpen, value);
    }

    /// <summary>Один AI-запрос за раз (пересказ и чипы делят busy-флаг).</summary>
    public bool IsAiBusy
    {
        get => _isAiBusy;
        private set
        {
            if (SetProperty(ref _isAiBusy, value))
            {
                RaiseAiCommandsCanExecuteChanged();
            }
        }
    }

    public bool IsSummaryLoading
    {
        get => _isSummaryLoading;
        private set
        {
            if (SetProperty(ref _isSummaryLoading, value))
            {
                OnPropertyChanged(nameof(ShowSummaryPanel));
                OnPropertyChanged(nameof(SummaryPanelText));
            }
        }
    }

    public bool IsSmartRepliesLoading
    {
        get => _isSmartRepliesLoading;
        private set
        {
            if (SetProperty(ref _isSmartRepliesLoading, value))
            {
                OnPropertyChanged(nameof(SmartRepliesHintText));
            }
        }
    }

    /// <summary>Текст панели пересказа под мета письма.</summary>
    public string? AiSummaryText
    {
        get => _aiSummaryText;
        private set
        {
            if (SetProperty(ref _aiSummaryText, value))
            {
                OnPropertyChanged(nameof(ShowSummaryPanel));
                OnPropertyChanged(nameof(SummaryPanelText));
            }
        }
    }

    public bool ShowSummaryPanel => IsSummaryLoading || !string.IsNullOrEmpty(AiSummaryText);

    public string SummaryPanelText =>
        IsSummaryLoading ? "Собираем пересказ…" : AiSummaryText ?? string.Empty;

    /// <summary>Чипы быстрых ответов под телом письма (до 3 — контракт smart-replies).</summary>
    public ObservableCollection<string> SmartReplies { get; } = [];

    public string SmartRepliesHintText => IsSmartRepliesLoading ? "Придумываем ответы…" : string.Empty;

    /// <summary>Локальная ошибка AI-зоны (rate limit, транспорт) — не баннером, а рядом с панелью.</summary>
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

    /// <summary>Текст согласия — тот же, что MAIL_AI_DISCLOSURE_TEXT у веб-диалога «ИИ для писем».</summary>
    public string MailAiDisclosureText =>
        "Пересказ и подсказки ответа отправляют тему и текст письма во внешний сервис ИИ. " +
        "Не включайте для писем с паролями, персональными данными или служебными секретами. " +
        "Подсказки вставляются в черновик и не отправляются сами.";

    /// <summary>
    /// Общий вход для «Кратко»/«Быстрые ответы»: без локального opt-in показываем
    /// панель согласия и запоминаем действие; после согласия — POST к AI-маршруту.
    /// 403/404 — серверный kill-switch MAIL_AI_DISABLED: прячем кнопки (проба+скрытие).
    /// </summary>
    private async Task RunAiActionAsync(string action, CancellationToken cancellationToken)
    {
        if (!ShowAiActions || Detail is not { } detail)
        {
            return;
        }

        if (!IsMailAiEnabled)
        {
            _pendingAiAction = action;
            AiConsentOpen = true;
            return;
        }

        AiErrorText = null;
        CancelAiLoad();
        var cancellation = new CancellationTokenSource();
        _aiLoadCancellation = cancellation;
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(
            cancellationToken, cancellation.Token);
        IsAiBusy = true;
        if (action == "summary")
        {
            IsSummaryLoading = true;
        }
        else
        {
            IsSmartRepliesLoading = true;
        }

        try
        {
            if (action == "summary")
            {
                var result = await _api.SummarizeMailMessageAsync(
                    detail.Id, _mailboxId, linked.Token);
                if (cancellation.IsCancellationRequested
                    || !string.Equals(Detail?.Id, detail.Id, StringComparison.Ordinal))
                {
                    return;
                }

                var summary = result.Summary?.Trim() ?? string.Empty;
                if (summary.Length == 0)
                {
                    AiSummaryText = null;
                    AiErrorText = "AI вернул пустой пересказ.";
                }
                else
                {
                    AiSummaryText = summary;
                }
            }
            else
            {
                var result = await _api.GetMailSmartRepliesAsync(
                    detail.Id, _mailboxId, linked.Token);
                if (cancellation.IsCancellationRequested
                    || !string.Equals(Detail?.Id, detail.Id, StringComparison.Ordinal))
                {
                    return;
                }

                SmartReplies.Clear();
                foreach (var suggestion in result.Suggestions ?? [])
                {
                    var text = suggestion?.Trim() ?? string.Empty;
                    if (text.Length > 0 && SmartReplies.Count < 3)
                    {
                        SmartReplies.Add(text);
                    }
                }

                if (SmartReplies.Count == 0)
                {
                    AiErrorText = "AI не вернул вариантов ответа.";
                }
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch (HubApiException ex)
            when (ex.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound)
        {
            // Серверный kill-switch MAIL_AI_DISABLED — кнопки прячем до конца сессии.
            MailAiServerDisabled = true;
            AiConsentOpen = false;
        }
        catch (Exception ex)
        {
            AiErrorText = TasksViewModel.DescribeError(ex);
        }
        finally
        {
            if (ReferenceEquals(_aiLoadCancellation, cancellation))
            {
                _aiLoadCancellation = null;
            }

            IsAiBusy = false;
            IsSummaryLoading = false;
            IsSmartRepliesLoading = false;
        }
    }

    /// <summary>«Разрешить ИИ» в панели согласия — включаем opt-in и запускаем отложенное действие.</summary>
    private Task AcceptAiConsentAsync(CancellationToken cancellationToken)
    {
        IsMailAiEnabled = true;
        AiConsentOpen = false;
        var action = _pendingAiAction ?? "summary";
        _pendingAiAction = null;
        return RunAiActionAsync(action, cancellationToken);
    }

    /// <summary>Отмена in-flight AI-запроса и очистка панелей (смена письма/Reset).</summary>
    private void CancelAiLoad()
    {
        _aiLoadCancellation?.Cancel();
        _aiLoadCancellation = null;
        IsAiBusy = false;
        IsSummaryLoading = false;
        IsSmartRepliesLoading = false;
        AiSummaryText = null;
        SmartReplies.Clear();
        AiErrorText = null;
    }

    /// <summary>
    /// Чип под телом письма: подставляет подсказку в композер ответа; если композера-
    /// ответа нет — открываем reply-черновик адресату (подсказка выше цитаты).
    /// </summary>
    private void ApplySmartReply(string text)
    {
        var suggestion = text.Trim();
        if (suggestion.Length == 0)
        {
            return;
        }

        if (Composer is not { Mode: "reply" or "reply_all" })
        {
            if (Detail is null)
            {
                return;
            }

            OpenComposeFromDetail("reply");
        }

        if (Composer is { } composer)
        {
            var body = composer.Body;
            composer.Body = string.IsNullOrWhiteSpace(body)
                ? suggestion
                : suggestion + "\n\n" + body.TrimStart('\n', ' ');
        }
    }

    private void RaiseAiCommandsCanExecuteChanged()
    {
        ((NativeAsyncCommand)SummarizeCommand).RaiseCanExecuteChanged();
        ((NativeAsyncCommand)SmartRepliesCommand).RaiseCanExecuteChanged();
    }
}
