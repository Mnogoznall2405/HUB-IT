import json
import os
import time

import pytest
import requests

from browser_probe import sync


class UploadEndpoint(requests.adapters.BaseAdapter):
    def __init__(self, *statuses, on_send=None):
        self.statuses = iter(statuses)
        self.on_send = on_send
        self.uploads = []

    def send(self, request, **kwargs):
        self.uploads.append((len(request.body), json.loads(request.body)))
        if self.on_send:
            self.on_send()
        status = next(self.statuses)
        response = requests.Response()
        response.status_code = status
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
