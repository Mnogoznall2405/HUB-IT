import importlib
import sys
import time
from pathlib import Path


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
