using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;
using Hub.Agent.Core.BrowserProbe;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.BrowserProbe;

internal sealed record Snapshot(nint Hwnd, string Browser, string ProcessName, string Title, string PageTitle, string Url);

/// <summary>
/// Interactive Chromium probe: foreground tab tracking, UIA address bar,
/// window screenshots and history deltas. Mirrors browser_probe/watcher.py.
/// </summary>
internal sealed class ProbeRunner
{
    private static readonly Dictionary<string, string> BrowserProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chrome.exe"] = "chrome",
        ["msedge.exe"] = "edge",
        ["browser.exe"] = "yandex",
    };

    private static readonly string[] TitleSuffixes =
    {
        " - Google Chrome", " — Google Chrome", " - Microsoft Edge", " — Microsoft Edge",
        " - Яндекс Браузер", " — Яндекс Браузер", " - Yandex", " — Yandex",
    };

    private readonly AgentLog _log;
    private readonly string _outputDir;
    private readonly string _screenshotsDir;
    private readonly BrowserProbeSync _sync;
    private readonly double _pollSec;
    private readonly double _historySec;
    private readonly double _shotThrottleSec;
    private readonly Dictionary<string, long> _cursors = new(StringComparer.Ordinal);
    private readonly string _statePath;
    private readonly string _user;
    private readonly string _computer;

    private Snapshot? _current;
    private DateTime _currentSince;
    private string? _currentKey;
    private string _lastShotKey = string.Empty;
    private DateTime _lastShotAt = DateTime.MinValue;
    private DateTime _lastHistoryAt = DateTime.MinValue;
    private readonly Dictionary<string, string> _shotsByKey = new(StringComparer.OrdinalIgnoreCase);

    public ProbeRunner(AgentLog log, string outputDir, bool allowSend)
    {
        _log = log;
        _outputDir = outputDir;
        _screenshotsDir = Path.Combine(outputDir, "screenshots");        Directory.CreateDirectory(_screenshotsDir);
        _statePath = Path.Combine(outputDir, "state.json");
        _user = Text.Sanitize(Environment.GetEnvironmentVariable("USERNAME"));
        _computer = Text.Sanitize(Environment.GetEnvironmentVariable("COMPUTERNAME"));

        _pollSec = Math.Max(1, ParseDouble(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_POLL_SEC"), 3));
        _historySec = Math.Max(30, ParseDouble(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_HISTORY_SEC"), 180));
        _shotThrottleSec = Math.Max(5, ParseDouble(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_SHOT_THROTTLE_SEC"), 30));

        var serverUrl = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_SERVER_URL"));
        if (serverUrl.Length == 0)
        {
            serverUrl = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_AGENT_SERVER_URL"));
        }

        var apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("ITINV_AGENT_API_KEY"));
        if (apiKey.Length == 0)
        {
            apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_API_KEY"));
        }

        var syncSec = ParseDouble(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_SYNC_SEC"), 120);
        if (!AgentPaths.IsInstalledBuild && !allowSend)
        {
            log.Warn("Browser probe development build: uploads disabled (pass --allow-send to enable)");
            serverUrl = string.Empty;
            apiKey = string.Empty;
        }

        _sync = new BrowserProbeSync(outputDir, serverUrl, apiKey, syncSec, log);
        LoadState();
    }

    public async Task<int> SyncOnlyAsync(CancellationToken cancellationToken)
    {
        await _sync.MaybeSyncAsync(force: true, cancellationToken).ConfigureAwait(false);
        return 0;
    }

    public async Task<int> RunAsync(CancellationToken cancellationToken, bool once)
    {
        _log.Info($"browser probe start output={_outputDir} poll={_pollSec}s history={_historySec}s");
        var first = true;
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                PollForeground(first);
                if (first || (DateTime.UtcNow - _lastHistoryAt).TotalSeconds >= _historySec)
                {
                    PollHistory();
                    _lastHistoryAt = DateTime.UtcNow;
                }

                await _sync.MaybeSyncAsync(force: once, cancellationToken).ConfigureAwait(false);
                first = false;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _log.Exception("browser probe cycle failed", ex);
            }

            if (once)
            {
                break;
            }

            try
            {
                await Task.Delay(TimeSpan.FromSeconds(_pollSec), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        SaveState();
        return 0;
    }

    private void PollForeground(bool first)
    {
        var snap = ReadForeground();
        var newKey = snap is null ? null : KeyOf(snap);
        var focus = new List<Dictionary<string, object?>>();
        var shots = new List<Dictionary<string, object?>>();

        if (!first && _current is not null && _currentKey is not null && !string.Equals(newKey, _currentKey, StringComparison.Ordinal))
        {
            var dwell = Math.Max(0, (DateTime.UtcNow - _currentSince).TotalSeconds);
            var closed = BuildFocusEvent(_current, dwell);
            if (!BrowserClassify.IsNoise(_current.Url, _current.PageTitle))
            {
                var (domain, category) = BrowserClassify.Classify(_current.Url, _current.PageTitle);
                closed["domain"] = domain;
                closed["category"] = category;
                if (_shotsByKey.TryGetValue(KeyOf(_current), out var shotName))
                {
                    closed["screenshot_file"] = shotName;
                }

                focus.Add(closed);
            }
        }

        var titleChanged = newKey is not null && !string.Equals(newKey, _currentKey, StringComparison.Ordinal);
        if (snap is not null && titleChanged
            && !BrowserClassify.IsNoise(snap.Url, snap.PageTitle)
            && (DateTime.UtcNow - _lastShotAt).TotalSeconds >= _shotThrottleSec
            && !string.Equals(newKey, _lastShotKey, StringComparison.Ordinal))
        {
            var shot = Capture(snap);
            if (shot is not null)
            {
                shots.Add(shot);
                _lastShotKey = newKey!;
                _lastShotAt = DateTime.UtcNow;
                _shotsByKey[newKey!] = Text.Sanitize(shot.GetValueOrDefault("file")).Split('/')[^1];
                if (_shotsByKey.Count > 512)
                {
                    _shotsByKey.Remove(_shotsByKey.Keys.First());
                }
            }
        }

        if (newKey != _currentKey)
        {
            _current = snap;
            _currentKey = newKey;
            _currentSince = DateTime.UtcNow;
        }
        else if (snap is not null)
        {
            _current = snap;
        }

        if (focus.Count > 0 || shots.Count > 0)
        {
            _sync.Enqueue(new Dictionary<string, object?>
            {
                ["computer_name"] = _computer,
                ["windows_user"] = _user,
                ["visits"] = new List<Dictionary<string, object?>>(),
                ["focus_events"] = focus,
                ["screenshots"] = shots,
            });
        }
    }

    private void PollHistory()
    {
        if (!Text.Truthy(Environment.GetEnvironmentVariable("ITINV_BROWSER_PROBE_HISTORY_ENABLED"), true))
        {
            return;
        }

        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var profiles = BrowserHistory.DiscoverProfiles(localAppData, _user);
        if (profiles.Count == 0)
        {
            return;
        }

        var workDir = Path.Combine(_outputDir, "hist_tmp");
        var visits = new List<Dictionary<string, object?>>();
        var changed = false;
        foreach (var profile in profiles)
        {
            if (!_cursors.ContainsKey(profile.CursorKey))
            {
                _cursors[profile.CursorKey] = BrowserHistory.LatestVisitId(profile, workDir);
                changed = true;
            }

            var since = _cursors.GetValueOrDefault(profile.CursorKey, 0);
            var batch = BrowserHistory.ReadVisitsSince(profile, since, 400, workDir);
            if (batch.Cursor > since)
            {
                _cursors[profile.CursorKey] = batch.Cursor;
                changed = true;
            }

            if (batch.NoiseOnly)
            {
                continue;
            }

            foreach (var row in batch.Rows)
            {
                visits.Add(row);
            }
        }

        if (changed)
        {
            SaveState();
        }

        if (visits.Count > 0)
        {
            _sync.Enqueue(new Dictionary<string, object?>
            {
                ["computer_name"] = _computer,
                ["windows_user"] = _user,
                ["visits"] = visits,
                ["focus_events"] = new List<Dictionary<string, object?>>(),
                ["screenshots"] = new List<Dictionary<string, object?>>(),
            });
        }
    }

    private Dictionary<string, object?> BuildFocusEvent(Snapshot snap, double dwell) => new()
    {
        ["event_id"] = Guid.NewGuid().ToString("N"),
        ["browser"] = snap.Browser,
        ["title"] = snap.PageTitle,
        ["window_title"] = snap.Title,
        ["url"] = snap.Url,
        ["hwnd"] = snap.Hwnd.ToInt64(),
        ["dwell_sec"] = Math.Round(dwell, 1),
        ["ended_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
        ["source"] = "focus",
    };

    private Dictionary<string, object?>? Capture(Snapshot snap)
    {
        try
        {
            var bounds = WindowBounds(snap.Hwnd);
            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                return null;
            }

            using var bitmap = new Bitmap(bounds.Width, bounds.Height);
            using (var graphics = Graphics.FromImage(bitmap))
            {
                graphics.CopyFromScreen(bounds.Left, bounds.Top, 0, 0, new Size(bounds.Width, bounds.Height), CopyPixelOperation.SourceCopy);
            }

            var name = $"{snap.Browser}_{DateTime.Now:yyyyMMdd_HHmmss_fff}.png";
            var path = Path.Combine(_screenshotsDir, name);
            bitmap.Save(path, ImageFormat.Png);

            return new Dictionary<string, object?>
            {
                ["file"] = $"screenshots/{name}",
                ["browser"] = snap.Browser,
                ["title"] = snap.PageTitle,
                ["window_title"] = snap.Title,
                ["url"] = snap.Url,
                ["captured_at"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffff'Z'"),
            };
        }
        catch (Exception ex)
        {
            _log.Debug($"screenshot skipped: {ex.Message}");
            return null;
        }
    }

    private static string KeyOf(Snapshot snap)
        => $"{snap.Browser}|{(snap.Url.Length > 0 ? snap.Url.ToLowerInvariant() : snap.PageTitle.ToLowerInvariant())}";

    private Snapshot? ReadForeground()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd))
            {
                return null;
            }

            var length = GetWindowTextLength(hwnd);
            var builder = new StringBuilder(Math.Max(1, length + 1));
            GetWindowText(hwnd, builder, builder.Capacity);
            var title = builder.ToString().Trim();
            GetWindowThreadProcessId(hwnd, out var pid);
            var processName = string.Empty;
            try
            {
                processName = Process.GetProcessById((int)pid).ProcessName.ToLowerInvariant() + ".exe";
            }
            catch (Exception)
            {
                return null;
            }

            if (!BrowserProcesses.TryGetValue(processName, out var browser))
            {
                return null;
            }

            var url = ReadOmniboxUrl(hwnd);
            return new Snapshot(hwnd, browser, processName, title, StripBrowserSuffix(title), url);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private string ReadOmniboxUrl(IntPtr hwnd)
    {
        try
        {
            EnableScreenReaderHint();
            var root = AutomationElement.FromHandle(hwnd);
            if (root is null)
            {
                return string.Empty;
            }

            var conditions = new OrCondition(
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit),
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.ComboBox));
            var elements = root.FindAll(TreeScope.Descendants, conditions);
            var best = string.Empty;
            foreach (AutomationElement element in elements)
            {
                if (!element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
                {
                    continue;
                }

                var value = Text.Sanitize(((ValuePattern)pattern).Current.Value);
                if (LooksLikeUrl(value) && value.Length >= best.Length)
                {
                    best = value;
                }
            }

            return NormalizeUrl(best);
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static bool LooksLikeUrl(string value)
    {
        var text = Text.Sanitize(value);
        if (text.Length == 0 || text.Length > 2000 || text.Contains(' '))
        {
            return false;
        }

        var lower = text.ToLowerInvariant();
        if (lower.StartsWith("http://") || lower.StartsWith("https://") || lower.StartsWith("file://")
            || lower.StartsWith("chrome://") || lower.StartsWith("edge://") || lower.StartsWith("browser://"))
        {
            return true;
        }

        return text.Contains('.') && !text.StartsWith('.');
    }

    private static string NormalizeUrl(string value)
    {
        var text = Text.Sanitize(value);
        if (text.Length == 0)
        {
            return string.Empty;
        }

        if (text.StartsWith("http://") || text.StartsWith("https://") || text.StartsWith("file://")
            || text.StartsWith("chrome://") || text.StartsWith("edge://") || text.StartsWith("browser://"))
        {
            return text;
        }

        return text.StartsWith("//") ? "https:" + text : "https://" + text.TrimStart('/');
    }

    private static string StripBrowserSuffix(string title)
    {
        var text = Text.Sanitize(title);
        foreach (var suffix in TitleSuffixes)
        {
            if (text.EndsWith(suffix, StringComparison.Ordinal))
            {
                return text[..^suffix.Length].Trim();
            }
        }

        var dash = text.LastIndexOf(" - ", StringComparison.Ordinal);
        if (dash > 0)
        {
            return text[..dash].Trim();
        }

        var emDash = text.LastIndexOf(" — ", StringComparison.Ordinal);
        return emDash > 0 ? text[..emDash].Trim() : text;
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_statePath))
            {
                return;
            }

            using var document = JsonDocument.Parse(File.ReadAllText(_statePath));
            if (document.RootElement.TryGetProperty("visit_cursors", out var cursors))
            {
                foreach (var property in cursors.EnumerateObject())
                {
                    if (property.Value.TryGetInt64(out var value))
                    {
                        _cursors[property.Name] = value;
                    }
                }
            }
        }
        catch (Exception)
        {
            _cursors.Clear();
        }
    }

    private void SaveState()
    {
        try
        {
            AtomicFile.WriteAllText(_statePath, JsonSerializer.Serialize(new Dictionary<string, object?>
            {
                ["windows_user"] = _user,
                ["computer_name"] = _computer,
                ["visit_cursors"] = _cursors,
                ["updated_at"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.ffffff'Z'"),
            }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception ex)
        {
            _log.Warn($"browser probe state write failed: {ex.Message}");
        }
    }

    private static double ParseDouble(string? raw, double fallback)
    {
        var value = Text.Sanitize(raw).Replace(',', '.');
        return double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : fallback;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Rect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    private const int DwmwaExtendedFrameBounds = 9;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out Rect value, int size);

    [DllImport("user32.dll")]
    private static extern bool SystemParametersInfo(uint action, uint param, IntPtr value, uint winIni);

    private static void EnableScreenReaderHint()
    {
        try
        {
            SystemParametersInfo(0x0047, 1, IntPtr.Zero, 0);
        }
        catch (Exception)
        {
            // best effort
        }
    }

    private Rectangle WindowBounds(IntPtr hwnd)
    {
        try
        {
            if (DwmGetWindowAttribute(hwnd, DwmwaExtendedFrameBounds, out var rect, Marshal.SizeOf<Rect>()) == 0
                && rect.Right > rect.Left && rect.Bottom > rect.Top)
            {
                return Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            }
        }
        catch (Exception)
        {
            // fall back to GetWindowRect
        }

        if (GetWindowRect(hwnd, out var fallback) && fallback.Right > fallback.Left && fallback.Bottom > fallback.Top)
        {
            return Rectangle.FromLTRB(fallback.Left, fallback.Top, fallback.Right, fallback.Bottom);
        }

        return Rectangle.Empty;
    }
}
