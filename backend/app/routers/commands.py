from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.db import get_session
from app.schemas.command import CommandError, CommandRequest, CommandResponse
from app.schemas.scene import SceneSnapshot
from app.services import scene_service
from app.services.ai_gateway import GeminiUnavailableError, generate_command
from app.services.command_validator import (
    EmptyCommandError,
    ParseError,
    SchemaError,
    validate,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/commands", tags=["commands"])

_SCHEMA_STR = (
    Path(__file__).parent.parent / "scene_command_schema.json"
).read_text(encoding="utf-8")


@router.post("", response_model=CommandResponse)
async def post_command(
    body: CommandRequest,
    db: AsyncSession = Depends(get_session),
    settings=Depends(get_settings),
):
    # 1. Load current scene state from DB (server is authority)
    existing = await scene_service.get_scene(body.session_id, db)
    current_snapshot = (
        SceneSnapshot.model_validate(existing.snapshot)
        if existing is not None
        else SceneSnapshot()
    )

    # 2. Call Gemini
    try:
        raw_json = await generate_command(
            body.command_text, current_snapshot, settings, _SCHEMA_STR
        )
    except GeminiUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail=CommandError(
                error_code="AI_UNAVAILABLE",
                message=str(exc),
            ).model_dump(),
        ) from exc

    # 3. Validate Gemini output
    try:
        valid_actions, warnings = validate(raw_json)
    except ParseError as exc:
        raise HTTPException(
            status_code=400,
            detail=CommandError(
                error_code="AI_PARSE_ERROR", message=str(exc)
            ).model_dump(),
        ) from exc
    except SchemaError as exc:
        raise HTTPException(
            status_code=400,
            detail=CommandError(
                error_code="AI_SCHEMA_ERROR", message=str(exc)
            ).model_dump(),
        ) from exc
    except EmptyCommandError as exc:
        raise HTTPException(
            status_code=400,
            detail=CommandError(
                error_code="COMMAND_EMPTY", message=str(exc)
            ).model_dump(),
        ) from exc

    # 4. Apply delta and persist
    try:
        await scene_service.apply_delta(
            body.session_id,
            current_snapshot,
            valid_actions,
            body.command_text,
            db,
        )
    except Exception as exc:
        logger.error("Persistence error: %s", exc)
        # Non-fatal — return actions anyway so client can render
        warnings.append("Scene could not be persisted.")

    return CommandResponse(actions=valid_actions, warnings=warnings)
