import json

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
        response._content = json.dumps({"success": status == 200}).encode("utf-8")
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
    focus_events = [{"title": "Окно", "dwell_sec": 3}]
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
