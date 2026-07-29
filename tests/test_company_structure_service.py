from __future__ import annotations

import pytest

from backend.appdb.db import initialize_app_schema
from backend.services.address_book_service import AddressBookService
from backend.services.company_structure_service import CompanyStructureService
from backend.services.authorization_service import (
    PERM_COMPANY_STRUCTURE_READ,
    PERM_COMPANY_STRUCTURE_WRITE,
    authorization_service,
)


class MemoryDataManager:
    def __init__(self, payload=None):
        self.payload = payload or {}

    def load_json(self, filename, default_content=None):
        return self.payload or default_content

    def save_json(self, filename, data):
        self.payload = data
        return True


@pytest.fixture
def structure_service(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'company-structure.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    initialize_app_schema(database_url)
    return CompanyStructureService(database_url=database_url)


def test_seed_creates_root_and_two_blocks(structure_service):
    tree = structure_service.get_tree()
    assert tree["count"] == 3
    assert len(tree["items"]) == 1
    root = tree["items"][0]
    assert root["title"] == "Генеральный директор"
    assert [child["title"] for child in root["children"]] == [
        "Строительный блок",
        "Административный блок",
    ]


def test_set_parent_rejects_cycle(structure_service):
    tree = structure_service.get_tree()
    root = tree["items"][0]
    block = root["children"][0]
    with pytest.raises(ValueError, match="cycle"):
        structure_service.set_parent(root["id"], parent_id=block["id"])


def test_department_codes_and_people_lookup(structure_service, monkeypatch):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отделение буровых работ",
            "node_type": "department",
            "department_codes": ["00ЗК-6942", "00ЗК-6942"],
        }
    )
    assert node["department_codes"] == ["00ЗК-6942"]

    updated = structure_service.set_department_codes(node["id"], ["00ЗК-6942", "00ЗК-5559"])
    assert set(updated["department_codes"]) == {"00ЗК-6942", "00ЗК-5559"}
    assert len(updated["department_codes"]) == 2

    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Абабков Данил Павлович",
                        "employee_code": "00ЗК-59763",
                        "department": "Отделение буровых работ",
                        "department_code": "00ЗК-6942",
                        "position": "Помощник машиниста",
                    },
                    {
                        "full_name": "Другой Сотрудник",
                        "employee_code": "X-1",
                        "department": "Иное",
                        "department_code": "00ЗК-0001",
                        "position": "Инженер",
                    },
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )
    people = structure_service.list_node_people(node["id"])
    assert people["total"] == 1
    assert people["items"][0]["full_name"] == "Абабков Данил Павлович"


def test_people_lookup_by_department_title(structure_service, monkeypatch):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Техническая поддержка",
            "node_type": "department",
            "department_codes": [],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Сидоров Сидор",
                        "employee_code": "E-10",
                        "department": "Техническая поддержка",
                        "department_code": "00ЗК-1111",
                        "position": "Инженер",
                    },
                    {
                        "full_name": "Чужой",
                        "employee_code": "E-11",
                        "department": "Бухгалтерия",
                        "department_code": "000000008",
                        "position": "Бухгалтер",
                    },
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )
    people = structure_service.list_node_people(node["id"])
    assert people["total"] == 1
    assert people["matched_by_title"] is True
    assert people["items"][0]["full_name"] == "Сидоров Сидор"


def test_people_lookup_requires_exact_zup_department_title(structure_service, monkeypatch):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    short = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отдел логистики",
            "node_type": "directorate",
            "department_codes": [],
        }
    )
    exact = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отдел логистики г. Владивосток",
            "node_type": "department",
            "department_codes": [],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Махов Антон Александрович",
                        "employee_code": "E-20",
                        "department": "Отдел логистики",
                        "department_location": "Владивосток",
                        "department_code": "00ЗК-6016",
                        "position": "Начальник",
                    },
                    {
                        "full_name": "Логист Тюмень 1",
                        "employee_code": "E-21",
                        "department": "Отдел логистики",
                        "department_location": "Тюмень",
                        "department_code": "00ЗК-4013",
                        "position": "Специалист",
                    },
                    {
                        "full_name": "Логист Тюмень 2",
                        "employee_code": "E-22",
                        "department": "Отдел логистики",
                        "department_location": "Тюмень",
                        "department_code": "00ЗК-4013",
                        "position": "Специалист",
                    },
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )
    short_people = structure_service.list_node_people(short["id"])
    assert short_people["total"] == 2
    assert {item["full_name"] for item in short_people["items"]} == {
        "Логист Тюмень 1",
        "Логист Тюмень 2",
    }
    people = structure_service.list_node_people(exact["id"])
    assert people["total"] == 1
    assert people["items"][0]["full_name"] == "Махов Антон Александрович"


