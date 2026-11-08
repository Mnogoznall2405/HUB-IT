"""ONLYOFFICE Document Server integration primitives (settings, JWT, editor config, callback checks)."""
from __future__ import annotations

import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlsplit

import httpx
from jose import JWTError, jwt


EDITABLE_DOCUMENT_TYPES = {".docx": "word", ".xlsx": "cell", ".pptx": "slide"}

ROLE_OWNER = "owner"
ROLE_EDIT = "edit"
ROLE_COMMENT = "comment"
ROLE_VIEW = "view"
COLLABORATOR_ROLES = (ROLE_EDIT, ROLE_COMMENT, ROLE_VIEW)
# Roles whose changes Document Server may save: editing and comments both live inside the file.
WRITING_ROLES = frozenset({ROLE_OWNER, ROLE_EDIT, ROLE_COMMENT})
EDITING_ROLES = frozenset({ROLE_OWNER, ROLE_EDIT})


def normalize_role(value: str) -> str:
    role = str(value or "").strip().lower()
    return role if role in COLLABORATOR_ROLES else ROLE_EDIT

STATUS_EDITING = 1
STATUS_READY_TO_SAVE = 2
STATUS_SAVE_ERROR = 3
STATUS_CLOSED_NO_CHANGES = 4
STATUS_FORCE_SAVE = 6
STATUS_FORCE_SAVE_ERROR = 7
SAVE_STATUSES = {STATUS_READY_TO_SAVE, STATUS_FORCE_SAVE}

SOURCE_TOKEN_TTL_SEC = 600
_SOURCE_TOKEN_TYPE = "src"
_CALLBACK_TOKEN_TYPE = "cb"
_DS_CACHE_PATH_PREFIX = "/cache/files/"


class OnlyOfficeError(RuntimeError):
    pass


class OnlyOfficeAuthError(OnlyOfficeError):
    pass


class OnlyOfficeDisabledError(OnlyOfficeError):
    pass


@dataclass(frozen=True)
class OnlyOfficeSettings:
    enabled: bool
    jwt_secret: str
    public_path: str
    internal_url: str
    app_base_url: str
    max_versions: int
    token_ttl_sec: int
    fetch_timeout_sec: float


def _flag(name: str) -> bool:
    return str(os.getenv(name, "0") or "0").strip().lower() in {"1", "true", "yes", "on"}


