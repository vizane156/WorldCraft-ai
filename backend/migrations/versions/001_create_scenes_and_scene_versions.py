"""create scenes and scene_versions

Revision ID: 001
Revises:
Create Date: 2026-10-05
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scenes",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("idx_scenes_session_id", "scenes", ["session_id"], unique=True)

    op.create_table(
        "scene_versions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "scene_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("scenes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", postgresql.JSONB(), nullable=False),
        sa.Column("command", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("scene_id", "version", name="uq_scene_versions_scene_version"),
    )
    op.create_index(
        "idx_scene_versions_scene_id", "scene_versions", ["scene_id"]
    )


def downgrade() -> None:
    op.drop_index("idx_scene_versions_scene_id", table_name="scene_versions")
    op.drop_table("scene_versions")
    op.drop_index("idx_scenes_session_id", table_name="scenes")
    op.drop_table("scenes")
