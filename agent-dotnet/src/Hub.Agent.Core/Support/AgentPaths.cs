namespace Hub.Agent.Core.Support;

/// <summary>
/// Canonical runtime layout of the Windows agent. Mirrors the paths used by the
/// Python agent so an in-place upgrade keeps the same spool and status files.
/// </summary>
public sealed class AgentPaths
{
    public AgentPaths(string? programDataOverride = null, string productFolder = "HUB-IT")
    {
        var programData = programDataOverride;
        if (string.IsNullOrWhiteSpace(programData))
        {
            programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        }

        ProgramDataRoot = Path.Combine(programData, productFolder);
        AgentRoot = Path.Combine(ProgramDataRoot, "Agent");
        LogsDir = Path.Combine(AgentRoot, "Logs");
        SpoolDir = Path.Combine(AgentRoot, "Spool");
        QueueRoot = Path.Combine(SpoolDir, "inventory");
        QueuePendingDir = Path.Combine(QueueRoot, "pending");
        QueueDeadDir = Path.Combine(QueueRoot, "dead_letter");
        StatusFile = Path.Combine(LogsDir, "agent_status.json");
        RebootReminderStateFile = Path.Combine(LogsDir, "reboot_reminder_state.json");
        OutboundStateFile = Path.Combine(LogsDir, "outlook_scan_state.json");
        ProfileSizesCacheFile = Path.Combine(LogsDir, "user_profile_sizes_cache.json");
        SoftwareInventoryStateFile = Path.Combine(LogsDir, "software_inventory_state.json");
        LogFile = Path.Combine(LogsDir, "itinvent_agent.log");

        LegacyRoot = Path.Combine(programData, "IT-Invent");
        LegacyAgentRoot = Path.Combine(LegacyRoot, "Agent");
        ScanAgentRoot = Path.Combine(ProgramDataRoot, "ScanAgent");
        ScanOutboxPendingDir = Path.Combine(ScanAgentRoot, "outbox", "pending");
        ScanOutboxDeadDir = Path.Combine(ScanAgentRoot, "outbox", "dead_letter");
        ScanAgentStatusFile = Path.Combine(ScanAgentRoot, "scan_agent_status.json");
        FsEgressSpoolDir = Path.Combine(SpoolDir, "fs_egress");

        TempDir = Environment.GetEnvironmentVariable("TEMP") ?? Path.GetTempPath();
    }

    public string ProgramDataRoot { get; }
    public string AgentRoot { get; }
    public string LogsDir { get; }
    public string SpoolDir { get; }
    public string QueueRoot { get; }
    public string QueuePendingDir { get; }
    public string QueueDeadDir { get; }
    public string StatusFile { get; }
    public string RebootReminderStateFile { get; }
    public string OutboundStateFile { get; }
    public string ProfileSizesCacheFile { get; }
    public string SoftwareInventoryStateFile { get; }
    public string LogFile { get; }
    public string LegacyRoot { get; }
    public string LegacyAgentRoot { get; }
    public string ScanAgentRoot { get; }
    public string ScanOutboxPendingDir { get; }
    public string ScanOutboxDeadDir { get; }
    public string ScanAgentStatusFile { get; }
    public string FsEgressSpoolDir { get; }
    public string TempDir { get; }

    /// <summary>Creates the runtime directories, falling back to TEMP if ProgramData is not writable.</summary>
    public AgentPaths EnsureWritable()
    {
        if (TryEnsureDirectories(this))
        {
            return this;
        }

        var fallback = new AgentPaths(Path.Combine(TempDir, "HUB-IT-Agent")) { UsedTempFallback = true };
        TryEnsureDirectories(fallback);
        return fallback;
    }

    private static bool TryEnsureDirectories(AgentPaths paths)
    {
        try
        {
            Directory.CreateDirectory(paths.LogsDir);
            Directory.CreateDirectory(paths.QueuePendingDir);
            Directory.CreateDirectory(paths.QueueDeadDir);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    public bool UsedTempFallback { get; private init; }

    public static bool IsInstalledBuild
    {
        get
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            var exeDirectory = AppContext.BaseDirectory;
            return !string.IsNullOrWhiteSpace(programFiles)
                   && exeDirectory.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase)
                   && exeDirectory.Contains("HUB-IT", StringComparison.OrdinalIgnoreCase);
        }
    }

    /// <summary>
    /// Runtime paths for the current build. Installed builds under
    /// "Program Files\HUB-IT\Agent (C#)" use an isolated ProgramData folder so a
    /// pilot can run side by side with the Python agent without sharing spool,
    /// logs or state. The production cutover (folder "Agent") uses ProgramData\HUB-IT.
    /// </summary>
    public static AgentPaths CreateDefault(string? dataDirectory = null)
    {
        if (!string.IsNullOrWhiteSpace(dataDirectory))
        {
            return new AgentPaths(dataDirectory);
        }

        var explicitRoot = Environment.GetEnvironmentVariable("ITINV_AGENT_DATA_ROOT");
        if (!string.IsNullOrWhiteSpace(explicitRoot))
        {
            return new AgentPaths(Environment.ExpandEnvironmentVariables(explicitRoot.Trim()));
        }

        if (IsInstalledBuild)
        {
            var product = AppContext.BaseDirectory.Contains("(C#)", StringComparison.OrdinalIgnoreCase)
                ? "HUB-IT-CSharp"
                : "HUB-IT";
            return new AgentPaths(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), product);
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return new AgentPaths(string.IsNullOrWhiteSpace(localAppData)
            ? Path.Combine(Path.GetTempPath(), "HUB-IT-dev")
            : localAppData);
    }

    /// <summary>
    /// Data root for runtime files. The installed agent (under Program Files)
    /// uses ProgramData, exactly like the Python agent. A development build runs
    /// under %LOCALAPPDATA%\HUB-IT so it can never write into the live agent's
    /// spool, logs or state files. ITINV_AGENT_DATA_ROOT overrides both.
    /// </summary>
    public static string ResolveDefaultDataRoot()
    {
        var explicitRoot = Environment.GetEnvironmentVariable("ITINV_AGENT_DATA_ROOT");
        if (!string.IsNullOrWhiteSpace(explicitRoot))
        {
            return Environment.ExpandEnvironmentVariables(explicitRoot.Trim());
        }

        if (IsInstalledBuild)
        {
            return Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        return string.IsNullOrWhiteSpace(localAppData)
            ? Path.Combine(Path.GetTempPath(), "HUB-IT-dev")
            : localAppData;
    }
}
