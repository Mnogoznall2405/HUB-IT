"""
Configuration management for IT-invent Web application.
Loads settings from environment variables with sensible defaults.
"""
import os
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional
from dotenv import load_dotenv

# Single source of truth: project root .env
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
LEGACY_BACKEND_ENV_PATH = Path(__file__).resolve().parent / ".env"
LEGACY_API_ENV_PATH = Path(__file__).resolve().parent / "api" / ".env"

if ROOT_ENV_PATH.exists():
    load_dotenv(str(ROOT_ENV_PATH))
    if LEGACY_BACKEND_ENV_PATH.exists():
        warnings.warn(
            f"Legacy env file is ignored: {LEGACY_BACKEND_ENV_PATH}. Use {ROOT_ENV_PATH} instead.",
            RuntimeWarning,
            stacklevel=2,
        )
    if LEGACY_API_ENV_PATH.exists():
        warnings.warn(
            f"Legacy env file is ignored: {LEGACY_API_ENV_PATH}. Use {ROOT_ENV_PATH} instead.",
            RuntimeWarning,
            stacklevel=2,
        )
else:
    # Backward-compatible fallback.
    if LEGACY_BACKEND_ENV_PATH.exists():
        load_dotenv(str(LEGACY_BACKEND_ENV_PATH))
        warnings.warn(
            f"Root .env not found at {ROOT_ENV_PATH}; loaded fallback {LEGACY_BACKEND_ENV_PATH}.",
            RuntimeWarning,
            stacklevel=2,
        )


@dataclass
class DatabaseConfig:
    """Database connection configuration."""
    host: str
    database: str
    username: str
    password: str
    driver: str = "SQL Server"

    @property
    def connection_string(self) -> str:
        """Build ODBC connection string."""
        return (
            f"DRIVER={self.driver};"
            f"SERVER={self.host};"
            f"DATABASE={self.database};"
            f"UID={self.username};"
            f"PWD={self.password};"
            "TrustServerCertificate=yes;"
            "autocommit=True;"
        )


@dataclass
class JWTConfig:
    """JWT token configuration."""
    secret_key: str
    previous_secret_keys: List[str]
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7


@dataclass
class SessionConfig:
    """Web session lifecycle configuration."""

    idle_timeout_minutes: int = 30
    history_retention_days: int = 14
    cleanup_min_interval_seconds: int = 300


@dataclass
class AppConfig:
    """Application configuration."""
    app_name: str = "IT-invent Web API"
    version: str = "1.0.0"
    debug: bool = False
    cors_origins: List[str] = None
    auth_cookie_name: str = "itinvent_access_token"
    auth_refresh_cookie_name: str = "itinvent_refresh_token"
    auth_cookie_secure: bool = False
    auth_cookie_samesite: str = "strict"
    auth_cookie_domain: Optional[str] = None
    ldap_server: Optional[str] = None
    ldap_domain: Optional[str] = None

    def __post_init__(self):
        if self.cors_origins is None:
            self.cors_origins = ["http://localhost:5173", "http://localhost:3000"]


@dataclass
class ChatConfig:
    """Optional chat-module configuration backed by PostgreSQL."""

    enabled: bool = False
    database_url: Optional[str] = None
    pool_size: int = 5
    max_overflow: int = 10
    conversation_page_size: int = 50
    message_page_size: int = 100


@dataclass
class AppDatabaseConfig:
    """Unified internal application database configuration."""

    database_url: Optional[str] = None
    pool_size: int = 5
    max_overflow: int = 10
    echo: bool = False


@dataclass
class WebPushConfig:
    """Browser Web Push configuration."""

    public_key: Optional[str] = None
    private_key: Optional[str] = None
    subject: Optional[str] = None

    @property
    def enabled(self) -> bool:
        return bool(
            str(self.public_key or "").strip()
            and str(self.private_key or "").strip()
            and str(self.subject or "").strip()
        )


@dataclass
class RedisConfig:
    """Redis-compatible runtime state storage."""

    url: Optional[str] = None
    password: Optional[str] = None

    @property
    def configured(self) -> bool:
        return bool(str(self.url or "").strip())


