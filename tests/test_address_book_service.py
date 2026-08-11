from __future__ import annotations

import sys
from datetime import date
from types import SimpleNamespace

import pytest

from backend.services.address_book_service import (
    AddressBookService,
    absence_overlaps_range,
    build_absence_payload,
    calculate_age,
    classify_department_location,
    deduplicate_email_records,
    deduplicate_phone_records,
    emails_query,
    employee_query,
    employee_states_query,
    map_absence_kind,
    merge_personal_document_records,
    merge_personal_profile_records,
    normalize_email,
    normalize_phone,
    one_c_date_iso,
    personal_documents_query,
    personal_profile_query,
)


class MemoryDataManager:
    def __init__(self, payload=None):
        self.payload = payload or {}

    def load_json(self, filename, default_content=None):
        return self.payload or default_content

    def save_json(self, filename, data):
        self.payload = data
        return True


class FakeSelection:
    def __init__(self, rows):
        self.rows = list(rows)
        self.index = -1

    def Next(self):
        self.index += 1
        return self.index < len(self.rows)

    def __getattr__(self, name):
        if self.index < 0 or self.index >= len(self.rows):
            raise AttributeError(name)
        return getattr(self.rows[self.index], name)


class Fake1CConnection:
    @staticmethod
    def String(value):
        return str(value or "")


def test_normalize_phone_treats_8_and_7_as_same_mobile_prefix():
    assert normalize_phone("8 (912) 996-24-54") == "79129962454"
    assert normalize_phone("+7 912 996-24-54") == "79129962454"
    assert normalize_phone("9129962454") == "79129962454"


def test_map_absence_kind_from_zup_state_labels():
    assert map_absence_kind("Работа") == ""
    assert map_absence_kind("Отпуск основной") == "vacation"
    assert map_absence_kind("Отпуск неоплачиваемый по разрешению работодателя") == "vacation"
    assert map_absence_kind("Болезнь") == "sick"
    assert map_absence_kind("Командировка") == "trip"
    assert map_absence_kind("Работа в отпуске по уходу за ребенком") == "other"
    assert map_absence_kind("Отсутствие по невыясненным причинам") == "other"


def test_build_absence_payload_skips_work_and_keeps_return_date():
    assert build_absence_payload(state_label="Работа", starts_on="2026-01-01") is None
    payload = build_absence_payload(
        state_label="Отпуск основной",
        starts_on="2026-07-20",
        returns_on="2026-08-03",
    )
    assert payload == {
        "kind": "vacation",
        "label": "Отпуск основной",
        "starts_on": "2026-07-20",
        "returns_on": "2026-08-03",
        "source": "zup",
    }
    assert "СостоянияСотрудников" in employee_states_query()
    assert "&НаДату" in employee_states_query()
    assert "МАКСИМУМ(Состояния.Период)" in employee_states_query()
    assert "СрезПоследних" not in employee_states_query()


def test_load_employee_absences_prefers_newer_work_over_historical_sick(monkeypatch):
    rows = [
        SimpleNamespace(
            EmployeeCode="E1",
            StartsOn="20231228",
            StateLabel="Болезнь",
            ReturnsOn="20240117",
        ),
        SimpleNamespace(
            EmployeeCode="E1",
            StartsOn="20260720",
            StateLabel="Работа",
            ReturnsOn="",
        ),
    ]
    monkeypatch.setattr(
        "backend.services.address_book_service.execute_query",
        lambda *_args, **_kwargs: FakeSelection(rows),
    )

    service = AddressBookService(data_manager=MemoryDataManager())

    assert service._load_employee_absences(Fake1CConnection()) == {}


def test_absence_overlaps_range_uses_day_before_return():
    absence = {
        "kind": "vacation",
        "label": "Отпуск основной",
        "starts_on": "2026-07-20",
        "returns_on": "2026-08-03",
    }
    assert absence_overlaps_range(
        absence,
        range_start=date(2026, 7, 30),
        range_end=date(2026, 8, 6),
        today=date(2026, 7, 31),
    )
    # returns_on is first day back — 03.08 already at work
    assert not absence_overlaps_range(
        absence,
        range_start=date(2026, 8, 3),
        range_end=date(2026, 8, 3),
        today=date(2026, 8, 3),
    )
    assert absence_overlaps_range(
        absence,
        range_start=date(2026, 8, 2),
        range_end=date(2026, 8, 2),
        today=date(2026, 8, 2),
    )


def test_absence_overlaps_range_drops_stale_open_ended():
    stale = {"kind": "sick", "label": "Болезнь", "starts_on": "2020-01-01", "returns_on": None}
    assert not absence_overlaps_range(
        stale,
        range_start=date(2026, 7, 30),
        range_end=date(2026, 8, 6),
        today=date(2026, 7, 31),
    )
    recent_open = {"kind": "sick", "label": "Болезнь", "starts_on": "2026-07-01", "returns_on": None}
    assert absence_overlaps_range(
        recent_open,
        range_start=date(2026, 7, 30),
        range_end=date(2026, 8, 6),
        today=date(2026, 7, 31),
    )


