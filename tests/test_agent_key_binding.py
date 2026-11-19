"""Per-agent API key binding (HIGH-03): a bound key only works for its own identity."""
from __future__ import annotations

import asyncio
import dataclasses
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
for _path in (str(ROOT), str(WEB_ROOT)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import inventory_server.app as inventory_app
import scan_server.app as scan_app
from backend import inventory_runtime
from inventory_server.config import InventoryServerConfig
from scan_server.config import ScanServerConfig


@pytest.fixture
def bound_scan_config(monkeypatch):
    config = dataclasses.replace(
        scan_app.config,
        agent_api_keys={"host-a": "key-a", "host-b": "key-b"},
    )
    monkeypatch.setattr(scan_app, "config", config)
    return config


@pytest.fixture
def bound_inventory_config(monkeypatch):
    config = dataclasses.replace(
        inventory_app.config,
        agent_api_keys={"ws-001": "inv-key-a", "ws-002": "inv-key-b"},
    )
    monkeypatch.setattr(inventory_app, "config", config)
    return config


class _JsonRequest:
    def __init__(self, body):
        self._body = body

    async def json(self):
        return self._body


def test_scan_agent_api_keys_parse(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("SCAN_SERVER_API_KEYS", "ring-key")
    monkeypatch.setenv("SCAN_AGENT_API_KEYS", "h1=k1, h2 = k2 ,,")
    config = ScanServerConfig.from_env()
    assert config.agent_api_keys == {"h1": "k1", "h2": "k2"}


def test_inventory_agent_api_keys_parse(monkeypatch):
    monkeypatch.setenv("APP_ENV", "development")
    monkeypatch.setenv("INVENTORY_SERVER_API_KEYS", "ring-key")
    monkeypatch.setenv("INVENTORY_AGENT_API_KEYS", "ws-1=k1, ws-2 = k2")
    config = InventoryServerConfig.from_env()
    assert config.agent_api_keys == {"ws-1": "k1", "ws-2": "k2"}


def test_scan_bound_key_only_polls_own_tasks(bound_scan_config, monkeypatch):
    seen = []
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(
            touch_agent_presence=lambda **kwargs: None,
            poll_tasks=lambda agent_id, limit, **kw: seen.append(agent_id) or [{"id": "t1"}],
        ),
    )

    own = scan_app.poll_tasks(request=None, agent_id="host-a", limit=10, x_api_key="key-a")
    assert own["tasks"] == [{"id": "t1"}]

    with pytest.raises(HTTPException) as exc_info:
        scan_app.poll_tasks(request=None, agent_id="host-b", limit=10, x_api_key="key-a")
    assert exc_info.value.status_code == 401

    # A shared-ring key still works for any agent until the fleet is migrated.
    other = scan_app.poll_tasks(
        request=None, agent_id="host-b", limit=10, x_api_key=scan_app.config.api_keys[0]
    )
    assert other["tasks"] == [{"id": "t1"}]
    assert seen == ["host-a", "host-b"]


def test_scan_bound_key_cannot_report_foreign_task(bound_scan_config, monkeypatch):
    monkeypatch.setattr(scan_app, "store", SimpleNamespace(touch_agent_presence=lambda **k: None))
    payload = scan_app.TaskResultPayload(agent_id="host-b", status="completed", result={})
    with pytest.raises(HTTPException) as exc_info:
        scan_app.task_result(task_id="t1", payload=payload, request=None, x_api_key="key-a")
    assert exc_info.value.status_code == 401


def test_scan_bound_key_is_valid_on_endpoints_without_agent_identity(bound_scan_config):
    scan_app._check_agent_key("key-a")  # e.g. agent-package download: any valid key passes
    with pytest.raises(HTTPException):
        scan_app._check_agent_identity("key-a", "host-b")


def test_scan_bound_key_heartbeat_for_other_agent_is_rejected(bound_scan_config, monkeypatch):
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(
            upsert_agent_heartbeat=lambda data: pytest.fail("foreign heartbeat must not be stored")
        ),
    )
    payload = scan_app.HeartbeatPayload(agent_id="host-b", hostname="HOST-B")
    with pytest.raises(HTTPException) as exc_info:
        scan_app.heartbeat(payload=payload, request=None, x_api_key="key-a")
    assert exc_info.value.status_code == 401


