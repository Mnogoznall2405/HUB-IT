"""Office preview conversion baseline/benchmark: LibreOffice vs ONLYOFFICE.

Generates a small corpus (docx, xlsx multi-sheet, xlsx large, pptx), then
times document->PDF conversion through the LibreOffice headless CLI and the
ONLYOFFICE Conversion API (/converter/from-file).

Usage (from repo root):
    python scripts/bench_office_preview.py --engine libreoffice --repeats 3
    python scripts/bench_office_preview.py --engine onlyoffice --repeats 3
    python scripts/bench_office_preview.py --engine both --repeats 3 --out bench.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "WEB-itinvent"))

from dotenv import dotenv_values  # noqa: E402

ENV = dotenv_values(REPO_ROOT / ".env")


def make_corpus(target: Path) -> dict[str, Path]:
    """Build deterministic sample documents; returns {name: path}."""
    target.mkdir(parents=True, exist_ok=True)
    corpus: dict[str, Path] = {}

    from docx import Document  # python-docx
    from docx.shared import Pt

    doc = Document()
    doc.add_heading("Отчёт по инвентаризации", 0)
    for i in range(40):
        doc.add_paragraph(f"Параграф {i}: текст с кириллицей, цифрами и датой 22.11.2026.")
    table = doc.add_table(rows=8, cols=4)
    for row in table.rows:
        for cell in row.cells:
            cell.text = "Ячейка"
    doc.add_paragraph("Конец документа.").runs[0].font.size = Pt(8)
    docx_path = target / "report.docx"
    doc.save(str(docx_path))
    corpus["docx"] = docx_path

    import openpyxl

    wb = openpyxl.Workbook()
    for s in range(4):
        ws = wb.active if s == 0 else wb.create_sheet(f"Лист{s + 1}")
        ws.title = f"Лист{s + 1}"
        for r in range(1, 60):
            for c in range(1, 8):
                ws.cell(row=r, column=c, value=f"R{r}C{c}" if c < 6 else r * c)
    ws = wb.create_sheet("Скрытый")
    ws.sheet_state = "hidden"
    ws["A1"] = "secret"
    xlsx_path = target / "workbook.xlsx"
    wb.save(str(xlsx_path))
    corpus["xlsx"] = xlsx_path

    big = openpyxl.Workbook()
    sheet = big.active
    for r in range(1, 4000):
        for c in range(1, 12):
            sheet.cell(row=r, column=c, value=r * c)
    big_path = target / "workbook_big.xlsx"
    big.save(str(big_path))
    corpus["xlsx_big"] = big_path

    # Real PPTX from the My Files blank templates (valid OOXML presentation).
    blank_pptx = REPO_ROOT / "WEB-itinvent" / "backend" / "services" / "my_files_blank_templates" / "blank.pptx"
    pptx_path = target / "slides.pptx"
    if blank_pptx.is_file():
        pptx_path.write_bytes(blank_pptx.read_bytes())
    else:  # pragma: no cover - repo asset missing
        _write_minimal_pptx(pptx_path)
    corpus["pptx"] = pptx_path

    txt_path = target / "notes.txt"
    txt_path.write_text("Простой текст для конвертации. " * 200, encoding="utf-8")
    corpus["txt"] = txt_path

    broken_path = target / "broken.docx"
    broken_path.write_bytes(b"not-a-real-docx" * 100)
    corpus["broken"] = broken_path

    return corpus


def _write_minimal_pptx(path: Path) -> None:
    import zipfile

    ct = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>"""
    pres = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
</p:presentation>"""
    pres_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>"""
    slide_tpl = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="457200" y="274638"/><a:ext cx="8229600" cy="1143000"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="ru-RU"/><a:t>TEXT_HERE</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping/></p:clrMapOvr></p:sld>"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", ct)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("ppt/presentation.xml", pres)
        archive.writestr("ppt/_rels/presentation.xml.rels", pres_rels)
        archive.writestr("ppt/slides/slide1.xml", slide_tpl.replace("TEXT_HERE", "Заголовок слайда 1"))
        archive.writestr("ppt/slides/slide2.xml", slide_tpl.replace("TEXT_HERE", "Второй слайд"))


