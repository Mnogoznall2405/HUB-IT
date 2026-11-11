using Hub.Desktop.Configuration;
using Hub.Desktop.Notifications;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopQuietModeTests
{
    [Fact]
    public void OneHourMuteUsesUtcAndExpiresWithoutChangingUnreadState()
    {
        var now = new DateTimeOffset(2026, 8, 12, 9, 0, 0, TimeSpan.Zero);
        var settings = DesktopQuietMode.MuteForOneHour(DesktopSettings.Default, now);

        Assert.True(DesktopQuietMode.IsMuted(settings, now.AddMinutes(59)));
        Assert.False(DesktopQuietMode.IsMuted(settings, now.AddHours(1)));
        Assert.Equal(now.AddHours(1), settings.QuietUntilUtc);
    }

    [Fact]
    public void WorkdayMuteStoresLocalEighteenHundredAsUtc()
    {
        var localNow = new DateTimeOffset(2026, 8, 12, 12, 30, 0, TimeSpan.FromHours(5));

        var settings = DesktopQuietMode.MuteUntilWorkdayEnd(DesktopSettings.Default, localNow);

        Assert.Equal(
            new DateTimeOffset(2026, 8, 12, 13, 0, 0, TimeSpan.Zero),
            settings.QuietUntilUtc);
    }

    [Fact]
    public void IndefiniteMuteSurvivesTimeUntilExplicitlyDisabled()
    {
        var settings = DesktopQuietMode.MuteIndefinitely(DesktopSettings.Default);

        Assert.True(DesktopQuietMode.IsMuted(settings, DateTimeOffset.MaxValue));
        Assert.False(DesktopQuietMode.IsMuted(
            DesktopQuietMode.Unmute(settings),
            DateTimeOffset.UtcNow));
    }
}
