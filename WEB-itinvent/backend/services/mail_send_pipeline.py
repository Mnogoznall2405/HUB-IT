from __future__ import annotations

from typing import Any, Callable

from backend.services.mail_compose_orchestration import build_reply_forward_reference_headers
from backend.services.mail_outgoing_html import extract_reply_new_body_html
from backend.services.mail_outgoing_attachment import exchange_attachment_kwargs


def _normalize_text(value: Any, default: str = "") -> str:
    if value is None:
        return default
    try:
        text = str(value).strip()
    except Exception:
        return default
    return text or default


def _has_prepared_native_reply_quote(body: Any) -> bool:
    return "data-mail-native-quote=" in _normalize_text(body).lower()


class MailSendPipelineError(Exception):
    def __init__(self, message: str, *, code: str = "MAIL_SEND_FAILED") -> None:
        super().__init__(message)
        self.code = code


REPLY_SOURCE_FIELDS = ("message_id", "references")
FORWARD_SOURCE_FIELDS = ("message_id", "attachments")
DRAFT_SOURCE_FIELDS = ("attachments",)


def _get_folder_item(folder_obj: Any, exchange_id: str, *, only_fields: tuple[str, ...] | None = None):
    if only_fields:
        try:
            return folder_obj.all().only(*only_fields).get(id=exchange_id)
        except Exception:
            pass
    try:
        return folder_obj.all().get(id=exchange_id)
    except Exception:
        return folder_obj.get(id=exchange_id)


def _default_exchange_classes() -> tuple[Any, Any, Any, Any]:
    try:
        from exchangelib import HTMLBody, Mailbox, Message
        from exchangelib.attachments import FileAttachment
    except Exception as exc:
        raise MailSendPipelineError(
            "exchangelib package is not installed",
            code="MAIL_EXCHANGELIB_MISSING",
        ) from exc
    return HTMLBody, Mailbox, Message, FileAttachment


