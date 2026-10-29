from __future__ import annotations

import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.zup_user_profile_service import ZupUserProfileService


class StubAddressBookService:
    def __init__(self, items: list[dict]) -> None:
        self.items = items

    def load_cache(self) -> dict:
        return {
            "updated_at": "2026-08-20T08:00:00+00:00",
            "items": self.items,
        }


def employee(
    *,
    code: str,
    name: str,
    email: str,
    phone: str = "+7 (3452) 12-34-56",
    position: str = "Инженер",
    department: str = "ИТ",
    city: str = "Тюмень",
) -> dict:
    return {
        "employee_code": code,
        "full_name": name,
        "position": position,
        "department": department,
        "department_location": city,
        "work_emails": [{"value": email, "normalized": email.lower()}] if email else [],
        "work_phones": [{"value": phone, "normalized": "73452123456"}] if phone else [],
        "personal_emails": [{"value": "private@example.test"}],
        "personal_phones": [{"value": "+7 (999) 000-00-00"}],
    }


def test_resolves_zup_profile_by_exact_corporate_email_before_name() -> None:
    resolver = ZupUserProfileService(
        StubAddressBookService(
            [
                employee(code="001", name="Иванов Иван Иванович", email="other@zsgp.ru", city="Москва"),
                employee(
                    code="002",
                    name="Иванов Иван Иванович",
                    email="ivanov@zsgp.ru",
                    position="Ведущий инженер",
                    department="Служба эксплуатации",
                    city="Санкт-Петербург",
                ),
            ]
        )
    )

    profile = resolver.resolve_user(
        {
            "username": "ivanov",
            "email": "ivanov@zsgp.ru",
            "full_name": "Иванов Иван Иванович",
        }
    )

    assert profile == {
        "job_title": "Ведущий инженер",
        "department": "Служба эксплуатации",
        "city": "Санкт-Петербург",
        "corporate_email": "ivanov@zsgp.ru",
        "corporate_phone": "+7 (3452) 12-34-56",
        "source": "zup",
        "updated_at": "2026-08-20T08:00:00+00:00",
    }


def test_resolves_zup_profile_by_corporate_email_login() -> None:
    resolver = ZupUserProfileService(
        StubAddressBookService(
            [employee(code="003", name="Петров Пётр Петрович", email="petrov_pp@zsgp.ru")]
        )
    )

    profile = resolver.resolve_user({"username": "petrov_pp", "full_name": "Петров Пётр Петрович"})

    assert profile is not None
    assert profile["city"] == "Тюмень"
    assert profile["corporate_email"] == "petrov_pp@zsgp.ru"
    assert profile["corporate_phone"] == "+7 (3452) 12-34-56"


def test_does_not_expose_personal_contacts_as_corporate() -> None:
    resolver = ZupUserProfileService(
        StubAddressBookService(
            [employee(code="006", name="Смирнов Сергей Сергеевич", email="", phone="")]
        )
    )

    profile = resolver.resolve_user(
        {"username": "smirnov", "full_name": "Смирнов Сергей Сергеевич"}
    )

    assert profile is not None
    assert profile["corporate_email"] is None
    assert profile["corporate_phone"] is None


def test_expired_index_is_served_stale_while_one_rebuild_runs() -> None:
    # A request-path rebuild queued every chat thread behind one slow address-book parse;
    # a boundary test cannot make that parse slow, so the contention is reproduced directly.
    release = threading.Event()
    loads = []

    class SlowAddressBookService(StubAddressBookService):
        def load_cache(self) -> dict:
            loads.append(time.monotonic())
            if len(loads) > 1:
                release.wait(timeout=10)
                return {"updated_at": "2026-08-21T08:00:00+00:00", "items": [
                    employee(code="010", name="Новый Сотрудник Иванович", email="new@zsgp.ru")]}
            return super().load_cache()

    resolver = ZupUserProfileService(
        SlowAddressBookService([employee(code="009", name="Старый Сотрудник Иванович", email="old@zsgp.ru")]),
        cache_ttl_sec=1,
    )
    assert resolver.resolve_user({"email": "old@zsgp.ru"}) is not None

    resolver._cached_index = (0.0, resolver._cached_index[1])  # TTL expired
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(lambda _: resolver.resolve_user({"email": "old@zsgp.ru"}), range(8)))
    elapsed = time.monotonic() - started

    assert all(item is not None for item in results)
    assert elapsed < 2
    assert len(loads) == 2  # first build + exactly one background rebuild

    release.set()
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and resolver.resolve_user({"email": "new@zsgp.ru"}) is None:
        time.sleep(0.05)
    assert resolver.resolve_user({"email": "new@zsgp.ru"}) is not None


def test_does_not_resolve_ambiguous_full_name_without_account_match() -> None:
    resolver = ZupUserProfileService(
        StubAddressBookService(
            [
                employee(code="004", name="Сидоров Алексей Сергеевич", email="sidorov1@zsgp.ru"),
                employee(code="005", name="Сидоров Алексей Сергеевич", email="sidorov2@zsgp.ru"),
            ]
        )
    )

    profile = resolver.resolve_user(
        {"username": "unknown", "full_name": "Сидоров Алексей Сергеевич"}
    )

    assert profile is None
