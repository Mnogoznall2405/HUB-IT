using Hub.Desktop.Native;

namespace Hub.Desktop.Tests.Fakes;

/// <summary>
/// In-memory INativeChatDraftStore: тесты VM проверяют вызовы Save/ClearAll
/// и подсовывают начальные черновики через StoredDrafts без реального диска.
/// </summary>
public sealed class FakeChatDraftStore : INativeChatDraftStore
{
    private readonly Dictionary<string, string> _drafts = new(StringComparer.Ordinal);

    /// <summary>Начальное содержимое, возвращаемое Load().</summary>
    public Dictionary<string, string> StoredDrafts => _drafts;

    /// <summary>История коммитов (convId, text|null) — проверка порядка/значений.</summary>
    public List<(string ConversationId, string? Text)> SaveCalls { get; } = [];

    public int ClearAllCalls { get; private set; }

    public IReadOnlyDictionary<string, string> Load() =>
        new Dictionary<string, string>(_drafts, StringComparer.Ordinal);

    public void Save(string conversationId, string? text)
    {
        SaveCalls.Add((conversationId, text));
        if (string.IsNullOrWhiteSpace(text))
        {
            _drafts.Remove(conversationId);
        }
        else
        {
            _drafts[conversationId] = text;
        }
    }

    public void ClearAll()
    {
        ClearAllCalls++;
        _drafts.Clear();
    }
}
