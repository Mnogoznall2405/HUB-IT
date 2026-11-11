using System.IO;
using Microsoft.Win32;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Autostart;

public sealed class WindowsAutostartService : IAutostartService
{
    public const string BackgroundArgument = "--background";
    internal const int MaximumCommandLength = 260;
    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string PreferencesKeyPath = @"Software\HUB-IT\Desktop";
    private const string ValueName = "HUB-IT Desktop";
    private const string PreferenceValueName = "AutostartEnabled";
    private readonly string _command;
    private readonly IAutostartRegistry _registry;
    private readonly DesktopAutostartMode _policyMode;

    public WindowsAutostartService(
        string executablePath,
        DesktopAutostartMode policyMode = DesktopAutostartMode.UserChoice)
        : this(executablePath, new CurrentUserRunRegistry(), policyMode)
    {
    }

    internal WindowsAutostartService(
        string executablePath,
        IAutostartRegistry registry,
        DesktopAutostartMode policyMode = DesktopAutostartMode.UserChoice)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(executablePath);
        ArgumentNullException.ThrowIfNull(registry);

        if (!Path.IsPathFullyQualified(executablePath) || executablePath.Contains('"'))
        {
            throw new ArgumentException("Executable path must be absolute.", nameof(executablePath));
        }

        var normalizedPath = Path.GetFullPath(executablePath);
        _command = $"\"{normalizedPath}\" {BackgroundArgument}";
        if (_command.Length > MaximumCommandLength)
        {
            throw new ArgumentException("Autostart command is too long.", nameof(executablePath));
        }

        _registry = registry;
        _policyMode = policyMode;
    }

    public bool IsEnabled => string.Equals(
        _registry.Read(ValueName),
        _command,
        StringComparison.OrdinalIgnoreCase);

    public bool CanUserChange => _policyMode == DesktopAutostartMode.UserChoice;

    internal string Command => _command;

    public static bool IsBackgroundLaunch(IEnumerable<string>? arguments)
    {
        return arguments?.Any(argument => string.Equals(
            argument,
        BackgroundArgument,
        StringComparison.OrdinalIgnoreCase)) == true;
    }

    public void EnsureEnabledByDefault()
    {
        if (_policyMode == DesktopAutostartMode.ForcedOn)
        {
            if (!IsEnabled)
            {
                _registry.Write(ValueName, _command);
            }
            return;
        }

        if (_policyMode == DesktopAutostartMode.ForcedOff)
        {
            _registry.Delete(ValueName);
            return;
        }

        var preference = _registry.ReadPreference(PreferenceValueName);
        if (preference is false)
        {
            return;
        }

        if (!IsEnabled)
        {
            _registry.Write(ValueName, _command);
        }

        if (preference is null)
        {
            _registry.WritePreference(PreferenceValueName, enabled: true);
        }
    }

    public void SetEnabled(bool enabled)
    {
        if (!CanUserChange)
        {
            throw new InvalidOperationException("Autostart is managed by an administrator policy.");
        }

        if (enabled)
        {
            _registry.Write(ValueName, _command);
            _registry.WritePreference(PreferenceValueName, enabled: true);
            return;
        }

        _registry.WritePreference(PreferenceValueName, enabled: false);
        _registry.Delete(ValueName);
    }

    private sealed class CurrentUserRunRegistry : IAutostartRegistry
    {
        public string? Read(string valueName)
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: false);
            return key?.GetValue(
                valueName,
                defaultValue: null,
                RegistryValueOptions.DoNotExpandEnvironmentNames) as string;
        }

        public void Write(string valueName, string command)
        {
            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath, writable: true)
                ?? throw new InvalidOperationException("Current-user Run key is unavailable.");
            key.SetValue(valueName, command, RegistryValueKind.String);
        }

        public void Delete(string valueName)
        {
            using var key = Registry.CurrentUser.OpenSubKey(RunKeyPath, writable: true);
            key?.DeleteValue(valueName, throwOnMissingValue: false);
        }

        public bool? ReadPreference(string valueName)
        {
            using var key = Registry.CurrentUser.OpenSubKey(PreferencesKeyPath, writable: false);
            var value = key?.GetValue(valueName, defaultValue: null);
            return value switch
            {
                int number => number != 0,
                _ => null,
            };
        }

        public void WritePreference(string valueName, bool enabled)
        {
            using var key = Registry.CurrentUser.CreateSubKey(PreferencesKeyPath, writable: true)
                ?? throw new InvalidOperationException("Current-user HUB Desktop settings key is unavailable.");
            key.SetValue(valueName, enabled ? 1 : 0, RegistryValueKind.DWord);
        }
    }
}

internal interface IAutostartRegistry
{
    string? Read(string valueName);

    void Write(string valueName, string command);

    void Delete(string valueName);

    bool? ReadPreference(string valueName);

    void WritePreference(string valueName, bool enabled);
}
