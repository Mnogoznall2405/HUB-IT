using System.Globalization;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Элемент списка задач: доменные поля + готовые отображаемые значения.
/// Статус всегда имеет текст — цвет плашки никогда не единственный носитель смысла.
/// Цвет отдаётся тоном (HubStatusTone.*), кисть подбирает разметка по теме.
/// </summary>
public sealed class TaskListItemViewModel : ObservableObject
{
    private bool _isOverdue;
    private readonly string? _priority;

    public TaskListItemViewModel(HubTaskItem task)
    {
        ArgumentNullException.ThrowIfNull(task);
        Id = task.Id;
        Title = string.IsNullOrWhiteSpace(task.Title) ? "Без названия" : task.Title!;
        DescriptionPreview = task.DescriptionPreview ?? string.Empty;
        _priority = task.Priority;
        PriorityText = FormatPriority(task.Priority);
        PriorityTone = PriorityToTone(task.Priority);
        DueText = FormatDue(task.DueAt, task.IsOverdue);
        AssigneeText = string.IsNullOrWhiteSpace(task.AssigneeFullName)
            ? "Не назначена"
            : task.AssigneeFullName!;
        ContextText = BuildContext(task);
        UpdatedText = FormatUpdated(task.UpdatedAt);
        SubtasksText = task.SubtasksTotal > 0
            ? $"Подзадачи {task.SubtasksDone}/{task.SubtasksTotal}"
            : string.Empty;
        AttachmentsText = task.AttachmentsCount > 0
            ? $"Вложения: {task.AttachmentsCount}"
            : string.Empty;
        // Backend шлёт has_unread_comments (флаг, без счётчика);
        // comments_unread оставлен для совместимости старых payload'ов.
        HasUnreadComments = task.HasUnreadComments || task.CommentsUnread > 0;
        UnreadCommentsText = HasUnreadComments
            ? task.CommentsUnread > 0
                ? $"Новых комментариев: {task.CommentsUnread}"
                : "Новые комментарии"
            : string.Empty;
        ApplyStatus(task.Status, task.IsOverdue);
    }

    public long Id { get; }
    public string Title { get; }
    public string DescriptionPreview { get; }
    public string? StatusText { get; private set; }
    public string StatusTone { get; private set; } = HubStatusTone.Muted;
    public string PriorityText { get; }
    public string PriorityTone { get; }

    /// <summary>
    /// Маркер приоритета в списке только для нестандартного значения —
    /// «обычный» приоритет по умолчанию и не несёт сигнала (как чип в вебе).
    /// </summary>
    public bool ShowPriority => !IsBaselinePriority(_priority);
    public string DueText { get; }
    public string AssigneeText { get; }
    public string ContextText { get; }
    public string UpdatedText { get; }
    public string SubtasksText { get; }
    public string AttachmentsText { get; }
    public bool HasUnreadComments { get; private set; }
    public string UnreadCommentsText { get; private set; }
    public bool IsOverdueVisual => _isOverdue;

    /// <summary>mark-seen прошёл при открытии карточки — маркер непрочитанных снимаем локально.</summary>
    public void MarkCommentsRead()
    {
        HasUnreadComments = false;
        UnreadCommentsText = string.Empty;
        OnPropertyChanged(nameof(HasUnreadComments));
        OnPropertyChanged(nameof(UnreadCommentsText));
    }

    public void ApplyStatus(string? status, bool isOverdue)
    {
        _isOverdue = isOverdue;
        StatusText = StatusToText(status);
        StatusTone = StatusToTone(status, isOverdue);
        OnPropertyChanged(nameof(StatusText));
        OnPropertyChanged(nameof(StatusTone));
        OnPropertyChanged(nameof(IsOverdueVisual));
    }

    public void UpdateFrom(HubTaskItem task)
    {
        ArgumentNullException.ThrowIfNull(task);
        ApplyStatus(task.Status, task.IsOverdue);
    }

    internal static string StatusToText(string? status) => status switch
    {
        "new" => "Новая",
        "in_progress" => "В работе",
        "review" => "На проверке",
        "done" => "Выполнена",
        null => "Статус неизвестен",
        _ => status,
    };

    internal static string StatusToTone(string? status, bool isOverdue) =>
        isOverdue
            ? HubStatusTone.Danger
            : status switch
            {
                "new" => HubStatusTone.Info,
                "in_progress" => HubStatusTone.Warning,
                "review" => HubStatusTone.Review,
                "done" => HubStatusTone.Success,
                _ => HubStatusTone.Muted,
            };

    internal static string FormatPriority(string? priority) => priority switch
    {
        "critical" => "Критичный",
        "urgent" => "Срочный",
        "high" => "Высокий",
        "medium" or "normal" => "Средний",
        "low" => "Низкий",
        null => string.Empty,
        _ => priority,
    };

    /// <summary>
    /// Тон приоритета: критичный/срочный — красный (тон просрочки темы),
    /// высокий — янтарный (warning темы), низкий и прочие значения — приглушённый.
    /// </summary>
    internal static string PriorityToTone(string? priority) => priority switch
    {
        "critical" or "urgent" => HubStatusTone.Danger,
        "high" => HubStatusTone.Warning,
        _ => HubStatusTone.Muted,
    };

    /// <summary>Приоритет по умолчанию: сервер шлёт "normal"; "medium" — тот же базовый уровень.</summary>
    private static bool IsBaselinePriority(string? priority) =>
        priority is null or "normal" or "medium";

    internal static string FormatDue(DateTimeOffset? dueAt, bool isOverdue)
    {
        var dayText = FormatDueDay(dueAt);
        return dayText is null
            ? "Без срока"
            : isOverdue ? $"Просрочено: {dayText}" : $"Срок: {dayText}";
    }

    /// <summary>
    /// Значение срока для детальной карточки: без префикса «Срок:»
    /// (рядом уже стоит метка «Срок») и с заглавной буквы.
    /// </summary>
    internal static string FormatDueValue(DateTimeOffset? dueAt, bool isOverdue)
    {
        var dayText = FormatDueDay(dueAt);
        if (dayText is null)
        {
            return "Без срока";
        }

        return isOverdue
            ? $"Просрочено: {dayText}"
            : char.ToUpper(dayText[0], CultureInfo.CurrentCulture) + dayText.Substring(1);
    }

    private static string? FormatDueDay(DateTimeOffset? dueAt)
    {
        if (dueAt is null)
        {
            return null;
        }

        var local = dueAt.Value.ToLocalTime().Date;
        var today = DateTime.Today;
        return local == today
            ? "сегодня"
            : local == today.AddDays(1)
                ? "завтра"
                : local == today.AddDays(-1)
                    ? "вчера"
                    : local.ToString("dd.MM.yyyy", CultureInfo.CurrentCulture);
    }

    private static string BuildContext(HubTaskItem task)
    {
        var parts = new List<string>(2);
        if (!string.IsNullOrWhiteSpace(task.DepartmentName))
        {
            parts.Add(task.DepartmentName!);
        }

        if (!string.IsNullOrWhiteSpace(task.ProjectName))
        {
            parts.Add(task.ProjectName!);
        }

        return string.Join(" · ", parts);
    }

    private static string FormatUpdated(DateTimeOffset? updatedAt) =>
        updatedAt is null
            ? string.Empty
            : $"Обновлена {updatedAt.Value.ToLocalTime():dd.MM HH:mm}";
}
