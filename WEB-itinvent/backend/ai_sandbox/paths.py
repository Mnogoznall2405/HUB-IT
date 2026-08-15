from __future__ import annotations

import os
import re
import shutil
import stat
import tarfile
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .contracts import CleanAttachment, WorkspaceLease


_SAFE_FILENAME_RE = re.compile(r"[^\w.()\- ]+", re.UNICODE)
_WINDOWS_RESERVED_NAMES = {
    "con",
    "prn",
    "aux",
    "nul",
    *(f"com{index}" for index in range(1, 10)),
    *(f"lpt{index}" for index in range(1, 10)),
}


class SandboxPathError(ValueError):
    """Raised when a path could escape or weaken workspace isolation."""


class UnsafeArchiveError(SandboxPathError):
    """Raised when an archive is too large or contains unsafe members."""


@dataclass(frozen=True)
class ArchiveLimits:
    max_files: int = 2_000
    max_total_uncompressed_bytes: int = 512 * 1024**2
    max_member_uncompressed_bytes: int = 128 * 1024**2
    max_compression_ratio: int = 100


@dataclass(frozen=True)
class ArchiveInspection:
    files: int
    total_uncompressed_bytes: int


@dataclass(frozen=True)
class WorkspaceInspection:
    files: int
    total_bytes: int


_RESERVED_ROOT_ENTRIES = frozenset({".opencode", "opencode.json", "opencode.jsonc"})


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def normalize_upload_name(value: str, *, max_length: int = 160) -> str:
    original = unicodedata.normalize("NFKC", str(value or "")).strip()
    if not original or "\x00" in original:
        raise SandboxPathError("Attachment name is empty or invalid")
    if "/" in original or "\\" in original or original in {".", ".."}:
        raise SandboxPathError("Attachment name must not contain a path")

    normalized = _SAFE_FILENAME_RE.sub("_", original).strip(" .")
    if not normalized:
        raise SandboxPathError("Attachment name has no safe characters")
    stem = normalized.split(".", 1)[0].lower()
    if stem in _WINDOWS_RESERVED_NAMES:
        normalized = f"_{normalized}"
    if len(normalized) > max_length:
        suffix = Path(normalized).suffix[:20]
        normalized = normalized[: max_length - len(suffix)].rstrip(" .") + suffix
    return normalized


def validate_workspace_lease(
    lease: WorkspaceLease,
    *,
    workspace_root: Path,
    forbidden_roots: tuple[Path, ...],
    maximum_quota_bytes: int,
) -> Path:
    root = workspace_root.resolve(strict=True)
    if workspace_root.is_symlink():
        raise SandboxPathError("Workspace root must not be a symlink")
    if lease.path.is_symlink():
        raise SandboxPathError("Workspace must not be a symlink")
    workspace = lease.path.resolve(strict=True)
    if workspace == root or not _is_relative_to(workspace, root):
        raise SandboxPathError("Workspace is outside the configured workspace root")
    if not lease.quota_verified or not (0 < lease.quota_bytes <= maximum_quota_bytes):
        raise SandboxPathError("Workspace requires an enforced quota no larger than 1 GiB")
    for forbidden in forbidden_roots:
        resolved_forbidden = forbidden.resolve(strict=False)
        if (
            workspace == resolved_forbidden
            or _is_relative_to(workspace, resolved_forbidden)
            or _is_relative_to(resolved_forbidden, workspace)
        ):
            raise SandboxPathError("Workspace overlaps a forbidden host path")
    return workspace


def inspect_workspace_tree(
    workspace: Path,
    *,
    maximum_bytes: int,
    maximum_files: int = 20_000,
) -> WorkspaceInspection:
    """Validate the tree before start and before exporting any result."""

    root = workspace.resolve(strict=True)
    if workspace.is_symlink():
        raise SandboxPathError("Workspace must not be a symlink")
    files = 0
    total_bytes = 0
    for entry in root.rglob("*"):
        relative = entry.relative_to(root)
        if relative.parts and relative.parts[0].lower() in _RESERVED_ROOT_ENTRIES:
            raise SandboxPathError("Workspace may not override OpenCode runtime configuration")
        entry_stat = entry.lstat()
        if stat.S_ISLNK(entry_stat.st_mode):
            raise SandboxPathError("Symlinks are forbidden in a workspace")
        if stat.S_ISDIR(entry_stat.st_mode):
            continue
        if not stat.S_ISREG(entry_stat.st_mode):
            raise SandboxPathError("Workspace contains a non-regular file")
        if entry_stat.st_nlink > 1:
            raise SandboxPathError("Hard links are forbidden in a workspace")
        files += 1
        total_bytes += entry_stat.st_size
        if files > maximum_files or total_bytes > maximum_bytes:
            raise SandboxPathError("Workspace exceeds its enforced limits")
    return WorkspaceInspection(files=files, total_bytes=total_bytes)


def resolve_workspace_path(workspace: Path, relative_name: str, *, must_exist: bool = False) -> Path:
    raw = str(relative_name or "")
    candidate_posix = PurePosixPath(raw.replace("\\", "/"))
    if not raw or candidate_posix.is_absolute() or any(part in {"", ".", ".."} for part in candidate_posix.parts):
        raise SandboxPathError("Path must be a normalized relative workspace path")

    root = workspace.resolve(strict=True)
    candidate = root.joinpath(*candidate_posix.parts)
    current = root
    for part in candidate_posix.parts:
        current = current / part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            if must_exist:
                raise SandboxPathError("Workspace path does not exist") from None
            break
        if stat.S_ISLNK(mode):
            raise SandboxPathError("Symlinks are forbidden in a workspace")
    resolved = candidate.resolve(strict=must_exist)
    if not _is_relative_to(resolved, root):
        raise SandboxPathError("Path escapes the workspace")
    return candidate


