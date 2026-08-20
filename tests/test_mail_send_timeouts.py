from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_send_timeouts import (
    DEFAULT_SEND_WAIT_FOR_SEC,
    MAX_SEND_WAIT_FOR_SEC,
    increment_ambiguous_send,
    mail_send_timeout_metrics,
    mail_send_wait_for_sec,
    record_mail_send_timing,
    reset_mail_send_timeout_metrics,
)


def test_wait_for_defaults_and_clamps_below_iis_budget():
    assert mail_send_wait_for_sec("") == DEFAULT_SEND_WAIT_FOR_SEC
    assert mail_send_wait_for_sec("110") == 110.0
    assert mail_send_wait_for_sec("200") == MAX_SEND_WAIT_FOR_SEC
    assert mail_send_wait_for_sec("not-a-number") == DEFAULT_SEND_WAIT_FOR_SEC


def test_send_timing_snapshot_includes_p95_and_ambiguous_rate():
    reset_mail_send_timeout_metrics()
    for value in (10.0, 20.0, 30.0, 40.0, 50.0):
        record_mail_send_timing(value)
    increment_ambiguous_send()
    snapshot = mail_send_timeout_metrics()
    assert snapshot["send_count"] == 5
    assert snapshot["send_p95_ms"] >= 40.0
    assert snapshot["ambiguous_send"] == 1
    assert snapshot["ambiguous_send_rate"] == 0.2
    reset_mail_send_timeout_metrics()
