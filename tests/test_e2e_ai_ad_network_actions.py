"""Real AI draft/confirm routes; only LDAP, UDP and the LLM are isolated."""
from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from uuid import UUID

import pytest

from test_e2e_ai_draft_reliability import agent, actions, call, PERMISSIONS
from test_ai_chat_runtime import _make_user
from backend.api import deps
from backend.ai_chat.tools import network
from backend.appdb.db import app_session
from backend.appdb.models import AppAiBot, AppAiPendingAction, AppUser
from backend.services import ad_users_service as ad_service


@pytest.fixture
def infra(agent, monkeypatch):
    state = SimpleNamespace(packets=[], modifications=[], searches=[], denied=False, send_error=False,
                            guid=bytes(range(16)), lockout=134000000000000000,
                            verify_error=False, release_send=None, send_started=threading.Event(), anonymous=False,
                            hide_guid=False)

    def attribute(value, raw=None):
        return SimpleNamespace(value=value, raw_values=[raw if raw is not None else str(value).encode()])

    class Directory:
        bound = True
        result = {"result": 0}
        entries = []

        @property
        def authentication(self):
            return "ANONYMOUS" if state.anonymous else "SIMPLE"

        def search(self, **kwargs):
            state.searches.append(kwargs)
            base = kwargs.get("search_base", "")
            if (base.startswith("<GUID=") and base != f"<GUID={UUID(bytes_le=state.guid)}>") or (state.verify_error and state.modifications):
                self.result = {"result": 32}
                self.entries = []
                return False
            self.result = {"result": 0}
            self.entries = [SimpleNamespace(
                entry_dn="CN=Example,DC=example,DC=test",
                sAMAccountName=attribute("example.user"), displayName=attribute("Example User"),
                objectGUID=None if state.hide_guid else attribute(str(UUID(bytes_le=state.guid)), state.guid),
                lockoutTime=attribute(state.lockout), badPwdCount=attribute(4),
                userAccountControl=attribute(512),
            )]
            return True

        def modify(self, dn, changes):
            state.modifications.append((dn, changes))
            if state.denied:
                self.result = {"result": 50, "description": "insufficientAccessRights"}
                return False
            self.result = {"result": 0}
            state.lockout = 0
            return True

        def unbind(self):
            return True

    class Datagram:
        def setsockopt(self, *_args):
            pass

        def sendto(self, packet, address):
            state.send_started.set()
            if state.release_send is not None:
                assert state.release_send.wait(timeout=10), "fixture release timed out"
            if state.send_error:
                raise OSError("fixture: UDP unavailable")
            state.packets.append((packet, address))
            return len(packet)

        def close(self):
            pass

    monkeypatch.setattr(ad_service, "_open_ad_connection", Directory)
    monkeypatch.setattr(ad_service, "_resolve_ad_search_base", lambda: "DC=example,DC=test")
    monkeypatch.setattr(network, "socket", SimpleNamespace(
        AF_INET=network.socket.AF_INET, SOCK_DGRAM=network.socket.SOCK_DGRAM,
        SOL_SOCKET=network.socket.SOL_SOCKET, SO_BROADCAST=network.socket.SO_BROADCAST,
        socket=lambda *_args: Datagram(),
    ))
    state.permissions = [*PERMISSIONS, "ad_users.manage", "networks.write"]
    agent.client.app.dependency_overrides[deps.get_current_user] = lambda: _make_user(permissions=state.permissions)
    with app_session(agent.url) as db:
        db.get(AppUser, 99).custom_permissions_json = json.dumps(state.permissions)
        bot = db.get(AppAiBot, "agent")
        bot.enabled_tools_json = json.dumps([*json.loads(bot.enabled_tools_json), "ad.action.unlock_draft", "network.action.wol_draft"])
    state.agent = agent
    return state


def draft(infra, kind):
    tool, args, text = (
        ("ad.action.unlock_draft", {"login": "example.user"}, "Разблокируй учётную запись AD example.user")
        if kind == "ad" else
        ("network.action.wol_draft", {"mac_address": "AA:BB:CC:DD:EE:FF", "broadcast_ip": "192.0.2.255"}, "Отправь Wake-on-LAN AA:BB:CC:DD:EE:FF")
    )
    infra.agent.steps.extend([{"tool_calls": [call(tool, **args)]}, {"answer_markdown": "Подтвердите действие."}])
    infra.agent.request(text)
    cards = actions(infra.agent)
    assert len(cards) == 1, cards
    assert cards[0]["status"] == "pending"
    assert not infra.packets and not infra.modifications
    return cards[0]


@pytest.mark.parametrize("kind", ["ad", "wol"])
def test_confirmed_infrastructure_draft_executes_once(infra, kind):
    card = draft(infra, kind)
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "confirmed", response.json()
    again = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert again.status_code == 200, again.text
    assert again.json()["status"] == "confirmed"
    if kind == "ad":
        assert "example.user" in response.json()["preview"]["summary"]
        assert len(infra.modifications) == 1
        assert infra.modifications[0][0] == f"<GUID={UUID(bytes_le=infra.guid)}>"
        assert infra.modifications[0][1] == {"lockoutTime": [(ad_service.MODIFY_REPLACE, [0])]}
        assert infra.lockout == 0
    else:
        assert "AA:BB:CC:DD:EE:FF" in response.json()["preview"]["summary"]
        assert "192.0.2.255:9" in response.json()["preview"]["summary"]
        assert infra.packets == [(b"\xff" * 6 + bytes.fromhex("aabbccddeeff") * 16, ("192.0.2.255", 9))]


