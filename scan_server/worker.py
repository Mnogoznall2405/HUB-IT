from __future__ import annotations

import base64
import os
from concurrent.futures import Future, ProcessPoolExecutor, ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from concurrent.futures.process import BrokenProcessPool
import json
import logging
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from .config import SCAN_JOB_MAX_WORKERS_LIMIT, ScanServerConfig
from .database import ScanStore
from .ocr import is_tesseract_available, ocr_pdf_bytes
from .patterns import allowed_pattern_ids, classify_severity, normalize_pattern_filter, scan_text

logger = logging.getLogger(__name__)

try:
    import fitz  # type: ignore
except Exception:  # pragma: no cover
    fitz = None

try:
    from PIL import Image  # type: ignore
except Exception:  # pragma: no cover
    Image = None


BLANK_PDF_MAX_PAGE_BOX_PT = 96.0
BLANK_PDF_NEAR_WHITE_THRESHOLD = 248
# Archived icon-like PDFs (forward/help/back) are tiny vector pages and still
# render with only ~0.63-0.84 near-white coverage, so keep this threshold loose.
BLANK_PDF_WHITE_RATIO = 0.63
IS_WINDOWS = os.name == "nt"
MISSING_TRANSIENT_PDF_PAYLOAD = "Missing transient PDF payload"


def _safe_b64decode(value: str) -> bytes:
    try:
        return base64.b64decode(str(value or ""), validate=False)
    except Exception:
        return b""


def _extract_pdf_text(pdf_bytes: bytes, max_pages: int = 3) -> str:
    if not pdf_bytes or fitz is None:
        return ""
    text_parts: List[str] = []
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            pages = min(max_pages, len(doc))
            for idx in range(pages):
                text_parts.append(doc.load_page(idx).get_text("text") or "")
    except Exception as exc:
        logger.debug("PDF text extraction failed: %s", exc)
    return "\n".join(text_parts).strip()


def _looks_gibberish(text: str) -> bool:
    content = str(text or "")
    if len(content.strip()) < 120:
        return True
    printable = sum(1 for ch in content if ch.isprintable())
    letters = sum(1 for ch in content if ch.isalpha())
    if printable == 0:
        return True
    return (letters / max(1, printable)) < 0.35


def _is_blank_tiny_pdf(pdf_bytes: bytes) -> bool:
    if not pdf_bytes or fitz is None:
        return False
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            if len(doc) <= 0:
                return False
            page = doc.load_page(0)
            rect = page.rect
            if rect.width > BLANK_PDF_MAX_PAGE_BOX_PT or rect.height > BLANK_PDF_MAX_PAGE_BOX_PT:
                return False
            text_blocks = page.get_text("blocks") or []
            if any(str(block[4] or "").strip() for block in text_blocks if len(block) > 4):
                return False
            if page.get_images(full=True):
                return False

            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            if pix.width <= 0 or pix.height <= 0 or pix.n < 3:
                return False
            samples = memoryview(pix.samples)
            pixel_count = pix.width * pix.height
            near_white = 0
            for idx in range(0, len(samples), pix.n):
                if (
                    samples[idx] >= BLANK_PDF_NEAR_WHITE_THRESHOLD
                    and samples[idx + 1] >= BLANK_PDF_NEAR_WHITE_THRESHOLD
                    and samples[idx + 2] >= BLANK_PDF_NEAR_WHITE_THRESHOLD
                ):
                    near_white += 1
            return (near_white / max(1, pixel_count)) >= BLANK_PDF_WHITE_RATIO
    except Exception as exc:
        logger.debug("Blank/tiny PDF inspection failed: %s", exc)
        return False


def _init_worker_logging() -> None:
    # This is called inside ProcessPoolExecutor workers (on Windows spawn)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [WORKER-%(process)d] [%(levelname)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )


