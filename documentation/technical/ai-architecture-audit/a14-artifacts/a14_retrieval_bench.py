"""Small fixed synthetic implementation benchmark for the A14 retrieval prototype.

Safety contract: requires an explicit local PostgreSQL URL in AI_RUN_TEST_DATABASE_URL
and creates only a unique schema whose name contains ``test``. No production data,
paid provider calls, or shared schemas are used.
"""
from __future__ import annotations

import json
import os
import re
import statistics
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
from urllib.parse import urlparse

import sqlalchemy as sa
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[4]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(WEB))
os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET_KEY", "a14-retrieval-bench-not-production")

from backend.ai_chat import retrieval as retrieval_module
from backend.ai_chat import retrieval_interface as retrieval_interface_module
from backend.appdb.models import AppAiKbChunk, AppBase

REPEATS = 9
FILLER_COUNT = 1000


def _database_url() -> str:
    url = str(os.getenv("AI_RUN_TEST_DATABASE_URL") or "").strip()
    if not url.startswith(("postgresql://", "postgresql+")):
        raise RuntimeError("AI_RUN_TEST_DATABASE_URL must point to the disposable PostgreSQL instance")
    parsed = urlparse(url)
    if parsed.hostname not in {"127.0.0.1", "localhost"}:
        raise RuntimeError("refusing non-local PostgreSQL host")
    return url


def _schema_name() -> str:
    schema = f"a14benchtest{uuid.uuid4().hex[:10]}"
    if "test" not in schema or not re.fullmatch(r"[a-z][a-z0-9_]*", schema):
        raise RuntimeError("unsafe benchmark schema name")
    return schema


def _metadata(article_id: str, **overrides) -> str:
    payload = {
        "article_id": article_id,
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


def _chunk(article_id: str, title: str, content: str, *, index: int = 0, **metadata) -> AppAiKbChunk:
    return AppAiKbChunk(
        id=f"bench-{article_id}-{index}",
        document_id=f"doc-{article_id}",
        kb_article_id=article_id,
        chunk_index=index,
        title=title,
        content=content,
        metadata_json=_metadata(article_id, **metadata),
    )


def _corpus() -> list[AppAiKbChunk]:
    rows = [
        _chunk("vpn", "Инструкция VPN", "Настройки VPN для удаленной работы через корпоративный портал."),
        _chunk("wifi", "Wi-Fi офис", "Подключение к корпоративной сети wifi в офисе."),
        _chunk("inv-hyphen", "Переезд оборудования", "Перенос устройства ИНВ-88123 между кабинетами."),
        _chunk("inv-under", "Списание оборудования", "Осмотр устройства INV_88124 перед списанием."),
        _chunk("inv-long", "Резервное устройство", "Устройство ИНВ-881234 хранится на складе."),
        _chunk("error-access", "Ошибка доступа", "Код 0x80070005 означает отказ в доступе к общей папке."),
        _chunk("forms", "Кадровые документы", "отпуск кадры формы заявлений для сотрудников"),
    ]
    topics = [
        ("Чистка компьютера", "Плановая чистка системного блока и проверка температур компонентов."),
        ("Замена картриджа", "Порядок замены картриджа в принтере и контроль качества печати."),
        ("Почтовый профиль", "Настройка почтового профиля сотрудника после переезда рабочего места."),
        ("Видеоконференция", "Проверка камеры микрофона и динамиков перед совещанием."),
        ("Резервная копия", "Проверка расписания резервного копирования файлового сервера."),
        ("Учетная запись", "Разблокировка учетной записи после нескольких ошибок ввода пароля."),
        ("Сетевой диск", "Настройка сетевого диска отдела и проверка прав доступа."),
        ("Мониторинг", "Реакция на предупреждение мониторинга и эскалация ответственному."),
        ("Рабочее место", "Подготовка рабочего места нового сотрудника в офисе."),
        ("Антивирус", "Проверка состояния антивирусной защиты и обновления баз."),
    ]
    for index in range(FILLER_COUNT):
        title, body = topics[index % len(topics)]
        rows.append(_chunk(
            f"filler-{index:04d}",
            f"{title} {index:04d}",
            f"{body} Внутренняя служебная инструкция номер {index:04d} для корпоративной работы.",
        ))
    return rows


CASES = [
    {"name": "morphology_vpn", "query": "настройки vpn удаленная работа", "expected": "vpn"},
    {"name": "natural_stopwords_wifi", "query": "что делать если не работает корпоративный wifi", "expected": "wifi"},
    {"name": "typo_wifi", "query": "падключение", "expected": "wifi"},
    {"name": "inventory_hyphen", "query": "ИНВ-88123", "expected": "inv-hyphen"},
    {"name": "inventory_numeric", "query": "88123", "expected": "inv-hyphen"},
    {"name": "inventory_underscore", "query": "INV_88124", "expected": "inv-under"},
    {"name": "error_code", "query": "0x80070005", "expected": "error-access"},
    {"name": "tag_word", "query": "отпуск", "expected": "forms"},
    {"name": "negative_control", "query": "zxqwnoitak", "expected": None},
]


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * fraction))))
    return ordered[index]


