"""Unit tests for 1C compact (D-lite) search — no production DB touches."""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.one_c_catalog_compact_docs import (  # noqa: E402
    build_and_prefix_tsquery,
    build_search_document_fields,
    escape_tsquery_token,
    hash_query_shape,
)
from backend.services.one_c_catalog_compact_flags import (  # noqa: E402
    ENGINE_COMPACT,
    ENGINE_TOKENS,
    canary_bucket,
    canary_selects_compact,
    parse_compact_flags,
    should_attempt_compact_reader,
)
from backend.services.one_c_catalog_compact_shadow import (  # noqa: E402
    compare_ref_lists,
    maybe_shadow_compare,
    pending_shadow_count,
    shutdown_shadow_executor,
)
from backend.services.one_c_catalog_compact_writer import (  # noqa: E402
    TOKEN_STATS_REBUILD_METRICS,
    OneCCatalogCompactWriter,
)
from backend.services.one_c_catalog_search import (  # noqa: E402
    catalog_entry_match_rank,
    catalog_index_tokens,
    catalog_query_tokens,
)


def test_flags_default_fail_closed_tokens():
    flags = parse_compact_flags({})
    assert flags.search_engine == ENGINE_TOKENS
    assert flags.search_shadow is False
    assert flags.write_compact is False
    assert flags.compact_backfill_enabled is False
    assert flags.typo_fallback_enabled is False
    assert flags.midtoken_min_length == 3
    assert flags.shadow_sample_rate == 0.0
    assert flags.search_canary_percent == 0
    assert flags.search_canary_allowlist == frozenset()


def test_flags_invalid_engine_never_enables_compact():
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "magic"})
    assert flags.search_engine == ENGINE_TOKENS
    assert flags.engine_config_error.startswith("invalid_engine:")
    assert flags.compact_reader_enabled is False
    assert should_attempt_compact_reader(flags, routing_user_key="u1") is False


def test_flags_compact_only_when_explicit():
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact"})
    assert flags.search_engine == ENGINE_COMPACT
    assert flags.compact_reader_enabled is True
    assert flags.engine_config_error == ""


def test_document_includes_model_compact_and_yo():
    fields = build_search_document_fields("M-70", "Алёна UPS")
    assert "m70" in fields["tokens"]
    assert "алена" in fields["search_text"]
    assert fields["code_normalized"] == "m-70"


def test_query_tokens_m70_equivalence():
    assert catalog_query_tokens("m70") == ["m70"]
    assert catalog_query_tokens("m-70") == ["m70"]
    assert catalog_query_tokens("M 70") == ["m70"]
    for code, name in (("M-70", "Smart"), ("M 70", "Smart")):
        assert catalog_entry_match_rank(code, name, ["m70"]) == 0


def test_tsquery_escape_and_prefix_and():
    from backend.services.one_c_catalog_compact_docs import build_and_tsquery

    assert escape_tsquery_token("m70!;") == "m70"
    assert build_and_prefix_tsquery(["ippon", "800"]) == "ippon:* & 800:*"
    assert build_and_prefix_tsquery(["x"]) is None
    assert build_and_tsquery(["ippon"], prefix=False) == "ippon"
    assert build_and_tsquery(["pp"], prefix=False) == "pp:*"


def test_two_char_product_rule_helpers():
    tokens = catalog_query_tokens("pp")
    assert tokens == ["pp"]
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_MIDTOKEN_MIN_LENGTH": "3"})
    assert all(len(t) < flags.midtoken_min_length for t in tokens)


def test_multi_word_and_rank():
    tokens = catalog_query_tokens("Ippon 800")
    assert tokens == ["ippon", "800"]
    assert catalog_entry_match_rank("PN-1", "Ippon Back Basic 800", tokens) == 0
    assert catalog_entry_match_rank("PN-2", "Ippon Back Basic 650", tokens) is None


def test_midtoken_from_three_chars():
    tokens = catalog_query_tokens("ppo")
    assert tokens == ["ppo"]
    assert catalog_entry_match_rank("PN-1", "Ippon Back", tokens) == 2


def test_query_shape_hash_has_no_raw_text():
    shape = hash_query_shape("секретный код", catalog_type="nomenclature", tokens=["секретный", "код"])
    assert "секрет" not in shape
    assert len(shape) == 16


def test_shadow_compare_ref_lists():
    missing, extra, swaps = compare_ref_lists(["a", "b", "c"], ["a", "c", "b"])
    assert missing == 0
    assert extra == 0
    assert swaps == 2


