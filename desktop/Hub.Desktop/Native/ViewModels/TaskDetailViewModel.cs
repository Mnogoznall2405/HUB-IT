using System.Collections.ObjectModel;
using System.Globalization;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Детальная панель задачи: метаданные + доступные переходы (capabilities сервера).</summary>
public sealed class TaskDetailViewModel : ObservableObject
{
    private bool _isTransitioning;
    private string? _transitionComment;
    private string? _commentText;
    private bool _isCommentBusy;
    private bool _isAttachmentBusy;
    private bool _isDiscussionBusy;
    private bool _commentsFailed;
    private int _commentsCount;
    private bool _canUploadFiles;
    private bool _canOpenDiscussion;
    private bool _canCreateSubtask;
    private TaskSubtaskCreateViewModel? _subtaskForm;
    private int _subtasksTotal;
    private int _subtasksDone;

    public TaskDetailViewModel(HubTaskDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
        Comments = [];
        Attachments = [];
        Subtasks = [];
        Comments.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasComments));
            OnPropertyChanged(nameof(ShowCommentsEmpty));
            OnPropertyChanged(nameof(CommentsTitle));
        };
        Attachments.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(HasAttachments));
            OnPropertyChanged(nameof(ShowFilesSection));
            OnPropertyChanged(nameof(ShowFilesEmpty));
            OnPropertyChanged(nameof(AttachmentsTitle));
        };
        Subtasks.CollectionChanged += (_, _) =>
        {
            OnPropertyChanged(nameof(ShowSubtasksSection));
            OnPropertyChanged(nameof(ShowSubtasksEmpty));
        };
        Update(detail);
    }

    public long Id { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string StatusText { get; private set; } = string.Empty;
    public string StatusTone { get; private set; } = HubStatusTone.Muted;
    public string Description { get; private set; } = string.Empty;
    public bool HasDescription => Description.Length > 0;
    public string AssigneeText { get; private set; } = string.Empty;
    public string ControllerText { get; private set; } = string.Empty;
    public string DepartmentText { get; private set; } = string.Empty;
    public string ProjectText { get; private set; } = string.Empty;
    public string DueText { get; private set; } = string.Empty;
    public string PriorityText { get; private set; } = string.Empty;
    public string PriorityTone { get; private set; } = TaskListItemViewModel.PriorityToTone(null);
    public bool HasPriority => PriorityText.Length > 0;
    public string ChecklistText { get; private set; } = string.Empty;
    public string CommentsText { get; private set; } = string.Empty;

    public bool CanStart { get; private set; }
    public bool CanSubmit { get; private set; }
    public bool CanReview { get; private set; }
    public bool CanReopen { get; private set; }
    public bool CanClose { get; private set; }
    public bool HasAnyAction { get; private set; }

    public bool IsTransitioning
    {
        get => _isTransitioning;
        set
        {
            if (SetProperty(ref _isTransitioning, value))
            {
                OnPropertyChanged(nameof(ActionsEnabled));
            }
        }
    }

    public bool ActionsEnabled => !IsTransitioning && HasAnyAction;

    /// <summary>Комментарий к переходу (submit/review/complete).</summary>
    public string? TransitionComment
    {
        get => _transitionComment;
        set => SetProperty(ref _transitionComment, value);
    }

    // ---- Комментарии ----

    /// <summary>Архивная лента hub_task_comments (старые первыми).</summary>
    public ObservableCollection<TaskCommentItemViewModel> Comments { get; }

    public bool HasComments => Comments.Count > 0;

    /// <summary>Пустая лента без сбоя — строка «пока нет» (или «архивных … нет» в чат-режиме).</summary>
    public bool ShowCommentsEmpty => !HasComments && !CommentsFailed;

    /// <summary>Тихий сбой GET …/comments: секция помечается, карточка остаётся живой.</summary>
    public bool CommentsFailed
    {
        get => _commentsFailed;
        set
        {
            if (SetProperty(ref _commentsFailed, value))
            {
                OnPropertyChanged(nameof(ShowCommentsEmpty));
            }
        }
    }

    /// <summary>Счётчик из summary задачи; при отправке комментария увеличиваем локально.</summary>
    public int CommentsCount
    {
        get => _commentsCount;
        private set
        {
            if (SetProperty(ref _commentsCount, value))
            {
                OnPropertyChanged(nameof(CommentsTitle));
            }
        }
    }

    /// <summary>Заголовок секции — как getTaskCommentsTabLabel в вебе (Архив при чат-обсуждении).</summary>
    public string CommentsTitle => CanOpenDiscussion
        ? CommentsCount > 0 ? $"Архив ({CommentsCount})" : "Архив"
        : CommentsCount > 0 ? $"Комментарии ({CommentsCount})" : "Комментарии";

    /// <summary>Текст пустого состояния — как в веб-табе.</summary>
    public string CommentsEmptyText => CanOpenDiscussion
        ? "Архивных комментариев пока нет."
        : "Комментариев пока нет.";

    /// <summary>Признак непрочитанных из detail (has_unread_comments) — гасится mark-seen.</summary>
    public bool HasUnreadComments { get; private set; }

    /// <summary>mark-seen прошёл: маркер прочтения и счётчик непрочитанных снимаются локально.</summary>
    public void MarkCommentsSeen()
    {
        if (HasUnreadComments)
        {
            HasUnreadComments = false;
            OnPropertyChanged(nameof(HasUnreadComments));
        }
    }

    /// <summary>
    /// Чат-обсуждение включено (capabilities.can_open_discussion): композера нет —
    /// «Обсудить в чате» ведёт в раздел «Чат», архив остаётся read-only.
    /// </summary>
    public bool CanOpenDiscussion
    {
        get => _canOpenDiscussion;
        private set
        {
            if (SetProperty(ref _canOpenDiscussion, value))
            {
                OnPropertyChanged(nameof(ShowCommentComposer));
                OnPropertyChanged(nameof(CanSendComment));
                OnPropertyChanged(nameof(CommentsTitle));
                OnPropertyChanged(nameof(CommentsEmptyText));
                OnPropertyChanged(nameof(DiscussionHintText));
            }
        }
    }

    /// <summary>Подсказка в чат-режиме — строка из веб-таба комментариев.</summary>
    public string DiscussionHintText => CanOpenDiscussion
        ? "Новые сообщения по задаче — в корпоративном чате. Старые комментарии сохранены в архиве ниже."
        : string.Empty;

    /// <summary>Поле ввода нового комментария.</summary>
    public string? CommentText
    {
        get => _commentText;
        set
        {
            if (SetProperty(ref _commentText, value))
            {
                OnPropertyChanged(nameof(CanSendComment));
            }
        }
    }

    public bool IsCommentBusy
    {
        get => _isCommentBusy;
        set
        {
            if (SetProperty(ref _isCommentBusy, value))
            {
                OnPropertyChanged(nameof(CanSendComment));
            }
        }
    }

    /// <summary>Композер виден только когда чат-обсуждение выключено (иначе 400 use_task_discussion_chat).</summary>
    public bool ShowCommentComposer => !CanOpenDiscussion;

    public bool CanSendComment =>
        ShowCommentComposer && !IsCommentBusy && !string.IsNullOrWhiteSpace(CommentText);

    /// <summary>POST …/discussion в полёте — кнопка «Обсудить в чате» на паузе.</summary>
    public bool IsDiscussionBusy
    {
        get => _isDiscussionBusy;
        set
        {
            if (SetProperty(ref _isDiscussionBusy, value))
            {
                OnPropertyChanged(nameof(DiscussionButtonText));
                OnPropertyChanged(nameof(CanOpenDiscussionNow));
            }
        }
    }

    public bool CanOpenDiscussionNow => CanOpenDiscussion && !IsDiscussionBusy;

    public string DiscussionButtonText => IsDiscussionBusy ? "Открываем…" : "Обсудить в чате";

    // ---- Вложения ----

    /// <summary>Файлы задачи (detail.attachments); scope=task удаляемые, прочие — read-only чипы.</summary>
    public ObservableCollection<TaskAttachmentItemViewModel> Attachments { get; }

    public bool HasAttachments => Attachments.Count > 0;

    /// <summary>Секция «Вложения» видна с файлами или с правом загрузки.</summary>
    public bool ShowFilesSection => HasAttachments || CanUploadFiles;

    /// <summary>Пустая строка «Вложений пока нет.» — только внутри видимой секции.</summary>
    public bool ShowFilesEmpty => !HasAttachments && CanUploadFiles;

    public string AttachmentsTitle => $"Вложения ({Attachments.Count})";

    /// <summary>Право на загрузку из capabilities.can_upload_files (участник, статус != done).</summary>
    public bool CanUploadFiles
    {
        get => _canUploadFiles;
        private set
        {
            if (SetProperty(ref _canUploadFiles, value))
            {
                OnPropertyChanged(nameof(CanAttach));
                OnPropertyChanged(nameof(ShowFilesSection));
                OnPropertyChanged(nameof(ShowFilesEmpty));
            }
        }
    }

    /// <summary>POST …/attachments в полёте — кнопка «Прикрепить» на паузе.</summary>
    public bool IsAttachmentBusy
    {
        get => _isAttachmentBusy;
        set
        {
            if (SetProperty(ref _isAttachmentBusy, value))
            {
                OnPropertyChanged(nameof(CanAttach));
                OnPropertyChanged(nameof(AttachButtonText));
            }
        }
    }

    public bool CanAttach => CanUploadFiles && !IsAttachmentBusy;

    public string AttachButtonText => IsAttachmentBusy ? "Загружаем…" : "📎 Прикрепить";

    // ---- Подзадачи ----

    /// <summary>Подзадачи первого уровня из detail.subtasks (видимые текущему пользователю).</summary>
    public ObservableCollection<TaskSubtaskItemViewModel> Subtasks { get; }

    /// <summary>Счётчики из detail.subtasks_total/done — шапка «Подзадачи (N/M)».</summary>
    public int SubtasksTotal
    {
        get => _subtasksTotal;
        private set
        {
            if (SetProperty(ref _subtasksTotal, value))
            {
                OnPropertyChanged(nameof(SubtasksTitle));
            }
        }
    }

    public int SubtasksDone
    {
        get => _subtasksDone;
        private set
        {
            if (SetProperty(ref _subtasksDone, value))
            {
                OnPropertyChanged(nameof(SubtasksTitle));
            }
        }
    }

    public string SubtasksTitle => SubtasksTotal > 0
        ? $"Подзадачи ({SubtasksDone}/{SubtasksTotal})"
        : "Подзадачи";

    /// <summary>Секция видна со списком подзадач или с правом их создавать.</summary>
    public bool ShowSubtasksSection => Subtasks.Count > 0 || CanCreateSubtask;

    /// <summary>Пустая строка — только внутри видимой секции (иначе вся секция скрыта).</summary>
    public bool ShowSubtasksEmpty => ShowSubtasksSection && Subtasks.Count == 0;

    /// <summary>
    /// Право на «+ Подзадача» из capabilities.can_create_subtask
    /// (участник родителя, статус != done, сама задача — не подзадача).
    /// </summary>
    public bool CanCreateSubtask
    {
        get => _canCreateSubtask;
        private set
        {
            if (SetProperty(ref _canCreateSubtask, value))
            {
                OnPropertyChanged(nameof(ShowSubtasksSection));
                OnPropertyChanged(nameof(ShowSubtasksEmpty));
            }
        }
    }

    /// <summary>
    /// Открытая компактная форма подзадачи; создаёт/закрывает родительская
    /// TasksViewModel (у формы есть api и свои события Created/Closed).
    /// </summary>
    public TaskSubtaskCreateViewModel? SubtaskForm
    {
        get => _subtaskForm;
        set
        {
            if (SetProperty(ref _subtaskForm, value))
            {
                OnPropertyChanged(nameof(IsSubtaskFormOpen));
            }
        }
    }

    public bool IsSubtaskFormOpen => SubtaskForm is not null;

    public void Update(HubTaskDetail detail)
    {
        Id = detail.Id;
        Title = string.IsNullOrWhiteSpace(detail.Title) ? "Без названия" : detail.Title!;
        StatusText = TaskListItemViewModel.StatusToText(detail.Status);
        StatusTone = TaskListItemViewModel.StatusToTone(detail.Status, detail.IsOverdue);
        Description = detail.Description ?? string.Empty;
        AssigneeText = string.IsNullOrWhiteSpace(detail.AssigneeFullName) ? "Не назначена" : detail.AssigneeFullName!;
        ControllerText = detail.ControllerFullName ?? string.Empty;
        DepartmentText = detail.DepartmentName ?? string.Empty;
        ProjectText = detail.ProjectName ?? string.Empty;
        // Метка «Срок» уже стоит слева — значение без повторного префикса.
        DueText = TaskListItemViewModel.FormatDueValue(detail.DueAt, detail.IsOverdue);
        PriorityText = TaskListItemViewModel.FormatPriority(detail.Priority);
        PriorityTone = TaskListItemViewModel.PriorityToTone(detail.Priority);
        ChecklistText = detail.ChecklistTotal > 0
            ? $"{detail.ChecklistDone}/{detail.ChecklistTotal}"
            : "Нет";
        CommentsCount = detail.CommentsCount;
        CommentsText = detail.CommentsCount.ToString(CultureInfo.CurrentCulture);
        HasUnreadComments = detail.HasUnreadComments;

        var capabilities = detail.Capabilities;
        CanStart = capabilities?.CanStart ?? false;
        CanSubmit = capabilities?.CanSubmit ?? false;
        CanReview = capabilities?.CanReview ?? false;
        CanReopen = capabilities?.CanReopen ?? false;
        CanClose = capabilities?.CanClose ?? false;
        CanUploadFiles = capabilities?.CanUploadFiles ?? false;
        CanOpenDiscussion = capabilities?.CanOpenDiscussion ?? false;
        CanCreateSubtask = capabilities?.CanCreateSubtask ?? false;
        HasAnyAction = CanStart || CanSubmit || CanReview || CanReopen || CanClose;

        SubtasksTotal = detail.SubtasksTotal;
        SubtasksDone = detail.SubtasksDone;
        SetSubtasks(detail.Subtasks ?? []);
        SetAttachments(detail.Attachments ?? []);
        OnPropertyChanged(string.Empty);
    }

    public void SetComments(IReadOnlyList<HubTaskComment> comments)
    {
        Comments.Clear();
        foreach (var comment in comments)
        {
            Comments.Add(new TaskCommentItemViewModel(comment));
        }
    }

    /// <summary>Отправленный комментарий — в конец ленты и +1 к счётчику (POST вернул запись).</summary>
    public void AppendComment(HubTaskComment comment)
    {
        Comments.Add(new TaskCommentItemViewModel(comment));
        CommentsCount += 1;
    }

    public void SetAttachments(IReadOnlyList<HubTaskAttachment> attachments)
    {
        Attachments.Clear();
        foreach (var attachment in attachments)
        {
            Attachments.Add(new TaskAttachmentItemViewModel(attachment));
        }
    }

    /// <summary>Строки подзадач detail-а пересоздаются при каждом refetch карточки.</summary>
    public void SetSubtasks(IReadOnlyList<HubSubtaskItem> subtasks)
    {
        Subtasks.Clear();
        foreach (var subtask in subtasks)
        {
            Subtasks.Add(new TaskSubtaskItemViewModel(subtask));
        }
    }

    /// <summary>Чип свежезагруженного файла — в конец списка (как AppendComment).</summary>
    public void AppendAttachment(HubTaskAttachment attachment)
    {
        Attachments.Add(new TaskAttachmentItemViewModel(attachment));
    }
}

