using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// MarkdownTextBlock преобразует разметку тел объявлений в структурированный текст:
/// заголовки крупнее и полужирные, списки с маркерами, **bold** внутри строки.
/// </summary>
public sealed class MarkdownTextBlockTests
{
    [Fact]
    public void RendersHeadingsBulletsAndBoldRuns()
    {
        RunOnSta(() =>
        {
            var block = new Native.Views.MarkdownTextBlock
            {
                MarkdownText = "### Раздел\n\n- Первый **важный** пункт\nОбычный текст и `код`",
            };

            var runs = block.Inlines.OfType<System.Windows.Documents.Run>().ToArray();
            var heading = Array.Find(runs, r => r.Text == "Раздел");
            Assert.NotNull(heading);
            Assert.Equal(System.Windows.FontWeights.SemiBold, heading.FontWeight);
            Assert.True(heading.FontSize > block.FontSize);

            Assert.Contains(runs, r => r.Text.Contains('•'));
            var bold = Array.Find(runs, r => r.Text == "важный");
            Assert.NotNull(bold);
            Assert.Equal(System.Windows.FontWeights.SemiBold, bold.FontWeight);
            Assert.Contains(runs, r => r.Text == "код" && r.FontFamily.Source == "Consolas");
        });
    }

    [Fact]
    public void EmptyAndNullTextProduceNoInlines()
    {
        RunOnSta(() =>
        {
            var block = new Native.Views.MarkdownTextBlock { MarkdownText = null };
            Assert.Empty(block.Inlines);
            block.MarkdownText = "   ";
            Assert.Empty(block.Inlines);
        });
    }

    private static void RunOnSta(Action action)
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                action();
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
        Assert.True(completed.Wait(TimeSpan.FromSeconds(15)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }
}
