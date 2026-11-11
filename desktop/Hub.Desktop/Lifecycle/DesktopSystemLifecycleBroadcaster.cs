using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Lifecycle;

public sealed class DesktopSystemLifecycleBroadcaster
{
    public static readonly TimeSpan MaxEventAge = DesktopSystemLifecycleMessage.MaxAge;

    public static readonly TimeSpan MaxFutureSkew = DesktopSystemLifecycleMessage.MaxFutureSkew;

    private readonly DesktopWindowManager _windows;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly HashSet<IDesktopHubWindow> _pendingTargets = [];
    private readonly Dictionary<IDesktopHubWindow, int> _deliveredGeneration = [];
    private DesktopSystemLifecycleMessage? _current;
    private bool _awaitFirstWindow;

    public DesktopSystemLifecycleBroadcaster(
        DesktopWindowManager windows,
        Func<DateTimeOffset>? utcNow = null)
    {
        _windows = windows ?? throw new ArgumentNullException(nameof(windows));
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public DesktopSystemLifecycleMessage? CurrentMessage =>
        IsFresh(_current) ? _current : null;

    public void Publish(DesktopSystemLifecycleMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        DropStale();
        if (!IsFresh(message))
        {
            return;
        }

        _current = message;
        _pendingTargets.Clear();
        _awaitFirstWindow = true;
        var registered = 0;
        _windows.ForEachWindow(window =>
        {
            registered++;
            _awaitFirstWindow = false;
            if (!TryDeliver(window, message))
            {
                _pendingTargets.Add(window);
            }
        });
        if (registered == 0)
        {
            _awaitFirstWindow = true;
        }

        PruneClosedWindows();
    }

    public void DeliverPendingTo(IDesktopHubWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        DropStale();
        if (_current is null || !IsFresh(_current))
        {
            return;
        }

        if (_awaitFirstWindow)
        {
            if (TryDeliver(window, _current))
            {
                _awaitFirstWindow = false;
                _pendingTargets.Remove(window);
            }
            else
            {
                _pendingTargets.Add(window);
            }

            return;
        }

        if (!_pendingTargets.Contains(window))
        {
            return;
        }

        if (TryDeliver(window, _current))
        {
            _pendingTargets.Remove(window);
        }

        PruneClosedWindows();
    }

    public void ForgetWindow(IDesktopHubWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        _pendingTargets.Remove(window);
        _deliveredGeneration.Remove(window);
        PruneClosedWindows();
    }

    private bool IsFresh(DesktopSystemLifecycleMessage? message)
    {
        if (message is null)
        {
            return false;
        }

        var age = _utcNow() - message.OccurredUtc.ToUniversalTime();
        if (age > MaxEventAge)
        {
            return false;
        }

        return age >= -MaxFutureSkew;
    }

    private void DropStale()
    {
        if (_current is null)
        {
            return;
        }

        if (IsFresh(_current))
        {
            return;
        }

        _current = null;
        _awaitFirstWindow = false;
        _pendingTargets.Clear();
    }

    private bool TryDeliver(IDesktopHubWindow window, DesktopSystemLifecycleMessage message)
    {
        if (_deliveredGeneration.TryGetValue(window, out var delivered)
            && delivered == message.Generation)
        {
            _pendingTargets.Remove(window);
            return true;
        }

        if (!window.TryDeliverSystemLifecycle(message))
        {
            return false;
        }

        _deliveredGeneration[window] = message.Generation;
        _pendingTargets.Remove(window);
        DesktopLog.Info(
            $"desktop_lifecycle.event_forwarded generation={message.Generation}" +
            (message.NetworkAvailable is { } available
                ? $" available={(available ? "true" : "false")}"
                : string.Empty));
        return true;
    }

    private void PruneClosedWindows()
    {
        var live = new HashSet<IDesktopHubWindow>();
        _windows.ForEachWindow(window => live.Add(window));
        _pendingTargets.RemoveWhere(window => !live.Contains(window));
        var stale = _deliveredGeneration.Keys.Where(window => !live.Contains(window)).ToArray();
        foreach (var window in stale)
        {
            _deliveredGeneration.Remove(window);
        }
    }
}
