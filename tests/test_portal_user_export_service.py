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
