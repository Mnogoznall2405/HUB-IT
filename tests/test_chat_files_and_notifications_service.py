from __future__ import annotations

import importlib
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

chat_db_module = importlib.import_module("backend.chat.db")
chat_models_module = importlib.import_module("backend.chat.models")
chat_push_outbox_service_module = importlib.import_module("backend.chat.push_outbox_service")
chat_service_module = importlib.import_module("backend.chat.service")
hub_service_module = importlib.import_module("backend.services.hub_service")
chat_push_service_module = importlib.import_module("backend.chat.push_service")


def _raw_user(user_id: int, username: str, full_name: str, role: str, *, active: bool = True) -> dict:
    return {
        "id": user_id,
        "username": username,
        "full_name": full_name,
        "role": role,
        "is_active": active,
        "use_custom_permissions": False,
        "custom_permissions": [],
        "permissions": [],
    }


def _upload(name: str, payload: bytes, content_type: str) -> SimpleNamespace:
    return SimpleNamespace(
        filename=name,
        content_type=content_type,
        file=io.BytesIO(payload),
    )


def _png_1x1() -> bytes:
    return (
        b"\x89PNG\r\n\x1a\n"
        b"\x00\x00\x00\rIHDR"
        b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
        b"\x1f\x15\xc4\x89"
        b"\x00\x00\x00\rIDATx\x9cc`\x00\x00\x00\x02\x00\x01"
        b"\xe2!\xbc3"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )


@pytest.fixture
def chat_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
        3: _raw_user(3, "controller", "Task Controller", "admin"),
    }
    users = list(raw_users.values())
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub.sqlite3"),
        data_dir=str(Path(temp_dir) / "hub-data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "list_users", lambda: list(users))
    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))
    monkeypatch.setattr(chat_service_module.user_service, "to_public_user", lambda raw: dict(raw))

    hub_service = hub_service_module.HubService()
    monkeypatch.setattr(hub_service_module, "hub_service", hub_service)
    monkeypatch.setattr(chat_service_module, "hub_service", hub_service)

    chat_db_module._engine = None
    chat_db_module._session_factory = None
    monkeypatch.setattr(chat_db_module.config.chat, "enabled", True, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "database_url", f"sqlite:///{Path(temp_dir) / 'chat.sqlite3'}", raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "pool_size", 5, raising=False)
    monkeypatch.setattr(chat_db_module.config.chat, "max_overflow", 10, raising=False)

    service = chat_service_module.ChatService()
    direct = service.create_direct_conversation(current_user_id=1, peer_user_id=2)

    yield {
        "service": service,
        "hub_service": hub_service,
        "direct": direct,
        "attachments_root": Path(store.data_dir) / "chat_message_attachments",
    }

    chat_db_module._engine = None
    chat_db_module._session_factory = None


def test_send_files_persists_attachment_and_creates_chat_notification(chat_env):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]
    conversation = chat_env["direct"]
    caption = "РџРѕРґРїРёСЃСЊ Рє С„Р°Р№Р»Сѓ"

    created = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        body=caption,
        uploads=[_upload("report.pdf", b"%PDF-1.4 demo", "application/pdf")],
    )

    assert created["kind"] == "file"
    assert created["body"] == caption
    assert len(created["attachments"]) == 1
    attachment = created["attachments"][0]
    assert attachment["file_name"] == "report.pdf"

    messages = service.get_messages(current_user_id=2, conversation_id=conversation["id"], limit=20)
    assert messages["items"][0]["kind"] == "file"
    assert messages["items"][0]["body"] == caption
    assert messages["items"][0]["attachments"][0]["file_name"] == "report.pdf"

    conversations = service.list_conversations(current_user_id=2)["items"]
    assert conversations[0]["last_message_preview"] == caption

    service.send_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        body="РћС‚РІРµС‚ РЅР° С„Р°Р№Р»",
        reply_to_message_id=created["id"],
    )
    refreshed_messages = service.get_messages(current_user_id=1, conversation_id=conversation["id"], limit=20)
    reply_message = next(
        item for item in refreshed_messages["items"]
        if item.get("reply_preview") and item.get("body") == "РћС‚РІРµС‚ РЅР° С„Р°Р№Р»"
    )
    assert reply_message["reply_preview"]["body"] == caption

    download = service.get_attachment_for_download(
        current_user_id=2,
        message_id=messages["items"][0]["id"],
        attachment_id=attachment["id"],
    )
    assert Path(download["path"]).exists()
    assert Path(download["path"]).read_bytes() == b"%PDF-1.4 demo"

    polled = hub_service.poll_notifications(user_id=2, limit=50)
    chat_items = [item for item in polled["items"] if item.get("entity_type") == "chat"]
    assert any(
        item.get("event_type") == "chat.file_shared"
        and caption in str(item.get("body") or "")
        for item in chat_items
    )


