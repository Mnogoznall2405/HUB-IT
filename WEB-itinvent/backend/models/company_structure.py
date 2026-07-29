"""Typed contracts for the company structure API."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class CompanyStructureNodeResponse(BaseModel):
    id: str
    parent_id: str | None = None
    node_type: str
    title: str
    person_name: str = ""
    person_position: str = ""
    sort_order: int = 0
    is_active: bool = True
    department_codes: list[str] = Field(default_factory=list)
    children: list["CompanyStructureNodeResponse"] = Field(default_factory=list)
    created_at: str = ""
    updated_at: str = ""


class CompanyStructureTreeResponse(BaseModel):
    items: list[CompanyStructureNodeResponse] = Field(default_factory=list)
    count: int = 0


class CompanyStructureNodeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    parent_id: str | None = None
    node_type: str = "other"
    title: str = "Новый узел"
    person_name: str = ""
    person_position: str = ""
    sort_order: int = 0
    department_codes: list[str] = Field(default_factory=list)


class CompanyStructureNodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    parent_id: str | None = None
    node_type: str | None = None
    title: str | None = None
    person_name: str | None = None
    person_position: str | None = None
    sort_order: int | None = None
    is_active: bool | None = None
    department_codes: list[str] | None = None


class CompanyStructureMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    parent_id: str | None = None
    position: int = Field(ge=0)


class CompanyStructureImportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    parent_id: str | None = None
    departments: list[str] = Field(min_length=1, max_length=500)


class CompanyStructureSkippedImport(BaseModel):
    department: str
    reason: str


class CompanyStructureImportResponse(BaseModel):
    created: list[CompanyStructureNodeResponse] = Field(default_factory=list)
    skipped: list[CompanyStructureSkippedImport] = Field(default_factory=list)


class CompanyStructureWorkPerson(BaseModel):
    """Employee allowlist: no personal contact fields are part of this contract."""

    full_name: str
    position: str = ""
    department: str = ""
    department_location: str = ""
    work_phones: list[str] = Field(default_factory=list)
    work_emails: list[str] = Field(default_factory=list)


class CompanyStructurePeopleResponse(BaseModel):
    node: CompanyStructureNodeResponse
    department_codes: list[str] = Field(default_factory=list)
    matched_by_title: bool = False
    items: list[CompanyStructureWorkPerson] = Field(default_factory=list)
    total: int = 0


class CompanyStructurePathItem(BaseModel):
    id: str
    title: str


class CompanyStructureSearchItem(BaseModel):
    kind: Literal["node", "person"]
    node_id: str | None = None
    title: str
    subtitle: str = ""
    department: str = ""
    department_location: str = ""
    work_phones: list[str] = Field(default_factory=list)
    work_emails: list[str] = Field(default_factory=list)
    path: list[CompanyStructurePathItem] = Field(default_factory=list)


class CompanyStructureSearchResponse(BaseModel):
    items: list[CompanyStructureSearchItem] = Field(default_factory=list)
    total: int = 0
    limit: int

