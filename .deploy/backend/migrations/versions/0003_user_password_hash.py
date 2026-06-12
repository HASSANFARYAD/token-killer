"""user password hash

Revision ID: 0003_user_password_hash
Revises: 0002_org_access_system
Create Date: 2026-06-08
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0003_user_password_hash"
down_revision: str | None = "0002_org_access_system"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(512), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "password_hash")
