using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

// Часть тестов использует реальный NativeThemeManager.Apply — в коллекции темы,
// чтобы не гоняться за статическим состоянием с другими классами.
[Collection("NativeTheme")]
public sealed class NativeSettingsViewModelTests
{
    // ---- Загрузка ----

    [Fact]
    public async Task LoadAppliesAppearanceNotificationAndSecurityState()
    {
        var api = new FakeHubApiClient
        {
            MySettings = new HubUserSettings
            {
                ThemeMode = "dark",
                FontFamily = "Inter",
                FontScale = 1.10,
            },
            NotificationPreferences = new HubNotificationPreferences
            {
                UserId = 7,
                Channels = new Dictionary<string, bool>
                {
                    ["mail"] = false,
                    ["tasks"] = true,
                    ["chat_direct"] = true,
                    ["chat_group"] = false,
                    ["chat_task"] = true,
                    ["chat_ai"] = false,
                    ["chat_sound"] = true,
                },
            },
            CurrentUser = new HubUser
            {
                Id = 7,
                IsTwoFactorEnabled = true,
                TwoFactorPolicy = "external_only",
                NetworkZone = "external",
            },
        };
        var model = new SettingsViewModel(api);

        await model.LoadAsync();

        Assert.Equal("dark", model.ThemeMode);
        Assert.True(model.IsThemeDark);
        Assert.Equal("Inter", model.FontFamily);
        Assert.True(model.IsFontInter);
        Assert.Equal("1,10", model.FontScaleText);

        Assert.False(model.NotifyMail);
        Assert.True(model.NotifyTasks);
        Assert.True(model.NotifyChat);          // есть активный подканал
        Assert.True(model.NotifyChatDirect);
        Assert.False(model.NotifyChatGroup);
        Assert.True(model.NotifyChatSound);
        Assert.True(model.HasNotificationPreferences);

        Assert.Equal("Включена", model.TwoFactorStatusText);
        Assert.Equal("Только для внешней сети", model.TwoFactorPolicyText);
        Assert.Equal("Внешняя сеть", model.NetworkZoneText);

        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.True(model.IsAppearanceSection);
    }

    [Fact]
    public async Task LoadKeepsWorkingSectionsWhenUserStatusFails()
    {
        var api = new FakeHubApiClient
        {
            MySettings = new HubUserSettings { ThemeMode = "light" },
            CurrentUserException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new SettingsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsThemeLight);
        Assert.False(model.HasBannerError);
        Assert.Equal("—", model.TwoFactorStatusText);
    }

