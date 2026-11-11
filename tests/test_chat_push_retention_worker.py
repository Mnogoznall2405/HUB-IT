from __future__ import annotations

from argparse import Namespace
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"
if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.chat.push_outbox_retention_service import PushOutboxRetentionConfig
from start_chat_push_outbox_retention_worker import _requires_database_initialization


def test_disabled_retention_worker_skips_database_initialization():
    args = Namespace(once=False, dry_run=False, execute=False)

    assert _requires_database_initialization(args, PushOutboxRetentionConfig(enabled=False)) is False
    assert _requires_database_initialization(args, PushOutboxRetentionConfig(enabled=True)) is True
    assert _requires_database_initialization(Namespace(once=True, dry_run=False, execute=False), PushOutboxRetentionConfig()) is True
