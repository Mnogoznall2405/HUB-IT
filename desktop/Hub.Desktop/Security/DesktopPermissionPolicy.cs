using Hub.Desktop.Diagnostics;
using Hub.Desktop.Audio;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Security;

public enum DesktopPermissionDecision
{
    Allow,
    Deny,
    /// <summary>Оставить штатное поведение WebView2 (запрос пользователю).</summary>
    Default,
}

/// <summary>
/// Решение по CoreWebView2.PermissionRequested. Микрофон и камера для звонков
/// выдаются без запроса только доверенному origin портала; любые разрешения
/// чужого origin отклоняются. Остальные виды разрешений доверенного origin
/// (геолокация, уведомления, буфер обмена и т.д.) не меняются: остаётся
/// штатный запрос WebView2.
/// </summary>
public static class DesktopPermissionPolicy
{
    public static DesktopPermissionDecision Evaluate(
        NavigationPolicy navigationPolicy,
        string? requestingUri,
        CoreWebView2PermissionKind kind)
    {
        ArgumentNullException.ThrowIfNull(navigationPolicy);

        if (!Uri.TryCreate(requestingUri, UriKind.Absolute, out var uri)
            || !navigationPolicy.IsTrustedOrigin(uri))
        {
            return DesktopPermissionDecision.Deny;
        }

        return kind is CoreWebView2PermissionKind.Microphone or CoreWebView2PermissionKind.Camera
            ? DesktopPermissionDecision.Allow
            : DesktopPermissionDecision.Default;
    }

    /// <summary>
    /// Применяет решение к событию. Allow/Deny не сохраняются в профиле WebView2:
    /// политика вычисляется заново на каждый запрос.
    /// </summary>
    public static void Apply(
        NavigationPolicy navigationPolicy,
        CoreWebView2PermissionRequestedEventArgs e)
    {
        ArgumentNullException.ThrowIfNull(e);

        switch (Evaluate(navigationPolicy, e.Uri, e.PermissionKind))
        {
            case DesktopPermissionDecision.Allow:
                e.State = CoreWebView2PermissionState.Allow;
                e.SavesInProfile = false;
                break;
            case DesktopPermissionDecision.Deny:
                e.State = CoreWebView2PermissionState.Deny;
                e.SavesInProfile = false;
                break;
        }
    }

    /// <summary>
    /// A Deny stored in the WebView2 profile (for example by an earlier default
    /// prompt) suppresses PermissionRequested, so the policy above never runs.
    /// Only microphone/camera of the portal origin may be reset.
    /// </summary>
    public static bool ShouldResetStoredDeny(
        NavigationPolicy navigationPolicy,
        string? origin,
        CoreWebView2PermissionKind kind,
        CoreWebView2PermissionState state)
    {
        return state == CoreWebView2PermissionState.Deny
            && Evaluate(navigationPolicy, origin, kind) == DesktopPermissionDecision.Allow;
    }

    public static string FormatState(CoreWebView2PermissionState? state) => state switch
    {
        CoreWebView2PermissionState.Allow => "allow",
        CoreWebView2PermissionState.Deny => "deny",
        _ => "default",
    };

    /// <summary>
    /// Reads the stored portal microphone/camera permissions and turns a stored
    /// Deny into Allow for exactly that origin and kind.
    /// </summary>
    public static async Task<DesktopSiteMediaPermissions> InspectAndRepairAsync(
        NavigationPolicy navigationPolicy,
        CoreWebView2Profile profile)
    {
        ArgumentNullException.ThrowIfNull(navigationPolicy);
        ArgumentNullException.ThrowIfNull(profile);

        CoreWebView2PermissionState? microphone = null;
        CoreWebView2PermissionState? camera = null;
        var repaired = false;
        var settings = await profile.GetNonDefaultPermissionSettingsAsync();
        foreach (var setting in settings)
        {
            var kind = setting.PermissionKind;
            if (Evaluate(navigationPolicy, setting.PermissionOrigin, kind) != DesktopPermissionDecision.Allow)
            {
                continue;
            }

            var state = setting.PermissionState;
            if (ShouldResetStoredDeny(navigationPolicy, setting.PermissionOrigin, kind, state))
            {
                await profile.SetPermissionStateAsync(
                    kind,
                    setting.PermissionOrigin,
                    CoreWebView2PermissionState.Allow);
                DesktopLog.Info($"Stored portal permission reset to Allow; kind={kind}");
                repaired = true;
            }

            if (kind == CoreWebView2PermissionKind.Microphone)
            {
                microphone = state;
            }
            else
            {
                camera = state;
            }
        }

        return new DesktopSiteMediaPermissions(FormatState(microphone), FormatState(camera), repaired);
    }
}
