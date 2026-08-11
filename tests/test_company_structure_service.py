from __future__ import annotations

import io

import pytest
from PIL import Image

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


def test_manual_chart_position_can_be_saved_and_reset(structure_service):
    block = structure_service.get_tree()["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Ручная позиция",
            "node_type": "department",
            "department_codes": [],
        }
    )

    assert node["layout_x"] is None
    assert node["layout_y"] is None

    positioned = structure_service.update_node(
        node["id"],
        {"layout_x": 320.5, "layout_y": 184.25},
    )
    assert positioned["layout_x"] == 320.5
    assert positioned["layout_y"] == 184.25

    tree_node = structure_service.get_node(node["id"])
    assert tree_node["layout_x"] == 320.5
    assert tree_node["layout_y"] == 184.25

    result = structure_service.reset_layout_positions()
    assert result["updated"] == 1
    reset_node = structure_service.get_node(node["id"])
    assert reset_node["layout_x"] is None
    assert reset_node["layout_y"] is None


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


def test_tree_counts_people_by_semantic_subtree_without_duplicates(structure_service, monkeypatch):
    block = structure_service.get_tree()["items"][0]["children"][0]
    directorate = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Управление испытаний",
            "node_type": "directorate",
            "department_codes": ["D-1"],
        }
    )
    department = structure_service.create_node(
        {
            "parent_id": directorate["id"],
            "title": "Отдел испытаний",
            "node_type": "department",
            "department_codes": ["D-2"],
        }
    )
    legacy = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отдел наследия",
            "node_type": "department",
            "department_codes": [],
        }
    )
    people = [
        {"full_name": "Первый", "employee_code": "E-1", "department": "Управление испытаний", "department_code": "D-1"},
        {"full_name": "Второй", "employee_code": "E-2", "department": "Отдел испытаний", "department_code": "D-2"},
        {"full_name": "Второй", "employee_code": "E-2", "department": "Отдел испытаний", "department_code": "D-2"},
        {"full_name": "Третий", "employee_code": "E-3", "department": "Отдел наследия", "department_location": "Москва"},
    ]
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        AddressBookService(data_manager=MemoryDataManager({"items": people})),
    )

    tree = structure_service.get_tree()
    root = tree["items"][0]
    refreshed_block = next(item for item in root["children"] if item["id"] == block["id"])
    refreshed_directorate = next(item for item in refreshed_block["children"] if item["id"] == directorate["id"])
    refreshed_department = refreshed_directorate["children"][0]
    refreshed_legacy = next(item for item in refreshed_block["children"] if item["id"] == legacy["id"])

    assert refreshed_directorate["direct_people_count"] == 1
    assert refreshed_directorate["subtree_people_count"] == 2
    assert refreshed_department["direct_people_count"] == 1
    assert refreshed_department["subtree_people_count"] == 1
    assert refreshed_legacy["direct_people_count"] == 1
    assert refreshed_block["subtree_people_count"] == 3
    assert refreshed_block["child_node_count"] >= 2


def test_node_people_can_include_the_same_semantic_subtree_as_the_card_count(
    structure_service,
    monkeypatch,
):
    block = structure_service.get_tree()["items"][0]["children"][0]
    directorate = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Управление энергетики",
            "node_type": "directorate",
            "department_codes": ["D-ROOT"],
        }
    )
    department = structure_service.create_node(
        {
            "parent_id": directorate["id"],
            "title": "Отдел энергетики",
            "node_type": "department",
            "department_codes": ["D-CHILD"],
        }
    )
    group = structure_service.create_node(
        {
            "parent_id": department["id"],
            "title": "Группа энергетики",
            "node_type": "group",
            "department_codes": ["D-GROUP"],
        }
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        AddressBookService(
            data_manager=MemoryDataManager(
                {
                    "items": [
                        {"full_name": "Первый", "employee_code": "E-1", "department_code": "D-ROOT"},
                        {"full_name": "Второй", "employee_code": "E-2", "department_code": "D-CHILD"},
                        {"full_name": "Третий", "employee_code": "E-3", "department_code": "D-GROUP"},
                    ]
                }
            )
        ),
    )

    tree = structure_service.get_tree()
    refreshed_directorate = next(
        node
        for node in tree["items"][0]["children"][0]["children"]
        if node["id"] == directorate["id"]
    )
    assert refreshed_directorate["subtree_people_count"] == 3
    assert structure_service.list_node_people(directorate["id"])["total"] == 1

    subtree_people = structure_service.list_node_people(
        directorate["id"],
        include_descendants=True,
    )
    assert subtree_people["total"] == refreshed_directorate["subtree_people_count"]
    assert {person["full_name"] for person in subtree_people["items"]} == {
        "Первый",
        "Второй",
        "Третий",
    }
    assert structure_service.list_node_people(group["id"], include_descendants=True)["total"] == 1


