"""Self-service tools for every employee (group "self", permission chat.ai.use).

These tools answer only about the employee who asks: the identity comes from the
portal account (see ``backend.ai_chat.self_identity``), the tools take no "who"
argument, and data about other people is stripped. They let a regular employee get
answers that otherwise need IT permissions: "what equipment is mine", "why is my
computer slow", "when does my password expire", and file a request to IT.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.self_identity import (
    OWNER_MATCH_AMBIGUOUS,
    SelfIdentity,
    normalize_login,
    resolve_self_identity,
)
from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    HELPDESK_TOOL_REQUEST_DRAFT,
    SELF_TOOL_ACCOUNT_STATUS,
    SELF_TOOL_COMPUTER_HEALTH,
    SELF_TOOL_EQUIPMENT,
    SELF_TOOL_FILES_ATTACH,
    SELF_TOOL_FILES_SEARCH,
    SELF_TOOL_MAILBOX_QUOTA,
)
from backend.ai_chat.tools.registry import ai_tool_registry

logger = logging.getLogger(__name__)

_MAX_EQUIPMENT = 50
_MAX_HOSTS = 5

HELPDESK_CATEGORIES = {
    "computer": "Компьютер",
    "printer": "Принтер / МФУ",
    "network": "Сеть / интернет",
    "mail": "Почта",
    "1c": "1С",
    "access": "Доступ / учётная запись",
    "software": "Программы",
    "other": "Другое",
}


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _owner_unresolved_error(identity: SelfIdentity) -> str:
    if identity.owner_match == OWNER_MATCH_AMBIGUOUS:
        return (
            "Не удалось однозначно сопоставить вашу учётную запись с сотрудником ITinvent "
            "(найдено несколько совпадений). Обратитесь в IT-отдел."
        )
    return (
        "Ваша учётная запись не сопоставлена с сотрудником ITinvent (нет совпадения по e-mail или ФИО). "
        "Обратитесь в IT-отдел."
    )


def _my_equipment_rows(identity: SelfIdentity) -> list[dict[str, Any]]:
    from backend.database import queries

    if not identity.owner_resolved or not identity.database_id:
        return []
    return list(queries.get_equipment_by_owner(int(identity.owner_no), identity.database_id) or [])


def _my_hosts(identity: SelfIdentity, equipment_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Inventory hosts of this employee: logged in under the own AD login, or own equipment."""
    from backend.api.v1.inventory import _get_inventory_app_store, _get_inventory_host, _normalize_mac
    from backend.ai_chat.tools.itinvent import _row_value

    hosts: dict[str, dict[str, Any]] = {}
    login = identity.ad_login
    app_store = _get_inventory_app_store()
    if login and app_store is not None:
        for mac in sorted(app_store.search_host_keys(login, {"user"}) or set()):
            host = _get_inventory_host(mac)
            if not isinstance(host, dict):
                continue
            if login in {normalize_login(host.get("user_login")), normalize_login(host.get("current_user"))}:
                hosts[_normalize_mac(host.get("mac_address") or mac)] = host
    for row in equipment_rows:
        mac = _normalize_mac(_row_value(row, "mac_address", "mac"))
        if not mac or mac in hosts:
            continue
        host = _get_inventory_host(mac)
        if isinstance(host, dict):
            hosts[mac] = host
    return list(hosts.values())[:_MAX_HOSTS]


def _self_computer_view(raw: dict[str, Any], identity: SelfIdentity) -> dict[str, Any]:
    """Computer view without other people's data (shared PCs keep several profiles)."""
    from backend.ai_chat.tools.computers import build_computer_view

    view = build_computer_view(raw, detail=True)
    login = identity.ad_login or ""
    for key in ("user_login", "current_user", "user_full_name"):
        if normalize_login(view.get(key)) != login or not login:
            view[key] = None
    outlook = view.get("outlook") or {}
    outlook["stores"] = [
        store for store in list(outlook.get("stores") or []) if login and login in _normalize_text(store.get("path")).lower()
    ]
    profiles = view.get("profiles") or {}
    profiles["items"] = [
        item for item in list(profiles.get("items") or []) if login and normalize_login(item.get("user_name")) == login
    ]
    profiles.pop("total_size_gb", None)
    profiles.pop("count", None)
    return view


def collect_self_computers(identity: SelfIdentity) -> list[dict[str, Any]]:
    try:
        rows = _my_equipment_rows(identity)
    except Exception as exc:
        logger.warning("self computers: equipment lookup failed: %s", type(exc).__name__)
        rows = []
    return [_self_computer_view(raw, identity) for raw in _my_hosts(identity, rows)]


