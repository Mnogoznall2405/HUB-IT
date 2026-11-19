using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeAddressBookViewModelTests
{
    // ---- Список: загрузка, поиск, фильтры, пагинация ----

    [Fact]
    public async Task LoadPopulatesItemsFiltersAndStatusBar()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 2,
                Limit = 50,
                Offset = 0,
                HasMore = false,
                Items = [Contact("Иван Петров"), Contact("Мария Сидорова")],
            },
            AddressBookFilters = new HubAddressBookFilters
            {
                Departments =
                [
                    new HubAddressBookFilterOption { Name = "ИТ-отдел", Count = 12 },
                ],
                Cities =
                [
                    new HubAddressBookFilterOption { Name = "Сургут", Count = 30 },
                ],
            },
        };
        var model = new AddressBookViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Иван Петров", model.Items[0].FullName);
        Assert.Equal("Найдено 2", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.False(model.HasMore);
        // Запрос как в вебе: limit=50, первая страница offset=0, без фильтров.
        var query = api.LastAddressBookQuery;
        Assert.NotNull(query);
        Assert.Equal(50, query!.Limit);
        Assert.Equal(0, query.Offset);
        Assert.Null(query.Department);
        Assert.Null(query.City);
        // Справочники приехали в фильтры: «Все …» + опция с счётчиком в подписи.
        Assert.Equal(2, model.DepartmentFilterOptions.Count);
        Assert.Equal("ИТ-отдел", model.DepartmentFilterOptions[1].Value);
        Assert.Equal("ИТ-отдел (12)", model.DepartmentFilterOptions[1].Label);
        Assert.Equal(2, model.CityFilterOptions.Count);
        Assert.Equal("Сургут (30)", model.CityFilterOptions[1].Label);
    }

    [Fact]
    public async Task SearchGoesToServerWithQuery()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items = [Contact("Иван Петров")],
            },
        };
        var model = new AddressBookViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "сидорова";
        await WaitFor(() => api.LastAddressBookQuery?.Search == "сидорова");

        Assert.Equal("сидорова", api.LastAddressBookQuery!.Search);
        Assert.Equal(0, api.LastAddressBookQuery.Offset);
    }

    [Fact]
    public async Task SearchHasNoMinimumLengthLikeWeb()
    {
        // Веб-версия отправляет q как есть: сервер токенизирует сам.
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage { Total = 0, Items = [] },
        };
        var model = new AddressBookViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "и";
        await WaitFor(() => api.LastAddressBookQuery?.Search == "и");

        Assert.Equal("и", api.LastAddressBookQuery!.Search);
    }

    [Fact]
    public async Task SearchDebounceKeepsOnlyLastQuery()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage { Total = 0, Items = [] },
        };
        var gate = new TaskCompletionSource();
        var model = new AddressBookViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        var calls = api.AddressBookSearchCallCount;

        model.SearchText = "и";
        model.SearchText = "иван";
        gate.SetResult();
        await WaitFor(() => api.LastAddressBookQuery?.Search == "иван");

        // Первый запрос отменён debounce'ом — на сервер ушёл только последний.
        Assert.Equal(calls + 1, api.AddressBookSearchCallCount);
        Assert.Equal("иван", api.LastAddressBookQuery!.Search);
    }

    [Fact]
    public async Task DepartmentAndCityFiltersGoToServer()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage { Total = 0, Items = [] },
            AddressBookFilters = new HubAddressBookFilters
            {
                Departments =
                [
                    new HubAddressBookFilterOption { Name = "ИТ-отдел", Count = 12 },
                ],
                Cities =
                [
                    new HubAddressBookFilterOption { Name = "Сургут", Count = 30 },
                ],
            },
        };
        var model = new AddressBookViewModel(api);
        await model.LoadAsync();

        model.SelectedDepartmentFilter = model.DepartmentFilterOptions[1];
        await WaitFor(() => api.LastAddressBookQuery?.Department == "ИТ-отдел");
        model.SelectedCityFilter = model.CityFilterOptions[1];
        await WaitFor(() => api.LastAddressBookQuery?.City == "Сургут");

        Assert.Equal("ИТ-отдел", api.LastAddressBookQuery!.Department);
        Assert.Equal("Сургут", api.LastAddressBookQuery.City);
        Assert.True(model.HasActiveFilters);
        Assert.Equal("ИТ-отдел (12)", model.SelectedDepartmentFilterText);

        // «Сбросить» возвращает список к нефильтрованной выдаче.
        model.ClearFiltersCommand.Execute(null);
        await WaitFor(() => api.LastAddressBookQuery is { Department: null, City: null });
        Assert.False(model.HasActiveFilters);
    }

    [Fact]
    public async Task LoadMoreAppendsNextPageByOffset()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPageFactory = query => query.Offset == 0
                ? new HubAddressBookPage
                {
                    Total = 2,
                    Limit = 50,
                    Offset = 0,
                    HasMore = true,
                    Items = [Contact("Иван Петров")],
                }
                : new HubAddressBookPage
                {
                    Total = 2,
                    Limit = 50,
                    Offset = 1,
                    HasMore = false,
                    Items = [Contact("Мария Сидорова")],
                },
        };
        var model = new AddressBookViewModel(api);
        await model.LoadAsync();
        Assert.True(model.HasMore);
        Assert.Contains("1", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("Мария Сидорова", model.Items[1].FullName);
        Assert.Equal(1, api.LastAddressBookQuery!.Offset);
        Assert.False(model.HasMore);
    }

    [Fact]
    public async Task ListFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            AddressBookSearchException = new HubApiException(
                HubApiErrorKind.Transport, "network down"),
        };
        var model = new AddressBookViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task FiltersFailureStillLoadsList()
    {
        // Справочник фильтров опционален: падение не должно ронять список.
        var api = new FakeHubApiClient
        {
            AddressBookFiltersException = new HubApiException(
                HubApiErrorKind.Transport, "down"),
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items = [Contact("Иван Петров")],
            },
        };
        var model = new AddressBookViewModel(api);

        await model.LoadAsync();

        Assert.Single(model.Items);
        Assert.False(model.HasBannerError);
        Assert.Single(model.DepartmentFilterOptions); // только «Все подразделения»
    }

    // ---- Карточка контакта ----

    [Fact]
    public async Task SelectingItemShowsCardWithAllFields()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items =
                [
                    new HubAddressBookItem
                    {
                        FullName = "Иван Петров",
                        Position = "Инженер",
                        Department = "ИТ-отдел",
                        DepartmentCode = "IT",
                        DepartmentLocation = "Сургут",
                        EmployeeCode = "01234",
                        MiddleName = "Сергеевич",
                        OfficeAddress = "пр. Ленина, 1",
                        OfficeRoom = "205",
                        WorkplaceNumber = "7",
                        HireDate = "2020-03-02",
                        Age = 36,
                        Inn = "860200000000",
                        WorkPhones =
                        [
                            new HubAddressBookContactValue
                            {
                                Value = "+7 922 000-11-22",
                                Normalized = "79220001122",
                                Kind = "Мобильный",
                            },
                        ],
                        PersonalPhones =
                        [
                            new HubAddressBookContactValue
                            {
                                Value = "+7 900 000-33-44",
                            },
                        ],
                        WorkEmails =
                        [
                            new HubAddressBookContactValue { Value = "ivanov@hub.local" },
                        ],
                    },
                ],
            },
        };
        var model = new AddressBookViewModel(api);
        await model.LoadAsync();
        Assert.True(model.ShowDetailPlaceholder);

        model.SelectedItem = model.Items[0];

        var entry = model.SelectedItem!;
        Assert.True(model.HasDetail);
        Assert.False(model.ShowDetailPlaceholder);
        Assert.Equal("ИП", entry.Initials);
        Assert.Equal("Инженер · 36 лет", entry.MetaText);
        Assert.Equal("+7 922 000-11-22", entry.PrimaryPhoneText);
        Assert.Equal("tel:+79220001122", entry.CallUri);
        Assert.Equal("mailto:ivanov@hub.local", entry.EmailUri);
        Assert.True(entry.CanCall);
        Assert.True(entry.CanEmail);
        // Контакты: рабочий с kind из ЗУП (локализованная короткая метка), личный — с подписью секции.
        Assert.Equal(2, entry.Phones.Count);
        Assert.Equal("моб.: +7 922 000-11-22", entry.Phones[0].DisplayText);
        Assert.Equal("Личный: +7 900 000-33-44", entry.Phones[1].DisplayText);
        Assert.Equal("Рабочий e-mail: ivanov@hub.local", entry.Emails[0].DisplayText);
        // Блок «Работа»: рабочее место собирается как «адрес · каб. N · рм M».
        Assert.Equal("ИТ-отдел", entry.DepartmentText);
        Assert.Equal("IT", entry.DepartmentCodeText);
        Assert.Equal("Сургут", entry.CityText);
        Assert.Equal("пр. Ленина, 1 · каб. 205 · рм 7", entry.WorkplaceText);
        Assert.Equal("01234", entry.EmployeeCodeText);
        Assert.Equal("02.03.2020", entry.HireDateText);
        Assert.True(entry.HasWorkMeta);
        // Блок «Личное» — пришёл по правам.
        Assert.Equal("Сергеевич", entry.MiddleNameText);
        Assert.Equal("36 лет", entry.AgeText);
        Assert.Equal("860200000000", entry.InnText);
        Assert.True(entry.HasPersonalMeta);
    }

    [Fact]
    public void EntryViewModelComputesFallbacksForSparseItem()
    {
        // Минимум полей: только ФИО — без телефонов, почты и личных данных.
        var entry = new AddressBookEntryViewModel(new HubAddressBookItem
        {
            FullName = "Однофамилец",
        });

        Assert.Equal("ОД", entry.Initials);
        Assert.Equal("Должность не указана", entry.MetaText);
        Assert.False(entry.CanCall);
        Assert.False(entry.CanEmail);
        Assert.False(entry.HasContacts);
        Assert.False(entry.HasWorkMeta);
        Assert.False(entry.HasPersonalMeta);

        // Кабинет/рабочее место «0» — не выводится (как в вебе).
        var sparse = new AddressBookEntryViewModel(new HubAddressBookItem
        {
            FullName = "Иван Петров",
            OfficeAddress = "База",
            OfficeRoom = "0",
            WorkplaceNumber = "0",
            WorkPhones =
            [
                new HubAddressBookContactValue { Value = "8 (922) 100-20-30" },
            ],
        });
        Assert.Equal("База", sparse.WorkplaceText);
        // 8XXXXXXXXXX → +7… как normalizePhoneDigits в вебе.
        Assert.Equal("tel:+79221002030", sparse.CallUri);
    }

    [Fact]
    public async Task EntryWithPhotoUrlLoadsPhotoThroughLoader()
    {
        // photo_url → авторизованный /address-book/photos/{code}: контент качаем
        // через DownloadImageAsync, аватар переключается с инициалов на снимок.
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items =
                [
                    new HubAddressBookItem
                    {
                        FullName = "Иван Петров",
                        EmployeeCode = "001",
                        PhotoUrl = "/api/v1/address-book/photos/001",
                    },
                    new HubAddressBookItem
                    {
                        FullName = "Мария Сидорова",
                        EmployeeCode = "002",
                        // Без photo_url — запрос за фото не делаем.
                    },
                ],
            },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        var model = new AddressBookViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        var entry = model.Items[0];
        Assert.Equal("/api/v1/address-book/photos/001", entry.PhotoUrl);
        Assert.Equal("/api/v1/address-book/photos/001", Assert.Single(api.ImageDownloadCalls));
        await WaitFor(() => entry.HasPhoto);
        Assert.NotNull(entry.PhotoImage);
        Assert.False(model.Items[1].HasPhoto);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task PhotoDownloadErrorKeepsInitialsWithoutBanner()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items =
                [
                    new HubAddressBookItem
                    {
                        FullName = "Иван Петров",
                        PhotoUrl = "/api/v1/address-book/photos/001",
                    },
                ],
            },
            ImageDownloadException = new HubApiException(HubApiErrorKind.Http, "404"),
        };
        var model = new AddressBookViewModel(api);

        await model.LoadAsync();
        var entry = Assert.Single(model.Items);
        await WaitFor(() => api.ImageDownloadCalls.Count == 1);
        await Task.Delay(60); // даём конвейеру загрузки завершиться

        Assert.False(entry.HasPhoto);
        Assert.Null(entry.PhotoImage);
        Assert.Equal("ИП", entry.Initials); // фолбэк на инициалы
        Assert.False(model.HasBannerError); // фото — best-effort, список цел
    }

    [Fact]
    public async Task CallAndEmailCommandsOpenUrisThroughSeam()
    {
        var api = new FakeHubApiClient
        {
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items =
                [
                    new HubAddressBookItem
                    {
                        FullName = "Иван Петров",
                        WorkPhones =
                        [
                            new HubAddressBookContactValue { Value = "+7 922 000-11-22" },
                        ],
                        WorkEmails =
                        [
                            new HubAddressBookContactValue { Value = "ivanov@hub.local" },
                        ],
                    },
                ],
            },
        };
        var opened = new List<string>();
        var model = new AddressBookViewModel(api)
        {
            UriOpener = opened.Add,
        };
        await model.LoadAsync();
        var entry = model.Items[0];

        model.CallCommand.Execute(entry);
        model.EmailCommand.Execute(entry);

        Assert.Equal(
            new[] { "tel:+79220001122", "mailto:ivanov@hub.local" },
            opened);
    }

    // ---- Служебное ----

    /// <summary>
    /// DataTemplate страницы ленивый: XAML AddressBookView (фильтры, карточка,
    /// конвертеры) проверяем прямым рендером на STA-потоке — как у билетов.
    /// </summary>
    [Fact]
    public void AddressBookViewRendersLoadedStateOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var api = new FakeHubApiClient
                {
                    AddressBookPage = new HubAddressBookPage
                    {
                        Total = 1,
                        Items =
                        [
                            new HubAddressBookItem
                            {
                                FullName = "Иван Петров",
                                Position = "Инженер",
                                Department = "ИТ-отдел",
                                DepartmentLocation = "Сургут",
                                WorkPhones =
                                [
                                    new HubAddressBookContactValue { Value = "+7 922 000-11-22" },
                                ],
                                WorkEmails =
                                [
                                    new HubAddressBookContactValue { Value = "ivanov@hub.local" },
                                ],
                            },
                        ],
                    },
                    AddressBookFilters = new HubAddressBookFilters
                    {
                        Departments =
                        [
                            new HubAddressBookFilterOption { Name = "ИТ-отдел", Count = 1 },
                        ],
                        Cities =
                        [
                            new HubAddressBookFilterOption { Name = "Сургут", Count = 1 },
                        ],
                    },
                };
                var model = new AddressBookViewModel(api);
                model.LoadAsync().GetAwaiter().GetResult();
                model.SelectedItem = model.Items[0];

                var window = new System.Windows.Window
                {
                    Width = 1280,
                    Height = 800,
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -30000,
                    Top = -30000,
                    ShowInTaskbar = false,
                    Content = new Native.Views.AddressBookView { DataContext = model },
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
            AddressBookPage = new HubAddressBookPage
            {
                Total = 1,
                Items = [Contact("Иван Петров")],
            },
            AddressBookFilters = new HubAddressBookFilters
            {
                Departments =
                [
                    new HubAddressBookFilterOption { Name = "ИТ-отдел", Count = 1 },
                ],
            },
        };
        var gate = new TaskCompletionSource();
        var model = new AddressBookViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        model.SelectedDepartmentFilter = model.DepartmentFilterOptions[1];
        await WaitFor(() => api.LastAddressBookQuery?.Department == "ИТ-отдел");

        var calls = api.AddressBookSearchCallCount;
        model.SearchText = "сидорова";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.Items);
        Assert.Null(model.SelectedItem);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Null(model.SelectedDepartmentFilter!.Value);
        Assert.Null(model.SelectedCityFilter!.Value);
        Assert.Single(model.DepartmentFilterOptions);
        Assert.False(model.HasActiveFilters);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasMore);
        Assert.Equal("Найдено 0", model.TotalText);
        // Отложенный поиск отменён — новых запросов не уходит.
        await Task.Delay(50);
        Assert.Equal(calls, api.AddressBookSearchCallCount);
    }

    private static HubAddressBookItem Contact(string fullName) =>
        new()
        {
            FullName = fullName,
            Position = "Инженер",
            Department = "ИТ-отдел",
        };

    private static async Task WaitFor(Func<bool> condition, TimeSpan? timeout = null)
    {
        var limit = timeout ?? TimeSpan.FromSeconds(3);
        var elapsed = TimeSpan.Zero;
        var step = TimeSpan.FromMilliseconds(20);
        while (elapsed < limit)
        {
            if (condition())
            {
                return;
            }

            await Task.Delay(step);
            elapsed += step;
        }

        Assert.True(condition(), "Условие не выполнено за отведённое время.");
    }
}
