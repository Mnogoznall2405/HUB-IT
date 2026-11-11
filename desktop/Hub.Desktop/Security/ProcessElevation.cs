using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Hub.Desktop.Security;

internal static class ProcessElevation
{
    private const uint TokenQuery = 0x0008;

    public static bool TryGetIsElevated(out bool isElevated, out int errorCode)
    {
        isElevated = false;
        errorCode = 0;

        if (!OpenProcessToken(GetCurrentProcess(), TokenQuery, out var token))
        {
            errorCode = Marshal.GetLastWin32Error();
            return false;
        }

        using (token)
        {
            var size = Marshal.SizeOf<TokenElevation>();
            if (!GetTokenInformation(
                    token,
                    TokenInformationClass.TokenElevation,
                    out var elevation,
                    size,
                    out _))
            {
                errorCode = Marshal.GetLastWin32Error();
                return false;
            }

            isElevated = elevation.TokenIsElevated != 0;
            return true;
        }
    }

    private enum TokenInformationClass
    {
        TokenElevation = 20,
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TokenElevation
    {
        public int TokenIsElevated;
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(
        IntPtr processHandle,
        uint desiredAccess,
        out SafeAccessTokenHandle tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(
        SafeAccessTokenHandle tokenHandle,
        TokenInformationClass tokenInformationClass,
        out TokenElevation tokenInformation,
        int tokenInformationLength,
        out int returnLength);
}
