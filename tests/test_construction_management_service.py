from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.construction_management_service import ConstructionManagementService, ConstructionObjectConflict  # noqa: E402


GROUP_ONE = "11111111-1111-1111-1111-111111111111"
GROUP_TWO = "22222222-2222-2222-2222-222222222222"


def candidate(code: str, name: str) -> dict[str, str]:
    return {
        "employee_code": code,
        "full_name": name,
        "position": "Инженер",
        "department": "ПТО",
        "department_location": "Екатеринбург",
    }


@pytest.fixture
def service(tmp_path):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'construction.db').as_posix()}"
    return ConstructionManagementService(database_url=database_url)


def test_object_keeps_stable_groups_and_versioned_zup_roles(service):
    created = service.save_object(
        object_id=None,
        name="ЕАСИ — основной объект",
        groups=[
            {"group_ref": GROUP_ONE, "group_name": "ЕАСИ"},
            {"group_ref": GROUP_TWO, "group_name": "ЕАСИ доп."},
        ],
        role_candidates={"project_lead": candidate("E-1", "Иванов Иван Иванович")},
        actor_user_id=7,
    )

    assert created["id"].startswith("construction-")
    assert {item["group_ref"] for item in created["groups"]} == {GROUP_ONE, GROUP_TWO}
    assert created["team"][0]["employee_code"] == "E-1"

    updated = service.save_object(
        object_id=created["id"],
        name="ЕАСИ — объединённый объект",
        groups=created["groups"],
        role_candidates={"project_lead": candidate("E-2", "Петров Пётр Петрович")},
        actor_user_id=8,
    )

    assert updated["name"] == "ЕАСИ — объединённый объект"
    assert [item["employee_code"] for item in updated["team"]] == ["E-2"]
    assert [item["employee_code"] for item in updated["role_history"]] == ["E-2", "E-1"]
    previous = next(item for item in updated["role_history"] if item["employee_code"] == "E-1")
    assert previous["valid_to"] is not None


