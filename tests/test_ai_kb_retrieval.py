import importlib
import sys
import time
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def test_ai_kb_retrieval_skips_rebuild_inside_ttl(monkeypatch):
    retrieval_module = importlib.import_module("backend.ai_chat.retrieval")
    retrieval = retrieval_module.AiKbRetrievalService()
    calls = []

    def _sync_index(**kwargs):
        calls.append(kwargs)
        retrieval._last_sync_monotonic = time.monotonic()

    monkeypatch.setattr(retrieval, "sync_index", _sync_index)

    retrieval.ensure_index_fresh(max_age_sec=30)
    retrieval.ensure_index_fresh(max_age_sec=30)

    assert len(calls) == 1


def test_ai_kb_retrieval_interface_delegates_to_python_backend(monkeypatch):
    retrieval_interface_module = importlib.import_module("backend.ai_chat.retrieval_interface")

    class _Backend:
        def __init__(self):
            self.calls = []

        def ensure_index_fresh(self, **kwargs):
            self.calls.append(("ensure", kwargs))

        def retrieve(self, **kwargs):
            self.calls.append(("retrieve", kwargs))
            return [{"article_id": "a1"}]

        def retrieve_template_candidates(self, **kwargs):
            self.calls.append(("templates", kwargs))
            return [{"article_id": "t1"}]

        def get_metrics(self):
            return {"backend": "python", "index_age_sec": 1.5}

    backend = _Backend()
    interface = retrieval_interface_module.AiKbRetrievalInterface(backend)

    interface.ensure_index_fresh(max_age_sec=10)
    assert interface.retrieve(query="vpn") == [{"article_id": "a1"}]
    assert interface.retrieve_template_candidates(query="form") == [{"article_id": "t1"}]
    assert interface.get_metrics()["index_age_sec"] == 1.5
    assert [item[0] for item in backend.calls] == ["ensure", "retrieve", "templates"]


def test_postgres_fts_adapter_uses_postgres_path(monkeypatch):
    retrieval_interface_module = importlib.import_module("backend.ai_chat.retrieval_interface")

    class _Fallback:
        def __init__(self):
            self.retrieve_calls = 0

        def retrieve(self, **kwargs):
            self.retrieve_calls += 1
            return [{"article_id": "fallback"}]

        def retrieve_template_candidates(self, **kwargs):
            return []

        def ensure_index_fresh(self, **kwargs):
            return None

        def get_metrics(self):
            return {"backend": "python"}

    fallback = _Fallback()
    adapter = retrieval_interface_module.PostgresFtsAiKbRetrievalAdapter(fallback)
    monkeypatch.setattr(adapter, "_is_postgres_available", lambda: True)
    monkeypatch.setattr(adapter, "_retrieve_postgres_fts", lambda **kwargs: [{"article_id": "fts"}])

    assert adapter.retrieve(query="vpn") == [{"article_id": "fts"}]
    assert fallback.retrieve_calls == 0


def test_postgres_fts_adapter_falls_back_on_error(monkeypatch):
    retrieval_interface_module = importlib.import_module("backend.ai_chat.retrieval_interface")

    class _Fallback:
        def retrieve(self, **kwargs):
            return [{"article_id": "fallback"}]

        def retrieve_template_candidates(self, **kwargs):
            return []

        def ensure_index_fresh(self, **kwargs):
            return None

        def get_metrics(self):
            return {"backend": "python"}

    adapter = retrieval_interface_module.PostgresFtsAiKbRetrievalAdapter(_Fallback())
    monkeypatch.setattr(adapter, "_is_postgres_available", lambda: True)

    def _raise(**kwargs):
        raise RuntimeError("fts unavailable")

    monkeypatch.setattr(adapter, "_retrieve_postgres_fts", _raise)

    assert adapter.retrieve(query="vpn") == [{"article_id": "fallback"}]


