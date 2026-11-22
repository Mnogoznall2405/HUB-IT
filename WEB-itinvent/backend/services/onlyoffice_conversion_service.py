"""Office-to-PDF conversion through the ONLYOFFICE Document Server Conversion API.

Uses ``POST /converter/from-file`` (ONLYOFFICE Docs >= 10.0): the document travels
inside the request as multipart/form-data, so no temporary download URL is needed.
Async conversions are polled by resending the identical request — DS 10.0 rejects
file-less status polls with ``-8`` when JWT is enabled.
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

import httpx

from backend.services.onlyoffice_service import OnlyOfficeSettings, _sign, load_settings

logger = logging.getLogger(__name__)


class OnlyOfficeConversionError(RuntimeError):
    """Raised when Document Server cannot produce the requested conversion."""


# https://api.onlyoffice.com/docs/docs-api/additional-api/conversion-api/error-codes
_ERROR_TEXT = {
    -1: "unknown conversion error",
    -2: "conversion timeout on Document Server",
    -3: "conversion error on Document Server",
    -4: "Document Server could not read the document",
    -5: "document is password-protected",
    -6: "Document Server database error",
    -7: "invalid conversion request",
    -8: "invalid conversion token",
}


def _positive_int_env(name: str, default: int, *, minimum: int = 1, maximum: int = 3600) -> int:
    try:
        value = int(str(os.getenv(name, default) or default))
    except (TypeError, ValueError):
        value = default
    return max(minimum, min(maximum, value))


def conversion_max_output_bytes() -> int:
    return _positive_int_env("ONLYOFFICE_CONVERT_MAX_OUTPUT_BYTES", 128 * 1024 * 1024, maximum=1024 * 1024 * 1024)


def conversion_poll_interval_sec() -> float:
    raw = str(os.getenv("ONLYOFFICE_CONVERT_POLL_SEC", "0.8") or "0.8").strip()
    try:
        return max(0.1, min(10.0, float(raw)))
    except ValueError:
        return 0.8


def _conversion_key(*, filename: str, content: bytes, outputtype: str) -> str:
    # Deterministic per (content,target): Document Server caches the finished
    # artifact under this key, so a repeated identical request is a cache hit.
    digest = hashlib.sha256(content).hexdigest()
    return f"hub-preview-{outputtype}-{digest[:32]}"


def _filetype_for(filename: str) -> str:
    extension = Path(str(filename or "")).suffix.lstrip(".").lower()
    if not extension:
        raise OnlyOfficeConversionError("Cannot convert a document without a file extension.")
    return extension


def _describe_response(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def convert_document_to_pdf(
    *,
    filename: str,
    content: bytes,
    timeout_sec: int,
    max_output_bytes: int | None = None,
) -> bytes:
    """Convert one office document to PDF on Document Server; returns the PDF bytes.

    Raises ``OnlyOfficeConversionError`` on protocol/server/timeout errors and
    ``OnlyOfficeDisabledError`` when the integration is not configured.
    """
    if not content:
        raise OnlyOfficeConversionError("Document payload is empty.")
    # Conversion only needs enabled + JWT + internal URL; ``app_base_url`` is
    # required by editing sessions (document.url) but not by /converter/*.
    settings: OnlyOfficeSettings = load_settings()
    if not (settings.enabled and settings.jwt_secret and settings.internal_url):
        raise OnlyOfficeConversionError("ONLYOFFICE is not configured")
    output_cap = int(max_output_bytes or conversion_max_output_bytes())
    timeout = max(5, int(timeout_sec or 120))

    params = {
        "async": True,
        "key": _conversion_key(filename=filename, content=content, outputtype="pdf"),
        "filetype": _filetype_for(filename),
        "outputtype": "pdf",
        "title": str(filename or "document")[:200],
    }
    token = _sign({**params, "operation": "converter"}, settings.jwt_secret)
    params_json = json.dumps(params, ensure_ascii=False, separators=(",", ":"))

    started = time.monotonic()
    deadline = started + timeout
    request_timeout = min(60.0, float(timeout))
    poll_interval = conversion_poll_interval_sec()

    with httpx.Client(timeout=request_timeout, follow_redirects=False) as client:
        attempt = 0
        while True:
            attempt += 1
            try:
                with client.stream(
                    "POST",
                    f"{settings.internal_url}/converter/from-file",
                    data={"params": params_json, "token": token},
                    files={"file": (str(filename or "document"), content)},
                ) as response:
                    content_type = str(response.headers.get("content-type") or "").lower()
                    if response.status_code == 200 and "json" not in content_type:
                        chunks: list[bytes] = []
                        total = 0
                        for chunk in response.iter_bytes(1 << 20):
                            total += len(chunk)
                            if total > output_cap:
                                raise OnlyOfficeConversionError(
                                    "Converted PDF exceeds the size limit."
                                )
                            chunks.append(chunk)
                        pdf_bytes = b"".join(chunks)
                        if not pdf_bytes.startswith(b"%PDF"):
                            raise OnlyOfficeConversionError(
                                "Document Server returned a non-PDF result."
                            )
                        elapsed = time.monotonic() - started
                        if attempt > 1 or elapsed > 5:
                            logger.info(
                                "onlyoffice conversion finished elapsed=%.1fs attempts=%d",
                                elapsed,
                                attempt,
                            )
                        return pdf_bytes

                    if response.status_code == 413:
                        raise OnlyOfficeConversionError(
                            "Document exceeds the Document Server download limit (413)."
                        )
                    response.read()
                    payload = _describe_response(response)
            except OnlyOfficeConversionError:
                raise
            except httpx.HTTPError as exc:
                raise OnlyOfficeConversionError(f"Document Server conversion request failed: {exc}") from exc

            if response.status_code == 200 and payload.get("endConvert") is False:
                if time.monotonic() >= deadline:
                    raise OnlyOfficeConversionError("Document Server conversion timed out.")
                time.sleep(poll_interval)
                continue

            code = payload.get("error")
            if code is not None:
                detail = _ERROR_TEXT.get(code if isinstance(code, int) else -1, "conversion failed")
                raise OnlyOfficeConversionError(f"Document Server conversion error {code}: {detail}")
            raise OnlyOfficeConversionError(
                f"Document Server conversion failed: HTTP {response.status_code}"
            )


def describe_conversion_runtime() -> dict[str, Any]:
    """Settings-only probe for diagnostics; performs no network request."""
    settings = load_settings()
    if not (settings.enabled and settings.jwt_secret and settings.internal_url):
        return {"configured": False, "error": "ONLYOFFICE is not configured"}
    return {
        "configured": True,
        "internal_url": settings.internal_url,
        "timeout_hint_sec": settings.fetch_timeout_sec,
        "max_output_bytes": conversion_max_output_bytes(),
    }
