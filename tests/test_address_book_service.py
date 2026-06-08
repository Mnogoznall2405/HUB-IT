from __future__ import annotations

import sys
from types import SimpleNamespace

import pytest

from backend.services.address_book_service import (
    AddressBookService,
    deduplicate_email_records,
    deduplicate_phone_records,
    normalize_email,
    normalize_phone,
)


class MemoryDataManager:
    def __init__(self, payload=None):
        self.payload = payload or {}

    def load_json(self, filename, default_content=None):
        return self.payload or default_content

    def save_json(self, filename, data):
        self.payload = data
        return True


def test_normalize_phone_treats_8_and_7_as_same_mobile_prefix():
    assert normalize_phone("8 (912) 996-24-54") == "79129962454"
    assert normalize_phone("+7 912 996-24-54") == "79129962454"
    assert normalize_phone("9129962454") == "79129962454"


def test_deduplicate_phone_records_prefers_work_then_mobile():
    phones = deduplicate_phone_records(
        [
            {
                "employee_code": "E1",
                "contact_kind": "Домашний телефон",
                "phone": "89129962454",
            },
            {
                "employee_code": "E1",
                "contact_kind": "Мобильный телефон",
                "phone": "+7 912 996-24-54",
            },
            {
                "employee_code": "E1",
                "contact_kind": "Рабочий телефон",
                "phone": "8 912 996-24-54",
            },
            {
                "employee_code": "E1",
                "contact_kind": "Мобильный телефон",
                "phone": "89312250556, 89312250557",
            },
        ]
    )

    assert phones["E1"]["work"] == [
        {
            "kind": "Рабочий телефон",
            "value": "8 912 996-24-54",
            "normalized": "79129962454",
        }
    ]
    assert phones["E1"]["personal"] == [
        {
            "kind": "Мобильный телефон",
            "value": "89312250556",
            "normalized": "79312250556",
        },
        {
            "kind": "Мобильный телефон",
            "value": "89312250557",
            "normalized": "79312250557",
        },
    ]


def test_deduplicate_email_records_prefers_corporate_over_personal():
    emails = deduplicate_email_records(
        [
            {
                "employee_code": "E1",
                "contact_kind": "Email",
                "email": "personal@example.com",
            },
            {
                "employee_code": "E1",
                "contact_kind": "Корпоративный E-mail",
                "email": "work@example.com",
            },
            {
                "employee_code": "E1",
                "contact_kind": "Email",
                "email": "work@example.com, personal@example.com",
            },
        ]
    )

    assert emails["E1"]["work"] == [
        {
            "kind": "Корпоративный E-mail",
            "value": "work@example.com",
            "normalized": "work@example.com",
        }
    ]
    assert emails["E1"]["personal"] == [
        {
            "kind": "Email",
            "value": "personal@example.com",
            "normalized": "personal@example.com",
        }
    ]


def test_normalize_email_lowercases_value():
    assert normalize_email("User@Example.COM") == "user@example.com"


def test_search_matches_name_department_position_city_and_phone():
    manager = MemoryDataManager(
        {
            "updated_at": "2026-05-21T10:00:00+00:00",
            "items": [
                {
                    "full_name": "Иванов Иван Иванович",
                    "department": "Отдел мониторинга",
                    "department_location": "г. Санкт-Петербург",
                    "position": "Ведущий специалист",
                    "work_phones": [{"kind": "Рабочий телефон", "value": "83452384202", "normalized": "73452384202"}],
                    "personal_phones": [],
                    "work_emails": [{"kind": "Корпоративный E-mail", "value": "ivanov@zsgp.ru", "normalized": "ivanov@zsgp.ru"}],
                    "personal_emails": [],
                },
                {
                    "full_name": "Петров Петр Петрович",
                    "department": "Сметный отдел",
                    "department_location": "Тюмень",
                    "position": "Инженер",
                    "work_phones": [],
                    "personal_phones": [{"kind": "Мобильный телефон", "value": "89199568055", "normalized": "79199568055"}],
                    "work_emails": [],
                    "personal_emails": [],
                },
            ],
        }
    )
    service = AddressBookService(data_manager=manager)

    assert service.search("иванов")["total"] == 1
    assert service.search("мониторинг")["items"][0]["full_name"] == "Иванов Иван Иванович"
    assert service.search("санкт специалист")["total"] == 1
    assert service.search("9199568055")["items"][0]["full_name"] == "Петров Петр Петрович"
    assert service.search("ivanov@zsgp.ru")["items"][0]["full_name"] == "Иванов Иван Иванович"