def test_send_voice_file_preserves_audio_metadata(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"webm voice payload"

    created = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        uploads=[_upload("voice_1.webm", payload, "audio/webm;codecs=opus")],
        files_meta=[{
            "media_kind": "audio",
            "duration_seconds": 9,
            "original_size": len(payload),
            "transfer_encoding": "identity",
        }],
    )

    attachment = created["attachments"][0]
    assert attachment["kind"] == "audio"
    assert attachment["media_kind"] == "audio"
    assert attachment["duration_seconds"] == 9
    assert attachment["mime_type"] == "audio/webm"
    assert attachment["original_url"] == (
        f"/api/v1/chat/messages/{created['id']}/attachments/{attachment['id']}/file?inline=1"
    )
    assert attachment["download_url"] == (
        f"/api/v1/chat/messages/{created['id']}/attachments/{attachment['id']}/file"
    )

    messages = service.get_messages(current_user_id=2, conversation_id=conversation["id"], limit=20)
    persisted_attachment = messages["items"][0]["attachments"][0]
    assert persisted_attachment["kind"] == "audio"
    assert persisted_attachment["media_kind"] == "audio"
    assert persisted_attachment["duration_seconds"] == 9
    assert persisted_attachment["mime_type"] == "audio/webm"

    download = service.get_attachment_for_download(
        current_user_id=2,
        message_id=created["id"],
        attachment_id=attachment["id"],
    )
    assert Path(download["path"]).read_bytes() == payload
    assert download["mime_type"] == "audio/webm"

    summary = service.get_conversation_assets_summary(
        current_user_id=2,
        conversation_id=conversation["id"],
    )
    assert summary["audio_count"] == 1
    assert summary["files_count"] == 0
    assert summary["recent_audio"][0]["kind"] == "audio"


def test_send_files_without_caption_keeps_file_name_preview(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        uploads=[_upload("report.pdf", b"%PDF-1.4 demo", "application/pdf")],
    )

    assert created["body"] == ""

    conversations = service.list_conversations(current_user_id=2)["items"]
    assert conversations[0]["last_message_preview"].endswith("report.pdf")


def test_mark_read_clears_chat_notifications_and_updates_unread_summary(chat_env):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="РџСЂРѕРІРµСЂСЊ, РїРѕР¶Р°Р»СѓР№СЃС‚Р°, С„Р°Р№Р»",
    )

    summary_before = service.get_unread_summary(current_user_id=2)
    assert summary_before["messages_unread_total"] == 1
    assert summary_before["conversations_unread"] == 1

    polled_before = hub_service.poll_notifications(user_id=2, limit=50)
    chat_items_before = [item for item in polled_before["items"] if item.get("entity_type") == "chat"]
    assert any(int(item.get("unread") or 0) == 1 for item in chat_items_before)

    service.mark_read(
        current_user_id=2,
        conversation_id=conversation["id"],
        message_id=created["id"],
    )

    summary_after = service.get_unread_summary(current_user_id=2)
    assert summary_after["messages_unread_total"] == 0
    assert summary_after["conversations_unread"] == 0

    polled_after = hub_service.poll_notifications(user_id=2, limit=50)
    chat_items_after = [item for item in polled_after["items"] if item.get("entity_type") == "chat"]
    assert chat_items_after
    assert all(int(item.get("unread") or 0) == 0 for item in chat_items_after)


