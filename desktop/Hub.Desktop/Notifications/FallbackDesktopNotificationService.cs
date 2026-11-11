using Hub.Desktop.Interop;

namespace Hub.Desktop.Notifications;

public sealed class FallbackDesktopNotificationService : IDesktopNotificationService
{
    private const int MaximumDeliveredIds = 300;
    private readonly IDesktopNotificationService _primary;
    private readonly bool _fallbackEnabled;
    private readonly object _deliverySync = new();
    private readonly HashSet<string> _deliveredIds = new(StringComparer.Ordinal);
    private readonly Queue<string> _deliveryOrder = new();
    private Func<DesktopNotificationRequest, bool>? _fallback;
    private Func<DesktopNotificationRequest, DesktopNotificationRequest?>? _requestPolicy;
    private bool _preferFallback;

    public FallbackDesktopNotificationService(
        IDesktopNotificationService primary,
        bool fallbackEnabled = true)
    {
        _primary = primary ?? throw new ArgumentNullException(nameof(primary));
        _fallbackEnabled = fallbackEnabled;
    }

    public bool IsAvailable => _primary.IsAvailable || (_fallbackEnabled && _fallback is not null);

    public void SetFallback(
        Func<DesktopNotificationRequest, bool> fallback,
        bool preferFallback = false)
    {
        if (!_fallbackEnabled)
        {
            return;
        }

        _fallback = fallback ?? throw new ArgumentNullException(nameof(fallback));
        _preferFallback = preferFallback;
    }

    public void ClearFallback()
    {
        _fallback = null;
        _preferFallback = false;
    }

    public void SetRequestPolicy(
        Func<DesktopNotificationRequest, DesktopNotificationRequest?> requestPolicy)
    {
        _requestPolicy = requestPolicy ?? throw new ArgumentNullException(nameof(requestPolicy));
    }

    public void ClearRequestPolicy() => _requestPolicy = null;

    public bool TryShow(DesktopNotificationRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        lock (_deliverySync)
        {
            if (_deliveredIds.Contains(request.Id))
            {
                return true;
            }

            var requestPolicy = _requestPolicy;
            var preparedRequest = requestPolicy?.Invoke(request)
                ?? (requestPolicy is null ? request : null);
            if (preparedRequest is null)
            {
                RememberDelivered(request.Id);
                return true;
            }

            var delivered = TryDeliver(preparedRequest);
            if (delivered)
            {
                RememberDelivered(request.Id);
            }

            return delivered;
        }
    }

    /// <summary>
    /// Clears the group in the primary channel only; tray balloon and the persistent fallback window
    /// have no per-group history, so there is nothing to clear there.
    /// </summary>
    public void ClearGroup(string group)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(group);
        _primary.ClearGroup(group);
    }

    private bool TryDeliver(DesktopNotificationRequest request)
    {
        if (_fallbackEnabled && _preferFallback && _fallback?.Invoke(request) == true)
        {
            return true;
        }

        if (_primary.IsAvailable && _primary.TryShow(request))
        {
            return true;
        }

        return _fallbackEnabled && !_preferFallback && _fallback?.Invoke(request) == true;
    }

    private void RememberDelivered(string id)
    {
        if (!_deliveredIds.Add(id))
        {
            return;
        }

        _deliveryOrder.Enqueue(id);
        while (_deliveryOrder.Count > MaximumDeliveredIds)
        {
            _deliveredIds.Remove(_deliveryOrder.Dequeue());
        }
    }
}
