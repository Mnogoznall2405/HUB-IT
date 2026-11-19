from __future__ import annotations

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fs_egress.events import build_file_left
from fs_egress.roots import should_ignore_path
from fs_egress.spool import EgressSpool
from fs_egress import service as egress_service
from inventory_server.egress_store import EgressEventStore
from shared import upload_retry


def test_running_egress_picks_up_rotated_key_and_releases_auth_backoff(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: high)
    monkeypatch.setenv("ITINV_AGENT_API_KEY", "old-isolated-key")
    monkeypatch.setenv("ITINV_FS_EGRESS_ENABLED", "1")
    monkeypatch.setenv("ITINV_FS_EGRESS_DRAIN_SEC", "3")
    monkeypatch.setenv("ITINV_FS_EGRESS_SERVER_URL", "http://egress.invalid")
    monkeypatch.setattr(egress_service, "spool_root_from_env", lambda: tmp_path)
    pending = EgressSpool(tmp_path).enqueue({"event_id": "rotating", "computer_name": "PC-1"})
    monitor = SimpleNamespace(
        start=lambda: None, stop=lambda: None, flush_due=lambda: None,
        refresh_if_due=lambda **kwargs: kwargs["last_refresh"], dropped=0,
    )
    monkeypatch.setattr(egress_service, "FsEgressMonitor", lambda *args, **kwargs: monitor)
    uploads = []

    def send(session, request, **kwargs):
        key = request.headers["X-API-Key"]
        uploads.append(key)
        response = requests.Response()
        response.status_code = 200 if key == "new-isolated-key" else 401
        response._content = b'{"success":true,"inserted":1}'
        return response

    monkeypatch.setattr(requests.Session, "send", send)
    sleeps = []

    class StopLoop(Exception):
        pass

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 2:
            assert pending.exists()
            monkeypatch.setenv("ITINV_AGENT_API_KEY", "new-isolated-key")
        clock[0] += 3
        if len(sleeps) == 4:
            raise StopLoop

    monkeypatch.setattr(egress_service.time, "sleep", sleep)
    with pytest.raises(StopLoop):
        egress_service.run_fs_egress_forever()
    assert uploads == ["old-isolated-key", "new-isolated-key"]
    assert not pending.exists()
    assert (tmp_path / "sent" / pending.name).exists()


@pytest.mark.parametrize("status,retry_after,delay", [
    (503, "90", 93),
    (503, "Thu, 01 Jan 1970 00:18:10 GMT", 93),
    (401, None, 900),
])
def test_spool_paces_retries_and_keeps_unacknowledged_event(
    tmp_path, monkeypatch, status, retry_after, delay
):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "time", lambda: 1000.0)
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: high)

    class Endpoint(requests.adapters.BaseAdapter):
        def __init__(self):
            self.uploads = []

        def send(self, request, **kwargs):
            self.uploads.append(json.loads(request.body))
            response = requests.Response()
            response.status_code = status if len(self.uploads) == 1 else 200
            response._content = b'{"success": true, "inserted": 1}'
            if retry_after:
                response.headers["Retry-After"] = retry_after
            return response

        def close(self):
            pass

    spool = EgressSpool(tmp_path, server_url="http://egress.invalid", api_key="test")
    endpoint = Endpoint()
    spool._session.mount("http://egress.invalid/", endpoint)
    pending = spool.enqueue({"event_id": "retry-1", "computer_name": "PC-1"})
    original = pending.read_bytes()
    spool.drain()
    assert not endpoint.uploads
    clock[0] += 3
    assert spool.drain()["failed"] == 1
    clock[0] += delay - 1
    spool.drain()
    assert len(endpoint.uploads) == 1
    assert pending.read_bytes() == original
    clock[0] += 1
    assert spool.drain()["sent"] == 1
    assert endpoint.uploads[0] == endpoint.uploads[1]
    assert not pending.exists()
    assert (spool.sent / pending.name).read_bytes() == original


