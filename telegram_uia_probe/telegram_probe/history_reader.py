"""Read open-chat messages directly from Telegram HistoryInner (UIA List)."""

from __future__ import annotations

import logging
import re
from datetime import date, timedelta
from typing import Any

from .message_parser import ChatMessage, DialogueExtract, _parse_bubble
from .profile import TELEGRAM, MessengerProfile

logger = logging.getLogger(__name__)

_MONTHS_RU = {
    "января": 1,
    "февраля": 2,
    "марта": 3,
    "апреля": 4,
    "мая": 5,
    "июня": 6,
    "июля": 7,
    "августа": 8,
    "сентября": 9,
    "октября": 10,
    "ноября": 11,
    "декабря": 12,
}
_WEEKDAYS_RU = (
    "понедельник",
    "вторник",
    "среда",
    "среду",
    "четверг",
    "пятница",
    "пятницу",
    "суббота",
    "субботу",
    "воскресенье",
)


def read_history_messages(
    hwnd: int,
    chat_name: str | None = None,
    profile: MessengerProfile | None = None,
) -> DialogueExtract:
    """
    Read ListItem children of the messenger history list in DOM order.

    This preserves who-wrote-after-whom and keeps newest items at the end
    (bottom of the visible history window).
    """
    profile = profile or TELEGRAM
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        logger.warning("pywinauto unavailable (%s) — fallback uiautomation", exc)
        return _read_history_via_uiautomation(hwnd, chat_name=chat_name, profile=profile)

    try:
        desktop = Desktop(backend="uia")
        root = desktop.window(handle=hwnd).wrapper_object()
    except ModuleNotFoundError as exc:
        # Typical frozen-build gap: comtypes.stream not packaged.
        logger.warning("pywinauto UIA connect failed (%s) — fallback uiautomation", exc)
        return _read_history_via_uiautomation(hwnd, chat_name=chat_name, profile=profile)
    except Exception as exc:  # noqa: BLE001
        logger.warning("pywinauto connect_failed (%s) — fallback uiautomation", exc)
        return _read_history_via_uiautomation(hwnd, chat_name=chat_name, profile=profile)

    history_list = _find_history_list(root, profile=profile)
    if history_list is None:
        logger.info("History list not found via pywinauto — fallback uiautomation")
        via_auto = _read_history_via_uiautomation(hwnd, chat_name=chat_name, profile=profile)
        if via_auto.messages:
            return via_auto
        if profile.key == "max":
            # QML MAX often hides HistoryListView; collect delegates from whole tree.
            via_tree = _read_max_history_from_tree_pywinauto(root, chat_name=chat_name)
            if via_tree.messages:
                return via_tree
        return DialogueExtract(
            messages=[],
            note=f"Список сообщений {profile.display_name} не найден — чат может быть не открыт.",
        )

    try:
        items = list(history_list.children())
    except Exception as exc:  # noqa: BLE001
        return DialogueExtract(messages=[], note=f"history_children_failed: {exc}")

    if profile.key == "max":
        extracted = _read_max_history_items(items, chat_name=chat_name)
        if extracted.messages:
            return extracted
        # List shell found but empty — try tree-wide MessageDelegate harvest.
        via_tree = _read_max_history_from_tree_pywinauto(root, chat_name=chat_name)
        if via_tree.messages:
            return via_tree
        return extracted

    messages: list[ChatMessage] = []
    raw_names: list[str] = []
    day_ctx: dict[str, str] = {"chat_date": "", "day_label": ""}
    for item in items:
        try:
            name = item.element_info.name or ""
        except Exception:
            try:
                name = item.window_text() or ""
            except Exception:
                name = ""
        name = str(name).strip()
        if not name:
            continue
        raw_names.append(name)
        sep = parse_day_separator(name)
        if sep is not None:
            day_ctx["chat_date"] = sep[0]
            day_ctx["day_label"] = sep[1]
            continue
        # Keep newlines for structured parse; also provide flat form.
        msg = _parse_history_item(name, chat_name=chat_name)
        if msg:
            msg.bbox = _item_bbox(item)
            _stamp_message_day(msg, day_ctx)
            messages.append(msg)

    if not messages:
        return DialogueExtract(
            messages=[],
            note=(
                f"HistoryInner найден ({len(items)} элементов), но пузырьки не разобраны. "
                "Сырые имена сохранены в note/details."
            ),
        )

    return DialogueExtract(
        messages=messages,
        note=(
            f"Диалог из HistoryInner: {len(messages)} сообщ. "
            f"(элементов списка: {len(items)}; порядок сверху вниз = старые → новые)."
        ),
    )


