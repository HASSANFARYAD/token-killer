import uuid
from datetime import date, datetime

from sqlalchemy import BigInteger, Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String
from sqlalchemy import UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.types import created_at_column, updated_at_column, uuid_pk


class ExtensionInstall(Base):
    __tablename__ = "extension_installs"
    __table_args__ = (
        UniqueConstraint("user_id", "install_key", name="uq_extension_installs_user_install_key"),
        Index("ix_extension_installs_org_user", "organization_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    install_key: Mapped[str] = mapped_column(String(128), nullable=False)
    vscode_version: Mapped[str | None] = mapped_column(String(64))
    extension_version: Mapped[str | None] = mapped_column(String(64))
    machine_hash: Mapped[str | None] = mapped_column(String(128))
    created_at: Mapped[datetime] = created_at_column()
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class RtkSession(Base):
    __tablename__ = "rtk_sessions"
    __table_args__ = (
        UniqueConstraint(
            "extension_install_id", "client_session_id", name="uq_rtk_sessions_install_client"
        ),
        Index("ix_rtk_sessions_org_user", "organization_id", "user_id"),
        Index("ix_rtk_sessions_started_at", "started_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    extension_install_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("extension_installs.id", ondelete="CASCADE"), nullable=False
    )
    client_session_id: Mapped[str] = mapped_column(String(255), nullable=False)
    workspace_hash: Mapped[str | None] = mapped_column(String(128))
    label: Mapped[str | None] = mapped_column(String(255))
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()


class RtkUsageSnapshot(Base):
    __tablename__ = "rtk_usage_snapshots"
    __table_args__ = (
        UniqueConstraint("rtk_session_id", "snapshot_hash", name="uq_usage_snapshots_session_hash"),
        Index("ix_usage_snapshots_observed_at", "observed_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    rtk_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rtk_sessions.id", ondelete="CASCADE"), nullable=False
    )
    snapshot_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    runs: Mapped[int] = mapped_column(Integer, nullable=False)
    original_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False)
    compressed_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False)
    saved_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False)
    raw_summary: Mapped[dict] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = created_at_column()


class RtkUsageEvent(Base):
    __tablename__ = "rtk_usage_events"
    __table_args__ = (
        UniqueConstraint("rtk_session_id", "client_event_id", name="uq_usage_events_session_event"),
        Index("ix_usage_events_occurred_at", "occurred_at"),
        Index("ix_usage_events_session_time", "rtk_session_id", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    rtk_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rtk_sessions.id", ondelete="CASCADE"), nullable=False
    )
    client_event_id: Mapped[str] = mapped_column(String(128), nullable=False)
    command_category: Mapped[str] = mapped_column(String(64), nullable=False, default="other")
    command_hash: Mapped[str | None] = mapped_column(String(128))
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    exit_code: Mapped[int | None] = mapped_column(Integer)
    duration_ms: Mapped[float | None] = mapped_column(Numeric(12, 1))
    original_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    compressed_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    saved_tokens: Mapped[int] = mapped_column(Integer, nullable=False)
    truncated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = created_at_column()


class TokenSavingsDailyRollup(Base):
    __tablename__ = "token_savings_daily_rollups"
    __table_args__ = (
        UniqueConstraint(
            "organization_id",
            "user_id",
            "rtk_session_id",
            "day",
            name="uq_daily_rollups_org_user_session_day",
        ),
        Index("ix_daily_rollups_org_day", "organization_id", "day"),
        Index("ix_daily_rollups_user_day", "user_id", "day"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    rtk_session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("rtk_sessions.id", ondelete="CASCADE"), nullable=False
    )
    day: Mapped[date] = mapped_column(Date, nullable=False)
    runs: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    original_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    compressed_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    saved_tokens: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    created_at: Mapped[datetime] = created_at_column()
    updated_at: Mapped[datetime] = updated_at_column()
