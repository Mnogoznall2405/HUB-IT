using System.Globalization;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Configuration;

/// <summary>
/// Runtime configuration. Names, defaults and clamping rules are identical to
/// the Python agent (agent.py / load_config) so the same .env and MSI
/// properties keep working without a migration step.
/// </summary>
public sealed record AgentConfig
{
    public const string DefaultServerUrl = "https://hubit.zsgp.ru/api/v1/inventory";
    public const int DefaultFullSnapshotInterval = 3600;
    public const int DefaultHeartbeatInterval = 600;
    public const int DefaultHeartbeatJitter = 120;
    public const int DefaultOutlookRefreshSec = 300;
    public const int DefaultRunCommandTimeoutSec = 20;
    public const int DefaultInventoryQueueBatch = 5;
    public const int DefaultInventoryQueueMaxItems = 1000;
    public const int DefaultInventoryQueueMaxAgeDays = 14;
    public const int DefaultInventoryQueueMaxTotalMb = 256;
    public const int DefaultRebootReminderDays = 7;
    public const int DefaultRebootReminderIntervalHours = 24;
    public const int DefaultRebootReminderTimeoutSec = 120;
    public const int DefaultRebootReminderWorkStartHour = 9;
    public const int DefaultRebootReminderWorkEndHour = 18;

    public string ServerUrl { get; init; } = DefaultServerUrl;
    public string ApiKey { get; init; } = string.Empty;
    public int FullSnapshotIntervalSec { get; init; } = DefaultFullSnapshotInterval;
    public int HeartbeatIntervalSec { get; init; } = DefaultHeartbeatInterval;
    public int HeartbeatJitterSec { get; init; } = DefaultHeartbeatJitter;
    public int OutlookRefreshSec { get; init; } = DefaultOutlookRefreshSec;
    public int RunCommandTimeoutSec { get; init; } = DefaultRunCommandTimeoutSec;
    public int InventoryQueueBatch { get; init; } = DefaultInventoryQueueBatch;
    public int InventoryQueueMaxItems { get; init; } = DefaultInventoryQueueMaxItems;
    public int InventoryQueueMaxAgeDays { get; init; } = DefaultInventoryQueueMaxAgeDays;
    public int InventoryQueueMaxTotalMb { get; init; } = DefaultInventoryQueueMaxTotalMb;
    public bool RebootReminderEnabled { get; init; } = true;
    public int RebootReminderDays { get; init; } = DefaultRebootReminderDays;
    public int RebootReminderIntervalHours { get; init; } = DefaultRebootReminderIntervalHours;
    public int RebootReminderTimeoutSec { get; init; } = DefaultRebootReminderTimeoutSec;
    public int RebootReminderWorkStartHour { get; init; } = DefaultRebootReminderWorkStartHour;
    public int RebootReminderWorkEndHour { get; init; } = DefaultRebootReminderWorkEndHour;
    public bool RebootReminderWeekdaysOnly { get; init; } = true;
    public string? CaBundle { get; init; }
    public int TimeoutSeconds { get; init; } = 10;

    public bool UsbInventoryEnabled { get; init; } = true;
    public bool SecurityPostureEnabled { get; init; } = true;
    public bool SoftwareStoreAppsEnabled { get; init; } = true;
    public bool LowPriority { get; init; } = true;
    public int SoftwareInventoryIntervalHours { get; init; } = 168;
    public bool ForceSoftwareInventory { get; init; }

    /// <summary>False for --dry-run: collect everything but never touch runtime state files.</summary>
    public bool PersistState { get; init; } = true;

    /// <summary>Skip the (potentially slow) user profile size scan.</summary>
    public bool SkipProfileSizes { get; init; }

