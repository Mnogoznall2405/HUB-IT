"""Authenticated network monitoring endpoints with independent section rights."""
from __future__ import annotations

import asyncio
import gzip
import json
import time
from datetime import datetime
from functools import wraps

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from starlette.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from backend.api.deps import require_permission
from backend.models.monitoring import InterfaceSettings, ProfileCreate, ProfileUpdate, TargetCreate, TargetUpdate
from backend.services.authorization_service import PERM_MONITORING_MANAGE, PERM_MONITORING_READ
from backend.services.network_monitor_service import MonitoringBusy, network_monitor_service
from backend.services.network_monitor_store import MonitoringNotReady
from backend.services.secret_crypto_service import SecretCryptoError

class MonitoringRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def sanitized(request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                # Pydantic errors may otherwise echo the write-only SNMP secret.
                return JSONResponse(status_code=422, content={"detail": [
                    {key: error[key] for key in ("loc", "msg", "type")} for error in exc.errors()]})
        return sanitized


router = APIRouter(route_class=MonitoringRoute, dependencies=[Depends(require_permission(PERM_MONITORING_READ))])
manage = [Depends(require_permission(PERM_MONITORING_MANAGE))]


def service():
    return network_monitor_service


async def read_response(request, function, *args, **kwargs):
    """Keep large chart JSON and gzip out of the shared API event loop."""
    submitted = time.perf_counter()
    compressed = "gzip" in request.headers.get("accept-encoding", "").lower()

    def render():
        started = time.perf_counter()
        payload = function(*args, **kwargs)
        fetched = time.perf_counter()
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        headers = {"Vary": "Accept-Encoding"}
        if compressed and len(body) >= 1024:
            body = gzip.compress(body, compresslevel=6)
            headers["Content-Encoding"] = "gzip"
        ended = time.perf_counter()
        headers["Server-Timing"] = (f"monitoring_queue;dur={(started - submitted) * 1000:.1f},"
            f"monitoring_store;dur={(fetched - started) * 1000:.1f},monitoring_encode;dur={(ended - fetched) * 1000:.1f}")
        return Response(content=body, media_type="application/json", headers=headers)

    return await asyncio.to_thread(render)


def guarded(function):
    @wraps(function)
    async def wrapped(*args, **kwargs):
        try:
            instance = kwargs.get("svc")
            if instance:
                await asyncio.to_thread(instance.store.ready)
            return await function(*args, **kwargs)
        except LookupError as exc:
            raise HTTPException(404, str(exc)) from None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        except MonitoringBusy as exc:
            raise HTTPException(409, str(exc)) from None
        except IntegrityError:
            raise HTTPException(409, "Настройки уже изменены другим запросом. Обновите данные.") from None
        except (MonitoringNotReady, SQLAlchemyError):
            raise HTTPException(503, "Хранилище мониторинга недоступно. Проверьте миграцию раздела.") from None
        except SecretCryptoError:
            raise HTTPException(503, "Серверный профиль SNMP недоступен: проверьте настройку шифрования.") from None
    return wrapped


@router.get("/overview")
@guarded
async def overview(request: Request, svc=Depends(service)):
    return await read_response(request, svc.overview)


@router.get("/catalog", dependencies=manage)
@guarded
async def catalog(svc=Depends(service)):
    return await asyncio.to_thread(svc.catalog)


@router.get("/profiles", dependencies=manage)
@guarded
async def profiles(svc=Depends(service)):
    return await asyncio.to_thread(svc.store.profiles)


@router.post("/profiles", status_code=201, dependencies=manage)
@guarded
async def create_profile(payload: ProfileCreate, svc=Depends(service)):
    return await asyncio.to_thread(svc.store.save_profile, payload.model_dump())


@router.patch("/profiles/{profile_id}", dependencies=manage)
@guarded
async def update_profile(profile_id: str, payload: ProfileUpdate, svc=Depends(service)):
    return await asyncio.to_thread(svc.store.save_profile, payload.model_dump(exclude_unset=True), profile_id)


@router.post("/targets", status_code=201, dependencies=manage)
@guarded
async def create_target(payload: TargetCreate, svc=Depends(service)):
    return await asyncio.to_thread(svc.save_target, payload.model_dump())


@router.put("/targets/{target_id}", dependencies=manage)
@guarded
async def update_target(target_id: str, payload: TargetUpdate, svc=Depends(service)):
    return await asyncio.to_thread(svc.save_target, payload.model_dump(), target_id)


@router.get("/targets/{target_id}")
@guarded
async def detail(target_id: str, request: Request, svc=Depends(service)):
    return await read_response(request, svc.store.detail, target_id)


@router.delete("/targets/{target_id}", status_code=204, dependencies=manage)
@guarded
async def delete_target(target_id: str, svc=Depends(service)):
    await asyncio.to_thread(svc.store.delete_target, target_id)
    return Response(status_code=204)


@router.post("/targets/{target_id}/probe", dependencies=manage)
@guarded
async def probe(target_id: str, svc=Depends(service)):
    return await svc.collect(target_id)


@router.put("/targets/{target_id}/interfaces/{interface_id}", dependencies=manage)
@guarded
async def configure_interface(target_id: str, interface_id: str, payload: InterfaceSettings, svc=Depends(service)):
    settings = payload.model_dump()
    if "pinned" not in payload.model_fields_set:
        settings.pop("pinned")  # Older clients changing thresholds preserve the pin.
    return await asyncio.to_thread(svc.store.save_interface, target_id, interface_id, settings, svc.clock())


@router.get("/targets/{target_id}/history")
@guarded
async def history(target_id: str, request: Request, interface_id: str = Query("", max_length=36), hours: int = Query(24, ge=1, le=8760),
                  start: datetime | None = Query(None), end: datetime | None = Query(None), svc=Depends(service)):
    return await read_response(request, svc.store.history, target_id, interface_id, hours, svc.clock(), start=start, end=end)


@router.get("/targets/{target_id}/latency-history")
@guarded
async def latency_history(target_id: str, request: Request, hours: int = Query(24, ge=1, le=8760),
                          start: datetime | None = Query(None), end: datetime | None = Query(None),
                          after: datetime | None = Query(None), svc=Depends(service)):
    return await read_response(request, svc.store.latency_history, target_id, hours, svc.clock(), start=start, end=end, after=after)


@router.get("/events")
@guarded
async def events(target_id: str | None = Query(None, max_length=36), limit: int = Query(100, ge=1, le=200), svc=Depends(service)):
    return await asyncio.to_thread(svc.store.events, target_id, limit)
