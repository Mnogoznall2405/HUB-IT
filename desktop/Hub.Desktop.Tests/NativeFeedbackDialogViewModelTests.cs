using System.Net;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

/// <summary>
/// Диалог «Предложить улучшение HUB» на главной: отправка формы (POST /feedback),
/// вкладка «Мои предложения» (GET /feedback/mine), валидация и ошибки —
/// порт поведения веб-FeedbackDialog.jsx через FakeHubApiClient.
/// </summary>
public sealed class NativeFeedbackDialogViewModelTests
{
    // ---- Жизненный цикл диалога ----

    [Fact]
    public void OpenFeedbackCreatesSingleDialogAndCloseDismisses()
    {
        var model = new DashboardViewModel(new FakeHubApiClient());

        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback;
        Assert.NotNull(dialog);
        Assert.True(model.IsFeedbackOpen);
        Assert.True(dialog!.IsNewMode); // вкладка «Новая идея» — дефолт веба
        Assert.Equal("idea", dialog.SelectedCategory.Value);

        // Повторное открытие поверх видимого диалога — тот же экземпляр.
        model.OpenFeedbackCommand.Execute(null);
        Assert.Same(dialog, model.Feedback);

        dialog.CloseCommand.Execute(null);
        Assert.Null(model.Feedback);
        Assert.False(model.IsFeedbackOpen);
    }

    [Fact]
    public void ResetClosesFeedbackDialog()
    {
        var model = new DashboardViewModel(new FakeHubApiClient());
        model.OpenFeedbackCommand.Execute(null);
        Assert.True(model.IsFeedbackOpen);

        model.Reset();

        Assert.Null(model.Feedback);
        Assert.False(model.IsFeedbackOpen);
    }

    // ---- Отправка «Новой идеи» ----

    [Fact]
    public async Task SubmitPostsTrimmedDraftAndShowsSuccessStatus()
    {
        var api = new FakeHubApiClient();
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;

        dialog.SelectedCategory = dialog.CategoryOptions.First(o => o.Value == "bug");
        dialog.Title = "  Не приходит уведомление  ";
        dialog.Message = "  Вчера пропало уведомление о задаче из чата.  ";
        dialog.Section = "  Уведомления  ";

        var submitted = await dialog.SubmitAsync();

        Assert.True(submitted);
        var body = Assert.Single(api.FeedbackCreated);
        Assert.Equal("bug", body.Category);
        Assert.Equal("Не приходит уведомление", body.Title);
        Assert.Equal("Вчера пропало уведомление о задаче из чата.", body.Message);
        Assert.Equal("Уведомления", body.Section);

        // Черновик сброшен, плашка со статусом «Новое» (дефолт фейка) — как в вебе.
        Assert.True(dialog.HasSuccess);
        Assert.Contains("статус: «Новое»", dialog.SuccessText, StringComparison.Ordinal);
        Assert.Equal(string.Empty, dialog.Title);
        Assert.Equal(string.Empty, dialog.Message);
        Assert.True(model.IsFeedbackOpen); // диалог остаётся открытым, как в вебе
    }

    [Fact]
    public async Task SubmitEmptySectionSendsNullSection()
    {
        var api = new FakeHubApiClient();
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.Title = "Идея по дашборду";
        dialog.Message = "Добавить виджет со статистикой печати.";
        dialog.Section = "   ";

        var submitted = await dialog.SubmitAsync();

        Assert.True(submitted);
        Assert.Null(Assert.Single(api.FeedbackCreated).Section);
    }

    [Fact]
    public async Task SubmitValidationBlocksShortDraftWithoutRequest()
    {
        var api = new FakeHubApiClient();
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.Title = "аб";
        dialog.Message = "короткое";

        var submitted = await dialog.SubmitAsync();

        Assert.False(submitted);
        Assert.Empty(api.FeedbackCreated);
        Assert.True(dialog.HasTitleError);
        Assert.Contains("не менее 3", dialog.TitleError!, StringComparison.Ordinal);
        Assert.True(dialog.HasMessageError);
        Assert.Contains("не менее 10", dialog.MessageError!, StringComparison.Ordinal);
        Assert.True(model.IsFeedbackOpen);

        // Правка поля снимает его ошибку — как handleFieldChange веба.
        dialog.Title = "Нормальный заголовок";
        Assert.False(dialog.HasTitleError);
        Assert.True(dialog.HasMessageError);
    }