    public static AgentConfig Load(IReadOnlyDictionary<string, string?> env, Action<string>? warn = null)
    {
        var serverUrl = Text.Sanitize(Get(env, "ITINV_AGENT_SERVER_URL", DefaultServerUrl));
        if (serverUrl.Length == 0)
        {
            serverUrl = DefaultServerUrl;
        }

        var apiKey = Text.Sanitize(Get(env, "ITINV_AGENT_API_KEY", string.Empty));

        var fullSnapshot = Text.ToInt(Get(env, "ITINV_AGENT_INTERVAL_SEC", null), DefaultFullSnapshotInterval);
        var heartbeat = Text.ToInt(Get(env, "ITINV_AGENT_HEARTBEAT_SEC", null), DefaultHeartbeatInterval);
        var jitter = Text.ToInt(Get(env, "ITINV_AGENT_HEARTBEAT_JITTER_SEC", null), DefaultHeartbeatJitter);
        var outlookRefresh = Text.ToInt(Get(env, "ITINV_OUTLOOK_REFRESH_SEC", null), DefaultOutlookRefreshSec);
        var runCommandTimeout = Text.ToInt(Get(env, "ITINV_RUN_CMD_TIMEOUT_SEC", null), DefaultRunCommandTimeoutSec);
        var queueBatch = Text.ToInt(Get(env, "ITINV_INVENTORY_QUEUE_BATCH", null), DefaultInventoryQueueBatch);
        var queueMaxItems = Text.ToInt(Get(env, "ITINV_INVENTORY_QUEUE_MAX_ITEMS", null), DefaultInventoryQueueMaxItems);
        var queueMaxAge = Text.ToInt(Get(env, "ITINV_INVENTORY_QUEUE_MAX_AGE_DAYS", null), DefaultInventoryQueueMaxAgeDays);
        var queueMaxMb = Text.ToInt(Get(env, "ITINV_INVENTORY_QUEUE_MAX_TOTAL_MB", null), DefaultInventoryQueueMaxTotalMb);

        var reminderWorkStart = Text.ToInt(Get(env, "ITINV_REBOOT_REMINDER_WORK_START_HOUR", null), DefaultRebootReminderWorkStartHour);
        var reminderWorkEnd = Text.ToInt(Get(env, "ITINV_REBOOT_REMINDER_WORK_END_HOUR", null), DefaultRebootReminderWorkEndHour);

        fullSnapshot = Math.Max(300, fullSnapshot);
        heartbeat = Math.Max(60, Math.Min(heartbeat, fullSnapshot));
        jitter = Math.Max(0, Math.Min(jitter, 300));
        outlookRefresh = Math.Max(60, Math.Min(outlookRefresh, 3600));
        runCommandTimeout = Math.Max(5, Math.Min(runCommandTimeout, 300));
        queueBatch = Math.Max(1, Math.Min(queueBatch, 200));
        queueMaxItems = Math.Max(50, Math.Min(queueMaxItems, 10000));
        queueMaxAge = Math.Max(1, Math.Min(queueMaxAge, 90));
        queueMaxMb = Math.Max(32, Math.Min(queueMaxMb, 2048));
        reminderWorkStart = Math.Max(0, Math.Min(reminderWorkStart, 23));
        reminderWorkEnd = Math.Max(1, Math.Min(reminderWorkEnd, 24));

        if (reminderWorkStart >= reminderWorkEnd)
        {
            warn?.Invoke(
                $"Invalid reboot reminder work window {reminderWorkStart}-{reminderWorkEnd}. " +
                $"Fallback to default {DefaultRebootReminderWorkStartHour}-{DefaultRebootReminderWorkEndHour}");
            reminderWorkStart = DefaultRebootReminderWorkStartHour;
            reminderWorkEnd = DefaultRebootReminderWorkEndHour;
        }

        var caBundle = Text.Sanitize(Get(env, "ITINV_AGENT_CA_BUNDLE", string.Empty));
        if (caBundle.Length > 0)
        {
            var expanded = Environment.ExpandEnvironmentVariables(caBundle);
            if (!File.Exists(expanded))
            {
                warn?.Invoke($"Configured ITINV_AGENT_CA_BUNDLE path does not exist: {expanded}. Falling back to default TLS verification.");
                caBundle = string.Empty;
            }
            else
            {
                caBundle = expanded;
            }
        }

        return new AgentConfig
        {
            ServerUrl = serverUrl,
            ApiKey = apiKey,
            FullSnapshotIntervalSec = fullSnapshot,
            HeartbeatIntervalSec = heartbeat,
            HeartbeatJitterSec = jitter,
            OutlookRefreshSec = outlookRefresh,
            RunCommandTimeoutSec = runCommandTimeout,
            InventoryQueueBatch = queueBatch,
            InventoryQueueMaxItems = queueMaxItems,
            InventoryQueueMaxAgeDays = queueMaxAge,
            InventoryQueueMaxTotalMb = queueMaxMb,
            RebootReminderEnabled = Text.Truthy(Get(env, "ITINV_REBOOT_REMINDER_ENABLED", "1"), true),
            RebootReminderDays = Math.Max(1, Math.Min(
                Text.ToInt(Get(env, "ITINV_REBOOT_REMINDER_DAYS", null), DefaultRebootReminderDays), 365)),
            RebootReminderIntervalHours = Math.Max(1, Math.Min(
                Text.ToInt(Get(env, "ITINV_REBOOT_REMINDER_INTERVAL_HOURS", null), DefaultRebootReminderIntervalHours), 24 * 30)),
            RebootReminderTimeoutSec = Math.Max(30, Math.Min(
                Text.ToInt(Get(env, "ITINV_REBOOT_REMINDER_TIMEOUT_SEC", null), DefaultRebootReminderTimeoutSec), 600)),
            RebootReminderWorkStartHour = reminderWorkStart,
            RebootReminderWorkEndHour = reminderWorkEnd,
            RebootReminderWeekdaysOnly = Text.Truthy(Get(env, "ITINV_REBOOT_REMINDER_WEEKDAYS_ONLY", "1"), true),
            CaBundle = caBundle.Length == 0 ? null : caBundle,
            UsbInventoryEnabled = Text.Truthy(Get(env, "ITINV_USB_INVENTORY_ENABLED", "1"), true),
            SecurityPostureEnabled = Text.Truthy(Get(env, "ITINV_SECURITY_POSTURE_ENABLED", "1"), true),
            SoftwareStoreAppsEnabled = Text.Truthy(Get(env, "ITINV_SOFTWARE_STORE_APPS_ENABLED", "1"), true),
            LowPriority = Text.Truthy(Get(env, "ITINV_AGENT_LOW_PRIORITY", "1"), true),
            SoftwareInventoryIntervalHours = Math.Max(1,
                Text.ToInt(Get(env, "ITINV_SOFTWARE_INVENTORY_INTERVAL_HOURS", null), 168)),
        };
    }

    private static string? Get(IReadOnlyDictionary<string, string?> env, string key, string? fallback)
        => env.TryGetValue(key, out var value) ? value : fallback;

    public string Describe() => string.Create(
        CultureInfo.InvariantCulture,
        $"server={ServerUrl} heartbeat={HeartbeatIntervalSec}s full_snapshot={FullSnapshotIntervalSec}s " +
        $"jitter={HeartbeatJitterSec}s queue_batch={InventoryQueueBatch} queue_max_items={InventoryQueueMaxItems} " +
        $"queue_max_age_days={InventoryQueueMaxAgeDays} queue_max_total_mb={InventoryQueueMaxTotalMb}");
}
