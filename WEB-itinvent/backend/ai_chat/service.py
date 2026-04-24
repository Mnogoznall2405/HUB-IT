from __future__ import annotations

import asyncio
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

from backend.ai_chat.artifact_generator import build_generated_uploads
from backend.ai_chat.document_extractors import extract_text_from_path
from backend.ai_chat.openrouter_client import OpenRouterClientError, openrouter_client
from backend.ai_chat.retrieval import ai_kb_retrieval_service
from backend.ai_chat.tools import ai_tool_registry
from backend.ai_chat.tools.context import (
    AI_TOOL_MULTI_DB_MODE_SINGLE,
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
    "- Exact inventory numbers, serial numbers, hardware serials, MAC addresses, hostnames or domains: "
    "use equipment search first, then equipment card for a single concrete device.\n"
    "- Employee or department questions: use employee search, then employee equipment list.\n"
    "- Broad equipment questions about categories, vendors, models, departments, branches or locations: "
    "use universal equipment search.\n"
    "- Consumables, cartridges, components and stock questions: use consumables search.\n"
    "- Branch inventory questions: resolve the branch, then use branch equipment list.\n"
    "- Use type/status/branch/location directory tools to clarify canonical labels before asking the user."
)
AI_ITINVENT_STRUCTURED_RESPONSE_GUIDE = (
    "When you answer with live ITinvent data, produce a structured detailed markdown answer in Russian. "
    "Do not return a dry list of inventory numbers when richer fields are available. "
    "For employee equipment answers use sections like '## Итог' and '## Устройства' with type/model, inventory number, "
    "serial number, status and location. For exact device cards use sections 'Устройство', 'Закрепление', 'Локация', "
    "'Сеть', 'Статус', 'Примечание'. For broad search answers use '## Найдено', a short grouped summary, a few relevant "
    "examples, and one narrowing suggestion when the result set is broad. For consumables include model, type, quantity, "
    "branch and location. Show network fields and owner email by default only for exact single-device answers."
)


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


def _default_bot_tool_settings() -> dict[str, Any]:
    return normalize_tool_settings(
        {
            "multi_db_mode": AI_TOOL_MULTI_DB_MODE_SINGLE,
            "allowed_databases": [],
        }
    )


