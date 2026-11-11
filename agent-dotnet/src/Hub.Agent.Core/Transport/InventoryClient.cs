using System.Net;
using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Hub.Agent.Core.Configuration;
using Hub.Agent.Core.Diagnostics;

namespace Hub.Agent.Core.Transport;

public sealed record SendResult(bool Success, int? Status, string Error)
{
    public static SendResult Ok(int status) => new(true, status, string.Empty);
    public static SendResult Fail(int? status, string error) => new(false, status, error);
}

/// <summary>
/// HTTP transport for the inventory endpoint. Same wire contract as the Python
/// agent: POST JSON with X-API-Key, retry delays 0/2/5/15 s, and a response is
/// only accepted when the body is {"success": true}.
/// </summary>
public sealed class InventoryClient : IDisposable
{
    private static readonly int[] RetryDelaysSeconds = { 0, 2, 5, 15 };

    private readonly HttpClient _http;
    private readonly AgentConfig _config;
    private readonly AgentLog _log;

    public InventoryClient(AgentConfig config, AgentLog log)
    {
        _config = config;
        _log = log;

        var handler = new HttpClientHandler();
        if (!string.IsNullOrWhiteSpace(config.CaBundle) && File.Exists(config.CaBundle))
        {
            try
            {
                var root = new X509Certificate2(config.CaBundle);
                handler.ServerCertificateCustomValidationCallback = (_, certificate, _, _) =>
                {
                    if (certificate is null)
                    {
                        return false;
                    }

                    using var chain = new X509Chain();
                    chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
                    chain.ChainPolicy.CustomTrustStore.Add(root);
                    chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
                    return chain.Build(certificate);
                };
            }
            catch (Exception ex)
            {
                _log.Warn($"Failed to load ITINV_AGENT_CA_BUNDLE, using default TLS verification: {ex.Message}");
            }
        }

        _http = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(Math.Max(5, config.TimeoutSeconds)),
        };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd($"HUB-IT-Agent/{AgentVersion.Value} (C#)");
    }

    public async Task<SendResult> PostAsync(JsonNode payload, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_config.ApiKey))
        {
            return SendResult.Fail(null, "API_KEY_EMPTY");
        }

        var body = payload.ToJsonString();
        SendResult last = SendResult.Fail(null, "NOT_SENT");

        for (var attempt = 1; attempt <= RetryDelaysSeconds.Length; attempt++)
        {
            var delay = RetryDelaysSeconds[attempt - 1];
            if (delay > 0)
            {
                await Task.Delay(TimeSpan.FromSeconds(delay), cancellationToken).ConfigureAwait(false);
            }

            try
            {
                _log.Info($"Sending inventory to {_config.ServerUrl} (attempt={attempt})");
                using var request = new HttpRequestMessage(HttpMethod.Post, _config.ServerUrl)
                {
                    Content = new StringContent(body, Encoding.UTF8, "application/json"),
                };
                request.Headers.Add("X-API-Key", _config.ApiKey);

                using var response = await _http.SendAsync(request, HttpCompletionOption.ResponseContentRead, cancellationToken)
                    .ConfigureAwait(false);
                var status = (int)response.StatusCode;

                if (!response.IsSuccessStatusCode)
                {
                    last = SendResult.Fail(status, $"HTTP_{status}");
                    _log.Warn($"Inventory send failed on attempt={attempt}: status={status}");
                    if (status is (int)HttpStatusCode.Unauthorized or (int)HttpStatusCode.Forbidden)
                    {
                        return last;
                    }

                    continue;
                }

                var responseBody = await response.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
                if (!IsValidAck(responseBody))
                {
                    // A 2xx that is not the server's ACK (proxy page, wrong target)
                    // must not make the agent drop its only copy of the report.
                    last = SendResult.Fail(status, "INVALID_ACK");
                    _log.Warn($"Inventory send got status={status} without a valid server ACK on attempt={attempt}");
                    continue;
                }

                _log.Info($"Inventory sent successfully, status={status}");
                return SendResult.Ok(status);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                last = SendResult.Fail(null, ex.GetType().Name);
                _log.Warn($"Inventory send failed on attempt={attempt}: {ex.Message}");
            }
        }

        return last;
    }

    public async Task<bool> CheckHealthAsync(CancellationToken cancellationToken)
    {
        var healthUrl = BuildHealthUrl(_config.ServerUrl);
        try
        {
            using var response = await _http.GetAsync(healthUrl, cancellationToken).ConfigureAwait(false);
            _log.Info($"Health check {healthUrl} -> status={(int)response.StatusCode}");
            return response.IsSuccessStatusCode;
        }
        catch (Exception ex)
        {
            _log.Error($"Health endpoint is not reachable: {ex.Message}");
            return false;
        }
    }

    public async Task<bool> ProbeAuthorizationAsync(CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(_config.ApiKey))
        {
            return false;
        }

        try
        {
            var body = new JsonObject { ["timestamp"] = DateTimeOffset.UtcNow.ToUnixTimeSeconds() }.ToJsonString();
            using var request = new HttpRequestMessage(HttpMethod.Post, _config.ServerUrl)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            request.Headers.Add("X-API-Key", _config.ApiKey);

            using var response = await _http.SendAsync(request, cancellationToken).ConfigureAwait(false);
            var status = (int)response.StatusCode;
            _log.Info($"Inventory auth probe {_config.ServerUrl} -> status={status}");
            if (status is 401 or 403)
            {
                _log.Error("Inventory auth probe failed: invalid API key");
                return false;
            }

            return status < 500;
        }
        catch (Exception ex)
        {
            _log.Error($"Inventory endpoint is not reachable: {ex.Message}");
            return false;
        }
    }

    public static bool IsValidAck(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);
            return document.RootElement.ValueKind == JsonValueKind.Object
                   && document.RootElement.TryGetProperty("success", out var success)
                   && success.ValueKind == JsonValueKind.True;
        }
        catch (JsonException)
        {
            return false;
        }
    }

    public static string BuildHealthUrl(string serverUrl)
    {
        if (!Uri.TryCreate(serverUrl, UriKind.Absolute, out var uri))
        {
            return serverUrl;
        }

        return new UriBuilder(uri) { Path = "/health", Query = string.Empty }.Uri.ToString();
    }

    public void Dispose() => _http.Dispose();
}
