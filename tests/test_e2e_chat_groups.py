"""Group conversation rules through the real HTTP router.

Pinning is a manager action (owner and moderators), and a deactivated account
must still be removable from a group. Reuses the isolated chat_env fixture.
"""
from __future__ import annotations

import importlib
import itertools

from test_e2e_chat_flow import chat_env  # noqa: F401  (pytest fixture)

chat_service_module = importlib.import_module("backend.chat.service")


_title_counter = itertools.count(1)


def _create_group(client, member_ids=(2, 3), title=None) -> str:
    # Identical title and members within a minute are treated as a retry, so tests that need
    # several groups get distinct titles by default.
    created = client.post(
        "/chat/conversations/group",
        json={"title": title or f"Rules group {next(_title_counter)}", "member_user_ids": list(member_ids)},
    )
    assert created.status_code == 200, created.text
    return created.json()["id"]


def test_group_pinning_is_limited_to_owner_and_moderators(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "pin me", "client_message_id": "pin-1"},
    )
    assert sent.status_code == 200, sent.text
    message_id = sent.json()["id"]
    pin_url = f"/chat/conversations/{conversation_id}/pinned-message"

    # A plain member cannot pin.
    set_user(3)
    denied = client.put(pin_url, json={"message_id": message_id})
    assert denied.status_code == 403, denied.text

    # The owner promotes user 2 to moderator; the moderator can pin.
    set_user(1)
    promoted = client.patch(
        f"/chat/conversations/{conversation_id}/members/2/role",
        json={"member_role": "moderator"},
    )
    assert promoted.status_code == 200, promoted.text
    set_user(2)
    pinned = client.put(pin_url, json={"message_id": message_id})
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["pinned_message_id"] == message_id

    # Every member sees the pin; a member still cannot unpin it.
    set_user(3)
    seen = client.get(f"/chat/conversations/{conversation_id}")
    assert seen.status_code == 200, seen.text
    assert seen.json()["pinned_message_id"] == message_id
    unpin_denied = client.put(pin_url, json={"message_id": None})
    assert unpin_denied.status_code == 403, unpin_denied.text

    # The owner clears the pin.
    set_user(1)
    cleared = client.put(pin_url, json={"message_id": None})
    assert cleared.status_code == 200, cleared.text
    assert not cleared.json().get("pinned_message_id")


def test_owner_can_remove_a_deactivated_member(chat_env, monkeypatch):  # noqa: F811
    client, _set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    original_get_by_id = chat_service_module.user_service.get_by_id

    def _get_by_id(user_id):
        raw = original_get_by_id(user_id)
        if raw and int(user_id) == 3:
            return dict(raw, is_active=False)
        return raw

    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", _get_by_id)

    removed = client.delete(f"/chat/conversations/{conversation_id}/members/3")
    assert removed.status_code == 200, removed.text
    member_ids = {
        int((member.get("user") or {}).get("id") or member.get("user_id") or 0)
        for member in (removed.json().get("members") or [])
    }
    assert 3 not in member_ids, removed.json()


import pytest  # noqa: E402

chat_db_module = importlib.import_module("backend.chat.db")
group_settings_module = importlib.import_module("backend.chat.chat_group_settings")
group_limits_module = importlib.import_module("backend.chat.chat_group_limits")
group_restrictions_module = importlib.import_module("backend.chat.chat_group_restrictions")
group_permissions_module = importlib.import_module("backend.chat.chat_group_permissions")


@pytest.fixture(autouse=True)
def _reset_group_settings_runtime():
    group_settings_module.reset_runtime_state()
    group_limits_module.reset_runtime_state()
    group_restrictions_module.reset_runtime_state()
    group_permissions_module.reset_runtime_state()
    yield
    group_settings_module.reset_runtime_state()
    group_limits_module.reset_runtime_state()
    group_restrictions_module.reset_runtime_state()
    group_permissions_module.reset_runtime_state()