def test_postgres_fts_statement_uses_index_matching_literals():
    from sqlalchemy.dialects import postgresql

    retrieval_interface_module = importlib.import_module("backend.ai_chat.retrieval_interface")

    class _Fallback:
        def retrieve(self, **kwargs):
            return []

        def retrieve_template_candidates(self, **kwargs):
            return []

        def ensure_index_fresh(self, **kwargs):
            return None

        def get_metrics(self):
            return {"backend": "python"}

    adapter = retrieval_interface_module.PostgresFtsAiKbRetrievalAdapter(_Fallback())
    statement = adapter._build_postgres_fts_statement(query="vpn access", allowed_scope=["network"], limit=3)

    compiled = str(statement.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    assert "to_tsvector('simple', concat_ws(' ', app.ai_kb_chunks.title, app.ai_kb_chunks.content))" in compiled
    assert "websearch_to_tsquery('simple', 'vpn access')" in compiled
    assert "CAST(app.ai_kb_chunks.metadata_json AS JSONB) ->> 'category'" in compiled


def test_ai_kb_fts_migration_creates_matching_gin_index():
    migration_path = (
        WEB_ROOT
        / "backend"
        / "alembic"
        / "versions"
        / "20260427_0023_ai_kb_fts_index.py"
    )
    source = migration_path.read_text(encoding="utf-8")

    assert "USING GIN" in source
    assert "to_tsvector('simple', concat_ws(' ', title, content))" in source
    assert 'INDEX_NAME = "ix_app_ai_kb_chunks_fts_simple"' in source
    assert "DROP INDEX IF EXISTS app.{INDEX_NAME}" in source


def test_ai_kb_index_includes_attachment_file_names(monkeypatch, tmp_path):
    """Файл без извлекаемого текста находится по имени: «бланк отпуска» → Бланк_отпуска.pdf."""
    retrieval_module = importlib.import_module("backend.ai_chat.retrieval")
    appdb_db = importlib.import_module("backend.appdb.db")
    app_models = importlib.import_module("backend.appdb.models")
    from sqlalchemy import select

    article_id = f"kb-name-{time.time_ns()}"
    scan = tmp_path / "scan.pdf"
    scan.write_bytes(b"%PDF-scan")
    article = {
        "id": article_id,
        "title": "Кадровые документы",
        "status": "published",
        "updated_at": "2026-10-02T00:00:00Z",
        "content": {},
        "attachments": [{"id": "att-1", "file_name": "Бланк_отпуска.pdf", "size": 9}],
    }
    kb_service = retrieval_module.kb_service
    monkeypatch.setattr(kb_service, "list_articles", lambda **kw: {"items": [article], "total": 1})
    monkeypatch.setattr(kb_service, "resolve_effective_primary_attachment", lambda art: art["attachments"][0])
    monkeypatch.setattr(
        kb_service,
        "get_attachment",
        lambda article_id, attachment_id, current_user=None: {
            "id": attachment_id,
            "file_name": "Бланк_отпуска.pdf",
            "path": str(scan),
        },
    )
    monkeypatch.setattr(retrieval_module, "extract_text_from_path", lambda *a, **k: "")

    retrieval_module.AiKbRetrievalService().sync_index()

    with appdb_db.app_session() as session:
        contents = [
            row.content
            for row in session.scalars(
                select(app_models.AppAiKbChunk).where(app_models.AppAiKbChunk.kb_article_id == article_id)
            ).all()
        ]
    assert any("Бланк_отпуска.pdf" in content for content in contents)


@pytest.fixture
def kb_sync_env(monkeypatch, tmp_path):
    """Isolated app DB on a 1-connection pool; nested sessions time out fast."""
    retrieval_module = importlib.import_module("backend.ai_chat.retrieval")
    app_models = importlib.import_module("backend.appdb.models")
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import QueuePool

    engine = create_engine(
        f"sqlite:///{(tmp_path / 'kb_index.db').as_posix()}",
        poolclass=QueuePool,
        pool_size=1,
        max_overflow=0,
        pool_timeout=0.1,
        connect_args={"check_same_thread": False},
    ).execution_options(schema_translate_map={app_models.APP_SCHEMA: None})
    app_models.AppAiKbDocument.__table__.create(bind=engine)
    app_models.AppAiKbChunk.__table__.create(bind=engine)
    session_factory = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )

    @contextmanager
    def _session(database_url=None):
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(retrieval_module, "app_session", _session)
    monkeypatch.setattr(retrieval_module, "ensure_app_schema_initialized", lambda *a, **k: None)
    yield SimpleNamespace(module=retrieval_module, models=app_models, engine=engine, session_ctx=_session)
    engine.dispose()


