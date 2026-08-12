using System.Globalization;
using Hub.Desktop.Autostart;
using Hub.Desktop.UpdateCore;
using Hub.Desktop.Updates;

namespace Hub.Desktop.ViewModels;

public sealed record DesktopRuntimeSnapshot(
    string InstalledVersion,
    string WebView2Version,
    string WindowsAppSdkStatus,
    string NotificationMode);

public sealed class AboutViewModel
{
    public AboutViewModel(
        DesktopRuntimeSnapshot runtime,
        IAutostartService autostart,
        DesktopUpdateState updateState)
    {
        ArgumentNullException.ThrowIfNull(runtime);
        ArgumentNullException.ThrowIfNull(autostart);
        ArgumentNullException.ThrowIfNull(updateState);

        InstalledVersion = runtime.InstalledVersion;
        WebView2Version = runtime.WebView2Version;
        WindowsAppSdkStatus = runtime.WindowsAppSdkStatus;
        NotificationMode = runtime.NotificationMode;
        AutostartStatus = ReadAutostartStatus(autostart);
        UpdateStatus = FormatUpdateStatus(updateState);
        LastSuccessfulCheck = updateState.LastSuccessfulCheckUtc is { } checkedAt
            ? checkedAt.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture)
            : "Ещё не выполнялась.";
        ReleaseNotes = updateState.ReleaseNotes?
            .Where(note => !string.IsNullOrWhiteSpace(note))
            .ToArray()
            ?? [];
        CanCheckForUpdates = updateState.Status == DesktopUpdateStatus.Idle
            || updateState.Status == DesktopUpdateStatus.Error
            && !string.Equals(updateState.ErrorCode, "runner_launch", StringComparison.Ordinal);
        CanInstallUpdate = updateState.Status is
            DesktopUpdateStatus.Ready
            or DesktopUpdateStatus.Deferred
            || updateState.Status == DesktopUpdateStatus.Error
            && string.Equals(updateState.ErrorCode, "runner_launch", StringComparison.Ordinal);
        CanDeferUpdate = updateState.Status == DesktopUpdateStatus.Ready;
        CheckActionText = updateState.Status switch
        {
            DesktopUpdateStatus.Checking => "Проверяем…",
            DesktopUpdateStatus.Downloading => $"Загружаем — {updateState.DownloadPercent}%",
            _ => "Проверить обновления",
        };
    }

    public string InstalledVersion { get; }

    public string WebView2Version { get; }

    public string WindowsAppSdkStatus { get; }

    public string NotificationMode { get; }

    public string AutostartStatus { get; }

    public string UpdateStatus { get; }

    public string LastSuccessfulCheck { get; }

    public IReadOnlyList<string> ReleaseNotes { get; }

    public bool HasReleaseNotes => ReleaseNotes.Count > 0;

    public bool CanCheckForUpdates { get; }

    public bool CanInstallUpdate { get; }

    public bool CanDeferUpdate { get; }

    public string CheckActionText { get; }

    private static string ReadAutostartStatus(IAutostartService autostart)
    {
        try
        {
            var status = autostart.IsEnabled ? "Включён" : "Выключен";
            return autostart.CanUserChange
                ? status
                : $"{status} (политика администратора)";
        }
        catch
        {
            return "Не удалось определить";
        }
    }

    private static string FormatUpdateStatus(DesktopUpdateState state)
    {
        var version = state.Version is null
            ? ""
            : DesktopUpdateManifestVerifier.FormatVersion(state.Version);
        return state.Status switch
        {
            DesktopUpdateStatus.Disabled =>
                "Обновления отключены политикой администратора.",
            DesktopUpdateStatus.Idle when state.LastSuccessfulCheckUtc is null =>
                "Обновления ещё не проверялись.",
            DesktopUpdateStatus.Idle => "Установлена последняя версия HUB Desktop.",
            DesktopUpdateStatus.Checking => "Проверяем наличие обновлений…",
            DesktopUpdateStatus.Downloading =>
                $"Найдена версия {version}. Загружаем обновление — " +
                $"{state.DownloadPercent}%. HUB продолжает работать.",
            DesktopUpdateStatus.Ready =>
                $"Обновление {version} загружено. Установка начнётся только после вашего подтверждения.",
            DesktopUpdateStatus.Deferred when state.DeferredUntil is { } until =>
                $"Обновление {version} готово. Напомним об установке " +
                until.ToLocalTime().ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture) +
                ".",
            DesktopUpdateStatus.Deferred =>
                $"Обновление {version} готово. Установите его, когда будет удобно.",
            DesktopUpdateStatus.Installing =>
                $"HUB Desktop закроется на время установки версии {version} и откроется снова.",
            DesktopUpdateStatus.Error when string.Equals(
                state.ErrorCode,
                "runner_launch",
                StringComparison.Ordinal) =>
                "Не удалось запустить установку. HUB продолжает работать. Повторите попытку.",
            DesktopUpdateStatus.Error =>
                "Не удалось проверить обновления. Проверьте подключение и повторите попытку.",
            _ => "Состояние обновлений недоступно.",
        };
    }
}
