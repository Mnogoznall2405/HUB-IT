using System.Diagnostics;

namespace Hub.Desktop.Security;

public enum ExternalUriLaunchStatus
{
    Opened,
    Blocked,
    Failed,
}

public sealed record ExternalUriLaunchResult(
    ExternalUriLaunchStatus Status,
    string Scheme,
    Exception? Error = null);

public sealed class ExternalUriLauncher
{
    private readonly NavigationPolicy _navigationPolicy;
    private readonly Func<ProcessStartInfo, bool> _start;

    public ExternalUriLauncher(NavigationPolicy navigationPolicy)
        : this(navigationPolicy, startInfo => Process.Start(startInfo) is not null)
    {
    }

    public ExternalUriLauncher(
        NavigationPolicy navigationPolicy,
        Func<ProcessStartInfo, bool> start)
    {
        _navigationPolicy = navigationPolicy
            ?? throw new ArgumentNullException(nameof(navigationPolicy));
        _start = start ?? throw new ArgumentNullException(nameof(start));
    }

    public ExternalUriLaunchResult Open(string? rawUri)
    {
        if (!_navigationPolicy.TryGetExternalUri(rawUri, out var uri))
        {
            return new ExternalUriLaunchResult(
                ExternalUriLaunchStatus.Blocked,
                NavigationPolicy.GetSchemeForLog(rawUri));
        }

        try
        {
            return new ExternalUriLaunchResult(
                _start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true })
                    ? ExternalUriLaunchStatus.Opened
                    : ExternalUriLaunchStatus.Failed,
                uri.Scheme);
        }
        catch (Exception exception)
        {
            return new ExternalUriLaunchResult(
                ExternalUriLaunchStatus.Failed,
                uri.Scheme,
                exception);
        }
    }
}
