import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.organization import OrganizationMember, User
from app.services.auth_tokens import decode_access_token


bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    organization_id: uuid.UUID


def current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Principal:
    if not credentials:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "missing_bearer_token")
    try:
        payload = decode_access_token(credentials.credentials)
        return Principal(user_id=uuid.UUID(payload["sub"]), organization_id=uuid.UUID(payload["org"]))
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid_bearer_token") from exc


def require_active_user(
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
) -> Principal:
    user = db.get(User, principal.user_id)
    if not user or user.disabled_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "user_disabled")
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == principal.organization_id,
            OrganizationMember.user_id == principal.user_id,
            OrganizationMember.status == "active",
        )
    )
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "organization_membership_required")
    return principal
