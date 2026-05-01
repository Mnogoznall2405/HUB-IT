from __future__ import annotations

import asyncio
import copy
import io
import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select

from backend.ai_chat.artifact_generator import GeneratedFileError, build_generated_uploads, normalize_generated_file_specs
from backend.ai_chat.document_extractors import extract_text_from_path
from backend.ai_chat.openrouter_client import OpenRouterClientError, openrouter_client
from backend.ai_chat.retrieval_interface import ai_kb_retrieval
from backend.ai_chat.tools import ai_tool_registry
from backend.ai_chat.tools.context import (
    AI_TOOL_MULTI_DB_MODE_SINGLE,
    AI_TOOL_FILES_CREATE,
    AI_TOOL_FILES_REPORT,
    AiToolExecutionContext,
    DEFAULT_ITINVENT_TOOL_IDS,
    get_available_database_options,
    normalize_enabled_tools,
    normalize_tool_settings,
    resolve_effective_database_id,
)
from backend.appdb.db import (
    app_session,
    apply_postgres_local_timeouts,
    ensure_app_schema_initialized,
    run_with_transient_lock_retry,
)
from backend.appdb.models import (
    AppAiBot,
    AppAiBotConversation,
    AppAiBotRun,
    AppGlobalSetting,
    AppUser,
)
from backend.chat.db import chat_session
from backend.chat.models import ChatConversation, ChatConversationUserState, ChatMember, ChatMessage, ChatMessageAttachment
from backend.chat.realtime_side_effects import build_message_created_event_jobs
from backend.chat.service import chat_service
from backend.services.authorization_service import (
    PERM_CHAT_AI_USE,
    PERM_CHAT_READ,
    PERM_CHAT_WRITE,
    PERM_KB_READ,
)
from backend.services.authorization_service import authorization_service
from backend.services.kb_service import kb_service
from backend.services.user_service import SYSTEM_BOT_USERNAME_PREFIX, user_service


logger = logging.getLogger(__name__)
_AI_LAST_RUN_DURATION_MS = 0.0
_AI_LAST_RUN_COMPLETED_AT: datetime | None = None
ai_kb_retrieval_service = ai_kb_retrieval
DEFAULT_BOT_SLUG = "corp-assistant"
DEFAULT_BOT_MODEL = ""
DEFAULT_BOT_TITLE = "AI Ассистент"
DEFAULT_BOT_DESCRIPTION = "Корпоративный AI-чат с ответами по базе знаний и документам."
DEFAULT_BOT_PROMPT = (
    "Ты корпоративный AI-ассистент. "
    "Отвечай по-русски, кратко и по делу. "
    "Если дан контекст из базы знаний или файлов, опирайся на него и не выдумывай факты. "
    "Если информации недостаточно, явно скажи об этом. "
    "Основной ответ возвращай в markdown. "
    "Генерируй artifacts только когда пользователь явно просит создать файл."
)
AI_RUN_TERMINAL_STATUSES = {"completed", "failed"}
AI_RUN_STAGE_QUEUED = "queued"
AI_RUN_STAGE_ANALYZING_REQUEST = "analyzing_request"
AI_RUN_STAGE_READING_FILES = "reading_files"
AI_RUN_STAGE_RETRIEVING_KB = "retrieving_kb"
AI_RUN_STAGE_CHECKING_ITINVENT = "checking_itinvent"
AI_RUN_STAGE_SEARCHING_EQUIPMENT = "searching_equipment"
AI_RUN_STAGE_OPENING_EQUIPMENT_CARD = "opening_equipment_card"
AI_RUN_STAGE_GENERATING_ANSWER = "generating_answer"
AI_RUN_STAGE_GENERATING_FILES = "generating_files"
AI_RUN_STAGE_COMPLETED = "completed"
AI_RUN_STAGE_FAILED = "failed"
AI_RUN_STAGE_STATUS_TEXTS = {
    AI_RUN_STAGE_QUEUED: "Запрос принят. Ставлю задачу в очередь.",
    AI_RUN_STAGE_ANALYZING_REQUEST: "Анализирую ваш запрос.",
    AI_RUN_STAGE_READING_FILES: "Изучаю вложенные файлы и контекст.",
    AI_RUN_STAGE_RETRIEVING_KB: "Проверяю базу знаний и документы.",
    AI_RUN_STAGE_GENERATING_ANSWER: "Формирую ответ.",
    AI_RUN_STAGE_GENERATING_FILES: "Подготавливаю итоговые файлы.",
    AI_RUN_STAGE_CHECKING_ITINVENT: "Проверяю данные ITinvent.",
    AI_RUN_STAGE_SEARCHING_EQUIPMENT: "Ищу оборудование.",
    AI_RUN_STAGE_OPENING_EQUIPMENT_CARD: "Открываю карточку устройства.",
    AI_RUN_STAGE_FAILED: "Не удалось обработать запрос.",
}
AI_CONTEXT_DB_MESSAGE_WINDOW = 12
AI_CONTEXT_RENDERED_MESSAGE_WINDOW = 10
AI_CONTEXT_ATTACHMENT_NAME_LIMIT = 3
AI_FILE_CONTEXT_TEXT_LIMIT = 9000
AI_TOOL_CALL_LIMIT = 3
AI_TOOL_ROUND_LIMIT = 3
DEFAULT_BOT_LIVE_DATA_SEED_SETTING_KEY = "ai_chat.default_bot_live_data_seed_v1"
AI_ITINVENT_TOOL_ROUTING_GUIDE = (
    "Tool routing for live ITinvent requests:\n"
    "- ITinvent tools use the current selected database by default. If the user is admin and the bot is in admin_multi_db mode, "
    "you may pass database_id for a specific database mentioned by the user, or use multi-db search for cross-database lookup.\n"
    "- Questions about the current database, available databases, selected database or multi-db access: use database current. "
    "Do not answer database availability questions from assumptions.\n"
    "- Exact inventory numbers, serial numbers, hardware serials, MAC addresses, hostnames or domains: "
    "use equipment search first, then equipment card for a single concrete device.\n"
    "- Employee or department questions: use employee search, then employee equipment list.\n"
    "- Broad equipment questions about categories, vendors, models, departments, branches or locations: "
    "use universal equipment search.\n"
    "- Combined equipment type + branch/location/address questions, for example 'мониторы на Грибоедова 64': "
    "use universal equipment search with the full user phrase so the tool can normalize type and place together.\n"
    "- Count, summary, inventory analytics and grouping questions by branch, location, type, status, employee, "
    "department, model or vendor: use analytics summary.\n"
    "- Consumables, cartridges, components and stock questions: use consumables search.\n"
    "- Branch inventory questions: resolve the branch, then use branch equipment list.\n"
    "- Transfer/assign/move equipment: resolve exact equipment and exact existing employee first, then use transfer draft. "
    "If an inventory number or employee is ambiguous or missing, ask a clarifying question instead of drafting.\n"
    "- Consume, write off or stock quantity changes: resolve exact consumable first, then use a draft action tool. "
    "Draft action tools only create confirmation cards; they do not modify ITinvent.\n"
    "- Use type/status/branch/location directory tools to clarify canonical labels before asking the user."
)
AI_FILE_TOOL_ROUTING_GUIDE = (
    "File generation routing:\n"
    "- When the user asks to create/export/send a polished report, inventory report, summary document, PDF or Excel report, prefer ai.files.report.\n"
    "- Use ai.files.create for simpler raw files, one-off text/JSON/CSV exports, or when you already have exact file rows/content.\n"
    "- If the file needs live ITinvent data, call the needed ITinvent tools first, then create the file from accumulated tool results.\n"
    "- For ITinvent equipment exports, always include these columns: \u0418\u043d\u0432. \u043d\u043e\u043c\u0435\u0440, \u0421\u0435\u0440\u0438\u0439\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440, \u0422\u0438\u043f, \u041c\u043e\u0434\u0435\u043b\u044c, \u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a, \u0421\u0442\u0430\u0442\u0443\u0441, \u0424\u0438\u043b\u0438\u0430\u043b, \u041b\u043e\u043a\u0430\u0446\u0438\u044f. Use serial_no from tool results; if empty, use \u2014.\n"
    "- Markdown tables and generated Excel/CSV tables must have the same columns, same order and same rows. Pass rows as arrays of row arrays or row objects; never pass a flat list of cells.\n"
    "- For report tables, use tables[].columns when you need fixed order or translated column labels; keep tables[].rows as row objects or row arrays.\n"
    "- For multi-table reports, put each logical table in tables[] so Excel can create separate sheets and DOCX/PDF can render real tables.\n"
    "- If the file is based on an attachment, use only the extracted attachment context that is present in the prompt; if it is empty, say that extraction did not provide enough text.\n"
    "- Supported formats are xlsx, csv, docx, pdf, txt, md and json. For unsupported formats, offer the closest supported format."
)
AI_OFFICE_TOOL_ROUTING_GUIDE = (
    "Office tool routing:\n"
    "- Mail questions like find/show/open who sent an email: use office.mail.search, then office.mail.get_message for one concrete message.\n"
    "- Recipient lookup before drafting email: use office.mail.contacts.resolve.\n"
    "- Mail send/reply requests: create office.action.mail_send_draft or office.action.mail_reply_draft. Never claim mail was sent before confirmation.\n"
    "- Do not include the user's signature in mail body; backend adds the saved mailbox signature automatically during confirmed send.\n"
    "- If the user asks to attach a file from this chat, include chat attachment_refs. If the file must be created first, call ai.files.create/ai.files.report, then pass the returned data.files as generated_file_specs into office.action.mail_send_draft or office.action.mail_reply_draft.\n"
    "- Task questions like find/show/status/comments: use office.tasks.search, then office.tasks.get for one concrete task.\n"
    "- Task create/comment/status requests: create the matching office.action.* draft. Never claim a task was created or changed before confirmation.\n"
    "- Workday summary, urgent items, unread mail or what needs attention: use office.workday.summary.\n"
    "- If recipient, task, assignee, controller, project, message or due date is ambiguous, resolve first or ask a short clarification."
)
AI_REQUEST_UNDERSTANDING_GUIDE = (
    "User request understanding and query coaching:\n"
    "- Users may write with typos, missing punctuation, mixed Russian/English terms, or short phrases. Infer the likely business intent from context and enabled tools.\n"
    "- If the intent is clear enough to act safely, silently normalize the request and use the right tools. Do not lecture the user about wording.\n"
    "- If a required slot is missing or ambiguous, ask exactly one short clarifying question and include a small Russian section '\u041c\u043e\u0436\u043d\u043e \u043d\u0430\u043f\u0438\u0441\u0430\u0442\u044c \u0442\u0430\u043a:' with 2-3 ready-to-copy example requests.\n"
    "- For ITinvent examples, include concrete slots such as inventory number, employee, branch, location, type, status, period or database when relevant.\n"
    "- For file/report examples, include data scope, format, columns/grouping, and whether to send the generated file by email.\n"
    "- For mail/task examples, include recipient/task, subject/action, deadline/status, and attachment intent when relevant.\n"
    "- If the user asks how to formulate a request, do not call live tools; answer with concise ready-to-copy request templates."
)
AI_ITINVENT_STRUCTURED_RESPONSE_GUIDE = (
    "When you answer with live ITinvent data, produce a structured detailed markdown answer in Russian. "
    "Do not return a dry list of inventory numbers when richer fields are available. "
    "For any equipment markdown table, use columns '\u0418\u043d\u0432. \u043d\u043e\u043c\u0435\u0440', '\u0421\u0435\u0440\u0438\u0439\u043d\u044b\u0439 \u043d\u043e\u043c\u0435\u0440', '\u0422\u0438\u043f', '\u041c\u043e\u0434\u0435\u043b\u044c', '\u0421\u043e\u0442\u0440\u0443\u0434\u043d\u0438\u043a', '\u0421\u0442\u0430\u0442\u0443\u0441', '\u0424\u0438\u043b\u0438\u0430\u043b', '\u041b\u043e\u043a\u0430\u0446\u0438\u044f'. "
    "Always take the serial value from serial_no; if it is empty, keep the column and write \u2014. "
    "When creating an Excel or CSV from a markdown table, use the same columns, order and rows in the file tool. "
    "For employee equipment answers use sections like '## Итог' and '## Устройства' with type/model, inventory number, "
    "serial number, status and location. For exact device cards use sections 'Устройство', 'Закрепление', 'Локация', "
    "'Сеть', 'Статус', 'Примечание'. For broad search answers use '## Найдено', a short grouped summary, a few relevant "
    "examples, and one narrowing suggestion when the result set is broad. For consumables include model, type, quantity, "
    "branch and location. For analytics answers show totals and top groups first. If a tool result has truncated=true, "
    "explicitly state how many rows were returned and the total. Show network fields and owner email by default only "
    "for exact single-device answers. For transfer draft actions, explicitly say confirmation will perform the move, "
    "write ITinvent history and generate a transfer act. For all draft actions, explain that the operation is prepared "
    "and requires the user to press the confirmation card; never claim that ITinvent was changed before confirmation."
)
AI_JSON_OUTPUT_LOCK = (
    "Return exactly one JSON object matching the provided schema. "
    "No markdown fences. No text outside JSON."
)
AI_KB_ATTACHMENT_SEND_SCHEMA = {
    "anyOf": [
        {"type": "null"},
        {
            "type": "object",
            "properties": {
                "article_id": {"type": "string"},
                "attachment_id": {"type": "string"},
            },
            "required": ["article_id", "attachment_id"],
            "additionalProperties": False,
        },
    ]
}
AI_ARTIFACTS_SCHEMA = {
    "type": "array",
    "items": {
        "type": "object",
        "additionalProperties": True,
    },
}
AI_TOOL_CALLS_SCHEMA = {
    "type": "array",
    "maxItems": AI_TOOL_CALL_LIMIT,
    "items": {
        "type": "object",
        "properties": {
            "tool_id": {"type": "string"},
            "args": {
                "type": "object",
                "additionalProperties": True,
            },
        },
        "required": ["tool_id", "args"],
        "additionalProperties": False,
    },
}
AI_CHAT_RESPONSE_SCHEMA_WITH_TOOLS = {
    "type": "object",
    "properties": {
        "answer_markdown": {"type": "string"},
        "artifacts": AI_ARTIFACTS_SCHEMA,
        "kb_attachment_send": AI_KB_ATTACHMENT_SEND_SCHEMA,
        "tool_calls": AI_TOOL_CALLS_SCHEMA,
    },
    "required": ["answer_markdown", "artifacts", "kb_attachment_send", "tool_calls"],
    "additionalProperties": False,
}
AI_CHAT_RESPONSE_SCHEMA_FINAL = {
    "type": "object",
    "properties": {
        "answer_markdown": {"type": "string"},
        "artifacts": AI_ARTIFACTS_SCHEMA,
        "kb_attachment_send": AI_KB_ATTACHMENT_SEND_SCHEMA,
    },
    "required": ["answer_markdown", "artifacts", "kb_attachment_send"],
    "additionalProperties": False,
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat()


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _json_loads(value: object, fallback):
    try:
        parsed = json.loads(str(value or ""))
    except Exception:
        return fallback
    return parsed if isinstance(parsed, type(fallback)) else fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value if value is not None else {}, ensure_ascii=False)


