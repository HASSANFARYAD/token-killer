import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ExtensionInstallRequest(BaseModel):
    install_key: str = Field(min_length=8, max_length=128)
    vscode_version: str | None = Field(default=None, max_length=64)
    extension_version: str | None = Field(default=None, max_length=64)
    machine_hash: str | None = Field(default=None, max_length=128)


class ExtensionInstallResponse(BaseModel):
    id: uuid.UUID


class RtkSessionRequest(BaseModel):
    extension_install_id: uuid.UUID
    client_session_id: str = Field(min_length=1, max_length=255)
    workspace_hash: str | None = Field(default=None, max_length=128)
    label: str | None = Field(default=None, max_length=255)
    started_at: datetime | None = None
    ended_at: datetime | None = None


class RtkSessionResponse(BaseModel):
    id: uuid.UUID


class UsageSnapshotRequest(BaseModel):
    rtk_session_id: uuid.UUID
    snapshot_hash: str = Field(min_length=16, max_length=128)
    observed_at: datetime
    runs: int = Field(ge=0)
    original_tokens: int = Field(ge=0)
    compressed_tokens: int = Field(ge=0)
    saved_tokens: int = Field(ge=0)
    raw_summary: dict


class UsageEventRequest(BaseModel):
    rtk_session_id: uuid.UUID
    client_event_id: str = Field(min_length=16, max_length=128)
    command: str | None = Field(default=None, max_length=255)
    occurred_at: datetime
    exit_code: int | None = None
    duration_ms: float | None = Field(default=None, ge=0)
    original_tokens: int = Field(ge=0)
    compressed_tokens: int = Field(ge=0)
    saved_tokens: int = Field(ge=0)
    truncated: bool = False


class UsageEventsRequest(BaseModel):
    events: list[UsageEventRequest] = Field(min_length=1, max_length=500)


class UsageWriteResponse(BaseModel):
    inserted: int
    duplicates: int


class UsageSummaryResponse(BaseModel):
    runs: int
    original_tokens: int
    compressed_tokens: int
    saved_tokens: int
