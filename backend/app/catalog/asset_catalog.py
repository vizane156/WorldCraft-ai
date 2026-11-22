"""
Asset catalog loader — loaded once at startup, never per-request.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import TypedDict


class AssetEntry(TypedDict):
    id: str
    label: str
    glb_path: str
    category: str
    default_scale: list[float]
    min_scale: float
    max_scale: float
    pivot: str
    tags: list[str]


_CATALOG_PATH = Path(__file__).parent / "assets.json"


@lru_cache
def _load() -> dict[str, AssetEntry]:
    data = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))
    return {entry["id"]: entry for entry in data["assets"]}


def get_all_ids() -> list[str]:
    return list(_load().keys())


def lookup(asset_id: str) -> AssetEntry | None:
    return _load().get(asset_id)


def is_known(asset_id: str) -> bool:
    return asset_id in _load()


def get_catalog_for_prompt() -> str:
    """Compact representation sent to Gemini — id + tags only."""
    entries = _load().values()
    lines = [f'- {e["id"]}: {", ".join(e["tags"])}' for e in entries]
    return "\n".join(lines)
