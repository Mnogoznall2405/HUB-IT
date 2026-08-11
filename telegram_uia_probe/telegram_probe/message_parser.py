"""Parse open-chat dialogue from Telegram Desktop UIA visible text / nodes."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

from .models import UiNodeSummary
from .uia_tree import UiDump

CHROME_LABELS = {
    "свернуть",
    "развернуть",
    "закрыть",
    "главное меню",
    "папки",
    "личные",
    "ред.",
    "поиск",
    "чаты",
    "звонок",
    "поиск сообщений",
    "информация",
    "меню чата",
    "сообщения",
    "добавить вложение",
    "выбрать эмодзи, стикер или gif-анимацию",
    "сообщение...",
    "запись голосового сообщения",
    "отправитель",
    "сообщение",
    "получение",
    "время",
    "тип",
    "название",
    "тип медиафайла",
    "размер изображения",
    "ответить",
    "просмотрено",
    "получено",
    "отправлено",
    "изменено",
    "закреплено",
    "без уведомлений",
    "истории",
    "активность",
    "в сети",
    "premium",
    "с premium",
    "фотография",
    "реакции",
    "бот",
    "группа",
}

# Composite bubble exposed as one accessibility name:
# "Просмотрено Меня Текст Отправлено в 20:21"
# "Камчатка Сергей Айтишник Текст Получено в 20:23"
# "Просмотрено Меня Ответ для X: ⁨quote⁩ Текст Отправлено изменено в 8:17"
_TIME_TAIL = (
    r"(?P<direction>Отправлено|Получено)(?:\s+изменено)?"
    r"\s+(?P<time>(?:в\s+\d{1,2}:\d{2}|вчера\s+в\s+.+|сегодня\s+в\s+.+"
    r"|\d{1,2}\.\d{1,2}\.\d{2,4}\s+в\s+.+))$"
)
_BUBBLE_REPLY_RE = re.compile(
    r"^(?:Просмотрено\s+)?"
    r"(?P<sender>Меня|.+?)\s+"
    r"Ответ для\s+(?P<reply_to>.+?):\s*⁨(?P<quote>.*?)⁩\s+"
    r"(?P<body>.*?)\s+"
    + _TIME_TAIL,
    re.IGNORECASE | re.DOTALL,
)
_BUBBLE_RE = re.compile(
    r"^(?:Просмотрено\s+)?"
    r"(?P<sender>Меня|.+?)\s+"
    r"(?P<body>.*?)\s+"
    + _TIME_TAIL,
    re.IGNORECASE | re.DOTALL,
)

_MEDIA_RE = re.compile(
    r"^(?:Просмотрено\s+)?"
    r"(?P<sender>Меня|.+?)\s+"
    r"(?P<body>(?:Фотография|Видео|Голосовое сообщение|Файл|Стикер|GIF)"
    r"(?:,\s*[\d×x]+)?(?:\s+.+)?)\s+"
    r"(?P<direction>Отправлено|Получено)"
    r"(?:\s+изменено)?"
    r"\s+(?P<time>(?:в\s+\d{1,2}:\d{2}|вчера\s+в\s+.+|сегодня\s+в\s+.+"
    r"|\d{1,2}\.\d{1,2}\.\d{2,4}\s+в\s+.+))$",
    re.IGNORECASE | re.DOTALL,
)

# Chat-list rows: "Name, pinned, preview, time" — not open-chat bubbles.
_CHAT_LIST_HINTS = (
    "закреплено",
    "непрочитан",
    "без уведомлений",
    "непросмотрен",
)


@dataclass
class ChatMessage:
    sender: str
    text: str
    direction: str  # outgoing | incoming | unknown
    time: str = ""
    reply_to: str = ""
    quote: str = ""
    media: str = ""
    raw: str = ""
    # Calendar day of the dialogue (from Telegram day separator / rich time).
    chat_date: str = ""  # YYYY-MM-DD
    day_label: str = ""  # «Сегодня», «31 июля», …
    # Screen-coordinate bounding box of HistoryInner ListItem (LTRB), if known.
    bbox: tuple[int, int, int, int] | None = None
    # Tighter crop for on-screen photo/video preview (MAX PreviewCell), if known.
    media_bbox: tuple[int, int, int, int] | None = None

    def to_dict(self) -> dict[str, Any]:
        data = asdict(self)
        if data.get("bbox") is None:
            data.pop("bbox", None)
        if data.get("media_bbox") is None:
            data.pop("media_bbox", None)
        if not data.get("chat_date"):
            data.pop("chat_date", None)
        if not data.get("day_label"):
            data.pop("day_label", None)
        return data


@dataclass
class DialogueExtract:
    messages: list[ChatMessage] = field(default_factory=list)
    note: str = ""

    def to_dicts(self) -> list[dict[str, Any]]:
        return [m.to_dict() for m in self.messages]


def extract_dialogue(
    dump: UiDump | None = None,
    visible_text: Iterable[str] | None = None,
    chat_name: str | None = None,
) -> DialogueExtract:
    """
    Extract visible open-chat messages (what UIA currently exposes on screen).

    Telegram only exposes *visible* history through accessibility — not the full
    scrollable archive unless the user scrolls. Newest bubbles are usually at the
    end of the HistoryWidget stream.
    """
    # History region first (open chat), then generic visible text.
    texts: list[str] = []
    if dump is not None:
        texts.extend(dump.history_text)
        texts.extend(dump.visible_text)
    if visible_text is not None:
        texts.extend(str(x) for x in visible_text if x)

    # Only full bubbles, first-seen order. Do NOT fuzzy-reorder — that previously
    # grouped all outgoing messages together via short labels like «Просмотрено».
    messages: list[ChatMessage] = []
    seen: set[str] = set()
    for text in texts:
        text = (text or "").strip()
        if not text or not _looks_like_bubble_name(text):
            continue
        if _looks_like_chat_list_row(text):
            continue
        msg = _parse_bubble(text, chat_name=chat_name)
        if not msg:
            continue
        key = f"{msg.direction}|{msg.time}|{msg.sender}|{msg.text}".lower()
        if key in seen:
            continue
        seen.add(key)
        messages.append(msg)

    if not messages:
        return DialogueExtract(
            messages=[],
            note=(
                "В открытом чате не удалось разобрать пузырьки сообщений из UIA. "
                "Либо чат не открыт, либо на экране только список чатов, либо "
                "история не отдана accessibility-слоем."
            ),
        )

    hist_n = len(dump.history_text) if dump is not None else 0
    return DialogueExtract(
        messages=messages,
        note=(
            f"Извлечено видимых сообщений: {len(messages)} "
            f"(history_text={hist_n}; порядок как в потоке UIA)."
        ),
    )


def _dedupe_prefer_longer(texts: list[str]) -> list[str]:
    """Keep stream order; drop a text if a longer bubble already covers it."""
    cleaned = [t.strip() for t in texts if t and t.strip()]
    # First pass: unique exact
    seen: set[str] = set()
    exact: list[str] = []
    for t in cleaned:
        if t in seen:
            continue
        seen.add(t)
        exact.append(t)

    # Drop short fragments that are substrings of a longer bubble nearby
    bubbles = [t for t in exact if _looks_like_bubble_name(t)]
    out: list[str] = []
    for t in exact:
        if not _looks_like_bubble_name(t) and any(t in b and t != b for b in bubbles):
            # keep structured short labels only if not pure message duplicates
            if t.lower() in {"просмотрено", "отправлено", "получено", "сообщение", "отправитель"}:
                continue
        out.append(t)
    return out


def _looks_like_bubble_name(text: str) -> bool:
    low = text.lower()
    return ("отправлено" in low or "получено" in low) and len(text) > 20


def _candidate_names_from_nodes(nodes: list[UiNodeSummary]) -> list[str]:
    out: list[str] = []
    for node in nodes:
        name = (node.name or "").strip()
        if not name or len(name) < 8:
            continue
        ct = (node.control_type or "").lower()
        if ct in {"listitem", "text", "group", "custom", "dataitem"} or "отправл" in name.lower() or "получен" in name.lower():
            out.append(name)
    return out


def _looks_like_chat_list_row(text: str) -> bool:
    low = text.lower()
    if low.count(",") >= 2 and any(h in low for h in _CHAT_LIST_HINTS):
        # Open-chat bubbles rarely use this comma-separated pinned preview format.
        if "отправлено" not in low and "получено в" not in low and not re.search(r"получено\s+в\s+", low):
            return True
        # "Name, Premium, preview, Получено, в 18:12" — chat list
        if low.count(",") >= 3:
            return True
    return False


def _parse_bubble(text: str, chat_name: str | None = None) -> ChatMessage | None:
    # Keep Telegram quote markers ⁨…⁩ for reply parsing; strip only RTL/LTR marks.
    cleaned = re.sub(r"[\u200e\u200f]", "", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 10:
        return None
    if cleaned.lower() in CHROME_LABELS:
        return None

    m = None
    # Anchor sender to known peer name / "Меня" to avoid splitting "Имя Фамилия ..."
    if chat_name:
        esc = re.escape(_normalize_text(chat_name))
        anchored = re.compile(
            rf"^(?:Просмотрено\s+)?(?P<sender>Меня|{esc})\s+"
            rf"(?:Ответ для\s+(?P<reply_to>.+?):\s*⁨(?P<quote>.*?)⁩\s+)?"
            rf"(?P<body>.*?)\s+{_TIME_TAIL}",
            re.IGNORECASE | re.DOTALL,
        )
        m = anchored.match(cleaned) or anchored.match(_normalize_text(cleaned))
        media_anchored = re.compile(
            rf"^(?:Просмотрено\s+)?(?P<sender>Меня|{esc})\s+"
            rf"(?P<body>(?:Фотография|Видео|Голосовое сообщение|Файл|Стикер|GIF)"
            rf"(?:,\s*[\d×x]+)?(?:\s+.+)?)\s+{_TIME_TAIL}",
            re.IGNORECASE | re.DOTALL,
        )
        m = m or media_anchored.match(_normalize_text(cleaned))

    m = (
        m
        or _BUBBLE_REPLY_RE.match(cleaned)
        or _MEDIA_RE.match(_normalize_text(cleaned))
        or _BUBBLE_RE.match(_normalize_text(cleaned))
    )
    if not m:
        return None

    sender = _clean_sender(m.group("sender"))
    body = _clean_body(m.group("body"))
    direction_raw = m.group("direction").lower()
    time_s = (m.group("time") or "").strip()
    reply_to = ""
    quote = ""
    groups = m.groupdict()
    if groups.get("reply_to"):
        reply_to = _normalize_text(groups.get("reply_to") or "")
        quote = _normalize_text(groups.get("quote") or "")

    if not body and not quote:
        return None

    # Filter false positives from chrome concatenations
    if sender.lower() in CHROME_LABELS and sender != "Меня":
        return None
    if body.lower() in CHROME_LABELS:
        return None

    direction = "outgoing" if direction_raw.startswith("отправл") else "incoming"
    if sender.lower() in {"меня", "me", "you"}:
        direction = "outgoing"
        sender = "Я"
    elif chat_name and _norm_name(sender) == _norm_name(chat_name):
        direction = "incoming"

    media = ""
    if re.match(r"(?i)^(фотография|видео|голосовое|файл|стикер|gif)", body):
        media = body
        # Keep caption after media marker if present
        parts = body.split(" ", 1)
        if len(parts) > 1 and not re.match(r"(?i)^\d", parts[1]) and "×" not in parts[1][:12]:
            # e.g. "Фотография, 720×1280 А вот этот?"
            maybe = re.sub(
                r"(?i)^(фотография|видео|голосовое сообщение|файл|стикер|gif)(?:,\s*[\d×x]+)?\s*",
                "",
                body,
            ).strip()
            body = maybe or body

    return ChatMessage(
        sender=sender,
        text=body,
        direction=direction,
        time=time_s,
        reply_to=reply_to,
        quote=quote,
        media=media,
        raw=cleaned,
    )


def _order_by_source(messages: list[ChatMessage], source_texts: list[str]) -> list[ChatMessage]:
    """
    Order messages top→bottom as in the chat (older→newer).

    Only exact/full-bubble matches — never match short labels like «Просмотрено»,
    otherwise all outgoing bubbles collapse to one early index.
    """
    normalized_sources = [_normalize_text(t) for t in source_texts]
    used: set[int] = set()

    def position(msg: ChatMessage) -> int:
        raw = _normalize_text(msg.raw)
        if not raw:
            return 10_000
        # 1) exact raw match
        for idx, src in enumerate(normalized_sources):
            if idx in used:
                continue
            if src == raw:
                used.add(idx)
                return idx
        # 2) full bubble source contains unique body+time (body must be long enough)
        needle = _normalize_text(f"{msg.text} {msg.time}".strip())
        if msg.text and len(msg.text) >= 2 and msg.time:
            for idx, src in enumerate(normalized_sources):
                if idx in used:
                    continue
                if len(src) < 20:
                    continue
                if ("отправлено" in src or "получено" in src) and needle in src:
                    used.add(idx)
                    return idx
        return 10_000

    indexed = [(position(m), i, m) for i, m in enumerate(messages)]
    indexed.sort(key=lambda t: (t[0], t[1]))
    return [m for _, _, m in indexed]


def _normalize_text(text: str) -> str:
    text = (text or "").replace("\u200e", "").replace("\u200f", "")
    text = text.replace("⁨", "").replace("⁩", "")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _clean_sender(sender: str) -> str:
    sender = _normalize_text(sender)
    sender = re.sub(r"^(Просмотрено|Отправитель)\s+", "", sender, flags=re.IGNORECASE)
    return sender.strip(" ,;—–-")


def _clean_body(body: str) -> str:
    body = _normalize_text(body)
    body = re.sub(r"^(Сообщение|Текст)\s+", "", body, flags=re.IGNORECASE)
    return body.strip()


def _norm_name(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())
