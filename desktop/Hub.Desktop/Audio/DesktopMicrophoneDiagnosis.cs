using System.IO;

namespace Hub.Desktop.Audio;

public enum DesktopMicrophoneProbeStatus
{
    NotRun,
    Ok,
    NoDefaultDevice,
    DeviceInUse,
    AccessDenied,
    DeviceInvalidated,
    ServiceNotRunning,
    Failed,
}

public enum DesktopMicrophoneReason
{
    /// <summary>
    /// Windows opens the default microphone for HUB.Desktop.exe itself. If the
    /// page still fails, the block is specific to the WebView2 processes.
    /// </summary>
    NativeCaptureOk,
    AppConsentDenied,
    PrivacyDenied,
    NoDevices,
    DevicesDisabled,
    NoDefaultDevice,
    ExclusiveInUse,
    DeviceInvalidated,
    AudioServiceStopped,
    ProbeFailed,
}

public sealed record DesktopMicrophoneDevice(string Id, string Name, string State);

/// <summary>
/// Raw values of the Windows microphone privacy switches. Strings are the
/// registry "Value" (normally "Allow"/"Deny"); null means the value is absent.
/// Policy is LetAppsAccessMicrophone (0 user in control, 1 force allow, 2 force deny).
/// </summary>
public sealed record DesktopMicrophoneConsent(
    string? User,
    string? UserNonPackaged,
    string? Machine,
    int? Policy);

/// <summary>
/// Per-executable entry under ConsentStore\microphone\NonPackaged. Only the
/// file name leaves the host; the full path may contain the user profile.
/// </summary>
public sealed record DesktopMicrophoneAppConsent(string Name, string? User, string? Machine);

/// <summary>Stored WebView2 site permissions of the portal origin ("allow"/"deny"/"default").</summary>
public sealed record DesktopSiteMediaPermissions(string Microphone, string Camera, bool Repaired);

public sealed record DesktopMicrophoneDiagnosis(
    IReadOnlyList<DesktopMicrophoneDevice> Devices,
    DesktopMicrophoneDevice? DefaultConsole,
    DesktopMicrophoneDevice? DefaultCommunications,
    DesktopMicrophoneConsent Consent,
    IReadOnlyList<DesktopMicrophoneAppConsent> Apps,
    DesktopMicrophoneProbeStatus Probe,
    int? ProbeHresult,
    DesktopMicrophoneReason Reason,
    DesktopSiteMediaPermissions? Site = null);

public interface IDesktopMicrophoneDiagnostics
{
    /// <summary>
    /// Read-only system inspection; must not change any Windows setting.
    /// <paramref name="executablePaths"/> are checked for per-app consent.
    /// </summary>
    DesktopMicrophoneDiagnosis Diagnose(IReadOnlyList<string> executablePaths);
}

/// <summary>
/// Pure mapping from Core Audio results and privacy switches to a single
/// user-facing reason. Kept separate from COM so the priority matrix is testable.
/// </summary>
public static class DesktopMicrophoneDiagnosisClassifier
{
    public const int SOk = 0;
    public const int EAccessDenied = unchecked((int)0x80070005);
    public const int ENotFound = unchecked((int)0x80070490);
    public const int AudclntEDeviceInvalidated = unchecked((int)0x88890004);
    public const int AudclntEDeviceInUse = unchecked((int)0x8889000A);
    public const int AudclntEServiceNotRunning = unchecked((int)0x88890010);

    public const uint DeviceStateActive = 0x1;
    public const uint DeviceStateDisabled = 0x2;
    public const uint DeviceStateNotPresent = 0x4;
    public const uint DeviceStateUnplugged = 0x8;

    public static DesktopMicrophoneProbeStatus MapProbeResult(int hresult) => hresult switch
    {
        SOk => DesktopMicrophoneProbeStatus.Ok,
        EAccessDenied => DesktopMicrophoneProbeStatus.AccessDenied,
        ENotFound => DesktopMicrophoneProbeStatus.NoDefaultDevice,
        AudclntEDeviceInUse => DesktopMicrophoneProbeStatus.DeviceInUse,
        AudclntEDeviceInvalidated => DesktopMicrophoneProbeStatus.DeviceInvalidated,
        AudclntEServiceNotRunning => DesktopMicrophoneProbeStatus.ServiceNotRunning,
        _ => DesktopMicrophoneProbeStatus.Failed,
    };