    [Fact]
    public async Task SubmitServerErrorShowsBannerAndKeepsDraft()
    {
        var api = new FakeHubApiClient
        {
            FeedbackCreateException = new HubApiException(
                HubApiErrorKind.Http, "Заголовок уже используется.", HttpStatusCode.Conflict),
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.Title = "Дубликат";
        dialog.Message = "Описание дубликата предложения.";

        var submitted = await dialog.SubmitAsync();

        Assert.False(submitted);
        Assert.True(dialog.HasError);
        // detail сервера приоритетнее общего текста — как getFeedbackErrorMessage веба.
        Assert.Equal("Заголовок уже используется.", dialog.ErrorText);
        Assert.False(dialog.IsSubmitErrorWarning);
        Assert.Equal("Дубликат", dialog.Title);
        Assert.True(model.IsFeedbackOpen);
    }

    [Fact]
    public async Task SubmitRateLimitIsWarningWithFallbackText()
    {
        var api = new FakeHubApiClient
        {
            // Ответ без тела → синтезированное сообщение клиента, работает fallback веба.
            FeedbackCreateException = new HubApiException(
                HubApiErrorKind.Http, "HTTP 429 Too Many Requests", HttpStatusCode.TooManyRequests),
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.Title = "Ещё одна идея";
        dialog.Message = "Описание шестой идеи за сутки.";

        var submitted = await dialog.SubmitAsync();

        Assert.False(submitted);
        Assert.True(dialog.HasError);
        Assert.True(dialog.IsSubmitErrorWarning); // янтарная плашка severity=warning
        Assert.Equal(
            "Достигнут дневной лимит предложений. Попробуйте завтра.",
            dialog.ErrorText);
    }

    [Fact]
    public async Task SubmitTransportErrorUsesConnectivityText()
    {
        var api = new FakeHubApiClient
        {
            FeedbackCreateException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.Title = "Идея без сети";
        dialog.Message = "Описание идеи при обрыве сети.";

        var submitted = await dialog.SubmitAsync();

        Assert.False(submitted);
        Assert.Contains("соединения", dialog.ErrorText!, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Вкладка «Мои предложения» ----

    [Fact]
    public void MineTabLoadsItemsWithStatusLabelsAndMeta()
    {
        var api = new FakeHubApiClient
        {
            MyFeedbackPage = new HubMyFeedbackPage
            {
                Total = 3,
                Items =
                [
                    new HubFeedbackSuggestion
                    {
                        Id = "fb-1",
                        Category = "idea",
                        Title = "Тёмная тема",
                        Message = "Хочу тёмную тему.",
                        Status = "done",
                        Section = "Настройки",
                        CreatedAt = "2026-11-10T09:30:00Z",
                        AdminNote = "Выпущено в 2.4",
                    },
                    new HubFeedbackSuggestion
                    {
                        Id = "fb-2",
                        Category = "bug",
                        Title = "Падение поиска",
                        Message = "Поиск падает на кавычках.",
                        Status = "in_progress",
                    },
                    new HubFeedbackSuggestion
                    {
                        Id = "fb-3",
                        Category = "other",
                        Title = "Вопрос",
                        Status = "new",
                    },
                ],
            },
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;

        dialog.IsMineMode = true;
        Assert.True(dialog.IsMineReady);
        Assert.Equal(1, api.MyFeedbackCallCount);

        Assert.Equal(3, dialog.MyItems.Count);
        Assert.Equal("Всего: 3", dialog.MineTotalText);
        Assert.False(dialog.HasMineOverflow);

        var done = dialog.MyItems[0];
        Assert.Equal("Сделано", done.StatusText);
        Assert.Equal("success", done.StatusTone);
        Assert.Equal("Идея", done.CategoryText);
        Assert.Contains("Идея", done.MetaText, StringComparison.Ordinal);
        Assert.Contains("Настройки", done.MetaText, StringComparison.Ordinal);
        // Дата — локальное «dd.MM.yyyy HH:mm»; граница дня зависит от часового пояса машины.
        Assert.Contains("11.2026", done.CreatedText, StringComparison.Ordinal);
        Assert.True(done.HasAdminNote);
        Assert.Equal("Выпущено в 2.4", done.AdminNoteText);

        Assert.Equal("В работе", dialog.MyItems[1].StatusText);
        Assert.Equal("warning", dialog.MyItems[1].StatusTone);
        Assert.False(dialog.MyItems[1].HasAdminNote);
        Assert.Equal("Новое", dialog.MyItems[2].StatusText);
        Assert.Equal("info", dialog.MyItems[2].StatusTone);

        // Возврат на вкладку не перезагружает уже готовый список.
        dialog.IsMineMode = false;
        dialog.IsMineMode = true;
        Assert.Equal(1, api.MyFeedbackCallCount);
    }

    [Fact]
    public void MineEmptyPageShowsEmptyState()
    {
        var api = new FakeHubApiClient
        {
            MyFeedbackPage = new HubMyFeedbackPage { Items = [], Total = 0 },
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;

        dialog.IsMineMode = true;

        Assert.True(dialog.IsMineReady);
        Assert.True(dialog.IsMineEmpty);
        Assert.False(dialog.HasMineItems);
    }

    [Fact]
    public async Task MineLoadErrorShowsBannerAndRetryRecovers()
    {
        var api = new FakeHubApiClient
        {
            MyFeedbackException = new HubApiException(
                HubApiErrorKind.Http, "feedback not ready", HttpStatusCode.ServiceUnavailable),
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;

        dialog.IsMineMode = true;

        Assert.True(dialog.HasMineError);
        Assert.False(dialog.IsMineLoading);
        Assert.Equal("feedback not ready", dialog.MineErrorText);

        // «Повторить» после восстановления сервиса.
        api.MyFeedbackException = null;
        api.MyFeedbackPage = new HubMyFeedbackPage
        {
            Total = 1,
            Items = [new HubFeedbackSuggestion { Id = "fb-9", Title = "Раз", Status = "accepted" }],
        };
        await ((NativeAsyncCommand)dialog.RefreshMineCommand).ExecuteAsync(null);

        Assert.True(dialog.IsMineReady);
        Assert.False(dialog.HasMineError);
        var item = Assert.Single(dialog.MyItems);
        Assert.Equal("Принято", item.StatusText);
        Assert.Equal("primary", item.StatusTone);
    }

    [Fact]
    public async Task SubmitAfterMineLoadedPrependsItemWithoutReload()
    {
        var api = new FakeHubApiClient
        {
            MyFeedbackPage = new HubMyFeedbackPage
            {
                Total = 1,
                Items =
                [
                    new HubFeedbackSuggestion
                    {
                        Id = "fb-old", Title = "Старое", Status = "declined",
                    },
                ],
            },
        };
        var model = new DashboardViewModel(api);
        model.OpenFeedbackCommand.Execute(null);
        var dialog = model.Feedback!;
        dialog.IsMineMode = true;
        Assert.Single(dialog.MyItems);
        var callsBefore = api.MyFeedbackCallCount;

        dialog.IsMineMode = false;
        dialog.Title = "Новая идея";
        dialog.Message = "Описание свежей идеи пользователя.";
        var submitted = await dialog.SubmitAsync();

        Assert.True(submitted);
        Assert.Equal(2, dialog.MyItems.Count);
        Assert.Equal("fb-new-1", dialog.MyItems[0].Id); // ответ POST — в начало списка
        Assert.Equal("fb-old", dialog.MyItems[1].Id);
        Assert.Equal("Всего: 2", dialog.MineTotalText);
        Assert.Equal(callsBefore, api.MyFeedbackCallCount); // без повторного GET
        Assert.Equal("Отклонено", dialog.MyItems[1].StatusText);
        Assert.Equal("error", dialog.MyItems[1].StatusTone);
    }
}
