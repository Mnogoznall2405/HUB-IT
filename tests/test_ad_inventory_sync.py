from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest

from backend.services import ad_sync_service


class _FakeEntry:
    def __init__(self, attributes: dict[str, str]) -> None:
        self._attributes = attributes

    def __contains__(self, name: str) -> bool:
        return name in self._attributes

    def __getattr__(self, name: str) -> SimpleNamespace:
        if name not in self._attributes:
            raise AttributeError(name)
        return SimpleNamespace(value=self._attributes[name])


class _FakeStandardExtension:
    def __init__(self, connection: "_FakeConnection") -> None:
        self._connection = connection

    def paged_search(self, **kwargs):
        self._connection.paged_search_calls.append(kwargs)
        for attributes in self._connection.source_attributes:
            yield {"type": "searchResEntry", "attributes": attributes}


class _FakeConnection:
    latest: "_FakeConnection | None" = None

    def __init__(self, *_args, **_kwargs) -> None:
        type(self).latest = self
        self.source_attributes = [
            {
                "sAMAccountName": f"user{index:04d}",
                "displayName": f"User {index:04d}",
                "sn": "User",
                "givenName": str(index),
                "middleName": "",
                "department": "IT",
                "title": "Engineer",
                "mail": f"user{index:04d}@example.test",
                "telephoneNumber": "",
            }
            for index in range(1600)
        ]
        self.entries: list[_FakeEntry] = []
        self.paged_search_calls: list[dict] = []
        self.extend = SimpleNamespace(standard=_FakeStandardExtension(self))
        self.unbound = False

    def search(self, **_kwargs) -> bool:
        self.entries = [_FakeEntry(item) for item in self.source_attributes[:1000]]
        return True

    def unbind(self) -> None:
        self.unbound = True


def test_fetch_ad_users_uses_paging_and_caps_result_at_1500(monkeypatch) -> None:
    monkeypatch.setattr(
        ad_sync_service, "open_ldap_connection", lambda *_args, **_kwargs: _FakeConnection()
    )
    monkeypatch.setenv("LDAP_SERVER", "ldap.example.test")
    monkeypatch.setenv("LDAP_SYNC_USER", "sync-user")
    monkeypatch.setenv("LDAP_SYNC_PASSWORD", "sync-password")
    monkeypatch.setenv("LDAP_BASE_DN", "dc=example,dc=test")

    users = ad_sync_service.fetch_ad_users()

    connection = _FakeConnection.latest
    assert connection is not None
    assert len(users) == 1500
    assert users[1000]["login"] == "user1000"
    assert users[-1]["login"] == "user1499"
    assert len(connection.paged_search_calls) == 1
    assert connection.unbound is True


class _SqliteDb:
    """Runs sync_users_to_db's SQL against in-memory sqlite (T-SQL ISNULL -> IFNULL)."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    @staticmethod
    def _translate(query: str) -> str:
        return query.replace("ISNULL(", "IFNULL(")

    def execute_query(self, query: str, params: tuple | None = None):
        cur = self._conn.execute(self._translate(query), params or ())
        cols = [d[0] for d in cur.description] if cur.description else []
        return [dict(zip(cols, row)) for row in cur.fetchall()]

    def execute_update(self, query: str, params: tuple | None = None) -> int:
        cur = self._conn.execute(self._translate(query), params or ())
        self._conn.commit()
        return cur.rowcount


@pytest.fixture
def owners_db(monkeypatch) -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:")
    conn.execute(
        "CREATE TABLE OWNERS ("
        "OWNER_NO INTEGER PRIMARY KEY, OWNER_LNAME TEXT, OWNER_FNAME TEXT, OWNER_MNAME TEXT,"
        "OWNER_DISPLAY_NAME TEXT, OWNER_DEPT TEXT, OWNER_EMAIL TEXT, OWNER_LOGIN TEXT,"
        "OWNER_POSITION TEXT, OWNER_PHONE TEXT, OWNER_DISMISS INTEGER)"
    )
    conn.execute(
        "INSERT INTO OWNERS VALUES (2961, 'Кондратьева', 'Алла', 'Александровна',"
        "'Кондратьева Алла Александровна', 'Старый отдел', 'old@zsgp.ru', 'kondrateva_aa',"
        "'Инженер', '111', 0)"
    )
    conn.commit()
    monkeypatch.setattr(ad_sync_service, "get_db", lambda _db_id: _SqliteDb(conn))
    return conn


def _ad_user(**overrides) -> dict:
    user = {
        "login": "kondrateva_aa",
        "lname": "Анникова",
        "fname": "Алла",
        "mname": "",
        "display_name": "Анникова Алла Александровна",
        "department": "Новый отдел",
        "title": "Старший инженер",
        "mail": "annikova.aa@zsgp.ru",
        "phone": "222",
    }
    user.update(overrides)
    return user


def _owner_row(conn: sqlite3.Connection, owner_no: int = 2961) -> dict:
    cur = conn.execute("SELECT * FROM OWNERS WHERE OWNER_NO = ?", (owner_no,))
    return dict(zip([d[0] for d in cur.description], cur.fetchone()))


def test_sync_users_to_db_updates_name_fields_for_existing_owner(owners_db) -> None:
    stats = ad_sync_service.sync_users_to_db([_ad_user()], "ITINVENT", force_update=True)

    assert stats == {"added": 0, "updated": 1, "errors": 0}
    row = _owner_row(owners_db)
    assert row["OWNER_LNAME"] == "Анникова"
    assert row["OWNER_DISPLAY_NAME"] == "Анникова Алла Александровна"
    assert row["OWNER_EMAIL"] == "annikova.aa@zsgp.ru"
    assert row["OWNER_DEPT"] == "Новый отдел"


def test_sync_users_to_db_keeps_stored_name_when_ad_field_empty(owners_db) -> None:
    stats = ad_sync_service.sync_users_to_db(
        [_ad_user(lname="", display_name="")], "ITINVENT", force_update=True
    )

    assert stats == {"added": 0, "updated": 1, "errors": 0}
    row = _owner_row(owners_db)
    assert row["OWNER_LNAME"] == "Кондратьева"
    assert row["OWNER_DISPLAY_NAME"] == "Кондратьева Алла Александровна"
    # AD middleName is empty here; patronymic must survive either way
    assert row["OWNER_MNAME"] == "Александровна"


def test_sync_users_to_db_without_force_leaves_existing_owner_untouched(owners_db) -> None:
    stats = ad_sync_service.sync_users_to_db([_ad_user()], "ITINVENT", force_update=False)

    assert stats == {"added": 0, "updated": 0, "errors": 0}
    assert _owner_row(owners_db)["OWNER_DISPLAY_NAME"] == "Кондратьева Алла Александровна"


def test_sync_users_to_db_inserts_only_new_logins(owners_db) -> None:
    stats = ad_sync_service.sync_users_to_db(
        [_ad_user(), _ad_user(login="new_user", lname="Новый")], "ITINVENT", force_update=True
    )

    assert stats == {"added": 1, "updated": 1, "errors": 0}
    assert _owner_row(owners_db, 2962)["OWNER_LNAME"] == "Новый"
