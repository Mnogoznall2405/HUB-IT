"""Read draft text from messenger compose/input field (best-effort UIA)."""

from __future__ import annotations

import logging
import re
from typing import Any

from .profile import TELEGRAM, MessengerProfile

logger = logging.getLogger(__name__)

_PLACEHOLDER_RE = re.compile(
    r"^(напишите|write|type|message|сообщение|введите).*$",
    re.IGNORECASE,
)


def read_compose_draft(hwnd: int, profile: MessengerProfile | None = None) -> str:
    """Return current compose draft text, or '' if unavailable."""
    profile = profile or TELEGRAM
    try:
        from pywinauto import Desktop
    except ImportError:
        return _read_compose_uiautomation(hwnd, profile)

    try:
        root = Desktop(backend="uia").window(handle=int(hwnd)).wrapper_object()
    except Exception as exc:  # noqa: BLE001
        logger.debug("compose connect failed: %s", exc)
        return _read_compose_uiautomation(hwnd, profile)

    best = ""
    try:
        for el in root.descendants():
            try:
                info = el.element_info
                ct = str(getattr(info, "control_type", "") or "").lower()
                cn = str(getattr(info, "class_name", "") or "")
            except Exception:
                continue
            if ct not in {"edit", "document"} and not any(
                x in cn for x in ("Edit", "TextField", "PlainText", "Composer", "InputField", "MessageInput")
            ):
                continue
            text = _control_text(el)
            if _looks_like_draft(text):
                if len(text) >= len(best):
                    best = text
    except Exception as exc:  # noqa: BLE001
        logger.debug("compose walk failed: %s", exc)

    if best:
        return best.strip()
    return _read_compose_uiautomation(hwnd, profile)


def _read_compose_uiautomation(hwnd: int, profile: MessengerProfile) -> str:
    try:
        import uiautomation as auto
    except ImportError:
        return ""
    try:
        root = auto.ControlFromHandle(int(hwnd))
    except Exception:
        return ""

    best = ""
    # Prefer focused control inside the messenger window.
    try:
        focused = auto.GetFocusedControl()
        if focused is not None:
            text = _auto_text(focused)
            if _looks_like_draft(text) and _is_under(focused, root):
                return text.strip()
    except Exception:
        pass

    stack = [(root, 0)]
    seen: set[int] = set()
    while stack:
        el, depth = stack.pop()
        if depth > 18:
            continue
        key = id(el)
        if key in seen:
            continue
        seen.add(key)
        try:
            ct = str(el.ControlTypeName or "")
            cn = str(el.ClassName or "")
        except Exception:
            ct, cn = "", ""
        if "Edit" in ct or any(
            x in cn for x in ("Edit", "TextField", "PlainText", "Composer", "InputField", "MessageInput")
        ):
            text = _auto_text(el)
            if _looks_like_draft(text) and len(text) >= len(best):
                best = text
        try:
            for ch in el.GetChildren():
                stack.append((ch, depth + 1))
        except Exception:
            pass
    return best.strip()


def _is_under(control: Any, root: Any) -> bool:
    try:
        cur = control
        for _ in range(24):
            if cur is None:
                return False
            if cur == root:
                return True
            try:
                if int(cur.NativeWindowHandle or 0) and int(cur.NativeWindowHandle) == int(
                    root.NativeWindowHandle or 0
                ):
                    return True
            except Exception:
                pass
            cur = cur.GetParentControl()
    except Exception:
        return False
    return False


def _control_text(el: Any) -> str:
    try:
        val = el.get_value()
        if val:
            return str(val)
    except Exception:
        pass
    try:
        return str(el.element_info.name or "")
    except Exception:
        return ""


def _auto_text(el: Any) -> str:
    try:
        pat = el.GetValuePattern()
        if pat and pat.Value:
            return str(pat.Value)
    except Exception:
        pass
    try:
        pat = el.GetLegacyIAccessiblePattern()
        if pat and pat.Value:
            return str(pat.Value)
    except Exception:
        pass
    try:
        return str(el.Name or "")
    except Exception:
        return ""


def _looks_like_draft(text: str) -> bool:
    raw = (text or "").strip()
    if not raw or len(raw) > 4000:
        return False
    if _PLACEHOLDER_RE.match(raw):
        return False
    low = raw.lower()
    if low in {"max", "telegram", "сообщение", "message"}:
        return False
    return True