def test_send_files_validates_limits(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    with pytest.raises(ValueError):
        service.send_files(
            current_user_id=1,
            conversation_id=conversation["id"],
            uploads=[_upload(f"doc-{index}.txt", b"x", "text/plain") for index in range(6)],
        )

    with pytest.raises(ValueError):
        service.send_files(
            current_user_id=1,
            conversation_id=conversation["id"],
            uploads=[_upload("malware.exe", b"boom", "application/octet-stream")],
        )


def test_create_upload_session_validates_limits(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    with pytest.raises(ValueError):
        service.create_upload_session(
            current_user_id=1,
            conversation_id=conversation["id"],
            files=[
                {"file_name": f"doc-{index}.txt", "mime_type": "text/plain", "size": 1}
                for index in range(6)
            ],
        )

    with pytest.raises(ValueError):
        max_total_size = chat_service_module.CHAT_MAX_TOTAL_FILE_BYTES
        service.create_upload_session(
            current_user_id=1,
            conversation_id=conversation["id"],
            files=[
                {"file_name": "a.pdf", "mime_type": "application/pdf", "size": max_total_size},
                {"file_name": "b.pdf", "mime_type": "application/pdf", "size": 1},
            ],
        )


def test_upload_session_complete_requires_all_chunks(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="caption",
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": 12}],
    )

    with pytest.raises(ValueError):
        service.complete_upload_session(
            current_user_id=1,
            session_id=created["session_id"],
        )


def test_upload_session_complete_rejects_corrupt_received_chunk_range(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"%PDF-1.4 demo"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": len(payload)}],
    )
    session_id = created["session_id"]
    file_id = created["files"][0]["file_id"]
    part_path = service._upload_session_part_path(session_id, file_id)
    part_path.write_bytes(payload)

    manifest = service._load_upload_session_manifest(session_id)
    manifest["files"][0]["received_bytes"] = len(payload)
    manifest["files"][0]["received_chunks"] = [1]
    service._write_upload_session_manifest(manifest)

    with pytest.raises(ValueError):
        service.complete_upload_session(
            current_user_id=1,
            session_id=session_id,
        )


def test_upload_session_chunk_rejects_unexpected_offset(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"%PDF-1.4 demo"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": len(payload)}],
    )

    with pytest.raises(ValueError):
        service.upload_session_chunk(
            current_user_id=1,
            session_id=created["session_id"],
            file_id=created["files"][0]["file_id"],
            chunk_index=0,
            offset=3,
            payload=payload,
        )


def test_upload_session_duplicate_chunk_rejects_wrong_offset(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"%PDF-1.4 demo"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": len(payload)}],
    )
    service.upload_session_chunk(
        current_user_id=1,
        session_id=created["session_id"],
        file_id=created["files"][0]["file_id"],
        chunk_index=0,
        offset=0,
        payload=payload,
    )

    with pytest.raises(ValueError):
        service.upload_session_chunk(
            current_user_id=1,
            session_id=created["session_id"],
            file_id=created["files"][0]["file_id"],
            chunk_index=0,
            offset=3,
            payload=payload,
        )


def test_upload_session_duplicate_chunk_is_idempotent_and_complete_returns_same_message(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"%PDF-1.4 demo"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="caption",
        reply_to_message_id=None,
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": len(payload)}],
    )
    session_id = created["session_id"]
    file_id = created["files"][0]["file_id"]

    first_chunk = service.upload_session_chunk(
        current_user_id=1,
        session_id=session_id,
        file_id=file_id,
        chunk_index=0,
        offset=0,
        payload=payload,
    )
    second_chunk = service.upload_session_chunk(
        current_user_id=1,
        session_id=session_id,
        file_id=file_id,
        chunk_index=0,
        offset=0,
        payload=payload,
    )
    part_path = service._upload_session_part_path(session_id, file_id)

    assert first_chunk["already_present"] is False
    assert second_chunk["already_present"] is True
    assert part_path.exists()
    assert part_path.stat().st_size == len(payload)

    completed = service.complete_upload_session(
        current_user_id=1,
        session_id=session_id,
    )
    completed_again = service.complete_upload_session(
        current_user_id=1,
        session_id=session_id,
    )

    assert completed["id"] == completed_again["id"]
    assert completed["kind"] == "file"
    assert completed["body"] == "caption"
    assert [item["file_name"] for item in completed["attachments"]] == ["report.pdf"]

    download = service.get_attachment_for_download(
        current_user_id=2,
        message_id=completed["id"],
        attachment_id=completed["attachments"][0]["id"],
    )
    assert Path(download["path"]).read_bytes() == payload


def test_upload_session_voice_file_preserves_audio_metadata(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    payload = b"webm voice payload"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        files=[{
            "file_name": "voice_1.webm",
            "mime_type": "application/octet-stream",
            "media_kind": "audio",
            "duration_seconds": 11,
            "size": len(payload),
        }],
    )
    session_file = created["files"][0]
    assert session_file["mime_type"] == "audio/webm"
    assert session_file["media_kind"] == "audio"
    assert session_file["duration_seconds"] == 11

    service.upload_session_chunk(
        current_user_id=1,
        session_id=created["session_id"],
        file_id=session_file["file_id"],
        chunk_index=0,
        offset=0,
        payload=payload,
    )

    completed = service.complete_upload_session(
        current_user_id=1,
        session_id=created["session_id"],
    )

    attachment = completed["attachments"][0]
    assert attachment["kind"] == "audio"
    assert attachment["media_kind"] == "audio"
    assert attachment["duration_seconds"] == 11
    assert attachment["mime_type"] == "audio/webm"
    assert attachment["original_url"].endswith("?inline=1")

    download = service.get_attachment_for_download(
        current_user_id=2,
        message_id=completed["id"],
        attachment_id=attachment["id"],
    )
    assert Path(download["path"]).read_bytes() == payload
    assert download["mime_type"] == "audio/webm"


def test_upload_session_supports_mixed_photo_and_document(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    photo_payload = _png_1x1()
    pdf_payload = b"%PDF-1.4 demo"

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="mixed",
        files=[
            {"file_name": "photo.png", "mime_type": "image/png", "size": len(photo_payload)},
            {"file_name": "report.pdf", "mime_type": "application/pdf", "size": len(pdf_payload)},
        ],
    )

    first_file_id = created["files"][0]["file_id"]
    second_file_id = created["files"][1]["file_id"]
    service.upload_session_chunk(
        current_user_id=1,
        session_id=created["session_id"],
        file_id=first_file_id,
        chunk_index=0,
        offset=0,
        payload=photo_payload,
    )
    service.upload_session_chunk(
        current_user_id=1,
        session_id=created["session_id"],
        file_id=second_file_id,
        chunk_index=0,
        offset=0,
        payload=pdf_payload,
    )

    completed = service.complete_upload_session(
        current_user_id=1,
        session_id=created["session_id"],
    )

    assert completed["kind"] == "file"
    assert len(completed["attachments"]) == 2
    image_attachment = next(item for item in completed["attachments"] if item["file_name"] == "photo.png")
    assert image_attachment["width"] == 1
    assert image_attachment["height"] == 1


def test_cleanup_expired_upload_sessions_deletes_pending_session_dir(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.create_upload_session(
        current_user_id=1,
        conversation_id=conversation["id"],
        files=[{"file_name": "report.pdf", "mime_type": "application/pdf", "size": 12}],
    )
    session_id = created["session_id"]
    manifest_path = service._upload_session_manifest_path(session_id)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["expires_at"] = "2000-01-01T00:00:00+00:00"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    cleanup_result = service.cleanup_expired_upload_sessions(force=True)

    assert cleanup_result["deleted"] == 1
    assert not service._upload_session_dir(session_id).exists()


def test_chat_push_subscription_receives_message_push_payload(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    sent_payloads = []

    monkeypatch.setattr(chat_push_service_module.config.web_push, "public_key", "public-demo", raising=False)
    monkeypatch.setattr(chat_push_service_module.config.web_push, "private_key", "private-demo", raising=False)
    monkeypatch.setattr(chat_push_service_module.config.web_push, "subject", "mailto:test@example.com", raising=False)

    def fake_webpush(**kwargs):
        sent_payloads.append(kwargs)
        return None

    monkeypatch.setattr(chat_push_service_module, "webpush", fake_webpush)

    config_payload = service.get_push_config()
    assert config_payload["enabled"] is True
    assert config_payload["vapid_public_key"] == "public-demo"

    upserted = service.upsert_push_subscription(
        current_user_id=2,
        endpoint="https://push.example/subscription-1",
        p256dh_key="p256dh-key",
        auth_key="auth-key",
        browser_family="chrome",
        install_mode="standalone",
    )
    assert upserted["subscribed"] is True

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Р СњР С•Р Р†Р С•Р Вµ push-РЎРѓР С•Р С•Р В±РЎвЂ°Р ВµР Р…Р С‘Р Вµ",
    )

    assert len(sent_payloads) == 1
    push_call = sent_payloads[0]
    assert push_call["subscription_info"]["endpoint"] == "https://push.example/subscription-1"
    assert push_call["vapid_private_key"] == "private-demo"
    assert push_call["vapid_claims"] == {"sub": "mailto:test@example.com"}

    payload = json.loads(push_call["data"])
    assert payload["data"]["conversation_id"] == conversation["id"]
    assert payload["data"]["message_id"] == created["id"]
    assert payload["data"]["route"] == f"/chat?conversation={conversation['id']}&message={created['id']}"

    removed = service.delete_push_subscription(
        current_user_id=2,
        endpoint="https://push.example/subscription-1",
    )
    assert removed["removed"] is True


def test_send_message_defer_push_notifications_enqueues_outbox_jobs(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    sent_payloads = []

    monkeypatch.setattr(chat_push_service_module.config.web_push, "public_key", "public-demo", raising=False)
    monkeypatch.setattr(chat_push_service_module.config.web_push, "private_key", "private-demo", raising=False)
    monkeypatch.setattr(chat_push_service_module.config.web_push, "subject", "mailto:test@example.com", raising=False)

    def fake_webpush(**kwargs):
        sent_payloads.append(kwargs)
        return None

    monkeypatch.setattr(chat_push_service_module, "webpush", fake_webpush)

    service.upsert_push_subscription(
        current_user_id=2,
        endpoint="https://push.example/subscription-1",
        p256dh_key="p256dh-key",
        auth_key="auth-key",
        browser_family="chrome",
        install_mode="standalone",
    )

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Отложенный push",
        defer_push_notifications=True,
    )

    assert created["conversation_id"] == conversation["id"]
    assert sent_payloads == []
    with chat_db_module.chat_session() as session:
        jobs = list(
            session.execute(
                select(chat_models_module.ChatPushOutbox).where(
                    chat_models_module.ChatPushOutbox.message_id == created["id"],
                )
            ).scalars()
        )
    assert len(jobs) == 1
    assert jobs[0].recipient_user_id == 2
    assert jobs[0].conversation_id == conversation["id"]
    assert jobs[0].status == "queued"


def test_send_message_notifications_use_targeted_sender_lookup(chat_env, monkeypatch):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]
    conversation = chat_env["direct"]
    users_by_id = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
    }

    def _global_user_scan_not_expected():
        raise AssertionError("global user scan is not expected for chat notifications")

    def _global_session_scan_not_expected(*, active_only=False):
        raise AssertionError("global session scan is not expected for chat notifications")

    monkeypatch.setattr(chat_service_module.user_service, "list_users", _global_user_scan_not_expected)
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {
            int(user_id): dict(users_by_id[int(user_id)])
            for user_id in list(user_ids or [])
            if int(user_id) in users_by_id
        },
    )
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions", _global_session_scan_not_expected)
    monkeypatch.setattr(chat_service_module.session_service, "list_sessions_by_user_ids", lambda user_ids, active_only=False: [])

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Targeted sender lookup",
        defer_push_notifications=True,
    )

    polled = hub_service.poll_notifications(user_id=2, limit=20)
    chat_items = [item for item in polled["items"] if item.get("entity_type") == "chat"]

    assert created["conversation_id"] == conversation["id"]
    assert any(
        item.get("entity_id") == conversation["id"]
        and item.get("title") == "Task Author"
        and item.get("body") == "Targeted sender lookup"
        for item in chat_items
    )


