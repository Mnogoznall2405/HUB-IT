"""Strict, deployment-controlled rules for mutating 1C docflow tasks."""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal


DocflowActionCode = Literal["acknowledge", "approve", "approve_with_comments", "reject", "complete"]
_ACTION_CODES = frozenset({"acknowledge", "approve", "approve_with_comments", "reject", "complete"})
_DEFAULT_LABELS = {
    "acknowledge": "Ознакомиться",
    "approve": "Согласовать",
    "approve_with_comments": "Согласовать с замечаниями",
    "reject": "Отклонить",
    "complete": "Выполнить",
}
_DEFAULT_TONES = {
    "acknowledge": "primary",
    "approve": "success",
    "approve_with_comments": "warning",
    "reject": "error",
    "complete": "primary",
}
_DEFAULT_RULES_PATH = Path(__file__).resolve().parent.parent / "resources" / "docflow_action_rules.v1.json"


@dataclass(frozen=True)
class DocflowActionRule:
    configuration: str
    task_type: str
    process_type: str
    configuration_fingerprint: str
    action: DocflowActionCode
    result_value: str
    label: str
    tone: str
    comment_mode: Literal["optional", "required"]
    dm_version: str = ""
    xdto_task_type: str = ""
    result_field: str = ""
    result_object_id: str = ""

    def public_contract(self) -> dict[str, str]:
        return {
            "code": self.action,
            "label": self.label,
            "tone": self.tone,
            "comment_mode": self.comment_mode,
        }


def configuration_fingerprint(*, configuration: str, task_type: str, process_type: str) -> str:
    canonical = "|".join(
        str(value or "").strip().casefold()
        for value in (configuration, task_type, process_type)
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def _text(value: Any, *, maximum: int) -> str:
    return str(value or "").strip()[:maximum]


def _comment_mode(action: str, value: Any) -> Literal["optional", "required"]:
    # Negative and free-form completion outcomes always require an explanation,
    # even if a deployment rule was accidentally configured as optional.
    if action in {"approve_with_comments", "reject", "complete"}:
        return "required"
    return "required" if str(value or "").strip().lower() == "required" else "optional"


def _configured_rules_payload(raw: str | None) -> str:
    if raw is not None:
        return str(raw or "").strip()
    configured = str(os.getenv("DOCFLOW_ACTION_RULES_JSON", "") or "").strip()
    if configured:
        return configured
    configured_path = str(os.getenv("DOCFLOW_ACTION_RULES_FILE", "") or "").strip()
    path = Path(configured_path).expanduser() if configured_path else _DEFAULT_RULES_PATH
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


def load_action_rules(raw: str | None = None) -> tuple[DocflowActionRule, ...]:
    configured = _configured_rules_payload(raw)
    if not configured:
        return ()
    try:
        payload = json.loads(configured)
    except (TypeError, ValueError):
        return ()
    rows = payload.get("rules") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return ()

    rules: list[DocflowActionRule] = []
    seen: set[tuple[str, str, str, str]] = set()
    for row in rows[:100]:
        if not isinstance(row, dict):
            continue
        configuration = _text(row.get("configuration") or "docflow", maximum=128)
        task_type = _text(row.get("task_type") or "ЗадачаИсполнителя", maximum=128)
        process_type = _text(row.get("process_type"), maximum=128)
        fingerprint = _text(row.get("configuration_fingerprint"), maximum=64).lower()
        actions = row.get("actions")
        dm_version = _text(row.get("dm_version"), maximum=64)
        xdto_task_type = _text(row.get("xdto_task_type"), maximum=128)
        expected_fingerprint = configuration_fingerprint(
            configuration=configuration,
            task_type=task_type,
            process_type=process_type,
        )
        if not process_type or fingerprint != expected_fingerprint or not isinstance(actions, dict):
            continue
        for raw_action, raw_spec in actions.items():
            action = str(raw_action or "").strip().lower()
            if action not in _ACTION_CODES or not isinstance(raw_spec, dict):
                continue
            if "result_value" not in raw_spec:
                continue
            result_value = _text(raw_spec.get("result_value"), maximum=500)
            # In this configuration an acknowledgement completes with an empty
            # result. Other actions must still carry an explicit trusted value.
            if not result_value and action != "acknowledge":
                continue
            comment_mode = _comment_mode(action, raw_spec.get("comment_mode"))
            if comment_mode == "required" and "{comment}" not in result_value:
                # Required user input must be consumed by the trusted template;
                # silently dropping it would make the audit/confirmation lie.
                continue
            key = (configuration.casefold(), task_type.casefold(), process_type.casefold(), action)
            if key in seen:
                continue
            seen.add(key)
            tone = _text(raw_spec.get("tone") or _DEFAULT_TONES[action], maximum=16).lower()
            if tone not in {"primary", "success", "error", "warning"}:
                tone = _DEFAULT_TONES[action]
            rules.append(
                DocflowActionRule(
                    configuration=configuration,
                    task_type=task_type,
                    process_type=process_type,
                    configuration_fingerprint=fingerprint,
                    action=action,  # type: ignore[arg-type]
                    result_value=result_value,
                    label=_text(raw_spec.get("label") or _DEFAULT_LABELS[action], maximum=80),
                    tone=tone,
                    comment_mode=comment_mode,
                    dm_version=dm_version,
                    xdto_task_type=xdto_task_type,
                    result_field=_text(raw_spec.get("result_field"), maximum=128),
                    result_object_id=_text(raw_spec.get("result_object_id"), maximum=128),
                )
            )
    return tuple(rules)


def matching_action_rules(
    *,
    configuration: str,
    task_type: str,
    process_type: str,
    rules: tuple[DocflowActionRule, ...] | None = None,
) -> tuple[DocflowActionRule, ...]:
    fingerprint = configuration_fingerprint(
        configuration=configuration,
        task_type=task_type,
        process_type=process_type,
    )
    available = rules if rules is not None else load_action_rules()
    return tuple(
        rule
        for rule in available
        if rule.configuration.casefold() == str(configuration or "").strip().casefold()
        and rule.task_type.casefold() == str(task_type or "").strip().casefold()
        and rule.process_type.casefold() == str(process_type or "").strip().casefold()
        and rule.configuration_fingerprint == fingerprint
    )
