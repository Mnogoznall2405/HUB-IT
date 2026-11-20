using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using FontFamily = System.Windows.Media.FontFamily;

namespace Hub.Desktop.Native.Views;

/// <summary>
/// TextBlock с примитивным рендерингом Markdown: заголовки #/##/###, списки «- », **bold**, *italic*, `code`.
/// Подмножество достаточное для тел объявлений; не поддерживает ссылки и вложенные блоки.
/// </summary>
public sealed class MarkdownTextBlock : TextBlock
{
    public static readonly DependencyProperty MarkdownTextProperty =
        DependencyProperty.Register(
            nameof(MarkdownText),
            typeof(string),
            typeof(MarkdownTextBlock),
            new FrameworkPropertyMetadata(null, OnMarkdownChanged));

    private static readonly Regex HeadingRe = new(@"^(#{1,3})\s+(.*)$", RegexOptions.Compiled);
    private static readonly Regex BulletRe = new(@"^[-*]\s+(.*)$", RegexOptions.Compiled);
    private static readonly Regex OrderedRe = new(@"^\d+[.)]\s+(.*)$", RegexOptions.Compiled);
    private static readonly Regex InlineRe = new(@"(\*\*.+?\*\*|__.+?__|\*[^*]+?\*|`[^`]+?`)", RegexOptions.Compiled);

    public string? MarkdownText
    {
        get => (string?)GetValue(MarkdownTextProperty);
        set => SetValue(MarkdownTextProperty, value);
    }

    private static void OnMarkdownChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
    {
        var block = (MarkdownTextBlock)d;
        block.Inlines.Clear();
        block.Build(e.NewValue as string);
    }

    private void Build(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        var inlines = Inlines;
        var paragraph = new List<string>();
        var firstBlock = true;

        void StartBlock()
        {
            if (!firstBlock)
            {
                inlines.Add(new LineBreak());
                inlines.Add(new LineBreak());
            }

            firstBlock = false;
        }

        void FlushParagraph()
        {
            if (paragraph.Count == 0)
            {
                return;
            }

            StartBlock();
            AddFormatted(inlines, string.Join(" ", paragraph));
            paragraph.Clear();
        }

        foreach (var raw in text.Replace("\r\n", "\n").Split('\n'))
        {
            var line = raw.TrimEnd();
            if (line.Length == 0)
            {
                FlushParagraph();
                continue;
            }

            var match = HeadingRe.Match(line);
            if (match.Success)
            {
                FlushParagraph();
                StartBlock();
                var level = match.Groups[1].Value.Length;
                inlines.Add(new Run(match.Groups[2].Value.Trim())
                {
                    FontWeight = FontWeights.SemiBold,
                    FontSize = FontSize + (4 - level) * 1.5,
                });
                continue;
            }

            match = BulletRe.Match(line);
            if (match.Success)
            {
                FlushParagraph();
                StartBlock();
                // SetResourceReference (не TryFindResource): маркер следует за
                // подменой палитры при смене темы — статическая кисть залипла бы.
                var bullet = new Run("•  ");
                bullet.SetResourceReference(TextElement.ForegroundProperty, "HubAccentBrush");
                inlines.Add(bullet);
                AddFormatted(inlines, match.Groups[1].Value.Trim());
                continue;
            }

            match = OrderedRe.Match(line);
            if (match.Success)
            {
                FlushParagraph();
                StartBlock();
                var marker = line[..(line.Length - match.Groups[1].Value.Length)];
                inlines.Add(new Run(marker));
                AddFormatted(inlines, match.Groups[1].Value.Trim());
                continue;
            }

            paragraph.Add(line.Trim());
        }

        FlushParagraph();
    }

    private static void AddFormatted(InlineCollection inlines, string text)
    {
        var pos = 0;
        foreach (Match match in InlineRe.Matches(text))
        {
            if (match.Index > pos)
            {
                inlines.Add(new Run(text[pos..match.Index]));
            }

            var token = match.Value;
            if (token.StartsWith("**") || token.StartsWith("__"))
            {
                inlines.Add(new Run(token[2..^2]) { FontWeight = FontWeights.SemiBold });
            }
            else if (token.StartsWith('`'))
            {
                inlines.Add(new Run(token[1..^1]) { FontFamily = new FontFamily("Consolas") });
            }
            else
            {
                inlines.Add(new Run(token[1..^1]) { FontStyle = FontStyles.Italic });
            }

            pos = match.Index + match.Length;
        }

        if (pos < text.Length)
        {
            inlines.Add(new Run(text[pos..]));
        }
    }
}
