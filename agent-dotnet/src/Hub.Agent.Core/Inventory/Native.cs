using System.Runtime.InteropServices;

namespace Hub.Agent.Core.Inventory;

/// <summary>Native calls that replace psutil: uptime, CPU load, memory load, process priority.</summary>
public static class Native
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint Low;
        public uint High;

        public readonly ulong ToUInt64() => ((ulong)High << 32) | Low;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint Length;
        public uint MemoryLoad;
        public ulong TotalPhys;
        public ulong AvailPhys;
        public ulong TotalPageFile;
        public ulong AvailPageFile;
        public ulong TotalVirtual;
        public ulong AvailVirtual;
        public ulong AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FileTime idleTime, out FileTime kernelTime, out FileTime userTime);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);

    [DllImport("kernel32.dll")]
    private static extern ulong GetTickCount64();

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetPriorityClass(IntPtr process, uint priorityClass);

    private const uint BelowNormalPriorityClass = 0x00004000;

    public static ulong UptimeSeconds => GetTickCount64() / 1000;

    public static (double CpuPercent, ulong TotalBytes, double MemoryLoadPercent) SampleSystem(int sampleMs = 200)
    {
        var totalBytes = 0UL;
        var memoryLoad = 0.0;

        var status = new MemoryStatusEx { Length = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (GlobalMemoryStatusEx(ref status))
        {
            totalBytes = status.TotalPhys;
            memoryLoad = status.MemoryLoad;
        }

        if (!GetSystemTimes(out var idle1, out var kernel1, out var user1))
        {
            return (0.0, totalBytes, Math.Round(memoryLoad, 1));
        }

        Thread.Sleep(Math.Max(0, sampleMs));

        if (!GetSystemTimes(out var idle2, out var kernel2, out var user2))
        {
            return (0.0, totalBytes, Math.Round(memoryLoad, 1));
        }

        var idleDelta = (double)(idle2.ToUInt64() - idle1.ToUInt64());
        var kernelDelta = (double)(kernel2.ToUInt64() - kernel1.ToUInt64());
        var userDelta = (double)(user2.ToUInt64() - user1.ToUInt64());
        var total = kernelDelta + userDelta;

        var cpu = total <= 0 ? 0.0 : Math.Round(Math.Clamp((total - idleDelta) / total * 100.0, 0.0, 100.0), 1);
        return (cpu, totalBytes, Math.Round(memoryLoad, 1));
    }

    public static bool LowerProcessPriority()
    {
        try
        {
            return SetPriorityClass(GetCurrentProcess(), BelowNormalPriorityClass);
        }
        catch (Exception)
        {
            return false;
        }
    }
}
