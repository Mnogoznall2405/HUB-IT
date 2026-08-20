from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

from backend.services.mail_service import MailService


class _Service(MailService):
    def __init__(self, *, rows, counts):
        self._rows = list(rows)
        self._counts = dict(counts)
        self.count_calls: list[str] = []

    def _list_user_mailboxes_rows(self, *, user_id: int, include_inactive: bool = False):
        return list(self._rows)

    def _get_mailbox_unread_count(self, *, user_id: int, mailbox_id: str) -> int:
        self.count_calls.append(mailbox_id)
        return int(self._counts[mailbox_id])


def test_inbox_unread_from_summary_reads_inbox_only():
    assert MailService._inbox_unread_from_summary({"inbox": {"unread": 4, "total": 10}}) == 4
    assert MailService._inbox_unread_from_summary({"inbox": {"total": 10}}) is None
    assert MailService._inbox_unread_from_summary({}) is None


def test_aggregate_unread_reuses_current_mailbox_summary():
    service = _Service(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 99, "mbox-b": 3},
    )

    total = service._aggregate_unread_count(
        user_id=7,
        current_mailbox_id="mbox-a",
        current_inbox_unread=5,
    )

    assert total == 8
    assert service.count_calls == ["mbox-b"]


def test_aggregate_unread_counts_current_mailbox_without_summary():
    service = _Service(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 5, "mbox-b": 3},
    )

    total = service._aggregate_unread_count(user_id=7, current_mailbox_id="mbox-a")

    assert total == 8
    assert service.count_calls == ["mbox-a", "mbox-b"]


def test_mail_list_cache_policy_follows_mail_cache_ttl_env(monkeypatch):
    class _PolicyService(MailService):
        def __init__(self):
            pass

    monkeypatch.setenv("MAIL_CACHE_TTL_SEC", "45")
    policy = _PolicyService()._cache_policy("messages")
    assert policy.ttl_sec == 45
