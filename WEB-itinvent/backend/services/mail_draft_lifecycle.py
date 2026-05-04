from __future__ import annotations

from typing import Any, Callable


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


class MailDraftLifecycleError(Exception):
    pass


def _default_exchange_classes() -> tuple[Any, Any, Any, Any]:
    try:
        from exchangelib import HTMLBody, Mailbox, Message
        from exchangelib.attachments import FileAttachment
    except Exception as exc:
        raise MailDraftLifecycleError("exchangelib package is not installed") from exc
    return HTMLBody, Mailbox, Message, FileAttachment


class MailDraftLifecycle:
    def __init__(
        self,
        *,
        exchange_classes_factory: Callable[[], tuple[Any, Any, Any, Any]] = _default_exchange_classes,
    ) -> None:
        self.exchange_classes_factory = exchange_classes_factory

    @staticmethod
    def _retained_attachment_id(attachment: Any) -> str:
        return _normalize_text(getattr(getattr(attachment, "attachment_id", None), "id", ""))

    def _existing_draft(self, *, account: Any, draft_exchange_id: str) -> Any | None:
        if not _normalize_text(draft_exchange_id):
            return None
        try:
            return account.drafts.get(id=draft_exchange_id)
        except Exception:
            return None

    def upsert_draft(
        self,
        *,
        account: Any,
        draft_plan: Any,
        attachments: list[tuple[str, bytes]],
        draft_exchange_id: str = "",
    ) -> Any:
        HTMLBody, Mailbox, Message, FileAttachment = self.exchange_classes_factory()
        existing_item = self._existing_draft(account=account, draft_exchange_id=draft_exchange_id)
        to_recipients = [Mailbox(email_address=email) for email in draft_plan.recipients.to]
        cc_recipients = [Mailbox(email_address=email) for email in draft_plan.recipients.cc]
        bcc_recipients = [Mailbox(email_address=email) for email in draft_plan.recipients.bcc]
        body_payload = HTMLBody(draft_plan.body) if draft_plan.is_html else draft_plan.body

        try:
            if existing_item is None:
                draft_item = Message(
                    account=account,
                    folder=account.drafts,
                    subject=draft_plan.subject,
                    body=body_payload,
                    to_recipients=to_recipients,
                    cc_recipients=cc_recipients,
                    bcc_recipients=bcc_recipients,
                )
                for filename, content in attachments:
                    draft_item.attach(FileAttachment(name=filename, content=content))
                draft_item.save()
                return draft_item

            draft_item = existing_item
            draft_item.subject = draft_plan.subject
            draft_item.body = body_payload
            draft_item.to_recipients = to_recipients
            draft_item.cc_recipients = cc_recipients
            draft_item.bcc_recipients = bcc_recipients
            retain_ids = set(draft_plan.retain_attachment_ids)
            for attachment in list(getattr(draft_item, "attachments", None) or []):
                attachment_id = self._retained_attachment_id(attachment)
                if attachment_id and attachment_id in retain_ids:
                    continue
                try:
                    attachment.detach()
                except Exception:
                    pass
            for filename, content in attachments:
                draft_item.attach(FileAttachment(name=filename, content=content))
            draft_item.save(update_fields=["subject", "body", "to_recipients", "cc_recipients", "bcc_recipients"])
            return draft_item
        except MailDraftLifecycleError:
            raise
        except Exception as exc:
            raise MailDraftLifecycleError(str(exc)) from exc

    @staticmethod
    def delete_draft(*, account: Any, draft_exchange_id: str) -> None:
        try:
            item = account.drafts.get(id=draft_exchange_id)
            item.delete()
        except Exception as exc:
            raise MailDraftLifecycleError(str(exc)) from exc
