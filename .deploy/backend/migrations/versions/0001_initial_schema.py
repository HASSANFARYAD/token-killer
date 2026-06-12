"""initial schema

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-06-05
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")

    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("microsoft_tenant_id", sa.String(128), nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("domain", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("microsoft_tenant_id"),
    )
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("display_name", sa.String(255)),
        sa.Column("disabled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("email"),
    )
    op.create_table(
        "permissions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("description", sa.String(255)),
        sa.UniqueConstraint("key"),
    )
    op.create_table(
        "organization_members",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("organization_id", "user_id", name="uq_organization_members_org_user"),
    )
    op.create_index("ix_organization_members_org_status", "organization_members", ["organization_id", "status"])

    op.create_table(
        "roles",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True)),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("organization_id", "key", name="uq_roles_org_key"),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("permission_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.ForeignKeyConstraint(["permission_id"], ["permissions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
    )
    op.create_table(
        "user_roles",
        sa.Column("organization_member_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.ForeignKeyConstraint(["organization_member_id"], ["organization_members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_user_roles_role", "user_roles", ["role_id"])

    op.create_table(
        "microsoft_identities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("object_id", sa.String(128), nullable=False),
        sa.Column("email", postgresql.CITEXT()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "object_id", name="uq_microsoft_identities_tenant_object"),
    )
    op.create_index("ix_microsoft_identities_user", "microsoft_identities", ["user_id"])

    op.create_table(
        "extension_installs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("install_key", sa.String(128), nullable=False),
        sa.Column("vscode_version", sa.String(64)),
        sa.Column("extension_version", sa.String(64)),
        sa.Column("machine_hash", sa.String(128)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "install_key", name="uq_extension_installs_user_install_key"),
    )
    op.create_index("ix_extension_installs_org_user", "extension_installs", ["organization_id", "user_id"])

    op.create_table(
        "rtk_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("extension_install_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_session_id", sa.String(255), nullable=False),
        sa.Column("workspace_hash", sa.String(128)),
        sa.Column("label", sa.String(255)),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["extension_install_id"], ["extension_installs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("extension_install_id", "client_session_id", name="uq_rtk_sessions_install_client"),
    )
    op.create_index("ix_rtk_sessions_org_user", "rtk_sessions", ["organization_id", "user_id"])
    op.create_index("ix_rtk_sessions_started_at", "rtk_sessions", ["started_at"])

    op.create_table(
        "rtk_usage_snapshots",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rtk_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("snapshot_hash", sa.String(128), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("runs", sa.Integer(), nullable=False),
        sa.Column("original_tokens", sa.BigInteger(), nullable=False),
        sa.Column("compressed_tokens", sa.BigInteger(), nullable=False),
        sa.Column("saved_tokens", sa.BigInteger(), nullable=False),
        sa.Column("raw_summary", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["rtk_session_id"], ["rtk_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("rtk_session_id", "snapshot_hash", name="uq_usage_snapshots_session_hash"),
    )
    op.create_index("ix_usage_snapshots_observed_at", "rtk_usage_snapshots", ["observed_at"])

    op.create_table(
        "rtk_usage_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rtk_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("client_event_id", sa.String(128), nullable=False),
        sa.Column("command_category", sa.String(64), nullable=False),
        sa.Column("command_hash", sa.String(128)),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("exit_code", sa.Integer()),
        sa.Column("duration_ms", sa.Numeric(12, 1)),
        sa.Column("original_tokens", sa.Integer(), nullable=False),
        sa.Column("compressed_tokens", sa.Integer(), nullable=False),
        sa.Column("saved_tokens", sa.Integer(), nullable=False),
        sa.Column("truncated", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["rtk_session_id"], ["rtk_sessions.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("rtk_session_id", "client_event_id", name="uq_usage_events_session_event"),
    )
    op.create_index("ix_usage_events_occurred_at", "rtk_usage_events", ["occurred_at"])
    op.create_index("ix_usage_events_session_time", "rtk_usage_events", ["rtk_session_id", "occurred_at"])

    op.create_table(
        "token_savings_daily_rollups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("rtk_session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("runs", sa.Integer(), nullable=False),
        sa.Column("original_tokens", sa.BigInteger(), nullable=False),
        sa.Column("compressed_tokens", sa.BigInteger(), nullable=False),
        sa.Column("saved_tokens", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["rtk_session_id"], ["rtk_sessions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint(
            "organization_id",
            "user_id",
            "rtk_session_id",
            "day",
            name="uq_daily_rollups_org_user_session_day",
        ),
    )
    op.create_index("ix_daily_rollups_org_day", "token_savings_daily_rollups", ["organization_id", "day"])
    op.create_index("ix_daily_rollups_user_day", "token_savings_daily_rollups", ["user_id", "day"])

    op.create_table(
        "audit_logs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("action", sa.String(128), nullable=False),
        sa.Column("target_type", sa.String(64)),
        sa.Column("target_id", postgresql.UUID(as_uuid=True)),
        sa.Column("metadata", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_audit_logs_org_created", "audit_logs", ["organization_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_audit_logs_org_created", table_name="audit_logs")
    op.drop_table("audit_logs")
    op.drop_index("ix_daily_rollups_user_day", table_name="token_savings_daily_rollups")
    op.drop_index("ix_daily_rollups_org_day", table_name="token_savings_daily_rollups")
    op.drop_table("token_savings_daily_rollups")
    op.drop_index("ix_usage_events_session_time", table_name="rtk_usage_events")
    op.drop_index("ix_usage_events_occurred_at", table_name="rtk_usage_events")
    op.drop_table("rtk_usage_events")
    op.drop_index("ix_usage_snapshots_observed_at", table_name="rtk_usage_snapshots")
    op.drop_table("rtk_usage_snapshots")
    op.drop_index("ix_rtk_sessions_started_at", table_name="rtk_sessions")
    op.drop_index("ix_rtk_sessions_org_user", table_name="rtk_sessions")
    op.drop_table("rtk_sessions")
    op.drop_index("ix_extension_installs_org_user", table_name="extension_installs")
    op.drop_table("extension_installs")
    op.drop_index("ix_microsoft_identities_user", table_name="microsoft_identities")
    op.drop_table("microsoft_identities")
    op.drop_index("ix_user_roles_role", table_name="user_roles")
    op.drop_table("user_roles")
    op.drop_table("role_permissions")
    op.drop_table("roles")
    op.drop_index("ix_organization_members_org_status", table_name="organization_members")
    op.drop_table("organization_members")
    op.drop_table("permissions")
    op.drop_table("users")
    op.drop_table("organizations")
