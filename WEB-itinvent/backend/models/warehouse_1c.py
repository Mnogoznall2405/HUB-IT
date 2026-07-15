"""Request contracts for the read-only 1C reconcile workflow.

These models describe mutations of HUB metadata only.  They never represent a
write to 1C.
"""
from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator


class _Warehouse1CRequest(BaseModel):
    """Shared strict parsing and compatibility aliases for warehouse requests."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True, str_strip_whitespace=True)


class Warehouse1CBalanceBatchRequest(_Warehouse1CRequest):
    """One bounded read-only 1C balance query for multiple nomenclatures."""

    nomenclature_refs: list[str] = Field(
        ...,
        min_length=1,
        max_length=50,
        validation_alias=AliasChoices("nomenclature_refs", "nomenclatureRefs"),
        serialization_alias="nomenclatureRefs",
    )
    warehouse_ref: str | None = Field(
        default=None,
        max_length=64,
        validation_alias=AliasChoices("warehouse_ref", "warehouseRef"),
        serialization_alias="warehouseRef",
    )
    limit_per_nomenclature: int = Field(
        default=50,
        ge=1,
        le=200,
        validation_alias=AliasChoices("limit_per_nomenclature", "limitPerNomenclature"),
        serialization_alias="limitPerNomenclature",
    )

    @field_validator("nomenclature_refs")
    @classmethod
    def _refs_are_non_empty(cls, refs: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(str(ref or "").strip() for ref in refs if str(ref or "").strip()))
        if not normalized:
            raise ValueError("At least one nomenclature_ref is required")
        return normalized


class _ReconcileMutationRequest(_Warehouse1CRequest):
    """Fields common to a user-confirmed HUB reconcile mutation."""

    inv_no: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("inv_no", "invNo"),
        serialization_alias="invNo",
        description="HUB inventory number",
    )
    reason: str = Field(
        ...,
        min_length=3,
        max_length=500,
        description="Human-readable reason for the reconcile decision",
    )
    expected_part_no: str | None = Field(
        default=None,
        max_length=200,
        validation_alias=AliasChoices("expected_part_no", "expectedPartNo"),
        serialization_alias="expectedPartNo",
        description="PART_NO observed by the caller before confirming the change",
    )
    expected_version: int = Field(
        ...,
        ge=0,
        validation_alias=AliasChoices("expected_version", "expectedVersion"),
        serialization_alias="expectedVersion",
        description="Version of the app-owned 1C link observed by the caller (0 when it does not exist yet)",
    )
    confirm: bool = Field(
        default=False,
        description="Explicit confirmation that the reviewed preview must be applied",
    )
    @field_validator("expected_part_no", mode="before")
    @classmethod
    def _keep_expected_part_no_blank_for_optimistic_lock(cls, value: object) -> str | None | object:
        if isinstance(value, str):
            return value.strip()
        return value

class ReconcileApplyPartNoRequest(_ReconcileMutationRequest):
    """Confirm one exact 1C nomenclature link for a HUB equipment card."""

    nomenclature_ref: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("nomenclature_ref", "nomenclatureRef"),
        serialization_alias="nomenclatureRef",
        description="Stable 1C nomenclature reference selected by the user",
    )
    part_no: str = Field(
        ...,
        min_length=1,
        max_length=200,
        validation_alias=AliasChoices("part_no", "partNo"),
        serialization_alias="partNo",
        description="1C nomenclature code retained in legacy HUB PART_NO",
    )


class ReconcileMarkNotIn1CRequest(_ReconcileMutationRequest):
    """Record a reviewed decision that an item has no matching 1C record."""


class ReconcileAutoLinkRequest(_Warehouse1CRequest):
    """Preview automatic candidates; this endpoint never applies a link."""

    limit: int = Field(default=50, ge=1, le=200)
    dry_run: bool = Field(
        default=True,
        validation_alias=AliasChoices("dry_run", "dryRun"),
        serialization_alias="dryRun",
    )
    confirm: bool = Field(default=False)
    reason: str | None = Field(default=None, min_length=3, max_length=500)
    @field_validator("reason", mode="before")
    @classmethod
    def _blank_optional_values_are_none(cls, value: object) -> str | None | object:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class ReconcileAiSuggestRequest(_Warehouse1CRequest):
    """Read-only request for AI/catalogue reconcile suggestions."""

    inv_no: str = Field(
        default="",
        max_length=64,
        validation_alias=AliasChoices("inv_no", "invNo"),
        serialization_alias="invNo",
    )
    model_name: str = Field(
        default="",
        max_length=500,
        validation_alias=AliasChoices("model_name", "modelName"),
        serialization_alias="modelName",
    )
    serial_no: str = Field(
        default="",
        max_length=200,
        validation_alias=AliasChoices("serial_no", "serialNo"),
        serialization_alias="serialNo",
    )
    limit: int = Field(default=3, ge=1, le=15)


class WarehouseOwnerLinkRequest(_Warehouse1CRequest):
    """Explicit confirmed 1C warehouse to HUB owner mapping."""

    warehouse_ref: str = Field(
        ...,
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("warehouse_ref", "warehouseRef"),
        serialization_alias="warehouseRef",
    )
    owner_no: int = Field(
        ...,
        ge=1,
        validation_alias=AliasChoices("owner_no", "ownerNo"),
        serialization_alias="ownerNo",
    )
    status: Literal["active", "inactive", "invalid"] = "active"
    reason: str = Field(..., min_length=3, max_length=500)
    expected_version: int = Field(
        ...,
        ge=0,
        validation_alias=AliasChoices("expected_version", "expectedVersion"),
        serialization_alias="expectedVersion",
    )
    confirm: bool = False


class EmployeeOwnerLinkRequest(_Warehouse1CRequest):
    """Explicit ZUP employee code/ref to HUB owner mapping."""

    employee_code: str = Field(
        ...,
        min_length=1,
        max_length=128,
        validation_alias=AliasChoices("employee_code", "employeeCode"),
        serialization_alias="employeeCode",
    )
    owner_no: int = Field(
        ...,
        ge=1,
        validation_alias=AliasChoices("owner_no", "ownerNo"),
        serialization_alias="ownerNo",
    )
    status: Literal["active", "inactive", "invalid"] = "active"
    reason: str = Field(..., min_length=3, max_length=500)
    expected_version: int = Field(
        ...,
        ge=0,
        validation_alias=AliasChoices("expected_version", "expectedVersion"),
        serialization_alias="expectedVersion",
    )
    confirm: bool = False
