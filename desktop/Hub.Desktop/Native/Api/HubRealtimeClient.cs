using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// Realtime-подключение хаба: wss://{origin}/api/v1/chat/hub-realtime/ws с Bearer-
/// заголовком на handshake (backend: get_current_user_from_websocket). Контракт —
/// точная копия веб hubRealtimeSocket.js:
/// - ping {type:"hub.realtime.ping", payload:{}, request_id} каждые ~25с; 3
///   пропуска hub.realtime.pong → close 4408 → переподключение;
/// - на hub.realtime.auth.required отвечает hub.realtime.auth со свежим
///   ws_ticket (тот же POST chat/ws-ticket, что и у чата);
/// - reconnect backoff [1,2,5,10,20,30]с + джиттер ±25% (+ spread до 5с на
///   первой попытке); 4400/4403/4404 — без реконнекта, 4000 (evicted) —
///   реконнект через 120с, 4401 — auth-recovery через refresh-механизм
///   api-клиента, затем реконнект;
/// - доменные события дедуплицируются по payload.event_id (FIFO 512) и
///   отдаются сырыми {type, payload} через EventReceived — маршаллинг на
///   UI-поток на стороне подписчика.
/// </summary>
public sealed class HubRealtimeClient : IHubRealtime
{
    private static readonly TimeSpan NoSessionRetryDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(3);
    private static readonly TimeSpan[] ReconnectDelays =
    [
        TimeSpan.FromSeconds(1),
        TimeSpan.FromSeconds(2),
        TimeSpan.FromSeconds(5),
        TimeSpan.FromSeconds(10),
        TimeSpan.FromSeconds(20),
        TimeSpan.FromSeconds(30),
    ];
    private const double ReconnectJitterRatio = 0.25;
    private static readonly TimeSpan InitialReconnectSpread = TimeSpan.FromSeconds(5);
    /// <summary>Соединение, прожившее ≥ столько, считается стабильным: попытки
    /// реконнекта и auth-recovery обнуляются (веб — STABLE_CONNECTION_MS).</summary>
    private static readonly TimeSpan StableConnectionThreshold = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan EvictedReconnectDelay = TimeSpan.FromSeconds(120);

    private const int MaxMissedPongs = 3;
    private const int RecentEventIdsLimit = 512;

    private const int EvictedCloseCode = 4000;
    private const int InactiveUserCloseCode = 4400;
    private const int AuthExpiredCloseCode = 4401;
    private const int ForbiddenCloseCode = 4403;
    private const int NotFoundCloseCode = 4404;
    private const int HeartbeatTimeoutCloseCode = 4408;

    private static readonly JsonElement EmptyPayload = JsonDocument.Parse("{}").RootElement.Clone();

