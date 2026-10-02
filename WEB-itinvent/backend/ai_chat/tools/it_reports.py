"""IT reports for ai_chat: hardware changes, installed software, dismissed employees
with equipment and full mailboxes. Read-only; every tool sticks to the visibility
rules of the matching portal page.
"""
from __future__ import annotations

import logging
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_ACTS_PENDING,
    ITINVENT_TOOL_AUDIT_DISMISSED,
    ITINVENT_TOOL_COMPUTERS_CHANGES,
    ITINVENT_TOOL_COMPUTERS_SOFTWARE,
    OFFICE_TOOL_MAILBOX_QUOTA_REPORT,
)
from backend.ai_chat.tools.registry import ai_tool_registry

logger = logging.getLogger(__name__)

MAX_ROWS = 50
_GB = 1024 ** 3


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _iso(ts: Any) -> Optional[str]:
    try:
        value = int(float(ts))
    except (TypeError, ValueError):
        return None
    return datetime.fromtimestamp(value, tz=timezone.utc).isoformat() if value > 0 else None


def _gb(value: Any) -> Optional[float]:
    try:
        return round(int(value) / _GB, 2)
    except (TypeError, ValueError):
        return None


def _visible_computer_records(context: AiToolExecutionContext) -> list[dict[str, Any]]:
    """Computers visible to the employee — the same scope as the 'Computers' page."""
    from backend.ai_chat.tools.computers import portal_user_model
    from backend.api.v1.inventory import _collect_scoped_computer_records

    return [
        record
        for record in _collect_scoped_computer_records(
            current_user=portal_user_model(context.user_payload),
            db_id_selected=_normalize_text(context.effective_database_id) or None,
            scope="selected",
            branch=None,
            status_filter=None,
            outlook_status=None,
            q=None,
        )
        if isinstance(record, dict)
    ]


# ---------------------------------------------------------------- hardware changes


def _token_label(token: str) -> str:
    parts = [part for part in str(token or "").split("|") if part]
    return " ".join(reversed(parts)) if parts else ""


def _change_view(event: dict[str, Any]) -> dict[str, Any]:
    diff = event.get("diff") if isinstance(event.get("diff"), dict) else {}
    changes: dict[str, Any] = {}
    system = diff.get("system") if isinstance(diff.get("system"), dict) else None
    if system:
        before = system.get("before") if isinstance(system.get("before"), dict) else {}
        after = system.get("after") if isinstance(system.get("after"), dict) else {}
        changes["system"] = {
            key: {"before": before.get(key), "after": after.get(key)}
            for key in sorted(set(before) | set(after))
            if before.get(key) != after.get(key)
        }
    for key in ("monitors", "storage"):
        part = diff.get(key) if isinstance(diff.get(key), dict) else None
        if not part:
            continue
        before = set(part.get("before") or [])
        after = set(part.get("after") or [])
        changes[key] = {
            "removed": sorted(_token_label(item) for item in before - after),
            "added": sorted(_token_label(item) for item in after - before),
        }
    return {
        "detected_at": _iso(event.get("detected_at")),
        "hostname": _normalize_text(event.get("hostname")) or None,
        "mac_address": _normalize_text(event.get("mac_address")) or None,
        "change_types": list(event.get("change_types") or []),
        "changes": changes,
    }


class ComputersChangesArgs(BaseModel):
    days: int = Field(default=7, ge=1, le=30)
    hostname: Optional[str] = Field(default=None, max_length=160)
    change_type: Optional[Literal["system", "monitors", "storage"]] = None
    limit: int = Field(default=20, ge=1, le=MAX_ROWS)

    @field_validator("hostname", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


class ComputersChangesTool(AiTool):
    tool_id = ITINVENT_TOOL_COMPUTERS_CHANGES
    description = (
        "Hardware changes detected by the HUB inventory agent over the last N days (max 30): CPU/RAM/system serial, "
        "monitors and disks added or removed per computer. Use for 'что поменялось в железе за неделю', "
        "'у кого сняли монитор', 'менялся ли диск на WS-042'."
    )
    input_model = ComputersChangesArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ComputersChangesArgs) -> AiToolResult:
        from backend.api.v1.inventory import _load_changes, _normalize_mac

        since_ts = int(time.time()) - int(args.days) * 86400
        try:
            visible_macs = {_normalize_mac(record.get("mac_address")) for record in _visible_computer_records(context)}
            events = _load_changes(since_ts=since_ts)
        except Exception as exc:
            logger.warning("ai computers.changes failed: %s", type(exc).__name__)
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Данные об изменениях недоступны: {exc}")
        rows = []
        for event in events:
            if _normalize_mac(event.get("mac_address")) not in visible_macs:
                continue
            if args.hostname and _normalize_text(event.get("hostname")).lower() != args.hostname.lower():
                continue
            if args.change_type and args.change_type not in list(event.get("change_types") or []):
                continue
            rows.append(event)
        rows.sort(key=lambda item: -int(float(item.get("detected_at") or 0)))
        items = [_change_view(event) for event in rows[: args.limit]]
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={"days": args.days, "total": len(rows), "count": len(items), "truncated": len(rows) > len(items), "items": items},
        )