def test_send_message_mention_notifies_muted_group_member(chat_env, monkeypatch):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]
    users_by_id = {
        1: _raw_user(1, "author", "Task Author", "operator"),
        2: _raw_user(2, "assignee", "Task Assignee", "operator"),
        3: _raw_user(3, "controller", "Task Controller", "admin"),
    }

    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {
            int(user_id): dict(users_by_id[int(user_id)])
            for user_id in list(user_ids or [])
            if int(user_id) in users_by_id
        },
    )

    conversation = service.create_group_conversation(
        current_user_id=1,
        title="Ops",
        member_user_ids=[2, 3],
    )
    service.update_conversation_settings(
        current_user_id=2,
        conversation_id=conversation["id"],
        is_muted=True,
    )

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="@assignee проверь, пожалуйста",
        defer_push_notifications=True,
    )

    polled = hub_service.poll_notifications(user_id=2, limit=20)
    mention_items = [
        item for item in polled["items"]
        if item.get("entity_type") == "chat" and item.get("entity_id") == conversation["id"]
    ]

    assert created["conversation_id"] == conversation["id"]
    assert any(
        item.get("event_type") == "chat.mention"
        and "Ops" in item.get("title", "")
        and "@assignee" in item.get("body", "")
        for item in mention_items
    )

    with chat_db_module.chat_session() as session:
        jobs = list(
            session.execute(
                select(chat_models_module.ChatPushOutbox).where(
                    chat_models_module.ChatPushOutbox.message_id == created["id"],
                    chat_models_module.ChatPushOutbox.recipient_user_id == 2,
                )
            ).scalars()
        )

    assert len(jobs) == 1
    assert jobs[0].status == "queued"
    assert "Ops" in jobs[0].title


