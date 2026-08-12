namespace Hub.Desktop.Configuration;

public enum DesktopAutostartMode
{
    UserChoice = 0,
    ForcedOn = 1,
    ForcedOff = 2,
}

public sealed record DesktopPolicy(
    DesktopAutostartMode AutostartMode,
    bool? UpdatesEnabled,
    int? UpdateDeferralHours,
    bool? DiagnosticsExportEnabled,
    bool? NotificationFallbackEnabled)
{
    public const int MaximumUpdateDeferralHours = 168;

    public static DesktopPolicy Empty { get; } = new(
        DesktopAutostartMode.UserChoice,
        UpdatesEnabled: null,
        UpdateDeferralHours: null,
        DiagnosticsExportEnabled: null,
        NotificationFallbackEnabled: null);

    public bool ResolveUpdatesEnabled(bool configuredDefault) =>
        UpdatesEnabled ?? configuredDefault;

    public int ResolveUpdateDeferralHours(int defaultHours) =>
        UpdateDeferralHours ?? Math.Clamp(defaultHours, 0, MaximumUpdateDeferralHours);

    public bool ResolveDiagnosticsExportEnabled(bool defaultEnabled) =>
        DiagnosticsExportEnabled ?? defaultEnabled;

    public bool ResolveNotificationFallbackEnabled(bool defaultEnabled) =>
        NotificationFallbackEnabled ?? defaultEnabled;
}
