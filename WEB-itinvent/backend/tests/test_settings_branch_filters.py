from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.services.settings_service import SettingsService


@pytest.fixture
def settings_service(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> SettingsService:
    monkeypatch.setattr(
        "backend.services.settings_service.is_app_database_configured",
        lambda: False,
    )
    file_path = tmp_path / "web_user_settings.json"
    return SettingsService(file_path=file_path)


def test_normalize_database_branch_filters(settings_service: SettingsService) -> None:
    normalized = settings_service._normalize_database_branch_filters(
        {
            " main ": " HQ ",
            "": "Ignored",
            "remote": "",
            "branch2": "Remote",
        }
    )
    assert normalized == {"main": "HQ", "remote": "", "branch2": "Remote"}

    assert settings_service._normalize_database_branch_filters(
        json.dumps({"main": "HQ"})
    ) == {"main": "HQ"}
    assert settings_service._normalize_database_branch_filters("not-json") == {}
    assert settings_service._normalize_database_branch_filters(None) == {}


def test_merge_database_branch_filters(settings_service: SettingsService) -> None:
    merged = settings_service._merge_database_branch_filters(
        {"main": "HQ", "remote": "Remote"},
        {"main": "Updated", "branch2": "Branch2", "remote": ""},
    )
    assert merged == {"main": "Updated", "branch2": "Branch2", "remote": ""}


def test_update_user_settings_merges_database_branch_filters(
    settings_service: SettingsService,
) -> None:
    user_id = 42

    first = settings_service.update_user_settings(
        user_id,
        {"database_branch_filters": {"main": "HQ"}},
    )
    assert first["database_branch_filters"] == {"main": "HQ"}

    second = settings_service.update_user_settings(
        user_id,
        {"database_branch_filters": {"remote": "Remote", "main": ""}},
    )
    assert second["database_branch_filters"] == {"remote": "Remote", "main": ""}

    loaded = settings_service.get_user_settings(user_id)
    assert loaded["database_branch_filters"] == {"remote": "Remote", "main": ""}
