"""Task canvas realtime protocol built on the existing Chat websocket relay."""
from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from typing import Any

from backend.chat.realtime import chat_realtime
from backend.models.hub_task_canvas import TaskCanvasScene
from backend.services.hub_service import hub_service


TASK_CANVAS_PROTOCOL_VERSION = 1
TASK_CANVAS_MAX_WS_BYTES = (2 * 1024 * 1024) + (64 * 1024)
TASK_CANVAS_MAX_ELEMENTS = 2000

_CURSOR_COLORS = (
    {"background": "#dbeafe", "stroke": "#2563eb"},
    {"background": "#dcfce7", "stroke": "#16a34a"},
    {"background": "#fef3c7", "stroke": "#d97706"},
    {"background": "#fce7f3", "stroke": "#db2777"},
    {"background": "#ede9fe", "stroke": "#7c3aed"},
    {"background": "#cffafe", "stroke": "#0891b2"},
)


def _normalize_text(value: object, limit: int = 240) -> str:
    return str(value or "").strip()[: max(1, int(limit))]


def _actor_dict(user: Any) -> dict[str, Any]:
    permissions = list(getattr(user, "permissions", []) or [])
    return {
        "id": int(getattr(user, "id", 0) or 0),
        "username": _normalize_text(getattr(user, "username", ""), 160),
        "full_name": _normalize_text(getattr(user, "full_name", ""), 240),
        "role": _normalize_text(getattr(user, "role", ""), 80),
        "department": _normalize_text(getattr(user, "department", ""), 160),
        "permissions": permissions,
        "custom_permissions": permissions,
        "use_custom_permissions": True,
    }


@dataclass(slots=True)
class TaskCanvasWsRateLimiter:
    """Per-connection token bucket for cursor and scene commands."""

    rate_per_sec: float = 30.0
    burst: float = 60.0
    tokens: float = 60.0
    updated_at: float = 0.0
    violations: int = 0

    def __post_init__(self) -> None:
        self.rate_per_sec = max(1.0, float(self.rate_per_sec))
        self.burst = max(1.0, float(self.burst))
        self.tokens = self.burst
        self.updated_at = time.monotonic()

    def allow(self, *, cost: float = 1.0) -> tuple[bool, int]:
        now = time.monotonic()
        elapsed = max(0.0, now - self.updated_at)
        self.updated_at = now
        self.tokens = min(self.burst, self.tokens + (elapsed * self.rate_per_sec))
        requested = min(self.burst, max(1.0, float(cost)))
        if self.tokens >= requested:
            self.tokens -= requested
            self.violations = 0
            return True, 0
        self.violations += 1
        missing = max(0.0, requested - self.tokens)
        return False, max(100, int((missing / self.rate_per_sec) * 1000.0))


