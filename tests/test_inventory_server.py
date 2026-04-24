from __future__ import annotations

import threading
from pathlib import Path
import sys

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend import inventory_runtime
from backend.appdb.inventory_store import AppInventoryStore
from inventory_server import app as app_module
from inventory_server.config import InventoryServerConfig
from inventory_server.database import InventoryQueueStore
from inventory_server.worker import InventoryWorker


def _sqlite_url(temp_dir: str) -> str:
    return f"sqlite:///{(Path(temp_dir) / 'inventory_app.db').as_posix()}"


def _payload(*, timestamp: int, monitor_serial: str = "MON-1") -> dict:
    return {
        "hostname": "PC-INV-01",
        "system_serial": "SYS-INV-01",
        "mac_address": "AA-BB-CC-DD-EE-10",
        "current_user": "CORP\\tester",
        "user_login": "CORP\\tester",
        "user_full_name": "Tester T.T.",
        "ip_primary": "10.10.10.10",
        "ip_list": ["10.10.10.10"],
        "cpu_model": "CPU1",
        "ram_gb": 16,
        "monitors": [{"serial_number": monitor_serial}],
        "storage": [{"serial_number": "SSD-1"}],
        "logical_disks": [{"mountpoint": "C:\\"}],
        "report_type": "full_snapshot",
        "timestamp": timestamp,
    }


def _worker_config(temp_dir: str) -> InventoryServerConfig:
    data_dir = Path(temp_dir) / "inventory_server"
    return InventoryServerConfig(
        host="127.0.0.1",
        port=8012,
        api_keys=("test-key",),
        data_dir=data_dir,
        db_path=data_dir / "queue.db",
        worker_interval_sec=1,
        batch_size=10,
        max_attempts=2,
        backoff_cap_sec=1,
    )


def test_queue_enqueue_is_idempotent(temp_dir):
    store = InventoryQueueStore(db_path=Path(temp_dir) / "queue.db")
    payload = _payload(timestamp=1_710_100_000)
    dedupe_key = inventory_runtime.build_inventory_dedupe_key(payload)

    first = store.enqueue(payload, dedupe_key)
    second = store.enqueue(payload, dedupe_key)
    stats = store.queue_stats()

    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert stats["queue_depth"] == 1
    assert stats["dead_letter_count"] == 0


def test_worker_flushes_queue_into_app_db(temp_dir, monkeypatch):
    database_url = _sqlite_url(temp_dir)
    store = InventoryQueueStore(db_path=Path(temp_dir) / "queue.db")
    config = _worker_config(temp_dir)

    monkeypatch.setattr(inventory_runtime, "is_app_database_configured", lambda: True)
    monkeypatch.setattr(inventory_runtime, "get_app_database_url", lambda: database_url)
    monkeypatch.setattr(
        inventory_runtime,
        "get_local_store",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("local_store should not be used")),
    )

    payload_v1 = _payload(timestamp=1_710_100_000, monitor_serial="MON-1")
    payload_v2 = _payload(timestamp=1_710_100_120, monitor_serial="MON-2")
    store.enqueue(payload_v1, inventory_runtime.build_inventory_dedupe_key(payload_v1))
    store.enqueue(payload_v2, inventory_runtime.build_inventory_dedupe_key(payload_v2))

    worker = InventoryWorker(store=store, config=config, stop_event=threading.Event())
    for item in store.claim_next_batch(limit=10):
        worker._handle_item(item)

    app_store = AppInventoryStore(database_url=database_url)
    host = app_store.get_host("AA-BB-CC-DD-EE-10")
    changes = app_store.list_change_events()

    assert host is not None
    assert host["timestamp"] == 1_710_100_120
    assert host["monitors"][0]["serial_number"] == "MON-2"
    assert len(changes) == 1
    assert changes[0]["change_types"] == ["monitors"]
    assert store.queue_stats()["queue_depth"] == 0


def test_worker_moves_repeated_failures_to_dead_letter(temp_dir, monkeypatch):
    store = InventoryQueueStore(db_path=Path(temp_dir) / "queue.db")
    config = _worker_config(temp_dir)
    payload = _payload(timestamp=1_710_100_000)
    queued = store.enqueue(payload, inventory_runtime.build_inventory_dedupe_key(payload))
    queue_id = queued["id"]

    def _boom(_: dict) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(inventory_runtime, "process_inventory_payload", _boom)

    worker = InventoryWorker(store=store, config=config, stop_event=threading.Event())
    first_item = store.claim_next_batch(limit=1)[0]
    worker._handle_item(first_item)
    stats_after_retry = store.queue_stats()

    worker._handle_item({"id": queue_id, "payload": payload, "attempt_count": 1})
    stats_after_dead = store.queue_stats()

    assert stats_after_retry["queue_depth"] == 1
    assert stats_after_retry["dead_letter_count"] == 0
    assert stats_after_dead["queue_depth"] == 0
    assert stats_after_dead["dead_letter_count"] == 1


def test_inventory_app_enqueues_and_reports_health(temp_dir, monkeypatch):
    class FakeWorker:
        def __init__(self) -> None:
            self._alive = False
            self.last_successful_flush_at = 123

        def is_alive(self) -> bool:
            return self._alive

        def start(self) -> None:
            self._alive = True

        def join(self, timeout: float | None = None) -> None:
            self._alive = False

    fake_store = InventoryQueueStore(db_path=Path(temp_dir) / "queue.db")
    fake_worker = FakeWorker()

    monkeypatch.setattr(app_module, "store", fake_store)
    monkeypatch.setattr(app_module, "worker", fake_worker)
    monkeypatch.setattr(app_module, "stop_event", threading.Event())
    monkeypatch.setattr(app_module, "_check_agent_key", lambda _: None)

    with TestClient(app_module.app) as client:
        post_response = client.post("/api/v1/inventory", json=_payload(timestamp=1_710_100_000))
        health_response = client.get("/health")

    assert post_response.status_code == 200
    assert post_response.json()["queued"] is True
    assert post_response.json()["duplicate"] is False
    assert health_response.status_code == 200
    assert health_response.json()["queue_depth"] == 1
    assert health_response.json()["worker_alive"] is True
