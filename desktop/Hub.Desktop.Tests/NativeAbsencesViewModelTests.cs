using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeAbsencesViewModelTests
{
    // ---- Загрузка и объединение источников ----

    [Fact]
    public async Task LoadMergesManualAndZupSortedByName()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items =
                [
                    Absence("Яковлев Ян", "hub", kind: "trip"),
                    Absence("Андреева Анна", "hub", kind: "vacation"),
                ],
                ZupItems =
                [
                    Absence("Борисов Борис", "zup", kind: "sick"),
                ],
                ZupCount = 1,
            },
        };
        var model = new AbsencesViewModel(api);

        await model.LoadAsync();

        Assert.Equal(3, model.Items.Count);
        Assert.Equal(
            ["Андреева Анна", "Борисов Борис", "Яковлев Ян"],
            model.Items.Select(i => i.DisplayName).ToArray());
        Assert.Contains("3 чел.", model.HeaderText, StringComparison.Ordinal);
        Assert.False(model.HasBannerError);
        Assert.True(model.Items[0].IsManual);
        Assert.False(model.Items[1].IsManual);
        Assert.Equal("HUB", model.Items[0].SourceText);
        Assert.Equal("ЗУП", model.Items[1].SourceText);
    }

    [Fact]
    public async Task DayModeRequestsSingleDate()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api) { SelectedDate = new DateTime(2026, 11, 16) };

        await model.LoadAsync();

        Assert.Equal("2026-11-16", api.LastAbsencesOn);
        Assert.Null(api.LastAbsencesStartsOn);
        Assert.Null(api.LastAbsencesEndsOn);
    }

    [Fact]
    public async Task WeekModeRequestsSevenDayRange()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api) { SelectedDate = new DateTime(2026, 11, 16) };

        await ((NativeAsyncCommand)model.SelectModeCommand).ExecuteAsync("week");

        Assert.True(model.IsWeekMode);
        Assert.False(model.IsDayMode);
        Assert.Null(api.LastAbsencesOn);
        Assert.Equal("2026-11-16", api.LastAbsencesStartsOn);
        Assert.Equal("2026-11-22", api.LastAbsencesEndsOn);
    }

    [Fact]
    public async Task NextDayMovesQueryDateForward()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api) { SelectedDate = new DateTime(2026, 11, 16) };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.NextDayCommand).ExecuteAsync(null);

        Assert.Equal(new DateTime(2026, 11, 17), model.SelectedDate);
        Assert.Equal("2026-11-17", api.LastAbsencesOn);
    }

    [Fact]
    public async Task PrevDayMovesQueryDateBack()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api) { SelectedDate = new DateTime(2026, 11, 16) };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.PrevDayCommand).ExecuteAsync(null);

        Assert.Equal(new DateTime(2026, 11, 15), model.SelectedDate);
        Assert.Equal("2026-11-15", api.LastAbsencesOn);
    }

    [Fact]
    public async Task TodayCommandRestoresToday()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api) { SelectedDate = new DateTime(2026, 11, 16) };
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.TodayCommand).ExecuteAsync(null);

        Assert.Equal(DateTime.Today, model.SelectedDate);
        Assert.Equal(DateTime.Today.ToString("yyyy-MM-dd"), api.LastAbsencesOn);
    }

    // ---- Форматирование строк ----

    [Theory]
    [InlineData("vacation", "Отпуск")]
    [InlineData("sick", "Больничный")]
    [InlineData("trip", "Командировка")]
    [InlineData("other", "Отсутствует")]
    [InlineData(null, "Отсутствует")]
    public void KindLabelFallsBackToKindMapping(string? kind, string expected)
    {
        var row = new AbsenceListItemViewModel(Absence("Иванов Иван", "hub", kind: kind));

        Assert.Equal(expected, row.KindLabel);
    }

    [Fact]
    public void KindLabelFromServerWinsOverMapping()
    {
        var row = new AbsenceListItemViewModel(new HubAbsenceItem
        {
            DisplayName = "Иванов Иван",
            Kind = "sick",
            KindLabel = "Отпуск по уходу",
            Source = "hub",
        });

        Assert.Equal("Отпуск по уходу", row.KindLabel);
    }

    [Fact]
    public void RangeTextCollapsesSingleDayAndFormatsSpan()
    {
        var single = new AbsenceListItemViewModel(Absence(
            "Один День", "hub", startsOn: "2026-11-16", endsOn: "2026-11-16"));
        var span = new AbsenceListItemViewModel(Absence(
            "Диапазон Дат", "hub", startsOn: "2026-11-16", endsOn: "2026-11-20"));
        var empty = new AbsenceListItemViewModel(Absence(
            "Без Дат", "hub", startsOn: null, endsOn: null));

        Assert.Equal("16.11", single.RangeText);
        Assert.Equal("16.11 — 20.11", span.RangeText);
        Assert.Equal(string.Empty, empty.RangeText);
    }

    // ---- Состояния ----

    [Fact]
    public async Task LoadFailureShowsBannerAndEmptyStaysHidden()
    {
        var api = new FakeHubApiClient
        {
            AbsencesException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new AbsencesViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsEmpty);
    }

    [Fact]
    public async Task EmptyResultShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList { Items = [], ZupItems = [] },
        };
        var model = new AbsencesViewModel(api);

        await model.LoadAsync();

        Assert.True(model.IsEmpty);
        Assert.Empty(model.Items);
    }

    [Fact]
    public void SetLoadErrorFromShellShowsBanner()
    {
        var api = new FakeHubApiClient();
        var model = new AbsencesViewModel(api);

        model.SetLoadError("Сессия истекла. Войдите заново.");

        Assert.True(model.HasBannerError);
        Assert.Equal("Сессия истекла. Войдите заново.", model.BannerErrorText);
    }

    [Fact]
    public async Task ResetClearsListAndRestoresDayMode()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Иванов Иван", "hub")],
                ZupItems = [Absence("Петрова Мария", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectModeCommand).ExecuteAsync("week");
        model.SetLoadError("boom");

        model.Reset();

        Assert.Empty(model.Items);
        Assert.False(model.HasBannerError);
        Assert.False(model.IsLoading);
        Assert.True(model.IsDayMode);
        Assert.Equal(DateTime.Today, model.SelectedDate);
        Assert.Contains("0 чел.", model.HeaderText, StringComparison.Ordinal);
    }

    // ---- Поиск и фильтр источника ----

    [Fact]
    public async Task SearchTextFiltersByNameCaseInsensitive()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items =
                [
                    Absence("Андреева Анна", "hub"),
                    Absence("Борисов Борис", "hub"),
                ],
                ZupItems = [Absence("Яковлева Яна", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.SearchText = "анна";

        Assert.Single(model.Items);
        Assert.Equal("Андреева Анна", model.Items[0].DisplayName);
        Assert.True(model.HasActiveFilter);
    }

    [Fact]
    public async Task SearchFilterAppliesToReloadedData()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems = [Absence("Борисов Борис", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();
        model.SearchText = "Борисов";

        // Поиск переживает переход по датам: применяется к каждой новой выдаче.
        await ((NativeAsyncCommand)model.NextDayCommand).ExecuteAsync(null);

        Assert.Single(model.Items);
        Assert.Equal("Борисов Борис", model.Items[0].DisplayName);
    }

    [Fact]
    public async Task SourceFilterHubShowsOnlyManualEntriesWithoutRefetch()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems = [Absence("Борисов Борис", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();
        // Если бы фильтр ходил в API повторно, выдача стала бы пустой.
        api.AbsencesList = new HubAbsenceRangeList { Items = [], ZupItems = [] };

        model.SelectSourceCommand.Execute("hub");

        Assert.Single(model.Items);
        Assert.Equal("Андреева Анна", model.Items[0].DisplayName);
        Assert.True(model.Items[0].IsManual);
        Assert.Equal("hub", model.SourceFilter);
        Assert.False(model.IsFilterAll);
        Assert.True(model.IsFilterHub);
        Assert.False(model.IsFilterZup);
    }

    [Fact]
    public async Task SourceFilterZupShowsOnlyZupEntries()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems =
                [
                    Absence("Борисов Борис", "zup"),
                    Absence("Яковлева Яна", "zup"),
                ],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.SelectSourceCommand.Execute("zup");

        Assert.Equal(2, model.Items.Count);
        Assert.All(model.Items, item => Assert.False(item.IsManual));
        Assert.True(model.IsFilterZup);
    }

    [Fact]
    public async Task SearchAndSourceFilterCombine()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items =
                [
                    Absence("Андреева Анна", "hub"),
                    Absence("Антонов Антон", "hub"),
                ],
                ZupItems = [Absence("Андреева Зупова", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.SearchText = "андреева";
        model.SelectSourceCommand.Execute("hub");

        Assert.Single(model.Items);
        Assert.Equal("Андреева Анна", model.Items[0].DisplayName);
    }

    [Fact]
    public async Task IsFilterSetterDrivesCommandForUiWriteBack()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems = [Absence("Борисов Борис", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.IsFilterZup = true;

        Assert.Equal("zup", model.SourceFilter);
        Assert.Single(model.Items);
        Assert.Equal("Борисов Борис", model.Items[0].DisplayName);
    }

    [Fact]
    public async Task FilteredEmptyShowsDistinctEmptyState()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems = [],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.SearchText = "Несуществующий";

        Assert.True(model.IsEmpty);
        Assert.Equal("Никого не найдено", model.EmptyTitleText);

        model.SearchText = string.Empty;

        Assert.False(model.IsEmpty);
        Assert.Equal("Все на месте", model.EmptyTitleText);
        Assert.Single(model.Items);
    }

    [Fact]
    public async Task HeaderShowsSliceCountWhileFiltered()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems =
                [
                    Absence("Борисов Борис", "zup"),
                    Absence("Яковлева Яна", "zup"),
                ],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();

        model.SelectSourceCommand.Execute("zup");

        Assert.Contains("2 из 3 чел.", model.HeaderText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ResetClearsSearchAndSourceFilter()
    {
        var api = new FakeHubApiClient
        {
            AbsencesList = new HubAbsenceRangeList
            {
                Items = [Absence("Андреева Анна", "hub")],
                ZupItems = [Absence("Борисов Борис", "zup")],
            },
        };
        var model = new AbsencesViewModel(api);
        await model.LoadAsync();
        model.SearchText = "Андреева";
        model.SelectSourceCommand.Execute("hub");

        model.Reset();

        Assert.Equal(string.Empty, model.SearchText);
        Assert.Equal("all", model.SourceFilter);
        Assert.True(model.IsFilterAll);
        Assert.False(model.HasActiveFilter);
        Assert.Empty(model.Items);
    }

    private static HubAbsenceItem Absence(
        string displayName,
        string? source,
        string? kind = "vacation",
        string? startsOn = "2026-11-16",
        string? endsOn = "2026-11-20") =>
        new()
        {
            Id = source == "hub" ? "42" : null,
            DisplayName = displayName,
            Kind = kind,
            StartsOn = startsOn,
            EndsOn = endsOn,
            Source = source,
        };
}
