from __future__ import annotations

import importlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("ENVIRONMENT", "development")

from backend.ai_sandbox.config import SandboxSettings  # noqa: E402
from backend.ai_sandbox.gateway import (  # noqa: E402
    GatewayAuthorizationError,
    GatewayRequestScope,
    SqlAlchemyGatewayAccessBroker,
)
from backend.ai_sandbox.models import (  # noqa: E402
    AppAiSandboxGatewayGrant,
    AppAiSandboxJob,
    AppAiSandboxSession,
)
from backend.ai_sandbox.runtime import (  # noqa: E402
    generate_basic_auth_credentials,
    write_secret_env_file,
)


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("d" * 64)


def _configure_app_database(tmp_path: Path, monkeypatch) -> tuple[str, object]:
    database_url = f"sqlite:///{(tmp_path / 'sandbox_gateway.db').as_posix()}"
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


def _seed_active_job(*, database_url: str, appdb_db, now: datetime) -> dict[str, object]:
    identifiers = {
        "job_id": "job-gateway-1",
        "session_id": "session-gateway-1",
        "conversation_id": "conversation-gateway-1",
        "user_id": 71,
    }
    with appdb_db.app_session(database_url) as db:
        db.add(
            AppAiSandboxSession(
                id=identifiers["session_id"],
                conversation_id=identifiers["conversation_id"],
                user_id=identifiers["user_id"],
                workspace_key="workspace-gateway-1",
                status="busy",
                credential_ref="",
                last_activity_at=now,
                expires_at=now + timedelta(days=30),
                created_at=now,
                updated_at=now,
            )
        )
        db.add(
            AppAiSandboxJob(
                id=identifiers["job_id"],
                session_id=identifiers["session_id"],
                conversation_id=identifiers["conversation_id"],
                user_id=identifiers["user_id"],
                prompt_message_id="message-gateway-1",
                job_type="prompt",
                status="running",
                attempt=1,
                claimed_by="worker-gateway-1",
                claimed_at=now,
                heartbeat_at=now,
                deadline_at=now + timedelta(minutes=30),
                result_json="{}",
                error_code="",
                started_at=now,
                created_at=now,
                updated_at=now,
            )
        )
    return identifiers


@pytest.fixture
def gateway_runtime(tmp_path: Path, monkeypatch):
    database_url, appdb_db = _configure_app_database(tmp_path, monkeypatch)
    now = datetime(2026, 8, 15, 8, 0, tzinfo=timezone.utc)
    identifiers = _seed_active_job(database_url=database_url, appdb_db=appdb_db, now=now)
    return {
        **identifiers,
        "database_url": database_url,
        "appdb_db": appdb_db,
        "now": now,
        "broker": SqlAlchemyGatewayAccessBroker(),
    }


def _authorization(grant) -> str:
    return f"Bearer {grant.token.reveal()}"


def test_gateway_registry_persists_only_hash_and_rejects_wrong_job_scope(gateway_runtime) -> None:
    broker = gateway_runtime["broker"]
    grant = broker.issue(
        job_id=gateway_runtime["job_id"],
        session_id=gateway_runtime["session_id"],
        user_id=gateway_runtime["user_id"],
        now=gateway_runtime["now"],
    )

    with gateway_runtime["appdb_db"].app_session(gateway_runtime["database_url"]) as db:
        stored = db.get(AppAiSandboxGatewayGrant, grant.id)
        assert stored.token_hash == grant.token.digest()
        assert grant.token.reveal() not in stored.token_hash
        assert grant.token.reveal() not in repr(grant)

    with pytest.raises(GatewayAuthorizationError, match="scope mismatch"):
        broker.authenticate(
            authorization=_authorization(grant),
            job_id="wrong-job",
            session_id=gateway_runtime["session_id"],
            user_id=gateway_runtime["user_id"],
            now=gateway_runtime["now"],
        )

    with gateway_runtime["appdb_db"].app_session(gateway_runtime["database_url"]) as db:
        stored = db.get(AppAiSandboxGatewayGrant, grant.id)
        assert stored.status == "active"
        assert stored.request_count == 0


