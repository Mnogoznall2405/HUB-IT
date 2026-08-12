using Hub.Desktop.Diagnostics;
using Microsoft.Win32;

namespace Hub.Desktop.Configuration;

public sealed class RegistryDesktopPolicyProvider
{
    public const string PolicyKeyPath = @"Software\Policies\HUB-IT\Desktop";
    private readonly IDesktopPolicyRegistry _registry;

    public RegistryDesktopPolicyProvider()
        : this(new LocalMachineDesktopPolicyRegistry())
    {
    }

    internal RegistryDesktopPolicyProvider(IDesktopPolicyRegistry registry)
    {
        _registry = registry ?? throw new ArgumentNullException(nameof(registry));
    }

    public DesktopPolicy Load()
    {
        var autostartValue = ReadDword("AutostartMode");
        var updatesValue = ReadDword("UpdatesEnabled");
        var deferralValue = ReadDword("UpdateDeferralHours");
        var diagnosticsValue = ReadDword("DiagnosticsExportEnabled");
        var fallbackValue = ReadDword("NotificationFallbackEnabled");

        return new DesktopPolicy(
            ParseAutostartMode(autostartValue),
            ParseBoolean(updatesValue),
            deferralValue is >= 0 and <= DesktopPolicy.MaximumUpdateDeferralHours
                ? deferralValue
                : null,
            ParseBoolean(diagnosticsValue),
            ParseBoolean(fallbackValue));
    }

    private int? ReadDword(string valueName)
    {
        try
        {
            var value = _registry.Read(valueName);
            if (value is null)
            {
                return null;
            }

            if (value is int number)
            {
                return number;
            }

            DesktopLog.Warning($"Ignored non-DWORD Desktop policy; name={valueName}");
            return null;
        }
        catch (Exception exception)
        {
            DesktopLog.Warning(
                $"Desktop policy could not be read; name={valueName}; error_type={exception.GetType().Name}");
            return null;
        }
    }

    private static DesktopAutostartMode ParseAutostartMode(int? value) => value switch
    {
        (int)DesktopAutostartMode.ForcedOn => DesktopAutostartMode.ForcedOn,
        (int)DesktopAutostartMode.ForcedOff => DesktopAutostartMode.ForcedOff,
        _ => DesktopAutostartMode.UserChoice,
    };

    private static bool? ParseBoolean(int? value) => value switch
    {
        0 => false,
        1 => true,
        _ => null,
    };

    private sealed class LocalMachineDesktopPolicyRegistry : IDesktopPolicyRegistry
    {
        public object? Read(string valueName)
        {
            using var baseKey = RegistryKey.OpenBaseKey(
                RegistryHive.LocalMachine,
                RegistryView.Registry64);
            using var key = baseKey.OpenSubKey(PolicyKeyPath, writable: false);
            return key?.GetValue(
                valueName,
                defaultValue: null,
                RegistryValueOptions.DoNotExpandEnvironmentNames);
        }
    }
}

internal interface IDesktopPolicyRegistry
{
    object? Read(string valueName);
}