def _read_history_via_uiautomation(
    hwnd: int,
    chat_name: str | None = None,
    profile: MessengerProfile | None = None,
) -> DialogueExtract:
    """Fallback history reader via ``uiautomation`` (no comtypes.stream)."""
    profile = profile or TELEGRAM
    try:
        import uiautomation as auto
    except ImportError as exc:
        return DialogueExtract(messages=[], note=f"uiautomation_missing: {exc}")

    try:
        root = auto.ControlFromHandle(int(hwnd))
    except Exception as exc:  # noqa: BLE001
        return DialogueExtract(messages=[], note=f"uiautomation_connect_failed: {exc}")

    history_list = None
    candidate_names = []
    for raw in profile.history_list_names:
        candidate_names.extend({raw, raw.capitalize(), raw.title()})
    # Prefer known Russian/English labels first.
    for list_name in ("Сообщения", "Messages", *sorted(candidate_names)):
        try:
            candidate = root.ListControl(Name=list_name, searchDepth=20)
            if candidate and candidate.Exists(0, 0):
                history_list = candidate
                break
        except Exception:
            continue
    if history_list is None:
        history_list = _find_history_list_uiautomation(root, profile=profile)
    if history_list is None:
        if profile.key == "max":
            via_tree = _read_max_history_from_tree_uiautomation(root, chat_name=chat_name)
            if via_tree.messages:
                return via_tree
        return DialogueExtract(
            messages=[],
            note=(
                f"Список сообщений {profile.display_name} не найден (uiautomation) "
                "— чат может быть не открыт."
            ),
        )

    try:
        items = list(history_list.GetChildren())
    except Exception as exc:  # noqa: BLE001
        return DialogueExtract(messages=[], note=f"history_children_failed: {exc}")

    if profile.key == "max":
        extracted = _read_max_history_items(
            items, chat_name=chat_name, backend="uiautomation"
        )
        if extracted.messages:
            return extracted
        via_tree = _read_max_history_from_tree_uiautomation(root, chat_name=chat_name)
        if via_tree.messages:
            return via_tree
        return extracted

    messages: list[ChatMessage] = []
    day_ctx: dict[str, str] = {"chat_date": "", "day_label": ""}
    for item in items:
        try:
            name = str(item.Name or "").strip()
        except Exception:
            name = ""
        if not name:
            continue
        sep = parse_day_separator(name)
        if sep is not None:
            day_ctx["chat_date"] = sep[0]
            day_ctx["day_label"] = sep[1]
            continue
        msg = _parse_history_item(name, chat_name=chat_name)
        if not msg:
            continue
        try:
            rect = item.BoundingRectangle
            msg.bbox = (
                int(rect.left),
                int(rect.top),
                int(rect.right),
                int(rect.bottom),
            )
        except Exception:
            pass
        _stamp_message_day(msg, day_ctx)
        messages.append(msg)

    if not messages:
        return DialogueExtract(
            messages=[],
            note=(
                f"HistoryInner найден через uiautomation ({len(items)} элементов), "
                "но пузырьки не разобраны."
            ),
        )

    return DialogueExtract(
        messages=messages,
        note=(
            f"Диалог из HistoryInner (uiautomation): {len(messages)} сообщ. "
            f"(элементов списка: {len(items)})."
        ),
    )


def _history_class_match(class_name: str, profile: MessengerProfile) -> bool:
    blob = (class_name or "").lower()
    return any(needle in blob for needle in profile.history_class_needles)


def _history_name_match(name: str, profile: MessengerProfile) -> bool:
    return (name or "").strip().lower() in profile.history_list_names


