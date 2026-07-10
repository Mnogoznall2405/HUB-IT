import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import act_upload_service  # noqa: E402
from backend.database import queries  # noqa: E402
from backend.utils.person_names import to_short_fio  # noqa: E402


class _UploadedActFakeCursor:
    def __init__(self):
        self._one = None
        self._many = []
        self.inserted_docs_params = None

    def execute(self, query, params=None):
        text = " ".join(str(query or "").lower().split())
        self._one = None
        self._many = []

        if "from docs_list dl inner join docs d" in text and "dl.item_id in" in text:
            self._many = []
        elif "select i.id, i.branch_no, i.loc_no" in text:
            self._many = [(101, 7, 9)]
        elif "select top 1 d.type_no, d.comp_no" in text:
            self._one = (99, 0, None, None, None, None)
        elif "select top 1 d.type_no" in text and "n'%акт%'" in text:
            self._one = (10,) if "n'%аннулир%'" in text else (99,)
        elif "select isnull(max(doc_no), 0) + 1 from docs" in text:
            self._one = (1464,)
        elif "insert into docs (" in text:
            self.inserted_docs_params = tuple(params or ())
        elif "select i.id, i.descr" in text:
            self._many = [(101, "")]
        elif "select top 1 d.type_no" in text and "n'%аннулирован%'" in text:
            self._one = (99,)
        elif "select isnull(max(file_no), 0) + 1 from files" in text:
            self._one = (501,)
        return self

    def fetchone(self):
        return self._one

    def fetchall(self):
        return list(self._many)


class _UploadedActFakeConnection:
    def __init__(self):
        self.cursor_obj = _UploadedActFakeCursor()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def cursor(self):
        return self.cursor_obj


class _UploadedActFakeDB:
    def __init__(self):
        self.connection = _UploadedActFakeConnection()

    def get_connection(self):
        return self.connection


def test_build_uploaded_act_addinfo_uses_act_line_format():
    add_info = queries._build_uploaded_act_addinfo(
        1464,
        "Санду Андрей Олегович",
        "Козловский Андрей Михайлович",
        datetime(2026, 6, 29),
    )

    assert add_info == "Акт 1464 Санду А.О. - Козловский А.М. от 29.06.2026"


def test_uploaded_act_items_descr_matches_document_addinfo_format():
    line = queries._build_uploaded_act_addinfo(
        1464,
        "Санду Андрей Олегович",
        "Козловский Андрей Михайлович",
        datetime(2026, 6, 29),
    )
    assert line == "Акт 1464 Санду А.О. - Козловский А.М. от 29.06.2026"
    assert line.startswith("Акт 1464 ")
    assert "->" not in line
    assert ": акт №" not in line


def test_uploaded_act_file_name_uses_act_note_and_original_extension():
    line = queries._build_uploaded_act_addinfo(
        1464,
        "Санду Андрей Олегович",
        "Козловский Андрей Михайлович",
        datetime(2026, 6, 29),
    )

    file_name = queries._build_uploaded_act_file_name(line, "original_scan.PDF")

    assert file_name == "Акт 1464 Санду А.О. - Козловский А.М. от 29.06.2026.PDF"


def test_uploaded_act_file_name_falls_back_to_pdf_extension():
    assert queries._build_uploaded_act_file_name("Акт 1464", "original") == "Акт 1464.pdf"


def test_to_short_fio():
    assert to_short_fio("Иванов Иван Иванович") == "Иванов И.И."
    assert to_short_fio("Санду А.О.") == "Санду А.О."


def test_legacy_sqlserver_text_preserves_crlf():
    text = queries._legacy_sqlserver_text("Передача\r\nОт: Ivan")
    assert "\r\n" in text
    assert text.splitlines() == ["Передача", "От: Ivan"]


def test_legacy_sqlserver_text_normalizes_upload_act_arrows_for_cp1251(monkeypatch):
    monkeypatch.setenv("SQL_CHAR_ENCODING", "cp1251")

    text = queries._legacy_sqlserver_text("Передача: Иван → Петр; акт №1→№2 ✅")

    assert "→" not in text
    assert "->" in text
    text.encode("cp1251")


def test_create_uploaded_transfer_act_does_not_copy_annulled_doc_type(monkeypatch):
    fake_db = _UploadedActFakeDB()
    monkeypatch.setattr(queries, "get_db", lambda db_id=None: fake_db)

    result = queries.create_uploaded_transfer_act(
        from_employee="Old Owner",
        to_employee="",
        doc_date=datetime(2026, 6, 29),
        equipment_item_ids=[101],
        file_name="signed.pdf",
        file_bytes=b"%PDF-1.4",
        created_by="tester",
        db_id="main",
    )

    assert result["doc_no"] == 1464
    assert fake_db.connection.cursor_obj.inserted_docs_params is not None
    assert fake_db.connection.cursor_obj.inserted_docs_params[1] == 10


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
