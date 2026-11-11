using System.IO;
using System.Runtime.InteropServices;
using Hub.Desktop.Diagnostics;
using Microsoft.Win32;

namespace Hub.Desktop.Audio;

/// <summary>
/// Read-only microphone diagnostics through the Core Audio (MMDevice) API.
/// The only side effect is a shared-mode IAudioClient::Initialize on the default
/// capture endpoint, released immediately and never started.
/// </summary>
public sealed class WindowsMicrophoneDiagnostics : IDesktopMicrophoneDiagnostics
{
    public const int MaximumDevices = 16;
    public const int MaximumNameLength = 128;
    public const int MaximumIdLength = 256;

    private const string ConsentStorePath =
        @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone";
    private const string AppPrivacyPolicyPath = @"SOFTWARE\Policies\Microsoft\Windows\AppPrivacy";

    private const int EDataFlowCapture = 1;
    private const int ERoleConsole = 0;
    private const int ERoleCommunications = 2;
    private const uint ClsCtxAll = 0x17;
    private const uint StgmRead = 0;
    private const int AudclntShareModeShared = 0;
    private const long ProbeBufferDuration100Ns = 2_000_000;
    private const ushort VtLpwstr = 31;

    private static readonly Guid MmDeviceEnumeratorClsid = new("BCDE0395-E52F-467C-8E3D-C4579291692E");
    private static readonly Guid AudioClientIid = new("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2");

    public DesktopMicrophoneDiagnosis Diagnose(IReadOnlyList<string> executablePaths)
    {
        ArgumentNullException.ThrowIfNull(executablePaths);
        var consent = ReadConsent();
        var apps = ReadAppConsents(executablePaths);
        var devices = new List<DesktopMicrophoneDevice>();
        DesktopMicrophoneDevice? defaultConsole = null;
        DesktopMicrophoneDevice? defaultCommunications = null;
        var probe = DesktopMicrophoneProbeStatus.NotRun;
        int? probeHresult = null;

        IMMDeviceEnumerator? enumerator = null;
        try
        {
            var enumeratorType = Type.GetTypeFromCLSID(MmDeviceEnumeratorClsid, throwOnError: true)!;
            enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType)!;
            devices = ReadDevices(enumerator);
            defaultConsole = ReadDefault(enumerator, ERoleConsole, out var consoleHresult);
            defaultCommunications = ReadDefault(enumerator, ERoleCommunications, out _);
            probeHresult = defaultConsole is null
                ? consoleHresult
                : ProbeDefaultCapture(enumerator);
            probe = DesktopMicrophoneDiagnosisClassifier.MapProbeResult(probeHresult.Value);
        }
        catch (Exception exception)
        {
            probe = DesktopMicrophoneProbeStatus.Failed;
            probeHresult = exception.HResult;
            DesktopLog.Warning($"Microphone diagnostics failed; error={exception.GetType().Name}; hresult=0x{exception.HResult:X8}");
        }
        finally
        {
            Release(enumerator);
        }

