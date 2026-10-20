"""Руководители и начальники объектов из структуры компании HUB-IT -> словарь компании (``data/staff_glossary.json``).

    python staff_glossary.py [--out data/staff_glossary.json] [--dry-run]

Читает (только SELECT) из схемы ``app`` базы приложения (APP_DATABASE_URL из окружения / корневого .env):
  * data/staff_manual.txt — ручной список («ФИО | должность | подразделение/объект»), добавляется поверх;
  * org_structure_nodes — узлы оргструктуры с назначенным человеком (ФИО, должность, подразделение);
  * construction_objects + construction_object_role_assignments / construction_direction_role_assignments —
    объекты строительства и их руководители (руководитель проекта, начальник ПТО, ГИП, начальник участка).
В файл пишутся только ФИО, должность, роль и название объекта (без телефонов, почты, табельных номеров).

Запись «человек» не подменяет текст (aliases пусто): варианты имени («Водопьянов Ю.Л.», «Юрий Леонидович») лежат в ``match`` —
они нужны, чтобы нужный человек попал в промпт, когда его упомянули. Загрузчик глоссария подхватывает файл сам.
Чистая логика покрыта tests/test_voice_staff_glossary.py.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "data" / "staff_glossary.json"

ROLE_LABELS = {
    "project_lead": "руководитель проекта",
    "pto_manager": "начальник ПТО",
    "umto_coordinator": "координатор УМТО",
    "chief_project_engineer": "главный инженер проекта (ГИП)",
    "site_manager": "начальник участка",
}


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def name_variants(full_name: str) -> List[str]:
    """Как человека называют на совещании: «Фамилия И.О.», «И.О. Фамилия», «Имя Отчество», «Фамилия Имя», «Фамилия»."""
    words = [w for w in _clean(full_name).split(" ") if w]
    if len(words) < 2:
        return []
    surname, first = words[0], words[1]
    patronymic = words[2] if len(words) > 2 else ""
    initials = f"{first[0]}.{patronymic[0]}." if patronymic else f"{first[0]}."
    out = [f"{surname} {initials}", f"{initials} {surname}", f"{surname} {first}"]
    if patronymic:
        out.append(f"{first} {patronymic}")
    if len(surname) >= 5:  # короткая фамилия слишком часто совпадает с обычным словом
        out.append(surname)
    seen, result = set(), []
    for item in out:
        key = item.lower().replace("ё", "е")
        if key not in seen and key != _clean(full_name).lower().replace("ё", "е"):
            seen.add(key)
            result.append(item)
    return result


def _person_term(name: str, position: str, where: str, extra: str = "", leader: bool = True) -> Optional[Dict[str, Any]]:
    name = _clean(name)
    if len(name.split(" ")) < 2:
        return None
    parts: List[str] = []
    for part in (_clean(position), _clean(where), _clean(extra)):
        if part and part.lower() not in {p.lower() for p in parts}:   # должность и название узла часто совпадают
            parts.append(part)
    return {"term": name, "kind": "person", "status": "confirmed", "core": False, "aliases": [],
            "match": name_variants(name) if leader else [v for v in name_variants(name) if "." in v or len(v.split()) == 2 and v.split()[0] == name.split()[0]], "expansion": ", ".join(parts)[:200], "source": "staff"}


LEADER_POSITION = re.compile(r"директор|заместитель|главный инженер|гип|начальник|руководитель|управляющий", re.IGNORECASE)
NOT_LEADER = re.compile(r"помощник|секретар|референт", re.IGNORECASE)


def _is_dismissed(value: Any) -> bool:
    """1С отдаёт пустую дату как 0001-01-01 / 0100-01-01: это «не уволен»."""
    match = re.match(r"(\d{4})", _clean(value))
    return bool(match) and int(match.group(1)) >= 1900


def leader_rows(address_items: Iterable[Dict[str, Any]], everyone: bool = False) -> List[Dict[str, Any]]:
    """Из адресной книги — руководители по должности (everyone=True — все действующие сотрудники);
    остальные поля сотрудника (контакты, ДР и т.п.) отбрасываются."""
    out = []
    for item in address_items:
        position = _clean(item.get("position"))
        is_leader = bool(position and LEADER_POSITION.search(position) and not NOT_LEADER.search(position))
        if (is_leader or everyone) and not _is_dismissed(item.get("dismissal_date")):
            out.append({"full_name": _clean(item.get("full_name")), "position": position, "department": _clean(item.get("department")),
                        "location": _clean(item.get("department_location")), "leader": is_leader})
    return out


def _rank(expansion: str) -> int:
    text = expansion.lower()
    if re.search(r"заместитель генерального|заместитель директора", text):
        return 3
    if re.search(r"генеральный директор", text):
        return 4
    if re.search(r"директор|главный инженер|начальник|руководитель", text):
        return 2
    return 1


def resolve_ambiguous_matches(people: Dict[str, Dict[str, Any]]) -> None:
    """Один вариант имени у нескольких людей («Миронов», «Сергей Иванович») получает самый старший по должности,
    если он единственный на своём уровне; иначе вариант убирается у всех (не гадаем)."""
    owners: Dict[str, List[str]] = defaultdict(list)
    for key, term in people.items():
        for variant in term["match"]:
            owners[variant.lower().replace("ё", "е")].append(key)
    for variant, keys in owners.items():
        if len(keys) < 2:
            continue
        if len(keys) <= 3 and " " not in variant and "." not in variant:
            continue   # однофамильцы («Миронов»): оставляем всем, модель в блоке видит обе должности и выбирает по теме
        ranks = sorted(((_rank(people[k]["expansion"]), k) for k in keys), reverse=True)
        winner = ranks[0][1] if ranks[0][0] > ranks[1][0] else None
        for k in keys:
            if k != winner:
                people[k]["match"] = [m for m in people[k]["match"] if m.lower().replace("ё", "е") != variant]


MANUAL_PATH = HERE / "data" / "staff_manual.txt"


def parse_manual(text: str) -> List[Dict[str, Any]]:
    """Ручной список людей: строки «ФИО | должность | подразделение или объект»; пустые строки и # — пропускаются."""
    rows = []
    for line in str(text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split("|")]
        rows.append({"full_name": parts[0], "position": parts[1] if len(parts) > 1 else "",
                     "department": parts[2] if len(parts) > 2 else "", "location": "", "leader": True})
    return rows