def _int_env(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        return max(minimum, int(str(os.getenv(name, "") or "").strip() or default))
    except ValueError:
        return default


def load_settings() -> OnlyOfficeSettings:
    public_path = "/" + str(os.getenv("ONLYOFFICE_PUBLIC_PATH", "/onlyoffice") or "/onlyoffice").strip().strip("/")
    return OnlyOfficeSettings(
        enabled=_flag("ONLYOFFICE_ENABLED"),
        jwt_secret=str(os.getenv("ONLYOFFICE_JWT_SECRET", "") or "").strip(),
        public_path=public_path,
        internal_url=str(os.getenv("ONLYOFFICE_INTERNAL_URL", "") or "").strip().rstrip("/"),
        app_base_url=str(os.getenv("ONLYOFFICE_APP_BASE_URL", "") or "").strip().rstrip("/"),
        max_versions=_int_env("ONLYOFFICE_MAX_VERSIONS", 20),
        token_ttl_sec=_int_env("ONLYOFFICE_TOKEN_TTL_SEC", 30 * 24 * 3600, minimum=3600),
        fetch_timeout_sec=float(_int_env("ONLYOFFICE_FETCH_TIMEOUT_SEC", 60)),
    )


def require_enabled(settings: OnlyOfficeSettings | None = None) -> OnlyOfficeSettings:
    current = settings or load_settings()
    if not (current.enabled and current.jwt_secret and current.internal_url and current.app_base_url):
        raise OnlyOfficeDisabledError("ONLYOFFICE is not configured")
    return current


def editable_extension(file_name: str) -> str:
    return Path(str(file_name or "")).suffix.lower()


def document_type_for(file_name: str) -> str:
    return EDITABLE_DOCUMENT_TYPES.get(editable_extension(file_name), "")


def build_document_key(file_id: str, revision: int) -> str:
    """Document Server caches sessions by key: it changes once per editing session, not per autosave."""
    return hashlib.sha256(f"{file_id}:{int(revision)}".encode("utf-8")).hexdigest()[:40]


def notify_document_title(settings: OnlyOfficeSettings, *, key: str, title: str) -> bool:
    """Notify live editors only; a failure does not undo a name already saved in HUB."""
    command = {"c": "meta", "key": key, "meta": {"title": title}}
    try:
        with httpx.Client(timeout=min(settings.fetch_timeout_sec, 5.0), follow_redirects=False) as client:
            response = client.post(
                f"{settings.internal_url}/command",
                params={"shardkey": key},
                json={**command, "token": _sign(command, settings.jwt_secret)},
            )
        if response.status_code != 200:
            return False
        result = response.json()
        return (isinstance(result, dict) and type(result.get("error")) is int
                and result["error"] == 0 and result.get("key") == key)
    except (httpx.HTTPError, ValueError):
        return False


def _sign(claims: dict, secret: str) -> str:
    return jwt.encode(claims, secret, algorithm="HS256")


def sign_browser_payload(settings: OnlyOfficeSettings, data: dict) -> str:
    return _sign({**data, "exp": int(time.time()) + SOURCE_TOKEN_TTL_SEC}, settings.jwt_secret)


def _decode(token: str, secret: str) -> dict:
    try:
        return jwt.decode(token, secret, algorithms=["HS256"], options={"verify_aud": False})
    except JWTError as exc:
        raise OnlyOfficeAuthError("Invalid token") from exc


def make_url_token(settings: OnlyOfficeSettings, kind: str, claims: dict, *, ttl_sec: int) -> str:
    return _sign({**claims, "typ": kind, "exp": int(time.time()) + int(ttl_sec)}, settings.jwt_secret)


def make_source_token(settings: OnlyOfficeSettings, *, file_id: str, blob_id: str) -> str:
    # The browser sees this URL in the editor config: keep it short-lived (Document Server fetches it once, on open).
    return make_url_token(settings, _SOURCE_TOKEN_TYPE, {"fid": file_id, "bid": blob_id}, ttl_sec=SOURCE_TOKEN_TTL_SEC)


def make_callback_token(settings: OnlyOfficeSettings, *, file_id: str) -> str:
    # The closing save of a long editing session must still be accepted; the callback body is signed separately.
    return make_url_token(settings, _CALLBACK_TOKEN_TYPE, {"fid": file_id}, ttl_sec=settings.token_ttl_sec)


def read_url_token(settings: OnlyOfficeSettings, token: str, kind: str) -> dict:
    claims = _decode(str(token or ""), settings.jwt_secret)
    if claims.get("typ") != kind:
        raise OnlyOfficeAuthError("Invalid token")
    return claims


def build_editor_config(
    settings: OnlyOfficeSettings,
    *,
    file_id: str,
    file_name: str,
    blob_id: str,
    revision: int,
    user_id: int,
    user_name: str,
    role: str = ROLE_EDIT,
) -> dict:
    can_edit = role in EDITING_ROLES
    can_comment = role in WRITING_ROLES
    source_token = make_source_token(settings, file_id=file_id, blob_id=blob_id)
    callback_token = make_callback_token(settings, file_id=file_id)
    base = f"{settings.app_base_url}/api/v1/my-files/office"
    config = {
        "documentType": document_type_for(file_name),
        "document": {
            "fileType": editable_extension(file_name).lstrip("."),
            "key": build_document_key(file_id, revision),
            "title": file_name,
            "url": f"{base}/source?t={quote(source_token)}",
            "permissions": {"edit": can_edit, "download": True, "print": True, "comment": can_comment},
        },
        "editorConfig": {
            # A commenter opens the editor in "edit" mode with edit=false/comment=true: Document Server limits it to comments.
            "mode": "edit" if can_comment else "view",
            "lang": "ru",
            "callbackUrl": f"{base}/callback?t={quote(callback_token)}",
            "user": {"id": str(int(user_id)), "name": str(user_name or f"user-{user_id}")[:120]},
            # No forcesave: its status-6 callbacks would bump the version (and the key) in the middle of a live session.
            "customization": {"autosave": True, "forcesave": False,
                              "close": {"visible": True, "text": "Закрыть документ"}},
        },
    }
    config["token"] = _sign(config, settings.jwt_secret)
    return config


def verify_callback(settings: OnlyOfficeSettings, body: dict, authorization: str = "") -> dict:
    """Return the signed callback claims; unsigned bodies are rejected."""
    token = str(body.get("token") or "").strip()
    if not token:
        header = str(authorization or "").strip()
        if header.lower().startswith("bearer "):
            token = header[7:].strip()
    if not token:
        raise OnlyOfficeAuthError("Callback is not signed")
    claims = _decode(token, settings.jwt_secret)
    nested = claims.get("payload")
    return nested if isinstance(nested, dict) else claims


def rewrite_document_url(settings: OnlyOfficeSettings, url: str) -> str:
    """Map the browser-facing Document Server URL of the saved file to the internal address."""
    parts = urlsplit(str(url or ""))
    path = parts.path
    prefix = settings.public_path
    if path.startswith(prefix + "/"):
        path = path[len(prefix):]
    if not path.startswith(_DS_CACHE_PATH_PREFIX) or ".." in path:
        raise OnlyOfficeAuthError("Unexpected document URL")
    query = f"?{parts.query}" if parts.query else ""
    return f"{settings.internal_url}{path}{query}"


def fetch_document(settings: OnlyOfficeSettings, url: str, destination: Path, *, max_bytes: int) -> int:
    """Stream the saved document into ``destination`` with a hard size limit."""
    internal_url = rewrite_document_url(settings, url)
    written = 0
    with httpx.Client(timeout=settings.fetch_timeout_sec, follow_redirects=False) as client:
        with client.stream("GET", internal_url) as response:
            if response.status_code != 200:
                raise OnlyOfficeError(f"Document Server returned {response.status_code}")
            with destination.open("wb") as target:
                for chunk in response.iter_bytes(1024 * 1024):
                    written += len(chunk)
                    if written > max_bytes:
                        raise OnlyOfficeError("Saved document exceeds the size limit")
                    target.write(chunk)
    return written
