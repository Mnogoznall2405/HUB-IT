"""Seed direct (personal) conversations between load-test users."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


DEFAULT_META = "tmp/hub-chat-load-meta.json"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed DM pairs for Hub/Chat load-test users.")
    parser.add_argument("--direct", action="store_true", help="Seed via chat_service (required on app server)")
    parser.add_argument("--meta", default=DEFAULT_META, help="Path to hub-chat-load-meta.json")
    parser.add_argument(
        "--pairing",
        choices=["adjacent", "ring"],
        default="adjacent",
        help="adjacent: 01-02,03-04,...; ring: each user with next (wrap)",
    )
    parser.add_argument(
        "--seed-messages",
        type=int,
        default=2,
        help="Initial messages per DM (0 to skip)",
    )
    return parser.parse_args()


def pair_users(users: list[dict[str, Any]], *, pairing: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    cleaned = [u for u in users if int(u.get("id") or 0) > 0 and str(u.get("username") or "").strip()]
    pairs: list[tuple[dict[str, Any], dict[str, Any]]] = []
    if pairing == "ring":
        if len(cleaned) < 2:
            return []
        for index, user in enumerate(cleaned):
            peer = cleaned[(index + 1) % len(cleaned)]
            if int(user["id"]) == int(peer["id"]):
                continue
            # keep undirected unique by sorted ids
            a, b = (user, peer) if int(user["id"]) < int(peer["id"]) else (peer, user)
            key = (int(a["id"]), int(b["id"]))
            if any((int(x["id"]), int(y["id"])) == key for x, y in pairs):
                continue
            pairs.append((a, b))
        return pairs
    # adjacent pairs
    for index in range(0, len(cleaned) - 1, 2):
        pairs.append((cleaned[index], cleaned[index + 1]))
    return pairs


def seed_direct(args: argparse.Namespace) -> int:
    if not bool(args.direct):
        raise SystemExit("Use --direct on the app server")

    project_root = Path(__file__).resolve().parents[1]
    web_root = project_root / "WEB-itinvent"
    if str(web_root) not in sys.path:
        sys.path.insert(0, str(web_root))

    meta_path = Path(args.meta).expanduser()
    if not meta_path.exists():
        raise SystemExit(f"Meta file not found: {meta_path}")
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    users = list(meta.get("users") or [])
    if not users:
        raise SystemExit("Meta has no users; run seed_hub_chat_loadtest_users.py first")

    from backend.chat.service import chat_service

    pairs = pair_users(users, pairing=str(args.pairing))
    dm_pairs: list[dict[str, Any]] = []
    dm_by_username: dict[str, str] = {}
    created = 0
    messages_sent = 0

    for left, right in pairs:
        left_id = int(left["id"])
        right_id = int(right["id"])
        conversation = chat_service.create_direct_conversation(
            current_user_id=left_id,
            peer_user_id=right_id,
        )
        conversation_id = str((conversation or {}).get("id") or "").strip()
        if not conversation_id:
            print(f"WARN: no conversation for {left.get('username')} <-> {right.get('username')}", file=sys.stderr)
            continue
        created += 1
        entry = {
            "conversation_id": conversation_id,
            "user_a_id": left_id,
            "user_b_id": right_id,
            "user_a": str(left.get("username")),
            "user_b": str(right.get("username")),
        }
        dm_pairs.append(entry)
        dm_by_username[str(left.get("username"))] = conversation_id
        dm_by_username[str(right.get("username"))] = conversation_id

        for index in range(max(0, int(args.seed_messages))):
            sender_id = left_id if index % 2 == 0 else right_id
            try:
                chat_service.send_message(
                    current_user_id=sender_id,
                    conversation_id=conversation_id,
                    body=f"LoadTest DM seed #{index + 1} from user {sender_id}",
                    body_format="plain",
                    client_message_id=f"lt-dm-seed-{conversation_id}-{index}",
                )
                messages_sent += 1
            except Exception as exc:  # noqa: BLE001
                print(f"WARN: seed message failed for {conversation_id}: {exc}", file=sys.stderr)

    meta["dm_pairs"] = dm_pairs
    meta["dm_by_username"] = dm_by_username
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"dm_pairs={len(dm_pairs)} seed_messages={messages_sent} wrote {meta_path}")
    if not dm_pairs:
        raise SystemExit("No DM pairs created")
    return 0


def main() -> int:
    return seed_direct(parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
