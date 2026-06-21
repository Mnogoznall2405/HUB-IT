from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.config import config
from backend.services.twofa_service import TwoFactorService


@pytest.fixture
def twofa_service() -> TwoFactorService:
    return TwoFactorService()


def test_build_otpauth_uri_uses_display_label_in_path_and_rp_id_as_issuer(monkeypatch, twofa_service):
    monkeypatch.setattr(config.security, "totp_issuer", "HUB-IT")
    monkeypatch.setattr(config.security, "webauthn_rp_id", "hubit.zsgp.ru")

    uri = twofa_service.build_otpauth_uri(secret="ABC123", username="ivanov")

    assert uri.startswith("otpauth://totp/HUB-IT:ivanov?")
    assert "secret=ABC123" in uri
    assert "issuer=hubit.zsgp.ru" in uri
    assert "digits=6" in uri
    assert "period=30" in uri


def test_build_otpauth_uri_falls_back_to_totp_issuer_when_rp_id_missing(monkeypatch, twofa_service):
    monkeypatch.setattr(config.security, "totp_issuer", "HUB-IT")
    monkeypatch.setattr(config.security, "webauthn_rp_id", None)

    uri = twofa_service.build_otpauth_uri(secret="ABC123", username="ivanov@test.ru")

    assert uri.startswith("otpauth://totp/HUB-IT:ivanov%40test.ru?")
    assert "issuer=HUB-IT" in uri


def test_resolve_totp_issuer_domain_prefers_webauthn_rp_id(monkeypatch, twofa_service):
    monkeypatch.setattr(config.security, "totp_issuer", "HUB-IT")
    monkeypatch.setattr(config.security, "webauthn_rp_id", "hubit.zsgp.ru")

    assert twofa_service.resolve_totp_issuer_domain() == "hubit.zsgp.ru"
    assert twofa_service.resolve_totp_display_label() == "HUB-IT"
