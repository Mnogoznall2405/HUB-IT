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

    // ---- Вовлечение: реакции/лайк/закладка ----

    [Fact]
    public async Task BookmarkFilterMapsToBookmarkedOnlyQuery()
    {
        var api = new FakeHubApiClient();
        var model = new NewsViewModel(api);

        await ((NativeAsyncCommand)model.SelectFilterCommand).ExecuteAsync("bookmarks");

        Assert.True(model.IsFilterBookmarks);
        Assert.False(model.IsFilterAll);
        Assert.True(api.LastAnnouncementsQuery?.BookmarkedOnly);
        Assert.False(api.LastAnnouncementsQuery?.UnreadOnly ?? true);
    }

    [Fact]
    public async Task PickReactionAppliesChoiceAndRecordsCall()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.PickReactionCommand).ExecuteAsync("wow");

        Assert.Equal(("n1", "wow"), Assert.Single(api.AnnouncementReactionCalls));
        Assert.Equal("wow", model.Detail!.ViewerReaction);
        Assert.Equal(1, model.Detail.ReactionsCount);
        var chip = Assert.Single(model.Detail.ReactionChips);
        Assert.True(chip.IsMine);
        Assert.False(model.Detail.IsSocialBusy);
    }

    [Fact]
    public async Task ToggleOwnReactionChipClearsReaction()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                reactionCounts: new Dictionary<string, int> { ["wow"] = 1 },
                viewerReaction: "wow"),
        };
        var model = await LoadDetailAsync(api);
        var chip = Assert.Single(model.Detail!.ReactionChips);
        Assert.True(chip.IsMine);

        await ((NativeAsyncCommand)model.ToggleReactionCommand).ExecuteAsync(chip);

        // Повторный клик по своей реакции — DELETE (null в записи фейка).
        Assert.Equal(("n1", (string?)null), Assert.Single(api.AnnouncementReactionCalls));
        Assert.Null(model.Detail.ViewerReaction);
        Assert.Empty(model.Detail.ReactionChips);
    }

    [Fact]
    public async Task ReactionFailureRollsBackOptimisticState()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                reactionCounts: new Dictionary<string, int> { ["like"] = 2 }),
            AnnouncementReactionException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.PickReactionCommand).ExecuteAsync("wow");

        // Откат: своя реакция пуста, чужие счётчики сохранены, ошибка локальная.
        Assert.Null(model.Detail!.ViewerReaction);
        var chip = Assert.Single(model.Detail.ReactionChips);
        Assert.Equal("like", chip.ReactionType);
        Assert.Equal(2, chip.Count);
        Assert.False(chip.IsMine);
        Assert.True(model.HasDetailError);
        Assert.False(model.Detail.IsSocialBusy);
    }

    [Fact]
    public async Task ToggleLikeCallsApiAndUpdatesCount()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.ToggleLikeCommand).ExecuteAsync(null);

        Assert.Equal(("n1", true), Assert.Single(api.AnnouncementLikeCalls));
        Assert.True(model.Detail!.IsLiked);
        Assert.Equal(1, model.Detail.LikesCount);
        Assert.Equal("❤️ 1", model.Detail.LikeText);
    }

    [Fact]
    public async Task LikeFailureRollsBackOptimisticState()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1"),
            AnnouncementLikeException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.ToggleLikeCommand).ExecuteAsync(null);

        Assert.False(model.Detail!.IsLiked);
        Assert.Equal(0, model.Detail.LikesCount);
        Assert.True(model.HasDetailError);
    }

    [Fact]
    public async Task ToggleBookmarkUpdatesDetailAndListMarker()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.ToggleBookmarkCommand).ExecuteAsync(null);

        Assert.Equal(("n1", true), Assert.Single(api.AnnouncementBookmarkCalls));
        Assert.True(model.Detail!.IsBookmarked);
        Assert.Equal("🔖", model.Items[0].BookmarkedMarker);
    }

    [Fact]
    public async Task BookmarkFailureRollsBack()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", viewerBookmarked: true),
            AnnouncementBookmarkException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.ToggleBookmarkCommand).ExecuteAsync(null);

        Assert.True(model.Detail!.IsBookmarked);
        Assert.Equal("🔖", model.Items[0].BookmarkedMarker);
        Assert.True(model.HasDetailError);
    }

    // ---- Опрос ----

    [Fact]
    public async Task VotePollOptionAppliesServerResult()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                poll: new HubAnnouncementPoll
                {
                    Id = "p1",
                    Question = "Когда работы?",
                    IsAnonymous = true,
                    TotalVotes = 4,
                    TotalVoters = 4,
                    Options =
                    [
                        new HubAnnouncementPollOption { Id = "o1", Text = "Суббота", VotesCount = 3 },
                        new HubAnnouncementPollOption { Id = "o2", Text = "Воскресенье", VotesCount = 1 },
                    ],
                }),
        };
        var model = await LoadDetailAsync(api);
        Assert.True(model.Detail!.HasPoll);
        Assert.False(model.Detail.ShowPollResults);
        var option = model.Detail.PollOptions[1];
        Assert.True(option.ShowVoteButton);

        await ((NativeAsyncCommand)model.VotePollOptionCommand).ExecuteAsync(option);

        // Фейк пересчитывает poll по голосу: свой вариант отмечен, результаты видны.
        Assert.True(model.Detail.PollHasVoted);
        Assert.True(model.Detail.ShowPollResults);
        Assert.True(model.Detail.PollOptions[1].ShowResult);
        Assert.True(model.Detail.PollOptions[1].IsViewerVote);
        Assert.Equal(2, model.Detail.PollOptions[1].VotesCount);
        Assert.False(model.Detail.IsPollBusy);
    }

    [Fact]
    public async Task VotePollFailureKeepsStateAndShowsError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                poll: new HubAnnouncementPoll
                {
                    Id = "p1",
                    Question = "Когда?",
                    Options = [new HubAnnouncementPollOption { Id = "o1", Text = "Сб" }],
                }),
            AnnouncementVoteException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = await LoadDetailAsync(api);

        await ((NativeAsyncCommand)model.VotePollOptionCommand).ExecuteAsync(
            model.Detail!.PollOptions[0]);

        Assert.False(model.Detail.PollHasVoted);
        Assert.False(model.Detail.IsPollBusy);
        Assert.True(model.HasDetailError);
    }

    [Fact]
    public async Task MultiplePollSubmitsSelectedOptions()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                poll: new HubAnnouncementPoll
                {
                    Id = "p1",
                    Question = "Дни?",
                    AllowsMultiple = true,
                    Options =
                    [
                        new HubAnnouncementPollOption { Id = "o1", Text = "Сб" },
                        new HubAnnouncementPollOption { Id = "o2", Text = "Вс" },
                    ],
                }),
        };
        var model = await LoadDetailAsync(api);
        Assert.True(model.Detail!.ShowPollSubmit);
        model.Detail.PollOptions[0].IsSelected = true;
        model.Detail.PollOptions[1].IsSelected = true;

        await ((NativeAsyncCommand)model.SubmitPollVoteCommand).ExecuteAsync(null);

        // Оба варианта проголосованы — viewer_option_ids в пересчитанном опросе.
        Assert.True(model.Detail.PollHasVoted);
        Assert.True(model.Detail.PollOptions[0].IsViewerVote);
        Assert.True(model.Detail.PollOptions[1].IsViewerVote);
        Assert.Equal(2, api.AnnouncementDetail!.Poll!.TotalVotes);
    }

    // ---- Вложения ----

    [Fact]
    public async Task OpenAttachmentUsesSaverSeamWithAnnouncementId()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                attachments:
                [
                    new HubAnnouncementAttachment
                    {
                        Id = "att-1",
                        AnnouncementId = "n1",
                        FileName = "grafik.pdf",
                        FileSize = 10,
                    },
                ]),
        };
        string? savedId = null;
        NewsAttachmentViewModel? savedItem = null;
        var model = await LoadDetailAsync(api);
        model.AttachmentSaver = (item, id) =>
        {
            savedItem = item;
            savedId = id;
            Assert.True(item.IsDownloading);
            return Task.CompletedTask;
        };
        var attachment = Assert.Single(model.Detail!.Attachments);

        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(attachment);

        Assert.Equal("n1", savedId);
        Assert.Same(attachment, savedItem);
        Assert.False(attachment.IsDownloading);
        Assert.Empty(api.AnnouncementAttachmentDownloads);
    }

    [Fact]
    public async Task OpenAttachmentFailureShowsLocalError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail(
                "n1",
                attachments:
                [
                    new HubAnnouncementAttachment { Id = "att-1", FileName = "a.bin" },
                ]),
        };
        var model = await LoadDetailAsync(api);
        model.AttachmentSaver = (_, _) => throw new IOException("disk full");

        await ((NativeAsyncCommand)model.OpenAttachmentCommand).ExecuteAsync(
            model.Detail!.Attachments[0]);

        Assert.True(model.HasDetailError);
        Assert.False(model.Detail.Attachments[0].IsDownloading);
    }

    // ---- Комментарии ----

    [Fact]
    public async Task CommentsLoadAfterDetailAndShowSectionErrorIsolated()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items = [MakeComment("c1", body: "Понял, спасибо")],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);

        var comment = Assert.Single(model.Detail!.Comments);
        Assert.Equal("Понял, спасибо", comment.Body);
        Assert.Equal(1, model.Detail!.CommentsTotal);
        Assert.Equal("Комментарии (1)", model.Detail!.CommentsHeaderText);
        Assert.Null(model.Detail!.CommentsErrorText);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task CommentsLoadFailureKeepsCardAndShowsSectionError()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);

        Assert.NotNull(model.Detail!.CommentsErrorText);
        Assert.Empty(model.Detail!.Comments);
        Assert.False(model.HasDetailError);
        Assert.False(model.Detail.IsCommentsLoading);
    }

    [Fact]
    public async Task SendCommentPostsAndInsertsAtTop()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items = [MakeComment("c1", body: "Старый")],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        model.Detail!.CommentDraft = "  Новый комментарий  ";

        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        var call = Assert.Single(api.AnnouncementCommentCreateCalls);
        Assert.Equal("n1", call.AnnouncementId);
        Assert.Equal("Новый комментарий", call.Body);
        Assert.Null(call.ParentCommentId);
        Assert.Equal("Новый комментарий", model.Detail!.Comments[0].Body);
        Assert.Equal("Старый", model.Detail!.Comments[1].Body);
        Assert.Equal(string.Empty, model.Detail.CommentDraft);
        Assert.Equal(2, model.Detail!.CommentsTotal);
        Assert.False(model.Detail.IsCommentSending);
    }

    [Fact]
    public async Task SendCommentReplyBindsParentAndCountsReply()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items = [MakeComment("c1")],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var parent = model.Detail!.Comments[0];

        ((NativeRelayCommand)model.ReplyCommentCommand).Execute(parent);
        Assert.Equal($"Ответ на комментарий: {parent.AuthorText}", model.Detail.ReplyToText);
        model.Detail!.CommentDraft = "Ответ";

        await ((NativeAsyncCommand)model.SendCommentCommand).ExecuteAsync(null);

        Assert.Equal("c1", api.AnnouncementCommentCreateCalls[0].ParentCommentId);
        Assert.Equal(1, parent.ReplyCount);
        Assert.Equal(string.Empty, model.Detail.ReplyToText);
    }

    [Fact]
    public async Task SaveCommentEditPatchesBody()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items = [MakeComment("c1", body: "Черновик", canEdit: true)],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var comment = model.Detail!.Comments[0];

        ((NativeRelayCommand)model.BeginCommentEditCommand).Execute(comment);
        Assert.True(comment.IsEditing);
        comment.EditBody = "Исправлено";

        await ((NativeAsyncCommand)model.SaveCommentEditCommand).ExecuteAsync(comment);

        Assert.Equal(("n1", "c1", "Исправлено"), Assert.Single(api.AnnouncementCommentUpdateCalls));
        Assert.Equal("Исправлено", comment.Body);
        Assert.False(comment.IsEditing);
        Assert.False(comment.IsBusy);
    }

    [Fact]
    public async Task DeleteCommentWithoutRepliesRemovesFromList()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items = [MakeComment("c1", canDelete: true)],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var comment = model.Detail!.Comments[0];

        await ((NativeAsyncCommand)model.DeleteCommentCommand).ExecuteAsync(comment);

        Assert.Equal(("n1", "c1"), Assert.Single(api.AnnouncementCommentDeleteCalls));
        Assert.Empty(model.Detail!.Comments);
        Assert.Equal(0, model.Detail!.CommentsTotal);
    }

    [Fact]
    public async Task DeleteCommentWithRepliesLeavesTombstone()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 2,
                Items = [MakeComment("c1", replyCount: 1, canDelete: true)],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var comment = model.Detail!.Comments[0];

        await ((NativeAsyncCommand)model.DeleteCommentCommand).ExecuteAsync(comment);

        Assert.Single(model.Detail!.Comments);
        Assert.True(comment.IsDeleted);
        Assert.Equal("Комментарий удалён", comment.DisplayBody);
        Assert.False(comment.ShowReactions);
        Assert.Equal(1, model.Detail!.CommentsTotal);
    }

    [Fact]
    public async Task CommentReactionChipTogglesViaCommentApi()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 1,
                CommentsTotal = 1,
                Items =
                [
                    MakeComment(
                        "c1",
                        reactionCounts: new Dictionary<string, int> { ["like"] = 2 }),
                ],
            },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var comment = model.Detail!.Comments[0];
        var chip = Assert.Single(comment.ReactionChips);
        Assert.Equal("like", chip.ReactionType);

        await ((NativeAsyncCommand)model.ToggleCommentReactionCommand).ExecuteAsync(chip);

        Assert.Equal(("n1", "c1", "like"), Assert.Single(api.AnnouncementCommentReactionCalls));
        Assert.Equal("like", comment.ViewerReaction);
        var updated = Assert.Single(comment.ReactionChips);
        Assert.True(updated.IsMine);
        Assert.False(comment.IsBusy);
    }

    [Fact]
    public async Task ToggleRepliesLoadsBranchOnce()
    {
        var api = new FakeHubApiClient
        {
            AnnouncementsPage = PageOf(MakeItem("n1")),
            AnnouncementDetail = MakeSocialDetail("n1", commentsEnabled: true),
            AnnouncementCommentsPageFactory = query => query.RootCommentId == "c1"
                ? new HubAnnouncementCommentPage
                {
                    Total = 1,
                    Items = [MakeComment("c2", body: "Ответ в ветке", replyTo: "ivanov")],
                }
                : new HubAnnouncementCommentPage
                {
                    Total = 1,
                    CommentsTotal = 2,
                    Items = [MakeComment("c1", replyCount: 1)],
                },
        };
        var model = await LoadDetailAsync(api);
        await WaitFor(() => !model.Detail!.IsCommentsLoading);
        var comment = model.Detail!.Comments[0];

        await ((NativeAsyncCommand)model.ToggleRepliesCommand).ExecuteAsync(comment);

        Assert.True(comment.RepliesExpanded);
        Assert.True(comment.RepliesLoaded);
        var reply = Assert.Single(comment.Replies);
        Assert.Equal("Ответ в ветке", reply.Body);
        Assert.True(reply.IsReply);
    }

    private static HubAnnouncementComment MakeComment(
        string id,
        string body = "Комментарий",
        bool canEdit = false,
        bool canDelete = false,
        int replyCount = 0,
        string? replyTo = null,
        Dictionary<string, int>? reactionCounts = null) =>
        new()
        {
            Id = id,
            AnnouncementId = "n1",
            Username = "ivanov",
            FullName = "Иван Иванов",
            Body = body,
            CreatedAt = DateTimeOffset.UtcNow,
            CanEdit = canEdit,
            CanDelete = canDelete,
            ReplyCount = replyCount,
            ReplyToUsername = replyTo,
            ReactionCounts = reactionCounts,
        };

    private static HubAnnouncementItem MakeSocialDetail(
        string id,
        bool commentsEnabled = false,
        bool viewerBookmarked = false,
        Dictionary<string, int>? reactionCounts = null,
        string? viewerReaction = null,
        HubAnnouncementPoll? poll = null,
        IReadOnlyList<HubAnnouncementAttachment>? attachments = null) =>
        new()
        {
            Id = id,
            Title = "Новость с вовлечением",
            Body = "Текст",
            PublishedAt = DateTimeOffset.UtcNow,
            ReactionsEnabled = true,
            ReactionCounts = reactionCounts,
            ViewerReaction = viewerReaction,
            ViewerBookmarked = viewerBookmarked,
            CommentsEnabled = commentsEnabled,
            Poll = poll,
            Attachments = attachments,
        };

    /// <summary>Список + выбор первой новости → detail готов (комментарии могут ещё лететь).</summary>
    private static async Task<NewsViewModel> LoadDetailAsync(FakeHubApiClient api)
    {
        var model = new NewsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        return model;
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
