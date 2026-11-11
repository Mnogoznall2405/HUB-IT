"""Read-only UI Automation tree dump for Telegram window."""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from .models import UiNodeSummary

logger = logging.getLogger(__name__)

MAX_NODES = 4500
MAX_DEPTH = 22
MAX_NAME_LEN = 800
MAX_DIALOGS_LIST_CHILDREN = 35
MAX_HISTORY_DESCENDANTS = 1200


@dataclass
class UiDump:
    nodes: list[UiNodeSummary] = field(default_factory=list)
    visible_text: list[str] = field(default_factory=list)
    raw_names: list[str] = field(default_factory=list)
    history_text: list[str] = field(default_factory=list)
    error: str | None = None
    backend: str = "pywinauto.uia"
    history_nodes: int = 0
    dialogs_nodes: int = 0

    def to_serializable(self) -> list[dict[str, Any]]:
        return [n.to_dict() for n in self.nodes]


_FILE_EXT_RE = re.compile(
    r"(?i)(?<![./\w])("
    r"[\w\u0400-\u04FF][\w\-\.\u0400-\u04FF]{0,160}"
    r"\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|txt|"
    r"csv|png|jpe?g|gif|webp|mp[34]|mkv|avi|mov|json|xml|html?|py|cs|exe|msi|"
    r"apk|dmg|iso|bin|dat|sqlite|db|log|md|rtf|odt|ods))"
    r"(?![/\w])"
)


def extract_file_names(texts: list[str]) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for text in texts:
        if not text:
            continue
        for match in _FILE_EXT_RE.finditer(text):
            name = match.group(1).strip().strip("\"'«»")
            key = name.lower()
            if key in seen:
                continue
            if len(name) > 180 or name.count(".") > 4:
                continue
            start = match.start(1)
            prefix = text[max(0, start - 16) : start].lower()
            if "://" in prefix or "http" in prefix or "www." in prefix:
                continue
            seen.add(key)
            found.append(name)
    return found


def _clip(value: Any, limit: int = MAX_NAME_LEN) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\r", " ").replace("\n", " ").strip()
    if len(text) > limit:
        return text[: limit - 1] + "…"
    return text


def _class_of(element: Any) -> str:
    try:
        return str(getattr(element.element_info, "class_name", "") or "")
    except Exception:
        return ""


def _name_of(element: Any) -> str:
    try:
        return _clip(element.element_info.name)
    except Exception:
        try:
            return _clip(element.window_text())
        except Exception:
            return ""


def _aid_of(element: Any) -> str:
    try:
        return str(getattr(element.element_info, "automation_id", "") or "")
    except Exception:
        return ""


def _region_kind(class_name: str, automation_id: str = "", name: str = "") -> str:
    blob = f"{class_name} {automation_id}".lower()
    if (
        "historywidget" in blob
        or "historyinner" in blob
        or "historylistview" in blob
        or "historymessagedelegate" in blob
        or "historypanel" in blob
        or "chatbackground" in blob
        or "messagetextitem" in blob
        or "history::" in blob
    ):
        return "history"
    if "dialogs::innerwidget" in blob or "dialogs::widget" in blob or "chatdelegate" in blob:
        return "dialogs"
    return ""


def _priority(element: Any) -> int:
    """Lower walks earlier: History before Dialogs chat list."""
    kind = _region_kind(_class_of(element), _aid_of(element), _name_of(element))
    if kind == "history":
        return 0
    if "mainwidget" in _class_of(element).lower():
        return 1
    if kind == "dialogs":
        return 3
    return 2


