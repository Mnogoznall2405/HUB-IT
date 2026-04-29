from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.artifact_generator import GeneratedFileError, normalize_generated_file_specs
from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import AI_TOOL_FILES_CREATE, AI_TOOL_FILES_REPORT, AiToolExecutionContext
from backend.ai_chat.tools.registry import ai_tool_registry


def _normalize_text(value: object) -> str:
    return str(value or "").strip()


def _normalize_format(value: object) -> str:
    text = _normalize_text(value).lower().lstrip(".")
    aliases = {
        "excel": "xlsx",
        "xls": "xlsx",
        "spreadsheet": "xlsx",
        "word": "docx",
        "document": "docx",
        "markdown": "md",
        "text": "txt",
    }
    return aliases.get(text, text)


def _normalize_dict(value: object) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _normalize_list(value: object) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, dict):
        return [value]
    return []


class GeneratedFileArgs(BaseModel):
    format: Literal["xlsx", "csv", "docx", "pdf", "txt", "md", "json", "excel"] = "xlsx"
    file_name: str = Field(default="generated-file", min_length=1, max_length=180)
    title: Optional[str] = Field(default=None, max_length=255)
    content: Any = None
    rows: Optional[list[Any]] = None
    columns: Optional[list[Any]] = None
    sheets: Optional[list[dict[str, Any]]] = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("format", mode="before")
    @classmethod
    def _normalize_format_field(cls, value):
        return _normalize_format(value)

    @field_validator("file_name", mode="before")
    @classmethod
    def _normalize_file_name(cls, value):
        return _normalize_text(value) or "generated-file"

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_optional_title(cls, value):
        text = _normalize_text(value)
        return text or None

    @field_validator("rows", "columns", "sheets", mode="before")
    @classmethod
    def _normalize_list_fields(cls, value):
        if value is None:
            return None
        return _normalize_list(value)

    @field_validator("metadata", mode="before")
    @classmethod
    def _normalize_metadata(cls, value):
        return _normalize_dict(value)


class FilesCreateArgs(BaseModel):
    files: list[GeneratedFileArgs] = Field(..., min_length=1, max_length=10)

    @field_validator("files", mode="before")
    @classmethod
    def _normalize_files(cls, value):
        return _normalize_list(value)


class ReportSectionArgs(BaseModel):
    heading: str = Field(default="Section", min_length=1, max_length=255)
    body: str = Field(default="", max_length=12000)

    @field_validator("heading", mode="before")
    @classmethod
    def _normalize_heading(cls, value):
        return _normalize_text(value) or "Section"

    @field_validator("body", mode="before")
    @classmethod
    def _normalize_body(cls, value):
        return _normalize_text(value)


class ReportTableArgs(BaseModel):
    title: str = Field(default="Data", min_length=1, max_length=255)
    columns: list[Any] = Field(default_factory=list, max_length=100)
    rows: list[Any] = Field(default_factory=list, max_length=50000)

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value):
        return _normalize_text(value) or "Data"

    @field_validator("columns", "rows", mode="before")
    @classmethod
    def _normalize_list_fields(cls, value):
        return _normalize_list(value)


class FilesReportArgs(BaseModel):
    format: Literal["xlsx", "csv", "docx", "pdf", "txt", "md", "json", "excel"] = "xlsx"
    file_name: str = Field(default="report", min_length=1, max_length=180)
    title: str = Field(default="Report", min_length=1, max_length=255)
    summary: str = Field(default="", max_length=12000)
    sections: list[ReportSectionArgs] = Field(default_factory=list, max_length=20)
    tables: list[ReportTableArgs] = Field(default_factory=list, max_length=20)
    sheets: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    rows: list[Any] = Field(default_factory=list, max_length=50000)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("format", mode="before")
    @classmethod
    def _normalize_format_field(cls, value):
        return _normalize_format(value)

    @field_validator("file_name", mode="before")
    @classmethod
    def _normalize_file_name(cls, value):
        return _normalize_text(value) or "report"

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value):
        return _normalize_text(value) or "Report"

    @field_validator("summary", mode="before")
    @classmethod
    def _normalize_summary(cls, value):
        return _normalize_text(value)

    @field_validator("sections", "tables", "sheets", "rows", mode="before")
    @classmethod
    def _normalize_list_fields(cls, value):
        return _normalize_list(value)

    @field_validator("metadata", mode="before")
    @classmethod
    def _normalize_metadata(cls, value):
        return _normalize_dict(value)


