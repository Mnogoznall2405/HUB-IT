using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeHelpViewModelTests
{
    // ---- Дерево разделов ----

    [Fact]
    public async Task LoadGroupsArticlesByCategoryLikeWeb()
    {
        // Веб: categories + articles?status=published&limit=300, группировка
        // на клиенте; пустые разделы скрыты, неизвестная категория — «Прочее».
        var api = new FakeHubApiClient
        {
            KbCategories =
            [
                new HubKbCategory { Id = "mail", Title = "Почта", Description = "Exchange", Order = 10 },
                new HubKbCategory { Id = "vpn", Title = "VPN", Order = 20 },
                new HubKbCategory { Id = "ad", Title = "AD", Order = 30 },
            ],
            KbArticlesPage = new HubKbArticleListPage
            {
                Total = 3,
                Items =
                [
                    Article("a1", "Настройка Outlook", category: "mail"),
                    Article("a2", "Подключение VPN", category: "vpn"),
                    Article("a3", "Заявление на доступ", category: "unknown-cat"),
                ],
            },
        };
        var model = new HelpViewModel(api);

        await model.LoadAsync();

        // Раздел AD без статей скрыт; «Прочее» — в конце.
        Assert.Equal(new[] { "cat:mail", "cat:vpn", "cat:__other__" },
            model.RootNodes.Select(node => node.Id));
        Assert.Equal("Почта", model.RootNodes[0].Title);
        Assert.Equal("1", model.RootNodes[0].BadgeText);
        Assert.Equal("Прочее", model.RootNodes[2].Title);
        Assert.Equal("Заявление на доступ", model.RootNodes[2].Children[0].Title);
        Assert.Equal("Статей: 3", model.ArticlesTotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);

        // Контракт загрузки — как у веба (опубликованные, limit=300).
        var query = Assert.Single(api.KbArticleQueries);
        Assert.Equal("published", query.Status);
        Assert.Equal(300, query.Limit);
        Assert.Null(query.Search);
        Assert.Equal(1, api.KbCategoriesCallCount);
    }

    [Fact]
    public async Task LoadSelectsFirstArticleAndBuildsMarkdownDetail()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage
            {
                Total = 1,
                Items = [Article("a1", "Не приходят письма", category: "mail")],
            },
            KbArticleDetailFactory = _ => Article(
                "a1",
                "Не приходят письма",
                category: "mail",
                articleType: "runbook",
                summary: "Письма не доходят до ящика.",
                tags: ["почта", "exchange"],
                owner: "Иван Петров",
                content: new HubKbContentBlock
                {
                    Overview = "Проверьте, что письма не попали в карантин.",
                    Symptoms = "Во входящих пусто.",
                    Checks = ["Проверить карантин", "Проверить квоту ящика"],
                    Commands = ["Get-MessageTrackingLog"],
                    ResolutionSteps = ["Открыть карантин", "Освободить письмо"],
                    RollbackSteps = ["Вернуть правило"],
                    Escalation = "Перевести на вторую линию.",
                    Faq = [new HubKbFaqItem { Question = "Когда ждать письмо?", Answer = "До 15 минут." }],
                },
                attachments:
                [
                    new HubKbAttachment { Id = "f1", FileName = "карантин.pdf", Size = 2048 },
                ]),
        };
        var model = new HelpViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Автовыбор первой статьи: раздел раскрыт, статья выбрана в дереве.
        var categoryNode = Assert.Single(model.RootNodes);
        Assert.True(categoryNode.IsExpanded);
        var articleNode = Assert.Single(categoryNode.Children);
        Assert.True(articleNode.IsSelected);
        Assert.Equal("a1", model.SelectedNode?.ArticleId);

        var detail = model.Detail!;
        Assert.Equal("Не приходят письма", detail.Title);
        Assert.Equal("Инструкция", detail.TypeText);
        Assert.Equal("Почта", detail.CategoryText);
        Assert.Equal("Иван Петров", detail.OwnerText);
        Assert.Equal("#почта #exchange", detail.TagsText);
        Assert.Contains("карантин.pdf (2 КБ)", detail.AttachmentsText);
        Assert.True(detail.HasBody);

        // Секции KbContentBlock собраны в markdown в порядке веб-диалога.
        var body = detail.BodyMarkdown;
        Assert.StartsWith("Письма не доходят до ящика.", body);
        Assert.Contains("## Описание\nПроверьте, что письма не попали в карантин.", body);
        Assert.Contains("## Симптомы", body);
        Assert.Contains("## Что проверить\n- Проверить карантин\n- Проверить квоту ящика", body);
        Assert.Contains("## Команды\n- `Get-MessageTrackingLog`", body);
        Assert.Contains("## Шаги решения\n1. Открыть карантин\n2. Освободить письмо", body);
        Assert.Contains("## Откат\n- Вернуть правило", body);
        Assert.Contains("## Эскалация\nПеревести на вторую линию.", body);
        Assert.Contains("## Вопросы и ответы\n**Когда ждать письмо?**\n\nДо 15 минут.", body);
        Assert.Contains("## Файлы\n- карантин.pdf (2 КБ)", body);
        Assert.Contains("a1", api.KbArticleDetailCalls);
    }

    [Fact]
    public async Task SelectingArticleNodeLoadsDetail()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage
            {
                Total = 2,
                Items =
                [
                    Article("a1", "Первая", category: "mail"),
                    Article("a2", "Вторая", category: "mail"),
                ],
            },
            KbArticleDetailFactory = id => Article(id, "Статья " + id, category: "mail",
                content: new HubKbContentBlock { Overview = "Текст " + id }),
        };
        var model = new HelpViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => model.Detail is not null);
        Assert.Equal("a1", model.Detail!.Id);

        model.SelectedNode = model.RootNodes[0].Children[1];
        await WaitFor(() => model.Detail?.Id == "a2");

        Assert.Equal("Статья a2", model.Detail.Title);
        Assert.Contains("Текст a2", model.Detail.BodyMarkdown);
    }

    // ---- Поиск ----

    [Fact]
    public async Task SearchQueriesServerAndOpensResult()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта"), Category("vpn", "VPN")],
            // Начальная выдача — полная (обе статьи в дереве), поиск сужает до a9.
            KbArticlesPageFactory = query => new HubKbArticleListPage
            {
                Total = string.IsNullOrEmpty(query.Search) ? 2 : 1,
                Items = string.IsNullOrEmpty(query.Search)
                    ?
                    [
                        Article("a1", "Настройка Outlook", category: "mail"),
                        Article("a9", "VPN-клиент", category: "vpn", summary: "Удалённый доступ"),
                    ]
                    : [Article("a9", "VPN-клиент", category: "vpn", summary: "Удалённый доступ")],
            },
            KbArticleDetailFactory = id => Article(id, "Статья " + id, category: "vpn"),
        };
        var model = new HelpViewModel(api) { DelayAsync = (_, _) => Task.CompletedTask };
        await model.LoadAsync();

        model.SearchText = "vpn";
        await WaitFor(() => model.SearchResults.Count == 1);

        Assert.True(model.IsSearchActive);
        Assert.False(model.IsSearchEmpty);
        var result = model.SearchResults[0];
        Assert.Equal("a9", result.ArticleId);
        Assert.Equal("VPN-клиент", result.Title);
        Assert.Equal("Удалённый доступ", result.SummaryText);
        Assert.Contains("VPN", result.MetaText);
        var lastQuery = api.KbArticleQueries[^1];
        Assert.Equal("vpn", lastQuery.Search);
        Assert.Equal("published", lastQuery.Status);
        Assert.Equal(50, lastQuery.Limit);

        // Статья из выдачи поиска попадает в дерево: ветка раскрыта и выбрана.
        model.SelectedSearchItem = result;
        await WaitFor(() => model.Detail?.Id == "a9");
        var vpnNode = model.RootNodes[1];
        Assert.True(vpnNode.IsExpanded);
        Assert.Equal("a9", model.SelectedNode?.ArticleId);
        Assert.Null(model.SelectedSearchItem);
    }

    [Fact]
    public async Task SearchResultOutsideTreeLoadsDetailById()
    {
        // Выдача поиска шире дерева (лимит): узла нет — деталь читается по id.
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPageFactory = query => new HubKbArticleListPage
            {
                Items = string.IsNullOrEmpty(query.Search)
                    ? [Article("a1", "Письма", category: "mail")]
                    : [Article("x1", "Далёкая статья", category: "mail")],
            },
            KbArticleDetailFactory = id => Article(id, "Далёкая статья", category: "mail"),
        };
        var model = new HelpViewModel(api) { DelayAsync = (_, _) => Task.CompletedTask };
        await model.LoadAsync();

        model.SearchText = "далёкая";
        await WaitFor(() => model.SearchResults.Count == 1);
        model.SelectedSearchItem = model.SearchResults[0];
        await WaitFor(() => model.Detail?.Id == "x1");

        Assert.Null(model.SelectedNode);
        Assert.Equal("Далёкая статья", model.Detail!.Title);
    }

    [Fact]
    public async Task SearchBelowMinLengthKeepsTreeWithoutCalls()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage { Items = [Article("a1", "A", "mail")] },
        };
        var model = new HelpViewModel(api) { DelayAsync = (_, _) => Task.CompletedTask };
        await model.LoadAsync();
        var callsBefore = api.KbArticleQueries.Count;

        model.SearchText = "v";
        await Task.Delay(50);

        Assert.False(model.IsSearchActive);
        Assert.Equal(callsBefore, api.KbArticleQueries.Count);
        Assert.Empty(model.SearchResults);
    }

    // ---- Ошибки ----

    [Fact]
    public async Task LoadFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            KbCategoriesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new HelpViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task DetailFailureShowsDetailErrorKeepsTree()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage { Items = [Article("a1", "A", "mail")] },
            KbArticleDetailException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new HelpViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => model.HasDetailError && !model.IsDetailLoading);

        Assert.NotEmpty(model.RootNodes);
        Assert.Null(model.Detail);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Contains("соединения", model.DetailErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task EmptyBaseShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage { Items = [] },
        };
        var model = new HelpViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Empty(model.RootNodes);
        Assert.Equal(string.Empty, model.ArticlesTotalText);
        Assert.True(model.ShowDetailPlaceholder);
    }

    // ---- Служебное ----

    /// <summary>DataTemplate ленивый: XAML (TreeView, конвертеры) — прямой рендер на STA.</summary>
    [Fact]
    public void HelpViewRendersLoadedStateOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var api = new FakeHubApiClient
                {
                    KbCategories = [Category("mail", "Почта")],
                    KbArticlesPage = new HubKbArticleListPage
                    {
                        Items = [Article("a1", "Не приходят письма", category: "mail")],
                    },
                    KbArticleDetailFactory = _ => Article(
                        "a1", "Не приходят письма", category: "mail",
                        content: new HubKbContentBlock
                        {
                            Overview = "Проверьте карантин.",
                            ResolutionSteps = ["Шаг один", "Шаг два"],
                        }),
                };
                var model = new HelpViewModel(api);
                model.LoadAsync().GetAwaiter().GetResult();
                while (model.Detail is null)
                {
                    Thread.Sleep(10);
                }

                var window = new System.Windows.Window
                {
                    Width = 1280,
                    Height = 800,
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -30000,
                    Top = -30000,
                    ShowInTaskbar = false,
                    Content = new Native.Views.HelpView { DataContext = model },
                };
                window.Show();
                window.UpdateLayout();
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

        Assert.True(completed.Wait(TimeSpan.FromSeconds(15)));
        thread.Join(TimeSpan.FromSeconds(1));
        Assert.Null(captured);
    }

    [Fact]
    public async Task ResetClearsStateAndCancelsPendingSearch()
    {
        var api = new FakeHubApiClient
        {
            KbCategories = [Category("mail", "Почта")],
            KbArticlesPage = new HubKbArticleListPage { Items = [Article("a1", "A", "mail")] },
            KbArticleDetailFactory = id => Article(id, "Статья " + id, category: "mail"),
        };
        var gate = new TaskCompletionSource();
        var model = new HelpViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        await WaitFor(() => model.Detail is not null);

        model.SearchText = "почта";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.RootNodes);
        Assert.Null(model.SelectedNode);
        Assert.Null(model.Detail);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Empty(model.SearchResults);
        Assert.False(model.IsSearchActive);
        Assert.False(model.IsSearching);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.Equal(string.Empty, model.ArticlesTotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.True(model.IsEmpty);
        // Отменённый поиск не вернул запрос на сервер.
        Assert.Single(api.KbArticleQueries);
    }

    private static async Task WaitFor(Func<bool> condition)
    {
        for (var attempt = 0; attempt < 100; attempt++)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }

    private static HubKbCategory Category(string id, string title) =>
        new() { Id = id, Title = title };

    private static HubKbArticle Article(
        string id,
        string title,
        string category,
        string articleType = "runbook",
        string? summary = null,
        IReadOnlyList<string>? tags = null,
        string? owner = null,
        HubKbContentBlock? content = null,
        IReadOnlyList<HubKbAttachment>? attachments = null) =>
        new()
        {
            Id = id,
            Title = title,
            Category = category,
            ArticleType = articleType,
            Status = "published",
            Summary = summary ?? string.Empty,
            Tags = tags,
            OwnerName = owner,
            UpdatedAt = new DateTimeOffset(2026, 3, 10, 12, 0, 0, TimeSpan.Zero),
            Content = content,
            Attachments = attachments,
        };
}