def test_department_name_suggestions_city_only_for_mahov_vladivostok():
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Махов Антон Александрович",
                        "employee_code": "E-20",
                        "department": "Отдел логистики",
                        "department_location": "Владивосток",
                        "department_code": "00ЗК-6016",
                    },
                    {
                        "full_name": "Логист Тюмень 1",
                        "employee_code": "E-21",
                        "department": "Отдел логистики",
                        "department_location": "Тюмень",
                        "department_code": "00ЗК-4013",
                    },
                    {
                        "full_name": "Логист Тюмень 2",
                        "employee_code": "E-22",
                        "department": "Отдел логистики",
                        "department_location": "Тюмень",
                        "department_code": "00ЗК-4013",
                    },
                    {
                        "full_name": "Авиа Тюмень",
                        "employee_code": "E-31",
                        "department": "Отдел наземной и авиа логистики",
                        "department_location": "г.Тюмень",
                        "department_code": "00ЗК-6010",
                    },
                    {
                        "full_name": "Авиа СПб",
                        "employee_code": "E-32",
                        "department": "Отдел наземной и авиа логистики",
                        "department_location": "г. Санкт-Петербург",
                        "department_code": "00ЗК-6014",
                    },
                ],
                "updated_at": "2026-07-22T00:00:00+00:00",
            }
        )
    )
    rows = address_book.list_department_names("логистик", limit=20)["items"]
    labels = {row["department"] for row in rows}
    assert "Отдел логистики" in labels
    assert "Отдел логистики г. Владивосток" in labels
    assert "Отдел логистики г. Тюмень" not in labels
    assert "Отдел наземной и авиа логистики" in labels
    assert "Отдел наземной и авиа логистики г. Санкт-Петербург" not in labels
    people = address_book.list_people_by_department_names(["Отдел наземной и авиа логистики"])
    assert {item["full_name"] for item in people} == {"Авиа Тюмень", "Авиа СПб"}


def test_delete_force_reparents_children(structure_service):
    tree = structure_service.get_tree()
    root_id = tree["items"][0]["id"]
    block_id = tree["items"][0]["children"][0]["id"]
    child = structure_service.create_node(
        {
            "parent_id": block_id,
            "title": "Зам",
            "node_type": "deputy",
        }
    )
    structure_service.delete_node(block_id, force=True)
    refreshed = structure_service.get_node(child["id"])
    assert refreshed["parent_id"] == root_id


def test_company_structure_permissions_on_roles():
    operator = set(authorization_service.get_permissions_for_role("operator"))
    admin = set(authorization_service.get_permissions_for_role("admin"))
    viewer = set(authorization_service.get_permissions_for_role("viewer"))

    assert PERM_COMPANY_STRUCTURE_READ in viewer
    assert PERM_COMPANY_STRUCTURE_WRITE not in viewer
    assert PERM_COMPANY_STRUCTURE_READ in operator
    assert PERM_COMPANY_STRUCTURE_WRITE not in operator
    assert PERM_COMPANY_STRUCTURE_READ in admin
    assert PERM_COMPANY_STRUCTURE_WRITE in admin


def test_people_payload_keeps_work_contacts_and_excludes_personal_contacts(
    structure_service,
    monkeypatch,
):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Служба эксплуатации",
            "node_type": "service",
            "department_codes": ["D-100"],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван Иванович",
                        "employee_code": "E-100",
                        "department": "Служба эксплуатации",
                        "department_code": "D-100",
                        "department_location": "г. Тюмень",
                        "position": "Начальник службы",
                        "work_phones": [{"value": "+7 111 111-11-11"}],
                        "personal_phones": [{"value": "+7 999 999-99-99"}],
                        "work_emails": [{"value": "work@example.test"}],
                        "personal_emails": [{"value": "private@example.test"}],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )

    payload = structure_service.list_node_people(node["id"])

    assert payload["items"] == [
        {
            "full_name": "Иванов Иван Иванович",
            "position": "Начальник службы",
            "department": "Служба эксплуатации",
            "department_location": "г. Тюмень",
            "work_phones": ["+7 111 111-11-11"],
            "work_emails": ["work@example.test"],
        }
    ]