def convert_libreoffice(source: Path, work: Path, timeout: int = 120) -> tuple[float, bytes]:
    soffice = Path(ENV.get("LIBREOFFICE_SOFFICE_PATH") or r"C:\Program Files\LibreOffice\program\soffice.exe")
    out_dir = work / f"lo-{time.monotonic_ns()}"
    profile = out_dir / ".lo-profile"
    out_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    completed = subprocess.run(
        [
            str(soffice),
            f"-env:UserInstallation={profile.resolve().as_uri()}",
            "--headless", "--nologo", "--nofirststartwizard", "--norestore",
            "--convert-to", "pdf", "--outdir", str(out_dir), str(source),
        ],
        capture_output=True, text=True, timeout=timeout,
    )
    elapsed = time.monotonic() - started
    pdf = out_dir / f"{source.stem}.pdf"
    if completed.returncode != 0 or not pdf.is_file():
        raise RuntimeError(f"LO failed rc={completed.returncode}: {(completed.stderr or completed.stdout or '')[:200]}")
    return elapsed, pdf.read_bytes()


def convert_onlyoffice(source: Path, timeout: int = 120) -> tuple[float, bytes]:
    import httpx
    from jose import jwt

    internal = (ENV.get("ONLYOFFICE_INTERNAL_URL") or "").rstrip("/")
    secret = ENV.get("ONLYOFFICE_JWT_SECRET") or ""
    if not internal or not secret:
        raise RuntimeError("ONLYOFFICE_INTERNAL_URL/ONLYOFFICE_JWT_SECRET missing in .env")
    content = source.read_bytes()
    key = hashlib.sha256(content).hexdigest()[:20]
    params = {
        "async": True,
        "key": f"bench-{key}",
        "filetype": source.suffix.lstrip("."),
        "outputtype": "pdf",
        "title": source.name,
    }
    token = jwt.encode({**params, "operation": "converter"}, secret, algorithm="HS256")
    started = time.monotonic()
    deadline = started + timeout
    upload_done = False
    with httpx.Client(timeout=min(timeout, 60)) as client:
        while True:
            data = {"params": json.dumps(params), "token": token}
            # DS 10.0 polls async conversions by repeating the IDENTICAL request,
            # file part included — a file-less status request fails token checks (-8).
            response = client.post(
                f"{internal}/converter/from-file",
                data=data,
                files={"file": (source.name, content)},
            )
            ctype = response.headers.get("content-type", "")
            if "json" not in ctype and response.status_code == 200 and response.content[:4] == b"%PDF":
                return time.monotonic() - started, response.content
            try:
                payload = response.json()
            except ValueError:
                raise RuntimeError(f"DS HTTP {response.status_code}: {response.content[:200]!r}")
            if payload.get("endConvert") is False:
                if time.monotonic() > deadline:
                    raise RuntimeError("DS conversion timed out")
                time.sleep(0.8)
                continue
            raise RuntimeError(f"DS error: {payload}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["libreoffice", "onlyoffice", "both"], default="both")
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--out", default="")
    parser.add_argument("--only", default="")
    args = parser.parse_args()

    results: dict[str, dict[str, list[float]]] = {"libreoffice": {}, "onlyoffice": {}}
    with tempfile.TemporaryDirectory(prefix="bench-office-") as tmp:
        tmp_path = Path(tmp)
        corpus = make_corpus(tmp_path / "corpus")
        names = [n for n in corpus if not args.only or n == args.only]
        for name in names:
            source = corpus[name]
            for engine in ("libreoffice", "onlyoffice"):
                if args.engine not in ("both", engine):
                    continue
                for attempt in range(args.repeats):
                    try:
                        if engine == "libreoffice":
                            elapsed, pdf = convert_libreoffice(source, tmp_path / "work")
                        else:
                            elapsed, pdf = convert_onlyoffice(source)
                        ok = pdf[:4] == b"%PDF"
                        results[engine].setdefault(name, []).append(elapsed)
                        print(f"{engine:12s} {name:12s} #{attempt + 1}: {elapsed:6.2f}s  {len(pdf)}B  pdf={ok}", flush=True)
                    except Exception as exc:
                        results[engine].setdefault(name, []).append(-1.0)
                        print(f"{engine:12s} {name:12s} #{attempt + 1}: FAIL {exc}", flush=True)

    summary = {}
    for engine, items in results.items():
        summary[engine] = {}
        for name, times in items.items():
            valid = [t for t in times if t >= 0]
            summary[engine][name] = {
                "runs": times,
                "p50": round(statistics.median(valid), 3) if valid else None,
                "p95": round(statistics.quantiles(valid, n=20)[-1], 3) if len(valid) >= 2 else (round(valid[0], 3) if valid else None),
            }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    if args.out:
        Path(args.out).write_text(json.dumps({"summary": summary}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
