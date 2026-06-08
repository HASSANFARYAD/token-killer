import uuid
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.auth import permissions_for_roles
from app.api.dependencies import Principal, has_permission, require_active_user, require_permission
from app.api.rate_limit import rate_limit
from app.db import get_db
from app.models.audit import AuditLog
from app.models.azure_ad import AzureAdSetting, AzureAdSyncRun
from app.models.organization import (
    Department,
    DepartmentManager,
    DepartmentUser,
    Organization,
    OrganizationMember,
    User,
)
from app.models.rbac import Role, UserRole, UserRoleOverride
from app.models.rtk import RtkSession, RtkUsageEvent
from app.schemas.admin import OrganizationSummaryResponse, UserUsageRow, UserUsageTableResponse
from app.services.audit import record_audit
from app.services.azure_ad_sync import ENV_VAR_NAME_PATTERN, graph_access_token, sync_users_from_azure_ad

router = APIRouter(prefix="/admin", tags=["admin"])
api_router = APIRouter(prefix="/api", tags=["admin"])

SYSTEM_ROLES = {
    "SUPER_ADMIN": "Super Admin",
    "EXECUTIVE": "Executive",
    "ORG_ADMIN": "Organization Admin",
    "DEPARTMENT_MANAGER": "Department Manager",
    "ANALYST": "Analyst",
    "READ_ONLY_ADMIN": "Read Only Admin",
    "EMPLOYEE": "Employee",
}

DEFAULT_ROLE_MAPPING = {
    "CEO": "EXECUTIVE",
    "Chief": "EXECUTIVE",
    "Director": "EXECUTIVE",
    "VP": "EXECUTIVE",
    "Vice President": "EXECUTIVE",
    "Head": "EXECUTIVE",
    "Manager": "DEPARTMENT_MANAGER",
    "Lead": "DEPARTMENT_MANAGER",
    "Employee": "EMPLOYEE",
    "Developer": "EMPLOYEE",
    "Engineer": "EMPLOYEE",
}


class SuperAdminSetupRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=3, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    organization_name: str = Field(default="RTK Organization", max_length=255)
    domain: str | None = Field(default=None, max_length=255)


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    email: str = Field(min_length=3, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    job_title: str | None = Field(default=None, max_length=255)
    role: str = Field(default="EMPLOYEE", max_length=64)
    department_id: uuid.UUID | None = None


class UserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=128)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    display_name: str | None = Field(default=None, max_length=255)
    job_title: str | None = Field(default=None, max_length=255)
    status: str | None = Field(default=None, max_length=32)


class RoleAssignRequest(BaseModel):
    role: str = Field(min_length=1, max_length=64)
    preserve_manual_override: bool = True


class RoleRequest(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)


class DepartmentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    external_key: str | None = Field(default=None, max_length=255)


class AzureAdSettingsRequest(BaseModel):
    tenant_id: str = Field(min_length=1, max_length=128)
    client_id: str | None = Field(default=None, max_length=128)
    client_secret_ref: str | None = Field(default=None, max_length=255)
    encrypted_client_secret: str | None = None
    role_mapping_rules: dict = Field(default_factory=lambda: DEFAULT_ROLE_MAPPING.copy())
    enabled: bool = True


class UserIdRequest(BaseModel):
    user_id: uuid.UUID


def ensure_system_roles(db: Session, organization_id: uuid.UUID) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for key, name in SYSTEM_ROLES.items():
        role = db.scalar(
            select(Role).where(Role.organization_id == organization_id, Role.key == key)
        )
        if not role:
            role = Role(organization_id=organization_id, key=key, name=name, system=True)
            db.add(role)
            db.flush()
        roles[key] = role
    return roles


def member_for_user(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> OrganizationMember:
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
        )
    )
    if not member:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "USER_NOT_REGISTERED")
    return member


def assign_role(db: Session, member: OrganizationMember, role: Role) -> None:
    existing = db.get(UserRole, {"organization_member_id": member.id, "role_id": role.id})
    if not existing:
        db.add(UserRole(organization_member_id=member.id, role_id=role.id))


def role_rows_for_member(db: Session, member_id: uuid.UUID) -> list[str]:
    return list(
        db.scalars(
            select(Role.key)
            .join(UserRole, UserRole.role_id == Role.id)
            .where(UserRole.organization_member_id == member_id)
        )
    )


