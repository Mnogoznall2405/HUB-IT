import json
import os
import time

import pytest
import requests

from browser_probe import sync
from shared import upload_retry


class UploadEndpoint(requests.adapters.BaseAdapter):
    def __init__(self, *statuses, on_send=None, retry_after=None):
        self.statuses = iter(statuses)
        self.on_send = on_send
        self.uploads = []
        self.retry_after = retry_after

    def send(self, request, **kwargs):
        self.uploads.append((len(request.body), json.loads(request.body)))
        if self.on_send:
            self.on_send()
        status = next(self.statuses)
        response = requests.Response()
        response.status_code = status
        if self.retry_after:
            response.headers["Retry-After"] = self.retry_after
        response._content = json.dumps({
            "success": status == 200,
            "media": len(self.uploads[-1][1]["media"]) if status == 200 else 0,
        }).encode("utf-8")
        return response

    def close(self):
        pass


def _open_syncer(path, endpoint):
    syncer = sync.BrowserProbeSync(path, server_url="http://probe.invalid", api_key="test")
    syncer._session.mount("http://probe.invalid/", endpoint)
    return syncer


def test_periodic_upload_waits_for_startup_jitter(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: high)
    endpoint = UploadEndpoint(200)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({"visits": [{"visit_id": 1}]})
    syncer.maybe_sync()
    assert not endpoint.uploads
    clock[0] += 120
    syncer.maybe_sync()
    assert endpoint.uploads[0][1]["visits"] == [{"visit_id": 1}]


@pytest.mark.parametrize("status,retry_after,delay", [
    (503, "600", 720),
    (429, "600", 720),
    (401, None, 900),
])
def test_periodic_retry_keeps_payload_and_honors_server_delay(
    tmp_path, monkeypatch, status, retry_after, delay
):
    clock = [1000.0]
    monkeypatch.setattr(upload_retry, "monotonic", lambda: clock[0])
    monkeypatch.setattr(upload_retry, "uniform", lambda low, high: high)
    endpoint = UploadEndpoint(status, 200, retry_after=retry_after)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({"visits": [{"visit_id": 1}]})
    clock[0] += 120
    syncer.maybe_sync()
    original = (tmp_path / "inflight_upload.json").read_bytes()
    clock[0] += delay - 1
    syncer.maybe_sync(force=True)
    assert len(endpoint.uploads) == 1
    assert (tmp_path / "inflight_upload.json").read_bytes() == original
    clock[0] += 1
    syncer.maybe_sync()
    assert len(endpoint.uploads) == 2
    assert endpoint.uploads[0] == endpoint.uploads[1]
    assert not (tmp_path / "inflight_upload.json").exists()


def test_upload_cycle_bounds_backlog_and_keeps_unsent_records(tmp_path, monkeypatch):
    monkeypatch.setattr(sync, "MAX_BATCH_BYTES", 600)
    endpoint = UploadEndpoint(*([200] * 20))
    syncer = _open_syncer(tmp_path, endpoint)
    records = [{"visit_id": i, "title": "x" * 250} for i in range(10)]
    syncer.enqueue({"visits": records})
    syncer.sync_once()
    assert 0 < len(endpoint.uploads) <= 4
    remaining = json.loads((tmp_path / "inflight_upload.json").read_text(encoding="utf-8"))["visits"]
    accepted = [row for _, payload in endpoint.uploads for row in payload["visits"]]
    assert accepted + remaining == records
    while (tmp_path / "inflight_upload.json").exists():
        syncer.sync_once()
    assert [row for _, payload in endpoint.uploads for row in payload["visits"]] == records


