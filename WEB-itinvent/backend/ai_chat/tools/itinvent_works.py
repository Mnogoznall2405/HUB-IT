"""Works-operations draft tools for ai_chat (shared JSON ops: cartridge, battery, component, PC cleaning)."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AiToolExecutionContext,
    ITINVENT_TOOL_ACTION_BATTERY_REPLACEMENT_DRAFT,
    ITINVENT_TOOL_ACTION_CARTRIDGE_REPLACEMENT_DRAFT,
    ITINVENT_TOOL_ACTION_COMPONENT_REPLACEMENT_DRAFT,
    ITINVENT_TOOL_ACTION_PC_CLEANING_DRAFT,
)
from backend.ai_chat.tools.registry import ai_tool_registry


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _build_source(database_id: object) -> dict:
    return {"type": "itinvent", "database_id": _normalize_text(database_id)}


def _resolve_tool_database_id(context: AiToolExecutionContext, args: BaseModel) -> str:
    requested = _normalize_text(getattr(args, "database_id", None))
    if requested:
        return requested
    return _normalize_text(getattr(context, "effective_database_id", None))


def _database_error(tool_id: str, database_id: object) -> AiToolResult:
    return AiToolResult(
        tool_id=tool_id,
        ok=False,
        database_id=_normalize_text(database_id) or None,
        error="ITinvent database is not resolved. Ask the user which database to use.",
        sources=[_build_source(database_id)],
    )


class WorksDraftArgs(BaseModel):
    inv_no: Optional[str] = Field(default=None, max_length=120)
    serial_number: Optional[str] = Field(default=None, max_length=200)
    comment: Optional[str] = Field(default=None, max_length=1000)
    database_id: Optional[str] = Field(default=None, max_length=128)

    @field_validator("inv_no", "serial_number", "comment", "database_id", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None

    @model_validator(mode="after")
    def _require_identifier(self):
        if not self.inv_no and not self.serial_number:
            raise ValueError("inv_no or serial_number is required")
        return self


class CartridgeReplacementDraftArgs(WorksDraftArgs):
    cartridge_color: Optional[str] = Field(default=None, max_length=60)
    component_type: Optional[str] = Field(default=None, max_length=120)
    component_color: Optional[str] = Field(default=None, max_length=60)
    cartridge_model: Optional[str] = Field(default=None, max_length=200)

    @field_validator("cartridge_color", "component_type", "component_color", "cartridge_model", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class ComponentReplacementDraftArgs(WorksDraftArgs):
    component_type: str = Field(..., min_length=1, max_length=120)
    component_model: Optional[str] = Field(default=None, max_length=200)
    component_name: Optional[str] = Field(default=None, max_length=200)

    @field_validator("component_type", "component_model", "component_name", mode="before")
    @classmethod
    def _normalize(cls, value):
        text = _normalize_text(value)
        return text or None


class BatteryReplacementDraftArgs(WorksDraftArgs):
    pass


class PcCleaningDraftArgs(WorksDraftArgs):
    pass


class _WorksDraftToolBase(AiTool):
    stage = "checking_itinvent"
    works_action_type: str = ""

    def execute(self, *, context: AiToolExecutionContext, args: WorksDraftArgs) -> AiToolResult:
        database_id = _resolve_tool_database_id(context, args)
        if not database_id:
            return _database_error(self.tool_id, getattr(args, "database_id", None))
        try:
            from backend.ai_chat.action_cards import build_works_draft

            card = build_works_draft(
                action_type=self.works_action_type,
                conversation_id=context.conversation_id,
                run_id=context.run_id,
                requester_user_id=int(context.user_id),
                database_id=database_id,
                payload=args.model_dump(),
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                database_id=database_id,
                data={"action_card": card, "requires_confirmation": True},
                sources=[_build_source(database_id)],
            )
        except Exception as exc:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                database_id=database_id,
                error=str(exc),
                sources=[_build_source(database_id)],
            )


class CartridgeReplacementDraftTool(_WorksDraftToolBase):
    tool_id = ITINVENT_TOOL_ACTION_CARTRIDGE_REPLACEMENT_DRAFT
    description = (
        "Create a pending action card to record a cartridge/toner replacement on a printer or MFU. "
        "Does not write anything until the user confirms the card."
    )
    input_model = CartridgeReplacementDraftArgs
    works_action_type = "itinvent.works.cartridge"


class BatteryReplacementDraftTool(_WorksDraftToolBase):
    tool_id = ITINVENT_TOOL_ACTION_BATTERY_REPLACEMENT_DRAFT
    description = (
        "Create a pending action card to record a motherboard battery replacement on equipment. "
        "Does not write anything until the user confirms the card."
    )
    input_model = BatteryReplacementDraftArgs
    works_action_type = "itinvent.works.battery"


class ComponentReplacementDraftTool(_WorksDraftToolBase):
    tool_id = ITINVENT_TOOL_ACTION_COMPONENT_REPLACEMENT_DRAFT
    description = (
        "Create a pending action card to record a component replacement (fuser, drum, roller, PC part). "
        "Does not write anything until the user confirms the card."
    )
    input_model = ComponentReplacementDraftArgs
    works_action_type = "itinvent.works.component"


class PcCleaningDraftTool(_WorksDraftToolBase):
    tool_id = ITINVENT_TOOL_ACTION_PC_CLEANING_DRAFT
    description = (
        "Create a pending action card to record a PC/workstation cleaning. "
        "Does not write anything until the user confirms the card."
    )
    input_model = PcCleaningDraftArgs
    works_action_type = "itinvent.works.pc_cleaning"


for tool in [
    CartridgeReplacementDraftTool(),
    BatteryReplacementDraftTool(),
    ComponentReplacementDraftTool(),
    PcCleaningDraftTool(),
]:
    ai_tool_registry.register(tool)
