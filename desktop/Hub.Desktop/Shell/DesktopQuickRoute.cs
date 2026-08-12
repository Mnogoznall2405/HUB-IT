namespace Hub.Desktop.Shell;

public sealed record DesktopQuickRoute(
    string Id,
    string Label,
    string Route,
    int Badge)
{
    public string MenuText => Badge > 0 ? $"{Label} — {Badge}" : Label;

    public string AccessibleName => Badge > 0
        ? $"Открыть {Label}, новых: {Badge}"
        : $"Открыть {Label}";
}
