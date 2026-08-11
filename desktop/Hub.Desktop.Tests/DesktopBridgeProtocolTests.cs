using System.Text.Json;
using Hub.Desktop.Interop;
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