def _kb_article(article_id, title="Статья", updated_at="2026-10-02T00:00:00Z", attachments=None):
    return {
        "id": article_id,
        "title": title,
        "summary": f"summary {article_id}",
        "status": "published",
        "updated_at": updated_at,
        "content": {},
        "attachments": attachments or [],
    }


def _stub_kb(monkeypatch, module, list_articles, get_attachment=None, extract=None):
    monkeypatch.setattr(module.kb_service, "list_articles", list_articles)
    monkeypatch.setattr(
        module.kb_service,
        "resolve_effective_primary_attachment",
        lambda article: (list(article.get("attachments") or []) or [None])[0],
    )
    if get_attachment is None:
        get_attachment = lambda article_id, attachment_id, current_user=None: None
    monkeypatch.setattr(module.kb_service, "get_attachment", get_attachment)
    if extract is None:
        extract = lambda *a, **k: ""
    monkeypatch.setattr(module, "extract_text_from_path", extract)


def _paged(rows):
    def _list_articles(**kw):
        offset = int(kw.get("offset") or 0)
        limit = int(kw.get("limit") or 500)
        return {"items": rows[offset:offset + limit], "total": len(rows)}

    return _list_articles


def _doc_ids(kb_sync_env):
    from sqlalchemy import select

    with kb_sync_env.session_ctx() as session:
        return {
            row.kb_article_id
            for row in session.scalars(select(kb_sync_env.models.AppAiKbDocument)).all()
        }


def _chunks_for(kb_sync_env, article_id):
    from sqlalchemy import select

    with kb_sync_env.session_ctx() as session:
        return session.scalars(
            select(kb_sync_env.models.AppAiKbChunk).where(
                kb_sync_env.models.AppAiKbChunk.kb_article_id == article_id
            )
        ).all()


def test_sync_index_does_not_hold_db_session_during_attachment_work(kb_sync_env, monkeypatch):
    """kb_service.get_attachment / the extractor open their own sessions; the
    index session must not be held while they run (pool size 1 would deadlock)."""
    module = kb_sync_env.module
    from sqlalchemy import text

    article = _kb_article("a-1", attachments=[{"id": "att-1", "file_name": "note.txt", "size": 5}])

    def _get_attachment(article_id, attachment_id, current_user=None):
        with kb_sync_env.session_ctx() as session:
            session.execute(text("SELECT 1"))
        return {"id": attachment_id, "file_name": "note.txt", "path": "unused"}

    def _extract(*args, **kwargs):
        with kb_sync_env.session_ctx() as session:
            session.execute(text("SELECT 1"))
        return "extracted body"

    _stub_kb(monkeypatch, module, _paged([article]), get_attachment=_get_attachment, extract=_extract)

    module.AiKbRetrievalService().sync_index()

    assert _chunks_for(kb_sync_env, "a-1")


