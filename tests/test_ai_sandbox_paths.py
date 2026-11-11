from __future__ import annotations

import io
import os
import sys
import zipfile
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.ai_sandbox.contracts import CleanAttachment, WorkspaceLease  # noqa: E402
from backend.ai_sandbox.paths import (  # noqa: E402
    SandboxPathError,
    UnsafeArchiveError,
    inspect_archive,
    inspect_workspace_tree,
    normalize_upload_name,
    resolve_workspace_path,
    stage_clean_attachment,
    validate_workspace_lease,
)


def test_upload_name_normalization_rejects_paths() -> None:
    assert normalize_upload_name("Отчёт 2026?.xlsx") == "Отчёт 2026_.xlsx"
    assert normalize_upload_name("CON") == "_CON"
    for value in ("../secret.txt", "folder/file.txt", r"folder\file.txt", "..", ""):
        with pytest.raises(SandboxPathError):
            normalize_upload_name(value)


def test_workspace_paths_reject_traversal_and_symlinks(tmp_path: Path) -> None:
    workspace = tmp_path / "workspaces" / "session-1"
    workspace.mkdir(parents=True)
    (workspace / "safe").mkdir()

    assert resolve_workspace_path(workspace, "safe/result.txt") == workspace / "safe" / "result.txt"
    with pytest.raises(SandboxPathError):
        resolve_workspace_path(workspace, "../outside.txt")
    with pytest.raises(SandboxPathError):
        resolve_workspace_path(workspace, "/etc/passwd")

    link = workspace / "link"
    try:
        link.symlink_to(tmp_path)
    except OSError:
        pytest.skip("Symlink creation is not available to this test user")
    with pytest.raises(SandboxPathError, match="Symlinks"):
        resolve_workspace_path(workspace, "link/secret.txt")
    with pytest.raises(SandboxPathError, match="Symlinks"):
        inspect_workspace_tree(workspace, maximum_bytes=1024)


def test_workspace_lease_requires_verified_quota_and_forbids_hub_root(tmp_path: Path) -> None:
    workspace_root = tmp_path / "workspaces"
    workspace = workspace_root / "session-1"
    workspace.mkdir(parents=True)
    valid = WorkspaceLease(session_id="session-1", path=workspace, quota_bytes=1024**3, quota_verified=True)
    assert validate_workspace_lease(
        valid,
        workspace_root=workspace_root,
        forbidden_roots=(tmp_path / "hub-repo",),
        maximum_quota_bytes=1024**3,
    ) == workspace.resolve()

    unverified = WorkspaceLease(session_id="session-1", path=workspace, quota_bytes=1024**3, quota_verified=False)
    with pytest.raises(SandboxPathError, match="quota"):
        validate_workspace_lease(
            unverified,
            workspace_root=workspace_root,
            forbidden_roots=(),
            maximum_quota_bytes=1024**3,
        )

    hub_workspace = workspace_root / "hub-repo" / "session"
    hub_workspace.mkdir(parents=True)
    with pytest.raises(SandboxPathError, match="forbidden"):
        validate_workspace_lease(
            WorkspaceLease("session", hub_workspace, 1024, True),
            workspace_root=workspace_root,
            forbidden_roots=(workspace_root / "hub-repo",),
            maximum_quota_bytes=1024**3,
        )


def test_only_owned_antivirus_clean_attachment_is_staged(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    source = tmp_path / "source.txt"
    source.write_text("safe", encoding="utf-8")
    attachment = CleanAttachment(
        attachment_id="attachment-1",
        conversation_id="conversation-1",
        owner_user_id=7,
        source_path=source,
        original_name="input.txt",
        size_bytes=source.stat().st_size,
        antivirus_status="clean",
    )
    staged = stage_clean_attachment(
        attachment,
        expected_user_id=7,
        expected_conversation_id="conversation-1",
        workspace=workspace,
    )
    assert staged == workspace / "input" / "input.txt"
    assert staged.read_text(encoding="utf-8") == "safe"

    with pytest.raises(SandboxPathError, match="belong"):
        stage_clean_attachment(
            attachment,
            expected_user_id=8,
            expected_conversation_id="conversation-1",
            workspace=workspace,
        )


def test_archive_inspection_rejects_traversal_and_zip_bomb(tmp_path: Path) -> None:
    traversal = tmp_path / "traversal.zip"
    with zipfile.ZipFile(traversal, "w") as archive:
        archive.writestr("../outside.txt", "no")
    with pytest.raises(UnsafeArchiveError, match="path"):
        inspect_archive(traversal)

    bomb = tmp_path / "bomb.zip"
    with zipfile.ZipFile(bomb, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("zeros.bin", b"0" * (2 * 1024 * 1024))
    with pytest.raises(UnsafeArchiveError, match="compression ratio"):
        inspect_archive(bomb)


def test_workspace_cannot_override_runtime_config(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "opencode.json").write_text("{}", encoding="utf-8")
    with pytest.raises(SandboxPathError, match="runtime configuration"):
        inspect_workspace_tree(workspace, maximum_bytes=1024)

