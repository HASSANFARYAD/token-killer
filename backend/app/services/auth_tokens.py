import uuid
from datetime import datetime, timedelta, timezone

from jose import jwt

from app.config import get_settings


ALGORITHM = "HS256"


def create_access_token(user_id: uuid.UUID, organization_id: uuid.UUID) -> tuple[str, int]:
    settings = get_settings()
    expires = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    payload = {
        "sub": str(user_id),
        "org": str(organization_id),
        "exp": expires,
        "type": "access",
    }
    return jwt.encode(payload, settings.app_secret_key, algorithm=ALGORITHM), settings.access_token_minutes * 60


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, get_settings().app_secret_key, algorithms=[ALGORITHM])
