using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Hub.Desktop.Diagnostics;

public static class DesktopPerfBench
{
    public const string DefaultApplicationId = "HUBIT.Desktop";
#if PERF_BENCH
    public const string EnabledEnvironmentVariable = "HUB_DESKTOP_PERF_BENCH";
    public const string IsolatedRootEnvironmentVariable = "HUB_DESKTOP_ISOLATED_ROOT";
    public const string UserDataFolderEnvironmentVariable = "HUB_DESKTOP_USER_DATA_FOLDER";
    public const string OutputEnvironmentVariable = "HUB_DESKTOP_PERF_OUT";
    public const string QuitAfterMsEnvironmentVariable = "HUB_DESKTOP_PERF_QUIT_AFTER_MS";
    public const string LoginUserEnvironmentVariable = "HUB_DESKTOP_PERF_LOGIN_USER";
    public const string LoginPasswordEnvironmentVariable = "HUB_DESKTOP_PERF_LOGIN_PASSWORD";
    public const string TotpSecretEnvironmentVariable = "HUB_DESKTOP_PERF_TOTP_SECRET";
    public const string NavigatePathEnvironmentVariable = "HUB_DESKTOP_PERF_PATH";
    public const string BenchApplicationId = "HUBIT.Desktop.PerfBench";

    public static bool IsEnabled { get; } = IsTruthy(
        Environment.GetEnvironmentVariable(EnabledEnvironmentVariable));

    public static string ApplicationId => IsEnabled ? BenchApplicationId : DefaultApplicationId;
#else
    public static bool IsEnabled => false;

    public static string ApplicationId => DefaultApplicationId;
#endif

    private static readonly object Sync = new();
    private static readonly long StartTimestamp = Stopwatch.GetTimestamp();
    private static readonly HashSet<string> SeenMarks = new(StringComparer.Ordinal);

    public static bool IsTruthy(string? value) =>
        string.Equals(value?.Trim(), "1", StringComparison.Ordinal);

#if PERF_BENCH
    public static bool TryGetIsolatedRoot(out string root) =>
        TryGetFullPath(IsolatedRootEnvironmentVariable, out root);

    public static bool TryGetUserDataFolder(out string folder) =>
        TryGetFullPath(UserDataFolderEnvironmentVariable, out folder);

    public static bool TryGetOutputPath(out string path) =>
        TryGetFullPath(OutputEnvironmentVariable, out path);

    public static bool TryGetQuitAfter(out int milliseconds)
    {
        milliseconds = 0;
        if (!IsEnabled)
        {
            return false;
        }

        var raw = Environment.GetEnvironmentVariable(QuitAfterMsEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(raw)
            || !int.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out milliseconds)
            || milliseconds < 1)
        {
            milliseconds = 0;
            return false;
        }

        return true;
    }
#else
    public static bool TryGetIsolatedRoot(out string root)
    {
        root = string.Empty;
        return false;
    }

    public static bool TryGetUserDataFolder(out string folder)
    {
        folder = string.Empty;
        return false;
    }

    public static bool TryGetOutputPath(out string path)
    {
        path = string.Empty;
        return false;
    }

    public static bool TryGetQuitAfter(out int milliseconds)
    {
        milliseconds = 0;
        return false;
    }
