"""One backup code must be spendable once even when two logins verify it in parallel (DAUTH-03)."""
from __future__ import annotations

import threading

from sqlalchemy import select

from backend.appdb.db import app_session
from backend.appdb.models import AppUser2FABackupCode
from backend.config import config
from backend.services.auth_security_service import auth_security_service as service
from backend.services.twofa_service import twofa_service


def test_parallel_logins_cannot_spend_the_same_backup_code(prebuilt_app_db, monkeypatch):
    monkeypatch.setattr(config.app_db, "database_url", f"sqlite:///{prebuilt_app_db.as_posix()}")
    code = twofa_service.generate_backup_codes(2)[0]
    service._replace_backup_codes(7, [code])

    barrier = threading.Barrier(2)
    original = twofa_service.find_matching_backup_code

    def synchronized(*args, **kwargs):
        match = original(*args, **kwargs)
        barrier.wait(timeout=5)  # both callers have read the code as unused before either writes
        return match

    monkeypatch.setattr(twofa_service, "find_matching_backup_code", synchronized)
    results: list[bool] = []
    lock = threading.Lock()

    def consume():
        outcome = service._consume_backup_code(7, code)
        with lock:
            results.append(outcome)

    threads = [threading.Thread(target=consume) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert sorted(results) == [False, True]
    with app_session() as session:
        rows = session.scalars(select(AppUser2FABackupCode).where(AppUser2FABackupCode.user_id == 7)).all()
        assert len(rows) == 1 and rows[0].used_at is not None