def _find_history_list_uiautomation(
    root: Any,
    max_depth: int = 14,
    profile: MessengerProfile | None = None,
) -> Any | None:
    profile = profile or TELEGRAM
    stack: list[tuple[Any, int]] = [(root, 0)]
    seen: set[int] = set()
    fallback = None
    list_fallback = None

    while stack:
        el, depth = stack.pop()
        if depth > max_depth:
            continue
        try:
            ident = int(el.NativeWindowHandle) if el.NativeWindowHandle else id(el)
        except Exception:
            ident = id(el)
        if ident in seen:
            continue
        seen.add(ident)

        try:
            class_name = str(el.ClassName or "")
            name = str(el.Name or "")
            control_type = str(getattr(el, "ControlTypeName", "") or "")
        except Exception:
            class_name, name, control_type = "", "", ""

        cn_low = class_name.lower()
        ct_low = control_type.lower()
        if "historyinner" in cn_low or "historylistview" in cn_low:
            return el
        if _history_name_match(name, profile) and "list" in ct_low:
            return el
        if _history_class_match(class_name, profile) and (
            "list" in ct_low or "listview" in cn_low or "historylist" in cn_low
        ):
            return el
        if any(
            n in cn_low
            for n in ("historywidget", "conversation", "chatview", "chatbackground", "historypanel")
        ):
            fallback = el
        if "list" in ct_low and "dialogs" not in cn_low and list_fallback is None:
            list_fallback = el

        try:
            children = list(el.GetChildren())
        except Exception:
            children = []

        children_sorted = sorted(
            children,
            key=lambda ch: (
                3
                if "history" in str(getattr(ch, "ClassName", "") or "").lower()
                or "message" in str(getattr(ch, "ClassName", "") or "").lower()
                else 2
                if "mainwidget" in str(getattr(ch, "ClassName", "") or "").lower()
                or "rpwidget" in str(getattr(ch, "ClassName", "") or "").lower()
                else 0
                if "dialogs" in str(getattr(ch, "ClassName", "") or "").lower()
                else 1
            ),
        )
        for ch in children_sorted:
            stack.append((ch, depth + 1))

    if fallback is not None:
        try:
            for ch in fallback.GetChildren():
                cn = str(getattr(ch, "ClassName", "") or "").lower()
                ct = str(getattr(ch, "ControlTypeName", "") or "").lower()
                nm = str(getattr(ch, "Name", "") or "")
                if "historyinner" in cn or (
                    _history_name_match(nm, profile) and "list" in ct
                ):
                    return ch
                # ElasticScroll often wraps HistoryInner.
                try:
                    for nested in ch.GetChildren():
                        ncn = str(getattr(nested, "ClassName", "") or "").lower()
                        if "historyinner" in ncn:
                            return nested
                except Exception:
                    pass
        except Exception:
            pass
    return list_fallback


def _find_history_list(
    root: Any,
    max_depth: int = 14,
    profile: MessengerProfile | None = None,
) -> Any | None:
    """Find messenger history list control.

    Prefer HistoryInner / «Сообщения» List. Do NOT return HistoryWidget itself —
    on modern Telegram it is a shell (top bar + ElasticScroll + compose) whose
    direct children are chrome, not message bubbles.
    """
    profile = profile or TELEGRAM
    stack: list[tuple[Any, int]] = [(root, 0)]
    seen: set[int] = set()
    widget_fallback = None
    scored: list[tuple[int, Any]] = []

    while stack:
        el, depth = stack.pop()
        if depth > max_depth:
            continue
        try:
            ident = id(el.element_info.element)
        except Exception:
            ident = id(el)
        if ident in seen:
            continue
        seen.add(ident)

        try:
            class_name = str(el.element_info.class_name or "")
            name = str(el.element_info.name or "")
            control_type = str(el.element_info.control_type or "")
        except Exception:
            class_name, name, control_type = "", "", ""

        cn_low = class_name.lower()
        ct_low = control_type.lower()
        score = 0
        if "historyinner" in cn_low or "historylistview" in cn_low:
            score = 100
        elif _history_name_match(name, profile) and "list" in ct_low:
            score = 90
        elif "list" in ct_low and "history" in cn_low:
            score = 80
        elif _history_class_match(class_name, profile) and (
            "list" in ct_low or "listview" in cn_low or "historylist" in cn_low
        ):
            score = 85
        elif "historypanel" in cn_low or "chatbackground" in cn_low:
            score = 40
        if score:
            scored.append((score, el))
        if (
            "historywidget" in cn_low
            or "conversation" in cn_low
            or "chatview" in cn_low
            or "historypanel" in cn_low
            or "chatbackground" in cn_low
        ):
            widget_fallback = el

        try:
            children = list(el.children())
        except Exception:
            children = []

        # Push non-dialogs first so we reach History faster (DFS with priority).
        children_sorted = sorted(
            children,
            key=lambda ch: _search_priority(ch),
            reverse=True,  # stack: last pushed popped first → push low priority first
        )
        for ch in children_sorted:
            stack.append((ch, depth + 1))

    if scored:
        scored.sort(key=lambda x: x[0], reverse=True)
        return scored[0][1]

    # Last resort: dig List/HistoryInner under HistoryWidget shell.
    if widget_fallback is not None:
        nested = _history_list_under(widget_fallback, profile=profile)
        if nested is not None:
            return nested
    return None


