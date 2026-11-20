using Hub.Desktop.Native;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Клиентские черновики чата (parity web chatDraftsStorage.js): файловый
/// NativeChatDraftStore (TTL 30d, cap 200, atomic write) + поведение VM
/// (debounce-запись, flush/restore при смене диалога, очистка на send/logout).
/// </summary>
public sealed class NativeChatDraftTests
{
    // ---- Файловый стор ----

    [Fact]
    public void StoreSavesLoadsAndRemovesDraftsPerUserFile()
    {
        using var directory = new TempDirectory();
        var store = new NativeChatDraftStore(42, directory.Path);

        Assert.EndsWith($"chat-drafts.42.json", store.DraftsFilePath, StringComparison.Ordinal);

        store.Save("c1", "привет");
        store.Save("c2", "  ");   // пробел — не черновик
        Assert.Equal(new Dictionary<string, string> { ["c1"] = "привет" }, store.Load());

        store.Save("c1", null);  // пустой composer снимает запись
        Assert.Empty(store.Load());
        Assert.True(File.Exists(store.DraftsFilePath));

        // Соседний пользователь — свой файл, чужие черновики не подтягиваются.
        var other = new NativeChatDraftStore(7, directory.Path);
        Assert.Empty(other.Load());
        Assert.NotEqual(store.DraftsFilePath, other.DraftsFilePath);
    }

    [Fact]
    public void StoreSweepDropsExpiredAndCapsAt200()
    {
        using var directory = new TempDirectory();
        var now = DateTimeOffset.UtcNow;
        var store = new NativeChatDraftStore(1, directory.Path, () => now);

        for (var index = 0; index < NativeChatDraftStore.MaxDrafts + 5; index++)
        {
            store.Save($"c{index:000}", $"draft {index}");
        }

        // Load всегда sweep'ит: лимит 200 самых свежих уже применён.
        Assert.Equal(NativeChatDraftStore.MaxDrafts, store.Load().Count);

        // Старим все записи дальше TTL — sweep их выкидывает.
        now += NativeChatDraftStore.DraftTtl + TimeSpan.FromDays(1);
        Assert.Empty(store.Load());
    }

    [Fact]
    public void StoreLoadCapsFreshEntriesAt200()
    {
        using var directory = new TempDirectory();
        var now = DateTimeOffset.UtcNow;
        var store = new NativeChatDraftStore(1, directory.Path, () => now);
        for (var index = 0; index < NativeChatDraftStore.MaxDrafts + 10; index++)
        {
            store.Save($"c{index:000}", $"draft {index}");
            now += TimeSpan.FromSeconds(1);   // метки по возрастанию — самый свежий последний
        }

        var loaded = store.Load();
        Assert.Equal(NativeChatDraftStore.MaxDrafts, loaded.Count);
        // Самые свежие выживают — c209 … c010 (сортировка saved_at desc).
        Assert.True(loaded.ContainsKey("c209"));
        Assert.False(loaded.ContainsKey("c000"));
    }

    [Fact]
    public void StoreMalformedFileLoadsEmptyAndClearAllDeletesFile()
    {
        using var directory = new TempDirectory();
        var store = new NativeChatDraftStore(1, directory.Path);
        Directory.CreateDirectory(directory.Path);
        File.WriteAllText(store.DraftsFilePath, "{ not json !");

        Assert.Empty(store.Load());

        store.Save("c1", "x");
        Assert.True(File.Exists(store.DraftsFilePath));
        store.ClearAll();
        Assert.False(File.Exists(store.DraftsFilePath));
        Assert.Empty(store.Load());
    }

    // ---- Поведение VM ----

    [Fact]
    public async Task ComposerChangePersistsDraftAfterDebounce()
    {
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1");
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);

        model.ComposerText = "незаконченная мысль";

