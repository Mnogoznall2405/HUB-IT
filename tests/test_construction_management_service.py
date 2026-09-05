from __future__ import annotations

from pathlib import Path
import sys

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.construction_management_service import ConstructionManagementService  # noqa: E402


GROUP_ONE = "11111111-1111-1111-1111-111111111111"
GROUP_TWO = "22222222-2222-2222-2222-222222222222"


def candidate(code: str, name: str) -> dict[str, str]:
    return {
        "employee_code": code,
        "full_name": name,
        "position": "Руководитель проекта",
        "department": "Управление проектами",
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
        role_candidates={},
        actor_user_id=2,
    )

    assert cleared["team"] == []
    assert len(cleared["role_history"]) == 1
    assert cleared["role_history"][0]["valid_to"] is not None
