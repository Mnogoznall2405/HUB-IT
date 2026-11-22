using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Hub.Desktop.Native;
using Hub.Desktop.Native.Api;
using Hub.Desktop.Native.ViewModels;
using Xunit;
using Xunit.Abstractions;

namespace Hub.Desktop.Tests;

/// <summary>
/// Живой стенд паритета: поднимает настоящее HubWindow на реальном HubApiClient
/// против локального e2e-бэкенда и исполняет JSON-команды из каталога.
/// Тест env-гейтован: без HUB_PARITY_BACKEND завершается успехом сразу.
///
/// Запуск:
///   HUB_PARITY_BACKEND=http://127.0.0.1:18001
///   HUB_PARITY_CMD_DIR=&lt;каталог команд&gt;
///   HUB_PARITY_OUT=&lt;каталог кадров&gt;
///   dotnet test --filter "FullyQualifiedName~WebParityStand"
///
/// Командный файл *.cmd.json в CMD_DIR:
///   {"op":"resize","w":1280,"h":720,"left":40,"top":40}
///   {"op":"theme","value":"dark"|"light"}
///   {"op":"select","title":"E2E Пользователь"} | {"op":"select","id":"..."}
///   {"op":"folder","key":"..."}                     ActiveFolderKey
///   {"op":"invoke","path":"Chat.TogglePeerCardCommand","param":null}
///   {"op":"set","path":"Chat.ComposerText","value":"текст"}
///   {"op":"get","path":"Chat.SelectedConversation.Title"}
///   {"op":"send_text","text":"..."}
///   {"op":"shot","name":"x.png"}                    RenderTargetBitmap всего окна
///   {"op":"measure","name":"x.json"}                дамп именованных областей
///   {"op":"wait","ms":500} | {"op":"wait_until","path":"Chat.IsReady","ms":10000}
///   {"op":"quit"}
/// Результат — одноимённый *.done.json {ok, result|error}.
/// </summary>
[Collection("NativeTheme")]
public sealed class WebParityStand
{
    private readonly ITestOutputHelper _output;

    public WebParityStand(ITestOutputHelper output) => _output = output;

    private static readonly string[] MeasureNames =
    {
        "ChatAreaGrid", "SidebarHost", "ChatDropArea", "MessagesList",
        "ComposerInput", "MessageSearchPanel", "GroupSettingsPanel",
        "PeerInfoPanel", "HistoryScrollViewer", "MediaViewerOverlay",
        "HeaderMessageSearchButton",
        "DeleteCancelButton", "MentionList", "StickerPanel",
    };

    [Fact]
    public void LiveStand()
    {
        var backend = Environment.GetEnvironmentVariable("HUB_PARITY_BACKEND");
        if (string.IsNullOrWhiteSpace(backend))
        {
            return; // env-gated: в обычном прогоне стенд не участвует
        }

        var cmdDir = Environment.GetEnvironmentVariable("HUB_PARITY_CMD_DIR")
            ?? Path.Combine(Path.GetTempPath(), "hub-parity-cmd");
        var outDir = Environment.GetEnvironmentVariable("HUB_PARITY_OUT")
            ?? Path.Combine(cmdDir, "shots");
        var username = Environment.GetEnvironmentVariable("HUB_PARITY_USER") ?? "e2e_admin";
        var password = Environment.GetEnvironmentVariable("HUB_PARITY_PASS") ?? "e2e-local-admin-pass";
        var theme = Environment.GetEnvironmentVariable("HUB_PARITY_THEME") ?? "dark";
        var route = Environment.GetEnvironmentVariable("HUB_PARITY_ROUTE") ?? "/chat";
        var width = double.TryParse(Environment.GetEnvironmentVariable("HUB_PARITY_W"), out var w) ? w : 1280;
        var height = double.TryParse(Environment.GetEnvironmentVariable("HUB_PARITY_H"), out var h) ? h : 720;
        Directory.CreateDirectory(cmdDir);
        Directory.CreateDirectory(outDir);
        File.WriteAllText(
            Path.Combine(cmdDir, "stand.meta.json"),
            JsonSerializer.Serialize(new { backend, user = username, startedUtc = DateTimeOffset.UtcNow }));

        Exception? captured = null;
        var thread = new Thread(() =>
        {
            try
            {
                Run(backend, username, password, theme, route, width, height, cmdDir, outDir);
            }
            catch (Exception exception)
            {
                captured = exception;
            }
        });
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        Assert.True(thread.Join(TimeSpan.FromMinutes(30)), "Стенд не завершился за 30 минут.");
        Assert.Null(captured);
    }

