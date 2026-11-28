"""PostgreSQL proof for ACL-aware hybrid AI KB retrieval.

Runs only against a dedicated disposable PostgreSQL schema. The table is created
through the normal ORM metadata with schema translation; no production/shared
schema is touched.
"""
import json
import os
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

import conftest  # noqa: F401  (import order: sys.path bootstrap)

from backend.ai_chat import retrieval_interface as retrieval_interface_module
from backend.appdb.models import AppAiKbChunk, AppBase
from backend.services.department_service import DEPARTMENT_MANAGER_ROLE, department_service


def _test_database_url() -> str:
    url = str(os.getenv("AI_RUN_TEST_DATABASE_URL") or "").strip()
    return url if url.startswith(("postgresql://", "postgresql+")) else ""


def _test_schema() -> str:
    schema = str(os.getenv("AI_RUN_TEST_SCHEMA") or "a4test").strip()
    return schema if "test" in schema.lower() else ""


pytestmark = pytest.mark.skipif(
    not (_test_database_url() and _test_schema()),
    reason="AI_RUN_TEST_DATABASE_URL/AI_RUN_TEST_SCHEMA not configured for a dedicated test schema",
)

PG_URL = _test_database_url()
PG_SCHEMA = _test_schema()
TABLE = "ai_kb_chunks"


@pytest.fixture(scope="module")
def pg_engine():
    admin = create_engine(PG_URL, pool_pre_ping=True)
    with admin.connect() as conn:
        conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{PG_SCHEMA}"'))
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        conn.commit()
    admin.dispose()
    engine = create_engine(PG_URL, pool_pre_ping=True).execution_options(
        schema_translate_map={"app": PG_SCHEMA, "system": PG_SCHEMA, "chat": PG_SCHEMA}
    )
    AppBase.metadata.create_all(engine, tables=[AppAiKbChunk.__table__])
    with engine.connect() as conn:
        conn.execute(text(
            f'CREATE INDEX IF NOT EXISTS ix_test_ai_kb_chunks_fts_russian ON "{PG_SCHEMA}"."{TABLE}" '
            "USING GIN (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(content, '')))"
        ))
        conn.execute(text(
            f'CREATE INDEX IF NOT EXISTS ix_test_ai_kb_chunks_trgm_lower ON "{PG_SCHEMA}"."{TABLE}" '
            "USING GIN (lower(coalesce(title, '') || ' ' || coalesce(content, '')) gin_trgm_ops)"
        ))
        conn.commit()
    yield engine
    engine.dispose()


def _metadata(**overrides) -> str:
    payload = {
        "article_id": "",
        "category": "network",
        "article_type": "runbook",
        "visibility_scope": "global",
        "owner_user_id": 1,
        "created_by": "admin",
        "department_id": "",
        "summary": "",
        "tags": [],
    }
    payload.update(overrides)
    return json.dumps(payload, ensure_ascii=False)


def _chunk(row_id: str, article_id: str, title: str, content: str, **metadata) -> AppAiKbChunk:
    return AppAiKbChunk(
        id=row_id,
        document_id=f"doc-{article_id}",
        kb_article_id=article_id,
        chunk_index=0,
        title=title,
        content=content,
        metadata_json=_metadata(article_id=article_id, **metadata),
    )


@pytest.fixture
def adapter(pg_engine, monkeypatch):
    with pg_engine.connect() as conn:
        conn.execute(text(f'TRUNCATE "{PG_SCHEMA}"."{TABLE}"'))
        conn.commit()

    @contextmanager
    def session(*_args, **_kwargs):
        db = Session(pg_engine, expire_on_commit=False)
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    monkeypatch.setattr(retrieval_interface_module, "app_session", session)

    class _Fallback:
        def ensure_index_fresh(self, **_kwargs):
            return None

        def retrieve(self, **_kwargs):
            raise AssertionError("python fallback must not be used in the PostgreSQL proof")

        def retrieve_template_candidates(self, **_kwargs):
            return []

        def get_metrics(self):
            return {"backend": "python"}

    return retrieval_interface_module.PostgresFtsAiKbRetrievalAdapter(_Fallback())


def _seed(engine, rows: list[AppAiKbChunk]) -> None:
    with Session(engine) as db:
        db.add_all(rows)
        db.commit()


