import json
import logging
import re
import secrets
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, constr
from sqlalchemy import select

from backend.api.deps import require_permission
from backend.appdb.db import app_session, initialize_app_schema, is_app_database_configured
from backend.appdb.models import AppGlobalSetting, AppVcsComputer
from backend.models.auth import User
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.authorization_service import PERM_VCS_READ, PERM_VCS_MANAGE, authorization_service
from backend.services.secret_crypto_service import encrypt_secret, decrypt_secret
from local_store import get_local_store

logger = logging.getLogger(__name__)

router = APIRouter()

VCS_STORE_KEY = "vcs_computers.json"
VCS_CONFIG_KEY = "vcs_config.json"
VCS_CONFIG_APP_KEY = "vcs_config"
VCS_INFO_APP_KEY = "vcs_info"
VCS_LAUNCH_TOKEN_NAMESPACE = "vcs_launch"
VCS_LAUNCH_TOKEN_TTL_SECONDS = 60


def _to_iso_utc(value) -> str:
    if isinstance(value, datetime):
        dt_value = value
    else:
        text = str(value or "").strip()
        if not text:
            dt_value = datetime.now(timezone.utc)
        else:
            dt_value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if dt_value.tzinfo is None:
        dt_value = dt_value.replace(tzinfo=timezone.utc)
    return dt_value.astimezone(timezone.utc).isoformat()

class VcsComputer(BaseModel):
    id: str
    name: str
    ip_address: str
    location: Optional[str] = ""
    created_at: str
    updated_at: str

class VcsComputerCreate(BaseModel):
    name: str = constr(min_length=1, max_length=100)
    ip_address: str = constr(min_length=7, max_length=50) 
    location: Optional[str] = ""

class VcsComputerUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    location: Optional[str] = None

class VcsConfig(BaseModel):
    password_hex: str = ""
    password_configured: bool = False
    
class VcsConfigUpdate(BaseModel):
    password_hex: str

class VcsLaunchToken(BaseModel):
    token: str
    expires_in_seconds: int

class VcsInfo(BaseModel):
    content: str = ""

class VcsInfoUpdate(BaseModel):
    content: str

def _get_all_computers() -> List[dict]:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            rows = session.scalars(select(AppVcsComputer).order_by(AppVcsComputer.created_at.asc(), AppVcsComputer.name.asc())).all()
            return [
                {
                    "id": str(row.id),
                    "name": str(row.name),
                    "ip_address": str(row.ip_address),
                    "location": str(row.location or ""),
                    "created_at": _to_iso_utc(row.created_at),
                    "updated_at": _to_iso_utc(row.updated_at),
                }
                for row in rows
            ]
    store = get_local_store()
    data = store.load_json(VCS_STORE_KEY, default_content=[])
    if not isinstance(data, list):
         return []
    return data

def _save_all_computers(data: List[dict]) -> bool:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            existing_rows = session.scalars(select(AppVcsComputer)).all()
            existing_by_id = {str(row.id): row for row in existing_rows}
            incoming_ids: set[str] = set()
            for item in data:
                normalized_id = str((item or {}).get("id") or "").strip()
                if not normalized_id:
                    continue
                incoming_ids.add(normalized_id)
                row = existing_by_id.get(normalized_id)
                if row is None:
                    row = AppVcsComputer(id=normalized_id)
                    session.add(row)
                row.name = str((item or {}).get("name") or "").strip()
                row.ip_address = str((item or {}).get("ip_address") or "").strip()
                row.location = str((item or {}).get("location") or "").strip() or None
                created_at = str((item or {}).get("created_at") or "").strip()
                updated_at = str((item or {}).get("updated_at") or "").strip()
                row.created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00")) if created_at else datetime.now(timezone.utc)
                row.updated_at = datetime.fromisoformat(updated_at.replace("Z", "+00:00")) if updated_at else datetime.now(timezone.utc)
            for row_id, row in existing_by_id.items():
                if row_id not in incoming_ids:
                    session.delete(row)
        return True
    store = get_local_store()
    return store.save_json(VCS_STORE_KEY, data)

