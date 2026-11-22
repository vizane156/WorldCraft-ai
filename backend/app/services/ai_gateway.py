"""
AI Gateway — Gemini API client.
Builds the prompt, calls Gemini, returns raw JSON string.
Validation is command_validator's responsibility.
"""
from __future__ import annotations

import json
import logging

from google import genai
from google.genai import types

from app.catalog import asset_catalog
from app.config import Settings
from app.schemas.scene import SceneSnapshot

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT_TEMPLATE = """\
You are the WorldCraft AI scene director.
Your only job is to return a JSON object that conforms exactly to the \
WorldCraft Scene Command Schema provided below.
Do not explain. Do not add prose. Return only the JSON object.

Asset Catalog (exhaustive list of valid asset IDs and their tags):
{catalog}

Scene Command Schema:
{schema}

Rules:
- Only use asset IDs from the catalog above. Never invent new ones.
- Coordinates are in meters. X and Z range from -0.5 to 0.5. Y ranges from 0 to 0.3.
- For follow-up commands, only modify the objects mentioned. Leave others unchanged.
"""


class GeminiUnavailableError(Exception):
    pass


def _build_prompt(
    command_text: str,
    scene_snapshot: SceneSnapshot,
    schema_str: str,
) -> tuple[str, str]:
    """Returns (system_prompt, user_prompt)."""
    catalog_str = asset_catalog.get_catalog_for_prompt()
    system = _SYSTEM_PROMPT_TEMPLATE.format(
        catalog=catalog_str,
        schema=schema_str,
    )

    # Compact scene state — id, label, asset_id, position only
    if scene_snapshot.objects:
        objects_summary = json.dumps(
            [
                {
                    "id": o.id,
                    "label": o.label,
                    "asset_id": o.asset_id,
                    "position": list(o.transform.position),
                }
                for o in scene_snapshot.objects
            ],
            indent=None,
        )
    else:
        objects_summary = "empty"

    user = f"Current scene state:\n{objects_summary}\n\nUser command:\n\"{command_text}\""
    logger.info("Gemini user prompt: %s", user)
    return system, user


async def generate_command(
    command_text: str,
    scene_snapshot: SceneSnapshot,
    settings: Settings,
    schema_str: str,
) -> str:
    """
    Call Gemini and return the raw JSON response string.
    Retries once on 5xx errors.
    Raises GeminiUnavailableError after two failures.
    """
    system_prompt, user_prompt = _build_prompt(command_text, scene_snapshot, schema_str)

    client = genai.Client(api_key=settings.gemini_api_key)

    for attempt in range(2):
        try:
            response = await client.aio.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    max_output_tokens=1024,
                ),
            )
            logger.info("Gemini raw response: %s", response.text)
            return response.text or ""

        except Exception as exc:
            logger.warning("Gemini attempt %d failed: %s", attempt + 1, exc)
            if attempt == 1:
                raise GeminiUnavailableError(str(exc)) from exc

    raise GeminiUnavailableError("Unreachable")
