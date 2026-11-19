using System.Text.Json;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Tests.Fakes;

/// <summary>
/// Общий фейк IHubChatRealtime для тестов нативных страниц: считает вызовы
/// жизненного цикла, записывает WatchConversation и позволяет вручную
/// поднимать события/состояния соединения.
/// </summary>
public sealed class FakeChatRealtime : IHubChatRealtime
{
    public int StartCalls { get; private set; }
    public int StopCalls { get; private set; }
    public int DisposeCalls { get; private set; }

    /// <summary>Все id, переданные в WatchConversation, по порядку вызовов.</summary>
    public List<string?> WatchedConversationCalls { get; } = [];

    /// <summary>Последний id, переданный в WatchConversation (null — отписались/не вызывали).</summary>
    public string? WatchedConversationId { get; private set; }

    /// <summary>Все вызовы SendTyping по порядку: (conversationId, isTyping).</summary>
    public List<(string ConversationId, bool IsTyping)> TypingCalls { get; } = [];

    /// <summary>Последнее переданное состояние is_typing (null — SendTyping не вызывали).</summary>
    public bool? LastTypingState { get; private set; }

    /// <summary>Все наборы user_ids из WatchPresence по порядку вызовов.</summary>
    public List<long[]> WatchPresenceCalls { get; } = [];

    /// <summary>Последний набор user_ids из WatchPresence (null — не вызывали).</summary>
    public IReadOnlyCollection<long>? WatchedPresenceUserIds { get; private set; }

    public HubChatRealtimeState State { get; private set; } =
        HubChatRealtimeState.Disconnected;

    public event EventHandler<HubChatRealtimeEvent>? EventReceived;
    public event EventHandler<HubChatRealtimeState>? StateChanged;

    public Task StartAsync(CancellationToken cancellationToken = default)
    {
        StartCalls++;
        return Task.CompletedTask;
    }

    public Task StopAsync()
    {
        StopCalls++;
        return Task.CompletedTask;
    }

    public void WatchConversation(string? conversationId)
    {
        WatchedConversationCalls.Add(conversationId);
        WatchedConversationId = conversationId;
    }

    public void SendTyping(string conversationId, bool isTyping)
    {
        TypingCalls.Add((conversationId, isTyping));
        LastTypingState = isTyping;
    }

    public void WatchPresence(IReadOnlyCollection<long> userIds)
    {
        var ids = userIds.ToArray();
        WatchPresenceCalls.Add(ids);
        WatchedPresenceUserIds = ids;
    }

    public ValueTask DisposeAsync()
    {
        DisposeCalls++;
        return ValueTask.CompletedTask;
    }

    public void RaiseEvent(string type, string payloadJson, string? conversationId = null) =>
        RaiseEvent(type, JsonDocument.Parse(payloadJson).RootElement.Clone(), conversationId);

    public void RaiseEvent(string type, JsonElement payload, string? conversationId = null) =>
        EventReceived?.Invoke(this, new HubChatRealtimeEvent(type, payload, conversationId));

    public void RaiseState(HubChatRealtimeState state)
    {
        State = state;
        StateChanged?.Invoke(this, state);
    }
}
