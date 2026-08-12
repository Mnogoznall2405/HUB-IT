using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Media;
using Hub.Desktop.Configuration;
using Hub.Desktop.Security;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.Diagnostics;

public sealed record DesktopDiagnosticsContext(
    Uri ConfiguredUri,
    string WindowsAppSdkStatus,
    string NotificationMode,
    string AutostartStatus,
    string LastNavigationStatus,
    DateTimeOffset? LastNavigationAtUtc,
    DateTimeOffset? LastBridgeHandshakeUtc,
    DesktopUpdateState UpdateState,
    DesktopPerformanceSnapshot? Performance = null);

public sealed record DesktopMachineInfo(
    string DesktopVersion,
    string InstallPath,
    string WindowsDescription,
    string WindowsVersion,
    string ProcessArchitecture,
    bool? IsElevated,
    string WebView2Version,
    int WpfRenderTier,
    long? UpdateFreeSpaceBytes,
    long? WebViewProfileBytes,
    long? UpdateCacheBytes);

public sealed record DesktopDiagnosticsSnapshot(
    int SchemaVersion,
    DateTimeOffset GeneratedAtUtc,
    string DesktopVersion,
    string InstallPath,
    string WindowsDescription,
    string WindowsVersion,
    string ProcessArchitecture,
    bool? IsElevated,
    string WebView2Version,
    string WindowsAppSdkStatus,
    int WpfRenderTier,
    bool SoftwareRendering,
    string ConfiguredOrigin,
    string LastNavigationStatus,
    DateTimeOffset? LastNavigationAtUtc,
    DateTimeOffset? LastBridgeHandshakeUtc,
    string NotificationMode,
    string AutostartStatus,
    string UpdaterStatus,
    long? UpdateFreeSpaceBytes,
    long? WebViewProfileBytes,
    long? UpdateCacheBytes,
    string LogsFolder,
    long? ProcessStartToWebViewMilliseconds = null,
    long? WebViewToBridgeMilliseconds = null,
    long UiThreadStallCount = 0,
    long WebViewProcessFailureCount = 0);

public sealed class DesktopDiagnosticsCollector
{
    private const int SchemaVersion = 1;
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly Func<DesktopMachineInfo> _machineInfo;

    public DesktopDiagnosticsCollector()
        : this(() => DateTimeOffset.UtcNow, CaptureMachineInfo)
    {
    }

    internal DesktopDiagnosticsCollector(
        Func<DateTimeOffset> utcNow,
        Func<DesktopMachineInfo> machineInfo)
    {
        _utcNow = utcNow;
        _machineInfo = machineInfo;
    }

    public DesktopDiagnosticsSnapshot Collect(DesktopDiagnosticsContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        var machine = _machineInfo();
        var performance = context.Performance ?? new DesktopPerformanceSnapshot(
            null,
            null,
            0,
            0);
        return new DesktopDiagnosticsSnapshot(
            SchemaVersion,
            _utcNow(),
            machine.DesktopVersion,
            machine.InstallPath,
            machine.WindowsDescription,
            machine.WindowsVersion,
            machine.ProcessArchitecture,
            machine.IsElevated,
            machine.WebView2Version,
            SafeText(context.WindowsAppSdkStatus),
            machine.WpfRenderTier,
            machine.WpfRenderTier == 0,
            GetSafeOrigin(context.ConfiguredUri),
            SafeText(context.LastNavigationStatus),
            context.LastNavigationAtUtc,
            context.LastBridgeHandshakeUtc,
            SafeText(context.NotificationMode),
            SafeText(context.AutostartStatus),
            FormatUpdateState(context.UpdateState),
            machine.UpdateFreeSpaceBytes,
            machine.WebViewProfileBytes,
            machine.UpdateCacheBytes,
            DesktopPaths.LogsFolder,
            performance.ProcessStartToWebViewMilliseconds,
            performance.WebViewToBridgeMilliseconds,
            performance.UiThreadStallCount,
            performance.WebViewProcessFailureCount);
    }

    private static DesktopMachineInfo CaptureMachineInfo()
    {
        var version = Assembly.GetEntryAssembly()?.GetName().Version
            ?? new Version(0, 0, 0);
        var webViewVersion = "Недоступен";
        try
        {
            webViewVersion = CoreWebView2Environment.GetAvailableBrowserVersionString();
            if (string.IsNullOrWhiteSpace(webViewVersion))
            {
                webViewVersion = "Недоступен";
            }
        }
        catch
        {
            // Runtime status remains unavailable.
        }

        bool? isElevated = null;
        if (ProcessElevation.TryGetIsElevated(out var elevated, out _))
        {
            isElevated = elevated;
        }

        return new DesktopMachineInfo(
            DesktopUpdateManifestVerifier.FormatVersion(version),
            Environment.ProcessPath ?? "Недоступен",
            RuntimeInformation.OSDescription,
            Environment.OSVersion.Version.ToString(),
            RuntimeInformation.ProcessArchitecture.ToString(),
            isElevated,
            webViewVersion,
            RenderCapability.Tier >> 16,
            GetAvailableSpace(DesktopPaths.UpdatesFolder),
            GetDirectorySize(DesktopPaths.UserDataFolder),
            GetDirectorySize(DesktopPaths.UpdatesFolder));
    }

    private static string FormatUpdateState(DesktopUpdateState state) =>
        state.Status == DesktopUpdateStatus.Downloading
            ? $"{state.Status} ({state.DownloadPercent}%)"
            : state.Status.ToString();

    private static string GetSafeOrigin(Uri uri)
    {
        var builder = new UriBuilder(uri)
        {
            Path = "/",
            Query = string.Empty,
            Fragment = string.Empty,
            UserName = string.Empty,
            Password = string.Empty,
        };
        return builder.Uri.GetLeftPart(UriPartial.Authority);
    }

    private static string SafeText(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return "Недоступен";
        }

        var singleLine = value.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return singleLine.Length <= 256 ? singleLine : singleLine[..256];
    }

    private static long? GetAvailableSpace(string path)
    {
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(path));
            return root is null ? null : new DriveInfo(root).AvailableFreeSpace;
        }
        catch
        {
            return null;
        }
    }

    private static long? GetDirectorySize(string path)
    {
        try
        {
            if (!Directory.Exists(path))
            {
                return 0;
            }

            long total = 0;
            var pending = new Stack<string>();
            pending.Push(path);
            while (pending.TryPop(out var directory))
            {
                foreach (var file in Directory.EnumerateFiles(
                             directory,
                             "*",
                             SearchOption.TopDirectoryOnly))
                {
                    try
                    {
                        var info = new FileInfo(file);
                        if ((info.Attributes & FileAttributes.ReparsePoint) == 0)
                        {
                            total = checked(total + info.Length);
                        }
                    }
                    catch
                    {
                        // A locked or disappearing file does not fail diagnostics.
                    }
                }

                foreach (var child in Directory.EnumerateDirectories(
                             directory,
                             "*",
                             SearchOption.TopDirectoryOnly))
                {
                    try
                    {
                        if ((new DirectoryInfo(child).Attributes & FileAttributes.ReparsePoint) == 0)
                        {
                            pending.Push(child);
                        }
                    }
                    catch
                    {
                        // An inaccessible directory is ignored.
                    }
                }
            }

            return total;
        }
        catch
        {
            return null;
        }
    }
}
