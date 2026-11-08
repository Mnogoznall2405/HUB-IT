"""Incremental extraction of one JSON string field from a streamed JSON object.

The chat model answers with a JSON object (``answer_markdown``, ``tool_calls``...).
While the object is still arriving we want to show the already received part of
``answer_markdown`` to the user, so this decodes the string value of a top-level
key from an incomplete buffer without waiting for the closing brace.
"""
from __future__ import annotations

import re

_SIMPLE_ESCAPES = {
    '"': '"',
    "\\": "\\",
    "/": "/",
    "b": "\b",
    "f": "\f",
    "n": "\n",
    "r": "\r",
    "t": "\t",
}


def _find_value_start(buffer: str, key: str) -> int | None:
    """Index right after the opening quote of the string value of ``key``."""
    pattern = re.compile(r'"' + re.escape(key) + r'"\s*:\s*"')
    for match in pattern.finditer(buffer):
        # Skip a key that is itself inside an escaped string (preceded by a backslash).
        if match.start() > 0 and buffer[match.start() - 1] == "\\":
            continue
        return match.end()
    return None


def extract_json_string_field(buffer: str, key: str) -> tuple[str, bool] | None:
    """Decode the string value of ``key`` from a possibly incomplete JSON buffer.

    Returns ``None`` while the value has not started, otherwise
    ``(decoded_text_so_far, is_complete)``. A trailing partial escape sequence
    (``\\`` or an unfinished ``\\uXXXX``) is left out until the next chunk
    completes it, and a high surrogate waits for its low surrogate.
    """
    start = _find_value_start(buffer, key)
    if start is None:
        return None
    out: list[str] = []
    index = start
    length = len(buffer)
    while index < length:
        char = buffer[index]
        if char == '"':
            return "".join(out), True
        if char != "\\":
            out.append(char)
            index += 1
            continue
        if index + 1 >= length:
            break
        escape = buffer[index + 1]
        if escape in _SIMPLE_ESCAPES:
            out.append(_SIMPLE_ESCAPES[escape])
            index += 2
            continue
        if escape == "u":
            if index + 6 > length:
                break
            hex_code = buffer[index + 2:index + 6]
            try:
                code = int(hex_code, 16)
            except ValueError:
                # Malformed escape: keep the text, the final json.loads decides.
                out.append(buffer[index:index + 6])
                index += 6
                continue
            if 0xD800 <= code <= 0xDBFF:
                # Need the low surrogate (\uXXXX) to form one character.
                if index + 12 > length:
                    break
                low_part = buffer[index + 6:index + 12]
                if low_part[:2] == "\\u":
                    try:
                        low = int(low_part[2:], 16)
                    except ValueError:
                        low = -1
                    if 0xDC00 <= low <= 0xDFFF:
                        out.append(chr(0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)))
                        index += 12
                        continue
                index += 6
                continue
            out.append(chr(code))
            index += 6
            continue
        # Unknown escape: drop the backslash, keep the character.
        out.append(escape)
        index += 2
    return "".join(out), False