class MailSendPipeline:
    def __init__(
        self,
        *,
        exchange_classes_factory: Callable[[], tuple[Any, Any, Any, Any]] = _default_exchange_classes,
    ) -> None:
        self.exchange_classes_factory = exchange_classes_factory

    def send(
        self,
        *,
        account: Any,
        send_plan: Any,
        attachments: list[tuple[str, bytes]],
        internet_message_id: str = "",
        retain_existing_attachments: list[str] | None = None,
        decode_message_id: Callable[[str], tuple[Any, ...]],
        resolve_folder: Callable[[Any, str], tuple[Any, str]],
        locate_message_item: Callable[..., tuple[Any, str, Any]],
        collect_forwarded_attachments: Callable[..., list[tuple[str, bytes]]],
        item_message_id: Callable[[Any], str],
        resolve_attachment_id: Callable[[str], str],
        validate_attachments: Callable[[list[tuple[str, bytes]]], None],
        collect_draft_attachments: Callable[..., list[Any]] | None = None,
    ) -> Any:
        HTMLBody, Mailbox, Message, FileAttachment = self.exchange_classes_factory()
        outgoing_attachments = list(attachments or [])
        to_recipients = [Mailbox(email_address=email) for email in send_plan.recipients.to]
        cc_mailboxes = [Mailbox(email_address=email) for email in send_plan.recipients.cc]
        bcc_mailboxes = [Mailbox(email_address=email) for email in send_plan.recipients.bcc]
        body_payload = HTMLBody(send_plan.body) if send_plan.is_html else send_plan.body
        msg_kwargs = dict(
            account=account,
            folder=account.sent,
            subject=send_plan.subject,
            body=body_payload,
            to_recipients=to_recipients,
            cc_recipients=cc_mailboxes,
            bcc_recipients=bcc_mailboxes,
        )
        reply_message_id_value = ""
        reply_references = ""
        reply_item = None
        forward_message_id_value = ""
        retain_attachment_ids = (
            {
                resolve_attachment_id(token)
                for token in (retain_existing_attachments or [])
                if _normalize_text(token)
            }
            if retain_existing_attachments is not None
            else None
        )

        if send_plan.draft_id:
            draft_folder_key, draft_exchange_id = decode_message_id(send_plan.draft_id)[:2]
            if draft_folder_key != "drafts":
                raise MailSendPipelineError("Draft id must point to drafts folder")
            draft_folder_obj, _ = resolve_folder(account, draft_folder_key)
            try:
                draft_item = _get_folder_item(
                    draft_folder_obj,
                    draft_exchange_id,
                    only_fields=DRAFT_SOURCE_FIELDS,
                )
            except Exception as exc:
                raise MailSendPipelineError(f"Draft source message not found: {exc}") from exc
            draft_attachment_collector = collect_draft_attachments or collect_forwarded_attachments
            outgoing_attachments.extend(
                draft_attachment_collector(
                    item=draft_item,
                    account=account,
                    retain_attachment_ids=retain_attachment_ids,
                )
            )
            validate_attachments(outgoing_attachments)

        if send_plan.reply_to_message_id:
            reply_folder_key, reply_exchange_id = decode_message_id(send_plan.reply_to_message_id)[:2]
            try:
                _reply_folder, _reply_key, reply_item = locate_message_item(
                    account,
                    folder_key=reply_folder_key,
                    exchange_id=reply_exchange_id,
                    only_fields=REPLY_SOURCE_FIELDS,
                )
            except Exception as exc:
                raise MailSendPipelineError(f"Reply source message not found: {exc}") from exc
            reply_message_id_value = item_message_id(reply_item)
            reply_references = _normalize_text(getattr(reply_item, "references", None))

        if send_plan.forward_message_id:
            forward_folder_key, forward_exchange_id = decode_message_id(send_plan.forward_message_id)[:2]
            try:
                _forward_folder, _forward_key, forward_item = locate_message_item(
                    account,
                    folder_key=forward_folder_key,
                    exchange_id=forward_exchange_id,
                    only_fields=FORWARD_SOURCE_FIELDS,
                )
            except Exception as exc:
                raise MailSendPipelineError(f"Forward source message not found: {exc}") from exc
            forward_message_id_value = item_message_id(forward_item)
            outgoing_attachments.extend(
                collect_forwarded_attachments(item=forward_item, account=account)
            )
            validate_attachments(outgoing_attachments)

        msg_kwargs.update(
            build_reply_forward_reference_headers(
                reply_message_id=reply_message_id_value,
                reply_references=reply_references,
                forward_message_id=forward_message_id_value,
            )
        )

        threaded_reply = self._send_threaded_reply(
            account=account,
            send_plan=send_plan,
            reply_item=reply_item,
            outgoing_attachments=outgoing_attachments,
            to_recipients=to_recipients,
            cc_mailboxes=cc_mailboxes,
            bcc_mailboxes=bcc_mailboxes,
            html_body_cls=HTMLBody,
        )
        if threaded_reply is not None:
            return threaded_reply

        try:
            msg = Message(**msg_kwargs)
            if internet_message_id:
                try:
                    msg.message_id = internet_message_id
                except Exception:
                    pass
            for attachment in outgoing_attachments:
                msg.attach(FileAttachment(**exchange_attachment_kwargs(attachment)))
            msg.send_and_save()
            return msg
        except MailSendPipelineError:
            raise
        except Exception as exc:
            raise MailSendPipelineError(str(exc), code="MAIL_SEND_FAILED") from exc

    def _send_threaded_reply(
        self,
        *,
        account: Any,
        send_plan: Any,
        reply_item: Any,
        outgoing_attachments: list[tuple[str, bytes]],
        to_recipients: list[Any],
        cc_mailboxes: list[Any],
        bcc_mailboxes: list[Any],
        html_body_cls: Any,
    ) -> Any | None:
        if reply_item is None or not send_plan.reply_to_message_id:
            return None
        if send_plan.draft_id or send_plan.forward_message_id or outgoing_attachments:
            return None
        # Native replies already contain the original formatted HTML. ReplyToItem
        # would discard it and rebuild a flattened "Original Message" history.
        if send_plan.is_html and _has_prepared_native_reply_quote(send_plan.body):
            return None
        create_reply = getattr(reply_item, "create_reply", None)
        if not callable(create_reply):
            return None

        new_body_html = extract_reply_new_body_html(send_plan.body) if send_plan.is_html else send_plan.body
        body_payload = html_body_cls(new_body_html) if send_plan.is_html else new_body_html
        try:
            reply = create_reply(
                subject=send_plan.subject,
                body=body_payload,
                to_recipients=to_recipients,
                cc_recipients=cc_mailboxes,
                bcc_recipients=bcc_mailboxes,
            )
        except Exception:
            return None

        try:
            sent = reply.send(save_copy=True, copy_to_folder=getattr(account, "sent", None))
            return sent if sent is not None else reply
        except MailSendPipelineError:
            raise
        except Exception as exc:
            raise MailSendPipelineError(str(exc), code="MAIL_SEND_FAILED") from exc
