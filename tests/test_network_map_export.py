from __future__ import annotations

import hashlib
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import networks
from backend.models.auth import User

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None


def _make_user() -> User:
    return User(
        id=7,
        username="networks_operator",
        email=None,
        full_name="Networks Operator",
        role="operator",
        is_active=True,
        permissions=["networks.read", "networks.write"],
        use_custom_permissions=True,
        custom_permissions=["networks.read", "networks.write"],
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
    )


def _make_pdf_bytes() -> bytes:
    if fitz is None:  # pragma: no cover
        pytest.skip("PyMuPDF is required for network map export tests")
    doc = fitz.open()
    try:
        page = doc.new_page(width=640, height=420)
        page.draw_rect(fitz.Rect(12, 12, 628, 408), color=(0.2, 0.45, 0.78), fill=(0.97, 0.98, 1.0), width=1.2)
        page.insert_text(fitz.Point(24, 36), "Network map", fontsize=20, color=(0.1, 0.1, 0.1))
        return doc.tobytes()
    finally:
        doc.close()


@pytest.fixture
def isolated_network_service(temp_dir, monkeypatch):
    network_service_module = importlib.import_module("backend.services.network_service")
    monkeypatch.setattr(
        network_service_module,
        "get_local_store",
        lambda: SimpleNamespace(db_path=str(Path(temp_dir) / "network_export.db")),
    )
    service = network_service_module.NetworkService()
    now = "2026-03-13T00:00:00+00:00"
    with service._connect() as conn:
        conn.execute(
            """
            INSERT INTO network_branches(city_code, branch_code, name, is_active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            ("tmn", "tmn-p19", "Тюмень", now, now),
        )
        branch_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        conn.execute(
            """
            INSERT INTO network_sites(branch_id, site_code, name, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, 0, ?, ?)
            """,
            (branch_id, "p19", "Первомайская 19", now, now),
        )
        site_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        conn.commit()
    return service, branch_id, site_id


def _insert_map(service, *, branch_id: int, site_id: int, file_name: str, mime_type: str, file_blob: bytes, title: str) -> int:
    now = "2026-03-13T00:00:00+00:00"
    checksum = hashlib.sha256(file_blob).hexdigest()
    with service._connect() as conn:
        conn.execute(
            """
            INSERT INTO network_maps(
                branch_id, site_id, title, floor_label, file_name, mime_type,
                file_blob, file_size, checksum_sha256, source_path, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                branch_id,
                site_id,
                title,
                "1 этаж",
                file_name,
                mime_type,
                file_blob,
                len(file_blob),
                checksum,
                None,
                now,
                now,
            ),
        )
        map_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
        conn.commit()
    return map_id


def _insert_map_point(service, *, branch_id: int, map_id: int, site_id: int, x_ratio: float, y_ratio: float, label: str, color: str) -> None:
    now = "2026-03-13T00:00:00+00:00"
    with service._connect() as conn:
        conn.execute(
            """
            INSERT INTO network_map_points(
                branch_id, map_id, site_id, device_id, port_id, socket_id,
                x_ratio, y_ratio, label, note, color, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, NULL, ?, ?, ?)
            """,
            (branch_id, map_id, site_id, x_ratio, y_ratio, label, color, now, now),
        )
        conn.commit()


def test_export_map_pdf_builds_pdf_for_pdf_source(isolated_network_service):
    service, branch_id, site_id = isolated_network_service
    source_pdf = _make_pdf_bytes()
    map_id = _insert_map(
        service,
        branch_id=branch_id,
        site_id=site_id,
        file_name="tmn-map.pdf",
        mime_type="application/pdf",
        file_blob=source_pdf,
        title="Схема Тюмень",
    )
    _insert_map_point(service, branch_id=branch_id, map_id=map_id, site_id=site_id, x_ratio=0.25, y_ratio=0.35, label="Точка 1", color="#1976d2")
    _insert_map_point(service, branch_id=branch_id, map_id=map_id, site_id=site_id, x_ratio=0.72, y_ratio=0.62, label="Точка 2", color="#d32f2f")

    exported = service.export_map_pdf(map_id)

    assert exported is not None
    assert exported["mime_type"] == "application/pdf"
    assert exported["file_name"] == "Схема Тюмень-points.pdf"
    assert exported["points_count"] == 2
    assert bytes(exported["file_blob"]).startswith(b"%PDF")
    rendered = fitz.open(stream=exported["file_blob"], filetype="pdf")
    try:
        assert rendered.page_count == 1
        text = rendered[0].get_text("text")
        assert "Точка 1" in text
        assert "Точка 2" in text
    finally:
        rendered.close()


def test_export_map_pdf_builds_pdf_for_image_source_without_points(isolated_network_service):
    service, branch_id, site_id = isolated_network_service
    source_pdf = _make_pdf_bytes()
    png_bytes = service._render_pdf_first_page_to_png(source_pdf)
    assert png_bytes
    map_id = _insert_map(
        service,
        branch_id=branch_id,
        site_id=site_id,
        file_name="tmn-map.png",
        mime_type="image/png",
        file_blob=png_bytes,
        title="План p19",
    )

    exported = service.export_map_pdf(map_id)

    assert exported is not None
    assert exported["mime_type"] == "application/pdf"
    assert exported["points_count"] == 0
    assert bytes(exported["file_blob"]).startswith(b"%PDF")
    rendered = fitz.open(stream=exported["file_blob"], filetype="pdf")
    try:
        assert rendered.page_count == 1
    finally:
        rendered.close()


def test_export_map_pdf_returns_none_for_missing_map(isolated_network_service):
    service, _, _ = isolated_network_service
    assert service.export_map_pdf(9999) is None


def test_export_map_pdf_route_returns_pdf_response(isolated_network_service):
    service, branch_id, site_id = isolated_network_service
    source_pdf = _make_pdf_bytes()
    map_id = _insert_map(
        service,
        branch_id=branch_id,
        site_id=site_id,
        file_name="tmn-map.pdf",
        mime_type="application/pdf",
        file_blob=source_pdf,
        title="Карта экспорта",
    )
    _insert_map_point(service, branch_id=branch_id, map_id=map_id, site_id=site_id, x_ratio=0.4, y_ratio=0.5, label="Порт 12", color="#388e3c")

    app = FastAPI()
    app.include_router(networks.router, prefix="/api/v1/networks")
    app.dependency_overrides[deps.get_current_active_user] = _make_user

    original_service = networks.network_service
    networks.network_service = service
    try:
        client = TestClient(app)
        response = client.get(f"/api/v1/networks/maps/{map_id}/export-pdf")
    finally:
        networks.network_service = original_service

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/pdf")
    assert "attachment;" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF")


def test_export_map_pdf_route_returns_404_for_missing_map():
    app = FastAPI()
    app.include_router(networks.router, prefix="/api/v1/networks")
    app.dependency_overrides[deps.get_current_active_user] = _make_user

    class DummyService:
        @staticmethod
        def export_map_pdf(map_id: int):
            return None

    original_service = networks.network_service
    networks.network_service = DummyService()
    try:
        client = TestClient(app)
        response = client.get("/api/v1/networks/maps/404/export-pdf")
    finally:
        networks.network_service = original_service

    assert response.status_code == 404
    assert response.json()["detail"] == "Map not found"
