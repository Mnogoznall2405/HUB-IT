"""In-socket re-auth lease for long-lived websockets (D5, variant б+).

A websocket outlives the 15-minute access token it was opened with only while
the client keeps proving fresh credentials (`chat.auth` with a new access
token, or a short-lived `ws_ticket`). Otherwise the socket dies exactly as
before with 4401. Stolen expired tokens cannot mint a ticket, so the socket
dies with them.
"""
from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException

from backend.api.deps import assert_access_token_still_valid
from backend.services.auth_runtime_store_service import auth_runtime_store_service
from backend.services.session_service import session_service
from backend.utils.security import decode_access_token

_WS_AUTH_GRACE_SEC = max(
    15.0,
    min(3600.0, float(str(os.getenv("CHAT_WS_AUTH_GRACE_SEC", "120") or "120").strip() or "120")),
)
_WS_AUTH_PROOF_WINDOW_SEC = max(
    60.0,
    min(3600.0, float(str(
        os.getenv("CHAT_WS_AUTH_PROOF_WINDOW_SEC", "900") or "900"
    ).strip() or "900")),
)


def _note(name: str) -> None:
    try:
        from backend.services.auth_session_metrics import note

        note(name)
    except Exception:
        pass


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


class WsSessionLease:
    """Sync lease state for one websocket; call via run_in_threadpool.

    authenticated_until — wall-clock deadline refreshed by proofs (starts at
    the bound token's exp). grace_deadline — monotonic deadline for supplying
    a proof after the bound token stops validating.
    """

    def __init__(self, token: Optional[str], *, user_id: int) -> None:
        self.token = str(token or "").strip() or None
        self.user_id = int(user_id)
        # R-W8-4: the bound token must be an access token even though the
        # handshake already validated the type — keep the lease hygienic.
        token_data = (
            decode_access_token(self.token or "", expected_token_type="access")
            if self.token else None
        )
        self.session_id = str(getattr(token_data, "session_id", "") or "") or None
        expires_at = getattr(token_data, "expires_at", None)
        self.authenticated_until = expires_at or _now_utc()
        self.grace_deadline: Optional[float] = None

    def grace_remaining_ms(self) -> int:
        """Milliseconds left in the grace window; 0 when not in grace."""
        if self.grace_deadline is None:
            return 0
        return max(0, int((self.grace_deadline - time.monotonic()) * 1000))

    def _classify_dead(self) -> bool:
        """Expired-but-alive vs dead: revoked jti / inactive session / garbage."""
        token_data = decode_access_token(self.token or "", verify_exp=False)
        if token_data is None:
            return True
        if token_data.jti and auth_runtime_store_service.is_jti_revoked(token_data.jti):
            return True
        session_id = token_data.session_id or self.session_id
        if session_id and not session_service.is_session_active(session_id):
            return True
        return False

    def revalidate(self) -> str:
        """Returns 'ok' | 'grace' | 'dead'. Non-HTTPException errors propagate
        so callers keep the existing 1011 'validation unavailable' path."""
        try:
            assert_access_token_still_valid(self.token, touch_session=False)
        except HTTPException:
            if self._classify_dead():
                return "dead"
            if _now_utc() < self.authenticated_until:
                return "ok"
            now = time.monotonic()
            if self.grace_deadline is None:
                self.grace_deadline = now + _WS_AUTH_GRACE_SEC
                _note("ws_auth_grace_entered")
                return "grace"
            if now >= self.grace_deadline:
                _note("ws_auth_grace_expired")
                return "dead"
            return "grace"
        # Keep the pre-lease semantics: an active socket keeps the session warm.
        if self.session_id:
            session_service.touch_session(self.session_id)
        self.grace_deadline = None
        return "ok"

    def apply_auth_payload(self, payload: dict | None) -> bool:
        """`{access_token}` rebinds the lease; `{ws_ticket}` extends it.

        Both must belong to the same user/session chain the socket opened with.
        """
        if not isinstance(payload, dict):
            _note("ws_auth_update_rejected")
            return False
        access_token = str(payload.get("access_token") or "").strip()
        ws_ticket = str(payload.get("ws_ticket") or "").strip()

        if access_token:
            try:
                assert_access_token_still_valid(access_token, touch_session=False)
            except Exception:
                _note("ws_auth_update_rejected")
                return False
            token_data = decode_access_token(access_token)
            if token_data is None or int(token_data.user_id or 0) != self.user_id:
                _note("ws_auth_update_rejected")
                return False
            self.token = access_token
            self.session_id = token_data.session_id or self.session_id
            self.authenticated_until = token_data.expires_at or (_now_utc())
            self.grace_deadline = None
            _note("ws_auth_update_ok")
            return True

        if ws_ticket:
            token_data = decode_access_token(ws_ticket, expected_token_type="ws_auth")
            if (
                token_data is None
                or token_data.token_type != "ws_auth"
                or int(token_data.user_id or 0) != self.user_id
                or (token_data.jti and auth_runtime_store_service.is_jti_revoked(token_data.jti))
                or (token_data.session_id and not session_service.is_session_active(token_data.session_id))
            ):
                _note("ws_auth_update_rejected")
                return False
            if token_data.session_id:
                self.session_id = token_data.session_id
            from datetime import timedelta

            self.authenticated_until = _now_utc() + timedelta(seconds=_WS_AUTH_PROOF_WINDOW_SEC)
            self.grace_deadline = None
            _note("ws_auth_update_ok")
            return True

        _note("ws_auth_update_rejected")
        return False