# ---------------------------------------------------------------- software


class SoftwareSearchArgs(BaseModel):
    query: str = Field(..., min_length=2, max_length=120, description="Program name or part of it, e.g. AnyDesk, 7-Zip")
    version_below: Optional[str] = Field(default=None, max_length=40, description="Only installs with an older version")
    limit: int = Field(default=30, ge=1, le=MAX_ROWS)

    @field_validator("query", "version_below", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


def _version_key(value: str) -> tuple:
    parts = []
    for piece in str(value or "").replace("-", ".").split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        parts.append(int(digits) if digits else 0)
    return tuple(parts)


class SoftwareSearchTool(AiTool):
    tool_id = ITINVENT_TOOL_COMPUTERS_SOFTWARE
    description = (
        "Find computers with a program installed (software inventory of the HUB inventory agent): name, version, "
        "publisher, install date, computer and user. Use for 'у кого стоит AnyDesk', 'где старый 7-Zip' "
        "(version_below), 'сколько установок Office'."
    )
    input_model = SoftwareSearchArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: SoftwareSearchArgs) -> AiToolResult:
        from backend.api.v1.inventory import _get_inventory_app_store, _normalize_mac

        needle = args.query.lower()
        try:
            visible = {
                _normalize_mac(record.get("mac_address")): record for record in _visible_computer_records(context)
            }
            visible.pop("", None)
            app_store = _get_inventory_app_store()
            hosts = app_store.list_hosts(set(visible)) if app_store is not None and visible else []
        except Exception as exc:
            logger.warning("ai computers.software_search failed: %s", type(exc).__name__)
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Данные о программах недоступны: {exc}")
        installs = []
        hosts_with_inventory = 0
        for host in hosts:
            software = host.get("software_inventory") if isinstance(host.get("software_inventory"), dict) else {}
            items = [item for item in list(software.get("items") or []) if isinstance(item, dict)]
            if items:
                hosts_with_inventory += 1
            for item in items:
                name = _normalize_text(item.get("display_name"))
                if needle not in name.lower():
                    continue
                version = _normalize_text(item.get("display_version"))
                if args.version_below and _version_key(version) >= _version_key(args.version_below):
                    continue
                installs.append(
                    {
                        "program": name,
                        "version": version or None,
                        "publisher": _normalize_text(item.get("publisher")) or None,
                        "install_date": _normalize_text(item.get("install_date")) or None,
                        "hostname": _normalize_text(host.get("hostname")) or None,
                        "user_login": _normalize_text(host.get("user_login")) or None,
                        "collected_at": _iso(software.get("collected_at")),
                    }
                )
        installs.sort(key=lambda row: (row["program"].lower(), _version_key(row.get("version") or ""), row.get("hostname") or ""))
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "query": args.query,
                "computers_checked": len(hosts),
                "computers_with_software_inventory": hosts_with_inventory,
                "total": len(installs),
                "count": min(len(installs), args.limit),
                "truncated": len(installs) > args.limit,
                "items": installs[: args.limit],
            },
        )


# ---------------------------------------------------------------- dismissed with equipment


class DismissedWithEquipmentArgs(BaseModel):
    days: int = Field(default=90, ge=1, le=730, description="Dismissed within the last N days")
    limit: int = Field(default=30, ge=1, le=MAX_ROWS)


