using System.Runtime.InteropServices;

namespace Hub.Desktop.Shell;

public sealed class DesktopGlobalHotkey : IDisposable
{
    public const int WindowMessage = 0x0312;
    public const int Identifier = 0x4842;
    private const uint ModifierControl = 0x0002;
    private const uint ModifierShift = 0x0004;
    private const uint ModifierNoRepeat = 0x4000;
    private const uint VirtualKeyH = 0x48;

    private readonly Func<nint, int, uint, uint, bool> _register;
    private readonly Func<nint, int, bool> _unregister;
    private nint _windowHandle;

    public DesktopGlobalHotkey()
        : this(RegisterHotKey, UnregisterHotKey)
    {
    }

    public DesktopGlobalHotkey(
        Func<nint, int, uint, uint, bool> register,
        Func<nint, int, bool> unregister)
    {
        _register = register ?? throw new ArgumentNullException(nameof(register));
        _unregister = unregister ?? throw new ArgumentNullException(nameof(unregister));
    }

    public bool IsRegistered => _windowHandle != nint.Zero;

    public bool TryRegister(nint windowHandle)
    {
        if (windowHandle == nint.Zero)
        {
            return false;
        }

        if (_windowHandle == windowHandle)
        {
            return true;
        }

        Unregister();
        if (!_register(
                windowHandle,
                Identifier,
                ModifierControl | ModifierShift | ModifierNoRepeat,
                VirtualKeyH))
        {
            return false;
        }

        _windowHandle = windowHandle;
        return true;
    }

    public void Unregister()
    {
        if (_windowHandle == nint.Zero)
        {
            return;
        }

        _ = _unregister(_windowHandle, Identifier);
        _windowHandle = nint.Zero;
    }

    public static bool IsActivationMessage(int message, nint wordParameter) =>
        message == WindowMessage && wordParameter == Identifier;

    public void Dispose() => Unregister();

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool RegisterHotKey(
        nint windowHandle,
        int identifier,
        uint modifiers,
        uint virtualKey);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnregisterHotKey(nint windowHandle, int identifier);
}
