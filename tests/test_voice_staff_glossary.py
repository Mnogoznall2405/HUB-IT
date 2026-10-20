"""voice_video/staff_glossary.py: варианты имён, склейка ролей одного человека, словарь не подменяет текст именами."""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "voice_video"))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sg = _load("staff_glossary_under_test", ROOT / "voice_video" / "staff_glossary.py")
gl = _load("glossary_for_staff_test", ROOT / "voice_video" / "modules" / "glossary.py")


def test_name_variants_cover_how_people_are_addressed_and_skip_short_surnames():
    variants = sg.name_variants("Водопьянов Юрий Леонидович")
    assert {"Водопьянов Ю.Л.", "Ю.Л. Водопьянов", "Водопьянов Юрий", "Юрий Леонидович", "Водопьянов"} <= set(variants)
    assert "Ли" not in sg.name_variants("Ли Сергей Иванович")           # короткая фамилия — слишком общее слово
    assert sg.name_variants("Мононим") == []


def test_one_person_with_several_roles_is_one_term_and_objects_list_their_team():
    nodes = [{"title": "Дирекция", "person_name": "Величко Андрей Александрович", "person_position": "Директор"}]
    objects = [{"id": "o1", "name": "Белушья губа"}]
    roles = [{"object_id": "o1", "role_key": "project_lead", "employee_name": "Величко Андрей Александрович", "employee_position": "ГИП"},
             {"object_id": "o1", "role_key": "pto_manager", "employee_name": "Миронов Андрей Александрович", "employee_position": ""}]
    terms = sg.build_terms(nodes, objects, roles)
    people = {t["term"]: t for t in terms if t["kind"] == "person"}
    assert set(people) == {"Величко Андрей Александрович", "Миронов Андрей Александрович"}
    assert "Директор" in people["Величко Андрей Александрович"]["expansion"] and "руководитель проекта объекта «Белушья губа»" in people["Величко Андрей Александрович"]["expansion"]
    obj = next(t for t in terms if t["kind"] == "object")
    assert "начальник ПТО: Миронов Андрей Александрович" in obj["expansion"]


def test_staff_file_is_loaded_next_to_the_glossary_and_matches_by_name_variant_without_rewriting_text(tmp_path):
    terms = sg.build_terms([{"title": "Дирекция", "person_name": "Водопьянов Юрий Леонидович", "person_position": "Генеральный директор"}], [], [])
    sg.write_atomic(tmp_path / "staff_glossary.json", terms)
    loaded = gl.load_terms(tmp_path / "company_glossary.json")           # основной выгрузки нет — сотрудники всё равно есть
    assert [t["term"] for t in loaded] == ["Водопьянов Юрий Леонидович"]
    text = "Юрий Леонидович, давайте закроем вопрос"
    assert [t["term"] for t in gl.select_relevant(loaded, text)] == ["Водопьянов Юрий Леонидович"]   # попал в промпт по отчеству
    assert gl.correct_text(text, loaded) == (text, 0)                      # а текст не изменился
    assert json.loads((tmp_path / "staff_glossary.json").read_text(encoding="utf-8"))["terms"][0]["source"] == "staff"


def test_address_book_leaders_are_picked_by_position_and_lose_personal_fields():
    items = [{"full_name": "Бурлаков Антон Сергеевич", "position": "Руководитель проекта", "department": "Камчатка", "department_location": "Москва",
              "work_phones": ["+7"], "personal_phones": ["+7999"], "age": 40},
             {"full_name": "Иванов Пётр Сидорович", "position": "Начальник участка", "department": "Новая земля", "department_location": "Новая земля"},
             {"full_name": "Сидорова Анна Ивановна", "position": "Помощник начальника"},                       # не руководитель
             {"full_name": "Козлов Иван Петрович", "position": "Прораб"},
             {"full_name": "Пустая Дата Иванович", "position": "Директор", "dismissal_date": "0100-01-01"},     # пустая дата 1С — не уволен
             {"full_name": "Уволенный Иван Иванович", "position": "Начальник", "dismissal_date": "2026-01-01"}]
    rows = sg.leader_rows(items)
    assert [r["full_name"] for r in rows] == ["Бурлаков Антон Сергеевич", "Иванов Пётр Сидорович", "Пустая Дата Иванович"]
    assert set(rows[0]) == {"full_name", "position", "department", "location", "leader"}                            # ни телефонов, ни возраста
    terms = sg.build_terms([], [], [], [], rows)
    assert {t["term"]: t["expansion"] for t in terms}["Бурлаков Антон Сергеевич"] == "Руководитель проекта, Камчатка (Москва)"


def test_shared_surname_keeps_all_namesakes_visible_and_ordinary_staff_do_not_flood_the_prompt_with_name_collisions():
    items = [{"full_name": "Миронов Андрей Александрович", "position": "Заместитель генерального директора по проектированию", "department": "Руководство"},
             {"full_name": "Миронов Андрей Валентинович", "position": "Начальник управления", "department": "Сметное управление"},
             {"full_name": "Петров Сергей Иванович", "position": "Инженер", "department": "ПТО"},
             {"full_name": "Сидоров Сергей Иванович", "position": "Инженер", "department": "ПТО"}]
    terms = {t["term"]: t for t in sg.build_terms([], [], [], [], sg.leader_rows(items, everyone=True))}
    assert "Миронов" in terms["Миронов Андрей Александрович"]["match"]            # «Миронов» подбирает обоих однофамильцев:
    assert "Миронов" in terms["Миронов Андрей Валентинович"]["match"]             # модель увидит обе должности и выберет по теме
    assert terms["Миронов Андрей Валентинович"]["match"][:1] == ["Миронов А.В."]    # а у него остаются однозначные формы
    assert "Сергей Иванович" not in terms["Петров Сергей Иванович"]["match"] + terms["Сидоров Сергей Иванович"]["match"]   # у рядовых нет «Имя Отчество»
    assert "Петров" not in terms["Петров Сергей Иванович"]["match"]                # и одной фамилии
    assert len(sg.leader_rows(items)) == 2                                         # без everyone остаются только руководители


def test_project_names_from_1c_lose_the_prefix_and_duplicate_passports_are_merged():
    assert sg.project_name('Проект "Белушья Губа Склад ГСМ"') == "Белушья Губа Склад ГСМ"
    assert sg.project_name('Общехозяйственная деятельность (Велижанский тракт)') == "Общехозяйственная деятельность (Велижанский тракт)"
    terms = sg.build_terms([], [{"id": "p1", "name": "Камчатка"}, {"id": "1c:0", "name": "Белушья Губа Склад ГСМ"}], [], [])
    assert [t["term"] for t in terms if t["kind"] == "object"] == ["Белушья Губа Склад ГСМ", "Камчатка"]


def test_manual_list_adds_people_without_position_and_skips_comments():
    text = chr(10).join(["# комментарий", "", "Руденко Владислав Александрович | | Магадан", "Иванов Пётр Сидорович | Начальник участка | Белушья Губа"])
    rows = sg.parse_manual(text)
    assert [(r["full_name"], r["position"], r["department"]) for r in rows] == [
        ("Руденко Владислав Александрович", "", "Магадан"), ("Иванов Пётр Сидорович", "Начальник участка", "Белушья Губа")]
    terms = {t["term"]: t for t in sg.build_terms([], [], [], [], rows)}
    assert terms["Руденко Владислав Александрович"]["expansion"] == "Магадан"
    assert "Руденко В.А." in terms["Руденко Владислав Александрович"]["match"]
    assert sg.load_manual(Path("нет-такого-файла.txt")) == []