def _history_list_under(container: Any, *, profile: MessengerProfile) -> Any | None:
    """Find HistoryInner / Messages list under a HistoryWidget-like shell."""
    try:
        descendants = list(container.descendants())
    except Exception:
        try:
            descendants = list(container.children())
        except Exception:
            return None

    best: tuple[int, Any] | None = None
    for el in descendants:
        try:
            class_name = str(el.element_info.class_name or "")
            name = str(el.element_info.name or "")
            control_type = str(el.element_info.control_type or "")
        except Exception:
            continue
        cn_low = class_name.lower()
        ct_low = control_type.lower()
        score = 0
        if "historyinner" in cn_low:
            score = 100
        elif _history_name_match(name, profile) and "list" in ct_low:
            score = 90
        elif "list" in ct_low and "history" in cn_low:
            score = 80
        elif "list" in ct_low:
            # Avoid left chat list: Dialogs::InnerWidget / name «Чаты».
            if "dialogs" in cn_low or (name or "").strip().lower() in {"чаты", "chats"}:
                continue
            score = 40
        if score and (best is None or score > best[0]):
            best = (score, el)
    return best[1] if best else None


def _search_priority(el: Any) -> int:
    try:
        cn = str(el.element_info.class_name or "").lower()
    except Exception:
        cn = ""
    if "history" in cn:
        return 3
    if "mainwidget" in cn or "rpwidget" in cn:
        return 2
    if "dialogs" in cn:
        return 0
    return 1


def _item_bbox(item: Any) -> tuple[int, int, int, int] | None:
    try:
        rect = item.rectangle()
        return int(rect.left), int(rect.top), int(rect.right), int(rect.bottom)
    except Exception:
        try:
            r = item.element_info.rectangle
            return int(r.left), int(r.top), int(r.right), int(r.bottom)
        except Exception:
            try:
                rect = item.BoundingRectangle
                return (
                    int(rect.left),
                    int(rect.top),
                    int(rect.right),
                    int(rect.bottom),
                )
            except Exception:
                return None


def _find_descendant_bbox(
    item: Any,
    *,
    class_needles: tuple[str, ...],
) -> tuple[int, int, int, int] | None:
    """Largest on-screen descendant matching class needles (photo preview)."""
    best: tuple[int, int, int, int] | None = None
    best_area = 0
    for node in _iter_item_descendants(item):
        cn = _item_class_name(node)
        if not any(needle in cn for needle in class_needles):
            continue
        box = _item_bbox(node)
        if not box:
            continue
        area = max(0, box[2] - box[0]) * max(0, box[3] - box[1])
        if area > best_area:
            best_area = area
            best = box
    return best


def _item_class_name(item: Any) -> str:
    try:
        return str(getattr(item.element_info, "class_name", "") or "")
    except Exception:
        pass
    try:
        return str(getattr(item, "ClassName", "") or "")
    except Exception:
        return ""


def _iter_item_descendants(item: Any) -> list[Any]:
    try:
        return list(item.descendants())
    except Exception:
        pass
    out: list[Any] = []
    stack = [item]
    seen: set[int] = set()
    while stack:
        cur = stack.pop()
        try:
            key = id(cur)
        except Exception:
            key = 0
        if key in seen:
            continue
        seen.add(key)
        try:
            children = list(cur.GetChildren())
        except Exception:
            try:
                children = list(cur.children())
            except Exception:
                children = []
        for ch in children:
            out.append(ch)
            stack.append(ch)
    return out


def _descendant_texts(item: Any) -> list[tuple[str, str]]:
    rows: list[tuple[str, str]] = []
    for node in _iter_item_descendants(item):
        try:
            cn = _item_class_name(node)
        except Exception:
            cn = ""
        try:
            name = str(getattr(node.element_info, "name", None) or getattr(node, "Name", "") or "").strip()
        except Exception:
            name = ""
        if cn or name:
            rows.append((cn, name))
    return rows


_TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")
_DURATION_RE = re.compile(r"^\d{1,2}:\d{2}$")
_MAX_FILE_NAME_RE = re.compile(
    r"(?i)^(?P<name>[\w\u0400-\u04FF][\w\-.\u0400-\u04FF ]{0,160}\."
    r"(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|csv|png|jpe?g|gif|webp|"
    r"mp[34]|mkv|avi|mov|msi|exe|apk|json|xml|html?|py|cs|bin|dat|log|md|rtf))$"
)
_MAX_CALL_MARKERS = frozenset(
    {
        "пропущенный вызов",
        "исходящий вызов",
        "входящий вызов",
        "отменённый вызов",
        "отмененный вызов",
        "аудио",
        "видео",
    }
)


