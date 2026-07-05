#!/usr/bin/env python3
"""Render PNG diagrams for Tickets/Logistics management guide."""
from __future__ import annotations

import math
import textwrap
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "documentation" / "user-guides" / "assets" / "tickets"

PRIMARY = "#1565c0"
PRIMARY_DARK = "#0d47a1"
BG = "#f5f7fa"
PANEL = "#ffffff"
TEXT = "#111827"
MUTED = "#475569"
BORDER = "#94a3b8"
ARROW = "#1e293b"
ACCENT_BLUE = "#dbeafe"
ACCENT_GREEN = "#dcfce7"
ACCENT_ORANGE = "#ffedd5"
ACCENT_RED = "#fee2e2"
ACCENT_TEAL = "#ccfbf1"


@dataclass
class NodeSpec:
    node_id: str
    label: str
    x: int
    y: int
    w: int
    h: int
    fill: str = PANEL
    header: str | None = None
    header_fill: str = PRIMARY


@dataclass
class EdgeSpec:
    src: str
    dst: str
    label: str | None = None
    src_side: str = "auto"
    dst_side: str = "auto"
    label_fraction: float = 0.5


@dataclass
class GroupSpec:
    label: str
    x: int
    y: int
    w: int
    h: int
    fill: str = "#eef2ff"


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def _text_size(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> tuple[int, int]:
    box = draw.textbbox((0, 0), text, font=font)
    return box[2] - box[0], box[3] - box[1]


def _draw_rounded_rect(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int, int, int],
    fill: str,
    outline: str | None = None,
    radius: int = 10,
    width: int = 2,
) -> None:
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)


