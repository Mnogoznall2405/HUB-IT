using System.Globalization;
using System.Windows.Input;
using Hub.Desktop.Native.Api;

namespace Hub.Desktop.Native.ViewModels;

/// <summary>Строка левой навигации разделов настроек.</summary>
public sealed record SettingsSectionItem(string Key, string Title, string Description);

/// <summary>
/// Поля формы смены пароля. PasswordBox не отдаёт значения через привязку,
/// поэтому представление передаёт их одним объектом в команду.
/// </summary>
public sealed record HubPasswordChangeInput(
    string OldPassword,
    string NewPassword,
    string ConfirmPassword);

/// <summary>
/// Страница «Настройки» нативного шелла: пользовательские разделы как в веб-версии
/// («Внешний вид», «Уведомления», «Безопасность»). Каждая секция сохраняется
/// отдельной кнопкой; ошибки — в общем баннере, успех — статусом «Сохранено».
///
/// Сознательно не выносятся: административные /settings/app и /settings/env,
/// управление 2FA/Passkey (показан только read-only статус) и push-подписки
/// (нативные toast-уведомления — локальные, серверной подписки не требуют).
/// </summary>
public sealed class SettingsViewModel : ObservableObject
{
    /// <summary>Раздел «Внешний вид» — ключ навигации внутри страницы.</summary>
    public const string AppearanceSectionKey = "appearance";

    /// <summary>Раздел «Уведомления».</summary>
    public const string NotificationsSectionKey = "notifications";

    /// <summary>Раздел «Безопасность».</summary>
    public const string SecuritySectionKey = "security";

    /// <summary>Минимальная длина нового пароля — как в backend-модели и mobile-hub.</summary>
    public const int MinPasswordLength = 6;

    private static readonly string[] AllowedThemeModes = ["light", "dark", "system"];
    private static readonly string[] AllowedFontFamilies = ["Aptos", "Segoe UI", "Inter", "Roboto"];

    private readonly IHubApiClient _api;
    // Применение темы нативного шелла; в тестах подменяется заглушкой.
    private readonly Action<string> _applyTheme;

    private bool _isLoading;
    private string? _bannerErrorText;
    private string _selectedSectionKey = AppearanceSectionKey;

    // Внешний вид.
    private string _themeMode = "system";
    private string _fontFamily = "Aptos";
    private string _fontScaleText = "1,00";
    private string? _appearanceStatusText;

    // Уведомления.
    private bool _notifyMail = true;
    private bool _notifyTasks = true;
    private bool _notifyTaskEmail = true;
    private bool _notifyAnnouncements = true;
    private bool _notifyChat = true;
    private bool _notifyChatDirect = true;
    private bool _notifyChatGroup = true;
    private bool _notifyChatTask = true;
    private bool _notifyChatAi = true;
    private bool _notifyChatSound = true;
    private bool _hasNotificationPreferences;
    private string? _notificationsStatusText;

    // Безопасность: статус 2FA read-only + смена пароля.
    private string _twoFactorStatusText = "—";
    private string _twoFactorPolicyText = "—";
    private string _networkZoneText = "—";
    private string? _securityStatusText;
    private bool _isPasswordBusy;

