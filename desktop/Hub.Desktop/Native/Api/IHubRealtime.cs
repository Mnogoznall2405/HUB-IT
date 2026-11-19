using System.Text.Json;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// Состояние hub realtime-подключения — зеркало статусов веб-клиента
/// hubRealtimeSocket.js (unauthorized/forbidden — терминальные состояния
/// до следующего StartAsync/смены сессии).
/// </summary>
public enum HubRealtimeState
{
    Disconnected,
    Connecting,
    Connected,
    /// <summary>Потеря соединения, идёт автоматический переподключ с backoff.</summary>
    Reconnecting,
    /// <summary>4401: сессия на сокете мертва, auth-recovery исчерпано.</summary>
    Unauthorized,
    /// <summary>4403: сервер отказал в доступе к каналу.</summary>
    Forbidden,
}

/// <summary>
/// Событие WS-конверта {type, payload} hub realtime. Доменные типы
/// (mail.*, tasks.task.*, docflow.task.changed, dashboard.invalidate,
/// hub.notification.created, hub.realtime.connected) отдаются как есть;
/// служебные кадры (pong/auth/presence) внутрь события не попадают.
/// </summary>
public sealed record HubRealtimeEvent(
    string Type,
    JsonElement Payload);

/// <summary>
/// Realtime-подключение к wss://…/api/v1/chat/hub-realtime/ws с Bearer-
/// авторизацией handshake и ws_ticket-реавторизацией внутри сокета
/// (контракт — точная копия веб hubRealtimeSocket.js). Реализация обязана:
/// автоматически переподключаться с backoff [1,2,5,10,20,30]с + джиттер 25%,
/// дедуплицировать события по payload.event_id, отдавать доменные события
/// через EventReceived и завершаться через StopAsync/DisposeAsync.
/// </summary>
public interface IHubRealtime : IAsyncDisposable
{
    event EventHandler<HubRealtimeEvent>? EventReceived;
    event EventHandler<HubRealtimeState>? StateChanged;

    HubRealtimeState State { get; }

    /// <summary>Идемпотентный запуск цикла подключения (сам держит reconnect).</summary>
    Task StartAsync(CancellationToken cancellationToken = default);

    /// <summary>Остановить цикл и закрыть сокет; дальнейших реконнектов нет.</summary>
    Task StopAsync();
}
