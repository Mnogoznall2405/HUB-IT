using System.Text.Json;
using Hub.Desktop.Downloads;
using Hub.Desktop.Interop;
using Hub.Desktop.Printing;
using Hub.Desktop.Shell;
using Xunit;

namespace Hub.Desktop.Tests;

public sealed class DesktopBridgeProtocolTests
{
    [Fact]
    public void AcceptsExactReadyMessageForCurrentVersion()
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            """{"type":"desktop.ready","version":1}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.Ready, message.Type);
        Assert.Null(message.Notification);
    }

    [Fact]
    public void AcceptsExactNotificationMessageForCurrentVersion()
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            """{"type":"notification.show","version":1,"id":"chat:msg:42","title":"Иван","body":"Новое сообщение","route":"/chat?conversation=7&message=42"}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.ShowNotification, message.Type);
        Assert.Equal(
            new DesktopNotificationRequest(
                "chat:msg:42",
                "Иван",
                "Новое сообщение",
                "/chat?conversation=7&message=42"),
            message.Notification);
    }

    [Fact]
    public void AcceptsExactOpenDownloadedFileMessage()
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            """{"type":"file.openDownloaded","version":1}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.OpenDownloadedFile, message.Type);
    }

    [Theory]
    [InlineData("open", DesktopDownloadedFileAction.Open)]
    [InlineData("print", DesktopDownloadedFileAction.Print)]
    [InlineData("copy", DesktopDownloadedFileAction.Copy)]
    [InlineData("saveAs", DesktopDownloadedFileAction.SaveAs)]
    public void AcceptsStrictPreparedDownloadActions(
        string action,
        DesktopDownloadedFileAction expected)
    {
        var json = JsonSerializer.Serialize(new
        {
            type = "file.prepareDownload",
            version = 1,
            action,
        });

        Assert.True(DesktopBridgeProtocol.TryParseInbound(json, out var message));
        Assert.Equal(DesktopInboundMessageType.PrepareDownloadedFile, message.Type);
        Assert.Equal(expected, message.DownloadedFileAction);
    }

    [Fact]
    public void AcceptsExactShellStatusMessage()
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            """{"type":"shell.status","version":1,"authenticated":true,"online":true,"unread_total":7,"chat_unread":4,"mail_unread":2,"tasks_attention":1}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.UpdateShellStatus, message.Type);
        Assert.Equal(
            new DesktopShellStatus(
                Authenticated: true,
                Online: true,
                UnreadTotal: 7,
                ChatUnread: 4,
                MailUnread: 2,
                TasksAttention: 1),
            message.ShellStatus);
    }

    [Fact]
    public void AcceptsExactQuickRoutesMessage()
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            """{"type":"shell.quickRoutes","version":1,"routes":[{"id":"tasks","label":"Задачи","route":"/tasks","badge":3},{"id":"mail","label":"Почта","route":"/mail","badge":2}]}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.UpdateQuickRoutes, message.Type);
        Assert.Equal(
            new[]
            {
                new DesktopQuickRoute("tasks", "Задачи", "/tasks", 3),
                new DesktopQuickRoute("mail", "Почта", "/mail", 2),
            },
            message.QuickRoutes);
    }

    [Theory]
    [InlineData("light", DesktopThemeMode.Light)]
    [InlineData("dark", DesktopThemeMode.Dark)]
    public void AcceptsExactThemeMessage(string mode, DesktopThemeMode expected)
    {
        var parsed = DesktopBridgeProtocol.TryParseInbound(
            $$"""{"type":"appearance.theme","version":1,"mode":"{{mode}}"}""",
            out var message);

        Assert.True(parsed);
        Assert.Equal(DesktopInboundMessageType.SetTheme, message.Type);
        Assert.Equal(expected, message.ThemeMode);
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"type\":\"desktop.ready\",\"version\":2}")]
    [InlineData("{\"type\":\"desktop.unknown\",\"version\":1}")]
    [InlineData("{\"type\":\"desktop.ready\",\"version\":1,\"command\":\"open\"}")]
    [InlineData("{\"type\":\"appearance.theme\",\"version\":1,\"mode\":\"system\"}")]
    [InlineData("{\"type\":\"appearance.theme\",\"version\":1,\"mode\":\"dark\",\"command\":\"open\"}")]
    [InlineData("{\"type\":\"file.openDownloaded\",\"version\":1,\"path\":\"C:\\\\Windows\\\\System32\\\\cmd.exe\"}")]
    [InlineData("{\"type\":\"file.prepareDownload\",\"version\":1,\"action\":\"execute\"}")]
    [InlineData("{\"type\":\"file.prepareDownload\",\"version\":1,\"action\":\"open\",\"path\":\"C:\\\\Windows\\\\System32\\\\cmd.exe\"}")]
    [InlineData("{\"type\":\"shell.status\",\"version\":1,\"authenticated\":true,\"online\":true,\"unread_total\":-1,\"chat_unread\":0,\"mail_unread\":0,\"tasks_attention\":0}")]
    [InlineData("{\"type\":\"shell.status\",\"version\":1,\"authenticated\":true,\"online\":true,\"unread_total\":10000,\"chat_unread\":0,\"mail_unread\":0,\"tasks_attention\":0}")]
    [InlineData("{\"type\":\"shell.status\",\"version\":1,\"authenticated\":true,\"online\":true,\"unread_total\":1.5,\"chat_unread\":0,\"mail_unread\":0,\"tasks_attention\":0}")]
    [InlineData("{\"type\":\"shell.status\",\"version\":1,\"authenticated\":true,\"online\":true,\"unread_total\":1,\"chat_unread\":0,\"mail_unread\":0,\"tasks_attention\":0,\"command\":\"open\"}")]
    [InlineData("{\"type\":\"shell.quickRoutes\",\"version\":1,\"routes\":[{\"id\":\"bad id\",\"label\":\"Bad\",\"route\":\"/tasks\",\"badge\":0}]}")]
    [InlineData("{\"type\":\"shell.quickRoutes\",\"version\":1,\"routes\":[{\"id\":\"tasks\",\"label\":\"Tasks\",\"route\":\"https://evil.example\",\"badge\":0}]}")]
    [InlineData("{\"type\":\"shell.quickRoutes\",\"version\":1,\"routes\":[{\"id\":\"tasks\",\"label\":\"Tasks\",\"route\":\"/tasks\",\"badge\":-1}]}")]
    [InlineData("{\"type\":\"shell.quickRoutes\",\"version\":1,\"routes\":[{\"id\":\"tasks\",\"label\":\"Tasks\",\"route\":\"/tasks\",\"badge\":0},{\"id\":\"tasks\",\"label\":\"Duplicate\",\"route\":\"/mail\",\"badge\":0}]}")]
    [InlineData("{\"type\":\"notification.show\",\"version\":1,\"id\":\"chat:1\",\"title\":\"Title\",\"body\":\"Body\",\"route\":\"https://evil.example/chat\"}")]
    [InlineData("{\"type\":\"notification.show\",\"version\":1,\"id\":\"chat 1\",\"title\":\"Title\",\"body\":\"Body\",\"route\":\"/chat\"}")]
    [InlineData("{\"type\":\"notification.show\",\"version\":1,\"id\":\"chat:1\",\"title\":\"Title\",\"body\":\"\",\"route\":\"/chat\"}")]
    [InlineData("{\"type\":\"notification.show\",\"version\":1,\"id\":\"chat:1\",\"title\":\"Title\",\"body\":\"Body\",\"route\":\"/chat\",\"command\":\"open\"}")]
    [InlineData("{\"type\":\"desktop.ready\",\"version\":1")]
    public void RejectsInvalidOrUnknownMessages(string json)
    {
        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Fact]
    public void RejectsOversizedMessages()
    {
        var json = new string('x', DesktopBridgeProtocol.MaximumInboundMessageLength + 1);

        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Fact]
    public void CreatesMinimalHostReadyMessage()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateHostReadyMessage(true, "ivanov"));
        var root = document.RootElement;

        Assert.Equal("desktop.hostReady", root.GetProperty("type").GetString());
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
        Assert.True(root.GetProperty("capabilities").GetProperty("notifications").GetBoolean());
        Assert.Equal("ivanov", root.GetProperty("windowsUsername").GetString());
        Assert.Equal(4, root.EnumerateObject().Count());
        Assert.Single(root.GetProperty("capabilities").EnumerateObject());
    }

    [Fact]
    public void OmitsInvalidWindowsUsernameValue()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateHostReadyMessage(
                true,
                new string('x', DesktopBridgeProtocol.MaximumWindowsUsernameLength + 1)));

        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("windowsUsername").ValueKind);
    }

    [Fact]
    public void CreatesSeparateStrictCapabilitiesMessage()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateCapabilitiesMessage());
        var root = document.RootElement;

        Assert.Equal("desktop.capabilities", root.GetProperty("type").GetString());
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
        Assert.Equal(
            new[]
            {
                "command-palette",
                "desktop-actions",
                "equipment-qr-print",
                "file-actions-v2",
                "mail-compose-window",
                "print",
                "quick-routes",
                "shell-status",
                "vnc-preflight",
            },
            root.GetProperty("capabilities")
                .EnumerateArray()
                .Select(item => item.GetString()!)
                .ToArray());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Fact]
    public void ParsesOnlyStrictMailComposeWindowRoutes()
    {
        const string json = """{"type":"mail.composeWindow.open","version":1,"requestId":"req-1","route":"/mail/compose?draft_id=draft-1&mailbox_id=mb-1"}""";

        Assert.True(DesktopBridgeProtocol.TryParseInbound(json, out var message));
        Assert.Equal(DesktopInboundMessageType.OpenMailComposeWindow, message.Type);
        Assert.Equal("req-1", message.MailComposeWindow?.RequestId);
        Assert.Equal("/mail/compose?draft_id=draft-1&mailbox_id=mb-1", message.MailComposeWindow?.Route);

        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"mail.composeWindow.open","version":1,"requestId":"req-2","route":"/mail?draft_id=draft-1"}""",
            out _));
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"mail.composeWindow.open","version":1,"requestId":"req-3","route":"/mail/compose?draft_id=draft-1&extra=x"}""",
            out _));
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"mail.composeWindow.open","version":1,"requestId":"req-4","route":"/mail/compose?draft_id=draft-1#unsafe"}""",
            out _));
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"mail.composeWindow.open","version":1,"requestId":"req-5","route":"/mail/compose?draft_id=draft%0A1"}""",
            out _));
    }

    [Fact]
    public void ParsesComposeCloseResultAndCreatesHostMessages()
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"mail.composeWindow.closeResult","version":1,"requestId":"close-1","status":"saved"}""",
            out var message));
        Assert.Equal(DesktopInboundMessageType.MailComposeWindowCloseResult, message.Type);
        Assert.Equal("saved", message.MailComposeWindow?.Status);

        using var result = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateMailComposeWindowResultMessage("req-1", "opened"));
        Assert.Equal("opened", result.RootElement.GetProperty("status").GetString());

        using var close = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateMailComposeWindowCloseRequestedMessage("close-1"));
        Assert.Equal("mail.composeWindow.closeRequested", close.RootElement.GetProperty("type").GetString());
    }

    [Fact]
    public void ParsesExactPrintCurrentDocumentCommand()
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"document.printCurrent","version":1}""",
            out var message));
        Assert.Equal(DesktopInboundMessageType.PrintCurrentDocument, message.Type);
    }

    [Theory]
    [InlineData("{\"type\":\"document.printCurrent\",\"version\":1,\"html\":\"<p>x</p>\"}")]
    [InlineData("{\"type\":\"document.printCurrent\",\"version\":2}")]
    public void RejectsExpandedOrUnsupportedPrintCommands(string json)
    {
        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Fact]
    public void ParsesStrictEquipmentQrPrintAndCreatesResult()
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"equipmentQr.print","version":1,"requestId":"qr-1","mode":"quick"}""",
            out var message));
        Assert.Equal(DesktopInboundMessageType.PrintEquipmentQrBatch, message.Type);
        Assert.Equal("qr-1", message.EquipmentQrPrint?.RequestId);
        Assert.Equal(DesktopEquipmentQrPrintMode.Quick, message.EquipmentQrPrint?.Mode);

        using var result = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateEquipmentQrPrintResultMessage(
                "qr-1",
                DesktopEquipmentQrPrintStatus.Succeeded));
        Assert.Equal("equipmentQr.printResult", result.RootElement.GetProperty("type").GetString());
        Assert.Equal("succeeded", result.RootElement.GetProperty("status").GetString());
        Assert.Equal(4, result.RootElement.EnumerateObject().Count());
    }

    [Theory]
    [InlineData("{\"type\":\"equipmentQr.print\",\"version\":1,\"requestId\":\"qr-1\",\"mode\":\"silent\"}")]
    [InlineData("{\"type\":\"equipmentQr.print\",\"version\":1,\"requestId\":\"bad id\",\"mode\":\"quick\"}")]
    [InlineData("{\"type\":\"equipmentQr.print\",\"version\":1,\"requestId\":\"qr-1\",\"mode\":\"dialog\",\"printer\":\"unsafe\"}")]
    public void RejectsMalformedEquipmentQrPrintCommands(string json)
    {
        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Theory]
    [InlineData("desktop.openDownloads", DesktopInboundMessageType.OpenDownloads)]
    [InlineData("desktop.openDiagnostics", DesktopInboundMessageType.OpenDiagnostics)]
    [InlineData("desktop.checkForUpdates", DesktopInboundMessageType.CheckForUpdates)]
    [InlineData("desktop.openCurrentInBrowser", DesktopInboundMessageType.OpenCurrentInBrowser)]
    public void ParsesOnlyExactDesktopCommands(
        string type,
        DesktopInboundMessageType expectedType)
    {
        var json = JsonSerializer.Serialize(new { type, version = 1 });

        Assert.True(DesktopBridgeProtocol.TryParseInbound(json, out var message));
        Assert.Equal(expectedType, message.Type);
    }

    [Fact]
    public void CreatesExactOpenCommandPaletteMessage()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateOpenCommandPaletteMessage());
        var root = document.RootElement;

        Assert.Equal("command.openPalette", root.GetProperty("type").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal(2, root.EnumerateObject().Count());
    }

    [Fact]
    public void ParsesOnlyTheParameterlessVncPreflightCommand()
    {
        Assert.True(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"remote.vncPreflight","version":1}""",
            out var message));
        Assert.Equal(DesktopInboundMessageType.VncPreflight, message.Type);
        Assert.False(DesktopBridgeProtocol.TryParseInbound(
            """{"type":"remote.vncPreflight","version":1,"uri":"vnc://host?token=secret"}""",
            out _));
    }

    [Theory]
    [InlineData(true, "available")]
    [InlineData(false, "missing")]
    public void CreatesStrictVncPreflightResult(bool available, string expectedStatus)
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateVncPreflightResultMessage(available));
        var root = document.RootElement;

        Assert.Equal("remote.vncPreflightResult", root.GetProperty("type").GetString());
        Assert.Equal(1, root.GetProperty("version").GetInt32());
        Assert.Equal(expectedStatus, root.GetProperty("status").GetString());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Fact]
    public void CreatesStrictOpenNavigationMessage()
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateOpenNavigationMessage("/chat?conversation=7&message=42"));
        var root = document.RootElement;

        Assert.Equal("navigation.open", root.GetProperty("type").GetString());
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
        Assert.Equal("/chat?conversation=7&message=42", root.GetProperty("route").GetString());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void CreatesStrictWindowStateMessage(bool foreground)
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateWindowStateMessage(foreground));
        var root = document.RootElement;

        Assert.Equal("desktop.windowState", root.GetProperty("type").GetString());
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
        Assert.Equal(foreground, root.GetProperty("foreground").GetBoolean());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Theory]
    [InlineData(true, "accepted")]
    [InlineData(false, "busy")]
    public void CreatesStrictOpenDownloadedFileResultMessage(bool accepted, string expectedStatus)
    {
        using var document = JsonDocument.Parse(
            DesktopBridgeProtocol.CreateOpenDownloadedFileResultMessage(accepted));
        var root = document.RootElement;

        Assert.Equal("file.openDownloadedResult", root.GetProperty("type").GetString());
        Assert.Equal(DesktopBridgeProtocol.CurrentVersion, root.GetProperty("version").GetInt32());
        Assert.Equal(expectedStatus, root.GetProperty("status").GetString());
        Assert.Equal(3, root.EnumerateObject().Count());
    }

    [Fact]
    public void RejectsUnsafeOpenNavigationRoute()
    {
        Assert.Throws<ArgumentException>(() =>
            DesktopBridgeProtocol.CreateOpenNavigationMessage("https://evil.example/chat"));
    }

    [Fact]
    public void RejectsNotificationFieldsOverTheirLimits()
    {
        var oversizedTitle = new string('x', DesktopBridgeProtocol.MaximumNotificationTitleLength + 1);
        var json = JsonSerializer.Serialize(new
        {
            type = "notification.show",
            version = DesktopBridgeProtocol.CurrentVersion,
            id = "chat:1",
            title = oversizedTitle,
            body = "Body",
            route = "/chat",
        });

        Assert.False(DesktopBridgeProtocol.TryParseInbound(json, out _));
    }

    [Theory]
    [InlineData("/chat")]
    [InlineData("/chat?conversation=7&message=42")]
    public void AcceptsSafeInternalActivationRoutes(string route)
    {
        Assert.True(DesktopBridgeProtocol.IsValidInternalRoute(route));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("//evil.example/chat")]
    [InlineData("https://evil.example/chat")]
    [InlineData("/chat\\escape")]
    public void RejectsUnsafeActivationRoutes(string? route)
    {
        Assert.False(DesktopBridgeProtocol.IsValidInternalRoute(route));
    }
}