def _classify_max_attachment(
    texts: list[tuple[str, str]],
    item: Any,
) -> tuple[str, str, tuple[int, int, int, int] | None]:
    """
    Return (media_kind, display_text, media_bbox).

    media_kind: photo|video|audio|file|'' 
    display_text used when bubble has no MessageTextItem caption.
    """
    classes = " ".join(dcn for dcn, _ in texts)
    names = [name.strip() for _dcn, name in texts if name and name.strip()]

    # Skip pure call bubbles — not file transfers.
    if "CallBubble" in classes:
        return "", "", None

    media = ""
    media_bbox = None
    display = ""

    if any("PreviewCell" in dcn or "RoundedPhoto" in dcn for dcn, _ in texts):
        media = "photo"
        media_bbox = _find_descendant_bbox(
            item, class_needles=("PreviewCell", "RoundedPhoto")
        )
    if "VideoIcon" in classes or "VideoAttachment" in classes:
        media = "video"
        if media_bbox is None:
            media_bbox = _find_descendant_bbox(
                item,
                class_needles=("PreviewCell", "RoundedPhoto", "VideoIcon", "VideoAttachment"),
            )

    if "AudioAttachment" in classes:
        media = "audio"
        dur = next((n for n in names if _DURATION_RE.match(n) and n not in {"00:00"}), "")
        display = f"[audio] {dur}".strip() if dur else "[audio]"
        media_bbox = media_bbox or _find_descendant_bbox(
            item, class_needles=("AudioAttachment",)
        )

    file_class = any(
        x in classes
        for x in (
            "FileAttachment",
            "DocumentAttachment",
            "FileBubble",
            "DocumentBubble",
            "AttachFile",
            "FileContent",
            "DocumentContent",
        )
    )
    file_name = ""
    for name in names:
        m = _MAX_FILE_NAME_RE.match(name)
        if m:
            file_name = m.group("name").strip()
            break
    if file_class or file_name:
        media = "file"
        if file_name:
            display = f"Файл: {file_name}"
        else:
            # Fallback label from non-time / non-chrome texts.
            label = next(
                (
                    n
                    for n in names
                    if n.lower() not in _MAX_CALL_MARKERS
                    and not _TIME_RE.match(n)
                    and n.lower() not in {"переслано:", "переслано"}
                ),
                "",
            )
            display = f"Файл: {label}" if label else "[file]"
        media_bbox = media_bbox or _find_descendant_bbox(
            item,
            class_needles=(
                "FileAttachment",
                "DocumentAttachment",
                "FileBubble",
                "DocumentBubble",
                "PreviewCell",
            ),
        )

    if media == "photo":
        display = display or "[photo]"
    elif media == "video":
        display = display or "[video]"

    return media, display, media_bbox


def _read_max_history_from_tree_pywinauto(
    root: Any,
    *,
    chat_name: str | None = None,
) -> DialogueExtract:
    """Harvest HistoryMessageDelegate / DateSectionDelegate from the whole MAX tree."""
    items: list[Any] = []
    try:
        descendants = list(root.descendants())
    except Exception:
        try:
            descendants = list(root.children())
        except Exception as exc:  # noqa: BLE001
            return DialogueExtract(messages=[], note=f"max_tree_walk_failed: {exc}")
    for el in descendants:
        cn = _item_class_name(el)
        if "HistoryMessageDelegate" in cn or "DateSectionDelegate" in cn:
            items.append(el)
    if not items:
        # Last resort: wrap parents of MessageTextItem as pseudo-delegates.
        for el in descendants:
            cn = _item_class_name(el)
            if "MessageTextItem" not in cn:
                continue
            try:
                parent = el.parent()
            except Exception:
                parent = None
            if parent is not None and parent not in items:
                items.append(parent)
    if not items:
        return DialogueExtract(
            messages=[],
            note="MAX tree: HistoryMessageDelegate/MessageTextItem не найдены в UIA.",
        )
    return _read_max_history_items(items, chat_name=chat_name, backend="pywinauto-tree")