def test_pg_hybrid_retrieval_handles_morphology_and_typo(adapter, pg_engine):
    _seed(pg_engine, [
        _chunk("r-vpn", "vpn", "Инструкция VPN", "Настройки VPN для удаленной работы. Подключение через корпоративный портал."),
        _chunk("r-wifi", "wifi", "Wi-Fi офис", "Подключение к корпоративной сети wifi в офисе."),
    ])
    user = {"id": 2, "username": "user", "role": "viewer", "permissions": []}

    exact = adapter.retrieve(query="настройки vpn удаленная работа", limit=3, current_user=user)
    assert exact and exact[0]["article_id"] == "vpn"

    typo = adapter.retrieve(query="падключение wifi", limit=3, current_user=user)
    assert typo and typo[0]["article_id"] == "wifi"


def test_pg_template_candidates_use_fts_and_stay_acl_scoped(adapter, pg_engine):
    _seed(pg_engine, [
        _chunk(
            "r-template",
            "template-vpn",
            "Шаблон VPN",
            "Шаблон заявки для vpn доступа",
            article_type="template",
            primary_attachment_id="att-1",
            primary_attachment_name="vpn-template.docx",
            primary_attachment_content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        _chunk(
            "r-private-template",
            "private-template",
            "Секретный шаблон VPN",
            "Приватный шаблон vpn доступа",
            article_type="template",
            visibility_scope="private",
            owner_user_id=99,
            primary_attachment_id="att-2",
        ),
    ])
    user = {"id": 2, "username": "user", "role": "viewer", "permissions": []}

    rows = adapter.retrieve_template_candidates(query="шаблон vpn доступа", limit=5, current_user=user)

    assert [row["article_id"] for row in rows] == ["template-vpn"]
    assert rows[0]["attachment_id"] == "att-1"
    assert rows[0]["attachment_name"] == "vpn-template.docx"


def test_pg_acl_is_applied_before_limit_and_owner_private_is_visible(adapter, pg_engine):
    _seed(pg_engine, [
        _chunk(
            "r-private",
            "private",
            "Секретный VPN",
            "Приватная инструкция vpn сервер",
            visibility_scope="private",
            owner_user_id=2,
            created_by="owner",
        ),
        _chunk("r-global", "global", "Публичный VPN", "Общая инструкция vpn сервер"),
    ])
    other = {"id": 9, "username": "other", "role": "viewer", "permissions": []}
    owner = {"id": 2, "username": "owner", "role": "viewer", "permissions": []}

    other_rows = adapter.retrieve(query="vpn сервер", limit=1, current_user=other)
    assert [row["article_id"] for row in other_rows] == ["global"]
    anonymous_rows = adapter.retrieve(query="vpn сервер", limit=2, current_user=None)
    assert [row["article_id"] for row in anonymous_rows] == ["global"]
    owner_rows = adapter.retrieve(query="vpn сервер", limit=2, current_user=owner)
    assert {row["article_id"] for row in owner_rows} == {"private", "global"}


def test_pg_department_acl_matches_membership_and_manager_roles(adapter, pg_engine, monkeypatch):
    _seed(pg_engine, [
        _chunk(
            "r-dept",
            "dept",
            "Отдел VPN",
            "Отдельная инструкция vpn сервер",
            visibility_scope="department",
            department_id="dept-1",
        ),
        _chunk(
            "r-managers",
            "managers",
            "Руководители VPN",
            "Управленческая инструкция vpn сервер",
            visibility_scope="department_managers",
            department_id="dept-1",
        ),
    ])

    def _departments(user, *, roles=None):
        role_set = set(roles or [])
        if role_set == {DEPARTMENT_MANAGER_ROLE}:
            return {"dept-1"} if int(user.get("id") or 0) == 7 else set()
        return {"dept-1"} if int(user.get("id") or 0) in {6, 7} else set()

    monkeypatch.setattr(department_service, "get_user_department_ids", _departments)
    member = {"id": 6, "username": "member", "role": "viewer", "permissions": []}
    manager = {"id": 7, "username": "manager", "role": "viewer", "permissions": []}
    outsider = {"id": 8, "username": "outsider", "role": "viewer", "permissions": []}

    assert [row["article_id"] for row in adapter.retrieve(query="vpn сервер", limit=5, current_user=member)] == ["dept"]
    assert {row["article_id"] for row in adapter.retrieve(query="vpn сервер", limit=5, current_user=manager)} == {"dept", "managers"}
    assert adapter.retrieve(query="vpn сервер", limit=5, current_user=outsider) == []
