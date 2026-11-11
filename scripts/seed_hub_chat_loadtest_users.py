"""Create local load-test users + shared chat group for Hub/Chat session load tests."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import httpx


DEFAULT_API_BASE = "http://127.0.0.1:8001/api/v1"
DEFAULT_PASSWORD = "LoadTest!2026"
DEFAULT_PREFIX = "loadtest"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Hub+Chat load-test users and a shared group conversation.")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument(
        "--direct",
        action="store_true",
        help="Seed via backend UserService/chat_service (no admin API login; use on the app server)",
    )
    parser.add_argument("--admin-username", help="Admin username with settings.users.manage (API mode)")
    parser.add_argument("--admin-password", help="Admin password (API mode)")
    parser.add_argument("--count", type=int, default=50, help="Number of load-test users to ensure")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX, help="Username prefix, e.g. loadtest -> loadtest01")
    parser.add_argument("--password", default=DEFAULT_PASSWORD, help="Password for all load-test users")
    parser.add_argument("--role", default="viewer", choices=["viewer", "operator"], help="Role for seeded users")
    parser.add_argument(
        "--out",
        default="tmp/hub-chat-load-users.json",
        help="Output credentials JSON path",
    )
    parser.add_argument(
        "--meta-out",
        default="tmp/hub-chat-load-meta.json",
        help="Output meta JSON (user ids, conversation id)",
    )
    parser.add_argument(
        "--group-title",
        default="LoadTest Chat Room",
        help="Shared group title for all seeded users",
    )
    parser.add_argument("--skip-group", action="store_true", help="Do not create/reuse shared group conversation")
    parser.add_argument("--insecure", action="store_true", help="Disable TLS verification")
    return parser.parse_args()


def username_for(prefix: str, index: int) -> str:
    return f"{str(prefix).strip()}{index:02d}"


def login(client: httpx.Client, *, username: str, password: str) -> dict[str, Any]:
    response = client.post("/auth/login", json={"username": username, "password": password}, timeout=30.0)
    try:
        payload = response.json()
    except Exception:
        payload = None
    if response.status_code >= 400:
        detail = ""
        if isinstance(payload, dict):
            detail = str(payload.get("detail") or payload.get("status") or "")
        raise SystemExit(
            f"Login failed for {username}: HTTP {response.status_code}"
            + (f" ({detail})" if detail else f" body={response.text[:200]}")
        )
    status = str((payload or {}).get("status") or "authenticated")
    if status != "authenticated":
        raise SystemExit(
            f"Login failed for {username}: status={status}. "
            "Use a password-only local account without pending 2FA challenge."
        )
    return payload or {}


def list_users(client: httpx.Client) -> list[dict[str, Any]]:
    response = client.get("/auth/users", timeout=60.0)
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    items = (payload or {}).get("items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []


def ensure_user(
    client: httpx.Client,
    *,
    username: str,
    password: str,
    role: str,
    existing_by_username: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    current = existing_by_username.get(username.lower())
    if current:
        user_id = int(current.get("id") or 0)
        # Keep credentials usable for password-only login: reset password if endpoint allows.
        try:
            response = client.patch(
                f"/auth/users/{user_id}",
                json={
                    "password": password,
                    "is_active": True,
                    "role": role,
                    "full_name": f"Load Test {username}",
                },
                timeout=30.0,
            )
            if response.status_code < 400:
                updated = response.json()
                if isinstance(updated, dict):
                    existing_by_username[username.lower()] = updated
                    return updated
        except Exception:
            pass
        return current

    response = client.post(
        "/auth/users",
        json={
            "username": username,
            "password": password,
            "role": role,
            "auth_source": "local",
            "is_active": True,
            "full_name": f"Load Test {username}",
            "department": "LoadTest",
            "job_title": "Load Test User",
        },
        timeout=30.0,
    )
    if response.status_code >= 400:
        # Race / already exists: refresh list and return existing.
        detail = response.text[:240]
        refreshed = list_users(client)
        for item in refreshed:
            if str(item.get("username") or "").strip().lower() == username.lower():
                existing_by_username[username.lower()] = item
                return item
        raise SystemExit(f"Failed to create user {username}: HTTP {response.status_code} {detail}")
    created = response.json()
    if not isinstance(created, dict):
        raise SystemExit(f"Unexpected create user response for {username}")
    existing_by_username[username.lower()] = created
    return created


def create_shared_group(
    client: httpx.Client,
    *,
    title: str,
    member_user_ids: list[int],
) -> dict[str, Any]:
    # Prefer a fresh shared room; if API rejects large membership, fall back to notes for first user.
    response = client.post(
        "/chat/conversations/group",
        json={"title": title, "member_user_ids": member_user_ids},
        timeout=60.0,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"group create failed: HTTP {response.status_code} {response.text[:240]}")
    payload = response.json()
    if not isinstance(payload, dict) or not str(payload.get("id") or "").strip():
        raise RuntimeError("group create returned no conversation id")
    return payload


def ensure_notes(client: httpx.Client) -> dict[str, Any]:
    response = client.post("/chat/conversations/notes", timeout=30.0)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("notes create returned unexpected payload")
    return payload


def seed_direct(args: argparse.Namespace, *, count: int, out_path: Path, meta_path: Path) -> int:
    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))

    from backend.chat.service import chat_service
    from backend.services.user_service import UserService

    users_svc = UserService()
    credentials: list[dict[str, str]] = []
    seeded_users: list[dict[str, Any]] = []

    for index in range(1, count + 1):
        username = username_for(args.prefix, index)
        existing = users_svc.get_by_username(username)
        if existing:
            updated = users_svc.update_user(
                int(existing["id"]),
                password=args.password,
                is_active=True,
                role=args.role,
                auth_source="local",
                full_name=f"Load Test {username}",
                department="LoadTest",
                job_title="Load Test User",
            )
            user = updated or existing
            print(f"updated {username} id={user.get('id')}")
        else:
            user = users_svc.create_user(
                username=username,
                password=args.password,
                role=args.role,
                auth_source="local",
                is_active=True,
                full_name=f"Load Test {username}",
                department="LoadTest",
                job_title="Load Test User",
            )
            print(f"created {username} id={user.get('id')}")
        credentials.append({"username": username, "password": args.password})
        seeded_users.append(
            {
                "id": int(user.get("id") or 0),
                "username": username,
                "role": str(user.get("role") or args.role),
            }
        )

    conversation: dict[str, Any] | None = None
    if not args.skip_group and seeded_users:
        creator_id = int(seeded_users[0]["id"])
        peers = [int(item["id"]) for item in seeded_users[1:] if int(item.get("id") or 0) > 0]
        conversation = chat_service.create_group_conversation(
            current_user_id=creator_id,
            title=str(args.group_title),
            member_user_ids=peers,
        )
        print(f"created group conversation id={conversation.get('id')} title={args.group_title}")

    _write_outputs(
        args=args,
        count=count,
        credentials=credentials,
        seeded_users=seeded_users,
        conversation=conversation,
        out_path=out_path,
        meta_path=meta_path,
        seed_mode="direct_service",
    )
    return 0


def _write_outputs(
    *,
    args: argparse.Namespace,
    count: int,
    credentials: list[dict[str, str]],
    seeded_users: list[dict[str, Any]],
    conversation: dict[str, Any] | None,
    out_path: Path,
    meta_path: Path,
    seed_mode: str,
) -> None:
    out_path.write_text(json.dumps(credentials, ensure_ascii=False, indent=2), encoding="utf-8")
    meta = {
        "api_base": args.api_base,
        "count": count,
        "prefix": args.prefix,
        "role": args.role,
        "users": seeded_users,
        "conversation_id": str((conversation or {}).get("id") or ""),
        "conversation_title": str((conversation or {}).get("title") or args.group_title),
        "credentials_path": str(out_path),
        "seed_mode": seed_mode,
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote credentials: {out_path}")
    print(f"wrote meta: {meta_path}")
    if meta["conversation_id"]:
        print(f"use --conversation-id {meta['conversation_id']}")


def main() -> int:
    args = parse_args()
    count = max(1, min(500, int(args.count)))
    out_path = Path(args.out).expanduser()
    meta_path = Path(args.meta_out).expanduser()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.parent.mkdir(parents=True, exist_ok=True)

    if bool(args.direct):
        return seed_direct(args, count=count, out_path=out_path, meta_path=meta_path)

    if not args.admin_username or not args.admin_password:
        raise SystemExit("API mode requires --admin-username/--admin-password, or use --direct on the app server")

    verify: bool | httpx.SSLContext = True
    if args.insecure:
        verify = False

    with httpx.Client(base_url=str(args.api_base).rstrip("/"), verify=verify, follow_redirects=True) as admin_client:
        login(admin_client, username=args.admin_username, password=args.admin_password)
        existing_users = list_users(admin_client)
        existing_by_username = {
            str(item.get("username") or "").strip().lower(): item
            for item in existing_users
            if str(item.get("username") or "").strip()
        }

        credentials: list[dict[str, str]] = []
        seeded_users: list[dict[str, Any]] = []
        for index in range(1, count + 1):
            username = username_for(args.prefix, index)
            user = ensure_user(
                admin_client,
                username=username,
                password=args.password,
                role=args.role,
                existing_by_username=existing_by_username,
            )
            credentials.append({"username": username, "password": args.password})
            seeded_users.append(
                {
                    "id": int(user.get("id") or 0),
                    "username": username,
                    "role": str(user.get("role") or args.role),
                }
            )
            print(f"ensured user {username} id={user.get('id')}")

    conversation: dict[str, Any] | None = None
    if not args.skip_group and seeded_users:
        first = credentials[0]
        member_ids = [int(item["id"]) for item in seeded_users if int(item.get("id") or 0) > 0]
        with httpx.Client(base_url=str(args.api_base).rstrip("/"), verify=verify, follow_redirects=True) as user_client:
            login(
                user_client,
                username=first["username"],
                password=first["password"],
            )
            # Internal zone header helps password-only login when TWOFA_POLICY=external_only.
            user_client.headers["X-Forwarded-For"] = "10.10.20.50"
            user_client.headers["X-Auth-Client"] = "mobile"
            try:
                creator_id = int(seeded_users[0]["id"])
                peers = [user_id for user_id in member_ids if user_id != creator_id]
                conversation = create_shared_group(
                    user_client,
                    title=str(args.group_title),
                    member_user_ids=peers,
                )
                print(f"created group conversation id={conversation.get('id')} title={args.group_title}")
            except Exception as exc:
                print(f"WARN: shared group create failed ({exc}); falling back to notes conversation", file=sys.stderr)
                conversation = ensure_notes(user_client)
                print(f"created notes conversation id={conversation.get('id')}")

    _write_outputs(
        args=args,
        count=count,
        credentials=credentials,
        seeded_users=seeded_users,
        conversation=conversation,
        out_path=out_path,
        meta_path=meta_path,
        seed_mode="admin_api",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
