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
