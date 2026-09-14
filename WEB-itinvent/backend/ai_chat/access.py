"""One source of per-agent grants for HUB and the Linux execution worker."""
from contextlib import nullcontext
import json
from datetime import datetime, timezone

from sqlalchemy import select, update, or_, func

from backend.appdb.db import app_session
from backend.appdb.models import AppAiBot, AppAiBotAccess, AppAiBotConversation, AppAiBotRun, AppAiPendingAction, AppUser


def can_use_bot(db, bot, user_id: int) -> bool:
    user = db.get(AppUser, int(user_id))
    if user is None or not user.is_active:
        return False
    if user.role == 'admin' or (bot.slug == 'general-ai' and bot.surface == 'general'):
        return True
    grant = db.get(AppAiBotAccess, (bot.id, int(user_id)))
    return bool(grant and grant.allowed)


def require_bot_access(db, bot, user_id: int) -> None:
    if not bot.is_enabled or not can_use_bot(db, bot, user_id):
        raise PermissionError('Доступ к агенту не предоставлен. История доступна только для чтения.')


def require_conversation_access(conversation_id: str, user_id: int, *, db=None, lock=False, require_mapping=False) -> None:
    with (nullcontext(db) if db is not None else app_session()) as session:
        mapping = session.execute(select(AppAiBotConversation).where(
            AppAiBotConversation.conversation_id == str(conversation_id))).scalar_one_or_none()
        if mapping is None:
            if require_mapping:
                raise PermissionError('AI conversation is unavailable')
            return
        statement = select(AppAiBot).where(AppAiBot.id == mapping.bot_id)
        bot = session.execute(statement.with_for_update() if lock else statement).scalar_one_or_none()
        # Bot output is sent through the same message persistence API.
        if bot is not None and bot.bot_user_id == int(user_id):
            return
        if bot is None or mapping.user_id != int(user_id):
            raise PermissionError('AI conversation is unavailable')
        require_bot_access(session, bot, user_id)


def conversation_access(conversation_id: str, user_id: int):
    with app_session() as db:
        mapping = db.execute(select(AppAiBotConversation).where(
            AppAiBotConversation.conversation_id == conversation_id,
            AppAiBotConversation.user_id == user_id)).scalar_one_or_none()
        if mapping is None:
            raise LookupError('AI conversation not found')
        bot = db.get(AppAiBot, mapping.bot_id)
        return {'can_use': bool(bot and bot.is_enabled and can_use_bot(db, bot, user_id))}


def require_manager(db, actor_id: int):
    from backend.services.authorization_service import has_permission, PERM_SETTINGS_AI_MANAGE
    actor = db.get(AppUser, actor_id)
    if actor is not None and actor.is_active:
        if actor.role == 'admin' or has_permission(actor.role, PERM_SETTINGS_AI_MANAGE,
                use_custom_permissions=actor.use_custom_permissions,
                custom_permissions=json.loads(actor.custom_permissions_json or '[]')):
            return
    raise PermissionError('Agent management permission required')


def list_user_access(user_id: int):
    with app_session() as db:
        user = db.get(AppUser, user_id)
        if user is None:
            raise LookupError('User not found')
        grants = {g.bot_id: g.allowed for g in db.execute(select(AppAiBotAccess).where(AppAiBotAccess.user_id == user_id)).scalars()}
        return [{'bot_id': b.id, 'title': b.title, 'allowed': user.role == 'admin' or bool(grants.get(b.id)),
                 'automatic': user.role == 'admin'} for b in db.execute(select(AppAiBot).where(AppAiBot.surface != 'general').order_by(AppAiBot.title)).scalars()]