def _read_max_history_from_tree_uiautomation(
    root: Any,
    *,
    chat_name: str | None = None,
) -> DialogueExtract:
    """Same as pywinauto tree harvest, via uiautomation."""
    items: list[Any] = []
    stack: list[tuple[Any, int]] = [(root, 0)]
    seen: set[int] = set()
    text_parents: list[Any] = []
    while stack and len(seen) < 8000:
        el, depth = stack.pop()
        if depth > 20:
            continue
        key = id(el)
        if key in seen:
            continue
        seen.add(key)
        try:
            cn = str(el.ClassName or "")
        except Exception:
            cn = ""
        if "HistoryMessageDelegate" in cn or "DateSectionDelegate" in cn:
            items.append(el)
        elif "MessageTextItem" in cn:
            try:
                parent = el.GetParentControl()
            except Exception:
                parent = None
            if parent is not None:
                text_parents.append(parent)
        try:
            for ch in el.GetChildren() or []:
                stack.append((ch, depth + 1))
        except Exception:
            pass
    if not items and text_parents:
        # Dedup parents
        uniq: list[Any] = []
        seen_p: set[int] = set()
        for p in text_parents:
            k = id(p)
            if k in seen_p:
                continue
            seen_p.add(k)
            uniq.append(p)
        items = uniq
    if not items:
        return DialogueExtract(
            messages=[],
            note="MAX tree(uia): HistoryMessageDelegate/MessageTextItem не найдены.",
        )
    return _read_max_history_items(items, chat_name=chat_name, backend="uiautomation-tree")


def _max_history_visual_sort_key(item: Any) -> tuple[int, int]:
    """
    Visual order in MAX chat: top → bottom = older → newer.

    QML/UIA tree walks often yield delegates bottom-first (newest first),
    which breaks jsonl append order and Hub «last message» previews.
    """
    bbox = _item_bbox(item)
    if bbox is None:
        return (10**9, 10**9)
    left, top, _right, _bottom = bbox
    return (int(top), int(left))


def _read_max_history_items(
    items: list[Any],
    *,
    chat_name: str | None = None,
    backend: str = "pywinauto",
) -> DialogueExtract:
    """MAX Desktop: HistoryListView → HistoryMessageDelegate + MessageTextItem."""
    messages: list[ChatMessage] = []
    day_ctx: dict[str, str] = {"chat_date": "", "day_label": ""}

    # Normalize DOM/tree order to on-screen top→bottom before day stamps + append.
    ordered_items = sorted(items, key=_max_history_visual_sort_key)

    for item in ordered_items:
        cn = _item_class_name(item)
        if "DateSectionDelegate" in cn:
            label = ""
            for _dcn, name in _descendant_texts(item):
                if name:
                    label = name
                    break
            sep = parse_day_separator(label) if label else None
            if sep is not None:
                day_ctx["chat_date"] = sep[0]
                day_ctx["day_label"] = sep[1]
            elif label:
                day_ctx["day_label"] = label
            continue

        texts = _descendant_texts(item)
        # Prefer HistoryMessageDelegate; also accept MessageTextItem nodes/parents
        # when QML hides the list shell from UIA.
        if "HistoryMessageDelegate" not in cn:
            if "MessageTextItem" in cn:
                try:
                    own_name = str(
                        getattr(item.element_info, "name", None)
                        or getattr(item, "Name", "")
                        or ""
                    ).strip()
                except Exception:
                    own_name = ""
                texts = [(cn, own_name)] + texts
            elif not any("MessageTextItem" in dcn for dcn, _ in texts):
                continue
        # Ignore call system bubbles (missed/outgoing call), not file transfers.
        if any("CallBubble" in dcn for dcn, _ in texts):
            continue

        body_parts = [name for dcn, name in texts if name and "MessageTextItem" in dcn]
        time_s = next(
            (name for dcn, name in texts if name and _TIME_RE.match(name) and "MeText" in dcn),
            "",
        )
        if not time_s:
            time_s = next((name for _dcn, name in texts if name and _TIME_RE.match(name)), "")

        media, attach_label, media_bbox = _classify_max_attachment(texts, item)

        text = "\n".join(body_parts).strip()
        if not text and attach_label:
            text = attach_label
        elif not text and media:
            text = f"[{media}]"
        if not text:
            continue

        # Delivery ticks under the bubble ≈ outgoing in current MAX Desktop builds.
        outgoing = any("SvgIcon_QMLTYPE_10_QML_467" in dcn for dcn, _name in texts)
        if not outgoing:
            icon_idxs = [i for i, (dcn, _) in enumerate(texts) if "SvgIcon" in dcn]
            text_idxs = [i for i, (dcn, _) in enumerate(texts) if "MessageTextItem" in dcn]
            if icon_idxs and (not text_idxs or max(icon_idxs) >= min(text_idxs or [0])):
                if icon_idxs:
                    outgoing = True

        direction = "outgoing" if outgoing else "incoming"
        sender = "Я" if direction == "outgoing" else (chat_name or "Собеседник")
        msg = ChatMessage(
            sender=sender,
            text=text,
            direction=direction,
            time=time_s,
            media=media,
            raw=text,
        )
        msg.bbox = _item_bbox(item)
        msg.media_bbox = media_bbox
        _stamp_message_day(msg, day_ctx)
        messages.append(msg)

    if not messages:
        return DialogueExtract(
            messages=[],
            note=(
                f"MAX HistoryListView найден ({len(items)} элементов, {backend}), "
                "но MessageTextItem не разобраны — чат может быть пуст."
            ),
        )

    return DialogueExtract(
        messages=messages,
        note=(
            f"Диалог MAX HistoryListView ({backend}): {len(messages)} сообщ. "
            f"(элементов списка: {len(items)}; порядок по Y сверху вниз = старые → новые)."
        ),
    )