        var reason = DesktopMicrophoneDiagnosisClassifier.Classify(
            probe,
            consent,
            apps,
            devices,
            defaultConsole is not null);
        DesktopLog.Info(
            $"Microphone diagnostics; reason={reason}; probe={probe}; " +
            $"hresult=0x{probeHresult.GetValueOrDefault():X8}; devices={devices.Count}");
        return new DesktopMicrophoneDiagnosis(
            devices,
            defaultConsole,
            defaultCommunications,
            consent,
            apps,
            probe,
            probeHresult,
            reason);
    }

    private static List<DesktopMicrophoneDevice> ReadDevices(IMMDeviceEnumerator enumerator)
    {
        var result = new List<DesktopMicrophoneDevice>();
        const uint mask = DesktopMicrophoneDiagnosisClassifier.DeviceStateActive
            | DesktopMicrophoneDiagnosisClassifier.DeviceStateDisabled
            | DesktopMicrophoneDiagnosisClassifier.DeviceStateUnplugged;
        if (enumerator.EnumAudioEndpoints(EDataFlowCapture, mask, out var collection) != 0 || collection is null)
        {
            return result;
        }

        try
        {
            if (collection.GetCount(out var count) != 0)
            {
                return result;
            }

            for (uint index = 0; index < count && result.Count < MaximumDevices; index++)
            {
                if (collection.Item(index, out var device) != 0 || device is null)
                {
                    continue;
                }

                try
                {
                    result.Add(Describe(device));
                }
                finally
                {
                    Release(device);
                }
            }
        }
        finally
        {
            Release(collection);
        }

        return result;
    }

    private static DesktopMicrophoneDevice? ReadDefault(
        IMMDeviceEnumerator enumerator,
        int role,
        out int hresult)
    {
        hresult = enumerator.GetDefaultAudioEndpoint(EDataFlowCapture, role, out var device);
        if (hresult != 0 || device is null)
        {
            if (hresult == 0)
            {
                hresult = DesktopMicrophoneDiagnosisClassifier.ENotFound;
            }

            Release(device);
            return null;
        }

        try
        {
            return Describe(device);
        }
        finally
        {
            Release(device);
        }
    }

    private static int ProbeDefaultCapture(IMMDeviceEnumerator enumerator)
    {
        var hresult = enumerator.GetDefaultAudioEndpoint(EDataFlowCapture, ERoleConsole, out var device);
        if (hresult != 0 || device is null)
        {
            Release(device);
            return hresult != 0 ? hresult : DesktopMicrophoneDiagnosisClassifier.ENotFound;
        }

        object? clientObject = null;
        var format = IntPtr.Zero;
        try
        {
            var iid = AudioClientIid;
            hresult = device.Activate(ref iid, ClsCtxAll, IntPtr.Zero, out clientObject);
            if (hresult != 0 || clientObject is not IAudioClient client)
            {
                return hresult != 0 ? hresult : DesktopMicrophoneDiagnosisClassifier.ENotFound;
            }

            hresult = client.GetMixFormat(out format);
            if (hresult != 0)
            {
                return hresult;
            }

            return client.Initialize(
                AudclntShareModeShared,
                0,
                ProbeBufferDuration100Ns,
                0,
                format,
                IntPtr.Zero);
        }
        finally
        {
            if (format != IntPtr.Zero)
            {
                Marshal.FreeCoTaskMem(format);
            }

            Release(clientObject);
            Release(device);
        }
    }

    private static DesktopMicrophoneDevice Describe(IMMDevice device)
    {
        var id = device.GetId(out var rawId) == 0 ? rawId ?? string.Empty : string.Empty;
        var state = device.GetState(out var rawState) == 0
            ? DesktopMicrophoneDiagnosisClassifier.FormatDeviceState(rawState)
            : "unknown";
        return new DesktopMicrophoneDevice(
            Truncate(id, MaximumIdLength),
            Truncate(ReadFriendlyName(device), MaximumNameLength),
            state);
    }

    private static string ReadFriendlyName(IMMDevice device)
    {
        if (device.OpenPropertyStore(StgmRead, out var store) != 0 || store is null)
        {
            return string.Empty;
        }

        try
        {
            var key = new PropertyKey
            {
                FormatId = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"),
                PropertyId = 14,
            };
            if (store.GetValue(ref key, out var value) != 0)
            {
                return string.Empty;
            }

            try
            {
                return value.VariantType == VtLpwstr && value.Pointer != IntPtr.Zero
                    ? Marshal.PtrToStringUni(value.Pointer) ?? string.Empty
                    : string.Empty;
            }
            finally
            {
                _ = PropVariantClear(ref value);
            }
        }
        finally
        {
            Release(store);
        }
    }

    private static DesktopMicrophoneConsent ReadConsent()
    {
        return new DesktopMicrophoneConsent(
            ReadString(Registry.CurrentUser, ConsentStorePath),
            ReadString(Registry.CurrentUser, ConsentStorePath + @"\NonPackaged"),
            ReadString(Registry.LocalMachine, ConsentStorePath),
            ReadPolicy());
    }

    private static List<DesktopMicrophoneAppConsent> ReadAppConsents(IReadOnlyList<string> executablePaths)
    {
        var result = new List<DesktopMicrophoneAppConsent>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in executablePaths)
        {
            var keyName = DesktopMicrophoneDiagnosisClassifier.ToConsentKeyName(path);
            if (keyName is null || !seen.Add(keyName))
            {
                continue;
            }

            var appPath = ConsentStorePath + @"\NonPackaged\" + keyName;
            result.Add(new DesktopMicrophoneAppConsent(
                Truncate(Path.GetFileName(path), MaximumNameLength),
                ReadString(Registry.CurrentUser, appPath),
                ReadString(Registry.LocalMachine, appPath)));
        }

        return result;
    }

    private static string? ReadString(RegistryKey root, string path)
    {
        try
        {
            using var key = root.OpenSubKey(path, writable: false);
            return key?.GetValue("Value") is string value
                ? Truncate(value, 16)
                : null;
        }
        catch (Exception exception) when (
            exception is System.Security.SecurityException
            or UnauthorizedAccessException
            or IOException)
        {
            return null;
        }
    }

    private static int? ReadPolicy()
    {
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(AppPrivacyPolicyPath, writable: false);
            return key?.GetValue("LetAppsAccessMicrophone") is int value ? value : null;
        }
        catch (Exception exception) when (
            exception is System.Security.SecurityException
            or UnauthorizedAccessException
            or IOException)
        {
            return null;
        }
    }

    private static string Truncate(string value, int maximumLength)
    {
        var cleaned = new string(value.Where(character => !char.IsControl(character)).ToArray()).Trim();
        return cleaned.Length <= maximumLength ? cleaned : cleaned[..maximumLength];
    }

    private static void Release(object? comObject)
    {
        if (comObject is not null && Marshal.IsComObject(comObject))
        {
            Marshal.FinalReleaseComObject(comObject);
        }
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant value);

    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid FormatId;
        public uint PropertyId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort VariantType;
        public ushort Reserved1;
        public ushort Reserved2;
        public ushort Reserved3;
        public IntPtr Pointer;
        public IntPtr Pointer2;
    }

    [ComImport]
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig]
        int EnumAudioEndpoints(int dataFlow, uint stateMask, out IMMDeviceCollection? devices);

        [PreserveSig]
        int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice? endpoint);
    }

    [ComImport]
    [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceCollection
    {
        [PreserveSig]
        int GetCount(out uint count);

        [PreserveSig]
        int Item(uint index, out IMMDevice? device);
    }

    [ComImport]
    [Guid("D666063F-1587-4E43-81F1-B948E807363F")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig]
        int Activate(
            ref Guid interfaceId,
            uint classContext,
            IntPtr activationParams,
            [MarshalAs(UnmanagedType.IUnknown)] out object? instance);

        [PreserveSig]
        int OpenPropertyStore(uint access, out IPropertyStore? properties);

        [PreserveSig]
        int GetId([MarshalAs(UnmanagedType.LPWStr)] out string? id);

        [PreserveSig]
        int GetState(out uint state);
    }

    [ComImport]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore
    {
        [PreserveSig]
        int GetCount(out uint count);

        [PreserveSig]
        int GetAt(uint index, out PropertyKey key);

        [PreserveSig]
        int GetValue(ref PropertyKey key, out PropVariant value);
    }

    [ComImport]
    [Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig]
        int Initialize(
            int shareMode,
            uint streamFlags,
            long bufferDuration,
            long periodicity,
            IntPtr format,
            IntPtr audioSessionGuid);

        [PreserveSig]
        int GetBufferSize(out uint bufferFrameCount);

        [PreserveSig]
        int GetStreamLatency(out long latency);

        [PreserveSig]
        int GetCurrentPadding(out uint paddingFrameCount);

        [PreserveSig]
        int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);

        [PreserveSig]
        int GetMixFormat(out IntPtr deviceFormat);
    }
}