def _get_vcs_config() -> dict:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            row = session.get(AppGlobalSetting, VCS_CONFIG_APP_KEY)
            if row is None:
                return {"password_hex_encrypted": ""}
            try:
                payload = json.loads(str(row.value_json or "{}"))
            except Exception:
                payload = {}
            return payload if isinstance(payload, dict) else {"password_hex_encrypted": ""}
    store = get_local_store()
    data = store.load_json(VCS_CONFIG_KEY, default_content={"password_hex_encrypted": ""})
    if not isinstance(data, dict):
        return {"password_hex_encrypted": ""}
    return data

def _decrypt_vcs_password_hex() -> str:
    config_data = _get_vcs_config()
    encrypted_hex = str(config_data.get("password_hex_encrypted", "") or "").strip()
    if not encrypted_hex:
        return ""
    try:
        return decrypt_secret(encrypted_hex).strip().lower()
    except Exception as exc:
        logger.error("Failed to decrypt VCS password_hex: %s", exc)
        return ""

def _has_vcs_password() -> bool:
    return bool(str(_get_vcs_config().get("password_hex_encrypted", "") or "").strip())

def _user_can_manage_vcs(user: User) -> bool:
    if str(getattr(user, "role", "") or "").strip().lower() == "admin":
        return True
    if PERM_VCS_MANAGE in set(getattr(user, "permissions", []) or []):
        return True
    return authorization_service.has_permission(
        getattr(user, "role", None),
        PERM_VCS_MANAGE,
        use_custom_permissions=bool(getattr(user, "use_custom_permissions", False)),
        custom_permissions=getattr(user, "custom_permissions", []),
    )

def _redact_vcs_info_content(content: str) -> str:
    try:
        rows = json.loads(str(content or "[]"))
    except Exception:
        return ""
    if not isinstance(rows, list):
        return ""
    redacted_rows = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        redacted = dict(row)
        redacted.pop("password", None)
        redacted_rows.append(redacted)
    return json.dumps(redacted_rows, ensure_ascii=False)

def _find_vcs_computer(computer_id: str) -> dict | None:
    normalized_id = str(computer_id or "").strip()
    if not normalized_id:
        return None
    for item in _get_all_computers():
        if str((item or {}).get("id") or "").strip() == normalized_id:
            return item
    return None

def _split_vnc_endpoint(endpoint: str) -> tuple[str, str]:
    normalized = str(endpoint or "").strip()
    match = re.match(r"^(.+):(\d+)$", normalized)
    if match:
        return match.group(1).strip(), match.group(2).strip()
    return normalized, "5900"

