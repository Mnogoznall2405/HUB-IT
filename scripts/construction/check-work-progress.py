"""Read native construction work responses after migration 0108, without writes.

The service uses one bounded PostgreSQL READ ONLY snapshot in this process.
No API authentication, 1C requests or runtime schema initialization is performed.
"""
from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sys

from dotenv import dotenv_values
import sqlalchemy as sa
from sqlalchemy.orm import Session


ROOT = Path(__file__).resolve().parents[2]
TARGET = "20260908_0108"


def validate_response(payload, group_refs, *, include_archived):
    from backend.models.construction_work import WorkResponse

    response = WorkResponse.model_validate(payload)
    active = [item for item in response.items if not item.plan.archived]
    if response.summary.total != len(active):
        raise RuntimeError("Active work count does not match the native summary")
    if not include_archived and len(active) != len(response.items):
        raise RuntimeError("Default response unexpectedly includes archived work")
    if {direction.group_ref for direction in response.directions} != set(group_refs):
        raise RuntimeError("Response directions do not match object membership")
    if any(item.group_ref not in group_refs or item.version < 1 for item in response.items):
        raise RuntimeError("Response contains work outside its scope or an invalid version")
    if response.trend and (
        response.trend[-1].date != response.as_of
        or response.trend[-1].percent != response.summary.percent
    ):
        raise RuntimeError("Latest trend does not match the selected-day summary")
    return response


def main():
    url = str(dotenv_values(ROOT / ".env").get("APP_DATABASE_URL") or "").strip()
    if not url or sa.engine.make_url(url).get_backend_name() != "postgresql":
        raise RuntimeError("A configured PostgreSQL application database is required")
    sys.path.insert(0, str(ROOT / "WEB-itinvent"))
    from backend.config import config
    from backend.appdb.models import AppConstructionObject, AppConstructionObject1CGroup
    from backend.services import construction_work_service as work_module

    if str(config.app_db.database_url or "").strip() != url:
        raise RuntimeError("Runtime config differs from the root environment database")
    engine = sa.create_engine(
        url, poolclass=sa.pool.NullPool, hide_parameters=True,
        connect_args={"connect_timeout": 5, "application_name": "hubit-construction-read-postcheck"},
    )
    original_session = work_module.app_session
    try:
        with engine.connect() as connection, connection.begin():
            connection.execute(sa.text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY"))
            connection.execute(sa.text("SET LOCAL statement_timeout = '10000ms'"))
            connection.execute(sa.text("SET LOCAL lock_timeout = '1500ms'"))
            if connection.execute(sa.text("SELECT current_setting('transaction_read_only')")).scalar_one() != "on":
                raise RuntimeError("Read-only transaction was not confirmed")
            revisions = connection.execute(sa.text("SELECT version_num FROM system.alembic_version")).scalars().all()
            if revisions != [TARGET]:
                raise RuntimeError("Apply migration 0108 before running native work postchecks")

            @contextmanager
            def readonly_session(database_url=None):
                if database_url != url:
                    raise RuntimeError("Native service requested an unexpected database")
                with Session(bind=connection, autoflush=False, expire_on_commit=False) as session:
                    yield session

            work_module.app_session = readonly_session
            service = work_module.ConstructionWorkService(url)
            with readonly_session(url) as session:
                object_ids = session.scalars(sa.select(AppConstructionObject.id).where(
                    AppConstructionObject.is_active.is_(True),
                ).order_by(AppConstructionObject.id)).all()
                memberships = session.execute(sa.select(
                    AppConstructionObject1CGroup.object_id, AppConstructionObject1CGroup.group_ref,
                ).where(AppConstructionObject1CGroup.object_id.in_(object_ids))).all()
            groups = {object_id: set() for object_id in object_ids}
            for object_id, group_ref in memberships:
                groups[object_id].add(group_ref)

            summaries = []
            reads = 0
            for object_id in object_ids:
                if not groups[object_id]:
                    raise RuntimeError("An active construction object has no linked directions")
                native = validate_response(service.read(object_id), groups[object_id], include_archived=False)
                archived = validate_response(
                    service.read(object_id, include_archived=True), groups[object_id], include_archived=True,
                )
                reads += 2
                if native.summary != archived.summary:
                    raise RuntimeError("Archive visibility changes the active work summary")
                for group_ref in sorted(groups[object_id]):
                    validate_response(service.read(object_id, group_ref), {group_ref}, include_archived=False)
                    validate_response(
                        service.read(object_id, group_ref, include_archived=True), {group_ref}, include_archived=True,
                    )
                    reads += 2
                summaries.append({
                    "directions": len(groups[object_id]), "active_work_items": native.summary.total,
                    "archived_work_items": len(archived.items) - len(native.items),
                    "percent": native.summary.percent,
                })
            print(json.dumps({
                "status": "passed", "revision": TARGET, "config_url_matches": True,
                "transaction_read_only": True, "writes_performed": False,
                "objects": len(object_ids), "directions": len(memberships),
                "native_responses_validated": reads, "summaries": summaries,
                "http_authentication_tested": False,
            }))
    finally:
        work_module.app_session = original_session
        engine.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({
            "status": "failed", "error_type": type(exc).__name__,
            "detail": str(exc) if type(exc) is RuntimeError else "Native read postcheck failed; no writes were performed",
        }), file=sys.stderr)
        raise SystemExit(1)
