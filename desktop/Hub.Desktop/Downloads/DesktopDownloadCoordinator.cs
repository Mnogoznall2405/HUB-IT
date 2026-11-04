using System.Collections.ObjectModel;
using System.IO;

namespace Hub.Desktop.Downloads;

public enum DesktopOpenIntentRequestResult
{
    Accepted,
    Busy,
}

public sealed class DesktopDownloadCoordinator
{
    private const int MaximumSessionItems = 100;
    private static readonly TimeSpan IntentLifetime = TimeSpan.FromSeconds(15);
    private readonly object _sync = new();
    private readonly ObservableCollection<DesktopDownloadItem> _items = [];
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly DesktopFileLauncher _launcher;
    private readonly Dictionary<string, Action> _cancelActions = new(StringComparer.Ordinal);
    private DateTimeOffset? _pendingIntentExpiresAt;
    private DesktopDownloadedFileAction _pendingIntentAction;
    private string? _activeActionDownloadId;

    public DesktopDownloadCoordinator()
        : this(() => DateTimeOffset.UtcNow, new DesktopFileLauncher())
    {
    }

    internal DesktopDownloadCoordinator(
        Func<DateTimeOffset> utcNow,
        DesktopFileLauncher launcher)
    {
        _utcNow = utcNow ?? throw new ArgumentNullException(nameof(utcNow));
        _launcher = launcher ?? throw new ArgumentNullException(nameof(launcher));
        Items = new ReadOnlyObservableCollection<DesktopDownloadItem>(_items);
    }

    public ReadOnlyObservableCollection<DesktopDownloadItem> Items { get; }

    public event EventHandler? Changed;

    public DesktopOpenIntentRequestResult RequestOpenNextDownload() =>
        RequestNextDownloadAction(DesktopDownloadedFileAction.Open);

    public DesktopOpenIntentRequestResult RequestNextDownloadAction(
        DesktopDownloadedFileAction action)
    {
        if (action == DesktopDownloadedFileAction.None)
        {
            throw new ArgumentOutOfRangeException(nameof(action));
        }

        lock (_sync)
        {
            ExpirePendingIntent(_utcNow());
            if (_pendingIntentExpiresAt is not null || _activeActionDownloadId is not null)
            {
                return DesktopOpenIntentRequestResult.Busy;
            }

            _pendingIntentAction = action;
            _pendingIntentExpiresAt = _utcNow().Add(IntentLifetime);
            return DesktopOpenIntentRequestResult.Accepted;
        }
    }

    public DesktopDownloadItem BeginDownload(
        string? resultFilePath,
        Action? requestCancel = null,
        string? sourceWindowLabel = null)
    {
        DesktopDownloadItem item;
        lock (_sync)
        {
            var now = _utcNow();
            ExpirePendingIntent(now);
            var fileName = GetSafeFileName(resultFilePath);
            var completionAction = DesktopDownloadedFileAction.None;
            var itemId = Guid.NewGuid().ToString("N");
            if (_pendingIntentExpiresAt is not null
                && _activeActionDownloadId is null
                && CanApplyAction(_pendingIntentAction, fileName))
            {
                completionAction = _pendingIntentAction;
                _pendingIntentExpiresAt = null;
                _pendingIntentAction = DesktopDownloadedFileAction.None;
                _activeActionDownloadId = itemId;
            }

            TrimCompletedItems();
            item = new DesktopDownloadItem(
                itemId,
                fileName,
                completionAction,
                sourceWindowLabel);
            if (requestCancel is not null)
            {
                _cancelActions[itemId] = requestCancel;
            }
            _items.Insert(0, item);
        }

        OnChanged();
        return item;
    }

