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
    dismissed_employee_full_query,
    dismissed_employee_query,
    emails_query,
    employee_query,
    employee_states_query,
    map_absence_kind,
    merge_personal_document_records,
    merge_personal_profile_records,
    normalize_email,
    normalize_phone,
    normalize_search_text,
    normalize_text,
    one_c_date_iso,
    parse_age_token,
    personal_documents_query,
    personal_profile_query,
    phones_query,
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
    assert "Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)" in query
    assert "Текущие.ФизическоеЛицо.Отчество КАК MiddleName" in query
    dismissed_query = dismissed_employee_query(2)
    assert "Текущие.ДатаУвольнения <> ДАТАВРЕМЯ(1, 1, 1)" in dismissed_query
    assert "Текущие.ДатаУвольнения <= &НаДату" in dismissed_query
    assert "Текущие.ФизическоеЛицо.Отчество КАК MiddleName" in dismissed_query


def test_personal_queries_target_zup_registers():
    assert "ДатаРождения" in personal_profile_query()
    assert "Адрес по прописке" in personal_profile_query()
    assert "Текущие.ФизическоеЛицо.ИНН КАК Inn" in personal_profile_query()
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
                "inn": "770123456789",
                "date_of_birth": "1990-01-01",
                "birth_place": "Москва",
                "address_kind": "Адрес проживания",
                "registration_address": "временный",
            },
            {
                "employee_code": "E1",
                "inn": "",
                "date_of_birth": "",
                "birth_place": "",
                "address_kind": "Адрес по прописке",
                "registration_address": "прописка",
            },
        ]
    )
    assert profiles["E1"]["registration_address"] == "прописка"
    assert profiles["E1"]["inn"] == "770123456789"

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
                "hire_date": "2021-05-17",
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
    public_item = service.search("иванов", include_age=True)["items"][0]
    assert public_item["age"] == calculate_age("1990-01-01")
    assert public_item.get("date_of_birth") is None
    assert public_item.get("passport_number") is None
    assert public_item.get("hire_date") is None
    assert service.get_personal_by_codes(["E1"]) == {
        "E1": {"date_of_birth": "1990-01-01", "passport_number": "123456"}
    }

    restricted_item = service.search(
        "иванов",
        include_age=False,
        include_hire_date=False,
        include_personal_emails=False,
        include_personal_phones=False,
    )["items"][0]
    assert restricted_item.get("age") is None
    assert restricted_item.get("hire_date") is None
    assert restricted_item["work_phones"] == [{"value": "100"}]
    assert restricted_item["personal_phones"] == []
    assert restricted_item["work_emails"] == [{"value": "ivanov@zsgp.ru"}]
    assert restricted_item["personal_emails"] == []

    assert service.search("79990001122", include_personal_phones=False)["total"] == 0
    assert service.search("79990001122", include_personal_phones=True)["total"] == 1
    assert service.search("ivanov@example.com", include_personal_emails=False)["total"] == 0
    assert service.search("ivanov@example.com", include_personal_emails=True)["total"] == 1

    allowed_item = service.search("иванов", include_hire_date=True)["items"][0]
    assert allowed_item["hire_date"] == "2021-05-17"


def test_search_and_snapshot_without_flags_hide_personal_fields():
    age = calculate_age("1990-01-01")
    assert age is not None
    manager = MemoryDataManager(
        {
            "items": [{
                "full_name": "Иванов Иван",
                "employee_code": "E1",
                "work_phones": [{"value": "100"}],
                "personal_phones": [{"value": "79990001122"}],
                "work_emails": [{"value": "ivanov@zsgp.ru"}],
                "personal_emails": [{"value": "ivanov@example.com"}],
            }],
            "personal_by_code": {"E1": {"date_of_birth": "1990-01-01"}},
        }
    )
    service = AddressBookService(data_manager=manager)

    default_item = service.search("иванов")["items"][0]
    assert default_item.get("age") is None
    assert default_item["personal_phones"] == []
    assert default_item["personal_emails"] == []
    assert default_item["work_phones"] == [{"value": "100"}]
    assert default_item["work_emails"] == [{"value": "ivanov@zsgp.ru"}]

    default_snapshot_item = service.snapshot()["items"][0]
    assert default_snapshot_item.get("age") is None
    assert default_snapshot_item["personal_phones"] == []
    assert default_snapshot_item["personal_emails"] == []

    # Hidden values must not be reachable through search (no oracle).
    assert service.search("79990001122")["total"] == 0
    assert service.search("ivanov@example.com")["total"] == 0
    assert service.search(str(age))["total"] == 0

    assert (
        service.search(
            "иванов",
            include_age=True,
            include_personal_phones=True,
            include_personal_emails=True,
        )["items"][0]["age"]
        == age
    )
    assert service.search("79990001122", include_personal_phones=True)["total"] == 1
    assert service.search("ivanov@example.com", include_personal_emails=True)["total"] == 1
    assert service.search(str(age), include_age=True)["total"] == 1
    snapshot_item = service.snapshot(include_personal_phones=True, include_personal_emails=True)["items"][0]
    assert snapshot_item["personal_phones"] == [{"value": "79990001122"}]
    assert snapshot_item["personal_emails"] == [{"value": "ivanov@example.com"}]