def test_leader_candidates_and_node_photo(structure_service, monkeypatch, tmp_path):
    block = structure_service.get_tree()["items"][0]["children"][0]
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        AddressBookService(
            data_manager=MemoryDataManager(
                {
                    "items": [
                        {
                            "full_name": "Иванов Иван",
                            "employee_code": "E-LEAD",
                            "position": "Начальник управления",
                            "department": "Управление",
                            "department_location": "Тюмень",
                        }
                    ]
                }
            )
        ),
    )
    monkeypatch.setattr(
        CompanyStructureService,
        "_photos_dir",
        staticmethod(lambda: tmp_path),
    )

    candidates = structure_service.list_leader_candidates("Иванов")
    assert candidates["items"][0]["employee_code"] == "E-LEAD"

    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Заместитель генерального директора",
            "node_type": "deputy",
            "person_name": "Иванов Иван",
            "person_position": "Начальник управления",
            "person_employee_code": "E-LEAD",
        }
    )
    image_buffer = io.BytesIO()
    Image.new("RGB", (20, 40), color="navy").save(image_buffer, format="PNG")

    photographed = structure_service.save_node_photo(
        node["id"],
        raw=image_buffer.getvalue(),
        content_type="image/png",
    )
    assert photographed["person_employee_code"] == "E-LEAD"
    assert photographed["person_photo_url"].startswith("/api/v1/company-structure/nodes/")
    assert structure_service.get_node_photo_path(node["id"]).is_file()

    cleared = structure_service.delete_node_photo(node["id"])
    assert cleared["person_photo_url"] is None
    assert not (tmp_path / f"{node['id']}.jpg").exists()


def test_leader_data_is_allowed_only_for_root_and_deputy_cards(structure_service, tmp_path, monkeypatch):
    block = structure_service.get_tree()["items"][0]["children"][0]
    monkeypatch.setattr(CompanyStructureService, "_photos_dir", staticmethod(lambda: tmp_path))
    image_buffer = io.BytesIO()
    Image.new("RGB", (20, 20), color="navy").save(image_buffer, format="PNG")

    department = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Отдел без карточки руководителя",
            "node_type": "department",
            "person_name": "Лишний Руководитель",
            "person_position": "Начальник",
            "person_employee_code": "E-EXTRA",
        }
    )
    assert department["person_name"] == ""
    assert department["person_position"] == ""
    assert department["person_employee_code"] is None
    with pytest.raises(ValueError, match="root and deputy"):
        structure_service.save_node_photo(
            department["id"],
            raw=image_buffer.getvalue(),
            content_type="image/png",
        )

    deputy = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Заместитель директора",
            "node_type": "deputy",
            "person_name": "Разрешённый Руководитель",
            "person_position": "Заместитель директора",
            "person_employee_code": "E-DEPUTY",
        }
    )
    assert deputy["person_name"] == "Разрешённый Руководитель"
    converted = structure_service.update_node(deputy["id"], {"node_type": "department"})
    assert converted["person_name"] == ""
    assert converted["person_position"] == ""
    assert converted["person_employee_code"] is None


