using System.Windows;
using Microsoft.Win32;
using Application = System.Windows.Application;

namespace Hub.Desktop.Native;

/// <summary>
/// Тема нативного шелла: "light"|"dark"|"system" → подмена словаря палитры
/// (HubColorsDark.xaml / HubColorsLight.xaml) в Application.Resources.
/// Все ссылки на Hub-кисти в разметке — DynamicResource, поэтому смена
/// Source словаря перекрашивает окно на лету.
///
/// "system" читает реестр AppsUseLightTheme (HKCU …\Personalize) и следит
/// за изменением через SystemEvents.UserPreferenceChanged.
///
/// Отдельно от DesktopThemeMode: тот отвечает за WebView-хром
/// (titlebar, трей, уведомления) и управляется веб-шеллом.
/// </summary>
public static class NativeThemeManager
{
    internal const string DarkPaletteFileName = "HubColorsDark.xaml";
    internal const string LightPaletteFileName = "HubColorsLight.xaml";

    // Component URI с явным именем сборки: палитра лежит в HUB.Desktop,
    // а «application» в тестах — testhost. Относительный (не pack://) вид
    // сознательно: System.Uri без зарегистрированного WPF-парсера падает
    // на «application:,,,» («Invalid port»), а ResourceDictionary резолвит
    // относительный component URI собственной pack-механикой.
    internal static readonly Uri DarkPaletteUri = new(
        "/HUB.Desktop;component/Native/Themes/HubColorsDark.xaml",
        UriKind.Relative);
    internal static readonly Uri LightPaletteUri = new(
        "/HUB.Desktop;component/Native/Themes/HubColorsLight.xaml",
        UriKind.Relative);

    /// <summary>Ключ-пробник палитры: по нему view/окно узнаёт, что палитра доступна.</summary>
    private const string PaletteProbeKey = "HubBackgroundBrush";

    private const string PersonalizeKeyPath =
        @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    private const string AppsUseLightThemeValueName = "AppsUseLightTheme";

    private static readonly object Sync = new();
    private static string _currentMode = "dark";
    private static string _effectiveMode = "dark";
    private static bool _systemEventsHooked;

    /// <summary>Выбранный пользователем режим: light|dark|system.</summary>
    public static string CurrentMode
    {
        get { lock (Sync) { return _currentMode; } }
    }

    /// <summary>Реально применённая тема: light|dark (system разрешён в конкретную).</summary>
    public static string EffectiveMode
    {
        get { lock (Sync) { return _effectiveMode; } }
    }

    /// <summary>Эффективная тема сменилась (light ↔ dark).</summary>
    public static event EventHandler? EffectiveThemeChanged;

    /// <summary>
    /// Крюк для тестов: чтение DWORD AppsUseLightTheme
    /// (1 = светлая, 0/null = тёмная). null → чтение реестра.
    /// </summary>
    internal static Func<int?>? AppsUseLightThemeReader { get; set; }

    /// <summary>
    /// Применяет режим: нормализует, разрешает system через реестр и меняет
    /// словарь палитры в Application.Resources (на диспетчере приложения).
    /// Без Application (юнит-тесты VM) просто обновляет CurrentMode/EffectiveMode.
    /// Возвращает эффективный режим.
    /// </summary>
    public static string Apply(string? mode)
    {
        var normalized = NormalizeMode(mode);
        var effective = normalized == "system" ? ResolveSystemMode() : normalized;

        bool changed;
        lock (Sync)
        {
            changed = _effectiveMode != effective;
            _currentMode = normalized;
            _effectiveMode = effective;
        }

        var app = Application.Current;
        if (app is not null)
        {
            ApplyToApplication(app, effective, watchSystem: normalized == "system");
        }

        if (changed)
        {
            EffectiveThemeChanged?.Invoke(null, EventArgs.Empty);
        }

        return effective;
    }