def test_one_1c_group_cannot_be_linked_to_two_objects(service):
    first = service.save_object(
        object_id=None,
        name="Первый объект",
        groups=[{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
        role_candidates={},
        actor_user_id=1,
    )

    with pytest.raises(ValueError, match="уже привязана"):
        service.save_object(
            object_id=None,
            name="Второй объект",
            groups=[{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
            role_candidates={},
            actor_user_id=1,
        )

    assert service.get_object(first["id"])["groups"][0]["group_ref"] == GROUP_ONE


def test_clearing_role_closes_assignment_without_erasing_history(service):
    created = service.save_object(
        object_id=None,
        name="Объект без руководителя",
        groups=[{"group_ref": GROUP_ONE, "group_name": "ЕАСИ"}],
        role_candidates={"project_lead": candidate("E-1", "Иванов Иван Иванович")},
        actor_user_id=1,
    )
    cleared = service.save_object(
        object_id=created["id"],
        name=created["name"],
        groups=created["groups"],
        role_candidates={"project_lead": None},
        actor_user_id=2,
    )

    assert cleared["team"] == []
    assert len(cleared["role_history"]) == 1
    assert cleared["role_history"][0]["valid_to"] is not None


def test_gip_survives_partial_role_payload_and_is_inherited_by_direction_view(service):
    created = service.save_object(
        object_id=None,
        name="Объект с ГИП",
        groups=[
            {"group_ref": GROUP_ONE, "group_name": "А"},
            {"group_ref": GROUP_TWO, "group_name": "Б"},
        ],
        role_candidates={
            "project_lead": candidate("E-1", "Иванов"),
            "chief_project_engineer": candidate("E-GIP", "Главный Инженер"),
        },
        actor_user_id=1,
    )
    # Old-style partial payload updates only project_lead and must not erase GIP.
    updated = service.save_object(
        object_id=created["id"],
        name=created["name"],
        groups=created["groups"],
        role_candidates={"project_lead": candidate("E-2", "Петров")},
        actor_user_id=2,
    )
    team_codes = {item["role_key"]: item["employee_code"] for item in updated["team"]}
    assert team_codes["project_lead"] == "E-2"
    assert team_codes["chief_project_engineer"] == "E-GIP"

    direction_a = service.ensure_group_belongs(created["id"], GROUP_ONE)
    assert any(item["role_key"] == "chief_project_engineer" for item in direction_a["team"])


def test_rename_preserves_groups_without_recreate(service):
    created = service.save_object(
        object_id=None,
        name="Объект",
        groups=[
            {"group_ref": GROUP_ONE, "group_name": "А"},
            {"group_ref": GROUP_TWO, "group_name": "Б"},
        ],
        role_candidates={},
        actor_user_id=1,
    )
    renamed = service.save_object(
        object_id=created["id"],
        name="Объект переименован",
        groups=[
            {"group_ref": GROUP_ONE, "group_name": "А обновлён"},
            {"group_ref": GROUP_TWO, "group_name": "Б обновлён"},
        ],
        role_candidates=None,
        actor_user_id=3,
    )
    assert renamed["name"] == "Объект переименован"
    assert {item["group_ref"]: item["group_name"] for item in renamed["groups"]} == {
        GROUP_ONE: "А обновлён",
        GROUP_TWO: "Б обновлён",
    }


def test_stale_settings_cannot_overwrite_new_name_groups_or_team(service):
    created = service.save_object(object_id=None, name="Исходный объект", groups=[{"group_ref": GROUP_ONE}],
                                  role_candidates={"project_lead": candidate("E-1", "Иванов")}, actor_user_id=1)
    original_version = datetime.fromisoformat(created['updated_at'])
    updated = service.save_object(object_id=created['id'], name="Новое название", groups=[{"group_ref": GROUP_ONE, "group_name": "ЭОМ"}],
                                  role_candidates={"project_lead": candidate("E-2", "Петров")}, actor_user_id=2,
                                  expected_updated_at=original_version)
    with pytest.raises(ConstructionObjectConflict, match="уже изменил"):
        service.save_object(object_id=created['id'], name=created['name'], groups=[{"group_ref": GROUP_TWO}],
                            role_candidates={"project_lead": candidate("E-1", "Иванов")}, actor_user_id=1,
                            expected_updated_at=original_version)
    assert service.get_object(created['id']) == updated
    # The response may contain SQLite's naive UTC or PostgreSQL's explicit UTC.
    version = datetime.fromisoformat(updated['updated_at'])
    if version.tzinfo is None:
        version = version.replace(tzinfo=timezone.utc)
    result = service.save_object(object_id=created['id'], name="Ещё одно название", groups=updated['groups'],
                                 role_candidates=None, actor_user_id=3,
                                 expected_updated_at=version.astimezone(timezone(timedelta(hours=5))))
    assert result['team'][0]['employee_code'] == 'E-2'
    assert len(result['role_history']) == 2


def test_settings_api_reports_stale_version_without_losing_current_values(service, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from backend.api import deps
    from backend.api.v1 import construction as api
    from backend.models.auth import User

    created = service.save_object(object_id=None, name="Объект", groups=[{"group_ref": GROUP_ONE}],
                                  role_candidates={}, actor_user_id=1)
    monkeypatch.setattr(api, '_management_service', lambda: service)
    app = FastAPI()
    app.include_router(api.router, prefix='/construction')
    app.dependency_overrides[deps.get_current_active_user] = lambda: User(
        id=1, username='operator', role='operator', is_active=True, use_custom_permissions=True,
        permissions=['construction.write'], custom_permissions=['construction.write'])
    with TestClient(app) as client:
        path = f"/construction/management/objects/{created['id']}"
        payload = {'name': 'Сохранённое название', 'groups': created['groups'], 'expected_updated_at': created['updated_at']}
        response = client.put(path, json=payload)
        assert response.status_code == 200
        assert response.json()['name'] == 'Сохранённое название'
        payload['name'] = 'Устаревшее название'
        response = client.put(path, json=payload)
        assert response.status_code == 409
        assert 'уже изменил' in response.json()['detail']
        assert service.get_object(created['id'])['name'] == 'Сохранённое название'
