"""Strict typed COM client for personal 1C Document Management sessions."""
from __future__ import annotations

import os
import re
import base64
import binascii
import hashlib
import hmac
import mimetypes
import secrets
import tempfile
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path, PureWindowsPath
from typing import Any

from backend.services.docflow_action_rules import configuration_fingerprint


DEFAULT_DOCFLOW_SERVER = "tmn-srv-1c-01.zsgp.corp,tmn-srv-1c-02.zsgp.corp"
DEFAULT_DOCFLOW_REF = "docflow"
ASSIGNMENT_DOCUMENT_TYPES = {
    "internal": "ВнутренниеДокументы",
    "incoming": "ВходящиеДокументы",
    "outgoing": "ИсходящиеДокументы",
}
_IDENTIFIER_RE = re.compile(r"^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]{0,127}$")
_DOCFLOW_NETWORK_CONNECTION_LOCK = threading.RLock()
_DOCFLOW_CONNECTED_SHARES: set[str] = set()


class Docflow1CError(RuntimeError):
    code = "DOCFLOW_1C_ERROR"


class Docflow1CAuthenticationError(Docflow1CError):
    code = "DOCFLOW_AUTH_INVALID"


class Docflow1CUnavailableError(Docflow1CError):
    code = "DOCFLOW_1C_UNAVAILABLE"


class Docflow1CMappingError(Docflow1CError):
    code = "DOCFLOW_MAPPING_REQUIRED"


class Docflow1CNotFoundError(Docflow1CError):
    code = "DOCFLOW_NOT_FOUND"


class Docflow1CConflictError(Docflow1CError):
    code = "DOCFLOW_STATE_CONFLICT"


class Docflow1COutcomeUnknownError(Docflow1CError):
    code = "DOCFLOW_OUTCOME_UNKNOWN"


class Docflow1CFileTooLargeError(Docflow1CError):
    code = "DOCFLOW_FILE_TOO_LARGE"


class Docflow1CFileStorageUnavailableError(Docflow1CError):
    code = "DOCFLOW_FILE_STORAGE_UNAVAILABLE"


class Docflow1CDigitalSignatureRequiredError(Docflow1CError):
    code = "DOCFLOW_DIGITAL_SIGNATURE_REQUIRED"


_TASK_ACTION_STATE_FIELDS = (
    "ref",
    "task_type",
    "process_ref",
    "process_type",
    "business_state",
    "result",
    "accepted",
    "completed",
    "completed_at",
)


def _task_action_state_matches(before: dict[str, Any], after: dict[str, Any]) -> bool:
    """Return true only when a post-error read proves the write was rolled back."""

    return all(before.get(field) == after.get(field) for field in _TASK_ACTION_STATE_FIELDS)


def _text(value: Any, *, maximum: int = 500) -> str:
    return str(value or "").strip()[:maximum]


def _quote_connection_value(value: str) -> str:
    return str(value or "").replace('"', '""')


def _docflow_server_candidates() -> tuple[str, ...]:
    configured = _text(os.getenv("DOCFLOW_1C_SERVER") or DEFAULT_DOCFLOW_SERVER, maximum=512)
    candidates: list[str] = []
    seen: set[str] = set()
    for raw in configured.split(","):
        server = _text(raw, maximum=255)
        normalized = server.casefold()
        if server and normalized not in seen:
            candidates.append(server)
            seen.add(normalized)
    return tuple(candidates) or (DEFAULT_DOCFLOW_SERVER,)


def build_docflow_connection_string(*, login: str, password: str, server: str | None = None) -> str:
    server_value = _text(server or os.getenv("DOCFLOW_1C_SERVER") or DEFAULT_DOCFLOW_SERVER, maximum=512)
    ref = _text(os.getenv("DOCFLOW_1C_REF") or DEFAULT_DOCFLOW_REF, maximum=128)
    return (
        f'Srvr="{_quote_connection_value(server_value)}";'
        f'Ref="{_quote_connection_value(ref)}";'
        f'Usr="{_quote_connection_value(login)}";'
        f'Pwd="{_quote_connection_value(password)}";'
    )


def _getattr_any(value: Any, *names: str) -> Any:
    last_error: Exception | None = None
    for name in names:
        try:
            return getattr(value, name)
        except Exception as exc:
            last_error = exc
    if last_error is not None:
        raise last_error
    raise AttributeError("attribute name is required")


def _call_any(value: Any, names: tuple[str, ...], *args: Any) -> Any:
    method = _getattr_any(value, *names)
    return method(*args)


