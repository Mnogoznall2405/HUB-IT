using System.IO;
using System.Threading;
using Hub.Desktop.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace Hub.Desktop.WebView;

public sealed class DesktopWebViewEnvironmentProvider
{
    private static readonly string WebView2ClientGuid = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";

    private readonly object _sync = new();
    private readonly string _userDataFolder;
    private Task<CoreWebView2Environment>? _environmentTask;

    public DesktopWebViewEnvironmentProvider(string userDataFolder)
    {
        if (string.IsNullOrWhiteSpace(userDataFolder))
        {
            throw new ArgumentException("A WebView2 user data folder is required.", nameof(userDataFolder));
        }

        _userDataFolder = userDataFolder;
    }

    public async Task<CoreWebView2Environment> GetAsync(
        CancellationToken cancellationToken = default)
    {
        Task<CoreWebView2Environment> environmentTask;
        lock (_sync)
        {
            _environmentTask ??= CreateAsync();
            environmentTask = _environmentTask;
        }

        try
        {
            return await environmentTask.WaitAsync(cancellationToken);
        }
        catch when (environmentTask.IsFaulted)
        {
            lock (_sync)
            {
                if (ReferenceEquals(_environmentTask, environmentTask))
                {
                    _environmentTask = null;
                }
            }

            throw;
        }
    }

    private async Task<CoreWebView2Environment> CreateAsync()
    {
        Directory.CreateDirectory(_userDataFolder);

        var browserExecutableFolder = TryFindInstalledBrowserFolder();
        if (browserExecutableFolder is not null)
        {
            DesktopLog.Info($"WebView2 runtime resolved to {browserExecutableFolder}");
            return await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: browserExecutableFolder,
                userDataFolder: _userDataFolder);
        }

        DesktopLog.Warning("Could not resolve WebView2 runtime folder; using default loader search");
        return await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: _userDataFolder);
    }

    private static string? TryFindInstalledBrowserFolder()
    {
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var baseKey = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            using var clientKey = baseKey.OpenSubKey($@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{WebView2ClientGuid}");
            if (clientKey is null)
            {
                continue;
            }

            var location = clientKey.GetValue("location") as string;
            var pv = clientKey.GetValue("pv") as string;
            if (string.IsNullOrWhiteSpace(location) || string.IsNullOrWhiteSpace(pv))
            {
                continue;
            }

            var candidate = Path.Combine(location, pv);
            if (File.Exists(Path.Combine(candidate, "msedgewebview2.exe")))
            {
                return candidate;
            }
        }

        return null;
    }
}
