from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class Transform(BaseModel):
    position: tuple[float, float, float]
    rotation: tuple[float, float, float, float]  # quaternion [x, y, z, w]
    scale: tuple[float, float, float]


class SceneObject(BaseModel):
    id: str
    asset_id: str
    label: str
    transform: Transform


class SceneSnapshot(BaseModel):
    version: int = 0
    objects: list[SceneObject] = Field(default_factory=list)
    origin: Transform | None = None


class SceneRecord(BaseModel):
    """Full scene record returned by GET /api/v1/scenes/{session_id}."""
    session_id: uuid.UUID
    version: int
    created_at: datetime
    updated_at: datetime
    snapshot: SceneSnapshot

    model_config = {"from_attributes": True}
