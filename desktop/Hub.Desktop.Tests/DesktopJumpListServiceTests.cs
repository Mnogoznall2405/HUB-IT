using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopJumpListServiceTests
{
    [Fact]
    public void EntriesContainOnlyGenericBoundedCommands()
    {
        var entries = DesktopJumpListService.CreateEntries();

        Assert.Equal(5, entries.Count);
        Assert.All(entries, entry =>
        {
            Assert.True(entry.Arguments.StartsWith("--route /", StringComparison.Ordinal)
                || entry.Arguments == "--downloads");
            Assert.DoesNotContain('?', entry.Arguments);
            Assert.DoesNotContain("ticket", entry.Arguments, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("conversation", entry.Arguments, StringComparison.OrdinalIgnoreCase);
        });
    }
}