def _draw_centered_text(
    draw: ImageDraw.ImageDraw,
    box: tuple[int, int, int, int],
    text: str,
    font: ImageFont.ImageFont,
    fill: str = TEXT,
    wrap: int = 20,
) -> None:
    x0, y0, x1, y1 = box
    lines = []
    for part in text.split("\n"):
        lines.extend(textwrap.wrap(part, width=wrap) or [""])
    line_height = _text_size(draw, "Ay", font)[1] + 5
    total_h = len(lines) * line_height
    y = y0 + max(6, (y1 - y0 - total_h) // 2)
    for line in lines:
        w, _ = _text_size(draw, line, font)
        x = x0 + (x1 - x0 - w) // 2
        draw.text((x, y), line, font=font, fill=fill)
        y += line_height


def _anchor(node: NodeSpec, side: str) -> tuple[int, int]:
    if side == "left":
        return node.x, node.y + node.h // 2
    if side == "right":
        return node.x + node.w, node.y + node.h // 2
    if side == "top":
        return node.x + node.w // 2, node.y
    if side == "bottom":
        return node.x + node.w // 2, node.y + node.h
    return node.x + node.w // 2, node.y + node.h // 2


def _pick_sides(src: NodeSpec, dst: NodeSpec) -> tuple[str, str]:
    dx = (dst.x + dst.w // 2) - (src.x + src.w // 2)
    dy = (dst.y + dst.h // 2) - (src.y + src.h // 2)
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")


def _node_rect(node: NodeSpec, pad: int = 10) -> tuple[int, int, int, int]:
    return node.x - pad, node.y - pad, node.x + node.w + pad, node.y + node.h + pad


def _point_in_rect(point: tuple[int, int], rect: tuple[int, int, int, int]) -> bool:
    x, y = point
    x0, y0, x1, y1 = rect
    return x0 <= x <= x1 and y0 <= y <= y1


def _rects_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _polyline_length(points: list[tuple[int, int]]) -> float:
    total = 0.0
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        total += math.hypot(x2 - x1, y2 - y1)
    return total


def _point_along_polyline(points: list[tuple[int, int]], fraction: float) -> tuple[int, int]:
    if len(points) < 2:
        return points[0]
    target = _polyline_length(points) * max(0.05, min(0.95, fraction))
    walked = 0.0
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        seg = math.hypot(x2 - x1, y2 - y1)
        if walked + seg >= target:
            t = (target - walked) / seg if seg else 0.0
            return int(x1 + (x2 - x1) * t), int(y1 + (y2 - y1) * t)
        walked += seg
    return points[-1]


def _segment_angle(points: list[tuple[int, int]], fraction: float) -> float:
    target_pt = _point_along_polyline(points, fraction)
    best = None
    best_dist = 10**9
    for i in range(len(points) - 1):
        x1, y1 = points[i]
        x2, y2 = points[i + 1]
        dist = abs((y2 - y1) * target_pt[0] - (x2 - x1) * target_pt[1] + x2 * y1 - y2 * x1) / (
            math.hypot(y2 - y1, x2 - x1) or 1.0
        )
        if dist < best_dist:
            best_dist = dist
            best = (x1, y1, x2, y2)
    if not best:
        return 0.0
    x1, y1, x2, y2 = best
    return math.atan2(y2 - y1, x2 - x1)


def _draw_arrowhead(draw: ImageDraw.ImageDraw, tip: tuple[int, int], angle: float, size: int = 12) -> None:
    x, y = tip
    left = (x - size * math.cos(angle - math.pi / 7), y - size * math.sin(angle - math.pi / 7))
    right = (x - size * math.cos(angle + math.pi / 7), y - size * math.sin(angle + math.pi / 7))
    draw.polygon([tip, left, right], fill=ARROW)


def _route_edge(
    src_pt: tuple[int, int],
    dst_pt: tuple[int, int],
    src_side: str,
    dst_side: str,
    *,
    lane: int = 0,
) -> list[tuple[int, int]]:
    sx, sy = src_pt
    dx, dy = dst_pt
    gap = 28 + lane * 18
    if src_side in {"right", "left"} and dst_side in {"right", "left"}:
        mid_x = (sx + dx) // 2 + lane * 16
        return [(sx, sy), (mid_x, sy), (mid_x, dy), (dx, dy)]
    if src_side in {"top", "bottom"} and dst_side in {"top", "bottom"}:
        if src_side == "bottom" and dst_side == "top":
            if abs(sx - dx) <= 120:
                return [(sx, sy), (sx, dy)]
            elbow_y = max(sy, dy) + gap + lane * 30
            return [(sx, sy), (sx, elbow_y), (dx, elbow_y), (dx, dy)]
        if src_side == "top" and dst_side == "bottom":
            if abs(sx - dx) <= 120:
                return [(sx, sy), (sx, dy)]
            elbow_y = min(sy, dy) - gap - lane * 30
            return [(sx, sy), (sx, elbow_y), (dx, elbow_y), (dx, dy)]
        mid_y = (sy + dy) // 2 + lane * 16
        return [(sx, sy), (sx, mid_y), (dx, mid_y), (dx, dy)]
    if src_side == "right" and dst_side == "top":
        return [(sx, sy), (dx - gap, sy), (dx - gap, dy), (dx, dy)]
    if src_side == "right" and dst_side == "bottom":
        return [(sx, sy), (sx + gap, sy), (sx + gap, dy), (dx, dy)]
    if src_side == "left" and dst_side == "right":
        return [(sx, sy), (dx + gap, sy), (dx + gap, dy), (dx, dy)]
    if src_side == "top" and dst_side == "right":
        return [(sx, sy), (sx, dy), (dx + gap, dy), (dx, dy)]
    if src_side == "left" and dst_side == "bottom":
        return [(sx, sy), (sx - gap, sy), (sx - gap, dy), (dx, dy)]
    if src_side == "bottom" and dst_side == "left":
        return [(sx, sy), (sx, dy + gap), (dx - gap, dy + gap), (dx - gap, dy), (dx, dy)]
    return [(sx, sy), (dx, dy)]


def _draw_label(draw: ImageDraw.ImageDraw, point: tuple[int, int], text: str) -> tuple[int, int, int, int]:
    font = _font(14, bold=True)
    tw, th = _text_size(draw, text, font)
    x, y = point
    pad_x, pad_y = 8, 5
    box = (x - tw // 2 - pad_x, y - th // 2 - pad_y, x + tw // 2 + pad_x, y + th // 2 + pad_y)
    _draw_rounded_rect(draw, box, fill="#ffffff", outline=BORDER, radius=6, width=1)
    draw.text((x - tw // 2, y - th // 2 - 1), text, font=font, fill=PRIMARY_DARK)
    return box


def _find_label_point(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    text: str,
    nodes: list[NodeSpec],
    fraction: float,
) -> tuple[int, int]:
    font = _font(14, bold=True)
    tw, th = _text_size(draw, text, font)
    node_rects = [_node_rect(n, 14) for n in nodes]
    angle = _segment_angle(points, fraction)
    offsets = [28, 36, -28, -36, 44, -44, 52, -52]
    fractions = [fraction, fraction - 0.12, fraction + 0.12, 0.35, 0.65]
    for frac in fractions:
        base = _point_along_polyline(points, frac)
        for offset in offsets:
            ox = int(offset * math.sin(angle))
            oy = int(-offset * math.cos(angle))
            candidate = (base[0] + ox, base[1] + oy)
            label_box = (
                candidate[0] - tw // 2 - 8,
                candidate[1] - th // 2 - 5,
                candidate[0] + tw // 2 + 8,
                candidate[1] + th // 2 + 5,
            )
            if any(_rects_overlap(label_box, rect) for rect in node_rects):
                continue
            return candidate
    return _point_along_polyline(points, fraction)


def _draw_node(draw: ImageDraw.ImageDraw, node: NodeSpec) -> None:
    if not (node.label or "").strip() and not node.header:
        cx = node.x + node.w // 2
        cy = node.y + node.h // 2
        draw.ellipse((cx - 3, cy - 3, cx + 3, cy + 3), fill=ARROW)
        return
    x0, y0 = node.x, node.y
    x1, y1 = node.x + node.w, node.y + node.h
    _draw_rounded_rect(draw, (x0, y0, x1, y1), fill=node.fill, outline=BORDER, width=2)
    if node.header:
        header_h = 34
        _draw_rounded_rect(draw, (x0, y0, x1, y0 + header_h), fill=node.header_fill, outline=node.header_fill, radius=10)
        draw.rectangle((x0, y0 + header_h - 8, x1, y0 + header_h), fill=node.header_fill)
        _draw_centered_text(draw, (x0, y0, x1, y0 + header_h), node.header, _font(15, bold=True), fill="#ffffff", wrap=24)
        _draw_centered_text(draw, (x0, y0 + header_h, x1, y1), node.label, _font(16), fill=TEXT, wrap=22)
    else:
        _draw_centered_text(draw, (x0, y0, x1, y1), node.label, _font(17, bold=True), fill=TEXT, wrap=22)


def _draw_group(draw: ImageDraw.ImageDraw, group: GroupSpec) -> None:
    _draw_rounded_rect(draw, (group.x, group.y, group.x + group.w, group.y + group.h), fill=group.fill, outline=BORDER, width=2)
    label_font = _font(16, bold=True)
    tw, th = _text_size(draw, group.label, label_font)
    lx = group.x + 16
    ly = group.y - th // 2
    draw.rectangle((lx - 4, ly - 2, lx + tw + 4, ly + th + 2), fill=BG)
    draw.text((lx, ly), group.label, font=label_font, fill=PRIMARY_DARK)


def _draw_legend(draw: ImageDraw.ImageDraw, y: int, text: str, size: tuple[int, int]) -> None:
    font = _font(14)
    draw.text((40, y), text, font=font, fill=MUTED)


def render_diagram(
    path: Path,
    title: str,
    nodes: list[NodeSpec],
    edges: list[EdgeSpec],
    groups: list[GroupSpec] | None = None,
    size: tuple[int, int] = (1400, 900),
) -> None:
    img = Image.new("RGB", size, BG)
    draw = ImageDraw.Draw(img)
    draw.text((36, 24), title, font=_font(30, bold=True), fill=PRIMARY_DARK)

    node_map = {n.node_id: n for n in nodes}
    routed_edges: list[tuple[EdgeSpec, list[tuple[int, int]], float]] = []

    if groups:
        for group in groups:
            _draw_group(draw, group)

    lane_counter: dict[tuple[str, str], int] = {}
    for edge in edges:
        src = node_map[edge.src]
        dst = node_map[edge.dst]
        src_side, dst_side = edge.src_side, edge.dst_side
        if src_side == "auto" or dst_side == "auto":
            auto_src, auto_dst = _pick_sides(src, dst)
            src_side = src_side if src_side != "auto" else auto_src
            dst_side = dst_side if dst_side != "auto" else auto_dst
        incoming_key = (edge.dst, dst_side)
        lane = lane_counter.get(incoming_key, 0)
        lane_counter[incoming_key] = lane + 1
        start = _anchor(src, src_side)
        end = _anchor(dst, dst_side)
        points = _route_edge(start, end, src_side, dst_side, lane=lane)
        routed_edges.append((edge, points, _segment_angle(points, 0.85)))

        draw.line(points, fill=ARROW, width=3, joint="curve")

    for node in nodes:
        _draw_node(draw, node)

    for edge, points, angle in routed_edges:
        end = points[-1]
        _draw_arrowhead(draw, end, angle)

    for edge, points, _angle in routed_edges:
        if not edge.label:
            continue
        label_pt = _find_label_point(draw, points, edge.label, nodes, edge.label_fraction)
        _draw_label(draw, label_pt, edge.label)

    img.save(path, format="PNG")


def render_diagram_01_roles() -> None:
    render_diagram(
        ASSETS / "diagram-01-roles.png",
        "Рис. 1. Роли и зоны ответственности",
        groups=[
            GroupSpec("Руководство", 60, 100, 220, 130, fill=ACCENT_BLUE),
            GroupSpec("Операционный контур", 320, 100, 280, 200, fill=ACCENT_GREEN),
            GroupSpec("Администрирование", 640, 100, 220, 130, fill=ACCENT_TEAL),
            GroupSpec("Справочники", 280, 430, 360, 110, fill="#f8fafc"),
        ],
        nodes=[
            NodeSpec("mgr", "Руководитель", 100, 140, 150, 60, fill=PANEL),
            NodeSpec("op", "Оператор\nлогистики", 380, 130, 160, 68, fill=PANEL),
            NodeSpec("coord", "Координатор\nобъекта", 380, 230, 160, 68, fill=PANEL),
            NodeSpec("adm", "Администратор", 680, 140, 150, 60, fill=PANEL),
            NodeSpec("req", "Заявка\nна билет", 360, 300, 200, 76, fill=ACCENT_ORANGE),
            NodeSpec("refs", "Объекты,\nсотрудники,\nдокументы", 310, 460, 300, 72, fill=PANEL),
        ],
        edges=[
            EdgeSpec("mgr", "req", None, "bottom", "top"),
            EdgeSpec("op", "req", None, "bottom", "top"),
            EdgeSpec("coord", "req", None, "bottom", "top"),
            EdgeSpec("refs", "req", None, "top", "bottom"),
        ],
        size=(1280, 600),
    )
    img = Image.open(ASSETS / "diagram-01-roles.png")
    draw = ImageDraw.Draw(img)
    _draw_legend(
        draw,
        540,
        "Руководитель: дашборд и SLA  |  Оператор: статусы и вложения  |  Координатор: данные сотрудника  |  Администратор: справочник объектов",
        (1280, 620),
    )
    img.save(ASSETS / "diagram-01-roles.png", format="PNG")


def render_diagram_02_lifecycle() -> None:
    render_diagram(
        ASSETS / "diagram-02-lifecycle.png",
        "Рис. 2. Жизненный цикл заявки на билет",
        nodes=[
            NodeSpec("n1", "Новая", 60, 150, 120, 60, fill=ACCENT_BLUE),
            NodeSpec("n2", "Проверка\nданных", 210, 150, 120, 60),
            NodeSpec("n4", "Готова\nк покупке", 360, 150, 120, 60),
            NodeSpec("n5", "В работе", 510, 150, 120, 60),
            NodeSpec("n6", "Куплен", 660, 150, 120, 60, fill=ACCENT_GREEN),
            NodeSpec("n8", "Закрыта", 810, 150, 120, 60, fill=ACCENT_GREEN),
            NodeSpec("n10", "Архив", 960, 150, 120, 60),
            NodeSpec("n3", "Не хватает\nданных", 210, 300, 120, 60, fill=ACCENT_ORANGE),
            NodeSpec("n9", "Отмена", 60, 300, 120, 60, fill=ACCENT_RED),
            NodeSpec("n7", "Обмен /\nвозврат", 660, 300, 120, 60, fill=ACCENT_ORANGE),
        ],
        edges=[
            EdgeSpec("n1", "n2"),
            EdgeSpec("n2", "n4"),
            EdgeSpec("n4", "n5"),
            EdgeSpec("n5", "n6"),
            EdgeSpec("n6", "n8"),
            EdgeSpec("n8", "n10"),
            EdgeSpec("n1", "n3", None, "bottom", "top"),
            EdgeSpec("n2", "n3", None, "bottom", "top", 0.4),
            EdgeSpec("n3", "n2", None, "top", "bottom", 0.6),
            EdgeSpec("n1", "n9", None, "bottom", "top"),
            EdgeSpec("n4", "n9", None, "bottom", "top", 0.5),
            EdgeSpec("n6", "n7", None, "bottom", "top"),
            EdgeSpec("n7", "n5", None, "top", "bottom", 0.35),
            EdgeSpec("n7", "n8", None, "right", "bottom", 0.5),
        ],
        size=(1280, 430),
    )


def render_diagram_03_documents() -> None:
    render_diagram(
        ASSETS / "diagram-03-documents.png",
        "Рис. 3. Документооборот и данные",
        nodes=[
            NodeSpec("manual", "Ручное\nсоздание", 70, 250, 150, 64, fill=ACCENT_BLUE),
            NodeSpec("excel", "Импорт\nиз Excel", 70, 360, 150, 64, fill=ACCENT_BLUE),
            NodeSpec("req", "Карточка\nзаявки", 420, 250, 190, 84, fill=PANEL, header="Заявка", header_fill=PRIMARY),
            NodeSpec("hist", "История\nизменений", 420, 410, 190, 64),
            NodeSpec("route", "Маршрут", 430, 110, 110, 58),
            NodeSpec("ticket", "PDF билета", 500, 110, 110, 58, fill=ACCENT_GREEN),
            NodeSpec("receipt", "Чек", 570, 110, 100, 58),
            NodeSpec("pass", "Паспортные\nданные", 250, 250, 150, 64, fill=ACCENT_ORANGE),
            NodeSpec("dash", "Дашборд\nи отчёты", 700, 250, 180, 64, fill=ACCENT_TEAL),
        ],
        edges=[
            EdgeSpec("manual", "req", None, "right", "left"),
            EdgeSpec("excel", "req", None, "right", "left"),
            EdgeSpec("pass", "req", None, "right", "left"),
            EdgeSpec("req", "dash", None, "right", "left"),
            EdgeSpec("req", "hist", None, "bottom", "top"),
            EdgeSpec("route", "req", None, "bottom", "top", 0.35),
            EdgeSpec("ticket", "req", None, "bottom", "top", 0.5),
            EdgeSpec("receipt", "req", None, "bottom", "top", 0.65),
        ],
        size=(1280, 540),
    )
    img = Image.open(ASSETS / "diagram-03-documents.png")
    draw = ImageDraw.Draw(img)
    _draw_legend(
        draw,
        490,
        "Оператор прикрепляет: маршрут, PDF билета, чек  |  Координатор: паспортные данные  |  Контроль: дашборд и отчёты",
        (1280, 540),
    )
    img.save(ASSETS / "diagram-03-documents.png", format="PNG")


def render_diagram_04_import() -> None:
    render_diagram(
        ASSETS / "diagram-04-import.png",
        "Рис. 4. Импорт заявок из Excel",
        nodes=[
            NodeSpec("s1", "Файл .xlsx", 60, 220, 150, 68, fill=ACCENT_BLUE),
            NodeSpec("s2", "Загрузка", 250, 220, 140, 68),
            NodeSpec("s3", "Предпросмотр", 440, 220, 160, 68),
            NodeSpec("s4", "Лист -> объект", 680, 130, 170, 68, fill=ACCENT_ORANGE),
            NodeSpec("s5", "Цвет -> статус", 680, 310, 170, 68, fill=ACCENT_ORANGE),
            NodeSpec("s6", "Запуск\nимпорта", 920, 220, 160, 68, fill=ACCENT_GREEN),
            NodeSpec("s7", "Заявки\nв системе", 1110, 220, 150, 68, fill=ACCENT_GREEN),
        ],
        edges=[
            EdgeSpec("s1", "s2"),
            EdgeSpec("s2", "s3"),
            EdgeSpec("s3", "s4", None, "top", "left", 0.4),
            EdgeSpec("s3", "s5", None, "bottom", "left", 0.4),
            EdgeSpec("s4", "s6", None, "right", "top", 0.45),
            EdgeSpec("s5", "s6", None, "right", "bottom", 0.45),
            EdgeSpec("s6", "s7"),
        ],
        size=(1320, 480),
    )


def render_diagram_05_kanban() -> None:
    render_diagram(
        ASSETS / "diagram-05-kanban.png",
        "Рис. 5. Канбан-доска: колонки этапов",
        nodes=[
            NodeSpec("c1", "Не запущен\n\nновая, проверка,\nне хватает данных,\nготова к покупке", 50, 180, 175, 300, fill=ACCENT_BLUE),
            NodeSpec("c2", "В работе\n\nпокупка билета", 255, 180, 175, 300),
            NodeSpec("c3", "Куплен\n\nбилет оформлен", 460, 180, 175, 300, fill=ACCENT_GREEN),
            NodeSpec("c4", "Возврат / обмен\n\nпереоформление", 665, 180, 175, 300, fill=ACCENT_ORANGE),
            NodeSpec("c5", "Отмена", 870, 180, 175, 300, fill=ACCENT_RED),
            NodeSpec("c6", "Проблема\n\nне явился, срочные,\nтребует проверки", 1075, 180, 175, 300, fill=ACCENT_ORANGE),
        ],
        edges=[],
        size=(1320, 560),
    )


def render_diagram_06_sla() -> None:
    render_diagram(
        ASSETS / "diagram-06-sla.png",
        "Рис. 6. Контроль SLA и уведомления",
        nodes=[
            NodeSpec("r1", "Вылет скоро\nбилет не куплен", 60, 120, 200, 64, fill=ACCENT_ORANGE),
            NodeSpec("r2", "Застряла\nв нехватке данных", 60, 230, 200, 64, fill=ACCENT_ORANGE),
            NodeSpec("r3", "Нет движения\nпо заявке", 60, 340, 200, 64, fill=ACCENT_ORANGE),
            NodeSpec("r4", "Новая\nфинансовая потеря", 60, 450, 200, 64, fill=ACCENT_RED),
            NodeSpec("bus", "", 300, 250, 20, 140, fill=BG),
            NodeSpec("n1", "Уведомление\nна странице Билеты", 400, 250, 230, 80, fill=PANEL, header="SLA", header_fill=PRIMARY),
            NodeSpec("n4", "Администратор\nи оператор", 760, 250, 190, 80, fill=ACCENT_TEAL),
            NodeSpec("n2", "Переход\nк заявке", 400, 400, 190, 64, fill=ACCENT_GREEN),
            NodeSpec("n3", "Скрыть\nпосле обработки", 400, 510, 190, 64),
        ],
        edges=[
            EdgeSpec("r1", "bus", None, "right", "left", 0.2),
            EdgeSpec("r2", "bus", None, "right", "left", 0.4),
            EdgeSpec("r3", "bus", None, "right", "left", 0.6),
            EdgeSpec("r4", "bus", None, "right", "left", 0.8),
            EdgeSpec("bus", "n1", None, "right", "left"),
            EdgeSpec("n1", "n4", None, "right", "left"),
            EdgeSpec("n1", "n2", None, "bottom", "top"),
            EdgeSpec("n2", "n3", None, "bottom", "top"),
        ],
        size=(1280, 620),
    )


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    render_diagram_01_roles()
    render_diagram_02_lifecycle()
    render_diagram_03_documents()
    render_diagram_04_import()
    render_diagram_05_kanban()
    render_diagram_06_sla()
    print(f"Assets written to {ASSETS}")


if __name__ == "__main__":
    main()
