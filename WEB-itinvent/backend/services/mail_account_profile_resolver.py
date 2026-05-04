from __future__ import annotations

from collections.abc import Callable
from typing import Any

from backend.services.mail_mailbox_model import normalize_text, to_bool


class MailAccountProfileError(RuntimeError):
    def __init__(self, message: str, *, code: str | None = None, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = int(status_code or 400)


class MailAccountProfileResolver:
    def __init__(
        self,
        *,
        resolve_primary_mailbox_row: Callable[..., dict[str, Any] | None],
        normalize_mailbox_auth_mode: Callable[[Any, str], str],
        normalize_exchange_login: Callable[[str], str],
        decrypt_secret: Callable[[str], str],
        get_request_session_id: Callable[[], str],
        get_session_context: Callable[[str, int], dict[str, Any] | None],
        resolve_session_password: Callable[[str, int], str],
        normalize_signature_html: Callable[[Any], str],
    ) -> None:
        self._resolve_primary_mailbox_row = resolve_primary_mailbox_row
        self._normalize_mailbox_auth_mode = normalize_mailbox_auth_mode
        self._normalize_exchange_login = normalize_exchange_login
        self._decrypt_secret = decrypt_secret
        self._get_request_session_id = get_request_session_id
        self._get_session_context = get_session_context
        self._resolve_session_password = resolve_session_password
        self._normalize_signature_html = normalize_signature_html

    def _session_context(self, *, user_id: int) -> tuple[str, dict[str, Any] | None]:
        session_id = self._get_request_session_id()
        return session_id, self._get_session_context(session_id, user_id)

    def _session_password(self, *, session_id: str, user_id: int) -> str:
        return normalize_text(self._resolve_session_password(session_id, user_id))

    def resolve_primary_credentials(
        self,
        *,
        user: dict[str, Any],
        current_mailbox_id: str = "",
        require_password: bool,
    ) -> dict[str, Any]:
        user_id = int(user.get("id") or 0)
        primary_row = self._resolve_primary_mailbox_row(user_id=user_id, allow_inactive=True)
        if not primary_row:
            raise MailAccountProfileError(
                "Primary mailbox credentials are not configured",
                code="MAIL_PASSWORD_REQUIRED",
                status_code=409,
            )
        if current_mailbox_id and normalize_text(primary_row.get("id")) == normalize_text(current_mailbox_id):
            raise MailAccountProfileError("Shared mailbox cannot use itself as primary credentials", status_code=409)

        primary_auth_mode = self._normalize_mailbox_auth_mode(primary_row.get("auth_mode"), "stored_credentials")
        primary_email = normalize_text(primary_row.get("mailbox_email")).lower()
        primary_login = normalize_text(primary_row.get("mailbox_login")).lower()
        if not primary_login:
            username = normalize_text(user.get("username")).lower()
            primary_login = self._normalize_exchange_login(username) if username else primary_email

        password = ""
        requires_password = False
        requires_relogin = False
        if primary_auth_mode == "primary_session":
            session_id, session_context = self._session_context(user_id=user_id)
            session_login = normalize_text((session_context or {}).get("exchange_login")).lower()
            if session_login:
                primary_login = session_login
            if require_password:
                password = self._session_password(session_id=session_id, user_id=user_id)
                if not password:
                    raise MailAccountProfileError(
                        "Mail access requires re-login",
                        code="MAIL_RELOGIN_REQUIRED",
                        status_code=409,
                    )
            else:
                requires_relogin = not bool(
                    session_context and self._session_password(session_id=session_id, user_id=user_id)
                )
        else:
            password_enc = normalize_text(primary_row.get("mailbox_password_enc"))
            if require_password:
                if not password_enc:
                    raise MailAccountProfileError(
                        "Primary mailbox password is not configured",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
                try:
                    password = normalize_text(self._decrypt_secret(password_enc))
                except Exception as exc:
                    raise MailAccountProfileError(str(exc)) from exc
                if not password:
                    raise MailAccountProfileError(
                        "Primary mailbox password is empty",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
            else:
                requires_password = not bool(password_enc)

        return {
            "login": primary_login,
            "password": password,
            "requires_password": requires_password,
            "requires_relogin": requires_relogin,
        }

    def build_profile(
        self,
        *,
        user: dict[str, Any],
        mailbox_row: dict[str, Any],
        require_password: bool,
    ) -> dict[str, Any]:
        auth_mode = self._normalize_mailbox_auth_mode(mailbox_row.get("auth_mode"), "stored_credentials")
        email = normalize_text(mailbox_row.get("mailbox_email")).lower()
        login = normalize_text(mailbox_row.get("mailbox_login")).lower()
        signature = self._normalize_signature_html(user.get("mail_signature_html"))
        if not email:
            raise MailAccountProfileError("Mailbox email is not configured")

        primary_credentials: dict[str, Any] = {}
        if auth_mode == "primary_credentials":
            primary_credentials = self.resolve_primary_credentials(
                user=user,
                current_mailbox_id=normalize_text(mailbox_row.get("id")),
                require_password=require_password,
            )
            login = normalize_text(primary_credentials.get("login")).lower()
        elif auth_mode == "primary_session":
            session_id, session_context = self._session_context(user_id=int(user.get("id") or 0))
            session_login = normalize_text((session_context or {}).get("exchange_login")).lower()
            if session_login:
                login = session_login
            elif not login:
                username = normalize_text((user or {}).get("username")).lower()
                login = self._normalize_exchange_login(username) if username else ""
        elif not login:
            login = email
        if not login:
            raise MailAccountProfileError("Mailbox login is not configured")

        password = ""
        mail_requires_password = False
        mail_requires_relogin = False
        if require_password:
            if auth_mode == "primary_credentials":
                password = normalize_text(primary_credentials.get("password"))
            elif auth_mode == "primary_session":
                session_id, session_context = self._session_context(user_id=int(user.get("id") or 0))
                if not session_context:
                    raise MailAccountProfileError(
                        "Mail access requires re-login",
                        code="MAIL_RELOGIN_REQUIRED",
                        status_code=409,
                    )
                password = self._session_password(session_id=session_id, user_id=int(user.get("id") or 0))
                if not password:
                    raise MailAccountProfileError(
                        "Mail access requires re-login",
                        code="MAIL_RELOGIN_REQUIRED",
                        status_code=409,
                    )
            else:
                password_enc = normalize_text(mailbox_row.get("mailbox_password_enc"))
                if not password_enc:
                    raise MailAccountProfileError(
                        "Mailbox password is not configured",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
                try:
                    password = normalize_text(self._decrypt_secret(password_enc))
                except Exception as exc:
                    raise MailAccountProfileError(str(exc)) from exc
                if not password:
                    raise MailAccountProfileError(
                        "Mailbox password is empty",
                        code="MAIL_PASSWORD_REQUIRED",
                        status_code=409,
                    )
        else:
            if auth_mode == "primary_credentials":
                mail_requires_password = bool(primary_credentials.get("requires_password"))
                mail_requires_relogin = bool(primary_credentials.get("requires_relogin"))
            elif auth_mode == "primary_session":
                session_id, session_context = self._session_context(user_id=int(user.get("id") or 0))
                session_login = normalize_text((session_context or {}).get("exchange_login")).lower()
                if session_login:
                    login = session_login
                mail_requires_relogin = not bool(
                    session_context and self._session_password(session_id=session_id, user_id=int(user.get("id") or 0))
                )
            else:
                mail_requires_password = not bool(normalize_text(mailbox_row.get("mailbox_password_enc")))

        mail_auth_mode = (
            "ad_auto"
            if auth_mode == "primary_session"
            else "primary_credentials"
            if auth_mode == "primary_credentials"
            else "manual"
        )
        return {
            "user": user,
            "mailbox_id": normalize_text(mailbox_row.get("id")),
            "label": normalize_text(mailbox_row.get("label")) or email,
            "email": email,
            "login": login,
            "password": password,
            "signature": signature,
            "mail_auth_mode": mail_auth_mode,
            "mail_requires_password": mail_requires_password,
            "mail_requires_relogin": mail_requires_relogin,
            "is_primary": to_bool(mailbox_row.get("is_primary"), default=False),
            "is_active": to_bool(mailbox_row.get("is_active"), default=True),
            "mail_is_configured": bool(email and login and not mail_requires_password and not mail_requires_relogin),
        }
