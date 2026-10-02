"""AI chat endpoints."""
from __future__ import annotations

from backend.api.v1.chat._shim import chat_api
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException

from backend.api.deps import ensure_user_permission, require_permission
from backend.ai_chat.schemas import (
    AiBotListResponse,
    AiConversationStatusResponse,
    AiConversationUpdateRequest,
    AiMemoryItemResponse,
    AiMemoryListResponse,
    AiMemorySettingsRequest,
    AiMemoryUpdateRequest,
)
from backend.chat.schemas import ChatConversationSummary
from backend.models.auth import User
from backend.services.authorization_service import PERM_CHAT_AI_USE, PERM_CHAT_READ

router = APIRouter()


@router.get('/ai/conversations/{conversation_id}/access')
async def get_ai_conversation_access(conversation_id: str,
                                     current_user: User = Depends(require_permission(PERM_CHAT_READ))):
    from backend.ai_chat.access import conversation_access
    try:
        return await chat_api()._run_chat_call(conversation_access,
            conversation_id=conversation_id, user_id=int(current_user.id))
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations", response_model=ChatConversationSummary)
async def create_general_ai_conversation(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.create_general_conversation,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_created",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/ai/memory", response_model=AiMemoryListResponse)
async def get_ai_personal_memory(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.list_personal_memory,
        current_user_id=int(current_user.id),
    )


@router.patch("/ai/memory/settings", response_model=AiMemoryListResponse)
async def update_ai_personal_memory_settings(
    payload: AiMemorySettingsRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.set_personal_memory_enabled,
        current_user_id=int(current_user.id),
        enabled=payload.enabled,
    )


