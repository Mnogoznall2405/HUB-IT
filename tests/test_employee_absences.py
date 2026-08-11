from __future__ import annotations

from datetime import date, timedelta

import pytest

from backend.appdb.db import initialize_app_schema
from backend.services.employee_absence_service import EmployeeAbsenceService
from backend.services.hub_service import HubService


@pytest.fixture
def absence_service(tmp_path, monkeypatch):
    database_url = f"sqlite+pysqlite:///{(tmp_path / 'absences.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    initialize_app_schema(database_url, force=True)
    return EmployeeAbsenceService(database_url=database_url)


def test_create_and_list_on_date(absence_service):
    today = date.today()
    created = absence_service.create(
        {
            "display_name": "Иванов И.И.",
            "department": "ИТ",
            "kind": "vacation",
            "starts_on": today.isoformat(),
            "ends_on": (today + timedelta(days=2)).isoformat(),
            "comment": "ежегодный",
        },
        created_by=1,
    )
    assert created["kind_label"] == "Отпуск"
    listed = absence_service.list_on_date(on=today)
    assert listed["count"] == 1
    assert listed["items"][0]["display_name"] == "Иванов И.И."
    outside = absence_service.list_on_date(on=today - timedelta(days=1))
    assert outside["count"] == 0


def test_update_and_delete(absence_service):
    today = date.today()
    created = absence_service.create(
        {
            "display_name": "Петров",
            "kind": "sick",
            "starts_on": today.isoformat(),
            "ends_on": today.isoformat(),
        },
        created_by=2,
    )
    updated = absence_service.update(created["id"], {"kind": "trip", "comment": "выезд"})
    assert updated["kind"] == "trip"
    assert updated["comment"] == "выезд"
    absence_service.delete(created["id"])
    assert absence_service.list_on_date(on=today)["count"] == 0


def test_dashboard_embed_limit(absence_service, monkeypatch):
    today = date.today()
    for index in range(10):
        absence_service.create(
            {
                "display_name": f"Сотрудник {index}",
                "kind": "other",
                "starts_on": today.isoformat(),
                "ends_on": today.isoformat(),
            },
            created_by=1,
        )
    embed = absence_service.dashboard_embed(limit=8)
    assert embed["count"] == 10
    assert len(embed["items"]) == 8

    monkeypatch.setenv("APP_ENV", "development")
    import backend.services.employee_absence_service as absence_module

    monkeypatch.setattr(absence_module, "employee_absence_service", absence_service)
    hub = HubService(database_url=absence_service._database_url)
    payload = hub.get_dashboard(user_id=1, announcements_limit=1, tasks_limit=1)
    assert "absences_today" in payload
    assert payload["summary"]["absences_today"] == 10
    assert len(payload["absences_today"]["items"]) == 8