def test_list_absences_from_address_book_cache():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "updated_at": "2026-07-31T05:00:00+00:00",
                "items": [
                    {
                        "employee_code": "00ЗК-55848",
                        "full_name": "Орлов Павел Максимович",
                        "department": "ИТ",
                        "position": "Инженер",
                        "absence": {
                            "kind": "vacation",
                            "label": "Отпуск основной",
                            "starts_on": "2026-07-20",
                            "returns_on": "2026-08-03",
                            "source": "zup",
                        },
                    },
                    {
                        "employee_code": "X-1",
                        "full_name": "Старый Больничный",
                        "department": "Склад",
                        "absence": {
                            "kind": "sick",
                            "label": "Болезнь",
                            "starts_on": "2020-01-01",
                            "returns_on": None,
                            "source": "zup",
                        },
                    },
                    {
                        "employee_code": "W-1",
                        "full_name": "Работает",
                        "department": "Офис",
                    },
                ],
            }
        )
    )
    payload = service.list_absences(
        starts_on=date(2026, 7, 30),
        ends_on=date(2026, 8, 6),
        limit=50,
    )
    assert payload["count"] == 1
    assert payload["as_of"] == "2026-07-31T05:00:00+00:00"
    item = payload["items"][0]
    assert item["display_name"] == "Орлов Павел Максимович"
    assert item["source"] == "zup"
    assert item["ends_on"] == "2026-08-02"
    assert item["returns_on"] == "2026-08-03"
    assert item["kind_label"] == "Отпуск основной"


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
                "contact_kind": "Email Корпоративный",
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
            "kind": "Email Корпоративный",
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


def test_emails_query_includes_actual_zup_corporate_contact_kind():
    query = emails_query()

    assert 'Контакты.Вид.Наименование = "Email Корпоративный"' in query


def test_normalize_email_lowercases_value():
    assert normalize_email("User@Example.COM") == "user@example.com"


def test_employee_query_selects_department_code():
    query = employee_query()
    assert "КАК DepartmentCode" in query
    assert "Подразделение.Код" in query


def test_personal_queries_target_zup_registers():
    assert "ДатаРождения" in personal_profile_query()
    assert "Адрес по прописке" in personal_profile_query()
    assert "ДокументыФизическихЛиц" in personal_documents_query()
    assert "ЯвляетсяДокументомУдостоверяющимЛичность" in personal_documents_query()


def test_one_c_date_iso_handles_python_dates_and_zero_dates():
    connection = SimpleNamespace(String=lambda value: str(value))
    assert one_c_date_iso(connection, SimpleNamespace(year=1990, month=5, day=1)) == "1990-05-01"
    assert one_c_date_iso(connection, SimpleNamespace(year=1, month=1, day=1)) == ""
    assert one_c_date_iso(connection, "2010-06-15T00:00:00") == "2010-06-15"


def test_merge_personal_records_prefers_passport_and_propiska():
    profiles = merge_personal_profile_records(
        [
            {
                "employee_code": "E1",
                "date_of_birth": "1990-01-01",
                "birth_place": "Москва",
                "address_kind": "Адрес проживания",
                "registration_address": "временный",
            },
            {
                "employee_code": "E1",
                "date_of_birth": "",
                "birth_place": "",
                "address_kind": "Адрес по прописке",
                "registration_address": "прописка",
            },
        ]
    )
    assert profiles["E1"]["registration_address"] == "прописка"

    docs = merge_personal_document_records(
        [
            {
                "employee_code": "E1",
                "document_kind": "Водительское удостоверение",
                "passport_series": "99",
                "passport_number": "111111",
                "issued_by": "ГИБДД",
                "issuer_code": "",
                "issue_date": "2015-01-01",
            },
            {
                "employee_code": "E1",
                "document_kind": "Паспорт РФ",
                "passport_series": "4509",
                "passport_number": "123456",
                "issued_by": "ОВД",
                "issuer_code": "770-001",
                "issue_date": "2010-01-01",
            },
        ]
    )
    assert docs["E1"]["passport_number"] == "123456"
    assert "document_kind" not in docs["E1"]