def _measure(fn, cases: list[dict[str, object]], user: dict[str, object]) -> dict[str, object]:
    case_results = []
    latencies = []
    hits1 = 0
    hits3 = 0
    false_positive_cases = 0
    scored_cases = 0
    for case in cases:
        rows = []
        case_latencies = []
        for _ in range(REPEATS):
            started = time.perf_counter()
            rows = fn(query=str(case["query"]), limit=3, current_user=user)
            case_latencies.append((time.perf_counter() - started) * 1000.0)
        latencies.extend(case_latencies)
        expected = case["expected"]
        ids = [str(item.get("article_id") or "") for item in rows]
        if expected is None:
            if ids:
                false_positive_cases += 1
        else:
            scored_cases += 1
            hits1 += int(bool(ids and ids[0] == expected))
            hits3 += int(expected in ids[:3])
        case_results.append({
            "name": case["name"],
            "query": case["query"],
            "expected": expected,
            "top_ids": ids,
            "p50_ms": round(statistics.median(case_latencies), 3),
        })
    return {
        "hit_at_1": round(hits1 / scored_cases, 4) if scored_cases else None,
        "hit_at_3": round(hits3 / scored_cases, 4) if scored_cases else None,
        "false_positive_cases": false_positive_cases,
        "avg_latency_ms": round(statistics.mean(latencies), 3),
        "p50_latency_ms": round(statistics.median(latencies), 3),
        "p95_latency_ms": round(_percentile(latencies, 0.95), 3),
        "cases": case_results,
    }


def _adapter_query_plan(adapter, session, schema: str, *, query: str, mode: str, user: dict[str, object]) -> dict[str, object]:
    raw_tokens = retrieval_interface_module._fallback_tokens(query)
    tokens = retrieval_interface_module._meaningful_fts_tokens(session, raw_tokens)
    statement = adapter._build_postgres_fts_statement(
        query=query,
        limit=3,
        current_user=user,
        mode=mode,
        tokens=tokens,
        member_department_ids=[],
        manager_department_ids=[],
        exact_identifier_tokens=retrieval_interface_module._exact_identifier_tokens(query),
    )
    compiled = statement.compile(compile_kwargs={"literal_binds": True})
    sql = str(compiled).replace("app.ai_kb_chunks", f'"{schema}".ai_kb_chunks')
    sql = sql.replace("%>", "%%>")
    rows = session.connection().exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS) " + sql).fetchall()
    lines = [str(row[0]) for row in rows]
    text = "\n".join(lines)
    execution = re.search(r"Execution Time: ([0-9.]+) ms", text)
    return {
        "mode": mode,
        "query": query,
        "uses_fts_index": "ix_bench_fts" in text,
        "uses_trgm_index": "ix_bench_trgm" in text,
        "has_seq_scan": "Seq Scan" in text,
        "execution_time_ms": float(execution.group(1)) if execution else None,
        "plan_lines": lines,
    }


