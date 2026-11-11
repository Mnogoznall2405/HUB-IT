"""Словарь компании: хранилище (sqlite со схемой voice) и API; выгрузка подтверждённых для пайплайна."""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event

os.environ.setdefault(
    "VOICE_DATABASE_URL", "postgresql+psycopg://test:test@127.0.0.1:5432/test_voice"
)

from voice_server import glossary_store, pipeline, store  # noqa: E402
from voice_server.models import Base  # noqa: E402


@pytest.fixture()
def voice_db(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'main.db'}")
    voice_file = tmp_path / "voice.db"

    @event.listens_for(engine, "connect")
    def _attach(dbapi_conn, _record):
        dbapi_conn.execute(f"ATTACH DATABASE '{voice_file}' AS voice")

    Base.metadata.create_all(engine)
    monkeypatch.setattr(glossary_store, "_engine", lambda: engine)
    monkeypatch.setattr(store, "_engine", lambda: engine)
    yield engine
    engine.dispose()


@pytest.fixture()
def vv_tree(tmp_path, monkeypatch):
    root = tmp_path / "voice_video"
    (root / "output").mkdir(parents=True)
    monkeypatch.setattr(pipeline, "config", SimpleNamespace(voicevideo_root=root, upload_max_bytes=1024, data_dir=tmp_path / "data"))
    return root


@pytest.fixture()
def api(voice_db, vv_tree, monkeypatch):
    from fastapi.testclient import TestClient

    from voice_server import app as app_module, auth

    users = {"admin": {"id": 1, "role": "admin", "username": "boss"},
             "reader": {"id": 2, "role": "user", "username": "r", "permissions": ["voice.read"]}}
    current = {"user": users["admin"]}
    monkeypatch.setattr(auth, "_fetch_web_user", lambda *a, **k: current["user"])
    client = TestClient(app_module.app)
    client.headers["Authorization"] = "Bearer t"
    client.users, client.current = users, current
    return client


def _candidates(*terms):
    return [{"term": t, "kind": "abbr", "expansion": "", "aliases": [], "evidence": "из встречи"} for t in terms]


def test_candidates_are_counted_once_per_meeting_and_rejected_do_not_return(voice_db):
    assert glossary_store.upsert_candidates("m1", _candidates("УМТО", "ТГС")) == {"added": 2, "repeated": 0, "skipped": 0}
    # повторный разбор той же записи счётчик не накручивает; другая запись — повтор
    assert glossary_store.upsert_candidates("m1", _candidates("УМТО"))["skipped"] == 1
    assert glossary_store.upsert_candidates("m2", _candidates("умто", "Ё"))["repeated"] == 1  # регистр не важен, «Ё» слишком короткий — отброшен
    items = {t["term"]: t for t in glossary_store.list_terms()["items"]}
    assert items["УМТО"]["occurrences"] == 2 and items["УМТО"]["first_base"] == "m1" and items["УМТО"]["last_base"] == "m2"
    glossary_store.update_term(items["ТГС"]["id"], {"status": "rejected"})
    assert glossary_store.upsert_candidates("m3", _candidates("ТГС"))["skipped"] == 1
    assert [t["term"] for t in glossary_store.list_terms(status="rejected")["items"]] == ["ТГС"]


def test_duplicates_and_bad_input_are_rejected_and_aliases_are_cleaned(voice_db):
    created = glossary_store.create_term(term="Морстрой", kind="org", aliases=["Мор строй", "морстрой", "Мор строй", ""])
    assert created["aliases"] == ["Мор строй"]            # свой регистр и повторы убраны
    with pytest.raises(ValueError, match="уже есть"):
        glossary_store.create_term(term="  морСТРОЙ ")
    with pytest.raises(ValueError):
        glossary_store.create_term(term="Я")
    with pytest.raises(ValueError):
        glossary_store.create_term(term="Норм", status="выдуманный")
    other = glossary_store.create_term(term="Анкор")
    with pytest.raises(ValueError, match="уже есть"):
        glossary_store.update_term(other["id"], {"term": "Морстрой"})


def test_export_contains_only_confirmed_terms_and_is_replaced_atomically(voice_db, tmp_path):
    glossary_store.create_term(term="ГПР", kind="abbr", expansion="график производства работ", aliases=["ПР"], core=True)
    glossary_store.upsert_candidates("m1", _candidates("ТГС"))
    glossary_store.create_term(term="Выкинутое", status="rejected")
    path = tmp_path / "data" / "company_glossary.json"
    assert glossary_store.export_confirmed(path) == 1
    data = json.loads(path.read_text(encoding="utf-8"))
    assert [t["term"] for t in data["terms"]] == ["ГПР"] and data["terms"][0]["core"] is True
    assert data["terms"][0]["aliases"] == ["ПР"] and data["terms"][0]["status"] == "confirmed"
    assert list(path.parent.glob("*.tmp")) == []


def test_api_permissions_confirm_flow_and_export_for_pipeline(api, vv_tree):
    base = "/api/v1/voice/glossary"
    api.post(base, json={"term": "ТГС", "status": "candidate"})
    created = api.post(base, json={"term": "УМТО", "kind": "abbr", "expansion": "управление МТО", "aliases": ["Унто"]})
    assert created.status_code == 201 and created.json()["status"] == "confirmed"
    export = vv_tree / "data" / "company_glossary.json"
    assert [t["term"] for t in json.loads(export.read_text(encoding="utf-8"))["terms"]] == ["УМТО"]

    listing = api.get(base).json()
    assert listing["counts"] == {"candidate": 1, "confirmed": 1, "rejected": 0}
    assert listing["items"][0]["term"] == "ТГС"          # кандидаты сверху — их и надо разобрать
    candidate = listing["items"][0]
    confirmed = api.put(f"{base}/{candidate['id']}", json={"status": "confirmed", "expansion": "теплогазоснабжение"})
    assert confirmed.status_code == 200 and confirmed.json()["expansion"] == "теплогазоснабжение"
    assert {t["term"] for t in json.loads(export.read_text(encoding="utf-8"))["terms"]} == {"ТГС", "УМТО"}
    assert api.post(base, json={"term": "тгс"}).status_code == 409
    assert api.put(f"{base}/not-an-id", json={"status": "confirmed"}).status_code == 404

    api.current["user"] = api.users["reader"]
    assert api.get(base).status_code == 200                                   # читать можно
    assert api.post(base, json={"term": "Новый"}).status_code == 403          # менять — только manage
    assert api.delete(f"{base}/{candidate['id']}").status_code == 403
    api.current["user"] = api.users["admin"]
    assert api.delete(f"{base}/{candidate['id']}").json() == {"deleted": True}
    assert [t["term"] for t in json.loads(export.read_text(encoding="utf-8"))["terms"]] == ["УМТО"]


def test_ingest_for_meeting_reads_candidates_file_next_to_reports(voice_db, vv_tree):
    from voice_server import glossary

    mdir = vv_tree / "output" / "m_1"
    mdir.mkdir(parents=True)
    (mdir / "m_1_glossary_candidates.json").write_text(
        json.dumps({"base": "m_1", "candidates": _candidates("ОНТУ", "ЖБК")}, ensure_ascii=False), encoding="utf-8")
    assert glossary.ingest_for_meeting("m_1") == {"added": 2, "repeated": 0, "skipped": 0}
    assert glossary.ingest_for_meeting("m_missing") == {"added": 0, "repeated": 0, "skipped": 0}  # нет файла — не ошибка
    assert glossary.ingest_for_meeting("") is None
