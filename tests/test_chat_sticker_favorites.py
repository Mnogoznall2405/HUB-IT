"""Chat sticker favorites/recents/pack-order through the real HTTP router.

Covers the user-visible flow instead of isolated units: install packs -> favorite
stickers (idempotent, isolated per user) -> recents versioned merge-sync with
dedupe+cap -> pack reorder -> favorites survive pack uninstall and stay sendable.
The boundary is HTTP on a temp SQLite chat DB, like test_e2e_chat_flow.py. The
migration itself is checked separately through alembic upgrade/downgrade.
"""
from __future__ import annotations

import importlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.script import ScriptDirectory
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import chat  # noqa: E402
from backend.models.auth import User  # noqa: E402

chat_db_module = importlib.import_module("backend.chat.db")
chat_models = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
telegram_sticker_module = importlib.import_module("backend.chat.telegram_sticker_service")
TelegramStickerService = telegram_sticker_module.TelegramStickerService


def _raw_user(user_id: int, username: str, full_name: str, role: str, permissions=None) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": True,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": list(permissions) if permissions is not None else ["chat.read", "chat.write"],
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


def _seed_pack(*, storage_root: Path, pack_id: str, short_name: str, title: str,
               sticker_ids: list[str], install_for: list[int] | None = None) -> None:
    """Insert a cached pack + stickers and optionally install it for users."""
    now = datetime.now(timezone.utc)
    pack_dir = storage_root / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    with chat_db_module.chat_write_session() as session:
        session.add(chat_models.ChatStickerPack(
            id=pack_id,
            short_name=short_name,
            title=title,
            sticker_type="regular",
            created_at=now,
            updated_at=now,
        ))
        for index, sticker_id in enumerate(sticker_ids):
            storage_name = f"{sticker_id}.webp"
            (pack_dir / storage_name).write_bytes(f"webp-{sticker_id}".encode("ascii"))
            session.add(chat_models.ChatSticker(
                id=sticker_id,
                pack_id=pack_id,
                telegram_file_id=f"tg-{sticker_id}",
                telegram_file_unique_id=f"tgu-{sticker_id}",
                emoji="🙂",
                format="static",
                mime_type="image/webp",
                storage_name=storage_name,
                file_size=len(f"webp-{sticker_id}"),
                width=512,
                height=512,
                sort_order=index,
                created_at=now,
            ))
        for user_id in install_for or []:
            session.add(chat_models.ChatUserStickerPack(
                user_id=int(user_id),
                pack_id=pack_id,
                added_at=now,
            ))


@pytest.fixture
def sticker_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "alice", "Alice Sender", "operator"),
        2: _raw_user(2, "bob", "Bob Peer", "operator"),
        3: _raw_user(3, "mallory", "Mallory Outsider", "viewer", permissions=[]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", lambda user_ids: {
        int(user_id): users_by_id[int(user_id)]
        for user_id in set(user_ids or [])
        if int(user_id) in users_by_id
    })
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(
        chat_db_module.config.chat,
        "database_url",
        f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}",
        raising=False,
    )
    monkeypatch.setattr(chat_db_module.config.redis, "url", None)
    redis_read_cache = importlib.import_module("backend.chat.chat_read_cache_redis").chat_read_cache_redis
    monkeypatch.setattr(redis_read_cache, "_client", None)

    chat_db_module.initialize_chat_schema()
    service = chat_service_module.ChatService()
    monkeypatch.setattr(chat, "chat_service", service)

    storage_root = Path(temp_dir) / "chat_sticker_packs"
    sticker_service = TelegramStickerService(storage_root=storage_root, token_getter=lambda: "token")
    monkeypatch.setattr("backend.api.v1.chat.stickers.telegram_sticker_service", sticker_service)
    # Default-pack auto-install must stay silent: the seeded packs are not defaults.
    monkeypatch.setattr(
        telegram_sticker_module,
        "default_sticker_pack_short_names",
        lambda: ("some_default_pack",),
    )

    def _drop_background_task(coro, *, label):  # noqa: ARG001
        try:
            coro.close()
        except Exception:
            pass

    monkeypatch.setattr(chat, "_schedule_chat_background_task", _drop_background_task)

    app = FastAPI()
    app.include_router(chat.router, prefix="/chat")
    current = {"user": _public_user(raw_users[1])}
    app.dependency_overrides[deps.get_current_active_user] = lambda: current["user"]
    client = TestClient(app)

    yield SimpleNamespace(
        client=client,
        set_user=lambda user_id: current.update({"user": _public_user(users_by_id[user_id])}),
        storage_root=storage_root,
        app=app,
        raw_users=raw_users,
    )


