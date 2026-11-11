"""Backward-compatible shortcut for password_vault_decrypt_audit.py."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from password_vault_decrypt_audit import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())