    private static void Run(
        string backend, string username, string password, string theme, string route,
        double width, double height, string cmdDir, string outDir)
    {
        if (Application.Current is null)
        {
            _ = new Application { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        }

        SynchronizationContext.SetSynchronizationContext(
            new DispatcherSynchronizationContext(Dispatcher.CurrentDispatcher));
        var themeLog = Path.Combine(cmdDir, "stand.theme.log");
        void LogTheme(string tag) => File.AppendAllText(
            themeLog,
            $"{DateTime.Now:HH:mm:ss.fff} {tag} current={NativeThemeManager.CurrentMode} effective={NativeThemeManager.EffectiveMode}\n");
        NativeThemeManager.EffectiveThemeChanged += (_, _) => LogTheme("flip");
        NativeThemeManager.Apply(theme);
        LogTheme("startup");

        var api = new HubApiClient(new Uri(backend), new MemorySessionStore());
        var loginTask = api.LoginAsync(username, password, CancellationToken.None);
        Pump(loginTask);
        if (loginTask.Result.Session is null)
        {
            throw new InvalidOperationException($"Login failed: {loginTask.Result.Status}");
        }

        var window = new Hub.Desktop.Native.Views.HubWindow(api)
        {
            WindowStartupLocation = WindowStartupLocation.Manual,
            Left = 40,
            Top = 40,
            Width = width,
            Height = height,
        };
        Pump(window.ViewModel.InitializeAsync());
        window.NavigateToRoute(route);
        window.Show();
        window.ViewModel.Chat.DraftStore = new Fakes.FakeChatDraftStore();
        window.ViewModel.Chat.VoiceRecorderFactory =
            () => new Fakes.FakeNativeVoiceRecorder { RecordingDuration = TimeSpan.FromSeconds(3) };
        var vm = window.ViewModel;
        PumpUntil(() => vm.IsReady, TimeSpan.FromSeconds(30));
        PumpUntil(() => vm.Chat.Conversations.Count > 0, TimeSpan.FromSeconds(30));
        // Window_Loaded вызывает InitializeAsync повторно (async void) — вторая
        // LoadPagesAsync добегает позже и ApplySettings() подмешивает theme_mode
        // из профиля /settings/me уже ПОСЛЕ нашего Apply. Ждём вторую загрузку
        // настроек (IsLoading true → false), затем фиксируем тему стенда.
        PumpUntil(() => vm.Settings.IsLoading, TimeSpan.FromSeconds(10));
        PumpUntil(() => !vm.Settings.IsLoading, TimeSpan.FromSeconds(30));
        NativeThemeManager.Apply(theme);
        window.UpdateLayout();
        LogTheme("ready");
        File.WriteAllText(Path.Combine(cmdDir, "stand.ready"), DateTimeOffset.UtcNow.ToString("O"));

        var done = Path.Combine(cmdDir, "stand.done");
        var retries = new Dictionary<string, int>(StringComparer.Ordinal);
        var busy = false;
        var standTheme = theme;
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(90) };
        timer.Tick += (_, _) =>
        {
            if (busy)
            {
                return; // Pump/PumpUntil внутри команды крутят вложенный цикл —
            }           // без флага тик исполнил бы ту же команду повторно.
            busy = true;
            try
            {
                if (File.Exists(done))
                {
                    Dispatcher.CurrentDispatcher.InvokeShutdown();
                    return;
                }

                foreach (var file in Directory.GetFiles(cmdDir, "*.cmd.json").OrderBy(f => f, StringComparer.Ordinal))
                {
                    var name = Path.GetFileName(file);
                    JsonDocument doc;
                    try { doc = JsonDocument.Parse(File.ReadAllText(file)); }
                    catch (Exception readError)
                    {
                        // Файл может быть ещё недописан клиентом — пропускаем до
                        // следующего тика; удаляем лишь после ~5 с неудач подряд.
                        var attempts = retries.TryGetValue(file, out var n) ? n : 0;
                        retries[file] = attempts + 1;
                        if (attempts > 50)
                        {
                            File.Delete(file);
                            retries.Remove(file);
                            File.AppendAllText(Path.Combine(cmdDir, "stand.commands.log"),
                                $"{DateTime.Now:HH:mm:ss.fff} DROP {name} unreadable x{attempts} {readError.GetType().Name}: {readError.Message}\n");
                        }
                        else if (attempts == 1)
                        {
                            File.AppendAllText(Path.Combine(cmdDir, "stand.commands.log"),
                                $"{DateTime.Now:HH:mm:ss.fff} RETRY {name} {readError.GetType().Name}: {readError.Message}\n");
                        }
                        continue;
                    }
                    retries.Remove(file);
                    // Замеры/кадры детерминированы: перед ними возвращаем тему
                    // стенда — любой запоздалый ApplySettings не портит съёмку.
                    var opName = doc.RootElement.TryGetProperty("op", out var opEl)
                        ? opEl.GetString() : null;
                    if (opName is "shot" or "measure")
                    {
                        NativeThemeManager.Apply(standTheme);
                    }
                    var result = Execute(window, api, doc.RootElement, outDir);
                    if (opName == "theme" && result.TryGetValue("ok", out var okFlag) && okFlag is true)
                    {
                        standTheme = doc.RootElement.TryGetProperty("value", out var vEl)
                            ? vEl.GetString() ?? standTheme
                            : standTheme;
                    }
                    File.WriteAllText(
                        Path.Combine(cmdDir, name[..^".cmd.json".Length] + ".done.json"),
                        JsonSerializer.Serialize(result));
                    File.AppendAllText(Path.Combine(cmdDir, "stand.commands.log"),
                        $"{DateTime.Now:HH:mm:ss.fff} DONE {name} ok={result["ok"]}\n");
                    File.Delete(file);
                    if (result.TryGetValue("quit", out var q) && q is true)
                    {
                        Dispatcher.CurrentDispatcher.InvokeShutdown();
                        return;
                    }
                }
            }
            catch (Exception exception)
            {
                File.AppendAllText(Path.Combine(cmdDir, "stand.errors.log"), exception + Environment.NewLine);
            }
            finally
            {
                busy = false;
            }
        };
        timer.Start();
        Dispatcher.Run();
        window.Close();
        File.WriteAllText(Path.Combine(cmdDir, "stand.exited"), DateTimeOffset.UtcNow.ToString("O"));
    }

