from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "WEB-itinvent"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(WEB))


def test_build_live_dlp_report_html_contains_host_and_channels(monkeypatch):
    from backend.services import dlp_report_service as svc

    monkeypatch.setattr(
        svc.store,
        "list_events",
        lambda **kwargs: [
            {
                "ts": 1700000000,
                "windows_user": "ivan",
                "file_name": "a.xlsx",
                "dest_path": r"E:\a.xlsx",
                "channel": "usb",
            }
        ],
    )
    monkeypatch.setattr(
        svc.store,
        "list_telegram_chats",
        lambda **kwargs: [
            {
                "chat_id": "c1",
                "chat_name": "Коллега",
                "windows_user": "ivan",
                "messages": [{"direction": "outgoing", "text": "Файл, x.docx", "time": "12:00"}],
            },
            {
                "chat_id": "c2",
                "chat_name": "Группа",
                "windows_user": "ivan",
                "messages": [{"direction": "incoming", "text": "ok", "time": "12:01"}],
            },
        ],
    )
    html = svc.build_live_dlp_report_html(computer_name="PC-1")
    assert "PC-1" in html
    assert "a.xlsx" in html
    assert "USB" in html
    assert "Коллега" in html
    assert "Группа" in html
    assert 'data-main="files"' in html
    assert 'data-main="telegram"' in html
    assert "dialog-btn" in html
    assert "актуальный снимок" in html.lower() or "актуальный" in html.lower()
