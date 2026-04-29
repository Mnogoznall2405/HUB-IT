from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Tuple

try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover
    load_dotenv = None


PROJECT_ROOT = Path(__file__).resolve().parent.parent
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
if load_dotenv is not None and ROOT_ENV_PATH.exists():
    load_dotenv(str(ROOT_ENV_PATH))


DEFAULT_AGENT_API_KEY = "gT2CfK1S-TlCsIY0gDcYtGEGaI9esB72HTfZfq666w27F_REx_ygD_HGYiGU8C-8"


def _to_int(value: str, default: int) -> int:
    try:
        return int(str(value).strip())
    except Exception:
        return default


@dataclass(frozen=True)
class InventoryServerConfig:
    host: str
    port: int
    api_keys: Tuple[str, ...]
    data_dir: Path
    db_path: Path
    worker_interval_sec: int
    batch_size: int
    max_attempts: int
    backoff_cap_sec: int
    done_retention_days: int = 7
    dead_retention_days: int = 30
    cleanup_interval_sec: int = 3600

    @classmethod
    def from_env(cls) -> "InventoryServerConfig":
        data_dir = Path(
            os.getenv("INVENTORY_SERVER_DATA_DIR", str(PROJECT_ROOT / "data" / "inventory_server"))
        )
        db_path = Path(
            os.getenv("INVENTORY_SERVER_DB_PATH", str(data_dir / "inventory_server.db"))
        )
        keys: list[str] = []
        for env_name in (
            "INVENTORY_SERVER_API_KEYS",
            "ITINV_AGENT_API_KEYS",
        ):
            ring_raw = str(os.getenv(env_name, "") or "").strip()
            if not ring_raw:
                continue
            for row in ring_raw.split(","):
                key = str(row or "").strip()
                if key and key not in keys:
                    keys.append(key)

        for env_name in (
            "INVENTORY_SERVER_API_KEY",
            "ITINV_AGENT_API_KEY",
        ):
            legacy_key = str(os.getenv(env_name, "") or "").strip()
            if legacy_key and legacy_key not in keys:
                keys.append(legacy_key)

        if not keys:
            keys.append(DEFAULT_AGENT_API_KEY)

        return cls(
            host=str(os.getenv("INVENTORY_SERVER_HOST", "127.0.0.1")).strip() or "127.0.0.1",
            port=max(1, _to_int(os.getenv("INVENTORY_SERVER_PORT", "8012"), 8012)),
            api_keys=tuple(keys),
            data_dir=data_dir,
            db_path=db_path,
            worker_interval_sec=max(1, _to_int(os.getenv("INVENTORY_SERVER_WORKER_INTERVAL_SEC", "2"), 2)),
            batch_size=max(1, min(50, _to_int(os.getenv("INVENTORY_SERVER_BATCH_SIZE", "10"), 10))),
            max_attempts=max(1, _to_int(os.getenv("INVENTORY_SERVER_MAX_ATTEMPTS", "20"), 20)),
            backoff_cap_sec=max(5, _to_int(os.getenv("INVENTORY_SERVER_BACKOFF_CAP_SEC", "300"), 300)),
            done_retention_days=max(1, _to_int(os.getenv("INVENTORY_SERVER_DONE_RETENTION_DAYS", "7"), 7)),
            dead_retention_days=max(1, _to_int(os.getenv("INVENTORY_SERVER_DEAD_RETENTION_DAYS", "30"), 30)),
            cleanup_interval_sec=max(60, _to_int(os.getenv("INVENTORY_SERVER_CLEANUP_INTERVAL_SEC", "3600"), 3600)),
        )


config = InventoryServerConfig.from_env()
