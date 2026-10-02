#!/usr/bin/env python3
"""AG-3: merge legacy AI bots into the unified corp-assistant (HUB Ассистент).

Rebinds every ``app.ai_bot_conversations.bot_id`` that still points at a legacy
bot (``general-ai``, ``document-converter``, ``it-helper``, ``new-ai-bot``) to the
``corp-assistant`` bot, then disables the legacy bots (``is_enabled=False``,
``placement='hidden'``). Conversation history is preserved in place — only the
mapping rows are re-pointed, no chat messages are touched.

R31: the corp-assistant bot user must be a member of every moved conversation,
otherwise ``chat_service.send_message`` rejects its answers with
``Conversation access denied``. Before each mapping batch the script therefore
adds (idempotently, resetting ``left_at``) a ``chat_members`` row (role ``bot``)
and a ``chat_conversation_user_state`` row for the corp-assistant bot user.
The dry-run prints how many participants would be added. OpenCode
(``surface=sandbox``) is never moved: it is not in the legacy list.

Usage (on the release contour, APP_DATABASE_URL must point at the app DB):

    # Dry run (default) — prints the plan, changes nothing:
    python -m backend.scripts.merge_ai_bots_into_corp_assistant

    # Apply in batches of 200 (APP_DATABASE_URL and CHAT_DATABASE_URL must point
    # at the intended databases; the script never reads them from anywhere else):
    python -m backend.scripts.merge_ai_bots_into_corp_assistant --apply --batch-size 200

The script is idempotent: a second ``--apply`` moves nothing and leaves the
bots disabled/hidden.

Conflict rule: ``ai_bot_conversations.conversation_id`` is unique, so normally a
conversation maps to exactly one bot. If a row ever exists where the same
``conversation_id`` is already mapped to ``corp-assistant`` (e.g. a database
without the unique constraint), the legacy row is skipped and logged instead of
creating a duplicate mapping.

Rollback: before ``--apply`` take a table backup, e.g.
``pg_dump --table=app.ai_bot_conversations --data-only <db> > ai_bot_conversations.bak.sql``.
In apply mode every moved row is printed as ``[move] id=<pk> conversation_id=<id>
<old_slug> -> corp-assistant``; to roll back without the backup, run
``UPDATE app.ai_bot_conversations SET bot_id='<legacy bot id>' WHERE id IN (<pk list>)``
per printed line, then re-enable the legacy bots
(``UPDATE app.ai_bots SET is_enabled=TRUE, placement='pinned' WHERE slug IN (...)``).
Restore the saved table for a byte-exact rollback. Added ``chat_members`` rows of the
corp-assistant bot user are harmless and may stay (they can be recognised by
``member_role='bot'`` and the corp-assistant ``bot_user_id``).
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[3]
for import_root in (WEB_ROOT, REPO_ROOT):
    if str(import_root) not in sys.path:
        sys.path.insert(0, str(import_root))

from sqlalchemy import or_, select, update  # noqa: E402

from backend.appdb.db import app_session, ensure_app_schema_initialized  # noqa: E402
from backend.appdb.models import AppAiBot, AppAiBotConversation  # noqa: E402
from backend.chat.db import chat_session  # noqa: E402
from backend.chat.models import ChatConversation, ChatConversationUserState, ChatMember  # noqa: E402

TARGET_BOT_SLUG = "corp-assistant"
LEGACY_BOT_SLUGS = ("general-ai", "document-converter", "it-helper", "new-ai-bot")


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _chunks(items: list, size: int) -> list[list]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def _count_members_to_add(
    *, chat_database_url: str | None, bot_user_id: int, conversation_ids: list[str], batch_size: int
) -> tuple[int, int]:
    """(participants to add, conversations missing in the chat DB) - read only."""
    existing_conversations: set[str] = set()
    active_members: set[str] = set()
    for chunk in _chunks(conversation_ids, batch_size):
        with chat_session(chat_database_url) as chat_db:
            existing_conversations.update(
                chat_db.execute(select(ChatConversation.id).where(ChatConversation.id.in_(chunk))).scalars()
            )
            if bot_user_id > 0:
                active_members.update(
                    chat_db.execute(
                        select(ChatMember.conversation_id).where(
                            ChatMember.conversation_id.in_(chunk),
                            ChatMember.user_id == int(bot_user_id),
                            ChatMember.left_at.is_(None),
                        )
                    ).scalars()
                )
    to_add = existing_conversations - active_members
    return len(to_add), len(set(conversation_ids) - existing_conversations)


def _ensure_members(
    *, chat_database_url: str | None, bot_user_id: int, conversation_ids: list[str]
) -> int:
    """Idempotently add / re-activate the bot user in the given conversations."""
    now = _utc_now()
    changed = 0
    with chat_session(chat_database_url) as chat_db:
        existing_conversations = set(
            chat_db.execute(select(ChatConversation.id).where(ChatConversation.id.in_(conversation_ids))).scalars()
        )
        members = {
            row.conversation_id: row
            for row in chat_db.execute(
                select(ChatMember).where(
                    ChatMember.conversation_id.in_(conversation_ids),
                    ChatMember.user_id == int(bot_user_id),
                )
            ).scalars()
        }
        states = set(
            chat_db.execute(
                select(ChatConversationUserState.conversation_id).where(
                    ChatConversationUserState.conversation_id.in_(conversation_ids),
                    ChatConversationUserState.user_id == int(bot_user_id),
                )
            ).scalars()
        )
        for conversation_id in conversation_ids:
            if conversation_id not in existing_conversations:
                continue
            member = members.get(conversation_id)
            if member is None:
                chat_db.add(
                    ChatMember(
                        conversation_id=conversation_id,
                        user_id=int(bot_user_id),
                        member_role="bot",
                        joined_at=now,
                    )
                )
                changed += 1
            elif member.left_at is not None:
                member.left_at = None
                changed += 1
            if conversation_id not in states:
                chat_db.add(
                    ChatConversationUserState(
                        conversation_id=conversation_id,
                        user_id=int(bot_user_id),
                        updated_at=now,
                    )
                )
    return changed


def run_merge(
    *,
    database_url: str | None = None,
    chat_database_url: str | None = None,
    apply: bool = False,
    batch_size: int = 200,
    out=print,
) -> dict[str, object]:
    """Rebind legacy-bot conversations to corp-assistant. Returns a summary."""
    ensure_app_schema_initialized(database_url)
    batch_size = max(1, int(batch_size or 200))
    with app_session(database_url) as session:
        bots = {
            _normalize_slug(item.slug): item
            for item in session.execute(
                select(AppAiBot).where(AppAiBot.slug.in_([TARGET_BOT_SLUG, *LEGACY_BOT_SLUGS]))
            ).scalars()
        }
        target = bots.get(TARGET_BOT_SLUG)
        if target is None:
            raise SystemExit(
                f"Target bot '{TARGET_BOT_SLUG}' not found — run the backend once so the seed creates it."
            )
        legacy_bots = {slug: bots[slug] for slug in LEGACY_BOT_SLUGS if slug in bots}
        legacy_ids = [bot.id for bot in legacy_bots.values()]

        rows = []
        if legacy_ids:
            rows = list(
                session.execute(
                    select(AppAiBotConversation)
                    .where(AppAiBotConversation.bot_id.in_(legacy_ids))
                    .order_by(AppAiBotConversation.id)
                ).scalars()
            )
        target_conversations = set(
            session.execute(
                select(AppAiBotConversation.conversation_id).where(
                    AppAiBotConversation.bot_id == target.id
                )
            ).scalars()
        )
        to_move: list[tuple[int, str, str]] = []  # (pk, conversation_id, old_slug)
        skipped: list[tuple[int, str]] = []
        slug_by_id = {bot.id: slug for slug, bot in legacy_bots.items()}
        for row in rows:
            old_slug = slug_by_id.get(_normalize_slug(row.bot_id), _normalize_slug(row.bot_id))
            if row.conversation_id in target_conversations:
                skipped.append((int(row.id), _normalize_slug(row.conversation_id)))
                out(
                    f"[skip] id={row.id} conversation_id={row.conversation_id} "
                    f"уже привязан к {TARGET_BOT_SLUG} — строка не тронута"
                )
                continue
            to_move.append((int(row.id), _normalize_slug(row.conversation_id), old_slug))

        bots_to_disable = [
            bot
            for bot in legacy_bots.values()
            if bool(bot.is_enabled) or _normalize_slug(bot.placement) != "hidden"
        ]

    target_bot_user_id = int(getattr(target, "bot_user_id", 0) or 0)
    moved_conversation_ids = [item[1] for item in to_move]
    members_to_add: int | None = None
    orphan_conversations = 0
    if to_move:
        try:
            members_to_add, orphan_conversations = _count_members_to_add(
                chat_database_url=chat_database_url,
                bot_user_id=target_bot_user_id,
                conversation_ids=moved_conversation_ids,
                batch_size=batch_size,
            )
        except Exception as exc:  # noqa: BLE001 - dry-run must still print the rest of the plan
            if apply:
                raise
            out(f"[warn] chat БД недоступна, число добавляемых участников не определено: {exc.__class__.__name__}")
    else:
        members_to_add = 0

    if apply and to_move and target_bot_user_id <= 0:
        # The corp-assistant bot user has never been created (fresh seed): create it
        # once through the same service helper the runtime uses.
        from backend.ai_chat.service import ai_chat_service

        with app_session(database_url) as session:
            bot_row = session.get(AppAiBot, target.id)
            target_bot_user_id = int(ai_chat_service._ensure_bot_user(session=session, bot=bot_row) or 0)
        if target_bot_user_id <= 0:
            raise SystemExit("Не удалось создать пользователя-бота corp-assistant — перенос остановлен.")

    moved = 0
    members_added = 0
    if apply and to_move:
        for chunk in _chunks([(item[0], item[1]) for item in to_move], batch_size):
            # Membership first, then the mapping: a conversation is never re-pointed
            # to a bot that cannot post into it. Both steps are idempotent.
            members_added += _ensure_members(
                chat_database_url=chat_database_url,
                bot_user_id=target_bot_user_id,
                conversation_ids=[item[1] for item in chunk],
            )
            with app_session(database_url) as session:
                session.execute(
                    update(AppAiBotConversation)
                    .where(AppAiBotConversation.id.in_([item[0] for item in chunk]))
                    .values(bot_id=target.id, updated_at=_utc_now())
                )
            moved += len(chunk)
            out(f"[batch] перепривязано диалогов: {moved}/{len(to_move)}")
    for pk, conversation_id, old_slug in to_move:
        if apply:
            out(f"[move] id={pk} conversation_id={conversation_id} {old_slug} -> {TARGET_BOT_SLUG}")

    bots_disabled = 0
    if apply and bots_to_disable:
        with app_session(database_url) as session:
            session.execute(
                update(AppAiBot)
                .where(
                    AppAiBot.slug.in_(list(LEGACY_BOT_SLUGS)),
                    or_(AppAiBot.is_enabled.is_(True), AppAiBot.placement != "hidden"),
                )
                .values(is_enabled=False, placement="hidden", updated_at=_utc_now())
            )
        bots_disabled = len(bots_to_disable)

    mode = "APPLY" if apply else "DRY-RUN"
    out(
        f"[{mode}] legacy ботов найдено: {sorted(legacy_bots)}; "
        f"диалогов к переносу: {len(to_move)}; конфликтов пропущено: {len(skipped)}; "
        f"ботов к отключению: {len(bots_to_disable)}; "
        f"участников (бот {TARGET_BOT_SLUG}) к добавлению в чаты: "
        f"{'не определено' if members_to_add is None else members_to_add}; "
        f"диалогов без чата в chat БД: {orphan_conversations}"
    )
    if not apply:
        out("DRY-RUN: изменений не внесено. Для применения запустите с --apply.")
    return {
        "apply": bool(apply),
        "legacy_slugs": sorted(legacy_bots),
        "moved": len(to_move) if apply else 0,
        "planned_moves": len(to_move),
        "skipped_conflicts": len(skipped),
        "members_to_add": members_to_add,
        "members_added": members_added if apply else 0,
        "orphan_conversations": orphan_conversations,
        "bots_disabled": bots_disabled if apply else 0,
        "target_bot_id": target.id,
    }


def _normalize_slug(value: object) -> str:
    return str(value or "").strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Выполнить перенос (по умолчанию — dry-run без изменений).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=200,
        help="Размер батча UPDATE для ai_bot_conversations (по умолчанию 200).",
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Переопределить APP_DATABASE_URL (для тестов/стендов).",
    )
    parser.add_argument(
        "--chat-database-url",
        default=None,
        help="Переопределить CHAT_DATABASE_URL (для тестов/стендов).",
    )
    args = parser.parse_args()
    run_merge(
        database_url=args.database_url,
        chat_database_url=args.chat_database_url,
        apply=bool(args.apply),
        batch_size=args.batch_size,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
