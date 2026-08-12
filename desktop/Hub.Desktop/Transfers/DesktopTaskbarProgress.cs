using Hub.Desktop.Downloads;

namespace Hub.Desktop.Transfers;

public enum DesktopTaskbarProgressMode
{
    None,
    Normal,
    Paused,
    Indeterminate,
}

public sealed record DesktopTaskbarProgressState(
    DesktopTaskbarProgressMode Mode,
    double Value)
{
    public static DesktopTaskbarProgressState None { get; } =
        new(DesktopTaskbarProgressMode.None, 0);
}

public sealed class DesktopTaskbarProgress
{
    private double _lastActiveValue;

    public DesktopTaskbarProgressState Calculate(IEnumerable<DesktopDownloadItem> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        var active = items
            .Where(item => item.State is DesktopDownloadState.InProgress or DesktopDownloadState.Paused)
            .ToArray();
        if (active.Length == 0)
        {
            _lastActiveValue = 0;
            return DesktopTaskbarProgressState.None;
        }

        var allPaused = active.All(item => item.State == DesktopDownloadState.Paused);
        if (active.Any(item => item.TotalBytes <= 0))
        {
            return new DesktopTaskbarProgressState(
                allPaused
                    ? DesktopTaskbarProgressMode.Paused
                    : DesktopTaskbarProgressMode.Indeterminate,
                _lastActiveValue);
        }

        var totalBytes = active.Sum(item => (double)item.TotalBytes);
        var receivedBytes = active.Sum(item =>
            Math.Min((double)item.BytesReceived, item.TotalBytes));
        var value = totalBytes <= 0
            ? 0
            : Math.Clamp(receivedBytes / totalBytes, 0, 1);
        _lastActiveValue = Math.Max(_lastActiveValue, value);
        return new DesktopTaskbarProgressState(
            allPaused ? DesktopTaskbarProgressMode.Paused : DesktopTaskbarProgressMode.Normal,
            _lastActiveValue);
    }
}
