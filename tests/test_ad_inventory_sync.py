from __future__ import annotations

from types import SimpleNamespace

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
    monkeypatch.setattr(ad_sync_service, "Server", lambda *_args, **_kwargs: object())
    monkeypatch.setattr(ad_sync_service, "Connection", _FakeConnection)
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
