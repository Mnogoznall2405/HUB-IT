"""Async, allowlisted client for the standard 1C Document Management DMService."""
from __future__ import annotations

import asyncio
import base64
import binascii
import copy
import json
import mimetypes
import os
import re
import ssl
import sys
import tempfile
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urljoin

import httpx
from lxml import etree

from backend.services.docflow_1c_client import (
    Docflow1CAuthenticationError,
    Docflow1CConflictError,
    Docflow1CDigitalSignatureRequiredError,
    Docflow1CFileStorageUnavailableError,
    Docflow1CFileTooLargeError,
    Docflow1CMappingError,
    Docflow1CNotFoundError,
    Docflow1COutcomeUnknownError,
    Docflow1CUnavailableError,
    docflow_export_root,
)
from backend.services.docflow_action_rules import configuration_fingerprint


SOAP_NS = "http://schemas.xmlsoap.org/soap/envelope/"
DM_NS = "http://www.1c.ru/dm"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
XSD_NS = "http://www.w3.org/2001/XMLSchema"
SOAP_ACTION = f"{DM_NS}#DMService:execute"
SUPPORTED_DM_VERSION = "2.1.37.5.CORP"

_REQUEST_TYPES = frozenset(
    {
        "DMGetVersionRequest",
        "DMGetCurrentUserRequest",
        "DMGetSettingsRequest",
        "DMGetObjectListRequest",
        "DMRetrieveRequest",
        "DMUpdateRequest",
        "DMAcceptTasksRequest",
        "DMLaunchBusinessProcessRequest",
        "DMGetFileListByOwnerRequest",
    }
)
_DOCUMENT_TYPES = {
    "internal": ("DMInternalDocument", "Внутренний документ"),
    "incoming": ("DMIncomingDocument", "Входящий документ"),
    "outgoing": ("DMOutgoingDocument", "Исходящий документ"),
}
_PROCESS_LABELS = {
    "DMBusinessProcessApproval": "Согласование",
    "DMBusinessProcessConfirmation": "Утверждение",
    "DMBusinessProcessAcquaintance": "Ознакомление",
    "DMBusinessProcessConsideration": "Ознакомление",
    "DMBusinessProcessPerformance": "Исполнение",
    "DMBusinessProcessOrder": "Исполнение",
    "DMBusinessProcessInvitation": "Приглашение",
}
_ACTION_SPEC = {
    "approve": {
        "task_types": {
            "DMBusinessProcessApprovalTaskApproval",
            "DMBusinessProcessConfirmationTaskConfirmation",
        },
        "approval": ("approvalResult", "DMApprovalResult", "Согласовано", "Согласовано"),
        "confirmation": ("confirmationResult", "DMConfirmationResult", "Утверждено", "Утверждено"),
    },
    "approve_with_comments": {
        "task_types": {"DMBusinessProcessApprovalTaskApproval"},
        "field": "approvalResult",
        "object_type": "DMApprovalResult",
        "object_id": "СогласованоСЗамечаниями",
        "name": "Согласовано с замечаниями",
    },
    "accept_invitation": {
        "task_types": {"DMBusinessProcessInvitationTaskInvitation"},
        "field": "invitationResult",
        "object_type": "DMInvitationResult",
        "object_id": "Принято",
        "name": "Принято",
    },
    "decline_invitation": {
        "task_types": {"DMBusinessProcessInvitationTaskInvitation"},
        "field": "invitationResult",
        "object_type": "DMInvitationResult",
        "object_id": "НеПринято",
        "name": "Не принято",
    },
    "reject": {
        "task_types": {
            "DMBusinessProcessApprovalTaskApproval",
            "DMBusinessProcessConfirmationTaskConfirmation",
        },
        "approval": ("approvalResult", "DMApprovalResult", "НеСогласовано", "Не согласовано"),
        "confirmation": ("confirmationResult", "DMConfirmationResult", "НеУтверждено", "Не утверждено"),
    },
    "acknowledge": {
        "task_types": {
            "DMBusinessProcessApprovalTaskCheckup",
            "DMBusinessProcessConsiderationTaskAcquaint",
            "DMBusinessProcessTask",
        },
    },
    "complete": {
        "task_types": {"DMBusinessProcessTask"},
    },
}
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _env_int(name: str, default: int, *, minimum: int = 1, maximum: int = 1_000_000_000) -> int:
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)) or default)))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float, *, minimum: float = 0.1, maximum: float = 3600.0) -> float:
    try:
        return max(minimum, min(maximum, float(os.getenv(name, str(default)) or default)))
    except (TypeError, ValueError):
        return default


def _local_name(element: etree._Element | None) -> str:
    if element is None or not isinstance(element.tag, str):
        return ""
    return etree.QName(element).localname


def _child(element: etree._Element | None, name: str) -> etree._Element | None:
    if element is None:
        return None
    return next((item for item in element if _local_name(item) == name), None)


def _children(element: etree._Element | None, name: str) -> list[etree._Element]:
    if element is None:
        return []
    return [item for item in element if _local_name(item) == name]


def _descendants(element: etree._Element | None, name: str) -> list[etree._Element]:
    if element is None:
        return []
    return [item for item in element.iter() if _local_name(item) == name]


def _text(element: etree._Element | None, name: str | None = None, *, maximum: int = 10_000) -> str:
    target = _child(element, name) if name else element
    return str(target.text or "").strip()[:maximum] if target is not None else ""


def _date_text(element: etree._Element | None, name: str) -> str | None:
    value = _text(element, name, maximum=64)
    if not value or value.startswith("0001-"):
        return None
    return value


def _bool_text(element: etree._Element | None, name: str, default: bool = False) -> bool:
    value = _text(element, name).casefold()
    if not value:
        return default
    return value in {"1", "true", "истина", "yes"}


def _integer_text(element: etree._Element | None, name: str, default: int = 0) -> int:
    try:
        return max(0, int(_text(element, name) or default))
    except (TypeError, ValueError):
        return default


def _xsi_type(element: etree._Element | None) -> str:
    if element is None:
        return ""
    value = str(element.get(f"{{{XSI_NS}}}type") or "").strip()
    return value.rsplit(":", 1)[-1]


def _object_id_element(element: etree._Element | None) -> etree._Element | None:
    if element is None:
        return None
    if _local_name(element).casefold() == "objectid":
        return element
    object_id = _child(element, "ObjectID")
    return object_id if object_id is not None else _child(element, "objectID")


def _object_id(element: etree._Element | None) -> str:
    object_id = _object_id_element(element)
    return _text(object_id, "id", maximum=128)


def _object_type(element: etree._Element | None) -> str:
    return _xsi_type(element) or _text(_object_id_element(element), "type", maximum=128).rsplit(":", 1)[-1]


def _object_presentation(element: etree._Element | None) -> str:
    object_id = _object_id_element(element)
    return _text(element, "name", maximum=2000) or _text(object_id, "presentation", maximum=2000)


def _navigation_ref(element: etree._Element | None) -> str:
    return _text(_object_id_element(element), "navigationRef", maximum=2000)


