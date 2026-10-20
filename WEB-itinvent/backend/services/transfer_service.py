"""
Transfer service: act generation, in-memory act registry and email sending.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import subprocess
import tempfile
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional
from uuid import NAMESPACE_URL, uuid4, uuid5

from dotenv import dotenv_values

from backend.services.task_email_service import task_email_service
from backend.services.mail_attachment_preview_service import resolve_soffice_path, _run_soffice_convert

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_TEMPLATE_PATH = PROJECT_ROOT / "templates" / "docx_transfer_act.docx"
DEFAULT_ACTS_DIR = PROJECT_ROOT / os.getenv("TRANSFER_ACTS_DIR", "transfer_acts")
BOT_ENV_PATH = PROJECT_ROOT / ".env"
BOT_ENV_VALUES = dotenv_values(str(BOT_ENV_PATH)) if BOT_ENV_PATH.exists() else {}

_ACT_STORE: dict[str, dict[str, Any]] = {}
_PDF_CONVERT_LOCK = threading.Lock()


class TransferActGenerationError(RuntimeError):
    """The document is unavailable; this does not undo an inventory move."""


def _is_valid_pdf(path: Path) -> bool:
    try:
        from pypdf import PdfReader

        with path.open("rb") as stream:
            if stream.read(5) != b"%PDF-":
                return False
            stream.seek(0)
            return len(PdfReader(stream, strict=True).pages) > 0
    except Exception:
        return False


def _read_env(name: str, default: Optional[str] = None) -> Optional[str]:
    value = os.getenv(name)
    if value is not None and str(value).strip() != "":
        return str(value).strip()
    fallback = BOT_ENV_VALUES.get(name)
    if fallback is not None and str(fallback).strip() != "":
        return str(fallback).strip()
    return default


def _to_bool(value: Optional[str], default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _send_outgoing_files(
    *,
    recipient_email: str,
    files: dict[str, str],
    subject: str,
    body: str,
) -> bool:
    attachments: list[tuple[str, bytes]] = []
    for _, path in files.items():
        if not path or not os.path.exists(path):
            continue
        filename = os.path.basename(path) or "attachment.bin"
        with open(path, "rb") as stream:
            attachments.append((filename, stream.read()))
    if not attachments:
        return False
    return task_email_service.send_outgoing_email(
        recipient_email=recipient_email,
        subject=subject,
        body_text=body or "",
        attachments=attachments,
    )


def _safe_filename(name: str) -> str:
    value = (name or "Unknown").strip()
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^\w.-]", "", value)
    value = value.strip("._")
    return value[:48] or "Unknown"


def _operation_act_id(
    *,
    operation_id: Optional[str],
    mode: str,
    db_id: Optional[str],
    old_employee: str,
    new_employee: str,
    items: list[dict[str, Any]],
) -> str:
    """Return a stable act identity for a durable transfer operation.

    A transfer worker may be restarted after the item/history transaction but
    before its job is marked done.  The operation key is therefore also the
    identity of every generated document group: retries reuse its file and
    ``act_id`` instead of creating a second act for the same move.
    """
    normalized_operation = str(operation_id or "").strip()
    if not normalized_operation:
        return str(uuid4())
    inv_nos = sorted(
        {
            _to_inv_text(item.get("inv_no") or item.get("INV_NO"))
            for item in items or []
            if _to_inv_text(item.get("inv_no") or item.get("INV_NO"))
        }
    )
    signature = "|".join(
        [
            "hub-transfer-act-v1",
            normalized_operation,
            str(mode or "transfer").strip().casefold(),
            str(db_id or "").strip().casefold(),
            str(old_employee or "").strip().casefold(),
            str(new_employee or "").strip().casefold(),
            *inv_nos,
        ]
    )
    return str(uuid5(NAMESPACE_URL, signature))


def _to_inv_text(value: Any) -> str:
    if value is None:
        return ""
    try:
        return str(int(round(float(value))))
    except (TypeError, ValueError):
        return str(value)


def _iter_table_paragraphs(table: Any):
    for row in table.rows:
        for cell in row.cells:
            yield from cell.paragraphs
            for nested_table in cell.tables:
                yield from _iter_table_paragraphs(nested_table)


def _replace_document_placeholders(document: Any, replacements: dict[str, str]) -> None:
    paragraphs = list(document.paragraphs)
    for table in document.tables:
        paragraphs.extend(_iter_table_paragraphs(table))
    for section in document.sections:
        for story in (section.header, section.footer):
            if story.is_linked_to_previous:
                continue
            paragraphs.extend(story.paragraphs)
            for table in story.tables:
                paragraphs.extend(_iter_table_paragraphs(table))

    for paragraph in paragraphs:
        updated_text = paragraph.text
        for placeholder, value in replacements.items():
            updated_text = updated_text.replace(placeholder, value)
        if updated_text == paragraph.text:
            continue
        if not paragraph.runs:
            paragraph.add_run(updated_text)
            continue
        paragraph.runs[0].text = updated_text
        for run in paragraph.runs[1:]:
            run.text = ""


def _build_docx_act(
    old_employee: str,
    new_employee: str,
    new_employee_dept: str,
    items: list[dict[str, Any]],
    *,
    deterministic_act_id: Optional[str] = None,
) -> tuple[Path, str]:
    try:
        from docx import Document
    except ImportError as exc:
        raise RuntimeError("python-docx not installed") from exc

    template_path = DEFAULT_TEMPLATE_PATH
    if not template_path.exists():
        raise RuntimeError(f"Act template not found: {template_path}")

    DEFAULT_ACTS_DIR.mkdir(parents=True, exist_ok=True)

    safe_old = _safe_filename(old_employee)
    normalized_act_id = str(deterministic_act_id or "").strip()
    if normalized_act_id:
        # The same durable operation must always address the same output
        # file.  Prefer a completed PDF, then an already persisted DOCX.
        # This makes a recovery safe even if it happens after file generation
        # but before the job result was persisted.
        docx_name = f"transfer_act_{_safe_filename(normalized_act_id)}_{safe_old}.docx"
        docx_path = DEFAULT_ACTS_DIR / docx_name
        pdf_path = docx_path.with_suffix(".pdf")
        if _is_valid_pdf(pdf_path):
            return pdf_path, "pdf"
        if docx_path.is_file():
            return docx_path, "docx"
    else:
        now_for_name = datetime.now()
        docx_name = f"transfer_act_{now_for_name.strftime('%Y%m%d_%H%M%S')}_{safe_old}.docx"
        docx_path = DEFAULT_ACTS_DIR / docx_name

    doc = Document(str(template_path))
    now = datetime.now()
    date_text = now.strftime("%d.%m.%Y")

    _replace_document_placeholders(
        doc,
        {
            "{{DATE}}": date_text,
            "{{TO_EMPLOYEE}}": str(new_employee),
            "{{FROM_EMPLOYEE}}": str(old_employee),
        },
    )

    if doc.tables:
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn

        table = doc.tables[0]
        if len(table.rows) > 1:
            template_row = table.rows[1]
            table._element.remove(template_row._element)

        for idx, item in enumerate(items, 1):
            row = table.add_row()
            tr_pr = row._tr.get_or_add_trPr()
            if tr_pr.find(qn("w:cantSplit")) is None:
                tr_pr.append(OxmlElement("w:cantSplit"))
            cells_data = [
                str(idx),
                str(item.get("type_name") or ""),
                str(item.get("model_name") or ""),
                str(item.get("serial_no") or ""),
                str(item.get("part_no") or ""),
                _to_inv_text(item.get("inv_no")),
            ]
            for cell_idx, cell_text in enumerate(cells_data):
                cell = row.cells[cell_idx]
                cell.text = cell_text
                for paragraph in cell.paragraphs:
                    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                tc = cell._element
                tc_pr = tc.get_or_add_tcPr()
                valign = OxmlElement("w:vAlign")
                valign.set(qn("w:val"), "center")
                tc_pr.append(valign)

    if normalized_act_id:
        # A process crash must not leave a final-looking half-written file for
        # the retry to reuse.  The final name appears only after an atomic
        # replace in the same directory.
        tmp_path = docx_path.with_name(f".{docx_path.stem}.{uuid4().hex}.tmp.docx")
        try:
            doc.save(str(tmp_path))
            os.replace(tmp_path, docx_path)
        finally:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass
    else:
        doc.save(str(docx_path))
    return docx_path, "docx"


def _try_convert_to_pdf(docx_path: Path) -> tuple[Path, str]:
    """Publish a validated PDF atomically, keeping DOCX available for recovery."""
    pdf_path = docx_path.with_suffix(".pdf")
    started = time.monotonic()
    try:
        timeout_sec = max(5, int(_read_env("TRANSFER_ACT_PDF_TIMEOUT_SEC", "45") or "45"))
        with _PDF_CONVERT_LOCK:
            if _is_valid_pdf(pdf_path):
                return pdf_path, "pdf"
            # The existing converter uses a private LibreOffice profile. A
            # temporary output cannot be mistaken for a completed act on retry.
            with tempfile.TemporaryDirectory(
                prefix=".act-pdf-", dir=docx_path.parent, ignore_cleanup_errors=True,
            ) as temp_dir:
                generated = _run_soffice_convert(
                    soffice=resolve_soffice_path(),
                    source_path=docx_path.resolve(),
                    output_dir=Path(temp_dir),
                    timeout_sec=timeout_sec,
                )
                if not _is_valid_pdf(generated):
                    raise TransferActGenerationError("Конвертер не создал корректный PDF акта.")
                os.replace(generated, pdf_path)
        logger.info("Transfer act PDF completed elapsed=%.2fs", time.monotonic() - started)
    except subprocess.TimeoutExpired:
        logger.warning("Transfer act PDF timeout after %ss", timeout_sec)
        raise TransferActGenerationError("Не удалось создать PDF акта: превышено время ожидания.") from None
    except Exception as exc:
        logger.exception("Transfer act PDF failed elapsed=%.2fs", time.monotonic() - started)
        raise TransferActGenerationError("Не удалось создать PDF акта.") from exc
    return pdf_path, "pdf"


def prepare_act_download(record: dict[str, Any]) -> dict[str, Any]:
    """Recover legacy DOCX downloads without executing another transfer."""
    source = Path(str(record.get("file_path") or ""))
    if source.suffix.lower() == ".pdf" and _is_valid_pdf(source):
        return record
    if source.suffix.lower() == ".pdf":
        source = source.with_suffix(".docx")
    pdf_path, file_type = _try_convert_to_pdf(source)
    prepared = {**record, "file_path": str(pdf_path), "file_name": pdf_path.name, "file_type": file_type}
    register_act_records([prepared])
    return prepared


def get_act_record(act_id: str) -> Optional[dict[str, Any]]:
    """Get act record by ID."""
    return _ACT_STORE.get(str(act_id or "").strip())


def register_act_records(records: list[dict[str, Any]]) -> None:
    """Restore generated act records into the process-local download/email registry."""
    for record in records or []:
        act_id = str(record.get("act_id") or "").strip()
        if act_id:
            _ACT_STORE[act_id] = dict(record)


def get_act_records(act_ids: list[str]) -> list[dict[str, Any]]:
    """Get process-local generated act records for persistence."""
    records: list[dict[str, Any]] = []
    for act_id in act_ids or []:
        record = get_act_record(str(act_id or "").strip())
        if record:
            records.append(dict(record))
    return records


def generate_transfer_acts(
    transferred_items: list[dict[str, Any]],
    new_employee_name: str,
    new_employee_dept: str,
    new_employee_email: Optional[str],
    db_id: Optional[str],
    operation_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Generate transfer acts grouped by old employee.

    Returns list with API-ready act metadata.
    """
    grouped: dict[str, list[dict[str, Any]]] = {}
    for item in transferred_items:
        old_employee = (item.get("old_employee_name") or "Без владельца").strip() or "Без владельца"
        grouped.setdefault(old_employee, []).append(item)

    acts: list[dict[str, Any]] = []

    for old_employee, items in grouped.items():
        act_id = _operation_act_id(
            operation_id=operation_id,
            mode="inventory_transfer",
            db_id=db_id,
            old_employee=old_employee,
            new_employee=new_employee_name,
            items=items,
        )
        old_employee_email = None
        for item in items:
            candidate = (item.get("old_employee_email") or "").strip()
            if candidate:
                old_employee_email = candidate
                break

        try:
            file_path, file_type = _build_docx_act(
                old_employee=old_employee,
                new_employee=new_employee_name,
                new_employee_dept=new_employee_dept or "",
                items=items,
                deterministic_act_id=act_id if operation_id else None,
            )
            if file_type == "docx":
                file_path, file_type = _try_convert_to_pdf(file_path)
        except Exception as exc:
            logger.exception("Failed to generate transfer act")
            raise TransferActGenerationError("Не удалось создать PDF акта.") from exc

        record = {
            "act_id": act_id,
            "file_path": str(file_path),
            "file_name": file_path.name,
            "file_type": file_type,
            "old_employee_name": old_employee,
            "old_employee_email": old_employee_email,
            "new_employee_name": new_employee_name,
            "new_employee_email": (new_employee_email or "").strip() or None,
            "equipment_count": len(items),
            "db_id": db_id,
            "created_at": datetime.now().isoformat(),
            "operation_id": str(operation_id or "").strip() or None,
        }
        _ACT_STORE[act_id] = record
        acts.append(
            {
                "act_id": act_id,
                "old_employee": old_employee,
                "equipment_count": len(items),
                "file_name": file_path.name,
                "file_type": file_type,
            }
        )

    return acts