def test_failed_batch_retries_after_restart_without_resending_acknowledged_data(tmp_path, monkeypatch):
    monkeypatch.setattr(sync, "MAX_BATCH_BYTES", 1800)
    names = ["first.png", "second.png", "third.png"]
    for name in names:
        (tmp_path / name).write_bytes(b"x" * 768)
    endpoint = UploadEndpoint(200, 503)
    syncer = _open_syncer(tmp_path, endpoint)
    visits = [{"visit_id": 1, "title": "Запись"}]
    focus_events = [{"event_id": "focus-fixture-1", "title": "Окно", "dwell_sec": 3}]
    syncer.enqueue({
        "visits": visits,
        "focus_events": focus_events,
        "screenshots": [{"file": name} for name in names],
    })

    with pytest.raises(RuntimeError, match="HTTP 503"):
        syncer.sync_once()

    retry = UploadEndpoint(200, 200)
    _open_syncer(tmp_path, retry).sync_once()

    accepted = endpoint.uploads[:1] + retry.uploads
    assert all(size <= 1800 for size, _ in endpoint.uploads + retry.uploads)
    assert [event for _, body in accepted for event in body["visits"]] == visits
    assert [event for _, body in accepted for event in body["focus_events"]] == focus_events
    assert [media["name"] for _, body in accepted for media in body["media"]] == names
    assert endpoint.uploads[1] == retry.uploads[0]


def test_event_collected_during_upload_is_preserved_and_sync_cannot_overlap(tmp_path):
    def while_sending():
        endpoint.on_send = None
        syncer.enqueue({"visits": [{"visit_id": 2}]})
        syncer.maybe_sync()

    endpoint = UploadEndpoint(200, 200, on_send=while_sending)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({"visits": [{"visit_id": 1}]})
    syncer.sync_once()
    syncer.sync_once()

    assert [body["visits"] for _, body in endpoint.uploads] == [
        [{"visit_id": 1}], [{"visit_id": 2}],
    ]


def test_retention_keeps_unconfirmed_files_and_prunes_confirmed_by_age_and_size(tmp_path, monkeypatch):
    monkeypatch.setattr(sync, "CONFIRMED_SCREENSHOT_MAX_BYTES", 16)
    screenshots = tmp_path / "screenshots"
    screenshots.mkdir()
    now = time.time()
    old = now - 8 * 86400
    for name, modified in (
        ("unconfirmed.png", old),
        ("legacy.png", old),
        ("expired.png", old),
        ("older.png", now - 60),
        ("newest.png", now),
    ):
        file = screenshots / name
        file.write_bytes(b"x" * 12)
        os.utime(file, (modified, modified))
    (tmp_path / "sync_cursor.json").write_text(json.dumps({"uploaded_media": ["legacy.png"]}), encoding="utf-8")
    queued = ["expired.png", "older.png", "newest.png"]
    syncer = _open_syncer(tmp_path, UploadEndpoint(503))
    syncer.enqueue({"screenshots": [{"file": f"screenshots/{name}"} for name in queued]})
    with pytest.raises(RuntimeError, match="HTTP 503"):
        syncer.sync_once()
    assert all((screenshots / name).is_file() for name in queued)

    retry = UploadEndpoint(200)
    _open_syncer(tmp_path, retry).sync_once()

    assert {item["name"] for item in retry.uploads[0][1]["media"]} == set(queued)
    assert {file.name for file in screenshots.glob("*.png")} == {"unconfirmed.png", "legacy.png"}
    assert {file.name for file in (screenshots / "confirmed").glob("*.png")} == {"newest.png"}


def test_default_batch_limit_is_4mb_and_timeout_scales_with_payload():
    assert sync.MAX_BATCH_BYTES == 4 * 1024 * 1024
    # Floor of 60s for small bodies, ~60s per 256 KiB above that.
    assert sync.upload_timeout_sec(0) == 60.0
    assert sync.upload_timeout_sec(128 * 1024) == 60.0
    assert sync.upload_timeout_sec(512 * 1024) == 120.0
    assert sync.upload_timeout_sec(4 * 1024 * 1024) == 960.0


