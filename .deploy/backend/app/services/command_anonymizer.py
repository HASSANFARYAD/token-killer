import hashlib
import hmac
import re

from app.config import get_settings


COMMAND_CATEGORIES = {
    "git": "git",
    "rg": "search",
    "grep": "search",
    "npm": "package-manager",
    "pnpm": "package-manager",
    "yarn": "package-manager",
    "pytest": "test",
    "python": "runtime",
    "node": "runtime",
    "cat": "file-read",
    "type": "file-read",
    "get-content": "file-read",
    "ls": "file-list",
    "dir": "file-list",
    "get-childitem": "file-list",
}


def normalize_command(command: str | None) -> str:
    if not command:
        return "unknown"
    base = re.split(r"[\\/]", command.strip().lower())[-1]
    return re.sub(r"\.(exe|cmd|ps1|bat)$", "", base)


def command_category(command: str | None) -> str:
    return COMMAND_CATEGORIES.get(normalize_command(command), "other")


def command_hash(command: str | None) -> str:
    normalized = normalize_command(command)
    secret = get_settings().command_hash_secret.encode("utf-8")
    return hmac.new(secret, normalized.encode("utf-8"), hashlib.sha256).hexdigest()
