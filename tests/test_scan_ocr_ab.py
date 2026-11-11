"""Offline A/B harness: synthetic DSP-like etalon with exact ground truth.

Etalon PDFs are generated at runtime with fitz (no binary blobs in repo).
Each case declares expected digit groups (`must` = assert, `want` = report).
Baseline (production defaults) is the reference; variants must be recall-neutral
(no `must` lost vs baseline) to pass. Requires real tesseract; skipped otherwise.
"""

from __future__ import annotations

import time
from pathlib import Path

import pytest

import scan_server.ocr as scan_ocr

TESSERACT_CMD = r"C:\Program Files\Tesseract-OCR\tesseract.exe"


def _require_ocr():
    if not Path(TESSERACT_CMD).exists():
        pytest.skip("tesseract not installed")
    return pytest.importorskip("fitz")


def _norm(text: str) -> str:
    return " ".join(str(text or "").lower().split())


def _build_cases(fitz):
    """Return [(name, pdf_bytes, must_have, want_have)]."""
    cases = []

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 120), "dogovor postavki 11111 stroka teksta")
    page.insert_text((72, 200), "vtoraya stroka 12222 konets dokumenta")
    cases.append(("clean", doc.tobytes(), ["11111", "12222"], []))
    doc.close()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 300), "body dokumenta 24444 obychnyj tekst")
    page.insert_text((330, 60), "DSP 22222", fontsize=8)
    page.insert_text((40, 700), "grif 33333", fontsize=8)
    cases.append(("corner_stamp", doc.tobytes(), ["24444", "22222", "33333"], []))
    doc.close()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 300), "body dokumenta 45555 obychnyj tekst")
    page.insert_text((330, 60), "blednaya 44444", fontsize=8, color=(0.55, 0.55, 0.55))
    # Gray stamp is a stretch goal even for baseline: reported, not asserted.
    cases.append(("faint_stamp", doc.tobytes(), ["45555"], ["44444"]))
    doc.close()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    # OSD needs enough characters: a realistic multi-line page.
    page.insert_text((72, 100), "akt priemki peredachi 50001 pervaya stroka")
    page.insert_text((72, 160), "vtoraya stroka dokumenta 50002 prodolzhenie")
    page.insert_text((72, 220), "tretya stroka soderzhaniya 50003 tekst")
    page.insert_text((72, 300), "povernutaya stranitsa 55555 tekst")
    page.insert_text((72, 360), "pyataya stroka zaklyuchenie 50005 konets")
    page.set_rotation(90)
    cases.append(("rotated", doc.tobytes(), ["55555", "50001", "50005"], []))
    doc.close()

    doc = fitz.open()
    doc.new_page(width=595, height=842)
    cases.append(("blank", doc.tobytes(), [], []))
    doc.close()

    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 120), "pervaya stranitsa 61111 tekst")
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 300), "vtoraya stranitsa 62222 tekst")
    page.insert_text((330, 60), "shtamp 63333", fontsize=8)
    cases.append(("multi", doc.tobytes(), ["61111", "62222", "63333"], []))
    doc.close()

    return cases


def _run(pdf_bytes: bytes, **kwargs):
    started = time.perf_counter()
    result = scan_ocr.ocr_pdf_bytes_detailed(
        pdf_bytes, lang="rus", tesseract_cmd=TESSERACT_CMD, max_pages=3, **kwargs
    )
    return result, (time.perf_counter() - started) * 1000.0


def test_etalon_baseline_finds_all_must_have():
    fitz = _require_ocr()
    failures = []
    for name, pdf_bytes, must_have, _want in _build_cases(fitz):
        result, _dt = _run(pdf_bytes)
        text = _norm(result.get("text"))
        if name == "blank":
            assert result["pages"][0]["outcome"] == "blank", f"blank case outcome: {result['pages']}"
            continue
        for marker in must_have:
            if marker not in text:
                failures.append(f"{name}: missing {marker!r} (got {text[:120]!r})")
    assert not failures, "baseline misses:\n" + "\n".join(failures)


def test_ab_focused_psm6_is_recall_neutral(capsys):
    """A/B: focused regions psm 11 (prod) vs psm 6 (candidate)."""
    fitz = _require_ocr()
    with capsys.disabled():
        print("\ncase | base_ms | psm6_ms | recall_delta")
    regressions = []
    for name, pdf_bytes, must_have, want_have in _build_cases(fitz):
        base, base_ms = _run(pdf_bytes)
        variant, var_ms = _run(pdf_bytes, focused_psm=6)
        base_text = _norm(base.get("text"))
        var_text = _norm(variant.get("text"))
        lost = [m for m in must_have + want_have if m in base_text and m not in var_text]
        gained = [m for m in must_have + want_have if m not in base_text and m in var_text]
        if lost:
            regressions.append(f"{name}: lost {lost}")
        with capsys.disabled():
            print(f"{name} | {base_ms:.0f} | {var_ms:.0f} | lost={lost} gained={gained}")
    assert not regressions, "psm6 regressions vs baseline:\n" + "\n".join(regressions)


def test_ab_focused_dpi250_is_recall_neutral(capsys):
    """A/B: focused regions at 300 DPI (prod) vs 250 DPI (candidate)."""
    fitz = _require_ocr()
    import scan_server.ocr as _ocr_module

    with capsys.disabled():
        print("\ncase | base_ms | dpi250_ms | recall_delta")
    regressions = []
    for name, pdf_bytes, must_have, want_have in _build_cases(fitz):
        base, base_ms = _run(pdf_bytes)
        old_dpi = _ocr_module.FOCUSED_REGION_DPI
        _ocr_module.FOCUSED_REGION_DPI = 250
        try:
            variant, var_ms = _run(pdf_bytes)
        finally:
            _ocr_module.FOCUSED_REGION_DPI = old_dpi
        base_text = _norm(base.get("text"))
        var_text = _norm(variant.get("text"))
        lost = [m for m in must_have + want_have if m in base_text and m not in var_text]
        gained = [m for m in must_have + want_have if m not in base_text and m in var_text]
        if lost:
            regressions.append(f"{name}: lost {lost}")
        with capsys.disabled():
            print(f"{name} | {base_ms:.0f} | {var_ms:.0f} | lost={lost} gained={gained}")
    assert not regressions, "dpi250 regressions vs baseline:\n" + "\n".join(regressions)
