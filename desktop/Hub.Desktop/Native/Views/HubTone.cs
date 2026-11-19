using System.Windows;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// Наследуемое attached-свойство «тон статуса» (значения — HubStatusTone.*).
/// Вью ставит тон на пилюлю/полосу/точку/текст: local:HubTone.Value="{Binding StatusTone}"
/// или литералом local:HubTone.Value="danger"; общие стили HubTone* в HubTheme.xaml
/// красят элемент триггерами на палитровые кисти. Значение наследуется вниз
/// по дереву — текст внутри пилюли подхватывает тон рамки без повторного биндинга.
/// </summary>
public static class HubTone
{
    public static readonly DependencyProperty ValueProperty =
        DependencyProperty.RegisterAttached(
            "Value",
            typeof(string),
            typeof(HubTone),
            new FrameworkPropertyMetadata(
                defaultValue: null,
                FrameworkPropertyMetadataOptions.Inherits));

    public static void SetValue(DependencyObject element, string? value) =>
        element.SetValue(ValueProperty, value);

    public static string? GetValue(DependencyObject element) =>
        (string?)element.GetValue(ValueProperty);
}