    public SettingsViewModel(IHubApiClient api, Action<string>? applyTheme = null)
    {
        _api = api ?? throw new ArgumentNullException(nameof(api));
        _applyTheme = applyTheme ?? (mode => NativeThemeManager.Apply(mode));

        Sections =
        [
            new SettingsSectionItem(
                AppearanceSectionKey, "Внешний вид", "Тема, шрифт и масштаб интерфейса."),
            new SettingsSectionItem(
                NotificationsSectionKey, "Уведомления", "Какие уведомления получать."),
            new SettingsSectionItem(
                SecuritySectionKey, "Безопасность", "Двухфакторная защита и пароль."),
        ];

        RefreshCommand = new NativeAsyncCommand(
            (_, ct) => LoadAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SaveAppearanceCommand = new NativeAsyncCommand(
            (_, ct) => SaveAppearanceAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        SaveNotificationsCommand = new NativeAsyncCommand(
            (_, ct) => SaveNotificationsAsync(ct),
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        ChangePasswordCommand = new NativeAsyncCommand(
            async (parameter, ct) =>
            {
                var input = parameter as HubPasswordChangeInput
                    ?? new HubPasswordChangeInput(string.Empty, string.Empty, string.Empty);
                await SubmitPasswordChangeAsync(input);
            },
            ex => BannerErrorText = TasksViewModel.DescribeError(ex));
        DismissBannerCommand = new NativeRelayCommand(() => BannerErrorText = null);
    }

    /// <summary>Разделы левой навигации страницы (порядок как в вебе).</summary>
    public IReadOnlyList<SettingsSectionItem> Sections { get; }

    /// <summary>Текущий раздел (appearance/notifications/security).</summary>
    public string SelectedSectionKey
    {
        get => _selectedSectionKey;
        set
        {
            var key = value switch
            {
                NotificationsSectionKey => NotificationsSectionKey,
                SecuritySectionKey => SecuritySectionKey,
                _ => AppearanceSectionKey,
            };
            if (SetProperty(ref _selectedSectionKey, key))
            {
                OnPropertyChanged(nameof(IsAppearanceSection));
                OnPropertyChanged(nameof(IsNotificationsSection));
                OnPropertyChanged(nameof(IsSecuritySection));
            }
        }
    }

    public bool IsAppearanceSection
    {
        get => SelectedSectionKey == AppearanceSectionKey;
        set { if (value) SelectedSectionKey = AppearanceSectionKey; }
    }

    public bool IsNotificationsSection
    {
        get => SelectedSectionKey == NotificationsSectionKey;
        set { if (value) SelectedSectionKey = NotificationsSectionKey; }
    }

    public bool IsSecuritySection
    {
        get => SelectedSectionKey == SecuritySectionKey;
        set { if (value) SelectedSectionKey = SecuritySectionKey; }
    }

    public bool IsLoading
    {
        get => _isLoading;
        private set => SetProperty(ref _isLoading, value);
    }

    /// <summary>Текст общего баннера ошибки (null — баннер скрыт).</summary>
    public string? BannerErrorText
    {
        get => _bannerErrorText;
        set
        {
            if (SetProperty(ref _bannerErrorText, value))
            {
                OnPropertyChanged(nameof(HasBannerError));
            }
        }
    }

    public bool HasBannerError => !string.IsNullOrWhiteSpace(BannerErrorText);

    // ---- Внешний вид ----

    /// <summary>theme_mode контракта: light|dark|system.</summary>
    public string ThemeMode
    {
        get => _themeMode;
        set
        {
            if (SetProperty(ref _themeMode, value ?? "system"))
            {
                OnPropertyChanged(nameof(IsThemeLight));
                OnPropertyChanged(nameof(IsThemeDark));
                OnPropertyChanged(nameof(IsThemeSystem));
            }
        }
    }

    public bool IsThemeLight
    {
        get => ThemeMode == "light";
        set { if (value) ThemeMode = "light"; }
    }

    public bool IsThemeDark
    {
        get => ThemeMode == "dark";
        set { if (value) ThemeMode = "dark"; }
    }

    public bool IsThemeSystem
    {
        get => ThemeMode == "system";
        set { if (value) ThemeMode = "system"; }
    }

    /// <summary>font_family контракта: Aptos|Segoe UI|Inter|Roboto.</summary>
    public string FontFamily
    {
        get => _fontFamily;
        set
        {
            if (SetProperty(ref _fontFamily, value ?? "Aptos"))
            {
                OnPropertyChanged(nameof(IsFontAptos));
                OnPropertyChanged(nameof(IsFontSegoeUi));
                OnPropertyChanged(nameof(IsFontInter));
                OnPropertyChanged(nameof(IsFontRoboto));
            }
        }
    }

    public bool IsFontAptos
    {
        get => FontFamily == "Aptos";
        set { if (value) FontFamily = "Aptos"; }
    }

    public bool IsFontSegoeUi
    {
        get => FontFamily == "Segoe UI";
        set { if (value) FontFamily = "Segoe UI"; }
    }

    public bool IsFontInter
    {
        get => FontFamily == "Inter";
        set { if (value) FontFamily = "Inter"; }
    }

    public bool IsFontRoboto
    {
        get => FontFamily == "Roboto";
        set { if (value) FontFamily = "Roboto"; }
    }

    /// <summary>Масштаб шрифта как введённое значение (0.90–1.20).</summary>
    public string FontScaleText
    {
        get => _fontScaleText;
        set => SetProperty(ref _fontScaleText, value ?? string.Empty);
    }

    /// <summary>Статус сохранения секции: «Сохранено» или null.</summary>
    public string? AppearanceStatusText
    {
        get => _appearanceStatusText;
        private set => SetProperty(ref _appearanceStatusText, value);
    }

    // ---- Уведомления ----

    /// <summary>Настройки уведомлений загружены с сервера (иначе тумблеры не сохранять нельзя, но показываем).</summary>
    public bool HasNotificationPreferences
    {
        get => _hasNotificationPreferences;
        private set => SetProperty(ref _hasNotificationPreferences, value);
    }

    public bool NotifyMail
    {
        get => _notifyMail;
        set => SetProperty(ref _notifyMail, value);
    }

    public bool NotifyTasks
    {
        get => _notifyTasks;
        set => SetProperty(ref _notifyTasks, value);
    }

    public bool NotifyTaskEmail
    {
        get => _notifyTaskEmail;
        set => SetProperty(ref _notifyTaskEmail, value);
    }

    public bool NotifyAnnouncements
    {
        get => _notifyAnnouncements;
        set => SetProperty(ref _notifyAnnouncements, value);
    }

    /// <summary>
    /// Мастер-переключатель чат-уведомлений: как в вебе, включение/выключение
    /// применяется ко всем чат-подканалам (кроме звука).
    /// </summary>
    public bool NotifyChat
    {
        get => _notifyChat;
        set
        {
            if (SetProperty(ref _notifyChat, value))
            {
                OnPropertyChanged(nameof(AreChatSubchannelsEnabled));
                NotifyChatDirect = value;
                NotifyChatGroup = value;
                NotifyChatTask = value;
                NotifyChatAi = value;
            }
        }
    }

    public bool NotifyChatDirect
    {
        get => _notifyChatDirect;
        set
        {
            if (SetProperty(ref _notifyChatDirect, value))
            {
                SyncChatMaster();
            }
        }
    }

    public bool NotifyChatGroup
    {
        get => _notifyChatGroup;
        set
        {
            if (SetProperty(ref _notifyChatGroup, value))
            {
                SyncChatMaster();
            }
        }
    }

    public bool NotifyChatTask
    {
        get => _notifyChatTask;
        set
        {
            if (SetProperty(ref _notifyChatTask, value))
            {
                SyncChatMaster();
            }
        }
    }

    public bool NotifyChatAi
    {
        get => _notifyChatAi;
        set
        {
            if (SetProperty(ref _notifyChatAi, value))
            {
                SyncChatMaster();
            }
        }
    }

    /// <summary>Звук сообщений: подканал чата, но мастер-переключателем не накрывается (как в вебе).</summary>
    public bool NotifyChatSound
    {
        get => _notifyChatSound;
        set => SetProperty(ref _notifyChatSound, value);
    }

    /// <summary>Подканалы чата недоступны, пока мастер-уведомления о чатах выключены.</summary>
    public bool AreChatSubchannelsEnabled => NotifyChat;

    /// <summary>Статус сохранения секции уведомлений.</summary>
    public string? NotificationsStatusText
    {
        get => _notificationsStatusText;
        private set => SetProperty(ref _notificationsStatusText, value);
    }

    // ---- Безопасность ----

    /// <summary>Read-only статус 2FA из GET /auth/me («Включена»/«Не включена»).</summary>
    public string TwoFactorStatusText
    {
        get => _twoFactorStatusText;
        private set => SetProperty(ref _twoFactorStatusText, value);
    }

    /// <summary>Read-only политика 2FA (задаёт администратор на сервере).</summary>
    public string TwoFactorPolicyText
    {
        get => _twoFactorPolicyText;
        private set => SetProperty(ref _twoFactorPolicyText, value);
    }

    /// <summary>Read-only зона сети текущего запроса.</summary>
    public string NetworkZoneText
    {
        get => _networkZoneText;
        private set => SetProperty(ref _networkZoneText, value);
    }

    /// <summary>Статус смены пароля (успех-подсказка; ошибки идут в баннер).</summary>
    public string? SecurityStatusText
    {
        get => _securityStatusText;
        private set => SetProperty(ref _securityStatusText, value);
    }

    /// <summary>Идёт запрос смены пароля — кнопка и повторный вход блокируются.</summary>
    public bool IsPasswordBusy
    {
        get => _isPasswordBusy;
        private set => SetProperty(ref _isPasswordBusy, value);
    }

    public ICommand RefreshCommand { get; }
    public ICommand SaveAppearanceCommand { get; }
    public ICommand SaveNotificationsCommand { get; }
    public ICommand ChangePasswordCommand { get; }
    public ICommand DismissBannerCommand { get; }

    /// <summary>Загрузка всех секций: settings/me + notification preferences + auth/me.</summary>
    public async Task LoadAsync(CancellationToken cancellationToken = default)
    {
        IsLoading = true;
        try
        {
            var settings = await _api.GetMySettingsAsync(cancellationToken);
            ApplySettings(settings);

            var preferences = await _api.GetNotificationPreferencesAsync(cancellationToken);
            ApplyNotificationPreferences(preferences);

            // auth/me нужен только для read-only статуса 2FA: его сбой не должен
            // блокировать рабочие секции страницы.
            try
            {
                var user = await _api.GetCurrentUserAsync(cancellationToken);
                ApplySecurityStatus(user);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                SetSecurityStatusUnavailable();
            }

            BannerErrorText = null;
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>
    /// Шелл проставляет ошибку первичной загрузки (иначе страница молча пустая).
    /// </summary>
    public void SetLoadError(string? errorText) => BannerErrorText = errorText;

    /// <summary>Сохранение секции «Внешний вид»: клиентская валидация + PATCH /settings/me.</summary>
    private async Task SaveAppearanceAsync(CancellationToken cancellationToken)
    {
        BannerErrorText = null;
        AppearanceStatusText = null;
        if (!TryValidateAppearance(out var fontScale, out var validationError))
        {
            BannerErrorText = validationError;
            return;
        }

        var updated = await _api.UpdateMySettingsAsync(
            ThemeMode, FontFamily, fontScale, cancellationToken);
        ApplySettings(updated);
        AppearanceStatusText = "Сохранено";
    }

    /// <summary>Сохранение секции «Уведомления»: PATCH всех показанных каналов.</summary>
    private async Task SaveNotificationsAsync(CancellationToken cancellationToken)
    {
        BannerErrorText = null;
        NotificationsStatusText = null;
        var patch = new Dictionary<string, bool>
        {
            ["mail"] = NotifyMail,
            ["tasks"] = NotifyTasks,
            ["task_email"] = NotifyTaskEmail,
            ["announcements"] = NotifyAnnouncements,
            ["chat"] = NotifyChat,
            ["chat_direct"] = NotifyChatDirect,
            ["chat_group"] = NotifyChatGroup,
            ["chat_task"] = NotifyChatTask,
            ["chat_ai"] = NotifyChatAi,
            ["chat_sound"] = NotifyChatSound,
        };
        var updated = await _api.UpdateNotificationPreferencesAsync(patch, cancellationToken);
        ApplyNotificationPreferences(updated);
        NotificationsStatusText = "Сохранено";
    }

    /// <summary>
    /// Смена пароля: валидация как в mobile-hub (новый ≥ 6 символов, подтверждение
    /// совпадает) + POST /auth/change-password. Возвращает true при успехе —
    /// представление по нему очищает PasswordBox'ы. Ошибки (валидация и API)
    /// уходят в баннер; исключения наружу не бросаются.
    /// </summary>
    public async Task<bool> SubmitPasswordChangeAsync(HubPasswordChangeInput input)
    {
        ArgumentNullException.ThrowIfNull(input);
        if (IsPasswordBusy)
        {
            return false;
        }

        BannerErrorText = null;
        SecurityStatusText = null;

        if (string.IsNullOrEmpty(input.OldPassword))
        {
            BannerErrorText = "Введите текущий пароль.";
            return false;
        }

        if (string.IsNullOrEmpty(input.NewPassword) || input.NewPassword.Length < MinPasswordLength)
        {
            BannerErrorText = "Новый пароль должен быть не короче 6 символов.";
            return false;
        }

        if (!string.Equals(input.NewPassword, input.ConfirmPassword, StringComparison.Ordinal))
        {
            BannerErrorText = "Подтверждение пароля не совпадает.";
            return false;
        }

        IsPasswordBusy = true;
        try
        {
            _ = await _api.ChangePasswordAsync(input.OldPassword, input.NewPassword, CancellationToken.None);
            SecurityStatusText =
                "Пароль изменён. Сервер завершил активные сессии на всех устройствах — " +
                "при следующем запросе приложение попросит войти заново.";
            return true;
        }
        catch (Exception exception)
        {
            BannerErrorText = TasksViewModel.DescribeError(exception);
            return false;
        }
        finally
        {
            IsPasswordBusy = false;
        }
    }

    /// <summary>Сброс содержимого при выходе из сессии.</summary>
    public void Reset()
    {
        IsLoading = false;
        BannerErrorText = null;
        SelectedSectionKey = AppearanceSectionKey;

        ThemeMode = "system";
        FontFamily = "Aptos";
        FontScaleText = "1,00";
        AppearanceStatusText = null;

        NotifyMail = true;
        NotifyTasks = true;
        NotifyTaskEmail = true;
        NotifyAnnouncements = true;
        NotifyChat = true;
        NotifyChatSound = true;
        HasNotificationPreferences = false;
        NotificationsStatusText = null;

        SetSecurityStatusUnavailable();
        SecurityStatusText = null;
        IsPasswordBusy = false;
    }

    private void ApplySettings(HubUserSettings settings)
    {
        ThemeMode = settings.ThemeMode is { } mode && AllowedThemeModes.Contains(mode)
            ? mode
            : "system";
        FontFamily = settings.FontFamily is { } family && AllowedFontFamilies.Contains(family)
            ? family
            : "Aptos";
        FontScaleText = (settings.FontScale ?? 1.0).ToString("0.00", CultureInfo.CurrentCulture);
        // Тема нативного шелла применяется и при первичной загрузке,
        // и сразу после сохранения «Внешнего вида» — без перезапуска.
        _applyTheme(ThemeMode);
    }

    private void ApplyNotificationPreferences(HubNotificationPreferences? preferences)
    {
        var channels = preferences?.Channels ?? [];
        NotifyMail = GetChannel(channels, "mail");
        NotifyTasks = GetChannel(channels, "tasks");
        NotifyTaskEmail = GetChannel(channels, "task_email");
        NotifyAnnouncements = GetChannel(channels, "announcements");
        NotifyChatDirect = GetChannel(channels, "chat_direct");
        NotifyChatGroup = GetChannel(channels, "chat_group");
        NotifyChatTask = GetChannel(channels, "chat_task");
        NotifyChatAi = GetChannel(channels, "chat_ai");
        NotifyChatSound = GetChannel(channels, "chat_sound");
        SyncChatMaster();
        HasNotificationPreferences = true;
    }

    private static bool GetChannel(IReadOnlyDictionary<string, bool> channels, string key) =>
        !channels.TryGetValue(key, out var enabled) || enabled;

    /// <summary>Мастер-статус чат-уведомлений: включён, если есть хоть один активный подканал.</summary>
    private void SyncChatMaster()
    {
        if (SetProperty(
                ref _notifyChat,
                _notifyChatDirect || _notifyChatGroup || _notifyChatTask || _notifyChatAi,
                nameof(NotifyChat)))
        {
            OnPropertyChanged(nameof(AreChatSubchannelsEnabled));
        }
    }

    private void ApplySecurityStatus(HubUser user)
    {
        TwoFactorStatusText = user.IsTwoFactorEnabled ? "Включена" : "Не включена";
        TwoFactorPolicyText = user.TwoFactorPolicy switch
        {
            "all" => "Обязательна для всех входов",
            "external_only" => "Только для внешней сети",
            _ => "Не требуется",
        };
        NetworkZoneText = user.NetworkZone == "internal" ? "Внутренняя сеть" : "Внешняя сеть";
    }

    private void SetSecurityStatusUnavailable()
    {
        TwoFactorStatusText = "—";
        TwoFactorPolicyText = "—";
        NetworkZoneText = "—";
    }

    private bool TryValidateAppearance(out double fontScale, out string? error)
    {
        fontScale = 0;
        error = null;
        if (!AllowedThemeModes.Contains(ThemeMode))
        {
            error = "Выберите тему интерфейса.";
            return false;
        }

        if (!AllowedFontFamilies.Contains(FontFamily))
        {
            error = "Выберите шрифт интерфейса.";
            return false;
        }

        if (!TryParseFontScale(FontScaleText, out fontScale) || fontScale < 0.9 || fontScale > 1.2)
        {
            error = "Масштаб шрифта должен быть от 0,90 до 1,20.";
            return false;
        }

        return true;
    }

    /// <summary>Принимает «1.05» и «1,05» — разделитель зависит от локали.</summary>
    private static bool TryParseFontScale(string? text, out double value)
    {
        var normalized = (text ?? string.Empty).Trim().Replace(',', '.');
        return double.TryParse(
            normalized,
            NumberStyles.Float,
            CultureInfo.InvariantCulture,
            out value);
    }
}
