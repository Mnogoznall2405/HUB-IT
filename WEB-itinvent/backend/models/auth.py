"""
Authentication and user models.
"""
from pydantic import BaseModel, EmailStr, Field, field_validator
from typing import Any, Optional, Literal


class UserBase(BaseModel):
    """Base user model."""
    username: str = Field(..., min_length=3, max_length=50)
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    department: Optional[str] = None
    job_title: Optional[str] = None


class UserCreate(UserBase):
    """Model for user registration."""
    password: str = Field(..., min_length=6)


class UserInDB(UserBase):
    """User model as stored in database."""
    id: int
    is_active: bool = True
    hashed_password: str


class User(UserBase):
    """User model returned to clients (without password)."""
    id: int
    is_active: bool = True
    role: Literal["admin", "operator", "viewer"] = "viewer"
    permissions: list[str] = Field(default_factory=list)
    use_custom_permissions: bool = False
    custom_permissions: list[str] = Field(default_factory=list)
    auth_source: Literal["local", "ldap"] = "local"
    telegram_id: Optional[int] = None
    assigned_database: Optional[str] = None
    mailbox_email: Optional[EmailStr] = None
    mailbox_login: Optional[str] = None
    mail_signature_html: Optional[str] = None
    mail_is_configured: bool = False
    is_2fa_enabled: bool = False
    trusted_devices_count: int = 0
    discoverable_trusted_devices_count: int = 0
    twofa_enforced: bool = False
    network_zone: Literal["internal", "external"] = "external"
    twofa_policy: Literal["off", "all", "external_only"] = "off"
    twofa_required_for_current_request: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    mail_updated_at: Optional[str] = None


class LoginRequest(BaseModel):
    """Login request model."""
    username: str = Field(..., min_length=3)
    password: str = Field(..., min_length=1)


class LoginResponse(BaseModel):
    """Login response with token and user info."""
    status: Literal["authenticated", "2fa_required", "2fa_setup_required"] = "authenticated"
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: Optional[User] = None
    session_id: Optional[str] = None
    login_challenge_id: Optional[str] = None
    available_second_factors: list[str] = Field(default_factory=list)
    trusted_devices_available: bool = False


class LoginModeResponse(BaseModel):
    network_zone: Literal["internal", "external"] = "external"
    biometric_login_enabled: bool = False


class TwoFactorSetupStartRequest(BaseModel):
    login_challenge_id: str = Field(..., min_length=8)


class TwoFactorSetupResponse(BaseModel):
    login_challenge_id: str
    otpauth_uri: str
    issuer: str
    account_name: str
    manual_entry_key: str
    qr_svg: Optional[str] = None


class TwoFactorSetupVerifyRequest(BaseModel):
    login_challenge_id: str = Field(..., min_length=8)
    totp_code: str = Field(..., min_length=6, max_length=16)


class TrustedDeviceInfo(BaseModel):
    id: str
    label: str
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None
    is_active: bool = True
    is_expired: bool = False
    is_discoverable: bool = False
    transports: list[str] = Field(default_factory=list)
    is_current_device: bool = False


class TwoFactorSetupVerifyResponse(LoginResponse):
    backup_codes: list[str] = Field(default_factory=list)


class TwoFactorLoginVerifyRequest(BaseModel):
    login_challenge_id: str = Field(..., min_length=8)
    totp_code: Optional[str] = Field(default=None, min_length=6, max_length=16)
    backup_code: Optional[str] = Field(default=None, min_length=6, max_length=32)


class BackupCodesResponse(BaseModel):
    backup_codes: list[str] = Field(default_factory=list)


class RefreshResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    user: Optional[User] = None
    session_id: Optional[str] = None


class TrustedDeviceRegistrationOptionsRequest(BaseModel):
    label: Optional[str] = None
    platform_only: bool = False


class TrustedDeviceRegistrationVerifyRequest(BaseModel):
    challenge_id: str = Field(..., min_length=8)
    credential: dict[str, Any] = Field(default_factory=dict)
    label: Optional[str] = None


class TrustedDeviceAuthOptionsRequest(BaseModel):
    login_challenge_id: str = Field(..., min_length=8)