def _parse_history_item(name: str, chat_name: str | None = None) -> ChatMessage | None:
    """
    HistoryInner item names are newline-separated, e.g.:

        Просмотрено
        Меня
        Текст
        Отправлено в 20:21

        Камчатка Сергей Айтишник
        Текст
        Получено в 20:23
    """
    # Prefer structured newline parse
    lines = [ln.strip() for ln in re.split(r"[\r\n]+", name) if ln.strip()]
    if len(lines) >= 3:
        msg = _parse_lines(lines, chat_name=chat_name, raw=name)
        if msg:
            return msg

    # Fallback to flat parser
    flat = re.sub(r"\s+", " ", name).strip()
    return _parse_bubble(flat, chat_name=chat_name)


def _parse_lines(
    lines: list[str],
    chat_name: str | None,
    raw: str,
) -> ChatMessage | None:
    direction = "unknown"
    time_s = ""
    sender = ""
    body_parts: list[str] = []
    reply_to = ""
    quote = ""
    media = ""
    edited = False

    # Drop leading status lines (read / unread markers are not senders)
    i = 0
    status_lines = {
        "просмотрено",
        "просмотрено.",
        "не просмотрено",
        "непросмотрено",
        "не просмотрено.",
    }
    while i < len(lines) and lines[i].lower().strip() in status_lines:
        i += 1

    if i >= len(lines):
        return None

    # Sender
    if lines[i].lower() in {"меня", "me", "you"}:
        sender = "Я"
        direction = "outgoing"
        i += 1
    else:
        sender = lines[i]
        direction = "incoming"
        i += 1
        # Guard: status leaked into sender position
        if sender.lower().strip() in status_lines:
            return None

    # Remaining lines until direction/time tail
    tail_re = re.compile(
        r"^(?P<dir>Отправлено|Получено)(?:\s+изменено)?\s+(?P<time>.+)$",
        re.IGNORECASE,
    )
    while i < len(lines):
        line = lines[i]
        m = tail_re.match(line)
        if m:
            direction = (
                "outgoing"
                if m.group("dir").lower().startswith("отправл")
                else "incoming"
            )
            time_s = m.group("time").strip()
            if "изменено" in line.lower():
                edited = True
            i += 1
            break

        if line.lower().startswith("ответ для"):
            # "Ответ для Name: quote" possibly with markers
            rm = re.match(
                r"Ответ для\s+(?P<to>.+?):\s*‎?⁨?(?P<quote>.*?)⁩?\s*$",
                line,
                flags=re.IGNORECASE,
            )
            if rm:
                reply_to = (rm.group("to") or "").strip()
                quote = (rm.group("quote") or "").strip()
            else:
                body_parts.append(line)
            i += 1
            continue

        if re.match(
            r"^(Фотография|Видео|Голосовое сообщение|Файл|Стикер|GIF)\b",
            line,
            flags=re.IGNORECASE,
        ):
            media = line
            i += 1
            continue

        if line.lower() in {"переслано", "переслано от"} or line.lower().startswith(
            "переслано от"
        ):
            body_parts.append(line)
            i += 1
            continue

        body_parts.append(line)
        i += 1

    # Sometimes time is a separate last line: "в 20:21"
    if not time_s and lines:
        last = lines[-1]
        if re.match(r"^(в\s+\d{1,2}:\d{2}|вчера|сегодня|\d{1,2}\.\d{1,2}\.)", last, re.I):
            time_s = last

    text = " ".join(body_parts).strip()
    if not text and media:
        text = media
    if not text and quote:
        text = f"(ответ) {quote}"
    if not text:
        return None

    if sender.lower() in {"меня", "me", "you"}:
        sender = "Я"
        direction = "outgoing"
    if chat_name and sender != "Я" and _norm(sender) == _norm(chat_name):
        direction = "incoming"

    if edited and time_s and "измен" not in time_s.lower():
        time_s = f"{time_s} (изм.)"

    return ChatMessage(
        sender=sender or ("Я" if direction == "outgoing" else (chat_name or "Собеседник")),
        text=text,
        direction=direction,
        time=time_s,
        reply_to=reply_to,
        quote=quote,
        media=media,
        raw=re.sub(r"\s+", " ", raw).strip(),
    )


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def parse_day_separator(name: str) -> tuple[str, str] | None:
    """
    Telegram HistoryInner day dividers, e.g. «Сегодня», «Вчера», «31 июля»,
    «пятница, 31 июля», «31 июля 2025».
    """
    raw = name or ""
    if not raw.strip() or "\n" in raw.replace("\r", "\n"):
        return None
    text = re.sub(r"\s+", " ", raw.strip())
    if not text or len(text) > 64:
        return None
    low = text.lower()
    # Bubbles always contain Отправлено/Получено — skip.
    if "отправлено" in low or "получено" in low or "просмотрено" in low:
        return None

    today = date.today()
    if low in {"сегодня", "today"}:
        return today.isoformat(), "Сегодня"
    if low in {"вчера", "yesterday"}:
        return (today - timedelta(days=1)).isoformat(), "Вчера"

    # Strip weekday prefix: «пятница, 31 июля»
    for wd in _WEEKDAYS_RU:
        if low.startswith(wd):
            low = re.sub(rf"^{wd}\s*,?\s*", "", low).strip()
            text = re.sub(rf"(?i)^{wd}\s*,?\s*", "", text).strip()
            break

    m = re.match(
        r"^(?P<day>\d{1,2})\s+(?P<month>"
        + "|".join(_MONTHS_RU.keys())
        + r")(?:\s+(?P<year>\d{4}))?$",
        low,
    )
    if not m:
        return None
    day_n = int(m.group("day"))
    month_n = _MONTHS_RU[m.group("month")]
    year_n = int(m.group("year") or today.year)
    # If month/day is in the future without an explicit year, assume previous year.
    try:
        d = date(year_n, month_n, day_n)
    except ValueError:
        return None
    if m.group("year") is None and d > today + timedelta(days=1):
        try:
            d = date(year_n - 1, month_n, day_n)
        except ValueError:
            return None
    label = f"{day_n} {m.group('month')}"
    if m.group("year"):
        label = f"{label} {year_n}"
    return d.isoformat(), label


