using System.Net.NetworkInformation;
using System.Net.Sockets;
using Hub.Agent.Core.Support;

namespace Hub.Agent.Core.Inventory.Collectors;

/// <summary>Network adapters, device inventory and address summary.</summary>
public static class NetworkCollector
{
    public static Dictionary<string, object?> Collect()
    {
        var adapters = new List<Dictionary<string, object?>>();
        var activeIpv4 = new List<string>();
        var activeIpv6 = new List<string>();
        var primaryAdapter = string.Empty;

        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (nic.OperationalStatus != OperationalStatus.Up)
                {
                    continue;
                }

                if (nic.Name.Contains("loopback", StringComparison.OrdinalIgnoreCase) ||
                    nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                var ipv4 = new List<string>();
                var ipv6 = new List<string>();
                foreach (var unicast in nic.GetIPProperties().UnicastAddresses)
                {
                    var value = Text.Sanitize(unicast.Address.ToString());
                    if (value.Length == 0)
                    {
                        continue;
                    }

                    if (unicast.Address.AddressFamily == AddressFamily.InterNetworkV6)
                    {
                        ipv6.Add(value);
                        activeIpv6.Add(value);
                    }
                    else if (unicast.Address.AddressFamily == AddressFamily.InterNetwork)
                    {
                        ipv4.Add(value);
                        activeIpv4.Add(value);
                    }
                }

                if (ipv4.Count == 0 && ipv6.Count == 0)
                {
                    continue;
                }

                adapters.Add(new Dictionary<string, object?>
                {
                    ["name"] = nic.Name,
                    ["ipv4"] = ipv4,
                    ["ipv6"] = ipv6,
                    ["speed_mbps"] = (long)(nic.Speed / 1_000_000),
                });

                if (primaryAdapter.Length == 0)
                {
                    primaryAdapter = nic.Name;
                }
            }
            catch (Exception)
            {
                // skip this adapter only
            }
        }

        var devices = WindowsDevices();
        var activeByName = adapters
            .Where(item => Text.Sanitize(item.GetValueOrDefault("name")).Length > 0)
            .ToDictionary(item => Text.Sanitize(item.GetValueOrDefault("name")).ToLowerInvariant(), item => item);

        foreach (var device in devices)
        {
            var name = Text.Sanitize(device.GetValueOrDefault("name")).ToLowerInvariant();
            if (name.Length == 0 || !activeByName.TryGetValue(name, out var active))
            {
                continue;
            }

            device["ipv4"] = active.GetValueOrDefault("ipv4") ?? new List<string>();
            device["ipv6"] = active.GetValueOrDefault("ipv6") ?? new List<string>();
        }

