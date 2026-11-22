using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// LinkifiedTextBlock превращает http(s)-ссылки в тексте пузыря в кликабельные
/// Hyperlink'и с командой открытия — как тело сообщения в Telegram.
/// </summary>
public sealed class LinkifiedTextBlockTests
{
    [Fact]
    public void SplitsTextIntoRunsAndHyperlinks()
    {
        RunOnSta(() =>
        {
            var block = new Native.Views.LinkifiedTextBlock
            {
                LinkText = "Смотри https://example.com/path?q=1 и https://a.b/c — готово",
            };

            var inlines = block.Inlines.ToArray();
            var links = inlines.OfType<System.Windows.Documents.Hyperlink>().ToArray();
            var runs = inlines.OfType<System.Windows.Documents.Run>().ToArray();

            Assert.Equal(2, links.Length);
            Assert.Equal("https://example.com/path?q=1", ((System.Windows.Documents.Run)links[0].Inlines.First()).Text);
            Assert.Equal("https://a.b/c", ((System.Windows.Documents.Run)links[1].Inlines.First()).Text);
            Assert.Equal("Смотри ", runs[0].Text);
            Assert.Equal(" и ", runs[1].Text);
            Assert.Equal(" — готово", runs[2].Text);
        });
    }

    [Fact]
    public void ClickExecutesCommandWithUrl()
    {
        RunOnSta(() =>
        {
            string? opened = null;
            var block = new Native.Views.LinkifiedTextBlock
            {
                LinkText = "https://hub.test/x",
                LinkCommand = new Native.ViewModels.NativeRelayCommand(p => opened = p as string),
            };

            var link = Assert.Single(block.Inlines.OfType<System.Windows.Documents.Hyperlink>());
            link.RaiseEvent(new System.Windows.RoutedEventArgs(System.Windows.Documents.Hyperlink.ClickEvent));

            Assert.Equal("https://hub.test/x", opened);
        });
    }

    [Theory]
    [InlineData("https://example.technology/docs", "https://example.technology/docs")]
    [InlineData("https://example.org/docs.", "https://example.org/docs")]
    [InlineData("(https://example.org/docs)text", "https://example.org/docs")]
    [InlineData("[https://example.org/docs]", "https://example.org/docs")]
    [InlineData("(https://example.org/wiki/A_(B_(C))).", "https://example.org/wiki/A_(B_(C))")]
    public async Task BodyClickAndFirstPreviewUseTheSameUrl(string firstLinkText, string firstUrl)
    {
        const string secondUrl = "http://second.test/end";
        var body = $"Смотри {firstLinkText} и {secondUrl}";
        var api = new FakeHubApiClient
        {
            ChatConversations = new HubChatConversationList
            {
                Items = [new HubChatConversation { Id = "c1", Kind = "direct" }],
            },
            ChatMessages = new HubChatMessageList
            {
                Items = [new HubChatMessage { Id = "m1", ConversationId = "c1", Kind = "text", Body = body }],
            },
        };
        var opened = new List<string>();
        var model = new ChatViewModel(api, new FakeChatRealtime(), new FakeChatDraftStore())
        {
            LinkOpener = url =>
            {
                opened.Add(url);
                return Task.CompletedTask;
            },
        };
        await model.LoadAsync();
        model.SelectedConversation = Assert.Single(model.Conversations);
        var message = Assert.Single(model.Messages);

        RunOnSta(() =>
        {
            var block = new Native.Views.LinkifiedTextBlock
            {
                LinkText = message.BodyText,
                LinkCommand = message.OpenBodyLinkCommand,
            };
            var links = block.Inlines.OfType<System.Windows.Documents.Hyperlink>().ToArray();
            foreach (var link in links)
            {
                link.RaiseEvent(new System.Windows.RoutedEventArgs(System.Windows.Documents.Hyperlink.ClickEvent));
            }

            message.OpenBodyLinkCommand.Execute("file:///C:/not-a-web-link");
            Assert.Equal(new[] { firstUrl, secondUrl }, opened);
            Assert.Equal(new[] { firstUrl, secondUrl }, links
                .Select(link => Assert.IsType<System.Windows.Documents.Run>(Assert.Single(link.Inlines)).Text));
            Assert.Equal(body, string.Concat(block.Inlines.Select(inline =>
                Assert.IsType<System.Windows.Documents.Run>(inline is System.Windows.Documents.Hyperlink link
                    ? Assert.Single(link.Inlines)
                    : inline).Text)));
        });

        Assert.Equal(firstUrl, Assert.Single(api.LinkPreviewRequests));
        Assert.Equal(firstUrl, Assert.Single(message.LinkPreviewItems).Url);
    }

    [Theory]
    [InlineData("обычный текст без ссылок")]
    [InlineData("ftp://files.local/x, javascript:alert(1), www.example.org")]
    public void PlainTextProducesRunsWithoutLinks(string text)
    {
        RunOnSta(() =>
        {
            var block = new Native.Views.LinkifiedTextBlock { LinkText = text };
            Assert.Single(block.Inlines);
            Assert.IsType<System.Windows.Documents.Run>(block.Inlines.First());
            block.LinkText = null;
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
        Assert.True(completed.Wait(TimeSpan.FromSeconds(30)), "STA-поток не завершился.");
        if (captured is not null)
        {
            throw captured;
        }
    }
}
