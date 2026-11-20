using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Media;
using System.Windows.Shapes;
// ImplicitUsings тянут System.Drawing — алиасы фиксируют WPF-типы.
using Binding = System.Windows.Data.Binding;
using BindingOperations = System.Windows.Data.BindingOperations;
using Brush = System.Windows.Media.Brush;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Монохромная векторная иконка хрома интерфейса: заливка следует унаследованному
/// Foreground (как у текстового глифа), геометрия — из VectorIcons через
/// {x:Static} или биндингом в Data. Размер — квадрат Size (20 по умолчанию),
/// масштаб Uniform без обрезки. Замена эмодзи-иконкам: цветные Twemoji уместны
/// только для эмодзи-контента (панель, реакции), не для кнопок интерфейса.
/// </summary>
public sealed class VectorIcon : Decorator
{
    private readonly Path _path;

    public VectorIcon()
    {
        _path = new Path
        {
            Stretch = Stretch.Uniform,
            HorizontalAlignment = System.Windows.HorizontalAlignment.Center,
            VerticalAlignment = System.Windows.VerticalAlignment.Center,
        };
        _path.SetBinding(Shape.FillProperty, new Binding(nameof(Foreground)) { Source = this });
        Child = _path;
        IsHitTestVisible = false;
        Focusable = false;
        UpdateSize();
    }

    /// <summary>Геометрия иконки ({x:Static local:VectorIcons.*} либо биндинг/конвертер).</summary>
    public static readonly DependencyProperty DataProperty = DependencyProperty.Register(
        nameof(Data),
        typeof(Geometry),
        typeof(VectorIcon),
        new FrameworkPropertyMetadata(null, OnDataChanged));

    public Geometry? Data
    {
        get => (Geometry?)GetValue(DataProperty);
        set => SetValue(DataProperty, value);
    }

    /// <summary>Сторона квадрата иконки в DIPs.</summary>
    public static readonly DependencyProperty SizeProperty = DependencyProperty.Register(
        nameof(Size),
        typeof(double),
        typeof(VectorIcon),
        new FrameworkPropertyMetadata(20.0, OnSizeChanged));

    public double Size
    {
        get => (double)GetValue(SizeProperty);
        set => SetValue(SizeProperty, value);
    }

    // Foreground унаследован от TextElement — каскадирует из кнопки/меню как у текста.
    public static readonly DependencyProperty ForegroundProperty =
        TextElement.ForegroundProperty.AddOwner(
            typeof(VectorIcon),
            new FrameworkPropertyMetadata(
                System.Windows.SystemColors.ControlTextBrush,
                FrameworkPropertyMetadataOptions.Inherits));

    public Brush Foreground
    {
        get => (Brush)GetValue(ForegroundProperty);
        set => SetValue(ForegroundProperty, value);
    }

    private static void OnDataChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var self = (VectorIcon)d;
        self._path.Data = e.NewValue as Geometry;
        // self.Visibility не трогаем: локальная запись уничтожает биндинг
        // видимости владельца (pin/mute в строках диалогов — CHAT-ROWS). Null-
        // геометрия прячет только внутренний Path; элемент без данных пуст.
        self._path.Visibility = e.NewValue is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private static void OnSizeChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        ((VectorIcon)d).UpdateSize();
    }

    private void UpdateSize()
    {
        _path.Width = Size;
        _path.Height = Size;
    }
}
