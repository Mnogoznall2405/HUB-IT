using System.Globalization;
using System.Text.Json;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Inventory.Collectors;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Runtime;

/// <summary>
/// Reboot reminder parity with agent.py: same thresholds, work window, state
/// file and msg.exe delivery.
/// </summary>
public static class RebootReminder
{
    public const string Message =
        "Компьютер работает более 7 дней без перезагрузки. " +
        "Рекомендуется перезагрузить его для стабильной работы и установки обновлений.";

    public static void MaybeNotify(
        long uptimeSeconds,
        long bootTime,
        AgentConfig config,
        AgentPaths paths,
        AgentLog log)
    {
        if (!config.RebootReminderEnabled || uptimeSeconds < 0)
        {
            return;
        }

        if (uptimeSeconds < config.RebootReminderDays * 24L * 60 * 60)
        {
            return;
        }

        if (bootTime <= 0)
        {
            return;
        }

        var state = LoadState(paths.RebootReminderStateFile);
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var lastNotifiedAt = Text.ToLong(state.GetValueOrDefault("last_notified_at"), 0);
        var lastNotifiedBoot = Text.ToLong(state.GetValueOrDefault("last_notified_boot_time"), 0);
        var intervalSeconds = config.RebootReminderIntervalHours * 60L * 60;

        if (lastNotifiedBoot == bootTime && lastNotifiedAt > 0 && now - lastNotifiedAt < intervalSeconds)
        {
            return;
        }

        var local = DateTime.Now;
        if (config.RebootReminderWeekdaysOnly && local.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
        {
            log.Info("Reboot reminder skipped: weekend blocked by weekdays policy");
            return;
        }

        if (local.Hour < config.RebootReminderWorkStartHour || local.Hour >= config.RebootReminderWorkEndHour)
        {
            log.Info(
                $"Reboot reminder skipped: outside work window (now={local.Hour:00}:00, " +
                $"allowed={config.RebootReminderWorkStartHour:00}:00-{config.RebootReminderWorkEndHour:00}:00)");
            return;
        }

        var user = HostCollector.NormalizeLogin(HostCollector.ActiveConsoleUser());
        if (user.Length == 0 || user.Contains("system", StringComparison.OrdinalIgnoreCase)
            || user.Contains("service", StringComparison.OrdinalIgnoreCase))
        {
            log.Info("Reboot reminder skipped: active user session was not detected");
            return;
        }

        if (!Send(user, config.RebootReminderTimeoutSec, log))
        {
            log.Warn($"Failed to deliver reboot reminder to user={user}");
            return;
        }

        SaveState(
            paths.RebootReminderStateFile,
            new Dictionary<string, object?>
            {
                ["last_notified_at"] = now,
                ["last_notified_boot_time"] = bootTime,
                ["last_notified_user"] = user,
            },
            log);

        log.Info($"Reboot reminder sent to user={user} (uptime_hours={uptimeSeconds / 3600.0:0.0})");
    }

    private static bool Send(string user, int timeoutSeconds, AgentLog log)
    {
        try
        {
            var output = ProcessRunner.RunResult(
                "msg.exe",
                new[] { user, $"/TIME:{timeoutSeconds}", Message },
                timeoutSeconds: 30);

            if (output.ExitCode == 0)
            {
                return true;
            }

            var stderr = Text.Sanitize(output.Stderr);
            log.Warn(
                $"msg.exe returned non-zero code={output.ExitCode} user={user} " +
                $"stderr={(stderr.Length > 200 ? stderr[..200] : stderr)}");
            return false;
        }
        catch (Exception ex)
        {
            log.Warn($"msg.exe execution failed for user={user}: {ex.Message}");
            return false;
        }
    }

    private static Dictionary<string, object?> LoadState(string path)
    {
        try
        {
            if (!File.Exists(path))
            {
                return new Dictionary<string, object?>();
            }

            var node = JsonSerializer.Deserialize<Dictionary<string, object?>>(File.ReadAllText(path));
            return node ?? new Dictionary<string, object?>();
        }
        catch (Exception)
        {
            return new Dictionary<string, object?>();
        }
    }

    private static void SaveState(string path, Dictionary<string, object?> state, AgentLog log)
    {
        try
        {
            AtomicFile.WriteAllText(path, JsonSerializer.Serialize(state));
        }
        catch (Exception ex)
        {
            log.Warn($"Reboot reminder state write failed: {ex.Message}");
        }
    }
}
