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
}
