using Microsoft.Win32;
using System.Net.NetworkInformation;

namespace Hub.Desktop.Lifecycle;

public sealed class WindowsDesktopSystemEventSource : IDesktopSystemEventSource
{
    private bool _disposed;

    public WindowsDesktopSystemEventSource()
    {
        SystemEvents.PowerModeChanged += SystemEvents_PowerModeChanged;
        NetworkChange.NetworkAvailabilityChanged += NetworkChange_NetworkAvailabilityChanged;
    }

    public event EventHandler? Resumed;

    public event EventHandler<bool>? NetworkAvailabilityChanged;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        SystemEvents.PowerModeChanged -= SystemEvents_PowerModeChanged;
        NetworkChange.NetworkAvailabilityChanged -= NetworkChange_NetworkAvailabilityChanged;
    }

    private void SystemEvents_PowerModeChanged(object sender, PowerModeChangedEventArgs e)
    {
        if (e.Mode == PowerModes.Resume)
        {
            Resumed?.Invoke(this, EventArgs.Empty);
        }
    }

    private void NetworkChange_NetworkAvailabilityChanged(
        object? sender,
        NetworkAvailabilityEventArgs e)
    {
        NetworkAvailabilityChanged?.Invoke(this, e.IsAvailable);
    }
}