def test_calculate_age_uses_birthday_and_rejects_invalid_dates():
    today = date(2026, 8, 5)

    assert calculate_age("1990-08-05", today=today) == 36
    assert calculate_age("1990-08-06", today=today) == 35
    assert calculate_age("not-a-date", today=today) is None
    assert calculate_age("2027-01-01", today=today) is None


def test_parse_age_token_supports_exact_and_range():
    assert parse_age_token("35") == (35, 35)
    assert parse_age_token("30-40") == (30, 40)
    assert parse_age_token("40–30") == (30, 40)
    assert parse_age_token("30 - 40") == (30, 40)
    assert parse_age_token("121") is None
    assert parse_age_token("2026") is None
    assert parse_age_token("ivanov") is None
    assert parse_age_token("") is None


def test_search_matches_by_age_exact_and_range():
    def make_item(code: str, name: str) -> dict:
        return {
            "full_name": name,
            "employee_code": code,
            "work_phones": [],
            "personal_phones": [],
            "work_emails": [],
            "personal_emails": [],
        }

    age_one = calculate_age("1990-08-05")
    age_two = calculate_age("1980-08-05")
    assert age_one is not None and age_two is not None and age_one < age_two

    manager = MemoryDataManager(
        {
            "items": [make_item("E1", "Иванов Иван"), make_item("E2", "Петров Пётр")],
            "personal_by_code": {
                "E1": {"date_of_birth": "1990-08-05"},
                "E2": {"date_of_birth": "1980-08-05"},
            },
        }
    )
    service = AddressBookService(data_manager=manager)

    exact = service.search(str(age_one), include_age=True)["items"]
    assert [item["employee_code"] for item in exact] == ["E1"]

    ranged = service.search(f"{age_one}-{age_two}", include_age=True)["items"]
    assert {item["employee_code"] for item in ranged} == {"E1", "E2"}

    narrow = service.search(f"{age_one + 1}-{age_two - 1}", include_age=True)["items"]
    assert narrow == []

    text_hit = service.search("иванов")["items"]
    assert [item["employee_code"] for item in text_hit] == ["E1"]


def test_search_by_age_requires_age_visibility():
    age = calculate_age("1990-08-05")
    assert age is not None

    manager = MemoryDataManager(
        {
            "items": [
                {
                    "full_name": "Иванов Иван",
                    "employee_code": "E1",
                    "work_phones": [],
                    "personal_phones": [],
                    "work_emails": [],
                    "personal_emails": [],
                }
            ],
            "personal_by_code": {"E1": {"date_of_birth": "1990-08-05"}},
        }
    )
    service = AddressBookService(data_manager=manager)

    assert service.search(str(age), include_age=True)["total"] == 1
    assert service.search(str(age), include_age=False)["total"] == 0
    assert service.search(f"{age}-{age}", include_age=False)["total"] == 0


def test_search_orders_exact_age_above_incidental_text_hits():
    age = calculate_age("1990-08-05")
    assert age is not None
    token = str(age)

    manager = MemoryDataManager(
        {
            "items": [
                {
                    "full_name": "Иванов Иван",
                    "employee_code": "E100",
                    "work_phones": [],
                    "personal_phones": [],
                    "work_emails": [],
                    "personal_emails": [],
                },
                {
                    # Incidental hits only: employee-code prefix + phone digits.
                    "full_name": "Петров Пётр",
                    "employee_code": f"{token}01",
                    "work_phones": [{"value": f"+7 (900) {token}0-12-34"}],
                    "personal_phones": [],
                    "work_emails": [],
                    "personal_emails": [],
                },
            ],
            "personal_by_code": {
                "E100": {"date_of_birth": "1990-08-05"},
                f"{token}01": {"date_of_birth": "1970-01-01"},
            },
        }
    )
    service = AddressBookService(data_manager=manager)

    found = service.search(token, include_age=True)["items"]
    assert [item["employee_code"] for item in found] == ["E100", f"{token}01"]


def test_employee_query_and_loader_include_current_hire_date(monkeypatch):
    assert "Текущие.ДатаПриема КАК HireDate" in employee_query()
    rows = [
        SimpleNamespace(
            FullName="Иванов Иван",
            EmployeeCode="E1",
            HireDate="20210517",
            Department="ИТ",
            DepartmentCode="D1",
            DepartmentLocation="Тюмень",
            Position="Инженер",
        )
    ]
    monkeypatch.setattr(
        "backend.services.address_book_service.execute_query",
        lambda *_args, **_kwargs: FakeSelection(rows),
    )

    service = AddressBookService(data_manager=MemoryDataManager())

    assert service._load_employees(Fake1CConnection())[0]["hire_date"] == "2021-05-17"


def test_employee_loader_reads_middle_name(monkeypatch):
    rows = [
        SimpleNamespace(
            FullName="Иванов Иван",
            EmployeeCode="E1",
            MiddleName="Иванович",
            HireDate="20210517",
            Department="ИТ",
            DepartmentCode="D1",
            DepartmentLocation="Тюмень",
            Position="Инженер",
        )
    ]
    monkeypatch.setattr(
        "backend.services.address_book_service.execute_query",
        lambda *_args, **_kwargs: FakeSelection(rows),
    )

    service = AddressBookService(data_manager=MemoryDataManager())

    assert service._load_employees(Fake1CConnection())[0]["middle_name"] == "Иванович"