class DismissedWithEquipmentTool(AiTool):
    tool_id = ITINVENT_TOOL_AUDIT_DISMISSED
    description = (
        "Audit: employees dismissed in 1C ZUP within the last N days who still have equipment registered in ITinvent "
        "(matched by exact e-mail or exact full name). Namesakes of working employees are flagged as needs_check. "
        "Use for 'кто из уволенных не сдал технику', 'уволенные с техникой за квартал'."
    )
    input_model = DismissedWithEquipmentArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: DismissedWithEquipmentArgs) -> AiToolResult:
        from backend.ai_chat.tools.itinvent import _normalize_equipment_item
        from backend.database import queries
        from backend.services.address_book_service import address_book_service, normalize_search_text

        database_id = _normalize_text(context.effective_database_id)
        if not database_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Не выбрана база ITinvent.")
        cutoff = date.today() - timedelta(days=int(args.days))
        try:
            cache = address_book_service.load_cache()
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Справочник сотрудников недоступен: {exc}")
        active_names = {
            normalize_search_text(item.get("full_name"))
            for item in list(cache.get("items") or [])
            if isinstance(item, dict)
        }
        dismissed = []
        for item in list(cache.get("dismissed_items") or []):
            if not isinstance(item, dict):
                continue
            try:
                dismissed_on = date.fromisoformat(_normalize_text(item.get("dismissal_date"))[:10])
            except ValueError:
                continue
            if dismissed_on >= cutoff:
                dismissed.append((dismissed_on, item))
        dismissed.sort(key=lambda pair: pair[0], reverse=True)

        rows = []
        checked = 0
        for dismissed_on, item in dismissed:
            full_name = " ".join(_normalize_text(item.get("full_name")).split())
            if not full_name:
                continue
            emails = [
                _normalize_text(contact.get("value") if isinstance(contact, dict) else contact).lower()
                for contact in list(item.get("work_emails") or [])
            ]
            emails = [email for email in emails if "@" in email]
            checked += 1
            try:
                owner_nos: set[int] = set()
                match = "name"
                for email in emails:
                    owner_nos.update(queries.find_owner_nos_by_identity(email=email, db_id=database_id).get("email") or [])
                if owner_nos:
                    match = "email"
                else:
                    owner_nos.update(
                        queries.find_owner_nos_by_identity(display_name=full_name, db_id=database_id).get("name") or []
                    )
                equipment = []
                for owner_no in sorted(owner_nos):
                    equipment.extend(queries.get_equipment_by_owner(int(owner_no), database_id) or [])
            except Exception as exc:
                return AiToolResult(tool_id=self.tool_id, ok=False, error=f"ITinvent недоступен: {exc}")
            if not equipment:
                continue
            namesake_active = normalize_search_text(full_name) in active_names
            rows.append(
                {
                    "full_name": full_name,
                    "dismissal_date": dismissed_on.isoformat(),
                    "department": _normalize_text(item.get("department")) or None,
                    "position": _normalize_text(item.get("position")) or None,
                    "matched_by": match,
                    "needs_check": bool(match == "name" and (namesake_active or len(owner_nos) > 1)),
                    "equipment_count": len(equipment),
                    "equipment": [
                        {
                            key: value
                            for key, value in _normalize_equipment_item(row, database_id=database_id).items()
                            if key in {"inv_no", "type_name", "model_name", "serial_no", "status", "location"}
                        }
                        for row in equipment[:10]
                    ],
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "days": args.days,
                "dismissed_checked": checked,
                "total": len(rows),
                "count": min(len(rows), args.limit),
                "truncated": len(rows) > args.limit,
                "items": rows[: args.limit],
            },
        )


# ---------------------------------------------------------------- mailbox quotas


class MailboxQuotaReportArgs(BaseModel):
    filter: Literal["over_quota", "warning_90", "top"] = Field(
        default="warning_90", description="over_quota=100%+, warning_90=90-99%, top=largest by usage"
    )
    search: Optional[str] = Field(default=None, max_length=200)
    limit: int = Field(default=20, ge=1, le=MAX_ROWS)

    @field_validator("search", mode="before")
    @classmethod
    def _normalize(cls, value):
        return _normalize_text(value) or None


