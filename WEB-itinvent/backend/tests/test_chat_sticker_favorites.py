"""Recents merge-sync + uniform sticker entitlement tests.

Boundary-level coverage of ``backend.chat.telegram_sticker_service`` on a real
SQLite chat schema (unit tests are justified here: merge semantics are an
offline state machine across devices, the ACL is a permission matrix, and the
last test exercises an Alembic upgrade/downgrade — all listed as unit-test
exceptions in AGENTS.md).

Uniform entitlement under test: a sticker is referenceable when its pack is
installed for the user OR the sticker is one of the user's favorites OR a copy
was sent into a conversation where the user is an active member
(``sticker-{id}--{pack}`` attachment names written by ``send_sticker``).
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

import backend.chat.telegram_sticker_service as sticker_module
from backend.chat.models import (
    Base,
    ChatConversation,
    ChatMember,
    ChatMessage,
    ChatMessageAttachment,
    ChatSticker,
    ChatStickerPack,
    ChatUserFavoriteSticker,
    ChatUserRecentSticker,
    ChatUserRecentStickerState,
    ChatUserStickerPack,
)
from backend.chat.telegram_sticker_service import TelegramStickerService


USER_A = 101
USER_B = 202


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _new_id() -> str:
    return str(uuid4())


def _recent_ids(payload: dict) -> list[str]:
    return [str(item["id"]) for item in payload["items"]]


@pytest.fixture()
def sticker_env(tmp_path, monkeypatch):
    """Service instance + SQLite session wiring + seeding helpers."""
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'chat.db').as_posix()}",
        future=True,
    ).execution_options(
        schema_translate_map={"chat": None, "app": None, "system": None}
    )
    Base.metadata.create_all(engine)
    session_factory = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )

    @contextmanager
    def session_cm():
        session = session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    monkeypatch.setattr(sticker_module, "chat_read_session", session_cm)
    monkeypatch.setattr(sticker_module, "chat_write_session", session_cm)
    service = TelegramStickerService(
        storage_root=tmp_path / "packs",
        token_getter=lambda: "test-token",
    )
    return SimpleNamespace(
        service=service,
        session=session_cm,
        storage_root=service._storage_root,
        engine=engine,
    )


def _seed_pack(env, *, pack_id: str, short_name: str) -> None:
    with env.session() as session:
        session.add(
            ChatStickerPack(
                id=pack_id,
                short_name=short_name,
                title=short_name,
                sticker_type="regular",
                created_at=_now(),
                updated_at=_now(),
            )
        )


def _seed_stickers(env, *, pack_id: str, sticker_ids: list[str]) -> None:
    with env.session() as session:
        for index, sticker_id in enumerate(sticker_ids):
            session.add(
                ChatSticker(
                    id=sticker_id,
                    pack_id=pack_id,
                    telegram_file_id=f"tfid-{sticker_id}",
                    telegram_file_unique_id=f"tfuid-{sticker_id}",
                    emoji="🙂",
                    format="static",
                    mime_type="image/webp",
                    storage_name=f"{sticker_id}.webp",
                    file_size=100 + index,
                    width=512,
                    height=512,
                    sort_order=index,
                    created_at=_now(),
                )
            )


def _install_pack(env, *, user_id: int, pack_id: str) -> None:
    with env.session() as session:
        session.add(
            ChatUserStickerPack(
                user_id=int(user_id),
                pack_id=pack_id,
                added_at=_now(),
            )
        )


def _uninstall_pack(env, *, user_id: int, pack_id: str) -> None:
    with env.session() as session:
        row = session.execute(
            select(ChatUserStickerPack).where(
                ChatUserStickerPack.user_id == int(user_id),
                ChatUserStickerPack.pack_id == pack_id,
            )
        ).scalar_one_or_none()
        assert row is not None
        session.delete(row)


def _seed_sticker_message_copy(
    env,
    *,
    sticker_id: str,
    pack_short_name: str,
    conversation_id: str,
    member_user_ids: list[int],
) -> None:
    """Attach a ``sticker-{id}--{pack}`` copy into a conversation — the same
    marker ``send_sticker`` writes when a sticker is delivered."""
    now = _now()
    message_id = _new_id()
    attachment_id = _new_id()
    file_name = f"sticker-{sticker_id}--{pack_short_name}.webp"
    with env.session() as session:
        session.add(
            ChatConversation(
                id=conversation_id,
                kind="group",
                created_by_user_id=member_user_ids[0],
                created_at=now,
                updated_at=now,
            )
        )
        for member_id in member_user_ids:
            session.add(
                ChatMember(
                    conversation_id=conversation_id,
                    user_id=int(member_id),
                    member_role="member",
                    joined_at=now,
                )
            )
        session.add(
            ChatMessage(
                id=message_id,
                conversation_id=conversation_id,
                sender_user_id=member_user_ids[0],
                kind="file",
                body_format="plain",
                body="",
                created_at=now,
            )
        )
        session.add(
            ChatMessageAttachment(
                id=attachment_id,
                message_id=message_id,
                conversation_id=conversation_id,
                storage_name=f"{attachment_id}_{file_name}",
                file_name=file_name,
                mime_type="image/webp",
                media_kind="sticker",
                file_size=10,
                uploaded_by_user_id=member_user_ids[0],
                created_at=now,
            )
        )


def _write_sticker_file(env, *, pack_id: str, sticker_id: str) -> None:
    pack_dir = env.storage_root / pack_id
    pack_dir.mkdir(parents=True, exist_ok=True)
    (pack_dir / f"{sticker_id}.webp").write_bytes(b"webp-bytes")


# ---------------------------------------------------------------------------
# Recents: versioned merge-sync
# ---------------------------------------------------------------------------


def test_recents_merge_keeps_both_devices_entries(sticker_env):
    """Device A pushes [s1,s2,s3]; device B pushes [s4,s1] — the merged rail
    keeps B's ids in front and A's remainder appended, nothing is lost."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2, s3, s4 = _new_id(), _new_id(), _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2, s3, s4])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    first = svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1, s2, s3])
    assert _recent_ids(first) == [s1, s2, s3]
    assert first["version"] == 1

    second = svc.replace_recent_stickers(
        current_user_id=USER_A,
        sticker_ids=[s4, s1],
        base_version=first["version"],
    )
    assert _recent_ids(second) == [s4, s1, s2, s3]
    assert second["version"] == 2

    fetched = svc.list_recent_stickers(current_user_id=USER_A)
    assert _recent_ids(fetched) == [s4, s1, s2, s3]
    assert fetched["version"] == 2


