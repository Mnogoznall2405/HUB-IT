using System.Drawing;
using Hub.Desktop.Configuration;

namespace Hub.Desktop.Workspace;

public static class DesktopWindowPlacementPolicy
{
    public const int MinimumWidth = 640;
    public const int MinimumHeight = 480;
    private const int MinimumVisibleWidth = 120;
    private const int MinimumVisibleHeight = 34;

    public static DesktopWindowPlacement Normalize(
        DesktopWindowPlacement? placement,
        IReadOnlyList<Rectangle> workAreas,
        Rectangle primaryWorkArea)
    {
        if (workAreas.Count == 0)
        {
            workAreas = [primaryWorkArea];
        }

        var desiredWidth = Math.Clamp(
            placement?.Width ?? 1360,
            Math.Min(MinimumWidth, primaryWorkArea.Width),
            Math.Max(1, primaryWorkArea.Width));
        var desiredHeight = Math.Clamp(
            placement?.Height ?? 860,
            Math.Min(MinimumHeight, primaryWorkArea.Height),
            Math.Max(1, primaryWorkArea.Height));

        var requested = placement is null
            ? Rectangle.Empty
            : new Rectangle(placement.X, placement.Y, placement.Width, placement.Height);
        var targetArea = workAreas
            .Select(area => new
            {
                Area = area,
                Intersection = Rectangle.Intersect(area, requested),
            })
            .Where(item =>
                item.Intersection.Width >= MinimumVisibleWidth
                && item.Intersection.Height >= MinimumVisibleHeight)
            .OrderByDescending(item => item.Intersection.Width * item.Intersection.Height)
            .Select(item => (Rectangle?)item.Area)
            .FirstOrDefault();

        var area = targetArea ?? primaryWorkArea;
        var width = Math.Min(desiredWidth, Math.Max(1, area.Width));
        var height = Math.Min(desiredHeight, Math.Max(1, area.Height));
        var x = targetArea is null
            ? area.Left + Math.Max(0, (area.Width - width) / 2)
            : Math.Clamp(placement!.X, area.Left, Math.Max(area.Left, area.Right - width));
        var y = targetArea is null
            ? area.Top + Math.Max(0, (area.Height - height) / 2)
            : Math.Clamp(placement!.Y, area.Top, Math.Max(area.Top, area.Bottom - height));

        return new DesktopWindowPlacement(
            x,
            y,
            width,
            height,
            placement?.Maximized == true);
    }
}
