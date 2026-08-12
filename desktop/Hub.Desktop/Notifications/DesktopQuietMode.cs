using Hub.Desktop.Configuration;

namespace Hub.Desktop.Notifications;

public static class DesktopQuietMode
{
    private const int WorkdayEndHour = 18;

    public static bool IsMuted(DesktopSettings settings, DateTimeOffset utcNow)
    {
        ArgumentNullException.ThrowIfNull(settings);
        return settings.QuietIndefinitely
            || settings.QuietUntilUtc is { } untilUtc && untilUtc > utcNow.ToUniversalTime();
    }

    public static DesktopSettings MuteForOneHour(
        DesktopSettings settings,
        DateTimeOffset utcNow) =>
        settings with
        {
            QuietUntilUtc = utcNow.ToUniversalTime().AddHours(1),
            QuietIndefinitely = false,
        };

    public static DesktopSettings MuteUntilWorkdayEnd(
        DesktopSettings settings,
        DateTimeOffset localNow)
    {
        var localEnd = new DateTimeOffset(
            localNow.Year,
            localNow.Month,
            localNow.Day,
            WorkdayEndHour,
            0,
            0,
            localNow.Offset);
        if (localEnd <= localNow)
        {
            localEnd = localEnd.AddDays(1);
        }

        return settings with
        {
            QuietUntilUtc = localEnd.ToUniversalTime(),
            QuietIndefinitely = false,
        };
    }

    public static DesktopSettings MuteIndefinitely(DesktopSettings settings) =>
        settings with
        {
            QuietUntilUtc = null,
            QuietIndefinitely = true,
        };

    public static DesktopSettings Unmute(DesktopSettings settings) =>
        settings with
        {
            QuietUntilUtc = null,
            QuietIndefinitely = false,
        };

    public static string GetTrayLabel(DesktopSettings settings, DateTimeOffset localNow)
    {
        if (settings.QuietIndefinitely)
        {
            return "Не беспокоить — включено";
        }

        if (settings.QuietUntilUtc is { } untilUtc && untilUtc > localNow.ToUniversalTime())
        {
            return $"Не беспокоить — до {untilUtc.ToLocalTime():HH:mm}";
        }

        return "Не беспокоить";
    }
}
