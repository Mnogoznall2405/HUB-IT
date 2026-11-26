"""PR #69 sticker migrations + op-batch dedup gate on isolated PostgreSQL.

Gated on env `AI_RUN_TEST_DATABASE_URL` (must be postgresql://...) — same
convention as tests/test_pg_a8_gate.py / test_ai_run_serialization_pg.py.
All work happens on a scratch database ``stgt_*`` created on the fly;
nothing touches the database named in the URL itself beyond admin
CREATE/DROP DATABASE, and production ``hubit_chat`` is never a target.

Coverage (release gate for the post-main consolidated chain):
  * fresh install upgrade to head on a scratch database: creates
    ``chat_user_favorite_stickers``, ``chat_user_recent_stickers``,
    ``chat_user_recent_sticker_state`` (+ ``applied_op_batch_ids``) and the
    ``chat_user_sticker_packs.position`` column, with exactly one Alembic head;
  * production-plausible upgrade paths from ``20261124_0177`` and from the
    My Files-side ``20261124_0179`` to head, preserving a pre-existing
    ``chat_user_sticker_packs`` install row while adding ``position``;
  * op-batch dedup on real PostgreSQL: a replayed ``op_batch_id`` under
    ``FOR UPDATE`` is a no-op (same version, unchanged rail);
  * concurrent-ops smoke: two threads racing ``PUT``-equivalent service
    calls serialize on the state row — both deltas land, version is 3;
  * sticker-only downgrade to ``20261124_0179`` drops the dedup column and
    all three sticker tables, then re-upgrade restores them.
"""
from __future__ import annotations

import os
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import pytest
import sqlalchemy as sa
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

psycopg = pytest.importorskip("psycopg")

TEST_URL = os.environ.get("AI_RUN_TEST_DATABASE_URL", "").strip()
if not (TEST_URL.startswith("postgresql://") or TEST_URL.startswith("postgresql+")):
    pytest.skip("AI_RUN_TEST_DATABASE_URL not set to a postgresql:// URL", allow_module_level=True)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("JWT_SECRET_KEY", "pg-sticker-gate-test")
os.environ.setdefault("SKIP_PG_SCHEMA_DOCS", "1")

from backend.db_migrations import build_alembic_config, upgrade_internal_database  # noqa: E402

from alembic import command  # noqa: E402

USER_ID = 424242


def _admin_conninfo() -> str:
    """libpq conninfo for the maintenance 'postgres' database."""
    url = make_url(TEST_URL)
    return url.set(drivername="postgresql", database="postgres").render_as_string(hide_password=False)


def _db_url(name: str) -> str:
    url = make_url(TEST_URL)
    return url.set(database=name).render_as_string(hide_password=False)


