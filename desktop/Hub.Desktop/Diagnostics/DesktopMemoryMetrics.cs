using System.Diagnostics;

namespace Hub.Desktop.Diagnostics;

public enum DesktopMemoryProcessKind
{
    Host,
    Browser,
    Renderer,
    Gpu,
    Utility,
    Other,
}

public sealed record DesktopMemoryProcessDescriptor(
    int ProcessId,
    DesktopMemoryProcessKind Kind);

public sealed record DesktopMemoryProcessTotals(
    long PrivateBytes,
    long WorkingSetBytes);

public sealed record DesktopMemorySample(
    DateTimeOffset RecordedAtUtc,
    string Route,
    bool Background,
    int ProcessCount,
    DesktopMemoryProcessTotals Host,
    DesktopMemoryProcessTotals Browser,
    DesktopMemoryProcessTotals Renderer,
    DesktopMemoryProcessTotals Gpu,
    DesktopMemoryProcessTotals Utility,
    DesktopMemoryProcessTotals Other,
    DesktopMemoryProcessTotals Total)
{
    public long WebViewPrivateBytes => Math.Max(0, Total.PrivateBytes - Host.PrivateBytes);

    public long WebViewWorkingSetBytes => Math.Max(0, Total.WorkingSetBytes - Host.WorkingSetBytes);
}

public sealed record DesktopMemoryWindowSummary(
    int SampleCount,
    long LatestPrivateBytes,
    long P95PrivateBytes,
    long MaxPrivateBytes,
    long LatestWorkingSetBytes,
    long P95WorkingSetBytes,
    long MaxWorkingSetBytes);

public sealed record DesktopMemoryRouteSummary(
    string Route,
    bool Background,
    int SampleCount,
    long P95PrivateBytes,
    long MaxPrivateBytes);

public sealed record DesktopMemorySnapshot(
    DesktopMemorySample? Current,
    DesktopMemoryWindowSummary? Active,
    DesktopMemoryWindowSummary? Background,
    IReadOnlyList<DesktopMemoryRouteSummary> Routes);

internal sealed record DesktopProcessMemoryReading(
    long PrivateBytes,
    long WorkingSetBytes);

public sealed class DesktopMemorySampler
{
    private readonly Func<int, DesktopProcessMemoryReading?> _readProcess;

    public DesktopMemorySampler()
        : this(ReadProcess)
    {
    }

    internal DesktopMemorySampler(Func<int, DesktopProcessMemoryReading?> readProcess)
    {
        _readProcess = readProcess;
    }

    public DesktopMemorySample? Capture(
        DateTimeOffset recordedAtUtc,
        string route,
        bool background,
        IReadOnlyCollection<DesktopMemoryProcessDescriptor> descriptors)
    {
        ArgumentNullException.ThrowIfNull(descriptors);
        var totals = new Dictionary<DesktopMemoryProcessKind, DesktopMemoryProcessTotals>();
        var seenProcessIds = new HashSet<int>();
        var processCount = 0;

        foreach (var descriptor in descriptors)
        {
            if (descriptor.ProcessId <= 0 || !seenProcessIds.Add(descriptor.ProcessId))
            {
                continue;
            }

            var reading = _readProcess(descriptor.ProcessId);
            if (reading is null)
            {
                continue;
            }

            processCount++;
            var current = totals.GetValueOrDefault(
                descriptor.Kind,
                new DesktopMemoryProcessTotals(0, 0));
            totals[descriptor.Kind] = new DesktopMemoryProcessTotals(
                AddBytes(current.PrivateBytes, reading.PrivateBytes),
                AddBytes(current.WorkingSetBytes, reading.WorkingSetBytes));
        }

        if (processCount == 0)
        {
            return null;
        }

        var host = GetTotals(totals, DesktopMemoryProcessKind.Host);
        var browser = GetTotals(totals, DesktopMemoryProcessKind.Browser);
        var renderer = GetTotals(totals, DesktopMemoryProcessKind.Renderer);
        var gpu = GetTotals(totals, DesktopMemoryProcessKind.Gpu);
        var utility = GetTotals(totals, DesktopMemoryProcessKind.Utility);
        var other = GetTotals(totals, DesktopMemoryProcessKind.Other);
        var all = new[] { host, browser, renderer, gpu, utility, other };
        var total = new DesktopMemoryProcessTotals(
            all.Aggregate(0L, (sum, item) => AddBytes(sum, item.PrivateBytes)),
            all.Aggregate(0L, (sum, item) => AddBytes(sum, item.WorkingSetBytes)));

        return new DesktopMemorySample(
            recordedAtUtc,
            DesktopMemoryRouteClassifier.Classify(route),
            background,
            processCount,
            host,
            browser,
            renderer,
            gpu,
            utility,
            other,
            total);
    }

    private static DesktopMemoryProcessTotals GetTotals(
        IReadOnlyDictionary<DesktopMemoryProcessKind, DesktopMemoryProcessTotals> totals,
        DesktopMemoryProcessKind kind) =>
        totals.GetValueOrDefault(kind, new DesktopMemoryProcessTotals(0, 0));

