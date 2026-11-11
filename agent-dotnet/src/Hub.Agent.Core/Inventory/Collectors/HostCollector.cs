using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Host identity: hostname, MAC, interactive user, IPv4 list.</summary>
public static class HostCollector
{
    private static readonly HashSet<string> ServiceAccounts = new(StringComparer.OrdinalIgnoreCase)
    {
        "system",
        "nt authority\\system",
        "local service",
        "nt authority\\local service",
        "network service",
        "nt authority\\network service",
    };

    public static string Hostname()
    {
        try
        {
            return Dns.GetHostName();
        }
        catch (Exception)
        {
            return Environment.MachineName;
        }
    }

    public static string MacAddress()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                var name = nic.Name.ToLowerInvariant();
                if (name.Contains("loopback") || name.Contains("virtual"))
                {
                    continue;
                }

                var address = nic.GetPhysicalAddress();
                if (address is null || address.GetAddressBytes().Length == 0)
                {
                    continue;
                }

                return FormatMac(address);
            }
        }
        catch (Exception)
        {
            // fall through to empty MAC
        }

        return string.Empty;
    }

    public static string FormatMac(PhysicalAddress address)
    {
        var bytes = address.GetAddressBytes();
        return string.Join('-', bytes.Select(value => value.ToString("X2")));
    }

    public static string ActiveConsoleUser()
    {
        foreach (var candidate in new[]
                 {
                     WmiUser(),
                     WtsConsoleUser(),
                     LastLoggedOnUser(),
                     Environment.UserName,
                 })
        {
            var login = NormalizeLogin(candidate);
            if (login.Length > 0 && !ServiceAccounts.Contains(login))
            {
                return login;
            }
        }

        return string.Empty;
    }

    public static string NormalizeLogin(string? value)
    {
        var login = Text.Sanitize(value);
        if (login.Length == 0)
        {
            return string.Empty;
        }

        if (login.StartsWith(@"NT AUTHORITY\", StringComparison.OrdinalIgnoreCase))
        {
            return login.ToLowerInvariant();
        }

        var separator = login.IndexOf('\\');
        if (separator >= 0 && separator < login.Length - 1)
        {
            login = login[(separator + 1)..];
        }

        return login.Trim();
    }

    public static string UserFullName(string login)
    {
        var name = NormalizeLogin(login);
        if (name.Length == 0)
        {
            return string.Empty;
        }

        var escaped = name.Replace("'", "''", StringComparison.Ordinal);
        foreach (var filter in new[]
                 {
                     $"Name='{escaped}' AND LocalAccount=FALSE",
                     $"Name='{escaped}'",
                 })
        {
            var rows = Wmi.Query(Wmi.CimV2, $"SELECT FullName,Name,Domain FROM Win32_UserAccount WHERE {filter}");
            var fullName = rows.Select(row => Wmi.Str(row, "FullName")).FirstOrDefault(value => value.Length > 0);
            if (fullName is not null)
            {
                return fullName;
            }
        }

        return string.Empty;
    }

    public static List<string> ActiveIpv4()
    {
        var values = new List<string>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up)
                {
                    continue;
                }

                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                if (nic.Name.Contains("loopback", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                foreach (var unicast in nic.GetIPProperties().UnicastAddresses)
                {
                    if (unicast.Address.AddressFamily != AddressFamily.InterNetwork)
                    {
                        continue;
                    }

                    var value = Text.Sanitize(unicast.Address.ToString());
                    if (value.Length > 0)
                    {
                        values.Add(value);
                    }
                }
            }
        }
        catch (Exception)
        {
            // return what we have
        }

        return Text.Dedupe(values);
    }

    private static string WmiUser()
    {
        var rows = Wmi.Query(Wmi.CimV2, "SELECT UserName FROM Win32_ComputerSystem");
        return rows.Count == 0 ? string.Empty : Wmi.Str(rows[0], "UserName");
    }

    private static string LastLoggedOnUser()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(
                @"SOFTWARE\Microsoft\Windows\CurrentVersion\Authentication\LogonUI");
            return Text.Sanitize(key?.GetValue("LastLoggedOnUser"));
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }

    [DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool WTSQuerySessionInformationW(
        IntPtr server,
        int sessionId,
        int infoClass,
        out IntPtr buffer,
        out int bytesReturned);

    [DllImport("wtsapi32.dll")]
    private static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("kernel32.dll")]
    private static extern uint WTSGetActiveConsoleSessionId();

    private static string WtsConsoleUser()
    {
        try
        {
            var sessionId = WTSGetActiveConsoleSessionId();
            if (sessionId == uint.MaxValue)
            {
                return string.Empty;
            }

            const int wtsUserName = 5;
            if (!WTSQuerySessionInformationW(IntPtr.Zero, (int)sessionId, wtsUserName, out var buffer, out _))
            {
                return string.Empty;
            }

            try
            {
                return Marshal.PtrToStringUni(buffer)?.Trim() ?? string.Empty;
            }
            finally
            {
                WTSFreeMemory(buffer);
            }
        }
        catch (Exception)
        {
            return string.Empty;
        }
    }
}