def test_search_ranks_name_matches_before_other_fields_and_sorts_empty_query():
    manager = MemoryDataManager(
        {
            "items": [
                {
                    "full_name": "Zeta User",
                    "department": "Ivanov department",
                    "department_location": "",
                    "position": "Engineer",
                    "work_phones": [],
                    "personal_phones": [],
                },
                {
                    "full_name": "Ivanov User",
                    "department": "Operations",
                    "department_location": "",
                    "position": "Engineer",
                    "work_phones": [],
                    "personal_phones": [],
                },
                {
                    "full_name": "Alpha User",
                    "department": "",
                    "department_location": "",
                    "position": "Specialist",
                    "work_phones": [],
                    "personal_phones": [],
                },
            ],
        }
    )
    service = AddressBookService(data_manager=manager)

    assert [item["full_name"] for item in service.search("")["items"]] == [
        "Alpha User",
        "Ivanov User",
        "Zeta User",
    ]
    assert [item["full_name"] for item in service.search("ivanov")["items"]] == [
        "Ivanov User",
        "Zeta User",
    ]


def test_load_items_initializes_com_in_current_thread(monkeypatch):
    calls = []

    fake_pythoncom = SimpleNamespace(
        CoInitialize=lambda: calls.append("init"),
        CoUninitialize=lambda: calls.append("uninit"),
    )
    monkeypatch.setitem(sys.modules, "pythoncom", fake_pythoncom)

    class TestService(AddressBookService):
        def _connect_1c(self):
            calls.append("connect")
            return object()

        def _load_employees(self, connection):
            calls.append("employees")
            return [
                {
                    "full_name": "Ivanov User",
                    "_employee_code": "E1",
                    "department": "",
                    "department_location": "",
                    "position": "",
                }
            ]

        def _load_phones(self, connection):
            calls.append("phones")
            return {
                "E1": {
                    "work": [{"kind": "Рабочий телефон", "value": "83452384202", "normalized": "73452384202"}],
                    "personal": [],
                }
            }

        def _load_emails(self, connection):
            calls.append("emails")
            return {
                "E1": {
                    "work": [{"kind": "Корпоративный E-mail", "value": "ivanov@zsgp.ru", "normalized": "ivanov@zsgp.ru"}],
                    "personal": [],
                }
            }

    items = TestService(data_manager=MemoryDataManager())._load_items_from_1c()

    assert calls == ["init", "connect", "employees", "phones", "emails", "uninit"]
    assert items[0]["work_emails"][0]["value"] == "ivanov@zsgp.ru"
    assert items[0]["work_phones"][0]["value"] == "83452384202"


def test_sync_error_keeps_previous_cache():
    manager = MemoryDataManager(
        {
            "updated_at": "old",
            "items": [{"full_name": "Кэш"}],
            "last_error": "",
        }
    )
    service = AddressBookService(data_manager=manager)

    def fail():
        raise RuntimeError("1C unavailable")

    service._load_items_from_1c = fail

    with pytest.raises(RuntimeError, match="1C unavailable"):
        service.sync_from_1c()

    assert manager.payload["updated_at"] == "old"
    assert manager.payload["items"] == [{"full_name": "Кэш"}]
    assert manager.payload["last_error"] == "1C unavailable"
