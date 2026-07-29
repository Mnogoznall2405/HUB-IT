from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

ExportFormat = Literal["docx", "txt", "md", "pdf", "xlsx"]


@dataclass(slots=True)
class ConvertSource:
    """One input file (PDF or image bytes)."""

    file_name: str
    data: bytes
    mime_type: str = ""


@dataclass(slots=True)
class PageMarkdown:
    page_index: int
    markdown: str
    source: str  # "text" | "vision"
    char_count: int = 0


@dataclass(slots=True)
class SignatureCrop:
    page_index: int
    png_bytes: bytes
    left_text: str = ""
    right_text: str = ""


@dataclass(slots=True)
class ConvertedDocument:
    markdown: str
    pages: list[PageMarkdown] = field(default_factory=list)
    source_names: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    table_count: int = 0
    page_count: int = 0
    used_vision: bool = False
    structure_pages: list[dict[str, Any]] = field(default_factory=list)
    signatures: list[SignatureCrop] = field(default_factory=list)
    verify_fidelity: float = 0.0
