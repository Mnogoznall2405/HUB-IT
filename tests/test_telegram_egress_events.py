"""Messenger file_left contract: stable event identity and send_state honesty.

A single outgoing attachment is observed on up to three paths (watcher drop,
sync delta, server-side re-extract). All of them must produce the SAME
event_id so server dedupe collapses them into one row, while a genuine
re-send of the same file still gets a new id.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "telegram_uia_probe"))

import pytest  # noqa: E402

from telegram_probe import sync as probe_sync  # noqa: E402


def _outgoing_file_msg(**overrides):
    msg = {
        "direction": "outgoing",
        "sender": "Меня",
        "time": "в 20:21",
        "text": "Файл, dogovor.docx (12 КБ)",
        "media": "",
        "msg_key": "outgoing|в 20:21|меня|файл, dogovor.docx (12 кб)",
    }
    msg.update(overrides)
    return msg


def test_outgoing_file_event_id_is_stable_across_paths():
    kwargs = dict(chat_name="Иван", chat_id="ivan_ab12", windows_user="u", computer_name="PC")
    first = probe_sync.extract_outgoing_file_left([_outgoing_file_msg()], **kwargs)
    second = probe_sync.extract_outgoing_file_left([_outgoing_file_msg()], **kwargs)
    assert len(first) == 1
    assert first[0]["event_id"] == second[0]["event_id"]
    assert first[0]["file_name"] == "dogovor.docx"
    assert first[0]["details"]["send_state"] == "sent"
    assert first[0]["details"]["chat_id"] == "ivan_ab12"


def test_repeated_send_same_file_gets_distinct_event_id():
    kwargs = dict(chat_name="Иван", windows_user="u", computer_name="PC")
    one = probe_sync.extract_outgoing_file_left([_outgoing_file_msg()], **kwargs)
    two = probe_sync.extract_outgoing_file_left(
        [_outgoing_file_msg(time="в 20:22", msg_key="k2")], **kwargs
    )
    assert one[0]["event_id"] != two[0]["event_id"]


def test_event_id_without_msg_key_is_still_deterministic():
    msg = _outgoing_file_msg()
    del msg["msg_key"]
    kwargs = dict(chat_name="Иван", windows_user="u", computer_name="PC")
    first = probe_sync.extract_outgoing_file_left([msg], **kwargs)
    second = probe_sync.extract_outgoing_file_left([msg], **kwargs)
    assert first[0]["event_id"] == second[0]["event_id"]


def test_disk_open_event_is_selected_not_sent(tmp_path, monkeypatch):
    target = tmp_path / "report.docx"
    target.write_text("x", encoding="utf-8")
    monkeypatch.setattr(probe_sync.time, "time", lambda: 10_000)
    kwargs = dict(chat_name="Иван", windows_user="u", computer_name="PC")
    first = probe_sync.build_disk_file_left(src_path=str(target), **kwargs)
    second = probe_sync.build_disk_file_left(src_path=str(target), **kwargs)
    assert first["event_id"] == second["event_id"]
    assert first["details"]["send_state"] == "selected"
    monkeypatch.setattr(probe_sync.time, "time", lambda: 10_000 + 600)
    later = probe_sync.build_disk_file_left(src_path=str(target), **kwargs)
    assert later["event_id"] != first["event_id"]


def test_max_file_label_yields_real_name():
    msg = _outgoing_file_msg(text="Файл: report.docx", media="file", msg_key="m1")
    events = probe_sync.extract_outgoing_file_left(
        [msg], chat_name="Иван", chat_id="c1", windows_user="u",
        computer_name="PC", channel="max",
    )
    assert events[0]["file_name"] == "report.docx"
    assert events[0]["channel"] == "max"
    assert events[0]["dest_path"] == "max:Иван"

def test_generic_media_label_uses_source_path_name():
    msg = _outgoing_file_msg(text="", media="video", msg_key="mv1")
    msg["source_path"] = r"C:\Users\u\Videos\clip.mp4"
    events = probe_sync.extract_outgoing_file_left(
        [msg], chat_name="Иван", chat_id="c1", windows_user="u",
        computer_name="PC", channel="max",
    )
    assert events[0]["file_name"] == "clip.mp4"
    assert events[0]["src_path"].replace("/", "\\") == r"C:\Users\u\Videos\clip.mp4"
