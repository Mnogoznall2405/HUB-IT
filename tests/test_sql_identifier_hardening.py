from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

queries_module = importlib.import_module("backend.database.queries")
scan_db_module = importlib.import_module("scan_server.database")


def test_sqlserver_identifier_bracket_quotes_metadata_names() -> None:
    assert queries_module._quote_sqlserver_identifier("FILES") == "[FILES]"
    assert queries_module._quote_sqlserver_identifier("FILE]NAME") == "[FILE]]NAME]"


def test_sqlserver_identifier_rejects_control_characters() -> None:
    with pytest.raises(ValueError):
        queries_module._quote_sqlserver_identifier("FILES\nWHERE 1=1")


def test_scan_runtime_schema_patch_allows_known_columns_only() -> None:
    assert scan_db_module._require_scan_runtime_column("scan_jobs", "event_id") == (
        "scan_jobs",
        "event_id",
    )
    assert scan_db_module._quote_sqlite_identifier("scan_jobs") == '"scan_jobs"'

    with pytest.raises(ValueError):
        scan_db_module._require_scan_runtime_column("scan_jobs", "id); DROP TABLE scan_jobs; --")

    with pytest.raises(ValueError):
        scan_db_module._require_scan_runtime_column("scan_unknown", "event_id")


def test_scan_sqlite_identifier_rejects_unsafe_names() -> None:
    with pytest.raises(ValueError):
        scan_db_module._quote_sqlite_identifier("scan_jobs; DROP TABLE scan_jobs")
