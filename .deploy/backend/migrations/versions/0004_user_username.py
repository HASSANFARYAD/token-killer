"""user username

Revision ID: 0004_user_username
Revises: 0003_user_password_hash
Create Date: 2026-06-08
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0004_user_username"
down_revision: str | None = "0003_user_password_hash"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("username", sa.String(128), nullable=True))
    op.create_unique_constraint("uq_users_username", "users", ["username"])


def downgrade() -> None:
    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.drop_column("users", "username")
