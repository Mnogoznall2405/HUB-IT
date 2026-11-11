"""Transfer -> durable job -> PDF download through the real application routes.

SQL Server, reminders and recent-card writes are isolated; jobs use a private
SQLite database. Conversion failures are injected at the converter boundary.
"""
from __future__ import annotations

import importlib
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def transfer_http(monkeypatch, tmp_path):
    # Some imported services retain a local-store reference during construction.
    # Bind it to this harness before importing the production router.
    import local_store

    monkeypatch.setattr(local_store, "_STORE_SINGLETON", None)
    local_store.get_local_store(data_dir=tmp_path / "local_store")
    from backend.api import deps
    from backend.api.v1 import equipment
    from backend.appdb.db import app_session, get_app_engine
    from backend.appdb.models import AppTransferActJob
    from backend.services import equipment_transfer_execution_service as execution
    from backend.services import transfer_act_job_service as jobs
    from backend.services import transfer_service as acts

    # Mount the production router without starting unrelated runtime services.
    app = FastAPI()
    app.include_router(equipment.router, prefix="/api/v1/equipment")
    db_path = tmp_path / "app.db"
    db_url = f"sqlite:///{db_path.as_posix()}"
    engine = get_app_engine(db_url)
    AppTransferActJob.__table__.create(engine)
    monkeypatch.setattr(jobs, "_app_db_available", lambda: True)
    monkeypatch.setattr(jobs, "app_session", lambda: app_session(db_url))
    monkeypatch.setattr(acts, "DEFAULT_ACTS_DIR", tmp_path / "acts")
    monkeypatch.setattr(acts, "_ACT_STORE", {})
    monkeypatch.setattr(execution, "invalidate_equipment_cache", lambda *args: None)
    monkeypatch.setattr(equipment, "_touch_recent_card_safely", lambda **kwargs: None)
    reminders = []
    monkeypatch.setattr(
        execution.transfer_act_reminder_service,
        "create_transfer_reminder",
        lambda **kwargs: reminders.append(kwargs) or {"created": True},
    )
    monkeypatch.setattr(
        execution.queries, "get_owner_by_no",
        lambda *args: {"OWNER_NO": 99, "OWNER_DISPLAY_NAME": "Получатель теста", "OWNER_DEPT": "ИТ"},
    )
    monkeypatch.setattr(execution.queries, "get_owner_email_by_no", lambda *args: None)
    moves = []

    def move(**kwargs):
        moves.append(kwargs)
        return {
            "success": True, "inv_no": kwargs["inv_no"],
            "old_employee_no": 1, "old_employee_name": "Отправитель теста",
            "new_employee_no": kwargs["new_employee_no"], "new_employee_name": kwargs["new_employee_name"],
            "type_name": "Монитор", "model_name": "TEST-MODEL", "serial_no": "TEST-SN",
        }

    monkeypatch.setattr(execution.queries, "transfer_equipment_by_inv_with_history", move)
    overrides = dict(app.dependency_overrides)
    app.dependency_overrides[deps.get_current_active_user] = lambda: SimpleNamespace(
        id=15, username="pdf-test", role="admin", permissions=[], is_active=True,
    )
    app.dependency_overrides[equipment.get_request_scoped_database_id] = lambda: "main"
    try:
        yield SimpleNamespace(
            client=TestClient(app, base_url="https://testserver"),
            acts=acts, jobs=jobs, equipment=equipment, moves=moves, reminders=reminders,
            directory=tmp_path / "acts",
        )
    finally:
        app.dependency_overrides.clear()
        app.dependency_overrides.update(overrides)
        engine.dispose()


def _transfer(ctx, operation_id="web-pdf-regression-001"):
    response = ctx.client.post("/api/v1/equipment/transfer", json={
        "operation_id": operation_id, "inv_nos": ["1001"],
        "new_employee_no": 99, "new_employee": "Получатель теста",
    })
    assert response.status_code == 200, response.text
    status = ctx.client.get(f"/api/v1/equipment/transfer/act-jobs/{operation_id}")
    assert status.status_code == 200, status.text
    return status.json()


def test_transfer_downloads_real_pdf_when_word_export_is_broken(transfer_http, monkeypatch):
    ctx = transfer_http
    preview = importlib.import_module("backend.services.mail_attachment_preview_service")
    try:
        preview.resolve_soffice_path()
    except preview.MailAttachmentPreviewError:
        pytest.skip("Real LibreOffice integration requires an installed converter")
    original_run = subprocess.run
    converter_calls = []

    def converter(command, **kwargs):
        converter_calls.append(command)
        if "-c" in command:  # Word COM export from the reported incident fails.
            return subprocess.CompletedProcess(command, 1, stdout="", stderr="Word SaveAs failed")
        return original_run(command, **kwargs)

    monkeypatch.setattr(subprocess, "run", converter)
    result = _transfer(ctx)
    assert result["job_status"] == "done", result
    assert len(result["acts"]) == 1
    act = result["acts"][0]
    assert act["file_type"] == "pdf"
    assert act["file_name"].endswith(".pdf")
    download = ctx.client.get(f"/api/v1/equipment/transfer/act/{act['act_id']}")
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/pdf"
    assert ".pdf" in download.headers["content-disposition"]
    import fitz

    with fitz.open(stream=download.content, filetype="pdf") as document:
        assert len(document) >= 1
        text = "".join(page.get_text() for page in document)
        assert "TEST-MODEL" in text and "1001" in text
        assert "Получатель теста" in text and "Отправитель теста" in text
    _transfer(ctx)  # Repeated request reads the completed job, without another move.
    assert len(ctx.moves) == 1 and len(ctx.reminders) == 1
    assert len(converter_calls) == 1