def _qname(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def _add(parent: etree._Element, name: str, value: Any | None = None) -> etree._Element:
    element = etree.SubElement(parent, _qname(DM_NS, name))
    if value is not None:
        element.text = str(value)
    return element


def _add_object_id(
    parent: etree._Element,
    *,
    object_id: str,
    object_type: str,
    presentation: str = "",
    field_name: str = "objectID",
) -> etree._Element:
    wrapper = _add(parent, field_name)
    _add(wrapper, "id", object_id)
    if presentation:
        _add(wrapper, "presentation", presentation)
    _add(wrapper, "type", object_type)
    return wrapper


def _normalize_xsi_type_prefixes(element: etree._Element) -> None:
    """Make lexical xsi:type QNames self-contained in a new SOAP envelope."""
    attribute_name = _qname(XSI_NS, "type")
    for item in element.iter():
        value = str(item.get(attribute_name) or "").strip()
        if ":" not in value:
            continue
        prefix, local_name = value.rsplit(":", 1)
        namespace = item.nsmap.get(prefix)
        if namespace == DM_NS or prefix in {"m", "tns", "xs1", "xsd1"}:
            item.set(attribute_name, f"tns:{local_name}")
        elif namespace == XSD_NS or prefix in {"xs", "xsd"}:
            item.set(attribute_name, f"xsd:{local_name}")


def _safe_filename(name: str, extension: str = "") -> str:
    normalized = Path(str(name or "Файл 1С").replace("\\", "/")).name.strip()
    normalized = re.sub(r"[\x00-\x1f<>:\"/\\|?*]+", "_", normalized).strip(" .")[:180]
    suffix = str(extension or "").strip().lower().lstrip(".")[:16]
    if suffix and not normalized.casefold().endswith(f".{suffix}".casefold()):
        normalized = f"{normalized}.{suffix}"
    return normalized or (f"document.{suffix}" if suffix else "document.bin")


def _preview_supported(filename: str, content_type: str) -> bool:
    suffix = Path(filename).suffix.casefold()
    return content_type == "application/pdf" or suffix in {
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".rtf",
    }


class DocflowDMServiceClient:
    """The only public transport to DMService; arbitrary SOAP calls are impossible."""

    def __init__(
        self,
        *,
        service_url: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.service_url = str(
            service_url or os.getenv("DOCFLOW_DM_SERVICE_URL") or ""
        ).strip()
        lowered_url = self.service_url.lower()
        self._insecure_http = lowered_url.startswith("http://")
        allow_insecure_http = str(
            os.getenv("DOCFLOW_DM_ALLOW_INSECURE_HTTP", "0") or "0"
        ).strip().casefold() in {"1", "true", "yes", "on"}
        if not lowered_url.startswith("https://") and not (self._insecure_http and allow_insecure_http):
            raise Docflow1CMappingError(
                "DOCFLOW_DM_SERVICE_URL должен использовать HTTPS; временный HTTP требует отдельного флага"
            )
        verify_flag = str(os.getenv("DOCFLOW_DM_SERVICE_TLS_VERIFY", "1") or "1").strip().casefold()
        if verify_flag not in {"1", "true", "yes", "on"}:
            raise Docflow1CMappingError("Проверку TLS для DMService отключать нельзя")
        ca_bundle = str(os.getenv("DOCFLOW_DM_SERVICE_CA_BUNDLE", "") or "").strip()
        verify: bool | str | ssl.SSLContext = self._tls_context(ca_bundle)
        self._connect_timeout = _env_float("DOCFLOW_DM_CONNECT_TIMEOUT_SECONDS", 5.0)
        self._read_timeout = _env_float("DOCFLOW_DM_READ_TIMEOUT_SECONDS", 25.0)
        self._write_timeout = _env_float("DOCFLOW_DM_WRITE_TIMEOUT_SECONDS", 45.0)
        self._file_timeout = _env_float("DOCFLOW_DM_FILE_TIMEOUT_SECONDS", 90.0)
        self._queue_timeout = _env_float("DOCFLOW_DM_QUEUE_TIMEOUT_SECONDS", 5.0)
        self._max_response_bytes = _env_int(
            "DOCFLOW_DM_MAX_RESPONSE_BYTES", 25 * 1024 * 1024, minimum=64 * 1024, maximum=256 * 1024 * 1024
        )
        self._max_file_bytes = _env_int(
            "DOCFLOW_MAX_FILE_BYTES", 50 * 1024 * 1024, minimum=1024, maximum=512 * 1024 * 1024
        )
        # SOAP carries base64(~4/3) plus XML envelope; keep file downloads under a separate ceiling.
        default_file_response_bytes = int(self._max_file_bytes * 4 / 3) + (2 * 1024 * 1024)
        self._max_file_response_bytes = _env_int(
            "DOCFLOW_DM_MAX_FILE_RESPONSE_BYTES",
            max(self._max_response_bytes, default_file_response_bytes),
            minimum=64 * 1024,
            maximum=512 * 1024 * 1024,
        )
        concurrency = _env_int("DOCFLOW_DM_MAX_CONCURRENCY", 16, minimum=1, maximum=64)
        self._queue_limit = _env_int("DOCFLOW_DM_QUEUE_LIMIT", 64, minimum=1, maximum=1000)
        self._semaphore = asyncio.Semaphore(concurrency)
        self._pending_lock = threading.Lock()
        self._pending = 0
        self._cache_lock = threading.Lock()
        self._version_cache: dict[str, tuple[float, str]] = {}
        self._visible_type_cache: dict[str, tuple[float, dict[str, str], bool]] = {}
        self._task_xml_cache: dict[str, tuple[float, bytes]] = {}
        self._version_cache_ttl = _env_float("DOCFLOW_DM_VERSION_CACHE_TTL_SECONDS", 300.0)
        self._visible_cache_ttl = _env_float("DOCFLOW_DM_VISIBLE_CACHE_TTL_SECONDS", 45.0)
        self._task_cache_ttl = _env_float("DOCFLOW_DM_TASK_CACHE_TTL_SECONDS", 45.0)
        # Soft ceiling for related-document retrieve while enriching a card (files/targets).
        self._related_timeout = _env_float("DOCFLOW_DM_RELATED_TIMEOUT_SECONDS", 8.0, minimum=2.0, maximum=60.0)
        timeout = httpx.Timeout(
            connect=self._connect_timeout,
            read=self._read_timeout,
            write=self._write_timeout,
            pool=self._queue_timeout,
        )
        self._client = httpx.AsyncClient(
            verify=verify,
            transport=transport,
            timeout=timeout,
            trust_env=False,
            limits=httpx.Limits(max_connections=concurrency, max_keepalive_connections=concurrency),
            follow_redirects=False,
        )

    @staticmethod
    def _tls_context(ca_bundle: str) -> bool | str | ssl.SSLContext:
        if ca_bundle:
            return ca_bundle
        use_windows_store = str(
            os.getenv("DOCFLOW_DM_USE_WINDOWS_CERT_STORE", "1") or "1"
        ).strip().casefold() in {"1", "true", "yes", "on"}
        if sys.platform != "win32" or not use_windows_store:
            return True
        context = ssl.create_default_context(purpose=ssl.Purpose.SERVER_AUTH)
        certificates: list[str] = []
        for store_name in ("ROOT", "CA"):
            try:
                store_certificates = ssl.enum_certificates(store_name)
            except (OSError, AttributeError):
                continue
            for certificate, encoding, _trust in store_certificates:
                if encoding != "x509_asn":
                    continue
                try:
                    certificates.append(ssl.DER_cert_to_PEM_cert(certificate))
                except (ValueError, TypeError):
                    continue
        if certificates:
            context.load_verify_locations(cadata="\n".join(certificates))
        context.check_hostname = True
        context.verify_mode = ssl.CERT_REQUIRED
        return context

    async def aclose(self) -> None:
        await self._client.aclose()

    @asynccontextmanager
    async def _slot(self):
        with self._pending_lock:
            if self._pending >= self._queue_limit:
                raise Docflow1CUnavailableError("Очередь запросов к 1С заполнена")
            self._pending += 1
        try:
            try:
                await asyncio.wait_for(self._semaphore.acquire(), timeout=self._queue_timeout)
            except TimeoutError:
                raise Docflow1CUnavailableError("Истекло время ожидания очереди запросов к 1С") from None
            try:
                yield
            finally:
                self._semaphore.release()
        finally:
            with self._pending_lock:
                self._pending = max(0, self._pending - 1)

    @staticmethod
    def _envelope(request_type: str) -> tuple[etree._Element, etree._Element]:
        if request_type not in _REQUEST_TYPES:
            raise Docflow1CMappingError("Тип запроса DMService не разрешён")
        root = etree.Element(
            _qname(SOAP_NS, "Envelope"),
            nsmap={"soap": SOAP_NS, "tns": DM_NS, "xsi": XSI_NS, "xsd": XSD_NS},
        )
        body = etree.SubElement(root, _qname(SOAP_NS, "Body"))
        execute = etree.SubElement(body, _qname(DM_NS, "execute"))
        request = etree.SubElement(execute, _qname(DM_NS, "request"))
        request.set(_qname(XSI_NS, "type"), f"tns:{request_type}")
        return root, request

    @staticmethod
    def _parse_response(payload: bytes, *, allow_huge: bool = False) -> etree._Element:
        lowered = payload[:4096].lower()
        if b"<!doctype" in lowered or b"<!entity" in lowered:
            raise Docflow1CUnavailableError("DMService вернул небезопасный XML")
        parser = etree.XMLParser(
            resolve_entities=False,
            no_network=True,
            load_dtd=False,
            # File payloads embed multi‑MB base64 text nodes; normal SOAP stays restricted.
            huge_tree=bool(allow_huge),
            remove_comments=True,
            recover=False,
        )
        try:
            root = etree.fromstring(payload, parser=parser)
        except (etree.XMLSyntaxError, ValueError):
            raise Docflow1CUnavailableError("DMService вернул некорректный XML") from None
        if root.getroottree().docinfo.doctype:
            raise Docflow1CUnavailableError("DMService вернул XML с запрещённым DTD")
        body = _child(root, "Body")
        fault = _child(body, "Fault")
        if fault is not None:
            message = _text(fault, "faultstring", maximum=1000) or "DMService вернул SOAP Fault"
            raise DocflowDMServiceClient._remote_error(message)
        execute_response = _child(body, "executeResponse")
        returned = _child(execute_response, "return")
        if returned is None:
            raise Docflow1CUnavailableError("В ответе DMService отсутствует результат")
        if _xsi_type(returned) == "DMError" or _child(returned, "error") is not None:
            message = (
                _text(returned, "description", maximum=2000)
                or _text(returned, "message", maximum=2000)
                or _text(returned, "errorDescription", maximum=2000)
                or "DMService вернул ошибку"
            )
            raise DocflowDMServiceClient._remote_error(message)
        return returned

    @staticmethod
    def _remote_error(message: str) -> Exception:
        normalized = str(message or "").strip()[:2000]
        folded = normalized.casefold()
        if any(marker in folded for marker in ("электронн", "цифров", "подпис", "digital signature", "эцп", "эп ")):
            return Docflow1CDigitalSignatureRequiredError(normalized)
        if any(marker in folded for marker in ("аутентиф", "authentication", "неверн", "логин", "парол")):
            return Docflow1CAuthenticationError(normalized)
        if any(marker in folded for marker in ("не найден", "not found", "не существует")):
            return Docflow1CNotFoundError(normalized)
        if any(marker in folded for marker in ("изменен", "изменён", "конфликт", "уже выполн")):
            return Docflow1CConflictError(normalized)
        return Docflow1CUnavailableError(normalized or "DMService вернул ошибку")

    async def _execute(
        self,
        *,
        login: str,
        password: str,
        request_type: str,
        root: etree._Element,
        write: bool = False,
        file_response: bool = False,
    ) -> etree._Element:
        if request_type not in _REQUEST_TYPES:
            raise Docflow1CMappingError("Тип запроса DMService не разрешён")
        body = etree.tostring(root, encoding="utf-8", xml_declaration=True)
        timeout_seconds = self._file_timeout if file_response else (self._write_timeout if write else self._read_timeout)
        max_response_bytes = self._max_file_response_bytes if file_response else self._max_response_bytes
        timeout = httpx.Timeout(
            connect=self._connect_timeout,
            read=timeout_seconds,
            write=self._write_timeout,
            pool=self._queue_timeout,
        )
        response_status = 0
        response_payload = b""
        # #region agent log
        _dbg_t0 = time.perf_counter()
        # #endregion
        try:
            async with self._slot():
                async with self._client.stream(
                    "POST",
                    self.service_url,
                    content=body,
                    auth=httpx.BasicAuth(str(login or ""), str(password or "")),
                    headers={
                        "Content-Type": "text/xml; charset=utf-8",
                        "SOAPAction": SOAP_ACTION,
                        "Accept": "text/xml",
                    },
                    timeout=timeout,
                ) as response:
                    response_status = response.status_code
                    if response.status_code in {401, 403}:
                        raise Docflow1CAuthenticationError("Логин или пароль 1С не принят")
                    declared = response.headers.get("Content-Length")
                    if declared and int(declared) > max_response_bytes:
                        if file_response:
                            raise Docflow1CFileTooLargeError(
                                "Файл слишком большой для загрузки через DMService"
                            )
                        raise Docflow1CUnavailableError("Ответ DMService превышает допустимый размер")
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > max_response_bytes:
                            if file_response:
                                raise Docflow1CFileTooLargeError(
                                    "Файл слишком большой для загрузки через DMService"
                                )
                            raise Docflow1CUnavailableError("Ответ DMService превышает допустимый размер")
                        chunks.append(chunk)
                    response_payload = b"".join(chunks)
            # #region agent log
            try:
                with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                    _dbg_f.write(
                        json.dumps(
                            {
                                "sessionId": "b3272c",
                                "runId": "samkom-tyutev",
                                "hypothesisId": "HA",
                                "location": "docflow_dm_service_client.py:_execute",
                                "message": "soap_ok",
                                "data": {
                                    "request_type": request_type,
                                    "ms": int((time.perf_counter() - _dbg_t0) * 1000),
                                    "status": response_status,
                                    "bytes": len(response_payload),
                                    "file_response": bool(file_response),
                                    "timeout_s": float(timeout_seconds),
                                },
                                "timestamp": int(time.time() * 1000),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
        except (Docflow1CAuthenticationError, Docflow1CFileTooLargeError, Docflow1CUnavailableError):
            # #region agent log
            try:
                with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                    _dbg_f.write(
                        json.dumps(
                            {
                                "sessionId": "b3272c",
                                "runId": "samkom-tyutev",
                                "hypothesisId": "HA",
                                "location": "docflow_dm_service_client.py:_execute",
                                "message": "soap_domain_error",
                                "data": {
                                    "request_type": request_type,
                                    "ms": int((time.perf_counter() - _dbg_t0) * 1000),
                                    "status": response_status,
                                    "bytes": len(response_payload),
                                },
                                "timestamp": int(time.time() * 1000),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError) as _exc:
            # #region agent log
            try:
                with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                    _dbg_f.write(
                        json.dumps(
                            {
                                "sessionId": "b3272c",
                                "runId": "samkom-tyutev",
                                "hypothesisId": "HB",
                                "location": "docflow_dm_service_client.py:_execute",
                                "message": "soap_timeout_or_network",
                                "data": {
                                    "request_type": request_type,
                                    "ms": int((time.perf_counter() - _dbg_t0) * 1000),
                                    "exc_type": type(_exc).__name__,
                                    "timeout_s": float(timeout_seconds),
                                    "file_response": bool(file_response),
                                },
                                "timestamp": int(time.time() * 1000),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
            if write:
                raise Docflow1COutcomeUnknownError(
                    "DMService не подтвердил результат записи; команда не будет отправлена повторно"
                ) from None
            raise Docflow1CUnavailableError("DMService временно недоступен") from None
        except (ValueError, OverflowError):
            raise Docflow1CUnavailableError("DMService вернул некорректный размер ответа") from None
        if response_status >= 400:
            if response_payload:
                self._parse_response(response_payload)
            raise Docflow1CUnavailableError(f"DMService вернул HTTP {response_status}")
        if file_response and len(response_payload) >= 1024 * 1024:
            return await asyncio.to_thread(self._parse_response, response_payload, allow_huge=True)
        return self._parse_response(response_payload, allow_huge=bool(file_response))

    def _cache_login_key(self, login: str) -> str:
        return str(login or "").strip().casefold()

    def _cache_task_key(self, login: str, task_ref: str) -> str:
        return f"{self._cache_login_key(login)}::{str(task_ref or '').strip().casefold()}"

    def _get_version_cache(self, login: str) -> str | None:
        key = self._cache_login_key(login)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._version_cache.get(key)
            if hit and hit[0] > now:
                return hit[1]
            if hit:
                self._version_cache.pop(key, None)
        return None

    def _set_version_cache(self, login: str, version: str) -> None:
        key = self._cache_login_key(login)
        with self._cache_lock:
            self._version_cache[key] = (time.monotonic() + max(1.0, self._version_cache_ttl), str(version or ""))

    def _get_visible_type_cache(self, login: str) -> tuple[dict[str, str], bool] | None:
        key = self._cache_login_key(login)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._visible_type_cache.get(key)
            if hit and hit[0] > now:
                return dict(hit[1]), bool(hit[2])
            if hit:
                self._visible_type_cache.pop(key, None)
        return None

    def _set_visible_type_cache(self, login: str, type_map: dict[str, str], truncated: bool) -> None:
        key = self._cache_login_key(login)
        with self._cache_lock:
            self._visible_type_cache[key] = (
                time.monotonic() + max(1.0, self._visible_cache_ttl),
                dict(type_map),
                bool(truncated),
            )

    def _merge_visible_type_cache(self, login: str, type_map: dict[str, str], truncated: bool) -> None:
        """Merge freshly listed task types into the visibility cache without dropping prior ids."""
        existing = self._get_visible_type_cache(login)
        if existing is None:
            self._set_visible_type_cache(login, type_map, truncated)
            return
        merged, prior_truncated = existing
        merged.update(type_map)
        self._set_visible_type_cache(login, merged, bool(prior_truncated or truncated))

    @staticmethod
    def _type_map_from_objects(objects: Iterable[etree._Element]) -> dict[str, str]:
        return {
            _object_id(item).casefold(): (_object_type(item) or "DMBusinessProcessTask")
            for item in objects
            if _object_id(item)
        }

    def _get_task_xml_cache(self, login: str, task_ref: str) -> bytes | None:
        key = self._cache_task_key(login, task_ref)
        now = time.monotonic()
        with self._cache_lock:
            hit = self._task_xml_cache.get(key)
            if hit and hit[0] > now:
                return hit[1]
            if hit:
                self._task_xml_cache.pop(key, None)
        return None

    def _set_task_xml_cache(self, login: str, task_ref: str, payload: bytes) -> None:
        key = self._cache_task_key(login, task_ref)
        with self._cache_lock:
            self._task_xml_cache[key] = (time.monotonic() + max(1.0, self._task_cache_ttl), payload)

    def _invalidate_task_caches(self, login: str, task_ref: str | None = None) -> None:
        """Drop stale task XML. Keep the type map — wiping it forces a heavy withExecuted list."""
        login_key = self._cache_login_key(login)
        with self._cache_lock:
            if task_ref:
                self._task_xml_cache.pop(self._cache_task_key(login, task_ref), None)
                return
            self._visible_type_cache.pop(login_key, None)
            prefix = f"{login_key}::"
            for key in [cached for cached in self._task_xml_cache if cached.startswith(prefix)]:
                self._task_xml_cache.pop(key, None)

    async def get_version(self, *, login: str, password: str) -> str:
        cached = self._get_version_cache(login)
        if cached is not None:
            return cached
        root, _ = self._envelope("DMGetVersionRequest")
        returned = await self._execute(
            login=login, password=password, request_type="DMGetVersionRequest", root=root
        )
        version = _text(returned, "versionNumber", maximum=128)
        if version:
            self._set_version_cache(login, version)
        return version

    async def get_current_user(self, *, login: str, password: str) -> dict[str, str]:
        root, _ = self._envelope("DMGetCurrentUserRequest")
        returned = await self._execute(
            login=login, password=password, request_type="DMGetCurrentUserRequest", root=root
        )
        user = _child(returned, "user")
        return {"ref": _object_id(user), "name": _object_presentation(user)}

    async def get_settings(self, *, login: str, password: str) -> dict[str, bool]:
        root, _ = self._envelope("DMGetSettingsRequest")
        returned = await self._execute(
            login=login, password=password, request_type="DMGetSettingsRequest", root=root
        )
        return {
            "use_digital_signatures": _bool_text(returned, "useDigitalSignatures"),
            "need_extract_text": _bool_text(returned, "needExtractText"),
        }

    async def test_connection(self, *, login: str, password: str) -> dict[str, Any]:
        version, current_user, settings = await asyncio.gather(
            self.get_version(login=login, password=password),
            self.get_current_user(login=login, password=password),
            self.get_settings(login=login, password=password),
        )
        if not version or not current_user.get("ref"):
            raise Docflow1CAuthenticationError("DMService не определил текущего пользователя 1С")
        return {
            "connected": True,
            "configuration": str(os.getenv("DOCFLOW_1C_REF", "docflow") or "docflow"),
            "version": version,
            "current_user": current_user,
            "settings": settings,
            "verified_at": datetime.now(timezone.utc),
        }

    @staticmethod
    def _like_pattern(value: str) -> str:
        """Build a LIKE pattern for DMGetObjectList name search.

        DO 2.1 wraps with %…% only when comparisonOperator is omitted. When we send
        LIKE explicitly (needed for some handlers), the value must already include %.
        """
        text_value = str(value or "").strip()
        if not text_value:
            return text_value
        if "%" in text_value or "_" in text_value:
            return text_value
        return f"%{text_value}%"

    @staticmethod
    def _add_condition(query: etree._Element, property_name: str, value: str | bool, *, like: bool = False) -> None:
        condition = _add(query, "conditions")
        _add(condition, "property", property_name)
        if like and not isinstance(value, bool):
            value = DocflowDMServiceClient._like_pattern(str(value))
        value_node = _add(condition, "value", str(value).lower() if isinstance(value, bool) else value)
        value_node.set(_qname(XSI_NS, "type"), "xsd:boolean" if isinstance(value, bool) else "xsd:string")
        if like:
            _add(condition, "comparisonOperator", "LIKE")

    async def _object_list(
        self,
        *,
        login: str,
        password: str,
        object_type: str,
        conditions: Iterable[tuple[str, str | bool, bool]] = (),
        column_set: Iterable[str] = (),
    ) -> tuple[list[etree._Element], bool]:
        root, request = self._envelope("DMGetObjectListRequest")
        _add(request, "type", object_type)
        query = _add(request, "query")
        for property_name, value, like in conditions:
            self._add_condition(query, property_name, value, like=like)
        for column in column_set:
            _add(query, "columnSet", column)
        returned = await self._execute(
            login=login, password=password, request_type="DMGetObjectListRequest", root=root
        )
        objects: list[etree._Element] = []
        for item in _children(returned, "items"):
            nested = _child(item, "object")
            obj = nested if nested is not None else item
            if _object_id(obj):
                objects.append(obj)
        return objects, _bool_text(returned, "tooManyObjects")

    async def _retrieve(
        self,
        *,
        login: str,
        password: str,
        object_ids: Iterable[tuple[str, str]],
        column_set: Iterable[str] = (),
        file_response: bool = False,
    ) -> list[etree._Element]:
        root, request = self._envelope("DMRetrieveRequest")
        requested = 0
        for object_id, object_type in object_ids:
            if not object_id or not object_type:
                continue
            wrapper = _add(request, "objectIds")
            _add(wrapper, "id", object_id)
            _add(wrapper, "type", object_type)
            requested += 1
        if not requested:
            return []
        for column in column_set:
            _add(request, "columnSet", column)
        returned = await self._execute(
            login=login,
            password=password,
            request_type="DMRetrieveRequest",
            root=root,
            file_response=file_response,
        )
        return [item for item in _children(returned, "objects") if _object_id(item)]

    @staticmethod
    def _process_type(task: etree._Element) -> tuple[str, str, str, str]:
        process = _child(task, "parentBusinessProcess")
        raw_type = _object_type(process)
        label = _PROCESS_LABELS.get(raw_type, "")
        if not label:
            folded = raw_type.casefold()
            if "approval" in folded:
                label = "Согласование"
            elif "confirmation" in folded:
                label = "Утверждение"
            elif "acquaint" in folded or "consideration" in folded:
                label = "Ознакомление"
            elif "performance" in folded or "perfomance" in folded or "order" in folded:
                label = "Исполнение"
        return raw_type, label, _object_id(process), _object_presentation(process)

    @staticmethod
    def _result(task: etree._Element, *, process_label: str) -> str | None:
        comment = _text(task, "executionComment", maximum=2000)
        approval = _child(task, "approvalResult")
        confirmation = _child(task, "confirmationResult")
        invitation = _child(task, "invitationResult")
        result_node = approval if approval is not None else confirmation
        if result_node is None and invitation is not None and _object_id(invitation):
            result_node = invitation
        result_name = _object_presentation(result_node)
        compact = result_name.replace(" ", "").casefold()
        labels = {
            "согласовано": "Согласовано",
            "согласованосзамечаниями": "Согласовано с замечаниями",
            "несогласовано": "Не согласовано",
            "утверждено": "Утверждено",
            "неутверждено": "Не утверждено",
            "принято": "Принято",
            "непринято": "Не принято",
        }
        result = labels.get(compact, result_name)
        if result in {"Согласовано с замечаниями", "Не согласовано", "Не утверждено"} and comment:
            return f"{result}: {comment}"[:2000]
        if result:
            return result[:2000]
        if process_label == "Исполнение":
            return comment or None
        return comment or None

    def _open_in_1c_url(self, task: etree._Element) -> str | None:
        navigation = _navigation_ref(task)
        base = str(os.getenv("DOCFLOW_WEB_URL", "") or "").strip()
        if navigation.startswith(("https://", "http://")):
            return navigation
        if base and navigation:
            return urljoin(f"{base.rstrip('/')}/", navigation.lstrip("/"))
        return base or None

    def _parse_task(self, task: etree._Element) -> dict[str, Any]:
        raw_task_type = _object_type(task) or "DMBusinessProcessTask"
        process_raw_type, process_label, process_ref, process_name = self._process_type(task)
        title = _text(task, "target", maximum=2000) or _object_presentation(task) or "Задание 1С"
        if _child(task, "target") is not None:
            title = _object_presentation(_child(task, "target")) or title
        signature_required = any(
            _bool_text(task, name)
            for name in ("requiresDigitalSignature", "needDigitalSignature", "digitalSignatureRequired")
        )
        completed = _bool_text(task, "executed")
        return {
            "ref": _object_id(task),
            "task_type": "ЗадачаИсполнителя",
            "xdto_task_type": raw_task_type,
            "task_type_label": "Задание исполнителя",
            "title": title,
            "number": _text(task, "number", maximum=128) or None,
            "created_at": _date_text(task, "beginDate"),
            "due_at": _date_text(task, "dueDate"),
            "author": _object_presentation(_child(task, "author")) or None,
            "subject": _object_presentation(_child(task, "target")) or None,
            "description": _text(task, "description", maximum=10_000) or None,
            "result": self._result(task, process_label=process_label),
            "business_state": _object_presentation(_child(task, "state")) or _text(task, "businessProcessStep", maximum=500) or None,
            "importance": _object_presentation(_child(task, "importance")) or None,
            "accepted": _bool_text(task, "accepted"),
            "completed_at": _date_text(task, "endDate"),
            "completed": completed,
            "process_name": process_name or None,
            "process_ref": process_ref or None,
            "process_type": process_label or process_raw_type or None,
            "xdto_process_type": process_raw_type or None,
            "process_type_label": process_label or process_raw_type or None,
            "configuration_fingerprint": configuration_fingerprint(
                configuration=str(os.getenv("DOCFLOW_1C_REF", "docflow") or "docflow"),
                task_type="ЗадачаИсполнителя",
                process_type=process_label or process_raw_type,
            ) if (process_label or process_raw_type) else None,
            "requires_digital_signature": signature_required,
            "open_in_1c_url": self._open_in_1c_url(task),
        }

    async def list_tasks(
        self,
        *,
        login: str,
        password: str,
        scope: str = "inbox",
        search: str = "",
        limit: int = 50,
    ) -> dict[str, Any]:
        normalized_scope = scope if scope in {"inbox", "completed", "all"} else "inbox"
        # typed=false: abstract DMBusinessProcessTask rows are enough for the UI list.
        # typed=true inflates history lists until read-timeout (samkov: 1082 tasks / ~14MB).
        # Concrete XDTO types are resolved on DMRetrieve when a card is opened.
        conditions: list[tuple[str, str | bool, bool]] = [
            ("byUser", True, False),
            ("withExecuted", normalized_scope != "inbox", False),
            ("typed", False, False),
        ]
        normalized_search = str(search or "").strip()[:200]
        # Filter locally: DM `name` condition is too brittle for title/number/author search.
        objects, remote_truncated = await self._object_list(
            login=login,
            password=password,
            object_type="DMBusinessProcessTask",
            conditions=conditions,
        )
        # Warm visibility cache from the list we already paid for — avoids a second
        # DMGetObjectList (often withExecuted=true, multi‑MB) on every card open.
        self._merge_visible_type_cache(login, self._type_map_from_objects(objects), remote_truncated)
        items = [self._parse_task(item) for item in objects]
        if normalized_scope == "inbox":
            items = [item for item in items if not item["completed"]]
        elif normalized_scope == "completed":
            items = [item for item in items if item["completed"]]
        if normalized_search:
            tokens = [token for token in normalized_search.casefold().split() if token]
            if tokens:
                filtered = []
                for item in items:
                    haystack = " ".join(
                        str(item.get(key) or "")
                        for key in ("title", "number", "author", "subject", "description")
                    ).casefold()
                    if all(token in haystack for token in tokens):
                        filtered.append(item)
                items = filtered
        items.sort(key=lambda item: str(item.get("completed_at") or item.get("created_at") or ""), reverse=True)
        public_limit = max(1, min(200, int(limit or 50)))
        truncated = bool(remote_truncated or len(items) > public_limit)
        items = items[:public_limit]
        return {
            "items": items,
            "returned": len(items),
            "scope": normalized_scope,
            "source": "live_1c",
            "as_of": datetime.now(timezone.utc),
            "truncated": truncated,
        }

    async def _visible_task_element(self, *, login: str, password: str, task_ref: str) -> etree._Element:
        if not _UUID_RE.match(str(task_ref or "")):
            raise Docflow1CNotFoundError("Некорректная ссылка задания 1С")
        cached_xml = self._get_task_xml_cache(login, task_ref)
        if cached_xml is not None:
            try:
                cached_task = etree.fromstring(cached_xml)
            except etree.XMLSyntaxError:
                cached_task = None
            if cached_task is not None and _object_id(cached_task):
                # #region agent log
                try:
                    with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                        _dbg_f.write(
                            json.dumps(
                                {
                                    "sessionId": "b3272c",
                                    "runId": "samkom-tyutev",
                                    "hypothesisId": "HA",
                                    "location": "docflow_dm_service_client.py:_visible_task_element",
                                    "message": "task_xml_cache_hit",
                                    "data": {"task_ref": str(task_ref)[:80]},
                                    "timestamp": int(time.time() * 1000),
                                },
                                ensure_ascii=False,
                            )
                            + "\n"
                        )
                except Exception:
                    pass
                # #endregion
                return cached_task

        cached_types = self._get_visible_type_cache(login)
        type_map: dict[str, str] = dict(cached_types[0]) if cached_types is not None else {}
        truncated = bool(cached_types[1]) if cached_types is not None else False
        task_key = str(task_ref).casefold()
        object_type = type_map.get(task_key)
        # #region agent log
        try:
            with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                _dbg_f.write(
                    json.dumps(
                        {
                            "sessionId": "b3272c",
                            "runId": "samkom-tyutev",
                            "hypothesisId": "HA",
                            "location": "docflow_dm_service_client.py:_visible_task_element",
                            "message": "type_cache_lookup",
                            "data": {
                                "task_ref": str(task_ref)[:80],
                                "type_cache_hit": cached_types is not None,
                                "task_in_cache": bool(object_type),
                            },
                            "timestamp": int(time.time() * 1000),
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
        except Exception:
            pass
        # #endregion
        if not object_type:
            # Completed tasks leave inbox; probing known XDTO types is ~0.5s each and avoids
            # the multi‑MB withExecuted=true dump (~25s) used only as last resort.
            candidate_types: list[str] = []
            for spec in _ACTION_SPEC.values():
                for item in sorted(spec.get("task_types") or ()):
                    if item not in candidate_types:
                        candidate_types.append(str(item))
            if "DMBusinessProcessTask" not in candidate_types:
                candidate_types.append("DMBusinessProcessTask")
            for candidate in candidate_types:
                try:
                    probed = await self._retrieve(
                        login=login,
                        password=password,
                        object_ids=((task_ref, candidate),),
                    )
                except (Docflow1CNotFoundError, Docflow1CMappingError, Docflow1CUnavailableError):
                    continue
                if not probed:
                    continue
                concrete = _object_type(probed[0]) or candidate
                self._merge_visible_type_cache(login, {task_key: concrete}, truncated)
                # #region agent log
                try:
                    with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                        _dbg_f.write(
                            json.dumps(
                                {
                                    "sessionId": "b3272c",
                                    "runId": "measure-202-check",
                                    "hypothesisId": "H-TIME",
                                    "location": "docflow_dm_service_client.py:_visible_task_element",
                                    "message": "candidate_type_hit",
                                    "data": {
                                        "task_ref": str(task_ref)[:80],
                                        "candidate": candidate,
                                        "concrete": concrete,
                                    },
                                    "timestamp": int(time.time() * 1000),
                                },
                                ensure_ascii=False,
                            )
                            + "\n"
                        )
                except Exception:
                    pass
                # #endregion
                try:
                    self._set_task_xml_cache(login, task_ref, etree.tostring(probed[0], encoding="utf-8"))
                except Exception:
                    pass
                return probed[0]

            # Prefer the cheap inbox-sized list (~100KB) before the heavy withExecuted=true dump.
            for with_executed in (False, True):
                objects, list_truncated = await self._object_list(
                    login=login,
                    password=password,
                    object_type="DMBusinessProcessTask",
                    conditions=(
                        ("byUser", True, False),
                        ("withExecuted", with_executed, False),
                        ("typed", False, False),
                    ),
                )
                type_map.update(self._type_map_from_objects(objects))
                truncated = bool(truncated or list_truncated)
                self._merge_visible_type_cache(login, type_map, truncated)
                object_type = type_map.get(task_key)
                if object_type:
                    break

        if not object_type:
            if truncated:
                raise Docflow1CUnavailableError("Список заданий 1С усечён; принадлежность задания не подтверждена")
            raise Docflow1CNotFoundError("Задание не найдено или больше вам не доступно")
        retrieved = await self._retrieve(
            login=login,
            password=password,
            object_ids=((task_ref, object_type),),
        )
        if not retrieved:
            raise Docflow1CNotFoundError("Задание больше не доступно")
        concrete_type = _object_type(retrieved[0]) or object_type
        if concrete_type and concrete_type != object_type:
            self._merge_visible_type_cache(login, {task_key: concrete_type}, truncated)
        try:
            self._set_task_xml_cache(login, task_ref, etree.tostring(retrieved[0], encoding="utf-8"))
        except Exception:
            pass
        return retrieved[0]

    @staticmethod
    def _related_ids(task: etree._Element) -> list[tuple[str, str, str]]:
        related: list[tuple[str, str, str]] = []
        seen: set[str] = set()
        for collection_name in ("targets", "fillableTargets"):
            collection = _child(task, collection_name)
            for item in _descendants(collection, "target"):
                ref = _object_id(item)
                object_type = _object_type(item)
                if ref and object_type and ref.casefold() not in seen:
                    seen.add(ref.casefold())
                    related.append((ref, object_type, _object_presentation(item)))
        return related[:100]

    @staticmethod
    def _file_summary(candidate: etree._Element) -> dict[str, Any] | None:
        ref = _object_id(candidate)
        object_type = _object_type(candidate)
        if not ref or object_type != "DMFile":
            return None
        extension = _text(candidate, "extension", maximum=32) or _text(candidate, "activeVersionExtension", maximum=32)
        filename = _safe_filename(_object_presentation(candidate), extension)
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return {
            "ref": ref,
            "xdto_type": object_type,
            "name": filename,
            "extension": extension.casefold().lstrip(".") or Path(filename).suffix.casefold().lstrip("."),
            "content_type": content_type,
            "size": _integer_text(candidate, "size") or _integer_text(candidate, "activeVersionSize"),
            "created_at": _text(candidate, "creationDate", maximum=64) or None,
            "description": _text(candidate, "description", maximum=2000) or None,
            "preview_supported": _preview_supported(filename, content_type),
        }

    @classmethod
    def _file_summaries(cls, objects: Iterable[etree._Element]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for owner in objects:
            for files_node in _descendants(owner, "files"):
                for candidate in files_node.iter():
                    summary = cls._file_summary(candidate)
                    if summary is None or summary["ref"].casefold() in seen:
                        continue
                    seen.add(summary["ref"].casefold())
                    result.append(summary)
        return result

    async def _file_list_by_owner(
        self,
        *,
        login: str,
        password: str,
        owners: Iterable[tuple[str, str]],
    ) -> list[dict[str, Any]]:
        """DMGetFileListByOwnerRequest — file metadata without full document retrieve."""
        root, request = self._envelope("DMGetFileListByOwnerRequest")
        requested = 0
        for object_id, object_type in owners:
            if not object_id or not object_type:
                continue
            # WSDL DMObject sequence: name (nillable), objectID, ...
            owner = _add(request, "owners")
            owner.set(_qname(XSI_NS, "type"), "tns:DMObject")
            name_node = _add(owner, "name")
            name_node.set(_qname(XSI_NS, "nil"), "true")
            _add_object_id(
                owner,
                object_id=object_id,
                object_type=object_type,
                field_name="objectID",
            )
            requested += 1
        if not requested:
            return []
        for column in (
            "name",
            "extension",
            "size",
            "creationDate",
            "description",
            "activeVersionExtension",
            "activeVersionSize",
        ):
            _add(request, "columnSet", column)
        returned = await self._execute(
            login=login,
            password=password,
            request_type="DMGetFileListByOwnerRequest",
            root=root,
        )
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for candidate in _children(returned, "files"):
            summary = self._file_summary(candidate)
            if summary is None or summary["ref"].casefold() in seen:
                continue
            seen.add(summary["ref"].casefold())
            result.append(summary)
        return result

    async def get_task_detail(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        include_related: bool = True,
    ) -> dict[str, Any]:
        task = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        detail = self._parse_task(task)
        related_ids = self._related_ids(task)
        detail["related_objects"] = [
            {
                "ref": ref,
                "object_type": object_type,
                "object_type_label": object_type,
                "title": title or "Связанный объект 1С",
            }
            for ref, object_type, title in related_ids
        ]
        related_objects: list[etree._Element] = []
        related_partial = False
        if include_related and related_ids:
            detail["dm_version"] = await self.get_version(login=login, password=password)
            related_task = asyncio.create_task(
                self._retrieve(
                    login=login,
                    password=password,
                    object_ids=((ref, object_type) for ref, object_type, _ in related_ids),
                )
            )
            try:
                related_objects = await asyncio.wait_for(
                    related_task, timeout=float(self._related_timeout)
                )
            except TimeoutError:
                related_task.cancel()
                try:
                    await related_task
                except (asyncio.CancelledError, Exception):
                    pass
                related_objects = []
                related_partial = True
            except (Docflow1CUnavailableError, Docflow1CNotFoundError):
                related_objects = []
                related_partial = True
            if related_objects:
                detail["related_objects"] = [
                    {
                        "ref": ref,
                        "object_type": object_type,
                        "object_type_label": object_type,
                        "title": title or next(
                            (_object_presentation(item) for item in related_objects if _object_id(item) == ref),
                            "Связанный объект 1С",
                        ),
                    }
                    for ref, object_type, title in related_ids
                ]
            detail["files"] = self._file_summaries([task, *related_objects])
            # Prefer dedicated file-list-by-owner when retrieve omitted the files collection.
            if not detail["files"]:
                try:
                    owner_files = await asyncio.wait_for(
                        self._file_list_by_owner(
                            login=login,
                            password=password,
                            owners=((ref, object_type) for ref, object_type, _ in related_ids),
                        ),
                        timeout=float(self._related_timeout),
                    )
                    if owner_files:
                        detail["files"] = owner_files
                except TimeoutError:
                    related_partial = True
                except (Docflow1CUnavailableError, Docflow1CNotFoundError, Docflow1CMappingError):
                    related_partial = True
            # #region agent log
            try:
                with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                    _dbg_f.write(
                        json.dumps(
                            {
                                "sessionId": "b3272c",
                                "runId": "opt-postfix",
                                "hypothesisId": "HD",
                                "location": "docflow_dm_service_client.py:get_task_detail",
                                "message": "enrich_files",
                                "data": {
                                    "task_ref": str(task_ref)[:80],
                                    "related_ids": len(related_ids),
                                    "related_retrieved": len(related_objects),
                                    "related_partial": related_partial,
                                    "files": len(detail.get("files") or []),
                                },
                                "timestamp": int(time.time() * 1000),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
        else:
            detail["dm_version"] = await self.get_version(login=login, password=password)
            detail["files"] = self._file_summaries([task])
        if related_partial:
            detail["files_incomplete"] = True
        return detail

    async def get_task_state(self, *, login: str, password: str, task_ref: str) -> dict[str, Any]:
        task = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        detail = self._parse_task(task)
        detail["dm_version"] = await self.get_version(login=login, password=password)
        return detail

    async def metadata(self, *, login: str, password: str) -> dict[str, Any]:
        version = await self.get_version(login=login, password=password)
        return {
            "configuration": str(os.getenv("DOCFLOW_1C_REF", "docflow") or "docflow"),
            "version": version,
            "task_types": [{"name": "ЗадачаИсполнителя", "label": "Задание исполнителя", "attributes": []}],
            "process_types": [
                {"name": name, "label": name, "attributes": []}
                for name in ("Ознакомление", "Согласование", "Утверждение", "Исполнение")
            ],
            "active_task_type": "ЗадачаИсполнителя",
            "mapping_ready": version == SUPPORTED_DM_VERSION,
        }

    @staticmethod
    def _replace_child(parent: etree._Element, name: str, new_child: etree._Element | None = None, value: str | None = None) -> None:
        existing = _child(parent, name)
        insertion_index = parent.index(existing) if existing is not None else len(parent)
        if existing is not None:
            parent.remove(existing)
        if new_child is None:
            new_child = etree.Element(_qname(DM_NS, name))
            if value is not None:
                new_child.text = value
        parent.insert(insertion_index, new_child)

    @staticmethod
    def _result_node(field: str, object_type: str, object_id: str, name: str) -> etree._Element:
        node = etree.Element(_qname(DM_NS, field))
        node.set(_qname(XSI_NS, "type"), f"tns:{object_type}")
        _add(node, "name", name)
        _add_object_id(node, object_id=object_id, object_type=object_type, presentation=name)
        return node

    async def _accept_task(self, *, login: str, password: str, task: etree._Element) -> None:
        root, request = self._envelope("DMAcceptTasksRequest")
        accepted = copy.deepcopy(task)
        accepted.tag = _qname(DM_NS, "tasks")
        _normalize_xsi_type_prefixes(accepted)
        request.append(accepted)
        await self._execute(
            login=login,
            password=password,
            request_type="DMAcceptTasksRequest",
            root=root,
            write=True,
        )

    async def _retrieve_known_task(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        object_type: str,
    ) -> etree._Element:
        """Re-read a task we already authorized, without another GetObjectList."""
        normalized_type = str(object_type or "").strip() or "DMBusinessProcessTask"
        self._merge_visible_type_cache(login, {str(task_ref).casefold(): normalized_type}, False)
        retrieved = await self._retrieve(
            login=login,
            password=password,
            object_ids=((task_ref, normalized_type),),
        )
        if not retrieved:
            raise Docflow1CNotFoundError("Задание больше не доступно")
        try:
            self._set_task_xml_cache(login, task_ref, etree.tostring(retrieved[0], encoding="utf-8"))
        except Exception:
            pass
        return retrieved[0]

    async def apply_task_action(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        action: str,
        result_template: str = "",
        comment: str = "",
        result_field: str = "",
        result_object_id: str = "",
    ) -> dict[str, Any]:
        if self._insecure_http and str(
            os.getenv("DOCFLOW_DM_ALLOW_INSECURE_WRITES", "0") or "0"
        ).strip().casefold() not in {"1", "true", "yes", "on"}:
            raise Docflow1CMappingError("Запись через DMService заблокирована до включения HTTPS")
        normalized_action = str(action or "").strip().casefold()
        spec = _ACTION_SPEC.get(normalized_action)
        if spec is None:
            raise Docflow1CMappingError("Действие DMService не разрешено")
        if await self.get_version(login=login, password=password) != SUPPORTED_DM_VERSION:
            raise Docflow1CMappingError("Версия 1С изменилась; действия заблокированы до проверки allowlist")
        self._invalidate_task_caches(login, task_ref)
        before_element = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        before = self._parse_task(before_element)
        if before["completed"]:
            raise Docflow1CConflictError("Задание уже выполнено")
        task_type = _object_type(before_element)
        if task_type not in set(spec.get("task_types") or ()):
            raise Docflow1CMappingError("Тип задания не разрешён для выбранного действия")
        # Remember type so post-write re-reads never fall back to withExecuted=true dump.
        self._merge_visible_type_cache(login, {str(task_ref).casefold(): task_type}, False)
        normalized_comment = str(comment or "").strip()[:2000]
        if normalized_action in {"approve_with_comments", "reject", "complete"} and not normalized_comment:
            raise Docflow1CConflictError("Для выбранного действия требуется комментарий")
        if not before.get("accepted"):
            await self._accept_task(login=login, password=password, task=before_element)
            self._invalidate_task_caches(login, task_ref)
            before_element = await self._retrieve_known_task(
                login=login,
                password=password,
                task_ref=task_ref,
                object_type=task_type,
            )
            if not self._parse_task(before_element).get("accepted"):
                raise Docflow1CConflictError("1С не подтвердила принятие задания")

        updated = copy.deepcopy(before_element)
        _normalize_xsi_type_prefixes(updated)
        self._replace_child(updated, "executed", value="true")
        if (
            normalized_action == "acknowledge"
            and task_type == "DMBusinessProcessApprovalTaskCheckup"
        ):
            # This UI action means acknowledgement only. Never forward a stale
            # XDTO flag that would restart the approval process in 1C.
            self._replace_child(updated, "returned", value="false")
        if normalized_comment:
            self._replace_child(updated, "executionComment", value=normalized_comment)
        if normalized_action == "approve":
            values = spec["confirmation"] if task_type == "DMBusinessProcessConfirmationTaskConfirmation" else spec["approval"]
            field, object_type, object_id, name = values
            if result_field and result_field != field:
                raise Docflow1CMappingError("Поле результата не соответствует allowlist")
            self._replace_child(
                updated,
                field,
                new_child=self._result_node(
                    field,
                    object_type,
                    str(result_object_id or object_id),
                    name,
                ),
            )
        elif normalized_action in {
            "approve_with_comments",
            "accept_invitation",
            "decline_invitation",
        }:
            field = str(spec["field"])
            if result_field and result_field != field:
                raise Docflow1CMappingError("Поле результата не соответствует allowlist")
            self._replace_child(
                updated,
                field,
                new_child=self._result_node(
                    field,
                    str(spec["object_type"]),
                    str(result_object_id or spec["object_id"]),
                    str(spec["name"]),
                ),
            )
        elif normalized_action == "reject":
            process_type = str(before.get("process_type") or "")
            values = spec["confirmation"] if process_type == "Утверждение" else spec["approval"]
            field, object_type, object_id, name = values
            if result_field and result_field != field:
                raise Docflow1CMappingError("Поле результата не соответствует allowlist")
            self._replace_child(
                updated,
                field,
                new_child=self._result_node(field, object_type, result_object_id or object_id, name),
            )

        root, request = self._envelope("DMUpdateRequest")
        updated.tag = _qname(DM_NS, "objects")
        request.append(updated)
        await self._execute(
            login=login,
            password=password,
            request_type="DMUpdateRequest",
            root=root,
            write=True,
        )
        self._invalidate_task_caches(login, task_ref)
        # 1С may commit the update a moment after DMUpdate returns; retry retrieve
        # before declaring state_unknown (samkov approve: completed_at matched write,
        # but the first confirmation read returned 202/state_unknown).
        after: dict[str, Any] | None = None
        for attempt in range(3):
            if attempt:
                await asyncio.sleep(0.45 * attempt)
            after_element = await self._retrieve_known_task(
                login=login,
                password=password,
                task_ref=task_ref,
                object_type=task_type,
            )
            after = self._parse_task(after_element)
            # #region agent log
            try:
                with open(r"c:\Project\Image_scan\debug-b3272c.log", "a", encoding="utf-8") as _dbg_f:
                    _dbg_f.write(
                        json.dumps(
                            {
                                "sessionId": "b3272c",
                                "runId": "stuck-approve",
                                "hypothesisId": "H4",
                                "location": "docflow_dm_service_client.py:apply_task_action",
                                "message": "post_update_retrieve",
                                "data": {
                                    "task_ref": str(task_ref)[:80],
                                    "attempt": attempt + 1,
                                    "completed": bool(after.get("completed")),
                                    "has_completed_at": bool(after.get("completed_at")),
                                    "accepted": bool(after.get("accepted")),
                                },
                                "timestamp": int(time.time() * 1000),
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
            except Exception:
                pass
            # #endregion
            if after["completed"] and after.get("completed_at"):
                return {"before": before, "task": after}
        raise Docflow1COutcomeUnknownError("1С не подтвердила завершение задания")

    async def _document_context(
        self, *, login: str, password: str, task_ref: str
    ) -> tuple[dict[str, Any], list[etree._Element]]:
        task = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        related_ids = self._related_ids(task)
        related = await self._retrieve(
            login=login,
            password=password,
            object_ids=((ref, object_type) for ref, object_type, _ in related_ids),
        ) if related_ids else []
        detail = self._parse_task(task)
        detail["files"] = self._file_summaries([task, *related])
        if not detail["files"] and related_ids:
            try:
                detail["files"] = await self._file_list_by_owner(
                    login=login,
                    password=password,
                    owners=((ref, object_type) for ref, object_type, _ in related_ids),
                )
            except (Docflow1CUnavailableError, Docflow1CNotFoundError, Docflow1CMappingError):
                pass
        return detail, related

    async def export_file(
        self, *, login: str, password: str, task_ref: str, file_ref: str
    ) -> dict[str, Any]:
        detail, _ = await self._document_context(login=login, password=password, task_ref=task_ref)
        summary = next(
            (item for item in detail.get("files", []) if str(item.get("ref") or "").casefold() == file_ref.casefold()),
            None,
        )
        if summary is None:
            raise Docflow1CNotFoundError("Файл не связан с этим заданием")
        declared_size = int(summary.get("size") or 0)
        if declared_size > self._max_file_bytes:
            raise Docflow1CFileTooLargeError("Файл превышает допустимый размер")
        objects = await self._retrieve(
            login=login,
            password=password,
            object_ids=((file_ref, str(summary.get("xdto_type") or "DMFile")),),
            column_set=("name", "extension", "size", "binaryData"),
            file_response=True,
        )
        if not objects:
            raise Docflow1CNotFoundError("Файл больше не доступен")
        file_object = objects[0]
        size = _integer_text(file_object, "size") or int(summary.get("size") or 0)
        if size > self._max_file_bytes:
            raise Docflow1CFileTooLargeError("Файл превышает допустимый размер")
        binary_node = _child(file_object, "binaryData")
        encoded = re.sub(r"\s+", "", str(binary_node.text or "")) if binary_node is not None else ""
        if not encoded:
            raise Docflow1CFileStorageUnavailableError("DMService не вернул содержимое файла")
        filename = _safe_filename(
            _object_presentation(file_object) or str(summary.get("name") or "Файл 1С"),
            _text(file_object, "extension", maximum=32) or str(summary.get("extension") or ""),
        )
        root = docflow_export_root()
        root.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix="docflow-dm-", suffix=Path(filename).suffix, dir=str(root))
        written = 0
        carry = ""
        try:
            with os.fdopen(fd, "wb") as output:
                for offset in range(0, len(encoded), 256 * 1024):
                    carry += encoded[offset:offset + 256 * 1024]
                    usable = len(carry) - (len(carry) % 4)
                    if not usable:
                        continue
                    chunk, carry = carry[:usable], carry[usable:]
                    decoded = base64.b64decode(chunk, validate=True)
                    written += len(decoded)
                    if written > self._max_file_bytes:
                        raise Docflow1CFileTooLargeError("Файл превышает допустимый размер")
                    output.write(decoded)
                if carry:
                    decoded = base64.b64decode(carry, validate=True)
                    written += len(decoded)
                    output.write(decoded)
        except (binascii.Error, ValueError):
            Path(temporary_name).unlink(missing_ok=True)
            raise Docflow1CUnavailableError("DMService вернул повреждённое содержимое файла") from None
        except Exception:
            Path(temporary_name).unlink(missing_ok=True)
            raise
        if size and written != size:
            Path(temporary_name).unlink(missing_ok=True)
            raise Docflow1CUnavailableError("Размер файла из DMService не совпал с метаданными")
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return {
            "temporary_path": temporary_name,
            "name": filename,
            "content_type": content_type,
            "size": written,
        }

    async def search_assignment_documents(
        self, *, login: str, password: str, search: str = "", limit: int = 20
    ) -> dict[str, Any]:
        query = str(search or "").strip()[:200]
        as_of = datetime.now(timezone.utc)
        public_limit = max(1, min(50, int(limit or 20)))
        # Empty/short q must not trigger three unfiltered DMGetObjectList calls (read timeout).
        if len(query) < 3:
            return {
                "items": [],
                "returned": 0,
                "truncated": False,
                "reason": "Введите не менее 3 символов для поиска документов.",
                "as_of": as_of,
            }

        async def _search_type(
            document_type: str, xdto_type: str, label: str
        ) -> tuple[str, str, list[etree._Element], bool, BaseException | None]:
            try:
                objects, too_many = await self._object_list(
                    login=login,
                    password=password,
                    object_type=xdto_type,
                    conditions=(("name", query, True),),
                )
                return document_type, label, objects, too_many, None
            except Exception as exc:  # noqa: BLE001 — fail-soft per document type
                return document_type, label, [], False, exc

        results = await asyncio.gather(
            *[
                _search_type(document_type, xdto_type, label)
                for document_type, (xdto_type, label) in _DOCUMENT_TYPES.items()
            ]
        )
        items: list[dict[str, Any]] = []
        truncated = False
        errors: list[BaseException] = []
        for document_type, label, objects, too_many, error in results:
            if error is not None:
                errors.append(error)
                continue
            truncated = truncated or too_many
            for item in objects:
                items.append(
                    {
                        "ref": _object_id(item),
                        "document_type": document_type,
                        "document_type_label": label,
                        "title": _object_presentation(item) or "Документ 1С",
                        "number": _text(item, "number", maximum=128) or None,
                        "date": _text(item, "date", maximum=64) or None,
                    }
                )
        if not items and errors and len(errors) == len(results):
            raise errors[0]
        truncated = truncated or len(items) > public_limit
        reason = None
        if truncated and not items:
            reason = "Слишком много совпадений в 1С — уточните название или номер документа."
        elif truncated:
            reason = "Показаны первые результаты — уточните поиск, если нужного документа нет в списке."
        elif not items and not errors:
            reason = "Документы не найдены — уточните название или номер."
        elif errors and items:
            reason = "Часть типов документов недоступна; показаны найденные результаты."
        return {
            "items": items[:public_limit],
            "returned": min(len(items), public_limit),
            "truncated": truncated,
            "reason": reason,
            "as_of": as_of,
        }

    async def search_assignment_assignees(
        self, *, login: str, password: str, search: str = "", limit: int = 20
    ) -> dict[str, Any]:
        query = str(search or "").strip()[:200]
        conditions = (("name", query, True),) if query else ()
        objects, too_many = await self._object_list(
            login=login, password=password, object_type="DMUser", conditions=conditions
        )
        public_limit = max(1, min(50, int(limit or 20)))
        items = [
            {
                "ref": _object_id(item),
                "name": _object_presentation(item) or "Пользователь 1С",
                "department": _object_presentation(_child(item, "department")) or None,
            }
            for item in objects
        ]
        truncated = bool(too_many or len(items) > public_limit)
        reason = None
        if truncated:
            reason = "Показаны первые результаты — уточните ФИО, если нужного пользователя нет в списке."
        return {
            "items": items[:public_limit],
            "returned": min(len(items), public_limit),
            "truncated": truncated,
            "reason": reason,
            "as_of": datetime.now(timezone.utc),
        }

    async def get_assignment_state(
        self, *, login: str, password: str, process_ref: str
    ) -> dict[str, Any]:
        objects = await self._retrieve(
            login=login,
            password=password,
            object_ids=((process_ref, "DMBusinessProcessOrder"),),
        )
        if not objects:
            return {"exists": False, "process_ref": process_ref}
        process = objects[0]
        task_ref = next((_object_id(item) for item in _descendants(process, "tasks") if _object_id(item)), "")
        return {
            "exists": True,
            "process_ref": _object_id(process) or process_ref,
            "task_ref": task_ref or None,
            "title": _object_presentation(process) or "Поручение 1С",
            "state": _object_presentation(_child(process, "state")) or None,
            "task_completed": _bool_text(_child(process, "tasks"), "executed") if task_ref else None,
        }

    async def create_assignment(
        self,
        *,
        login: str,
        password: str,
        process_ref: str,
        document_type: str,
        document_ref: str,
        assignee_ref: str,
        controller_ref: str = "",
        due_at: str,
        importance: str = "normal",
        title: str,
        description: str,
    ) -> dict[str, Any]:
        if self._insecure_http and str(
            os.getenv("DOCFLOW_DM_ALLOW_INSECURE_WRITES", "0") or "0"
        ).strip().casefold() not in {"1", "true", "yes", "on"}:
            raise Docflow1CMappingError("Создание через DMService заблокировано до включения HTTPS")
        if await self.get_version(login=login, password=password) != SUPPORTED_DM_VERSION:
            raise Docflow1CMappingError("Версия 1С изменилась; создание поручений заблокировано")
        if document_type not in _DOCUMENT_TYPES:
            raise Docflow1CMappingError("Тип документа не разрешён")
        for value in (process_ref, document_ref, assignee_ref):
            if not _UUID_RE.match(str(value or "")):
                raise Docflow1CMappingError("Некорректная ссылка объекта 1С")
        root, request = self._envelope("DMUpdateRequest")
        process = _add(request, "objects")
        process.set(_qname(XSI_NS, "type"), "tns:DMBusinessProcessOrder")
        _add(process, "name", str(title or "")[:200])
        _add_object_id(process, object_id=process_ref, object_type="DMBusinessProcessOrder", presentation=str(title or "")[:200])
        _add(process, "description", str(description or "")[:2000])
        _add(process, "dueDate", due_at)
        if importance == "high":
            importance_node = _add(process, "importance")
            _add(importance_node, "name", "Высокая")
            _add_object_id(
                importance_node,
                object_id="Высокая",
                object_type="DMBusinessProcessImportance",
                presentation="Высокая",
            )
        performer = _add(process, "performer")
        user = _add(performer, "user")
        _add_object_id(user, object_id=assignee_ref, object_type="DMUser")
        if controller_ref:
            controller = _add(process, "controller")
            controller_user = _add(controller, "user")
            _add_object_id(controller_user, object_id=controller_ref, object_type="DMUser")
        targets = _add(process, "targets")
        target_item = _add(targets, "items")
        target = _add(target_item, "target")
        _add_object_id(target, object_id=document_ref, object_type=_DOCUMENT_TYPES[document_type][0])
        updated_response = await self._execute(
            login=login,
            password=password,
            request_type="DMUpdateRequest",
            root=root,
            write=True,
        )
        returned_process = next(
            (item for item in _children(updated_response, "objects") if _object_id(item)),
            process,
        )
        launch_root, launch_request = self._envelope("DMLaunchBusinessProcessRequest")
        launch_process = copy.deepcopy(returned_process)
        launch_process.tag = _qname(DM_NS, "businessProcess")
        launch_request.append(launch_process)
        await self._execute(
            login=login,
            password=password,
            request_type="DMLaunchBusinessProcessRequest",
            root=launch_root,
            write=True,
        )
        state = await self.get_assignment_state(login=login, password=password, process_ref=process_ref)
        if not state.get("exists"):
            raise Docflow1COutcomeUnknownError("1С не подтвердила создание поручения")
        return state
