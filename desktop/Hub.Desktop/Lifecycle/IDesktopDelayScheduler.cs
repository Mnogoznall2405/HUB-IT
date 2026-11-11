namespace Hub.Desktop.Lifecycle;

public interface IDesktopDelayScheduler
{
    IDisposable Schedule(TimeSpan delay, Action callback);
}
