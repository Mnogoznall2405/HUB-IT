from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_compose_orchestration import RecipientSet, OutboundSendPlan
from backend.services.mail_send_pipeline import MailSendPipeline, MailSendPipelineError


class FakeHTMLBody(str):
    pass


class FakeMailbox:
    def __init__(self, *, email_address: str):
        self.email_address = email_address


class FakeFileAttachment:
    def __init__(self, *, name: str, content: bytes):
        self.name = name
        self.content = content


class FakeMessage:
    created: list["FakeMessage"] = []

    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.attachments = []
        self.id = "sent-exchange-id"
        self.message_id = None
        FakeMessage.created.append(self)

    def attach(self, attachment):
        self.attachments.append(attachment)

    def send_and_save(self):
        self.sent = True


def _plan(**overrides):
    payload = dict(
        effective_mailbox_id="mb-1",
        recipients=RecipientSet(to=["to@example.com"], cc=["cc@example.com"], bcc=[]),
        subject="Hello",
        body="<p>Hi</p>",
        is_html=True,
        reply_to_message_id="",
        forward_message_id="",
        draft_id="",
    )
    payload.update(overrides)
    return OutboundSendPlan(**payload)


def _pipeline() -> MailSendPipeline:
    FakeMessage.created.clear()
    return MailSendPipeline(
        exchange_classes_factory=lambda: (FakeHTMLBody, FakeMailbox, FakeMessage, FakeFileAttachment),
    )