def _favorite_ids(payload: dict) -> list[str]:
    return [item["id"] for item in payload["items"]]


def test_favorites_roundtrip_is_idempotent(sticker_env):
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-a",
        short_name="testpack_alpha",
        title="Alpha pack",
        sticker_ids=["st-1", "st-2"],
        install_for=[1],
    )

    added = client.put("/chat/stickers/favorites/st-1")
    assert added.status_code == 200, added.text
    assert _favorite_ids(added.json()) == ["st-1"]
    item = added.json()["items"][0]
    assert item["pack_short_name"] == "testpack_alpha"
    assert item["file_url"] == "/api/v1/chat/stickers/st-1/file"

    # Double-add is a no-op, not a duplicate row.
    again = client.put("/chat/stickers/favorites/st-1")
    assert again.status_code == 200, again.text
    assert _favorite_ids(again.json()) == ["st-1"]

    client.put("/chat/stickers/favorites/st-2")
    listed = client.get("/chat/stickers/favorites")
    assert listed.status_code == 200, listed.text
    assert _favorite_ids(listed.json()) == ["st-2", "st-1"]  # added_at DESC

    removed = client.delete("/chat/stickers/favorites/st-1")
    assert removed.status_code == 200, removed.text
    assert _favorite_ids(removed.json()) == ["st-2"]
    # Deleting something absent stays quiet.
    assert client.delete("/chat/stickers/favorites/st-1").status_code == 200
    assert client.delete("/chat/stickers/favorites/st-unknown").status_code == 200


def test_favorite_requires_installed_pack_or_received_sticker(sticker_env):
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-b",
        short_name="testpack_beta",
        title="Beta pack",
        sticker_ids=["st-9"],
        install_for=[],
    )

    denied = client.put("/chat/stickers/favorites/st-9")
    assert denied.status_code == 404, denied.text
    assert client.put("/chat/stickers/favorites/st-missing").status_code == 404


def test_user_uploaded_stickerlike_filename_does_not_grant_entitlement(sticker_env):
    """A user-controlled attachment name must not count as a received sticker copy."""
    client, set_user = sticker_env.client, sticker_env.set_user
    sticker_id = "01234567-89ab-cdef-8123-456789abcdef"
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-forge",
        short_name="testpack_forge",
        title="Forge pack",
        sticker_ids=[sticker_id],
        install_for=[1],
    )

    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert conversation.status_code == 200, conversation.text
    conversation_id = conversation.json()["id"]

    set_user(2)  # Bob never installed the pack and never received the real sticker.
    forged_name = f"sticker-{sticker_id}--x.webp"
    uploaded = client.post(
        f"/chat/conversations/{conversation_id}/messages/files",
        files=[("files", (forged_name, b"not-a-real-sticker", "image/webp"))],
    )
    assert uploaded.status_code == 200, uploaded.text
    attachment = uploaded.json()["attachments"][0]
    assert attachment["file_name"] == forged_name
    assert attachment["media_kind"] is None

    denied = client.put(f"/chat/stickers/favorites/{sticker_id}")
    assert denied.status_code == 404, denied.text


def test_user_upload_cannot_set_sticker_media_kind(sticker_env):
    """The server-side ``media_kind='sticker'`` marker is not user-assignable."""
    client = sticker_env.client
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert conversation.status_code == 200, conversation.text
    conversation_id = conversation.json()["id"]

    rejected = client.post(
        f"/chat/conversations/{conversation_id}/messages/files",
        data={"files_meta_json": json.dumps([{"media_kind": "sticker"}])},
        files=[("files", ("sticker-st-forged--x.webp", b"not-a-real-sticker", "image/webp"))],
    )
    assert rejected.status_code == 400, rejected.text