def _ocr_pdf_job(pdf_bytes: bytes, lang: str, tesseract_cmd: str, timeout_sec: int, dpi: int) -> str:
    return ocr_pdf_bytes(
        pdf_bytes,
        lang=lang,
        tesseract_cmd=tesseract_cmd,
        timeout_sec=timeout_sec,
        dpi=dpi,
        max_pages=3,
    )


class ScanWorker(threading.Thread):
    def __init__(self, *, store: ScanStore, config: ScanServerConfig, stop_event: threading.Event) -> None:
        super().__init__(daemon=True, name="scan-worker")
        self.store = store
        self.config = config
        self.stop_event = stop_event
        self._last_cleanup_ts = 0
        self._job_pool: Optional[ThreadPoolExecutor] = None
        self._job_futures: Dict[Future[None], str] = {}
        self._ocr_pool: Optional[ProcessPoolExecutor | ThreadPoolExecutor] = None
        self._ocr_pool_lock = threading.Lock()
        self._ocr_available = False

    def run(self) -> None:
        logger.info("Scan worker started job_max_workers=%s", self._job_max_workers())
        self._reconcile_transient_pdf_spool()
        if self.config.ocr_enabled:
            available = is_tesseract_available(self.config.ocr_tesseract_cmd)
            self._ocr_available = available
            logger.info(
                "OCR status: enabled=%s available=%s lang=%s max_processes=%s mode=%s tesseract=%s fitz=%s Pillow=%s",
                self.config.ocr_enabled,
                available,
                self.config.ocr_lang,
                self.config.ocr_max_processes,
                "thread" if IS_WINDOWS else "process",
                self.config.ocr_tesseract_cmd,
                fitz is not None,
                Image is not None,
            )
        while not self.stop_event.is_set():
            try:
                processed = self._tick()
            except Exception as exc:
                logger.exception("Scan worker tick failed: %s", exc)
                processed = False
            if processed:
                continue
            self.stop_event.wait(self.config.worker_interval_sec)
        self._shutdown_job_pool()
        self._shutdown_ocr_pool()
        logger.info("Scan worker stopped")

    def _reconcile_transient_pdf_spool(self) -> None:
        reconcile = getattr(self.store, "reconcile_job_pdf_spool", None)
        if not callable(reconcile):
            return
        try:
            result = reconcile()
        except Exception as exc:
            logger.warning("Transient PDF spool reconcile failed: %s", exc)
            return
        if not any(
            int((result or {}).get(key) or 0) > 0
            for key in ("removed_orphan_files", "removed_final_files", "failed_jobs")
        ):
            return
        logger.info(
            "Transient PDF spool reconcile completed: orphan=%s final=%s failed_jobs=%s",
            int((result or {}).get("removed_orphan_files") or 0),
            int((result or {}).get("removed_final_files") or 0),
            int((result or {}).get("failed_jobs") or 0),
        )

    def _tick(self) -> bool:
        now_ts = int(time.time())
        if now_ts - self._last_cleanup_ts > 3600:
            self.store.cleanup_retention(retention_days=self.config.retention_days)
            self._last_cleanup_ts = now_ts

        requeue_stale = getattr(self.store, "requeue_stale_processing_jobs", None)
        if callable(requeue_stale):
            try:
                stale_count = int(
                    requeue_stale(timeout_sec=getattr(self.config, "job_processing_timeout_sec", 1800))
                    or 0
                )
                if stale_count:
                    logger.warning("Requeued %s stale scan job(s) after processing lease timeout", stale_count)
            except Exception as exc:
                logger.warning("Failed to requeue stale scan jobs: %s", exc)

        completed = self._collect_finished_jobs()
        if self.stop_event.is_set():
            return completed > 0

        free_slots = self._job_max_workers() - len(self._job_futures)
        if free_slots <= 0:
            return completed > 0

        jobs = self._claim_next_jobs(free_slots)
        if not jobs:
            return completed > 0

        pool = self._get_job_pool()
        for job in jobs:
            job_id = str(job.get("id") or "")
            future = pool.submit(self._process_job, job)
            self._job_futures[future] = job_id
        self._collect_finished_jobs()
        return True

    def _job_max_workers(self) -> int:
        return max(
            1,
            min(
                SCAN_JOB_MAX_WORKERS_LIMIT,
                int(getattr(self.config, "scan_job_max_workers", 1) or 1),
            ),
        )

    def _get_job_pool(self) -> ThreadPoolExecutor:
        if self._job_pool is None:
            self._job_pool = ThreadPoolExecutor(
                max_workers=self._job_max_workers(),
                thread_name_prefix="scan-job",
            )
        return self._job_pool

    def _shutdown_job_pool(self) -> None:
        if self._job_pool is None:
            return
        try:
            self._job_pool.shutdown(wait=True, cancel_futures=False)
        except Exception:
            pass
        self._job_pool = None
        self._job_futures.clear()

    def _collect_finished_jobs(self) -> int:
        completed = 0
        for future in list(self._job_futures):
            if not future.done():
                continue
            job_id = self._job_futures.pop(future, "")
            completed += 1
            try:
                future.result()
            except Exception as exc:
                logger.exception("Scan job worker failed job_id=%s: %s", job_id, exc)
        return completed

    def _claim_next_jobs(self, limit: int) -> List[Dict[str, Any]]:
        claim_batch = getattr(self.store, "claim_next_jobs", None)
        if callable(claim_batch):
            return list(claim_batch(limit))
        jobs: List[Dict[str, Any]] = []
        for _ in range(max(1, int(limit or 1))):
            job = self.store.claim_next_job()
            if not job:
                break
            jobs.append(job)
        return jobs

    def _payload_pdf_bytes(self, payload: Dict[str, Any], *, job_id: str) -> bytes:
        spool_bytes = self.store.read_job_pdf_spool(job_id=job_id)
        if spool_bytes:
            return spool_bytes
        raw_b64 = str(payload.get("pdf_slice_b64") or "").strip()
        if not raw_b64:
            return b""
        return _safe_b64decode(raw_b64)

    def _coerce_matches(self, raw_items: Any, allowed_pattern_ids_filter: Optional[set[str]] = None) -> List[Dict[str, str]]:
        items = raw_items if isinstance(raw_items, list) else []
        allowed = allowed_pattern_ids()
        if allowed_pattern_ids_filter is not None:
            allowed = allowed & allowed_pattern_ids_filter
        out: List[Dict[str, str]] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            pattern_id = str(item.get("pattern") or "unknown")
            if pattern_id not in allowed:
                continue
            out.append(
                {
                    "pattern": pattern_id,
                    "pattern_name": str(item.get("pattern_name") or pattern_id),
                    "weight": str(item.get("weight") or ""),
                    "value": str(item.get("value") or ""),
                    "snippet": str(item.get("snippet") or ""),
                }
            )
            if len(out) >= 100:
                break
        return out

    def _dedupe_matches(self, matches: List[Dict[str, str]]) -> List[Dict[str, str]]:
        out: List[Dict[str, str]] = []
        seen = set()
        for item in matches:
            key = (
                str(item.get("pattern") or ""),
                str(item.get("value") or ""),
                str(item.get("snippet") or ""),
            )
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
        return out

    def _scan_text_with_filter(self, text: str, allowed_pattern_ids_filter: Optional[set[str]]) -> List[Dict[str, str]]:
        if allowed_pattern_ids_filter is None:
            return scan_text(text)
        if not allowed_pattern_ids_filter:
            return []
        return scan_text(text, allowed_pattern_ids=allowed_pattern_ids_filter)

    def _get_ocr_pool(self) -> Optional[ProcessPoolExecutor | ThreadPoolExecutor]:
        if not self.config.ocr_enabled or not self._ocr_available:
            return None
        with self._ocr_pool_lock:
            if self._ocr_pool is None:
                try:
                    if IS_WINDOWS:
                        self._ocr_pool = ThreadPoolExecutor(
                            max_workers=self.config.ocr_max_processes,
                            thread_name_prefix="scan-ocr",
                        )
                    else:
                        self._ocr_pool = ProcessPoolExecutor(
                            max_workers=self.config.ocr_max_processes,
                            initializer=_init_worker_logging,
                        )
                except Exception as exc:
                    logger.warning("OCR pool init failed, falling back to inline OCR: %s", exc)
                    return None
            return self._ocr_pool

    def _shutdown_ocr_pool(self) -> None:
        with self._ocr_pool_lock:
            if self._ocr_pool is None:
                return
            try:
                self._ocr_pool.shutdown(wait=True, cancel_futures=True)
            except Exception:
                pass
            self._ocr_pool = None

    def _log_pdf_outcome(
        self,
        outcome: str,
        *,
        artifact_path: Optional[Path],
        matches_count: int = 0,
        detail: str = "",
    ) -> None:
        artifact_value = str(artifact_path) if artifact_path is not None else "<memory>"
        message = "PDF outcome=%s artifact=%s matches=%s"
        args: List[Any] = [outcome, artifact_value, matches_count]
        if detail:
            message += " detail=%s"
            args.append(detail)
        if outcome == "ocr_error":
            logger.warning(message, *args)
            return
        if outcome in {"text_layer_clean_skip", "ocr_skipped_blank_pdf", "ocr_clean_no_match"}:
            logger.debug(message, *args)
            return
        logger.info(message, *args)

    def _run_inline_ocr_job(self, pdf_bytes: bytes, artifact_path: Optional[Path]) -> Tuple[str, str]:
        if not self._ocr_available:
            return "", "ocr_error"
        try:
            text = str(
                _ocr_pdf_job(
                    pdf_bytes,
                    self.config.ocr_lang,
                    self.config.ocr_tesseract_cmd,
                    self.config.ocr_timeout_sec,
                    self.config.ocr_dpi,
                )
                or ""
            ).strip()
            if not text:
                return "", "ocr_attempted_no_text"
            return text, "ocr_text_ready"
        except Exception as exc:
            logger.warning("Inline OCR failed for artifact=%s: %s - %s", artifact_path, type(exc).__name__, exc)
            return "", "ocr_error"

    def _ocr_text_from_pdf_bytes(self, pdf_bytes: bytes, artifact_path: Optional[Path] = None) -> Tuple[str, str]:
        if not self.config.ocr_enabled:
            return "", "ocr_error"
        pool = self._get_ocr_pool()
        if pool is None:
            return self._run_inline_ocr_job(pdf_bytes, artifact_path)
        try:
            logger.debug("Starting OCR for artifact=%s, pdf_bytes=%d", artifact_path, len(pdf_bytes))
            future = pool.submit(
                _ocr_pdf_job,
                pdf_bytes,
                self.config.ocr_lang,
                self.config.ocr_tesseract_cmd,
                self.config.ocr_timeout_sec,
                self.config.ocr_dpi,
            )
            text = str(
                future.result(timeout=max(5, int(self.config.ocr_timeout_sec) + 15)) or ""
            ).strip()
            if not text:
                return "", "ocr_attempted_no_text"
            return text, "ocr_text_ready"
        except FuturesTimeoutError:
            logger.warning("OCR timeout for artifact=%s", artifact_path)
            return "", "ocr_error"
        except BrokenProcessPool as exc:
            logger.warning(
                "OCR process pool broke for artifact=%s: %s - %s; recycling pool and retrying inline OCR",
                artifact_path,
                type(exc).__name__,
                exc,
            )
            self._shutdown_ocr_pool()
            return self._run_inline_ocr_job(pdf_bytes, artifact_path)
        except Exception as exc:
            logger.warning("OCR failed for artifact=%s: %s - %s", artifact_path, type(exc).__name__, exc)
            return "", "ocr_error"

    def _collect_pdf_matches(
        self,
        pdf_bytes: bytes,
        artifact_path: Optional[Path] = None,
        allowed_pattern_ids_filter: Optional[set[str]] = None,
    ) -> Dict[str, Any]:
        if not pdf_bytes:
            return {"matches": [], "outcome": "", "reason": "No PDF payload"}

        text_layer = _extract_pdf_text(pdf_bytes, max_pages=3)
        if text_layer:
            text_matches = self._scan_text_with_filter(text_layer, allowed_pattern_ids_filter)
            if text_matches:
                self._log_pdf_outcome("text_layer_match", artifact_path=artifact_path, matches_count=len(text_matches))
                return {
                    "matches": text_matches,
                    "outcome": "text_layer_match",
                    "reason": "Text layer matched patterns",
                }
            if self.config.ocr_only_if_no_text and not _looks_gibberish(text_layer):
                self._log_pdf_outcome(
                    "text_layer_clean_skip",
                    artifact_path=artifact_path,
                    detail="usable text layer without pattern matches",
                )
                return {
                    "matches": [],
                    "outcome": "text_layer_clean_skip",
                    "reason": "Skipped OCR: usable text layer without matches",
                }
            logger.debug("Text layer exists but no matches, proceeding to OCR")

        if _is_blank_tiny_pdf(pdf_bytes):
            self._log_pdf_outcome(
                "ocr_skipped_blank_pdf",
                artifact_path=artifact_path,
                detail="blank/tiny first page",
            )
            return {
                "matches": [],
                "outcome": "ocr_skipped_blank_pdf",
                "reason": "Skipped OCR: blank/tiny PDF",
            }

        logger.debug("Starting OCR for PDF artifact=%s", artifact_path or "<memory>")
        ocr_text, ocr_outcome = self._ocr_text_from_pdf_bytes(pdf_bytes, artifact_path=artifact_path)
        if not ocr_text:
            detail = "OCR returned no text" if ocr_outcome == "ocr_attempted_no_text" else "OCR execution error"
            self._log_pdf_outcome(ocr_outcome, artifact_path=artifact_path, detail=detail)
            return {
                "matches": [],
                "outcome": ocr_outcome,
                "reason": detail,
            }

        matches = self._scan_text_with_filter(ocr_text, allowed_pattern_ids_filter)
        if matches:
            self._log_pdf_outcome("ocr_match", artifact_path=artifact_path, matches_count=len(matches))
            return {
                "matches": matches,
                "outcome": "ocr_match",
                "reason": "OCR text matched patterns",
            }

        self._log_pdf_outcome(
            "ocr_clean_no_match",
            artifact_path=artifact_path,
            detail="OCR text had no pattern matches",
        )
        return {
            "matches": [],
            "outcome": "ocr_clean_no_match",
            "reason": "OCR text had no pattern matches",
        }

    def _pdf_outcome_summary(self, outcome: str, matches_count: int) -> str:
        if matches_count > 0:
            if outcome:
                return f"Matches found: {matches_count} ({outcome})"
            return f"Matches found: {matches_count}"
        if outcome == "text_layer_clean_skip":
            return "No matches (text_layer_clean_skip)"
        if outcome == "ocr_attempted_no_text":
            return "No matches after OCR (ocr_attempted_no_text)"
        if outcome == "ocr_skipped_blank_pdf":
            return "Skipped OCR: blank/tiny PDF (ocr_skipped_blank_pdf)"
        if outcome == "ocr_error":
            return "No matches (ocr_error)"
        if outcome == "ocr_clean_no_match":
            return "No matches after OCR (ocr_clean_no_match)"
        return "No matches"

    def _process_job(self, job: Dict[str, Any]) -> None:
        job_id = str(job.get("id") or "")
        payload = {}
        delete_spool = True
        try:
            payload = json.loads(str(job.get("payload_json") or "{}"))
        except Exception:
            payload = {}

        try:
            pdf_bytes = self._payload_pdf_bytes(payload, job_id=job_id)
            pdf_outcome = ""
            source_kind = str(job.get("source_kind") or "").strip().lower()
            is_pdf_job = source_kind in {"pdf", "pdf_slice"}
            requires_pdf_payload = source_kind == "pdf_slice"
            allowed_pattern_ids_filter = self._server_pdf_pattern_filter(job) if is_pdf_job else None
            matches = self._coerce_matches(payload.get("local_pattern_hits"), allowed_pattern_ids_filter)

            text_excerpt = str(payload.get("text_excerpt") or "")
            if text_excerpt:
                matches.extend(self._scan_text_with_filter(text_excerpt, allowed_pattern_ids_filter))

            if requires_pdf_payload and not pdf_bytes:
                logger.warning(
                    "Skipping pdf_slice job with missing transient PDF payload job_id=%s file=%s",
                    job_id,
                    str(job.get("file_name") or ""),
                )
                self.store.finalize_job(
                    job_id=job_id,
                    status="failed",
                    error_text=MISSING_TRANSIENT_PDF_PAYLOAD,
                )
                return

            if not matches and pdf_bytes:
                file_name = str(job.get("file_name") or "unnamed")
                logger.debug("Processing job_id=%s, file=%s", job_id, file_name)
                pdf_result = self._collect_pdf_matches(
                    pdf_bytes,
                    artifact_path=None,
                    allowed_pattern_ids_filter=allowed_pattern_ids_filter,
                )
                matches.extend(pdf_result.get("matches") or [])
                pdf_outcome = str(pdf_result.get("outcome") or "")
            matches = self._dedupe_matches(matches)

            if matches:
                severity = classify_severity(matches)
                unique_patterns = sorted({str(row.get("pattern") or "unknown") for row in matches})
                short_reason = ", ".join(unique_patterns[:5])
                self.store.create_finding_and_incident(
                    job=job,
                    severity=severity,
                    category="policy_match",
                    matched_patterns=matches,
                    short_reason=short_reason,
                )
                self.store.finalize_job(
                    job_id=job_id,
                    status="done_with_incident",
                    summary=self._pdf_outcome_summary(pdf_outcome, len(matches)),
                )
            else:
                if pdf_outcome == "ocr_error":
                    attempts = int(job.get("attempt_count") or 0)
                    max_attempts = max(1, int(getattr(self.config, "scan_job_max_attempts", 3) or 3))
                    if attempts < max_attempts:
                        requeue_retry = getattr(self.store, "requeue_job_for_retry", None)
                        if callable(requeue_retry):
                            requeue_retry(
                                job_id=job_id,
                                error_text="OCR timeout",
                                summary=f"OCR retry scheduled ({attempts}/{max_attempts})",
                            )
                            delete_spool = False
                            return
                    self.store.finalize_job(
                        job_id=job_id,
                        status="failed",
                        summary=self._pdf_outcome_summary(pdf_outcome, 0),
                        error_text="OCR timeout",
                    )
                    return
                self.store.finalize_job(
                    job_id=job_id,
                    status="done_clean",
                    summary=self._pdf_outcome_summary(pdf_outcome, 0),
                )
        except Exception as exc:
            self.store.finalize_job(job_id=job_id, status="failed", error_text=str(exc))
            logger.exception("Job processing failed job_id=%s: %s", job_id, exc)
        finally:
            if delete_spool:
                self.store.delete_job_pdf_spool(job_id=job_id)

    def _server_pdf_pattern_filter(self, job: Dict[str, Any]) -> Optional[set[str]]:
        task_id = str(job.get("scan_task_id") or "").strip()
        if not task_id:
            return None
        try:
            getter = getattr(self.store, "get_task_payload", None)
            task_payload = getter(task_id) if callable(getter) else {}
        except Exception as exc:
            logger.warning("Failed to load scan task payload for task_id=%s: %s", task_id, exc)
            return None
        if not isinstance(task_payload, dict) or "server_pdf_pattern_ids" not in task_payload:
            return None
        return normalize_pattern_filter(task_payload.get("server_pdf_pattern_ids"))
