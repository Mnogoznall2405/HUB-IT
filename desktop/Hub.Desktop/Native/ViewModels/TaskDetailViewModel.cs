using System.Globalization;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Детальная панель задачи: метаданные + доступные переходы (capabilities сервера).</summary>
public sealed class TaskDetailViewModel : ObservableObject
{
    private bool _isTransitioning;
    private string? _transitionComment;

    public TaskDetailViewModel(HubTaskDetail detail)
    {
        ArgumentNullException.ThrowIfNull(detail);
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
        CommentsText = detail.CommentsTotal.ToString(CultureInfo.CurrentCulture);

        var capabilities = detail.Capabilities;
        CanStart = capabilities?.CanStart ?? false;
        CanSubmit = capabilities?.CanSubmit ?? false;
        CanReview = capabilities?.CanReview ?? false;
        CanReopen = capabilities?.CanReopen ?? false;
        CanClose = capabilities?.CanClose ?? false;
        HasAnyAction = CanStart || CanSubmit || CanReview || CanReopen || CanClose;

        OnPropertyChanged(string.Empty);
    }
}