class _NoArgs(BaseModel):
    pass


class MyEquipmentTool(AiTool):
    tool_id = SELF_TOOL_EQUIPMENT
    description = (
        "List equipment registered in ITinvent to the employee who asks (only their own; no arguments). "
        "Use for 'что за мной числится', 'какая у меня техника', 'мой инвентарный номер'."
    )
    input_model = _NoArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        from backend.ai_chat.tools.itinvent import _normalize_equipment_item

        identity = resolve_self_identity(context)
        if not identity.owner_resolved:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_owner_unresolved_error(identity))
        try:
            rows = _my_equipment_rows(identity)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"ITinvent недоступен: {exc}")
        items = [_normalize_equipment_item(row, database_id=identity.database_id) for row in rows[:_MAX_EQUIPMENT]]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=identity.database_id,
            data={"count": len(items), "truncated": len(rows) > len(items), "items": items},
        )


class MyComputerHealthTool(AiTool):
    tool_id = SELF_TOOL_COMPUTER_HEALTH
    description = (
        "Health of the asking employee's own computer(s) from the HUB inventory agent (no arguments): "
        "online status, uptime and last reboot, pending reboot after updates, RAM/CPU load, free disk space, "
        "disk problems, own Outlook PST size. Use for 'почему тормозит компьютер', 'мне нужно перезагрузиться?', "
        "'сколько места на диске', 'почему не работает почта/PST большой'."
    )
    input_model = _NoArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        identity = resolve_self_identity(context)
        if not identity.ad_login and not identity.owner_resolved:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=_owner_unresolved_error(identity))
        try:
            computers = collect_self_computers(identity)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Данные агента инвентаризации недоступны: {exc}")
        if not computers:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Агент инвентаризации не нашёл ваш компьютер (агент не установлен или вы ещё не входили на ПК).",
            )
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"count": len(computers), "items": computers})


class MyAccountStatusTool(AiTool):
    tool_id = SELF_TOOL_ACCOUNT_STATUS
    description = (
        "Status of the asking employee's own Active Directory account (no arguments): when the password "
        "expires, whether it must be changed now, whether the account is locked and bad password count. "
        "Use for 'когда менять пароль', 'почему не пускает в систему', 'заблокирована ли моя учётка'. "
        "Never unlocks or resets anything — for that suggest helpdesk.request_draft."
    )
    input_model = _NoArgs
    stage = "checking_ad"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        from backend.services.ad_users_service import get_ad_user_lockout_status, lookup_ad_user_password_status

        identity = resolve_self_identity(context)
        login = identity.ad_login
        if not login:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Ваша учётная запись портала не из Active Directory — статус пароля AD недоступен.",
            )
        password = lookup_ad_user_password_status(login, limit=5)
        user = password.get("user") if isinstance(password.get("user"), dict) else None
        if password.get("status") != "matched" or user is None or normalize_login(user.get("login")) != login:
            # Fuzzy AD search must not return a namesake's account.
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Не удалось получить статус вашей учётной записи AD. Обратитесь в IT-отдел.",
            )
        lockout = get_ad_user_lockout_status(login)
        lockout_ok = lockout.get("status") == "ok" and normalize_login(lockout.get("login")) == login
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "login": user.get("login"),
                "display_name": user.get("display_name"),
                "password": {
                    "expiration_date": user.get("expiration_date"),
                    "days_to_expire": user.get("days_to_expire"),
                    "expired": user.get("expired"),
                    "must_change_now": user.get("must_change_now"),
                    "never_expires": user.get("password_never_expires"),
                    "policy_days": password.get("policy_days"),
                },
                "lockout": (
                    {
                        "is_locked": bool(lockout.get("is_locked")),
                        "lockout_time": lockout.get("lockout_time"),
                        "bad_password_count": lockout.get("bad_password_count"),
                    }
                    if lockout_ok
                    else None
                ),
            },
        )


