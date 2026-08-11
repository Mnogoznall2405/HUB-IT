using System.ComponentModel;
using System.Diagnostics;

namespace Hub.Desktop.UpdateRunner;

internal interface IUpdateRunnerPlatform
{
    Task WaitForParentExitAsync(int processId);

    int RunElevatedSetup(string setupPath);

    void StartApplication(string applicationPath);
}

internal sealed class SystemUpdateRunnerPlatform(TimeSpan parentExitTimeout)
    : IUpdateRunnerPlatform
{
    public async Task WaitForParentExitAsync(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            using var timeout = new CancellationTokenSource(parentExitTimeout);
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (ArgumentException)
        {
            // The parent already exited.
        }
    }

    public int RunElevatedSetup(string setupPath)
    {
        using var process = Process.Start(new ProcessStartInfo(setupPath)
        {
            Arguments = "/quiet /norestart",
            UseShellExecute = true,
            Verb = "runas",
            WorkingDirectory = Path.GetDirectoryName(setupPath),
        }) ?? throw new InvalidOperationException("Update setup did not start.");
        process.WaitForExit();
        return process.ExitCode;
    }

    public void StartApplication(string applicationPath)
    {
        if (!File.Exists(applicationPath))
        {
            throw new FileNotFoundException(
                "Application executable is unavailable after update.",
                applicationPath);
        }

        _ = Process.Start(new ProcessStartInfo(applicationPath)
        {
            UseShellExecute = true,
            WorkingDirectory = Path.GetDirectoryName(applicationPath),
        }) ?? throw new InvalidOperationException("Application did not restart after update.");
    }
}

internal static class UpdateRunnerWorkflow
{
    private const int UacCancelledError = 1223;

    public static async Task<int> ExecuteAsync(
        int parentProcessId,
        string setupPath,
        string applicationPath,
        IUpdateRunnerPlatform platform,
        Action<string> writeLog)
    {
        var result = 1;
        try
        {
            await platform.WaitForParentExitAsync(parentProcessId);
            var setupExitCode = platform.RunElevatedSetup(setupPath);
            writeLog($"Update setup completed; exit_code={setupExitCode}");
            result = IsSuccessExitCode(setupExitCode) ? 0 : 6;
        }
        catch (Win32Exception exception) when (exception.NativeErrorCode == UacCancelledError)
        {
            writeLog("Update elevation was cancelled");
            result = 7;
        }
        catch (Exception exception)
        {
            writeLog($"Update runner failed; exception={exception.GetType().Name}");
        }

        try
        {
            platform.StartApplication(applicationPath);
        }
        catch (Exception exception)
        {
            writeLog($"Application restart failed; exception={exception.GetType().Name}");
            return 1;
        }

        return result;
    }

    private static bool IsSuccessExitCode(int exitCode) =>
        exitCode is 0 or 1641 or 3010;
}