def test_send_pipeline_attaches_files_and_saves_to_sent():
    account = SimpleNamespace(sent="sent-folder")
    msg = _pipeline().send(
        account=account,
        send_plan=_plan(),
        attachments=[("note.txt", b"note")],
        internet_message_id="<id@example.com>",
        decode_message_id=lambda _token: ("inbox", "ex-1"),
        resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
        locate_message_item=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no locate")),
        collect_forwarded_attachments=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no collect")),
        item_message_id=lambda _item: "",
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert msg.sent is True
    assert msg.kwargs["folder"] == "sent-folder"
    assert msg.kwargs["subject"] == "Hello"
    assert [item.name for item in msg.attachments] == ["note.txt"]
    assert msg.message_id == "<id@example.com>"
    assert [box.email_address for box in msg.kwargs["to_recipients"]] == ["to@example.com"]
    assert [box.email_address for box in msg.kwargs["cc_recipients"]] == ["cc@example.com"]


def test_send_pipeline_forwards_source_attachments():
    source = SimpleNamespace(message_id="<fwd@example.com>")
    collected = []

    def collect_forwarded_attachments(**kwargs):
        collected.append(kwargs)
        return [("source.pdf", b"pdf")]

    def locate_message_item(account, *, folder_key, exchange_id, only_fields=None):
        assert folder_key == "inbox"
        assert exchange_id == "fwd-ex"
        assert only_fields == ("message_id", "attachments")
        return object(), folder_key, source

    msg = _pipeline().send(
        account=SimpleNamespace(sent="sent-folder"),
        send_plan=_plan(forward_message_id="encoded-forward"),
        attachments=[("manual.txt", b"manual")],
        decode_message_id=lambda token: ("inbox", "fwd-ex") if token == "encoded-forward" else ("inbox", "other"),
        resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
        locate_message_item=locate_message_item,
        collect_forwarded_attachments=collect_forwarded_attachments,
        item_message_id=lambda item: item.message_id,
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda attachments: collected.append({"validated": len(attachments)}),
    )

    assert [item.name for item in msg.attachments] == ["manual.txt", "source.pdf"]
    assert collected[0]["item"] is source
    assert collected[1] == {"validated": 2}
    assert msg.kwargs.get("references") == "<fwd@example.com>" or "references" in msg.kwargs


def test_send_pipeline_reply_loads_header_fields_only():
    source = SimpleNamespace(message_id="<reply@example.com>", references="<prev@example.com>")
    located = {}

    def locate_message_item(account, *, folder_key, exchange_id, only_fields=None):
        located.update(folder_key=folder_key, exchange_id=exchange_id, only_fields=only_fields)
        return object(), folder_key, source

    msg = _pipeline().send(
        account=SimpleNamespace(sent="sent-folder"),
        send_plan=_plan(reply_to_message_id="encoded-reply"),
        attachments=[],
        decode_message_id=lambda token: ("inbox", "reply-ex") if token == "encoded-reply" else ("inbox", "other"),
        resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
        locate_message_item=locate_message_item,
        collect_forwarded_attachments=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no collect")),
        item_message_id=lambda item: item.message_id,
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert located == {
        "folder_key": "inbox",
        "exchange_id": "reply-ex",
        "only_fields": ("message_id", "references"),
    }
    assert msg.kwargs.get("in_reply_to") == "<reply@example.com>" or "in_reply_to" in msg.kwargs


class FakeReplyItem:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.id = "threaded-reply-id"
        self.sent = False
        self.copy_to_folder = None

    def send(self, save_copy=True, copy_to_folder=None):
        self.sent = True
        self.save_copy = save_copy
        self.copy_to_folder = copy_to_folder
        return self


class FakeReplySource:
    def __init__(self):
        self.message_id = "<reply@example.com>"
        self.references = "<prev@example.com>"
        self.calls = []

    def create_reply(self, subject, body, to_recipients=None, cc_recipients=None, bcc_recipients=None, author=None):
        item = FakeReplyItem(
            subject=subject,
            body=body,
            to_recipients=to_recipients,
            cc_recipients=cc_recipients,
            bcc_recipients=bcc_recipients,
            author=author,
        )
        self.calls.append(item)
        return item


def test_send_pipeline_reply_uses_exchange_create_reply_without_attachments():
    source = FakeReplySource()
    account = SimpleNamespace(sent="sent-folder")
    quoted_body = (
        '<div data-mail-outgoing="true">'
        "<p>Согласен</p>"
        '<div data-mail-quoted-block="true"><div class="quoted-mail"><p>Старое</p></div></div>'
        "</div>"
    )

    msg = _pipeline().send(
        account=account,
        send_plan=_plan(reply_to_message_id="encoded-reply", body=quoted_body),
        attachments=[],
        decode_message_id=lambda token: ("inbox", "reply-ex") if token == "encoded-reply" else ("inbox", "other"),
        resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
        locate_message_item=lambda *_args, **_kwargs: (object(), "inbox", source),
        collect_forwarded_attachments=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no collect")),
        item_message_id=lambda item: item.message_id,
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert msg is source.calls[0]
    assert msg.sent is True
    assert msg.copy_to_folder == "sent-folder"
    assert "Согласен" in str(msg.kwargs["body"])
    assert "Старое" not in str(msg.kwargs["body"])
    assert FakeMessage.created == []


def test_send_pipeline_reply_keeps_new_message_path_when_attachments_present():
    source = FakeReplySource()
    msg = _pipeline().send(
        account=SimpleNamespace(sent="sent-folder"),
        send_plan=_plan(reply_to_message_id="encoded-reply"),
        attachments=[("note.txt", b"note")],
        decode_message_id=lambda token: ("inbox", "reply-ex") if token == "encoded-reply" else ("inbox", "other"),
        resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
        locate_message_item=lambda *_args, **_kwargs: (object(), "inbox", source),
        collect_forwarded_attachments=lambda **_kwargs: (_ for _ in ()).throw(AssertionError("no collect")),
        item_message_id=lambda item: item.message_id,
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert source.calls == []
    assert msg.kwargs.get("in_reply_to") == "<reply@example.com>" or "in_reply_to" in msg.kwargs
    assert [item.name for item in msg.attachments] == ["note.txt"]


class _FakeDraftQuery:
    def __init__(self, folder):
        self.folder = folder

    def only(self, *fields):
        self.folder.last_only_fields = fields
        return self

    def get(self, *, id: str):
        self.folder.only_get_ids.append(id)
        if id not in self.folder.items:
            raise KeyError(id)
        return self.folder.items[id]


class _FakeDraftFolder:
    def __init__(self, items, *, fail_only=False):
        self.items = dict(items)
        self.last_only_fields = None
        self.only_get_ids = []
        self.full_get_ids = []
        self.fail_only = fail_only

    def all(self):
        return _FakeDraftQuery(self)

    def get(self, *, id: str):
        self.full_get_ids.append(id)
        if self.fail_only:
            return self.items[id]
        raise AssertionError("full folder get should not run when only() works")


def test_send_pipeline_draft_loads_attachments_only():
    draft_item = SimpleNamespace(id="draft-ex")
    folder = _FakeDraftFolder({"draft-ex": draft_item})
    collected = []

    msg = _pipeline().send(
        account=SimpleNamespace(sent="sent-folder", drafts=folder),
        send_plan=_plan(draft_id="encoded-draft"),
        attachments=[("new.txt", b"new")],
        decode_message_id=lambda token: ("drafts", "draft-ex") if token == "encoded-draft" else ("inbox", "other"),
        resolve_folder=lambda *_args: (folder, "drafts"),
        locate_message_item=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no locate")),
        collect_forwarded_attachments=lambda **kwargs: collected.append(kwargs) or [("kept.pdf", b"pdf")],
        item_message_id=lambda _item: "",
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert folder.last_only_fields == ("attachments",)
    assert folder.only_get_ids == ["draft-ex"]
    assert folder.full_get_ids == []
    assert collected[0]["item"] is draft_item
    assert [item.name for item in msg.attachments] == ["new.txt", "kept.pdf"]


def test_send_pipeline_draft_falls_back_to_full_get():
    draft_item = SimpleNamespace(id="draft-ex")
    folder = _FakeDraftFolder({"draft-ex": draft_item}, fail_only=True)

    def _failing_only(*_fields):
        raise RuntimeError("only unsupported")

    folder.all = lambda: SimpleNamespace(only=_failing_only)

    collected = []
    _pipeline().send(
        account=SimpleNamespace(sent="sent-folder", drafts=folder),
        send_plan=_plan(draft_id="encoded-draft"),
        attachments=[],
        decode_message_id=lambda token: ("drafts", "draft-ex") if token == "encoded-draft" else ("inbox", "other"),
        resolve_folder=lambda *_args: (folder, "drafts"),
        locate_message_item=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("no locate")),
        collect_forwarded_attachments=lambda **kwargs: collected.append(kwargs) or [],
        item_message_id=lambda _item: "",
        resolve_attachment_id=lambda token: token,
        validate_attachments=lambda _attachments: None,
    )

    assert folder.full_get_ids == ["draft-ex"]
    assert collected[0]["item"] is draft_item


def test_send_pipeline_rejects_non_draft_folder():
    with pytest.raises(MailSendPipelineError, match="Draft id must point to drafts folder"):
        _pipeline().send(
            account=SimpleNamespace(sent="sent-folder"),
            send_plan=_plan(draft_id="encoded-draft"),
            attachments=[],
            decode_message_id=lambda _token: ("inbox", "draft-ex"),
            resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
            locate_message_item=lambda *_args, **_kwargs: (None, "", None),
            collect_forwarded_attachments=lambda **_kwargs: [],
            item_message_id=lambda _item: "",
            resolve_attachment_id=lambda token: token,
            validate_attachments=lambda _attachments: None,
        )


def test_send_pipeline_missing_exchangelib_uses_dedicated_code():
    pipeline = MailSendPipeline(
        exchange_classes_factory=lambda: (_ for _ in ()).throw(
            MailSendPipelineError("exchangelib package is not installed", code="MAIL_EXCHANGELIB_MISSING")
        )
    )
    with pytest.raises(MailSendPipelineError) as exc_info:
        pipeline.send(
            account=SimpleNamespace(sent="sent-folder"),
            send_plan=_plan(),
            attachments=[],
            decode_message_id=lambda _token: ("inbox", "ex-1"),
            resolve_folder=lambda *_args: (SimpleNamespace(), "inbox"),
            locate_message_item=lambda *_args, **_kwargs: (None, "", None),
            collect_forwarded_attachments=lambda **_kwargs: [],
            item_message_id=lambda _item: "",
            resolve_attachment_id=lambda token: token,
            validate_attachments=lambda _attachments: None,
        )
    assert exc_info.value.code == "MAIL_EXCHANGELIB_MISSING"