def test_cached_pack_preview_import_and_send_are_already_self_service(sticker_env):
    """The pack cache is shared: no private-pack confidentiality or send privilege exists."""
    client, set_user = sticker_env.client, sticker_env.set_user
    pack_id = "pack-self-service"
    sticker_id = "st-self-service"
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id=pack_id,
        short_name="testpack_self_service",
        title="Self-service pack",
        sticker_ids=[sticker_id],
        install_for=[],
    )
    (sticker_env.storage_root / pack_id / ".previews-v2").write_text("ready", encoding="ascii")

    set_user(3)  # Mallory has neither installed the pack nor received its sticker.
    preview = client.get("/chat/sticker-packs/preview/testpack_self_service")
    assert preview.status_code == 200, preview.text
    assert preview.json()["is_added"] is False
    assert [item["id"] for item in preview.json()["stickers"]] == [sticker_id]

    raw = client.get(f"/chat/sticker-packs/preview/testpack_self_service/stickers/{sticker_id}/file")
    assert raw.status_code == 200, raw.text
    assert raw.content == f"webp-{sticker_id}".encode("ascii")

    imported = client.post("/chat/sticker-packs/import", json={"source": "testpack_self_service"})
    assert imported.status_code == 200, imported.text
    assert [item["id"] for item in imported.json()["items"]] == [pack_id]

    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 1})
    assert conversation.status_code == 200, conversation.text
    sent = client.post(
        f"/chat/conversations/{conversation.json()['id']}/messages/sticker",
        json={"sticker_id": sticker_id, "client_message_id": "self-service-sticker"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["attachments"][0]["media_kind"] == "sticker"


def test_favorites_are_isolated_per_user(sticker_env):
    client, set_user = sticker_env.client, sticker_env.set_user
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-c",
        short_name="testpack_gamma",
        title="Gamma pack",
        sticker_ids=["st-1", "st-2"],
        install_for=[1, 2],
    )

    assert client.put("/chat/stickers/favorites/st-1").status_code == 200
    set_user(2)
    assert client.get("/chat/stickers/favorites").json()["items"] == []
    client.put("/chat/stickers/favorites/st-2")
    assert _favorite_ids(client.get("/chat/stickers/favorites").json()) == ["st-2"]
    set_user(1)
    assert _favorite_ids(client.get("/chat/stickers/favorites").json()) == ["st-1"]


def test_recents_replace_orders_dedupes_and_caps(sticker_env):
    client = sticker_env.client
    sticker_ids = [f"st-{index}" for index in range(60)]
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-d",
        short_name="testpack_delta",
        title="Delta pack",
        sticker_ids=sticker_ids,
        install_for=[1],
    )

    replaced = client.put(
        "/chat/stickers/recent",
        json={"sticker_ids": ["st-1", "st-2", "st-1", "st-3", "  ", "st-unknown"]},
    )
    assert replaced.status_code == 200, replaced.text
    assert _favorite_ids(replaced.json()) == ["st-1", "st-2", "st-3"]

    listed = client.get("/chat/stickers/recent")
    assert listed.status_code == 200, listed.text
    assert _favorite_ids(listed.json()) == ["st-1", "st-2", "st-3"]
    assert listed.json()["items"][0]["pack_short_name"] == "testpack_delta"

    # A merge PUT puts the payload in front and keeps server-only entries in
    # place; the rail is still capped at 50.
    big = client.put("/chat/stickers/recent", json={"sticker_ids": sticker_ids})
    assert big.status_code == 200, big.text
    assert _favorite_ids(big.json()) == sticker_ids[:50]


