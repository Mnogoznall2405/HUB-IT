"""Allowlisted dispatcher executed in the isolated docflow COM process."""
from __future__ import annotations

import os
from typing import Any

from backend.services.docflow_1c_client import Docflow1CComClient


_client: Docflow1CComClient | None = None


def _maximum_cached_connections() -> int:
    try:
        return max(1, min(64, int(os.getenv("DOCFLOW_1C_MAX_CACHED_CONNECTIONS_PER_WORKER", "32"))))
    except (TypeError, ValueError):
        return 32


def _get_client() -> Docflow1CComClient:
    global _client
    if _client is None:
        _client = Docflow1CComClient(
            cache_connections=True,
            max_cached_connections=_maximum_cached_connections(),
        )
    return _client


def _close_client() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None


def _credentials(payload: dict[str, Any]) -> tuple[str, str]:
    return str(payload.get("login") or "").strip(), str(payload.get("password") or "")


def dispatch(operation: str, payload: dict[str, Any]) -> Any:
    """Run one typed operation; never accept query text or connection targets."""
    login, password = _credentials(payload)
    client = _get_client()
    if operation == "test_connection":
        return client.test_connection(login=login, password=password)
    if operation == "metadata":
        return client.metadata(login=login, password=password)
    if operation == "tasks":
        return client.list_tasks(
            login=login,
            password=password,
            scope=str(payload.get("scope") or "inbox"),
            search=str(payload.get("search") or ""),
            limit=int(payload.get("limit") or 50),
            offset=int(payload.get("offset") or 0),
        )
    if operation == "task_detail":
        return client.get_task_detail(
            login=login,
            password=password,
            task_ref=str(payload.get("task_ref") or ""),
        )
    if operation == "task_state":
        return client.get_task_state(
            login=login,
            password=password,
            task_ref=str(payload.get("task_ref") or ""),
        )
    if operation == "task_action":
        return client.apply_task_action(
            login=login,
            password=password,
            task_ref=str(payload.get("task_ref") or ""),
            action=str(payload.get("action") or ""),
            result_template=str(payload.get("result_template") or ""),
            comment=str(payload.get("comment") or ""),
        )
    if operation == "assignment_documents":
        return client.search_assignment_documents(
            login=login,
            password=password,
            search=str(payload.get("search") or ""),
            limit=int(payload.get("limit") or 20),
        )
    if operation == "assignment_assignees":
        return client.search_assignment_assignees(
            login=login,
            password=password,
            search=str(payload.get("search") or ""),
            limit=int(payload.get("limit") or 20),
        )
    if operation == "assignment_state":
        return client.get_assignment_state(
            login=login,
            password=password,
            process_ref=str(payload.get("process_ref") or ""),
        )
    if operation == "assignment_create":
        return client.create_assignment(
            login=login,
            password=password,
            process_ref=str(payload.get("process_ref") or ""),
            document_type=str(payload.get("document_type") or ""),
            document_ref=str(payload.get("document_ref") or ""),
            assignee_ref=str(payload.get("assignee_ref") or ""),
            controller_ref=str(payload.get("controller_ref") or ""),
            due_at=str(payload.get("due_at") or ""),
            importance=str(payload.get("importance") or "normal"),
            title=str(payload.get("title") or ""),
            description=str(payload.get("description") or ""),
        )
    if operation == "file_export":
        return client.export_file(
            login=login,
            password=password,
            task_ref=str(payload.get("task_ref") or ""),
            file_ref=str(payload.get("file_ref") or ""),
        )
    raise ValueError("Операция docflow не разрешена")


# The process bridge calls an optional close hook during worker shutdown.
dispatch.close = _close_client  # type: ignore[attr-defined]
