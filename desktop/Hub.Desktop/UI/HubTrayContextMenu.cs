using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;
using Hub.Desktop.Interop;

namespace Hub.Desktop.UI;

internal sealed record HubTrayPalette(
    Color Surface,
    Color Foreground,
    Color Border,
    Color Hover,
    Color Accent,
    Color Destructive);

internal sealed class HubTrayContextMenu : ContextMenuStrip
{
    private const int CornerRadius = 8;
    private readonly HashSet<ToolStripItem> _destructiveItems = [];
    private DesktopThemeMode _themeMode = DesktopThemeMode.Dark;
    private HubTrayPalette _palette = CreatePalette(DesktopThemeMode.Dark);

    public HubTrayContextMenu()
    {
        AutoSize = true;
        Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
        ImageScalingSize = new Size(18, 18);
        MinimumSize = new Size(224, 0);
        Padding = new Padding(4);
        ShowCheckMargin = false;
        ShowImageMargin = true;
        ApplyTheme(DesktopThemeMode.Dark);
    }

    internal DesktopThemeMode ThemeMode => _themeMode;

    internal HubTrayPalette Palette => _palette;

    internal static Font CreateEmphasizedFont() =>
        new("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);

    internal static ToolStripSeparator CreateSeparator() => new()
    {
        Margin = new Padding(32, 2, 6, 2),
    };

    internal void RegisterDestructiveItem(ToolStripItem item)
    {
        ArgumentNullException.ThrowIfNull(item);
        _destructiveItems.Add(item);
        item.ForeColor = _palette.Destructive;
    }

    internal void ApplyTheme(DesktopThemeMode mode)
    {
        var replaceRenderer = _themeMode != mode || Renderer is not HubTrayMenuRenderer;
        _themeMode = mode;
        _palette = CreatePalette(mode);
        BackColor = _palette.Surface;
        ForeColor = _palette.Foreground;
        if (replaceRenderer)
        {
            Renderer = new HubTrayMenuRenderer(_palette);
        }
        ApplyItemTheme(Items);
        Invalidate(true);
    }

    internal static Image CreateExitIcon(Color color)
    {
        var bitmap = new Bitmap(18, 18);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using var pen = new Pen(color, 1.8F)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };

        graphics.DrawArc(pen, 3.25F, 3.25F, 11.5F, 11.5F, -50F, 280F);
        graphics.DrawLine(pen, 9F, 1.75F, 9F, 8F);
        return bitmap;
    }

    internal static Rectangle GetAlignedImageBounds(
        Rectangle slot,
        Size imageSize) =>
        new(
            slot.Left + ((slot.Width - imageSize.Width) / 2),
            slot.Top + ((slot.Height - imageSize.Height) / 2) - 1,
            imageSize.Width,
            imageSize.Height);

    protected override void OnOpening(CancelEventArgs e)
    {
        ApplyTheme(_themeMode);
        base.OnOpening(e);
    }

    protected override void OnSizeChanged(EventArgs e)
    {
        base.OnSizeChanged(e);

        if (Width <= 0 || Height <= 0)
        {
            return;
        }

        using var outline = CreateRoundedRectangle(
            new Rectangle(0, 0, Width, Height),
            CornerRadius);
        var previousRegion = Region;
        Region = new Region(outline);
        previousRegion?.Dispose();
    }

    internal static GraphicsPath CreateRoundedRectangle(Rectangle bounds, int radius)
    {
        var diameter = radius * 2;
        var path = new GraphicsPath();
        path.AddArc(bounds.Left, bounds.Top, diameter, diameter, 180, 90);
        path.AddArc(bounds.Right - diameter, bounds.Top, diameter, diameter, 270, 90);
        path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
        path.AddArc(bounds.Left, bounds.Bottom - diameter, diameter, diameter, 90, 90);
        path.CloseFigure();
        return path;
    }

    private void ApplyItemTheme(ToolStripItemCollection items)
    {
        foreach (ToolStripItem item in items)
        {
            item.BackColor = _palette.Surface;
            item.ForeColor = _destructiveItems.Contains(item)
                ? _palette.Destructive
                : _palette.Foreground;
            if (item is not ToolStripMenuItem menuItem)
            {
                continue;
            }

            menuItem.DropDown.BackColor = _palette.Surface;
            menuItem.DropDown.ForeColor = _palette.Foreground;
            menuItem.DropDown.Renderer = Renderer;
            ApplyItemTheme(menuItem.DropDownItems);
        }
    }

