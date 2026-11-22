using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Media;
using Hub.Desktop.Native.ViewModels;

namespace Hub.Desktop.Native.Views;

/// <summary>true → false, false/null → true (IsEnabled = !IsBusy).</summary>
public sealed class InverseBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is not bool flag || !flag;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is not bool flag || !flag;
}

/// <summary>true → Collapsed, false → Visible.</summary>
public sealed class InverseBoolToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is bool flag && flag ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is Visibility visibility && visibility != Visibility.Visible;
}

/// <summary>Непустая строка → true, пустая/null → false (кликабельность карточек).</summary>
public sealed class NonEmptyStringToBoolConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        !string.IsNullOrWhiteSpace(value as string);

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Непустая строка → Visible, пустая/null → Collapsed.</summary>
public sealed class NonEmptyStringToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        string.IsNullOrWhiteSpace(value as string) ? Visibility.Collapsed : Visibility.Visible;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Заголовок группы дат списка писем: ключ группировки «0|Сегодня» сортируется
/// по номеру, а в заголовке показывается только текст после «|» — группы идут
/// в хронологическом порядке (WPF сортирует имена групп как строки).
/// </summary>
public sealed class MailGroupHeaderConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var name = value as string ?? string.Empty;
        var separator = name.IndexOf('|');
        return separator >= 0 && separator + 1 < name.Length
            ? name[(separator + 1)..]
            : name;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Объект не null → Visible, null → Collapsed; параметр «invert» переворачивает
