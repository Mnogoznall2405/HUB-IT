namespace Hub.Desktop.WebView;

public enum WebViewFailureKind
{
    Initialization,
    BrowserProcessExited,
    RendererProcessExited,
    FrameProcessExited,
    NavigationTimeout,
    Network,
    RuntimeUnavailable,
    Certificate,
}

public enum WebViewRecoveryAction
{
    RecreateWebView,
    Reload,
    ShowManualRetry,
}

public sealed record WebViewRecoveryDecision(
    WebViewRecoveryAction Action,
    TimeSpan Delay,
    int Attempt,
    bool DeleteProfile = false);

public sealed class WebViewRecoveryPolicy
{
    private const int MaximumAutomaticAttempts = 4;
    private static readonly TimeSpan FailureWindow = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan MaximumDelay = TimeSpan.FromSeconds(30);
    private readonly object _sync = new();
    private readonly Queue<DateTimeOffset> _recentFailures = new();
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly Func<double> _jitter;

    public WebViewRecoveryPolicy()
        : this(() => DateTimeOffset.UtcNow, () => Random.Shared.NextDouble())
    {
    }

    internal WebViewRecoveryPolicy(
        Func<DateTimeOffset> utcNow,
        Func<double> jitter)
    {
        _utcNow = utcNow;
        _jitter = jitter;
    }

    public WebViewRecoveryDecision Next(WebViewFailureKind failure)
    {
        if (failure is WebViewFailureKind.RuntimeUnavailable
            or WebViewFailureKind.Certificate)
        {
            return new WebViewRecoveryDecision(
                WebViewRecoveryAction.ShowManualRetry,
                TimeSpan.Zero,
                Attempt: 0);
        }

        lock (_sync)
        {
            var now = _utcNow();
            while (_recentFailures.TryPeek(out var recordedAt)
                   && now - recordedAt > FailureWindow)
            {
                _recentFailures.Dequeue();
            }

            _recentFailures.Enqueue(now);
            var attempt = _recentFailures.Count;
            if (attempt > MaximumAutomaticAttempts)
            {
                return new WebViewRecoveryDecision(
                    WebViewRecoveryAction.ShowManualRetry,
                    TimeSpan.Zero,
                    attempt);
            }

            var action = failure is
                WebViewFailureKind.Network
                or WebViewFailureKind.NavigationTimeout
                    ? WebViewRecoveryAction.Reload
                    : WebViewRecoveryAction.RecreateWebView;
            return new WebViewRecoveryDecision(
                action,
                CalculateDelay(attempt),
                attempt);
        }
    }

    private TimeSpan CalculateDelay(int attempt)
    {
        if (attempt <= 1)
        {
            return TimeSpan.Zero;
        }

        var baseMilliseconds = TimeSpan.FromSeconds(
            2 * Math.Pow(2, attempt - 2)).TotalMilliseconds;
        var jitter = Math.Clamp(_jitter(), 0, 1) * 0.25;
        return TimeSpan.FromMilliseconds(Math.Min(
            baseMilliseconds * (1 + jitter),
            MaximumDelay.TotalMilliseconds));
    }
}