def test_recents_merge_sync_versions_and_clear(sticker_env):
    """Two devices merge instead of clobbering; every PUT bumps ``version``."""
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-merge",
        short_name="testpack_merge",
        title="Merge pack",
        sticker_ids=["m-1", "m-2", "m-3", "m-4"],
        install_for=[1],
    )

    first = client.put("/chat/stickers/recent", json={"sticker_ids": ["m-1", "m-2"]})
    assert first.status_code == 200, first.text
    assert first.json()["version"] == 1
    assert _favorite_ids(first.json()) == ["m-1", "m-2"]

    # Device B uploads its own rail: server entries absent from the payload are
    # KEPT appended after the client's front, not lost.
    merged = client.put(
        "/chat/stickers/recent",
        json={"sticker_ids": ["m-4", "m-1"], "base_version": first.json()["version"]},
    )
    assert merged.status_code == 200, merged.text
    assert merged.json()["version"] == 2
    assert _favorite_ids(merged.json()) == ["m-4", "m-1", "m-2"]

    # A stale base_version is advisory: the merge still succeeds.
    stale = client.put(
        "/chat/stickers/recent",
        json={"sticker_ids": ["m-3"], "base_version": 0},
    )
    assert stale.status_code == 200, stale.text
    assert stale.json()["version"] == 3
    assert _favorite_ids(stale.json()) == ["m-3", "m-4", "m-1", "m-2"]

    # GET reports the current version alongside the items.
    listed = client.get("/chat/stickers/recent")
    assert listed.status_code == 200, listed.text
    assert listed.json()["version"] == 3

    # An empty merge payload is a content no-op (bumps version only); an
    # explicit clear really empties the rail.
    noop = client.put("/chat/stickers/recent", json={"sticker_ids": []})
    assert _favorite_ids(noop.json()) == ["m-3", "m-4", "m-1", "m-2"]
    cleared = client.put("/chat/stickers/recent", json={"sticker_ids": [], "clear": True})
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["items"] == []
    assert client.get("/chat/stickers/recent").json()["items"] == []


def test_recents_reject_stickers_the_user_cannot_reference(sticker_env):
    """Recents PUT silently drops stickers outside the caller's entitlement."""
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-own",
        short_name="testpack_own",
        title="Own pack",
        sticker_ids=["own-1"],
        install_for=[1],
    )
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-foreign",
        short_name="testpack_foreign",
        title="Foreign pack",
        sticker_ids=["foreign-1"],
        install_for=[2],  # installed for bob only — alice cannot reference it
    )

    pushed = client.put(
        "/chat/stickers/recent",
        json={"sticker_ids": ["own-1", "foreign-1", "st-missing"]},
    )
    assert pushed.status_code == 200, pushed.text
    assert _favorite_ids(pushed.json()) == ["own-1"]
    assert _favorite_ids(client.get("/chat/stickers/recent").json()) == ["own-1"]


def test_recents_listing_hides_stickers_after_access_lost(sticker_env):
    """GET /stickers/recent filters entries the user can no longer reference."""
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-gone",
        short_name="testpack_gone",
        title="Gone pack",
        sticker_ids=["gone-1", "gone-2"],
        install_for=[1],
    )
    client.put("/chat/stickers/recent", json={"sticker_ids": ["gone-1", "gone-2"]})
    # Favorite one sticker: it keeps its entitlement via the favorites row.
    assert client.put("/chat/stickers/favorites/gone-1").status_code == 200

    assert client.delete("/chat/sticker-packs/pack-gone").status_code == 200

    listed = client.get("/chat/stickers/recent")
    assert listed.status_code == 200, listed.text
    assert _favorite_ids(listed.json()) == ["gone-1"]  # favorite still allowed


def test_received_sticker_can_be_added_to_recents(sticker_env):
    """A sticker received in a conversation is referenceable without the pack."""
    client, set_user = sticker_env.client, sticker_env.set_user
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-h",
        short_name="testpack_theta",
        title="Theta pack",
        sticker_ids=["st-h1"],
        install_for=[1],
    )
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    conversation_id = conversation.json()["id"]
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages/sticker",
        json={"sticker_id": "st-h1", "client_message_id": "sticker-recents-for-bob"},
    )
    assert sent.status_code == 200, sent.text

    set_user(2)  # bob never installed the pack but received the sticker.
    pushed = client.put("/chat/stickers/recent", json={"sticker_ids": ["st-h1"]})
    assert pushed.status_code == 200, pushed.text
    assert _favorite_ids(pushed.json()) == ["st-h1"]