def stage_clean_attachment(
    attachment: CleanAttachment,
    *,
    expected_user_id: int,
    expected_conversation_id: str,
    workspace: Path,
    destination_directory: str = "input",
    maximum_bytes: int = 256 * 1024**2,
) -> Path:
    if attachment.owner_user_id != expected_user_id or attachment.conversation_id != expected_conversation_id:
        raise SandboxPathError("Attachment does not belong to this user and conversation")
    if attachment.antivirus_status.strip().lower() != "clean":
        raise SandboxPathError("Only antivirus-clean attachments may enter a workspace")
    if not (0 <= attachment.size_bytes <= maximum_bytes):
        raise SandboxPathError("Attachment exceeds the sandbox input limit")

    source_stat = attachment.source_path.lstat()
    if stat.S_ISLNK(source_stat.st_mode) or not stat.S_ISREG(source_stat.st_mode):
        raise SandboxPathError("Attachment source must be a regular non-symlink file")
    if source_stat.st_size != attachment.size_bytes:
        raise SandboxPathError("Attachment size changed after validation")

    safe_name = normalize_upload_name(attachment.original_name)
    destination = resolve_workspace_path(workspace, f"{destination_directory}/{safe_name}")
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if destination.exists():
        raise SandboxPathError("Attachment destination already exists")

    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
    source_fd = os.open(attachment.source_path, flags)
    try:
        opened_stat = os.fstat(source_fd)
        if (
            not stat.S_ISREG(opened_stat.st_mode)
            or opened_stat.st_size != source_stat.st_size
            or opened_stat.st_ino != source_stat.st_ino
            or opened_stat.st_dev != source_stat.st_dev
        ):
            raise SandboxPathError("Attachment source changed during staging")
        with os.fdopen(source_fd, "rb", closefd=False) as source_handle:
            destination_flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
            destination_fd = os.open(destination, destination_flags, 0o600)
            with os.fdopen(destination_fd, "wb") as destination_handle:
                shutil.copyfileobj(source_handle, destination_handle, length=1024 * 1024)
    finally:
        os.close(source_fd)
    os.chmod(destination, 0o600)
    return destination


def _validate_archive_member_name(name: str) -> None:
    normalized = PurePosixPath(str(name or "").replace("\\", "/"))
    if not name or normalized.is_absolute() or any(part in {"", ".", ".."} for part in normalized.parts):
        raise UnsafeArchiveError(f"Unsafe archive member path: {name!r}")


def inspect_archive(path: Path, *, limits: ArchiveLimits = ArchiveLimits()) -> ArchiveInspection:
    source = path.resolve(strict=True)
    source_stat = source.lstat()
    if stat.S_ISLNK(source_stat.st_mode) or not stat.S_ISREG(source_stat.st_mode):
        raise UnsafeArchiveError("Archive must be a regular non-symlink file")

    file_count = 0
    total_size = 0
    if zipfile.is_zipfile(source):
        with zipfile.ZipFile(source) as archive:
            for member in archive.infolist():
                _validate_archive_member_name(member.filename)
                unix_mode = member.external_attr >> 16
                if stat.S_ISLNK(unix_mode):
                    raise UnsafeArchiveError("Archive symlinks are forbidden")
                if member.is_dir():
                    continue
                file_count += 1
                total_size += member.file_size
                if member.file_size > limits.max_member_uncompressed_bytes:
                    raise UnsafeArchiveError("Archive member exceeds the per-file limit")
                compressed = max(member.compress_size, 1)
                if member.file_size > 1024 * 1024 and member.file_size / compressed > limits.max_compression_ratio:
                    raise UnsafeArchiveError("Suspicious archive compression ratio")
                if file_count > limits.max_files or total_size > limits.max_total_uncompressed_bytes:
                    raise UnsafeArchiveError("Archive exceeds extraction limits")
    elif tarfile.is_tarfile(source):
        with tarfile.open(source, mode="r:*") as archive:
            for member in archive:
                _validate_archive_member_name(member.name)
                if member.issym() or member.islnk() or member.isdev() or member.isfifo():
                    raise UnsafeArchiveError("Archive links and special files are forbidden")
                if member.isdir():
                    continue
                if not member.isfile():
                    raise UnsafeArchiveError("Unsupported archive member type")
                file_count += 1
                total_size += member.size
                if member.size > limits.max_member_uncompressed_bytes:
                    raise UnsafeArchiveError("Archive member exceeds the per-file limit")
                if file_count > limits.max_files or total_size > limits.max_total_uncompressed_bytes:
                    raise UnsafeArchiveError("Archive exceeds extraction limits")
    else:
        raise UnsafeArchiveError("Only ZIP and TAR archives are supported")

    return ArchiveInspection(files=file_count, total_uncompressed_bytes=total_size)


def inspect_archive_if_present(path: Path, *, limits: ArchiveLimits = ArchiveLimits()) -> ArchiveInspection | None:
    """Inspect ZIP/TAR inputs by content while leaving ordinary files alone."""

    source = path.resolve(strict=True)
    if not zipfile.is_zipfile(source) and not tarfile.is_tarfile(source):
        return None
    return inspect_archive(source, limits=limits)
