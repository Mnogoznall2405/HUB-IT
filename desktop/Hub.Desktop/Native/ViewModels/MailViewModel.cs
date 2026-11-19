using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text.RegularExpressions;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

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

/// <summary>Папка в левой рейке: label, иконка и бейдж непрочитанных из folder_tree.</summary>
public sealed class MailFolderViewModel : ObservableObject
{
    private int _unread;

    public MailFolderViewModel(HubMailFolder folder)
    {
        ArgumentNullException.ThrowIfNull(folder);
        Id = string.IsNullOrWhiteSpace(folder.Id)
            ? folder.WellKnownKey ?? string.Empty
            : folder.Id!;
        WellKnownKey = folder.WellKnownKey ?? string.Empty;
        Label = string.IsNullOrWhiteSpace(folder.Label)
            ? (string.IsNullOrWhiteSpace(folder.Name) ? Id : folder.Name!)
            : folder.Label!;
        IconGlyph = MapIcon(folder.IconKey);
        Total = folder.Total;
        _unread = folder.Unread;
        IsCustom = string.IsNullOrWhiteSpace(folder.WellKnownKey);
    }

    /// <summary>Токен для параметра folder в GET /mail/messages.</summary>
    public string Id { get; }
    public string WellKnownKey { get; }
    public string Label { get; }
    public string IconGlyph { get; }
    public bool IsCustom { get; }
    public int Total { get; }

    public int Unread
    {
        get => _unread;
        private set
        {
            if (SetProperty(ref _unread, value))
            {
                OnPropertyChanged(nameof(HasUnread));
                OnPropertyChanged(nameof(UnreadBadgeText));
            }
        }
    }

    public bool HasUnread => Unread > 0;
    public string UnreadBadgeText => Unread > 99 ? "99+" : Unread.ToString(CultureInfo.InvariantCulture);

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
}

/// <summary>
/// Элемент списка писем: отправитель, тема, превью, дата, флаги.
/// Непрочитанное выделено точкой и жирным шрифтом, как в веб-списке.
/// </summary>
public sealed class MailListItemViewModel : ObservableObject
{
    private bool _isUnread;
    private bool _isChecked;

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
        Preview = item.BodyPreview ?? string.Empty;
        DateText = FormatListDate(item.ReceivedAt);
        _isUnread = !item.IsRead;
        HasAttachments = item.HasAttachments || item.AttachmentsCount > 0;
        AttachmentsText = item.AttachmentsCount > 0 ? $"📎 {item.AttachmentsCount}" : (HasAttachments ? "📎" : string.Empty);
        IsImportant = string.Equals(item.Importance, "high", StringComparison.OrdinalIgnoreCase);
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
    public bool IsImportant { get; }

    public bool IsUnread
    {
        get => _isUnread;
        private set => SetProperty(ref _isUnread, value);
    }

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
    public string AttachmentsText { get; private set; } = string.Empty;
    public string AttachmentNamesText { get; private set; } = string.Empty;

    /// <summary>Скачиваемые не-inline вложения — чипы в панели чтения.</summary>
    public IReadOnlyList<MailAttachmentItemViewModel> Attachments { get; private set; } = [];

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
    public bool CanMove { get; private set; }

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
        ToText = JoinAddresses(item.To, item.ToPeople);
        CcText = JoinAddresses(item.Cc, item.CcPeople);
        DateText = MailListItemViewModel.FormatFullDate(item.ReceivedAt);
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

