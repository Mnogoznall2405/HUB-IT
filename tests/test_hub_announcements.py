from __future__ import annotations

import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
import importlib

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.api import deps
from backend.api.v1 import hub
from backend.models.auth import User

hub_service_module = importlib.import_module("backend.services.hub_service")


DASHBOARD_READ = "dashboard.read"
ANNOUNCEMENTS_WRITE = "announcements.write"


def _raw_user(
    user_id: int,
    username: str,
    full_name: str,
    role: str,
    permissions: list[str],
) -> dict:
    return {
        "id": user_id,
        "username": username,
        "email": None,
        "full_name": full_name,
        "is_active": True,
        "role": role,
        "permissions": permissions,
        "use_custom_permissions": True,
        "custom_permissions": permissions,
        "auth_source": "local",
        "telegram_id": None,
        "assigned_database": None,
        "mailbox_email": None,
        "mailbox_login": None,
        "mail_profile_mode": "manual",
        "mail_signature_html": None,
        "mail_is_configured": False,
        "created_at": None,
        "updated_at": None,
        "mail_updated_at": None,
    }


def _public_user(raw: dict) -> User:
    permissions = list(raw.get("custom_permissions") or raw.get("permissions") or [])
    return User(
        id=int(raw["id"]),
        username=str(raw["username"]),
        email=None,
        full_name=str(raw["full_name"]),
        role=str(raw["role"]),
        is_active=True,
        permissions=permissions,
        use_custom_permissions=True,
        custom_permissions=permissions,
        auth_source="local",
        telegram_id=None,
        assigned_database=None,
        mailbox_email=None,
        mailbox_login=None,
        mail_profile_mode="manual",
        mail_signature_html=None,
        mail_is_configured=False,
        created_at=None,
        updated_at=None,
        mail_updated_at=None,
    )