@router.patch("/ai/memory/{memory_id}", response_model=AiMemoryItemResponse)
async def update_ai_personal_memory_item(
    memory_id: str,
    payload: AiMemoryUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.update_personal_memory,
            memory_id=memory_id,
            current_user_id=int(current_user.id),
            content=payload.content,
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/memory/{memory_id}")
async def delete_ai_personal_memory_item(
    memory_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.delete_personal_memory,
            memory_id=memory_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/memory")
async def clear_ai_personal_memory(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.clear_personal_memory,
        current_user_id=int(current_user.id),
    )

@router.get("/ai/bots", response_model=AiBotListResponse)
async def list_ai_bots(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    return await chat_api()._run_chat_call(
        ai_chat_service.list_bots,
        current_user_id=int(current_user.id),
    )


@router.post("/ai/bots/{bot_id}/open", response_model=ChatConversationSummary)
async def open_ai_bot_conversation(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.open_bot_conversation,
            bot_id=bot_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/bots/{bot_id}/conversations", response_model=ChatConversationSummary)
async def create_ai_bot_conversation(
    bot_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.create_bot_conversation,
            bot_id=bot_id,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_created",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.patch("/ai/conversations/{conversation_id}", response_model=ChatConversationSummary)
async def update_ai_conversation(
    conversation_id: str,
    payload: AiConversationUpdateRequest,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        conversation = await chat_api()._run_chat_call(
            ai_chat_service.rename_conversation,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
            title=payload.title,
        )
        await chat_api()._publish_conversation_updated(
            conversation_id=conversation["id"],
            user_id=int(current_user.id),
            reason="ai_renamed",
        )
        return conversation
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.delete("/ai/conversations/{conversation_id}")
async def delete_ai_conversation(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        deleted = await chat_api()._run_chat_call(
            ai_chat_service.delete_conversation,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
        await chat_api()._publish_deleted_conversation(
            conversation_id=deleted["conversation_id"],
            member_user_ids=deleted["member_user_ids"],
            reason="ai_deleted",
        )
        return {"ok": True, "conversation_id": deleted["conversation_id"]}
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations/{conversation_id}/stop", response_model=AiConversationStatusResponse)
async def stop_ai_conversation_run(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.cancel_active_run,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations/{conversation_id}/retry", response_model=AiConversationStatusResponse)
async def retry_ai_conversation_run(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.retry_conversation_run,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/conversations/{conversation_id}/reset-context")
async def reset_ai_conversation_context(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.reset_conversation_context,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.get("/conversations/{conversation_id}/ai-status", response_model=AiConversationStatusResponse)
async def get_conversation_ai_status(
    conversation_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_READ)),
):
    ensure_user_permission(current_user, PERM_CHAT_AI_USE)
    from backend.ai_chat.service import ai_chat_service

    try:
        return await chat_api()._run_chat_call(
            ai_chat_service.get_conversation_status,
            conversation_id=conversation_id,
            current_user_id=int(current_user.id),
        )
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/confirm")
async def confirm_ai_action(
    action_id: str,
    payload: dict[str, Any] | None = Body(default=None),
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import confirm_action

    try:
        return await chat_api()._run_chat_call(
            confirm_action,
            action_id=action_id,
            current_user=current_user,
            payload_overrides=payload,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


@router.post("/ai/actions/{action_id}/cancel")
async def cancel_ai_action(
    action_id: str,
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    from backend.ai_chat.action_cards import cancel_action

    try:
        return await chat_api()._run_chat_call(
            cancel_action,
            action_id=action_id,
            current_user=current_user,
        )
    except LookupError:
        raise HTTPException(status_code=404, detail="Action was not found")
    except Exception as exc:
        chat_api()._raise_chat_http_error(exc)


# --- AG-6: read-only карта возможностей «HUB Ассистента» ---------------------
#
# Контракт «группа инструментов -> требуемые права портала» (раздел 25 плана
# CHAT_WEB_STABILITY_PLAN_2026-09-30). Базовая таблица статична; когда появится
# backend/ai_chat/tool_permissions.py (AG-2), точные права и фактический список
# доступных групп вычисляются из него — см. _assistant_group_permissions().

_AI_ASSISTANT_CAPABILITIES: tuple[dict[str, Any], ...] = (
    {
        "key": "files",
        "group": "files",
        "label": "Создание файлов, отчётов и конвертация документов",
        "permissions": ["chat.ai.use"],
    },
    {
        "key": "kb",
        "group": "kb",
        "label": "База знаний: поиск и чтение статей и вложений",
        "permissions": ["kb.read"],
    },
    {
        "key": "itinvent.read",
        "group": "itinvent",
        "label": "ITinvent: поиск техники, карточки, справочники, история и акты",
        "permissions": ["database.read"],
    },
    {
        "key": "itinvent.write",
        "group": "itinvent",
        "label": "ITinvent: черновики перемещений, статусов, локаций, расходников и работ",
        "permissions": ["database.write"],
    },
    {
        "key": "itinvent.multi_db",
        "group": "itinvent",
        "label": "ITinvent: поиск оборудования сразу по нескольким базам",
        "permissions": [],
        "admin_only": True,
    },
    {
        "key": "computers.read",
        "group": "itinvent",
        "label": "Компьютеры: поиск по ПК, пользователю, PST и профилям; аптайм, перезагрузка, диски",
        "permissions": ["computers.read"],
    },
    {
        "key": "self",
        "group": "self",
        "label": "Мои данные: моя техника, мой компьютер, моя учётная запись и обращение в IT",
        "permissions": ["chat.ai.use"],
    },
    {
        "key": "office.mail",
        "group": "office",
        "label": "Почта: поиск писем и черновики писем",
        "permissions": ["mail.access"],
    },
    {
        "key": "office.tasks.read",
        "group": "office",
        "label": "Задачи: просмотр и сводка рабочего дня",
        "permissions": ["tasks.read"],
    },
    {
        "key": "office.tasks.write",
        "group": "office",
        "label": "Задачи: создание, комментарии и смена статуса (черновики)",
        "permissions": ["tasks.create", "tasks.write"],
        "any_of": True,
    },
    {
        "key": "office.announcements",
        "group": "office",
        "label": "Объявления компании",
        "permissions": ["announcements.read"],
    },
    {
        "key": "mfu",
        "group": "mfu",
        "label": "МФУ и принтеры: список, статус SNMP/ping, счётчики страниц",
        "permissions": ["mfu.read"],
    },
    {
        "key": "ad.read",
        "group": "ad",
        "label": "Active Directory: срок пароля, блокировка, группы, история входов",
        "permissions": ["ad_users.read"],
        "it_only": True,
    },
    {
        "key": "ad.manage",
        "group": "ad",
        "label": "Active Directory: черновик разблокировки учётной записи",
        "permissions": ["ad_users.manage"],
        "it_only": True,
    },
    {
        "key": "network.read",
        "group": "network",
        "label": "Сеть: ping, DNS, SSL, порты коммутаторов, розетки, обзор филиала",
        "permissions": ["networks.read"],
        "it_only": True,
    },
    {
        "key": "network.write",
        "group": "network",
        "label": "Сеть: Wake-on-LAN (черновик)",
        "permissions": ["networks.write"],
        "it_only": True,
    },
    {
        "key": "chat.read",
        "group": "chat",
        "label": "Чат: поиск сотрудников и бесед",
        "permissions": ["chat.read"],
    },
    {
        "key": "chat.write",
        "group": "chat",
        "label": "Чат: черновик сообщения коллеге или в беседу",
        "permissions": ["chat.write"],
    },
    {
        "key": "other",
        "group": "other",
        "label": "Общие ответы без обращения к данным HUB",
        "permissions": [],
    },
)


def _load_tool_permissions_module():
    """AG-2 module; import defensively and tolerate late/parallel landing.

    tools.context грузится первым: прямой импорт tool_permissions может
    попасть на частично инициализированный tools-пакет (циклический импорт
    tools/__init__ -> registry -> tool_permissions).
    """
    try:
        from backend.ai_chat.tools import context as _tools_context  # noqa: F401
        from backend.ai_chat import tool_permissions  # type: ignore
    except Exception:
        try:
            from backend.ai_chat import tool_permissions  # type: ignore  # noqa: F811
        except Exception:
            return None
    return tool_permissions


def _registered_tool_ids() -> list[str]:
    try:
        from backend.ai_chat.tools import ai_tool_registry
        return [str(spec.get("tool_id") or "") for spec in ai_tool_registry.list_specs()
                if str(spec.get("tool_id") or "").strip()]
    except Exception:
        return []


def _assistant_group_permissions() -> dict[str, list[str]] | None:
    """group -> required permissions, вычисленные из tool_permissions (AG-2).

    Возвращает None, пока модуль/хелпер недоступен — тогда используется
    статичная таблица _AI_ASSISTANT_CAPABILITIES.
    """
    module = _load_tool_permissions_module()
    getter = getattr(module, "tool_required_permissions", None) if module else None
    if not callable(getter):
        return None
    try:
        from backend.ai_chat.tools.context import get_tool_group
    except Exception:
        return None
    grouped: dict[str, set[str]] = {}
    for tool_id in _registered_tool_ids():
        try:
            required = getter(tool_id)
        except Exception:
            continue
        permissions = {
            str(item or "").strip()
            for item in list(required or [])
            if str(item or "").strip()
        }
        if not permissions:
            continue
        grouped.setdefault(get_tool_group(tool_id), set()).update(permissions)
    return {group: sorted(perms) for group, perms in grouped.items()} or None


def _assistant_allowed_groups(user_payload: dict[str, Any], tool_ids: list[str]) -> set[str] | None:
    """Фактически доступные пользователю группы через filter_tools_for_user (AG-2)."""
    module = _load_tool_permissions_module()
    filter_fn = getattr(module, "filter_tools_for_user", None) if module else None
    if not callable(filter_fn) or not tool_ids:
        return None
    try:
        allowed = filter_fn(list(tool_ids), user_payload)
    except Exception:
        return None
    if allowed is None:
        return None
    try:
        from backend.ai_chat.tools.context import get_tool_group
    except Exception:
        return None
    return {get_tool_group(item) for item in list(allowed or [])}


def _capability_granted(row: dict[str, Any], *, effective: set[str], is_admin: bool) -> bool:
    if is_admin:
        return True
    required = {str(item or "").strip() for item in list(row.get("permissions") or [])}
    required.discard("")
    if row.get("admin_only"):
        return False
    if not required:
        return True
    if row.get("any_of"):
        return bool(required & effective)
    return required <= effective


@router.get("/ai/assistant/capabilities")
async def get_ai_assistant_capabilities(
    current_user: User = Depends(require_permission(PERM_CHAT_AI_USE)),
):
    """Read-only карта «что умеет ассистент» с пометкой доступных текущему
    пользователю возможностей по его правам портала (AG-6)."""
    effective = {str(item or "").strip() for item in list(getattr(current_user, "permissions", []) or [])}
    effective.discard("")
    is_admin = str(getattr(current_user, "role", "") or "").strip().lower() == "admin"
    user_payload = {
        "id": int(getattr(current_user, "id", 0) or 0),
        "role": getattr(current_user, "role", None),
        "permissions": sorted(effective),
        "use_custom_permissions": bool(getattr(current_user, "use_custom_permissions", False)),
        "custom_permissions": list(getattr(current_user, "custom_permissions", []) or []),
    }

    tool_ids = _registered_tool_ids()
    group_permissions = await chat_api()._run_chat_call(_assistant_group_permissions)
    allowed_groups = await chat_api()._run_chat_call(
        _assistant_allowed_groups, user_payload, tool_ids
    )
    source = "tool_permissions" if group_permissions is not None else "static"

    capabilities: list[dict[str, Any]] = []
    for row in _AI_ASSISTANT_CAPABILITIES:
        item = dict(row)
        item["granted"] = _capability_granted(row, effective=effective, is_admin=is_admin)
        if allowed_groups is not None and item.get("group") in {
            "itinvent", "office", "files", "mfu", "network", "ad", "kb", "chat", "self",
        }:
            # AG-2: учитываем и фактический набор групп из filter_tools_for_user,
            # и точные права строки — групповая доступность не должна
            # «включать» возможности вроде почты без mail.access.
            item["granted"] = item["granted"] and item["group"] in allowed_groups
        capabilities.append(item)

    return {
        "assistant": {
            "label": "HUB Ассистент",
            "access": "all_with_permission",
            "required_permission": PERM_CHAT_AI_USE,
        },
        "capabilities": capabilities,
        "group_permissions": group_permissions,
        "source": source,
    }


