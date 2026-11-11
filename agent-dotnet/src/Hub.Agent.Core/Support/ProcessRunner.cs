using System.Diagnostics;
using System.Text;

namespace Hub.Agent.Core.Support;

/// <summary>
/// Runs a short-lived console process and returns UTF-8 stdout.
/// Used only for the Microsoft Store package list until it is ported to the
/// WinRT PackageManager API; everything else uses native .NET/WMI.
/// </summary>
public static class ProcessRunner
{
    public static string Run(string fileName, IEnumerable<string> arguments, int timeoutSeconds = 90, string? standardInput = null)
        => RunResult(fileName, arguments, timeoutSeconds, standardInput).Stdout;

    public static (int ExitCode, string Stdout, string Stderr) RunResult(
        string fileName,
        IEnumerable<string> arguments,
        int timeoutSeconds = 90,
        string? standardInput = null)
    {
        try
        {
            var info = new ProcessStartInfo
            {
                FileName = fileName,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = standardInput is not null,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false),
            };

            foreach (var argument in arguments)
            {
                info.ArgumentList.Add(argument);
            }

            using var process = Process.Start(info);
            if (process is null)
            {
                return (-1, string.Empty, "process_start_failed");
            }

            if (standardInput is not null)
            {
                process.StandardInput.Write(standardInput);
                process.StandardInput.Close();
            }

            var outputTask = process.StandardOutput.ReadToEndAsync();
            var errorTask = process.StandardError.ReadToEndAsync();

            if (!process.WaitForExit(Math.Max(1, timeoutSeconds) * 1000))
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception)
                {
                    // ignore
                }

                return (-1, string.Empty, "timeout");
            }

            return (process.ExitCode, outputTask.GetAwaiter().GetResult(), errorTask.GetAwaiter().GetResult());
        }
        catch (Exception ex)
        {
            return (-1, string.Empty, ex.Message);
        }
    }

    public static string RunPowerShellJson(string command, int timeoutSeconds = 90)
    {
        var script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference='SilentlyContinue'; " + command;
        return Run(
            "powershell.exe",
            new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script },
            timeoutSeconds);
    }
}