@pytest.mark.parametrize("kind, permission", [("ad", "ad_users.manage"), ("wol", "networks.write")])
def test_confirmation_rechecks_revoked_operation_permission(infra, kind, permission):
    card = draft(infra, kind)
    before = len(infra.searches)
    infra.permissions.remove(permission)
    with app_session(infra.agent.url) as db:
        db.get(AppUser, 99).custom_permissions_json = json.dumps(infra.permissions)
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 403, response.text
    assert actions(infra.agent)[0]["status"] == "pending"
    assert not infra.packets and not infra.modifications
    assert len(infra.searches) == before


@pytest.mark.parametrize("kind", ["ad", "wol"])
def test_another_user_cannot_confirm_infrastructure_action(infra, kind):
    card = draft(infra, kind)
    before = len(infra.searches)
    user = _make_user(permissions=infra.permissions).model_copy(update={"id": 848})
    infra.agent.client.app.dependency_overrides[deps.get_current_user] = lambda: user
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 403, response.text
    assert not infra.packets and not infra.modifications
    assert len(infra.searches) == before


@pytest.mark.parametrize("kind", ["ad", "wol"])
def test_confirmation_cannot_override_the_previewed_infrastructure_target(infra, kind):
    card = draft(infra, kind)
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm", json={
        "login": "another.user", "object_guid": "99999999-9999-9999-9999-999999999999",
        "mac_address": "00:00:00:00:00:01", "broadcast_ip": "198.51.100.255",
    })
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "confirmed", response.json()
    if kind == "ad":
        assert infra.modifications[0][0] == f"<GUID={UUID(bytes_le=infra.guid)}>"
    else:
        assert infra.packets[0][1] == ("192.0.2.255", 9)
        assert infra.packets[0][0] == b"\xff" * 6 + bytes.fromhex("aabbccddeeff") * 16


@pytest.mark.parametrize("scenario", ["recreated", "missing_guid", "denied", "verification_failed", "already_unlocked", "invalid_lockout", "anonymous"])
def test_ad_unlock_fails_closed_or_skips_an_already_unlocked_account(infra, scenario):
    card = draft(infra, "ad")
    if scenario == "recreated":
        infra.guid = bytes([9] * 16)
    elif scenario == "missing_guid":
        with app_session(infra.agent.url) as db:
            row = db.get(AppAiPendingAction, card["id"])
            payload = json.loads(row.payload_json)
            payload.pop("object_guid")
            row.payload_json = json.dumps(payload)
    elif scenario == "denied":
        infra.denied = True
    elif scenario == "verification_failed":
        infra.verify_error = True
    elif scenario == "already_unlocked":
        infra.lockout = 0
    elif scenario == "anonymous":
        infra.anonymous = True
    else:
        infra.lockout = "unverifiable"
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == ("confirmed" if scenario == "already_unlocked" else "failed"), response.json()
    assert len(infra.modifications) == (1 if scenario in {"denied", "verification_failed"} else 0)
    if scenario == "already_unlocked":
        assert response.json()["result"]["changed"] is False


def test_udp_failure_does_not_report_a_successful_wake(infra):
    card = draft(infra, "wol")
    infra.send_error = True
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "failed"
    assert response.json()["result"]["success"] is False
    assert not infra.packets


def test_two_parallel_confirmations_send_only_one_wol_packet(infra):
    card = draft(infra, "wol")
    infra.release_send = threading.Event()
    path = f"/api/v1/chat/ai/actions/{card['id']}/confirm"
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(infra.agent.client.post, path)
        try:
            assert infra.send_started.wait(timeout=5)
            second = pool.submit(infra.agent.client.post, path).result(timeout=5)
            assert second.status_code == 200, second.text
            assert second.json()["status"] == "executing"
        finally:
            infra.release_send.set()
        completed = first.result(timeout=5)
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "confirmed"
    assert len(infra.packets) == 1


@pytest.mark.parametrize("field, value", [("mac_address", None), ("mac_address", "invalid"), ("broadcast_ip", "example.test")])
def test_invalid_stored_wol_target_never_opens_a_socket(infra, field, value):
    card = draft(infra, "wol")
    with app_session(infra.agent.url) as db:
        row = db.get(AppAiPendingAction, card["id"])
        payload = json.loads(row.payload_json)
        payload[field] = value
        row.payload_json = json.dumps(payload)
    response = infra.agent.client.post(f"/api/v1/chat/ai/actions/{card['id']}/confirm")
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "failed"
    assert not infra.send_started.is_set() and not infra.packets


@pytest.mark.parametrize("scenario", ["fuzzy_login", "missing_guid", "broadcast_hostname"])
def test_unverified_infrastructure_target_never_becomes_a_confirmation_card(infra, scenario):
    if scenario == "broadcast_hostname":
        tool = call("network.action.wol_draft", mac_address="AA:BB:CC:DD:EE:FF", broadcast_ip="example.test")
        text = "Отправь Wake-on-LAN AA:BB:CC:DD:EE:FF"
    else:
        infra.hide_guid = scenario == "missing_guid"
        login = "example" if scenario == "fuzzy_login" else "example.user"
        tool = call("ad.action.unlock_draft", login=login)
        text = f"Разблокируй учётную запись AD {login}"
    infra.agent.steps.extend([{"tool_calls": [tool]}, {"answer_markdown": "Не удалось подготовить действие."}])
    infra.agent.request(text)
    assert not actions(infra.agent)
    assert not infra.modifications and not infra.send_started.is_set()
