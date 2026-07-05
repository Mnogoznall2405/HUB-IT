"""Person name formatting helpers."""

import re


def to_short_fio(value: str) -> str:
    """Convert full name to 'Фамилия И.О.'."""
    text = str(value or "").strip()
    if not text:
        return ""

    parts = re.findall(r"[^\W\d_]+(?:[-'][^\W\d_]+)*", text, flags=re.UNICODE)
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]

    surname = parts[0]
    initials = "".join(f"{part[0].upper()}." for part in parts[1:3] if part)
    if initials:
        return f"{surname} {initials}"
    return surname
