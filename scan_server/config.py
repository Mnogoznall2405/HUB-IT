from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency for standalone scan_server envs
    load_dotenv = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
SCAN_JOB_MAX_WORKERS_LIMIT = 12
SCAN_OCR_MAX_PROCESSES_DEFAULT = 12
SCAN_OCR_MAX_PROCESSES_LIMIT = 12
if load_dotenv is not None and ROOT_ENV_PATH.exists():
    load_dotenv(str(ROOT_ENV_PATH))


def _to_int(value: str, default: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


def _to_float(value: str, default: float) -> float:
    try:
        return float(str(value).strip())
    except Exception:
        return default


def _to_bool(value: str, default: bool) -> bool:
    text = str(value or "").strip().lower()
    if not text:
        return default
    return text in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class ScanServerConfig:
    host: str
    port: int
    watchdog_enabled: bool
    watchdog_interval_sec: int
    watchdog_timeout_sec: int
    watchdog_failures: int
    watchdog_startup_grace_sec: int
    api_keys: Tuple[str, ...]
    data_dir: Path
    db_path: Path
    archive_dir: Path
    retention_days: int
    task_ttl_days: int
    poll_limit: int
    task_ack_timeout_sec: int
    agent_online_timeout_sec: int
    resolve_agent_sql_context: bool
    ingest_max_pending_pdf_jobs: int
    ingest_max_concurrency: int
    transient_max_gb: float
    ingest_retry_after_sec: int
    job_processing_timeout_sec: int
    scan_job_max_attempts: int
    scan_worker_enabled: bool
    worker_interval_sec: int
    scan_job_max_workers: int
    ocr_enabled: bool
    ocr_tesseract_cmd: str
    ocr_lang: str
    ocr_max_processes: int
    ocr_timeout_sec: int
    ocr_dpi: int
    ocr_only_if_no_text: bool

    @classmethod
    def from_env(cls) -> "ScanServerConfig":
        root = PROJECT_ROOT
        data_dir = Path(
            os.getenv("SCAN_SERVER_DATA_DIR", str(root / "data" / "scan_server"))
        )
        db_path = Path(
            os.getenv("SCAN_SERVER_DB_PATH", str(data_dir / "scan_server.db"))
        )
        archive_dir = Path(
            os.getenv("SCAN_SERVER_ARCHIVE_DIR", str(data_dir / "archive"))
        )
        keys: list[str] = []
        ring_raw = str(os.getenv("SCAN_SERVER_API_KEYS", "") or "").strip()
        if ring_raw:
            for row in ring_raw.split(","):
                key = str(row or "").strip()
                if key and key not in keys:
                    keys.append(key)
        legacy_key = str(os.getenv("SCAN_SERVER_API_KEY", "") or "").strip()
        if legacy_key and legacy_key not in keys:
            keys.append(legacy_key)
        if not keys:
            keys.append("gT2CfK1S-TlCsIY0gDcYtGEGaI9esB72HTfZfq666w27F_REx_ygD_HGYiGU8C-8")

        return cls(
            host=str(os.getenv("SCAN_SERVER_HOST", "127.0.0.1")).strip() or "127.0.0.1",
            port=max(1, _to_int(os.getenv("SCAN_SERVER_PORT", "8011"), 8011)),
            watchdog_enabled=_to_bool(os.getenv("SCAN_SERVER_WATCHDOG_ENABLED", "1"), True),
            watchdog_interval_sec=max(
                5, min(300, _to_int(os.getenv("SCAN_SERVER_WATCHDOG_INTERVAL_SEC", "30"), 30))
            ),
            watchdog_timeout_sec=max(
                1, min(30, _to_int(os.getenv("SCAN_SERVER_WATCHDOG_TIMEOUT_SEC", "10"), 10))
            ),
            watchdog_failures=max(
                1, min(10, _to_int(os.getenv("SCAN_SERVER_WATCHDOG_FAILURES", "5"), 5))
            ),
            watchdog_startup_grace_sec=max(
                0,
                min(600, _to_int(os.getenv("SCAN_SERVER_WATCHDOG_STARTUP_GRACE_SEC", "20"), 20)),
            ),
            api_keys=tuple(keys),
            data_dir=data_dir,
            db_path=db_path,
            archive_dir=archive_dir,
            retention_days=max(7, _to_int(os.getenv("SCAN_RETENTION_DAYS", "90"), 90)),
            task_ttl_days=max(1, _to_int(os.getenv("SCAN_TASK_TTL_DAYS", "7"), 7)),
            poll_limit=max(1, min(50, _to_int(os.getenv("SCAN_POLL_LIMIT", "10"), 10))),
            task_ack_timeout_sec=max(
                30, _to_int(os.getenv("SCAN_TASK_ACK_TIMEOUT_SEC", "300"), 300)
            ),
            agent_online_timeout_sec=max(
                300,
                _to_int(os.getenv("SCAN_SERVER_AGENT_ONLINE_TIMEOUT_SEC", "1800"), 1800),
            ),
            resolve_agent_sql_context=_to_bool(
                os.getenv("SCAN_SERVER_RESOLVE_AGENT_SQL_CONTEXT", "0"),
                False,
            ),
            ingest_max_pending_pdf_jobs=max(
                100,
                _to_int(os.getenv("SCAN_INGEST_MAX_PENDING_PDF_JOBS", "25000"), 25000),
            ),
            ingest_max_concurrency=max(
                1,
                min(32, _to_int(os.getenv("SCAN_INGEST_MAX_CONCURRENCY", "4"), 4)),
            ),
            transient_max_gb=max(
                1.0,
                _to_float(os.getenv("SCAN_TRANSIENT_MAX_GB", "80"), 80.0),
            ),
            ingest_retry_after_sec=max(
                1,
                min(3600, _to_int(os.getenv("SCAN_INGEST_RETRY_AFTER_SEC", "60"), 60)),
            ),
            job_processing_timeout_sec=max(
                60,
                _to_int(os.getenv("SCAN_JOB_PROCESSING_TIMEOUT_SEC", "1800"), 1800),
            ),
            scan_job_max_attempts=max(
                1,
                min(20, _to_int(os.getenv("SCAN_JOB_MAX_ATTEMPTS", "3"), 3)),
            ),
            scan_worker_enabled=_to_bool(os.getenv("SCAN_WORKER_ENABLED", "1"), True),
            worker_interval_sec=max(
                1, _to_int(os.getenv("SCAN_WORKER_INTERVAL_SEC", "3"), 3)
            ),
            scan_job_max_workers=max(
                1,
                min(
                    SCAN_JOB_MAX_WORKERS_LIMIT,
                    _to_int(os.getenv("SCAN_JOB_MAX_WORKERS", "4"), 4),
                ),
            ),
            ocr_enabled=_to_bool(os.getenv("SCAN_OCR_ENABLED", "1"), True),
            ocr_tesseract_cmd=str(
                os.getenv("SCAN_OCR_TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe")
            ).strip(),
            ocr_lang=str(os.getenv("SCAN_OCR_LANG", "rus")).strip() or "rus",
            ocr_max_processes=max(
                1,
                min(
                    SCAN_OCR_MAX_PROCESSES_LIMIT,
                    _to_int(
                        os.getenv("SCAN_OCR_MAX_PROCESSES", str(SCAN_OCR_MAX_PROCESSES_DEFAULT)),
                        SCAN_OCR_MAX_PROCESSES_DEFAULT,
                    ),
                ),
            ),
            ocr_timeout_sec=max(5, min(300, _to_int(os.getenv("SCAN_OCR_TIMEOUT_SEC", "45"), 45))),
            ocr_dpi=max(100, min(600, _to_int(os.getenv("SCAN_OCR_DPI", "300"), 300))),
            ocr_only_if_no_text=_to_bool(os.getenv("SCAN_OCR_ONLY_IF_NO_TEXT", "1"), True),
        )


config = ScanServerConfig.from_env()
