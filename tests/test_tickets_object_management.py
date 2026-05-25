"""Tests for TicketsService object management (task 4.2).

Tests cover:
- list_objects() with include_inactive parameter
- create_object() with validation and uniqueness
- update_object() with field updates and activation/deactivation
- Admin-only access enforcement
- Code constraint (2-10 chars)
"""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


from backend.appdb.models import AppBase
from backend.appdb.tickets_models import TicketObject
from backend.services.tickets_service import TicketsService


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'tickets_objects.db').as_posix()}"


def _admin_user() -> dict:
    return {"id": 1, "username": "admin", "role": "admin"}


def _viewer_user() -> dict:
    return {"id": 2, "username": "viewer", "role": "viewer"}


def _operator_user() -> dict:
    return {"id": 3, "username": "operator", "role": "operator"}


@pytest.fixture
def service(temp_dir, monkeypatch):
    """Create a TicketsService with a fresh SQLite database."""
    import backend.appdb.db as appdb

    url = _sqlite_url(temp_dir)

    # Clear cached engines/session factories so we get a fresh one
    appdb._engines.clear()
    appdb._session_factories.clear()
    appdb._initialized_schema_urls.clear()

    # Create tables using the engine with schema_translate_map to strip 'app' schema for SQLite
    from sqlalchemy import create_engine, event
    from sqlalchemy.orm import sessionmaker
    from contextlib import contextmanager

    engine = create_engine(
        url,
        execution_options={"schema_translate_map": {"app": None, "system": None}},
    )

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    # Create only the TicketObject table (and users for FK)
    AppBase.metadata.create_all(engine, checkfirst=True)

    SessionLocal = sessionmaker(bind=engine)

    @contextmanager
    def _test_app_session(database_url=None):
        session = SessionLocal()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr("backend.services.tickets_service.app_session", _test_app_session)

    return TicketsService()


# ---------------------------------------------------------------------------
# list_objects tests
# ---------------------------------------------------------------------------


class TestListObjects:
    def test_list_objects_empty(self, service):
        result = service.list_objects()
        assert result == []

    def test_list_objects_returns_active_only_by_default(self, service):
        # Create active and inactive objects
        service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        service.create_object(
            {"code": "MAG", "name": "Магадан", "region": "Дальний Восток"},
            _admin_user(),
        )
        # Deactivate one
        objects = service.list_objects()
        service.update_object(objects[1]["id"], {"is_active": False}, _admin_user())

        active = service.list_objects(include_inactive=False)
        assert len(active) == 1
        assert active[0]["code"] == "KAM"

    def test_list_objects_include_inactive(self, service):
        service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        service.create_object(
            {"code": "MAG", "name": "Магадан", "region": "Дальний Восток"},
            _admin_user(),
        )
        objects = service.list_objects()
        service.update_object(objects[1]["id"], {"is_active": False}, _admin_user())

        all_objects = service.list_objects(include_inactive=True)
        assert len(all_objects) == 2

    def test_list_objects_sorted_by_name(self, service):
        service.create_object(
            {"code": "TIK", "name": "Тикси", "region": "Якутия"},
            _admin_user(),
        )
        service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        objects = service.list_objects()
        assert objects[0]["name"] == "Камчатка"
        assert objects[1]["name"] == "Тикси"


# ---------------------------------------------------------------------------
# create_object tests
# ---------------------------------------------------------------------------


