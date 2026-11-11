from __future__ import annotations

import importlib
import sqlite3
import sys
import uuid
from pathlib import Path
from threading import RLock

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

template_store_module = importlib.import_module("backend.services.mail_template_store")
mail_module = importlib.import_module("backend.services.mail_service")


class _Logger:
    def __init__(self) -> None:
        self.warnings: list[str] = []
        self.infos: list[tuple[int, int]] = []

    def warning(self, message: str, *args) -> None:
        self.warnings.append(message % args)

    def info(self, _message: str, migrated: int, deactivated: int) -> None:
        self.infos.append((migrated, deactivated))


def _connect_factory():
    db_uri = f"file:mail-templates-{uuid.uuid4().hex}?mode=memory&cache=shared"
    anchor = sqlite3.connect(db_uri, uri=True)
    anchor.row_factory = sqlite3.Row

    def connect():
        conn = sqlite3.connect(db_uri, uri=True)
        conn.row_factory = sqlite3.Row
        return conn

    anchor.execute(
        """
        CREATE TABLE mail_it_templates (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            category TEXT NOT NULL DEFAULT '',
            subject_template TEXT NOT NULL,
            body_template_md TEXT NOT NULL DEFAULT '',
            required_fields_json TEXT NOT NULL DEFAULT '[]',
            is_active INTEGER NOT NULL DEFAULT 1,
            created_by_user_id INTEGER NULL,
            created_by_username TEXT NULL,
            updated_by_user_id INTEGER NULL,
            updated_by_username TEXT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    anchor.commit()
    connect._anchor = anchor  # type: ignore[attr-defined]
    return connect


def _build_store():
    return template_store_module.MailTemplateStore(
        lock=RLock(),
        connect=_connect_factory(),
        table="mail_it_templates",
        id_generator=lambda: "generated-id",
        now_iso=lambda: "2026-05-03T00:00:00+00:00",
    )


def test_parse_template_fields_json_rejects_invalid_json():
    with pytest.raises(template_store_module.TemplateStoreError, match="Template fields JSON is invalid"):
        template_store_module.parse_template_fields_json("{bad")


def test_template_store_creates_lists_updates_and_soft_deletes_templates():
    store = _build_store()
    actor = {"id": 7, "username": "admin"}

    created = store.create_template(
        payload={
            "code": "ACCESS",
            "title": "Access request",
            "category": "it",
            "subject_template": "Access for {{username}}",
            "body_template_md": "Body",
            "fields": [{"key": "username", "type": "text", "required": True}],
        },
        actor=actor,
    )

    assert created["id"] == "generated-id"
    assert created["code"] == "access"
    assert created["created_by_username"] == "admin"
    assert created["fields"][0]["key"] == "username"
    assert [item["id"] for item in store.list_templates()] == ["generated-id"]

    updated = store.update_template(
        template_id="generated-id",
        payload={"title": "Access updated", "is_active": False},
        actor={"id": 8, "username": "operator"},
    )

    assert updated["title"] == "Access updated"
    assert updated["is_active"] == 0
    assert updated["updated_by_username"] == "operator"
    assert store.list_templates(active_only=True) == []
    assert store.delete_template(template_id="generated-id", actor=actor) is True
    assert store.delete_template(template_id="missing", actor=actor) is False


def test_template_store_rejects_duplicate_codes_and_legacy_required_fields():
    store = _build_store()
    payload = {"code": "vpn", "title": "VPN", "subject_template": "VPN", "fields": []}
    store.create_template(payload=payload, actor={})

    with pytest.raises(template_store_module.TemplateStoreError, match="already exists"):
        store.create_template(payload=payload, actor={})

    with pytest.raises(template_store_module.TemplateStoreError, match="required_fields is no longer supported"):
        store.create_template(payload={**payload, "code": "legacy", "required_fields": []}, actor={})


def test_template_store_migrates_legacy_fields_and_deactivates_bad_rows():
    store = _build_store()
    with store.connect() as conn:
        conn.execute(
            """
            INSERT INTO mail_it_templates
            (id, code, title, subject_template, required_fields_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("legacy", "legacy", "Legacy", "Subject", '[{"key":"PC","label":"PC"}]', "old", "old"),
        )
        conn.execute(
            """
            INSERT INTO mail_it_templates
            (id, code, title, subject_template, required_fields_json, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            ("bad", "bad", "Bad", "Subject", '{"not":"array"}', "old", "old"),
        )
    logger = _Logger()

    store.migrate_legacy_template_fields(logger=logger)

    legacy = store.get_template("legacy", active_only=False)
    bad = store.get_template("bad", active_only=False)
    assert legacy is not None
    assert legacy["fields"][0]["key"] == "pc"
    assert legacy["fields"][0]["type"] == "text"
    assert bad is not None
    assert bad["is_active"] == 0
    assert logger.infos == [(1, 1)]


def test_mail_service_template_store_errors_keep_mail_service_boundary():
    service = object.__new__(mail_module.MailService)

    class FailingStore:
        def create_template(self, *, payload, actor):
            raise template_store_module.TemplateStoreError("store failed")

    service._template_store = FailingStore()

    with pytest.raises(mail_module.MailServiceError, match="store failed"):
        service.create_template(payload={}, actor={})
