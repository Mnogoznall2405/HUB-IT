using Hub.Desktop.Diagnostics;

namespace Hub.Desktop.Lifecycle;

public sealed class DesktopSystemLifecycleCoalescer : IDisposable
{
    public static readonly TimeSpan Debounce = TimeSpan.FromSeconds(2);

    private readonly IDesktopDelayScheduler _scheduler;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly object _sync = new();
    private IDisposable? _pendingDebounce;
    private bool _sawResume;
    private bool? _networkAvailable;
    private int _generation;
    private bool _disposed;

    public DesktopSystemLifecycleCoalescer(
        IDesktopDelayScheduler scheduler,
        Func<DateTimeOffset>? utcNow = null)
    {
        _scheduler = scheduler ?? throw new ArgumentNullException(nameof(scheduler));
        _utcNow = utcNow ?? (() => DateTimeOffset.UtcNow);
    }

    public event EventHandler<DesktopSystemLifecycleMessage>? Coalesced;

    public int Generation
    {
        get
        {
            lock (_sync)
            {
                return _generation;
            }
        }
    }

    public void HandleResume()
    {
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _sawResume = true;
            ArmDebounceLocked();
        }

        DesktopLog.Info("desktop_lifecycle.resume_received");
    }

    public void HandleNetworkAvailability(bool available)
    {
        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            _networkAvailable = available;
            ArmDebounceLocked();
        }

        DesktopLog.Info(
            $"desktop_lifecycle.network_changed available={(available ? "true" : "false")}");
    }

    public void Dispose()
    {
        lock (_sync)
        {
            if (_disposed)
            {
                return;
            }

            _disposed = true;
            _pendingDebounce?.Dispose();
            _pendingDebounce = null;
            _sawResume = false;
            _networkAvailable = null;
        }
    }

    private void ArmDebounceLocked()
    {
        _pendingDebounce?.Dispose();
        _pendingDebounce = _scheduler.Schedule(Debounce, Flush);
    }

    private void Flush()
    {
        DesktopSystemLifecycleMessage? message = null;
        lock (_sync)
        {
            if (_disposed || (!_sawResume && _networkAvailable is null))
            {
                return;
            }

            _generation++;
            var occurredUtc = _utcNow().ToUniversalTime();
            if (_networkAvailable == false)
            {
                message = new DesktopSystemLifecycleMessage(
                    DesktopSystemLifecycleKind.NetworkChanged,
                    _generation,
                    occurredUtc,
                    NetworkAvailable: false);
            }
            else if (_sawResume)
            {
                message = new DesktopSystemLifecycleMessage(
                    DesktopSystemLifecycleKind.Resume,
                    _generation,
                    occurredUtc,
                    NetworkAvailable: null);
            }
            else
            {
                message = new DesktopSystemLifecycleMessage(
                    DesktopSystemLifecycleKind.NetworkChanged,
                    _generation,
                    occurredUtc,
                    NetworkAvailable: true);
            }

            _sawResume = false;
            _networkAvailable = null;
            _pendingDebounce = null;
        }

        if (message is null)
        {
            return;
        }

        DesktopLog.Info(
            $"desktop_lifecycle.event_coalesced generation={message.Generation} " +
            $"kind={message.Kind} recovery={(message.IsRecoveryAttempt ? "true" : "false")}" +
            (message.NetworkAvailable is { } available
                ? $" available={(available ? "true" : "false")}"
                : string.Empty));
        Coalesced?.Invoke(this, message);
    }
}
