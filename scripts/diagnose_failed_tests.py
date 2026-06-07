#!/usr/bin/env python3
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FILES = [
    "tests/test_ai_chat_runtime.py",
    "tests/test_auth_security_flow.py",
    "tests/test_backend_auth_hardening.py",
    "tests/test_chat_async_api.py",
    "tests/test_chat_health_runtime.py",
    "tests/test_chat_push_service.py",
    "tests/test_equipment_locations_api.py",
    "tests/test_internal_db_migration_runtime.py",
    "tests/test_my_files_api.py",
    "tests/test_my_files_service.py",
    "tests/test_password_vault_api.py",
    "tests/test_password_vault_service.py",
    "tests/test_tickets_import_execute.py",
    "tests/test_tickets_prop_import.py",
    "tests/test_user_full_context_employee_props.py",
    "tests/test_user_full_context_equipment_props.py",
    "tests/test_user_full_context_unit.py",
    "tests/test_user_full_context_validation_props.py",
    "tests/test_vcs_app_db_helpers.py",
    "tests/test_web_settings_and_sessions.py",
]

for rel in FILES:
    proc = subprocess.run(
        [sys.executable, "-m", "pytest", rel, "--tb=line", "-q", "--disable-warnings"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout + proc.stderr).strip().splitlines()
    print(f"\n### {rel}")
    interesting = [
        line
        for line in out
        if any(
            token in line
            for token in (
                "ImportError",
                "ModuleNotFoundError",
                "AttributeError",
                "FAILED",
                "ERROR",
                "AssertionError",
                "E   ",
                "assert ",
            )
        )
    ]
    if interesting:
        for line in interesting[-6:]:
            print(line)
    else:
        for line in out[-8:]:
            print(line)
