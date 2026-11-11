from __future__ import annotations

import importlib.util
import json
from io import StringIO
from pathlib import Path

import pytest
from dotenv import dotenv_values


spec = importlib.util.spec_from_file_location(
    "sandbox_preflight", Path(__file__).resolve().parents[1] / "scripts/ai-sandbox/preflight.py"
)
preflight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preflight)


def test_disabled_configuration_exposes_blockers_without_changing_input():
    values = {"AI_SANDBOX_ENABLED": "0", "AI_SANDBOX_IMAGE": "bad-secret-image"}
    original = dict(values)
    report = preflight.check_configuration(values, role="hub")
    assert not report["configuration_ok"]
    assert not report["runtime_verified"]
    assert values == original
    assert "bad-secret-image" not in json.dumps(report)
    assert len([item for item in report["checks"] if not item["ok"]]) >= 3


def test_gateway_requires_execution_flag_even_when_other_settings_are_present():
    values = {"APP_DATABASE_URL": "secret-db", "ROUTERAI_API_KEY": "secret-key",
              "AI_SANDBOX_LLM_MODEL": "test-model"}
    report = preflight.check_configuration(values, role="gateway")
    assert [c["check"] for c in report["checks"] if not c["ok"]] == ["AI_SANDBOX_ENABLED"]
    values["AI_SANDBOX_ENABLED"] = "1"
    assert preflight.check_configuration(values, role="gateway")["configuration_ok"]
    assert "secret-" not in json.dumps(report)


def test_invalid_gateway_budget_is_reported_without_echoing_input():
    report = preflight.check_configuration({"AI_SANDBOX_LLM_MAX_OUTPUT_TOKENS": "secret-value"}, role="gateway")
    assert not report["configuration_ok"]
    assert "secret-value" not in json.dumps(report)


def test_gateway_env_enables_only_gateway_and_excludes_host_credentials():
    builder_spec = importlib.util.spec_from_file_location(
        "sandbox_gateway_builder", Path(__file__).resolve().parents[1] / "scripts/ai-sandbox/_build_start_gateway.py"
    )
    builder = importlib.util.module_from_spec(builder_spec)
    builder_spec.loader.exec_module(builder)
    source = {"APP_DATABASE_URL": "test-db", "ROUTERAI_API_KEY": "test-key",
              "AI_SANDBOX_ENABLED": "0", "AI_SANDBOX_TRANSFER_SERVICE_TOKEN": "host-only"}
    result = builder.build_gateway_env(source, model="test-model")
    values = dotenv_values(stream=StringIO(result), interpolate=False)
    assert preflight.check_configuration(values, role="gateway")["configuration_ok"]
    assert source["AI_SANDBOX_ENABLED"] == "0"
    assert "host-only" not in result
    with pytest.raises(ValueError, match="single-line"):
        builder.build_gateway_env(source, model="test\nINJECTED=1")
