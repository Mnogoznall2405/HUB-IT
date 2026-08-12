using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Hub.Desktop.UpdateCore;

namespace Hub.Desktop.Configuration;

public enum DesktopThemePreference
{
    System,
    Light,
    Dark,
}

public enum DesktopStartupPage
{
    Home,
    LastSafePage,
}

public enum DesktopLaunchVisibility
{
    Hidden,
    OpenWindow,
}

public enum DesktopCloseBehavior
{
    AlwaysHide,
    AskOnce,
}

public sealed record DesktopWindowPlacement(
    int X,
    int Y,
    int Width,
    int Height,
    bool Maximized);

public sealed record DesktopSettings(
    string? DeferredUpdateVersion,
    DateTimeOffset? DeferredUpdateUntilUtc,
    DesktopThemePreference Theme,
    bool DiagnosticExportAllowed,
    DesktopStartupPage StartupPage = DesktopStartupPage.Home,
    string? LastSafeRoute = null,
    DesktopWindowPlacement? WindowPlacement = null,
    DateTimeOffset? QuietUntilUtc = null,
    bool QuietIndefinitely = false,
    bool HideNotificationContentWhenLocked = true,
    DesktopLaunchVisibility LaunchVisibility = DesktopLaunchVisibility.Hidden,
    DesktopCloseBehavior CloseBehavior = DesktopCloseBehavior.AlwaysHide,
    bool GlobalHotkeyEnabled = false,
    string? InstalledReleaseNotesVersion = null,
    IReadOnlyList<string>? InstalledReleaseNotes = null)
{
    public static DesktopSettings Default { get; } = new(
        DeferredUpdateVersion: null,
        DeferredUpdateUntilUtc: null,
        Theme: DesktopThemePreference.System,
        DiagnosticExportAllowed: false,
        StartupPage: DesktopStartupPage.Home,
        LastSafeRoute: null,
        WindowPlacement: null,
        QuietUntilUtc: null,
        QuietIndefinitely: false,
        HideNotificationContentWhenLocked: true,
        LaunchVisibility: DesktopLaunchVisibility.Hidden,
        CloseBehavior: DesktopCloseBehavior.AlwaysHide,
        GlobalHotkeyEnabled: false,
        InstalledReleaseNotesVersion: null,
        InstalledReleaseNotes: null);
}

public sealed class DesktopSettingsStore
{
    private const int SchemaVersion = 1;
    private const int MaximumSettingsBytes = 16 * 1024;
    private static readonly Regex VersionPattern = new(
        "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        WriteIndented = true,
        Converters =
        {
            new JsonStringEnumConverter(JsonNamingPolicy.SnakeCaseLower),
        },
    };
    private readonly object _sync = new();

