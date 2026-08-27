using Hub.Desktop.Interop;
using Hub.Desktop.Shell;
using Hub.Desktop.Workspace;

namespace Hub.Desktop.Lifecycle;

public enum DesktopSecondaryWindowOpenResult
{
    Opened,
    ActivatedExisting,
    Unavailable,
}

public enum DesktopMailComposeWindowOpenResult
{
    Opened,
    ActivatedExisting,
    Busy,
    Unavailable,
}

public sealed class DesktopWindowManager
{
    private readonly Uri _trustedBaseUri;
    private readonly Dictionary<IDesktopHubWindow, DesktopShellStatus> _shellStatuses = [];
    private readonly Dictionary<IDesktopHubWindow, IReadOnlyList<DesktopQuickRoute>> _quickRoutes = [];
    private Func<string?, IDesktopHubWindow>? _secondaryFactory;
    private Func<string, IDesktopHubWindow>? _mailComposeFactory;
    private IDesktopHubWindow? _primary;
    private IDesktopHubWindow? _secondary;
    private IDesktopHubWindow? _mailCompose;
    private string? _mailComposeRoute;
    private IDesktopHubWindow? _lastActive;
    private DesktopSystemLifecycleBroadcaster? _lifecycle;

    public DesktopWindowManager(Uri trustedBaseUri)
    {
        _trustedBaseUri = trustedBaseUri
            ?? throw new ArgumentNullException(nameof(trustedBaseUri));
    }

    public event EventHandler? WindowAvailabilityChanged;

    public event EventHandler<DesktopShellStatusChangedEventArgs>? ShellStatusChanged;

    public event EventHandler<DesktopQuickRoutesChangedEventArgs>? QuickRoutesChanged;

    public event EventHandler? MailComposeSent;

    public bool CanOpenSecondary => _primary is not null && _secondary is null;

    public int WindowCount => (_primary is null ? 0 : 1) + (_secondary is null ? 0 : 1) + (_mailCompose is null ? 0 : 1);

    public void AttachLifecycleBroadcaster(DesktopSystemLifecycleBroadcaster broadcaster)
    {
        _lifecycle = broadcaster ?? throw new ArgumentNullException(nameof(broadcaster));
    }

    public void PublishSystemLifecycle(DesktopSystemLifecycleMessage message)
    {
        _lifecycle?.Publish(message);
    }

    public void NotifyBridgeReady(IDesktopHubWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (!IsRegistered(window))
        {
            return;
        }

        _lifecycle?.DeliverPendingTo(window);
    }

    public void ForEachWindow(Action<IDesktopHubWindow> action)
    {
        ArgumentNullException.ThrowIfNull(action);
        if (_primary is not null)
        {
            action(_primary);
        }

        if (_secondary is not null)
        {
            action(_secondary);
        }

        if (_mailCompose is not null)
        {
            action(_mailCompose);
        }
    }

    public void RegisterPrimary(IDesktopHubWindow window)
    {
        ArgumentNullException.ThrowIfNull(window);
        if (_primary is not null)
        {
            throw new InvalidOperationException("The primary HUB window is already registered.");
        }

        _primary = window;
        _lastActive = window;
        Subscribe(window);
        WindowAvailabilityChanged?.Invoke(this, EventArgs.Empty);
    }

    public void ConfigureSecondaryFactory(Func<string?, IDesktopHubWindow> factory)
    {
        _secondaryFactory = factory ?? throw new ArgumentNullException(nameof(factory));
    }

    public void ConfigureMailComposeFactory(Func<string, IDesktopHubWindow> factory)
    {
        _mailComposeFactory = factory ?? throw new ArgumentNullException(nameof(factory));
    }

    public DesktopMailComposeWindowOpenResult OpenMailComposeWindow(string route)
    {
        if (_primary is null || _mailComposeFactory is null || !DesktopBridgeProtocol.IsValidMailComposeRoute(route))
        {
            return DesktopMailComposeWindowOpenResult.Unavailable;
        }
        if (_mailCompose is not null)
        {
            if (string.Equals(_mailComposeRoute, route, StringComparison.Ordinal))
            {
                _mailCompose.ShowAndActivate();
                return DesktopMailComposeWindowOpenResult.ActivatedExisting;
            }
            return DesktopMailComposeWindowOpenResult.Busy;
        }
        _mailCompose = _mailComposeFactory(route);
        _mailComposeRoute = route;
        Subscribe(_mailCompose);
        WindowAvailabilityChanged?.Invoke(this, EventArgs.Empty);
        _mailCompose.ShowAndActivate();
        return DesktopMailComposeWindowOpenResult.Opened;
    }

    public void NotifyMailComposeSent()
    {
        MailComposeSent?.Invoke(this, EventArgs.Empty);
    }

    public DesktopSecondaryWindowOpenResult OpenSecondaryFrom(IDesktopHubWindow source)
    {
        ArgumentNullException.ThrowIfNull(source);
        if (!IsRegistered(source) || _primary is null || _secondaryFactory is null)
        {
            return DesktopSecondaryWindowOpenResult.Unavailable;
        }

        if (_secondary is not null)
        {
            _secondary.ShowAndActivate();
            return DesktopSecondaryWindowOpenResult.ActivatedExisting;
        }

        var route = DesktopWorkspaceRoutePolicy.TryGetSafeRoute(
            _trustedBaseUri,
            source.CurrentSource,
            out var safeRoute)
                ? safeRoute
                : null;
        var secondary = _secondaryFactory(route)
            ?? throw new InvalidOperationException("The secondary window factory returned null.");
        _secondary = secondary;
        _lastActive = secondary;
        Subscribe(secondary);
        WindowAvailabilityChanged?.Invoke(this, EventArgs.Empty);
        secondary.ShowAndActivate();
        return DesktopSecondaryWindowOpenResult.Opened;
    }

