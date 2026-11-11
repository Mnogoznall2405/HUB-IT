"""Unit tests for compact backfill CLI prod allow gate (no DB mutate)."""
from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "one_c_catalog_compact_backfill.py"


def _load():
    spec = importlib.util.spec_from_file_location("one_c_compact_backfill_cli", SCRIPT)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_assert_safe_rejects_hubit_chat_without_allow_prod():
    mod = _load()
    with pytest.raises(SystemExit) as exc:
        mod._assert_safe("postgresql://u:p@127.0.0.1:5432/hubit_chat", allow_prod=False)
    assert "allow-prod" in str(exc.value).lower() or "non-allowed" in str(exc.value).lower()


def test_assert_safe_rejects_cluster_templates_even_with_allow_prod():
    mod = _load()
    for name in ("postgres", "template0", "template1"):
        with pytest.raises(SystemExit) as exc:
            mod._assert_safe(f"postgresql://u:p@127.0.0.1:5432/{name}", allow_prod=True)
        assert "template" in str(exc.value).lower() or "REFUSED" in str(exc.value)


def test_assert_safe_allow_prod_rejects_non_prod_name():
    mod = _load()
    with pytest.raises(SystemExit) as exc:
        mod._assert_safe(
            "postgresql://u:p@127.0.0.1:5432/hubit_chat_retention_test_x",
            allow_prod=True,
        )
    assert "only permits" in str(exc.value).lower() or "REFUSED" in str(exc.value)
