import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.azure_ad import AzureAdSetting, AzureAdSyncRun, AzureAdUserMapping
from app.models.identity import MicrosoftIdentity
from app.models.organization import (
    Department,
    DepartmentManager,
    DepartmentUser,
    OrganizationMember,
    User,
)
from app.models.rbac import Role, UserRole, UserRoleOverride

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

SYSTEM_ROLES = {
    "SUPER_ADMIN": "Super Admin",
    "EXECUTIVE": "Executive",
    "ORG_ADMIN": "Organization Admin",
    "DEPARTMENT_MANAGER": "Department Manager",
    "ANALYST": "Analyst",
    "READ_ONLY_ADMIN": "Read Only Admin",
    "EMPLOYEE": "Employee",
}

ENV_VAR_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class SyncResult:
    run_id: uuid.UUID
    status: str
    imported_users: int
    updated_users: int
    errors: dict[str, Any]


def resolve_client_secret(settings: AzureAdSetting) -> str | None:
    if settings.client_secret_ref:
        secret = os.environ.get(settings.client_secret_ref)
        if secret:
            return secret
        if not ENV_VAR_NAME_PATTERN.fullmatch(settings.client_secret_ref):
            return settings.client_secret_ref
    return settings.encrypted_client_secret


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


def role_for_job_title(job_title: str | None, mapping: dict[str, str] | None) -> str:
    title = (job_title or "").lower()
    rules = mapping or DEFAULT_ROLE_MAPPING
    for needle, role in rules.items():
        if needle.lower() in title:
            return str(role).upper()
    return "EMPLOYEE"


def ensure_department(db: Session, organization_id: uuid.UUID, name: str | None) -> Department | None:
    clean_name = (name or "").strip()
    if not clean_name:
        return None
    department = db.scalar(
        select(Department).where(Department.organization_id == organization_id, Department.name == clean_name)
    )
    if not department:
        department = Department(organization_id=organization_id, name=clean_name, external_key=clean_name)
        db.add(department)
        db.flush()
    return department


def ensure_member(db: Session, organization_id: uuid.UUID, user_id: uuid.UUID) -> OrganizationMember:
    member = db.scalar(
        select(OrganizationMember).where(
            OrganizationMember.organization_id == organization_id,
            OrganizationMember.user_id == user_id,
        )
    )
    if not member:
        member = OrganizationMember(organization_id=organization_id, user_id=user_id, status="active")
        db.add(member)
        db.flush()
    elif member.status != "active":
        member.status = "active"
    return member


def replace_auto_role(db: Session, member: OrganizationMember, role: Role) -> None:
    if db.get(UserRoleOverride, {"organization_member_id": member.id}):
        return
    db.execute(delete(UserRole).where(UserRole.organization_member_id == member.id))
    db.add(UserRole(organization_member_id=member.id, role_id=role.id))


def ensure_department_user(db: Session, department: Department | None, user_id: uuid.UUID) -> None:
    if not department:
        return
    row = db.get(DepartmentUser, {"department_id": department.id, "user_id": user_id})
    if not row:
        db.add(DepartmentUser(department_id=department.id, user_id=user_id))


def upsert_mapping(
    db: Session,
    organization_id: uuid.UUID,
    settings: AzureAdSetting,
    user: User,
    profile: dict[str, Any],
    manager_object_id: str | None,
) -> None:
    object_id = profile["id"]
    mapping = db.scalar(
        select(AzureAdUserMapping).where(
            AzureAdUserMapping.tenant_id == settings.tenant_id,
            AzureAdUserMapping.object_id == object_id,
        )
    )
    if not mapping:
        mapping = AzureAdUserMapping(
            organization_id=organization_id,
            user_id=user.id,
            tenant_id=settings.tenant_id,
            object_id=object_id,
        )
        db.add(mapping)
    mapping.user_id = user.id
    mapping.mail = profile.get("mail")
    mapping.user_principal_name = profile.get("userPrincipalName")
    mapping.display_name = profile.get("displayName")
    mapping.job_title = profile.get("jobTitle")
    mapping.department = profile.get("department")
    mapping.manager_object_id = manager_object_id
    mapping.account_enabled = profile.get("accountEnabled")
    mapping.raw_profile = profile

    identity = db.scalar(
        select(MicrosoftIdentity).where(
            MicrosoftIdentity.tenant_id == settings.tenant_id,
            MicrosoftIdentity.object_id == object_id,
        )
    )
    if not identity:
        identity = MicrosoftIdentity(
            user_id=user.id,
            tenant_id=settings.tenant_id,
            object_id=object_id,
            email=user.email,
        )
        db.add(identity)
    else:
        identity.user_id = user.id
        identity.email = user.email