def test_load_personal_data_keeps_inn(monkeypatch):
    def fake_execute(_connection, text, **_kwargs):
        if "ДатаРождения" in text:
            return FakeSelection(
                [
                    SimpleNamespace(
                        EmployeeCode="E1",
                        Inn="770123456789",
                        DateOfBirth="1990-01-01",
                        BirthPlace="",
                        AddressKind="",
                        RegistrationAddress="",
                    )
                ]
            )
        return FakeSelection([])

    monkeypatch.setattr(
        "backend.services.address_book_service.execute_query",
        fake_execute,
    )
    service = AddressBookService(data_manager=MemoryDataManager())

    personal = service._load_personal_data(Fake1CConnection())

    assert personal["E1"] == {"inn": "770123456789", "date_of_birth": "1990-01-01"}


def test_inn_is_exposed_only_with_explicit_permission():
    manager = MemoryDataManager(
        {
            "items": [{"full_name": "Иванов Иван", "employee_code": "E1"}],
            "personal_by_code": {
                "E1": {"inn": "770123456789", "date_of_birth": "1990-01-01"},
            },
        }
    )
    service = AddressBookService(data_manager=manager)

    assert service.search("иванов")["items"][0].get("inn") is None
    assert service.snapshot()["items"][0].get("inn") is None
    assert service.search("иванов", include_inn=True)["items"][0]["inn"] == "770123456789"
    assert service.snapshot(include_inn=True)["items"][0]["inn"] == "770123456789"


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
    assert service.search("9199568055", include_personal_phones=True)["items"][0]["full_name"] == "Петров Петр Петрович"
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


def test_search_paginates_the_complete_sorted_directory():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {"full_name": "Charlie", "work_phones": [], "personal_phones": []},
                    {"full_name": "Alpha", "work_phones": [], "personal_phones": []},
                    {"full_name": "Bravo", "work_phones": [], "personal_phones": []},
                ]
            }
        )
    )

    first_page = service.search("", limit=2, offset=0)
    second_page = service.search("", limit=2, offset=2)

    assert [item["full_name"] for item in first_page["items"]] == ["Alpha", "Bravo"]
    assert first_page["offset"] == 0
    assert first_page["has_more"] is True
    assert [item["full_name"] for item in second_page["items"]] == ["Charlie"]
    assert second_page["offset"] == 2
    assert second_page["has_more"] is False


def test_snapshot_loads_cache_once_and_uses_employee_code_as_stable_tiebreaker():
    class CountingMemoryDataManager(MemoryDataManager):
        def __init__(self, payload):
            super().__init__(payload)
            self.load_count = 0

        def load_json(self, filename, default_content=None):
            self.load_count += 1
            return super().load_json(filename, default_content)

    manager = CountingMemoryDataManager(
        {
            "updated_at": "2026-09-02T10:00:00Z",
            "items": [
                {"full_name": "Same User", "employee_code": "E2"},
                {"full_name": "Alpha User", "employee_code": "E9"},
                {"full_name": "Same User", "employee_code": "E1"},
            ],
        }
    )
    service = AddressBookService(data_manager=manager)

    result = service.snapshot()

    assert manager.load_count == 1
    assert [(item["full_name"], item["employee_code"]) for item in result["items"]] == [
        ("Alpha User", "E9"),
        ("Same User", "E1"),
        ("Same User", "E2"),
    ]
    assert result["total"] == 3
    assert result["offset"] == 0
    assert result["has_more"] is False
    assert result["updated_at"] == "2026-09-02T10:00:00Z"


