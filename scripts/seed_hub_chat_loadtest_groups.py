"""Create N small group chats for distributed load tests (scenario B/C)."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--meta-file", default="tmp/hub-chat-load-meta.json")
    parser.add_argument("--groups", type=int, default=10)
    parser.add_argument("--members-per-group", type=int, default=5)
    parser.add_argument("--title-prefix", default="LoadTest Shard")
    parser.add_argument("--out-meta", default="tmp/hub-chat-load-meta-sharded.json")
    args = parser.parse_args()

    meta_path = PROJECT_ROOT / args.meta_file
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    users = list(meta.get("users") or [])
    if len(users) < args.groups * args.members_per_group:
        raise SystemExit(
            f"need at least {args.groups * args.members_per_group} users, have {len(users)}"
        )

    from backend.chat.service import chat_service

    chat_service.initialize_runtime()
    group_ids: list[str] = []
    membership: list[dict] = []
    for g in range(args.groups):
        start = g * args.members_per_group
        chunk = users[start : start + args.members_per_group]
        owner_id = int(chunk[0]["id"])
        member_ids = [int(u["id"]) for u in chunk[1:]]
        title = f"{args.title_prefix} {g + 1:02d}"
        conversation = chat_service.create_group_conversation(
            current_user_id=owner_id,
            title=title,
            member_user_ids=member_ids,
        )
        cid = str(conversation.get("id") or "").strip()
        if not cid:
            raise RuntimeError(f"group {g} create returned no id")
        group_ids.append(cid)
        membership.append(
            {
                "conversation_id": cid,
                "title": title,
                "owner_id": owner_id,
                "member_ids": [owner_id, *member_ids],
                "usernames": [str(u.get("username") or "") for u in chunk],
            }
        )
        print(f"created {title} id={cid} members={len(chunk)}")

    out = dict(meta)
    out["group_conversation_ids"] = group_ids
    out["group_shards"] = membership
    out["conversation_id"] = group_ids[0]
    by_username: dict[str, str] = {}
    for shard in membership:
        cid = str(shard.get("conversation_id") or "")
        for username in shard.get("usernames") or []:
            if username and cid:
                by_username[str(username)] = cid
    out["group_by_username"] = by_username
    out_path = PROJECT_ROOT / args.out_meta
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {out_path} groups={len(group_ids)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