def dump_uia_tree(hwnd: int) -> UiDump:
    """
    Walk UI Automation tree rooted at Telegram hwnd.

    Walks HistoryWidget before the left chat list and caps Dialogs rows, so
    newest on-screen message bubbles are not truncated away.
    """
    dump = UiDump()
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        dump.error = f"pywinauto_missing: {exc}"
        return dump

    try:
        desktop = Desktop(backend="uia")
        root = desktop.window(handle=hwnd)
        try:
            wrapper = root.wrapper_object()
        except Exception:
            wrapper = root
    except Exception as exc:  # noqa: BLE001
        dump.error = f"connect_failed: {exc}"
        logger.warning("UIA connect failed: %s", exc)
        return _dump_with_uiautomation(hwnd, dump)

    nodes: list[UiNodeSummary] = []
    visible: list[str] = []
    raw_names: list[str] = []
    history_text: list[str] = []
    history_nodes = 0
    dialogs_nodes = 0
    seen_runtime_ids: set[str] = set()

    def runtime_key(element: Any) -> str:
        try:
            ei = element.element_info
            return f"{getattr(ei, 'runtime_id', None) or getattr(ei, 'element', None) or id(ei)}"
        except Exception:
            return str(id(element))

    def record(
        name: str,
        control_type: str,
        class_name: str,
        automation_id: str,
        value: str,
        depth: int,
        children_count: int,
        region: str,
    ) -> None:
        nonlocal history_nodes, dialogs_nodes
        nodes.append(
            UiNodeSummary(
                name=name,
                control_type=control_type,
                class_name=class_name,
                automation_id=automation_id,
                value=value,
                depth=depth,
                children_count=children_count,
            )
        )
        if region == "history":
            history_nodes += 1
        elif region == "dialogs":
            dialogs_nodes += 1
        for piece in (name, value):
            if not piece:
                continue
            raw_names.append(piece)
            if _looks_visible_text(piece, control_type):
                visible.append(piece)
                if region == "history":
                    history_text.append(piece)

    def walk(element: Any, depth: int, region: str) -> None:
        nonlocal history_nodes, dialogs_nodes
        if len(nodes) >= MAX_NODES or depth > MAX_DEPTH:
            return
        key = runtime_key(element)
        if key in seen_runtime_ids:
            return
        seen_runtime_ids.add(key)

        try:
            ei = element.element_info
            name = _clip(getattr(ei, "name", "") or "")
            control_type = _clip(getattr(ei, "control_type", "") or "", 80)
            class_name = _clip(getattr(ei, "class_name", "") or "", 160)
            automation_id = _clip(getattr(ei, "automation_id", "") or "", 200)
        except Exception:
            name = _name_of(element)
            control_type, class_name, automation_id = "", "", ""

        kind = _region_kind(class_name, automation_id, name)
        local_region = region
        if kind == "history":
            local_region = "history"
        elif kind == "dialogs" and region != "history":
            local_region = "dialogs"

        value = ""
        try:
            if hasattr(element, "get_value"):
                value = _clip(element.get_value())
            elif hasattr(element, "iface_value") and element.iface_value:
                value = _clip(element.iface_value.CurrentValue)
        except Exception:
            value = ""

        children: list[Any] = []
        try:
            children = list(element.children())
        except Exception:
            children = []

        # HistoryWidget may expose 0 direct children; pull descendants once.
        if (
            local_region == "history"
            and kind == "history"
            and not children
            and "historywidget" in class_name.lower()
        ):
            try:
                children = list(element.descendants())[:MAX_HISTORY_DESCENDANTS]
            except Exception:
                children = []

        # Cap left chat list so it cannot push out newest history items.
        if local_region == "dialogs" and (
            "innerwidget" in class_name.lower() or (name or "").lower() == "чаты"
        ):
            children = children[:MAX_DIALOGS_LIST_CHILDREN]

        record(
            name,
            control_type,
            class_name,
            automation_id,
            value,
            depth,
            len(children),
            local_region,
        )

        children = sorted(children, key=_priority)
        for child in children:
            if len(nodes) >= MAX_NODES:
                break
            walk(child, depth + 1, local_region)

    try:
        walk(wrapper, 0, "")
    except Exception as exc:  # noqa: BLE001
        dump.error = f"walk_failed: {exc}"
        logger.warning("UIA walk failed: %s", exc)
        if not nodes:
            return _dump_with_uiautomation(hwnd, dump)

    dump.nodes = nodes
    dump.history_text = _dedupe_preserve(history_text)
    # History first — if anything truncates later, newest chat content survives.
    dump.visible_text = _prefer_newest_bubbles(_dedupe_preserve(history_text + visible))
    dump.raw_names = _dedupe_preserve(raw_names)
    dump.history_nodes = history_nodes
    dump.dialogs_nodes = dialogs_nodes
    if not nodes and not dump.error:
        dump.error = "empty_uia_tree"
    logger.info(
        "UIA dump nodes=%s history_nodes=%s history_texts=%s dialogs_nodes=%s",
        len(nodes),
        history_nodes,
        len(dump.history_text),
        dialogs_nodes,
    )
    return dump