/// <summary>Комментарий архивной ленты задачи: автор, локальное время, текст.</summary>
public sealed class TaskCommentItemViewModel
{
    public TaskCommentItemViewModel(HubTaskComment comment)
    {
        ArgumentNullException.ThrowIfNull(comment);
        Id = comment.Id ?? string.Empty;
        AuthorText = string.IsNullOrWhiteSpace(comment.FullName)
            ? (comment.Username ?? string.Empty).Trim()
            : comment.FullName!.Trim();
        CreatedText = comment.CreatedAt is { } at
            ? at.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : string.Empty;
        MetaText = (AuthorText.Length, CreatedText.Length) switch
        {
            ( > 0, > 0) => $"{AuthorText} · {CreatedText}",
            ( > 0, _) => AuthorText,
            (_, > 0) => CreatedText,
            _ => string.Empty,
        };
        Body = comment.Body ?? string.Empty;
    }

    public string Id { get; }
    public string AuthorText { get; }
    public string CreatedText { get; }

    /// <summary>«Имя · 19.11.2026 12:34» одной строкой над текстом.</summary>
    public string MetaText { get; }
    public string Body { get; }
}

/// <summary>Чип вложения задачи: имя, размер, состояния «скачиваем»/armed-delete.</summary>
public sealed class TaskAttachmentItemViewModel : ObservableObject
{
    private bool _isDownloading;
    private bool _deleteArmed;
    private bool _isDeleteBusy;

