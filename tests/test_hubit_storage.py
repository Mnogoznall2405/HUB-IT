"""Unit tests for HUB-IT SMB helper (no live network required)."""
from __future__ import annotations

from backend.services import hubit_storage as hubit


def test_health_not_configured(monkeypatch):
    monkeypatch.delenv("HUBIT_STORAGE_UNC", raising=False)
    monkeypatch.delenv("HUBIT_STORAGE_USERNAME", raising=False)
    monkeypatch.delenv("HUBIT_STORAGE_PASSWORD", raising=False)
    hubit.reset_connection_state_for_tests()
    item = hubit.health()
    assert item.configured is False
    assert item.connected is False
    assert item.writable is False
    public = hubit.health_public_dict()
    assert "password" not in str(public).lower()
    assert public["configured"] is False


def test_share_root_from_unc():
    assert hubit._share_root_from_path(r"\\10.103.0.229\hubit\users\1") == r"\\10.103.0.229\hubit"


def test_server_unc_from_share():
    assert hubit._server_unc_from_share(r"\\10.103.0.229\hubit") == r"\\10.103.0.229"


class _FakeWinFunc:
    def __init__(self, impl):
        self._impl = impl
        self.argtypes = None
        self.restype = None

    def __call__(self, *args, **kwargs):
        return self._impl(*args, **kwargs)


def test_connect_windows_share_retries_after_1219(monkeypatch):
    calls = {"add": 0, "cancel": []}

    def add_connection(*_args):
        calls["add"] += 1
        if calls["add"] == 1:
            return hubit._ERROR_SESSION_CREDENTIAL_CONFLICT
        return hubit._ERROR_SUCCESS

    def cancel_connection(share, *_args):
        calls["cancel"].append(str(share))
        return hubit._ERROR_SUCCESS

    class FakeWinDLL:
        def __init__(self, *_args, **_kwargs):
            self.WNetAddConnection2W = _FakeWinFunc(add_connection)
            self.WNetCancelConnection2W = _FakeWinFunc(cancel_connection)

    import ctypes

    monkeypatch.setattr(ctypes, "WinDLL", FakeWinDLL)
    hubit._connect_windows_share(
        share=r"\\10.103.0.229\hubit",
        username=r"10.103.0.229\sharehabit",
        password="secret",
    )
    assert calls["add"] == 2
    assert r"\\10.103.0.229\hubit" in calls["cancel"]
    assert r"\\10.103.0.229" in calls["cancel"]


def test_connect_windows_share_1219_requires_writable_probe(monkeypatch):
    class FakeWinDLL:
        def __init__(self, *_args, **_kwargs):
            self.WNetAddConnection2W = _FakeWinFunc(
                lambda *_args: hubit._ERROR_SESSION_CREDENTIAL_CONFLICT
            )
            self.WNetCancelConnection2W = _FakeWinFunc(lambda *_args: hubit._ERROR_SUCCESS)

    import ctypes

    monkeypatch.setattr(ctypes, "WinDLL", FakeWinDLL)
    monkeypatch.setattr(hubit, "_probe_share_writable", lambda _share: False)
    try:
        hubit._connect_windows_share(
            share=r"\\10.103.0.229\hubit",
            username="u",
            password="p",
        )
        assert False, "expected HubitStorageError"
    except hubit.HubitStorageError as exc:
        assert exc.code == hubit.HubitStorageErrorCode.AUTH_FAILURE
        assert "1219" in str(exc)
