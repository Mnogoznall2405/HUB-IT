from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services import ad_groups_access_service as service


@pytest.mark.parametrize(
    ("cn", "expected_level", "expected_label"),
    [
        ("RO_Бухгалтерия", "read", "Бухгалтерия"),
        ("RW_Finance", "write", "Finance"),
        ("Designers", "member", "Designers"),
        ("Project_RW", "write", "Project"),
    ],
)
def test_parse_access_level_and_folder_label(cn, expected_level, expected_label):
    assert service.parse_access_level(cn) == expected_level
    assert service.parse_folder_label(cn) == expected_label


def test_expand_nested_members_resolves_users():
    direct_members = {
        "CN=Parent,OU=SPb,OU=Groups,DC=zsgp,DC=corp": [
            "CN=Child,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
            "CN=User One,OU=Users,DC=zsgp,DC=corp",
        ],
        "CN=Child,OU=SPb,OU=Groups,DC=zsgp,DC=corp": [
            "CN=User Two,OU=Users,DC=zsgp,DC=corp",
        ],
    }
    group_dns = {
        "CN=Parent,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
        "CN=Child,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
    }
    resolved = service._expand_nested_members(
        "CN=Parent,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
        direct_members=direct_members,
        group_dns=group_dns,
        cache={},
    )
    assert resolved == {
        "CN=User One,OU=Users,DC=zsgp,DC=corp",
        "CN=User Two,OU=Users,DC=zsgp,DC=corp",
    }


def test_search_user_access_and_matrix_from_snapshot(tmp_path, monkeypatch):
    snapshot = {
        "synced_at": "2026-07-03T10:00:00Z",
        "groups": [
            {
                "dn": "CN=RO_Finance,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp",
                "cn": "RO_Finance",
                "branch": "Tyumen",
                "folder_label": "Finance",
                "folder_path": "Resources / Finance",
                "access_level": "read",
                "description": "",
                "member_count": 1,
            },
            {
                "dn": "CN=Designers,OU=SPb,OU=Groups,DC=zsgp,DC=corp",
                "cn": "Designers",
                "branch": "SPb",
                "folder_label": "Designers",
                "folder_path": "Designers",
                "access_level": "member",
                "description": "",
                "member_count": 0,
            },
        ],
        "group_members": {
            "CN=RO_Finance,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp": [
                {"login": "ivanov_i", "display_name": "Иванов И.И.", "via": "direct"},
            ],
        },
        "users": [
            {
                "login": "ivanov_i",
                "display_name": "Иванов И.И.",
                "branch": "Tyumen",
                "access": [
                    {
                        "group_dn": "CN=RO_Finance,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp",
                        "folder_label": "Finance",
                        "folder_path": "Resources / Finance",
                        "branch": "Tyumen",
                        "access_level": "read",
                        "via": "direct",
                    }
                ],
            }
        ],
        "matrix_summary": {"group_count": 2, "user_count": 1},
    }
    snapshot_path = tmp_path / "ad_groups_access_snapshot.json"
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(service, "_snapshot_path", lambda: snapshot_path)

    user_payload = service.search_user_access(query="ivanov", branch="Tyumen")
    assert user_payload["total"] == 1
    assert user_payload["items"][0]["login"] == "ivanov_i"
    assert user_payload["items"][0]["access_count"] == 1

    matrix_payload = service.get_matrix(branch="SPb", query="design")
    assert matrix_payload["total"] == 1
    assert matrix_payload["items"][0]["cn"] == "Designers"

    detail_payload = service.get_group_detail(
        group_dn="CN=RO_Finance,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp",
    )
    assert detail_payload["status"] == "ok"
    assert detail_payload["members"][0]["login"] == "ivanov_i"

    grid_payload = service.get_matrix_grid(branch="Tyumen", folder_query="finance")
    assert grid_payload["summary"]["group_count"] == 1
    assert grid_payload["summary"]["user_count"] == 1
    assert grid_payload["cells"] == [["ivanov_i", "CN=RO_Finance,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp", "read"]]


def test_matrix_grid_limits_interactive_payload(tmp_path, monkeypatch):
    first_group_dn = "CN=RO_A,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp"
    second_group_dn = "CN=RO_B,OU=Tyumen,OU=Groups,DC=zsgp,DC=corp"
    snapshot = {
        "synced_at": "2026-07-03T10:00:00Z",
        "groups": [
            {
                "dn": first_group_dn,
                "cn": "RO_A",
                "branch": "Tyumen",
                "folder_label": "A",
                "folder_path": "Resources / A",
                "access_level": "read",
                "member_count": 2,
            },
            {
                "dn": second_group_dn,
                "cn": "RO_B",
                "branch": "Tyumen",
                "folder_label": "B",
                "folder_path": "Resources / B",
                "access_level": "read",
                "member_count": 1,
            },
        ],
        "users": [
            {
                "login": "ivanov_i",
                "display_name": "Иванов И.И.",
                "access": [
                    {
                        "group_dn": first_group_dn,
                        "folder_label": "A",
                        "folder_path": "Resources / A",
                        "branch": "Tyumen",
                        "access_level": "read",
                    },
                ],
            },
            {
                "login": "petrov_p",
                "display_name": "Петров П.П.",
                "access": [
                    {
                        "group_dn": first_group_dn,
                        "folder_label": "A",
                        "folder_path": "Resources / A",
                        "branch": "Tyumen",
                        "access_level": "read",
                    },
                ],
            },
        ],
    }
    snapshot_path = tmp_path / "ad_groups_access_snapshot.json"
    snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(service, "_snapshot_path", lambda: snapshot_path)

    payload = service.get_matrix_grid(branch="Tyumen", group_limit=1, user_limit=1)

    assert len(payload["groups"]) == 1
    assert len(payload["users"]) == 1
    assert payload["summary"]["group_count"] == 2
    assert payload["summary"]["returned_group_count"] == 1
    assert payload["summary"]["user_count"] == 2
    assert payload["summary"]["returned_user_count"] == 1
    assert payload["summary"]["group_truncated"] is True
    assert payload["summary"]["user_truncated"] is True
    assert payload["summary"]["truncated"] is True