    [Fact]
    public async Task UnknownServerValuesFallBackToDefaults()
    {
        var api = new FakeHubApiClient
        {
            MySettings = new HubUserSettings
            {
                ThemeMode = "solarized",
                FontFamily = "Comic Sans",
                FontScale = null,
            },
        };
        var model = new SettingsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsThemeSystem);
        Assert.True(model.IsFontAptos);
        Assert.Equal("1,00", model.FontScaleText);
    }

    // ---- Навигация по разделам ----

    [Fact]
    public void SectionSettersSwitchSelectedSection()
    {
        var model = new SettingsViewModel(new FakeHubApiClient());

        Assert.True(model.IsAppearanceSection);
        Assert.Equal(
            ["appearance", "notifications", "security"],
            model.Sections.Select(s => s.Key).ToArray());

        model.IsSecuritySection = true;
        Assert.Equal("security", model.SelectedSectionKey);
        Assert.False(model.IsAppearanceSection);

        // Неизвестный ключ сводится к внешнему виду.
        model.SelectedSectionKey = "unknown";
        Assert.True(model.IsAppearanceSection);
    }

    // ---- Внешний вид: валидация и сохранение ----

    [Fact]
    public async Task SaveAppearanceSendsExactPatchBody()
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api)
        {
            ThemeMode = "dark",
            FontFamily = "Roboto",
            FontScaleText = "1,15",
        };

        await ((NativeAsyncCommand)model.SaveAppearanceCommand).ExecuteAsync(null);

        var call = Assert.Single(api.MySettingsUpdates);
        Assert.Equal("dark", call.ThemeMode);
        Assert.Equal("Roboto", call.FontFamily);
        Assert.Equal(1.15, call.FontScale, 4);
        Assert.Equal("Сохранено", model.AppearanceStatusText);
        Assert.False(model.HasBannerError);
    }

    [Theory]
    [InlineData("0.80")]
    [InlineData("1.30")]
    [InlineData("abc")]
    public async Task SaveAppearanceRejectsOutOfRangeFontScale(string scale)
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api)
        {
            ThemeMode = "dark",
            FontFamily = "Aptos",
            FontScaleText = scale,
        };

        await ((NativeAsyncCommand)model.SaveAppearanceCommand).ExecuteAsync(null);

        Assert.Empty(api.MySettingsUpdates);
        Assert.True(model.HasBannerError);
        Assert.Contains("0,90", model.BannerErrorText);
        Assert.Null(model.AppearanceStatusText);
    }

    [Fact]
    public async Task SaveAppearanceRejectsUnknownTheme()
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api) { ThemeMode = "neon" };

        await ((NativeAsyncCommand)model.SaveAppearanceCommand).ExecuteAsync(null);

        Assert.Empty(api.MySettingsUpdates);
        Assert.True(model.HasBannerError);
        Assert.Contains("тем", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SaveAppearanceApiErrorGoesToBanner()
    {
        var api = new FakeHubApiClient
        {
            MySettingsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new SettingsViewModel(api);

        await ((NativeAsyncCommand)model.SaveAppearanceCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.Null(model.AppearanceStatusText);
    }

    // ---- Уведомления: мастер-переключатель и сохранение ----

    [Fact]
    public void ChatMasterTogglePropagatesToSubchannels()
    {
        var model = new SettingsViewModel(new FakeHubApiClient())
        {
            NotifyChatDirect = true,
            NotifyChatGroup = false,
            NotifyChatTask = false,
            NotifyChatAi = false,
            NotifyChatSound = false,
        };

        Assert.True(model.NotifyChat);       // есть активный подканал

        model.NotifyChat = false;
        Assert.False(model.NotifyChatDirect);
        Assert.False(model.NotifyChatGroup);
        Assert.False(model.NotifyChatTask);
        Assert.False(model.NotifyChatAi);
        Assert.False(model.NotifyChatSound); // звук не накрывается мастером

        model.NotifyChat = true;
        Assert.True(model.NotifyChatDirect);
        Assert.True(model.NotifyChatAi);
        Assert.False(model.NotifyChatSound);
    }

    [Fact]
    public async Task SaveNotificationsSendsAllChannelKeys()
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api)
        {
            NotifyMail = false,
            NotifyTasks = true,
            NotifyTaskEmail = false,
            NotifyAnnouncements = true,
            NotifyChatDirect = true,
            NotifyChatGroup = false,
            NotifyChatTask = true,
            NotifyChatAi = false,
            NotifyChatSound = false,
        };

        await ((NativeAsyncCommand)model.SaveNotificationsCommand).ExecuteAsync(null);

        var patch = Assert.Single(api.NotificationPreferencePatches);
        Assert.False(patch["mail"]);
        Assert.True(patch["tasks"]);
        Assert.False(patch["task_email"]);
        Assert.True(patch["announcements"]);
        Assert.True(patch["chat"]);          // сводный: хоть один подканал включён
        Assert.True(patch["chat_direct"]);
        Assert.False(patch["chat_group"]);
        Assert.True(patch["chat_task"]);
        Assert.False(patch["chat_ai"]);
        Assert.False(patch["chat_sound"]);
        Assert.Equal("Сохранено", model.NotificationsStatusText);
    }

    [Fact]
    public async Task SaveNotificationsApiErrorGoesToBanner()
    {
        var api = new FakeHubApiClient
        {
            NotificationPreferencesException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new SettingsViewModel(api);

        await ((NativeAsyncCommand)model.SaveNotificationsCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("прав", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.Null(model.NotificationsStatusText);
    }

    // ---- Смена пароля ----

    [Fact]
    public async Task PasswordChangeRequiresOldPassword()
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api);

        var ok = await model.SubmitPasswordChangeAsync(
            new HubPasswordChangeInput("", "newpassword", "newpassword"));

        Assert.False(ok);
        Assert.Equal(0, api.ChangePasswordCallCount);
        Assert.Contains("текущий пароль", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("12345")]   // короче минимума backend (6)
    [InlineData("")]
    public async Task PasswordChangeRejectsShortNewPassword(string newPassword)
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api);

        var ok = await model.SubmitPasswordChangeAsync(
            new HubPasswordChangeInput("old-secret", newPassword, newPassword));

        Assert.False(ok);
        Assert.Equal(0, api.ChangePasswordCallCount);
        Assert.Contains("6 символов", model.BannerErrorText);
    }

    [Fact]
    public async Task PasswordChangeRejectsMismatchedConfirmation()
    {
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api);

        var ok = await model.SubmitPasswordChangeAsync(
            new HubPasswordChangeInput("old-secret", "new-secret", "other-secret"));

        Assert.False(ok);
        Assert.Equal(0, api.ChangePasswordCallCount);
        Assert.Contains("не совпадает", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task PasswordChangeSuccessReturnsTrueAndSetsStatus()
    {
        var api = new FakeHubApiClient
        {
            ChangePasswordResult = new HubChangePasswordResult
            {
                Message = "Password changed successfully",
                ClosedSessions = 2,
            },
        };
        var model = new SettingsViewModel(api);

        var ok = await model.SubmitPasswordChangeAsync(
            new HubPasswordChangeInput("old-secret", "new-secret", "new-secret"));

        Assert.True(ok);
        Assert.Equal("old-secret", api.LastChangePasswordOld);
        Assert.Equal("new-secret", api.LastChangePasswordNew);
        Assert.NotNull(model.SecurityStatusText);
        Assert.Contains("сессии", model.SecurityStatusText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsPasswordBusy);
    }

    [Fact]
    public async Task PasswordChangeApiErrorGoesToBanner()
    {
        var api = new FakeHubApiClient
        {
            ChangePasswordException = new HubApiException(
                HubApiErrorKind.Http, "Incorrect old password", HttpStatusCode.BadRequest),
        };
        var model = new SettingsViewModel(api);

        var ok = await model.SubmitPasswordChangeAsync(
            new HubPasswordChangeInput("wrong", "new-secret", "new-secret"));

        Assert.False(ok);
        Assert.Equal("Incorrect old password", model.BannerErrorText);
        Assert.Null(model.SecurityStatusText);
        Assert.False(model.IsPasswordBusy);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsLoadedAndEditedState()
    {
        var api = new FakeHubApiClient
        {
            MySettings = new HubUserSettings
            {
                ThemeMode = "dark",
                FontFamily = "Inter",
                FontScale = 1.15,
            },
            CurrentUser = new HubUser { IsTwoFactorEnabled = true },
        };
        var model = new SettingsViewModel(api);
        await model.LoadAsync();
        model.IsSecuritySection = true;
        model.BannerErrorText = "ошибка";

        model.Reset();

        Assert.True(model.IsAppearanceSection);
        Assert.True(model.IsThemeSystem);
        Assert.True(model.IsFontAptos);
        Assert.Equal("1,00", model.FontScaleText);
        Assert.Null(model.AppearanceStatusText);
        Assert.Null(model.NotificationsStatusText);
        Assert.Null(model.SecurityStatusText);
        Assert.False(model.HasNotificationPreferences);
        Assert.True(model.NotifyMail);
        Assert.True(model.NotifyChat);
        Assert.Equal("—", model.TwoFactorStatusText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.False(model.IsPasswordBusy);
    }

    // ---- Тема нативного шелла ----

    [Fact]
    public async Task LoadAppliesSavedThemeModeToNativeShell()
    {
        var applied = new List<string>();
        var api = new FakeHubApiClient
        {
            MySettings = new HubUserSettings { ThemeMode = "light" },
        };
        var model = new SettingsViewModel(api, applied.Add);

        await model.LoadAsync();

        Assert.Equal("light", Assert.Single(applied));
    }

    [Fact]
    public async Task SaveAppearanceAppliesThemeToNativeShellImmediately()
    {
        var applied = new List<string>();
        var api = new FakeHubApiClient();
        var model = new SettingsViewModel(api, applied.Add)
        {
            ThemeMode = "light",
        };

        await ((NativeAsyncCommand)model.SaveAppearanceCommand).ExecuteAsync(null);

        Assert.Equal("light", Assert.Single(applied));
        Assert.Equal("Сохранено", model.AppearanceStatusText);
    }
}
