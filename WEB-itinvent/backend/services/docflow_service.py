"""Application service for personal 1C Document Management access."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from backend.appdb.db import app_session, ensure_app_schema_initialized
from backend.appdb.models import AppDocflowAuditEvent, AppDocflowCommand, AppDocflowCredential
from backend.services.docflow_action_rules import (
    DocflowActionRule,
    configuration_fingerprint,
    load_action_rules,
    matching_action_rules,
)
from backend.services.docflow_gateway_security import docflow_gateway_token
from backend.services.docflow_1c_client import (
    Docflow1CAuthenticationError,
    Docflow1CComClient,
    Docflow1CConflictError,
    Docflow1CError,
    Docflow1CFileStorageUnavailableError,
    Docflow1CFileTooLargeError,
    Docflow1CMappingError,
    Docflow1CNotFoundError,
    Docflow1COutcomeUnknownError,
    Docflow1CUnavailableError,
    docflow_export_root,
)
from backend.services.mail_attachment_preview_service import (
    MailAttachmentPreviewError,
    build_office_preview_artifact,
)
from backend.services.secret_crypto_service import (
    SecretCryptoError,
    decrypt_docflow_secret,
    encrypt_docflow_secret,
)
from backend.services.warehouse_1c_process_bridge import (
    Warehouse1CProcessBridge,
    Warehouse1CProcessBridgeBusy,
    Warehouse1CProcessBridgeConfigurationError,
    Warehouse1CProcessBridgeRemoteError,
    Warehouse1CProcessBridgeTimeout,
    Warehouse1CProcessBridgeUnavailable,
)


class DocflowServiceError(RuntimeError):
    code = "DOCFLOW_ERROR"
    status_code = 500


class DocflowCredentialsRequired(DocflowServiceError):
    code = "DOCFLOW_CREDENTIALS_REQUIRED"
    status_code = 409


class DocflowCredentialsInvalid(DocflowServiceError):
    code = "DOCFLOW_AUTH_INVALID"
    status_code = 409


class DocflowUnavailable(DocflowServiceError):
    code = "DOCFLOW_1C_UNAVAILABLE"
    status_code = 503


class DocflowMappingRequired(DocflowServiceError):
    code = "DOCFLOW_MAPPING_REQUIRED"
    status_code = 503


class DocflowConfigurationError(DocflowServiceError):
    code = "DOCFLOW_CONFIGURATION_ERROR"
    status_code = 503


class DocflowNotFound(DocflowServiceError):
    code = "DOCFLOW_NOT_FOUND"
    status_code = 404


class DocflowFileTooLarge(DocflowServiceError):
    code = "DOCFLOW_FILE_TOO_LARGE"
    status_code = 413


class DocflowFileStorageUnavailable(DocflowServiceError):
    code = "DOCFLOW_FILE_STORAGE_UNAVAILABLE"
    status_code = 503


class DocflowStateConflict(DocflowServiceError):
    code = "DOCFLOW_STATE_CONFLICT"
    status_code = 409


class DocflowActionUnavailable(DocflowServiceError):
    code = "DOCFLOW_ACTION_UNAVAILABLE"
    status_code = 409


class DocflowWriteDisabled(DocflowServiceError):
    code = "DOCFLOW_WRITE_DISABLED"
    status_code = 503


class DocflowIdempotencyConflict(DocflowServiceError):
    code = "DOCFLOW_IDEMPOTENCY_CONFLICT"
    status_code = 409


class DocflowActionOutcomeUnknown(DocflowServiceError):
    code = "DOCFLOW_ACTION_STATE_UNKNOWN"
    status_code = 202


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in {"1", "true", "yes", "on"}


def _positive_int(name: str, default: int, *, minimum: int = 1, maximum: int = 10_000) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)) or default)))
    except (TypeError, ValueError):
        return default


def _correlation_id(value: str | None) -> str:
    normalized = str(value or "").strip()[:64]
    return normalized or uuid.uuid4().hex


class Docflow1CBridgePool:
    """Bounded pool with sticky, process-local routing for personal 1C sessions."""

    def __init__(self, bridges, *, routing_secret: bytes | None = None) -> None:
        self._bridges = tuple(bridges or ())
        if not self._bridges:
            raise Warehouse1CProcessBridgeConfigurationError("Пул подключений 1С пуст")
        self._routing_secret = routing_secret or secrets.token_bytes(32)

    def _worker_index(self, login: str) -> int:
        normalized = str(login or "").strip().casefold().encode("utf-8")
        digest = hmac.new(self._routing_secret, normalized, hashlib.sha256).digest()
        return int.from_bytes(digest[:8], "big") % len(self._bridges)

    def call(self, operation: str, payload: dict[str, Any], *, timeout: float) -> Any:
        bridge = self._bridges[self._worker_index(str(payload.get("login") or ""))]
        return bridge.call(operation, payload, timeout=timeout)

    def shutdown(self) -> None:
        for bridge in self._bridges:
            try:
                bridge.shutdown()
            except Exception:
                pass

    def get_status(self) -> dict[str, Any]:
        workers = [bridge.get_status() for bridge in self._bridges]
        return {
            "workers": len(workers),
            "ready_workers": sum(1 for worker in workers if worker.get("ready")),
            "queue_length": sum(int(worker.get("queue_length") or 0) for worker in workers),
            "in_flight": sum(int(worker.get("in_flight") or 0) for worker in workers),
            "completed": sum(int(worker.get("completed") or 0) for worker in workers),
            "failed": sum(int(worker.get("failed") or 0) for worker in workers),
            "timed_out": sum(int(worker.get("timed_out") or 0) for worker in workers),
            "rejected": sum(int(worker.get("rejected") or 0) for worker in workers),
        }


class Docflow1CAdapter:
    """Routes COM reads through a killable, bounded child process by default."""

    _allowed_operations = frozenset(
        {
            "test_connection", "metadata", "tasks", "task_detail", "task_state", "task_action",
            "assignment_documents", "assignment_assignees", "assignment_state", "assignment_create",
            "file_export",
        }
    )

    def __init__(self, *, bridge: Warehouse1CProcessBridge | None = None, direct_client=None) -> None:
        self._direct_client = direct_client or Docflow1CComClient()
        self._gateway_url = (
            "" if _env_flag("DOCFLOW_GATEWAY_PROCESS") else str(os.getenv("DOCFLOW_GATEWAY_URL", "") or "").strip().rstrip("/")
        )
        self._gateway_token = docflow_gateway_token()
        self._bridge_enabled = _env_flag("DOCFLOW_1C_PROCESS_BRIDGE_ENABLED", "1")
        self._bridge = bridge
        self._bridge_error = ""
        self._metrics_lock = threading.Lock()
        self._operation_metrics: dict[str, dict[str, Any]] = {}
        if self._bridge_enabled and self._bridge is None:
            try:
                worker_count = _positive_int("DOCFLOW_1C_BRIDGE_WORKERS", 4, maximum=8)
                bridges = tuple(
                    Warehouse1CProcessBridge(
                        "backend.services.docflow_1c_process_dispatcher:dispatch",
                        allowed_operations=self._allowed_operations,
                        queue_limit=_positive_int("DOCFLOW_1C_BRIDGE_QUEUE_LIMIT", 8, minimum=0, maximum=64),
                        failure_threshold=_positive_int("DOCFLOW_1C_BRIDGE_FAILURE_THRESHOLD", 4, maximum=20),
                        cooldown_seconds=float(_positive_int("DOCFLOW_1C_BRIDGE_COOLDOWN_SECONDS", 60, maximum=3600)),
                        maximum_message_bytes=_positive_int(
                            "DOCFLOW_1C_BRIDGE_MAX_MESSAGE_BYTES",
                            1_048_576,
                            minimum=16_384,
                            maximum=8_388_608,
                        ),
                        process_name=f"docflow1c-com-bridge-{index + 1}",
                    )
                    for index in range(worker_count)
                )
                self._bridge = Docflow1CBridgePool(bridges)
            except Warehouse1CProcessBridgeConfigurationError as exc:
                self._bridge_error = str(exc)[:300]

    @property
    def gateway_enabled(self) -> bool:
        return bool(self._gateway_url)

    @staticmethod
    def _gateway_error(code: str, message: str) -> DocflowServiceError:
        mapping = {
            DocflowCredentialsRequired.code: DocflowCredentialsRequired,
            DocflowCredentialsInvalid.code: DocflowCredentialsInvalid,
            DocflowUnavailable.code: DocflowUnavailable,
            DocflowMappingRequired.code: DocflowMappingRequired,
            DocflowConfigurationError.code: DocflowConfigurationError,
            DocflowNotFound.code: DocflowNotFound,
            DocflowStateConflict.code: DocflowStateConflict,
            DocflowActionOutcomeUnknown.code: DocflowActionOutcomeUnknown,
        }
        error_type = mapping.get(str(code or ""), DocflowUnavailable)
        return error_type(str(message or "Не удалось выполнить внутренний запрос к 1С"))

    def _gateway_call_sync(
        self,
        *,
        user_id: int,
        operation: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> Any:
        if not self._gateway_url or len(self._gateway_token) < 32:
            raise DocflowConfigurationError("Внутренний шлюз 1С настроен не полностью")
        body = json.dumps(
            {
                "user_id": int(user_id),
                "operation": operation,
                "payload": payload,
                "correlation_id": _correlation_id(correlation_id),
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        request = urllib.request.Request(
            f"{self._gateway_url}/internal/v1/call",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "X-Docflow-Gateway-Token": self._gateway_token,
            },
        )
        try:
            with urllib.request.urlopen(
                request,
                timeout=float(_positive_int("DOCFLOW_1C_QUERY_TIMEOUT_SECONDS", 90, maximum=180)) + 5,
            ) as response:
                decoded = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                decoded_error = json.loads(exc.read().decode("utf-8"))
                detail = decoded_error.get("detail") or {}
            except Exception:
                detail = {}
            raise self._gateway_error(
                str(detail.get("code") or ""),
                str(detail.get("message") or "Внутренний шлюз 1С вернул ошибку"),
            ) from None
        except (OSError, TimeoutError, ValueError):
            raise DocflowUnavailable("Внутренний шлюз 1С временно недоступен") from None
        return decoded.get("result")

    async def call_saved(
        self,
        *,
        user_id: int,
        operation: str,
        payload: dict[str, Any],
        correlation_id: str,
    ) -> Any:
        started = time.perf_counter()
        failed = False
        try:
            return await asyncio.to_thread(
                self._gateway_call_sync,
                user_id=int(user_id),
                operation=operation,
                payload=payload,
                correlation_id=correlation_id,
            )
        except Exception:
            failed = True
            raise
        finally:
            self._record_operation(operation, time.perf_counter() - started, failed=failed)

    def _record_operation(self, operation: str, elapsed: float, *, failed: bool) -> None:
        name = str(operation or "unknown")[:64]
        milliseconds = max(0.0, float(elapsed) * 1000.0)
        with self._metrics_lock:
            metric = self._operation_metrics.setdefault(
                name,
                {"count": 0, "failed": 0, "last_ms": 0.0, "max_ms": 0.0, "samples": []},
            )
            metric["count"] += 1
            metric["failed"] += int(bool(failed))
            metric["last_ms"] = milliseconds
            metric["max_ms"] = max(float(metric["max_ms"]), milliseconds)
            samples = metric["samples"]
            samples.append(milliseconds)
            if len(samples) > 128:
                del samples[:-128]

    def _operation_metrics_snapshot(self) -> dict[str, Any]:
        with self._metrics_lock:
            result: dict[str, Any] = {}
            for name, metric in self._operation_metrics.items():
                samples = sorted(float(value) for value in metric["samples"])
                p95_index = max(0, min(len(samples) - 1, int(len(samples) * 0.95))) if samples else 0
                result[name] = {
                    "count": int(metric["count"]),
                    "failed": int(metric["failed"]),
                    "last_ms": round(float(metric["last_ms"]), 1),
                    "max_ms": round(float(metric["max_ms"]), 1),
                    "p95_ms": round(samples[p95_index], 1) if samples else 0.0,
                }
            return result

    @staticmethod
    def _map_error(exc: BaseException) -> DocflowServiceError:
        if isinstance(exc, Docflow1CAuthenticationError):
            return DocflowCredentialsInvalid("Логин или пароль 1С не принят")
        if isinstance(exc, Docflow1CMappingError):
            return DocflowMappingRequired(str(exc))
        if isinstance(exc, Docflow1CConflictError):
            return DocflowStateConflict(str(exc))
        if isinstance(exc, Docflow1CNotFoundError):
            return DocflowNotFound(str(exc))
        if isinstance(exc, Docflow1CFileStorageUnavailableError):
            return DocflowFileStorageUnavailable(
                "Файл найден в 1С, но сервисная учётная запись не смогла прочитать его из файлового тома"
            )
        if isinstance(exc, Docflow1CFileTooLargeError):
            return DocflowFileTooLarge(str(exc))
        if isinstance(exc, Docflow1CUnavailableError):
            return DocflowUnavailable(str(exc))
        if isinstance(exc, Warehouse1CProcessBridgeBusy):
            return DocflowUnavailable("Очередь обращений к 1С занята. Повторите позже")
        if isinstance(exc, Warehouse1CProcessBridgeTimeout):
            return DocflowUnavailable("1С не ответила вовремя. Результат запроса неизвестен")
        if isinstance(exc, (Warehouse1CProcessBridgeUnavailable, Warehouse1CProcessBridgeConfigurationError)):
            return DocflowUnavailable("Сервис подключения к 1С временно недоступен")
        if isinstance(exc, Warehouse1CProcessBridgeRemoteError):
            message = str(exc)
            if "Docflow1COutcomeUnknownError" in message:
                return DocflowActionOutcomeUnknown(
                    "1С не подтвердила итог команды; команда не будет отправлена повторно"
                )
            if "Docflow1CAuthenticationError" in message:
                return DocflowCredentialsInvalid("Логин или пароль 1С не принят")
            if "Docflow1CMappingError" in message:
                return DocflowMappingRequired("Метаданные заданий 1С требуют настройки")
            if "Docflow1CConflictError" in message:
                return DocflowStateConflict("Состояние задания изменилось в 1С")
            if "Docflow1CNotFoundError" in message:
                return DocflowNotFound("Задание или файл не найден либо больше вам не доступен")
            if "Docflow1CFileStorageUnavailableError" in message:
                return DocflowFileStorageUnavailable(
                    "Файл найден в 1С, но сервисная учётная запись не смогла прочитать его из файлового тома"
                )
            if "Docflow1CFileTooLargeError" in message:
                return DocflowFileTooLarge("Файл слишком большой для загрузки через HUB-IT")
            return DocflowUnavailable("Не удалось выполнить запрос к 1С Документооборот")
        if isinstance(exc, Docflow1CError):
            if isinstance(exc, Docflow1COutcomeUnknownError):
                return DocflowActionOutcomeUnknown(
                    "1С не подтвердила итог команды; команда не будет отправлена повторно"
                )
            return DocflowUnavailable("Не удалось выполнить запрос к 1С Документооборот")
        return DocflowUnavailable("Не удалось выполнить запрос к 1С Документооборот")

    def _call_sync(self, operation: str, payload: dict[str, Any]) -> Any:
        try:
            if self._bridge_enabled:
                if self._bridge is None:
                    raise Warehouse1CProcessBridgeUnavailable(self._bridge_error or "bridge is not configured")
                return self._bridge.call(
                    operation,
                    payload,
                    timeout=float(_positive_int("DOCFLOW_1C_QUERY_TIMEOUT_SECONDS", 90, maximum=180)),
                )
            if operation == "test_connection":
                return self._direct_client.test_connection(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                )
            if operation == "metadata":
                return self._direct_client.metadata(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                )
            if operation == "tasks":
                return self._direct_client.list_tasks(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    scope=str(payload.get("scope") or "inbox"),
                    search=str(payload.get("search") or ""),
                    limit=int(payload.get("limit") or 50),
                )
            if operation == "task_detail":
                return self._direct_client.get_task_detail(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    task_ref=str(payload.get("task_ref") or ""),
                )
            if operation == "task_state":
                return self._direct_client.get_task_state(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    task_ref=str(payload.get("task_ref") or ""),
                )
            if operation == "task_action":
                return self._direct_client.apply_task_action(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    task_ref=str(payload.get("task_ref") or ""),
                    action=str(payload.get("action") or ""),
                    result_template=str(payload.get("result_template") or ""),
                    comment=str(payload.get("comment") or ""),
                )
            if operation == "assignment_documents":
                return self._direct_client.search_assignment_documents(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    search=str(payload.get("search") or ""),
                    limit=int(payload.get("limit") or 20),
                )
            if operation == "assignment_assignees":
                return self._direct_client.search_assignment_assignees(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    search=str(payload.get("search") or ""),
                    limit=int(payload.get("limit") or 20),
                )
            if operation == "assignment_state":
                return self._direct_client.get_assignment_state(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    process_ref=str(payload.get("process_ref") or ""),
                )
            if operation == "assignment_create":
                return self._direct_client.create_assignment(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    process_ref=str(payload.get("process_ref") or ""),
                    document_type=str(payload.get("document_type") or ""),
                    document_ref=str(payload.get("document_ref") or ""),
                    assignee_ref=str(payload.get("assignee_ref") or ""),
                    controller_ref=str(payload.get("controller_ref") or ""),
                    due_at=str(payload.get("due_at") or ""),
                    importance=str(payload.get("importance") or "normal"),
                    title=str(payload.get("title") or ""),
                    description=str(payload.get("description") or ""),
                )
            if operation == "file_export":
                return self._direct_client.export_file(
                    login=str(payload.get("login") or ""),
                    password=str(payload.get("password") or ""),
                    task_ref=str(payload.get("task_ref") or ""),
                    file_ref=str(payload.get("file_ref") or ""),
                )
            raise DocflowMappingRequired("Операция docflow не разрешена")
        except DocflowServiceError:
            raise
        except Warehouse1CProcessBridgeTimeout:
            if operation in {"task_action", "assignment_create"}:
                raise DocflowActionOutcomeUnknown(
                    "1С не ответила вовремя; команда не будет отправлена повторно"
                ) from None
            raise DocflowUnavailable("1С не ответила вовремя. Результат запроса неизвестен") from None
        except Exception as exc:
            raise self._map_error(exc) from None

    async def call(self, operation: str, payload: dict[str, Any]) -> Any:
        started = time.perf_counter()
        failed = False
        try:
            return await asyncio.to_thread(self._call_sync, operation, payload)
        except Exception:
            failed = True
            raise
        finally:
            self._record_operation(operation, time.perf_counter() - started, failed=failed)

    def shutdown(self) -> None:
        if self._bridge is not None:
            self._bridge.shutdown()

    def get_status(self) -> dict[str, Any]:
        if self.gateway_enabled:
            return {"mode": "remote_gateway", "configured": True, "operations": self._operation_metrics_snapshot()}
        if self._bridge is None:
            return {
                "mode": "direct",
                "configured": not bool(self._bridge_error),
                "operations": self._operation_metrics_snapshot(),
            }
        return {
            "mode": "process_pool",
            **self._bridge.get_status(),
            "operations": self._operation_metrics_snapshot(),
        }


class DocflowCredentialStore:
    def _ready(self) -> None:
        ensure_app_schema_initialized()

    def get(self, user_id: int) -> AppDocflowCredential | None:
        self._ready()
        with app_session() as session:
            return session.get(AppDocflowCredential, int(user_id))

    def list_warmup_user_ids(self, *, limit: int = 200) -> list[int]:
        self._ready()
        with app_session() as session:
            return [
                int(value)
                for value in session.execute(
                    select(AppDocflowCredential.user_id)
                    .where(AppDocflowCredential.status.in_(("valid", "configured")))
                    .order_by(AppDocflowCredential.updated_at.desc())
                    .limit(max(1, min(int(limit), 500)))
                ).scalars()
            ]

    def upsert_valid(self, *, user_id: int, login: str, password_enc: str, verified_at: datetime) -> AppDocflowCredential:
        self._ready()
        now = _utcnow()
        with app_session() as session:
            row = session.get(AppDocflowCredential, int(user_id))
            if row is None:
                row = AppDocflowCredential(
                    user_id=int(user_id),
                    login=login,
                    password_enc=password_enc,
                    key_version=1,
                    credential_version=1,
                    status="valid",
                    last_error_code=None,
                    last_verified_at=verified_at,
                    created_at=now,
                    updated_at=now,
                )
                session.add(row)
            else:
                row.login = login
                row.password_enc = password_enc
                row.key_version = 1
                row.credential_version = int(row.credential_version or 0) + 1
                row.status = "valid"
                row.last_error_code = None
                row.last_verified_at = verified_at
                row.updated_at = now
            session.flush()
            return row

    def set_status(self, *, user_id: int, status: str, error_code: str | None) -> None:
        self._ready()
        normalized_status = str(status or "configured").strip().lower()
        normalized_error = str(error_code or "").strip()[:64] or None
        with app_session() as session:
            row = session.get(AppDocflowCredential, int(user_id))
            if row is None:
                return
            if row.status == normalized_status and row.last_error_code == normalized_error:
                return
            row.status = normalized_status
            row.last_error_code = normalized_error
            row.updated_at = _utcnow()

    def delete(self, user_id: int) -> bool:
        self._ready()
        with app_session() as session:
            row = session.get(AppDocflowCredential, int(user_id))
            if row is None:
                return False
            session.delete(row)
            return True

    def audit(
        self,
        *,
        user_id: int,
        event_type: str,
        outcome: str,
        correlation_id: str,
        error_code: str | None = None,
    ) -> None:
        self._ready()
        with app_session() as session:
            session.add(
                AppDocflowAuditEvent(
                    id=uuid.uuid4().hex,
                    user_id=int(user_id),
                    event_type=str(event_type or "unknown")[:64],
                    outcome=str(outcome or "unknown")[:32],
                    error_code=str(error_code or "").strip()[:64] or None,
                    correlation_id=_correlation_id(correlation_id),
                    created_at=_utcnow(),
                )
            )


class DocflowCommandStore:
    def _ready(self) -> None:
        ensure_app_schema_initialized()

    def begin(
        self,
        *,
        user_id: int,
        idempotency_key: str,
        request_hash: str,
        task_ref: str,
        action: str,
        state_token_hash: str,
        correlation_id: str,
        remote_before_json: str,
    ) -> tuple[AppDocflowCommand, bool]:
        self._ready()
        with app_session() as session:
            existing = session.execute(
                select(AppDocflowCommand).where(
                    AppDocflowCommand.user_id == int(user_id),
                    AppDocflowCommand.idempotency_key == idempotency_key,
                )
            ).scalar_one_or_none()
            if existing is not None:
                if not hmac.compare_digest(str(existing.request_hash), request_hash):
                    raise DocflowIdempotencyConflict(
                        "Этот Idempotency-Key уже использован для другой команды"
                    )
                return existing, False

            now = _utcnow()
            row = AppDocflowCommand(
                id=uuid.uuid4().hex,
                user_id=int(user_id),
                idempotency_key=idempotency_key,
                request_hash=request_hash,
                task_ref=task_ref,
                action=action,
                status="pending",
                outcome=None,
                state_token_hash=state_token_hash,
                error_code=None,
                correlation_id=_correlation_id(correlation_id),
                remote_before_json=remote_before_json,
                remote_after_json="{}",
                created_at=now,
                updated_at=now,
                completed_at=None,
            )
            session.add(row)
            try:
                session.flush()
            except IntegrityError:
                session.rollback()
                existing = session.execute(
                    select(AppDocflowCommand).where(
                        AppDocflowCommand.user_id == int(user_id),
                        AppDocflowCommand.idempotency_key == idempotency_key,
                    )
                ).scalar_one_or_none()
                if existing is None or not hmac.compare_digest(str(existing.request_hash), request_hash):
                    raise DocflowIdempotencyConflict(
                        "Этот Idempotency-Key уже использован для другой команды"
                    ) from None
                return existing, False
            return row, True

    def get_for_user(self, *, user_id: int, command_id: str) -> AppDocflowCommand | None:
        self._ready()
        with app_session() as session:
            return session.execute(
                select(AppDocflowCommand).where(
                    AppDocflowCommand.id == str(command_id or ""),
                    AppDocflowCommand.user_id == int(user_id),
                )
            ).scalar_one_or_none()

    def get_by_key(self, *, user_id: int, idempotency_key: str) -> AppDocflowCommand | None:
        self._ready()
        with app_session() as session:
            return session.execute(
                select(AppDocflowCommand).where(
                    AppDocflowCommand.user_id == int(user_id),
                    AppDocflowCommand.idempotency_key == str(idempotency_key or ""),
                )
            ).scalar_one_or_none()

    def finish(
        self,
        *,
        command_id: str,
        status: str,
        outcome: str | None,
        error_code: str | None,
        remote_after_json: str,
    ) -> AppDocflowCommand:
        self._ready()
        with app_session() as session:
            row = session.get(AppDocflowCommand, str(command_id or ""))
            if row is None:
                raise DocflowNotFound("Команда документооборота не найдена")
            row.status = str(status or "state_unknown")[:32]
            row.outcome = str(outcome or "").strip()[:32] or None
            row.error_code = str(error_code or "").strip()[:64] or None
            row.remote_after_json = str(remote_after_json or "{}")[:20_000]
            row.updated_at = _utcnow()
            if row.status in {"applied", "rejected", "failed"}:
                row.completed_at = row.updated_at
            session.flush()
            return row


class DocflowService:
    def __init__(
        self,
        *,
        adapter: Docflow1CAdapter | None = None,
        store: DocflowCredentialStore | None = None,
        command_store: DocflowCommandStore | None = None,
    ) -> None:
        self._adapter = adapter or Docflow1CAdapter()
        self._store = store or DocflowCredentialStore()
        self._command_store = command_store or DocflowCommandStore()

    def shutdown(self) -> None:
        self._adapter.shutdown()

    def gateway_status(self) -> dict[str, Any]:
        return self._adapter.get_status()

    async def warmup_user_ids(self, *, limit: int = 200) -> list[int]:
        return await asyncio.to_thread(self._store.list_warmup_user_ids, limit=limit)

    async def warmup_user(self, *, user_id: int) -> bool:
        try:
            await self._saved_credentials_call(
                user_id=int(user_id),
                operation="tasks",
                payload={"scope": "inbox", "search": "", "limit": 1},
            )
        except DocflowServiceError:
            return False
        return True

    @staticmethod
    def _pilot_user_ids() -> set[int]:
        raw = str(os.getenv("DOCFLOW_WRITE_PILOT_USER_IDS", "") or "")
        result: set[int] = set()
        for value in raw.replace(";", ",").split(","):
            try:
                result.add(int(value.strip()))
            except (TypeError, ValueError):
                continue
        return result

    @classmethod
    def _create_pilot_user_ids(cls) -> set[int]:
        raw = str(os.getenv("DOCFLOW_CREATE_PILOT_USER_IDS", "") or "").strip()
        if not raw:
            return cls._pilot_user_ids()
        result: set[int] = set()
        for value in raw.replace(";", ",").split(","):
            try:
                result.add(int(value.strip()))
            except (TypeError, ValueError):
                continue
        return result

    @classmethod
    def _assignment_unavailable_reason(
        cls,
        user_id: int,
        *,
        credential_reason: str | None = None,
    ) -> str | None:
        if not _env_flag("DOCFLOW_WRITE_ENABLED"):
            return "Запись в 1С выключена серверной настройкой."
        if not _env_flag("DOCFLOW_CREATE_ENABLED"):
            return "Создание поручений ещё не включено для пилота."
        if int(user_id) not in cls._create_pilot_user_ids():
            return "Ваша учётная запись не включена в пилот создания поручений."
        if credential_reason:
            return credential_reason
        return None

    @staticmethod
    def _assignment_title_prefix() -> str:
        return str(os.getenv("DOCFLOW_CREATE_TEST_TITLE_PREFIX", "HUB-IT TEST") or "").strip()[:80]

    @staticmethod
    def _assignment_test_only() -> bool:
        return _env_flag("DOCFLOW_CREATE_TEST_ONLY", "1")

    async def _ensure_assignment_enabled(self, user_id: int) -> None:
        credential_reason = await self._write_credential_unavailable_reason(int(user_id))
        reason = self._assignment_unavailable_reason(
            user_id,
            credential_reason=credential_reason,
        )
        if reason:
            raise DocflowWriteDisabled(reason)

    @staticmethod
    def _action_state_key() -> bytes:
        raw = str(os.getenv("DOCFLOW_ACTION_STATE_KEY", "") or "").strip()
        if len(raw) >= 32:
            return raw.encode("utf-8")
        credential_key = str(os.getenv("DOCFLOW_CREDENTIALS_KEY", "") or "").strip()
        if len(credential_key) < 32:
            return b""
        return hmac.new(
            credential_key.encode("utf-8"),
            b"hub-it:docflow-action-state:v1",
            hashlib.sha256,
        ).digest()

    @staticmethod
    def _write_credential_min_version() -> int:
        return _positive_int(
            "DOCFLOW_WRITE_CREDENTIAL_MIN_VERSION",
            0,
            minimum=0,
            maximum=1_000_000,
        )

    async def _write_credential_unavailable_reason(self, user_id: int) -> str | None:
        minimum_version = self._write_credential_min_version()
        if minimum_version <= 0:
            return None
        row = await asyncio.to_thread(self._store.get, int(user_id))
        if row is None:
            return "Сначала подключите свою учётную запись 1С."
        if int(getattr(row, "credential_version", 0) or 0) < minimum_version:
            return (
                "Перед действиями смените ранее опубликованный пароль в 1С "
                "и заново сохраните подключение в HUB-IT."
            )
        return None

    @staticmethod
    def _task_state_payload(detail: dict[str, Any]) -> dict[str, Any]:
        return {
            "ref": str(detail.get("ref") or ""),
            "task_type": str(detail.get("task_type") or ""),
            "process_ref": str(detail.get("process_ref") or ""),
            "process_type": str(detail.get("process_type") or ""),
            "business_state": str(detail.get("business_state") or ""),
            "result": str(detail.get("result") or ""),
            "accepted": detail.get("accepted"),
            "completed": bool(detail.get("completed")),
            "completed_at": str(detail.get("completed_at") or ""),
        }

    @classmethod
    def _state_token(cls, *, user_id: int, detail: dict[str, Any]) -> str:
        key = cls._action_state_key()
        if not key:
            return ""
        payload = {
            "user_id": int(user_id),
            "task": cls._task_state_payload(detail),
        }
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return hmac.new(key, serialized.encode("utf-8"), hashlib.sha256).hexdigest()

    @staticmethod
    def _configuration(detail: dict[str, Any]) -> str:
        return str(os.getenv("DOCFLOW_1C_REF", "docflow") or "docflow").strip()[:128]

    @classmethod
    def _matching_rules(cls, detail: dict[str, Any]) -> tuple[DocflowActionRule, ...]:
        return matching_action_rules(
            configuration=cls._configuration(detail),
            task_type=str(detail.get("task_type") or ""),
            process_type=str(detail.get("process_type") or ""),
            rules=load_action_rules(),
        )

    @classmethod
    def _decorate_task_actions(
        cls,
        *,
        user_id: int,
        detail: dict[str, Any],
        can_act: bool,
        credential_reason: str | None = None,
    ) -> dict[str, Any]:
        result = dict(detail)
        result.setdefault("files", [])
        process_type = str(result.get("process_type") or "").strip()
        if process_type:
            result["configuration_fingerprint"] = configuration_fingerprint(
                configuration=cls._configuration(result),
                task_type=str(result.get("task_type") or ""),
                process_type=process_type,
            )
        result["state_token"] = None
        result["available_actions"] = []
        result["action_unavailable_reason"] = None
        if not can_act:
            return result
        if not _env_flag("DOCFLOW_WRITE_ENABLED"):
            result["action_unavailable_reason"] = "Действия в 1С пока доступны только в пилотном режиме."
            return result
        if int(user_id) not in cls._pilot_user_ids():
            result["action_unavailable_reason"] = "Ваша учётная запись не включена в пилот действий 1С."
            return result
        if not cls._action_state_key():
            result["action_unavailable_reason"] = "Не настроен серверный ключ подтверждения состояния."
            return result
        if credential_reason:
            result["action_unavailable_reason"] = credential_reason
            return result
        if _env_flag("DOCFLOW_WRITE_TEST_ONLY", "1"):
            required_prefix = str(os.getenv("DOCFLOW_WRITE_TEST_TITLE_PREFIX", "HUB-IT TEST") or "").strip()
            if not required_prefix or not str(result.get("title") or "").strip().casefold().startswith(required_prefix.casefold()):
                result["action_unavailable_reason"] = "Пилот разрешён только для специальных тестовых заданий."
                return result
        if bool(result.get("completed")):
            result["action_unavailable_reason"] = "Задание уже завершено."
            return result
        rules = cls._matching_rules(result)
        if not rules:
            result["action_unavailable_reason"] = "Для этого типа процесса нет проверенного правила выполнения."
            return result
        result["state_token"] = cls._state_token(user_id=int(user_id), detail=result)
        result["available_actions"] = [rule.public_contract() for rule in rules]
        return result

    @classmethod
    def _remote_snapshot(
        cls,
        detail: dict[str, Any],
        *,
        expected_result_hash: str | None = None,
    ) -> str:
        payload = cls._task_state_payload(detail)
        if expected_result_hash:
            payload["expected_result_hash"] = expected_result_hash
        return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))[:20_000]

    @staticmethod
    def _result_hash(value: str) -> str:
        return hashlib.sha256(str(value or "").strip().encode("utf-8")).hexdigest()

    @staticmethod
    def _render_result(rule: DocflowActionRule, comment: str) -> str:
        return str(rule.result_value or "").replace("{comment}", str(comment or "").strip()).strip()[:2000]

    @classmethod
    def _state_matches_command(cls, row: AppDocflowCommand, detail: dict[str, Any]) -> bool:
        try:
            before = json.loads(str(row.remote_before_json or "{}"))
        except (TypeError, ValueError):
            before = {}
        expected_hash = str(before.get("expected_result_hash") or "")
        return bool(detail.get("completed")) and bool(expected_hash) and hmac.compare_digest(
            expected_hash,
            cls._result_hash(str(detail.get("result") or "")),
        )

    @staticmethod
    def _profile(row: AppDocflowCredential | None) -> dict[str, Any]:
        if row is None:
            return {
                "configured": False,
                "login": None,
                "status": "not_configured",
                "last_error_code": None,
                "last_verified_at": None,
                "updated_at": None,
            }
        status = str(row.status or "configured").strip().lower()
        if status not in {"configured", "valid", "invalid", "unavailable"}:
            status = "configured"
        return {
            "configured": True,
            "login": str(row.login or "").strip() or None,
            "status": status,
            "last_error_code": str(row.last_error_code or "").strip() or None,
            "last_verified_at": row.last_verified_at,
            "updated_at": row.updated_at,
        }

    async def get_profile(self, *, user_id: int) -> dict[str, Any]:
        row = await asyncio.to_thread(self._store.get, int(user_id))
        return self._profile(row)

    async def test_credentials(
        self,
        *,
        user_id: int,
        login: str,
        password: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        correlation = _correlation_id(correlation_id)
        try:
            result = await self._adapter.call(
                "test_connection",
                {"login": str(login or "").strip(), "password": str(password or "")},
            )
        except DocflowServiceError as exc:
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="connection_test",
                outcome="failed",
                correlation_id=correlation,
                error_code=exc.code,
            )
            raise
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="connection_test",
            outcome="success",
            correlation_id=correlation,
        )
        return dict(result)

    async def save_credentials(
        self,
        *,
        user_id: int,
        login: str,
        password: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        correlation = _correlation_id(correlation_id)
        try:
            result = await self._adapter.call(
                "test_connection",
                {"login": str(login or "").strip(), "password": str(password or "")},
            )
            try:
                encrypted = encrypt_docflow_secret(password)
            except SecretCryptoError:
                raise DocflowConfigurationError("Ключ шифрования учётных данных 1С не настроен") from None
            verified_at_raw = result.get("verified_at")
            verified_at = (
                datetime.fromisoformat(str(verified_at_raw).replace("Z", "+00:00"))
                if verified_at_raw
                else _utcnow()
            )
            row = await asyncio.to_thread(
                self._store.upsert_valid,
                user_id=int(user_id),
                login=str(login or "").strip(),
                password_enc=encrypted,
                verified_at=verified_at,
            )
        except DocflowServiceError as exc:
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="credentials_save",
                outcome="failed",
                correlation_id=correlation,
                error_code=exc.code,
            )
            raise
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="credentials_save",
            outcome="success",
            correlation_id=correlation,
        )
        return self._profile(row)

    async def delete_credentials(self, *, user_id: int, correlation_id: str) -> None:
        await asyncio.to_thread(self._store.delete, int(user_id))
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="credentials_delete",
            outcome="success",
            correlation_id=_correlation_id(correlation_id),
        )

    async def _load_plain_credentials(self, user_id: int) -> tuple[str, str]:
        row = await asyncio.to_thread(self._store.get, int(user_id))
        if row is None:
            raise DocflowCredentialsRequired("Сначала подключите свою учётную запись 1С")
        try:
            password = decrypt_docflow_secret(row.password_enc)
        except SecretCryptoError:
            raise DocflowConfigurationError("Не удалось расшифровать учётные данные 1С") from None
        if not password:
            raise DocflowCredentialsRequired("Сначала подключите свою учётную запись 1С")
        return str(row.login or "").strip(), password

    async def list_tasks(
        self,
        *,
        user_id: int,
        scope: str,
        search: str,
        limit: int,
        correlation_id: str,
    ) -> dict[str, Any]:
        result = await self._saved_credentials_call(
            user_id=int(user_id),
            operation="tasks",
            payload={
                "scope": scope,
                "search": search,
                "limit": limit,
            },
        )
        return dict(result)

    async def inbox_summary(self, *, user_id: int, correlation_id: str) -> dict[str, Any]:
        row = await asyncio.to_thread(self._store.get, int(user_id))
        if row is None:
            return {
                "status": "not_configured",
                "count": None,
                "as_of": _utcnow(),
                "truncated": False,
            }
        try:
            result = await self.list_tasks(
                user_id=int(user_id),
                scope="inbox",
                search="",
                limit=100,
                correlation_id=correlation_id,
            )
        except (DocflowCredentialsInvalid, DocflowUnavailable):
            return {
                "status": "unavailable",
                "count": None,
                "as_of": _utcnow(),
                "truncated": False,
            }
        return {
            "status": "available",
            "count": int(result.get("returned") or len(result.get("items") or [])),
            "as_of": result.get("as_of") or _utcnow(),
            "truncated": bool(result.get("truncated")),
        }

    async def assignment_capability(self, *, user_id: int) -> dict[str, Any]:
        credential_reason = await self._write_credential_unavailable_reason(int(user_id))
        reason = self._assignment_unavailable_reason(
            int(user_id),
            credential_reason=credential_reason,
        )
        return {
            "enabled": reason is None,
            "reason": reason,
            "document_types": ["internal", "incoming", "outgoing"],
            "test_only": self._assignment_test_only(),
            "required_title_prefix": self._assignment_title_prefix() if self._assignment_test_only() else None,
        }

    async def search_assignment_documents(
        self,
        *,
        user_id: int,
        search: str,
        limit: int,
    ) -> dict[str, Any]:
        await self._ensure_assignment_enabled(int(user_id))
        return await self._saved_credentials_call(
            user_id=int(user_id),
            operation="assignment_documents",
            payload={"search": str(search or ""), "limit": int(limit)},
        )

    async def search_assignment_assignees(
        self,
        *,
        user_id: int,
        search: str,
        limit: int,
    ) -> dict[str, Any]:
        await self._ensure_assignment_enabled(int(user_id))
        return await self._saved_credentials_call(
            user_id=int(user_id),
            operation="assignment_assignees",
            payload={"search": str(search or ""), "limit": int(limit)},
        )

    @staticmethod
    def _assignment_payload_from_row(row: AppDocflowCommand) -> dict[str, Any]:
        for raw in (row.remote_after_json, row.remote_before_json):
            try:
                payload = json.loads(str(raw or "{}"))
            except (TypeError, ValueError):
                continue
            if isinstance(payload, dict) and payload.get("process_ref"):
                return payload
        return {}

    @classmethod
    def _assignment_command_response(
        cls,
        *,
        row: AppDocflowCommand,
        correlation_id: str,
        already_applied: bool = False,
    ) -> dict[str, Any]:
        payload = cls._assignment_payload_from_row(row)
        assignment = None
        if bool(payload.get("exists")):
            assignment = {
                "process_ref": str(payload.get("process_ref") or ""),
                "task_ref": str(payload.get("task_ref") or "") or None,
                "title": str(payload.get("title") or "Поручение 1С"),
                "state": str(payload.get("state") or "") or None,
                "task_completed": payload.get("task_completed"),
            }
        status = str(row.status or "state_unknown")
        if already_applied and status == "applied":
            status = "already_applied"
        return {
            "command_id": str(row.id),
            "status": status,
            "assignment": assignment,
            "correlation_id": _correlation_id(correlation_id or row.correlation_id),
            "error_code": str(row.error_code or "") or None,
        }

    async def _reconcile_assignment_command(
        self,
        *,
        user_id: int,
        row: AppDocflowCommand,
    ) -> AppDocflowCommand:
        payload = self._assignment_payload_from_row(row)
        process_ref = str(payload.get("process_ref") or "")
        if not process_ref:
            return row
        try:
            state = await self._saved_credentials_call(
                user_id=int(user_id),
                operation="assignment_state",
                payload={"process_ref": process_ref},
            )
        except DocflowServiceError:
            return row
        if not bool(state.get("exists")):
            return row
        return await asyncio.to_thread(
            self._command_store.finish,
            command_id=str(row.id),
            status="applied",
            outcome="verified_after_unknown",
            error_code=None,
            remote_after_json=json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        )

    async def create_assignment(
        self,
        *,
        user_id: int,
        document_type: str,
        document_ref: str,
        assignee_ref: str,
        controller_ref: str | None,
        due_at: datetime,
        importance: str,
        title: str,
        description: str,
        idempotency_key: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        await self._ensure_assignment_enabled(int(user_id))
        correlation = _correlation_id(correlation_id)
        normalized_key = str(idempotency_key or "").strip()[:128]
        if len(normalized_key) < 8:
            raise DocflowIdempotencyConflict("Передайте уникальный Idempotency-Key")
        try:
            normalized_document_ref = str(uuid.UUID(str(document_ref)))
            normalized_assignee_ref = str(uuid.UUID(str(assignee_ref)))
            normalized_controller_ref = str(uuid.UUID(str(controller_ref))) if controller_ref else ""
        except (TypeError, ValueError):
            raise DocflowMappingRequired("Некорректная ссылка объекта 1С") from None
        normalized_document_type = str(document_type or "").strip().lower()
        if normalized_document_type not in {"internal", "incoming", "outgoing"}:
            raise DocflowMappingRequired("Тип документа для поручения не разрешён")
        normalized_title = str(title or "").strip()[:200]
        normalized_description = str(description or "").strip()[:2000]
        if not normalized_title:
            raise DocflowActionUnavailable("Укажите название поручения")
        required_prefix = self._assignment_title_prefix()
        if self._assignment_test_only() and (
            not required_prefix
            or not normalized_title.casefold().startswith(required_prefix.casefold())
        ):
            raise DocflowActionUnavailable(
                f"Пилот разрешает только поручения с префиксом «{required_prefix or 'HUB-IT TEST'}»"
            )
        due_value = due_at
        if due_value.tzinfo is None:
            if due_value <= datetime.now():
                raise DocflowStateConflict("Срок поручения должен быть в будущем")
        elif due_value <= _utcnow():
            raise DocflowStateConflict("Срок поручения должен быть в будущем")
        due_text = due_value.isoformat()
        normalized_importance = str(importance or "normal").strip().lower()
        if normalized_importance not in {"normal", "high"}:
            raise DocflowMappingRequired("Важность поручения не разрешена")
        request_payload = {
            "user_id": int(user_id),
            "document_type": normalized_document_type,
            "document_ref": normalized_document_ref,
            "assignee_ref": normalized_assignee_ref,
            "controller_ref": normalized_controller_ref,
            "due_at": due_text,
            "importance": normalized_importance,
            "title_hash": self._result_hash(normalized_title),
            "description_hash": self._result_hash(normalized_description),
        }
        request_hash = hashlib.sha256(
            json.dumps(request_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        process_ref = str(uuid.uuid4())
        remote_before = {
            "exists": False,
            "process_ref": process_ref,
            "document_ref": normalized_document_ref,
            "assignee_ref": normalized_assignee_ref,
        }
        row, created = await asyncio.to_thread(
            self._command_store.begin,
            user_id=int(user_id),
            idempotency_key=normalized_key,
            request_hash=request_hash,
            task_ref=normalized_document_ref,
            action="create_assignment",
            state_token_hash=self._result_hash(process_ref),
            correlation_id=correlation,
            remote_before_json=json.dumps(remote_before, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        )
        if not created:
            if str(row.status) in {"pending", "state_unknown"}:
                row = await self._reconcile_assignment_command(user_id=int(user_id), row=row)
            return self._assignment_command_response(
                row=row,
                correlation_id=correlation,
                already_applied=True,
            )
        try:
            state = await self._saved_credentials_call(
                user_id=int(user_id),
                operation="assignment_create",
                payload={
                    "process_ref": process_ref,
                    "document_type": normalized_document_type,
                    "document_ref": normalized_document_ref,
                    "assignee_ref": normalized_assignee_ref,
                    "controller_ref": normalized_controller_ref,
                    "due_at": due_text,
                    "importance": normalized_importance,
                    "title": normalized_title,
                    "description": normalized_description,
                },
            )
        except DocflowActionOutcomeUnknown as exc:
            row = await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="state_unknown",
                outcome="timeout",
                error_code=exc.code,
                remote_after_json=json.dumps(remote_before, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
            row = await self._reconcile_assignment_command(user_id=int(user_id), row=row)
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="assignment_create",
                outcome="success" if str(row.status) == "applied" else "state_unknown",
                correlation_id=correlation,
                error_code=None if str(row.status) == "applied" else exc.code,
            )
            return self._assignment_command_response(row=row, correlation_id=correlation)
        except DocflowServiceError as exc:
            await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="rejected",
                outcome="failed",
                error_code=exc.code,
                remote_after_json=json.dumps(remote_before, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="assignment_create",
                outcome="failed",
                correlation_id=correlation,
                error_code=exc.code,
            )
            raise
        if not bool(state.get("exists")):
            row = await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="state_unknown",
                outcome="verification_failed",
                error_code=DocflowActionOutcomeUnknown.code,
                remote_after_json=json.dumps(remote_before, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            )
            return self._assignment_command_response(row=row, correlation_id=correlation)
        row = await asyncio.to_thread(
            self._command_store.finish,
            command_id=str(row.id),
            status="applied",
            outcome="verified",
            error_code=None,
            remote_after_json=json.dumps(state, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        )
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="assignment_create",
            outcome="success",
            correlation_id=correlation,
        )
        return self._assignment_command_response(row=row, correlation_id=correlation)

    async def get_assignment_command(
        self,
        *,
        user_id: int,
        command_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        row = await asyncio.to_thread(
            self._command_store.get_for_user,
            user_id=int(user_id),
            command_id=str(command_id),
        )
        if row is None or str(row.action) != "create_assignment":
            raise DocflowNotFound("Команда создания поручения не найдена")
        if str(row.status) in {"pending", "state_unknown"}:
            row = await self._reconcile_assignment_command(user_id=int(user_id), row=row)
        return self._assignment_command_response(row=row, correlation_id=correlation_id)

    async def _saved_credentials_call(
        self,
        *,
        user_id: int,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        try:
            if bool(getattr(self._adapter, "gateway_enabled", False)):
                result = await self._adapter.call_saved(
                    user_id=int(user_id),
                    operation=operation,
                    payload=payload,
                    correlation_id="gateway",
                )
            else:
                login, password = await self._load_plain_credentials(user_id)
                result = await self._adapter.call(
                    operation,
                    {"login": login, "password": password, **payload},
                )
        except DocflowCredentialsInvalid as exc:
            await asyncio.to_thread(
                self._store.set_status,
                user_id=int(user_id),
                status="invalid",
                error_code=exc.code,
            )
            raise
        except DocflowUnavailable as exc:
            await asyncio.to_thread(
                self._store.set_status,
                user_id=int(user_id),
                status="unavailable",
                error_code=exc.code,
            )
            raise
        await asyncio.to_thread(
            self._store.set_status,
            user_id=int(user_id),
            status="valid",
            error_code=None,
        )
        return dict(result)

    async def get_task_detail(
        self,
        *,
        user_id: int,
        task_ref: str,
        correlation_id: str,
        can_act: bool = False,
    ) -> dict[str, Any]:
        result = await self._saved_credentials_call(
            user_id=int(user_id),
            operation="task_detail",
            payload={"task_ref": str(task_ref or "")},
        )
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="task_detail_read",
            outcome="success",
            correlation_id=_correlation_id(correlation_id),
        )
        credential_reason = (
            await self._write_credential_unavailable_reason(int(user_id))
            if can_act
            else None
        )
        return self._decorate_task_actions(
            user_id=int(user_id),
            detail=result,
            can_act=bool(can_act),
            credential_reason=credential_reason,
        )

    async def _task_state(self, *, user_id: int, task_ref: str) -> dict[str, Any]:
        return await self._saved_credentials_call(
            user_id=int(user_id),
            operation="task_state",
            payload={"task_ref": str(task_ref or "")},
        )

    async def _reconcile_command(
        self,
        *,
        user_id: int,
        row: AppDocflowCommand,
        can_act: bool,
    ) -> tuple[AppDocflowCommand, dict[str, Any] | None]:
        try:
            state = await self._task_state(user_id=int(user_id), task_ref=str(row.task_ref))
        except DocflowServiceError:
            return row, None
        if not self._state_matches_command(row, state):
            return row, state
        updated = await asyncio.to_thread(
            self._command_store.finish,
            command_id=str(row.id),
            status="applied",
            outcome="verified_after_timeout",
            error_code=None,
            remote_after_json=self._remote_snapshot(state),
        )
        detail = await self.get_task_detail(
            user_id=int(user_id),
            task_ref=str(row.task_ref),
            correlation_id=str(row.correlation_id),
            can_act=can_act,
        )
        return updated, detail

    async def apply_task_action(
        self,
        *,
        user_id: int,
        task_ref: str,
        action: str,
        comment: str,
        state_token: str,
        idempotency_key: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        correlation = _correlation_id(correlation_id)
        normalized_key = str(idempotency_key or "").strip()[:128]
        if len(normalized_key) < 8:
            raise DocflowIdempotencyConflict("Передайте уникальный Idempotency-Key")
        if not _env_flag("DOCFLOW_WRITE_ENABLED"):
            raise DocflowWriteDisabled("Запись в 1С выключена серверной настройкой")
        if int(user_id) not in self._pilot_user_ids():
            raise DocflowActionUnavailable("Учётная запись не включена в пилот действий 1С")
        if not self._action_state_key():
            raise DocflowConfigurationError("DOCFLOW_ACTION_STATE_KEY не настроен")
        credential_reason = await self._write_credential_unavailable_reason(int(user_id))
        if credential_reason:
            raise DocflowWriteDisabled(credential_reason)

        normalized_action = str(action or "").strip().lower()
        normalized_comment = str(comment or "").strip()
        request_payload = {
            "user_id": int(user_id),
            "task_ref": str(task_ref),
            "action": normalized_action,
            "comment_hash": self._result_hash(normalized_comment),
            "state_token_hash": self._result_hash(str(state_token or "")),
        }
        request_hash = hashlib.sha256(
            json.dumps(request_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        existing = await asyncio.to_thread(
            self._command_store.get_by_key,
            user_id=int(user_id),
            idempotency_key=normalized_key,
        )
        if existing is not None:
            if not hmac.compare_digest(str(existing.request_hash), request_hash):
                raise DocflowIdempotencyConflict(
                    "Этот Idempotency-Key уже использован для другой команды"
                )
            if str(existing.status) == "applied":
                detail = await self.get_task_detail(
                    user_id=int(user_id),
                    task_ref=str(task_ref),
                    correlation_id=correlation,
                    can_act=True,
                )
                return {
                    "command_id": str(existing.id),
                    "status": "already_applied",
                    "task": detail,
                    "correlation_id": correlation,
                    "error_code": None,
                }
            if str(existing.status) == "state_unknown":
                existing, detail = await self._reconcile_command(
                    user_id=int(user_id),
                    row=existing,
                    can_act=True,
                )
                if str(existing.status) == "applied":
                    return {
                        "command_id": str(existing.id),
                        "status": "already_applied",
                        "task": detail,
                        "correlation_id": correlation,
                        "error_code": None,
                    }
            return {
                "command_id": str(existing.id),
                "status": "pending" if str(existing.status) == "pending" else str(existing.status),
                "task": None,
                "correlation_id": correlation,
                "error_code": str(existing.error_code or "") or None,
            }

        state = await self._task_state(user_id=int(user_id), task_ref=str(task_ref))
        decorated = self._decorate_task_actions(
            user_id=int(user_id),
            detail=state,
            can_act=True,
        )
        expected_token = str(decorated.get("state_token") or "")
        if not expected_token or not hmac.compare_digest(expected_token, str(state_token or "")):
            raise DocflowStateConflict("Задание изменилось. Обновите карточку перед выполнением")
        rule = next(
            (item for item in self._matching_rules(decorated) if item.action == normalized_action),
            None,
        )
        if rule is None:
            raise DocflowActionUnavailable("Это действие не разрешено для текущего процесса 1С")
        if rule.comment_mode == "required" and not normalized_comment:
            raise DocflowActionUnavailable("Для этого действия укажите комментарий")

        expected_result = self._render_result(rule, normalized_comment)
        expected_result_hash = self._result_hash(expected_result)
        row, created = await asyncio.to_thread(
            self._command_store.begin,
            user_id=int(user_id),
            idempotency_key=normalized_key,
            request_hash=request_hash,
            task_ref=str(task_ref),
            action=normalized_action,
            state_token_hash=self._result_hash(expected_token),
            correlation_id=correlation,
            remote_before_json=self._remote_snapshot(
                state,
                expected_result_hash=expected_result_hash,
            ),
        )
        if not created:
            if str(row.status) == "applied":
                detail = await self.get_task_detail(
                    user_id=int(user_id),
                    task_ref=str(task_ref),
                    correlation_id=correlation,
                    can_act=True,
                )
                return {
                    "command_id": str(row.id),
                    "status": "already_applied",
                    "task": detail,
                    "correlation_id": correlation,
                    "error_code": None,
                }
            if str(row.status) == "state_unknown":
                row, detail = await self._reconcile_command(
                    user_id=int(user_id),
                    row=row,
                    can_act=True,
                )
                if str(row.status) == "applied":
                    return {
                        "command_id": str(row.id),
                        "status": "already_applied",
                        "task": detail,
                        "correlation_id": correlation,
                        "error_code": None,
                    }
            return {
                "command_id": str(row.id),
                "status": "pending" if str(row.status) == "pending" else str(row.status),
                "task": None,
                "correlation_id": correlation,
                "error_code": str(row.error_code or "") or None,
            }

        try:
            outcome = await self._saved_credentials_call(
                user_id=int(user_id),
                operation="task_action",
                payload={
                    "task_ref": str(task_ref),
                    "action": normalized_action,
                    "result_template": str(rule.result_value),
                    "comment": normalized_comment,
                },
            )
        except DocflowActionOutcomeUnknown as exc:
            row = await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="state_unknown",
                outcome="timeout",
                error_code=exc.code,
                remote_after_json="{}",
            )
            row, detail = await self._reconcile_command(
                user_id=int(user_id),
                row=row,
                can_act=True,
            )
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="task_action",
                outcome="success" if str(row.status) == "applied" else "state_unknown",
                correlation_id=correlation,
                error_code=None if str(row.status) == "applied" else exc.code,
            )
            return {
                "command_id": str(row.id),
                "status": "applied" if str(row.status) == "applied" else "state_unknown",
                "task": detail if str(row.status) == "applied" else None,
                "correlation_id": correlation,
                "error_code": None if str(row.status) == "applied" else exc.code,
            }
        except DocflowServiceError as exc:
            await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="rejected",
                outcome="failed",
                error_code=exc.code,
                remote_after_json="{}",
            )
            await asyncio.to_thread(
                self._store.audit,
                user_id=int(user_id),
                event_type="task_action",
                outcome="failed",
                correlation_id=correlation,
                error_code=exc.code,
            )
            raise

        remote_task = dict(outcome.get("task") or {})
        if not bool(remote_task.get("completed")) or self._result_hash(str(remote_task.get("result") or "")) != expected_result_hash:
            row = await asyncio.to_thread(
                self._command_store.finish,
                command_id=str(row.id),
                status="state_unknown",
                outcome="verification_failed",
                error_code=DocflowActionOutcomeUnknown.code,
                remote_after_json=self._remote_snapshot(remote_task),
            )
            return {
                "command_id": str(row.id),
                "status": "state_unknown",
                "task": None,
                "correlation_id": correlation,
                "error_code": DocflowActionOutcomeUnknown.code,
            }

        row = await asyncio.to_thread(
            self._command_store.finish,
            command_id=str(row.id),
            status="applied",
            outcome="verified",
            error_code=None,
            remote_after_json=self._remote_snapshot(remote_task),
        )
        detail = await self.get_task_detail(
            user_id=int(user_id),
            task_ref=str(task_ref),
            correlation_id=correlation,
            can_act=True,
        )
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="task_action",
            outcome="success",
            correlation_id=correlation,
        )
        return {
            "command_id": str(row.id),
            "status": "applied",
            "task": detail,
            "correlation_id": correlation,
            "error_code": None,
        }

    async def get_command(
        self,
        *,
        user_id: int,
        command_id: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        row = await asyncio.to_thread(
            self._command_store.get_for_user,
            user_id=int(user_id),
            command_id=str(command_id),
        )
        if row is None or str(row.action) == "create_assignment":
            raise DocflowNotFound("Команда документооборота не найдена")
        detail = None
        if str(row.status) == "state_unknown":
            row, detail = await self._reconcile_command(
                user_id=int(user_id),
                row=row,
                can_act=True,
            )
        elif str(row.status) == "applied":
            detail = await self.get_task_detail(
                user_id=int(user_id),
                task_ref=str(row.task_ref),
                correlation_id=correlation_id,
                can_act=True,
            )
        return {
            "command_id": str(row.id),
            "status": str(row.status),
            "task": detail,
            "correlation_id": _correlation_id(correlation_id),
            "error_code": str(row.error_code or "") or None,
        }

    @staticmethod
    def _validated_export_path(value: str) -> Path:
        root = docflow_export_root().resolve()
        try:
            candidate = Path(str(value or "")).resolve(strict=True)
        except (OSError, RuntimeError):
            raise DocflowUnavailable("Временный файл 1С недоступен") from None
        if candidate.parent != root or not candidate.is_file():
            raise DocflowConfigurationError("Получен некорректный путь временного файла 1С")
        return candidate

    @classmethod
    def remove_exported_file(cls, value: str | Path) -> None:
        try:
            path = cls._validated_export_path(str(value))
        except DocflowServiceError:
            return
        try:
            path.unlink(missing_ok=True)
        except OSError:
            return

    async def export_file(
        self,
        *,
        user_id: int,
        task_ref: str,
        file_ref: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        result = await self._saved_credentials_call(
            user_id=int(user_id),
            operation="file_export",
            payload={
                "task_ref": str(task_ref or ""),
                "file_ref": str(file_ref or ""),
            },
        )
        path = self._validated_export_path(str(result.get("temporary_path") or ""))
        result["temporary_path"] = str(path)
        await asyncio.to_thread(
            self._store.audit,
            user_id=int(user_id),
            event_type="task_file_read",
            outcome="success",
            correlation_id=_correlation_id(correlation_id),
        )
        return result

    async def build_file_preview(
        self,
        *,
        user_id: int,
        task_ref: str,
        file_ref: str,
        correlation_id: str,
    ) -> dict[str, Any]:
        exported = await self.export_file(
            user_id=int(user_id),
            task_ref=task_ref,
            file_ref=file_ref,
            correlation_id=correlation_id,
        )
        path = self._validated_export_path(str(exported.get("temporary_path") or ""))
        try:
            content = await asyncio.to_thread(path.read_bytes)
        finally:
            self.remove_exported_file(path)
        filename = str(exported.get("name") or "document.bin")
        content_type = str(exported.get("content_type") or "application/octet-stream")
        if content_type == "application/pdf" or filename.casefold().endswith(".pdf"):
            return {
                "content": content,
                "filename": filename,
                "source_kind": "pdf",
                "page_count": 0,
                "sheets": [],
            }
        try:
            artifact = await asyncio.to_thread(
                build_office_preview_artifact,
                filename=filename,
                content_type=content_type,
                content=content,
            )
        except MailAttachmentPreviewError:
            raise DocflowUnavailable(
                "Предпросмотр этого файла временно недоступен. Скачайте оригинал"
            ) from None
        return {
            "content": artifact.pdf_bytes,
            "filename": artifact.pdf_filename,
            "source_kind": artifact.source_kind,
            "page_count": artifact.page_count,
            "sheets": artifact.sheets,
        }

    async def metadata(self, *, user_id: int) -> dict[str, Any]:
        return await self._saved_credentials_call(
            user_id=int(user_id),
            operation="metadata",
            payload={},
        )

    async def gateway_call(
        self,
        *,
        user_id: int,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        allowed = {
            "metadata",
            "tasks",
            "task_detail",
            "task_state",
            "task_action",
            "assignment_documents",
            "assignment_assignees",
            "assignment_state",
            "assignment_create",
            "file_export",
        }
        if operation not in allowed:
            raise DocflowActionUnavailable("Операция внутреннего шлюза не разрешена")
        return await self._saved_credentials_call(
            user_id=int(user_id),
            operation=operation,
            payload=dict(payload or {}),
        )


docflow_service = DocflowService()
