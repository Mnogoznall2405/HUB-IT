"""MED-10: доступ к боту только при привязке Telegram ID к активному HUB user.

Членство в группе/allowlist без привязки, деактивированный пользователь и
пользователь без нужного права портала должны получать отказ (fail-closed).
"""
from unittest.mock import AsyncMock, Mock

import pytest

from bot.cache_manager import user_access_cache
from bot.utils import decorators
from bot.utils import hub_binding
from bot.utils.hub_binding import (
    PERM_DATABASE_READ,
    PERM_DATABASE_WRITE,
    hub_user_has_permission,
    resolve_hub_user,
)


@pytest.fixture(autouse=True)
def _reset_access_state():
    user_access_cache.clear()
    hub_binding._reset_cache()
    yield
    user_access_cache.clear()
    hub_binding._reset_cache()


def _update(user_id=424242):
    update = Mock()
    update.effective_user = Mock(id=user_id)
    update.message = Mock(reply_text=AsyncMock())
    update.callback_query = None
    return update


def _context():
    context = Mock()
    context.bot = AsyncMock()
    return context


def _set_gate(monkeypatch, *, allowed_users=(), group_id="", require_hub_user=True):
    from bot.config import config

    monkeypatch.setattr(config.telegram, "allowed_users", list(allowed_users))
    monkeypatch.setattr(config.telegram, "allowed_group_id", group_id)
    monkeypatch.setattr(config.telegram, "require_hub_user", require_hub_user)


_OPERATOR = {
    "id": 7,
    "username": "operator1",
    "is_active": True,
    "role": "operator",
    "use_custom_permissions": False,
    "custom_permissions": [],
}

_READ_ONLY = {
    "id": 8,
    "username": "reader1",
    "is_active": True,
    "role": "viewer",
    "use_custom_permissions": True,
    "custom_permissions": ["database.read"],
}


@pytest.mark.asyncio
async def test_allowlisted_user_bound_to_active_operator_gets_access(monkeypatch):
    _set_gate(monkeypatch, allowed_users=("424242",))
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: dict(_OPERATOR))

    assert await decorators.check_user_access(_update(), _context()) is True


@pytest.mark.asyncio
async def test_inactive_hub_user_is_denied_despite_allowlist(monkeypatch):
    _set_gate(monkeypatch, allowed_users=("424242",))
    monkeypatch.setattr(
        decorators, "resolve_hub_user", lambda tid: {**_OPERATOR, "is_active": False}
    )

    assert await decorators.check_user_access(_update(), _context()) is False


@pytest.mark.asyncio
async def test_unmapped_telegram_id_is_denied_even_when_allowlisted(monkeypatch):
    _set_gate(monkeypatch, allowed_users=("424242",))
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: None)

    assert await decorators.check_user_access(_update(), _context()) is False


@pytest.mark.asyncio
async def test_group_member_with_active_binding_gets_access(monkeypatch):
    _set_gate(monkeypatch, allowed_users=(), group_id="-100")
    context = _context()
    context.bot.get_chat_member = AsyncMock(return_value=Mock(status="member"))
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: dict(_OPERATOR))

    assert await decorators.check_user_access(_update(777001), context) is True


@pytest.mark.asyncio
async def test_group_member_without_binding_is_denied(monkeypatch):
    _set_gate(monkeypatch, allowed_users=(), group_id="-100")
    context = _context()
    context.bot.get_chat_member = AsyncMock(return_value=Mock(status="member"))
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: None)

    assert await decorators.check_user_access(_update(777001), context) is False


@pytest.mark.asyncio
async def test_viewer_without_database_read_is_denied(monkeypatch):
    _set_gate(monkeypatch, allowed_users=("424242",))
    viewer = {**_OPERATOR, "role": "viewer"}
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: viewer)

    assert await decorators.check_user_access(_update(), _context()) is False


