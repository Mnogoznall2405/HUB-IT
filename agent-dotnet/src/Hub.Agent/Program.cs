using System.Collections;
using System.Runtime.InteropServices;
using System.Text;
using Hub.Agent.Core;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Inventory;
using Hub.Agent.Core.Runtime;
using Hub.Agent.Core.Scan;
using Hub.Agent.Core.Support;

namespace Hub.Agent;

internal static class Program
{
    private const uint AttachParentProcess = 0xFFFFFFFF;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(uint processId);

    private static async Task<int> Main(string[] args)
    {
        var workerIndex = Array.IndexOf(args, "--pdf-worker");
        if (workerIndex >= 0 && workerIndex + 1 < args.Length)
        {
            using var stdout = Console.OpenStandardOutput();
            using var writer = new StreamWriter(stdout, new UTF8Encoding(false)) { AutoFlush = true };
            return PdfWorker.Run(args[workerIndex + 1], writer);
        }

        var options = Options.Parse(args);
        if (options.ShowHelp)
        {
            WriteHelp();
            return 0;
        }

        if (options.ShowVersion)
        {
            Console.WriteLine(AgentVersion.Value);
            return 0;
        }

        AttachToParentConsole();

        var dataRoot = options.DataDirectory;
        var paths = AgentPaths.CreateDefault(dataRoot).EnsureWritable();
        var environment = Environment.GetEnvironmentVariables();
        var loadedFiles = EnvLoader.LoadInto(
            environment,
            paths,
            Environment.GetEnvironmentVariable("ITINV_AGENT_ENV_FILE"));

        // EnvLoader only fills the snapshot dictionary. Services (scan, fs_egress,
        // history, probe) read the process environment, so publish the loaded
        // values there as well before constructing them.
        foreach (DictionaryEntry entry in environment)
        {
            var key = Convert.ToString(entry.Key) ?? string.Empty;
            if (key.Length == 0)
            {
                continue;
            }

            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, Convert.ToString(entry.Value));
            }
        }

        foreach (var (key, value) in RegistryConfig.LoadDefaults())
        {
            if (!environment.Contains(key))
            {
                environment[key] = value;
            }

            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        var log = AgentLog.Create(paths.LogFile, mirrorToConsole: true);
        log.Info("=== Starting HUB-IT Agent (C#) ===");
        log.Info($"Data root: {paths.ProgramDataRoot} (agent root: {paths.AgentRoot})");
        log.Info($"Log file: {paths.LogFile}");
        if (paths.UsedTempFallback)
        {
            log.Warn("ProgramData is not writable, using TEMP fallback directory");
        }

        log.Info(loadedFiles.Count > 0
            ? $"Loaded .env sources for agent: {string.Join("; ", loadedFiles)}"
            : "No .env sources loaded automatically for agent");

        var config = AgentConfig.Load(ToReadOnly(environment), log.Warn);
        if (options.ForceSoftware)
        {
            config = config with { ForceSoftwareInventory = true };
        }

        if (options.DryRun)
        {
            config = config with { PersistState = false };
        }

        if (options.SkipProfiles)
        {
            config = config with { SkipProfileSizes = true };
        }
        log.Info($"Config: {config.Describe()} once={options.Once} check={options.Check} dry_run={options.DryRun}");

        using (log)
        {
            using var runner = new AgentRunner(config, paths, log, options.AllowSend);

            if (!options.DryRun && !options.AllowSend && !AgentPaths.IsInstalledBuild)
            {
                log.Error(
                    "Development build: network operations are disabled so the live agent/server cannot be touched. " +
                    "Pass --allow-send to run --check or --once explicitly.");
                return 2;
            }

            var cancellation = new CancellationTokenSource();
            if (options.RunSeconds > 0)
            {
                cancellation.CancelAfter(TimeSpan.FromSeconds(options.RunSeconds));
            }
            ConsoleCancelEventHandler cancelHandler = (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                try
                {
                    cancellation.Cancel();
                }
                catch (ObjectDisposedException)
                {
                    // shutting down
                }
            };
            Console.CancelKeyPress += cancelHandler;

            try
            {
                if (options.Check)
                {
                    var ok = await runner.CheckConfigurationAsync(cancellation.Token).ConfigureAwait(false);
                    return ok ? 0 : 1;
                }

                if (options.DryRun)
                {
                    var payload = runner.Collect(fullSnapshot: true, reportType: "full_snapshot");
                    var output = options.OutputPath ?? Path.Combine(paths.LogsDir, "inventory_dry_run.json");
                    AtomicFile.WriteAllText(output, payload.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
                    log.Info($"Dry run payload written to {output}");
                    Console.WriteLine(output);
                    return 0;
                }

                if (string.IsNullOrWhiteSpace(config.ApiKey))
                {
                    log.Error("Agent API key is not configured. Set ITINV_AGENT_API_KEY explicitly.");
                    return 1;
                }

                if (config.LowPriority && Native.LowerProcessPriority())
                {
                    log.Info("Agent runs at below-normal priority (ITINV_AGENT_LOW_PRIORITY=0 disables)");
                }

                if (options.Once)
                {
                    return await runner.RunOnceAsync(cancellation.Token).ConfigureAwait(false);
                }

                return await runner.RunLoopAsync(cancellation.Token).ConfigureAwait(false);
            }
            finally
            {
                Console.CancelKeyPress -= cancelHandler;
                cancellation.Dispose();
            }
        }
    }

    private static IReadOnlyDictionary<string, string?> ToReadOnly(IDictionary environment)
    {
        var result = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        foreach (DictionaryEntry entry in environment)
        {
            result[Convert.ToString(entry.Key) ?? string.Empty] = Convert.ToString(entry.Value);
        }

        return result;
    }

    private static void AttachToParentConsole()
    {
        try
        {
            if (!AttachConsole(AttachParentProcess))
            {
                return;
            }

            var output = Console.OpenStandardOutput();
            Console.SetOut(new StreamWriter(output, new UTF8Encoding(false)) { AutoFlush = true });
        }
        catch (Exception)
        {
            // no console available (scheduled task / service)
        }
    }

    private static void WriteHelp()
    {
        Console.WriteLine(
            "HUB-IT Agent (C#)\n" +
            "\n" +
            "  --once             collect and send one full snapshot, then exit\n" +
            "  --check            verify URL, DNS, /health and the API key\n" +
            "  --dry-run          collect a full snapshot and write JSON, do not send\n" +
            "  --out <path>       output path for --dry-run\n" +
            "  --force-software   ignore the software inventory cache for this run\n" +
            "  --data-dir <path>  use an isolated data root instead of ProgramData\n" +
            "  --allow-send       allow network calls from a development build\n" +
            "  --skip-profiles    skip the user profile size scan (fast dry-run)\n" +
            "  --run-seconds <n>  stop the agent loop after n seconds (smoke test)\n" +
            "  --version          print agent version\n" +
            "  --help             this text\n");
    }

    private sealed record Options(
        bool Once,
        bool Check,
        bool DryRun,
        bool ShowHelp,
        bool ShowVersion,
        bool ForceSoftware,
        bool AllowSend,
        bool SkipProfiles,
        int RunSeconds,
        string? OutputPath,
        string? DataDirectory)
    {
        public static Options Parse(string[] args)
        {
            var once = false;
            var check = false;
            var dryRun = false;
            var help = false;
            var version = false;
            var forceSoftware = false;
            var allowSend = false;
            var skipProfiles = false;
            var runSeconds = 0;
            string? output = null;
            string? dataDirectory = null;

            for (var index = 0; index < args.Length; index++)
            {
                switch (args[index])
                {
                    case "--once":
                        once = true;
                        break;
                    case "--check":
                        check = true;
                        break;
                    case "--dry-run":
                        dryRun = true;
                        break;
                    case "--force-software":
                        forceSoftware = true;
                        break;
                    case "--allow-send":
                        allowSend = true;
                        break;
                    case "--skip-profiles":
                        skipProfiles = true;
                        break;
                    case "--run-seconds":
                        if (index + 1 < args.Length && int.TryParse(args[index + 1], out var seconds))
                        {
                            runSeconds = Math.Max(1, seconds);
                            index++;
                        }

                        break;
                    case "--help":
                    case "-h":
                        help = true;
                        break;
                    case "--version":
                    case "-v":
                        version = true;
                        break;
                    case "--out":
                        if (index + 1 < args.Length)
                        {
                            output = args[++index];
                        }

                        break;
                    case "--data-dir":
                        if (index + 1 < args.Length)
                        {
                            dataDirectory = args[++index];
                        }

                        break;
                }
            }

            return new Options(once, check, dryRun, help, version, forceSoftware, allowSend, skipProfiles, runSeconds, output, dataDirectory);
        }
    }
}
