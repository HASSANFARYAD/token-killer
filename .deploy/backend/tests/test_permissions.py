from app.api.dependencies import ROLE_PERMISSIONS
from app.services.permissions import discover_application_permissions


def test_discover_application_permissions_includes_role_map_and_route_permissions() -> None:
    permissions = discover_application_permissions()

    for role_permissions in ROLE_PERMISSIONS.values():
        assert role_permissions <= permissions
    assert "users:manage" in permissions
    assert "departments:manage" in permissions
    assert "roles:view" in permissions
    assert "*" in permissions