def test_recents_stale_base_version_still_merges_and_bumps(sticker_env):
    """A PUT carrying an outdated base_version is merged, not rejected."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2 = _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1])
    stale = svc.replace_recent_stickers(
        current_user_id=USER_A,
        sticker_ids=[s2],
        base_version=0,  # stale — server is already at 1
    )
    assert _recent_ids(stale) == [s2, s1]
    assert stale["version"] == 2


def test_recents_empty_merge_is_noop_but_clear_empties(sticker_env):
    """Empty PUT without clear keeps server entries (a second device cannot
    wipe the rail by accident); clear:true is the explicit wipe."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2 = _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1, s2])
    merged = svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[])
    assert _recent_ids(merged) == [s1, s2]
    assert merged["version"] == 2

    cleared = svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[], clear=True)
    assert cleared["items"] == []
    assert cleared["version"] == 3

    # "cleared" is distinguishable from "never synced": version stays > 0.
    fetched = svc.list_recent_stickers(current_user_id=USER_A)
    assert fetched["items"] == []
    assert fetched["version"] == 3


def test_recents_clear_with_ids_replaces_exactly(sticker_env):
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2, s3 = _new_id(), _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2, s3])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1, s2])
    replaced = svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s3], clear=True)
    assert _recent_ids(replaced) == [s3]
    assert replaced["version"] == 2


def test_recents_version_zero_before_first_sync(sticker_env):
    fetched = sticker_env.service.list_recent_stickers(current_user_id=USER_A)
    assert fetched == {"items": [], "version": 0}


def test_recents_two_sequential_puts_both_reflected(sticker_env):
    """Sequential PUTs serialize on the per-user state row: each merges on top
    of the previous result instead of last-write-wins data loss."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2, s3 = _new_id(), _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2, s3])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1, s2])
    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s3])
    fetched = svc.list_recent_stickers(current_user_id=USER_A)
    assert _recent_ids(fetched) == [s3, s1, s2]
    assert fetched["version"] == 2


# ---------------------------------------------------------------------------
# Uniform entitlement: recents PUT/GET filter
# ---------------------------------------------------------------------------


def test_recents_put_drops_unknown_and_inaccessible_ids(sticker_env):
    """s3 lives in a pack the user never installed and never received — the
    PUT accepts it silently but it never reaches the rail."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    _seed_pack(sticker_env, pack_id="pack-2", short_name="p2")
    s1, s2, s3 = _new_id(), _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2])
    _seed_stickers(sticker_env, pack_id="pack-2", sticker_ids=[s3])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    payload = svc.replace_recent_stickers(
        current_user_id=USER_A,
        sticker_ids=[s1, "definitely-not-a-sticker", s3],
    )
    assert _recent_ids(payload) == [s1]

    with sticker_env.session() as session:
        stored = session.execute(
            select(ChatUserRecentSticker.sticker_id).where(
                ChatUserRecentSticker.user_id == USER_A
            )
        ).scalars().all()
    assert stored == [s1]


