"""Remove only users, tasks, and conversations recorded by a Hub/Chat load-test meta file."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cleanup seeded Hub/Chat load-test data.")
    parser.add_argument("--meta", required=True, help="Seed meta JSON produced by seed_hub_chat_loadtest_users.py")
    parser.add_argument("--execute", action="store_true", help="Apply deletions (default is dry-run)")
    return parser.parse_args()


def load_targets(path: Path) -> tuple[str, list[dict[str, Any]], list[tuple[str, int]]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise SystemExit("Meta file must contain a JSON object")
    prefix = str(payload.get("prefix") or "").strip()
    if len(prefix) < 6:
        raise SystemExit("Refusing cleanup: meta prefix must be at least 6 characters")
    users = [item for item in payload.get("users") or [] if isinstance(item, dict)]
    if not users:
        raise SystemExit("Refusing cleanup: meta has no users")
    for user in users:
        username = str(user.get("username") or "").strip()
        if not username.startswith(prefix) or int(user.get("id") or 0) <= 1:
            raise SystemExit(f"Refusing cleanup: unsafe user target {username!r}")

    first_user_id = int(users[0]["id"])
    conversations: dict[str, int] = {}
    root_conversation_id = str(payload.get("conversation_id") or "").strip()
    if root_conversation_id:
        conversations[root_conversation_id] = first_user_id
    for pair in payload.get("dm_pairs") or []:
        if not isinstance(pair, dict):
            continue
        conversation_id = str(pair.get("conversation_id") or "").strip()
        actor_id = int(pair.get("user_a_id") or 0)
        if conversation_id and actor_id > 1:
            conversations[conversation_id] = actor_id
    user_ids = {str(user.get("username") or "").strip(): int(user.get("id") or 0) for user in users}
    group_by_username = payload.get("group_by_username") or {}
    if isinstance(group_by_username, dict):
        for username, conversation_id_value in group_by_username.items():
            conversation_id = str(conversation_id_value or "").strip()
            actor_id = int(user_ids.get(str(username).strip()) or 0)
            if conversation_id and actor_id > 1:
                conversations.setdefault(conversation_id, actor_id)
    return prefix, users, sorted(conversations.items())


def main() -> int:
    args = parse_args()
    meta_path = Path(args.meta).expanduser().resolve()
    if not meta_path.exists():
        raise SystemExit(f"Meta file not found: {meta_path}")
    prefix, users, conversations = load_targets(meta_path)
    print(f"prefix={prefix} users={len(users)} conversations={len(conversations)} execute={bool(args.execute)}")
    if not args.execute:
        return 0

    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))

    from backend.chat.service import chat_service
    from backend.services.hub_service import hub_service
    from backend.services.session_auth_context_service import session_auth_context_service
    from backend.services.session_service import session_service
    from backend.services.user_service import UserService

    usernames = {str(user["username"]) for user in users}
    user_ids = {int(user["id"]) for user in users}

    # Revoke authentication before deleting users.  Test users may already be
    # gone after a previous cleanup run, while their sessions remain valid.
    session_rows = session_service.list_sessions_by_user_ids(user_ids)
    active_before = [item for item in session_rows if str(item.get("status") or "") == "active"]
    for user_id in user_ids:
        session_service.close_user_sessions(user_id)
    for item in session_rows:
        session_id = str(item.get("session_id") or "").strip()
        if session_id:
            session_auth_context_service.delete_session_context(session_id)
    remaining_active_sessions = session_service.list_sessions_by_user_ids(user_ids, active_only=True)

    task_targets: list[str] = []
    offset = 0
    while True:
        page = hub_service.list_tasks(
            user_id=1,
            scope="all",
            q="LoadTest",
            limit=500,
            offset=offset,
            allow_all_scope=True,
        )
        items = list(page.get("items") or [])
        for item in items:
            title = str(item.get("title") or "")
            if any(
                title.startswith(f"LoadTest {username} #")
                or title.startswith(f"LoadTestPerf {username} ")
                for username in usernames
            ):
                task_id = str(item.get("id") or "").strip()
                if task_id:
                    task_targets.append(task_id)
        offset += len(items)
        if not items or offset >= int(page.get("total") or 0):
            break

    deleted_tasks = 0
    for task_id in task_targets:
        if hub_service.delete_task(task_id=task_id, actor_user_id=1, is_admin=True):
            deleted_tasks += 1

    deleted_conversations = 0
    for conversation_id, actor_id in conversations:
        try:
            chat_service.delete_conversation(
                current_user_id=int(actor_id),
                conversation_id=conversation_id,
            )
            deleted_conversations += 1
        except LookupError:
            pass
        except Exception as exc:  # noqa: BLE001
            print(f"WARN conversation cleanup failed id={conversation_id}: {exc}", file=sys.stderr)

    users_svc = UserService()
    deleted_users = 0
    for user in users:
        user_id = int(user["id"])
        username = str(user["username"])
        current = users_svc.get_by_username(username)
        if current is None:
            continue
        if int(current.get("id") or 0) != user_id:
            raise RuntimeError(f"User id changed for {username}; refusing deletion")
        if users_svc.delete_user(user_id):
            deleted_users += 1

    remaining = [
        str(user["username"])
        for user in users
        if users_svc.get_by_username(str(user["username"])) is not None
    ]
    print(
        f"closed_active_sessions={len(active_before)} remaining_active_sessions={len(remaining_active_sessions)} "
        f"deleted_tasks={deleted_tasks} deleted_conversations={deleted_conversations} deleted_users={deleted_users} "
        f"remaining_users={len(remaining)}"
    )
    if remaining or remaining_active_sessions:
        if remaining_active_sessions:
            print(
                "remaining_active_session_ids="
                + ",".join(str(item.get("session_id") or "") for item in remaining_active_sessions),
                file=sys.stderr,
            )
        if remaining:
            print("remaining=" + ",".join(remaining), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
