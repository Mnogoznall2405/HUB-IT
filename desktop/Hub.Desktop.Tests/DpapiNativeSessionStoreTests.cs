using System.Text;
using Hub.Desktop.Native.Api;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DpapiNativeSessionStoreTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        "hub-desktop-native-session-tests",
        Guid.NewGuid().ToString("N"));

    [Fact]
    public async Task MissingFileReturnsNull()
    {
        var store = CreateStore();

        Assert.Null(await store.LoadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task SavesAndLoadsSessionAcrossInstances()
    {
        var session = CreateSession();
        var first = CreateStore();
        var second = CreateStore();

        await first.SaveAsync(session, CancellationToken.None);
        var loaded = await second.LoadAsync(CancellationToken.None);

        Assert.Equal(session, loaded);
        var onDisk = await File.ReadAllBytesAsync(first.SessionFilePath);
        Assert.Equal(-1, IndexOf(onDisk, Encoding.UTF8.GetBytes(session.AccessToken)));
        Assert.Equal(-1, IndexOf(onDisk, Encoding.UTF8.GetBytes(session.RefreshToken)));
    }

    [Fact]
    public async Task CorruptFileReturnsNull()
    {
        var store = CreateStore();
        Directory.CreateDirectory(store.DirectoryPath);
        await File.WriteAllBytesAsync(
            store.SessionFilePath,
            Encoding.UTF8.GetBytes("{\"schema_version\":1,\"session\":{}}"));

        Assert.Null(await store.LoadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task RandomBytesFileReturnsNull()
    {
        var store = CreateStore();
        Directory.CreateDirectory(store.DirectoryPath);
        await File.WriteAllBytesAsync(
            store.SessionFilePath,
            [1, 2, 3, 4, 5, 6, 7, 8]);

        Assert.Null(await store.LoadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClearRemovesSessionFile()
    {
        var store = CreateStore();
        await store.SaveAsync(CreateSession(), CancellationToken.None);
        Assert.True(File.Exists(store.SessionFilePath));

        await store.ClearAsync(CancellationToken.None);

        Assert.False(File.Exists(store.SessionFilePath));
        Assert.Null(await store.LoadAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClientDeviceIdIsStableAcrossCallsAndInstances()
    {
        var first = CreateStore();
        var second = CreateStore();

        var created = await first.GetOrCreateClientDeviceIdAsync(CancellationToken.None);

        Assert.StartsWith("desktop-", created, StringComparison.Ordinal);
        Assert.Equal(created, await first.GetOrCreateClientDeviceIdAsync(CancellationToken.None));
        Assert.Equal(created, await second.GetOrCreateClientDeviceIdAsync(CancellationToken.None));
    }

    [Fact]
    public async Task ClientDeviceIdSurvivesSessionClear()
    {
        var store = CreateStore();
        var deviceId = await store.GetOrCreateClientDeviceIdAsync(CancellationToken.None);
        await store.SaveAsync(CreateSession(), CancellationToken.None);

        await store.ClearAsync(CancellationToken.None);

        Assert.Equal(deviceId, await store.GetOrCreateClientDeviceIdAsync(CancellationToken.None));
        Assert.True(File.Exists(store.DeviceIdFilePath));
    }

    [Fact]
    public async Task ConcurrentSaveAndLoadDoNotCorrupt()
    {
        var store = CreateStore();
        var session = CreateSession();
        await store.SaveAsync(session, CancellationToken.None);

        var tasks = Enumerable.Range(0, 16)
            .Select(index => (Task)(index % 2 == 0
                ? store.SaveAsync(session, CancellationToken.None)
                : store.LoadAsync(CancellationToken.None)))
            .ToArray();

        await Task.WhenAll(tasks);

        Assert.Equal(session, await store.LoadAsync(CancellationToken.None));
    }

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private DpapiNativeSessionStore CreateStore() => new(_root);

    private static NativeSession CreateSession() => new(
        "access-token-123",
        "refresh-token-456",
        "desktop-device-1",
        DateTimeOffset.UtcNow.AddMinutes(15),
        42,
        "tester",
        "Test User");

    private static int IndexOf(byte[] haystack, byte[] needle)
    {
        for (var i = 0; i <= haystack.Length - needle.Length; i++)
        {
            var match = true;
            for (var j = 0; j < needle.Length && match; j++)
            {
                match = haystack[i + j] == needle[j];
            }

            if (match)
            {
                return i;
            }
        }

        return -1;
    }
}