class HelpdeskRequestDraftArgs(BaseModel):
    title: str = Field(..., min_length=5, max_length=200, description="Short problem title in Russian")
    description: str = Field(..., min_length=5, max_length=6000, description="What happens, in the employee's words")
    category: Literal["computer", "printer", "network", "mail", "1c", "access", "software", "other"] = "other"
    urgent: bool = Field(default=False, description="True only when the employee cannot work at all")
    include_computer_info: bool = Field(default=True, description="Attach own computer hostname/IP/status")

    @field_validator("title", "description", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


def helpdesk_settings() -> dict[str, Any]:
    def _int_env(name: str) -> Optional[int]:
        try:
            value = int(_normalize_text(os.getenv(name)) or 0)
        except ValueError:
            return None
        return value if value > 0 else None

    return {
        "project_id": _normalize_text(os.getenv("AI_HELPDESK_PROJECT_ID")) or None,
        "assignee_user_id": _int_env("AI_HELPDESK_ASSIGNEE_USER_ID"),
        "controller_user_id": _int_env("AI_HELPDESK_CONTROLLER_USER_ID"),
    }


def _computer_lines(computers: list[dict[str, Any]]) -> list[str]:
    lines = []
    for item in computers:
        health = item.get("health") or {}
        parts = [
            _normalize_text(item.get("hostname")) or "компьютер",
            f"IP {item.get('ip')}" if item.get("ip") else "",
            f"статус {item.get('status')}",
            f"аптайм {health.get('uptime_days')} дн." if health.get("uptime_days") is not None else "",
            "ждёт перезагрузки" if health.get("pending_reboot") else "",
            "мало места на диске" if health.get("low_disk") else "",
        ]
        lines.append(", ".join(part for part in parts if part))
    return lines


class HelpdeskRequestDraftTool(AiTool):
    tool_id = HELPDESK_TOOL_REQUEST_DRAFT
    description = (
        "Prepare a request to the IT department on behalf of the asking employee (a confirmation card; "
        "nothing is created until the employee confirms). Use when the employee reports a problem the "
        "knowledge base did not solve or asks to 'создать заявку/обращение в IT', 'вызвать айтишника'. "
        "Write title and description from the employee's words; the employee's computer (hostname, IP, "
        "status) is attached automatically."
    )
    input_model = HelpdeskRequestDraftArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: HelpdeskRequestDraftArgs) -> AiToolResult:
        settings = helpdesk_settings()
        if not settings["project_id"] or not settings["assignee_user_id"]:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error=(
                    "Приём обращений в IT через ассистента не настроен (AI_HELPDESK_PROJECT_ID / "
                    "AI_HELPDESK_ASSIGNEE_USER_ID). Подскажите сотруднику связаться с IT-отделом напрямую."
                ),
            )
        identity = resolve_self_identity(context)
        computer_lines: list[str] = []
        if args.include_computer_info:
            try:
                computer_lines = _computer_lines(collect_self_computers(identity))
            except Exception as exc:
                logger.warning("helpdesk draft: computer context failed: %s", type(exc).__name__)
        from backend.ai_chat.action_cards import build_helpdesk_request_draft

        card = build_helpdesk_request_draft(
            conversation_id=context.conversation_id,
            run_id=context.run_id,
            requester_user_id=int(context.user_id),
            payload={
                "title": args.title,
                "description": args.description,
                "category": args.category,
                "category_label": HELPDESK_CATEGORIES.get(args.category, HELPDESK_CATEGORIES["other"]),
                "priority": "high" if args.urgent else "normal",
                "requester_name": identity.full_name,
                "requester_login": identity.ad_login,
                "computers": computer_lines,
            },
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, data={"action_card": card})


_GB = 1024 ** 3
# A personal file the assistant attaches to its answer is read into memory.
MY_FILES_ATTACH_MAX_BYTES = max(1, int(os.environ.get("AI_MY_FILES_ATTACH_MAX_MB", "50") or 50)) * 1024 * 1024
MAX_MY_FILES = 10


def _gb(value: Any) -> Optional[float]:
    try:
        return round(int(value) / _GB, 2)
    except (TypeError, ValueError):
        return None