    public TaskAttachmentItemViewModel(HubTaskAttachment attachment)
    {
        ArgumentNullException.ThrowIfNull(attachment);
        Model = attachment;
        AttachmentId = attachment.Id ?? string.Empty;
        Name = string.IsNullOrWhiteSpace(attachment.FileName) ? "Файл" : attachment.FileName!;
        SizeText = TicketAttachmentViewModel.FormatSize(attachment.FileSize);
        // Удаление разрешено только scope=task: отчётные/generated backend не удаляет.
        CanDelete = string.Equals(attachment.Scope, "task", StringComparison.OrdinalIgnoreCase);
        // PDF-превью генерирует backend только для Office (docflow/почта — то же правило).
        CanPreview = PreviewableExtensions.Contains(
            System.IO.Path.GetExtension(Name).TrimStart('.'));
    }

    /// <summary>Расширения, для которых backend умеет preview/pdf (mail_attachment_preview_service).</summary>
    private static readonly HashSet<string> PreviewableExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    };

    public HubTaskAttachment Model { get; }
    public string AttachmentId { get; }
    public string Name { get; }
    public string SizeText { get; }
    public bool CanDelete { get; }
    public bool CanPreview { get; }

    public bool IsDownloading
    {
        get => _isDownloading;
        set
        {
            if (SetProperty(ref _isDownloading, value))
            {
                OnPropertyChanged(nameof(DisplayText));
                OnPropertyChanged(nameof(IsDownloadEnabled));
            }
        }
    }

    /// <summary>Чип доступен, пока файл не скачивается (дедуп — и в OpenAttachmentAsync).</summary>
    public bool IsDownloadEnabled => !IsDownloading;

    /// <summary>Первое нажатие «✕» взводит подтверждение; второе — удаляет (как у билетов).</summary>
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

    /// <summary>DELETE …/attachments/{id} в полёте.</summary>
    public bool IsDeleteBusy
    {
        get => _isDeleteBusy;
        internal set
        {
            if (SetProperty(ref _isDeleteBusy, value))
            {
                OnPropertyChanged(nameof(DeleteText));
                OnPropertyChanged(nameof(IsDeleteEnabled));
            }
        }
    }

    /// <summary>Кнопка удаления активна, пока удаление не в полёте.</summary>
    public bool IsDeleteEnabled => !IsDeleteBusy;

    /// <summary>Подпись кнопки удаления: armed просит повторное нажатие.</summary>
    public string DeleteText => IsDeleteBusy ? "…" : DeleteArmed ? "Удалить?" : "";

    public string DisplayText => IsDownloading
        ? "Скачиваем…"
        : SizeText.Length == 0 ? Name : $"{Name} ({SizeText})";
}

/// <summary>Строка подзадачи в карточке родителя: название, статус, исполнитель, срок.</summary>
public sealed class TaskSubtaskItemViewModel
{
    public TaskSubtaskItemViewModel(HubSubtaskItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        Id = item.Id;
        Title = string.IsNullOrWhiteSpace(item.Title) ? "Без названия" : item.Title!;
        StatusText = TaskListItemViewModel.StatusToText(item.Status);
        StatusTone = TaskListItemViewModel.StatusToTone(item.Status, item.IsOverdue);
        AssigneeText = (item.AssigneeFullName ?? string.Empty).Trim();
        DueText = TaskListItemViewModel.FormatDueValue(item.DueAt, item.IsOverdue);
        MetaText = (AssigneeText.Length, DueText.Length) switch
        {
            ( > 0, > 0) => $"{AssigneeText} · {DueText}",
            ( > 0, _) => AssigneeText,
            (_, > 0) => DueText,
            _ => string.Empty,
        };
    }

    public long Id { get; }
    public string Title { get; }
    public string StatusText { get; }
    public string StatusTone { get; }
    public string AssigneeText { get; }
    public string DueText { get; }

    /// <summary>«Имя · до 20.11» одной строкой под названием.</summary>
    public string MetaText { get; }
}