def test_sync_index_collects_all_pages_and_keeps_501st(kb_sync_env, monkeypatch):
    module = kb_sync_env.module
    articles = [_kb_article(f"a-{i:03d}") for i in range(501)]
    articles[-1]["title"] = "Уникальныйпятисотыйтайтл"
    offsets = []

    def _list_articles(**kw):
        offset = int(kw.get("offset") or 0)
        limit = int(kw.get("limit") or 500)
        offsets.append(offset)
        return {"items": articles[offset:offset + limit], "total": len(articles)}

    _stub_kb(monkeypatch, module, _list_articles)
    service = module.AiKbRetrievalService()
    service.sync_index()

    assert offsets == [0, 500]
    assert len(_doc_ids(kb_sync_env)) == 501
    found = service.retrieve(query="уникальныйпятисотыйтайтл")
    assert [row["article_id"] for row in found] == ["a-500"]


def test_sync_index_removes_docs_absent_from_full_listing(kb_sync_env, monkeypatch):
    module = kb_sync_env.module
    state = {"rows": [_kb_article("keep-1"), _kb_article("drop-1")]}
    _stub_kb(monkeypatch, module, lambda **kw: _paged(state["rows"])(**kw))

    service = module.AiKbRetrievalService()
    service.sync_index()
    assert _doc_ids(kb_sync_env) == {"keep-1", "drop-1"}

    state["rows"] = state["rows"][:1]
    service.sync_index()
    assert _doc_ids(kb_sync_env) == {"keep-1"}
    assert _chunks_for(kb_sync_env, "keep-1")
    assert _chunks_for(kb_sync_env, "drop-1") == []


@pytest.mark.parametrize(
    "mode",
    [
        "changed_total",
        "empty_page",
        "duplicate_ids",
        "missing_total",
        "none_total",
        "negative_total",
        "string_total",
        "overfull_page",
    ],
)
def test_sync_index_aborts_on_unstable_listing(kb_sync_env, monkeypatch, mode):
    module = kb_sync_env.module
    service = module.AiKbRetrievalService()

    base = [_kb_article("base-1")]
    _stub_kb(monkeypatch, module, _paged(base))
    service.sync_index()
    stamp = service._last_sync_monotonic
    assert stamp > 0

    if mode == "changed_total":
        def _list_articles(**kw):
            offset = int(kw.get("offset") or 0)
            if offset == 0:
                return {"items": [_kb_article("x-1")], "total": 2}
            return {"items": [_kb_article("x-2")], "total": 3}
    elif mode == "empty_page":
        def _list_articles(**kw):
            offset = int(kw.get("offset") or 0)
            if offset == 0:
                return {"items": [_kb_article("x-1")], "total": 2}
            return {"items": [], "total": 2}
    elif mode == "duplicate_ids":
        def _list_articles(**kw):
            return {"items": [_kb_article("dup"), _kb_article("dup")], "total": 2}
    elif mode == "missing_total":
        def _list_articles(**kw):
            return {"items": []}
    elif mode == "none_total":
        def _list_articles(**kw):
            return {"items": [], "total": None}
    elif mode == "negative_total":
        def _list_articles(**kw):
            return {"items": [], "total": -5}
    elif mode == "string_total":
        def _list_articles(**kw):
            return {"items": [_kb_article("x-1")], "total": "2"}
    else:
        def _list_articles(**kw):
            return {
                "items": [_kb_article("x-1"), _kb_article("x-2"), _kb_article("x-1")],
                "total": 2,
            }

    monkeypatch.setattr(module.kb_service, "list_articles", _list_articles)
    with pytest.raises(RuntimeError):
        service.sync_index()

    assert _doc_ids(kb_sync_env) == {"base-1"}
    assert _chunks_for(kb_sync_env, "base-1")
    assert service._last_sync_monotonic == stamp