class MailboxQuotaReportTool(AiTool):
    tool_id = OFFICE_TOOL_MAILBOX_QUOTA_REPORT
    description = (
        "Exchange mailbox quota report from the latest snapshot: mailboxes over quota, 90-99% full or the largest "
        "ones, with used/quota/free GB. Use for 'у кого переполнены ящики', 'ящики больше 90%'."
    )
    input_model = MailboxQuotaReportArgs
    stage = "checking_office"

    def execute(self, *, context: AiToolExecutionContext, args: MailboxQuotaReportArgs) -> AiToolResult:
        from backend.services.mailbox_quota_service import mailbox_quota_service

        try:
            snapshot = mailbox_quota_service.get_latest_snapshot()
            if snapshot is None:
                return AiToolResult(tool_id=self.tool_id, ok=False, error="Данные о квотах почтовых ящиков ещё не загружены.")
            page = mailbox_quota_service.list_rows(
                int(snapshot.id),
                search=args.search or "",
                over_quota=args.filter == "over_quota",
                warning_90=args.filter == "warning_90",
                limit=args.limit,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Данные о квотах недоступны: {exc}")
        items = [
            {
                "email": row.email,
                "display_name": row.display_name or None,
                "used_gb": _gb(row.used_bytes),
                "quota_gb": _gb(row.quota_bytes),
                "free_gb": _gb(row.free_bytes),
                "used_percent": row.used_percent,
            }
            for row in page.items
        ]
        snapshot_payload = snapshot.model_dump(mode="json") if hasattr(snapshot, "model_dump") else {}
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "filter": args.filter,
                "snapshot_at": snapshot_payload.get("collected_at") or snapshot_payload.get("imported_at"),
                "total": int(page.total),
                "count": len(items),
                "truncated": int(page.total) > len(items),
                "items": items,
            },
        )


# ---------------------------------------------------------------- unsigned transfer acts


class ActsPendingArgs(BaseModel):
    mine_only: bool = Field(default=False, description="Only reminders assigned to the asking employee")
    older_than_days: int = Field(default=0, ge=0, le=365, description="Only reminders open longer than N days")
    limit: int = Field(default=20, ge=1, le=MAX_ROWS)


def _age_days(value: Any) -> Optional[int]:
    text = _normalize_text(value)
    if not text:
        return None
    try:
        created = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return max(0, (datetime.now(timezone.utc) - created).days)


class ActsPendingTool(AiTool):
    tool_id = ITINVENT_TOOL_ACTS_PENDING
    description = (
        "Equipment transfers whose signed act has not been uploaded yet (open act reminders of the selected ITinvent "
        "database): new owner, previous owners, inventory numbers, responsible IT employee and days open. "
        "Use for 'какие акты не подписаны', 'мои незакрытые акты', 'акты висят больше недели'."
    )
    input_model = ActsPendingArgs
    stage = "checking_itinvent"

    def execute(self, *, context: AiToolExecutionContext, args: ActsPendingArgs) -> AiToolResult:
        from backend.services.transfer_act_reminder_service import transfer_act_reminder_service
        from backend.services.user_service import user_service

        database_id = _normalize_text(context.effective_database_id) or None
        assignee_user_id = int(context.user_id or 0) if args.mine_only else None
        if args.mine_only and not assignee_user_id:
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Не удалось определить пользователя портала.")
        try:
            reminders = transfer_act_reminder_service.list_open_reminders(
                db_id=database_id,
                assignee_user_id=assignee_user_id,
                limit=200,
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Напоминания об актах недоступны: {exc}")

        names: dict[int, Optional[str]] = {}

        def _assignee_name(user_id: int) -> Optional[str]:
            if user_id not in names:
                try:
                    user = user_service.get_by_id(user_id) or {}
                except Exception:
                    user = {}
                names[user_id] = _normalize_text(user.get("full_name") or user.get("username")) or None
            return names[user_id]

        rows = []
        for reminder in reminders:
            groups = list(reminder.get("pending_groups") or [])
            if not groups:
                continue
            age = _age_days(reminder.get("created_at"))
            if args.older_than_days and (age is None or age < args.older_than_days):
                continue
            rows.append(
                {
                    "new_employee": reminder.get("new_employee_name") or None,
                    "responsible": _assignee_name(int(reminder.get("assignee_user_id") or 0)),
                    "created_at": reminder.get("created_at"),
                    "days_open": age,
                    "previous_owners": sorted({group.get("old_employee_name") for group in groups if group.get("old_employee_name")}),
                    "inv_nos": [inv for group in groups for inv in list(group.get("inv_nos") or [])][:20],
                    "equipment_count": sum(int(group.get("equipment_count") or 0) for group in groups),
                }
            )
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            database_id=database_id,
            data={
                "mine_only": args.mine_only,
                "total": len(rows),
                "count": min(len(rows), args.limit),
                "truncated": len(rows) > args.limit,
                "items": rows[: args.limit],
            },
        )


for tool in [ComputersChangesTool(), SoftwareSearchTool(), DismissedWithEquipmentTool(), MailboxQuotaReportTool(), ActsPendingTool()]:
    ai_tool_registry.register(tool)
