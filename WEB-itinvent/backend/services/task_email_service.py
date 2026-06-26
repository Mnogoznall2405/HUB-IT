from __future__ import annotations

import logging
import os
import smtplib
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formataddr
from threading import RLock
from typing import Any, Iterator

from backend.services.mail_exchange_transport import (
    ExchangeTransportError,
    create_exchange_account,
    resolve_exchange_http_adapter,
    suppress_insecure_request_warning,
)
from backend.services.mail_outgoing_html import plain_text_to_html


logger = logging.getLogger(__name__)

_EXCHANGE_HTTP_ADAPTER_LOCK = RLock()
_EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS: Any = None
_EXCHANGE_HTTP_ADAPTER_SIGNATURE: tuple[Any, ...] | None = None


def _read_env(name: str, default: str = "") -> str:
    return str(os.getenv(name, default) or default).strip()


def _read_bool(name: str, default: bool = False) -> bool:
    raw = _read_env(name)
    if not raw:
        return bool(default)
    return raw.lower() in {"1", "true", "yes", "on"}


def _read_float(name: str, default: float, *, minimum: float = 0.1) -> float:
    raw = _read_env(name, str(default))
    try:
        return max(float(raw), minimum)
    except (TypeError, ValueError):
        return max(float(default), minimum)


def _is_private_smtp_host(host: str) -> bool:
    normalized = str(host or "").strip().lower()
    return (
        normalized.startswith("10.")
        or normalized.startswith("192.168.")
        or normalized.startswith("172.")
        or normalized in {"localhost", "127.0.0.1"}
    )