def test_snapshot_returns_all_5000_directory_entries_without_pagination():
    items = [
        {"full_name": f"Employee {index:04d}", "employee_code": f"E{index}"}
        for index in range(5_000)
    ]
    service = AddressBookService(data_manager=MemoryDataManager({"items": items}))

    result = service.snapshot()

    assert result["total"] == 5_000
    assert len(result["items"]) == 5_000
    assert result["items"][-1]["employee_code"] == "E4999"
    assert result["has_more"] is False


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
                    "dismissal_date": "",
                }
            ]

        def _load_dismissed_employees(self, connection):
            calls.append("dismissed")
            return [
                {
                    "full_name": "Petrov Former",
                    "_employee_code": "E2",
                    "department": "",
                    "department_location": "Москва",
                    "position": "",
                    "dismissal_date": "2026-08-31",
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

    items, dismissed_items, personal = TestService(data_manager=MemoryDataManager())._load_items_from_1c()

    assert calls == ["init", "connect", "employees", "dismissed", "phones", "emails", "personal", "uninit"]
    assert items[0]["employee_code"] == "E1"
    assert items[0]["work_emails"][0]["value"] == "ivanov@zsgp.ru"
    assert items[0]["work_phones"][0]["value"] == "83452384202"
    assert dismissed_items == [
        {
            "full_name": "Petrov Former",
            "employee_code": "E2",
            "department": "",
            "department_location": "Москва",
            "position": "",
            "dismissal_date": "2026-08-31",
            "work_phones": [],
            "personal_phones": [],
            "work_emails": [],
            "personal_emails": [],
        }
    ]
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


def test_dismissed_full_query_has_no_surname_filter():
    query = dismissed_employee_full_query()

    assert "Текущие.ДатаУвольнения <> ДАТАВРЕМЯ(1, 1, 1)" in query
    assert "Фамилия" not in query
    # 1C forbids ORDER BY over ПРЕДСТАВЛЕНИЕ(..); sorting is done in Python.
    assert "УПОРЯДОЧИТЬ" not in query


def test_search_dismissed_reads_dismissed_items_bucket():
    manager = MemoryDataManager(
        {
            "updated_at": "2026-09-01T10:00:00+00:00",
            "dismissed_updated_at": "2026-09-02T10:00:00+00:00",
            "items": [{"full_name": "Работающий", "employee_code": "E1"}],
            "dismissed_items": [
                {
                    "full_name": "Уволенный Сотрудник",
                    "employee_code": "E2",
                    "dismissal_date": "2026-08-31",
                }
            ],
        }
    )
    service = AddressBookService(data_manager=manager)

    active = service.search("", dismissed=False)
    dismissed = service.search("", dismissed=True)

    assert [item["full_name"] for item in active["items"]] == ["Работающий"]
    assert active.get("dismissed") is False
    assert [item["full_name"] for item in dismissed["items"]] == ["Уволенный Сотрудник"]
    assert dismissed.get("dismissed") is True
    assert dismissed["items"][0]["dismissal_date"] == "2026-08-31"
    assert dismissed["updated_at"] == "2026-09-02T10:00:00+00:00"
    assert service.search("уволенный", dismissed=False)["total"] == 0
    assert service.search("уволенный", dismissed=True)["total"] == 1


def test_status_reports_dismissed_updated_at():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "updated_at": "2026-09-01T10:00:00+00:00",
                "dismissed_updated_at": "2026-09-02T10:00:00+00:00",
                "items": [{"full_name": "A"}],
                "dismissed_items": [{"full_name": "B"}],
            }
        )
    )

    status = service.get_status()

    assert status["count"] == 1
    assert status["dismissed_count"] == 1
    assert status["dismissed_updated_at"] == "2026-09-02T10:00:00+00:00"


def test_contact_queries_cover_dismissed_employees():
    for query in (phones_query(), emails_query()):
        assert "Текущие.ДатаУвольнения = ДАТАВРЕМЯ(1, 1, 1)" not in query
        assert "Текущие.ДатаПриема <> ДАТАВРЕМЯ(1, 1, 1)" in query


def test_dismissed_items_receive_contacts_from_shared_maps(monkeypatch):
    service = AddressBookService(data_manager=MemoryDataManager())
    connection = Fake1CConnection()

    monkeypatch.setattr(
        AddressBookService, "_connect_1c", lambda self: connection
    )
    monkeypatch.setattr(
        AddressBookService,
        "_load_employees",
        lambda self, conn: [
            {
                "full_name": "Работающий",
                "_employee_code": "E1",
                "department": "",
                "department_location": "",
                "position": "",
                "dismissal_date": "",
            }
        ],
    )
    monkeypatch.setattr(
        AddressBookService,
        "_load_dismissed_employees",
        lambda self, conn: [
            {
                "full_name": "Уволенный",
                "_employee_code": "E2",
                "department": "",
                "department_location": "",
                "position": "",
                "dismissal_date": "2026-08-31",
            }
        ],
    )
    monkeypatch.setattr(
        AddressBookService,
        "_load_phones",
        lambda self, conn: {
            "E2": {
                "work": [{"kind": "Рабочий телефон", "value": "83450000000", "normalized": "73450000000"}],
                "personal": [],
            }
        },
    )
    monkeypatch.setattr(
        AddressBookService,
        "_load_emails",
        lambda self, conn: {
            "E2": {
                "work": [],
                "personal": [{"kind": "Email", "value": "former@example.com", "normalized": "former@example.com"}],
            }
        },
    )
    monkeypatch.setattr(
        AddressBookService, "_load_personal_data", lambda self, conn: {}
    )
    monkeypatch.setattr(
        AddressBookService, "_load_employee_absences", lambda self, conn: {}
    )
    monkeypatch.setitem(sys.modules, "pythoncom", SimpleNamespace(
        CoInitialize=lambda: None,
        CoUninitialize=lambda: None,
    ))

    _, dismissed_items, _ = service._load_items_from_1c()

    assert dismissed_items[0]["work_phones"] == [
        {"kind": "Рабочий телефон", "value": "83450000000", "normalized": "73450000000"}
    ]
    assert dismissed_items[0]["personal_emails"] == [
        {"kind": "Email", "value": "former@example.com", "normalized": "former@example.com"}
    ]