def test_inventory_bound_key_cannot_ingest_for_another_host(bound_inventory_config, monkeypatch):
    monkeypatch.setattr(
        inventory_app,
        "store",
        SimpleNamespace(enqueue=lambda *a, **k: pytest.fail("foreign payload must not be queued")),
    )
    monkeypatch.setattr(inventory_app, "ensure_worker_alive", lambda: None)
    payload = inventory_runtime.InventoryPayload(
        hostname="ws-002", mac_address="AA-BB", timestamp=1_700_000_000
    )
    with pytest.raises(HTTPException) as exc_info:
        inventory_app.receive_inventory(payload, x_api_key="inv-key-a")
    assert exc_info.value.status_code == 401


def test_inventory_bound_key_fs_egress_events_must_belong_to_it(
    bound_inventory_config, monkeypatch
):
    monkeypatch.setattr(inventory_app, "_ingest_fs_egress_events", lambda events: len(events))

    own = asyncio.run(
        inventory_app.receive_fs_egress(
            _JsonRequest({"events": [{"computer_name": "ws-001"}]}),
            x_api_key="inv-key-a",
        )
    )
    assert own["inserted"] == 1

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            inventory_app.receive_fs_egress(
                _JsonRequest({"events": [{"computer_name": "ws-002"}]}),
                x_api_key="inv-key-a",
            )
        )
    assert exc_info.value.status_code == 403

    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            inventory_app.receive_fs_egress(
                _JsonRequest({"events": [{"computer_name": "ws-001"}, {"computer_name": "ws-002"}]}),
                x_api_key="inv-key-a",
            )
        )
    assert exc_info.value.status_code == 403


def test_inventory_bound_key_probe_ingest_rejects_foreign_computer(
    bound_inventory_config, monkeypatch
):
    monkeypatch.setattr(
        inventory_app,
        "_process_telegram_probe_payload",
        lambda payload: pytest.fail("foreign payload must not be processed"),
    )
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(
            inventory_app.receive_telegram_probe(
                _JsonRequest({"computer_name": "ws-002", "chats": []}),
                x_api_key="inv-key-a",
            )
        )
    assert exc_info.value.status_code == 401


def test_inventory_bound_key_reads_are_scoped_to_own_computer(
    bound_inventory_config, monkeypatch
):
    captured = {}
    monkeypatch.setattr(
        inventory_app,
        "_get_egress_store",
        lambda: SimpleNamespace(
            list_telegram_chats=lambda computer_name, limit: captured.update(name=computer_name) or []
        ),
    )

    out = inventory_app.list_telegram_probe(computer_name="", limit=5, x_api_key="inv-key-a")
    assert out["success"] is True
    assert captured["name"] == "ws-001"

    with pytest.raises(HTTPException) as exc_info:
        inventory_app.list_telegram_probe(computer_name="ws-002", limit=5, x_api_key="inv-key-a")
    assert exc_info.value.status_code == 403


def test_scan_config_starts_with_bound_keys_only(monkeypatch):
    """Production gate: bound per-agent keys satisfy the requirement once the ring is removed."""
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SCAN_SERVER_API_KEYS", "")
    monkeypatch.setenv("SCAN_SERVER_API_KEY", "")
    monkeypatch.setenv("SCAN_AGENT_API_KEYS", "h1=k1")
    config = ScanServerConfig.from_env()
    assert config.api_keys == ()
    assert config.agent_api_keys == {"h1": "k1"}


