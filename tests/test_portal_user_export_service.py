"""Exercise the portal CSV boundary without connecting to 1C or uploading files."""
import csv
import sys
from types import SimpleNamespace

import pytest

from backend.services import portal_user_export_service as export_module


@pytest.mark.parametrize(
    "work,expected",
    [
        ([{"value": "1234"}], "1234"),
        ([], ""),
        (None, ""),
        ([{"value": "   "}], ""),
        ([{"value": ""}, {"value": "5678"}], "5678"),
        ([{"normalized": "+79000000001"}], "+79000000001"),
    ],
)
def test_export_file_never_substitutes_personal_phone(monkeypatch, tmp_path, work, expected):
    personal_phone = "+79000000002"
    phones = {"personal": [{"value": personal_phone}]}
    if work is not None:
        phones["work"] = work
    source = SimpleNamespace(
        _connect_1c=lambda: object(),
        _load_employees=lambda connection: [
            {"_employee_code": "test-001", "full_name": "Тестовый Сотрудник"}
        ],
        _load_phones=lambda connection: {"test-001": phones},
        _load_emails=lambda connection: {
            "test-001": {"work": [{"value": "synthetic-export-test@zsgp.ru"}]}
        },
        _load_personal_data=lambda connection: {},
    )
    monkeypatch.setitem(sys.modules, "pythoncom", SimpleNamespace(
        CoInitialize=lambda: None, CoUninitialize=lambda: None,
    ))
    monkeypatch.setattr(export_module, "execute_query", lambda *args: SimpleNamespace(Next=lambda: False))

    output = tmp_path / "users.csv"
    summary = export_module.PortalUserExportService(source).export(str(output))

    with output.open(encoding="utf-8", newline="") as handle:
        rows = list(csv.reader(handle, delimiter=";"))
    assert rows[0] == export_module.PORTAL_CSV_HEADER
    assert len(rows) == 2 and len(rows[1]) == 15
    assert rows[1][0] == "test-001"
    assert rows[1][10] == expected
    assert rows[1][11] == "synthetic-export-test@zsgp.ru"
    assert personal_phone not in output.read_text(encoding="utf-8")
    assert summary["rows"] == summary["with_email"] == 1


def test_deliver_without_ssh_target_fails_before_subprocess(monkeypatch):
    monkeypatch.delenv("PORTAL_EXPORT_SSH_TARGET", raising=False)
    calls = []
    monkeypatch.setattr(export_module.subprocess, "run", lambda *a, **kw: calls.append(a[0]))

    with pytest.raises(RuntimeError):
        export_module.PortalUserExportService.deliver("x.csv")
    assert calls == []


def test_deliver_uses_batch_mode_and_env_target(monkeypatch):
    monkeypatch.setenv("PORTAL_EXPORT_SSH_TARGET", "bitrix@host")
    monkeypatch.delenv("PORTAL_EXPORT_REMOTE_PATH", raising=False)
    calls = []
    monkeypatch.setattr(export_module.subprocess, "run", lambda *a, **kw: calls.append(a[0]))

    result = export_module.PortalUserExportService.deliver("x.csv")

    assert calls[0][:3] == ["scp", "-o", "BatchMode=yes"]
    assert calls[0][-1] == f"bitrix@host:{export_module.DEFAULT_REMOTE_PATH}.part"
    assert calls[1][:4] == ["ssh", "-o", "BatchMode=yes", "bitrix@host"]
    assert result["delivered_to"] == f"bitrix@host:{export_module.DEFAULT_REMOTE_PATH}"


def test_deliver_refuses_rows_below_absolute_floor(monkeypatch, tmp_path):
    """A truncated feed must never ship: it deactivates portal users."""
    monkeypatch.setenv("PORTAL_EXPORT_SSH_TARGET", "bitrix@host")
    monkeypatch.setenv("PORTAL_EXPORT_MIN_ROWS", "500")
    monkeypatch.setenv("PORTAL_EXPORT_STATE_PATH", str(tmp_path / "state.json"))
    calls = []
    monkeypatch.setattr(export_module.subprocess, "run", lambda *a, **kw: calls.append(a[0]))

    with pytest.raises(RuntimeError, match="below the required"):
        export_module.PortalUserExportService.deliver("x.csv", row_count=120)
    assert calls == []


def test_deliver_refuses_rows_below_relative_floor(monkeypatch, tmp_path):
    """80% of the last good feed raises the floor above the absolute minimum."""
    state_file = tmp_path / "state.json"
    state_file.write_text('{"last_good_rows": 1000}', encoding="utf-8")
    monkeypatch.setenv("PORTAL_EXPORT_SSH_TARGET", "bitrix@host")
    monkeypatch.setenv("PORTAL_EXPORT_STATE_PATH", str(state_file))
    calls = []
    monkeypatch.setattr(export_module.subprocess, "run", lambda *a, **kw: calls.append(a[0]))

    assert export_module.PortalUserExportService.min_required_rows() == 800
    with pytest.raises(RuntimeError):
        export_module.PortalUserExportService.deliver("x.csv", row_count=700)
    assert calls == []


def test_deliver_saves_last_good_rows_after_success(monkeypatch, tmp_path):
    state_file = tmp_path / "state.json"
    monkeypatch.setenv("PORTAL_EXPORT_SSH_TARGET", "bitrix@host")
    monkeypatch.setenv("PORTAL_EXPORT_STATE_PATH", str(state_file))
    monkeypatch.setattr(export_module.subprocess, "run", lambda *a, **kw: None)

    export_module.PortalUserExportService.deliver("x.csv", row_count=930)

    import json

    saved = json.loads(state_file.read_text(encoding="utf-8"))
    assert saved["last_good_rows"] == 930


def test_send_alert_skips_when_unconfigured(monkeypatch, caplog):
    monkeypatch.delenv("PORTAL_EXPORT_ALERT_EMAIL", raising=False)
    monkeypatch.delenv("SMTP_SERVER", raising=False)
    assert export_module.PortalUserExportService.send_alert("s", "b") is False
