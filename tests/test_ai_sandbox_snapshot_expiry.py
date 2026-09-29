from __future__ import annotations

import importlib
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

from backend.ai_sandbox.app_service import AiSandboxAppService, ai_sandbox_app_service  # noqa: E402
from backend.ai_sandbox.models import (  # noqa: E402
    AppAiSandboxJob,
    AppAiSandboxPermission,
    AppAiSandboxSession,
)
from backend.appdb.models import AppAiBot, AppAiBotConversation, AppAiPendingAction  # noqa: E402


def _configure_app_database(tmp_path: Path, monkeypatch) -> tuple[str, object]:
    database_url = f"sqlite:///{(tmp_path / 'sandbox_snapshot.db').as_posix()}"
    monkeypatch.setenv("APP_DATABASE_URL", database_url)
    backend_config = importlib.import_module("backend.config")
    appdb_db = importlib.import_module("backend.appdb.db")
    monkeypatch.setattr(backend_config.config.app_db, "database_url", database_url, raising=False)
    monkeypatch.setattr(appdb_db.config.app_db, "database_url", database_url, raising=False)
    appdb_db._engines.clear()
    appdb_db._session_factories.clear()
    appdb_db._initialized_schema_urls.clear()
    appdb_db.initialize_app_schema(database_url)
    return database_url, appdb_db


def _seed(
    *,
    database_url: str,
    appdb_db,
    now: datetime,
    job_status: str,
    action_status: str,
    action_expires_at: datetime,
    permission_id: str = "permission-1",
    action_id: str = "action-1",
    job_id: str = "job-1",
):
    with appdb_db.app_session(database_url) as db:
        db.add(
            AppAiBot(
                id="bot-snapshot",
                slug="opencode-snapshot",
                title="OpenCode",
                system_prompt="workspace only",
                model="",
                surface="sandbox",
                placement="pinned",
                required_permission="chat.ai.sandbox",
                use_personal_memory=False,
                is_enabled=True,
                bot_user_id=999,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiBotConversation(
                bot_id="bot-snapshot",
                user_id=171,
                conversation_id="conversation-snapshot",
                use_personal_memory=False,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiSandboxSession(
                id="session-snapshot",
                conversation_id="conversation-snapshot",
                user_id=171,
                workspace_key="ws-" + ("7" * 32),
                status="ready",
                created_at=now,
                last_activity_at=now,
                expires_at=now + timedelta(days=30),
                credential_ref="",
            )
        )
        db.add(
            AppAiSandboxJob(
                id=job_id,
                session_id="session-snapshot",
                conversation_id="conversation-snapshot",
                user_id=171,
                prompt_message_id="message-1",
                status=job_status,
                deadline_at=now + timedelta(minutes=15),
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiSandboxPermission(
                id=permission_id,
                session_id="session-snapshot",
                job_id=job_id,
                user_id=171,
                opencode_permission_id="per-1",
                tool="bash",
                operation="ls",
                arguments_preview_json="{}",
                action_id=action_id,
                status="pending",
                requested_at=now,
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiPendingAction(
                id=action_id,
                action_type="ai.sandbox.permission",
                status=action_status,
                conversation_id="conversation-snapshot",
                run_id=job_id,
                message_id="message-card-1",
                requester_user_id=171,
                payload_json="{}",
                preview_json="{}",
                result_json="{}",
                expires_at=action_expires_at,
                created_at=now,
                updated_at=now,
            )
        )


def test_snapshot_expires_dead_permission_card(tmp_path, monkeypatch) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    monkeypatch.setattr(AiSandboxAppService, "ensure_enabled", lambda self: None)
    now = datetime.now(timezone.utc)
    _seed(
        database_url=database_url,
        appdb_db=appdb_db,
        now=now,
        job_status="failed",
        action_status="pending",
        action_expires_at=now - timedelta(minutes=1),
    )

    snapshot = ai_sandbox_app_service.conversation_snapshot(
        conversation_id="conversation-snapshot", current_user_id=171
    )

    assert snapshot["pending_permissions"] == []
    with appdb_db.app_session(database_url) as db:
        row = db.get(AppAiSandboxPermission, "permission-1")
        assert row.status == "rejected"
        assert row.grant_scope is None


def test_snapshot_keeps_live_and_confirming_cards(tmp_path, monkeypatch) -> None:
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    monkeypatch.setattr(AiSandboxAppService, "ensure_enabled", lambda self: None)
    now = datetime.now(timezone.utc)
    _seed(
        database_url=database_url,
        appdb_db=appdb_db,
        now=now,
        job_status="waiting_permission",
        action_status="pending",
        action_expires_at=now + timedelta(minutes=10),
    )

    snapshot = ai_sandbox_app_service.conversation_snapshot(
        conversation_id="conversation-snapshot", current_user_id=171
    )

    assert [item["id"] for item in snapshot["pending_permissions"]] == ["permission-1"]

    with appdb_db.app_session(database_url) as db:
        executing = db.get(AppAiPendingAction, "action-1")
        executing.status = "executing"
    snapshot = ai_sandbox_app_service.conversation_snapshot(
        conversation_id="conversation-snapshot", current_user_id=171
    )
    assert [item["id"] for item in snapshot["pending_permissions"]] == ["permission-1"]
    with appdb_db.app_session(database_url) as db:
        assert db.get(AppAiSandboxPermission, "permission-1").status == "pending"
