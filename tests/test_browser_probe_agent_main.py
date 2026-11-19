"""browser_probe_agent entrypoint: output-dir fallback and no-dialog exits."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import browser_probe_agent as bpa  # noqa: E402


def test_resolve_output_dir_prefers_primary(tmp_path: Path, monkeypatch):
    primary = tmp_path / "pd" / "BrowserProbe"
    monkeypatch.setattr(bpa, "_default_output", lambda: primary)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    assert bpa._resolve_output_dir(None) == primary.resolve()


def test_resolve_output_dir_falls_back_for_denied_primary(tmp_path: Path, monkeypatch):
    """A user without a BrowserProbe ACL grant (audit H-7 hardened ACL is
    per-install-user) must land on a per-user dir instead of crashing."""
    primary = tmp_path / "pd" / "BrowserProbe"
    fallback = (tmp_path / "local" / "HUB-IT" / "BrowserProbe").resolve()
    monkeypatch.setattr(bpa, "_default_output", lambda: primary)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    monkeypatch.setattr(bpa, "_dir_writable", lambda p: p != primary)
    assert bpa._resolve_output_dir(None) == fallback


def test_resolve_output_dir_explicit_arg_wins(tmp_path: Path):
    explicit = tmp_path / "custom"
    assert bpa._resolve_output_dir(explicit) == explicit.resolve()


def test_main_returns_error_without_dialog_on_unwritable_dir(tmp_path: Path, monkeypatch, capsys):
    """PermissionError on the lock must be a clean exit code, not a
    cx_Freeze traceback dialog on the user's screen."""
    blocker = tmp_path / "blocker"
    blocker.write_text("x")
    monkeypatch.setattr(bpa, "_resolve_output_dir", lambda _a: blocker / "sub")
    assert bpa.main(["--output", "ignored"]) == 1
    assert "cannot use output dir" in capsys.readouterr().err