def user_payload(db: Session, user: User, member: OrganizationMember) -> dict:
    roles = role_rows_for_member(db, member.id)
    user_departments = db.execute(
        select(Department.id, Department.name)
        .join(DepartmentUser, DepartmentUser.department_id == Department.id)
        .where(DepartmentUser.user_id == user.id)
        .order_by(Department.name)
    ).all()
    managed = list(
        db.scalars(select(DepartmentManager.department_id).where(DepartmentManager.user_id == user.id))
    )
    return {
        "id": user.id,
        "email": user.email,
        "username": user.username,
        "display_name": user.display_name,
        "job_title": user.job_title,
        "status": member.status,
        "disabled_at": user.disabled_at,
        "roles": roles,
        "permissions": permissions_for_roles(roles, member.is_super_admin),
        "department_ids": [department_id for department_id, _ in user_departments],
        "departments": [{"id": department_id, "name": name} for department_id, name in user_departments],
        "managed_department_ids": managed,
    }


def managed_department_ids(db: Session, principal: Principal) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(DepartmentManager.department_id).where(DepartmentManager.user_id == principal.user_id)
        )
    )


def dashboard_allowed_user_ids(db: Session, principal: Principal) -> list[uuid.UUID] | None:
    if has_permission(principal, "dashboard:view_all"):
        return None
    if has_permission(principal, "dashboard:view_department"):
        department_ids = managed_department_ids(db, principal)
        if not department_ids:
            return []
        return list(
            db.scalars(
                select(DepartmentUser.user_id).where(DepartmentUser.department_id.in_(department_ids))
            )
        )
    return [principal.user_id]


