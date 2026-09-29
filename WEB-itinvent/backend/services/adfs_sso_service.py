"""Windows SSO via AD FS OpenID Connect (authorization code + PKCE).

The HUB-IT server is not domain-joined, so Kerberos validation is delegated to
the AD FS farm: the browser/WebView is redirected to /adfs/oauth2/authorize,
domain users get silent Windows Integrated Authentication, and the backend
exchanges the returned code for an id_token validated against AD FS JWKS.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import secrets
import threading
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from jose import JWTError, jwk, jwt

from backend.config import config
from backend.services.auth_runtime_store_service import auth_runtime_store_service

logger = logging.getLogger(__name__)

_STATE_NAMESPACE = "windows_sso_state"
_STATE_TTL_SECONDS = 300
_JWKS_CACHE_TTL_SECONDS = 3600
_USERNAME_PATTERN = re.compile(r"^[a-z0-9._-]{1,64}$")
_DOMAIN_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,32}$")
_STATE_PATTERN = re.compile(r"^[A-Za-z0-9_-]{32,128}$")
_CODE_PATTERN = re.compile(r"^[A-Za-z0-9._-]{8,2048}$")


class WindowsSsoError(ValueError):
    """Raised when the AD FS SSO flow cannot be completed or verified."""


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


class AdfsSsoService:
    """Drives the OIDC authorization-code flow against AD FS."""

    def __init__(self) -> None:
        self._jwks_cache: tuple[float, dict[str, Any]] | None = None
        self._jwks_lock = threading.Lock()

    def is_configured(self) -> bool:
        security = config.security
        return bool(
            security.windows_sso_enabled
            and security.adfs_base_url
            and security.adfs_client_id
            and security.adfs_client_secret
            and security.adfs_redirect_uri
        )

    def _base_url(self) -> str:
        return str(config.security.adfs_base_url or "").strip().rstrip("/")

    def _expected_domain(self) -> str:
        return str(config.security.windows_sso_domain or "").strip().upper()

    def _http_client(self) -> httpx.Client:
        verify: Any = config.security.adfs_ca_bundle or True
        return httpx.Client(
            verify=verify,
            timeout=float(config.security.adfs_http_timeout_sec or 10),
            follow_redirects=False,
        )

    def begin_flow(self) -> str:
        """Store a one-time state/nonce/PKCE bundle and return the authorize URL."""
        if not self.is_configured():
            raise WindowsSsoError("Windows SSO is not configured")

        state = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(24)
        code_verifier = _b64url(secrets.token_bytes(48))
        code_challenge = _b64url(hashlib.sha256(code_verifier.encode("ascii")).digest())

        auth_runtime_store_service.set_text(
            _STATE_NAMESPACE,
            state,
            json.dumps({"nonce": nonce, "verifier": code_verifier}, separators=(",", ":")),
            ttl_seconds=_STATE_TTL_SECONDS,
        )

        query = urlencode({
            "response_type": "code",
            "client_id": str(config.security.adfs_client_id),
            "redirect_uri": str(config.security.adfs_redirect_uri),
            "scope": str(config.security.adfs_scope or "openid"),
            "response_mode": "query",
            "state": state,
            "nonce": nonce,
            "code_challenge": code_challenge,
            "code_challenge_method": "S256",
        })
        return f"{self._base_url()}/adfs/oauth2/authorize?{query}"

    def complete_flow(self, *, code: str, state: str) -> dict[str, str]:
        """Consume the state, exchange the code and return {"username", "domain"}."""
        if not self.is_configured():
            raise WindowsSsoError("Windows SSO is not configured")
        if not _CODE_PATTERN.match(str(code or "")) or not _STATE_PATTERN.match(str(state or "")):
            raise WindowsSsoError("Invalid SSO response")

        raw_state = auth_runtime_store_service.consume_once(_STATE_NAMESPACE, str(state))
        if not raw_state:
            raise WindowsSsoError("SSO state is invalid or already used")
        try:
            flow = json.loads(raw_state)
            nonce = str(flow["nonce"])
            verifier = str(flow["verifier"])
        except (TypeError, KeyError, json.JSONDecodeError) as exc:
            raise WindowsSsoError("SSO state is corrupted") from exc

        id_token = self._exchange_code(code=str(code), code_verifier=verifier)
        claims = self._verify_id_token(id_token, expected_nonce=nonce)
        return self._extract_principal(claims)

    def _exchange_code(self, *, code: str, code_verifier: str) -> str:
        token_url = f"{self._base_url()}/adfs/oauth2/token"
        try:
            with self._http_client() as client:
                response = client.post(
                    token_url,
                    data={
                        "grant_type": "authorization_code",
                        "client_id": str(config.security.adfs_client_id),
                        "client_secret": str(config.security.adfs_client_secret),
                        "redirect_uri": str(config.security.adfs_redirect_uri),
                        "code": code,
                        "code_verifier": code_verifier,
                    },
                    headers={"Accept": "application/json"},
                )
        except httpx.HTTPError as exc:
            logger.warning("AD FS token endpoint unreachable: %s", exc)
            raise WindowsSsoError("AD FS token endpoint unreachable") from exc

        if response.status_code != 200:
            logger.warning("AD FS token exchange failed status=%s", response.status_code)
            raise WindowsSsoError("AD FS token exchange failed")
        try:
            payload = response.json()
        except ValueError as exc:
            raise WindowsSsoError("AD FS token response is malformed") from exc
        id_token = str(payload.get("id_token") or "").strip()
        if not id_token:
            raise WindowsSsoError("AD FS did not return an id_token")
        return id_token

    def _discovery(self, client: httpx.Client) -> dict[str, Any]:
        response = client.get(f"{self._base_url()}/adfs/.well-known/openid-configuration")
        if response.status_code != 200:
            raise WindowsSsoError("AD FS discovery document is unavailable")
        doc = response.json()
        if not isinstance(doc, dict) or not doc.get("issuer") or not doc.get("jwks_uri"):
            raise WindowsSsoError("AD FS discovery document is malformed")
        return doc

    def _jwks(self) -> tuple[dict[str, Any], str]:
        """Return (jwks, issuer). Cached for an hour to avoid per-login fetches."""
        with self._jwks_lock:
            if self._jwks_cache and self._jwks_cache[0] > time.time():
                return self._jwks_cache[1]["jwks"], self._jwks_cache[1]["issuer"]
            try:
                with self._http_client() as client:
                    discovery = self._discovery(client)
                    jwks_uri = str(discovery["jwks_uri"])
                    if not jwks_uri.startswith(f"{self._base_url()}/"):
                        raise WindowsSsoError("AD FS JWKS URI does not match the configured issuer")
                    response = client.get(jwks_uri)
                    if response.status_code != 200:
                        raise WindowsSsoError("AD FS signing keys are unavailable")
                    jwks = response.json()
            except httpx.HTTPError as exc:
                logger.warning("AD FS discovery failed: %s", exc)
                raise WindowsSsoError("AD FS discovery failed") from exc
            if not isinstance(jwks, dict) or not isinstance(jwks.get("keys"), list):
                raise WindowsSsoError("AD FS signing keys are malformed")
            self._jwks_cache = (
                time.time() + _JWKS_CACHE_TTL_SECONDS,
                {"jwks": jwks, "issuer": str(discovery["issuer"])},
            )
            return jwks, str(discovery["issuer"])

    def _verify_id_token(self, id_token: str, *, expected_nonce: str) -> dict[str, Any]:
        try:
            header = jwt.get_unverified_header(id_token)
        except JWTError as exc:
            raise WindowsSsoError("Invalid SSO token") from exc
        kid = str(header.get("kid") or "")
        jwks, issuer = self._jwks()
        key_dict = next(
            (key for key in jwks["keys"] if str(key.get("kid") or "") == kid),
            None,
        )
        if key_dict is None:
            raise WindowsSsoError("AD FS signing key not found")
        try:
            key = jwk.construct(key_dict, algorithm="RS256")
            claims = jwt.decode(
                id_token,
                key.to_pem().decode("utf-8"),
                algorithms=["RS256"],
                audience=str(config.security.adfs_client_id),
                issuer=issuer,
            )
        except (JWTError, ValueError) as exc:
            raise WindowsSsoError("Invalid SSO token") from exc
        if str(claims.get("nonce") or "") != expected_nonce:
            raise WindowsSsoError("Invalid SSO token")
        return claims

    def _extract_principal(self, claims: dict[str, Any]) -> dict[str, str]:
        """Map claims to (username, domain); rejects foreign domains and odd shapes."""
        raw = ""
        for claim in ("winaccountname", "upn", "unique_name", "name"):
            candidate = str(claims.get(claim) or "").strip()
            if candidate:
                raw = candidate
                break
        if not raw or len(raw) > 200:
            raise WindowsSsoError("SSO token has no usable identity claim")

        domain = ""
        username = raw
        if "\\" in raw:
            domain, username = raw.split("\\", 1)
        elif "@" in raw:
            username, suffix = raw.split("@", 1)
            domain = suffix.split(".", 1)[0]
        domain = domain.strip().upper()
        username = username.strip().lower()

        expected_domain = self._expected_domain()
        if expected_domain and domain and domain != expected_domain:
            raise WindowsSsoError("SSO identity domain mismatch")
        if not _USERNAME_PATTERN.match(username) or (
            domain and not _DOMAIN_PATTERN.match(domain)
        ):
            raise WindowsSsoError("SSO identity has an unsupported shape")
        return {"username": username, "domain": domain or expected_domain}


adfs_sso_service = AdfsSsoService()