def test_post_batch_sends_payload_scaled_timeout(tmp_path):
    captured = {}

    class TimeoutProbe(UploadEndpoint):
        def send(self, request, **kwargs):
            captured["timeout"] = kwargs.get("timeout")
            return super().send(request, **kwargs)

    endpoint = TimeoutProbe(200)
    syncer = _open_syncer(tmp_path, endpoint)
    body = json.dumps({"computer_name": "PC", "visits": [], "media": []}).encode("utf-8")
    body = body + b" " * (512 * 1024 - len(body))

    syncer._post_batch("http://probe.invalid/browser-probe", body, 0)

    assert captured["timeout"] == sync.upload_timeout_sec(len(body)) == 120.0


def test_oversized_screenshot_quarantined_and_later_records_upload(tmp_path, monkeypatch):
    monkeypatch.setattr(sync, "MAX_BATCH_BYTES", 1800)
    shots = tmp_path / "screenshots"
    shots.mkdir()
    (shots / "big.png").write_bytes(b"x" * 3000)
    (shots / "small.png").write_bytes(b"y" * 200)
    endpoint = UploadEndpoint(200, 200)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({
        "visits": [{"visit_id": 1}],
        "screenshots": [
            {"file": "screenshots/big.png"},
            {"file": "screenshots/small.png"},
        ],
        "activity": [{"bucket_start": "2026-11-11T10:00:00", "active_sec": 5}],
    })

    syncer.sync_once()

    bodies = [body for _, body in endpoint.uploads]
    assert [v for body in bodies for v in body["visits"]] == [{"visit_id": 1}]
    assert [a for body in bodies for a in body["activity"]] == [
        {"bucket_start": "2026-11-11T10:00:00", "active_sec": 5},
    ]
    assert [m["name"] for body in bodies for m in body["media"]] == ["small.png"]
    assert (shots / "big.png").is_file()  # original file is left untouched
    assert all(size <= 1800 for size, _ in endpoint.uploads)

    quarantine_path = tmp_path / "oversized_media.json"
    quarantine = json.loads(quarantine_path.read_text(encoding="utf-8"))
    assert len(quarantine["screenshots"]) == 1
    entry = quarantine["screenshots"][0]
    assert entry["record"]["file"] == "screenshots/big.png"
    assert entry["reason"] == "upload-limit"
    assert "content_base64" not in json.dumps(entry)

    # After a restart a fresh visit still uploads and the quarantine is not
    # duplicated — the poisoned record is gone from the active queue.
    retry = UploadEndpoint(200)
    syncer2 = _open_syncer(tmp_path, retry)
    syncer2.enqueue({"visits": [{"visit_id": 2}]})
    syncer2.sync_once()
    assert [v for _, body in retry.uploads for v in body["visits"]] == [{"visit_id": 2}]
    again = json.loads(quarantine_path.read_text(encoding="utf-8"))
    assert len(again["screenshots"]) == 1

    # A re-enqueued record for the same file must not duplicate the row.
    syncer2.enqueue({"screenshots": [{"file": "screenshots/big.png"}]})
    retry2 = UploadEndpoint(200)
    syncer2._session.mount("http://probe.invalid/", retry2)
    syncer2.sync_once()
    again = json.loads(quarantine_path.read_text(encoding="utf-8"))
    assert len(again["screenshots"]) == 1
    assert all(not body["media"] for _, body in retry2.uploads)


def test_oversize_file_bytes_never_reach_base64(tmp_path, monkeypatch):
    encoded_sizes = []
    real_b64encode = sync.base64.b64encode

    def spy(data):
        encoded_sizes.append(len(data))
        return real_b64encode(data)

    monkeypatch.setattr(sync.base64, "b64encode", spy)
    endpoint = UploadEndpoint(200)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.max_media_bytes = 400  # stand-in for the max_media_mb setting
    shots = tmp_path / "screenshots"
    shots.mkdir()
    (shots / "over.png").write_bytes(b"x" * 600)
    (shots / "ok.png").write_bytes(b"y" * 100)
    syncer.enqueue({
        "screenshots": [{"file": "screenshots/over.png"}, {"file": "screenshots/ok.png"}],
        "activity": [{"bucket_start": "2026-11-11T10:00:00"}],
    })

    syncer.sync_once()

    assert encoded_sizes == [100]  # the >max_media file was never read into base64
    assert [m["name"] for _, body in endpoint.uploads for m in body["media"]] == ["ok.png"]
    assert (tmp_path / "oversized_media.json").is_file()


