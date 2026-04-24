from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = PROJECT_ROOT / "scripts" / "loadtest_mail_50_users.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("mail_loadtest_script", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_percentile_ms_interpolates_expected_value():
    module = _load_module()

    result = module.percentile_ms([100.0, 200.0, 300.0, 400.0], 95)

    assert result == 385.0


def test_build_report_evaluates_mail_slos():
    module = _load_module()
    stats = module.RunStats()
    stats.request_count = 10
    stats.error_count = 0
    stats.scenario_loops = 3
    stats.finished_at = stats.started_at + 30.0
    stats.timings_ms["bootstrap_cold"] = [3500.0]
    stats.timings_ms["bootstrap_warm"] = [800.0, 900.0]
    stats.timings_ms["list_cold"] = [2200.0]
    stats.timings_ms["list_warm"] = [500.0, 600.0]
    stats.timings_ms["detail"] = [300.0]
    stats.timings_ms["mark_read"] = [250.0]
    stats.rss_samples_mb = [512.0, 540.0]

    report = module.build_report(
        stats,
        SimpleNamespace(
            api_base="http://127.0.0.1:8001/api/v1",
            virtual_users=50,
            duration_sec=900,
            think_time_sec=2.0,
            mailbox_id="",
        ),
    )

    assert report["slos"]["error_rate_lt_1pct"] is True
    assert report["slos"]["bootstrap_p95_cold_le_4000ms"] is True
    assert report["slos"]["bootstrap_p95_warm_le_1500ms"] is True
    assert report["slos"]["list_p95_cold_le_2500ms"] is True
    assert report["slos"]["list_p95_warm_le_800ms"] is True
    assert report["slos"]["rss_not_growing_continuously"] is True
