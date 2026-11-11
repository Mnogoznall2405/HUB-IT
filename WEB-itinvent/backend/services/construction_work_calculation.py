"""Reviewed spreadsheet rollups evaluated against live journal quantities.

The imported profile contains arithmetic coefficients, never executable formulas.
Other sheets and directions cannot enter the explicitly selected source scope.
"""
from datetime import date
from decimal import Decimal
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


def calculation_key(object_id):
    return f"construction.work_calculation.{object_id}"


class ProfileModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Term(ProfileModel):
    work_id: UUID
    field: Literal["planned_quantity", "total_quantity"]
    coefficient: Decimal = Field(allow_inf_nan=False)


class Expression(ProfileModel):
    constant: Decimal = Field(default=0, allow_inf_nan=False)
    terms: list[Term] = Field(max_length=10000)


class RollupSection(ProfileModel):
    name: str = Field(min_length=1, max_length=500)
    numerator: Expression
    denominator: Expression


class CalculationProfile(ProfileModel):
    version: Literal[1] = 1
    method: Literal["source_section_mean"] = "source_section_mean"
    source_sheet: str = Field(min_length=1, max_length=200)
    source_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    group_ref: str = Field(min_length=1, max_length=64)
    baseline_date: date
    work_ids: list[UUID] = Field(min_length=1, max_length=5000)
    sections: list[RollupSection] = Field(min_length=1, max_length=300)
    notes: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_scope(self):
        expected = set(self.work_ids)
        if len(expected) != len(self.work_ids):
            raise ValueError("Duplicate source work IDs")
        if any(term.work_id not in expected for section in self.sections
               for expression in (section.numerator, section.denominator) for term in expression.terms):
            raise ValueError("Calculation references work outside its source scope")
        return self


def calculate(profile, items, as_of):
    expected = {str(value) for value in profile.work_ids}
    available = {item["id"]: item for item in items if item["id"] in expected
                 and item["group_ref"] == profile.group_ref and not item["plan"]["archived"]}
    info = {
        "method": profile.method, "source_sheet": profile.source_sheet,
        "section_count": len(profile.sections), "included_works": len(available),
        "excluded_works": len(items) - len(available), "missing_works": len(expected - available.keys()),
        "baseline_date": profile.baseline_date.isoformat(), "notes": profile.notes,
    }
    complete = not info["missing_works"] and as_of >= profile.baseline_date

    def evaluate(expression):
        value = expression.constant
        for term in expression.terms:
            item = available.get(str(term.work_id))
            if item is None:
                return None
            quantity = item["plan"]["planned_quantity"] if term.field == "planned_quantity" else item["total_quantity"]
            value += term.coefficient * Decimal(str(quantity))
        return value

    sections = []
    for section in profile.sections:
        numerator, denominator = (evaluate(section.numerator), evaluate(section.denominator)) if complete else (None, None)
        percent = float(numerator / denominator * 100) if numerator is not None and denominator is not None and denominator > 0 else None
        sections.append({"name": section.name, "percent": percent})
    percent = sum(section["percent"] for section in sections) / len(sections) if all(section["percent"] is not None for section in sections) else None
    return {"percent": percent, "calculation": info, "calculation_sections": sections}
