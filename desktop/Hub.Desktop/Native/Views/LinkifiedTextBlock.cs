using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using Hub.Desktop.Native.ViewModels;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// TextBlock с кликабельными http(s)-ссылками — как тело сообщения в Telegram:
/// ссылка цветом акцента без подчёркивания, клик — команда с url параметром.
/// Разбиение на ссылки тем же regex, что и карточка превью (единый источник).
/// </summary>
public sealed class LinkifiedTextBlock : TextBlock
{
    public static readonly DependencyProperty LinkTextProperty =
        DependencyProperty.Register(
            nameof(LinkText),
            typeof(string),
            typeof(LinkifiedTextBlock),
            new FrameworkPropertyMetadata(null, OnContentChanged));

    public static readonly DependencyProperty LinkCommandProperty =
        DependencyProperty.Register(
            nameof(LinkCommand),
            typeof(ICommand),
            typeof(LinkifiedTextBlock),
            new FrameworkPropertyMetadata(null));

    /// <summary>
    /// Ключ ресурса-кисти для цвета ссылок (по умолчанию HubChatLinkBrush;
    /// в исходящих пузырях стиль подставляет HubChatOutLinkBrush). Через ключ,
    /// а не через Brush-DP — SetResourceReference сам следит за сменой темы.
    /// </summary>
    public static readonly DependencyProperty LinkResourceKeyProperty =
        DependencyProperty.Register(
            nameof(LinkResourceKey),
            typeof(string),
            typeof(LinkifiedTextBlock),
            new FrameworkPropertyMetadata("HubChatLinkBrush", OnContentChanged));

    public string? LinkText
    {
        get => (string?)GetValue(LinkTextProperty);
        set => SetValue(LinkTextProperty, value);
    }

    public ICommand? LinkCommand
    {
        get => (ICommand?)GetValue(LinkCommandProperty);
        set => SetValue(LinkCommandProperty, value);
    }

    public static readonly DependencyProperty TrailingContentProperty =
        DependencyProperty.Register(
            nameof(TrailingContent),
            typeof(UIElement),
            typeof(LinkifiedTextBlock),
            new FrameworkPropertyMetadata(null, OnContentChanged));

    public string LinkResourceKey
    {
        get => (string)GetValue(LinkResourceKeyProperty);
        set => SetValue(LinkResourceKeyProperty, value);
    }

    /// <summary>
    /// Элемент, встраиваемый инлайн в конец текста (UI-023): время/«изм.»/галочки
    /// сообщения встают в конец последней строки; не помещается — переносится
    /// ниже сам. InlineUIContainer даёт это поведение бесплатно.
    /// </summary>
    public UIElement? TrailingContent
    {
        get => (UIElement?)GetValue(TrailingContentProperty);
        set => SetValue(TrailingContentProperty, value);
    }

    private static void OnContentChanged(DependencyObject d, DependencyPropertyChangedEventArgs e) =>
        ((LinkifiedTextBlock)d).Rebuild();

    // Один контейнер на время жизни контрола: Inlines.Clear() снимает контейнер
    // с текста, но его Child остаётся его логическим ребёнком — новый контейнер
    // на том же элементе кидал бы «already a logical child».
    private InlineUIContainer? _trailingContainer;

    private void Rebuild()
    {
        Inlines.Clear();
        var text = LinkText;
        if (string.IsNullOrEmpty(text))
        {
            return;
        }

        var position = 0;
        foreach (var (index, url) in ChatMessageViewModel.MatchChatUrls(text))
        {
            if (index > position)
            {
                Inlines.Add(new Run(text[position..index]));
            }

            var link = new Hyperlink(new Run(url)) { TextDecorations = null };
            link.SetResourceReference(ForegroundProperty, LinkResourceKey);
            link.Click += (_, _) => LinkCommand?.Execute(url);
            Inlines.Add(link);
            position = index + url.Length;
        }

        if (position < text.Length)
        {
            Inlines.Add(new Run(text[position..]));
        }

        if (TrailingContent is { } trailing)
        {
            _trailingContainer ??= new InlineUIContainer { BaselineAlignment = BaselineAlignment.Bottom };
            if (!ReferenceEquals(_trailingContainer.Child, trailing))
            {
                _trailingContainer.Child = trailing;
            }

            Inlines.Add(_trailingContainer);
        }
    }
}