@api_router.post("/setup/super-admin")
def create_initial_super_admin(
    body: SuperAdminSetupRequest,
    db: Session = Depends(get_db),
    _: None = rate_limit(5, 300),
) -> dict:
    active_super_admin = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.is_super_admin.is_(True),
            OrganizationMember.status == "active",
        )
    )
    if active_super_admin:
        raise HTTPException(status.HTTP_409_CONFLICT, "SUPER_ADMIN_ALREADY_EXISTS")

    organization = db.scalar(
        select(Organization).where(Organization.microsoft_tenant_id == body.tenant_id)
    )
    if not organization:
        organization = Organization(
            microsoft_tenant_id=body.tenant_id,
            name=body.organization_name,
            domain=body.domain or body.email.split("@")[-1],
        )
        db.add(organization)
        db.flush()

    roles = ensure_system_roles(db, organization.id)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user:
        user = User(email=body.email.lower(), display_name=body.display_name)
        db.add(user)
        db.flush()

    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.user_id == user.id,
        )
    )
    if not member:
        member = OrganizationMember(
            organization_id=organization.id,
            user_id=user.id,
            status="active",
            is_super_admin=True,
        )
        db.add(member)
        db.flush()
    else:
        member.status = "active"
        member.is_super_admin = True
    assign_role(db, member, roles["SUPER_ADMIN"])
    record_audit(
        db,
        organization_id=organization.id,
        actor_user_id=user.id,
        action="setup.super_admin_created",
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return {"organization_id": organization.id, "user_id": user.id}


@api_router.get("/admin/system-settings")
def get_system_settings(_: Principal = Depends(require_permission("*"))) -> dict:
    return {"status": "configured"}


@api_router.get("/admin/audit-logs")
def list_audit_logs(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
    limit: int = 100,
) -> dict:
    safe_limit = min(max(limit, 1), 500)
    logs = db.scalars(
        select(AuditLog)
        .where(AuditLog.organization_id == principal.organization_id)
        .order_by(AuditLog.created_at.desc())
        .limit(safe_limit)
    ).all()
    return {
        "rows": [
            {
                "id": log.id,
                "actor_user_id": log.actor_user_id,
                "action": log.action,
                "target_type": log.target_type,
                "target_id": log.target_id,
                "metadata": log.metadata_json,
                "created_at": log.created_at,
            }
            for log in logs
        ]
    }


@api_router.get("/admin/azure-ad/settings")
def get_azure_ad_settings(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    settings = db.scalar(
        select(AzureAdSetting).where(AzureAdSetting.organization_id == principal.organization_id)
    )
    if not settings:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AZURE_AD_SETTINGS_NOT_FOUND")
    return {
        "id": settings.id,
        "tenant_id": settings.tenant_id,
        "client_id": settings.client_id,
        "client_secret_ref": settings.client_secret_ref,
        "role_mapping_rules": settings.role_mapping_rules,
        "enabled": settings.enabled,
        "created_at": settings.created_at,
        "updated_at": settings.updated_at,
    }


@api_router.post("/admin/azure-ad/settings")
@api_router.put("/admin/azure-ad/settings")
def upsert_azure_ad_settings(
    body: AzureAdSettingsRequest,
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    settings = db.scalar(
        select(AzureAdSetting).where(AzureAdSetting.organization_id == principal.organization_id)
    )
    if not settings:
        settings = AzureAdSetting(organization_id=principal.organization_id, tenant_id=body.tenant_id)
        db.add(settings)
    settings.tenant_id = body.tenant_id
    settings.client_id = body.client_id
    if body.client_secret_ref and not ENV_VAR_NAME_PATTERN.fullmatch(body.client_secret_ref):
        settings.client_secret_ref = None
        settings.encrypted_client_secret = body.client_secret_ref
    elif body.client_secret_ref:
        settings.client_secret_ref = body.client_secret_ref
        settings.encrypted_client_secret = None
    elif body.encrypted_client_secret is not None:
        settings.client_secret_ref = None
        settings.encrypted_client_secret = body.encrypted_client_secret
    settings.role_mapping_rules = body.role_mapping_rules
    settings.enabled = body.enabled
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="azure_ad.settings_upserted",
        target_type="azure_ad_settings",
        target_id=settings.id,
    )
    db.commit()
    return {"ok": True, "id": settings.id}


@api_router.delete("/admin/azure-ad/settings")
def delete_azure_ad_settings(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    settings = db.scalar(
        select(AzureAdSetting).where(AzureAdSetting.organization_id == principal.organization_id)
    )
    if settings:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="azure_ad.settings_deleted",
            target_type="azure_ad_settings",
            target_id=settings.id,
        )
        db.delete(settings)
        db.commit()
    return {"ok": True}


@api_router.post("/admin/azure-ad/test")
async def test_azure_ad(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
    _: None = rate_limit(10, 60),
) -> dict:
    settings = db.scalar(
        select(AzureAdSetting).where(AzureAdSetting.organization_id == principal.organization_id)
    )
    if not settings or not settings.enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "AZURE_AD_SETTINGS_NOT_CONFIGURED")
    try:
        await graph_access_token(settings)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    return {"ok": True}


@api_router.post("/admin/azure-ad/sync-users")
async def sync_azure_ad_users(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
    _: None = rate_limit(3, 300),
) -> dict:
    try:
        result = await sync_users_from_azure_ad(db, principal.organization_id)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="azure_ad.users_synced",
        target_type="azure_ad_sync_run",
        target_id=result.run_id,
        metadata={"status": result.status, "imported_users": result.imported_users, "updated_users": result.updated_users},
    )
    db.commit()
    return {
        "sync_run_id": result.run_id,
        "status": result.status,
        "imported_users": result.imported_users,
        "updated_users": result.updated_users,
        "errors": result.errors,
    }


