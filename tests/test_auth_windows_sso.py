from __future__ import annotations

import asyncio
import base64
import importlib
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jose import jwt

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api.v1 import auth
from backend.config import config
from backend.services.adfs_sso_service import (
    WindowsSsoError,
    adfs_sso_service,
)

auth_security_module = importlib.import_module("backend.services.auth_security_service")

ISSUER = "https://sso.zsgp.ru/adfs"
CLIENT_ID = "hubit-web-test"
REDIRECT_URI = "https://hubit.zsgp.ru/api/v1/auth/sso/callback"

_PRIVATE_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
_WRONG_KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _b64url_int(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _jwks_for(private_key, kid: str = "test-key") -> dict:
    numbers = private_key.public_key().public_numbers()
    return {
        "keys": [{
            "kty": "RSA",
            "kid": kid,
            "use": "sig",
            "n": _b64url_int(numbers.n),
            "e": _b64url_int(numbers.e),
        }]
    }


def _mint_id_token(
    *,
    private_key=_PRIVATE_KEY,
    kid: str = "test-key",
    nonce: str,
    aud: str = CLIENT_ID,
    iss: str = ISSUER,
    exp: int | None = None,
    extra_claims: dict | None = None,
) -> str:
    now = int(time.time())
    claims = {
        "aud": aud,
        "iss": iss,
        "iat": now,
        "exp": (now + 300) if exp is None else exp,
        "nonce": nonce,
        "sub": "S-1-5-21-0000-ivanov",
        "winaccountname": "ZSGP\\ivanov",
        "upn": "ivanov@zsgp.ru",
    }
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(
        claims,
        private_key,
        algorithm="RS256",
        headers={"kid": kid},
    )


def _clear_auth_runtime_store() -> None:
    lock = getattr(auth.auth_runtime_store_service, "_lock", None)
    memory = getattr(auth.auth_runtime_store_service, "_memory", None)
    if lock is not None and memory is not None:
        with lock:
            memory.clear()


@pytest.fixture(autouse=True)
def _sso_configured(monkeypatch):
    monkeypatch.setattr(config.security, "windows_sso_enabled", True)
    monkeypatch.setattr(config.security, "windows_sso_domain", "ZSGP")
    monkeypatch.setattr(config.security, "adfs_base_url", "https://sso.zsgp.ru")
    monkeypatch.setattr(config.security, "adfs_client_id", CLIENT_ID)
    monkeypatch.setattr(config.security, "adfs_client_secret", "test-secret")
    monkeypatch.setattr(config.security, "adfs_redirect_uri", REDIRECT_URI)
    monkeypatch.setattr(config.security, "adfs_scope", "openid")
    monkeypatch.setattr(config.security, "adfs_ca_bundle", None)
    monkeypatch.setattr(config.security, "adfs_http_timeout_sec", 10)
    adfs_sso_service._jwks_cache = None
    monkeypatch.setattr(auth.auth_runtime_store_service, "_backend", "memory")
    _clear_auth_runtime_store()
    yield
    _clear_auth_runtime_store()
    adfs_sso_service._jwks_cache = None


def _make_request(client_ip: str) -> SimpleNamespace:
    return SimpleNamespace(
        client=SimpleNamespace(host=client_ip),
        headers={},
        cookies={},
        url=SimpleNamespace(scheme="http"),
    )


def _sample_ldap_user(**overrides):
    payload = {
        "id": 7,
        "username": "ivanov",
        "email": "ivanov@zsgp.ru",
        "full_name": "Ivan Ivanov",
        "is_active": True,
        "role": "viewer",
        "permissions": [],
        "auth_source": "ldap",
        "is_2fa_enabled": False,
    }
    payload.update(overrides)
    return payload


def _begin_state_and_nonce() -> tuple[str, str]:
    url = adfs_sso_service.begin_flow()
    from urllib.parse import parse_qs, urlparse
    query = parse_qs(urlparse(url).query)
    state = query["state"][0]
    stored = auth.auth_runtime_store_service.get_text("windows_sso_state", state)
    nonce = json.loads(stored)["nonce"]
    return state, nonce


def _stub_adfs(monkeypatch, *, nonce: str, **token_kwargs):
    token = _mint_id_token(nonce=nonce, **token_kwargs)
    monkeypatch.setattr(adfs_sso_service, "_exchange_code", lambda **kwargs: token)
    monkeypatch.setattr(
        adfs_sso_service, "_jwks", lambda: (_jwks_for(_PRIVATE_KEY), ISSUER)
    )
    return token


class TestBeginFlow:
    def test_begin_returns_authorize_url_with_pkce(self):
        url = adfs_sso_service.begin_flow()
        from urllib.parse import parse_qs, urlparse
        parsed = urlparse(url)
        query = parse_qs(parsed.query)
        assert parsed.scheme == "https"
        assert parsed.netloc == "sso.zsgp.ru"
        assert parsed.path == "/adfs/oauth2/authorize"
        assert query["client_id"] == [CLIENT_ID]
        assert query["redirect_uri"] == [REDIRECT_URI]
        assert query["response_type"] == ["code"]
        assert query["code_challenge_method"] == ["S256"]
        assert query["nonce"] and query["state"]
        assert "code_verifier" not in query

    def test_begin_fails_when_disabled(self, monkeypatch):
        monkeypatch.setattr(config.security, "windows_sso_enabled", False)
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.begin_flow()


class TestCompleteFlow:
    def test_valid_flow_returns_principal(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce)
        principal = adfs_sso_service.complete_flow(code="authcode-12345", state=state)
        assert principal == {"username": "ivanov", "domain": "ZSGP"}

    def test_rejects_unknown_or_replayed_state(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce)
        adfs_sso_service.complete_flow(code="authcode-12345", state=state)
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state="x" * 40)

    def test_rejects_bad_signature(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce, private_key=_WRONG_KEY)
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_rejects_wrong_nonce(self, monkeypatch):
        state, _nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce="other-nonce")
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_rejects_wrong_audience(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce, aud="someone-else")
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_rejects_wrong_issuer(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce, iss="https://evil.example/adfs")
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_rejects_expired_token(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(monkeypatch, nonce=nonce, exp=int(time.time()) - 60)
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_rejects_foreign_domain(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(
            monkeypatch,
            nonce=nonce,
            extra_claims={"winaccountname": "OTHERDOM\\ivanov", "upn": "", "sub": ""},
        )
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)

    def test_maps_upn_claim(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(
            monkeypatch,
            nonce=nonce,
            extra_claims={"winaccountname": "", "upn": "Petrov@zsgp.ru"},
        )
        principal = adfs_sso_service.complete_flow(code="authcode-12345", state=state)
        assert principal == {"username": "petrov", "domain": "ZSGP"}

    def test_rejects_unusable_identity(self, monkeypatch):
        state, nonce = _begin_state_and_nonce()
        _stub_adfs(
            monkeypatch,
            nonce=nonce,
            extra_claims={
                "winaccountname": "", "upn": "", "unique_name": "",
                "name": "", "sub": "S-1-5-21-0000",
            },
        )
        with pytest.raises(WindowsSsoError):
            adfs_sso_service.complete_flow(code="authcode-12345", state=state)


class TestSsoEndpoints:
    def test_begin_404_when_disabled(self, monkeypatch):
        monkeypatch.setattr(config.security, "windows_sso_enabled", False)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(auth.sso_begin(_make_request("10.103.5.20")))
        assert exc.value.status_code == 404

    def test_begin_403_for_external(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        with pytest.raises(HTTPException) as exc:
            asyncio.run(auth.sso_begin(_make_request("95.24.10.1")))
        assert exc.value.status_code == 403

    def test_begin_redirects_to_adfs(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        result = asyncio.run(auth.sso_begin(_make_request("10.103.5.20")))
        assert result.status_code == 302
        assert result.headers["location"].startswith(
            "https://sso.zsgp.ru/adfs/oauth2/authorize?"
        )

    def test_callback_denied_error(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), error="access_denied")
        )
        assert result.status_code == 302
        assert result.headers["location"] == "/login?sso_error=denied"

    def test_callback_verify_failure(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)

        def _boom(**kwargs):
            raise WindowsSsoError("bad")

        monkeypatch.setattr(adfs_sso_service, "complete_flow", _boom)
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), code="c", state="s" * 40)
        )
        assert result.headers["location"] == "/login?sso_error=verify"

    def test_callback_unknown_user(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        monkeypatch.setattr(
            adfs_sso_service,
            "complete_flow",
            lambda **kwargs: {"username": "ghost", "domain": "ZSGP"},
        )
        monkeypatch.setattr(auth.user_service, "get_by_username", lambda username: None)
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), code="c", state="s" * 40)
        )
        assert result.headers["location"] == "/login?sso_error=not_provisioned"

    def test_callback_inactive_user(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        monkeypatch.setattr(
            adfs_sso_service,
            "complete_flow",
            lambda **kwargs: {"username": "ivanov", "domain": "ZSGP"},
        )
        monkeypatch.setattr(
            auth.user_service,
            "get_by_username",
            lambda username: _sample_ldap_user(is_active=False),
        )
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), code="c", state="s" * 40)
        )
        assert result.headers["location"] == "/login?sso_error=inactive"

    def test_callback_local_user_rejected(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        monkeypatch.setattr(
            adfs_sso_service,
            "complete_flow",
            lambda **kwargs: {"username": "admin", "domain": "ZSGP"},
        )
        monkeypatch.setattr(
            auth.user_service,
            "get_by_username",
            lambda username: _sample_ldap_user(username="admin", auth_source="local"),
        )
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), code="c", state="s" * 40)
        )
        assert result.headers["location"] == "/login?sso_error=not_provisioned"

    def test_callback_success_sets_cookies_and_redirects(self, monkeypatch):
        monkeypatch.setattr(auth, "_enforce_rate_limit", lambda **kwargs: None)
        monkeypatch.setattr(auth, "ensure_admin_ip_allowed", lambda *args, **kwargs: None)
        monkeypatch.setattr(auth, "_apply_default_database", lambda user: None)
        user = _sample_ldap_user()
        monkeypatch.setattr(auth.user_service, "get_by_username", lambda username: user)
        monkeypatch.setattr(
            adfs_sso_service,
            "complete_flow",
            lambda **kwargs: {"username": "ivanov", "domain": "ZSGP"},
        )

        def _fake_complete(*, user, ip_address, user_agent, network_zone, client_device_id):
            return {
                "status": "authenticated",
                "user": user,
                "session_id": "sess-1",
                "access_token": "access-token",
                "refresh_token": "refresh-token",
                "access_ttl_seconds": 900,
                "refresh_ttl_seconds": 604800,
                "client_device_id": client_device_id,
            }

        monkeypatch.setattr(
            auth.auth_security_service,
            "complete_windows_sso_login",
            _fake_complete,
        )
        result = asyncio.run(
            auth.sso_callback(_make_request("10.103.5.20"), code="c", state="s" * 40)
        )
        assert result.status_code == 302
        assert result.headers["location"] == "/"
        set_cookies = [
            value.decode("latin1")
            for key, value in result.raw_headers
            if key == b"set-cookie"
        ]
        assert any(config.app.auth_cookie_name in cookie for cookie in set_cookies)
        assert any(config.app.auth_refresh_cookie_name in cookie for cookie in set_cookies)

    def test_login_mode_reports_sso(self, monkeypatch):
        monkeypatch.setattr(
            auth, "resolve_client_geo",
            lambda **kwargs: SimpleNamespace(country_code=None, show_vpn_hint=False),
        )
        internal = asyncio.run(auth.get_login_mode(_make_request("10.103.5.20")))
        assert internal.windows_sso_enabled is True
        external = asyncio.run(auth.get_login_mode(_make_request("95.24.10.1")))
        assert external.windows_sso_enabled is False
