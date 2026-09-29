"""Environment-driven configuration for the voice server.

Production runs on PostgreSQL only: set VOICE_DATABASE_URL (falls back to
APP_DATABASE_URL when both point at the same PostgreSQL instance — the service
uses its own ``voice`` schema).
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency
    load_dotenv = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
if load_dotenv is not None and ROOT_ENV_PATH.exists():
    load_dotenv(str(ROOT_ENV_PATH))

DEFAULT_VOICEVIDEO_ROOT = PROJECT_ROOT / "voice_video"
if not DEFAULT_VOICEVIDEO_ROOT.exists():
    # Fallback: legacy location before the pipeline was moved into the monorepo.
    DEFAULT_VOICEVIDEO_ROOT = Path(r"C:\Project\VoiceVideo")


def _to_bool(value: object, default: bool) -> bool:
    if value is None:
        return default
    text = str(value).strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


def _to_int(value: object, default: int) -> int:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class VoiceServerConfig:
    host: str
    port: int
    database_url: str
    web_auth_me_url: str
    web_auth_timeout_sec: int
    web_auth_cache_ttl_sec: int
    voicevideo_root: Path
    voicevideo_python: str
    data_dir: Path
    upload_max_bytes: int
    worker_enabled: bool
    worker_interval_sec: int
    worker_concurrency: int
    job_timeout_sec: int
    log_tail_lines: int
    archive_dir: "Path | None"
    archive_enabled: bool
    archive_dry_run: bool
    source_ttl_days: int

    @classmethod
    def from_env(cls) -> "VoiceServerConfig":
        database_url = str(
            os.getenv("VOICE_DATABASE_URL")
            or os.getenv("APP_DATABASE_URL")
            or ""
        ).strip()
        if not database_url:
            raise RuntimeError(
                "VOICE_DATABASE_URL (or APP_DATABASE_URL) must be configured; "
                "the voice server stores the job registry in PostgreSQL schema 'voice'"
            )
        data_dir = Path(
            os.getenv("VOICE_SERVER_DATA_DIR", str(PROJECT_ROOT / "data" / "voice_server"))
        )
        vv_root = Path(
            os.getenv("VOICEVIDEO_ROOT", str(DEFAULT_VOICEVIDEO_ROOT))
        ).resolve()
        return cls(
            host=str(os.getenv("VOICE_SERVER_HOST", "127.0.0.1")).strip() or "127.0.0.1",
            port=max(1, _to_int(os.getenv("VOICE_SERVER_PORT", "8013"), 8013)),
            database_url=database_url,
            web_auth_me_url=str(
                os.getenv("VOICE_WEB_AUTH_ME_URL", "http://127.0.0.1:8001/api/v1/auth/me")
            ).strip() or "http://127.0.0.1:8001/api/v1/auth/me",
            web_auth_timeout_sec=max(
                1, min(30, _to_int(os.getenv("VOICE_WEB_AUTH_TIMEOUT_SEC", "5"), 5))
            ),
            web_auth_cache_ttl_sec=max(
                0, min(30, _to_int(os.getenv("VOICE_WEB_AUTH_CACHE_TTL_SEC", "5"), 5))
            ),
            voicevideo_root=vv_root,
            voicevideo_python=str(
                os.getenv("VOICEVIDEO_PYTHON", sys.executable)
            ).strip() or sys.executable,
            data_dir=data_dir,
            upload_max_bytes=max(
                64 * 1024 * 1024,
                _to_int(
                    os.getenv("VOICE_UPLOAD_MAX_BYTES", str(4 * 1024 * 1024 * 1024)),
                    4 * 1024 * 1024 * 1024,
                ),
            ),
            worker_enabled=_to_bool(os.getenv("VOICE_WORKER_ENABLED", "1"), True),
            worker_interval_sec=max(
                1, min(60, _to_int(os.getenv("VOICE_WORKER_INTERVAL_SEC", "3"), 3))
            ),
            # GPU-bound pipeline: one job at a time by default.
            worker_concurrency=max(
                1, min(4, _to_int(os.getenv("VOICE_WORKER_CONCURRENCY", "1"), 1))
            ),
            job_timeout_sec=max(
                600, _to_int(os.getenv("VOICE_JOB_TIMEOUT_SEC", str(10 * 3600)), 10 * 3600)
            ),
            log_tail_lines=max(
                50, min(2000, _to_int(os.getenv("VOICE_LOG_TAIL_LINES", "400"), 400))
            ),
            archive_dir=(
                Path(os.getenv("VOICEVIDEO_ARCHIVE_DIR", "").strip())
                if os.getenv("VOICEVIDEO_ARCHIVE_DIR", "").strip()
                else None
            ),
            archive_enabled=_to_bool(os.getenv("VOICE_ARCHIVE_ENABLED", "0"), False),
            archive_dry_run=_to_bool(os.getenv("VOICE_ARCHIVE_DRY_RUN", "1"), True),
            source_ttl_days=max(
                1, _to_int(os.getenv("VOICEVIDEO_SOURCE_TTL_DAYS", "7"), 7)
            ),
        )


config = VoiceServerConfig.from_env()