@api_router.get("/admin/azure-ad/sync-status")
def sync_status(
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    run = db.scalar(
        select(AzureAdSyncRun)
        .where(AzureAdSyncRun.organization_id == principal.organization_id)
        .order_by(AzureAdSyncRun.created_at.desc())
    )
    return {"last_run": None if not run else {"id": run.id, "status": run.status, "errors": run.errors}}


@api_router.get("/admin/roles")
def list_roles(
    principal: Principal = Depends(require_permission("roles:view")),
    db: Session = Depends(get_db),
) -> dict:
    ensure_system_roles(db, principal.organization_id)
    db.commit()
    roles = db.scalars(select(Role).where(Role.organization_id == principal.organization_id)).all()
    return {"rows": [{"id": role.id, "key": role.key, "name": role.name, "system": role.system} for role in roles]}


@api_router.post("/admin/roles")
def create_role(
    body: RoleRequest,
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    role = Role(
        organization_id=principal.organization_id,
        key=body.key.upper(),
        name=body.name,
        system=False,
    )
    db.add(role)
    try:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="role.created",
            target_type="role",
            target_id=role.id,
            metadata={"key": role.key},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "ROLE_ALREADY_EXISTS") from exc
    return {"id": role.id, "key": role.key, "name": role.name, "system": role.system}


@api_router.put("/admin/roles/{role_id}")
def update_role(
    role_id: uuid.UUID,
    body: RoleRequest,
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    role = db.get(Role, role_id)
    if not role or role.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ROLE_NOT_FOUND")
    if role.system:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SYSTEM_ROLE_IMMUTABLE")
    role.key = body.key.upper()
    role.name = body.name
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="role.updated",
        target_type="role",
        target_id=role.id,
        metadata={"key": role.key},
    )
    db.commit()
    return {"ok": True}


@api_router.delete("/admin/roles/{role_id}")
def delete_role(
    role_id: uuid.UUID,
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    role = db.get(Role, role_id)
    if not role or role.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ROLE_NOT_FOUND")
    if role.system:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SYSTEM_ROLE_IMMUTABLE")
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="role.deleted",
        target_type="role",
        target_id=role.id,
        metadata={"key": role.key},
    )
    db.delete(role)
    db.commit()
    return {"ok": True}


@api_router.post("/admin/users")
def create_user(
    body: UserCreateRequest,
    principal: Principal = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db),
) -> dict:
    role_key = body.role.upper()
    roles = ensure_system_roles(db, principal.organization_id)
    if role_key == "SUPER_ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SUPER_ADMIN_BOOTSTRAP_REQUIRED")
    role = roles.get(role_key) or db.scalar(
        select(Role).where(Role.organization_id == principal.organization_id, Role.key == role_key)
    )
    if not role:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "ROLE_NOT_FOUND")
    department: Department | None = None
    if body.department_id:
        department = db.get(Department, body.department_id)
        if (
            not department
            or department.organization_id != principal.organization_id
            or department.disabled_at is not None
        ):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "DEPARTMENT_NOT_FOUND")
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if not user:
        user = User(
            email=body.email.lower(),
            username=body.username.strip(),
            display_name=body.display_name,
            job_title=body.job_title,
        )
        db.add(user)
        db.flush()
    else:
        user.username = body.username.strip()
        if body.display_name is not None:
            user.display_name = body.display_name
        if body.job_title is not None:
            user.job_title = body.job_title
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == principal.organization_id,
            OrganizationMember.user_id == user.id,
        )
    )
    if not member:
        member = OrganizationMember(
            organization_id=principal.organization_id,
            user_id=user.id,
            status="active",
        )
        db.add(member)
        db.flush()
    assign_role(db, member, role)
    if department:
        existing_department_user = db.get(
            DepartmentUser, {"department_id": department.id, "user_id": user.id}
        )
        if not existing_department_user:
            db.add(DepartmentUser(department_id=department.id, user_id=user.id))
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="user.created",
        target_type="user",
        target_id=user.id,
        metadata={"role": role.key, "department_id": str(department.id) if department else None},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "USER_ALREADY_EXISTS") from exc
    return user_payload(db, user, member)


