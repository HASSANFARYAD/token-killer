from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_active_user
from app.db import get_db
from app.models.rtk import ExtensionInstall, RtkSession, RtkUsageEvent, RtkUsageSnapshot
from app.schemas.usage import (
    RtkSessionRequest,
    RtkSessionResponse,
    UsageEventsRequest,
    UsageSnapshotRequest,
    UsageSummaryResponse,
    UsageWriteResponse,
)
from app.services.command_anonymizer import command_category, command_hash

router = APIRouter(prefix="/rtk", tags=["rtk"])
api_router = APIRouter(prefix="/api/extension", tags=["extension-usage"])


def require_owned_session(db: Session, principal: Principal, session_id):
    session = db.get(RtkSession, session_id)
    if not session or session.organization_id != principal.organization_id or session.user_id != principal.user_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "rtk_session_not_found")
    return session


@router.post("/sessions", response_model=RtkSessionResponse)
def upsert_session(
    body: RtkSessionRequest,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> RtkSessionResponse:
    install = db.get(ExtensionInstall, body.extension_install_id)
    if not install or install.user_id != principal.user_id or install.organization_id != principal.organization_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "extension_install_not_found")

    session = db.scalar(
        select(RtkSession).where(
            RtkSession.extension_install_id == body.extension_install_id,
            RtkSession.client_session_id == body.client_session_id,
        )
    )
    if not session:
        session = RtkSession(
            organization_id=principal.organization_id,
            user_id=principal.user_id,
            extension_install_id=body.extension_install_id,
            client_session_id=body.client_session_id,
            workspace_hash=body.workspace_hash,
            label=body.label,
            started_at=body.started_at,
            ended_at=body.ended_at,
        )
        db.add(session)
    else:
        session.workspace_hash = body.workspace_hash or session.workspace_hash
        session.label = body.label or session.label
        session.started_at = body.started_at or session.started_at
        session.ended_at = body.ended_at or session.ended_at
    db.commit()
    return RtkSessionResponse(id=session.id)


@router.post("/usage/snapshots", response_model=UsageWriteResponse)
def save_snapshot(
    body: UsageSnapshotRequest,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UsageWriteResponse:
    require_owned_session(db, principal, body.rtk_session_id)
    snapshot = RtkUsageSnapshot(
        rtk_session_id=body.rtk_session_id,
        snapshot_hash=body.snapshot_hash,
        observed_at=body.observed_at,
        runs=body.runs,
        original_tokens=body.original_tokens,
        compressed_tokens=body.compressed_tokens,
        saved_tokens=body.saved_tokens,
        raw_summary=body.raw_summary,
    )
    db.add(snapshot)
    try:
        db.commit()
        return UsageWriteResponse(inserted=1, duplicates=0)
    except IntegrityError:
        db.rollback()
        return UsageWriteResponse(inserted=0, duplicates=1)


@router.post("/usage/events", response_model=UsageWriteResponse)
def save_events(
    body: UsageEventsRequest,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UsageWriteResponse:
    inserted = 0
    duplicates = 0
    for event in body.events:
        require_owned_session(db, principal, event.rtk_session_id)
        usage_event = RtkUsageEvent(
            rtk_session_id=event.rtk_session_id,
            client_event_id=event.client_event_id,
            command_category=command_category(event.command),
            command_hash=command_hash(event.command),
            occurred_at=event.occurred_at,
            exit_code=event.exit_code,
            duration_ms=event.duration_ms,
            original_tokens=event.original_tokens,
            compressed_tokens=event.compressed_tokens,
            saved_tokens=max(0, event.original_tokens - event.compressed_tokens),
            truncated=event.truncated,
        )
        db.add(usage_event)
        try:
            db.commit()
            inserted += 1
        except IntegrityError:
            db.rollback()
            duplicates += 1
    return UsageWriteResponse(inserted=inserted, duplicates=duplicates)


@router.post("/usage/import", response_model=UsageWriteResponse)
def import_events(
    body: UsageEventsRequest,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UsageWriteResponse:
    return save_events(body, principal, db)


@router.get("/usage/me/summary", response_model=UsageSummaryResponse)
def my_summary(
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UsageSummaryResponse:
    row = db.execute(
        select(
            func.count(RtkUsageEvent.id),
            func.coalesce(func.sum(RtkUsageEvent.original_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.compressed_tokens), 0),
            func.coalesce(func.sum(RtkUsageEvent.saved_tokens), 0),
        )
        .join(RtkSession, RtkSession.id == RtkUsageEvent.rtk_session_id)
        .where(RtkSession.user_id == principal.user_id)
    ).one()
    return UsageSummaryResponse(
        runs=row[0],
        original_tokens=row[1],
        compressed_tokens=row[2],
        saved_tokens=row[3],
    )


api_router.post("/rtk/sessions", response_model=RtkSessionResponse)(upsert_session)
api_router.post("/usage/snapshot", response_model=UsageWriteResponse)(save_snapshot)
api_router.post("/usage/event", response_model=UsageWriteResponse)(save_events)
api_router.post("/usage/import", response_model=UsageWriteResponse)(import_events)
