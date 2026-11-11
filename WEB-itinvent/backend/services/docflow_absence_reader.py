"""Fixed read-only 1C query for the Docflow «Отсутствия» list."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from backend.services.docflow_1c_client import (
    Docflow1CComClient,
    Docflow1CError,
    Docflow1CUnavailableError,
    _connection_text,
    _ref_uuid,
)


ABSENCES_QUERY = """
ВЫБРАТЬ ПЕРВЫЕ 1001
    О.Ссылка КАК Ref,
    О.Сотрудник КАК EmployeeRef,
    ПРЕДСТАВЛЕНИЕ(О.Сотрудник) КАК Employee,
    О.ДатаНачала КАК StartsOn,
    О.ДатаОкончания КАК EndsOn,
    ПРЕДСТАВЛЕНИЕ(О.ВидОтсутствия) КАК Reason,
    О.Комментарий КАК Comment,
    О.БудуРазбиратьЗадачи КАК Available,
    Контакты.АдресЭП КАК Email
ИЗ Документ.Отсутствие КАК О
    ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Пользователи.КонтактнаяИнформация КАК Контакты
    ПО Контакты.Ссылка = О.Сотрудник И Контакты.АдресЭП <> ""
ГДЕ НЕ О.ПометкаУдаления
    И О.ДатаНачала <= &DayEnd
    И О.ДатаОкончания >= &DayStart
"""

# Check identity uniqueness across the user catalog, including users who have
# no absence on the selected day. Surname fallback uses this same full catalog.
EMAIL_OWNERS_QUERY = """
ВЫБРАТЬ ПЕРВЫЕ 10001
    Пользователи.Ссылка КАК EmployeeRef,
    ПРЕДСТАВЛЕНИЕ(Пользователи.Ссылка) КАК Employee,
    Контакты.АдресЭП КАК Email
ИЗ Справочник.Пользователи КАК Пользователи
    ЛЕВОЕ СОЕДИНЕНИЕ Справочник.Пользователи.КонтактнаяИнформация КАК Контакты
    ПО Контакты.Ссылка = Пользователи.Ссылка И Контакты.АдресЭП <> ""
"""


def read_absences(client: Docflow1CComClient, *, login: str, password: str, on: str) -> dict[str, Any]:
    day = date.fromisoformat(on)
    try:
        connection = client._connect(login=login, password=password)
        query = connection.NewObject("Query")
        query.Text = ABSENCES_QUERY
        query.SetParameter("DayStart", datetime.combine(day, time.min))
        query.SetParameter("DayEnd", datetime.combine(day, time(23, 59, 59)))
        selection = query.Execute().Select()
        rows = []
        while selection.Next():
            rows.append({
                "ref": _ref_uuid(connection, selection.Ref),
                "employee_ref": _ref_uuid(connection, selection.EmployeeRef),
                "display_name": _connection_text(connection, selection.Employee),
                "starts_on": selection.StartsOn.isoformat()[:10],
                "ends_on": selection.EndsOn.isoformat()[:10],
                "label": _connection_text(connection, selection.Reason),
                "comment": _connection_text(connection, selection.Comment),
                "available": bool(selection.Available),
                "email": _connection_text(connection, selection.Email).strip().casefold(),
            })
        if len(rows) > 1000:
            raise Docflow1CUnavailableError("Список отсутствий превышает безопасный предел чтения")
        query = connection.NewObject("Query")
        query.Text = EMAIL_OWNERS_QUERY
        selection = query.Execute().Select()
        owners: dict[str, set[str]] = {}
        surnames: dict[str, set[str]] = {}
        count = 0
        while selection.Next():
            count += 1
            if count > 10000:
                raise Docflow1CUnavailableError("Каталог пользователей превышает безопасный предел чтения")
            email = _connection_text(connection, selection.Email).strip().casefold()
            ref = _ref_uuid(connection, selection.EmployeeRef)
            if email:
                owners.setdefault(email, set()).add(ref)
            name_parts = _connection_text(connection, selection.Employee).split()
            if len(name_parts) >= 2:
                surname = name_parts[0].casefold().replace("ё", "е")
                surnames.setdefault(surname, set()).add(ref)
        return {
            "rows": rows,
            "email_owners": {email: sorted(refs) for email, refs in owners.items()},
            "surname_owners": {surname: sorted(refs) for surname, refs in surnames.items()},
        }
    except Docflow1CError:
        raise
    except Exception:
        # Native COM errors may include connection/query data. Never send them
        # across the process bridge or expose them to an HTTP client.
        raise Docflow1CUnavailableError("Не удалось прочитать отсутствия из Документооборота") from None