    public void ActivateLastOrPrimary(string? route = null)
    {
        var target = ResolveLastOrPrimary();
        if (target is null)
        {
            return;
        }

        if (DesktopBridgeProtocol.IsValidInternalRoute(route))
        {
            target.ShowAndNavigate(route);
            return;
        }

        target.ShowAndActivate();
    }

    public void ReloadLastOrPrimaryWithoutCache()
    {
        var target = ResolveLastOrPrimary();
        if (target is null)
        {
            return;
        }

        target.ShowAndActivate();
        target.ReloadWithoutCache();
    }

    public void UpdateShellStatus(IDesktopHubWindow window, DesktopShellStatus status)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(status);
        if (!IsRegistered(window))
        {
            return;
        }

        _shellStatuses[window] = status.Authenticated ? status : DesktopShellStatus.Empty;
        ShellStatusChanged?.Invoke(
            this,
            new DesktopShellStatusChangedEventArgs(AggregateShellStatus()));
    }

    public void UpdateQuickRoutes(
        IDesktopHubWindow window,
        IReadOnlyList<DesktopQuickRoute> routes)
    {
        ArgumentNullException.ThrowIfNull(window);
        ArgumentNullException.ThrowIfNull(routes);
        if (!IsRegistered(window))
        {
            return;
        }

        _quickRoutes[window] = routes;
        if (ReferenceEquals(window, ResolveQuickRouteOwner()))
        {
            QuickRoutesChanged?.Invoke(
                this,
                new DesktopQuickRoutesChangedEventArgs(routes));
        }
    }

    private void Subscribe(IDesktopHubWindow window)
    {
        window.Activated += Window_Activated;
        window.Closed += Window_Closed;
    }

    private void Unsubscribe(IDesktopHubWindow window)
    {
        window.Activated -= Window_Activated;
        window.Closed -= Window_Closed;
    }

    private void Window_Activated(object? sender, EventArgs e)
    {
        if (sender is not IDesktopHubWindow window || !IsRegistered(window))
        {
            return;
        }

        if (!ReferenceEquals(window, _mailCompose))
        {
            _lastActive = window;
        }
        var owner = ResolveQuickRouteOwner();
        if (owner is not null && _quickRoutes.TryGetValue(owner, out var routes))
        {
            QuickRoutesChanged?.Invoke(
                this,
                new DesktopQuickRoutesChangedEventArgs(routes));
        }
    }

    private void Window_Closed(object? sender, EventArgs e)
    {
        if (sender is not IDesktopHubWindow window)
        {
            return;
        }

        Unsubscribe(window);
        _shellStatuses.Remove(window);
        _quickRoutes.Remove(window);
        _lifecycle?.ForgetWindow(window);
        if (ReferenceEquals(window, _secondary))
        {
            _secondary = null;
        }
        else if (ReferenceEquals(window, _mailCompose))
        {
            _mailCompose = null;
            _mailComposeRoute = null;
        }
        else if (ReferenceEquals(window, _primary))
        {
            _primary = null;
        }

        if (ReferenceEquals(window, _lastActive))
        {
            _lastActive = _primary ?? _secondary;
        }

        WindowAvailabilityChanged?.Invoke(this, EventArgs.Empty);
        ShellStatusChanged?.Invoke(
            this,
            new DesktopShellStatusChangedEventArgs(AggregateShellStatus()));
        var owner = ResolveQuickRouteOwner();
        QuickRoutesChanged?.Invoke(
            this,
            new DesktopQuickRoutesChangedEventArgs(
                owner is not null && _quickRoutes.TryGetValue(owner, out var routes)
                    ? routes
                    : []));
    }

    private IDesktopHubWindow? ResolveLastOrPrimary()
    {
        if (_lastActive?.IsVisible == true)
        {
            return _lastActive;
        }

        if (_secondary?.IsVisible == true)
        {
            return _secondary;
        }

        return _primary;
    }

    private bool IsRegistered(IDesktopHubWindow window) =>
        ReferenceEquals(window, _primary)
        || ReferenceEquals(window, _secondary)
        || ReferenceEquals(window, _mailCompose);

    private IDesktopHubWindow? ResolveQuickRouteOwner()
    {
        if (_lastActive is not null
            && _shellStatuses.GetValueOrDefault(_lastActive)?.Authenticated == true)
        {
            return _lastActive;
        }

        if (_primary is not null
            && _shellStatuses.GetValueOrDefault(_primary)?.Authenticated == true)
        {
            return _primary;
        }

        return _secondary is not null
            && _shellStatuses.GetValueOrDefault(_secondary)?.Authenticated == true
                ? _secondary
                : null;
    }

    private DesktopShellStatus AggregateShellStatus()
    {
        var authenticated = _shellStatuses.Values
            .Where(status => status.Authenticated)
            .ToArray();
        if (authenticated.Length == 0)
        {
            return DesktopShellStatus.Empty;
        }

        return new DesktopShellStatus(
            Authenticated: true,
            Online: authenticated.Any(status => status.Online),
            UnreadTotal: authenticated.Max(status => status.UnreadTotal),
            ChatUnread: authenticated.Max(status => status.ChatUnread),
            MailUnread: authenticated.Max(status => status.MailUnread),
            TasksAttention: authenticated.Max(status => status.TasksAttention));
    }
}