@pytest.mark.parametrize("failure", ["exit", "timeout", "missing", "invalid", "truncated", "unavailable"])
def test_pdf_failure_preserves_transfer_and_never_reports_docx_success(transfer_http, monkeypatch, failure):
    ctx = transfer_http
    monkeypatch.setattr(ctx.acts, "resolve_soffice_path", lambda: Path("test-soffice.exe"))
    if failure == "unavailable":
        def unavailable():
            raise FileNotFoundError("Converter is unavailable")
        monkeypatch.setattr(ctx.acts, "resolve_soffice_path", unavailable)

    def converter(command, **kwargs):
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, kwargs["timeout"])
        if failure in {"invalid", "truncated"} and "--outdir" in command:
            outdir = Path(command[command.index("--outdir") + 1])
            content = b"broken PDF" if failure == "invalid" else b"%PDF-1.7\ntruncated\n%%EOF"
            (outdir / (Path(command[-1]).stem + ".pdf")).write_bytes(content)
        return subprocess.CompletedProcess(command, 1 if failure == "exit" else 0, stdout="", stderr="test failure")

    monkeypatch.setattr(subprocess, "run", converter)
    result = _transfer(ctx)
    assert result["job_status"] == "failed", result
    assert result["success_count"] == 1 and result["failed_count"] == 0
    assert result["transferred"][0]["inv_no"] == "1001"
    assert result["acts"] == [] and result["retry_inv_nos"] == []
    assert "PDF" in result["job_error"] and "Перемещение выполнено" in result["job_error"]
    assert len(ctx.moves) == 1 and ctx.reminders == []
    assert list(ctx.directory.glob("*.docx"))
    assert list(ctx.directory.glob("*.pdf")) == []
    _transfer(ctx)
    assert len(ctx.moves) == 1


def test_old_docx_download_is_recovered_as_pdf_without_a_transfer(transfer_http, monkeypatch):
    ctx = transfer_http
    from pypdf import PdfWriter
    monkeypatch.setattr(ctx.acts, "resolve_soffice_path", lambda: Path("test-soffice.exe"))

    docx, _ = ctx.acts._build_docx_act(
        "Отправитель теста", "Получатель теста", "ИТ", [{"inv_no": "1001"}],
        deterministic_act_id="old-docx-act",
    )
    ctx.acts.register_act_records([{
        "act_id": "old-docx-act", "file_path": str(docx), "file_name": docx.name,
        "file_type": "docx", "db_id": "main",
    }])
    calls = []

    def converter(command, **kwargs):
        calls.append(command)
        outdir = Path(command[command.index("--outdir") + 1])
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        with (outdir / (Path(command[-1]).stem + ".pdf")).open("wb") as stream:
            writer.write(stream)
        return subprocess.CompletedProcess(command, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", converter)
    for _ in range(2):
        response = ctx.client.get("/api/v1/equipment/transfer/act/old-docx-act")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert ".pdf" in response.headers["content-disposition"]
        assert response.content.startswith(b"%PDF-")
    assert len(calls) == 1 and ctx.moves == []
    assert docx.exists()  # Durable older job records may still point at the source.


def test_old_docx_conversion_failure_returns_error_without_downloading_docx(transfer_http, monkeypatch):
    ctx = transfer_http
    monkeypatch.setattr(ctx.acts, "resolve_soffice_path", lambda: Path("test-soffice.exe"))
    docx, _ = ctx.acts._build_docx_act(
        "Отправитель теста", "Получатель теста", "ИТ", [{"inv_no": "1001"}],
        deterministic_act_id="failed-old-docx",
    )
    ctx.acts.register_act_records([{
        "act_id": "failed-old-docx", "file_path": str(docx), "file_name": docx.name, "file_type": "docx",
    }])
    monkeypatch.setattr(subprocess, "run", lambda command, **kwargs: subprocess.CompletedProcess(command, 1, "", "test"))
    response = ctx.client.get("/api/v1/equipment/transfer/act/failed-old-docx")
    assert response.status_code == 503
    assert "PDF" in response.json()["detail"]
    assert ctx.moves == [] and docx.exists()


def test_document_only_conversion_failure_is_not_a_successful_empty_act(transfer_http, monkeypatch):
    ctx = transfer_http
    monkeypatch.setattr(ctx.acts, "resolve_soffice_path", lambda: Path("test-soffice.exe"))
    monkeypatch.setattr(ctx.equipment.queries, "get_transfer_act_items_by_inv_nos", lambda *args: [{
        "inv_no": "1001", "employee_name": "Получатель теста", "type_name": "Монитор",
    }])
    monkeypatch.setattr(subprocess, "run", lambda command, **kwargs: subprocess.CompletedProcess(command, 1, "", "test"))
    response = ctx.client.post("/api/v1/equipment/transfer/act-only", json={
        "operation_id": "web-pdf-document-only", "inv_nos": ["1001"], "issuer_employee": "Отправитель теста",
    })
    assert response.status_code == 200, response.text
    response = ctx.client.get("/api/v1/equipment/transfer/act-jobs/web-pdf-document-only")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["job_status"] == "failed" and "PDF" in result["job_error"]
    assert result["acts"] == [] and ctx.moves == [] and ctx.reminders == []