@pytest.mark.parametrize("failure", ["attachment", "extractor"])
def test_sync_index_prep_failure_keeps_prior_index(kb_sync_env, monkeypatch, failure):
    module = kb_sync_env.module
    from sqlalchemy import select

    attachments = [{"id": "att-1", "file_name": "a.txt", "size": 3}]
    rows = [_kb_article("p-1", title="Старое", attachments=attachments)]
    _stub_kb(
        monkeypatch,
        module,
        lambda **kw: _paged(rows)(**kw),
        get_attachment=lambda article_id, attachment_id, current_user=None: {
            "id": attachment_id,
            "file_name": "a.txt",
            "path": "x",
        },
        extract=lambda *a, **k: "body",
    )
    service = module.AiKbRetrievalService()
    service.sync_index()
    stamp = service._last_sync_monotonic

    with kb_sync_env.session_ctx() as session:
        doc = session.scalars(select(kb_sync_env.models.AppAiKbDocument)).one()
        hash_before = doc.content_hash
    chunks_before = [row.content for row in _chunks_for(kb_sync_env, "p-1")]

    rows[0] = _kb_article("p-1", title="Новое", updated_at="2026-10-03T00:00:00Z", attachments=attachments)

    def _boom(*args, **kwargs):
        raise RuntimeError("kb io failed")

    if failure == "attachment":
        monkeypatch.setattr(module.kb_service, "get_attachment", _boom)
    else:
        monkeypatch.setattr(module, "extract_text_from_path", _boom)

    with pytest.raises(RuntimeError, match="kb io failed"):
        service.sync_index()

    with kb_sync_env.session_ctx() as session:
        doc = session.scalars(select(kb_sync_env.models.AppAiKbDocument)).one()
        assert doc.title == "Старое"
        assert doc.content_hash == hash_before
    assert [row.content for row in _chunks_for(kb_sync_env, "p-1")] == chunks_before
    assert service._last_sync_monotonic == stamp


def test_sync_index_skips_extraction_for_unchanged_articles(kb_sync_env, monkeypatch):
    module = kb_sync_env.module
    counters = {"get_attachment": 0, "extract": 0}
    article = _kb_article("same-1", attachments=[{"id": "att-1", "file_name": "a.txt", "size": 3}])

    def _get_attachment(article_id, attachment_id, current_user=None):
        counters["get_attachment"] += 1
        return {"id": attachment_id, "file_name": "a.txt", "path": "x"}

    def _extract(*a, **k):
        counters["extract"] += 1
        return "body"

    _stub_kb(monkeypatch, module, _paged([article]), get_attachment=_get_attachment, extract=_extract)
    service = module.AiKbRetrievalService()
    service.sync_index()
    assert counters == {"get_attachment": 1, "extract": 1}
    chunk_count = len(_chunks_for(kb_sync_env, "same-1"))
    assert chunk_count > 0

    counters["get_attachment"] = counters["extract"] = 0
    service.sync_index()
    assert counters == {"get_attachment": 0, "extract": 0}
    assert _doc_ids(kb_sync_env) == {"same-1"}
    assert len(_chunks_for(kb_sync_env, "same-1")) == chunk_count


def test_sync_index_reindexes_changed_article(kb_sync_env, monkeypatch):
    module = kb_sync_env.module
    rows = [_kb_article("chg-1", title="Первое")]
    _stub_kb(monkeypatch, module, lambda **kw: _paged(rows)(**kw))

    service = module.AiKbRetrievalService()
    service.sync_index()
    from sqlalchemy import select

    with kb_sync_env.session_ctx() as session:
        doc = session.scalars(select(kb_sync_env.models.AppAiKbDocument)).one()
        hash_before = doc.content_hash

    rows[0] = _kb_article("chg-1", title="Второе", updated_at="2026-10-03T00:00:00Z")
    service.sync_index()

    with kb_sync_env.session_ctx() as session:
        doc = session.scalars(select(kb_sync_env.models.AppAiKbDocument)).one()
        assert doc.content_hash != hash_before
        assert doc.title == "Второе"
    chunks = _chunks_for(kb_sync_env, "chg-1")
    assert chunks and any("Второе" in row.content for row in chunks)
    assert service.retrieve(query="второе")
