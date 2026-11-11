namespace Hub.Desktop.Diagnostics;

public sealed record DesktopPerformanceSnapshot(
    long? ProcessStartToWebViewMilliseconds,
    long? WebViewToBridgeMilliseconds,
    long UiThreadStallCount,
    long WebViewProcessFailureCount);

public sealed class DesktopPerformanceMetrics
{
    private static readonly TimeSpan UiStallThreshold = TimeSpan.FromMilliseconds(1500);
    private readonly object _sync = new();
    private readonly DateTimeOffset _processStartedAt;
    private DateTimeOffset? _webViewInitializedAt;
    private DateTimeOffset? _bridgeReadyAt;
    private DateTimeOffset? _lastUiPulseAt;
    private long _uiThreadStallCount;
    private long _webViewProcessFailureCount;

    public DesktopPerformanceMetrics(DateTimeOffset processStartedAt)
    {
        _processStartedAt = processStartedAt;
    }

    public void RecordWebViewInitialized(DateTimeOffset recordedAt)
    {
        lock (_sync)
        {
            _webViewInitializedAt ??= recordedAt;
        }
    }

    public void RecordBridgeReady(DateTimeOffset recordedAt)
    {
        lock (_sync)
        {
            _bridgeReadyAt ??= recordedAt;
        }
    }

    public void RecordUiPulse(DateTimeOffset recordedAt)
    {
        lock (_sync)
        {
            if (_lastUiPulseAt is { } previous
                && recordedAt - previous > UiStallThreshold)
            {
                _uiThreadStallCount++;
            }

            _lastUiPulseAt = recordedAt;
        }
    }

    public void RecordWebViewProcessFailure()
    {
        lock (_sync)
        {
            _webViewProcessFailureCount++;
        }
    }

    public DesktopPerformanceSnapshot Snapshot()
    {
        lock (_sync)
        {
            return new DesktopPerformanceSnapshot(
                MillisecondsBetween(_processStartedAt, _webViewInitializedAt),
                _webViewInitializedAt is { } webView
                    ? MillisecondsBetween(webView, _bridgeReadyAt)
                    : null,
                _uiThreadStallCount,
                _webViewProcessFailureCount);
        }
    }

    private static long? MillisecondsBetween(
        DateTimeOffset start,
        DateTimeOffset? end) =>
        end is null
            ? null
            : Math.Max(0, (long)Math.Round(
                (end.Value - start).TotalMilliseconds,
                MidpointRounding.AwayFromZero));
}
