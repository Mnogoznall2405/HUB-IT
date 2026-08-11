from __future__ import annotations


class _Cursor:
    def __init__(self, *, rows=None, row=None) -> None:
        self._rows = list(rows or [])
        self._row = row

    def fetchall(self):
        return self._rows

    def fetchone(self):
        return self._row


class _RecordingConnection:
    def __init__(self) -> None:
        self.calls = []

    def execute(self, sql, params=None):
        normalized = " ".join(str(sql).split())
        self.calls.append((normalized, list(params or [])))
        if "GROUP BY status, source_kind" in normalized:
            return _Cursor(rows=[{"status": "done_clean", "source_kind": "text", "c": 10}])
        if "finished_at >= ?" in normalized:
            return _Cursor(row={"c": 7})
        if "error_text='OCR timeout'" in normalized:
            return _Cursor(row={"c": 2})
        raise AssertionError(f"Unexpected query: {normalized}")


def test_postgres_dashboard_uses_index_friendly_job_aggregates():
    from scan_server.database import _load_dashboard_job_aggregates

    conn = _RecordingConnection()
    rows, completed_24h, ocr_timeouts = _load_dashboard_job_aggregates(
        conn,
        is_postgres=True,
        performance_start=123,
    )

    assert rows == [{"status": "done_clean", "source_kind": "text", "c": 10}]
    assert completed_24h == 7
    assert ocr_timeouts == 2
    assert len(conn.calls) == 3
    group_query = conn.calls[0][0]
    assert "COUNT(*) AS c" in group_query
    assert "finished_at" not in group_query
    assert "error_text" not in group_query