    private static string GuessMimeType(string? extension) => extension?.ToLowerInvariant() switch
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
    private string? _statusInfoText;
    private bool _isBulkBusy;
    private readonly HashSet<string> _attachmentDownloadsInFlight = new(StringComparer.Ordinal);
    private bool _realtimeRefreshInFlight;
    private bool _realtimeRefreshQueued;
    /// <summary>Счётчик «эпох» содержимого: Reset инвалидирует in-flight realtime-загрузки.</summary>
    private int _loadEpoch;

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
            _ => Detail is { CanRunActions: true });
        DeleteDraftCommand = new NativeAsyncCommand(
            (_, ct) => DeleteDraftCurrentAsync(ct),
            ex => DetailErrorText = TasksViewModel.DescribeError(ex),
            _ => Detail is { CanRunActions: true, DraftContext: not null });
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
        DismissStatusCommand = new NativeRelayCommand(() => StatusInfoText = null);
        NewMessageCommand = new NativeRelayCommand(() => OpenCompose("new"));
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
            _ => HasSelection && !IsBulkBusy);
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
            if (SetProperty(ref _selectedFolder, value)
                && value is not null
                && !string.Equals(value.Id, _currentFolder, StringComparison.Ordinal))
            {
                _ = SelectFolderSafelyAsync(value.Id);
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
        set => SetProperty(ref _searchText, value);
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
                ((NativeAsyncCommand)LoadMoreCommand).RaiseCanExecuteChanged();
            }
        }
    }

    public string MoreButtonText => IsLoadingMore
        ? "Загружаем…"
        : $"Показать ещё ({Math.Max(0, _total - Items.Count)})";

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
        private set => SetProperty(ref _totalText, value);
    }

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

    /// <summary>Текущая папка — «Удалённые»: в bulk-баре вместо мягкого «Удалить» показываем «Удалить навсегда».</summary>
    public bool IsTrashFolder => IsFolder("trash");

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

    /// <summary>
    /// Шов выбора файлов для «📎» композера: code-behind ставит OpenFileDialog,
    /// тесты — заглушку с путями. null — кнопка вернёт пустой список.
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
        IsLoading = true;
        try
        {
            var bootstrap = await _api.GetMailBootstrapAsync(
                PageSize, _mailboxId, cancellationToken);
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
                ApplyPage(bootstrap.Messages);
            }
            else
            {
                await LoadMessagesAsync(offset: 0, replace: true, cancellationToken);
            }

            LastUpdatedText = $"Обновлено {DateTime.Now:HH:mm}";
            BannerErrorText = null;
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
        try
        {
            var unread = await _api.GetMailUnreadCountAsync(_mailboxId, cancellationToken);
            if (epoch != _loadEpoch)
            {
                // Сессия сменилась (Reset) — чужие данные не применяем.
                return;
            }

            TotalUnreadCount = Math.Max(0, unread.Count);
            if (ShowSetupHint)
            {
                return;
            }

            var selectedId = _selectedItem?.Id;
            var page = await _api.GetMailMessagesAsync(BuildQuery(0), cancellationToken);
            if (epoch != _loadEpoch)
            {
                return;
            }

            Items.Clear();
            ApplyPage(page);

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
        SearchText = string.Empty;
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
        CloseComposer();
    }

    private void ApplyMailboxInfo(HubMailMailboxInfo? info)
    {
        _mailboxId = info?.Id ?? info?.MailboxId ?? _mailboxId;
        MailboxLabel = info?.Label ?? info?.MailboxEmail ?? string.Empty;
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
        var folders = (tree?.Items ?? [])
            .OrderBy(MailFolderOrder.RankOf)
            .ThenBy(f => f.Label ?? f.Name ?? string.Empty, StringComparer.CurrentCulture)
            .Select(f => new MailFolderViewModel(f))
            .ToList();
        Folders.Clear();
        foreach (var folder in folders)
        {
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
        RaiseBulkCommandsCanExecuteChanged();
    }

    private async Task SelectFolderCoreAsync(string folderId, CancellationToken cancellationToken)
    {
        _currentFolder = folderId;
        OnPropertyChanged(nameof(IsTrashFolder));
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
        UnreadOnly = UnreadOnly,
    };

    /// <summary>Страница списка: replace=true пересобирает Items, иначе — догрузка в конец.</summary>
    private async Task LoadMessagesAsync(
        int offset,
        bool replace,
        CancellationToken cancellationToken)
    {
        var page = await _api.GetMailMessagesAsync(BuildQuery(offset), cancellationToken);
        if (replace)
        {
            Items.Clear();
        }

        ApplyPage(page);
    }

    private void ApplyPage(HubMailMessagePage? page)
    {
        _total = page?.Total ?? 0;
        HasMore = page?.HasMore == true && page.NextOffset is not null;
        TotalText = _total.ToString(CultureInfo.CurrentCulture);
        foreach (var item in page?.Items ?? [])
        {
            Items.Add(new MailListItemViewModel(item));
        }
    }

    private async Task LoadMoreAsync(CancellationToken cancellationToken)
    {
        IsLoadingMore = true;
        try
        {
            await LoadMessagesAsync(Items.Count, replace: false, cancellationToken);
            BannerErrorText = null;
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
        if (Detail is not { CanRunActions: true } detail)
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
        if (selected.Count == 0 || IsBulkBusy)
        {
            return;
        }

        IsBulkBusy = true;
        try
        {
            var ids = selected.Select(item => item.Id).ToList();
            var result = await _api.BulkMailMessageActionAsync(
                _mailboxId, action, ids, targetFolder, permanent, cancellationToken);
            var failedIds = result.Errors?
                .Select(error => error.MessageId)
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .ToHashSet(StringComparer.Ordinal) ?? [];
            var succeeded = selected.Where(item => !failedIds.Contains(item.Id)).ToList();
            var unreadDelta = 0;
            switch (action)
            {
                case "mark_read":
                    foreach (var item in succeeded.Where(item => item.IsUnread))
                    {
                        item.MarkRead();
                        unreadDelta--;
                    }

                    break;
                case "mark_unread":
                    foreach (var item in succeeded.Where(item => !item.IsUnread))
                    {
                        item.MarkUnread();
                        unreadDelta++;
                    }

                    break;
                default:
                    // delete/move/archive — письмо уходит из текущей папки.
                    foreach (var item in succeeded)
                    {
                        if (item.IsUnread)
                        {
                            unreadDelta--;
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

            if (unreadDelta != 0)
            {
                ApplyUnreadDeltaForFolder(unreadDelta);
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

    /// <summary>Дельта непрочитанных для bulk — все отмеченные строки текущей папки.</summary>
    private void ApplyUnreadDeltaForFolder(int delta)
    {
        var folder = Folders.FirstOrDefault(f => f.Id == _currentFolder) ?? SelectedFolder;
        if (folder is not null)
        {
            folder.SetUnread(Math.Max(0, folder.Unread + delta));
        }

        TotalUnreadCount = Math.Max(0, TotalUnreadCount + delta);
    }
}
