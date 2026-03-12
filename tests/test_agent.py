from __future__ import annotations

import sys
from pathlib import Path

import agent
from agent_version import AGENT_VERSION as SHARED_AGENT_VERSION


PROJECT_ROOT = Path(__file__).resolve().parents[1]
AGENT_SRC = PROJECT_ROOT / "agent" / "src"

if str(AGENT_SRC) not in sys.path:
    sys.path.insert(0, str(AGENT_SRC))

from itinvent_agent import agent as packaged_agent  # noqa: E402


def test_get_outlook_search_roots_defaults_to_d_drive(monkeypatch):
    monkeypatch.delenv("ITINV_OUTLOOK_SEARCH_ROOTS", raising=False)

    roots = agent._get_outlook_search_roots()

    assert [str(path) for path in roots] == ["D:\\"]


def test_get_outlook_search_roots_respects_custom_env(monkeypatch, temp_dir):
    base = Path(temp_dir)
    root_one = base / "Mail"
    root_two = base / "Archive"
    monkeypatch.setenv("ITINV_OUTLOOK_SEARCH_ROOTS", f"{root_one}; {root_two}")

    roots = agent._get_outlook_search_roots()

    assert [str(path) for path in roots] == [str(root_one), str(root_two)]


def test_get_outlook_search_roots_allows_explicit_disable(monkeypatch):
    monkeypatch.setenv("ITINV_OUTLOOK_SEARCH_ROOTS", "   ")

    assert agent._get_outlook_search_roots() == []


def test_scan_outlook_profile_paths_finds_standard_store(temp_dir):
    users_root = Path(temp_dir) / "Users"
    user_dir = users_root / "tester"
    store_path = user_dir / "AppData" / "Local" / "Microsoft" / "Outlook" / "mail.ost"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text("outlook", encoding="utf-8")

    stores = agent._scan_outlook_profile_paths(users_root=users_root, seen_paths=set())

    assert len(stores) == 1
    assert stores[0]["path"] == str(store_path.resolve())
    assert stores[0]["type"] == "ost"
    assert stores[0]["profile_name"] == "tester"


def test_scan_outlook_extra_roots_finds_nested_store_and_prunes_system_dirs(temp_dir):
    extra_root = Path(temp_dir) / "DDrive"
    wanted = extra_root / "Archive" / "Outlook" / "user.pst"
    skipped = extra_root / "ProgramData" / "Outlook" / "skip.pst"
    wanted.parent.mkdir(parents=True, exist_ok=True)
    skipped.parent.mkdir(parents=True, exist_ok=True)
    wanted.write_text("archive", encoding="utf-8")
    skipped.write_text("skip", encoding="utf-8")

    stores, errors = agent._scan_outlook_extra_roots(roots=[extra_root], seen_paths=set())

    assert errors == 0
    assert [row["path"] for row in stores] == [str(wanted.resolve())]
    assert stores[0]["type"] == "pst"


def test_scan_outlook_extra_roots_deduplicates_profile_hits(temp_dir):
    users_root = Path(temp_dir) / "Users"
    store_path = users_root / "tester" / "Documents" / "Outlook Files" / "mail.pst"
    store_path.parent.mkdir(parents=True, exist_ok=True)
    store_path.write_text("archive", encoding="utf-8")

    seen_paths: set[str] = set()
    profile_stores = agent._scan_outlook_profile_paths(users_root=users_root, seen_paths=seen_paths)
    extra_stores, _ = agent._scan_outlook_extra_roots(roots=[users_root], seen_paths=seen_paths)

    assert len(profile_stores) == 1
    assert extra_stores == []


def test_agent_version_is_shared_between_runtime_and_package():
    assert agent.AGENT_VERSION == SHARED_AGENT_VERSION
    assert packaged_agent.AGENT_VERSION == SHARED_AGENT_VERSION
