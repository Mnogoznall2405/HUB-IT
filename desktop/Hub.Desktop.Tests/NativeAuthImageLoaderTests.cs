using Hub.Desktop.Native;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>Минимальная валидная картинка для тестов (1×1 PNG).</summary>
internal static class TestImageBytes
{
    public static readonly byte[] Png1X1 = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==");
}

public sealed class NativeAuthImageLoaderTests
{
    [Fact]
    public async Task LoadReturnsFrozenBitmapForImageBytes()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);

        var image = await loader.LoadAsync("/api/v1/address-book/photos/001");

        Assert.NotNull(image);
        Assert.True(image!.IsFrozen); // результат безопасен на любом потоке
        Assert.True(image.PixelWidth > 0);
        Assert.Equal("/api/v1/address-book/photos/001", Assert.Single(api.ImageDownloadCalls));
    }

    [Fact]
    public async Task LoadReturnsNullOnApiError()
    {
        var api = new FakeHubApiClient
        {
            ImageDownloadException = new HubApiException(HubApiErrorKind.Http, "404"),
        };
        var loader = new AuthImageLoader(api);

        var image = await loader.LoadAsync("/api/v1/address-book/photos/001");

        Assert.Null(image);
    }

    [Fact]
    public async Task LoadReturnsNullOnNonImageBytes()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = "не картинка"u8.ToArray() };
        var loader = new AuthImageLoader(api);

        Assert.Null(await loader.LoadAsync("equipment/5/photos/1/content?thumb=true"));
    }

    [Fact]
    public async Task SameKeySharesTaskAndHitsApiOnce()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);

        var first = loader.LoadAsync("path/one");
        var second = loader.LoadAsync("path/one");
        // Дедуп: один ключ — одна задача и один сетевой вызов.
        Assert.Same(first, second);

        Assert.NotNull(await first);
        Assert.Single(api.ImageDownloadCalls);
        Assert.Equal(1, loader.CachedCount);
    }

    [Fact]
    public async Task ConcurrentSameKeyMakesSingleApiCall()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);

        var images = await Task.WhenAll(Enumerable.Range(0, 8)
            .Select(_ => Task.Run(() => loader.LoadAsync("path/shared"))));

        Assert.All(images, Assert.NotNull);
        Assert.Single(api.ImageDownloadCalls);
    }

    [Fact]
    public async Task EmptyPathDoesNotHitApi()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api);

        Assert.Null(await loader.LoadAsync(null));
        Assert.Null(await loader.LoadAsync("   "));
        Assert.Empty(api.ImageDownloadCalls);
    }

    [Fact]
    public async Task CacheEvictsLeastRecentlyUsed()
    {
        var api = new FakeHubApiClient { ImageDownloadBytes = TestImageBytes.Png1X1 };
        var loader = new AuthImageLoader(api, capacity: 2);

        await loader.LoadAsync("a");
        await loader.LoadAsync("b");
        await loader.LoadAsync("a"); // поднимает «a» над «b»
        await loader.LoadAsync("c"); // вытесняет «b» — кэш уже полон

        Assert.Equal(3, api.ImageDownloadCalls.Count);
        Assert.Equal(2, loader.CachedCount);

        await loader.LoadAsync("a"); // свежая запись — запроса нет
        Assert.Equal(3, api.ImageDownloadCalls.Count);

        await loader.LoadAsync("b"); // вытеснена — снова сеть
        Assert.Equal(4, api.ImageDownloadCalls.Count);
    }
}
