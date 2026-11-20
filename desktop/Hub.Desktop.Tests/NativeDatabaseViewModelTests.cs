using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeDatabaseViewModelTests
{
    // ---- Старт и справочник типов ----

    [Fact]
    public async Task LoadReadsTypesButDoesNotSearchWithoutQuery()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypes =
            [
                new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" },
                new HubEquipmentType { CiType = 4, TypeNo = 401, TypeName = "Картридж" },
                new HubEquipmentType { CiType = 1, TypeNo = 102, TypeName = "Монитор" },
            ],
        };
        var model = new DatabaseViewModel(api);

        await model.LoadAsync();

        // Пустой q без type_no — пустая выдача: поиск не шлём, только справочник.
        Assert.Equal(1, api.EquipmentTypesCallCount);
        Assert.Equal(0, api.EquipmentSearchCallCount);
        Assert.Empty(model.Items);
        Assert.True(model.ShowSearchPlaceholder);
        Assert.False(model.IsEmpty);
        // В фильтр — только оборудование (ci_type=1), расходники отсечены как в вебе.
        Assert.Equal(3, model.TypeFilterOptions.Count);
        Assert.Equal("Все типы", model.TypeFilterOptions[0].Label);
        Assert.Equal("Ноутбук", model.TypeFilterOptions[1].Label);
        Assert.Equal("Монитор", model.TypeFilterOptions[2].Label);
    }

    [Fact]
    public async Task TypesErrorDoesNotBlockSearch()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypesException = new HttpRequestException("types down"),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "sn-1";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        Assert.False(model.HasBannerError);
    }

    // ---- Поиск ----

    [Fact]
    public async Task SearchTextSendsContractQuery()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(
                Equipment(5, 100234, "ThinkPad T14", serial: "SN-001")),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "  thinkpad  ";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        var item = Assert.Single(model.Items);
        Assert.Equal("ThinkPad T14", item.Title);
        Assert.Equal("100234", item.InvNoText);
        Assert.Equal("SN-001", item.SerialText);
        Assert.Equal("1 позиция", model.TotalText);
        Assert.False(model.ShowSearchPlaceholder);
        var query = Assert.Single(api.EquipmentSearchQueries);
        Assert.Equal("thinkpad", query.Search);
        Assert.Null(query.Field);
        Assert.Null(query.TypeNo);
        Assert.Equal(1, query.Page);
        Assert.Equal(50, query.Limit);
    }

    [Fact]
    public async Task FieldAndTypeFiltersGoIntoContractQuery()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypes = [new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" }],
            EquipmentSearchPage = PageOf(),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "sn";
        await WaitFor(() => api.EquipmentSearchCallCount >= 1);

        // Поле «Серийный №» → field=serial.
        model.SelectedFieldFilter = model.FieldFilterOptions[2];
        await WaitFor(() => api.EquipmentSearchCallCount >= 2);

        // Фильтр типа → type_no в запросе (как autocomplete типа в вебе).
        model.SelectedTypeFilter = model.TypeFilterOptions[1];
        await WaitFor(() => api.EquipmentSearchCallCount >= 3);

        var query = api.EquipmentSearchQueries[^1];
        Assert.Equal("sn", query.Search);
        Assert.Equal("serial", query.Field);
        Assert.Equal(101, query.TypeNo);
    }

    [Fact]
    public async Task TypeFilterWithoutQueryListsType()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypes = [new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" }],
            EquipmentSearchPage = PageOf(Equipment(1, 100234, "ThinkPad")),
        };
        var model = new DatabaseViewModel(api);
        await model.LoadAsync();

        // Веб: выбранный тип без текста запроса — листинг всего оборудования типа.
        model.SelectedTypeFilter = model.TypeFilterOptions[1];
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        var query = api.EquipmentSearchQueries[^1];
        Assert.Equal(101, query.TypeNo);
        Assert.Null(query.Search);
        Assert.NotEmpty(model.Items);
    }

    [Fact]
    public async Task OneCharSearchDoesNotHitServer()
    {
        var api = new FakeHubApiClient();
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "s";
        await Task.Delay(60);

        Assert.Equal(0, api.EquipmentSearchCallCount);
    }

    [Fact]
    public async Task ClearingSearchResetsListToInitialState()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(1, 100234, "ThinkPad")),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        Assert.NotEmpty(model.Items);

        model.SearchText = "";
        await WaitFor(() => model.Items.Count == 0 && model.ShowSearchPlaceholder);

        // Пустой запрос без типа на сервер не уходит — локальный сброс.
        Assert.Equal(1, api.EquipmentSearchCallCount);
        Assert.Equal(string.Empty, model.TotalText);
    }

    [Fact]
    public async Task StaleSearchResultDoesNotOverwriteNewerQuery()
    {
        var api = new FakeHubApiClient();
        var gate = new TaskCompletionSource();
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();

        model.SearchText = "s1";
        model.SearchText = "s2";
        gate.SetResult();
        await WaitFor(() => api.EquipmentSearchCallCount >= 1);

        Assert.Equal("s2", api.EquipmentSearchQueries[^1].Search);
        Assert.DoesNotContain(api.EquipmentSearchQueries, query => query.Search == "s1");
    }

    // ---- Пагинация «Показать ещё» (серверные страницы) ----

    [Fact]
    public async Task LoadMoreAppendsNextPage()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPageFactory = query => query.Page <= 1
                ? new HubEquipmentSearchPage
                {
                    Total = 3,
                    Page = 1,
                    Pages = 2,
                    Equipment = [Equipment(1, 100001, "PC-1"), Equipment(2, 100002, "PC-2")],
                }
                : new HubEquipmentSearchPage
                {
                    Total = 3,
                    Page = 2,
                    Pages = 2,
                    Equipment = [Equipment(3, 100003, "PC-3")],
                },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        Assert.Equal(2, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (1)", model.MoreButtonText);
        Assert.Equal("3 позиции", model.TotalText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(3, model.Items.Count);
        Assert.Equal("PC-3", model.Items[2].Title);
        Assert.False(model.HasMore);
        Assert.Equal(2, api.EquipmentSearchQueries[^1].Page);
        Assert.Equal("pc", api.EquipmentSearchQueries[^1].Search);
    }

    [Fact]
    public async Task LoadMoreDeduplicatesById()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPageFactory = query => query.Page <= 1
                ? new HubEquipmentSearchPage
                {
                    Total = 2,
                    Page = 1,
                    Pages = 2,
                    Equipment = [Equipment(1, 100001, "PC-1")],
                }
                : new HubEquipmentSearchPage
                {
                    Total = 2,
                    Page = 2,
                    Pages = 2,
                    Equipment = [Equipment(1, 100001, "PC-1"), Equipment(2, 100002, "PC-2")],
                },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        // Повторная строка на границе страниц не дублируется.
        Assert.Equal(2, model.Items.Count);
    }

    // ---- Карточка ----

    [Fact]
    public async Task SelectingItemLoadsDetailByInvNo()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad T14")),
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad T14",
                TypeName = "Ноутбук",
                VendorName = "Lenovo",
                SerialNo = "SN-001",
                HwSerialNo = "HW-77",
                PartNo = "PN-42",
                Status = "В работе",
                EmployeeName = "Петров Пётр",
                EmployeeDept = "ИТ-отдел",
                EmployeeEmail = "petrov@corp.local",
                BranchName = "Сургут",
                Location = "офис 210",
                IpAddress = "10.0.0.5",
                MacAddress = "AA:BB:CC:00:00:01",
                NetworkName = "WS-01",
                DomainName = "CORP",
                Description = "Рабочий ноутбук",
                DateCreate = "01.03.2024",
                DateLastModify = "05.06.2024",
            },
            EquipmentPhotos = new HubEquipmentPhotoList
            {
                ItemId = 5,
                Photos =
                [
                    new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg" },
                    new HubEquipmentPhoto { FileNo = 2, FileName = "b.jpg" },
                ],
            },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        Assert.True(model.ShowDetailPlaceholder);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("ThinkPad T14", detail.Title);
        Assert.Equal("100234", detail.InvNoText);
        Assert.Equal("Ноутбук", detail.TypeText);
        Assert.Equal("Lenovo", detail.VendorText);
        Assert.Equal("SN-001", detail.SerialText);
        Assert.Equal("В работе", detail.StatusText);
        Assert.Equal("Петров Пётр", detail.EmployeeText);
        Assert.Equal("ИТ-отдел", detail.EmployeeDeptText);
        Assert.Equal("Сургут", detail.BranchText);
        Assert.Equal("офис 210", detail.LocationText);
        Assert.Equal("10.0.0.5", detail.IpText);
        Assert.Equal("WS-01", detail.NetworkNameText);
        Assert.Equal("Рабочий ноутбук", detail.DescriptionText);
        // Карточка по инв. номеру — параметр без дробной части.
        Assert.Equal("100234", Assert.Single(api.EquipmentDetailCalls));
        // Фото: счётчик по метаданным + превью по Bearer-контенту (thumb=true).
        await WaitFor(() => model.PhotosLoaded);
        Assert.Equal(5, Assert.Single(api.EquipmentPhotosCalls));
        Assert.True(model.HasPhotos);
        Assert.Equal("Фото: 2", model.PhotoText);
        await WaitFor(() => model.PhotoPreviews.Count == 2);
        Assert.True(model.HasPhotoPreviews);
        Assert.Equal(
            [
                "equipment/5/photos/1/content?thumb=true",
                "equipment/5/photos/2/content?thumb=true",
            ],
            api.ImageDownloadCalls);
    }

    [Fact]
    public async Task PhotoViewerOpensWithFullContentAndCloses()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem { Id = 5, InvNo = 100234, ModelName = "ThinkPad" },
            EquipmentPhotos = new HubEquipmentPhotoList
            {
                ItemId = 5,
                Photos = [new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg" }],
            },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.PhotoPreviews.Count == 1);

        model.OpenPhotoCommand.Execute(model.PhotoPreviews[0]);
        await WaitFor(() => model.IsPhotoViewerOpen && model.PhotoViewerImage is not null);

        // Полный кадр — тот же endpoint без thumb-параметра.
        Assert.Contains("equipment/5/photos/1/content", api.ImageDownloadCalls);
        model.ClosePhotoViewerCommand.Execute(null);
        Assert.False(model.IsPhotoViewerOpen);
        Assert.Null(model.PhotoViewerImage);

        // Повторное открытие + смена выбора → оверлей закрывается.
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.PhotoPreviews.Count == 1);
        model.OpenPhotoCommand.Execute(model.PhotoPreviews[0]);
        await WaitFor(() => model.IsPhotoViewerOpen);
        model.SelectedItem = null;
        Assert.False(model.IsPhotoViewerOpen);
    }

    [Fact]
    public async Task EquipmentHistoryLoadsRowsAndSurvivesEmpty()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem { Id = 5, InvNo = 100234, ModelName = "ThinkPad" },
            EquipmentHistory = new HubEquipmentHistoryResponse
            {
                ItemId = 5,
                Total = 2,
                History =
                [
                    new HubEquipmentHistoryRow
                    {
                        HistId = 12,
                        ChDate = "2024-06-05T10:30:00Z",
                        ChUser = "admin",
                        ChComment = "Moved after repair",
                        OldEmployeeName = "Ivan",
                        NewEmployeeName = "Petr",
                        OldBranchName = "Old branch",
                        NewBranchName = "New branch",
                        OldLocationName = "Old loc",
                        NewLocationName = "New loc",
                    },
                    new HubEquipmentHistoryRow { HistId = 3 },
                ],
            },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HistoryLoaded);

        Assert.Equal("100234", api.EquipmentHistoryCalls.Single());
        Assert.Equal("История: 2", model.HistoryText);
        Assert.True(model.HasHistory);
        Assert.Equal(2, model.HistoryEntries.Count);
        var first = model.HistoryEntries[0];
        Assert.NotEqual("—", first.DateText);
        Assert.Equal("Ivan → Petr", first.EmployeeText);
        Assert.Equal("Old branch → New branch", first.BranchText);
        Assert.Equal("Old loc → New loc", first.LocationText);
        Assert.Equal("admin", first.UserText);
        Assert.True(first.HasComment);
        Assert.False(model.HistoryEntries[1].HasComment);

        // Ошибка истории карточку не ломает.
        var apiDown = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem { Id = 5, InvNo = 100234, ModelName = "ThinkPad" },
            EquipmentHistoryException = new HttpRequestException("history down"),
        };
        var modelDown = new DatabaseViewModel(apiDown)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await modelDown.LoadAsync();
        modelDown.SearchText = "th";
        await WaitFor(() => apiDown.EquipmentSearchCallCount == 1);
        modelDown.SelectedItem = modelDown.Items[0];
        await WaitFor(() => modelDown.Detail is not null && !modelDown.IsDetailLoading);
        Assert.False(modelDown.HistoryLoaded);
        Assert.Empty(modelDown.HistoryText);
        Assert.Null(modelDown.DetailErrorText);
    }

    [Fact]
    public async Task DetailWithoutIdSkipsPhotosMarker()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(null, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem { InvNo = 100234, ModelName = "ThinkPad" },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        // Нет id записи — запрос фото не уходит, метка пустая.
        Assert.Empty(api.EquipmentPhotosCalls);
        Assert.True(model.PhotosLoaded);
        Assert.False(model.HasPhotos);
        Assert.Equal(string.Empty, model.PhotoText);
    }

    [Fact]
    public async Task PhotosErrorDoesNotBreakDetail()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(7, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem { Id = 7, InvNo = 100234, ModelName = "ThinkPad" },
            EquipmentPhotosException = new HttpRequestException("photos down"),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        await Task.Delay(60);

        Assert.NotNull(model.Detail);
        Assert.False(model.PhotosLoaded);
        Assert.Equal(string.Empty, model.PhotoText);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ItemSwitchKeepsOnlyLatestDetail()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(
                Equipment(1, 100001, "PC-1"),
                Equipment(2, 100002, "PC-2")),
            EquipmentDetailFactory = inv => new HubEquipmentItem
            {
                InvNo = double.Parse(inv, System.Globalization.CultureInfo.InvariantCulture),
                ModelName = "Host-" + inv,
            },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectedItem = model.Items[0];
        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("Host-100002", model.Detail?.Title);
        Assert.Equal("100002", api.EquipmentDetailCalls[^1]);
    }

    [Fact]
    public async Task RowWithoutInvNoShowsCardError()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(1, null, "PC-no-inv")),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectedItem = model.Items[0];

        Assert.True(model.HasDetailError);
        Assert.Contains("инвентарного номера", model.DetailErrorText);
        Assert.Empty(api.EquipmentDetailCalls);
    }

    // ---- Ошибки и сброс ----

    [Fact]
    public async Task SearchErrorGoesToBanner()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchException = new HubApiException(HubApiErrorKind.Transport, "network down"),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "th";
        await WaitFor(() => model.HasBannerError);

        Assert.False(model.IsLoading);
        Assert.False(model.IsEmpty);
        Assert.False(model.ShowSearchPlaceholder);
    }

    [Fact]
    public async Task RefreshErrorGoesToBannerViaCommand()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypes = [new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" }],
            EquipmentSearchException = new HttpRequestException("boom"),
        };
        var model = new DatabaseViewModel(api);
        await model.LoadAsync();
        // Фильтр типа делает поиск активным: «Обновить» уходит в сервер и падает в баннер.
        model.SelectedTypeFilter = model.TypeFilterOptions[1];
        await WaitFor(() => api.EquipmentSearchCallCount >= 1);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
    }

    [Fact]
    public async Task DetailErrorGoesToCardErrorNotBanner()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(1, 100234, "PC-1")),
            EquipmentDetailException = new HubApiException(
                HubApiErrorKind.Http, "404", System.Net.HttpStatusCode.NotFound),
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HasDetailError || !model.IsDetailLoading);

        Assert.True(model.HasDetailError);
        Assert.False(model.HasBannerError);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task EmptySearchResultShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = new HubEquipmentSearchPage { Equipment = [], Total = 0, Page = 1, Pages = 0 },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "xx";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        Assert.True(model.IsEmpty);
        Assert.False(model.ShowSearchPlaceholder);
        Assert.Equal("0 позиций", model.TotalText);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ResetClearsListDetailFiltersAndPendingSearch()
    {
        var api = new FakeHubApiClient
        {
            EquipmentTypes = [new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" }],
            EquipmentSearchPage = PageOf(Equipment(1, 100234, "PC-1"), Equipment(2, 100235, "PC-2")),
            EquipmentDetail = new HubEquipmentItem { Id = 1, InvNo = 100234, ModelName = "PC-1" },
        };
        var gate = new TaskCompletionSource();
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        // Загрузка списка напрямую через смену типа (debounce ещё на гейте).
        model.SelectedTypeFilter = model.TypeFilterOptions[1];
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.SelectedFieldFilter = model.FieldFilterOptions[3]; // inv_no
        await WaitFor(() => api.EquipmentSearchCallCount == 2);

        model.SearchText = "pc";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.Items);
        Assert.Null(model.SelectedItem);
        Assert.Null(model.Detail);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Null(model.SelectedFieldFilter.Value);
        Assert.Null(model.SelectedTypeFilter.TypeNo);
        Assert.Single(model.TypeFilterOptions); // только «Все типы»
        Assert.False(model.HasMore);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
        Assert.False(model.HasPhotos);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.True(model.ShowSearchPlaceholder);
        // Отложенный поиск отменён — новых вызовов списка нет.
        await Task.Delay(60);
        Assert.Equal(2, api.EquipmentSearchCallCount);
    }

    // ---- Передача оборудования ----

    [Fact]
    public async Task TransferVisibilityFollowsDatabaseWritePermission()
    {
        // Без database.write и admin — кнопки «Передать…» нет (как веб hasPermission).
        var readOnly = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 7, Username = "reader", Role = "operator", Permissions = ["database.read"] },
        };
        var readOnlyModel = new DatabaseViewModel(readOnly);
        await readOnlyModel.LoadAsync();
        Assert.False(readOnlyModel.CanTransfer);

        // Явное право — кнопка видна.
        var writer = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 7, Username = "writer", Role = "operator", Permissions = ["database.write"] },
        };
        var writerModel = new DatabaseViewModel(writer);
        await writerModel.LoadAsync();
        Assert.True(writerModel.CanTransfer);

        // Admin видит передачу без явного права — матрица как в вебе.
        var admin = new FakeHubApiClient
        {
            CurrentUser = new HubUser { Id = 1, Username = "admin", Role = "admin" },
        };
        var adminModel = new DatabaseViewModel(admin);
        await adminModel.LoadAsync();
        Assert.True(adminModel.CanTransfer);
    }

    [Fact]
    public async Task TransferSubmitPostsSingleInvNoWithFormOperationId()
    {
        var api = TransferApi(out var model);
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        transfer.CommentText = "  переезд в офис 210  ";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.TransferRequests);
        Assert.Equal(["100234"], request.InvNos);
        Assert.Equal("Иванов Иван", request.NewEmployee);
        Assert.Equal("переезд в офис 210", request.Comment);
        // Один operation_id на открытую форму: повторный сабмит дедуплицирует сервер.
        Assert.Equal(transfer.OperationId, request.OperationId);
        Assert.Matches("^[0-9a-f]{32}$", request.OperationId);
        Assert.Null(request.NewEmployeeNo);
        Assert.Null(request.BranchNo);
        Assert.True(transfer.HasResult);
        Assert.Equal("Передано 1 позиция", transfer.ResultText);
        // Успешная передача перечитывает карточку (и историю её потоком).
        await WaitFor(() => api.EquipmentDetailCalls.Count >= 2);
    }

    [Fact]
    public async Task QueuedTransferPollsJobUntilDoneAndListsActs()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobId = "job-9",
            JobStatus = "queued",
            JobStatusText = "В очереди",
        };
        api.TransferJobResponseFactory = call => call < 2
            ? new HubTransferExecuteResponse { JobId = "job-9", JobStatus = "processing", JobStatusText = "Выполняется" }
            : new HubTransferExecuteResponse
            {
                JobId = "job-9",
                JobStatus = "done",
                SuccessCount = 1,
                Acts =
                [
                    new HubTransferAct
                    {
                        ActId = "act-7",
                        OldEmployee = "Петров Пётр",
                        NewEmployee = "Иванов Иван",
                        EquipmentCount = 1,
                        FileName = "act_100234.pdf",
                        FileType = "pdf",
                    },
                ],
            };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        Assert.Equal(2, api.TransferJobCalls.Count);
        Assert.All(api.TransferJobCalls, call => Assert.Equal("job-9", call));
        Assert.True(transfer.HasResult);
        Assert.False(transfer.HasError);
        var act = Assert.Single(transfer.Acts);
        Assert.Equal("act-7", act.ActId);
        Assert.Equal("act_100234.pdf", act.FileName);
        Assert.Contains("Иванов Иван", act.Title);
        await WaitFor(() => api.EquipmentDetailCalls.Count >= 2);
    }

    [Fact]
    public async Task TransferForbiddenShowsInsufficientRightsAndKeepsForm()
    {
        var api = TransferApi(out var model);
        api.TransferException = new HubApiException(
            HubApiErrorKind.Http, "Forbidden", System.Net.HttpStatusCode.Forbidden);
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        Assert.True(model.IsTransferOpen);
        Assert.True(transfer.HasError);
        Assert.Contains("Недостаточно прав", transfer.ErrorText);
        Assert.False(transfer.HasResult);
        Assert.False(transfer.IsBusy);
    }

    [Fact]
    public async Task TransferServerErrorKeepsFormAndShowsError()
    {
        var api = TransferApi(out var model);
        api.TransferException = new HubApiException(
            HubApiErrorKind.Http, "Внутренняя ошибка сервера", System.Net.HttpStatusCode.InternalServerError);
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        transfer.CommentText = "комментарий";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        Assert.True(model.IsTransferOpen);
        Assert.True(transfer.HasError);
        Assert.Contains("Внутренняя ошибка сервера", transfer.ErrorText);
        // Поля не стираются — как в веб-диалоге при 500.
        Assert.Equal("Иванов Иван", transfer.EmployeeQuery);
        Assert.Equal("комментарий", transfer.CommentText);
        Assert.False(transfer.HasResult);
    }

    [Fact]
    public async Task ClosingTransferCancelsJobPolling()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobId = "job-1",
            JobStatus = "queued",
        };
        api.TransferJobResponse = new HubTransferExecuteResponse
        {
            JobId = "job-1",
            JobStatus = "processing",
        };
        // Небольшая реальная задержка: поллинг крутится, пока диалог открыт.
        model.DelayAsync = (_, ct) => Task.Delay(25, ct);
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        var submit = ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        await WaitFor(() => api.TransferJobCalls.Count >= 1);

        transfer.CloseCommand.Execute(null);
        await submit;

        Assert.False(model.IsTransferOpen);
        Assert.Null(model.Transfer);
        var callsAtClose = api.TransferJobCalls.Count;
        await Task.Delay(90);
        Assert.Equal(callsAtClose, api.TransferJobCalls.Count);
    }

    [Fact]
    public async Task EmployeeSuggestionSelectionSendsOwnerNo()
    {
        var api = TransferApi(out var model);
        api.EquipmentEmployeePage = new HubEquipmentEmployeePage
        {
            Employees =
            [
                new HubEquipmentEmployee
                {
                    OwnerNo = 77,
                    Name = "Иванов Иван",
                    Department = "ИТ-отдел",
                    EquipmentCount = 3,
                },
            ],
            Total = 1,
            Page = 1,
            Pages = 1,
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Ива";
        await WaitFor(() => transfer.EmployeeOptions.Count == 1);

        Assert.True(transfer.IsEmployeePopupOpen);
        transfer.SelectEmployeeCommand.Execute(transfer.EmployeeOptions[0]);
        Assert.Equal(77, transfer.SelectedEmployee?.OwnerNo);
        Assert.Equal("Иванов Иван", transfer.EmployeeQuery);
        Assert.False(transfer.IsEmployeePopupOpen);

        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.TransferRequests);
        Assert.Equal("Иванов Иван", request.NewEmployee);
        Assert.Equal(77, request.NewEmployeeNo);
        Assert.Equal("Ива", Assert.Single(api.EquipmentEmployeeQueries));
    }

    [Fact]
    public async Task SelectingAnotherItemClosesTransfer()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100234, "PC-1"),
            Equipment(2, 100235, "PC-2"));
        api.EquipmentDetailFactory = inv => new HubEquipmentItem
        {
            InvNo = double.Parse(inv, System.Globalization.CultureInfo.InvariantCulture),
            ModelName = "Host-" + inv,
        };
        await OpenTransferAsync(model, api);
        Assert.True(model.IsTransferOpen);

        model.SelectedItem = model.Items[1];

        Assert.False(model.IsTransferOpen);
        Assert.Null(model.Transfer);
    }

    [Fact]
    public async Task TransferActDownloadUsesSaverSeam()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
            Acts =
            [
                new HubTransferAct
                {
                    ActId = "act-7",
                    NewEmployee = "Иванов Иван",
                    EquipmentCount = 1,
                    FileName = "act_100234.pdf",
                },
            ],
        };
        TransferActItemViewModel? saved = null;
        model.ActSaver = act =>
        {
            saved = act;
            return Task.CompletedTask;
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        Assert.True(transfer.HasResult);

        var act = Assert.Single(transfer.Acts);
        await ((NativeAsyncCommand)transfer.DownloadActCommand).ExecuteAsync(act);

        Assert.Same(act, saved);
        Assert.Empty(api.TransferActDownloads); // скачивание ушло в шов, а не в API напрямую
    }

    // ---- Групповая передача (чекбоксы списка) ----

    [Fact]
    public async Task BulkToolbarDisabledWithoutSelectionAndEnabledWithChecks()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100234, "PC-1"),
            Equipment(2, 100235, "PC-2"));
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        Assert.False(model.HasSelection);
        Assert.False(model.OpenTransferSelectedCommand.CanExecute(null));
        Assert.False(model.ClearSelectionCommand.CanExecute(null));

        model.Items[0].IsChecked = true;

        Assert.True(model.HasSelection);
        Assert.Equal(1, model.SelectedCount);
        Assert.Equal("Выбрано: 1", model.SelectionText);
        Assert.Equal("⇄ Передать выбранные (1)", model.TransferSelectionText);
        Assert.True(model.OpenTransferSelectedCommand.CanExecute(null));
        Assert.True(model.ClearSelectionCommand.CanExecute(null));
    }

    [Fact]
    public async Task SelectAllChecksOnlyRowsWithInvNo()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100234, "PC-1"),
            Equipment(2, null, "NoInv"),
            Equipment(3, 100236, "PC-3"));
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.SelectAllCommand.Execute(null);
        // Строка без инв. № непередаваема — «☑ Все» её не отмечает.
        Assert.Equal(2, model.SelectedCount);
        Assert.False(model.Items[1].IsChecked);

        model.ClearSelectionCommand.Execute(null);
        Assert.Equal(0, model.SelectedCount);
        Assert.False(model.HasSelection);
    }

    [Fact]
    public async Task BulkTransferSendsCheckedInvNosAndClearsSelection()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100234, "PC-1"),
            Equipment(2, 100235, "PC-2"),
            Equipment(3, 100236, "PC-3"));
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 2,
        };
        await model.LoadAsync();
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);

        model.Items[0].IsChecked = true;
        model.Items[2].IsChecked = true;
        await ((NativeAsyncCommand)model.OpenTransferSelectedCommand).ExecuteAsync(null);

        Assert.True(model.IsTransferOpen);
        var transfer = model.Transfer!;
        Assert.Equal(2, transfer.TargetCount);
        Assert.True(transfer.HasTargetList);
        Assert.Equal("2 позиции", transfer.TargetSummaryText);
        Assert.Equal(
            ["Инв. № 100234 — PC-1", "Инв. № 100236 — PC-3"],
            transfer.TargetItems.Select(target => target.DisplayText));

        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.TransferRequests);
        Assert.Equal(["100234", "100236"], request.InvNos);
        Assert.Equal(transfer.OperationId, request.OperationId);
        Assert.True(transfer.HasResult);
        Assert.Equal("Передано 2 позиции", transfer.ResultText);
        // После done чекбоксы сняты.
        Assert.False(model.HasSelection);
        Assert.All(model.Items, item => Assert.False(item.IsChecked));

        // Закрытие результата перечитывает список — владельцы/места сменились.
        transfer.CloseCommand.Execute(null);
        Assert.False(model.IsTransferOpen);
        await WaitFor(() => api.EquipmentSearchCallCount >= 2);
    }

    [Fact]
    public async Task BulkDialogShowsFirstFiveTargetsAndMoreCounter()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100231, "PC-1"),
            Equipment(2, 100232, "PC-2"),
            Equipment(3, 100233, "PC-3"),
            Equipment(4, 100234, "PC-4"),
            Equipment(5, 100235, "PC-5"),
            Equipment(6, 100236, "PC-6"),
            Equipment(7, 100237, "PC-7"));
        await OpenBulkTransferAsync(model, api);

        var transfer = model.Transfer!;
        Assert.Equal(7, transfer.TargetCount);
        Assert.Equal(5, transfer.TargetItems.Count);
        Assert.Equal("… и ещё 2", transfer.MoreTargetsText);
        Assert.Equal("7 позиций", transfer.TargetSummaryText);
    }

    // ---- Режим «По местоположению» (POST /equipment/transfer/location) ----

    [Fact]
    public async Task LocationModePostsExactBodyAndSkipsActs()
    {
        var api = TransferApi(out var model);
        api.EquipmentSearchPage = PageOf(
            Equipment(1, 100234, "PC-1"),
            Equipment(2, 100235, "PC-2"));
        api.EquipmentBranches =
        [
            new HubEquipmentBranch { Id = Json("5"), Name = "Сургут" },
            new HubEquipmentBranch { Id = Json("6"), Name = "Ноябрьск" },
        ];
        api.EquipmentLocations =
        [
            new HubEquipmentLocation { LocNo = Json("20"), LocName = "Кабинет 20" },
            new HubEquipmentLocation { LocNo = Json("30"), LocName = "Склад" },
        ];
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 2,
        };
        await OpenBulkTransferAsync(model, api);

        var transfer = model.Transfer!;
        Assert.True(transfer.IsEmployeeMode);
        Assert.Equal("— не менять —", transfer.BranchOptions[0].Name);
        transfer.SelectModeCommand.Execute("Location");

        Assert.True(transfer.IsLocationMode);
        Assert.Equal("Перемещение по местоположению", transfer.TitleText);
        Assert.Equal("Переместить", transfer.SubmitButtonText);
        Assert.Equal("Филиал *", transfer.BranchLabelText);
        Assert.Equal("Локация *", transfer.LocationLabelText);
        // Заглушка «— не менять —» убрана: выбор обязателен и ещё не сделан.
        Assert.Equal("Сургут", transfer.BranchOptions[0].Name);
        Assert.Null(transfer.SelectedBranch);

        transfer.SelectedBranch = transfer.BranchOptions[0];
        await WaitFor(() => transfer.LocationOptions.Count == 2);
        Assert.Equal("Кабинет 20", transfer.LocationOptions[0].Name);
        Assert.Null(transfer.SelectedLocation);
        transfer.SelectedLocation = transfer.LocationOptions[0];
        transfer.CommentText = "переезд склада";

        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.LocationTransferRequests);
        Assert.Empty(api.TransferRequests);
        Assert.Equal(["100234", "100235"], request.InvNos);
        // Один operation_id на открытую форму — как в сотрудничьем режиме.
        Assert.Equal(transfer.OperationId, request.OperationId);
        Assert.Equal(5, request.BranchNo!.Value.GetInt32());
        Assert.Equal(20, request.LocNo!.Value.GetInt32());
        Assert.Equal("переезд склада", request.Comment);
        Assert.True(transfer.HasResult);
        Assert.Equal("Перемещено 2 позиции", transfer.ResultText);
        Assert.False(transfer.HasActs);
        Assert.Empty(transfer.Acts);
    }

    [Fact]
    public async Task LocationModeRequiresBranchAndLocation()
    {
        var api = TransferApi(out var model);
        api.EquipmentBranches = [new HubEquipmentBranch { Id = Json("5"), Name = "Сургут" }];
        api.EquipmentLocations = [new HubEquipmentLocation { LocNo = Json("20"), LocName = "Кабинет" }];
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.SelectModeCommand.Execute("Location");

        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        Assert.True(transfer.HasError);
        Assert.Contains("филиал", transfer.ErrorText);
        Assert.Empty(api.LocationTransferRequests);

        transfer.SelectedBranch = transfer.BranchOptions[0];
        await WaitFor(() => transfer.LocationOptions.Count == 1);
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        Assert.Contains("местоположение", transfer.ErrorText);
        Assert.Empty(api.LocationTransferRequests);

        transfer.SelectedLocation = transfer.LocationOptions[0];
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        Assert.False(transfer.HasError);
        Assert.Single(api.LocationTransferRequests);
        Assert.True(transfer.HasResult);
    }

    [Fact]
    public async Task LocationModePollsJobUntilDone()
    {
        var api = TransferApi(out var model);
        api.EquipmentBranches = [new HubEquipmentBranch { Id = Json("5"), Name = "Сургут" }];
        api.EquipmentLocations = [new HubEquipmentLocation { LocNo = Json("20"), LocName = "Кабинет" }];
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobId = "job-loc",
            JobStatus = "queued",
        };
        api.TransferJobResponseFactory = call => call < 2
            ? new HubTransferExecuteResponse { JobId = "job-loc", JobStatus = "processing" }
            : new HubTransferExecuteResponse
            {
                JobId = "job-loc",
                JobStatus = "done",
                SuccessCount = 1,
            };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.SelectModeCommand.Execute("Location");
        transfer.SelectedBranch = transfer.BranchOptions[0];
        await WaitFor(() => transfer.LocationOptions.Count == 1);
        transfer.SelectedLocation = transfer.LocationOptions[0];
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        // Тот же act-jobs поллинг, что и у сотрудничьей передачи.
        Assert.Equal(2, api.TransferJobCalls.Count);
        Assert.All(api.TransferJobCalls, call => Assert.Equal("job-loc", call));
        Assert.Single(api.LocationTransferRequests);
        Assert.Empty(api.TransferRequests);
        Assert.True(transfer.HasResult);
        Assert.Equal("Перемещено 1 позиция", transfer.ResultText);
        Assert.False(transfer.HasActs);
    }

    [Fact]
    public async Task ModeToggleRestoresOptionalBranchAndKeepsSelection()
    {
        var api = TransferApi(out var model);
        api.EquipmentBranches = [new HubEquipmentBranch { Id = Json("5"), Name = "Сургут" }];
        api.EquipmentLocations = [new HubEquipmentLocation { LocNo = Json("20"), LocName = "Кабинет" }];
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        Assert.Same(TransferBranchOption.None, transfer.BranchOptions[0]);
        // Реальный выбор в режиме сотрудника.
        transfer.SelectedBranch = transfer.BranchOptions[1];
        await WaitFor(() => transfer.LocationOptions.Count == 2);
        transfer.SelectedLocation = transfer.LocationOptions[1];

        transfer.SelectModeCommand.Execute("Location");
        Assert.DoesNotContain(transfer.BranchOptions, option => option.Name == "— не менять —");
        Assert.DoesNotContain(transfer.LocationOptions, option => option.Name == "— не менять —");
        Assert.Equal("Сургут", transfer.SelectedBranch?.Name);
        Assert.Equal("Кабинет", transfer.SelectedLocation?.Name);

        transfer.SelectModeCommand.Execute("Employee");
        Assert.Same(TransferBranchOption.None, transfer.BranchOptions[0]);
        Assert.Same(TransferLocationOption.None, transfer.LocationOptions[0]);
        Assert.Equal("Сургут", transfer.SelectedBranch?.Name);
        Assert.Equal("Кабинет", transfer.SelectedLocation?.Name);
    }

    // ---- Режим «Только акт» (POST /equipment/transfer/act-only) ----

    [Fact]
    public async Task ActOnlyModePostsIssuerAndDoesNotRefreshCard()
    {
        var api = TransferApi(out var model);
        api.EquipmentEmployeePage = new HubEquipmentEmployeePage
        {
            Employees =
            [
                new HubEquipmentEmployee
                {
                    OwnerNo = 77,
                    Name = "Иванов Иван",
                    Department = "ИТ-отдел",
                    EquipmentCount = 3,
                },
            ],
        };
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
            Acts =
            [
                new HubTransferAct
                {
                    ActId = "act-9",
                    OldEmployee = "Иванов Иван",
                    NewEmployee = "Петров Пётр",
                    EquipmentCount = 1,
                    FileName = "act_100234.pdf",
                },
            ],
        };
        await OpenTransferAsync(model, api);
        var transfer = model.Transfer!;
        var detailCalls = api.EquipmentDetailCalls.Count;

        transfer.SelectModeCommand.Execute("ActOnly");

        Assert.True(transfer.IsActOnlyMode);
        Assert.False(transfer.IsEmployeeMode);
        Assert.Equal("Акт без перемещения", transfer.TitleText);
        Assert.Equal("Кто выдал *", transfer.EmployeeLabelText);
        Assert.Equal("Сформировать акт", transfer.SubmitButtonText);
        // Поле сотрудника есть (это «кто выдал»), филиала/локации — нет.
        Assert.True(transfer.ShowsEmployeeField);
        Assert.False(transfer.ShowsLocationFields);

        // Issuer — из подсказки search/employee, owner_no уходит в issuer_owner_no.
        transfer.EmployeeQuery = "Ива";
        await WaitFor(() => transfer.EmployeeOptions.Count == 1);
        transfer.SelectEmployeeCommand.Execute(transfer.EmployeeOptions[0]);
        transfer.CommentText = "комплект для акта";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.ActOnlyTransferRequests);
        Assert.Empty(api.TransferRequests);
        Assert.Empty(api.LocationTransferRequests);
        Assert.Equal(["100234"], request.InvNos);
        Assert.Equal("Иванов Иван", request.IssuerEmployee);
        Assert.Equal(77, request.IssuerOwnerNo);
        Assert.Equal("комплект для акта", request.Comment);
        Assert.Equal(transfer.OperationId, request.OperationId);
        Assert.True(transfer.HasResult);
        Assert.Equal("Подготовлено 1 позиция", transfer.ResultText);
        var act = Assert.Single(transfer.Acts);
        Assert.Equal("act-9", act.ActId);
        Assert.Equal("act_100234.pdf", act.FileName);

        // Акт без перемещения не меняет данные: карточка не перечитывается
        // (веб тоже не обновляет — refreshEquipment=false для act_only).
        await Task.Delay(120);
        Assert.Equal(detailCalls, api.EquipmentDetailCalls.Count);
    }

    [Fact]
    public async Task ActOnlyRequiresIssuerAndAcceptsManualName()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.SelectModeCommand.Execute("ActOnly");
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        Assert.True(transfer.HasError);
        Assert.Contains("кто выдал", transfer.ErrorText);
        Assert.Empty(api.ActOnlyTransferRequests);

        // Ручной ввод ФИО — как «Можно ввести вручную» в вебе (owner_no нет).
        transfer.EmployeeQuery = "Без владельца";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.ActOnlyTransferRequests);
        Assert.Equal("Без владельца", request.IssuerEmployee);
        Assert.Null(request.IssuerOwnerNo);
        Assert.True(transfer.HasResult);
    }

    [Fact]
    public async Task ActOnlyPollsJobUntilDone()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobId = "job-act",
            JobStatus = "queued",
        };
        api.TransferJobResponse = new HubTransferExecuteResponse
        {
            JobId = "job-act",
            JobStatus = "done",
            SuccessCount = 1,
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.SelectModeCommand.Execute("ActOnly");
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        // Тот же act-jobs поллинг, что и у остальных режимов.
        Assert.Equal("job-act", Assert.Single(api.TransferJobCalls));
        Assert.Single(api.ActOnlyTransferRequests);
        Assert.Empty(api.TransferRequests);
        Assert.True(transfer.HasResult);
        Assert.Equal("Подготовлено 1 позиция", transfer.ResultText);
    }

    /// <summary>Сырой JSON-идентификатор филиала/локации (int|str по контракту).</summary>
    private static System.Text.Json.JsonElement Json(string raw)
        => System.Text.Json.JsonDocument.Parse(raw).RootElement;

    /// <summary>Load → поиск → отметить все строки → диалог групповой передачи.</summary>
    private static async Task OpenBulkTransferAsync(DatabaseViewModel model, FakeHubApiClient api)
    {
        await model.LoadAsync();
        Assert.True(model.CanTransfer);
        model.SearchText = "pc";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        foreach (var item in model.Items)
        {
            item.IsChecked = true;
        }

        await ((NativeAsyncCommand)model.OpenTransferSelectedCommand).ExecuteAsync(null);
        Assert.True(model.IsTransferOpen);
    }

    /// <summary>Модель с правом database.write и загруженной карточкой PC-1 (inv 100234).</summary>
    private static FakeHubApiClient TransferApi(out DatabaseViewModel model)
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = ["database.read", "database.write"],
            },
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad",
                EmployeeName = "Петров Пётр",
            },
            TransferResponse = new HubTransferExecuteResponse
            {
                JobStatus = "done",
                SuccessCount = 1,
            },
        };
        model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        return api;
    }

    /// <summary>Load → поиск → выбор PC-1 → открытие диалога передачи.</summary>
    private static async Task OpenTransferAsync(DatabaseViewModel model, FakeHubApiClient api)
    {
        await model.LoadAsync();
        Assert.True(model.CanTransfer);
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        await ((NativeAsyncCommand)model.OpenTransferCommand).ExecuteAsync(null);
        Assert.True(model.IsTransferOpen);
        Assert.Equal("100234", model.Transfer!.InvNoText);
        Assert.Equal(1, api.EquipmentBranchesCallCount);
    }

    // ---- Фото: загрузка и модерация ----

    [Fact]
    public async Task CanAddPhotoRequiresWritePermissionAndItemId()
    {
        // database.write + item_id → «+ Добавить фото», секция видна и без снимков.
        var api = PhotoWriteApi(out var model);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotosLoaded);

        Assert.True(model.CanTransfer);
        Assert.True(model.CanAddPhoto);
        Assert.True(model.ShowPhotoSection);
        Assert.Equal("Фото", model.PhotoHeaderText);

        // Только database.read → кнопки нет, секция без снимков скрыта.
        var readApi = PhotoWriteApi(out var readModel, permissions: ["database.read"]);
        await SelectEquipmentItemAsync(readModel, readApi);
        await WaitFor(() => readModel.PhotosLoaded);
        Assert.False(readModel.CanTransfer);
        Assert.False(readModel.CanAddPhoto);
        Assert.False(readModel.ShowPhotoSection);
    }

    [Fact]
    public async Task AddPhotoOpensDialogOnlyAfterPicker()
    {
        var api = PhotoWriteApi(out var model);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotosLoaded);

        // Отмена в диалоге выбора — оверлей не открываем.
        model.PhotoFilePicker = () => [];
        model.AddPhotoCommand.Execute(null);
        Assert.False(model.IsPhotoUploadOpen);

        var path = TempPhotoFile(64);
        try
        {
            model.PhotoFilePicker = () => [path];
            model.AddPhotoCommand.Execute(null);
            Assert.True(model.IsPhotoUploadOpen);
            var upload = model.PhotoUpload!;
            Assert.True(upload.HasFile);
            Assert.Equal(Path.GetFileName(path), upload.FileName);
            Assert.Equal("64 Б", upload.FileSizeText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void PhotoUploadSelectFileValidatesExtensionAndSize()
    {
        var api = new FakeHubApiClient();
        var upload = new EquipmentPhotoUploadViewModel(api, 5, null);

        // Не изображение — отказ до отправки.
        var notImage = TempPhotoFile(16, ".txt");
        upload.SelectFile(notImage);
        Assert.False(upload.HasFile);
        Assert.True(upload.HasError);

        // Лимит бэкенда 15 МБ: больший файл сразу отклоняем.
        var tooBig = TempPhotoFile(EquipmentPhotoUploadViewModel.MaxPhotoBytes + 1);
        try
        {
            upload.SelectFile(tooBig);
            Assert.False(upload.HasFile);
            Assert.True(upload.HasError);
            Assert.Contains("15 МБ", upload.ErrorText);
        }
        finally
        {
            File.Delete(notImage);
            File.Delete(tooBig);
        }

        // Пустой и несуществующий файл — тоже ошибка выбора.
        upload.SelectFile(Path.Combine(Path.GetTempPath(), "hub-no-such-photo.jpg"));
        Assert.False(upload.HasFile);
        Assert.Contains("не найден", upload.ErrorText);
    }

    [Fact]
    public async Task SimplePhotoUploadAppendsToGallery()
    {
        var photos = new HubEquipmentPhotoList
        {
            ItemId = 5,
            Photos = [new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg" }],
        };
        var api = PhotoWriteApi(out var model, photos: photos);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotoPreviews.Count == 1);
        Assert.Equal(1, model.PhotoCount);

        var path = TempPhotoFile(4096);
        try
        {
            model.PhotoFilePicker = () => [path];
            model.AddPhotoCommand.Execute(null);
            var upload = model.PhotoUpload!;
            await ((NativeAsyncCommand)upload.UploadCommand).ExecuteAsync(null);

            // ≤4 МБ → простой multipart POST; чанковая сессия не нужна.
            var call = Assert.Single(api.EquipmentPhotoUploadCalls);
            Assert.Equal(5, call.ItemId);
            Assert.Equal(Path.GetFileName(path), call.FileName);
            Assert.Equal(4096, call.Content.Length);
            Assert.Equal("image/jpeg", call.MimeType);
            Assert.Empty(api.PhotoUploadSessionCalls);

            // Диалог закрыт, счётчик и галерея обновлены; новое фото — «своё».
            Assert.False(model.IsPhotoUploadOpen);
            Assert.Equal(2, model.PhotoCount);
            Assert.Equal(2, model.PhotoPreviews.Count);
            var added = model.PhotoPreviews[1];
            Assert.Equal(9901, added.FileNo);
            Assert.True(added.IsOwn);
            await WaitFor(() => added.Image is not null);
            Assert.Contains("equipment/5/photos/9901/content?thumb=true", api.ImageDownloadCalls);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task LargePhotoUploadUsesChunkedSession()
    {
        var api = PhotoWriteApi(out var model);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotosLoaded);

        // >4 МБ → сессия photo-uploads: create → чанки по 256 КБ → complete.
        var size = 5L * 1024 * 1024 + 123;
        var path = TempPhotoFile(size);
        try
        {
            model.PhotoFilePicker = () => [path];
            model.AddPhotoCommand.Execute(null);
            var upload = model.PhotoUpload!;
            await ((NativeAsyncCommand)upload.UploadCommand).ExecuteAsync(null);

            Assert.Empty(api.EquipmentPhotoUploadCalls);
            var session = Assert.Single(api.PhotoUploadSessionCalls);
            Assert.Equal(5, session.ItemId);
            Assert.Equal(size, session.Request.Size);
            Assert.Equal("image/jpeg", session.Request.MimeType);
            Assert.StartsWith("d2-", session.Request.ClientId);
            // По 256 КБ: 21 чанк; только недостающие (фейк получает все).
            Assert.Equal((int)((size + 256 * 1024 - 1) / (256 * 1024)), api.PhotoUploadChunkCalls.Count);
            Assert.Equal(
                Enumerable.Range(0, api.PhotoUploadChunkCalls.Count).ToArray(),
                api.PhotoUploadChunkCalls.Select(call => call.ChunkIndex).OrderBy(index => index).ToArray());
            Assert.Single(api.PhotoUploadCompleteCalls);
            Assert.Equal(100.0, upload.UploadPercent);

            Assert.False(model.IsPhotoUploadOpen);
            Assert.Equal(1, model.PhotoCount);
            var added = Assert.Single(model.PhotoPreviews);
            Assert.Equal(9901, added.FileNo);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task PhotoUploadErrorStaysInDialog()
    {
        var api = PhotoWriteApi(out var model);
        api.EquipmentPhotoUploadException = new HubApiException(
            HubApiErrorKind.Http, "Сервер отклонил файл.");
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotosLoaded);

        var path = TempPhotoFile(128);
        try
        {
            model.PhotoFilePicker = () => [path];
            model.AddPhotoCommand.Execute(null);
            var upload = model.PhotoUpload!;
            await ((NativeAsyncCommand)upload.UploadCommand).ExecuteAsync(null);

            Assert.True(model.IsPhotoUploadOpen);
            Assert.Equal("Сервер отклонил файл.", upload.ErrorText);
            Assert.False(upload.IsBusy);
            Assert.Equal(0, model.PhotoCount);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task VerifyPhotoAppliesMarksAndGates()
    {
        var photos = new HubEquipmentPhotoList
        {
            ItemId = 5,
            VerificationAvailable = true,
            VerifyPermitted = true,
            Photos =
            [
                new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg", CanVerify = true },
                new HubEquipmentPhoto { FileNo = 2, FileName = "b.jpg", Verified = true, VerifiedBy = "mod" },
            ],
        };
        var api = PhotoWriteApi(out var model, photos: photos);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotoPreviews.Count == 2);

        var first = model.PhotoPreviews[0];
        Assert.True(first.ShowVerifyButton);
        Assert.Equal("На проверке", first.StatusLineText);
        // Уже проверенное: бейдж ✓ и строка статуса с модератором.
        Assert.Equal("✓", model.PhotoPreviews[1].StatusBadgeText);
        Assert.Equal("✓ Проверено · mod", model.PhotoPreviews[1].StatusLineText);

        await ((NativeAsyncCommand)model.VerifyPhotoCommand).ExecuteAsync(first);

        Assert.Equal((5L, 1L), Assert.Single(api.PhotoVerifyCalls));
        Assert.True(first.Verified);
        Assert.Equal("✓", first.StatusBadgeText);
        Assert.False(first.ShowVerifyButton);
        Assert.Equal("✓ Проверено · moderator", first.StatusLineText);
    }

    [Fact]
    public async Task RejectPhotoRequiresReasonThenPosts()
    {
        var photos = new HubEquipmentPhotoList
        {
            ItemId = 5,
            VerificationAvailable = true,
            VerifyPermitted = true,
            Photos = [new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg", CanReject = true }],
        };
        var api = PhotoWriteApi(out var model, photos: photos);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotoPreviews.Count == 1);
        var item = model.PhotoPreviews[0];
        Assert.True(item.ShowRejectButton);

        model.OpenRejectPhotoCommand.Execute(item);
        Assert.True(model.IsPhotoRejectOpen);
        Assert.Equal("Отклонить фото", model.PhotoRejectTitle);

        // Без причины — ошибка в диалоге, запрос не уходит (контракт: reason обязателен).
        await ((NativeAsyncCommand)model.ConfirmRejectPhotoCommand).ExecuteAsync(null);
        Assert.True(model.IsPhotoRejectOpen);
        Assert.True(model.HasPhotoRejectError);
        Assert.Empty(api.PhotoRejectCalls);

        model.PhotoRejectReason = "  фото нечитаемо  ";
        await ((NativeAsyncCommand)model.ConfirmRejectPhotoCommand).ExecuteAsync(null);

        Assert.False(model.IsPhotoRejectOpen);
        Assert.Equal((5L, 1L, "фото нечитаемо"), Assert.Single(api.PhotoRejectCalls));
        Assert.True(item.Rejected);
        Assert.Equal("✕", item.StatusBadgeText);
        Assert.Equal("Причина: фото нечитаемо", item.RejectReasonText);
        Assert.Contains("mod", item.StatusLineText);
        Assert.False(item.ShowRejectButton);
    }

    [Fact]
    public async Task EditRejectReasonUsesPatchRequest()
    {
        var photos = new HubEquipmentPhotoList
        {
            ItemId = 5,
            VerificationAvailable = true,
            VerifyPermitted = true,
            Photos =
            [
                new HubEquipmentPhoto
                {
                    FileNo = 1,
                    FileName = "a.jpg",
                    Rejected = true,
                    RejectedBy = "mod",
                    RejectReason = "старое фото",
                    CanUnverify = true,
                },
            ],
        };
        var api = PhotoWriteApi(out var model, photos: photos);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotoPreviews.Count == 1);
        var item = model.PhotoPreviews[0];
        Assert.True(item.ShowEditReasonButton);

        model.EditRejectPhotoCommand.Execute(item);
        Assert.True(model.IsPhotoRejectOpen);
        Assert.Equal("Изменить причину отклонения", model.PhotoRejectTitle);
        Assert.Equal("Сохранить", model.PhotoRejectConfirmText);
        Assert.Equal("старое фото", model.PhotoRejectReason);

        model.PhotoRejectReason = "фото нечитаемо";
        await ((NativeAsyncCommand)model.ConfirmRejectPhotoCommand).ExecuteAsync(null);

        Assert.False(model.IsPhotoRejectOpen);
        Assert.Equal((5L, 1L, "фото нечитаемо"), Assert.Single(api.PhotoRejectReasonPatchCalls));
        Assert.Empty(api.PhotoRejectCalls);
        Assert.Equal("Причина: фото нечитаемо", item.RejectReasonText);
    }

    [Fact]
    public async Task RotatePhotoReloadsImagesWithRevision()
    {
        var photos = new HubEquipmentPhotoList
        {
            ItemId = 5,
            Photos = [new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg" }],
        };
        var api = PhotoWriteApi(out var model, photos: photos);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.PhotoPreviews.Count == 1);
        var item = model.PhotoPreviews[0];
        Assert.True(model.CanRotatePhotos); // database.write достаточно.

        model.OpenPhotoCommand.Execute(item);
        await WaitFor(() => model.IsPhotoViewerOpen);
        await ((NativeAsyncCommand)model.RotatePhotoCommand).ExecuteAsync(item);

        Assert.Equal((5L, 1L, 90), Assert.Single(api.PhotoRotateCalls));
        // Кэш сброшен ?v=1: миниатюра и полный кадр перечитаны заново.
        Assert.Contains("equipment/5/photos/1/content?thumb=true&v=1", api.ImageDownloadCalls);
        Assert.Contains("equipment/5/photos/1/content?v=1", api.ImageDownloadCalls);
        // Второй поворот — следующая ревизия.
        await ((NativeAsyncCommand)model.RotatePhotoCommand).ExecuteAsync(item);
        Assert.Contains("equipment/5/photos/1/content?thumb=true&v=2", api.ImageDownloadCalls);
    }

    // ---- Загрузка подписанного акта (тулбар «⇪ Загрузить акт») ----

    [Fact]
    public async Task UploadActOpensAfterPickerAndParsesDraft()
    {
        var api = TransferApi(out var model);
        await model.LoadAsync();
        Assert.True(model.CanTransfer);

        // Отмена в диалоге выбора — оверлей не открываем (как у «+ Добавить фото»).
        model.ActFilePicker = () => [];
        await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
        Assert.False(model.IsUploadActOpen);

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            Assert.True(model.IsUploadActOpen);
            var upload = model.UploadAct!;
            Assert.True(upload.HasFile);
            Assert.EndsWith(".pdf", upload.FileName);
            Assert.Equal("64 Б", upload.FileSizeText);

            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);

            var call = Assert.Single(api.UploadedActParseCalls);
            Assert.False(call.ManualMode);
            Assert.Equal(upload.FileName, call.FileName);
            Assert.True(upload.HasDraft);
            Assert.True(upload.ShowsDraftForm);
            Assert.Equal("Иванов И.И.", upload.FromEmployeeText);
            Assert.Equal("Петров П.П.", upload.ToEmployeeText);
            Assert.Equal("2025-01-15", upload.DocDateText);
            Assert.Equal("100234, 100235", upload.InvNosText);
            Assert.True(upload.HasResolvedItems);
            Assert.False(upload.VerificationIsWarning);
            Assert.Equal("Итоговый список совпадает с номерами, найденными API.",
                upload.VerificationHeadline);
            // Чек проверки не выставлен — «Записать акт» недоступна.
            Assert.False(upload.InvVerified);
            Assert.False(upload.CommitCommand.CanExecute(null));
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActToolbarRequiresWritePermission()
    {
        var api = TransferApi(out var model);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
        Assert.False(model.IsUploadActOpen); // без выбранного файла — просто не открылось

        var readApi = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 8,
                Username = "reader",
                Role = "operator",
                Permissions = ["database.read"],
            },
        };
        var readModel = new DatabaseViewModel(readApi);
        readModel.ActFilePicker = () => ["x.pdf"];
        await readModel.LoadAsync();
        Assert.False(readModel.CanTransfer);

        await ((NativeAsyncCommand)readModel.OpenUploadActCommand).ExecuteAsync(null);

        Assert.False(readModel.IsUploadActOpen);
        Assert.Contains("Недостаточно прав", readModel.BannerErrorText);
        Assert.Empty(readApi.UploadedActParseCalls);
    }

    [Fact]
    public void UploadActSelectFileValidatesPdfAndSize()
    {
        var api = new FakeHubApiClient();
        var upload = new UploadedActViewModel(api, null, null);

        var notPdf = TempPhotoFile(16, ".xlsx");
        upload.SelectFile(notPdf);
        Assert.False(upload.HasFile);
        Assert.True(upload.HasError);
        Assert.Contains("только PDF", upload.ErrorText);

        var tooBig = TempPhotoFile(UploadedActViewModel.MaxActBytes + 1, ".pdf");
        try
        {
            upload.SelectFile(tooBig);
            Assert.False(upload.HasFile);
            Assert.True(upload.HasError);
            Assert.Contains("15 МБ", upload.ErrorText);
        }
        finally
        {
            File.Delete(notPdf);
            File.Delete(tooBig);
        }

        upload.SelectFile(Path.Combine(Path.GetTempPath(), "hub-no-such-act.pdf"));
        Assert.False(upload.HasFile);
        Assert.Contains("не найден", upload.ErrorText);
    }

    [Fact]
    public async Task UploadActParseErrorFallsBackToManualDraft()
    {
        var api = TransferApi(out var model);
        // Первая (автоматическая) попытка — «OpenRouter timeout» → веб-фолбэк manual_mode.
        api.UploadedActParseExceptionFactory = call => call == 1
            ? new HubApiException(
                HubApiErrorKind.Http,
                "OpenRouter request timeout",
                System.Net.HttpStatusCode.InternalServerError)
            : null;
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;

            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);

            // Авто провалилось → сервер вызван повторно с manual_mode=true.
            Assert.Equal(2, api.UploadedActParseCalls.Count);
            Assert.False(api.UploadedActParseCalls[0].ManualMode);
            Assert.True(api.UploadedActParseCalls[1].ManualMode);
            Assert.True(upload.HasDraft);
            Assert.False(upload.HasError);
            Assert.Contains("ручной черновик", upload.NoticeText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActParseManualModeAndOrdinaryError()
    {
        var api = TransferApi(out var model);
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;

            // Явный ручной режим — manual_mode=true в запросе, без fallback.
            await ((NativeAsyncCommand)upload.ParseManualCommand).ExecuteAsync(null);
            var manual = Assert.Single(api.UploadedActParseCalls);
            Assert.True(manual.ManualMode);
            Assert.Contains("ручном режиме", upload.NoticeText);

            // Обычная ошибка parse (не LLM) — без автоматического ручного повтора.
            api.UploadedActParseException = new HubApiException(
                HubApiErrorKind.Http, "Нечитаемый PDF", System.Net.HttpStatusCode.BadRequest);
            api.UploadedActParseCalls.Clear();
            upload.SelectFile(path);
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);

            Assert.Single(api.UploadedActParseCalls);
            Assert.True(upload.HasError);
            Assert.False(upload.HasDraft);
            Assert.Contains("Нечитаемый PDF", upload.ErrorText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActCommitRequiresVerificationAndPostsPayload()
    {
        var api = TransferApi(out var model);
        long? savedDocNo = null;
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            model.UploadedActFileSaver = docNo =>
            {
                savedDocNo = docNo;
                return Task.CompletedTask;
            };
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            Assert.True(upload.HasDraft);

            // Правка списка номеров: дедуп + сверка показывает расхождения.
            upload.FromEmployeeText = "  Сидоров С.С.  ";
            upload.InvNosText = "100234, 100236, 100236";
            Assert.True(upload.VerificationIsWarning);
            Assert.Equal("Не попадут в запись: 100235", upload.DroppedInvNosText);
            Assert.Equal("Добавлены или изменены вручную: 100236", upload.AddedInvNosText);
            Assert.False(upload.CommitCommand.CanExecute(null));

            upload.InvVerified = true;
            Assert.True(upload.CommitCommand.CanExecute(null));
            await ((NativeAsyncCommand)upload.CommitCommand).ExecuteAsync(null);

            var request = Assert.Single(api.UploadedActCommitRequests);
            Assert.Equal("draft-1", request.DraftId);
            Assert.Equal("Сидоров С.С.", request.FromEmployee);
            Assert.Equal("Петров П.П.", request.ToEmployee);
            Assert.Equal("2025-01-15", request.DocDate);
            Assert.Equal(["100234", "100236"], request.EquipmentInvNos);
            Assert.True(upload.HasResult);
            Assert.False(upload.ShowsDraftForm);
            Assert.Equal("Акт загружен. DOC_NO: 501, FILE_NO: 7001.", upload.ResultText);
            Assert.Contains("100234", upload.ResultInvNosText);

            // «Скачать акт» — шов получает doc_no, прямого вызова API нет.
            await ((NativeAsyncCommand)upload.DownloadActCommand).ExecuteAsync(null);
            Assert.Equal(501, savedDocNo);
            Assert.Empty(api.EquipmentActDownloads);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActInvNosEditResetsVerification()
    {
        var api = TransferApi(out var model);
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            upload.InvVerified = true;
            Assert.True(upload.CommitCommand.CanExecute(null));

            // Правка списка обнуляет подтверждение — как в вебе.
            upload.InvNosText = "100234";
            Assert.False(upload.InvVerified);
            Assert.False(upload.CommitCommand.CanExecute(null));
            Assert.True(upload.VerificationIsWarning);
            Assert.Equal("Не попадут в запись: 100235", upload.DroppedInvNosText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public void UploadActInvNosParserNormalizesLikeWeb()
    {
        // parseInvNosInput веба: разделители пробелы/запятые/точки с запятой,
        // «№», «123.0»→«123», только цифры, дедуп с сохранением порядка.
        Assert.Equal(
            ["100234", "100235"],
            UploadedActViewModel.ParseInvNosText("№100234; 100235.0,,"));
        Assert.Equal(["7"], UploadedActViewModel.ParseInvNosText("007"));
        Assert.Equal(["1", "2"], UploadedActViewModel.ParseInvNosText("1 2 1;2"));
        Assert.Empty(UploadedActViewModel.ParseInvNosText("abc; №; ,,,"));
    }

    // ---- Reminder-задача «загрузить подписанный акт» и email акта ----

    [Fact]
    public async Task TransferResultShowsUploadReminderAndOpensTask()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
            UploadReminderCreated = true,
            UploadReminderTaskId = "901",
            UploadReminderId = "rem-1",
            UploadReminderControllerUsername = "boss",
            UploadReminderControllerFallbackUsed = true,
        };
        var navigated = new List<string>();
        model.ReminderTaskNavigator = (taskId, _) =>
        {
            navigated.Add(taskId);
            return Task.CompletedTask;
        };
        await OpenTransferAsync(model, api);

        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);

        Assert.True(transfer.HasResult);
        Assert.True(transfer.HasReminderBlock);
        Assert.True(transfer.HasReminderInfo);
        Assert.Contains("напоминание", transfer.ReminderInfoText, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("boss", transfer.ReminderInfoText);
        Assert.Contains("fallback", transfer.ReminderInfoText);
        Assert.False(transfer.HasReminderWarning);
        Assert.True(transfer.HasReminderTask);
        Assert.Equal("rem-1", transfer.ReminderId);
        Assert.Equal("901", transfer.ReminderTaskId);
        Assert.True(transfer.OpenReminderTaskCommand.CanExecute(null));
        Assert.True(transfer.OpenUploadReminderCommand.CanExecute(null));

        // «Открыть задачу» — через шов навигации на страницу задач.
        transfer.OpenReminderTaskCommand.Execute(null);
        Assert.Equal("901", Assert.Single(navigated));
    }

    [Fact]
    public async Task TransferUploadReminderOpensBoundDialog()
    {
        var api = TransferApi(out var model);
        api.TransferResponse = new HubTransferExecuteResponse
        {
            JobStatus = "done",
            SuccessCount = 1,
            UploadReminderCreated = true,
            UploadReminderTaskId = "901",
            UploadReminderId = "rem-1",
        };
        var navigated = new List<string>();
        model.ReminderTaskNavigator = (taskId, _) =>
        {
            navigated.Add(taskId);
            return Task.CompletedTask;
        };
        await OpenTransferAsync(model, api);
        var transfer = model.Transfer!;
        transfer.EmployeeQuery = "Иванов Иван";
        await ((NativeAsyncCommand)transfer.SubmitCommand).ExecuteAsync(null);
        Assert.True(transfer.HasReminderBlock);

        // «Загрузить подписанный акт» — диалог без файла, binding грузит reminder.
        transfer.OpenUploadReminderCommand.Execute(null);
        await WaitFor(() => model.IsUploadActOpen);
        var upload = model.UploadAct!;
        Assert.False(upload.HasFile);
        Assert.True(upload.HasReminderBinding);
        Assert.Equal("rem-1", upload.ReminderId);
        Assert.Equal("901", upload.ReminderTaskId);
        Assert.True(upload.HasReminderTask);
        await WaitFor(() => api.TransferReminderCalls.Count == 1 && !upload.IsReminderLoading);
        Assert.False(upload.HasReminderError);
        Assert.Equal("Ожидается актов: 1. Загружено: 0.", upload.ReminderSummaryText);
        var group = Assert.Single(upload.ReminderPendingGroups);
        Assert.Equal("Петров П.П.", group.TitleText);
        Assert.Equal("100234, 100235", group.InvNosText);
        // Prefill из reminder-payload: получатель — из reminder, владелец/номера — группа.
        Assert.Equal("Иванов И.И.", upload.ToEmployeeText);
        Assert.Equal("Петров П.П.", upload.FromEmployeeText);
        Assert.Equal("100234, 100235", upload.InvNosText);

        // «Открыть задачу» из панели диалога — та же навигация.
        upload.OpenReminderTaskCommand.Execute(null);
        Assert.Equal("901", Assert.Single(navigated));
    }

    [Fact]
    public async Task UploadActReminderDeepLinkOpensDialogAndCommitsBinding()
    {
        var api = TransferApi(out var model);
        api.UploadedActCommitResult = new HubUploadedActCommitResult
        {
            Success = true,
            DocNo = 502,
            DocNumber = "А-502",
            FileNo = 7002,
            LinkedInvNos = ["100234", "100235"],
            ReminderStatus = "matched_partial",
            ReminderPendingGroups = 1,
            ReminderId = "rem-1",
            ReminderTaskId = "901",
        };
        await model.LoadAsync();

        // Диплинк /database?upload_act=1&reminder_id=…&source_task_id=… — тот же шов.
        await model.OpenUploadActReminderAsync("rem-1", "901");
        Assert.True(model.IsUploadActOpen);
        var upload = model.UploadAct!;
        Assert.True(upload.HasReminderBinding);
        Assert.Equal("rem-1", Assert.Single(api.TransferReminderCalls));

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            upload.SelectFile(path);
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            upload.InvVerified = true;
            await ((NativeAsyncCommand)upload.CommitCommand).ExecuteAsync(null);

            var request = Assert.Single(api.UploadedActCommitRequests);
            Assert.Equal("rem-1", request.ReminderId);
            Assert.Equal("901", request.SourceTaskId);
            Assert.True(upload.HasResult);
            Assert.Contains("Осталось актов: 1", upload.NoticeText);
            // После записи напоминание перечитано — как loadTransferReminder веба.
            Assert.Equal(2, api.TransferReminderCalls.Count);
            // Авто-email по сотрудникам черновика (autoEmail веба): mode=auto.
            var email = Assert.Single(api.UploadedActEmailRequests);
            Assert.Equal(502, email.DocNo);
            Assert.Equal("auto", email.Mode);
            Assert.Equal("Иванов И.И.", email.FromEmployee);
            Assert.Equal("Петров П.П.", email.ToEmployee);
            Assert.Equal("Акт №502", email.Subject);
            Assert.True(upload.HasEmailStatus);
            Assert.Contains("Автоотправка: отправлено 1", upload.EmailStatusText);
            var status = Assert.Single(upload.EmailRecipientStatuses);
            Assert.Contains("ivanov@hub.test", status);
            Assert.Contains("sent", status);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActReminderLoadErrorIsIsolatedToPanel()
    {
        var api = TransferApi(out var model);
        api.TransferReminderException = new HubApiException(
            HubApiErrorKind.Http, "Напоминание не найдено", System.Net.HttpStatusCode.NotFound);
        await model.LoadAsync();

        await model.OpenUploadActReminderAsync("rem-9", "901");

        var upload = model.UploadAct!;
        Assert.True(upload.HasReminderBinding);
        Assert.True(upload.HasReminderError);
        Assert.Contains("Напоминание не найдено", upload.ReminderErrorText);

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            // Ошибка reminder'а не ломает обычный флоу: файл → parse → черновик.
            upload.SelectFile(path);
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            Assert.True(upload.HasDraft);
            Assert.False(upload.HasError);
            Assert.Equal("Иванов И.И.", upload.FromEmployeeText);

            // «Обновить» перечитывает напоминание — панель восстанавливается.
            api.TransferReminderException = null;
            await ((NativeAsyncCommand)upload.RefreshReminderCommand).ExecuteAsync(null);
            Assert.False(upload.HasReminderError);
            Assert.True(upload.HasReminderSummary);
            Assert.Equal(2, api.TransferReminderCalls.Count);
            Assert.Equal("901", upload.ReminderTaskId);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActAutoEmailSkipsWithoutEmployeesAndManualSendsSelected()
    {
        var api = TransferApi(out var model);
        // Черновик без сторон акта — автоотправке некого резолвить.
        api.UploadedActParseResult = new HubUploadedActDraft
        {
            DraftId = "draft-mail",
            FileName = "act.pdf",
            EquipmentInvNos = ["100234"],
        };
        api.EquipmentOwners =
        [
            new HubEquipmentOwner { OwnerNo = 77, OwnerDisplayName = "Иванов И.И.", OwnerDept = "ИТ" },
        ];
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            upload.InvVerified = true;
            await ((NativeAsyncCommand)upload.CommitCommand).ExecuteAsync(null);

            // Автоотправки не было — подсказка про ручную отправку.
            Assert.Empty(api.UploadedActEmailRequests);
            Assert.Contains("вручную", upload.EmailStatusText);
            Assert.False(upload.SendEmailCommand.CanExecute(null));

            // Поиск получателя → чип → mode=selected с owner_nos.
            upload.EmailRecipientQuery = "иванов";
            await WaitFor(() => upload.EmailRecipientOptions.Count == 1);
            var option = Assert.Single(upload.EmailRecipientOptions);
            Assert.Equal(77, option.OwnerNo);
            upload.SelectEmailRecipientCommand.Execute(option);
            var chip = Assert.Single(upload.EmailRecipients);
            Assert.Equal(77, chip.OwnerNo);
            Assert.True(upload.HasEmailRecipients);
            Assert.True(upload.SendEmailCommand.CanExecute(null));

            await ((NativeAsyncCommand)upload.SendEmailCommand).ExecuteAsync(null);
            var request = Assert.Single(api.UploadedActEmailRequests);
            Assert.Equal(501, request.DocNo);
            Assert.Equal("selected", request.Mode);
            Assert.Equal([77L], request.OwnerNos);
            Assert.Equal("Акт №501", request.Subject);
            Assert.False(upload.HasEmailError);
            Assert.Contains("Отправлено: 1", upload.EmailStatusText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    [Fact]
    public async Task UploadActAutoEmailErrorIsIsolatedToEmailBlock()
    {
        var api = TransferApi(out var model);
        api.UploadedActEmailException = new HubApiException(
            HubApiErrorKind.Http, "SMTP недоступен", System.Net.HttpStatusCode.InternalServerError);
        await model.LoadAsync();

        var path = TempPhotoFile(64, ".pdf");
        try
        {
            model.ActFilePicker = () => [path];
            await ((NativeAsyncCommand)model.OpenUploadActCommand).ExecuteAsync(null);
            var upload = model.UploadAct!;
            await ((NativeAsyncCommand)upload.ParseAutoCommand).ExecuteAsync(null);
            upload.InvVerified = true;
            await ((NativeAsyncCommand)upload.CommitCommand).ExecuteAsync(null);

            Assert.True(upload.HasResult);
            Assert.Single(api.UploadedActEmailRequests);
            Assert.False(upload.HasError); // итог записи не тронут
            Assert.False(upload.HasReminderError);
            Assert.True(upload.HasEmailError);
            Assert.Contains("Автоотправка не выполнена", upload.EmailErrorText);
            Assert.Contains("SMTP недоступен", upload.EmailErrorText);
        }
        finally
        {
            File.Delete(path);
        }
    }

    /// <summary>Временный файл заданной длины (разреженный — быстрый) под выбор фото.</summary>
    private static string TempPhotoFile(long bytes, string extension = ".jpg")
    {
        var path = Path.Combine(
            Path.GetTempPath(), $"hub-photo-test-{Guid.NewGuid():N}{extension}");
        using (var stream = new FileStream(path, FileMode.Create, FileAccess.Write))
        {
            stream.SetLength(bytes);
        }

        return path;
    }

    /// <summary>API с правом database.write и карточкой с item_id=5 (inv 100234).</summary>
    private static FakeHubApiClient PhotoWriteApi(
        out DatabaseViewModel model,
        HubEquipmentPhotoList? photos = null,
        IReadOnlyList<string>? permissions = null)
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = permissions ?? ["database.read", "database.write"],
            },
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad",
            },
            EquipmentPhotos = photos ?? new HubEquipmentPhotoList { ItemId = 5, Photos = [] },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        return api;
    }

    /// <summary>Load → поиск → выбор PC-1 → карточка с item_id загружена.</summary>
    private static async Task SelectEquipmentItemAsync(DatabaseViewModel model, FakeHubApiClient api)
    {
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
    }

    // ---- Диалог карточки: «✎ Изменить» и «+ Новая позиция» ----

    [Fact]
    public async Task EditDialogSeedsCardFieldsAndEquipmentTypesOnly()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);

        Assert.True(editor.IsEdit);
        Assert.Equal("Изменить карточку", editor.TitleText);
        Assert.Equal("SN-1", editor.SerialText);
        Assert.Equal("HW-1", editor.HwSerialText);
        Assert.Equal("10.0.0.5", editor.IpText);
        Assert.Equal<int?>(101, editor.SelectedType?.TypeNo);
        Assert.Equal<int?>(3, editor.SelectedStatus?.StatusNo);
        Assert.Equal("Сургут", editor.SelectedBranch?.Name);
        Assert.Equal<long?>(77, editor.SelectedEmployee?.OwnerNo);
        // ci_type=4 (картриджи) в список типов не попадает — как фильтр страницы.
        Assert.Equal(2, editor.TypeOptions.Count);
        // Модели типа и локации филиала догружаются зависимыми справочниками.
        await WaitFor(() => api.EquipmentModelsCalls.Count == 1);
        await WaitFor(() => api.EquipmentBranchLocationsCalls.Count == 1);
        Assert.Equal(101, api.EquipmentModelsCalls[0]);
        Assert.Equal("5", api.EquipmentBranchLocationsCalls[0]);
        await WaitFor(() => editor.ModelOptions.Count == 2 && editor.LocationOptions.Count == 1);
        // Текущие модель/локация карточки восстановлены после загрузки списков.
        Assert.Equal<int?>(55, editor.SelectedModel?.ModelNo);
        Assert.Equal<int?>(31, editor.SelectedLocation?.LocNo?.GetInt32());
    }

    [Fact]
    public async Task EditSubmitSendsOnlyChangedFieldsWithEmptyString()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        await WaitFor(() => editor.ModelOptions.Count == 2 && editor.LocationOptions.Count == 1);

        editor.SerialText = "SN-9";
        editor.HwSerialText = "  ";   // очищено → "" в payload, как у веб-формы
        editor.SelectedStatus = editor.StatusOptions[1];
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        var (invNo, request) = Assert.Single(api.EquipmentUpdateCalls);
        Assert.Equal("100234", invNo);
        Assert.Equal("SN-9", request.SerialNo);
        Assert.Equal("", request.HwSerialNo);
        Assert.Equal<int?>(4, request.StatusNo);
        // Нетронутые поля опускаются — сервер делает model_dump(exclude_unset).
        Assert.Null(request.PartNo);
        Assert.Null(request.IpAddress);
        Assert.Null(request.MacAddress);
        Assert.Null(request.NetworkName);
        Assert.Null(request.Description);
        Assert.Null(request.TypeNo);
        Assert.Null(request.ModelNo);
        Assert.Null(request.EmplNo);
        Assert.Null(request.BranchNo);
        Assert.Null(request.LocNo);
        Assert.False(model.IsEditorOpen);
    }

    [Fact]
    public async Task EditSubmitWithoutChangesClosesWithoutRequest()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        await WaitFor(() => editor.ModelOptions.Count == 2 && editor.LocationOptions.Count == 1);

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        // Нет изменений — выход без запроса, как handleDetailSave веба.
        Assert.Empty(api.EquipmentUpdateCalls);
        Assert.False(model.IsEditorOpen);
    }

    [Fact]
    public async Task EditTypeChangeReloadsModelsAndRequiresPick()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        await WaitFor(() => editor.ModelOptions.Count == 2);

        editor.SelectedType = editor.TypeOptions[1];   // Монитор (102)
        await WaitFor(() => api.EquipmentModelsCalls.Count == 2);
        Assert.Equal(102, api.EquipmentModelsCalls[1]);
        await WaitFor(() => editor.ModelOptions.Count == 1);
        // Модель старого типа несовместима — выбор сброшен.
        Assert.Null(editor.SelectedModel);

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите модель для выбранного типа.", editor.ErrorText);
        Assert.Empty(api.EquipmentUpdateCalls);

        editor.SelectedModel = editor.ModelOptions[0];
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        var (_, request) = Assert.Single(api.EquipmentUpdateCalls);
        Assert.Equal<int?>(102, request.TypeNo);
        Assert.Equal<int?>(91, request.ModelNo);
    }

    [Fact]
    public async Task EditBranchChangeReloadsLocationsAndKeepsStaleValue()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        await WaitFor(() => editor.LocationOptions.Count == 1);

        editor.SelectedBranch = editor.BranchOptions[1];   // Москва (9)
        await WaitFor(() => api.EquipmentBranchLocationsCalls.Count == 2);
        Assert.Equal("9", api.EquipmentBranchLocationsCalls[1]);
        await WaitFor(() => editor.LocationOptions.Count == 1);
        Assert.Equal("центр", editor.LocationOptions[0].Name);
        // Старой локации в списке нет — значение переживает справочник,
        // как form.loc_no в веб-диалоге правки.
        Assert.Equal<int?>(31, editor.SelectedLocation?.LocNo?.GetInt32());

        // Снятие локации вручную + смена филиала → та же ошибка, что в вебе.
        editor.SelectedLocation = null;
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите местоположение.", editor.ErrorText);
        Assert.Empty(api.EquipmentUpdateCalls);
    }

    [Fact]
    public async Task EditServerErrorKeepsFormAndEnteredValues()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        api.EquipmentUpdateException = new HttpRequestException("patch failed");

        editor.SerialText = "SN-ERR";
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        Assert.True(editor.HasError);
        Assert.True(model.IsEditorOpen);
        Assert.Equal("SN-ERR", editor.SerialText);
        var (invNo, _) = Assert.Single(api.EquipmentUpdateCalls);
        Assert.Equal("100234", invNo);
    }

    [Fact]
    public async Task EditSuccessReplacesRowAndReloadsCard()
    {
        var api = EditorApi(out var model);
        var editor = await OpenEditorAsync(model, api);
        api.EquipmentUpdateResult = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            ModelName = "ThinkPad",
            SerialNo = "SN-9",
            StatusName = "В работе",
        };
        api.EquipmentDetailFactory = _ => api.EquipmentUpdateResult;

        editor.SerialText = "SN-9";
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        Assert.False(model.IsEditorOpen);
        // Строка списка заменена ответом PATCH без полного перелистывания.
        Assert.Equal("SN-9", model.Items[0].SerialText);
        // Карточка перечитана по выбранной строке — там уже свежий серийный.
        await WaitFor(() => model.Detail?.SerialText == "SN-9");
    }

    [Fact]
    public async Task EditorRequiresDatabaseWritePermission()
    {
        var api = EditorApi(out var model, permissions: ["database.read"]);
        await SelectEquipmentItemAsync(model, api);

        await ((NativeAsyncCommand)model.OpenEditCommand).ExecuteAsync(null);
        Assert.False(model.IsEditorOpen);
        Assert.True(model.HasBannerError);

        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);
        Assert.False(model.IsEditorOpen);
        Assert.Empty(api.EquipmentUpdateCalls);
        Assert.Empty(api.EquipmentCreateCalls);
    }

    [Fact]
    public async Task NewSearchClosesEditorWithSelection()
    {
        var api = EditorApi(out var model);
        await OpenEditorAsync(model, api);

        model.SearchText = "mon";
        await WaitFor(() => api.EquipmentSearchCallCount == 2);
        // Новый поиск снимает выбор — диалог карточки закрывается с ним.
        Assert.False(model.IsEditorOpen);
    }

    [Fact]
    public async Task CreateDialogValidatesRequiredFieldsInOrder()
    {
        var api = EditorApi(out var model);
        var editor = await OpenCreateEditorAsync(model, api);

        Assert.True(editor.IsCreate);
        Assert.Equal("Новая позиция", editor.TitleText);
        Assert.Equal(2, editor.TypeOptions.Count);
        Assert.Equal(2, editor.BranchOptions.Count);
        Assert.True(editor.IsModelEditable);

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Укажите серийный номер.", editor.ErrorText);
        editor.SerialText = "SN-NEW";

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите или введите сотрудника.", editor.ErrorText);
        editor.EmployeeQuery = "Иванов Иван";

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите тип оборудования.", editor.ErrorText);
        editor.SelectedType = editor.TypeOptions[0];

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Укажите модель оборудования.", editor.ErrorText);
        editor.ModelNameText = "ThinkPad X1";

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите статус оборудования.", editor.ErrorText);
        editor.SelectedStatus = editor.StatusOptions[0];

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите филиал.", editor.ErrorText);
        editor.SelectedBranch = editor.BranchOptions[0];
        await WaitFor(() => editor.LocationOptions.Count == 1);

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal("Выберите местоположение.", editor.ErrorText);
        editor.SelectedLocation = editor.LocationOptions[0];

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Null(editor.ErrorText);
        var request = Assert.Single(api.EquipmentCreateCalls);
        Assert.Equal("SN-NEW", request.SerialNo);
        Assert.Equal("Иванов Иван", request.EmployeeName);
        Assert.Equal<int?>(5, request.BranchNo?.GetInt32());
        Assert.Equal<int?>(31, request.LocNo?.GetInt32());
        Assert.Equal<int?>(101, request.TypeNo);
        Assert.Equal<int?>(3, request.StatusNo);
        Assert.Equal("ThinkPad X1", request.ModelName);
        // Не заполненные опциональные поля не уходят.
        Assert.Null(request.EmployeeNo);
        Assert.Null(request.IpAddress);
        Assert.Null(request.MacAddress);
    }

    [Fact]
    public async Task CreateOwnerPickSendsEmployeeNoAndDept()
    {
        var api = EditorApi(out var model);
        var editor = await OpenCreateEditorAsync(model, api);
        await FillCreateFormAsync(editor);

        // Автоподсказка владельца: от двух символов, выбор даёт employee_no+dept.
        // (запрос из FillCreateFormAsync уже ушёл — ждём следующий).
        editor.EmployeeQuery = "Ива";
        await WaitFor(() => api.EquipmentOwnersCalls.Count >= 2);
        Assert.Equal("Ива", api.EquipmentOwnersCalls[^1].Query);
        Assert.Equal(20, api.EquipmentOwnersCalls[^1].Limit);
        var option = Assert.Single(editor.EmployeeOptions);
        Assert.Equal("Иванов Иван", option.Title);
        editor.SelectEmployeeCommand.Execute(option);
        Assert.Equal<long?>(88, editor.SelectedEmployee?.OwnerNo);
        Assert.Equal("Иванов Иван", editor.EmployeeQuery);

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        var request = Assert.Single(api.EquipmentCreateCalls);
        Assert.Equal<long?>(88, request.EmployeeNo);
        Assert.Equal("ИТ", request.EmployeeDept);
        Assert.Equal("Иванов Иван", request.EmployeeName);
    }

    [Fact]
    public async Task CreateMacValidationMatchesWeb()
    {
        var api = EditorApi(out var model);
        var editor = await OpenCreateEditorAsync(model, api);
        await FillCreateFormAsync(editor);

        editor.MacText = "AA:BB:CC";   // 6 hex-цифр — неполный адрес
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        Assert.Equal(
            "MAC-адрес должен содержать 12 символов (например, AA:BB:CC:DD:EE:FF).",
            editor.ErrorText);
        Assert.Empty(api.EquipmentCreateCalls);

        editor.MacText = "aa-bb-cc-dd-ee-11";   // 12 hex — сервер нормализует
        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);
        var request = Assert.Single(api.EquipmentCreateCalls);
        Assert.Equal("aa-bb-cc-dd-ee-11", request.MacAddress);
    }

    [Fact]
    public async Task CreateSuccessKeepsDialogInsertsRowAndOpensCard()
    {
        var api = EditorApi(out var model);
        var editor = await OpenCreateEditorAsync(model, api);
        await FillCreateFormAsync(editor);
        api.EquipmentCreateResult = new HubEquipmentCreateResult
        {
            Success = true,
            ItemId = 9,
            InvNo = "100777",
            CreatedOwner = true,
            Message = "created",
        };
        api.EquipmentDetailFactory = inv => new HubEquipmentItem
        {
            Id = 9,
            InvNo = 100777,
            ModelName = "ThinkPad X1",
            SerialNo = "SN-NEW",
        };

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        // Диалог остаётся открытым для пакетного ввода — уникальные поля чисты.
        Assert.True(editor.HasSuccess);
        Assert.Contains("100777", editor.SuccessText);
        Assert.Contains("создан сотрудник", editor.SuccessText);
        Assert.True(model.IsEditorOpen);
        Assert.Equal("", editor.SerialText);
        Assert.Equal("ThinkPad X1", editor.ModelNameText);   // переиспользуемые поля живут

        // Созданная позиция дочитана и вставлена в выдачу (без полного refresh).
        await WaitFor(() => api.EquipmentDetailCalls.Contains("100777"));
        await WaitFor(() => model.Items.Any(item => item.InvNoText == "100777"));

        // «Открыть карточку» — выбирает созданную строку, диалог закрывается.
        editor.OpenCreatedCardCommand.Execute(null);
        Assert.False(model.IsEditorOpen);
        await WaitFor(() => model.Detail?.SerialText == "SN-NEW");
    }

    [Fact]
    public async Task CreateServerErrorKeepsFormAndValues()
    {
        var api = EditorApi(out var model);
        var editor = await OpenCreateEditorAsync(model, api);
        await FillCreateFormAsync(editor);
        api.EquipmentCreateException = new HttpRequestException("create failed");

        await ((NativeAsyncCommand)editor.SubmitCommand).ExecuteAsync(null);

        Assert.True(editor.HasError);
        Assert.True(model.IsEditorOpen);
        Assert.Equal("SN-NEW", editor.SerialText);
    }

    /// <summary>Обязательные поля формы создания — до валидации MAC и POST.</summary>
    private static async Task FillCreateFormAsync(EquipmentEditorViewModel editor)
    {
        editor.SerialText = "SN-NEW";
        editor.EmployeeQuery = "Иванов Иван";
        editor.SelectedType = editor.TypeOptions[0];
        editor.ModelNameText = "ThinkPad X1";
        editor.SelectedStatus = editor.StatusOptions[0];
        editor.SelectedBranch = editor.BranchOptions[0];
        await WaitFor(() => editor.LocationOptions.Count > 0);
        editor.SelectedLocation = editor.LocationOptions[0];
    }

    /// <summary>Load → поиск → выбор PC-1 → открытие диалога «✎ Изменить».</summary>
    private static async Task<EquipmentEditorViewModel> OpenEditorAsync(
        DatabaseViewModel model, FakeHubApiClient api)
    {
        await SelectEquipmentItemAsync(model, api);
        await ((NativeAsyncCommand)model.OpenEditCommand).ExecuteAsync(null);
        Assert.True(model.IsEditorOpen);
        return model.Editor!;
    }

    /// <summary>Load → «+ Новая позиция» в шапке.</summary>
    private static async Task<EquipmentEditorViewModel> OpenCreateEditorAsync(
        DatabaseViewModel model, FakeHubApiClient api)
    {
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);
        Assert.True(model.IsEditorOpen);
        return model.Editor!;
    }

    /// <summary>Модель с правом database.write и карточкой PC-1 со всеми id справочников.</summary>
    private static FakeHubApiClient EditorApi(
        out DatabaseViewModel model,
        string[]? permissions = null)
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = permissions ?? ["database.read", "database.write"],
            },
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad",
                SerialNo = "SN-1",
                HwSerialNo = "HW-1",
                IpAddress = "10.0.0.5",
                TypeNo = 101,
                TypeName = "Ноутбук",
                ModelNo = 55,
                StatusNo = 3,
                Status = "В работе",
                EmplNo = 77,
                EmployeeName = "Петров Пётр",
                EmployeeDept = "ИТ",
                BranchNo = 5,
                BranchName = "Сургут",
                LocNo = 31,
                Location = "офис 210",
            },
            EquipmentTypes =
            [
                new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" },
                new HubEquipmentType { CiType = 1, TypeNo = 102, TypeName = "Монитор" },
                new HubEquipmentType { CiType = 4, TypeNo = 401, TypeName = "Картридж" },
            ],
            EquipmentStatuses =
            [
                new HubEquipmentStatus { StatusNo = 3, StatusName = "В работе" },
                new HubEquipmentStatus { StatusNo = 4, StatusName = "На складе" },
            ],
            EquipmentBranches =
            [
                new HubEquipmentBranch { Id = Json("5"), Name = "Сургут" },
                new HubEquipmentBranch { Id = Json("9"), Name = "Москва" },
            ],
            EquipmentBranchLocationsFactory = id => id == "9"
                ? [new HubEquipmentLocation { LocNo = Json("77"), LocName = "центр" }]
                : [new HubEquipmentLocation { LocNo = Json("31"), LocName = "офис 210" }],
            EquipmentModelsFactory = type => type == 102
                ? [new HubEquipmentModel { ModelNo = 91, ModelName = "ViewSonic", TypeNo = 102 }]
                :
                [
                    new HubEquipmentModel { ModelNo = 55, ModelName = "ThinkPad", TypeNo = 101 },
                    new HubEquipmentModel { ModelNo = 56, ModelName = "ThinkPad T15", TypeNo = 101 },
                ],
            EquipmentOwners =
            [
                new HubEquipmentOwner
                {
                    OwnerNo = 88,
                    OwnerDisplayName = "Иванов Иван",
                    OwnerDept = "ИТ",
                },
            ],
            EquipmentUpdateResult = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad",
            },
        };
        model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        return api;
    }

    // ---- Форматирование ----

    [Fact]
    public void ItemViewModelToleratesSparseRecord()
    {
        var item = new EquipmentItemViewModel(new HubEquipmentItem());

        Assert.Equal("Оборудование", item.Title);
        Assert.Equal(string.Empty, item.InvNoText);
        Assert.Equal(string.Empty, item.SerialText);
        Assert.False(item.HasInvNo);
        Assert.False(item.HasEmployee);
        Assert.False(item.HasPlace);
        Assert.False(item.HasStatus);
    }

    [Fact]
    public void DetailViewModelToleratesSparseRecord()
    {
        var detail = new EquipmentDetailViewModel(new HubEquipmentItem());

        Assert.Equal("Оборудование", detail.Title);
        Assert.Equal("—", detail.TypeText);
        Assert.Equal("—", detail.EmployeeText);
        Assert.Equal("—", detail.IpText);
        Assert.False(detail.HasDescription);
        Assert.False(detail.HasInvNo);
    }

    [Fact]
    public void CatalogFormatsFloatInvNo()
    {
        Assert.Equal("100234", EquipmentCatalog.FormatInvNo(100234.0));
        Assert.Equal("100234.5", EquipmentCatalog.FormatInvNo(100234.5));
        Assert.Equal(string.Empty, EquipmentCatalog.FormatInvNo(null));
        Assert.Equal("42", EquipmentCatalog.InvNoParameter(42));
        Assert.Null(EquipmentCatalog.InvNoParameter(null));
    }

    [Fact]
    public void DetailStatusAndLocationComeFromDetailKeys()
    {
        // В карточке бэкенд отдаёт status/location, в списке — status_name/location_name.
        var detail = new EquipmentDetailViewModel(new HubEquipmentItem
        {
            Status = "Списано",
            Location = "Склад",
        });
        Assert.Equal("Списано", detail.StatusText);
        Assert.Equal("Склад", detail.LocationText);

        var item = new EquipmentItemViewModel(new HubEquipmentItem
        {
            StatusName = "В работе",
            LocationName = "офис 1",
        });
        Assert.Equal("В работе", item.StatusText);
        Assert.Equal("офис 1", item.PlaceText);
    }

    // ---- Служебное ----

    /// <summary>
    /// DataTemplate страницы ленивый: XAML DatabaseView (меню фильтров, список,
    /// карточка, конвертеры) проверяем прямым рендером на STA-потоке.
    /// </summary>
    [Fact]
    public void DatabaseViewRendersLoadedStateOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var api = new FakeHubApiClient
                {
                    EquipmentTypes =
                    [
                        new HubEquipmentType { CiType = 1, TypeNo = 101, TypeName = "Ноутбук" },
                    ],
                    EquipmentSearchPage = new HubEquipmentSearchPage
                    {
                        Total = 1,
                        Page = 1,
                        Pages = 1,
                        Equipment =
                        [
                            new HubEquipmentItem
                            {
                                Id = 5,
                                InvNo = 100234,
                                ModelName = "ThinkPad T14",
                                TypeName = "Ноутбук",
                                SerialNo = "SN-001",
                                StatusName = "В работе",
                                EmployeeName = "Петров Пётр",
                                BranchName = "Сургут",
                                LocationName = "офис 210",
                            },
                        ],
                    },
                    EquipmentDetail = new HubEquipmentItem
                    {
                        Id = 5,
                        InvNo = 100234,
                        ModelName = "ThinkPad T14",
                        TypeName = "Ноутбук",
                        VendorName = "Lenovo",
                        SerialNo = "SN-001",
                        Status = "В работе",
                        EmployeeName = "Петров Пётр",
                        BranchName = "Сургут",
                        Location = "офис 210",
                        IpAddress = "10.0.0.5",
                    },
                    EquipmentPhotos = new HubEquipmentPhotoList
                    {
                        ItemId = 5,
                        Photos = [new HubEquipmentPhoto { FileNo = 1, FileName = "a.jpg" }],
                    },
                };
                var model = new DatabaseViewModel(api)
                {
                    DelayAsync = (_, _) => Task.CompletedTask,
                };
                model.LoadAsync().GetAwaiter().GetResult();
                model.SearchText = "th";
                while (model.Items.Count == 0)
                {
                    Thread.Sleep(10);
                }

                model.SelectedItem = model.Items[0];
                var spins = 0;
                while (model.Detail is null && spins++ < 500)
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
                    Content = new Native.Views.DatabaseView { DataContext = model },
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

    // ---- Панель сотрудника (клик по ФИО владельца в карточке) ----

    [Fact]
    public async Task EmployeePanelOpensByOwnerAndLoadsBothSections()
    {
        var api = EmployeePanelApi();
        var model = await OpenEmployeePanelAsync(api);

        var employee = model.Employee!;
        Assert.True(model.IsEmployeePanelOpen);
        Assert.Equal("Иванов Иван Иванович", employee.Title);
        Assert.Equal("ИТ-отдел", employee.DeptText);

        // Точные вызовы: items — owner_no + employee_name, история — direction/page/limit.
        Assert.Equal((77L, "Иванов Иван Иванович"), Assert.Single(api.EmployeeItemsCalls));
        var historyCall = Assert.Single(api.EmployeeHistoryCalls);
        Assert.Equal(77L, historyCall.OwnerNo);
        Assert.Equal("all", historyCall.Direction);
        Assert.Equal(string.Empty, historyCall.Q);
        Assert.Equal(1, historyCall.Page);
        Assert.Equal(50, historyCall.Limit);

        await WaitFor(() => employee.Items.Count == 3 && employee.HistoryEntries.Count == 1);
        Assert.Equal("Монитор Dell U2415", employee.Items[0].Title);
        Assert.Equal("100235", employee.Items[0].InvNoText);

        var entry = employee.HistoryEntries[0];
        Assert.Equal("Приход", entry.DirectionText);
        Assert.True(entry.IsIncoming);
        Assert.Equal("Склад → Иванов Иван Иванович", entry.EmployeeText);
        Assert.Equal("Ноутбук / ThinkPad T14", entry.EquipmentText);
        Assert.Equal("Инв. № 100234 · Сер. № SN-001", entry.NumbersText);
        Assert.Equal("Сургут / офис 210", entry.PlaceText);
    }

    [Fact]
    public async Task EmployeePanelRequiresOwnerNo()
    {
        var api = new FakeHubApiClient
        {
            EquipmentSearchPage = PageOf(Equipment(5, 100234, "ThinkPad")),
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 5,
                InvNo = 100234,
                ModelName = "ThinkPad",
                // ФИО без empl_no — владелец отображается, но панель открыть нельзя.
                EmployeeName = "Складовая запись",
            },
        };
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.False(model.Detail!.HasOwner);
        Assert.False(model.OpenEmployeeCommand.CanExecute(null));
        model.OpenEmployeeCommand.Execute(null);
        Assert.False(model.IsEmployeePanelOpen);
        Assert.Null(model.Employee);
        Assert.Empty(api.EmployeeItemsCalls);
        Assert.Empty(api.EmployeeHistoryCalls);
    }

    [Fact]
    public async Task EmployeePanelDirectionChipsReloadFromPageOne()
    {
        var api = EmployeePanelApi();
        api.EmployeeHistoryFactory = call => new HubEmployeeHistoryResponse
        {
            OwnerNo = call.OwnerNo,
            Total = call.Direction == "outgoing" ? 1 : 2,
            Page = call.Page,
            Limit = call.Limit,
            History = call.Direction == "outgoing"
                ?
                [
                    new HubEmployeeHistoryRow
                    {
                        HistId = 21,
                        Direction = "outgoing",
                        OldEmployeeName = "Иванов Иван Иванович",
                        NewEmployeeName = "Склад",
                        ModelName = "Kyocera",
                    },
                ]
                :
                [
                    new HubEmployeeHistoryRow { HistId = 11, Direction = "incoming", NewEmployeeName = "Иванов Иван Иванович" },
                    new HubEmployeeHistoryRow { HistId = 12, Direction = "incoming", NewEmployeeName = "Иванов Иван Иванович" },
                ],
        };
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        await WaitFor(() => employee.HistoryEntries.Count == 2);

        employee.SelectDirectionCommand.Execute("outgoing");

        await WaitFor(() => api.EmployeeHistoryCalls.Count == 2 && employee.HistoryEntries.Count == 1);
        var second = api.EmployeeHistoryCalls[1];
        Assert.Equal("outgoing", second.Direction);
        Assert.Equal(1, second.Page);
        Assert.True(employee.IsDirectionOutgoing);
        Assert.False(employee.IsDirectionAll);
        Assert.Equal("Расход", employee.HistoryEntries[0].DirectionText);
        Assert.Equal("Иванов Иван Иванович → Склад", employee.HistoryEntries[0].EmployeeText);
    }

    [Fact]
    public async Task EmployeePanelHistorySearchSendsDebouncedQ()
    {
        var api = EmployeePanelApi();
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        await WaitFor(() => employee.HistoryEntries.Count == 1);

        employee.HistoryQuery = "think";

        // Debounce мгновенный (DelayAsync): один новый вызов с q, страница сброшена.
        await WaitFor(() => api.EmployeeHistoryCalls.Count == 2);
        var call = api.EmployeeHistoryCalls[1];
        Assert.Equal("think", call.Q);
        Assert.Equal("all", call.Direction);
        Assert.Equal(1, call.Page);
    }

    [Fact]
    public async Task EmployeePanelLoadMoreAppendsAndKeepsFilters()
    {
        var api = EmployeePanelApi();
        api.EmployeeHistoryFactory = call => new HubEmployeeHistoryResponse
        {
            OwnerNo = call.OwnerNo,
            Total = 3,
            Page = call.Page,
            Limit = call.Limit,
            History = call.Page == 1
                ?
                [
                    new HubEmployeeHistoryRow { HistId = 11, Direction = "incoming", NewEmployeeName = "Иванов" },
                    // Повтор на границе страниц: тот же hist_id не дублируем.
                    new HubEmployeeHistoryRow { HistId = 12, Direction = "incoming", NewEmployeeName = "Иванов" },
                ]
                :
                [
                    new HubEmployeeHistoryRow { HistId = 12, Direction = "incoming", NewEmployeeName = "Иванов" },
                    new HubEmployeeHistoryRow { HistId = 13, Direction = "outgoing", OldEmployeeName = "Иванов" },
                ],
        };
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        await WaitFor(() => employee.HistoryEntries.Count == 2 && employee.HasMoreHistory);
        Assert.Equal("Показано 2 из 3", employee.HistoryStatusText);
        Assert.Equal("Показать ещё (1)", employee.LoadMoreHistoryText);

        employee.LoadMoreHistoryCommand.Execute(null);

        await WaitFor(() => api.EmployeeHistoryCalls.Count == 2 && employee.HistoryEntries.Count == 3);
        var more = api.EmployeeHistoryCalls[1];
        Assert.Equal(2, more.Page);
        Assert.Equal("all", more.Direction);
        Assert.False(employee.HasMoreHistory);
        // Дубль hist_id=12 на границе отброшен — добавилась только 13.
        Assert.Equal([11L, 12L, 13L], employee.HistoryEntries.Select(entry => entry.HistId).ToArray());
    }

    [Fact]
    public async Task EmployeePanelClosesOnCardSwitch()
    {
        var api = EmployeePanelApi();
        api.EquipmentDetailFactory = inv => new HubEquipmentItem
        {
            Id = 5,
            InvNo = double.Parse(inv),
            ModelName = "Host-" + inv,
            EmplNo = 77,
            EmployeeName = "Иванов Иван Иванович",
        };
        var model = await OpenEmployeePanelAsync(api);
        Assert.True(model.IsEmployeePanelOpen);

        model.SelectedItem = model.Items[1];

        Assert.False(model.IsEmployeePanelOpen);
        Assert.Null(model.Employee);
        await WaitFor(() => model.Detail is not null && model.Detail.Title == "Host-100235");
    }

    [Fact]
    public async Task EmployeePanelCloseCommandDismisses()
    {
        var api = EmployeePanelApi();
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;

        employee.CloseCommand.Execute(null);

        Assert.False(model.IsEmployeePanelOpen);
        Assert.Null(model.Employee);
    }

    [Fact]
    public async Task EmployeePanelItemsErrorKeepsHistorySection()
    {
        var api = EmployeePanelApi();
        api.EmployeeItemsException = new HttpRequestException("items down");
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;

        await WaitFor(() => employee.HasItemsError && employee.HistoryEntries.Count == 1);
        Assert.True(model.IsEmployeePanelOpen);
        Assert.NotNull(employee.ItemsErrorText);
        Assert.Empty(employee.Items);
        Assert.False(employee.HasHistoryError);
    }

    [Fact]
    public async Task EmployeePanelHistoryErrorKeepsItemsSection()
    {
        var api = EmployeePanelApi();
        api.EmployeeHistoryException = new HttpRequestException("history down");
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;

        await WaitFor(() => employee.HasHistoryError && employee.Items.Count == 3);
        Assert.True(model.IsEmployeePanelOpen);
        Assert.NotNull(employee.HistoryErrorText);
        Assert.Empty(employee.HistoryEntries);
        Assert.False(employee.HasItemsError);
    }

    [Fact]
    public async Task EmployeePanelStaleHistoryResponseDoesNotApply()
    {
        var api = EmployeePanelApi();
        var gate = new TaskCompletionSource<object?>();
        api.EmployeeHistoryDelay = _ => gate.Task;
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        Assert.Single(api.EmployeeHistoryCalls);

        // Панель закрыта до ответа сервера — поздний результат применяться не должен.
        model.SelectedItem = null;
        Assert.Null(model.Employee);
        gate.SetResult(null);
        await Task.Delay(50);

        Assert.Empty(employee.HistoryEntries);
    }

    [Fact]
    public async Task EmployeePanelItemInListSelectsListRow()
    {
        var api = EmployeePanelApi();
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        await WaitFor(() => employee.Items.Count == 3);

        // inv 100235 есть в выдаче — открываем ту же строку списка.
        employee.OpenItemCommand.Execute(employee.Items[0]);

        Assert.Same(model.Items[1], model.SelectedItem);
        Assert.False(model.IsEmployeePanelOpen);
        await WaitFor(() => api.EquipmentDetailCalls.Contains("100235"));
    }

    [Fact]
    public async Task EmployeePanelItemOutsideListOpensDetachedCard()
    {
        var api = EmployeePanelApi();
        var model = await OpenEmployeePanelAsync(api);
        var employee = model.Employee!;
        await WaitFor(() => employee.Items.Count == 3);

        // Строка без инв. № — открыть нечего, вызовов detail нет.
        var callsBefore = api.EquipmentDetailCalls.Count;
        employee.OpenItemCommand.Execute(employee.Items[2]);
        Assert.Equal(callsBefore, api.EquipmentDetailCalls.Count);
        Assert.True(model.IsEmployeePanelOpen);

        // Позиции нет в выдаче — та же загрузка карточки на откреплённой строке.
        employee.OpenItemCommand.Execute(employee.Items[1]);
        await WaitFor(() => api.EquipmentDetailCalls.Contains("100999"));
        Assert.False(model.IsEmployeePanelOpen);
        Assert.NotNull(model.SelectedItem);
        Assert.DoesNotContain(model.Items, item => ReferenceEquals(item, model.SelectedItem));
    }

    private static FakeHubApiClient EmployeePanelApi() => new()
    {
        EquipmentSearchPage = PageOf(
            Equipment(5, 100234, "ThinkPad"),
            Equipment(6, 100235, "Монитор Dell U2415")),
        EquipmentDetail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            ModelName = "ThinkPad T14",
            EmplNo = 77,
            EmployeeName = "Иванов Иван Иванович",
            EmployeeDept = "ИТ-отдел",
        },
        EmployeeItems = new HubEmployeeItemsResponse
        {
            Found = true,
            Equipment =
            [
                new HubEquipmentItem
                {
                    Id = 7,
                    InvNo = 100235,
                    ModelName = "Монитор Dell U2415",
                    TypeName = "Монитор",
                    SerialNo = "SN-M1",
                },
                new HubEquipmentItem
                {
                    Id = 8,
                    InvNo = 100999,
                    ModelName = "Принтер HP M404",
                    TypeName = "Принтер",
                },
                new HubEquipmentItem
                {
                    Id = 9,
                    ModelName = "Позиция без номера",
                    TypeName = "Прочее",
                },
            ],
        },
        EmployeeHistory = new HubEmployeeHistoryResponse
        {
            OwnerNo = 77,
            Total = 1,
            Page = 1,
            Limit = 50,
            History =
            [
                new HubEmployeeHistoryRow
                {
                    HistId = 11,
                    Direction = "incoming",
                    ChUser = "admin",
                    OldEmployeeName = "Склад",
                    NewEmployeeName = "Иванов Иван Иванович",
                    InvNo = 100234,
                    SerialNo = "SN-001",
                    TypeName = "Ноутбук",
                    ModelName = "ThinkPad T14",
                    CurrentInvNo = 100234,
                    BranchName = "Сургут",
                    LocationName = "офис 210",
                },
            ],
        },
    };

    private static async Task<DatabaseViewModel> OpenEmployeePanelAsync(FakeHubApiClient api)
    {
        var model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        model.SearchText = "th";
        await WaitFor(() => api.EquipmentSearchCallCount == 1);
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.OpenEmployeeCommand.Execute(null);
        await WaitFor(() => api.EmployeeItemsCalls.Count > 0 && api.EmployeeHistoryCalls.Count > 0);
        return model;
    }

    // ---- Журнал работ «Работы» по карточке ----

    /// <summary>Карточка ПК: потоки «комплектующие + чистка», идентификаторы уходят в history-запросы.</summary>
    [Fact]
    public async Task PcDetailStartsComponentAndCleaningStreamsWithIdentifiers()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            SerialNo = "SN-PC1",
            HwSerialNo = "HW-PC1",
            BranchName = "ЦО",
            LocationName = "Каб. 1",
        };
        var api = MaintenanceApi(out var model, detail,
            cleaningHistory: new HubMaintenanceHistory { Count = 2, TimeAgoStr = "неделю назад" });
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        Assert.Equal(
            [MaintenanceWorkKind.Component, MaintenanceWorkKind.Cleaning],
            model.WorkStreams.Select(stream => stream.Kind).ToArray());
        Assert.True(model.HasWorkStreams);
        var cleaningCall = Assert.Single(api.CleaningWorkHistoryCalls);
        Assert.Equal("SN-PC1", cleaningCall.SerialNumber);
        Assert.Equal("HW-PC1", cleaningCall.HwSerialNumber);
        Assert.Equal("100234", cleaningCall.InvNo);
        Assert.Equal<long?>(5, cleaningCall.EquipmentId);
        var componentCall = Assert.Single(api.ComponentWorkHistoryCalls);
        Assert.Equal("SN-PC1", componentCall.SerialNumber);
        var cleaning = model.WorkStreams[1];
        Assert.False(cleaning.HasError);
        Assert.Equal("2 записи · последняя: неделю назад", cleaning.SummaryText);
    }

    /// <summary>Принтер: потоки «картридж + принтер-комплектующие»; чистки/батареи нет.</summary>
    [Fact]
    public async Task PrinterDetailStartsCartridgeAndPrinterComponentStreams()
    {
        var detail = new HubEquipmentItem
        {
            Id = 6,
            InvNo = 100235,
            TypeName = "Принтер",
            ModelName = "HP LaserJet M404",
            VendorName = "HP",
            SerialNo = "SN-PR1",
            BranchName = "ЦО",
            LocationName = "Каб. 2",
        };
        var api = MaintenanceApi(out var model, detail);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        Assert.Equal(
            [MaintenanceWorkKind.Cartridge, MaintenanceWorkKind.Component],
            model.WorkStreams.Select(stream => stream.Kind).ToArray());
        Assert.Equal("printer", model.WorkStreams[1].ComponentKind);
        var cartridgeCall = Assert.Single(api.CartridgeWorkHistoryCalls);
        Assert.Equal("SN-PR1", cartridgeCall.SerialNumber);
        Assert.Equal("100235", cartridgeCall.InvNo);
        Assert.Empty(api.CleaningWorkHistoryCalls);
        Assert.Empty(api.BatteryWorkHistoryCalls);
    }

    /// <summary>ИБП: только поток батареи; монитор без ключевых слов — без потоков.</summary>
    [Fact]
    public async Task UpsDetailStartsBatteryStreamAndPlainMonitorNone()
    {
        var upsDetail = new HubEquipmentItem
        {
            Id = 7,
            InvNo = 100236,
            TypeName = "ИБП",
            ModelName = "Smart-UPS 750",
            VendorName = "APC",
            SerialNo = "SN-UPS1",
        };
        var api = MaintenanceApi(out var model, upsDetail);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 1 && model.WorkStreams.All(stream => stream.Loaded));

        var stream = Assert.Single(model.WorkStreams);
        Assert.Equal(MaintenanceWorkKind.Battery, stream.Kind);
        Assert.Equal("SN-UPS1", Assert.Single(api.BatteryWorkHistoryCalls).SerialNumber);
        Assert.Empty(api.CleaningWorkHistoryCalls);

        var monitorApi = MaintenanceApi(
            out var monitorModel,
            new HubEquipmentItem
            {
                Id = 8,
                InvNo = 100237,
                TypeName = "Монитор",
                ModelName = "Dell U2419H",
            });
        await SelectEquipmentItemAsync(monitorModel, monitorApi);

        Assert.Empty(monitorModel.WorkStreams);
        Assert.False(monitorModel.HasWorkStreams);
    }

    /// <summary>Сбой потока чистки не ломает соседний поток комплектующих.</summary>
    [Fact]
    public async Task OneStreamFailureDoesNotBlockOtherStreams()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            SerialNo = "SN-PC1",
        };
        var api = MaintenanceApi(out var model, detail);
        api.CleaningWorkHistoryException = new HttpRequestException("cleaning down");
        api.CleaningWorksException = new HttpRequestException("cleaning down");
        api.ComponentWorks =
        [
            new HubComponentWorkRecord
            {
                SerialNumber = "SN-PC1",
                ComponentName = "SSD",
                ComponentModel = "Samsung 870",
                Timestamp = "2025-10-01T10:00:00Z",
            },
        ];
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        var component = model.WorkStreams[0];
        var cleaning = model.WorkStreams[1];
        Assert.False(component.HasError);
        var entry = Assert.Single(component.Entries);
        Assert.Equal("SSD", entry.TitleText);
        Assert.True(cleaning.HasError);
        Assert.False(cleaning.ShowEmpty);
    }

    /// <summary>Без database.write диалог не открывается — баннер «Недостаточно прав».</summary>
    [Fact]
    public async Task OpenMaintenanceRequiresWritePermission()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            SerialNo = "SN-PC1",
        };
        var api = MaintenanceApi(out var model, detail, permissions: ["database.read"]);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        await ((NativeAsyncCommand)model.OpenMaintenanceCommand)
            .ExecuteAsync(model.WorkStreams[1]);

        Assert.False(model.IsMaintenanceOpen);
        Assert.Equal("Недостаточно прав для изменения данных.", model.BannerErrorText);
        Assert.Empty(api.RegisterCleaningWorkRequests);
    }

    /// <summary>Чистка ПК: прямой POST с полями карточки; после успеха — закрытие и перечитка карточки.</summary>
    [Fact]
    public async Task CleaningSubmitRegistersWorkAndRefreshesCard()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            SerialNo = "SN-PC1",
            HwSerialNo = "HW-PC1",
            BranchName = "ЦО",
            LocationName = "Каб. 1",
            EmployeeName = "Петров",
        };
        var api = MaintenanceApi(out var model, detail);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));
        var detailCalls = api.EquipmentDetailCalls.Count;

        await ((NativeAsyncCommand)model.OpenMaintenanceCommand)
            .ExecuteAsync(model.WorkStreams[1]);
        Assert.True(model.IsMaintenanceOpen);
        var dialog = model.Maintenance!;
        Assert.Equal("Чистка ПК", dialog.TitleText);

        await ((NativeAsyncCommand)dialog.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.RegisterCleaningWorkRequests);
        Assert.Equal("SN-PC1", request.SerialNumber);
        Assert.Equal("HW-PC1", request.HwSerialNo);
        Assert.Equal("Петров", request.Employee);
        Assert.Equal("ЦО", request.Branch);
        Assert.Equal("Каб. 1", request.Location);
        Assert.Equal("100234", request.InvNo);
        Assert.Equal<long?>(5, request.EquipmentId);
        Assert.False(model.IsMaintenanceOpen);
        // Работа меняет DESCR карточки на сервере — карточка и потоки перечитываются.
        await WaitFor(() => api.EquipmentDetailCalls.Count > detailCalls);
        Assert.Empty(api.ConsumableConsumeRequests);
    }

    /// <summary>Без серийника отправка останавливается валидацией до запроса.</summary>
    [Fact]
    public async Task CleaningSubmitWithoutSerialShowsValidationError()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            BranchName = "ЦО",
            LocationName = "Каб. 1",
        };
        var api = MaintenanceApi(out var model, detail);
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        await ((NativeAsyncCommand)model.OpenMaintenanceCommand)
            .ExecuteAsync(model.WorkStreams[1]);
        var dialog = model.Maintenance!;
        await ((NativeAsyncCommand)dialog.SubmitCommand).ExecuteAsync(null);

        Assert.True(dialog.HasError);
        Assert.Contains("не указан серийный номер", dialog.ErrorText);
        Assert.Empty(api.RegisterCleaningWorkRequests);
    }

    /// <summary>Картридж: durable-списание склада с вложенной работой, а не прямой POST журнала.</summary>
    [Fact]
    public async Task CartridgeSubmitConsumesWithNestedWorkPayload()
    {
        var detail = new HubEquipmentItem
        {
            Id = 6,
            InvNo = 100235,
            TypeName = "Принтер",
            ModelName = "HP LaserJet M404",
            SerialNo = "SN-PR1",
            BranchName = "ЦО",
            LocationName = "Каб. 2",
            EmployeeName = "Петров",
        };
        var api = MaintenanceApi(out var model, detail);
        api.ConsumablesLookup =
        [
            new HubConsumableLookupItem
            {
                Id = 42,
                InvNo = "C-1001",
                TypeName = "Картридж",
                ModelName = "HP CE285A",
                Qty = 3,
                BranchName = "ЦО",
                LocationName = "Склад",
            },
        ];
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        await ((NativeAsyncCommand)model.OpenMaintenanceCommand)
            .ExecuteAsync(model.WorkStreams[0]);
        var dialog = model.Maintenance!;
        Assert.Equal("Замена картриджа", dialog.TitleText);
        await WaitFor(() => dialog.ConsumableOptions.Count == 1);
        // Не-картриджные позиции отфильтрованы, выбор — модель картриджа.
        dialog.SelectedConsumable = dialog.ConsumableOptions[0];

        await ((NativeAsyncCommand)dialog.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.ConsumableConsumeRequests);
        Assert.Equal<long?>(42, request.ItemId);
        Assert.Equal(1, request.Qty);
        Assert.Equal("cartridge", request.Reason);
        Assert.False(string.IsNullOrWhiteSpace(request.OperationId));
        Assert.Equal("cartridge", request.Work?.Kind);
        Assert.Equal("HP LaserJet M404", request.Work?.Payload?["printer_model"]);
        Assert.Equal("HP CE285A", request.Work?.Payload?["cartridge_model"]);
        Assert.Equal("SN-PR1", request.Work?.Payload?["serial_number"]);
        Assert.Equal("cartridge", request.Work?.Payload?["component_type"]);
        // Прямой POST журнала не вызывается — сервер запишет работу сам (work_status).
        Assert.Empty(api.RegisterCartridgeWorkRequests);
        Assert.False(model.IsMaintenanceOpen);
        await WaitFor(() => api.EquipmentDetailCalls.Count >= 2);
    }

    /// <summary>Компонент ПК: тип из опций + durable-списание с kind=component.</summary>
    [Fact]
    public async Task PcComponentSubmitConsumesWithComponentPayload()
    {
        var detail = new HubEquipmentItem
        {
            Id = 5,
            InvNo = 100234,
            TypeName = "Системный блок",
            ModelName = "HP ProDesk 400",
            SerialNo = "SN-PC1",
            BranchName = "ЦО",
            LocationName = "Каб. 1",
        };
        var api = MaintenanceApi(out var model, detail);
        api.ConsumablesLookup =
        [
            new HubConsumableLookupItem
            {
                Id = 77,
                TypeName = "Накопитель",
                ModelName = "Samsung 870 EVO",
                Qty = 2,
            },
        ];
        await SelectEquipmentItemAsync(model, api);
        await WaitFor(() => model.WorkStreams.Count == 2 && model.WorkStreams.All(stream => stream.Loaded));

        await ((NativeAsyncCommand)model.OpenMaintenanceCommand)
            .ExecuteAsync(model.WorkStreams[0]);
        var dialog = model.Maintenance!;
        Assert.Equal("Замена комплектующих", dialog.TitleText);
        Assert.True(dialog.ShowComponentTypeSelect);
        Assert.Equal(9, dialog.ComponentTypeOptions.Count);
        await WaitFor(() => dialog.ConsumableOptions.Count == 1);
        dialog.SelectedComponentType = dialog.ComponentTypeOptions
            .First(option => option.Value == "ssd");
        dialog.SelectedConsumable = dialog.ConsumableOptions[0];

        await ((NativeAsyncCommand)dialog.SubmitCommand).ExecuteAsync(null);

        var request = Assert.Single(api.ConsumableConsumeRequests);
        Assert.Equal("component", request.Reason);
        Assert.Equal("component", request.Work?.Kind);
        Assert.Equal("ssd", request.Work?.Payload?["component_type"]);
        Assert.Equal("Samsung 870 EVO", request.Work?.Payload?["component_model"]);
        Assert.Equal("pc", request.Work?.Payload?["equipment_kind"]);
        Assert.Empty(api.RegisterComponentWorkRequests);
        Assert.False(model.IsMaintenanceOpen);
    }

    /// <summary>API с карточкой и правом записи; detail — ответ /equipment/{inv}.</summary>
    private static FakeHubApiClient MaintenanceApi(
        out DatabaseViewModel model,
        HubEquipmentItem detail,
        IReadOnlyList<string>? permissions = null,
        HubMaintenanceHistory? cleaningHistory = null)
    {
        var api = new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "writer",
                Role = "operator",
                Permissions = permissions ?? ["database.read", "database.write"],
            },
            EquipmentSearchPage = PageOf(new HubEquipmentItem
            {
                Id = detail.Id,
                InvNo = detail.InvNo,
                TypeName = detail.TypeName,
                ModelName = detail.ModelName,
                SerialNo = detail.SerialNo,
                StatusName = "В работе",
            }),
            EquipmentDetail = detail,
        };
        if (cleaningHistory is not null)
        {
            api.CleaningWorkHistory = cleaningHistory;
        }

        model = new DatabaseViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        return api;
    }

    private static HubEquipmentItem Equipment(
        long? id, double? invNo, string model, string? serial = null) => new()
    {
        Id = id,
        InvNo = invNo,
        ModelName = model,
        SerialNo = serial,
        StatusName = "В работе",
    };

    private static HubEquipmentSearchPage PageOf(params HubEquipmentItem[] items) => new()
    {
        Equipment = items,
        Total = items.Length,
        Page = 1,
        Pages = 1,
    };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(5));
        while (DateTime.UtcNow < deadline)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(20);
        }

        Assert.True(condition(), "Условие не наступило за отведённое время.");
    }
}
