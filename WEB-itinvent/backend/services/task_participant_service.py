"""Task participant, observer, and viewer resolution for hub tasks."""

from __future__ import annotations

from typing import Any, Optional

from backend.services.task_observer_sql import build_assignee_membership_clause, build_observer_membership_clause
from backend.services.user_service import user_service


def _normalize_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


class TaskParticipantMixin:
    def _task_delegate_user_ids(self, assignee_user_id: Any) -> list[int]:
        return user_service.get_delegate_user_ids(self._as_int(assignee_user_id))

    def _task_participant_user_ids(self, task: dict[str, Any], *, include_delegates: bool = True) -> set[int]:
        assignee_ids = self._task_assignee_user_ids(task)
        participant_ids = {
            *assignee_ids,
            self._as_int(task.get("created_by_user_id")),
            self._as_int(task.get("controller_user_id")),
        }
        if include_delegates:
            for assignee_id in assignee_ids:
                participant_ids.update(self._task_delegate_user_ids(assignee_id))
        return {item for item in participant_ids if item > 0}

    def _normalize_assignee_user_ids(self, values: Any, *, fallback_assignee_user_id: Any = 0) -> list[int]:
        if isinstance(values, str) or values is None:
            source = self._json_load_list(values)
        elif isinstance(values, list):
            source = values
        else:
            source = []
        out = self._unique_ints(source)
        fallback_id = self._as_int(fallback_assignee_user_id)
        if fallback_id > 0:
            out = [fallback_id, *[item for item in out if item != fallback_id]]
        return out

    def _task_assignee_user_ids(self, task: dict[str, Any]) -> set[int]:
        return set(
            self._normalize_assignee_user_ids(
                task.get("assignee_user_ids"),
                fallback_assignee_user_id=task.get("assignee_user_id"),
            )
        )

    def _resolve_active_task_assignees(self, values: Any, *, fallback_assignee_user_id: Any = 0) -> list[dict[str, Any]]:
        assignee_ids = self._normalize_assignee_user_ids(
            values,
            fallback_assignee_user_id=fallback_assignee_user_id,
        )
        if not assignee_ids:
            raise ValueError("At least one assignee is required")
        assignees: list[dict[str, Any]] = []
        for assignee_id in assignee_ids:
            user = user_service.get_by_id(assignee_id)
            if not user or not bool(user.get("is_active", True)):
                raise ValueError("Assignee user is not available")
            assignees.append(user)
        return assignees

    def _serialize_assignee_user_ids(self, values: Any, *, fallback_assignee_user_id: Any = 0) -> str:
        return self._serialize_json_list(
            self._normalize_assignee_user_ids(
                values,
                fallback_assignee_user_id=fallback_assignee_user_id,
            )
        )

    def _enrich_task_assignee_fields(
        self,
        item: dict[str, Any],
        *,
        users_by_id: Optional[dict[int, dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        assignee_ids = self._normalize_assignee_user_ids(
            item.get("assignee_user_ids"),
            fallback_assignee_user_id=item.get("assignee_user_id"),
        )
        item["assignee_user_ids"] = assignee_ids
        directory = users_by_id if users_by_id is not None else self._users_by_id()
        assignees: list[dict[str, Any]] = []
        for assignee_id in assignee_ids:
            user = directory.get(assignee_id) or user_service.get_by_id(assignee_id) or {}
            assignees.append(
                {
                    "user_id": assignee_id,
                    "username": _normalize_text(user.get("username")),
                    "full_name": _normalize_text(user.get("full_name")) or _normalize_text(user.get("username")),
                }
            )
        item["assignees"] = assignees
        return item

    def _task_observer_user_ids(self, task: dict[str, Any]) -> set[int]:
        raw = task.get("observer_user_ids")
        if isinstance(raw, str) or raw is None:
            values = self._json_load_list(raw)
        elif isinstance(raw, list):
            values = raw
        else:
            values = []
        return {item for item in self._unique_ints(values)}

    def _task_viewer_user_ids(self, task: dict[str, Any], *, include_delegates: bool = True) -> set[int]:
        return self._task_participant_user_ids(task, include_delegates=include_delegates) | self._task_observer_user_ids(task)

    def _task_discussion_user_ids(self, task: dict[str, Any], *, include_delegates: bool = True) -> set[int]:
        return self._task_viewer_user_ids(task, include_delegates=include_delegates)

    def _observer_membership_clause(self, user_id: int) -> tuple[str, list[Any]]:
        return build_observer_membership_clause(user_id, uses_postgresql=self._uses_postgresql())

    def _assignee_membership_clause(self, user_id: int) -> tuple[str, list[Any]]:
        return build_assignee_membership_clause(user_id, uses_postgresql=self._uses_postgresql())

    def _assignee_membership_any_clause(self, user_ids: Any) -> tuple[str, list[Any]]:
        normalized_ids = self._unique_ints(list(user_ids or []))
        if not normalized_ids:
            return "1 = 0", []
        placeholders = ", ".join(["?"] * len(normalized_ids))
        clauses = [f"assignee_user_id IN ({placeholders})"]
        params: list[Any] = list(normalized_ids)
        for user_id in normalized_ids:
            clause, clause_params = self._assignee_membership_clause(user_id)
            clauses.append(clause)
            params.extend(clause_params)
        return "(" + " OR ".join(clauses) + ")", params

    def _normalize_observer_user_ids(
        self,
        values: Any,
        *,
        creator_user_id: int = 0,
        assignee_user_id: int = 0,
        assignee_user_ids: Any = None,
        controller_user_id: int = 0,
    ) -> list[int]:
        if isinstance(values, str) or values is None:
            source = self._json_load_list(values)
        elif isinstance(values, list):
            source = values
        else:
            source = []
        exclude = {
            self._as_int(creator_user_id),
            self._as_int(assignee_user_id),
            self._as_int(controller_user_id),
        }
        exclude.update(self._normalize_assignee_user_ids(assignee_user_ids))
        out: list[int] = []
        for item in self._unique_ints(source):
            if item in exclude:
                continue
            user = user_service.get_by_id(item)
            if not user or not bool(user.get("is_active", True)):
                continue
            out.append(item)
        return out

    def _serialize_observer_user_ids(self, values: Any, **kwargs: Any) -> str:
        return self._serialize_json_list(self._normalize_observer_user_ids(values, **kwargs))

    def _enrich_task_observer_fields(
        self,
        item: dict[str, Any],
        *,
        users_by_id: Optional[dict[int, dict[str, Any]]] = None,
    ) -> dict[str, Any]:
        observer_ids = self._normalize_observer_user_ids(item.get("observer_user_ids"))
        item["observer_user_ids"] = observer_ids
        directory = users_by_id if users_by_id is not None else self._users_by_id()
        observers: list[dict[str, Any]] = []
        for observer_id in observer_ids:
            user = directory.get(observer_id) or user_service.get_by_id(observer_id) or {}
            observers.append(
                {
                    "user_id": observer_id,
                    "username": _normalize_text(user.get("username")),
                    "full_name": _normalize_text(user.get("full_name")) or _normalize_text(user.get("username")),
                }
            )
        item["observers"] = observers
        return item
