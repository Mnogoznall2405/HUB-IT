using System.Globalization;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Win32;
using Hub.Agent.Core.Diagnostics;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Scan;

public sealed record ScanRunStats(
    int Scanned,
    int Queued,
    int Skipped,
    int AnalysisIncomplete,
    int Incidents,
    string Phase);

/// <summary>
/// DLP scan agent (parity with scan_agent/agent.py): task polling, local strict
/// patterns for text files, document upload for PDF/Office/images, durable outbox.
/// Text extraction/scoring stays on the server; the agent only finds candidates.
/// </summary>
public sealed class ScanAgentService : IDisposable
{
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".csv", ".log", ".json", ".xml", ".ini", ".conf", ".md", ".rtf",
    };

    private static readonly HashSet<string> ImageExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp",
    };

    private static readonly HashSet<string> OfficeExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".doc", ".docx", ".odt", ".xls", ".xlsx", ".ods", ".ppt", ".pptx", ".odp",
    };

    private const string AnalysisVersion = "scan-ocr3-text10-rus-v8";
    private const int MaxMatches = 100;

    private readonly AgentLog _log;
    private readonly string _serverBase;
    private readonly string _apiKey;
    private readonly int _pollSeconds;
    private readonly int _jitterSeconds;
    private readonly long _maxFileBytes;
    private readonly string _agentId;
    private readonly string _patternsFile;
    private readonly string _extraRoots;
    private readonly string _outboxPending;
    private readonly string _outboxDead;
    private readonly string _stateFile;
    private readonly string _statusFile;
    private readonly string _hostname;

    private readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(120) };
    private readonly HttpClient _downloadHttp = new() { Timeout = Timeout.InfiniteTimeSpan };
    private readonly Dictionary<string, (long Size, long Mtime)> _state = new(StringComparer.OrdinalIgnoreCase);
    private ScanPatternEngine? _engine;
    private CancellationTokenSource? _cancellation;
    private Task? _loop;
    private long? _lastIngestOkAt;
    private string _lastError = string.Empty;

    public ScanAgentService(AgentPaths paths, AgentLog log)
    {
        _log = log;
        Enabled = Text.Truthy(Environment.GetEnvironmentVariable("ITINV_SCAN_ENABLED"), true);
        _serverBase = (Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_SERVER_BASE")) is { Length: > 0 } baseUrl
            ? baseUrl
            : "https://hubit.zsgp.ru/api/v1/scan").TrimEnd('/');
        _apiKey = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_API_KEY"));
        _pollSeconds = Math.Max(30, Text.ToInt(Environment.GetEnvironmentVariable("SCAN_AGENT_POLL_INTERVAL_SEC"), 600));
        _jitterSeconds = Math.Clamp(Text.ToInt(Environment.GetEnvironmentVariable("SCAN_AGENT_POLL_JITTER_SEC"), 120), 0, 300);
        _maxFileBytes = Math.Max(1, Text.ToInt(Environment.GetEnvironmentVariable("SCAN_AGENT_MAX_FILE_MB"), 50)) * 1024L * 1024L;
        _extraRoots = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_EXTRA_ROOTS"));
        _hostname = Environment.MachineName;
        _agentId = _hostname;

        var patterns = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_PATTERNS_FILE"));
        _patternsFile = patterns.Length > 0
            ? (Path.IsPathFullyQualified(patterns) ? patterns : Path.GetFullPath(patterns))
            : Path.Combine(AppContext.BaseDirectory, "patterns_strict.yaml");

        _outboxPending = Path.Combine(paths.ScanAgentRoot, "outbox", "pending");
        _outboxDead = Path.Combine(paths.ScanAgentRoot, "outbox", "dead_letter");
        _stateFile = Path.Combine(paths.ScanAgentRoot, "scan_agent_state.json");
        _statusFile = Path.Combine(paths.ScanAgentRoot, "scan_agent_status.json");

        if (Enabled)
        {
            Directory.CreateDirectory(_outboxPending);
            Directory.CreateDirectory(_outboxDead);
            LoadState();
        }
    }

    public bool Enabled { get; }

    public bool IsRunning => _loop is { IsCompleted: false };

    public void Start()
    {
        if (!Enabled || _apiKey.Length == 0 || _loop is not null)
        {
            if (Enabled && _apiKey.Length == 0)
            {
                _log.Error("Scan sidecar is disabled: SCAN_AGENT_API_KEY is not configured");
            }

            return;
        }

        _engine = ScanPatternEngine.Load(_patternsFile, _log);
        _cancellation = new CancellationTokenSource();
        _loop = Task.Run(() => RunAsync(_cancellation.Token));
    }

    public void Stop()
    {
        try
        {
            _cancellation?.Cancel();
            _loop?.Wait(TimeSpan.FromSeconds(5));
        }
        catch (Exception)
        {
            // best effort
        }
        finally
        {
            _cancellation?.Dispose();
            _cancellation = null;
            _loop = null;
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        _log.Info($"Scan sidecar started: server={_serverBase} poll={_pollSeconds}s patterns={_patternsFile}");
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await PollTasksAsync(cancellationToken).ConfigureAwait(false);
                await DrainOutboxAsync(cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _lastError = $"SCAN_LOOP_ERROR:{ex.GetType().Name}";
                _log.Exception("Scan sidecar cycle failed", ex);
            }

            var delay = _pollSeconds + Random.Shared.Next(0, _jitterSeconds + 1);
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(delay), cancellationToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PollTasksAsync(CancellationToken cancellationToken)
    {
        if (_engine is null)
        {
            return;
        }

        var url = $"{_serverBase}/tasks/poll?agent_id={Uri.EscapeDataString(_agentId)}&limit=10";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-API-Key", _apiKey);

        JsonNode? data;
        try
        {
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if ((int)response.StatusCode >= 300)
            {
                _log.Warn($"Task poll failed status={(int)response.StatusCode}");
                return;
            }

            var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
            data = body.Length == 0 ? null : JsonNode.Parse(body);
        }
        catch (Exception ex)
        {
            _log.Warn($"Task poll error: {ex.Message}");
            return;
        }

        if (data?["tasks"] is not JsonArray tasks)
        {
            return;
        }

        foreach (var node in tasks.OfType<JsonObject>())
        {
            var taskId = Text.Sanitize(node["task_id"]?.ToString());
            var command = Text.Sanitize(node["command"]?.ToString()).ToLowerInvariant();
            var payload = node["payload"] as JsonObject;
            if (taskId.Length == 0)
            {
                continue;
            }

            try
            {
                if (command == "ping")
                {
                    await TaskResultAsync(taskId, "completed", new JsonObject { ["pong"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() }, string.Empty, cancellationToken)
                        .ConfigureAwait(false);
                    continue;
                }

                if (command == "scan_now")
                {
                    var force = payload?["force_rescan"] is JsonValue forceValue && forceValue.TryGetValue<bool>(out var parsedForce) && parsedForce;
                    var patternIds = NormalizeStringSet(payload?["agent_pattern_ids"]);
                    var extensions = NormalizeExtensions(payload?["scan_extensions"]);
                    var stats = ScanOnce(taskId, force, patternIds, extensions);
                    var status = stats.Phase == "failed" ? "failed" : "completed";
                    await TaskResultAsync(taskId, status, StatsNode(stats), string.Empty, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                if (command == "self_update")
                {
                    await TaskResultAsync(taskId, "acknowledged", new JsonObject
                    {
                        ["phase"] = "downloading",
                        ["expected_version"] = Text.Sanitize(payload?["expected_version"]?.ToString()),
                        ["current_version"] = AgentVersion.Value,
                        ["verified"] = false,
                        ["pending_update"] = true,
                    }, string.Empty, cancellationToken).ConfigureAwait(false);

                    try
                    {
                        var result = await RunSelfUpdateAsync(payload, cancellationToken).ConfigureAwait(false);
                        await TaskResultAsync(taskId, "acknowledged", result, string.Empty, cancellationToken).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _log.Exception($"Self-update failed task_id={taskId}", ex);
                        await TaskResultAsync(taskId, "failed", null, ex.Message, cancellationToken).ConfigureAwait(false);
                    }

                    continue;
                }

                if (command == "install_package")
                {
                    await TaskResultAsync(taskId, "acknowledged", new JsonObject
                    {
                        ["phase"] = "installing",
                        ["package_id"] = Text.Sanitize(payload?["package_id"]?.ToString()),
                    }, string.Empty, cancellationToken).ConfigureAwait(false);

                    try
                    {
                        var result = await RunInstallPackageAsync(payload, cancellationToken).ConfigureAwait(false);
                        var failed = Text.Sanitize(result["phase"]?.ToString()) == "failed";
                        await TaskResultAsync(taskId, failed ? "failed" : "completed", result, failed ? "installer_failed" : string.Empty, cancellationToken)
                            .ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        _log.Exception($"Install package failed task_id={taskId}", ex);
                        await TaskResultAsync(taskId, "failed", null, ex.Message, cancellationToken).ConfigureAwait(false);
                    }

                    continue;
                }

                if (command == "disable_message_probes")
                {
                    await TaskResultAsync(taskId, "acknowledged", new JsonObject { ["phase"] = "disabling" }, string.Empty, cancellationToken)
                        .ConfigureAwait(false);
                    var result = DisableMessageProbes();
                    await TaskResultAsync(taskId, "completed", result, string.Empty, cancellationToken).ConfigureAwait(false);
                    continue;
                }

                await TaskResultAsync(taskId, "failed", null, $"Unsupported command: {command}", cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _log.Exception($"Task {taskId} failed", ex);
                await TaskResultAsync(taskId, "failed", null, ex.Message, cancellationToken).ConfigureAwait(false);
            }
        }
    }

    public ScanRunStats ScanOnce(
        string? taskId,
        bool forceRescan,
        HashSet<string>? patternIds,
        HashSet<string>? scanExtensions)
    {
        if (_engine is null)
        {
            return new ScanRunStats(0, 0, 0, 0, 0, "failed");
        }

        var stats = new ScanRunStats(0, 0, 0, 0, 0, "completed");
        var scanned = 0;
        var queued = 0;
        var skipped = 0;
        var incomplete = 0;

        foreach (var root in TargetRoots())
        {
            IEnumerable<string> files;
            try
            {
                files = Directory.EnumerateFiles(root, "*", new EnumerationOptions
                {
                    RecurseSubdirectories = true,
                    IgnoreInaccessible = true,
                    AttributesToSkip = FileAttributes.ReparsePoint,
                });
            }
            catch (Exception)
            {
                continue;
            }

            foreach (var path in files)
            {
                if (scanned >= 20_000)
                {
                    break;
                }

                var extension = Path.GetExtension(path).ToLowerInvariant();
                if (!TextExtensions.Contains(extension) && extension != ".pdf"
                    && !ImageExtensions.Contains(extension) && !OfficeExtensions.Contains(extension))
                {
                    skipped++;
                    continue;
                }

                if (scanExtensions is not null && !scanExtensions.Contains(extension))
                {
                    skipped++;
                    continue;
                }

                FileInfo info;
                try
                {
                    info = new FileInfo(path);
                    if (!info.Exists || info.Length <= 0 || info.Length > _maxFileBytes)
                    {
                        skipped++;
                        continue;
                    }
                }
                catch (Exception)
                {
                    skipped++;
                    continue;
                }

                var mtime = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeSeconds();
                if (!forceRescan && _state.TryGetValue(path, out var previous)
                    && previous.Size == info.Length && previous.Mtime == mtime)
                {
                    skipped++;
                    continue;
                }

                scanned++;
                try
                {
                    var payload = BuildPayload(path, info, extension, patternIds, taskId);
                    if (payload is null)
                    {
                        skipped++;
                        continue;
                    }

                    var kind = payload.Value.Kind;
                    Enqueue(kind, payload.Value.Payload);
                    _state[path] = (info.Length, mtime);
                    queued++;
                }
                catch (Exception ex)
                {
                    incomplete++;
                    _log.Warn($"Scan file failed {path}: {ex.Message}");
                }
            }
        }

        SaveState();
        DrainOutboxAsync(CancellationToken.None).GetAwaiter().GetResult();
        WriteStatus();

        return stats with
        {
            Scanned = scanned,
            Queued = queued,
            Skipped = skipped,
            AnalysisIncomplete = incomplete,
            Phase = "completed",
        };
    }

    private (string Kind, JsonObject Payload)? BuildPayload(
        string path,
        FileInfo info,
        string extension,
        HashSet<string>? patternIds,
        string? taskId)
    {
        var hash = TryHash(path);
        var matches = new List<Dictionary<string, object?>>();
        var excerpt = string.Empty;
        var outcome = new List<Dictionary<string, object?>>();
        var sourceKind = "metadata";
        var documentB64 = string.Empty;
        var pdfSliceB64 = string.Empty;
        var pagesInSlice = 0;
        var incompleteReason = string.Empty;

        if (extension == ".pdf")
        {
            var pdf = PdfWorker.AnalyzeViaWorker(path, _log);
            if (pdf.FileHash.Length > 0)
            {
                hash = pdf.FileHash;
            }

            matches = _engine!.Scan(pdf.Text, patternIds);
            excerpt = pdf.Text.Length > 4000 ? pdf.Text[..4000] : pdf.Text;
            pagesInSlice = pdf.Pages;
            pdfSliceB64 = pdf.SliceB64;

            outcome.Add(new Dictionary<string, object?>
            {
                ["method"] = "text_layer",
                ["outcome"] = pdf.Text.Length > 0 ? "text_extracted" : "no_usable_text",
            });

            if (pdfSliceB64.Length == 0 || pagesInSlice <= 0)
            {
                sourceKind = "analysis_incomplete";
                incompleteReason = pdf.Reason.Length > 0 ? pdf.Reason : "pdf_slice_creation_failed";
                outcome.Add(new Dictionary<string, object?>
                {
                    ["method"] = "pdf_slice",
                    ["outcome"] = "failed",
                    ["reason"] = incompleteReason,
                });
            }
            else
            {
                sourceKind = "pdf_slice";
                outcome.Add(new Dictionary<string, object?>
                {
                    ["method"] = "pdf_slice",
                    ["outcome"] = "created",
                    ["pages"] = pagesInSlice,
                });
            }
        }
        else if (TextExtensions.Contains(extension))
        {
            var (textMatches, textExcerpt) = ScanTextFile(path, _engine!, patternIds);
            matches = textMatches;
            excerpt = textExcerpt;
            sourceKind = "text";
            outcome.Add(new Dictionary<string, object?> { ["method"] = "stream_text", ["outcome"] = "complete" });

            if (matches.Count == 0)
            {
                return null;
            }
        }
        else
        {
            if (info.Length > Math.Min(_maxFileBytes, 32L * 1024 * 1024))
            {
                sourceKind = "analysis_incomplete";
                incompleteReason = "document_too_large";
                outcome.Add(new Dictionary<string, object?> { ["method"] = "document_upload", ["outcome"] = "too_large" });
            }
            else
            {
                documentB64 = Convert.ToBase64String(File.ReadAllBytes(path));
                sourceKind = ImageExtensions.Contains(extension) ? "image" : "office";
                outcome.Add(new Dictionary<string, object?> { ["method"] = "document_upload", ["outcome"] = "prepared" });
            }
        }

        var payload = new JsonObject
        {
            ["agent_id"] = _agentId,
            ["hostname"] = _hostname,
            ["branch"] = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_BRANCH")),
            ["user_login"] = UserFromPath(path),
            ["user_full_name"] = string.Empty,
            ["file_path"] = path,
            ["file_name"] = Path.GetFileName(path),
            ["file_hash"] = hash,
            ["file_size"] = info.Length,
            ["source_kind"] = sourceKind,
            ["event_id"] = Guid.NewGuid().ToString("N"),
            ["scan_task_id"] = taskId ?? string.Empty,
            ["text_excerpt"] = excerpt,
            ["document_b64"] = documentB64,
            ["pdf_slice_b64"] = pdfSliceB64,
            ["local_pattern_hits"] = JsonSerializer.SerializeToNode(matches),
            ["metadata"] = new JsonObject
            {
                ["mtime"] = new DateTimeOffset(info.LastWriteTimeUtc).ToUnixTimeSeconds(),
                ["ext"] = extension,
                ["analysis_version"] = AnalysisVersion,
                ["analysis_scope"] = patternIds is null ? "all" : "patterns",
                ["agent_pattern_ids"] = patternIds is null ? null : JsonSerializer.SerializeToNode(patternIds.OrderBy(id => id)),
                ["ocr_page_limit"] = PdfWorker.OcrPageLimit,
                ["text_page_limit"] = PdfWorker.TextPageLimit,
                ["pages_in_slice"] = pagesInSlice,
                ["extraction_outcomes"] = JsonSerializer.SerializeToNode(outcome),
                ["analysis_incomplete_reason"] = incompleteReason,
            },
        };

        return ("json", payload);
    }

    private void Enqueue(string kind, JsonObject payload)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var item = new JsonObject
        {
            ["kind"] = kind,
            ["payload"] = payload.DeepClone(),
            ["attempts"] = 0,
            ["next_attempt_at"] = 0,
            ["created_at"] = now,
        };
        var path = Path.Combine(_outboxPending, $"{now:D10}_{Guid.NewGuid():N}.json");
        AtomicFile.WriteAllText(path, item.ToJsonString());
    }

    private async Task DrainOutboxAsync(CancellationToken cancellationToken)
    {
        if (_apiKey.Length == 0 || !Directory.Exists(_outboxPending))
        {
            return;
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var path in Directory.EnumerateFiles(_outboxPending, "*.json")
                     .OrderBy(path => Path.GetFileName(path), StringComparer.Ordinal)
                     .Take(20)
                     .ToList())
        {
            JsonObject? item;
            try
            {
                item = JsonNode.Parse(File.ReadAllText(path)) as JsonObject;
            }
            catch (Exception)
            {
                MoveToDead(path);
                continue;
            }

            if (item is null || item["payload"] is not JsonObject payload)
            {
                MoveToDead(path);
                continue;
            }

            if (Text.ToLong(item["next_attempt_at"], 0) > now)
            {
                continue;
            }

            var success = await SendPayloadAsync(payload, cancellationToken).ConfigureAwait(false);
            if (success)
            {
                _lastIngestOkAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                _lastError = string.Empty;
                TryDelete(path);
                WriteStatus();
                continue;
            }

            var attempts = (int)Text.ToLong(item["attempts"], 0) + 1;
            if (attempts >= 8)
            {
                MoveToDead(path);
                continue;
            }

            item["attempts"] = attempts;
            item["next_attempt_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() + Math.Min(3600, 30 * (1 << Math.Min(attempts, 6)));
            AtomicFile.WriteAllText(path, item.ToJsonString());
        }
    }

    private async Task<bool> SendPayloadAsync(JsonObject payload, CancellationToken cancellationToken)
    {
        try
        {
            var document = payload["document_b64"]?.ToString() ?? string.Empty;
            var pdfSlice = payload["pdf_slice_b64"]?.ToString() ?? string.Empty;
            HttpResponseMessage response;
            if (pdfSlice.Length > 0)
            {
                var metadata = payload.DeepClone().AsObject();
                metadata.Remove("pdf_slice_b64");
                using var content = new MultipartFormDataContent();
                content.Add(new StringContent(metadata.ToJsonString(), Encoding.UTF8), "metadata_json");
                var bytes = Convert.FromBase64String(pdfSlice);
                var file = new ByteArrayContent(bytes);
                file.Headers.ContentType = new MediaTypeHeaderValue("application/pdf");
                content.Add(file, "pdf_slice", Path.GetFileName(Text.Sanitize(payload["file_name"]?.ToString())));

                using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverBase}/ingest/pdf-slice") { Content = content };
                request.Headers.Add("X-API-Key", _apiKey);
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            else if (document.Length > 0)
            {
                var metadata = payload.DeepClone().AsObject();
                metadata.Remove("document_b64");
                using var content = new MultipartFormDataContent();
                content.Add(new StringContent(metadata.ToJsonString(), Encoding.UTF8), "metadata_json");
                var bytes = Convert.FromBase64String(document);
                var file = new ByteArrayContent(bytes);
                file.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
                content.Add(file, "document", Path.GetFileName(Text.Sanitize(payload["file_name"]?.ToString())));

                using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverBase}/ingest/document") { Content = content };
                request.Headers.Add("X-API-Key", _apiKey);
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }
            else
            {
                using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverBase}/ingest")
                {
                    Content = new StringContent(payload.ToJsonString(), Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("X-API-Key", _apiKey);
                response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            }

            using (response)
            {
                var status = (int)response.StatusCode;
                if (status is >= 200 and < 300)
                {
                    var body = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                    if (body.Length == 0 || (JsonNode.Parse(body) as JsonObject)?["success"]?.GetValue<bool>() is null or true)
                    {
                        return true;
                    }
                }

                _lastError = $"INGEST_HTTP_{status}";
                if (status is 401 or 403)
                {
                    _log.Error("Scan ingest rejected the API key");
                }

                return false;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _lastError = $"INGEST_ERR:{ex.GetType().Name}";
            _log.Warn($"Scan ingest failed: {ex.Message}");
            return false;
        }
    }

    private async Task<JsonObject> RunSelfUpdateAsync(JsonObject? payload, CancellationToken cancellationToken)
    {
        var url = Text.Sanitize(payload?["msi_url"]?.ToString());
        var sha = Text.Sanitize(payload?["msi_sha256"]?.ToString()).ToLowerInvariant();
        var expectedVersion = Text.Sanitize(payload?["expected_version"]?.ToString());
        if (url.Length == 0)
        {
            throw new ArgumentException("self_update payload missing msi_url");
        }

        if (sha.Length != 64 || sha.Any(symbol => !Uri.IsHexDigit(symbol)))
        {
            throw new ArgumentException("self_update payload missing valid msi_sha256");
        }

        var directory = Path.Combine(Path.GetDirectoryName(_statusFile) ?? Path.GetTempPath(), "updates");
        Directory.CreateDirectory(directory);
        var name = SanitizeFileName(payload?["filename"]?.ToString(), "HUB-IT-Agent-update.msi");
        if (!name.EndsWith(".msi", StringComparison.OrdinalIgnoreCase))
        {
            name += ".msi";
        }

        var path = Path.Combine(directory, name);
        _log.Info($"Self-update download start url={url} expected_version={(expectedVersion.Length > 0 ? expectedVersion : "?")} current={AgentVersion.Value}");
        await DownloadAsync(url, path, cancellationToken).ConfigureAwait(false);

        var actual = HashFile(path);
        if (!string.Equals(actual, sha, StringComparison.OrdinalIgnoreCase))
        {
            TryDelete(path);
            throw new InvalidOperationException($"Package SHA256 mismatch: expected={sha} actual={actual}");
        }

        var stamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        var logPath = Path.Combine(directory, $"msiexec-{stamp}.log");
        var exitCode = RunInstaller(
            "msiexec.exe",
            new[] { "/i", path, "/qn", "/norestart", "/l*v", logPath },
            cancellationToken);

        _log.Info($"Self-update installer finished exit={exitCode} path={path}");
        return new JsonObject
        {
            ["phase"] = exitCode is 0 or 1641 or 3010 ? "installed" : "failed",
            ["installer_launched"] = true,
            ["exit_code"] = exitCode,
            ["reboot_required"] = exitCode is 1641 or 3010,
            ["expected_version"] = expectedVersion,
            ["previous_version"] = AgentVersion.Value,
            ["verified"] = false,
            ["msi_sha256"] = actual,
            ["msi_path"] = path,
            ["log_path"] = logPath,
        };
    }

    private async Task<JsonObject> RunInstallPackageAsync(JsonObject? payload, CancellationToken cancellationToken)
    {
        var packageId = Text.Sanitize(payload?["package_id"]?.ToString()).ToLowerInvariant();
        var relativeUrl = Text.Sanitize(payload?["url"]?.ToString());
        var sha = Text.Sanitize(payload?["sha256"]?.ToString()).ToLowerInvariant();
        var kind = Text.Sanitize(payload?["kind"]?.ToString()).ToLowerInvariant();
        var version = Text.Sanitize(payload?["version"]?.ToString());

        if (!System.Text.RegularExpressions.Regex.IsMatch(packageId, "^[a-z0-9][a-z0-9._-]{0,63}$"))
        {
            throw new ArgumentException("install_package: invalid package_id");
        }

        if (!relativeUrl.StartsWith("install-package?", StringComparison.Ordinal)
            || relativeUrl.Contains("://", StringComparison.Ordinal)
            || relativeUrl.Contains('\\'))
        {
            throw new ArgumentException("install_package: url must be a server-relative install-package path");
        }

        if (sha.Length != 64 || sha.Any(symbol => !Uri.IsHexDigit(symbol)))
        {
            throw new ArgumentException("install_package: missing valid sha256");
        }

        if (kind is not ("msi" or "exe"))
        {
            throw new ArgumentException("install_package: unsupported kind");
        }

        var directory = Path.Combine(Path.GetDirectoryName(_statusFile) ?? Path.GetTempPath(), "packages");
        Directory.CreateDirectory(directory);
        var name = SanitizeFileName(payload?["filename"]?.ToString(), packageId + (kind == "msi" ? ".msi" : ".exe"));
        var path = Path.Combine(directory, name);
        var absoluteUrl = $"{_serverBase}/{relativeUrl}";
        await DownloadAsync(absoluteUrl, path, cancellationToken).ConfigureAwait(false);

        var actual = HashFile(path);
        if (!string.Equals(actual, sha, StringComparison.OrdinalIgnoreCase))
        {
            TryDelete(path);
            throw new InvalidOperationException($"Package SHA256 mismatch: expected={sha} actual={actual}");
        }

        var customArgs = payload?["args"] is JsonArray argsArray
            ? argsArray.Select(item => Text.Sanitize(item?.ToString())).Where(item => item.Length > 0).ToArray()
            : Array.Empty<string>();

        var stamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        int exitCode;
        if (kind == "msi")
        {
            var logPath = Path.Combine(directory, $"install-{stamp}.log");
            var msiArgs = new List<string> { "/i", path, "/qn", "/norestart", "/l*v", logPath };
            msiArgs.AddRange(customArgs);
            exitCode = RunInstaller("msiexec.exe", msiArgs, cancellationToken);
        }
        else
        {
            exitCode = RunInstaller(path, customArgs, cancellationToken);
        }

        _log.Info($"Install package done id={packageId} kind={kind} exit={exitCode}");
        return new JsonObject
        {
            ["phase"] = exitCode is 0 or 1641 or 3010 ? "completed" : "failed",
            ["package_id"] = packageId,
            ["kind"] = kind,
            ["expected_version"] = version,
            ["exit_code"] = exitCode,
            ["reboot_required"] = exitCode is 1641 or 3010,
            ["installed_path"] = path,
        };
    }

    private JsonObject DisableMessageProbes()
    {
        var stoppedTasks = new JsonArray();
        foreach (var taskName in new[] { "HUB-IT Telegram Probe", "HUB-IT MAX Probe" })
        {
            try
            {
                var result = ProcessRunner.RunResult("schtasks.exe", new[] { "/Delete", "/TN", taskName, "/F" }, 60);
                if (result.ExitCode == 0)
                {
                    stoppedTasks.Add(taskName);
                }
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to stop scheduled task {taskName}: {ex.Message}");
            }
        }

        var stoppedProcesses = new JsonArray();
        foreach (var processName in new[] { "ITInventTelegramProbe", "ITInventMaxProbe" })
        {
            try
            {
                foreach (var process in System.Diagnostics.Process.GetProcessesByName(processName))
                {
                    try
                    {
                        process.Kill(entireProcessTree: true);
                        stoppedProcesses.Add(process.Id);
                    }
                    catch (Exception)
                    {
                        // process already gone
                    }
                    finally
                    {
                        process.Dispose();
                    }
                }
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to stop probe process {processName}: {ex.Message}");
            }
        }

        var marker = Path.Combine(Path.GetDirectoryName(_statusFile) ?? Path.GetTempPath(), "message_probes_disabled.json");
        try
        {
            AtomicFile.WriteAllText(marker, new JsonObject
            {
                ["disabled_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                ["telegram"] = true,
                ["max"] = true,
            }.ToJsonString());
        }
        catch (Exception ex)
        {
            _log.Warn($"Failed to persist probe-disabled marker: {ex.Message}");
        }

        _log.Info($"Message probes disabled: tasks={stoppedTasks.Count} processes={stoppedProcesses.Count}");
        return new JsonObject
        {
            ["phase"] = "disabled",
            ["stopped_tasks"] = stoppedTasks,
            ["stopped_pids"] = stoppedProcesses,
            ["persisted"] = File.Exists(marker),
        };
    }

    private async Task DownloadAsync(string url, string destination, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https"))
        {
            throw new ArgumentException($"Unsupported download URL: {url}");
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromMinutes(30));

        using var response = await _downloadHttp.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, timeout.Token).ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
        const long maxDownloadBytes = 512L * 1024 * 1024;
        if (response.Content.Headers.ContentLength is > maxDownloadBytes)
        {
            throw new InvalidOperationException("Download exceeds the 512 MB agent limit");
        }

        await using var source = await response.Content.ReadAsStreamAsync(timeout.Token).ConfigureAwait(false);
        await using var target = File.Create(destination);
        var buffer = new byte[81920];
        long total = 0;
        while (true)
        {
            var read = await source.ReadAsync(buffer, timeout.Token).ConfigureAwait(false);
            if (read <= 0)
            {
                break;
            }

            total += read;
            if (total > maxDownloadBytes)
            {
                target.Close();
                TryDelete(destination);
                throw new InvalidOperationException("Download exceeds the 512 MB agent limit");
            }

            await target.WriteAsync(buffer.AsMemory(0, read), timeout.Token).ConfigureAwait(false);
        }
    }

    private static string HashFile(string path)
    {
        using var stream = File.OpenRead(path);
        using var sha = SHA256.Create();
        return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
    }

    private int RunInstaller(string fileName, IEnumerable<string> arguments, CancellationToken cancellationToken)
    {
        var info = new System.Diagnostics.ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        using var process = System.Diagnostics.Process.Start(info)
                            ?? throw new InvalidOperationException($"Failed to start {fileName}");
        var deadline = DateTime.UtcNow.AddMinutes(15);
        while (!process.WaitForExit(1000))
        {
            if (cancellationToken.IsCancellationRequested)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception)
                {
                    // ignore
                }

                throw new OperationCanceledException(cancellationToken);
            }

            if (DateTime.UtcNow > deadline)
            {
                try
                {
                    process.Kill(entireProcessTree: true);
                }
                catch (Exception)
                {
                    // ignore
                }

                throw new TimeoutException($"{fileName} did not finish in 15 minutes");
            }
        }

        return process.ExitCode;
    }

    private static string SanitizeFileName(string? raw, string fallback)
    {
        var value = Text.Sanitize(raw);
        if (value.Length == 0)
        {
            value = fallback;
        }

        var builder = new StringBuilder(value.Length);
        foreach (var symbol in value)
        {
            builder.Append(char.IsLetterOrDigit(symbol) || symbol is '.' or '_' or '-' ? symbol : '_');
        }

        var cleaned = builder.ToString().Trim('.', ' ');
        if (cleaned.Length == 0)
        {
            cleaned = fallback;
        }

        return cleaned.Length > 120 ? cleaned[..120] : cleaned;
    }

    private async Task TaskResultAsync(string taskId, string status, JsonObject? result, string error, CancellationToken cancellationToken)
    {
        try
        {
            var body = new JsonObject
            {
                ["agent_id"] = _agentId,
                ["status"] = status,
                ["result"] = result,
                ["error_text"] = error,
            };
            using var request = new HttpRequestMessage(HttpMethod.Post, $"{_serverBase}/tasks/{Uri.EscapeDataString(taskId)}/result")
            {
                Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-API-Key", _apiKey);
            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            if ((int)response.StatusCode >= 300)
            {
                _log.Warn($"Task result failed task={taskId} status={(int)response.StatusCode}");
            }
        }
        catch (Exception ex)
        {
            _log.Warn($"Task result error task={taskId}: {ex.Message}");
        }
    }

    private static JsonObject StatsNode(ScanRunStats stats) => new()
    {
        ["phase"] = stats.Phase,
        ["scanned"] = stats.Scanned,
        ["queued"] = stats.Queued,
        ["skipped"] = stats.Skipped,
        ["analysis_incomplete"] = stats.AnalysisIncomplete,
        ["incidents"] = stats.Incidents,
    };

    private IEnumerable<string> TargetRoots()
    {
        var overrides = Text.Sanitize(Environment.GetEnvironmentVariable("SCAN_AGENT_ROOTS"));
        if (overrides.Length > 0)
        {
            return Text.Dedupe(overrides.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                .Where(Directory.Exists);
        }

        var roots = new List<string>();
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders");
            foreach (var name in new[] { "Desktop", "Personal", "{374DE290-123F-4565-9164-39C4925E467B}" })
            {
                var raw = Text.Sanitize(key?.GetValue(name));
                if (raw.Length > 0)
                {
                    roots.Add(Environment.ExpandEnvironmentVariables(raw));
                }
            }
        }
        catch (Exception)
        {
            // current user shell folders unavailable
        }

        var usersRoot = Path.Combine(Environment.GetEnvironmentVariable("SystemDrive") ?? "C:", "Users");
        var skippedUsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "all users", "default", "default user", "public", "defaultapppool",
        };

        if (Directory.Exists(usersRoot))
        {
            foreach (var userDir in Directory.EnumerateDirectories(usersRoot))
            {
                if (skippedUsers.Contains(Path.GetFileName(userDir)))
                {
                    continue;
                }

                foreach (var sub in new[] { "Desktop", "Documents", "Downloads" })
                {
                    var candidate = Path.Combine(userDir, sub);
                    if (Directory.Exists(candidate))
                    {
                        roots.Add(candidate);
                    }
                }

                try
                {
                    roots.AddRange(Directory.EnumerateDirectories(userDir, "OneDrive*"));
                }
                catch (Exception)
                {
                    // ignore
                }
            }
        }

        foreach (var name in new[] { "OneDrive", "OneDriveConsumer", "OneDriveCommercial" })
        {
            var value = Text.Sanitize(Environment.GetEnvironmentVariable(name));
            if (value.Length > 0)
            {
                roots.Add(value);
            }
        }

        foreach (var part in _extraRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            roots.Add(part);
        }

        return Text.Dedupe(roots).Where(Directory.Exists);
    }

    public static (List<Dictionary<string, object?>> Matches, string Excerpt) ScanTextFile(
        string path,
        ScanPatternEngine engine,
        HashSet<string>? patternIds)
    {
        const int chunkChars = 1_000_000;
        const int overlapChars = 1_000;
        const int maxMatches = 100;

        var matches = new List<Dictionary<string, object?>>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var excerpt = string.Empty;

        Encoding encoding;
        try
        {
            var probe = new byte[64 * 1024];
            using var stream = File.OpenRead(path);
            var read = stream.Read(probe, 0, probe.Length);
            encoding = IsValidUtf8(probe, read) ? new UTF8Encoding(false) : Encoding.GetEncoding(1251);
        }
        catch (Exception)
        {
            encoding = Encoding.UTF8;
        }

        try
        {
            using var reader = new StreamReader(path, encoding, detectEncodingFromByteOrderMarks: true, bufferSize: 64 * 1024);
            var buffer = new char[chunkChars];
            var carry = string.Empty;
            while (true)
            {
                var read = reader.ReadBlock(buffer, 0, buffer.Length);
                if (read <= 0)
                {
                    break;
                }

                var chunk = carry + new string(buffer, 0, read);
                if (excerpt.Length < 4000)
                {
                    excerpt = chunk.Length > 4000 ? chunk[..4000] : chunk;
                }

                foreach (var hit in engine.Scan(chunk, patternIds))
                {
                    var key = $"{Text.Sanitize(hit.GetValueOrDefault("pattern"))}|" +
                              $"{Text.Sanitize(hit.GetValueOrDefault("value"))}|" +
                              $"{Text.Sanitize(hit.GetValueOrDefault("snippet"))}";
                    if (seen.Add(key))
                    {
                        matches.Add(hit);
                    }
                }

                if (matches.Count >= maxMatches)
                {
                    break;
                }

                carry = chunk.Length > overlapChars ? chunk[^overlapChars..] : chunk;
            }
        }
        catch (Exception)
        {
            // return what was collected before the read error
        }

        return (matches.Take(maxMatches).ToList(), excerpt);
    }

    private static bool IsValidUtf8(byte[] buffer, int length)
    {
        try
        {
            new UTF8Encoding(false, throwOnInvalidBytes: true).GetString(buffer, 0, length);
            return true;
        }
        catch (Exception)
        {
            return false;
        }
    }

    private string TryHash(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            using var sha = SHA256.Create();
            return Convert.ToHexString(sha.ComputeHash(stream)).ToLowerInvariant();
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    private static string UserFromPath(string path)
    {
        var parts = path.Split('\\', StringSplitOptions.RemoveEmptyEntries);
        for (var index = 0; index < parts.Length - 1; index++)
        {
            if (parts[index].Equals("Users", StringComparison.OrdinalIgnoreCase))
            {
                return parts[index + 1];
            }
        }

        return string.Empty;
    }

    private static HashSet<string>? NormalizeStringSet(JsonNode? node)
    {
        if (node is not JsonArray array)
        {
            return null;
        }

        return array
            .Select(item => Text.Sanitize(item?.ToString()))
            .Where(value => value.Length > 0)
            .ToHashSet(StringComparer.Ordinal);
    }

    private static HashSet<string>? NormalizeExtensions(JsonNode? node)
    {
        var normalized = NormalizeStringSet(node);
        if (normalized is null)
        {
            return null;
        }

        return normalized
            .Select(value => value.StartsWith('.') ? value.ToLowerInvariant() : "." + value.ToLowerInvariant())
            .Where(value => TextExtensions.Contains(value) || ImageExtensions.Contains(value)
                            || OfficeExtensions.Contains(value) || value == ".pdf")
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private void LoadState()
    {
        try
        {
            if (!File.Exists(_stateFile))
            {
                return;
            }

            var node = JsonNode.Parse(File.ReadAllText(_stateFile));
            if (node?["files"] is not JsonObject files)
            {
                return;
            }

            foreach (var (path, raw) in files)
            {
                if (raw is not JsonObject row)
                {
                    continue;
                }

                _state[path] = (Text.ToLong(row["size"], 0), Text.ToLong(row["mtime"], 0));
            }
        }
        catch (Exception)
        {
            _state.Clear();
        }
    }

    private void SaveState()
    {
        try
        {
            var files = new JsonObject();
            foreach (var (path, value) in _state.TakeLast(120_000))
            {
                files[path] = new JsonObject
                {
                    ["size"] = value.Size,
                    ["mtime"] = value.Mtime,
                };
            }

            AtomicFile.WriteAllText(_stateFile, new JsonObject { ["files"] = files }.ToJsonString());
        }
        catch (Exception ex)
        {
            _log.Warn($"Scan state write failed: {ex.Message}");
        }
    }

    private void WriteStatus()
    {
        try
        {
            var pending = Directory.Exists(_outboxPending)
                ? Directory.EnumerateFiles(_outboxPending, "*.json").Count()
                : 0;
            var status = new JsonObject
            {
                ["updated_at"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                ["last_ingest_ok_at"] = _lastIngestOkAt,
                ["last_error"] = _lastError,
                ["outbox_pending"] = pending,
                ["version"] = AgentVersion.Value,
            };
            AtomicFile.WriteAllText(_statusFile, status.ToJsonString());
        }
        catch (Exception)
        {
            // status is best effort
        }
    }

    private void MoveToDead(string path)
    {
        try
        {
            var target = Path.Combine(_outboxDead, Path.GetFileName(path));
            if (File.Exists(target))
            {
                File.Delete(target);
            }

            File.Move(path, target);
        }
        catch (Exception ex)
        {
            _log.Warn($"Scan outbox dead-letter move failed: {ex.Message}");
        }
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch (Exception)
        {
            // best effort
        }
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
        _downloadHttp.Dispose();
    }
}

