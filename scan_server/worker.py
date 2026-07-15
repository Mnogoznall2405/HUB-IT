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
from typing import Any, Dict, List, Optional, Tuple
from agent_version import SCAN_ANALYSIS_VERSION, SCAN_OCR_PAGE_LIMIT, SCAN_TEXT_PAGE_LIMIT

from .config import SCAN_JOB_MAX_WORKERS_LIMIT, ScanServerConfig
from .database import ScanStore
from .document_conversion import DocumentConversionError, convert_document_to_pdf
from .memory_guard import memory_pressure_active
from .ocr import OcrNonRetryableError, is_tesseract_available, ocr_pdf_bytes_detailed
from .patterns import allowed_pattern_ids, classify_severity, normalize_pattern_filter, normalize_scan_text, scan_text

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
NON_RETRYABLE_PDF_FAILURE_OUTCOMES = {"ocr_error_non_retryable", "ocr_skipped_oversize_pdf"}


class OcrTextResult(tuple):
    """Two-value OCR result with optional metrics, preserving legacy unpacking."""

    def __new__(cls, text: str, outcome: str, metrics: Optional[Dict[str, Any]] = None):
        instance = super().__new__(cls, (str(text or ""), str(outcome or "")))
        instance.metrics = dict(metrics or {})
        return instance


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
            pages_to_check = min(SCAN_OCR_PAGE_LIMIT, len(doc))
            for page_index in range(pages_to_check):
                page = doc.load_page(page_index)
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
                if (near_white / max(1, pixel_count)) < BLANK_PDF_WHITE_RATIO:
                    return False
            return pages_to_check > 0
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