        var byType = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var device in devices)
        {
            var type = Text.Sanitize(device.GetValueOrDefault("device_type"));
            if (type.Length == 0)
            {
                type = "other";
            }

            byType[type] = Text.ToLong(byType.GetValueOrDefault(type), 0) + 1;
        }

        var summary = new Dictionary<string, object?>
        {
            ["total"] = devices.Count,
            ["enabled"] = devices.Count(item => item.GetValueOrDefault("enabled") is true),
            ["disabled"] = devices.Count(item => item.GetValueOrDefault("enabled") is false),
            ["connected"] = devices.Count(item => Text.Sanitize(item.GetValueOrDefault("connection_status")) == "up"),
            ["by_type"] = byType,
        };

        return new Dictionary<string, object?>
        {
            ["primary_adapter_name"] = primaryAdapter,
            ["adapters"] = adapters,
            ["devices"] = devices,
            ["summary"] = summary,
            ["active_ipv4"] = Text.Dedupe(activeIpv4),
            ["active_ipv6"] = Text.Dedupe(activeIpv6),
            ["default_gateway"] = DefaultGateway(),
            ["dns_servers"] = Text.Dedupe(DnsServers()),
        };
    }

    private static List<Dictionary<string, object?>> WindowsDevices()
    {
        var devices = new List<Dictionary<string, object?>>();

        var adapters = Wmi.Query(
            Wmi.CimV2,
            "SELECT NetConnectionID,Name,Description,NetEnabled,NetConnectionStatus,MACAddress,Speed,InterfaceIndex,PNPDeviceID,PhysicalAdapter " +
            "FROM Win32_NetworkAdapter WHERE NetConnectionID IS NOT NULL");

        foreach (var row in adapters)
        {
            // Get-NetAdapter exposes the connection name ("Ethernet0") in Name and
            // the driver text in InterfaceDescription; Win32_NetworkAdapter has
            // them as NetConnectionID and Name/Description.
            var connectionName = Text.Sanitize(Wmi.Str(row, "NetConnectionID"));
            var description = Text.Sanitize(Wmi.Str(row, "Description"));
            if (description.Length == 0)
            {
                description = Text.Sanitize(Wmi.Str(row, "Name"));
            }

            var name = connectionName;
            if (name.Length == 0 && description.Length == 0)
            {
                continue;
            }

            var netEnabled = Wmi.Bool(row, "NetEnabled");
            var statusCode = Wmi.Long(row, "NetConnectionStatus") ?? 0;
            var pnpId = Wmi.Str(row, "PNPDeviceID");
            var virtualAdapter = pnpId.StartsWith("ROOT\\", StringComparison.OrdinalIgnoreCase)
                                 || name.Contains("virtual", StringComparison.OrdinalIgnoreCase)
                                 || description.Contains("virtual", StringComparison.OrdinalIgnoreCase);
            var physical = Wmi.BoolOr(row, "PhysicalAdapter", !virtualAdapter);

            devices.Add(new Dictionary<string, object?>
            {
                ["name"] = name.Length > 0 ? name : description,
                ["description"] = description,
                ["device_type"] = DeviceType(name, description),
                ["enabled"] = netEnabled,
                ["connection_status"] = ConnectionStatus(statusCode, netEnabled),
                ["admin_status"] = netEnabled is null ? string.Empty : netEnabled.Value ? "1" : "2",
                ["mac_address"] = Text.Sanitize(Wmi.Str(row, "MACAddress")),
                ["link_speed"] = LinkSpeed(Wmi.Long(row, "Speed")),
                ["interface_index"] = Wmi.Long(row, "InterfaceIndex") ?? 0,
                ["physical"] = physical,
                ["virtual"] = virtualAdapter,
                ["ipv4"] = new List<string>(),
                ["ipv6"] = new List<string>(),
            });
        }

        var bluetooth = Wmi.Query(
            Wmi.CimV2,
            "SELECT Name,PNPDeviceID,Status,ConfigManagerErrorCode FROM Win32_PnPEntity WHERE PNPClass='Bluetooth'");

        foreach (var row in bluetooth)
        {
            var name = Text.Sanitize(Wmi.Str(row, "Name"));
            var pnpId = Wmi.Str(row, "PNPDeviceID");
            if (name.Length == 0
                || pnpId.StartsWith("BTHENUM\\", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Enumerator", StringComparison.OrdinalIgnoreCase)
                || name.Contains("Перечислитель", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var problemCode = Wmi.Long(row, "ConfigManagerErrorCode") ?? 0;
            var enabled = problemCode == 22 ? false : problemCode == 0 ? true : (bool?)null;

            devices.Add(new Dictionary<string, object?>
            {
                ["name"] = name,
                ["description"] = string.Empty,
                ["device_type"] = "bluetooth",
                ["enabled"] = enabled,
                ["connection_status"] = ConnectionStatus(problemCode == 0 ? 2 : 0, enabled),
                ["admin_status"] = string.Empty,
                ["mac_address"] = string.Empty,
                ["link_speed"] = string.Empty,
                ["interface_index"] = 0,
                ["physical"] = true,
                ["virtual"] = false,
                ["pnp_device_id"] = pnpId,
                ["problem_code"] = problemCode,
                ["ipv4"] = new List<string>(),
                ["ipv6"] = new List<string>(),
            });
        }

        return devices;
    }

    private static string DeviceType(string name, string description)
    {
        var combined = $"{name} {description}".ToLowerInvariant();
        if (combined.Contains("bluetooth") || combined.Contains("блютуз"))
        {
            return "bluetooth";
        }

        if (combined.Contains("wi-fi") || combined.Contains("wifi") || combined.Contains("wireless") ||
            combined.Contains("802.11") || combined.Contains("wlan") || combined.Contains("беспровод"))
        {
            return "wifi";
        }

        if (combined.Contains("vpn") || combined.Contains("tunnel") || combined.Contains("tap-windows") ||
            combined.Contains("wintun"))
        {
            return "vpn";
        }

        if (combined.Contains("virtual"))
        {
            return "virtual";
        }

        if (combined.Contains("ethernet") || combined.Contains("802.3") || combined.Contains("gigabit") ||
            combined.Contains("fast ethernet"))
        {
            return "ethernet";
        }

        return "other";
    }

    private static string ConnectionStatus(long statusCode, bool? enabled)
    {
        if (enabled is false)
        {
            return "disabled";
        }

        return statusCode switch
        {
            2 => "up",
            0 or 7 => "disconnected",
            4 => "not_present",
            5 => "disabled",
            6 or 8 or 9 or 10 or 11 or 12 => "unknown",
            _ => "unknown",
        };
    }

    private static string LinkSpeed(long? bitsPerSecond)
    {
        if (bitsPerSecond is null or <= 0)
        {
            return string.Empty;
        }

        var value = bitsPerSecond.Value;
        if (value >= 1_000_000_000)
        {
            return $"{value / 1_000_000_000.0:0.##} Gbps";
        }

        return $"{value / 1_000_000.0:0.##} Mbps";
    }

    private static string DefaultGateway()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                var gateway = nic.GetIPProperties().GatewayAddresses
                    .Select(item => item.Address)
                    .FirstOrDefault(address => address is not null && address.AddressFamily == AddressFamily.InterNetwork);
                if (gateway is not null)
                {
                    return gateway.ToString();
                }
            }
        }
        catch (Exception)
        {
            // no gateway
        }

        return string.Empty;
    }

    private static IEnumerable<string> DnsServers()
    {
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                var addresses = nic.GetIPProperties().DnsAddresses
                    .Where(item => item.AddressFamily == AddressFamily.InterNetwork)
                    .Select(item => item.ToString())
                    .ToList();
                if (addresses.Count > 0)
                {
                    return addresses;
                }
            }
        }
        catch (Exception)
        {
            // no DNS
        }

        return Array.Empty<string>();
    }
}