class TrustedDeviceAuthVerifyRequest(BaseModel):
    login_challenge_id: str = Field(..., min_length=8)
    challenge_id: str = Field(..., min_length=8)
    credential: dict[str, Any] = Field(default_factory=dict)


class PasskeyLoginVerifyRequest(BaseModel):
    challenge_id: str = Field(..., min_length=8)
    credential: dict[str, Any] = Field(default_factory=dict)


class ChangePasswordRequest(BaseModel):
    """Change password request."""
    old_password: str
    new_password: str = Field(..., min_length=6)


class UserCreateRequest(BaseModel):
    """Admin request model to create user."""
    username: str = Field(..., min_length=3, max_length=50)
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    department: Optional[str] = None
    job_title: Optional[str] = None
    role: Literal["admin", "operator", "viewer"] = "viewer"
    auth_source: Literal["local", "ldap"] = "local"
    telegram_id: Optional[int] = None
    assigned_database: Optional[str] = None
    is_active: bool = True
    use_custom_permissions: bool = False
    custom_permissions: list[str] = Field(default_factory=list)
    mailbox_email: Optional[EmailStr] = None
    mailbox_login: Optional[str] = None
    mailbox_password: Optional[str] = Field(default=None, min_length=1, max_length=256)
    mail_signature_html: Optional[str] = None

    @field_validator(
        "mailbox_email",
        "email",
        "full_name",
        "department",
        "job_title",
        "assigned_database",
        "password",
        "mailbox_login",
        "mailbox_password",
        "mail_signature_html",
        mode="before",
    )
    @classmethod
    def _blank_str_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("telegram_id", mode="before")
    @classmethod
    def _blank_telegram_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


class UserUpdateRequest(BaseModel):
    """Admin request model to update user."""
    email: Optional[EmailStr] = None
    full_name: Optional[str] = None
    department: Optional[str] = None
    job_title: Optional[str] = None
    role: Optional[Literal["admin", "operator", "viewer"]] = None
    auth_source: Optional[Literal["local", "ldap"]] = None
    telegram_id: Optional[int] = None
    assigned_database: Optional[str] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    use_custom_permissions: Optional[bool] = None
    custom_permissions: Optional[list[str]] = None
    mailbox_email: Optional[EmailStr] = None
    mailbox_login: Optional[str] = None
    mailbox_password: Optional[str] = Field(default=None, min_length=1, max_length=256)
    mail_signature_html: Optional[str] = None

    @field_validator(
        "mailbox_email",
        "email",
        "full_name",
        "department",
        "job_title",
        "assigned_database",
        "mailbox_login",
        "mailbox_password",
        "mail_signature_html",
        mode="before",
    )
    @classmethod
    def _blank_str_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("telegram_id", mode="before")
    @classmethod
    def _blank_telegram_to_none(cls, value):
        if value is None:
            return None
        if isinstance(value, str) and not value.strip():
            return None
        return value


class TaskDelegateLink(BaseModel):
    owner_user_id: int
    delegate_user_id: int
    role_type: Literal["assistant", "deputy"] = "assistant"
    is_active: bool = True
    delegate_username: Optional[str] = None
    delegate_full_name: Optional[str] = None
    delegate_department: Optional[str] = None
    delegate_job_title: Optional[str] = None
    delegate_is_active: bool = True


class TaskDelegateLinkWrite(BaseModel):
    delegate_user_id: int = Field(..., ge=1)
    role_type: Literal["assistant", "deputy"] = "assistant"
    is_active: bool = True


class TaskDelegateLinksUpdateRequest(BaseModel):
    items: list[TaskDelegateLinkWrite] = Field(default_factory=list)


class SessionInfo(BaseModel):
    """Active session information."""
    session_id: str
    user_id: int
    username: str
    role: str = "viewer"
    ip_address: str = ""
    user_agent: str = ""
    created_at: str
    last_seen_at: str
    expires_at: str
    idle_expires_at: Optional[str] = None
    is_active: bool = True
    status: str = "active"
    closed_at: Optional[str] = None
    closed_reason: Optional[str] = None
    device_label: Optional[str] = None
