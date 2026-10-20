"""Opt-in local E2E fixtures: real persisted cards/routes, fake outbound mail."""
import json
from datetime import datetime, timedelta, timezone


def seed_ai_reliability(state_dir):
    from sqlalchemy import select
    from backend.appdb.db import app_session
    from backend.appdb.models import AppUser, AppAiBot, AppAiBotAccess, AppAiBotConversation, AppAiBotRun, AppAiPendingAction
    from backend.chat.db import chat_session
    from backend.chat.models import ChatConversation, ChatMember
    from backend.chat.service import chat_service
    from backend.ai_chat import action_cards
    from backend.services.mail_service import MailServiceError

    with app_session() as db:
        owner = db.execute(select(AppUser).where(AppUser.username == "e2e_admin")).scalar_one().id
        assistant = db.execute(select(AppUser).where(AppUser.username == "e2e_user")).scalar_one().id
        db.add(AppAiBot(id="reliability-bot", slug="reliability-mail", title="Проверка черновиков", bot_user_id=assistant))
        db.add(AppAiBotAccess(bot_id="reliability-bot", user_id=owner, allowed=True, updated_by=owner))
    for kind in ("draft", "expired", "unknown", "progress", "unknown-editor", "lost-direct", "lost-editor"):
        conversation = f"reliability-{kind}"
        with app_session() as db:
            db.add(AppAiBotConversation(bot_id="reliability-bot", user_id=owner, conversation_id=conversation))
            db.add(AppAiBotRun(id=conversation, bot_id="reliability-bot", conversation_id=conversation,
                user_id=owner, trigger_message_id=f"trigger-{kind}",
                status="running" if kind == "progress" else "completed",
                stage="generating_answer" if kind == "progress" else "completed"))
        with chat_session() as db:
            db.add(ChatConversation(id=conversation, kind="ai", title=f"Проверка: {kind}", created_by_user_id=owner))
            db.flush()
            db.add_all([ChatMember(conversation_id=conversation, user_id=owner), ChatMember(conversation_id=conversation, user_id=assistant)])
        action = action_cards.build_office_mail_draft(action_type="office.mail.send", conversation_id=conversation,
            run_id=conversation, requester_user_id=owner,
            payload={"to": ["recipient@example.test"], "subject": f"Reliability {kind}", "body": "Пожалуйста, исправьте номер телефона сотрудника на портале."})
        message = chat_service.send_message(current_user_id=assistant, conversation_id=conversation,
            body="Подготовил черновик письма. Проверьте карточку и подтвердите отправку.",
            client_message_id=f"ai-run:{conversation}", defer_push_notifications=True)
        action_cards.attach_run_actions_to_message(run_id=conversation, message_id=message["id"])
        with app_session() as db:
            run = db.get(AppAiBotRun, conversation)
            run.result_json = json.dumps({"result_message_id": message["id"], "result_delivery_enqueued": True})
            if kind == "expired":
                db.get(AppAiPendingAction, action["id"]).expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)

    sends = []
    def send(**kwargs):
        assert kwargs.get("require_idempotency") is True
        assert str(kwargs.get("idempotency_key", "")).startswith("ai-action:")
        sends.append({"subject": kwargs["subject"], "body": kwargs["body"]})
        (state_dir / "mail-sends.json").write_text(json.dumps(sends, ensure_ascii=False), encoding="utf-8")
        if kwargs["subject"].startswith("Reliability unknown"):
            raise MailServiceError("Ambiguous upstream result", code="MAIL_SEND_UNKNOWN", status_code=409)
        return {"ok": True, "message_id": f"e2e-sent-{len(sends)}", "mailbox_id": "local-mailbox"}
    action_cards.mail_service.send_message = send
