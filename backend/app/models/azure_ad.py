import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.types import created_at_column, updated_at_column, uuid_pk


class SystemSetting(Base):
    __tablename__ = "system_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_system_settings_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(128), nullable=False)
    value: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class AzureAdSetting(Base):
    __tablename__ = "azure_ad_settings"
    __table_args__ = (UniqueConstraint("organization_id", name="uq_azure_ad_settings_org"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    client_id: Mapped[str | None] = mapped_column(String(128))
    client_secret_ref: Mapped[str | None] = mapped_column(String(255))
    encrypted_client_secret: Mapped[str | None] = mapped_column(Text)
    authority_host: Mapped[str] = mapped_column(String(255), nullable=False, default="https://login.microsoftonline.com")
    graph_base_url: Mapped[str] = mapped_column(String(255), nullable=False, default="https://graph.microsoft.com/v1.0")
    role_mapping_rules: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class AzureAdSyncRun(Base):
    __tablename__ = "azure_ad_sync_runs"
    __table_args__ = (Index("ix_azure_ad_sync_runs_org_created", "organization_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    imported_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_users: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_column()


class AzureAdUserMapping(Base):
    __tablename__ = "azure_ad_user_mappings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "object_id", name="uq_azure_ad_user_mappings_tenant_object"),
        Index("ix_azure_ad_user_mappings_org_user", "organization_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tenant_id: Mapped[str] = mapped_column(String(128), nullable=False)
    object_id: Mapped[str] = mapped_column(String(128), nullable=False)
    mail: Mapped[str | None] = mapped_column(String(255))
    user_principal_name: Mapped[str | None] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(255))
    job_title: Mapped[str | None] = mapped_column(String(255))
    department: Mapped[str | None] = mapped_column(String(255))
    manager_object_id: Mapped[str | None] = mapped_column(String(128))
    account_enabled: Mapped[bool | None] = mapped_column(Boolean)
    raw_profile: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
