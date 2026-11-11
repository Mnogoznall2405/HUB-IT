"""Validated native construction plan and daily production journal."""
from datetime import date
from decimal import Decimal
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

Quantity = Annotated[Decimal, Field(ge=0, le=999999999, max_digits=13, decimal_places=4)]
WorkDate = Annotated[date, Field(ge=date(2000, 1, 1), le=date(2100, 12, 31))]


class WorkModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class WorkPlan(WorkModel):
    section: str = Field(min_length=1, max_length=200)
    name: str = Field(min_length=1, max_length=500)
    unit: str = Field(min_length=1, max_length=32)
    planned_quantity: Quantity
    weight: Quantity | None = None
    initial_quantity: Quantity = Decimal(0)
    initial_date: WorkDate | None = None
    planned_start: WorkDate | None = None
    planned_end: WorkDate | None = None
    revised_start: WorkDate | None = None
    revised_end: WorkDate | None = None
    actual_start: WorkDate | None = None
    actual_end: WorkDate | None = None
    material_comment: str = Field(default="", max_length=2000)
    production_comment: str = Field(default="", max_length=2000)
    sort_order: int = Field(default=0, ge=0, le=1000000)
    archived: bool = False

    @model_validator(mode="after")
    def validate_dates(self):
        if self.initial_quantity and not self.initial_date:
            raise ValueError("Укажите дату начального выполненного объёма")
        for field in ("initial_date", "actual_start", "actual_end"):
            if getattr(self, field) and getattr(self, field) > date.today():
                raise ValueError("Дата фактически выполненных работ не может быть в будущем")
        for prefix in ("planned", "revised", "actual"):
            start, end = getattr(self, f"{prefix}_start"), getattr(self, f"{prefix}_end")
            if start and end and start > end:
                raise ValueError("Окончание работ не может быть раньше начала")
        return self


class WorkPlanChange(WorkModel):
    id: UUID
    expected_version: int = Field(ge=0)
    plan: WorkPlan


class WorkPlanBatch(WorkModel):
    items: list[WorkPlanChange] = Field(min_length=1, max_length=300)


class WorkDayValues(WorkModel):
    quantity: Quantity
    engineers: int = Field(default=0, ge=0, le=10000)
    installers: int = Field(default=0, ge=0, le=10000)
    comment: str = Field(default="", max_length=2000)


class WorkDayChange(WorkDayValues):
    id: UUID
    expected_version: int = Field(ge=1)


class WorkDayBatch(WorkModel):
    work_date: WorkDate
    items: list[WorkDayChange] = Field(min_length=1, max_length=300)


class WorkCalculationInfo(BaseModel):
    method: str
    source_sheet: str
    section_count: int
    included_works: int
    excluded_works: int
    missing_works: int
    baseline_date: date
    notes: list[str] = Field(default_factory=list)


class WorkCalculationSection(BaseModel):
    name: str
    percent: float | None


class WorkSummary(BaseModel):
    total: int
    percent: float | None
    missing_weights_or_plan: int
    completed: int
    over_plan: int
    overdue: int
    calculation: WorkCalculationInfo | None = None


class WorkGroupSummary(WorkSummary):
    group_ref: str
    name: str


class WorkItemResponse(BaseModel):
    id: str
    group_ref: str
    version: int
    plan: WorkPlan
    day: WorkDayValues
    total_quantity: float
    remaining_quantity: float
    percent: float | None
    overdue: bool


class WorkTrendPoint(BaseModel):
    date: date
    percent: float | None


class WorkResponse(BaseModel):
    as_of: date
    items: list[WorkItemResponse]
    summary: WorkSummary
    sections: list[WorkGroupSummary]
    directions: list[WorkGroupSummary]
    trend: list[WorkTrendPoint]
    calculation_sections: list[WorkCalculationSection] = Field(default_factory=list)
