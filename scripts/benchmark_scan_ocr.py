from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from agent_version import SCAN_ANALYSIS_VERSION, SCAN_OCR_PAGE_LIMIT  # noqa: E402
from scan_server.config import ScanServerConfig  # noqa: E402
from scan_server.document_conversion import convert_document_to_pdf  # noqa: E402
from scan_server.ocr import ocr_pdf_bytes_detailed  # noqa: E402
from scan_server.patterns import scan_text  # noqa: E402


SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".jpg",
    ".jpeg",
    ".png",
    ".tif",
    ".tiff",
    ".bmp",
    ".webp",
    ".doc",
    ".docx",
    ".odt",
    ".xls",
    ".xlsx",
    ".ods",
    ".ppt",
    ".pptx",
    ".odp",
}


def _input_files(path: Path) -> list[Path]:
    if path.is_file():
        return [path]
    if not path.is_dir():
        raise FileNotFoundError(path)
    return sorted(
        item
        for item in path.iterdir()
        if item.is_file() and item.suffix.lower() in SUPPORTED_EXTENSIONS
    )


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * fraction)))
    return round(ordered[index], 1)


def _benchmark_file(path: Path, config: ScanServerConfig) -> dict[str, Any]:
    started = time.perf_counter()
    conversion_started = time.perf_counter()
    payload = path.read_bytes()
    pdf_bytes = payload if path.suffix.lower() == ".pdf" else convert_document_to_pdf(payload, path.name)
    conversion_ms = round((time.perf_counter() - conversion_started) * 1000.0, 1)

    result = ocr_pdf_bytes_detailed(
        pdf_bytes,
        lang=config.ocr_lang,
        tesseract_cmd=config.ocr_tesseract_cmd,
        timeout_sec=config.ocr_timeout_sec,
        dpi=config.ocr_dpi,
        max_pages=SCAN_OCR_PAGE_LIMIT,
    )
    matches = scan_text(str(result.get("text") or ""))
    pattern_ids = sorted({str(item.get("pattern") or "") for item in matches if item.get("pattern")})
    return {
        "file": str(path),
        "bytes": len(payload),
        "complete": bool(result.get("complete")),
        "reason": str(result.get("reason") or ""),
        "patterns": pattern_ids,
        "matches": len(matches),
        "conversion_ms": conversion_ms,
        "total_ms": round((time.perf_counter() - started) * 1000.0, 1),
        "ocr": result.get("metrics") if isinstance(result.get("metrics"), dict) else {},
        "pages": result.get("pages") if isinstance(result.get("pages"), list) else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the real Scan Center OCR pipeline and emit repeatable metrics.")
    parser.add_argument("path", type=Path, help="A supported document or a directory of documents.")
    parser.add_argument("--require-pattern", action="append", default=[], help="Pattern required in every input file.")
    parser.add_argument(
        "--require-prefix",
        action="append",
        default=[],
        help="Require at least one detected pattern with this prefix in every input file.",
    )
    parser.add_argument("--json-output", type=Path, help="Optional path for the complete JSON report.")
    args = parser.parse_args()

    config = ScanServerConfig.from_env()
    files = _input_files(args.path)
    if not files:
        print("No supported files found.", file=sys.stderr)
        return 2

    rows: list[dict[str, Any]] = []
    for path in files:
        try:
            row = _benchmark_file(path, config)
        except Exception as exc:
            row = {
                "file": str(path),
                "complete": False,
                "reason": f"{type(exc).__name__}: {exc}",
                "patterns": [],
                "total_ms": 0.0,
            }
        rows.append(row)
        print(
            f"{path.name}: complete={row['complete']} patterns={','.join(row.get('patterns') or []) or '-'} "
            f"time_ms={row.get('total_ms', 0)}"
        )

    durations = [float(row.get("total_ms") or 0.0) for row in rows if float(row.get("total_ms") or 0.0) > 0]
    required = {str(item).strip() for item in args.require_pattern if str(item).strip()}
    required_prefixes = {str(item).strip() for item in args.require_prefix if str(item).strip()}
    failed_required = [
        str(row["file"])
        for row in rows
        if (
            (required and not required.issubset(set(row.get("patterns") or [])))
            or any(
                not any(str(pattern).startswith(prefix) for pattern in row.get("patterns") or [])
                for prefix in required_prefixes
            )
        )
    ]
    report = {
        "analysis_version": SCAN_ANALYSIS_VERSION,
        "configuration": {
            "ocr_pages": SCAN_OCR_PAGE_LIMIT,
            "ocr_dpi": config.ocr_dpi,
            "ocr_lang": config.ocr_lang,
        },
        "summary": {
            "files": len(rows),
            "complete": sum(1 for row in rows if row.get("complete")),
            "files_with_matches": sum(1 for row in rows if row.get("patterns")),
            "required_pattern_failures": len(failed_required),
            "total_ms": round(sum(durations), 1),
            "p50_ms": _percentile(durations, 0.50),
            "p95_ms": _percentile(durations, 0.95),
        },
        "required_patterns": sorted(required),
        "required_prefixes": sorted(required_prefixes),
        "failed_required_files": failed_required,
        "results": rows,
    }
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    if args.json_output:
        args.json_output.parent.mkdir(parents=True, exist_ok=True)
        args.json_output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"JSON report: {args.json_output}")
    return 2 if failed_required or any(not row.get("complete") for row in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())