def test_pack_order_persists_in_pack_listing(sticker_env):
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-e1",
        short_name="testpack_one",
        title="One",
        sticker_ids=["st-e1"],
        install_for=[1],
    )
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-e2",
        short_name="testpack_two",
        title="Two",
        sticker_ids=["st-e2"],
        install_for=[1],
    )
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-e3",
        short_name="testpack_three",
        title="Three",
        sticker_ids=["st-e3"],
        install_for=[1, 2],
    )

    before = client.get("/chat/sticker-packs")
    assert before.status_code == 200, before.text
    assert [item["id"] for item in before.json()["items"]] == ["pack-e1", "pack-e2", "pack-e3"]

    # Unlisted installed packs keep their relative order after the named ones.
    reordered = client.post("/chat/sticker-packs/order", json={"pack_ids": ["pack-e3", "pack-e1", "pack-e3"]})
    assert reordered.status_code == 200, reordered.text
    assert [item["id"] for item in reordered.json()["items"]] == ["pack-e3", "pack-e1", "pack-e2"]

    persisted = client.get("/chat/sticker-packs")
    assert [item["id"] for item in persisted.json()["items"]] == ["pack-e3", "pack-e1", "pack-e2"]

    # Reordering someone else's / unknown pack is rejected.
    rejected = client.post("/chat/sticker-packs/order", json={"pack_ids": ["pack-elsewhere"]})
    assert rejected.status_code == 400, rejected.text

    # Another user's ordering is untouched.
    sticker_env.set_user(2)
    other = client.get("/chat/sticker-packs")
    assert [item["id"] for item in other.json()["items"]] == ["pack-e3"]


def test_favorites_survive_pack_uninstall_and_stay_sendable(sticker_env):
    client = sticker_env.client
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-f",
        short_name="testpack_zeta",
        title="Zeta pack",
        sticker_ids=["st-f1"],
        install_for=[1],
    )
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    assert conversation.status_code == 200, conversation.text
    conversation_id = conversation.json()["id"]

    assert client.put("/chat/stickers/favorites/st-f1").status_code == 200
    # Pack files are shared storage: remove_pack drops only the membership row,
    # so the favorite still resolves afterwards.
    assert client.delete("/chat/sticker-packs/pack-f").status_code == 200
    assert _favorite_ids(client.get("/chat/stickers/favorites").json()) == ["st-f1"]

    served = client.get("/chat/stickers/st-f1/file")
    assert served.status_code == 200, served.text
    assert served.content == b"webp-st-f1"

    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages/sticker",
        json={"sticker_id": "st-f1", "client_message_id": "sticker-after-uninstall"},
    )
    assert sent.status_code == 200, sent.text
    attachment = sent.json()["attachments"][0]
    assert attachment["media_kind"] == "sticker"
    assert attachment["file_name"].startswith("sticker-st-f1--testpack_zeta")


def test_received_sticker_can_be_favorited_without_the_pack(sticker_env):
    client, set_user = sticker_env.client, sticker_env.set_user
    _seed_pack(
        storage_root=sticker_env.storage_root,
        pack_id="pack-g",
        short_name="testpack_eta",
        title="Eta pack",
        sticker_ids=["st-g1"],
        install_for=[1],
    )
    conversation = client.post("/chat/conversations/direct", json={"peer_user_id": 2})
    conversation_id = conversation.json()["id"]
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages/sticker",
        json={"sticker_id": "st-g1", "client_message_id": "sticker-for-bob"},
    )
    assert sent.status_code == 200, sent.text

    set_user(2)  # bob never installed the pack but received the sticker.
    favorited = client.put("/chat/stickers/favorites/st-g1")
    assert favorited.status_code == 200, favorited.text
    assert _favorite_ids(favorited.json()) == ["st-g1"]


def test_new_sticker_endpoints_require_authentication(sticker_env):
    # An app without the auth override exercises the real JWT dependency.
    app = FastAPI()
    app.include_router(chat.router, prefix="/chat")
    anonymous = TestClient(app, raise_server_exceptions=False)

    assert anonymous.get("/chat/stickers/favorites").status_code == 401
    assert anonymous.get("/chat/stickers/recent").status_code == 401
    assert anonymous.put("/chat/stickers/favorites/st-1").status_code == 401
    assert anonymous.delete("/chat/stickers/favorites/st-1").status_code == 401
    assert anonymous.put("/chat/stickers/recent", json={"sticker_ids": []}).status_code == 401
    assert anonymous.post("/chat/sticker-packs/order", json={"pack_ids": []}).status_code == 401
    # Note: a chat-permissionless account cannot exist — every effective
    # permission set includes the viewer baseline with chat.read/chat.write
    # (authorization_service.get_effective_permissions), so 401 covers auth here.