def generate_transfer_acts_without_move(
    *,
    items: list[dict[str, Any]],
    issuer_name: str,
    issuer_email: Optional[str],
    db_id: Optional[str],
    operation_id: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Generate handover acts for current holders without updating inventory data.

    Items are grouped by their current employee so each recipient gets a
    separate act. The selected issuer is written as FROM_EMPLOYEE.
    """
    safe_issuer = str(issuer_name or "").strip() or "Без владельца"
    grouped: dict[str, dict[str, Any]] = {}

    for item in items or []:
        holder = str(
            item.get("employee_name")
            or item.get("OWNER_DISPLAY_NAME")
            or item.get("old_employee_name")
            or "Без владельца"
        ).strip() or "Без владельца"
        holder_dept = str(
            item.get("employee_dept")
            or item.get("OWNER_DEPT")
            or item.get("new_employee_dept")
            or ""
        ).strip()
        holder_email = str(item.get("employee_email") or item.get("OWNER_EMAIL") or "").strip()
        bucket = grouped.setdefault(
            holder,
            {
                "holder": holder,
                "holder_dept": holder_dept,
                "holder_email": holder_email,
                "items": [],
            },
        )
        if holder_dept and not bucket.get("holder_dept"):
            bucket["holder_dept"] = holder_dept
        if holder_email and not bucket.get("holder_email"):
            bucket["holder_email"] = holder_email
        bucket["items"].append(
            {
                "inv_no": item.get("inv_no") or item.get("INV_NO"),
                "serial_no": item.get("serial_no") or item.get("SERIAL_NO"),
                "part_no": item.get("part_no") or item.get("PART_NO"),
                "type_name": item.get("type_name") or item.get("TYPE_NAME"),
                "model_name": item.get("model_name") or item.get("MODEL_NAME"),
            }
        )

    acts: list[dict[str, Any]] = []
    for holder, bucket in grouped.items():
        act_items = list(bucket.get("items") or [])
        if not act_items:
            continue
        act_id = _operation_act_id(
            operation_id=operation_id,
            mode="document_only",
            db_id=db_id,
            old_employee=safe_issuer,
            new_employee=holder,
            items=act_items,
        )

        try:
            file_path, file_type = _build_docx_act(
                old_employee=safe_issuer,
                new_employee=holder,
                new_employee_dept=str(bucket.get("holder_dept") or ""),
                items=act_items,
                deterministic_act_id=act_id if operation_id else None,
            )
            if file_type == "docx":
                file_path, file_type = _try_convert_to_pdf(file_path)
        except Exception as exc:
            logger.exception("Failed to generate act without move")
            raise TransferActGenerationError("Не удалось создать PDF акта.") from exc

        record = {
            "act_id": act_id,
            "file_path": str(file_path),
            "file_name": file_path.name,
            "file_type": file_type,
            "old_employee_name": safe_issuer,
            "old_employee_email": (issuer_email or "").strip() or None,
            "new_employee_name": holder,
            "new_employee_email": str(bucket.get("holder_email") or "").strip() or None,
            "equipment_count": len(act_items),
            "db_id": db_id,
            "created_at": datetime.now().isoformat(),
            "act_mode": "without_move",
            "operation_id": str(operation_id or "").strip() or None,
        }
        _ACT_STORE[act_id] = record
        acts.append(
            {
                "act_id": act_id,
                "old_employee": safe_issuer,
                "new_employee": holder,
                "equipment_count": len(act_items),
                "file_name": file_path.name,
                "file_type": file_type,
            }
        )

    return acts


async def _send_files(
    recipient_email: str,
    records: list[dict[str, Any]],
    subject: str,
    body: str,
) -> bool:
    files: dict[str, str] = {}
    for idx, record in enumerate(records):
        file_path = record.get("file_path")
        if file_path and os.path.exists(file_path):
            files[f"act_{idx+1}"] = file_path
    if not files:
        return False

    sender = _send_outgoing_files
    return await asyncio.to_thread(
        sender,
        recipient_email=recipient_email,
        files=files,
        subject=subject,
        body=body,
    )


async def send_binary_file_email(
    *,
    recipient_email: str,
    file_name: str,
    file_bytes: bytes,
    subject: str,
    body: str,
) -> bool:
    """
    Send one in-memory file as email attachment.
    """
    safe_recipient = str(recipient_email or "").strip()
    if not safe_recipient or not file_bytes:
        return False

    safe_name = str(file_name or "").strip() or "act.pdf"
    safe_name = re.sub(r"[\\/:*?\"<>|]+", "_", safe_name).strip() or "act.pdf"
    temp_path = ""
    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            temp_path = os.path.join(tmp_dir, safe_name)
            with open(temp_path, "wb") as tmp:
                tmp.write(bytes(file_bytes))

            return await asyncio.to_thread(
                _send_outgoing_files,
                recipient_email=safe_recipient,
                files={"uploaded_act": temp_path},
                subject=str(subject or "").strip(),
                body=str(body or "").strip(),
            )
    except Exception:
        return False


async def send_transfer_acts_email(
    act_ids: list[str],
    mode: str,
    manual_email: Optional[str] = None,
    employee_email: Optional[str] = None,
) -> dict[str, Any]:
    """
    Send generated acts by email.

    mode:
      - old: send each act to old employee email
      - new: send all acts to new employee email
      - manual: send all acts to manual_email
      - employee: send all acts to employee_email
    """
    records: list[dict[str, Any]] = []
    errors: list[str] = []

    for act_id in act_ids:
        record = get_act_record(act_id)
        if not record:
            errors.append(f"Act not found: {act_id}")
            continue
        if not os.path.exists(record.get("file_path", "")):
            errors.append(f"Act file not found: {record.get('file_name', act_id)}")
            continue
        records.append(record)

    if not records:
        return {
            "success_count": 0,
            "failed_count": max(1, len(errors)),
            "errors": errors or ["No valid act files selected"],
        }

    success_count = 0
    failed_count = 0

    if mode == "old":
        recipient_map: dict[str, list[dict[str, Any]]] = {}
        for record in records:
            recipient = (record.get("old_employee_email") or "").strip()
            if not recipient:
                failed_count += 1
                errors.append(f"No email for old employee: {record.get('old_employee_name')}")
                continue
            recipient_map.setdefault(recipient, []).append(record)

        subject = f"Акты приема-передачи ({datetime.now().strftime('%d.%m.%Y')})"
        body = "Во вложении акт приема-передачи оборудования."
        timeout_sec = max(5, int(_read_env("TRANSFER_EMAIL_TIMEOUT_SEC", "60") or "60"))

        async def _send_one(recipient: str, recipient_records: list[dict[str, Any]]) -> bool:
            try:
                return await asyncio.wait_for(
                    _send_files(recipient, recipient_records, subject, body),
                    timeout=timeout_sec,
                )
            except Exception as exc:
                logger.warning("Transfer acts email to %s failed: %s", recipient, exc)
                return False

        sent_flags = await asyncio.gather(
            *(
                _send_one(recipient, recipient_records)
                for recipient, recipient_records in recipient_map.items()
            )
        )
        for recipient, sent in zip(recipient_map.keys(), sent_flags):
            if sent:
                success_count += 1
            else:
                failed_count += 1
                errors.append(f"Failed to send to {recipient}")

    else:
        if mode == "new":
            recipient_email = (records[0].get("new_employee_email") or "").strip()
        elif mode == "manual":
            recipient_email = (manual_email or "").strip()
        elif mode == "employee":
            recipient_email = (employee_email or "").strip()
        else:
            recipient_email = ""

        if not recipient_email:
            return {
                "success_count": 0,
                "failed_count": 1,
                "errors": ["Recipient email is not set"],
            }

        subject = f"Акты приема-передачи ({datetime.now().strftime('%d.%m.%Y')})"
        body = "Во вложении акты приема-передачи оборудования."
        sent = await _send_files(recipient_email, records, subject, body)
        if sent:
            success_count += 1
        else:
            failed_count += 1
            errors.append(f"Failed to send to {recipient_email}")

    return {
        "success_count": success_count,
        "failed_count": failed_count,
        "errors": errors,
    }
