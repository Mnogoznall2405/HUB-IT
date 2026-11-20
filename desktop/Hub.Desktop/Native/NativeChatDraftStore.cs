using System.IO;
using System.Text;
using System.Text.Json;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Native;

/// <summary>
/// Клиентские черновики чата (как web chatDraftsStorage): текст в композиторе,
/// не отправленный на сервер, переживает переключение диалогов и перезапуск.
/// Хранилище — JSON-файл chat-drafts.&lt;userId&gt;.json в каталоге настроек
/// (DesktopPaths.Root), атомарная запись temp+move. На Load прогоняется sweep:
/// записи старше 30 дней и хвост сверх 200 самых свежих удаляются — как в web.
/// На выходе из сессии файл удаляется (ClearAll) — черновики это пользовательский
/// текст в открытом виде и не должны переживать сессию на общей машине.
/// </summary>
public interface INativeChatDraftStore
{
    /// <summary>convId → текст; уже после sweep по TTL/лимиту.</summary>
    IReadOnlyDictionary<string, string> Load();

    /// <summary>Записать/заменить черновик; null или пустой текст — удалить.</summary>
    void Save(string conversationId, string? text);

    /// <summary>Удалить все черновики пользователя (logout).</summary>
    void ClearAll();
}

public sealed class NativeChatDraftStore : INativeChatDraftStore
{
    private const int SchemaVersion = 1;
    private const int MaximumDraftsBytes = 512 * 1024;

    /// <summary>CHAT_DRAFT_TTL_MS из web — 30 суток.</summary>
    public static readonly TimeSpan DraftTtl = TimeSpan.FromDays(30);

    /// <summary>CHAT_DRAFT_MAX_KEYS из web.</summary>
    public const int MaxDrafts = 200;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly object _sync = new();
    private readonly Func<DateTimeOffset> _now;
    private readonly long _userId;

    public NativeChatDraftStore(
        long userId,
        string? directory = null,
        Func<DateTimeOffset>? now = null)
    {
        _userId = userId;
        DirectoryPath = Path.GetFullPath(
            string.IsNullOrWhiteSpace(directory) ? DesktopPaths.Root : directory);
        DraftsFilePath = Path.Combine(
            DirectoryPath,
            string.Create(
                System.Globalization.CultureInfo.InvariantCulture,
                $"chat-drafts.{userId}.json"));
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    public string DirectoryPath { get; }

    public string DraftsFilePath { get; }

    public IReadOnlyDictionary<string, string> Load()
    {
        lock (_sync)
        {
            var drafts = ReadDraftsUnsafe();
            var kept = Sweep(drafts) ?? drafts;
            return kept.ToDictionary(
                pair => pair.Key,
                pair => pair.Value.Text,
                StringComparer.Ordinal);
        }
    }

    public void Save(string conversationId, string? text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(conversationId);
        lock (_sync)
        {
            var drafts = ReadDraftsUnsafe();
            if (string.IsNullOrWhiteSpace(text))
            {
                // Пустой composer — черновика нет (как removeItem в web).
                if (!drafts.Remove(conversationId))
                {
                    return;
                }
            }
            else
            {
                drafts[conversationId] = new ChatDraftEntry(text, _now());
            }

            WriteDraftsUnsafe(drafts);
        }
    }

    public void ClearAll()
    {
        lock (_sync)
        {
            try
            {
                File.Delete(DraftsFilePath);
                File.Delete(DraftsFilePath + ".tmp");
            }
            catch (Exception exception) when (
                exception is IOException or UnauthorizedAccessException)
            {
                // Черновики best-effort: залоченный файл добьёт TTL-свип позже.
            }
        }
    }

    /// <summary>
    /// Прогон sweepChatDrafts из web: старше TTL и хвост сверх MaxDrafts
    /// (сортировка по saved_at desc) выкидываются; возвращает новую карту,
    /// если что-то удалено, и сразу сохраняет результат.
    /// </summary>
    private Dictionary<string, ChatDraftEntry>? Sweep(Dictionary<string, ChatDraftEntry> drafts)
    {
        var now = _now();
        var fresh = drafts
            .OrderByDescending(pair => pair.Value.SavedAt)
            .Take(MaxDrafts)
            .Where(pair => now - pair.Value.SavedAt <= DraftTtl)
            .ToDictionary(pair => pair.Key, pair => pair.Value, StringComparer.Ordinal);
        if (fresh.Count == drafts.Count)
        {
            return null;
        }

        WriteDraftsUnsafe(fresh);
        return fresh;
    }

    private Dictionary<string, ChatDraftEntry> ReadDraftsUnsafe()
    {
        try
        {
            if (!File.Exists(DraftsFilePath))
            {
                return new Dictionary<string, ChatDraftEntry>(StringComparer.Ordinal);
            }

            var info = new FileInfo(DraftsFilePath);
            if (info.Length is <= 0 or > MaximumDraftsBytes)
            {
                return new Dictionary<string, ChatDraftEntry>(StringComparer.Ordinal);
            }

            var document = JsonSerializer.Deserialize<ChatDraftsDocument>(
                File.ReadAllText(DraftsFilePath, Encoding.UTF8), JsonOptions);
            if (document?.SchemaVersion != SchemaVersion || document.Drafts is null)
            {
                return new Dictionary<string, ChatDraftEntry>(StringComparer.Ordinal);
            }

            var drafts = new Dictionary<string, ChatDraftEntry>(StringComparer.Ordinal);
            foreach (var (conversationId, entry) in document.Drafts)
            {
                if (string.IsNullOrWhiteSpace(conversationId)
                    || string.IsNullOrWhiteSpace(entry?.Text))
                {
                    continue;
                }

                drafts[conversationId] = entry!;
            }

            return drafts;
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException or JsonException)
        {
            // Битый файл черновиков — не ошибка: стартуем с пустой карты.
            return new Dictionary<string, ChatDraftEntry>(StringComparer.Ordinal);
        }
    }

    private void WriteDraftsUnsafe(Dictionary<string, ChatDraftEntry> drafts)
    {
        try
        {
            Directory.CreateDirectory(DirectoryPath);
            var temporaryPath = DraftsFilePath + ".tmp";
            var document = new ChatDraftsDocument(SchemaVersion, drafts);
            File.WriteAllText(
                temporaryPath,
                JsonSerializer.Serialize(document, JsonOptions),
                new UTF8Encoding(false));
            File.Move(temporaryPath, DraftsFilePath, overwrite: true);
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            // Best-effort, как localStorage в web: память в VM и так ведёт черновики.
        }
    }

    private sealed record ChatDraftsDocument(
        int SchemaVersion,
        Dictionary<string, ChatDraftEntry>? Drafts);

    private sealed record ChatDraftEntry(string Text, DateTimeOffset SavedAt);

    /// <summary>Пользователь файла — для диагностики/тестов.</summary>
    internal long UserId => _userId;
}
