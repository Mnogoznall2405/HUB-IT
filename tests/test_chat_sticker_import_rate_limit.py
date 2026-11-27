"""Per-user rate limit on POST /chat/sticker-packs/import through the real HTTP router.

The import endpoint is the most expensive fan-out in the chat API (hundreds of
Telegram Bot API calls per uncached pack), so it is throttled per authenticated
user with two fixed-window tiers (minute burst + hourly sustained). These tests
exercise the boundary over HTTP on a temp SQLite chat DB like
test_chat_sticker_favorites.py; Telegram itself is never contacted — imports
either hit the seeded shared pack cache or a mocked Telegram payload.
"""
from __future__ import annotations

import importlib
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps  # noqa: E402
from backend.api.v1 import chat  # noqa: E402
from backend.models.auth import User  # noqa: E402
from backend.utils.request_network import classify_network_zone  # noqa: E402

chat_db_module = importlib.import_module("backend.chat.db")
chat_models = importlib.import_module("backend.chat.models")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
telegram_sticker_module = importlib.import_module("backend.chat.telegram_sticker_service")
auth_runtime_store_module = importlib.import_module("backend.services.auth_runtime_store_service")
auth_runtime_store_service = auth_runtime_store_module.auth_runtime_store_service
TelegramStickerService = telegram_sticker_module.TelegramStickerService
_PREVIEW_CACHE_MARKER = telegram_sticker_module._PREVIEW_CACHE_MARKER


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


def _seed_cached_pack(*, storage_root: Path, pack_id: str, short_name: str, title: str) -> None:
    """Insert a fully cached pack: row + sticker file + preview-cache marker.

    Importing such a pack never reaches Telegram — `_add_cached_pack` installs it
    straight from the shared cache, which is exactly the cheap path legitimate
    users hit when adding a pack someone else already imported.
    """
    now = datetime.now(timezone.utc)
    pack_dir = storage_root / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    storage_name = "st-1.webp"
    (pack_dir / storage_name).write_bytes(f"webp-{pack_id}".encode("ascii"))
    (pack_dir / _PREVIEW_CACHE_MARKER).write_text("ready", encoding="ascii")
    with chat_db_module.chat_write_session() as session:
        session.add(chat_models.ChatStickerPack(
            id=pack_id,
            short_name=short_name,
            title=title,
            sticker_type="regular",
            created_at=now,
            updated_at=now,
        ))
        session.add(chat_models.ChatSticker(
            id=f"st-{pack_id}",
            pack_id=pack_id,
            telegram_file_id=f"tg-{pack_id}",
            telegram_file_unique_id=f"tgu-{pack_id}",
            emoji="🙂",
            format="static",
            mime_type="image/webp",
            storage_name=storage_name,
            file_size=len(f"webp-{pack_id}"),
            width=512,
            height=512,
            sort_order=0,
            created_at=now,
        ))


class _PeerIpRewriteMiddleware:
    """Test-only ASGI middleware presenting a controllable direct peer IP.

    The TestClient peer ("testclient") never parses as an IP, so requests are
    always classified into the external zone and trusted-proxy forwarding never
    applies. Rewriting the scope client IP simulates what the deployment really
    sees when the same user connects from different networks (office LAN vs
    Internet/VPN) — the zone classification itself runs for real through
    ``build_request_network_context``.
    """

    def __init__(self, app, peer_ip_cell):
        self.app = app
        self._peer_ip_cell = peer_ip_cell

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and self._peer_ip_cell[0]:
            scope["client"] = (self._peer_ip_cell[0], 43210)
        await self.app(scope, receive, send)


def _clear_rate_limit_memory() -> None:
    lock = getattr(auth_runtime_store_service, "_lock", None)
    memory = getattr(auth_runtime_store_service, "_memory", None)
    if lock is not None and memory is not None:
        with lock:
            memory.clear()


