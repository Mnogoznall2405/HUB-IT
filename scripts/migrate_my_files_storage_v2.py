#!/usr/bin/env python3
"""Migrate My Files blobs to per-owner UUID model + UNC per-user layout.

Usage:
  python scripts/migrate_my_files_storage_v2.py --dry-run
  python scripts/migrate_my_files_storage_v2.py --apply

Does not delete legacy files or my_file_blobs_v1 rows.
Requires alembic revision 20260909_0110 (legacy tables renamed to *_v1).

File copies run outside DB transactions. Each blob gets its own short commit.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import sys
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "WEB-itinvent"))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _sha256(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def _storage_root() -> Path:
    configured = str(os.getenv("MY_FILES_STORAGE_DIR", "") or "").strip()
    if configured:
        return Path(configured)
    unc = str(os.getenv("HUBIT_STORAGE_UNC", "") or "").strip().rstrip("\\/")
    if unc:
        return Path(unc) / "users"
    return ROOT / "data" / "my_files_users"


def _ensure_smb_if_needed(path: Path) -> None:
    text = str(path)
    if not (text.startswith("\\\\") or text.startswith("//")):
        return
    from backend.services.hubit_storage import ensure_connected

    ensure_connected(path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report only; no DB/disk writes")
    parser.add_argument("--apply", action="store_true", help="Perform migration")
    parser.add_argument(
        "--mapping-out",
        default=str(ROOT / "tmp" / "my_files_blob_migration_mapping.json"),
        help="Path for old→new mapping JSON",
    )
    args = parser.parse_args()
    if not args.dry_run and not args.apply:
        parser.error("Specify --dry-run or --apply")

    from sqlalchemy import create_engine, text, inspect
    from backend.appdb.db import get_app_database_url

    database_url = get_app_database_url()
    engine = create_engine(database_url)
    schema = "app" if engine.dialect.name == "postgresql" else None

    def q(table: str) -> str:
        return f'"{schema}".{table}' if schema else table

    insp = inspect(engine)
    has_v1 = insp.has_table("my_file_blobs_v1", schema=schema)
    has_new = insp.has_table("my_file_blobs", schema=schema)
    if not has_v1 or not has_new:
        print(
            json.dumps(
                {
                    "error": "expected my_file_blobs_v1 and my_file_blobs after alembic 20260909_0110",
                    "has_v1": has_v1,
                    "has_new": has_new,
                },
                ensure_ascii=False,
            )
        )
        return 2

    # Guard: new table must already be v2-shaped.
    new_cols = {c["name"] for c in insp.get_columns("my_file_blobs", schema=schema)}
    if "owner_user_id" not in new_cols or "original_sha256" not in new_cols:
        print(json.dumps({"error": "my_file_blobs is not v2 schema", "columns": sorted(new_cols)}, ensure_ascii=False))
        return 2

    storage_root = _storage_root()
    report = {
        "storage_root": str(storage_root),
        "files_total": 0,
        "ready_files": 0,
        "old_blobs": 0,
        "users": [],
        "shared_blobs_across_users": 0,
        "new_blobs_required": 0,
        "bytes_to_copy": 0,
        "previews_to_regenerate": 0,
        "missing_source_blobs": 0,
        "sha_mismatches": 0,
        "estimated_paths": [],
        "errors": [],
        "migrated_files": 0,
        "migrated_blobs": 0,
        "bytes_copied": 0,
        "sha_verified": 0,
        "previews_queued": 0,
        "skipped": 0,
        "verify_ok": 0,
        "verify_failed": 0,
    }

    with engine.connect() as conn:
        files = conn.execute(
            text(
                f"""
                SELECT id, owner_user_id, status, blob_id, original_sha256, deleted_at
                FROM {q('my_files')}
                """
            )
        ).mappings().all()
        report["files_total"] = len(files)
        ready = [
            row
            for row in files
            if str(row["status"]) == "ready" and row["deleted_at"] is None and row["blob_id"]
        ]
        report["ready_files"] = len(ready)

        old_blobs = {
            row["id"]: dict(row)
            for row in conn.execute(text(f"SELECT * FROM {q('my_file_blobs_v1')}")).mappings().all()
        }
        report["old_blobs"] = len(old_blobs)

        owners_by_blob: dict[str, set[int]] = defaultdict(set)
        users: set[int] = set()
        for row in ready:
            owners_by_blob[str(row["blob_id"])].add(int(row["owner_user_id"]))
            users.add(int(row["owner_user_id"]))
        report["users"] = sorted(users)
        report["shared_blobs_across_users"] = sum(1 for owners in owners_by_blob.values() if len(owners) > 1)

        groups: dict[tuple[str, int], list] = defaultdict(list)
        for row in ready:
            groups[(str(row["blob_id"]), int(row["owner_user_id"]))].append(row)
        report["new_blobs_required"] = len(groups)

        plans: list[dict] = []
        for (old_blob_id, owner_user_id), rows in sorted(groups.items()):
            old = old_blobs.get(old_blob_id)
            if old is None:
                report["missing_source_blobs"] += 1
                report["errors"].append(f"missing old blob {old_blob_id} for user {owner_user_id}")
                continue
            source = Path(str(old.get("storage_path") or ""))
            if not source.exists() or not source.is_file():
                report["missing_source_blobs"] += 1
                report["errors"].append(f"missing source file {source}")
                continue
            original_sha = str(old.get("id") or rows[0].get("original_sha256") or "").lower()
            if len(original_sha) < 4:
                report["errors"].append(f"invalid original sha for blob {old_blob_id}")
                continue
            stored_sha = str(old.get("stored_sha256") or original_sha).lower()
            mode = str(old.get("storage_mode") or "stored")
            ext = source.suffix.lower()
            if mode == "zstd":
                ext = ".zst"
            elif not ext:
                ext = str(old.get("output_extension") or "")
                if ext and not ext.startswith("."):
                    ext = f".{ext}"
            if len(ext) > 32:
                ext = ""
            relative = f"{owner_user_id}/my_files/blobs/{original_sha[:2]}/{original_sha[2:4]}/{original_sha}{ext}"
            report["bytes_to_copy"] += int(old.get("stored_size_bytes") or source.stat().st_size)
            report["previews_to_regenerate"] += 1
            report["estimated_paths"].append(relative)
            plans.append(
                {
                    "old_blob_id": old_blob_id,
                    "owner_user_id": owner_user_id,
                    "new_blob_id": uuid.uuid4().hex,
                    "source": str(source),
                    "relative_path": relative,
                    "file_ids": [str(r["id"]) for r in rows],
                    "ref_count": len(rows),
                    "original_sha256": original_sha,
                    "stored_sha256": stored_sha,
                    "storage_mode": mode,
                    "original_size_bytes": int(old.get("original_size_bytes") or 0),
                    "stored_size_bytes": int(old.get("stored_size_bytes") or 0),
                    "output_mime_type": str(old.get("output_mime_type") or "application/octet-stream"),
                    "output_extension": ext,
                }
            )

    report["estimated_paths"] = report["estimated_paths"][:50]
    mapping: dict[str, dict] = {f"{p['old_blob_id']}:{p['owner_user_id']}": p for p in plans}

    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
        return 0 if not report["errors"] else 1

    _ensure_smb_if_needed(storage_root)
    storage_root.mkdir(parents=True, exist_ok=True)

    for plan in plans:
        key = f"{plan['old_blob_id']}:{plan['owner_user_id']}"
        source = Path(plan["source"])
        dest = storage_root / Path(plan["relative_path"])
        try:
            with engine.begin() as conn:
                existing = conn.execute(
                    text(
                        f"""
                        SELECT id, storage_path FROM {q('my_file_blobs')}
                        WHERE owner_user_id = :owner AND original_sha256 = :sha
                        """
                    ),
                    {"owner": plan["owner_user_id"], "sha": plan["original_sha256"]},
                ).mappings().first()
                if existing is not None:
                    new_id = str(existing["id"])
                    mapping[key]["new_blob_id"] = new_id
                    # Ensure file rows point at existing v2 blob.
                    now = _utc_now()
                    for file_id in plan["file_ids"]:
                        conn.execute(
                            text(
                                f"""
                                UPDATE {q('my_files')}
                                SET blob_id = :blob_id, original_sha256 = :sha, updated_at = :updated
                                WHERE id = :file_id
                                """
                            ),
                            {
                                "blob_id": new_id,
                                "sha": plan["original_sha256"],
                                "updated": now,
                                "file_id": file_id,
                            },
                        )
                    report["skipped"] += 1
                    continue

            # Copy outside the DB transaction.
            _ensure_smb_if_needed(dest)
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(f"{dest.name}.tmp-{uuid.uuid4().hex}")
            size = 0
            try:
                with source.open("rb") as src, tmp.open("wb") as dst:
                    shutil.copyfileobj(src, dst, 1024 * 1024)
                    dst.flush()
                    try:
                        os.fsync(dst.fileno())
                    except OSError:
                        pass
                digest, size = _sha256(tmp)
                if digest.lower() != str(plan["stored_sha256"]).lower():
                    report["sha_mismatches"] += 1
                    report["errors"].append(f"sha mismatch for {source}")
                    tmp.unlink(missing_ok=True)
                    continue
                os.replace(tmp, dest)
                report["bytes_copied"] += size
                report["sha_verified"] += 1
            finally:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)

            now = _utc_now()
            with engine.begin() as conn:
                # Re-check race after copy.
                existing = conn.execute(
                    text(
                        f"""
                        SELECT id FROM {q('my_file_blobs')}
                        WHERE owner_user_id = :owner AND original_sha256 = :sha
                        """
                    ),
                    {"owner": plan["owner_user_id"], "sha": plan["original_sha256"]},
                ).first()
                if existing is not None:
                    mapping[key]["new_blob_id"] = str(existing[0])
                    report["skipped"] += 1
                    continue

                conn.execute(
                    text(
                        f"""
                        INSERT INTO {q('my_file_blobs')} (
                            id, owner_user_id, original_sha256, storage_path, storage_mode,
                            stored_sha256, original_size_bytes, stored_size_bytes,
                            output_mime_type, output_extension, ref_count,
                            created_at, updated_at, last_used_at
                        ) VALUES (
                            :id, :owner, :orig, :path, :mode,
                            :stored, :osize, :ssize,
                            :mime, :ext, :ref,
                            :created, :updated, :used
                        )
                        """
                    ),
                    {
                        "id": plan["new_blob_id"],
                        "owner": plan["owner_user_id"],
                        "orig": plan["original_sha256"],
                        "path": plan["relative_path"],
                        "mode": plan["storage_mode"],
                        "stored": plan["stored_sha256"],
                        "osize": plan["original_size_bytes"],
                        "ssize": plan["stored_size_bytes"] or size,
                        "mime": plan["output_mime_type"],
                        "ext": plan["output_extension"],
                        "ref": plan["ref_count"],
                        "created": now,
                        "updated": now,
                        "used": now,
                    },
                )
                for file_id in plan["file_ids"]:
                    conn.execute(
                        text(
                            f"""
                            UPDATE {q('my_files')}
                            SET blob_id = :blob_id, original_sha256 = :sha, updated_at = :updated
                            WHERE id = :file_id
                            """
                        ),
                        {
                            "blob_id": plan["new_blob_id"],
                            "sha": plan["original_sha256"],
                            "updated": now,
                            "file_id": file_id,
                        },
                    )
                    report["migrated_files"] += 1
                conn.execute(
                    text(
                        f"""
                        INSERT INTO {q('my_file_previews')} (
                            blob_id, status, preview_kind, source_kind, source_filename,
                            content_type, preview_path, preview_mime_type, preview_filename,
                            page_count, sheets_json, error_text, created_at, updated_at, generated_at
                        ) VALUES (
                            :blob_id, 'queued', 'unsupported', '', '',
                            'application/octet-stream', '', 'application/octet-stream', '',
                            0, '[]', '', :created, :updated, NULL
                        )
                        ON CONFLICT (blob_id) DO UPDATE
                        SET status = 'queued', updated_at = EXCLUDED.updated_at, error_text = ''
                        """
                    ),
                    {"blob_id": plan["new_blob_id"], "created": now, "updated": now},
                )
                report["previews_queued"] += 1
                report["migrated_blobs"] += 1
        except Exception as exc:
            report["errors"].append(f"{key}: {exc}")
            continue

    # Post-verify
    with engine.connect() as conn:
        for plan in plans:
            new_id = mapping[f"{plan['old_blob_id']}:{plan['owner_user_id']}"]["new_blob_id"]
            blob = conn.execute(
                text(f"SELECT * FROM {q('my_file_blobs')} WHERE id = :id"),
                {"id": new_id},
            ).mappings().first()
            if blob is None:
                report["verify_failed"] += 1
                report["errors"].append(f"verify missing blob {new_id}")
                continue
            path = storage_root / Path(str(blob["storage_path"]))
            if not path.exists():
                report["verify_failed"] += 1
                report["errors"].append(f"verify missing path {path}")
                continue
            digest, size = _sha256(path)
            if digest.lower() != str(blob["stored_sha256"]).lower():
                report["verify_failed"] += 1
                report["errors"].append(f"verify sha mismatch {path}")
                continue
            count = conn.execute(
                text(
                    f"""
                    SELECT COUNT(*) FROM {q('my_files')}
                    WHERE blob_id = :blob_id AND deleted_at IS NULL AND status = 'ready'
                    """
                ),
                {"blob_id": new_id},
            ).scalar_one()
            if int(count) != int(blob["ref_count"]):
                report["verify_failed"] += 1
                report["errors"].append(
                    f"verify ref_count mismatch blob={new_id} db={blob['ref_count']} files={count}"
                )
                continue
            if int(blob["owner_user_id"]) != int(plan["owner_user_id"]):
                report["verify_failed"] += 1
                report["errors"].append(f"verify owner mismatch {new_id}")
                continue
            report["verify_ok"] += 1

    mapping_path = Path(args.mapping_out)
    mapping_path.parent.mkdir(parents=True, exist_ok=True)
    mapping_path.write_text(json.dumps(mapping, ensure_ascii=False, indent=2), encoding="utf-8")
    report["mapping_out"] = str(mapping_path)
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    return 1 if report["errors"] or report["verify_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