def _is_live_data_enabled(enabled_tools: Any) -> bool:
    return bool(normalize_enabled_tools(enabled_tools))


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
        self.initialize_runtime()
        with app_session() as session:
            run = session.execute(
                select(AppAiBotRun)
                .where(AppAiBotRun.status == "queued")
                .order_by(AppAiBotRun.created_at.asc())
                .limit(1)
            ).scalar_one_or_none()
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
            bot_payload = self._serialize_bot(bot)
            request_context = _json_loads(getattr(run, "request_json", "{}"), {})
        started_at = _utc_now()
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

            answer_markdown, artifacts, kb_attachment_send, usage, extracted_context, tool_traces = self._execute_run(
                bot=bot,
                run_payload=run_payload,
                request_context=request_context,
                report_stage=report_stage,
            )
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
                reply_message = chat_service.send_message(
                    current_user_id=bot_user_id,
                    conversation_id=run.conversation_id,
                    body=answer_markdown,
                    body_format="markdown",
                    defer_push_notifications=True,
                )
                self._enqueue_message_side_effects_after_send(
                    conversation_id=run.conversation_id,
                    message_id=_normalize_text(reply_message.get("id")),
                )
            if selected_template_candidate is not None:
                report_stage(AI_RUN_STAGE_GENERATING_FILES)
                delivered_kb_attachment = self._send_kb_template_attachment(
                    current_user_id=bot_user_id,
                    conversation_id=run.conversation_id,
                    candidate=selected_template_candidate,
                )
            if artifacts and bool(bot.allow_generated_artifacts):
                report_stage(AI_RUN_STAGE_GENERATING_FILES)
                uploads = build_generated_uploads(artifacts)
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
                tool_results.append(payload)
                tool_traces.append(
                    {
                        **audit_row,
                        "args": dict(call.get("args") or {}),
                        "error": _normalize_text(payload.get("error")) or None,
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
    ) -> tuple[str, list[dict[str, Any]], dict[str, str] | None, dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
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
        extracted_context = self._build_conversation_context(
            conversation_id=run_payload["conversation_id"],
            trigger_message_id=run_payload["trigger_message_id"],
            bot_user_id=int(bot.bot_user_id or 0),
            bot_title=bot.title,
            allow_files=bool(bot.allow_file_input),
            can_read_kb=_user_has_permission(user_payload, PERM_KB_READ),
            allowed_kb_scope=_json_loads(bot.allowed_kb_scope_json, []),
            allow_kb_document_delivery=bool(getattr(bot, "allow_kb_document_delivery", False)),
            report_stage=report_stage,
        )
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
        tool_specs_text = _format_tool_results_for_prompt(tool_specs)
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
                    (
                        "Return JSON only. Allowed top-level keys are answer_markdown, artifacts, "
                        "kb_attachment_send, tool_calls. artifacts is optional. "
                        "kb_attachment_send must be null or an object with article_id and attachment_id chosen "
                        "only from the provided template candidates. tool_calls is optional and may contain up to "
                        "3 objects with keys tool_id and args."
                    ),
                    (
                        "Use tool_calls only when you need live ITinvent data. "
                        "Do not invent live database facts without tool results. "
                        "If you request tool_calls, leave answer_markdown empty or brief and wait for tool results. "
                        "Never promise to make another live query later unless you return the needed tool_calls now."
                    ),
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
                        "If a generated file is needed, place it into artifacts. "
                        "If template auto-send is allowed and one suitable template should be sent now, "
                        "set kb_attachment_send to its ids. If candidates are ambiguous or auto-send is not allowed, "
                        "ask a short clarification question and keep kb_attachment_send null."
                    ),
                    (
                        f"Live ITinvent tools enabled for this bot:\n{tool_specs_text}"
                        if tool_specs
                        else "Live ITinvent tools are disabled for this bot."
                    ),
                    (
                        f"Current ITinvent database: {current_database_label}"
                        if tool_specs
                        else ""
                    ),
                    (
                        AI_ITINVENT_TOOL_ROUTING_GUIDE
                        if tool_specs
                        else ""
                    ),
                    (
                        AI_ITINVENT_STRUCTURED_RESPONSE_GUIDE
                        if tool_specs
                        else ""
                    ),
                    (
                        "If you use live ITinvent data in the final answer, explicitly cite the source as "
                        "'Источник: ITinvent / <database_id>'."
                        if tool_specs
                        else ""
                    ),
                    (
                        "If another live ITinvent lookup is needed, return tool_calls in the same JSON response. "
                        "Do not answer with phrases like 'подождите' or 'сейчас проверю' without returning tool_calls."
                        if tool_specs
                        else ""
                    ),
                ]
                if part
            ]
        )

        def _complete_json_step(*, current_system_prompt: str, current_user_prompt: str) -> tuple[dict[str, Any], dict[str, Any]]:
            try:
                payload, usage = openrouter_client.complete_json(
                    system_prompt=current_system_prompt,
                    user_prompt=current_user_prompt,
                    model=_normalize_text(bot.model),
                    temperature=float(bot.temperature or 0.2),
                    max_tokens=int(bot.max_tokens or 2000),
                )
            except OpenRouterClientError as exc:
                raise RuntimeError(str(exc)) from exc
            return payload if isinstance(payload, dict) else {}, usage or {}

        if callable(report_stage):
            report_stage(AI_RUN_STAGE_GENERATING_ANSWER)
        payload, usage = _complete_json_step(
            current_system_prompt=system_prompt,
            current_user_prompt=user_prompt,
        )
        tool_traces: list[dict[str, Any]] = []
        final_payload = payload
        final_usage = usage or {}
        accumulated_tool_results: list[dict[str, Any]] = []
        tool_rounds_used = 0
        while tool_specs and tool_rounds_used < AI_TOOL_ROUND_LIMIT:
            tool_calls = _normalize_tool_calls(final_payload.get("tool_calls"))
            if not tool_calls:
                break
            tool_results, round_traces = self._execute_tool_calls(
                tool_calls=tool_calls,
                tool_context=tool_context,
                report_stage=report_stage,
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
                        (
                            "Return JSON only. Allowed top-level keys are answer_markdown, artifacts, "
                            "kb_attachment_send, tool_calls. artifacts is optional. "
                            "tool_calls may contain up to 3 objects with keys tool_id and args."
                        ),
                        (
                            "Use the accumulated live ITinvent tool results. "
                            "If more live data is still required, return the next tool_calls now. "
                            "Do not promise another lookup later without returning tool_calls."
                        ),
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
                        "If another live ITinvent lookup is still required, return tool_calls for the next step instead of a placeholder. "
                        "When you use live ITinvent data in the final answer, cite the source as 'Источник: ITinvent / <database_id>'. "
                        "Keep the answer structured and detailed, not a bare list."
                    ),
                ]
            )
            next_payload, next_usage = _complete_json_step(
                current_system_prompt=followup_system_prompt,
                current_user_prompt=followup_user_prompt,
            )
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
                        (
                            "Return JSON only with keys answer_markdown, artifacts, kb_attachment_send. "
                            "Do not return tool_calls in this final pass."
                        ),
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
                        "Keep the answer structured and detailed, not a bare list."
                    ),
                ]
            )
            forced_final_payload, forced_final_usage = _complete_json_step(
                current_system_prompt=forced_final_system_prompt,
                current_user_prompt=forced_final_user_prompt,
            )
            final_payload = forced_final_payload
            final_usage = _merge_usage(final_usage, forced_final_usage)
        answer_markdown = _truncate(final_payload.get("answer_markdown"), limit=12000)
        artifacts = [
            item
            for item in list(final_payload.get("artifacts") or [])
            if isinstance(item, dict)
        ]
        kb_attachment_send = _normalize_kb_attachment_send(final_payload.get("kb_attachment_send"))
        return answer_markdown, artifacts, kb_attachment_send, final_usage, extracted_context, tool_traces
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
            return _normalize_text(self._attachment_text_cache.get(cache_key))
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
