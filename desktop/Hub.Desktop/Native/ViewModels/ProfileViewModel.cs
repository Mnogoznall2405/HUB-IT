using System.Globalization;
using System.Reflection;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>
/// Страница «Профиль» нативного шелла: карточка пользователя из bearer-сессии,
/// сведения о приложении (версия, сервер) и выход из учётной записи.
/// Данные приходят из NativeSession — отдельной загрузки с сервера нет.
/// </summary>
public sealed class ProfileViewModel : ObservableObject
{
    private readonly IHubApiClient _api;

    private string _displayName = string.Empty;
    private string _userName = string.Empty;
    private string _initials = "·";
    private string _sessionExpiresText = string.Empty;
    private string _deviceIdText = string.Empty;

    /// <param name="api">API-клиент шелла (сессия, BaseUri).</param>
    /// <param name="signOutCommand">Команда выхода шелла (LogoutCommand).</param>
    public ProfileViewModel(IHubApiClient api, ICommand signOutCommand)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        SignOutCommand = signOutCommand ?? throw new ArgumentNullException(nameof(signOutCommand));

        AppVersionText = ResolveAppVersion();
        ServerText = api.BaseUri.GetLeftPart(UriPartial.Authority);
        RefreshCommand = new NativeRelayCommand(() =>
        {
            if (_api.CurrentSession is { } session)
            {
                SetSession(session);
            }
        });
    }

    /// <summary>Отображаемое имя (FullName, при пустом — логин).</summary>
    public string DisplayName
    {
        get => _displayName;
        private set => SetProperty(ref _displayName, value);
    }

    /// <summary>Логин учётной записи HUB.</summary>
    public string UserName
    {
        get => _userName;
        private set => SetProperty(ref _userName, value);
    }

    /// <summary>Инициалы для кружка-аватара (максимум 2 буквы).</summary>
    public string Initials
    {
        get => _initials;
        private set => SetProperty(ref _initials, value);
    }

    /// <summary>Локальное время истечения access-токена: «dd.MM.yyyy HH:mm».</summary>
    public string SessionExpiresText
    {
        get => _sessionExpiresText;
        private set => SetProperty(ref _sessionExpiresText, value);
    }

    /// <summary>Идентификатор устройства, под которым клиент ходит в API.</summary>
    public string DeviceIdText
    {
        get => _deviceIdText;
        private set => SetProperty(ref _deviceIdText, value);
    }

    /// <summary>Версия сборки приложения (из Assembly).</summary>
    public string AppVersionText { get; }

    /// <summary>Origin сервера HUB (api.BaseUri без пути).</summary>
    public string ServerText { get; }

    /// <summary>Выход из учётной записи — команда шелла (LogoutCommand).</summary>
    public ICommand SignOutCommand { get; }

    /// <summary>Перечитать данные активной сессии (F5 на странице профиля).</summary>
    public ICommand RefreshCommand { get; }

    /// <summary>Шелл подставляет активную сессию после входа/восстановления.</summary>
    public void SetSession(NativeSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        DisplayName = string.IsNullOrWhiteSpace(session.FullName)
            ? session.UserName
            : session.FullName;
        UserName = session.UserName;
        Initials = BuildInitials(DisplayName);
        SessionExpiresText = session.AccessTokenExpiresAtUtc
            .ToLocalTime()
            .ToString("dd.MM.yyyy HH:mm", CultureInfo.CurrentCulture);
        DeviceIdText = session.ClientDeviceId;
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        DisplayName = string.Empty;
        UserName = string.Empty;
        Initials = "·";
        SessionExpiresText = string.Empty;
        DeviceIdText = string.Empty;
    }

    private static string ResolveAppVersion() =>
        (Assembly.GetEntryAssembly() ?? Assembly.GetExecutingAssembly())
            .GetName().Version?.ToString() ?? "—";

    private static string BuildInitials(string displayName)
    {
        var initials = string.Concat(
            displayName
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Take(2)
                .Select(w => char.ToUpperInvariant(w[0])));
        return initials.Length == 0 ? "·" : initials;
    }
}
