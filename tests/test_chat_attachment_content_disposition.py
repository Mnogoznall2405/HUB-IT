from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def test_chat_preview_content_disposition_supports_cyrillic_filename():
    from backend.api.v1.chat.attachments import _build_chat_attachment_content_disposition

    value = _build_chat_attachment_content_disposition("Акт передачи.docx", disposition="inline")
    assert value.startswith('inline; filename="')
    assert "filename*=UTF-8''" in value
    # Must be encodable as latin-1 for Starlette Response headers.
    value.encode("latin-1")
    assert "%D0%90%D0%BA%D1%82" in value or "Акт" not in value.split("filename*=UTF-8''", 1)[0]


def test_chat_preview_content_disposition_ascii_passthrough():
    from backend.api.v1.chat.attachments import _build_chat_attachment_content_disposition

    value = _build_chat_attachment_content_disposition("report.pdf", disposition="inline")
    assert 'filename="report.pdf"' in value
    assert "filename*=UTF-8''report.pdf" in value
    value.encode("latin-1")
