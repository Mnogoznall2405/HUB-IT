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