def test_index_tokens_reused_for_document():
    tokens = catalog_index_tokens("APC Smart-UPS 700")
    fields = build_search_document_fields("APC-1", "APC Smart-UPS 700")
    for token in tokens:
        assert token in fields["search_text"]
        assert token in fields["tsv_source"].split()


# --- Canary router (unit) ---


@pytest.mark.parametrize("percent,key,expect", [
    (0, "user-a", False),
    (100, "user-a", True),
    (100, "", False),  # fail-closed without key
    (1, "user-stable", canary_bucket("user-stable") < 1),
    (50, "user-stable", canary_bucket("user-stable") < 50),
])
def test_canary_percent_matrix(percent, key, expect):
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "tokens",
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": str(percent),
        }
    )
    assert canary_selects_compact(key or None, flags) is expect


def test_canary_invalid_percent_clamped():
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "999"})
    assert flags.search_canary_percent == 100
    flags_neg = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "abc"})
    assert flags_neg.search_canary_percent == 0


def test_canary_deterministic_stable():
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "50"})
    a = [canary_selects_compact("same-user", flags) for _ in range(20)]
    assert len(set(a)) == 1
    assert canary_bucket("same-user") == canary_bucket("same-user")


def test_canary_allowlist_and_no_raw_id_in_bucket_api():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "0",
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_ALLOWLIST": "admin-key-1,admin-key-2",
        }
    )
    assert canary_selects_compact("admin-key-1", flags) is True
    assert canary_selects_compact("other", flags) is False
    # bucket API returns int only — callers must not log raw keys
    assert isinstance(canary_bucket("admin-key-1"), int)


def test_canary_rollback_percent_zero():
    flags = parse_compact_flags({"WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "0"})
    assert canary_selects_compact("user-a", flags) is False
    assert should_attempt_compact_reader(flags, routing_user_key="user-a") is False


def test_engine_compact_ignores_canary_gate():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_ENGINE": "compact",
            "WAREHOUSE_1C_CATALOG_SEARCH_CANARY_PERCENT": "0",
        }
    )
    assert should_attempt_compact_reader(flags, routing_user_key=None) is True


# --- Shadow thread-safety (unit, mocked) ---


def test_shadow_timeout_user_gets_primary():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS": "50",
        }
    )

    def slow():
        time.sleep(0.5)
        return MagicMock(rows=[{"ref": "x"}], latency_ms=500, stage="fts", error="")

    result = maybe_shadow_compare(
        catalog_type="nomenclature",
        text_query="Ippon",
        primary_rows=[{"ref": "nom-1"}],
        primary_latency_ms=5.0,
        compact_search=slow,
        flags=flags,
    )
    assert result.sampled is True
    assert result.timed_out is True
    assert result.primary_top_n == ["nom-1"]
    time.sleep(0.6)  # let worker finish / release slot


def test_shadow_error_never_breaks_primary():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS": "500",
        }
    )

    def boom():
        raise RuntimeError("pg_down")

    result = maybe_shadow_compare(
        catalog_type="nomenclature",
        text_query="Ippon",
        primary_rows=[{"ref": "nom-1"}],
        primary_latency_ms=3.0,
        compact_search=boom,
        flags=flags,
    )
    assert result.error == "RuntimeError"
    assert result.compared is False
    assert result.primary_top_n == ["nom-1"]


def test_shadow_queue_full_skips():
    import backend.services.one_c_catalog_compact_shadow as shadow_mod

    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS": "200",
        }
    )
    gate = threading.Event()

    def blocker():
        gate.wait(2.0)
        return MagicMock(rows=[], latency_ms=1, stage="empty", error="")

    # Fill pending slots
    original_max = shadow_mod._SHADOW_MAX_PENDING
    shadow_mod._SHADOW_MAX_PENDING = 2
    try:
        r1 = maybe_shadow_compare(
            catalog_type="nomenclature",
            text_query="a",
            primary_rows=[{"ref": "1"}],
            primary_latency_ms=1,
            compact_search=blocker,
            flags=flags,
        )
        r2 = maybe_shadow_compare(
            catalog_type="nomenclature",
            text_query="b",
            primary_rows=[{"ref": "1"}],
            primary_latency_ms=1,
            compact_search=blocker,
            flags=flags,
        )
        r3 = maybe_shadow_compare(
            catalog_type="nomenclature",
            text_query="c",
            primary_rows=[{"ref": "1"}],
            primary_latency_ms=1,
            compact_search=blocker,
            flags=flags,
        )
        assert r1.sampled and r2.sampled
        assert r3.skipped_queue_full is True
        assert r3.error == "queue_full"
        assert r3.primary_top_n == ["1"]
    finally:
        gate.set()
        time.sleep(0.3)
        shadow_mod._SHADOW_MAX_PENDING = original_max