    /// <summary>
    /// Standalone-рендер без Application (STA-тесты, генератор скриншотов):
    /// если палитра недоступна ни локально, ни в Application.Resources —
    /// дозаливает тёмную в ресурсы элемента. В реальном приложении палитра
    /// уже в Application.Resources — метод ничего не делает и элемент
    /// следует теме приложения.
    /// </summary>
    internal static void EnsureFallbackPalette(FrameworkElement element)
    {
        ArgumentNullException.ThrowIfNull(element);
        if (element.TryFindResource(PaletteProbeKey) is not null)
        {
            return;
        }

        element.Resources.MergedDictionaries.Add(
            new ResourceDictionary { Source = DarkPaletteUri });
    }

    /// <summary>Системный режим оформления приложений Windows (реестр; неизвестно → dark).</summary>
    internal static string ResolveSystemMode() =>
        ReadAppsUseLightTheme() == 1 ? "light" : "dark";

    internal static string NormalizeMode(string? mode) => mode switch
    {
        "light" => "light",
        "dark" => "dark",
        _ => "system",
    };

    private static int? ReadAppsUseLightTheme()
    {
        var reader = AppsUseLightThemeReader;
        if (reader is not null)
        {
            return reader();
        }

        try
        {
            return Registry.GetValue(
                PersonalizeKeyPath,
                AppsUseLightThemeValueName,
                null) as int?;
        }
        catch
        {
            return null;
        }
    }

    private static void ApplyToApplication(Application app, string effective, bool watchSystem)
    {
        if (!app.Dispatcher.CheckAccess())
        {
            _ = app.Dispatcher.BeginInvoke(() => ApplyToApplication(app, effective, watchSystem));
            return;
        }

        SwapPaletteDictionary(app.Resources, effective);

        if (watchSystem)
        {
            HookSystemEvents();
        }
    }

    /// <summary>
    /// Подмена словаря палитры внутри host-словаря (обычно Application.Resources):
    /// находит замердженный словарь HubColorsDark/Light и переключает его Source;
    /// если палитры нет — добавляет новую.
    /// </summary>
    internal static void SwapPaletteDictionary(ResourceDictionary host, string effective)
    {
        ArgumentNullException.ThrowIfNull(host);
        var paletteUri = effective == "light" ? LightPaletteUri : DarkPaletteUri;
        var merged = host.MergedDictionaries;
        ResourceDictionary? palette = null;
        foreach (var dictionary in merged)
        {
            if (IsPaletteDictionary(dictionary))
            {
                palette = dictionary;
                break;
            }
        }

        if (palette is null)
        {
            merged.Add(new ResourceDictionary { Source = paletteUri });
        }
        else
        {
            var source = palette.Source?.OriginalString ?? string.Empty;
            var alreadyApplied = source.EndsWith(
                effective == "light" ? LightPaletteFileName : DarkPaletteFileName,
                StringComparison.OrdinalIgnoreCase);
            if (!alreadyApplied)
            {
                // Замена объекта словаря (а не его Source): CollectionChanged
                // инвалидирует все DynamicResource-привязки ниже по дереву —
                // смена Source у замердженного словаря потребителей не будит.
                // Source из XAML относительный, из кода — component URI: сравниваем
                // по имени файла, чтобы повторный Apply той же темы был идемпотентен.
                merged[merged.IndexOf(palette)] =
                    new ResourceDictionary { Source = paletteUri };
            }
        }
    }

    private static bool IsPaletteDictionary(ResourceDictionary dictionary)
    {
        var source = dictionary.Source?.OriginalString;
        return source is not null
            && (source.EndsWith(DarkPaletteFileName, StringComparison.OrdinalIgnoreCase)
                || source.EndsWith(LightPaletteFileName, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>Подписка на смену системной темы — дорого не держать подписанным всегда.</summary>
    private static void HookSystemEvents()
    {
        if (_systemEventsHooked)
        {
            return;
        }

        _systemEventsHooked = true;
        try
        {
            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        }
        catch
        {
            _systemEventsHooked = false;
        }
    }

    private static void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
    {
        // Смена AppsUseLightTheme приходит с категорией Color или General.
        if (e.Category is not (UserPreferenceCategory.Color or UserPreferenceCategory.General))
        {
            return;
        }

        if (CurrentMode != "system")
        {
            return;
        }

        Apply("system");
    }
}
