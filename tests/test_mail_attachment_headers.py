from __future__ import annotations

import importlib
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

mail_api_module = importlib.import_module("backend.api.v1.mail")


def _download_headers(filename: str, content_type: str, disposition: str = "inline"):
    return mail_api_module._build_attachment_download_headers(
        filename=filename,
        content_type=content_type,
        requested_disposition=disposition,
    )


def test_attachment_download_headers_always_include_nosniff():
    headers = _download_headers("logo.png", "image/png", "inline")
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Disposition"].startswith("inline;")


def test_html_svg_xml_are_forced_to_attachment_even_when_inline_requested():
    cases = (
        ("note.html", "text/html"),
        ("note.htm", "text/html; charset=utf-8"),
        ("icon.svg", "image/svg+xml"),
        ("data.xml", "application/xml"),
        ("feed.xml", "text/xml"),
        ("payload.html", "application/octet-stream"),
    )
    for filename, content_type in cases:
        headers = _download_headers(filename, content_type, "inline")
        assert headers["Content-Disposition"].startswith("attachment;"), (filename, content_type)
        assert headers["X-Content-Type-Options"] == "nosniff"


def test_png_cid_inline_disposition_is_preserved():
    headers = _download_headers("cid-logo.png", "image/png", "inline")
    assert headers["Content-Disposition"].startswith("inline;")


def test_unknown_mime_is_not_served_inline():
    headers = _download_headers("payload.bin", "application/octet-stream", "inline")
    assert headers["Content-Disposition"].startswith("attachment;")
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_preview_pdf_is_not_raw_office_document():
    headers = mail_api_module._build_preview_pdf_headers("invoice.docx.pdf")
    assert mail_api_module._PREVIEW_PDF_MEDIA_TYPE == "application/pdf"
    assert "wordprocessingml" not in mail_api_module._PREVIEW_PDF_MEDIA_TYPE
    assert headers["Content-Disposition"].startswith("inline;")
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_inline_allowlist_off_keeps_html_inline_but_still_sends_nosniff(monkeypatch):
    monkeypatch.setenv("MAIL_INLINE_ALLOWLIST", "0")
    headers = _download_headers("note.html", "text/html", "inline")
    assert headers["Content-Disposition"].startswith("inline;")
    assert headers["X-Content-Type-Options"] == "nosniff"


def test_eml_download_headers_include_nosniff():
    headers = {
        "Content-Disposition": mail_api_module._build_content_disposition("message.eml"),
        **mail_api_module._nosniff_headers(),
    }
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["Content-Disposition"].startswith("attachment;")
