"""Async, allowlisted client for the standard 1C Document Management DMService."""
from __future__ import annotations

import asyncio
import base64
import binascii
import copy
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
    "reject": {
        "task_types": {
            "DMBusinessProcessApprovalTaskApproval",
            "DMBusinessProcessConfirmationTaskConfirmation",
        },
        "approval": ("approvalResult", "DMApprovalResult", "НеСогласовано", "Не согласовано"),
        "confirmation": ("confirmationResult", "DMConfirmationResult", "НеУтверждено", "Не утверждено"),
    },
    "acknowledge": {
        "task_types": {"DMBusinessProcessConsiderationTaskAcquaint", "DMBusinessProcessTask"},
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
        concurrency = _env_int("DOCFLOW_DM_MAX_CONCURRENCY", 16, minimum=1, maximum=64)
        self._queue_limit = _env_int("DOCFLOW_DM_QUEUE_LIMIT", 64, minimum=1, maximum=1000)
        self._semaphore = asyncio.Semaphore(concurrency)
        self._pending_lock = threading.Lock()
        self._pending = 0
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
    def _parse_response(payload: bytes) -> etree._Element:
        lowered = payload[:4096].lower()
        if b"<!doctype" in lowered or b"<!entity" in lowered:
            raise Docflow1CUnavailableError("DMService вернул небезопасный XML")
        parser = etree.XMLParser(
            resolve_entities=False,
            no_network=True,
            load_dtd=False,
            huge_tree=False,
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
        timeout = httpx.Timeout(
            connect=self._connect_timeout,
            read=timeout_seconds,
            write=self._write_timeout,
            pool=self._queue_timeout,
        )
        response_status = 0
        response_payload = b""
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
                    if declared and int(declared) > self._max_response_bytes:
                        raise Docflow1CUnavailableError("Ответ DMService превышает допустимый размер")
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > self._max_response_bytes:
                            raise Docflow1CUnavailableError("Ответ DMService превышает допустимый размер")
                        chunks.append(chunk)
                    response_payload = b"".join(chunks)
        except Docflow1CAuthenticationError:
            raise
        except Docflow1CUnavailableError:
            raise
        except (httpx.TimeoutException, httpx.NetworkError, httpx.RemoteProtocolError):
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
        return self._parse_response(response_payload)

    async def get_version(self, *, login: str, password: str) -> str:
        root, _ = self._envelope("DMGetVersionRequest")
        returned = await self._execute(
            login=login, password=password, request_type="DMGetVersionRequest", root=root
        )
        return _text(returned, "versionNumber", maximum=128)

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
    def _add_condition(query: etree._Element, property_name: str, value: str | bool, *, like: bool = False) -> None:
        condition = _add(query, "conditions")
        _add(condition, "property", property_name)
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
        result_node = approval if approval is not None else confirmation
        result_name = _object_presentation(result_node)
        compact = result_name.replace(" ", "").casefold()
        labels = {
            "согласовано": "Согласовано",
            "согласованосзамечаниями": "Согласовано с замечаниями",
            "несогласовано": "Не согласовано",
            "утверждено": "Утверждено",
            "неутверждено": "Не утверждено",
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
        conditions: list[tuple[str, str | bool, bool]] = [
            ("byUser", True, False),
            ("withExecuted", normalized_scope != "inbox", False),
            ("typed", True, False),
        ]
        normalized_search = str(search or "").strip()[:200]
        if normalized_search:
            conditions.append(("name", normalized_search, True))
        objects, remote_truncated = await self._object_list(
            login=login,
            password=password,
            object_type="DMBusinessProcessTask",
            conditions=conditions,
        )
        items = [self._parse_task(item) for item in objects]
        if normalized_scope == "inbox":
            items = [item for item in items if not item["completed"]]
        elif normalized_scope == "completed":
            items = [item for item in items if item["completed"]]
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
        objects, truncated = await self._object_list(
            login=login,
            password=password,
            object_type="DMBusinessProcessTask",
            conditions=(("byUser", True, False), ("withExecuted", True, False), ("typed", True, False)),
        )
        visible = next((item for item in objects if _object_id(item).casefold() == task_ref.casefold()), None)
        if visible is None:
            if truncated:
                raise Docflow1CUnavailableError("Список заданий 1С усечён; принадлежность задания не подтверждена")
            raise Docflow1CNotFoundError("Задание не найдено или больше вам не доступно")
        retrieved = await self._retrieve(
            login=login,
            password=password,
            object_ids=((task_ref, _object_type(visible) or "DMBusinessProcessTask"),),
        )
        if not retrieved:
            raise Docflow1CNotFoundError("Задание больше не доступно")
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
    def _file_summaries(objects: Iterable[etree._Element]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        seen: set[str] = set()
        for owner in objects:
            for files_node in _descendants(owner, "files"):
                for candidate in files_node.iter():
                    ref = _object_id(candidate)
                    object_type = _object_type(candidate)
                    if not ref or object_type != "DMFile" or ref.casefold() in seen:
                        continue
                    seen.add(ref.casefold())
                    extension = _text(candidate, "extension", maximum=32) or _text(candidate, "activeVersionExtension", maximum=32)
                    filename = _safe_filename(_object_presentation(candidate), extension)
                    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                    result.append(
                        {
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
                    )
        return result

    async def get_task_detail(self, *, login: str, password: str, task_ref: str) -> dict[str, Any]:
        task = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        detail = self._parse_task(task)
        detail["dm_version"] = await self.get_version(login=login, password=password)
        related_ids = self._related_ids(task)
        related_objects = await self._retrieve(
            login=login,
            password=password,
            object_ids=((ref, object_type) for ref, object_type, _ in related_ids),
        ) if related_ids else []
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
        before_element = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        before = self._parse_task(before_element)
        if before["completed"]:
            raise Docflow1CConflictError("Задание уже выполнено")
        task_type = _object_type(before_element)
        if task_type not in set(spec.get("task_types") or ()):
            raise Docflow1CMappingError("Тип задания не разрешён для выбранного действия")
        normalized_comment = str(comment or "").strip()[:2000]
        if normalized_action in {"approve_with_comments", "reject", "complete"} and not normalized_comment:
            raise Docflow1CConflictError("Для выбранного действия требуется комментарий")
        if not before.get("accepted"):
            await self._accept_task(login=login, password=password, task=before_element)
            before_element = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
            if not self._parse_task(before_element).get("accepted"):
                raise Docflow1CConflictError("1С не подтвердила принятие задания")

        updated = copy.deepcopy(before_element)
        _normalize_xsi_type_prefixes(updated)
        self._replace_child(updated, "executed", value="true")
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
        elif normalized_action == "approve_with_comments":
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
        after_element = await self._visible_task_element(login=login, password=password, task_ref=task_ref)
        after = self._parse_task(after_element)
        if not after["completed"] or not after.get("completed_at"):
            raise Docflow1COutcomeUnknownError("1С не подтвердила завершение задания")
        return {"before": before, "task": after}

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
        if int(summary.get("size") or 0) > self._max_file_bytes:
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
        items: list[dict[str, Any]] = []
        truncated = False
        query = str(search or "").strip()[:200]
        for document_type, (xdto_type, label) in _DOCUMENT_TYPES.items():
            conditions = (("name", query, True),) if query else ()
            objects, too_many = await self._object_list(
                login=login, password=password, object_type=xdto_type, conditions=conditions
            )
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
        public_limit = max(1, min(50, int(limit or 20)))
        truncated = truncated or len(items) > public_limit
        return {
            "items": items[:public_limit],
            "returned": min(len(items), public_limit),
            "truncated": truncated,
            "as_of": datetime.now(timezone.utc),
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
        return {
            "items": items[:public_limit],
            "returned": min(len(items), public_limit),
            "truncated": bool(too_many or len(items) > public_limit),
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
