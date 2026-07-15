"""Managed, read-only process boundary for 1C COM calls.

``V83.COMConnector`` is an in-process COM server.  A blocked COM call cannot be
reliably cancelled from a FastAPI worker thread, and a crashed COM proxy can
take the whole API process down.  This module provides a small JSON-only RPC
bridge which keeps COM in one child process.  The parent can terminate and
replace that child after a timeout without restarting the web application.

The bridge intentionally knows nothing about 1C query text or mutable 1C
objects.  An application supplies a *dispatcher* using ``module:attribute``;
the dispatcher receives ``(operation, payload)`` and must return JSON data.
Only explicitly allowlisted read operations can be submitted.  This makes the
process boundary useful for the warehouse integration without becoming a new
path for writing documents to 1C.

The module is deliberately independent from ``warehouse_1c_service``.  It can
be adopted incrementally by moving that service's typed read handlers into a
dispatcher, while its existing API and tests keep working during rollout.
"""
from __future__ import annotations

import importlib
import json
import math
import multiprocessing as multiprocessing_module
import os
import queue
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol


DEFAULT_READ_OPERATIONS = frozenset(
    {
        "attachment",
        "balances",
        "balances_batch",
        "catalog_sync",
        "document",
        "files",
        "health",
        "movements",
        "nomenclature_search",
        "registrar",
        "warehouse_search",
    }
)
_OPERATION_RE = re.compile(r"^[a-z][a-z0-9_.:-]{0,63}$")


class Warehouse1CProcessBridgeError(RuntimeError):
    """Base error for the managed 1C process bridge."""


class Warehouse1CProcessBridgeBusy(Warehouse1CProcessBridgeError):
    """The bounded bridge queue has no capacity left."""


class Warehouse1CProcessBridgeUnavailable(Warehouse1CProcessBridgeError):
    """The worker is unavailable or its circuit breaker is open."""


class Warehouse1CProcessBridgeTimeout(Warehouse1CProcessBridgeError):
    """A read call timed out and the worker was replaced.

    The result is deliberately unknown.  This is safe for the read-only 1C
    integration, and callers must never reinterpret it as a zero balance.
    """


class Warehouse1CProcessBridgeRemoteError(Warehouse1CProcessBridgeError):
    """The isolated worker rejected or failed an operation."""


class Warehouse1CProcessBridgeConfigurationError(Warehouse1CProcessBridgeError):
    """The dispatcher or bridge configuration is invalid."""


class Warehouse1CReadDispatcher(Protocol):
    """Contract implemented inside the child process.

    The payload and return value must be JSON-compatible.  A dispatcher owns
    any COM connection it needs and may expose ``close()`` for best-effort
    cleanup before the child exits.
    """

    def __call__(self, operation: str, payload: dict[str, Any]) -> Any: ...


@dataclass
class _PendingCall:
    event: threading.Event
    response: dict[str, Any] | None = None


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _positive_int(value: Any, default: int, *, minimum: int = 1) -> int:
    try:
        return max(minimum, int(value))
    except (TypeError, ValueError):
        return max(minimum, int(default))


def _read_operations(value: Iterable[str] | None) -> frozenset[str]:
    source = DEFAULT_READ_OPERATIONS if value is None else value
    operations = frozenset(str(item or "").strip().lower() for item in source)
    if not operations or "" in operations:
        raise Warehouse1CProcessBridgeConfigurationError("Нужен непустой allowlist read-операций 1С")
    invalid = sorted(item for item in operations if not _OPERATION_RE.fullmatch(item))
    if invalid:
        raise Warehouse1CProcessBridgeConfigurationError(
            f"Некорректные имена read-операций 1С: {', '.join(invalid)}"
        )
    return operations


def _normalize_operation(operation: object, allowed_operations: frozenset[str]) -> str:
    normalized = str(operation or "").strip().lower()
    if not _OPERATION_RE.fullmatch(normalized) or normalized not in allowed_operations:
        raise Warehouse1CProcessBridgeConfigurationError("Операция 1С не разрешена read-only allowlist")
    return normalized


