# -*- coding: utf-8 -*-
"""Пиксельный sanity-анализ кадров нативной почты (07*.png, L07*.png).

Модель не просматривает изображения - проверяем программно:
  1) пустое состояние чтения компактно (нет гигантского блока текста/клавиш);
  2) в теле письма нет огромного однотонного прямоугольника (белый лист
     ограничен, панель вокруг него видна);
  3) трёхпанельная структура присутствует (рейка/список/чтение различимы
     по разделителям/фону).
Пороги эвристические; скрипт - детектор грубых аномалий, не эталон.
"""
from PIL import Image
import sys

SHOT = r"C:\Project\HUB-IT-main\desktop\screenshots"


def load(name):
    return Image.open(f"{SHOT}\\{name}").convert("RGB")


def uniform_blocks(img, region, color_tol=6, min_frac=0.55):
    """Доля крупнейшего однотонного прямоугольника в регионе (по строкам)."""
    x0, y0, x1, y1 = region
    px = img.load()
    w, h = img.size
    x0, y0, x1, y1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
    best = 0
    run_color, run_y0, run_y1 = None, None, None
    for y in range(y0, y1):
        row_ok = True
        c = px[x0, y]
        for x in range(x0 + 1, x1):
            r, g, b = px[x, y]
            if abs(r - c[0]) > color_tol or abs(g - c[1]) > color_tol or abs(b - c[2]) > color_tol:
                row_ok = False
                break
        if row_ok:
            if run_color is None or run_y1 != y - 1 or (
                abs(c[0] - run_color[0]) > color_tol
                or abs(c[1] - run_color[1]) > color_tol
                or abs(c[2] - run_color[2]) > color_tol
            ):
                run_color, run_y0 = c, y
            run_y1 = y
            best = max(best, run_y1 - run_y0 + 1)
        else:
            run_color = None
    height = y1 - y0
    return best / max(1, height)


def content_bbox(img, region, bg, tol=18):
    """bbox пикселей, отличающихся от фона региона."""
    x0, y0, x1, y1 = region
    px = img.load()
    w, h = img.size
    x0, y0, x1, y1 = int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h)
    minx, miny, maxx, maxy, cnt = None, None, None, None, 0
    for y in range(y0, y1):
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if abs(r - bg[0]) > tol or abs(g - bg[1]) > tol or abs(b - bg[2]) > tol:
                cnt += 1
                minx = x if minx is None else min(minx, x)
                maxx = x if maxx is None else max(maxx, x)
                miny = y if miny is None else min(miny, y)
                maxy = y if maxy is None else max(maxy, y)
    if minx is None:
        return None, 0
    return (minx - x0, miny - y0, maxx - x0, maxy - y0), cnt


def corner_bg(img):
    px = img.load()
    return px[8, 8]


def report(name, checks):
    img = load(name)
    bg = corner_bg(img)
    w, h = img.size
    print(f"== {name} ({w}x{h}) bg={bg}")
    for label, ok, detail in checks(img, bg, w, h):
        status = "OK " if ok else "WARN"
        print(f"   [{status}] {label}: {detail}")


def empty_state_checks(img, bg, w, h):
    # область чтения: внутри панели (без рамок/скроллбаров), ниже тулбара
    # x от 0.64 — правее сплиттера списка, чтобы не захватывать колонку списка
    region = (0.64, 0.14, 0.965, 0.93)
    bbox, cnt = content_bbox(img, region, bg)
    rh = region[3] * h - region[1] * h
    checks = []
    if bbox is None:
        checks.append(("пустое состояние", False, "контент не найден"))
        return checks
    bh = bbox[3] - bbox[1]
    bw = bbox[2] - bbox[0]
    checks.append((
        "компактность пустого состояния",
        bh < 0.38 * rh,
        f"bbox {bw}x{bh} в области ~{int(rh)}px, высота {bh / rh:.0%} порог 38%",
    ))
    frac = cnt / ((region[2] - region[0]) * w * (region[3] - region[1]) * h)
    checks.append(("плотность пикселей", frac < 0.12, f"{frac:.1%} нетто-контента, порог 12%"))
    return checks


def mail_frame_checks(img, bg, w, h):
    checks = []
    # тело письма (правая панель, ниже шапки ~22%): огромный однотонный блок?
    region = (0.62, 0.34, 0.995, 0.955)
    frac = uniform_blocks(img, region)
    checks.append(("однотонный блок в теле", frac < 0.9, f"крупнейший {frac:.0%} региона (порог 90%)"))
    # структура: три вертикальные зоны с разным контентом
    zones = [(0.02, 0.20), (0.21, 0.55), (0.56, 0.995)]
    fracs = []
    for i, (a, b) in enumerate(zones):
        bbox, cnt = content_bbox(img, (a, 0.10, b, 0.955), bg)
        fracs.append(cnt)
    checks.append(("три панели не пусты", all(f > 400 for f in fracs), f"пикселей контента {fracs}"))
    return checks


for name, fn in [
    ("07e-mail-empty.png", empty_state_checks),
    ("L07e-mail-empty.png", empty_state_checks),
    ("07-mail.png", mail_frame_checks),
    ("L07-mail.png", mail_frame_checks),
    ("07c-mail-scrolled.png", mail_frame_checks),
    ("L07c-mail-scrolled.png", mail_frame_checks),
    ("07d-mail-headers.png", mail_frame_checks),
    ("L07d-mail-headers.png", mail_frame_checks),
]:
    try:
        report(name, fn)
    except Exception as exc:
        print(f"== {name}: ERROR {exc}")
