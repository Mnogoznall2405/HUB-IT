"""Ownership guard for ``E2E_HUB_DATA_DIR`` in ``local_backend``.

The stack must never blindly ``rmtree`` a user-supplied path: the external
root is a container, real data lives in a marked ``hub_data-<state>`` child,
and deletion of anything unmarked fails closed without touching files.
"""
from __future__ import annotations

import importlib
import os
import sys
from pathlib import Path

import pytest

STACK_DIR = Path(__file__).resolve().parent.parent
TEST_STATE = ".state-testpaths"


@pytest.fixture()
def backend_env(monkeypatch):
    """Import local_backend with controlled env; restores os.environ after.

    The module writes ~50 keys into ``os.environ`` at import time — the
    snapshot keeps the leak contained to this test.
    """
    snapshot = dict(os.environ)
    monkeypatch.setenv("E2E_STATE_NAME", TEST_STATE)
    monkeypatch.delenv("E2E_HUB_DATA_DIR", raising=False)
    sys.modules.pop("local_backend", None)
    sys.path.insert(0, str(STACK_DIR))
    try:
        yield monkeypatch
    finally:
        sys.path.remove(str(STACK_DIR))
        sys.modules.pop("local_backend", None)
        os.environ.clear()
        os.environ.update(snapshot)


def _load(monkeypatch, hub_root):
    if hub_root is None:
        monkeypatch.delenv("E2E_HUB_DATA_DIR", raising=False)
    else:
        monkeypatch.setenv("E2E_HUB_DATA_DIR", str(hub_root))
    sys.modules.pop("local_backend", None)
    return importlib.import_module("local_backend")


def test_default_dir_lives_inside_state(backend_env, monkeypatch):
    lb = _load(monkeypatch, None)
    assert lb.HUB_DATA_DIR == lb.STATE_DIR / "hub_data"
    # Сброс по умолчанию — no-op: каталог удаляется вместе с .state.
    lb._reset_hub_data_dir(lb.HUB_DATA_DIR)


def test_missing_root_fails_closed(backend_env, monkeypatch, tmp_path):
    with pytest.raises(RuntimeError, match="existing directory"):
        _load(monkeypatch, tmp_path / "does-not-exist")


def test_file_root_fails_closed(backend_env, monkeypatch, tmp_path):
    root = tmp_path / "hub-root.txt"
    root.write_text("x", encoding="utf-8")
    with pytest.raises(RuntimeError, match="existing directory"):
        _load(monkeypatch, root)


def test_reset_creates_marked_child_and_preserves_root(backend_env, monkeypatch, tmp_path):
    root = tmp_path / "hub-root"
    root.mkdir()
    keep = root / "keep.txt"
    keep.write_text("precious", encoding="utf-8")

    lb = _load(monkeypatch, root)
    assert lb.HUB_DATA_DIR.parent == root.resolve()
    assert lb.HUB_DATA_DIR.name == f"hub_data-{TEST_STATE.lstrip('.')}"

    lb._reset_hub_data_dir(lb.HUB_DATA_DIR)
    marker = lb.HUB_DATA_DIR / lb.HUB_DATA_MARKER
    assert keep.exists()
    assert marker.is_file()
    assert marker.read_text(encoding="utf-8").strip() == f"hub-it-e2e {TEST_STATE}"

    # Повторный сброс: чужие файлы корня не трогаются, наши данные чистятся.
    (lb.HUB_DATA_DIR / "data.bin").write_bytes(b"x")
    lb._reset_hub_data_dir(lb.HUB_DATA_DIR)
    assert keep.exists()
    assert not (lb.HUB_DATA_DIR / "data.bin").exists()
    assert marker.is_file()


def test_unmarked_existing_dir_refuses_delete(backend_env, monkeypatch, tmp_path):
    root = tmp_path / "hub-root"
    root.mkdir()
    lb = _load(monkeypatch, root)
    target = lb.HUB_DATA_DIR
    target.mkdir()
    precious = target / "precious.bin"
    precious.write_bytes(b"x")

    with pytest.raises(RuntimeError, match="refuses to delete"):
        lb._reset_hub_data_dir(target)
    assert precious.exists()


def test_wrong_marker_content_refuses_delete(backend_env, monkeypatch, tmp_path):
    root = tmp_path / "hub-root"
    root.mkdir()
    lb = _load(monkeypatch, root)
    target = lb.HUB_DATA_DIR
    target.mkdir()
    (target / lb.HUB_DATA_MARKER).write_text("not-e2e", encoding="utf-8")
    precious = target / "precious.bin"
    precious.write_bytes(b"x")

    with pytest.raises(RuntimeError, match="refuses to delete"):
        lb._reset_hub_data_dir(target)
    assert precious.exists()


def test_unmanaged_name_refuses_delete(backend_env, monkeypatch, tmp_path):
    root = tmp_path / "hub-root"
    root.mkdir()
    lb = _load(monkeypatch, root)
    unmanaged = root / "random_user_dir"
    unmanaged.mkdir()
    precious = unmanaged / "precious.bin"
    precious.write_bytes(b"x")

    with pytest.raises(RuntimeError, match="unmanaged data path"):
        lb._reset_hub_data_dir(unmanaged)
    assert precious.exists()


def test_root_inside_state_dir_fails_closed(backend_env, monkeypatch):
    lb = _load(monkeypatch, None)
    lb.STATE_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with pytest.raises(RuntimeError, match="inside the E2E state dir"):
            _load(monkeypatch, lb.STATE_DIR)
    finally:
        import shutil

        shutil.rmtree(lb.STATE_DIR, ignore_errors=True)


def test_filesystem_root_fails_closed(backend_env, monkeypatch):
    with pytest.raises(RuntimeError, match="filesystem root"):
        _load(monkeypatch, Path(os.path.abspath(os.sep)))
