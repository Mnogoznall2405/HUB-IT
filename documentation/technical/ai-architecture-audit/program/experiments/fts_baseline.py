"""Synthetic PostgreSQL FTS/pg_trgm baseline for A14/OSS-01.

Disposable research harness only: uses no production data and no LLM/provider calls.
It compares the current Python substring scorer with hypothetical PostgreSQL
FTS variants on an equivalent synthetic Russian corpus.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import psycopg

ADMIN = os.environ.get("A14_FTS_TEST_ADMIN_URL", "postgresql://a11test@127.0.0.1:55432/postgres")
DB = os.environ.get("A14_FTS_TEST_DATABASE", "a14ftsbench")
if "bench" not in DB.lower() and "test" not in DB.lower():
    raise RuntimeError("A14_FTS_TEST_DATABASE must contain 'bench' or 'test'")
URL = f"postgresql://a11test@127.0.0.1:55432/{DB}" if DB == "a14ftsbench" else ADMIN.rsplit("/", 1)[0] + f"/{DB}"
OUT = Path(os.environ.get("A14_FTS_BASELINE_OUT") or Path(__file__).with_name("fts_baseline_result.json"))

TOKEN_RE = re.compile(r"[0-9A-Za-zА-Яа-яЁё_]{3,}", flags=re.UNICODE)

TARGETS = [
    ("vpn", "Настройка VPN для удалённой работы", "Пошаговая настройка VPN клиента для удалённой работы сотрудников. Проверьте сертификат, шлюз и доступность сети."),
    ("password", "Сброс пароля учётной записи", "Самостоятельный сброс пароля учётной записи через портал самообслуживания. Если портал недоступен, создайте заявку в службу поддержки."),
    ("cartridge", "Замена картриджа в принтере", "Порядок замены картриджа в принтере и утилизация использованного картриджа через склад."),
    ("scan", "Настройка сканирования на МФУ", "Настройка сканирования на МФУ в сетевую папку и по электронной почте."),
    ("wifi", "Подключение к корпоративному Wi-Fi", "Подключение ноутбука к корпоративной сети Wi-Fi с сертификатом организации."),
    ("vpn809", "Ошибка 809 при подключении VPN", "Ошибка 809 означает недоступность VPN шлюза или блокировку UDP портов."),
    ("inv", "Поиск техники по инвентарному номеру", "Для поиска техники укажите инвентарный номер в формате INV1042 без пробелов."),
    ("backup", "Расписание резервного копирования", "Регулярное резервное копирование файловых серверов выполняется ночью по расписанию."),
    ("dns", "Диагностика DNS в филиале", "Проверьте сетевые настройки, DNS серверы и маршрутизацию в филиале."),
    ("printqueue", "Очередь печати зависла", "Очистка зависшей очереди печати и перезапуск службы печати."),
    ("cert", "Установка корпоративного сертификата", "Установите корневой корпоративный сертификат в хранилище доверенных центров сертификации."),
    ("private_fin", "Внутренний финансовый сервер", "Закрытая инструкция по доступу к внутреннему финансовому серверу."),
]

# Positive cases: id, query, expected article, kind.
CASES = [
    {"id": "exact_vpn", "query": "настройка vpn удаленной работы", "expected": "vpn", "kind": "exact"},
    {"id": "morph_vpn", "query": "настройки vpn удаленная работа", "expected": "vpn", "kind": "morphology"},
    {"id": "morph_cartridge", "query": "замена картриджей", "expected": "cartridge", "kind": "morphology"},
    {"id": "morph_scan", "query": "настройки сканирования мфу", "expected": "scan", "kind": "morphology"},
    {"id": "typo_wifi", "query": "падключение wifi", "expected": "wifi", "kind": "typo"},
    {"id": "exact_error", "query": "ошибка 809 vpn", "expected": "vpn809", "kind": "exact"},
    {"id": "exact_inventory", "query": "INV1042", "expected": "inv", "kind": "exact_control"},
    {"id": "morph_backup", "query": "резервные копии расписание", "expected": "backup", "kind": "morphology"},
    {"id": "exact_dns", "query": "диагностика dns филиале", "expected": "dns", "kind": "exact"},
    {"id": "synonym_password", "query": "забыл пароль учетной записи", "expected": "password", "kind": "semantic_synonym"},
    {"id": "negative_space", "query": "астрономия марса", "expected": None, "kind": "negative"},
    {"id": "negative_alpha", "query": "квантовый процессор", "expected": None, "kind": "negative"},
    {"id": "acl_private", "query": "внутренний финансовый сервер", "expected": None, "kind": "acl_public_user"},
]

FILLER_TOPICS = [
    ("обновление клиента", "Установите обновление клиента после согласования окна обслуживания."),
    ("заявка поддержки", "Создайте заявку поддержки и приложите снимок ошибки."),
    ("мониторинг сервера", "Проверьте доступность сервера и последние события мониторинга."),
    ("доступ сотрудника", "Права доступа сотрудника согласуются с руководителем подразделения."),
    ("рабочее место", "Подготовка рабочего места включает установку стандартного программного обеспечения."),
]


def tokens(query: str) -> list[str]:
    return [item.lower().replace("ё", "е") for item in TOKEN_RE.findall(str(query or ""))]


def current_python(query: str, rows: list[dict], limit: int = 3) -> list[str]:
    """Approximate backend.ai_chat.retrieval current scorer for public rows."""
    qtokens = tokens(query)
    if not qtokens:
        return []
    scored = []
    for row in rows:
        if row["visibility"] != "public":
            continue
        haystack = f"{row['title']}\n{row['content']}".lower().replace("ё", "е")
        score = 0
        for token in qtokens:
            score += haystack.count(token) * 3
            if token in row["title"].lower().replace("ё", "е"):
                score += 4
        if score > 0:
            scored.append((score, row["article_id"]))
    scored.sort(reverse=True)
    return [article for _score, article in scored[:limit]]


def sql_fetch(cur, sql: str, params: list, limit: int = 3) -> list[str]:
    cur.execute(sql + " LIMIT %s", [*params, limit])
    return [row[0] for row in cur.fetchall()]


def fts_query(conn, config: str, query: str, strict: bool, limit: int = 3, min_coverage: int = 1) -> list[str]:
    parts = tokens(query)
    if not parts:
        return []
    vector = f"to_tsvector('{config}'::regconfig, coalesce(title,'') || ' ' || coalesce(content,''))"
    clauses = [f"{vector} @@ plainto_tsquery('{config}'::regconfig, %s)" for _ in parts]
    op = " AND " if strict else " OR "
    score = " + ".join(f"(CASE WHEN {clause} THEN 1 ELSE 0 END)" for clause in clauses)
    sql = (
        "SELECT article_id, ts_rank(" + vector + f", plainto_tsquery('{config}'::regconfig, %s)) AS rank, ({score}) AS covered "
        "FROM bench_kb_chunks WHERE visibility='public' AND (" + op.join(clauses) + ") "
        "ORDER BY covered DESC, rank DESC, article_id"
    )
    params = [query, *parts, *parts, max(20, limit)]
    with conn.cursor() as cur:
        cur.execute(sql + " LIMIT %s", params)
        rows = cur.fetchall()
    return [row[0] for row in rows if int(row[2] or 0) >= max(1, min_coverage)][:limit]


def trgm_query(conn, query: str, limit: int = 3) -> list[str]:
    sql = (
        "SELECT article_id, similarity(lower(coalesce(title,'') || ' ' || coalesce(content,'')), lower(%s)) AS sim "
        "FROM bench_kb_chunks WHERE visibility='public' "
        "AND lower(coalesce(title,'') || ' ' || coalesce(content,'')) %% lower(%s) "
        "ORDER BY sim DESC, article_id"
    )
    with conn.cursor() as cur:
        return sql_fetch(cur, sql, [query, query], limit)


def trgm_token_query(conn, query: str, limit: int = 3) -> list[str]:
    """Token-level pg_trgm word-similarity fallback.

    Whole-query similarity is the wrong shape for long documents. Here each
    query token is compared with the best continuous word/phrase window in
    the document, then coverage is enforced across tokens.
    """
    parts = tokens(query)
    if not parts:
        return []
    blob = "lower(coalesce(title,'') || ' ' || coalesce(content,''))"
    best: dict[str, dict[str, float | int]] = {}
    with conn.cursor() as cur:
        for token in parts:
            cur.execute(
                "SELECT article_id, word_similarity(lower(%s), " + blob + ") AS sim "
                "FROM bench_kb_chunks WHERE visibility='public' AND " + blob + " %%> lower(%s) "
                "ORDER BY sim DESC, article_id LIMIT 20",
                [token, token],
            )
            for article_id, sim in cur.fetchall():
                entry = best.setdefault(article_id, {"covered": 0, "score": 0.0})
                if float(sim or 0.0) >= 0.6:
                    entry["covered"] = int(entry["covered"]) + 1
                    entry["score"] = float(entry["score"]) + float(sim or 0.0)
    need = max(1, len(parts) - 1)
    ranked = sorted(
        (
            (article_id, int(score["covered"]), float(score["score"]))
            for article_id, score in best.items()
            if int(score["covered"]) >= need
        ),
        key=lambda item: (item[1], item[2], item[0]),
        reverse=True,
    )
    return [article_id for article_id, _covered, _score in ranked[:limit]]


def hybrid_fts_trgm(conn, query: str, limit: int = 3) -> list[str]:
    parts = tokens(query)
    strict = fts_query(conn, "russian", query, strict=True, limit=limit)
    if strict:
        return strict
    need = max(1, len(parts) - 1)
    bounded = fts_query(conn, "russian", query, strict=False, limit=limit, min_coverage=need)
    if bounded:
        return bounded
    return trgm_token_query(conn, query, limit=limit)


def time_algorithm(fn, cases, repeats: int = 10) -> float:
    start = time.perf_counter()
    for _ in range(repeats):
        for case in cases:
            fn(case["query"])
    return round((time.perf_counter() - start) * 1000 / (repeats * len(cases)), 3)


def evaluate(name, fn, rows):
    details = []
    hits1 = hits3 = positives = false_positive = negatives = 0
    for case in CASES:
        result = fn(case["query"])
        expected = case["expected"]
        if expected is None:
            negatives += 1
            bad = bool(result)
            false_positive += int(bad)
            ok = not bad
        else:
            positives += 1
            hit1 = result[:1] == [expected]
            hit3 = expected in result[:3]
            hits1 += int(hit1)
            hits3 += int(hit3)
            ok = hit3
        details.append({"id": case["id"], "kind": case["kind"], "expected": expected, "result": result, "ok": ok})
    return {
        "algorithm": name,
        "hit_at_1": round(hits1 / positives, 4),
        "hit_at_3": round(hits3 / positives, 4),
        "positive_cases": positives,
        "negative_cases": negatives,
        "false_positive_cases": false_positive,
        "details": details,
    }


def main() -> None:
    rows = []
    for idx, (article, title, content) in enumerate(TARGETS):
        rows.append({
            "id": f"target-{article}",
            "article_id": article,
            "title": title,
            "content": content,
            "visibility": "private" if article == "private_fin" else "public",
        })
    for idx in range(1000):
        title, content = FILLER_TOPICS[idx % len(FILLER_TOPICS)]
        rows.append({
            "id": f"filler-{idx}",
            "article_id": f"filler{idx}",
            "title": f"{title} {idx}",
            "content": f"{content} Контрольный раздел {idx}.",
            "visibility": "public",
        })

    with psycopg.connect(ADMIN, autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{DB}"')
        conn.execute(f'CREATE DATABASE "{DB}"')
    with psycopg.connect(URL, autocommit=True) as conn:
        conn.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        conn.execute("CREATE TABLE bench_kb_chunks (id text primary key, article_id text not null, title text not null, content text not null, visibility text not null)")
        with conn.cursor() as cur:
            cur.executemany(
                "INSERT INTO bench_kb_chunks VALUES (%s,%s,%s,%s,%s)",
                [(r["id"], r["article_id"], r["title"], r["content"], r["visibility"]) for r in rows],
            )
        conn.execute("CREATE INDEX fts_simple_gin ON bench_kb_chunks USING GIN (to_tsvector('simple'::regconfig, coalesce(title,'') || ' ' || coalesce(content,'')))" )
        conn.execute("CREATE INDEX fts_russian_gin ON bench_kb_chunks USING GIN (to_tsvector('russian'::regconfig, coalesce(title,'') || ' ' || coalesce(content,'')))" )
        conn.execute("CREATE INDEX trgm_lower_gin ON bench_kb_chunks USING GIN ((lower(coalesce(title,'') || ' ' || coalesce(content,''))) gin_trgm_ops)")
        conn.execute("ANALYZE bench_kb_chunks")

    conn = psycopg.connect(URL)
    try:
        algorithms = {
            "current_python_substring": lambda q: current_python(q, rows),
            "pg_fts_simple_and": lambda q: fts_query(conn, "simple", q, strict=True),
            "pg_fts_russian_and": lambda q: fts_query(conn, "russian", q, strict=True),
            "pg_fts_russian_or_ranked": lambda q: fts_query(conn, "russian", q, strict=False),
            "pg_trgm_whole_query": lambda q: trgm_query(conn, q),
            "pg_trgm_token_coverage": lambda q: trgm_token_query(conn, q),
            "pg_hybrid_russian_then_trgm": lambda q: hybrid_fts_trgm(conn, q),
        }
        results = []
        for name, fn in algorithms.items():
            result = evaluate(name, fn, rows)
            result["avg_latency_ms_synthetic_1k_rows"] = time_algorithm(fn, CASES)
            results.append(result)

        plans = {}
        with conn.cursor() as cur:
            cur.execute(
                "EXPLAIN (COSTS FALSE) SELECT article_id FROM bench_kb_chunks "
                "WHERE visibility='public' AND to_tsvector('russian'::regconfig, coalesce(title,'') || ' ' || coalesce(content,'')) "
                "@@ plainto_tsquery('russian'::regconfig, 'настройки vpn удаленная работа')"
            )
            plans["fts_russian_default"] = [row[0] for row in cur.fetchall()]
            cur.execute(
                "EXPLAIN (COSTS FALSE) SELECT article_id FROM bench_kb_chunks "
                "WHERE visibility='public' AND lower(coalesce(title,'') || ' ' || coalesce(content,'')) %> lower('падключение')"
            )
            plans["trgm_word_default"] = [row[0] for row in cur.fetchall()]
            cur.execute("SET enable_seqscan=off")
            cur.execute(
                "EXPLAIN (COSTS FALSE) SELECT article_id FROM bench_kb_chunks "
                "WHERE visibility='public' AND lower(coalesce(title,'') || ' ' || coalesce(content,'')) %> lower('падключение')"
            )
            plans["trgm_word_index_capability_forced"] = [row[0] for row in cur.fetchall()]
            cur.execute("SET enable_seqscan=on")
    finally:
        conn.close()

    output = {
        "database": "isolated disposable PostgreSQL",
        "rows": len(rows),
        "target_rows": len(TARGETS),
        "cases": len(CASES),
        "limitations": [
            "synthetic corpus only; no production data",
            "current Python scorer approximated outside the application service",
            "hypothetical SQL retrieval is not yet application implementation",
            "small corpus; latency is comparative smoke evidence, not production sizing",
        ],
        "results": results,
        "plans": plans,
    }
    OUT.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "out": str(OUT),
        "summary": [
            {k: r[k] for k in ("algorithm", "hit_at_1", "hit_at_3", "false_positive_cases", "avg_latency_ms_synthetic_1k_rows")}
            for r in results
        ],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
