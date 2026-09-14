from datetime import date
from uuid import UUID
from pydantic import Field, model_validator
from backend.models.construction_work import WorkModel, WorkDate, Quantity, WorkDayChange


class WeeklyTarget(WorkModel):
    work_id: UUID
    quantity: Quantity


class CrewAssignment(WorkModel):
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    group_ref: UUID
    work_ids: list[UUID] = Field(min_length=1, max_length=5000)
    required: int = Field(ge=0, le=10000)
    assigned: int = Field(ge=0, le=10000)


class CrewPool(WorkModel):
    id: UUID
    name: str = Field(min_length=1, max_length=200)
    specialty: str = Field(min_length=1, max_length=100)
    available: int = Field(ge=0, le=10000)
    assignments: list[CrewAssignment] = Field(default_factory=list, max_length=300)


class WeeklyPlan(WorkModel):
    targets: list[WeeklyTarget] = Field(default_factory=list, max_length=5000)
    crews: list[CrewPool] = Field(default_factory=list, max_length=100)
    comment: str = Field(default='', max_length=2000)

    @model_validator(mode='after')
    def validate_unique(self):
        if len({x.work_id for x in self.targets}) != len(self.targets): raise ValueError('Работа повторяется в недельном плане')
        if len({x.id for x in self.crews}) != len(self.crews): raise ValueError('Бригада повторяется')
        assignments = [a for crew in self.crews for a in crew.assignments]
        if len({a.id for a in assignments}) != len(assignments): raise ValueError('Назначение повторяется')
        for crew in self.crews:
            if sum(a.assigned for a in crew.assignments) > crew.available: raise ValueError(f'Не хватает людей: {crew.name}')
            for assignment in crew.assignments:
                if len(set(assignment.work_ids)) != len(assignment.work_ids): raise ValueError('Работа в назначении повторяется')
        return self


class WeeklyPlanChange(WorkModel):
    week_start: WorkDate
    expected_version: int = Field(ge=0)
    plan: WeeklyPlan

    @model_validator(mode='after')
    def validate_week(self):
        if self.week_start.weekday() != 0: raise ValueError('Начало недели должно приходиться на понедельник')
        return self


class CrewAttendance(WorkModel):
    assignment_id: UUID
    actual: int = Field(ge=0, le=10000)
    comment: str = Field(default='', max_length=2000)


class DailySummary(WorkModel):
    work_date: WorkDate
    expected_crew_version: int = Field(ge=0)
    expected_week_version: int = Field(ge=0)
    items: list[WorkDayChange] = Field(default_factory=list, max_length=300)
    crews: list[CrewAttendance] = Field(default_factory=list, max_length=300)

    @model_validator(mode='after')
    def validate_day(self):
        if self.work_date > date.today(): raise ValueError('Нельзя заполнять сводку за будущую дату')
        if not self.items and not self.crews: raise ValueError('Сводка пуста')
        if len({x.assignment_id for x in self.crews}) != len(self.crews): raise ValueError('Назначение повторяется в сводке')
        return self
