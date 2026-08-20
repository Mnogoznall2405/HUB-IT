using System.Windows.Threading;

namespace Hub.Desktop.Lifecycle;

public sealed class DispatcherDelayScheduler : IDesktopDelayScheduler
{
    private readonly Dispatcher _dispatcher;

    public DispatcherDelayScheduler(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
    }

    public IDisposable Schedule(TimeSpan delay, Action callback)
    {
        ArgumentNullException.ThrowIfNull(callback);
        var timer = new DispatcherTimer(DispatcherPriority.Normal, _dispatcher)
        {
            Interval = delay <= TimeSpan.Zero ? TimeSpan.FromMilliseconds(1) : delay,
        };
        EventHandler? handler = null;
        handler = (_, _) =>
        {
            timer.Stop();
            timer.Tick -= handler;
            callback();
        };
        timer.Tick += handler;
        timer.Start();
        return new TimerLease(timer, handler);
    }

    private sealed class TimerLease : IDisposable
    {
        private DispatcherTimer? _timer;
        private EventHandler? _handler;

        public TimerLease(DispatcherTimer timer, EventHandler handler)
        {
            _timer = timer;
            _handler = handler;
        }

        public void Dispose()
        {
            if (_timer is null || _handler is null)
            {
                return;
            }

            _timer.Stop();
            _timer.Tick -= _handler;
            _timer = null;
            _handler = null;
        }
    }
}
