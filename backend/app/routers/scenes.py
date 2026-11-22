from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import get_session
from app.schemas.command import CommandError
from app.schemas.scene import SceneRecord, SceneSnapshot
from app.services import scene_service

router = APIRouter(prefix="/api/v1/scenes", tags=["scenes"])


@router.get("/{session_id}", response_model=SceneRecord)
async def get_scene(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_session),
):
    scene = await scene_service.get_scene(session_id, db)
    if scene is None:
        raise HTTPException(
            status_code=404,
            detail=CommandError(
                error_code="SESSION_NOT_FOUND",
                message=f"No scene found for session {session_id}.",
            ).model_dump(),
        )
    return SceneRecord(
        session_id=scene.session_id,
        version=scene.version,
        created_at=scene.created_at,
        updated_at=scene.updated_at,
        snapshot=SceneSnapshot.model_validate(scene.snapshot),
    )


@router.put("/{session_id}", response_model=SceneRecord)
async def put_scene(
    session_id: uuid.UUID,
    body: SceneSnapshot,
    db: AsyncSession = Depends(get_session),
):
    scene = await scene_service.upsert_scene(session_id, body, db)
    return SceneRecord(
        session_id=scene.session_id,
        version=scene.version,
        created_at=scene.created_at,
        updated_at=scene.updated_at,
        snapshot=SceneSnapshot.model_validate(scene.snapshot),
    )