@pytest.fixture(autouse=True)
def _memory_rate_limit_store(monkeypatch):
    """Deterministic in-memory counter backend + frozen controllable clock."""
    clock = [time.time()]
    monkeypatch.setattr(auth_runtime_store_service, "_backend", "memory")
    monkeypatch.setattr(auth_runtime_store_module, "_utc_ts", lambda: clock[0])
    _clear_rate_limit_memory()
    yield SimpleNamespace(clock=clock)
    _clear_rate_limit_memory()


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
    peer_ip_cell = [None]  # None = keep the default TestClient peer
    client = TestClient(_PeerIpRewriteMiddleware(app, peer_ip_cell))

    yield SimpleNamespace(
        client=client,
        set_user=lambda user_id: current.update({"user": _public_user(users_by_id[user_id])}),
        set_peer_ip=lambda ip: peer_ip_cell.__setitem__(0, ip),
        storage_root=storage_root,
        sticker_service=sticker_service,
        app=app,
        raw_users=raw_users,
    )


@pytest.fixture
def strict_import_limits(monkeypatch):
    """Minute tier of 2 imports/60s, hourly tier high enough to stay out of the way."""
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_limit_per_user", 2)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_window_user_sec", 60)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_hourly_limit_per_user", 1000)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_hourly_window_user_sec", 3600)


def _seed_packs(sticker_env, count: int) -> list[str]:
    short_names = []
    for index in range(count):
        short_name = f"ratelimitpack_{index}"
        short_names.append(short_name)
        _seed_cached_pack(
            storage_root=sticker_env.storage_root,
            pack_id=f"pack-rl-{index}",
            short_name=short_name,
            title=f"Rate limit pack {index}",
        )
    return short_names


def _import(client, short_name: str):
    return client.post("/chat/sticker-packs/import", json={"source": short_name})


def test_import_burst_limit_triggers_with_retry_after(sticker_env, strict_import_limits):
    client = sticker_env.client
    pack_a, pack_b, pack_c = _seed_packs(sticker_env, 3)

    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200

    blocked = _import(client, pack_c)
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["detail"]
    retry_after = blocked.headers.get("retry-after")
    assert retry_after is not None
    assert 1 <= int(retry_after) <= 60
    # Still over the limit while the window is frozen.
    assert _import(client, pack_c).status_code == 429


def test_import_rate_limit_is_per_user(sticker_env, strict_import_limits):
    client, set_user = sticker_env.client, sticker_env.set_user
    pack_a, pack_b, pack_c = _seed_packs(sticker_env, 3)

    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200
    assert _import(client, pack_c).status_code == 429  # alice is exhausted

    set_user(2)  # bob has his own untouched bucket
    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200

    set_user(1)  # alice is still limited — bob's imports did not reset her window
    assert _import(client, pack_c).status_code == 429


def test_import_rate_limit_budget_is_shared_across_network_zones(sticker_env, strict_import_limits, monkeypatch):
    """The declared budget is per user, not per user-and-zone: switching networks
    (office LAN ↔ Internet/VPN) must not hand the same account a fresh budget."""
    # Deterministic zone classification regardless of the local .env.
    monkeypatch.setattr(chat_db_module.config.security, "twofa_internal_cidrs", ["10.0.0.0/8"])
    # Scenario precondition: the two peer networks must really land in different zones,
    # otherwise the assertions below would pass vacuously.
    assert classify_network_zone("10.0.0.5") == "internal"
    assert classify_network_zone("95.24.10.1") == "external"

    client, set_user, set_peer_ip = sticker_env.client, sticker_env.set_user, sticker_env.set_peer_ip
    pack_a, pack_b, pack_c = _seed_packs(sticker_env, 3)

    # Alice exhausts the strict burst budget of 2 from the office LAN (internal zone).
    set_peer_ip("10.0.0.5")
    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200

    # She leaves the office — same account, external zone. A per-zone counter would
    # hand her a fresh budget here; the per-user budget must keep throttling her.
    set_peer_ip("95.24.10.1")
    blocked = _import(client, pack_c)
    assert blocked.status_code == 429, blocked.text
    assert blocked.headers.get("retry-after")

    # Same in the opposite direction for Bob: external first, then internal.
    set_user(2)
    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200
    set_peer_ip("10.0.0.5")
    assert _import(client, pack_c).status_code == 429


def test_import_rate_limit_window_recovers(sticker_env, strict_import_limits, _memory_rate_limit_store):
    client = sticker_env.client
    pack_a, pack_b, pack_c = _seed_packs(sticker_env, 3)

    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200
    assert _import(client, pack_c).status_code == 429

    _memory_rate_limit_store.clock[0] += 61  # fixed window expired

    recovered = _import(client, pack_c)
    assert recovered.status_code == 200, recovered.text


