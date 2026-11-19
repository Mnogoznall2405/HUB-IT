using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// Realtime-подключение чата: wss://{origin}/api/v1/chat/ws с Bearer-заголовком
/// на handshake. Фоновый цикл сам держит переподключение с backoff (1→30с, jitter
/// до 25%), шлёт ping каждые ~25с и после каждого коннекта поднимает подписки:
/// chat.subscribe_inbox, chat.client_state(desktop), chat.watch_presence по
/// последнему набору (см. WatchPresence) и chat.subscribe_conversation для
/// watched-диалога (см. WatchConversation). На chat.auth.required отвечает
/// chat.auth со свежим ws_ticket. События отдаются сырыми {type, payload}
/// через EventReceived — маршаллинг на UI-поток на стороне подписчика.
/// </summary>
public sealed class HubChatRealtimeClient : IHubChatRealtime
{
    private static readonly TimeSpan NoSessionRetryDelay = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan InitialBackoff = TimeSpan.FromSeconds(1);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan PingInterval = TimeSpan.FromSeconds(25);
    private static readonly TimeSpan CloseTimeout = TimeSpan.FromSeconds(3);
    private static readonly byte[] PingPayload = Encoding.UTF8.GetBytes("{\"type\":\"chat.ping\"}");
    private static readonly byte[] SubscribeInboxPayload =
        Encoding.UTF8.GetBytes("{\"type\":\"chat.subscribe_inbox\"}");
    private static readonly byte[] ClientStatePayload = Encoding.UTF8.GetBytes(
        "{\"type\":\"chat.client_state\",\"payload\":{\"client_kind\":\"desktop\",\"foreground\":true}}");
    private static readonly JsonElement EmptyPayload = JsonDocument.Parse("{}").RootElement.Clone();

    private readonly IHubApiClient _api;
    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private readonly object _watchLock = new();
    private readonly SemaphoreSlim _lifecycleLock = new(1, 1);

    private CancellationTokenSource? _loopCancellation;
    private Task? _loopTask;
    private ClientWebSocket? _socket;
    private string? _watchedConversationId;
    private long[] _watchedPresenceUserIds = [];
    private volatile HubChatRealtimeState _state = HubChatRealtimeState.Disconnected;
    private volatile bool _disposed;
    private int _reauthInFlight;

