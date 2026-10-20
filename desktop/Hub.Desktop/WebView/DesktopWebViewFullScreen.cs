using System.Windows;
using System.Windows.Controls;
using Hub.Desktop.Diagnostics;
using Grid = System.Windows.Controls.Grid;
using Panel = System.Windows.Controls.Panel;
using Microsoft.Web.WebView2.Core;

namespace Hub.Desktop.WebView;

/// <summary>
/// Mirrors HTML element fullscreen (call video, players) onto the host window.
/// WebView2 only reports ContainsFullScreenElement; without this the element
/// fills the WebView area and the shell title bar stays visible.
/// While <see cref="IsActive"/> the window must not constrain maximize to the
/// work area, so the maximized window covers the whole monitor.
/// </summary>
public sealed class DesktopWebViewFullScreen
{
    private readonly Window _window;
    private readonly FrameworkElement _browserHost;
    private CoreWebView2? _core;
    private WindowState _restoreState;
    private Thickness _restoreMargin;
    private int _restoreRow;
    private int _restoreRowSpan;
    private int _restoreZIndex;

    public DesktopWebViewFullScreen(Window window, FrameworkElement browserHost)
    {
        _window = window ?? throw new ArgumentNullException(nameof(window));
        _browserHost = browserHost ?? throw new ArgumentNullException(nameof(browserHost));
    }

    public bool IsActive { get; private set; }

    public void Attach(CoreWebView2 core)
    {
        Detach();
        _core = core ?? throw new ArgumentNullException(nameof(core));
        _core.ContainsFullScreenElementChanged += Core_ContainsFullScreenElementChanged;
    }

    public void Detach()
    {
        if (_core is not null)
        {
            _core.ContainsFullScreenElementChanged -= Core_ContainsFullScreenElementChanged;
            _core = null;
        }

        Exit();
    }

    private void Core_ContainsFullScreenElementChanged(object? sender, object e)
    {
        if (_core?.ContainsFullScreenElement == true)
        {
            Enter();
        }
        else
        {
            Exit();
        }
    }

    private void Enter()
    {
        if (IsActive)
        {
            return;
        }

        IsActive = true;
        _restoreState = _window.WindowState == WindowState.Minimized
            ? WindowState.Normal
            : _window.WindowState;
        _restoreMargin = _browserHost.Margin;
        _restoreRow = Grid.GetRow(_browserHost);
        _restoreRowSpan = Grid.GetRowSpan(_browserHost);
        _restoreZIndex = Panel.GetZIndex(_browserHost);

        var rows = (_browserHost.Parent as Grid)?.RowDefinitions.Count ?? 1;
        Grid.SetRow(_browserHost, 0);
        Grid.SetRowSpan(_browserHost, Math.Max(1, rows));
        Panel.SetZIndex(_browserHost, 1000);
        _browserHost.Margin = new Thickness(0);

        // Re-maximize so WM_GETMINMAXINFO is evaluated again without the
        // work-area constraint and the window covers the taskbar too.
        if (_window.WindowState == WindowState.Maximized)
        {
            _window.WindowState = WindowState.Normal;
        }

        _window.WindowState = WindowState.Maximized;
        DesktopLog.Info("WebView element fullscreen entered");
    }

    private void Exit()
    {
        if (!IsActive)
        {
            return;
        }

        IsActive = false;
        Grid.SetRow(_browserHost, _restoreRow);
        Grid.SetRowSpan(_browserHost, Math.Max(1, _restoreRowSpan));
        Panel.SetZIndex(_browserHost, _restoreZIndex);
        _browserHost.Margin = _restoreMargin;

        // Leave maximize first so a restored maximized window is constrained
        // to the work area again.
        _window.WindowState = WindowState.Normal;
        _window.WindowState = _restoreState;
        DesktopLog.Info("WebView element fullscreen exited");
    }
}
