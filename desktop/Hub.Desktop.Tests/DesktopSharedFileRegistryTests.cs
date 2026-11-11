using Hub.Desktop.Transfers;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopSharedFileRegistryTests
{
    private static readonly Uri TrustedBaseUri = new("https://hub.test");

    [Fact]
    public void RegistersSingleFileWithTokenizedUrl()
    {
        var directory = CreateTempDirectory();
        var file = Path.Combine(directory, "report.pdf");
        File.WriteAllBytes(file, new byte[7]);

        var registry = new DesktopSharedFileRegistry(TrustedBaseUri);
        var files = registry.Register(new[] { file });

        var descriptor = Assert.Single(files);
        Assert.Equal("report.pdf", descriptor.Name);
        Assert.Equal(7, descriptor.Size);
        Assert.Null(descriptor.RelativePath);
        Assert.StartsWith("https://hub.test/__desktop_share__/", descriptor.Url);

        var token = descriptor.Url.Split('/').Last();
        Assert.True(registry.TryGetFilePath(
            new Uri($"https://hub.test/__desktop_share__/{token}"),
            out var resolved));
        Assert.Equal(file, resolved);
        Assert.False(registry.TryGetFilePath(
            new Uri("https://hub.test/__desktop_share__/unknown"),
            out _));
        Assert.False(registry.TryGetFilePath(
            new Uri("https://hub.test/other/path"),
            out _));
    }

    [Fact]
    public void ExpiredTokensStopResolvingAndClearForgetsEverything()
    {
        var directory = CreateTempDirectory();
        var file = Path.Combine(directory, "old.txt");
        File.WriteAllText(file, "x");
        var clock = new ManualTimeProvider();
        var registry = new DesktopSharedFileRegistry(TrustedBaseUri, clock, TimeSpan.FromMinutes(10));

        var url = new Uri(registry.Register(new[] { file }).Single().Url);
        clock.Advance(TimeSpan.FromMinutes(9));
        Assert.True(registry.TryGetFilePath(url, out _));

        clock.Advance(TimeSpan.FromMinutes(2));
        Assert.False(registry.TryGetFilePath(url, out _));

        var fresh = new Uri(registry.Register(new[] { file }).Single().Url);
        Assert.True(registry.TryGetFilePath(fresh, out _));
        registry.Clear();
        Assert.False(registry.TryGetFilePath(fresh, out _));
    }

    [Fact]
    public void TotalRegisteredFilesAreBoundedByDroppingTheOldest()
    {
        var directory = CreateTempDirectory();
        var clock = new ManualTimeProvider();
        var registry = new DesktopSharedFileRegistry(TrustedBaseUri, clock);
        Uri? first = null;
        Uri? last = null;
        for (var index = 0; index < DesktopSharedFileRegistry.MaximumRegisteredFiles + 1; index++)
        {
            var file = Path.Combine(directory, $"f{index}.txt");
            File.WriteAllText(file, "x");
            clock.Advance(TimeSpan.FromSeconds(1));
            var url = new Uri(registry.Register(new[] { file }).Single().Url);
            first ??= url;
            last = url;
        }

        Assert.False(registry.TryGetFilePath(first, out _));
        Assert.True(registry.TryGetFilePath(last, out _));
    }

    private sealed class ManualTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 11, 2, 12, 0, 0, TimeSpan.Zero);

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan delta) => _now += delta;
    }

    [Fact]
    public void RegisterIsIdempotentPerPath()
    {
        var directory = CreateTempDirectory();
        var file = Path.Combine(directory, "a.txt");
        File.WriteAllText(file, "x");

        var registry = new DesktopSharedFileRegistry(TrustedBaseUri);
        var first = registry.Register(new[] { file }).Single();
        var second = registry.Register(new[] { file }).Single();

        Assert.Equal(first.Url, second.Url);
    }

    [Fact]
    public void ExpandsDirectoryIntoRelativePathEntries()
    {
        var directory = CreateTempDirectory();
        var root = Path.Combine(directory, "Docs");
        var nested = Path.Combine(root, "sub");
        Directory.CreateDirectory(nested);
        var fileA = Path.Combine(root, "a.txt");
        var fileB = Path.Combine(nested, "b.txt");
        File.WriteAllText(fileA, "a");
        File.WriteAllText(fileB, "bb");

        var registry = new DesktopSharedFileRegistry(TrustedBaseUri);
        var files = registry.Register(new[] { root });

        Assert.Equal(2, files.Count);
        var byName = files.OrderBy(f => f.Name).ToList();
        Assert.Equal("a.txt", byName[0].Name);
        Assert.Equal("Docs/a.txt", byName[0].RelativePath);
        Assert.Equal("b.txt", byName[1].Name);
        Assert.Equal("Docs/sub/b.txt", byName[1].RelativePath);
        Assert.All(files, f => Assert.StartsWith("https://hub.test/__desktop_share__/", f.Url));
    }

    [Fact]
    public void SkipsMissingAndEmptyEntries()
    {
        var registry = new DesktopSharedFileRegistry(TrustedBaseUri);
        var files = registry.Register(new[] { "", "C:\\definitely\\missing\\file.bin" });
        Assert.Empty(files);
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"hub-share-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
