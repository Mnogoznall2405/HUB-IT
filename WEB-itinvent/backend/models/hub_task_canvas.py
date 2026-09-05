"""Typed contracts for a task-bound Excalidraw scene."""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class TaskCanvasScene(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    elements: list[dict[str, Any]] = Field(default_factory=list, max_length=2000)
    app_state: dict[str, Any] = Field(default_factory=dict, alias="appState")
    files: dict[str, Any] = Field(default_factory=dict)


class TaskCanvasUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    revision: int = Field(ge=0)
    scene: TaskCanvasScene


class TaskCanvasResponse(BaseModel):
    task_id: str
    revision: int = Field(ge=0)
    scene: TaskCanvasScene
    can_edit: bool
    max_scene_bytes: int = Field(gt=0)
    updated_by_user_id: int | None = None
    updated_by_username: str = ""
    updated_at: str | None = None