def _ocr_pdf_job(pdf_bytes: bytes, lang: str, tesseract_cmd: str, timeout_sec: int, dpi: int) -> Dict[str, Any]:
    return ocr_pdf_bytes_detailed(
        pdf_bytes,
        lang=lang,
        tesseract_cmd=tesseract_cmd,
        timeout_sec=timeout_sec,
        dpi=dpi,
        max_pages=SCAN_OCR_PAGE_LIMIT,
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
        recover_interrupted = getattr(self.store, "requeue_interrupted_processing_jobs", None)
        if callable(recover_interrupted):
            try:
                recovered_count = int(recover_interrupted() or 0)
                if recovered_count:
                    logger.warning(
                        "Recovered %s interrupted scan job(s) after worker restart",
                        recovered_count,
                    )
            except Exception as exc:
                logger.warning("Interrupted scan job recovery failed: %s", exc)
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
            self.store.cleanup_retention(
                retention_days=self.config.retention_days,
                clean_job_retention_days=getattr(self.config, "clean_job_retention_days", None),
                failed_job_retention_days=getattr(self.config, "failed_job_retention_days", None),
                incident_retention_days=getattr(self.config, "incident_retention_days", None),
            )
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

        if memory_pressure_active(limit_mb=int(getattr(self.config, "worker_memory_limit_mb", 0) or 0)):
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
                normalize_scan_text(item.get("value")).casefold(),
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
        if outcome in {"ocr_error", "ocr_error_non_retryable", "ocr_skipped_oversize_pdf"}:
            logger.warning(message, *args)
            return
        if outcome in {"text_layer_clean_skip", "ocr_skipped_blank_pdf", "ocr_clean_no_match"}:
            logger.debug(message, *args)
            return
        logger.info(message, *args)

    def _run_inline_ocr_job(self, pdf_bytes: bytes, artifact_path: Optional[Path]) -> Tuple[str, str]:
        if not self._ocr_available:
            return OcrTextResult("", "ocr_error")
        try:
            result = _ocr_pdf_job(
                pdf_bytes,
                self.config.ocr_lang,
                self.config.ocr_tesseract_cmd,
                self.config.ocr_timeout_sec,
                self.config.ocr_dpi,
            )
            return self._normalize_ocr_result(result)
        except OcrNonRetryableError as exc:
            logger.warning("Inline OCR rejected non-retryable PDF artifact=%s: %s", artifact_path, exc)
            return OcrTextResult("", "ocr_error_non_retryable")
        except Exception as exc:
            logger.warning("Inline OCR failed for artifact=%s: %s - %s", artifact_path, type(exc).__name__, exc)
            return OcrTextResult("", "ocr_error")

    def _ocr_text_from_pdf_bytes(self, pdf_bytes: bytes, artifact_path: Optional[Path] = None) -> Tuple[str, str]:
        if not self.config.ocr_enabled:
            return OcrTextResult("", "ocr_error")
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
            # One page can run full-page OCR plus four focused sparse-text passes.
            # Keep the outer process timeout above the worst-case three-page budget.
            result = future.result(timeout=max(30, int(self.config.ocr_timeout_sec) * 20 + 30))
            return self._normalize_ocr_result(result)
        except OcrNonRetryableError as exc:
            logger.warning("OCR rejected non-retryable PDF artifact=%s: %s", artifact_path, exc)
            return OcrTextResult("", "ocr_error_non_retryable")
        except FuturesTimeoutError:
            logger.warning("OCR timeout for artifact=%s", artifact_path)
            return OcrTextResult("", "ocr_error")
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
            return OcrTextResult("", "ocr_error")

    @staticmethod
    def _normalize_ocr_result(result: Any) -> Tuple[str, str]:
        if not isinstance(result, dict):
            text = str(result or "").strip()
            return OcrTextResult(text, "ocr_text_ready") if text else OcrTextResult("", "ocr_attempted_no_text")
        text = str(result.get("text") or "").strip()
        metrics = result.get("metrics") if isinstance(result.get("metrics"), dict) else {}
        metrics = {**metrics, "page_outcomes": result.get("pages") if isinstance(result.get("pages"), list) else []}
        if not bool(result.get("complete")):
            return OcrTextResult(text, "ocr_incomplete", metrics)
        if text:
            return OcrTextResult(text, "ocr_text_ready", metrics)
        return OcrTextResult("", "ocr_blank", metrics)

    def _collect_pdf_matches(
        self,
        pdf_bytes: bytes,
        artifact_path: Optional[Path] = None,
        allowed_pattern_ids_filter: Optional[set[str]] = None,
    ) -> Dict[str, Any]:
        metrics: Dict[str, Any] = {"pdf_bytes": len(pdf_bytes or b"")}
        if not pdf_bytes:
            return {"matches": [], "outcome": "", "reason": "No PDF payload", "metrics": metrics}
        pdf_max_bytes = int(getattr(self.config, "pdf_max_bytes", 0) or 0)
        if pdf_max_bytes > 0 and len(pdf_bytes) > pdf_max_bytes:
            reason = f"Skipped OCR: PDF payload exceeds {pdf_max_bytes} bytes"
            self._log_pdf_outcome(
                "ocr_skipped_oversize_pdf",
                artifact_path=artifact_path,
                detail=f"bytes={len(pdf_bytes)} limit={pdf_max_bytes}",
            )
            return {"matches": [], "outcome": "ocr_skipped_oversize_pdf", "reason": reason, "metrics": metrics}

        text_started = time.perf_counter()
        text_layer = _extract_pdf_text(pdf_bytes, max_pages=SCAN_TEXT_PAGE_LIMIT)
        metrics["text_layer_ms"] = round((time.perf_counter() - text_started) * 1000.0, 1)
        text_matches: List[Dict[str, Any]] = []
        if text_layer:
            rules_started = time.perf_counter()
            text_matches = self._scan_text_with_filter(text_layer, allowed_pattern_ids_filter)
            metrics["rules_ms"] = round((time.perf_counter() - rules_started) * 1000.0, 1)
            logger.debug("Text layer checked; proceeding to mandatory OCR matches=%s", len(text_matches))

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
                "metrics": metrics,
            }

        logger.debug("Starting OCR for PDF artifact=%s", artifact_path or "<memory>")
        ocr_started = time.perf_counter()
        ocr_result = self._ocr_text_from_pdf_bytes(pdf_bytes, artifact_path=artifact_path)
        ocr_text, ocr_outcome = ocr_result
        ocr_metrics = getattr(ocr_result, "metrics", {})
        metrics["ocr_ms"] = round((time.perf_counter() - ocr_started) * 1000.0, 1)
        metrics["ocr"] = ocr_metrics
        if not ocr_text:
            if ocr_outcome == "ocr_blank":
                return {
                    "matches": text_matches,
                    "outcome": "text_layer_match_ocr_blank" if text_matches else "ocr_skipped_blank_pdf",
                    "reason": "OCR confirmed blank pages",
                    "metrics": metrics,
                }
            detail = "OCR returned no text for a nonblank page" if ocr_outcome in {"ocr_attempted_no_text", "ocr_incomplete"} else "OCR execution error"
            self._log_pdf_outcome(ocr_outcome, artifact_path=artifact_path, detail=detail)
            return {
                "matches": text_matches,
                "outcome": "analysis_incomplete",
                "reason": detail,
                "metrics": metrics,
            }

        rules_started = time.perf_counter()
        ocr_matches = self._scan_text_with_filter(ocr_text, allowed_pattern_ids_filter)
        metrics["rules_ms"] = round(
            float(metrics.get("rules_ms") or 0.0) + (time.perf_counter() - rules_started) * 1000.0,
            1,
        )
        matches = [*text_matches, *ocr_matches]
        if ocr_outcome == "ocr_incomplete":
            self._log_pdf_outcome("analysis_incomplete", artifact_path=artifact_path, matches_count=len(matches))
            return {
                "matches": matches,
                "outcome": "analysis_incomplete",
                "reason": "One or more OCR pages were not fully analyzed",
                "metrics": metrics,
            }
        if matches:
            outcome = "combined_match" if text_matches else "ocr_match"
            self._log_pdf_outcome(outcome, artifact_path=artifact_path, matches_count=len(matches))
            return {
                "matches": matches,
                "outcome": outcome,
                "reason": "Text layer and OCR analysis completed with matches",
                "metrics": metrics,
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
            "metrics": metrics,
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
        if outcome == "ocr_skipped_oversize_pdf":
            return "Skipped OCR: oversized PDF (ocr_skipped_oversize_pdf)"
        if outcome == "ocr_error_non_retryable":
            return "No matches (ocr_error_non_retryable)"
        if outcome == "ocr_error":
            return "No matches (ocr_error)"
        if outcome == "ocr_clean_no_match":
            return "No matches after OCR (ocr_clean_no_match)"
        if outcome == "analysis_incomplete":
            return "Analysis incomplete"
        return "No matches"

    def _process_job(self, job: Dict[str, Any]) -> None:
        job_id = str(job.get("id") or "")
        job_started = time.perf_counter()
        source_kind_value = str(job.get("source_kind") or "").strip().lower()
        created_at = int(job.get("created_at") or 0)
        started_at = int(job.get("started_at") or 0)
        job_metrics: Dict[str, Any] = {
            "analysis_version": SCAN_ANALYSIS_VERSION,
            "source_kind": source_kind_value,
            "attempt": int(job.get("attempt_count") or 0),
            "queue_wait_ms": max(0, (started_at - created_at) * 1000) if created_at and started_at else 0,
        }
        payload = {}
        delete_spool = False

        def finalize_terminal(**kwargs: Any) -> None:
            nonlocal delete_spool
            self.store.finalize_job(**kwargs)
            delete_spool = True
        try:
            payload = json.loads(str(job.get("payload_json") or "{}"))
        except Exception:
            payload = {}

        try:
            pdf_bytes = self._payload_pdf_bytes(payload, job_id=job_id)
            pdf_outcome = ""
            pdf_reason = ""
            source_kind = source_kind_value
            is_pdf_job = source_kind in {"pdf", "pdf_slice", "image", "office"}
            requires_pdf_payload = is_pdf_job
            allowed_pattern_ids_filter = self._server_pdf_pattern_filter(job) if is_pdf_job else None
            matches = self._coerce_matches(payload.get("local_pattern_hits"), allowed_pattern_ids_filter)

            text_excerpt = str(payload.get("text_excerpt") or "")
            if text_excerpt:
                matches.extend(self._scan_text_with_filter(text_excerpt, allowed_pattern_ids_filter))

            if not allowed_pattern_ids():
                logger.error("Scan rules are unavailable; refusing clean result job_id=%s", job_id)
                finalize_terminal(
                    job_id=job_id,
                    status="analysis_incomplete",
                    summary="Analysis rules unavailable",
                    error_text="patterns_unavailable",
                )
                return

            if requires_pdf_payload and not pdf_bytes:
                logger.warning(
                    "Skipping PDF job with missing transient payload job_id=%s file=%s",
                    job_id,
                    str(job.get("file_name") or ""),
                )
                matches = self._dedupe_matches(matches)
                if matches:
                    severity = classify_severity(matches)
                    unique_patterns = sorted({str(row.get("pattern") or "unknown") for row in matches})
                    self.store.create_finding_and_incident(
                        job=job,
                        severity=severity,
                        category="policy_match",
                        matched_patterns=matches,
                        short_reason=", ".join(unique_patterns[:5]),
                    )
                finalize_terminal(
                    job_id=job_id,
                    status="analysis_incomplete",
                    error_text=MISSING_TRANSIENT_PDF_PAYLOAD,
                )
                return

            if source_kind == "analysis_incomplete":
                metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
                reason = str(metadata.get("analysis_incomplete_reason") or "agent_analysis_incomplete")
                matches = self._dedupe_matches(matches)
                if matches:
                    severity = classify_severity(matches)
                    unique_patterns = sorted({str(row.get("pattern") or "unknown") for row in matches})
                    self.store.create_finding_and_incident(
                        job=job,
                        severity=severity,
                        category="policy_match",
                        matched_patterns=matches,
                        short_reason=", ".join(unique_patterns[:5]),
                    )
                finalize_terminal(
                    job_id=job_id,
                    status="analysis_incomplete",
                    summary=self._pdf_outcome_summary("analysis_incomplete", len(matches)),
                    error_text=reason,
                )
                return

            if source_kind in {"image", "office"} and pdf_bytes:
                try:
                    conversion_started = time.perf_counter()
                    pdf_bytes = convert_document_to_pdf(
                        pdf_bytes,
                        str(job.get("file_name") or payload.get("file_name") or "document.bin"),
                    )
                    job_metrics["conversion_ms"] = round(
                        (time.perf_counter() - conversion_started) * 1000.0,
                        1,
                    )
                    append_outcome = getattr(self.store, "append_job_extraction_outcome", None)
                    if callable(append_outcome):
                        append_outcome(
                            job_id=job_id,
                            outcome={"method": "document_conversion", "outcome": "pdf_ready"},
                        )
                except DocumentConversionError as exc:
                    job_metrics["conversion_ms"] = round(
                        (time.perf_counter() - conversion_started) * 1000.0,
                        1,
                    )
                    append_outcome = getattr(self.store, "append_job_extraction_outcome", None)
                    if callable(append_outcome):
                        append_outcome(
                            job_id=job_id,
                            outcome={"method": "document_conversion", "outcome": "failed", "reason": str(exc)},
                        )
                    finalize_terminal(
                        job_id=job_id,
                        status="analysis_incomplete",
                        summary="Document conversion incomplete",
                        error_text=str(exc),
                    )
                    return

            if pdf_bytes:
                file_name = str(job.get("file_name") or "unnamed")
                logger.debug("Processing job_id=%s, file=%s", job_id, file_name)
                pdf_result = self._collect_pdf_matches(
                    pdf_bytes,
                    artifact_path=None,
                    allowed_pattern_ids_filter=allowed_pattern_ids_filter,
                )
                matches.extend(pdf_result.get("matches") or [])
                pdf_outcome = str(pdf_result.get("outcome") or "")
                pdf_reason = str(pdf_result.get("reason") or "")
                if isinstance(pdf_result.get("metrics"), dict):
                    job_metrics.update(pdf_result["metrics"])
                append_outcome = getattr(self.store, "append_job_extraction_outcome", None)
                if callable(append_outcome):
                    append_outcome(
                        job_id=job_id,
                        outcome={"method": "server_ocr", "outcome": pdf_outcome, "reason": pdf_reason},
                    )
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
                if pdf_outcome == "analysis_incomplete":
                    finalize_terminal(
                        job_id=job_id,
                        status="analysis_incomplete",
                        summary=self._pdf_outcome_summary(pdf_outcome, len(matches)),
                        error_text=pdf_reason or "OCR analysis incomplete",
                    )
                else:
                    finalize_terminal(
                        job_id=job_id,
                        status="done_with_incident",
                        summary=self._pdf_outcome_summary(pdf_outcome, len(matches)),
                    )
            else:
                if pdf_outcome == "ocr_error":
                    attempts = int(job.get("attempt_count") or 0)
                    max_attempts = max(1, int(getattr(self.config, "scan_job_max_attempts", 3) or 3))
                    retry_limit = min(max_attempts, 2)
                    if attempts < retry_limit:
                        requeue_retry = getattr(self.store, "requeue_job_for_retry", None)
                        if callable(requeue_retry):
                            requeue_retry(
                                job_id=job_id,
                                error_text="OCR timeout",
                                summary=f"OCR retry scheduled ({attempts}/{retry_limit})",
                            )
                            delete_spool = False
                            return
                    finalize_terminal(
                        job_id=job_id,
                        status="analysis_incomplete",
                        summary=self._pdf_outcome_summary(pdf_outcome, 0),
                        error_text="OCR timeout",
                    )
                    return
                if pdf_outcome == "analysis_incomplete":
                    finalize_terminal(
                        job_id=job_id,
                        status="analysis_incomplete",
                        summary=self._pdf_outcome_summary(pdf_outcome, 0),
                        error_text=pdf_reason or "OCR analysis incomplete",
                    )
                    return
                if pdf_outcome in NON_RETRYABLE_PDF_FAILURE_OUTCOMES:
                    finalize_terminal(
                        job_id=job_id,
                        status="analysis_incomplete",
                        summary=self._pdf_outcome_summary(pdf_outcome, 0),
                        error_text=pdf_reason or self._pdf_outcome_summary(pdf_outcome, 0),
                    )
                    return
                finalize_terminal(
                    job_id=job_id,
                    status="done_clean",
                    summary=self._pdf_outcome_summary(pdf_outcome, 0),
                )
        except Exception as exc:
            finalize_terminal(job_id=job_id, status="failed", error_text=str(exc))
            logger.exception("Job processing failed job_id=%s: %s", job_id, exc)
        finally:
            job_metrics["processing_ms"] = round((time.perf_counter() - job_started) * 1000.0, 1)
            record_metrics = getattr(self.store, "record_job_metrics", None)
            if callable(record_metrics):
                try:
                    record_metrics(job_id=job_id, metrics=job_metrics)
                except Exception as exc:
                    logger.warning("Failed to record scan metrics job_id=%s: %s", job_id, exc)
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
