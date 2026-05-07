from __future__ import annotations

from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]

TRACKED_ENV_FILES = (
    PROJECT_ROOT / "WEB-itinvent" / "backend" / ".env.legacy",
    PROJECT_ROOT / "WEB-itinvent" / "backend" / "api" / ".env.legacy",
    PROJECT_ROOT / "WEB-itinvent" / "_manual_env_tests" / ".env1",
    PROJECT_ROOT / "WEB-itinvent" / "_manual_env_tests" / ".env2",
)

SENSITIVE_KEY_PARTS = (
    "PASSWORD",
    "SECRET",
    "TOKEN",
    "API_KEY",
    "CREDENTIAL",
    "COMMUNITY",
    "USERNAME",
    "HOST",
    "URL",
    "EMAIL",
    "RECIPIENTS",
    "DATABASE",
)

SAFE_VALUE_MARKERS = (
    "example",
    "placeholder",
    "changeme",
    "change-this",
    "your-",
    "dummy",
    "test",
    "localhost",
    "127.0.0.1",
)

IGNORED_KEYS = {
    "DATABASE_TYPE",
}

def _iter_env_entries(path: Path):
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        yield key.strip(), value.strip()


def test_tracked_env_like_files_do_not_contain_non_agent_live_secrets():
    leaks: list[str] = []
    for path in TRACKED_ENV_FILES:
        assert path.exists(), f"{path.relative_to(PROJECT_ROOT)} should remain present as a sanitized example"
        for key, value in _iter_env_entries(path):
            normalized_key = key.upper()
            if normalized_key in IGNORED_KEYS:
                continue
            if not any(part in normalized_key for part in SENSITIVE_KEY_PARTS):
                continue
            normalized_value = value.lower()
            if not normalized_value:
                continue
            if any(marker in normalized_value for marker in SAFE_VALUE_MARKERS):
                continue
            leaks.append(f"{path.relative_to(PROJECT_ROOT)}:{key}")

    assert leaks == []
