using System.Globalization;
using System.IO;
using System.Windows;
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
        NativeThemeManager.Apply("dark");

        // Полное окно в состоянии Ready на демо-данных — все 5 страниц.
        var api = DemoApi();
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
        // Детали, чтобы мастер-деталь был заполнен на снимках.
        vm.Tasks.SelectedItem = vm.Tasks.Items.Count > 0 ? vm.Tasks.Items[0] : null;
        PumpUntil(() => vm.Tasks.Detail is not null, TimeSpan.FromSeconds(10));
        vm.News.SelectedItem = vm.News.Items.Count > 0 ? vm.News.Items[0] : null;
        PumpUntil(() => vm.News.Detail is not null, TimeSpan.FromSeconds(10));
        vm.Chat.SelectedConversation = vm.Chat.Conversations.Count > 0
            ? vm.Chat.Conversations[0]
            : null;
        PumpUntil(() => vm.Chat.Messages.Count > 0, TimeSpan.FromSeconds(10));
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
        // МФУ: первое устройство с журналом печати по месяцам.
        vm.Mfu.SelectedDevice = vm.Mfu.Items
            .OfType<MfuDeviceItemViewModel>()
            .FirstOrDefault();
        PumpUntil(
            () => vm.Mfu.Detail is not null && vm.Mfu.Detail.MonthlyItems.Count > 0,
            TimeSpan.FromSeconds(15));
        // Справка: первая опубликованная статья выбирается при загрузке.
        PumpUntil(() => vm.Help.Detail is not null, TimeSpan.FromSeconds(10));
        // Администрирование: первый раздел (пользователи).
        PumpUntil(() => vm.Admin.Users.Count > 0, TimeSpan.FromSeconds(10));
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
        };
        foreach (var (page, file) in pages)
        {
            vm.NavigateToPageCommand.Execute(page);
            window.UpdateLayout();
            SavePng(window, Path.Combine(outputDir, file));

            if (page == "tickets")
            {
                // Канбан-режим заявок — отдельный кадр, потом возврат в список.
                vm.Tickets.SelectViewModeCommand.Execute("kanban");
                PumpUntil(
                    () => vm.Tickets.KanbanColumns.Count > 0 && !vm.Tickets.IsKanbanLoading,
                    TimeSpan.FromSeconds(10));
                window.UpdateLayout();
                SavePng(window, Path.Combine(outputDir, "09b-tickets-kanban.png"));
                vm.Tickets.SelectViewModeCommand.Execute("list");
                window.UpdateLayout();
            }
        }

        // Светлая проверка: подмена словаря палитры на лету —
        // ключевые страницы переснимаются без пересоздания окна.
        NativeThemeManager.Apply("light");
        var lightPages = new (string Name, string File)[]
        {
            ("dashboard", "L01-dashboard.png"),
            ("tasks", "L02-tasks.png"),
            ("chat", "L04-chat.png"),
            ("docflow", "L08-docflow.png"),
            ("tickets", "L09-tickets.png"),
            ("itobjects", "L13-itobjects.png"),
            ("database", "L16-database.png"),
        };
        foreach (var (page, file) in lightPages)
        {
            vm.NavigateToPageCommand.Execute(page);
            window.UpdateLayout();
            SavePng(window, Path.Combine(outputDir, file));
        }

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
        loginWindow.Close();
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

        return new FakeHubApiClient
        {
            StoredSession = Session(),
            AccessTokenToReturn = null, // без реальных WS-подключений в рендере
            ImageDownloadBytes = TestImageBytes.Png1X1, // фото/карты через AuthImageLoader
            CurrentUser = new HubUser
            {
                Id = 7,
                Username = "ivanov",
                FullName = "Иван Иванов",
                Email = "ivanov@zsgp.ru",
                Role = "admin",
                IsTwoFactorEnabled = true,
                TrustedDevicesCount = 2,
                Permissions = ["mfu.read", "computers.read_all"],
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
                SubtasksTotal = 7,
                SubtasksDone = 5,
                Capabilities = new HubTaskCapabilities { CanReview = true },
            },
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
                AttachmentsCount = 2,
            },
            AbsencesList = new HubAbsenceRangeList
            {
                Items =
                [
                    Absence("Алексей Смирнов", "Командировка", "2025-11-17", "2025-11-17", "hub"),
                    Absence("Елена Волкова", "Отсутствует", "2025-11-17", "2025-11-17", "hub"),
                ],
                ZupItems =
                [
                    Absence("Пётр Петров", "Отпуск", "2025-11-10", "2025-11-21", "zup"),
                    Absence("Мария Сидорова", "Больничный", "2025-11-14", "2025-11-18", "zup"),
                    Absence("Дмитрий Козлов", "Отпуск", "2025-11-17", "2025-11-28", "zup"),
                ],
                ZupCount = 3,
            },
            ChatConversations = new HubChatConversationList
            {
                Items =
                [
                    Conversation("c1", "group", "IT-отдел", unread: 5, pinned: true,
                        preview: "Согласовал бюджет на следующий год", at: now.AddMinutes(-12), members: 12, online: 4),
                    Conversation("c2", "direct", "Ирина Петрова", unread: 2,
                        preview: "Посмотри, пожалуйста, отчёт", at: now.AddHours(-2),
                        peer: new HubChatUser { Id = 11, Username = "petrova", FullName = "Ирина Петрова" }),
                    Conversation("c3", "support", "Поддержка HUB", unread: 0,
                        preview: "Ваш запрос принят в работу", at: now.AddHours(-5)),
                    Conversation("c4", "notes", "Заметки", unread: 0,
                        preview: "Список дел: документы, почта…", at: now.AddDays(-1)),
                    Conversation("c5", "direct", "Сергей Козлов", unread: 0,
                        preview: "Ок, спасибо!", at: now.AddDays(-2),
                        peer: new HubChatUser { Id = 12, Username = "kozlov", FullName = "Сергей Козлов" }),
                ],
            },
            ChatMessages = new HubChatMessageList
            {
                Items =
                [
                    Message("m1", "c1", "Коллеги, доброе утро! Напоминаю про планёрку в 10:00 — обсудим релизные окна.", "Ирина Петрова", now.AddMinutes(-58)),
                    Message("m2", "c1", "Всем привет! Буду чуть позже — заканчиваю отчёт по инцидентам.", null, now.AddMinutes(-54), own: true),
                    Message("m3", "c1", "Ок, тогда начнём без тебя, протокол скину.", "Пётр Петров", now.AddMinutes(-50),
                        reply: new HubChatReplyPreview { SenderName = "Иван Иванов", Body = "Всем привет! Буду чуть позже" }),
                    Message("m4", "c1", "Выкладываю презентацию и смету к проекту", null, now.AddMinutes(-41), own: true,
                        attachments: 2),
                    Message("m5", "c1", "Посмотрела — всё огонь, по смете один вопрос в личке", "Ирина Петрова", now.AddMinutes(-33),
                        reactions: [new HubChatReaction { Emoji = "👍", Count = 3 }, new HubChatReaction { Emoji = "🔥", Count = 1 }]),
                    Message("m6", "c1", "Кстати, сервер бэкапов переехал в стойку 4", "Дмитрий Козлов", now.AddMinutes(-20), edited: true),
                    Message("m7", "c1", "удалённое", "Дмитрий Козлов", now.AddMinutes(-18), deleted: true),
                    Message("m8", "c1", "Согласовал бюджет на следующий год", "Пётр Петров", now.AddMinutes(-12)),
                ],
                HasOlder = true,
                OlderCursorMessageId = "m1",
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
                    ],
                    Favorites = ["inbox"],
                },
                Messages = mailPage,
                State = "ok",
                Source = "exchange",
            },
            MailMessagesPage = mailPage,
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
                        branch: "РЦ «Восточный»", location: "Кабинет 214",
                        status: "Эксплуатация", ip: "10.24.5.114"),
                    Equipment(4522, "Системный блок", "HP EliteDesk 800 G6", "HP",
                        serial: "CZC1432K9R", employee: "Громов Пётр Львович",
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
                Photos =
                [
                    new HubEquipmentPhoto { FileNo = 71, FileName = "inv-4521-front.jpg", Description = "Лицевая панель", SizeMb = 1.8, HasThumb = true, CreatedAt = Iso(now.AddDays(-30)), CreatedBy = "ivanov", Verified = true },
                    new HubEquipmentPhoto { FileNo = 72, FileName = "inv-4521-label.jpg", Description = "Инвентарная наклейка", SizeMb = 0.9, HasThumb = true, CreatedAt = Iso(now.AddDays(-30)), CreatedBy = "ivanov" },
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
                new HubAdminAiBot { Id = "bot-1", Slug = "help-desk", Title = "Помощник поддержки", Description = "Отвечает на типовые вопросы по базе знаний", Model = "openai/gpt-4o-mini", IsEnabled = true, Configured = true, LatestRunStatus = "ok", EnabledTools = ["kb_search", "ticket_lookup"] },
                new HubAdminAiBot { Id = "bot-2", Slug = "doc-summary", Title = "Саммари документов", Description = "Краткая выжимка длинных документов", Model = "openai/gpt-4o-mini", IsEnabled = true, Configured = true, LatestRunStatus = "ok", AllowedKbScope = ["docflow"] },
                new HubAdminAiBot { Id = "bot-3", Slug = "net-diagnose", Title = "Диагност сети", Description = "Подсказки по инцидентам мониторинга", Model = "anthropic/claude-3.5-sonnet", IsEnabled = false, Configured = false, RequiredPermission = "monitoring.read" },
            ],
        };
    }

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
        string name, string kindLabel, string starts, string ends, string source) =>
        new()
        {
            DisplayName = name,
            KindLabel = kindLabel,
            StartsOn = starts,
            EndsOn = ends,
            Source = source,
        };

    private static HubChatConversation Conversation(
        string id, string kind, string title, int unread, bool pinned = false,
        string? preview = null, DateTimeOffset? at = null,
        HubChatUser? peer = null, int members = 0, int online = 0) =>
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
        };

    private static HubChatMessage Message(
        string id, string conversationId, string body, string? senderName,
        DateTimeOffset at, bool own = false, bool edited = false, bool deleted = false,
        HubChatReplyPreview? reply = null, int attachments = 0,
        IReadOnlyList<HubChatReaction>? reactions = null) =>
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
                : new HubChatUser { Id = 10 + id.Length, Username = "user", FullName = senderName },
            Attachments = attachments > 0
                ? Enumerable.Range(1, attachments)
                    .Select(i => new HubChatAttachment { Id = $"f{i}", FileName = $"документ_{i}.pdf", MimeType = "application/pdf", SizeBytes = 240_000 })
                    .ToList()
                : null,
            Reactions = reactions,
        };

    private static string Iso(DateTimeOffset value) =>
        value.ToString("O", CultureInfo.InvariantCulture);

    private static HubMailFolder MailFolder(
        string id, string label, string? wellKnown, int total, int unread = 0) =>
        new()
        {
            Id = id,
            Label = label,
            WellKnownKey = wellKnown,
            IsDistinguished = wellKnown is not null,
            Total = total,
            Unread = unread,
        };

    private static HubMailMessagePage MailPage(DateTimeOffset now) =>
        new()
        {
            Folder = "inbox",
            Limit = 25,
            Total = 5,
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
}
