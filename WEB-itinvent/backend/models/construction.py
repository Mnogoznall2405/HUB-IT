from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ConstructionObjectKind = Literal["project", "general", "unassigned"]
ConstructionRoleKey = Literal["project_lead", "pto_manager", "umto_coordinator"]


class ConstructionObjectGroup(BaseModel):
    group_ref: str
    group_name: str = ""


class ConstructionTeamMember(BaseModel):
    role_key: ConstructionRoleKey
    employee_code: str
    full_name: str
    position: str = ""
    department: str = ""
    department_location: str = ""
    valid_from: str | None = None
    valid_to: str | None = None


class ConstructionRecentRequest(BaseModel):
    request_ref: str
    number: str
    date: str | None = None
    required_date: str | None = None
    department_name: str = ""
    responsible_name: str = ""
    warehouse_name: str = ""


class ConstructionObjectSummary(BaseModel):
    object_ref: str
    name: str
    kind: ConstructionObjectKind
    request_count: int = Field(ge=0)
    requests_last_30_days: int = Field(ge=0)
    posted_count: int = Field(ge=0)
    latest_request_at: str | None = None
    latest_request_number: str = ""
    department_names: list[str] = Field(default_factory=list)
    responsible_names: list[str] = Field(default_factory=list)
    warehouse_names: list[str] = Field(default_factory=list)
    recent_requests: list[ConstructionRecentRequest] = Field(default_factory=list)
    managed: bool = False
    managed_object_id: str | None = None
    source_groups: list[ConstructionObjectGroup] = Field(default_factory=list)
    team: list[ConstructionTeamMember] = Field(default_factory=list)


class ConstructionPortfolioTotals(BaseModel):
    project_count: int = Field(ge=0)
    request_count: int = Field(ge=0)
    requests_last_30_days: int = Field(ge=0)
    general_request_count: int = Field(ge=0)
    unassigned_request_count: int = Field(ge=0)


class ConstructionCacheState(BaseModel):
    state: Literal["fresh", "cached", "stale"]
    age_seconds: int = Field(ge=0)
    last_error: str = ""
    coalesced: bool = False
    refresh_suppressed: bool = False


class ConstructionObjectsResponse(BaseModel):
    items: list[ConstructionObjectSummary]
    next_cursor: str | None = None
    has_more: bool
    snapshot_changed: bool = False
    as_of: str
    window_from: str
    scanned_requests: int = Field(ge=0)
    scan_truncated: bool = False
    summary: ConstructionPortfolioTotals
    cache: ConstructionCacheState
    management_available: bool = False


class ConstructionManagedObject(BaseModel):
    id: str
    name: str
    is_active: bool = True
    groups: list[ConstructionObjectGroup] = Field(default_factory=list)
    team: list[ConstructionTeamMember] = Field(default_factory=list)
    role_history: list[ConstructionTeamMember] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class ConstructionManagementResponse(BaseModel):
    objects: list[ConstructionManagedObject] = Field(default_factory=list)
    available_groups: list[ConstructionObjectGroup] = Field(default_factory=list)
    as_of: str | None = None


class ConstructionObjectGroupInput(BaseModel):
    group_ref: str = Field(min_length=1, max_length=64)
    group_name: str = Field(default="", max_length=255)


class ConstructionRoleSelection(BaseModel):
    role_key: ConstructionRoleKey
    employee_code: str = Field(min_length=1, max_length=128)


class ConstructionObjectSaveRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    groups: list[ConstructionObjectGroupInput] = Field(min_length=1, max_length=100)
    roles: list[ConstructionRoleSelection] = Field(default_factory=list, max_length=3)


class ConstructionObjectDetail(BaseModel):
    id: str
    name: str = ""
    kind: Literal["project"] = "project"
    managed: bool = False
    is_active: bool = True
    groups: list[ConstructionObjectGroup] = Field(default_factory=list)
    team: list[ConstructionTeamMember] = Field(default_factory=list)
    role_history: list[ConstructionTeamMember] = Field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None


class ConstructionObjectRequestTotals(BaseModel):
    total: int = Field(ge=0)
    active: int = Field(ge=0)
    history: int = Field(ge=0)
    overdue: int = Field(ge=0)


class ConstructionObjectContactStat(BaseModel):
    name: str
    active_requests: int = Field(ge=0)


class ConstructionObjectStageStat(BaseModel):
    key: str
    label: str
    count: int = Field(ge=0)


class ConstructionObjectRequestOverview(BaseModel):
    buyers: list[ConstructionObjectContactStat] = Field(default_factory=list)
    request_responsibles: list[ConstructionObjectContactStat] = Field(default_factory=list)
    departments: list[ConstructionObjectContactStat] = Field(default_factory=list)
    warehouses: list[ConstructionObjectContactStat] = Field(default_factory=list)
    stages: list[ConstructionObjectStageStat] = Field(default_factory=list)


class ConstructionObjectRequestsResponse(BaseModel):
    items: list[dict[str, Any]] = Field(default_factory=list)
    next_cursor: str | None = None
    has_more: bool = False
    total: int = Field(ge=0)
    snapshot_id: str
    snapshot_changed: bool = False
    as_of: str
    window_from: str
    truncated: bool = False
    source_groups: list[ConstructionObjectGroup] = Field(default_factory=list)
    warehouse_facets: list[dict[str, Any]] = Field(default_factory=list)
    overview: ConstructionObjectRequestOverview = Field(default_factory=ConstructionObjectRequestOverview)
    summary: ConstructionObjectRequestTotals
    cache: dict[str, Any] = Field(default_factory=dict)
    query_metrics: dict[str, Any] = Field(default_factory=dict)
