#!/usr/bin/env python3
"""Render PNG diagrams and UI mockups for HR onboarding guide."""
from __future__ import annotations

import math
import textwrap
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "documentation" / "user-guides" / "assets" / "hr-onboarding"

PRIMARY = "#1565c0"
PRIMARY_DARK = "#0d47a1"
SECONDARY = "#00695c"
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
    cx, cy = node.x + node.w // 2, node.y + node.h // 2
    return cx, cy


def _pick_sides(src: NodeSpec, dst: NodeSpec) -> tuple[str, str]:
    dx = (dst.x + dst.w // 2) - (src.x + src.w // 2)
    dy = (dst.y + dst.h // 2) - (src.y + src.h // 2)
    if abs(dx) >= abs(dy):
        return ("right", "left") if dx >= 0 else ("left", "right")
    return ("bottom", "top") if dy >= 0 else ("top", "bottom")


def _draw_arrowhead(draw: ImageDraw.ImageDraw, tip: tuple[int, int], angle: float, size: int = 14) -> None:
    x, y = tip
    left = (
        x - size * math.cos(angle - math.pi / 7),
        y - size * math.sin(angle - math.pi / 7),
    )
    right = (
        x - size * math.cos(angle + math.pi / 7),
        y - size * math.sin(angle + math.pi / 7),
    )
    draw.polygon([tip, left, right], fill=ARROW)


def _draw_polyline_arrow(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[int, int]],
    width: int = 4,
) -> None:
    if len(points) < 2:
        return
    draw.line(points, fill=ARROW, width=width, joint="curve")
    x1, y1 = points[-2]
    x2, y2 = points[-1]
    angle = math.atan2(y2 - y1, x2 - x1)
    _draw_arrowhead(draw, (x2, y2), angle)


def _route_edge(src_pt: tuple[int, int], dst_pt: tuple[int, int], src_side: str, dst_side: str) -> list[tuple[int, int]]:
    sx, sy = src_pt
    dx, dy = dst_pt
    gap = 18
    if src_side in {"right", "left"} and dst_side in {"right", "left"}:
        mid_x = (sx + dx) // 2
        return [(sx, sy), (mid_x, sy), (mid_x, dy), (dx, dy)]
    if src_side in {"top", "bottom"} and dst_side in {"top", "bottom"}:
        mid_y = (sy + dy) // 2
        return [(sx, sy), (sx, mid_y), (dx, mid_y), (dx, dy)]
    if src_side == "right" and dst_side == "top":
        return [(sx, sy), (dx - gap, sy), (dx - gap, dy), (dx, dy)]
    if src_side == "bottom" and dst_side == "top":
        return [(sx, sy), (sx, dy - gap), (dx, dy - gap), (dx, dy)]
    if src_side == "right" and dst_side == "bottom":
        return [(sx, sy), (dx - gap, sy), (dx - gap, dy), (dx, dy)]
    if src_side == "left" and dst_side == "right":
        return [(sx, sy), (dx + gap, sy), (dx + gap, dy), (dx, dy)]
    return [(sx, sy), (dx, dy)]


def _draw_label(draw: ImageDraw.ImageDraw, point: tuple[int, int], text: str) -> None:
    font = _font(15, bold=True)
    tw, th = _text_size(draw, text, font)
    x, y = point
    pad_x, pad_y = 8, 4
    box = (x - tw // 2 - pad_x, y - th // 2 - pad_y, x + tw // 2 + pad_x, y + th // 2 + pad_y)
    _draw_rounded_rect(draw, box, fill="#ffffff", outline=BORDER, radius=6, width=1)
    draw.text((x - tw // 2, y - th // 2 - 1), text, font=font, fill=PRIMARY_DARK)


def _draw_node(draw: ImageDraw.ImageDraw, node: NodeSpec) -> None:
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
    if groups:
        for group in groups:
            _draw_group(draw, group)
    for node in nodes:
        _draw_node(draw, node)

    for edge in edges:
        src = node_map[edge.src]
        dst = node_map[edge.dst]
        src_side, dst_side = edge.src_side, edge.dst_side
        if src_side == "auto" or dst_side == "auto":
            auto_src, auto_dst = _pick_sides(src, dst)
            src_side = src_side if src_side != "auto" else auto_src
            dst_side = dst_side if dst_side != "auto" else auto_dst
        start = _anchor(src, src_side)
        end = _anchor(dst, dst_side)
        points = _route_edge(start, end, src_side, dst_side)
        _draw_polyline_arrow(draw, points)
        if edge.label:
            mid = points[len(points) // 2]
            _draw_label(draw, mid, edge.label)

    img.save(path, format="PNG")


def render_diagram_01_roles() -> None:
    render_diagram(
        ASSETS / "diagram-01-roles.png",
        "Рис. 1. Участники и роли",
        nodes=[
            NodeSpec("candidate", "Соискатель", 80, 170, 220, 88, fill=ACCENT_BLUE),
            NodeSpec("employer", "Оператор ПДн\n(работодатель)", 520, 300, 300, 100, fill=PANEL, header="Работодатель", header_fill=PRIMARY),
            NodeSpec("hr", "Кадровая служба", 80, 430, 220, 88, fill=PANEL),
            NodeSpec("acc", "Бухгалтерия", 980, 170, 240, 88, fill=PANEL),
            NodeSpec("sb", "Служба безопасности", 980, 320, 240, 88, fill=PANEL),
            NodeSpec("proc", "Хостинг / КЭДО\n(обработчик по договору)", 980, 470, 260, 96, fill=ACCENT_TEAL),
        ],
        edges=[
            EdgeSpec("candidate", "employer", "персональная ссылка", "right", "left"),
            EdgeSpec("hr", "employer", "внутренний доступ", "right", "left"),
            EdgeSpec("employer", "acc", "роль + минимум данных", "right", "left"),
            EdgeSpec("employer", "sb", "роль + проверка", "right", "left"),
            EdgeSpec("employer", "proc", "договор поручения", "right", "left"),
        ],
        size=(1400, 680),
    )


def render_diagram_02_lifecycle() -> None:
    render_diagram(
        ASSETS / "diagram-02-lifecycle.png",
        "Рис. 2. Жизненный цикл пакета документов",
        nodes=[
            NodeSpec("s1", "1. Приглашение", 60, 150, 180, 78),
            NodeSpec("s2", "2. Политика ПДн", 270, 150, 180, 78),
            NodeSpec("s3", "3. Согласие\n(отдельно)", 480, 150, 180, 78, fill=ACCENT_BLUE),
            NodeSpec("s4", "4. Загрузка", 690, 150, 180, 78),
            NodeSpec("s5", "5. Проверка HR", 900, 150, 180, 78),
            NodeSpec("ok", "Принят", 760, 360, 180, 78, fill=ACCENT_GREEN),
            NodeSpec("no", "Отказ / отзыв", 1040, 360, 200, 78, fill=ACCENT_ORANGE),
            NodeSpec("archive", "Личное дело\nархив 50 лет", 760, 540, 220, 88, fill=ACCENT_GREEN),
            NodeSpec("destroy", "Уничтожение\n30 дней + акт", 1040, 540, 220, 88, fill=ACCENT_RED),
        ],
        edges=[
            EdgeSpec("s1", "s2"),
            EdgeSpec("s2", "s3"),
            EdgeSpec("s3", "s4"),
            EdgeSpec("s4", "s5"),
            EdgeSpec("s5", "ok", "да", "bottom", "top"),
            EdgeSpec("s5", "no", "нет", "bottom", "top"),
            EdgeSpec("ok", "archive"),
            EdgeSpec("no", "destroy"),
        ],
        size=(1400, 720),
    )


def render_diagram_03_consents() -> None:
    render_diagram(
        ASSETS / "diagram-03-consents.png",
        "Рис. 3. Документооборот согласий",
        nodes=[
            NodeSpec("p", "Политика ПДн", 80, 180, 200, 80),
            NodeSpec("c", "Согласие на\nобработку", 330, 180, 220, 88, fill=ACCENT_BLUE),
            NodeSpec("u", "Загрузка\nдокументов", 600, 180, 200, 80),
            NodeSpec("q", "Нужна передача\nтретьим лицам?", 860, 180, 240, 88, fill=ACCENT_ORANGE),
            NodeSpec("tc", "Согласие на\nпередачу", 700, 380, 220, 88),
            NodeSpec("internal", "Внутренняя\nобработка", 1020, 380, 220, 88),
            NodeSpec("hire", "Личное дело", 900, 560, 200, 80, fill=ACCENT_GREEN),
            NodeSpec("act", "Акт\nуничтожения", 1160, 560, 200, 80, fill=ACCENT_RED),
        ],
        edges=[
            EdgeSpec("p", "c"),
            EdgeSpec("c", "u"),
            EdgeSpec("u", "q"),
            EdgeSpec("q", "tc", "да", "bottom", "top"),
            EdgeSpec("q", "internal", "нет", "bottom", "top"),
            EdgeSpec("tc", "internal", "после согласия", "right", "left"),
            EdgeSpec("internal", "hire", "принят", "bottom", "top"),
            EdgeSpec("internal", "act", "отказ", "bottom", "top"),
        ],
        size=(1400, 760),
    )


def render_diagram_04_storage() -> None:
    render_diagram(
        ASSETS / "diagram-04-storage.png",
        "Рис. 4. Два контура хранения",
        groups=[
            GroupSpec("Временный контур портала", 70, 130, 520, 430, fill=ACCENT_BLUE),
            GroupSpec("Постоянный контур", 700, 130, 520, 280, fill=ACCENT_GREEN),
        ],
        nodes=[
            NodeSpec("scan", "Полные сканы", 110, 190, 200, 78),
            NodeSpec("ocr", "OCR / черновики", 330, 190, 200, 78),
            NodeSpec("deadline", "До принятия решения", 220, 360, 240, 78, fill=ACCENT_ORANGE),
            NodeSpec("kedo", "Личное дело / КЭДО", 740, 190, 240, 78),
            NodeSpec("archive", "Архив 50 лет", 1020, 190, 160, 78),
            NodeSpec("destroy", "Уничтожение + акт\n(30 дней)", 860, 470, 240, 88, fill=ACCENT_RED),
        ],
        edges=[
            EdgeSpec("scan", "deadline", "хранение", "bottom", "top"),
            EdgeSpec("ocr", "deadline", "хранение", "bottom", "top"),
            EdgeSpec("deadline", "kedo", "прием", "right", "left"),
            EdgeSpec("kedo", "archive"),
            EdgeSpec("deadline", "destroy", "отказ", "bottom", "top"),
        ],
        size=(1400, 680),
    )


def render_diagram_05_hub() -> None:
    render_diagram(
        ASSETS / "diagram-05-hub-integration.png",
        "Рис. 5. Интеграция в HUB-IT",
        groups=[
            GroupSpec("Публичный контур", 70, 130, 420, 170, fill=ACCENT_BLUE),
            GroupSpec("Защищенный контур HUB", 540, 130, 420, 170, fill=ACCENT_GREEN),
            GroupSpec("Переиспользование платформы", 70, 360, 890, 250, fill="#f8fafc"),
        ],
        nodes=[
            NodeSpec("token", "/onboarding/:token", 110, 185, 300, 78),
            NodeSpec("hr", "/hr/onboarding", 580, 185, 300, 78),
            NodeSpec("files", "my_files pipeline\nupload + antivirus", 110, 430, 280, 88),
            NodeSpec("pg", "PostgreSQL APP\nметаданные", 450, 430, 250, 88),
            NodeSpec("crypto", "secret_crypto_service", 760, 430, 260, 88),
            NodeSpec("auth", "authorization_service", 760, 540, 260, 88),
            NodeSpec("blob", "Filesystem SHA-256", 110, 540, 280, 88),
        ],
        edges=[
            EdgeSpec("token", "files", "загрузка", "bottom", "top"),
            EdgeSpec("hr", "pg", "метаданные", "bottom", "top"),
            EdgeSpec("files", "blob", "blob", "bottom", "top"),
            EdgeSpec("pg", "crypto", "шифрование", "right", "left"),
            EdgeSpec("hr", "auth", "права", "bottom", "top"),
        ],
        size=(1400, 760),
    )


def render_diagrams() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    render_diagram_01_roles()
    render_diagram_02_lifecycle()
    render_diagram_03_consents()
    render_diagram_04_storage()
    render_diagram_05_hub()


def _mockup_canvas(title: str, subtitle: str, body_draw) -> Image.Image:
    w, h = 1280, 800
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    _draw_rounded_rect(draw, (0, 0, w, 64), fill=PRIMARY, radius=0)
    draw.text((24, 18), "HUB-IT", font=_font(24, bold=True), fill="#ffffff")
    draw.text((120, 22), title, font=_font(20, bold=True), fill="#ffffff")
    draw.text((24, 84), subtitle, font=_font(18), fill=MUTED)
    body_draw(draw, img)
    return img


def render_mockup_landing(path: Path) -> None:
    def body(draw: ImageDraw.ImageDraw, img: Image.Image) -> None:
        _draw_rounded_rect(draw, (80, 130, 1200, 700), fill=PANEL, outline=BORDER)
        draw.text((120, 170), "Добро пожаловать", font=_font(28, bold=True), fill=TEXT)
        draw.text((120, 220), "Перед загрузкой документов ознакомьтесь с политикой обработки персональных данных.", font=_font(18), fill=TEXT)
        lines = [
            "- Оператор: ООО «Пример»",
            "- Цель: рассмотрение кандидатуры и оформление трудовых отношений",
            "- Перечень документов: паспорт, СНИЛС, трудовая книжка (при наличии)",
            "- Срок хранения при отказе: 30 дней с актом уничтожения",
        ]
        y = 280
        for line in lines:
            draw.text((120, y), line, font=_font(17), fill=TEXT)
            y += 34
        _draw_rounded_rect(draw, (120, 590, 320, 650), fill=PRIMARY, outline=PRIMARY_DARK)
        draw.text((170, 608), "Продолжить", font=_font(18, bold=True), fill="#ffffff")

    _mockup_canvas("Портал трудоустройства", "Шаг 1 из 4 - ознакомление с политикой ПДн", body).save(path)


def render_mockup_consent(path: Path) -> None:
    def body(draw: ImageDraw.ImageDraw, img: Image.Image) -> None:
        _draw_rounded_rect(draw, (80, 130, 1200, 700), fill=PANEL, outline=BORDER)
        draw.text((120, 160), "Согласие на обработку персональных данных", font=_font(26, bold=True), fill=TEXT)
        draw.text((120, 210), "Отдельный документ (не является частью анкеты или заявления).", font=_font(17), fill=MUTED)
        consent = (
            "Я даю согласие на обработку моих персональных данных в целях рассмотрения кандидатуры "
            "и оформления трудовых отношений. Перечень данных: ФИО, паспорт, СНИЛС, контакты, "
            "сведения о трудовой деятельности. Срок действия согласия - до достижения цели обработки."
        )
        y = 270
        for line in textwrap.wrap(consent, width=88):
            draw.text((120, y), line, font=_font(16), fill=TEXT)
            y += 26
        _draw_rounded_rect(draw, (120, 500, 150, 530), fill=PANEL, outline=PRIMARY, width=2)
        draw.text((165, 505), "Я подтверждаю, что ознакомлен(а) и даю согласие", font=_font(16), fill=TEXT)
        draw.text((120, 560), "Подтверждение: SMS-код на +7 *** ***-**-45", font=_font(16), fill=MUTED)
        _draw_rounded_rect(draw, (120, 610, 360, 670), fill=PRIMARY, outline=PRIMARY_DARK)
        draw.text((205, 628), "Подписать", font=_font(18, bold=True), fill="#ffffff")

    _mockup_canvas("Портал трудоустройства", "Шаг 2 из 4 - согласие на обработку ПДн", body).save(path)


def render_mockup_upload(path: Path) -> None:
    def body(draw: ImageDraw.ImageDraw, img: Image.Image) -> None:
        items = [
            ("Паспорт (разворот с фото)", "Загружен", SECONDARY),
            ("СНИЛС", "Загружен", SECONDARY),
            ("Трудовая книжка / выписка ЕТК", "Ожидается", "#c2410c"),
            ("Документ об образовании", "Не требуется", MUTED),
        ]
        y = 150
        for name, status, color in items:
            _draw_rounded_rect(draw, (80, y, 1200, y + 110), fill=PANEL, outline=BORDER)
            draw.text((120, y + 24), name, font=_font(20, bold=True), fill=TEXT)
            draw.text((120, y + 58), f"Статус: {status}", font=_font(17, bold=True), fill=color)
            _draw_rounded_rect(draw, (980, y + 32, 1150, y + 78), fill="#eef2f6", outline=BORDER)
            draw.text((1010, y + 48), "Выбрать файл", font=_font(16), fill=PRIMARY_DARK)
            y += 130
        _draw_rounded_rect(draw, (80, y + 20, 360, y + 80), fill=PRIMARY, outline=PRIMARY_DARK)
        draw.text((150, y + 40), "Отправить пакет", font=_font(18, bold=True), fill="#ffffff")

    _mockup_canvas("Портал трудоустройства", "Шаг 3 из 4 - загрузка документов (ст. 65 ТК РФ)", body).save(path)


def render_mockup_hr(path: Path) -> None:
    def body(draw: ImageDraw.ImageDraw, img: Image.Image) -> None:
        headers = ["Кандидат", "Должность", "Статус", "Дата"]
        rows = [
            ("Иванов И.И.", "Инженер ИТ", "На проверке", "18.06.2026"),
            ("Петрова А.С.", "Бухгалтер", "Документы загружены", "17.06.2026"),
            ("Сидоров П.П.", "Менеджер", "Принят", "15.06.2026"),
        ]
        x_cols = [100, 360, 620, 900]
        y = 150
        for i, h in enumerate(headers):
            draw.text((x_cols[i], y), h, font=_font(17, bold=True), fill=PRIMARY_DARK)
        y += 40
        draw.line([(80, y), (1200, y)], fill=BORDER, width=2)
        y += 20
        for row in rows:
            for i, val in enumerate(row):
                draw.text((x_cols[i], y), val, font=_font(16), fill=TEXT)
            y += 42
        y += 30
        buttons = [("Принять", SECONDARY), ("Отказать", "#b91c1c"), ("Передать в СБ", PRIMARY)]
        x = 100
        for label, color in buttons:
            _draw_rounded_rect(draw, (x, y, x + 220, y + 56), fill=color, outline=color)
            draw.text((x + 48, y + 16), label, font=_font(17, bold=True), fill="#ffffff")
            x += 250
        draw.text((100, y + 80), "Доступ только по ролям HR. Пересылка публичной ссылки запрещена.", font=_font(15), fill=MUTED)

    _mockup_canvas("Кабинет кадров", "Пакеты документов кандидатов", body).save(path)


def render_mockups() -> None:
    render_mockup_landing(ASSETS / "mockup-01-landing.png")
    render_mockup_consent(ASSETS / "mockup-02-consent.png")
    render_mockup_upload(ASSETS / "mockup-03-upload.png")
    render_mockup_hr(ASSETS / "mockup-04-hr-dashboard.png")


def main() -> None:
    render_diagrams()
    render_mockups()
    print(f"Assets written to {ASSETS}")


if __name__ == "__main__":
    main()
