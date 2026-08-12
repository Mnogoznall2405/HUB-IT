using Hub.Desktop.Configuration;

namespace Hub.Desktop.Updates;

public sealed class DesktopUpdateCoordinator : IDisposable
{
    private readonly IDesktopUpdateService _service;
    private readonly DesktopUpdateOptions _options;
    private readonly bool _enabled;
    private readonly object _stateSync = new();
    private readonly CancellationTokenSource _shutdown = new();
    private DesktopUpdateState _current;
    private DesktopUpdatePackage? _readyPackage;
    private Task? _loopTask;
    private int _checkInProgress;
    private bool _disposed;

    public DesktopUpdateCoordinator(
        IDesktopUpdateService service,
        DesktopUpdateOptions options)
    {
        _service = service;
        _options = options;
        _enabled = options.Enabled;
        _current = new DesktopUpdateState(
            _enabled ? DesktopUpdateStatus.Idle : DesktopUpdateStatus.Disabled,
            ReleaseNotes: _service.InstalledReleaseNotes);
        _service.DownloadProgress += Service_DownloadProgress;
    }

    public event EventHandler<DesktopUpdateState>? StateChanged;

    public DesktopUpdateState Current
    {
        get
        {
            lock (_stateSync)
            {
                return _current;
            }
        }
    }

    public DesktopUpdatePackage? ReadyPackage
    {
        get
        {
            lock (_stateSync)
            {
                return _readyPackage;
            }
        }
    }

    public void Start()
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_enabled || _loopTask is not null)
        {
            return;
        }

        _loopTask = Task.Run(() => RunLoopAsync(_shutdown.Token));
    }

    public async Task<bool> CheckNowAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (!_enabled || Interlocked.CompareExchange(ref _checkInProgress, 1, 0) != 0)
        {
            return false;
        }

        try
        {
            SetState(Current with
            {
                Status = DesktopUpdateStatus.Checking,
                ErrorCode = null,
            });
            var package = await _service.CheckOnceAsync(cancellationToken);
            var checkedAt = DateTimeOffset.UtcNow;
            lock (_stateSync)
            {
                _readyPackage = package;
            }
            SetState(package is null
                ? new DesktopUpdateState(
                    DesktopUpdateStatus.Idle,
                    LastSuccessfulCheckUtc: checkedAt,
                    ReleaseNotes: _service.InstalledReleaseNotes)
                : CreatePackageState(package, checkedAt));
            return true;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            SetState(Current with { Status = DesktopUpdateStatus.Idle });
            throw;
        }
        catch (Exception exception)
        {
            SetState(Current with
            {
                Status = DesktopUpdateStatus.Error,
                ErrorCode = exception.GetType().Name,
            });
            return true;
        }
        finally
        {
            Interlocked.Exchange(ref _checkInProgress, 0);
        }
    }

    public async Task<bool> DeferReadyUpdateAsync(
        DateTimeOffset deferredUntil,
        CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var package = ReadyPackage;
        if (package is null || deferredUntil <= DateTimeOffset.UtcNow)
        {
            return false;
        }

        await _service.DeferAsync(package, deferredUntil, cancellationToken);
        SetState(Current with
        {
            Status = DesktopUpdateStatus.Deferred,
            DeferredUntil = deferredUntil,
            ErrorCode = null,
        });
        return true;
    }

    public bool TryInstallReadyUpdate(string applicationPath)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        var package = ReadyPackage;
        if (package is null || !_service.TryLaunchInstaller(package, applicationPath))
        {
            if (package is not null)
            {
                SetState(Current with
                {
                    Status = DesktopUpdateStatus.Error,
                    ErrorCode = "runner_launch",
                });
            }

            return false;
        }

        SetState(Current with
        {
            Status = DesktopUpdateStatus.Installing,
            ErrorCode = null,
        });
        return true;
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _service.DownloadProgress -= Service_DownloadProgress;
        _shutdown.Cancel();
        _shutdown.Dispose();
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(
                RandomDelay(
                    _options.InitialDelayMinimum,
                    _options.InitialDelayMaximum),
                cancellationToken);
            while (!cancellationToken.IsCancellationRequested)
            {
                await CheckNowAsync(cancellationToken);
                var delay = Current.Status == DesktopUpdateStatus.Error
                    ? _options.RetryDelay
                    : _options.CheckInterval;
                await Task.Delay(delay, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal shutdown.
        }
    }

    private static DesktopUpdateState CreatePackageState(
        DesktopUpdatePackage package,
        DateTimeOffset checkedAt)
    {
        var deferred = package.DeferredUntil is not null
            && package.DeferredUntil > DateTimeOffset.UtcNow;
        return new DesktopUpdateState(
            deferred ? DesktopUpdateStatus.Deferred : DesktopUpdateStatus.Ready,
            package.Manifest.Version,
            package.Manifest.SizeBytes,
            package.Manifest.SizeBytes,
            checkedAt,
            package.DeferredUntil,
            package.Manifest.ReleaseNotes);
    }

    private void SetState(DesktopUpdateState state)
    {
        lock (_stateSync)
        {
            _current = state;
        }

        StateChanged?.Invoke(this, state);
    }

    private void Service_DownloadProgress(
        object? sender,
        DesktopUpdateDownloadProgress progress)
    {
        if (_disposed)
        {
            return;
        }

        SetState(Current with
        {
            Status = DesktopUpdateStatus.Downloading,
            Version = progress.Version,
            DownloadedBytes = Math.Clamp(
                progress.DownloadedBytes,
                0,
                Math.Max(0, progress.TotalBytes)),
            TotalBytes = Math.Max(0, progress.TotalBytes),
            ErrorCode = null,
        });
    }

    private static TimeSpan RandomDelay(TimeSpan minimum, TimeSpan maximum)
    {
        var range = maximum - minimum;
        return range <= TimeSpan.Zero
            ? minimum
            : minimum + TimeSpan.FromMilliseconds(
                Random.Shared.NextDouble() * range.TotalMilliseconds);
    }
}
