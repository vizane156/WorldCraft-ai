"""
Command validator — JSON Schema validation + asset catalog filter.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import jsonschema

from app.catalog import asset_catalog

_SCHEMA_PATH = Path(__file__).parent.parent / "scene_command_schema.json"
_SCHEMA: dict = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


class ParseError(Exception):
    pass


class SchemaError(Exception):
    pass


class EmptyCommandError(Exception):
    pass


def validate(
    raw_json: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Parse, validate, and filter a Gemini JSON response.

    Returns:
        (valid_actions, warnings)

    Raises:
        ParseError      — raw_json is not valid JSON
        SchemaError     — JSON does not conform to SceneCommand schema
        EmptyCommandError — no valid actions remain after filtering
    """
    # 1. Parse
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ParseError(f"Invalid JSON: {exc}") from exc

    # 2. Schema validation
    try:
        jsonschema.validate(instance=data, schema=_SCHEMA)
    except jsonschema.ValidationError as exc:
        raise SchemaError(exc.message) from exc

    # 3. Filter unknown asset_ids
    valid_actions: list[dict[str, Any]] = []
    warnings: list[str] = []

    for action in data["actions"]:
        if action["action_type"] == "add_object":
            if not asset_catalog.is_known(action["asset_id"]):
                warnings.append(
                    f'Unknown asset_id "{action["asset_id"]}" — action skipped.'
                )
                continue
        valid_actions.append(action)

    if not valid_actions:
        raise EmptyCommandError("No valid actions after catalog filtering.")

    return valid_actions, warnings
