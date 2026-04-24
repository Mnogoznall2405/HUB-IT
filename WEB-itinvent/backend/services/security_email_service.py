from __future__ import annotations

import logging
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from backend.config import config

logger = logging.getLogger(__name__)


def _read_env(name: str, default: str = "") -> str:
    import os

    return str(os.getenv(name, default) or default).strip()


def _is_private_smtp_host(host: str) -> bool:
    normalized = str(host or "").strip().lower()
    return (
        normalized.startswith("10.")
        or normalized.startswith("192.168.")
        or normalized.startswith("172.")
        or normalized in {"localhost", "127.0.0.1"}
    )


class SecurityEmailService:
    """Security notification email sender."""

    def __init__(self) -> None:
        self.smtp_server = _read_env("SMTP_SERVER", "localhost") or "localhost"
        self.smtp_port = int(_read_env("SMTP_PORT", "25") or "25")
        self.email = _read_env("EMAIL_ADDRESS") or _read_env("SMTP_FROM_EMAIL") or "noreply@localhost"
        self.username = _read_env("SMTP_USERNAME") or self.email
        self.password = _read_env("EMAIL_PASSWORD") or _read_env("SMTP_PASSWORD")
        self.use_auth = _read_env("SMTP_USE_AUTH", "").lower() in {"1", "true", "yes", "on"}
        if not _read_env("SMTP_USE_AUTH", ""):
            self.use_auth = not _is_private_smtp_host(self.smtp_server)
        self.use_tls = _read_env("SMTP_USE_TLS", "0").lower() in {"1", "true", "yes", "on"} and self.use_auth

    def send_new_login_alert(
        self,
        *,
        recipient_email: str | None,
        username: str,
        ip_address: str,
        device_label: str,
        auth_method: str,
        login_at: datetime | None = None,
    ) -> bool:
        if not config.security.new_login_email_enabled:
            return False
        email = str(recipient_email or "").strip()
        if not email:
            return False

        occurred_at = (login_at or datetime.now(timezone.utc)).astimezone(timezone.utc)
        subject = "HUB-IT: новый вход в аккаунт"
        body = (
            "Зафиксирован новый вход в HUB-IT.\n\n"
            f"Пользователь: {username}\n"
            f"Дата (UTC): {occurred_at.isoformat()}\n"
            f"IP-адрес: {ip_address or '-'}\n"
            f"Устройство: {device_label or '-'}\n"
            f"Метод входа: {auth_method or '-'}\n\n"
            "Если это были не вы, немедленно смените пароль и обратитесь к администратору."
        )

        msg = MIMEMultipart()
        msg["From"] = self.email
        msg["To"] = email
        msg["Subject"] = subject
        msg.attach(MIMEText(body, "plain", "utf-8"))
        try:
            with smtplib.SMTP(self.smtp_server, self.smtp_port, timeout=15) as server:
                if self.use_tls:
                    server.ehlo()
                    server.starttls()
                    server.ehlo()
                if self.use_auth and self.password:
                    server.login(self.username, self.password)
                server.sendmail(self.email, [email], msg.as_string())
            return True
        except smtplib.SMTPNotSupportedError as exc:
            logger.warning("Security email AUTH not supported, retrying without AUTH: %s", exc)
            try:
                with smtplib.SMTP(self.smtp_server, self.smtp_port, timeout=15) as server:
                    server.sendmail(self.email, [email], msg.as_string())
                return True
            except Exception as retry_exc:
                logger.warning("Security email retry failed: %s", retry_exc)
                return False
        except Exception as exc:
            logger.warning("Security email send failed: %s", exc)
            return False


security_email_service = SecurityEmailService()
