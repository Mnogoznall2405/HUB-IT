from __future__ import annotations

import logging
from datetime import datetime, timezone

from backend.config import config
from backend.services.task_email_service import task_email_service

logger = logging.getLogger(__name__)


class SecurityEmailService:
    """Security notification email sender via HUB-IT service mailbox."""

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

        return task_email_service.send_outgoing_email(
            recipient_email=email,
            subject=subject,
            body_text=body,
        )


security_email_service = SecurityEmailService()