    private static Dictionary<string, object?> Execute(
        Hub.Desktop.Native.Views.HubWindow window,
        HubApiClient api,
        JsonElement cmd,
        string outDir)
    {
        var op = cmd.TryGetProperty("op", out var o) ? o.GetString() : null;
        var vm = window.ViewModel;
        switch (op)
        {
            case "resize":
                window.Width = GetDouble(cmd, "w", window.Width);
                window.Height = GetDouble(cmd, "h", window.Height);
                if (cmd.TryGetProperty("left", out var l)) window.Left = l.GetDouble();
                if (cmd.TryGetProperty("top", out var t)) window.Top = t.GetDouble();
                window.UpdateLayout();
                return Ok(new { window.Width, window.Height });

            case "theme":
                NativeThemeManager.Apply(GetStr(cmd, "value", "dark"));
                window.UpdateLayout();
                return Ok(NativeThemeManager.EffectiveMode);

            case "select":
            {
                object? target = null;
                if (cmd.TryGetProperty("id", out var idEl))
                {
                    var id = idEl.GetString();
                    target = vm.Chat.Conversations.FirstOrDefault(c => c.Id == id);
                }
                else
                {
                    var title = GetStr(cmd, "title", "");
                    target = vm.Chat.Conversations.FirstOrDefault(
                        c => c.Title?.Contains(title, StringComparison.OrdinalIgnoreCase) == true);
                }

                if (target is null)
                {
                    var names = string.Join("|", vm.Chat.Conversations.Select(c => c.Title).Take(20));
                    return Fail($"conversation not found; have: {names}");
                }

                vm.Chat.SelectedConversation = (ConversationItemViewModel)target;
                PumpUntil(() => vm.Chat.Messages.Count > 0 || vm.Chat.IsMessagesEmpty
                    || vm.Chat.HasHistoryError, TimeSpan.FromSeconds(15));
                window.UpdateLayout();
                return Ok(vm.Chat.SelectedConversation?.Title);
            }

            case "folder":
                vm.Chat.ActiveFolderKey = GetStr(cmd, "key", "");
                window.UpdateLayout();
                return Ok(vm.Chat.ActiveFolderKey);

            case "nav":
                window.SetNavigationPaneCollapsed(
                    cmd.TryGetProperty("collapsed", out var c) && c.ValueKind == JsonValueKind.True);
                window.UpdateLayout();
                return Ok("nav");

            case "invoke":
            {
                var target = Resolve(vm, GetStr(cmd, "path", ""));
                if (target is ICommand command)
                {
                    var param = cmd.TryGetProperty("param", out var p) && p.ValueKind == JsonValueKind.String
                        ? p.GetString()
                        : null;
                    if (!command.CanExecute(param))
                    {
                        return Fail("command CanExecute=false");
                    }

                    command.Execute(param);
                    window.UpdateLayout();
                    return Ok("executed");
                }

                return Fail($"not a command: {target?.GetType().Name ?? "null"}");
            }

            case "msg_cmd":
            {
                // Команда над элементом ленты: {"op":"msg_cmd","cmd":"BeginReplyCommand",
                //   "index":-1} | {"own":true} | {"id":"<messageId>"}.
                var messages = vm.Chat.Messages.OfType<ChatMessageViewModel>().ToList();
                ChatMessageViewModel? target = null;
                if (cmd.TryGetProperty("id", out var midEl))
                {
                    var mid = midEl.GetString();
                    target = messages.FirstOrDefault(m => m.Id == mid);
                }
                else if (cmd.TryGetProperty("own", out var ownEl) && ownEl.ValueKind == JsonValueKind.True)
                {
                    target = messages.LastOrDefault(m => m.IsOwn);
                }
                else
                {
                    var index = (int)GetDouble(cmd, "index", -1);
                    var resolved = index < 0 ? messages.Count + index : index;
                    target = resolved >= 0 && resolved < messages.Count ? messages[resolved] : null;
                }

                if (target is null)
                {
                    return Fail($"message not found; count={messages.Count}");
                }

                var cmdName = GetStr(cmd, "cmd", "");
                var cmdProp = vm.Chat.GetType().GetProperty(cmdName);
                if (cmdProp?.GetValue(vm.Chat) is ICommand messageCommand)
                {
                    if (!messageCommand.CanExecute(target))
                    {
                        return Fail($"command {cmdName} CanExecute=false");
                    }

                    messageCommand.Execute(target);
                    window.UpdateLayout();
                    return Ok($"executed {cmdName}");
                }

                return Fail($"command {cmdName} not found on Chat");
            }

            case "key":
            {
                // Реальный ввод через конвейер InputManager: {"op":"key","key":"Tab",
                //   "mods":"ctrl"} — модификаторы жмутся как настоящие KeyDown/KeyUp.
                var keyName = GetStr(cmd, "key", "Tab");
                var key = (Key)Enum.Parse(typeof(Key), keyName);
                var mods = GetStr(cmd, "mods", "").Split(
                    ',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var modKeys = new List<Key>();
                foreach (var m in mods)
                {
                    modKeys.Add(m.Equals("ctrl", StringComparison.OrdinalIgnoreCase) ? Key.LeftCtrl
                        : m.Equals("shift", StringComparison.OrdinalIgnoreCase) ? Key.LeftShift
                        : m.Equals("alt", StringComparison.OrdinalIgnoreCase) ? Key.LeftAlt
                        : (Key)Enum.Parse(typeof(Key), m));
                }

                var source = PresentationSource.FromVisual(window)
                    ?? throw new InvalidOperationException("no presentation source");
                void SendKey(Key k, RoutedEvent routed)
                {
                    var args = new KeyEventArgs(Keyboard.PrimaryDevice, source, 0, k)
                    {
                        RoutedEvent = routed,
                    };
                    _ = InputManager.Current.ProcessInput(args);
                }

                foreach (var m in modKeys) SendKey(m, Keyboard.KeyDownEvent);
                SendKey(key, Keyboard.KeyDownEvent);
                SendKey(key, Keyboard.KeyUpEvent);
                foreach (var m in modKeys) SendKey(m, Keyboard.KeyUpEvent);
                window.UpdateLayout();
                return Ok($"key {keyName}");
            }

            case "key_os":
            {
                // Настоящий ввод ОС через keybd_event: Keyboard.Modifiers видит
                // модификаторы (нужно для Ctrl+F и прочих сочетаний). Требует,
                // чтобы окно стенда было foreground — проверяем GetForegroundWindow.
                var keyName = GetStr(cmd, "key", "F");
                var key = (Key)Enum.Parse(typeof(Key), keyName);
                var mods = GetStr(cmd, "mods", "").Split(
                    ',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                var modKeys = mods.Select(m =>
                        m.Equals("ctrl", StringComparison.OrdinalIgnoreCase) ? Key.LeftCtrl
                        : m.Equals("shift", StringComparison.OrdinalIgnoreCase) ? Key.LeftShift
                        : m.Equals("alt", StringComparison.OrdinalIgnoreCase) ? Key.LeftAlt
                        : (Key)Enum.Parse(typeof(Key), m))
                    .ToList();
                var hwnd = new System.Windows.Interop.WindowInteropHelper(window).Handle;
                // Foreground-lock: право на SetForegroundWindow получает процесс,
                // который последним генерировал ввод. Тапаем безобидный Ctrl.
                keybd_event(0x11, 0, 0, UIntPtr.Zero);
                keybd_event(0x11, 0, KeyeventfKeyup, UIntPtr.Zero);
                Thread.Sleep(50);
                _ = SetForegroundWindow(hwnd);
                PumpUntil(() => false, TimeSpan.FromMilliseconds(250));
                if (GetForegroundWindow() != hwnd)
                {
                    _ = SetForegroundWindow(hwnd);
                    PumpUntil(() => false, TimeSpan.FromMilliseconds(250));
                }

                if (GetForegroundWindow() != hwnd)
                {
                    return Fail("window is not foreground; OS input would go elsewhere");
                }

                byte Vk(Key k) => (byte)KeyInterop.VirtualKeyFromKey(k);
                foreach (var m in modKeys)
                {
                    keybd_event(Vk(m), 0, 0, UIntPtr.Zero);
                    Thread.Sleep(15);
                }

                keybd_event(Vk(key), 0, 0, UIntPtr.Zero);
                Thread.Sleep(15);
                keybd_event(Vk(key), 0, KeyeventfKeyup, UIntPtr.Zero);
                foreach (var m in modKeys)
                {
                    keybd_event(Vk(m), 0, KeyeventfKeyup, UIntPtr.Zero);
                    Thread.Sleep(15);
                }

                PumpUntil(() => false, TimeSpan.FromMilliseconds(150));
                window.UpdateLayout();
                return Ok($"key_os {keyName}; focused={Keyboard.FocusedElement?.GetType().Name}");
            }

            case "focus_el":
            {
                // Поставить фокус на элемент: {"op":"focus_el","name":"ComposerInput"}
                // — по x:Name, фолбэк на AutomationProperties.Name.
                var elName = GetStr(cmd, "name", "");
                var el = (FindNamed(window, elName) ?? FindByAutomationName(window, elName))
                    as UIElement;
                if (el is null)
                {
                    return Fail($"element not found: {elName}");
                }

                _ = el.Focus();
                window.UpdateLayout();
                return Ok($"focused {elName}: {Keyboard.FocusedElement?.GetType().Name}");
            }

            case "focus":
            {
                var focused = Keyboard.FocusedElement;
                var scope = FocusManager.GetFocusedElement(window);
                string Describe(object? element)
                {
                    if (element is not FrameworkElement fe)
                    {
                        return element?.GetType().Name ?? "null";
                    }

                    var automationName = System.Windows.Automation
                        .AutomationProperties.GetName(fe);
                    var content = fe is System.Windows.Controls.ContentControl cc
                        ? cc.Content?.ToString()
                        : null;
                    DependencyObject walker = fe;
                    string? ancestor = null;
                    while (walker is not null && string.IsNullOrEmpty(ancestor))
                    {
                        walker = walker is Visual or System.Windows.Media.Media3D.Visual3D
                            ? VisualTreeHelper.GetParent(walker)
                            : LogicalTreeHelper.GetParent(walker);
                        if (walker is FrameworkElement parent && !string.IsNullOrEmpty(parent.Name))
                        {
                            ancestor = $"{parent.GetType().Name}:{parent.Name}";
                        }
                    }

                    return $"{fe.GetType().Name}:{fe.Name} auto=\"{automationName}\" content=\"{content}\" under={ancestor}";
                }

                return Ok(new
                {
                    keyboard = Describe(focused),
                    scope = Describe(scope),
                    keyboardModifiers = Keyboard.Modifiers.ToString(),
                });
            }

            case "set":
            {
                SetProp(vm, GetStr(cmd, "path", ""), cmd.GetProperty("value"));
                window.UpdateLayout();
                return Ok("set");
            }

            case "get":
            {
                var target = Resolve(vm, GetStr(cmd, "path", ""));
                return Ok(target?.ToString());
            }

            case "send_text":
                vm.Chat.ComposerText = GetStr(cmd, "text", "");
                vm.Chat.SendCommand.Execute(null);
                PumpUntil(() => string.IsNullOrEmpty(vm.Chat.ComposerText)
                    || !vm.Chat.IsSending, TimeSpan.FromSeconds(15));
                window.UpdateLayout();
                return Ok("sent");

            case "shot":
            {
                var name = GetStr(cmd, "name", "shot.png");
                window.UpdateLayout();
                Dispatcher.CurrentDispatcher.Invoke(
                    DispatcherPriority.Render, new Action(() => { }));
                SaveWindowPng(window, Path.Combine(outDir, name));
                return Ok(name);
            }

            case "measure":
            {
                var name = GetStr(cmd, "name", "measure.json");
                var names = cmd.TryGetProperty("names", out var ns) && ns.ValueKind == JsonValueKind.Array
                    ? ns.EnumerateArray().Select(e => e.GetString() ?? "").ToArray()
                    : MeasureNames;
                var dump = Measure(window, names);
                File.WriteAllText(Path.Combine(outDir, name), JsonSerializer.Serialize(dump, new JsonSerializerOptions { WriteIndented = true }));
                return Ok(name);
            }

            case "wait":
                PumpUntil(() => false, TimeSpan.FromMilliseconds(GetDouble(cmd, "ms", 200)));
                return Ok("waited");

            case "wait_until":
            {
                var path = GetStr(cmd, "path", "");
                var timeout = TimeSpan.FromMilliseconds(GetDouble(cmd, "ms", 10000));
                var deadline = DateTime.UtcNow + timeout;
                object? value = null;
                while (DateTime.UtcNow < deadline)
                {
                    value = Resolve(vm, path);
                    var truthy = value is bool b ? b : value is not null;
                    if (truthy) return Ok(value?.ToString());
                    PumpUntil(() => false, TimeSpan.FromMilliseconds(60));
                }

                return Fail($"timeout waiting {path}; last={value}");
            }

            case "quit":
                return OkQuit();

            default:
                return Fail($"unknown op {op}");
        }
    }

    private static Dictionary<string, object?> Ok(object? result) =>
        new() { ["ok"] = true, ["result"] = result };

    private static Dictionary<string, object?> OkQuit() =>
        new() { ["ok"] = true, ["quit"] = true };

    private static Dictionary<string, object?> Fail(string error) =>
        new() { ["ok"] = false, ["error"] = error };

    private static string GetStr(JsonElement cmd, string name, string fallback) =>
        cmd.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? fallback
            : fallback;

    private static double GetDouble(JsonElement cmd, string name, double fallback) =>
        cmd.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number
            ? v.GetDouble()
            : fallback;

    private static object? Resolve(object root, string path)
    {
        object? current = root;
        foreach (var part in path.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            if (current is null) return null;
            var prop = current.GetType().GetProperty(part,
                System.Reflection.BindingFlags.Public
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Instance);
            if (prop is null) return null;
            current = prop.GetValue(current);
        }

        return current;
    }

    private static void SetProp(object root, string path, JsonElement value)
    {
        var segments = path.Split('.', StringSplitOptions.RemoveEmptyEntries);
        object? current = root;
        for (var i = 0; i < segments.Length - 1; i++)
        {
            current = current?.GetType().GetProperty(segments[i],
                System.Reflection.BindingFlags.Public
                | System.Reflection.BindingFlags.NonPublic
                | System.Reflection.BindingFlags.Instance)?.GetValue(current);
        }

        if (current is null) throw new InvalidOperationException($"path root not found: {path}");
        var prop = current.GetType().GetProperty(segments[^1],
            System.Reflection.BindingFlags.Public
            | System.Reflection.BindingFlags.NonPublic
            | System.Reflection.BindingFlags.Instance)
            ?? throw new InvalidOperationException($"prop not found: {path}");
        object? typed = value.ValueKind switch
        {
            JsonValueKind.String => Convert.ChangeType(value.GetString(), Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType),
            JsonValueKind.Number => Convert.ChangeType(value.GetDouble(), Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => value.GetRawText(),
        };
        prop.SetValue(current, typed);
    }

    private static Dictionary<string, object?> Measure(Window window, string[] names)
    {
        var result = new Dictionary<string, object?>
        {
            ["window"] = new
            {
                Width = window.ActualWidth,
                Height = window.ActualHeight,
                Dpi = VisualTreeHelper.GetDpi(window).PixelsPerInchX,
            },
        };
        var found = new Dictionary<string, object?>();
        foreach (var name in names)
        {
            var el = FindNamed(window, name);
            if (el is null) continue;
            var topLeft = el.TransformToAncestor(window).Transform(new Point(0, 0));
            found[name] = new
            {
                X = Math.Round(topLeft.X, 1),
                Y = Math.Round(topLeft.Y, 1),
                W = Math.Round(el.RenderSize.Width, 1),
                H = Math.Round(el.RenderSize.Height, 1),
                Visible = el.IsVisible,
            };
        }

        result["elements"] = found;
        var chatVm = window is Hub.Desktop.Native.Views.HubWindow hub ? hub.ViewModel.Chat : null;
        result["vm"] = chatVm is null ? null : new
        {
            chatVm.SelectedConversation?.Title,
            Messages = chatVm.Messages.Count,
            Conversations = chatVm.Conversations.Count,
            chatVm.ComposerText,
        };
        return result;
    }

    private static FrameworkElement? FindNamed(DependencyObject root, string name)
    {
        if (root is FrameworkElement fe && fe.Name == name) return fe;
        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
        {
            var child = FindNamed(VisualTreeHelper.GetChild(root, i), name);
            if (child is not null) return child;
        }

        return null;
    }

    private static FrameworkElement? FindByAutomationName(DependencyObject root, string name)
    {
        if (root is FrameworkElement fe
            && System.Windows.Automation.AutomationProperties.GetName(fe) == name)
        {
            return fe;
        }

        var count = VisualTreeHelper.GetChildrenCount(root);
        for (var i = 0; i < count; i++)
        {
            if (FindByAutomationName(VisualTreeHelper.GetChild(root, i), name) is { } found)
            {
                return found;
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
            var frame = new DispatcherFrame();
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(30) };
            timer.Tick += (_, _) => frame.Continue = false;
            timer.Start();
            Dispatcher.PushFrame(frame);
            timer.Stop();
        }
    }

    private const uint KeyeventfKeyup = 0x0002;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(nint hWnd);

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    private static extern nint GetForegroundWindow();

    /// <summary>Кадр ровно по клиентскому размеру окна — паритет с веб-вьюпортом.</summary>
    private static void SaveWindowPng(Window window, string path)
    {
        var bitmap = new RenderTargetBitmap(
            Math.Max(1, (int)Math.Ceiling(window.ActualWidth)),
            Math.Max(1, (int)Math.Ceiling(window.ActualHeight)),
            96, 96, PixelFormats.Pbgra32);
        bitmap.Render(window);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(path);
        encoder.Save(stream);
    }

    private static void SavePng(Visual visual, string path)
    {
        var bounds = VisualTreeHelper.GetDescendantBounds(visual);
        var bitmap = new RenderTargetBitmap(
            Math.Max(1, (int)Math.Ceiling(bounds.Width)),
            Math.Max(1, (int)Math.Ceiling(bounds.Height)),
            96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var stream = File.Create(path);
        encoder.Save(stream);
    }

    private sealed class MemorySessionStore : INativeSessionStore
    {
        private NativeSession? _session;
        private string? _deviceId;
        public Task<NativeSession?> LoadAsync(CancellationToken cancellationToken) =>
            Task.FromResult(_session);
        public Task SaveAsync(NativeSession session, CancellationToken cancellationToken)
        {
            _session = session;
            return Task.CompletedTask;
        }

        public Task ClearAsync(CancellationToken cancellationToken)
        {
            _session = null;
            return Task.CompletedTask;
        }

        public Task<string> GetOrCreateClientDeviceIdAsync(CancellationToken cancellationToken)
        {
            _deviceId ??= $"parity-stand-{Guid.NewGuid():N}";
            return Task.FromResult(_deviceId);
        }
    }
}