def main() -> int:
    url = _database_url()
    schema = _schema_name()
    engine = sa.create_engine(url, pool_pre_ping=True).execution_options(
        schema_translate_map={"app": schema, "system": schema, "chat": schema}
    )
    with engine.begin() as conn:
        conn.execute(sa.text(f'CREATE SCHEMA IF NOT EXISTS "{schema}"'))
        conn.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
    AppBase.metadata.create_all(engine, tables=[AppAiKbChunk.__table__])
    with engine.begin() as conn:
        conn.execute(sa.text(
            f'CREATE INDEX IF NOT EXISTS ix_bench_fts ON "{schema}".ai_kb_chunks '
            "USING GIN (to_tsvector('russian', title || ' ' || content))"
        ))
        conn.execute(sa.text(
            f'CREATE INDEX IF NOT EXISTS ix_bench_trgm ON "{schema}".ai_kb_chunks '
            "USING GIN (lower(title || ' ' || content) gin_trgm_ops)"
        ))
    with Session(engine) as session:
        session.add_all(_corpus())
        session.commit()
    with engine.begin() as conn:
        conn.execute(sa.text(f'ANALYZE "{schema}".ai_kb_chunks'))

    @contextmanager
    def session_ctx(*_args, **_kwargs):
        session = Session(engine, expire_on_commit=False)
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    fallback = retrieval_module.AiKbRetrievalService()
    adapter = retrieval_interface_module.PostgresFtsAiKbRetrievalAdapter(fallback)
    user = {"id": 2, "username": "bench", "role": "viewer", "permissions": []}
    with patch.dict(os.environ, {"AI_KB_PG_HYBRID_FTS_ENABLED": "1"}), \
        patch.object(retrieval_interface_module, "app_session", session_ctx), \
        patch.object(retrieval_module, "app_session", session_ctx), \
        patch.object(retrieval_module, "ensure_app_schema_initialized", lambda *a, **k: None):
        # Warm up connection/prepared paths before measuring.
        adapter.retrieve(query="настройки vpn удаленная работа", limit=3, current_user=user)
        fallback.retrieve(query="настройки vpn удаленная работа", limit=3, current_user=user)
        pg = _measure(adapter.retrieve, CASES, user)
        python = _measure(fallback.retrieve, CASES, user)
        query_plans = []
        with session_ctx() as plan_session:
            for query, mode in (
                ("настройки vpn удаленная работа", "strict"),
                ("что делать если не работает корпоративный wifi", "bounded_or"),
                ("падключение", "trgm"),
                ("ИНВ-88123", "exact_identifiers"),
            ):
                query_plans.append(_adapter_query_plan(adapter, plan_session, schema, query=query, mode=mode, user=user))

    result = {
        "schema": schema,
        "rows": FILLER_COUNT + 7,
        "repeats_per_case": REPEATS,
        "cases": len(CASES),
        "postgres_hybrid": pg,
        "python_fallback": python,
        "query_plans": query_plans,
        "limits": "small fixed synthetic corpus on isolated local PostgreSQL; not production sizing or semantic retrieval proof",
    }
    output = Path(__file__).with_name("a14_retrieval_bench_result.json")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "rows": result["rows"],
        "pg_hit1": pg["hit_at_1"],
        "pg_hit3": pg["hit_at_3"],
        "pg_false_positive_cases": pg["false_positive_cases"],
        "pg_avg_ms": pg["avg_latency_ms"],
        "python_hit1": python["hit_at_1"],
        "python_hit3": python["hit_at_3"],
        "python_false_positive_cases": python["false_positive_cases"],
        "python_avg_ms": python["avg_latency_ms"],
        "query_plan_summary": [
            {
                "mode": item["mode"],
                "uses_fts_index": item["uses_fts_index"],
                "uses_trgm_index": item["uses_trgm_index"],
                "has_seq_scan": item["has_seq_scan"],
                "execution_time_ms": item["execution_time_ms"],
            }
            for item in query_plans
        ],
        "result": str(output),
    }, ensure_ascii=False, indent=2))
    engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