/// (для плейсхолдеров «ничего не выбрано»).
/// </summary>
public sealed class NullToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var visible = value is not null;
        if (parameter is string flag && flag.Equals("invert", StringComparison.OrdinalIgnoreCase))
        {
            visible = !visible;
        }

        return visible ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Число × коэффициент из параметра → число (доля ширины ленты для MaxWidth
/// пузыря: ActualWidth * 0.68). Параметр — invariant double, по умолчанию 1.
/// </summary>
public sealed class RatioConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var factor = parameter is string text
            && double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
                ? parsed
                : 1.0;
        return value is double number && !double.IsNaN(number) && number > 0
            ? number * factor
            : 0.0;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Число 0 / пустая коллекция → Visible (плейсхолдеры пустых списков);
/// параметр «invert» переворачивает (count &gt; 0 → Visible).
/// </summary>
public sealed class ZeroToVisibilityConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        var visible = value is int count && count == 0;
        if (parameter is string flag && flag.Equals("invert", StringComparison.OrdinalIgnoreCase))
        {
            visible = !visible;
        }

        return visible ? Visibility.Visible : Visibility.Collapsed;
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Строка-эмодзи → цветной Twemoji BitmapImage из Assets/Emoji; null, если ассета
/// нет (тогда XAML оставляет текстовый глиф-фоллбэк). Прямые использования:
/// &lt;Image Source="{Binding Emoji, Converter={StaticResource EmojiToImage}}"&gt;.
/// </summary>
public sealed class EmojiToImageConverter : IValueConverter
{
    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string emoji ? EmojiImageProvider.GetImage(emoji) : null;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Строка-эмодзи из VM (иконка папки/меню: 💬/👤/👥/📁/🗃/…) → монохромная
/// VectorIcons-геометрия. Иконки хрома идут вектором и следуют Foreground темы;
/// неизвестные строки → null (VectorIcon скрывается). Эмодзи-контент (панель,
/// реакции) через EmojiToImage — сюда не попадает.
/// </summary>
public sealed class EmojiToVectorConverter : IValueConverter
{
    private static readonly Dictionary<string, Geometry> Map = new(StringComparer.Ordinal)
    {
        ["💬"] = VectorIcons.Chat,
        ["👤"] = VectorIcons.Person,
        ["👥"] = VectorIcons.Group,
        ["📌"] = VectorIcons.Pin,
        ["📁"] = VectorIcons.Folder,
        ["🗂"] = VectorIcons.Folder,
        ["🤖"] = VectorIcons.Robot,
        ["🗃"] = VectorIcons.Archive,
        ["📥"] = VectorIcons.Archive,
        ["📤"] = VectorIcons.Unarchive,
        ["🔕"] = VectorIcons.BellOff,
        ["🔔"] = VectorIcons.Bell,
        ["📎"] = VectorIcons.Attach,
        ["📄"] = VectorIcons.Document,
        ["🖼"] = VectorIcons.Photo,
        ["📷"] = VectorIcons.Photo,
        ["📋"] = VectorIcons.Task,
        ["🕐"] = VectorIcons.Clock,
        ["⏰"] = VectorIcons.Clock,
        ["🗑"] = VectorIcons.Trash,
        ["✎"] = VectorIcons.Edit,
        ["✏"] = VectorIcons.Edit,
        ["➤"] = VectorIcons.Send,
        ["🎤"] = VectorIcons.Mic,
        ["😊"] = VectorIcons.Emoji,
        ["🔍"] = VectorIcons.Search,
        ["☰"] = VectorIcons.Menu,
        ["≡"] = VectorIcons.Menu,
        ["⋮"] = VectorIcons.MoreVertical,
        ["✓"] = VectorIcons.Check,
        ["✓✓"] = VectorIcons.DoneAll,
        ["✕"] = VectorIcons.Close,
        ["↓"] = VectorIcons.ArrowDown,
        ["⬇"] = VectorIcons.Download,
        ["←"] = VectorIcons.Back,
        ["→"] = VectorIcons.ChevronRight,
        ["↩"] = VectorIcons.Reply,
        ["↪"] = VectorIcons.Forward,
        ["🚪"] = VectorIcons.Exit,
        ["⭐"] = VectorIcons.Star,
        ["👁"] = VectorIcons.Eye,
        ["ℹ"] = VectorIcons.Info,
        ["⚙"] = VectorIcons.Settings,
        ["📞"] = VectorIcons.Phone,
        ["🎥"] = VectorIcons.Video,
        ["➕"] = VectorIcons.Plus,
        ["＋"] = VectorIcons.Plus,
    };

    public object? Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        value is string icon && Map.TryGetValue(icon, out var geometry) ? geometry : null;

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Строка-имя пира → градиентная кисть аватара (палитра Telegram-пиров).</summary>
public sealed class ChatPeerBrushConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        ChatPeerPalette.AvatarBrush(value as string ?? "?");

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Строка-имя пира → двухбуквенные инициалы аватара.</summary>
public sealed class ChatPeerInitialsConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        ChatPeerPalette.Initials(value as string ?? "?");

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>Дата-время → «HH:mm» сегодня, иначе «dd.MM» — как в списке диалогов.</summary>
public sealed class ChatShortTimeConverter : IValueConverter
{
    public object Convert(object? value, Type targetType, object? parameter, CultureInfo culture)
    {
        if (value is not DateTimeOffset moment)
        {
            return string.Empty;
        }

        var local = moment.LocalDateTime;
        return local.Date == DateTime.Now.Date
            ? local.ToString("HH:mm", CultureInfo.InvariantCulture)
            : local.ToString("dd.MM", CultureInfo.InvariantCulture);
    }

    public object ConvertBack(object? value, Type targetType, object? parameter, CultureInfo culture) =>
        throw new NotSupportedException();
}

/// <summary>
/// Прилипшее к списку поведение прокрутки для чат-ленты (без code-behind):
/// Track — подписывает внутренний ScrollViewer и выставляет IsAwayFromEnd
/// (пользователь прокрутил вверх → показать FAB «вниз»); EndSignal — инкремент
/// из VM скроллит список в конец. MVVM сохраняется: команды живут на VM,
/// позиция прокрутки — чисто визуальное состояние.
/// </summary>
public static class ChatScrollAssist
{
    /// <summary>Запас прокрутки снизу в px, ниже которого лента «у конца».</summary>
    private const double NearEndThreshold = 40.0;

    public static readonly DependencyProperty TrackProperty =
        DependencyProperty.RegisterAttached(
            "Track",
            typeof(bool),
            typeof(ChatScrollAssist),
            new PropertyMetadata(false, OnTrackChanged));

    public static bool GetTrack(DependencyObject obj) => (bool)obj.GetValue(TrackProperty);

    public static void SetTrack(DependencyObject obj, bool value) => obj.SetValue(TrackProperty, value);

    /// <summary>Read-only с точки зрения разметки: «лента прокручена вверх».</summary>
    public static readonly DependencyProperty IsAwayFromEndProperty =
        DependencyProperty.RegisterAttached(
            "IsAwayFromEnd",
            typeof(bool),
            typeof(ChatScrollAssist),
            new PropertyMetadata(false));

    public static bool GetIsAwayFromEnd(DependencyObject obj) => (bool)obj.GetValue(IsAwayFromEndProperty);

    public static void SetIsAwayFromEnd(DependencyObject obj, bool value) =>
        obj.SetValue(IsAwayFromEndProperty, value);

    /// <summary>Изменение значения → прокрутка в конец списка.</summary>
    public static readonly DependencyProperty EndSignalProperty =
        DependencyProperty.RegisterAttached(
            "EndSignal",
            typeof(int),
            typeof(ChatScrollAssist),
            new PropertyMetadata(0, OnEndSignalChanged));

    public static int GetEndSignal(DependencyObject obj) => (int)obj.GetValue(EndSignalProperty);

    public static void SetEndSignal(DependencyObject obj, int value) => obj.SetValue(EndSignalProperty, value);

    private static void OnTrackChanged(DependencyObject sender, DependencyPropertyChangedEventArgs e)
    {
        if (sender is not FrameworkElement element || e.NewValue is not true)
        {
            return;
        }

        if (element.IsLoaded)
        {
            Hook(element);
        }
        else
        {
            element.Loaded += (_, _) => Hook(element);
        }
    }

    private static void OnEndSignalChanged(DependencyObject sender, DependencyPropertyChangedEventArgs e)
    {
        if (e.NewValue is not int signal || signal <= 0 || sender is not FrameworkElement element)
        {
            return;
        }

        if (element is System.Windows.Controls.ListBox listBox && listBox.Items.Count > 0)
        {
            listBox.ScrollIntoView(listBox.Items[listBox.Items.Count - 1]);
        }

        FindScrollViewer(element)?.ScrollToEnd();
    }

    private static void Hook(FrameworkElement element)
    {
        var scrollViewer = FindScrollViewer(element);
        if (scrollViewer is null)
        {
            // Шаблон списка ещё не развёрнут — повторим после layout-прохода.
            element.Loaded += (_, _) => Hook(element);
            return;
        }

        scrollViewer.ScrollChanged += (_, _) => UpdateAwayFromEnd(element, scrollViewer);
        scrollViewer.SizeChanged += (_, _) => UpdateAwayFromEnd(element, scrollViewer);

        UpdateAwayFromEnd(element, scrollViewer);
    }

    private static void UpdateAwayFromEnd(DependencyObject element, ScrollViewer scrollViewer) =>
        SetIsAwayFromEnd(
            element,
            scrollViewer.ScrollableHeight - scrollViewer.VerticalOffset > NearEndThreshold);

    private static ScrollViewer? FindScrollViewer(DependencyObject root)
    {
        if (root is ScrollViewer scrollViewer)
        {
            return scrollViewer;
        }

        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var index = 0; index < count; index++)
        {
            var found = FindScrollViewer(VisualTreeHelper.GetChild(root, index));
            if (found is not null)
            {
                return found;
            }
        }

        return null;
    }
}