def _safe_vnc_filename(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", str(name or "").strip()).strip("._")
    return f"{normalized or 'vnc'}.vnc"

def _build_vnc_file_content(computer: dict) -> str:
    host, port = _split_vnc_endpoint(str((computer or {}).get("ip_address") or ""))
    password_hex = _decrypt_vcs_password_hex()
    lines = [
        "[connection]",
        f"host={host}",
        f"port={port}",
    ]
    if re.fullmatch(r"[0-9a-f]{16}", password_hex):
        lines.append(f"password={password_hex}")
    lines.extend([
        "",
        "[options]",
        "use_encoding_1=1",
        "copyrect=1",
        "viewonly=0",
        "fullscreen=0",
        "8bit=0",
        "shared=1",
        "belldeiconify=0",
        "disableclipboard=0",
        "swapmouse=0",
        "fitwindow=1",
        "cursorshape=1",
        "noremotecursor=0",
        "preferred_encoding=7",
        "compresslevel=-1",
        "quality=6",
        "localcursor=1",
        "scale_den=1",
        "scale_num=1",
        "local_cursor_shape=1",
    ])
    return "\r\n".join(lines) + "\r\n"

def _save_vcs_config(data: dict) -> bool:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            row = session.get(AppGlobalSetting, VCS_CONFIG_APP_KEY)
            if row is None:
                row = AppGlobalSetting(key=VCS_CONFIG_APP_KEY)
                session.add(row)
            row.value_json = json.dumps(data if isinstance(data, dict) else {"password_hex_encrypted": ""}, ensure_ascii=False)
            row.updated_at = datetime.now(timezone.utc)
        return True
    store = get_local_store()
    return store.save_json(VCS_CONFIG_KEY, data)

VCS_INFO_KEY = "vcs_info.json"

def _get_vcs_info() -> dict:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            row = session.get(AppGlobalSetting, VCS_INFO_APP_KEY)
            if row is None:
                return {"content": ""}
            try:
                payload = json.loads(str(row.value_json or "{}"))
            except Exception:
                payload = {}
            return payload if isinstance(payload, dict) else {"content": ""}
    store = get_local_store()
    data = store.load_json(VCS_INFO_KEY, default_content={"content": ""})
    if not isinstance(data, dict):
        return {"content": ""}
    return data

def _save_vcs_info(data: dict) -> bool:
    if is_app_database_configured():
        initialize_app_schema()
        with app_session() as session:
            row = session.get(AppGlobalSetting, VCS_INFO_APP_KEY)
            if row is None:
                row = AppGlobalSetting(key=VCS_INFO_APP_KEY)
                session.add(row)
            row.value_json = json.dumps(data if isinstance(data, dict) else {"content": ""}, ensure_ascii=False)
            row.updated_at = datetime.now(timezone.utc)
        return True
    store = get_local_store()
    return store.save_json(VCS_INFO_KEY, data)


@router.get("/computers", response_model=List[VcsComputer])
async def get_vcs_computers(
    current_user=Depends(require_permission(PERM_VCS_READ))
):
    """Get list of all VCS terminal computers"""
    computers = _get_all_computers()
    return computers

@router.post("/computers", response_model=VcsComputer)
async def create_vcs_computer(
    computer: VcsComputerCreate,
    current_user=Depends(require_permission(PERM_VCS_MANAGE))
):
    """Add a new VCS terminal computer"""
    computers = _get_all_computers()
    
    now = datetime.now(timezone.utc).isoformat()
    new_comp = {
        "id": str(uuid.uuid4()),
        "name": computer.name.strip(),
        "ip_address": computer.ip_address.strip(),
        "location": computer.location.strip() if computer.location else "",
        "created_at": now,
        "updated_at": now
    }
    
    computers.append(new_comp)
    if not _save_all_computers(computers):
        raise HTTPException(status_code=500, detail="Failed to save data")
        
    return new_comp

@router.put("/computers/{computer_id}", response_model=VcsComputer)
async def update_vcs_computer(
    computer_id: str,
    update_data: VcsComputerUpdate,
    current_user=Depends(require_permission(PERM_VCS_MANAGE))
):
    """Update an existing VCS terminal computer"""
    computers = _get_all_computers()
    
    for i, c in enumerate(computers):
        if c.get("id") == computer_id:
            if update_data.name is not None:
                c["name"] = update_data.name.strip()
            if update_data.ip_address is not None:
                c["ip_address"] = update_data.ip_address.strip()
            if update_data.location is not None:
                c["location"] = update_data.location.strip()
                
            c["updated_at"] = datetime.now(timezone.utc).isoformat()
            
            if not _save_all_computers(computers):
                raise HTTPException(status_code=500, detail="Failed to save data")
            return c
            
    raise HTTPException(status_code=404, detail="Computer not found")

@router.delete("/computers/{computer_id}")
async def delete_vcs_computer(
    computer_id: str,
    current_user=Depends(require_permission(PERM_VCS_MANAGE))
):
    """Delete a VCS terminal computer"""
    computers = _get_all_computers()
    
    filtered_computers = [c for c in computers if c.get("id") != computer_id]
    
    if len(filtered_computers) == len(computers):
        raise HTTPException(status_code=404, detail="Computer not found")
        
    if not _save_all_computers(filtered_computers):
        raise HTTPException(status_code=500, detail="Failed to save data")
        
    return {"success": True}

@router.get("/config", response_model=VcsConfig)
async def get_vcs_config(
    current_user=Depends(require_permission(PERM_VCS_READ))
):
    """Get global VCS configuration status without exposing the stored password."""
    return VcsConfig(password_hex="", password_configured=_has_vcs_password())

@router.put("/config", response_model=VcsConfig)
async def update_vcs_config(
    config_update: VcsConfigUpdate,
    current_user=Depends(require_permission(PERM_VCS_MANAGE))
):
    """Update global VCS configuration, encrypting the password_hex before storing"""
    plain_hex = config_update.password_hex.strip().lower()
    
    # Encrypt
    encrypted_hex = ""
    if plain_hex:
        try:
            encrypted_hex = encrypt_secret(plain_hex)
        except Exception as e:
            logger.error(f"Failed to encrypt VCS password_hex: {e}")
            raise HTTPException(status_code=500, detail="Encryption failed")
            
    # Save
    config_data = _get_vcs_config()
    config_data["password_hex_encrypted"] = encrypted_hex
    if not _save_vcs_config(config_data):
        raise HTTPException(status_code=500, detail="Failed to save config data")
        
    return VcsConfig(password_hex="", password_configured=bool(encrypted_hex))

@router.post("/computers/{computer_id}/launch-token", response_model=VcsLaunchToken)
async def create_vcs_launch_token(
    computer_id: str,
    current_user=Depends(require_permission(PERM_VCS_READ))
):
    """Create a short-lived one-time token for launching a VCS terminal."""
    computer = _find_vcs_computer(computer_id)
    if computer is None:
        raise HTTPException(status_code=404, detail="Computer not found")
    token = secrets.token_urlsafe(32)
    auth_runtime_store_service.set_json(
        VCS_LAUNCH_TOKEN_NAMESPACE,
        token,
        {"computer_id": str(computer_id or "").strip()},
        ttl_seconds=VCS_LAUNCH_TOKEN_TTL_SECONDS,
    )
    return VcsLaunchToken(token=token, expires_in_seconds=VCS_LAUNCH_TOKEN_TTL_SECONDS)

@router.get("/launch/{token}.vnc")
async def redeem_vcs_launch_token(token: str):
    """Redeem a one-time launch token for a generated VNC options file."""
    payload = auth_runtime_store_service.pop_json(VCS_LAUNCH_TOKEN_NAMESPACE, str(token or "").strip())
    if not isinstance(payload, dict):
        raise HTTPException(status_code=404, detail="Launch token expired")
    computer = _find_vcs_computer(str(payload.get("computer_id") or ""))
    if computer is None:
        raise HTTPException(status_code=404, detail="Computer not found")
    filename = _safe_vnc_filename(str(computer.get("name") or computer.get("ip_address") or "vnc"))
    return Response(
        content=_build_vnc_file_content(computer),
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

@router.get("/info", response_model=VcsInfo)
async def get_vcs_info(
    current_user=Depends(require_permission(PERM_VCS_READ))
):
    """Get global VCS info (markdown content)"""
    info_data = _get_vcs_info()
    content = str(info_data.get("content", "") or "")
    if not _user_can_manage_vcs(current_user):
        content = _redact_vcs_info_content(content)
    return VcsInfo(content=content)

@router.put("/info", response_model=VcsInfo)
async def update_vcs_info(
    info_update: VcsInfoUpdate,
    current_user=Depends(require_permission(PERM_VCS_MANAGE))
):
    """Update global VCS info (markdown content)"""
    info_data = _get_vcs_info()
    info_data["content"] = info_update.content
    
    if not _save_vcs_info(info_data):
        raise HTTPException(status_code=500, detail="Failed to save VCS info")
        
    return VcsInfo(content=info_update.content)