    public static string FormatDeviceState(uint state) => state switch
    {
        DeviceStateActive => "active",
        DeviceStateDisabled => "disabled",
        DeviceStateNotPresent => "notPresent",
        DeviceStateUnplugged => "unplugged",
        _ => "unknown",
    };

    /// <summary>
    /// ConsentStore names a non-packaged app by its full path with '\' replaced by '#'.
    /// </summary>
    public static string? ToConsentKeyName(string? executablePath)
    {
        if (string.IsNullOrWhiteSpace(executablePath)
            || !Path.IsPathFullyQualified(executablePath)
            || executablePath.Any(char.IsControl))
        {
            return null;
        }

        return Path.GetFullPath(executablePath).Replace('\\', '#');
    }

    /// <summary>
    /// Switches that apply to an unpackaged Win32 app: the device-wide value (HKLM),
    /// "let desktop apps access" (HKCU NonPackaged) and the LetAppsAccessMicrophone
    /// policy. The HKCU top-level value governs packaged (Store) apps only and is
    /// reported for information, not treated as a cause.
    /// </summary>
    public static bool IsConsentDenied(DesktopMicrophoneConsent consent)
    {
        ArgumentNullException.ThrowIfNull(consent);
        return IsDeny(consent.Machine)
            || IsDeny(consent.UserNonPackaged)
            || consent.Policy == 2;
    }

    public static bool IsAppConsentDenied(IReadOnlyList<DesktopMicrophoneAppConsent> apps)
    {
        ArgumentNullException.ThrowIfNull(apps);
        return apps.Any(app => IsDeny(app.User) || IsDeny(app.Machine));
    }

    public static DesktopMicrophoneReason Classify(
        DesktopMicrophoneProbeStatus probe,
        DesktopMicrophoneConsent consent,
        IReadOnlyList<DesktopMicrophoneAppConsent> apps,
        IReadOnlyList<DesktopMicrophoneDevice> devices,
        bool hasDefaultConsoleDevice)
    {
        ArgumentNullException.ThrowIfNull(consent);
        ArgumentNullException.ThrowIfNull(devices);

        // A per-app Deny on HUB.Desktop.exe or msedgewebview2.exe blocks the page
        // even when the native probe succeeds, so it is checked first.
        if (IsAppConsentDenied(apps))
        {
            return DesktopMicrophoneReason.AppConsentDenied;
        }

        // A successful open from this process is the strongest signal: stale
        // global switches or extra endpoints must not invent a problem.
        if (probe == DesktopMicrophoneProbeStatus.Ok)
        {
            return DesktopMicrophoneReason.NativeCaptureOk;
        }

        if (probe == DesktopMicrophoneProbeStatus.AccessDenied || IsConsentDenied(consent))
        {
            return DesktopMicrophoneReason.PrivacyDenied;
        }

        if (probe == DesktopMicrophoneProbeStatus.ServiceNotRunning)
        {
            return DesktopMicrophoneReason.AudioServiceStopped;
        }

        if (devices.Count == 0)
        {
            return DesktopMicrophoneReason.NoDevices;
        }

        if (!devices.Any(device => device.State == "active"))
        {
            return DesktopMicrophoneReason.DevicesDisabled;
        }

        if (!hasDefaultConsoleDevice || probe == DesktopMicrophoneProbeStatus.NoDefaultDevice)
        {
            return DesktopMicrophoneReason.NoDefaultDevice;
        }

        return probe switch
        {
            DesktopMicrophoneProbeStatus.DeviceInUse => DesktopMicrophoneReason.ExclusiveInUse,
            DesktopMicrophoneProbeStatus.DeviceInvalidated => DesktopMicrophoneReason.DeviceInvalidated,
            _ => DesktopMicrophoneReason.ProbeFailed,
        };
    }

    private static bool IsDeny(string? value) =>
        string.Equals(value?.Trim(), "Deny", StringComparison.OrdinalIgnoreCase);
}
