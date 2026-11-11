using System.Drawing;
using System.Runtime.InteropServices;
using Hub.Desktop.Configuration;
using Forms = System.Windows.Forms;

namespace Hub.Desktop.Workspace;

public sealed class DesktopWindowPlacementService
{
    private const int ShowNormal = 1;
    private const int ShowMaximized = 3;

    public bool TryApply(
        nint windowHandle,
        DesktopWindowPlacement? savedPlacement,
        bool restoreMaximized)
    {
        if (windowHandle == nint.Zero || savedPlacement is null)
        {
            return false;
        }

        var screens = Forms.Screen.AllScreens;
        var workAreas = screens.Select(screen => screen.WorkingArea).ToArray();
        var primaryWorkArea = screens.FirstOrDefault(screen => screen.Primary)?.WorkingArea
            ?? screens.FirstOrDefault()?.WorkingArea
            ?? new Rectangle(0, 0, 1360, 860);
        var placement = DesktopWindowPlacementPolicy.Normalize(
            savedPlacement,
            workAreas,
            primaryWorkArea);
        var nativePlacement = new NativeWindowPlacement
        {
            Length = Marshal.SizeOf<NativeWindowPlacement>(),
            ShowCommand = restoreMaximized && placement.Maximized
                ? ShowMaximized
                : ShowNormal,
            NormalPosition = NativeRectangle.FromPlacement(placement),
        };

        return SetWindowPlacement(windowHandle, ref nativePlacement);
    }

    public DesktopWindowPlacement? TryCapture(
        nint windowHandle,
        bool maximized)
    {
        if (windowHandle == nint.Zero)
        {
            return null;
        }

        var nativePlacement = new NativeWindowPlacement
        {
            Length = Marshal.SizeOf<NativeWindowPlacement>(),
        };
        if (!GetWindowPlacement(windowHandle, ref nativePlacement))
        {
            return null;
        }

        var bounds = nativePlacement.NormalPosition;
        if (bounds.Right <= bounds.Left || bounds.Bottom <= bounds.Top)
        {
            return null;
        }

        return new DesktopWindowPlacement(
            bounds.Left,
            bounds.Top,
            bounds.Right - bounds.Left,
            bounds.Bottom - bounds.Top,
            maximized);
    }

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowPlacement(
        nint windowHandle,
        ref NativeWindowPlacement windowPlacement);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetWindowPlacement(
        nint windowHandle,
        ref NativeWindowPlacement windowPlacement);

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

        public static NativeRectangle FromPlacement(DesktopWindowPlacement placement) =>
            new()
            {
                Left = placement.X,
                Top = placement.Y,
                Right = checked(placement.X + placement.Width),
                Bottom = checked(placement.Y + placement.Height),
            };
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeWindowPlacement
    {
        public int Length;
        public int Flags;
        public int ShowCommand;
        public NativePoint MinimumPosition;
        public NativePoint MaximumPosition;
        public NativeRectangle NormalPosition;
    }
}
