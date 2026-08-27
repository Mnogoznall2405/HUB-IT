namespace Hub.Desktop.Lifecycle;

public enum DesktopCloseAction
{
    Exit,
    MinimizeToTaskbar,
}

public static class DesktopClosePolicy
{
    public static DesktopCloseAction Resolve(
        bool exitRequested,
        bool performanceBenchEnabled) =>
        exitRequested || performanceBenchEnabled
            ? DesktopCloseAction.Exit
            : DesktopCloseAction.MinimizeToTaskbar;
}
