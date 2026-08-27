from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import warehouse_1c as warehouse_1c_api  # noqa: E402


def _assert_sensitive_file_headers(response) -> None:
    cache_control = response.headers["cache-control"]
    assert "private" in cache_control
    assert "no-store" in cache_control
    assert response.headers["x-content-type-options"] == "nosniff"


def test_movement_file_download_is_private_and_not_cached(monkeypatch) -> None:
    async def fake_get_movement_file(registrar_ref: str, file_ref: str):
        assert registrar_ref == "document-1"
        assert file_ref == "file-1"
        return {
            "name": "report.xlsx",
            "content": b"private-report",
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "size": 14,
        }

    monkeypatch.setattr(
        warehouse_1c_api.warehouse_1c_service,
        "get_movement_file",
        fake_get_movement_file,
    )

    response = asyncio.run(
        warehouse_1c_api.download_movement_file(
            "file-1",
            registrar_ref="document-1",
            _=SimpleNamespace(id=1),
        )
    )

    _assert_sensitive_file_headers(response)
    assert response.headers["content-disposition"].startswith("attachment;")


def test_movement_file_preview_pdf_is_private_and_not_cached(monkeypatch, tmp_path: Path) -> None:
    preview_path = tmp_path / "preview.pdf"
    preview_path.write_bytes(b"%PDF-private")

    async def fake_run_in_threadpool(func, *args, **kwargs):
        return {
            "status": "ready",
            "path": str(preview_path),
            "pdf_filename": "report.pdf",
            "source_kind": "excel",
            "page_count": 2,
        }

    monkeypatch.setattr(warehouse_1c_api, "run_in_threadpool", fake_run_in_threadpool)

    response = asyncio.run(
        warehouse_1c_api.download_movement_file_preview_pdf(
            "file-1",
            registrar_ref="document-1",
            current_user=SimpleNamespace(id=1),
        )
    )

    _assert_sensitive_file_headers(response)
    assert response.headers["content-disposition"].startswith("inline;")
