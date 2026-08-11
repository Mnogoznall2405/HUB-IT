import threading
import time
from concurrent.futures import ThreadPoolExecutor

from scan_server import database as db


def test_read_cache_single_flight_identical_key_one_compute():
    db._read_cache_clear()
    key = "sf-test-identical"
    started = threading.Event()
    release = threading.Event()
    computes = {"n": 0}

    def compute():
        computes["n"] += 1
        started.set()
        assert release.wait(timeout=5)
        return {"ok": True, "n": computes["n"]}

    results = []

    def worker():
        results.append(db._read_cache_single_flight(key, compute))

    with ThreadPoolExecutor(max_workers=5) as pool:
        futs = [pool.submit(worker) for _ in range(5)]
        assert started.wait(timeout=5)
        time.sleep(0.05)
        release.set()
        for fut in futs:
            fut.result(timeout=5)

    assert computes["n"] == 1
    assert db._read_cache_compute_count(key) == 1
    assert all(item.get("ok") is True for item in results)
    db._read_cache_clear()


def test_read_cache_single_flight_errors_not_cached():
    db._read_cache_clear()
    key = "sf-test-error"
    calls = {"n": 0}

    def boom():
        calls["n"] += 1
        raise RuntimeError("boom")

    try:
        db._read_cache_single_flight(key, boom)
        assert False, "expected error"
    except RuntimeError:
        pass
    assert db._read_cache_get(key) is None

    def ok():
        calls["n"] += 1
        return {"v": 1}

    assert db._read_cache_single_flight(key, ok)["v"] == 1
    assert calls["n"] == 2
    db._read_cache_clear()


def test_read_cache_single_flight_different_keys_isolated():
    db._read_cache_clear()
    barrier = threading.Barrier(2)
    order = []

    def make(name):
        def compute():
            order.append(f"start-{name}")
            barrier.wait(timeout=5)
            order.append(f"end-{name}")
            return {"name": name}

        return compute

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(db._read_cache_single_flight, "key-a", make("a"))
        f2 = pool.submit(db._read_cache_single_flight, "key-b", make("b"))
        assert f1.result(timeout=5)["name"] == "a"
        assert f2.result(timeout=5)["name"] == "b"
    assert order.count("start-a") == 1
    assert order.count("start-b") == 1
    db._read_cache_clear()
