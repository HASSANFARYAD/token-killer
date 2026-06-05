from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_active_user
from app.db import get_db
from app.models.rtk import ExtensionInstall
from app.schemas.usage import ExtensionInstallRequest, ExtensionInstallResponse

router = APIRouter(prefix="/extension", tags=["extension"])


@router.post("/installs", response_model=ExtensionInstallResponse)
def register_install(
    body: ExtensionInstallRequest,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> ExtensionInstallResponse:
    install = db.scalar(
        select(ExtensionInstall).where(
            ExtensionInstall.user_id == principal.user_id,
            ExtensionInstall.install_key == body.install_key,
        )
    )
    now = datetime.now(timezone.utc)
    if not install:
        install = ExtensionInstall(
            user_id=principal.user_id,
            organization_id=principal.organization_id,
            install_key=body.install_key,
            vscode_version=body.vscode_version,
            extension_version=body.extension_version,
            machine_hash=body.machine_hash,
            last_seen_at=now,
        )
        db.add(install)
    else:
        if install.organization_id != principal.organization_id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "install_org_mismatch")
        install.vscode_version = body.vscode_version
        install.extension_version = body.extension_version
        install.machine_hash = body.machine_hash
        install.last_seen_at = now

    db.commit()
    return ExtensionInstallResponse(id=install.id)
