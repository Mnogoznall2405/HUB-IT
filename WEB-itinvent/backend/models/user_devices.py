from pydantic import BaseModel, Field


class OwnDeviceSession(BaseModel):
    session_id: str
    created_at: str
    last_seen_at: str
    ip_address: str = ""
    device_label: str = ""
    is_current: bool = False


class OwnDeviceInfo(BaseModel):
    id: str
    label: str
    is_current: bool = False
    biometric_enabled: bool = False
    last_seen_at: str | None = None
    sessions: list[OwnDeviceSession] = Field(default_factory=list)


class OwnDeviceActionResult(BaseModel):
    success: bool = True
    closed_sessions: int = 0
    revoked_biometric_credentials: int = 0
    current_session_closed: bool = False