def test_gateway_registry_rejects_expired_and_revoked_grants(gateway_runtime) -> None:
    broker = gateway_runtime["broker"]
    expired = broker.issue(
        job_id=gateway_runtime["job_id"],
        session_id=gateway_runtime["session_id"],
        user_id=gateway_runtime["user_id"],
        now=gateway_runtime["now"],
    )
    with pytest.raises(GatewayAuthorizationError, match="expired"):
        broker.authenticate(
            authorization=_authorization(expired),
            job_id=gateway_runtime["job_id"],
            session_id=gateway_runtime["session_id"],
            user_id=gateway_runtime["user_id"],
            now=expired.expires_at + timedelta(seconds=1),
        )

    revoked = broker.issue(
        job_id=gateway_runtime["job_id"],
        session_id=gateway_runtime["session_id"],
        user_id=gateway_runtime["user_id"],
        now=gateway_runtime["now"] + timedelta(seconds=1),
    )
    assert broker.revoke(
        grant_id=revoked.id,
        job_id=gateway_runtime["job_id"],
        now=gateway_runtime["now"] + timedelta(seconds=2),
    )
    with pytest.raises(GatewayAuthorizationError, match="no longer active"):
        broker.authenticate(
            authorization=_authorization(revoked),
            job_id=gateway_runtime["job_id"],
            session_id=gateway_runtime["session_id"],
            user_id=gateway_runtime["user_id"],
            now=gateway_runtime["now"] + timedelta(seconds=3),
        )


def test_gateway_request_budget_accepts_last_request_then_blocks_replay(gateway_runtime) -> None:
    broker = gateway_runtime["broker"]
    grant = broker.issue(
        job_id=gateway_runtime["job_id"],
        session_id=gateway_runtime["session_id"],
        user_id=gateway_runtime["user_id"],
        now=gateway_runtime["now"],
        max_requests=1,
    )

    accepted = broker.authenticate(
        authorization=_authorization(grant),
        job_id=gateway_runtime["job_id"],
        session_id=gateway_runtime["session_id"],
        user_id=gateway_runtime["user_id"],
        now=gateway_runtime["now"] + timedelta(seconds=1),
    )
    assert accepted.request_number == 1
    with pytest.raises(GatewayAuthorizationError, match="no longer active"):
        broker.authenticate(
            authorization=_authorization(grant),
            job_id=gateway_runtime["job_id"],
            session_id=gateway_runtime["session_id"],
            user_id=gateway_runtime["user_id"],
            now=gateway_runtime["now"] + timedelta(seconds=2),
        )

    with gateway_runtime["appdb_db"].app_session(gateway_runtime["database_url"]) as db:
        stored = db.get(AppAiSandboxGatewayGrant, grant.id)
        assert stored.status == "exhausted"
        assert stored.request_count == stored.max_requests == 1


def test_gateway_asgi_forces_server_model_and_preserves_job_scope_headers(monkeypatch) -> None:
    gateway = importlib.import_module("backend.ai_sandbox.gateway")
    gateway_main = importlib.import_module("backend.ai_sandbox_gateway_main")
    calls: dict[str, object] = {}

    def authenticate(**kwargs):
        calls["authorization"] = kwargs
        return GatewayRequestScope(
            grant_id="grant-asgi",
            job_id="job-asgi",
            session_id="session-asgi",
            user_id=81,
            request_number=1,
        )

    def stream_chat_completion(**kwargs):
        calls["provider"] = kwargs
        yield {"id": "chunk-1", "choices": [{"delta": {"content": "ok"}}]}

    monkeypatch.setenv("AI_SANDBOX_ENABLED", "1")
    monkeypatch.setenv("AI_SANDBOX_LLM_MODEL", "openai/approved-sandbox-model")
    monkeypatch.setenv("AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS", "1234")
    monkeypatch.setattr(gateway.gateway_access_broker, "authenticate", authenticate)
    monkeypatch.setattr(gateway.openrouter_client, "stream_chat_completion", stream_chat_completion)

    response = TestClient(gateway_main.app).post(
        "/v1/chat/completions",
        headers={
            "Authorization": "Bearer " + ("x" * 48),
            "X-HUB-Sandbox-Job-ID": "job-asgi",
            "X-HUB-Sandbox-Session-ID": "session-asgi",
            "X-HUB-Sandbox-User-ID": "81",
        },
        json={
            "model": "attacker/model-override",
            "messages": [{"role": "user", "content": "check"}],
            "max_tokens": 9000,
            "stream": True,
        },
    )

    assert response.status_code == 200
    assert response.text.endswith("data: [DONE]\n\n")
    assert calls["authorization"] == {
        "authorization": "Bearer " + ("x" * 48),
        "job_id": "job-asgi",
        "session_id": "session-asgi",
        "user_id": "81",
    }
    assert calls["provider"]["model"] == "openai/approved-sandbox-model"
    assert calls["provider"]["max_tokens"] == 1234