class VersionedMemoryDataManager(MemoryDataManager):
    """In-memory store with an explicit document version (probe supported)."""

    def __init__(self, payload=None, version="v1"):
        super().__init__(payload)
        self.version = version
        self.load_count = 0
        self.probe_count = 0

    def get_document_version(self, filename):
        self.probe_count += 1
        return self.version if self.payload else None

    def load_json(self, filename, default_content=None):
        self.load_count += 1
        return super().load_json(filename, default_content)

    def save_json(self, filename, data):
        result = super().save_json(filename, data)
        self.version = f"v{self.load_count + self.probe_count + 1}:{len(str(data))}"
        return result


def test_load_cache_reuses_parsed_document_when_version_unchanged():
    manager = VersionedMemoryDataManager({"items": [{"full_name": "А", "employee_code": "E1"}]})
    service = AddressBookService(data_manager=manager)

    first = service.load_cache()
    second = service.load_cache()
    service.get_status()
    service.search("")

    assert manager.load_count == 1
    # Each call returns a defensive copy of the same parsed document.
    assert first == second
    assert first is not second
    assert first["items"] is second["items"]


def test_load_cache_invalidates_after_document_version_change():
    manager = VersionedMemoryDataManager({"items": [{"full_name": "Старая", "employee_code": "E1"}]})
    service = AddressBookService(data_manager=manager)

    assert service.load_cache()["items"][0]["full_name"] == "Старая"
    manager.payload = {"items": [{"full_name": "Новая", "employee_code": "E2"}]}
    manager.version = "v2"

    refreshed = service.load_cache()

    assert manager.load_count == 2
    assert refreshed["items"][0]["full_name"] == "Новая"


def test_load_cache_falls_back_to_ttl_when_probe_missing(monkeypatch):
    manager = MemoryDataManager({"items": [{"full_name": "А"}]})
    load_calls = []
    original_load = manager.load_json

    def counting_load(filename, default_content=None):
        load_calls.append(filename)
        return original_load(filename, default_content)

    manager.load_json = counting_load
    service = AddressBookService(data_manager=manager)

    service.load_cache()
    service.load_cache()
    assert len(load_calls) == 1

    # Within the TTL window the parsed copy is reused even if payload changed.
    manager.payload = {"items": [{"full_name": "Б"}]}
    assert service.load_cache()["items"][0]["full_name"] == "А"

    # After TTL expiry the document is re-read.
    monkeypatch.setattr(
        "backend.services.address_book_service.PARSED_CACHE_TTL_SECONDS", -1
    )
    assert service.load_cache()["items"][0]["full_name"] == "Б"
    assert len(load_calls) == 2


def test_save_cache_invalidates_parsed_document():
    manager = VersionedMemoryDataManager({"items": [{"full_name": "До"}]})
    service = AddressBookService(data_manager=manager)

    assert service.load_cache()["items"][0]["full_name"] == "До"
    service.save_cache({"items": [{"full_name": "После"}], "dismissed_items": [], "personal_by_code": {}})

    assert service.load_cache()["items"][0]["full_name"] == "После"
    assert manager.load_count == 2


def test_load_cache_concurrent_readers_do_not_duplicate_parsing():
    import concurrent.futures

    manager = VersionedMemoryDataManager({"items": [{"full_name": "А", "employee_code": "E1"}]})
    service = AddressBookService(data_manager=manager)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _i: service.search(""), range(32)))

    assert manager.load_count == 1
    assert all(result["total"] == 1 for result in results)


def test_load_cache_probe_failure_uses_ttl_and_stays_safe():
    class FailingProbeManager(VersionedMemoryDataManager):
        def get_document_version(self, filename):
            raise RuntimeError("db down")

    manager = FailingProbeManager({"items": [{"full_name": "А"}]})
    service = AddressBookService(data_manager=manager)

    first = service.load_cache()
    second = service.load_cache()

    assert first["items"][0]["full_name"] == "А"
    assert second["items"][0]["full_name"] == "А"
    assert manager.load_count == 1


def test_app_db_document_version_probe_tracks_writes(tmp_path, prebuilt_app_db):
    import time as time_module

    from backend.json_db.manager import JSONDataManager

    database_url = f"sqlite:///{prebuilt_app_db.as_posix()}"
    manager = JSONDataManager(data_dir=tmp_path, database_url=database_url)

    assert manager.get_document_version("address_book_cache.json") is None

    manager.save_json("address_book_cache.json", {"items": [{"full_name": "А"}]})
    version_one = manager.get_document_version("address_book_cache.json")
    assert version_one

    service = AddressBookService(data_manager=manager)
    assert service.load_cache()["items"][0]["full_name"] == "А"

    # updated_at is clock-based; a pause guarantees the next write crosses a
    # timer tick even on coarse-granularity clocks.
    time_module.sleep(0.05)
    manager.save_json("address_book_cache.json", {"items": [{"full_name": "Б"}]})

    version_two = manager.get_document_version("address_book_cache.json")
    assert version_two != version_one
    assert service.load_cache()["items"][0]["full_name"] == "Б"


def test_local_store_document_version_probe(tmp_path):
    from local_store import SQLiteLocalStore

    store = SQLiteLocalStore(data_dir=tmp_path / "data", db_path=tmp_path / "local.sqlite3")
    assert store.get_document_version("address_book_cache.json") is None

    store.save_json("address_book_cache.json", {"items": [{"full_name": "А"}]})
    version = store.get_document_version("address_book_cache.json")
    assert version

    # Versions are per-file: unrelated writes must not bump the cache marker.
    store.save_json("other_file.json", [{"x": 1}])
    store.save_json("other_file.json", [{"x": 2}])
    assert store.get_document_version("address_book_cache.json") == version
    assert store.get_document_version("other_file.json")


