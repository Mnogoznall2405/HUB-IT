using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Native.Api;

/// <summary>
/// INativeSessionStore поверх DPAPI (CryptProtectData/CryptUnprotectData, CurrentUser):
/// JSON-документ шифруется и пишется атомарно (temp + File.Move) рядом с settings.json.
/// Device id не секретен и лежит отдельным файлом, чтобы переживать logout.
/// </summary>
public sealed class DpapiNativeSessionStore : INativeSessionStore
{
    private const int SchemaVersion = 1;
    private const int MaximumSessionBytes = 64 * 1024;
    private const int CryptProtectUiForbidden = 0x1;
    private const string SessionFileName = "native-session.dat";
    private const string DeviceIdFileName = "native-device-id";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
    };

    private readonly SemaphoreSlim _sync = new(1, 1);

    public DpapiNativeSessionStore(string? directory = null)
    {
        DirectoryPath = Path.GetFullPath(
            string.IsNullOrWhiteSpace(directory) ? DesktopPaths.Root : directory);
        SessionFilePath = Path.Combine(DirectoryPath, SessionFileName);
        DeviceIdFilePath = Path.Combine(DirectoryPath, DeviceIdFileName);
    }

    public string DirectoryPath { get; }

    public string SessionFilePath { get; }

    public string DeviceIdFilePath { get; }

    public async Task<NativeSession?> LoadAsync(CancellationToken cancellationToken)
    {
        await _sync.WaitAsync(cancellationToken);
        try
        {
            if (!File.Exists(SessionFilePath))
            {
                return null;
            }

            var info = new FileInfo(SessionFilePath);
            if (info.Length is <= 0 or > MaximumSessionBytes)
            {
                return null;
            }

            var encrypted = await File.ReadAllBytesAsync(SessionFilePath, cancellationToken);
            var document = JsonSerializer.Deserialize<NativeSessionFileDocument>(
                Unprotect(encrypted), JsonOptions);
            var payload = document?.Session;
            if (document?.SchemaVersion != SchemaVersion
                || payload is null
                || string.IsNullOrEmpty(payload.AccessToken)
                || string.IsNullOrEmpty(payload.RefreshToken))
            {
                return null;
            }

            return new NativeSession(
                payload.AccessToken,
                payload.RefreshToken,
                payload.ClientDeviceId ?? string.Empty,
                payload.AccessTokenExpiresAtUtc,
                payload.UserId,
                payload.UserName ?? string.Empty,
                payload.FullName ?? string.Empty);
        }
        catch (Exception exception) when (
            exception is IOException
            or UnauthorizedAccessException
            or JsonException
            or Win32Exception
            or ExternalException
            or OverflowException
            or System.Security.Cryptography.CryptographicException)
        {
            // Corrupt or foreign DPAPI blob is treated as "logged out", never as an error.
            return null;
        }
        finally
        {
            _sync.Release();
        }
    }

    public async Task SaveAsync(NativeSession session, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        var document = new NativeSessionFileDocument(
            SchemaVersion,
            new NativeSessionDocument(
                session.AccessToken,
                session.RefreshToken,
                session.ClientDeviceId,
                session.AccessTokenExpiresAtUtc,
                session.UserId,
                session.UserName,
                session.FullName));
        var encrypted = Protect(JsonSerializer.SerializeToUtf8Bytes(document, JsonOptions));

        await _sync.WaitAsync(cancellationToken);
        try
        {
            await WriteAtomicAsync(SessionFilePath, encrypted, cancellationToken);
        }
        finally
        {
            _sync.Release();
        }
    }

    public async Task ClearAsync(CancellationToken cancellationToken)
    {
        await _sync.WaitAsync(cancellationToken);
        try
        {
            File.Delete(SessionFilePath);
            File.Delete(SessionFilePath + ".tmp");
        }
        finally
        {
            _sync.Release();
        }
    }

    public async Task<string> GetOrCreateClientDeviceIdAsync(CancellationToken cancellationToken)
    {
        await _sync.WaitAsync(cancellationToken);
        try
        {
            var existing = await ReadDeviceIdAsync(cancellationToken);
            if (existing is not null)
            {
                return existing;
            }

            var created = "desktop-" + Guid.NewGuid().ToString("N");
            await WriteAtomicAsync(
                DeviceIdFilePath,
                new UTF8Encoding(false).GetBytes(created),
                cancellationToken);
            return created;
        }
        finally
        {
            _sync.Release();
        }
    }

    private async Task<string?> ReadDeviceIdAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (!File.Exists(DeviceIdFilePath))
            {
                return null;
            }

            var text = (await File.ReadAllTextAsync(DeviceIdFilePath, cancellationToken)).Trim();
            return text.Length is > 0 and <= 128 ? text : null;
        }
        catch (Exception exception) when (
            exception is IOException or UnauthorizedAccessException)
        {
            return null;
        }
    }

    private async Task WriteAtomicAsync(
        string path,
        byte[] payload,
        CancellationToken cancellationToken)
    {
        System.IO.Directory.CreateDirectory(DirectoryPath);
        var temporaryPath = path + ".tmp";
        await File.WriteAllBytesAsync(temporaryPath, payload, cancellationToken);
        File.Move(temporaryPath, path, overwrite: true);
    }

    private static byte[] Protect(byte[] plainBytes)
    {
        return CryptBlobTransform(plainBytes, CryptProtectData);
    }

    private static byte[] Unprotect(byte[] protectedBytes)
    {
        return CryptBlobTransform(protectedBytes, CryptUnprotectData);
    }

    private delegate bool CryptDataFunction(
        ref CryptBlob dataIn,
        IntPtr optionalEntropy,
        int flags,
        out CryptBlob dataOut);

    private static bool CryptProtectData(
        ref CryptBlob dataIn,
        IntPtr optionalEntropy,
        int flags,
        out CryptBlob dataOut)
    {
        return CryptProtectData(
            ref dataIn,
            null,
            optionalEntropy,
            IntPtr.Zero,
            IntPtr.Zero,
            flags,
            out dataOut);
    }

    private static bool CryptUnprotectData(
        ref CryptBlob dataIn,
        IntPtr optionalEntropy,
        int flags,
        out CryptBlob dataOut)
    {
        return CryptUnprotectData(
            ref dataIn,
            IntPtr.Zero,
            optionalEntropy,
            IntPtr.Zero,
            IntPtr.Zero,
            flags,
            out dataOut);
    }

    private static byte[] CryptBlobTransform(byte[] input, CryptDataFunction transform)
    {
        var inputBlob = new CryptBlob
        {
            cbData = input.Length,
            pbData = Marshal.AllocHGlobal(input.Length),
        };
        try
        {
            Marshal.Copy(input, 0, inputBlob.pbData, input.Length);
            if (!transform(ref inputBlob, IntPtr.Zero, CryptProtectUiForbidden, out var outputBlob))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error());
            }

            try
            {
                var output = new byte[outputBlob.cbData];
                Marshal.Copy(outputBlob.pbData, output, 0, outputBlob.cbData);
                return output;
            }
            finally
            {
                LocalFree(outputBlob.pbData);
            }
        }
        finally
        {
            Marshal.FreeHGlobal(inputBlob.pbData);
        }
    }

    private sealed record NativeSessionFileDocument(
        int SchemaVersion,
        NativeSessionDocument? Session);

    private sealed record NativeSessionDocument(
        string? AccessToken,
        string? RefreshToken,
        string? ClientDeviceId,
        DateTimeOffset AccessTokenExpiresAtUtc,
        long UserId,
        string? UserName,
        string? FullName);

    [StructLayout(LayoutKind.Sequential)]
    private struct CryptBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptProtectData(
        ref CryptBlob pDataIn,
        string? szDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out CryptBlob pDataOut);

    [DllImport("crypt32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptUnprotectData(
        ref CryptBlob pDataIn,
        IntPtr ppszDataDescr,
        IntPtr pOptionalEntropy,
        IntPtr pvReserved,
        IntPtr pPromptStruct,
        int dwFlags,
        out CryptBlob pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);
}
