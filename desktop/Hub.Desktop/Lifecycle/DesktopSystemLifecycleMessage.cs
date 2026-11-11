namespace Hub.Desktop.Lifecycle;

public enum DesktopSystemLifecycleKind
{
    Resume,
    NetworkChanged,
}

public sealed record DesktopSystemLifecycleMessage(
    DesktopSystemLifecycleKind Kind,
    int Generation,
    DateTimeOffset OccurredUtc,
    bool? NetworkAvailable)
{
    public bool IsRecoveryAttempt =>
        Kind == DesktopSystemLifecycleKind.Resume
        || (Kind == DesktopSystemLifecycleKind.NetworkChanged && NetworkAvailable == true);

    public static readonly TimeSpan MaxAge = TimeSpan.FromSeconds(120);

    public static readonly TimeSpan MaxFutureSkew = TimeSpan.FromSeconds(5);
}
