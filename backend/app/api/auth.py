from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.identity import MicrosoftIdentity
from app.models.organization import Organization, OrganizationMember, User
from app.schemas.auth import AuthResponse, CurrentUserResponse, MicrosoftLoginRequest
from app.services.auth_tokens import create_access_token
from app.services.microsoft import verify_microsoft_access_token
from app.api.dependencies import Principal, require_active_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/microsoft", response_model=AuthResponse)
async def microsoft_login(body: MicrosoftLoginRequest, db: Session = Depends(get_db)) -> AuthResponse:
    claims = await verify_microsoft_access_token(body.access_token)

    organization = db.scalar(
        select(Organization).where(Organization.microsoft_tenant_id == claims.tenant_id)
    )
    if not organization:
        organization = Organization(
            microsoft_tenant_id=claims.tenant_id,
            name="RTK Organization",
            domain=claims.email.split("@")[-1],
        )
        db.add(organization)
        db.flush()

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
            user = User(email=claims.email, display_name=claims.display_name)
            db.add(user)
            db.flush()
        identity = MicrosoftIdentity(
            user_id=user.id,
            tenant_id=claims.tenant_id,
            object_id=claims.object_id,
            email=claims.email,
        )
        db.add(identity)

    user.display_name = claims.display_name or user.display_name
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.user_id == user.id,
        )
    )
    if not member:
        member = OrganizationMember(organization_id=organization.id, user_id=user.id, status="active")
        db.add(member)

    db.commit()
    token, expires_in = create_access_token(user.id, organization.id)
    return AuthResponse(
        access_token=token,
        expires_in=expires_in,
        user_id=user.id,
        organization_id=organization.id,
    )


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
    )


@router.get("/me", response_model=CurrentUserResponse)
def me(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> CurrentUserResponse:
    user = db.get(User, principal.user_id)
    return CurrentUserResponse(
        user_id=principal.user_id,
        organization_id=principal.organization_id,
        email=user.email,
        display_name=user.display_name,
        roles=[],
    )