class TaskCanvasRealtimeService:
    def __init__(self, *, realtime_manager: Any = None, canvas_store: Any = None) -> None:
        self.realtime = realtime_manager or chat_realtime
        self.canvas_store = canvas_store or hub_service

    @staticmethod
    def room_id(task_id: object) -> str:
        normalized = _normalize_text(task_id, 128)
        if not normalized:
            raise LookupError("Task not found")
        return f"task-canvas:{normalized}"

    def authorize(self, *, task_id: str, user: Any) -> dict[str, Any]:
        return self.canvas_store.get_task_canvas(
            task_id=_normalize_text(task_id, 128),
            actor=_actor_dict(user),
        )

    @staticmethod
    def collaborator(user: Any, *, connection_id: str) -> dict[str, Any]:
        user_id = int(getattr(user, "id", 0) or 0)
        username = (
            _normalize_text(getattr(user, "full_name", ""), 120)
            or _normalize_text(getattr(user, "username", ""), 120)
            or f"Пользователь {user_id}"
        )
        return {
            "id": str(user_id),
            "socketId": _normalize_text(connection_id, 128),
            "username": username,
            "color": dict(_CURSOR_COLORS[user_id % len(_CURSOR_COLORS)]),
        }

    @staticmethod
    def validate_cursor(payload: object) -> dict[str, Any]:
        source = payload if isinstance(payload, dict) else {}
        pointer = source.get("pointer") if isinstance(source.get("pointer"), dict) else {}
        try:
            x = float(pointer.get("x"))
            y = float(pointer.get("y"))
        except (TypeError, ValueError):
            raise ValueError("Invalid canvas cursor coordinates") from None
        if not math.isfinite(x) or not math.isfinite(y) or abs(x) > 10_000_000 or abs(y) > 10_000_000:
            raise ValueError("Invalid canvas cursor coordinates")
        tool = _normalize_text(pointer.get("tool"), 16).lower()
        if tool not in {"pointer", "laser"}:
            tool = "pointer"
        button = _normalize_text(source.get("button"), 8).lower()
        if button not in {"up", "down"}:
            button = "up"
        return {
            "pointer": {"x": x, "y": y, "tool": tool},
            "button": button,
        }

    @staticmethod
    def validate_scene(payload: object) -> dict[str, Any]:
        source = payload if isinstance(payload, dict) else {}
        raw_scene = source.get("scene")
        scene = TaskCanvasScene.model_validate(raw_scene).model_dump(by_alias=True)
        if len(scene["elements"]) > TASK_CANVAS_MAX_ELEMENTS:
            raise ValueError("Task canvas has too many elements")
        encoded = json.dumps(scene, ensure_ascii=False, separators=(",", ":"), default=str).encode("utf-8")
        if len(encoded) > TASK_CANVAS_MAX_WS_BYTES:
            raise ValueError("Task canvas realtime update is too large")
        return scene

    async def broadcast_presence(
        self,
        *,
        task_id: str,
        event_type: str,
        user: Any,
        connection_id: str,
    ) -> None:
        await self.realtime.publish_conversation_room_event(
            conversation_id=self.room_id(task_id),
            event_type=event_type,
            payload={
                "protocol": TASK_CANVAS_PROTOCOL_VERSION,
                "connection_id": connection_id,
                "collaborator": self.collaborator(user, connection_id=connection_id),
            },
            exclude_connection_id=connection_id,
        )

    async def request_peer_sync(self, *, task_id: str, connection_id: str) -> None:
        await self.realtime.publish_conversation_room_event(
            conversation_id=self.room_id(task_id),
            event_type="task_canvas.sync.requested",
            payload={
                "protocol": TASK_CANVAS_PROTOCOL_VERSION,
                "target_connection_id": connection_id,
            },
            exclude_connection_id=connection_id,
        )

    async def broadcast_cursor(
        self,
        *,
        task_id: str,
        user: Any,
        connection_id: str,
        payload: object,
    ) -> None:
        cursor = self.validate_cursor(payload)
        await self.realtime.publish_conversation_room_event(
            conversation_id=self.room_id(task_id),
            event_type="task_canvas.cursor",
            payload={
                "protocol": TASK_CANVAS_PROTOCOL_VERSION,
                "connection_id": connection_id,
                "collaborator": self.collaborator(user, connection_id=connection_id),
                **cursor,
            },
            exclude_connection_id=connection_id,
        )

    async def broadcast_scene(
        self,
        *,
        task_id: str,
        user: Any,
        connection_id: str,
        payload: object,
    ) -> None:
        source = payload if isinstance(payload, dict) else {}
        scene = self.validate_scene(source)
        await self.realtime.publish_conversation_room_event(
            conversation_id=self.room_id(task_id),
            event_type="task_canvas.scene.updated",
            payload={
                "protocol": TASK_CANVAS_PROTOCOL_VERSION,
                "connection_id": connection_id,
                "collaborator": self.collaborator(user, connection_id=connection_id),
                "base_revision": max(0, int(source.get("base_revision") or 0)),
                "target_connection_id": _normalize_text(source.get("target_connection_id"), 128) or None,
                "scene": scene,
            },
            exclude_connection_id=connection_id,
        )


task_canvas_realtime = TaskCanvasRealtimeService()