def load_manual(path: Path = MANUAL_PATH) -> List[Dict[str, Any]]:
    try:
        return parse_manual(Path(path).read_text(encoding="utf-8"))
    except OSError:
        return []


def build_terms(org_nodes: Iterable[Dict[str, Any]], objects: Iterable[Dict[str, Any]],
                object_roles: Iterable[Dict[str, Any]], direction_roles: Iterable[Dict[str, Any]] = (),
                address_leaders: Iterable[Dict[str, Any]] = ()) -> List[Dict[str, Any]]:
    """Строки из БД -> термины. Один человек — одна запись; если он занимает несколько ролей, роли склеиваются."""
    people: Dict[str, Dict[str, Any]] = {}

    def add(term: Optional[Dict[str, Any]]) -> None:
        if not term:
            return
        key = term["term"].lower().replace("ё", "е")
        if key in people:
            current = people[key]
            if term["expansion"] and term["expansion"] not in current["expansion"]:
                current["expansion"] = (current["expansion"] + "; " + term["expansion"])[:200]
            current["match"] = list(dict.fromkeys(current["match"] + term["match"]))
        else:
            people[key] = term

    for node in org_nodes:
        add(_person_term(node.get("person_name"), node.get("person_position"), node.get("title")))
    for row in address_leaders:
        where = _clean(row.get("department"))
        if row.get("location") and _clean(row["location"]).lower() not in where.lower():
            where = f"{where} ({_clean(row['location'])})" if where else _clean(row["location"])
        add(_person_term(row.get("full_name"), row.get("position"), where, leader=row.get("leader", True)))
    object_names = {str(o.get("id")): _clean(o.get("name")) for o in objects if _clean(o.get("name"))}
    for row in list(object_roles) + list(direction_roles):
        role = ROLE_LABELS.get(str(row.get("role_key")), _clean(row.get("role_key")))
        where = object_names.get(str(row.get("object_id")), "")
        add(_person_term(row.get("employee_name"), row.get("employee_position"), f"{role} объекта «{where}»" if where else role))
    resolve_ambiguous_matches(people)
    objects_out = []
    seen_objects = set()
    for object_id, name in object_names.items():
        if name.lower() in seen_objects:  # один объект и в паспорте HUB-IT, и в 1С
            continue
        seen_objects.add(name.lower())
        team = [f"{ROLE_LABELS.get(str(r.get('role_key')), r.get('role_key'))}: {_clean(r.get('employee_name'))}"
                for r in list(object_roles) + list(direction_roles) if str(r.get("object_id")) == object_id and _clean(r.get("employee_name"))]
        objects_out.append({"term": name, "kind": "object", "status": "confirmed", "core": False, "aliases": [], "match": [],
                            "expansion": ("объект строительства" + ("; " + "; ".join(team) if team else ""))[:200], "source": "staff"})
    return sorted(people.values(), key=lambda t: t["term"]) + sorted(objects_out, key=lambda t: t["term"])


def _database_url() -> str:
    url = os.getenv("APP_DATABASE_URL", "")
    if not url:
        try:
            from dotenv import load_dotenv  # type: ignore

            load_dotenv(HERE.parent / ".env")
            url = os.getenv("APP_DATABASE_URL", "")
        except ImportError:
            pass
    if not url:
        raise RuntimeError("APP_DATABASE_URL не задан (окружение или корневой .env)")
    return url


