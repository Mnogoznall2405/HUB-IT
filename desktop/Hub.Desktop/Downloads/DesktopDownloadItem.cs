using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Hub.Desktop.Downloads;

public enum DesktopDownloadState
{
    InProgress,
    Paused,
    Completed,
    Failed,
    Canceled,
}

public enum DesktopDownloadedFileAction
{
    None,
    Open,
    Print,
    Copy,
    SaveAs,
}

public sealed class DesktopDownloadItem : INotifyPropertyChanged
{
    private DesktopDownloadState _state = DesktopDownloadState.InProgress;
    private long _bytesReceived;
    private long _totalBytes;
    private int _progressPercent;

    internal DesktopDownloadItem(
        string id,
        string fileName,
        DesktopDownloadedFileAction completionAction,
        string? sourceWindowLabel)
    {
        Id = id;
        FileName = fileName;
        CompletionAction = completionAction;
        SourceWindowLabel = string.IsNullOrWhiteSpace(sourceWindowLabel)
            ? null
            : sourceWindowLabel.Trim();
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    public string Id { get; }

    public string FileName { get; }

    public DesktopDownloadedFileAction CompletionAction { get; }

    public string? SourceWindowLabel { get; }

    public bool OpenWhenCompleted => CompletionAction == DesktopDownloadedFileAction.Open;

    public DesktopDownloadState State
    {
        get => _state;
        private set
        {
            if (_state == value)
            {
                return;
            }

            _state = value;
            NotifyPresentationChanged();
        }
    }

    public long BytesReceived
    {
        get => _bytesReceived;
        private set => SetField(ref _bytesReceived, value);
    }

    public long TotalBytes
    {
        get => _totalBytes;
        private set => SetField(ref _totalBytes, value);
    }

    public int ProgressPercent
    {
        get => _progressPercent;
        private set => SetField(ref _progressPercent, value);
    }

    public string StatusText => State switch
    {
        DesktopDownloadState.Completed => "Завершено",
        DesktopDownloadState.Failed => "Ошибка загрузки — повторите скачивание в HUB",
        DesktopDownloadState.Canceled => "Отменено",
        DesktopDownloadState.Paused => "Приостановлено",
        _ => TotalBytes > 0 ? $"Загрузка — {ProgressPercent}%" : "Загрузка",
    };

    public bool IsInProgress => State == DesktopDownloadState.InProgress;

    public bool CanCancel => State is DesktopDownloadState.InProgress or DesktopDownloadState.Paused;

    public bool CanOpen =>
        State == DesktopDownloadState.Completed
        && DesktopFileLauncher.IsSupportedFileName(FileName);

    public bool CanReveal => State == DesktopDownloadState.Completed;

    internal string? ResultFilePath { get; private set; }

    internal void ReportProgress(long bytesReceived, long totalBytes)
    {
        if (State is not (DesktopDownloadState.InProgress or DesktopDownloadState.Paused))
        {
            return;
        }

        BytesReceived = Math.Max(0, bytesReceived);
        TotalBytes = Math.Max(0, totalBytes);
        ProgressPercent = TotalBytes > 0
            ? Math.Clamp((int)Math.Round(BytesReceived * 100d / TotalBytes), 0, 99)
            : 0;
        OnPropertyChanged(nameof(StatusText));
    }

    internal void Complete(string? resultFilePath)
    {
        ResultFilePath = resultFilePath;
        ProgressPercent = 100;
        State = DesktopDownloadState.Completed;
    }

    internal void Cancel() => State = DesktopDownloadState.Canceled;

    internal void Fail() => State = DesktopDownloadState.Failed;

    internal void Pause()
    {
        if (State == DesktopDownloadState.InProgress)
        {
            State = DesktopDownloadState.Paused;
        }
    }

    internal void Resume()
    {
        if (State == DesktopDownloadState.Paused)
        {
            State = DesktopDownloadState.InProgress;
        }
    }

    private void NotifyPresentationChanged()
    {
        OnPropertyChanged(nameof(State));
        OnPropertyChanged(nameof(StatusText));
        OnPropertyChanged(nameof(IsInProgress));
        OnPropertyChanged(nameof(CanCancel));
        OnPropertyChanged(nameof(CanOpen));
        OnPropertyChanged(nameof(CanReveal));
    }

    private void SetField<T>(ref T field, T value, [CallerMemberName] string? propertyName = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        OnPropertyChanged(propertyName);
    }

    private void OnPropertyChanged(string? propertyName) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}
