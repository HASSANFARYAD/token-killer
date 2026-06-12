import uuid
from datetime import date

from pydantic import BaseModel


class OrganizationSummaryResponse(BaseModel):
    organization_id: uuid.UUID
    from_date: date | None = None
    to_date: date | None = None
    active_users: int
    sessions: int
    runs: int
    original_tokens: int
    compressed_tokens: int
    saved_tokens: int


class UserUsageRow(BaseModel):
    user_id: uuid.UUID
    email: str
    sessions: int
    runs: int
    original_tokens: int
    compressed_tokens: int
    saved_tokens: int


class UserUsageTableResponse(BaseModel):
    rows: list[UserUsageRow]
