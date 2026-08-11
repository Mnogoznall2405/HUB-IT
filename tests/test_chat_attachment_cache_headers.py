from __future__ import annotations

import asyncio
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

attachments_module = importlib.import_module("backend.api.v1.chat.attachments")


class _FakeChatApi:
    def __init__(self, payload: dict):
        self.payload = payload
        self.chat_service = SimpleNamespace(get_attachment_for_download=lambda: None)

    async def _run_chat_call(self, *_args, **_kwargs):
        return dict(self.payload)

    @staticmethod
    def _raise_chat_http_error(exc):
        raise exc


def _download_response(monkeypatch, temp_dir: str, *, media_kind: str | None):
    file_path = Path(temp_dir) / "attachment.webm"
    file_path.write_bytes(b"sticker")
    fake_api = _FakeChatApi({
        "path": str(file_path),
        "file_name": file_path.name,
        "mime_type": "video/webm",
        "media_kind": media_kind,
    })
    monkeypatch.setattr(attachments_module, "chat_api", lambda: fake_api)
    return asyncio.run(attachments_module.download_chat_attachment(
        message_id="message-1",
        attachment_id="attachment-1",
        inline=True,
        variant=None,
        current_user=SimpleNamespace(id=7),
    ))


def test_sticker_attachment_response_is_private_and_immutable(monkeypatch, temp_dir):
    response = _download_response(monkeypatch, temp_dir, media_kind="sticker")

    assert response.headers["cache-control"] == "private, max-age=31536000, immutable"


def test_regular_attachment_response_does_not_receive_sticker_cache_policy(monkeypatch, temp_dir):
    response = _download_response(monkeypatch, temp_dir, media_kind="video")

    assert response.headers.get("cache-control") is None