def test_scan_config_production_still_requires_some_key(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("SCAN_SERVER_API_KEYS", "")
    monkeypatch.setenv("SCAN_SERVER_API_KEY", "")
    monkeypatch.setenv("SCAN_AGENT_API_KEYS", "")
    with pytest.raises(RuntimeError, match="SCAN_"):
        ScanServerConfig.from_env()


def test_inventory_config_starts_with_bound_keys_only(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    for env_name in (
        "INVENTORY_SERVER_API_KEYS",
        "ITINV_AGENT_API_KEYS",
        "INVENTORY_SERVER_API_KEY",
        "ITINV_AGENT_API_KEY",
    ):
        monkeypatch.setenv(env_name, "")
    monkeypatch.setenv("INVENTORY_AGENT_API_KEYS", "ws-1=k1")
    config = InventoryServerConfig.from_env()
    assert config.api_keys == ()
    assert config.agent_api_keys == {"ws-1": "k1"}


def test_identity_check_is_case_insensitive(bound_scan_config, bound_inventory_config):
    # Windows hostnames are case-insensitive; agents report socket.gethostname() verbatim.
    scan_app._check_agent_identity("key-a", "HOST-A")
    with pytest.raises(HTTPException):
        scan_app._check_agent_identity("key-a", "host-b")
    inventory_app._check_agent_identity("inv-key-a", "WS-001")
    with pytest.raises(HTTPException):
        inventory_app._check_agent_identity("inv-key-a", "ws-002")


# --- Backend (port 8001) ingest paths: fs_egress + inventory routers ---


@pytest.fixture
def backend_bound_env(monkeypatch):
    monkeypatch.setenv("ITINV_AGENT_API_KEYS", "ring-key")
    monkeypatch.setenv("INVENTORY_AGENT_API_KEYS", "ws-001=inv-key-a, ws-002=inv-key-b")


def test_backend_runtime_bound_key_helpers(backend_bound_env):
    assert inventory_runtime._bound_agent_name_for_key("inv-key-a") == "ws-001"
    assert inventory_runtime._bound_agent_name_for_key("ring-key") == ""
    assert inventory_runtime._is_valid_agent_api_key("ring-key") is True
    assert inventory_runtime._is_valid_agent_api_key("inv-key-b") is True
    assert inventory_runtime._is_valid_agent_api_key("nope") is False
    assert inventory_runtime._bound_identity_matches("ws-001", "WS-001") is True
    assert inventory_runtime._bound_identity_matches("ws-001", "ws-002") is False
    # Enrollment binds gethostname() (full DNS name); probes send COMPUTERNAME
    # (NetBIOS, first 15 chars). Same machine must pass the identity check.
    assert inventory_runtime._bound_identity_matches("belg-enrgy-0001-d", "BELG-ENRGY-0001") is True
    assert inventory_runtime._bound_identity_matches("belg-enrgy-0001-d", "belg-enrgy-0001-d") is True
    # A different machine sharing no prefix relation must still fail.
    assert inventory_runtime._bound_identity_matches("belg-enrgy-0001-d", "belg-enrgy-0002") is False
    assert inventory_runtime._bound_identity_matches("ws-001", "ws-001-extra-long-name") is False
    assert inventory_runtime._bound_identity_matches("short-name", "short-nam") is False


def test_backend_receive_inventory_bound_key(bound_inventory_config, backend_bound_env, monkeypatch):
    from backend.api.v1 import inventory as web_inventory

    monkeypatch.setattr(
        inventory_runtime,
        "process_inventory_payload",
        lambda payload: {"success": True},
    )
    monkeypatch.setattr(inventory_runtime, "configure_runtime_hooks", lambda **kw: None)

    own = web_inventory.receive_inventory(
        inventory_runtime.InventoryPayload(hostname="ws-001", mac_address="AA", timestamp=1),
        x_api_key="inv-key-a",
    )
    assert own["success"] is True

    with pytest.raises(HTTPException) as exc_info:
        web_inventory.receive_inventory(
            inventory_runtime.InventoryPayload(hostname="ws-002", mac_address="AA", timestamp=1),
            x_api_key="inv-key-a",
        )
    assert exc_info.value.status_code == 401

    ring = web_inventory.receive_inventory(
        inventory_runtime.InventoryPayload(hostname="any-host", mac_address="AA", timestamp=1),
        x_api_key="ring-key",
    )
    assert ring["success"] is True


def test_backend_fs_egress_bound_key_scope(backend_bound_env):
    from backend.api.v1 import fs_egress as web_fs_egress

    assert web_fs_egress._is_valid_agent_api_key("inv-key-a") is True
    assert web_fs_egress._is_valid_agent_api_key("ring-key") is True

    # Own events (any hostname case) pass; foreign or empty names fail.
    web_fs_egress._check_egress_events_scope("inv-key-a", [{"computer_name": "WS-001"}])
    with pytest.raises(HTTPException) as exc_info:
        web_fs_egress._check_egress_events_scope(
            "inv-key-a", [{"computer_name": "ws-001"}, {"computer_name": "ws-002"}]
        )
    assert exc_info.value.status_code == 403
    with pytest.raises(HTTPException):
        web_fs_egress._check_egress_events_scope("inv-key-a", [{"foo": 1}])
    # Ring key is unconstrained while the fleet migrates.
    web_fs_egress._check_egress_events_scope("ring-key", [{"computer_name": "other"}])

    web_fs_egress._check_agent_identity("inv-key-a", "ws-001")
    with pytest.raises(HTTPException) as exc_info:
        web_fs_egress._check_agent_identity("inv-key-a", "ws-002")
    assert exc_info.value.status_code == 401


# --- Enrollment guard: rotate delivery pinned to enrollment IP; contested re-mint ---

import json

import sqlalchemy as sa
from cryptography.fernet import Fernet
from sqlalchemy.pool import StaticPool

from backend.appdb import agent_api_keys
from scan_server.database import ScanStore


@pytest.fixture
def fernet_env(monkeypatch):
    monkeypatch.setenv("MAIL_CREDENTIALS_KEY", Fernet.generate_key().decode())
    monkeypatch.delenv("MAIL_CREDENTIALS_KEY_LEGACY", raising=False)
    # Enrollment tests exercise the opt-in new-agent mint path.
    monkeypatch.setenv("SCAN_AGENT_KEY_AUTO_MINT_NEW", "1")
    from backend.services.secret_crypto_service import _build_fernet

    _build_fernet.cache_clear()
    yield
    _build_fernet.cache_clear()


def _fake_pg_engine(tmp_path):
    engine = sa.create_engine(
        f"sqlite:///{tmp_path / 'scan.sqlite'}",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.execute(sa.text(f"ATTACH DATABASE '{tmp_path / 'app.sqlite'}' AS app"))
        conn.execute(sa.text(
            "CREATE TABLE scan_agents ("
            "agent_id TEXT PRIMARY KEY, version TEXT, hostname TEXT, last_heartbeat_json TEXT)"
        ))
        conn.execute(sa.text(
            "CREATE TABLE scan_tasks ("
            "id TEXT PRIMARY KEY, agent_id TEXT, command TEXT, payload_json TEXT, "
            "status TEXT, created_at INTEGER, updated_at INTEGER, due_at INTEGER, "
            "ttl_at INTEGER, delivered_at INTEGER, acked_at INTEGER, completed_at INTEGER, "
            "attempt_count INTEGER, next_attempt_at INTEGER, dedupe_key TEXT, "
            "error_text TEXT, result_json TEXT)"
        ))
        conn.execute(sa.text(
            "CREATE TABLE agent_api_keys ("
            "agent_id TEXT PRIMARY KEY, hostname TEXT NOT NULL DEFAULT '', "
            "scan_key_sha256 TEXT, scan_key_enc TEXT, inv_key_sha256 TEXT, inv_key_enc TEXT, "
            "source TEXT NOT NULL DEFAULT 'auto', enroll_ip TEXT NOT NULL DEFAULT '', "
            "contested_count INTEGER NOT NULL DEFAULT 0, "
            "created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"
        ))
        conn.execute(sa.text("CREATE TABLE app.inventory_hosts (hostname TEXT)"))
        conn.execute(sa.text(
            "INSERT INTO scan_agents VALUES ('ws-a','1.4.22','WS-A','{}')"))
    return engine


def _fake_pg_store(tmp_path, engine):
    store = ScanStore(
        db_path=tmp_path / "store.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=60,
    )
    store.backend = "postgres"
    store._pg_engine = engine
    return store


def _rotate_tasks(engine, agent_id="ws-a"):
    with engine.connect() as conn:
        return conn.execute(
            sa.text("SELECT status, payload_json, dedupe_key FROM scan_tasks "
                    "WHERE agent_id=:n AND command='rotate_key' ORDER BY created_at"),
            {"n": agent_id},
        ).fetchall()


def test_enroll_mint_disabled_by_default(fernet_env, tmp_path, monkeypatch):
    monkeypatch.delenv("SCAN_AGENT_KEY_AUTO_MINT_NEW", raising=False)
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["enrolled"] is False and out["reason"] == "mint_disabled"
    assert agent_api_keys.get_row(engine, "ws-a") is None
    assert _rotate_tasks(engine) == []


def test_enroll_first_contact_mints_but_never_queues(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["enrolled"] is True and out["rotate_queued"] is False
    assert out["reason"] == "enrolling"
    state = agent_api_keys.get_row(engine, "ws-a")
    assert state["enroll_ip"] == "10.0.0.1"
    assert _rotate_tasks(engine) == []


def test_enroll_second_consistent_contact_queues_rotate(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["rotate_queued"] is True
    tasks = _rotate_tasks(engine)
    assert len(tasks) == 1 and tasks[0][0] == "queued"


def test_enroll_ip_change_requires_a_second_contact(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="9.9.9.9")
    assert out["rotate_queued"] is False and out["reason"] == "ip_changed"
    assert agent_api_keys.get_row(engine, "ws-a")["enroll_ip"] == "9.9.9.9"
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="9.9.9.9")
    assert out["rotate_queued"] is True


def test_contested_completed_rotate_remints_keys(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    old_sha = None
    with engine.begin() as conn:
        old_sha = conn.execute(
            sa.text("SELECT scan_key_sha256 FROM agent_api_keys WHERE agent_id='ws-a'")
        ).scalar()
        conn.execute(
            sa.text("UPDATE scan_tasks SET status='completed', completed_at=1 WHERE command='rotate_key'")
        )
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["contested"] is True and out["rotate_queued"] is True
    state = agent_api_keys.get_row(engine, "ws-a")
    assert state["contested_count"] == 1
    with engine.connect() as conn:
        new_sha = conn.execute(
            sa.text("SELECT scan_key_sha256 FROM agent_api_keys WHERE agent_id='ws-a'")
        ).scalar()
    assert new_sha != old_sha
    tasks = _rotate_tasks(engine)
    assert tasks[-1][2] == "rotate-key-ws-a-c1"


def test_contested_cap_stops_remint(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE agent_api_keys SET contested_count=5 WHERE agent_id='ws-a'"))
        conn.execute(sa.text(
            "INSERT INTO scan_tasks (id, agent_id, command, payload_json, status, "
            "created_at, updated_at, due_at, ttl_at, attempt_count, next_attempt_at, dedupe_key) "
            "VALUES ('t1','ws-a','rotate_key','{}','completed',1,1,1,99999999,1,1,'rotate-key-ws-a-c5')"))
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["contested"] is True and out["rotate_queued"] is False
    assert out["reason"] == "contested_cap"


@pytest.mark.parametrize("pending_status", ["queued", "delivered", "acknowledged"])
@pytest.mark.parametrize("counter", [1, 5])
def test_old_completed_rotation_does_not_replace_pending_keys(
    fernet_env, tmp_path, pending_status, counter
):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    with engine.begin() as conn:
        conn.execute(sa.text("UPDATE scan_tasks SET status='completed',completed_at=1"))
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE agent_api_keys SET contested_count=:counter"
        ), {"counter": counter})
        conn.execute(sa.text(
            "UPDATE scan_tasks SET status=:s,delivered_at=:ts,dedupe_key=:dedupe "
            "WHERE dedupe_key='rotate-key-ws-a-c1'"
        ), {"s": pending_status, "ts": int(time.time()), "dedupe": f"rotate-key-ws-a-c{counter}"})
    pair = agent_api_keys.get_keypair(engine, "ws-a")
    before = _rotate_tasks(engine)
    for _ in range(3):
        store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert agent_api_keys.get_row(engine, "ws-a")["contested_count"] == counter
    assert bool(agent_api_keys.get_keypair(engine, "ws-a") == pair)
    assert _rotate_tasks(engine) == before


def test_missing_current_rotation_reuses_keys_not_old_completed_generation(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    with engine.begin() as conn:
        conn.execute(sa.text("UPDATE scan_tasks SET status='completed',completed_at=1"))
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    pair = agent_api_keys.get_keypair(engine, "ws-a")
    # A failed/expired delivery must not make an older generation revoke this pair.
    with engine.begin() as conn:
        conn.execute(sa.text(
            "UPDATE scan_tasks SET status='expired',payload_json='{}' "
            "WHERE dedupe_key='rotate-key-ws-a-c1'"
        ))
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["rotate_queued"] is True
    assert agent_api_keys.get_row(engine, "ws-a")["contested_count"] == 1
    assert bool(agent_api_keys.get_keypair(engine, "ws-a") == pair)
    tasks = _rotate_tasks(engine)
    assert sum(t[0] == "queued" and t[2] == "rotate-key-ws-a-c1" for t in tasks) == 1


def test_enroll_ignores_source_port_and_accepts_existing_port_pin(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1:50000")
    assert agent_api_keys.get_row(engine, "ws-a")["enroll_ip"] == "10.0.0.1"
    with engine.begin() as conn:
        conn.execute(sa.text("UPDATE agent_api_keys SET enroll_ip='10.0.0.1:50000'"))
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1:50001")
    assert out["rotate_queued"] is True
    assert agent_api_keys.get_row(engine, "ws-a")["enroll_ip"] == "10.0.0.1:50000"


@pytest.mark.parametrize(
    "pin,source,allowed",
    [
        ("10.0.0.1:50000", "10.0.0.1:50001", True),
        ("10.0.0.1:50000", "10.0.0.1", True),
        ("10.0.0.1:50000", "10.0.0.2:50000", False),
        ("10.0.0.1:50000", "", False),
        ("10.0.0.1:50000", "invalid", False),
        ("invalid", "invalid", False),
        ("[2001:db8::1]:50000", "[2001:0db8::1]:50001", True),
        ("[2001:db8::1]:50000", "2001:db8::2", False),
        ("10.0.0.1:50000", "10.0.0.1:99999", False),
    ],
)
def test_rotate_delivery_uses_ip_not_connection_port(tmp_path, monkeypatch, pin, source, allowed):
    store = ScanStore(
        db_path=tmp_path / "store.db", archive_dir=tmp_path / "archive", task_ack_timeout_sec=60
    )
    created = store.create_task(agent_id="ws-a", command="rotate_key", payload={})
    monkeypatch.setattr(store, "_rotate_delivery_ip", lambda aid: pin)
    tasks = store.poll_tasks(agent_id="ws-a", limit=5, source_ip=source)
    assert [t["task_id"] for t in tasks] == ([created["id"]] if allowed else [])
    with store._connect() as conn:
        row = conn.execute(
            "SELECT status,attempt_count FROM scan_tasks WHERE id=?", (created["id"],)
        ).fetchone()
    assert row["status"] == ("delivered" if allowed else "queued")
    assert row["attempt_count"] == int(allowed)


def _set_stored_mac(engine, mac):
    hb = json.dumps({"metadata": {"mac_address": mac}})
    with engine.begin() as conn:
        conn.execute(
            sa.text("UPDATE scan_agents SET last_heartbeat_json=:hb WHERE agent_id='ws-a'"),
            {"hb": hb},
        )


def test_enroll_mac_mismatch_blocks_mint(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    _set_stored_mac(engine, "AA:BB:CC:DD:EE:FF")
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="9.9.9.9", source_mac="11:22:33:44:55:66")
    assert out["rotate_queued"] is False and out["reason"] == "mac_mismatch"
    assert agent_api_keys.get_row(engine, "ws-a") is None


def test_enroll_stored_mac_requires_mac_bearing_request(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    _set_stored_mac(engine, "AA:BB:CC:DD:EE:FF")
    out = store.maybe_enroll_agent_keys("ws-a", source_ip="10.0.0.1")
    assert out["rotate_queued"] is False and out["reason"] == "awaiting_identity"
    assert agent_api_keys.get_row(engine, "ws-a") is None


def test_enroll_matching_mac_proceeds(fernet_env, tmp_path):
    engine = _fake_pg_engine(tmp_path)
    store = _fake_pg_store(tmp_path, engine)
    _set_stored_mac(engine, "aa-bb-cc-dd-ee-ff")
    out = store.maybe_enroll_agent_keys(
        "ws-a", source_ip="10.0.0.1", source_mac="AA:BB:CC:DD:EE:FF")
    assert out["enrolled"] is True and out["reason"] == "enrolling"
    out = store.maybe_enroll_agent_keys(
        "ws-a", source_ip="10.0.0.1", source_mac="AA-BB-CC-DD-EE-FF")
    assert out["rotate_queued"] is True


def test_rotate_delivery_pinned_to_enroll_ip(monkeypatch, tmp_path):
    store = ScanStore(
        db_path=tmp_path / "store.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=60,
    )
    store.create_task(
        agent_id="ws-a", command="rotate_key", payload={"scan_api_key": "k"}, dedupe_key="r1"
    )
    monkeypatch.setattr(store, "_rotate_delivery_ip", lambda aid: "10.0.0.1")
    assert store.poll_tasks(agent_id="ws-a", limit=5, source_ip="9.9.9.9") == []
    delivered = store.poll_tasks(agent_id="ws-a", limit=5, source_ip="10.0.0.1")
    assert [t["command"] for t in delivered] == ["rotate_key"]


def test_report_result_scrubs_rotate_payload(tmp_path):
    store = ScanStore(
        db_path=tmp_path / "store.db",
        archive_dir=tmp_path / "archive",
        task_ack_timeout_sec=60,
    )
    created = store.create_task(
        agent_id="ws-a",
        command="rotate_key",
        payload={"scan_api_key": "secret", "itinv_api_key": "secret2"},
        dedupe_key="r1",
    )
    store.poll_tasks(agent_id="ws-a", limit=5)
    store.report_task_result(
        agent_id="ws-a", task_id=created["id"], status="completed", result={}, error_text=None
    )
    with store._connect() as conn:
        payload = conn.execute(
            "SELECT payload_json FROM scan_tasks WHERE id=?", (created["id"],)
        ).fetchone()[0]
    assert payload == "{}"


def test_inventory_bound_key_cannot_write_foreign_mac(bound_inventory_config, monkeypatch):
    monkeypatch.setattr(
        inventory_app.inventory_runtime,
        "_get_inventory_host",
        lambda mac: {"hostname": "WS-OTHER", "mac_address": mac},
    )
    # own hostname + foreign MAC (card owned by another host) -> rejected
    with pytest.raises(HTTPException) as exc_info:
        inventory_app._check_agent_inventory_binding("inv-key-a", "00:11:22:33:44:66")
    assert exc_info.value.status_code == 403


def test_inventory_bound_key_allows_own_or_new_mac(bound_inventory_config, monkeypatch):
    monkeypatch.setattr(
        inventory_app.inventory_runtime,
        "_get_inventory_host",
        lambda mac: {"hostname": "ws-001", "mac_address": mac} if mac == "AA" else None,
    )
    inventory_app._check_agent_inventory_binding("inv-key-a", "AA")  # own card — ok
    inventory_app._check_agent_inventory_binding("inv-key-a", "BB")  # unregistered MAC — ok
    # ring key — no binding check at all
    inventory_app._check_agent_inventory_binding("ring-key", "AA")


def test_create_task_endpoint_rebuilds_rotate_payload(bound_scan_config, monkeypatch):
    captured = {}
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(
            rotate_payload_for_agent=lambda aid: {"scan_api_key": "s-real", "itinv_api_key": "i-real"},
            create_task=lambda **kw: captured.update(kw) or {"id": "t1"},
        ),
    )
    out = scan_app.create_task(
        payload=scan_app.TaskCreatePayload(
            agent_id="ws-a",
            command="rotate_key",
            payload={"scan_api_key": "EVIL", "itinv_api_key": "EVIL"},
        ),
        _={},
    )
    assert out["success"] is True
    assert captured["payload"] == {"scan_api_key": "s-real", "itinv_api_key": "i-real"}


def test_create_task_endpoint_rotate_rejects_unenrolled(bound_scan_config, monkeypatch):
    monkeypatch.setattr(
        scan_app,
        "store",
        SimpleNamespace(rotate_payload_for_agent=lambda aid: None),
    )
    with pytest.raises(HTTPException) as exc_info:
        scan_app.create_task(
            payload=scan_app.TaskCreatePayload(agent_id="ws-x", command="rotate_key", payload={}),
            _={},
        )
    assert exc_info.value.status_code == 409
