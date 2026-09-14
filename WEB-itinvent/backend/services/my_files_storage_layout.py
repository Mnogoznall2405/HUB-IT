"""Path layout and safe Local→SMB publish helpers for My Files v2."""
from __future__ import annotations

import hashlib
import os
import shutil
import uuid
from pathlib import Path

from backend.services.hubit_storage import (
    HubitStorageError,
    ensure_connected,
    ensure_free_space,
    is_configured as hubit_storage_configured,
)


CHUNK_SIZE = 1024 * 1024


def env_flag(name: str, default: str = "0") -> bool:
    raw = str(os.getenv(name, default) or default).strip().lower()
    return raw in {"1", "true", "yes", "on"}


def storage_v2_enabled() -> bool:
    return env_flag("MY_FILES_STORAGE_V2_ENABLED", "0")


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def default_local_my_files_root() -> Path:
    return project_root() / "data" / "my_files"


def configured_storage_dir() -> Path:
    configured = str(os.getenv("MY_FILES_STORAGE_DIR", "") or "").strip()
    if configured:
        return Path(configured)
    if storage_v2_enabled() and hubit_storage_configured():
        from backend.services.hubit_storage import storage_unc

        return Path(storage_unc()) / "users"
    return default_local_my_files_root()


def configured_spool_dir() -> Path:
    configured = str(os.getenv("MY_FILES_SPOOL_DIR", "") or "").strip()
    if configured:
        return Path(configured)
    return default_local_my_files_root() / "spool"


def configured_previews_dir() -> Path | None:
    configured = str(os.getenv("MY_FILES_PREVIEWS_DIR", "") or "").strip()
    return Path(configured) if configured else None


def normalize_extension(extension: str) -> str:
    clean = str(extension or "").strip().lower()
    if clean and not clean.startswith("."):
        clean = f".{clean}"
    if len(clean) > 32:
        return ""
    return clean


def relative_blob_path(owner_user_id: int, sha256: str, extension: str) -> str:
    sha = str(sha256 or "").strip().lower()
    if len(sha) < 4:
        raise ValueError("sha256 is required for blob path")
    ext = normalize_extension(extension)
    owner = int(owner_user_id)
    return f"{owner}/my_files/blobs/{sha[:2]}/{sha[2:4]}/{sha}{ext}".replace("\\", "/")


def relative_preview_path(owner_user_id: int, blob_id: str, file_name: str) -> str:
    owner = int(owner_user_id)
    bid = str(blob_id or "").strip() or uuid.uuid4().hex
    suffix = Path(str(file_name or "preview.bin")).suffix.lower() or ".bin"
    if len(suffix) > 32:
        suffix = ".bin"
    return f"{owner}/my_files/previews/{bid[:2]}/{bid}/preview{suffix}".replace("\\", "/")


def resolve_under_root(root: Path, relative: str) -> Path:
    rel = str(relative or "").replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("Invalid storage relative path")
    absolute = (root / Path(rel)).resolve()
    root_resolved = root.resolve()
    try:
        absolute.relative_to(root_resolved)
    except ValueError as exc:
        raise ValueError("Storage path escapes root") from exc
    return absolute


def sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        while True:
            chunk = source.read(CHUNK_SIZE)
            if not chunk:
                break
            size += len(chunk)
            digest.update(chunk)
    return digest.hexdigest(), size


def _is_unc(path: Path) -> bool:
    text = str(path)
    return text.startswith("\\\\") or text.startswith("//")


def ensure_storage_ready(path: Path) -> None:
    if _is_unc(path) or (storage_v2_enabled() and hubit_storage_configured()):
        ensure_connected(path if _is_unc(path) else configured_storage_dir())


def ensure_free_space_for_path(required_bytes: int, *, path: Path) -> None:
    """Gate free space only for UNC / V2 network roots."""
    if not (_is_unc(path) or (storage_v2_enabled() and hubit_storage_configured())):
        return
    ensure_free_space(required_bytes, path=path)


def publish_local_to_blob(
    *,
    source: Path,
    destination: Path,
    expected_sha256: str,
    expected_size: int | None = None,
) -> Path:
    """Copy local file to destination via UNC-safe temp + verify + rename.

    Never uses Path.replace() across local→UNC.
    """
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(str(source))

    ensure_storage_ready(destination)
    ensure_free_space_for_path(int(source.stat().st_size), path=destination.parent)
    destination.parent.mkdir(parents=True, exist_ok=True)

    same_volume = False
    try:
        same_volume = source.resolve().anchor == destination.resolve().anchor and not _is_unc(destination)
    except Exception:
        same_volume = False

    # Same local volume: still prefer copy+verify for consistency when V2 enabled,
    # but allow replace only when destination is also local non-UNC.
    if same_volume and not _is_unc(source) and not _is_unc(destination):
        if destination.exists():
            source.unlink(missing_ok=True)
            return destination
        # copy+verify+replace locally for SHA guarantee
        tmp = destination.with_name(f"{destination.name}.tmp-{uuid.uuid4().hex}")
        try:
            with source.open("rb") as src, tmp.open("wb") as dst:
                shutil.copyfileobj(src, dst, CHUNK_SIZE)
                dst.flush()
                os.fsync(dst.fileno())
            digest, size = sha256_file(tmp)
            if expected_size is not None and int(size) != int(expected_size):
                raise ValueError("Published blob size mismatch")
            if digest.lower() != str(expected_sha256 or "").strip().lower():
                raise ValueError("Published blob SHA-256 mismatch")
            os.replace(tmp, destination)
            source.unlink(missing_ok=True)
            return destination
        finally:
            tmp.unlink(missing_ok=True)

    tmp = destination.with_name(f"{destination.name}.tmp-{uuid.uuid4().hex}")
    try:
        ensure_storage_ready(tmp)
        with source.open("rb") as src, tmp.open("wb") as dst:
            shutil.copyfileobj(src, dst, CHUNK_SIZE)
            dst.flush()
            try:
                os.fsync(dst.fileno())
            except OSError:
                # Some UNC providers reject fsync; size+sha checks remain mandatory.
                pass
        digest, size = sha256_file(tmp)
        if expected_size is not None and int(size) != int(expected_size):
            raise ValueError("Published blob size mismatch")
        if digest.lower() != str(expected_sha256 or "").strip().lower():
            raise ValueError("Published blob SHA-256 mismatch")
        # Atomic within the SMB share.
        os.replace(tmp, destination)
        source.unlink(missing_ok=True)
        return destination
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)
