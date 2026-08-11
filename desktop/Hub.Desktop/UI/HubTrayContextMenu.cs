using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace Hub.Desktop.UI;

internal sealed class HubTrayContextMenu : ContextMenuStrip
{
    private const int CornerRadius = 8;
    private static readonly Color SurfaceColor = Color.FromArgb(255, 255, 255);
    internal static readonly Color ExitColor = Color.FromArgb(180, 35, 24);

    public HubTrayContextMenu()
    {
        AutoSize = true;
        BackColor = SurfaceColor;
        ForeColor = Color.FromArgb(20, 35, 48);
        Font = new Font("Segoe UI", 9F, FontStyle.Regular, GraphicsUnit.Point);
        ImageScalingSize = new Size(18, 18);
        MinimumSize = new Size(224, 0);
        Padding = new Padding(4);
        Renderer = new HubTrayMenuRenderer();
        ShowCheckMargin = false;
        ShowImageMargin = true;
    }

    internal static Font CreateEmphasizedFont() =>
        new("Segoe UI", 9F, FontStyle.Bold, GraphicsUnit.Point);

    internal static ToolStripSeparator CreateSeparator() => new()
    {
        Margin = new Padding(32, 2, 6, 2),
    };

    internal static Image CreateExitIcon()
    {
        var bitmap = new Bitmap(18, 18);
        using var graphics = Graphics.FromImage(bitmap);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;

        using var pen = new Pen(ExitColor, 1.8F)
        {
            StartCap = LineCap.Round,
            EndCap = LineCap.Round,
            LineJoin = LineJoin.Round,
        };

        graphics.DrawArc(pen, 3.25F, 3.25F, 11.5F, 11.5F, -50F, 280F);
        graphics.DrawLine(pen, 9F, 1.75F, 9F, 8F);
        return bitmap;
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

    private sealed class HubTrayMenuRenderer : ToolStripProfessionalRenderer
    {
        private static readonly Color BorderColor = Color.FromArgb(211, 225, 234);
        private static readonly Color HoverColor = Color.FromArgb(232, 247, 253);
        private static readonly Color AccentColor = Color.FromArgb(0, 169, 231);

        public HubTrayMenuRenderer()
            : base(new HubTrayColorTable())
        {
            RoundedEdges = true;
        }

        protected override void OnRenderMenuItemBackground(ToolStripItemRenderEventArgs e)
        {
            if (!e.Item.Selected || !e.Item.Enabled)
            {
                return;
            }

            var bounds = new Rectangle(2, 1, e.Item.Width - 4, e.Item.Height - 2);
            using var path = CreateRoundedRectangle(bounds, 6);
            using var brush = new SolidBrush(HoverColor);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.FillPath(brush, path);
        }

        protected override void OnRenderItemCheck(ToolStripItemImageRenderEventArgs e)
        {
            var size = 16;
            var bounds = new Rectangle(
                e.ImageRectangle.Left + ((e.ImageRectangle.Width - size) / 2),
                e.ImageRectangle.Top + ((e.ImageRectangle.Height - size) / 2),
                size,
                size);

            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            using var background = CreateRoundedRectangle(bounds, 4);
            using var brush = new SolidBrush(AccentColor);
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

        protected override void OnRenderSeparator(ToolStripSeparatorRenderEventArgs e)
        {
            using var pen = new Pen(BorderColor, 1F);
            var y = e.Item.Height / 2F;
            e.Graphics.DrawLine(pen, 0, y, e.Item.Width, y);
        }

        protected override void OnRenderToolStripBorder(ToolStripRenderEventArgs e)
        {
            var bounds = new Rectangle(0, 0, e.ToolStrip.Width - 1, e.ToolStrip.Height - 1);
            using var path = CreateRoundedRectangle(bounds, CornerRadius);
            using var pen = new Pen(BorderColor, 1F);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.DrawPath(pen, path);
        }
    }

    private sealed class HubTrayColorTable : ProfessionalColorTable
    {
        private static readonly Color BorderColor = Color.FromArgb(211, 225, 234);
        private static readonly Color HoverColor = Color.FromArgb(232, 247, 253);

        public HubTrayColorTable()
        {
            UseSystemColors = false;
        }

        public override Color ImageMarginGradientBegin => SurfaceColor;
        public override Color ImageMarginGradientMiddle => SurfaceColor;
        public override Color ImageMarginGradientEnd => SurfaceColor;
        public override Color MenuBorder => BorderColor;
        public override Color MenuItemBorder => HoverColor;
        public override Color MenuItemSelected => HoverColor;
        public override Color ToolStripDropDownBackground => SurfaceColor;
    }
}