def fetch_rows(url: str) -> Dict[str, List[Dict[str, Any]]]:
    """Только SELECT. Берём активные узлы с человеком, активные объекты и действующие (valid_to IS NULL) роли."""
    from sqlalchemy import create_engine, text

    engine = create_engine(url)
    queries = {
        "org_nodes": "SELECT title, person_name, person_position FROM app.org_structure_nodes WHERE is_active AND person_name <> ''",
        "objects": "SELECT id, name FROM app.construction_objects WHERE is_active",
        "object_roles": "SELECT object_id, role_key, employee_name, employee_position FROM app.construction_object_role_assignments "
                        "WHERE valid_to IS NULL",
        "direction_roles": "SELECT NULL AS object_id, role_key, employee_name, employee_position "
                           "FROM app.construction_direction_role_assignments WHERE valid_to IS NULL",
    }
    out: Dict[str, List[Dict[str, Any]]] = {}
    with engine.connect() as connection:
        for key, sql in queries.items():
            try:
                out[key] = [dict(row._mapping) for row in connection.execute(text(sql))]
            except Exception as exc:  # noqa: BLE001 - таблицы может не быть в этой БД: не валим остальное
                connection.rollback()
                print(f"пропущено {key}: {type(exc).__name__}", file=sys.stderr)
                out[key] = []
    return out


def fetch_address_book_leaders(everyone: bool = False) -> List[Dict[str, Any]]:
    """Руководители из адресной книги (кэш 1С/ЗУП в хранилище приложения); контакты и личные данные не запрашиваются."""
    os.chdir(HERE.parent / "WEB-itinvent")  # хранилище JSON приложения ищет данные относительно рабочего каталога бэкенда
    sys.path.insert(0, str(HERE.parent / "WEB-itinvent"))
    sys.path.insert(0, str(HERE.parent))
    from backend.services.address_book_service import address_book_service

    return leader_rows(address_book_service.snapshot()["items"], everyone=everyone)


def project_name(raw: str) -> str:
    """'Проект "Белушья Губа Склад ГСМ"' -> 'Белушья Губа Склад ГСМ'."""
    text = _clean(raw)
    match = re.match(r'^Проект\s*[«"“](.+?)[»"”]?$', text)
    return _clean(match.group(1)) if match else text


def fetch_construction_objects() -> List[Dict[str, Any]]:
    """Проекты со вкладки «Объекты строительства» (живой read-only запрос к 1С тем же сервисом, что и сайт)."""
    import asyncio

    os.chdir(HERE.parent / "WEB-itinvent")
    sys.path.insert(0, str(HERE.parent / "WEB-itinvent"))
    from backend.services.warehouse_1c_service import warehouse_1c_service

    async def collect() -> List[str]:
        names: List[str] = []
        cursor = None
        for _ in range(40):
            page = await warehouse_1c_service.get_construction_objects(kind="project", limit=48, cursor=cursor, refresh=False,
                                                                       managed_objects=[])
            names += [project_name(item.get("name")) for item in page.get("items", []) if item.get("kind") == "project"]
            cursor = page.get("next_cursor")
            if not cursor:
                break
        return names

    unique = list(dict.fromkeys(n for n in asyncio.run(collect()) if n))
    return [{"id": f"1c:{i}", "name": name} for i, name in enumerate(unique)]


def write_atomic(path: Path, terms: Sequence[Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump({"terms": list(terms)}, handle, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Руководители и объекты из структуры компании -> словарь")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--everyone", action="store_true", help="из адресной книги брать всех сотрудников (по умолчанию — только руководители по должности)")
    parser.add_argument("--no-1c", action="store_true", help="не читать объекты строительства из 1С")
    parser.add_argument("--no-address-book", action="store_true", help="не брать руководителей из адресной книги")
    parser.add_argument("--dry-run", action="store_true", help="только показать счётчики")
    args = parser.parse_args(argv)
    rows = fetch_rows(_database_url())
    leaders = fetch_address_book_leaders(everyone=args.everyone) if not args.no_address_book else []
    leaders = leaders + load_manual()   # ручной список имеет приоритет при совпадении (первая запись человека остаётся, роли склеиваются)
    one_c_objects = fetch_construction_objects() if not args.no_1c else []
    terms = build_terms(rows["org_nodes"], list(rows["objects"]) + one_c_objects, rows["object_roles"], rows["direction_roles"], leaders)
    people = sum(1 for t in terms if t["kind"] == "person")
    print(f"людей {people}, объектов {len(terms) - people}")
    if not args.dry_run:
        write_atomic(Path(args.out), terms)
        print(f"записано: {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
