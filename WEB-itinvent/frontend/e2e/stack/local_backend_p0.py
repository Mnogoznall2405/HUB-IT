"""E2E backend variant with 2FA enforced on loopback.

Wraps ``local_backend``: identical seed and app, but ``AUTH_2FA_POLICY=all``
so logins exercise the challenge / enrollment / backup-code paths used by the
remediation P0 suite. Runs on a separate port and state dir so it can coexist
with the default E2E stack.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

STACK_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(STACK_DIR))

os.environ.setdefault("E2E_STATE_NAME", ".state-p0")
os.environ.setdefault("E2E_BACKEND_PORT", "18002")
os.environ.setdefault("E2E_FRONTEND_PORT", "5199")

import local_backend  # noqa: E402  (module import applies the base E2E env)

# Overrides land AFTER local_backend's env.update but BEFORE backend.main is
# imported — local_backend.main() imports backend lazily inside main().
os.environ["AUTH_2FA_ENFORCED"] = "1"
os.environ["AUTH_2FA_POLICY"] = "all"
# The login challenge stores the pending password encrypted with the mail
# secrets key; the default stack never exercises it (policy=off). Test-only
# Fernet key — not a real credential.
os.environ["MAIL_CREDENTIALS_KEY"] = "DWPV3jjPspHRz4ux5EFBqHLPHY6TkDbEXGeADj4VW9w="

local_backend.main()