class MyMailboxQuotaTool(AiTool):
    tool_id = SELF_TOOL_MAILBOX_QUOTA
    description = (
        "How full the asking employee's own Exchange mailbox is (no arguments): used, quota, free space and "
        "percent from the latest quota snapshot. Use for 'почему не уходят/не приходят письма', 'ящик переполнен?'. "
        "For the size of local PST archives use me.computer.health."
    )
    input_model = _NoArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: BaseModel) -> AiToolResult:
        from backend.services.mailbox_quota_service import mailbox_quota_service

        identity = resolve_self_identity(context)
        if not identity.emails:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="В вашей учётной записи портала не указан e-mail.")
        try:
            snapshot = mailbox_quota_service.get_latest_snapshot()
            if snapshot is None:
                return AiToolResult(tool_id=self.tool_id, ok=False, error="Данные о квотах почтовых ящиков ещё не загружены.")
            rows = []
            for email in identity.emails:
                page = mailbox_quota_service.list_rows(int(snapshot.id), search=email, limit=10)
                rows.extend(
                    row for row in page.items if _normalize_text(row.email).lower() == email
                )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Данные о квотах недоступны: {exc}")
        if not rows:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Ваш почтовый ящик не найден в последнем отчёте о квотах.")
        items = [
            {
                "email": row.email,
                "used_gb": _gb(row.used_bytes),
                "quota_gb": _gb(row.quota_bytes),
                "free_gb": _gb(row.free_bytes),
                "used_percent": row.used_percent,
                "over_quota": bool(row.used_percent is not None and row.used_percent >= 100),
                "warning": bool(row.used_percent is not None and 90 <= row.used_percent < 100),
            }
            for row in rows
        ]
        snapshot_payload = snapshot.model_dump(mode="json") if hasattr(snapshot, "model_dump") else {}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "snapshot_at": _normalize_text(
                    snapshot_payload.get("collected_at") or snapshot_payload.get("imported_at")
                ) or None,
                "items": items,
            },
        )


class MyFilesSearchArgs(BaseModel):
    query: str = Field(..., min_length=2, max_length=200, description="Part of the file or folder name")
    limit: int = Field(default=MAX_MY_FILES, ge=1, le=MAX_MY_FILES)

    @field_validator("query", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class MyFilesAttachArgs(BaseModel):
    file_id: str = Field(..., min_length=1, max_length=80)

    @field_validator("file_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value)


class MyFilesSearchTool(AiTool):
    tool_id = SELF_TOOL_FILES_SEARCH
    description = (
        "Search the asking employee's own 'My files' storage by file or folder name. Returns file ids, names, "
        "folders, sizes and dates; attach one to the answer with me.files.attach."
    )
    input_model = MyFilesSearchArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MyFilesSearchArgs) -> AiToolResult:
        from backend.services.my_files_service import my_files_service

        try:
            payload = my_files_service.list_files(user_id=int(context.user_id), query=args.query)
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"«Мои файлы» недоступны: {exc}")
        items = [
            {
                "file_id": _normalize_text(item.get("id")),
                "file_name": _normalize_text(item.get("download_file_name") or item.get("original_file_name")) or None,
                "folder": _normalize_text(item.get("folder_name")) or None,
                "size_mb": round(int(item.get("original_size_bytes") or 0) / (1024 * 1024), 2),
                "updated_at": _normalize_text(item.get("updated_at")) or None,
                "ready": _normalize_text(item.get("status")) == "ready",
            }
            for item in list(payload.get("items") or [])
            if isinstance(item, dict)
        ]
        total = len(items)
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={"count": min(total, args.limit), "total": total, "truncated": total > args.limit, "items": items[: args.limit]},
        )


def load_my_file_for_delivery(*, file_id: str, user_id: int):
    """Owner, readiness, antivirus and expiry checks of My files; raises when not deliverable."""
    from backend.services.my_files_service import my_files_service

    payload = my_files_service.get_download(file_id=file_id, user_id=int(user_id))
    if int(payload.download_size_bytes or 0) > MY_FILES_ATTACH_MAX_BYTES:
        raise ValueError(
            f"Файл слишком большой для отправки в чат (лимит {MY_FILES_ATTACH_MAX_BYTES // (1024 * 1024)} МБ)."
        )
    return payload


class MyFilesAttachTool(AiTool):
    tool_id = SELF_TOOL_FILES_ATTACH
    description = (
        "Attach one of the asking employee's own 'My files' (file_id from me.files.search) to your answer in this "
        "chat. The file is delivered right after the text answer; call it only when the employee asked for the file."
    )
    input_model = MyFilesAttachArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MyFilesAttachArgs) -> AiToolResult:
        try:
            payload = load_my_file_for_delivery(file_id=args.file_id, user_id=int(context.user_id))
        except ValueError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        except Exception:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Файл не найден, ещё обрабатывается или недоступен.")
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "file_id": args.file_id,
                "file_name": payload.file_name,
                "size_mb": round(int(payload.download_size_bytes or 0) / (1024 * 1024), 2),
                "delivery": "attached_after_answer",
            },
        )


for tool in [
    MyEquipmentTool(),
    MyComputerHealthTool(),
    MyAccountStatusTool(),
    MyMailboxQuotaTool(),
    MyFilesSearchTool(),
    MyFilesAttachTool(),
    HelpdeskRequestDraftTool(),
]:
    ai_tool_registry.register(tool)