    private static HubTrayPalette CreatePalette(DesktopThemeMode mode) =>
        mode == DesktopThemeMode.Light
            ? new HubTrayPalette(
                Color.FromArgb(255, 255, 255),
                Color.FromArgb(20, 35, 48),
                Color.FromArgb(211, 225, 234),
                Color.FromArgb(232, 247, 253),
                Color.FromArgb(0, 169, 231),
                Color.FromArgb(180, 35, 24))
            : new HubTrayPalette(
                Color.FromArgb(22, 27, 34),
                Color.FromArgb(243, 242, 241),
                Color.FromArgb(48, 54, 61),
                Color.FromArgb(37, 42, 49),
                Color.FromArgb(56, 189, 248),
                Color.FromArgb(255, 119, 119));

    private sealed class HubTrayMenuRenderer(HubTrayPalette palette)
        : ToolStripProfessionalRenderer(new HubTrayColorTable(palette))
    {
        protected override void OnRenderToolStripBackground(ToolStripRenderEventArgs e)
        {
            using var brush = new SolidBrush(palette.Surface);
            e.Graphics.FillRectangle(brush, e.AffectedBounds);
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            using (var surfaceBrush = new SolidBrush(palette.Surface))
            {
                e.Graphics.FillRectangle(surfaceBrush, e.Item.ContentRectangle);
            }

            if (!e.Item.Selected || !e.Item.Enabled)
            {
                return;
            }

            var bounds = new Rectangle(2, 1, e.Item.Width - 4, e.Item.Height - 2);
            using var path = CreateRoundedRectangle(bounds, 6);
            using var hoverBrush = new SolidBrush(palette.Hover);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.FillPath(hoverBrush, path);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            var size = 16;
            var slot = new Rectangle(
                e.ImageRectangle.Left,
                e.Item.ContentRectangle.Top,
                e.ImageRectangle.Width,
                e.Item.ContentRectangle.Height);
            var bounds = GetAlignedImageBounds(slot, new Size(size, size));

            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var background = CreateRoundedRectangle(bounds, 4);
            using var brush = new SolidBrush(palette.Accent);
            e.Graphics.FillPath(brush, background);

            using var checkPen = new Pen(Color.White, 2F)
            {
                StartCap = LineCap.Round,
                EndCap = LineCap.Round,
                LineJoin = LineJoin.Round,
            };
            e.Graphics.DrawLines(checkPen,
            [
                new PointF(bounds.Left + 4F, bounds.Top + 8.5F),
                new PointF(bounds.Left + 6.75F, bounds.Top + 11F),
                new PointF(bounds.Left + 12F, bounds.Top + 5F),
            ]);
        }

        protected override void OnRenderItemImage(ToolStripItemImageRenderEventArgs e)
        {
            if (e.Image is null)
            {
                return;
            }

            var slot = new Rectangle(
                e.ImageRectangle.Left,
                e.Item.ContentRectangle.Top,
                e.ImageRectangle.Width,
                e.Item.ContentRectangle.Height);
            var bounds = GetAlignedImageBounds(slot, e.ImageRectangle.Size);
            e.Graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            e.Graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            e.Graphics.DrawImage(e.Image, bounds);
        }

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using var pen = new Pen(palette.Border, 1F);
            var y = e.Item.Height / 2F;
            e.Graphics.DrawLine(pen, 0, y, e.Item.Width, y);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var bounds = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            using var path = CreateRoundedRectangle(bounds, CornerRadius);
            using var pen = new Pen(palette.Border, 1F);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.DrawPath(pen, path);
        }
    }

    private sealed class HubTrayColorTable : ProfessionalColorTable
    {
        private readonly HubTrayPalette _palette;

        public HubTrayColorTable(HubTrayPalette palette)
        {
            _palette = palette;
            UseSystemColors = false;
        }

        public override Color ImageMarginGradientBegin => _palette.Surface;
        public override Color ImageMarginGradientMiddle => _palette.Surface;
        public override Color ImageMarginGradientEnd => _palette.Surface;
        public override Color MenuBorder => _palette.Border;
        public override Color MenuItemBorder => _palette.Hover;
        public override Color MenuItemSelected => _palette.Hover;
        public override Color ToolStripDropDownBackground => _palette.Surface;
    }
}