    private static long AddBytes(long left, long right)
    {
        var safeRight = Math.Max(0, right);
        return left > long.MaxValue - safeRight ? long.MaxValue : left + safeRight;
    }

    private static DesktopProcessMemoryReading? ReadProcess(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            process.Refresh();
            return new DesktopProcessMemoryReading(
                Math.Max(0, process.PrivateMemorySize64),
                Math.Max(0, process.WorkingSet64));
        }
        catch (Exception exception) when (
            exception is ArgumentException
            or InvalidOperationException
            or NotSupportedException
            or System.ComponentModel.Win32Exception)
        {
            // WebView2 processes can exit between GetProcessInfos and this read.
            return null;
        }
    }
}

public sealed class DesktopMemoryMetrics
{
    internal const int MaximumSamples = 180;
    internal static readonly TimeSpan MaximumAge = TimeSpan.FromMinutes(30);

    private readonly object _sync = new();
    private readonly Func<DateTimeOffset> _utcNow;
    private readonly List<DesktopMemorySample> _samples = [];

    public DesktopMemoryMetrics()
        : this(() => DateTimeOffset.UtcNow)
    {
    }

    internal DesktopMemoryMetrics(Func<DateTimeOffset> utcNow)
    {
        _utcNow = utcNow;
    }

    public void Record(DesktopMemorySample sample)
    {
        ArgumentNullException.ThrowIfNull(sample);
        lock (_sync)
        {
            _samples.Add(sample);
            Prune(sample.RecordedAtUtc);
        }
    }

    public DesktopMemorySnapshot Snapshot()
    {
        lock (_sync)
        {
            Prune(_utcNow());
            var current = _samples.LastOrDefault();
            var activeSamples = _samples.Where(sample => !sample.Background).ToArray();
            var backgroundSamples = _samples.Where(sample => sample.Background).ToArray();
            var routes = _samples
                .GroupBy(sample => (sample.Route, sample.Background))
                .OrderBy(group => group.Key.Route, StringComparer.Ordinal)
                .ThenBy(group => group.Key.Background)
                .Select(group =>
                {
                    var routeSamples = group.ToArray();
                    return new DesktopMemoryRouteSummary(
                        group.Key.Route,
                        group.Key.Background,
                        routeSamples.Length,
                        Percentile95(routeSamples.Select(sample => sample.Total.PrivateBytes)),
                        routeSamples.Max(sample => sample.Total.PrivateBytes));
                })
                .ToArray();

            return new DesktopMemorySnapshot(
                current,
                Summarize(activeSamples),
                Summarize(backgroundSamples),
                routes);
        }
    }

    private void Prune(DateTimeOffset now)
    {
        var cutoff = now - MaximumAge;
        _samples.RemoveAll(sample => sample.RecordedAtUtc < cutoff);
        if (_samples.Count > MaximumSamples)
        {
            _samples.RemoveRange(0, _samples.Count - MaximumSamples);
        }
    }

    private static DesktopMemoryWindowSummary? Summarize(
        IReadOnlyList<DesktopMemorySample> samples)
    {
        if (samples.Count == 0)
        {
            return null;
        }

        var latest = samples[^1].Total;
        return new DesktopMemoryWindowSummary(
            samples.Count,
            latest.PrivateBytes,
            Percentile95(samples.Select(sample => sample.Total.PrivateBytes)),
            samples.Max(sample => sample.Total.PrivateBytes),
            latest.WorkingSetBytes,
            Percentile95(samples.Select(sample => sample.Total.WorkingSetBytes)),
            samples.Max(sample => sample.Total.WorkingSetBytes));
    }

    private static long Percentile95(IEnumerable<long> values)
    {
        var ordered = values.Order().ToArray();
        if (ordered.Length == 0)
        {
            return 0;
        }

        var index = Math.Clamp(
            (int)Math.Ceiling(ordered.Length * 0.95) - 1,
            0,
            ordered.Length - 1);
        return ordered[index];
    }
}

public static class DesktopMemoryRouteClassifier
{
    private static readonly HashSet<string> KnownSections = new(
        [
            "about", "address-book", "admin", "chat", "company-structure",
            "computers", "dashboard", "database", "dlp", "docflow", "feed",
            "file-egress", "groups-access", "kb", "login", "mail", "menu",
            "mfu", "my-files", "networks", "passwords", "profile", "scan-center",
            "settings", "shared-files", "statistics", "tasks", "tickets", "vcs",
            "warehouse-1c",
        ],
        StringComparer.OrdinalIgnoreCase);

    public static string Classify(string? source)
    {
        var path = source ?? string.Empty;
        if (Uri.TryCreate(path, UriKind.Absolute, out var uri))
        {
            path = uri.AbsolutePath;
        }
        else
        {
            path = path.Split('?', '#')[0];
        }

        var section = path
            .Trim()
            .Trim('/')
            .Split('/', StringSplitOptions.RemoveEmptyEntries)
            .FirstOrDefault();
        if (string.IsNullOrWhiteSpace(section))
        {
            return "/";
        }

        return KnownSections.Contains(section)
            ? $"/{section.ToLowerInvariant()}"
            : "/other";
    }
}