def _alembic_config(url: str, scope: str = "chat"):
    build = importlib.import_module("backend.db_migrations").build_alembic_config
    return build(url, scope=scope)


def test_sticker_favorites_migration_upgrade_and_downgrade(tmp_path):
    """20261124_0180 creates both tables and the position column, then rolls back."""
    revision = "20261124_0180"
    parent = "20261124_0179"
    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'mig177.db').as_posix()}")
    cfg = _alembic_config(str(engine.url))
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql("CREATE TABLE chat_sticker_packs (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE chat_stickers (id VARCHAR(36) PRIMARY KEY, pack_id VARCHAR(36) NOT NULL "
            "REFERENCES chat_sticker_packs(id))"
        )
        connection.exec_driver_sql(
            "CREATE TABLE chat_user_sticker_packs (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, "
            "pack_id VARCHAR(36) NOT NULL, added_at DATETIME NOT NULL)"
        )

    command.stamp(cfg, parent)
    command.upgrade(cfg, revision)
    inspector = sa.inspect(engine)
    assert inspector.has_table("chat_user_favorite_stickers")
    assert inspector.has_table("chat_user_recent_stickers")
    assert "position" in {
        col["name"] for col in inspector.get_columns("chat_user_sticker_packs")
    }
    favorite_columns = {
        col["name"] for col in inspector.get_columns("chat_user_favorite_stickers")
    }
    assert favorite_columns >= {"id", "user_id", "sticker_id", "added_at"}

    command.upgrade(cfg, revision)  # create-if-missing: applying again is a no-op.

    command.downgrade(cfg, parent)
    inspector = sa.inspect(engine)
    assert not inspector.has_table("chat_user_favorite_stickers")
    assert not inspector.has_table("chat_user_recent_stickers")
    assert "position" not in {
        col["name"] for col in inspector.get_columns("chat_user_sticker_packs")
    }
    engine.dispose()


def test_recents_sync_state_migration_upgrade_and_downgrade(tmp_path):
    """20261124_0181 creates the per-user recents version table, then rolls back."""
    revision = "20261124_0181"
    parent = "20261124_0180"
    engine = sa.create_engine(f"sqlite:///{(tmp_path / 'mig178.db').as_posix()}")
    cfg = _alembic_config(str(engine.url))
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE chat_conversations (id VARCHAR(36) PRIMARY KEY)")
        connection.exec_driver_sql(
            "CREATE TABLE chat_user_recent_stickers (id INTEGER PRIMARY KEY, "
            "user_id INTEGER NOT NULL, sticker_id VARCHAR(64) NOT NULL, "
            "position INTEGER NOT NULL)"
        )
        connection.exec_driver_sql(
            "INSERT INTO chat_user_recent_stickers (id, user_id, sticker_id, position) "
            "VALUES (1, 7, 'st-keep', 0)"
        )

    command.stamp(cfg, parent)
    command.upgrade(cfg, revision)
    inspector = sa.inspect(engine)
    assert inspector.has_table("chat_user_recent_sticker_state")
    state_columns = {
        col["name"] for col in inspector.get_columns("chat_user_recent_sticker_state")
    }
    assert state_columns >= {"user_id", "version", "updated_at"}

    command.upgrade(cfg, revision)  # create-if-missing: applying again is a no-op.

    # Existing recents rows survive the migration untouched.
    with engine.connect() as connection:
        rows = connection.exec_driver_sql(
            "SELECT user_id, sticker_id FROM chat_user_recent_stickers"
        ).fetchall()
    assert rows == [(7, "st-keep")]

    command.downgrade(cfg, parent)
    inspector = sa.inspect(engine)
    assert not inspector.has_table("chat_user_recent_sticker_state")
    assert inspector.has_table("chat_user_recent_stickers")
    engine.dispose()


def test_sticker_favorites_revision_is_the_single_head_descendant():
    cfg = _alembic_config("sqlite:///unused.db")
    script = ScriptDirectory.from_config(cfg)
    heads = script.get_heads()
    assert len(heads) == 1, heads
    reachable = {migration.revision for migration in script.iterate_revisions(heads[0], "base")}
    assert {"20261124_0180", "20261124_0181", "20261125_0182"} <= reachable
