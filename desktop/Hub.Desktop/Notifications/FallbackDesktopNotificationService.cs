using Hub.Desktop.Interop;

namespace Hub.Desktop.Notifications;

public sealed class FallbackDesktopNotificationService : IDesktopNotificationService
{
    private readonly IDesktopNotificationService _primary;
    private Func<DesktopNotificationRequest, bool>? _fallback;
    private bool _preferFallback;

    public FallbackDesktopNotificationService(IDesktopNotificationService primary)
    {
        _primary = primary ?? throw new ArgumentNullException(nameof(primary));
    }

    public bool IsAvailable => _primary.IsAvailable || _fallback is not null;

    public void SetFallback(
        Func<DesktopNotificationRequest, bool> fallback,
        bool preferFallback = false)
    {
        _fallback = fallback ?? throw new ArgumentNullException(nameof(fallback));
        _preferFallback = preferFallback;
    }

    public void ClearFallback()
    {
        _fallback = null;
        _preferFallback = false;
    }

    public bool TryShow(DesktopNotificationRequest request)
    {
        if (_preferFallback && _fallback?.Invoke(request) == true)
        {
            return true;
        }

        if (_primary.IsAvailable && _primary.TryShow(request))
        {
            return true;
        }

        return !_preferFallback && _fallback?.Invoke(request) == true;
    }
}