class TestCreateObject:
    def test_create_object_success(self, service):
        result = service.create_object(
            {
                "code": "KAM",
                "name": "Камчатка",
                "short_name": "Кам",
                "region": "Дальний Восток",
                "default_assignee_id": None,
            },
            _admin_user(),
        )
        assert result["code"] == "KAM"
        assert result["name"] == "Камчатка"
        assert result["short_name"] == "Кам"
        assert result["region"] == "Дальний Восток"
        assert result["is_active"] is True
        assert result["id"] is not None

    def test_create_object_minimal_fields(self, service):
        result = service.create_object(
            {"code": "MG", "name": "Магадан", "region": "Дальний Восток"},
            _admin_user(),
        )
        assert result["code"] == "MG"
        assert result["short_name"] is None

    def test_create_object_code_too_short(self, service):
        with pytest.raises(ValueError, match="2 and 10"):
            service.create_object(
                {"code": "X", "name": "Test", "region": "Test"},
                _admin_user(),
            )

    def test_create_object_code_too_long(self, service):
        with pytest.raises(ValueError, match="2 and 10"):
            service.create_object(
                {"code": "ABCDEFGHIJK", "name": "Test", "region": "Test"},
                _admin_user(),
            )

    def test_create_object_code_exact_min(self, service):
        result = service.create_object(
            {"code": "AB", "name": "Test", "region": "Test"},
            _admin_user(),
        )
        assert result["code"] == "AB"

    def test_create_object_code_exact_max(self, service):
        result = service.create_object(
            {"code": "ABCDEFGHIJ", "name": "Test", "region": "Test"},
            _admin_user(),
        )
        assert result["code"] == "ABCDEFGHIJ"

    def test_create_object_duplicate_code(self, service):
        service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        with pytest.raises(ValueError, match="already exists"):
            service.create_object(
                {"code": "KAM", "name": "Другой объект", "region": "Другой регион"},
                _admin_user(),
            )

    def test_create_object_empty_name(self, service):
        with pytest.raises(ValueError, match="name is required"):
            service.create_object(
                {"code": "TST", "name": "", "region": "Test"},
                _admin_user(),
            )

    def test_create_object_empty_region(self, service):
        with pytest.raises(ValueError, match="region is required"):
            service.create_object(
                {"code": "TST", "name": "Test", "region": ""},
                _admin_user(),
            )

    def test_create_object_name_too_long(self, service):
        with pytest.raises(ValueError, match="150 characters"):
            service.create_object(
                {"code": "TST", "name": "A" * 151, "region": "Test"},
                _admin_user(),
            )

    def test_create_object_region_too_long(self, service):
        with pytest.raises(ValueError, match="100 characters"):
            service.create_object(
                {"code": "TST", "name": "Test", "region": "R" * 101},
                _admin_user(),
            )

    def test_create_object_non_admin_rejected(self, service):
        with pytest.raises(PermissionError, match="admin"):
            service.create_object(
                {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
                _viewer_user(),
            )

    def test_create_object_operator_rejected(self, service):
        with pytest.raises(PermissionError, match="admin"):
            service.create_object(
                {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
                _operator_user(),
            )


# ---------------------------------------------------------------------------
# update_object tests
# ---------------------------------------------------------------------------


class TestUpdateObject:
    def test_update_object_name(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        updated = service.update_object(
            created["id"], {"name": "Камчатка (обновлено)"}, _admin_user()
        )
        assert updated["name"] == "Камчатка (обновлено)"
        assert updated["code"] == "KAM"  # code unchanged

    def test_update_object_short_name(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        updated = service.update_object(
            created["id"], {"short_name": "Кам"}, _admin_user()
        )
        assert updated["short_name"] == "Кам"

    def test_update_object_region(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        updated = service.update_object(
            created["id"], {"region": "Камчатский край"}, _admin_user()
        )
        assert updated["region"] == "Камчатский край"

    def test_update_object_default_assignee(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        # Set to None (no assignee) — always valid
        updated = service.update_object(
            created["id"], {"default_assignee_id": None}, _admin_user()
        )
        assert updated["default_assignee_id"] is None

    def test_deactivate_object(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        updated = service.update_object(
            created["id"], {"is_active": False}, _admin_user()
        )
        assert updated["is_active"] is False

        # Deactivated object excluded from default list
        active = service.list_objects(include_inactive=False)
        assert len(active) == 0

        # But still visible with include_inactive
        all_objects = service.list_objects(include_inactive=True)
        assert len(all_objects) == 1

    def test_activate_object(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        service.update_object(created["id"], {"is_active": False}, _admin_user())
        service.update_object(created["id"], {"is_active": True}, _admin_user())

        active = service.list_objects(include_inactive=False)
        assert len(active) == 1
        assert active[0]["is_active"] is True

    def test_update_object_not_found(self, service):
        with pytest.raises(ValueError, match="not found"):
            service.update_object(9999, {"name": "New"}, _admin_user())

    def test_update_object_non_admin_rejected(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        with pytest.raises(PermissionError, match="admin"):
            service.update_object(
                created["id"], {"name": "Hacked"}, _viewer_user()
            )

    def test_update_object_invalid_name(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        with pytest.raises(ValueError, match="name is required"):
            service.update_object(created["id"], {"name": ""}, _admin_user())

    def test_update_object_invalid_region(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        with pytest.raises(ValueError, match="region is required"):
            service.update_object(created["id"], {"region": ""}, _admin_user())

    def test_update_multiple_fields(self, service):
        created = service.create_object(
            {"code": "KAM", "name": "Камчатка", "region": "Дальний Восток"},
            _admin_user(),
        )
        updated = service.update_object(
            created["id"],
            {"name": "Камчатка-2", "short_name": "К2", "region": "Камчатский край"},
            _admin_user(),
        )
        assert updated["name"] == "Камчатка-2"
        assert updated["short_name"] == "К2"
        assert updated["region"] == "Камчатский край"

    def test_deactivation_preserves_object_data(self, service):
        """Deactivation preserves all object data (existing links remain)."""
        created = service.create_object(
            {
                "code": "KAM",
                "name": "Камчатка",
                "short_name": "Кам",
                "region": "Дальний Восток",
                "default_assignee_id": None,
            },
            _admin_user(),
        )
        deactivated = service.update_object(
            created["id"], {"is_active": False}, _admin_user()
        )
        # All fields preserved
        assert deactivated["code"] == "KAM"
        assert deactivated["name"] == "Камчатка"
        assert deactivated["short_name"] == "Кам"
        assert deactivated["region"] == "Дальний Восток"
        assert deactivated["is_active"] is False