def test_group_posting_policy_and_description(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    profile_url = f"/chat/conversations/{conversation_id}/profile"
    messages_url = f"/chat/conversations/{conversation_id}/messages"

    # Owner promotes user 2 to moderator, writes a description and limits posting.
    assert client.patch(
        f"/chat/conversations/{conversation_id}/members/2/role", json={"member_role": "moderator"}
    ).status_code == 200
    updated = client.patch(
        profile_url, json={"description": "Рабочая группа", "posting_policy": "managers"}
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["description"] == "Рабочая группа"
    assert updated.json()["posting_policy"] == "managers"

    # A plain member cannot write; the moderator and the owner can.
    set_user(3)
    denied = client.post(messages_url, json={"body": "hello", "client_message_id": "m-denied"})
    assert denied.status_code == 403, denied.text
    seen = client.get(f"/chat/conversations/{conversation_id}")
    assert seen.json()["posting_policy"] == "managers"
    assert seen.json()["description"] == "Рабочая группа"

    set_user(2)
    allowed = client.post(messages_url, json={"body": "from moderator", "client_message_id": "m-mod"})
    assert allowed.status_code == 200, allowed.text
    # A moderator edits the description but cannot change the posting rule.
    assert client.patch(profile_url, json={"description": "Новое описание"}).status_code == 200
    assert client.patch(profile_url, json={"posting_policy": "all"}).status_code == 403

    # The owner opens the group again.
    set_user(1)
    assert client.patch(profile_url, json={"posting_policy": "all"}).status_code == 200
    set_user(3)
    reopened = client.post(messages_url, json={"body": "hello again", "client_message_id": "m-ok"})
    assert reopened.status_code == 200, reopened.text


def test_closed_group_blocks_everyone_until_reopened(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    profile_url = f"/chat/conversations/{conversation_id}/profile"
    messages_url = f"/chat/conversations/{conversation_id}/messages"

    closed = client.patch(profile_url, json={"posting_policy": "closed"})
    assert closed.status_code == 200, closed.text
    assert closed.json()["posting_policy"] == "closed"

    # Nobody writes, the owner included; the group stays readable.
    assert client.post(messages_url, json={"body": "owner", "client_message_id": "c-1"}).status_code == 403
    set_user(2)
    assert client.post(messages_url, json={"body": "member", "client_message_id": "c-2"}).status_code == 403
    assert client.get(messages_url).status_code == 200

    # Only the owner reopens it.
    assert client.patch(profile_url, json={"posting_policy": "all"}).status_code == 403
    set_user(1)
    assert client.patch(profile_url, json={"posting_policy": "all"}).status_code == 200
    set_user(2)
    assert client.post(messages_url, json={"body": "again", "client_message_id": "c-3"}).status_code == 200


def test_conversation_list_carries_the_posting_rule_for_members(chat_env):  # noqa: F811
    # The member's composer is replaced by a plaque from the list item alone, without opening the
    # detail: the list must say the group is managers-only or closed.
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client, title="Policy in list")
    profile_url = f"/chat/conversations/{conversation_id}/profile"

    def _member_policy() -> str | None:
        set_user(2)
        # A search bypasses the soft list cache, which may serve the previous rule for ~2.5 s.
        items = client.get("/chat/conversations", params={"q": "Policy in list"}).json()["items"]
        set_user(1)
        return next(item for item in items if item["id"] == conversation_id).get("posting_policy")

    assert _member_policy() == "all"
    assert client.patch(profile_url, json={"posting_policy": "managers"}).status_code == 200
    assert _member_policy() == "managers"
    assert client.patch(profile_url, json={"posting_policy": "closed"}).status_code == 200
    assert _member_policy() == "closed"


def test_group_settings_table_missing_keeps_groups_working(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_settings"))
    group_settings_module.reset_runtime_state()

    # Before the migration: sending and reading work as before, saving settings is a clear 400.
    set_user(3)
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "still works", "client_message_id": "m-1"},
    )
    assert sent.status_code == 200, sent.text
    detail = client.get(f"/chat/conversations/{conversation_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["posting_policy"] == "all"

    set_user(1)
    refused = client.patch(
        f"/chat/conversations/{conversation_id}/profile", json={"posting_policy": "managers"}
    )
    assert refused.status_code == 400, refused.text


def test_slow_mode_limits_plain_members_only(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    profile_url = f"/chat/conversations/{conversation_id}/profile"
    messages_url = f"/chat/conversations/{conversation_id}/messages"
    assert client.patch(
        f"/chat/conversations/{conversation_id}/members/3/role", json={"member_role": "moderator"}
    ).status_code == 200

    # Only the owner sets it, and only to one of the offered steps.
    assert client.patch(profile_url, json={"slow_mode_seconds": 45}).status_code == 422
    set_user(3)
    assert client.patch(profile_url, json={"slow_mode_seconds": 30}).status_code == 403
    set_user(1)
    enabled = client.patch(profile_url, json={"slow_mode_seconds": 30})
    assert enabled.status_code == 200, enabled.text
    assert enabled.json()["slow_mode_seconds"] == 30

    # A plain member: the first message goes through, the next one waits with a clear 429.
    set_user(2)
    first = client.post(messages_url, json={"body": "one", "client_message_id": "s-1"})
    assert first.status_code == 200, first.text
    second = client.post(messages_url, json={"body": "two", "client_message_id": "s-2"})
    assert second.status_code == 429, second.text
    assert 1 <= int(second.headers["Retry-After"]) <= 30
    assert "Медленный режим" in second.json()["detail"]

    # Owner and moderators are exempt.
    for user_id in (1, 3):
        set_user(user_id)
        for index in range(2):
            sent = client.post(messages_url, json={"body": f"m{index}", "client_message_id": f"s-{user_id}-{index}"})
            assert sent.status_code == 200, sent.text

    # Members of the list see the value; switching it off lifts the wait at once.
    set_user(2)
    listed = client.get("/chat/conversations", params={"q": "Rules group"}).json()["items"]
    assert next(item for item in listed if item["id"] == conversation_id)["slow_mode_seconds"] == 30
    set_user(1)
    assert client.patch(profile_url, json={"slow_mode_seconds": 0}).status_code == 200
    group_limits_module.reset_runtime_state()
    set_user(2)
    assert client.post(messages_url, json={"body": "free", "client_message_id": "s-3"}).status_code == 200


def test_slow_mode_table_missing_keeps_groups_working(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_limits"))
    group_limits_module.reset_runtime_state()

    set_user(2)
    for index in range(2):
        sent = client.post(
            f"/chat/conversations/{conversation_id}/messages",
            json={"body": f"free {index}", "client_message_id": f"t-{index}"},
        )
        assert sent.status_code == 200, sent.text
    detail = client.get(f"/chat/conversations/{conversation_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["slow_mode_seconds"] == 0

    set_user(1)
    refused = client.patch(f"/chat/conversations/{conversation_id}/profile", json={"slow_mode_seconds": 30})
    assert refused.status_code == 400, refused.text


def test_restricted_member_reads_but_cannot_write_until_lifted(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    base = f"/chat/conversations/{conversation_id}"
    restriction_url = f"{base}/members/2/restriction"

    restricted = client.put(restriction_url, json={"duration_seconds": 3600})
    assert restricted.status_code == 200, restricted.text
    members = {item["user"]["id"]: item for item in restricted.json()["members"]}
    assert members[2]["is_restricted"] is True and members[2]["restricted_until"]
    assert members[3]["is_restricted"] is False

    # The restricted member still reads and sees the restriction on the group.
    set_user(2)
    refused = client.post(f"{base}/messages", json={"body": "hi", "client_message_id": "r-1"})
    assert refused.status_code == 403, refused.text
    assert "ограничена отправка" in refused.json()["detail"]
    assert client.get(f"{base}/messages").status_code == 200
    detail = client.get(base).json()
    assert detail["viewer_restricted"] is True
    # A plain member does not learn who else is restricted.
    assert all(not item.get("is_restricted") for item in detail["members"])
    listed = client.get("/chat/conversations", params={"q": "Rules group"}).json()["items"]
    assert next(item for item in listed if item["id"] == conversation_id)["viewer_restricted"] is True

    # Others write freely; the owner lifts the restriction.
    set_user(3)
    assert client.post(f"{base}/messages", json={"body": "ok", "client_message_id": "r-3"}).status_code == 200
    set_user(1)
    lifted = client.delete(restriction_url)
    assert lifted.status_code == 200, lifted.text
    assert all(not item["is_restricted"] for item in lifted.json()["members"])
    set_user(2)
    assert client.post(f"{base}/messages", json={"body": "back", "client_message_id": "r-2"}).status_code == 200


def test_restriction_rights_follow_the_member_hierarchy(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    base = f"/chat/conversations/{conversation_id}"
    assert client.patch(f"{base}/members/3/role", json={"member_role": "moderator"}).status_code == 200

    # A plain member restricts nobody; a moderator restricts members but neither the owner nor himself.
    set_user(2)
    assert client.put(f"{base}/members/3/restriction", json={}).status_code == 403
    set_user(3)
    assert client.put(f"{base}/members/2/restriction", json={"duration_seconds": 86400}).status_code == 200
    assert client.put(f"{base}/members/1/restriction", json={}).status_code == 403
    assert client.put(f"{base}/members/3/restriction", json={}).status_code == 403
    assert client.put(f"{base}/members/2/restriction", json={"duration_seconds": 45}).status_code == 422

    # Only the owner restricts a moderator.
    set_user(1)
    assert client.patch(f"{base}/members/2/role", json={"member_role": "moderator"}).status_code == 200
    set_user(3)
    assert client.put(f"{base}/members/2/restriction", json={}).status_code == 403
    set_user(1)
    assert client.put(f"{base}/members/3/restriction", json={}).status_code == 200

    # The action journal names who restricted whom.
    activity = client.get(f"{base}/activity").json()["items"]
    assert any(item["action"] == "member_restricted" for item in activity)


def test_restriction_table_missing_keeps_groups_working(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_restrictions"))
    group_restrictions_module.reset_runtime_state()

    set_user(2)
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages", json={"body": "free", "client_message_id": "x-1"}
    )
    assert sent.status_code == 200, sent.text
    set_user(1)
    refused = client.put(f"/chat/conversations/{conversation_id}/members/2/restriction", json={})
    assert refused.status_code == 400, refused.text


def _send_file(client, conversation_id: str, client_message_id: str):
    return client.post(
        f"/chat/conversations/{conversation_id}/messages/files",
        data={"client_message_id": client_message_id, "body": ""},
        files=[("files", ("note.txt", b"hello group", "text/plain"))],
    )


def test_forbidden_files_stop_plain_members_only(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    base = f"/chat/conversations/{conversation_id}"
    profile_url = f"{base}/profile"
    assert client.patch(f"{base}/members/3/role", json={"member_role": "moderator"}).status_code == 200

    # Files are allowed by default; only the owner changes the flag.
    set_user(2)
    assert _send_file(client, conversation_id, "f-1").status_code == 200
    assert client.patch(profile_url, json={"members_send_files": False}).status_code == 403
    set_user(1)
    forbidden = client.patch(profile_url, json={"members_send_files": False})
    assert forbidden.status_code == 200, forbidden.text
    assert forbidden.json()["members_send_files"] is False

    # A plain member keeps writing text but cannot send a file, upload session or forward one.
    set_user(2)
    assert client.post(f"{base}/messages", json={"body": "text", "client_message_id": "f-2"}).status_code == 200
    refused = _send_file(client, conversation_id, "f-3")
    assert refused.status_code == 403, refused.text
    assert "файлы могут отправлять только владелец и модераторы" in refused.json()["detail"]
    created = client.post(
        f"{base}/upload-sessions",
        json={"files": [{"file_name": "a.txt", "mime_type": "text/plain", "size": 5, "original_size": 5}]},
    )
    assert created.status_code == 403, created.text

    # The owner and a moderator are exempt.
    for user_id in (1, 3):
        set_user(user_id)
        sent = _send_file(client, conversation_id, f"f-ok-{user_id}")
        assert sent.status_code == 200, sent.text
    file_message_id = sent.json()["id"]

    # A forward that carries the file is refused the same way; the flag is visible in the list.
    set_user(2)
    forwarded = client.post(
        f"{base}/messages/forward",
        json={"source_message_id": file_message_id, "client_message_id": "f-fwd"},
    )
    assert forwarded.status_code == 403, forwarded.text
    listed = client.get("/chat/conversations", params={"q": "Rules group"}).json()["items"]
    assert next(item for item in listed if item["id"] == conversation_id)["members_send_files"] is False

    # Allowing files again takes effect at once.
    set_user(1)
    assert client.patch(profile_url, json={"members_send_files": True}).status_code == 200
    group_permissions_module.reset_runtime_state()
    set_user(2)
    assert _send_file(client, conversation_id, "f-4").status_code == 200


def test_permissions_table_missing_keeps_groups_working(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)

    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_permissions"))
    group_permissions_module.reset_runtime_state()

    set_user(2)
    assert _send_file(client, conversation_id, "m-1").status_code == 200
    detail = client.get(f"/chat/conversations/{conversation_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["members_send_files"] is True

    set_user(1)
    refused = client.patch(f"/chat/conversations/{conversation_id}/profile", json={"members_send_files": False})
    assert refused.status_code == 400, refused.text


def test_owner_leaves_only_with_a_successor(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client)
    leave_url = f"/chat/conversations/{conversation_id}/leave"

    # Without a successor the owner stays; the group keeps its owner.
    assert client.post(leave_url).status_code == 403
    # A successor must be an active member of this group.
    assert client.post(leave_url, json={"successor_user_id": 99}).status_code == 404

    left = client.post(leave_url, json={"successor_user_id": 2})
    assert left.status_code == 200, left.text

    # The former owner is out; user 2 owns the group and sees the hand-over message.
    set_user(2)
    detail = client.get(f"/chat/conversations/{conversation_id}")
    assert detail.status_code == 200, detail.text
    roles = {
        int((member.get("user") or {}).get("id") or 0): member.get("member_role")
        for member in detail.json().get("members") or []
    }
    assert roles.get(2) == "owner", roles
    assert 1 not in roles, roles
    set_user(1)
    assert client.get(f"/chat/conversations/{conversation_id}").status_code in (403, 404)


from test_e2e_chat_flow import _public_user, _raw_user  # noqa: E402

deps_module = importlib.import_module("backend.api.deps")
group_admin_module = importlib.import_module("backend.chat.chat_group_admin")


@pytest.fixture
def portal_admin(chat_env, monkeypatch):  # noqa: F811
    """User 3 (not a member of the test group) becomes a portal administrator."""
    client, set_user, drain = chat_env
    original_get_by_id = chat_service_module.user_service.get_by_id

    def _get_by_id(user_id):
        raw = original_get_by_id(user_id)
        if raw and int(user_id) == 3:
            return dict(raw, role="admin")
        return raw

    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", _get_by_id)
    group_admin_module.reset_runtime_state()
    admin_user = _public_user(_raw_user(3, "mallory", "Mallory Outsider", "admin"))

    member_override = client.app.dependency_overrides[deps_module.get_current_active_user]

    def as_admin():
        client.app.dependency_overrides[deps_module.get_current_active_user] = lambda: admin_user

    def switch_user(user_id):
        # Back to the fixture's switchable user (the admin override is a fixed identity).
        client.app.dependency_overrides[deps_module.get_current_active_user] = member_override
        set_user(user_id)

    yield client, switch_user, as_admin
    group_admin_module.reset_runtime_state()


def test_portal_admin_rescues_a_group_without_reading_it(portal_admin):
    client, set_user, as_admin = portal_admin
    conversation_id = _create_group(client, member_ids=(2,))  # owner 1, member 2
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "private text", "client_message_id": "adm-1"},
    )
    assert sent.status_code == 200, sent.text
    owner_url = f"/chat/admin/groups/{conversation_id}/owner"

    # A regular user cannot use the admin endpoints.
    set_user(2)
    assert client.post(owner_url, json={"owner_user_id": 2}).status_code == 403

    # The admin is not a member, yet may reassign the owner; structure only is returned.
    as_admin()
    assigned = client.post(owner_url, json={"owner_user_id": 2})
    assert assigned.status_code == 200, assigned.text
    view = assigned.json()
    assert view["owner_user_id"] == 2 and view["owner_active"] is True
    assert {member["member_role"] for member in view["members"]} == {"owner", "moderator"}
    assert "private text" not in assigned.text

    # The same repeated call changes nothing and is not audited twice.
    assert client.post(owner_url, json={"owner_user_id": 2}).status_code == 200
    audit = client.get(f"/chat/admin/groups/{conversation_id}/audit")
    assert audit.status_code == 200, audit.text
    items = audit.json()["items"]
    assert [item["action"] for item in items] == ["assign_owner"]
    assert items[0]["actor_user_id"] == 3 and items[0]["target_user_id"] == 2

    # Being an admin does not open the group's content.
    assert client.get(f"/chat/conversations/{conversation_id}/messages").status_code in (403, 404)
    assert client.get(f"/chat/conversations/{conversation_id}").status_code in (403, 404)

    # The current owner cannot be removed; a former owner (now moderator) can.
    assert client.delete(f"/chat/admin/groups/{conversation_id}/members/2").status_code == 403
    removed = client.delete(f"/chat/admin/groups/{conversation_id}/members/1")
    assert removed.status_code == 200, removed.text
    assert removed.json()["removed"] is True
    set_user(1)
    assert client.get(f"/chat/conversations/{conversation_id}").status_code in (403, 404)


def test_portal_admin_lists_groups_whose_owner_is_deactivated(portal_admin, monkeypatch):
    client, set_user, as_admin = portal_admin
    # Owned by user 2 (stays active) and, created later, by user 1 (gets deactivated).
    set_user(2)
    healthy_id = _create_group(client, member_ids=(1,))
    set_user(1)
    orphan_id = _create_group(client, member_ids=(2,))
    # The orphaned group is the staler one: it must not be pushed out by recency.
    with chat_db_module.chat_session() as session:
        session.execute(
            chat_db_module.text("UPDATE chat_conversations SET updated_at = '2020-01-01 00:00:00' WHERE id = :id"),
            {"id": orphan_id},
        )

    original_get_by_id = chat_service_module.user_service.get_by_id
    original_map = chat_service_module.user_service.get_users_map_by_ids

    def _get_by_id(user_id):
        raw = original_get_by_id(user_id)
        return dict(raw, is_active=False) if raw and int(user_id) == 1 else raw

    def _users_map(user_ids):
        return {
            uid: dict(raw, is_active=False) if uid == 1 else raw
            for uid, raw in original_map(user_ids).items()
        }

    monkeypatch.setattr(chat_service_module.user_service, "get_by_id", _get_by_id)
    monkeypatch.setattr(chat_service_module.user_service, "get_users_map_by_ids", _users_map)
    as_admin()
    listed = client.get("/chat/admin/groups/ownerless")
    assert listed.status_code == 200, listed.text
    ids = {item["id"] for item in listed.json()["items"]}
    assert orphan_id in ids
    assert healthy_id not in ids


def test_portal_admin_action_is_refused_without_audit_table(portal_admin):
    client, set_user, as_admin = portal_admin
    conversation_id = _create_group(client, member_ids=(2,))
    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_admin_audit"))
    group_admin_module.reset_runtime_state()

    as_admin()
    refused = client.post(f"/chat/admin/groups/{conversation_id}/owner", json={"owner_user_id": 2})
    assert refused.status_code == 400, refused.text

    # Ordinary chat keeps working and nothing changed.
    set_user(2)
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "still fine", "client_message_id": "adm-2"},
    )
    assert sent.status_code == 200, sent.text


invites_module = importlib.import_module("backend.chat.chat_group_invites")


@pytest.fixture
def _reset_invites_runtime():
    invites_module.reset_runtime_state()
    yield
    invites_module.reset_runtime_state()


def test_invite_link_lifecycle(chat_env, _reset_invites_runtime):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client, member_ids=(2,))  # owner 1, member 2; user 3 is outside
    invite_url = f"/chat/conversations/{conversation_id}/invite-link"

    # A plain member cannot issue links.
    set_user(2)
    assert client.post(invite_url).status_code == 403

    set_user(1)
    first = client.post(invite_url)
    assert first.status_code == 200, first.text
    first_token = first.json()["token"]

    # An outsider previews, joins, and a second join is a harmless no-op.
    set_user(3)
    preview = client.get(f"/chat/invite-links/{first_token}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["already_member"] is False
    joined = client.post(f"/chat/invite-links/{first_token}/join")
    assert joined.status_code == 200, joined.text
    assert joined.json()["joined"] is True
    assert client.post(f"/chat/invite-links/{first_token}/join").json()["joined"] is False
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "hi, joined by link", "client_message_id": "inv-1"},
    )
    assert sent.status_code == 200, sent.text

    # A new link replaces the old one: the old token stops working for everyone.
    set_user(1)
    second_token = client.post(invite_url).json()["token"]
    assert second_token != first_token
    set_user(3)
    assert client.get(f"/chat/invite-links/{first_token}").status_code == 404
    assert client.get("/chat/invite-links/not-a-real-token").status_code == 404

    # A removed member cannot slip back in through the link.
    set_user(1)
    assert client.delete(f"/chat/conversations/{conversation_id}/members/2").status_code == 200
    set_user(2)
    assert client.post(f"/chat/invite-links/{second_token}/join").status_code == 403

    # Revoking kills the link.
    set_user(1)
    assert client.delete(invite_url).status_code == 200
    set_user(3)
    assert client.get(f"/chat/invite-links/{second_token}").status_code == 404


def test_invite_link_is_refused_without_table(chat_env, _reset_invites_runtime):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client, member_ids=(2,))
    with chat_db_module.chat_session() as session:
        session.execute(chat_db_module.text("DROP TABLE chat_group_invites"))
    invites_module.reset_runtime_state()

    assert client.post(f"/chat/conversations/{conversation_id}/invite-link").status_code == 400
    set_user(2)
    sent = client.post(
        f"/chat/conversations/{conversation_id}/messages",
        json={"body": "chat still works", "client_message_id": "inv-2"},
    )
    assert sent.status_code == 200, sent.text


def test_group_creation_is_rate_limited_and_capped(chat_env, monkeypatch):  # noqa: F811
    client, set_user, _drain_background = chat_env
    monkeypatch.setenv("CHAT_GROUP_CREATE_PER_MINUTE", "2")
    monkeypatch.setenv("CHAT_GROUP_MAX_OWNED", "3")

    first = _create_group(client)
    _create_group(client)

    # A burst beyond the per-minute guard answers 429 with Retry-After.
    burst = client.post(
        "/chat/conversations/group",
        json={"title": "Too fast", "member_user_ids": [2]},
    )
    assert burst.status_code == 429, burst.text
    assert burst.headers.get("Retry-After") == "60"

    # Being a member of other people's groups does not count against the creator's cap.
    set_user(2)
    assert _create_group(client, member_ids=(1,))

    # Owned groups are capped separately: raise the burst guard, hit the cap of three.
    set_user(1)
    monkeypatch.setenv("CHAT_GROUP_CREATE_PER_MINUTE", "60")
    _create_group(client)
    capped = client.post(
        "/chat/conversations/group",
        json={"title": "One too many", "member_user_ids": [2]},
    )
    assert capped.status_code == 400, capped.text
    assert "предел" in capped.json()["detail"]

    # Leaving (handing over) a group frees a slot.
    left = client.post(
        f"/chat/conversations/{first}/leave",
        json={"successor_user_id": 2},
    )
    assert left.status_code == 200, left.text
    assert _create_group(client)


def test_mention_all_is_limited_to_owner_and_moderators(chat_env):  # noqa: F811
    client, set_user, drain_background = chat_env
    conversation_id = _create_group(client)
    url = f"/chat/conversations/{conversation_id}"

    def _mentions(viewer_id: int) -> int:
        set_user(viewer_id)
        detail = client.get(url)
        assert detail.status_code == 200, detail.text
        return int(detail.json().get("unread_mention_count") or 0)

    # A plain member writing @все is just text: nobody gets a mention badge.
    set_user(3)
    plain = client.post(f"{url}/messages", json={"body": "@все привет", "client_message_id": "all-1"})
    assert plain.status_code == 200, plain.text
    drain_background()
    assert _mentions(1) == 0
    assert _mentions(2) == 0

    # The owner reaches every other member, but not themselves.
    set_user(1)
    sent = client.post(f"{url}/messages", json={"body": "@все собрание в 10:00", "client_message_id": "all-2"})
    assert sent.status_code == 200, sent.text
    drain_background()
    assert _mentions(2) == 1
    assert _mentions(3) == 1
    assert _mentions(1) == 0

    # A moderator can do it as well.
    set_user(1)
    promoted = client.patch(f"{url}/members/2/role", json={"member_role": "moderator"})
    assert promoted.status_code == 200, promoted.text
    set_user(2)
    by_moderator = client.post(f"{url}/messages", json={"body": "@all срочно", "client_message_id": "all-3"})
    assert by_moderator.status_code == 200, by_moderator.text
    drain_background()
    assert _mentions(3) == 2
    assert _mentions(1) == 1


def test_auto_owner_hands_an_abandoned_group_to_an_active_member_once(portal_admin, monkeypatch):
    client, set_user, as_admin = portal_admin
    conversation_id = _create_group(client, member_ids=(2,))  # owner 1, member 2

    original_get_by_id = chat_service_module.user_service.get_by_id
    original_map = chat_service_module.user_service.get_users_map_by_ids
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_by_id",
        lambda user_id: (
            dict(original_get_by_id(user_id), is_active=False)
            if original_get_by_id(user_id) and int(user_id) == 1
            else original_get_by_id(user_id)
        ),
    )
    monkeypatch.setattr(
        chat_service_module.user_service,
        "get_users_map_by_ids",
        lambda user_ids: {
            uid: dict(raw, is_active=False) if uid == 1 else raw
            for uid, raw in original_map(user_ids).items()
        },
    )
    monkeypatch.delenv("CHAT_GROUP_AUTO_OWNER_ENABLED", raising=False)
    as_admin()
    url = "/chat/admin/groups/auto-owner"

    # A dry run changes nothing and says whom it would pick.
    preview = client.post(url, json={"dry_run": True})
    assert preview.status_code == 200, preview.text
    assert preview.json()["enabled"] is False
    assert [item["successor_user_id"] for item in preview.json()["planned"]] == [2]
    assert preview.json()["assigned"] == 0
    assert client.get(f"/chat/admin/groups/{conversation_id}").json()["owner_active"] is False

    # A real run is refused until the flag is switched on.
    refused = client.post(url, json={"dry_run": False})
    assert refused.status_code == 400, refused.text
    assert "CHAT_GROUP_AUTO_OWNER_ENABLED" in refused.json()["detail"]

    monkeypatch.setenv("CHAT_GROUP_AUTO_OWNER_ENABLED", "true")
    done = client.post(url, json={"dry_run": False})
    assert done.status_code == 200, done.text
    assert done.json()["assigned"] == 1
    view = client.get(f"/chat/admin/groups/{conversation_id}").json()
    assert view["owner_user_id"] == 2 and view["owner_active"] is True

    # Running again finds nothing to do and writes no second audit row.
    again = client.post(url, json={"dry_run": False})
    assert again.status_code == 200, again.text
    assert again.json()["assigned"] == 0 and again.json()["planned"] == []
    audit = client.get(f"/chat/admin/groups/{conversation_id}/audit").json()["items"]
    assert [item["action"] for item in audit] == ["auto_assign_owner"]
    assert audit[0]["actor_user_id"] == 3 and audit[0]["target_user_id"] == 2


def test_group_managers_see_a_journal_of_owner_and_moderator_actions(chat_env):  # noqa: F811
    client, set_user, _drain_background = chat_env
    conversation_id = _create_group(client, member_ids=(2,))
    base = f"/chat/conversations/{conversation_id}"

    assert client.patch(f"{base}/members/2/role", json={"member_role": "moderator"}).status_code == 200
    described = client.patch(f"{base}/profile", json={"description": "Секретный текст"})
    assert described.status_code == 200, described.text
    invite = client.post(f"{base}/invite-link")
    assert invite.status_code == 200, invite.text
    assert client.delete(f"{base}/invite-link").status_code == 200

    journal = client.get(f"{base}/activity")
    assert journal.status_code == 200, journal.text
    items = journal.json()["items"]
    actions = [item["action"] for item in items]
    assert {"role_changed", "profile_updated", "invite_created", "invite_revoked"} <= set(actions)
    role_row = next(item for item in items if item["action"] == "role_changed")
    assert role_row["actor_user_id"] == 1 and role_row["target_user_id"] == 2
    assert role_row["details"] == {"role": "moderator"}
    # The invite token and message text never reach the journal.
    assert invite.json()["token"] not in journal.text
    assert "Секретный текст" not in journal.text

    # A moderator sees it too; a plain member does not.
    set_user(2)
    assert client.get(f"{base}/activity").status_code == 200
    third = client.post(f"{base}/members", json={"member_user_ids": [3]})
    assert third.status_code == 200, third.text
    set_user(3)
    assert client.get(f"{base}/activity").status_code == 403


def test_deleting_a_group_removes_its_settings_invites_and_journal(chat_env):  # noqa: F811
    client, _set_user, _drain_background = chat_env
    conversation_id = _create_group(client, member_ids=(2,))
    base = f"/chat/conversations/{conversation_id}"
    assert client.patch(f"{base}/profile", json={"description": "Для удаления"}).status_code == 200
    assert client.post(f"{base}/invite-link").status_code == 200

    def _count(table: str) -> int:
        with chat_db_module.chat_session() as session:
            return int(session.execute(
                chat_db_module.text(f"SELECT COUNT(*) FROM {table} WHERE conversation_id = :id"),
                {"id": conversation_id},
            ).scalar_one())

    assert _count("chat_group_settings") == 1
    assert _count("chat_group_invites") == 1
    assert _count("chat_group_admin_audit") >= 2

    deleted = client.delete(base)
    assert deleted.status_code == 200, deleted.text
    for table in ("chat_group_settings", "chat_group_invites", "chat_group_admin_audit", "chat_conversations"):
        column = "id" if table == "chat_conversations" else "conversation_id"
        with chat_db_module.chat_session() as session:
            left = session.execute(
                chat_db_module.text(f"SELECT COUNT(*) FROM {table} WHERE {column} = :id"),
                {"id": conversation_id},
            ).scalar_one()
        assert int(left) == 0, table


def test_scheduled_message_is_refused_in_a_closed_group(chat_env, monkeypatch):  # noqa: F811
    from datetime import datetime, timedelta, timezone

    client, set_user, _drain_background = chat_env
    monkeypatch.setenv("CHAT_SCHEDULED_MESSAGES_ENABLED", "1")
    conversation_id = _create_group(client, member_ids=(2,))
    base = f"/chat/conversations/{conversation_id}"
    plan = {
        "body": "позже",
        "scheduled_for": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }

    open_group = client.post(f"{base}/scheduled", json=plan)
    assert open_group.status_code == 200, open_group.text

    assert client.patch(f"{base}/profile", json={"posting_policy": "closed"}).status_code == 200
    refused = client.post(f"{base}/scheduled", json=plan)
    assert refused.status_code == 403, refused.text
    assert "закрыта" in refused.json()["detail"]


def test_repeated_group_creation_returns_the_same_group(chat_env):  # noqa: F811
    client, _set_user, _drain_background = chat_env
    first = _create_group(client, member_ids=(2, 3), title="Same group")
    again = _create_group(client, member_ids=(3, 2), title="Same group")
    assert again == first

    different = client.post(
        "/chat/conversations/group",
        json={"title": "Same group", "member_user_ids": [2]},
    )
    assert different.status_code == 200, different.text
    assert different.json()["id"] != first
