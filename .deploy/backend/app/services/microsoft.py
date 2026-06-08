from dataclasses import dataclass

import httpx
from fastapi import HTTPException, status
from jose import jwt

from app.config import get_settings


@dataclass(frozen=True)
class MicrosoftClaims:
    tenant_id: str
    object_id: str
    email: str
    display_name: str | None


async def verify_microsoft_access_token(access_token: str) -> MicrosoftClaims:
    """Validate the VS Code Microsoft auth token through Microsoft Graph.

    VS Code exposes an OAuth access token, not an ID token. Calling Graph /me lets Microsoft
    validate the token signature, issuer, expiry, and scopes before we trust user identity data.
    """
    try:
        claims = jwt.get_unverified_claims(access_token)
    except Exception as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "AZURE_TOKEN_INVALID") from exc

    tenant_id = claims.get("tid")
    if tenant_id != get_settings().microsoft_tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "ORG_NOT_CONFIGURED")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "AZURE_TOKEN_INVALID") from exc

    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "AZURE_TOKEN_INVALID")
    if response.status_code == status.HTTP_403_FORBIDDEN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "microsoft_graph_user_read_required")
    if response.status_code >= 400:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "AZURE_TOKEN_INVALID")

    profile = response.json()
    object_id = profile.get("id") or claims.get("oid") or claims.get("sub")
    email = (
        profile.get("mail")
        or profile.get("userPrincipalName")
        or claims.get("preferred_username")
        or claims.get("email")
        or claims.get("upn")
    )
    display_name = profile.get("displayName") or claims.get("name")

    if not object_id or not email:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "AZURE_TOKEN_INVALID")

    return MicrosoftClaims(
        tenant_id=tenant_id,
        object_id=object_id,
        email=email.lower(),
        display_name=display_name,
    )