@pytest.mark.asyncio
async def test_write_permission_required_for_work_and_transfer(monkeypatch):
    _set_gate(monkeypatch, allowed_users=("424242",))
    monkeypatch.setattr(decorators, "resolve_hub_user", lambda tid: dict(_READ_ONLY))
    update, context = _update(), _context()

    # database.read: доступ к боту есть
    assert await decorators.check_user_access(update, context) is True
    # database.write: работы/перемещения запрещены
    assert (
        await decorators.check_user_access(update, context, permission=PERM_DATABASE_WRITE)
        is False
    )


@pytest.mark.asyncio
async def test_deactivation_revokes_access_despite_cached_allowlist(monkeypatch):
    """Кэш allowlist (24ч) не должен обходить проверку is_active."""
    _set_gate(monkeypatch, allowed_users=("424242",))
    state = {"active": True}

    def _resolve(_tid):
        return {**_OPERATOR, "is_active": state["active"]}

    monkeypatch.setattr(decorators, "resolve_hub_user", _resolve)
    update, context = _update(), _context()
    assert await decorators.check_user_access(update, context) is True

    state["active"] = False
    assert await decorators.check_user_access(update, context) is False


@pytest.mark.asyncio
async def test_require_hub_user_flag_restores_legacy_gate(monkeypatch):
    """TELEGRAM_REQUIRE_HUB_USER=0 — аварийный откат без привязки."""
    _set_gate(monkeypatch, allowed_users=("424242",), require_hub_user=False)

    def _boom(_tid):
        raise AssertionError("hub binding must not be consulted in legacy mode")

    monkeypatch.setattr(decorators, "resolve_hub_user", _boom)

    assert await decorators.check_user_access(_update(), _context()) is True


@pytest.mark.asyncio
async def test_unauthorized_user_denied_before_hub_lookup(monkeypatch):
    _set_gate(monkeypatch, allowed_users=(), group_id="")
    resolver = Mock(return_value=dict(_OPERATOR))
    monkeypatch.setattr(decorators, "resolve_hub_user", resolver)

    assert await decorators.check_user_access(_update(), _context()) is False
    resolver.assert_not_called()


def test_resolve_hub_user_from_local_store(monkeypatch):
    monkeypatch.setattr(hub_binding, "_use_app_database", lambda: False)
    monkeypatch.setattr(
        hub_binding,
        "_load_from_local_store",
        lambda tid: dict(_OPERATOR) if tid == 424242 else None,
    )

    assert resolve_hub_user(424242)["username"] == "operator1"
    assert resolve_hub_user(1) is None


def test_resolve_hub_user_lookup_failure_is_fail_closed(monkeypatch):
    monkeypatch.setattr(hub_binding, "_use_app_database", lambda: False)

    def _boom(_tid):
        raise RuntimeError("store unavailable")

    monkeypatch.setattr(hub_binding, "_load_from_local_store", _boom)

    assert resolve_hub_user(424242) is None


def test_local_store_reader_matches_telegram_id_and_skips_junk(monkeypatch):
    users = [
        {"id": 1, "telegram_id": None},
        {"id": 2, "telegram_id": "not-a-number"},
        {"id": 3, "username": "u3", "telegram_id": 424242, "is_active": False},
    ]
    monkeypatch.setattr(
        "bot.local_json_store.load_json_data", lambda *a, **k: users
    )

    found = hub_binding._load_from_local_store(424242)
    assert found is not None and found["id"] == 3 and found["is_active"] is False
    assert hub_binding._load_from_local_store(1) is None


def test_hub_user_has_permission_uses_portal_role_matrix():
    assert hub_user_has_permission(_OPERATOR, PERM_DATABASE_READ) is True
    assert hub_user_has_permission(_OPERATOR, PERM_DATABASE_WRITE) is True
    assert hub_user_has_permission(_READ_ONLY, PERM_DATABASE_READ) is True
    assert hub_user_has_permission(_READ_ONLY, PERM_DATABASE_WRITE) is False
    assert hub_user_has_permission({**_OPERATOR, "role": "viewer"}, PERM_DATABASE_READ) is False
    assert hub_user_has_permission(None, PERM_DATABASE_READ) is False
