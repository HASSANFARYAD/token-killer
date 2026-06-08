import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.organization import OrganizationMember, User
from app.models.rbac import Role, UserRole
from app.services.auth_tokens import decode_access_token


bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    user_id: uuid.UUID
    organization_id: uuid.UUID
    member_id: uuid.UUID | None = None
    roles: tuple[str, ...] = ()
    is_super_admin: bool = False


ROLE_PERMISSIONS = {
    "SUPER_ADMIN": {"*"},
    "EXECUTIVE": {
        "dashboard:view_all",
        "users:view_all",
        "departments:view_all",
        "roles:view",
    },
    "ORG_ADMIN": {
        "dashboard:view_all",
        "users:manage",
        "users:view_all",
        "departments:manage",
        "departments:view_all",
        "roles:view",
    },
    "DEPARTMENT_MANAGER": {
        "dashboard:view_department",
        "users:view_department",
        "departments:view_assigned",
    },
    "ANALYST": {
        "dashboard:view_all",
        "users:view_all",
        "departments:view_all",
    },
    "READ_ONLY_ADMIN": {
        "dashboard:view_all",
        "users:view_all",
        "departments:view_all",
        "roles:view",
    },
    "EMPLOYEE": {
        "dashboard:view_own",
        "users:view_own",
    },
}


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
    role_keys = tuple(
        db.scalars(
            select(Role.key)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.organization_member_id == member.id)
        ).all()
    )
    return Principal(
        user_id=principal.user_id,
        organization_id=principal.organization_id,
        member_id=member.id,
        roles=role_keys,
        is_super_admin=member.is_super_admin or "SUPER_ADMIN" in role_keys,
    )


def has_permission(principal: Principal, permission: str) -> bool:
    if principal.is_super_admin:
        return True
    for role in principal.roles:
        permissions = ROLE_PERMISSIONS.get(role, set())
        if "*" in permissions or permission in permissions:
            return True
    return False


def require_permission(permission: str):
    def dependency(principal: Principal = Depends(require_active_user)) -> Principal:
        if not has_permission(principal, permission):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
        return principal

    return dependency