def _default_bot_enabled_tools() -> list[str]:
    return list(DEFAULT_ITINVENT_TOOL_IDS)


def _is_itinvent_tool_id(tool_id: object) -> bool:
    return _normalize_text(tool_id).startswith("itinvent.")


def _is_file_tool_id(tool_id: object) -> bool:
    return _normalize_text(tool_id) in {AI_TOOL_FILES_CREATE, AI_TOOL_FILES_REPORT}


def _is_office_tool_id(tool_id: object) -> bool:
    return _normalize_text(tool_id).startswith("office.")


def _default_bot_tool_settings() -> dict[str, Any]:
    return normalize_tool_settings(
        {
            "multi_db_mode": AI_TOOL_MULTI_DB_MODE_SINGLE,
            "allowed_databases": [],
        }
    )


def _is_live_data_enabled(enabled_tools: Any) -> bool:
    return any(_is_itinvent_tool_id(tool_id) for tool_id in normalize_enabled_tools(enabled_tools))


def _truncate(value: object, limit: int = 12000) -> str:
    text = _normalize_text(value)
    return text[:limit]


def _merge_usage(*items: dict[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "model": "",
    }
    for item in items:
        payload = item if isinstance(item, dict) else {}
        merged["prompt_tokens"] += int(payload.get("prompt_tokens") or 0)
        merged["completion_tokens"] += int(payload.get("completion_tokens") or 0)
        merged["total_tokens"] += int(payload.get("total_tokens") or 0)
        if _normalize_text(payload.get("model")):
            merged["model"] = _normalize_text(payload.get("model"))
    return merged


def _normalize_tool_calls(value: Any, *, limit: int = AI_TOOL_CALL_LIMIT) -> list[dict[str, Any]]:
    normalized_calls: list[dict[str, Any]] = []
    for item in list(value or []):
        if len(normalized_calls) >= max(1, int(limit or AI_TOOL_CALL_LIMIT)):
            break
        if not isinstance(item, dict):
            continue
        tool_id = _normalize_text(item.get("tool_id"))
        if not tool_id:
            continue
        raw_args = item.get("args")
        normalized_calls.append(
            {
                "tool_id": tool_id,
                "args": raw_args if isinstance(raw_args, dict) else {},
            }
        )
    return normalized_calls


def _format_tool_results_for_prompt(results: list[dict[str, Any]]) -> str:
    normalized = [item for item in list(results or []) if isinstance(item, dict)]
    if not normalized:
        return "No tool results."
    return _json_dumps(normalized)


_EQUIPMENT_EXPORT_COLUMNS = [
    "Инв. номер",
    "Серийный номер",
    "Тип",
    "Модель",
    "Сотрудник",
    "Статус",
    "Филиал",
    "Локация",
]


def _item_looks_like_equipment(item: Any) -> bool:
    if not isinstance(item, dict):
        return False
    return bool(item.get("inv_no") or item.get("serial_no") or item.get("type_name") or item.get("model_name"))


def _collect_best_equipment_items(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    best: list[dict[str, Any]] = []
    for result in list(results or []):
        if not isinstance(result, dict) or not bool(result.get("ok")):
            continue
        if not _normalize_text(result.get("tool_id")).startswith("itinvent."):
            continue
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        items = [item for item in list(data.get("items") or []) if _item_looks_like_equipment(item)]
        if len(items) > len(best):
            best = items
    return best


def _equipment_export_row(item: dict[str, Any]) -> dict[str, str]:
    return {
        "Инв. номер": _normalize_text(item.get("inv_no")) or "—",
        "Серийный номер": _normalize_text(item.get("serial_no")) or "—",
        "Тип": _normalize_text(item.get("type_name") or item.get("name")) or "—",
        "Модель": _normalize_text(item.get("model_name") or item.get("name")) or "—",
        "Сотрудник": _normalize_text(item.get("owner_name") or item.get("employee_name")) or "—",
        "Статус": _normalize_text(item.get("status")) or "—",
        "Филиал": _normalize_text(item.get("branch")) or "—",
        "Локация": _normalize_text(item.get("location")) or "—",
    }


def _table_rows_from_file_spec(spec: dict[str, Any]) -> list[list[Any]]:
    metadata = spec.get("metadata") if isinstance(spec.get("metadata"), dict) else {}
    for table in list(metadata.get("report_tables") or []):
        if isinstance(table, dict) and isinstance(table.get("rows"), list) and table.get("rows"):
            return list(table.get("rows") or [])
    for sheet in list(spec.get("sheets") or []):
        if not isinstance(sheet, dict) or not isinstance(sheet.get("rows"), list) or not sheet.get("rows"):
            continue
        title = _normalize_text(sheet.get("title")).casefold()
        if title in {"сводка", "summary", "итог"}:
            continue
        return list(sheet.get("rows") or [])
    if isinstance(spec.get("rows"), list) and spec.get("rows"):
        return list(spec.get("rows") or [])
    return []


def _table_data_row_count(rows: list[Any]) -> int:
    if not rows:
        return 0
    if all(isinstance(row, dict) for row in rows):
        return len(rows)
    if all(isinstance(row, list) for row in rows):
        return max(0, len(rows) - 1)
    return len(rows)


def _file_spec_equipment_like(spec: dict[str, Any]) -> bool:
    rows = _table_rows_from_file_spec(spec)
    headers = rows[0] if rows and isinstance(rows[0], list) else []
    header_text = " ".join(_normalize_text(item).casefold() for item in headers)
    title_text = " ".join(
        [
            _normalize_text(spec.get("file_name")),
            _normalize_text(spec.get("title")),
            _normalize_text((spec.get("metadata") or {}).get("report_title") if isinstance(spec.get("metadata"), dict) else ""),
        ]
    ).casefold()
    return (
        "инв" in header_text
        or "серийн" in header_text
        or "оборуд" in title_text
        or "техник" in title_text
        or "equipment" in title_text
    )


def _replace_equipment_table_in_file_spec(spec: dict[str, Any], equipment_items: list[dict[str, Any]]) -> dict[str, Any]:
    repaired = copy.deepcopy(spec)
    rows = [_equipment_export_row(item) for item in equipment_items]
    table = [_EQUIPMENT_EXPORT_COLUMNS] + [[row.get(column, "—") for column in _EQUIPMENT_EXPORT_COLUMNS] for row in rows]
    metadata = repaired.get("metadata") if isinstance(repaired.get("metadata"), dict) else {}
    report_tables = list(metadata.get("report_tables") or [])
    table_title = "Оборудование"
    if report_tables and isinstance(report_tables[0], dict):
        table_title = _normalize_text(report_tables[0].get("title")) or table_title
        report_tables[0] = {
            **report_tables[0],
            "columns": list(_EQUIPMENT_EXPORT_COLUMNS),
            "rows": table,
        }
    else:
        report_tables = [{"title": table_title, "columns": list(_EQUIPMENT_EXPORT_COLUMNS), "rows": table}]
    metadata["report"] = True
    metadata["report_tables"] = report_tables
    repaired["metadata"] = metadata
    if repaired.get("sheets"):
        sheets: list[dict[str, Any]] = []
        replaced = False
        for sheet in list(repaired.get("sheets") or []):
            if not isinstance(sheet, dict):
                continue
            title = _normalize_text(sheet.get("title")).casefold()
            if not replaced and title not in {"сводка", "summary", "итог"}:
                sheets.append({"title": table_title, "rows": table, "header_row_index": 1})
                replaced = True
            else:
                sheets.append(sheet)
        if not replaced:
            sheets.append({"title": table_title, "rows": table, "header_row_index": 1})
        repaired["sheets"] = sheets
    elif repaired.get("rows"):
        repaired["rows"] = table
    return repaired


def _repair_generated_file_specs_with_tool_data(
    specs: list[dict[str, Any]],
    results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    equipment_items = _collect_best_equipment_items(results)
    if not equipment_items:
        return specs
    repaired_specs: list[dict[str, Any]] = []
    for spec in list(specs or []):
        if not isinstance(spec, dict):
            continue
        rows = _table_rows_from_file_spec(spec)
        if (
            _file_spec_equipment_like(spec)
            and _table_data_row_count(rows) < len(equipment_items)
        ):
            repaired_specs.append(_replace_equipment_table_in_file_spec(spec, equipment_items))
        else:
            repaired_specs.append(spec)
    return repaired_specs


def _dedupe_generated_file_specs(specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for spec in list(specs or []):
        if not isinstance(spec, dict):
            continue
        key = (_normalize_text(spec.get("file_name")).casefold(), _normalize_text(spec.get("format")).casefold())
        if not key[0] and not key[1]:
            key = (_json_dumps(spec)[:120], "")
        previous = by_key.get(key)
        if previous is None or _table_data_row_count(_table_rows_from_file_spec(spec)) >= _table_data_row_count(_table_rows_from_file_spec(previous)):
            by_key[key] = spec
    return list(by_key.values())


def _extract_generated_file_specs_from_tool_results(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in list(results or []):
        if not isinstance(result, dict):
            continue
        if _normalize_text(result.get("tool_id")) not in {AI_TOOL_FILES_CREATE, AI_TOOL_FILES_REPORT} or not bool(result.get("ok")):
            continue
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        for item in list(data.get("files") or []):
            if not isinstance(item, dict):
                continue
            fingerprint = _json_dumps({
                "format": item.get("format"),
                "file_name": item.get("file_name"),
                "content": item.get("content"),
                "rows": item.get("rows"),
                "sheets": item.get("sheets"),
            })
            if fingerprint in seen:
                continue
            seen.add(fingerprint)
            files.append(item)
    return _dedupe_generated_file_specs(_repair_generated_file_specs_with_tool_data(files, results))


def _artifacts_allowed_for_file_specs(file_specs: list[dict[str, Any]]) -> bool:
    return not bool(file_specs)


def _extract_generated_file_errors_from_tool_traces(traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    for trace in list(traces or []):
        if not isinstance(trace, dict) or not _is_file_tool_id(trace.get("tool_id")):
            continue
        error = _normalize_text(trace.get("error"))
        if not error:
            continue
        diagnostic = trace.get("diagnostic") if isinstance(trace.get("diagnostic"), dict) else {}
        errors.append({
            "tool_id": _normalize_text(trace.get("tool_id")) or None,
            "error_code": _normalize_text(diagnostic.get("error_code")) or "tool_error",
            "message": _normalize_text(diagnostic.get("message")) or error,
            "field_path": _normalize_text(diagnostic.get("field_path")) or None,
            "suggested_fix": _normalize_text(diagnostic.get("suggested_fix")) or None,
        })
    return errors


def _summarize_generated_files_message(files_message: dict[str, Any] | None) -> list[dict[str, Any]]:
    message = files_message if isinstance(files_message, dict) else {}
    message_id = _normalize_text(message.get("id")) or None
    rows: list[dict[str, Any]] = []
    for attachment in list(message.get("attachments") or []):
        if not isinstance(attachment, dict):
            continue
        file_name = _normalize_text(attachment.get("file_name"))
        file_format = Path(file_name).suffix.lstrip(".").lower()
        rows.append(
            {
                "message_id": message_id,
                "attachment_id": _normalize_text(attachment.get("id")) or None,
                "file_name": file_name,
                "format": file_format or None,
                "size_bytes": int(attachment.get("file_size") or 0),
            }
        )
    return rows


def _log_ai_run_timing(stage: str, started_at: float, **context: Any) -> None:
    took_ms = (time.perf_counter() - started_at) * 1000.0
    payload = " ".join([f"{key}={value}" for key, value in context.items() if value is not None])
    message = f"ai_chat.run.{stage} duration_ms={took_ms:.1f}"
    if payload:
        message = f"{message} {payload}"
    logger.info(message)


def get_ai_chat_runtime_metrics() -> dict[str, Any]:
    return {
        "last_run_duration_ms": round(float(_AI_LAST_RUN_DURATION_MS or 0.0), 1),
        "last_run_completed_at": _iso(_AI_LAST_RUN_COMPLETED_AT),
    }


def _format_fallback_tool_answer(results: list[dict[str, Any]]) -> str:
    normalized = [item for item in list(results or []) if isinstance(item, dict)]
    if not normalized:
        return "Не удалось получить корректный ответ модели."
    lines = ["## Результат"]
    used_sources: list[str] = []
    for result in normalized:
        tool_id = _normalize_text(result.get("tool_id")) or "unknown"
        database_id = _normalize_text(result.get("database_id"))
        if database_id and database_id not in used_sources:
            used_sources.append(database_id)
        if not bool(result.get("ok")):
            lines.append(f"- `{tool_id}`: ошибка - {_normalize_text(result.get('error')) or 'неизвестная ошибка'}")
            continue
        data = result.get("data") if isinstance(result.get("data"), dict) else {}
        title_parts = [f"`{tool_id}`"]
        if data.get("query"):
            title_parts.append(f"запрос: {data.get('query')}")
        if data.get("branch_name"):
            title_parts.append(f"филиал: {data.get('branch_name')}")
        returned_count = data.get("returned_count", data.get("count"))
        total = data.get("total")
        if returned_count is not None:
            title_parts.append(f"показано: {returned_count}")
        if total is not None:
            title_parts.append(f"всего: {total}")
        if data.get("truncated"):
            title_parts.append("результат усечён")
        lines.append(f"- {', '.join(str(part) for part in title_parts if part)}")
        rows = data.get("rows") if isinstance(data.get("rows"), list) else None
        items = data.get("items") if isinstance(data.get("items"), list) else None
        preview = rows if rows is not None else items
        if preview:
            for item in preview[:40]:
                if not isinstance(item, dict):
                    continue
                summary = _normalize_text(item.get("summary")) or _normalize_text(item.get("key")) or _normalize_text(item.get("name"))
                if not summary:
                    summary = ", ".join(
                        str(value)
                        for value in [
                            item.get("inv_no"),
                            item.get("type_name"),
                            item.get("model_name"),
                            item.get("owner_name"),
                            item.get("branch"),
                            item.get("location"),
                        ]
                        if value not in (None, "")
                    )
                if summary:
                    extra = ""
                    if rows is not None:
                        extra_parts = []
                        if item.get("count") is not None:
                            extra_parts.append(f"count: {item.get('count')}")
                        if item.get("qty_total") is not None:
                            extra_parts.append(f"qty_total: {item.get('qty_total')}")
                        extra = f" ({', '.join(extra_parts)})" if extra_parts else ""
                    lines.append(f"  - {summary}{extra}")
            if len(preview) > 40:
                lines.append(f"  - ... ещё {len(preview) - 40} строк в результате инструмента")
    if used_sources:
        lines.append("")
        lines.append(f"Источник: ITinvent / {', '.join(used_sources)}")
    return "\n".join(lines)[:12000]


def _normalize_kb_attachment_send(value: Any) -> dict[str, str] | None:
    if not isinstance(value, dict):
        return None
    article_id = _normalize_text(value.get("article_id"))
    attachment_id = _normalize_text(value.get("attachment_id"))
    if not article_id or not attachment_id:
        return None
    return {
        "article_id": article_id,
        "attachment_id": attachment_id,
    }


def _can_auto_send_template(candidates: list[dict[str, Any]]) -> bool:
    normalized_candidates = [item for item in list(candidates or []) if isinstance(item, dict)]
    if len(normalized_candidates) == 1:
        return True
    if len(normalized_candidates) < 2:
        return False
    first_score = int(normalized_candidates[0].get("score") or 0)
    second_score = int(normalized_candidates[1].get("score") or 0)
    return first_score >= 12 and first_score >= (second_score + 8)


def _build_upload_file(*, file_name: str, content_type: str, payload: bytes) -> UploadFile:
    return UploadFile(
        filename=file_name,
        file=io.BytesIO(bytes(payload or b"")),
        headers={"content-type": content_type or "application/octet-stream"},
    )


def _safe_temperature(value: object, default: float = 0.2) -> float:
    try:
        parsed = float(value)
    except Exception:
        return default
    return max(0.0, min(2.0, parsed))


def _safe_max_tokens(value: object, default: int = 2000) -> int:
    try:
        parsed = int(value)
    except Exception:
        return default
    return max(256, min(16000, parsed))


def _resolve_run_status_text(*, status: str, stage: str | None = None) -> str:
    normalized_status = _normalize_text(status) or AI_RUN_STAGE_QUEUED
    normalized_stage = _normalize_text(stage) or normalized_status
    if normalized_status == "completed":
        return ""
    if normalized_status == "failed":
        return AI_RUN_STAGE_STATUS_TEXTS[AI_RUN_STAGE_FAILED]
    return AI_RUN_STAGE_STATUS_TEXTS.get(normalized_stage) or AI_RUN_STAGE_STATUS_TEXTS.get(normalized_status) or ""


def _collect_attachment_display_names(
    attachments: list[ChatMessageAttachment] | None,
    *,
    limit: int = AI_CONTEXT_ATTACHMENT_NAME_LIMIT,
) -> tuple[int, list[str]]:
    items = [item for item in list(attachments or []) if item is not None]
    display_names: list[str] = []
    max_items = max(1, int(limit or 1))
    for index, attachment in enumerate(items):
        if index >= max_items:
            break
        display_names.append(
            _normalize_text(getattr(attachment, "file_name", None))
            or _normalize_text(getattr(attachment, "storage_name", None))
            or f"attachment-{index + 1}"
        )
    remaining = len(items) - len(display_names)
    if remaining > 0:
        display_names.append(f"... and {remaining} more")
    return len(items), display_names


def _build_attachment_request_fallback(attachments: list[ChatMessageAttachment] | None) -> str:
    count, display_names = _collect_attachment_display_names(attachments)
    if count <= 0 or not display_names:
        return ""
    prefix = "User sent file" if count == 1 else "User sent files"
    return f"{prefix}: {', '.join(display_names)}."


def _build_file_message_inline_text(attachments: list[ChatMessageAttachment] | None) -> str:
    count, display_names = _collect_attachment_display_names(attachments)
    if count <= 0 or not display_names:
        return "[file message]"
    label = "file" if count == 1 else "files"
    return f"[{label}: {', '.join(display_names)}]"


def _user_has_permission(user_payload: dict[str, Any] | None, permission: str) -> bool:
    if not isinstance(user_payload, dict):
        return False
    return authorization_service.has_permission(
        user_payload.get("role"),
        permission,
        use_custom_permissions=bool(user_payload.get("use_custom_permissions", False)),
        custom_permissions=user_payload.get("custom_permissions") or [],
    )


@dataclass(slots=True)
class AiConversationRuntime:
    bot: AppAiBot
    mapping: AppAiBotConversation


class AiChatService:
    def __init__(self) -> None:
        self._attachment_text_cache: dict[str, str] = {}
        self._attachment_text_cache_limit = 256

    def initialize_runtime(self) -> None:
        ensure_app_schema_initialized()
        try:
            self.ensure_default_bot()
        except Exception as exc:
            logger.warning("Skipping AI chat bootstrap: %s", exc)

    def ensure_default_bot(self) -> dict[str, Any]:
        ensure_app_schema_initialized()
        def _ensure_bot() -> dict[str, Any]:
            with app_session() as session:
                apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                default_enabled_tools = _default_bot_enabled_tools()
                default_tool_settings = _default_bot_tool_settings()
                seeded_once = self._read_bool_setting(session, DEFAULT_BOT_LIVE_DATA_SEED_SETTING_KEY)
                bot = session.execute(
                    select(AppAiBot).where(AppAiBot.slug == DEFAULT_BOT_SLUG)
                ).scalar_one_or_none()
                if bot is None:
                    now = _utc_now()
                    bot = AppAiBot(
                        id=str(uuid4()),
                        slug=DEFAULT_BOT_SLUG,
                        title=DEFAULT_BOT_TITLE,
                        description=DEFAULT_BOT_DESCRIPTION,
                        system_prompt=DEFAULT_BOT_PROMPT,
                        model=DEFAULT_BOT_MODEL,
                        temperature=0.2,
                        max_tokens=2000,
                        allowed_kb_scope_json="[]",
                        enabled_tools_json=_json_dumps(default_enabled_tools),
                        tool_settings_json=_json_dumps(default_tool_settings),
                        allow_file_input=True,
                        allow_generated_artifacts=True,
                        allow_kb_document_delivery=False,
                        is_enabled=True,
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(bot)
                    session.flush()
                    self._write_bool_setting(session, DEFAULT_BOT_LIVE_DATA_SEED_SETTING_KEY, True)
                else:
                    current_enabled_tools = normalize_enabled_tools(
                        _json_loads(getattr(bot, "enabled_tools_json", "[]"), [])
                    )
                    if current_enabled_tools:
                        if not seeded_once:
                            self._write_bool_setting(session, DEFAULT_BOT_LIVE_DATA_SEED_SETTING_KEY, True)
                    elif not seeded_once:
                        bot.enabled_tools_json = _json_dumps(default_enabled_tools)
                        bot.tool_settings_json = _json_dumps(default_tool_settings)
                        bot.updated_at = _utc_now()
                        self._write_bool_setting(session, DEFAULT_BOT_LIVE_DATA_SEED_SETTING_KEY, True)
                self._ensure_bot_user(session=session, bot=bot)
                return self._serialize_bot(bot)

        return run_with_transient_lock_retry(_ensure_bot)

    def get_openrouter_status(self) -> dict[str, Any]:
        return openrouter_client.get_status()

    def list_bots(self, *, current_user_id: int | None = None) -> dict[str, Any]:
        self.initialize_runtime()
        def _load_rows() -> tuple[list[AppAiBot], dict[str, str]]:
            with app_session() as session:
                apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                rows = list(
                    session.execute(
                        select(AppAiBot).where(AppAiBot.is_enabled.is_(True)).order_by(AppAiBot.title.asc())
                    ).scalars()
                )
                conversation_ids_by_bot: dict[str, str] = {}
                if current_user_id and rows:
                    mappings = list(
                        session.execute(
                            select(AppAiBotConversation).where(
                                AppAiBotConversation.user_id == int(current_user_id),
                                AppAiBotConversation.bot_id.in_([item.id for item in rows]),
                            )
                        ).scalars()
                    )
                    conversation_ids_by_bot = {
                        item.bot_id: _normalize_text(item.conversation_id)
                        for item in mappings
                        if _normalize_text(item.bot_id) and _normalize_text(item.conversation_id)
                    }
                return rows, conversation_ids_by_bot

        rows, conversation_ids_by_bot = run_with_transient_lock_retry(_load_rows)
        status = self.get_openrouter_status()
        return {
            "items": [
                self._serialize_bot(
                    item,
                    configured=status["configured"],
                    conversation_id=conversation_ids_by_bot.get(item.id),
                )
                for item in rows
            ],
            "configured": bool(status["configured"]),
            "default_model": str(status.get("default_model") or ""),
        }

    def list_admin_bots(self) -> list[dict[str, Any]]:
        self.initialize_runtime()
        status = self.get_openrouter_status()
        def _load_admin_bots() -> list[dict[str, Any]]:
            with app_session() as session:
                apply_postgres_local_timeouts(session, lock_timeout_ms=1500, statement_timeout_ms=5000)
                rows = list(session.execute(select(AppAiBot).order_by(AppAiBot.title.asc())).scalars())
                latest_runs = self._latest_runs_by_bot(session)
                return [
                    self._serialize_bot(
                        item,
                        configured=status["configured"],
                        admin=True,
                        latest_run=latest_runs.get(item.id),
                    )
                    for item in rows
                ]

        return run_with_transient_lock_retry(_load_admin_bots)

    def create_bot(self, payload: dict[str, Any]) -> dict[str, Any]:
        self.initialize_runtime()
        slug = _normalize_text(payload.get("slug")).lower()
        if not slug:
            raise ValueError("slug is required")
        with app_session() as session:
            if session.execute(select(AppAiBot).where(AppAiBot.slug == slug)).scalar_one_or_none() is not None:
                raise ValueError("AI bot already exists")
            bot = AppAiBot(
                id=str(uuid4()),
                slug=slug,
                title=_normalize_text(payload.get("title")) or slug,
                description=_normalize_text(payload.get("description")),
                system_prompt=_normalize_text(payload.get("system_prompt")),
                model=_normalize_text(payload.get("model")),
                temperature=_safe_temperature(payload.get("temperature")),
                max_tokens=_safe_max_tokens(payload.get("max_tokens")),
                allowed_kb_scope_json=json.dumps(list(payload.get("allowed_kb_scope") or []), ensure_ascii=False),
                enabled_tools_json=_json_dumps(normalize_enabled_tools(payload.get("enabled_tools"))),
                tool_settings_json=_json_dumps(normalize_tool_settings(payload.get("tool_settings"))),
                allow_file_input=bool(payload.get("allow_file_input", True)),
                allow_generated_artifacts=bool(payload.get("allow_generated_artifacts", True)),
                allow_kb_document_delivery=bool(payload.get("allow_kb_document_delivery", False)),
                is_enabled=bool(payload.get("is_enabled", True)),
                created_at=_utc_now(),
                updated_at=_utc_now(),
            )
            session.add(bot)
            session.flush()
            self._ensure_bot_user(session=session, bot=bot)
            return self._serialize_bot(bot, configured=self.get_openrouter_status()["configured"], admin=True)

    def update_bot(self, bot_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.initialize_runtime()
        with app_session() as session:
            bot = session.get(AppAiBot, _normalize_text(bot_id))
            if bot is None:
                raise LookupError("AI bot not found")
            if "title" in payload and payload.get("title") is not None:
                bot.title = _normalize_text(payload.get("title")) or bot.title
            if "description" in payload and payload.get("description") is not None:
                bot.description = _normalize_text(payload.get("description"))
            if "system_prompt" in payload and payload.get("system_prompt") is not None:
                bot.system_prompt = _normalize_text(payload.get("system_prompt"))
            if "model" in payload and payload.get("model") is not None:
                bot.model = _normalize_text(payload.get("model"))
            if "temperature" in payload and payload.get("temperature") is not None:
                bot.temperature = _safe_temperature(payload.get("temperature"), default=float(bot.temperature or 0.2))
            if "max_tokens" in payload and payload.get("max_tokens") is not None:
                bot.max_tokens = _safe_max_tokens(payload.get("max_tokens"), default=int(bot.max_tokens or 2000))
            if "allowed_kb_scope" in payload and payload.get("allowed_kb_scope") is not None:
                bot.allowed_kb_scope_json = json.dumps(list(payload.get("allowed_kb_scope") or []), ensure_ascii=False)
            if "enabled_tools" in payload and payload.get("enabled_tools") is not None:
                bot.enabled_tools_json = _json_dumps(normalize_enabled_tools(payload.get("enabled_tools")))
            if "tool_settings" in payload and payload.get("tool_settings") is not None:
                bot.tool_settings_json = _json_dumps(normalize_tool_settings(payload.get("tool_settings")))
            if "allow_file_input" in payload and payload.get("allow_file_input") is not None:
                bot.allow_file_input = bool(payload.get("allow_file_input"))
            if "allow_generated_artifacts" in payload and payload.get("allow_generated_artifacts") is not None:
                bot.allow_generated_artifacts = bool(payload.get("allow_generated_artifacts"))
            if "allow_kb_document_delivery" in payload and payload.get("allow_kb_document_delivery") is not None:
                bot.allow_kb_document_delivery = bool(payload.get("allow_kb_document_delivery"))
            if "is_enabled" in payload and payload.get("is_enabled") is not None:
                bot.is_enabled = bool(payload.get("is_enabled"))
            bot.updated_at = _utc_now()
            self._ensure_bot_user(session=session, bot=bot)
            return self._serialize_bot(bot, configured=self.get_openrouter_status()["configured"], admin=True)

    def list_recent_runs(self, *, bot_id: str, limit: int = 25) -> list[dict[str, Any]]:
        self.initialize_runtime()
        with app_session() as session:
            rows = list(
                session.execute(
                    select(AppAiBotRun)
                    .where(AppAiBotRun.bot_id == _normalize_text(bot_id))
                    .order_by(AppAiBotRun.created_at.desc())
                    .limit(max(1, min(int(limit or 25), 100)))
                ).scalars()
            )
        return [self._serialize_run(item) for item in rows]

    def open_bot_conversation(self, *, bot_id: str, current_user_id: int) -> dict[str, Any]:
        self.initialize_runtime()
        with app_session() as session:
            bot = session.get(AppAiBot, _normalize_text(bot_id))
            if bot is None or not bool(bot.is_enabled):
                raise LookupError("AI bot not found")
            mapping = session.execute(
                select(AppAiBotConversation).where(
                    AppAiBotConversation.bot_id == bot.id,
                    AppAiBotConversation.user_id == int(current_user_id),
                )
            ).scalar_one_or_none()
            if mapping is not None:
                return chat_service.get_conversation_summary(
                    current_user_id=int(current_user_id),
                    conversation_id=mapping.conversation_id,
                )

            bot_user_id = self._ensure_bot_user(session=session, bot=bot)
            now = _utc_now()
            conversation_id = str(uuid4())
            with chat_session() as chat_db:
                conversation = ChatConversation(
                    id=conversation_id,
                    kind="ai",
                    title=_normalize_text(bot.title) or DEFAULT_BOT_TITLE,
                    direct_key=None,
                    created_by_user_id=int(current_user_id),
                    created_at=now,
                    updated_at=now,
                )
                chat_db.add(conversation)
                chat_db.add(
                    ChatMember(
                        conversation_id=conversation_id,
                        user_id=int(current_user_id),
                        member_role="owner",
                        joined_at=now,
                    )
                )
                chat_db.add(
                    ChatMember(
                        conversation_id=conversation_id,
                        user_id=int(bot_user_id),
                        member_role="bot",
                        joined_at=now,
                    )
                )
                chat_db.add(
                    ChatConversationUserState(
                        conversation_id=conversation_id,
                        user_id=int(current_user_id),
                        opened_at=now,
                        updated_at=now,
                    )
                )
                chat_db.add(
                    ChatConversationUserState(
                        conversation_id=conversation_id,
                        user_id=int(bot_user_id),
                        updated_at=now,
                    )
                )
            session.add(
                AppAiBotConversation(
                    bot_id=bot.id,
                    user_id=int(current_user_id),
                    conversation_id=conversation_id,
                    created_at=now,
                    updated_at=now,
                )
            )
            session.flush()
        return chat_service.get_conversation_summary(
            current_user_id=int(current_user_id),
            conversation_id=conversation_id,
        )

    def get_conversation_status(self, *, conversation_id: str, current_user_id: int) -> dict[str, Any]:
        runtime = self._get_runtime_by_conversation(conversation_id)
        if runtime is None or int(runtime.mapping.user_id) != int(current_user_id):
            raise LookupError("AI conversation not found")
        with app_session() as session:
            latest = session.execute(
                select(AppAiBotRun)
                .where(AppAiBotRun.conversation_id == _normalize_text(conversation_id))
                .order_by(AppAiBotRun.created_at.desc())
                .limit(1)
            ).scalar_one_or_none()
        if latest is None:
            return {
                "conversation_id": _normalize_text(conversation_id),
                "bot_id": runtime.bot.id,
                "bot_title": runtime.bot.title,
                "status": None,
                "stage": None,
                "status_text": None,
                "run_id": None,
                "error_text": None,
                "updated_at": None,
            }
        return {
            "conversation_id": _normalize_text(conversation_id),
            "bot_id": runtime.bot.id,
            "bot_title": runtime.bot.title,
            "status": _normalize_text(latest.status) or None,
            "stage": _normalize_text(getattr(latest, "stage", None)) or None,
            "status_text": _normalize_text(getattr(latest, "status_text", None)) or None,
            "run_id": latest.id,
            "error_text": _normalize_text(latest.error_text) or None,
            "updated_at": _iso(latest.updated_at),
        }

    def queue_run_for_message(
        self,
        *,
        conversation_id: str,
        trigger_message_id: str,
        current_user_id: int,
        effective_database_id: str | None = None,
    ) -> Optional[dict[str, Any]]:
        runtime = self._get_runtime_by_conversation(conversation_id)
        if runtime is None or int(runtime.mapping.user_id) != int(current_user_id) or not bool(runtime.bot.is_enabled):
            return None
        user_payload = user_service.get_by_id(int(current_user_id)) or {}
        resolved_database_id = resolve_effective_database_id(
            user_payload=user_payload,
            explicit_database_id=effective_database_id,
        )
        with app_session() as session:
            existing = session.execute(
                select(AppAiBotRun).where(
                    AppAiBotRun.conversation_id == _normalize_text(conversation_id),
                    AppAiBotRun.trigger_message_id == _normalize_text(trigger_message_id),
                )
            ).scalar_one_or_none()
            if existing is not None:
                return self._serialize_run(existing)
            now = _utc_now()
            run = AppAiBotRun(
                id=str(uuid4()),
                bot_id=runtime.bot.id,
                conversation_id=_normalize_text(conversation_id),
                user_id=int(current_user_id),
                trigger_message_id=_normalize_text(trigger_message_id),
                status="queued",
                stage=AI_RUN_STAGE_QUEUED,
                status_text=_resolve_run_status_text(status="queued", stage=AI_RUN_STAGE_QUEUED),
                error_text=None,
                request_json=_json_dumps(
                    {
                        "effective_database_id": resolved_database_id,
                    }
                ),
                result_json="{}",
                usage_json="{}",
                created_at=now,
                updated_at=now,
            )
            session.add(run)
            session.flush()
            payload = self._serialize_run(run)
        self._publish_status_event(
            conversation_id=conversation_id,
            user_id=int(current_user_id),
            bot=runtime.bot,
            status="queued",
            stage=AI_RUN_STAGE_QUEUED,
            status_text=payload.get("status_text"),
            run_id=payload["id"],
        )
        return payload

    def _set_run_progress(
        self,
        *,
        run_id: str,
        conversation_id: str,
        user_id: int,
        bot: AppAiBot,
        status: str,
        stage: str | None = None,
        error_text: str | None = None,
        started_at: datetime | None = None,
        completed_at: datetime | None = None,
    ) -> dict[str, Any]:
        normalized_status = _normalize_text(status) or "queued"
        normalized_stage = _normalize_text(stage) or normalized_status
        status_text = _resolve_run_status_text(status=normalized_status, stage=normalized_stage)
        payload: dict[str, Any] = {}
        with app_session() as session:
            row = session.get(AppAiBotRun, _normalize_text(run_id))
            if row is None:
                return payload
            row.status = normalized_status
            row.stage = normalized_stage
            row.status_text = status_text or None
            row.error_text = _normalize_text(error_text) or None
            if started_at is not None and row.started_at is None:
                row.started_at = started_at
            if completed_at is not None:
                row.completed_at = completed_at
            row.updated_at = _utc_now()
            payload = self._serialize_run(row)
        self._publish_status_event(
            conversation_id=conversation_id,
            user_id=int(user_id),
            bot=bot,
            status=normalized_status,
            stage=normalized_stage,
            status_text=status_text,
            run_id=_normalize_text(run_id),
            error_text=_normalize_text(error_text) or None,
        )
        return payload

    def _resolve_kb_template_candidate_for_send(
        self,
        *,
        extracted_context: dict[str, Any] | None,
        kb_attachment_send: dict[str, str] | None,
    ) -> dict[str, Any] | None:
        if not isinstance(kb_attachment_send, dict):
            return None
        context = extracted_context if isinstance(extracted_context, dict) else {}
        if not bool(context.get("template_delivery_allowed")):
            logger.info(
                "Ignoring kb_attachment_send because template delivery is not allowed: article_id=%s attachment_id=%s",
                _normalize_text(kb_attachment_send.get("article_id")),
                _normalize_text(kb_attachment_send.get("attachment_id")),
            )
            return None
        target_article_id = _normalize_text(kb_attachment_send.get("article_id"))
        target_attachment_id = _normalize_text(kb_attachment_send.get("attachment_id"))
        for candidate in list(context.get("template_candidates") or []):
            if not isinstance(candidate, dict):
                continue
            if _normalize_text(candidate.get("article_id")) != target_article_id:
                continue
            if _normalize_text(candidate.get("attachment_id")) != target_attachment_id:
                continue
            return candidate
        logger.warning(
            "Rejected invalid kb_attachment_send candidate: article_id=%s attachment_id=%s",
            target_article_id,
            target_attachment_id,
        )
        return None

    def _send_kb_template_attachment(
        self,
        *,
        current_user_id: int,
        conversation_id: str,
        candidate: dict[str, Any],
    ) -> dict[str, Any] | None:
        article_id = _normalize_text(candidate.get("article_id"))
        attachment_id = _normalize_text(candidate.get("attachment_id"))
        if not article_id or not attachment_id:
            return None
        attachment = kb_service.get_attachment(article_id=article_id, attachment_id=attachment_id)
        if not attachment:
            logger.warning(
                "KB attachment is unavailable for auto-send: article_id=%s attachment_id=%s",
                article_id,
                attachment_id,
            )
            return None
        file_name = _normalize_text(attachment.get("file_name")) or _normalize_text(candidate.get("attachment_name")) or "template.bin"
        content_type = _normalize_text(attachment.get("content_type")) or _normalize_text(candidate.get("attachment_content_type")) or "application/octet-stream"
        payload = Path(str(attachment["path"])).read_bytes()
        upload = _build_upload_file(
            file_name=file_name,
            content_type=content_type,
            payload=payload,
        )
        try:
            files_message = chat_service.send_files(
                current_user_id=int(current_user_id),
                conversation_id=conversation_id,
                body="",
                uploads=[upload],
                defer_push_notifications=True,
            )
        finally:
            try:
                upload.file.close()
            except Exception:
                pass
        self._enqueue_message_side_effects_after_send(
            conversation_id=conversation_id,
            message_id=_normalize_text(files_message.get("id")),
        )
        return {
            "article_id": article_id,
            "attachment_id": attachment_id,
            "file_name": file_name,
            "content_type": content_type,
            "message_id": _normalize_text(files_message.get("id")) or None,
        }

    def process_next_runs(self, *, limit: int = 1) -> int:
        max_items = max(1, int(limit or 1))
        processed = 0
        while processed < max_items:
            if not self._process_single_run():
                break
            processed += 1
        return processed

    def process_next_run(self) -> bool:
        return bool(self.process_next_runs(limit=1))

    def _process_single_run(self) -> bool:
        global _AI_LAST_RUN_COMPLETED_AT, _AI_LAST_RUN_DURATION_MS
        self.initialize_runtime()
        run_started_perf = time.perf_counter()
        started_at = _utc_now()
        with app_session() as session:
            query = (
                select(AppAiBotRun)
                .where(AppAiBotRun.status == "queued")
                .order_by(AppAiBotRun.created_at.asc())
                .limit(1)
            )
            bind = session.get_bind()
            dialect_name = str(getattr(getattr(bind, "dialect", None), "name", "") or "").lower()
            if dialect_name == "postgresql":
                query = query.with_for_update(skip_locked=True)
            run = session.execute(query).scalar_one_or_none()
            if run is None:
                return False
            bot = session.get(AppAiBot, run.bot_id)
            mapping = session.execute(
                select(AppAiBotConversation).where(
                    AppAiBotConversation.bot_id == run.bot_id,
                    AppAiBotConversation.conversation_id == run.conversation_id,
                )
            ).scalar_one_or_none()
            if bot is None or mapping is None:
                run.status = "failed"
                run.stage = AI_RUN_STAGE_FAILED
                run.status_text = _resolve_run_status_text(status="failed", stage=AI_RUN_STAGE_FAILED)
                run.error_text = "AI runtime metadata is missing"
                run.completed_at = _utc_now()
                run.updated_at = _utc_now()
                return True
            run.status = "running"
            run.stage = AI_RUN_STAGE_ANALYZING_REQUEST
            run.status_text = _resolve_run_status_text(status="running", stage=AI_RUN_STAGE_ANALYZING_REQUEST)
            run.error_text = None
            run.started_at = started_at
            run.updated_at = started_at
            session.flush()
            bot_payload = self._serialize_bot(bot)
            request_context = _json_loads(getattr(run, "request_json", "{}"), {})
        run_payload = self._set_run_progress(
            run_id=run.id,
            conversation_id=run.conversation_id,
            user_id=int(run.user_id),
            bot=bot,
            status="running",
            stage=AI_RUN_STAGE_ANALYZING_REQUEST,
            started_at=started_at,
        )
        self._enqueue_typing_event(
            conversation_id=run.conversation_id,
            user_id=int(run.user_id),
            bot=bot,
            is_typing=True,
        )
        try:
            def report_stage(stage: str) -> None:
                self._set_run_progress(
                    run_id=run.id,
                    conversation_id=run.conversation_id,
                    user_id=int(run.user_id),
                    bot=bot,
                    status="running",
                    stage=stage,
                )

            execute_started_at = time.perf_counter()
            answer_markdown, artifacts, kb_attachment_send, usage, extracted_context, tool_traces, generated_file_specs = self._execute_run(
                bot=bot,
                run_payload=run_payload,
                request_context=request_context,
                report_stage=report_stage,
            )
            _log_ai_run_timing("execute", execute_started_at, run_id=run.id)
            bot_user_id = int(bot_payload.get("bot_user_id") or 0)
            delivered_kb_attachment = None
            selected_template_candidate = self._resolve_kb_template_candidate_for_send(
                extracted_context=extracted_context,
                kb_attachment_send=kb_attachment_send,
            )
            if selected_template_candidate is not None and not answer_markdown:
                answer_markdown = (
                    _normalize_text(selected_template_candidate.get("summary"))
                    or f"Подходит шаблон: {_normalize_text(selected_template_candidate.get('title'))}."
                )
            if answer_markdown:
                send_started_at = time.perf_counter()
                reply_message = chat_service.send_message(
                    current_user_id=bot_user_id,
                    conversation_id=run.conversation_id,
                    body=answer_markdown,
                    body_format="markdown",
                    defer_push_notifications=True,
                )
                try:
                    from backend.ai_chat.action_cards import attach_run_actions_to_message

                    attach_run_actions_to_message(
                        run_id=run.id,
                        message_id=_normalize_text(reply_message.get("id")),
                    )
                except Exception:
                    logger.exception("Failed to attach AI action card: run_id=%s", run.id)
                self._enqueue_message_side_effects_after_send(
                    conversation_id=run.conversation_id,
                    message_id=_normalize_text(reply_message.get("id")),
                )
                _log_ai_run_timing("send_answer", send_started_at, run_id=run.id)
            if selected_template_candidate is not None:
                report_stage(AI_RUN_STAGE_GENERATING_FILES)
                delivered_kb_attachment = self._send_kb_template_attachment(
                    current_user_id=bot_user_id,
                    conversation_id=run.conversation_id,
                    candidate=selected_template_candidate,
                )
            generated_files: list[dict[str, Any]] = []
            file_generation_errors = _extract_generated_file_errors_from_tool_traces(tool_traces)
            file_specs = list(generated_file_specs or [])
            if artifacts and _artifacts_allowed_for_file_specs(file_specs):
                try:
                    file_specs.extend(normalize_generated_file_specs(artifacts))
                except GeneratedFileError as exc:
                    logger.warning("AI generated artifacts were rejected: run_id=%s error=%s", run.id, exc)
                    file_generation_errors.append(exc.to_payload())
            if file_specs and bool(bot.allow_generated_artifacts):
                report_stage(AI_RUN_STAGE_GENERATING_FILES)
                uploads: list[UploadFile] = []
                try:
                    uploads = build_generated_uploads(file_specs)
                    if uploads:
                        files_message = chat_service.send_files(
                            current_user_id=bot_user_id,
                            conversation_id=run.conversation_id,
                            body="",
                            uploads=uploads,
                            defer_push_notifications=True,
                        )
                        self._enqueue_message_side_effects_after_send(
                            conversation_id=run.conversation_id,
                            message_id=_normalize_text(files_message.get("id")),
                        )
                        generated_files = _summarize_generated_files_message(files_message)
                except GeneratedFileError as exc:
                    logger.warning("AI generated files failed: run_id=%s error=%s", run.id, exc)
                    file_generation_errors.append(exc.to_payload())
                finally:
                    for upload in uploads:
                        try:
                            upload.file.close()
                        except Exception:
                            pass
            completed_at = _utc_now()
            with app_session() as session:
                row = session.get(AppAiBotRun, run.id)
                if row is not None:
                    row.status = "completed"
                    row.stage = AI_RUN_STAGE_COMPLETED
                    row.status_text = _resolve_run_status_text(status="completed", stage=AI_RUN_STAGE_COMPLETED) or None
                    row.error_text = None
                    row.result_json = json.dumps(
                        {
                            "answer_markdown": answer_markdown,
                            "artifacts_count": len(list(artifacts or [])),
                            "generated_files_count": len(generated_files),
                            "generated_files": generated_files,
                            "file_generation_errors": file_generation_errors,
                            "kb_attachment_send": kb_attachment_send,
                            "kb_attachment_delivered": delivered_kb_attachment,
                            "tool_traces": tool_traces,
                        },
                        ensure_ascii=False,
                    )
                    row.usage_json = json.dumps(usage or {}, ensure_ascii=False)
                    row.completed_at = completed_at
                    row.updated_at = completed_at
            self._publish_status_event(
                conversation_id=run.conversation_id,
                user_id=int(run.user_id),
                bot=bot,
                status="completed",
                stage=AI_RUN_STAGE_COMPLETED,
                status_text="",
                run_id=run.id,
            )
        except Exception as exc:
            error_text = _truncate(exc, limit=500)
            logger.exception("AI run failed: run_id=%s", run.id)
            completed_at = _utc_now()
            with app_session() as session:
                row = session.get(AppAiBotRun, run.id)
                if row is not None:
                    row.status = "failed"
                    row.stage = AI_RUN_STAGE_FAILED
                    row.status_text = _resolve_run_status_text(status="failed", stage=AI_RUN_STAGE_FAILED)
                    row.error_text = error_text
                    row.completed_at = completed_at
                    row.updated_at = completed_at
            self._publish_status_event(
                conversation_id=run.conversation_id,
                user_id=int(run.user_id),
                bot=bot,
                status="failed",
                stage=AI_RUN_STAGE_FAILED,
                status_text=_resolve_run_status_text(status="failed", stage=AI_RUN_STAGE_FAILED),
                run_id=run.id,
                error_text=error_text,
            )
        finally:
            _AI_LAST_RUN_DURATION_MS = (time.perf_counter() - run_started_perf) * 1000.0
            _AI_LAST_RUN_COMPLETED_AT = _utc_now()
            self._enqueue_typing_event(
                conversation_id=run.conversation_id,
                user_id=int(run.user_id),
                bot=bot,
                is_typing=False,
            )
        return True

    def _build_tool_execution_context(
        self,
        *,
        bot: AppAiBot,
        run_payload: dict[str, Any],
        user_payload: dict[str, Any],
        request_context: dict[str, Any] | None,
    ) -> AiToolExecutionContext:
        request_payload = request_context if isinstance(request_context, dict) else {}
        return AiToolExecutionContext(
            bot_id=_normalize_text(bot.id),
            bot_title=_normalize_text(bot.title),
            conversation_id=_normalize_text(run_payload.get("conversation_id")),
            run_id=_normalize_text(run_payload.get("id")),
            user_id=int(run_payload.get("user_id") or 0),
            user_payload=user_payload,
            effective_database_id=resolve_effective_database_id(
                user_payload=user_payload,
                explicit_database_id=_normalize_text(request_payload.get("effective_database_id")) or None,
            ),
            enabled_tools=normalize_enabled_tools(_json_loads(getattr(bot, "enabled_tools_json", "[]"), [])),
            tool_settings=normalize_tool_settings(_json_loads(getattr(bot, "tool_settings_json", "{}"), {})),
            allow_generated_artifacts=bool(getattr(bot, "allow_generated_artifacts", False)),
        )

    def _execute_tool_calls(
        self,
        *,
        tool_calls: list[dict[str, Any]],
        tool_context: AiToolExecutionContext,
        report_stage=None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        tool_results: list[dict[str, Any]] = []
        tool_traces: list[dict[str, Any]] = []
        for call in list(tool_calls or [])[:AI_TOOL_CALL_LIMIT]:
            tool_id = _normalize_text(call.get("tool_id"))
            tool = ai_tool_registry.get(tool_id)
            if callable(report_stage):
                report_stage(_normalize_text(getattr(tool, "stage", None)) or AI_RUN_STAGE_CHECKING_ITINVENT)
            try:
                result, audit_row = ai_tool_registry.execute(
                    tool_id=tool_id,
                    raw_args=call.get("args") or {},
                    context=tool_context,
                )
                payload = result.to_payload()
                payload_data = payload.get("data") if isinstance(payload.get("data"), dict) else {}
                diagnostic = payload_data.get("diagnostic") if isinstance(payload_data.get("diagnostic"), dict) else None
                tool_results.append(payload)
                tool_traces.append(
                    {
                        **audit_row,
                        "args": dict(call.get("args") or {}),
                        "error": _normalize_text(payload.get("error")) or None,
                        "diagnostic": diagnostic,
                    }
                )
            except Exception as exc:
                error_text = _truncate(exc, limit=400)
                logger.warning(
                    "AI tool execution failed: run_id=%s tool_id=%s error=%s",
                    tool_context.run_id,
                    tool_id or "-",
                    error_text,
                )
                tool_results.append(
                    {
                        "tool_id": tool_id or "unknown",
                        "ok": False,
                        "database_id": _normalize_text(tool_context.effective_database_id) or None,
                        "data": None,
                        "error": error_text,
                        "sources": (
                            [{"database_id": _normalize_text(tool_context.effective_database_id)}]
                            if _normalize_text(tool_context.effective_database_id)
                            else []
                        ),
                    }
                )
                tool_traces.append(
                    {
                        "tool_id": tool_id or "unknown",
                        "database_id": _normalize_text(tool_context.effective_database_id) or None,
                        "status": "error",
                        "latency_ms": None,
                        "conversation_id": tool_context.conversation_id,
                        "bot_id": tool_context.bot_id,
                        "user_id": int(tool_context.user_id or 0),
                        "args": dict(call.get("args") or {}),
                        "error": error_text,
                    }
                )
        return tool_results, tool_traces

    def _execute_run(
        self,
        *,
        bot: AppAiBot,
        run_payload: dict[str, Any],
        request_context: dict[str, Any] | None = None,
        report_stage=None,
    ) -> tuple[str, list[dict[str, Any]], dict[str, str] | None, dict[str, Any], dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
        run_id = _normalize_text(run_payload.get("id")) or "-"
        runtime = self._get_runtime_by_conversation(run_payload["conversation_id"])
        if runtime is None:
            raise RuntimeError("AI conversation runtime was not found")
        user_payload = user_service.get_by_id(int(run_payload["user_id"]))
        if not user_payload:
            raise RuntimeError("AI run user not found")
        tool_context = self._build_tool_execution_context(
            bot=bot,
            run_payload=run_payload,
            user_payload=user_payload,
            request_context=request_context,
        )
        context_started_at = time.perf_counter()
        extracted_context = self._build_conversation_context(
            conversation_id=run_payload["conversation_id"],
            trigger_message_id=run_payload["trigger_message_id"],
            bot_user_id=int(bot.bot_user_id or 0),
            bot_title=bot.title,
            user_payload=user_payload,
            allow_files=bool(bot.allow_file_input),
            can_read_kb=_user_has_permission(user_payload, PERM_KB_READ),
            allowed_kb_scope=_json_loads(bot.allowed_kb_scope_json, []),
            allow_kb_document_delivery=bool(getattr(bot, "allow_kb_document_delivery", False)),
            report_stage=report_stage,
        )
        _log_ai_run_timing("context", context_started_at, run_id=run_id)
        template_candidates = list(extracted_context.get("template_candidates") or [])
        template_candidates_text = "\n".join(
            [
                (
                    f"- article_id={_normalize_text(item.get('article_id'))}; "
                    f"attachment_id={_normalize_text(item.get('attachment_id'))}; "
                    f"title={_normalize_text(item.get('title'))}; "
                    f"file={_normalize_text(item.get('attachment_name'))}; "
                    f"category={_normalize_text(item.get('category'))}; "
                    f"summary={_normalize_text(item.get('summary'))}; "
                    f"score={int(item.get('score') or 0)}"
                )
                for item in template_candidates
                if isinstance(item, dict)
            ]
        ) or "No template candidates."
        template_delivery_allowed = bool(extracted_context.get("template_delivery_allowed"))
        tool_specs = ai_tool_registry.list_specs(tool_ids=tool_context.enabled_tools)
        itinvent_tool_specs = [
            item for item in tool_specs if _is_itinvent_tool_id((item or {}).get("tool_id"))
        ]
        file_tool_specs = [
            item for item in tool_specs if _is_file_tool_id((item or {}).get("tool_id"))
        ]
        office_tool_specs = [
            item for item in tool_specs if _is_office_tool_id((item or {}).get("tool_id"))
        ]
        other_tool_specs = [
            item
            for item in tool_specs
            if not _is_itinvent_tool_id((item or {}).get("tool_id"))
            and not _is_file_tool_id((item or {}).get("tool_id"))
            and not _is_office_tool_id((item or {}).get("tool_id"))
        ]
        itinvent_tool_specs_text = _format_tool_results_for_prompt(itinvent_tool_specs)
        file_tool_specs_text = _format_tool_results_for_prompt(file_tool_specs)
        office_tool_specs_text = _format_tool_results_for_prompt(office_tool_specs)
        other_tool_specs_text = _format_tool_results_for_prompt(other_tool_specs)
        file_tools_available = bool(file_tool_specs) and bool(tool_context.allow_generated_artifacts)
        current_database_meta = next(
            (
                item for item in get_available_database_options()
                if _normalize_text(item.get("id")) == _normalize_text(tool_context.effective_database_id)
            ),
            None,
        )
        current_database_label = (
            _normalize_text((current_database_meta or {}).get("name"))
            or _normalize_text(tool_context.effective_database_id)
            or "not resolved"
        )
        system_prompt = "\n\n".join(
            [
                part
                for part in [
                    DEFAULT_BOT_PROMPT,
                    _normalize_text(bot.system_prompt),
                    AI_JSON_OUTPUT_LOCK,
                    (
                        "Return JSON only. Allowed top-level keys are answer_markdown, artifacts, "
                        "kb_attachment_send, tool_calls. artifacts is optional. "
                        "kb_attachment_send must be null or an object with article_id and attachment_id chosen "
                        "only from the provided template candidates. tool_calls is optional and may contain up to "
                        "3 objects with keys tool_id and args."
                    ),
                    (
                        "Use tool_calls only for enabled tools: ITinvent live-data lookups/actions or file generation; "
                        "office mail/task work is also available when office tools are enabled. "
                        "Do not invent live database facts without tool results. "
                        "If you request tool_calls, leave answer_markdown empty or brief and wait for tool results. "
                        "Never promise to make another live query later unless you return the needed tool_calls now. "
                        "When file tools are available and the user explicitly asks to create/export/send a file, "
                        "call ai.files.report or ai.files.create; do not only describe that a file can be created."
                    ),
                    AI_REQUEST_UNDERSTANDING_GUIDE,
                ]
                if part
            ]
        )
        user_prompt = "\n\n".join(
            [
                part
                for part in [
                    f"Bot title: {bot.title}",
                    f"Conversation summary:\n{extracted_context['conversation_text']}",
                    f"Current user request:\n{extracted_context['trigger_text']}",
                    f"Attached file context:\n{extracted_context['file_context'] or 'No extracted file context.'}",
                    f"Knowledge base context:\n{extracted_context['kb_context'] or 'No KB context.'}",
                    f"Template document candidates:\n{template_candidates_text}",
                    f"Template auto-send allowed now: {'yes' if template_delivery_allowed else 'no'}.",
                    (
                        "Write a useful markdown answer in Russian. "
                        "If the user asks for a file and file tools are available, create it with a file tool. "
                        "Use artifacts only as a legacy fallback when file tools are not available. "
                        "If template auto-send is allowed and one suitable template should be sent now, "
                        "set kb_attachment_send to its ids. If candidates are ambiguous or auto-send is not allowed, "
                        "ask a short clarification question and keep kb_attachment_send null."
                    ),
                    (
                        f"Enabled ITinvent tools:\n{itinvent_tool_specs_text}"
                        if itinvent_tool_specs
                        else "ITinvent live-data tools are disabled for this bot."
                    ),
                    (
                        f"Current ITinvent database: {current_database_label}"
                        if itinvent_tool_specs
                        else ""
                    ),
                    (
                        AI_ITINVENT_TOOL_ROUTING_GUIDE
                        if itinvent_tool_specs
                        else ""
                    ),
                    (
                        f"Enabled file tools:\n{file_tool_specs_text}"
                        if file_tools_available
                        else (
                            "File tools are disabled for this bot."
                            if not file_tool_specs
                            else "File tools are configured but generated file sending is disabled for this bot."
                        )
                    ),
                    (
                        AI_FILE_TOOL_ROUTING_GUIDE
                        if file_tools_available
                        else ""
                    ),
                    (
                        f"Enabled office tools:\n{office_tool_specs_text}"
                        if office_tool_specs
                        else "Office tools are disabled for this bot."
                    ),
                    (
                        AI_OFFICE_TOOL_ROUTING_GUIDE
                        if office_tool_specs
                        else ""
                    ),
                    (
                        f"Other enabled tools:\n{other_tool_specs_text}"
                        if other_tool_specs
                        else ""
                    ),
                    (
                        AI_ITINVENT_STRUCTURED_RESPONSE_GUIDE
                        if itinvent_tool_specs
                        else ""
                    ),
                    (
                        "If you use live ITinvent data in the final answer, explicitly cite the source as "
                        "'Источник: ITinvent / <database_id>'."
                        if itinvent_tool_specs
                        else ""
                    ),
                    (
                        "If another live ITinvent lookup is needed, return tool_calls in the same JSON response. "
                        "Do not answer with phrases like 'подождите' or 'сейчас проверю' without returning tool_calls."
                        if itinvent_tool_specs
                        else ""
                    ),
                    (
                        "If a generated file is needed and file tools are available, return the file tool_call now. "
                        "If file tools are disabled or generated file sending is disabled, say that file attachment generation is disabled for this bot."
                        if file_tool_specs or "файл" in _normalize_text(extracted_context.get("trigger_text")).lower()
                        else ""
                    ),
                ]
                if part
            ]
        )

        def _complete_json_step(
            *,
            current_system_prompt: str,
            current_user_prompt: str,
            response_schema: dict[str, Any],
            schema_name: str,
        ) -> tuple[dict[str, Any], dict[str, Any]]:
            try:
                payload, usage = openrouter_client.complete_json(
                    system_prompt=current_system_prompt,
                    user_prompt=current_user_prompt,
                    model=_normalize_text(bot.model),
                    temperature=float(bot.temperature or 0.2),
                    max_tokens=int(bot.max_tokens or 2000),
                    response_schema=response_schema,
                    schema_name=schema_name,
                )
            except OpenRouterClientError as exc:
                raise RuntimeError(str(exc)) from exc
            return payload if isinstance(payload, dict) else {}, usage or {}

        if callable(report_stage):
            report_stage(AI_RUN_STAGE_GENERATING_ANSWER)
        first_llm_started_at = time.perf_counter()
        payload, usage = _complete_json_step(
            current_system_prompt=system_prompt,
            current_user_prompt=user_prompt,
            response_schema=AI_CHAT_RESPONSE_SCHEMA_WITH_TOOLS,
            schema_name="ai_chat_response_with_tools",
        )
        _log_ai_run_timing("llm_first", first_llm_started_at, run_id=run_id)
        tool_traces: list[dict[str, Any]] = []
        final_payload = payload
        final_usage = usage or {}
        accumulated_tool_results: list[dict[str, Any]] = []
        tool_rounds_used = 0
        while tool_specs and tool_rounds_used < AI_TOOL_ROUND_LIMIT:
            tool_calls = _normalize_tool_calls(final_payload.get("tool_calls"))
            if not tool_calls:
                break
            tool_started_at = time.perf_counter()
            tool_results, round_traces = self._execute_tool_calls(
                tool_calls=tool_calls,
                tool_context=tool_context,
                report_stage=report_stage,
            )
            _log_ai_run_timing(
                "tools",
                tool_started_at,
                run_id=run_id,
                round=tool_rounds_used + 1,
                tool_count=len(tool_calls),
            )
            accumulated_tool_results.extend(tool_results)
            tool_traces.extend(round_traces)
            tool_rounds_used += 1
            if callable(report_stage):
                report_stage(AI_RUN_STAGE_GENERATING_ANSWER)
            followup_system_prompt = "\n\n".join(
                [
                    part
                    for part in [
                        DEFAULT_BOT_PROMPT,
                        _normalize_text(bot.system_prompt),
                        AI_JSON_OUTPUT_LOCK,
                        (
                            "Return JSON only. Allowed top-level keys are answer_markdown, artifacts, "
                            "kb_attachment_send, tool_calls. artifacts is optional. "
                            "tool_calls may contain up to 3 objects with keys tool_id and args."
                        ),
                        (
                            "Use the accumulated tool results. "
                            "If more enabled-tool work is still required, return the next tool_calls now. "
                            "Do not promise another lookup, office draft action or file creation later without returning tool_calls. "
                            "If the user asked for a generated file and the data is now sufficient, call ai.files.report or ai.files.create when available."
                        ),
                        AI_REQUEST_UNDERSTANDING_GUIDE,
                    ]
                    if part
                ]
            )
            followup_user_prompt = "\n\n".join(
                [
                    user_prompt,
                    f"Accumulated tool results JSON:\n{_format_tool_results_for_prompt(accumulated_tool_results)}",
                    (
                        "If the available tool results are enough, return the final user-facing answer in Russian markdown. "
                        "If another enabled tool is still required, return tool_calls for the next step instead of a placeholder. "
                        "If the user asked for a file and the accumulated data is sufficient, return an ai.files.report or ai.files.create tool_call when available. "
                        "When you use live ITinvent data in the final answer, cite the source as 'Источник: ITinvent / <database_id>'. "
                        "Keep the answer structured and detailed, not a bare list."
                    ),
                ]
            )
            try:
                followup_started_at = time.perf_counter()
                next_payload, next_usage = _complete_json_step(
                    current_system_prompt=followup_system_prompt,
                    current_user_prompt=followup_user_prompt,
                    response_schema=AI_CHAT_RESPONSE_SCHEMA_WITH_TOOLS,
                    schema_name="ai_chat_response_with_tools",
                )
                _log_ai_run_timing("llm_followup", followup_started_at, run_id=run_id, round=tool_rounds_used)
                next_tool_calls = _normalize_tool_calls(next_payload.get("tool_calls"))
                if next_tool_calls and next_tool_calls == tool_calls:
                    logger.warning(
                        "AI run repeated identical tool calls; ending tool loop early: run_id=%s round=%s",
                        run_id,
                        tool_rounds_used,
                    )
                    if not _normalize_text(next_payload.get("answer_markdown")) and accumulated_tool_results:
                        next_payload["answer_markdown"] = _format_fallback_tool_answer(accumulated_tool_results)
                    next_payload["tool_calls"] = []
            except RuntimeError as exc:
                logger.warning(
                    "AI run follow-up returned invalid JSON; using fallback answer: run_id=%s error=%s",
                    _normalize_text(run_payload.get("id")) or "-",
                    exc,
                )
                final_payload = {
                    "answer_markdown": _format_fallback_tool_answer(accumulated_tool_results),
                    "artifacts": [],
                    "kb_attachment_send": None,
                }
                break
            final_payload = next_payload
            final_usage = _merge_usage(final_usage, next_usage)

        if tool_specs and accumulated_tool_results and _normalize_tool_calls(final_payload.get("tool_calls")):
            if callable(report_stage):
                report_stage(AI_RUN_STAGE_GENERATING_ANSWER)
            forced_final_system_prompt = "\n\n".join(
                [
                    part
                    for part in [
                        DEFAULT_BOT_PROMPT,
                        _normalize_text(bot.system_prompt),
                        AI_JSON_OUTPUT_LOCK,
                        (
                            "Return JSON only with keys answer_markdown, artifacts, kb_attachment_send. "
                            "Do not return tool_calls in this final pass."
                        ),
                        AI_REQUEST_UNDERSTANDING_GUIDE,
                    ]
                    if part
                ]
            )
            forced_final_user_prompt = "\n\n".join(
                [
                    user_prompt,
                    f"Accumulated tool results JSON:\n{_format_tool_results_for_prompt(accumulated_tool_results)}",
                    (
                        "Tool-call round limit is reached. Produce the best final user-facing answer in Russian markdown "
                        "using the available tool results. Be explicit if the live data is incomplete or partially failed. "
                        "When you use live ITinvent data, cite the source as 'Источник: ITinvent / <database_id>'. "
                        "If the user requested a file and no file tool result exists, say that the file was not created. "
                        "Keep the answer structured and detailed, not a bare list."
                    ),
                ]
            )
            try:
                forced_final_started_at = time.perf_counter()
                forced_final_payload, forced_final_usage = _complete_json_step(
                    current_system_prompt=forced_final_system_prompt,
                    current_user_prompt=forced_final_user_prompt,
                    response_schema=AI_CHAT_RESPONSE_SCHEMA_FINAL,
                    schema_name="ai_chat_response_final",
                )
                _log_ai_run_timing("llm_final", forced_final_started_at, run_id=run_id)
                final_payload = forced_final_payload
                final_usage = _merge_usage(final_usage, forced_final_usage)
            except RuntimeError as exc:
                logger.warning(
                    "AI run forced final returned invalid JSON; using fallback answer: run_id=%s error=%s",
                    _normalize_text(run_payload.get("id")) or "-",
                    exc,
                )
                final_payload = {
                    "answer_markdown": _format_fallback_tool_answer(accumulated_tool_results),
                    "artifacts": [],
                    "kb_attachment_send": None,
                }
        answer_markdown = _truncate(final_payload.get("answer_markdown"), limit=12000)
        artifacts = [
            item
            for item in list(final_payload.get("artifacts") or [])
            if isinstance(item, dict)
        ]
        kb_attachment_send = _normalize_kb_attachment_send(final_payload.get("kb_attachment_send"))
        generated_file_specs = _extract_generated_file_specs_from_tool_results(accumulated_tool_results)
        return answer_markdown, artifacts, kb_attachment_send, final_usage, extracted_context, tool_traces, generated_file_specs
        template_candidates = list(extracted_context.get("template_candidates") or [])
        template_candidates_text = "\n".join(
            [
                (
                    f"- article_id={_normalize_text(item.get('article_id'))}; "
                    f"attachment_id={_normalize_text(item.get('attachment_id'))}; "
                    f"title={_normalize_text(item.get('title'))}; "
                    f"file={_normalize_text(item.get('attachment_name'))}; "
                    f"category={_normalize_text(item.get('category'))}; "
                    f"summary={_normalize_text(item.get('summary'))}; "
                    f"score={int(item.get('score') or 0)}"
                )
                for item in template_candidates
                if isinstance(item, dict)
            ]
        ) or "No template candidates."
        template_delivery_allowed = bool(extracted_context.get("template_delivery_allowed"))
        system_prompt = "\n\n".join(
            part for part in [
                DEFAULT_BOT_PROMPT,
                _normalize_text(bot.system_prompt),
                AI_JSON_OUTPUT_LOCK,
                (
                    "Верни только JSON-объект вида "
                    "{\"answer_markdown\":\"...\",\"artifacts\":[...]} без пояснений вне JSON. "
                    "artifacts — необязательный массив объектов с полями kind, file_name и content/rows/sheets."
                ),
            ] if part
        )
        system_prompt = "\n\n".join(
            part for part in [
                system_prompt,
                (
                    "Return JSON only with keys answer_markdown, artifacts, kb_attachment_send. "
                    "artifacts is optional. kb_attachment_send must be null or an object with article_id and attachment_id chosen only from the provided template candidates."
                ),
            ]
            if part
        )
        user_prompt = (
            f"Bot title: {bot.title}\n"
            f"Conversation summary:\n{extracted_context['conversation_text']}\n\n"
            f"Current user request:\n{extracted_context['trigger_text']}\n\n"
            f"Attached file context:\n{extracted_context['file_context'] or 'No extracted file context.'}\n\n"
            f"Knowledge base context:\n{extracted_context['kb_context'] or 'No KB context.'}\n\n"
            "Сформируй полезный markdown-ответ. "
            "Если нужен файл, положи описание файла в artifacts."
        )
        user_prompt = "\n\n".join(
            part for part in [
                user_prompt,
                f"Template document candidates:\n{template_candidates_text}",
                f"Template auto-send allowed now: {'yes' if template_delivery_allowed else 'no'}.",
                (
                    "Write a short useful markdown answer in Russian. "
                    "If a generated file is needed, place it into artifacts. "
                    "If template auto-send is allowed and one suitable template should be sent now, set kb_attachment_send to its ids. "
                    "If candidates are ambiguous or auto-send is not allowed, ask a short clarification question and keep kb_attachment_send null."
                ),
            ]
            if part
        )
        if callable(report_stage):
            report_stage(AI_RUN_STAGE_GENERATING_ANSWER)
        try:
            payload, usage = openrouter_client.complete_json(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=_normalize_text(bot.model),
                temperature=float(bot.temperature or 0.2),
                max_tokens=int(bot.max_tokens or 2000),
                response_schema=AI_CHAT_RESPONSE_SCHEMA_FINAL,
                schema_name="ai_chat_response_final",
            )
        except OpenRouterClientError as exc:
            raise RuntimeError(str(exc)) from exc
        answer_markdown = _truncate(payload.get("answer_markdown"), limit=12000)
        artifacts = [
            item
            for item in list(payload.get("artifacts") or [])
            if isinstance(item, dict)
        ]
        kb_attachment_send = _normalize_kb_attachment_send(payload.get("kb_attachment_send"))
        return answer_markdown, artifacts, kb_attachment_send, usage, extracted_context

    def _build_conversation_context(
        self,
        *,
        conversation_id: str,
        trigger_message_id: str,
        bot_user_id: int,
        bot_title: str,
        user_payload: dict[str, Any],
        allow_files: bool,
        can_read_kb: bool,
        allowed_kb_scope: list[str],
        allow_kb_document_delivery: bool,
        report_stage=None,
    ) -> dict[str, Any]:
        with chat_session() as session:
            normalized_conversation_id = _normalize_text(conversation_id)
            messages = list(
                session.execute(
                    select(ChatMessage)
                    .where(ChatMessage.conversation_id == normalized_conversation_id)
                    .order_by(ChatMessage.conversation_seq.desc())
                    .limit(AI_CONTEXT_DB_MESSAGE_WINDOW)
                ).scalars()
            )
            messages.reverse()
            trigger_message = session.get(ChatMessage, _normalize_text(trigger_message_id))
            if trigger_message is None:
                raise LookupError("Trigger message not found")
            reply_message = None
            if _normalize_text(getattr(trigger_message, "reply_to_message_id", None)):
                reply_message = session.get(ChatMessage, _normalize_text(trigger_message.reply_to_message_id))
            attachment_lookup_ids = {
                _normalize_text(getattr(item, "id", None))
                for item in [*messages, trigger_message, reply_message]
                if item is not None and _normalize_text(getattr(item, "id", None))
            }
            attachment_rows: list[ChatMessageAttachment] = []
            if attachment_lookup_ids:
                attachment_rows = list(
                    session.execute(
                        select(ChatMessageAttachment).where(ChatMessageAttachment.message_id.in_(sorted(attachment_lookup_ids)))
                    ).scalars()
                )
            attachments_by_message: dict[str, list[ChatMessageAttachment]] = {}
            for attachment in attachment_rows:
                attachments_by_message.setdefault(_normalize_text(attachment.message_id), []).append(attachment)
            file_context_parts: list[str] = []
            attachment_messages = [(trigger_message, "current message")]
            if reply_message is not None:
                attachment_messages.append((reply_message, "reply target"))
            if allow_files:
                file_stage_reported = False
                for message, source_label in attachment_messages:
                    rows = attachments_by_message.get(_normalize_text(message.id), [])
                    if rows and not file_stage_reported and callable(report_stage):
                        report_stage(AI_RUN_STAGE_READING_FILES)
                        file_stage_reported = True
                    for attachment in rows:
                        extracted = self._extract_chat_attachment_text(
                            conversation_id=normalized_conversation_id,
                            attachment=attachment,
                            image_extractor=openrouter_client.extract_image_text,
                        )
                        file_context_parts.append(
                            self._build_attachment_context_block(
                                source_label=source_label,
                                message=message,
                                attachment=attachment,
                                extracted_text=extracted,
                            )
                        )
            trigger_attachments = attachments_by_message.get(_normalize_text(trigger_message.id), [])
            trigger_text = _normalize_text(trigger_message.body) or _build_attachment_request_fallback(trigger_attachments)
            conversation_lines: list[str] = []
            for item in messages:
                sender_label = bot_title if int(item.sender_user_id or 0) == int(bot_user_id or 0) else "Пользователь"
                body = _normalize_text(item.body)
                item_attachments = attachments_by_message.get(_normalize_text(item.id), [])
                if not body and _normalize_text(item.kind) == "file":
                    body = _build_file_message_inline_text(item_attachments)
                if body:
                    conversation_lines.append(f"{sender_label}: {body}")
            kb_context = ""
            template_candidates: list[dict[str, Any]] = []
            kb_query = "\n".join(part for part in [
                trigger_text,
                "\n".join(file_context_parts),
            ] if part)
            if can_read_kb and kb_query:
                if callable(report_stage):
                    report_stage(AI_RUN_STAGE_RETRIEVING_KB)
                ai_kb_retrieval_service.ensure_index_fresh(image_extractor=openrouter_client.extract_image_text)
                kb_chunks = ai_kb_retrieval_service.retrieve(
                    query=kb_query,
                    allowed_scope=allowed_kb_scope,
                    limit=5,
                    current_user=user_payload,
                )
                if kb_chunks:
                    kb_context = "\n\n".join(
                        f"[{item['title']} | {item['category']}] {item['content']}"
                        for item in kb_chunks
                    )
                if allow_kb_document_delivery:
                    template_candidates = ai_kb_retrieval_service.retrieve_template_candidates(
                        query=kb_query,
                        allowed_scope=allowed_kb_scope,
                        limit=5,
                        current_user=user_payload,
                    )
        return {
            "conversation_text": "\n".join(conversation_lines[-AI_CONTEXT_RENDERED_MESSAGE_WINDOW:]),
            "trigger_text": trigger_text,
            "file_context": "\n\n".join(file_context_parts),
            "kb_context": kb_context,
            "template_candidates": template_candidates,
            "template_delivery_allowed": _can_auto_send_template(template_candidates),
        }

    def _ensure_bot_user(self, *, session, bot: AppAiBot) -> int:
        existing_user_id = int(getattr(bot, "bot_user_id", 0) or 0)
        if existing_user_id > 0:
            existing_user = user_service.get_by_id(existing_user_id)
            if existing_user:
                return existing_user_id
        username = f"{SYSTEM_BOT_USERNAME_PREFIX}{_normalize_text(bot.slug) or 'bot'}"
        suffix = 1
        while user_service.get_by_username(username):
            raw_user = user_service.get_by_username(username)
            if raw_user and int(raw_user.get("id", 0) or 0) == existing_user_id:
                break
            suffix += 1
            username = f"{SYSTEM_BOT_USERNAME_PREFIX}{_normalize_text(bot.slug) or 'bot'}-{suffix}"
        if bool(getattr(user_service, "_use_app_database", False)):
            next_user_id = int(
                session.execute(select(AppUser.id).order_by(AppUser.id.desc()).limit(1)).scalar_one_or_none() or 0
            ) + 1
            password_hash, salt = user_service._hash_password(str(uuid4()))
            now = _utc_now()
            row = AppUser(
                id=next_user_id,
                username=username,
                full_name=_normalize_text(bot.title) or DEFAULT_BOT_TITLE,
                is_active=True,
                role="viewer",
                use_custom_permissions=True,
                custom_permissions_json=json.dumps(
                    authorization_service.normalize_permissions([PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_CHAT_AI_USE]),
                    ensure_ascii=False,
                ),
                auth_source="local",
                password_hash=password_hash,
                password_salt=salt,
                created_at=now,
                updated_at=now,
            )
            session.add(row)
            session.flush()
            bot.bot_user_id = int(row.id or 0)
        else:
            created = user_service.create_user(
                username=username,
                password=str(uuid4()),
                role="viewer",
                auth_source="local",
                full_name=_normalize_text(bot.title) or DEFAULT_BOT_TITLE,
                is_active=True,
                use_custom_permissions=True,
                custom_permissions=[PERM_CHAT_READ, PERM_CHAT_WRITE, PERM_CHAT_AI_USE],
            )
            bot.bot_user_id = int(created.get("id", 0) or 0)
        bot.updated_at = _utc_now()
        session.flush()
        return int(bot.bot_user_id or 0)

    def _latest_runs_by_bot(self, session) -> dict[str, AppAiBotRun]:
        rows = list(
            session.execute(
                select(AppAiBotRun).order_by(AppAiBotRun.created_at.desc())
            ).scalars()
        )
        result: dict[str, AppAiBotRun] = {}
        for row in rows:
            if row.bot_id not in result:
                result[row.bot_id] = row
        return result

    def _read_bool_setting(self, session, key: str) -> bool:
        normalized_key = _normalize_text(key)
        if not normalized_key:
            return False
        row = session.get(AppGlobalSetting, normalized_key)
        if row is None:
            return False
        try:
            return bool(json.loads(str(row.value_json or "false")))
        except Exception:
            return False

    def _write_bool_setting(self, session, key: str, value: bool) -> None:
        normalized_key = _normalize_text(key)
        if not normalized_key:
            return
        row = session.get(AppGlobalSetting, normalized_key)
        if row is None:
            row = AppGlobalSetting(
                key=normalized_key,
                value_json=json.dumps(bool(value)),
                updated_at=_utc_now(),
            )
            session.add(row)
            return
        row.value_json = json.dumps(bool(value))
        row.updated_at = _utc_now()

    def _serialize_bot(
        self,
        bot: AppAiBot,
        *,
        configured: bool | None = None,
        conversation_id: str | None = None,
        admin: bool = False,
        latest_run: AppAiBotRun | None = None,
    ) -> dict[str, Any]:
        enabled_tools = normalize_enabled_tools(_json_loads(getattr(bot, "enabled_tools_json", "[]"), []))
        tool_settings = normalize_tool_settings(_json_loads(getattr(bot, "tool_settings_json", "{}"), {}))
        payload = {
            "id": bot.id,
            "slug": _normalize_text(bot.slug),
            "title": _normalize_text(bot.title),
            "description": _normalize_text(bot.description),
            "conversation_id": _normalize_text(conversation_id) or None,
            "model": _normalize_text(bot.model),
            "allow_file_input": bool(bot.allow_file_input),
            "allow_generated_artifacts": bool(bot.allow_generated_artifacts),
            "allow_kb_document_delivery": bool(getattr(bot, "allow_kb_document_delivery", False)),
            "is_enabled": bool(bot.is_enabled),
            "configured": bool(self.get_openrouter_status()["configured"] if configured is None else configured),
            "bot_user_id": int(getattr(bot, "bot_user_id", 0) or 0) or None,
            "live_data_enabled": _is_live_data_enabled(enabled_tools),
        }
        if admin:
            payload.update(
                {
                    "system_prompt": _normalize_text(bot.system_prompt),
                    "temperature": float(bot.temperature or 0.2),
                    "max_tokens": int(bot.max_tokens or 2000),
                    "allowed_kb_scope": _json_loads(bot.allowed_kb_scope_json, []),
                    "enabled_tools": enabled_tools,
                    "tool_settings": tool_settings,
                    "openrouter_configured": bool(payload["configured"]),
                    "updated_at": _iso(getattr(bot, "updated_at", None)),
                    "latest_run_status": _normalize_text(getattr(latest_run, "status", None)) or None,
                    "latest_run_error": _normalize_text(getattr(latest_run, "error_text", None)) or None,
                }
            )
        return payload

    def _serialize_run(self, run: AppAiBotRun) -> dict[str, Any]:
        request_payload = _json_loads(getattr(run, "request_json", "{}"), {})
        result_payload = _json_loads(getattr(run, "result_json", "{}"), {})
        tool_traces = result_payload.get("tool_traces") if isinstance(result_payload.get("tool_traces"), list) else []
        usage = _json_loads(getattr(run, "usage_json", "{}"), {})
        latency_ms = None
        if run.started_at and run.completed_at:
            latency_ms = max(0, int((run.completed_at - run.started_at).total_seconds() * 1000))
        return {
            "id": run.id,
            "bot_id": run.bot_id,
            "conversation_id": run.conversation_id,
            "user_id": int(run.user_id),
            "trigger_message_id": run.trigger_message_id,
            "request": request_payload,
            "result": result_payload,
            "status": _normalize_text(run.status) or "queued",
            "stage": _normalize_text(getattr(run, "stage", None)) or None,
            "status_text": _normalize_text(getattr(run, "status_text", None)) or None,
            "error_text": _normalize_text(run.error_text) or None,
            "latency_ms": latency_ms,
            "effective_database_id": _normalize_text(request_payload.get("effective_database_id")) or None,
            "tool_traces_count": len(tool_traces),
            "tool_trace_errors_count": sum(
                1
                for item in tool_traces
                if isinstance(item, dict) and (
                    _normalize_text(item.get("status")).lower() == "error"
                    or bool(_normalize_text(item.get("error")))
                )
            ),
            "usage": usage,
            "created_at": _iso(run.created_at),
            "updated_at": _iso(run.updated_at),
            "started_at": _iso(run.started_at),
            "completed_at": _iso(run.completed_at),
        }

    def _get_runtime_by_conversation(self, conversation_id: str) -> Optional[AiConversationRuntime]:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id:
            return None
        self.initialize_runtime()
        with app_session() as session:
            mapping = session.execute(
                select(AppAiBotConversation).where(AppAiBotConversation.conversation_id == normalized_conversation_id)
            ).scalar_one_or_none()
            if mapping is None:
                return None
            bot = session.get(AppAiBot, mapping.bot_id)
            if bot is None:
                return None
            return AiConversationRuntime(bot=bot, mapping=mapping)

    def is_ai_conversation(self, conversation_id: str) -> bool:
        return self._get_runtime_by_conversation(conversation_id) is not None

    def _enqueue_realtime_jobs(self, jobs: list[dict[str, Any]]) -> None:
        normalized_jobs = [item for item in list(jobs or []) if isinstance(item, dict)]
        if not normalized_jobs:
            return
        from backend.chat.event_outbox_service import chat_event_outbox_service

        chat_event_outbox_service.enqueue_events(normalized_jobs)

    def _enqueue_message_side_effects_after_send(self, *, conversation_id: str, message_id: str) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        normalized_message_id = _normalize_text(message_id)
        if not normalized_conversation_id or not normalized_message_id:
            return
        jobs = asyncio.run(
            build_message_created_event_jobs(
                conversation_id=normalized_conversation_id,
                message_id=normalized_message_id,
            )
        )
        self._enqueue_realtime_jobs([
            {
                "event_type": job.event_type,
                "target_scope": job.target_scope,
                "target_user_id": int(job.target_user_id),
                "conversation_id": job.conversation_id,
                "message_id": job.message_id,
                "payload": job.payload or {},
                "dedupe_key": job.dedupe_key,
            }
            for job in jobs
        ])

    def _build_attachment_context_block(
        self,
        *,
        source_label: str,
        message: ChatMessage,
        attachment: ChatMessageAttachment,
        extracted_text: str,
    ) -> str:
        file_name = (
            _normalize_text(getattr(attachment, "file_name", None))
            or _normalize_text(getattr(attachment, "storage_name", None))
            or "attachment"
        )
        lines = [
            f"Source: {source_label}",
            f"File: {file_name}",
        ]
        mime_type = _normalize_text(getattr(attachment, "mime_type", None))
        if mime_type:
            lines.append(f"MIME: {mime_type}")
        file_size = int(getattr(attachment, "file_size", 0) or 0)
        if file_size > 0:
            lines.append(f"Size bytes: {file_size}")
        caption = _normalize_text(getattr(message, "body", None))
        if caption:
            lines.append(f"Caption: {caption}")
        normalized_extracted_text = _normalize_text(extracted_text)
        if normalized_extracted_text:
            lines.append(f"Extracted text:\n{_truncate(normalized_extracted_text, limit=AI_FILE_CONTEXT_TEXT_LIMIT)}")
        else:
            # Keep file metadata in the prompt even when OCR/text extraction returns nothing.
            lines.append("Extracted text: unavailable")
        return "\n".join(lines)

    def _extract_chat_attachment_text(
        self,
        *,
        conversation_id: str,
        attachment: ChatMessageAttachment,
        image_extractor=None,
    ) -> str:
        path = chat_service._resolve_attachment_path(
            conversation_id=conversation_id,
            storage_name=attachment.storage_name,
        )
        try:
            stat = Path(path).stat()
            fingerprint = f"{int(stat.st_size or 0)}:{int(getattr(stat, 'st_mtime_ns', 0) or int(stat.st_mtime * 1_000_000_000))}"
        except Exception:
            fingerprint = ""
        cache_key = "|".join([
            _normalize_text(getattr(attachment, "id", None)) or _normalize_text(attachment.storage_name),
            _normalize_text(attachment.storage_name),
            str(int(getattr(attachment, "file_size", 0) or 0)),
            fingerprint,
            _normalize_text(attachment.file_name),
        ])
        if cache_key and cache_key in self._attachment_text_cache:
            logger.info(
                "AI attachment text cache hit: attachment_id=%s file_name=%s",
                _normalize_text(getattr(attachment, "id", None)) or "-",
                _normalize_text(attachment.file_name) or "-",
            )
            return _normalize_text(self._attachment_text_cache.get(cache_key))
        logger.info(
            "AI attachment text cache miss: attachment_id=%s file_name=%s",
            _normalize_text(getattr(attachment, "id", None)) or "-",
            _normalize_text(attachment.file_name) or "-",
        )
        extracted = extract_text_from_path(
            path,
            file_name=attachment.file_name,
            mime_type=_normalize_text(getattr(attachment, "mime_type", None)),
            image_extractor=image_extractor,
        )
        if cache_key:
            self._attachment_text_cache[cache_key] = extracted
            while len(self._attachment_text_cache) > self._attachment_text_cache_limit:
                oldest_key = next(iter(self._attachment_text_cache))
                self._attachment_text_cache.pop(oldest_key, None)
        return extracted

    def _publish_status_event(
        self,
        *,
        conversation_id: str,
        user_id: int,
        bot: AppAiBot,
        status: str,
        stage: str | None = None,
        status_text: str | None = None,
        run_id: str,
        error_text: str | None = None,
    ) -> None:
        normalized_status = _normalize_text(status)
        normalized_stage = _normalize_text(stage) or normalized_status
        resolved_status_text = _normalize_text(status_text)
        if not resolved_status_text:
            resolved_status_text = _resolve_run_status_text(status=normalized_status, stage=normalized_stage)
        payload = {
            "conversation_id": _normalize_text(conversation_id),
            "bot_id": bot.id,
            "bot_title": _normalize_text(bot.title),
            "status": normalized_status,
            "stage": normalized_stage or None,
            "status_text": resolved_status_text or None,
            "run_id": _normalize_text(run_id),
            "error_text": _normalize_text(error_text) or None,
            "updated_at": _iso(_utc_now()),
        }
        self._enqueue_realtime_jobs([
            {
                "event_type": "chat.ai.run.updated",
                "target_scope": "both",
                "target_user_id": int(user_id),
                "conversation_id": _normalize_text(conversation_id),
                "message_id": None,
                "payload": payload,
                "dedupe_key": None,
            }
        ])

    def _enqueue_typing_event(self, *, conversation_id: str, user_id: int, bot: AppAiBot, is_typing: bool) -> None:
        normalized_conversation_id = _normalize_text(conversation_id)
        if not normalized_conversation_id or int(user_id or 0) <= 0:
            return
        self._enqueue_realtime_jobs([
            {
                "event_type": "chat.typing.started" if is_typing else "chat.typing.stopped",
                "target_scope": "conversation",
                "target_user_id": int(user_id),
                "conversation_id": normalized_conversation_id,
                "message_id": None,
                "payload": {
                    "user_id": int(bot.bot_user_id or 0),
                    "sender_name": _normalize_text(bot.title) or DEFAULT_BOT_TITLE,
                },
                "dedupe_key": None,
            }
        ])


ai_chat_service = AiChatService()
