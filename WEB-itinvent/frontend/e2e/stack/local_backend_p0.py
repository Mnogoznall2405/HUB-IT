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
# Trusted-device registration performs real WebAuthn verification on this
# stand (attestation=none). RP ID / origin must match the vite origin.
os.environ.setdefault("WEBAUTHN_RP_ID", "localhost")
os.environ.setdefault("WEBAUTHN_ORIGIN", "http://localhost:5199")
# The login challenge stores the pending password encrypted with the mail
# secrets key; the default stack never exercises it (policy=off). Test-only
# Fernet key — not a real credential.
os.environ["MAIL_CREDENTIALS_KEY"] = "DWPV3jjPspHRz4ux5EFBqHLPHY6TkDbEXGeADj4VW9w="

# Earlier tests in the P0 spec enroll all three seed users for 2FA, so the
# strict trusted-device test needs a dedicated still-unenrolled account.
_ORIG_SEED = local_backend._seed


def _seed_with_td_user() -> None:
    _ORIG_SEED()
    from datetime import datetime, timezone

    from sqlalchemy import select

    from backend.appdb.db import app_session
    from backend.appdb.models import AppUser
    from backend.services.user_service import user_service

    if user_service.get_by_username("e2e_td") is None:
        user_service.create_user(
            "e2e_td",
            password="e2e-local-td-pass",
            role="operator",
            full_name="E2E Trusted",
            email="e2e_td@example.com",
        )
    now = datetime.now(timezone.utc)
    with app_session() as session:
        row = session.scalars(select(AppUser).where(AppUser.username == "e2e_td")).one()
        if row.about_onboarding_completed_at is None:
            row.about_onboarding_completed_at = now


local_backend._seed = _seed_with_td_user

local_backend.main()