def test_search_directory_matches_only_safe_fields_and_maps_person_to_node(structure_service, monkeypatch):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отдел морской логистики",
            "node_type": "department",
            "department_codes": ["D-200"],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Петров Пётр Петрович",
                        "employee_code": "E-200",
                        "department": "Отдел морской логистики",
                        "department_code": "D-200",
                        "position": "Специалист",
                        "work_phones": [{"value": "+7 111 000-00-00"}],
                        "work_emails": [{"value": "petrov@company.test"}],
                        "personal_phones": [{"value": "+7 999 000-00-00"}],
                        "personal_emails": [{"value": "secret@example.test"}],
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )

    by_name = structure_service.search_directory("Петров", limit=20)
    assert by_name["items"][0]["kind"] == "person"
    assert by_name["items"][0]["node_id"] == node["id"]
    assert by_name["items"][0]["work_phones"] == ["+7 111 000-00-00"]
    assert by_name["items"][0]["work_emails"] == ["petrov@company.test"]
    assert "personal_phones" not in by_name["items"][0]
    assert "personal_emails" not in by_name["items"][0]

    by_work_contact = structure_service.search_directory("petrov@company.test", limit=20)
    assert by_work_contact["items"][0]["title"] == "Петров Пётр Петрович"

    by_private_contact = structure_service.search_directory("secret@example.test", limit=20)
    assert by_private_contact["items"] == []


def test_import_zup_departments_creates_children_under_selected_parent(structure_service, monkeypatch):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Логист Первый",
                        "employee_code": "E-301",
                        "department": "Управление логистики",
                        "department_code": "D-301",
                    },
                    {
                        "full_name": "Снабженец Первый",
                        "employee_code": "E-302",
                        "department": "Отдел снабжения",
                        "department_code": "D-302",
                    },
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )

    result = structure_service.import_zup_departments(
        parent_id=block["id"],
        departments=["Управление логистики", "Отдел снабжения"],
    )

    assert [item["title"] for item in result["created"]] == [
        "Управление логистики",
        "Отдел снабжения",
    ]
    assert result["created"][0]["node_type"] == "directorate"
    assert result["created"][1]["node_type"] == "department"
    assert result["created"][0]["department_codes"] == ["D-301"]

    duplicate = structure_service.import_zup_departments(
        parent_id=block["id"],
        departments=["Отдел снабжения"],
    )
    assert duplicate["created"] == []
    assert duplicate["skipped"][0]["reason"] == "already_imported"


def test_update_node_applies_parent_and_department_codes_together(structure_service):
    tree = structure_service.get_tree()
    first_block, second_block = tree["items"][0]["children"]
    node = structure_service.create_node(
        {
            "parent_id": first_block["id"],
            "title": "Отдел один",
            "node_type": "department",
            "department_codes": ["OLD"],
        }
    )

    updated = structure_service.update_node(
        node["id"],
        {
            "title": "Отдел два",
            "parent_id": second_block["id"],
            "department_codes": ["NEW"],
        },
    )

    assert updated["title"] == "Отдел два"
    assert updated["parent_id"] == second_block["id"]
    assert updated["department_codes"] == ["NEW"]


def test_move_node_reorders_siblings_atomically(structure_service):
    tree = structure_service.get_tree()
    block = tree["items"][0]["children"][0]
    first = structure_service.create_node({"parent_id": block["id"], "title": "Первый"})
    second = structure_service.create_node({"parent_id": block["id"], "title": "Второй", "sort_order": 1})
    third = structure_service.create_node({"parent_id": block["id"], "title": "Третий", "sort_order": 2})

    structure_service.move_node(third["id"], parent_id=block["id"], position=0)

    refreshed = structure_service.get_tree()
    children = refreshed["items"][0]["children"][0]["children"]
    assert [item["id"] for item in children] == [third["id"], first["id"], second["id"]]
    assert [item["sort_order"] for item in children] == [0, 1, 2]