def test_send_message_ack_uses_targeted_message_presence_lookup(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = chat_env["direct"]
    captured_user_id_sets: list[list[int]] = []
    original_get_presence_map = service._get_presence_map

    def _capture_presence_map(*, user_ids=None):
        captured_user_id_sets.append(
            sorted({
                int(item)
                for item in list(user_ids or [])
                if int(item) > 0
            })
        )
        return original_get_presence_map(user_ids=user_ids)

    monkeypatch.setattr(service, "_get_presence_map", _capture_presence_map)

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Ack presence lookup",
        defer_push_notifications=True,
    )

    assert created["conversation_id"] == conversation["id"]
    assert captured_user_id_sets == [[1]]


def test_get_messages_for_users_reuses_sender_and_recipient_views(chat_env, monkeypatch):
    service = chat_env["service"]
    conversation = service.create_group_conversation(
        current_user_id=1,
        title="Ops",
        member_user_ids=[2, 3],
    )
    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Group payload fan-out",
        defer_push_notifications=True,
    )
    serialize_calls: list[int] = []
    captured_presence_user_ids: list[list[int]] = []
    original_serialize_message = service._serialize_message
    original_get_presence_map = service._get_presence_map

    def _capture_serialize_message(*args, **kwargs):
        serialize_calls.append(int(kwargs.get("current_user_id", 0) or 0))
        return original_serialize_message(*args, **kwargs)

    def _capture_presence_map(*, user_ids=None):
        captured_presence_user_ids.append(
            sorted({
                int(item)
                for item in list(user_ids or [])
                if int(item) > 0
            })
        )
        return original_get_presence_map(user_ids=user_ids)

    monkeypatch.setattr(service, "_serialize_message", _capture_serialize_message)
    monkeypatch.setattr(service, "_get_presence_map", _capture_presence_map)

    messages_by_user = service.get_messages_for_users(
        message_id=created["id"],
        user_ids=[1, 2, 3],
    )

    assert sorted(messages_by_user.keys()) == [1, 2, 3]
    assert messages_by_user[1]["is_own"] is True
    assert messages_by_user[2]["is_own"] is False
    assert messages_by_user[3]["is_own"] is False
    assert serialize_calls == [1, 2]
    assert captured_presence_user_ids == [[1]]


