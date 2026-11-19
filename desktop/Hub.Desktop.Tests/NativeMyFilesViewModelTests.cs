using System.IO;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class NativeMyFilesViewModelTests
{
    private static HubMyFileLibraryList Libraries(params HubMyFileLibrary[] items) =>
        new() { Items = items, CanManage = false };

    private static HubMyFileLibrary Library(string id, string name, string role = "edit") =>
        new()
        {
            Id = id,
            Name = name,
            MyRole = role,
            QuotaBytes = 10 * 1024 * 1024,
            UsedBytes = 1024 * 1024,
            FilesCount = 3,
            MembersCount = 2,
        };

    private static HubMyFileFolder Folder(string id, string name, int fileCount = 0) =>
        new() { Id = id, Name = name, FileCount = fileCount };

    private static HubMyFileItem File(
        string id,
        string name,
        long size = 128,
        string status = "ready") =>
        new()
        {
            Id = id,
            OriginalFileName = name,
            OriginalSizeBytes = size,
            Status = status,
            MimeType = "application/octet-stream",
            CreatedAt = new DateTimeOffset(2026, 2, 1, 10, 0, 0, TimeSpan.Zero),
        };

    private static HubMyFileListPage Page(
        IReadOnlyList<HubMyFileFolder>? folders = null,
        IReadOnlyList<HubMyFileItem>? items = null,
        IReadOnlyList<HubMyFileFolder>? breadcrumbs = null) =>
        new() { Folders = folders ?? [], Items = items ?? [], Breadcrumbs = breadcrumbs ?? [] };

    // ---- Локации и список ----

    [Fact]
    public async Task LoadListsPersonalDiskLibrariesAndContents()
    {
        var api = new FakeHubApiClient
        {
            MyFileLibraries = Libraries(Library("lib-1", "Общий диск отдела")),
            MyFilesPage = Page(
                folders: [Folder("f1", "Документы", fileCount: 2)],
                items: [File("file-1", "отчёт.pdf", size: 2048)]),
        };
        var model = new MyFilesViewModel(api);

        await model.LoadAsync();

        Assert.False(model.HasBannerError);
        Assert.Equal(2, model.Locations.Count);
        Assert.True(model.Locations[0].IsPersonal);
        Assert.Equal("Мои файлы", model.Locations[0].Name);
        Assert.Equal("lib-1", model.Locations[1].LibraryId);
        Assert.Equal("Общий диск отдела", model.Locations[1].Name);
        Assert.Equal(2, model.Items.Count);
        Assert.True(model.Items[0].IsFolder);
        Assert.Equal("отчёт.pdf", model.Items[1].Name);
        Assert.Equal("2 КБ", model.Items[1].SizeText);
        Assert.Null(api.MyFilesListCalls[0].FolderId);
        Assert.Null(api.MyFilesListCalls[0].LibraryId);
        Assert.Single(model.Breadcrumbs); // только синтетический корень
        Assert.False(model.CanGoUp);
    }

    [Fact]
    public async Task ListFailureShowsErrorBanner()
    {
        var api = new FakeHubApiClient
        {
            MyFilesListException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new MyFilesViewModel(api);

        await model.LoadAsync();

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Навигация ----

    [Fact]
    public async Task EnterFolderLoadsContentsAndBuildsBreadcrumbs()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPageFactory = (folderId, _) => folderId switch
            {
                "f1" => Page(
                    items: [File("file-1", "внутри.txt")],
                    breadcrumbs: [Folder("f1", "Документы")]),
                _ => Page(folders: [Folder("f1", "Документы")]),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();

        var folder = Assert.Single(model.Items);
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(folder);

        var row = Assert.Single(model.Items);
        Assert.Equal("внутри.txt", row.Name);
        Assert.Equal(2, model.Breadcrumbs.Count);
        Assert.Null(model.Breadcrumbs[0].FolderId);
        Assert.Equal("Мои файлы", model.Breadcrumbs[0].Name);
        Assert.Equal("f1", model.Breadcrumbs[1].FolderId);
        Assert.True(model.CanGoUp);
        Assert.Equal("f1", api.MyFilesListCalls[^1].FolderId);
        Assert.Null(api.MyFilesListCalls[^1].LibraryId);
    }

    [Fact]
    public async Task GoUpReturnsToLocationRoot()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPageFactory = (folderId, _) => folderId switch
            {
                "f1" => Page(items: [File("file-1", "внутри.txt")],
                    breadcrumbs: [Folder("f1", "Документы")]),
                _ => Page(folders: [Folder("f1", "Документы")]),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(model.Items[0]);
        Assert.True(model.CanGoUp);

        await ((NativeAsyncCommand)model.GoUpCommand).ExecuteAsync(null);

        Assert.False(model.CanGoUp);
        Assert.Null(api.MyFilesListCalls[^1].FolderId);
        Assert.Single(model.Breadcrumbs);
    }

    [Fact]
    public async Task CrumbNavigationGoesToParentFolder()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPageFactory = (folderId, _) => folderId switch
            {
                "f1" => Page(folders: [Folder("f2", "Внутренняя")],
                    breadcrumbs: [Folder("f1", "Документы")]),
                "f2" => Page(items: [File("file-1", "глубоко.txt")],
                    breadcrumbs: [Folder("f1", "Документы"), Folder("f2", "Внутренняя")]),
                _ => Page(folders: [Folder("f1", "Документы")]),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(model.Items[0]);
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(model.Items[0]);
        Assert.Equal(3, model.Breadcrumbs.Count);

        await ((NativeAsyncCommand)model.GoToCrumbCommand).ExecuteAsync(model.Breadcrumbs[1]);

        Assert.Equal("f1", api.MyFilesListCalls[^1].FolderId);
        var folder = Assert.Single(model.Items);
        Assert.Equal("Внутренняя", folder.Name);
    }

    [Fact]
    public async Task SelectLocationListsLibraryRoot()
    {
        var api = new FakeHubApiClient
        {
            MyFileLibraries = Libraries(
                Library("lib-view", "Архив (просмотр)", role: "view")),
            MyFilesPageFactory = (folderId, libraryId) => Page(
                items: libraryId == "lib-view" ? [File("lf-1", "общий.xlsx")] : []),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.SelectLocationCommand)
            .ExecuteAsync(model.Locations[1]);

        Assert.Null(api.MyFilesListCalls[^1].FolderId);
        Assert.Equal("lib-view", api.MyFilesListCalls[^1].LibraryId);
        Assert.Equal("Архив (просмотр)", model.HeaderText);
        var row = Assert.Single(model.Items);
        Assert.Equal("общий.xlsx", row.Name);
        // Роль view — только чтение: кнопки записи скрываются.
        Assert.False(model.CanWrite);
        Assert.False(model.UploadCommand.CanExecute(null));
    }

    // ---- Скачивание ----

    [Fact]
    public async Task DownloadGoesThroughFileSaverSeam()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        MyFileEntryViewModel? saved = null;
        model.FileSaver = item =>
        {
            saved = item;
            return Task.CompletedTask;
        };

        await ((NativeAsyncCommand)model.DownloadEntryCommand).ExecuteAsync(model.Items[0]);

        Assert.Same(model.Items[0], saved);
        Assert.Empty(api.MyFilesDownloadCalls); // шов заменяет весь путь скачивания
    }

    [Fact]
    public async Task NotReadyFileCannotBeOpened()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "скан.docx", status: "processing")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var saverCalled = false;
        model.FileSaver = _ =>
        {
            saverCalled = true;
            return Task.CompletedTask;
        };

        var row = Assert.Single(model.Items);
        Assert.False(row.CanOpen);
        Assert.Equal("Обрабатывается…", row.StatusText);
        Assert.False(model.OpenEntryCommand.CanExecute(row));

        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(row);
        Assert.False(saverCalled);
    }

    // ---- Загрузка ----

    [Fact]
    public async Task UploadRunsSessionChunksCompleteThenRefreshes()
    {
        var api = new FakeHubApiClient
        {
            MyFilesUploadChunkSize = 4,
            MyFilesPage = Page(items: [File("old-1", "старое.txt")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var listCallsBefore = api.MyFilesListCalls.Count;
        var bytes = new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }; // 10 байт → 3 чанка по 4
        model.FilePicker = () => ["C:\\temp\\новый.bin"];
        model.OpenUploadStream = _ => new MemoryStream(bytes, writable: false);
        model.DelayAsync = (_, _) => Task.CompletedTask;

        await ((NativeAsyncCommand)model.UploadCommand).ExecuteAsync(null);

        var request = Assert.Single(api.MyFilesUploadSessionRequests);
        Assert.Equal("новый.bin", request.FileName);
        Assert.Equal(10, request.FileSize);
        Assert.Equal(1, request.RetentionDays);
        Assert.Null(request.FolderId);
        Assert.Null(request.LibraryId);
        var sessionId = Assert.Single(api.MyFilesCompletedSessions);
        Assert.Equal(3, api.MyFilesUploadedChunks.Count);
        Assert.Equal(sessionId, api.MyFilesUploadedChunks[0].FileId);
        Assert.Equal(0, api.MyFilesUploadedChunks[0].Offset);
        Assert.Equal(4, api.MyFilesUploadedChunks[0].Data.Length);
        Assert.Equal(4, api.MyFilesUploadedChunks[1].Offset);
        Assert.Equal(8, api.MyFilesUploadedChunks[2].Offset);
        Assert.Equal(2, api.MyFilesUploadedChunks[2].Data.Length); // хвост меньше чанка
        Assert.Empty(api.MyFilesCancelledSessions);
        Assert.True(api.MyFilesListCalls.Count > listCallsBefore); // список обновлён
        Assert.False(model.IsUploading);
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task UploadIntoLibraryFolderSendsFolderAndLibraryIds()
    {
        var api = new FakeHubApiClient
        {
            MyFileLibraries = Libraries(Library("lib-1", "Общая")),
            MyFilesUploadChunkSize = 1024,
            MyFilesPageFactory = (folderId, libraryId) => (folderId, libraryId) switch
            {
                ("f9", "lib-1") => Page(
                    items: [File("inner-1", "внутри.txt")],
                    breadcrumbs: [Folder("f9", "Подпапка")]),
                (null, "lib-1") => Page(folders: [Folder("f9", "Подпапка")]),
                _ => Page(),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.SelectLocationCommand).ExecuteAsync(model.Locations[1]);
        var folder = Assert.Single(model.Items);
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(folder);
        model.FilePicker = () => ["x.bin"];
        model.OpenUploadStream = _ => new MemoryStream([1, 2, 3]);
        model.DelayAsync = (_, _) => Task.CompletedTask;

        await ((NativeAsyncCommand)model.UploadCommand).ExecuteAsync(null);

        var request = Assert.Single(api.MyFilesUploadSessionRequests);
        Assert.Equal("f9", request.FolderId);
        Assert.Equal("lib-1", request.LibraryId);
    }

    [Fact]
    public async Task ChunkFailureRetriesOnceThenCancelsSession()
    {
        var api = new FakeHubApiClient
        {
            MyFilesUploadChunkSize = 4,
            MyFilesUploadChunkException = new HubApiException(
                HubApiErrorKind.Transport, "chunk lost"),
        };
        var model = new MyFilesViewModel(api);
        var delays = 0;
        model.FilePicker = () => ["a.bin"];
        model.OpenUploadStream = _ => new MemoryStream([1, 2, 3, 4, 5]);
        model.DelayAsync = (_, _) =>
        {
            delays++;
            return Task.CompletedTask;
        };

        await ((NativeAsyncCommand)model.UploadCommand).ExecuteAsync(null);

        Assert.Equal(1, delays); // одна повторная попытка после паузы
        Assert.Equal(2, api.MyFilesUploadChunkCalls); // обе попытки одного чанка
        Assert.Empty(api.MyFilesUploadedChunks); // успешных чанков нет
        Assert.Single(api.MyFilesCancelledSessions);
        Assert.Empty(api.MyFilesCompletedSessions);
        Assert.True(model.HasBannerError);
        Assert.False(model.IsUploading);
    }

    [Fact]
    public void BuildUploadTasksSkipsCoveredRanges()
    {
        // Сессия вернула уже принятый диапазон [0,8) — качать надо только хвост.
        var tail = MyFilesViewModel.BuildUploadTasks(
            [[0, 8]], totalBytes: 12, chunkSizeBytes: 4);
        Assert.Equal([(8L, 12L)], tail);

        var gap = MyFilesViewModel.BuildUploadTasks(
            [[4, 8]], totalBytes: 12, chunkSizeBytes: 4);
        Assert.Equal([(0L, 4L), (8L, 12L)], gap);
    }

    // ---- Создание папки / переименование / удаление ----

    [Fact]
    public async Task NewFolderViaEditorCreatesAndRefreshes()
    {
        var api = new FakeHubApiClient { MyFilesPage = Page() };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var listCallsBefore = api.MyFilesListCalls.Count;

        await ((NativeAsyncCommand)model.BeginNewFolderCommand).ExecuteAsync(null);
        Assert.True(model.IsNameEditorOpen);
        Assert.Equal("Новая папка", model.NameEditorTitle);

        model.NameEditorText = "  Проекты  ";
        await ((NativeAsyncCommand)model.ConfirmNameEditorCommand).ExecuteAsync(null);

        var created = Assert.Single(api.MyFilesCreatedFolders);
        Assert.Equal("Проекты", created.Name);
        Assert.Null(created.ParentId);
        Assert.Null(created.LibraryId);
        Assert.False(model.IsNameEditorOpen);
        Assert.True(api.MyFilesListCalls.Count > listCallsBefore);
    }

    [Fact]
    public async Task RenameFileViaEditorPatchesFile()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "старое.txt")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var file = model.Items[0];

        await ((NativeAsyncCommand)model.BeginRenameCommand).ExecuteAsync(file);
        Assert.True(model.IsNameEditorOpen);
        Assert.Equal("старое.txt", model.NameEditorText);

        model.NameEditorText = "новое.txt";
        await ((NativeAsyncCommand)model.ConfirmNameEditorCommand).ExecuteAsync(null);

        Assert.Contains(("file", "file-1", "новое.txt"), api.MyFilesRenamed);
        Assert.False(model.IsNameEditorOpen);
    }

    [Fact]
    public async Task RenameFolderViaFolderPickerSeam()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(folders: [Folder("f1", "Старое имя")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        string? requested = "sentinel";
        model.FolderPicker = current =>
        {
            requested = current;
            return Task.FromResult<string?>("Новое имя");
        };

        await ((NativeAsyncCommand)model.BeginRenameCommand).ExecuteAsync(model.Items[0]);

        Assert.Equal("Старое имя", requested);
        Assert.Contains(("folder", "f1", "Новое имя"), api.MyFilesRenamed);
        Assert.False(model.IsNameEditorOpen); // шов минует встроенный редактор
    }

    [Fact]
    public async Task DeleteFileAsksConfirmationThenDeletesAndRefreshes()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "лишнее.bin")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var listCallsBefore = api.MyFilesListCalls.Count;
        string? prompt = null;
        model.ConfirmDelete = text =>
        {
            prompt = text;
            return true;
        };

        await ((NativeAsyncCommand)model.DeleteEntryCommand).ExecuteAsync(model.Items[0]);

        Assert.Contains("лишнее.bin", prompt);
        Assert.Contains(("file", "file-1"), api.MyFilesDeleted);
        Assert.True(api.MyFilesListCalls.Count > listCallsBefore);
    }

    [Fact]
    public async Task DeleteCancelledByConfirmKeepsApiUntouched()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "лишнее.bin")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        model.ConfirmDelete = _ => false;

        await ((NativeAsyncCommand)model.DeleteEntryCommand).ExecuteAsync(model.Items[0]);

        Assert.Empty(api.MyFilesDeleted);
    }

    // ---- Публичная ссылка (шаринг) ----

    [Fact]
    public async Task ShareFileCreatesLinkAndOpensPanel()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
            MyFilesShareResult = new HubMyFileShare
            {
                Token = "tok-1",
                PublicPath = "/shared-files/tok-1",
                ExpiresAt = DateTimeOffset.Now.AddDays(7),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var row = model.Items[0];

        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(row);

        // POST /my-files/{id}/share без rotate — backend вернул или создал ссылку.
        var created = Assert.Single(api.MyFilesShareCreated);
        Assert.Equal(("file", "file-1", false), created);
        Assert.True(model.IsSharePanelOpen);
        Assert.True(row.IsShared);
        // public_path — маршрут портала от origin клиента.
        Assert.Equal("https://hubit.zsgp.ru/shared-files/tok-1", model.ShareUrl);
        var link = Assert.Single(model.ShareLinks);
        Assert.Equal("Активна", link.StatusText);
        Assert.StartsWith("до ", link.ExpiresText, StringComparison.Ordinal);
        Assert.True(model.HasShareLinks);
        Assert.False(model.ShareLinkCopied);
    }

    [Fact]
    public async Task ShareFolderUsesFolderEndpointAndFolderPath()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(folders: [Folder("f1", "Документы")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(model.Items[0]);

        var created = Assert.Single(api.MyFilesShareCreated);
        Assert.Equal(("folder", "f1", false), created);
        Assert.Contains("/shared-folders/", model.ShareUrl, StringComparison.Ordinal);
        Assert.Single(model.ShareLinks);
        Assert.Equal("бессрочно", model.ShareLinks[0].ExpiresText);
    }

    [Fact]
    public async Task RotateShareIssuesNewLink()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(model.Items[0]);
        Assert.Equal("https://hubit.zsgp.ru/shared-files/file-share-1", model.ShareUrl);

        await ((NativeAsyncCommand)model.RotateShareCommand).ExecuteAsync(null);

        Assert.Equal(2, api.MyFilesShareCreated.Count);
        Assert.Equal(("file", "file-1", true), api.MyFilesShareCreated[1]);
        Assert.Equal("https://hubit.zsgp.ru/shared-files/file-share-2", model.ShareUrl);
        var link = Assert.Single(model.ShareLinks); // список заменён новой ссылкой
        Assert.Equal(model.ShareUrl, link.Url);
    }

    [Fact]
    public async Task CopyShareLinkGoesThroughClipboardSeam()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(model.Items[0]);
        string? copied = null;
        model.ClipboardSetter = text => copied = text;

        model.CopyShareLinkCommand.Execute(null);

        Assert.Equal(model.ShareUrl, copied);
        Assert.True(model.ShareLinkCopied);
        Assert.Equal("Скопировано", model.ShareCopyText);
    }

    [Fact]
    public async Task RevokeShareClearsLinkListAndRowFlag()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var row = model.Items[0];
        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(row);
        Assert.True(row.IsShared);

        await ((NativeAsyncCommand)model.RevokeShareCommand).ExecuteAsync(null);

        // DELETE /my-files/{id}/share — ссылка исчезла из списка.
        var revoked = Assert.Single(api.MyFilesShareRevoked);
        Assert.Equal(("file", "file-1"), revoked);
        Assert.Empty(model.ShareLinks);
        Assert.False(model.HasShareLinks);
        Assert.Equal(string.Empty, model.ShareUrl);
        Assert.False(row.IsShared);
        Assert.True(model.IsSharePanelOpen); // панель остаётся: можно создать новую ссылку
        Assert.False(model.HasBannerError);
    }

    [Fact]
    public async Task ShareFailureShowsBannerAndKeepsPanelClosed()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
            MyFilesShareException = new HubApiException(HubApiErrorKind.Transport, "down"),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();

        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(model.Items[0]);

        Assert.True(model.HasBannerError);
        Assert.Contains("соединения", model.BannerErrorText, StringComparison.OrdinalIgnoreCase);
        Assert.False(model.IsSharePanelOpen);
        Assert.Empty(model.ShareLinks);
        Assert.False(model.Items[0].IsShared);
    }

    [Fact]
    public async Task RevokeFailureShowsBannerAndKeepsLink()
    {
        var api = new FakeHubApiClient
        {
            MyFilesPage = Page(items: [File("file-1", "отчёт.pdf")]),
            MyFilesShareRevokeException = new HubApiException(
                HubApiErrorKind.Http, "revoke failed"),
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        var row = model.Items[0];
        await ((NativeAsyncCommand)model.BeginShareCommand).ExecuteAsync(row);

        await ((NativeAsyncCommand)model.RevokeShareCommand).ExecuteAsync(null);

        Assert.True(model.HasBannerError);
        Assert.Single(model.ShareLinks); // ссылка не отозвана — список не трогаем
        Assert.True(row.IsShared);
    }

    // ---- Сброс ----

    [Fact]
    public async Task ResetClearsNavigationAndState()
    {
        var api = new FakeHubApiClient
        {
            MyFileLibraries = Libraries(Library("lib-1", "Общая")),
            MyFilesPageFactory = (folderId, _) => folderId switch
            {
                "f1" => Page(items: [File("x", "внутри.txt")],
                    breadcrumbs: [Folder("f1", "Документы")]),
                _ => Page(folders: [Folder("f1", "Документы")]),
            },
        };
        var model = new MyFilesViewModel(api);
        await model.LoadAsync();
        await ((NativeAsyncCommand)model.OpenEntryCommand).ExecuteAsync(model.Items[0]);
        Assert.True(model.CanGoUp);
        model.SetLoadError("ошибка");

        model.Reset();

        Assert.Empty(model.Locations);
        Assert.Empty(model.Items);
        Assert.Empty(model.Breadcrumbs);
        Assert.Null(model.SelectedItem);
        Assert.Null(model.SelectedLocation);
        Assert.False(model.CanGoUp);
        Assert.False(model.IsNameEditorOpen);
        Assert.False(model.IsUploading);
        Assert.False(model.HasBannerError);
        Assert.Equal("Мои файлы", model.HeaderText);
        Assert.True(model.CanWrite);
    }
}