@pytest.mark.parametrize("bad_row", [123, {"record": {}}])
def test_malformed_quarantine_entry_fails_closed_without_overwriting(tmp_path, monkeypatch, bad_row):
    monkeypatch.setattr(sync, "MAX_BATCH_BYTES", 1800)
    quarantine_path = tmp_path / "oversized_media.json"
    # Valid JSON, but one quarantine row is malformed: a non-dict entry, or a
    # record with no file/path marker (which would dedupe against an empty key).
    original = json.dumps({
        "screenshots": [
            {"record": {"file": "screenshots/kept.png"}, "reason": "upload-limit"},
            bad_row,
        ]
    })
    quarantine_path.write_text(original, encoding="utf-8")
    shots = tmp_path / "screenshots"
    shots.mkdir()
    (shots / "big.png").write_bytes(b"x" * 3000)
    endpoint = UploadEndpoint(200)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({
        "screenshots": [{"file": "screenshots/big.png"}],
        "activity": [{"bucket_start": "2026-11-11T10:00:00"}],
    })

    with pytest.raises(ValueError, match="quarantine"):
        syncer.sync_once()

    assert quarantine_path.read_text(encoding="utf-8") == original
    inflight = json.loads((tmp_path / "inflight_upload.json").read_text(encoding="utf-8"))
    assert len(inflight["screenshots"]) == 1
    assert len(inflight["activity"]) == 1
    assert not endpoint.uploads


def test_corrupt_quarantine_fails_closed_without_overwriting(tmp_path, monkeypatch):
    monkeypatch.setattr(sync, "MAX_BATCH_BYTES", 1800)
    quarantine_path = tmp_path / "oversized_media.json"
    quarantine_path.write_text("{corrupt", encoding="utf-8")
    shots = tmp_path / "screenshots"
    shots.mkdir()
    (shots / "big.png").write_bytes(b"x" * 3000)
    endpoint = UploadEndpoint(200)
    syncer = _open_syncer(tmp_path, endpoint)
    syncer.enqueue({
        "screenshots": [{"file": "screenshots/big.png"}],
        "visits": [{"visit_id": 1}],
    })

    with pytest.raises(ValueError, match="quarantine"):
        syncer.sync_once()

    # Never overwritten, and the active queue stays claimable for a retry
    # once the quarantine file is repaired manually.
    assert quarantine_path.read_text(encoding="utf-8") == "{corrupt"
    inflight = json.loads((tmp_path / "inflight_upload.json").read_text(encoding="utf-8"))
    assert len(inflight["screenshots"]) == 1
    assert len(inflight["visits"]) == 1
    assert not endpoint.uploads


def test_incomplete_media_ack_keeps_the_screenshot_for_retry(tmp_path):
    class PartialAck(UploadEndpoint):
        def send(self, request, **kwargs):
            response = super().send(request, **kwargs)
            response._content = b'{"success": true, "media": 0}'
            return response

    file = tmp_path / "screenshots" / "pending.png"
    file.parent.mkdir()
    file.write_bytes(b"png")
    syncer = _open_syncer(tmp_path, PartialAck(200))
    syncer.enqueue({"screenshots": [{"file": "screenshots/pending.png"}]})

    with pytest.raises(RuntimeError, match="media count"):
        syncer.sync_once()

    assert file.is_file()
    retry = UploadEndpoint(200)
    _open_syncer(tmp_path, retry).sync_once()
    assert [item["name"] for item in retry.uploads[0][1]["media"]] == ["pending.png"]
    assert (file.parent / "confirmed" / file.name).is_file()
