using System.Text.Json;

namespace Hub.Desktop.Native.Api;

/// <summary>Состояние realtime-подключения чата.</summary>
public enum HubChatRealtimeState
{
    Disconnected,
    Connecting,
    Connected,
    /// <summary>Потеря соединения, идёт автоматический переподключ с backoff.</summary>
    Reconnecting,
}

/// <summary>
/// Событие WS-конверта {type, payload} чата. ConversationId — верхнеуровневое
/// поле конверта (у typing-событий оно живёт именно там, в payload его нет);
/// null, когда бэкенд кадр без conversation_id.
/// </summary>
public sealed record HubChatRealtimeEvent(
    string Type,
    JsonElement Payload,
    string? ConversationId = null);

/// <summary>
/// Realtime-подключение к wss://…/api/v1/chat/ws с Bearer-авторизацией handshake.
/// Реализация обязана: автоматически переподключаться с backoff, отдавать сырые
/// события через EventReceived и завершаться через StopAsync/DisposeAsync.
/// </summary>
public interface IHubChatRealtime : IAsyncDisposable
{
    event EventHandler<HubChatRealtimeEvent>? EventReceived;
    event EventHandler<HubChatRealtimeState>? StateChanged;

    HubChatRealtimeState State { get; }

    /// <summary>Идемпотентный запуск цикла подключения (сам держит reconnect).</summary>
    Task StartAsync(CancellationToken cancellationToken = default);

    /// <summary>Остановить цикл и закрыть сокет; дальнейших реконнектов нет.</summary>
    Task StopAsync();

    /// <summary>
    /// Подписка на комнату диалога: шлёт chat.subscribe_conversation / при замене —
    /// chat.unsubscribe_conversation для прежнего id. null — только отписаться.
    /// Запоминается и переотправляется на каждом новом соединении (reconnect-safe).
    /// Fire-and-forget: ошибки отправки пережимает reconnect-цикл.
    /// </summary>
    void WatchConversation(string? conversationId);

    /// <summary>
    /// Подписка на онлайн-статусы: шлёт {type: chat.watch_presence,
    /// payload: {user_ids}} — заменяет watch-набор соединения. Набор запоминается
    /// и переотправляется на каждом новом соединении (reconnect-safe).
    /// Fire-and-forget: ошибки отправки пережимает reconnect-цикл.
    /// </summary>
    void WatchPresence(IReadOnlyCollection<long> userIds);

    /// <summary>
    /// Индикатор «печатает…»: шлёт {type: chat.typing, conversation_id, payload:
    /// {is_typing}}. Fire-and-forget: пустой id — no-op, мёртвый сокет и ошибки
    /// отправки молчаливо пропускаются (кадр эфемерен, догонять не нужно).
    /// </summary>
    void SendTyping(string conversationId, bool isTyping);
}