        await WaitFor(() => store.SaveCalls.Any(c => c is { ConversationId: "c1", Text: "незаконченная мысль" }));
        Assert.True(model.Conversations[0].HasDraft);
        Assert.Equal("незаконченная мысль", model.Conversations[0].DraftText);
    }

    [Fact]
    public async Task EmptyComposerRemovesPersistedDraft()
    {
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1");
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "черновик";
        await WaitFor(() => store.SaveCalls.Any(c => c.Text == "черновик"));

        model.ComposerText = string.Empty;

        await WaitFor(() => store.SaveCalls.Any(c => c is { ConversationId: "c1", Text: null }));
        Assert.False(model.Conversations[0].HasDraft);
    }

    [Fact]
    public async Task SwitchFlushesOldDraftAndRestoresTarget()
    {
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1", "c2");
        var first = model.Conversations.Single(c => c.Id == "c1");
        var second = model.Conversations.Single(c => c.Id == "c2");
        model.SelectedConversation = first;
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "черновик первого";
        var focusCount = 0;
        model.FocusComposer = () => focusCount++;

        // Переключение до истечения дебаунса: черновик c1 фиксируется немедленно.
        model.SelectedConversation = second;
        var flushed = store.SaveCalls.Last();
        Assert.Equal("c1", flushed.ConversationId);
        Assert.Equal("черновик первого", flushed.Text);
        Assert.True(first.HasDraft);
        Assert.Equal(string.Empty, model.ComposerText);
        Assert.Equal(0, focusCount);

        // Обратно — текст возвращается в composer и просится фокус.
        model.SelectedConversation = first;
        Assert.Equal("черновик первого", model.ComposerText);
        Assert.Equal(1, focusCount);
    }

    [Fact]
    public async Task DraftFromStoreRestoredOnLoadAndSelection()
    {
        var store = new FakeChatDraftStore();
        store.StoredDrafts["c2"] = "сохранённый черновик";
        var (model, _) = await LoadModelAsync(store, "c1", "c2");

        var second = model.Conversations.Single(c => c.Id == "c2");
        Assert.True(second.HasDraft);
        Assert.Equal("сохранённый черновик", second.DraftText);

        var focused = false;
        model.FocusComposer = () => focused = true;
        model.SelectedConversation = second;
        Assert.Equal("сохранённый черновик", model.ComposerText);
        Assert.True(focused);
    }

    [Fact]
    public async Task SuccessfulSendClearsDraft()
    {
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1");
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "отправлю это";
        await WaitFor(() => store.SaveCalls.Any(c => c.Text == "отправлю это"));

        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        Assert.Equal(("c1", (string?)null), store.SaveCalls.Last());
        Assert.False(model.Conversations[0].HasDraft);
        Assert.Empty(store.StoredDrafts);
    }

    [Fact]
    public async Task FailedSendKeepsDraft()
    {
        var store = new FakeChatDraftStore();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList { Items = [] },
            ChatSendException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new ChatViewModel(api, new FakeChatRealtime(), store);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "важное";
        await WaitFor(() => store.SaveCalls.Any(c => c.Text == "важное"));

        await ((NativeAsyncCommand)model.SendCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Equal("важное", model.ComposerText);
        Assert.True(model.Conversations[0].HasDraft);
    }

    [Fact]
    public async Task ResetClearsAllDraftsAndStaleDebounceDoesNotResurrect()
    {
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1");
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => !model.IsLoadingMessages);
        model.ComposerText = "не успел дотикать дебаунс";
        var callsBeforeReset = store.SaveCalls.Count;

        model.Reset();

        Assert.Equal(1, store.ClearAllCalls);
        Assert.Empty(store.StoredDrafts);
        // Подвисший тик дебаунса не должен записывать после выхода.
        await Task.Delay(600);
        Assert.Equal(callsBeforeReset, store.SaveCalls.Count);
    }

    [Fact]
    public async Task TypingIndicatorCoexistsWithDraftRowFlag()
    {
        // Приоритет «печатает…» над черновиком реализован в шаблоне строки;
        // VM должна держать оба флага одновременно — черновик не стирается.
        var store = new FakeChatDraftStore();
        var (model, _) = await LoadModelAsync(store, "c1");
        var row = model.Conversations[0];
        row.SetDraft("набранное");

        row.SetTyping("Пётр печатает…");

        Assert.True(row.IsTyping);
        Assert.True(row.HasDraft);
        row.SetTyping(null);
        Assert.False(row.IsTyping);
        Assert.Equal("набранное", row.DraftText);
    }

    [Fact]
    public async Task EditSessionKeepsDraftAndCancelRestoresIt()
    {
        var store = new FakeChatDraftStore();
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList { Items = [Conv("c1")] },
            ChatMessages = new HubChatMessageList
            {
                Items = [Msg("m1", "c1", "исходный текст", DateTimeOffset.UtcNow, own: true)],
            },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime(), store);
        await model.LoadAsync();
        model.SelectedConversation = model.Conversations[0];
        await WaitFor(() => model.Messages.Count == 1 && !model.IsLoadingMessages);
        model.ComposerText = "мой черновик";
        await WaitFor(() => store.SaveCalls.Any(c => c.Text == "мой черновик"));
        var saveCountBeforeEdit = store.SaveCalls.Count;

        model.BeginEditCommand.Execute(model.Messages[0]);

        Assert.Equal("исходный текст", model.ComposerText);
        // Правка не затирает черновик ни в строке, ни в сторадже.
        Assert.True(model.Conversations[0].HasDraft);
        Assert.Equal("мой черновик", model.Conversations[0].DraftText);
        await Task.Delay(500);
        Assert.All(
            store.SaveCalls.Skip(saveCountBeforeEdit),
            call => Assert.Equal("мой черновик", call.Text));

        model.CancelComposerContextCommand.Execute(null);

        Assert.Equal("мой черновик", model.ComposerText);
    }

    // ---- Хелперы ----

    private static async Task<(ChatViewModel Model, FakeHubApiClient Api)> LoadModelAsync(
        FakeChatDraftStore store, params string[] conversationIds)
    {
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = conversationIds.Select(id => Conv(id)).ToList(),
            },
            ChatMessages = new HubChatMessageList { Items = [] },
        };
        var model = new ChatViewModel(api, new FakeChatRealtime(), store);
        await model.LoadAsync();
        return (model, api);
    }

    private static HubChatConversation Conv(string id) =>
        new()
        {
            Id = id,
            Kind = "direct",
            Title = "Диалог " + id,
            LastMessageAt = DateTimeOffset.UtcNow,
            LastMessagePreview = "preview-" + id,
            DirectPeer = new HubChatUser { Id = 9, Username = "peer-" + id, FullName = "Пользователь " + id },
        };

    private static HubChatMessage Msg(
        string id,
        string conversationId,
        string body,
        DateTimeOffset createdAt,
        bool own = false) =>
        new()
        {
            Id = id,
            ConversationId = conversationId,
            Kind = "text",
            Body = body,
            CreatedAt = createdAt,
            IsOwn = own,
            Sender = new HubChatUser { Id = 7, Username = "peer", FullName = "Пётр" },
        };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(5);
        var elapsed = TimeSpan.Zero;
        var step = TimeSpan.FromMilliseconds(20);
        while (elapsed < limit)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(step);
            elapsed += step;
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }

    /// <summary>Temp-каталог под файлы стора; удаляется вместе с тестом.</summary>
    private sealed class TempDirectory : IDisposable
    {
        public TempDirectory()
        {
            Path = System.IO.Path.Combine(
                System.IO.Path.GetTempPath(),
                "hub-draft-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(Path);
        }

        public string Path { get; }

        public void Dispose()
        {
            try
            {
                Directory.Delete(Path, recursive: true);
            }
            catch (IOException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
