# -*- coding: utf-8 -*-
"""Synthetic benchmark data contour (A10 cycle 2 §2).

Seeds ONLY the app-db (sqlite) side of HUB-IT — everything deterministic,
prefix "Бенч", safe to re-run (idempotent by fixed ids/codes):

  * 100 synthetic employees in the address-book JSON store (10 departments,
    phones, e-mails, rooms, positions);
  * 10 org-structure department nodes + one member node per employee;
  * AppUser accounts with distinct permission sets (REAL permission names
    from authorization_service — verified against the tools' checks);
  * portal AppUser accounts for the FIRST 10 bench employees
    (bench_emp001..010, full_name exactly "Бенч Сотрудник NNN") — without them
    task-assignee/chat-peer/mail-contact resolution has nothing to find,
    because every resolve path reads the portal user directory, not the
    address book (A11 cycle-3 act-triage);
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
# Portal accounts of the bench employees themselves: enough to be task
# assignees, chat peers and mail contacts — a plausible regular portal user.
PERMS_EMPLOYEE = [
    "chat.read", "chat.write", "chat.ai.use",
    "tasks.read", "tasks.write",
    "announcements.read", "kb.read",
    "company_structure.read", "address_book.read",
    "my_files.read",
]
# Only the first N address-book employees get portal accounts: the contour
# mirrors production, where most directory people are NOT portal users.
BENCH_EMPLOYEE_USER_COUNT = 10


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
            # a11-final (act_07): the first member of each department heads it —
            # role recipients resolve via directory positions (the authoritative
            # source per the product data model; org nodes never carry dept heads).
            "position": "руководитель отдела" if i <= len(DEPARTMENTS) else POSITIONS[i % len(POSITIONS)],
            "department": dept,
            "department_code": f"D{(i - 1) % len(DEPARTMENTS) + 1:02d}",
            # production shape: contacts are dicts — the search index drops
            # plain strings (cpx_10: phone lookup never matched).
            "work_phones": [{"value": f"+7-000-{i:04d}", "kind": "рабочий"}],
            "work_emails": [{"value": f"bench{i:03d}@bench.local", "kind": "рабочий"}],
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
        existing = {row[0]: row for row in session.query(AppOrgStructureNode).all()}
        # a11-final (act_07): department nodes must carry their head in the
        # person_* fields — directory.department.get reads head_name from there.
        # Without it role-based recipients ("руководителю отдела X") can never
        # resolve and the correct behavior degrades to a clarification.
        first_by_dept: dict[str, dict] = {}
        for emp in employees:
            first_by_dept.setdefault(emp["department"], emp)
        dept_ids = {}
        for di, dept in enumerate(DEPARTMENTS, 1):
            nid = f"bench-dept-{di:02d}"
            dept_ids[dept] = nid
            head = first_by_dept.get(dept) or {}
            head_name = head.get("full_name") or ""
            head_code = head.get("employee_code") or None
            if nid not in existing:
                session.add(AppOrgStructureNode(
                    id=nid, parent_id=None, node_type="department",
                    title=dept, sort_order=di,
                    person_name=head_name,
                    person_position="руководитель отдела" if head_name else "",
                    person_employee_code=head_code))
            else:
                row = existing[nid]
                if head_name and not (row.person_name or ""):
                    row.person_name = head_name
                    row.person_position = "руководитель отдела"
                    row.person_employee_code = head_code
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


def seed_employee_users(user_service, employees: list[dict], *, count: int = BENCH_EMPLOYEE_USER_COUNT) -> dict:
    """Portal AppUser accounts for the first `count` bench employees.

    A11 cycle-3: act_02/act_08 traces showed that task-assignee, chat-peer and
    mail-contact resolution all read the PORTAL user directory (user_service),
    while bench employees existed only in the address-book JSON — so every
    resolve path came back empty even though directory.people.search found them.

    Account fields deliberately mirror the address-book row, which is the only
    available link between the two directories (AppUser has no employee_code):
    same full_name ("Бенч Сотрудник NNN"), same first work email, same
    department name, position as job_title. Idempotent: existing accounts are
    repaired to the expected shape instead of duplicated.
    """
    out = {}
    for i, emp in enumerate(employees[:count], 1):
        username = f"bench_emp{i:03d}"
        full_name = str(emp.get("full_name") or _fio(i))
        emails = [str(x.get("value") if isinstance(x, dict) else x).strip() for x in list(emp.get("work_emails") or []) if str(x or "").strip()]
        email = emails[0] if emails else f"bench{i:03d}@bench.local"
        department = str(emp.get("department") or "").strip() or None
        job_title = str(emp.get("position") or "").strip() or None
        existing = user_service.get_by_username(username)
        if existing:
            repair: dict = {}
            if str(existing.get("full_name") or "") != full_name:
                repair["full_name"] = full_name
            if str(existing.get("email") or "") != email:
                repair["email"] = email
            if str(existing.get("department") or "") != str(department or ""):
                repair["department"] = department
            if str(existing.get("job_title") or "") != str(job_title or ""):
                repair["job_title"] = job_title
            if not bool(existing.get("is_active", True)):
                repair["is_active"] = True
            if not bool(existing.get("use_custom_permissions")):
                repair["use_custom_permissions"] = True
                repair["custom_permissions"] = PERMS_EMPLOYEE
            if repair:
                user_service.update_user(int(existing["id"]), **repair)
                existing = user_service.get_by_username(username) or existing
            out[username] = existing
            continue
        out[username] = user_service.create_user(
            username=username, password="bench-pass", role="viewer", auth_source="local",
            full_name=full_name, email=email,
            department=department, job_title=job_title,
            is_active=True, use_custom_permissions=True, custom_permissions=PERMS_EMPLOYEE,
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


# --- A11: topical KB articles in the REAL kb_service store -------------------
# kb.articles.search reads kb_articles.json via JSONDataManager (app-db backed
# in the bench contour), NOT the AppAiKbDocument index tables — seeding only
# the index used to make kb scenarios unverifiable. Each article carries
# distinctive facts for exact answer checking.
KB_ARTICLES = [
    {
        "code": "vpn", "title": "Настройка VPN для удалённой работы",
        "category": "сеть", "tags": ["vpn", "удалённая работа", "сеть"],
        "summary": "Пошаговая настройка VPN-подключения для работы из дома.",
        "body": ("Установите клиент BenchVPN 4.2 с портала. Сервер: vpn.bench.local, порт 1443. "
                 "Логин — доменная учётная запись. После подключения проверьте доступ к portal.bench.local. "
                 "При ошибке 809 перезагрузите клиент и повторите. Поддержка: доб. 7101."),
        "facts": ["vpn.bench.local", "1443", "7101"],
    },
    {
        "code": "password", "title": "Сброс пароля учётной записи",
        "category": "учётные записи", "tags": ["пароль", "доступ", "учётная запись"],
        "summary": "Самостоятельный сброс пароля и разблокировка учётной записи.",
        "body": ("Пароль меняется через портал selfservice.bench.local раз в 90 дней. "
                 "Минимальная длина — 12 символов. При блокировке после 5 неверных попыток "
                 "подождите 15 минут или позвоните на доб. 7102. Не передавайте пароль коллегам."),
        "facts": ["selfservice.bench.local", "90", "7102"],
    },
    {
        "code": "cartridge", "title": "Замена картриджа в МФУ",
        "category": "оргтехника", "tags": ["мфу", "картридж", "печать"],
        "summary": "Порядок замены картриджа и запроса нового через склад.",
        "body": ("Картридж меняется при остатке тонера ниже 10%. Извлеките старый картридж, "
                 "встряхните новый 5 раз, снимите защитную ленту. Старый картридж сдайте на склад "
                 "в кабинет 105. Запрос нового — через заявку на складе, срок поставки 3 дня. "
                 "Вопросы: доб. 7103."),
        "facts": ["10%", "105", "7103"],
    },
    {
        "code": "vacation", "title": "Как оформить отпуск",
        "category": "кадры", "tags": ["отпуск", "кадры", "заявление"],
        "summary": "Порядок согласования и оформления ежегодного отпуска.",
        "body": ("Заявление подаётся за 14 дней до начала отпуска через кадровую систему. "
                 "Согласование: руководитель, затем отдел кадров (кабинет 208). "
                 "Отпускные выплачиваются за 3 дня до начала. Контакт кадров: доб. 7104."),
        "facts": ["14", "208", "7104"],
    },
    {
        "code": "newcomer", "title": "Выдача оборудования новому сотруднику",
        "category": "it", "tags": ["оборудование", "новый сотрудник", "onboarding"],
        "summary": "Что выдаётся новому сотруднику в первый рабочий день.",
        "body": ("Стандартный комплект: ноутбук BenchBook Pro, монитор 24\", гарнитура. "
                 "Заявку создаёт руководитель за 5 рабочих дней до выхода. "
                 "Выдача — кабинет 110, с 9:00 до 17:00. Контакт: доб. 7105."),
        "facts": ["BenchBook Pro", "110", "7105"],
    },
    {
        "code": "mailquota", "title": "Увеличение квоты почтового ящика",
        "category": "почта", "tags": ["почта", "квота", "ящик"],
        "summary": "Стандартная квота и порядок её увеличения.",
        "body": ("Стандартная квота ящика — 2048 МБ. При заполнении свыше 90% приходит "
                 "предупреждение. Увеличение до 4096 МБ — по заявке руководителя, срок 1 день. "
                 "Архив старых писем хранится 2 года. Вопросы: доб. 7106."),
        "facts": ["2048", "4096", "7106"],
    },
    {
        "code": "wifi", "title": "Подключение к корпоративному Wi-Fi",
        "category": "сеть", "tags": ["wifi", "сеть", "подключение"],
        "summary": "Сети BENCH-CORP и BENCH-GUEST, сертификаты доступа.",
        "body": ("Рабочая сеть — BENCH-CORP, вход по доменной учётной записи. "
                 "Гостевая — BENCH-GUEST, пароль меняется каждый месяц, узнать можно на ресепшн. "
                 "Сертификат обновляется автоматически. Проблемы: доб. 7107."),
        "facts": ["BENCH-CORP", "BENCH-GUEST", "7107"],
    },
    {
        "code": "laptoprepair", "title": "Ремонт ноутбука",
        "category": "it", "tags": ["ремонт", "ноутбук", "сервис"],
        "summary": "Куда сдавать ноутбук в ремонт и что получить на замену.",
        "body": ("Неисправный ноутбук сдаётся в кабинет 110 с актом приёма-передачи. "
                 "На время ремонта выдаётся подменный BenchBook Air. "
                 "Срок типового ремонта — 5 рабочих дней. Данные с диска не гарантируются — "
                 "храните файлы в сетевой папке. Вопросы: доб. 7108."),
        "facts": ["BenchBook Air", "5", "7108"],
    },
]


def seed_kb_articles() -> list[dict]:
    """Publish the topical articles into the REAL kb_service store so
    kb.articles.search can actually find them (idempotent by title)."""
    from backend.services.kb_service import kb_service

    rows = kb_service.data_manager.load_json("kb_articles.json", default_content=[])
    if not isinstance(rows, list):
        rows = []
    existing_titles = {str(r.get("title") or "") for r in rows if isinstance(r, dict)}
    now = _utcnow().isoformat()
    out = []
    for spec in KB_ARTICLES:
        title = f"Бенч-KB: {spec['title']}"
        if title in existing_titles:
            row = next(r for r in rows if r.get("title") == title)
        else:
            row = {
                "id": f"bench-kba-{spec['code']}",
                "title": title,
                "category": spec["category"],
                "article_type": "runbook",
                "status": "published",
                "summary": spec["summary"],
                "tags": list(spec["tags"]),
                "owner_user_id": None,
                "owner_name": "bench",
                "department_id": None,
                "visibility_scope": "global",
                "version": 1,
                "created_at": now,
                "updated_at": now,
                "created_by": "bench",
                "updated_by": "bench",
                "content": {"overview": spec["body"], "resolution_steps": [spec["body"]]},
                "primary_attachment_id": None,
                "attachments": [],
                "revisions": [],
            }
            rows.append(row)
        out.append({"id": row["id"], "title": title, "facts": spec["facts"], "code": spec["code"]})
    kb_service.data_manager.save_json("kb_articles.json", rows)
    return out


# Announcement titles deliberately overlapping KB topics — routing must pick
# the authoritative source (KB for how-to, announcements for news/events).
TRAP_ANNOUNCEMENTS = [
    ("Плановые работы VPN в субботу", "В субботу с 02:00 до 06:00 VPN будет недоступен — плановое обновление сервера."),
    ("Замена картриджей в бухгалтерии", "В четверг техник обойдёт бухгалтерию для плановой замены картриджей."),
    ("Новые правила отпусков с марта", "С марта заявление на отпуск подаётся за 21 день вместо 14."),
]


def seed_trap_announcements(hub_service, users: dict) -> list[dict]:
    admin = users["bench_admin"]
    out = []
    existing_titles = set()
    try:
        for row in hub_service.list_announcements(user_id=int(admin["id"]), limit=200).get("items") or []:
            existing_titles.add(str(row.get("title") or ""))
    except Exception:
        pass
    for i, (title, body) in enumerate(TRAP_ANNOUNCEMENTS, 1):
        full_title = f"Бенч-объявление: {title}"
        if full_title in existing_titles:
            continue
        try:
            out.append(hub_service.create_announcement(
                payload={"title": full_title, "body": body, "status": "published"},
                actor=admin,
            ))
        except Exception:
            break
    return out


# Natural file names for realistic "find my file" queries.
SPECIAL_FILES = [
    "акт-приёма-передачи-ноутбука.txt",
    "отчёт-за-май.txt",
    "договор-поставки-2024.txt",
    "презентация-проекта.txt",
    "акт-сверки.txt",
]


def seed_special_files(users: dict) -> list[dict]:
    from backend.appdb.db import app_session
    from backend.appdb.models import AppMyFile

    actor = users["bench_actor"]
    out = []
    with app_session() as session:
        existing = {
            row[0]
            for row in session.query(AppMyFile.original_file_name).all()
        }
        for i, name in enumerate(SPECIAL_FILES, 1):
            fid = f"bench-special-{i:03d}"
            if name in existing:
                continue
            session.add(AppMyFile(
                id=fid, owner_user_id=int(actor["id"]),
                owner_username=actor["username"],
                uploaded_by_user_id=int(actor["id"]),
                original_file_name=name,
                download_file_name=name,
                mime_type="text/plain", download_mime_type="text/plain",
                original_size_bytes=2048 * i, stored_size_bytes=2048 * i,
                retention_days=30, status="ready",
                expires_at=_utcnow() + timedelta(days=30),
                storage_mode="spool", spool_path=f"bench/{fid}.txt",
            ))
            out.append({"id": fid, "name": name})
        session.commit()
    return out


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


def _invalidate_user_directory_caches(contour_user_service) -> None:
    """Drop stale user-directory caches after seeding.

    The resolution paths (hub_service.list_assignees, tools/chat.py,
    action_cards) read the MODULE-LEVEL user_service singleton, not the
    contour instance the harness seeds through. Both point at the same bench
    DB, but the singleton caches list_users for 60s and hub_service caches the
    assignee directory for 300s — without invalidation early scenarios could
    resolve against pre-seed data. Best-effort: cache internals are a
    implementation detail, never fatal for seeding.
    """
    try:
        from backend.services.user_service import user_service as singleton_user_service

        for service in {id(contour_user_service): contour_user_service, id(singleton_user_service): singleton_user_service}.values():
            invalidate = getattr(service, "_invalidate_users_cache", None)
            if callable(invalidate):
                invalidate()
    except Exception:
        pass
    try:
        from backend.services.hub_service import hub_service as singleton_hub_service

        with singleton_hub_service._user_directory_cache_lock:
            singleton_hub_service._user_directory_cache.clear()
    except Exception:
        pass


def seed_all(*, user_service, hub_service, task_count: int = 100) -> dict:
    """Seed the full synthetic contour; returns ground truth for checking."""
    employees = seed_address_book()
    org_ids = seed_org_structure(employees)
    users = seed_users(user_service)
    # Portal accounts for the first bench employees — deliberately NOT merged
    # into `users`: the task round-robin distribution and the harness bot-access
    # grants must stay exactly as before.
    employee_users = seed_employee_users(user_service, employees)
    _invalidate_user_directory_caches(user_service)
    tasks = seed_tasks(hub_service, users, count=task_count)
    anns = seed_announcements(hub_service, users)
    kb_ids = seed_kb()
    kb_articles = seed_kb_articles()
    trap_anns = seed_trap_announcements(hub_service, users)
    file_ids = seed_my_files(users)
    special_files = seed_special_files(users)
    truth = {
        "employees_total": len(employees),
        "departments": DEPARTMENTS,
        "employee_names": [e["full_name"] for e in employees],
        "employee_by_code": {e["employee_code"]: e for e in employees},
        "employees": employees,
        "org_node_ids": org_ids,
        "users": {k: {"id": int(v["id"]), "username": v["username"]} for k, v in users.items()},
        "employee_users": {
            k: {"id": int(v["id"]), "username": v["username"], "full_name": v.get("full_name")}
            for k, v in employee_users.items()
        },
        "tasks_created": len(tasks),
        "actor_open_tasks": 8,
        "announcements": len(anns),
        "kb_docs": kb_ids,
        "kb_articles": kb_articles,
        "trap_announcements": len(trap_anns),
        "my_files": file_ids,
        "special_files": special_files,
    }
    return truth