def test_shadow_two_parallel_ok():
    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_TIMEOUT_MS": "1000",
        }
    )
    results = []

    def work(label):
        def _c():
            time.sleep(0.05)
            return MagicMock(
                rows=[{"ref": label}],
                latency_ms=50,
                stage="fts",
                error="",
                shadow_backend_pid=1000 + ord(label[0]),
            )

        results.append(
            maybe_shadow_compare(
                catalog_type="nomenclature",
                text_query=label,
                primary_rows=[{"ref": label}],
                primary_latency_ms=1,
                compact_search=_c,
                flags=flags,
            )
        )

    t1 = threading.Thread(target=work, args=("a",))
    t2 = threading.Thread(target=work, args=("b",))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    assert len(results) == 2
    assert all(r.compared for r in results)


def test_shadow_shutdown_closes_executor():
    # Ensure shutdown is callable; restore a fresh executor for other tests.
    import backend.services.one_c_catalog_compact_shadow as shadow_mod
    from concurrent.futures import ThreadPoolExecutor

    shutdown_shadow_executor(wait=True)
    assert shadow_mod._get_executor() is None
    with shadow_mod._executor_lock:
        shadow_mod._executor = ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="one_c_compact_shadow"
        )


# --- Token stats rebuild call-site discipline (unit) ---


def test_rebuild_token_stats_not_called_when_disabled():
    writer = OneCCatalogCompactWriter(enabled=False)
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"
    assert writer.rebuild_token_stats(
        session, source_base="buh20", generation=1, catalog_type="nomenclature"
    ) == 0
    session.execute.assert_not_called()


def test_sync_scope_safe_one_rebuild_per_completed_patch():
    writer = OneCCatalogCompactWriter(enabled=True)
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"

    with patch.object(
        writer,
        "apply_incremental_patch",
        return_value=MagicMock(ok=True, outcome="applied"),
    ) as apply:
        ok = writer.sync_scope_safe(
            session,
            source_base="buh20",
            generation=1,
            catalog_type="nomenclature",
            upserts=[("r1", "C1", "Name")],
            deletes=[],
            expected_count=1,
            catalog_fingerprint="fp1",
            sync_id="sync-1",
        )
    assert ok is True
    apply.assert_called_once()
    applied = apply.call_args.kwargs["patch"]
    assert applied.upserts == (("r1", "C1", "Name"),)
    assert applied.catalog_fingerprint == "fp1"


def test_apply_incremental_patch_idempotent_same_sync_id():
    from backend.services.one_c_catalog_compact_writer import CompactCatalogPatch

    writer = OneCCatalogCompactWriter(enabled=True)
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"
    with patch.object(writer, "_try_advisory_lock", return_value=True), patch.object(
        writer, "_advisory_unlock"
    ), patch.object(
        writer,
        "_read_active_state",
        return_value={
            "status": "ready",
            "active_index_version": 1,
            "source_fingerprint": "fp1",
            "checkpoint_ref": "sync-1",
            "previous_index_version": 0,
        },
    ), patch.object(writer, "upsert_documents") as up:
        report = writer.apply_incremental_patch(
            session,
            source_base="buh20",
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type="nomenclature",
                upserts=(("r1", "C1", "Name"),),
                expected_count=1,
                catalog_fingerprint="fp1",
                sync_id="sync-1",
            ),
        )
    assert report.ok is True
    assert report.outcome == "noop"
    up.assert_not_called()


def test_apply_incremental_patch_touches_only_changed_refs():
    from backend.services.one_c_catalog_compact_writer import CompactCatalogPatch

    writer = OneCCatalogCompactWriter(enabled=True)
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"
    with patch.object(writer, "_try_advisory_lock", return_value=True), patch.object(
        writer, "_advisory_unlock"
    ), patch.object(
        writer,
        "_read_active_state",
        return_value={
            "status": "ready",
            "active_index_version": 2,
            "source_fingerprint": "old",
            "checkpoint_ref": "",
            "previous_index_version": 1,
        },
    ), patch.object(writer, "_load_doc_token_sets", return_value={}), patch.object(
        writer, "delete_documents", return_value=0
    ) as delete, patch.object(
        writer, "upsert_documents", return_value=2
    ) as upsert, patch.object(
        writer, "_apply_token_stats_delta_safe", return_value=(3, "delta")
    ), patch.object(
        writer, "refresh_state_counts", return_value=1
    ) as refresh, patch.object(
        writer, "_drop_index_version"
    ) as drop_prev:
        report = writer.apply_incremental_patch(
            session,
            source_base="buh20",
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type="nomenclature",
                upserts=(("a", "A", "One"), ("b", "B", "Two")),
                deletes=(),
                expected_count=100_000,
                changed_count=2,
                incoming_count=100_000,
                catalog_fingerprint="fp2",
                base_fingerprint="old",
                sync_id="sync-2",
            ),
        )
    assert report.ok is True
    assert report.outcome == "applied"
    assert report.documents_upserted == 2
    assert report.documents_untouched_estimate == 99_998
    upsert.assert_called_once()
    assert len(list(upsert.call_args.kwargs["entries"])) == 2
    delete.assert_called_once()
    refresh.assert_called_once()
    assert refresh.call_args.kwargs.get("schedule_previous_cleanup") is True
    assert refresh.call_args.kwargs.get("invalidate_previous", False) is False
    drop_prev.assert_not_called()


