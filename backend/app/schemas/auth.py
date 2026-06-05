import uuid

from pydantic import BaseModel, Field


class MicrosoftLoginRequest(BaseModel):
    access_token: str = Field(min_length=20)


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user_id: uuid.UUID
    organization_id: uuid.UUID


class CurrentUserResponse(BaseModel):
    user_id: uuid.UUID
    organization_id: uuid.UUID
    email: str
    display_name: str | None = None
    roles: list[str] = []
