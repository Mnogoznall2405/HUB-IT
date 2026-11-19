"""Probe sync must not advance chat offsets when the upload is not acknowledged.

Advancing the cursor on a failed POST drops chat history AND skips egress
re-extraction for those messages on the next cycle — the file_left row can
exist while the chat payload never arrives.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "telegram_uia_probe"))

import pytest  # noqa: E402
import requests  # noqa: E402

from telegram_probe import sync as probe_sync  # noqa: E402


class UploadEndpoint(requests.adapters.BaseAdapter):
    def __init__(self, *statuses):
        self.statuses = iter(statuses)
        self.uploads = []

    def send(self, request, **kwargs):
        self.uploads.append(json.loads(request.body))
        status = next(self.statuses)
        response = requests.Response()
        response.status_code = status
        response._content = b'{"success": true}'
        return response

    def close(self):
        pass


FILE_MSG = {
    "direction": "outgoing",
    "sender": "Меня",
    "time": "в 20:21",
    "text": "Файл, dogovor.docx (12 КБ)",
    "msg_key": "k1",
}


def _make_syncer(tmp_path, monkeypatch, endpoint):
    program_data = tmp_path / "pd"
    monkeypatch.setenv("ProgramData", str(program_data))
    (tmp_path / "chats").mkdir()
    (tmp_path / "state.json").write_text(
        json.dumps(
            {
                "windows_user": "u",
                "computer_name": "PC",
                "chats": [{"chat_id": "ivan_ab12", "chat_name": "Иван"}],
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "chats" / "ivan_ab12.jsonl").write_text(
        json.dumps(FILE_MSG) + "\n", encoding="utf-8"
    )
    monkeypatch.setattr(probe_sync, "regenerate_from_output", lambda *a, **k: None)
    syncer = probe_sync.TelegramProbeSync(
        tmp_path,
        server_url="http://probe.invalid/telegram-probe",
        api_key="k",
    )
    syncer._session.mount("http://probe.invalid/", endpoint)
    return syncer, program_data


def test_failed_upload_keeps_offsets_and_egress_still_reaches_inbox(tmp_path, monkeypatch):
    syncer, program_data = _make_syncer(tmp_path, monkeypatch, UploadEndpoint(503, 200))

    stats = syncer.sync_once()
    assert stats["media"] == 0
    # Not acknowledged → offsets stay at 0 so the delta retries.
    assert syncer._cursor["chat_offsets"] == {}
    # Egress rides the durable fs_egress inbox even while chats retry.
    inbox = program_data / "HUB-IT" / "Agent" / "Spool" / "fs_egress" / "inbox"
    dropped = list(inbox.glob("tg_*.json"))
    assert len(dropped) == 1

    stats = syncer.sync_once()
    assert syncer._cursor["chat_offsets"] == {"ivan_ab12": 1}


def test_retry_resends_unacknowledged_messages(tmp_path, monkeypatch):
    endpoint = UploadEndpoint(503, 200)
    syncer, _ = _make_syncer(tmp_path, monkeypatch, endpoint)

    syncer.sync_once()
    assert len(endpoint.uploads) == 1
    syncer.sync_once()
    assert len(endpoint.uploads) == 2
    resent = endpoint.uploads[1]
    chat = resent["chats"][0]
    assert chat["chat_id"] == "ivan_ab12"
    assert chat["messages"][0]["msg_key"] == "k1"


def test_acknowledged_upload_advances_offsets(tmp_path, monkeypatch):
    endpoint = UploadEndpoint(200)
    syncer, _ = _make_syncer(tmp_path, monkeypatch, endpoint)

    syncer.sync_once()
    assert syncer._cursor["chat_offsets"] == {"ivan_ab12": 1}
    syncer.sync_once()
    # Syncs keep posting (media/report channel), but acknowledged
    # messages are not resent: the second body carries an empty chat list.
    assert len(endpoint.uploads) == 2
    assert endpoint.uploads[1]["chats"] == []
