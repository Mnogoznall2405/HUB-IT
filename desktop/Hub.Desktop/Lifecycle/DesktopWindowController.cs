using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Hub.Desktop.Lifecycle;

public sealed record DesktopMaximizedBounds(
    int X,
    int Y,
    int Width,
    int Height);

public sealed class DesktopWindowController
{
    private const int RestoreWindow = 9;
    private const uint NearestMonitor = 2;
    private const int GetMinimumMaximumInfoMessage = 0x0024;
    private readonly Window _window;

    public DesktopWindowController(Window window)
    {
        _window = window ?? throw new ArgumentNullException(nameof(window));
    }

    public void ShowAndActivate()
    {
        if (!_window.IsVisible)
        {
            _window.Show();
        }

        if (_window.WindowState == WindowState.Minimized)
        {
            _window.WindowState = WindowState.Normal;
        }

        var handle = new WindowInteropHelper(_window).Handle;
        if (handle != nint.Zero)
        {
            ShowWindow(handle, RestoreWindow);
            SetForegroundWindow(handle);
        }

        _window.Activate();
        _window.Focus();
    }

    public static bool TryHandleWindowMessage(
        nint windowHandle,
        int message,
        nint longParameter)
    {
        if (message != GetMinimumMaximumInfoMessage)
        {
            return false;
        }

        ConstrainMaximizedBoundsToWorkArea(windowHandle, longParameter);
        return true;
    }

    public static DesktopMaximizedBounds CalculateMaximizedBounds(
        Rectangle monitorArea,
        Rectangle workArea) =>
        new(
            workArea.Left - monitorArea.Left,
            workArea.Top - monitorArea.Top,
            workArea.Width,
            workArea.Height);

    private static void ConstrainMaximizedBoundsToWorkArea(
        nint windowHandle,
        nint minimumMaximumInfoPointer)
    {
        if (minimumMaximumInfoPointer == nint.Zero)
        {
            return;
        }

        var monitorHandle = MonitorFromWindow(windowHandle, NearestMonitor);
        if (monitorHandle == nint.Zero)
        {
            return;
        }

        var monitorInfo = new MonitorInfo
        {
            Size = Marshal.SizeOf<MonitorInfo>(),
        };
        if (!GetMonitorInfo(monitorHandle, ref monitorInfo))
        {
            return;
        }

        var bounds = CalculateMaximizedBounds(
            monitorInfo.MonitorArea.ToRectangle(),
            monitorInfo.WorkArea.ToRectangle());
        var minimumMaximumInfo = Marshal.PtrToStructure<MinimumMaximumInfo>(
            minimumMaximumInfoPointer);
        minimumMaximumInfo.MaximumPosition.X = bounds.X;
        minimumMaximumInfo.MaximumPosition.Y = bounds.Y;
        minimumMaximumInfo.MaximumSize.X = bounds.Width;
        minimumMaximumInfo.MaximumSize.Y = bounds.Height;
        Marshal.StructureToPtr(minimumMaximumInfo, minimumMaximumInfoPointer, false);
    }

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ShowWindow(nint windowHandle, int command);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetForegroundWindow(nint windowHandle);

    [DllImport("user32.dll")]
    private static extern nint MonitorFromWindow(nint windowHandle, uint flags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMonitorInfo(
        nint monitorHandle,
        ref MonitorInfo monitorInfo);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRectangle
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public readonly Rectangle ToRectangle() =>
            Rectangle.FromLTRB(Left, Top, Right, Bottom);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MinimumMaximumInfo
    {
        public NativePoint Reserved;
        public NativePoint MaximumSize;
        public NativePoint MaximumPosition;
        public NativePoint MinimumTrackingSize;
        public NativePoint MaximumTrackingSize;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRectangle MonitorArea;
        public NativeRectangle WorkArea;
        public uint Flags;
    }
}
