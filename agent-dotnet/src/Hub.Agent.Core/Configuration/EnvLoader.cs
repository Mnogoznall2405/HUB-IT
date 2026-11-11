using System.Collections;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Configuration;

/// <summary>
/// Loads runtime settings from .env files exactly like the Python agent:
/// process environment wins, then the first .env file that defines a key wins.
/// </summary>
public static class EnvLoader
{
    public static IReadOnlyList<string> LoadInto(IDictionary environment, AgentPaths paths, string? explicitPath = null)
    {
        var loaded = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var candidate in Candidates(paths, explicitPath))
        {
            string resolved;
            try
            {
                resolved = Path.GetFullPath(candidate);
            }
            catch (Exception)
            {
                resolved = candidate;
            }

            if (!seen.Add(resolved))
            {
                continue;
            }

            var count = LoadFile(environment, resolved);
            if (count > 0)
            {
                loaded.Add($"{resolved} ({count})");
            }
        }

        return loaded;
    }

    public static IEnumerable<string> Candidates(AgentPaths paths, string? explicitPath = null)
    {
        if (!string.IsNullOrWhiteSpace(explicitPath))
        {
            yield return explicitPath;
        }

        yield return Path.Combine(paths.AgentRoot, ".env");
        yield return Path.Combine(paths.LegacyAgentRoot, ".env");

        var exeDir = AppContext.BaseDirectory;
        yield return Path.Combine(exeDir, ".env");

        // Installed agents must not depend on the process working directory:
        // only development runs may pick up a repo .env from the current folder.
        if (!AgentPaths.IsInstalledBuild)
        {
            yield return Path.Combine(Environment.CurrentDirectory, ".env");
        }

        yield return Path.Combine(paths.ProgramDataRoot, ".env");
        yield return Path.Combine(paths.LegacyRoot, ".env");
    }

    public static int LoadFile(IDictionary environment, string path)
    {
        if (!File.Exists(path))
        {
            return 0;
        }

        var text = Support.AtomicFile.ReadAllTextWithFallback(path);
        if (text.Length == 0)
        {
            return 0;
        }

        var loaded = 0;
        foreach (var rawLine in text.Split('\n'))
        {
            var row = rawLine.Trim().TrimEnd('\r');
            if (row.Length == 0 || row.StartsWith('#') || row.StartsWith(';'))
            {
                continue;
            }

            if (row.StartsWith("export ", StringComparison.OrdinalIgnoreCase))
            {
                row = row[7..].Trim();
            }

            var separator = row.IndexOf('=');
            if (separator <= 0)
            {
                continue;
            }

            var key = row[..separator].Trim();
            if (key.Length == 0 || environment.Contains(key))
            {
                continue;
            }

            environment[key] = StripQuotes(row[(separator + 1)..]);
            loaded++;
        }

        return loaded;
    }

    public static string StripQuotes(string? raw)
    {
        var value = (raw ?? string.Empty).Trim();
        if (value.Length >= 2)
        {
            var first = value[0];
            var last = value[^1];
            if ((first == '"' && last == '"') || (first == '\'' && last == '\''))
            {
                return value[1..^1];
            }
        }

        return value;
    }
}
