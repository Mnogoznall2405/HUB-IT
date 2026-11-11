using System.Collections;
using System.IO;
using Hub.Agent.Core;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.BrowserProbe;

internal static class Program
{
    private static async Task<int> Main(string[] args)
    {
        var output = OutputDirectory(args);
        Directory.CreateDirectory(output);
        var log = AgentLog.Create(Path.Combine(output, "Logs", "browser_probe.log"), mirrorToConsole: false);

        using (log)
        {
            var lockPath = Path.Combine(output, "probe.lock");
            FileStream? lockFile = null;
            try
            {
                lockFile = new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            }
            catch (IOException)
            {
                log.Error("Browser probe cannot lock the queue. Check for another instance using this folder.");
                return 1;
            }

            try
            {
                LoadEnv();
                if (!Text.Truthy(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_ENABLED"), true))
                {
                    log.Info("Browser probe disabled by ITINV_BROWSER_PROBE_ENABLED");
                    return 0;
                }

                var syncNow = args.Any(argument => argument == "--sync-now");
                var once = args.Any(argument => argument == "--once");
                var allowSend = args.Any(argument => argument == "--allow-send");
                var runner = new ProbeRunner(log, output, allowSend);

                using var cancellation = new CancellationTokenSource();
                Console.CancelKeyPress += (_, eventArgs) =>
                {
                    eventArgs.Cancel = true;
                    cancellation.Cancel();
                };

                return syncNow
                    ? await runner.SyncOnlyAsync(cancellation.Token).ConfigureAwait(false)
                    : await runner.RunAsync(cancellation.Token, once).ConfigureAwait(false);
            }
            finally
            {
                lockFile?.Dispose();
            }
        }
    }

    private static string OutputDirectory(string[] args)
    {
        for (var index = 0; index < args.Length; index++)
        {
            if (args[index] == "--output" && index + 1 < args.Length)
            {
                return Path.GetFullPath(args[index + 1]);
            }
        }

        var env = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_OUTPUT"));
        if (env.Length > 0)
        {
            return Path.GetFullPath(env);
        }

        if (!AgentPaths.IsInstalledBuild)
        {
            return Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "HUB-IT",
                "BrowserProbe");
        }

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var product = AppContext.BaseDirectory.Contains("(C#)", StringComparison.OrdinalIgnoreCase)
            ? "HUB-IT-CSharp"
            : "HUB-IT";
        return Path.Combine(programData, product, "BrowserProbe");
    }

    private static void LoadEnv()
    {
        foreach (var (key, value) in RegistryConfig.LoadDefaults())
        {
            if (Environment.GetEnvironmentVariable(key) is null)
            {
                Environment.SetEnvironmentVariable(key, value);
            }
        }

        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        var path = Path.Combine(programData, "HUB-IT", "Agent", ".env");
        if (!File.Exists(path))
        {
            return;
        }

        var environment = Environment.GetEnvironmentVariables();
        var count = EnvLoaderProxy.Load(environment, path);
        if (count > 0)
        {
            foreach (DictionaryEntry entry in environment)
            {
                Environment.SetEnvironmentVariable(
                    Convert.ToString(entry.Key) ?? string.Empty,
                    Convert.ToString(entry.Value));
            }
        }
    }
}

internal static class EnvLoaderProxy
{
    public static int Load(IDictionary environment, string path)
        => Hub.Agent.Core.Configuration.EnvLoader.LoadFile(environment, path);
}
