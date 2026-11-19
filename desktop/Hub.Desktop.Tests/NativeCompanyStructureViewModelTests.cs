using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeCompanyStructureViewModelTests
{
    // ---- Дерево ----

    [Fact]
    public async Task LoadBuildsTreeAndSelectsFirstBlockLikeWeb()
    {
        // Веб по умолчанию открывает первый block корня (getCompanyRootAndBlocks).
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = new HubCompanyStructureTree
            {
                Count = 5,
                Items =
                [
                    new HubCompanyStructureNode
                    {
                        Id = "root",
                        NodeType = "root",
                        Title = "Генеральный директор",
                        PersonName = "Иванов Иван",
                        PersonPosition = "Генеральный директор",
                        Children =
                        [
                            new HubCompanyStructureNode { Id = "b1", NodeType = "block", Title = "Блок А" },
                            new HubCompanyStructureNode { Id = "b2", NodeType = "block", Title = "Блок Б" },
                        ],
                    },
                ],
            },
        };
        var model = new CompanyStructureViewModel(api);

        await model.LoadAsync();

        var root = Assert.Single(model.RootNodes);
        Assert.Equal("Генеральный директор", root.Title);
        Assert.Equal("Иванов Иван", root.SubtitleText);
        Assert.Equal(2, root.Children.Count);
        // Выбран первый блок корня, ветки до него раскрыты.
        Assert.Equal("b1", model.SelectedNode?.Id);
        Assert.True(root.IsExpanded);
        Assert.True(model.SelectedNode!.IsSelected);
        Assert.False(model.HasBannerError);
        Assert.False(api.LastCompanyStructureIncludeInactive);
        Assert.Equal(1, api.CompanyStructureTreeCallCount);
        await WaitFor(() => model.LastUpdatedText.Length > 0);
    }

    [Fact]
    public async Task NodeWithPhotoUrlLoadsLeaderPhoto()
    {
        // person_photo_url у root/deputy-карточек → авторизованный /nodes/{id}/photo.
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = new HubCompanyStructureTree
            {
                Count = 1,
                Items =
                [
                    new HubCompanyStructureNode
                    {
                        Id = "root",
                        NodeType = "root",
                        Title = "Генеральный директор",
                        PersonName = "Иванов Иван",
                        PersonPhotoUrl = "/api/v1/company-structure/nodes/root/photo?v=3",
                        Children = [new HubCompanyStructureNode { Id = "b1", NodeType = "block", Title = "Блок" }],
                    },
                ],
            },
            ImageDownloadBytes = TestImageBytes.Png1X1,
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();

        var root = Assert.Single(model.RootNodes);
        Assert.Equal("/api/v1/company-structure/nodes/root/photo?v=3", root.PhotoUrl);
        Assert.Equal(root.PhotoUrl, Assert.Single(api.ImageDownloadCalls));
        await WaitFor(() => root.HasPhoto);
        Assert.NotNull(root.PhotoImage);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task SelectNodeLoadsPeopleWithWebDefaults()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Total = 2,
                Items = [Person("Иван Петров"), Person("Мария Сидорова")],
            },
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();

        model.SelectedNode = FindNode(model, "dep-1");
        await WaitFor(() => model.People.Count == 2 && !model.IsPeopleLoading);

        // Веб: limit=2000, include_descendants=true.
        var call = Assert.Single(api.CompanyStructurePeopleCalls);
        Assert.Equal("dep-1", call.NodeId);
        Assert.Equal(2000, call.Limit);
        Assert.True(call.IncludeDescendants);
        Assert.Equal("Иван Петров", model.People[0].FullName);
        Assert.Equal("2 человек", model.PeopleTotalText);
        Assert.Equal("Отдел продаж", model.SelectedNodeTitleText);
        Assert.False(model.IsPeopleEmpty);
    }

    [Fact]
    public async Task NodeSwitchKeepsOnlyLatestPeopleResult()
    {
        // Быстрый переход между узлами: ответ первого запроса не должен затереть второй.
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeopleFactory = nodeId => new HubCompanyStructurePeople
            {
                Total = 1,
                Items = [Person("Человек " + nodeId)],
            },
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);
        model.People.Clear();

        model.SelectedNode = FindNode(model, "dep-1");
        model.SelectedNode = FindNode(model, "dep-2");
        await WaitFor(() => model.People.Count == 1 && !model.IsPeopleLoading);

        Assert.Equal("dep-2", model.SelectedNode?.Id);
        Assert.Equal("Человек dep-2", model.People[0].FullName);
    }

    [Fact]
    public async Task PeopleEmptyShowsEmptyStateText()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeople = new HubCompanyStructurePeople { Total = 0, Items = [] },
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);

        Assert.True(model.IsPeopleEmpty);
        Assert.Equal(string.Empty, model.PeopleTotalText);
    }

    // ---- Карточка сотрудника ----

    [Fact]
    public async Task SelectingPersonShowsCardWithContacts()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Total = 1,
                Items =
                [
                    new HubCompanyStructurePerson
                    {
                        FullName = "Иван Петров",
                        Position = "Инженер",
                        Department = "ИТ-отдел",
                        DepartmentLocation = "Сургут",
                        WorkPhones = ["+7 922 000-11-22", "8 (343) 100-20-30"],
                        WorkEmails = ["ivanov@hub.local"],
                    },
                ],
            },
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => model.People.Count == 1);
        Assert.True(model.ShowPersonPlaceholder);

        model.SelectedPerson = model.People[0];

        var person = model.SelectedPerson!;
        Assert.True(model.HasPersonDetail);
        Assert.False(model.ShowPersonPlaceholder);
        Assert.Equal("ИП", person.Initials);
        Assert.Equal("Инженер · ИТ-отдел", person.Subtitle);
        Assert.Equal("+7 922 000-11-22", person.PrimaryPhoneText);
        // tel: как в вебе — из номера остаются только цифры и '+'.
        Assert.Equal("tel:+79220001122", person.CallUri);
        Assert.Equal("mailto:ivanov@hub.local", person.EmailUri);
        Assert.True(person.CanCall);
        Assert.True(person.CanEmail);
        Assert.Equal(2, person.Phones.Count);
        Assert.Single(person.Emails);
        Assert.Equal("ИТ-отдел", person.DepartmentText);
        Assert.Equal("Сургут", person.LocationText);
        Assert.True(person.HasContacts);
        Assert.True(person.HasWorkMeta);
    }

    [Fact]
    public void PersonViewModelComputesFallbacksForSparseItem()
    {
        var person = new CompanyStructurePersonViewModel(new HubCompanyStructurePerson
        {
            FullName = "Однофамилец",
        });

        Assert.Equal("ОД", person.Initials);
        Assert.Equal(string.Empty, person.Subtitle);
        Assert.False(person.CanCall);
        Assert.False(person.CanEmail);
        Assert.False(person.HasContacts);
        Assert.False(person.HasWorkMeta);
    }

    [Fact]
    public async Task CallAndEmailCommandsOpenUrisThroughSeam()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Total = 1,
                Items =
                [
                    new HubCompanyStructurePerson
                    {
                        FullName = "Иван Петров",
                        WorkPhones = ["+7 922 000-11-22"],
                        WorkEmails = ["ivanov@hub.local"],
                    },
                ],
            },
        };
        var opened = new List<string>();
        var model = new CompanyStructureViewModel(api) { UriOpener = opened.Add };
        await model.LoadAsync();
        await WaitFor(() => model.People.Count == 1);
        var person = model.People[0];

        model.CallCommand.Execute(person);
        model.EmailCommand.Execute(person);

        Assert.Equal(new[] { "tel:+79220001122", "mailto:ivanov@hub.local" }, opened);
    }

    // ---- Поиск ----

    [Fact]
    public async Task SearchGoesToServerAndOpensPopup()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructureSearch = new HubCompanyStructureSearchResult
            {
                Total = 1,
                Limit = 30,
                Items =
                [
                    new HubCompanyStructureSearchItem
                    {
                        Kind = "node",
                        NodeId = "dep-2",
                        Title = "Склад",
                        Path =
                        [
                            new HubCompanyStructurePathItem { Id = "root", Title = "Компания" },
                            new HubCompanyStructurePathItem { Id = "dep-2", Title = "Склад" },
                        ],
                    },
                ],
            },
        };
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);

        model.SearchText = "склад";
        await WaitFor(() => model.SearchResults.Count == 1);

        Assert.True(model.IsSearchPopupOpen);
        var call = Assert.Single(api.CompanyStructureSearchCalls);
        Assert.Equal("склад", call.Query);
        Assert.Equal(30, call.Limit);
        var item = model.SearchResults[0];
        Assert.False(item.IsPerson);
        Assert.Equal("Подразделение", item.SubtitleText);
        Assert.Equal("Компания / Склад", item.MetaText);
    }

    [Fact]
    public async Task SearchBelowMinLengthKeepsPopupClosed()
    {
        // Веб ищет от 2 символов — одиночная буква не шлёт запрос.
        var api = new FakeHubApiClient { CompanyStructureTree = Tree() };
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();

        model.SearchText = "с";
        await Task.Delay(50);

        Assert.Empty(api.CompanyStructureSearchCalls);
        Assert.False(model.IsSearchPopupOpen);
    }

    [Fact]
    public async Task SelectingNodeResultExpandsAndSelectsNode()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructureSearch = new HubCompanyStructureSearchResult
            {
                Items =
                [
                    new HubCompanyStructureSearchItem
                    {
                        Kind = "node",
                        NodeId = "dep-2",
                        Title = "Склад",
                    },
                ],
            },
            CompanyStructurePeople = new HubCompanyStructurePeople { Items = [] },
        };
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);

        model.SearchText = "склад";
        await WaitFor(() => model.SearchResults.Count == 1);
        model.SelectSearchResultCommand.Execute(model.SearchResults[0]);

        Assert.Equal("dep-2", model.SelectedNode?.Id);
        Assert.False(model.IsSearchPopupOpen);
        Assert.True(FindNode(model, "root")!.IsExpanded);
        Assert.True(FindNode(model, "dep-2")!.IsSelected);
    }

    [Fact]
    public async Task SelectingPersonResultSelectsNodeAndPerson()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructureSearch = new HubCompanyStructureSearchResult
            {
                Items =
                [
                    new HubCompanyStructureSearchItem
                    {
                        Kind = "person",
                        NodeId = "dep-1",
                        Title = "Мария Сидорова",
                        Subtitle = "Менеджер",
                    },
                ],
            },
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Total = 2,
                Items = [Person("Иван Петров"), Person("Мария Сидорова")],
            },
        };
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);

        model.SearchText = "мария";
        await WaitFor(() => model.SearchResults.Count == 1);
        model.SelectSearchResultCommand.Execute(model.SearchResults[0]);
        await WaitFor(() => model.People.Count == 2 && !model.IsPeopleLoading);

        Assert.Equal("dep-1", model.SelectedNode?.Id);
        // Человек выбран из свежей выдачи узла (pending по ФИО).
        Assert.Equal("Мария Сидорова", model.SelectedPerson?.FullName);
        Assert.True(model.HasPersonDetail);
    }

    [Fact]
    public async Task SelectingPersonWithoutNodeShowsCardDirectly()
    {
        // Сотрудник без привязки к узлу — веб показывает карточку из полей результата.
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructureSearch = new HubCompanyStructureSearchResult
            {
                Items =
                [
                    new HubCompanyStructureSearchItem
                    {
                        Kind = "person",
                        NodeId = null,
                        Title = "Внешний Сотрудник",
                        Subtitle = "Консультант",
                        Department = "Подряд",
                        DepartmentLocation = "Тюмень",
                        WorkPhones = ["+7 900 111-22-33"],
                        WorkEmails = ["ext@hub.local"],
                    },
                ],
            },
        };
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = (_, _) => Task.CompletedTask,
        };
        await model.LoadAsync();
        await WaitFor(() => !model.IsPeopleLoading);

        model.SearchText = "внешний";
        await WaitFor(() => model.SearchResults.Count == 1);
        model.SelectSearchResultCommand.Execute(model.SearchResults[0]);

        var person = model.SelectedPerson;
        Assert.NotNull(person);
        Assert.Equal("Внешний Сотрудник", person!.FullName);
        Assert.Equal("Консультант", person.PositionText);
        Assert.Equal("Подряд", person.DepartmentText);
        Assert.Equal("Тюмень", person.LocationText);
        Assert.Equal("tel:+79001112233", person.CallUri);
        Assert.Equal("mailto:ext@hub.local", person.EmailUri);
    }

    // ---- Ошибки ----

    [Fact]
    public async Task TreeFailureShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTreeException = new HubApiException(
                HubApiErrorKind.Transport, "network down"),
        };
        var model = new CompanyStructureViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task PeopleFailureShowsBannerKeepsTree()
    {
        var api = new FakeHubApiClient
        {
            CompanyStructureTree = Tree(),
            CompanyStructurePeopleException = new HubApiException(
                HubApiErrorKind.Transport, "down"),
        };
        var model = new CompanyStructureViewModel(api);
        await model.LoadAsync();
        await WaitFor(() => model.HasBannerError);

        Assert.NotEmpty(model.RootNodes);
        Assert.Contains("соединения", model.BannerErrorText!, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsPeopleEmpty);
    }

    // ---- Служебное ----

    /// <summary>DataTemplate ленивый: XAML (TreeView, popup, конвертеры) — прямой рендер на STA.</summary>
    [Fact]
    public void CompanyStructureViewRendersLoadedStateOnStaThread()
    {
        Exception? captured = null;
        using var completed = new ManualResetEventSlim();
        var thread = new Thread(() =>
        {
            try
            {
                var api = new FakeHubApiClient
                {
                    CompanyStructureTree = Tree(),
                    CompanyStructurePeople = new HubCompanyStructurePeople
                    {
                        Total = 1,
                        Items =
                        [
                            new HubCompanyStructurePerson
                            {
                                FullName = "Иван Петров",
                                Position = "Инженер",
                                Department = "ИТ-отдел",
                                WorkPhones = ["+7 922 000-11-22"],
                                WorkEmails = ["ivanov@hub.local"],
                            },
                        ],
                    },
                };
                var model = new CompanyStructureViewModel(api);
                model.LoadAsync().GetAwaiter().GetResult();
                while (model.IsPeopleLoading || model.People.Count == 0)
                {
                    Thread.Sleep(10);
                }

                model.SelectedPerson = model.People[0];

                var window = new System.Windows.Window
                {
                    Width = 1280,
                    Height = 800,
                    WindowStartupLocation = System.Windows.WindowStartupLocation.Manual,
                    Left = -30000,
                    Top = -30000,
                    ShowInTaskbar = false,
                    Content = new Native.Views.CompanyStructureView { DataContext = model },
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
            CompanyStructureTree = Tree(),
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Total = 1,
                Items = [Person("Иван Петров")],
            },
        };
        var gate = new TaskCompletionSource();
        var model = new CompanyStructureViewModel(api)
        {
            DelayAsync = async (_, ct) =>
            {
                await gate.Task;
                ct.ThrowIfCancellationRequested();
            },
        };
        await model.LoadAsync();
        await WaitFor(() => model.People.Count == 1);
        model.SelectedPerson = model.People[0];

        model.SearchText = "иван";
        model.Reset();
        gate.SetResult();

        Assert.Empty(model.RootNodes);
        Assert.Null(model.SelectedNode);
        Assert.True(model.ShowNodePlaceholder);
        Assert.Empty(model.People);
        Assert.Null(model.SelectedPerson);
        Assert.True(model.ShowPersonPlaceholder);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Empty(model.SearchResults);
        Assert.False(model.IsSearchPopupOpen);
        Assert.False(model.HasBannerError);
        Assert.Equal(string.Empty, model.PeopleTotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        // Отложенный поиск отменён — на сервер ничего не ушло.
        await Task.Delay(50);
        Assert.Empty(api.CompanyStructureSearchCalls);
        Assert.Empty(api.CompanyStructurePeopleCalls.Skip(1));
    }

    private static HubCompanyStructureTree Tree() =>
        new()
        {
            Count = 4,
            Items =
            [
                new HubCompanyStructureNode
                {
                    Id = "root",
                    NodeType = "root",
                    Title = "Компания",
                    Children =
                    [
                        new HubCompanyStructureNode
                        {
                            Id = "dep-1",
                            NodeType = "department",
                            Title = "Отдел продаж",
                            SubtreePeopleCount = 2,
                        },
                        new HubCompanyStructureNode
                        {
                            Id = "dep-2",
                            NodeType = "department",
                            Title = "Склад",
                        },
                    ],
                },
            ],
        };

    private static HubCompanyStructurePerson Person(string fullName) =>
        new()
        {
            FullName = fullName,
            Position = "Инженер",
            Department = "ИТ-отдел",
        };

    private static CompanyStructureNodeViewModel? FindNode(
        CompanyStructureViewModel model,
        string id)
    {
        var queue = new Queue<CompanyStructureNodeViewModel>(model.RootNodes);
        while (queue.Count > 0)
        {
            var node = queue.Dequeue();
            if (node.Id == id)
            {
                return node;
            }

            foreach (var child in node.Children)
            {
                queue.Enqueue(child);
            }
        }

        return null;
    }

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
