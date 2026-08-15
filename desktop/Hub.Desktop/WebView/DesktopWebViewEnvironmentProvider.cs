using System.IO;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.WebView;

public sealed class DesktopWebViewEnvironmentProvider
{
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
        return await CoreWebView2Environment.CreateAsync(
            browserExecutableFolder: null,
            userDataFolder: _userDataFolder);
    }
}
