using Hub.Desktop.Configuration;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopSettingsStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "hub-desktop-settings-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public void MissingFileReturnsSafeDefaults()
    {
        var store = CreateStore();

        var settings = store.Load();

        Assert.Equal(DesktopSettings.Default, settings);
    }

    [Fact]
    public void SavesAndLoadsOnlyAllowedSettings()
    {
        var store = CreateStore();
        var deferredUntil = DateTimeOffset.UtcNow.AddHours(24);
        var expected = new DesktopSettings(
            DeferredUpdateVersion: "0.1.8",
            DeferredUpdateUntilUtc: deferredUntil,
            Theme: DesktopThemePreference.Dark,
            DiagnosticExportAllowed: true,
            StartupPage: DesktopStartupPage.LastSafePage,
            LastSafeRoute: "/chat?conversation=42",
            WindowPlacement: new DesktopWindowPlacement(-1800, 80, 1360, 860, true),
            QuietUntilUtc: deferredUntil.AddHours(1),
            QuietIndefinitely: false,
            HideNotificationContentWhenLocked: false,
            LaunchVisibility: DesktopLaunchVisibility.OpenWindow,
            CloseBehavior: DesktopCloseBehavior.AskOnce,
            GlobalHotkeyEnabled: true);

        store.Save(expected);
        var actual = store.Load();

        Assert.Equal(expected, actual);
        var json = File.ReadAllText(store.SettingsPath);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cookie", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("password", json, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("not-json")]
    [InlineData("{\"schema_version\":1,\"access_token\":\"secret\"}")]
    [InlineData("{\"schema_version\":9}")]
    [InlineData("{\"schema_version\":1,\"deferred_update_version\":\"bad\",\"deferred_update_until_utc\":\"2026-08-12T00:00:00Z\"}")]
    public void InvalidFileReturnsSafeDefaults(string json)
    {
        var store = CreateStore();
        Directory.CreateDirectory(Path.GetDirectoryName(store.SettingsPath)!);
        File.WriteAllText(store.SettingsPath, json);

        var settings = store.Load();

        Assert.Equal(DesktopSettings.Default, settings);
    }

    [Fact]
    public void RemovingSettingsDoesNotRemoveWebViewProfile()
    {
        var store = CreateStore();
        var profileFile = Path.Combine(_root, "WebView2", "profile.dat");
        Directory.CreateDirectory(Path.GetDirectoryName(profileFile)!);
        File.WriteAllText(profileFile, "profile");
        store.Save(DesktopSettings.Default with
        {
            DiagnosticExportAllowed = true,
        });

        File.Delete(store.SettingsPath);

        Assert.True(File.Exists(profileFile));
        Assert.Equal("profile", File.ReadAllText(profileFile));
        Assert.Equal(DesktopSettings.Default, store.Load());
    }

    [Fact]
    public void ReadsDeferredTimeOnlyForMatchingVersion()
    {
        var store = CreateStore();
        var deferredUntil = DateTimeOffset.UtcNow.AddHours(24);

        store.SetDeferredUpdate(new Version(0, 1, 8), deferredUntil);

        Assert.Equal(
            deferredUntil,
            store.GetDeferredUpdateUntil(new Version(0, 1, 8)));
        Assert.Null(store.GetDeferredUpdateUntil(new Version(0, 1, 9)));
    }

    [Fact]
    public void PersistsReleaseNotesOnlyForMatchingInstalledVersion()
    {
        var store = CreateStore();

        store.SetInstalledReleaseNotes(
            new Version(0, 1, 11),
            ["Исправлено повторное открытие HUB", "Обновлено меню Desktop"]);

        Assert.Equal(
            ["Исправлено повторное открытие HUB", "Обновлено меню Desktop"],
            store.GetInstalledReleaseNotes(new Version(0, 1, 11)));
        Assert.Empty(store.GetInstalledReleaseNotes(new Version(0, 1, 10)));
    }

    [Fact]
    public void LoadsLegacySchemaOneSettingsWithWorkspaceDefaults()
    {
        var store = CreateStore();
        Directory.CreateDirectory(Path.GetDirectoryName(store.SettingsPath)!);
        File.WriteAllText(
            store.SettingsPath,
            """{"schema_version":1,"deferred_update_version":null,"deferred_update_until_utc":null,"theme":"dark","diagnostic_export_allowed":true}""");

        var settings = store.Load();

        Assert.Equal(DesktopThemePreference.Dark, settings.Theme);
        Assert.True(settings.DiagnosticExportAllowed);
        Assert.Equal(DesktopStartupPage.Home, settings.StartupPage);
        Assert.Null(settings.LastSafeRoute);
        Assert.Null(settings.WindowPlacement);
        Assert.Null(settings.QuietUntilUtc);
        Assert.False(settings.QuietIndefinitely);
        Assert.True(settings.HideNotificationContentWhenLocked);
        Assert.Equal(DesktopLaunchVisibility.Hidden, settings.LaunchVisibility);
        Assert.Equal(DesktopCloseBehavior.AlwaysHide, settings.CloseBehavior);
        Assert.False(settings.GlobalHotkeyEnabled);
    }

    [Fact]
    public void RejectsConflictingQuietModeState()
    {
        var store = CreateStore();
        var settings = DesktopSettings.Default with
        {
            QuietUntilUtc = DateTimeOffset.UtcNow.AddHours(1),
            QuietIndefinitely = true,
        };

        Assert.Throws<ArgumentException>(() => store.Save(settings));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private DesktopSettingsStore CreateStore() =>
        new(Path.Combine(_root, "settings.json"));
}
