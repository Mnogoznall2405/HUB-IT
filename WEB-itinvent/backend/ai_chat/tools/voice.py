"""Voice meeting protocol tools for ai_chat: search across protocols and open one.

Read-only. Reads ``*_report.json`` files under ``VOICEVIDEO_ROOT/output``.
Same visibility as ``voice.read``: every chat user sees every protocol.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, List, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    VOICE_TOOL_MEETING_GET,
    VOICE_TOOL_MEETINGS_SEARCH,
)
from backend.ai_chat.tools.registry import ai_tool_registry

DEFAULT_LIMIT = 10
MAX_LIMIT = 20
_MAX_TEXT = 1500
_MAX_SNIPPET = 400


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _voicevideo_root() -> Optional[Path]:
    raw = _normalize_text(os.getenv("VOICEVIDEO_ROOT"))
    if raw:
        candidate = Path(raw)
        if candidate.exists():
            return candidate
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "voice_video"
        if candidate.exists():
            return candidate
    return None


def _iter_report_files(root: Path):
    """A1/P2: bounded scan — at most AI_VOICE_SCAN_MAX_ENTRIES filesystem
    entries inspected and AI_VOICE_REPORT_MAX_FILES kept in memory (bounded
    heap by mtime, newest first).

    Limitation: "newest" here is newest-among-inspected — without an index a
    strict newest-of-everything pick needs a full walk. Minimal index for
    that: producer-maintained manifest (append-only index.jsonl of report
    paths + mtimes); out of A1 scope."""
    import heapq

    from backend.ai_chat.timeouts import (
        ai_voice_report_max_files,
        ai_voice_scan_max_entries,
    )

    output = root / "output"
    if not output.exists():
        return
    max_files = ai_voice_report_max_files()
    max_entries = ai_voice_scan_max_entries()
    newest: list[tuple[float, int, Path]] = []
    inspected = 0
    order = 0

    def _consider(path: Path) -> None:
        nonlocal order
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return
        order += 1
        item = (mtime, order, path)
        if len(newest) < max_files:
            heapq.heappush(newest, item)
        elif item > newest[0]:
            heapq.heapreplace(newest, item)

    # No sorted(): materializing the whole dir is exactly the unbounded walk
    # being bounded. Traversal stops once the entry budget is spent.
    for entry in output.iterdir():
        if inspected >= max_entries:
            break
        inspected += 1
        try:
            if entry.is_dir():
                for report in entry.glob("*_report.json"):
                    if inspected >= max_entries:
                        break
                    inspected += 1
                    if report.is_file():
                        _consider(report)
            elif entry.is_file() and entry.name.endswith("_report.json"):
                _consider(entry)
        except OSError:
            continue
    for _mtime, _idx, report in sorted(newest, key=lambda item: item[0], reverse=True):
        yield report


def _load_report(path: Path) -> Optional[dict]:
    from backend.ai_chat.timeouts import ai_voice_report_max_bytes

    try:
        if path.stat().st_size > ai_voice_report_max_bytes():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def _searchable_text(data: dict) -> str:
    parts = [
        _normalize_text(data.get("summary")),
        _normalize_text(data.get("action_registry")),
        _normalize_text(data.get("protocol")),
    ]
    for topic in data.get("topics") or []:
        if isinstance(topic, dict):
            parts.append(_normalize_text(topic.get("topic_title")))
            parts.append(_normalize_text(topic.get("summary")))
    return "\n".join(part for part in parts if part)


def _snippet(text: str, query: str, radius: int = 120) -> str:
    lowered = text.lower()
    idx = lowered.find(query.lower())
    if idx < 0:
        return text[:_MAX_SNIPPET]
    start = max(0, idx - radius)
    end = min(len(text), idx + len(query) + radius)
    prefix = "…" if start > 0 else ""
    suffix = "…" if end < len(text) else ""
    return prefix + text[start:end].strip() + suffix


class VoiceMeetingsSearchArgs(BaseModel):
    query: str = Field(..., min_length=1, max_length=300)
    limit: int = Field(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class VoiceMeetingGetArgs(BaseModel):
    base_filename: str = Field(..., min_length=1, max_length=300)

    @field_validator("base_filename", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class VoiceMeetingsSearchTool(AiTool):
    tool_id = VOICE_TOOL_MEETINGS_SEARCH
    description = (
        "Search meeting protocols (transcripts, topics, action items). "
        "Use when the user asks what was decided or discussed at meetings. "
        "Returns matching meetings with a text snippet each."
    )
    input_model = VoiceMeetingsSearchArgs

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        query = str(getattr(args, "query", "") or "").strip()
        limit = max(1, min(int(getattr(args, "limit", DEFAULT_LIMIT) or DEFAULT_LIMIT), MAX_LIMIT))
        root = _voicevideo_root()
        if root is None:
            return AiToolResult(tool_id=self.tool_id, ok=True, data={"items": [], "total": 0})
        hits: List[dict[str, Any]] = []
        for path in _iter_report_files(root):
            data = _load_report(path)
            if not data:
                continue
            text = _searchable_text(data)
            if query.lower() not in text.lower():
                continue
            base = path.parent.name if path.parent.name != "output" else path.stem[: -len("_report")]
            hits.append(
                {
                    "base_filename": base,
                    "snippet": _snippet(text, query)[:_MAX_SNIPPET],
                }
            )
            if len(hits) >= limit:
                break
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"items": hits, "total": len(hits)})


class VoiceMeetingGetTool(AiTool):
    tool_id = VOICE_TOOL_MEETING_GET
    description = (
        "Open one meeting protocol by base_filename: summary, topics, "
        "action items with assignees and deadlines, and available reports."
    )
    input_model = VoiceMeetingGetArgs

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        base = str(getattr(args, "base_filename", "") or "").strip()
        root = _voicevideo_root()
        if root is None:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Meeting not found")
        safe = "".join(ch for ch in base if ch.isalnum() or ch in ("-", "_", ".", " "))
        target = None
        for path in _iter_report_files(root):
            candidate = path.parent.name if path.parent.name != "output" else path.stem[: -len("_report")]
            if candidate == base or candidate == safe:
                target = path
                break
        if target is None:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Meeting not found")
        data = _load_report(target)
        if not data:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Cannot read meeting report")

        topics = []
        for topic in (data.get("topics") or [])[:40]:
            if not isinstance(topic, dict):
                continue
            title = _normalize_text(topic.get("topic_title"))
            if not title:
                continue
            topics.append(
                {
                    "title": title[:200],
                    "summary": _normalize_text(topic.get("summary"))[:_MAX_TEXT] or None,
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "base_filename": base,
                "summary": _normalize_text(data.get("summary"))[:_MAX_TEXT * 2] or None,
                "topics": topics,
                "action_items": _normalize_text(data.get("action_items"))[:_MAX_TEXT * 2] or None,
                "open_questions": _normalize_text(data.get("questions"))[:_MAX_TEXT] or None,
            },
        )


ai_tool_registry.register(VoiceMeetingsSearchTool())
ai_tool_registry.register(VoiceMeetingGetTool())