    public DesktopSettingsStore(string settingsPath)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(settingsPath);
        SettingsPath = Path.GetFullPath(settingsPath);
    }

    public string SettingsPath { get; }

    public DesktopSettings Load()
    {
        lock (_sync)
        {
            try
            {
                if (!File.Exists(SettingsPath))
                {
                    return DesktopSettings.Default;
                }

                var info = new FileInfo(SettingsPath);
                if (info.Length is <= 0 or > MaximumSettingsBytes)
                {
                    return DesktopSettings.Default;
                }

                var document = JsonSerializer.Deserialize<DesktopSettingsDocument>(
                    File.ReadAllText(SettingsPath, Encoding.UTF8),
                    JsonOptions);
                return document is not null && TryValidate(document, out var settings)
                    ? settings
                    : DesktopSettings.Default;
            }
            catch (Exception exception) when (
                exception is IOException
                or UnauthorizedAccessException
                or JsonException)
            {
                return DesktopSettings.Default;
            }
        }
    }

    public void Save(DesktopSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);
        Validate(settings);

        lock (_sync)
        {
            var directory = Path.GetDirectoryName(SettingsPath)
                ?? throw new InvalidOperationException("Desktop settings path has no directory.");
            Directory.CreateDirectory(directory);
            var temporaryPath = SettingsPath + ".tmp";
            var document = new DesktopSettingsDocument(
                SchemaVersion,
                settings.DeferredUpdateVersion,
                settings.DeferredUpdateUntilUtc,
                settings.Theme,
                settings.DiagnosticExportAllowed,
                settings.StartupPage,
                settings.LastSafeRoute,
                settings.WindowPlacement,
                settings.QuietUntilUtc,
                settings.QuietIndefinitely,
                settings.HideNotificationContentWhenLocked,
                settings.LaunchVisibility,
                settings.CloseBehavior,
                settings.GlobalHotkeyEnabled,
                settings.InstalledReleaseNotesVersion,
                settings.InstalledReleaseNotes);
            var json = JsonSerializer.Serialize(document, JsonOptions);
            File.WriteAllText(temporaryPath, json, new UTF8Encoding(false));
            File.Move(temporaryPath, SettingsPath, overwrite: true);
        }
    }

    public DateTimeOffset? GetDeferredUpdateUntil(Version version)
    {
        ArgumentNullException.ThrowIfNull(version);
        var settings = Load();
        return string.Equals(
            settings.DeferredUpdateVersion,
            DesktopUpdateManifestVerifier.FormatVersion(version),
            StringComparison.Ordinal)
                ? settings.DeferredUpdateUntilUtc
                : null;
    }

    public void SetDeferredUpdate(Version version, DateTimeOffset deferredUntil)
    {
        ArgumentNullException.ThrowIfNull(version);
        lock (_sync)
        {
            Save(Load() with
            {
                DeferredUpdateVersion =
                    DesktopUpdateManifestVerifier.FormatVersion(version),
                DeferredUpdateUntilUtc = deferredUntil,
            });
        }
    }

    public IReadOnlyList<string> GetInstalledReleaseNotes(Version version)
    {
        ArgumentNullException.ThrowIfNull(version);
        var settings = Load();
        return string.Equals(
                settings.InstalledReleaseNotesVersion,
                DesktopUpdateManifestVerifier.FormatVersion(version),
                StringComparison.Ordinal)
            ? settings.InstalledReleaseNotes?.ToArray() ?? []
            : [];
    }

    public void SetInstalledReleaseNotes(
        Version version,
        IReadOnlyList<string> releaseNotes)
    {
        ArgumentNullException.ThrowIfNull(version);
        ArgumentNullException.ThrowIfNull(releaseNotes);
        var notes = releaseNotes.ToArray();
        Update(settings => settings with
        {
            InstalledReleaseNotesVersion =
                DesktopUpdateManifestVerifier.FormatVersion(version),
            InstalledReleaseNotes = notes,
        });
    }

    public DesktopSettings Update(Func<DesktopSettings, DesktopSettings> update)
    {
        ArgumentNullException.ThrowIfNull(update);
        lock (_sync)
        {
            var settings = update(Load());
            Save(settings);
            return settings;
        }
    }

    private static bool TryValidate(
        DesktopSettingsDocument document,
        out DesktopSettings settings)
    {
        settings = DesktopSettings.Default;
        if (document.SchemaVersion != SchemaVersion)
        {
            return false;
        }

        var candidate = new DesktopSettings(
            document.DeferredUpdateVersion,
            document.DeferredUpdateUntilUtc,
            document.Theme,
            document.DiagnosticExportAllowed,
            document.StartupPage,
            document.LastSafeRoute,
            document.WindowPlacement,
            document.QuietUntilUtc,
            document.QuietIndefinitely,
            document.HideNotificationContentWhenLocked,
            document.LaunchVisibility,
            document.CloseBehavior,
            document.GlobalHotkeyEnabled,
            document.InstalledReleaseNotesVersion,
            document.InstalledReleaseNotes);
        try
        {
            Validate(candidate);
            settings = candidate;
            return true;
        }
        catch (ArgumentException)
        {
            return false;
        }
    }

    private static void Validate(DesktopSettings settings)
    {
        var hasVersion = settings.DeferredUpdateVersion is not null;
        var hasUntil = settings.DeferredUpdateUntilUtc is not null;
        if (hasVersion != hasUntil)
        {
            throw new ArgumentException(
                "Deferred update version and time must be set together.",
                nameof(settings));
        }

        if (hasVersion && !VersionPattern.IsMatch(settings.DeferredUpdateVersion!))
        {
            throw new ArgumentException("Deferred update version is invalid.", nameof(settings));
        }

        var hasReleaseNotesVersion = settings.InstalledReleaseNotesVersion is not null;
        var hasReleaseNotes = settings.InstalledReleaseNotes is not null;
        if (hasReleaseNotesVersion != hasReleaseNotes)
        {
            throw new ArgumentException(
                "Installed release notes version and notes must be set together.",
                nameof(settings));
        }

        if (hasReleaseNotesVersion
            && (!VersionPattern.IsMatch(settings.InstalledReleaseNotesVersion!)
                || settings.InstalledReleaseNotes!.Count > 10
                || settings.InstalledReleaseNotes.Any(note =>
                    string.IsNullOrWhiteSpace(note)
                    || note.Length > 200
                    || note.Any(char.IsControl))))
        {
            throw new ArgumentException("Installed release notes are invalid.", nameof(settings));
        }

        if (!Enum.IsDefined(settings.Theme))
        {
            throw new ArgumentException("Desktop theme is invalid.", nameof(settings));
        }


        if (!Enum.IsDefined(settings.StartupPage))
        {
            throw new ArgumentException("Desktop startup page is invalid.", nameof(settings));
        }

        if (!Enum.IsDefined(settings.LaunchVisibility))
        {
            throw new ArgumentException("Desktop launch visibility is invalid.", nameof(settings));
        }

        if (!Enum.IsDefined(settings.CloseBehavior))
        {
            throw new ArgumentException("Desktop close behavior is invalid.", nameof(settings));
        }

        if (settings.LastSafeRoute is not null
            && !Interop.DesktopBridgeProtocol.IsValidInternalRoute(settings.LastSafeRoute))
        {
            throw new ArgumentException("Desktop last route is invalid.", nameof(settings));
        }

        if (settings.WindowPlacement is { } placement
            && (placement.Width is < 320 or > 16_384
                || placement.Height is < 240 or > 16_384
                || placement.X is < -100_000 or > 100_000
                || placement.Y is < -100_000 or > 100_000))
        {
            throw new ArgumentException("Desktop window placement is invalid.", nameof(settings));
        }

        if (settings.QuietIndefinitely && settings.QuietUntilUtc is not null)
        {
            throw new ArgumentException(
                "Desktop quiet mode cannot have both an expiry and an indefinite flag.",
                nameof(settings));
        }
    }

    private sealed record DesktopSettingsDocument(
        int SchemaVersion,
        string? DeferredUpdateVersion,
        DateTimeOffset? DeferredUpdateUntilUtc,
        DesktopThemePreference Theme,
        bool DiagnosticExportAllowed,
        DesktopStartupPage StartupPage = DesktopStartupPage.Home,
        string? LastSafeRoute = null,
        DesktopWindowPlacement? WindowPlacement = null,
        DateTimeOffset? QuietUntilUtc = null,
        bool QuietIndefinitely = false,
        bool HideNotificationContentWhenLocked = true,
        DesktopLaunchVisibility LaunchVisibility = DesktopLaunchVisibility.Hidden,
        DesktopCloseBehavior CloseBehavior = DesktopCloseBehavior.AlwaysHide,
        bool GlobalHotkeyEnabled = false,
        string? InstalledReleaseNotesVersion = null,
        IReadOnlyList<string>? InstalledReleaseNotes = null);
}