def test_department_codes_override_title_matching(structure_service, monkeypatch):
    block = structure_service.get_tree()["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "Управление главного энергетика",
            "node_type": "directorate",
            "department_codes": ["0000-0270"],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Офисный сотрудник",
                        "employee_code": "E-1",
                        "department": "Управление главного энергетика",
                        "department_code": "0000-0270",
                        "department_location": "Тюмень",
                    },
                    {
                        "full_name": "Сотрудник объекта",
                        "employee_code": "E-2",
                        "department": "Управление главного энергетика",
                        "department_code": "00ЗК-3176",
                        "department_location": "Новый Уренгой",
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

    assert people["matched_by_title"] is False
    assert [person["full_name"] for person in people["items"]] == ["Офисный сотрудник"]


def test_uge_manual_office_and_object_cards_return_2_and_27_people(
    structure_service,
    monkeypatch,
):
    object_codes = [
        "00ЗК-3176", "00ЗК-3465", "00ЗК-3697", "00ЗК-3995", "00ЗК-4435",
        "00ЗК-4789", "00ЗК-4957", "00ЗК-5114", "00ЗК-5129", "00ЗК-5144",
        "00ЗК-5337", "00ЗК-5534", "00ЗК-5646", "00ЗК-5963", "00ЗК-6087",
        "00ЗК-6533", "00ЗК-6767", "00ЗК-6991", "00ЗК-7009", "00ЗК-7335",
    ]
    block = structure_service.get_tree()["items"][0]["children"][0]
    office_node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ",
            "node_type": "directorate",
            "department_codes": ["0000-0270"],
        }
    )
    object_node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ объект",
            "node_type": "directorate",
            "department_codes": object_codes,
        }
    )
    items = [
        {
            "full_name": f"Офис {index}",
            "employee_code": f"OFFICE-{index}",
            "department": "Управление главного энергетика",
            "department_code": "0000-0270",
            "department_location": "Тюмень",
        }
        for index in range(2)
    ]
    items.extend(
        {
            "full_name": f"Объект {index}",
            "employee_code": f"OBJECT-{index}",
            "department": "Управление главного энергетика",
            "department_code": object_codes[index % len(object_codes)],
            "department_location": "Новый Уренгой",
        }
        for index in range(27)
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        AddressBookService(data_manager=MemoryDataManager({"items": items})),
    )

    assert structure_service.list_node_people(office_node["id"])["total"] == 2
    assert structure_service.list_node_people(object_node["id"])["total"] == 27


def test_department_code_cannot_be_bound_to_two_cards(structure_service):
    block = structure_service.get_tree()["items"][0]["children"][0]
    first = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ",
            "node_type": "directorate",
            "department_codes": ["0000-0270"],
        }
    )
    second = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ объект",
            "node_type": "directorate",
            "department_codes": [],
        }
    )

    with pytest.raises(ValueError, match="0000-0270.*УГЭ"):
        structure_service.set_department_codes(second["id"], ["0000-0270"])

    assert structure_service.get_node(first["id"])["department_codes"] == ["0000-0270"]
    assert structure_service.get_node(second["id"])["department_codes"] == []


def test_department_code_suggestions_include_current_card_owner(
    structure_service,
    monkeypatch,
):
    block = structure_service.get_tree()["items"][0]["children"][0]
    node = structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ",
            "node_type": "directorate",
            "department_codes": ["0000-0270"],
        }
    )
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Офисный сотрудник",
                        "department": "Управление главного энергетика",
                        "department_code": "0000-0270",
                        "department_location": "Тюмень",
                    }
                ]
            }
        )
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        address_book,
    )

    item = structure_service.list_department_code_suggestions("энергетика")["items"][0]

    assert item["binding_group"] == "office"
    assert item["linked_node_id"] == node["id"]
    assert item["linked_node_title"] == "УГЭ"