def chat_date_from_time(time_s: str, *, today: date | None = None) -> tuple[str, str] | None:
    """Extract calendar day from rich Telegram time tails."""
    raw = re.sub(r"\s+", " ", (time_s or "").strip())
    if not raw:
        return None
    low = raw.lower()
    base = today or date.today()
    if low.startswith("сегодня"):
        return base.isoformat(), "Сегодня"
    if low.startswith("вчера"):
        d = base - timedelta(days=1)
        return d.isoformat(), "Вчера"
    m = re.match(
        r"^(?P<d>\d{1,2})\.(?P<m>\d{1,2})\.(?P<y>\d{2,4})\s+в\s+",
        low,
    )
    if not m:
        return None
    day_n = int(m.group("d"))
    month_n = int(m.group("m"))
    year_n = int(m.group("y"))
    if year_n < 100:
        year_n += 2000
    try:
        d = date(year_n, month_n, day_n)
    except ValueError:
        return None
    return d.isoformat(), d.strftime("%d.%m.%Y")


def _stamp_message_day(msg: ChatMessage, day_ctx: dict[str, str]) -> None:
    from_time = chat_date_from_time(msg.time or "")
    if from_time:
        msg.chat_date, msg.day_label = from_time
        day_ctx["chat_date"] = from_time[0]
        day_ctx["day_label"] = from_time[1]
        return
    if day_ctx.get("chat_date"):
        msg.chat_date = day_ctx["chat_date"]
        msg.day_label = day_ctx.get("day_label") or ""