class FilesCreateTool(AiTool):
    tool_id = AI_TOOL_FILES_CREATE
    description = (
        "Create generated chat attachments requested by the user. Supports xlsx, csv, docx, pdf, txt, md and json. "
        "Use after gathering any required live ITinvent data or attachment context. "
        "Rows must be an array of row arrays or row objects, never a flat list of cells. "
        "Optional columns fixes order/labels for row objects. "
        "For inventory tables, keep the same columns and order shown to the user; include Serial number for equipment."
    )
    input_model = FilesCreateArgs
    stage = "generating_files"

    def execute(self, *, context: AiToolExecutionContext, args: FilesCreateArgs) -> AiToolResult:
        if not bool(context.allow_generated_artifacts):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Generated files are disabled for this bot.",
            )
        try:
            specs = normalize_generated_file_specs([item.model_dump(mode="json") for item in args.files])
        except GeneratedFileError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc), data={"diagnostic": exc.to_payload()})
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "files": specs,
                "count": len(specs),
                "generated_files": [
                    {
                        "file_name": item.get("file_name"),
                        "format": item.get("format"),
                        "size_bytes": item.get("size_bytes"),
                    }
                    for item in specs
                ],
            },
        )


def _rows_from_report_table(table: ReportTableArgs) -> list[list[str]]:
    normalized = normalize_generated_file_specs([
        {
            "format": "csv",
            "file_name": "table.csv",
            "rows": table.rows,
            "columns": table.columns,
        }
    ])
    rows = list(normalized[0].get("rows") or [])
    return rows


def _report_tables(args: FilesReportArgs) -> list[ReportTableArgs]:
    tables = list(args.tables or [])
    if tables or not args.rows:
        return tables
    return [ReportTableArgs(title="Data", rows=args.rows)]


def _report_markdown(args: FilesReportArgs) -> str:
    lines = [f"# {args.title}"]
    if args.summary:
        lines.extend(["", args.summary])
    for section in args.sections:
        lines.extend(["", f"## {section.heading}"])
        if section.body:
            lines.extend(["", section.body])
    for table in _report_tables(args):
        rows = _rows_from_report_table(table)
        lines.extend(["", f"## {table.title}"])
        if not rows:
            lines.append("Нет строк")
            continue
        header = rows[0]
        lines.append("| " + " | ".join(header) + " |")
        lines.append("| " + " | ".join(["---"] * len(header)) + " |")
        for row in rows[1:]:
            padded = list(row) + [""] * max(0, len(header) - len(row))
            lines.append("| " + " | ".join(padded[: len(header)]) + " |")
    return "\n".join(lines).strip()


def _report_plain_text(args: FilesReportArgs) -> str:
    lines: list[str] = []
    if args.summary:
        lines.append(args.summary)
    for section in args.sections:
        lines.extend(["", section.heading])
        if section.body:
            lines.append(section.body)
    for table in _report_tables(args):
        lines.extend(["", table.title])
        rows = _rows_from_report_table(table)
        if not rows:
            lines.append("Нет строк")
            continue
        for row in rows:
            lines.append(" | ".join(row))
    return "\n".join(lines).strip()


def _report_metadata(args: FilesReportArgs, report_tables: list[ReportTableArgs]) -> dict[str, Any]:
    return {
        **dict(args.metadata or {}),
        "report": True,
        "report_title": args.title,
        "report_summary": args.summary,
        "report_sections": [item.model_dump(mode="json") for item in args.sections],
        "report_tables": [
            {
                "title": table.title,
                "columns": table.columns,
                "rows": _rows_from_report_table(table),
            }
            for table in report_tables
        ],
    }


