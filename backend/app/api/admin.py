import uuid
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.dependencies import Principal, require_active_user
from app.db import get_db
from app.models.organization import User
from app.models.rtk import RtkSession, RtkUsageEvent
from app.schemas.admin import OrganizationSummaryResponse, UserUsageRow, UserUsageTableResponse

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/orgs/{organization_id}/summary", response_model=OrganizationSummaryResponse)
def organization_summary(
    organization_id: uuid.UUID,
    from_date: date | None = None,
    to_date: date | None = None,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> OrganizationSummaryResponse:
    if organization_id != principal.organization_id:
        # Full RBAC is added after role seeding; initial single-tenant API stays org-scoped.
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_403_FORBIDDEN, "organization_forbidden")

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


@router.get("/orgs/{organization_id}/users", response_model=UserUsageTableResponse)
def organization_users(
    organization_id: uuid.UUID,
    principal: Principal = Depends(require_active_user),
    db: Session = Depends(get_db),
) -> UserUsageTableResponse:
    if organization_id != principal.organization_id:
        from fastapi import HTTPException, status

        raise HTTPException(status.HTTP_403_FORBIDDEN, "organization_forbidden")
    rows = db.execute(
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
    ).all()
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
