from sqlalchemy import delete, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.organization import Organization, OrganizationMember, User
from app.models.rbac import Permission, Role, RolePermission, UserRole
from app.services.permissions import discover_application_permissions
from app.services.passwords import hash_password, verify_password

SYSTEM_ROLES = {
    "SUPER_ADMIN": "Super Admin",
    "EXECUTIVE": "Executive",
    "ORG_ADMIN": "Organization Admin",
    "DEPARTMENT_MANAGER": "Department Manager",
    "ANALYST": "Analyst",
    "READ_ONLY_ADMIN": "Read Only Admin",
    "EMPLOYEE": "Employee",
}


def ensure_system_roles(db: Session, organization_id) -> dict[str, Role]:
    roles: dict[str, Role] = {}
    for key, name in SYSTEM_ROLES.items():
        role = db.scalar(
            select(Role).where(Role.organization_id == organization_id, Role.key == key)
        )
        if not role:
            role = Role(organization_id=organization_id, key=key, name=name, system=True)
            db.add(role)
            db.flush()
        else:
            role.name = name
            role.system = True
        roles[key] = role
    return roles


def ensure_permissions(db: Session) -> dict[str, Permission]:
    permissions: dict[str, Permission] = {}
    for key in sorted(discover_application_permissions()):
        permission = db.scalar(select(Permission).where(Permission.key == key))
        if not permission:
            permission = Permission(key=key, description=f"Allows {key}")
            db.add(permission)
            db.flush()
        permissions[key] = permission
    return permissions


def sync_role_permissions(db: Session, role: Role, permissions: dict[str, Permission]) -> None:
    permission_ids = {permission.id for permission in permissions.values()}
    db.execute(
        delete(RolePermission).where(
            RolePermission.role_id == role.id,
            RolePermission.permission_id.not_in(permission_ids),
        )
    )
    for permission_id in permission_ids:
        existing = db.get(
            RolePermission,
            {"role_id": role.id, "permission_id": permission_id},
        )
        if not existing:
            db.add(RolePermission(role_id=role.id, permission_id=permission_id))


def assign_role(db: Session, member: OrganizationMember, role: Role) -> None:
    existing = db.get(UserRole, {"organization_member_id": member.id, "role_id": role.id})
    if not existing:
        db.add(UserRole(organization_member_id=member.id, role_id=role.id))


def seed_bootstrap_super_admin(db: Session) -> None:
    settings = get_settings()
    email = settings.seed_super_admin_email.lower()
    domain = email.split("@")[-1]

    organization = db.scalar(
        select(Organization).where(Organization.microsoft_tenant_id == settings.microsoft_tenant_id)
    )
    if not organization:
        organization = Organization(
            microsoft_tenant_id=settings.microsoft_tenant_id,
            name=settings.seed_organization_name,
            domain=domain,
        )
        db.add(organization)
        db.flush()

    roles = ensure_system_roles(db, organization.id)
    permissions = ensure_permissions(db)
    sync_role_permissions(db, roles["SUPER_ADMIN"], permissions)

    user = db.scalar(select(User).where(User.email == email))
    if not user:
        user = User(
            email=email,
            display_name=settings.seed_super_admin_name,
            password_hash=hash_password(settings.seed_super_admin_password),
        )
        db.add(user)
        db.flush()
    else:
        user.display_name = user.display_name or settings.seed_super_admin_name
        if not verify_password(settings.seed_super_admin_password, user.password_hash):
            user.password_hash = hash_password(settings.seed_super_admin_password)

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
        )
        db.add(member)
        db.flush()
    else:
        member.status = "active"

    db.execute(
        update(OrganizationMember)
        .where(
            OrganizationMember.organization_id == organization.id,
            OrganizationMember.id != member.id,
            OrganizationMember.is_super_admin.is_(True),
        )
        .values(is_super_admin=False)
    )
    member.is_super_admin = True
    assign_role(db, member, roles["SUPER_ADMIN"])

    db.commit()


def try_seed_bootstrap_super_admin(db: Session) -> None:
    try:
        seed_bootstrap_super_admin(db)
    except SQLAlchemyError:
        db.rollback()
        raise