def test_recents_get_filters_entries_that_lost_access(sticker_env):
    """After uninstalling the pack, a recents entry that is not favorited and
    never received disappears from GET (row kept — it reappears if access is
    regained), while the favorited one stays."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1, s2 = _new_id(), _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1, s2])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    svc.replace_recent_stickers(current_user_id=USER_A, sticker_ids=[s1, s2])
    svc.add_favorite_sticker(current_user_id=USER_A, sticker_id=s2)
    _uninstall_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    fetched = svc.list_recent_stickers(current_user_id=USER_A)
    assert _recent_ids(fetched) == [s2]


def test_recents_received_copy_grants_reference(sticker_env):
    """Leg 3: user B has no install and no favorite but received the sticker
    in a shared conversation — recents PUT accepts it."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")
    _seed_sticker_message_copy(
        sticker_env,
        sticker_id=s1,
        pack_short_name="p1",
        conversation_id="conv-1",
        member_user_ids=[USER_A, USER_B],
    )

    payload = svc.replace_recent_stickers(current_user_id=USER_B, sticker_ids=[s1])
    assert _recent_ids(payload) == [s1]


# ---------------------------------------------------------------------------
# Uniform entitlement: favorites + file serving
# ---------------------------------------------------------------------------


def test_favorite_requires_access_install_or_received(sticker_env):
    """Pack installed only for user A: B cannot favorite the sticker until it
    reaches a shared conversation."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    with pytest.raises(LookupError):
        svc.add_favorite_sticker(current_user_id=USER_B, sticker_id=s1)
    assert svc.list_favorite_stickers(current_user_id=USER_B)["items"] == []

    assert _recent_ids(svc.add_favorite_sticker(current_user_id=USER_A, sticker_id=s1)) == [s1]

    _seed_sticker_message_copy(
        sticker_env,
        sticker_id=s1,
        pack_short_name="p1",
        conversation_id="conv-1",
        member_user_ids=[USER_A, USER_B],
    )
    assert _recent_ids(svc.add_favorite_sticker(current_user_id=USER_B, sticker_id=s1)) == [s1]


def test_favorites_survive_uninstall_and_keep_file_access(sticker_env):
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")
    _write_sticker_file(sticker_env, pack_id="pack-1", sticker_id=s1)

    svc.add_favorite_sticker(current_user_id=USER_A, sticker_id=s1)
    _uninstall_pack(sticker_env, user_id=USER_A, pack_id="pack-1")

    assert _recent_ids(svc.list_favorite_stickers(current_user_id=USER_A)) == [s1]
    item = svc.get_sticker_file(current_user_id=USER_A, sticker_id=s1)
    assert item["file_name"] == f"{s1}.webp"


def test_sticker_file_serving_follows_uniform_entitlement(sticker_env):
    """File serving: installed -> ok; stranger -> 404; received copy -> ok
    (the same three legs as favorites and recents)."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")
    _write_sticker_file(sticker_env, pack_id="pack-1", sticker_id=s1)

    assert svc.get_sticker_file(current_user_id=USER_A, sticker_id=s1)["file_name"] == f"{s1}.webp"
    with pytest.raises(LookupError):
        svc.get_sticker_file(current_user_id=USER_B, sticker_id=s1)

    _seed_sticker_message_copy(
        sticker_env,
        sticker_id=s1,
        pack_short_name="p1",
        conversation_id="conv-1",
        member_user_ids=[USER_A, USER_B],
    )
    assert svc.get_sticker_file(current_user_id=USER_B, sticker_id=s1)["file_name"] == f"{s1}.webp"