    public void ReportProgress(string itemId, long bytesReceived, long totalBytes)
    {
        var changed = false;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item is not null)
            {
                item.ReportProgress(bytesReceived, totalBytes);
                changed = true;
            }
        }

        if (changed) OnChanged();
    }

    public DesktopFileActionResult? CompleteDownload(string itemId, string? resultFilePath)
    {
        DesktopDownloadItem? item;
        lock (_sync)
        {
            item = FindItem(itemId);
            if (item is null
                || item.State is not (DesktopDownloadState.InProgress or DesktopDownloadState.Paused))
            {
                return DesktopFileActionResult.Failed;
            }

            item.Complete(resultFilePath);
            _cancelActions.Remove(item.Id);
            ClearActiveIntent(item.Id);
            ReorderItem(item);
        }

        OnChanged();

        return item.CompletionAction switch
        {
            DesktopDownloadedFileAction.Open => _launcher.TryOpen(item.ResultFilePath),
            DesktopDownloadedFileAction.Print => _launcher.TryPrint(item.ResultFilePath),
            DesktopDownloadedFileAction.Copy => _launcher.TryCopyToClipboard(item.ResultFilePath),
            _ => null,
        };
    }

    public void CancelDownload(string itemId)
    {
        var changed = false;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item is null
                || item.State is not (DesktopDownloadState.InProgress or DesktopDownloadState.Paused))
            {
                return;
            }

            item.Cancel();
            _cancelActions.Remove(item.Id);
            ClearActiveIntent(item.Id);
            ReorderItem(item);
            changed = true;
        }

        if (changed) OnChanged();
    }

    public void FailDownload(string itemId)
    {
        var changed = false;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item is null
                || item.State is not (DesktopDownloadState.InProgress or DesktopDownloadState.Paused))
            {
                return;
            }

            item.Fail();
            _cancelActions.Remove(item.Id);
            ClearActiveIntent(item.Id);
            ReorderItem(item);
            changed = true;
        }

        if (changed) OnChanged();
    }

    public void PauseDownload(string itemId)
    {
        var changed = false;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item?.State == DesktopDownloadState.InProgress)
            {
                item.Pause();
                changed = true;
            }
        }

        if (changed) OnChanged();
    }

    public void ResumeDownload(string itemId)
    {
        var changed = false;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item?.State == DesktopDownloadState.Paused)
            {
                item.Resume();
                changed = true;
            }
        }

        if (changed) OnChanged();
    }

    public bool TryRequestCancel(string itemId)
    {
        Action? requestCancel;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item?.CanCancel != true || !_cancelActions.TryGetValue(itemId, out requestCancel))
            {
                return false;
            }
        }

        try
        {
            requestCancel();
            return true;
        }
        catch
        {
            return false;
        }
    }

    public int ClearFinished()
    {
        int removed;
        lock (_sync)
        {
            var finished = _items.Where(item => !item.CanCancel).ToArray();
            removed = finished.Length;
            foreach (var item in finished)
            {
                _cancelActions.Remove(item.Id);
                _items.Remove(item);
            }
        }

        if (removed > 0) OnChanged();
        return removed;
    }

    public DesktopFileActionResult OpenDownloadsFolder()
    {
        var downloadsFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "Downloads");
        return _launcher.TryOpenFolder(downloadsFolder);
    }

    public DesktopFileActionResult OpenDownload(string itemId)
    {
        string? resultFilePath;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item is null || !item.CanOpen)
            {
                return DesktopFileActionResult.Unsupported;
            }

            resultFilePath = item.ResultFilePath;
        }

        return _launcher.TryOpen(resultFilePath);
    }

    public DesktopFileActionResult RevealDownload(string itemId)
    {
        string? resultFilePath;
        lock (_sync)
        {
            var item = FindItem(itemId);
            if (item is null || !item.CanReveal)
            {
                return DesktopFileActionResult.Missing;
            }

            resultFilePath = item.ResultFilePath;
        }

        return _launcher.TryRevealInFolder(resultFilePath);
    }

    private DesktopDownloadItem? FindItem(string itemId) =>
        _items.FirstOrDefault(item => string.Equals(item.Id, itemId, StringComparison.Ordinal));

    private void ClearActiveIntent(string itemId)
    {
        if (string.Equals(_activeActionDownloadId, itemId, StringComparison.Ordinal))
        {
            _activeActionDownloadId = null;
        }
    }

    private void ExpirePendingIntent(DateTimeOffset now)
    {
        if (_pendingIntentExpiresAt is not null && _pendingIntentExpiresAt <= now)
        {
            _pendingIntentExpiresAt = null;
            _pendingIntentAction = DesktopDownloadedFileAction.None;
        }
    }

    private static bool CanApplyAction(
        DesktopDownloadedFileAction action,
        string fileName) =>
        action is DesktopDownloadedFileAction.SaveAs or DesktopDownloadedFileAction.Copy
        || DesktopFileLauncher.IsSupportedFileName(fileName);

    private void TrimCompletedItems()
    {
        while (_items.Count >= MaximumSessionItems)
        {
            // Only terminal items may be evicted: a paused download can still be resumed or canceled.
            var removable = _items.LastOrDefault(item => !item.CanCancel);
            if (removable is null)
            {
                return;
            }

            _cancelActions.Remove(removable.Id);
            _items.Remove(removable);
        }
    }

    private void ReorderItem(DesktopDownloadItem item)
    {
        _items.Remove(item);
        var rank = GetSortRank(item.State);
        var insertAt = 0;
        while (insertAt < _items.Count && GetSortRank(_items[insertAt].State) <= rank)
        {
            insertAt++;
        }

        _items.Insert(insertAt, item);
    }

    private static int GetSortRank(DesktopDownloadState state) => state switch
    {
        DesktopDownloadState.InProgress or DesktopDownloadState.Paused => 0,
        DesktopDownloadState.Failed => 1,
        DesktopDownloadState.Canceled => 2,
        _ => 3,
    };

    private void OnChanged() => Changed?.Invoke(this, EventArgs.Empty);

    private static string GetSafeFileName(string? path)
    {
        try
        {
            return Path.GetFileName(path) is { Length: > 0 } fileName
                ? fileName
                : "Загрузка";
        }
        catch
        {
            return "Загрузка";
        }
    }
}