def test_search_filters_by_exact_department():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {"full_name": "Иванов Иван", "employee_code": "E1", "department": "ИТ отдел", "department_location": "Тюмень"},
                    {"full_name": "Петров Петр", "employee_code": "E2", "department": "ИТ отдел филиал", "department_location": "Тюмень"},
                    {"full_name": "Сидорова Анна", "employee_code": "E3", "department": "Бухгалтерия", "department_location": "Москва"},
                ]
            }
        )
    )

    result = service.search("", department="ИТ отдел")

    assert result["total"] == 1
    assert [item["employee_code"] for item in result["items"]] == ["E1"]


def test_search_filters_by_exact_city_and_combined():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {"full_name": "Иванов Иван", "employee_code": "E1", "department": "ИТ отдел", "department_location": "Тюмень"},
                    {"full_name": "Петров Петр", "employee_code": "E2", "department": "ИТ отдел", "department_location": "Москва"},
                    {"full_name": "Сидорова Анна", "employee_code": "E3", "department": "Бухгалтерия", "department_location": "Тюмень"},
                ]
            }
        )
    )

    by_city = service.search("", city="  Тюмень  ")
    assert {item["employee_code"] for item in by_city["items"]} == {"E1", "E3"}

    combined = service.search("", department="ИТ отдел", city="Тюмень")
    assert [item["employee_code"] for item in combined["items"]] == ["E1"]

    combined_query = service.search("иванов", department="ИТ отдел", city="Тюмень")
    assert [item["employee_code"] for item in combined_query["items"]] == ["E1"]


def test_search_filters_apply_before_pagination():
    items = [
        {"full_name": f"Сотрудник {index:03d}", "employee_code": f"E{index}", "department": "ИТ" if index < 5 else "Бухгалтерия"}
        for index in range(30)
    ]
    service = AddressBookService(data_manager=MemoryDataManager({"items": items}))

    first_page = service.search("", limit=3, offset=0, department="ИТ")
    second_page = service.search("", limit=3, offset=3, department="ИТ")

    assert first_page["total"] == 5
    assert first_page["has_more"] is True
    assert len(first_page["items"]) == 3
    assert second_page["has_more"] is False
    assert len(second_page["items"]) == 2


def test_search_employee_codes_exact_match():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {"full_name": "Иванов Иван", "employee_code": "E1"},
                    {"full_name": "Иванова Ольга", "employee_code": "E10"},
                    {"full_name": "Петров Петр", "employee_code": "E2"},
                ]
            }
        )
    )

    result = service.search("", employee_codes=["E1", "e2", "MISSING"])

    assert {item["employee_code"] for item in result["items"]} == {"E1", "E2"}
    assert result["total"] == 2


def test_search_without_filter_params_behaves_as_before():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {"items": [{"full_name": "Иванов Иван", "employee_code": "E1"}]}
        )
    )

    result = service.search("иванов", limit=10)

    assert result["total"] == 1
    assert result["items"][0]["full_name"] == "Иванов Иван"


def test_list_filters_returns_counts_and_no_personal_fields():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "updated_at": "2026-10-01T00:00:00Z",
                "items": [
                    {"full_name": "А", "department": "ИТ отдел", "department_location": "Тюмень", "inn": "123"},
                    {"full_name": "Б", "department": "ИТ отдел", "department_location": "Москва"},
                    {"full_name": "В", "department": "Бухгалтерия", "department_location": "Тюмень"},
                    {"full_name": "Г", "department": "", "department_location": ""},
                ],
                "dismissed_items": [
                    {"full_name": "Уволенный", "department": "Архив", "department_location": "Казань"},
                ],
            }
        )
    )

    active = service.list_filters()
    assert active["departments"] == [
        {"name": "Бухгалтерия", "count": 1},
        {"name": "ИТ отдел", "count": 2},
    ]
    assert active["cities"] == [
        {"name": "Москва", "count": 1},
        {"name": "Тюмень", "count": 2},
    ]
    assert active["updated_at"] == "2026-10-01T00:00:00Z"
    for bucket in (*active["departments"], *active["cities"]):
        assert set(bucket.keys()) == {"name", "count"}

    dismissed = service.list_filters(dismissed=True)
    assert dismissed["departments"] == [{"name": "Архив", "count": 1}]
    assert dismissed["cities"] == [{"name": "Казань", "count": 1}]


# --- R2: defensive copying of nested structures handed out of the service ---


def test_search_result_mutation_does_not_poison_cache():
    """Mutating nested result lists/dicts must not leak into the shared cache."""
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван",
                        "employee_code": "E1",
                        "work_phones": [{"kind": "Рабочий", "value": "+7 900 111-22-33"}],
                        "absence": {"kind": "vacation", "starts_on": "2026-01-01"},
                    }
                ]
            }
        )
    )

    first = service.search("иванов")
    first["items"][0]["work_phones"].append({"kind": "x", "value": "999"})
    first["items"][0]["work_phones"][0]["value"] = "0"
    first["items"][0]["absence"]["kind"] = "sick"

    second = service.search("иванов")
    assert second["items"][0]["work_phones"] == [{"kind": "Рабочий", "value": "+7 900 111-22-33"}]
    assert second["items"][0]["absence"]["kind"] == "vacation"


