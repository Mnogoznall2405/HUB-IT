"""Unit tests for voice.* ai_chat tools (filesystem-backed, no DB)."""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_ROOT = Path(__file__).resolve().parents[1]
for _p in (str(_ROOT), str(_ROOT / "WEB-itinvent")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

tools_context_module = importlib.import_module("backend.ai_chat.tools.context")
voice_module = importlib.import_module("backend.ai_chat.tools.voice")


def _ctx():
    return tools_context_module.AiToolExecutionContext(
        bot_id="bot-test",
        bot_title="Test",
        conversation_id="ai-conv-test",
        run_id="run-test",
        user_id=5,
        user_payload={"id": 5, "role": "viewer", "username": "operator"},
        effective_database_id="ITINVENT",
        enabled_tools=["voice.meetings.search", "voice.meeting.get"],
        tool_settings={},
    )


def _write_report(root: Path, base: str, payload: dict) -> None:
    mdir = root / "output" / base
    mdir.mkdir(parents=True, exist_ok=True)
    (mdir / f"{base}_report.json").write_text(
        json.dumps(payload, ensure_ascii=False), encoding="utf-8"
    )


def test_voice_tools_registered():
    registry = importlib.import_module("backend.ai_chat.tools").ai_tool_registry
    assert registry.get("voice.meetings.search") is not None
    assert registry.get("voice.meeting.get") is not None


def test_voice_search_finds_and_snippets(tmp_path, monkeypatch):
    _write_report(
        tmp_path,
        "standup",
        {
            "summary": "Обсудили поставку ТМЦ на Северный.",
            "topics": [{"topic_title": "Логистика", "summary": "Судно выйдет 16.10"}],
            "action_registry": "| 1 | 10:00 | Подготовить сводку | Иванов | 01.10 |",
        },
    )
    _write_report(tmp_path, "other", {"summary": "Про котиков."})
    monkeypatch.setenv("VOICEVIDEO_ROOT", str(tmp_path))

    tool = voice_module.VoiceMeetingsSearchTool()
    result = tool.execute(
        context=_ctx(), args=voice_module.VoiceMeetingsSearchArgs(query="ТМЦ")
    )
    assert result.ok is True
    assert result.data["total"] == 1
    assert result.data["items"][0]["base_filename"] == "standup"
    assert "ТМЦ" in result.data["items"][0]["snippet"]


def test_voice_search_missing_root_returns_empty(monkeypatch, tmp_path):
    empty_root = tmp_path / "empty-root"
    empty_root.mkdir()
    monkeypatch.setenv("VOICEVIDEO_ROOT", str(empty_root))
    tool = voice_module.VoiceMeetingsSearchTool()
    result = tool.execute(
        context=_ctx(), args=voice_module.VoiceMeetingsSearchArgs(query="ТМЦ")
    )
    assert result.ok is True
    assert result.data == {"items": [], "total": 0}


def test_voice_get_returns_protocol_card(tmp_path, monkeypatch):
    _write_report(
        tmp_path,
        "standup",
        {
            "summary": "Итоги.",
            "topics": [
                {
                    "topic_title": "Логистика",
                    "summary": "Судно.",
                    "start_time": 0,
                    "end_time": 60,
                }
            ],
            "action_items": "1. Подготовить сводку",
            "questions": "Когда судно?",
        },
    )
    monkeypatch.setenv("VOICEVIDEO_ROOT", str(tmp_path))

    tool = voice_module.VoiceMeetingGetTool()
    result = tool.execute(
        context=_ctx(), args=voice_module.VoiceMeetingGetArgs(base_filename="standup")
    )
    assert result.ok is True
    assert result.data["base_filename"] == "standup"
    assert result.data["summary"] == "Итоги."
    assert result.data["topics"][0]["title"] == "Логистика"

    missing = tool.execute(
        context=_ctx(), args=voice_module.VoiceMeetingGetArgs(base_filename="nope")
    )
    assert missing.ok is False
