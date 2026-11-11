from __future__ import annotations

import importlib
import sys
import threading
import time
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
WEB_ROOT = PROJECT_ROOT / "WEB-itinvent"

if str(WEB_ROOT) not in sys.path:
    sys.path.insert(0, str(WEB_ROOT))

runtime_cache = importlib.import_module("backend.services.mail_runtime_cache")


def test_runtime_cache_isolates_mailbox_scope_and_expires_entries():
    cache = runtime_cache.MailRuntimeCache()
    policy = runtime_cache.RuntimeCachePolicy(max_entries=10, ttl_sec=1)
    left_key = runtime_cache.cache_key(user_id=7, bucket="message_detail", extra="msg-1", mailbox_scope="left")
    right_key = runtime_cache.cache_key(user_id=7, bucket="message_detail", extra="msg-1", mailbox_scope="right")

    cache.set(left_key, bucket="message_detail", value={"id": "left"}, policy=policy)
    cache.set(right_key, bucket="message_detail", value={"id": "right"}, policy=policy)

    assert cache.get(left_key) == {"id": "left"}
    assert cache.get(right_key) == {"id": "right"}

    time.sleep(1.1)

    assert cache.get(left_key) is None


def test_runtime_cache_lru_and_invalidate_message_detail_clears_attachments():
    cache = runtime_cache.MailRuntimeCache()
    policy = runtime_cache.RuntimeCachePolicy(max_entries=2, ttl_sec=60)

    for index in range(3):
        cache.set(
            runtime_cache.cache_key(user_id=7, bucket="message_detail", extra=f"msg-{index}"),
            bucket="message_detail",
            value={"id": f"msg-{index}"},
            policy=policy,
        )

    assert cache.get(runtime_cache.cache_key(user_id=7, bucket="message_detail", extra="msg-0")) is None
    assert cache.get(runtime_cache.cache_key(user_id=7, bucket="message_detail", extra="msg-2")) == {"id": "msg-2"}

    attachment_key = runtime_cache.cache_key(user_id=7, bucket="attachment_content", extra="msg-2|att-1")
    cache.set(attachment_key, bucket="attachment_content", value=("a.txt", "text/plain", b"a"), policy=policy)
    cache.invalidate_user(user_id=7, prefixes=("message_detail",))

    assert cache.get(attachment_key) is None


def test_runtime_cache_updates_cached_dict_value():
    cache = runtime_cache.MailRuntimeCache()
    policy = runtime_cache.RuntimeCachePolicy(max_entries=10, ttl_sec=60)
    key = runtime_cache.cache_key(user_id=7, bucket="message_detail", extra="msg-1")

    cache.set(key, bucket="message_detail", value={"id": "msg-1", "is_read": False}, policy=policy)
    cache.update_dict_value(key, {"is_read": True})

    assert cache.get(key) == {"id": "msg-1", "is_read": True}


def test_singleflight_group_collapses_parallel_calls_and_propagates_errors():
    group = runtime_cache.SingleflightGroup()
    calls = {"count": 0}

    def _producer():
        calls["count"] += 1
        time.sleep(0.05)
        return "done"

    results: list[str] = []
    threads = [threading.Thread(target=lambda: results.append(group.run(key="same", producer=_producer))) for _ in range(5)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == ["done"] * 5
    assert calls["count"] == 1

    with pytest.raises(RuntimeError, match="boom"):
        group.run(key="failing", producer=lambda: (_ for _ in ()).throw(RuntimeError("boom")))