def test_import_hourly_tier_bounds_sustained_imports(sticker_env, monkeypatch, _memory_rate_limit_store):
    client = sticker_env.client
    # Burst tier out of the way: only the hourly tier can fire here.
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_limit_per_user", 1000)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_window_user_sec", 60)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_hourly_limit_per_user", 2)
    monkeypatch.setattr(chat_db_module.config.chat, "sticker_import_hourly_window_user_sec", 3600)
    pack_a, pack_b, pack_c = _seed_packs(sticker_env, 3)

    assert _import(client, pack_a).status_code == 200
    assert _import(client, pack_b).status_code == 200

    blocked = _import(client, pack_c)
    assert blocked.status_code == 429, blocked.text
    retry_after = blocked.headers.get("retry-after")
    assert retry_after is not None
    assert 1 <= int(retry_after) <= 3600

    _memory_rate_limit_store.clock[0] += 3601
    assert _import(client, pack_c).status_code == 200


def test_imports_within_default_limits_pass(sticker_env):
    """Legitimate UX: installing several packs in a row from search results is not throttled."""
    client = sticker_env.client
    # Default config: 5/minute, 20/hour — five rapid distinct installs must all pass.
    short_names = _seed_packs(sticker_env, 6)

    responses = [_import(client, short_name) for short_name in short_names[:5]]

    assert [response.status_code for response in responses] == [200] * 5
    installed_titles = {item["title"] for item in responses[-1].json()["items"]}
    assert installed_titles == {f"Rate limit pack {index}" for index in range(5)}
    # The sixth install inside the same minute crosses the default burst tier.
    assert _import(client, short_names[5]).status_code == 429


def test_uncached_import_shares_the_same_quota(sticker_env, strict_import_limits, monkeypatch):
    """The expensive Telegram fan-out path feeds the same counter as cached installs."""
    client = sticker_env.client
    service = sticker_env.sticker_service
    (cached_name,) = _seed_packs(sticker_env, 1)

    async def fake_telegram_json(_client, *, method, **_kwargs):
        assert method == "getStickerSet"  # no other Telegram call may happen
        return {
            "name": "fresh_uncached_pack",
            "title": "Fresh uncached pack",
            "sticker_type": "regular",
            "stickers": [{"file_id": "file-1", "file_unique_id": "unique-1"}],
        }

    async def fake_download_sticker(*_args, target_dir, **_kwargs):
        (target_dir / "new.webp").write_bytes(b"new")
        return {
            "id": "new-sticker",
            "telegram_file_id": "file-1",
            "telegram_file_unique_id": "unique-1",
            "emoji": "🙂",
            "format": "static",
            "mime_type": "image/webp",
            "storage_name": "new.webp",
            "file_size": 3,
            "width": 512,
            "height": 512,
            "sort_order": 0,
        }

    monkeypatch.setattr(service, "_telegram_json", fake_telegram_json)
    monkeypatch.setattr(service, "_download_sticker", fake_download_sticker)

    imported = _import(client, "fresh_uncached_pack")
    assert imported.status_code == 200, imported.text

    # One quota slot spent on the uncached import: with a limit of 2 the next
    # (cheap, cached) install still passes, but the one after is throttled.
    assert _import(client, cached_name).status_code == 200
    assert _import(client, cached_name).status_code == 429


def test_failed_imports_consume_quota(sticker_env, strict_import_limits, monkeypatch):
    """A rejected pack name still costs Telegram a getStickerSet call, so failed
    attempts must consume quota too — otherwise the endpoint is a free scanning oracle."""
    client = sticker_env.client
    service = sticker_env.sticker_service
    (cached_name,) = _seed_packs(sticker_env, 1)

    async def rejecting_telegram_json(_client, *, method, **_kwargs):
        raise telegram_sticker_module.TelegramStickerImportError("Telegram не нашёл этот набор")

    monkeypatch.setattr(service, "_telegram_json", rejecting_telegram_json)

    # Two failed imports of a nonexistent pack (400s) exhaust the strict limit of 2…
    for _ in range(2):
        failed = _import(client, "no_such_pack_anywhere")
        assert failed.status_code == 400, failed.text
    # …and the next attempt is throttled even though it names a valid cached pack.
    blocked = _import(client, cached_name)
    assert blocked.status_code == 429, blocked.text