def test_send_message_client_message_id_is_idempotent_for_same_sender(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    created = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Повторная доставка",
        client_message_id="client-msg-1",
        defer_push_notifications=True,
    )
    repeated = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Повторная доставка",
        client_message_id="client-msg-1",
        defer_push_notifications=True,
    )

    assert repeated["id"] == created["id"]
    assert repeated["client_message_id"] == "client-msg-1"

    with chat_db_module.chat_session() as session:
        message_count = session.execute(
            select(func.count()).select_from(chat_models_module.ChatMessage).where(
                chat_models_module.ChatMessage.conversation_id == conversation["id"],
            )
        ).scalar_one()
        outbox_count = session.execute(
            select(func.count()).select_from(chat_models_module.ChatPushOutbox).where(
                chat_models_module.ChatPushOutbox.message_id == created["id"],
            )
        ).scalar_one()

    assert int(message_count) == 1
    assert int(outbox_count) == 1


def test_send_message_persistence_advances_sequence_and_read_counters(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    first = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="First persisted message",
        defer_push_notifications=True,
    )
    second = service.send_message(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Second persisted message",
        defer_push_notifications=True,
    )

    with chat_db_module.chat_session() as session:
        conversation_row = session.get(chat_models_module.ChatConversation, conversation["id"])
        messages = list(
            session.execute(
                select(chat_models_module.ChatMessage)
                .where(chat_models_module.ChatMessage.conversation_id == conversation["id"])
                .order_by(chat_models_module.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        sender_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 1,
            )
        ).scalar_one()
        recipient_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 2,
            )
        ).scalar_one()

    assert [item.id for item in messages] == [first["id"], second["id"]]
    assert [int(item.conversation_seq) for item in messages] == [1, 2]
    assert conversation_row.last_message_id == second["id"]
    assert int(conversation_row.last_message_seq) == 2
    assert sender_state.last_read_message_id == second["id"]
    assert int(sender_state.last_read_seq) == 2
    assert int(sender_state.unread_count) == 0
    assert int(recipient_state.unread_count) == 2


