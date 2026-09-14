using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Threading;
using Hub.Desktop.Diagnostics;
using Microsoft.Win32;
using Windows.UI.ViewManagement;

namespace Hub.Desktop.Shell;

public sealed class DesktopAccessibilityService : IDisposable
{
    private readonly AccessibilitySettings? _accessibilitySettings;
    private readonly UISettings? _uiSettings;
    private readonly Dispatcher _dispatcher;
    private readonly DesktopSystemAccessibility _state = new();
    private readonly DispatcherTimer? _fallbackTimer;
    private bool _disposed;

    public DesktopAccessibilityService(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher;

        try
        {
            _accessibilitySettings = new AccessibilitySettings();
            _uiSettings = new UISettings();
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Failed to create Windows accessibility settings", exception);
        }

        if (_accessibilitySettings is not null)
        {
            try
            {
                _state.HighContrast = _accessibilitySettings.HighContrast;
                _state.HighContrastScheme = _accessibilitySettings.HighContrastScheme ?? string.Empty;
                _accessibilitySettings.HighContrastChanged += OnHighContrastChanged;
            }
            catch (COMException comException)
            {
                // Expected when elevated (HRESULT 0x80070490): the WinRT event
                // source is unavailable. Polling fallback covers it — not an error.
                DesktopLog.Warning(
                    $"High contrast changed event subscription failed; falling back to polling; " +
                    $"exception={comException.GetType().Name} 0x{comException.HResult:X8}");
                _fallbackTimer = new DispatcherTimer(
                    TimeSpan.FromSeconds(5),
                    DispatcherPriority.Background,
                    (_, _) => PollHighContrast(),
                    _dispatcher);
                _fallbackTimer.Start();
            }
            catch (Exception exception)
            {
                DesktopLog.Error("Failed to read initial high contrast state", exception);
            }
        }

        _state.ReducedMotion = ReadReducedMotion();
        SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
    }

    public DesktopSystemAccessibility State => _state;

    private void OnHighContrastChanged(AccessibilitySettings sender, object args)
    {
        _dispatcher.BeginInvoke(() =>
        {
            _state.HighContrast = sender.HighContrast;
            _state.HighContrastScheme = sender.HighContrastScheme ?? string.Empty;
            DesktopLog.Info(
                $"High contrast changed; highContrast={_state.HighContrast}; " +
                $"scheme={_state.HighContrastScheme}");
        });
    }

    private void OnUserPreferenceChanged(object? sender, UserPreferenceChangedEventArgs e)
    {
        _dispatcher.BeginInvoke(() =>
        {
            _state.ReducedMotion = ReadReducedMotion();
            DesktopLog.Info($"Reduced motion changed; reducedMotion={_state.ReducedMotion}");
        });
    }

    private void PollHighContrast()
    {
        if (_accessibilitySettings is null)
        {
            return;
        }

        try
        {
            var highContrast = _accessibilitySettings.HighContrast;
            var scheme = _accessibilitySettings.HighContrastScheme ?? string.Empty;
            if (highContrast != _state.HighContrast || scheme != _state.HighContrastScheme)
            {
                _state.HighContrast = highContrast;
                _state.HighContrastScheme = scheme;
                DesktopLog.Info(
                    $"High contrast changed via poll; highContrast={_state.HighContrast}; " +
                    $"scheme={_state.HighContrastScheme}");
            }
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Failed to poll high contrast state", exception);
        }
    }

    private bool ReadReducedMotion()
    {
        try
        {
            return _uiSettings is not null && !_uiSettings.AnimationsEnabled;
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Failed to read AnimationsEnabled", exception);
            return false;
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        try
        {
            if (_accessibilitySettings is not null)
            {
                _accessibilitySettings.HighContrastChanged -= OnHighContrastChanged;
            }
        }
        catch (Exception exception)
        {
            DesktopLog.Error("Failed to unsubscribe high contrast changed event", exception);
        }

        SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
        _fallbackTimer?.Stop();
    }
}
