import ast
from pathlib import Path

from app.api.dependencies import ROLE_PERMISSIONS


def _literal_permission(call: ast.Call, function_name: str) -> str | None:
    if not isinstance(call.func, ast.Name) or call.func.id != function_name:
        return None
    if not call.args:
        return None
    argument = call.args[0]
    if isinstance(argument, ast.Constant) and isinstance(argument.value, str):
        return argument.value
    return None


def discover_application_permissions(app_path: Path | None = None) -> set[str]:
    """Discover permissions referenced by route dependencies and role maps."""
    root = app_path or Path(__file__).resolve().parents[1]
    permissions = {
        permission
        for role_permissions in ROLE_PERMISSIONS.values()
        for permission in role_permissions
    }

    for path in root.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            permission = _literal_permission(node, "require_permission") or _literal_permission(
                node, "has_permission"
            )
            if permission:
                permissions.add(permission)

    return permissions