def test_send_files_persistence_advances_sequence_and_read_counters(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    first = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="First file",
        uploads=[_upload("first.pdf", b"%PDF-1.4 first", "application/pdf")],
        defer_push_notifications=True,
    )
    second = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Second file",
        uploads=[_upload("second.pdf", b"%PDF-1.4 second", "application/pdf")],
        defer_push_notifications=True,
    )

    with chat_db_module.chat_session() as session:
        conversation_row = session.get(chat_models_module.ChatConversation, conversation["id"])
        messages = list(
            session.execute(
                select(chat_models_module.ChatMessage)
                .where(chat_models_module.ChatMessage.conversation_id == conversation["id"])
                .order_by(chat_models_module.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        attachment_count = session.execute(
            select(func.count()).select_from(chat_models_module.ChatMessageAttachment).where(
                chat_models_module.ChatMessageAttachment.conversation_id == conversation["id"],
            )
        ).scalar_one()
        sender_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 1,
            )
        ).scalar_one()
        recipient_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 2,
            )
        ).scalar_one()

    assert [item.id for item in messages] == [first["id"], second["id"]]
    assert [item.kind for item in messages] == ["file", "file"]
    assert [int(item.conversation_seq) for item in messages] == [1, 2]
    assert int(attachment_count) == 2
    assert conversation_row.last_message_id == second["id"]
    assert int(conversation_row.last_message_seq) == 2
    assert sender_state.last_read_message_id == second["id"]
    assert int(sender_state.last_read_seq) == 2
    assert int(sender_state.unread_count) == 0
    assert int(recipient_state.unread_count) == 2