def list_bot_access(bot_id: str, query: str = '', *, offset: int = 0, limit: int = 50):
    with app_session() as db:
        bot = db.get(AppAiBot, bot_id)
        if bot is None:
            raise LookupError('Agent not found')
        statement = select(AppUser).where(AppUser.is_active.is_(True), AppUser.auth_source != 'bot')
        if query.strip():
            q = query.strip().lower()
            statement = statement.where(or_(func.lower(AppUser.username).contains(q, autoescape=True),
                                            func.lower(AppUser.full_name).contains(q, autoescape=True)))
        users = list(db.execute(statement.order_by(AppUser.full_name, AppUser.id).offset(offset).limit(limit + 1)).scalars())
        ids = [u.id for u in users[:limit]]
        grants = {g.user_id: g.allowed for g in db.execute(select(AppAiBotAccess).where(
            AppAiBotAccess.bot_id == bot_id, AppAiBotAccess.user_id.in_(ids))).scalars()}
        return {'items': [{'user_id': u.id, 'title': u.full_name or u.username, 'username': u.username,
                           'allowed': u.role == 'admin' or bool(grants.get(u.id)), 'automatic': u.role == 'admin'} for u in users[:limit]],
                'has_more': len(users) > limit}


def set_access(*, bot_id: str, user_id: int, allowed: bool, actor_id: int):
    from backend.ai_sandbox.models import AppAiSandboxJob, AppAiSandboxPermission, AppAiSandboxGatewayGrant
    from backend.ai_sandbox.sqlalchemy_repository import SqlAlchemySandboxQueueRepository
    now = datetime.now(timezone.utc)
    with app_session() as db:
        require_manager(db, actor_id)
        # Serialize changes to an agent, including first grant insertion.
        bot = db.execute(select(AppAiBot).where(AppAiBot.id == bot_id).with_for_update()).scalar_one_or_none()
        user = db.get(AppUser, user_id)
        if bot is None or user is None:
            raise LookupError('Agent or user not found')
        if bot.surface == 'general' or user.role == 'admin':
            raise ValueError('Этот доступ предоставляется автоматически')
        if not user.is_active or user.auth_source == 'bot':
            raise ValueError('Выберите активного сотрудника')
        grant = db.get(AppAiBotAccess, (bot_id, user_id))
        if grant is None:
            grant = AppAiBotAccess(bot_id=bot_id, user_id=user_id)
            db.add(grant)
        grant.allowed, grant.updated_by, grant.updated_at = allowed, actor_id, now
        if not allowed:
            conversations = select(AppAiBotConversation.conversation_id).where(
                AppAiBotConversation.bot_id == bot_id, AppAiBotConversation.user_id == user_id)
            db.execute(update(AppAiBotRun).where(AppAiBotRun.bot_id == bot_id, AppAiBotRun.user_id == user_id,
                AppAiBotRun.status.in_(('queued', 'running'))).values(status='cancelled', stage='cancelled',
                status_text='Доступ к агенту отозван', completed_at=now, updated_at=now))
            db.execute(update(AppAiPendingAction).where(AppAiPendingAction.conversation_id.in_(conversations),
                AppAiPendingAction.requester_user_id == user_id, AppAiPendingAction.status == 'pending').values(status='cancelled', updated_at=now))
            jobs = list(db.execute(select(AppAiSandboxJob).where(AppAiSandboxJob.user_id == user_id,
                AppAiSandboxJob.conversation_id.in_(conversations),
                AppAiSandboxJob.status.in_(('preparing', 'queued', 'claimed', 'running', 'waiting_permission', 'cleanup_pending')))).scalars())
            repository = SqlAlchemySandboxQueueRepository(session_provider=lambda: nullcontext(db))
            for job in jobs:
                repository.cancel_job(job_id=job.id, user_id=user_id, now=now)
            # Session-scoped permission approvals must not survive revoke/regrant.
            session_ids = select(AppAiSandboxJob.session_id).where(AppAiSandboxJob.conversation_id.in_(conversations))
            db.execute(update(AppAiSandboxPermission).where(AppAiSandboxPermission.user_id == user_id,
                AppAiSandboxPermission.session_id.in_(session_ids), AppAiSandboxPermission.grant_scope == 'session')
                .values(grant_scope=None, updated_at=now))
            if jobs:
                db.execute(update(AppAiSandboxGatewayGrant).where(AppAiSandboxGatewayGrant.job_id.in_([j.id for j in jobs]))
                           .values(status='revoked', revoked_at=now, updated_at=now))
    return {'bot_id': bot_id, 'user_id': user_id, 'allowed': allowed}