def test_get_person_by_code_returns_detached_copy():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван",
                        "employee_code": "E1",
                        "work_phones": [{"kind": "Рабочий", "value": "+7 900 111-22-33"}],
                    }
                ]
            }
        )
    )

    person = service.get_person_by_code("E1")
    person["work_phones"].append({"kind": "x", "value": "999"})
    person["work_phones"][0]["value"] = "0"

    again = service.get_person_by_code("E1")
    assert again["work_phones"] == [{"kind": "Рабочий", "value": "+7 900 111-22-33"}]


def test_snapshot_returns_detached_items():
    # R2: snapshot() is bulk-export sized, yet detach stays affordable
    # (~0.6 s p50 over 51k records either way), so the read-only carve-out was
    # dropped — mutating a snapshot row must not poison the parsed cache.
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван",
                        "employee_code": "E1",
                        "work_phones": [{"kind": "Рабочий", "value": "+7 900 111-22-33"}],
                    }
                ]
            }
        )
    )

    snap = service.snapshot()
    cached = service.load_cache()
    assert snap["items"][0]["work_phones"] is not cached["items"][0]["work_phones"]

    snap["items"][0]["work_phones"].append({"kind": "Рабочий", "value": "poison"})
    assert service.snapshot()["items"][0]["work_phones"] == [
        {"kind": "Рабочий", "value": "+7 900 111-22-33"}
    ]
    assert cached["items"][0]["work_phones"] == [
        {"kind": "Рабочий", "value": "+7 900 111-22-33"}
    ]


def test_list_people_by_department_returns_detached_items():
    service = AddressBookService(
        data_manager=MemoryDataManager(
            {
                "items": [
                    {
                        "full_name": "Иванов Иван",
                        "employee_code": "E1",
                        "department": "ИТ отдел",
                        "department_code": "IT",
                        "work_phones": [{"kind": "Рабочий", "value": "100"}],
                    }
                ]
            }
        )
    )

    people = service.list_people_by_department_codes(["IT"])
    people[0]["work_phones"].append({"kind": "x", "value": "999"})

    assert service.search("иванов")["items"][0]["work_phones"] == [
        {"kind": "Рабочий", "value": "100"}
    ]


# --- R3: version-keyed search index ---


def _oracle_search(
    service,
    query="",
    *,
    limit=50,
    offset=0,
    dismissed=False,
    department=None,
    city=None,
    employee_codes=None,
    include_age=False,
    include_hire_date=False,
    include_inn=False,
    include_personal_emails=False,
    include_personal_phones=False,
):
    """Pre-index linear implementation kept verbatim as the R3 oracle."""
    cache = service.load_cache()
    source_key = "dismissed_items" if dismissed else "items"
    items = [item for item in cache.get(source_key) or [] if isinstance(item, dict)]
    personal_by_code = cache.get("personal_by_code")
    if not isinstance(personal_by_code, dict):
        personal_by_code = {}
    tokens = normalize_search_text(query).split()
    limited = max(1, min(int(limit or 50), 200))
    safe_offset = max(0, int(offset or 0))

    code_keys = {
        normalize_search_text(code)
        for code in (employee_codes or [])
        if normalize_text(code)
    }
    if code_keys:
        items = [
            item
            for item in items
            if normalize_search_text(item.get("employee_code")) in code_keys
        ]
    department_key = normalize_search_text(department)
    if department_key:
        items = [
            item
            for item in items
            if normalize_search_text(item.get("department")) == department_key
        ]
    city_key = normalize_search_text(city)
    if city_key:
        items = [
            item
            for item in items
            if normalize_search_text(item.get("department_location")) == city_key
        ]

    if tokens:
        def item_age(item):
            if not include_age:
                return None
            return service._search_age(item, personal_by_code)

        items = [
            item
            for item in items
            if service._matches_query(
                item,
                tokens,
                include_personal_emails=include_personal_emails,
                include_personal_phones=include_personal_phones,
                age=item_age(item),
            )
        ]
        items.sort(
            key=lambda item: (
                -service._query_score(
                    item,
                    tokens,
                    include_personal_emails=include_personal_emails,
                    include_personal_phones=include_personal_phones,
                    age=item_age(item),
                ),
                normalize_search_text(item.get("full_name")),
                normalize_search_text(item.get("employee_code")),
            )
        )
    else:
        items.sort(
            key=lambda item: (
                normalize_search_text(item.get("full_name")),
                normalize_search_text(item.get("employee_code")),
            )
        )

    return {
        "items": [
            service._serialize_public_search_item(
                item,
                personal_by_code,
                include_age=include_age,
                include_hire_date=include_hire_date,
                include_inn=include_inn,
                include_personal_emails=include_personal_emails,
                include_personal_phones=include_personal_phones,
            )
            for item in items[safe_offset : safe_offset + limited]
        ],
        "total": len(items),
        "limit": limited,
        "offset": safe_offset,
        "has_more": safe_offset + limited < len(items),
        "dismissed": bool(dismissed),
        "updated_at": normalize_text(
            cache.get("dismissed_updated_at") if dismissed else cache.get("updated_at")
        ) or normalize_text(cache.get("updated_at")),
        "last_error": normalize_text(cache.get("last_error")),
    }


