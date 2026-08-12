namespace Hub.Desktop.Shell;

public sealed record DesktopShellStatus(
    bool Authenticated,
    bool Online,
    int UnreadTotal,
    int ChatUnread,
    int MailUnread,
    int TasksAttention)
{
    public const int MaximumCounter = 9999;

    public static DesktopShellStatus Empty { get; } = new(
        Authenticated: false,
        Online: false,
        UnreadTotal: 0,
        ChatUnread: 0,
        MailUnread: 0,
        TasksAttention: 0);

    public string TaskbarBadgeText => Authenticated && UnreadTotal > 0
        ? UnreadTotal > 99 ? "99+" : UnreadTotal.ToString()
        : string.Empty;

    public string TrayToolTip
    {
        get
        {
            if (!Authenticated)
            {
                return "HUB Desktop";
            }

            if (!Online)
            {
                return UnreadTotal > 0
                    ? $"HUB Desktop — нет сети, {UnreadTotal} новых"
                    : "HUB Desktop — нет сети";
            }

            return UnreadTotal > 0
                ? $"HUB Desktop — {UnreadTotal} новых"
                : "HUB Desktop";
        }
    }

    public bool ShouldShowTaskbarBadge(bool windowForeground) =>
        Authenticated && UnreadTotal > 0 && !windowForeground;
}
