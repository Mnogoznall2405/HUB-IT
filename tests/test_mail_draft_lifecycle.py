from __future__ import annotations

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_draft_lifecycle import MailDraftLifecycle, MailDraftLifecycleError


class FakeHTMLBody(str):
    pass


class FakeMailbox:
    def __init__(self, *, email_address: str):
        self.email_address = email_address


class FakeFileAttachment:
    def __init__(self, *, name: str, content: bytes):
        self.name = name
        self.content = content


class FakeAttachment:
    def __init__(self, attachment_id: str):
        self.attachment_id = SimpleNamespace(id=attachment_id)
        self.detached = False

    def detach(self):
        self.detached = True


class FakeMessage:
    created: list["FakeMessage"] = []

    def __init__(
        self,
        *,
        account,
        folder,
        subject,
        body,
        to_recipients,
        cc_recipients,
        bcc_recipients,
    ):
        self.account = account
        self.folder = folder
        self.id = "draft-created"
        self.subject = subject
        self.body = body
        self.to_recipients = to_recipients
        self.cc_recipients = cc_recipients
        self.bcc_recipients = bcc_recipients
        self.attachments = []
        self.saved_update_fields = None
        FakeMessage.created.append(self)

    def attach(self, attachment):
        self.attachments.append(attachment)

    def save(self, update_fields=None):
        self.saved_update_fields = update_fields


class FakeDrafts:
    def __init__(self, existing=None):
        self.existing = existing

    def get(self, *, id: str):
        if self.existing is None:
            raise KeyError(id)
        return self.existing


def _factory():
    return FakeHTMLBody, FakeMailbox, FakeMessage, FakeFileAttachment


def _plan(**overrides):
    values = {
        "recipients": SimpleNamespace(to=["to@example.com"], cc=["cc@example.com"], bcc=[]),
        "subject": "Subject",
        "body": "<p>Body</p>",
        "is_html": True,
        "retain_attachment_ids": [],
    }
    values.update(overrides)
    return SimpleNamespace(**values)


def test_draft_lifecycle_creates_new_draft_with_recipients_and_attachments():
    FakeMessage.created = []
    account = SimpleNamespace(drafts=FakeDrafts())
    lifecycle = MailDraftLifecycle(exchange_classes_factory=_factory)

    draft = lifecycle.upsert_draft(
        account=account,
        draft_plan=_plan(),
        attachments=[("file.txt", b"data")],
    )

    assert draft is FakeMessage.created[0]
    assert draft.subject == "Subject"
    assert isinstance(draft.body, FakeHTMLBody)
    assert [mailbox.email_address for mailbox in draft.to_recipients] == ["to@example.com"]
    assert [attachment.name for attachment in draft.attachments] == ["file.txt"]
    assert draft.saved_update_fields is None


def test_draft_lifecycle_updates_existing_draft_and_detaches_unretained_attachments():
    retained = FakeAttachment("keep")
    removed = FakeAttachment("remove")
    existing = SimpleNamespace(
        id="draft-existing",
        attachments=[retained, removed],
        attach=lambda attachment: existing.attachments.append(attachment),
        save=lambda update_fields=None: setattr(existing, "saved_update_fields", update_fields),
    )
    account = SimpleNamespace(drafts=FakeDrafts(existing=existing))
    lifecycle = MailDraftLifecycle(exchange_classes_factory=_factory)

    draft = lifecycle.upsert_draft(
        account=account,
        draft_plan=_plan(retain_attachment_ids=["keep"], is_html=False, body="plain"),
        attachments=[("new.txt", b"new")],
        draft_exchange_id="draft-existing",
    )

    assert draft is existing
    assert existing.subject == "Subject"
    assert existing.body == "plain"
    assert retained.detached is False
    assert removed.detached is True
    assert [getattr(attachment, "name", "") for attachment in existing.attachments][-1] == "new.txt"
    assert existing.saved_update_fields == ["subject", "body", "to_recipients", "cc_recipients", "bcc_recipients"]


def test_draft_lifecycle_delete_draft_deletes_existing_item():
    deleted = {"called": False}
    existing = SimpleNamespace(delete=lambda: deleted.__setitem__("called", True))
    account = SimpleNamespace(drafts=FakeDrafts(existing=existing))

    MailDraftLifecycle.delete_draft(account=account, draft_exchange_id="draft-existing")

    assert deleted["called"] is True


def test_draft_lifecycle_delete_draft_wraps_exchange_errors():
    account = SimpleNamespace(drafts=FakeDrafts())

    with pytest.raises(MailDraftLifecycleError):
        MailDraftLifecycle.delete_draft(account=account, draft_exchange_id="missing")
