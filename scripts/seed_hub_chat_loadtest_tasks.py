"""Seed Hub tasks for load-test users so dashboard/tasks endpoints load real data."""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DEFAULT_PREFIX = "loadtest"
DEFAULT_META = "tmp/hub-chat-load-meta.json"
TITLE_PREFIX = "LoadTest "


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Hub tasks for load-test users.")
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Seed via hub_service (required; run on the app server)",
    )
    parser.add_argument("--meta", default=DEFAULT_META, help="Path to hub-chat-load-meta.json")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX, help="Username prefix when meta has no users")
    parser.add_argument("--count", type=int, default=0, help="Limit users (0 = all from meta/prefix)")
    parser.add_argument("--tasks-per-user", type=int, default=10, help="Tasks to ensure per user")
    parser.add_argument(
        "--replace",
        action="store_true",
        help=f"Delete existing tasks with title prefix '{TITLE_PREFIX}' before seeding",
    )
    parser.add_argument(
        "--with-comments",
        action="store_true",
        default=True,
        help="Add peer comments on some open tasks (default: on)",
    )
    parser.add_argument(
        "--no-comments",
        action="store_false",
        dest="with_comments",
        help="Skip comment seeding",
    )
    return parser.parse_args()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_users_from_meta(meta_path: Path, *, count: int) -> list[dict[str, Any]]:
    payload = json.loads(meta_path.read_text(encoding="utf-8"))
    users = payload.get("users") if isinstance(payload, dict) else None
    if not isinstance(users, list) or not users:
        raise SystemExit(f"No users in meta file: {meta_path}")
    cleaned: list[dict[str, Any]] = []
    for item in users:
        if not isinstance(item, dict):
            continue
        user_id = int(item.get("id") or 0)
        username = str(item.get("username") or "").strip()
        if user_id <= 0 or not username:
            continue
        cleaned.append({"id": user_id, "username": username, "role": str(item.get("role") or "viewer")})
    if count > 0:
        cleaned = cleaned[:count]
    if not cleaned:
        raise SystemExit(f"No valid users in meta file: {meta_path}")
    return cleaned


def resolve_users(*, meta: str, prefix: str, count: int, user_service: Any) -> list[dict[str, Any]]:
    meta_path = Path(meta).expanduser()
    if meta_path.exists():
        return load_users_from_meta(meta_path, count=count)
    max_count = max(1, int(count or 50))
    found: list[dict[str, Any]] = []
    for index in range(1, max_count + 1):
        username = f"{str(prefix).strip()}{index:02d}"
        user = user_service.get_by_username(username)
        if not user:
            continue
        found.append(
            {
                "id": int(user.get("id") or 0),
                "username": username,
                "role": str(user.get("role") or "viewer"),
            }
        )
    if not found:
        raise SystemExit("No load-test users found; run seed_hub_chat_loadtest_users.py first")
    return found


def delete_loadtest_tasks(hub_service: Any) -> int:
    deleted = 0
    with hub_service._lock, hub_service._connect() as conn:
        rows = conn.execute(
            f"""
            SELECT id
            FROM {hub_service._TASKS_TABLE}
            WHERE title LIKE ?
            """,
            (f"{TITLE_PREFIX}%",),
        ).fetchall()
        task_ids = [str(row["id"] if hasattr(row, "keys") else row[0]) for row in rows]
    for task_id in task_ids:
        try:
            if hub_service.delete_task(task_id=task_id, actor_user_id=0, is_admin=True):
                deleted += 1
        except Exception as exc:  # noqa: BLE001
            print(f"WARN: failed to delete task {task_id}: {exc}", file=sys.stderr)
    return deleted


def ensure_project_id(hub_service: Any) -> str:
    with hub_service._lock, hub_service._connect() as conn:
        hub_service._ensure_default_task_project(conn)
        conn.commit()
    projects = hub_service.list_task_projects(include_inactive=False)
    for item in projects:
        project_id = str((item or {}).get("id") or "").strip()
        if project_id:
            return project_id
    return str(hub_service._DEFAULT_TASK_PROJECT_ID)