@dataclass
class AuthSecurityConfig:
    """Security and authentication flow configuration."""

    twofa_enforced: bool = True
    twofa_policy: str = "all"
    twofa_internal_cidrs: List[str] = None
    trusted_proxy_cidrs: List[str] = None
    totp_issuer: str = "HUB-IT"
    twofa_challenge_ttl_sec: int = 300
    backup_codes_count: int = 10
    webauthn_rp_id: Optional[str] = None
    webauthn_rp_name: str = "HUB-IT"
    webauthn_origin: Optional[str] = None
    trusted_device_ttl_days: int = 90
    new_login_email_enabled: bool = True
    rate_limit_storage_url: Optional[str] = None

    def __post_init__(self):
        if self.twofa_internal_cidrs is None:
            self.twofa_internal_cidrs = ["10.0.0.0/8"]
        if self.trusted_proxy_cidrs is None:
            self.trusted_proxy_cidrs = ["127.0.0.1/32", "::1/128"]


@dataclass
class Config:
    """Main configuration container."""
    database: DatabaseConfig
    jwt: JWTConfig
    session: SessionConfig
    app: AppConfig
    app_db: AppDatabaseConfig
    chat: ChatConfig
    web_push: WebPushConfig
    redis: RedisConfig
    security: AuthSecurityConfig

    @classmethod
    def from_env(cls) -> "Config":
        """Load configuration from environment variables."""
        jwt_secret_keys_raw = str(os.getenv("JWT_SECRET_KEYS", "") or "").strip()
        jwt_previous_keys_raw = str(os.getenv("JWT_PREVIOUS_SECRET_KEYS", "") or "").strip()

        if jwt_secret_keys_raw:
            secret_keys = [item.strip() for item in jwt_secret_keys_raw.split(",") if item.strip()]
            jwt_secret_key = secret_keys[0] if secret_keys else ""
            jwt_previous_secret_keys = secret_keys[1:]
        else:
            jwt_secret_key = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
            jwt_previous_secret_keys = [
                item.strip() for item in jwt_previous_keys_raw.split(",") if item.strip()
            ]

        cookie_samesite = str(os.getenv("AUTH_COOKIE_SAMESITE", "strict")).strip().lower() or "strict"
        if cookie_samesite not in {"lax", "strict", "none"}:
            cookie_samesite = "strict"

        return cls(
            database=DatabaseConfig(
                host=os.getenv("SQL_SERVER_HOST", "10.103.0.213"),
                database=os.getenv("SQL_SERVER_DATABASE", "ITINVENT"),
                username=os.getenv("SQL_SERVER_USERNAME", "ROUser"),
                password=os.getenv("SQL_SERVER_PASSWORD", ""),
                driver=os.getenv("SQL_SERVER_DRIVER", "SQL Server"),
            ),
            jwt=JWTConfig(
                secret_key=jwt_secret_key,
                previous_secret_keys=jwt_previous_secret_keys,
                access_token_expire_minutes=int(
                    os.getenv(
                        "JWT_ACCESS_EXPIRE_MINUTES",
                        os.getenv("JWT_EXPIRE_MINUTES", "15"),
                    )
                ),
                refresh_token_expire_days=int(os.getenv("JWT_REFRESH_EXPIRE_DAYS", "7")),
            ),
            session=SessionConfig(
                idle_timeout_minutes=int(os.getenv("SESSION_IDLE_TIMEOUT_MINUTES", "30")),
                history_retention_days=int(os.getenv("SESSION_HISTORY_RETENTION_DAYS", "14")),
                cleanup_min_interval_seconds=int(os.getenv("SESSION_CLEANUP_MIN_INTERVAL_SECONDS", "300")),
            ),
            app=AppConfig(
                app_name="IT-invent Web API",
                version="1.0.0",
                debug=os.getenv("DEBUG", "false").lower() == "true",
                cors_origins=os.getenv("CORS_ORIGINS", "").split(",") if os.getenv("CORS_ORIGINS") else None,
                auth_cookie_name=str(os.getenv("AUTH_COOKIE_NAME", "itinvent_access_token")).strip() or "itinvent_access_token",
                auth_refresh_cookie_name=str(os.getenv("AUTH_REFRESH_COOKIE_NAME", "itinvent_refresh_token")).strip() or "itinvent_refresh_token",
                auth_cookie_secure=os.getenv("AUTH_COOKIE_SECURE", "false").lower() == "true",
                auth_cookie_samesite=cookie_samesite,
                auth_cookie_domain=(str(os.getenv("AUTH_COOKIE_DOMAIN", "") or "").strip() or None),
                ldap_server=str(os.getenv("LDAP_SERVER", "10.103.0.150")).strip() or None,
                ldap_domain=str(os.getenv("LDAP_DOMAIN", "zsgp.corp")).strip() or None,
            ),
            app_db=AppDatabaseConfig(
                database_url=(str(os.getenv("APP_DATABASE_URL", "") or "").strip() or None),
                pool_size=int(os.getenv("APP_DB_POOL_SIZE", "5")),
                max_overflow=int(os.getenv("APP_DB_MAX_OVERFLOW", "10")),
                echo=str(os.getenv("APP_DB_ECHO", "0")).strip().lower() in {"1", "true", "yes", "on"},
            ),
            chat=ChatConfig(
                enabled=str(os.getenv("CHAT_MODULE_ENABLED", "0")).strip().lower() in {"1", "true", "yes", "on"},
                database_url=(str(os.getenv("CHAT_DATABASE_URL", "") or "").strip() or None),
                pool_size=int(os.getenv("CHAT_DB_POOL_SIZE", "5")),
                max_overflow=int(os.getenv("CHAT_DB_MAX_OVERFLOW", "10")),
                conversation_page_size=int(os.getenv("CHAT_CONVERSATION_PAGE_SIZE", "50")),
                message_page_size=int(os.getenv("CHAT_MESSAGE_PAGE_SIZE", "100")),
            ),
            web_push=WebPushConfig(
                public_key=(str(os.getenv("WEB_PUSH_PUBLIC_KEY", "") or "").strip() or None),
                private_key=(str(os.getenv("WEB_PUSH_PRIVATE_KEY", "") or "").strip() or None),
                subject=(str(os.getenv("WEB_PUSH_SUBJECT", "") or "").strip() or None),
            ),
            redis=RedisConfig(
                url=(str(os.getenv("REDIS_URL", "") or "").strip() or None),
                password=(str(os.getenv("REDIS_PASSWORD", "") or "").strip() or None),
            ),
            security=AuthSecurityConfig(
                twofa_enforced=str(os.getenv("AUTH_2FA_ENFORCED", "1")).strip().lower() in {"1", "true", "yes", "on"},
                twofa_policy=(str(os.getenv("AUTH_2FA_POLICY", "") or "").strip().lower() or ""),
                twofa_internal_cidrs=[
                    item.strip()
                    for item in str(os.getenv("AUTH_2FA_INTERNAL_CIDRS", "10.0.0.0/8") or "").split(",")
                    if item.strip()
                ],
                trusted_proxy_cidrs=[
                    item.strip()
                    for item in str(os.getenv("AUTH_TRUSTED_PROXY_CIDRS", "127.0.0.1/32,::1/128") or "").split(",")
                    if item.strip()
                ],
                totp_issuer=(str(os.getenv("TOTP_ISSUER", "HUB-IT") or "").strip() or "HUB-IT"),
                twofa_challenge_ttl_sec=int(os.getenv("AUTH_2FA_CHALLENGE_TTL_SEC", "300")),
                backup_codes_count=int(os.getenv("AUTH_BACKUP_CODES_COUNT", "10")),
                webauthn_rp_id=(str(os.getenv("WEBAUTHN_RP_ID", "") or "").strip() or None),
                webauthn_rp_name=(str(os.getenv("WEBAUTHN_RP_NAME", "HUB-IT") or "").strip() or "HUB-IT"),
                webauthn_origin=(str(os.getenv("WEBAUTHN_ORIGIN", "") or "").strip() or None),
                trusted_device_ttl_days=int(os.getenv("AUTH_TRUSTED_DEVICE_TTL_DAYS", "90")),
                new_login_email_enabled=str(os.getenv("AUTH_NEW_LOGIN_EMAIL_ENABLED", "1")).strip().lower() in {"1", "true", "yes", "on"},
                rate_limit_storage_url=(str(os.getenv("RATE_LIMIT_STORAGE_URL", "") or "").strip() or None),
            ),
        )


# Global config instance
config = Config.from_env()


def reload_runtime_config() -> Config:
    """Reload config values from the current environment."""
    global config
    if ROOT_ENV_PATH.exists():
        load_dotenv(str(ROOT_ENV_PATH), override=True)
    config = Config.from_env()
    return config