@pytest.fixture
def announcement_env(temp_dir, monkeypatch):
    raw_users = {
        1: _raw_user(1, "author", "Announcement Author", "operator", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
        2: _raw_user(2, "operator_user", "Operator User", "operator", [DASHBOARD_READ]),
        3: _raw_user(3, "viewer_user", "Viewer User", "viewer", [DASHBOARD_READ]),
        4: _raw_user(4, "outsider", "Announcement Outsider", "operator", [DASHBOARD_READ]),
        5: _raw_user(5, "feed_admin", "Announcement Admin", "admin", [DASHBOARD_READ, ANNOUNCEMENTS_WRITE]),
    }
    users_by_id = dict(raw_users)
    store = SimpleNamespace(
        db_path=str(Path(temp_dir) / "hub_announcements.db"),
        data_dir=str(Path(temp_dir) / "data"),
    )
    Path(store.data_dir).mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(hub_service_module, "get_local_store", lambda: store)
    monkeypatch.setattr(hub_service_module, "is_app_database_configured", lambda: False)
    monkeypatch.setattr(hub_service_module.user_service, "list_users", lambda: list(users_by_id.values()))
    monkeypatch.setattr(hub_service_module.user_service, "get_by_id", lambda user_id: users_by_id.get(int(user_id)))

    service = hub_service_module.HubService()
    monkeypatch.setattr(hub, "hub_service", service)

    app = FastAPI()
    app.include_router(hub.router, prefix="/hub")

    current = {"user": _public_user(raw_users[1])}

    def _override_current_user() -> User:
        return current["user"]

    app.dependency_overrides[deps.get_current_active_user] = _override_current_user
    client = TestClient(app)

    def set_user(user_id: int) -> None:
        current["user"] = _public_user(raw_users[user_id])

    return {
        "client": client,
        "set_user": set_user,
        "raw_users": raw_users,
        "service": service,
    }


def _create_announcement(client: TestClient, **payload) -> dict:
    body = {
        "title": payload.pop("title", "Announcement Alpha"),
        "preview": payload.pop("preview", "Preview"),
        "body": payload.pop("body", "Body"),
        "priority": payload.pop("priority", "normal"),
        **payload,
    }
    response = client.post("/hub/announcements", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_targeted_announcements_visibility_and_author_seen_state(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    role_note = _create_announcement(
        client,
        title="Viewer Role Note",
        audience_scope="roles",
        audience_roles=["viewer"],
        requires_ack=True,
    )
    direct_note = _create_announcement(
        client,
        title="Operator Direct Note",
        audience_scope="users",
        audience_user_ids=[2],
    )

    assert role_note["is_unread"] is False
    assert role_note["is_ack_pending"] is False

    set_user(2)
    operator_list = client.get("/hub/announcements")
    assert operator_list.status_code == 200
    operator_ids = {item["id"] for item in operator_list.json()["items"]}
    assert direct_note["id"] in operator_ids
    assert role_note["id"] not in operator_ids
    assert client.get(f"/hub/announcements/{role_note['id']}").status_code == 403

    set_user(3)
    viewer_list = client.get("/hub/announcements")
    assert viewer_list.status_code == 200
    viewer_ids = {item["id"] for item in viewer_list.json()["items"]}
    assert role_note["id"] in viewer_ids
    assert direct_note["id"] not in viewer_ids
    viewer_detail = client.get(f"/hub/announcements/{role_note['id']}")
    assert viewer_detail.status_code == 200
    assert viewer_detail.json()["is_unread"] is True
    assert viewer_detail.json()["is_ack_pending"] is True

    set_user(4)
    outsider_list = client.get("/hub/announcements")
    assert outsider_list.status_code == 200
    outsider_ids = {item["id"] for item in outsider_list.json()["items"]}
    assert role_note["id"] not in outsider_ids
    assert direct_note["id"] not in outsider_ids


def test_announcement_read_ack_versioning_and_notifications(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    note = _create_announcement(
        client,
        title="Versioned Note",
        audience_scope="users",
        audience_user_ids=[2],
        requires_ack=True,
    )
    note_id = note["id"]

    set_user(2)
    poll_initial = client.get("/hub/notifications/poll")
    assert poll_initial.status_code == 200
    initial_events = [item for item in poll_initial.json()["items"] if item["entity_id"] == note_id]
    assert any(item["event_type"] == "announcement.new" and item["entity_type"] == "announcement" for item in initial_events)

    detail_before = client.get(f"/hub/announcements/{note_id}")
    assert detail_before.status_code == 200
    assert detail_before.json()["version"] == 1
    assert detail_before.json()["is_unread"] is True
    assert detail_before.json()["is_ack_pending"] is True

    mark_read = client.post(f"/hub/announcements/{note_id}/mark-as-read")
    assert mark_read.status_code == 200
    detail_after_read = client.get(f"/hub/announcements/{note_id}")
    assert detail_after_read.status_code == 200
    assert detail_after_read.json()["is_unread"] is False

    ack_response = client.post(f"/hub/announcements/{note_id}/ack")
    assert ack_response.status_code == 200
    assert ack_response.json()["acknowledged_version"] == 1
    assert ack_response.json()["is_ack_pending"] is False

    set_user(1)
    update_response = client.patch(
        f"/hub/announcements/{note_id}",
        json={"title": "Versioned Note Updated", "body": "Updated body", "notify_on_update": True},
    )
    assert update_response.status_code == 200
    assert update_response.json()["version"] == 2

    author_poll = client.get("/hub/notifications/poll")
    assert author_poll.status_code == 200
    assert not any(item["entity_id"] == note_id for item in author_poll.json()["items"])

    set_user(2)
    poll_after_update = client.get("/hub/notifications/poll")
    assert poll_after_update.status_code == 200
    updated_events = [item for item in poll_after_update.json()["items"] if item["entity_id"] == note_id]
    assert any(item["event_type"] == "announcement.updated" for item in updated_events)

    detail_after_update = client.get(f"/hub/announcements/{note_id}")
    assert detail_after_update.status_code == 200
    payload = detail_after_update.json()
    assert payload["version"] == 2
    assert payload["is_unread"] is True
    assert payload["is_ack_pending"] is True


def test_archived_and_expired_announcements_are_hidden_from_feed(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]
    service = announcement_env["service"]

    set_user(1)
    archived = _create_announcement(client, title="Archive Me")
    expired = _create_announcement(
        client,
        title="Expired Note",
        expires_at=(datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
    )
    invalid_response = client.post(
        "/hub/announcements",
        json={"title": "Invalid expiry", "expires_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()},
    )
    assert invalid_response.status_code == 400
    with service._connect() as conn:
        conn.execute(
            f"UPDATE {service._ANN_TABLE} SET expires_at = ? WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(), expired["id"]),
        )
        conn.commit()

    archive_response = client.patch(f"/hub/announcements/{archived['id']}", json={"is_active": False})
    assert archive_response.status_code == 200

    author_feed = client.get("/hub/announcements")
    assert author_feed.status_code == 200
    author_ids = {item["id"] for item in author_feed.json()["items"]}
    assert archived["id"] not in author_ids
    assert expired["id"] not in author_ids

    author_hidden_detail = client.get(f"/hub/announcements/{archived['id']}")
    assert author_hidden_detail.status_code == 200

    set_user(2)
    recipient_feed = client.get("/hub/announcements")
    assert recipient_feed.status_code == 200
    recipient_ids = {item["id"] for item in recipient_feed.json()["items"]}
    assert archived["id"] not in recipient_ids
    assert expired["id"] not in recipient_ids


def test_reads_recipients_endpoint_and_admin_only_delete(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    recipients_response = client.get("/hub/users/announcement-recipients")
    assert recipients_response.status_code == 200
    recipients_payload = recipients_response.json()
    assert len(recipients_payload["users"]) >= 5
    assert any(item["value"] == "viewer" for item in recipients_payload["roles"])

    note = _create_announcement(
        client,
        title="Receipts Note",
        audience_scope="users",
        audience_user_ids=[2, 3],
        requires_ack=True,
    )
    note_id = note["id"]

    set_user(2)
    assert client.post(f"/hub/announcements/{note_id}/mark-as-read").status_code == 200
    assert client.post(f"/hub/announcements/{note_id}/ack").status_code == 200

    set_user(1)
    reads_response = client.get(f"/hub/announcements/{note_id}/reads")
    assert reads_response.status_code == 200
    reads_payload = reads_response.json()
    assert reads_payload["summary"]["recipients_total"] == 2
    assert reads_payload["summary"]["seen_total"] == 1
    assert reads_payload["summary"]["ack_total"] == 1
    assert reads_payload["summary"]["pending_ack_total"] == 1
    items_by_user_id = {int(item["user_id"]): item for item in reads_payload["items"]}
    assert items_by_user_id[2]["is_seen"] is True
    assert items_by_user_id[2]["is_acknowledged"] is True
    assert items_by_user_id[2]["read_at"]
    assert items_by_user_id[2]["acknowledged_at"]
    assert items_by_user_id[3]["is_seen"] is False
    assert items_by_user_id[3]["is_acknowledged"] is False
    assert items_by_user_id[3]["read_at"] == ""
    assert items_by_user_id[3]["acknowledged_at"] == ""

    delete_as_author = client.delete(f"/hub/announcements/{note_id}")
    assert delete_as_author.status_code == 403

    set_user(5)
    delete_as_admin = client.delete(f"/hub/announcements/{note_id}")
    assert delete_as_admin.status_code == 200
    assert client.get(f"/hub/announcements/{note_id}").status_code == 404


def test_feed_likes_are_idempotent_and_included_in_list(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    post = _create_announcement(client, title="Feed Like Post", body="Full feed body")
    post_id = post["id"]

    set_user(2)
    first_like = client.put(f"/hub/announcements/{post_id}/like")
    second_like = client.put(f"/hub/announcements/{post_id}/like")
    assert first_like.status_code == 200
    assert second_like.status_code == 200
    assert second_like.json()["likes_count"] == 1
    assert second_like.json()["viewer_has_liked"] is True

    feed = client.get("/hub/announcements", params={"include_body": True})
    assert feed.status_code == 200
    item = next(row for row in feed.json()["items"] if row["id"] == post_id)
    assert item["body"] == "Full feed body"
    assert item["likes_count"] == 1
    assert item["viewer_has_liked"] is True
    assert item["comments_count"] == 0

    unlike = client.delete(f"/hub/announcements/{post_id}/like")
    assert unlike.status_code == 200
    assert unlike.json()["likes_count"] == 0
    assert unlike.json()["viewer_has_liked"] is False


def test_feed_comments_edit_moderation_and_author_notification(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    post = _create_announcement(client, title="Feed Comment Post")
    post_id = post["id"]

    set_user(2)
    created = client.post(f"/hub/announcements/{post_id}/comments", json={"body": "Первый комментарий"})
    assert created.status_code == 200
    comment_id = created.json()["id"]
    assert created.json()["can_edit"] is True
    assert created.json()["can_delete"] is True

    updated = client.patch(
        f"/hub/announcements/{post_id}/comments/{comment_id}",
        json={"body": "Комментарий обновлён"},
    )
    assert updated.status_code == 200
    assert updated.json()["body"] == "Комментарий обновлён"

    set_user(3)
    forbidden_edit = client.patch(
        f"/hub/announcements/{post_id}/comments/{comment_id}",
        json={"body": "Чужая правка"},
    )
    assert forbidden_edit.status_code == 403

    comments = client.get(f"/hub/announcements/{post_id}/comments")
    assert comments.status_code == 200
    assert comments.json()["total"] == 1
    assert comments.json()["items"][0]["can_edit"] is False

    set_user(1)
    author_notifications = client.get("/hub/notifications/poll")
    assert author_notifications.status_code == 200
    assert any(
        item["event_type"] == "announcement.comment_added" and item["entity_id"].startswith(f"{post_id}#")
        for item in author_notifications.json()["items"]
    )
    author_comments = client.get(f"/hub/announcements/{post_id}/comments")
    assert author_comments.json()["items"][0]["can_delete"] is True
    deleted = client.delete(f"/hub/announcements/{post_id}/comments/{comment_id}")
    assert deleted.status_code == 200
    detail = client.get(f"/hub/announcements/{post_id}")
    assert detail.status_code == 200
    assert detail.json()["comments_count"] == 0


def test_feed_uses_first_image_attachment_as_cover(announcement_env):
    client = announcement_env["client"]
    response = client.post(
        "/hub/announcements",
        data={
            "title": "Post with cover",
            "preview": "Preview",
            "body": "Body",
            "priority": "normal",
            "audience_scope": "all",
        },
        files=[("files", ("cover.png", b"not-a-real-png", "image/png"))],
    )
    assert response.status_code == 200, response.text
    post_id = response.json()["id"]

    feed = client.get("/hub/announcements")
    assert feed.status_code == 200
    item = next(row for row in feed.json()["items"] if row["id"] == post_id)
    assert item["cover_attachment"]["file_name"] == "cover.png"
    assert item["cover_attachment"]["file_mime"] == "image/png"

    feed_with_body = client.get("/hub/announcements", params={"include_body": True})
    assert feed_with_body.status_code == 200
    item_with_body = next(row for row in feed_with_body.json()["items"] if row["id"] == post_id)
    assert [attachment["file_name"] for attachment in item_with_body["attachments"]] == ["cover.png"]


def test_announcement_fanout_does_not_wait_for_each_push_delivery(announcement_env, monkeypatch):
    service = announcement_env["service"]
    actor = announcement_env["raw_users"][1]
    recipients = [actor] + [
        _raw_user(
            user_id,
            f"viewer_{user_id}",
            f"Viewer {user_id}",
            "viewer",
            [DASHBOARD_READ],
        )
        for user_id in range(2, 851)
    ]
    monkeypatch.setattr(service, "_active_users", lambda: recipients)
    monkeypatch.setattr(
        hub_service_module.notification_preferences_service,
        "is_enabled",
        lambda **_kwargs: True,
    )
    monkeypatch.setattr(
        hub_service_module.notification_preferences_service,
        "enabled_user_ids",
        lambda *, user_ids, channel: set(user_ids),
    )
    push_calls: list[int] = []

    def slow_push(**payload):
        time.sleep(0.002)
        push_calls.append(int(payload["recipient_user_id"]))

    monkeypatch.setattr(hub_service_module.app_push_service, "send_notification", slow_push)

    started_at = time.perf_counter()
    created = service.create_announcement(
        payload={
            "title": "Fast broadcast",
            "body": "Broadcast body",
            "audience_scope": "all",
        },
        actor=actor,
    )
    elapsed = time.perf_counter() - started_at

    assert elapsed < 0.75
    with service._connect() as conn:
        row = conn.execute(
            f"SELECT COUNT(*) AS c FROM {service._NOTIF_TABLE} WHERE entity_type = ? AND entity_id = ?",
            ("announcement", created["id"]),
        ).fetchone()
    assert int(row["c"]) == 849

    deadline = time.monotonic() + 4.0
    while len(push_calls) < 849 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert len(push_calls) == 849


def test_draft_publishes_once_and_only_then_notifies(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    draft = client.post("/hub/announcements/drafts", json={})
    assert draft.status_code == 200, draft.text
    draft_id = draft.json()["id"]
    set_user(2)
    assert all(item["id"] != draft_id for item in client.get("/hub/announcements").json()["items"])
    assert not any(item["entity_id"].startswith(draft_id) for item in client.get("/hub/notifications/poll").json()["items"])

    set_user(1)
    updated = client.patch(f"/hub/announcements/{draft_id}", json={"title": "Готовая публикация", "body": "Полный текст"})
    assert updated.status_code == 200, updated.text
    published = client.post(f"/hub/announcements/{draft_id}/publish")
    assert published.status_code == 200, published.text
    assert published.json()["status"] == "published"
    assert client.post(f"/hub/announcements/{draft_id}/publish").status_code == 200

    set_user(2)
    events = [item for item in client.get("/hub/notifications/poll").json()["items"] if item["entity_id"] == draft_id]
    assert [item["event_type"] for item in events].count("announcement.new") == 1


def test_scheduled_publication_worker_is_idempotent(announcement_env):
    client = announcement_env["client"]
    service = announcement_env["service"]
    set_user = announcement_env["set_user"]
    future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    draft = client.post("/hub/announcements/drafts", json={"title": "Отложенная новость", "published_from": future})
    assert draft.status_code == 200
    post_id = draft.json()["id"]
    scheduled = client.post(f"/hub/announcements/{post_id}/publish")
    assert scheduled.status_code == 200
    assert scheduled.json()["status"] == "scheduled"

    set_user(2)
    assert not any(item["entity_id"] == post_id for item in client.get("/hub/notifications/poll").json()["items"])
    with service._lock, service._connect() as conn:
        conn.execute(
            f"UPDATE {service._ANN_TABLE} SET published_from = ?, publication_notified_at = NULL WHERE id = ?",
            ((datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat(), post_id),
        )
        conn.commit()
    assert service.publish_due_announcements() == 1
    assert service.publish_due_announcements() == 0
    events = [item for item in client.get("/hub/notifications/poll").json()["items"] if item["entity_id"] == post_id]
    assert [item["event_type"] for item in events].count("announcement.new") == 1


def test_replies_soft_delete_reactions_and_bookmarks(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]
    post_id = _create_announcement(client, title="Обсуждаемая новость")["id"]

    set_user(2)
    root = client.post(f"/hub/announcements/{post_id}/comments", json={"body": "Первый комментарий"})
    assert root.status_code == 200
    root_id = root.json()["id"]
    assert client.put(f"/hub/announcements/{post_id}/reaction", json={"reaction_type": "love"}).json()["viewer_reaction"] == "love"
    changed = client.put(f"/hub/announcements/{post_id}/reaction", json={"reaction_type": "angry"}).json()
    assert changed["viewer_reaction"] == "angry"
    assert changed["reaction_counts"].get("love", 0) == 0
    assert client.put(f"/hub/announcements/{post_id}/bookmark").status_code == 200
    saved = client.get("/hub/announcements", params={"bookmarked_only": True}).json()["items"]
    assert [item["id"] for item in saved] == [post_id]

    set_user(3)
    reply = client.post(
        f"/hub/announcements/{post_id}/comments",
        json={"body": "Ответ", "parent_comment_id": root_id, "mentioned_user_ids": [2]},
    )
    assert reply.status_code == 200, reply.text
    replies = client.get(f"/hub/announcements/{post_id}/comments", params={"root_comment_id": root_id, "sort": "oldest"}).json()
    assert replies["items"][0]["reply_to_user_id"] == 2

    set_user(1)
    assert client.delete(f"/hub/announcements/{post_id}/comments/{root_id}").status_code == 200
    roots = client.get(f"/hub/announcements/{post_id}/comments", params={"sort": "oldest"}).json()["items"]
    assert roots[0]["is_deleted"] is True
    assert roots[0]["body"] == "Комментарий удалён"
    replies_after_delete = client.get(f"/hub/announcements/{post_id}/comments", params={"root_comment_id": root_id}).json()["items"]
    assert len(replies_after_delete) == 1


def test_announcement_poll_vote_changes_choice_and_locks_options(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    announcement = _create_announcement(
        client,
        title="Choose a format",
        poll={
            "question": "Какой формат встречи удобнее?",
            "options": ["Онлайн", "В офисе"],
            "allows_multiple": False,
            "is_anonymous": True,
        },
    )
    options = announcement["poll"]["options"]
    assert [item["text"] for item in options] == ["Онлайн", "В офисе"]

    set_user(2)
    first_vote = client.put(
        f"/hub/announcements/{announcement['id']}/poll/vote",
        json={"option_ids": [options[0]["id"]]},
    )
    assert first_vote.status_code == 200
    assert first_vote.json()["poll"]["total_voters"] == 1
    assert first_vote.json()["poll"]["viewer_option_ids"] == [options[0]["id"]]

    changed_vote = client.put(
        f"/hub/announcements/{announcement['id']}/poll/vote",
        json={"option_ids": [options[1]["id"]]},
    )
    assert changed_vote.status_code == 200
    changed_poll = changed_vote.json()["poll"]
    assert changed_poll["total_voters"] == 1
    assert changed_poll["total_votes"] == 1
    assert changed_poll["viewer_option_ids"] == [options[1]["id"]]

    invalid_multiple = client.put(
        f"/hub/announcements/{announcement['id']}/poll/vote",
        json={"option_ids": [options[0]["id"], options[1]["id"]]},
    )
    assert invalid_multiple.status_code == 409

    set_user(1)
    changed_options = client.patch(
        f"/hub/announcements/{announcement['id']}",
        json={"poll": {"question": "Новый вопрос", "options": ["Да", "Нет"]}},
    )
    assert changed_options.status_code == 400


def test_incomplete_poll_is_allowed_in_draft_but_not_on_publish(announcement_env):
    client = announcement_env["client"]
    set_user = announcement_env["set_user"]

    set_user(1)
    draft_response = client.post(
        "/hub/announcements/drafts",
        json={
            "title": "",
            "poll": {"question": "Куда?", "options": ["Только один", ""]},
        },
    )
    assert draft_response.status_code == 200
    publish_response = client.post(f"/hub/announcements/{draft_response.json()['id']}/publish")
    assert publish_response.status_code == 400


def test_announcement_queries_use_a_stable_projection():
    """PostgreSQL cached plans must not depend on a mutable SELECT * shape."""
    service_class = hub_service_module.HubService
    source = Path(hub_service_module.__file__).read_text(encoding="utf-8")

    assert "SELECT * FROM {self._ANN_TABLE}" not in source
    assert set(service_class._ANN_SELECT_COLUMNS.split(", ")) == hub_service_module._HUB_REQUIRED_COLUMNS[
        "hub_announcements"
    ]
