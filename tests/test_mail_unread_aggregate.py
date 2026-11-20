from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

import pytest

from backend.services.mail_service import MailService, MailServiceError


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


class _StrictService(_Service):
    def __init__(self, *, rows, counts):
        super().__init__(rows=rows, counts=counts)
        self.cached_writes: list[tuple[str, str, int]] = []

    def _cached_unread_count(self, *, user_id: int, mailbox_scope: str = "aggregate"):
        return None

    def _cache_set(self, *, user_id: int, bucket: str, value, extra: str = "", ttl_sec=None, mailbox_scope: str = ""):
        self.cached_writes.append((bucket, mailbox_scope, int(value)))
        return value


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


def test_get_unread_count_raises_instead_of_fabricating_zero_on_mailbox_failure():
    service = _StrictService(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 5},
    )

    with pytest.raises(MailServiceError):
        service.get_unread_count(user_id=7)

    assert service.cached_writes == []


def test_get_unread_count_caches_total_only_when_all_mailboxes_succeed():
    service = _StrictService(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 5, "mbox-b": 3},
    )

    assert service.get_unread_count(user_id=7) == 8
    assert service.cached_writes == [("unread_count", "aggregate", 8)]


def test_get_unread_count_propagates_single_mailbox_failure():
    class _FailingService(_Service):
        def _get_mailbox_unread_count(self, *, user_id: int, mailbox_id: str) -> int:
            raise TimeoutError("EWS request timed out")

    service = _FailingService(rows=[{"id": "mbox-a"}], counts={})

    with pytest.raises(TimeoutError):
        service.get_unread_count(user_id=7, mailbox_id="mbox-a")


def test_best_effort_unread_count_falls_back_to_partial_total():
    service = _StrictService(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 5},
    )

    assert service._best_effort_unread_count(user_id=7) == 5
    assert service.cached_writes == []


def test_aggregate_unread_count_tracked_reports_failed_mailboxes():
    service = _Service(
        rows=[{"id": "mbox-a"}, {"id": "mbox-b"}],
        counts={"mbox-a": 5},
    )

    total, failed = service._aggregate_unread_count_tracked(user_id=7)

    assert total == 5
    assert failed == frozenset({"mbox-b"})


class _BootstrapService(MailService):
    def __init__(self):
        self.calls: list[tuple[str, int]] = []

    def _record(self, name: str) -> int:
        import threading

        self.calls.append((name, threading.get_ident()))
        return threading.get_ident()

    def get_my_config(self, *, user_id: int, mailbox_id=None):
        return {"id": "mbox-1", "mail_is_configured": True}

    def list_user_mailboxes(self, **kwargs):
        return []

    def get_preferences(self, *, user_id: int):
        return {"preferences": {}}

    def _cached_summary(self, **kwargs):
        return None

    def _cached_tree(self, **kwargs):
        return None

    def _cached_unread_count(self, **kwargs):
        return None

    def _cached_messages(self, **kwargs):
        return None

    def _cache_set(self, *, user_id: int, bucket: str, value, extra: str = "", ttl_sec=None, mailbox_scope: str = ""):
        return value

    def _singleflight_key(self, **kwargs):
        return "bootstrap-key"

    def _run_singleflight(self, *, key: str, producer):
        return producer()

    def _resolve_account_context(self, **kwargs):
        return {"account": object(), "profile": {"email": "user@example.com"}}

    def _set_request_metric(self, key, value):
        pass

    def _list_folder_summary_from_account(self, *, account):
        self._record("summary")
        return {"inbox": {"total": 9, "unread": 4}}

    def _list_folder_tree_from_account(self, **kwargs):
        self._record("tree")
        return {"items": [], "favorites": []}

    def _get_unread_count_from_account(self, *, account):
        return 4

    def _aggregate_unread_count_tracked(self, **kwargs):
        self._record("unread")
        return 7, frozenset()

    def _list_messages_from_account(self, **kwargs):
        self._record("messages")
        return {"items": [{"id": "m1"}], "total": 1}


def test_get_bootstrap_fans_out_independent_exchange_reads_to_workers():
    service = _BootstrapService()

    payload = service.get_bootstrap(user_id=7, limit=20)

    assert payload["unread_count"] == 7
    assert payload["messages"]["items"] == [{"id": "m1"}]
    assert payload["folder_summary"]["inbox"]["unread"] == 4
    names = [name for name, _ in service.calls]
    assert set(names) == {"summary", "tree", "unread", "messages"}
    # The folder walk keeps its internal order but workers must not all run on
    # the producer thread — concurrent reads are the point of the change.
    assert names.index("summary") < names.index("tree")
    assert len({thread_id for _, thread_id in service.calls}) >= 2


def test_get_bootstrap_propagates_worker_errors_in_original_order():
    class _FailingService(_BootstrapService):
        def _list_folder_summary_from_account(self, *, account):
            raise ValueError("summary failed")

        def _list_messages_from_account(self, **kwargs):
            raise TimeoutError("messages failed")

    with pytest.raises(ValueError, match="summary failed"):
        _FailingService().get_bootstrap(user_id=7, limit=20)


def test_mail_list_cache_policy_follows_mail_cache_ttl_env(monkeypatch):
    class _PolicyService(MailService):
        def __init__(self):
            pass

    monkeypatch.setenv("MAIL_CACHE_TTL_SEC", "45")
    policy = _PolicyService()._cache_policy("messages")
    assert policy.ttl_sec == 45
