using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Media.Imaging;
// ImplicitUsings тянут System.Drawing — алиасы фиксируют WPF-типы.
using Brush = System.Windows.Media.Brush;
using FontFamily = System.Windows.Media.FontFamily;
using Image = System.Windows.Controls.Image;
using SystemFonts = System.Windows.SystemFonts;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Самостоятельная эмодзи-иконка: цветной Twemoji PNG из Assets/Emoji, а при
/// отсутствии ассета — исходный текстовый глиф (Segoe UI Emoji / Symbol).
/// Glyph принимает строку-эмодзи или любой другой контент (элемент иконки
/// меню и т.п.) — нестроковый контент просто выводится как есть.
/// Размер картинки привязан к FontSize элемента (унаследован или задан явно),
/// как у текстового глифа ~1 em.
/// </summary>
public sealed class EmojiGlyph : Decorator
{
    private readonly Image _image;
    private readonly ContentPresenter _fallback;

    public EmojiGlyph()
    {
        var grid = new Grid();
        _image = new Image
        {
            Stretch = Stretch.Uniform,
            StretchDirection = StretchDirection.DownOnly,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
            VerticalAlignment = System.Windows.VerticalAlignment.Center,
            Visibility = Visibility.Collapsed,
        };
        RenderOptions.SetBitmapScalingMode(_image, BitmapScalingMode.HighQuality);
        _fallback = new ContentPresenter
        {
            HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
            VerticalAlignment = System.Windows.VerticalAlignment.Center,
        };
        grid.Children.Add(_fallback);
        grid.Children.Add(_image);
        Child = grid;
        IsHitTestVisible = false;
        Focusable = false;
        UpdateImageSize();
    }

    private const double ImageScale = 1.15; // PNG заполняет весь кадр — чуть крупнее глифа, как в Telegram

    /// <summary>Строка-эмодзи либо готовый контент иконки (например, TextBlock из MenuItem.Icon).</summary>
    public static readonly DependencyProperty GlyphProperty = DependencyProperty.Register(
        nameof(Glyph),
        typeof(object),
        typeof(EmojiGlyph),
        new FrameworkPropertyMetadata(null, OnGlyphChanged));

    public object? Glyph
    {
        get => GetValue(GlyphProperty);
        set => SetValue(GlyphProperty, value);
    }

    // FontSize/Foreground унаследованы от TextElement — глиф масштабируется как
    // окружающий текст без дублирования размеров в разметке. Квадрат картинки
    // привязан к FontSize (×1.15 — PNG заполняет кадр целиком, как в Telegram).
    public static readonly DependencyProperty FontSizeProperty =
        TextElement.FontSizeProperty.AddOwner(
            typeof(EmojiGlyph),
            new FrameworkPropertyMetadata(
                SystemFonts.MessageFontSize,
                FrameworkPropertyMetadataOptions.Inherits,
                OnFontSizeChanged));

    public double FontSize
    {
        get => (double)GetValue(FontSizeProperty);
        set => SetValue(FontSizeProperty, value);
    }

    public static readonly DependencyProperty FontWeightProperty =
        TextElement.FontWeightProperty.AddOwner(typeof(EmojiGlyph));

    public FontWeight FontWeight
    {
        get => (FontWeight)GetValue(FontWeightProperty);
        set => SetValue(FontWeightProperty, value);
    }

    public static readonly DependencyProperty FontFamilyProperty =
        TextElement.FontFamilyProperty.AddOwner(typeof(EmojiGlyph));

    public FontFamily FontFamily
    {
        get => (FontFamily)GetValue(FontFamilyProperty);
        set => SetValue(FontFamilyProperty, value);
    }

    public static readonly DependencyProperty ForegroundProperty =
        TextElement.ForegroundProperty.AddOwner(typeof(EmojiGlyph));

    public Brush Foreground
    {
        get => (Brush)GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    private static void OnFontSizeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        ((EmojiGlyph)d).UpdateImageSize();
    }

    private void UpdateImageSize()
    {
        var size = FontSize * ImageScale;
        _image.Width = size;
        _image.Height = size;
    }

    private static void OnGlyphChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var self = (EmojiGlyph)d;
        var image = e.NewValue is string emoji ? EmojiImageProvider.GetImage(emoji) : null;
        if (image is not null)
        {
            self._image.Source = image;
            self._image.Visibility = Visibility.Visible;
            self._fallback.Content = null;
            self._fallback.Visibility = Visibility.Collapsed;
        }
        else
        {
            self._image.Source = null;
            self._image.Visibility = Visibility.Collapsed;
            self._fallback.Content = e.NewValue;
            self._fallback.Visibility = Visibility.Visible;
        }
    }
}