def _create_db(name: str) -> None:
    with psycopg.connect(_admin_conninfo(), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{name}"')
        conn.execute(f'CREATE DATABASE "{name}"')


def _drop_db(name: str) -> None:
    try:
        with psycopg.connect(_admin_conninfo(), autocommit=True) as conn:
            conn.execute(f'DROP DATABASE IF EXISTS "{name}"')
    except Exception:
        pass


def _cols(db_url: str, table: str, schema: str) -> set[str]:
    eng = sa.create_engine(db_url)
    try:
        with eng.connect() as c:
            return {r[0] for r in c.execute(sa.text(
                "select column_name from information_schema.columns "
                "where table_schema=:s and table_name=:t"),
                {"s": schema, "t": table})}
    finally:
        eng.dispose()


def _tables(db_url: str, schema: str) -> set[str]:
    eng = sa.create_engine(db_url)
    try:
        with eng.connect() as c:
            return {r[0] for r in c.execute(sa.text(
                "select table_name from information_schema.tables where table_schema=:s"),
                {"s": schema})}
    finally:
        eng.dispose()


def _recent_ids(payload: dict) -> list[str]:
    return [str(item["id"]) for item in payload["items"]]


def _sticker_service_on_pg(db_url: str, tmp_path):
    """TelegramStickerService bound to the scratch PG chat schema.

    Same wiring as the sqlite ``sticker_env`` fixture, but on the real
    PostgreSQL dialect so the ``FOR UPDATE`` row lock genuinely serializes.
    """
    import backend.chat.telegram_sticker_service as sticker_module
    from backend.chat.models import (
        ChatSticker,
        ChatStickerPack,
        ChatUserStickerPack,
    )
    from backend.chat.telegram_sticker_service import TelegramStickerService

    engine = sa.create_engine(db_url, future=True)
    session_factory = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False,
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

    monkeypatches = (
        ("chat_read_session", sticker_module.chat_read_session),
        ("chat_write_session", sticker_module.chat_write_session),
    )
    sticker_module.chat_read_session = session_cm
    sticker_module.chat_write_session = session_cm

    service = TelegramStickerService(
        storage_root=tmp_path / "packs",
        token_getter=lambda: "pg-gate-token",
    )
    now = datetime.now(timezone.utc)
    pack_id = str(uuid.uuid4())
    sticker_ids = [str(uuid.uuid4()) for _ in range(4)]
    with session_cm() as session:
        session.add(ChatStickerPack(
            id=pack_id, short_name="pg_gate_pack", title="pg_gate_pack",
            sticker_type="regular", created_at=now, updated_at=now,
        ))
    with session_cm() as session:
        for index, sticker_id in enumerate(sticker_ids):
            session.add(ChatSticker(
                id=sticker_id, pack_id=pack_id,
                telegram_file_id=f"tfid-{index}",
                telegram_file_unique_id=f"tfuid-{index}",
                emoji="🙂", format="static", mime_type="image/webp",
                storage_name=f"{sticker_id}.webp", file_size=10,
                width=512, height=512, sort_order=index, created_at=now,
            ))
        session.add(ChatUserStickerPack(
            user_id=USER_ID, pack_id=pack_id, added_at=now,
        ))
    return service, engine, monkeypatches, sticker_module, sticker_ids


def test_sticker_migration_and_ops_gate(tmp_path):
    db_name = f"stgt_{uuid.uuid4().hex[:8]}"
    _create_db(db_name)
    db_url = _db_url(db_name)
    engine = None
    try:
        # Fresh chat-scope schema to head on real PostgreSQL.
        upgrade_internal_database(db_url, "head", scope="chat")
        chat_tables = _tables(db_url, "chat")
        for table_name in (
            "chat_user_favorite_stickers",
            "chat_user_recent_stickers",
            "chat_user_recent_sticker_state",
            "chat_user_sticker_packs",
        ):
            assert table_name in chat_tables, table_name
        assert "position" in _cols(db_url, "chat_user_sticker_packs", "chat")
        assert "applied_op_batch_ids" in _cols(
            db_url, "chat_user_recent_sticker_state", "chat",
        )
        # The database sits at a real alembic head of the code.
        from alembic.script import ScriptDirectory

        cfg = build_alembic_config(db_url, scope="chat")
        expected_heads = set(ScriptDirectory.from_config(cfg).get_heads())
        rev = sa.create_engine(db_url)
        with rev.connect() as c:
            head = c.execute(sa.text(
                "select version_num from system.alembic_version")).scalar_one()
        rev.dispose()
        assert len(expected_heads) == 1, f"alembic graph must have one head, got {expected_heads}"
        assert head in expected_heads, f"db head {head} not in code heads {expected_heads}"

        service, engine, monkeypatches, sticker_module, sticker_ids = (
            _sticker_service_on_pg(db_url, tmp_path)
        )
        s1, s2, s3, _unused = sticker_ids
        try:
            # Op-batch dedup on real PG: replayed batch = no-op.
            first = service.replace_recent_stickers(
                current_user_id=USER_ID,
                ops=[{"op": "bump", "sticker_id": s1}],
                op_batch_id="pg-gate-batch-1",
            )
            assert first["version"] == 1
            replay = service.replace_recent_stickers(
                current_user_id=USER_ID,
                ops=[{"op": "bump", "sticker_id": s1}],
                op_batch_id="pg-gate-batch-1",
            )
            assert replay["version"] == 1
            assert _recent_ids(replay) == [s1]

            # Concurrent-ops smoke: two threads race PUT-equivalent calls —
            # the FOR UPDATE state row serializes them; both deltas land.
            barrier = threading.Barrier(2)
            results: list[dict] = [None, None]
            errors: list[Exception] = []

            def _worker(index: int, sticker_id: str) -> None:
                try:
                    barrier.wait(timeout=15)
                    results[index] = service.replace_recent_stickers(
                        current_user_id=USER_ID,
                        ops=[{"op": "bump", "sticker_id": sticker_id}],
                    )
                except Exception as exc:  # pragma: no cover - diagnostic
                    errors.append(exc)

            t1 = threading.Thread(target=_worker, args=(0, s2))
            t2 = threading.Thread(target=_worker, args=(1, s3))
            t1.start()
            t2.start()
            t1.join(timeout=60)
            t2.join(timeout=60)
            assert not errors, f"concurrent PUT errors: {errors}"
            assert all(item is not None for item in results)

            fetched = service.list_recent_stickers(current_user_id=USER_ID)
            assert set(_recent_ids(fetched)) == {s1, s2, s3}
            assert fetched["version"] == 3
            assert {r["version"] for r in results} == {2, 3}
        finally:
            for attr, original in monkeypatches:
                setattr(sticker_module, attr, original)
    finally:
        if engine is not None:
            engine.dispose()
        _drop_db(db_name)


def _seed_preexisting_sticker_install(db_url: str, label: str) -> str:
    """Insert one pre-V2 pack install using only columns present at 0177/0179."""
    pack_id = f"pg-path-{label}-{uuid.uuid4().hex[:8]}"
    engine = sa.create_engine(db_url)
    try:
        with engine.begin() as conn:
            conn.execute(
                sa.text(
                    "insert into chat.chat_sticker_packs "
                    "(id, short_name, title, sticker_type, created_at, updated_at) "
                    "values (:id, :short_name, :title, 'regular', now(), now())"
                ),
                {"id": pack_id, "short_name": pack_id, "title": pack_id},
            )
            conn.execute(
                sa.text(
                    "insert into chat.chat_user_sticker_packs "
                    "(user_id, pack_id, added_at) values (:user_id, :pack_id, now())"
                ),
                {"user_id": USER_ID, "pack_id": pack_id},
            )
    finally:
        engine.dispose()
    return pack_id


def _assert_sticker_install_preserved(db_url: str, pack_id: str) -> None:
    engine = sa.create_engine(db_url)
    try:
        with engine.connect() as conn:
            row = conn.execute(
                sa.text(
                    "select user_id, position from chat.chat_user_sticker_packs "
                    "where pack_id=:pack_id"
                ),
                {"pack_id": pack_id},
            ).one()
    finally:
        engine.dispose()
    assert row.user_id == USER_ID
    assert row.position == 0


@pytest.mark.parametrize("start_revision", ["20261124_0177", "20261124_0179"])
def test_sticker_upgrade_paths_preserve_preexisting_install(tmp_path, start_revision):
    """Upgrade from both production-plausible parents of the consolidated chain.

    ``0177`` is the pre-My-Files state; ``0179`` is the My Files-side state.
    In chat scope the interleaved app revisions are no-ops, but the alembic
    version walk still exercises the exact consolidated graph ordering.
    """
    db_name = f"stgt_{uuid.uuid4().hex[:8]}"
    _create_db(db_name)
    db_url = _db_url(db_name)
    try:
        upgrade_internal_database(db_url, start_revision, scope="chat")
        assert "position" not in _cols(db_url, "chat_user_sticker_packs", "chat")
        pack_id = _seed_preexisting_sticker_install(db_url, start_revision[-4:])

        upgrade_internal_database(db_url, "head", scope="chat")
        _assert_sticker_install_preserved(db_url, pack_id)
        assert "applied_op_batch_ids" in _cols(
            db_url, "chat_user_recent_sticker_state", "chat",
        )

        engine = sa.create_engine(db_url)
        try:
            with engine.connect() as conn:
                assert conn.execute(
                    sa.text("select version_num from system.alembic_version")
                ).scalar_one() == "20261125_0182"
        finally:
            engine.dispose()
    finally:
        _drop_db(db_name)


def test_sticker_downgrade_to_0179(tmp_path):
    """head -> 0179 removes only the sticker-V2 additive objects; re-upgrade works."""
    db_name = f"stgt_{uuid.uuid4().hex[:8]}"
    _create_db(db_name)
    db_url = _db_url(db_name)
    try:
        upgrade_internal_database(db_url, "head", scope="chat")
        cfg = build_alembic_config(db_url, scope="chat")
        command.downgrade(cfg, "20261124_0179")
        chat_tables = _tables(db_url, "chat")
        for table_name in (
            "chat_user_favorite_stickers",
            "chat_user_recent_stickers",
            "chat_user_recent_sticker_state",
        ):
            assert table_name not in chat_tables, table_name
        assert "position" not in _cols(db_url, "chat_user_sticker_packs", "chat")

        # Re-upgrade restores the whole sticker chain including the dedup column.
        upgrade_internal_database(db_url, "head", scope="chat")
        assert "applied_op_batch_ids" in _cols(
            db_url, "chat_user_recent_sticker_state", "chat",
        )
    finally:
        _drop_db(db_name)
