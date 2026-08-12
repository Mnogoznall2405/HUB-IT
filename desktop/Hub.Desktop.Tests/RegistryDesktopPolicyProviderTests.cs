using Hub.Desktop.Configuration;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class RegistryDesktopPolicyProviderTests
{
    [Fact]
    public void MissingPolicyReturnsUserChoiceAndSafeDefaults()
    {
        var registry = new FakeDesktopPolicyRegistry();
        var policy = new RegistryDesktopPolicyProvider(registry).Load();

        Assert.Equal(DesktopAutostartMode.UserChoice, policy.AutostartMode);
        Assert.True(policy.ResolveUpdatesEnabled(configuredDefault: true));
        Assert.False(policy.ResolveUpdatesEnabled(configuredDefault: false));
        Assert.Equal(24, policy.ResolveUpdateDeferralHours(defaultHours: 24));
        Assert.True(policy.ResolveDiagnosticsExportEnabled(defaultEnabled: true));
        Assert.True(policy.ResolveNotificationFallbackEnabled(defaultEnabled: true));
        Assert.Equal(
            [
                "AutostartMode",
                "UpdatesEnabled",
                "UpdateDeferralHours",
                "DiagnosticsExportEnabled",
                "NotificationFallbackEnabled",
            ],
            registry.ReadNames);
    }

    [Fact]
    public void ReadsOnlyStrictDwordPolicyValues()
    {
        var registry = new FakeDesktopPolicyRegistry(new Dictionary<string, object?>
        {
            ["AutostartMode"] = 1,
            ["UpdatesEnabled"] = 0,
            ["UpdateDeferralHours"] = 72,
            ["DiagnosticsExportEnabled"] = 0,
            ["NotificationFallbackEnabled"] = 0,
        });

        var policy = new RegistryDesktopPolicyProvider(registry).Load();

        Assert.Equal(DesktopAutostartMode.ForcedOn, policy.AutostartMode);
        Assert.False(policy.ResolveUpdatesEnabled(configuredDefault: true));
        Assert.Equal(72, policy.ResolveUpdateDeferralHours(defaultHours: 24));
        Assert.False(policy.ResolveDiagnosticsExportEnabled(defaultEnabled: true));
        Assert.False(policy.ResolveNotificationFallbackEnabled(defaultEnabled: true));
    }

    [Fact]
    public void RejectsInvalidTypesAndOutOfRangeValuesWithoutFailingOpen()
    {
        var registry = new FakeDesktopPolicyRegistry(new Dictionary<string, object?>
        {
            ["AutostartMode"] = 99,
            ["UpdatesEnabled"] = "0",
            ["UpdateDeferralHours"] = DesktopPolicy.MaximumUpdateDeferralHours + 1,
            ["DiagnosticsExportEnabled"] = -1,
            ["NotificationFallbackEnabled"] = 2,
        });

        var policy = new RegistryDesktopPolicyProvider(registry).Load();

        Assert.Equal(DesktopAutostartMode.UserChoice, policy.AutostartMode);
        Assert.True(policy.ResolveUpdatesEnabled(configuredDefault: true));
        Assert.Equal(24, policy.ResolveUpdateDeferralHours(defaultHours: 24));
        Assert.True(policy.ResolveDiagnosticsExportEnabled(defaultEnabled: true));
        Assert.True(policy.ResolveNotificationFallbackEnabled(defaultEnabled: true));
    }

    [Theory]
    [InlineData(0, DesktopAutostartMode.UserChoice)]
    [InlineData(1, DesktopAutostartMode.ForcedOn)]
    [InlineData(2, DesktopAutostartMode.ForcedOff)]
    public void MapsDocumentedAutostartModes(int value, DesktopAutostartMode expected)
    {
        var registry = new FakeDesktopPolicyRegistry(new Dictionary<string, object?>
        {
            ["AutostartMode"] = value,
        });

        Assert.Equal(expected, new RegistryDesktopPolicyProvider(registry).Load().AutostartMode);
    }

    private sealed class FakeDesktopPolicyRegistry(
        IReadOnlyDictionary<string, object?>? values = null) : IDesktopPolicyRegistry
    {
        private readonly IReadOnlyDictionary<string, object?> _values =
            values ?? new Dictionary<string, object?>();

        public List<string> ReadNames { get; } = [];

        public object? Read(string valueName)
        {
            ReadNames.Add(valueName);
            return _values.TryGetValue(valueName, out var value) ? value : null;
        }
    }
}