def test_apply_incremental_patch_cas_out_of_order():
    from backend.services.one_c_catalog_compact_writer import CompactCatalogPatch

    writer = OneCCatalogCompactWriter(enabled=True)
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"
    with patch.object(writer, "_try_advisory_lock", return_value=True), patch.object(
        writer, "_advisory_unlock"
    ), patch.object(
        writer,
        "_read_active_state",
        return_value={
            "status": "ready",
            "active_index_version": 1,
            "source_fingerprint": "fp3",
            "checkpoint_ref": "sync-3",
            "previous_index_version": 0,
        },
    ), patch.object(writer, "upsert_documents") as up:
        report = writer.apply_incremental_patch(
            session,
            source_base="buh20",
            generation=1,
            patch=CompactCatalogPatch(
                catalog_type="nomenclature",
                upserts=(("a", "A", "One"),),
                expected_count=1,
                catalog_fingerprint="fp2",
                base_fingerprint="fp1",
                sync_id="sync-2-late",
            ),
        )
    assert report.ok is True
    assert report.outcome == "out_of_order"
    up.assert_not_called()


def test_cleanup_service_fail_closed_defaults():
    from backend.services.one_c_catalog_compact_cleanup import (
        OneCCatalogCompactCleanupService,
    )
    from backend.services.one_c_catalog_compact_flags import parse_compact_flags

    flags = parse_compact_flags({})
    assert flags.compact_previous_cleanup_enabled is False
    assert flags.compact_previous_cleanup_dry_run is True
    svc = OneCCatalogCompactCleanupService()
    assert svc.enabled is False
    assert svc.dry_run is True
    session = MagicMock()
    session.get_bind.return_value.dialect.name = "postgresql"
    report = svc.run_once(session)
    assert report.outcome == "disabled"


def test_flags_incremental_thresholds_defaults():
    flags = parse_compact_flags({})
    assert flags.compact_incremental_max_changed_rows == 50_000
    assert flags.compact_incremental_max_changed_percent == 5.0
    assert flags.compact_incremental_percent_min_base == 10_000
    assert flags.compact_token_stats_mode == "delta"
    assert flags.write_compact is False


def test_threshold_ignores_percent_on_tiny_catalogs():
    from backend.services.one_c_catalog_compact_writer import (
        CompactCatalogPatch,
        OneCCatalogCompactWriter,
    )

    writer = OneCCatalogCompactWriter(enabled=True)
    tiny = CompactCatalogPatch(
        catalog_type="nomenclature",
        upserts=(("r1", "C1", "N"),),
        changed_count=1,
        incoming_count=9,
        expected_count=9,
    )
    assert writer._threshold_exceeded(tiny) is False
    huge = CompactCatalogPatch(
        catalog_type="nomenclature",
        upserts=tuple((f"r{i}", "C", "N") for i in range(100)),
        changed_count=60_000,
        incoming_count=700_000,
        expected_count=700_000,
    )
    assert writer._threshold_exceeded(huge) is True


def test_query_shape_never_contains_raw_query_in_shadow_logs(caplog):
    import logging

    flags = parse_compact_flags(
        {
            "WAREHOUSE_1C_CATALOG_SEARCH_SHADOW": "1",
            "WAREHOUSE_1C_CATALOG_SHADOW_SAMPLE_RATE": "1",
        }
    )
    secret = "СУПЕРСЕКРЕТНЫЙ-КОД-999"
    with caplog.at_level(logging.INFO):
        maybe_shadow_compare(
            catalog_type="nomenclature",
            text_query=secret,
            primary_rows=[{"ref": "nom-1"}],
            primary_latency_ms=1,
            compact_search=lambda: MagicMock(
                rows=[{"ref": "nom-1"}], latency_ms=1, stage="exact_code", error=""
            ),
            flags=flags,
        )
    joined = " ".join(r.message for r in caplog.records)
    assert secret not in joined
    assert "СУПЕР" not in joined