def _json_clone(value: Any, *, maximum_bytes: int) -> Any:
    """Validate a value before it crosses the process boundary.

    COM proxies, datetimes and arbitrary Python objects must not leak through
    the bridge.  JSON also makes the protocol inspectable and safe to replace
    with a named-pipe/HTTP transport later without changing callers.
    """

    try:
        encoded = json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise Warehouse1CProcessBridgeConfigurationError(
            "Данные 1С bridge должны быть JSON-совместимыми"
        ) from exc
    if len(encoded.encode("utf-8")) > maximum_bytes:
        raise Warehouse1CProcessBridgeConfigurationError(
            f"Сообщение 1С bridge превышает лимит {maximum_bytes} байт"
        )
    return json.loads(encoded)


def _resolve_dispatcher(path: str) -> Warehouse1CReadDispatcher:
    module_name, separator, attribute_path = str(path or "").strip().partition(":")
    if not module_name or not separator or not attribute_path:
        raise Warehouse1CProcessBridgeConfigurationError(
            "Dispatcher должен быть задан в формате package.module:callable"
        )
    try:
        value: Any = importlib.import_module(module_name)
        for attribute in attribute_path.split("."):
            value = getattr(value, attribute)
    except (ImportError, AttributeError) as exc:
        raise Warehouse1CProcessBridgeConfigurationError(
            f"Не удалось загрузить dispatcher 1С: {module_name}:{attribute_path}"
        ) from exc
    if not callable(value):
        raise Warehouse1CProcessBridgeConfigurationError("Dispatcher 1С должен быть callable")
    return value


def _co_initialize() -> Any | None:
    """Initialize a COM apartment only in the child process on Windows."""

    if os.name != "nt":
        return None
    try:
        import pythoncom  # type: ignore

        pythoncom.CoInitialize()
        return pythoncom
    except ImportError:
        # Tests and non-Windows development use a pure-Python dispatcher.  A
        # real Windows deployment will fail at dispatcher connection time if
        # pywin32 is absent, rather than silently changing its semantics.
        return None


