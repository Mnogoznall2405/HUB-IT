"""Data models for probe events and session timeline."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@dataclass
class UiNodeSummary:
    name: str = ""
    control_type: str = ""
    class_name: str = ""
    automation_id: str = ""
    value: str = ""
    depth: int = 0
    children_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ProbeEvent:
    event_type: str
    timestamp: str
    windows_user: str
    computer_name: str
    pid: int | None
    window_title: str
    chat_name: str | None
    chat_confidence: float
    chat_detection_note: str
    file_names: list[str] = field(default_factory=list)
    visible_text: list[str] = field(default_factory=list)
    messages: list[dict[str, Any]] = field(default_factory=list)
    dialogue_note: str = ""
    screenshot_path: str | None = None
    ui_tree_path: str | None = None
    ui_state_hash: str | None = None
    screenshot_hash: str | None = None
    session_id: str | None = None
    details: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ChatVisit:
    chat_name: str
    confidence: float
    started_at: str
    ended_at: str | None = None
    duration_seconds: float | None = None
    file_names: list[str] = field(default_factory=list)
    visible_text_sample: list[str] = field(default_factory=list)
    messages: list[dict[str, Any]] = field(default_factory=list)
    dialogue_note: str = ""
    screenshots: list[str] = field(default_factory=list)
    events_count: int = 0
    detection_note: str = ""


@dataclass
class TelegramSession:
    session_id: str
    started_at: str
    ended_at: str | None = None
    duration_seconds: float | None = None
    pid: int | None = None
    window_titles: list[str] = field(default_factory=list)
    chat_visits: list[ChatVisit] = field(default_factory=list)