def _connection_text(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        return _text(_call_any(connection, ("Строка", "String"), value), maximum=2000)
    except Exception:
        return _text(value, maximum=2000)


def _metadata_name(connection: Any, value: Any) -> str:
    for attribute_name in ("Имя", "Name"):
        try:
            name = _connection_text(connection, getattr(value, attribute_name))
        except Exception:
            continue
        if name:
            return name
    return ""


def _metadata_label(connection: Any, value: Any) -> str:
    for attribute_name in ("Синоним", "Synonym"):
        try:
            label = _connection_text(connection, getattr(value, attribute_name))
        except Exception:
            continue
        if label:
            return label
    return _metadata_name(connection, value)


def _metadata_descriptor_for_value(connection: Any, value: Any) -> tuple[str, str]:
    """Resolve an exact metadata type without guessing from a presentation."""
    if value is None:
        return "", ""
    candidates = [value]
    try:
        candidates.append(_call_any(value, ("ПолучитьОбъект", "GetObject")))
    except Exception:
        pass
    for candidate in candidates:
        for method_name in ("Метаданные", "Metadata"):
            try:
                item = getattr(candidate, method_name)()
            except Exception:
                continue
            name = _metadata_name(connection, item)
            if name:
                return name, _metadata_label(connection, item)
    try:
        value_type = _call_any(connection, ("ТипЗнч", "TypeOf"), value)
        metadata = _getattr_any(connection, "Метаданные", "Metadata")
        item = _call_any(metadata, ("НайтиПоТипу", "FindByType"), value_type)
        return _metadata_name(connection, item), _metadata_label(connection, item)
    except Exception:
        return "", ""


def _collection_items(collection: Any, *, maximum: int = 500) -> list[Any]:
    try:
        count = int(_call_any(collection, ("Количество", "Count")))
    except Exception:
        return []
    result: list[Any] = []
    for index in range(min(maximum, max(0, count))):
        try:
            result.append(_call_any(collection, ("Получить", "Get"), index))
        except Exception:
            break
    return result


def _metadata_attributes(connection: Any, task_metadata: Any) -> list[str]:
    names: set[str] = set()
    for collection_name in (
        ("Реквизиты", "Attributes"),
        ("СтандартныеРеквизиты", "StandardAttributes"),
    ):
        try:
            collection = _getattr_any(task_metadata, *collection_name)
        except Exception:
            continue
        for item in _collection_items(collection):
            name = _metadata_name(connection, item)
            if name:
                names.add(name)
    return sorted(names, key=str.casefold)


def _ref_uuid(connection: Any, value: Any) -> str:
    if value is None:
        return ""
    try:
        identifier = _call_any(value, ("УникальныйИдентификатор", "UUID"))
        return _connection_text(connection, identifier)
    except Exception:
        return ""


def _date_text(connection: Any, value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return _connection_text(connection, value) or None


def _integer(value: Any) -> int:
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError):
        return 0


def _normalized_uuid(value: str, *, label: str) -> str:
    try:
        return str(uuid.UUID(str(value or "").strip()))
    except (TypeError, ValueError, AttributeError):
        raise Docflow1CNotFoundError(f"{label} не найден") from None


def docflow_export_root() -> Path:
    return Path(tempfile.gettempdir()) / "hubit-docflow-files"


def _file_size_limit() -> int:
    try:
        configured = int(os.getenv("DOCFLOW_1C_FILE_MAX_BYTES", str(50 * 1024 * 1024)))
    except (TypeError, ValueError):
        configured = 50 * 1024 * 1024
    return max(1024, min(configured, 250 * 1024 * 1024))


def _safe_file_name(name: str, extension: str = "") -> str:
    normalized = re.sub(r"[\x00-\x1f\x7f\\/:*?\"<>|]+", "_", _text(name, maximum=240)).strip(" .")
    suffix = re.sub(r"[^A-Za-zА-Яа-яЁё0-9]+", "", _text(extension, maximum=16)).lower()
    if not normalized:
        normalized = "document"
    if suffix and not normalized.casefold().endswith(f".{suffix}".casefold()):
        normalized = f"{normalized}.{suffix}"
    return normalized[:240]


def _env_flag(name: str, default: str = "0") -> bool:
    return str(os.getenv(name, default) or default).strip().lower() in {
        "1", "true", "yes", "on",
    }


def _normalized_unc_root(value: str) -> PureWindowsPath | None:
    normalized = str(value or "").strip().rstrip("\\/")
    if not normalized.startswith("\\\\"):
        return None
    path = PureWindowsPath(normalized)
    if not path.is_absolute() or not path.drive:
        return None
    return path


def _configured_docflow_volume_roots() -> tuple[PureWindowsPath, ...]:
    configured = str(os.getenv("DOCFLOW_FILE_VOLUME_ROOTS", "") or "")
    roots: list[PureWindowsPath] = []
    seen: set[str] = set()
    for raw_value in configured.split(";"):
        root = _normalized_unc_root(raw_value)
        if root is None:
            continue
        key = str(root).casefold()
        if key not in seen:
            roots.append(root)
            seen.add(key)
    return tuple(roots)


def _configured_docflow_volume_mappings() -> tuple[tuple[PureWindowsPath, PureWindowsPath], ...]:
    mappings: dict[str, tuple[PureWindowsPath, PureWindowsPath]] = {}
    for root in _configured_docflow_volume_roots():
        mappings[str(root).casefold()] = (root, root)
    configured = str(os.getenv("DOCFLOW_FILE_VOLUME_MAPPINGS", "") or "")
    for raw_mapping in configured.split(";"):
        declared_value, separator, accessible_value = raw_mapping.partition("=>")
        if not separator:
            continue
        declared_root = _normalized_unc_root(declared_value)
        accessible_root = _normalized_unc_root(accessible_value)
        if declared_root is None or accessible_root is None:
            continue
        mappings[str(declared_root).casefold()] = (declared_root, accessible_root)
    return tuple(mappings.values())


def _docflow_volume_source_path(connection: Any, version_object: Any) -> Path:
    try:
        relative_text = _connection_text(
            connection,
            _getattr_any(version_object, "ПутьКФайлу", "FilePath"),
        )
        relative_path = PureWindowsPath(relative_text)
        volume_ref = _getattr_any(version_object, "Том", "Volume")
        volume_object = _call_any(volume_ref, ("ПолучитьОбъект", "GetObject"))
        one_c_root = _normalized_unc_root(
            _connection_text(
                connection,
                _getattr_any(volume_object, "ПолныйПутьWindows", "FullWindowsPath"),
            )
        )
    except Exception:
        raise Docflow1CFileStorageUnavailableError(
            "Не удалось определить путь к файловому тому 1С"
        ) from None

    if (
        not relative_text
        or relative_path.is_absolute()
        or bool(relative_path.drive)
        or bool(relative_path.root)
        or any(part in {"", ".", ".."} for part in relative_path.parts)
    ):
        raise Docflow1CFileStorageUnavailableError(
            "Некорректный относительный путь файла в томе 1С"
        )
    if one_c_root is None:
        raise Docflow1CFileStorageUnavailableError(
            "Для тома 1С не задан корректный Windows UNC-путь"
        )

    accessible_root = next(
        (
            target_root
            for declared_root, target_root in _configured_docflow_volume_mappings()
            if str(declared_root).casefold() == str(one_c_root).casefold()
        ),
        None,
    )
    if accessible_root is None:
        raise Docflow1CFileStorageUnavailableError(
            "Файловый том 1С не входит в список разрешённых для HUB-IT"
        )
    return Path(str(accessible_root.joinpath(relative_path)))


def _docflow_file_network_credentials() -> tuple[str, str, str]:
    dedicated_user = str(os.getenv("DOCFLOW_FILE_AD_USER", "") or "").strip()
    dedicated_password = str(os.getenv("DOCFLOW_FILE_AD_PASSWORD", "") or "")
    dedicated_domain = str(os.getenv("DOCFLOW_FILE_AD_DOMAIN", "") or "").strip()
    if dedicated_user or dedicated_password:
        if not dedicated_user or not dedicated_password:
            raise Docflow1CFileStorageUnavailableError(
                "Сервисная AD-учётная запись файлов 1С настроена не полностью"
            )
        return dedicated_user, dedicated_password, dedicated_domain

    if not _env_flag("DOCFLOW_FILE_USE_LDAP_SYNC_CREDENTIALS"):
        raise Docflow1CFileStorageUnavailableError(
            "Сервисная AD-учётная запись для файлов 1С не настроена"
        )
    user = str(os.getenv("LDAP_SYNC_USER", "") or "").strip()
    password = str(os.getenv("LDAP_SYNC_PASSWORD", "") or "")
    domain = str(os.getenv("LDAP_DOMAIN", "") or "").strip()
    if not user or not password:
        raise Docflow1CFileStorageUnavailableError(
            "Сервисная AD-учётная запись синхронизации настроена не полностью"
        )
    return user, password, domain


def _windows_network_username(username: str, default_domain: str) -> str:
    normalized = str(username or "").strip()
    if "\\" in normalized or "@" in normalized:
        return normalized
    domain = str(default_domain or "").strip()
    return f"{domain}\\{normalized}" if domain else normalized


def _ensure_docflow_share_connection(source: Path) -> None:
    if os.name != "nt":
        raise Docflow1CFileStorageUnavailableError(
            "Подключение к файловому тому 1С под AD-учётной записью поддерживается только на Windows"
        )
    share = str(PureWindowsPath(str(source)).drive).rstrip("\\")
    if not share.startswith("\\\\"):
        raise Docflow1CFileStorageUnavailableError(
            "Для файлового тома 1С не удалось определить сетевой ресурс"
        )
    dedicated_credentials_configured = bool(
        str(os.getenv("DOCFLOW_FILE_AD_USER", "") or "").strip()
        or str(os.getenv("DOCFLOW_FILE_AD_PASSWORD", "") or "")
    )
    if (
        _env_flag("DOCFLOW_FILE_USE_PROCESS_IDENTITY")
        and not dedicated_credentials_configured
    ):
        return
    username, password, default_domain = _docflow_file_network_credentials()
    network_username = _windows_network_username(username, default_domain)
    share_key = share.casefold()
    with _DOCFLOW_NETWORK_CONNECTION_LOCK:
        if share_key in _DOCFLOW_CONNECTED_SHARES:
            return
        _connect_windows_share(
            share=share,
            username=network_username,
            password=password,
        )
        _DOCFLOW_CONNECTED_SHARES.add(share_key)


def _connect_windows_share(*, share: str, username: str, password: str) -> None:
    try:
        import ctypes
        from ctypes import wintypes

        class NetResourceW(ctypes.Structure):
            _fields_ = (
                ("dwScope", wintypes.DWORD),
                ("dwType", wintypes.DWORD),
                ("dwDisplayType", wintypes.DWORD),
                ("dwUsage", wintypes.DWORD),
                ("lpLocalName", wintypes.LPWSTR),
                ("lpRemoteName", wintypes.LPWSTR),
                ("lpComment", wintypes.LPWSTR),
                ("lpProvider", wintypes.LPWSTR),
            )

        mpr = ctypes.WinDLL("mpr", use_last_error=True)
        mpr.WNetAddConnection2W.argtypes = (
            ctypes.POINTER(NetResourceW),
            wintypes.LPCWSTR,
            wintypes.LPCWSTR,
            wintypes.DWORD,
        )
        mpr.WNetAddConnection2W.restype = wintypes.DWORD
        resource = NetResourceW()
        resource.dwType = 1  # RESOURCETYPE_DISK
        resource.lpRemoteName = str(share)
        result = int(mpr.WNetAddConnection2W(ctypes.byref(resource), password, username, 0))
        if result not in {0, 85}:  # NO_ERROR, ERROR_ALREADY_ASSIGNED
            raise OSError(result)
    except Docflow1CError:
        raise
    except Exception:
        raise Docflow1CFileStorageUnavailableError(
            "Не удалось подключить файловый том 1С под сервисной AD-учётной записью"
        ) from None


def _copy_docflow_volume_file(
    connection: Any,
    version_object: Any,
    destination: Path,
    *,
    maximum_size: int,
) -> None:
    source = _docflow_volume_source_path(connection, version_object)
    try:
        _ensure_docflow_share_connection(source)
        total = 0
        with source.open("rb") as source_stream, destination.open("wb") as destination_stream:
            while True:
                chunk = source_stream.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > maximum_size:
                    raise Docflow1CFileTooLargeError(
                        "Файл слишком большой для загрузки через HUB-IT"
                    )
                destination_stream.write(chunk)
    except Docflow1CError:
        raise
    except OSError:
        raise Docflow1CFileStorageUnavailableError(
            "Сервисная AD-учётная запись не смогла прочитать файл из тома 1С"
        ) from None


def _preview_supported(filename: str, content_type: str) -> bool:
    extension = Path(filename).suffix.lower().lstrip(".")
    mime = str(content_type or "").lower()
    return bool(
        mime.startswith(("image/", "text/"))
        or "pdf" in mime
        or extension in {
            "pdf", "doc", "docx", "docm", "dot", "dotx", "rtf", "odt",
            "xls", "xlsx", "xlsm", "xlt", "xltx", "xltm", "ods",
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "txt", "log", "md",
            "json", "xml", "yaml", "yml", "csv",
        }
    )


def _identifier_from_env(name: str, default: str) -> str:
    value = _text(os.getenv(name) or default, maximum=128)
    if not _IDENTIFIER_RE.fullmatch(value):
        raise Docflow1CMappingError(f"Некорректная настройка {name}")
    return value


def _is_authentication_error(exc: BaseException) -> bool:
    text = str(exc or "").casefold()
    markers = (
        "authentication",
        "authenticate",
        "user name or password",
        "аутентификац",
        "неверное имя пользователя",
        "неверный пароль",
        "пользователь не найден",
    )
    return any(marker in text for marker in markers)


class Docflow1CComClient:
    """Open personal 1C sessions, optionally reusing them in an isolated worker."""

    def __init__(
        self,
        connector_factory=None,
        *,
        cache_connections: bool = False,
        max_cached_connections: int = 16,
    ) -> None:
        self._connector_factory = connector_factory
        self._cache_connections = bool(cache_connections)
        self._max_cached_connections = max(1, min(int(max_cached_connections), 64))
        self._cache_secret = secrets.token_bytes(32)
        self._connections: OrderedDict[str, tuple[Any, float]] = OrderedDict()
        self._connections_lock = threading.RLock()

    def _credential_key(self, *, login: str, password: str) -> str:
        material = f"{login}\0{password}".encode("utf-8")
        return hmac.new(self._cache_secret, material, hashlib.sha256).hexdigest()

    @property
    def cached_connection_count(self) -> int:
        with self._connections_lock:
            return len(self._connections)

    def close(self) -> None:
        """Release cached COM references when the isolated worker exits."""

        with self._connections_lock:
            self._connections.clear()

    def _connect(self, *, login: str, password: str) -> Any:
        normalized_login = _text(login, maximum=128)
        normalized_password = str(password or "")
        if not normalized_login or not normalized_password:
            raise Docflow1CAuthenticationError("Введите логин и пароль 1С")
        cache_key = self._credential_key(login=normalized_login, password=normalized_password)
        if self._cache_connections:
            with self._connections_lock:
                cached = self._connections.get(cache_key)
                if cached is not None:
                    connection, last_used = cached
                    try:
                        idle_ttl = max(
                            60,
                            min(86_400, int(os.getenv("DOCFLOW_1C_CONNECTION_IDLE_TTL_SECONDS", "900") or 900)),
                        )
                    except (TypeError, ValueError):
                        idle_ttl = 900
                    if time.monotonic() - last_used <= idle_ttl:
                        self._connections[cache_key] = (connection, time.monotonic())
                        self._connections.move_to_end(cache_key)
                        return connection
                    self._connections.pop(cache_key, None)
        try:
            last_error: Exception | None = None
            connection = None
            for server in _docflow_server_candidates():
                try:
                    if self._connector_factory is not None:
                        connector = self._connector_factory()
                    else:
                        import win32com.client  # type: ignore

                        connector = win32com.client.Dispatch("V83.COMConnector")
                    connection = connector.Connect(
                        build_docflow_connection_string(
                            login=normalized_login,
                            password=normalized_password,
                            server=server,
                        )
                    )
                    break
                except Exception as exc:
                    if _is_authentication_error(exc):
                        raise Docflow1CAuthenticationError("Логин или пароль 1С не принят") from None
                    last_error = exc
            if connection is None:
                raise last_error or RuntimeError("1C server list is empty")
            if self._cache_connections:
                with self._connections_lock:
                    self._connections[cache_key] = (connection, time.monotonic())
                    self._connections.move_to_end(cache_key)
                    while len(self._connections) > self._max_cached_connections:
                        self._connections.popitem(last=False)
            return connection
        except Docflow1CError:
            raise
        except Exception as exc:
            if _is_authentication_error(exc):
                raise Docflow1CAuthenticationError("Логин или пароль 1С не принят") from None
            raise Docflow1CUnavailableError("Не удалось подключиться к 1С Документооборот") from None

    def test_connection(self, *, login: str, password: str) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        try:
            metadata = _getattr_any(connection, "Метаданные", "Metadata")
            _getattr_any(metadata, "Задачи", "Tasks")
        except Exception:
            raise Docflow1CUnavailableError("1С подключена, но метаданные заданий недоступны") from None
        return {
            "connected": True,
            "configuration": _text(os.getenv("DOCFLOW_1C_REF") or DEFAULT_DOCFLOW_REF, maximum=128),
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

    def metadata(self, *, login: str, password: str) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        try:
            metadata = _getattr_any(connection, "Метаданные", "Metadata")
            tasks = _getattr_any(metadata, "Задачи", "Tasks")
            items = []
            for task_metadata in _collection_items(tasks, maximum=100):
                name = _metadata_name(connection, task_metadata)
                if not name:
                    continue
                items.append(
                    {
                        "name": name,
                        "label": _metadata_label(connection, task_metadata),
                        "attributes": _metadata_attributes(connection, task_metadata),
                    }
                )
            process_items = []
            try:
                processes = _getattr_any(metadata, "БизнесПроцессы", "BusinessProcesses")
            except Exception:
                processes = None
            for process_metadata in _collection_items(processes, maximum=100) if processes is not None else []:
                name = _metadata_name(connection, process_metadata)
                if not name:
                    continue
                process_items.append(
                    {
                        "name": name,
                        "label": _metadata_label(connection, process_metadata),
                        "attributes": _metadata_attributes(connection, process_metadata),
                    }
                )
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CUnavailableError("Не удалось прочитать метаданные заданий 1С") from None

        active_type = _identifier_from_env("DOCFLOW_1C_TASK_TYPE", "ЗадачаИсполнителя")
        mapping_ready = any(item["name"].casefold() == active_type.casefold() for item in items)
        return {
            "configuration": _text(os.getenv("DOCFLOW_1C_REF") or DEFAULT_DOCFLOW_REF, maximum=128),
            "task_types": items,
            "process_types": process_items,
            "active_task_type": active_type,
            "mapping_ready": mapping_ready,
        }

    def _resolve_task_metadata(self, connection: Any, task_type: str) -> tuple[Any, set[str], str]:
        metadata = _getattr_any(connection, "Метаданные", "Metadata")
        tasks = _getattr_any(metadata, "Задачи", "Tasks")
        for task_metadata in _collection_items(tasks, maximum=100):
            name = _metadata_name(connection, task_metadata)
            if name.casefold() == task_type.casefold():
                return task_metadata, set(_metadata_attributes(connection, task_metadata)), _metadata_label(connection, task_metadata)
        raise Docflow1CMappingError(
            f"Тип задания {task_type} не найден; требуется настройка DOCFLOW_1C_TASK_TYPE"
        )

    @staticmethod
    def _reference_from_uuid(
        connection: Any,
        *,
        manager_names: tuple[str, ...],
        entity_name: str,
        ref: str,
        label: str,
    ) -> Any:
        normalized_ref = _normalized_uuid(ref, label=label)
        try:
            managers = _getattr_any(connection, *manager_names)
            manager = getattr(managers, entity_name)
            try:
                identifier = connection.NewObject("UUID", normalized_ref)
            except Exception:
                identifier = connection.NewObject("УникальныйИдентификатор", normalized_ref)
            return _call_any(manager, ("ПолучитьСсылку", "GetRef"), identifier)
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError(f"Не удалось получить ссылку {label.lower()} 1С") from None

    def _task_context(
        self,
        connection: Any,
        *,
        task_ref: str,
    ) -> tuple[dict[str, Any], Any]:
        task_type = _identifier_from_env("DOCFLOW_1C_TASK_TYPE", "ЗадачаИсполнителя")
        assignee_field = _identifier_from_env("DOCFLOW_1C_TASK_ASSIGNEE_FIELD", "ТекущийИсполнитель")
        completed_field = _identifier_from_env("DOCFLOW_1C_TASK_COMPLETED_FIELD", "Выполнена")
        session_user_field = _identifier_from_env("DOCFLOW_1C_SESSION_USER_FIELD", "ТекущийПользователь")
        field_mapping = {
            "number": _identifier_from_env("DOCFLOW_1C_TASK_NUMBER_FIELD", "Номер"),
            "created_at": _identifier_from_env("DOCFLOW_1C_TASK_DATE_FIELD", "ДатаНачала"),
            "due_at": _identifier_from_env("DOCFLOW_1C_TASK_DUE_FIELD", "СрокИсполнения"),
            "author": _identifier_from_env("DOCFLOW_1C_TASK_AUTHOR_FIELD", "Автор"),
            "subject": _identifier_from_env("DOCFLOW_1C_TASK_SUBJECT_FIELD", "ПредметСтрокой"),
            "description": _identifier_from_env("DOCFLOW_1C_TASK_DESCRIPTION_FIELD", "Описание"),
            "result": _identifier_from_env("DOCFLOW_1C_TASK_RESULT_FIELD", "РезультатВыполнения"),
            "business_state": _identifier_from_env("DOCFLOW_1C_TASK_STATE_FIELD", "СостояниеБизнесПроцесса"),
            "importance": _identifier_from_env("DOCFLOW_1C_TASK_IMPORTANCE_FIELD", "Важность"),
            "accepted": _identifier_from_env("DOCFLOW_1C_TASK_ACCEPTED_FIELD", "ПринятаКИсполнению"),
            "completed_at": _identifier_from_env("DOCFLOW_1C_TASK_COMPLETED_AT_FIELD", "ДатаИсполнения"),
        }
        aliases = {
            "number": "Номер",
            "created_at": "Дата",
            "due_at": "Срок",
            "author": "Автор",
            "subject": "Предмет",
            "description": "Описание",
            "result": "Результат",
            "business_state": "Состояние",
            "importance": "Важность",
            "accepted": "Принято",
            "completed_at": "ДатаИсполнения",
        }
        presentation_fields = {"author", "subject", "business_state", "importance"}

        try:
            _, available_fields, task_type_label = self._resolve_task_metadata(connection, task_type)
            if assignee_field not in available_fields:
                raise Docflow1CMappingError(
                    f"Не найден обязательный реквизит задания: {assignee_field}"
                )
            session_parameters = _getattr_any(connection, "ПараметрыСеанса", "SessionParameters")
            current_user = getattr(session_parameters, session_user_field)
            task_reference = self._reference_from_uuid(
                connection,
                manager_names=("Задачи", "Tasks"),
                entity_name=task_type,
                ref=task_ref,
                label="Задание",
            )
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError("Не удалось проверить доступ к заданию 1С") from None

        selected_fields = {
            key: value for key, value in field_mapping.items() if value in available_fields
        }
        select_lines = [
            "    Задание.Ссылка КАК Ссылка",
            "    ПРЕДСТАВЛЕНИЕ(Задание.Ссылка) КАК Представление",
            f"    Задание.{completed_field} КАК Выполнено",
            "    Задание.БизнесПроцесс КАК БизнесПроцесс",
            "    ПРЕДСТАВЛЕНИЕ(Задание.БизнесПроцесс) КАК Процесс",
        ]
        for key, field_name in selected_fields.items():
            expression = f"Задание.{field_name}"
            if key in presentation_fields:
                expression = f"ПРЕДСТАВЛЕНИЕ({expression})"
            select_lines.append(f"    {expression} КАК {aliases[key]}")

        query_text = (
            "ВЫБРАТЬ ПЕРВЫЕ 1\n"
            + ",\n".join(select_lines)
            + f"\nИЗ\n    Задача.{task_type} КАК Задание\nГДЕ\n"
            + f"    Задание.{assignee_field} = &ТекущийПользователь\n"
            + "    И Задание.Ссылка = &Задание"
        )
        try:
            query = connection.NewObject("Query")
            query.Text = query_text
            query.SetParameter("ТекущийПользователь", current_user)
            query.SetParameter("Задание", task_reference)
            selection = query.Execute().Select()
            if not bool(selection.Next()):
                raise Docflow1CNotFoundError("Задание не найдено или больше не назначено вам")
            presentation = _connection_text(connection, getattr(selection, "Представление", ""))
            subject = (
                _connection_text(connection, getattr(selection, aliases["subject"], ""))
                if "subject" in selected_fields
                else ""
            )
            process_reference = getattr(selection, "БизнесПроцесс", None)
            process_type, process_type_label = _metadata_descriptor_for_value(
                connection,
                process_reference,
            )
            configuration = _text(
                os.getenv("DOCFLOW_1C_REF") or DEFAULT_DOCFLOW_REF,
                maximum=128,
            )
            detail = {
                "ref": _ref_uuid(connection, getattr(selection, "Ссылка", None)),
                "task_type": task_type,
                "task_type_label": task_type_label or task_type,
                "title": subject or presentation or "Задание 1С",
                "number": _connection_text(connection, getattr(selection, aliases["number"], "")) or None if "number" in selected_fields else None,
                "created_at": _date_text(connection, getattr(selection, aliases["created_at"], None)) if "created_at" in selected_fields else None,
                "due_at": _date_text(connection, getattr(selection, aliases["due_at"], None)) if "due_at" in selected_fields else None,
                "author": _connection_text(connection, getattr(selection, aliases["author"], "")) or None if "author" in selected_fields else None,
                "subject": subject or None,
                "description": _connection_text(connection, getattr(selection, aliases["description"], "")) or None if "description" in selected_fields else None,
                "result": _connection_text(connection, getattr(selection, aliases["result"], "")) or None if "result" in selected_fields else None,
                "business_state": _connection_text(connection, getattr(selection, aliases["business_state"], "")) or None if "business_state" in selected_fields else None,
                "importance": _connection_text(connection, getattr(selection, aliases["importance"], "")) or None if "importance" in selected_fields else None,
                "accepted": bool(getattr(selection, aliases["accepted"], False)) if "accepted" in selected_fields else None,
                "completed_at": _date_text(connection, getattr(selection, aliases["completed_at"], None)) if "completed_at" in selected_fields else None,
                "completed": bool(getattr(selection, "Выполнено", False)),
                "process_name": _connection_text(connection, getattr(selection, "Процесс", "")) or None,
                "process_ref": _ref_uuid(connection, process_reference) or None,
                "process_type": process_type or None,
                "process_type_label": process_type_label or process_type or None,
                "configuration_fingerprint": configuration_fingerprint(
                    configuration=configuration,
                    task_type=task_type,
                    process_type=process_type,
                ) if process_type else None,
            }
            return detail, process_reference
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError("Не удалось прочитать подробную карточку задания 1С") from None

    @staticmethod
    def _process_context(connection: Any, process_ref: Any) -> tuple[list[Any], list[dict[str, Any]]]:
        process_uuid = _ref_uuid(connection, process_ref)
        if process_ref is None or not process_uuid:
            return [], []
        owners = [process_ref]
        related_objects: list[dict[str, Any]] = []
        seen = {process_uuid.casefold()}
        try:
            process_object = _call_any(process_ref, ("ПолучитьОбъект", "GetObject"))
            subjects = _getattr_any(process_object, "Предметы", "Subjects")
            count = min(100, max(0, int(_call_any(subjects, ("Количество", "Count")))))
            for index in range(count):
                row = _call_any(subjects, ("Получить", "Get"), index)
                subject = _getattr_any(row, "Предмет", "Subject")
                subject_uuid = _ref_uuid(connection, subject)
                normalized = subject_uuid.casefold()
                if (
                    subject_uuid
                    and subject_uuid != "00000000-0000-0000-0000-000000000000"
                    and normalized not in seen
                ):
                    owners.append(subject)
                    seen.add(normalized)
                    object_type, object_type_label = _metadata_descriptor_for_value(connection, subject)
                    related_objects.append(
                        {
                            "ref": subject_uuid,
                            "object_type": object_type or None,
                            "object_type_label": object_type_label or object_type or None,
                            "title": _connection_text(connection, subject) or "Связанный объект 1С",
                        }
                    )
        except Exception:
            # Some business-process types do not have a `Предметы` tabular
            # section. Direct files of the process remain available.
            pass
        return owners, related_objects

    @classmethod
    def _process_file_owners(cls, connection: Any, process_ref: Any) -> list[Any]:
        owners, _ = cls._process_context(connection, process_ref)
        return owners

    @staticmethod
    def _list_owner_files(connection: Any, owner_ref: Any) -> list[dict[str, Any]]:
        query_text = (
            "ВЫБРАТЬ ПЕРВЫЕ 100\n"
            "    Файл.Ссылка КАК Ссылка,\n"
            "    ПРЕДСТАВЛЕНИЕ(Файл.Ссылка) КАК Представление,\n"
            "    Файл.ПолноеНаименование КАК ПолноеНаименование,\n"
            "    Файл.Описание КАК Описание,\n"
            "    Файл.ДатаСоздания КАК ДатаСоздания,\n"
            "    Файл.ТекущаяВерсияРазмер КАК Размер,\n"
            "    Файл.ТекущаяВерсияРасширение КАК Расширение\n"
            "ИЗ\n    Справочник.Файлы КАК Файл\n"
            "ГДЕ\n    Файл.ВладелецФайла = &Владелец\n"
            "    И НЕ Файл.ПометкаУдаления\n"
            "УПОРЯДОЧИТЬ ПО\n    Файл.ДатаСоздания УБЫВ"
        )
        try:
            query = connection.NewObject("Query")
            query.Text = query_text
            query.SetParameter("Владелец", owner_ref)
            selection = query.Execute().Select()
            files: list[dict[str, Any]] = []
            while bool(selection.Next()):
                extension = _connection_text(connection, getattr(selection, "Расширение", ""))
                raw_name = (
                    _connection_text(connection, getattr(selection, "ПолноеНаименование", ""))
                    or _connection_text(connection, getattr(selection, "Представление", ""))
                )
                filename = _safe_file_name(raw_name, extension)
                content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
                files.append(
                    {
                        "ref": _ref_uuid(connection, getattr(selection, "Ссылка", None)),
                        "name": filename,
                        "extension": extension.lower() or Path(filename).suffix.lower().lstrip("."),
                        "content_type": content_type,
                        "size": _integer(getattr(selection, "Размер", 0)),
                        "created_at": _date_text(connection, getattr(selection, "ДатаСоздания", None)),
                        "description": _connection_text(connection, getattr(selection, "Описание", "")) or None,
                        "preview_supported": _preview_supported(filename, content_type),
                    }
                )
            return [item for item in files if item["ref"]]
        except Exception:
            raise Docflow1CMappingError("Не удалось прочитать файлы задания 1С") from None

    @classmethod
    def _list_process_files(cls, connection: Any, owners: list[Any]) -> list[dict[str, Any]]:
        files: list[dict[str, Any]] = []
        seen: set[str] = set()
        for owner in owners[:20]:
            for item in cls._list_owner_files(connection, owner):
                file_ref = str(item.get("ref") or "").casefold()
                if not file_ref or file_ref in seen:
                    continue
                seen.add(file_ref)
                files.append(item)
        return files

    def get_task_detail(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        include_related: bool = True,
    ) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        detail, process_ref = self._task_context(connection, task_ref=task_ref)
        owners, related_objects = self._process_context(connection, process_ref)
        detail["related_objects"] = related_objects
        detail["files"] = self._list_process_files(connection, owners) if include_related else []
        return detail

    def get_task_state(self, *, login: str, password: str, task_ref: str) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        detail, _ = self._task_context(connection, task_ref=task_ref)
        detail["files"] = []
        return detail

    def apply_task_action(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        action: str,
        result_template: str,
        comment: str,
    ) -> dict[str, Any]:
        """Apply one pre-resolved action; no object or method names are accepted."""
        normalized_action = _text(action, maximum=32).lower()
        if normalized_action not in {"acknowledge", "approve", "reject", "complete"}:
            raise Docflow1CMappingError("Действие с заданием 1С не разрешено")
        template = _text(result_template, maximum=500)
        normalized_comment = _text(comment, maximum=2000)
        if not template and normalized_action != "acknowledge":
            raise Docflow1CMappingError("Для действия не настроен результат 1С")

        connection = self._connect(login=login, password=password)
        before, _ = self._task_context(connection, task_ref=task_ref)
        if bool(before.get("completed")):
            raise Docflow1CConflictError("Задание уже завершено в 1С")

        task_type = _identifier_from_env("DOCFLOW_1C_TASK_TYPE", "ЗадачаИсполнителя")
        result_field = _identifier_from_env("DOCFLOW_1C_TASK_RESULT_FIELD", "РезультатВыполнения")
        accepted_field = _identifier_from_env("DOCFLOW_1C_TASK_ACCEPTED_FIELD", "ПринятаКИсполнению")
        task_reference = self._reference_from_uuid(
            connection,
            manager_names=("Задачи", "Tasks"),
            entity_name=task_type,
            ref=task_ref,
            label="Задание",
        )
        result_value = template.replace("{comment}", normalized_comment).strip()[:2000]
        mutation_started = False
        try:
            task_object = _call_any(task_reference, ("ПолучитьОбъект", "GetObject"))
            if before.get("accepted") is not True:
                setattr(task_object, accepted_field, True)
            setattr(task_object, result_field, result_value)
            mutation_started = True
            _call_any(task_object, ("ВыполнитьЗадачу", "ExecuteTask", "CompleteTask"))
        except Docflow1CError:
            raise
        except Exception as exc:
            if mutation_started:
                try:
                    after_error, _ = self._task_context(connection, task_ref=task_ref)
                except Exception:
                    after_error = None
                if isinstance(after_error, dict) and _task_action_state_matches(before, after_error):
                    if "нарушение прав доступа" in str(exc).casefold():
                        raise Docflow1CConflictError(
                            "1С запретила выполнение задания через внешнее соединение. "
                            "Требуется разрешённый серверный интерфейс или роль 1С"
                        ) from None
                    raise Docflow1CConflictError(
                        "1С отклонила действие; задание не изменено"
                    ) from None
                raise Docflow1COutcomeUnknownError(
                    "1С не подтвердила результат выполнения задания"
                ) from None
            raise Docflow1CUnavailableError("1С не подтвердила выполнение задания") from None

        after, _ = self._task_context(connection, task_ref=task_ref)
        if not bool(after.get("completed")):
            raise Docflow1CConflictError("1С не перевела задание в завершённое состояние")
        return {"before": before, "task": after}

    @staticmethod
    def _cleanup_old_exports(root: Path) -> None:
        cutoff = time.time() - 15 * 60
        try:
            candidates = tuple(root.glob("docflow-*"))
        except OSError:
            return
        for candidate in candidates:
            try:
                if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                    candidate.unlink(missing_ok=True)
            except OSError:
                continue

    @staticmethod
    def _file_binary_data(connection: Any, file_reference: Any, version_object: Any) -> Any:
        try:
            file_module = getattr(connection, "РаботаСФайлами")
            binary = getattr(file_module, "ДвоичныеДанныеФайла")(file_reference, True)
            if binary is not None:
                return binary
        except AttributeError:
            # Older or reduced configurations may not expose the BSP module
            # through an external connection; fall back to database storage.
            pass
        except Exception as exc:
            error_text = str(exc or "").casefold()
            if (
                "файл не найден в хранилище файлов" in error_text
                or "ошибка доступа к файлу" in error_text
            ):
                raise Docflow1CFileStorageUnavailableError(
                    "Файл зарегистрирован в 1С, но его содержимое недоступно в файловом томе 1С"
                ) from None
            raise Docflow1CUnavailableError("Не удалось прочитать текущую версию файла в 1С") from None

        try:
            storage = _getattr_any(version_object, "ФайлХранилище", "FileStorage")
            binary = _call_any(storage, ("Получить", "Get"))
        except Exception:
            binary = None
        if binary is None:
            raise Docflow1CFileStorageUnavailableError(
                "Файл зарегистрирован в 1С, но его содержимое недоступно в файловом томе 1С"
            )
        return binary

    @staticmethod
    def _write_binary_data(connection: Any, binary: Any, path: Path, *, maximum_size: int) -> None:
        if isinstance(binary, (bytes, bytearray, memoryview)):
            payload = bytes(binary)
            if len(payload) > maximum_size:
                raise Docflow1CFileTooLargeError("Файл слишком большой для загрузки через HUB-IT")
            path.write_bytes(payload)
            return
        try:
            encoded = str(
                _call_any(connection, ("Base64Строка", "Base64String"), binary) or ""
            )
            compact = "".join(encoded.split())
            payload = base64.b64decode(compact, validate=True)
            if len(payload) > maximum_size:
                raise Docflow1CFileTooLargeError("Файл слишком большой для загрузки через HUB-IT")
            path.write_bytes(payload)
            return
        except Docflow1CError:
            raise
        except (AttributeError, TypeError, ValueError, binascii.Error):
            pass
        _call_any(binary, ("Записать", "Write"), str(path))

    def export_file(
        self,
        *,
        login: str,
        password: str,
        task_ref: str,
        file_ref: str,
    ) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        _, process_ref = self._task_context(connection, task_ref=task_ref)
        owners = self._process_file_owners(connection, process_ref)
        if not owners:
            raise Docflow1CNotFoundError("Файл задания не найден")
        file_reference = self._reference_from_uuid(
            connection,
            manager_names=("Справочники", "Catalogs"),
            entity_name="Файлы",
            ref=file_ref,
            label="Файл",
        )
        query_text = (
            "ВЫБРАТЬ ПЕРВЫЕ 1\n"
            "    Файл.Ссылка КАК Ссылка,\n"
            "    Файл.ПолноеНаименование КАК ПолноеНаименование,\n"
            "    Файл.ТекущаяВерсия КАК Версия,\n"
            "    Файл.ТекущаяВерсияРазмер КАК Размер,\n"
            "    Файл.ТекущаяВерсияРасширение КАК Расширение\n"
            "ИЗ\n    Справочник.Файлы КАК Файл\n"
            "ГДЕ\n    Файл.ВладелецФайла = &Владелец\n"
            "    И Файл.Ссылка = &Файл\n"
            "    И НЕ Файл.ПометкаУдаления"
        )
        temporary_path: Path | None = None
        try:
            selection = None
            for owner in owners[:20]:
                query = connection.NewObject("Query")
                query.Text = query_text
                query.SetParameter("Владелец", owner)
                query.SetParameter("Файл", file_reference)
                candidate = query.Execute().Select()
                if bool(candidate.Next()):
                    selection = candidate
                    break
            if selection is None:
                raise Docflow1CNotFoundError("Файл не найден в этом задании")
            declared_size = _integer(getattr(selection, "Размер", 0))
            maximum_size = _file_size_limit()
            if declared_size > maximum_size:
                raise Docflow1CFileTooLargeError("Файл слишком большой для загрузки через HUB-IT")
            extension = _connection_text(connection, getattr(selection, "Расширение", ""))
            filename = _safe_file_name(
                _connection_text(connection, getattr(selection, "ПолноеНаименование", "")),
                extension,
            )
            version_ref = getattr(selection, "Версия", None)
            if version_ref is None or not _ref_uuid(connection, version_ref):
                raise Docflow1CNotFoundError("У файла нет доступной текущей версии")
            version_object = _call_any(version_ref, ("ПолучитьОбъект", "GetObject"))
            binary = None
            read_from_volume = False
            try:
                binary = self._file_binary_data(connection, file_reference, version_object)
            except Docflow1CFileStorageUnavailableError:
                read_from_volume = True

            root = docflow_export_root()
            root.mkdir(parents=True, exist_ok=True)
            self._cleanup_old_exports(root)
            suffix = f".{extension.lower()}" if extension else Path(filename).suffix[:20]
            file_descriptor, raw_path = tempfile.mkstemp(prefix="docflow-", suffix=suffix, dir=root)
            os.close(file_descriptor)
            temporary_path = Path(raw_path)
            if read_from_volume:
                _copy_docflow_volume_file(
                    connection,
                    version_object,
                    temporary_path,
                    maximum_size=maximum_size,
                )
            else:
                self._write_binary_data(
                    connection,
                    binary,
                    temporary_path,
                    maximum_size=maximum_size,
                )
            actual_size = temporary_path.stat().st_size
            if actual_size <= 0:
                raise Docflow1CNotFoundError("Текущая версия файла пуста")
            if actual_size > maximum_size:
                raise Docflow1CFileTooLargeError("Файл слишком большой для загрузки через HUB-IT")
            return {
                "temporary_path": str(temporary_path),
                "name": filename,
                "content_type": mimetypes.guess_type(filename)[0] or "application/octet-stream",
                "size": actual_size,
            }
        except Docflow1CError:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise
        except Exception:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise Docflow1CUnavailableError("Не удалось получить содержимое файла из 1С") from None

    def list_tasks(
        self,
        *,
        login: str,
        password: str,
        scope: str,
        search: str,
        limit: int,
    ) -> dict[str, Any]:
        normalized_scope = _text(scope, maximum=16).lower() or "inbox"
        if normalized_scope not in {"inbox", "completed", "all"}:
            raise Docflow1CMappingError("Некорректный scope заданий")
        normalized_limit = max(1, min(int(limit or 50), 100))
        normalized_search = _text(search, maximum=200).casefold()
        connection = self._connect(login=login, password=password)

        task_type = _identifier_from_env("DOCFLOW_1C_TASK_TYPE", "ЗадачаИсполнителя")
        assignee_field = _identifier_from_env("DOCFLOW_1C_TASK_ASSIGNEE_FIELD", "ТекущийИсполнитель")
        completed_field = _identifier_from_env("DOCFLOW_1C_TASK_COMPLETED_FIELD", "Выполнена")
        session_user_field = _identifier_from_env("DOCFLOW_1C_SESSION_USER_FIELD", "ТекущийПользователь")
        field_mapping = {
            "number": _identifier_from_env("DOCFLOW_1C_TASK_NUMBER_FIELD", "Номер"),
            "created_at": _identifier_from_env("DOCFLOW_1C_TASK_DATE_FIELD", "ДатаНачала"),
            "due_at": _identifier_from_env("DOCFLOW_1C_TASK_DUE_FIELD", "СрокИсполнения"),
            "author": _identifier_from_env("DOCFLOW_1C_TASK_AUTHOR_FIELD", "Автор"),
            "subject": _identifier_from_env("DOCFLOW_1C_TASK_SUBJECT_FIELD", "ПредметСтрокой"),
        }

        try:
            _, available_fields, task_type_label = self._resolve_task_metadata(connection, task_type)
            # `Выполнена` is a platform standard task field. Some 1C builds do
            # not expose standard fields through Metadata.StandardAttributes,
            # so only configuration-specific assignee mapping is validated
            # against the discovered attribute list before compiling a query.
            required = {assignee_field}
            missing = sorted(required - available_fields, key=str.casefold)
            if missing:
                raise Docflow1CMappingError(
                    "Не найдены обязательные реквизиты задания: " + ", ".join(missing)
                )
            session_parameters = _getattr_any(connection, "ПараметрыСеанса", "SessionParameters")
            current_user = getattr(session_parameters, session_user_field)
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError(
                "Не удалось определить текущего пользователя 1С; проверьте DOCFLOW_1C_SESSION_USER_FIELD"
            ) from None

        selected_fields: dict[str, str] = {
            key: value for key, value in field_mapping.items() if value in available_fields
        }
        select_lines = [
            "    Задание.Ссылка КАК Ссылка",
            "    ПРЕДСТАВЛЕНИЕ(Задание.Ссылка) КАК Представление",
            "    Задание.%s КАК Выполнено" % completed_field,
        ]
        aliases = {
            "number": "Номер",
            "created_at": "Дата",
            "due_at": "Срок",
            "author": "Автор",
            "subject": "Предмет",
        }
        for key, field_name in selected_fields.items():
            if key in {"author", "subject"}:
                select_lines.append(f"    ПРЕДСТАВЛЕНИЕ(Задание.{field_name}) КАК {aliases[key]}")
            else:
                select_lines.append(f"    Задание.{field_name} КАК {aliases[key]}")

        fetch_limit = min(500, max(normalized_limit + 1, normalized_limit * (5 if normalized_search else 1) + 1))
        where_lines = [f"    Задание.{assignee_field} = &ТекущийПользователь"]
        if normalized_scope != "all":
            where_lines.append(f"    Задание.{completed_field} = &Завершено")

        query_text = (
            f"ВЫБРАТЬ ПЕРВЫЕ {fetch_limit}\n"
            + ",\n".join(select_lines)
            + f"\nИЗ\n    Задача.{task_type} КАК Задание\nГДЕ\n"
            + "\n    И ".join(where_lines)
            + "\nУПОРЯДОЧИТЬ ПО\n    Задание.Ссылка УБЫВ"
        )

        try:
            # V83.COMConnector exposes these automation methods under their
            # English aliases even when the infobase metadata is Russian.
            query = connection.NewObject("Query")
            query.Text = query_text
            query.SetParameter("ТекущийПользователь", current_user)
            if normalized_scope != "all":
                query.SetParameter("Завершено", normalized_scope == "completed")
            selection = query.Execute().Select()
            rows: list[dict[str, Any]] = []
            while bool(selection.Next()):
                presentation = _connection_text(connection, getattr(selection, "Представление", ""))
                subject = _connection_text(connection, getattr(selection, aliases["subject"], "")) if "subject" in selected_fields else ""
                row = {
                    "ref": _ref_uuid(connection, getattr(selection, "Ссылка", None)),
                    "task_type": task_type,
                    "task_type_label": task_type_label or task_type,
                    "title": subject or presentation or "Задание 1С",
                    "number": _connection_text(connection, getattr(selection, aliases["number"], "")) or None if "number" in selected_fields else None,
                    "created_at": _date_text(connection, getattr(selection, aliases["created_at"], None)) if "created_at" in selected_fields else None,
                    "due_at": _date_text(connection, getattr(selection, aliases["due_at"], None)) if "due_at" in selected_fields else None,
                    "author": _connection_text(connection, getattr(selection, aliases["author"], "")) or None if "author" in selected_fields else None,
                    "subject": subject or None,
                    "completed": bool(getattr(selection, "Выполнено", False)),
                }
                haystack = " ".join(
                    str(row.get(key) or "") for key in ("title", "number", "author", "subject")
                ).casefold()
                tokens = [token for token in normalized_search.split() if token]
                if tokens and not all(token in haystack for token in tokens):
                    continue
                rows.append(row)
                if len(rows) > normalized_limit:
                    break
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError(
                "Запрос заданий не совместим с текущими метаданными 1С; требуется настройка mapping"
            ) from None

        truncated = len(rows) > normalized_limit
        page = rows[:normalized_limit]
        return {
            "items": page,
            "returned": len(page),
            "scope": normalized_scope,
            "source": "live_1c",
            "as_of": datetime.now(timezone.utc).isoformat(),
            "truncated": truncated,
        }

    @staticmethod
    def _assignment_document_type(document_type: str) -> str:
        normalized = _text(document_type, maximum=32).lower()
        entity_name = ASSIGNMENT_DOCUMENT_TYPES.get(normalized)
        if not entity_name:
            raise Docflow1CMappingError("Тип документа для поручения не разрешён")
        return entity_name

    @staticmethod
    def _session_user(connection: Any) -> Any:
        session_user_field = _identifier_from_env(
            "DOCFLOW_1C_SESSION_USER_FIELD",
            "ТекущийПользователь",
        )
        try:
            parameters = _getattr_any(connection, "ПараметрыСеанса", "SessionParameters")
            return getattr(parameters, session_user_field)
        except Exception:
            raise Docflow1CMappingError("Не удалось определить текущего пользователя 1С") from None

    def search_assignment_documents(
        self,
        *,
        login: str,
        password: str,
        search: str,
        limit: int,
    ) -> dict[str, Any]:
        normalized_search = _text(search, maximum=200).casefold()
        normalized_limit = max(1, min(int(limit or 20), 50))
        connection = self._connect(login=login, password=password)
        rows: list[dict[str, Any]] = []
        successful_queries = 0
        per_type_limit = min(100, max(20, normalized_limit * 2))
        for document_type, entity_name in ASSIGNMENT_DOCUMENT_TYPES.items():
            query_text = (
                f"ВЫБРАТЬ ПЕРВЫЕ {per_type_limit}\n"
                "    Документ.Ссылка КАК Ссылка,\n"
                "    ПРЕДСТАВЛЕНИЕ(Документ.Ссылка) КАК Представление,\n"
                "    Документ.Заголовок КАК Заголовок,\n"
                "    Документ.РегистрационныйНомер КАК Номер,\n"
                "    Документ.ДатаРегистрации КАК Дата\n"
                f"ИЗ\n    Справочник.{entity_name} КАК Документ\n"
                "ГДЕ\n    НЕ Документ.ПометкаУдаления\n"
                "УПОРЯДОЧИТЬ ПО\n    Документ.ДатаСоздания УБЫВ"
            )
            try:
                query = connection.NewObject("Query")
                query.Text = query_text
                selection = query.Execute().Select()
                successful_queries += 1
                while bool(selection.Next()):
                    title = _connection_text(connection, getattr(selection, "Заголовок", ""))
                    presentation = _connection_text(connection, getattr(selection, "Представление", ""))
                    number = _connection_text(connection, getattr(selection, "Номер", ""))
                    row = {
                        "ref": _ref_uuid(connection, getattr(selection, "Ссылка", None)),
                        "document_type": document_type,
                        "document_type_label": {
                            "internal": "Внутренний документ",
                            "incoming": "Входящий документ",
                            "outgoing": "Исходящий документ",
                        }[document_type],
                        "title": title or presentation or "Документ 1С",
                        "number": number or None,
                        "date": _date_text(connection, getattr(selection, "Дата", None)),
                    }
                    haystack = " ".join(
                        str(row.get(key) or "") for key in ("title", "number", "document_type_label")
                    ).casefold()
                    if normalized_search and normalized_search not in haystack:
                        continue
                    if row["ref"]:
                        rows.append(row)
            except Exception:
                # Personal 1C rights may intentionally hide an entire document
                # class. Other fixed classes remain searchable in that session.
                continue
        if successful_queries == 0:
            raise Docflow1CMappingError(
                "Поиск документов недоступен для текущей учётной записи 1С"
            )
        rows.sort(key=lambda item: (str(item.get("date") or ""), str(item.get("title") or "")), reverse=True)
        truncated = len(rows) > normalized_limit
        page = rows[:normalized_limit]
        return {
            "items": page,
            "returned": len(page),
            "truncated": truncated,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }

    def search_assignment_assignees(
        self,
        *,
        login: str,
        password: str,
        search: str,
        limit: int,
    ) -> dict[str, Any]:
        normalized_search = _text(search, maximum=200).casefold()
        normalized_limit = max(1, min(int(limit or 20), 50))
        fetch_limit = min(200, max(50, normalized_limit * (5 if normalized_search else 2)))
        connection = self._connect(login=login, password=password)
        query_text = (
            f"ВЫБРАТЬ ПЕРВЫЕ {fetch_limit}\n"
            "    Пользователь.Ссылка КАК Ссылка,\n"
            "    ПРЕДСТАВЛЕНИЕ(Пользователь.Ссылка) КАК Представление,\n"
            "    ПРЕДСТАВЛЕНИЕ(Пользователь.Подразделение) КАК Подразделение\n"
            "ИЗ\n    Справочник.Пользователи КАК Пользователь\n"
            "ГДЕ\n    НЕ Пользователь.ПометкаУдаления\n"
            "    И НЕ Пользователь.Недействителен\n"
            "    И НЕ Пользователь.Служебный\n"
            "УПОРЯДОЧИТЬ ПО\n    Пользователь.Ссылка"
        )
        try:
            query = connection.NewObject("Query")
            query.Text = query_text
            selection = query.Execute().Select()
            rows: list[dict[str, Any]] = []
            while bool(selection.Next()):
                name = _connection_text(connection, getattr(selection, "Представление", ""))
                department = _connection_text(connection, getattr(selection, "Подразделение", ""))
                if normalized_search and normalized_search not in f"{name} {department}".casefold():
                    continue
                ref = _ref_uuid(connection, getattr(selection, "Ссылка", None))
                if ref:
                    rows.append({"ref": ref, "name": name or "Пользователь 1С", "department": department or None})
                if len(rows) > normalized_limit:
                    break
        except Exception:
            raise Docflow1CMappingError(
                "Поиск исполнителей не совместим с текущими метаданными 1С"
            ) from None
        truncated = len(rows) > normalized_limit
        page = rows[:normalized_limit]
        return {
            "items": page,
            "returned": len(page),
            "truncated": truncated,
            "as_of": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _visible_assignment_reference(
        connection: Any,
        *,
        entity_name: str,
        reference: Any,
        label: str,
    ) -> Any:
        active_user_filter = (
            "\n    И НЕ Объект.Недействителен\n    И НЕ Объект.Служебный"
            if entity_name == "Пользователи"
            else ""
        )
        query_text = (
            "ВЫБРАТЬ ПЕРВЫЕ 1\n"
            "    Объект.Ссылка КАК Ссылка\n"
            f"ИЗ\n    Справочник.{entity_name} КАК Объект\n"
            "ГДЕ\n    Объект.Ссылка = &Ссылка\n"
            "    И НЕ Объект.ПометкаУдаления"
            + active_user_filter
        )
        try:
            query = connection.NewObject("Query")
            query.Text = query_text
            query.SetParameter("Ссылка", reference)
            selection = query.Execute().Select()
            if not bool(selection.Next()):
                raise Docflow1CNotFoundError(f"{label} не найден или недоступен пользователю")
            return getattr(selection, "Ссылка", None)
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError(f"Не удалось проверить {label.lower()} в 1С") from None

    def get_assignment_state(
        self,
        *,
        login: str,
        password: str,
        process_ref: str,
    ) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        process_type = _identifier_from_env("DOCFLOW_1C_ASSIGNMENT_PROCESS_TYPE", "Поручение")
        task_type = _identifier_from_env("DOCFLOW_1C_TASK_TYPE", "ЗадачаИсполнителя")
        process_reference = self._reference_from_uuid(
            connection,
            manager_names=("БизнесПроцессы", "BusinessProcesses"),
            entity_name=process_type,
            ref=process_ref,
            label="Процесс поручения",
        )
        current_user = self._session_user(connection)
        process_query_text = (
            "ВЫБРАТЬ ПЕРВЫЕ 1\n"
            "    Процесс.Ссылка КАК Ссылка,\n"
            "    Процесс.Наименование КАК Наименование,\n"
            "    ПРЕДСТАВЛЕНИЕ(Процесс.Состояние) КАК Состояние\n"
            f"ИЗ\n    БизнесПроцесс.{process_type} КАК Процесс\n"
            "ГДЕ\n    Процесс.Ссылка = &Процесс\n"
            "    И Процесс.Автор = &ТекущийПользователь"
        )
        try:
            query = connection.NewObject("Query")
            query.Text = process_query_text
            query.SetParameter("Процесс", process_reference)
            query.SetParameter("ТекущийПользователь", current_user)
            selection = query.Execute().Select()
            if not bool(selection.Next()):
                return {"exists": False, "process_ref": str(process_ref), "task_ref": None}
            title = _connection_text(connection, getattr(selection, "Наименование", ""))
            state = _connection_text(connection, getattr(selection, "Состояние", ""))

            task_query = connection.NewObject("Query")
            task_query.Text = (
                "ВЫБРАТЬ ПЕРВЫЕ 1\n"
                "    Задача.Ссылка КАК Ссылка,\n"
                "    ПРЕДСТАВЛЕНИЕ(Задача.Ссылка) КАК Представление,\n"
                "    Задача.Выполнена КАК Выполнена\n"
                f"ИЗ\n    Задача.{task_type} КАК Задача\n"
                "ГДЕ\n    Задача.БизнесПроцесс = &Процесс\n"
                "УПОРЯДОЧИТЬ ПО\n    Задача.Ссылка УБЫВ"
            )
            task_query.SetParameter("Процесс", process_reference)
            task_selection = task_query.Execute().Select()
            task_ref = None
            task_title = None
            task_completed = None
            if bool(task_selection.Next()):
                task_ref = _ref_uuid(connection, getattr(task_selection, "Ссылка", None)) or None
                task_title = _connection_text(connection, getattr(task_selection, "Представление", "")) or None
                task_completed = bool(getattr(task_selection, "Выполнена", False))
            return {
                "exists": True,
                "process_ref": _ref_uuid(connection, getattr(selection, "Ссылка", None)) or str(process_ref),
                "task_ref": task_ref,
                "title": title or task_title or "Поручение 1С",
                "state": state or None,
                "task_completed": task_completed,
            }
        except Docflow1CError:
            raise
        except Exception:
            raise Docflow1CMappingError("Не удалось проверить созданное поручение в 1С") from None

    def create_assignment(
        self,
        *,
        login: str,
        password: str,
        process_ref: str,
        document_type: str,
        document_ref: str,
        assignee_ref: str,
        controller_ref: str,
        due_at: str,
        importance: str,
        title: str,
        description: str,
    ) -> dict[str, Any]:
        connection = self._connect(login=login, password=password)
        process_type = _identifier_from_env("DOCFLOW_1C_ASSIGNMENT_PROCESS_TYPE", "Поручение")
        entity_name = self._assignment_document_type(document_type)
        document_reference = self._reference_from_uuid(
            connection,
            manager_names=("Справочники", "Catalogs"),
            entity_name=entity_name,
            ref=document_ref,
            label="Документ",
        )
        document_reference = self._visible_assignment_reference(
            connection,
            entity_name=entity_name,
            reference=document_reference,
            label="Документ",
        )
        assignee_reference = self._reference_from_uuid(
            connection,
            manager_names=("Справочники", "Catalogs"),
            entity_name="Пользователи",
            ref=assignee_ref,
            label="Исполнитель",
        )
        assignee_reference = self._visible_assignment_reference(
            connection,
            entity_name="Пользователи",
            reference=assignee_reference,
            label="Исполнитель",
        )
        controller_reference = None
        if str(controller_ref or "").strip():
            controller_reference = self._reference_from_uuid(
                connection,
                manager_names=("Справочники", "Catalogs"),
                entity_name="Пользователи",
                ref=controller_ref,
                label="Контролёр",
            )
            controller_reference = self._visible_assignment_reference(
                connection,
                entity_name="Пользователи",
                reference=controller_reference,
                label="Контролёр",
            )
        try:
            deadline = datetime.fromisoformat(str(due_at or "").replace("Z", "+00:00"))
            if deadline.tzinfo is not None:
                deadline = deadline.astimezone().replace(tzinfo=None)
        except (TypeError, ValueError):
            raise Docflow1CMappingError("Некорректный срок поручения") from None
        if deadline <= datetime.now().replace(tzinfo=None):
            raise Docflow1CMappingError("Срок поручения должен быть в будущем")

        process_reference = self._reference_from_uuid(
            connection,
            manager_names=("БизнесПроцессы", "BusinessProcesses"),
            entity_name=process_type,
            ref=process_ref,
            label="Процесс поручения",
        )
        current_user = self._session_user(connection)
        normalized_importance = _text(importance, maximum=16).lower()
        if normalized_importance not in {"normal", "high"}:
            raise Docflow1CMappingError("Важность поручения не разрешена")
        mutation_started = False
        try:
            managers = _getattr_any(connection, "БизнесПроцессы", "BusinessProcesses")
            manager = getattr(managers, process_type)
            process_object = _call_any(manager, ("СоздатьБизнесПроцесс", "CreateBusinessProcess"))
            _call_any(process_object, ("УстановитьСсылкуНового", "SetNewObjectRef"), process_reference)
            setattr(process_object, "Автор", current_user)
            setattr(process_object, "Исполнитель", assignee_reference)
            if controller_reference is not None:
                setattr(process_object, "Контролер", controller_reference)
            setattr(process_object, "Наименование", _text(title, maximum=200))
            setattr(process_object, "Описание", _text(description, maximum=2000))
            setattr(process_object, "СрокИсполнения", deadline)
            enum_name = _identifier_from_env(
                "DOCFLOW_1C_ASSIGNMENT_IMPORTANCE_ENUM",
                "ВариантыВажностиЗадачи",
            )
            enum_value_name = _identifier_from_env(
                "DOCFLOW_1C_ASSIGNMENT_IMPORTANCE_HIGH" if normalized_importance == "high" else "DOCFLOW_1C_ASSIGNMENT_IMPORTANCE_NORMAL",
                "Высокая" if normalized_importance == "high" else "Обычная",
            )
            enum_managers = _getattr_any(connection, "Перечисления", "Enums")
            setattr(process_object, "Важность", getattr(getattr(enum_managers, enum_name), enum_value_name))
            subjects = _getattr_any(process_object, "Предметы", "Subjects")
            subject_row = _call_any(subjects, ("Добавить", "Add"))
            setattr(subject_row, "Предмет", document_reference)
            mutation_started = True
            _call_any(process_object, ("Записать", "Write"))
            _call_any(process_object, ("Старт", "Start"))
        except Docflow1CError:
            raise
        except Exception:
            if mutation_started:
                raise Docflow1COutcomeUnknownError(
                    "1С не подтвердила создание и запуск поручения"
                ) from None
            raise Docflow1CMappingError(
                "Процесс поручения не совместим с текущими метаданными 1С"
            ) from None

        state = self.get_assignment_state(
            login=login,
            password=password,
            process_ref=process_ref,
        )
        if not bool(state.get("exists")):
            raise Docflow1COutcomeUnknownError("1С не подтвердила созданное поручение")
        return state
