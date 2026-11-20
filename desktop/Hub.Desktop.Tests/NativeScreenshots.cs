using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Hub.Desktop.Native;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Hub.Desktop.Tests.Fakes;
using Xunit;
using Xunit.Abstractions;

namespace Hub.Desktop.Tests;

/// <summary>
/// Генератор скриншотов нативных страниц: реальное HubWindow на демо-данных
/// рендерится в PNG (desktop/screenshots/). Запуск:
/// dotnet test --filter FullyQualifiedName~NativeScreenshots
/// </summary>
[Collection("NativeTheme")]
public sealed class NativeScreenshots
{
    private readonly ITestOutputHelper _output;

    public NativeScreenshots(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void GenerateAllPages()
    {
        var outputDir = ResolveOutputDir();
        Exception? captured = null;
        var thread = new Thread(() =>
        {
            try
            {
                RenderAll(outputDir);
            }
            catch (Exception exception)
            {
                captured = exception;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();

        Assert.True(thread.Join(TimeSpan.FromMinutes(2)), "Рендер не завершился за 2 минуты.");
        Assert.Null(captured);

        foreach (var file in Directory.GetFiles(outputDir, "*.png"))
        {
            _output.WriteLine(file);
            Assert.True(new FileInfo(file).Length > 1000, $"Пустой скриншот: {file}");
        }
    }

    private static void RenderAll(string outputDir)
    {
        // Окно под реальным Application: палитра живёт в app-ресурсах (как в проде
        // и нужно для светлого прогона через NativeThemeManager.Apply), иначе
        // каждый view дозалил бы собственный тёмный fallback-словарь.
        if (Application.Current is null)
        {
            // OnExplicitShutdown как у реального App.xaml — иначе закрытие первого
            // окна гасит приложение и поздние кадры рендерятся пустыми.
            _ = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        }

        // Без Dispatcher.Run на STA-потоке нет SynchronizationContext: реально
        // асинхронные await (File.ReadAllBytesAsync и т.п.) продолжались бы на
        // потоке пула и RaiseCanExecuteChanged словил бы чужой диспетчер кнопок.
        SynchronizationContext.SetSynchronizationContext(
            new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        NativeThemeManager.Apply("dark");

        // Полное окно в состоянии Ready на демо-данных — все 5 страниц.
        var api = DemoApi();
        // Закреплённое сообщение → двухстрочная плашка закрепа над лентой.
        api.PinnedMessages.Add(new HubChatPinnedMessage
        {
            Id = "m8",
            SenderName = "Пётр Петров",
            Preview = "Согласовал бюджет на следующий год",
            CreatedAt = DateTimeOffset.Now.AddMinutes(-12).ToString("O"),
        });
        var window = new Hub.Desktop.Native.Views.HubWindow(api)
        {
            WindowStartupLocation = WindowStartupLocation.Manual,
            Left = -30000,
            Top = -30000,
            ShowInTaskbar = false,
        };
        Pump(window.ViewModel.InitializeAsync());
        window.Show();
        window.UpdateLayout();

        var vm = window.ViewModel;
        // Черновики в демо — в память: без подмены ленивый стор писал бы
        // chat-drafts.<userId>.json в реальный %LocalAppData% тест-машины.
        vm.Chat.DraftStore = new Fakes.FakeChatDraftStore();
        // Детали, чтобы мастер-деталь был заполнен на снимках.
        vm.Tasks.SelectedItem = vm.Tasks.Items.Count > 0 ? vm.Tasks.Items[0] : null;
        PumpUntil(() => vm.Tasks.Detail is not null, TimeSpan.FromSeconds(10));
        vm.News.SelectedItem = vm.News.Items.Count > 0 ? vm.News.Items[0] : null;
        PumpUntil(() => vm.News.Detail is not null, TimeSpan.FromSeconds(10));
        // Групповой диалог «Беседы» — богаче (реакции/реплаи/аватары), плюс
        // групповые панели (members/settings/join-requests) открываются только в группе.
        vm.Chat.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
        vm.Chat.SelectedConversation = vm.Chat.Conversations.Count > 0
            ? vm.Chat.Conversations[0]
            : null;
        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
        // Плитки image-вложений докачиваются после первой прокрутки в конец и
        // раздувают пузырь — дождаться превью и докрутить ленту к m8.
        PumpUntil(
            () => vm.Chat.Messages.SelectMany(m => m.AttachmentItems)
                .Where(a => a.IsImage).All(a => a.HasPreview),
            TimeSpan.FromSeconds(10));
        // Фото-аватары (avatars/*): строка диалога + аватары отправителей пузырей
        // качаются фоном через AuthImageLoader — дождаться, чтобы кадр был фиксирован.
        PumpUntil(
            () => vm.Chat.SelectedConversation?.HasAvatarImage == true
                && vm.Chat.Messages.Count(m => m.HasSenderAvatarImage) >= 5,
            TimeSpan.FromSeconds(10));
        vm.Chat.ScrollToEndCommand.Execute(null);
        window.UpdateLayout();
        // Почта: «Входящие» выбраны при загрузке — открываем первое письмо.
        vm.Mail.SelectedItem = vm.Mail.Items.Count > 0 ? vm.Mail.Items[0] : null;
        PumpUntil(() => vm.Mail.Detail is not null, TimeSpan.FromSeconds(10));
        // Документооборот: карточка первого входящего задания.
        vm.Docflow.SelectedItem = vm.Docflow.Items.Count > 0 ? vm.Docflow.Items[0] : null;
        PumpUntil(() => vm.Docflow.Detail is not null, TimeSpan.FromSeconds(10));
        // Билеты: карточка первой заявки.
        vm.Tickets.SelectedItem = vm.Tickets.Items.Count > 0 ? vm.Tickets.Items[0] : null;
        PumpUntil(() => vm.Tickets.Detail is not null, TimeSpan.FromSeconds(10));
        // Адресная книга: первая карточка (деталь синхронная, без догрузки).
        vm.AddressBook.SelectedItem = vm.AddressBook.Items.Count > 0
            ? vm.AddressBook.Items[0]
            : null;
        // Структура компании: раскрыть дерево и выбрать отдел с сотрудниками.
        ExpandStructure(vm.CompanyStructure.RootNodes);
        vm.CompanyStructure.SelectedNode = DeepestStructureNode(vm.CompanyStructure.RootNodes);
        PumpUntil(() => vm.CompanyStructure.People.Count > 0, TimeSpan.FromSeconds(10));
        vm.CompanyStructure.SelectedPerson = vm.CompanyStructure.People.Count > 0
            ? vm.CompanyStructure.People[0]
            : null;
        // ИТ-объекты: карточка с компьютерами, инвентарём, мониторингом и картой.
        vm.ItObjects.SelectedItem = vm.ItObjects.Items.Count > 0 ? vm.ItObjects.Items[0] : null;
        PumpUntil(() => vm.ItObjects.Detail is not null, TimeSpan.FromSeconds(15));
        PumpUntil(() => vm.ItObjects.Detail?.NetmapImage is not null, TimeSpan.FromSeconds(10));
        // Сети: первый филиал с устройствами и схемами.
        vm.Networks.SelectedBranch = vm.Networks.Items.Count > 0 ? vm.Networks.Items[0] : null;
        PumpUntil(() => vm.Networks.Detail is not null, TimeSpan.FromSeconds(10));
        // Компьютеры: карточка первого хоста.
        vm.Computers.SelectedItem = vm.Computers.Items.Count > 0 ? vm.Computers.Items[0] : null;
        PumpUntil(() => vm.Computers.Detail is not null, TimeSpan.FromSeconds(10));
        // База ITINVENT: серверный поиск → карточка с фото и историей.
        vm.Database.DelayAsync = (_, _) => System.Threading.Tasks.Task.CompletedTask;
        vm.Database.SearchText = "HP";
        PumpUntil(() => vm.Database.Items.Count > 0, TimeSpan.FromSeconds(10));
        vm.Database.SelectedItem = vm.Database.Items.Count > 0 ? vm.Database.Items[0] : null;
        PumpUntil(
            () => vm.Database.Detail is not null
                && vm.Database.HistoryLoaded
                && vm.Database.PhotosLoaded,
            TimeSpan.FromSeconds(15));
        // Две отмеченные строки: в кадре чекбоксы и панель «Передать выбранные (2)».
        vm.Database.Items[0].IsChecked = true;
        if (vm.Database.Items.Count > 1)
        {
            vm.Database.Items[1].IsChecked = true;
        }
        // Доступ к группам AD: карточка первой папки матрицы.
        vm.GroupsAccess.SelectedGroup = vm.GroupsAccess.MatrixGroups.Count > 0
            ? vm.GroupsAccess.MatrixGroups[0]
            : null;
        PumpUntil(() => vm.GroupsAccess.Detail is not null, TimeSpan.FromSeconds(10));
        // Мониторинг: первая цель.
        vm.Monitoring.SelectedTarget = vm.Monitoring.Items.Count > 0
            ? vm.Monitoring.Items[0]
            : null;
        PumpUntil(() => vm.Monitoring.Detail is not null, TimeSpan.FromSeconds(10));
        // Строительство: карточка первого объекта — направления, команда, заявки.
        vm.Construction.SelectedObject = vm.Construction.Items.Count > 0
            ? vm.Construction.Items[0]
            : null;
        PumpUntil(
            () => vm.Construction.Detail is not null && vm.Construction.Requests.Count > 0,
            TimeSpan.FromSeconds(10));
        // Склад 1С: остатки по текстовому фильтру + ведомость с карточкой
        // документа (кадры «Остатки» и «Ведомость»; вкладки переключаются в хуке).
        vm.Warehouse.BalancesText = "кабель";
        Pump(((NativeAsyncCommand)vm.Warehouse.SearchBalancesCommand).ExecuteAsync(null));
        vm.Warehouse.MovNomenclature.SelectExternally("nom-1", "КБЛ-01 — Кабель ВВГнг-LS 3х2,5");
        Pump(((NativeAsyncCommand)vm.Warehouse.SearchMovementsCommand).ExecuteAsync(null));
        vm.Warehouse.SelectedMovement = vm.Warehouse.Movements.Count > 0
            ? vm.Warehouse.Movements[0]
            : null;
        PumpUntil(() => vm.Warehouse.MovementDetail is not null, TimeSpan.FromSeconds(10));
        vm.Warehouse.SelectTabCommand.Execute(WarehouseViewModel.TabBalances);
        // IT-заявки на закупку: карточка первой заявки — этапы, позиции, документы.
        vm.ItRequests.SelectedRequest = vm.ItRequests.Items.Count > 0
            ? vm.ItRequests.Items[0]
            : null;
        PumpUntil(() => vm.ItRequests.Detail is not null, TimeSpan.FromSeconds(10));
        // МФУ: первое устройство с журналом печати по месяцам.
        vm.Mfu.SelectedDevice = vm.Mfu.Items
            .OfType<MfuDeviceItemViewModel>()
            .FirstOrDefault();
        PumpUntil(
            () => vm.Mfu.Detail is { MonthlyItems.Count: > 0, WarehouseConsumables.Count: > 0 },
            TimeSpan.FromSeconds(15));
        // Справка: первая опубликованная статья выбирается при загрузке.
        PumpUntil(() => vm.Help.Detail is not null, TimeSpan.FromSeconds(10));
        // Администрирование: первый раздел (пользователи).
        PumpUntil(() => vm.Admin.Users.Count > 0, TimeSpan.FromSeconds(10));
        // DLP: первый хост — деталь активности и вкладка «Файлы» на демо-данных.
        vm.Dlp.SelectedHost = vm.Dlp.Hosts.Count > 0 ? vm.Dlp.Hosts[0] : null;
        PumpUntil(() => vm.Dlp.HasDetail, TimeSpan.FromSeconds(10));
        PumpUntil(() => vm.Dlp.FileEvents.Count > 0, TimeSpan.FromSeconds(10));
        window.UpdateLayout();

        var pages = new (string Name, string File)[]
        {
            ("dashboard", "01-dashboard.png"),
            ("tasks", "02-tasks.png"),
            ("news", "03-news.png"),
            ("chat", "04-chat.png"),
            ("absences", "05-absences.png"),
            ("profile", "06-profile.png"),
            ("mail", "07-mail.png"),
            ("docflow", "08-docflow.png"),
            ("tickets", "09-tickets.png"),
            ("addressbook", "10-addressbook.png"),
            ("myfiles", "11-myfiles.png"),
            ("structure", "12-structure.png"),
            ("itobjects", "13-itobjects.png"),
            ("networks", "14-networks.png"),
            ("computers", "15-computers.png"),
            ("database", "16-database.png"),
            ("groupsaccess", "17-groupsaccess.png"),
            ("vcs", "18-vcs.png"),
            ("monitoring", "19-monitoring.png"),
            ("mfu", "20-mfu.png"),
            ("statistics", "21-statistics.png"),
            ("help", "22-help.png"),
            ("settings", "23-settings.png"),
            ("admin", "24-admin.png"),
            ("construction", "26-construction.png"),
            ("warehouse", "27-warehouse.png"),
            ("itrequests", "28-itrequests.png"),
            ("dlp", "29-dlp.png"),
        };
        // Прогон всех страниц с их вложенными оверлеями; filePrefix — ""
        // для тёмной базы и "L" для светлого кадра (имена совпадают с префиксом).
        void RenderPageFrames(string filePrefix)
        {
            foreach (var (page, file) in pages)
            {
                vm.NavigateToPageCommand.Execute(page);
                if (page == "database")
                {
                    // Карточка длинная: прокрутить деталь до секции фото, чтобы
                    // превью, бейджи модерации и «+ Добавить фото» попали в кадр.
                    window.UpdateLayout();
                    BringPhotoSectionIntoView(window);
                }

                if (page == "chat" && filePrefix.Length > 0)
                {
                    // Светлый прогон: лента c1 уже «прочитана» тёмным проходом —
                    // возвращаем строке unread и переоткрываем диалог, иначе
                    // полоса «Непрочитанные сообщения» была бы только на тёмной
                    // базе (one-shot: после прочтения её нет).
                    var c1 = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c1");
                    c1?.Update(Conversation("c1", "group", "IT-отдел", unread: 5,
                        pinned: true, preview: "Согласовал бюджет на следующий год",
                        at: DateTimeOffset.Now.AddMinutes(-12),
                        members: 12, online: 4, role: "owner",
                        avatar: "avatars/c1.png"));
                    // Фото строки (avatar_url) грузится фоном — дождаться кадра.
                    PumpUntil(() => c1?.HasAvatarImage == true, TimeSpan.FromSeconds(5));
                    vm.Chat.SelectedConversation = null;
                    vm.Chat.SelectedConversation = c1;
                    PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                    PumpUntil(
                        () => vm.Chat.Messages.SelectMany(m => m.AttachmentItems)
                            .Where(a => a.IsImage).All(a => a.HasPreview),
                        TimeSpan.FromSeconds(10));
                }

                window.UpdateLayout();
                SavePng(window, Path.Combine(outputDir, filePrefix + file));

                if (page == "chat" && filePrefix.Length == 0)
                {
                    // Адаптивность (п.13 чеклиста): кадры ленты на целевых
                    // размерах окна — минимум 1024×600, типовой 1366×768,
                    // широкий 1920×1080. Размер меняем на живом скрытом окне,
                    // после кадров возвращаем исходный.
                    var baseWidth = window.Width;
                    var baseHeight = window.Height;
                    foreach (var (w, h, tag) in new[]
                    {
                        (1024.0, 600.0, "s1024"),
                        (1280.0, 720.0, "s1280"),
                        (1366.0, 768.0, "s1366"),
                        // 2560×1440 недостижимо: WPF клампит размер окна по
                        // рабочей области монитора (~1940 на тест-машине).
                        (1920.0, 1080.0, "s1920"),
                    })
                    {
                        window.Width = w;
                        window.Height = h;
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, $"04z-chat-{tag}.png"));
                    }

                    window.Width = baseWidth;
                    window.Height = baseHeight;
                    window.UpdateLayout();
                }

                if (page == "news")
                {
                    // Деталь длинная: опрос/вложения/комментарии под сгибом —
                    // два кадра прокрутки держат все секции вовлечения в зоне видимости.
                    window.UpdateLayout();
                    BringNewsSectionIntoView(window, "AttachmentsSectionPanel");
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "03b-news-engagement.png"));
                    BringNewsSectionIntoView(window, "CommentsSectionPanel");
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "03c-news-comments.png"));
                }

                if (page == "tasks")
                {
                    // Оверлей «Новая задача»: справочники исполнителей/проектов
                    // в демо-данных — форма рендерится с заполненными селектами.
                    Pump(((NativeAsyncCommand)vm.Tasks.NewTaskCommand).ExecuteAsync(null));
                    if (vm.Tasks.Create is { } create)
                    {
                        create.Title = "Подготовить инвентаризацию склада";
                        create.Description = "Сверить остатки оргтехники с базой ITINVENT до конца недели.";
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "02b-tasks-create.png"));
                        create.CloseCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Режим «Аналитика»: KPI-карточки, разрезы с полосками, динамика.
                    vm.Tasks.SelectViewModeCommand.Execute("analytics");
                    PumpUntil(
                        () => vm.Tasks.Analytics.HasPayload && !vm.Tasks.Analytics.IsLoading,
                        TimeSpan.FromSeconds(10));
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "02c-tasks-analytics.png"));
                    vm.Tasks.SelectViewModeCommand.Execute("list");
                    window.UpdateLayout();
                }

                if (page == "chat")
                {
                    // «Участники»: роли/ограничение + меню модерации владельца.
                    Pump(((NativeAsyncCommand)vm.Chat.ToggleMembersPanelCommand).ExecuteAsync(null));
                    if (vm.Chat.IsMembersPanelOpen)
                    {
                        // Фото участников (avatars/*) качаются фоном — дождаться кадра.
                        PumpUntil(
                            () => vm.Chat.GroupMembers.Count(m => m.HasAvatarImage) >= 4,
                            TimeSpan.FromSeconds(5));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04b-chat-members.png"));
                        vm.Chat.CloseMembersPanelCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // «Настройки группы»: профиль, аватар, ссылка-приглашение,
                    // бейджи заявок/жалоб, armed-удаление (только owner).
                    Pump(((NativeAsyncCommand)vm.Chat.ToggleGroupSettingsCommand).ExecuteAsync(null));
                    if (vm.Chat.IsGroupSettingsOpen)
                    {
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04c-chat-settings.png"));
                        // Панель заявок поверх настроек — второй кадр модерации.
                        Pump(((NativeAsyncCommand)vm.Chat.ToggleJoinRequestsPanelCommand).ExecuteAsync(null));
                        if (vm.Chat.IsJoinRequestsPanelOpen)
                        {
                            window.UpdateLayout();
                            SavePng(window, Path.Combine(outputDir, filePrefix + "04d-chat-join-requests.png"));
                            vm.Chat.CloseJoinRequestsPanelCommand.Execute(null);
                        }

                        vm.Chat.CloseGroupSettingsCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // «Запланированные»: плашка над composer + панель отложенных
                    // (время, статус, правка, armed-отмена).
                    Pump(((NativeAsyncCommand)vm.Chat.ToggleScheduledPanelCommand).ExecuteAsync(null));
                    if (vm.Chat.IsScheduledPanelOpen)
                    {
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04e-chat-scheduled.png"));
                        vm.Chat.CloseScheduledPanelCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Редактор «Отправить позже»: текст, дата/время, пресеты, подсказка.
                    vm.Chat.ComposerText = "Напомнить про бюджет";
                    vm.Chat.OpenScheduleEditorCommand.Execute(null);
                    if (vm.Chat.IsScheduleEditorOpen)
                    {
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04f-chat-schedule-editor.png"));
                        vm.Chat.CloseScheduleEditorCommand.Execute(null);
                        // Текст уходит в клиентский черновик c1 — без очистки он
                        // восстановится в composer при переключении диалога и
                        // протечёт в кадры и в светлый прогон.
                        vm.Chat.ComposerText = string.Empty;
                        window.UpdateLayout();
                    }

                    // Поиск по списку (tg-search): скоуп-чип «Этот чат», секции
                    // «Чаты» и «Сообщения» вместо обычного списка диалогов.
                    vm.Chat.SearchText = "ет";
                    PumpUntil(() => vm.Chat.GlobalSearchResults.Count > 0, TimeSpan.FromSeconds(10));
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "04g-chat-search.png"));
                    vm.Chat.SearchText = "";
                    window.UpdateLayout();

                    // Мультивыбор (tg-multiselect): круги-чеки у строк, панель
                    // «ПЕРЕСЛАТЬ/УДАЛИТЬ N» вместо шапки.
                    if (vm.Chat.Messages.Count > 5)
                    {
                        vm.Chat.BeginSelectCommand.Execute(vm.Chat.Messages[2]);
                        vm.Chat.ToggleMessageSelectionCommand.Execute(vm.Chat.Messages[5]);
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04h-chat-select.png"));
                        vm.Chat.ExitSelectionCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // «печатает…»: акцентная строка в списке (вместо превью) и
                    // подзаголовок шапки. SetTyping публичный — в рендере realtime
                    // нет, но повторный выбор диалога подхватывает статус строки.
                    // В папке «Беседы» список отфильтрован до одного диалога — для
                    // повторного выбора переключаемся через null (сеттер принимает).
                    var typingC1 = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c1");
                    typingC1?.SetTyping("Ирина Петрова печатает…");
                    if (typingC1 is not null)
                    {
                        vm.Chat.SelectedConversation = null;
                        vm.Chat.SelectedConversation = typingC1;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                        // Плитки превью пересоздаются при перезагрузке ленты —
                        // дождаться, иначе в кадре висят чипы вместо фото.
                        PumpUntil(
                            () => vm.Chat.Messages.SelectMany(m => m.AttachmentItems)
                                .Where(a => a.IsImage).All(a => a.HasPreview),
                            TimeSpan.FromSeconds(10));
                    }

                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "04i-chat-typing.png"));
                    typingC1?.SetTyping(null);
                    // Сброс шапки: переключение диалога гасит TypingText в VM.
                    if (typingC1 is not null)
                    {
                        vm.Chat.SelectedConversation = null;
                        vm.Chat.SelectedConversation = typingC1;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                    }

                    // Просмотрщик изображений: клик по image-чипу открывает затемнённый
                    // оверлей с картинкой, «N из M» и стрелками (байты chat-путей
                    // отдаёт ImageDownloadBytesFactory — градиентный PNG из DemoApi).
                    var photoMessage = vm.Chat.Messages
                        .FirstOrDefault(m => m.AttachmentItems.Any(a => a.IsImage));
                    if (photoMessage is not null)
                    {
                        photoMessage.AttachmentItems.First(a => a.IsImage).OpenCommand.Execute(null);
                        PumpUntil(() => vm.Chat.IsMediaViewerOpen, TimeSpan.FromSeconds(5));
                        PumpUntil(
                            () => vm.Chat.MediaViewerImage is not null || !vm.Chat.IsMediaViewerLoading,
                            TimeSpan.FromSeconds(10));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04j-chat-media.png"));
                        vm.Chat.CloseMediaViewerCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Черновик в невыбранной строке (client-side, parity web
                    // draftPreview): красный «Черновик: » вместо превью.
                    // «Беседы» фильтруют список до групп — кадр переводим на
                    // «Личные», там c2 видна, а открытый c1 держим выбранным
                    // (объект строки живёт вне фильтра — как переход по ссылке).
                    // VM-путь (debounce/store) покрыт юнит-тестами — строке
                    // ставим напрямую ради детерминизма.
                    var openChat = vm.Chat.SelectedConversation;
                    vm.Chat.ActiveFolderKey = ChatViewModel.PersonalFolderKey;
                    vm.Chat.SelectedConversation = openChat;
                    PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                    var draftRow = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c2");
                    draftRow?.SetDraft("Напомни завтра про акт сверки");
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "04k-chat-draft.png"));
                    draftRow?.SetDraft(null);

                    // «Непрочитанные сообщения» (unread bar tdesktop): первый
                    // личный диалог с живым unread — полоса над первым
                    // непрочитанным по якорю viewer_last_read. Тёмный прогон
                    // открывает c2 (её unread ещё не «прочитан»); в светлом c2
                    // уже прочитана выше — возвращаем непрочитанность c5.
                    var unreadRow = vm.Chat.Conversations.FirstOrDefault(
                        c => (c.Id == "c2" || c.Id == "c5") && c.HasUnread);
                    if (unreadRow is null && filePrefix.Length > 0)
                    {
                        var c5 = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c5");
                        c5?.Update(Conversation("c5", "direct", "Сергей Козлов", unread: 2,
                            preview: "Ок, спасибо!", at: DateTimeOffset.Now.AddDays(-2),
                            peer: new HubChatUser
                            {
                                Id = 12, Username = "kozlov", FullName = "Сергей Козлов",
                                AvatarUrl = "avatars/u12.png",
                            }));
                        unreadRow = c5;
                    }

                    if (unreadRow is not null)
                    {
                        vm.Chat.SelectedConversation = unreadRow;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                        PumpUntil(
                            () => vm.Chat.Messages.SelectMany(m => m.AttachmentItems)
                                .Where(a => a.IsImage).All(a => a.HasPreview),
                            TimeSpan.FromSeconds(10));
                        // Фото-аватар пира в выбранной строке и шапке карточки.
                        PumpUntil(() => unreadRow.HasAvatarImage, TimeSpan.FromSeconds(5));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04l-chat-unread.png"));
                        vm.Chat.SelectedConversation = openChat;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                    }

                    // «Информация» (tg-profile): правая панель 330px у края —
                    // direct c2 с фото и @username; лента сжимается колонкой.
                    var peerRow = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c2");
                    if (peerRow is not null)
                    {
                        vm.Chat.SelectedConversation = peerRow;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                        PumpUntil(() => peerRow.HasAvatarImage, TimeSpan.FromSeconds(5));
                        vm.Chat.TogglePeerCardCommand.Execute(null);
                        if (vm.Chat.IsPeerCardOpen)
                        {
                            window.UpdateLayout();
                            SavePng(window, Path.Combine(outputDir, filePrefix + "04m-chat-peer.png"));

                            // UI-002: на 1024×600 панель обязана быть оверлеем,
                            // а не колонкой — лента остаётся читаемой под ней.
                            var baseWidth = window.Width;
                            var baseHeight = window.Height;
                            window.Width = 1024;
                            window.Height = 600;
                            window.UpdateLayout();
                            SavePng(window, Path.Combine(outputDir, filePrefix + "04n-chat-peer-1024.png"));
                            window.Width = baseWidth;
                            window.Height = baseHeight;
                            window.UpdateLayout();

                            vm.Chat.ClosePeerCardCommand.Execute(null);
                            window.UpdateLayout();
                        }

                        vm.Chat.SelectedConversation = openChat;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                    }

                    // Панель «Стикеры» (tg-stickers): вкладки, ряд паков и сетка
                    // активного пака над composer. Превью докачиваются фоном —
                    // ждём весь пак, иначе кадр ловит эмодзи-фолбэки.
                    Pump(((NativeAsyncCommand)vm.Chat.ToggleStickerPanelCommand).ExecuteAsync(null));
                    if (vm.Chat.IsStickerPanelOpen)
                    {
                        vm.Chat.SelectStickerTabCommand.Execute("stickers");
                        PumpUntil(
                            () => vm.Chat.SelectedStickerPack?.Stickers.All(s => s.HasPreview) == true,
                            TimeSpan.FromSeconds(10));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04n-chat-stickers.png"));
                        vm.Chat.CloseStickerPanelCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // «Главное меню» (tg-menu): шапка профиля + иконки-пункты.
                    // WPF Menu открывает подменю отдельным Popup-окном — в
                    // визуальное дерево окна оно не попадает, поэтому снимаем
                    // содержимое popup.Child открытого подменю напрямую.
                    if (FindMenuRoot(window) is { } menuRoot)
                    {
                        menuRoot.IsSubmenuOpen = true;
                        window.UpdateLayout();
                        if (FindVisualChild<Popup>(menuRoot) is { } menuPopup
                            && menuPopup.Child is FrameworkElement popupChild)
                        {
                            PumpUntil(
                                () => menuPopup.IsOpen && popupChild.ActualWidth > 0,
                                TimeSpan.FromSeconds(5));
                            // Popup живёт в отдельном hwnd — если раскладка не
                            // успела, досчитываем меру вручную перед снимком.
                            if (popupChild.ActualWidth <= 0)
                            {
                                popupChild.Measure(new Size(480, 720));
                                popupChild.Arrange(new Rect(popupChild.DesiredSize));
                            }

                            SavePng(popupChild, Path.Combine(outputDir, filePrefix + "04o-chat-menu.png"));
                        }

                        menuRoot.IsSubmenuOpen = false;
                        window.UpdateLayout();
                    }

                    // «@упоминания» (web mentionList): группа c1 — кандидаты из
                    // detail участников, попап над composer с аватаром, именем
                    // и @handle; активная строка подсвечена. Вкладка «Личные»
                    // скрывает c1 из списка — берём сохранённый объект openChat.
                    var mentionRow = vm.Chat.Conversations.FirstOrDefault(c => c.Id == "c1")
                        ?? (openChat?.Id == "c1" ? openChat : null);
                    if (mentionRow is not null)
                    {
                        vm.Chat.SelectedConversation = mentionRow;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                        vm.Chat.ComposerText = "@";
                        vm.Chat.UpdateMentionTrigger(
                            vm.Chat.ComposerText, vm.Chat.ComposerText.Length);
                        PumpUntil(
                            () => vm.Chat.MentionSuggestions.Count > 0 && !vm.Chat.IsLoadingMentions,
                            TimeSpan.FromSeconds(10));
                        PumpUntil(
                            () => vm.Chat.MentionSuggestions.All(m => m.HasAvatarImage),
                            TimeSpan.FromSeconds(10));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04p-chat-mention.png"));
                        vm.Chat.CloseMentionPopup();
                        vm.Chat.ComposerText = string.Empty;
                        vm.Chat.SelectedConversation = openChat;
                        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
                        window.UpdateLayout();
                    }

                    // Вкладка «Все» (ALL_CHAT_FOLDER_TAB tg-main): верхняя
                    // виртуальная вкладка полосы — весь список без фильтра kind.
                    vm.Chat.ActiveFolderKey = ChatViewModel.AllFolderKey;
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "04q-chat-all.png"));

                    // Пикер пересылки (tg-forward): дим, «Переслать сообщение»,
                    // свой поиск «Переслать в…», строки всех диалогов с аватарами.
                    var forwardMessage = vm.Chat.Messages
                        .FirstOrDefault(m => m.CanReply && !m.IsSystem);
                    if (forwardMessage is not null)
                    {
                        vm.Chat.BeginForwardCommand.Execute(forwardMessage);
                        PumpUntil(
                            () => vm.Chat.IsForwardPanelOpen && vm.Chat.ForwardTargets.Count > 0,
                            TimeSpan.FromSeconds(5));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04r-chat-forward.png"));
                        vm.Chat.CloseForwardPanelCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Модал «Удалить сообщение?» (tg-delete): красная «Удалить» +
                    // «Отмена». В кадре только подтверждение — DELETE не уходит.
                    var deleteMessage = vm.Chat.Messages
                        .LastOrDefault(m => m.CanEditOrDelete);
                    if (deleteMessage is not null)
                    {
                        Pump(((NativeAsyncCommand)vm.Chat.DeleteMessageCommand)
                            .ExecuteAsync(deleteMessage));
                        if (vm.Chat.IsDeleteConfirmOpen)
                        {
                            window.UpdateLayout();
                            SavePng(window, Path.Combine(outputDir, filePrefix + "04s-chat-delete.png"));
                            vm.Chat.CancelDeleteCommand.Execute(null);
                            window.UpdateLayout();
                        }
                    }

                    // Вкладка «Эмодзи» стикер-панели: категории «Улыбки»/
                    // «Жесты и люди»/«Символы и объекты» с сетками (tg-stickers).
                    Pump(((NativeAsyncCommand)vm.Chat.ToggleStickerPanelCommand).ExecuteAsync(null));
                    if (vm.Chat.IsStickerPanelOpen)
                    {
                        vm.Chat.SelectStickerTabCommand.Execute("emoji");
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "04t-chat-emoji.png"));
                        vm.Chat.CloseStickerPanelCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Drop-оверлей tg-drop: дим всей колонки чата, акцентная
                    // рамка и «Перетащите файлы, чтобы отправить их в …».
                    // ОС-драг в скриншот-тесте не сымитировать — флаг ставим
                    // тем же путём, что и DragEnter на view.
                    vm.Chat.SetFileDropOverlay(true);
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "04u-chat-drop.png"));
                    vm.Chat.SetFileDropOverlay(false);
                    window.UpdateLayout();

                    vm.Chat.ActiveFolderKey = ChatViewModel.GroupsFolderKey;
                    window.UpdateLayout();
                }

                if (page == "mail")
                {
                    // Infinite scroll: прокрутка списка писем к концу вызывает тот же
                    // путь, что у пользователя — ScrollChanged → LoadMore → вторая страница.
                    if (FindMailListScrollViewer(window) is { } mailScroll)
                    {
                        var itemsBefore = vm.Mail.Items.Count;
                        mailScroll.ScrollToEnd();
                        // Светлый проход наследует уже догруженный список — ждём только
                        // пока есть следующая страница.
                        if (vm.Mail.HasMore)
                        {
                            PumpUntil(
                                () => vm.Mail.Items.Count > itemsBefore && !vm.Mail.IsLoadingMore,
                                TimeSpan.FromSeconds(5));
                        }

                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "07c-mail-scrolled.png"));

                        // Полные заголовки (Gmail «show details»): моноширинный блок
                        // под шапкой чтения; светлый проход наследует раскрытое состояние.
                        mailScroll.ScrollToHome();
                        if (vm.Mail.Detail?.AreHeadersVisible != true)
                        {
                            Pump(((NativeAsyncCommand)vm.Mail.ToggleDetailHeadersCommand).ExecuteAsync(null));
                            PumpUntil(
                                () => vm.Mail.Detail?.AreHeadersVisible == true
                                    && vm.Mail.Detail?.IsHeadersLoading == false,
                                TimeSpan.FromSeconds(5));
                        }

                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "07d-mail-headers.png"));
                    }

                    // Пустая папка («Нежелательная» в демо): привет-панель чтения
                    // и пустое состояние списка в одном кадре; возвращаем «Входящие»
                    // для корректного базового кадра светлого прохода.
                    if (vm.Mail.Folders.FirstOrDefault(f => f.WellKnownKey == "junk") is { } junkFolder)
                    {
                        vm.Mail.SelectedItem = null;
                        vm.Mail.SelectedFolder = junkFolder;
                        PumpUntil(() => !vm.Mail.IsLoading && !vm.Mail.IsLoadingMore, TimeSpan.FromSeconds(5));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "07e-mail-empty.png"));
                        vm.Mail.SelectedFolder = vm.Mail.Folders.FirstOrDefault(f => f.WellKnownKey == "inbox");
                        PumpUntil(() => vm.Mail.Items.Count > 0 && !vm.Mail.IsLoading, TimeSpan.FromSeconds(5));
                        vm.Mail.SelectedItem = vm.Mail.Items.Count > 0 ? vm.Mail.Items[0] : null;
                        PumpUntil(() => vm.Mail.Detail is not null && !vm.Mail.IsDetailLoading, TimeSpan.FromSeconds(5));
                        window.UpdateLayout();
                    }

                    // Оверлей «IT-заявка»: шаблон с динамическими полями формы.
                    Pump(((NativeAsyncCommand)vm.Mail.OpenItRequestCommand).ExecuteAsync(null));
                    if (vm.Mail.ItRequest is { } itRequest && itRequest.HasTemplates)
                    {
                        itRequest.SelectedTemplate = itRequest.Templates[0];
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "07b-mail-itrequest.png"));
                        itRequest.CloseCommand.Execute(null);
                        window.UpdateLayout();
                    }
                }

                if (page == "absences")
                {
                    // Оверлей «Новое отсутствие»: DatePicker-поля редактора —
                    // контрольный кадр тематических стилей выбора даты.
                    Pump(((NativeAsyncCommand)vm.Absences.OpenCreateCommand).ExecuteAsync(null));
                    if (vm.Absences.Editor is { } absenceEditor)
                    {
                        absenceEditor.DisplayName = "Иванов Иван Иванович";
                        absenceEditor.StartsOn = DateTime.Today;
                        absenceEditor.EndsOn = DateTime.Today.AddDays(3);
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "05b-absences-editor.png"));
                        absenceEditor.CloseCommand.Execute(null);
                        window.UpdateLayout();
                    }
                }

                if (page == "vcs")
                {
                    // Оверлеи vcs.manage: редактор терминала и диалог «Пароль VNC».
                    Pump(((NativeAsyncCommand)vm.Vcs.OpenCreateCommand).ExecuteAsync(null));
                    if (vm.Vcs.Editor is { } vcsEditor)
                    {
                        vcsEditor.Name = "Переговорная «Лена»";
                        vcsEditor.Address = "10.24.1.70";
                        vcsEditor.Location = "Тюмень, 1 этаж";
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "18b-vcs-editor.png"));
                        vcsEditor.CloseCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    Pump(((NativeAsyncCommand)vm.Vcs.OpenConfigCommand).ExecuteAsync(null));
                    if (vm.Vcs.IsConfigDialogOpen)
                    {
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "18c-vcs-config.png"));
                        vm.Vcs.CloseConfigCommand.Execute(null);
                        window.UpdateLayout();
                    }
                }

                if (page == "database")
                {
                    // Просмотр фото: статус модерации и кнопки verify/reject/rotate.
                    if (vm.Database.PhotoPreviews.Count > 0)
                    {
                        vm.Database.OpenPhotoCommand.Execute(vm.Database.PhotoPreviews[0]);
                        PumpUntil(() => vm.Database.PhotoViewerImage is not null, TimeSpan.FromSeconds(10));
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "16b-database-photo-viewer.png"));
                        vm.Database.ClosePhotoViewerCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Диалог причины отклонения: обязательное поле + «Отклонить».
                    var pending = vm.Database.PhotoPreviews
                        .FirstOrDefault(photo => photo.ShowRejectButton);
                    if (pending is not null)
                    {
                        vm.Database.OpenRejectPhotoCommand.Execute(pending);
                        vm.Database.PhotoRejectReason = "Серийник не читается";
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "16d-database-photo-reject.png"));
                        vm.Database.CancelRejectPhotoCommand.Execute(null);
                        window.UpdateLayout();
                    }

                    // Диалог «Добавить фото»: выбранный файл + кнопка «Загрузить».
                    var uploadProbe = Path.Combine(outputDir, "_probe-photo.png");
                    try
                    {
                        File.WriteAllBytes(uploadProbe, TestImageBytes.Png1X1);
                        vm.Database.PhotoFilePicker = () => [uploadProbe];
                        vm.Database.AddPhotoCommand.Execute(null);
                        window.UpdateLayout();
                        SavePng(window, Path.Combine(outputDir, filePrefix + "16c-database-photo-upload.png"));
                        vm.Database.PhotoUpload?.CloseCommand.Execute(null);
                        window.UpdateLayout();
                    }
                    finally
                    {
                        File.Delete(uploadProbe);
                    }

                    // Диалог «Загрузить акт»: распознанный черновик — поля, позиции
                    // базы и панель верификации инвентарных номеров.
                    var actProbe = Path.Combine(outputDir, "_probe-act.pdf");
                    try
                    {
                        File.WriteAllBytes(actProbe, "%PDF-1.4\n"u8.ToArray());
                        vm.Database.ActFilePicker = () => [actProbe];
                        Pump(((NativeAsyncCommand)vm.Database.OpenUploadActCommand).ExecuteAsync(null));
                        if (vm.Database.UploadAct is { } uploadAct)
                        {
                            Pump(((NativeAsyncCommand)uploadAct.ParseAutoCommand).ExecuteAsync(null));
                            uploadAct.InvVerified = true;
                            window.UpdateLayout();
                            SavePng(window, Path.Combine(outputDir, filePrefix + "16e-database-upload-act.png"));
                            uploadAct.CloseCommand.Execute(null);
                            window.UpdateLayout();
                        }
                    }
                    finally
                    {
                        File.Delete(actProbe);
                    }
                }

                if (page == "tickets")
                {
                    // Канбан-режим заявок — отдельный кадр, потом возврат в список.
                    vm.Tickets.SelectViewModeCommand.Execute("kanban");
                    PumpUntil(
                        () => vm.Tickets.KanbanColumns.Count > 0 && !vm.Tickets.IsKanbanLoading,
                        TimeSpan.FromSeconds(10));
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "09b-tickets-kanban.png"));

                    // Режим «Управление»: админские вкладки (объекты — первая).
                    vm.Tickets.SelectViewModeCommand.Execute("admin");
                    PumpUntil(
                        () => vm.Tickets.Admin is { Objects.Items.Count: > 0 },
                        TimeSpan.FromSeconds(10));
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "09c-tickets-admin.png"));

                    vm.Tickets.SelectViewModeCommand.Execute("list");
                    window.UpdateLayout();
                }

                if (page == "warehouse")
                {
                    // Вкладка «Ведомость»: движения номенклатуры + карточка документа.
                    vm.Warehouse.SelectTabCommand.Execute(WarehouseViewModel.TabMovements);
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "27b-warehouse-movements.png"));
                    // Вкладка «Уволенные»: остатки за уволенными сотрудниками.
                    vm.Warehouse.SelectTabCommand.Execute(WarehouseViewModel.TabDismissed);
                    PumpUntil(
                        () => vm.Warehouse.DismissedItems.Count > 0 && !vm.Warehouse.IsDismissedLoading,
                        TimeSpan.FromSeconds(10));
                    vm.Warehouse.SelectedDismissed = vm.Warehouse.DismissedItems[0];
                    window.UpdateLayout();
                    SavePng(window, Path.Combine(outputDir, filePrefix + "27c-warehouse-dismissed.png"));
                    vm.Warehouse.SelectTabCommand.Execute(WarehouseViewModel.TabBalances);
                    window.UpdateLayout();
                }
            }
        }

        // Центр уведомлений: колокол открыт поверх дашборда — лента,
        // точки непрочитанных, бейдж на кнопке-колоколе в подвале навигации.
        void RenderNotificationsFrame(string fileName)
        {
            vm.NavigateToPageCommand.Execute("dashboard");
            vm.Notifications.IsPanelOpen = true;
            PumpUntil(() => !vm.Notifications.IsLoading, TimeSpan.FromSeconds(10));
            window.UpdateLayout();
            SavePng(window, Path.Combine(outputDir, fileName));
            vm.Notifications.IsPanelOpen = false;
            window.UpdateLayout();
        }

        RenderPageFrames("");
        RenderNotificationsFrame("25-notifications.png");

        // Светлая проверка: подмена словаря палитры на лету — все страницы и
        // оверлеи переснимаются без пересоздания окна: DynamicResource следует
        // за словарём, залипшие кисти и контраст видны на снимках.
        NativeThemeManager.Apply("light");
        window.UpdateLayout();
        RenderPageFrames("L");
        RenderNotificationsFrame("L25-notifications.png");

        NativeThemeManager.Apply("dark");
        window.UpdateLayout();

        window.Close();

        // Экран входа (SignedOut — начальное состояние без сессии).
        // ThemeMode=dark и здесь: LoadAsync сам применяет тему из настроек —
        // без явного значения «system» отдал бы кадр в системной теме хоста.
        var loginApi = new FakeHubApiClient
        {
            StoredSession = null,
            MySettings = new HubUserSettings { ThemeMode = "dark" },
        };
        var loginWindow = new Hub.Desktop.Native.Views.HubWindow(loginApi)
        {
            WindowStartupLocation = WindowStartupLocation.Manual,
            Left = -30000,
            Top = -30000,
            ShowInTaskbar = false,
        };
        Pump(loginWindow.ViewModel.InitializeAsync());
        loginWindow.Show();
        loginWindow.UpdateLayout();
        SavePng(loginWindow, Path.Combine(outputDir, "00-login.png"));

        // L00: та же карточка входа под светлой палитрой — градиент фона,
        // поля и кнопка перекрашиваются через DynamicResource на лету.
        // (SignedOut не грузит settings: тема экрана — амбиент палитры.)
        NativeThemeManager.Apply("light");
        loginWindow.UpdateLayout();
        SavePng(loginWindow, Path.Combine(outputDir, "L00-login.png"));
        NativeThemeManager.Apply("dark");
        loginWindow.UpdateLayout();
        loginWindow.Close();

        // Диспетчер STA-потока гасим явно: висящий HwndWrapper на мёртвом
        // потоке ловит WndProc при выгрузке тестхоста (SubclassWndProc NRE).
        Dispatcher.FromThread(Thread.CurrentThread)?.InvokeShutdown();
    }

    private static void SavePng(Visual visual, string path)
    {
        var element = (FrameworkElement)visual;
        var width = (int)Math.Ceiling(element.ActualWidth);
        var height = (int)Math.Ceiling(element.ActualHeight);
        var bitmap = new RenderTargetBitmap(
            Math.Max(width, 1), Math.Max(height, 1), 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(path);
        encoder.Save(stream);
    }

    /// <summary>
    /// PNG заданного размера для просмотрщика вложений: 1×1-пиксель в кадре
    /// нечитаем, поэтому рисуем градиентный прямоугольник «фото».
    /// </summary>
    private static byte[] DemoPng(int width, int height)
    {
        var visual = new DrawingVisual();
        using (var context = visual.RenderOpen())
        {
            context.DrawRectangle(
                new LinearGradientBrush(
                    Color.FromRgb(0x51, 0x88, 0xC1), Color.FromRgb(0x24, 0x3B, 0x55), 45),
                null,
                new Rect(0, 0, width, height));
            context.DrawText(
                new FormattedText(
                    "фото_стойки.png",
                    CultureInfo.InvariantCulture,
                    FlowDirection.LeftToRight,
                    new Typeface("Segoe UI"),
                    28,
                    Brushes.White,
                    1.0),
                new Point(24, 24));
        }

        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new MemoryStream();
        encoder.Save(stream);
        return stream.ToArray();
    }

    /// <summary>
    /// PNG «фото-аватара» для avatars/*-путей: цвет — детерминированный хэш пути
    /// (тот же hash*31, что палитра пиров), поверх — силуэт головы/плеч, чтобы
    /// круг визуально отличался от градиента-заглушки с инициалами.
    /// </summary>
    private static byte[] DemoAvatarPng(string key, int size = 96)
    {
        var hash = 0;
        foreach (var ch in key)
        {
            hash = hash * 31 + ch;
        }

        (Color A, Color B)[] palette =
        [
            (Color.FromRgb(0xE8, 0x67, 0x5C), Color.FromRgb(0x9B, 0x3B, 0x34)),
            (Color.FromRgb(0xED, 0xA0, 0x3A), Color.FromRgb(0xA3, 0x63, 0x17)),
            (Color.FromRgb(0x95, 0x5C, 0xDB), Color.FromRgb(0x5E, 0x35, 0xA0)),
            (Color.FromRgb(0x40, 0xA9, 0x20), Color.FromRgb(0x2A, 0x75, 0x16)),
            (Color.FromRgb(0x30, 0x9E, 0xBA), Color.FromRgb(0x1D, 0x63, 0x78)),
            (Color.FromRgb(0x36, 0x8A, 0xD1), Color.FromRgb(0x21, 0x55, 0x8A)),
            (Color.FromRgb(0xC7, 0x50, 0x8B), Color.FromRgb(0x8A, 0x2E, 0x5D)),
        ];
        var (from, to) = palette[Math.Abs(hash) % palette.Length];
        var silhouette = new SolidColorBrush(Color.FromArgb(0xD8, 0xFF, 0xFF, 0xFF));
        var visual = new DrawingVisual();
        using (var context = visual.RenderOpen())
        {
            context.DrawRectangle(
                new LinearGradientBrush(from, to, 45), null, new Rect(0, 0, size, size));
            // Голова + плечи — как у заглушки-фото Telegram.
            context.DrawEllipse(silhouette, null,
                new Point(size * 0.5, size * 0.36), size * 0.16, size * 0.16);
            context.DrawEllipse(silhouette, null,
                new Point(size * 0.5, size * 0.98), size * 0.34, size * 0.38);
        }

        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new MemoryStream();
        encoder.Save(stream);
        return stream.ToArray();
    }

    /// <summary>
    /// PNG «стикера» для chat/stickers/*-путей: пастельный круг-мордочка
    /// (цвет — детерминированный хэш пути) с глазами и улыбкой — сетка панели
    /// читается как набор стикеров (tg-stickers), а не эмодзи-фолбэки.
    /// </summary>
    private static byte[] DemoStickerPng(string key, int size = 128)
    {
        var hash = 0;
        foreach (var ch in key)
        {
            hash = hash * 31 + ch;
        }

        var bodies = new[]
        {
            Color.FromRgb(0xFF, 0xCC, 0x80), Color.FromRgb(0xCE, 0x93, 0xD8),
            Color.FromRgb(0x90, 0xCA, 0xF9), Color.FromRgb(0xA5, 0xD6, 0xA7),
            Color.FromRgb(0xF4, 0x8F, 0xB1), Color.FromRgb(0x80, 0xDE, 0xEA),
            Color.FromRgb(0xE6, 0xEE, 0x9C),
        };
        var body = new SolidColorBrush(bodies[Math.Abs(hash) % bodies.Length]);
        var dark = new SolidColorBrush(Color.FromRgb(0x37, 0x4A, 0x59));
        var visual = new DrawingVisual();
        using (var context = visual.RenderOpen())
        {
            var center = new Point(size / 2.0, size / 2.0);
            context.DrawEllipse(body, null, center, size * 0.46, size * 0.46);
            context.DrawEllipse(dark, null,
                new Point(center.X - size * 0.16, center.Y - size * 0.08),
                size * 0.05, size * 0.07);
            context.DrawEllipse(dark, null,
                new Point(center.X + size * 0.16, center.Y - size * 0.08),
                size * 0.05, size * 0.07);
            var smile = new StreamGeometry();
            using (var geometry = smile.Open())
            {
                geometry.BeginFigure(
                    new Point(center.X - size * 0.18, center.Y + size * 0.10),
                    isFilled: false, isClosed: false);
                geometry.ArcTo(
                    new Point(center.X + size * 0.18, center.Y + size * 0.10),
                    new Size(size * 0.20, size * 0.16), 0,
                    isLargeArc: false, SweepDirection.Counterclockwise,
                    isStroked: true, isSmoothJoin: false);
            }

            smile.Freeze();
            context.DrawGeometry(null, new Pen(dark, size * 0.045)
            {
                StartLineCap = PenLineCap.Round,
                EndLineCap = PenLineCap.Round,
            }, smile);
        }

        var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = new MemoryStream();
        encoder.Save(stream);
        return stream.ToArray();
    }

    /// <summary>Стикер фикстуры — превью лежит в chat/stickers/* (DemoStickerPng).</summary>
    private static HubChatSticker Sticker(string id, string emoji) =>
        new()
        {
            Id = id,
            Emoji = emoji,
            Format = "static",
            MimeType = "image/png",
            PreviewUrl = $"chat/stickers/{id}.png",
        };

    /// <summary>
    /// Прокручивает деталь новости до именованной секции (x:Name=AttachmentsSectionPanel /
    /// CommentsSectionPanel): секции опроса, вложений и комментариев попадают в кадр.
    /// </summary>
    private static void BringNewsSectionIntoView(DependencyObject root, string sectionName)
    {
        var view = FindVisualChild<Native.Views.NewsView>(root);
        if (view?.FindName(sectionName) is FrameworkElement section)
        {
            section.BringIntoView();
        }
    }

    /// <summary>
    /// Прокручивает ScrollViewer карточки базы до секции фото (x:Name=PhotoSectionPanel),
    /// чтобы превью и бейджи модерации попали в кадр снимка.
    /// </summary>
    private static void BringPhotoSectionIntoView(DependencyObject root)
    {
        var view = FindVisualChild<Native.Views.DatabaseView>(root);
        if (view?.FindName("PhotoSectionPanel") is FrameworkElement section)
        {
            section.BringIntoView();
        }
    }

    /// <summary>Корневой «☰» MenuItem главного меню — по AutomationProperties.Name.</summary>
    private static MenuItem? FindMenuRoot(DependencyObject parent)
    {
        var count = VisualTreeHelper.GetChildrenCount(parent);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            if (child is MenuItem menuItem
                && AutomationProperties.GetName(menuItem) == "Главное меню")
            {
                return menuItem;
            }

            var nested = FindMenuRoot(child);
            if (nested is not null)
            {
                return nested;
            }
        }

        return null;
    }

    /// <summary>Глубокий обход визуального дерева — первый потомок типа T.</summary>
    private static T? FindVisualChild<T>(DependencyObject parent)
        where T : DependencyObject
    {
        var count = VisualTreeHelper.GetChildrenCount(parent);
        for (var index = 0; index < count; index++)
        {
            var child = VisualTreeHelper.GetChild(parent, index);
            if (child is T typed)
            {
                return typed;
            }

            var nested = FindVisualChild<T>(child);
            if (nested is not null)
            {
                return nested;
            }
        }

        return null;
    }

    /// <summary>Прогоняет диспетчер, пока Task не завершится (STA-ожидание без deadlock).</summary>
    private static void Pump(Task task)
    {
        var frame = new DispatcherFrame();
        _ = task.ContinueWith(_ => frame.Continue = false, TaskScheduler.Default);
        Dispatcher.PushFrame(frame);
        if (task.IsFaulted)
        {
            throw task.Exception!;
        }
    }

    private static void PumpUntil(Func<bool> condition, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (!condition() && DateTime.UtcNow < deadline)
        {
            Dispatcher.CurrentDispatcher.Invoke(
                DispatcherPriority.Background, new Action(() => { }));
            Thread.Sleep(15);
        }
    }

    /// <summary>Раскрывает всё дерево оргструктуры — чтобы ветки были видимы на снимке.</summary>
    private static void ExpandStructure(IEnumerable<CompanyStructureNodeViewModel> nodes)
    {
        foreach (var node in nodes)
        {
            node.IsExpanded = true;
            ExpandStructure(node.Children);
        }
    }

    /// <summary>Самый глубокий узел дерева (крайний отдел) — под него грузятся люди.</summary>
    private static CompanyStructureNodeViewModel? DeepestStructureNode(
        IEnumerable<CompanyStructureNodeViewModel> nodes)
    {
        CompanyStructureNodeViewModel? deepest = null;
        foreach (var node in nodes)
        {
            deepest = DeepestStructureNode(node.Children) ?? deepest ?? node;
        }

        return deepest;
    }

    /// <summary>
    /// ScrollViewer списка писем: находим ListBox по AutomationProperties.Name
    /// и спускаемся к шаблонному ScrollViewer — прокрутка в нём проходит тот же
    /// путь, что и у пользователя (ScrollChanged → LoadMore).
    /// </summary>
    private static ScrollViewer? FindMailListScrollViewer(Window window)
    {
        foreach (var descendant in VisualDescendants(window))
        {
            if (descendant is not ListBox list
                || !string.Equals(
                    AutomationProperties.GetName(list),
                    "Список писем",
                    StringComparison.Ordinal))
            {
                continue;
            }

            foreach (var inner in VisualDescendants(list))
            {
                if (inner is ScrollViewer viewer)
                {
                    return viewer;
                }
            }

            return null;
        }

        return null;
    }

    private static IEnumerable<DependencyObject> VisualDescendants(DependencyObject node)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
        {
            var child = VisualTreeHelper.GetChild(node, i);
            yield return child;
            foreach (var descendant in VisualDescendants(child))
            {
                yield return descendant;
            }
        }
    }

    private static string ResolveOutputDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Hub.Desktop.sln")))
        {
            dir = dir.Parent;
        }

        var target = Path.Combine(dir?.FullName ?? AppContext.BaseDirectory, "screenshots");
        Directory.CreateDirectory(target);
        return target;
    }

    // ---- Демо-данные ----

    private static FakeHubApiClient DemoApi()
    {
        var now = DateTimeOffset.Now;
        var tasks = new HubTaskItem[]
        {
            Task(1, "Согласовать договор поставки сетевого оборудования", "review",
                dueAt: now.AddDays(1), project: "Закупки 2025", subtasks: (5, 7), comments: 3),
            Task(2, "Обновить прошивку коммутаторов на 3 этаже", "in_progress",
                dueAt: now.AddDays(2), dept: "IT-инфраструктура", subtasks: (2, 4)),
            Task(3, "Инвентаризация склада Б — картриджи", "new",
                dueAt: now.AddDays(5), attachments: 2),
            Task(4, "Настроить резервное копирование файлового сервера", "new",
                dueAt: now.AddDays(-2), overdue: true),
            Task(5, "Замена картриджей в МФУ бухгалтерии", "in_progress",
                dueAt: now, dept: "Бухгалтерия"),
            Task(6, "Отчёт по инцидентам за октябрь", "done",
                dueAt: now.AddDays(-4)),
        };
        var mailPage = MailPage(now);
        var kbArticle1 = KbArticle("kb-8", "Сброс пароля и 2FA", "net",
            "runbook", summary: "Что делать, если забыт пароль или потерян телефон с 2FA.",
            tags: ["пароль", "2fa"],
            content: new HubKbContentBlock
            {
                Overview = "Сброс пароля доменной учётной записи и восстановление " +
                    "двухфакторной аутентификации выполняются через портал HUB " +
                    "или службу поддержки.",
                // Маркированный список: акцентные «•» MarkdownTextBlock —
                // проверяется, что маркер следует за палитрой темы.
                Checks =
                [
                    "Доступ к корпоративной почте с рабочего места",
                    "Телефон с 2FA-приложением под рукой",
                ],
                ResolutionSteps =
                [
                    "Открыть hub.zsgp.ru → «Вход» → «Забыли пароль?»",
                    "Указать логин и рабочий e-mail, пройти проверку кода",
                    "При потере телефона — заявка в поддержку с пропуском",
                ],
                Escalation = "Если код не приходит более 5 минут — заявка " +
                    "в поддержку с телефона 55-11-99.",
            });
        var ticket1 = Ticket(101, "Петров И. С.", "at_cashier",
            objectName: "РЦ «Восточный»", departure: "2025-11-19",
            route: "Тюмень → РЦ «Восточный»", cost: "15240.50",
            urgent: true, assignee: "Иванов И. П.",
            note: "Командировка на монтаж нового сетевого оборудования");

        // Картинка «фото» для чата генерится здесь, на STA-потоке рендера:
        // DrawingVisual/RenderTargetBitmap не живут на фоновых потоках
        // DownloadImageAsync (параллельные вызовы падают → null → инициалы).
        // Остальные пути — общий 1×1 (карты и пр.).
        var chatPhotoPng = DemoPng(640, 480);
        // Тот же принцип для avatars/*: все пути фикстур — словарь path→PNG.
        var avatarPngs = new Dictionary<string, byte[]>(StringComparer.Ordinal);
        foreach (var path in new[]
                 {
                     "avatars/c1.png", "avatars/u7.png", "avatars/u11.png",
                     "avatars/u12.png", "avatars/u13.png", "avatars/u14.png",
                 })
        {
            avatarPngs[path] = DemoAvatarPng(path);
        }
        return new FakeHubApiClient
        {
            StoredSession = Session(),
            AccessTokenToReturn = null, // без реальных WS-подключений в рендере
            ImageDownloadBytes = TestImageBytes.Png1X1, // фото/карты через AuthImageLoader
            ImageDownloadBytesFactory = path =>
                path.Contains("chat/messages/", StringComparison.Ordinal) ? chatPhotoPng
                : path.StartsWith("chat/stickers/", StringComparison.Ordinal) ? DemoStickerPng(path)
                : avatarPngs.TryGetValue(path, out var avatarPng) ? avatarPng
                : null,
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "ivanov",
                FullName = "Иван Иванов",
                Email = "ivanov@zsgp.ru",
                AvatarUrl = "avatars/u7.png",
                Role = "admin",
                IsTwoFactorEnabled = true,
                TrustedDevicesCount = 2,
                Permissions = ["mfu.read", "computers.read_all", "hub.absences.manage"],
            },
            TasksPage = new HubTaskListPage { Items = tasks, Total = tasks.Length },
            TaskDetail = new HubTaskDetail
            {
                Id = 1,
                Title = "Согласовать договор поставки сетевого оборудования",
                Status = "review",
                Description = "Проверить условия оплаты и сроки поставки, согласовать с юристами и финансовым отделом.",
                DueAt = now.AddDays(1),
                AssigneeFullName = "Иван Иванов",
                ControllerFullName = "Ольга Смирнова",
                DepartmentName = "IT-отдел",
                ProjectName = "Закупки 2025",
                SubtasksTotal = 2,
                SubtasksDone = 1,
                Subtasks =
                [
                    new HubSubtaskItem
                    {
                        Id = 11, Title = "Запросить счёт у поставщика",
                        Status = "done", AssigneeFullName = "Иван Иванов",
                    },
                    new HubSubtaskItem
                    {
                        Id = 12, Title = "Согласовать смету с финансовым отделом",
                        Status = "in_progress", AssigneeFullName = "Петров И. С.",
                        DueAt = now.AddDays(2),
                    },
                ],
                Capabilities = new HubTaskCapabilities { CanReview = true, CanCreateSubtask = true },
            },
            TaskAssignees = new HubTaskUserList
            {
                Items =
                [
                    new HubTaskUserItem { Id = 7, Username = "ivanov", FullName = "Иван Иванов", Department = "IT-отдел" },
                    new HubTaskUserItem { Id = 8, Username = "petrov", FullName = "Петров И. С.", Department = "IT-отдел" },
                    new HubTaskUserItem { Id = 9, Username = "smirnova", FullName = "Смирнова О. В.", Department = "Бухгалтерия" },
                ],
                Total = 3,
            },
            TaskControllers = new HubTaskUserList
            {
                Items =
                [
                    new HubTaskUserItem { Id = 9, Username = "smirnova", FullName = "Смирнова О. В.", Department = "Бухгалтерия" },
                    new HubTaskUserItem { Id = 10, Username = "kozlov", FullName = "Козлов С. А.", Department = "IT-отдел" },
                ],
            },
            TaskProjects = new HubTaskProjectList
            {
                Items =
                [
                    new HubTaskProject { Id = "p-1", Name = "Закупки 2025", Code = "ZAK-25" },
                    new HubTaskProject { Id = "p-2", Name = "Модернизация ЦОД", Code = "DC-2" },
                ],
            },
            TaskObjects = new HubTaskObjectList
            {
                Items =
                [
                    new HubTaskObject { Id = "o-1", ProjectId = "p-1", Name = "Сетевое оборудование" },
                    new HubTaskObject { Id = "o-2", ProjectId = "p-1", Name = "Серверы" },
                    new HubTaskObject { Id = "o-3", ProjectId = "p-2", Name = "СХД" },
                ],
            },
            TaskAnalyticsPayload = new HubTaskAnalyticsPayload
            {
                Summary = new HubTaskAnalyticsMetrics
                {
                    Total = 42, New = 6, InProgress = 9, Review = 4, Done = 23,
                    Open = 19, DoneOnTime = 18, DoneWithoutDue = 2, Overdue = 3,
                    WithDueTotal = 35, CompletionPercent = 54.8, CompletionOnTimePercent = 78.3,
                },
                StatusBreakdown =
                [
                    new HubTaskAnalyticsStatusItem { Status = "new", Label = "Новые", Value = 6 },
                    new HubTaskAnalyticsStatusItem { Status = "in_progress", Label = "В работе", Value = 9 },
                    new HubTaskAnalyticsStatusItem { Status = "review", Label = "На проверке", Value = 4 },
                    new HubTaskAnalyticsStatusItem { Status = "done", Label = "Выполнено", Value = 23 },
                ],
                ByParticipant =
                [
                    new HubTaskAnalyticsParticipant { ParticipantUserId = 7, ParticipantName = "Иван Иванов", Total = 18, Done = 11, Open = 7, Overdue = 1 },
                    new HubTaskAnalyticsParticipant { ParticipantUserId = 8, ParticipantName = "Петров И. С.", Total = 14, Done = 8, Open = 6, Overdue = 2 },
                    new HubTaskAnalyticsParticipant { ParticipantUserId = 9, ParticipantName = "Смирнова О. В.", Total = 10, Done = 4, Open = 6 },
                ],
                ByProject =
                [
                    new HubTaskAnalyticsProject { ProjectId = "p-1", ProjectName = "Закупки 2025", Total = 26, Done = 15, Open = 11, Overdue = 2 },
                    new HubTaskAnalyticsProject { ProjectId = "p-2", ProjectName = "Модернизация ЦОД", Total = 16, Done = 8, Open = 8, Overdue = 1 },
                ],
                ByObject =
                [
                    new HubTaskAnalyticsObject { ObjectId = "o-1", ObjectName = "Сетевое оборудование", Total = 12, Done = 7, Open = 5 },
                    new HubTaskAnalyticsObject { ObjectId = "o-3", ObjectName = "СХД", Total = 9, Done = 3, Open = 6, Overdue = 1 },
                ],
                Trend = new HubTaskAnalyticsTrend
                {
                    Granularity = "week",
                    Items =
                    [
                        new HubTaskAnalyticsTrendItem { BucketLabel = "3 ноя", Created = 4, Completed = 3, CompletedOnTime = 3 },
                        new HubTaskAnalyticsTrendItem { BucketLabel = "10 ноя", Created = 6, Completed = 5, CompletedOnTime = 4 },
                        new HubTaskAnalyticsTrendItem { BucketLabel = "17 ноя", Created = 5, Completed = 7, CompletedOnTime = 6 },
                    ],
                },
            },
            MailTemplates =
            [
                new HubMailTemplate
                {
                    Id = "tpl-1", Title = "Заявка на доступ к ресурсу", Category = "Доступы",
                    IsActive = true,
                    Fields =
                    [
                        new HubMailTemplateField { Key = "resource", Label = "Ресурс", Type = "text", Required = true, Placeholder = "\\\\fs-01\\share", Order = 1 },
                        new HubMailTemplateField { Key = "access_level", Label = "Уровень доступа", Type = "select", Required = true, Options = ["Чтение", "Запись", "Полный"], Order = 2 },
                        new HubMailTemplateField { Key = "until", Label = "Действует до", Type = "date", Required = false, Order = 3 },
                        new HubMailTemplateField { Key = "reason", Label = "Обоснование", Type = "textarea", Required = true, Order = 4 },
                    ],
                },
                new HubMailTemplate
                {
                    Id = "tpl-2", Title = "Заказ расходных материалов", Category = "Снабжение",
                    IsActive = true,
                    Fields =
                    [
                        new HubMailTemplateField { Key = "item", Label = "Наименование", Type = "text", Required = true, Order = 1 },
                        new HubMailTemplateField { Key = "qty", Label = "Количество", Type = "text", Required = true, Order = 2 },
                    ],
                },
            ],
            Dashboard = new HubDashboard
            {
                GeneratedAt = now,
                Summary = new HubDashboardSummary
                {
                    TasksOverdue = 1,
                    TasksReviewRequired = 1,
                    TasksOpenTotal = 5,
                    AnnouncementsAttention = 2,
                    AbsencesToday = 3,
                },
                MyTasks = new HubTaskListPage { Items = tasks, Total = tasks.Length },
                Announcements = new HubAnnouncementList
                {
                    Items =
                    [
                        Announcement(now, "a1", "Плановые работы в дата-центре",
                            "В субботу с 08:00 до 12:00 будут проводиться регламентные работы на СХД.",
                            ageHours: 24, ackPending: true),
                        Announcement(now, "a2", "Обновление мобильного приложения",
                            "Вышла версия 2.4 — push-уведомления и тёмная тема.",
                            ageHours: 19),
                        Announcement(now, "a3", "Итоги года: корпоративный вечер",
                            "Приглашаем 20 декабря в конференц-зал.",
                            ageHours: 55),
                    ],
                    UnreadTotal = 2,
                },
                AbsencesToday = new HubAbsenceList
                {
                    Items =
                    [
                        Absence("Пётр Петров", "Отпуск", "2025-11-10", "2025-11-21", "zup"),
                        Absence("Мария Сидорова", "Больничный", "2025-11-14", "2025-11-18", "zup"),
                        Absence("Алексей Смирнов", "Командировка", "2025-11-17", "2025-11-17", "hub"),
                    ],
                    Count = 3,
                },
            },
            AnnouncementsPage = new HubAnnouncementListPage
            {
                Items =
                [
                    NewsItem(now, "a1", "Плановые работы в дата-центре",
                        "В субботу с 08:00 до 12:00 будут проводиться регламентные работы на системах хранения. Возможны кратковременные перерывы в работе файловых служб.",
                        ageHours: 24,
                        pinned: true, ackPending: true, priority: "high", attachments: 2),
                    NewsItem(now, "a4", "Изменение политики информационной безопасности",
                        "Обновлены требования к паролям и двухфакторной аутентификации.",
                        ageHours: 44, unread: true),
                    NewsItem(now, "a2", "Обновление мобильного приложения",
                        "Вышла версия 2.4 — push-уведомления и тёмная тема.",
                        ageHours: 19, comments: 4),
                    NewsItem(now, "a5", "График работы в новогодние праздники",
                        "Дежурная смена IT с 1 по 8 января.",
                        ageHours: 40, comments: 1),
                    NewsItem(now, "a3", "Итоги года: корпоративный вечер",
                        "Приглашаем 20 декабря в конференц-зал.",
                        ageHours: 55, comments: 12),
                ],
                Total = 5,
                UnreadTotal = 2,
                AckPendingTotal = 1,
            },
            AnnouncementDetail = new HubAnnouncementItem
            {
                Id = "a1",
                Title = "Плановые работы в дата-центре",
                Preview = "В субботу с 08:00 до 12:00 регламентные работы.",
                Body = "Уважаемые коллеги!\n\nВ субботу с 08:00 до 12:00 будут проводиться плановые регламентные работы на системах хранения данных. В это время возможны кратковременные перерывы в работе файловых служб и портала HUB.\n\nПросим заранее сохранить документы и завершить критичные операции.",
                Priority = "high",
                PublishedAt = now.AddDays(-1),
                AuthorFullName = "ИТ-департамент",
                RequiresAck = true,
                IsAckPending = true,
                IsPinned = true,
                IsPinnedActive = true,
                CommentsCount = 5,
                CommentsEnabled = true,
                AttachmentsCount = 2,
                ReactionsEnabled = true,
                ReactionCounts = new Dictionary<string, int>
                {
                    ["like"] = 7,
                    ["wow"] = 3,
                    ["love"] = 1,
                },
                ReactionsCount = 11,
                ViewerReaction = "wow",
                ViewerHasLiked = false,
                LikesCount = 7,
                ViewerBookmarked = true,
                Poll = new HubAnnouncementPoll
                {
                    Id = "p1",
                    Question = "Удобно ли время работ?",
                    IsAnonymous = true,
                    HasVoted = true,
                    ViewerOptionIds = ["o2"],
                    TotalVotes = 14,
                    TotalVoters = 14,
                    Options =
                    [
                        new HubAnnouncementPollOption { Id = "o1", Text = "Да, оставить субботу", VotesCount = 9 },
                        new HubAnnouncementPollOption { Id = "o2", Text = "Лучше в воскресенье", VotesCount = 3, ViewerVoted = true },
                        new HubAnnouncementPollOption { Id = "o3", Text = "Перенести на ночь буднего дня", VotesCount = 2 },
                    ],
                },
                Attachments =
                [
                    new HubAnnouncementAttachment
                    {
                        Id = "att-1",
                        AnnouncementId = "a1",
                        FileName = "grafik-rabot.pdf",
                        FileMime = "application/pdf",
                        FileSize = 182_400,
                    },
                    new HubAnnouncementAttachment
                    {
                        Id = "att-2",
                        AnnouncementId = "a1",
                        FileName = "spisok-sistem.xlsx",
                        FileMime = "application/vnd.ms-excel",
                        FileSize = 48_200,
                    },
                ],
            },
            AnnouncementCommentsPage = new HubAnnouncementCommentPage
            {
                Total = 3,
                CommentsTotal = 5,
                Items =
                [
                    new HubAnnouncementComment
                    {
                        Id = "c1",
                        AnnouncementId = "a1",
                        Username = "petrova",
                        FullName = "Ирина Петрова",
                        Body = "А файловые шары отдела документооборота тоже будут недоступны?",
                        CreatedAt = now.AddHours(-20),
                        ReactionCounts = new Dictionary<string, int> { ["like"] = 4 },
                        ReplyCount = 1,
                    },
                    new HubAnnouncementComment
                    {
                        Id = "c2",
                        AnnouncementId = "a1",
                        Username = "smirnov",
                        FullName = "Алексей Смирнов",
                        Body = "Да, с 09:00 до 10:30 возможны перерывы. Точное время — в приложенном графике.",
                        CreatedAt = now.AddHours(-19),
                        ReplyToUsername = "petrova",
                        ReactionCounts = new Dictionary<string, int> { ["like"] = 2 },
                        ViewerReaction = "like",
                        CanEdit = true,
                        CanDelete = true,
                    },
                    new HubAnnouncementComment
                    {
                        Id = "c3",
                        AnnouncementId = "a1",
                        Username = "volkova",
                        FullName = "Елена Волкова",
                        Body = "Прикладываю чек-лист для дежурной смены.",
                        CreatedAt = now.AddHours(-16),
                        Attachments =
                        [
                            new HubAnnouncementCommentAttachment
                            {
                                Id = "ca-1",
                                CommentId = "c3",
                                FileName = "checklist.docx",
                                FileMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                FileSize = 24_100,
                            },
                        ],
                    },
                ],
            },
            AbsencesList = new HubAbsenceRangeList
            {
                // Ручные записи: source="manual" и числовой id — у них кнопки
                // «Изменить»/«Удалить» (demo-пользователь admin с hub.absences.manage).
                Items =
                [
                    Absence("Алексей Смирнов", "Командировка", "2025-11-17", "2025-11-17", "manual", "41"),
                    Absence("Елена Волкова", "Другое", "2025-11-17", "2025-11-17", "manual", "42"),
                ],
                ZupItems =
                [
                    Absence("Пётр Петров", "Отпуск", "2025-11-10", "2025-11-21", "zup", "zup:P-2"),
                    Absence("Мария Сидорова", "Больничный", "2025-11-14", "2025-11-18", "zup", "zup:S-3"),
                    Absence("Дмитрий Козлов", "Отпуск", "2025-11-17", "2025-11-28", "zup", "zup:K-4"),
                ],
                ZupCount = 3,
            },
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conversation("c1", "group", "IT-отдел", unread: 5, pinned: true,
                        preview: "Согласовал бюджет на следующий год", at: now.AddMinutes(-12), members: 12, online: 4, role: "owner",
                        avatar: "avatars/c1.png"),
                    Conversation("c2", "direct", "Ирина Петрова", unread: 2,
                        preview: "Посмотри, пожалуйста, отчёт", at: now.AddHours(-2),
                        peer: new HubChatUser
                        {
                            Id = 11, Username = "petrova", FullName = "Ирина Петрова",
                            AvatarUrl = "avatars/u11.png",
                            // «В сети» — строка статуса карточки собеседника (tg-profile).
                            Presence = new HubChatPresence { IsOnline = true },
                        }),
                    Conversation("c3", "support", "Поддержка HUB", unread: 0,
                        preview: "Ваш запрос принят в работу", at: now.AddHours(-5)),
                    Conversation("c4", "notes", "Заметки", unread: 0,
                        preview: "Список дел: документы, почта…", at: now.AddDays(-1)),
                    Conversation("c5", "direct", "Сергей Козлов", unread: 0,
                        preview: "Ок, спасибо!", at: now.AddDays(-2),
                        peer: new HubChatUser
                        {
                            Id = 12, Username = "kozlov", FullName = "Сергей Козлов",
                            AvatarUrl = "avatars/u12.png",
                        }),
                ],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Message("m1", "c1", "Коллеги, доброе утро! Напоминаю про планёрку в 10:00 — обсудим релизные окна.", "Ирина Петрова", now.AddMinutes(-58),
                        senderAvatar: "avatars/u11.png"),
                    Message("m2", "c1", "Всем привет! Буду чуть позже — заканчиваю отчёт по инцидентам.", null, now.AddMinutes(-54), own: true),
                    Message("m3", "c1", "Ок, тогда начнём без тебя, протокол скину.", "Пётр Петров", now.AddMinutes(-50),
                        reply: new HubChatReplyPreview { SenderName = "Иван Иванов", Body = "Всем привет! Буду чуть позже" },
                        senderAvatar: "avatars/u14.png"),
                    Message("m4", "c1", "Выкладываю презентацию и смету к проекту", null, now.AddMinutes(-41), own: true,
                        attachments: 2),
                    // Фото-сообщение: плитки-превью в пузыре и кадр просмотрщика 04j.
                    Message("m4b", "c1", "Схема стойки — так пойдёт?", "Дмитрий Козлов", now.AddMinutes(-38),
                        images: 2, senderAvatar: "avatars/u13.png"),
                    Message("m5", "c1", "Посмотрела — всё огонь, по смете один вопрос в личке", "Ирина Петрова", now.AddMinutes(-33),
                        reactions: [new HubChatReaction { Emoji = "👍", Count = 3 }, new HubChatReaction { Emoji = "🔥", Count = 1 }],
                        senderAvatar: "avatars/u11.png"),
                    Message("m6", "c1", "Кстати, сервер бэкапов переехал в стойку 4", "Дмитрий Козлов", now.AddMinutes(-20), edited: true,
                        senderAvatar: "avatars/u13.png"),
                    Message("m7", "c1", "удалённое", "Дмитрий Козлов", now.AddMinutes(-18), deleted: true,
                        senderAvatar: "avatars/u13.png"),
                    Message("m8", "c1", "Согласовал бюджет на следующий год", "Пётр Петров", now.AddMinutes(-12),
                        senderAvatar: "avatars/u14.png"),
                ],
                HasOlder = true,
                OlderCursorMessageId = "m1",
                // Прочитано до m4 — полоса «Непрочитанные сообщения» встаёт
                // над m4b (первый входящий после якоря) на каждом открытии
                // диалога с unread>0 — dark c1/c2, light c1/c5.
                ViewerLastReadMessageId = "m4",
            },
            // Группа c1: участники с ролями и ограничением (viewer — owner).
            ConversationDetailResult = new HubChatConversationDetail
            {
                Id = "c1",
                Kind = "group",
                Title = "IT-отдел",
                Description = "Канал дежурной смены: инциденты, релизы, доступы.",
                MemberCount = 12,
                OnlineMemberCount = 4,
                ViewerMemberRole = "owner",
                // Тот же avatar_url, что в списке: Update(detail) не сбрасывает фото.
                AvatarUrl = "avatars/c1.png",
                Members =
                [
                    new HubChatMember
                    {
                        User = new HubChatUser
                        {
                            Id = 7, Username = "ivanov", FullName = "Иван Иванов",
                            AvatarUrl = "avatars/u7.png",
                        },
                        MemberRole = "owner",
                    },
                    new HubChatMember
                    {
                        User = new HubChatUser
                        {
                            Id = 11, Username = "petrova", FullName = "Ирина Петрова",
                            AvatarUrl = "avatars/u11.png",
                        },
                        MemberRole = "moderator",
                    },
                    new HubChatMember
                    {
                        User = new HubChatUser
                        {
                            Id = 13, Username = "kozlov", FullName = "Дмитрий Козлов",
                            AvatarUrl = "avatars/u13.png",
                        },
                        MemberRole = "member",
                        IsRestricted = true,
                        RestrictedUntil = now.AddDays(1),
                    },
                    new HubChatMember
                    {
                        User = new HubChatUser
                        {
                            Id = 14, Username = "petrov", FullName = "Пётр Петров",
                            AvatarUrl = "avatars/u14.png",
                        },
                        MemberRole = "member",
                    },
                ],
            },
            JoinRequestsResult = new HubChatJoinRequestList
            {
                Items =
                [
                    new HubChatJoinRequestItem
                    {
                        Id = 11,
                        UserId = 55,
                        UserName = "Анна Смирнова",
                        CreatedAt = now.AddHours(-3),
                    },
                ],
                OpenCount = 1,
                ApprovalRequired = true,
            },
            ReportsResult = new HubChatMessageReportList
            {
                Items =
                [
                    new HubChatMessageReport
                    {
                        Id = 21,
                        MessageId = "m8",
                        Reason = "other",
                        Comment = "проверить формулировку",
                        ReporterName = "Ирина Петрова",
                        SenderName = "Пётр Петров",
                        MessagePreview = "Согласовал бюджет на следующий год",
                        CreatedAt = now.AddHours(-1),
                    },
                ],
                OpenCount = 1,
            },
            ShareableTasksResult = new HubChatShareableTaskList
            {
                Items =
                [
                    new HubChatTaskPreview
                    {
                        Id = "101",
                        Title = "Инвентаризация склада",
                        Status = "in_progress",
                        AssigneeFullName = "Иван Иванов",
                        DueAt = now.AddDays(3),
                    },
                ],
            },

            // Секция «Сообщения» выдачи списка-поиска (tg-search).
            GlobalSearchResult = new HubChatGlobalSearchResult
            {
                Items =
                [
                    new HubChatGlobalSearchHit
                    {
                        ConversationId = "c2",
                        ConversationTitle = "Ирина Петрова",
                        MessageId = "gm1",
                        SenderName = "Ирина Петрова",
                        Preview = "Посмотри, пожалуйста, отчёт",
                        CreatedAt = now.AddHours(-2),
                    },
                    new HubChatGlobalSearchHit
                    {
                        ConversationId = "c1",
                        ConversationTitle = "IT-отдел",
                        MessageId = "m3",
                        SenderName = "Пётр Петров",
                        Preview = "Ок, тогда начнём без тебя, протокол скину.",
                        CreatedAt = now.AddMinutes(-50),
                    },
                ],
            },

            // «Отправить позже»: серверный флаг + отложенные c1 —
            // два ожидающих и одно неотправленное (красная строка панели).
            ChatConfig = new HubChatConfig
            {
                GroupMaxMembers = 200,
                ScheduledMessagesEnabled = true,
            },
            ScheduledItems =
            {
                ["c1"] =
                [
                    new HubChatScheduledMessage
                    {
                        Id = "s1",
                        ConversationId = "c1",
                        Body = "Напомнить про релизное окно завтра утром",
                        BodyFormat = "plain",
                        Status = "scheduled",
                        ScheduledFor = now.AddHours(3),
                        CreatedAt = now.AddHours(-1),
                    },
                    new HubChatScheduledMessage
                    {
                        Id = "s2",
                        ConversationId = "c1",
                        Body = "Согласовать бюджет с закупкой до конца недели",
                        BodyFormat = "plain",
                        Status = "scheduled",
                        ScheduledFor = now.AddDays(1).Date.AddHours(9),
                        CreatedAt = now.AddHours(-2),
                    },
                    new HubChatScheduledMessage
                    {
                        Id = "s3",
                        ConversationId = "c1",
                        Body = "Уточнить окно обновления кластера",
                        BodyFormat = "plain",
                        Status = "failed",
                        AttemptCount = 3,
                        ScheduledFor = now.AddMinutes(-40),
                        ErrorText = "Диалог был удалён",
                        CreatedAt = now.AddDays(-1),
                    },
                ],
            },

            // Стикерпаки (/chat/sticker-packs): два набора «мордочек» — превью
            // грузятся AuthImageLoader из chat/stickers/* (DemoStickerPng),
            // вкладка «Стикеры» панели показывает паки + сетку как tg-stickers.
            ChatStickerPacks = new HubChatStickerPackList
            {
                Items =
                [
                    new HubChatStickerPack
                    {
                        Id = "pack-animals",
                        ShortName = "hub_animals",
                        Title = "Лесные звери",
                        StickerType = "static",
                        IsAdded = true,
                        Stickers =
                        [
                            Sticker("sa1", "🐻"), Sticker("sa2", "🦊"), Sticker("sa3", "🐼"),
                            Sticker("sa4", "🐨"), Sticker("sa5", "🦁"), Sticker("sa6", "🐸"),
                            Sticker("sa7", "🐵"), Sticker("sa8", "🐰"), Sticker("sa9", "🐯"),
                            Sticker("sa10", "🐷"),
                        ],
                    },
                    new HubChatStickerPack
                    {
                        Id = "pack-smiles",
                        ShortName = "hub_smiles",
                        Title = "Смайлы HUB",
                        StickerType = "static",
                        IsAdded = true,
                        Stickers =
                        [
                            Sticker("sb1", "😺"), Sticker("sb2", "😎"), Sticker("sb3", "🥳"),
                            Sticker("sb4", "😴"), Sticker("sb5", "🤖"), Sticker("sb6", "👻"),
                        ],
                    },
                ],
            },

            // ---- Почта (Exchange) ----
            MailBootstrap = new HubMailBootstrap
            {
                SelectedMailbox = new HubMailMailboxInfo
                {
                    Id = "mbx-1",
                    MailboxId = "mbx-1",
                    Label = "ivanov@zsgp.ru",
                    MailboxEmail = "ivanov@zsgp.ru",
                    MailboxLogin = "ivanov",
                    AuthMode = "password",
                    IsPrimary = true,
                    IsActive = true,
                    IsSelected = true,
                    MailIsConfigured = true,
                    UnreadCount = 3,
                },
                UnreadCount = 3,
                FolderTree = new HubMailFolderTree
                {
                    Items =
                    [
                        MailFolder("inbox", "Входящие", "inbox", total: 42, unread: 3),
                        MailFolder("sent", "Отправленные", "sent", total: 128),
                        MailFolder("drafts", "Черновики", "drafts", total: 2),
                        MailFolder("archive", "Архив", "archive", total: 215),
                        MailFolder("junk", "Нежелательная почта", "junk", total: 5),
                        MailFolder("trash", "Удалённые", "trash", total: 9),
                        MailFolder("f-it", "Проекты ИТ", wellKnown: null, total: 17, unread: 1),
                        MailFolder("f-it-arch", "Архитектура ПО", wellKnown: null, total: 6, parentId: "f-it"),
                    ],
                    Favorites = ["inbox"],
                },
                Messages = mailPage,
                State = "ok",
                Source = "exchange",
            },
            MailMessagesPage = mailPage,
            // Infinite scroll: offset-пагинация — вторая страница отдаётся по запросу offset>=8;
            // «Нежелательная почта» пуста — кадр пустых состояний списка и чтения.
            MailMessagesPageFactory = query => query.Folder == "junk"
                ? new HubMailMessagePage { Folder = "junk", Limit = 25, Total = 0 }
                : query.Offset >= 8 ? MailSecondPage(now) : mailPage,
            MailMessageDetail = new HubMailMessageDetail
            {
                Id = "m1",
                MailboxId = "mbx-1",
                Folder = "inbox",
                Subject = "Регламентные работы в ДЦ — график на выходные",
                SenderName = "Ирина Петрова",
                SenderEmail = "petrova@zsgp.ru",
                SenderDisplay = "Ирина Петрова <petrova@zsgp.ru>",
                To = ["ivanov@zsgp.ru"],
                ToPeople =
                [
                    new HubMailPerson { Name = "Иван Иванов", Email = "ivanov@zsgp.ru" },
                ],
                Cc = ["it-dep@zsgp.ru"],
                ReceivedAt = Iso(now.AddHours(-1)),
                IsRead = false,
                Importance = "high",
                BodyText =
                    "Добрый день!\n\nВ субботу с 08:00 до 12:00 проводим регламентные работы " +
                    "на СХД в основном дата-центре. Файловые службы и портал HUB могут " +
                    "кратковременно быть недоступны.\n\nГрафик во вложении. Просьба " +
                    "предупредить дежурных администраторов филиалов.\n\nС уважением, Ирина",
                // Демо-письмо с html-телом — кадр проходит ветку WebView2-ридера
                // (или её текстовый fallback, если инициализация недоступна).
                BodyHtml =
                    "<p>Добрый день!</p>" +
                    "<p>В субботу с <b>08:00 до 12:00</b> проводим регламентные работы " +
                    "на СХД в основном дата-центре. Файловые службы и портал " +
                    "<a href=\"https://hub.zsgp.ru\">HUB</a> могут кратковременно " +
                    "быть недоступны.</p>" +
                    "<p>График во вложении. Просьба предупредить дежурных " +
                    "администраторов филиалов.</p>" +
                    "<blockquote><p>Первичное уведомление от 10.11: окно работ " +
                    "согласовано со службой эксплуатации ДЦ.</p></blockquote>" +
                    "<p>С уважением,<br>Ирина</p>",
                Attachments =
                [
                    new HubMailAttachment
                    {
                        Id = "att-1",
                        Name = "grafik-rabot.pdf",
                        ContentType = "application/pdf",
                        Size = 182_400,
                        Downloadable = true,
                    },
                    new HubMailAttachment
                    {
                        Id = "att-2",
                        Name = "spisok-sistem.xlsx",
                        ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        Size = 48_100,
                        Downloadable = true,
                    },
                ],
                CanArchive = true,
                CanMove = true,
            },
            MailUnreadCount = new HubMailUnreadCount { Count = 3, State = "ok" },

            // ---- Документооборот 1С ----
            DocflowTasksPage = new HubDocflowTaskListPage
            {
                Items =
                [
                    DocflowTask("df-1042", "Поручение", "Согласовать договор поставки № 118",
                        "Смирнова О. В.", now.AddDays(-2), dueAt: now.AddDays(1),
                        importance: "Высокая"),
                    DocflowTask("df-1038", "Входящий документ", "Счёт на оплату лицензий 1С",
                        "Бухгалтерия", now.AddDays(-3), dueAt: now.AddDays(3)),
                    DocflowTask("df-1031", "Согласование", "Акт ввода в эксплуатацию сервера SRV-12",
                        "Козлов С. А.", now.AddDays(-5), dueAt: now.AddDays(-1)),
                    DocflowTask("df-1027", "Поручение", "Отчёт по инцидентам за месяц",
                        "Петров И. С.", now.AddDays(-7), dueAt: now.AddDays(5)),
                ],
                Returned = 4,
                Total = 4,
                Scope = "inbox",
            },
            DocflowTaskDetail = new HubDocflowTaskDetail
            {
                Ref = "df-1042",
                TaskTypeLabel = "Поручение",
                Title = "Согласовать договор поставки № 118",
                Number = "0000-118",
                CreatedAt = Iso(now.AddDays(-2)),
                DueAt = Iso(now.AddDays(1)),
                Author = "Смирнова О. В.",
                Subject = "Договор поставки оргтехники № 118",
                Description = "Согласовать условия договора поставки: 24 системных блока, " +
                    "30 мониторов и периферия для филиала «Центральный». Оплата — 30 дней после поставки.",
                BusinessState = "На исполнении",
                Importance = "Высокая",
                ProcessName = "Согласование внутреннего документа",
                ProcessTypeLabel = "Согласование",
                AvailableActions =
                [
                    new HubDocflowAction { Code = "complete", Label = "Выполнить", Tone = "primary" },
                    new HubDocflowAction
                    {
                        Code = "reject",
                        Label = "Отклонить",
                        Tone = "danger",
                        CommentMode = "required",
                    },
                ],
                Files =
                [
                    new HubDocflowFile
                    {
                        Ref = "f-1",
                        Name = "dogovor-118.pdf",
                        Extension = "pdf",
                        ContentType = "application/pdf",
                        Size = 512_300,
                        PreviewSupported = true,
                    },
                    new HubDocflowFile
                    {
                        Ref = "f-2",
                        Name = "specifikaciya.xlsx",
                        Extension = "xlsx",
                        ContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        Size = 61_900,
                    },
                ],
                RelatedObjects =
                [
                    new HubDocflowRelatedObject
                    {
                        Ref = "doc-118",
                        ObjectType = "internal",
                        ObjectTypeLabel = "Внутренний документ",
                        Title = "Договор поставки № 118 от 10.11.2025",
                    },
                ],
            },
            DocflowInboxSummary = new HubDocflowInboxSummary { Status = "ok", Count = 4 },
            DocflowProfile = new HubDocflowProfile
            {
                Configured = true,
                Login = "ivanov",
                Status = "ok",
                LastVerifiedAt = now.AddHours(-3),
            },
            DocflowAssignmentCapability = new HubDocflowAssignmentCapability
            {
                Enabled = true,
                TestOnly = false,
                DocumentTypes = ["internal", "incoming"],
            },

            // ---- Заявки на билеты ----
            TicketsPage = new HubTicketListPage
            {
                Items =
                [
                    ticket1,
                    Ticket(102, "Козлов С. А.", "at_cashier",
                        objectName: "РЦ «Южный»", departure: "2025-11-19",
                        route: "Тюмень → Южный", cost: "18450.00",
                        assignee: "Петров И. С."),
                    Ticket(103, "Волкова Е. Н.", "purchased",
                        objectName: "РЦ «Западный»", departure: "2025-11-14",
                        route: "Тюмень → Западный", cost: "12300.00",
                        assignee: "Смирнова О. В."),
                    Ticket(104, "Сидорова М. К.", "exchange_needed",
                        objectName: "РЦ «Северный»", departure: "2025-11-16",
                        route: "Тюмень → Северный", cost: "9800.00",
                        needsReview: true, assignee: "Иванов И. П."),
                    Ticket(105, "Кузнецов А. Д.", "not_started",
                        objectName: "ЦО «Главный»", departure: "2025-11-22",
                        route: "Тюмень → Главный"),
                ],
                Total = 5,
                Page = 1,
                PageSize = 25,
                TotalPages = 1,
            },
            TicketDetail = ticket1,
            TicketCommentsPage = new HubTicketCommentPage
            {
                Items =
                [
                    new HubTicketComment
                    {
                        Id = 11,
                        RequestId = 101,
                        AuthorId = 9,
                        Text = "Бронирую ЖД на 19.11, место в купе.",
                        CommentType = "normal",
                        CreatedAt = Iso(now.AddHours(-6)),
                    },
                    new HubTicketComment
                    {
                        Id = 12,
                        RequestId = 101,
                        AuthorId = 7,
                        Text = "Подтверждаю, нужен нижний ярус, окно у прохода.",
                        CommentType = "normal",
                        CreatedAt = Iso(now.AddHours(-5)),
                    },
                    new HubTicketComment
                    {
                        Id = 13,
                        RequestId = 101,
                        Text = "Статус изменён: «В кассах».",
                        CommentType = "system",
                        CreatedAt = Iso(now.AddHours(-4)),
                    },
                ],
                Total = 3,
                Page = 1,
                TotalPages = 1,
            },
            TicketHistory = new HubTicketHistoryPage
            {
                Items =
                [
                    new HubTicketHistoryEntry
                    {
                        Id = 31,
                        RequestId = 101,
                        FieldName = "status",
                        OldValue = "not_started",
                        NewValue = "at_cashier",
                        ChangedById = 9,
                        Source = "web",
                        CreatedAt = Iso(now.AddHours(-4)),
                    },
                    new HubTicketHistoryEntry
                    {
                        Id = 30,
                        RequestId = 101,
                        FieldName = "assignee_id",
                        OldValue = null,
                        NewValue = "9",
                        ChangedById = 7,
                        Source = "web",
                        CreatedAt = Iso(now.AddDays(-1)),
                    },
                    new HubTicketHistoryEntry
                    {
                        Id = 29,
                        RequestId = 101,
                        FieldName = "route",
                        OldValue = null,
                        NewValue = "Тюмень → РЦ «Восточный»",
                        ChangedById = 7,
                        Source = "web",
                        CreatedAt = Iso(now.AddDays(-1).AddHours(-2)),
                    },
                ],
                Total = 3,
                Page = 1,
                TotalPages = 1,
            },
            TicketAttachments = new HubTicketAttachmentList
            {
                Items =
                [
                    new HubTicketAttachment
                    {
                        Id = "att-9",
                        RequestId = 101,
                        FileName = "komandirovochnoe.pdf",
                        FileType = "application/pdf",
                        FileSize = 245_800,
                        CreatedAt = Iso(now.AddDays(-1)),
                    },
                ],
            },
            TicketObjects = new HubTicketObjectList
            {
                Items =
                [
                    new HubTicketObject { Id = 1, Code = "RC-EAST", Name = "РЦ «Восточный»", Region = "Тюменская область" },
                    new HubTicketObject { Id = 2, Code = "RC-SOUTH", Name = "РЦ «Южный»", Region = "Тюменская область" },
                    new HubTicketObject { Id = 3, Code = "RC-WEST", Name = "РЦ «Западный»", Region = "ХМАО" },
                ],
            },
            TicketKanban = new Dictionary<string, IReadOnlyList<HubTicketKanbanCard>>
            {
                ["Не запущен"] =
                [
                    KanbanCard(105, "Кузнецов А. Д.", "ЦО «Главный»", "not_started",
                        "2025-11-22", "Тюмень → Главный"),
                ],
                ["В кассах"] =
                [
                    KanbanCard(101, "Петров И. С.", "РЦ «Восточный»", "at_cashier",
                        "2025-11-19", "Тюмень → Восточный", urgent: true,
                        assignee: "Иванов И. П."),
                    KanbanCard(102, "Козлов С. А.", "РЦ «Южный»", "at_cashier",
                        "2025-11-19", "Тюмень → Южный", assignee: "Петров И. С."),
                ],
                ["Куплен"] =
                [
                    KanbanCard(103, "Волкова Е. Н.", "РЦ «Западный»", "purchased",
                        "2025-11-14", "Тюмень → Западный", assignee: "Смирнова О. В."),
                ],
                ["Возврат/обмен"] =
                [
                    KanbanCard(104, "Сидорова М. К.", "РЦ «Северный»", "exchange_needed",
                        "2025-11-16", "Тюмень → Северный", urgent: true,
                        assignee: "Иванов И. П."),
                ],
                ["Отмена"] = [],
                ["Проблема"] =
                [
                    KanbanCard(106, "Громов П. Л.", "РЦ «Восточный»", "refund_needed",
                        "2025-11-15", "Тюмень → Восточный", urgent: true),
                ],
            },

            // ---- Адресная книга ----
            AddressBookPage = new HubAddressBookPage
            {
                Items =
                [
                    AddressEntry("Петров Иван Сергеевич", "Начальник отдела",
                        "ИТ-департамент", "Тюмень", "+7 (3452) 55-10-01", "petrov@zsgp.ru",
                        office: "Офис 412"),
                    AddressEntry("Смирнова Ольга Викторовна", "Ведущий инженер",
                        "ИТ-департамент", "Тюмень", "+7 (3452) 55-10-14", "smirnova@zsgp.ru",
                        office: "Офис 415"),
                    AddressEntry("Козлов Сергей Андреевич", "Инженер-сетевик",
                        "ИТ-департамент", "Тюмень", "+7 (3452) 55-11-21", "kozlov@zsgp.ru",
                        office: "Серверная, стойка 2"),
                    AddressEntry("Волкова Елена Николаевна", "Главный бухгалтер",
                        "Бухгалтерия", "Тюмень", "+7 (3452) 55-20-05", "volkova@zsgp.ru",
                        office: "Офис 301"),
                    AddressEntry("Громов Пётр Львович", "Начальник смены",
                        "Служба эксплуатации", "Санкт-Петербург", "+7 (812) 44-17-80",
                        "gromov@zsgp.ru", office: "Диспетчерская"),
                ],
                Total = 5,
                Limit = 50,
            },
            AddressBookFilters = new HubAddressBookFilters
            {
                Departments =
                [
                    new HubAddressBookFilterOption { Name = "ИТ-департамент", Count = 24 },
                    new HubAddressBookFilterOption { Name = "Бухгалтерия", Count = 11 },
                    new HubAddressBookFilterOption { Name = "Служба эксплуатации", Count = 38 },
                ],
                Cities =
                [
                    new HubAddressBookFilterOption { Name = "Тюмень", Count = 73 },
                    new HubAddressBookFilterOption { Name = "Санкт-Петербург", Count = 19 },
                ],
            },

            // ---- Мои файлы ----
            MyFileLibraries = new HubMyFileLibraryList
            {
                Items =
                [
                    new HubMyFileLibrary
                    {
                        Id = "lib-1",
                        Name = "ИТ-департамент",
                        FilesCount = 148,
                        MembersCount = 12,
                        MyRole = "edit",
                        QuotaBytes = 10L << 30,
                        UsedBytes = 4_300_000_000,
                    },
                    new HubMyFileLibrary
                    {
                        Id = "lib-2",
                        Name = "Проект «Архив 2025»",
                        FilesCount = 36,
                        MembersCount = 5,
                        MyRole = "view",
                        QuotaBytes = 5L << 30,
                        UsedBytes = 1_200_000_000,
                    },
                ],
            },
            MyFilesPage = new HubMyFileListPage
            {
                Folders =
                [
                    new HubMyFileFolder { Id = "fld-1", Name = "Документы", FileCount = 8, CreatedAt = now.AddDays(-30) },
                    new HubMyFileFolder { Id = "fld-2", Name = "Схемы сети", FileCount = 5, IsShared = true, CreatedAt = now.AddDays(-12) },
                    new HubMyFileFolder { Id = "fld-3", Name = "Отчёты", FileCount = 12, IsFavorite = true, CreatedAt = now.AddDays(-5) },
                ],
                Items =
                [
                    new HubMyFileItem
                    {
                        Id = "fl-1",
                        OriginalFileName = "Инструкция_VPN.pdf",
                        MimeType = "application/pdf",
                        OriginalSizeBytes = 1_240_000,
                        Status = "ready",
                        RetentionDays = 30,
                        CreatedAt = now.AddDays(-3),
                    },
                    new HubMyFileItem
                    {
                        Id = "fl-2",
                        OriginalFileName = "План_переезда_СХД.docx",
                        MimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        OriginalSizeBytes = 356_200,
                        Status = "ready",
                        RetentionDays = 30,
                        IsShared = true,
                        CreatedAt = now.AddDays(-6),
                    },
                    new HubMyFileItem
                    {
                        Id = "fl-3",
                        OriginalFileName = "backup-checklist.xlsx",
                        MimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        OriginalSizeBytes = 88_500,
                        Status = "ready",
                        RetentionDays = 7,
                        IsFavorite = true,
                        CreatedAt = now.AddDays(-1),
                    },
                    new HubMyFileItem
                    {
                        Id = "fl-4",
                        OriginalFileName = "topology-2025.vsdx",
                        MimeType = "application/vnd.visio",
                        OriginalSizeBytes = 2_418_000,
                        Status = "ready",
                        RetentionDays = 30,
                        CreatedAt = now.AddHours(-8),
                    },
                ],
            },

            // ---- Структура компании ----
            CompanyStructureTree = new HubCompanyStructureTree
            {
                Items =
                [
                    StructNode("root", null, "root", "ЗСГП",
                        person: "Громов А. В.", position: "Генеральный директор",
                        subtree: 96, children:
                        [
                            StructNode("dir-ops", "root", "directorate", "Служба эксплуатации",
                                person: "Савельев Д. К.", position: "Начальник службы",
                                subtree: 38, children:
                                [
                                    StructNode("dep-ops1", "dir-ops", "department", "Участок № 1", subtree: 14),
                                    StructNode("dep-ops2", "dir-ops", "department", "Участок № 2", subtree: 15),
                                ]),
                            StructNode("dep-acc", "root", "department", "Бухгалтерия", subtree: 11),
                            StructNode("dir-it", "root", "directorate", "Дирекция ИТ",
                                person: "Орлова Н. П.", position: "Директор по ИТ",
                                subtree: 24, children:
                                [
                                    StructNode("dep-infra", "dir-it", "department", "Отдел инфраструктуры", subtree: 9),
                                    StructNode("dep-support", "dir-it", "department", "Отдел поддержки", subtree: 8),
                                    StructNode("dep-dev", "dir-it", "department", "Отдел разработки", subtree: 7),
                                ]),
                        ]),
                ],
                Count = 10,
            },
            CompanyStructurePeople = new HubCompanyStructurePeople
            {
                Items =
                [
                    StructPerson("Миронова Алла Викторовна", "Тимлид", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-30", "mironova@zsgp.ru"),
                    StructPerson("Белов Роман Олегович", "Backend-разработчик", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-31", "belov@zsgp.ru"),
                    StructPerson("Захарова Инна Сергеевна", "Frontend-разработчик", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-32", "zakharova@zsgp.ru"),
                    StructPerson("Орлов Дмитрий Павлович", "QA-инженер", "Отдел разработки", "Санкт-Петербург", "+7 (812) 44-17-91", "orlov@zsgp.ru"),
                ],
                Total = 7,
            },
            CompanyStructurePeopleFactory = _ => new HubCompanyStructurePeople
            {
                Items =
                [
                    StructPerson("Миронова Алла Викторовна", "Тимлид", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-30", "mironova@zsgp.ru"),
                    StructPerson("Белов Роман Олегович", "Backend-разработчик", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-31", "belov@zsgp.ru"),
                    StructPerson("Захарова Инна Сергеевна", "Frontend-разработчик", "Отдел разработки", "Тюмень", "+7 (3452) 55-11-32", "zakharova@zsgp.ru"),
                    StructPerson("Орлов Дмитрий Павлович", "QA-инженер", "Отдел разработки", "Санкт-Петербург", "+7 (812) 44-17-91", "orlov@zsgp.ru"),
                ],
                Total = 7,
            },

            // ---- ИТ-объекты ----
            ItObjectsList = new HubItObjectList
            {
                Items =
                [
                    new HubItObject
                    {
                        ObjectRef = "ITINVENT:5",
                        Name = "РЦ «Восточный»",
                        Owner = new HubItObjectOwner { UserId = 7, UserName = "Иван Иванов" },
                        MyAccess = FullItAccess(owner: true),
                        Linked = true,
                    },
                    new HubItObject
                    {
                        ObjectRef = "ITINVENT:9",
                        Name = "РЦ «Южный»",
                        Owner = new HubItObjectOwner { UserId = 11, UserName = "Петров И. С." },
                        MyAccess = FullItAccess(),
                        Linked = true,
                    },
                    new HubItObject
                    {
                        ObjectRef = "ITINVENT:14",
                        Name = "РЦ «Северный»",
                        Owner = new HubItObjectOwner { UserId = 12, UserName = "Козлов С. А." },
                        MyAccess = FullItAccess(),
                        Linked = true,
                    },
                    new HubItObject
                    {
                        ObjectRef = "OBJ-HUB:2",
                        Name = "Серверная Б-2 (тестовая)",
                        Custom = true,
                        MyAccess = FullItAccess(),
                    },
                ],
                SourceDatabaseId = "main",
            },
            ItObjectDetail = new HubItObjectDetail
            {
                ObjectRef = "ITINVENT:5",
                Name = "РЦ «Восточный»",
                SourceDatabaseId = "main",
                Linked = true,
                Owner = new HubItObjectOwner
                {
                    UserId = 7,
                    UserName = "Иван Иванов",
                    ValidFrom = "2024-03-01",
                },
                MyAccess = FullItAccess(owner: true),
                CanManageOwner = true,
                CanManageGrants = true,
                Team =
                [
                    new HubItObjectTeamRole { RoleKey = "project_lead", FullName = "Орлова Н. П.", Position = "Руководитель проекта", Department = "Дирекция ИТ" },
                    new HubItObjectTeamRole { RoleKey = "pto_manager", FullName = "Савельев Д. К.", Position = "Начальник ПТО", Department = "Служба эксплуатации" },
                    new HubItObjectTeamRole { RoleKey = "chief_project_engineer", FullName = "Белов Р. О.", Position = "Главный инженер проекта", Department = "ИТ-департамент" },
                ],
                Grants =
                [
                    new HubItObjectGrant { UserId = 11, UserName = "Петров И. С.", Section = "monitoring", Level = "view", CreatedAt = Iso(now.AddDays(-40)) },
                    new HubItObjectGrant { UserId = 12, UserName = "Козлов С. А.", Section = "computers", Level = "manage", CreatedAt = Iso(now.AddDays(-12)) },
                ],
            },
            ItObjectComputersPage = new HubItObjectComputersPage
            {
                ObjectRef = "ITINVENT:5",
                DatabaseId = "main",
                Items =
                [
                    ItObjectComputer("3C:D9:2B:11:04:7A", "WS-EAST-014", "online",
                        "Сидорова М. К.", "sidorova", "10.24.5.114",
                        inv: "ИНВ-004521", model: "HP EliteDesk 800 G6"),
                    ItObjectComputer("3C:D9:2B:11:04:9C", "WS-EAST-015", "online",
                        "Громов П. Л.", "gromov", "10.24.5.115",
                        inv: "ИНВ-004522", model: "HP EliteDesk 800 G6"),
                    ItObjectComputer("3C:D9:2B:11:05:1B", "WS-EAST-021", "offline",
                        "Кузнецов А. Д.", "kuznetsov", "10.24.5.121",
                        inv: "ИНВ-004487", model: "Dell OptiPlex 7090"),
                ],
            },
            ItObjectInventoryPage = new HubItObjectInventoryPage
            {
                ObjectRef = "ITINVENT:5",
                DatabaseId = "main",
                BranchName = "РЦ «Восточный»",
                Items =
                [
                    new HubItObjectInventoryItem { InvNo = "004521", TypeName = "Системный блок", ModelName = "HP EliteDesk 800 G6", VendorName = "HP", SerialNo = "CZC1432K8P", Status = "Эксплуатация", EmployeeName = "Сидорова М. К.", Location = "Кабинет 214" },
                    new HubItObjectInventoryItem { InvNo = "004522", TypeName = "Системный блок", ModelName = "HP EliteDesk 800 G6", VendorName = "HP", SerialNo = "CZC1432K9R", Status = "Эксплуатация", EmployeeName = "Громов П. Л.", Location = "Кабинет 214" },
                    new HubItObjectInventoryItem { InvNo = "004533", TypeName = "МФУ", ModelName = "Kyocera ECOSYS M2735dw", VendorName = "Kyocera", SerialNo = "X3N8452107", Status = "Эксплуатация", EmployeeName = "Отдел продаж", Location = "Опенспейс, ряд 3" },
                    new HubItObjectInventoryItem { InvNo = "004601", TypeName = "Коммутатор", ModelName = "Cisco Catalyst 2960-X", VendorName = "Cisco", SerialNo = "FCW2145A1BZ", IpAddress = "10.24.5.2", Status = "Эксплуатация", Location = "Серверная, стойка 2" },
                ],
                Total = 4,
                Page = 1,
                Pages = 1,
            },
            ItObjectMonitoring = new HubItObjectMonitoringOverview
            {
                ObjectRef = "ITINVENT:5",
                CheckedAt = Iso(now.AddMinutes(-2)),
                Targets =
                [
                    ItTarget("mt-1", "sw-east-02", "10.24.5.2", "online", 0.8),
                    ItTarget("mt-2", "prn-east-03", "10.24.5.31", "online", 1.4),
                    ItTarget("mt-3", "srv-east-backup", "10.24.5.40", "offline"),
                ],
            },
            ItObjectNetmapVersions = new HubItObjectNetmapVersionsResponse
            {
                ObjectRef = "ITINVENT:5",
                Items =
                [
                    new HubItObjectNetmapVersion { Version = 3, FileName = "rc-east-netmap.drawio", SavedAt = Iso(now.AddDays(-4)), SavedBy = "ivanov", SavedByUserId = 7 },
                    new HubItObjectNetmapVersion { Version = 2, FileName = "rc-east-netmap.drawio", SavedAt = Iso(now.AddDays(-32)), SavedBy = "kozlov", SavedByUserId = 12 },
                ],
            },
            ItObjectPasswordsAudit = new HubItObjectPasswordAuditResponse
            {
                ObjectRef = "ITINVENT:5",
                Items =
                [
                    new HubItObjectPasswordAuditItem { Id = 81, Action = "reveal.copy", ActorUserId = 7, ActorUsername = "ivanov", EntryGroup = "Сетевое оборудование", EntryLogin = "admin", CreatedAt = Iso(now.AddHours(-3)) },
                    new HubItObjectPasswordAuditItem { Id = 80, Action = "update", ActorUserId = 7, ActorUsername = "ivanov", EntryGroup = "Сетевое оборудование", EntryLogin = "admin", CreatedAt = Iso(now.AddDays(-6)) },
                    new HubItObjectPasswordAuditItem { Id = 79, Action = "create", ActorUserId = 12, ActorUsername = "kozlov", EntryGroup = "Локальные учётки", EntryLogin = "operator", CreatedAt = Iso(now.AddDays(-14)) },
                ],
            },

            // ---- Сети ----
            NetworkBranches = new HubNetworkBranchList
            {
                Branches =
                [
                    NetBranch(1, "tyumen", "RC-EAST", "РЦ «Восточный»",
                        devices: 18, ports: 420, occupied: 263, sockets: 390,
                        maps: 4, points: 96),
                    NetBranch(2, "tyumen", "RC-SOUTH", "РЦ «Южный»",
                        devices: 12, ports: 288, occupied: 171, sockets: 300,
                        maps: 2, points: 54),
                    NetBranch(3, "spb", "RC-NORTH", "РЦ «Северный»",
                        devices: 9, ports: 168, occupied: 89, sockets: 180,
                        maps: 1, points: 21),
                ],
            },
            NetworkOverview = new HubNetworkOverview
            {
                Branch = NetBranch(1, "tyumen", "RC-EAST", "РЦ «Восточный»",
                    18, 420, 263, 390, 4, 96),
                Metrics = new HubNetworkMetrics
                {
                    DevicesCount = 18,
                    PortsCount = 420,
                    OccupiedPorts = 263,
                    SocketsCount = 390,
                    MapsCount = 4,
                    MapPointsCount = 96,
                },
                Sites =
                [
                    new HubNetworkSite { Id = 11, BranchId = 1, SiteCode = "HQ-1F", Name = "1 этаж", SortOrder = 1, DevicesCount = 8, PortsCount = 180 },
                    new HubNetworkSite { Id = 12, BranchId = 1, SiteCode = "HQ-2F", Name = "2 этаж", SortOrder = 2, DevicesCount = 6, PortsCount = 156 },
                    new HubNetworkSite { Id = 13, BranchId = 1, SiteCode = "SRV", Name = "Серверная", SortOrder = 3, DevicesCount = 4, PortsCount = 84 },
                ],
            },
            NetworkDevices = new HubNetworkDeviceList
            {
                Devices =
                [
                    NetDevice(101, "sw-east-01", "switch", "Cisco Catalyst 2960-X", "HQ-1F", "10.24.5.1", ports: 48, occupied: 37),
                    NetDevice(102, "sw-east-02", "switch", "Cisco Catalyst 2960-X", "HQ-2F", "10.24.5.2", ports: 48, occupied: 41),
                    NetDevice(103, "ap-east-01", "ap", "Huawei AirEngine 6760", "HQ-2F", "10.24.5.10", ports: 2, occupied: 2),
                    NetDevice(104, "fw-east-01", "firewall", "Fortinet FortiGate 60F", "SRV", "10.24.5.254", ports: 10, occupied: 6),
                ],
            },
            NetworkMaps = new HubNetworkMapList
            {
                Maps =
                [
                    new HubNetworkMap { Id = 21, BranchId = 1, SiteCode = "HQ-1F", SiteName = "1 этаж", Title = "Схема разводки 1 этажа", FloorLabel = "1 этаж", FileName = "rc-east-1f.drawio", MimeType = "application/x-drawio", FileSize = 412_000, UpdatedAt = Iso(now.AddDays(-9)) },
                    new HubNetworkMap { Id = 22, BranchId = 1, SiteCode = "SRV", SiteName = "Серверная", Title = "Стойка серверной", FloorLabel = "Серверная", FileName = "rc-east-srv.png", MimeType = "image/png", FileSize = 1_104_000, UpdatedAt = Iso(now.AddDays(-21)) },
                ],
            },

            // ---- Компьютеры ----
            ComputersPage = new HubComputersPage
            {
                Items =
                [
                    Computer("3C:D9:2B:11:04:7A", "WS-EAST-014", "online",
                        "Сидорова Мария Константиновна", "sidorova",
                        "РЦ «Восточный»", "Кабинет 214", "10.24.5.114",
                        inv: "004521", model: "HP EliteDesk 800 G6"),
                    Computer("3C:D9:2B:11:04:9C", "WS-EAST-015", "online",
                        "Громов Пётр Львович", "gromov",
                        "РЦ «Восточный»", "Кабинет 214", "10.24.5.115",
                        inv: "004522", model: "HP EliteDesk 800 G6"),
                    Computer("9C:8E:99:0A:12:44", "WS-SOUTH-007", "stale",
                        "Козлов Сергей Андреевич", "kozlov",
                        "РЦ «Южный»", "Кабинет 108", "10.25.3.47",
                        inv: "004388", model: "Dell OptiPlex 7090"),
                    Computer("B4:2E:99:F1:82:10", "SRV-BACKUP-01", "online",
                        null, null, "ЦО «Главный»", "Серверная", "10.24.0.40",
                        inv: "003912", model: "Dell PowerEdge R550"),
                    Computer("7C:B5:9B:33:0C:E1", "WS-NORTH-002", "offline",
                        "Волкова Елена Николаевна", "volkova",
                        "РЦ «Северный»", "Кабинет 12", "10.26.1.18",
                        inv: "004105", model: "Lenovo ThinkCentre M90"),
                ],
                Total = 5,
                Limit = 50,
            },
            ComputerDetail = new HubComputer
            {
                MacAddress = "3C:D9:2B:11:04:7A",
                Hostname = "WS-EAST-014",
                Status = "online",
                AgeSeconds = 41,
                LastSeenAt = now.ToUnixTimeSeconds() - 41,
                CurrentUser = "sidorova",
                UserLogin = "sidorova",
                UserFullName = "Сидорова Мария Константиновна",
                BranchName = "РЦ «Восточный»",
                LocationName = "Кабинет 214",
                DatabaseName = "main",
                InventoryInvNo = "004521",
                InventoryModelName = "HP EliteDesk 800 G6",
                IpPrimary = "10.24.5.114",
                IpList = ["10.24.5.114"],
                CpuModel = "Intel Core i5-10500",
                CpuLoadPercent = 23,
                RamGb = 16,
                RamUsedPercent = 57,
                SystemSerial = "CZC1432K8P",
                UptimeSeconds = 3 * 86400 + 7200,
                OutlookStatus = "ok",
                LogicalDisks =
                [
                    new HubComputerDisk { Name = "C:", Mountpoint = "C:\\", TotalGb = 475, FreeGb = 208, HealthStatus = "Healthy", MediaType = "SSD" },
                    new HubComputerDisk { Name = "D:", Mountpoint = "D:\\", TotalGb = 931, FreeGb = 512, HealthStatus = "Healthy", MediaType = "HDD" },
                ],
                Network = new HubComputerNetwork
                {
                    Devices =
                    [
                        new HubComputerNetworkDevice { Name = "Ethernet", ConnectionStatus = "Connected", LinkSpeed = "1 Гбит/с", Ipv4 = ["10.24.5.114"] },
                    ],
                },
            },

            // ---- База ITINVENT ----
            EquipmentSearchPage = new HubEquipmentSearchPage
            {
                Equipment =
                [
                    Equipment(4521, "Системный блок", "HP EliteDesk 800 G6", "HP",
                        serial: "CZC1432K8P", employee: "Сидорова Мария Константиновна",
                        ownerNo: 1001,
                        branch: "РЦ «Восточный»", location: "Кабинет 214",
                        status: "Эксплуатация", ip: "10.24.5.114"),
                    Equipment(4522, "Системный блок", "HP EliteDesk 800 G6", "HP",
                        serial: "CZC1432K9R", employee: "Громов Пётр Львович",
                        ownerNo: 1002,
                        branch: "РЦ «Восточный»", location: "Кабинет 214",
                        status: "Эксплуатация", ip: "10.24.5.115"),
                    Equipment(4533, "МФУ", "Kyocera ECOSYS M2735dw", "Kyocera",
                        serial: "X3N8452107", employee: "Отдел продаж",
                        branch: "РЦ «Восточный»", location: "Опенспейс, ряд 3",
                        status: "Эксплуатация", ip: "10.24.5.31"),
                    Equipment(4601, "Коммутатор", "Cisco Catalyst 2960-X", "Cisco",
                        serial: "FCW2145A1BZ", branch: "РЦ «Восточный»",
                        location: "Серверная, стойка 2", status: "Эксплуатация",
                        ip: "10.24.5.2"),
                ],
                Total = 4,
                Page = 1,
                Pages = 1,
            },
            EquipmentDetail = new HubEquipmentItem
            {
                Id = 900451,
                InvNo = 4521,
                TypeName = "Системный блок",
                ModelName = "HP EliteDesk 800 G6",
                VendorName = "HP",
                SerialNo = "CZC1432K8P",
                Status = "Эксплуатация",
                EmplNo = 1001,
                EmployeeName = "Сидорова Мария Константиновна",
                EmployeeDept = "ИТ-департамент",
                EmployeeEmail = "sidorova@zsgp.ru",
                BranchName = "РЦ «Восточный»",
                Location = "Кабинет 214",
                IpAddress = "10.24.5.114",
                MacAddress = "3C:D9:2B:11:04:7A",
                NetworkName = "WS-EAST-014",
                DomainName = "zsgp.local",
                DateCreate = "2023-04-12",
                DateLastModify = "2025-11-10",
                ChUser = "ivanov",
                Description = "Рабочая станция отдела продаж, апгрейд RAM до 16 ГБ в 2024.",
            },
            EquipmentPhotos = new HubEquipmentPhotoList
            {
                ItemId = 900451,
                VerificationAvailable = true,
                VerifyPermitted = true,
                Photos =
                [
                    new HubEquipmentPhoto { FileNo = 71, FileName = "inv-4521-front.jpg", Description = "Лицевая панель", SizeMb = 1.8, HasThumb = true, CreatedAt = Iso(now.AddDays(-30)), CreatedBy = "ivanov", Verified = true, VerifiedBy = "petrova", CanUnverify = true },
                    new HubEquipmentPhoto { FileNo = 72, FileName = "inv-4521-label.jpg", Description = "Инвентарная наклейка", SizeMb = 0.9, HasThumb = true, CreatedAt = Iso(now.AddDays(-30)), CreatedBy = "ivanov", CanVerify = true, CanReject = true },
                    new HubEquipmentPhoto { FileNo = 73, FileName = "inv-4521-back.jpg", Description = "Задняя панель", SizeMb = 1.2, HasThumb = true, CreatedAt = Iso(now.AddDays(-12)), CreatedBy = "kozlov", Rejected = true, RejectedBy = "petrova", RejectReason = "Пломба не читается, переснять при дневном свете", CanUnverify = true },
                ],
            },
            EquipmentHistory = new HubEquipmentHistoryResponse
            {
                ItemId = 900451,
                Total = 3,
                History =
                [
                    new HubEquipmentHistoryRow { HistId = 312, ChDate = "2025-11-10 09:41", ChUser = "ivanov", ChComment = "Перемещение в кабинет 214", OldLocationName = "Склад ИТ", NewLocationName = "Кабинет 214" },
                    new HubEquipmentHistoryRow { HistId = 301, ChDate = "2024-06-02 15:12", ChUser = "kozlov", ChComment = "Выдан сотруднику", NewEmployeeName = "Сидорова Мария Константиновна" },
                    new HubEquipmentHistoryRow { HistId = 288, ChDate = "2023-04-12 10:05", ChUser = "petrova", ChComment = "Оприходование", NewBranchName = "РЦ «Восточный»" },
                ],
            },
            // Журнал работ карточки (системный блок → потоки «Комплектующие» + «Чистка ПК»).
            ComponentWorkHistory = new HubMaintenanceHistory
            {
                Count = 2,
                LastDate = Iso(now.AddDays(-21)),
                TimeAgoStr = "21 день назад",
            },
            ComponentWorks =
            [
                new HubComponentWorkRecord
                {
                    SerialNumber = "CZC1432K8P",
                    ComponentType = "ram",
                    ComponentName = "Оперативная память",
                    ComponentModel = "Kingston DDR4 16GB",
                    EquipmentKind = "pc",
                    InvNo = "4521",
                    Branch = "РЦ «Восточный»",
                    Location = "Кабинет 214",
                    Employee = "Иванов И. П.",
                    Timestamp = Iso(now.AddDays(-21)),
                },
                new HubComponentWorkRecord
                {
                    SerialNumber = "CZC1432K8P",
                    ComponentType = "ssd",
                    ComponentName = "SSD-накопитель",
                    ComponentModel = "Samsung 870 EVO 500GB",
                    EquipmentKind = "pc",
                    InvNo = "4521",
                    Branch = "РЦ «Восточный»",
                    Location = "Кабинет 214",
                    Employee = "Иванов И. П.",
                    Timestamp = Iso(now.AddDays(-96)),
                },
            ],
            CleaningWorkHistory = new HubMaintenanceHistory
            {
                Count = 3,
                LastDate = Iso(now.AddDays(-40)),
                TimeAgoStr = "40 дней назад",
            },
            CleaningWorks =
            [
                new HubCleaningWorkRecord
                {
                    SerialNo = "CZC1432K8P",
                    InvNo = "4521",
                    Employee = "Сидорова Мария Константиновна",
                    Branch = "РЦ «Восточный»",
                    Location = "Кабинет 214",
                    ModelName = "HP EliteDesk 800 G6",
                    EquipmentId = 900451,
                    Timestamp = Iso(now.AddDays(-40)),
                },
                new HubCleaningWorkRecord
                {
                    SerialNo = "CZC1432K8P",
                    InvNo = "4521",
                    Employee = "Сидорова Мария Константиновна",
                    Branch = "РЦ «Восточный»",
                    Location = "Кабинет 214",
                    ModelName = "HP EliteDesk 800 G6",
                    EquipmentId = 900451,
                    Timestamp = Iso(now.AddDays(-160)),
                },
            ],
            // Панель сотрудника (клик по ФИО владельца в карточке): техника + история.
            EmployeeItems = new HubEmployeeItemsResponse
            {
                Found = true,
                Equipment =
                [
                    Equipment(4521, "Системный блок", "HP EliteDesk 800 G6", "HP",
                        serial: "CZC1432K8P", employee: "Сидорова Мария Константиновна",
                        ownerNo: 1001, branch: "РЦ «Восточный»", location: "Кабинет 214",
                        status: "Эксплуатация"),
                    Equipment(4533, "МФУ", "Kyocera ECOSYS M2735dw", "Kyocera",
                        serial: "X3N8452107", employee: "Сидорова Мария Константиновна",
                        ownerNo: 1001, branch: "РЦ «Восточный»", location: "Опенспейс, ряд 3",
                        status: "Эксплуатация"),
                ],
            },
            EmployeeHistory = new HubEmployeeHistoryResponse
            {
                OwnerNo = 1001,
                Total = 2,
                Page = 1,
                Limit = 50,
                History =
                [
                    new HubEmployeeHistoryRow { HistId = 415, ItemId = 904533, ChDate = "2025-11-10 09:41", ChUser = "ivanov", ChComment = "Выдано МФУ в кабинет 214", Direction = "incoming", OldEmployeeNo = 1044, OldEmployeeName = "Отдел продаж", NewEmployeeNo = 1001, NewEmployeeName = "Сидорова Мария Константиновна", InvNo = 4533, SerialNo = "X3N8452107", TypeName = "МФУ", ModelName = "Kyocera ECOSYS M2735dw", CurrentInvNo = 4533, BranchName = "РЦ «Восточный»", LocationName = "Кабинет 214" },
                    new HubEmployeeHistoryRow { HistId = 301, ItemId = 904521, ChDate = "2024-06-02 15:12", ChUser = "kozlov", ChComment = "Выдан сотруднику", Direction = "incoming", NewEmployeeNo = 1001, NewEmployeeName = "Сидорова Мария Константиновна", InvNo = 4521, SerialNo = "CZC1432K8P", TypeName = "Системный блок", ModelName = "HP EliteDesk 800 G6", CurrentInvNo = 4521, BranchName = "РЦ «Восточный»", LocationName = "Кабинет 214" },
                ],
            },

            // ---- Доступ к группам AD ----
            GroupsAccessStatus = new HubGroupsAccessStatus
            {
                Status = "ok",
                LastSyncAt = Iso(now.AddHours(-2)),
                Summary = new HubGroupsAccessSummary
                {
                    GroupCount = 4,
                    UserCount = 4,
                    CellCount = 8,
                    ReturnedGroupCount = 4,
                    ReturnedUserCount = 4,
                },
                Branches = ["tyumen", "spb"],
                BaseDn = "OU=FileShares,DC=zsgp,DC=local",
            },
            GroupsAccessMatrix = new HubGroupsAccessMatrixGrid
            {
                SyncedAt = Iso(now.AddHours(-2)),
                Groups =
                [
                    AccessGroup("CN=FS-EAST-RW,OU=FileShares,DC=zsgp,DC=local", "FS-EAST-RW", "tyumen", "РЦ «Восточный» — общая папка", "write", 4),
                    AccessGroup("CN=FS-EAST-RO,OU=FileShares,DC=zsgp,DC=local", "FS-EAST-RO", "tyumen", "РЦ «Восточный» — общая папка", "read", 4),
                    AccessGroup("CN=FS-SOUTH-RW,OU=FileShares,DC=zsgp,DC=local", "FS-SOUTH-RW", "tyumen", "РЦ «Южный» — общая папка", "write", 3),
                    AccessGroup("CN=FS-DOCS-RO,OU=FileShares,DC=zsgp,DC=local", "FS-DOCS-RO", "spb", "Обмен документами", "read", 6),
                ],
                Users =
                [
                    new HubGroupsAccessUser { Login = "ivanov", DisplayName = "Иванов И. П.", AccessCount = 3 },
                    new HubGroupsAccessUser { Login = "petrov", DisplayName = "Петров И. С.", AccessCount = 2 },
                    new HubGroupsAccessUser { Login = "kozlov", DisplayName = "Козлов С. А.", AccessCount = 2 },
                    new HubGroupsAccessUser { Login = "sidorova", DisplayName = "Сидорова М. К.", AccessCount = 1 },
                ],
                Cells =
                [
                    new[] { "ivanov", "CN=FS-EAST-RW,OU=FileShares,DC=zsgp,DC=local", "write" },
                    new[] { "ivanov", "CN=FS-EAST-RO,OU=FileShares,DC=zsgp,DC=local", "read" },
                    new[] { "ivanov", "CN=FS-DOCS-RO,OU=FileShares,DC=zsgp,DC=local", "read" },
                    new[] { "petrov", "CN=FS-EAST-RW,OU=FileShares,DC=zsgp,DC=local", "write" },
                    new[] { "petrov", "CN=FS-SOUTH-RW,OU=FileShares,DC=zsgp,DC=local", "write" },
                    new[] { "kozlov", "CN=FS-EAST-RO,OU=FileShares,DC=zsgp,DC=local", "read" },
                    new[] { "kozlov", "CN=FS-DOCS-RO,OU=FileShares,DC=zsgp,DC=local", "read" },
                    new[] { "sidorova", "CN=FS-EAST-RO,OU=FileShares,DC=zsgp,DC=local", "read" },
                ],
                Summary = new HubGroupsAccessSummary
                {
                    GroupCount = 4,
                    UserCount = 4,
                    CellCount = 8,
                    ReturnedGroupCount = 4,
                    ReturnedUserCount = 4,
                },
            },
            GroupsAccessGroupDetail = new HubGroupsAccessGroupDetail
            {
                Status = "ok",
                SyncedAt = Iso(now.AddHours(-2)),
                Group = AccessGroup(
                    "CN=FS-EAST-RW,OU=FileShares,DC=zsgp,DC=local", "FS-EAST-RW",
                    "tyumen", "РЦ «Восточный» — общая папка", "write", 4,
                    description: "Доступ на запись в общую папку филиала"),
                Members =
                [
                    new HubGroupsAccessMember { Login = "ivanov", DisplayName = "Иванов И. П.", Via = "direct" },
                    new HubGroupsAccessMember { Login = "petrov", DisplayName = "Петров И. С.", Via = "direct" },
                    new HubGroupsAccessMember { Login = "kozlov", DisplayName = "Козлов С. А.", Via = "nested" },
                    new HubGroupsAccessMember { Login = "mironova", DisplayName = "Миронова А. В.", Via = "nested" },
                ],
            },

            // ---- ВКС ----
            VcsComputers =
            [
                new HubVcsComputer { Id = "vcs-1", Name = "Переговорная «Байкал»", IpAddress = "10.24.1.41", Location = "Тюмень, 4 этаж" },
                new HubVcsComputer { Id = "vcs-2", Name = "Переговорная «Енисей»", IpAddress = "10.24.1.42", Location = "Тюмень, 4 этаж" },
                new HubVcsComputer { Id = "vcs-3", Name = "Конференц-зал", IpAddress = "10.24.1.50", Location = "Тюмень, 2 этаж" },
                new HubVcsComputer { Id = "vcs-4", Name = "Кабинет директора", IpAddress = "10.24.1.61", Location = "Тюмень, 5 этаж" },
            ],

            // ---- Мониторинг ----
            MonitoringOverview = new HubMonitoringOverview
            {
                CheckedAt = Iso(now.AddMinutes(-1)),
                Worker = new HubMonitoringWorker { Enabled = true, HeartbeatAt = Iso(now.AddMinutes(-1)), CycleSeconds = 30 },
                Targets =
                [
                    MonTarget("t-1", "fw-hub-01", "10.24.0.254", "online", 0.9,
                        rxBps: 84_000_000, txBps: 310_000_000),
                    MonTarget("t-2", "sw-east-02", "10.24.5.2", "online", 1.2,
                        rxBps: 12_000_000, txBps: 46_000_000),
                    MonTarget("t-3", "prn-east-03", "10.24.5.31", "online", 2.1),
                    MonTarget("t-4", "srv-east-backup", "10.24.5.40", "offline", openEvents: 1),
                ],
            },
            MonitoringTargetDetail = new HubMonitoringTarget
            {
                Id = "t-1",
                Name = "fw-hub-01",
                Address = "10.24.0.254",
                Port = 161,
                Enabled = true,
                Current = new HubMonitoringCurrent
                {
                    Status = "online",
                    CheckedAt = Iso(now.AddMinutes(-1)),
                    SnmpStatus = "ok",
                    OpenEvents = 0,
                    Ping = new HubMonitoringPing { Status = "online", LatencyMs = 0.9, LossPct = 0, Sent = 3, Received = 3 },
                    Device = new HubMonitoringDevice
                    {
                        SysName = "fw-hub-01",
                        Description = "Fortinet FortiGate 60F",
                        Serial = "FGT60FTK22011408",
                        CpuPct = 12,
                        MemoryPct = 48,
                        UptimeTicks = 27_340_000,
                    },
                },
                Interfaces =
                [
                    new HubMonitoringInterface
                    {
                        Id = "if-1",
                        Name = "wan1",
                        Settings = new HubMonitoringInterfaceSettings { Role = "wan", Critical = true, Pinned = true },
                        Current = new HubMonitoringInterfaceCurrent { Admin = 1, Oper = 1, SpeedBps = 1_000_000_000, RxBps = 84_000_000, TxBps = 310_000_000, RxUtilPct = 8.4, TxUtilPct = 31 },
                    },
                    new HubMonitoringInterface
                    {
                        Id = "if-2",
                        Name = "lan1",
                        Settings = new HubMonitoringInterfaceSettings { Role = "lan", Critical = true },
                        Current = new HubMonitoringInterfaceCurrent { Admin = 1, Oper = 1, SpeedBps = 1_000_000_000, RxBps = 300_000_000, TxBps = 95_000_000, RxUtilPct = 30, TxUtilPct = 9.5 },
                    },
                ],
                Events =
                [
                    new HubMonitoringEvent { Id = "ev-9", TargetId = "t-1", Kind = "utilization", Title = "Загрузка wan1 выше 70%", Severity = "warning", OpenedAt = Iso(now.AddDays(-2)), ClosedAt = Iso(now.AddDays(-2).AddHours(3)) },
                    new HubMonitoringEvent { Id = "ev-4", TargetId = "t-1", Kind = "restart", Title = "Перезагрузка устройства", Severity = "info", OpenedAt = Iso(now.AddDays(-9)), ClosedAt = Iso(now.AddDays(-9)) },
                ],
            },

            // ---- МФУ ----
            MfuDevices = new HubMfuDeviceList
            {
                GeneratedAt = Iso(now.AddMinutes(-3)),
                DbId = "main",
                Totals = new HubMfuTotals
                {
                    Devices = 5,
                    Online = 4,
                    Offline = 1,
                    SnmpOk = 4,
                    SnmpFresh = 4,
                    SnmpError = 1,
                },
                Grouped = new Dictionary<string, Dictionary<string, List<HubMfuDevice>>>
                {
                    ["РЦ «Восточный»"] = new()
                    {
                        ["Опенспейс, ряд 3"] =
                        [
                            MfuDevice("main|4533", "004533", "Kyocera ECOSYS M2735dw",
                                "Kyocera", "10.24.5.31", "online", pages: 84_213, toner: 34),
                            MfuDevice("main|4534", "004534", "HP LaserJet Pro M404dn",
                                "HP", "10.24.5.32", "online", pages: 51_980, toner: 67),
                        ],
                        ["Приёмная"] =
                        [
                            MfuDevice("main|4540", "004540", "Kyocera ECOSYS M2040dn",
                                "Kyocera", "10.24.5.36", "online", pages: 33_414, toner: 12),
                        ],
                    },
                    ["РЦ «Южный»"] = new()
                    {
                        ["Кабинет 108"] =
                        [
                            MfuDevice("main|4602", "004602", "Canon i-SENSYS MF445dw",
                                "Canon", "10.25.3.51", "offline", pages: 96_731, toner: 8),
                            MfuDevice("main|4607", "004607", "HP LaserJet MFP M428fdw",
                                "HP", "10.25.3.55", "online", pages: 22_015, toner: 91),
                        ],
                    },
                },
            },
            MfuMonthlyPages = new HubMfuMonthlyPages
            {
                GeneratedAt = Iso(now.AddMinutes(-1)),
                DeviceKey = "main|4533",
                MonthsRequested = 6,
                CurrentTotalPages = 84_213,
                CurrentCheckedAt = Iso(now.AddMinutes(-1)),
                Months =
                [
                    new HubMfuMonthPages { Month = "2025-06", PrintedPages = 1_840, StartCounter = 74_112, EndCounter = 75_952 },
                    new HubMfuMonthPages { Month = "2025-07", PrintedPages = 2_105, StartCounter = 75_952, EndCounter = 78_057 },
                    new HubMfuMonthPages { Month = "2025-08", PrintedPages = 1_676, StartCounter = 78_057, EndCounter = 79_733 },
                    new HubMfuMonthPages { Month = "2025-09", PrintedPages = 2_240, StartCounter = 79_733, EndCounter = 81_973 },
                    new HubMfuMonthPages { Month = "2025-10", PrintedPages = 1_930, StartCounter = 81_973, EndCounter = 83_903 },
                    new HubMfuMonthPages { Month = "2025-11", PrintedPages = 310, StartCounter = 83_903, EndCounter = 84_213 },
                ],
            },
            MfuWorksStatistics = new HubMfuWorksStatistics
            {
                GeneratedAt = Iso(now),
                PeriodDays = 30,
                Totals = new HubMfuWorksTotals { TotalOperations = 14, UniqueBranches = 2, UniqueLocations = 4 },
                ByTypePeriod = new Dictionary<string, int>
                {
                    ["Замена картриджа"] = 9,
                    ["Замена фьюзера"] = 2,
                    ["Ремонт"] = 3,
                },
                ByBranchPeriod = new Dictionary<string, int>
                {
                    ["РЦ «Восточный»"] = 9,
                    ["РЦ «Южный»"] = 5,
                },
                ByModelPeriod =
                [
                    new HubMfuWorksModelStat { Model = "Kyocera ECOSYS M2735dw", Count = 5 },
                    new HubMfuWorksModelStat { Model = "Canon i-SENSYS MF445dw", Count = 4 },
                    new HubMfuWorksModelStat { Model = "HP LaserJet Pro M404dn", Count = 3 },
                ],
                RecentReplacements =
                [
                    new HubMfuMaintenanceEvent { Timestamp = Iso(now.AddDays(-1)), Branch = "РЦ «Восточный»", Location = "Опенспейс, ряд 3", PrinterModel = "Kyocera ECOSYS M2735dw", ComponentType = "Картридж", ReplacementItem = "TK-1200", Employee = "Козлов С. А.", InvNo = "004533" },
                    new HubMfuMaintenanceEvent { Timestamp = Iso(now.AddDays(-4)), Branch = "РЦ «Южный»", Location = "Кабинет 108", PrinterModel = "Canon i-SENSYS MF445dw", ComponentType = "Картридж", ReplacementItem = "CRG-052", Employee = "Петров И. С.", InvNo = "004602" },
                    new HubMfuMaintenanceEvent { Timestamp = Iso(now.AddDays(-9)), Branch = "РЦ «Восточный»", Location = "Приёмная", PrinterModel = "Kyocera ECOSYS M2040dn", ComponentType = "Фотобарабан", ReplacementItem = "DK-1150", Employee = "Козлов С. А.", InvNo = "004540" },
                ],
            },
            // Складские расходники: локальные позиции филиала/локации выбранного
            // устройства идут первыми (кнопки записи — у демо-пользователя нет
            // database.write, поэтому секция read-only).
            ConsumablesLookup =
            [
                new HubConsumableLookupItem { Id = 311, InvNo = "РСХ-0112", TypeName = "Картридж", ModelName = "Canon Cartridge 052", Qty = 3, BranchName = "РЦ «Южный»", LocationName = "Кабинет 108" },
                new HubConsumableLookupItem { Id = 312, InvNo = "РСХ-0140", TypeName = "Картридж", ModelName = "Kyocera TK-1200", Qty = 8, BranchName = "РЦ «Восточный»", LocationName = "Опенспейс, ряд 3" },
                new HubConsumableLookupItem { Id = 313, InvNo = "РСХ-0098", TypeName = "Фотобарабан", ModelName = "Kyocera DK-1150", Qty = 1, BranchName = "РЦ «Восточный»", LocationName = "Приёмная" },
                new HubConsumableLookupItem { Id = 314, InvNo = "РСХ-0201", TypeName = "Тонер", ModelName = "HP CF283A", Qty = 12, BranchName = "РЦ «Южный»", LocationName = "Серверная" },
            ],

            // ---- Статистика ----
            PcCleaningStatistics = new HubPcCleaningStatistics
            {
                GeneratedAt = Iso(now),
                PeriodDays = 90,
                Totals = new HubPcCleaningStatisticsTotals
                {
                    TotalPc = 214,
                    CleanedPc = 161,
                    RemainingPc = 53,
                    CoveragePercent = 75.2,
                    CleaningsTotal = 388,
                    CleaningsPeriod = 161,
                },
                Branches =
                [
                    new HubPcCleaningBranchStat { Branch = "РЦ «Восточный»", TotalPc = 96, CleanedPc = 81, RemainingPc = 15, CoveragePercent = 84.4, CleaningsTotal = 174, CleaningsPeriod = 81 },
                    new HubPcCleaningBranchStat { Branch = "РЦ «Южный»", TotalPc = 64, CleanedPc = 47, RemainingPc = 17, CoveragePercent = 73.4, CleaningsTotal = 118, CleaningsPeriod = 47 },
                    new HubPcCleaningBranchStat { Branch = "РЦ «Северный»", TotalPc = 54, CleanedPc = 33, RemainingPc = 21, CoveragePercent = 61.1, CleaningsTotal = 96, CleaningsPeriod = 33 },
                ],
            },
            BatteryStatistics = new HubBatteryStatistics
            {
                GeneratedAt = Iso(now),
                PeriodDays = 180,
                Totals = new HubBatteryStatisticsTotals { TotalOperations = 23, UniqueBranches = 3, UniqueLocations = 9 },
                ByBranchPeriod = new Dictionary<string, int>
                {
                    ["РЦ «Восточный»"] = 11,
                    ["РЦ «Южный»"] = 7,
                    ["РЦ «Северный»"] = 5,
                },
                ByItemPeriod = new Dictionary<string, int>
                {
                    ["Батарея 12В 7Ач"] = 14,
                    ["Батарея 12В 9Ач"] = 6,
                    ["Батарейный модуль APC RBC"] = 3,
                },
                ByModelPeriod =
                [
                    new HubBatteryModelStat { Model = "APC Back-UPS 750", Count = 9 },
                    new HubBatteryModelStat { Model = "Ippon Smart Power Pro 1400", Count = 8 },
                    new HubBatteryModelStat { Model = "APC Smart-UPS 1500", Count = 6 },
                ],
                RecentReplacements =
                [
                    new HubBatteryReplacementEvent { Timestamp = Iso(now.AddDays(-2)), Branch = "РЦ «Восточный»", Location = "Серверная", ModelName = "APC Smart-UPS 1500", ReplacementItem = "Батарейный модуль APC RBC", Employee = "Белов Р. О.", InvNo = "003988" },
                    new HubBatteryReplacementEvent { Timestamp = Iso(now.AddDays(-8)), Branch = "РЦ «Южный»", Location = "Кабинет 108", ModelName = "APC Back-UPS 750", ReplacementItem = "Батарея 12В 9Ач", Employee = "Козлов С. А.", InvNo = "004201" },
                ],
            },
            PcComponentsStatistics = new HubPcComponentsStatistics
            {
                GeneratedAt = Iso(now),
                PeriodDays = 180,
                Totals = new HubPcComponentsStatisticsTotals { TotalOperations = 41, UniqueBranches = 3, UniqueLocations = 12 },
                ByComponentPeriod = new Dictionary<string, int>
                {
                    ["Оперативная память"] = 14,
                    ["SSD-накопитель"] = 11,
                    ["Блок питания"] = 6,
                    ["Материнская плата"] = 4,
                },
                ByBranchPeriod = new Dictionary<string, int>
                {
                    ["РЦ «Восточный»"] = 19,
                    ["РЦ «Южный»"] = 13,
                    ["РЦ «Северный»"] = 9,
                },
                ByModelPeriod =
                [
                    new HubPcComponentsModelStat { Model = "HP EliteDesk 800 G6", Count = 12 },
                    new HubPcComponentsModelStat { Model = "Dell OptiPlex 7090", Count = 9 },
                    new HubPcComponentsModelStat { Model = "Lenovo ThinkCentre M90", Count = 7 },
                ],
                RecentReplacements =
                [
                    new HubPcComponentsReplacementEvent { Timestamp = Iso(now.AddDays(-1)), Branch = "РЦ «Восточный»", Location = "Кабинет 214", ModelName = "HP EliteDesk 800 G6", ComponentName = "SSD-накопитель", ReplacementItem = "Samsung 870 EVO 500GB", Employee = "Иванов И. П.", InvNo = "004521" },
                    new HubPcComponentsReplacementEvent { Timestamp = Iso(now.AddDays(-5)), Branch = "РЦ «Южный»", Location = "Кабинет 108", ModelName = "Dell OptiPlex 7090", ComponentName = "Оперативная память", ReplacementItem = "Kingston DDR4 8GB", Employee = "Белов Р. О.", InvNo = "004388" },
                    new HubPcComponentsReplacementEvent { Timestamp = Iso(now.AddDays(-12)), Branch = "РЦ «Северный»", Location = "Кабинет 12", ModelName = "Lenovo ThinkCentre M90", ComponentName = "Блок питания", ReplacementItem = "PSU 260W", Employee = "Козлов С. А.", InvNo = "004105" },
                ],
            },

            // ---- Справка (база знаний) ----
            KbCategories =
            [
                new HubKbCategory { Id = "net", Title = "Сеть и доступ", Description = "VPN, Wi-Fi, файловые ресурсы", Order = 1, TotalArticles = 6, PublishedArticles = 4 },
                new HubKbCategory { Id = "mail", Title = "Почта", Description = "Exchange, клиенты, архив", Order = 2, TotalArticles = 5, PublishedArticles = 3 },
                new HubKbCategory { Id = "soft", Title = "Программы", Description = "Установка и лицензии", Order = 3, TotalArticles = 4, PublishedArticles = 2 },
            ],
            KbArticlesPage = new HubKbArticleListPage
            {
                Items =
                [
                    kbArticle1,
                    KbArticle("kb-12", "Как подключиться к VPN из дома", "mail",
                        "runbook", summary: "Пошаговая настройка VPN-клиента и сертификата.", tags: ["vpn", "удалённая работа"]),
                    KbArticle("kb-15", "Правила корпоративной почты", "mail",
                        "faq", summary: "Квоты, архивация, подписи и автоответы.", tags: ["почта"]),
                    KbArticle("kb-21", "Установка ПО через Software Center", "soft",
                        "note", summary: "Самообслуживание установки без прав администратора.", tags: ["установка", "sccm"]),
                ],
                Total = 4,
                Limit = 100,
            },
            KbArticleDetail = kbArticle1,

            // ---- Настройки ----
            // Тёмная тема — базовая линия скриншотов: LoadAsync применит её
            // через NativeThemeManager.Apply, поэтому кадры не зависят от
            // системной темы хоста. Светлые кадры снимаются явным Apply("light").
            MySettings = new HubUserSettings
            {
                ThemeMode = "dark",
                FontFamily = "Segoe UI",
                FontScale = 1.0,
            },
            NotificationPreferences = new HubNotificationPreferences
            {
                UserId = 7,
                Channels = new Dictionary<string, bool>
                {
                    ["mail"] = true,
                    ["tasks"] = true,
                    ["task_email"] = true,
                    ["announcements"] = true,
                    ["chat_direct"] = true,
                    ["chat_group"] = true,
                    ["chat_task"] = false,
                    ["chat_ai"] = true,
                    ["chat_sound"] = true,
                },
            },

            // ---- Администрирование ----
            AdminUsers =
            [
                AdminUser(7, "ivanov", "Иванов Иван Петрович", "ИТ-департамент",
                    "Системный администратор", "admin", mail: true, twoFa: true),
                AdminUser(9, "petrov", "Петров Игорь Сергеевич", "ИТ-департамент",
                    "Ведущий инженер", "user", mail: true),
                AdminUser(11, "kozlov", "Козлов Сергей Андреевич", "ИТ-департамент",
                    "Инженер-сетевик", "user", mail: true, twoFa: true),
                AdminUser(14, "volkova", "Волкова Елена Николаевна", "Бухгалтерия",
                    "Главный бухгалтер", "user"),
                AdminUser(18, "bot-backup", "Сервис резервного копирования", "ИТ-департамент",
                    "Сервисная учётная запись", "service", active: true, auth: "local"),
            ],
            AdminDepartments = new HubAdminDepartmentList
            {
                Items =
                [
                    AdminDept("d-it", "ИТ-департамент", members: 24, managers: 2),
                    AdminDept("d-acc", "Бухгалтерия", members: 11, managers: 1),
                    AdminDept("d-ops", "Служба эксплуатации", members: 38, managers: 3),
                    AdminDept("d-hr", "Отдел кадров", members: 6, managers: 1),
                ],
            },
            AdminDepartmentMembers = new HubAdminDepartmentMembers
            {
                Department = AdminDept("d-it", "ИТ-департамент", 24, 2),
                Items =
                [
                    AdminMember(101, 7, "manager", "ivanov", "Иванов Иван Петрович", "Системный администратор"),
                    AdminMember(102, 9, "member", "petrov", "Петров Игорь Сергеевич", "Ведущий инженер"),
                    AdminMember(103, 11, "member", "kozlov", "Козлов Сергей Андреевич", "Инженер-сетевик"),
                    AdminMember(104, 13, "member", "mironova", "Миронова Алла Викторовна", "Тимлид разработки"),
                ],
            },
            AdminAdCandidates =
            [
                new HubAdminAdCandidate { Login = "tarasov", DisplayName = "Тарасов Олег Викторович", Department = "Служба эксплуатации", Title = "Инженер", Mail = "tarasov@zsgp.ru", ImportStatus = "new" },
                new HubAdminAdCandidate { Login = "fedorova", DisplayName = "Фёдорова Анна Львовна", Department = "Отдел кадров", Title = "Специалист по кадрам", Mail = "fedorova@zsgp.ru", ImportStatus = "new", Warnings = ["missing_mail"] },
                new HubAdminAdCandidate { Login = "kozlov", DisplayName = "Козлов Сергей Андреевич", Department = "ИТ-департамент", Title = "Инженер-сетевик", Mail = "kozlov@zsgp.ru", ImportStatus = "exists_ldap" },
            ],
            AdminAdSyncStatus = new HubAdminAdSyncStatus
            {
                Status = "ok",
                LastSyncAt = Iso(now.AddHours(-4)),
                Result = new HubAdminAdSyncResult
                {
                    Status = "ok",
                    Created = 2,
                    Updated = 31,
                    Deactivated = 1,
                    Skipped = 4,
                },
            },
            AdminFeedbackPage = new HubAdminFeedbackPage
            {
                Items =
                [
                    new HubAdminFeedbackItem { Id = "fb-14", Category = "ui", Title = "Добавить тёмную тему в десктоп", Section = "settings", Status = "in_progress", CreatedAt = Iso(now.AddDays(-6)), Author = new HubAdminFeedbackAuthor { Id = 9, Username = "petrov", FullName = "Петров И. С." } },
                    new HubAdminFeedbackItem { Id = "fb-11", Category = "feature", Title = "Экспорт списка компьютеров в Excel", Section = "computers", Status = "new", CreatedAt = Iso(now.AddDays(-12)), Author = new HubAdminFeedbackAuthor { Id = 11, Username = "kozlov", FullName = "Козлов С. А." } },
                    new HubAdminFeedbackItem { Id = "fb-7", Category = "bug", Title = "Не приходят уведомления о задачах", Section = "notifications", Status = "accepted", CreatedAt = Iso(now.AddDays(-20)), Author = new HubAdminFeedbackAuthor { Id = 14, Username = "volkova", FullName = "Волкова Е. Н." } },
                ],
                Total = 3,
                Counts = new Dictionary<string, int>
                {
                    ["new"] = 1,
                    ["in_progress"] = 1,
                    ["accepted"] = 1,
                    ["declined"] = 0,
                    ["done"] = 4,
                },
            },
            AdminRequestMetrics = new HubAdminRequestMetrics
            {
                Enabled = true,
                StartedAt = Iso(now.AddDays(-6)),
                UptimeSec = 518_400,
                RouteCount = 4,
                TotalRequests = 184_203,
                TotalServerErrors = 12,
                ServerErrorRate = 0.0065,
                Routes =
                [
                    new HubAdminRouteStat { Method = "GET", Path = "/api/v1/tasks", Count = 41_208, ServerErrorCount = 3, MeanMs = 38, P95Ms = 120, P99Ms = 210 },
                    new HubAdminRouteStat { Method = "GET", Path = "/api/v1/mail/messages", Count = 33_945, ServerErrorCount = 4, MeanMs = 61, P95Ms = 240, P99Ms = 480 },
                    new HubAdminRouteStat { Method = "GET", Path = "/api/v1/monitoring/overview", Count = 28_114, ServerErrorCount = 2, MeanMs = 17, P95Ms = 60, P99Ms = 95 },
                    new HubAdminRouteStat { Method = "POST", Path = "/api/v1/chat/messages", Count = 19_877, ServerErrorCount = 3, MeanMs = 44, P95Ms = 130, P99Ms = 260 },
                ],
            },
            AdminAiBots =
            [
                new HubAdminAiBot { Id = "bot-1", Slug = "corp-assistant", Title = "HUB Ассистент", Description = "Отвечает на типовые вопросы по базе знаний", SystemPrompt = "Отвечай кратко и по делу", Model = "openai/gpt-4o-mini", Temperature = 0.2, MaxTokens = 2000, Surface = "general", IsEnabled = true, Configured = true, LatestRunStatus = "success", EnabledTools = ["kb_search", "ticket_lookup"], AllowedKbScope = ["it", "hr"], UpdatedAt = Iso(now.AddHours(-3)) },
                new HubAdminAiBot { Id = "bot-2", Slug = "doc-summary", Title = "Саммари документов", Description = "Краткая выжимка длинных документов", SystemPrompt = "Делай выжимку до 5 пунктов", Model = "openai/gpt-4o-mini", Temperature = 0.4, MaxTokens = 4000, IsEnabled = true, Configured = true, LatestRunStatus = "success", AllowedKbScope = ["docflow"], AllowKbDocumentDelivery = true, UpdatedAt = Iso(now.AddDays(-1)) },
                new HubAdminAiBot { Id = "bot-3", Slug = "net-diagnose", Title = "Диагност сети", Description = "Подсказки по инцидентам мониторинга", Model = "anthropic/claude-3.5-sonnet", Temperature = 0.1, MaxTokens = 3000, IsEnabled = false, Configured = false, RequiredPermission = "monitoring.read", LatestRunStatus = "error", LatestRunError = "Модель не настроена", UpdatedAt = Iso(now.AddDays(-2)) },
            ],

            // ---- Центр уведомлений (колокол шелла) ----
            // Смесь типов сущностей: глифы, точки непрочитанных, время, кнопка «✓».
            NotificationsPoll = new HubNotificationPoll
            {
                Items =
                [
                    Notification("nt-5", "task.assigned", "Новая задача: Согласовать договор поставки",
                        "Ирина Петрова назначила вам задачу", now.AddMinutes(-12), "task", "1", unread: 1),
                    Notification("nt-4", "chat.message", "Новое сообщение: IT-отдел",
                        "Согласовал бюджет на следующий год", now.AddHours(-1), "chat", "c1", unread: 1),
                    Notification("nt-3", "announcement.published", "Плановые работы в дата-центре",
                        "В субботу с 08:00 до 12:00 регламентные работы на СХД",
                        now.AddHours(-5), "announcement", "a1", unread: 1),
                    Notification("nt-2", "mail.message", "Почта: Регламентные работы в ДЦ — график",
                        "Ирина Петрова <petrova@zsgp.ru>", now.AddDays(-1), "mail", "m1", unread: 0),
                    Notification("nt-1", "docflow.assigned", "Поручение: договор поставки № 118",
                        "Смирнова О. В. → на исполнении",
                        now.AddDays(-1).AddHours(-3), "docflow", "df-1042", unread: 0),
                ],
                UnreadCounts = new HubNotificationUnreadCounts { NotificationsUnreadTotal = 3 },
            },

            // ---- Строительство (заявки 1С по номенклатурным группам) ----
            ConstructionObjects = new HubConstructionObjectsResponse
            {
                Items =
                [
                    new HubConstructionObjectSummary
                    {
                        ObjectRef = "managed:17",
                        Name = "ЖК «Северный», корпус 2",
                        Kind = "project",
                        RequestCount = 42,
                        RequestsLast30Days = 5,
                        PostedCount = 30,
                        LatestRequestAt = Iso(now.AddDays(-2)),
                        LatestRequestNumber = "00СТ-001042",
                        DepartmentNames = ["УМТО"],
                        ResponsibleNames = ["Иван Иванов", "Пётр Петров"],
                        WarehouseNames = ["ЦО", "Стройсклад №2"],
                        Managed = true,
                        ManagedObjectId = "managed:17",
                        SourceGroups =
                        [
                            new HubConstructionObjectGroup { GroupRef = "grp-1", GroupName = "ЖК «Северный» — электрика", ActiveRequestCount = 6, OverdueRequestCount = 1 },
                            new HubConstructionObjectGroup { GroupRef = "grp-2", GroupName = "ЖК «Северный» — СКС", ActiveRequestCount = 3 },
                        ],
                        Team =
                        [
                            new HubConstructionTeamMember { RoleKey = "project_lead", FullName = "Иван Иванов" },
                            new HubConstructionTeamMember { RoleKey = "pto_manager", FullName = "Мария Сидорова" },
                        ],
                    },
                    new HubConstructionObjectSummary
                    {
                        ObjectRef = "grp-3",
                        Name = "Школа №3, корпус Б",
                        Kind = "project",
                        RequestCount = 18,
                        RequestsLast30Days = 4,
                        PostedCount = 9,
                        LatestRequestAt = Iso(now.AddDays(-1)),
                        LatestRequestNumber = "00СТ-001038",
                        DepartmentNames = ["УМТО", "ПТО"],
                        SourceGroups =
                        [
                            new HubConstructionObjectGroup { GroupRef = "grp-3", GroupName = "Школа №3 — отделка" },
                        ],
                    },
                    new HubConstructionObjectSummary
                    {
                        ObjectRef = "general",
                        Name = "Общехозяйственная деятельность",
                        Kind = "general",
                        RequestCount = 12,
                        RequestsLast30Days = 3,
                        PostedCount = 7,
                        LatestRequestAt = Iso(now.AddDays(-4)),
                        LatestRequestNumber = "00ОХ-000219",
                    },
                    new HubConstructionObjectSummary
                    {
                        ObjectRef = "unassigned",
                        Name = "Без номенклатурной группы",
                        Kind = "unassigned",
                        RequestCount = 4,
                        RequestsLast30Days = 1,
                        LatestRequestAt = Iso(now.AddDays(-6)),
                        LatestRequestNumber = "00БН-000051",
                    },
                ],
                HasMore = false,
                AsOf = Iso(now),
                ScannedRequests = 320,
                Summary = new HubConstructionPortfolioTotals
                {
                    ProjectCount = 2,
                    RequestCount = 76,
                    RequestsLast30Days = 13,
                    GeneralRequestCount = 12,
                    UnassignedRequestCount = 4,
                },
                Cache = new HubConstructionCacheState { State = "fresh" },
                ManagementAvailable = true,
            },
            ConstructionObjectDetailFactory = id => new HubConstructionObjectDetail
            {
                Id = id,
                Name = "ЖК «Северный», корпус 2",
                Kind = "project",
                Managed = true,
                IsActive = true,
                Groups =
                [
                    new HubConstructionObjectGroup { GroupRef = "grp-1", GroupName = "ЖК «Северный» — электрика" },
                    new HubConstructionObjectGroup { GroupRef = "grp-2", GroupName = "ЖК «Северный» — СКС" },
                    new HubConstructionObjectGroup { GroupRef = "grp-4", GroupName = "ЖК «Северный» — сантехника" },
                ],
                Team =
                [
                    new HubConstructionTeamMember { RoleKey = "project_lead", EmployeeCode = "E-17", FullName = "Иван Иванов", Position = "Директор направления", Department = "УМТО" },
                    new HubConstructionTeamMember { RoleKey = "pto_manager", EmployeeCode = "E-44", FullName = "Мария Сидорова", Position = "Менеджер ПТО", Department = "ПТО" },
                    new HubConstructionTeamMember { RoleKey = "umto_coordinator", EmployeeCode = "E-9", FullName = "Пётр Петров", Position = "Координатор УМТО", Department = "УМТО" },
                ],
                CreatedAt = Iso(now.AddMonths(-8)),
                UpdatedAt = Iso(now.AddDays(-3)),
            },
            ConstructionObjectRequestsFactory = (_, _) => new HubConstructionObjectRequestsResponse
            {
                Items =
                [
                    ConstructionRequest("req-1", "00СТ-001042", "ordered",
                        now.AddDays(-2), now.AddDays(8),
                        "Заказ PO-77 размещён поставщику «ООО Кабель»", 12,
                        ["Кабель ВВГнг-LS 3х2,5", "Кабель ВВГнг-LS 5х6", "Гофра ПНД d25"]),
                    ConstructionRequest("req-2", "00СТ-001038", "fulfilled",
                        now.AddDays(-9), now.AddDays(-4),
                        "Доставлено на склад «ЦО» — акт приёмки № 118", 5,
                        ["Светильник ДВО 4000К", "Подрозетники"]),
                    ConstructionRequest("req-3", "00СТ-001036", "needs_review",
                        now.AddDays(-12), now.AddDays(-1),
                        "Требует проверки: расхождение количества по 2 позициям", 8,
                        ["Кабель-канал 25х16", "Розетка RJ45 cat6", "Автомат 1P 16А"],
                        overdue: true, attention: true),
                    ConstructionRequest("req-4", "00СТ-001029", "assigned",
                        now.AddDays(-15), now.AddDays(12),
                        "Назначен закупщик: Петров П. С.", 3,
                        ["Щит ЩРН-36"]),
                ],
                Total = 42,
                HasMore = false,
                SourceGroups =
                [
                    new HubConstructionObjectGroup { GroupRef = "grp-1", GroupName = "ЖК «Северный» — электрика" },
                ],
                DirectionStats =
                [
                    new HubConstructionDirectionStat { GroupRef = "grp-1", GroupName = "ЖК «Северный» — электрика", Active = 6, Overdue = 1 },
                    new HubConstructionDirectionStat { GroupRef = "grp-2", GroupName = "ЖК «Северный» — СКС", Active = 3 },
                    new HubConstructionDirectionStat { GroupRef = "grp-4", GroupName = "ЖК «Северный» — сантехника", Active = 2 },
                ],
                Summary = new HubConstructionRequestTotals { Total = 42, Active = 11, History = 31, Overdue = 2 },
            },
            // Склад 1С: статус кэша справочников, подсказки, остатки, ведомость
            // с карточкой документа и остатки за уволенными — демо-кадры раздела.
            Warehouse1cCatalogStatus = new HubWarehouse1cCatalogStatus
            {
                NomenclatureCount = 4212,
                WarehousesCount = 9,
                UpdatedAt = Iso(now.AddMinutes(-25)),
            },
            Warehouse1cNomenclatureSearch =
            [
                new HubWarehouse1cCatalogItem { Ref = "nom-1", Code = "КБЛ-01", Name = "Кабель ВВГнг-LS 3х2,5" },
                new HubWarehouse1cCatalogItem { Ref = "nom-2", Code = "КБЛ-02", Name = "Кабель ВВГнг-LS 5х6" },
                new HubWarehouse1cCatalogItem { Ref = "nom-3", Code = "СВТ-07", Name = "Светильник ДВО 4000К" },
            ],
            Warehouse1cWarehousesSearch =
            [
                new HubWarehouse1cCatalogItem { Ref = "wh-1", Name = "Центральный склад" },
                new HubWarehouse1cCatalogItem { Ref = "wh-2", Name = "Склад ИТ" },
                new HubWarehouse1cCatalogItem { Ref = "wh-3", Name = "ЖК «Северный» — трейл" },
            ],
            Warehouse1cBalancesFactory = _ => new HubWarehouse1cBalancesResponse
            {
                Items =
                [
                    Warehouse1cBalance("nom-1", "КБЛ-01", "Кабель ВВГнг-LS 3х2,5",
                        "wh-1", "Центральный склад", 412.5, 618750, "Поступление 0000-001204 от 10.11.2026"),
                    Warehouse1cBalance("nom-2", "КБЛ-02", "Кабель ВВГнг-LS 5х6",
                        "wh-1", "Центральный склад", 180, 540000, "Поступление 0000-001198 от 08.11.2026",
                        seriesRef: "ser-1", seriesName: "Партия КБ-45"),
                    Warehouse1cBalance("nom-1", "КБЛ-01", "Кабель ВВГнг-LS 3х2,5",
                        "wh-2", "Склад ИТ", 36, 54000, "Перемещение 0000-000415 от 15.11.2026"),
                    Warehouse1cBalance("nom-3", "СВТ-07", "Светильник ДВО 4000К",
                        "wh-1", "Центральный склад", 24, 103200, "Поступление 0000-001171 от 03.11.2026"),
                ],
                Returned = 4,
                Total = 4,
                Aggregates = new HubWarehouse1cBalancesAggregates
                {
                    Qty = 652.5,
                    Cost = 1315950,
                    CostAccounting = 1315950,
                },
                AsOf = Iso(now.AddMinutes(-5)),
                Status = "ok",
            },
            Warehouse1cMovementsFactory = _ => new HubWarehouse1cMovementsResponse
            {
                Items =
                [
                    Warehouse1cMovement("reg-1", "Перемещение товаров", "0000-000415",
                        now.AddDays(-4), "Центральный склад", "Кабель ВВГнг-LS 3х2,5",
                        qtyEnd: 36, costEnd: 54000, kind: "transfer"),
                    Warehouse1cMovement("reg-2", "Реализация товаров и услуг", "0000-000988",
                        now.AddDays(-6), "Центральный склад", "Кабель ВВГнг-LS 3х2,5",
                        qtyOut: 50, qtyEnd: 412.5, costEnd: 618750, kind: "issue"),
                    Warehouse1cMovement("reg-3", "Поступление товаров и услуг", "0000-001204",
                        now.AddDays(-9), "Центральный склад", "Кабель ВВГнг-LS 3х2,5",
                        qtyIn: 462.5, qtyEnd: 462.5, costEnd: 693750),
                    Warehouse1cMovement("reg-4", "Списание товаров", "0000-000201",
                        now.AddDays(-15), "Центральный склад", "Кабель ВВГнг-LS 3х2,5",
                        qtyOut: 12, qtyEnd: 0, costEnd: 0, kind: "writeoff"),
                ],
                Returned = 4,
                Total = 4,
                HasMore = false,
                Status = "ok",
            },
            Warehouse1cMovementDetail = new HubWarehouse1cMovementDetail
            {
                RegistrarRef = "reg-1",
                RegistrarName = "Перемещение товаров",
                RegistrarNumber = "0000-000415",
                RegistrarDate = Iso(now.AddDays(-4)),
                DocumentType = "transfer",
                DocumentTitle = "Перемещение товаров",
                IsTransfer = true,
                WarehouseName = "Центральный склад",
                TransferFromWarehouseName = "Центральный склад",
                TransferToWarehouseName = "Склад ИТ",
                CounterpartyName = "ООО «ЗСГП» — внутреннее",
                Comment = "Перемещение под заявку 000-ИТ-42 (серверная ЦОД)",
                FilesStatus = "attached",
                Files =
                [
                    new HubWarehouse1cMovementFile
                    {
                        Ref = "file-1",
                        Name = "ТОРГ-13_000415.pdf",
                        Size = 148_240,
                        ContentType = "application/pdf",
                    },
                    new HubWarehouse1cMovementFile
                    {
                        Ref = "file-2",
                        Name = "фото_комплекта.jpg",
                        Size = 2_418_113,
                        ContentType = "image/jpeg",
                    },
                ],
            },
            Warehouse1cDismissed = new HubWarehouse1cDismissedResponse
            {
                Items =
                [
                    new HubWarehouse1cDismissedWarehouse
                    {
                        Warehouse = new HubWarehouse1cCatalogItem { Ref = "wh-9", Name = "Склад продаж — Ленина 12" },
                        EmployeeName = "Сидоров Сидор Сидорович",
                        Position = "Менеджер по продажам",
                        Department = "Отдел продаж",
                        City = "Тюмень",
                        DismissalDate = Iso(now.AddDays(-20)),
                        EmploymentLabel = "Уволен",
                        Totals = new HubWarehouse1cDismissedTotals
                        {
                            Qty = 7,
                            Cost = 48250,
                            Positions = 2,
                        },
                        Balances =
                        [
                            Warehouse1cBalance("nom-4", "КРТ-11", "Картридж HP CF283A",
                                "wh-9", "Склад продаж — Ленина 12", 4, 19600, "Оприходование 0000-000089"),
                            Warehouse1cBalance("nom-5", "МЫШ-02", "Мышь Logitech M185",
                                "wh-9", "Склад продаж — Ленина 12", 3, 28650, "Оприходование 0000-000076"),
                        ],
                    },
                    new HubWarehouse1cDismissedWarehouse
                    {
                        Warehouse = new HubWarehouse1cCatalogItem { Ref = "wh-10", Name = "Склад филиала «Юг»" },
                        EmployeeName = "Козлова Анна Викторовна",
                        Position = "Кладовщик",
                        Department = "Логистика",
                        City = "Тюмень",
                        DismissalDate = Iso(now.AddDays(-45)),
                        EmploymentLabel = "Уволена",
                        Totals = new HubWarehouse1cDismissedTotals
                        {
                            Qty = 2,
                            Cost = 11800,
                            Positions = 1,
                        },
                        Balances =
                        [
                            Warehouse1cBalance("nom-6", "БТР-04", "Батарея ИБП 12В 9Ач",
                                "wh-10", "Склад филиала «Юг»", 2, 11800, "Оприходование 0000-000052"),
                        ],
                    },
                ],
                Returned = 2,
                Total = 2,
                Status = "ok",
            },
            // IT-заявки на закупку МПЗ: список с фасетами складов и карточка
            // первой заявки (этапы, позиции, документы).
            Warehouse1cItRequestsFactory = query => new HubItRequestsResponse
            {
                Items =
                [
                    ItRequest("req-1", "000-ИТ-42", "ordered",
                        now.AddDays(-5), now.AddDays(6),
                        "Заказ PO-9 размещён у поставщика ООО «Снаб»",
                        ["SSD 1TB", "Патч-корд RJ45 3м"],
                        overdue: true),
                    ItRequest("req-2", "000-ИТ-41", "assigned",
                        now.AddDays(-8), now.AddDays(10),
                        "Назначен закупщик: Петров П. С.",
                        ["Картридж HP CF283A"]),
                    ItRequest("req-3", "000-ИТ-40", "created",
                        now.AddDays(-11), now.AddDays(14),
                        "Заявка создана, ожидает назначения",
                        ["Мышь Logitech M185", "Коврик для мыши", "USB-хаб 4 порта"]),
                ],
                Total = 3,
                AsOf = Iso(now.AddMinutes(-2)),
                SnapshotId = "snap-demo-1",
                WarehouseFacets =
                [
                    new HubWarehouse1cCatalogItem
                    {
                        Ref = "wh-2",
                        Name = "Склад ИТ",
                        Count = 2,
                        OverdueCount = 1,
                    },
                    new HubWarehouse1cCatalogItem { Ref = "wh-1", Name = "Центральный склад", Count = 1 },
                ],
            },
            Warehouse1cItRequestDetailFactory = reference => new HubItRequestItem
            {
                RequestRef = reference,
                RequestNumber = "000-ИТ-42",
                Date = Iso(now.AddDays(-5)),
                RequiredDate = Iso(now.AddDays(6)),
                DepartmentName = "ИТ-инфраструктура",
                InitiatorName = "Иван Иванов",
                ResponsibleName = "Пётр Петров",
                WarehouseName = "Склад ИТ",
                Stage = new HubItRequestStage { Key = "ordered", Label = "Заказана", Rank = 3 },
                CurrentState = new HubItRequestCurrentState
                {
                    Label = "Заказана",
                    Description = "Заказ PO-9 размещён у поставщика ООО «Снаб», ожидается поставка",
                },
                Comment = "Накопители для серверной ЦОД и коммутация нового стеллажа",
                SupplierNames = ["ООО «Снаб»"],
                ManagerNames = ["Пётр Петров"],
                ProgressLabel = "2 позиции в заявке",
                Overdue = true,
                AttentionRequired = true,
                IsActive = true,
                PositionsTotal = 2,
                NomenclatureItems =
                [
                    new HubItRequestNomenclaturePreview { Name = "SSD 1TB", Quantity = 4, Unit = "шт" },
                    new HubItRequestNomenclaturePreview { Name = "Патч-корд RJ45 3м", Quantity = 24, Unit = "шт" },
                ],
                Journey =
                [
                    new HubItRequestJourneyStep
                    {
                        Key = "created",
                        Label = "Заявка",
                        Reached = true,
                        Date = Iso(now.AddDays(-5)),
                        DocumentNumber = "000-ИТ-42",
                    },
                    new HubItRequestJourneyStep
                    {
                        Key = "assigned",
                        Label = "Закупщик",
                        Reached = true,
                        Date = Iso(now.AddDays(-4)),
                        DocumentNumber = "000-ИТ-42",
                    },
                    new HubItRequestJourneyStep
                    {
                        Key = "ordered",
                        Label = "Заказ",
                        Reached = true,
                        Current = true,
                        Date = Iso(now.AddDays(-3)),
                        DocumentNumber = "PO-9",
                    },
                    new HubItRequestJourneyStep { Key = "received", Label = "Поступление", Reached = false },
                    new HubItRequestJourneyStep { Key = "issued", Label = "Выдача", Reached = false },
                ],
                ItemGroups =
                [
                    new HubItRequestItemGroup
                    {
                        Name = "SSD 1TB",
                        Unit = "шт",
                        Quantity = 4,
                        QtyRequested = 4,
                        QtyOrdered = 4,
                    },
                    new HubItRequestItemGroup
                    {
                        Name = "Патч-корд RJ45 3м",
                        Unit = "шт",
                        Quantity = 24,
                        QtyRequested = 24,
                        QtyOrdered = 24,
                    },
                ],
                Timeline =
                [
                    new HubItRequestTimelineEvent
                    {
                        Type = "ordered",
                        Label = "Заказ поставщику",
                        DocumentNumber = "PO-9",
                        Date = Iso(now.AddDays(-3)),
                        Quantity = 28,
                        SupplierName = "ООО «Снаб»",
                        NomenclatureNames = ["SSD 1TB", "Патч-корд RJ45 3м"],
                    },
                    new HubItRequestTimelineEvent
                    {
                        Type = "assigned",
                        Label = "Назначение закупщика",
                        DocumentNumber = "000-ИТ-42",
                        Date = Iso(now.AddDays(-4)),
                        ManagerName = "Пётр Петров",
                    },
                ],
            },
            // ---- DLP-мониторинг: сводка, внимание, ПК, активность, пробы, графики ----
            DlpSummary = new HubDlpSummaryResponse
            {
                Success = true,
                Summary = new HubDlpSummary
                {
                    HostsTotal = 38,
                    HostsActiveToday = 12,
                    VisitsToday = 431,
                    FileEventsToday = 56,
                    CategoriesToday = new Dictionary<string, int>
                    {
                        ["work"] = 300,
                        ["entertainment"] = 17,
                        ["mail"] = 60,
                    },
                },
            },
            DlpAttention = new HubDlpAttentionResponse
            {
                Success = true,
                Hosts =
                [
                    new HubDlpAttentionHost
                    {
                        ComputerName = "PC-BUH-01",
                        UserFullName = "Иван Иванов",
                        BranchName = "Тюмень",
                        ActiveSec = 21_600,
                        PassiveSec = 1_800,
                        AwaySec = 3_600,
                        EntertainmentSec = 2_700,
                        UsbFiles = 0,
                        MessengerFiles = 2,
                        BreakSec = 2_700,
                        LastTs = now.ToUnixTimeSeconds() - 120,
                    },
                    new HubDlpAttentionHost
                    {
                        ComputerName = "PC-MAG-02",
                        UserFullName = "Сидорова Мария",
                        BranchName = "Магадан",
                        ActiveSec = 14_400,
                        AwaySec = 7_200,
                        UsbFiles = 4,
                        UsbBytes = 36_700_000,
                        MessengerFiles = 0,
                        LastTs = now.ToUnixTimeSeconds() - 600,
                    },
                    new HubDlpAttentionHost
                    {
                        ComputerName = "PC-KOM-05",
                        UserFullName = "Пётр Петров",
                        BranchName = "Комсомольск",
                        ActiveSec = 10_800,
                        AwaySec = 1_800,
                        UsbFiles = 0,
                        MessengerFiles = 7,
                        OffshiftSec = 1_800,
                        LastTs = now.ToUnixTimeSeconds() - 1_800,
                    },
                ],
            },
            DlpHosts = new HubDlpHostsResponse
            {
                Success = true,
                Hosts =
                [
                    new HubDlpHost
                    {
                        ComputerName = "PC-BUH-01",
                        WindowsUser = "PC-BUH-01\\ivanov",
                        UserLogin = "ZSGP\\ivanov",
                        UserFullName = "Иван Иванов",
                        BranchName = "Тюмень",
                        FileEvents = 12,
                        UsbEvents = 0,
                        TelegramEvents = 4,
                        MaxEvents = 1,
                        BrowserEvents = 8,
                        Visits = 96,
                        VisitsWindowDays = 30,
                        LastTs = now.ToUnixTimeSeconds() - 120,
                    },
                    new HubDlpHost
                    {
                        ComputerName = "PC-MAG-02",
                        WindowsUser = "PC-MAG-02\\sidorova",
                        UserLogin = "ZSGP\\sidorova",
                        UserFullName = "Сидорова Мария",
                        BranchName = "Магадан",
                        FileEvents = 23,
                        UsbEvents = 4,
                        TelegramEvents = 0,
                        MaxEvents = 0,
                        BrowserEvents = 3,
                        Visits = 54,
                        VisitsWindowDays = 30,
                        LastTs = now.ToUnixTimeSeconds() - 600,
                    },
                    new HubDlpHost
                    {
                        ComputerName = "PC-KOM-05",
                        WindowsUser = "PC-KOM-05\\petrov",
                        UserLogin = "ZSGP\\petrov",
                        UserFullName = "Пётр Петров",
                        BranchName = "Комсомольск",
                        FileEvents = 7,
                        UsbEvents = 0,
                        TelegramEvents = 5,
                        MaxEvents = 2,
                        BrowserEvents = 2,
                        Visits = 31,
                        VisitsWindowDays = 30,
                        LastTs = now.ToUnixTimeSeconds() - 1_800,
                    },
                ],
            },
            // Деталь первого ПК: рабочий день 09:00–18:00, обед, простой, ввод вне смены.
            DlpActivity = new HubDlpActivityResponse
            {
                Success = true,
                Buckets = DlpBuckets(now),
                Summary = new HubDlpActivitySummary
                {
                    ActiveSec = 24_600,
                    PassiveSec = 2_400,
                    AwaySec = 3_900,
                    LockedSec = 600,
                    BreakSec = 2_700,
                    OffshiftSec = 1_800,
                    ActiveOffshiftSec = 900,
                    ActivityPct = 84.1,
                },
                AppsTop =
                [
                    new HubDlpAppTop { App = "1cv8.exe", Sec = 12_000 },
                    new HubDlpAppTop { App = "chrome.exe", Sec = 7_800 },
                    new HubDlpAppTop { App = "Telegram.exe", Sec = 4_200 },
                    new HubDlpAppTop { App = "OUTLOOK.EXE", Sec = 600 },
                ],
                LocalTime = new HubDlpLocalTime
                {
                    Day = now.Date.ToString("yyyy-MM-dd"),
                    BranchName = "Тюмень",
                    UtcOffsetMinutes = 300,
                    WorkStartMin = 540,
                    WorkEndMin = 1_080,
                    LunchStartMin = 780,
                    LunchEndMin = 825,
                    WorkdaysMask = 31,
                },
            },
            DlpWorkSchedules = new HubDlpWorkSchedulesResponse
            {
                Success = true,
                Branches = ["Комсомольск", "Магадан", "Тюмень"],
                Items =
                [
                    new HubDlpWorkSchedule
                    {
                        BranchName = "Тюмень",
                        WorkStartMin = 540,
                        WorkEndMin = 1_080,
                        LunchStartMin = 780,
                        LunchEndMin = 825,
                        TzOffsetMinutes = 0,
                        WorkdaysMask = 31,
                        UpdatedBy = "admin",
                        UpdatedAt = now.AddDays(-2).ToString("O"),
                    },
                    new HubDlpWorkSchedule
                    {
                        BranchName = "Магадан",
                        WorkStartMin = 540,
                        WorkEndMin = 1_080,
                        LunchStartMin = 780,
                        LunchEndMin = 825,
                        TzOffsetMinutes = 360,
                        WorkdaysMask = 31,
                        UpdatedBy = "admin",
                        UpdatedAt = now.AddDays(-5).ToString("O"),
                    },
                ],
            },
            FsEgress = new HubFsEgressResponse
            {
                Success = true,
                Total = 3,
                NoiseHidden = 4,
                Items =
                [
                    new HubFsEgressEvent
                    {
                        Ts = now.ToUnixTimeSeconds() - 4_800,
                        Channel = "usb",
                        FileName = "Акт сверки ноябрь.docx",
                        Size = 156_000,
                        Count = 2,
                    },
                    new HubFsEgressEvent
                    {
                        Ts = now.ToUnixTimeSeconds() - 9_000,
                        Channel = "telegram",
                        FileName = "отчёт_филиал.xlsx",
                        Size = 84_000,
                        SendState = "sent",
                    },
                    new HubFsEgressEvent
                    {
                        Ts = now.ToUnixTimeSeconds() - 18_000,
                        Channel = "deleted",
                        FileName = "черновик_old.pdf",
                        Size = 240_000,
                    },
                ],
            },
            TelegramChats = new HubDlpChatsResponse
            {
                Success = true,
                Chats =
                [
                    new HubDlpChat
                    {
                        ComputerName = "PC-BUH-01",
                        WindowsUser = "PC-BUH-01\\ivanov",
                        ChatId = "-100200",
                        ChatName = "Бухгалтерия — файлы",
                        UpdatedAt = now.ToUnixTimeSeconds() - 3_000,
                        Messages =
                        [
                            new HubDlpChatMessage
                            {
                                Direction = "in",
                                Time = "11:24",
                                Sender = "Галина К.",
                                Text = "Пришли акт сверки до обеда",
                            },
                            new HubDlpChatMessage
                            {
                                Direction = "out",
                                Time = "11:31",
                                Sender = "Иван",
                                Text = "Отправил файлом в чат",
                            },
                            new HubDlpChatMessage
                            {
                                Direction = "out",
                                Time = "11:31",
                                Media = "Акт сверки ноябрь.docx",
                            },
                        ],
                        Screenshots = ["tg-1.png"],
                    },
                ],
            },
            MaxChats = new HubDlpChatsResponse
            {
                Success = true,
                Chats =
                [
                    new HubDlpChat
                    {
                        ComputerName = "PC-BUH-01",
                        WindowsUser = "PC-BUH-01\\ivanov",
                        ChatId = "7788",
                        ChatName = "ИТ-поддержка",
                        UpdatedAt = now.ToUnixTimeSeconds() - 7_200,
                        Messages =
                        [
                            new HubDlpChatMessage
                            {
                                Direction = "in",
                                Time = "09:12",
                                Sender = "Поддержка",
                                Text = "Заявка закрыта — проверьте печать.",
                            },
                        ],
                    },
                ],
            },
            BrowserVisits = new HubBrowserVisitsResponse
            {
                Success = true,
                Total = 3,
                Items =
                [
                    new HubBrowserVisit
                    {
                        Id = 1,
                        ComputerName = "PC-BUH-01",
                        Browser = "chrome",
                        Profile = "Default",
                        Url = "https://disk.yandex.ru/client/disk",
                        Title = "Яндекс Диск — персональное облако",
                        Domain = "disk.yandex.ru",
                        Category = "entertainment",
                        CategoryDisplay = "entertainment",
                        VisitedAt = now.AddHours(-1).ToString("O"),
                        DwellSec = 2_700,
                        IdleSec = 120,
                        Count = 1,
                    },
                    new HubBrowserVisit
                    {
                        Id = 2,
                        ComputerName = "PC-BUH-01",
                        Browser = "chrome",
                        Profile = "Default",
                        Url = "https://1c.ru/rus/products/1c-buhpredr/",
                        Title = "1С:Бухгалтерия — документация",
                        Domain = "1c.ru",
                        Category = "work",
                        CategoryDisplay = "work",
                        VisitedAt = now.AddHours(-3).ToString("O"),
                        DwellSec = 1_800,
                        Count = 4,
                        Merged = true,
                    },
                    new HubBrowserVisit
                    {
                        Id = 3,
                        ComputerName = "PC-BUH-01",
                        Browser = "chrome",
                        Profile = "Default",
                        Url = "https://mail.yandex.ru/",
                        Title = "Яндекс Почта",
                        Domain = "mail.yandex.ru",
                        Category = "mail",
                        CategoryDisplay = "mail",
                        VisitedAt = now.AddHours(-4).ToString("O"),
                        DwellSec = 600,
                        Count = 1,
                        ScreenshotFile = "browser-shot-1.png",
                    },
                ],
            },
        };
    }

    /// <summary>Заявка 1С демо-портфеля: стадия-пилюля, состояние, склад, позиции.</summary>
    private static HubConstructionRequestItem ConstructionRequest(
        string requestRef,
        string number,
        string stage,
        DateTimeOffset date,
        DateTimeOffset required,
        string stateText,
        int positions,
        IReadOnlyList<string> nomenclature,
        bool overdue = false,
        bool attention = false) =>
        new()
        {
            RequestRef = requestRef,
            RequestNumber = number,
            Date = Iso(date),
            RequiredDate = Iso(required),
            DepartmentName = "УМТО",
            ResponsibleName = "Иван Иванов",
            WarehouseName = "ЦО",
            GroupName = "ЖК «Северный» — электрика",
            Stage = new HubConstructionRequestStage
            {
                Key = stage,
                Label = stage switch
                {
                    "ordered" => "Заказано поставщику",
                    "fulfilled" => "Доставлено на склад",
                    "assigned" => "Назначен закупщик",
                    "needs_review" => "Требует проверки",
                    _ => stage,
                },
            },
            CurrentState = new HubConstructionCurrentState
            {
                Label = stage,
                Description = stateText,
            },
            IsActive = stage is not "fulfilled" and not "cancelled",
            Overdue = overdue,
            AttentionRequired = attention,
            PositionsTotal = positions,
            SectionCodes = ["ЭМ"],
            NomenclatureItems = nomenclature
                .Select((name, index) => new HubConstructionNomenclatureItem
                {
                    Name = name,
                    Quantity = index + 4,
                    Unit = index % 2 == 0 ? "м" : "шт",
                })
                .ToList(),
        };

    /// <summary>Строка остатка 1С: номенклатура, склад, партия, суммы.</summary>
    private static HubWarehouse1cBalance Warehouse1cBalance(
        string nomenclatureRef,
        string code,
        string name,
        string warehouseRef,
        string warehouse,
        double qty,
        double cost,
        string batchDocument,
        string? seriesRef = null,
        string? seriesName = null) =>
        new()
        {
            NomenclatureRef = nomenclatureRef,
            NomenclatureCode = code,
            NomenclatureName = name,
            CharacteristicName = "бухта 100м",
            SeriesRef = seriesRef,
            SeriesName = seriesName,
            WarehouseRef = warehouseRef,
            WarehouseName = warehouse,
            BatchDocumentName = batchDocument,
            BatchStatusName = "в наличии",
            QtyBalance = qty,
            CostBalance = cost,
            CostAccountingBalance = cost,
            AvgPrice = qty == 0 ? 0 : Math.Round(cost / qty, 2),
        };

    /// <summary>Строка ведомости движений 1С: документ, склад, приход/расход.</summary>
    private static HubWarehouse1cMovement Warehouse1cMovement(
        string registrarRef,
        string name,
        string number,
        DateTimeOffset date,
        string warehouse,
        string nomenclature,
        double qtyIn = 0,
        double qtyOut = 0,
        double qtyEnd = 0,
        double costEnd = 0,
        string kind = "receipt") =>
        new()
        {
            RegistrarRef = registrarRef,
            RegistrarName = name,
            RegistrarNumber = number,
            RegistrarDate = Iso(date),
            RegistrarDocumentType = kind,
            CanOpenDetail = true,
            IsTransfer = kind == "transfer",
            Period = Iso(date),
            NomenclatureRef = "nom-1",
            NomenclatureName = nomenclature,
            WarehouseRef = "wh-1",
            WarehouseName = warehouse,
            TransferFromWarehouseName = kind == "transfer" ? warehouse : null,
            TransferToWarehouseName = kind == "transfer" ? "Склад ИТ" : null,
            QtyIn = qtyIn,
            QtyOut = qtyOut,
            QtyEnd = qtyEnd,
            CostIn = qtyIn * 1500,
            CostOut = qtyOut * 1500,
            CostEnd = costEnd,
            AvgPriceEnd = qtyEnd == 0 ? 0 : Math.Round(costEnd / qtyEnd, 2),
        };

    /// <summary>Заявка на МПЗ демо-списка: стадия-пилюля, состояние, склад.</summary>
    private static HubItRequestItem ItRequest(
        string requestRef,
        string number,
        string stage,
        DateTimeOffset date,
        DateTimeOffset required,
        string stateText,
        IReadOnlyList<string> nomenclature,
        bool overdue = false) =>
        new()
        {
            RequestRef = requestRef,
            RequestNumber = number,
            Date = Iso(date),
            RequiredDate = Iso(required),
            DepartmentName = "ИТ-инфраструктура",
            InitiatorName = "Иван Иванов",
            ResponsibleName = "Пётр Петров",
            WarehouseRef = "wh-2",
            WarehouseName = "Склад ИТ",
            Stage = new HubItRequestStage
            {
                Key = stage,
                Label = stage switch
                {
                    "ordered" => "Заказана",
                    "assigned" => "Назначена",
                    "created" => "Создана",
                    _ => stage,
                },
            },
            CurrentState = new HubItRequestCurrentState
            {
                Label = stage switch
                {
                    "ordered" => "Заказана",
                    "assigned" => "Назначена",
                    "created" => "Создана",
                    _ => stage,
                },
                Description = stateText,
            },
            IsActive = true,
            StatusGroup = "active",
            Overdue = overdue,
            AttentionRequired = overdue,
            PositionsTotal = nomenclature.Count,
            ProgressLabel = $"{nomenclature.Count} поз. в заявке",
            NomenclatureItems = nomenclature
                .Select((name, index) => new HubItRequestNomenclaturePreview
                {
                    Name = name,
                    Quantity = (index + 1) * 4,
                    Unit = "шт",
                })
                .ToList(),
            ManagerNames = ["Пётр Петров"],
            SupplierNames = stage == "created" ? [] : ["ООО «Снаб»"],
        };

    private static NativeSession Session() => new(
        AccessToken: "demo-access",
        RefreshToken: "demo-refresh",
        ClientDeviceId: "demo-device",
        AccessTokenExpiresAtUtc: DateTimeOffset.UtcNow.AddMinutes(15),
        UserId: 7,
        UserName: "ivanov",
        FullName: "Иван Иванов");

    private static HubTaskItem Task(
        long id, string title, string status,
        DateTimeOffset? dueAt = null, bool overdue = false,
        string? dept = null, string? project = null,
        (int Done, int Total)? subtasks = null, int attachments = 0, int comments = 0) =>
        new()
        {
            Id = id,
            Title = title,
            DescriptionPreview = "Краткое описание задачи и контекст её выполнения.",
            Status = status,
            DueAt = dueAt,
            IsOverdue = overdue,
            AssigneeFullName = "Иван Иванов",
            DepartmentName = dept,
            ProjectName = project,
            SubtasksDone = subtasks?.Done ?? 0,
            SubtasksTotal = subtasks?.Total ?? 0,
            AttachmentsCount = attachments,
            CommentsUnread = comments,
        };

    private static HubAnnouncement Announcement(
        DateTimeOffset now, string id, string title, string preview, int ageHours,
        bool unread = false, bool ackPending = false, bool pinned = false,
        string priority = "normal", int attachments = 0, int comments = 0) =>
        new()
        {
            Id = id,
            Title = title,
            Preview = preview,
            // Детерминированная дата — как в NewsItem: кадры воспроизводимы.
            PublishedAt = now.AddHours(-ageHours),
            IsAckPending = ackPending,
        };

    private static HubAnnouncementItem NewsItem(
        DateTimeOffset now, string id, string title, string preview, int ageHours,
        bool unread = false, bool ackPending = false, bool pinned = false,
        string priority = "normal", int attachments = 0, int comments = 0) =>
        new()
        {
            Id = id,
            Title = title,
            Preview = preview,
            // Детерминированная дата от now — кадр список↔деталь согласован
            // (detail «a1» берёт тот же now.AddDays(-1)); хеш строки под .NET
            // рандомизирован на процесс, поэтому id-отступ недетерминирован.
            PublishedAt = now.AddHours(-ageHours),
            Priority = priority,
            IsUnread = unread,
            IsAckPending = ackPending,
            RequiresAck = ackPending,
            IsPinnedActive = pinned,
            AttachmentsCount = attachments,
            CommentsCount = comments,
            AuthorFullName = "ИТ-департамент",
        };

    private static HubAbsenceItem Absence(
        string name, string kindLabel, string starts, string ends, string source, string? id = null) =>
        new()
        {
            Id = id,
            DisplayName = name,
            KindLabel = kindLabel,
            StartsOn = starts,
            EndsOn = ends,
            Source = source,
        };

    private static HubChatConversation Conversation(
        string id, string kind, string title, int unread, bool pinned = false,
        string? preview = null, DateTimeOffset? at = null,
        HubChatUser? peer = null, int members = 0, int online = 0,
        string? role = null, string? avatar = null) =>
        new()
        {
            Id = id,
            Kind = kind,
            Title = title,
            UnreadCount = unread,
            IsPinned = pinned,
            IsSupport = kind == "support",
            LastMessagePreview = preview,
            LastMessageAt = at,
            DirectPeer = peer,
            MemberCount = members,
            OnlineMemberCount = online,
            ViewerMemberRole = role,
            AvatarUrl = avatar,
        };

    private static HubChatMessage Message(
        string id, string conversationId, string body, string? senderName,
        DateTimeOffset at, bool own = false, bool edited = false, bool deleted = false,
        HubChatReplyPreview? reply = null, int attachments = 0, int images = 0,
        IReadOnlyList<HubChatReaction>? reactions = null, string? senderAvatar = null) =>
        new()
        {
            Id = id,
            ConversationId = conversationId,
            Kind = "text",
            Body = body,
            CreatedAt = at,
            EditedAt = edited ? at.AddMinutes(2) : null,
            IsDeleted = deleted,
            IsOwn = own,
            ReplyPreview = reply,
            Sender = senderName is null
                ? new HubChatUser { Id = 7, Username = "ivanov", FullName = "Иван Иванов" }
                : new HubChatUser
                {
                    Id = 10 + id.Length, Username = "user", FullName = senderName,
                    AvatarUrl = senderAvatar,
                },
            Attachments = images > 0
                ? Enumerable.Range(1, images)
                    .Select(i => new HubChatAttachment
                    {
                        Id = $"{id}-img{i}",
                        Kind = "file",
                        MediaKind = "image",
                        FileName = $"фото_стойки_{i}.png",
                        MimeType = "image/png",
                        Width = 1280,
                        Height = 960,
                        SizeBytes = 380_000,
                    })
                    .ToList()
                : attachments > 0
                    ? Enumerable.Range(1, attachments)
                        .Select(i => new HubChatAttachment { Id = $"f{i}", FileName = $"документ_{i}.pdf", MimeType = "application/pdf", SizeBytes = 240_000 })
                        .ToList()
                    : null,
            Reactions = reactions,
        };

    private static HubNotificationItem Notification(
        string id, string eventType, string title, string body,
        DateTimeOffset createdAt, string entityType, string entityId, int unread) =>
        new()
        {
            Id = id,
            EventType = eventType,
            Title = title,
            Body = body,
            EntityType = entityType,
            EntityId = entityId,
            CreatedAt = Iso(createdAt),
            Unread = unread,
        };

    private static string Iso(DateTimeOffset value) =>
        value.ToString("O", CultureInfo.InvariantCulture);

    private static HubMailFolder MailFolder(
        string id, string label, string? wellKnown, int total, int unread = 0,
        string? parentId = null) =>
        new()
        {
            Id = id,
            Label = label,
            WellKnownKey = wellKnown,
            IsDistinguished = wellKnown is not null,
            Total = total,
            Unread = unread,
            ParentId = parentId,
        };

    private static HubMailMessagePage MailPage(DateTimeOffset now) =>
        new()
        {
            Folder = "inbox",
            Limit = 25,
            Total = 10,
            HasMore = true,
            NextOffset = 8,
            Items =
            [
                MailMessage("m1", "Регламентные работы в ДЦ — график на выходные",
                    "Ирина Петрова", "petrova@zsgp.ru", now.AddHours(-1),
                    unread: true, importance: "high", attachments: 2,
                    preview: "В субботу с 08:00 до 12:00 проводим регламентные работы на СХД…"),
                MailMessage("m2", "Отчёт по инцидентам за октябрь",
                    "Система отчётов", "reports@zsgp.ru", now.AddHours(-4),
                    unread: true,
                    preview: "Сформирован ежемесячный отчёт по инцидентам: 41 обращение…"),
                MailMessage("m3", "Новые сетевые схемы филиалов",
                    "Сергей Козлов", "kozlov@zsgp.ru", now.AddHours(-9),
                    attachments: 1,
                    preview: "Выкладываю актуальные схемы L2/L3 по филиалам — drawio + PDF…"),
                MailMessage("m4", "Инвентаризация: расхождения по ноябрьской выгрузке",
                    "Мария Сидорова", "sidorova@zsgp.ru", now.AddDays(-1),
                    preview: "По 12 позициям не сходится локация — список во вложении…"),
                MailMessage("m5", "Закупка лицензий Office 2024 — согласование",
                    "Отдел закупок", "zakupki@zsgp.ru", now.AddDays(-2),
                    attachments: 1,
                    preview: "Прошу согласовать спецификацию на 40 лицензий до пятницы…"),
                MailMessage("m6", "Резервное копирование: новый регламент",
                    "Артём Волков", "volkov@zsgp.ru", now.AddDays(-3),
                    preview: "Обновлён регламент резервного копирования файловых серверов…"),
                MailMessage("m7", "Плановый аудит доступности сервисов",
                    "Система мониторинга", "monitor@zsgp.ru", now.AddDays(-4),
                    preview: "Во вторник проводим плановый аудит доступности внутренних сервисов…"),
                MailMessage("m8", "Обновление VPN-шлюза филиалов",
                    "Дмитрий Ершов", "ershov@zsgp.ru", now.AddDays(-5),
                    unread: true,
                    preview: "В ночь на субботу обновляем прошивку VPN-шлюзов в филиалах…"),
            ],
        };

    /// <summary>Вторая страница выдачи: infinite scroll добирает её прокруткой к концу.</summary>
    private static HubMailMessagePage MailSecondPage(DateTimeOffset now) =>
        new()
        {
            Folder = "inbox",
            Limit = 25,
            Offset = 8,
            Total = 10,
            Items =
            [
                MailMessage("m9", "Смета на кабельную продукцию — декабрь",
                    "Отдел закупок", "zakupki@zsgp.ru", now.AddDays(-6),
                    preview: "Приложена смета на кабельную продукцию для монтажа в декабре…"),
                MailMessage("m10", "Отчёт по SLA поддержки за месяц",
                    "Система отчётов", "reports@zsgp.ru", now.AddDays(-7),
                    unread: true,
                    preview: "Итоги месяца по SLA: 94% обращений закрыто в срок…"),
            ],
        };

    private static HubMailMessagePreview MailMessage(
        string id, string subject, string senderName, string senderEmail,
        DateTimeOffset at, bool unread = false, int attachments = 0,
        string importance = "normal", string? preview = null) =>
        new()
        {
            Id = id,
            MailboxId = "mbx-1",
            Folder = "inbox",
            Subject = subject,
            SenderName = senderName,
            SenderEmail = senderEmail,
            SenderDisplay = $"{senderName} <{senderEmail}>",
            ReceivedAt = Iso(at),
            IsRead = !unread,
            HasAttachments = attachments > 0,
            AttachmentsCount = attachments,
            Importance = importance,
            BodyPreview = preview,
        };

    private static HubDocflowTaskItem DocflowTask(
        string taskRef, string typeLabel, string title, string author,
        DateTimeOffset createdAt, DateTimeOffset? dueAt = null,
        string importance = "Обычная") =>
        new()
        {
            Ref = taskRef,
            TaskTypeLabel = typeLabel,
            Title = title,
            Author = author,
            CreatedAt = Iso(createdAt),
            DueAt = dueAt is { } due ? Iso(due) : null,
            Importance = importance,
            BusinessState = "На исполнении",
            Accepted = true,
        };

    private static HubTicketRequest Ticket(
        long id, string employee, string status,
        string? objectName = null, string? departure = null,
        string? route = null, string? cost = null,
        bool urgent = false, bool needsReview = false,
        string? assignee = null, string? note = null) =>
        new()
        {
            Id = id,
            EmployeeId = 100 + id,
            EmployeeName = employee,
            ObjectName = objectName,
            Status = status,
            AssigneeName = assignee,
            SubmittedAt = Iso(DateTimeOffset.Now.AddDays(-(id - 100))),
            DepartureDate = departure,
            Route = route,
            TotalCost = cost,
            IsUrgent = urgent,
            NeedsReview = needsReview,
            Source = "web",
            Version = 3,
            Department = "ИТ-департамент",
            Position = "Инженер",
            Note = note,
        };

    private static HubTicketKanbanCard KanbanCard(
        long id, string employee, string objectName, string status,
        string departure, string route, bool urgent = false,
        string? assignee = null) =>
        new()
        {
            Id = id,
            EmployeeName = employee,
            ObjectName = objectName,
            DepartureDate = departure,
            Route = route,
            IsUrgent = urgent,
            AssigneeName = assignee,
            Status = status,
        };

    private static HubAddressBookItem AddressEntry(
        string name, string position, string department, string city,
        string phone, string email, string? office = null, bool photo = false) =>
        new()
        {
            FullName = name,
            Position = position,
            Department = department,
            DepartmentLocation = city,
            OfficeAddress = office,
            WorkPhones = [new HubAddressBookContactValue { Value = phone, Kind = "work" }],
            WorkEmails = [new HubAddressBookContactValue { Value = email, Kind = "work" }],
            HireDate = "2021-03-15",
            PhotoUrl = photo ? "/api/v1/address-book/photo/petrov" : null,
        };

    private static HubCompanyStructureNode StructNode(
        string id, string? parentId, string type, string title,
        string? person = null, string? position = null, int subtree = 0,
        IReadOnlyList<HubCompanyStructureNode>? children = null) =>
        new()
        {
            Id = id,
            ParentId = parentId,
            NodeType = type,
            Title = title,
            PersonName = person,
            PersonPosition = position,
            PersonPhotoUrl = person is not null ? $"/api/v1/company-structure/nodes/{id}/photo" : null,
            SubtreePeopleCount = subtree,
            ChildNodeCount = children?.Count ?? 0,
            IsActive = true,
            Children = children,
        };

    private static HubCompanyStructurePerson StructPerson(
        string name, string position, string department, string city,
        string phone, string email) =>
        new()
        {
            FullName = name,
            Position = position,
            Department = department,
            DepartmentLocation = city,
            WorkPhones = [phone],
            WorkEmails = [email],
        };

    private static HubItObjectAccess FullItAccess(bool owner = false) =>
        new()
        {
            IsOwner = owner,
            Sections = new Dictionary<string, string>
            {
                ["passwords"] = owner ? "manage" : "view",
                ["computers"] = "manage",
                ["inventory"] = "view",
                ["monitoring"] = "view",
                ["netmap"] = "view",
            },
        };

    private static HubItObjectComputer ItObjectComputer(
        string mac, string hostname, string status, string user, string login,
        string ip, string? inv = null, string? model = null) =>
        new()
        {
            MacAddress = mac,
            Hostname = hostname,
            Status = status,
            UserFullName = user,
            UserLogin = login,
            IpPrimary = ip,
            InventoryInvNo = inv,
            InventoryModelName = model,
            LastSeenAt = DateTimeOffset.Now.ToUnixTimeSeconds() - 60,
        };

    private static HubItObjectMonitoringTarget ItTarget(
        string id, string name, string address, string status, double? latency = null) =>
        new()
        {
            Id = id,
            Name = name,
            Address = address,
            Port = 161,
            Enabled = true,
            Current = new HubItObjectMonitoringCurrent
            {
                Status = status,
                CheckedAt = Iso(DateTimeOffset.Now.AddMinutes(-1)),
                SnmpStatus = status == "online" ? "ok" : "error",
                LatencyMs = latency,
                OpenEvents = status == "offline" ? 1 : 0,
            },
        };

    private static HubNetworkBranch NetBranch(
        long id, string city, string code, string name,
        int devices, int ports, int occupied, int sockets, int maps, int points) =>
        new()
        {
            Id = id,
            CityCode = city,
            BranchCode = code,
            Name = name,
            IsActive = 1,
            DevicesCount = devices,
            PortsCount = ports,
            OccupiedPorts = occupied,
            SocketsCount = sockets,
            MapsCount = maps,
            MapPointsCount = points,
            UpdatedAt = Iso(DateTimeOffset.Now.AddDays(-2)),
        };

    private static HubNetworkDevice NetDevice(
        long id, string code, string type, string model, string site, string ip,
        int ports, int occupied) =>
        new()
        {
            Id = id,
            BranchId = 1,
            DeviceCode = code,
            DeviceType = type,
            Vendor = model.Split(' ')[0],
            Model = model,
            SiteCode = site,
            MgmtIp = ip,
            PortsCount = ports,
            OccupiedPorts = occupied,
        };

    private static HubComputer Computer(
        string mac, string hostname, string status,
        string? userName, string? userLogin,
        string branch, string location, string ip,
        string? inv = null, string? model = null) =>
        new()
        {
            MacAddress = mac,
            Hostname = hostname,
            Status = status,
            AgeSeconds = status == "online" ? 90 : 3600,
            LastSeenAt = DateTimeOffset.Now.ToUnixTimeSeconds() - (status == "online" ? 90 : 3600),
            UserFullName = userName,
            UserLogin = userLogin,
            BranchName = branch,
            LocationName = location,
            DatabaseName = "main",
            InventoryInvNo = inv,
            InventoryModelName = model,
            IpPrimary = ip,
            IpList = [ip],
        };

    private static HubEquipmentItem Equipment(
        double invNo, string type, string model, string vendor,
        string? serial = null, string? employee = null,
        long? ownerNo = null,
        string? branch = null, string? location = null,
        string? status = null, string? ip = null) =>
        new()
        {
            Id = 900000 + (long)invNo,
            InvNo = invNo,
            TypeName = type,
            ModelName = model,
            VendorName = vendor,
            SerialNo = serial,
            StatusName = status,
            EmplNo = ownerNo,
            EmployeeName = employee,
            BranchName = branch,
            LocationName = location,
            IpAddress = ip,
        };

    private static HubGroupsAccessGroup AccessGroup(
        string dn, string cn, string branch, string folderLabel, string level,
        int members, string? description = null) =>
        new()
        {
            Dn = dn,
            Cn = cn,
            Branch = branch,
            FolderLabel = folderLabel,
            AccessLevel = level,
            MemberCount = members,
            Description = description,
        };

    private static HubMonitoringTarget MonTarget(
        string id, string name, string address, string status,
        double latency = 0, int openEvents = 0,
        double? rxBps = null, double? txBps = null) =>
        new()
        {
            Id = id,
            Name = name,
            Address = address,
            Port = 161,
            Enabled = true,
            Current = new HubMonitoringCurrent
            {
                Status = status,
                CheckedAt = Iso(DateTimeOffset.Now.AddMinutes(-1)),
                SnmpStatus = status == "online" ? "ok" : "error",
                OpenEvents = openEvents,
                Ping = new HubMonitoringPing
                {
                    Status = status,
                    LatencyMs = status == "online" ? latency : null,
                    LossPct = status == "online" ? 0 : 100,
                    Sent = 3,
                    Received = status == "online" ? 3 : 0,
                },
            },
            Summary = rxBps is null
                ? null
                : new HubMonitoringSummary
                {
                    Name = "wan1",
                    CheckedAt = Iso(DateTimeOffset.Now.AddMinutes(-1)),
                    RxBps = rxBps,
                    TxBps = txBps,
                    SpeedBps = 1_000_000_000,
                },
            Outages = status == "offline"
                ? new HubMonitoringOutage[]
                {
                    new() { Kind = "unreachable", OpenedAt = Iso(DateTimeOffset.Now.AddHours(-2)) },
                }
                : null,
        };

    private static HubMfuDevice MfuDevice(
        string key, string invNo, string model, string vendor, string ip,
        string status, long pages = 0, int toner = 0) =>
        new()
        {
            Key = key,
            Id = key.Split('|')[1],
            InvNo = invNo,
            TypeName = "МФУ",
            ModelName = model,
            Manufacturer = vendor,
            IpAddress = ip,
            Status = status,
            Runtime = new HubMfuRuntime
            {
                Ping = new HubMfuPing
                {
                    Status = status,
                    LatencyMs = status == "online" ? 1.2 : null,
                    CheckedAt = Iso(DateTimeOffset.Now.AddMinutes(-1)),
                    LastOnlineAt = status == "offline"
                        ? Iso(DateTimeOffset.Now.AddDays(-2))
                        : null,
                },
                Snmp = new HubMfuSnmp
                {
                    Status = status == "online" ? "ok" : "error",
                    CheckedAt = Iso(DateTimeOffset.Now.AddMinutes(-1)),
                    PageTotal = pages,
                    BestPercent = toner,
                    Supplies =
                    [
                        new HubMfuSupply { Index = 1, Name = "Чёрный тонер", Percent = toner, Level = toner, Max = 100 },
                    ],
                    Trays =
                    [
                        new HubMfuTray { Index = 1, Name = "Лоток 1", MediaName = "A4", Percent = 82, CurrentLevel = 410, MaxCapacity = 500 },
                    ],
                    DeviceInfo = new HubMfuDeviceInfo
                    {
                        SysName = model,
                        DeviceModel = model,
                        SerialNumber = $"SN{invNo}",
                    },
                },
            },
        };

    private static HubKbArticle KbArticle(
        string id, string title, string category, string type,
        string? summary = null, string[]? tags = null,
        HubKbContentBlock? content = null) =>
        new()
        {
            Id = id,
            Title = title,
            Category = category,
            ArticleType = type,
            Status = "published",
            Summary = summary,
            Tags = tags,
            OwnerName = "ИТ-департамент",
            Version = 3,
            CreatedAt = DateTimeOffset.Now.AddDays(-30),
            UpdatedAt = DateTimeOffset.Now.AddDays(-5),
            Content = content ?? new HubKbContentBlock
            {
                Overview = summary,
                ResolutionSteps = ["Откройте раздел", "Следуйте инструкции"],
            },
        };

    private static HubAdminUser AdminUser(
        long id, string login, string name, string department, string job,
        string role, bool mail = false, bool twoFa = false, bool active = true,
        string auth = "ldap") =>
        new()
        {
            Id = id,
            Username = login,
            FullName = name,
            Email = $"{login}@zsgp.ru",
            Department = department,
            JobTitle = job,
            Role = role,
            IsActive = active,
            AuthSource = auth,
            MailboxLogin = mail ? login : null,
            MailIsConfigured = mail,
            IsTwoFactorEnabled = twoFa,
            LastLoginAt = Iso(DateTimeOffset.Now.AddHours(-(id * 3))),
        };

    private static HubAdminDepartment AdminDept(
        string id, string name, int members, int managers) =>
        new()
        {
            Id = id,
            Name = name,
            Source = "hub",
            IsActive = true,
            MembersCount = members,
            ManagersCount = managers,
            CreatedAt = Iso(DateTimeOffset.Now.AddMonths(-8)),
        };

    private static HubAdminDepartmentMember AdminMember(
        long id, long userId, string role, string login, string name, string job) =>
        new()
        {
            Id = id,
            UserId = userId,
            Role = role,
            Source = "hub",
            IsActive = true,
            User = new HubAdminDepartmentMemberUser
            {
                Id = userId,
                Username = login,
                FullName = name,
                JobTitle = job,
                Department = "ИТ-департамент",
            },
        };

    /// <summary>
    /// Демо-день DLP-детали: 09:00–16:00 ввод в 1С/браузере, обед в «lunch»-зоне,
    /// простой 15:00–16:00, хвост «вне смены» — шкала и лента серий заполнены.
    /// </summary>
    private static List<HubDlpActivityBucket> DlpBuckets(DateTimeOffset now)
    {
        var buckets = new List<HubDlpActivityBucket>();
        void Fill(int fromMin, int count, string zone, double active, double passive,
            double away, double @break, double offshift, string? app)
        {
            for (var i = 0; i < count; i++)
            {
                var start = new DateTimeOffset(now.Date, TimeSpan.FromHours(5))
                    .AddMinutes(fromMin + i * 5);
                buckets.Add(new HubDlpActivityBucket
                {
                    BucketStart = start.ToString("O"),
                    ActiveSec = active,
                    PassiveSec = passive,
                    AwaySec = away,
                    BreakSec = @break,
                    OffshiftSec = offshift,
                    Zone = zone,
                    App = app,
                });
            }
        }

        Fill(9 * 60, 36, "work", 270, 30, 0, 0, 0, "1cv8.exe");
        Fill(12 * 60, 12, "work", 200, 80, 20, 0, 0, "chrome.exe");
        Fill(13 * 60, 9, "lunch", 0, 0, 0, 300, 0, null);
        Fill(13 * 60 + 45, 15, "work", 240, 40, 20, 0, 0, "1cv8.exe");
        Fill(15 * 60, 12, "work", 0, 40, 260, 0, 0, null);
        Fill(16 * 60, 25, "work", 280, 20, 0, 0, 0, "Telegram.exe");
        Fill(19 * 60, 6, "off", 0, 0, 0, 0, 300, null);
        return buckets;
    }
}
