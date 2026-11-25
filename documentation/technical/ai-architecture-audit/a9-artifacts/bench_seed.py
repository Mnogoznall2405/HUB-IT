# -*- coding: utf-8 -*-
"""Synthetic benchmark data contour (A10 cycle 2 §2).

Seeds ONLY the app-db (sqlite) side of HUB-IT — everything deterministic,
prefix "Бенч", safe to re-run (idempotent by fixed ids/codes):

  * 100 synthetic employees in the address-book JSON store (10 departments,
    phones, e-mails, rooms, positions);
  * 10 org-structure department nodes + one member node per employee;
  * AppUser accounts with distinct permission sets (REAL permission names
    from authorization_service — verified against the tools' checks);
  * 100 hub tasks (mixed statuses/assignees/due dates);
  * 20 announcements;
  * 10 KB documents (ai_kb_documents + chunks);
  * 30 my_files rows for the bench actor.

NOT seeded (external systems, documented limitation):
  * ITINVENT equipment/employees — legacy SQL Server is READ-ONLY for the
    bench (no writable test contour on 10.103.0.213; CREATE DATABASE denied;
    TEST-ITINVENT* not granted). itinvent.* scenarios use real data and are
    verified against direct SQL ground truth instead of a fixture.
  * Exchange mail, AD, 1C warehouse — external; their tools legitimately
    return errors in the contour and are measured as such.

The module expects the backend modules to be already wired to the target
DB_URL (same bootstrap as a9_real_run.py). `seed_all()` returns the ground
truth dict used by scenario generation and answer checking.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

DEPARTMENTS = [f"Бенч-Отдел-{i:02d}" for i in range(1, 11)]
POSITIONS = ["инженер", "старший инженер", "специалист", "ведущий специалист", "руководитель группы"]
BENCH_EMP_PREFIX = "Бенч Сотрудник"

# Real permission names (authorization_service.py) — the previous corpus
# used invented names like "office.read" which grant NOTHING.
PERMS_FULL = [
    "chat.read", "chat.write", "chat.ai.use",
    "database.read", "tasks.read", "tasks.create", "tasks.write", "tasks.review",
    "announcements.read", "mfu.read", "networks.read", "mail.access",
    "kb.read", "company_structure.read", "address_book.read",
    "warehouse_1c.read", "warehouse_1c.it_requests.read",
    "ad_users.read", "ad_users.manage",
    "my_files.read", "my_files.write", "tickets.read", "tickets.write",
    "docflow.read", "docflow.act", "it_objects.read", "computers.read",
    "voice.read", "statistics.read",
]
PERMS_READER = [
    "chat.read", "chat.write", "chat.ai.use",
    "database.read", "tasks.read", "announcements.read", "mfu.read",
    "kb.read", "company_structure.read", "address_book.read",
    "my_files.read",
]
PERMS_ME_ONLY = ["chat.read", "chat.write", "chat.ai.use", "my_files.read"]
PERMS_TASKS = [
    "chat.read", "chat.write", "chat.ai.use",
    "tasks.read", "tasks.create", "tasks.write", "tasks.review",
    "address_book.read", "company_structure.read",
]


def _utcnow():
    return datetime.now(timezone.utc)


def _fio(i: int) -> str:
    return f"{BENCH_EMP_PREFIX} {i:03d}"


def seed_address_book() -> list[dict]:
    """100 synthetic employees in the JSON-store address book."""
    from backend.services.address_book_service import address_book_service

    items = []
    for i in range(1, 101):
        dept = DEPARTMENTS[(i - 1) % len(DEPARTMENTS)]
        items.append({
            "employee_code": f"BENCH-{i:04d}",
            "full_name": _fio(i),
            "display_name": _fio(i),
            "position": POSITIONS[i % len(POSITIONS)],
            "department": dept,
            "department_code": f"D{(i - 1) % len(DEPARTMENTS) + 1:02d}",
            "work_phones": [f"+7-000-{i:04d}"],
            "work_emails": [f"bench{i:03d}@bench.local"],
            "office_room": f"{100 + i}",
            "hire_date": "2024-01-15",
            "workplace_number": f"WP-{i:03d}",
        })
    payload = {
        "items": items,
        "dismissed_items": [],
        "personal_by_code": {},
        "updated_at": _utcnow().isoformat(),
        "dismissed_updated_at": "",
        "last_attempt_at": "",
        "last_error": "",
    }
    address_book_service.data_manager.save_json("address_book_cache.json", payload)
    address_book_service.invalidate_parsed_cache()
    return items


def seed_org_structure(employees: list[dict]) -> list[str]:
    """10 department nodes + one member node per employee."""
    from backend.appdb.db import app_session
    from backend.appdb.models import AppOrgStructureNode

    ids = []
    with app_session() as session:
        existing = {row[0] for row in session.query(AppOrgStructureNode.id).all()}
        dept_ids = {}
        for di, dept in enumerate(DEPARTMENTS, 1):
            nid = f"bench-dept-{di:02d}"
            dept_ids[dept] = nid
            if nid not in existing:
                session.add(AppOrgStructureNode(
                    id=nid, parent_id=None, node_type="department",
                    title=dept, sort_order=di))
            ids.append(nid)
        for i, emp in enumerate(employees, 1):
            nid = f"bench-person-{i:04d}"
            if nid not in existing:
                session.add(AppOrgStructureNode(
                    id=nid, parent_id=dept_ids[emp["department"]],
                    node_type="person", title=emp["full_name"],
                    person_name=emp["full_name"],
                    person_position=emp["position"],
                    person_employee_code=emp["employee_code"],
                    sort_order=i))
            ids.append(nid)
        session.commit()
    return ids


def seed_users(user_service) -> dict:
    """Accounts with different permission sets."""
    variants = [
        ("bench_admin", PERMS_FULL),
        ("bench_reader", PERMS_READER),
        ("bench_me_only", PERMS_ME_ONLY),
        ("bench_tasks", PERMS_TASKS),
        ("bench_nomfu", [p for p in PERMS_FULL if p != "mfu.read"]),
        ("bench_actor", PERMS_FULL),
    ]
    out = {}
    for name, perms in variants:
        existing = user_service.get_by_username(name)
        if existing:
            out[name] = existing
            continue
        out[name] = user_service.create_user(
            username=name, password="bench-pass", role="viewer", auth_source="local",
            full_name=name.replace("_", " ").title(), is_active=True,
            use_custom_permissions=True, custom_permissions=perms,
        )
    return out


def seed_tasks(hub_service, users: dict, *, count: int = 100) -> list[dict]:
    """100 tasks: first 10 for bench_actor (8 open + 2 done), rest round-robin
    among the OTHER users — bench_actor must stay out of the rotation so his
    "my tasks" view is exactly the first 10 (exact-count checks)."""
    actor = users["bench_actor"]
    assignee_ids = [int(u["id"]) for name, u in users.items() if name != "bench_actor"]
    controller = users["bench_admin"]
    existing = hub_service.list_tasks(
        user_id=int(controller["id"]), scope="all", status_filter="",
        q="Бенч-задача", limit=500, allow_all_scope=True)
    existing_items = list(existing.get("items") or [])
    # Stale-detection: an older seed put bench_actor into the round-robin,
    # inflating his "my tasks" beyond the first 10. If he participates in any
    # task numbered > 10 the distribution is stale -> wipe and reseed.
    actor_id = int(actor["id"])
    actor_tasks = hub_service.list_tasks(
        user_id=actor_id, scope="my", status_filter="",
        q="Бенч-задача", limit=500, allow_all_scope=False)
    stale = int(actor_tasks.get("total") or 0) > 10
    if stale:
        for item in existing_items:
            hub_service.delete_task(
                task_id=str(item.get("id") or ""), actor_user_id=int(controller["id"]), is_admin=True)
        existing_items = []
    elif int(existing.get("total") or 0) >= count:
        return existing_items
    project_id = None
    try:
        project = hub_service.create_task_project(name="Бенч-проект", code="BENCH")
        project_id = project.get("id")
    except ValueError:
        for row in hub_service.list_task_projects(include_inactive=False):
            if row.get("name") == "Бенч-проект":
                project_id = row.get("id")
                break
    created = []
    for i in range(1, count + 1):
        if i <= 8:
            assignee, status = int(actor["id"]), ("new" if i % 2 else "in_progress")
        elif i <= 10:
            assignee, status = int(actor["id"]), "done"
        else:
            assignee = assignee_ids[i % len(assignee_ids)]
            status = ("new", "in_progress", "review", "done")[i % 4]
        due = (_utcnow() + timedelta(days=(i % 14) - 7)).isoformat()
        task = hub_service.create_task(
            title=f"Бенч-задача {i:03d}",
            description=f"Синтетическая тестовая задача {i:03d} для AI-бенчмарка.",
            assignee_user_id=assignee,
            controller_user_id=int(controller["id"]),
            due_at=due,
            project_id=project_id,
            priority=("low", "normal", "high")[i % 3],
            actor=controller,
            initial_status=status,
        )
        created.append(task)
    return created


def seed_announcements(hub_service, users: dict, *, count: int = 20) -> list[dict]:
    admin = users["bench_admin"]
    out = []
    for i in range(1, count + 1):
        try:
            out.append(hub_service.create_announcement(
                payload={
                    "title": f"Бенч-объявление {i:02d}",
                    "body": f"Синтетическое объявление {i:02d} для AI-бенчмарка.",
                    "status": "published",
                },
                actor=admin,
            ))
        except Exception:
            break
    return out


def seed_kb(*, count: int = 10) -> list[str]:
    from backend.appdb.db import app_session
    from backend.appdb.models import AppAiKbChunk, AppAiKbDocument

    ids = []
    with app_session() as session:
        existing = {row[0] for row in session.query(AppAiKbDocument.id).all()}
        for i in range(1, count + 1):
            did = f"bench-kb-{i:03d}"
            if did not in existing:
                session.add(AppAiKbDocument(
                    id=did, kb_article_id=did, status="published",
                    title=f"Бенч-инструкция {i:02d}",
                    content_hash=f"bench{i}",
                    payload_json=json.dumps({"summary": f"Синтетическая статья {i}"}, ensure_ascii=False),
                ))
                session.add(AppAiKbChunk(
                    id=f"{did}-c0", document_id=did, kb_article_id=did, chunk_index=0,
                    title=f"Бенч-инструкция {i:02d}",
                    content=f"Бенч-инструкция {i:02d}. Порядок действий: шаг 1, шаг 2, шаг 3. "
                            f"Контакт поддержки: bench-help@bench.local, доб. {7000 + i}.",
                ))
            ids.append(did)
        session.commit()
    return ids


def seed_my_files(users: dict, *, count: int = 30) -> list[str]:
    from backend.appdb.db import app_session
    from backend.appdb.models import AppMyFile

    actor = users["bench_actor"]
    ids = []
    with app_session() as session:
        existing = {row[0] for row in session.query(AppMyFile.id).all()}
        for i in range(1, count + 1):
            fid = f"bench-file-{i:03d}"
            if fid not in existing:
                session.add(AppMyFile(
                    id=fid, owner_user_id=int(actor["id"]),
                    owner_username=actor["username"],
                    uploaded_by_user_id=int(actor["id"]),
                    original_file_name=f"bench-doc-{i:03d}.txt",
                    download_file_name=f"bench-doc-{i:03d}.txt",
                    mime_type="text/plain", download_mime_type="text/plain",
                    original_size_bytes=1024 * i, stored_size_bytes=1024 * i,
                    retention_days=30, status="ready",
                    expires_at=_utcnow() + timedelta(days=30),
                    storage_mode="spool", spool_path=f"bench/{fid}.txt",
                ))
            ids.append(fid)
        session.commit()
    return ids


def seed_all(*, user_service, hub_service, task_count: int = 100) -> dict:
    """Seed the full synthetic contour; returns ground truth for checking."""
    employees = seed_address_book()
    org_ids = seed_org_structure(employees)
    users = seed_users(user_service)
    tasks = seed_tasks(hub_service, users, count=task_count)
    anns = seed_announcements(hub_service, users)
    kb_ids = seed_kb()
    file_ids = seed_my_files(users)
    truth = {
        "employees_total": len(employees),
        "departments": DEPARTMENTS,
        "employee_names": [e["full_name"] for e in employees],
        "employee_by_code": {e["employee_code"]: e for e in employees},
        "org_node_ids": org_ids,
        "users": {k: {"id": int(v["id"]), "username": v["username"]} for k, v in users.items()},
        "tasks_created": len(tasks),
        "actor_open_tasks": 8,
        "announcements": len(anns),
        "kb_docs": kb_ids,
        "my_files": file_ids,
    }
    return truth
