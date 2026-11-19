using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>Страница «Новости»: загрузка списка, фильтры, чтение детали, ack, сброс.</summary>
public sealed class NativeNewsViewModelTests
{
    [Fact]
    public async Task LoadPopulatesListItemsWithMappedFields()
    {
        var published = new DateTimeOffset(2026, 2, 10, 14, 30, 0, TimeSpan.FromHours(3));
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = new HubAnnouncementListPage
            {
                Total = 7,
                UnreadTotal = 1,
                AckPendingTotal = 1,
                Items =
                [
                    new HubAnnouncementItem
                    {
                        Id = "n1",
                        Title = "Плановые работы",
                        Preview = "В субботу обновление портала",
                        Priority = "high",
                        PublishedAt = published,
                        UpdatedAt = published.AddHours(2),
                        AuthorFullName = "Иван Иванов",
                        IsUnread = true,
                        IsUpdated = true,
                        IsAckPending = true,
                        IsPinnedActive = true,
                        CommentsCount = 2,
                        AttachmentsCount = 3,
                        Category = new HubAnnouncementCategory { Name = "Инфраструктура" },
                    },
                ],
            },
        };
        var model = new NewsViewModel(api);

        await model.LoadAsync();

        var item = Assert.Single(model.Items);
        Assert.Equal("n1", item.Id);
        Assert.Equal("Плановые работы", item.Title);
        Assert.Equal("В субботу обновление портала", item.Preview);
        Assert.Equal(published.ToLocalTime().ToString("dd.MM.yyyy HH:mm"), item.DateText);
        Assert.Equal("Инфраструктура", item.CategoryText);
        Assert.Equal("Иван Иванов", item.AuthorText);
        Assert.True(item.IsUnread);
        Assert.True(item.IsAckPending);
        Assert.Equal("Требует подтверждения", item.AckPendingText);
        Assert.True(item.IsHighPriority);
        Assert.Equal("Важно", item.PriorityText);
        Assert.Equal("📌", item.PinnedMarker);
        Assert.Equal("Обновлено", item.UpdatedBadgeText);
        Assert.Equal("📎 3", item.AttachmentsText);
        Assert.Equal("💬 2", item.CommentsText);
        Assert.Equal("7", model.TotalText);
        Assert.Equal("1", model.UnreadText);
        Assert.Equal("1", model.AckPendingText);
        Assert.Equal(30, api.LastAnnouncementsQuery?.Limit);
        Assert.False(api.LastAnnouncementsQuery?.UnreadOnly ?? true);
        Assert.Equal("published_at", api.LastAnnouncementsQuery?.SortBy);
        Assert.Equal("desc", api.LastAnnouncementsQuery?.SortDir);
    }

    [Fact]
    public async Task UnreadFilterMapsToUnreadOnlyQuery()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("unread");

        Assert.True(model.IsFilterUnread);
        Assert.False(model.IsFilterAll);
        Assert.True(api.LastAnnouncementsQuery?.UnreadOnly);
    }

    [Fact]
    public async Task SearchTextMapsToQuerySearch()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api) { SearchText = "  обновление  " };

        await model.LoadAsync();

        Assert.Equal("обновление", api.LastAnnouncementsQuery?.Search);
    }

    [Fact]
    public async Task EmptySearchMapsToNullQuery()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api) { SearchText = "   " };

        await model.LoadAsync();

        Assert.Null(api.LastAnnouncementsQuery?.Search);
    }

    [Fact]
    public async Task SelectingItemLoadsDetailAndMarksRead()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n7", isUnread: true)),
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "n7",
                Title = "Релиз портала",
                Body = "Полный текст объявления",
                AuthorFullName = "Пётр Петров",
                PublishedAt = DateTimeOffset.UtcNow,
            },
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() =>
            model.Detail is not null && !model.IsDetailLoading && api.ReadMarkedIds.Count > 0);

        Assert.NotNull(model.Detail);
        Assert.Equal("Релиз портала", model.Detail!.Title);
        Assert.Equal("Полный текст объявления", model.Detail.Body);
        Assert.True(model.Detail.HasBody);
        Assert.Equal("n7", api.LastAnnouncementId);
        Assert.Contains("n7", api.ReadMarkedIds);
        Assert.False(model.Items[0].IsUnread);
    }

    [Fact]
    public async Task MarkReadFailureDoesNotBreakSelection()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n3", isUnread: true)),
            MarkReadException = new InvalidOperationException("no endpoint"),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Ошибка mark-as-read глотается: деталь показана, локальный флаг всё равно снят.
        Assert.False(model.Items[0].IsUnread);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task AckConfirmsAnnouncementAndUpdatesFlags()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n9", isAckPending: true)),
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "n9",
                Title = "Обязательная к прочтению",
                Body = "Текст",
                RequiresAck = true,
                IsAckPending = true,
            },
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.True(model.Detail!.IsAckPending);
        Assert.True(model.Detail.CanAck);
        Assert.Equal("Подтвердить прочтение", model.Detail.AckButtonText);

        await ((NativeAsyncCommand)model.AckCommand).ExecuteAsync(null);

        Assert.Contains("n9", api.AckedIds);
        Assert.False(model.Detail.IsAckPending);
        Assert.False(model.Detail.CanAck);
        Assert.True(model.Detail.ShowAckDone);
        Assert.False(model.Items[0].IsAckPending);
        Assert.Equal(string.Empty, model.Items[0].AckPendingText);
    }

    [Fact]
    public async Task AckFailureKeepsPendingStateAndShowsDetailError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n9", isAckPending: true)),
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "n9",
                Title = "Обязательная",
                RequiresAck = true,
                IsAckPending = true,
            },
            AckException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        await ((NativeAsyncCommand)model.AckCommand).ExecuteAsync(null);

        Assert.True(model.Detail!.IsAckPending);
        Assert.True(model.Items[0].IsAckPending);
        Assert.True(model.HasDetailError);
        Assert.False(model.Detail.IsAckBusy);
    }

    [Fact]
    public async Task LoadFailureSetsBannerError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsLoading);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task DetailLoadFailureSetsDetailError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetailException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => !model.IsDetailLoading);

        Assert.Null(model.Detail);
        Assert.True(model.HasDetailError);
        Assert.True(model.ShowDetailEmpty);
    }

    [Fact]
    public void SetLoadErrorSetsBanner()
    {
        var model = new NewsViewModel(new FakeHubApiClient());

        model.SetLoadError("Сессия истекла. Войдите заново.");

        Assert.True(model.HasBannerError);
        Assert.Equal("Сессия истекла. Войдите заново.", model.BannerErrorText);
        Assert.False(model.IsLoading);
    }

    [Fact]
    public async Task ResetClearsAllState()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1", isUnread: true)),
        };
        var model = new NewsViewModel(api)
        {
            SearchText = "поиск",
            Filter = "unread",
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null);

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Null(model.Detail);
        Assert.Null(model.SelectedItem);
        Assert.False(model.HasDetail);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal("all", model.Filter);
        Assert.True(model.IsFilterAll);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.False(model.IsLoading);
        Assert.False(model.IsDetailLoading);
        Assert.Equal(string.Empty, model.TotalText);
    }

    [Fact]
    public async Task NewsViewRendersAllStatesOnStaThread()
    {
        // Парсинг XAML, merge HubTheme и шаблоны списка/детали инстанцируются
        // при показе — smoke-тест ловит битые ресурсы и стили.
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(
                MakeItem("n1", isUnread: true, isAckPending: true) with
                {
                    Priority = "high",
                    IsPinnedActive = true,
                    AttachmentsCount = 1,
                    CommentsCount = 2,
                }),
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "n1",
                Title = "Новость",
                Body = "Текст",
                RequiresAck = true,
                IsAckPending = true,
            },
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var window = new System.Windows.Window
                {
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -10000,
                    Top = -10000,
                    Content = new Native.Views.NewsView { DataContext = model },
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
    public async Task SelectNewsByIdResetsFiltersAndSelectsItem()
    {
        // Переход «новость с главной»: фильтр/поиск сбрасываются,
        // список перечитывается, нужная новость выбирается и грузит деталь.
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(
                MakeItem("n1"),
                MakeItem("n42", title: "Целевая новость")),
            AnnouncementDetail = new HubAnnouncementItem { Id = "n42", Title = "Целевая новость", Body = "Текст" },
        };
        var model = new NewsViewModel(api)
        {
            Filter = "unread",
            SearchText = "старое",
        };

        await model.SelectNewsByIdAsync("n42");

        Assert.Equal("all", model.Filter);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.False(api.LastAnnouncementsQuery?.UnreadOnly ?? true);
        Assert.Null(api.LastAnnouncementsQuery?.Search);
        Assert.NotNull(model.SelectedItem);
        Assert.Equal("n42", model.SelectedItem!.Id);

        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        Assert.Equal("Целевая новость", model.Detail!.Title);
    }

    [Fact]
    public async Task SelectNewsByIdUsesAlreadyLoadedItemWithoutReload()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n5")),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        var loadedQuery = api.LastAnnouncementsQuery;

        await model.SelectNewsByIdAsync("n5");

        Assert.Same(loadedQuery, api.LastAnnouncementsQuery);
        Assert.Equal("n5", model.SelectedItem?.Id);
    }

    [Fact]
    public async Task LoadMoreAppendsNextPageUntilExhausted()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPageFactory = query => new HubAnnouncementListPage
            {
                Total = 3,
                Items = query.Offset == 0
                    ? [MakeItem("n1"), MakeItem("n2")]
                    : [MakeItem("n3")],
            },
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        Assert.Equal(2, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (1)", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal(2, api.LastAnnouncementsQuery?.Offset);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task LoadMoreFailureKeepsLoadedItems()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPageFactory = query => query.Offset == 0
                ? new HubAnnouncementListPage { Total = 3, Items = [MakeItem("n1")] }
                : throw new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Single(model.Items);
        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SelectNewsByIdLoadsExtraPagesUntilFound()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPageFactory = query => new HubAnnouncementListPage
            {
                Total = 3,
                Items = query.Offset == 0
                    ? [MakeItem("n1"), MakeItem("n2")]
                    : [MakeItem("n3", title: "Глубокая")],
            },
            AnnouncementDetail = MakeItem("n3", title: "Глубокая"),
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        Assert.DoesNotContain(model.Items, i => i.Id == "n3");

        await model.SelectNewsByIdAsync("n3");

        Assert.Equal("n3", model.SelectedItem?.Id);
        Assert.Equal(3, model.Items.Count);
    }

    [Fact]
    public async Task SortPriorityMapsToQuerySortParams()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("priority_desc");

        Assert.Equal("priority_desc", model.Sort);
        Assert.Equal("priority", api.LastAnnouncementsQuery?.SortBy);
        Assert.Equal("desc", api.LastAnnouncementsQuery?.SortDir);
        Assert.True(model.IsSortPriority);
        Assert.False(model.IsSortNewest);
        Assert.False(model.IsSortOldest);
        Assert.False(model.IsSortUpdated);
    }

    [Fact]
    public async Task SortOldestMapsToPublishedAsc()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("published_asc");

        Assert.Equal("published_at", api.LastAnnouncementsQuery?.SortBy);
        Assert.Equal("asc", api.LastAnnouncementsQuery?.SortDir);
        Assert.True(model.IsSortOldest);
    }

    [Fact]
    public async Task SortUpdatedMapsToUpdatedDesc()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("updated_desc");

        Assert.Equal("updated_at", api.LastAnnouncementsQuery?.SortBy);
        Assert.Equal("desc", api.LastAnnouncementsQuery?.SortDir);
        Assert.True(model.IsSortUpdated);
    }

    [Fact]
    public async Task UnknownSortParameterFallsBackToNewest()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("bogus");

        // Невалидный ключ не уходит на сервер: запрос собирается по умолчанию.
        Assert.Equal("published_at", api.LastAnnouncementsQuery?.SortBy);
        Assert.Equal("desc", api.LastAnnouncementsQuery?.SortDir);
    }

    [Fact]
    public async Task SortChangeReloadsFromFirstPage()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPageFactory = query => new HubAnnouncementListPage
            {
                Total = 3,
                Items = query.Offset == 0
                    ? [MakeItem("n1"), MakeItem("n2")]
                    : [MakeItem("n3")],
            },
        };
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);
        Assert.Equal(3, model.Items.Count);

        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("priority_desc");

        // Новая сортировка перечитывает список с нуля, а не догружает страницу.
        Assert.Equal(0, api.LastAnnouncementsQuery?.Offset);
        Assert.Equal(2, model.Items.Count);
        Assert.Equal("priority", api.LastAnnouncementsQuery?.SortBy);
    }

    [Fact]
    public async Task SortChipSetterSelectsSortThroughCommand()
    {
        // Write-back от UIA (SelectionItemPattern): сеттер IsSort* идёт через SelectSortCommand.
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        model.IsSortUpdated = true;
        await WaitFor(() => api.LastAnnouncementsQuery?.SortBy == "updated_at");

        Assert.Equal("desc", api.LastAnnouncementsQuery?.SortDir);
        Assert.True(model.IsSortUpdated);
    }

    [Fact]
    public async Task SortChipSetterUncheckedDoesNotReload()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        var loadedQuery = api.LastAnnouncementsQuery;

        model.IsSortNewest = false;

        Assert.Same(loadedQuery, api.LastAnnouncementsQuery);
    }

    [Fact]
    public async Task ResetRestoresDefaultSort()
    {
        var model = new NewsViewModel(new FakeHubApiClient());
        await ((NativeAsyncCommand)model.SelectSortCommand).ExecuteAsync("priority_desc");
        Assert.True(model.IsSortPriority);

        model.Reset();

        Assert.Equal("published_desc", model.Sort);
        Assert.True(model.IsSortNewest);
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

    private static HubAnnouncementItem MakeItem(
        string id,
        string title = "Новость",
        bool isUnread = false,
        bool isAckPending = false) =>
        new()
        {
            Id = id,
            Title = title,
            Preview = "Краткий анонс",
            PublishedAt = DateTimeOffset.UtcNow,
            IsUnread = isUnread,
            IsAckPending = isAckPending,
        };

    private static HubAnnouncementListPage PageOf(params HubAnnouncementItem[] items) =>
        new() { Items = items, Total = items.Length };
}
