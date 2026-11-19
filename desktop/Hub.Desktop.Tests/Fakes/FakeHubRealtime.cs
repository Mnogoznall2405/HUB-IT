using System.Text.Json;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Tests.Fakes;

/// <summary>
/// Общий фейк IHubRealtime для тестов нативного шелла: считает вызовы
/// жизненного цикла и позволяет вручную поднимать события/состояния
/// hub realtime-подключения (зеркало FakeChatRealtime).
/// </summary>
public sealed class FakeHubRealtime : IHubRealtime
{
    public int StartCalls { get; private set; }
    public int StopCalls { get; private set; }
    public int DisposeCalls { get; private set; }

    /// <summary>Если задано — StartAsync падает этой ошибкой (канал не поднялся).</summary>
    public Exception? StartException { get; set; }

    public HubRealtimeState State { get; private set; } = HubRealtimeState.Disconnected;

    public event EventHandler<HubRealtimeEvent>? EventReceived;
    public event EventHandler<HubRealtimeState>? StateChanged;

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        StartCalls++;
        return StartException is not null
            ? Task.FromException(StartException)
            : Task.CompletedTask;
    }

    public Task StopAsync()
    {
        StopCalls++;
        return Task.CompletedTask;
    }

    public ValueTask DisposeAsync()
    {
        DisposeCalls++;
        return ValueTask.CompletedTask;
    }

    public void RaiseEvent(string type, string payloadJson) =>
        RaiseEvent(type, JsonDocument.Parse(payloadJson).RootElement.Clone());

    public void RaiseEvent(string type, JsonElement payload) =>
        EventReceived?.Invoke(this, new HubRealtimeEvent(type, payload));

    public void RaiseState(HubRealtimeState state)
    {
        State = state;
        StateChanged?.Invoke(this, state);
    }
}
