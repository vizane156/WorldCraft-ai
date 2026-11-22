from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# ── Request ────────────────────────────────────────────────────────────────

class CommandRequest(BaseModel):
    session_id: uuid.UUID
    command_text: str = Field(min_length=1, max_length=500)

    @field_validator("command_text")
    @classmethod
    def strip_html(cls, v: str) -> str:
        """Remove angle-bracket tags to prevent prompt injection."""
        import re
        return re.sub(r"<[^>]*>", "", v).strip()


# ── Scene actions (mirrors scene_command_schema.json) ─────────────────────

class AddObjectAction(BaseModel):
    action_type: Literal["add_object"]
    asset_id: str
    label: str = Field(max_length=64)
    position: tuple[float, float, float]
    rotation_y: float = 0.0
    scale: float = Field(default=1.0, ge=0.1, le=10.0)


class MoveObjectAction(BaseModel):
    action_type: Literal["move_object"]
    target_label: str
    position: tuple[float, float, float]
    rotation_y: float | None = None


class RemoveObjectAction(BaseModel):
    action_type: Literal["remove_object"]
    target_label: str


class ModifyObjectAction(BaseModel):
    action_type: Literal["modify_object"]
    target_label: str
    scale: float | None = Field(default=None, ge=0.1, le=10.0)


SceneAction = AddObjectAction | MoveObjectAction | RemoveObjectAction | ModifyObjectAction


# ── Response ───────────────────────────────────────────────────────────────

class CommandResponse(BaseModel):
    actions: list[dict[str, Any]]   # validated actions forwarded to client as-is
    warnings: list[str] = Field(default_factory=list)


# ── Error ─────────────────────────────────────────────────────────────────

class CommandError(BaseModel):
    error_code: str
    message: str
