using System.IO;
using Microsoft.Win32;

namespace Hub.Desktop.Remote;

public readonly record struct DesktopVncProtocolRegistration(
    bool HasUrlProtocolMarker,
    string? OpenCommand);

public sealed class DesktopVncHandlerProbe
{
    private static readonly (RegistryHive Hive, RegistryView View)[] SearchLocations =
    [
        (RegistryHive.CurrentUser, RegistryView.Registry64),
        (RegistryHive.CurrentUser, RegistryView.Registry32),
        (RegistryHive.LocalMachine, RegistryView.Registry64),
        (RegistryHive.LocalMachine, RegistryView.Registry32),
    ];

    private readonly Func<RegistryHive, RegistryView, DesktopVncProtocolRegistration> _readRegistration;

    public DesktopVncHandlerProbe()
        : this(ReadRegistration)
    {
    }

    public DesktopVncHandlerProbe(
        Func<RegistryHive, RegistryView, DesktopVncProtocolRegistration> readRegistration)
    {
        _readRegistration = readRegistration ?? throw new ArgumentNullException(nameof(readRegistration));
    }

    public bool IsAvailable()
    {
        foreach (var (hive, view) in SearchLocations)
        {
            try
            {
                var registration = _readRegistration(hive, view);
                if (registration.HasUrlProtocolMarker
                    && !string.IsNullOrWhiteSpace(registration.OpenCommand))
                {
                    return true;
                }
            }
            catch (Exception exception) when (
                exception is UnauthorizedAccessException
                or IOException
                or System.Security.SecurityException)
            {
                // A protected or unreadable registry view is treated as unavailable.
            }
        }

        return false;
    }

    private static DesktopVncProtocolRegistration ReadRegistration(
        RegistryHive hive,
        RegistryView view)
    {
        using var baseKey = RegistryKey.OpenBaseKey(hive, view);
        using var protocolKey = baseKey.OpenSubKey(@"Software\Classes\vnc", writable: false);
        if (protocolKey is null)
        {
            return default;
        }

        var hasMarker = protocolKey.GetValueNames().Any(name =>
            string.Equals(name, "URL Protocol", StringComparison.OrdinalIgnoreCase));
        using var commandKey = protocolKey.OpenSubKey(@"shell\open\command", writable: false);
        var command = commandKey?.GetValue(null) as string;
        return new DesktopVncProtocolRegistration(hasMarker, command);
    }
}
