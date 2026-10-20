"""voice_video/modules/glossary.py: отбор по релевантности, блок промпта, корректор написаний, кандидаты."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("glossary_under_test", ROOT / "voice_video" / "modules" / "glossary.py")
gl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gl)

TERMS = [
    {"term": "ГПР", "kind": "abbr", "expansion": "график производства работ", "aliases": ["ПР"], "core": True},
    {"term": "УМТО", "kind": "abbr", "expansion": "управление материально-технического обеспечения", "aliases": ["Унто", "ОНТУ"]},
    {"term": "Морстрой", "kind": "org", "expansion": "", "aliases": ["Мор строй", "Морстроя"]},
    {"term": "КС-2", "kind": "doc", "expansion": "акт о приёмке выполненных работ"},
    {"term": "Териберка", "kind": "object", "expansion": "", "aliases": ["Тереберка"]},
    {"term": "ВОР", "kind": "doc", "expansion": "ведомость объёмов работ", "core": True},
]


def test_prompt_gets_only_terms_present_in_this_meeting_plus_a_small_core():
    text = "Подготовили ГПР, Унто просит КС-2, а Мор строй опять задерживает"
    chosen = [t["term"] for t in gl.select_relevant(TERMS, text, max_terms=10)]
    assert chosen == ["ГПР", "УМТО", "Морстрой", "КС-2", "ВОР"]   # найденные по порядку словаря, затем ядро
    assert "Териберка" not in chosen            # в записи не звучит — в промпт не идёт
    assert "ВОР" in chosen                      # ядро: общие для компании термины остаются
    only_core = [t["term"] for t in gl.select_relevant(TERMS, "совсем другой разговор", core_limit=1)]
    assert only_core == ["ГПР"]                 # без совпадений — только ограниченное ядро


def test_matching_is_by_whole_word_and_yo_insensitive():
    terms = [{"term": "ПР", "kind": "abbr", "expansion": "x"}, {"term": "Берхамов", "kind": "person"}]
    assert gl.select_relevant(terms, "про проект и график", core_limit=0) == []      # «пр» внутри слов не считается
    assert [t["term"] for t in gl.select_relevant(terms, "Берхамов сказал, ПР готов")] == ["ПР", "Берхамов"] or \
        {t["term"] for t in gl.select_relevant(terms, "Берхамов сказал, ПР готов")} == {"ПР", "Берхамов"}


def test_prompt_block_is_compact_capped_and_empty_for_empty_glossary():
    assert gl.format_prompt_block([]) == ""
    block = gl.format_prompt_block(TERMS)
    assert "- ГПР — график производства работ" in block
    assert "Верное написание: Морстрой, Териберка" in block      # без расшифровки — только написание
    many = [{"term": f"ТЕРМ{i}", "expansion": "очень длинная расшифровка " * 3} for i in range(200)]
    assert len(gl.format_prompt_block(many, max_chars=800)) <= 900


def test_corrector_replaces_only_confirmed_aliases_whole_words_keeping_case():
    text = "Унто сказал: Мор строй не успевает, ОНТУ ждёт, в Тереберке был ПР. Унтовский не трогаем"
    fixed, n = gl.correct_text(text, TERMS)
    assert fixed == "УМТО сказал: Морстрой не успевает, УМТО ждёт, в Тереберке был ГПР. Унтовский не трогаем" or \
        fixed.startswith("УМТО сказал: Морстрой не успевает, УМТО ждёт")
    assert "Унтовский" in fixed                  # часть другого слова не заменяется
    assert n >= 4
    segments = [{"text": "Мор строй опять"}, {"text": "всё хорошо"}]
    assert gl.correct_segments(segments, TERMS) == 1 and segments[0]["text"] == "Морстрой опять"
    assert gl.correct_segments(segments, []) == 0


def test_hot_terms_prefer_names_found_in_text_and_skip_documents():
    words = gl.hot_terms(TERMS, "Мор строй и Унто", limit=5)
    assert "Морстрой" in words and "УМТО" in words and "КС-2" not in words


def test_candidates_drop_known_terms_unknown_expansions_and_keep_asr_fixes_as_aliases():
    payload = {
        "abbreviations": [
            {"abbr": "ТГС", "expansion": "?", "evidence": "по ТГС передан техотчёт"},
            {"abbr": "ГПР", "expansion": "график", "evidence": ""},          # уже в словаре
            {"abbr": "ЖБК", "expansion": "железобетонные конструкции"},
        ],
        "organizations": ["«Анкор»", {"name": "Таурус"}, "Х"],
        "suspected_asr_errors": [
            {"text": "Венченко", "likely": "Невенченко", "reason": "фамилия участника"},
            {"text": "Газному", "likely": "?", "reason": "непонятно"},
        ],
    }
    result = {c["term"]: c for c in gl.parse_candidates(json.dumps(payload, ensure_ascii=False), TERMS)}
    assert "ГПР" not in result and "Х" not in result
    assert result["ТГС"]["expansion"] == "" and result["ТГС"]["kind"] == "abbr"
    assert result["ЖБК"]["expansion"] == "железобетонные конструкции"
    assert result["Анкор"]["kind"] == "org" and result["Таурус"]["kind"] == "org"
    assert result["Невенченко"]["aliases"] == ["Венченко"]
    assert gl.parse_candidates("не json", TERMS) == []


def test_load_terms_ignores_unconfirmed_and_broken_files(tmp_path):
    path = tmp_path / "g.json"
    path.write_text(json.dumps({"terms": [
        {"term": "ГПР", "status": "confirmed"}, {"term": "Кандидат", "status": "candidate"}, {"term": ""}, "мусор",
    ]}), encoding="utf-8")
    assert [t["term"] for t in gl.load_terms(path)] == ["ГПР"]
    path.write_text("{битый", encoding="utf-8")
    assert gl.load_terms(path) == [] and gl.load_terms(tmp_path / "нет.json") == [] and gl.load_terms(None) == []


def test_objects_block_folds_projects_of_one_site_by_common_words_and_respects_the_size_cap():
    terms = [{"term": name, "kind": "object"} for name in ("Белушья Губа Склад ГСМ", "Белушья Губа Общежитие", "Белушья Губа", "Камчатка", "Магадан ЖК 1 этап", "Магадан Школа")]
    terms.append({"term": "Миронов Андрей", "kind": "person"})            # люди в список объектов не попадают
    block = gl.format_objects_block(terms)
    assert "- Белушья Губа: Склад ГСМ; Общежитие; (основной)" in block
    assert "- Магадан: ЖК 1 этап; Школа" in block and "- Камчатка" in block and "Миронов" not in block
    assert len(gl.format_objects_block(terms, max_chars=140)) <= 140 + 80      # потолок: лишнее отбрасывается, а не раздувает промпт
    assert gl.format_objects_block([{"term": "Миронов", "kind": "person"}]) == ""
