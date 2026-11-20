using System.Windows;
using System.Windows.Media;
using Hub.Desktop.Native;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Тесты темы нативного шелла. NativeThemeManager — статический и его
/// Apply залезает в Application.Resources, поэтому классы, которые
/// реально применяют тему (менеджер, шелл/настройки/почта через
/// SettingsViewModel, генератор скриншотов), выполняются последовательно
/// в одной коллекции — иначе параллельный Apply ломал бы проверки.
/// </summary>
[CollectionDefinition("NativeTheme")]
public sealed class NativeThemeCollectionDefinition;

[Collection("NativeTheme")]
public sealed class NativeThemeManagerTests
{
    [Fact]
    public void ApplyNormalizesModeAndResolvesSystemViaReader()
    {
        var previous = NativeThemeManager.AppsUseLightThemeReader;
        try
        {
            NativeThemeManager.AppsUseLightThemeReader = () => 1;
            Assert.Equal("light", NativeThemeManager.Apply("system"));
            Assert.Equal("system", NativeThemeManager.CurrentMode);
            Assert.Equal("light", NativeThemeManager.EffectiveMode);

            NativeThemeManager.AppsUseLightThemeReader = () => 0;
            Assert.Equal("dark", NativeThemeManager.Apply("system"));
            Assert.Equal("dark", NativeThemeManager.EffectiveMode);

            // Нечитаемый реестр → консервативный dark.
            NativeThemeManager.AppsUseLightThemeReader = () => null;
            Assert.Equal("dark", NativeThemeManager.Apply("system"));

            // Неизвестное значение сводится к "system" (как у SettingsViewModel).
            Assert.Equal("dark", NativeThemeManager.Apply("neon"));
            Assert.Equal("system", NativeThemeManager.CurrentMode);

            // Явные режимы не трогают реестр.
            Assert.Equal("light", NativeThemeManager.Apply("light"));
            Assert.Equal("light", NativeThemeManager.CurrentMode);
            Assert.Equal("light", NativeThemeManager.EffectiveMode);
        }
        finally
        {
            NativeThemeManager.AppsUseLightThemeReader = previous;
            NativeThemeManager.Apply("dark");
        }
    }

    [Fact]
    public void ApplyRaisesEventOnlyWhenEffectiveThemeChanges()
    {
        // Стартовое состояние статики зависит от порядка тестов —
        // нормализуем к dark до подписки на событие.
        NativeThemeManager.Apply("dark");

        var calls = 0;
        EventHandler handler = (_, _) => calls++;
        try
        {
            NativeThemeManager.EffectiveThemeChanged += handler;

            NativeThemeManager.Apply("dark");
            Assert.Equal(0, calls);

            NativeThemeManager.Apply("light");
            Assert.Equal(1, calls);

            NativeThemeManager.Apply("light");
            Assert.Equal(1, calls);

            NativeThemeManager.Apply("dark");
            Assert.Equal(2, calls);
        }
        finally
        {
            NativeThemeManager.EffectiveThemeChanged -= handler;
            NativeThemeManager.Apply("dark");
        }
    }

    /// <summary>
    /// Подмена Source у словаря палитры внутри host-словаря (так Apply
    /// перекрашивает Application.Resources): кисти начинают отдавать цвета
    /// другой темы, повторный Apply той же темы словарь не пересоздаёт.
    /// Плюс контракт палитр — одинаковый набор ключей в dark и light файлах.
    /// </summary>
    [Fact]
    public void SwapPaletteDictionarySwitchesBrushColors()
    {
        var host = new ResourceDictionary();
        host.MergedDictionaries.Add(
            new ResourceDictionary { Source = NativeThemeManager.DarkPaletteUri });

        NativeThemeManager.SwapPaletteDictionary(host, "light");
        var palette = Assert.Single(host.MergedDictionaries);
        AssertBrush(palette, "HubTextBrush", 0x1D, 0x21, 0x26);
        AssertBrush(palette, "HubBackgroundBrush", 0xF5, 0xF6, 0xF8);
        AssertBrush(palette, "HubOnAccentBrush", 0xFF, 0xFF, 0xFF);

        // Идемпотентно: тот же режим не пересоздаёт словарь.
        NativeThemeManager.SwapPaletteDictionary(host, "light");
        Assert.Same(palette, Assert.Single(host.MergedDictionaries));

        NativeThemeManager.SwapPaletteDictionary(host, "dark");
        palette = Assert.Single(host.MergedDictionaries);
        AssertBrush(palette, "HubTextBrush", 0xF0, 0xF2, 0xF5);
        AssertBrush(palette, "HubBackgroundBrush", 0x19, 0x1B, 0x1F);
        AssertBrush(palette, "HubOnAccentBrush", 0x10, 0x22, 0x2E);
    }

    /// <summary>Dark/light палитры обязаны содержать одинаковый набор ключей.</summary>
    [Fact]
    public void PalettesExposeIdenticalKeySets()
    {
        var dark = new ResourceDictionary { Source = NativeThemeManager.DarkPaletteUri };
        var light = new ResourceDictionary { Source = NativeThemeManager.LightPaletteUri };
        var darkKeys = dark.Keys.Cast<object>().Select(k => k.ToString()).ToArray();
        var lightKeys = light.Keys.Cast<object>().Select(k => k.ToString()).ToArray();

        Assert.Equal(darkKeys.Order(StringComparer.Ordinal), lightKeys.Order(StringComparer.Ordinal));
    }

    /// <summary>
    /// STA: view без родителя резолвит палитру — при наличии Application
    /// берёт тему из app-ресурсов, иначе EnsureFallbackPalette дозаливает
    /// тёмную локально. В любом случае ключи кистей разрешимы и рендер не падает.
    /// </summary>
    [Fact]
    public void StandaloneViewResolvesPaletteAndRendersOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var view = new Native.Views.DashboardView();
                var window = new Window
                {
                    Width = 1280,
                    Height = 800,
                    WindowStartupLocation = WindowStartupLocation.Manual,
                    Left = -30000,
                    Top = -30000,
                    ShowInTaskbar = false,
                    Content = view,
                };
                window.Show();
                window.UpdateLayout();

                Assert.IsType<SolidColorBrush>(view.FindResource("HubBackgroundBrush"));
                Assert.IsType<SolidColorBrush>(view.FindResource("HubAccentBrush"));

                window.Close();
            }
            catch (Exception exception)
            {
                captured = exception;
            }
            finally
            {
                completed.Set();
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(completed.Wait(TimeSpan.FromSeconds(30)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }

    private static void AssertBrush(ResourceDictionary dictionary, string key, byte r, byte g, byte b)
    {
        var brush = Assert.IsType<SolidColorBrush>(dictionary[key]);
        Assert.Equal(Color.FromRgb(r, g, b), brush.Color);
    }
}
