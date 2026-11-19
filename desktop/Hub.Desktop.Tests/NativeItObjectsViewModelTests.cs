using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeItObjectsViewModelTests
{
    // ---- Список и фильтры ----

    [Fact]
    public async Task LoadFillsListWithWebLikeFilters()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList
            {
                SourceDatabaseId = "ITINVENT",
                CanManage = true,
                Items =
                [
                    new HubItObject
                    {
                        ObjectRef = "ITINVENT:5",
                        Name = "АЗС Северная",
                        Owner = new HubItObjectOwner { UserId = 7, UserName = "Иванов Иван" },
                    },
                    new HubItObject
                    {
                        ObjectRef = "OBJ-HUB:9",
                        Name = "Точка без айтишника",
                        Linked = false,
                        Hidden = true,
                    },
                ],
            },
        };
        var model = new ItObjectsViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        Assert.Equal("АЗС Северная", model.Items[0].Title);
        Assert.Equal("Иванов Иван", model.Items[0].OwnerText);
        Assert.False(model.Items[0].IsOwnerMissing);
        Assert.True(model.Items[1].IsOwnerMissing);
        Assert.Equal("Айтишник не назначен", model.Items[1].OwnerText);
        Assert.True(model.Items[1].IsHidden);
        Assert.True(model.Items[1].IsUnlinked);
        Assert.Equal("2 объекта", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.True(model.ShowManageFilters);
        Assert.False(model.IsEmpty);
        // Веб вызывает list с q/mine/hidden — серверной пагинации у контракта нет.
        var call = Assert.Single(api.ItObjectsCalls);
        Assert.Equal("", call.Query);
        Assert.False(call.OnlyMine);
        Assert.False(call.Hidden);
    }

    [Fact]
    public async Task SearchTextTriggersDebouncedServerSearch()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList { Items = [] },
        };
        var model = new ItObjectsViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "  склад  ";
        await WaitFor(() => api.ItObjectsCallCount == 2);

        Assert.Equal("склад", api.ItObjectsCalls[^1].Query);
    }

    [Fact]
    public async Task StaleSearchResultDoesNotOverwriteNewerQuery()
    {
        var api = new FakeHubApiClient { ItObjectsList = new HubItObjectList { Items = [] } };
        var gate = new TaskCompletionSource();
        var model = new ItObjectsViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();

        model.SearchText = "а";
        model.SearchText = "аб";
        gate.SetResult();
        await WaitFor(() => api.ItObjectsCallCount >= 2);

        // Первая отложенная загрузка отменена — на сервер ушёл только последний запрос.
        Assert.Equal("аб", api.ItObjectsCalls[^1].Query);
        Assert.DoesNotContain(api.ItObjectsCalls, call => call.Query == "а");
    }

    [Fact]
    public async Task MineAndHiddenTogglesReloadWithContractParams()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList { CanManage = true, Items = [] },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.OnlyMine = true;
        await WaitFor(() => api.ItObjectsCallCount == 2);
        Assert.Equal("", api.ItObjectsCalls[^1].Query);
        Assert.True(api.ItObjectsCalls[^1].OnlyMine);

        model.ShowHidden = true;
        await WaitFor(() => api.ItObjectsCallCount == 3);
        Assert.True(api.ItObjectsCalls[^1].Hidden);
        Assert.True(api.ItObjectsCalls[^1].OnlyMine);
    }

    [Fact]
    public async Task ManageFiltersHiddenForRegularUser()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList { CanManage = false, Items = [] },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        Assert.False(model.CanManage);
        Assert.False(model.ShowManageFilters);
    }

    // ---- «Показать ещё»: локальная порционная выдача полного ответа ----

    [Fact]
    public async Task ShowMoreRevealsNextPortionOfLoadedList()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList
            {
                Items = Enumerable.Range(1, 120)
                    .Select(i => new HubItObject { ObjectRef = $"ITINVENT:{i}", Name = $"Объект {i:D3}" })
                    .ToArray(),
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        Assert.Equal(50, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (70)", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);
        Assert.Equal(100, model.Items.Count);
        Assert.True(model.HasMore);
        Assert.Equal("Показать ещё (20)", model.MoreButtonText);

        await ((NativeAsyncCommand)model.LoadMoreCommand).ExecuteAsync(null);
        Assert.Equal(120, model.Items.Count);
        Assert.False(model.HasMore);
        // Второй страницы у сервера не было — один вызов list.
        Assert.Equal(1, api.ItObjectsCallCount);
    }

    // ---- Карточка объекта ----

    [Fact]
    public async Task SelectingObjectLoadsDetailWithOwnerTeamAndAccess()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectComputersPage = new HubItObjectComputersPage
            {
                Items =
                [
                    new HubItObjectComputer
                    {
                        Hostname = "WS-01",
                        Status = "online",
                        UserFullName = "Петров Пётр",
                        IpPrimary = "10.0.0.5",
                        InventoryInvNo = "100234",
                        InventoryModelName = "ThinkCentre M70",
                    },
                    new HubItObjectComputer { Hostname = "WS-02", Status = "stale" },
                ],
            },
            ItObjectInventoryPage = new HubItObjectInventoryPage
            {
                Total = 47,
                Page = 1,
                Limit = 20,
                Pages = 3,
                Items =
                [
                    new HubItObjectInventoryItem
                    {
                        InvNo = "100234",
                        TypeName = "Компьютер",
                        ModelName = "ThinkCentre M70",
                        EmployeeName = "Петров Пётр",
                        Status = "В работе",
                    },
                ],
            },
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets =
                [
                    new HubItObjectMonitoringTarget
                    {
                        Id = "t-3",
                        Name = "SW-Core",
                        Address = "10.0.0.1",
                        Enabled = true,
                        Current = new HubItObjectMonitoringCurrent
                        {
                            Status = "online",
                            CheckedAt = DateTimeOffset.UtcNow.ToString("O"),
                            SnmpStatus = "ok",
                            OpenEvents = 0,
                        },
                    },
                ],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        Assert.True(model.ShowDetailPlaceholder);

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("ITINVENT:5", detail.ObjectRef);
        Assert.Equal("АЗС Северная", detail.Title);
        Assert.Equal("Иванов Иван", detail.OwnerText);
        Assert.False(detail.IsHidden);
        Assert.False(detail.IsUnlinked);
        Assert.Equal("База источника: ITINVENT", detail.SourceDatabaseText);
        // my_access.sections → чипы «Раздел: Уровень» в порядке SECTION_KEYS.
        Assert.Equal(3, detail.AccessChips.Count);
        Assert.Equal("Компьютеры: Просмотр", detail.AccessChips[0]);
        Assert.Equal("Инвентарь: Управление", detail.AccessChips[1]);
        Assert.Equal("Мониторинг: Просмотр", detail.AccessChips[2]);
        // Команда: четыре фиксированные роли, назначенная — с ФИО и метаданными.
        Assert.Equal(4, detail.TeamRoles.Count);
        Assert.Equal("Менеджер ПТО", detail.TeamRoles[1].RoleLabel);
        Assert.Equal("Кузнецова Анна", detail.TeamRoles[1].PersonText);
        Assert.Equal("Инженер ПТО · ПТО · Сургут", detail.TeamRoles[1].MetaText);
        Assert.False(detail.TeamRoles[0].IsAssigned);
        Assert.True(detail.HasTeam);
        // Гранты видны владельцу/администратору.
        var grant = Assert.Single(detail.Grants);
        Assert.Equal("Сидоров Семён", grant.PersonText);
        Assert.Equal("Инвентарь", grant.SectionText);
        Assert.Equal("Управление", grant.LevelText);
        // Компьютеры — отдельным запросом раздела.
        await WaitFor(() => detail.Computers.Count == 2);
        Assert.Equal("Компьютеры объекта · 2", detail.ComputersTitleText);
        Assert.Equal("WS-01", detail.Computers[0].Hostname);
        Assert.Equal("В сети", detail.Computers[0].StatusText);
        Assert.Equal("10.0.0.5", detail.Computers[0].IpText);
        Assert.Equal("Инв. 100234 · ThinkCentre M70", detail.Computers[0].InventoryText);
        Assert.Equal("Давно не выходил", detail.Computers[1].StatusText);
        // Инвентарь — первая страница + подпись «показаны первые N».
        await WaitFor(() => detail.InventoryItems.Count == 1);
        Assert.Equal("Всего оборудования: 47 · показаны первые 1", detail.InventoryCaptionText);
        Assert.Equal("Компьютер · ThinkCentre M70", detail.InventoryItems[0].Title);
        var inventoryCall = Assert.Single(api.ItObjectInventoryCalls);
        Assert.Equal(1, inventoryCall.Page);
        Assert.Equal(20, inventoryCall.Limit);
        // Мониторинг — список целей со статусом.
        await WaitFor(() => detail.MonitoringTargets.Count == 1);
        Assert.Equal("Мониторинг · 1", detail.MonitoringTitleText);
        Assert.Equal("SW-Core", detail.MonitoringTargets[0].Title);
        Assert.Equal("В сети", detail.MonitoringTargets[0].StatusText);
        Assert.False(detail.HasPasswordsSection);
        Assert.False(detail.HasNetmapSection);
        Assert.Equal("ITINVENT:5", Assert.Single(api.ItObjectDetailCalls));
    }

    [Fact]
    public async Task OwnerDetailShowsAllSectionsChipAndSectionNotes()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                SourceDatabaseId = "ITINVENT",
                Linked = true,
                Owner = new HubItObjectOwner { UserId = 7, UserName = "Иванов Иван" },
                MyAccess = new HubItObjectAccess
                {
                    IsOwner = true,
                    Sections = new Dictionary<string, string>
                    {
                        ["passwords"] = "manage",
                        ["computers"] = "manage",
                        ["inventory"] = "manage",
                        ["monitoring"] = "manage",
                        ["netmap"] = "manage",
                    },
                },
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.Equal("Вы — айтишник объекта: все разделы", detail.AccessChips[0]);
        Assert.Equal(6, detail.AccessChips.Count);
        // «Пароли» — отметка без нативного просмотра; «Карта сети» грузит превью.
        Assert.True(detail.HasPasswordsSection);
        Assert.True(detail.HasNetmapSection);
        Assert.True(detail.HasComputersSection);
        Assert.True(detail.HasMonitoringSection);
        // Запросы разделов ушли за содержимым.
        Assert.Single(api.ItObjectComputersCalls);
        Assert.Single(api.ItObjectInventoryCalls);
        Assert.Single(api.ItObjectMonitoringCalls);
    }

    [Fact]
    public async Task UnlinkedObjectSkipsComputersAndInventorySections()
    {
        // Веб-деталь: для объекта без привязки видны только passwords/monitoring/netmap.
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList
            {
                Items = [new HubItObject { ObjectRef = "OBJ-HUB:9", Name = "Ручной", Linked = false }],
            },
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "OBJ-HUB:9",
                Name = "Ручной",
                Linked = false,
                Owner = new HubItObjectOwner { UserId = 7, UserName = "Иванов Иван" },
                MyAccess = new HubItObjectAccess
                {
                    IsOwner = true,
                    Sections = new Dictionary<string, string>
                    {
                        ["passwords"] = "manage",
                        ["computers"] = "manage",
                        ["inventory"] = "manage",
                        ["monitoring"] = "manage",
                        ["netmap"] = "manage",
                    },
                },
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.IsUnlinked);
        Assert.False(detail.HasComputersSection);
        Assert.False(detail.HasInventorySection);
        Assert.True(detail.HasMonitoringSection);
        Assert.Empty(api.ItObjectComputersCalls);
        Assert.Empty(api.ItObjectInventoryCalls);
        Assert.Single(api.ItObjectMonitoringCalls);
    }

    [Fact]
    public async Task NetmapPreviewLoadsThroughAuthImageLoader()
    {
        var api = new FakeHubApiClient
        {
            ImageDownloadBytes = TestImageBytes.Png1X1,
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["netmap"] = "manage" },
                },
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.True(model.Detail!.HasNetmapImage);
        Assert.Equal("it-objects/ITINVENT%3A5/netmap/preview", api.ImageDownloadCalls.Single());
    }

    [Fact]
    public async Task NetmapPreviewFailureKeepsFallbackHint()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["netmap"] = "manage" },
                },
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.False(model.Detail!.HasNetmapImage);
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public async Task NetmapVersionsLoadUnderPreviewWhenSectionAvailable()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["netmap"] = "manage" },
                },
            },
            ItObjectNetmapVersions = new HubItObjectNetmapVersionsResponse
            {
                ObjectRef = "ITINVENT:5",
                Items =
                [
                    // Порядок ответа намеренно не по версии: показ обязан быть desc.
                    new HubItObjectNetmapVersion { Version = 1, FileName = "first.drawio" },
                    new HubItObjectNetmapVersion
                    {
                        Version = 3,
                        FileName = "map-v3.drawio",
                        SavedAt = "2026-03-12T15:04:00+00:00",
                        SavedBy = "Иванов Иван",
                        SavedByUserId = 7,
                    },
                    new HubItObjectNetmapVersion { Version = 2 },
                ],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.NetmapVersionsLoaded);
        Assert.True(detail.HasNetmapVersions);
        Assert.Equal("Версии: 3", detail.NetmapVersionsText);
        // Сортировка version desc — новая сверху.
        Assert.Equal([3, 2, 1], detail.NetmapVersions.Select(row => row.Version).ToArray());
        var top = detail.NetmapVersions[0];
        Assert.Equal("v3", top.VersionText);
        var expectedSavedAt = new DateTimeOffset(2026, 3, 12, 15, 4, 0, TimeSpan.Zero)
            .ToLocalTime()
            .ToString("dd.MM.yyyy HH:mm");
        Assert.Equal("map-v3.drawio", top.FileNameText);
        Assert.Equal(expectedSavedAt, top.SavedAtText);
        Assert.Equal("Иванов Иван", top.SavedByText);
        Assert.Equal($"v3 · map-v3.drawio · {expectedSavedAt} · Иванов Иван", top.LineText);
        // Запрос версий ушёл по per-object маршруту (экранирование сегментов — в тестах клиента).
        Assert.Equal("ITINVENT:5", Assert.Single(api.ItObjectNetmapVersionsCalls));
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public async Task NetmapVersionsEmptyListShowsNoVersionsLabel()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["netmap"] = "manage" },
                },
            },
            ItObjectNetmapVersions = new HubItObjectNetmapVersionsResponse
            {
                ObjectRef = "ITINVENT:5",
                Items = [],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.NetmapVersionsLoaded);
        Assert.False(detail.HasNetmapVersions);
        Assert.Empty(detail.NetmapVersions);
        Assert.Equal("Версий нет", detail.NetmapVersionsText);
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public async Task NetmapVersionsFailureHidesVersionsBlock()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["netmap"] = "manage" },
                },
            },
            ItObjectNetmapVersionsException = new HttpRequestException("versions boom"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        // Тихий фолбэк: блок версий скрыт, ошибки карточки/баннера нет.
        Assert.False(detail.NetmapVersionsLoaded);
        Assert.False(detail.HasNetmapVersions);
        Assert.Empty(detail.NetmapVersions);
        Assert.Equal(string.Empty, detail.NetmapVersionsText);
        Assert.Null(model.DetailErrorText);
        Assert.False(model.HasDetailError);
        Assert.False(model.HasBannerError);
    }

    // ---- Журнал аудита паролей объекта (manage-уровень раздела «Пароли») ----

    [Fact]
    public async Task PasswordAuditLoadsWhenSectionGrantedAtManage()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["passwords"] = "manage" },
                },
            },
            ItObjectPasswordsAudit = new HubItObjectPasswordAuditResponse
            {
                ObjectRef = "ITINVENT:5",
                Items =
                [
                    new HubItObjectPasswordAuditItem
                    {
                        Id = 3,
                        EntryId = "entry-1",
                        Action = "reveal.copy",
                        ActorUserId = 11,
                        ActorUsername = "sidorov",
                        EntryLogin = "rega-admin",
                        EntryGroup = "РЭГА",
                        CreatedAt = "2026-10-28T10:00:00+00:00",
                    },
                    new HubItObjectPasswordAuditItem
                    {
                        Id = 2,
                        EntryId = "entry-1",
                        Action = "update",
                        ActorUserId = 7,
                        ActorUsername = "ivanov",
                        EntryLogin = "rega-admin",
                        CreatedAt = "2026-10-01T08:30:00+00:00",
                    },
                    new HubItObjectPasswordAuditItem
                    {
                        Id = 1,
                        EntryId = "entry-1",
                        // Незнакомое действие — как в вебе, сырым кодом.
                        Action = "import",
                        ActorUserId = 7,
                        ActorUsername = "ivanov",
                        EntryLogin = "rega-admin",
                        CreatedAt = "2026-09-30T18:15:00+00:00",
                    },
                ],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.HasPasswordsSection);
        Assert.True(detail.HasPasswordsManage);
        Assert.True(detail.PasswordAuditLoaded);
        Assert.True(detail.HasPasswordAudit);
        Assert.Equal("Журнал: кто работал с паролями объекта", detail.PasswordAuditText);
        Assert.Equal(3, detail.PasswordAuditEntries.Count);
        // Журнал запрошен по per-object маршруту с лимитом 50.
        var call = Assert.Single(api.ItObjectPasswordsAuditCalls);
        Assert.Equal("ITINVENT:5", call.ObjectRef);
        Assert.Equal(50, call.Limit);
        // Строка — формат веб-панели: «время локальное · кто действие · логин записи».
        var expectedWhen = new DateTimeOffset(2026, 10, 28, 10, 0, 0, TimeSpan.Zero)
            .ToLocalTime()
            .ToString("dd.MM.yyyy HH:mm");
        Assert.Equal(
            $"{expectedWhen} · sidorov скопировал(а) пароль · rega-admin",
            detail.PasswordAuditEntries[0].LineText);
        var expectedEditWhen = new DateTimeOffset(2026, 10, 1, 8, 30, 0, TimeSpan.Zero)
            .ToLocalTime()
            .ToString("dd.MM.yyyy HH:mm");
        Assert.Equal(
            $"{expectedEditWhen} · ivanov изменил(а) · rega-admin",
            detail.PasswordAuditEntries[1].LineText);
        Assert.EndsWith("· ivanov import · rega-admin", detail.PasswordAuditEntries[2].LineText);
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public async Task PasswordAuditSkippedWhenSectionIsViewOnly()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["passwords"] = "view" },
                },
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        // Плашка раздела есть, а запроса нет: backend отдаёт журнал только на manage.
        Assert.True(detail.HasPasswordsSection);
        Assert.False(detail.HasPasswordsManage);
        Assert.False(detail.PasswordAuditLoaded);
        Assert.False(detail.HasPasswordAudit);
        Assert.Empty(detail.PasswordAuditEntries);
        Assert.Equal(string.Empty, detail.PasswordAuditText);
        Assert.Empty(api.ItObjectPasswordsAuditCalls);
    }

    [Fact]
    public async Task PasswordAuditFailureHidesAuditBlock()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["passwords"] = "manage" },
                },
            },
            ItObjectPasswordsAuditException = new HttpRequestException("audit boom"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        // Тихий фолбэк: блок журнала скрыт, ошибки карточки/баннера нет.
        Assert.False(detail.PasswordAuditLoaded);
        Assert.False(detail.HasPasswordAudit);
        Assert.Empty(detail.PasswordAuditEntries);
        Assert.Equal(string.Empty, detail.PasswordAuditText);
        Assert.Single(api.ItObjectPasswordsAuditCalls);
        Assert.Null(model.DetailErrorText);
        Assert.False(model.HasDetailError);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task PasswordAuditEmptyListShowsNoEntriesLabel()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["passwords"] = "manage" },
                },
            },
            ItObjectPasswordsAudit = new HubItObjectPasswordAuditResponse
            {
                ObjectRef = "ITINVENT:5",
                Items = [],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.PasswordAuditLoaded);
        Assert.False(detail.HasPasswordAudit);
        Assert.Empty(detail.PasswordAuditEntries);
        Assert.Equal("Записей аудита нет", detail.PasswordAuditText);
        Assert.Single(api.ItObjectPasswordsAuditCalls);
        Assert.Null(model.DetailErrorText);
    }

    [Fact]
    public async Task ObjectSwitchKeepsOnlyLatestDetail()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetailFactory = objectRef => new HubItObjectDetail
            {
                ObjectRef = objectRef,
                Name = "Объект " + objectRef,
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        Assert.Equal("ITINVENT:6", model.Detail?.ObjectRef);
        Assert.Equal("Объект ITINVENT:6", model.Detail?.Title);
    }

    [Fact]
    public async Task ComputersSectionErrorStaysInsideCard()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectComputersException = new HttpRequestException("fail"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);

        var detail = model.Detail!;
        Assert.True(detail.HasComputersError);
        Assert.Empty(detail.Computers);
        Assert.False(model.HasBannerError);
        // Остальные разделы доезжают.
        await WaitFor(() => !detail.IsInventoryLoading && !detail.IsMonitoringLoading);
        Assert.False(detail.HasInventoryError);
        Assert.False(detail.HasMonitoringError);
    }

    // ---- Раскрытие детали компьютера объекта ----

    [Fact]
    public async Task SelectingComputerRowLoadsDetailFromPerObjectRoute()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectComputersPage = new HubItObjectComputersPage
            {
                Items =
                [
                    new HubItObjectComputer
                    {
                        MacAddress = "AA:BB:CC:00:00:01",
                        Hostname = "WS-01",
                        Status = "online",
                    },
                ],
            },
            ItObjectComputerDetail = new HubComputer
            {
                MacAddress = "AA:BB:CC:00:00:01",
                Hostname = "WS-01",
                Status = "online",
                IpPrimary = "10.0.0.5",
                CpuModel = "Intel i7-10700",
                RamGb = 16,
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.Computers.Count == 1);

        var detail = model.Detail!;
        var row = detail.Computers[0];
        Assert.Equal("AA:BB:CC:00:00:01", row.MacAddress);
        detail.SelectedComputer = row;
        await WaitFor(() => detail.ComputerDetail is not null && !detail.IsComputerDetailLoading);

        // Запрос ушёл на per-object endpoint (objectRef + mac строки).
        var call = Assert.Single(api.ItObjectComputerDetailCalls);
        Assert.Equal("ITINVENT:5", call.ObjectRef);
        Assert.Equal("AA:BB:CC:00:00:01", call.MacAddress);
        Assert.True(row.IsSelected);
        Assert.True(detail.HasSelectedComputer);
        Assert.True(detail.HasComputerDetail);
        Assert.Equal("WS-01", detail.ComputerDetail!.Title);
        Assert.Equal("Intel i7-10700", detail.ComputerDetail.CpuText);
        Assert.Equal("16 ГБ", detail.ComputerDetail.RamText);
        Assert.False(detail.HasComputerDetailError);
    }

    [Fact]
    public async Task ReselectingSameComputerRowCollapsesDetail()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectComputersPage = ComputersPage(),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.Computers.Count == 1);
        var detail = model.Detail!;
        var row = detail.Computers[0];
        detail.SelectedComputer = row;
        await WaitFor(() => detail.ComputerDetail is not null);

        // Повторный клик по той же строке сворачивает.
        detail.SelectedComputer = row;

        Assert.Null(detail.SelectedComputer);
        Assert.Null(detail.ComputerDetail);
        Assert.False(detail.HasSelectedComputer);
        Assert.False(detail.HasComputerDetail);
        Assert.False(row.IsSelected);
    }

    [Fact]
    public async Task ComputerDetailErrorStaysInsideExpandedRow()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectComputersPage = ComputersPage(),
            ItObjectComputerDetailException = new HttpRequestException("fail"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.Computers.Count == 1);
        var detail = model.Detail!;
        var row = detail.Computers[0];

        detail.SelectedComputer = row;
        await WaitFor(() => detail.ComputerDetailErrorText is not null);

        // Ошибка — в карточке детали строки, строка остаётся раскрытой.
        Assert.True(detail.HasComputerDetailError);
        Assert.Null(detail.ComputerDetail);
        Assert.True(row.IsSelected);
        Assert.False(detail.IsComputerDetailLoading);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task ObjectSwitchResetsExpandedComputerSelection()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetailFactory = objectRef => new HubItObjectDetail
            {
                ObjectRef = objectRef,
                Name = "Объект " + objectRef,
                Linked = true,
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["computers"] = "view" },
                },
            },
            ItObjectComputersPage = ComputersPage(),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.Computers.Count == 1);
        model.Detail!.SelectedComputer = model.Detail.Computers[0];
        await WaitFor(() => model.Detail.ComputerDetail is not null);

        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is { ObjectRef: "ITINVENT:6" } && !model.IsDetailLoading);

        // Новая карточка — без раскрытой строки и устаревшей детали.
        Assert.Null(model.Detail.SelectedComputer);
        Assert.Null(model.Detail.ComputerDetail);
        Assert.False(model.Detail.HasComputerDetailError);
        // Загрузка детали для первого объекта не добросилась в новую карточку.
        Assert.All(model.Detail.Computers, row => Assert.False(row.IsSelected));
    }

    private static HubItObjectComputersPage ComputersPage() => new()
    {
        Items =
        [
            new HubItObjectComputer
            {
                MacAddress = "AA:BB:CC:00:00:01",
                Hostname = "WS-01",
                Status = "online",
                UserFullName = "Петров Пётр",
                IpPrimary = "10.0.0.5",
            },
        ],
    };

    // ---- Раскрытие цели мониторинга: спарклайн задержки за 24 ч ----

    [Fact]
    public async Task SelectingMonitoringTargetLoadsLatencySparkline()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets = [MonitoringTarget()],
            },
            ItObjectMonitoringLatency = LatencyHistory(),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.MonitoringTargets.Count == 1);
        var detail = model.Detail!;
        var row = detail.MonitoringTargets[0];
        Assert.Equal("t-3", row.TargetId);

        detail.SelectedMonitoringTarget = row;
        await WaitFor(() => detail.MonitoringLatency is not null && !detail.IsMonitoringLatencyLoading);

        // Запрос ушёл на per-target endpoint (objectRef + id строки, окно 24 ч).
        var call = Assert.Single(api.ItObjectMonitoringLatencyCalls);
        Assert.Equal("ITINVENT:5", call.ObjectRef);
        Assert.Equal("t-3", call.TargetId);
        Assert.Equal(24, call.Hours);
        Assert.True(row.IsSelected);
        Assert.True(detail.HasSelectedMonitoringTarget);
        Assert.True(detail.HasMonitoringLatency);
        var latency = detail.MonitoringLatency!;
        // null-точка (недоступность) разбила линию на два сегмента: 2 + 1 точек.
        Assert.Equal(2, latency.Segments.Count);
        Assert.Equal(2, latency.Segments[0].Count);
        Assert.Single(latency.Segments[1]);
        // Нормализация в поле 100×30: x — позиция в ряду, y — latency относительно max=30.
        Assert.Equal(0, latency.Segments[0][0].X);
        Assert.Equal(20, latency.Segments[0][0].Y);
        Assert.Equal(100, latency.Segments[1][0].X);
        Assert.Equal(0, latency.Segments[1][0].Y);
        Assert.Equal("avg 20 мс · min 10 · max 30 · потери 25%", latency.SummaryText);
        Assert.False(detail.HasMonitoringLatencyError);
    }

    [Fact]
    public async Task ReselectingSameMonitoringTargetCollapsesLatency()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets = [MonitoringTarget()],
            },
            ItObjectMonitoringLatency = LatencyHistory(),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.MonitoringTargets.Count == 1);
        var detail = model.Detail!;
        var row = detail.MonitoringTargets[0];
        detail.SelectedMonitoringTarget = row;
        await WaitFor(() => detail.MonitoringLatency is not null);

        // Повторный клик по той же строке сворачивает.
        detail.SelectedMonitoringTarget = row;

        Assert.Null(detail.SelectedMonitoringTarget);
        Assert.Null(detail.MonitoringLatency);
        Assert.False(detail.HasSelectedMonitoringTarget);
        Assert.False(detail.HasMonitoringLatency);
        Assert.False(row.IsSelected);
    }

    [Fact]
    public async Task MonitoringLatencyErrorStaysInsideExpandedRow()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets = [MonitoringTarget()],
            },
            ItObjectMonitoringLatencyException = new HttpRequestException("fail"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.MonitoringTargets.Count == 1);
        var detail = model.Detail!;
        var row = detail.MonitoringTargets[0];

        detail.SelectedMonitoringTarget = row;
        await WaitFor(() => detail.MonitoringLatencyErrorText is not null);

        // Ошибка — внутри раскрытой строки, карточка и баннер живы.
        Assert.True(detail.HasMonitoringLatencyError);
        Assert.Null(detail.MonitoringLatency);
        Assert.True(row.IsSelected);
        Assert.False(detail.IsMonitoringLatencyLoading);
        Assert.False(model.HasBannerError);
        Assert.False(model.HasDetailError);
    }

    [Fact]
    public async Task MonitoringLatencyWithoutValuesShowsOnlyLoss()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetail = Detail(),
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets = [MonitoringTarget()],
            },
            ItObjectMonitoringLatency = new HubMonitoringLatencyHistory
            {
                Points =
                [
                    new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:00+00:00" },
                    new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:10+00:00" },
                ],
            },
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.MonitoringTargets.Count == 1);
        var detail = model.Detail!;

        detail.SelectedMonitoringTarget = detail.MonitoringTargets[0];
        await WaitFor(() => detail.MonitoringLatency is not null);

        // Все точки пустые: сегментов нет, сводка — только потери.
        Assert.Empty(detail.MonitoringLatency!.Segments);
        Assert.Equal("Нет данных за 24 ч · потери 100%", detail.MonitoringLatency.SummaryText);
    }

    [Fact]
    public async Task ObjectSwitchResetsExpandedMonitoringTarget()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetailFactory = objectRef => new HubItObjectDetail
            {
                ObjectRef = objectRef,
                Name = "Объект " + objectRef,
                Linked = true,
                MyAccess = new HubItObjectAccess
                {
                    Sections = new Dictionary<string, string> { ["monitoring"] = "view" },
                },
            },
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                Targets = [MonitoringTarget()],
            },
            ItObjectMonitoringLatency = LatencyHistory(),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail?.MonitoringTargets.Count == 1);
        model.Detail!.SelectedMonitoringTarget = model.Detail.MonitoringTargets[0];
        await WaitFor(() => model.Detail.MonitoringLatency is not null);

        model.SelectedItem = model.Items[1];
        await WaitFor(() => model.Detail is { ObjectRef: "ITINVENT:6" } && !model.IsDetailLoading);
        await WaitFor(() => model.Detail.MonitoringTargets.Count == 1);

        // Новая карточка — без раскрытой строки и устаревшего графика.
        Assert.Null(model.Detail.SelectedMonitoringTarget);
        Assert.Null(model.Detail.MonitoringLatency);
        Assert.False(model.Detail.HasMonitoringLatencyError);
        Assert.All(model.Detail.MonitoringTargets, row => Assert.False(row.IsSelected));
    }

    private static HubItObjectMonitoringTarget MonitoringTarget() => new()
    {
        Id = "t-3",
        Name = "SW-Core",
        Address = "10.0.0.1",
        Enabled = true,
        Current = new HubItObjectMonitoringCurrent
        {
            Status = "online",
            CheckedAt = DateTimeOffset.UtcNow.ToString("O"),
            SnmpStatus = "ok",
        },
    };

    private static HubMonitoringLatencyHistory LatencyHistory() => new()
    {
        ResolutionSeconds = 10,
        Points =
        [
            new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:00+00:00", LatencyMs = 10 },
            new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:10+00:00", LatencyMs = 20 },
            // Точка без значения — недоступность: разрыв графика + «потери».
            new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:20+00:00", QualityStatus = "missing" },
            new HubMonitoringLatencyPoint { At = "2026-03-12T10:00:30+00:00", LatencyMs = 30 },
        ],
    };

    // ---- Ошибки и сброс ----

    [Fact]
    public async Task ListErrorGoesToBannerAndShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsException = new HttpRequestException("network down"),
        };
        var model = new ItObjectsViewModel(api);

        await Assert.ThrowsAsync<HttpRequestException>(() => model.LoadAsync());
        // Шелл сам кладёт ошибку в баннер (как у остальных страниц).
        model.SetLoadError(TasksViewModel.DescribeError(new HttpRequestException("network down")));

        Assert.True(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task DetailErrorGoesToCardErrorNotBanner()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = List(),
            ItObjectDetailException = new HttpRequestException("404"),
        };
        var model = new ItObjectsViewModel(api);
        await model.LoadAsync();

        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.HasDetailError || !model.IsDetailLoading);

        Assert.True(model.HasDetailError);
        Assert.False(model.HasBannerError);
        Assert.Null(model.Detail);
    }

    [Fact]
    public async Task ResetClearsListDetailFiltersAndPendingSearch()
    {
        var api = new FakeHubApiClient
        {
            ItObjectsList = new HubItObjectList
            {
                CanManage = true,
                Items = Enumerable.Range(1, 60)
                    .Select(i => new HubItObject { ObjectRef = $"ITINVENT:{i}", Name = $"Объект {i}" })
                    .ToArray(),
            },
            ItObjectDetail = Detail(),
        };
        var gate = new TaskCompletionSource();
        var model = new ItObjectsViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        model.SelectedItem = model.Items[0];
        await WaitFor(() => model.Detail is not null && !model.IsDetailLoading);
        model.OnlyMine = true;
        await WaitFor(() => api.ItObjectsCallCount == 2);
        model.ShowHidden = true;
        await WaitFor(() => api.ItObjectsCallCount == 3);

        model.SearchText = "склад";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.Items);
        Assert.Null(model.SelectedItem);
        Assert.Null(model.Detail);
        Assert.True(model.ShowDetailPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.False(model.OnlyMine);
        Assert.False(model.ShowHidden);
        Assert.False(model.CanManage);
        Assert.False(model.ShowManageFilters);
        Assert.False(model.HasMore);
        Assert.False(model.HasBannerError);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        // Отложенный поиск отменён — новых вызовов списка нет.
        await Task.Delay(50);
        Assert.Equal(3, api.ItObjectsCallCount);
    }

    private static HubItObjectList List() => new()
    {
        SourceDatabaseId = "ITINVENT",
        CanManage = true,
        Items =
        [
            new HubItObject
            {
                ObjectRef = "ITINVENT:5",
                Name = "АЗС Северная",
                Linked = true,
                Owner = new HubItObjectOwner { UserId = 7, UserName = "Иванов Иван" },
            },
            new HubItObject
            {
                ObjectRef = "ITINVENT:6",
                Name = "АЗС Южная",
                Linked = true,
            },
        ],
    };

    private static HubItObjectDetail Detail() => new()
    {
        ObjectRef = "ITINVENT:5",
        Name = "АЗС Северная",
        SourceDatabaseId = "ITINVENT",
        Linked = true,
        Owner = new HubItObjectOwner { UserId = 7, UserName = "Иванов Иван" },
        MyAccess = new HubItObjectAccess
        {
            IsOwner = false,
            Sections = new Dictionary<string, string>
            {
                ["computers"] = "view",
                ["inventory"] = "manage",
                ["monitoring"] = "view",
            },
        },
        Team =
        [
            new HubItObjectTeamRole
            {
                RoleKey = "pto_manager",
                EmployeeCode = "Z2",
                FullName = "Кузнецова Анна",
                Position = "Инженер ПТО",
                Department = "ПТО",
                DepartmentLocation = "Сургут",
                ValidFrom = "2026-01-10T00:00:00Z",
            },
        ],
        Grants =
        [
            new HubItObjectGrant
            {
                UserId = 11,
                UserName = "Сидоров Семён",
                Section = "inventory",
                Level = "manage",
                CreatedAt = "2026-02-01T00:00:00Z",
            },
        ],
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