def test_forward_file_persistence_copies_attachment_and_advances_read_counters(chat_env):
    service = chat_env["service"]
    conversation = chat_env["direct"]

    original = service.send_files(
        current_user_id=1,
        conversation_id=conversation["id"],
        body="Forward me",
        uploads=[_upload("forward.pdf", b"%PDF-1.4 forward", "application/pdf")],
        defer_push_notifications=True,
    )
    forwarded = service.forward_message(
        current_user_id=2,
        conversation_id=conversation["id"],
        source_message_id=original["id"],
        defer_push_notifications=True,
    )

    with chat_db_module.chat_session() as session:
        conversation_row = session.get(chat_models_module.ChatConversation, conversation["id"])
        messages = list(
            session.execute(
                select(chat_models_module.ChatMessage)
                .where(chat_models_module.ChatMessage.conversation_id == conversation["id"])
                .order_by(chat_models_module.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        attachment_count = session.execute(
            select(func.count()).select_from(chat_models_module.ChatMessageAttachment).where(
                chat_models_module.ChatMessageAttachment.conversation_id == conversation["id"],
            )
        ).scalar_one()
        forwarding_user_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 2,
            )
        ).scalar_one()
        recipient_state = session.execute(
            select(chat_models_module.ChatConversationUserState).where(
                chat_models_module.ChatConversationUserState.conversation_id == conversation["id"],
                chat_models_module.ChatConversationUserState.user_id == 1,
            )
        ).scalar_one()

    assert forwarded["kind"] == "file"
    assert forwarded["forward_preview"]["id"] == original["id"]
    assert [item["file_name"] for item in forwarded["attachments"]] == ["forward.pdf"]
    assert [item.id for item in messages] == [original["id"], forwarded["id"]]
    assert [int(item.conversation_seq) for item in messages] == [1, 2]
    assert messages[1].forward_from_message_id == original["id"]
    assert int(attachment_count) == 2
    assert conversation_row.last_message_id == forwarded["id"]
    assert int(conversation_row.last_message_seq) == 2
    assert forwarding_user_state.last_read_message_id == forwarded["id"]
    assert int(forwarding_user_state.last_read_seq) == 2
    assert int(forwarding_user_state.unread_count) == 0
    assert int(recipient_state.unread_count) == 1

    download = service.get_attachment_for_download(
        current_user_id=1,
        message_id=forwarded["id"],
        attachment_id=forwarded["attachments"][0]["id"],
    )
    assert Path(download["path"]).read_bytes() == b"%PDF-1.4 forward"


def test_system_message_persistence_advances_sequence_and_read_counters(chat_env):
    service = chat_env["service"]
    group = service.create_group_conversation(
        current_user_id=1,
        title="System persistence",
        member_user_ids=[2],
    )

    service.add_group_members(
        current_user_id=1,
        conversation_id=group["id"],
        member_user_ids=[3],
    )

    with chat_db_module.chat_session() as session:
        conversation_row = session.get(chat_models_module.ChatConversation, group["id"])
        messages = list(
            session.execute(
                select(chat_models_module.ChatMessage)
                .where(chat_models_module.ChatMessage.conversation_id == group["id"])
                .order_by(chat_models_module.ChatMessage.conversation_seq.asc())
            ).scalars()
        )
        states = {
            int(item.user_id): item
            for item in session.execute(
                select(chat_models_module.ChatConversationUserState).where(
                    chat_models_module.ChatConversationUserState.conversation_id == group["id"],
                )
            ).scalars()
        }

    assert len(messages) == 1
    system_message = messages[0]
    assert system_message.kind == "system"
    assert int(system_message.conversation_seq) == 1
    assert "добавил" in system_message.body
    assert conversation_row.last_message_id == system_message.id
    assert int(conversation_row.last_message_seq) == 1
    assert states[1].last_read_message_id == system_message.id
    assert int(states[1].last_read_seq) == 1
    assert int(states[1].unread_count) == 0
    assert int(states[2].unread_count) == 1
    assert int(states[3].unread_count) == 0


def test_group_avatar_file_path_requires_group_membership(chat_env):
    service = chat_env["service"]
    hub_service = chat_env["hub_service"]

    group = service.create_group_conversation(
        current_user_id=1,
        title="Avatar Group",
        member_user_ids=[2],
    )
    conversation_id = group["id"]
    safe_id = "".join(c if c.isalnum() or c in "-_" else "_" for c in conversation_id)
    avatars_dir = Path(hub_service.data_dir) / "group_avatars"
    avatars_dir.mkdir(parents=True, exist_ok=True)
    avatar_path = avatars_dir / f"{safe_id}.jpg"
    avatar_path.write_bytes(b"fake-jpeg-content")
    avatar_url = f"/api/v1/chat/group-avatars/{safe_id}.jpg?v=1"

    service.update_group_avatar(
        current_user_id=1,
        conversation_id=conversation_id,
        avatar_url=avatar_url,
    )

    resolved = service.get_group_avatar_file_path(
        current_user_id=2,
        filename=f"{safe_id}.jpg",
    )
    assert resolved == str(avatar_path)

    with pytest.raises(PermissionError):
        service.get_group_avatar_file_path(
            current_user_id=3,
            filename=f"{safe_id}.jpg",
        )
