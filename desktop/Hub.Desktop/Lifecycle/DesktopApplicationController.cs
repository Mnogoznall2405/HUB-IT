namespace Hub.Desktop.Lifecycle;

public sealed class DesktopApplicationController
{
    private readonly Action _hideTrayIcon;

    public DesktopApplicationController(Action hideTrayIcon)
    {
        _hideTrayIcon = hideTrayIcon
            ?? throw new ArgumentNullException(nameof(hideTrayIcon));
    }

    public bool ExitRequested { get; private set; }

    public void PrepareForShutdown()
    {
        if (ExitRequested)
        {
            return;
        }

        ExitRequested = true;
        _hideTrayIcon();
    }
}
