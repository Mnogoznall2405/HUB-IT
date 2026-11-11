#!/usr/bin/env python3
"""Build the HUB-IT employee quick-start PDF (1-2 pages, Russian)."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "documentation" / "user-guides" / "hub-employee-quickstart.pdf"

FONTS_DIR = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("Arial", str(FONTS_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONTS_DIR / "arialbd.ttf")))

PRIMARY = HexColor("#1976d2")
MUTED = HexColor("#64748b")
TEXT = HexColor("#0f172a")

TITLE = ParagraphStyle("Title", fontName="Arial-Bold", fontSize=20, leading=24, textColor=TEXT)
SUBTITLE = ParagraphStyle("Subtitle", fontName="Arial", fontSize=10.5, leading=14, textColor=MUTED)
H2 = ParagraphStyle("H2", fontName="Arial-Bold", fontSize=12.5, leading=16, textColor=PRIMARY, spaceBefore=10, spaceAfter=4)
BODY = ParagraphStyle("Body", fontName="Arial", fontSize=10.5, leading=14.5, textColor=TEXT)
FOOTER = ParagraphStyle("Footer", fontName="Arial", fontSize=8.5, leading=11, textColor=MUTED)


def bullets(items: list[str]) -> ListFlowable:
    return ListFlowable(
        [ListItem(Paragraph(item, BODY), leftIndent=10) for item in items],
        bulletType="bullet",
        bulletFontName="Arial",
        bulletFontSize=8,
        start="•",
        leftIndent=14,
        spaceAfter=2,
    )


def build() -> Path:
    doc = SimpleDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=16 * mm,
        rightMargin=16 * mm,
        topMargin=14 * mm,
        bottomMargin=14 * mm,
        title="HUB-IT — быстрый старт для сотрудника",
        author="HUB-IT",
    )

    story = [
        Paragraph("HUB-IT — быстрый старт", TITLE),
        Spacer(1, 3 * mm),
        Paragraph(
            "HUB — единое рабочее пространство: задачи, чат, почта, файлы, билеты и документооборот "
            "под одной корпоративной учётной записью.",
            SUBTITLE,
        ),

        Paragraph("1. Вход", H2),
        bullets([
            "Адрес: <b>hubit.zsgp.ru</b> — в браузере на компьютере или телефоне.",
            "Логин и пароль корпоративной учётной записи выдаёт IT-отдел.",
            "При запросе подтверждения введите код из приложения-аутентификатора или используйте ключ доступа (passkey).",
            "На личном рабочем компьютере можно привязать «доверенное устройство» — вход станет быстрее.",
        ]),

        Paragraph("2. Где работать", H2),
        bullets([
            "<b>Браузер</b> — hubit.zsgp.ru, без установки; работает и на телефоне.",
            "<b>HUB Desktop (Windows)</b> — уведомления при свёрнутом окне, открытие файлов в привычных программах, автозапуск. Установщик: «Настройки → Приложение».",
            "<b>Android</b> — установка там же, «Настройки → Приложение», или по ссылке от IT-отдела.",
            "<b>PWA</b> — HUB можно установить из браузера как приложение.",
        ]),

        Paragraph("3. Основные разделы", H2),
        bullets([
            "<b>Главная</b> — задачи, уведомления и отсутствующие коллеги на сегодня.",
            "<b>Лента</b> — объявления компании.",
            "<b>Задачи</b> — сроки, участники, чек-лист и обсуждение в одной карточке.",
            "<b>Чат</b> — личные и групповые переписки.",
            "<b>Почта</b> — корпоративный ящик внутри HUB.",
            "<b>Документооборот</b> — задания на согласование из 1С (пароль запросите у IT: it@zsgp.ru).",
            "<b>Мой диск</b> — рабочие файлы и ссылки на них.",
            "<b>Адресная книга</b> — контакты и отделы коллег.",
        ]),

        Paragraph("4. Почта в HUB Desktop", H2),
        bullets([
            "При первом входе приложение спросит, включать ли почту — выбор запоминается на этом компьютере.",
            "Передумали? «Настройки → Приложение → Почта на этом устройстве».",
            "В браузере и на телефоне почта включена всегда.",
        ]),

        Paragraph("5. Если что-то не работает", H2),
        bullets([
            "Нет нужного раздела в меню — нет права доступа: запросите у руководителя или IT.",
            "Не приходят уведомления — «Настройки → Уведомления» плюс разрешение в браузере или системе.",
            "Не проходит вход, забыт пароль — напишите на it@zsgp.ru, указав логин и текст ошибки.",
            "Подробная инструкция — раздел «Справка» в меню HUB.",
        ]),

        Spacer(1, 4 * mm),
        Paragraph(
            "Поддержка: <b>it@zsgp.ru</b> · HUB-IT — внутренняя платформа компании",
            FOOTER,
        ),
    ]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc.build(story)
    return OUTPUT


if __name__ == "__main__":
    path = build()
    print(f"Written: {path}")
