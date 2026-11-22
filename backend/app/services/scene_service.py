"""
Scene service — DB CRUD and delta merge.
The server is the authority on scene state for AI commands.
"""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.scene import Scene
from app.models.scene_version import SceneVersion
from app.schemas.scene import SceneSnapshot


async def get_scene(session_id: uuid.UUID, db: AsyncSession) -> Scene | None:
    result = await db.execute(
        select(Scene).where(Scene.session_id == session_id)
    )
    return result.scalar_one_or_none()


async def upsert_scene(
    session_id: uuid.UUID,
    snapshot: SceneSnapshot,
    db: AsyncSession,
    command_text: str | None = None,
) -> Scene:
    existing = await get_scene(session_id, db)
    snapshot_dict = snapshot.model_dump()

    if existing is None:
        scene = Scene(
            session_id=session_id,
            version=1,
            snapshot=snapshot_dict,
        )
        db.add(scene)
        await db.flush()
    else:
        existing.version += 1
        existing.snapshot = snapshot_dict
        scene = existing
        await db.flush()

    version_row = SceneVersion(
        scene_id=scene.id,
        version=scene.version,
        snapshot=snapshot_dict,
        command=command_text,
    )
    db.add(version_row)
    await db.commit()
    await db.refresh(scene)
    return scene


async def apply_delta(
    session_id: uuid.UUID,
    current_snapshot: SceneSnapshot,
    validated_actions: list[dict[str, Any]],
    command_text: str,
    db: AsyncSession,
) -> Scene:
    """
    Merge validated actions into current_snapshot and persist.
    Returns the updated Scene record.
    """
    objects = {obj.label.lower(): obj for obj in current_snapshot.objects}

    for action in validated_actions:
        action_type = action["action_type"]

        if action_type == "add_object":
            from app.schemas.scene import SceneObject, Transform
            new_obj = SceneObject(
                id=str(uuid.uuid4()),
                asset_id=action["asset_id"],
                label=action["label"],
                transform=Transform(
                    position=action["position"],
                    rotation=(0.0, 0.0, 0.0, 1.0),
                    scale=(
                        action.get("scale", 1.0),
                        action.get("scale", 1.0),
                        action.get("scale", 1.0),
                    ),
                ),
            )
            objects[new_obj.label.lower()] = new_obj

        elif action_type == "move_object":
            key = action["target_label"].lower()
            if key in objects:
                obj = objects[key]
                objects[key] = obj.model_copy(
                    update={"transform": obj.transform.model_copy(
                        update={"position": tuple(action["position"])}
                    )}
                )

        elif action_type == "remove_object":
            objects.pop(action["target_label"].lower(), None)

        elif action_type == "modify_object":
            key = action["target_label"].lower()
            if key in objects and action.get("scale") is not None:
                obj = objects[key]
                s = float(action["scale"])
                objects[key] = obj.model_copy(
                    update={"transform": obj.transform.model_copy(
                        update={"scale": (s, s, s)}
                    )}
                )

    new_snapshot = current_snapshot.model_copy(
        update={"objects": list(objects.values())}
    )
    return await upsert_scene(session_id, new_snapshot, db, command_text)
