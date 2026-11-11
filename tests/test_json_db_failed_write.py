"""A failed JSON write must surface to the caller instead of looking like a saved operation."""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.json_db.transfers import TransferManager
from backend.json_db.works import WorksManager


class _FailingDataManager:
    def append_to_json(self, filename, record):
        return False

    def load_json(self, filename, default_content=None):
        return default_content if default_content is not None else []


def test_transfer_is_not_reported_as_saved_when_the_write_fails():
    manager = TransferManager(data_manager=_FailingDataManager())
    with pytest.raises(RuntimeError):
        manager.add_transfer(serial_number="SN-1", new_employee="Petrov")


def test_pc_cleaning_is_not_reported_as_saved_when_the_write_fails():
    manager = WorksManager(data_manager=_FailingDataManager())
    with pytest.raises(RuntimeError):
        manager.add_pc_cleaning(serial_number="SN-1", employee="Petrov", branch="HQ", location="1")