class TaskEmailService:
    """Low-volume Hub task email notifications via Exchange EWS or SMTP."""

    def is_enabled(self) -> bool:
        return _read_bool("TASK_EMAIL_NOTIFICATIONS_ENABLED", False)

    def auto_dispatch_enabled(self) -> bool:
        return _read_bool("TASK_EMAIL_AUTODISPATCH_ENABLED", True)

    def deadline_soon_hours(self) -> float:
        return _read_float("TASK_EMAIL_DEADLINE_SOON_HOURS", 24.0, minimum=1.0)

    def max_attempts(self) -> int:
        raw = _read_env("TASK_EMAIL_MAX_ATTEMPTS", "5")
        try:
            return max(1, min(20, int(raw)))
        except (TypeError, ValueError):
            return 5

    def app_url(self) -> str:
        return _read_env("TASK_EMAIL_APP_URL") or _read_env("APP_PUBLIC_URL")

    def sender_email(self) -> str:
        return (
            _read_env("TASK_EMAIL_FROM_EMAIL")
            or _read_env("SMTP_FROM_EMAIL")
            or _read_env("EMAIL_ADDRESS")
            or "noreply@localhost"
        )

    def sender_name(self) -> str:
        return _read_env("TASK_EMAIL_FROM_NAME", "HUB-IT")

    def transport(self) -> str:
        raw = _read_env("TASK_EMAIL_TRANSPORT").lower()
        if raw == "smtp":
            return "smtp"
        if raw in {"exchange", "ews"}:
            return "exchange"
        if _read_env("MAIL_EWS_URL") or _read_env("MAIL_EXCHANGE_HOST"):
            return "exchange"
        return "smtp"

    def exchange_host(self) -> str:
        return _read_env("MAIL_EXCHANGE_HOST", "10.103.0.50") or "10.103.0.50"

    def exchange_ews_url(self) -> str:
        raw = _read_env("MAIL_EWS_URL")
        if raw:
            return raw
        return f"https://{self.exchange_host()}/EWS/Exchange.asmx"

    def verify_tls(self) -> bool:
        raw = _read_env("MAIL_VERIFY_TLS")
        if not raw:
            return True
        return raw.lower() in {"1", "true", "yes", "on"}

    def _configure_exchange_http_adapter_for_runtime(self) -> None:
        try:
            from exchangelib.protocol import BaseProtocol
        except Exception:
            return
        signature, adapter_cls = resolve_exchange_http_adapter(
            verify_tls=self.verify_tls(),
            ca_bundle=self.tls_ca_bundle(),
        )
        if signature == ("no_verify",):
            suppress_insecure_request_warning()
        global _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS, _EXCHANGE_HTTP_ADAPTER_SIGNATURE
        with _EXCHANGE_HTTP_ADAPTER_LOCK:
            if _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS is None:
                _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS = BaseProtocol.HTTP_ADAPTER_CLS
            target_adapter = adapter_cls or _EXCHANGE_HTTP_DEFAULT_ADAPTER_CLS
            if _EXCHANGE_HTTP_ADAPTER_SIGNATURE != signature or BaseProtocol.HTTP_ADAPTER_CLS is not target_adapter:
                BaseProtocol.HTTP_ADAPTER_CLS = target_adapter
                _EXCHANGE_HTTP_ADAPTER_SIGNATURE = signature

    def tls_ca_bundle(self) -> str:
        return _read_env("MAIL_TLS_CA_BUNDLE") or _read_env("MAIL_CA_BUNDLE")

    def ews_login(self) -> str:
        return _read_env("TASK_EMAIL_EWS_LOGIN") or self.sender_email()

    def ews_password(self) -> str:
        return _read_env("TASK_EMAIL_EWS_PASSWORD") or _read_env("TASK_EMAIL_PASSWORD")

    def smtp_server(self) -> str:
        return _read_env("SMTP_SERVER", "localhost") or "localhost"

    def smtp_port(self) -> int:
        raw = _read_env("SMTP_PORT", "25")
        try:
            return int(raw)
        except (TypeError, ValueError):
            return 25

    def use_auth(self) -> bool:
        raw = _read_env("SMTP_USE_AUTH")
        if raw:
            return raw.lower() in {"1", "true", "yes", "on"}
        return not _is_private_smtp_host(self.smtp_server())

    def use_tls(self) -> bool:
        return _read_bool("SMTP_USE_TLS", False) and self.use_auth()

    def username(self) -> str:
        return _read_env("SMTP_USERNAME") or self.sender_email()

    def password(self) -> str:
        return _read_env("EMAIL_PASSWORD") or _read_env("SMTP_PASSWORD")

    def smtp_timeout(self) -> float:
        return _read_float("TASK_EMAIL_SMTP_TIMEOUT_SECONDS", 5.0, minimum=1.0)

    def ews_timeout(self) -> float:
        return _read_float("TASK_EMAIL_EWS_TIMEOUT_SECONDS", 30.0, minimum=5.0)

    @contextmanager
    def _exchange_protocol_context(self) -> Iterator[None]:
        signature, adapter_cls = resolve_exchange_http_adapter(
            verify_tls=self.verify_tls(),
            ca_bundle=self.tls_ca_bundle(),
        )
        if signature == ("no_verify",):
            suppress_insecure_request_warning()
        if adapter_cls is None:
            yield
            return
        try:
            from exchangelib.protocol import BaseProtocol
        except Exception:
            yield
            return
        old_adapter = BaseProtocol.HTTP_ADAPTER_CLS
        BaseProtocol.HTTP_ADAPTER_CLS = adapter_cls
        try:
            yield
        finally:
            BaseProtocol.HTTP_ADAPTER_CLS = old_adapter

    @staticmethod
    def is_valid_recipient(email: Any) -> bool:
        value = str(email or "").strip()
        return "@" in value and "." in value.rsplit("@", 1)[-1]

    def send_task_email(
        self,
        *,
        recipient_email: str,
        subject: str,
        body_text: str,
        body_html: str = "",
    ) -> bool:
        if not self.is_enabled():
            return False
        recipient = str(recipient_email or "").strip()
        if not self.is_valid_recipient(recipient):
            return False
        normalized_subject = str(subject or "").strip() or "HUB-IT: уведомление по задаче"
        normalized_body = str(body_text or "").strip() or "Откройте HUB-IT, чтобы посмотреть задачу."
        normalized_html = str(body_html or "").strip() or plain_text_to_html(normalized_body)
        if self.transport() == "exchange":
            return self._send_via_exchange(
                recipient_email=recipient,
                subject=normalized_subject,
                body_text=normalized_body,
                body_html=normalized_html,
            )
        return self._send_via_smtp(
            recipient_email=recipient,
            subject=normalized_subject,
            body_text=normalized_body,
            body_html=normalized_html,
        )

    def _send_via_exchange(self, *, recipient_email: str, subject: str, body_text: str, body_html: str) -> bool:
        login = self.ews_login()
        password = self.ews_password()
        if not login or not password:
            raise RuntimeError("TASK_EMAIL_EWS_PASSWORD is not configured for Exchange task notifications")

        try:
            from exchangelib import HTMLBody, Mailbox, Message
        except Exception as exc:
            raise RuntimeError("exchangelib package is not installed") from exc

        try:
            self._configure_exchange_http_adapter_for_runtime()
            account = create_exchange_account(
                email=self.sender_email(),
                login=login,
                password=password,
                ews_url=self.exchange_ews_url(),
                exchange_host=self.exchange_host(),
                protocol_context=self._exchange_protocol_context(),
            )
            message = Message(
                account=account,
                subject=subject,
                body=HTMLBody(body_html),
                to_recipients=[Mailbox(email_address=recipient_email)],
            )
            message.send()
            return True
        except ExchangeTransportError as exc:
            logger.exception("Task email Exchange transport failed")
            raise RuntimeError(str(exc)) from exc
        except Exception:
            logger.exception("Task email Exchange send failed")
            raise

    def _send_via_smtp(self, *, recipient_email: str, subject: str, body_text: str, body_html: str) -> bool:
        sender_email = self.sender_email()
        msg = EmailMessage()
        msg["From"] = formataddr((self.sender_name(), sender_email))
        msg["To"] = recipient_email
        msg["Subject"] = subject
        msg.set_content(body_text)
        msg.add_alternative(body_html, subtype="html")

        try:
            with smtplib.SMTP(self.smtp_server(), self.smtp_port(), timeout=self.smtp_timeout()) as server:
                if self.use_tls():
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                if self.use_auth() and self.password():
                    server.login(self.username(), self.password())
                server.send_message(msg)
            return True
        except smtplib.SMTPNotSupportedError as exc:
            logger.warning("Task email SMTP AUTH/TLS not supported, retrying without auth: %s", exc)
            try:
                with smtplib.SMTP(self.smtp_server(), self.smtp_port(), timeout=self.smtp_timeout()) as server:
                    server.send_message(msg)
                return True
            except Exception as retry_exc:
                logger.warning("Task email retry failed: %s", retry_exc)
                raise
        except Exception:
            logger.exception("Task email SMTP send failed")
            raise


task_email_service = TaskEmailService()