#endif

    public static void Mark(string name)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        WriteLine(
            $"{{\"t_ms\":{ElapsedMilliseconds().ToString(CultureInfo.InvariantCulture)},\"mark\":{JsonSerializer.Serialize(name)}}}");
    }

    public static void MarkOnce(string name)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(name))
        {
            return;
        }

        lock (Sync)
        {
            if (!SeenMarks.Add(name))
            {
                return;
            }
        }

        Mark(name);
    }

    public static void RecordFields(string mark, IReadOnlyDictionary<string, long?> fields)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(mark) || fields is null)
        {
            return;
        }

        var builder = new StringBuilder();
        builder.Append("{\"t_ms\":");
        builder.Append(ElapsedMilliseconds().ToString(CultureInfo.InvariantCulture));
        builder.Append(",\"mark\":");
        builder.Append(JsonSerializer.Serialize(mark));
        foreach (var pair in fields)
        {
            if (string.IsNullOrWhiteSpace(pair.Key))
            {
                continue;
            }

            builder.Append(',');
            builder.Append(JsonSerializer.Serialize(pair.Key));
            builder.Append(':');
            if (pair.Value is null)
            {
                builder.Append("null");
            }
            else
            {
                builder.Append(pair.Value.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        builder.Append('}');
        WriteLine(builder.ToString());
    }

    public static void RecordProbeJson(string mark, string probeJson)
    {
        if (!IsEnabled || string.IsNullOrWhiteSpace(mark) || string.IsNullOrWhiteSpace(probeJson))
        {
            return;
        }

        try
        {
            using var document = JsonDocument.Parse(probeJson);
            if (!document.RootElement.TryGetProperty("resources", out var resources)
                || resources.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            WriteLine(
                "{\"t_ms\":"
                + ElapsedMilliseconds().ToString(CultureInfo.InvariantCulture)
                + ",\"mark\":"
                + JsonSerializer.Serialize(mark)
                + ",\"resources\":"
                + resources.GetRawText()
                + "}");
        }
        catch (JsonException)
        {
            // Probe JSON is best-effort diagnostics.
        }
    }

    public static void WriteReadySentinel()
    {
        if (!TryGetOutputPath(out var outputPath))
        {
            return;
        }

        try
        {
            File.WriteAllText(outputPath + ".ready", "1", Encoding.UTF8);
        }
        catch
        {
            // Bench I/O must never stop the desktop client.
        }
    }

#if PERF_BENCH
    public static string CreateDocumentCreatedScript() =>
        "window.__HUB_DESKTOP_PERF_BENCH=true;";
#else
    public static string CreateDocumentCreatedScript() => string.Empty;
#endif

    public static string CreateFrontendProbeScript() =>
        """
        (() => {
          const paints = performance.getEntriesByType('paint');
          const navigation = performance.getEntriesByType('navigation')[0];
          const resources = performance.getEntriesByType('resource');
          let transferred = 0;
          let decodedJs = 0;
          let requestCount = 0;
          let jsCount = 0;
          let cssCount = 0;
          let longTasks = 0;
          for (const resource of resources) {
            requestCount += 1;
            transferred += Number(resource.transferSize || 0);
            const initiator = String(resource.initiatorType || '');
            if (initiator === 'script') {
              jsCount += 1;
              decodedJs += Number(resource.decodedBodySize || 0);
            } else if (initiator === 'css' || initiator === 'link') {
              cssCount += 1;
            }
          }
          try {
            longTasks = performance.getEntriesByType('longtask')
              .filter((entry) => Number(entry.duration || 0) > 50).length;
          } catch {
            longTasks = -1;
          }
          const firstPaint = paints.find((entry) => entry.name === 'first-paint');
          const firstContentful = paints.find((entry) => entry.name === 'first-contentful-paint');
          const readMark = (name) => {
            const entry = performance.getEntriesByName(name, 'mark')[0];
            return entry ? Math.round(entry.startTime) : null;
          };
          return JSON.stringify({
            fp: firstPaint ? Math.round(firstPaint.startTime) : null,
            fcp: firstContentful ? Math.round(firstContentful.startTime) : null,
            nav_ms: navigation ? Math.round(navigation.duration) : null,
            request_count: requestCount,
            transferred_bytes: transferred,
            decoded_js: decodedJs,
            js_count: jsCount,
            css_count: cssCount,
            long_tasks: longTasks,
            long_task_ms: (() => {
              try {
                return Math.round(performance.getEntriesByType('longtask')
                  .filter((entry) => Number(entry.duration || 0) > 50)
                  .reduce((sum, entry) => sum + Number(entry.duration || 0), 0));
              } catch {
                return -1;
              }
            })(),
            script_duration_ms: Math.round(resources
              .filter((resource) => String(resource.initiatorType || '') === 'script')
              .reduce((sum, resource) => sum + Number(resource.duration || 0), 0)),
            js_start_ms: readMark('hub_js_start'),
            bridge_init_ms: readMark('hub_bridge_init_done'),
            react_mount_ms: readMark('hub_react_mount'),
            resources: resources.map((resource) => {
              let basename = String(resource.name || '');
              basename = basename.split('?')[0].split('#')[0];
              basename = basename.split('/').pop() || basename;
              return {
                resource_basename: basename,
                initiator_type: String(resource.initiatorType || ''),
                transfer_size: Number(resource.transferSize || 0),
                encoded_body_size: Number(resource.encodedBodySize || 0),
                decoded_body_size: Number(resource.decodedBodySize || 0),
                duration_ms: Math.round(Number(resource.duration || 0)),
                from_disk_cache: Number(resource.transferSize || 0) === 0
                  && Number(resource.decodedBodySize || 0) > 0,
                from_service_worker: Number(resource.workerStart || 0) > 0
              };
            })
          });
        })()
        """;

#if PERF_BENCH
    public static bool HasAutoLogin =>
        IsEnabled
        && !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(LoginUserEnvironmentVariable))
        && !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(LoginPasswordEnvironmentVariable));
#else
    public static bool HasAutoLogin => false;
#endif

    public static bool TryNormalizeNavigatePath(string? raw, out string path)
    {
        path = string.Empty;
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        var normalized = raw.Trim();
        if (!normalized.StartsWith('/'))
        {
            normalized = "/" + normalized;
        }

        if (normalized.Length > 1)
        {
            normalized = normalized.TrimEnd('/');
        }

        string[] allowed = ["/dashboard", "/chat", "/mail", "/tasks"];
        foreach (var candidate in allowed)
        {
            if (string.Equals(candidate, normalized, StringComparison.OrdinalIgnoreCase))
            {
                path = candidate;
                return true;
            }
        }

        return false;
    }

#if PERF_BENCH
    public static string? GetNavigatePath()
    {
        if (!IsEnabled)
        {
            return null;
        }

        return TryNormalizeNavigatePath(
            Environment.GetEnvironmentVariable(NavigatePathEnvironmentVariable),
            out var path)
            ? path
            : null;
    }

    public static string? CreateNavigateScript()
    {
        var path = GetNavigatePath();
        if (path is null)
        {
            return null;
        }

        var encoded = JsonSerializer.Serialize(path);
        return $"(function(){{var path={encoded};if(window.location.pathname!==path){{window.location.assign(path);}}return path;}})()";
    }

    public static string? CreatePostNavigateSmokeScript()
    {
        var path = GetNavigatePath();
        if (string.Equals(path, "/tasks", StringComparison.OrdinalIgnoreCase))
        {
            return """
                (() => {
                  const clickTab = () => {
                    const nodes = Array.from(document.querySelectorAll('button,[role="tab"],a'));
                    const tab = nodes.find((node) => /Аналитика/i.test(node.textContent || ''));
                    if (tab) tab.click();
                    return Boolean(tab);
                  };
                  return new Promise((resolve) => {
                    const started = Date.now();
                    let tab = false;
                    const timer = setInterval(() => {
                      tab = clickTab() || tab;
                      const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name || ''));
                      const loaded = resources.some((name) => /TasksAnalyticsCharts|recharts/i.test(name));
                      const visible = Boolean(document.querySelector('[data-testid="analytics-filters-panel"], .recharts-responsive-container, .recharts-wrapper'));
                      if (loaded || visible || Date.now() - started > 18000) {
                        clearInterval(timer);
                        resolve(JSON.stringify({
                          smoke: 'tasks-analytics',
                          tab,
                          loaded,
                          visible
                        }));
                      }
                    }, 250);
                  });
                })()
                """;
        }

        if (string.Equals(path, "/chat", StringComparison.OrdinalIgnoreCase))
        {
            return """
                (() => {
                  return new Promise((resolve) => {
                    const started = Date.now();
                    let button = false;
                    const timer = setInterval(() => {
                      const found = document.querySelector('[data-testid="chat-composer-emoji-button"]');
                      if (found) {
                        found.click();
                        button = true;
                      }
                      const resources = performance.getEntriesByType('resource').map((entry) => String(entry.name || ''));
                      const loaded = resources.some((name) => /emoji-picker/i.test(name));
                      const visible = Boolean(document.querySelector('[data-testid="chat-desktop-emoji-panel"]'));
                      if ((loaded && visible) || Date.now() - started > 18000) {
                        clearInterval(timer);
                        resolve(JSON.stringify({
                          smoke: 'emoji-picker',
                          button,
                          loaded,
                          visible
                        }));
                      }
                    }, 250);
                  });
                })()
                """;
        }

        return null;
    }

    public static string? CreatePasswordLoginScript()
    {
        if (!HasAutoLogin)
        {
            return null;
        }

        var username = JsonSerializer.Serialize(
            Environment.GetEnvironmentVariable(LoginUserEnvironmentVariable)!.Trim());
        var password = JsonSerializer.Serialize(
            Environment.GetEnvironmentVariable(LoginPasswordEnvironmentVariable));
        return $$"""
            (() => {
              const setValue = (el, value) => {
                if (!el) return false;
                const proto = el instanceof HTMLTextAreaElement
                  ? HTMLTextAreaElement.prototype
                  : HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, value);
                else el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              };
              const user = document.getElementById('login-username');
              const pass = document.getElementById('login-password');
              const form = document.querySelector('[data-testid="password-auth-form"]');
              if (!user || !pass || !form) return 'missing-form';
              setValue(user, {{username}});
              setValue(pass, {{password}});
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              return 'submitted';
            })()
            """;
    }

    public static string? CreateTotpLoginScript()
    {
        if (!HasAutoLogin)
        {
            return null;
        }

        var secret = Environment.GetEnvironmentVariable(TotpSecretEnvironmentVariable);
        if (string.IsNullOrWhiteSpace(secret))
        {
            return null;
        }

        var code = JsonSerializer.Serialize(GenerateTotp(secret));
        return $$"""
            (() => {
              const setValue = (el, value) => {
                if (!el) return false;
                const proto = HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) setter.call(el, value);
                else el.value = value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              };
              document.querySelectorAll('button').forEach((button) => {
                if ((button.textContent || '').includes('Ввести код вручную')) {
                  button.click();
                }
              });
              const field = document.getElementById('login-totp-verify');
              const form = document.querySelector('[data-testid="verify-fallback-form"]');
              if (!field || !form) return 'missing-totp';
              setValue(field, {{code}});
              if (typeof form.requestSubmit === 'function') form.requestSubmit();
              else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
              return 'submitted';
            })()
            """;
    }
#else
    public static string? GetNavigatePath() => null;

    public static string? CreateNavigateScript() => null;

    public static string? CreatePostNavigateSmokeScript() => null;

    public static string? CreatePasswordLoginScript() => null;

    public static string? CreateTotpLoginScript() => null;
#endif

    public static string CreateAuthStateScript() =>
        """
        (() => {
          if (document.getElementById('login-username')) return 'login';
          if (document.getElementById('login-totp-verify')) return 'totp';
          return 'app';
        })()
        """;

    public static string GenerateTotp(string secret, long? unixSeconds = null)
    {
        var key = DecodeBase32(secret);
        var timestep = (unixSeconds ?? DateTimeOffset.UtcNow.ToUnixTimeSeconds()) / 30;
        var payload = BitConverter.GetBytes(timestep);
        if (BitConverter.IsLittleEndian)
        {
            Array.Reverse(payload);
        }

        var hash = HMACSHA1.HashData(key, payload);
        var offset = hash[^1] & 0x0F;
        var binary = ((hash[offset] & 0x7F) << 24)
            | (hash[offset + 1] << 16)
            | (hash[offset + 2] << 8)
            | hash[offset + 3];
        return (binary % 1_000_000).ToString("D6", CultureInfo.InvariantCulture);
    }

    private static byte[] DecodeBase32(string secret)
    {
        const string alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        var normalized = secret.Trim().Replace(" ", "", StringComparison.Ordinal).Replace("=", "", StringComparison.Ordinal).ToUpperInvariant();
        var output = new List<byte>(normalized.Length);
        var buffer = 0;
        var bits = 0;
        foreach (var character in normalized)
        {
            var value = alphabet.IndexOf(character);
            if (value < 0)
            {
                continue;
            }

            buffer = (buffer << 5) | value;
            bits += 5;
            if (bits >= 8)
            {
                bits -= 8;
                output.Add((byte)((buffer >> bits) & 0xFF));
            }
        }

        return [.. output];
    }

#if PERF_BENCH
    private static bool TryGetFullPath(string variableName, out string path)
    {
        path = string.Empty;
        if (!IsEnabled)
        {
            return false;
        }

        var raw = Environment.GetEnvironmentVariable(variableName);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return false;
        }

        try
        {
            path = Path.GetFullPath(raw.Trim());
            return path.Length > 0;
        }
        catch (Exception exception) when (
            exception is ArgumentException
            or NotSupportedException
            or PathTooLongException)
        {
            path = string.Empty;
            return false;
        }
    }
#endif

    private static long ElapsedMilliseconds() =>
        (long)Math.Round(
            Stopwatch.GetElapsedTime(StartTimestamp).TotalMilliseconds,
            MidpointRounding.AwayFromZero);

    private static void WriteLine(string line)
    {
        if (!TryGetOutputPath(out var outputPath))
        {
            return;
        }

        try
        {
            lock (Sync)
            {
                var directory = Path.GetDirectoryName(outputPath);
                if (!string.IsNullOrWhiteSpace(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                File.AppendAllText(outputPath, line + Environment.NewLine, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            }
        }
        catch
        {
            // Bench I/O must never stop the desktop client.
        }
    }
}
