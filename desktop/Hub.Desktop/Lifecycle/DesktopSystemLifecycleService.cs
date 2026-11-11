namespace Hub.Desktop.Lifecycle;

public sealed class DesktopSystemLifecycleService : IDisposable
{
    private readonly IDesktopSystemEventSource _source;
    private readonly DesktopSystemLifecycleCoalescer _coalescer;
    private readonly Action<Action> _marshalToUi;
    private bool _disposed;

    public DesktopSystemLifecycleService(
        IDesktopSystemEventSource source,
        DesktopSystemLifecycleCoalescer coalescer,
        Action<Action> marshalToUi)
    {
        _source = source ?? throw new ArgumentNullException(nameof(source));
        _coalescer = coalescer ?? throw new ArgumentNullException(nameof(coalescer));
        _marshalToUi = marshalToUi ?? throw new ArgumentNullException(nameof(marshalToUi));
        _source.Resumed += Source_Resumed;
        _source.NetworkAvailabilityChanged += Source_NetworkAvailabilityChanged;
        _coalescer.Coalesced += Coalescer_Coalesced;
    }

    public event EventHandler<DesktopSystemLifecycleMessage>? Coalesced;

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Resumed -= Source_Resumed;
        _source.NetworkAvailabilityChanged -= Source_NetworkAvailabilityChanged;
        _coalescer.Coalesced -= Coalescer_Coalesced;
        _coalescer.Dispose();
        _source.Dispose();
    }

    private void Source_Resumed(object? sender, EventArgs e) =>
        _marshalToUi(() =>
        {
            if (!_disposed)
            {
                _coalescer.HandleResume();
            }
        });

    private void Source_NetworkAvailabilityChanged(object? sender, bool available) =>
        _marshalToUi(() =>
        {
            if (!_disposed)
            {
                _coalescer.HandleNetworkAvailability(available);
            }
        });

    private void Coalescer_Coalesced(object? sender, DesktopSystemLifecycleMessage message) =>
        Coalesced?.Invoke(this, message);
}