    private readonly IHubApiClient _api;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);
    private readonly object _recentEventIdsLock = new();
    private readonly HashSet<string> _recentEventIds = new(StringComparer.Ordinal);
    private readonly Queue<string> _recentEventIdsOrder = new();

    private CancellationTokenSource? _loopCancellation;
    private Task? _loopTask;
    private ClientWebSocket? _socket;
    private volatile HubRealtimeState _state = HubRealtimeState.Disconnected;
    private volatile bool _disposed;
    private int _reauthInFlight;
    private int _missedPongs;

    public HubRealtimeClient(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    public event EventHandler<HubRealtimeEvent>? EventReceived;

    public event EventHandler<HubRealtimeState>? StateChanged;

    public HubRealtimeState State => _state;

    /// <summary>Идемпотентный запуск: уже идущий цикл не дублируется.</summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        if (_disposed)
        {
            return;
        }

        await _lifecycleLock.WaitAsync(cancellationToken);
        try
        {
            if (_disposed || _loopTask is { IsCompleted: false })
            {
                return;
            }

            _loopCancellation?.Dispose();
            _loopCancellation = new CancellationTokenSource();
            var token = _loopCancellation.Token;
            _loopTask = Task.Run(() => RunLoopAsync(token), CancellationToken.None);
        }
        finally
        {
            _lifecycleLock.Release();
        }
    }

    /// <summary>Остановить цикл и закрыть сокет; реконнектов больше не будет.</summary>
    public async Task StopAsync()
    {
        Task? loop;
        await _lifecycleLock.WaitAsync();
        try
        {
            loop = _loopTask;
            _loopTask = null;
            _loopCancellation?.Cancel();
        }
        finally
        {
            _lifecycleLock.Release();
        }

        var socket = Interlocked.Exchange(ref _socket, null);
        if (socket is not null)
        {
            try
            {
                using var timeout = new CancellationTokenSource(CloseTimeout);
                await socket.CloseOutputAsync(
                    WebSocketCloseStatus.NormalClosure,
                    statusDescription: null,
                    timeout.Token);
            }
            catch
            {
                // Best-effort graceful close: сокет всё равно уничтожается ниже.
            }
            finally
            {
                socket.Dispose();
            }
        }

        if (loop is not null)
        {
            try
            {
                await loop;
            }
            catch
            {
                // Цикл обязан завершаться сам; подстраховка от падения StopAsync.
            }
        }

        _loopCancellation?.Dispose();
        _loopCancellation = null;
        SetState(HubRealtimeState.Disconnected);
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        await StopAsync();
        _lifecycleLock.Dispose();
        _sendLock.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        var reconnectAttempt = 0;
        var authRecoveryAttempted = false;
        while (!cancellationToken.IsCancellationRequested)
        {
            string? token;
            try
            {
                token = await _api.GetAccessTokenAsync(cancellationToken);
            }
            catch (HubApiException exception) when (exception.Kind == HubApiErrorKind.SessionExpired)
            {
                // Сессия мертва: цикл заканчиваем, шелл покажет логин.
                SetState(HubRealtimeState.Disconnected);
                return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // Транспортная ошибка получения токена — как обычный разрыв.
                SetState(HubRealtimeState.Reconnecting);
                await DelayAsync(ReconnectDelay(reconnectAttempt, TimeSpan.Zero), cancellationToken);
                reconnectAttempt += 1;
                continue;
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            if (token is null)
            {
                // Сессии может ещё не быть (логин в процессе) — ждём и пробуем снова.
                SetState(HubRealtimeState.Disconnected);
                await DelayAsync(NoSessionRetryDelay, cancellationToken);
                continue;
            }

            SetState(reconnectAttempt > 0
                ? HubRealtimeState.Reconnecting
                : HubRealtimeState.Connecting);

            var socket = new ClientWebSocket();
            int? closeCode = null;
            DateTimeOffset? connectedAt = null;
            try
            {
                socket.Options.SetRequestHeader("Authorization", $"Bearer {token}");
                await socket.ConnectAsync(BuildWebSocketUri(), cancellationToken);
                Interlocked.Exchange(ref _socket, socket);
                Interlocked.Exchange(ref _missedPongs, 0);
                connectedAt = DateTimeOffset.UtcNow;
                // Веб-контракт: статус connected — только по кадру
                // hub.realtime.connected (см. HandleEnvelope), не по факту open.
                closeCode = await RunConnectedAsync(socket, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // Connect/read-цикл упал — ниже обычный reconnect с backoff.
            }
            finally
            {
                Interlocked.CompareExchange(ref _socket, null, socket);
                socket.Dispose();
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            // Стабильное соединение (≥5с как в вебе) обнуляет backoff и лимит
            // auth-recovery — серия коротких 4401 без стабильного коннекта
            // останавливает цикл состоянием Unauthorized.
            if (connectedAt is { } openedAt
                && DateTimeOffset.UtcNow - openedAt >= StableConnectionThreshold)
            {
                reconnectAttempt = 0;
                authRecoveryAttempted = false;
            }

            switch (closeCode)
            {
                case AuthExpiredCloseCode:
                    SetState(HubRealtimeState.Unauthorized);
                    if (authRecoveryAttempted)
                    {
                        // Recovery уже пробовали — как в вебе остаёмся blocked.
                        return;
                    }

                    authRecoveryAttempted = true;
                    if (!await TryRecoverAuthorizationAsync(cancellationToken))
                    {
                        // Сессия окончательно мертва (SessionEnded уже поднят
                        // api-клиентом, шелл уйдёт на логин).
                        SetState(HubRealtimeState.Disconnected);
                        return;
                    }

                    continue;

                case InactiveUserCloseCode:
                case ForbiddenCloseCode:
                case NotFoundCloseCode:
                    SetState(closeCode == ForbiddenCloseCode
                        ? HubRealtimeState.Forbidden
                        : HubRealtimeState.Disconnected);
                    return;

                case EvictedCloseCode:
                    // Сервер вытеснил это соединение новым (лимит на пользователя):
                    // мгновенный реконнект устроил бы войну вкладок — ждём 120с.
                    SetState(HubRealtimeState.Reconnecting);
                    await DelayAsync(
                        ReconnectDelay(reconnectAttempt, EvictedReconnectDelay), cancellationToken);
                    reconnectAttempt += 1;
                    continue;

                default:
                    // 1008/4408/нет кода/transport-ошибка — обычный backoff.
                    SetState(HubRealtimeState.Reconnecting);
                    await DelayAsync(ReconnectDelay(reconnectAttempt, TimeSpan.Zero), cancellationToken);
                    reconnectAttempt += 1;
                    continue;
            }
        }
    }

    /// <summary>Фаза открытого соединения: read-цикл + параллельный ping.</summary>
    /// <returns>WS-код закрытия от сервера, null — transport-разрыв без кода.</returns>
    private async Task<int?> RunConnectedAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        using var pingCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var pingTask = RunPingLoopAsync(socket, pingCancellation.Token);
        try
        {
            return await RunReceiveLoopAsync(socket, cancellationToken);
        }
        finally
        {
            await pingCancellation.CancelAsync();
            try
            {
                await pingTask;
            }
            catch
            {
                // Ping-цикл не должен маскировать исходную ошибку read-цикла.
            }
        }
    }

    private async Task<int?> RunReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        while (!cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            var messageType = WebSocketMessageType.Text;
            int? closeCode = null;
            while (true)
            {
                var result = await socket.ReceiveAsync(
                    buffer.AsMemory(0, buffer.Length), cancellationToken);
                messageType = result.MessageType;
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    // ValueWebSocketReceiveResult не несёт CloseStatus — берём у сокета.
                    closeCode = (int)(socket.CloseStatus ?? WebSocketCloseStatus.NormalClosure);
                    break;
                }

                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    break;
                }
            }

            if (closeCode is not null)
            {
                return closeCode;
            }

            if (messageType == WebSocketMessageType.Text)
            {
                DispatchEnvelope(socket, message.GetBuffer(), (int)message.Length);
            }
        }

        return null;
    }

    private async Task RunPingLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(PingInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                if (Volatile.Read(ref _missedPongs) >= MaxMissedPongs)
                {
                    // Heartbeat timeout: закрываем сокет кодом 4408 — read-цикл
                    // выйдет по Close-кадру и цикл уйдёт в реконнект.
                    try
                    {
                        using var timeout = new CancellationTokenSource(CloseTimeout);
                        await socket.CloseOutputAsync(
                            (WebSocketCloseStatus)HeartbeatTimeoutCloseCode,
                            "hub realtime heartbeat timeout",
                            timeout.Token);
                    }
                    catch
                    {
                        try
                        {
                            socket.Abort();
                        }
                        catch
                        {
                        }
                    }

                    return;
                }

                Interlocked.Increment(ref _missedPongs);
                await SendJsonAsync(socket, BuildPingFrame(), cancellationToken);
            }
        }
        catch (OperationCanceledException)
        {
        }
        catch
        {
            // Ping не ушёл — сокет мёртв: обрываем, чтобы read-цикл вышел в reconnect.
            try
            {
                socket.Abort();
            }
            catch
            {
            }
        }
    }

    /// <summary>
    /// Auth-recovery после 4401 (веб: authAPI.refresh). Авторизованный вызов
    /// прогоняет стандартную цепочку api-клиента (401 → refresh → retry):
    /// мёртвая серверная сессия даёт свежую пару токенов или SessionExpired.
    /// </summary>
    private async Task<bool> TryRecoverAuthorizationAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _api.GetChatWsTicketAsync(cancellationToken);
            return true;
        }
        catch (HubApiException exception) when (exception.Kind == HubApiErrorKind.SessionExpired)
        {
            return false;
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            return false;
        }
        catch
        {
            // Транспортный сбой recovery — немедленный реконнект всё равно
            // правильнее ожидания: connect сам упадёт в backoff при нужде.
            return true;
        }
    }

    /// <summary>
    /// Ответ на hub.realtime.auth.required: берём ws-ticket у API и шлём
    /// hub.realtime.auth (как chat.auth у чат-сокета). Дедупликация по
    /// in-flight флагу; ошибки молчаливы — худший случай подстрахует
    /// reconnect со свежим handshake-токеном.
    /// </summary>
    private async Task ReauthenticateAsync(ClientWebSocket? socket)
    {
        if (Interlocked.CompareExchange(ref _reauthInFlight, 1, 0) != 0)
        {
            return;
        }

        try
        {
            var ticket = await _api.GetChatWsTicketAsync(CancellationToken.None);
            if (string.IsNullOrEmpty(ticket?.Ticket) || socket is not { State: WebSocketState.Open })
            {
                return;
            }

            await SendJsonAsync(socket, BuildAuthFrame(ticket.Ticket), CancellationToken.None);
        }
        catch
        {
            // Тикет не получен или кадр не ушёл — не роняем read-цикл.
        }
        finally
        {
            Interlocked.Exchange(ref _reauthInFlight, 0);
        }
    }

    /// <summary>Сериализованная отправка текстового кадра; закрытый сокет — тихий no-op.</summary>
    private async Task SendJsonAsync(ClientWebSocket socket, byte[] payload, CancellationToken cancellationToken)
    {
        await _sendLock.WaitAsync(cancellationToken);
        try
        {
            if (socket.State == WebSocketState.Open)
            {
                await socket.SendAsync(
                    payload, WebSocketMessageType.Text, endOfMessage: true, cancellationToken);
            }
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private static byte[] BuildPingFrame() =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "hub.realtime.ping",
            payload = new { },
            request_id = Guid.NewGuid().ToString(),
        });

    internal static byte[] BuildAuthFrame(string wsTicket) =>
        JsonSerializer.SerializeToUtf8Bytes(
            new { type = "hub.realtime.auth", payload = new { ws_ticket = wsTicket } });

    /// <summary>
    /// Backoff-задержка веб-клиента: delays[min(attempt, len-1)] + джиттер ±25%
    /// (+ случайный spread до 5с на первой попытке), ограниченная снизу minDelay
    /// (для 4000 evicted — 120с).
    /// </summary>
    internal static TimeSpan ReconnectDelay(int attempt, TimeSpan minDelay)
    {
        var baseDelay = ReconnectDelays[Math.Min(Math.Max(attempt, 0), ReconnectDelays.Length - 1)];
        var jitter = baseDelay.Ticks * ReconnectJitterRatio * ((Random.Shared.NextDouble() * 2) - 1);
        var initialSpread = attempt == 0
            ? Random.Shared.NextDouble() * InitialReconnectSpread.Ticks
            : 0;
        var computed = Math.Min(
            ReconnectDelays[^1].Ticks,
            baseDelay.Ticks + jitter + initialSpread);
        var delay = Math.Max(0, (long)computed);
        return delay >= minDelay.Ticks
            ? TimeSpan.FromTicks(delay)
            : minDelay;
    }

    private void DispatchEnvelope(ClientWebSocket socket, byte[] data, int count)
    {
        JsonDocument? document = null;
        try
        {
            document = JsonDocument.Parse(data.AsMemory(0, count));
            HandleEnvelope(socket, document.RootElement);
        }
        catch (JsonException)
        {
            // Битый кадр пропускаем — соединение живо.
        }
        catch
        {
            // Ошибка подписчика не должна убивать read-цикл.
        }
        finally
        {
            document?.Dispose();
        }
    }

    /// <summary>Тестовый шов: разбор кадра без сокета (socket=null — auth-ответ
    /// не уйдёт на провод, остальная логика идентична).</summary>
    internal void HandleEnvelopeForTest(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            HandleEnvelope(socket: null, document.RootElement);
        }
        catch (JsonException)
        {
        }
    }

    private void HandleEnvelope(ClientWebSocket? socket, JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var type = root.TryGetProperty("type", out var typeElement)
            && typeElement.ValueKind == JsonValueKind.String
                ? typeElement.GetString()?.Trim()
                : null;
        if (string.IsNullOrEmpty(type))
        {
            return;
        }

        switch (type)
        {
            case "hub.realtime.connected":
                // Служебный кадр готовности канала: в вебе он доходит до
                // подписчиков до claimEvent — не дедуплицируем и помечаем
                // соединение установленным именно здесь.
                SetState(HubRealtimeState.Connected);
                DispatchEvent(type, root);
                return;
            case "hub.realtime.pong":
                Interlocked.Exchange(ref _missedPongs, 0);
                return;
            case "hub.realtime.auth.required":
                // Lease-токен истёк: доказываем свежесть ws_ticket'ом.
                _ = ReauthenticateAsync(socket);
                return;
            case "hub.realtime.auth.ok":
            case "hub.realtime.auth.rejected":
                return;
            default:
                break;
        }

        // Task presence — служебный канал веб-клиента; нативный шелл его
        // не использует, кадры пропускаем без диспетча.
        if (type.StartsWith("tasks.presence.", StringComparison.Ordinal))
        {
            return;
        }

        DispatchEvent(type, root);
    }

    /// <summary>Дедуп по payload.event_id и безопасная отдача события подписчикам.</summary>
    private void DispatchEvent(string type, JsonElement root)
    {
        var payload = root.TryGetProperty("payload", out var payloadElement)
            ? payloadElement.Clone()
            : EmptyPayload;
        if (IsDuplicateEvent(payload))
        {
            return;
        }

        var evt = new HubRealtimeEvent(type, payload);
        foreach (var handler in EventReceived?.GetInvocationList() ?? [])
        {
            try
            {
                ((EventHandler<HubRealtimeEvent>)handler).Invoke(this, evt);
            }
            catch
            {
                // Один подписчик не должен рушить read-цикл и резать остальным.
            }
        }
    }

    /// <summary>
    /// Дедуп доменных событий по payload.event_id (веб claimEvent): FIFO-окно
    /// на 512 id — повторный кадр возвращает true и не диспетчится.
    /// </summary>
    private bool IsDuplicateEvent(JsonElement payload)
    {
        if (payload.ValueKind != JsonValueKind.Object
            || !payload.TryGetProperty("event_id", out var idElement)
            || idElement.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var eventId = idElement.GetString();
        if (string.IsNullOrEmpty(eventId))
        {
            return false;
        }

        lock (_recentEventIdsLock)
        {
            if (!_recentEventIds.Add(eventId))
            {
                return true;
            }

            _recentEventIdsOrder.Enqueue(eventId);
            while (_recentEventIdsOrder.Count > RecentEventIdsLimit)
            {
                _recentEventIds.Remove(_recentEventIdsOrder.Dequeue());
            }

            return false;
        }
    }

    private Uri BuildWebSocketUri()
    {
        var uri = new Uri(_api.BaseUri, "api/v1/chat/hub-realtime/ws");
        var builder = new UriBuilder(uri)
        {
            Scheme = uri.Scheme == "https" ? "wss" : "ws",
        };
        return builder.Uri;
    }

    private void SetState(HubRealtimeState state)
    {
        if (_state == state)
        {
            return;
        }

        _state = state;
        foreach (var handler in StateChanged?.GetInvocationList() ?? [])
        {
            try
            {
                ((EventHandler<HubRealtimeState>)handler).Invoke(this, state);
            }
            catch
            {
                // Подписчик не должен рушить цикл подключения.
            }
        }
    }

    private static async Task DelayAsync(TimeSpan delay, CancellationToken cancellationToken)
    {
        try
        {
            await Task.Delay(delay, cancellationToken);
        }
        catch (OperationCanceledException)
        {
        }
    }
}