async def graph_access_token(settings: AzureAdSetting) -> str:
    if not settings.client_id:
        raise ValueError("AZURE_AD_CLIENT_ID_MISSING")
    client_secret = resolve_client_secret(settings)
    if not client_secret:
        raise ValueError("AZURE_AD_CLIENT_SECRET_MISSING")

    token_url = f"{settings.authority_host.rstrip('/')}/{settings.tenant_id}/oauth2/v2.0/token"
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            token_url,
            data={
                "client_id": settings.client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
                "scope": "https://graph.microsoft.com/.default",
            },
        )
    if response.status_code >= 400:
        raise ValueError("AZURE_AD_TOKEN_REQUEST_FAILED")
    return response.json()["access_token"]


async def fetch_graph_users(settings: AzureAdSetting, access_token: str) -> list[dict[str, Any]]:
    select_fields = ",".join(
        [
            "id",
            "displayName",
            "mail",
            "userPrincipalName",
            "jobTitle",
            "department",
            "accountEnabled",
            "userType",
        ]
    )
    url = f"{settings.graph_base_url.rstrip('/')}/users?$select={select_fields}&$top=999"
    users: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=30) as client:
        while url:
            response = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
            if response.status_code == 429:
                raise ValueError("AZURE_AD_GRAPH_RATE_LIMITED")
            if response.status_code >= 400:
                raise ValueError("AZURE_AD_GRAPH_USERS_FAILED")
            page = response.json()
            users.extend(page.get("value", []))
            url = page.get("@odata.nextLink")
    return users


async def fetch_manager_object_id(
    client: httpx.AsyncClient,
    settings: AzureAdSetting,
    access_token: str,
    object_id: str,
) -> str | None:
    url = f"{settings.graph_base_url.rstrip('/')}/users/{object_id}/manager?$select=id"
    response = await client.get(url, headers={"Authorization": f"Bearer {access_token}"})
    if response.status_code in (404, 400):
        return None
    if response.status_code >= 400:
        return None
    return response.json().get("id")


async def sync_users_from_azure_ad(db: Session, organization_id: uuid.UUID) -> SyncResult:
    settings = db.scalar(
        select(AzureAdSetting).where(AzureAdSetting.organization_id == organization_id)
    )
    if not settings or not settings.enabled:
        raise ValueError("AZURE_AD_SETTINGS_NOT_CONFIGURED")

    run = AzureAdSyncRun(
        organization_id=organization_id,
        status="running",
        started_at=datetime.now(timezone.utc),
        errors={},
    )
    db.add(run)
    db.commit()

    imported = 0
    updated = 0
    errors: dict[str, Any] = {}
    try:
        access_token = await graph_access_token(settings)
        graph_users = await fetch_graph_users(settings, access_token)
        roles = ensure_system_roles(db, organization_id)
        manager_by_user: dict[str, str | None] = {}

        async with httpx.AsyncClient(timeout=30) as client:
            for profile in graph_users:
                object_id = profile.get("id")
                if object_id:
                    manager_by_user[object_id] = await fetch_manager_object_id(
                        client, settings, access_token, object_id
                    )

        object_to_user_id: dict[str, uuid.UUID] = {}
        for profile in graph_users:
            object_id = profile.get("id")
            email = (profile.get("mail") or profile.get("userPrincipalName") or "").lower()
            if not object_id or not email:
                continue

            existing = db.scalar(select(User).where(User.email == email))
            if existing:
                user = existing
                updated += 1
            else:
                user = User(email=email)
                db.add(user)
                db.flush()
                imported += 1

            user.display_name = profile.get("displayName") or user.display_name
            user.job_title = profile.get("jobTitle") or user.job_title
            if profile.get("accountEnabled") is False:
                user.disabled_at = datetime.now(timezone.utc)
            elif user.disabled_at is not None:
                user.disabled_at = None

            member = ensure_member(db, organization_id, user.id)
            role_key = role_for_job_title(user.job_title, settings.role_mapping_rules)
            replace_auto_role(db, member, roles.get(role_key, roles["EMPLOYEE"]))
            department = ensure_department(db, organization_id, profile.get("department"))
            ensure_department_user(db, department, user.id)
            upsert_mapping(db, organization_id, settings, user, profile, manager_by_user.get(object_id))
            object_to_user_id[object_id] = user.id

        db.flush()
        for profile in graph_users:
            object_id = profile.get("id")
            manager_object_id = manager_by_user.get(object_id)
            department = ensure_department(db, organization_id, profile.get("department"))
            manager_user_id = object_to_user_id.get(manager_object_id or "")
            if department and manager_user_id:
                row = db.get(
                    DepartmentManager,
                    {"department_id": department.id, "user_id": manager_user_id},
                )
                if not row:
                    db.add(DepartmentManager(department_id=department.id, user_id=manager_user_id))

        run.status = "succeeded"
        run.imported_users = imported
        run.updated_users = updated
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
    except Exception as exc:
        db.rollback()
        run = db.get(AzureAdSyncRun, run.id)
        run.status = "failed"
        run.errors = {"code": str(exc)}
        run.completed_at = datetime.now(timezone.utc)
        db.commit()
        errors = run.errors

    return SyncResult(run.id, run.status, imported, updated, errors)
