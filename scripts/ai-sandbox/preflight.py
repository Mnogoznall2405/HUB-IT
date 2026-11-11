"""Offline sandbox rollout checks. Never changes env, services, files or DBs."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Mapping

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "WEB-itinvent"))

from backend.ai_sandbox.config import (  # noqa: E402
    SandboxSettings,
    validate_digest_image,
    validate_transfer_service_token,
)


def check_configuration(values: Mapping[str, str], *, role: str) -> dict:
    """Report names and fixed descriptions only, including for malformed secrets.

    Enabling execution is simulated in memory, so disabled production configs
    still expose missing prerequisites. This is not a runtime readiness check.
    """
    checks: list[dict[str, object]] = []

    def add(name: str, passed: bool) -> None:
        checks.append({"check": name, "ok": bool(passed)})

    def valid(checker, value: str) -> bool:
        try:
            checker(value)
            return True
        except (ValueError, RuntimeError, TypeError):
            return False

    add("APP_DATABASE_URL.present", bool(values.get("APP_DATABASE_URL")))
    if role in {"hub", "worker"}:
        add("AI_SANDBOX_IMAGE.digest", valid(validate_digest_image, values.get("AI_SANDBOX_IMAGE", "")))
        add("AI_SANDBOX_TRANSFER_SERVICE_TOKEN.valid", valid(
            validate_transfer_service_token, values.get("AI_SANDBOX_TRANSFER_SERVICE_TOKEN", "")
        ))
        add("AI_SANDBOX_CONTENT_TRANSFER_READY", str(values.get("AI_SANDBOX_CONTENT_TRANSFER_READY", "")).lower() in {"1", "true", "yes", "on"})
        try:
            SandboxSettings.from_env({**values, "AI_SANDBOX_ENABLED": "1"})
            add("sandbox.enable_configuration", True)
        except (ValueError, RuntimeError, TypeError):
            # Exception messages may include user-supplied configuration values.
            add("sandbox.enable_configuration", False)
    if role == "worker":
        add("AI_SANDBOX_QUOTA_HELPER.absolute", str(values.get("AI_SANDBOX_QUOTA_HELPER", "")).startswith("/"))
    if role == "gateway":
        model = str(values.get("AI_SANDBOX_LLM_MODEL", "") or "").strip()
        add("AI_SANDBOX_LLM_MODEL.valid", bool(model) and len(model) <= 200 and not any(c in model for c in "\r\n\x00"))
        try:
            budget_ok = 1 <= int(values.get("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS", "4000")) <= 16000
        except (ValueError, TypeError):
            budget_ok = False
        add("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS.valid", budget_ok)
        add("ROUTERAI_API_KEY.present", bool(values.get("ROUTERAI_API_KEY")))
        # Gateway health does not exercise this flag; actual LLM requests do.
        add("AI_SANDBOX_ENABLED", str(values.get("AI_SANDBOX_ENABLED", "")).lower() in {"1", "true", "yes", "on"})
    return {"role": role, "configuration_ok": all(item["ok"] for item in checks),
            "runtime_verified": False, "checks": checks}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--role", choices=("hub", "worker", "gateway"), required=True)
    args = parser.parse_args()
    from dotenv import dotenv_values

    if not args.env_file.is_file():
        print(json.dumps({"error": "env_file_missing"}))
        return 2
    # Do not expand values from the invoking user's process environment.
    values = {k: v or "" for k, v in dotenv_values(args.env_file, interpolate=False).items()}
    report = check_configuration(values, role=args.role)
    print(json.dumps(report, indent=2))
    return 0 if report["configuration_ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