def _worker_main(
    dispatcher_path: str,
    allowed_operations: tuple[str, ...],
    request_queue: Any,
    response_queue: Any,
    maximum_message_bytes: int,
) -> None:
    """Child process entry point; never executes a non-allowlisted request."""

    pythoncom = _co_initialize()
    dispatcher: Warehouse1CReadDispatcher | None = None
    try:
        dispatcher = _resolve_dispatcher(dispatcher_path)
        response_queue.put({"kind": "ready", "started_at": _utc_now_iso()})
        allowed = frozenset(allowed_operations)
        while True:
            message = request_queue.get()
            if not isinstance(message, dict) or message.get("kind") == "shutdown":
                return
            request_id = str(message.get("request_id") or "")
            operation = str(message.get("operation") or "").strip().lower()
            try:
                if operation not in allowed:
                    raise Warehouse1CProcessBridgeConfigurationError("Операция 1С не разрешена read-only allowlist")
                payload = message.get("payload")
                if not isinstance(payload, dict):
                    raise Warehouse1CProcessBridgeConfigurationError("Payload операции 1С должен быть объектом")
                result = dispatcher(operation, payload)
                response_queue.put(
                    {
                        "kind": "response",
                        "request_id": request_id,
                        "ok": True,
                        "result": _json_clone(result, maximum_bytes=maximum_message_bytes),
                    }
                )
            except Exception as exc:  # The parent must receive a plain, safe error message only.
                response_queue.put(
                    {
                        "kind": "response",
                        "request_id": request_id,
                        "ok": False,
                        "error": f"{type(exc).__name__}: {str(exc)[:500]}",
                    }
                )
    except Exception as exc:
        response_queue.put(
            {
                "kind": "startup_error",
                "error": f"{type(exc).__name__}: {str(exc)[:500]}",
            }
        )
    finally:
        close = getattr(dispatcher, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
        if pythoncom is not None:
            try:
                pythoncom.CoUninitialize()
            except Exception:
                pass


class Warehouse1CProcessBridge:
    """A managed single-process, bounded, read-only 1C COM bridge.

    A process has one COM apartment, so calls are intentionally serialized.
    ``queue_limit`` controls extra requests waiting behind the active call;
    once it is full the caller gets an explicit overload error.  A timed-out
    call terminates the whole child process because a Python thread cannot
    safely interrupt COM.  All pending reads then fail as *unknown*, and a
    fresh child starts lazily for the next request.
    """

    def __init__(
        self,
        dispatcher_path: str,
        *,
        allowed_operations: Iterable[str] | None = None,
        queue_limit: int = 16,
        failure_threshold: int = 4,
        cooldown_seconds: float = 60,
        maximum_message_bytes: int = 1_048_576,
        process_name: str = "warehouse1c-com-bridge",
        multiprocessing_context: str = "spawn",
    ) -> None:
        self._dispatcher_path = str(dispatcher_path or "").strip()
        if not self._dispatcher_path:
            raise Warehouse1CProcessBridgeConfigurationError("Не задан dispatcher 1С bridge")
        self._allowed_operations = _read_operations(allowed_operations)
        self._queue_limit = max(0, int(queue_limit))
        self._capacity = 1 + self._queue_limit
        self._failure_threshold = _positive_int(failure_threshold, 4)
        self._cooldown_seconds = max(1.0, float(cooldown_seconds))
        self._maximum_message_bytes = _positive_int(maximum_message_bytes, 1_048_576, minimum=1024)
        self._process_name = str(process_name or "warehouse1c-com-bridge")[:80]
        try:
            self._context = multiprocessing_module.get_context(multiprocessing_context)
        except ValueError as exc:
            raise Warehouse1CProcessBridgeConfigurationError("Некорректный multiprocessing context") from exc

        self._capacity_slots = threading.BoundedSemaphore(self._capacity)
        self._lock = threading.RLock()
        self._pending: dict[str, _PendingCall] = {}
        self._process: Any | None = None
        self._request_queue: Any | None = None
        self._response_queue: Any | None = None
        self._receiver_stop: threading.Event | None = None
        self._receiver_thread: threading.Thread | None = None
        self._generation = 0
        self._shutting_down = False
        self._startup_error = ""
        self._worker_ready = False
        self._started_at = ""
        self._completed = 0
        self._failed = 0
        self._timed_out = 0
        self._rejected = 0
        self._restarts = 0
        self._consecutive_failures = 0
        self._circuit_open_until = 0.0
        self._last_error = ""
        self._last_success_at = ""

    @classmethod
    def from_environment(cls) -> "Warehouse1CProcessBridge":
        """Build a bridge from explicit environment configuration.

        ``WAREHOUSE_1C_BRIDGE_DISPATCHER`` must point to a typed read
        dispatcher.  The optional allowlist is comma-separated; an empty value
        uses :data:`DEFAULT_READ_OPERATIONS`.
        """

        raw_operations = str(os.getenv("WAREHOUSE_1C_BRIDGE_READ_OPERATIONS") or "").strip()
        operations = (
            [part.strip().lower() for part in raw_operations.split(",") if part.strip()]
            if raw_operations
            else None
        )
        return cls(
            str(os.getenv("WAREHOUSE_1C_BRIDGE_DISPATCHER") or ""),
            allowed_operations=operations,
            queue_limit=_positive_int(os.getenv("WAREHOUSE_1C_BRIDGE_QUEUE_LIMIT"), 16, minimum=0),
            failure_threshold=_positive_int(os.getenv("WAREHOUSE_1C_BRIDGE_FAILURE_THRESHOLD"), 4),
            cooldown_seconds=float(_positive_int(os.getenv("WAREHOUSE_1C_BRIDGE_COOLDOWN_SECONDS"), 60)),
            maximum_message_bytes=_positive_int(
                os.getenv("WAREHOUSE_1C_BRIDGE_MAX_MESSAGE_BYTES"), 1_048_576, minimum=1024
            ),
        )

    def start(self) -> dict[str, Any]:
        """Start the isolated worker lazily; no COM call is made here."""

        with self._lock:
            if self._shutting_down:
                raise Warehouse1CProcessBridgeUnavailable("1С bridge остановлен")
            self._ensure_process_locked()
            return self._status_locked()

    def call(self, operation: str, payload: Mapping[str, Any], *, timeout: float = 45) -> Any:
        """Execute one explicitly allowlisted read operation.

        ``Warehouse1CProcessBridgeTimeout`` and
        ``Warehouse1CProcessBridgeUnavailable`` are intentionally distinct
        from a valid empty result.  API adapters should map both to
        ``unknown``/``error``, never to a zero balance.
        """

        normalized_operation = _normalize_operation(operation, self._allowed_operations)
        if not isinstance(payload, Mapping):
            raise Warehouse1CProcessBridgeConfigurationError("Payload операции 1С должен быть объектом")
        normalized_payload = _json_clone(dict(payload), maximum_bytes=self._maximum_message_bytes)
        try:
            timeout_seconds = float(timeout)
        except (TypeError, ValueError) as exc:
            raise Warehouse1CProcessBridgeConfigurationError("Некорректный timeout 1С bridge") from exc
        if timeout_seconds <= 0:
            raise Warehouse1CProcessBridgeConfigurationError("Timeout 1С bridge должен быть положительным")

        if not self._capacity_slots.acquire(blocking=False):
            with self._lock:
                self._rejected += 1
                self._last_error = "Очередь 1С bridge заполнена"
            raise Warehouse1CProcessBridgeBusy("Очередь read-запросов к 1С заполнена")

        request_id = uuid.uuid4().hex
        pending = _PendingCall(event=threading.Event())
        try:
            with self._lock:
                self._raise_if_unavailable_locked()
                self._ensure_process_locked()
                if self._startup_error:
                    error = self._startup_error
                    self._restart_locked("Ошибка запуска worker 1С")
                    raise Warehouse1CProcessBridgeUnavailable(error)
                if self._request_queue is None:
                    raise Warehouse1CProcessBridgeUnavailable("Очередь 1С bridge не запущена")
                self._pending[request_id] = pending
                try:
                    self._request_queue.put_nowait(
                        {
                            "kind": "request",
                            "request_id": request_id,
                            "operation": normalized_operation,
                            "payload": normalized_payload,
                        }
                    )
                except queue.Full as exc:
                    self._pending.pop(request_id, None)
                    self._rejected += 1
                    self._last_error = "Очередь 1С bridge заполнена"
                    raise Warehouse1CProcessBridgeBusy("Очередь read-запросов к 1С заполнена") from exc

            deadline = time.monotonic() + timeout_seconds
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    with self._lock:
                        self._pending.pop(request_id, None)
                        self._record_failure_locked("Превышен timeout обращения к 1С", timed_out=True)
                        self._restart_locked("Timeout COM-операции")
                    raise Warehouse1CProcessBridgeTimeout(
                        "1С не ответила вовремя; worker перезапущен, результат чтения неизвестен"
                    )
                if pending.event.wait(timeout=min(0.1, remaining)):
                    break
                with self._lock:
                    if not self._process_is_alive_locked():
                        self._pending.pop(request_id, None)
                        error = self._startup_error or "Worker 1С неожиданно завершился"
                        self._record_failure_locked(error)
                        self._restart_locked("Worker 1С завершился")
                        raise Warehouse1CProcessBridgeUnavailable(error)

            response = pending.response or {
                "ok": False,
                "error": "Ответ worker 1С не получен",
            }
            if bool(response.get("ok")):
                with self._lock:
                    self._record_success_locked()
                return response.get("result")

            error = str(response.get("error") or "Ошибка read-операции 1С")[:500]
            with self._lock:
                self._record_failure_locked(error)
            raise Warehouse1CProcessBridgeRemoteError(error)
        finally:
            self._capacity_slots.release()

    def restart(self) -> dict[str, Any]:
        """Operator-controlled restart after a known COM issue.

        Pending calls are failed as unknown; the next call starts a fresh COM
        process.  A manual restart also closes the circuit breaker.
        """

        with self._lock:
            if self._shutting_down:
                raise Warehouse1CProcessBridgeUnavailable("1С bridge остановлен")
            self._restart_locked("Ручной restart 1С bridge")
            self._circuit_open_until = 0.0
            self._consecutive_failures = 0
            self._ensure_process_locked()
            return self._status_locked()

    def shutdown(self, *, grace_seconds: float = 5) -> None:
        """Stop the child and fail outstanding reads without touching 1C data."""

        with self._lock:
            if self._shutting_down:
                return
            self._shutting_down = True
            self._fail_pending_locked("1С bridge остановлен до получения результата")
            self._stop_process_locked(grace_seconds=max(0.0, float(grace_seconds)))

    def get_status(self) -> dict[str, Any]:
        with self._lock:
            return self._status_locked()

    def _raise_if_unavailable_locked(self) -> None:
        now = time.monotonic()
        if self._circuit_open_until and now >= self._circuit_open_until:
            self._circuit_open_until = 0.0
            self._consecutive_failures = 0
        if self._circuit_open_until > now:
            retry_after = max(1, int(self._circuit_open_until - now))
            raise Warehouse1CProcessBridgeUnavailable(
                f"1С bridge временно отключён после ошибок; повторите через {retry_after} сек."
            )

    def _ensure_process_locked(self) -> None:
        if self._process_is_alive_locked():
            return
        self._stop_process_locked(grace_seconds=0)
        self._startup_error = ""
        self._worker_ready = False
        self._generation += 1
        generation = self._generation
        self._request_queue = self._context.Queue(maxsize=self._capacity)
        self._response_queue = self._context.Queue()
        self._receiver_stop = threading.Event()
        self._process = self._context.Process(
            target=_worker_main,
            args=(
                self._dispatcher_path,
                tuple(sorted(self._allowed_operations)),
                self._request_queue,
                self._response_queue,
                self._maximum_message_bytes,
            ),
            name=self._process_name,
            daemon=True,
        )
        self._process.start()
        self._receiver_thread = threading.Thread(
            target=self._receive_loop,
            args=(generation, self._response_queue, self._receiver_stop),
            name=f"{self._process_name}-responses",
            daemon=True,
        )
        self._receiver_thread.start()

    def _process_is_alive_locked(self) -> bool:
        return bool(self._process is not None and self._process.is_alive())

    def _receive_loop(self, generation: int, response_queue: Any, stop: threading.Event) -> None:
        while not stop.is_set():
            try:
                response = response_queue.get(timeout=0.1)
            except queue.Empty:
                continue
            except (EOFError, OSError):
                return
            if not isinstance(response, dict):
                continue
            with self._lock:
                if generation != self._generation:
                    return
                kind = str(response.get("kind") or "")
                if kind == "ready":
                    self._started_at = str(response.get("started_at") or _utc_now_iso())
                    self._startup_error = ""
                    self._worker_ready = True
                    continue
                if kind == "startup_error":
                    self._startup_error = str(response.get("error") or "Ошибка запуска worker 1С")[:500]
                    self._worker_ready = False
                    continue
                if kind != "response":
                    continue
                request_id = str(response.get("request_id") or "")
                pending = self._pending.pop(request_id, None)
                if pending is not None:
                    pending.response = response
                    pending.event.set()

    def _record_success_locked(self) -> None:
        self._completed += 1
        self._consecutive_failures = 0
        self._last_success_at = _utc_now_iso()

    def _record_failure_locked(self, error: str, *, timed_out: bool = False) -> None:
        self._failed += 1
        if timed_out:
            self._timed_out += 1
        self._consecutive_failures += 1
        self._last_error = str(error or "Ошибка обращения к 1С")[:500]
        if self._consecutive_failures >= self._failure_threshold:
            self._circuit_open_until = time.monotonic() + self._cooldown_seconds

    def _fail_pending_locked(self, error: str) -> None:
        for pending in self._pending.values():
            pending.response = {"ok": False, "error": str(error)[:500]}
            pending.event.set()
        self._pending.clear()

    def _restart_locked(self, reason: str) -> None:
        self._restarts += 1
        self._last_error = str(reason)[:500]
        self._fail_pending_locked("Worker 1С был перезапущен; результат чтения неизвестен")
        self._stop_process_locked(grace_seconds=0)

    def _stop_process_locked(self, *, grace_seconds: float) -> None:
        process = self._process
        request_queue = self._request_queue
        response_queue = self._response_queue
        receiver_stop = self._receiver_stop
        receiver_thread = self._receiver_thread
        self._process = None
        self._request_queue = None
        self._response_queue = None
        self._receiver_stop = None
        self._receiver_thread = None
        self._worker_ready = False
        if receiver_stop is not None:
            receiver_stop.set()
        if process is not None:
            if process.is_alive() and request_queue is not None:
                try:
                    request_queue.put_nowait({"kind": "shutdown"})
                except (queue.Full, ValueError, OSError):
                    pass
            if process.is_alive():
                process.join(timeout=grace_seconds)
            if process.is_alive():
                process.terminate()
                process.join(timeout=2)
        if receiver_thread is not None and receiver_thread is not threading.current_thread():
            receiver_thread.join(timeout=1)
        for managed_queue in (request_queue, response_queue):
            if managed_queue is None:
                continue
            try:
                managed_queue.close()
                managed_queue.join_thread()
            except (AttributeError, OSError, ValueError):
                pass

    def _status_locked(self) -> dict[str, Any]:
        now = time.monotonic()
        if self._circuit_open_until and now >= self._circuit_open_until:
            self._circuit_open_until = 0.0
            self._consecutive_failures = 0
        remaining = self._circuit_open_until - now
        retry_after = max(0, int(math.ceil(remaining))) if remaining > 0 else 0
        alive = self._process_is_alive_locked()
        pending_count = len(self._pending)
        return {
            "mode": "read_only_process_bridge",
            "ready": bool(
                alive and self._worker_ready and not self._startup_error and not retry_after and not self._shutting_down
            ),
            "state": (
                "stopped"
                if self._shutting_down
                else ("running" if alive and self._worker_ready else "starting")
            ),
            "pid": int(self._process.pid) if alive and self._process is not None and self._process.pid else None,
            "started_at": self._started_at or None,
            "allowed_operations": sorted(self._allowed_operations),
            "workers": 1,
            "queue_limit": self._queue_limit,
            "queue_length": max(0, pending_count - 1),
            "in_flight": min(1, pending_count),
            "pending": pending_count,
            "completed": self._completed,
            "failed": self._failed,
            "timed_out": self._timed_out,
            "rejected": self._rejected,
            "restarts": self._restarts,
            "consecutive_failures": self._consecutive_failures,
            "circuit_breaker": "open" if retry_after else "closed",
            "retry_after_seconds": retry_after,
            "last_error": self._last_error or None,
            "last_success_at": self._last_success_at or None,
            "startup_error": self._startup_error or None,
        }


__all__ = [
    "DEFAULT_READ_OPERATIONS",
    "Warehouse1CProcessBridge",
    "Warehouse1CProcessBridgeBusy",
    "Warehouse1CProcessBridgeConfigurationError",
    "Warehouse1CProcessBridgeError",
    "Warehouse1CProcessBridgeRemoteError",
    "Warehouse1CProcessBridgeTimeout",
    "Warehouse1CProcessBridgeUnavailable",
]