def test_get_personal_by_codes_reads_separate_cache_bucket():
    manager = MemoryDataManager(
        {
            "items": [{
                "full_name": "Иванов",
                "employee_code": "E1",
                "work_phones": [{"value": "100"}],
                "personal_phones": [{"value": "79990001122"}],
                "work_emails": [{"value": "ivanov@zsgp.ru"}],
                "personal_emails": [{"value": "ivanov@example.com"}],
            }],
            "personal_by_code": {
                "E1": {
                    "date_of_birth": "1990-01-01",
                    "passport_number": "123456",
                    "ignored": "x",
                }
            },
        }
    )
    service = AddressBookService(data_manager=manager)
    public_item = service.search("иванов")["items"][0]
    assert public_item["age"] == calculate_age("1990-01-01")
    assert public_item.get("date_of_birth") is None
    assert public_item.get("passport_number") is None
    assert service.get_personal_by_codes(["E1"]) == {
        "E1": {"date_of_birth": "1990-01-01", "passport_number": "123456"}
    }

    restricted_item = service.search(
        "иванов",
        include_age=False,
        include_personal_emails=False,
        include_personal_phones=False,
    )["items"][0]
    assert restricted_item.get("age") is None
    assert restricted_item["work_phones"] == [{"value": "100"}]
    assert restricted_item["personal_phones"] == []
    assert restricted_item["work_emails"] == [{"value": "ivanov@zsgp.ru"}]
    assert restricted_item["personal_emails"] == []

    assert service.search("79990001122", include_personal_phones=False)["total"] == 0
    assert service.search("79990001122", include_personal_phones=True)["total"] == 1
    assert service.search("ivanov@example.com", include_personal_emails=False)["total"] == 0
    assert service.search("ivanov@example.com", include_personal_emails=True)["total"] == 1


def test_calculate_age_uses_birthday_and_rejects_invalid_dates():
    today = date(2026, 8, 5)

    assert calculate_age("1990-08-05", today=today) == 36
    assert calculate_age("1990-08-06", today=today) == 35
    assert calculate_age("not-a-date", today=today) is None
    assert calculate_age("2027-01-01", today=today) is None


def test_search_matches_name_department_position_city_and_phone():
    manager = MemoryDataManager(
        {
            "updated_at": "2026-05-21T10:00:00+00:00",
            "items": [
                {
                    "full_name": "Иванов Иван Иванович",
                    "department": "Отдел мониторинга",
                    "department_code": "00ЗК-6031",
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
                    "department_code": "00ЗК-6051",
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
    assert service.search("00зк-6031")["items"][0]["full_name"] == "Иванов Иван Иванович"


def test_list_people_by_department_codes_and_department_code_catalog():
    manager = MemoryDataManager(
        {
            "updated_at": "2026-07-22T10:00:00+00:00",
            "items": [
                {
                    "full_name": "Абабков Данил Павлович",
                    "department": "Отделение буровых работ",
                    "department_code": "00ЗК-6942",
                    "position": "Помощник",
                },
                {
                    "full_name": "Иванов Иван",
                    "department": "Отделение буровых работ",
                    "department_code": "00ЗК-6942",
                    "position": "Машинист",
                },
                {
                    "full_name": "Петров",
                    "department": "Бухгалтерия",
                    "department_code": "000000008",
                    "position": "Бухгалтер",
                },
            ],
        }
    )
    service = AddressBookService(data_manager=manager)
    people = service.list_people_by_department_codes(["00ЗК-6942"])
    assert len(people) == 2
    catalog = service.list_department_codes("буров")
    assert catalog["total"] == 1
    assert catalog["items"][0]["department_code"] == "00ЗК-6942"
    assert catalog["items"][0]["people_count"] == 2
    assert catalog["items"][0]["department_locations"] == [""]
    assert catalog["items"][0]["binding_group"] == "object"


@pytest.mark.parametrize(
    ("location", "expected"),
    [
        ("Москва", "office"),
        ("г. Санкт-Петербург", "office"),
        ("СПб", "office"),
        ("Тюмень", "office"),
        ("г.Тюмень", "office"),
        ("яТюмень2", "office"),
        ("Новый Уренгой", "object"),
        ("ДО отпуска", "object"),
        ("", "object"),
    ],
)
def test_classify_department_location(location, expected):
    assert classify_department_location(location) == expected


def test_department_code_catalog_returns_locations_and_mixed_binding_group():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Офисный сотрудник",
                        "department": "Управление главного энергетика",
                        "department_code": "MIX-1",
                        "department_location": "Тюмень",
                    },
                    {
                        "full_name": "Сотрудник объекта",
                        "department": "Управление главного энергетика",
                        "department_code": "MIX-1",
                        "department_location": "Новый Уренгой",
                    },
                ]
            }
        )
    )

    payload = service.list_department_codes("энергетика", limit=20)

    assert payload["items"] == [
        {
            "department_code": "MIX-1",
            "department": "Управление главного энергетика",
            "people_count": 2,
            "department_locations": ["Новый Уренгой", "Тюмень"],
            "binding_group": "mixed",
        }
    ]


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

        def _load_personal_data(self, connection):
            calls.append("personal")
            return {
                "E1": {
                    "date_of_birth": "1990-01-15",
                    "passport_series": "4509",
                    "passport_number": "123456",
                }
            }

    items, personal = TestService(data_manager=MemoryDataManager())._load_items_from_1c()

    assert calls == ["init", "connect", "employees", "phones", "emails", "personal", "uninit"]
    assert items[0]["employee_code"] == "E1"
    assert items[0]["work_emails"][0]["value"] == "ivanov@zsgp.ru"
    assert items[0]["work_phones"][0]["value"] == "83452384202"
    assert personal["E1"]["passport_number"] == "123456"


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