def test_internal_apps_are_absent_from_public_chat_openapi() -> None:
    public_chat = importlib.import_module("backend.api.v1.chat")
    public_app = FastAPI()
    public_app.include_router(public_chat.router, prefix="/api/v1/chat")
    public_paths = set(public_app.openapi()["paths"])

    assert "/v1/chat/completions" not in public_paths
    assert not any("/internal/ai/sandbox" in path for path in public_paths)

    gateway_app = importlib.import_module("backend.ai_sandbox_gateway_main").app
    transfer_app = importlib.import_module("backend.ai_sandbox_internal_main").app
    assert gateway_app.openapi_url is None
    assert gateway_app.docs_url is None
    assert transfer_app.openapi_url is None
    assert transfer_app.docs_url is None
    assert any(route.path == "/v1/chat/completions" for route in gateway_app.routes)
    assert any("/internal/ai/sandbox" in route.path for route in transfer_app.routes)


def test_opencode_config_headers_match_runtime_secret_environment(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspaces"
    workspace_root.mkdir()
    settings = SandboxSettings(
        enabled=True,
        image=PINNED_TEST_IMAGE,
        workspace_root=workspace_root,
        runtime_secret_root=tmp_path / "runtime-secrets",
        seccomp_profile=tmp_path / "seccomp.json",
        content_transfer_url="https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        content_transfer_ready=True,
        transfer_auth_configured=True,
    )
    credentials = generate_basic_auth_credentials(gateway_bearer_token="g" * 48)
    secret_path = write_secret_env_file(
        settings=settings,
        session_id="session-contract",
        job_id="job-contract",
        user_id=91,
        credentials=credentials,
    )
    runtime_environment = dict(
        line.split("=", 1)
        for line in secret_path.read_text(encoding="utf-8").splitlines()
    )
    opencode = json.loads(
        (PROJECT_ROOT / "scripts" / "ai-sandbox" / "opencode.json").read_text(encoding="utf-8")
    )
    options = opencode["provider"]["openai"]["options"]

    assert options["baseURL"] == "{env:HUB_LLM_GATEWAY_URL}"
    assert options["apiKey"] == "{env:HUB_LLM_GATEWAY_BEARER_TOKEN}"
    assert options["headers"] == {
        "X-HUB-Sandbox-Job-ID": "{env:HUB_SANDBOX_JOB_ID}",
        "X-HUB-Sandbox-Session-ID": "{env:HUB_SANDBOX_SESSION_ID}",
        "X-HUB-Sandbox-User-ID": "{env:HUB_SANDBOX_USER_ID}",
    }
    assert runtime_environment["HUB_LLM_GATEWAY_URL"] == "http://hub-ai-llm-gateway:8080/v1"
    assert runtime_environment["HUB_LLM_GATEWAY_BEARER_TOKEN"] == "g" * 48
    assert runtime_environment["HUB_SANDBOX_JOB_ID"] == "job-contract"
    assert runtime_environment["HUB_SANDBOX_SESSION_ID"] == "session-contract"
    assert runtime_environment["HUB_SANDBOX_USER_ID"] == "91"

