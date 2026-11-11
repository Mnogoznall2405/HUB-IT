from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field, field_validator

from backend.ai_chat.artifact_generator import GeneratedFileError, normalize_generated_file_specs
from backend.ai_chat.tools.base import AiTool, AiToolResult
from backend.ai_chat.tools.context import (
    AI_TOOL_FILES_CONVERT_DOCUMENT,
    AI_TOOL_FILES_CREATE,
    AI_TOOL_FILES_REPORT,
    AiToolExecutionContext,
)
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
    format: Optional[Literal["xlsx", "csv", "docx", "pdf", "txt", "md", "json", "excel"]] = None
    file_name: str = Field(default="generated-file", min_length=1, max_length=180)
    title: Optional[str] = Field(default=None, max_length=255)
    content: Any = None
    rows: Optional[list[Any]] = Field(default=None, max_length=50000)
    columns: Optional[list[Any]] = Field(default=None, max_length=100)
    sheets: Optional[list[dict[str, Any]]] = Field(default=None, max_length=20)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator("format", mode="before")
    @classmethod
    def _normalize_format_field(cls, value):
        if value is None or value == "":
            return None
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
    files: list[GeneratedFileArgs] = Field(..., min_length=1, max_length=5)

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
    format: Optional[Literal["xlsx", "csv", "docx", "pdf", "txt", "md", "json", "excel"]] = None
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
        if value is None or value == "":
            return None
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
        "Omit format when the user did not choose one; HUB will show a format-choice card before creating the file. "
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
        source_files = [item.model_dump(mode="json") for item in args.files]
        explicit_files = [item for item in source_files if _normalize_text(item.get("format"))]
        format_choice_payloads: list[dict[str, Any]] = []
        try:
            specs = normalize_generated_file_specs(explicit_files)
            for index, item in enumerate(source_files, start=1):
                if _normalize_text(item.get("format")):
                    continue
                # Validate and normalize the cached source with the same 10 MiB/file
                # and structural limits used by the final attachment generator.
                probe = normalize_generated_file_specs([{**item, "format": "txt"}])[0]
                probe.pop("format", None)
                probe.pop("size_bytes", None)
                format_choice_payloads.append(
                    {
                        "title": _normalize_text(item.get("title")) or f"Generated file {index}",
                        "summary": "Choose the output format before HUB creates this file.",
                        "file_name_base": _normalize_text(item.get("file_name")) or f"generated-file-{index}",
                        "source_file_spec": probe,
                    }
                )
        except GeneratedFileError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc), data={"diagnostic": exc.to_payload()})
        return AiToolResult(
            tool_id=self.tool_id,
            ok=True,
            data={
                "files": specs,
                "count": len(specs),
                "needs_format_choice": bool(format_choice_payloads),
                "format_choice_payloads": format_choice_payloads,
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
        "Omit format when the user did not choose one; HUB will show a format-choice card. "
        "Prefer this over ai.files.create for reports, inventory summaries and user-facing documents. "
        "Table rows must be row arrays or row objects, never a flat list of cells. Optional tables[].columns fixes order/labels. "
        "For inventory reports, pass the same table columns and order shown in markdown; include Serial number for equipment."
    )
    input_model = FilesReportArgs
    stage = "generating_files"

    def execute(self, *, context: AiToolExecutionContext, args: FilesReportArgs) -> AiToolResult:
        if not bool(context.allow_generated_artifacts):
            return AiToolResult(tool_id=self.tool_id, ok=False, error="Generated files are disabled for this bot.")
        if not _normalize_text(args.format):
            tables = [item.model_dump(mode="json") for item in _report_tables(args)]
            tables.extend(
                {
                    "title": _normalize_text(item.get("title")) or f"Sheet {index}",
                    "columns": list(item.get("columns") or []),
                    "rows": list(item.get("rows") or []),
                }
                for index, item in enumerate(list(args.sheets or []), start=1)
                if isinstance(item, dict) and list(item.get("rows") or [])
            )
            return AiToolResult(
                tool_id=self.tool_id,
                ok=True,
                data={
                    "files": [],
                    "count": 0,
                    "generated_files": [],
                    "needs_format_choice": True,
                    "format_choice_payloads": [
                        {
                            "title": args.title,
                            "summary": args.summary or "Choose the report format before HUB creates the file.",
                            "sections": [item.model_dump(mode="json") for item in args.sections],
                            "tables": tables,
                            "file_name_base": args.file_name,
                        }
                    ],
                },
            )
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


class FilesConvertDocumentArgs(BaseModel):
    format: Optional[Literal["docx", "txt", "md", "pdf", "xlsx", "word", "excel", "text", "markdown"]] = None
    attachment_id: Optional[str] = Field(default=None, max_length=64)
    file_name: Optional[str] = Field(default=None, max_length=180)

    @field_validator("format", mode="before")
    @classmethod
    def _normalize_format_field(cls, value):
        if value is None or value == "":
            return None
        return _normalize_format(value)

    @field_validator("attachment_id", "file_name", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value):
        text = _normalize_text(value)
        return text or None


class FilesConvertDocumentTool(AiTool):
    tool_id = AI_TOOL_FILES_CONVERT_DOCUMENT
    description = (
        "Convert attached scanned photos or PDF documents into Word/Text/Markdown/PDF/Excel "
        "while preserving structure via vision LLM. "
        "If format is omitted, recognition runs and the user should pick a format with buttons. "
        "Prefer this tool whenever the user asks to convert/digitize a scan or PDF attachment."
    )
    input_model = FilesConvertDocumentArgs
    stage = "converting_document"

    def execute(self, *, context: AiToolExecutionContext, args: FilesConvertDocumentArgs) -> AiToolResult:
        if not bool(context.allow_generated_artifacts):
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Generated files are disabled for this bot.",
            )
        import base64

        from backend.ai_chat.doc_convert_runtime import (
            convert_attachments_to_markdown,
            export_converted_markdown,
        )
        from shared.doc_convert import DocConvertError

        trigger_message_id = _normalize_text(getattr(context, "trigger_message_id", None))
        if not trigger_message_id:
            return AiToolResult(
                tool_id=self.tool_id,
                ok=False,
                error="Trigger message is missing for document conversion.",
            )
        try:
            converted = convert_attachments_to_markdown(
                conversation_id=context.conversation_id,
                message_id=trigger_message_id,
                attachment_id=args.attachment_id,
            )
        except DocConvertError as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc))
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=f"Document conversion failed: {exc}")

        base_data = {
            "needs_format_choice": True,
            "markdown": converted.get("markdown"),
            "source_names": converted.get("source_names") or [],
            "warnings": list(converted.get("warnings") or []),
            "table_count": converted.get("table_count") or 0,
            "page_count": converted.get("page_count") or 0,
            "used_vision": bool(converted.get("used_vision")),
            "formats": converted.get("formats") or ["docx", "txt", "md", "pdf", "xlsx"],
            "title": converted.get("title") or "document",
            "structure_pages": converted.get("structure_pages") or [],
            "signatures": converted.get("signatures") or [],
            "high_fidelity": True,
            "verify_fidelity": float(converted.get("verify_fidelity") or 0.0),
            "files": [],
            "count": 0,
        }
        file_format = _normalize_format(args.format) if args.format else ""
        if file_format not in {"docx", "txt", "md", "pdf", "xlsx"}:
            return AiToolResult(tool_id=self.tool_id, ok=True, data=base_data)

        try:
            exported = export_converted_markdown(
                markdown=str(converted.get("markdown") or ""),
                export_format=file_format,
                source_name=args.file_name or (converted.get("title") or "document"),
                title=str(converted.get("title") or ""),
                structure_pages=list(converted.get("structure_pages") or []),
                signatures=list(converted.get("signatures") or []),
            )
        except Exception as exc:
            return AiToolResult(tool_id=self.tool_id, ok=False, error=str(exc), data=base_data)

        content = bytes(exported.get("content") or b"")
        content_b64 = base64.b64encode(content).decode("ascii")
        file_spec = {
            "format": file_format,
            "file_name": exported.get("file_name") or f"document.{file_format}",
            "title": converted.get("title") or "Документ",
            "content": content.decode("utf-8") if file_format in {"txt", "md"} else "",
            "metadata": {"doc_convert": True, "content_b64": content_b64},
        }
        base_data.update(
            {
                "needs_format_choice": False,
                "warnings": list(base_data["warnings"]) + list(exported.get("warnings") or []),
                "export": {
                    "format": exported.get("format"),
                    "file_name": exported.get("file_name"),
                    "mime_type": exported.get("mime_type"),
                    "content_b64": content_b64,
                },
                "files": [file_spec],
                "count": 1,
                "generated_files": [
                    {
                        "file_name": exported.get("file_name"),
                        "format": file_format,
                        "size_bytes": len(content),
                    }
                ],
            }
        )
        return AiToolResult(tool_id=self.tool_id, ok=True, data=base_data)


ai_tool_registry.register(FilesCreateTool())
ai_tool_registry.register(FilesReportTool())
ai_tool_registry.register(FilesConvertDocumentTool())
