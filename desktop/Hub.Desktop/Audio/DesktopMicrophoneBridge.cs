using System.Diagnostics;
using Hub.Desktop.Diagnostics;
using Hub.Desktop.Interop;
using Hub.Desktop.Security;

namespace Hub.Desktop.Audio;

public enum DesktopMediaSettingsKind
{
    PrivacyMicrophone,
    Sound,
}

/// <summary>Fixed allow-list of Windows Settings pages the portal may open.</summary>
public static class DesktopMediaSettings
{
    public const string PrivacyMicrophoneKind = "privacy-microphone";
    public const string SoundKind = "sound";

    public static bool TryParseKind(string? value, out DesktopMediaSettingsKind kind)
    {
        switch (value)
        {
            case PrivacyMicrophoneKind:
                kind = DesktopMediaSettingsKind.PrivacyMicrophone;
                return true;
            case SoundKind:
                kind = DesktopMediaSettingsKind.Sound;
                return true;
            default:
                kind = default;
                return false;
        }
    }

    public static string GetUri(DesktopMediaSettingsKind kind) => kind switch
    {
        DesktopMediaSettingsKind.PrivacyMicrophone => "ms-settings:privacy-microphone",
        DesktopMediaSettingsKind.Sound => "ms-settings:sound",
        _ => throw new ArgumentOutOfRangeException(nameof(kind)),
    };
}

/// <summary>
/// Microphone part of the Desktop bridge: diagnostics and opening Windows
/// Settings, both only for a document from the trusted portal origin.
/// </summary>
public sealed class DesktopMicrophoneBridge
{
    public static readonly TimeSpan DefaultDiagnosisTimeout = TimeSpan.FromSeconds(5);

    private readonly NavigationPolicy _navigationPolicy;
    private readonly IDesktopMicrophoneDiagnostics _diagnostics;
    private readonly Func<ProcessStartInfo, bool> _start;
    private readonly TimeSpan _timeout;

    public DesktopMicrophoneBridge(NavigationPolicy navigationPolicy)
        : this(
            navigationPolicy,
            new WindowsMicrophoneDiagnostics(),
            startInfo => Process.Start(startInfo) is not null,
            DefaultDiagnosisTimeout)
    {
    }

    public DesktopMicrophoneBridge(
        NavigationPolicy navigationPolicy,
        IDesktopMicrophoneDiagnostics diagnostics,
        Func<ProcessStartInfo, bool> start,
        TimeSpan timeout)
    {
        _navigationPolicy = navigationPolicy ?? throw new ArgumentNullException(nameof(navigationPolicy));
        _diagnostics = diagnostics ?? throw new ArgumentNullException(nameof(diagnostics));
        _start = start ?? throw new ArgumentNullException(nameof(start));
        _timeout = timeout;
    }

    /// <summary>
    /// Returns the response message, or null when the document is not trusted
    /// (nothing is sent back to a foreign origin).
    /// </summary>
    public async Task<string?> CreateDiagnosisResponseAsync(
        string? documentSource,
        string requestId,
        IReadOnlyList<string> executablePaths,
        Func<Task<DesktopSiteMediaPermissions?>>? inspectSitePermissions = null)
    {
        ArgumentNullException.ThrowIfNull(executablePaths);
        if (!IsTrusted(documentSource))
        {
            DesktopLog.Warning("Rejected microphone diagnostics for an untrusted document");
            return null;
        }

        DesktopMicrophoneDiagnosis? diagnosis = null;
        try
        {
            // Core Audio calls may block on a hung driver: keep them off the UI thread.
            diagnosis = await Task.Run(() => _diagnostics.Diagnose(executablePaths)).WaitAsync(_timeout);
        }
        catch (Exception exception)
        {
            DesktopLog.Warning($"Microphone diagnostics unavailable; error={exception.GetType().Name}");
        }

        if (diagnosis is not null && inspectSitePermissions is not null)
        {
            try
            {
                diagnosis = diagnosis with { Site = await inspectSitePermissions().WaitAsync(_timeout) };
            }
            catch (Exception exception)
            {
                DesktopLog.Warning($"Site media permissions unavailable; error={exception.GetType().Name}");
            }
        }

        return DesktopBridgeProtocol.CreateMicrophoneDiagnosisMessage(requestId, diagnosis);
    }

    public bool OpenSettings(string? documentSource, DesktopMediaSettingsKind kind)
    {
        if (!IsTrusted(documentSource))
        {
            DesktopLog.Warning("Rejected Windows settings request for an untrusted document");
            return false;
        }

        try
        {
            return _start(new ProcessStartInfo(DesktopMediaSettings.GetUri(kind)) { UseShellExecute = true });
        }
        catch (Exception exception)
        {
            DesktopLog.Warning($"Windows settings could not be opened; kind={kind}; error={exception.GetType().Name}");
            return false;
        }
    }

    private bool IsTrusted(string? source) =>
        Uri.TryCreate(source, UriKind.Absolute, out var uri)
        && _navigationPolicy.IsTrustedOrigin(uri);
}
