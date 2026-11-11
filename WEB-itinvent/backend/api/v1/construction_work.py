from datetime import date
from uuid import UUID
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import SQLAlchemyError

from backend.api.deps import require_permission
from backend.appdb.db import AppDatabaseConfigurationError
from backend.models.auth import User
from backend.models.construction_work import WorkDayBatch, WorkPlanBatch, WorkResponse
from backend.services.authorization_service import PERM_CONSTRUCTION_READ, PERM_CONSTRUCTION_WRITE
from backend.services.construction_work_service import ConstructionWorkService, WorkConflict, WorkNotFound
from backend.models.construction_planning import WeeklyPlanChange, DailySummary
from backend.services.construction_planning_service import ConstructionPlanningService

router = APIRouter()
logger = logging.getLogger(__name__)


def _call(method, *args, service=None, **kwargs):
    try:
        return getattr((service or ConstructionWorkService)(), method)(*args, **kwargs)
    except WorkNotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except WorkConflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except (SQLAlchemyError, AppDatabaseConfigurationError):
        # Do not emit SQL parameters or connection settings.
        logger.warning("construction_work_storage_unavailable operation=%s", method)
        raise HTTPException(503, "Хранилище хода работ недоступно. Обратитесь к администратору.") from None


@router.get("/objects/{object_id}/work-progress", response_model=WorkResponse)
def object_work_progress(object_id: str, as_of: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
                         include_archived: bool = Query(False),
                         user: User = Depends(require_permission(PERM_CONSTRUCTION_READ))):
    return _call("read", object_id, as_of=as_of, include_archived=include_archived)


@router.get("/objects/{object_id}/directions/{group_ref}/work-progress", response_model=WorkResponse)
def direction_work_progress(object_id: str, group_ref: UUID, as_of: date | None = Query(None, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
                            include_archived: bool = Query(False),
                            user: User = Depends(require_permission(PERM_CONSTRUCTION_READ))):
    return _call("read", object_id, str(group_ref), as_of=as_of, include_archived=include_archived)


@router.put("/objects/{object_id}/directions/{group_ref}/work-plan")
def save_work_plan(object_id: str, group_ref: UUID, payload: WorkPlanBatch,
                   user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE))):
    return _call("save", object_id, str(group_ref), payload, actor_id=user.id, actor_name=user.full_name or user.username)


@router.put("/objects/{object_id}/directions/{group_ref}/work-days")
def save_work_day(object_id: str, group_ref: UUID, payload: WorkDayBatch,
                  user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE))):
    return _call("save", object_id, str(group_ref), payload, actor_id=user.id, actor_name=user.full_name or user.username, daily=True)


@router.get("/objects/{object_id}/directions/{group_ref}/work-items/{work_id}/history")
def work_history(object_id: str, group_ref: UUID, work_id: UUID,
                 before_id: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100),
                 user: User = Depends(require_permission(PERM_CONSTRUCTION_READ))):
    return _call("history", object_id, str(group_ref), str(work_id), before_id=before_id, limit=limit)


@router.get("/objects/{object_id}/directions/{group_ref}/planning")
def planning(object_id: str, group_ref: UUID, day: date = Query(default_factory=date.today, ge=date(2000, 1, 1), le=date(2100, 12, 31)),
             user: User = Depends(require_permission(PERM_CONSTRUCTION_READ))):
    return _call('read', object_id, str(group_ref), day, service=ConstructionPlanningService)


@router.put("/objects/{object_id}/directions/{group_ref}/planning")
def save_planning(object_id: str, group_ref: UUID, payload: WeeklyPlanChange,
                  user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE))):
    return _call('save_week', object_id, str(group_ref), payload, actor_id=user.id,
                 actor_name=user.full_name or user.username, service=ConstructionPlanningService)


@router.put("/objects/{object_id}/directions/{group_ref}/daily-summary")
def save_daily_summary(object_id: str, group_ref: UUID, payload: DailySummary,
                       user: User = Depends(require_permission(PERM_CONSTRUCTION_WRITE))):
    return _call('save_day', object_id, str(group_ref), payload, actor_id=user.id,
                 actor_name=user.full_name or user.username, service=ConstructionPlanningService)


@router.get("/objects/{object_id}/directions/{group_ref}/planning-history")
def planning_history(object_id: str, group_ref: UUID, period: date, before_id: int | None = Query(None, ge=1),
                     user: User = Depends(require_permission(PERM_CONSTRUCTION_READ))):
    return _call('history', object_id, str(group_ref), period, before_id, service=ConstructionPlanningService)
