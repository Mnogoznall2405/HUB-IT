using Hub.Desktop.Autostart;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class WindowsAutostartServiceTests
{
    private const string ExecutablePath = @"C:\Program Files\HUB-IT\HUB.Desktop.exe";

    [Fact]
    public void EnablesAutostartWithQuotedBackgroundCommand()
    {
        var registry = new FakeAutostartRegistry();
        var service = new WindowsAutostartService(ExecutablePath, registry);

        service.SetEnabled(true);

        Assert.Equal("HUB-IT Desktop", registry.ValueName);
        Assert.Equal($"\"{ExecutablePath}\" --background", registry.Value);
        Assert.Equal(service.Command, registry.Value);
        Assert.True(registry.Preference);
        Assert.True(service.IsEnabled);
    }

    [Fact]
    public void DisablesOnlyTheDesktopAutostartValue()
    {
        var registry = new FakeAutostartRegistry { Value = "stale" };
        var service = new WindowsAutostartService(ExecutablePath, registry);

        service.SetEnabled(false);

        Assert.Equal("HUB-IT Desktop", registry.DeletedValueName);
        Assert.Null(registry.Value);
        Assert.False(registry.Preference);
        Assert.False(service.IsEnabled);
    }

    [Fact]
    public void EnablesAutostartOnFirstLaunch()
    {
        var registry = new FakeAutostartRegistry();
        var service = new WindowsAutostartService(ExecutablePath, registry);

        service.EnsureEnabledByDefault();

        Assert.Equal(service.Command, registry.Value);
        Assert.True(registry.Preference);
        Assert.True(service.IsEnabled);
    }

    [Fact]
    public void KeepsAutostartDisabledAfterUserOptOut()
    {
        var registry = new FakeAutostartRegistry { Preference = false };
        var service = new WindowsAutostartService(ExecutablePath, registry);

        service.EnsureEnabledByDefault();

        Assert.Null(registry.Value);
        Assert.False(registry.Preference);
        Assert.False(service.IsEnabled);
    }

    [Fact]
    public void RepairsAutostartCommandWhenEnabledPathChanges()
    {
        var registry = new FakeAutostartRegistry
        {
            Preference = true,
            Value = "\"C:\\Old\\HUB.Desktop.exe\" --background",
        };
        var service = new WindowsAutostartService(ExecutablePath, registry);

        service.EnsureEnabledByDefault();

        Assert.Equal(service.Command, registry.Value);
        Assert.True(registry.Preference);
        Assert.True(service.IsEnabled);
    }

    [Fact]
    public void DoesNotTreatAStaleExecutableAsEnabled()
    {
        var registry = new FakeAutostartRegistry
        {
            Value = "\"C:\\Old\\HUB.Desktop.exe\" --background",
        };
        var service = new WindowsAutostartService(ExecutablePath, registry);

        Assert.False(service.IsEnabled);
    }

    [Theory]
    [InlineData("--background")]
    [InlineData("--BACKGROUND")]
    public void RecognizesBackgroundStartupArgument(string argument)
    {
        Assert.True(WindowsAutostartService.IsBackgroundLaunch([argument]));
    }

    [Fact]
    public void IgnoresUnrelatedStartupArguments()
    {
        Assert.False(WindowsAutostartService.IsBackgroundLaunch(["--other"]));
        Assert.False(WindowsAutostartService.IsBackgroundLaunch(null));
    }

    [Fact]
    public void RejectsCommandsBeyondTheWindowsRunLimit()
    {
        var oversizedPath = $"C:\\{new string('x', WindowsAutostartService.MaximumCommandLength)}.exe";

        Assert.Throws<ArgumentException>(() =>
            new WindowsAutostartService(oversizedPath, new FakeAutostartRegistry()));
    }

    private sealed class FakeAutostartRegistry : IAutostartRegistry
    {
        public string? Value { get; set; }

        public string? ValueName { get; private set; }

        public string? DeletedValueName { get; private set; }

        public bool? Preference { get; set; }

        public string? Read(string valueName)
        {
            ValueName = valueName;
            return Value;
        }

        public void Write(string valueName, string command)
        {
            ValueName = valueName;
            Value = command;
        }

        public void Delete(string valueName)
        {
            DeletedValueName = valueName;
            Value = null;
        }

        public bool? ReadPreference(string valueName) => Preference;

        public void WritePreference(string valueName, bool enabled)
        {
            Preference = enabled;
        }
    }
}
