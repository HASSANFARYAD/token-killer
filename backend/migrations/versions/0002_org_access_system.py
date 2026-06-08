"""organization access system

Revision ID: 0002_org_access_system
Revises: 0001_initial_schema
Create Date: 2026-06-08
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0002_org_access_system"
down_revision: str | None = "0001_initial_schema"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("job_title", sa.String(255), nullable=True))
    op.add_column(
        "organization_members",
        sa.Column("is_super_admin", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "roles", sa.Column("system", sa.Boolean(), nullable=False, server_default=sa.false())
    )
    op.create_index(
        "uq_one_active_super_admin",
        "organization_members",
        ["organization_id"],
        unique=True,
        postgresql_where=sa.text("is_super_admin = true AND status = 'active'"),
    )

    op.create_table(
        "system_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(128), nullable=False),
        sa.Column("value", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("key", name="uq_system_settings_key"),
    )
    op.create_table(
        "azure_ad_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("client_id", sa.String(128)),
        sa.Column("client_secret_ref", sa.String(255)),
        sa.Column("encrypted_client_secret", sa.Text()),
        sa.Column("authority_host", sa.String(255), nullable=False),
        sa.Column("graph_base_url", sa.String(255), nullable=False),
        sa.Column("role_mapping_rules", postgresql.JSONB(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("organization_id", name="uq_azure_ad_settings_org"),
    )
    op.create_table(
        "azure_ad_sync_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(32), nullable=False),
        sa.Column("imported_users", sa.Integer(), nullable=False),
        sa.Column("updated_users", sa.Integer(), nullable=False),
        sa.Column("errors", postgresql.JSONB(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "ix_azure_ad_sync_runs_org_created",
        "azure_ad_sync_runs",
        ["organization_id", "created_at"],
    )
    op.create_table(
        "azure_ad_user_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.String(128), nullable=False),
        sa.Column("object_id", sa.String(128), nullable=False),
        sa.Column("mail", sa.String(255)),
        sa.Column("user_principal_name", sa.String(255)),
        sa.Column("display_name", sa.String(255)),
        sa.Column("job_title", sa.String(255)),
        sa.Column("department", sa.String(255)),
        sa.Column("manager_object_id", sa.String(128)),
        sa.Column("account_enabled", sa.Boolean()),
        sa.Column("raw_profile", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("tenant_id", "object_id", name="uq_azure_ad_user_mappings_tenant_object"),
    )
    op.create_index(
        "ix_azure_ad_user_mappings_org_user",
        "azure_ad_user_mappings",
        ["organization_id", "user_id"],
    )

    op.create_table(
        "departments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("organization_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("external_key", sa.String(255)),
        sa.Column("disabled_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("organization_id", "name", name="uq_departments_org_name"),
    )
    op.create_index("ix_departments_org_active", "departments", ["organization_id", "disabled_at"])
    op.create_table(
        "department_users",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("department_id", "user_id", name="uq_department_users_department_user"),
    )
    op.create_index("ix_department_users_user", "department_users", ["user_id"])
    op.create_table(
        "department_managers",
        sa.Column("department_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("department_id", "user_id", name="uq_department_managers_department_user"),
    )
    op.create_index("ix_department_managers_user", "department_managers", ["user_id"])
    op.create_table(
        "user_role_overrides",
        sa.Column("organization_member_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("role_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("overridden_by_user_id", postgresql.UUID(as_uuid=True)),
        sa.Column("reason", sa.String(255)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True)),
        sa.ForeignKeyConstraint(
            ["organization_member_id"], ["organization_members.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["role_id"], ["roles.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["overridden_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("organization_member_id", name="uq_user_role_overrides_member"),
    )

    op.create_index("ix_usage_snapshots_session_observed", "rtk_usage_snapshots", ["rtk_session_id", "observed_at"])
    op.create_index("ix_usage_events_created_at", "rtk_usage_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_usage_events_created_at", table_name="rtk_usage_events")
    op.drop_index("ix_usage_snapshots_session_observed", table_name="rtk_usage_snapshots")
    op.drop_table("user_role_overrides")
    op.drop_index("ix_department_managers_user", table_name="department_managers")
    op.drop_table("department_managers")
    op.drop_index("ix_department_users_user", table_name="department_users")
    op.drop_table("department_users")
    op.drop_index("ix_departments_org_active", table_name="departments")
    op.drop_table("departments")
    op.drop_index("ix_azure_ad_user_mappings_org_user", table_name="azure_ad_user_mappings")
    op.drop_table("azure_ad_user_mappings")
    op.drop_index("ix_azure_ad_sync_runs_org_created", table_name="azure_ad_sync_runs")
    op.drop_table("azure_ad_sync_runs")
    op.drop_table("azure_ad_settings")
    op.drop_table("system_settings")
    op.drop_index("uq_one_active_super_admin", table_name="organization_members")
    op.drop_column("roles", "system")
    op.drop_column("organization_members", "is_super_admin")
    op.drop_column("users", "job_title")
