"""Хранилище словаря компании (``voice.glossary_terms``) и выгрузка подтверждённых терминов для пайплайна.

Кандидатов присылает пайплайн после каждой записи (``<base>_glossary_candidates.json``); подтверждает человек.
Пайплайн читает только выгрузку подтверждённых (``voice_video/data/company_glossary.json``) — без доступа к БД.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import text

from .config import config
from .db import get_voice_engine

KINDS = ("abbr", "object", "org", "doc", "person", "other")
STATUSES = ("candidate", "confirmed", "rejected")
_DATE_KEYS = ("created_at", "updated_at")
_COLUMNS = ("id, term, term_key, kind, expansion, aliases, status, core, occurrences, first_base, last_base, "
            "evidence, created_by, updated_by, created_at, updated_at")


def _engine():
    return get_voice_engine(config.database_url)


def term_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").lower().replace("ё", "е")).strip()[:120]


def _clean_aliases(values: Any, term: str) -> List[str]:
    out: List[str] = []
    for value in values or []:
        value = re.sub(r"\s+", " ", str(value or "")).strip()[:120]
        if value and term_key(value) != term_key(term) and value not in out:
            out.append(value)
    return out[:12]


def _row(row) -> Dict[str, Any]:
    data = dict(row._mapping)
    for key in _DATE_KEYS:
        if isinstance(data.get(key), datetime):
            data[key] = data[key].isoformat()
    aliases = data.get("aliases")
    if isinstance(aliases, str):
        try:
            aliases = json.loads(aliases)
        except (ValueError, TypeError):
            aliases = []
    data["aliases"] = aliases or []
    data["core"] = bool(data.get("core"))
    return data


def get_term(term_id: str) -> Optional[Dict[str, Any]]:
    with _engine().connect() as conn:
        row = conn.execute(text(f"SELECT {_COLUMNS} FROM voice.glossary_terms WHERE id = :id"), {"id": term_id}).fetchone()
    return _row(row) if row else None


def list_terms(*, status: Optional[str] = None, q: str = "", limit: int = 500, offset: int = 0) -> Dict[str, Any]:
    where, params = ["1=1"], {"limit": int(limit), "offset": int(offset)}
    if status in STATUSES:
        where.append("status = :status")
        params["status"] = status
    if q.strip():
        where.append("(term_key LIKE :q OR lower(coalesce(expansion, '')) LIKE :q)")
        params["q"] = f"%{term_key(q)}%"
    with _engine().connect() as conn:
        rows = conn.execute(text(
            f"SELECT {_COLUMNS} FROM voice.glossary_terms WHERE {' AND '.join(where)} "
            "ORDER BY CASE status WHEN 'candidate' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END, occurrences DESC, term_key "
            "LIMIT :limit OFFSET :offset"), params).fetchall()
        counts = {r[0]: r[1] for r in conn.execute(text("SELECT status, count(*) FROM voice.glossary_terms GROUP BY status"))}
    return {"items": [_row(r) for r in rows], "counts": {s: int(counts.get(s, 0)) for s in STATUSES}}


def _is_duplicate(exc: Exception) -> bool:
    message = str(exc).lower()
    return "unique" in message or "duplicate" in message


def create_term(*, term: str, kind: str = "other", expansion: str = "", aliases: Iterable[str] = (),
                status: str = "confirmed", core: bool = False, actor: str = "") -> Dict[str, Any]:
    term = re.sub(r"\s+", " ", str(term or "")).strip()
    key = term_key(term)
    if len(key) < 2 or len(term) > 120:
        raise ValueError("Термин: от 2 до 120 символов")
    if status not in STATUSES:
        raise ValueError("Недопустимый статус")
    term_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    try:
        with _engine().begin() as conn:
            conn.execute(text(
                "INSERT INTO voice.glossary_terms (id, term, term_key, kind, expansion, aliases, status, core, occurrences, "
                "created_by, updated_by, created_at, updated_at) VALUES (:id, :term, :key, :kind, :exp, :aliases, :status, "
                ":core, 1, :by, :by, :now, :now)"),
                {"id": term_id, "term": term, "key": key, "kind": kind if kind in KINDS else "other",
                 "exp": str(expansion or "").strip()[:500],
                 "aliases": json.dumps(_clean_aliases(aliases, term), ensure_ascii=False),
                 "status": status, "core": bool(core), "by": actor, "now": now})
    except Exception as exc:  # noqa: BLE001 - уникальный term_key
        if _is_duplicate(exc):
            raise ValueError("Такой термин уже есть") from exc
        raise
    return get_term(term_id) or {"id": term_id}


def update_term(term_id: str, fields: Dict[str, Any], actor: str = "") -> Optional[Dict[str, Any]]:
    current = get_term(term_id)
    if not current:
        return None
    term = re.sub(r"\s+", " ", str(fields.get("term", current["term"]) or "")).strip()
    if len(term_key(term)) < 2 or len(term) > 120:
        raise ValueError("Термин: от 2 до 120 символов")
    status = fields.get("status", current["status"])
    kind = fields.get("kind", current["kind"])
    if status not in STATUSES:
        raise ValueError("Недопустимый статус")
    aliases = _clean_aliases(fields.get("aliases", current["aliases"]), term)
    try:
        with _engine().begin() as conn:
            conn.execute(text(
                "UPDATE voice.glossary_terms SET term = :term, term_key = :key, kind = :kind, expansion = :exp, "
                "aliases = :aliases, status = :status, core = :core, updated_by = :by, updated_at = :now WHERE id = :id"),
                {"id": term_id, "term": term, "key": term_key(term), "kind": kind if kind in KINDS else "other",
                 "exp": str(fields.get("expansion", current["expansion"]) or "").strip()[:500],
                 "aliases": json.dumps(aliases, ensure_ascii=False), "status": status,
                 "core": bool(fields.get("core", current["core"])), "by": actor, "now": datetime.now(timezone.utc)})
    except Exception as exc:  # noqa: BLE001
        if _is_duplicate(exc):
            raise ValueError("Такой термин уже есть") from exc
        raise
    return get_term(term_id)


def delete_term(term_id: str) -> bool:
    with _engine().begin() as conn:
        return conn.execute(text("DELETE FROM voice.glossary_terms WHERE id = :id"), {"id": term_id}).rowcount > 0


def upsert_candidates(base: str, candidates: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    """Кандидаты из записи: новые — в очередь на подтверждение, известные — считаем повторы; отклонённые не возвращаются."""
    added = repeated = skipped = 0
    now = datetime.now(timezone.utc)
    for item in candidates or []:
        if not isinstance(item, dict):
            skipped += 1
            continue
        term = re.sub(r"\s+", " ", str(item.get("term") or "")).strip()
        key = term_key(term)
        if len(key) < 2 or len(term) > 120:
            skipped += 1
            continue
        with _engine().begin() as conn:
            row = conn.execute(text("SELECT id, status, last_base FROM voice.glossary_terms WHERE term_key = :key"),
                               {"key": key}).fetchone()
            if row is None:
                conn.execute(text(
                    "INSERT INTO voice.glossary_terms (id, term, term_key, kind, expansion, aliases, status, core, occurrences, "
                    "first_base, last_base, evidence, created_by, updated_by, created_at, updated_at) VALUES (:id, :term, :key, "
                    ":kind, :exp, :aliases, 'candidate', :core, 1, :base, :base, :evidence, 'pipeline', 'pipeline', :now, :now)"),
                    {"id": str(uuid.uuid4()), "term": term, "key": key,
                     "kind": item.get("kind") if item.get("kind") in KINDS else "other",
                     "exp": str(item.get("expansion") or "")[:500], "core": False,
                     "aliases": json.dumps(_clean_aliases(item.get("aliases"), term), ensure_ascii=False),
                     "base": base[:512], "evidence": str(item.get("evidence") or "")[:500], "now": now})
                added += 1
            elif row[1] == "rejected" or row[2] == base:
                skipped += 1  # отклонённое не возвращаем; повторный разбор той же записи не накручивает счётчик
            else:
                conn.execute(text("UPDATE voice.glossary_terms SET occurrences = occurrences + 1, last_base = :base, "
                                  "updated_at = :now WHERE id = :id"), {"id": row[0], "base": base[:512], "now": now})
                repeated += 1
    return {"added": added, "repeated": repeated, "skipped": skipped}


def ingest_candidates_file(path: Path, base: str) -> Dict[str, int]:
    """Кандидаты, которые пайплайн оставил рядом с отчётами; нет файла или он битый — ничего не делаем."""
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {"added": 0, "repeated": 0, "skipped": 0}
    items = data.get("candidates") if isinstance(data, dict) else None
    return upsert_candidates(base, items if isinstance(items, list) else [])


def export_confirmed(path: Path) -> int:
    """Атомарно пишет выгрузку подтверждённых терминов для пайплайна; возвращает число терминов."""
    with _engine().connect() as conn:
        rows = conn.execute(text(
            f"SELECT {_COLUMNS} FROM voice.glossary_terms WHERE status = 'confirmed' ORDER BY term_key")).fetchall()
    terms = [{"term": r["term"], "kind": r["kind"], "expansion": r["expansion"] or "", "aliases": r["aliases"],
              "core": r["core"], "status": "confirmed"} for r in (_row(row) for row in rows)]
    payload = {"version": 1, "generated_at": datetime.now(timezone.utc).isoformat(), "terms": terms}
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=1)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    return len(terms)
