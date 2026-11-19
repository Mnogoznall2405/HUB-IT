"""Read-only check of ONLYOFFICE save pipeline in production (appdb)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "WEB-itinvent"))
sys.stdout.reconfigure(encoding="utf-8")

from sqlalchemy import func, select

from backend.appdb.db import app_session, get_app_database_url
from backend.appdb.models import AppMyFile, AppMyFileAudit, AppMyFileVersion

def main() -> int:
    url = get_app_database_url()
    with app_session(url) as s:
        print("=== audit actions last 3 days ===")
        rows = s.execute(
            select(AppMyFileAudit.action, func.count())
            .where(AppMyFileAudit.created_at >= func.now() - __import__("datetime").timedelta(days=3))
            .group_by(AppMyFileAudit.action).order_by(func.count().desc())
        ).all()
        for action, cnt in rows:
            print(f"  {action}: {cnt}")

        print("\n=== office_save_denied/lost/stale last 3 days (details) ===")
        rows = s.execute(
            select(AppMyFileAudit.created_at, AppMyFileAudit.action, AppMyFileAudit.actor_user_id,
                   AppMyFileAudit.actor_username, AppMyFileAudit.file_id, AppMyFileAudit.details)
            .where(AppMyFileAudit.action.in_(["office_save_denied", "office_save_lost", "office_save_stale"]),
                   AppMyFileAudit.created_at >= func.now() - __import__("datetime").timedelta(days=3))
            .order_by(AppMyFileAudit.created_at.desc()).limit(30)
        ).all()
        for r in rows:
            print(f"  {r[0]} {r[1]} user={r[2]}({r[3]}) file={str(r[4])[:12]} :: {str(r[5])[:90]}")

        print("\n=== ПОДБОР files ===")
        lib_files = s.execute(
            select(AppMyFile).where(AppMyFile.original_file_name.ilike("%одбор%"))
        ).scalars().all()
        for f in lib_files:
            print(f"  id={f.id[:12]} owner={f.owner_user_id} upl={f.uploaded_by_user_id} "
                  f"size={f.original_size_bytes} upd={f.updated_at} sess='{f.office_session_key[:12] if f.office_session_key else ''}' del={f.deleted_at}")
            vers = s.execute(
                select(AppMyFileVersion).where(AppMyFileVersion.file_id == f.id)
                .order_by(AppMyFileVersion.version_no.desc()).limit(12)
            ).scalars().all()
            for v in vers:
                print(f"    v{v.version_no} by={v.created_by_username} ({v.created_by_user_id}) "
                      f"{v.created_at} size={v.original_size_bytes} sess={v.session_key[:12] if v.session_key else ''} changes={'Y' if v.office_changes_blob_id else 'n'}")

        print("\n=== versions last 24h by file ===")
        rows = s.execute(
            select(AppMyFile.original_file_name, func.count(), func.max(AppMyFileVersion.created_at))
            .join(AppMyFileVersion, AppMyFileVersion.file_id == AppMyFile.id)
            .where(AppMyFileVersion.created_at >= func.now() - __import__("datetime").timedelta(days=1))
            .group_by(AppMyFile.original_file_name).order_by(func.max(AppMyFileVersion.created_at).desc())
        ).all()
        for name, cnt, last in rows:
            print(f"  {cnt:>3}x {name[:60]} last={last}")

        print("\n=== open editing sessions (office_session_key set) ===")
        rows = s.execute(
            select(AppMyFile.original_file_name, AppMyFile.updated_at, AppMyFile.office_session_key)
            .where(AppMyFile.office_session_key != "")
        ).all()
        for name, upd, key in rows:
            print(f"  {name[:60]} updated={upd} key={key[:16]}")

        print("\n=== audit saved/denied today timeline ===")
        rows = s.execute(
            select(AppMyFileAudit.created_at, AppMyFileAudit.action, AppMyFileAudit.actor_username,
                   AppMyFileAudit.file_id)
            .where(AppMyFileAudit.action.like("office_%"),
                   AppMyFileAudit.created_at >= func.now() - __import__("datetime").timedelta(hours=20))
            .order_by(AppMyFileAudit.created_at.desc()).limit(40)
        ).all()
        for r in rows:
            print(f"  {r[0]} {r[1]:<28} {r[2]:<20} file={str(r[3])[:12]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