def _rich_person(index, *, dismissed=False):
    code = f"E{index:04d}"
    return {
        "full_name": f"Сотрудников{'а' if dismissed else ''} Имя{index} Отчество{index}",
        "employee_code": code,
        "department": f"Подразделение {index % 7}",
        "department_code": f"D{index % 9}",
        "department_location": f"Город{index % 5}",
        "position": f"Должность {index % 11}",
        "office_room": f"{100 + index % 50}",
        "workplace_number": f"WP-{index}",
        "workplace_id": f"WID-{index}",
        "office_address": f"Адрес {index % 3}",
        "middle_name": f"Отчество{index}",
        "hire_date": f"20{10 + index % 15:02d}-0{1 + index % 9}-1{index % 9}",
        "work_phones": [{"kind": "Рабочий", "value": f"+7 900 {index % 1000:03d}-00-{index % 100:02d}"}],
        "work_emails": [{"kind": "Рабочая", "value": f"user{index}@zsgp.ru"}],
        "personal_phones": [{"kind": "Личный", "value": f"8 999 {index % 1000:03d}-11-{index % 100:02d}"}],
        "personal_emails": [{"kind": "Личная", "value": f"private{index}@secret.ru"}],
    }


def test_search_index_matches_linear_oracle():
    items = [_rich_person(i) for i in range(120)]
    items[0]["full_name"] = "Иванов Иван Петрович"
    items[1]["full_name"] = "иванова ольга  сергеевна"
    dismissed = [_rich_person(i, dismissed=True) for i in range(80)]
    dismissed[0]["full_name"] = "Иванов Уволенный Петрович"
    payload = {
        "items": items,
        "dismissed_items": dismissed,
        "personal_by_code": {
            "E0000": {"date_of_birth": "1985-04-15", "inn": "720000000001"},
            "E0001": {"date_of_birth": "1990-12-31"},
        },
        "updated_at": "2026-09-30T12:00:00Z",
        "dismissed_updated_at": "2026-09-30T12:30:00Z",
    }
    service = AddressBookService(data_manager=MemoryDataManager(payload))

    flag_grid = [
        {},
        {"include_age": True},
        {"include_personal_phones": True},
        {"include_personal_emails": True},
        {
            "include_age": True,
            "include_hire_date": True,
            "include_inn": True,
            "include_personal_emails": True,
            "include_personal_phones": True,
        },
    ]
    queries = [
        "",
        "иван",
        "e0000",
        "8999",
        "+7 900 000",
        "user1@zsgp.ru",
        "private3@secret.ru",
        "личный",
        "wp-15",
        "город2",
        "30-40",
        "41",
        "сотрудников имя5",
        "несуществующий маркер",
    ]
    extras = [
        {},
        {"department": "Подразделение 1"},
        {"city": "Город2"},
        {"employee_codes": ["E0000", "e0007", "MISSING"]},
        {"limit": 5, "offset": 2},
        {"department": "Подразделение 0", "city": "Город0", "limit": 3},
    ]
    for dismissed_flag in (False, True):
        for query in queries:
            for flags in flag_grid:
                for extra in extras:
                    actual = service.search(query, dismissed=dismissed_flag, **extra, **flags)
                    expected = _oracle_search(service, query, dismissed=dismissed_flag, **extra, **flags)
                    assert actual == expected, (
                        f"divergence: dismissed={dismissed_flag} q={query!r} "
                        f"flags={flags} extra={extra}"
                    )


def test_search_index_built_once_and_reused_for_same_document():
    manager = VersionedMemoryDataManager(
        {"items": [{"full_name": "А", "employee_code": "E1"}]}
    )
    service = AddressBookService(data_manager=manager)

    service.search("а")
    index = service._search_index
    assert index is not None
    assert index["document"] is service._cached_document

    service.search("б")
    service.search("", dismissed=True)
    assert service._search_index is index
    assert manager.load_count == 1


def test_search_index_rebuilt_after_version_change():
    manager = VersionedMemoryDataManager(
        {"items": [{"full_name": "До", "employee_code": "E1"}]}
    )
    service = AddressBookService(data_manager=manager)

    service.search("до")
    old_index = service._search_index
    assert old_index is not None

    service.save_cache({"items": [{"full_name": "После", "employee_code": "E2"}]})
    assert service._search_index is None

    result = service.search("после")
    assert result["total"] == 1
    assert service._search_index is not None
    assert service._search_index is not old_index


def test_search_index_dropped_by_invalidate():
    service = AddressBookService(
        data_manager=MemoryDataManager({"items": [{"full_name": "А", "employee_code": "E1"}]})
    )

    service.search("а")
    assert service._search_index is not None

    service.invalidate_parsed_cache()
    assert service._search_index is None
