using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeVcsViewModelTests
{
    // ---- Список терминалов ----

    [Fact]
    public async Task LoadFillsComputerList()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer
                {
                    Id = "c-1",
                    Name = "Переговорная 1",
                    IpAddress = "10.0.0.5",
                    Location = "Тюмень, 3 этаж",
                },
                new HubVcsComputer
                {
                    Id = "c-2",
                    Name = "Переговорная 2",
                    IpAddress = "vcs-02.zsgp.ru:5901",
                },
            ],
        };
        var model = new VcsViewModel(api);

        await model.LoadAsync();

        Assert.Equal(2, model.Items.Count);
        var first = model.Items[0];
        Assert.Equal("c-1", first.Id);
        Assert.Equal("Переговорная 1", first.Title);
        Assert.Equal("10.0.0.5", first.AddressText);
        Assert.Equal("Тюмень, 3 этаж", first.LocationText);
        Assert.True(first.HasLocation);
        Assert.Equal("vcs-02.zsgp.ru:5901", model.Items[1].AddressText);
        Assert.False(model.Items[1].HasLocation);
        Assert.Equal("2 терминала", model.TotalText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsEmpty);
        Assert.Equal(1, api.VcsComputersCallCount);
    }

    [Fact]
    public async Task SearchTextFiltersComputersLocally()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Переговорная", IpAddress = "10.0.0.5" },
                new HubVcsComputer
                {
                    Id = "c-2",
                    Name = "Зал совещаний",
                    IpAddress = "10.0.0.9",
                    Location = "СПб",
                },
            ],
        };
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        model.SearchText = "пере";

        Assert.Single(model.Items);
        Assert.Equal("Переговорная", model.Items[0].Title);

        // Поиск и по адресу, и по расположению.
        model.SearchText = "10.0.0.9";
        Assert.Single(model.Items);
        Assert.Equal("c-2", model.Items[0].Id);

        model.SearchText = "спб";
        Assert.Single(model.Items);
        Assert.Equal("Зал совещаний", model.Items[0].Title);

        model.SearchText = string.Empty;
        Assert.Equal(2, model.Items.Count);
        // Локальный фильтр — повторных запросов на сервер нет.
        Assert.Equal(1, api.VcsComputersCallCount);
    }

    [Fact]
    public async Task EmptyListShowsEmptyState()
    {
        var api = new FakeHubApiClient();
        var model = new VcsViewModel(api);

        await model.LoadAsync();

        Assert.Empty(model.Items);
        Assert.True(model.IsEmpty);
        Assert.Equal("0 терминалов", model.TotalText);
    }

    [Fact]
    public async Task LoadErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            VcsComputersException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var model = new VcsViewModel(api);

        await ((NativeAsyncCommand)model.RefreshCommand).ExecuteAsync(null);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.True(model.HasBannerError);

        model.DismissBannerCommand.Execute(null);
        Assert.False(model.HasBannerError);
    }

    // ---- Подключение ----

    [Fact]
    public async Task ConnectLaunchesWebLikeVncUri()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Переговорная", IpAddress = "10.0.0.5" },
            ],
            VcsLaunchToken = new HubVcsLaunchToken { Token = "tok-abc", ExpiresInSeconds = 60 },
        };
        var launched = new List<string>();
        var model = new VcsViewModel(api) { UrlLauncher = launched.Add };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ConnectCommand).ExecuteAsync(model.Items[0]);

        // Тот же URI, что строит веб-страница: launch_token + api_base (<origin>/api/v1).
        var uri = Assert.Single(launched);
        Assert.Equal(
            "vnc://10.0.0.5?launch_token=tok-abc&api_base=https%3A%2F%2Fhubit.zsgp.ru%2Fapi%2Fv1",
            uri);
        Assert.Equal(["c-1"], api.VcsLaunchTokenCalls);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ConnectNormalizesEndpointBeforeLaunch()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer
                {
                    Id = "c-1",
                    Name = "Терминал",
                    IpAddress = "  vnc://VCS-01.ZSGP.RU:5901  ",
                },
            ],
        };
        var launched = new List<string>();
        var model = new VcsViewModel(api) { UrlLauncher = launched.Add };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ConnectCommand).ExecuteAsync(model.Items[0]);

        var uri = Assert.Single(launched);
        Assert.StartsWith("vnc://vcs-01.zsgp.ru:5901?", uri, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ConnectWithInvalidAddressShowsBannerWithoutCalls()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Терминал", IpAddress = "http://bad/" },
            ],
        };
        var launched = new List<string>();
        var model = new VcsViewModel(api) { UrlLauncher = launched.Add };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ConnectCommand).ExecuteAsync(model.Items[0]);

        Assert.Equal(
            "Некорректный адрес VNC. Исправьте адрес терминала и повторите попытку.",
            model.BannerErrorText);
        Assert.Empty(api.VcsLaunchTokenCalls);
        Assert.Empty(launched);
    }

    [Fact]
    public async Task ConnectTokenErrorShowsBanner()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Терминал", IpAddress = "10.0.0.5" },
            ],
            VcsLaunchTokenException = new HubApiException(
                HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden),
        };
        var launched = new List<string>();
        var model = new VcsViewModel(api) { UrlLauncher = launched.Add };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.ConnectCommand).ExecuteAsync(model.Items[0]);

        Assert.Equal("Недостаточно прав для этого действия.", model.BannerErrorText);
        Assert.Empty(launched);
    }

    [Fact]
    public async Task ConnectCommandIgnoresForeignParameter()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer { Id = "c-1", Name = "Терминал", IpAddress = "10.0.0.5" },
            ],
        };
        var launched = new List<string>();
        var model = new VcsViewModel(api) { UrlLauncher = launched.Add };
        await model.LoadAsync();

        // CanExecute отсекает параметр не-терминал — Execute безопасно ничего не делает.
        Assert.False(model.ConnectCommand.CanExecute("не терминал"));
        Assert.False(model.ConnectCommand.CanExecute(null));
        await ((NativeAsyncCommand)model.ConnectCommand).ExecuteAsync(null);
        Assert.Empty(api.VcsLaunchTokenCalls);
        Assert.Empty(launched);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsState()
    {
        var api = new FakeHubApiClient
        {
            VcsComputers =
            [
                new HubVcsComputer
                {
                    Id = "c-1",
                    Name = "Переговорная",
                    IpAddress = "10.0.0.5",
                    Location = "Тюмень",
                },
            ],
        };
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        model.SearchText = "пере";

        model.Reset();

        Assert.Empty(model.Items);
        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal(string.Empty, model.TotalText);
        Assert.Equal(string.Empty, model.LastUpdatedText);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.True(model.IsEmpty);
    }

    // ---- Гейт vcs.manage (fail-closed по /auth/me) ----

    [Fact]
    public async Task ManagePermissionEnablesManageUi()
    {
        var api = ManageApi(
            permissions: ["vcs.read", "vcs.manage"],
            role: "operator");
        var model = new VcsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.CanManageVcs);
        Assert.True(model.OpenCreateCommand.CanExecute(null));
        Assert.True(model.EditComputerCommand.CanExecute(model.Items[0]));
        Assert.True(model.DeleteComputerCommand.CanExecute(model.Items[0]));
        Assert.True(model.OpenConfigCommand.CanExecute(null));
        Assert.True(model.OpenInfoCommand.CanExecute(null));
    }

    [Fact]
    public async Task AdminRoleEnablesManageUi()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);

        await model.LoadAsync();

        Assert.True(model.CanManageVcs);
    }

    [Fact]
    public async Task WithoutManagePermissionManageUiStaysClosed()
    {
        var api = ManageApi(permissions: ["vcs.read"], role: "operator");
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        Assert.False(model.CanManageVcs);
        Assert.False(model.OpenCreateCommand.CanExecute(null));
        Assert.False(model.EditComputerCommand.CanExecute(model.Items[0]));
        Assert.False(model.DeleteComputerCommand.CanExecute(model.Items[0]));
        Assert.False(model.MoveComputerUpCommand.CanExecute(model.Items[0]));
        Assert.False(model.MoveComputerDownCommand.CanExecute(model.Items[0]));
        Assert.False(model.OpenConfigCommand.CanExecute(null));
        Assert.False(model.OpenInfoCommand.CanExecute(null));
    }

    [Fact]
    public async Task AuthMeFailureKeepsManageClosedButListLoads()
    {
        var api = ManageApi(role: "admin");
        api.CurrentUserException = new HubApiException(
            HubApiErrorKind.Transport, "offline");
        var model = new VcsViewModel(api);

        await model.LoadAsync();

        Assert.False(model.CanManageVcs);
        Assert.Equal(2, model.Items.Count);
        Assert.False(model.HasBannerError);
    }

    // ---- Добавление / правка ----

    [Fact]
    public async Task AddComputerOpensEditorCreatesAndReloads()
    {
        var api = ManageApi(role: "admin");
        api.VcsComputerWriteFactory = (id, input) =>
        {
            var created = new HubVcsComputer
            {
                Id = "c-9",
                Name = input.Name,
                IpAddress = input.IpAddress,
                Location = input.Location,
            };
            api.VcsComputers = [.. api.VcsComputers, created];
            return created;
        };
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);

        var editor = model.Editor;
        Assert.NotNull(editor);
        Assert.True(model.IsEditorOpen);
        Assert.True(editor!.IsCreateMode);
        Assert.Equal("Добавить терминал ВКС", editor.TitleText);

        editor.Name = "Переговорная 3";
        editor.Address = "vnc://10.0.0.9:5901";
        editor.Location = "Тюмень";

        Assert.True(await editor.SubmitAsync());

        var (id, input) = Assert.Single(api.VcsComputerWriteCalls);
        Assert.Null(id); // create: без id — POST /vcs/computers
        Assert.Equal("Переговорная 3", input.Name);
        Assert.Equal("10.0.0.9:5901", input.IpAddress); // vnc:// срезан нормализацией
        Assert.Equal("Тюмень", input.Location);
        Assert.Null(model.Editor);
        Assert.False(model.IsEditorOpen);
        // Как веб fetchComputers: список перечитан, новый терминал виден.
        Assert.Equal(2, api.VcsComputersCallCount);
        Assert.Equal(3, model.Items.Count);
        Assert.Equal("c-9", model.Items[2].Id);
    }

    [Fact]
    public async Task EditComputerPrefillsAndUpdates()
    {
        var api = ManageApi(role: "admin");
        api.VcsComputerWriteFactory = (id, input) =>
        {
            var updated = new HubVcsComputer
            {
                Id = id!,
                Name = input.Name,
                IpAddress = input.IpAddress,
                Location = input.Location,
            };
            api.VcsComputers = api.VcsComputers
                .Select(c => c.Id == id ? updated : c)
                .ToArray();
            return updated;
        };
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        model.EditComputerCommand.Execute(model.Items[0]);

        var editor = model.Editor;
        Assert.NotNull(editor);
        Assert.False(editor!.IsCreateMode);
        Assert.Equal("Редактировать терминал", editor.TitleText);
        Assert.Equal("Переговорная 1", editor.Name);
        Assert.Equal("10.0.0.5", editor.Address);
        Assert.Equal("Тюмень, 3 этаж", editor.Location);

        editor.Name = "Переговорная 1*";

        Assert.True(await editor.SubmitAsync());

        var (id, input) = Assert.Single(api.VcsComputerWriteCalls);
        Assert.Equal("c-1", id); // update: PUT /vcs/computers/{id}
        Assert.Equal("Переговорная 1*", input.Name);
        Assert.Equal("10.0.0.5", input.IpAddress);
        Assert.Null(model.Editor);
        Assert.Equal("Переговорная 1*", model.Items[0].Title);
    }

    [Fact]
    public async Task EditorValidationBlocksBadInputBeforeApi()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);
        var editor = model.Editor!;

        // Пустое имя.
        editor.Name = "  ";
        editor.Address = "10.0.0.9";
        Assert.False(await editor.SubmitAsync());
        Assert.Equal("Укажите наименование терминала.", editor.ErrorText);

        // Битый адрес (как alert веба).
        editor.Name = "Зал";
        editor.Address = "http://bad/";
        Assert.False(await editor.SubmitAsync());
        Assert.Equal("Некорректный IP-адрес или имя хоста.", editor.ErrorText);

        // Слишком короткий адрес для create (контракт VcsComputerCreate: 7..50).
        editor.Address = "ab";
        Assert.False(await editor.SubmitAsync());
        Assert.Equal("Адрес VNC — от 7 до 50 символов.", editor.ErrorText);

        Assert.Empty(api.VcsComputerWriteCalls);
        Assert.True(model.IsEditorOpen);

        // У правки такого ограничения нет — короткий host проходит.
        var edit = new VcsComputerEditorViewModel(
            api, new HubVcsComputer { Id = "c-1", Name = "Зал", IpAddress = "ab" });
        var request = edit.BuildRequest(out var editError);
        Assert.Null(editError);
        Assert.Equal("ab", request?.IpAddress);
    }

    [Fact]
    public async Task EditorSaveErrorKeepsDialogOpenIsolatedFromBanner()
    {
        var api = ManageApi(role: "admin");
        api.VcsComputerWriteException = new HubApiException(
            HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden);
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);
        var editor = model.Editor!;
        editor.Name = "Зал";
        editor.Address = "10.0.0.9";

        Assert.False(await editor.SubmitAsync());

        Assert.Equal("Недостаточно прав для этого действия.", editor.ErrorText);
        Assert.True(editor.HasError);
        Assert.True(model.IsEditorOpen); // диалог и поля сохранены
        Assert.Equal("Зал", editor.Name);
        Assert.False(model.HasBannerError); // ошибка изолирована в диалоге
    }

    // ---- Удаление (armed) ----

    [Fact]
    public async Task DeleteArmsThenDeletesOnSecondClick()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        var row = model.Items[0];

        var command = (NativeAsyncCommand)model.DeleteComputerCommand;
        await command.ExecuteAsync(row);

        Assert.True(row.DeleteArmed);
        Assert.Equal("Точно удалить?", row.DeleteText);
        Assert.Empty(api.VcsComputerDeleteCalls);

        await command.ExecuteAsync(row);

        Assert.Equal(["c-1"], api.VcsComputerDeleteCalls);
        Assert.False(row.DeleteArmed);
        Assert.Single(model.Items);
        Assert.Equal("1 терминал", model.TotalText);
        Assert.DoesNotContain(model.Items, item => item.Id == "c-1");
    }

    [Fact]
    public async Task DeleteArmMovesBetweenRowsAndErrorGoesToBanner()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        var command = (NativeAsyncCommand)model.DeleteComputerCommand;

        await command.ExecuteAsync(model.Items[0]);
        await command.ExecuteAsync(model.Items[1]);

        Assert.False(model.Items[0].DeleteArmed); // прежнее взведение снято
        Assert.True(model.Items[1].DeleteArmed);

        api.VcsComputerDeleteException = new HubApiException(
            HubApiErrorKind.Http, "boom", HttpStatusCode.InternalServerError);
        await command.ExecuteAsync(model.Items[1]);

        Assert.Equal(["c-2"], api.VcsComputerDeleteCalls);
        Assert.Equal("boom", model.BannerErrorText);
        Assert.Equal(2, model.Items.Count); // строка осталась при ошибке
    }

    // ---- Порядок карточек (↑/↓ вместо drag&drop) ----

    [Fact]
    public async Task MoveDownReordersOptimisticallyAndPersistsIds()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        model.MoveComputerDownCommand.Execute(model.Items[0]);
        await model.OrderSaveTail;

        // Карточка переставлена сразу (оптимистично), порядок ушёл массивом id.
        Assert.Equal(["c-2", "c-1"], model.Items.Select(item => item.Id).ToArray());
        var sent = Assert.Single(api.VcsOrderCalls);
        Assert.Equal(["c-2", "c-1"], sent);
        Assert.False(model.Items[0].CanMoveUp);
        Assert.True(model.Items[0].CanMoveDown);
        Assert.True(model.Items[1].CanMoveUp);
        Assert.False(model.Items[1].CanMoveDown);
    }

    [Fact]
    public async Task MovesDuringOrderSaveCoalesceIntoLatestSnapshot()
    {
        var api = ManageApi(role: "admin");
        var gate = new TaskCompletionSource();
        api.VcsOrderDelay = _ => gate.Task;
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        api.VcsOrderCalls.Clear();

        // Первый ход уходит в полёт и ждёт ответ; второй копится в pending.
        model.MoveComputerDownCommand.Execute(model.Items[0]); // [c-2,c-1] в полёте
        model.MoveComputerDownCommand.Execute(model.Items[0]); // Items пересобран: двигаем c-2 → [c-1,c-2]

        gate.TrySetResult();
        await model.OrderSaveTail;

        // В полёт ушло 2 запроса: первый снапшот + последний (pending склеен).
        Assert.Equal(2, api.VcsOrderCalls.Count);
        Assert.Equal(["c-2", "c-1"], api.VcsOrderCalls[0]);
        Assert.Equal(["c-1", "c-2"], api.VcsOrderCalls[1]);
    }

    [Fact]
    public async Task OrderSaveFailureRestoresServerOrderAndShowsBanner()
    {
        var api = ManageApi(role: "admin");
        api.VcsOrderException = new HubApiException(
            HubApiErrorKind.Transport, "offline");
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        model.MoveComputerDownCommand.Execute(model.Items[0]);
        await model.OrderSaveTail;

        // Откат к серверному порядку (fetchComputers веба): исходный порядок восстановлен.
        Assert.Equal(["c-1", "c-2"], model.Items.Select(item => item.Id).ToArray());
        Assert.Equal("Не удалось сохранить порядок терминалов.", model.BannerErrorText);
        Assert.Equal(2, api.VcsComputersCallCount); // список перечитан при откате
    }

    // ---- Диалог «Пароль VNC» (/vcs/config) ----

    [Fact]
    public async Task ConfigDialogLoadsStatusAndSaves()
    {
        var api = ManageApi(role: "admin");
        api.VcsConfig = new HubVcsConfig { PasswordConfigured = false };
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.OpenConfigCommand).ExecuteAsync(null);

        Assert.True(model.IsConfigDialogOpen);
        Assert.Equal(1, api.VcsConfigGetCount);
        Assert.False(model.ConfigPasswordConfigured);
        Assert.Contains("не настроен", model.ConfigStatusText);
        Assert.Equal(string.Empty, model.ConfigPasswordInput);

        model.ConfigPasswordInput = "6e4114ad4dc9c9d7";
        await ((NativeAsyncCommand)model.SaveConfigCommand).ExecuteAsync(null);

        Assert.Equal(["6e4114ad4dc9c9d7"], api.VcsConfigUpdateCalls);
        Assert.False(model.IsConfigDialogOpen);
        Assert.True(model.ConfigPasswordConfigured);
        Assert.False(model.HasConfigError);
    }

    [Fact]
    public async Task ConfigOpenErrorStaysInDialog()
    {
        var api = ManageApi(role: "admin");
        api.VcsConfigException = new HubApiException(
            HubApiErrorKind.Transport, "offline");
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.OpenConfigCommand).ExecuteAsync(null);

        Assert.True(model.IsConfigDialogOpen);
        Assert.True(model.HasConfigError);
        Assert.Equal("Нет соединения с сервером HUB. Проверьте сеть и повторите попытку.",
            model.ConfigErrorText);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ConfigSaveErrorStaysInDialog()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenConfigCommand).ExecuteAsync(null);
        api.VcsConfigUpdateException = new HubApiException(
            HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden);
        model.ConfigPasswordInput = "aabb";

        await ((NativeAsyncCommand)model.SaveConfigCommand).ExecuteAsync(null);

        Assert.True(model.IsConfigDialogOpen);
        Assert.Equal("Недостаточно прав для этого действия.", model.ConfigErrorText);
        Assert.Equal(["aabb"], api.VcsConfigUpdateCalls);
    }

    // ---- Диалог «Информация» (/vcs/info) ----

    [Fact]
    public async Task InfoDialogLoadsContentAndSaves()
    {
        var api = ManageApi(role: "admin");
        api.VcsInfo = new HubVcsInfo { Content = "[{\"agent\":\"Ростелеком\"}]" };
        var model = new VcsViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.OpenInfoCommand).ExecuteAsync(null);

        Assert.True(model.IsInfoDialogOpen);
        Assert.Equal(1, api.VcsInfoGetCount);
        Assert.Equal("[{\"agent\":\"Ростелеком\"}]", model.InfoContentInput);

        model.InfoContentInput = "Текст справочника";
        await ((NativeAsyncCommand)model.SaveInfoCommand).ExecuteAsync(null);

        Assert.Equal(["Текст справочника"], api.VcsInfoUpdateCalls);
        Assert.False(model.IsInfoDialogOpen);
        Assert.False(model.HasInfoError);
    }

    [Fact]
    public async Task InfoSaveErrorStaysInDialog()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenInfoCommand).ExecuteAsync(null);
        api.VcsInfoUpdateException = new HubApiException(
            HubApiErrorKind.Http, "forbidden", HttpStatusCode.Forbidden);

        await ((NativeAsyncCommand)model.SaveInfoCommand).ExecuteAsync(null);

        Assert.True(model.IsInfoDialogOpen);
        Assert.Equal("Недостаточно прав для этого действия.", model.InfoErrorText);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsManageState()
    {
        var api = ManageApi(role: "admin");
        var model = new VcsViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenCreateCommand).ExecuteAsync(null);
        await ((NativeAsyncCommand)model.OpenConfigCommand).ExecuteAsync(null);
        var row = model.Items[0];
        await ((NativeAsyncCommand)model.DeleteComputerCommand).ExecuteAsync(row);

        model.Reset();

        Assert.False(model.CanManageVcs);
        Assert.Null(model.Editor);
        Assert.False(model.IsConfigDialogOpen);
        Assert.False(model.IsInfoDialogOpen);
        Assert.False(row.DeleteArmed);
        // Следующая сессия заново вычислит гейт по /auth/me.
        var fresh = new VcsViewModel(api);
        Assert.False(fresh.CanManageVcs);
    }

    /// <summary>Фейк с manage-правом (role/permissions) и двумя терминалами.</summary>
    private static FakeHubApiClient ManageApi(
        IReadOnlyList<string>? permissions = null,
        string role = "admin")
    {
        return new FakeHubApiClient
        {
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "tester",
                Role = role,
                Permissions = permissions,
            },
            VcsComputers =
            [
                new HubVcsComputer
                {
                    Id = "c-1",
                    Name = "Переговорная 1",
                    IpAddress = "10.0.0.5",
                    Location = "Тюмень, 3 этаж",
                },
                new HubVcsComputer
                {
                    Id = "c-2",
                    Name = "Переговорная 2",
                    IpAddress = "10.0.0.6",
                },
            ],
        };
    }
}