def test_user_cannot_reference_sticker_via_wildcard_like_input(sticker_env):
    """A crafted sticker_id containing LIKE wildcards cannot widen the grant:
    the extracted id from attachment names is intersected with requested ids."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")
    _seed_sticker_message_copy(
        sticker_env,
        sticker_id=s1,
        pack_short_name="p1",
        conversation_id="conv-1",
        member_user_ids=[USER_A, USER_B],
    )
    # B has a member conversation with *some* sticker copy, but the wildcard
    # id itself is not a real sticker id and must not match.
    with pytest.raises(LookupError):
        svc.get_sticker_file(current_user_id=USER_B, sticker_id="%")
    payload = svc.replace_recent_stickers(current_user_id=USER_B, sticker_ids=["%"])
    assert payload["items"] == []


def test_favorite_delete_still_scoped_to_owner(sticker_env):
    """IDOR regression: deleting removes only the caller's own favorite row."""
    svc = sticker_env.service
    _seed_pack(sticker_env, pack_id="pack-1", short_name="p1")
    s1 = _new_id()
    _seed_stickers(sticker_env, pack_id="pack-1", sticker_ids=[s1])
    _install_pack(sticker_env, user_id=USER_A, pack_id="pack-1")
    _install_pack(sticker_env, user_id=USER_B, pack_id="pack-1")

    svc.add_favorite_sticker(current_user_id=USER_A, sticker_id=s1)
    svc.add_favorite_sticker(current_user_id=USER_B, sticker_id=s1)
    svc.remove_favorite_sticker(current_user_id=USER_A, sticker_id=s1)

    assert svc.list_favorite_stickers(current_user_id=USER_A)["items"] == []
    assert _recent_ids(svc.list_favorite_stickers(current_user_id=USER_B)) == [s1]


# ---------------------------------------------------------------------------
# Alembic 0177 -> 0178 upgrade/downgrade on SQLite
# ---------------------------------------------------------------------------


def test_0178_upgrade_preserves_recents_and_downgrade_works(tmp_path):
    """A database already at 0177 with seeded favorites/recents keeps its rows
    when 0178 adds chat_user_recent_sticker_state; downgrade removes only the
    new table, and 0177's own downgrade still drops favorites/recents."""
    from alembic import command
    import sqlalchemy as sa

    from backend.db_migrations import build_alembic_config

    url = f"sqlite:///{(tmp_path / 'mig.db').as_posix()}"
    engine = create_engine(url, future=True).execution_options(
        schema_translate_map={"chat": None, "app": None, "system": None}
    )
    # Schema as of 0176: everything except the tables 0178/0179 create.
    post_0176_tables = {
        "chat_user_favorite_stickers",
        "chat_user_recent_stickers",
        "chat_user_recent_sticker_state",
    }
    Base.metadata.create_all(
        engine,
        tables=[t for t in Base.metadata.sorted_tables if t.name not in post_0176_tables],
    )
    cfg = build_alembic_config(url, scope="chat")
    command.stamp(cfg, "20261118_0176")
    command.upgrade(cfg, "20261124_0178")

    pack_id = _new_id()
    sticker_id = _new_id()
    now = _now()
    with sessionmaker(bind=engine, expire_on_commit=False)() as session:
        session.add(
            ChatStickerPack(
                id=pack_id,
                short_name="seedpack",
                title="seedpack",
                sticker_type="regular",
                created_at=now,
                updated_at=now,
            )
        )
        session.add(
            ChatSticker(
                id=sticker_id,
                pack_id=pack_id,
                telegram_file_id="tfid",
                telegram_file_unique_id="tfuid",
                emoji="🙂",
                format="static",
                mime_type="image/webp",
                storage_name=f"{sticker_id}.webp",
                file_size=10,
                sort_order=0,
                created_at=now,
            )
        )
        session.add(
            ChatUserRecentSticker(
                user_id=USER_A,
                sticker_id=sticker_id,
                position=0,
                updated_at=now,
            )
        )
        session.add(
            ChatUserFavoriteSticker(
                user_id=USER_A,
                sticker_id=sticker_id,
                added_at=now,
            )
        )
        session.commit()

    command.upgrade(cfg, "head")

    inspector = sa.inspect(engine)
    assert inspector.has_table("chat_user_recent_sticker_state")
    with engine.connect() as connection:
        recents = connection.execute(
            sa.text("SELECT sticker_id FROM chat_user_recent_stickers WHERE user_id = :u"),
            {"u": USER_A},
        ).scalars().all()
        favorites = connection.execute(
            sa.text("SELECT sticker_id FROM chat_user_favorite_stickers WHERE user_id = :u"),
            {"u": USER_A},
        ).scalars().all()
    assert recents == [sticker_id]
    assert favorites == [sticker_id]

    # 0179 downgrade: only the state table goes away.
    command.downgrade(cfg, "20261124_0178")
    inspector = sa.inspect(engine)
    assert not inspector.has_table("chat_user_recent_sticker_state")
    assert inspector.has_table("chat_user_recent_stickers")

    # 0178 downgrade still drops its own tables.
    command.downgrade(cfg, "20261124_0177")
    inspector = sa.inspect(engine)
    assert not inspector.has_table("chat_user_recent_stickers")
    assert not inspector.has_table("chat_user_favorite_stickers")

    # Re-upgrade restores the whole chain.
    command.upgrade(cfg, "head")
    inspector = sa.inspect(engine)
    for table_name in post_0176_tables:
        assert inspector.has_table(table_name), table_name
