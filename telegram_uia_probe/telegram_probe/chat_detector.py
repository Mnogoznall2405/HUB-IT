"""Heuristics to guess open chat name from UIA dump + window title."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Any, Iterable

from .models import UiNodeSummary
from .profile import TELEGRAM, MessengerProfile
from .uia_tree import UiDump

# Common messenger chrome / system labels to ignore as chat titles.
IGNORE_EXACT = {
    "",
    "telegram",
    "telegram desktop",
    "max",
    "max messenger",
    "веб-версия max",
    "search",
    "поиск",
    "поиск сообщений",
    "menu",
    "меню",
    "меню чата",
    "главное меню",
    "settings",
    "настройки",
    "archived chats",
    "архив",
    "archived",
    "contacts",
    "контакты",
    # "saved messages" / "избранное" — реальный чат, не chrome
    "new message",
    "новое сообщение",
    "write a message...",
    "write a message…",
    "написать сообщение...",
    "написать сообщение…",
    "type a message",
    "сообщение...",
    "online",
    "offline",
    "в сети",
    "last seen recently",
    "был(а) недавно",
    "typing...",
    "печатает...",
    "mute",
    "unmute",
    "pin",
    "delete",
    "forward",
    "reply",
    "edit",
    "copy",
    "send",
    "attach",
    "emoji",
    "свернуть",
    "развернуть",
    "закрыть",
    "папки",
    "личные",
    "работа",
    "новости",
    "все чаты",
    "чаты",
    "ред.",
    "звонок",
    "информация",
    "сообщения",
    "добавить вложение",
    "запись голосового сообщения",
}

IGNORE_CONTAINS = (
    "telegram desktop",
    "непрочитан",
    "qt515",
    "qt6",
    "msctls_",
    "intermediate d3d",
)

# "‎Камчатка Сергей Айтишник – (11350)" or "Name — Telegram"
TITLE_PEER_RE = re.compile(
    r"^\u200e?(?P<chat>.+?)\s*[—\-–]\s*(?:\((?P<code>\d+)\)|Telegram.*)\s*$",
    re.IGNORECASE,
)
TITLE_GENERIC_RE = re.compile(r"^(?:Telegram(?:\s+Desktop)?)(?:\s*\(\d+\))?$", re.IGNORECASE)


@dataclass
class ChatGuess:
    chat_name: str | None
    confidence: float
    note: str
    evidence: list[str]


_MAX_MEDIA_PLACEHOLDERS = frozenset(
    {
        "[photo]",
        "[video]",
        "фото",
        "видео",
        "+фото",
        "++2 фото",
        "**аудиосообщение",
    }
)


def max_chat_fingerprint(texts: Iterable[str]) -> str:
    """
    Stable-enough id when MAX hides the peer name in UIA.

    Anchors on the oldest distinctive visible texts so new outgoing bubbles at
    the bottom do not rename the chat. Peer display name is left to screenshots.
    """
    parts: list[str] = []
    for raw in texts:
        norm = _normalize(str(raw or ""))
        if not norm or norm in _MAX_MEDIA_PLACEHOLDERS:
            continue
        if len(norm) < 3:
            continue
        parts.append(norm[:160])
        if len(parts) >= 4:
            break
    if not parts:
        for raw in texts:
            norm = _normalize(str(raw or ""))
            if norm:
                parts.append(norm[:80])
            if len(parts) >= 2:
                break
    if not parts:
        return ""
    digest = hashlib.sha1("|".join(parts).encode("utf-8")).hexdigest()
    return digest[:8]


def anonymous_max_chat_name(texts: Iterable[str]) -> str | None:
    fp = max_chat_fingerprint(texts)
    if not fp:
        return None
    return f"MAX · {fp}"


def detect_max_open_chat(
    hwnd: int,
    *,
    history_texts: list[str] | None = None,
) -> ChatGuess:
    """
    MAX Desktop keeps window title as bare ``MAX``.

    Prefer the HistoryPanel header name; if UIA leaves it empty, match the first
    visible history text against sidebar chat previews. Never reuse a single
    shared placeholder — that merges unrelated dialogs.
    """
    evidence: list[str] = []
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        return ChatGuess(None, 0.0, f"pywinauto unavailable: {exc}", evidence)

    # Reuse the same HistoryListView discovery path as history_reader.
    from .history_reader import _find_history_list
    from .profile import MAX as MAX_PROFILE

    try:
        root = Desktop(backend="uia").window(handle=int(hwnd)).wrapper_object()
    except Exception as exc:  # noqa: BLE001
        return ChatGuess(None, 0.0, f"MAX hwnd connect failed: {exc}", evidence)

    history_list = _find_history_list(root, profile=MAX_PROFILE)
    header_name = ""
    collected_texts: list[str] = list(history_texts or [])
    search_roots: list[Any] = []
    if history_list is not None:
        evidence.append("history_list:HistoryListView")
        try:
            parent = history_list.parent()
        except Exception:
            parent = None
        search_roots.append(parent or history_list)
        search_roots.append(history_list)
    else:
        evidence.append("history_list:missing")
        # Newer MAX QML builds often omit HistoryListView from UIA — scan whole window.
        search_roots.append(root)

    for header_root in search_roots:
        try:
            for el in header_root.descendants():
                try:
                    cn = str(getattr(el.element_info, "class_name", "") or "")
                    name = _strip_marks(str(getattr(el.element_info, "name", "") or ""))
                except Exception:
                    continue
                if (
                    "MeVerificatableName" in cn
                    and "QML_536" not in cn
                    and name
                    and _normalize(name) not in IGNORE_EXACT
                ):
                    header_name = name
                    evidence.append(f"history_header:{name}")
                    break
                if "MessageTextItem" in cn and name:
                    collected_texts.append(name)
            if header_name:
                break
        except Exception:
            pass

    sidebar: list[tuple[str, str]] = []
    try:
        for el in root.descendants():
            try:
                cn = str(getattr(el.element_info, "class_name", "") or "")
                name = _strip_marks(str(getattr(el.element_info, "name", "") or ""))
            except Exception:
                continue
            if "ChatDelegate" not in cn or not name:
                continue
            if _normalize(name) in IGNORE_EXACT:
                continue
            preview = ""
            try:
                for ch in el.descendants():
                    try:
                        ccn = str(getattr(ch.element_info, "class_name", "") or "")
                        cname = _strip_marks(str(getattr(ch.element_info, "name", "") or ""))
                    except Exception:
                        continue
                    if "TextWithSmallPreviews" in ccn and cname:
                        preview = cname
                        break
            except Exception:
                pass
            sidebar.append((name, preview))
    except Exception:
        pass

    if header_name and _normalize(header_name) not in IGNORE_EXACT:
        return ChatGuess(
            header_name,
            0.9,
            "Чат MAX определён по заголовку HistoryPanel.",
            evidence,
        )

    for hist in collected_texts[:8]:
        hist_norm = _normalize(hist)
        if len(hist_norm) < 4:
            continue
        for chat, preview in sidebar:
            prev_norm = _normalize(preview)
            if not prev_norm:
                continue
            prev_compact = re.sub(r"^[\+\-]\s*", "", prev_norm)
            prev_compact = re.sub(r"^[^\s:]{1,40}:\s*", "", prev_compact)
            if (
                hist_norm in prev_norm
                or prev_norm in hist_norm
                or hist_norm in prev_compact
                or prev_compact in hist_norm
            ):
                evidence.append(f"preview_match:{chat}")
                return ChatGuess(
                    chat,
                    0.78,
                    "Чат MAX сопоставлен по превью в списке диалогов.",
                    evidence,
                )

    anon = anonymous_max_chat_name(collected_texts)
    if anon:
        evidence.append(f"fingerprint:{anon}")
        return ChatGuess(
            anon,
            0.55,
            "Имя собеседника в UIA пустое — чат разведён по отпечатку истории; кто это видно на скрине.",
            evidence + [f"history_texts={len(collected_texts)}", f"sidebar={len(sidebar)}"],
        )

    return ChatGuess(
        None,
        0.0,
        "История MAX пуста — имя чата не сформировать.",
        evidence + [f"sidebar={len(sidebar)}"],
    )


def detect_chat(
    window_title: str,
    dump: UiDump,
    *,
    profile: MessengerProfile | None = None,
) -> ChatGuess:
    """
    Best-effort chat name detection.

    For Telegram Desktop the window title is the strongest signal:
    `Peer Name – (NNNN)`. MAX/desktop may use a plain peer title.
    """
    messenger = profile or TELEGRAM
    title = _strip_marks(window_title or "")
    evidence: list[str] = []

    title_guess = _from_window_title(title, profile=messenger)
    if title_guess:
        evidence.append(f"window_title:{title_guess}")

    header_guess, header_score, header_note = _from_ui_header(dump.nodes)
    if header_guess:
        evidence.append(f"uia_header:{header_guess}")

    # Strong title like "Name – (11350)" wins over chrome UIA buttons ("Главное меню").
    if title_guess and _title_looks_like_peer(title, profile=messenger):
        conf = 0.92
        note = (
            f"Чат определён по заголовку окна {messenger.display_name} "
            "(имя собеседника)."
        )
        if header_guess and _normalize(header_guess) == _normalize(title_guess):
            conf = 0.96
            note = "Заголовок окна и UIA совпадают."
        elif header_guess and _normalize(header_guess) in IGNORE_EXACT:
            note += f" UIA-кандидат «{header_guess}» отклонён как элемент интерфейса."
        return ChatGuess(title_guess, conf, note, evidence)

    if dump.error and not dump.nodes:
        note = (
            f"UI Automation дерево недоступно ({dump.error}). "
            "Название чата по UIA определить нельзя."
        )
        if title_guess:
            return ChatGuess(title_guess, 0.45, note + " Использован заголовок окна.", evidence)
        return ChatGuess(None, 0.0, note, evidence)

    if not dump.visible_text and not dump.raw_names:
        note = (
            f"{messenger.display_name} не отдал видимый текст через UI Automation "
            f"(backend={dump.backend}, nodes={len(dump.nodes)}). "
            "Дерево элементов сохранено для анализа."
        )
        if title_guess:
            return ChatGuess(
                title_guess,
                0.4,
                note + " Предположение только по заголовку окна.",
                evidence,
            )
        return ChatGuess(None, 0.0, note, evidence)

    if header_guess and title_guess:
        if _normalize(header_guess) == _normalize(title_guess):
            return ChatGuess(
                header_guess,
                min(0.9, 0.55 + header_score),
                "Совпадение заголовка окна и UIA-заголовка чата.",
                evidence,
            )
        if TITLE_GENERIC_RE.match(title) or _normalize(title).startswith("telegram"):
            return ChatGuess(
                header_guess,
                min(0.85, 0.5 + header_score),
                header_note or "Чат определён по UIA-заголовку (окно без имени чата).",
                evidence,
            )
        # Prefer informative window title over chrome-like UIA
        if _normalize(header_guess) in IGNORE_EXACT:
            return ChatGuess(
                title_guess,
                0.75,
                "UIA вернул элемент интерфейса; выбран заголовок окна.",
                evidence,
            )
        return ChatGuess(
            title_guess,
            0.7,
            f"Заголовок окна предпочтён UIA-кандидату «{header_guess}» ({header_note}).",
            evidence,
        )

    if header_guess and _normalize(header_guess) not in IGNORE_EXACT:
        return ChatGuess(
            header_guess,
            min(0.8, 0.45 + header_score),
            header_note or "Чат определён эвристикой по UIA.",
            evidence,
        )

    if title_guess:
        return ChatGuess(
            title_guess,
            0.55,
            "UIA не дал явного заголовка чата; использован заголовок окна.",
            evidence,
        )

    return ChatGuess(
        None,
        0.0,
        (
            "Не удалось определить название чата: заголовок окна неинформативен, "
            f"а UIA не содержит распознаваемого заголовка (nodes={len(dump.nodes)}, "
            f"visible_text={len(dump.visible_text)}). Дерево сохранено."
        ),
        evidence,
    )


def normalize_chat_display_name(name: str) -> str:
    """Strip LTR marks, unread badges and trailing Telegram peer codes."""
    chat = _strip_marks(name or "")
    # Telegram sometimes prefixes unread count: "(1) Name – (12345)"
    chat = re.sub(r"^\(\d{1,4}\)\s+", "", chat).strip()
    # Stable id: "Избранное – (9579)" / "Name — (11350)" → "Избранное" / "Name"
    chat = re.sub(r"\s*[—\-–]\s*\(\d+\)\s*$", "", chat).strip()
    return chat


def _from_window_title(
    title: str,
    *,
    profile: MessengerProfile | None = None,
) -> str | None:
    messenger = profile or TELEGRAM
    if not title:
        return None
    if TITLE_GENERIC_RE.match(title):
        return None
    if _normalize(title) in messenger.ignore_title_exact or _normalize(title) in IGNORE_EXACT:
        return None
    m = TITLE_PEER_RE.match(title)
    if m:
        chat = normalize_chat_display_name(m.group("chat"))
        if _normalize(chat) not in IGNORE_EXACT and not any(
            x in _normalize(chat) for x in IGNORE_CONTAINS
        ):
            return chat
    # Fallback: strip trailing messenger suffix (Telegram/MAX)
    m2 = re.match(
        r"^\u200e?(?P<chat>.+?)(?:\s+[—\-–]\s+(?:Telegram|MAX).*"
        r"|\s+\|\s+(?:Telegram|MAX).*)?$",
        title,
        flags=re.IGNORECASE,
    )
    if not m2:
        return None
    chat = normalize_chat_display_name(m2.group("chat"))
    norm = _normalize(chat)
    if (
        norm in IGNORE_EXACT
        or norm in messenger.ignore_title_exact
        or norm.startswith("telegram")
        or norm.startswith("max")
    ):
        return None
    if any(x in norm for x in IGNORE_CONTAINS):
        return None
    # Reject bare "Telegram (11350)" already handled; reject too generic short chrome
    if len(chat) < 2:
        return None
    return chat


def _title_looks_like_peer(
    title: str,
    *,
    profile: MessengerProfile | None = None,
) -> bool:
    messenger = profile or TELEGRAM
    cleaned = _strip_marks(title)
    if TITLE_PEER_RE.match(cleaned):
        return True
    # Desktop MAX often uses a plain peer name as the window title.
    if messenger.key == "max":
        guess = _from_window_title(cleaned, profile=messenger)
        return bool(guess)
    return False


def _from_ui_header(nodes: list[UiNodeSummary]) -> tuple[str | None, float, str]:
    """
    Look for likely chat title near the top of the right pane / window header.
    """
    candidates: list[tuple[float, str, str]] = []

    for idx, node in enumerate(nodes[:400]):
        name = _strip_marks(node.name or "")
        if not name or len(name) < 2 or len(name) > 80:
            continue
        norm = _normalize(name)
        if norm in IGNORE_EXACT:
            continue
        if any(x in norm for x in IGNORE_CONTAINS):
            continue
        if _looks_message_bubble(name):
            continue
        if _looks_timestamp(name):
            continue
        if re.fullmatch(r"[\d\s:\.]+", name):
            continue
        # Sidebar folder labels etc.
        if (node.control_type or "").lower() == "button" and norm in {
            "главное меню",
            "поиск",
            "ред.",
        }:
            continue

        ct = (node.control_type or "").lower()
        score = 0.2
        note = "generic_name"

        if node.depth <= 4:
            score += 0.15
            note = "shallow_node"
        # Prefer Text over Button (buttons are often chrome)
        if ct == "text":
            score += 0.35
            note = "text_control"
        elif ct == "listitem":
            score += 0.1
            note = "listitem_control"
        elif ct == "button":
            score -= 0.25
            note = "button_control"
        if ct == "text" and node.depth <= 6:
            score += 0.15
            note = "headerish_text"
        if idx < 40 and ct in {"text", "custom", "group"}:
            score += 0.1

        if re.search(r"[.!?…]{2,}", name):
            score -= 0.3
        if " " in name and len(name.split()) <= 5:
            score += 0.1

        candidates.append((score, name, note))

    if not candidates:
        return None, 0.0, "no_header_candidates"

    candidates.sort(key=lambda x: x[0], reverse=True)
    best_score, best_name, best_note = candidates[0]
    if best_score < 0.35:
        return None, best_score, "low_confidence_candidates"
    return best_name, best_score, best_note


def _looks_message_bubble(text: str) -> bool:
    low = text.lower()
    if "отправлено" in low or "получено" in low:
        return True
    if len(text) > 60:
        return True
    if text.count(" ") >= 8:
        return True
    return False


def _looks_timestamp(text: str) -> bool:
    return bool(
        re.fullmatch(
            r"(?:\d{1,2}:\d{2}(?:\s*[AP]M)?|\d{1,2}\.\d{1,2}\.\d{2,4}|сегодня|вчера|today|yesterday)",
            text.strip(),
            flags=re.IGNORECASE,
        )
    )


def _strip_marks(text: str) -> str:
    return (
        (text or "")
        .replace("\u200e", "")
        .replace("\u200f", "")
        .replace("⁨", "")
        .replace("⁩", "")
        .strip()
    )


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", _strip_marks(text).lower())