    public HubChatRealtimeClient(IHubApiClient api)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
    }

    public event EventHandler<HubChatRealtimeEvent>? EventReceived;

    public event EventHandler<HubChatRealtimeState>? StateChanged;

    public HubChatRealtimeState State => _state;

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
        SetState(HubChatRealtimeState.Disconnected);
    }

    /// <inheritdoc />
    public void WatchConversation(string? conversationId)
    {
        string? previousId;
        lock (_watchLock)
        {
            previousId = _watchedConversationId;
            if (previousId == conversationId)
            {
                return;
            }

            _watchedConversationId = conversationId;
        }

        var socket = Volatile.Read(ref _socket);
        if (socket is null || socket.State != WebSocketState.Open)
        {
            // Нет живого соединения: подписка уйдёт в handshake после (пере)подключения.
            return;
        }

        _ = SendWatchSwapAsync(socket, previousId, conversationId);
    }

    /// <inheritdoc />
    public void WatchPresence(IReadOnlyCollection<long> userIds)
    {
        var normalized = NormalizePresenceUserIds(userIds);
        lock (_watchLock)
        {
            if (_watchedPresenceUserIds.SequenceEqual(normalized))
            {
                return;
            }

            _watchedPresenceUserIds = normalized;
        }

        var socket = Volatile.Read(ref _socket);
        if (socket is null || socket.State != WebSocketState.Open)
        {
            // Нет живого соединения: набор уйдёт в handshake после (пере)подключения.
            return;
        }

        _ = SendWatchPresenceSafelyAsync(socket, normalized);
    }

    /// <inheritdoc />
    public void SendTyping(string conversationId, bool isTyping)
    {
        if (string.IsNullOrEmpty(conversationId))
        {
            return;
        }

        var socket = Volatile.Read(ref _socket);
        if (socket is null || socket.State != WebSocketState.Open)
        {
            // Нет живого соединения: typing-кадр эфемерен, догонять его не нужно.
            return;
        }

        var payload = JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "chat.typing",
            conversation_id = conversationId,
            payload = new { is_typing = isTyping },
        });
        _ = SendTypingSafelyAsync(socket, payload);
    }

    public async ValueTask DisposeAsync()
    {
        _disposed = true;
        await StopAsync();
        _lifecycleLock.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task RunLoopAsync(CancellationToken cancellationToken)
    {
        var backoff = InitialBackoff;
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
                SetState(HubChatRealtimeState.Disconnected);
                return;
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // Транспортная ошибка получения токена — как обычный разрыв.
                SetState(HubChatRealtimeState.Reconnecting);
                await DelayAsync(WithJitter(backoff), cancellationToken);
                backoff = NextBackoff(backoff);
                continue;
            }

            if (cancellationToken.IsCancellationRequested)
            {
                return;
            }

            if (token is null)
            {
                // Сессии может ещё не быть (логин в процессе) — ждём и пробуем снова.
                SetState(HubChatRealtimeState.Disconnected);
                await DelayAsync(NoSessionRetryDelay, cancellationToken);
                continue;
            }

            if (_state == HubChatRealtimeState.Disconnected)
            {
                SetState(HubChatRealtimeState.Connecting);
            }

            var socket = new ClientWebSocket();
            try
            {
                socket.Options.SetRequestHeader("Authorization", $"Bearer {token}");
                await socket.ConnectAsync(BuildWebSocketUri(), cancellationToken);
                Interlocked.Exchange(ref _socket, socket);
                SetState(HubChatRealtimeState.Connected);
                await SendHandshakeCommandsAsync(socket, cancellationToken);
                backoff = InitialBackoff;
                await RunConnectedAsync(socket, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch
            {
                // Connect/read-цикл упал — ниже уходим в Reconnecting + backoff.
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

            SetState(HubChatRealtimeState.Reconnecting);
            await DelayAsync(WithJitter(backoff), cancellationToken);
            backoff = NextBackoff(backoff);
        }
    }

    /// <summary>Фаза открытого соединения: read-цикл + параллельный ping.</summary>
    private async Task RunConnectedAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        using var pingCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var pingTask = RunPingLoopAsync(socket, pingCancellation.Token);
        try
        {
            await RunReceiveLoopAsync(socket, cancellationToken);
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

    private async Task RunReceiveLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        var buffer = new byte[16 * 1024];
        while (!cancellationToken.IsCancellationRequested)
        {
            using var message = new MemoryStream();
            var messageType = WebSocketMessageType.Text;
            while (true)
            {
                var result = await socket.ReceiveAsync(
                    buffer.AsMemory(0, buffer.Length), cancellationToken);
                messageType = result.MessageType;
                if (result.MessageType == WebSocketMessageType.Close)
                {
                    return;
                }

                message.Write(buffer, 0, result.Count);
                if (result.EndOfMessage)
                {
                    break;
                }
            }

            if (messageType == WebSocketMessageType.Text)
            {
                DispatchEnvelope(socket, message.GetBuffer(), (int)message.Length);
            }
        }
    }

    private async Task RunPingLoopAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        using var timer = new PeriodicTimer(PingInterval);
        try
        {
            while (await timer.WaitForNextTickAsync(cancellationToken))
            {
                await SendPingAsync(socket, cancellationToken);
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

    private Task SendPingAsync(ClientWebSocket socket, CancellationToken cancellationToken) =>
        SendJsonAsync(socket, PingPayload, cancellationToken);

    /// <summary>
    /// Первичные команды после установления соединения: подписка на inbox, отметка
    /// desktop-клиента как активного, повторная подписка на room открытого диалога
    /// и на presence-набор (reconnect-safe: watched id и user-ids хранятся
    /// и переотправляются на каждом коннекте).
    /// Ошибка отправки валит сокет → цикл уходит в reconnect и повторит handshake.
    /// </summary>
    private async Task SendHandshakeCommandsAsync(ClientWebSocket socket, CancellationToken cancellationToken)
    {
        await SendJsonAsync(socket, SubscribeInboxPayload, cancellationToken);
        await SendJsonAsync(socket, ClientStatePayload, cancellationToken);

        string? watchedId;
        long[] watchedPresenceUserIds;
        lock (_watchLock)
        {
            watchedId = _watchedConversationId;
            watchedPresenceUserIds = _watchedPresenceUserIds;
        }

        if (!string.IsNullOrEmpty(watchedId))
        {
            await SendJsonAsync(
                socket,
                BuildConversationCommand("chat.subscribe_conversation", watchedId),
                cancellationToken);
        }

        if (watchedPresenceUserIds.Length > 0)
        {
            await SendJsonAsync(
                socket,
                BuildWatchPresenceCommand(watchedPresenceUserIds),
                cancellationToken);
        }
    }

    /// <summary>
    /// Отправка пары unsubscribe(старый)+subscribe(новый) одной последовательностью под
    /// _sendLock — иначе быстрые соседние вызовы WatchConversation могли бы перемешать
    /// кадры на проводе. Fire-and-forget: сбой пережимает reconnect (см. handshake).
    /// </summary>
    private async Task SendWatchSwapAsync(ClientWebSocket socket, string? previousId, string? currentId)
    {
        try
        {
            await _sendLock.WaitAsync();
            try
            {
                if (!string.IsNullOrEmpty(previousId))
                {
                    await SendJsonCoreAsync(
                        socket,
                        BuildConversationCommand("chat.unsubscribe_conversation", previousId),
                        CancellationToken.None);
                }

                if (!string.IsNullOrEmpty(currentId))
                {
                    await SendJsonCoreAsync(
                        socket,
                        BuildConversationCommand("chat.subscribe_conversation", currentId),
                        CancellationToken.None);
                }
            }
            finally
            {
                _sendLock.Release();
            }
        }
        catch
        {
            // Сокет умер между проверкой и отправкой — reconnect восстановит подписку.
        }
    }

    /// <summary>Fire-and-forget кадр chat.typing: сбой молчим — индикатор не догоняем.</summary>
    private async Task SendTypingSafelyAsync(ClientWebSocket socket, byte[] payload)
    {
        try
        {
            await SendJsonAsync(socket, payload, CancellationToken.None);
        }
        catch
        {
            // Сокет умер между проверкой и отправкой — просто пропускаем кадр.
        }
    }

    /// <summary>Fire-and-forget кадр watch_presence: сбой пережимает reconnect.</summary>
    private async Task SendWatchPresenceSafelyAsync(ClientWebSocket socket, long[] userIds)
    {
        try
        {
            await SendJsonAsync(
                socket, BuildWatchPresenceCommand(userIds), CancellationToken.None);
        }
        catch
        {
            // Сокет умер между проверкой и отправкой — reconnect восстановит watch.
        }
    }

    /// <summary>
    /// Ответ на chat.auth.required: берём ws-ticket у API и шлём chat.auth. Дедупликация
    /// по in-flight флагу; ошибки молчаливы — backend закроет lease или повторит кадр,
    /// а худший случай подстрахует reconnect со свежим handshake-токеном.
    /// </summary>
    private async Task ReauthenticateAsync(ClientWebSocket socket)
    {
        if (Interlocked.CompareExchange(ref _reauthInFlight, 1, 0) != 0)
        {
            return;
        }

        try
        {
            var ticket = await _api.GetChatWsTicketAsync(CancellationToken.None);
            if (string.IsNullOrEmpty(ticket?.Ticket))
            {
                return;
            }

            var payload = JsonSerializer.SerializeToUtf8Bytes(
                new { type = "chat.auth", payload = new { ws_ticket = ticket.Ticket } });
            await SendJsonAsync(socket, payload, CancellationToken.None);
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
            await SendJsonCoreAsync(socket, payload, cancellationToken);
        }
        finally
        {
            _sendLock.Release();
        }
    }

    /// <summary>Отправка без захвата _sendLock — вызывать только под уже удерживаемым локом.</summary>
    private static Task SendJsonCoreAsync(ClientWebSocket socket, byte[] payload, CancellationToken cancellationToken) =>
        socket.State == WebSocketState.Open
            ? socket.SendAsync(payload, WebSocketMessageType.Text, endOfMessage: true, cancellationToken)
            : Task.CompletedTask;

    private static byte[] BuildConversationCommand(string type, string conversationId) =>
        JsonSerializer.SerializeToUtf8Bytes(new { type, conversation_id = conversationId });

    private static byte[] BuildWatchPresenceCommand(IReadOnlyCollection<long> userIds) =>
        JsonSerializer.SerializeToUtf8Bytes(new
        {
            type = "chat.watch_presence",
            payload = new { user_ids = userIds },
        });

    /// <summary>Положительные id без дублей, отсортированные — стабильный ключ дедупликации.</summary>
    private static long[] NormalizePresenceUserIds(IReadOnlyCollection<long>? userIds) =>
        (userIds ?? [])
            .Where(id => id > 0)
            .Distinct()
            .OrderBy(id => id)
            .ToArray();

    private void DispatchEnvelope(ClientWebSocket socket, byte[] data, int count)
    {
        JsonDocument? document = null;
        try
        {
            document = JsonDocument.Parse(data.AsMemory(0, count));
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            var type = root.TryGetProperty("type", out var typeElement)
                && typeElement.ValueKind == JsonValueKind.String
                    ? typeElement.GetString()
                    : null;
            if (string.IsNullOrEmpty(type))
            {
                return;
            }

            if (type == "chat.auth.required")
            {
                // Служебный кадр: истёк access-token на socket lease. Подписчикам
                // не отдаём — отвечаем chat.auth со свежим ws_ticket в фоне.
                _ = ReauthenticateAsync(socket);
                return;
            }

            var payload = root.TryGetProperty("payload", out var payloadElement)
                ? payloadElement.Clone()
                : EmptyPayload;
            // conversation_id живёт на уровне конверта (chat.typing.* и др.) —
            // отдаём отдельно: в payload его может не быть.
            var conversationId = root.TryGetProperty("conversation_id", out var conversationElement)
                && conversationElement.ValueKind == JsonValueKind.String
                    ? conversationElement.GetString()
                    : null;
            EventReceived?.Invoke(this, new HubChatRealtimeEvent(type, payload, conversationId));
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

    private Uri BuildWebSocketUri()
    {
        var uri = new Uri(_api.BaseUri, "api/v1/chat/ws");
        var builder = new UriBuilder(uri)
        {
            Scheme = uri.Scheme == "https" ? "wss" : "ws",
        };
        return builder.Uri;
    }

    private void SetState(HubChatRealtimeState state)
    {
        if (_state == state)
        {
            return;
        }

        _state = state;
        try
        {
            StateChanged?.Invoke(this, state);
        }
        catch
        {
            // Подписчик не должен рушить цикл подключения.
        }
    }

    private static TimeSpan NextBackoff(TimeSpan backoff)
    {
        var next = TimeSpan.FromTicks(backoff.Ticks * 2);
        return next > MaxBackoff ? MaxBackoff : next;
    }

    private static TimeSpan WithJitter(TimeSpan delay)
    {
        var factor = 1.0 + Random.Shared.NextDouble() * 0.25;
        return TimeSpan.FromTicks((long)(delay.Ticks * factor));
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
