from __future__ import annotations

import base64
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

codec = importlib.import_module("backend.services.mail_reference_codec")
mail_module = importlib.import_module("backend.services.mail_service")


def test_reference_codec_round_trips_v1_and_v2_message_ids():
    v1 = codec.encode_message_id("Inbox", "exchange-1")
    v2 = codec.encode_message_id("Sent", "exchange-2", mailbox_id="mbox-1")

    assert codec.decode_message_ref(v1) == ("inbox", "exchange-1", "")
    assert codec.decode_message_id(v1) == ("inbox", "exchange-1")
    assert codec.decode_message_ref(v2) == ("sent", "exchange-2", "mbox-1")


def test_reference_codec_round_trips_folder_ids():
    token = codec.encode_folder_id("Archive", "folder-1")

    assert codec.decode_folder_id(token) == ("archive", "folder-1")


def test_reference_codec_rejects_invalid_references():
    with pytest.raises(codec.MailReferenceError, match="Message id is required"):
        codec.decode_message_ref("")

    bad_message = base64.urlsafe_b64encode(b"not-a-message").decode("utf-8").rstrip("=")
    with pytest.raises(codec.MailReferenceError, match="Invalid message id payload"):
        codec.decode_message_ref(bad_message)

    bad_folder = base64.urlsafe_b64encode(b"scope::").decode("utf-8").rstrip("=")
    with pytest.raises(codec.MailReferenceError, match="Invalid folder id payload"):
        codec.decode_folder_id(bad_folder)


def test_reference_codec_round_trips_compact_attachment_tokens():
    raw_id = "abc+def/ghi-jkl_mno~p"
    token = codec.encode_attachment_token(raw_id, mailbox_id="ignored-for-att2")

    assert token.startswith("att2_")
    assert codec.decode_attachment_ref(token) == ("", raw_id)
    assert codec.decode_attachment_token(token) == raw_id


def test_reference_codec_decodes_legacy_att1_with_mailbox_scope():
    raw_id = "legacy-att"
    legacy_payload = "v2::mbox-1::" + raw_id
    legacy_token = "att1_" + base64.urlsafe_b64encode(legacy_payload.encode("utf-8")).decode("utf-8").rstrip("=")

    assert codec.decode_attachment_ref(legacy_token) == ("mbox-1", raw_id)


def test_reference_codec_scoped_storage_and_inline_url():
    scoped = codec.make_scoped_storage_key(mailbox_id="mbox-1", value="folder-1")

    assert scoped == "mbox-1::folder-1"
    assert codec.split_scoped_storage_key(scoped) == ("mbox-1", "folder-1")
    assert codec.split_scoped_storage_key("legacy-folder") == ("", "legacy-folder")
    assert codec.resolve_mailbox_scope("", None, "mbox-2") == "mbox-2"

    url = codec.build_inline_attachment_src(message_id="msg/1", attachment_ref="att+1")

    assert url == "/api/v1/mail/messages/msg%2F1/attachments/att%2B1?disposition=inline"


def test_reference_codec_extracts_attachment_ids_and_content_ids():
    attachment_id = SimpleNamespace(id="att-direct")
    attachment = SimpleNamespace(attachment_id=attachment_id, item_id=None)

    assert codec.extract_attachment_raw_id(attachment) == "att-direct"
    assert codec.extract_attachment_id_from_repr("AttachmentId(id='repr-id', root_id='root')") == "repr-id"
    assert codec.normalize_attachment_content_id("cid:<LOGO@EXAMPLE>") == "logo@example"


def test_mail_service_reference_wrappers_keep_mail_service_errors():
    with pytest.raises(mail_module.MailServiceError, match="Invalid message id"):
        mail_module.MailService._decode_message_ref("not-base64")

    raw_id = "abc+def/ghi-jkl_mno~p"
    token = mail_module.MailService._encode_attachment_token(raw_id)

    assert mail_module.MailService._decode_attachment_token(token) == raw_id