@pytest.mark.parametrize("reply", [b'{"success": false}', b"<html>proxy error</html>"])
def test_spool_requires_ack_before_removing_pending_event(tmp_path, monkeypatch, reply):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: low)
    spool = EgressSpool(tmp_path, server_url="http://egress.invalid", api_key="test")
    pending = spool.enqueue({"event_id": "unconfirmed"})
    original = pending.read_bytes()
    attempts = []

    class Endpoint(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            attempts.append(request.body)
            response = requests.Response()
            response.status_code = 200
            response._content = reply
            return response

        def close(self):
            pass

    spool._session.mount("http://egress.invalid/", Endpoint())
    assert spool.drain()["failed"] == 1
    for _ in range(5):
        spool.drain()
    assert len(attempts) == 1
    assert pending.read_bytes() == original
    assert not list(spool.sent.glob("*.json"))


def test_network_failure_backs_off_without_losing_pending_event(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: high)
    spool = EgressSpool(tmp_path, server_url="http://egress.invalid", api_key="test")
    pending = spool.enqueue({"event_id": "offline"})
    attempts = []

    class Endpoint(requests.adapters.BaseAdapter):
        def send(self, request, **kwargs):
            attempts.append(clock[0])
            raise requests.ConnectionError("offline")

        def close(self):
            pass

    spool._session.mount("http://egress.invalid/", Endpoint())
    clock[0] += 3
    spool.drain()
    clock[0] += 5
    spool.drain()
    assert len(attempts) == 1
    clock[0] += 1
    spool.drain()
    clock[0] += 11
    spool.drain()
    assert len(attempts) == 2
    clock[0] += 1
    spool.drain()
    assert len(attempts) == 3
    assert pending.is_file()


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



def test_failed_dead_letter_move_keeps_the_pending_event(tmp_path: Path, monkeypatch):
    """DINT-02: a refused move must not delete the only durable copy."""
    import shutil

    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    pending = spool.enqueue({"event_id": "e1", "ts": 1, "channel": "network", "file_name": "a.pdf", "dest_path": "x"})
    original = pending.read_bytes()

    def refuse(*args, **kwargs):
        raise OSError("access denied")

    monkeypatch.setattr(shutil, "move", refuse)
    assert spool._move(pending, spool.dead) is False
    assert pending.read_bytes() == original
    assert list(spool.dead.glob("*.json")) == []

    monkeypatch.undo()
    assert spool._move(pending, spool.dead) is True
    assert not pending.exists() and (spool.dead / pending.name).read_bytes() == original


def test_unreadable_network_file_does_not_stop_other_due_events(tmp_path: Path, monkeypatch):
    """DINT-03: PermissionError on one path's metadata must not break the flush or drop the rest."""
    from fs_egress.monitor import FsEgressMonitor

    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    monitor = FsEgressMonitor(spool, debounce_sec=0.0, rate_limit_per_sec=100, roots_refresh_sec=1000.0,
                              watch_profile_deletes=False)
    good = tmp_path / "good.docx"
    good.write_bytes(b"data")
    bad = tmp_path / "locked.docx"
    bad.write_bytes(b"data")
    real_is_file = Path.is_file

    def is_file(self):
        if self.name == "locked.docx":
            raise PermissionError(5, "Access is denied")
        return real_is_file(self)

    monkeypatch.setattr(Path, "is_file", is_file)
    monitor._pending[f"usb|{str(bad).lower()}"] = (0.0, "usb", "", f"created|{bad}")
    monitor._pending[f"usb|{str(good).lower()}"] = (0.0, "usb", "", f"created|{good}")

    assert monitor.flush_due() == 2
    events = [json.loads(path.read_text(encoding="utf-8")) for path in spool.pending.glob("*.json")]
    by_name = {event["file_name"]: event for event in events}
    assert by_name["locked.docx"]["details"]["metadata_unavailable"] is True
    assert not by_name["locked.docx"]["sha256"]
    assert by_name["good.docx"]["sha256"]


def test_temp_copy_names_dropped_on_all_channels(tmp_path: Path):
    """Copy staging and backup/lock names (.tmp, .crdownload, ~$, *.bak,
    *.spr.lock...) are noise on every channel, including deletions."""
    from fs_egress.monitor import FsEgressMonitor

    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    monitor = FsEgressMonitor(spool, debounce_sec=0.0, watch_profile_deletes=False)
    temp_names = (
        "copy.tmp", "video.crdownload", "arc.part", "x.partial",
        "y.download", "~$doc.docx", "~WRL0001.tmp", ".~lock.report.csv#",
        "ОЗ_2026-11-13.spr.bak", "ОЗ_2026-11-12.spr.lock",
        "ОЗ_2026-11-13.spr.AutoSave", "ОЗ_2026-11-12.spr.SCADModelColor",
        "plan.dwl2", "plan.dwl", "120.41.sqlitedb-wal", "120.41.sqlitedb-shm",
        "черновик.pav~", "Thumbs.db", "desktop.ini", "_2wn9.frq", "_2wn3.cfs",
        "minidump.dmp", "old.dwl.old", "swap.swp",
    )
    for name in temp_names:
        monitor.offer(rf"E:\{name}", channel="usb", kind="created")
        monitor.offer(rf"Z:\{name}", channel="network", kind="created")
        monitor.offer(rf"C:\Users\u\Documents\{name}", channel="deleted", kind="deleted")
    monitor.offer(r"E:\reports\final.docx", channel="usb", kind="created")
    monitor.offer(r"C:\Users\u\Documents\final.docx", channel="deleted", kind="deleted")
    monitor.offer(r"C:\Users\u\Documents\_notes.docx", channel="deleted", kind="deleted")

    assert monitor.flush_due() == 3
    names = {
        json.loads(p.read_text(encoding="utf-8"))["file_name"]
        for p in spool.pending.glob("*.json")
    }
    assert names == {"final.docx", "_notes.docx"}


def test_moved_events_only_when_destination_enters_root():
    """A rename inside one watched volume is not another egress; a move onto the
    watched root (or a temp→final rename completing a copy inside it) is."""
    from fs_egress.monitor import _EgressHandler

    seen: list[tuple[str, dict]] = []
    monitor = SimpleNamespace(offer=lambda path, **kw: seen.append((path, kw)))
    usb = _EgressHandler(monitor, channel="usb", root=Path("E:\\"))
    net = _EgressHandler(monitor, channel="network", root=Path(r"\\srv\share"))

    def move(handler, src, dest, *, is_directory=False):
        handler.on_moved(
            SimpleNamespace(is_directory=is_directory, src_path=src, dest_path=dest)
        )

    move(usb, r"E:\dir", r"E:\dir2", is_directory=True)
    move(usb, r"E:\a.docx", r"E:\b.docx")                      # in-place rename — no event
    move(usb, r"E:\a.docx", r"C:\a.docx")                      # leaves the root — no event
    move(usb, r"E:\a.tmp", r"E:\a.docx")                       # temp→final completes a copy
    move(usb, r"C:\b.docx", r"E:\b.docx")                      # copied onto the volume
    move(net, r"\\srv\share\a.docx", r"\\srv\share\b.docx")    # rename inside share
    move(net, r"C:\c.docx", r"\\srv\share\c.docx")             # moved to share

    assert seen == [
        (
            r"E:\a.docx",
            {"channel": "usb", "kind": "moved", "src_path": r"E:\a.tmp"},
        ),
        (
            r"E:\b.docx",
            {"channel": "usb", "kind": "moved", "src_path": r"C:\b.docx"},
        ),
        (
            r"\\srv\share\c.docx",
            {"channel": "network", "kind": "moved", "src_path": r"C:\c.docx"},
        ),
    ]

def test_usb_event_records_foreground_app(tmp_path: Path, monkeypatch):
    """fs_egress stamps the foreground app as context on usb/deleted events."""
    from fs_egress import monitor as mon
    from fs_egress.monitor import FsEgressMonitor

    spool = EgressSpool(tmp_path / "spool", server_url="", api_key="")
    monitor = FsEgressMonitor(spool, debounce_sec=0.0, watch_profile_deletes=False)
    monkeypatch.setattr(mon, "_foreground_exe", lambda: "1cv8.exe")
    monitor.offer(r"E:\reports\report.xlsx", channel="usb", kind="created")
    monitor.offer(r"C:\Users\u\Documents\old.docx", channel="deleted", kind="deleted")
    assert monitor.flush_due() == 2
    payloads = [json.loads(p.read_text(encoding="utf-8")) for p in spool.pending.glob("*.json")]
    by_channel = {e["channel"]: e for e in payloads}
    assert by_channel["usb"]["details"]["fg_exe"] == "1cv8.exe"
    assert by_channel["deleted"]["details"]["fg_exe"] == "1cv8.exe"

    monkeypatch.setattr(mon, "_foreground_exe", lambda: "")
    monitor.offer(r"E:\reports\no_fg.txt", channel="usb", kind="created")
    assert monitor.flush_due() == 1
    payload = json.loads(next(p for p in spool.pending.glob("*.json")
                              if json.loads(p.read_text(encoding="utf-8"))["file_name"] == "no_fg.txt")
                        .read_text(encoding="utf-8"))
    assert "fg_exe" not in payload["details"]
