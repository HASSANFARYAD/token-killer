from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import ROLE_PERMISSIONS, Principal, require_active_user
from app.api.rate_limit import rate_limit
from app.db import get_db
from app.models.identity import MicrosoftIdentity
from app.models.organization import DepartmentManager, DepartmentUser, Organization, OrganizationMember, User
from app.models.rbac import Role, UserRole
from app.schemas.auth import AuthResponse, CurrentUserResponse, MicrosoftLoginRequest
from app.services.auth_tokens import create_access_token
from app.services.microsoft import verify_microsoft_access_token

router = APIRouter(prefix="/auth", tags=["auth"])
api_router = APIRouter(prefix="/api/auth", tags=["auth"])


def permissions_for_roles(roles: list[str], is_super_admin: bool = False) -> list[str]:
    if is_super_admin:
        return ["*"]
    permissions: set[str] = set()
    for role in roles:
        permissions.update(ROLE_PERMISSIONS.get(role, set()))
    return sorted(permissions)


def role_keys_for_member(db: Session, member_id) -> list[str]:
    return list(
        db.scalars(
            select(Role.key)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.organization_member_id == member_id)
        )
    )


async def verify_microsoft_login(
    body: MicrosoftLoginRequest,
    db: Session = Depends(get_db),
    _: None = rate_limit(20, 60),
) -> AuthResponse:
    claims = await verify_microsoft_access_token(body.access_token)

    organization = db.scalar(
        select(Organization).where(Organization.microsoft_tenant_id == claims.tenant_id)
    )
    if not organization:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ORG_NOT_CONFIGURED")

    identity = db.scalar(
        select(MicrosoftIdentity).where(
            MicrosoftIdentity.tenant_id == claims.tenant_id,
            MicrosoftIdentity.object_id == claims.object_id,
        )
    )
    if identity:
        user = db.get(User, identity.user_id)
    else:
        user = db.scalar(select(User).where(User.email == claims.email))
        if not user:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "USER_NOT_REGISTERED")
        identity = MicrosoftIdentity(
            user_id=user.id,
            tenant_id=claims.tenant_id,
            object_id=claims.object_id,
            email=claims.email,
        )
        db.add(identity)

    user.display_name = claims.display_name or user.display_name
    if user.disabled_at:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "USER_DISABLED")

    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.user_id == user.id,
            OrganizationMember.status == "active",
        )
    )
    if not member:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "USER_NOT_REGISTERED")

    db.commit()
    token, expires_in = create_access_token(user.id, organization.id)
    roles = role_keys_for_member(db, member.id)
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user_id=user.id,
        organization_id=organization.id,
        roles=roles,
        permissions=permissions_for_roles(roles, member.is_super_admin),
    )


router.post("/microsoft", response_model=AuthResponse)(verify_microsoft_login)
api_router.post("/microsoft/verify", response_model=AuthResponse)(verify_microsoft_login)


@router.post("/logout")
def logout(_: Principal = Depends(require_active_user)) -> dict:
    return {"ok": True}


@router.post("/refresh", response_model=AuthResponse)
def refresh(
    principal: Principal = Depends(require_active_user),
) -> AuthResponse:
    token, expires_in = create_access_token(principal.user_id, principal.organization_id)
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user_id=principal.user_id,
        organization_id=principal.organization_id,
        roles=list(principal.roles),
        permissions=permissions_for_roles(list(principal.roles), principal.is_super_admin),
    )


@router.get("/me", response_model=CurrentUserResponse)
def me(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> CurrentUserResponse:
    user = db.get(User, principal.user_id)
    departments = set(
        db.scalars(select(DepartmentUser.department_id).where(DepartmentUser.user_id == principal.user_id))
    )
    departments.update(
        db.scalars(select(DepartmentManager.department_id).where(DepartmentManager.user_id == principal.user_id))
    )
    return CurrentUserResponse(
        user_id=principal.user_id,
        organization_id=principal.organization_id,
        email=user.email,
        display_name=user.display_name,
        roles=list(principal.roles),
        permissions=permissions_for_roles(list(principal.roles), principal.is_super_admin),
        departments=sorted(departments, key=str),
    )


api_router.post("/logout")(logout)
api_router.post("/refresh", response_model=AuthResponse)(refresh)
api_router.get("/me", response_model=CurrentUserResponse)(me)

