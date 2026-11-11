namespace Hub.Desktop.Lifecycle;

public interface IDesktopSystemEventSource : IDisposable
{
    event EventHandler? Resumed;

    event EventHandler<bool>? NetworkAvailabilityChanged;
}