def task_specs_for_user(
    *,
    user_index: int,
    user: dict[str, Any],
    peers: list[dict[str, Any]],
    tasks_per_user: int,
) -> list[dict[str, Any]]:
    """Build varied task payloads where `user` is a participant (assignee and/or creator)."""
    if not peers:
        peers = [user]
    now = _utc_now()
    specs: list[dict[str, Any]] = []
    statuses_cycle = ["new", "in_progress", "review", "new", "in_progress", "done", "new", "review", "in_progress", "done"]
    priorities_cycle = ["normal", "high", "urgent", "low", "normal", "high", "normal", "urgent", "low", "normal"]
    for slot in range(max(1, int(tasks_per_user))):
        peer = peers[(user_index + slot) % len(peers)]
        status = statuses_cycle[slot % len(statuses_cycle)]
        priority = priorities_cycle[slot % len(priorities_cycle)]
        # Alternate: user is assignee (created by peer) vs user is creator (assigned to peer).
        if slot % 2 == 0:
            creator = peer
            assignee = user
            role_tag = "assignee"
        else:
            creator = user
            assignee = peer
            role_tag = "creator"
        if status == "done":
            due_at = _iso(now - timedelta(days=2 + (slot % 5)))
        elif slot % 5 == 0:
            due_at = _iso(now - timedelta(hours=6 + slot))  # overdue open
        else:
            due_at = _iso(now + timedelta(days=1 + (slot % 7), hours=slot % 5))
        observer = peers[(user_index + slot + 3) % len(peers)]
        observer_ids = []
        if observer["id"] not in {int(creator["id"]), int(assignee["id"])}:
            observer_ids = [int(observer["id"])]
        title = (
            f"{TITLE_PREFIX}{user['username']} #{slot + 1:02d} "
            f"{role_tag} {status} p={priority}"
        )
        specs.append(
            {
                "title": title,
                "description": (
                    f"Load-test task for {user['username']} "
                    f"(creator={creator['username']}, assignee={assignee['username']}, status={status})."
                ),
                "creator": creator,
                "assignee_user_id": int(assignee["id"]),
                "status": status,
                "priority": priority,
                "due_at": due_at,
                "observer_user_ids": observer_ids,
                "checklist_items": [
                    {"text": "Проверить входные данные", "done": status == "done"},
                    {"text": "Обновить статус", "done": status in {"review", "done"}},
                ],
            }
        )
    return specs


def seed_direct(args: argparse.Namespace) -> int:
    if not bool(args.direct):
        raise SystemExit("Use --direct on the app server (hub_service seed)")

    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))

    from backend.services.hub_service import hub_service
    from backend.services.user_service import UserService

    users_svc = UserService()
    users = resolve_users(meta=args.meta, prefix=args.prefix, count=int(args.count or 0), user_service=users_svc)
    project_id = ensure_project_id(hub_service)
    print(f"users={len(users)} project_id={project_id} tasks_per_user={args.tasks_per_user}")

    if bool(args.replace):
        deleted = delete_loadtest_tasks(hub_service)
        print(f"deleted previous loadtest tasks: {deleted}")

    created = 0
    commented = 0
    failures = 0
    for user_index, user in enumerate(users):
        peers = [item for item in users if int(item["id"]) != int(user["id"])] or [user]
        specs = task_specs_for_user(
            user_index=user_index,
            user=user,
            peers=peers,
            tasks_per_user=int(args.tasks_per_user),
        )
        for spec in specs:
            creator = users_svc.get_by_id(int(spec["creator"]["id"])) or spec["creator"]
            try:
                task = hub_service.create_task(
                    title=spec["title"],
                    description=spec["description"],
                    assignee_user_id=int(spec["assignee_user_id"]),
                    controller_user_id=0,
                    due_at=spec["due_at"],
                    project_id=project_id,
                    priority=spec["priority"],
                    checklist_items=spec["checklist_items"],
                    observer_user_ids=spec["observer_user_ids"],
                    actor=creator,
                    initial_status=spec["status"],
                )
                created += 1
                task_id = str((task or {}).get("id") or "").strip()
                if bool(args.with_comments) and task_id and spec["status"] != "done" and (user_index + created) % 3 == 0:
                    commenter = users_svc.get_by_id(int(peers[user_index % len(peers)]["id"])) or peers[0]
                    try:
                        from backend.chat.task_discussion import is_task_discussion_chat_enabled

                        if is_task_discussion_chat_enabled():
                            # Legacy task comments are disabled when discussion chat is on.
                            pass
                        else:
                            hub_service.add_task_comment(
                                task_id=task_id,
                                user=commenter,
                                body=f"LoadTest comment from {commenter.get('username')}: нужно ускорить проверку.",
                            )
                            commented += 1
                    except Exception as exc:  # noqa: BLE001
                        # Keep task seed successful even if comments are unavailable.
                        if "use_task_discussion_chat" not in str(exc):
                            print(f"WARN: comment skipped for {task_id}: {exc}", file=sys.stderr)
            except Exception as exc:  # noqa: BLE001
                failures += 1
                print(
                    f"ERROR: task for {user['username']} title={spec['title']!r}: {exc}",
                    file=sys.stderr,
                )

    try:
        hub_service._invalidate_unread_counts_cache()
        hub_service._invalidate_dashboard_cache()
    except Exception:
        pass

    # Smoke: first user should see non-empty my tasks.
    sample_user = users[0]
    sample = hub_service.list_tasks(
        user_id=int(sample_user["id"]),
        scope="my",
        role_scope="both",
        status_filter="",
        limit=20,
        offset=0,
        allow_all_scope=False,
    )
    sample_total = int(sample.get("total") or 0)
    print(
        f"done created={created} comments={commented} failures={failures} "
        f"sample_user={sample_user['username']} my_tasks_total={sample_total}"
    )
    if sample_total <= 0:
        raise SystemExit("Seed finished but sample user still has 0 tasks")
    return 0 if failures == 0 else 2


def main() -> int:
    args = parse_args()
    return seed_direct(args)


if __name__ == "__main__":
    raise SystemExit(main())
