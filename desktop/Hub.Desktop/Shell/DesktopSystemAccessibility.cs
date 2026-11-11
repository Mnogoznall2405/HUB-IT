using System.ComponentModel;

namespace Hub.Desktop.Shell;

public sealed class DesktopSystemAccessibility : INotifyPropertyChanged
{
    private bool _highContrast;
    private string _highContrastScheme = string.Empty;
    private bool _reducedMotion;

    public bool HighContrast
    {
        get => _highContrast;
        set
        {
            if (_highContrast != value)
            {
                _highContrast = value;
                OnPropertyChanged(nameof(HighContrast));
            }
        }
    }

    public string HighContrastScheme
    {
        get => _highContrastScheme;
        set
        {
            if (_highContrastScheme != value)
            {
                _highContrastScheme = value;
                OnPropertyChanged(nameof(HighContrastScheme));
            }
        }
    }

    public bool ReducedMotion
    {
        get => _reducedMotion;
        set
        {
            if (_reducedMotion != value)
            {
                _reducedMotion = value;
                OnPropertyChanged(nameof(ReducedMotion));
            }
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    private void OnPropertyChanged(string propertyName)
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
    }
}
