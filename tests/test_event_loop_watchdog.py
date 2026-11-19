from __future__ import annotations

import importlib
import logging
import sys
from datetime import datetime, timedelta
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parents[1] / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

watchdog_module = importlib.import_module("backend.services.event_loop_watchdog")


def test_blocked_event_log_has_utc_timestamp(caplog):
    watchdog = watchdog_module.EventLoopWatchdog(threshold_ms=1000)
    with caplog.at_level(logging.WARNING, logger=watchdog_module.logger.name):
        watchdog._report_stall(1.25)

    message = next(record.getMessage() for record in caplog.records if "event_loop.blocked" in record.getMessage())
    assert "event_loop.blocked stalled_ms=1250 threshold_ms=1000 timestamp=" in message
    timestamp = message.split(" timestamp=", 1)[1].split(" stack:", 1)[0]
    assert datetime.fromisoformat(timestamp).utcoffset() == timedelta(0)