def test_directory_search_finds_manual_office_and_object_card_titles(
    structure_service,
    monkeypatch,
):
    block = structure_service.get_tree()["items"][0]["children"][0]
    structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ",
            "node_type": "directorate",
            "department_codes": ["0000-0270"],
        }
    )
    structure_service.create_node(
        {
            "parent_id": block["id"],
            "title": "УГЭ объект",
            "node_type": "directorate",
            "department_codes": ["00ЗК-3176"],
        }
    )
    monkeypatch.setattr(
        "backend.services.company_structure_service.address_book_service",
        AddressBookService(data_manager=MemoryDataManager({"items": []})),
    )

    all_uge_titles = {
        item["title"]
        for item in structure_service.search_directory("УГЭ")["items"]
        if item["kind"] == "node"
    }
    object_titles = {
        item["title"]
        for item in structure_service.search_directory("УГЭ объект")["items"]
        if item["kind"] == "node"
    }

    assert {"УГЭ", "УГЭ объект"}.issubset(all_uge_titles)
    assert object_titles == {"УГЭ объект"}


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


def test_department_name_suggestions_split_office_and_object_locations():
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
    by_label = {row["department"]: row for row in rows}
    assert by_label["Отдел логистики"]["binding_group"] == "office"
    assert by_label["Отдел логистики"]["department_codes"] == ["00ЗК-4013"]
    assert by_label["Отдел логистики объект"]["binding_group"] == "object"
    assert by_label["Отдел логистики объект"]["department_codes"] == ["00ЗК-6016"]
    assert by_label["Отдел наземной и авиа логистики"]["binding_group"] == "office"
    assert set(by_label["Отдел наземной и авиа логистики"]["department_codes"]) == {
        "00ЗК-6010",
        "00ЗК-6014",
    }
    assert "Отдел наземной и авиа логистики объект" not in by_label
    people = address_book.list_people_by_department_names(["Отдел наземной и авиа логистики"])
    assert {item["full_name"] for item in people} == {"Авиа Тюмень", "Авиа СПб"}


def test_department_name_suggestions_split_uge_into_two_ready_cards():
    object_codes = ["00ЗК-3176", "00ЗК-3465"]
    items = [
        {
            "full_name": f"Офис {index}",
            "department": "Управление главного энергетика",
            "department_code": "0000-0270",
            "department_location": "Тюмень",
        }
        for index in range(2)
    ]
    items.extend(
        {
            "full_name": f"Объект {index}",
            "department": "Управление главного энергетика",
            "department_code": object_codes[index % 2],
            "department_location": "Новый Уренгой",
        }
        for index in range(3)
    )
    address_book = AddressBookService(data_manager=MemoryDataManager({"items": items}))

    rows = address_book.list_department_names("главного энергетика", limit=20)["items"]

    assert rows == [
        {
            "department": "Управление главного энергетика",
            "department_base": "Управление главного энергетика",
            "department_location": "Тюмень",
            "department_locations": ["Тюмень"],
            "people_count": 2,
            "department_codes": ["0000-0270"],
            "binding_group": "office",
        },
        {
            "department": "Управление главного энергетика объект",
            "department_base": "Управление главного энергетика",
            "department_location": "Новый Уренгой",
            "department_locations": ["Новый Уренгой"],
            "people_count": 3,
            "department_codes": object_codes,
            "binding_group": "object",
        },
    ]


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
                        "department_location": "Тюмень",
                    },
                    {
                        "full_name": "Снабженец Первый",
                        "employee_code": "E-302",
                        "department": "Отдел снабжения",
                        "department_code": "D-302",
                        "department_location": "Москва",
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


def test_import_zup_departments_creates_separate_office_and_object_cards(
    structure_service,
    monkeypatch,
):
    block = structure_service.get_tree()["items"][0]["children"][0]
    address_book = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Офисный сотрудник",
                        "employee_code": "E-401",
                        "department": "Управление главного энергетика",
                        "department_code": "0000-0270",
                        "department_location": "Тюмень",
                    },
                    {
                        "full_name": "Сотрудник объекта",
                        "employee_code": "E-402",
                        "department": "Управление главного энергетика",
                        "department_code": "00ЗК-3176",
                        "department_location": "Новый Уренгой",
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
        departments=[
            "Управление главного энергетика",
            "Управление главного энергетика объект",
        ],
    )

    assert [item["title"] for item in result["created"]] == [
        "Управление главного энергетика",
        "Управление главного энергетика объект",
    ]
    assert result["created"][0]["department_codes"] == ["0000-0270"]
    assert result["created"][1]["department_codes"] == ["00ЗК-3176"]


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
