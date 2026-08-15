from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.config import (  # noqa: E402
    BASELINE_OPENCODE_VERSION,
    MINIMUM_SAFE_OPENCODE_VERSION,
    SandboxConfigurationError,
    SandboxSettings,
)
from backend.ai_sandbox.contracts import (  # noqa: E402
    PermissionDisposition,
    PermissionGrantScope,
    PermissionRequest,
)
from backend.ai_sandbox.control import (  # noqa: E402
    OpenCodeApiPaths,
    permission_response_payload,
)
from backend.ai_sandbox.policy import OpenCodePermissionPolicy, SandboxPermissionError  # noqa: E402


PINNED_TEST_IMAGE = "registry.internal/hub/opencode@sha256:" + ("a" * 64)


def _request(tool: str, **arguments: object) -> PermissionRequest:
    return PermissionRequest(
        id="permission-1",
        session_id="session-1",
        job_id="job-1",
        tool=tool,
        operation=tool,
        arguments_preview=dict(arguments),
        requested_at=datetime.now(timezone.utc),
    )


def test_settings_reject_floating_or_unreviewed_runtime() -> None:
    base = {
        "AI_SANDBOX_ENABLED": "1",
        "AI_SANDBOX_IMAGE": PINNED_TEST_IMAGE,
        "AI_SANDBOX_OPENCODE_VERSION": BASELINE_OPENCODE_VERSION,
        "AI_SANDBOX_CONTENT_TRANSFER_READY": "1",
        "AI_SANDBOX_CONTENT_TRANSFER_URL": "https://hub-ai-control/api/v1/chat/internal/ai/sandbox",
        "AI_SANDBOX_CONTENT_TRANSFER_ALLOWED_HOST": "hub-ai-control",
        "AI_SANDBOX_TRANSFER_SERVICE_TOKEN": "test-token-abcdefghijklmnopqrstuvwxyz-0123456789",
    }
    settings = SandboxSettings.from_env(base)
    assert settings.enabled is True
    assert settings.retention_days == 30
    assert settings.limits.command_timeout_seconds == 120
    assert settings.limits.response_timeout_seconds == 900

    with pytest.raises(SandboxConfigurationError, match="pinned"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_IMAGE": "registry/hub/opencode:1.18.18"})
    with pytest.raises(SandboxConfigurationError, match="latest"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_IMAGE": "registry/hub/opencode:latest"})
    with pytest.raises(SandboxConfigurationError, match="safe minimum"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_OPENCODE_VERSION": "1.0.215"})
    with pytest.raises(SandboxConfigurationError, match="content transfer"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_CONTENT_TRANSFER_READY": "0"})
    with pytest.raises(SandboxConfigurationError, match="internal HTTPS host"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_CONTENT_TRANSFER_URL": "https://attacker.invalid/steal"})
    with pytest.raises(SandboxConfigurationError, match="SERVICE_TOKEN"):
        SandboxSettings.from_env({**base, "AI_SANDBOX_TRANSFER_SERVICE_TOKEN": "change-me-placeholder-token-123456789"})
    assert MINIMUM_SAFE_OPENCODE_VERSION == "1.0.216"


def test_policy_allows_read_asks_for_mutation_and_denies_other_tools() -> None:
    policy = OpenCodePermissionPolicy()

    for tool in ("read", "glob", "grep", "list", "lsp"):
        assert policy.evaluate_request(_request(tool)).disposition is PermissionDisposition.ALLOW
    assert policy.evaluate_request(_request("edit", path="report.py")).disposition is PermissionDisposition.ASK
    assert policy.evaluate_request(_request("webfetch", url="https://example.test")).disposition is PermissionDisposition.DENY
    assert policy.evaluate_request(_request("external_directory", path="/srv/hub")).disposition is PermissionDisposition.DENY

    assert policy.evaluate_request(_request("read", path="src/report.py")).disposition is PermissionDisposition.ALLOW
    assert policy.evaluate_request(_request("read", path="../outside.py")).disposition is PermissionDisposition.DENY
    assert policy.evaluate_request(_request("edit", path="opencode.json")).disposition is PermissionDisposition.DENY


@pytest.mark.parametrize(
    "command",
    [
        "pip install requests",
        "python -m pip install requests",
        "curl https://example.test",
        "git push origin main",
        "cat /proc/self/environ",
        "python -c 'print(os.environ)'",
        "ln -s /etc/passwd leak",
        "cat ../outside.txt",
        "pytest && env",
    ],
)
def test_bash_policy_denies_install_network_escape_env_and_composition(command: str) -> None:
    decision = OpenCodePermissionPolicy().evaluate_request(_request("bash", command=command))
    assert decision.disposition is PermissionDisposition.DENY


def test_bash_policy_requires_confirmation_for_scoped_offline_command() -> None:
    decision = OpenCodePermissionPolicy().evaluate_request(_request("bash", command="pytest -q"))
    assert decision.disposition is PermissionDisposition.ASK
    assert decision.may_remember_for_session is True


def test_permission_scope_never_becomes_global_opencode_memory() -> None:
    policy = OpenCodePermissionPolicy()
    assert policy.validate_grant_scope(PermissionGrantScope.ONCE) is PermissionGrantScope.ONCE
    assert policy.validate_grant_scope("session") is PermissionGrantScope.SESSION
    with pytest.raises(SandboxPermissionError):
        policy.validate_grant_scope("global")

    assert permission_response_payload(approved=True, scope=PermissionGrantScope.SESSION) == {
        "response": "once",
        "remember": False,
    }
    assert permission_response_payload(approved=False, scope=PermissionGrantScope.ONCE)["response"] == "reject"


def test_reviewed_opencode_api_paths_are_opaque_and_exact() -> None:
    assert OpenCodeApiPaths.create_session() == "/session"
    assert OpenCodeApiPaths.async_prompt("session/one") == "/session/session%2Fone/prompt_async"
    assert OpenCodeApiPaths.abort("session-1") == "/session/session-1/abort"
    assert OpenCodeApiPaths.diff("session-1") == "/session/session-1/diff"
    assert OpenCodeApiPaths.permission("session-1", "permission/2") == (
        "/session/session-1/permissions/permission%2F2"
    )
    assert OpenCodeApiPaths.events() == "/event"


def test_shipped_opencode_config_has_no_web_or_global_permission() -> None:
    payload = json.loads((PROJECT_ROOT / "scripts" / "ai-sandbox" / "opencode.json").read_text(encoding="utf-8"))
    assert payload["autoupdate"] is False
    assert payload["share"] == "disabled"
    assert payload["server"] == {"mdns": False, "cors": []}
    assert payload["permission"]["external_directory"] == "deny"
    assert payload["permission"]["edit"] == "ask"
    assert payload["permission"]["bash"]["*"] == "ask"
    assert payload["tools"]["webfetch"] is False