@api_router.get("/admin/users")
def list_users(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> dict:
    if not (
        has_permission(principal, "users:view_all")
        or has_permission(principal, "users:manage")
        or has_permission(principal, "users:view_department")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")

    rows = db.execute(
        select(User, OrganizationMember)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(OrganizationMember.organization_id == principal.organization_id)
        .order_by(User.email)
    ).all()
    if (
        has_permission(principal, "users:view_department")
        and not has_permission(principal, "users:view_all")
        and not has_permission(principal, "users:manage")
    ):
        managed_departments = list(
            db.scalars(
                select(DepartmentManager.department_id).where(
                    DepartmentManager.user_id == principal.user_id
                )
            )
        )
        allowed_user_ids = set(
            db.scalars(
                select(DepartmentUser.user_id).where(
                    DepartmentUser.department_id.in_(managed_departments)
                )
            )
        )
        rows = [(user, member) for user, member in rows if user.id in allowed_user_ids]
    return {"rows": [user_payload(db, user, member) for user, member in rows]}


@api_router.get("/admin/users/{user_id}")
def get_user(
    user_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> dict:
    if user_id != principal.user_id and not (
        has_permission(principal, "users:view_all")
        or has_permission(principal, "users:manage")
        or has_permission(principal, "users:view_department")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "USER_NOT_FOUND")
    member = member_for_user(db, principal.organization_id, user_id)
    return user_payload(db, user, member)


@api_router.put("/admin/users/{user_id}")
def update_user(
    user_id: uuid.UUID,
    body: UserUpdateRequest,
    _: Principal = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "USER_NOT_FOUND")
    if body.username is not None:
        user.username = body.username
    if body.email:
        user.email = body.email.lower()
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.job_title is not None:
        user.job_title = body.job_title
    record_audit(
        db,
        organization_id=_.organization_id,
        actor_user_id=_.user_id,
        action="user.updated",
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/disable")
def disable_user(
    user_id: uuid.UUID,
    _: Principal = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "USER_NOT_FOUND")
    user.disabled_at = datetime.now(timezone.utc)
    record_audit(
        db,
        organization_id=_.organization_id,
        actor_user_id=_.user_id,
        action="user.disabled",
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/enable")
def enable_user(
    user_id: uuid.UUID,
    _: Principal = Depends(require_permission("users:manage")),
    db: Session = Depends(get_db),
) -> dict:
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "USER_NOT_FOUND")
    user.disabled_at = None
    record_audit(
        db,
        organization_id=_.organization_id,
        actor_user_id=_.user_id,
        action="user.enabled",
        target_type="user",
        target_id=user.id,
    )
    db.commit()
    return {"ok": True}


@api_router.post("/admin/users/{user_id}/roles")
def assign_user_role(
    user_id: uuid.UUID,
    body: RoleAssignRequest,
    principal: Principal = Depends(require_permission("*")),
    db: Session = Depends(get_db),
) -> dict:
    roles = ensure_system_roles(db, principal.organization_id)
    role = roles.get(body.role) or db.scalar(
        select(Role).where(Role.organization_id == principal.organization_id, Role.key == body.role)
    )
    if not role:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "ROLE_NOT_FOUND")
    member = member_for_user(db, principal.organization_id, user_id)
    if body.role == "SUPER_ADMIN" and not member.is_super_admin:
        raise HTTPException(status.HTTP_409_CONFLICT, "ONLY_ONE_SUPER_ADMIN_ALLOWED")
    db.execute(delete(UserRole).where(UserRole.organization_member_id == member.id))
    if body.preserve_manual_override:
        override = db.get(UserRoleOverride, {"organization_member_id": member.id})
        if not override:
            override = UserRoleOverride(
                organization_member_id=member.id,
                role_id=role.id,
                overridden_by_user_id=principal.user_id,
                reason="Manual role assignment",
            )
            db.add(override)
        else:
            override.role_id = role.id
            override.overridden_by_user_id = principal.user_id
            override.reason = "Manual role assignment"
    assign_role(db, member, role)
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="user.role_assigned",
        target_type="user",
        target_id=user_id,
        metadata={"role": role.key, "preserve_manual_override": body.preserve_manual_override},
    )
    db.commit()
    return {"ok": True}


@api_router.get("/admin/departments")
def list_departments(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> dict:
    if not (
        has_permission(principal, "departments:view_all")
        or has_permission(principal, "departments:manage")
        or has_permission(principal, "departments:view_assigned")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    departments = db.scalars(
        select(Department).where(Department.organization_id == principal.organization_id).order_by(Department.name)
    ).all()
    return {"rows": [{"id": d.id, "name": d.name, "external_key": d.external_key, "disabled_at": d.disabled_at} for d in departments]}


@api_router.post("/admin/departments")
def create_department(
    body: DepartmentRequest,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    department = Department(
        organization_id=principal.organization_id,
        name=body.name,
        external_key=body.external_key,
    )
    db.add(department)
    try:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="department.created",
            target_type="department",
            target_id=department.id,
            metadata={"name": department.name},
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "DEPARTMENT_ALREADY_EXISTS") from exc
    return {"id": department.id, "name": department.name}


@api_router.put("/admin/departments/{department_id}")
def update_department(
    department_id: uuid.UUID,
    body: DepartmentRequest,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    department = db.get(Department, department_id)
    if not department or department.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DEPARTMENT_NOT_FOUND")
    department.name = body.name
    department.external_key = body.external_key
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="department.updated",
        target_type="department",
        target_id=department.id,
    )
    db.commit()
    return {"ok": True}


@api_router.delete("/admin/departments/{department_id}")
def delete_department(
    department_id: uuid.UUID,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    department = db.get(Department, department_id)
    if not department or department.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DEPARTMENT_NOT_FOUND")
    department.disabled_at = datetime.now(timezone.utc)
    record_audit(
        db,
        organization_id=principal.organization_id,
        actor_user_id=principal.user_id,
        action="department.disabled",
        target_type="department",
        target_id=department.id,
    )
    db.commit()
    return {"ok": True}


@api_router.post("/admin/departments/{department_id}/users")
def add_department_user(
    department_id: uuid.UUID,
    body: UserIdRequest,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    department = db.get(Department, department_id)
    user_id = body.user_id
    if not department or department.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DEPARTMENT_NOT_FOUND")
    member_for_user(db, principal.organization_id, user_id)
    db.add(DepartmentUser(department_id=department_id, user_id=user_id))
    try:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="department.user_added",
            target_type="department",
            target_id=department_id,
            metadata={"user_id": str(user_id)},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True}


@api_router.delete("/admin/departments/{department_id}/users/{user_id}")
def remove_department_user(
    department_id: uuid.UUID,
    user_id: uuid.UUID,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(DepartmentUser, {"department_id": department_id, "user_id": user_id})
    if row:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="department.user_removed",
            target_type="department",
            target_id=department_id,
            metadata={"user_id": str(user_id)},
        )
        db.delete(row)
        db.commit()
    return {"ok": True}


@api_router.post("/admin/departments/{department_id}/managers")
def add_department_manager(
    department_id: uuid.UUID,
    body: UserIdRequest,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    user_id = body.user_id
    member_for_user(db, principal.organization_id, user_id)
    db.add(DepartmentManager(department_id=department_id, user_id=user_id))
    try:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="department.manager_added",
            target_type="department",
            target_id=department_id,
            metadata={"user_id": str(user_id)},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
    return {"ok": True}


@api_router.delete("/admin/departments/{department_id}/managers/{user_id}")
def remove_department_manager(
    department_id: uuid.UUID,
    user_id: uuid.UUID,
    principal: Principal = Depends(require_permission("departments:manage")),
    db: Session = Depends(get_db),
) -> dict:
    row = db.get(DepartmentManager, {"department_id": department_id, "user_id": user_id})
    if row:
        record_audit(
            db,
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            action="department.manager_removed",
            target_type="department",
            target_id=department_id,
            metadata={"user_id": str(user_id)},
        )
        db.delete(row)
        db.commit()
    return {"ok": True}


def organization_summary_query(
    organization_id: uuid.UUID,
    from_date: date | None,
    to_date: date | None,
    db: Session,
    user_ids: list[uuid.UUID] | None = None,
) -> OrganizationSummaryResponse:
    query = (
        select(
            func.count(func.distinct(RtkSession.user_id)),
            func.count(func.distinct(RtkSession.id)),
            func.count(RtkUsageEvent.id),
            func.coalesce(func.sum(RtkUsageEvent.original_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.compressed_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.saved_tokens), 0),
        )
        .select_from(RtkUsageEvent)
        .join(RtkSession, RtkSession.id == RtkUsageEvent.rtk_session_id)
        .where(RtkSession.organization_id == organization_id)
    )
    if user_ids is not None:
        if not user_ids:
            return OrganizationSummaryResponse(
                organization_id=organization_id,
                from_date=from_date,
                to_date=to_date,
                active_users=0,
                sessions=0,
                runs=0,
                original_tokens=0,
                compressed_tokens=0,
                saved_tokens=0,
            )
        query = query.where(RtkSession.user_id.in_(user_ids))
    if from_date:
        query = query.where(func.date(RtkUsageEvent.occurred_at) >= from_date)
    if to_date:
        query = query.where(func.date(RtkUsageEvent.occurred_at) <= to_date)
    row = db.execute(query).one()
    return OrganizationSummaryResponse(
        organization_id=organization_id,
        from_date=from_date,
        to_date=to_date,
        active_users=row[0],
        sessions=row[1],
        runs=row[2],
        original_tokens=row[3],
        compressed_tokens=row[4],
        saved_tokens=row[5],
    )


@router.get("/orgs/{organization_id}/summary", response_model=OrganizationSummaryResponse)
def organization_summary(
    organization_id: uuid.UUID,
    from_date: date | None = None,
    to_date: date | None = None,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> OrganizationSummaryResponse:
    if organization_id != principal.organization_id or not has_permission(principal, "dashboard:view_all"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    return organization_summary_query(organization_id, from_date, to_date, db)


@api_router.get("/dashboard/summary", response_model=OrganizationSummaryResponse)
def dashboard_summary(
    from_date: date | None = None,
    to_date: date | None = None,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> OrganizationSummaryResponse:
    if not (
        has_permission(principal, "dashboard:view_all")
        or has_permission(principal, "dashboard:view_department")
        or has_permission(principal, "dashboard:view_own")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    return organization_summary_query(
        principal.organization_id,
        from_date,
        to_date,
        db,
        dashboard_allowed_user_ids(db, principal),
    )


def user_usage_table(
    organization_id: uuid.UUID,
    db: Session,
    user_ids: list[uuid.UUID] | None = None,
) -> UserUsageTableResponse:
    query = (
        select(
            User.id,
            User.email,
            func.count(RtkUsageEvent.id),
            func.coalesce(func.sum(RtkUsageEvent.original_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.compressed_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.saved_tokens), 0),
        )
        .select_from(RtkUsageEvent)
        .join(RtkSession, RtkSession.id == RtkUsageEvent.rtk_session_id)
        .join(User, User.id == RtkSession.user_id)
        .where(RtkSession.organization_id == organization_id)
        .group_by(User.id, User.email)
        .order_by(func.coalesce(func.sum(RtkUsageEvent.saved_tokens), 0).desc())
    )
    if user_ids is not None:
        if not user_ids:
            return UserUsageTableResponse(rows=[])
        query = query.where(RtkSession.user_id.in_(user_ids))
    rows = db.execute(query).all()
    return UserUsageTableResponse(
        rows=[
            UserUsageRow(
                user_id=row[0],
                email=row[1],
                runs=row[2],
                original_tokens=row[3],
                compressed_tokens=row[4],
                saved_tokens=row[5],
            )
            for row in rows
        ]
    )


@router.get("/orgs/{organization_id}/users", response_model=UserUsageTableResponse)
def organization_users(
    organization_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UserUsageTableResponse:
    if organization_id != principal.organization_id or not has_permission(principal, "dashboard:view_all"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    return user_usage_table(organization_id, db)


@api_router.get("/dashboard/users", response_model=UserUsageTableResponse)
def dashboard_users(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UserUsageTableResponse:
    if not (
        has_permission(principal, "dashboard:view_all")
        or has_permission(principal, "dashboard:view_department")
        or has_permission(principal, "dashboard:view_own")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    return user_usage_table(
        principal.organization_id,
        db,
        dashboard_allowed_user_ids(db, principal),
    )


@api_router.get("/dashboard/users/{user_id}", response_model=UserUsageTableResponse)
def dashboard_user_detail(
    user_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UserUsageTableResponse:
    allowed_user_ids = dashboard_allowed_user_ids(db, principal)
    if allowed_user_ids is not None and user_id not in allowed_user_ids:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    return user_usage_table(principal.organization_id, db, [user_id])


@api_router.get("/dashboard/departments")
def dashboard_departments(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> dict:
    if not (
        has_permission(principal, "dashboard:view_all")
        or has_permission(principal, "dashboard:view_department")
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    query = select(Department).where(Department.organization_id == principal.organization_id)
    if not has_permission(principal, "dashboard:view_all"):
        department_ids = managed_department_ids(db, principal)
        if not department_ids:
            return {"rows": []}
        query = query.where(Department.id.in_(department_ids))
    departments = db.scalars(query.order_by(Department.name)).all()
    return {"rows": [{"id": d.id, "name": d.name} for d in departments]}


@api_router.get("/dashboard/departments/{department_id}")
def dashboard_department_detail(
    department_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> dict:
    department = db.get(Department, department_id)
    if not department or department.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "DEPARTMENT_NOT_FOUND")
    if not has_permission(principal, "dashboard:view_all"):
        managed = db.get(
            DepartmentManager,
            {"department_id": department_id, "user_id": principal.user_id},
        )
        if not managed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "permission_denied")
    user_ids = list(
        db.scalars(select(DepartmentUser.user_id).where(DepartmentUser.department_id == department_id))
    )
    return {"department_id": department_id, "user_ids": user_ids}
