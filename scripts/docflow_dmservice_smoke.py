"""Read-only DMService release smoke using one already configured HUB-IT profile."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

load_dotenv(ROOT / ".env")

from backend.appdb.db import app_session, ensure_app_schema_initialized  # noqa: E402
from backend.appdb.models import AppDocflowCredential  # noqa: E402
from backend.services.docflow_dm_service_client import (  # noqa: E402
    DocflowDMServiceClient,
    SUPPORTED_DM_VERSION,
)
from backend.services.secret_crypto_service import decrypt_docflow_secret  # noqa: E402


def _profile(user_id: int | None) -> AppDocflowCredential:
    ensure_app_schema_initialized()
    with app_session() as session:
        query = select(AppDocflowCredential).where(
            AppDocflowCredential.status.in_(("valid", "configured"))
        )
        if user_id is not None:
            query = query.where(AppDocflowCredential.user_id == int(user_id))
        row = session.execute(query.order_by(AppDocflowCredential.updated_at.desc()).limit(1)).scalar_one_or_none()
        if row is None:
            raise RuntimeError("Нет сохранённого профиля 1С для read-only smoke")
        session.expunge(row)
        return row


async def _run(user_id: int | None, *, download_file: bool) -> dict[str, object]:
    row = _profile(user_id)
    password = decrypt_docflow_secret(str(row.password_enc))
    client = DocflowDMServiceClient()
    started = time.perf_counter()
    try:
        connection = await client.test_connection(login=str(row.login), password=password)
        tasks = await client.list_tasks(
            login=str(row.login),
            password=password,
            scope="inbox",
            search="",
            limit=1,
        )
        first_task = next(iter(tasks.get("items") or []), None)
        detail = (
            await client.get_task_detail(
                login=str(row.login),
                password=password,
                task_ref=str(first_task.get("ref") or ""),
            )
            if first_task
            else None
        )
        downloaded_bytes = 0
        if download_file and detail:
            candidates = [item for item in detail.get("files") or [] if int(item.get("size") or 0) > 0]
            candidate = min(candidates, key=lambda item: int(item.get("size") or 0), default=None)
            if candidate:
                exported = await client.export_file(
                    login=str(row.login),
                    password=password,
                    task_ref=str(detail.get("ref") or ""),
                    file_ref=str(candidate.get("ref") or ""),
                )
                exported_path = Path(str(exported.get("temporary_path") or ""))
                try:
                    downloaded_bytes = int(exported.get("size") or 0)
                finally:
                    exported_path.unlink(missing_ok=True)
    finally:
        password = ""
        await client.aclose()
    version = str(connection.get("version") or "")
    if version != SUPPORTED_DM_VERSION:
        raise RuntimeError(f"Неподдерживаемая версия DMService: {version or 'не определена'}")
    return {
        "ok": True,
        "transport": "dmservice",
        "version": version,
        "current_user_resolved": bool((connection.get("current_user") or {}).get("ref")),
        "inbox_returned": int(tasks.get("returned") or 0),
        "inbox_truncated": bool(tasks.get("truncated")),
        "detail_resolved": bool(detail and detail.get("ref")),
        "related_objects": len(detail.get("related_objects") or []) if detail else 0,
        "files": len(detail.get("files") or []) if detail else 0,
        "downloaded_bytes": downloaded_bytes,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Read-only smoke штатного 1С DMService")
    parser.add_argument("--user-id", type=int, default=None)
    parser.add_argument("--download-file", action="store_true")
    args = parser.parse_args()
    if str(os.getenv("DOCFLOW_DM_SERVICE_TLS_VERIFY", "1")).strip() not in {"1", "true", "True"}:
        raise RuntimeError("TLS verification must remain enabled")
    print(json.dumps(asyncio.run(_run(args.user_id, download_file=args.download_file)), ensure_ascii=False))


if __name__ == "__main__":
    main()