def _prefer_newest_bubbles(texts: list[str], soft_limit: int = 800) -> list[str]:
    """
    Keep chrome + message bubbles; if over soft_limit, drop middle chat-list noise
    but always keep the last history-like bubbles (newest are usually at the end).
    """
    if len(texts) <= soft_limit:
        return texts

    bubble_idx = [
        i
        for i, t in enumerate(texts)
        if ("отправлено" in t.lower() or "получено" in t.lower()) and len(t) > 15
    ]
    keep: set[int] = set(range(min(80, len(texts))))  # header/chrome
    # Keep all bubbles; if too many, keep the newest (last) ones.
    if len(bubble_idx) > 250:
        bubble_idx = bubble_idx[-250:]
    keep.update(bubble_idx)
    # Also keep neighbors of bubbles (structured fields)
    for i in list(bubble_idx):
        for j in (i - 1, i + 1, i + 2):
            if 0 <= j < len(texts):
                keep.add(j)

    if len(keep) < soft_limit:
        # fill from the end (newer region / history tail)
        for i in range(len(texts) - 1, -1, -1):
            keep.add(i)
            if len(keep) >= soft_limit:
                break

    return [texts[i] for i in sorted(keep)]


def _looks_visible_text(text: str, control_type: str) -> bool:
    if not text or len(text) < 1:
        return False
    ct = (control_type or "").lower()
    if ct in {
        "text",
        "edit",
        "document",
        "listitem",
        "hyperlink",
        "group",
        "pane",
        "custom",
        "dataitem",
    }:
        return True
    return len(text) >= 2


def _dedupe_preserve(items: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = item.strip()
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(key)
    return out


def _dump_with_uiautomation(hwnd: int, dump: UiDump) -> UiDump:
    try:
        import uiautomation as auto
    except ImportError:
        if not dump.error:
            dump.error = "uia_backends_unavailable"
        return dump

    dump.backend = "uiautomation"
    try:
        root = auto.ControlFromHandle(hwnd)
    except Exception as exc:  # noqa: BLE001
        dump.error = f"uiautomation_connect_failed: {exc}"
        return dump

    nodes: list[UiNodeSummary] = []
    visible: list[str] = []
    raw_names: list[str] = []
    history_text: list[str] = []

    def walk(ctrl: Any, depth: int, region: str) -> None:
        if len(nodes) >= MAX_NODES or depth > MAX_DEPTH:
            return
        try:
            name = _clip(ctrl.Name)
            control_type = _clip(getattr(ctrl, "ControlTypeName", "") or "", 80)
            class_name = _clip(ctrl.ClassName, 160)
            automation_id = _clip(ctrl.AutomationId, 200)
        except Exception:
            name, control_type, class_name, automation_id = "", "", "", ""

        kind = _region_kind(class_name, automation_id, name)
        local_region = (
            "history"
            if kind == "history"
            else ("dialogs" if kind == "dialogs" and region != "history" else region)
        )

        value = ""
        try:
            vp = ctrl.GetValuePattern()
            if vp:
                value = _clip(vp.Value)
        except Exception:
            value = ""

        children: list[Any] = []
        try:
            children = list(ctrl.GetChildren())
        except Exception:
            children = []

        if local_region == "dialogs" and (
            "innerwidget" in class_name.lower() or (name or "").lower() == "чаты"
        ):
            children = children[:MAX_DIALOGS_LIST_CHILDREN]

        nodes.append(
            UiNodeSummary(
                name=name,
                control_type=control_type,
                class_name=class_name,
                automation_id=automation_id,
                value=value,
                depth=depth,
                children_count=len(children),
            )
        )
        for piece in (name, value):
            if piece:
                raw_names.append(piece)
                if _looks_visible_text(piece, control_type):
                    visible.append(piece)
                    if local_region == "history":
                        history_text.append(piece)

        children = sorted(
            children,
            key=lambda ch: 0
            if "history" in str(getattr(ch, "ClassName", "") or "").lower()
            else 2
            if "dialogs" in str(getattr(ch, "ClassName", "") or "").lower()
            else 1,
        )
        for child in children:
            if len(nodes) >= MAX_NODES:
                break
            walk(child, depth + 1, local_region)

    try:
        walk(root, 0, "")
    except Exception as exc:  # noqa: BLE001
        dump.error = f"uiautomation_walk_failed: {exc}"
        return dump

    dump.nodes = nodes
    dump.history_text = _dedupe_preserve(history_text)
    dump.visible_text = _prefer_newest_bubbles(_dedupe_preserve(history_text + visible))
    dump.raw_names = _dedupe_preserve(raw_names)
    if not nodes and not dump.error:
        dump.error = "empty_uia_tree"
    return dump
