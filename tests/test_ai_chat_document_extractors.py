import sys
from pathlib import Path
import zipfile

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_chat import document_extractors as extractors


def test_image_extractor_supports_keyword_only_ocr_callback(tmp_path: Path):
    target = tmp_path / "sample.png"
    target.write_bytes(b"fake-image-bytes")

    captured: dict[str, object] = {}

    def fake_extractor(*, image_bytes: bytes, mime_type: str, prompt: str = "") -> str:
        captured["image_bytes"] = image_bytes
        captured["mime_type"] = mime_type
        captured["prompt"] = prompt
        return "Image OCR text"

    extracted = extractors.extract_text_from_path(target, image_extractor=fake_extractor)

    assert extracted == "Image OCR text"
    assert captured["image_bytes"] == b"fake-image-bytes"
    assert captured["mime_type"] == "image/png"
    assert "plain text only" in str(captured["prompt"])


@pytest.mark.skipif(extractors.fitz is None, reason="PyMuPDF is required for PDF OCR fallback")
def test_pdf_without_text_layer_falls_back_to_image_ocr(tmp_path: Path):
    target = tmp_path / "scan.pdf"
    doc = extractors.fitz.open()
    doc.new_page(width=200, height=120)
    doc.save(str(target))
    doc.close()

    calls: list[dict[str, object]] = []

    def fake_extractor(*, image_bytes: bytes, mime_type: str, prompt: str = "") -> str:
        calls.append({
            "image_bytes": image_bytes,
            "mime_type": mime_type,
            "prompt": prompt,
        })
        return "Scanned PDF OCR text"

    extracted = extractors.extract_text_from_path(target, image_extractor=fake_extractor)

    assert extracted == "Scanned PDF OCR text"
    assert calls
    assert calls[0]["mime_type"] == "image/png"
    assert "PDF page" in str(calls[0]["prompt"])


def test_docx_like_package_detected_by_original_file_name_even_if_storage_suffix_is_bin(tmp_path: Path):
    target = tmp_path / "stored_attachment.bin"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(
            "word/document.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                "<w:body><w:p><w:r><w:t>Quarterly report</w:t></w:r></w:p></w:body>"
                "</w:document>"
            ),
        )

    extracted = extractors.extract_text_from_path(target, file_name="report.docx")

    assert "Quarterly report" in extracted


def test_extract_pptx_reads_slide_text(tmp_path: Path):
    target = tmp_path / "slides.pptx"
    with zipfile.ZipFile(target, "w") as archive:
        archive.writestr(
            "ppt/slides/slide1.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Roadmap</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>"
                "</p:sld>"
            ),
        )
        archive.writestr(
            "ppt/slides/slide2.xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
                'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
                "<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Budget 2026</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>"
                "</p:sld>"
            ),
        )

    extracted = extractors.extract_text_from_path(target)

    assert "# Slide 1" in extracted
    assert "Roadmap" in extracted
    assert "Budget 2026" in extracted


def test_extract_rtf_text_strips_markup(tmp_path: Path):
    target = tmp_path / "letter.rtf"
    target.write_text(
        r"{\rtf1\ansi\deff0 {\fonttbl {\f0 Arial;}}\pard Hello\par \u1055?\u1088?\u1080?\u1074?\u1077?\u1090?\par}",
        encoding="latin-1",
    )

    extracted = extractors.extract_text_from_path(target)

    assert "Hello" in extracted
    assert "Привет" in extracted


def test_extract_legacy_binary_office_document_uses_string_fallback(tmp_path: Path):
    target = tmp_path / "legacy.doc"
    payload = (
        b"\x00\x01Header\x00Quarterly budget 2026\x00"
        + "\u0421\u043e\u0433\u043b\u0430\u0441\u043e\u0432\u0430\u043d\u043e".encode("utf-16le")
        + b"\x00\x00"
    )
    target.write_bytes(payload)

    extracted = extractors.extract_text_from_path(target)

    assert "Quarterly budget 2026" in extracted
    assert "Согласовано" in extracted