def _report_file_spec(args: FilesReportArgs) -> dict[str, Any]:
    file_format = "xlsx" if args.format == "excel" else args.format
    content = _report_markdown(args) if file_format == "md" else _report_plain_text(args)
    report_tables = _report_tables(args)
    if file_format == "xlsx":
        sheets: list[dict[str, Any]] = []
        overview_rows = [["Отчёт", args.title]]
        if args.summary:
            overview_rows.append(["Итог", args.summary])
        for section in args.sections:
            overview_rows.append([section.heading, section.body])
        sheets.append({"title": "Сводка", "rows": overview_rows, "header_row_index": 1})
        for table in report_tables:
            rows = _rows_from_report_table(table)
            if rows:
                sheets.append({"title": table.title, "rows": rows, "header_row_index": 1})
        return {
            "format": file_format,
            "file_name": args.file_name,
            "title": args.title,
            "sheets": sheets,
            "metadata": {"report": True, **dict(args.metadata or {})},
        }
    if file_format == "json":
        return {
            "format": file_format,
            "file_name": args.file_name,
            "title": args.title,
            "content": {
                "title": args.title,
                "summary": args.summary,
                "sections": [item.model_dump(mode="json") for item in args.sections],
                "tables": [item.model_dump(mode="json") for item in report_tables],
                "metadata": args.metadata,
            },
        }
    return {
        "format": file_format,
        "file_name": args.file_name,
        "title": args.title,
        "content": content,
        "metadata": {"report": True, **dict(args.metadata or {})},
    }


def _report_file_spec_v2(args: FilesReportArgs) -> dict[str, Any]:
    file_format = "xlsx" if args.format == "excel" else args.format
    content = _report_markdown(args) if file_format == "md" else _report_plain_text(args)
    report_tables = _report_tables(args)
    metadata = _report_metadata(args, report_tables)
    if file_format == "xlsx":
        sheets: list[dict[str, Any]] = []
        if args.summary or args.sections:
            overview_rows = [["\u041e\u0442\u0447\u0451\u0442", args.title]]
            if args.summary:
                overview_rows.append(["\u0418\u0442\u043e\u0433", args.summary])
            for section in args.sections:
                overview_rows.append([section.heading, section.body])
            sheets.append({"title": "\u0421\u0432\u043e\u0434\u043a\u0430", "rows": overview_rows, "header_row_index": 1})
        sheets.extend(list(args.sheets or []))
        for table in report_tables:
            rows = _rows_from_report_table(table)
            if rows:
                sheets.append({"title": table.title, "rows": rows, "header_row_index": 1})
        return {
            "format": file_format,
            "file_name": args.file_name,
            "title": args.title,
            "sheets": sheets,
            "metadata": metadata,
        }
    if file_format == "csv":
        first_rows = _rows_from_report_table(report_tables[0]) if report_tables else []
        return {
            "format": file_format,
            "file_name": args.file_name,
            "title": args.title,
            "rows": first_rows,
            "content": content,
            "metadata": metadata,
        }
    if file_format == "json":
        return {
            "format": file_format,
            "file_name": args.file_name,
            "title": args.title,
            "content": {
                "title": args.title,
                "summary": args.summary,
                "sections": [item.model_dump(mode="json") for item in args.sections],
                "tables": [item.model_dump(mode="json") for item in report_tables],
                "metadata": args.metadata,
            },
        }
    return {
        "format": file_format,
        "file_name": args.file_name,
        "title": args.title,
        "content": content,
        "metadata": metadata,
    }


class FilesReportTool(AiTool):
    tool_id = AI_TOOL_FILES_REPORT
    description = (
        "Create a polished report file from structured title, summary, sections, sheets and tables. Supports xlsx, csv, docx, pdf, txt, md and json. "
        "Prefer this over ai.files.create for reports, inventory summaries and user-facing documents. "
        "Table rows must be row arrays or row objects, never a flat list of cells. Optional tables[].columns fixes order/labels. "
        "For inventory reports, pass the same table columns and order shown in markdown; include Serial number for equipment."
    )
    input_model = FilesReportArgs
    stage = "generating_files"

    def execute(self, *, context: AiToolExecutionContext, args: FilesReportArgs) -> AiToolResult:
        if not bool(context.allow_generated_artifacts):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Generated files are disabled for this bot.")
        try:
            specs = normalize_generated_file_specs([_report_file_spec_v2(args)])
        except GeneratedFileError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc), data={"diagnostic": exc.to_payload()})
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "files": specs,
                "count": len(specs),
                "generated_files": [
                    {
                        "file_name": item.get("file_name"),
                        "format": item.get("format"),
                        "size_bytes": item.get("size_bytes"),
                    }
                    for item in specs
                ],
            },
        )


ai_tool_registry.register(FilesCreateTool())
ai_tool_registry.register(FilesReportTool())
