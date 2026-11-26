"""ChatUploadSessionStore.write_manifest — атомарная замена manifest.json.

Windows: os.replace свежего manifest.json падает PermissionError, пока файл
кратковременно держит AV-сканер/индексатор — стор повторяет замену.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from backend.chat.upload_sessions import ChatUploadSessionStore


def _store(tmp_path: Path) -> ChatUploadSessionStore:
    return ChatUploadSessionStore(
        upload_sessions_root=lambda: tmp_path,
        chunk_size_bytes=lambda: 1024,
        ttl_sec=lambda: 3600,
        cleanup_interval_sec=lambda: 60,
        normalize_transfer_encoding=lambda v: "identity",
        now=lambda: __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ),
    )


def test_write_manifest_replaces_manifest(tmp_path: Path) -> None:
    store = _store(tmp_path)
    store.write_manifest({"session_id": "s1", "files": []})
    payload = (tmp_path / "s1" / "manifest.json").read_text(encoding="utf-8")
    assert '"session_id":"s1"' in payload
    assert not (tmp_path / "s1" / "manifest.json.tmp").exists()


def test_write_manifest_retries_transient_permission_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = _store(tmp_path)
    attempts = {"count": 0}
    original_replace = Path.replace

    def flaky_replace(self: Path, target: Path) -> Path:
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise PermissionError("transient lock")
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    monkeypatch.setattr("backend.chat.upload_sessions.time.sleep", lambda _: None)

    store.write_manifest({"session_id": "s2", "files": []})

    assert attempts["count"] == 3
    assert (tmp_path / "s2" / "manifest.json").exists()
    assert not (tmp_path / "s2" / "manifest.json.tmp").exists()


def test_write_manifest_raises_after_retries_exhausted(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = _store(tmp_path)
    attempts = {"count": 0}

    def always_locked(self: Path, target: Path) -> Path:
        attempts["count"] += 1
        raise PermissionError("locked")

    monkeypatch.setattr(Path, "replace", always_locked)
    monkeypatch.setattr("backend.chat.upload_sessions.time.sleep", lambda _: None)

    with pytest.raises(PermissionError):
        store.write_manifest({"session_id": "s3", "files": []})

    assert attempts["count"] == 5
    # tmp-файл не должен остаться мусором после окончательного отказа.
    assert not (tmp_path / "s3" / "manifest.json.tmp").exists()
