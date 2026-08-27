from __future__ import annotations

from pathlib import Path

import pytest

from backend.appdb.db import app_session
from backend.appdb.models import AppUser
from backend.services.mobile_biometric_session_service import (
    MobileBiometricSessionError,
    MobileBiometricSessionService,
)


def _service(temp_dir: str) -> tuple[MobileBiometricSessionService, str]:
    database_url = f"sqlite:///{(Path(temp_dir) / 'mobile_biometric.db').as_posix()}"
    return MobileBiometricSessionService(database_url=database_url), database_url


def _add_user(database_url: str, *, user_id: int = 71, active: bool = True, twofa: bool = True) -> None:
    with app_session(database_url) as session:
        session.add(
            AppUser(
                id=user_id,
                username=f"mobile-{user_id}",
                role="viewer",
                is_active=active,
                is_2fa_enabled=twofa,
            )
        )


def test_biometric_credential_renews_indefinitely_until_revoked(temp_dir):
    service, database_url = _service(temp_dir)
    _add_user(database_url)
    device_id = "mobile-test-device-1234567890"

    enrollment_code = service.issue_enrollment_code(
        user_id=71,
        client_device_id=device_id,
        session_id="session-71",
    )
    renewal_token = service.enroll(
        enrollment_code=enrollment_code,
        user_id=71,
        client_device_id=device_id,
    )

    assert service.authenticate(
        renewal_token=renewal_token,
        client_device_id=device_id,
    )["user_id"] == 71
    assert service.authenticate(
        renewal_token=renewal_token,
        client_device_id=device_id,
    )["user_id"] == 71

    assert service.revoke_device(user_id=71, client_device_id=device_id) == 1
    with pytest.raises(MobileBiometricSessionError, match="revoked"):
        service.authenticate(renewal_token=renewal_token, client_device_id=device_id)


def test_biometric_enrollment_code_is_one_time_and_device_bound(temp_dir):
    service, database_url = _service(temp_dir)
    _add_user(database_url)
    code = service.issue_enrollment_code(
        user_id=71,
        client_device_id="mobile-first-device-123456",
        session_id="session-71",
    )

    with pytest.raises(MobileBiometricSessionError, match="does not belong"):
        service.enroll(
            enrollment_code=code,
            user_id=71,
            client_device_id="mobile-second-device-12345",
        )
    with pytest.raises(MobileBiometricSessionError, match="expired"):
        service.enroll(
            enrollment_code=code,
            user_id=71,
            client_device_id="mobile-first-device-123456",
        )


def test_biometric_auth_revokes_itself_when_twofa_is_disabled(temp_dir):
    service, database_url = _service(temp_dir)
    _add_user(database_url)
    device_id = "mobile-test-device-1234567890"
    code = service.issue_enrollment_code(user_id=71, client_device_id=device_id, session_id="session-71")
    renewal_token = service.enroll(enrollment_code=code, user_id=71, client_device_id=device_id)

    with app_session(database_url) as session:
        user = session.get(AppUser, 71)
        user.is_2fa_enabled = False

    with pytest.raises(MobileBiometricSessionError, match="no longer allowed"):
        service.authenticate(renewal_token=renewal_token, client_device_id=device_id)
    with pytest.raises(MobileBiometricSessionError, match="revoked"):
        service.authenticate(renewal_token=renewal_token, client_device_id=device_id)


def test_has_active_credential_for_device_matches_enrolled_apk(temp_dir):
    from backend.services.session_service import hash_client_device_id

    service, database_url = _service(temp_dir)
    _add_user(database_url, user_id=81)
    device_id = "mobile-idle-device-1234567890"
    code = service.issue_enrollment_code(user_id=81, client_device_id=device_id, session_id="s-81")
    service.enroll(enrollment_code=code, user_id=81, client_device_id=device_id)
    device_hash = hash_client_device_id(device_id)

    assert service.has_active_credential_for_device(user_id=81, client_device_key_hash=device_hash) is True
    assert service.has_active_credential_for_device(user_id=81, client_device_key_hash="0" * 64) is False
    assert service.revoke_device(user_id=81, client_device_id=device_id) == 1
    assert service.has_active_credential_for_device(user_id=81, client_device_key_hash=device_hash) is False
