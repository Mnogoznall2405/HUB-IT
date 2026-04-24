import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import act_upload_service  # noqa: E402


def test_parse_inv_nos_from_text_ignores_word_garbage_and_dates():
    pdf_text = (
        "ID Тип оборудования\n"
        "Инвентарны\n"
        "й номер\n"
        "ent\n"
        "ентарны\n"
        "номер\n"
        "1 Принтер Xerox VersaLink B405DN MFP 3718936461 Отдел технической поддержки 101795\n"
        "17.03.2026\n"
        "Акт №123\n"
    )

    assert act_upload_service._parse_inv_nos_from_text(pdf_text) == ["3718936461", "101795"]


def test_create_uploaded_act_draft_keeps_only_confirmed_numeric_inv_nos(monkeypatch):
    pdf_text = (
        "ID Тип оборудования\n"
        "Инвентарны\n"
        "й номер\n"
        "1 Принтер Xerox VersaLink B405DN MFP 3718936461 Отдел технической поддержки 101795\n"
        "17.03.2026\n"
        "Акт №12345\n"
    )

    monkeypatch.setattr(act_upload_service, "_extract_pdf_text", lambda _file_bytes: (pdf_text, []))
    monkeypatch.setattr(
        act_upload_service,
        "_call_openrouter_act_parser",
        lambda **kwargs: (
            {
                "document_title": "Акт",
                "from_employee": "Иванов Иван Иванович",
                "to_employee": "Петров Петр Петрович",
                "doc_date": "2026-03-17",
                "equipment_inv_nos": ["номер", "101795", "1"],
            },
            [],
        ),
    )
    monkeypatch.setattr(
        act_upload_service.queries,
        "get_equipment_items_by_inv_nos",
        lambda inv_nos, db_id=None: [
            {"item_id": 55, "inv_no": "101795", "serial_no": "SER-1", "model_name": "Xerox VersaLink B405DN"}
        ]
        if "101795" in inv_nos
        else [],
    )
    monkeypatch.setattr(act_upload_service.queries, "get_equipment_items_by_ids", lambda ids, db_id=None: [])

    draft = act_upload_service.create_uploaded_act_draft(
        file_bytes=b"%PDF",
        file_name="act.pdf",
        db_id="main",
        created_by="tester",
    )

    assert draft["equipment_inv_nos"] == ["101795"]
    assert [item["inv_no"] for item in draft["resolved_items"]] == ["101795"]
    assert any("отброшены нечисловые кандидаты" in warning.lower() for warning in draft["warnings"])


def test_create_uploaded_act_draft_filters_fallback_candidates_by_database(monkeypatch):
    pdf_text = (
        "ID Тип оборудования\n"
        "Инвентарны\n"
        "й номер\n"
        "1 Принтер Xerox VersaLink B405DN MFP 3718936461 Отдел технической поддержки 101795\n"
        "17.03.2026\n"
    )

    monkeypatch.setattr(act_upload_service, "_extract_pdf_text", lambda _file_bytes: (pdf_text, []))
    monkeypatch.setattr(act_upload_service, "_call_openrouter_act_parser", lambda **kwargs: ({}, []))
    monkeypatch.setattr(
        act_upload_service.queries,
        "get_equipment_items_by_inv_nos",
        lambda inv_nos, db_id=None: [
            {"item_id": 55, "inv_no": "101795", "serial_no": "SER-1", "model_name": "Xerox VersaLink B405DN"}
        ]
        if "101795" in inv_nos
        else [],
    )
    monkeypatch.setattr(act_upload_service.queries, "get_equipment_items_by_ids", lambda ids, db_id=None: [])

    draft = act_upload_service.create_uploaded_act_draft(
        file_bytes=b"%PDF",
        file_name="act.pdf",
        db_id="main",
        created_by="tester",
    )

    assert draft["equipment_inv_nos"] == ["101795"]
    assert [item["inv_no"] for item in draft["resolved_items"]] == ["101795"]
    assert any("fallback-правилам" in warning for warning in draft["warnings"])
    assert any("подтвержденные в текущей БД" in warning for warning in draft["warnings"])


def test_create_uploaded_act_draft_uses_legacy_item_ids_when_model_inv_nos_not_confirmed(monkeypatch):
    monkeypatch.setattr(act_upload_service, "_extract_pdf_text", lambda _file_bytes: ("", []))
    monkeypatch.setattr(
        act_upload_service,
        "_call_openrouter_act_parser",
        lambda **kwargs: (
            {
                "document_title": "Акт",
                "from_employee": "",
                "to_employee": "",
                "doc_date": "2026-03-17",
                "equipment_inv_nos": ["555555"],
                "equipment_item_ids": [77],
            },
            [],
        ),
    )
    monkeypatch.setattr(
        act_upload_service.queries,
        "get_equipment_items_by_ids",
        lambda ids, db_id=None: [{"item_id": 77, "inv_no": "101795"}] if ids == [77] else [],
    )
    monkeypatch.setattr(
        act_upload_service.queries,
        "get_equipment_items_by_inv_nos",
        lambda inv_nos, db_id=None: (
            [{"item_id": 77, "inv_no": "101795", "serial_no": "SER-1", "model_name": "Xerox VersaLink B405DN"}]
            if inv_nos == ["101795"]
            else []
        ),
    )

    draft = act_upload_service.create_uploaded_act_draft(
        file_bytes=b"%PDF",
        file_name="act.pdf",
        db_id="main",
        created_by="tester",
    )

    assert draft["equipment_inv_nos"] == ["101795"]
    assert [item["inv_no"] for item in draft["resolved_items"]] == ["101795"]
    assert any("legacy-конвертацию equipment_item_ids" in warning for warning in draft["warnings"])
