from backend.database import queries as db_queries
from backend.database.equipment_current_act_reads import enrich_equipment_current_acts
from backend.models.equipment import EquipmentBase


class FakeDB:
    def __init__(self, rows=None, error=None):
        self.rows = list(rows or [])
        self.error = error
        self.calls = []

    def execute_query(self, sql, params=()):
        self.calls.append((sql, tuple(params)))
        if self.error is not None:
            raise self.error
        return list(self.rows)


def test_enrich_equipment_current_acts_maps_latest_downloadable_act_in_one_batch():
    db = FakeDB([
        {
            "item_id": 11,
            "doc_no": 901,
            "doc_number": "ACT-901",
            "doc_date": "2026-09-04T08:30:00",
        },
    ])
    source = [
        {"ID": 11, "INV_NO": "1001", "EMPL_NO": 42},
        {"ID": 12, "INV_NO": "1002", "EMPL_NO": 42},
    ]

    result = enrich_equipment_current_acts(source, get_db_fn=lambda _db_id: db)

    assert result[0]["current_act_available"] is True
    assert result[0]["current_act_doc_no"] == 901
    assert result[0]["current_act_doc_number"] == "ACT-901"
    assert result[0]["current_act_doc_date"] == "2026-09-04T08:30:00"
    assert result[1]["current_act_available"] is False
    assert result[1]["current_act_doc_no"] is None
    assert len(db.calls) == 1
    sql, params = db.calls[0]
    normalized_sql = " ".join(sql.lower().split())
    assert "row_number() over" in normalized_sql
    assert "d.empl_no = i.empl_no" in normalized_sql
    assert "left join owners item_owner" in normalized_sql
    assert "left join owners document_owner" in normalized_sql
    assert "document_owner.owner_display_name" in normalized_sql
    assert "item_owner.owner_display_name" in normalized_sql
    assert "lower(ltrim(rtrim(document_owner.owner_display_name)))" in normalized_sql
    assert "lower(ltrim(rtrim(item_owner.owner_display_name)))" in normalized_sql
    assert "convert(date, d.doc_date) >= convert(date, current_owner.current_owner_since)" in normalized_sql
    assert "n'передача:%' + nchar(8594) + n' '" in normalized_sql
    assert "n'передача:%-> '" in normalized_sql
    assert "n'акт ' + convert(nvarchar(32), d.doc_no) + n' % - '" in normalized_sql
    assert "from ci_history h" in normalized_sql
    assert "h.empl_no_new = i.empl_no" in normalized_sql
    assert "h.empl_no_old is null" in normalized_sql
    assert "h.empl_no_old <> h.empl_no_new" in normalized_sql
    assert "h.ch_comment as current_owner_comment" in normalized_sql
    assert "current_owner.current_owner_comment" in normalized_sql
    assert "as matches_current_act" not in normalized_sql
    assert "convert(nvarchar(32), d.doc_no)" in normalized_sql
    assert "n'[^0-9]%'" in normalized_sql
    assert "d.empl_no is null" in normalized_sql
    assert "dateadd(" in normalized_sql
    assert "minute, -10, current_owner.current_owner_since" in normalized_sql
    assert "convert(date, d.doc_date) = convert(date, current_owner.current_owner_since)" in normalized_sql
    assert "item_owner.owner_lname" in normalized_sql
    assert "lower(coalesce(d.addinfo, n'')) like" in normalized_sql
    assert "d.create_date >= current_owner.current_owner_since" in normalized_sql
    assert "not like n'%аннулир%'" in normalized_sql
    assert "from files" in normalized_sql
    assert params == (11, 12)


def test_enrich_equipment_current_acts_marks_lookup_as_unknown_on_query_failure():
    db = FakeDB(error=RuntimeError("sql unavailable"))

    result = enrich_equipment_current_acts(
        [{"ID": 11, "INV_NO": "1001", "EMPL_NO": 42}],
        get_db_fn=lambda _db_id: db,
    )

    assert result[0]["current_act_available"] is None
    assert result[0]["current_act_doc_no"] is None


def test_employee_equipment_ui_lookup_keeps_current_act_fields_in_api_model(monkeypatch):
    equipment_row = {
        "id": 11,
        "inv_no": "1001",
        "empl_no": 42,
        "employee_name": "Ivan Petrov",
    }
    act_row = {
        "item_id": 11,
        "doc_no": 901,
        "doc_number": "ACT-901",
        "doc_date": "2026-09-04T08:30:00",
    }

    class SequenceDB:
        def __init__(self):
            self.responses = [[equipment_row], [act_row]]

        def execute_query(self, _sql, _params=()):
            return self.responses.pop(0)

    db = SequenceDB()
    monkeypatch.setattr(db_queries, "get_db", lambda _db_id=None: db)

    result = db_queries.get_equipment_by_owner_with_current_acts(42, db_id="main")
    serialized = EquipmentBase(**result[0]).model_dump()

    assert serialized["current_act_available"] is True
    assert serialized["current_act_doc_no"] == 901
    assert serialized["current_act_doc_number"] == "ACT-901"
    assert serialized["current_act_doc_date"].isoformat() == "2026-09-04T08:30:00"
