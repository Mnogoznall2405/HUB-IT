from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fs_egress.events import build_file_left
from fs_egress.roots import should_ignore_path
from fs_egress.spool import EgressSpool
from inventory_server.egress_store import EgressEventStore


def test_should_ignore_temp_and_recycle():
    assert should_ignore_path(r"C:\Users\a\AppData\Local\Temp\x.txt")
    assert should_ignore_path(r"E:\$RECYCLE.BIN\foo")
    assert not should_ignore_path(r"E:\reports\q2.xlsx")


def test_build_file_left_fields(tmp_path: Path):
    sample = tmp_path / "secret.docx"
    sample.write_bytes(b"hello-doc")
    event = build_file_left(
        channel="usb",
        dest_path=str(sample),
        compute_hash=True,
    )
    assert event.channel == "usb"
    assert event.file_name == "secret.docx"
    assert event.size == 9
    assert event.sha256
    assert event.event_id


def test_spool_enqueue_and_inbox(tmp_path: Path):
    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    event = build_file_left(channel="network", dest_path=r"\\srv\share\a.pdf", file_name="a.pdf")
    path = spool.enqueue(event.to_dict())
    assert path.exists()
    inbox_item = {
        "event_id": "tg1",
        "ts": 1,
        "channel": "telegram",
        "file_name": "x.bin",
        "dest_path": "telegram:Ivan",
    }
    (spool.inbox / "one.json").write_text(json.dumps(inbox_item), encoding="utf-8")
    assert spool.ingest_inbox() == 1
    pending = list(spool.pending.glob("*.json"))
    assert len(pending) >= 2


def test_egress_store_roundtrip(tmp_path: Path):
    store = EgressEventStore(db_path=tmp_path / "e.db")
    n = store.ingest_file_left(
        [
            {
                "event_id": "e1",
                "ts": 100,
                "channel": "usb",
                "file_name": "a.txt",
                "dest_path": r"E:\a.txt",
                "computer_name": "PC1",
                "windows_user": "u1",
            }
        ]
    )
    assert n == 1
    rows = store.list_file_left(computer_name="PC1", channel="usb")
    assert len(rows) == 1
    assert rows[0]["file_name"] == "a.txt"


def test_extract_outgoing_telegram_file():
    sys.path.insert(0, str(ROOT / "telegram_uia_probe"))
    from telegram_probe.sync import extract_outgoing_file_left

    events = extract_outgoing_file_left(
        [
            {
                "direction": "outgoing",
                "media": "Файл, dogovor.docx (12 КБ)",
                "text": "",
            },
            {
                "direction": "incoming",
                "media": "Файл, other.docx",
            },
            {
                "direction": "outgoing",
                "text": "просто текст",
            },
        ],
        chat_name="Иван",
        windows_user="u",
        computer_name="PC",
    )
    assert len(events) == 1
    assert events[0]["channel"] == "telegram"
    assert "dogovor.docx" in events[0]["file_name"]
    assert events[0]["dest_path"] == "telegram:Иван"


def test_profile_delete_offer_enqueues(tmp_path: Path):
    from fs_egress.monitor import FsEgressMonitor
    from fs_egress.spool import EgressSpool

    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    monitor = FsEgressMonitor(spool, debounce_sec=0.0, watch_profile_deletes=False)
    monitor.offer(r"C:\Users\u\Documents\secret.xlsx", channel="deleted", kind="deleted")
    assert monitor.flush_due() == 1
    pending = list(spool.pending.glob("*.json"))
    assert len(pending) == 1
    payload = json.loads(pending[0].read_text(encoding="utf-8"))
    assert payload["channel"] == "deleted"

